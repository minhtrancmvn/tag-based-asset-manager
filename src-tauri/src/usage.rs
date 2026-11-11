//! Opt-in usage analytics (docs/design/usage-analytics.md).
//!
//! Nothing is sent unless the user has opted in and the build carries an
//! HTTPS endpoint. Release builds abort on panic, so this module forbids the
//! panicking shortcuts outright.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use tauri::State;

use crate::backend::{
    set_usage_consent_domain, AppTheme, BackendState, ConsentWrite, UsageSummary,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_IN_FLIGHT: usize = 4;
const THROTTLE_INTERVAL: Duration = Duration::from_secs(10);
const SESSION_IDLE_LIMIT: Duration = Duration::from_secs(30 * 60);
const MAX_ENGAGEMENT_MSEC: u64 = 60_000;

/// The user's stored choice. `Undecided` is the default for every existing install.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageConsent {
    #[default]
    Undecided,
    Granted,
    Declined,
}

/// Library size bucket for `library_scanned`; the exact count is never sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub enum SizeRange {
    #[serde(rename = "under_100")]
    Under100,
    #[serde(rename = "100_1k")]
    From100To1k,
    #[serde(rename = "1k_10k")]
    From1kTo10k,
    #[serde(rename = "10k_100k")]
    From10kTo100k,
    #[serde(rename = "over_100k")]
    Over100k,
}

impl SizeRange {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Under100 => "under_100",
            Self::From100To1k => "100_1k",
            Self::From1kTo10k => "1k_10k",
            Self::From10kTo100k => "10k_100k",
            Self::Over100k => "over_100k",
        }
    }
}

/// Every event the app can record. Closed: the frontend can only name one of
/// these, and nothing here holds free text. Payload-free events are empty
/// struct variants because unit variants silently accept extra fields.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "name", rename_all = "snake_case", deny_unknown_fields)]
pub enum UsageEvent {
    AppOpen {},
    TagEdit {},
    BulkTagEdit {},
    TagRename {},
    SavedSearchSave {},
    SavedSearchApply {},
    SavedSearchDelete {},
    AssetPreview {},
    MetadataExport {},
    AssetReconnect {},
    MissingEntryRemove {},
    AssetTrash {},
    AssetOpen {},
    AssetReveal {},
    PathCopy {},
    LibraryAdd {},
    LibraryRemove {},
    LibrarySwitch {},
    LibraryScanned { size_range: SizeRange },
    FolderNavigate {},
    SearchUsed {},
    TagFilterClick {},
    FilterChange {},
    SortChange {},
    DetailsPanelClose {},
    ThemeChange { theme: AppTheme },
}

impl UsageEvent {
    /// The GA event name. Exhaustive on purpose: a new variant must be named here.
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::AppOpen {} => "app_open",
            Self::TagEdit {} => "tag_edit",
            Self::BulkTagEdit {} => "bulk_tag_edit",
            Self::TagRename {} => "tag_rename",
            Self::SavedSearchSave {} => "saved_search_save",
            Self::SavedSearchApply {} => "saved_search_apply",
            Self::SavedSearchDelete {} => "saved_search_delete",
            Self::AssetPreview {} => "asset_preview",
            Self::MetadataExport {} => "metadata_export",
            Self::AssetReconnect {} => "asset_reconnect",
            Self::MissingEntryRemove {} => "missing_entry_remove",
            Self::AssetTrash {} => "asset_trash",
            Self::AssetOpen {} => "asset_open",
            Self::AssetReveal {} => "asset_reveal",
            Self::PathCopy {} => "path_copy",
            Self::LibraryAdd {} => "library_add",
            Self::LibraryRemove {} => "library_remove",
            Self::LibrarySwitch {} => "library_switch",
            Self::LibraryScanned { .. } => "library_scanned",
            Self::FolderNavigate {} => "folder_navigate",
            Self::SearchUsed {} => "search_used",
            Self::TagFilterClick {} => "tag_filter_click",
            Self::FilterChange {} => "filter_change",
            Self::SortChange {} => "sort_change",
            Self::DetailsPanelClose {} => "details_panel_close",
            Self::ThemeChange { .. } => "theme_change",
        }
    }

    /// Frequent browsing events go out at most once every 10 seconds each.
    pub(crate) fn is_throttled(&self) -> bool {
        matches!(
            self,
            Self::AssetPreview {}
                | Self::FolderNavigate {}
                | Self::SearchUsed {}
                | Self::TagFilterClick {}
                | Self::FilterChange {}
                | Self::SortChange {}
        )
    }
}

