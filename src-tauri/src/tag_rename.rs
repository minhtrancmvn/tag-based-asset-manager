//! Tag rename mapping domain: name normalization and exact/prefix tag mapping.
//!
//! Rust is authoritative for these semantics; the shared fixture
//! `fixtures/tag-rename-mappings.json` is checked by both languages. Query
//! rewriting lives only in TypeScript and must not be added here.

use super::{
    approved_edit_root, metadata_display_path, path_string, persist, record_edit_snapshot,
    reject_reparse_or_symlink, scan_tree_cancellable, validate_inside_root, AppError, Asset,
    BackendState, CommandResult, Inner, SavedSearch, ScanIssue, ScanProgress, ScanResult,
    SearchFilters,
};
use crate::manifest;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, State};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenameMode {
    Exact,
    Prefix,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameMapping {
    pub mode: RenameMode,
    pub source: String,
    pub destination: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MappingError {
    EmptySource,
    EmptyDestination,
    Unchanged,
    MultiSegmentPrefix,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntryMapping {
    pub target: bool,
    pub output: Vec<String>,
    pub duplicates_collapsed: usize,
}

/// Trims Unicode White_Space (`str::trim`, which keeps U+FEFF) then lowercases.
pub fn normalize_name(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn normalize_side(mode: RenameMode, raw: &str) -> String {
    let name = normalize_name(raw);
    match mode {
        RenameMode::Exact => name,
        RenameMode::Prefix => match name.strip_suffix(':') {
            Some(stripped) => stripped.to_string(),
            None => name,
        },
    }
}

pub fn normalize_mapping(
    mode: RenameMode,
    source: &str,
    destination: &str,
) -> Result<RenameMapping, MappingError> {
    let source = normalize_side(mode, source);
    let destination = normalize_side(mode, destination);
    if source.is_empty() {
        return Err(MappingError::EmptySource);
    }
    if destination.is_empty() {
        return Err(MappingError::EmptyDestination);
    }
    if mode == RenameMode::Prefix && (source.contains(':') || destination.contains(':')) {
        return Err(MappingError::MultiSegmentPrefix);
    }
    if source == destination {
        return Err(MappingError::Unchanged);
    }
    Ok(RenameMapping {
        mode,
        source,
        destination,
    })
}

/// Maps one already-normalized tag, or returns `None` when it does not match.
pub fn map_tag(normalized_tag: &str, mapping: &RenameMapping) -> Option<String> {
    match mapping.mode {
        RenameMode::Exact => {
            (normalized_tag == mapping.source).then(|| mapping.destination.clone())
        }
        RenameMode::Prefix => normalized_tag
            .strip_prefix(mapping.source.as_str())
            .and_then(|rest| rest.strip_prefix(':'))
            .map(|suffix| format!("{}:{suffix}", mapping.destination)),
    }
}

/// Applies a mapping to one manifest entry's tags. Targets get
/// `manifest::normalize_tags` output; non-targets return the input untouched.
pub fn map_entry_tags(tags: &[String], mapping: &RenameMapping) -> EntryMapping {
    let normalized: Vec<String> = tags.iter().map(|tag| normalize_name(tag)).collect();
    let mapped: Vec<Option<String>> = normalized.iter().map(|tag| map_tag(tag, mapping)).collect();
    if mapped.iter().all(Option::is_none) {
        return EntryMapping {
            target: false,
            output: tags.to_vec(),
            duplicates_collapsed: 0,
        };
    }
    let distinct_inputs = normalized
        .iter()
        .filter(|tag| !tag.is_empty())
        .collect::<HashSet<_>>()
        .len();
    let output = manifest::normalize_tags(
        normalized
            .iter()
            .zip(mapped)
            .map(|(original, mapped)| mapped.unwrap_or_else(|| original.clone())),
    );
    let duplicates_collapsed = distinct_inputs.saturating_sub(output.len());
    EntryMapping {
        target: true,
        output,
        duplicates_collapsed,
    }
}

// ---------------------------------------------------------------------------
// Native-owned preview and settings-retry state.
//
// `RenameState` lives inside `backend::Inner` and is only ever touched while
// the backend mutex is held, so none of its methods lock. Pending previews and
// retry proofs never cross the IPC boundary; the client only holds an opaque
// preview ID.
// ---------------------------------------------------------------------------

/// One target row bound into a preview: identity, revision and owning sidecar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BoundTarget {
    pub asset_id: String,
    pub relative_path: String,
    pub kind: String,
    /// Metadata revision the preview observed for this row.
    pub revision: String,
    /// Canonical directory whose `.asset-tags.json` owns this row.
    pub owner_dir: PathBuf,
    /// Owner directory relative to the library root (`.` for the root).
    pub sidecar_owner: String,
    /// Tags this row loses to the merge (destination already on the row).
    pub duplicates_collapsed: usize,
}

impl BoundTarget {
    pub fn summary(&self) -> RenameTargetSummary {
        RenameTargetSummary {
            asset_id: self.asset_id.clone(),
            relative_path: self.relative_path.clone(),
            kind: self.kind.clone(),
            sidecar_owner: self.sidecar_owner.clone(),
            duplicates_collapsed: self.duplicates_collapsed,
        }
    }
}

/// Everything apply must revalidate. Plain data; never serialized to the client.
#[derive(Clone, Debug)]
pub struct PendingPreview {
    pub preview_id: String,
    pub library_id: String,
    pub scan_id: String,
    pub root: PathBuf,
    pub mapping: RenameMapping,
    /// Mutation generation the preview data was observed at.
    pub generation: u64,
    /// Exact ordered targets (group order = write order).
    pub targets: Vec<BoundTarget>,
    /// Owning-sidecar source bytes by owner directory; `None` = no manifest.
    pub sources: BTreeMap<PathBuf, Option<Vec<u8>>>,
    pub skipped: Vec<RenameSkippedRow>,
    pub uninspectable: Vec<ScanIssue>,
    /// Frontend-computed replacements, validated by native before binding.
    pub replacements: Vec<SavedSearchReplacement>,
    /// True when this preview is an authorized settings-only retry.
    pub settings_retry: bool,
}

impl PendingPreview {
    /// A preview with a fresh opaque ID and empty target data, bound at `generation`.
    pub fn new(
        library_id: impl Into<String>,
        root: PathBuf,
        mapping: RenameMapping,
        generation: u64,
    ) -> Self {
        Self {
            preview_id: Uuid::new_v4().to_string(),
            library_id: library_id.into(),
            scan_id: String::new(),
            root,
            mapping,
            generation,
            targets: Vec::new(),
            sources: BTreeMap::new(),
            skipped: Vec::new(),
            uninspectable: Vec::new(),
            replacements: Vec::new(),
            settings_retry: false,
        }
    }
}

/// A committed row identity and the revision it was committed at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommittedRow {
    pub asset_id: String,
    pub revision: String,
}

/// In-memory proof that sidecars committed but settings persistence failed.
/// Not durable: it does not survive a restart.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetryProof {
    pub library_id: String,
    pub root: PathBuf,
    pub mapping: RenameMapping,
    pub committed: Vec<CommittedRow>,
    /// Bound replacements with their unchanged expected filters.
    pub replacements: Vec<SavedSearchReplacement>,
}

#[derive(Debug, Clone)]
struct ActivePreviewScan {
    token: u64,
    cancellation: Arc<AtomicBool>,
}

/// Preview and retry state, one monotonic mutation counter.
#[derive(Debug, Default)]
pub struct RenameState {
    generation: u64,
    previews: HashMap<String, PendingPreview>,
    retry_proofs: HashMap<String, RetryProof>,
    in_flight: HashMap<String, ActivePreviewScan>,
    next_in_flight_token: u64,
}

impl RenameState {
    pub fn current_generation(&self) -> u64 {
        self.generation
    }

    /// Conservative cross-library invalidation: bumps the generation and drops
    /// every pending preview. Retry proofs are kept.
    pub fn note_mutation(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.previews.clear();
    }

    /// Library removal: invalidate previews and drop that library's retry proof.
    pub fn note_library_removed(&mut self, library_id: &str) {
        self.note_mutation();
        self.retry_proofs.remove(library_id);
    }

    /// Starts tracking an in-flight preview scan for `library_id`.
    ///
    /// Invalidates any earlier ready preview for this library, cancels any
    /// prior in-flight preview for the same library, and returns a unique
    /// in-flight token.
    pub(crate) fn begin_preview_scan(
        &mut self,
        library_id: &str,
        cancellation: Arc<AtomicBool>,
    ) -> u64 {
        self.previews.remove(library_id);
        if let Some(prior) = self.in_flight.remove(library_id) {
            prior.cancellation.store(true, Ordering::Relaxed);
        }
        let token = self.next_in_flight_token;
        self.next_in_flight_token = self.next_in_flight_token.wrapping_add(1);
        self.in_flight.insert(
            library_id.to_string(),
            ActivePreviewScan {
                token,
                cancellation,
            },
        );
        token
    }

    /// Cleans up in-flight tracking if `token` is still the active one for this library.
    pub(crate) fn finish_preview_scan(&mut self, library_id: &str, token: u64) {
        if self
            .in_flight
            .get(library_id)
            .is_some_and(|active| active.token == token)
        {
            self.in_flight.remove(library_id);
        }
    }

    /// Checks whether `token` is still the current active scan for this library.
    pub(crate) fn is_in_flight_current(&self, library_id: &str, token: u64) -> bool {
        self.in_flight
            .get(library_id)
            .is_some_and(|active| active.token == token)
    }

    /// Binds `preview` as its library's only pending preview, superseding any
    /// earlier one, and returns its opaque ID.
    pub fn bind_preview(&mut self, preview: PendingPreview) -> String {
        let preview_id = preview.preview_id.clone();
        self.previews.insert(preview.library_id.clone(), preview);
        preview_id
    }

    /// Consumes the library's pending preview if `preview_id` matches and it was
    /// bound at the current generation. Unknown library and mismatched ID leave
    /// state unchanged. A preview bound at an older generation can never become
    /// valid again, so it is dropped along with the rejection.
    pub fn take_preview(
        &mut self,
        library_id: &str,
        preview_id: &str,
    ) -> Result<PendingPreview, AppError> {
        let Some(pending) = self.previews.remove(library_id) else {
            return Err(AppError::from(
                "No rename preview is pending for this library; preview again",
            ));
        };
        if pending.preview_id != preview_id {
            self.previews.insert(library_id.to_string(), pending);
            return Err(AppError::from(
                "This rename preview was replaced by a newer one; preview again",
            ));
        }
        if pending.generation != self.generation {
            return Err(AppError::from(
                "The library changed after this rename preview; preview again",
            ));
        }
        Ok(pending)
    }

    /// Stores (replacing) the library's settings-retry proof.
    pub fn store_retry_proof(&mut self, proof: RetryProof) {
        self.retry_proofs.insert(proof.library_id.clone(), proof);
    }

    pub fn retry_proof(&self, library_id: &str) -> Option<&RetryProof> {
        self.retry_proofs.get(library_id)
    }

    /// Consumes the library's retry proof when it belongs to `mapping`: the
    /// migration it was waiting for has completed. A proof for another mapping
    /// stays. Returns whether a proof was consumed.
    pub fn consume_retry_proof(&mut self, library_id: &str, mapping: &RenameMapping) -> bool {
        if self
            .retry_proofs
            .get(library_id)
            .is_some_and(|proof| &proof.mapping == mapping)
        {
            self.retry_proofs.remove(library_id);
            return true;
        }
        false
    }

    #[cfg(test)]
    pub fn has_pending_preview(&self, library_id: &str) -> bool {
        self.previews.contains_key(library_id)
    }
}

// ---------------------------------------------------------------------------
// IPC DTOs (camelCase JSON). Mirrored in TypeScript and pinned by
// `fixtures/tag-rename-dto.json`.
// ---------------------------------------------------------------------------

/// One saved-search rewrite computed by the TypeScript parser. Native checks it
/// against current settings and binds it into the preview.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedSearchReplacement {
    pub search_id: String,
    pub expected_filters: SearchFilters,
    pub filters: SearchFilters,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenamePreviewRequest {
    pub library_id: String,
    pub scan_id: String,
    pub mode: RenameMode,
    /// Raw names as typed; native normalizes them itself.
    pub source: String,
    pub destination: String,
    /// The client's normalization; native rejects the request if it differs.
    pub normalized_mapping: RenameMapping,
    pub saved_search_replacements: Vec<SavedSearchReplacement>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTargetSummary {
    pub asset_id: String,
    pub relative_path: String,
    pub kind: String,
    /// Owner directory relative to the library root (`.` for the root).
    pub sidecar_owner: String,
    /// Tags on this row that collapse into one because the destination is already present.
    pub duplicates_collapsed: usize,
}

/// A tag that already exists at the mapping's destination (prefix-mode merge).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameCollision {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkipReason {
    Missing,
    Blocked,
}

/// A known matching row that cannot be edited and is left unchanged.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSkippedRow {
    pub asset_id: String,
    pub relative_path: String,
    pub kind: String,
    pub reason: SkipReason,
    /// Scan issue text (for example a duplicate UUID) when one is available.
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePreview {
    pub preview_id: String,
    pub library_id: String,
    pub scan_id: String,
    pub mapping: RenameMapping,
    pub scan: ScanResult,
    pub targets: Vec<RenameTargetSummary>,
    pub file_count: usize,
    pub folder_count: usize,
    pub sidecar_count: usize,
    pub destination_exists: bool,
    pub collisions: Vec<RenameCollision>,
    pub duplicates_collapsed: usize,
    pub skipped: Vec<RenameSkippedRow>,
    pub uninspectable: Vec<ScanIssue>,
    pub saved_search_update_count: usize,
    pub settings_retry: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RenameOutcome {
    Complete,
    Partial,
    SettingsFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameApplyResult {
    pub preview_id: String,
    pub library_id: String,
    pub mapping: RenameMapping,
    pub committed: Vec<Asset>,
    pub failed: Vec<RenameTargetSummary>,
    pub unattempted: Vec<RenameTargetSummary>,
    pub failing_sidecar: Option<String>,
    pub skipped: Vec<RenameSkippedRow>,
    pub uninspectable: Vec<ScanIssue>,
    /// Committed saved-search state after the operation.
    pub saved_searches: Vec<SavedSearch>,
    pub error: Option<AppError>,
    pub outcome: RenameOutcome,
    /// True only when sidecars and settings both succeeded.
    pub query_migrated: bool,
}

/// Why a finished traversal was thrown away instead of published.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiscardReason {
    /// A conflicting native mutation happened during traversal.
    Mutation,
    /// The library was removed, or its approved root changed or vanished.
    LibraryChanged,
    /// A bound sidecar no longer matches the fresh scan.
    SidecarChanged,
}

/// Terminal state of one preview request. `Err(AppError)` is reserved for
/// failures with no preview to report.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum RenamePreviewOutcome {
    Ready {
        preview: Box<RenamePreview>,
    },
    /// Cancelled through `cancel_scan(libraryId, scanId)`.
    Cancelled,
    Discarded {
        reason: DiscardReason,
    },
}

// ---------------------------------------------------------------------------
// Preview: fresh, cancellable, read-only traversal.
// ---------------------------------------------------------------------------

/// Filesystem seam for sidecar access. The command uses [`FsPreviewEnv`]; tests
/// inject counting, failing or mutating variants.
pub(super) trait PreviewEnv {
    /// Cheap existence probe. It is not a sidecar read.
    fn sidecar_exists(&mut self, dir: &Path) -> bool;
    /// Reads and parses one directory's sidecar (exact bytes included).
    fn read_sidecar(&mut self, dir: &Path) -> manifest::ReadManifest;
    /// Runs once the scan is registered, before traversal starts.
    fn after_registered(&mut self) {}
}

pub(super) struct FsPreviewEnv;

impl PreviewEnv for FsPreviewEnv {
    fn sidecar_exists(&mut self, dir: &Path) -> bool {
        !matches!(
            std::fs::symlink_metadata(dir.join(manifest::MANIFEST_NAME)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound
        )
    }

    fn read_sidecar(&mut self, dir: &Path) -> manifest::ReadManifest {
        manifest::read(dir)
    }
}

/// RAII owner of a `scan_cancellations` entry (MP-5).
///
/// Deadlock rule: `Drop` takes the backend mutex, so a `ScanRegistration` must
/// always be declared BEFORE any `MutexGuard` in the same scope. Locals drop in
/// reverse declaration order, so the guard is then released before this runs.
/// A poisoned mutex (a panic while locked) is recovered, never propagated.
struct ScanRegistration {
    inner: Arc<Mutex<Inner>>,
    key: (String, String),
    flag: Arc<AtomicBool>,
    token: u64,
}

impl ScanRegistration {
    fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Relaxed)
    }
}

