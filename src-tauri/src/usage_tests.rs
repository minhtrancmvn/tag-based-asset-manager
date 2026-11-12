use super::*;

/// Proves the TLS trap is handled: with `rustls-no-provider`, a client built
/// before any provider is installed would panic and abort a release build.
/// The provider is process-global, so the no-provider path is only certain
/// when this test runs alone:
/// `cargo test usage::tests::client_builds_without_provider -- --exact --nocapture`.
#[test]
fn client_builds_without_provider() {
    let started_without_provider = rustls::crypto::CryptoProvider::get_default().is_none();
    println!("provider absent at start: {started_without_provider}");

    let client = tauri::async_runtime::block_on(build_client());

    assert!(client.is_ok(), "client should build: {:?}", client.err());
    assert!(rustls::crypto::CryptoProvider::get_default().is_some());
}

const PAYLOAD_FIXTURE: &str = include_str!("../../fixtures/usage-payload.json");
const FIXTURE_CLIENT_ID: &str = "00000000-0000-4000-8000-000000000000";
const COMMON_PARAMS: [&str; 5] = [
    "session_id",
    "engagement_time_msec",
    "app_version",
    "edition",
    "operating_system",
];

fn fixture_context() -> PayloadContext {
    PayloadContext {
        app_version: "1.2.3".to_string(),
        edition: "github",
        operating_system: Some("macOS"),
    }
}

fn event(json: &str) -> UsageEvent {
    serde_json::from_str(json).unwrap()
}