/// Values every payload carries besides the event. Injectable for tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PayloadContext {
    pub(crate) app_version: String,
    pub(crate) edition: &'static str,
    /// `None` on an operating system outside the allowlist: nothing is sent.
    pub(crate) operating_system: Option<&'static str>,
}

impl PayloadContext {
    pub(crate) fn current() -> Self {
        Self {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            edition: edition_name(crate::app_updates::store_build()),
            operating_system: map_operating_system(std::env::consts::OS),
        }
    }
}

pub(crate) fn edition_name(store_build: bool) -> &'static str {
    if store_build {
        "store"
    } else {
        "github"
    }
}

/// Maps Rust's lowercase OS names to the allowlisted values, and nothing else.
pub(crate) fn map_operating_system(os: &str) -> Option<&'static str> {
    match os {
        "macos" => Some("macOS"),
        "windows" => Some("Windows"),
        "linux" => Some("Linux"),
        _ => None,
    }
}

/// The endpoint baked into this build, if it is a usable HTTPS URL. Forks,
/// dev builds and tests have none, so they never ask and never send.
pub(crate) fn configured_endpoint() -> Option<String> {
    endpoint_from(option_env!("TAG_ASSET_MANAGER_USAGE_ENDPOINT"))
}

pub(crate) fn endpoint_from(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    value.starts_with("https://").then(|| value.to_string())
}

/// Builds one Measurement Protocol request body in the shape the Worker
/// accepts: `{client_id, device, events: [one event]}`.
pub(crate) fn build_payload(
    event: &UsageEvent,
    context: &PayloadContext,
    client_id: &str,
    session_id: u64,
    engagement_time_msec: u64,
) -> Option<Value> {
    let operating_system = context.operating_system?;
    let mut params = Map::new();
    params.insert("session_id".into(), Value::from(session_id.to_string()));
    params.insert(
        "engagement_time_msec".into(),
        Value::from(engagement_time_msec),
    );
    params.insert(
        "app_version".into(),
        Value::from(context.app_version.as_str()),
    );
    params.insert("edition".into(), Value::from(context.edition));
    params.insert("operating_system".into(), Value::from(operating_system));
    match event {
        UsageEvent::ThemeChange { theme } => {
            params.insert("theme".into(), serde_json::to_value(theme).ok()?);
        }
        UsageEvent::LibraryScanned { size_range } => {
            params.insert("size_range".into(), Value::from(size_range.as_str()));
        }
        _ => {}
    }

    let mut device = Map::new();
    device.insert("category".into(), Value::from("desktop"));
    device.insert("operating_system".into(), Value::from(operating_system));

    let mut sent_event = Map::new();
    sent_event.insert("name".into(), Value::from(event.name()));
    sent_event.insert("params".into(), Value::Object(params));

    let mut body = Map::new();
    body.insert("client_id".into(), Value::from(client_id));
    body.insert("device".into(), Value::Object(device));
    body.insert(
        "events".into(),
        Value::Array(vec![Value::Object(sent_event)]),
    );
    Some(Value::Object(body))
}

/// Builds the HTTPS client used for usage requests.
///
/// The locked `reqwest` uses `rustls-no-provider`, and the updater installs the
/// `ring` provider only right before its own request. Building a client with no
/// provider panics, so install it first, exactly as `tauri-plugin-updater` does.
pub(crate) async fn build_client() -> Result<reqwest::Client, reqwest::Error> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build()
}

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// Everything sending depends on outside this module: the clock, building the
/// HTTPS client and the network. Tests substitute their own.
pub trait UsagePlatform: Send + Sync + 'static {
    type Client: Clone + Send + Sync + 'static;
    fn now(&self) -> Instant;
    fn unix_seconds(&self) -> u64;
    fn build_client(&self) -> BoxFuture<Option<Self::Client>>;
    /// Sends one body. Returns whether the endpoint accepted it.
    fn send(&self, client: Self::Client, endpoint: String, body: Value) -> BoxFuture<bool>;
}