impl Drop for ScanRegistration {
    fn drop(&mut self) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Only remove our own entry: a later scan may have replaced the key.
        if inner
            .scan_cancellations
            .get(&self.key)
            .is_some_and(|current| Arc::ptr_eq(current, &self.flag))
        {
            inner.scan_cancellations.remove(&self.key);
        }
        inner.rename.finish_preview_scan(&self.key.0, self.token);
    }
}

fn mapping_error_message(error: MappingError) -> &'static str {
    match error {
        MappingError::EmptySource => "Rename source name is empty",
        MappingError::EmptyDestination => "Rename destination name is empty",
        MappingError::Unchanged => {
            "Rename source and destination are unchanged after normalization"
        }
        MappingError::MultiSegmentPrefix => {
            "A prefix rename takes one prefix segment without colons"
        }
    }
}

/// Native normalization of the raw names; the client's mapping must equal it
/// (CON2-2 / MP2-4).
fn checked_mapping(request: &RenamePreviewRequest) -> CommandResult<RenameMapping> {
    let native = normalize_mapping(request.mode, &request.source, &request.destination)
        .map_err(|error| AppError::from(mapping_error_message(error)))?;
    if native != request.normalized_mapping {
        return Err(AppError::from(
            "The rename mapping does not match native normalization; preview again",
        ));
    }
    Ok(native)
}