#[test]
fn unknown_event_name_is_rejected() {
    assert!(serde_json::from_str::<UsageEvent>(r#"{"name":"app_crash"}"#).is_err());
    assert!(serde_json::from_str::<UsageEvent>(r#"{}"#).is_err());
}

#[test]
fn extra_field_is_rejected_on_payload_free_and_payload_events() {
    assert!(serde_json::from_str::<UsageEvent>(r#"{"name":"tag_edit"}"#).is_ok());
    assert!(serde_json::from_str::<UsageEvent>(r#"{"name":"tag_edit","path":"/x"}"#).is_err());
    assert!(serde_json::from_str::<UsageEvent>(
        r#"{"name":"theme_change","theme":"workshop","note":"hi"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<UsageEvent>(
        r#"{"name":"library_scanned","size_range":"1k_10k","count":5000}"#
    )
    .is_err());
}

#[test]
fn free_text_or_missing_extra_values_are_rejected() {
    assert!(
        serde_json::from_str::<UsageEvent>(r#"{"name":"theme_change","theme":"My Theme"}"#)
            .is_err()
    );
    assert!(serde_json::from_str::<UsageEvent>(r#"{"name":"theme_change"}"#).is_err());
    assert!(serde_json::from_str::<UsageEvent>(
        r#"{"name":"library_scanned","size_range":"5000"}"#
    )
    .is_err());
    assert!(serde_json::from_str::<UsageEvent>(r#"{"name":"library_scanned"}"#).is_err());
}

#[test]
fn endpoint_requires_https_and_ignores_blank_values() {
    assert_eq!(endpoint_from(None), None);
    assert_eq!(endpoint_from(Some("")), None);
    assert_eq!(endpoint_from(Some("   \t ")), None);
    assert_eq!(endpoint_from(Some("http://usage.example/v1/events")), None);
    assert_eq!(endpoint_from(Some("ftp://usage.example")), None);
    assert_eq!(
        endpoint_from(Some("  https://usage.example/v1/events \n")),
        Some("https://usage.example/v1/events".to_string())
    );
}

#[test]
fn operating_system_names_are_mapped_explicitly() {
    assert_eq!(map_operating_system("macos"), Some("macOS"));
    assert_eq!(map_operating_system("windows"), Some("Windows"));
    assert_eq!(map_operating_system("linux"), Some("Linux"));
    assert_eq!(map_operating_system("freebsd"), None);
    assert_eq!(map_operating_system("MacOS"), None);
}

#[test]
fn unknown_operating_system_produces_no_payload() {
    let context = PayloadContext {
        operating_system: None,
        ..fixture_context()
    };
    let body = build_payload(
        &event(r#"{"name":"tag_edit"}"#),
        &context,
        FIXTURE_CLIENT_ID,
        1,
        1,
    );
    assert!(body.is_none());
}

#[test]
fn every_event_payload_matches_the_shared_fixture() {
    let fixture: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(PAYLOAD_FIXTURE).unwrap();
    assert_eq!(fixture.len(), 26);
    for (name, expected) in &fixture {
        let params = expected["events"][0]["params"].as_object().unwrap();
        let mut event_json = serde_json::Map::new();
        event_json.insert("name".to_string(), serde_json::json!(name));
        for (key, value) in params {
            if !COMMON_PARAMS.contains(&key.as_str()) {
                event_json.insert(key.clone(), value.clone());
            }
        }
        let usage_event: UsageEvent =
            serde_json::from_value(serde_json::Value::Object(event_json)).unwrap();
        assert_eq!(usage_event.name(), name.as_str());
        let body = build_payload(
            &usage_event,
            &fixture_context(),
            FIXTURE_CLIENT_ID,
            1_700_000_000,
            1000,
        )
        .unwrap();
        assert_eq!(&body, expected, "payload for {name}");
    }
}

#[test]
fn edition_follows_the_store_build_flag() {
    assert_eq!(edition_name(true), "store");
    assert_eq!(edition_name(false), "github");
}

#[test]
fn consent_serializes_lowercase_and_defaults_to_undecided() {
    assert_eq!(UsageConsent::default(), UsageConsent::Undecided);
    assert_eq!(
        serde_json::to_string(&UsageConsent::Granted).unwrap(),
        r#""granted""#
    );
    assert_eq!(
        serde_json::to_string(&UsageConsent::Declined).unwrap(),
        r#""declined""#
    );
    assert_eq!(
        serde_json::to_string(&UsageConsent::Undecided).unwrap(),
        r#""undecided""#
    );
}

// ---- Sending, sessions, throttle and the stopped flag (T6) ----

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(5);
const QUIET: Duration = Duration::from_millis(250);
const ENDPOINT: &str = "https://usage.example/v1/events";
const BASE_UNIX: u64 = 1_700_000_000;

type Gate = Arc<Mutex<mpsc::Receiver<()>>>;

/// Test platform: a settable clock, and a client build and send that can be
/// made to fail or to wait for a release signal.
pub(super) struct FakePlatform {
    base: Instant,
    offset: Mutex<Duration>,
    sent: Mutex<mpsc::Sender<Value>>,
    pub(super) send_ok: AtomicBool,
    pub(super) build_ok: AtomicBool,
    build_gate: Mutex<Option<Gate>>,
    send_gate: Mutex<Option<Gate>>,
    pub(super) builds: AtomicUsize,
    pub(super) send_attempts: AtomicUsize,
}

impl FakePlatform {
    pub(super) fn new() -> (Self, mpsc::Receiver<Value>) {
        let (sender, receiver) = mpsc::channel();
        (
            Self {
                base: Instant::now(),
                offset: Mutex::new(Duration::ZERO),
                sent: Mutex::new(sender),
                send_ok: AtomicBool::new(true),
                build_ok: AtomicBool::new(true),
                build_gate: Mutex::new(None),
                send_gate: Mutex::new(None),
                builds: AtomicUsize::new(0),
                send_attempts: AtomicUsize::new(0),
            },
            receiver,
        )
    }

    pub(super) fn advance(&self, by: Duration) {
        *self.offset.lock().unwrap() += by;
    }

    /// Builds wait until the returned sender sends one `()` per build.
    pub(super) fn gate_builds(&self) -> mpsc::Sender<()> {
        let (release, wait) = mpsc::channel();
        *self.build_gate.lock().unwrap() = Some(Arc::new(Mutex::new(wait)));
        release
    }

    /// Sends wait until the returned sender sends one `()` per send.
    pub(super) fn gate_sends(&self) -> mpsc::Sender<()> {
        let (release, wait) = mpsc::channel();
        *self.send_gate.lock().unwrap() = Some(Arc::new(Mutex::new(wait)));
        release
    }
}

fn wait_on(gate: Option<Gate>) -> BoxFuture<()> {
    Box::pin(async move {
        if let Some(gate) = gate {
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let _ = gate.lock().unwrap().recv_timeout(WAIT);
            })
            .await;
        }
    })
}

impl UsagePlatform for FakePlatform {
    type Client = u32;

    fn now(&self) -> Instant {
        self.base + *self.offset.lock().unwrap()
    }

    fn unix_seconds(&self) -> u64 {
        BASE_UNIX + self.offset.lock().unwrap().as_secs()
    }

    fn build_client(&self) -> BoxFuture<Option<u32>> {
        let number = self.builds.fetch_add(1, Ordering::SeqCst) as u32 + 1;
        let ok = self.build_ok.load(Ordering::SeqCst);
        let gate = wait_on(self.build_gate.lock().unwrap().clone());
        Box::pin(async move {
            gate.await;
            ok.then_some(number)
        })
    }

    fn send(&self, _client: u32, endpoint: String, body: Value) -> BoxFuture<bool> {
        self.send_attempts.fetch_add(1, Ordering::SeqCst);
        let ok = self.send_ok.load(Ordering::SeqCst);
        let sent = self.sent.lock().unwrap().clone();
        let gate = wait_on(self.send_gate.lock().unwrap().clone());
        Box::pin(async move {
            gate.await;
            assert_eq!(endpoint, ENDPOINT);
            if ok {
                let _ = sent.send(body);
            }
            ok
        })
    }
}

pub(super) fn fake_core(
    endpoint: Option<&str>,
) -> (
    UsageCore<FakePlatform>,
    mpsc::Receiver<Value>,
    Arc<AtomicBool>,
) {
    let (platform, sent) = FakePlatform::new();
    let stopped = Arc::new(AtomicBool::new(false));
    let core = UsageCore::new(
        platform,
        endpoint.map(str::to_string),
        fixture_context(),
        Arc::clone(&stopped),
    );
    (core, sent, stopped)
}

const ID_A: &str = "11111111-1111-4111-8111-111111111111";
const ID_B: &str = "22222222-2222-4222-8222-222222222222";

fn tag_edit() -> UsageEvent {
    event(r#"{"name":"tag_edit"}"#)
}

fn folder_navigate() -> UsageEvent {
    event(r#"{"name":"folder_navigate"}"#)
}

fn sent_name(body: &Value) -> &str {
    body["events"][0]["name"].as_str().unwrap()
}

fn sent_param<'a>(body: &'a Value, key: &str) -> &'a Value {
    &body["events"][0]["params"][key]
}

fn expect_sent(sent: &mpsc::Receiver<Value>) -> Value {
    sent.recv_timeout(WAIT).expect("an event should be sent")
}

fn expect_quiet(sent: &mpsc::Receiver<Value>) {
    assert!(sent.recv_timeout(QUIET).is_err(), "nothing should be sent");
}

fn wait_until(mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn nothing_is_sent_unless_granted_running_and_configured() {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.record(&tag_edit());
    expect_quiet(&sent);

    core.restore(UsageConsent::Declined, None);
    core.record(&tag_edit());
    expect_quiet(&sent);

    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.start(ID_A.to_string());
    assert_eq!(sent_name(&expect_sent(&sent)), "app_open");
    core.stop();
    core.record(&tag_edit());
    expect_quiet(&sent);

    let (core, sent, _) = fake_core(None);
    core.start(ID_A.to_string());
    core.record(&tag_edit());
    expect_quiet(&sent);
    assert_eq!(core.shared.platform.send_attempts.load(Ordering::SeqCst), 0);
}

#[test]
fn restore_granted_starts_with_the_stored_id() {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.restore(UsageConsent::Granted, Some(ID_A.to_string()));
    let body = expect_sent(&sent);
    assert_eq!(sent_name(&body), "app_open");
    assert_eq!(body["client_id"], ID_A);
    assert_eq!(core.consent(), UsageConsent::Granted);
}

#[test]
fn throttled_events_go_out_at_most_once_per_ten_seconds() {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.start(ID_A.to_string());
    expect_sent(&sent);

    core.record(&folder_navigate());
    assert_eq!(sent_name(&expect_sent(&sent)), "folder_navigate");
    core.shared.platform.advance(Duration::from_secs(9));
    core.record(&folder_navigate());
    expect_quiet(&sent);
    core.shared.platform.advance(Duration::from_secs(1));
    core.record(&folder_navigate());
    assert_eq!(sent_name(&expect_sent(&sent)), "folder_navigate");

    core.record(&tag_edit());
    core.record(&tag_edit());
    assert_eq!(sent_name(&expect_sent(&sent)), "tag_edit");
    assert_eq!(sent_name(&expect_sent(&sent)), "tag_edit");
}

fn fixture_events() -> Vec<UsageEvent> {
    let fixture: serde_json::Map<String, Value> = serde_json::from_str(PAYLOAD_FIXTURE).unwrap();
    fixture
        .iter()
        .map(|(name, body)| {
            let mut event_json = serde_json::Map::new();
            event_json.insert("name".to_string(), serde_json::json!(name));
            for (key, value) in body["events"][0]["params"].as_object().unwrap() {
                if !COMMON_PARAMS.contains(&key.as_str()) {
                    event_json.insert(key.clone(), value.clone());
                }
            }
            serde_json::from_value(Value::Object(event_json)).unwrap()
        })
        .collect()
}

#[test]
fn throttled_set_matches_the_design() {
    let mut throttled: Vec<&str> = fixture_events()
        .iter()
        .filter(|event| event.is_throttled())
        .map(UsageEvent::name)
        .collect();
    throttled.sort_unstable();
    assert_eq!(
        throttled,
        [
            "asset_preview",
            "filter_change",
            "folder_navigate",
            "search_used",
            "sort_change",
            "tag_filter_click"
        ]
    );
}

#[test]
fn at_most_four_requests_are_in_flight() {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    let release = core.shared.platform.gate_sends();
    core.start(ID_A.to_string());
    for _ in 0..4 {
        core.record(&tag_edit());
    }
    wait_until(|| core.shared.platform.send_attempts.load(Ordering::SeqCst) == 4);
    assert_eq!(core.in_flight(), 4);
    for _ in 0..4 {
        release.send(()).unwrap();
    }
    for _ in 0..4 {
        expect_sent(&sent);
    }
    expect_quiet(&sent);
    wait_until(|| core.in_flight() == 0);
    assert_eq!(core.shared.platform.send_attempts.load(Ordering::SeqCst), 4);
}

#[test]
fn failed_or_early_returning_sends_free_their_slots() {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.shared.platform.build_ok.store(false, Ordering::SeqCst);
    core.start(ID_A.to_string());
    core.record(&tag_edit());
    wait_until(|| core.in_flight() == 0);
    assert_eq!(core.shared.platform.send_attempts.load(Ordering::SeqCst), 0);

    core.shared.platform.build_ok.store(true, Ordering::SeqCst);
    core.shared.platform.send_ok.store(false, Ordering::SeqCst);
    for _ in 0..2 {
        core.record(&tag_edit());
    }
    wait_until(|| core.in_flight() == 0);
    expect_quiet(&sent);

    core.shared.platform.send_ok.store(true, Ordering::SeqCst);
    core.record(&tag_edit());
    assert_eq!(sent_name(&expect_sent(&sent)), "tag_edit");
}

#[test]
fn a_failed_send_drops_the_event_without_retry() {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.shared.platform.send_ok.store(false, Ordering::SeqCst);
    core.start(ID_A.to_string());
    core.record(&tag_edit());
    wait_until(|| core.in_flight() == 0);
    std::thread::sleep(QUIET);
    assert_eq!(core.shared.platform.send_attempts.load(Ordering::SeqCst), 2);
    expect_quiet(&sent);
}

#[test]
fn sessions_renew_after_thirty_idle_minutes_and_engagement_is_clamped() {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.start(ID_A.to_string());
    let open = expect_sent(&sent);
    let first_session = sent_param(&open, "session_id").clone();
    assert_eq!(first_session, BASE_UNIX.to_string());
    assert_eq!(sent_param(&open, "engagement_time_msec"), 1);

    core.shared.platform.advance(Duration::from_millis(4_500));
    core.record(&tag_edit());
    let body = expect_sent(&sent);
    assert_eq!(sent_param(&body, "session_id"), &first_session);
    assert_eq!(sent_param(&body, "engagement_time_msec"), 4_500);

    core.shared.platform.advance(Duration::from_secs(29 * 60));
    core.record(&tag_edit());
    let body = expect_sent(&sent);
    assert_eq!(sent_param(&body, "session_id"), &first_session);
    assert_eq!(sent_param(&body, "engagement_time_msec"), 60_000);

    core.shared.platform.advance(Duration::from_secs(30 * 60));
    core.record(&tag_edit());
    let body = expect_sent(&sent);
    assert_ne!(sent_param(&body, "session_id"), &first_session);
    assert_eq!(sent_param(&body, "engagement_time_msec"), 1);
}

#[test]
fn stop_cancels_a_pending_send_and_discards_a_late_client() {
    let (core, sent, stopped) = fake_core(Some(ENDPOINT));
    let release_build = core.shared.platform.gate_builds();
    core.start(ID_A.to_string());
    wait_until(|| core.shared.platform.builds.load(Ordering::SeqCst) == 1);

    core.stop();
    assert!(stopped.load(Ordering::SeqCst));
    assert_eq!(core.consent(), UsageConsent::Granted);
    release_build.send(()).unwrap();
    wait_until(|| core.in_flight() == 0);

    expect_quiet(&sent);
    assert_eq!(core.shared.platform.send_attempts.load(Ordering::SeqCst), 0);
    assert!(!core.has_client());
}

#[test]
fn start_after_stop_sends_app_open_in_a_new_session() {
    let (core, sent, stopped) = fake_core(Some(ENDPOINT));
    core.start(ID_A.to_string());
    let first = expect_sent(&sent);
    core.record(&folder_navigate());
    expect_sent(&sent);

    core.shared.platform.advance(Duration::from_secs(2));
    core.stop();
    core.start(ID_B.to_string());
    assert!(!stopped.load(Ordering::SeqCst));
    let open = expect_sent(&sent);
    assert_eq!(sent_name(&open), "app_open");
    assert_eq!(open["client_id"], ID_B);
    assert_ne!(
        sent_param(&open, "session_id"),
        sent_param(&first, "session_id")
    );
    assert_eq!(sent_param(&open, "engagement_time_msec"), 1);

    core.record(&folder_navigate());
    let body = expect_sent(&sent);
    assert_eq!(sent_name(&body), "folder_navigate");
    assert_eq!(body["client_id"], ID_B);
}

#[test]
fn mark_declined_leaves_nothing_able_to_send() {
    let (core, sent, stopped) = fake_core(Some(ENDPOINT));
    core.start(ID_A.to_string());
    expect_sent(&sent);
    core.stop();
    core.mark_declined();
    assert!(!stopped.load(Ordering::SeqCst));
    assert_eq!(core.consent(), UsageConsent::Declined);
    core.record(&tag_edit());
    expect_quiet(&sent);
    assert!(!core.has_client());
}

// ---- Commands, result contract and pin (T8) ----

use std::collections::BTreeSet;
use std::path::PathBuf;

const RESULT_FIXTURE: &str = include_str!("../../fixtures/usage-consent-result.json");
const EVENTS_SPEC: &str = include_str!("../../usage-events.json");

#[test]
fn consent_results_match_the_shared_fixture() {
    let fixture: Value = serde_json::from_str(RESULT_FIXTURE).unwrap();
    let cases = [
        (
            "saved",
            ConsentResult::saved(UsageSummary {
                available: false,
                consent: UsageConsent::Declined,
                saved: true,
            }),
        ),
        ("busy", ConsentResult::busy()),
        ("failed", ConsentResult::failed()),
        (
            "stoppedNotSaved",
            ConsentResult::stopped_not_saved(NotSavedReason::Busy, true),
        ),
    ];
    assert_eq!(fixture.as_object().unwrap().len(), cases.len());
    for (key, result) in cases {
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            fixture[key],
            "{key}"
        );
    }
    assert_eq!(
        serde_json::to_value(ConsentResult::stopped_not_saved(
            NotSavedReason::Failed,
            false
        ))
        .unwrap()["reason"],
        "failed"
    );
}

/// Every variant, in catalog order. `catalog_position` has no wildcard arm, so
/// a new variant doesn't compile until it is listed there, and the position
/// check below fails until it is listed here too.
fn all_events() -> Vec<UsageEvent> {
    vec![
        UsageEvent::AppOpen {},
        UsageEvent::TagEdit {},
        UsageEvent::BulkTagEdit {},
        UsageEvent::TagRename {},
        UsageEvent::SavedSearchSave {},
        UsageEvent::SavedSearchApply {},
        UsageEvent::SavedSearchDelete {},
        UsageEvent::AssetPreview {},
        UsageEvent::MetadataExport {},
        UsageEvent::AssetReconnect {},
        UsageEvent::MissingEntryRemove {},
        UsageEvent::AssetTrash {},
        UsageEvent::AssetOpen {},
        UsageEvent::AssetReveal {},
        UsageEvent::PathCopy {},
        UsageEvent::LibraryAdd {},
        UsageEvent::LibraryRemove {},
        UsageEvent::LibrarySwitch {},
        UsageEvent::LibraryScanned {
            size_range: SizeRange::Under100,
        },
        UsageEvent::FolderNavigate {},
        UsageEvent::SearchUsed {},
        UsageEvent::TagFilterClick {},
        UsageEvent::FilterChange {},
        UsageEvent::SortChange {},
        UsageEvent::DetailsPanelClose {},
        UsageEvent::ThemeChange {
            theme: AppTheme::Workshop,
        },
    ]
}

fn catalog_position(event: &UsageEvent) -> usize {
    match event {
        UsageEvent::AppOpen {} => 0,
        UsageEvent::TagEdit {} => 1,
        UsageEvent::BulkTagEdit {} => 2,
        UsageEvent::TagRename {} => 3,
        UsageEvent::SavedSearchSave {} => 4,
        UsageEvent::SavedSearchApply {} => 5,
        UsageEvent::SavedSearchDelete {} => 6,
        UsageEvent::AssetPreview {} => 7,
        UsageEvent::MetadataExport {} => 8,
        UsageEvent::AssetReconnect {} => 9,
        UsageEvent::MissingEntryRemove {} => 10,
        UsageEvent::AssetTrash {} => 11,
        UsageEvent::AssetOpen {} => 12,
        UsageEvent::AssetReveal {} => 13,
        UsageEvent::PathCopy {} => 14,
        UsageEvent::LibraryAdd {} => 15,
        UsageEvent::LibraryRemove {} => 16,
        UsageEvent::LibrarySwitch {} => 17,
        UsageEvent::LibraryScanned { .. } => 18,
        UsageEvent::FolderNavigate {} => 19,
        UsageEvent::SearchUsed {} => 20,
        UsageEvent::TagFilterClick {} => 21,
        UsageEvent::FilterChange {} => 22,
        UsageEvent::SortChange {} => 23,
        UsageEvent::DetailsPanelClose {} => 24,
        UsageEvent::ThemeChange { .. } => 25,
    }
}

fn all_themes() -> Vec<AppTheme> {
    vec![
        AppTheme::Workshop,
        AppTheme::Coral,
        AppTheme::Lavender,
        AppTheme::Ocean,
        AppTheme::Mint,
        AppTheme::Sunset,
        AppTheme::Stone,
        AppTheme::Midnight,
        AppTheme::Rose,
        AppTheme::Peach,
        AppTheme::Ember,
        AppTheme::Amber,
        AppTheme::Meadow,
        AppTheme::Lagoon,
        AppTheme::Glacier,
        AppTheme::Sky,
        AppTheme::Cobalt,
        AppTheme::Iris,
        AppTheme::Plum,
        AppTheme::Aurora,
    ]
}

fn theme_position(theme: AppTheme) -> usize {
    match theme {
        AppTheme::Workshop => 0,
        AppTheme::Coral => 1,
        AppTheme::Lavender => 2,
        AppTheme::Ocean => 3,
        AppTheme::Mint => 4,
        AppTheme::Sunset => 5,
        AppTheme::Stone => 6,
        AppTheme::Midnight => 7,
        AppTheme::Rose => 8,
        AppTheme::Peach => 9,
        AppTheme::Ember => 10,
        AppTheme::Amber => 11,
        AppTheme::Meadow => 12,
        AppTheme::Lagoon => 13,
        AppTheme::Glacier => 14,
        AppTheme::Sky => 15,
        AppTheme::Cobalt => 16,
        AppTheme::Iris => 17,
        AppTheme::Plum => 18,
        AppTheme::Aurora => 19,
    }
}

fn all_size_ranges() -> Vec<SizeRange> {
    vec![
        SizeRange::Under100,
        SizeRange::From100To1k,
        SizeRange::From1kTo10k,
        SizeRange::From10kTo100k,
        SizeRange::Over100k,
    ]
}

fn size_position(size: SizeRange) -> usize {
    match size {
        SizeRange::Under100 => 0,
        SizeRange::From100To1k => 1,
        SizeRange::From1kTo10k => 2,
        SizeRange::From10kTo100k => 3,
        SizeRange::Over100k => 4,
    }
}

fn spec_set(spec: &Value, key: &str) -> BTreeSet<String> {
    spec[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_string())
        .collect()
}

fn strings<'a>(values: impl IntoIterator<Item = &'a str>) -> BTreeSet<String> {
    values.into_iter().map(str::to_string).collect()
}

#[test]
fn rust_types_and_the_shared_allowlist_agree_in_both_directions() {
    let spec: Value = serde_json::from_str(EVENTS_SPEC).unwrap();

    let events = all_events();
    let positions: Vec<usize> = events.iter().map(catalog_position).collect();
    assert_eq!(positions, (0..events.len()).collect::<Vec<_>>());
    let names: Vec<&str> = events.iter().map(UsageEvent::name).collect();
    let spec_names: Vec<&str> = spec["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect();
    assert_eq!(names, spec_names, "event names, in catalog order");

    let themes = all_themes();
    assert_eq!(
        themes
            .iter()
            .map(|theme| theme_position(*theme))
            .collect::<Vec<_>>(),
        (0..themes.len()).collect::<Vec<_>>()
    );
    let rust_themes: BTreeSet<String> = themes
        .iter()
        .map(|theme| {
            serde_json::to_value(theme)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(rust_themes, spec_set(&spec, "themes"));

    let sizes = all_size_ranges();
    assert_eq!(
        sizes
            .iter()
            .map(|size| size_position(*size))
            .collect::<Vec<_>>(),
        (0..sizes.len()).collect::<Vec<_>>()
    );
    assert_eq!(
        strings(sizes.iter().map(|size| size.as_str())),
        spec_set(&spec, "sizeRanges")
    );
    for size in spec_set(&spec, "sizeRanges") {
        serde_json::from_value::<SizeRange>(Value::from(size)).unwrap();
    }

    assert_eq!(
        strings([edition_name(false), edition_name(true)]),
        spec_set(&spec, "editions")
    );
    assert_eq!(
        strings(
            ["macos", "windows", "linux"]
                .into_iter()
                .map(|os| map_operating_system(os).unwrap())
        ),
        spec_set(&spec, "operatingSystems")
    );

    let param_keys: Vec<BTreeSet<String>> = events
        .iter()
        .map(|event| {
            build_payload(event, &fixture_context(), FIXTURE_CLIENT_ID, 1, 1).unwrap()["events"][0]
                ["params"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect()
        })
        .collect();
    let common = param_keys
        .iter()
        .skip(1)
        .fold(param_keys[0].clone(), |shared, keys| {
            shared.intersection(keys).cloned().collect()
        });
    assert_eq!(common, spec_set(&spec, "commonParams"));
    let mut extras = serde_json::Map::new();
    for (event, keys) in events.iter().zip(&param_keys) {
        let extra: Vec<&String> = keys.difference(&common).collect();
        assert!(extra.len() <= 1, "{}", event.name());
        if let Some(extra) = extra.first() {
            extras.insert(event.name().to_string(), Value::from(extra.as_str()));
        }
    }
    assert_eq!(Value::Object(extras), spec["extraParams"]);
}

fn ipc_request(cmd: &str, body: Value) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: cmd.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        // The local origin differs by OS; a non-local origin can't reach app commands.
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
    }
}

#[test]
fn commands_take_their_arguments_by_the_names_the_frontend_sends() {
    let dir = tempfile::tempdir().unwrap();
    let backend = BackendState::load(dir.path().join("settings.json")).unwrap();
    let usage = UsageState::for_app(backend.usage_stop_flag());
    let app = tauri::test::mock_builder()
        .manage(backend.clone())
        .manage(usage)
        .invoke_handler(tauri::generate_handler![
            super::set_usage_consent,
            super::track_usage
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let response = tauri::test::get_ipc_response(
        &webview,
        ipc_request(
            "set_usage_consent",
            serde_json::json!({ "consent": "declined" }),
        ),
    );
    let body: Value = response
        .expect("set_usage_consent should run")
        .deserialize()
        .unwrap();
    let mut expected = serde_json::from_str::<Value>(RESULT_FIXTURE).unwrap()["saved"].clone();
    expected["usage"]["available"] = Value::Bool(sharing_available());
    assert_eq!(body, expected);
    assert_eq!(backend.usage_settings(), (UsageConsent::Declined, None));

    let tracked = tauri::test::get_ipc_response(
        &webview,
        ipc_request(
            "track_usage",
            serde_json::json!({ "event": { "name": "tag_edit" } }),
        ),
    );
    assert!(tracked.is_ok());
    let rejected = tauri::test::get_ipc_response(
        &webview,
        ipc_request(
            "track_usage",
            serde_json::json!({ "event": { "name": "tag_edit", "path": "/secret" } }),
        ),
    );
    assert!(rejected.is_err());
}

struct Harness {
    _dir: tempfile::TempDir,
    settings: PathBuf,
    backend: BackendState,
    usage: UsageCore<FakePlatform>,
    sent: mpsc::Receiver<Value>,
    /// Taken at setup: reading it later through the backend would need the
    /// backend lock, which some tests deliberately hold.
    stop_flag: Arc<AtomicBool>,
}

const STORED: &str = "3f2b8c1e-5d4a-4b6f-9e2d-1a7c0b9e8f61";

fn harness(consent: &str) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let settings = dir.path().join("settings.json");
    let fields = match consent {
        "granted" => format!(r#","usageConsent":"granted","usageClientId":"{STORED}""#),
        "declined" => r#","usageConsent":"declined""#.to_string(),
        _ => String::new(),
    };
    std::fs::write(
        &settings,
        format!(r#"{{"version":1,"libraries":[],"activeLibraryId":null{fields}}}"#),
    )
    .unwrap();
    let backend = BackendState::load(settings.clone()).unwrap();
    let stop_flag = backend.usage_stop_flag();
    let (platform, sent) = FakePlatform::new();
    let usage = UsageCore::new(
        platform,
        Some(ENDPOINT.to_string()),
        fixture_context(),
        Arc::clone(&stop_flag),
    );
    let (stored, id) = backend.usage_settings();
    usage.restore(stored, id);
    let harness = Harness {
        _dir: dir,
        settings,
        backend,
        usage,
        sent,
        stop_flag,
    };
    if consent == "granted" {
        assert_eq!(sent_name(&expect_sent(&harness.sent)), "app_open");
    }
    harness
}

impl Harness {
    /// Runs the command on another thread so a blocking regression fails
    /// the test instead of hanging it.
    fn call(&self, consent: UsageConsent) -> ConsentResult {
        let backend = self.backend.clone();
        let usage = self.usage.clone();
        let (done, result) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = done.send(set_usage_consent_with(&backend, &usage, consent));
        });
        result
            .recv_timeout(Duration::from_secs(2))
            .expect("set_usage_consent must return promptly")
    }

    fn break_settings_writes(&self) {
        std::fs::remove_file(&self.settings).unwrap();
        std::fs::create_dir(&self.settings).unwrap();
    }

    fn stopped(&self) -> bool {
        self.stop_flag.load(Ordering::SeqCst)
    }

    fn summary(&self) -> UsageSummary {
        self.backend.current_state().unwrap().usage
    }
}

fn saved_as(consent: UsageConsent) -> ConsentResult {
    ConsentResult::saved(UsageSummary {
        available: sharing_available(),
        consent,
        saved: true,
    })
}

fn not_saved(reason: NotSavedReason) -> ConsentResult {
    ConsentResult::stopped_not_saved(reason, sharing_available())
}

fn summary(consent: UsageConsent, saved: bool) -> UsageSummary {
    UsageSummary {
        available: sharing_available(),
        consent,
        saved,
    }
}

#[test]
fn with_the_lock_held_every_branch_returns_promptly() {
    let sharing = harness("granted");
    let hold = sharing.backend.hold_lock_for_test();
    assert_eq!(
        sharing.call(UsageConsent::Declined),
        not_saved(NotSavedReason::Busy)
    );
    assert_eq!(
        sharing.call(UsageConsent::Declined),
        not_saved(NotSavedReason::Busy)
    );
    assert_eq!(sharing.call(UsageConsent::Granted), ConsentResult::busy());
    assert!(sharing.stopped());
    sharing.usage.record(&tag_edit());
    expect_quiet(&sharing.sent);
    drop(hold);
    assert_eq!(sharing.summary(), summary(UsageConsent::Declined, false));

    let undecided = harness("undecided");
    let hold = undecided.backend.hold_lock_for_test();
    assert_eq!(
        undecided.call(UsageConsent::Declined),
        ConsentResult::busy()
    );
    assert_eq!(undecided.call(UsageConsent::Granted), ConsentResult::busy());
    drop(hold);
    assert_eq!(undecided.summary(), summary(UsageConsent::Undecided, true));

    let declined = harness("declined");
    let hold = declined.backend.hold_lock_for_test();
    assert_eq!(declined.call(UsageConsent::Declined), ConsentResult::busy());
    drop(hold);
    expect_quiet(&undecided.sent);
    expect_quiet(&declined.sent);
}

#[test]
fn a_retried_opt_out_saves_once_the_lock_is_free() {
    let h = harness("granted");
    let hold = h.backend.hold_lock_for_test();
    assert_eq!(
        h.call(UsageConsent::Declined),
        not_saved(NotSavedReason::Busy)
    );
    drop(hold);
    assert_eq!(
        h.call(UsageConsent::Declined),
        saved_as(UsageConsent::Declined)
    );
    assert!(!h.stopped());
    assert_eq!(h.usage.consent(), UsageConsent::Declined);
    let json: Value = serde_json::from_slice(&std::fs::read(&h.settings).unwrap()).unwrap();
    assert_eq!(json["usageConsent"], "declined");
    assert!(json.get("usageClientId").is_none());
    assert_eq!(h.summary(), summary(UsageConsent::Declined, true));
    h.usage.record(&tag_edit());
    expect_quiet(&h.sent);
}

#[test]
fn failed_writes_report_failure_without_usage_and_send_nothing() {
    let sharing = harness("granted");
    sharing.break_settings_writes();
    assert_eq!(
        sharing.call(UsageConsent::Declined),
        not_saved(NotSavedReason::Failed)
    );
    assert_eq!(
        sharing.call(UsageConsent::Declined),
        not_saved(NotSavedReason::Failed)
    );
    assert!(sharing.stopped());
    sharing.usage.record(&tag_edit());
    expect_quiet(&sharing.sent);
    assert_eq!(sharing.summary(), summary(UsageConsent::Declined, false));

    let undecided = harness("undecided");
    undecided.break_settings_writes();
    let result = undecided.call(UsageConsent::Declined);
    assert_eq!(result, ConsentResult::failed());
    assert!(result.usage.is_none());
    assert_eq!(undecided.summary(), summary(UsageConsent::Undecided, true));
}

#[test]
fn turning_sharing_on_after_a_decline_sends_one_app_open_with_a_new_id() {
    let h = harness("undecided");
    assert_eq!(
        h.call(UsageConsent::Declined),
        saved_as(UsageConsent::Declined)
    );
    expect_quiet(&h.sent);
    assert_eq!(
        h.call(UsageConsent::Granted),
        saved_as(UsageConsent::Granted)
    );
    let open = expect_sent(&h.sent);
    assert_eq!(sent_name(&open), "app_open");
    let (stored, id) = h.backend.usage_settings();
    assert_eq!(stored, UsageConsent::Granted);
    assert_eq!(open["client_id"], id.unwrap().as_str());
    expect_quiet(&h.sent);
}

#[test]
fn a_failed_or_busy_opt_in_changes_nothing_from_any_state() {
    for start in ["undecided", "declined"] {
        let h = harness(start);
        let before = h.summary();
        h.break_settings_writes();
        let result = h.call(UsageConsent::Granted);
        assert_eq!(result, ConsentResult::failed(), "{start}");
        assert!(result.usage.is_none());
        assert!(!h.stopped());
        expect_quiet(&h.sent);
        assert_eq!(h.summary(), before, "{start}");
        assert_eq!(h.usage.consent(), before.consent, "{start}");
    }

    let h = harness("granted");
    let hold = h.backend.hold_lock_for_test();
    assert_eq!(
        h.call(UsageConsent::Declined),
        not_saved(NotSavedReason::Busy)
    );
    let result = h.call(UsageConsent::Granted);
    assert_eq!(result, ConsentResult::busy());
    assert!(result.usage.is_none());
    drop(hold);
    assert!(h.stopped());
    expect_quiet(&h.sent);
    assert_eq!(h.summary(), summary(UsageConsent::Declined, false));

    h.break_settings_writes();
    assert_eq!(h.call(UsageConsent::Granted), ConsentResult::failed());
    assert!(h.stopped());
    expect_quiet(&h.sent);
    assert_eq!(h.summary(), summary(UsageConsent::Declined, false));
}

#[test]
fn opting_back_in_after_a_real_stop_reports_granted_and_saved() {
    let h = harness("granted");
    let hold = h.backend.hold_lock_for_test();
    assert_eq!(
        h.call(UsageConsent::Declined),
        not_saved(NotSavedReason::Busy)
    );
    drop(hold);
    assert_eq!(
        h.call(UsageConsent::Granted),
        saved_as(UsageConsent::Granted)
    );
    assert!(!h.stopped());
    let open = expect_sent(&h.sent);
    assert_eq!(sent_name(&open), "app_open");
    assert_ne!(open["client_id"], STORED);
    assert_eq!(h.summary(), summary(UsageConsent::Granted, true));

    let h = harness("undecided");
    assert_eq!(
        h.call(UsageConsent::Granted),
        saved_as(UsageConsent::Granted)
    );
    let first = expect_sent(&h.sent);
    assert_eq!(
        h.call(UsageConsent::Declined),
        saved_as(UsageConsent::Declined)
    );
    assert_eq!(
        h.call(UsageConsent::Granted),
        saved_as(UsageConsent::Granted)
    );
    let second = expect_sent(&h.sent);
    assert_ne!(first["client_id"], second["client_id"]);
    assert_eq!(h.summary(), summary(UsageConsent::Granted, true));
    assert_eq!(
        h.call(UsageConsent::Granted),
        saved_as(UsageConsent::Granted)
    );
    expect_quiet(&h.sent);
}

// ---- T19 review fixes ----

/// K2: a request already being sent (here: held at the send gate, after the
/// client was cached) must not complete after the user opts out.
fn send_held_in_progress() -> (
    UsageCore<FakePlatform>,
    mpsc::Receiver<Value>,
    mpsc::Sender<()>,
) {
    let (core, sent, _) = fake_core(Some(ENDPOINT));
    core.start(ID_A.to_string());
    assert_eq!(sent_name(&expect_sent(&sent)), "app_open");
    wait_until(|| core.in_flight() == 0);
    let release = core.shared.platform.gate_sends();
    core.record(&tag_edit());
    wait_until(|| core.shared.platform.send_attempts.load(Ordering::SeqCst) == 2);
    assert_eq!(core.in_flight(), 1);
    (core, sent, release)
}

#[test]
fn stop_aborts_a_send_already_in_progress() {
    let (core, sent, release) = send_held_in_progress();
    core.stop();
    wait_until(|| core.in_flight() == 0);
    release.send(()).unwrap();
    expect_quiet(&sent);
}

#[test]
fn a_saved_decline_aborts_a_send_already_in_progress() {
    let (core, sent, release) = send_held_in_progress();
    core.mark_declined();
    wait_until(|| core.in_flight() == 0);
    release.send(()).unwrap();
    expect_quiet(&sent);
}

/// S7/K10: the Worker accepts only x.y.z versions, so a prerelease version
/// would make every event a 400.
#[test]
fn app_version_matches_the_workers_version_pattern() {
    let version = env!("CARGO_PKG_VERSION");
    let parts: Vec<&str> = version.split('.').collect();
    assert_eq!(parts.len(), 3, "{version}");
    assert!(
        parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit())),
        "{version}"
    );
}