pub struct HttpPlatform;

impl UsagePlatform for HttpPlatform {
    type Client = reqwest::Client;

    fn now(&self) -> Instant {
        Instant::now()
    }

    fn unix_seconds(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default()
    }

    fn build_client(&self) -> BoxFuture<Option<reqwest::Client>> {
        Box::pin(async { build_client().await.ok() })
    }

    fn send(&self, client: reqwest::Client, endpoint: String, body: Value) -> BoxFuture<bool> {
        Box::pin(async move {
            match client.post(endpoint).json(&body).send().await {
                Ok(response) => response.status().is_success(),
                Err(_) => false,
            }
        })
    }
}

/// The managed state used by the app.
pub type UsageState = UsageCore<HttpPlatform>;

impl UsageState {
    /// Uses this build's endpoint and the backend's shared stopped flag.
    pub(crate) fn for_app(stopped: Arc<AtomicBool>) -> Self {
        Self::new(
            HttpPlatform,
            configured_endpoint(),
            PayloadContext::current(),
            stopped,
        )
    }
}

/// Whether this build can share usage at all: it has an HTTPS endpoint and
/// runs on an allowlisted operating system. Otherwise nothing is ever asked.
pub(crate) fn sharing_available() -> bool {
    configured_endpoint().is_some() && map_operating_system(std::env::consts::OS).is_some()
}

pub struct UsageCore<P: UsagePlatform> {
    shared: Arc<Shared<P>>,
}

impl<P: UsagePlatform> Clone for UsageCore<P> {
    fn clone(&self) -> Self {
        Self {
            shared: Arc::clone(&self.shared),
        }
    }
}

struct Shared<P: UsagePlatform> {
    platform: P,
    endpoint: Option<String>,
    context: PayloadContext,
    /// "Stopped, not saved": set when sharing stops before the opt-out is
    /// saved. Shared with the backend, which reports the effective choice.
    stopped: Arc<AtomicBool>,
    in_flight: Arc<AtomicUsize>,
    state: Mutex<CoreState<P::Client>>,
}

struct CoreState<C> {
    consent: UsageConsent,
    client_id: Option<String>,
    /// Bumped on every start and stop; a send whose generation is stale is dropped.
    generation: u64,
    throttled_at: HashMap<&'static str, Instant>,
    session: Option<Session>,
    client: Option<C>,
}

struct Session {
    id: u64,
    last_event: Instant,
}

/// One of the `MAX_IN_FLIGHT` request slots. Dropping it frees the slot, so
/// every path out of a send task releases it.
struct InFlightSlot(Arc<AtomicUsize>);

impl InFlightSlot {
    fn acquire(counter: &Arc<AtomicUsize>) -> Option<Self> {
        let mut held = counter.load(Ordering::SeqCst);
        loop {
            if held >= MAX_IN_FLIGHT {
                return None;
            }
            match counter.compare_exchange_weak(held, held + 1, Ordering::SeqCst, Ordering::SeqCst)
            {
                Ok(_) => return Some(Self(Arc::clone(counter))),
                Err(current) => held = current,
            }
        }
    }
}

impl Drop for InFlightSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl<P: UsagePlatform> UsageCore<P> {
    pub(crate) fn new(
        platform: P,
        endpoint: Option<String>,
        context: PayloadContext,
        stopped: Arc<AtomicBool>,
    ) -> Self {
        Self {
            shared: Arc::new(Shared {
                platform,
                endpoint,
                context,
                stopped,
                in_flight: Arc::new(AtomicUsize::new(0)),
                state: Mutex::new(CoreState {
                    consent: UsageConsent::Undecided,
                    client_id: None,
                    generation: 0,
                    throttled_at: HashMap::new(),
                    session: None,
                    client: None,
                }),
            }),
        }
    }

    /// The choice this state mirrors: what is stored, or granted while stopped.
    pub(crate) fn consent(&self) -> UsageConsent {
        self.shared.lock_state().consent
    }

    /// Copies the stored choice at startup; a stored opt-in starts sending.
    pub(crate) fn restore(&self, consent: UsageConsent, client_id: Option<String>) {
        match (consent, client_id) {
            (UsageConsent::Granted, Some(client_id)) => self.start(client_id),
            (consent, _) => {
                let mut state = self.shared.lock_state();
                state.consent = if consent == UsageConsent::Granted {
                    UsageConsent::Undecided
                } else {
                    consent
                };
                state.client_id = None;
            }
        }
    }