/// The one saved-search replacement check (CON2-3 / CON2-7), shared by
/// pre-publication preview and the apply-time recheck. Pure: reads settings
/// only, never calls `upsert_saved_search_domain`.
///
/// New filters need no further validation here: `SearchFilters` is
/// `deny_unknown_fields` with closed enums, which is the existing saved-search
/// validation. An empty set is valid.
pub(super) fn validate_saved_search_replacements(
    inner: &Inner,
    library_id: &str,
    replacements: &[SavedSearchReplacement],
) -> CommandResult<()> {
    let mut seen = HashSet::new();
    for replacement in replacements {
        if !seen.insert(replacement.search_id.as_str()) {
            return Err(AppError::from(
                "A saved search appears more than once in the rename replacements",
            ));
        }
        let search = inner
            .saved_searches
            .iter()
            .find(|search| search.id == replacement.search_id)
            .ok_or_else(|| AppError::from("Unknown saved search in the rename replacements"))?;
        if search.library_id != library_id {
            return Err(AppError::from(
                "A saved search in the rename replacements belongs to another library",
            ));
        }
        if search.filters != replacement.expected_filters {
            return Err(AppError::from(
                "A saved search changed since the rename request was built; preview again",
            ));
        }
        let expected = &replacement.expected_filters;
        let new = &replacement.filters;
        if new.view != expected.view
            || new.match_mode != expected.match_mode
            || new.kind != expected.kind
        {
            return Err(AppError::from(
                "Saved search replacements may change only the query",
            ));
        }
        if new.query == expected.query {
            return Err(AppError::from("A saved search replacement makes no change"));
        }
    }
    Ok(())
}

/// Everything validated and registered under the first lock.
struct StartedPreview {
    root: PathBuf,
    mapping: RenameMapping,
    start_generation: u64,
    settings_retry: bool,
    registration: ScanRegistration,
}

/// Validates the request and registers the scan. Writes nothing and, on any
/// error, leaves no state behind.
fn begin_preview(
    state: &BackendState,
    request: &RenamePreviewRequest,
) -> CommandResult<StartedPreview> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, &request.library_id)?;
    let mapping = checked_mapping(request)?;
    validate_saved_search_replacements(
        &inner,
        &request.library_id,
        &request.saved_search_replacements,
    )?;
    let settings_retry = inner
        .rename
        .retry_proof(&request.library_id)
        .is_some_and(|proof| proof.mapping == mapping);
    let start_generation = inner.rename.current_generation();
    let token = inner
        .rename
        .begin_preview_scan(&request.library_id, flag.clone());
    let key = (request.library_id.clone(), request.scan_id.clone());
    inner.scan_cancellations.insert(key.clone(), flag.clone());
    drop(inner);
    let registration = ScanRegistration {
        inner: state.inner.clone(),
        key,
        flag,
        token,
    };
    Ok(StartedPreview {
        root,
        mapping,
        start_generation,
        settings_retry,
        registration,
    })
}

/// The preview's sidecar state changed between scan and binding.
struct SidecarChanged;

struct BuiltPreview {
    targets: Vec<BoundTarget>,
    sources: BTreeMap<PathBuf, Option<Vec<u8>>>,
    skipped: Vec<RenameSkippedRow>,
    uninspectable: Vec<ScanIssue>,
    destination_exists: bool,
    collisions: Vec<RenameCollision>,
}

/// Each directory's sidecar is read at most once per preview (CON-2).
struct SidecarReads<'a> {
    root: &'a Path,
    env: &'a mut dyn PreviewEnv,
    canonical: HashMap<PathBuf, PathBuf>,
    manifests: BTreeMap<PathBuf, manifest::ReadManifest>,
}

impl<'a> SidecarReads<'a> {
    fn new(root: &'a Path, env: &'a mut dyn PreviewEnv) -> Self {
        Self {
            root,
            env,
            canonical: HashMap::new(),
            manifests: BTreeMap::new(),
        }
    }

    /// Canonical directory inside the approved root, as `prepare_tag_target`
    /// requires of every owner directory.
    fn dir(&mut self, dir: &Path) -> Result<PathBuf, SidecarChanged> {
        if let Some(canonical) = self.canonical.get(dir) {
            return Ok(canonical.clone());
        }
        let canonical = std::fs::canonicalize(dir).map_err(|_| SidecarChanged)?;
        if !canonical.starts_with(self.root) {
            return Err(SidecarChanged);
        }
        validate_inside_root(self.root, &canonical).map_err(|_| SidecarChanged)?;
        self.canonical.insert(dir.to_path_buf(), canonical.clone());
        Ok(canonical)
    }

    fn manifest(&mut self, dir: &Path) -> &manifest::ReadManifest {
        if !self.manifests.contains_key(dir) {
            let read = if self.env.sidecar_exists(dir) {
                self.env.read_sidecar(dir)
            } else {
                manifest::ReadManifest::Missing
            };
            self.manifests.insert(dir.to_path_buf(), read);
        }
        &self.manifests[dir]
    }

    fn has_key(&mut self, dir: &Path, key: &str) -> bool {
        matches!(
            self.manifest(dir),
            manifest::ReadManifest::Valid { manifest, .. } if manifest.items.contains_key(key)
        )
    }

    /// Owner directory and entry key, by the same rules as `prepare_tag_target`:
    /// a file belongs to its parent's manifest; the root to its own `.`; a
    /// folder to its own `.` entry, or to the legacy entry its parent holds
    /// when no self entry exists. Both present is a conflict (blocked at scan,
    /// so seeing it here means the tree changed).
    ///
    /// Existence probes pick the owner without reading a non-owning manifest
    /// unless both candidates exist, so reads equal owners in the usual cases.
    fn owner(&mut self, asset: &Asset) -> Result<(PathBuf, String), SidecarChanged> {
        self.owner_of(&asset.relative_path, &asset.kind)
    }

    /// [`Self::owner`] for a row known only by relative path and kind (apply
    /// rechecks bound targets, which are not scan assets).
    fn owner_of(
        &mut self,
        relative: &str,
        kind: &str,
    ) -> Result<(PathBuf, String), SidecarChanged> {
        if relative == "." {
            return Ok((self.dir(self.root)?, ".".into()));
        }
        let path = self.root.join(relative);
        let parent = path.parent().ok_or(SidecarChanged)?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(SidecarChanged)?
            .to_string();
        manifest::validate_key(&name).map_err(|_| SidecarChanged)?;
        let parent_dir = self.dir(parent)?;
        if kind != "folder" {
            return Ok((parent_dir, name));
        }
        let own_dir = self.dir(&path)?;
        let parent_exists = self.env.sidecar_exists(&parent_dir);
        let own_exists = self.env.sidecar_exists(&own_dir);
        let legacy = match (parent_exists, own_exists) {
            (false, false) => return Err(SidecarChanged),
            (true, false) => true,
            (false, true) => false,
            (true, true) => {
                let parent_has = self.has_key(&parent_dir, &name);
                let own_has = self.has_key(&own_dir, ".");
                if parent_has && own_has {
                    return Err(SidecarChanged);
                }
                parent_has
            }
        };
        Ok(if legacy {
            (parent_dir, name)
        } else {
            (own_dir, ".".into())
        })
    }

    /// Binds one editable target row to its owner, entry and revision. The
    /// revision is recomputed from the freshly read entry and must equal the
    /// scan's, otherwise the sidecar changed under the preview.
    fn bind(
        &mut self,
        asset: &Asset,
        duplicates_collapsed: usize,
    ) -> Result<BoundTarget, SidecarChanged> {
        let (owner_dir, key) = self.owner(asset)?;
        let entry = match self.manifest(&owner_dir) {
            manifest::ReadManifest::Valid { manifest, .. } => {
                manifest.items.get(&key).cloned().ok_or(SidecarChanged)?
            }
            _ => return Err(SidecarChanged),
        };
        if let manifest::ReadManifest::Valid { manifest, .. } = self.manifest(&owner_dir) {
            let id = Uuid::parse_str(&entry.id).map_err(|_| SidecarChanged)?;
            let shared = manifest
                .items
                .values()
                .filter(|other| Uuid::parse_str(&other.id).ok() == Some(id))
                .count();
            if shared > 1 {
                return Err(SidecarChanged);
            }
        }
        let sidecar_owner =
            path_string(owner_dir.strip_prefix(self.root).unwrap_or(Path::new(".")))
                .filter(|owner| !owner.is_empty())
                .unwrap_or_else(|| ".".into());
        let revision = manifest::metadata_revision(
            Some(&entry),
            &key,
            if asset.kind == "folder" {
                "folder"
            } else {
                "file"
            },
            &sidecar_owner,
            "valid",
        );
        if revision != asset.metadata_revision {
            return Err(SidecarChanged);
        }
        Ok(BoundTarget {
            asset_id: asset.id.clone(),
            relative_path: asset.relative_path.clone(),
            kind: asset.kind.clone(),
            revision,
            owner_dir,
            sidecar_owner,
            duplicates_collapsed,
        })
    }
}

/// Scan issue text describing why a known-match row cannot be edited.
fn skip_message(asset: &Asset, reason: SkipReason, issues: &[ScanIssue]) -> Option<String> {
    let wanted = match reason {
        SkipReason::Missing => "Metadata reference is missing",
        SkipReason::Blocked => "Duplicate metadata UUID",
    };
    let relative = Path::new(&asset.relative_path);
    let directory = relative
        .parent()
        .and_then(path_string)
        .filter(|directory| !directory.is_empty())
        .unwrap_or_else(|| ".".into());
    let key = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let display = metadata_display_path(&directory, key);
    let by_path = issues
        .iter()
        .find(|issue| issue.message == wanted && issue.path == display);
    match (by_path, reason) {
        (Some(issue), _) => Some(issue.message.clone()),
        // A duplicate issue names only one location of the shared UUID, and a
        // blocked row that still carries an ID can only be a duplicate.
        (None, SkipReason::Blocked) if asset.metadata_id.is_some() => Some(wanted.into()),
        _ => None,
    }
}

/// Scan issues whose tags cannot be read at all: they are never counted as matches.
fn uninspectable_issues(issues: &[ScanIssue]) -> Vec<ScanIssue> {
    let mut listed: Vec<ScanIssue> = issues
        .iter()
        .filter(|issue| {
            matches!(
                issue.message.as_str(),
                "Metadata manifest is blocked" | "Conflicting folder metadata ownership"
            )
        })
        .cloned()
        .collect();
    listed.sort_by(|a, b| (&a.path, &a.message).cmp(&(&b.path, &b.message)));
    listed
}