    /// Sharing turned on with a fresh ID: a new session, no throttle history,
    /// and an `app_open` so the opt-in is counted.
    pub(crate) fn start(&self, client_id: String) {
        {
            let mut state = self.shared.lock_state();
            state.consent = UsageConsent::Granted;
            state.client_id = Some(client_id);
            state.generation = state.generation.wrapping_add(1);
            state.throttled_at.clear();
            state.session = None;
        }
        self.shared.stopped.store(false, Ordering::SeqCst);
        self.record(&UsageEvent::AppOpen {});
    }

    /// Stops sending before the opt-out is saved. Consent stays granted here
    /// because nothing on disk has changed yet.
    pub(crate) fn stop(&self) {
        self.shared.stopped.store(true, Ordering::SeqCst);
        let mut state = self.shared.lock_state();
        state.generation = state.generation.wrapping_add(1);
        state.client = None;
    }

    /// A saved decline: forget the ID and clear the stopped flag.
    pub(crate) fn mark_declined(&self) {
        {
            let mut state = self.shared.lock_state();
            state.consent = UsageConsent::Declined;
            state.client_id = None;
            state.generation = state.generation.wrapping_add(1);
            state.client = None;
            state.throttled_at.clear();
            state.session = None;
        }
        self.shared.stopped.store(false, Ordering::SeqCst);
    }

    /// Records one event. Sends it at once, in its own request, or drops it.
    pub(crate) fn record(&self, event: &UsageEvent) {
        let Some(endpoint) = self.shared.endpoint.clone() else {
            return;
        };
        let (body, generation) = {
            let mut state = self.shared.lock_state();
            if state.consent != UsageConsent::Granted || self.shared.stopped.load(Ordering::SeqCst)
            {
                return;
            }
            let Some(client_id) = state.client_id.clone() else {
                return;
            };
            let now = self.shared.platform.now();
            if event.is_throttled() {
                let recent = state
                    .throttled_at
                    .get(event.name())
                    .is_some_and(|last| now.saturating_duration_since(*last) < THROTTLE_INTERVAL);
                if recent {
                    return;
                }
                state.throttled_at.insert(event.name(), now);
            }
            let (session_id, engagement_time_msec) = match state.session.as_mut() {
                Some(session)
                    if now.saturating_duration_since(session.last_event) < SESSION_IDLE_LIMIT =>
                {
                    let elapsed = now
                        .saturating_duration_since(session.last_event)
                        .as_millis();
                    session.last_event = now;
                    let engagement = u64::try_from(elapsed)
                        .unwrap_or(MAX_ENGAGEMENT_MSEC)
                        .clamp(1, MAX_ENGAGEMENT_MSEC);
                    (session.id, engagement)
                }
                _ => {
                    let id = self.shared.platform.unix_seconds();
                    state.session = Some(Session {
                        id,
                        last_event: now,
                    });
                    (id, 1)
                }
            };
            let Some(body) = build_payload(
                event,
                &self.shared.context,
                &client_id,
                session_id,
                engagement_time_msec,
            ) else {
                return;
            };
            (body, state.generation)
        };
        let Some(slot) = InFlightSlot::acquire(&self.shared.in_flight) else {
            return;
        };
        let shared = Arc::clone(&self.shared);
        tauri::async_runtime::spawn(async move {
            shared.send(slot, generation, endpoint, body).await;
        });
    }

    #[cfg(test)]
    fn in_flight(&self) -> usize {
        self.shared.in_flight.load(Ordering::SeqCst)
    }

    #[cfg(test)]
    fn has_client(&self) -> bool {
        self.shared.lock_state().client.is_some()
    }
}