fn build_preview_data(
    root: &Path,
    result: &ScanResult,
    mapping: &RenameMapping,
    env: &mut dyn PreviewEnv,
) -> Result<BuiltPreview, SidecarChanged> {
    let library_tags: HashSet<&str> = result
        .assets
        .iter()
        .flat_map(|asset| asset.tags.iter().map(String::as_str))
        .collect();
    let destination_exists = match mapping.mode {
        RenameMode::Exact => library_tags.contains(mapping.destination.as_str()),
        RenameMode::Prefix => {
            let prefix = format!("{}:", mapping.destination);
            library_tags.iter().any(|tag| tag.starts_with(&prefix))
        }
    };
    let mut reads = SidecarReads::new(root, env);
    let mut targets = Vec::new();
    let mut skipped = Vec::new();
    let mut renamed: BTreeMap<String, String> = BTreeMap::new();
    for asset in &result.assets {
        let entry = map_entry_tags(&asset.tags, mapping);
        if !entry.target {
            continue;
        }
        if asset.status == "missing" || asset.metadata_state == "blocked" {
            let reason = if asset.status == "missing" {
                SkipReason::Missing
            } else {
                SkipReason::Blocked
            };
            skipped.push(RenameSkippedRow {
                asset_id: asset.id.clone(),
                relative_path: asset.relative_path.clone(),
                kind: asset.kind.clone(),
                reason,
                message: skip_message(asset, reason, &result.issues),
            });
            continue;
        }
        targets.push(reads.bind(asset, entry.duplicates_collapsed)?);
        for tag in &asset.tags {
            if let Some(to) = map_tag(tag, mapping) {
                renamed.insert(tag.clone(), to);
            }
        }
    }
    targets.sort_by(|a, b| (&a.owner_dir, &a.relative_path).cmp(&(&b.owner_dir, &b.relative_path)));
    skipped.sort_by(|a, b| (&a.relative_path, &a.asset_id).cmp(&(&b.relative_path, &b.asset_id)));
    let mut sources = BTreeMap::new();
    for target in &targets {
        if !sources.contains_key(&target.owner_dir) {
            let bytes = match reads.manifest(&target.owner_dir) {
                manifest::ReadManifest::Valid { bytes, .. } => Some(bytes.clone()),
                // `bind` already rejected non-Valid owners; `None` stays in the
                // map type for T8, which also tracks absent manifests.
                manifest::ReadManifest::Missing => None,
                manifest::ReadManifest::Blocked { .. } => return Err(SidecarChanged),
            };
            sources.insert(target.owner_dir.clone(), bytes);
        }
    }
    let collisions = renamed
        .into_iter()
        .filter(|(_, to)| library_tags.contains(to.as_str()))
        .map(|(from, to)| RenameCollision { from, to })
        .collect();
    Ok(BuiltPreview {
        targets,
        sources,
        skipped,
        uninspectable: uninspectable_issues(&result.issues),
        destination_exists,
        collisions,
    })
}

/// Fresh read-only preview. Phases:
///
/// 1. Under the lock: validate the request, register the scan, record the
///    starting generation. Any error returns with no state change.
/// 2. Lock released: cancellable traversal. Persists nothing.
/// 3. Lock reacquired: recheck cancellation, library/root and generation, then
///    revalidate replacements, read each owning sidecar once, publish the
///    snapshot (memory only), invalidate older previews and bind the new one at
///    the now-current generation.
///
/// The registration guard is the first local that outlives both lock scopes, so
/// it is dropped after the guard of phase 3 on every path, panics included.
pub(super) fn preview_tag_rename_domain(
    state: &BackendState,
    request: RenamePreviewRequest,
    mut on_progress: impl FnMut(ScanProgress),
    env: &mut dyn PreviewEnv,
) -> CommandResult<RenamePreviewOutcome> {
    let StartedPreview {
        root,
        mapping,
        start_generation,
        settings_retry,
        registration,
    } = begin_preview(state, &request)?;
    env.after_registered();

    let result = match scan_tree_cancellable(
        &root,
        &request.library_id,
        &request.scan_id,
        &mut on_progress,
        || registration.is_cancelled(),
    ) {
        Ok(result) => result,
        Err(error) if error == "SCAN_CANCELLED" => return Ok(RenamePreviewOutcome::Cancelled),
        Err(error) => return Err(AppError::scan(&root, error)),
    };

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    if registration.is_cancelled()
        || !inner
            .rename
            .is_in_flight_current(&request.library_id, registration.token)
    {
        return Ok(RenamePreviewOutcome::Cancelled);
    }
    if approved_edit_root(&inner, &request.library_id).map_or(true, |current| current != root) {
        return Ok(RenamePreviewOutcome::Discarded {
            reason: DiscardReason::LibraryChanged,
        });
    }
    if inner.rename.current_generation() != start_generation {
        return Ok(RenamePreviewOutcome::Discarded {
            reason: DiscardReason::Mutation,
        });
    }
    validate_saved_search_replacements(
        &inner,
        &request.library_id,
        &request.saved_search_replacements,
    )?;
    let Ok(built) = build_preview_data(&root, &result, &mapping, env) else {
        return Ok(RenamePreviewOutcome::Discarded {
            reason: DiscardReason::SidecarChanged,
        });
    };

    // Publish to app memory only, then invalidate every other preview; the new
    // one is bound afterwards so it is valid at the current generation.
    record_edit_snapshot(&mut inner, &root, &result);
    inner.rename.note_mutation();
    let generation = inner.rename.current_generation();

    let mut pending = PendingPreview::new(&request.library_id, root, mapping.clone(), generation);
    pending.scan_id = request.scan_id.clone();
    pending.targets = built.targets;
    pending.sources = built.sources;
    pending.skipped = built.skipped;
    pending.uninspectable = built.uninspectable;
    pending.replacements = request.saved_search_replacements;
    pending.settings_retry = settings_retry;

    let targets: Vec<RenameTargetSummary> =
        pending.targets.iter().map(BoundTarget::summary).collect();
    let preview = RenamePreview {
        preview_id: pending.preview_id.clone(),
        library_id: request.library_id,
        scan_id: request.scan_id,
        mapping,
        scan: result,
        file_count: targets
            .iter()
            .filter(|target| target.kind == "file")
            .count(),
        folder_count: targets
            .iter()
            .filter(|target| target.kind == "folder")
            .count(),
        sidecar_count: pending.sources.len(),
        destination_exists: built.destination_exists,
        collisions: built.collisions,
        duplicates_collapsed: targets
            .iter()
            .map(|target| target.duplicates_collapsed)
            .sum(),
        skipped: pending.skipped.clone(),
        uninspectable: pending.uninspectable.clone(),
        saved_search_update_count: pending.replacements.len(),
        settings_retry,
        targets,
    };
    inner.rename.bind_preview(pending);
    Ok(RenamePreviewOutcome::Ready {
        preview: Box::new(preview),
    })
}

#[tauri::command]
pub async fn preview_tag_rename(
    request: RenamePreviewRequest,
    on_progress: Channel<ScanProgress>,
    state: State<'_, BackendState>,
) -> CommandResult<RenamePreviewOutcome> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        preview_tag_rename_domain(
            &state,
            request,
            move |progress| {
                let _ = on_progress.send(progress);
            },
            &mut FsPreviewEnv,
        )
    })
    .await
    .map_err(|error| AppError::from(format!("Rename preview task failed: {error}")))?
}

// ---------------------------------------------------------------------------
// Apply preflight (T8): revision-bound grouped sidecar preparation.
//
// Consumes the library's pending preview, rechecks everything it bound and
// builds every changed sidecar document in memory. It performs no write and
// registers nothing, so there is no cleanup guard to hold: the commit stage
// (T9) takes the returned `PreparedRename` while it keeps the same backend
// mutex held. Any rejection leaves the preview consumed; the user previews
// again, as the design requires after every outcome.
// ---------------------------------------------------------------------------

/// A bound target and the asset DTO it will read as once its group commits.
#[derive(Clone, Debug)]
pub(super) struct PreparedRow {
    pub target: BoundTarget,
    /// Entry key inside the owning sidecar (`.` for a self entry). Only the
    /// ownership tests read it; the commit works from the serialized bytes.
    #[cfg(test)]
    pub key: String,
    /// Post-commit row: renamed tags and the revision a later tag edit expects.
    pub asset: Asset,
}

/// One owning sidecar, serialized in full and ready to be replaced once.
#[derive(Clone, Debug)]
pub(super) struct PreparedGroup {
    pub owner_dir: PathBuf,
    pub sidecar_path: PathBuf,
    /// Owner directory relative to the library root (`.` for the root).
    pub sidecar_owner: String,
    /// Exact bytes the replacement must still find on disk; `None` = no file.
    pub original: Option<Vec<u8>>,
    /// The complete new document.
    pub bytes: Vec<u8>,
    pub rows: Vec<PreparedRow>,
}

/// Everything the commit stage needs, all validated and serialized.
#[derive(Clone, Debug)]
pub(super) struct PreparedRename {
    pub preview_id: String,
    pub library_id: String,
    pub root: PathBuf,
    pub mapping: RenameMapping,
    /// Write order: ascending owner directory, matching the preview.
    pub groups: Vec<PreparedGroup>,
    pub skipped: Vec<RenameSkippedRow>,
    pub uninspectable: Vec<ScanIssue>,
    /// The preview-bound saved-search replacements, unchanged.
    pub replacements: Vec<SavedSearchReplacement>,
    /// True when no sidecar is written because a verified settings-retry
    /// proof stands in for the missing eligible targets.
    pub settings_only: bool,
}

fn stale_preview(what: &str) -> AppError {
    AppError::from(format!("{what}; preview again"))
}

/// A zero-target preview may proceed only on a verified in-memory proof: the
/// preview was made as a retry, the proof still names this root, mapping and
/// bound replacement set, and every row the original rename committed still
/// carries the revision it was committed at.
fn verified_settings_retry(
    inner: &Inner,
    library_id: &str,
    root: &Path,
    pending: &PendingPreview,
) -> bool {
    if !pending.settings_retry || pending.replacements.is_empty() {
        return false;
    }
    let Some(proof) = inner.rename.retry_proof(library_id) else {
        return false;
    };
    let Some(snapshot) = inner
        .scan_snapshots
        .get(library_id)
        .filter(|snapshot| snapshot.root == root)
    else {
        return false;
    };
    proof.library_id == library_id
        && proof.root == root
        && proof.mapping == pending.mapping
        && proof.replacements == pending.replacements
        && !proof.committed.is_empty()
        && proof.committed.iter().all(|row| {
            snapshot
                .assets
                .get(&row.asset_id)
                .is_some_and(|asset| asset.metadata_revision == row.revision)
        })
}

/// The target is still a regular, non-linked file or folder inside the root.
fn target_asset_present(root: &Path, target: &BoundTarget) -> bool {
    if target.relative_path == "." {
        return true;
    }
    let path = root.join(&target.relative_path);
    if validate_inside_root(root, &path).is_err() {
        return false;
    }
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if reject_reparse_or_symlink(&metadata).is_ok() => {
            if target.kind == "folder" {
                metadata.is_dir()
            } else {
                metadata.is_file()
            }
        }
        _ => false,
    }
}

/// Validates the preview against the live state and prepares every sidecar.
///
/// The caller holds the backend mutex (`inner` is the guarded state), which is
/// why this takes `&mut Inner` instead of locking: the commit stage must keep
/// the same lock to the end and cannot call the mutex-acquiring `mutate`.
///
/// Order: preview identity and generation, approved root, mapping
/// normalization, saved-search recheck, then either the verified retry proof
/// (no targets) or per-target ownership/revision, bound source bytes,
/// duplicate UUIDs and finally the serialized documents.
pub(super) fn prepare_tag_rename(
    inner: &mut Inner,
    library_id: &str,
    preview_id: &str,
    env: &mut dyn PreviewEnv,
) -> CommandResult<PreparedRename> {
    let pending = inner.rename.take_preview(library_id, preview_id)?;
    let inner: &Inner = inner;
    let root = approved_edit_root(inner, library_id)?;
    if root != pending.root {
        return Err(stale_preview(
            "The approved library root changed since the rename preview",
        ));
    }
    // CON2-2: the mapping the preview carries must still be its own native
    // normalization; the proof and the preview are compared against this one.
    let mapping = &pending.mapping;
    if normalize_mapping(mapping.mode, &mapping.source, &mapping.destination).as_ref()
        != Ok(mapping)
    {
        return Err(stale_preview(
            "The rename mapping does not match native normalization",
        ));
    }
    // CON2-7 / MP2-10: the single shared check, before any sidecar is touched.
    validate_saved_search_replacements(inner, library_id, &pending.replacements)?;

    let prepared = |groups: Vec<PreparedGroup>, settings_only: bool| PreparedRename {
        preview_id: pending.preview_id.clone(),
        library_id: pending.library_id.clone(),
        root: root.clone(),
        mapping: pending.mapping.clone(),
        groups,
        skipped: pending.skipped.clone(),
        uninspectable: pending.uninspectable.clone(),
        replacements: pending.replacements.clone(),
        settings_only,
    };
    if pending.targets.is_empty() {
        return if verified_settings_retry(inner, library_id, &root, &pending) {
            Ok(prepared(Vec::new(), true))
        } else {
            Err(stale_preview(
                "No editable rename targets and no verified settings retry",
            ))
        };
    }

    let targets_changed = || stale_preview("The rename targets changed since the preview");
    let ownership_changed = || stale_preview("Metadata ownership changed since the rename preview");
    let revision_changed = || stale_preview("Metadata revision changed since the rename preview");
    let bytes_changed = || stale_preview("Sidecar source bytes changed since the rename preview");

    let snapshot = inner
        .scan_snapshots
        .get(library_id)
        .filter(|snapshot| snapshot.root == root)
        .ok_or_else(targets_changed)?;
    let mut reads = SidecarReads::new(&root, env);

    // Pass 1: every target is still editable, present, owned where the preview
    // bound it, and at the bound revision.
    let mut by_owner: BTreeMap<PathBuf, Vec<(&BoundTarget, String)>> = BTreeMap::new();
    for target in &pending.targets {
        if !snapshot.editable_ids.contains(&target.asset_id)
            || !snapshot.assets.contains_key(&target.asset_id)
        {
            return Err(targets_changed());
        }
        if !target_asset_present(&root, target) {
            return Err(stale_preview(
                "A rename target is no longer available as a regular file or folder",
            ));
        }
        let (owner_dir, key) = reads
            .owner_of(&target.relative_path, &target.kind)
            .map_err(|SidecarChanged| ownership_changed())?;
        if owner_dir != target.owner_dir {
            return Err(ownership_changed());
        }
        let manifest::ReadManifest::Valid { manifest, .. } = reads.manifest(&owner_dir) else {
            return Err(bytes_changed());
        };
        let entry = manifest.items.get(&key).ok_or_else(revision_changed)?;
        let revision = manifest::metadata_revision(
            Some(entry),
            &key,
            if target.kind == "folder" {
                "folder"
            } else {
                "file"
            },
            &target.sidecar_owner,
            "valid",
        );
        if revision != target.revision {
            return Err(revision_changed());
        }
        by_owner.entry(owner_dir).or_default().push((target, key));
    }

    // Pass 2: the bound source bytes of exactly these sidecars are unchanged.
    if pending.sources.len() != by_owner.len() {
        return Err(bytes_changed());
    }
    for owner_dir in by_owner.keys() {
        let current = match reads.manifest(owner_dir) {
            manifest::ReadManifest::Valid { bytes, .. } => bytes.as_slice(),
            _ => return Err(bytes_changed()),
        };
        match pending.sources.get(owner_dir) {
            Some(Some(bound)) if bound.as_slice() == current => {}
            _ => return Err(bytes_changed()),
        }
    }

    // Pass 3: edit one in-memory manifest per owner. Targeted entries only;
    // `mutate_tags` keeps the UUID, notes, unknown fields and every other entry.
    let mut documents = Vec::with_capacity(by_owner.len());
    for (owner_dir, rows) in &by_owner {
        let manifest::ReadManifest::Valid {
            manifest: source,
            bytes: original,
        } = reads.manifest(owner_dir)
        else {
            return Err(bytes_changed());
        };
        let mut edited = source.clone();
        let original = original.clone();
        let mut prepared_rows = Vec::with_capacity(rows.len());
        for (target, key) in rows {
            let entry = edited.items.get(key).ok_or_else(revision_changed)?.clone();
            let mapped = map_entry_tags(&entry.tags, &pending.mapping);
            if !mapped.target {
                return Err(revision_changed());
            }
            let removes: Vec<String> = entry
                .tags
                .iter()
                .filter(|tag| map_tag(&normalize_name(tag), &pending.mapping).is_some())
                .cloned()
                .collect();
            let adds: Vec<String> = entry
                .tags
                .iter()
                .filter_map(|tag| map_tag(&normalize_name(tag), &pending.mapping))
                .collect();
            let (new_entry, changed) = manifest::mutate_tags(&mut edited, key, &adds, &removes);
            if !changed || new_entry.tags != mapped.output {
                return Err(revision_changed());
            }
            let mut asset = snapshot
                .assets
                .get(&target.asset_id)
                .ok_or_else(targets_changed)?
                .clone();
            asset.tags = new_entry.tags.clone();
            asset.status = if asset.tags.is_empty() {
                "untagged"
            } else {
                "ready"
            }
            .into();
            asset.notes = new_entry.notes.clone();
            asset.metadata_id = Some(new_entry.id.clone());
            asset.metadata_state = "valid".into();
            asset.metadata_revision = manifest::metadata_revision(
                Some(&new_entry),
                key,
                &asset.kind,
                &target.sidecar_owner,
                "valid",
            );
            prepared_rows.push(PreparedRow {
                target: (*target).clone(),
                #[cfg(test)]
                key: key.clone(),
                asset,
            });
        }
        documents.push((owner_dir.clone(), original, edited, prepared_rows));
    }

    // Duplicate-UUID guard across every grouped sidecar (as bulk edits do): a
    // target identity must occur exactly once among all entries in play.
    let mut locations: HashMap<Uuid, usize> = HashMap::new();
    for (_, _, edited, _) in &documents {
        for entry in edited.items.values() {
            let id = Uuid::parse_str(&entry.id).map_err(|_| revision_changed())?;
            *locations.entry(id).or_default() += 1;
        }
    }
    for (owner_dir, _, _, rows) in &documents {
        for row in rows {
            let id = row
                .asset
                .metadata_id
                .as_deref()
                .and_then(|id| Uuid::parse_str(id).ok())
                .ok_or_else(revision_changed)?;
            if locations.get(&id).copied().unwrap_or_default() > 1 {
                return Err(AppError::at_path(
                    "Duplicate metadata UUID; rescan before editing",
                    &owner_dir.join(manifest::MANIFEST_NAME),
                ));
            }
        }
    }

    // Serialize every group before returning: nothing can fail after the
    // first write for a serialization reason.
    let groups = documents
        .into_iter()
        .map(|(owner_dir, original, edited, rows)| {
            let sidecar_path = owner_dir.join(manifest::MANIFEST_NAME);
            let bytes = edited
                .serialize()
                .and_then(|bytes| manifest::Manifest::parse(&bytes).map(|_| bytes))
                .map_err(|error| AppError::at_path(error, &sidecar_path))?;
            let sidecar_owner = rows
                .first()
                .map(|row| row.target.sidecar_owner.clone())
                .unwrap_or_else(|| ".".into());
            Ok(PreparedGroup {
                owner_dir,
                sidecar_path,
                sidecar_owner,
                original: Some(original),
                bytes,
                rows,
            })
        })
        .collect::<CommandResult<Vec<_>>>()?;
    Ok(prepared(groups, false))
}