impl<P: UsagePlatform> Shared<P> {
    fn lock_state(&self) -> MutexGuard<'_, CoreState<P::Client>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn is_current(&self, generation: u64) -> bool {
        let state = self.lock_state();
        state.generation == generation
            && state.consent == UsageConsent::Granted
            && !self.stopped.load(Ordering::SeqCst)
    }

    /// One request. Any failure drops the event: no retry, nothing on disk.
    /// The slot is released when this returns, on every path.
    async fn send(&self, _slot: InFlightSlot, generation: u64, endpoint: String, body: Value) {
        let cached = self.lock_state().client.clone();
        let client = match cached {
            Some(client) => client,
            None => {
                let Some(built) = self.platform.build_client().await else {
                    return;
                };
                let mut state = self.lock_state();
                if state.generation == generation && !self.stopped.load(Ordering::SeqCst) {
                    state.client = Some(built.clone());
                }
                built
            }
        };
        if !self.is_current(generation) {
            return;
        }
        let _accepted = self.platform.send(client, endpoint, body).await;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsentStatus {
    Saved,
    Busy,
    Failed,
    StoppedNotSaved,
}

/// Why an opt-out stopped sending but couldn't be saved yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotSavedReason {
    Busy,
    Failed,
}

/// What `set_usage_consent` returns. `usage` is present only when the result
/// says what is now in effect; `busy` and `failed` changed nothing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentResult {
    pub status: ConsentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<NotSavedReason>,
}

impl ConsentResult {
    fn saved(usage: UsageSummary) -> Self {
        Self {
            status: ConsentStatus::Saved,
            usage: Some(usage),
            reason: None,
        }
    }

    fn busy() -> Self {
        Self {
            status: ConsentStatus::Busy,
            usage: None,
            reason: None,
        }
    }

    fn failed() -> Self {
        Self {
            status: ConsentStatus::Failed,
            usage: None,
            reason: None,
        }
    }

    fn stopped_not_saved(reason: NotSavedReason, available: bool) -> Self {
        Self {
            status: ConsentStatus::StoppedNotSaved,
            usage: Some(UsageSummary {
                available,
                consent: UsageConsent::Declined,
                saved: false,
            }),
            reason: Some(reason),
        }
    }
}

fn saved_choice(consent: UsageConsent) -> ConsentResult {
    ConsentResult::saved(UsageSummary {
        available: sharing_available(),
        consent,
        saved: true,
    })
}

/// The consent command's logic. Locks are taken one after the other and never
/// nested; the backend lock only through `try_update`, so this never waits.
fn set_usage_consent_with<P: UsagePlatform>(
    backend: &BackendState,
    usage: &UsageCore<P>,
    consent: UsageConsent,
) -> ConsentResult {
    match consent {
        // Turning sharing off, including a retry after "stopped, not saved":
        // stop first, so nothing more is sent even if the save can't happen.
        UsageConsent::Declined if usage.consent() == UsageConsent::Granted => {
            usage.stop();
            match set_usage_consent_domain(backend, UsageConsent::Declined) {
                ConsentWrite::Saved(_) => {
                    usage.mark_declined();
                    saved_choice(UsageConsent::Declined)
                }
                ConsentWrite::Busy => {
                    ConsentResult::stopped_not_saved(NotSavedReason::Busy, sharing_available())
                }
                ConsentWrite::Failed => {
                    ConsentResult::stopped_not_saved(NotSavedReason::Failed, sharing_available())
                }
            }
        }
        _ => match set_usage_consent_domain(backend, consent) {
            ConsentWrite::Saved(saved) if !saved.changed => ConsentResult {
                status: ConsentStatus::Saved,
                usage: Some(saved.state.usage),
                reason: None,
            },
            ConsentWrite::Saved(saved) => {
                match saved.new_client_id {
                    Some(client_id) => usage.start(client_id),
                    None => usage.mark_declined(),
                }
                saved_choice(consent)
            }
            ConsentWrite::Busy => ConsentResult::busy(),
            ConsentWrite::Failed => ConsentResult::failed(),
        },
    }
}

/// Records one usage event. Does nothing unless the user opted in.
#[tauri::command]
pub fn track_usage(event: UsageEvent, usage: State<'_, UsageState>) {
    usage.record(&event);
}

/// Saves the user's choice. The parameter must stay named `consent`: Tauri
/// takes the argument key from it, and the frontend sends `{ consent }`.
#[tauri::command]
pub fn set_usage_consent(
    consent: UsageConsent,
    backend: State<'_, BackendState>,
    usage: State<'_, UsageState>,
) -> ConsentResult {
    set_usage_consent_with(&backend, &usage, consent)
}

#[cfg(test)]
#[path = "usage_tests.rs"]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod tests;