/// Locks the backend and runs [`prepare_tag_rename`].
///
/// `_writer` is the commit-stage seam, in the shape `bulk_edit_tags_with_writer`
/// uses. This preflight-only entry never calls it; tests inject a recording
/// writer to prove that on every path. The commit loop is
/// [`commit_prepared_rename`], which runs under the guard its caller holds.
///
/// Production applies through `apply_tag_rename_domain`, which holds one guard
/// across prepare, commit and settings, so this entry is test-only.
#[cfg(test)]
pub(super) fn preflight_tag_rename_apply(
    state: &BackendState,
    library_id: &str,
    preview_id: &str,
    env: &mut dyn PreviewEnv,
    _writer: impl FnMut(&Path, Option<&[u8]>, &[u8]) -> Result<(), String>,
) -> CommandResult<PreparedRename> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    prepare_tag_rename(&mut inner, library_id, preview_id, env)
}

// ---------------------------------------------------------------------------
// Sidecar commit (T9): sequential writes, exact partitions, snapshot revisions.
//
// Runs on the `PreparedRename` that `prepare_tag_rename` produced while the
// caller keeps the backend mutex held, so it takes `&mut Inner` and never locks
// (`BackendState::mutate` would deadlock here). It persists no settings: the
// settings stage (T11) runs under the same guard afterwards and finishes the
// result through [`SidecarCommit::into_apply_result`].
// ---------------------------------------------------------------------------

/// What the sidecar stage did: exact partitions of the preview's targets plus
/// the data the settings stage needs. Skipped and uninspectable rows are not in
/// any partition.
#[derive(Clone, Debug)]
pub(super) struct SidecarCommit {
    pub preview_id: String,
    pub library_id: String,
    pub root: PathBuf,
    pub mapping: RenameMapping,
    /// Post-commit rows of every committed group, in write order.
    pub committed: Vec<Asset>,
    /// Identity and committed revision of those rows (retry-proof material).
    pub committed_rows: Vec<CommittedRow>,
    /// Every row of the group whose write failed.
    pub failed: Vec<RenameTargetSummary>,
    /// Every row of every group after the failed one.
    pub unattempted: Vec<RenameTargetSummary>,
    /// The failing sidecar, relative to the library root.
    pub failing_sidecar: Option<String>,
    /// Set exactly when a sidecar write failed.
    pub error: Option<AppError>,
    pub skipped: Vec<RenameSkippedRow>,
    pub uninspectable: Vec<ScanIssue>,
    /// The preview-bound saved-search replacements, unchanged.
    pub replacements: Vec<SavedSearchReplacement>,
    /// True when the prepared rename had no sidecar groups (verified retry).
    pub settings_only: bool,
}

impl SidecarCommit {
    /// Every eligible sidecar was written. Only then may settings be touched.
    pub fn sidecars_complete(&self) -> bool {
        self.failed.is_empty() && self.unattempted.is_empty()
    }

    /// Builds the final result. Call it only once the settings stage has run
    /// (or been skipped because a sidecar failed): it does not persist anything.
    ///
    /// A sidecar failure is final: `Partial`, `query_migrated` false, and
    /// `settings_error` is ignored (settings must not have been written).
    /// Otherwise `settings_error` decides `SettingsFailed` vs `Complete`, and
    /// `Complete` holds even when no saved-search replacement was bound.
    /// `saved_searches` is the post-operation settings state; only the active
    /// library's entries are returned.
    pub fn into_apply_result(
        self,
        saved_searches: Vec<SavedSearch>,
        settings_error: Option<AppError>,
    ) -> RenameApplyResult {
        let (outcome, error, query_migrated) = if !self.sidecars_complete() {
            (RenameOutcome::Partial, self.error, false)
        } else if let Some(error) = settings_error {
            (RenameOutcome::SettingsFailed, Some(error), false)
        } else {
            (RenameOutcome::Complete, None, true)
        };
        RenameApplyResult {
            preview_id: self.preview_id,
            saved_searches: saved_searches
                .into_iter()
                .filter(|search| search.library_id == self.library_id)
                .collect(),
            library_id: self.library_id,
            mapping: self.mapping,
            committed: self.committed,
            failed: self.failed,
            unattempted: self.unattempted,
            failing_sidecar: self.failing_sidecar,
            skipped: self.skipped,
            uninspectable: self.uninspectable,
            error,
            outcome,
            query_migrated,
        }
    }
}

fn sidecar_display_path(sidecar_owner: &str) -> String {
    if sidecar_owner == "." {
        manifest::MANIFEST_NAME.to_string()
    } else {
        format!("{sidecar_owner}/{}", manifest::MANIFEST_NAME)
    }
}

/// Writes each prepared group once, in order, through `writer` (the shape
/// `bulk_edit_tags_with_writer` uses; production passes
/// `manifest::write_atomic`). Stops at the first failure.
///
/// Cached snapshot rows and revisions change only for groups that committed, so
/// a failed or unattempted group keeps its original cached revisions, matching
/// the untouched bytes on disk. The mutation generation advances before the
/// first write, which stales every other pending preview; retry proofs stay.
pub(super) fn commit_prepared_rename(
    inner: &mut Inner,
    prepared: PreparedRename,
    mut writer: impl FnMut(&Path, Option<&[u8]>, &[u8]) -> Result<(), String>,
) -> SidecarCommit {
    inner.rename.note_mutation();
    let PreparedRename {
        preview_id,
        library_id,
        root,
        mapping,
        groups,
        skipped,
        uninspectable,
        replacements,
        settings_only,
    } = prepared;
    let mut commit = SidecarCommit {
        preview_id,
        library_id,
        root,
        mapping,
        committed: Vec::new(),
        committed_rows: Vec::new(),
        failed: Vec::new(),
        unattempted: Vec::new(),
        failing_sidecar: None,
        error: None,
        skipped,
        uninspectable,
        replacements,
        settings_only,
    };
    let total = groups.len();
    let mut groups = groups.into_iter();
    for (completed, group) in groups.by_ref().enumerate() {
        // The mutex stays held through every replacement, so library removal
        // and other native writers cannot interleave with this loop.
        let written = validate_inside_root(&commit.root, &group.owner_dir)
            .and_then(|()| writer(&group.sidecar_path, group.original.as_deref(), &group.bytes));
        if let Err(details) = written {
            commit.failing_sidecar = Some(sidecar_display_path(&group.sidecar_owner));
            commit.error = Some(AppError {
                message: format!(
                    "Tag rename partially applied: {completed} of {total} sidecars completed; remaining changes were not applied"
                ),
                path: group.sidecar_path.to_str().map(str::to_string),
                details: Some(details),
            });
            commit.failed = group.rows.iter().map(|row| row.target.summary()).collect();
            break;
        }
        let snapshot = inner
            .scan_snapshots
            .get_mut(&commit.library_id)
            .filter(|snapshot| snapshot.root == commit.root);
        if let Some(snapshot) = snapshot {
            for row in &group.rows {
                snapshot
                    .assets
                    .insert(row.target.asset_id.clone(), row.asset.clone());
            }
        }
        for row in group.rows {
            commit.committed_rows.push(CommittedRow {
                asset_id: row.target.asset_id,
                revision: row.asset.metadata_revision.clone(),
            });
            commit.committed.push(row.asset);
        }
    }
    commit.unattempted = groups
        .flat_map(|group| group.rows)
        .map(|row| row.target.summary())
        .collect();
    commit
}

// ---------------------------------------------------------------------------
// Apply (T11): sidecars, then the bound saved-search replacements, one guard.
//
// The backend mutex is taken once and held through preparation, every sidecar
// replacement and the settings write, so updater installation, library removal
// and other local writers cannot interleave. Nothing here calls
// `BackendState::mutate` or `upsert_saved_search_domain`, which lock again.
// Sidecars and app-data settings are separate stores: no atomic commit across
// both is claimed, and a settings failure never un-commits a sidecar.
// ---------------------------------------------------------------------------

/// Applies the preview-bound replacements to in-memory settings and persists.
///
/// Only called when every eligible sidecar committed. Returns the settings
/// error, if any; on error the in-memory searches are exactly as before and a
/// retry proof exists. With nothing bound there is nothing to persist.
///
/// A fresh failure stores a proof built from this commit's rows. A failed
/// settings-only retry has no rows of its own, so the proof it was verified
/// against simply stays for the next attempt. Success consumes the proof
/// waiting on this mapping.
fn commit_bound_replacements(
    inner: &mut Inner,
    commit: &SidecarCommit,
    persist_settings: impl FnOnce(&Inner) -> Result<(), String>,
) -> Option<AppError> {
    if !commit.replacements.is_empty() {
        let previous = inner.saved_searches.clone();
        for search in inner
            .saved_searches
            .iter_mut()
            .filter(|search| search.library_id == commit.library_id)
        {
            if let Some(replacement) = commit
                .replacements
                .iter()
                .find(|replacement| replacement.search_id == search.id)
            {
                search.filters = replacement.filters.clone();
            }
        }
        if let Err(details) = persist_settings(inner) {
            inner.saved_searches = previous;
            if !commit.settings_only {
                inner.rename.store_retry_proof(RetryProof {
                    library_id: commit.library_id.clone(),
                    root: commit.root.clone(),
                    mapping: commit.mapping.clone(),
                    committed: commit.committed_rows.clone(),
                    replacements: commit.replacements.clone(),
                });
            }
            return Some(AppError::save(&inner.settings_path, details));
        }
    }
    inner
        .rename
        .consume_retry_proof(&commit.library_id, &commit.mapping);
    None
}

/// Consumes the pending preview and applies it: prepare, sidecar commit, then
/// settings. `Err` means nothing was committed. Once any sidecar is written the
/// outcome is always an `Ok` result carrying the committed rows.
///
/// A sidecar failure stops before settings are touched. `writer` and
/// `persist_settings` are the injection seams; production passes
/// `manifest::write_atomic` and `backend::persist`.
pub(super) fn apply_tag_rename_domain(
    state: &BackendState,
    library_id: &str,
    preview_id: &str,
    env: &mut dyn PreviewEnv,
    writer: impl FnMut(&Path, Option<&[u8]>, &[u8]) -> Result<(), String>,
    persist_settings: impl FnOnce(&Inner) -> Result<(), String>,
) -> CommandResult<RenameApplyResult> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    // A settings file that failed to load must never be overwritten.
    if let Some(issue) = &inner.startup_issue {
        return Err(issue.clone());
    }
    let prepared = prepare_tag_rename(&mut inner, library_id, preview_id, env)?;
    let commit = commit_prepared_rename(&mut inner, prepared, writer);
    let settings_error = if commit.sidecars_complete() {
        commit_bound_replacements(&mut inner, &commit, persist_settings)
    } else {
        None
    };
    let saved_searches = inner.saved_searches.clone();
    Ok(commit.into_apply_result(saved_searches, settings_error))
}

#[tauri::command]
pub async fn apply_tag_rename(
    library_id: String,
    preview_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<RenameApplyResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        apply_tag_rename_domain(
            &state,
            &library_id,
            &preview_id,
            &mut FsPreviewEnv,
            manifest::write_atomic,
            persist,
        )
    })
    .await
    .map_err(|error| AppError::from(format!("Rename apply task failed: {error}")))?
}
