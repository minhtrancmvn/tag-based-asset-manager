use crate::manifest;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::SystemTime,
};
use tauri::{ipc::Channel, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[path = "milestone5.rs"]
mod milestone5;
pub use milestone5::*;

const SETTINGS_VERSION: u32 = 1;
const PROGRESS_INTERVAL: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub message: String,
    pub path: Option<String>,
    pub details: Option<String>,
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self {
            message,
            path: None,
            details: None,
        }
    }
}
impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}
type CommandResult<T> = Result<T, AppError>;

impl AppError {
    fn at_path(message: impl Into<String>, path: &Path) -> Self {
        Self {
            message: message.into(),
            path: path.to_str().map(str::to_string),
            details: None,
        }
    }

    fn scan(path: &Path, details: impl Into<String>) -> Self {
        Self {
            message: "Could not scan library".into(),
            path: Some(path.to_string_lossy().into_owned()),
            details: Some(details.into()),
        }
    }

    fn save(path: &Path, details: impl Into<String>) -> Self {
        Self {
            message: "Could not save library settings".into(),
            path: Some(path.to_string_lossy().into_owned()),
            details: Some(details.into()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub asset_count: usize,
    pub last_scan_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
    pub libraries: Vec<LibrarySummary>,
    pub active_library_id: Option<String>,
    #[serde(default)]
    pub saved_searches: Vec<SavedSearch>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchFilters {
    pub query: String,
    pub view: SearchView,
    pub match_mode: MatchMode,
    pub kind: SearchKind,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchView {
    All,
    Untagged,
    Attention,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MatchMode {
    All,
    Any,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchKind {
    All,
    File,
    Folder,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearch {
    pub id: String,
    pub library_id: String,
    pub name: String,
    pub filters: SearchFilters,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkTagTarget {
    pub asset_id: String,
    pub expected_revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkTagResult {
    pub assets: Vec<Asset>,
    pub error: Option<AppError>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub kind: String,
    pub extension: Option<String>,
    pub modified_at: Option<String>,
    pub size_bytes: Option<u64>,
    pub tags: Vec<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub metadata_id: Option<String>,
    pub metadata_state: String,
    pub metadata_revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanIssue {
    pub message: String,
    pub path: String,
    pub details: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub library_id: String,
    pub scan_id: String,
    pub visited: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub library_id: String,
    pub scan_id: String,
    pub assets: Vec<Asset>,
    pub issues: Vec<ScanIssue>,
    pub scanned_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    version: u32,
    libraries: Vec<LibrarySummary>,
    active_library_id: Option<String>,
    #[serde(default)]
    saved_searches: Vec<SavedSearch>,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone)]
pub struct BackendState {
    inner: Arc<Mutex<Inner>>,
}
struct Inner {
    settings_path: PathBuf,
    libraries: Vec<LibrarySummary>,
    active_library_id: Option<String>,
    saved_searches: Vec<SavedSearch>,
    settings_extra: BTreeMap<String, serde_json::Value>,
    startup_issue: Option<AppError>,
    scan_snapshots: HashMap<String, EditSnapshot>,
    scan_cancellations: HashMap<(String, String), Arc<AtomicBool>>,
}

struct EditSnapshot {
    root: PathBuf,
    editable_ids: HashSet<String>,
    assets: HashMap<String, Asset>,
}

fn record_edit_snapshot(inner: &mut Inner, root: &Path, result: &ScanResult) {
    inner.scan_snapshots.insert(
        result.library_id.clone(),
        EditSnapshot {
            root: root.to_path_buf(),
            editable_ids: result
                .assets
                .iter()
                .filter(|asset| asset.metadata_state != "blocked" && asset.status != "missing")
                .map(|asset| asset.id.clone())
                .collect(),
            assets: result
                .assets
                .iter()
                .map(|asset| (asset.id.clone(), asset.clone()))
                .collect(),
        },
    );
}

impl BackendState {
    pub fn load(settings_path: PathBuf) -> Result<Self, String> {
        let mut libraries = Vec::new();
        let mut active_library_id = None;
        let mut saved_searches = Vec::new();
        let mut settings_extra = BTreeMap::new();
        let mut startup_issue = None;
        if let Some(parent) = settings_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                startup_issue = Some(AppError {
                    message: "Could not initialize app data directory".into(),
                    path: Some(parent.to_string_lossy().into_owned()),
                    details: Some(error.to_string()),
                });
            }
        }
        let settings_read = if startup_issue.is_none() {
            match fs::symlink_metadata(&settings_path) {
                Ok(metadata) if reject_reparse_or_symlink(&metadata).is_err() => {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Settings file is a symlink or reparse point",
                    ))
                }
                Ok(_) => fs::read(&settings_path),
                Err(error) => Err(error),
            }
        } else {
            Err(std::io::Error::other("App data directory unavailable"))
        };
        match settings_read {
            Ok(bytes) => match serde_json::from_slice::<PersistedSettings>(&bytes) {
                Ok(settings) if settings.version == SETTINGS_VERSION => {
                    libraries = settings.libraries;
                    active_library_id = settings.active_library_id;
                    saved_searches = settings.saved_searches;
                    settings_extra = settings.extra;
                }
                Ok(_) => {
                    startup_issue = Some(AppError::at_path(
                        "Unsupported library settings version",
                        &settings_path,
                    ))
                }
                Err(error) => {
                    startup_issue = Some(AppError {
                        message: "Could not load library settings".into(),
                        path: settings_path.to_str().map(str::to_string),
                        details: Some(error.to_string()),
                    })
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_error) if startup_issue.is_some() => {}
            Err(error) => {
                startup_issue = Some(AppError {
                    message: "Could not read library settings".into(),
                    path: settings_path.to_str().map(str::to_string),
                    details: Some(error.to_string()),
                })
            }
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(Inner {
                settings_path,
                libraries,
                active_library_id,
                saved_searches,
                settings_extra,
                startup_issue,
                scan_snapshots: HashMap::new(),
                scan_cancellations: HashMap::new(),
            })),
        })
    }

    fn snapshot(&self) -> CommandResult<LibraryState> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| AppError::from("Library state unavailable"))?;
        if let Some(issue) = &inner.startup_issue {
            return Err(issue.clone());
        }
        Ok(LibraryState {
            libraries: inner.libraries.clone(),
            active_library_id: inner.active_library_id.clone(),
            saved_searches: inner.saved_searches.clone(),
        })
    }

    fn mutate<T>(&self, f: impl FnOnce(&mut Inner) -> Result<T, String>) -> CommandResult<T> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| AppError::from("Library state unavailable"))?;
        if let Some(issue) = &inner.startup_issue {
            return Err(issue.clone());
        }
        let previous_libraries = inner.libraries.clone();
        let previous_active = inner.active_library_id.clone();
        let previous_searches = inner.saved_searches.clone();
        let previous_extra = inner.settings_extra.clone();
        let value = match f(&mut inner) {
            Ok(value) => value,
            Err(error) => {
                inner.libraries = previous_libraries;
                inner.active_library_id = previous_active;
                inner.saved_searches = previous_searches;
                inner.settings_extra = previous_extra;
                return Err(AppError::from(error));
            }
        };
        if let Err(error) = persist(&inner) {
            inner.libraries = previous_libraries;
            inner.active_library_id = previous_active;
            inner.saved_searches = previous_searches;
            inner.settings_extra = previous_extra;
            return Err(AppError::save(&inner.settings_path, error));
        }
        let approved: HashMap<_, _> = inner
            .libraries
            .iter()
            .map(|library| (library.id.clone(), PathBuf::from(&library.root_path)))
            .collect();
        inner
            .scan_snapshots
            .retain(|id, snapshot| approved.get(id) == Some(&snapshot.root));
        Ok(value)
    }
}

fn persist(inner: &Inner) -> Result<(), String> {
    let settings = PersistedSettings {
        version: SETTINGS_VERSION,
        libraries: inner.libraries.clone(),
        active_library_id: inner.active_library_id.clone(),
        saved_searches: inner.saved_searches.clone(),
        extra: inner.settings_extra.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    let parent = inner
        .settings_path
        .parent()
        .ok_or("Invalid settings path")?;
    fs::create_dir_all(parent).map_err(|e| format!("Could not create app data directory: {e}"))?;
    let temp = parent.join(format!(".settings-{}.tmp", Uuid::new_v4()));
    match fs::symlink_metadata(&inner.settings_path) {
        Ok(metadata) if reject_reparse_or_symlink(&metadata).is_err() => {
            return Err("Settings file cannot be a symlink or reparse point".into())
        }
        _ => {}
    }
    let result = (|| {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| format!("Could not create temporary settings: {e}"))?;
        file.write_all(&bytes)
            .map_err(|e| format!("Could not write settings: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Could not flush settings: {e}"))?;
        replace_settings(&temp, &inner.settings_path)?;
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(not(windows))]
fn replace_settings(temp: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temp, destination).map_err(|e| format!("Could not replace settings: {e}"))
}

#[cfg(windows)]
fn replace_settings(temp: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(format!(
            "Could not replace settings: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn library_state(state: State<'_, BackendState>) -> CommandResult<LibraryState> {
    state.snapshot()
}

#[tauri::command]
pub async fn choose_library(
    app: tauri::AppHandle,
    state: State<'_, BackendState>,
) -> CommandResult<Option<LibraryState>> {
    let selected = app.dialog().file().blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| AppError::from(format!("Invalid selected library path: {e}")))?;
    let canonical = validate_root(&path).map_err(AppError::from)?;
    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Library")
        .to_string();
    state
        .mutate(|inner| {
            let root = canonical
                .to_str()
                .ok_or("Library path is not valid Unicode")?
                .to_string();
            if let Some(existing) = inner
                .libraries
                .iter()
                .find(|library| library.root_path == root)
            {
                inner.active_library_id = Some(existing.id.clone());
            } else {
                let summary = LibrarySummary {
                    id: Uuid::new_v4().to_string(),
                    name,
                    root_path: root,
                    asset_count: 0,
                    last_scan_at: None,
                };
                inner.active_library_id = Some(summary.id.clone());
                inner.libraries.push(summary);
            }
            Ok(LibraryState {
                libraries: inner.libraries.clone(),
                active_library_id: inner.active_library_id.clone(),
                saved_searches: inner.saved_searches.clone(),
            })
        })
        .map(Some)
}

#[tauri::command]
pub fn activate_library(
    library_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<LibraryState> {
    state.mutate(|inner| {
        if !inner
            .libraries
            .iter()
            .any(|library| library.id == library_id)
        {
            return Err("Unknown library ID".into());
        }
        inner.active_library_id = Some(library_id);
        Ok(LibraryState {
            libraries: inner.libraries.clone(),
            active_library_id: inner.active_library_id.clone(),
            saved_searches: inner.saved_searches.clone(),
        })
    })
}

#[tauri::command]
pub fn remove_library(
    library_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<LibraryState> {
    remove_library_domain(&state, &library_id)
}

fn remove_library_domain(state: &BackendState, library_id: &str) -> CommandResult<LibraryState> {
    state.mutate(|inner| {
        inner.libraries.retain(|library| library.id != library_id);
        inner
            .saved_searches
            .retain(|search| search.library_id != library_id);
        if inner.active_library_id.as_deref() == Some(library_id) {
            inner.active_library_id = None;
        }
        Ok(LibraryState {
            libraries: inner.libraries.clone(),
            active_library_id: inner.active_library_id.clone(),
            saved_searches: inner.saved_searches.clone(),
        })
    })
}

fn search_state(inner: &Inner) -> LibraryState {
    LibraryState {
        libraries: inner.libraries.clone(),
        active_library_id: inner.active_library_id.clone(),
        saved_searches: inner.saved_searches.clone(),
    }
}

fn upsert_saved_search_domain(
    state: &BackendState,
    library_id: &str,
    name: &str,
    filters: SearchFilters,
    search_id: Option<&str>,
) -> CommandResult<LibraryState> {
    state.mutate(|inner| {
        if !inner
            .libraries
            .iter()
            .any(|library| library.id == library_id)
        {
            return Err("Unknown library ID".into());
        }
        let name = name.trim();
        if name.is_empty() {
            return Err("Saved search name cannot be empty".into());
        }
        let update_index = match search_id {
            Some(id) => Some(
                inner
                    .saved_searches
                    .iter()
                    .position(|search| search.id == id && search.library_id == library_id)
                    .ok_or("Unknown saved search ID for library")?,
            ),
            None => None,
        };
        if inner
            .saved_searches
            .iter()
            .enumerate()
            .any(|(index, search)| {
                search.library_id == library_id
                    && Some(index) != update_index
                    && search.name.to_lowercase() == name.to_lowercase()
            })
        {
            return Err("Saved search name already exists in library".into());
        }
        if let Some(index) = update_index {
            inner.saved_searches[index].name = name.into();
            inner.saved_searches[index].filters = filters;
        } else {
            inner.saved_searches.push(SavedSearch {
                id: Uuid::new_v4().to_string(),
                library_id: library_id.into(),
                name: name.into(),
                filters,
            });
        }
        Ok(search_state(inner))
    })
}

fn delete_saved_search_domain(
    state: &BackendState,
    library_id: &str,
    search_id: &str,
) -> CommandResult<LibraryState> {
    state.mutate(|inner| {
        if !inner
            .libraries
            .iter()
            .any(|library| library.id == library_id)
        {
            return Err("Unknown library ID".into());
        }
        let index = inner
            .saved_searches
            .iter()
            .position(|search| search.id == search_id && search.library_id == library_id)
            .ok_or("Unknown saved search ID for library")?;
        inner.saved_searches.remove(index);
        Ok(search_state(inner))
    })
}

#[tauri::command]
pub fn upsert_saved_search(
    library_id: String,
    name: String,
    filters: SearchFilters,
    search_id: Option<String>,
    state: State<'_, BackendState>,
) -> CommandResult<LibraryState> {
    upsert_saved_search_domain(&state, &library_id, &name, filters, search_id.as_deref())
}

#[tauri::command]
pub fn delete_saved_search(
    library_id: String,
    search_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<LibraryState> {
    delete_saved_search_domain(&state, &library_id, &search_id)
}

#[tauri::command]
pub async fn bulk_edit_tags(
    library_id: String,
    targets: Vec<BulkTagTarget>,
    add_tags: Vec<String>,
    remove_tags: Vec<String>,
    state: State<'_, BackendState>,
) -> CommandResult<BulkTagResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        bulk_edit_tags_domain(&state, &library_id, &targets, &add_tags, &remove_tags)
    })
    .await
    .map_err(|error| AppError::from(format!("Bulk tag edit task failed: {error}")))?
}

#[tauri::command]
pub async fn edit_tags(
    library_id: String,
    asset_id: String,
    expected_revision: String,
    add_tags: Vec<String>,
    remove_tags: Vec<String>,
    state: State<'_, BackendState>,
) -> CommandResult<Asset> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        edit_tags_domain(
            &state,
            &library_id,
            &asset_id,
            &expected_revision,
            &add_tags,
            &remove_tags,
        )
    })
    .await
    .map_err(|error| AppError::from(format!("Tag edit task failed: {error}")))?
}

fn edit_tags_domain(
    state: &BackendState,
    library_id: &str,
    asset_id: &str,
    expected_revision: &str,
    add_tags: &[String],
    remove_tags: &[String],
) -> CommandResult<Asset> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let prepared = prepare_tag_target(&inner, library_id, &root, asset_id, expected_revision)?;
    let selected_entry = match &prepared.current {
        manifest::ReadManifest::Valid { manifest, .. } => {
            manifest.items.get(&prepared.key).cloned()
        }
        _ => None,
    };
    let expected_target = manifest::revision(&(&selected_entry, prepared.key.as_str()));
    let (entry, _) = manifest::edit_entry(
        &prepared.owner_dir,
        &prepared.key,
        &expected_target,
        add_tags,
        remove_tags,
    )
    .map_err(|error| AppError::at_path(error, &prepared.owner_dir.join(manifest::MANIFEST_NAME)))?;
    Ok(prepared.with_entry(&entry))
}

struct PreparedTagTarget {
    asset: Asset,
    owner_dir: PathBuf,
    owner_relative: String,
    key: String,
    current: manifest::ReadManifest,
}

impl PreparedTagTarget {
    fn with_entry(&self, entry: &manifest::Entry) -> Asset {
        let mut asset = self.asset.clone();
        asset.tags = manifest::normalize_tags(entry.tags.iter().cloned());
        asset.status = if asset.tags.is_empty() {
            "untagged"
        } else {
            "ready"
        }
        .into();
        asset.notes = entry.notes.clone();
        asset.metadata_id = (!entry.id.is_empty()).then(|| entry.id.clone());
        asset.metadata_state = if entry.id.is_empty() { "none" } else { "valid" }.into();
        asset.metadata_revision = manifest::metadata_revision(
            (!entry.id.is_empty()).then_some(entry),
            &self.key,
            &asset.kind,
            &self.owner_relative,
            &asset.metadata_state,
        );
        asset
    }
}

fn approved_edit_root(inner: &Inner, library_id: &str) -> CommandResult<PathBuf> {
    if let Some(issue) = &inner.startup_issue {
        return Err(issue.clone());
    }
    let library = inner
        .libraries
        .iter()
        .find(|library| library.id == library_id)
        .ok_or_else(|| AppError::from("Unknown library ID"))?;
    let root = PathBuf::from(&library.root_path);
    let canonical = validate_root(&root).map_err(|error| AppError::scan(&root, error))?;
    if canonical != root {
        return Err(AppError::scan(&root, "Approved library root path changed"));
    }
    Ok(root)
}

fn prepare_tag_target(
    inner: &Inner,
    library_id: &str,
    root: &Path,
    asset_id: &str,
    expected_revision: &str,
) -> CommandResult<PreparedTagTarget> {
    let snapshot = inner
        .scan_snapshots
        .get(library_id)
        .filter(|snapshot| snapshot.root == root)
        .ok_or_else(|| AppError::from("Scan library before editing metadata"))?;
    if !snapshot.editable_ids.contains(asset_id) {
        return Err(AppError::from(
            "Asset was blocked, missing or absent during scan; rescan before editing",
        ));
    }
    let relative = asset_id
        .strip_prefix("path:")
        .ok_or_else(|| AppError::from("Invalid asset ID"))?
        .to_string();
    let relative = relative.as_str();
    let asset_path = if relative == "." {
        root.to_path_buf()
    } else {
        let relative_path = Path::new(relative);
        if relative_path.is_absolute()
            || relative_path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(AppError::from("Invalid asset ID path"));
        }
        root.join(relative_path)
    };
    validate_inside_root(root, &asset_path)
        .map_err(|error| AppError::at_path(error, &asset_path))?;
    let asset_meta = fs::symlink_metadata(&asset_path).map_err(|error| {
        AppError::at_path(format!("Asset is unavailable: {error}"), &asset_path)
    })?;
    reject_reparse_or_symlink(&asset_meta).map_err(|_| {
        AppError::at_path(
            "Asset path contains a symlink or reparse point",
            &asset_path,
        )
    })?;
    if !asset_meta.is_file() && !asset_meta.is_dir() {
        return Err(AppError::at_path(
            "Asset is not a regular file or folder",
            &asset_path,
        ));
    }
    let canonical_asset = fs::canonicalize(&asset_path)
        .map_err(|error| AppError::at_path(error.to_string(), &asset_path))?;
    if !canonical_asset.starts_with(root) {
        return Err(AppError::at_path(
            "Asset is outside approved library",
            &asset_path,
        ));
    }
    let is_folder = asset_meta.is_dir();
    let (owner_dir, key) = if is_folder && relative != "." {
        let folder_manifest = manifest::read(&asset_path);
        let parent = asset_path
            .parent()
            .ok_or_else(|| AppError::from("Invalid folder path"))?;
        let basename = asset_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::from("Asset name is not Unicode"))?;
        let parent_manifest = manifest::read(parent);
        let parent_has = matches!(&parent_manifest, manifest::ReadManifest::Valid { manifest, .. } if manifest.items.contains_key(basename));
        let own_has = matches!(&folder_manifest, manifest::ReadManifest::Valid { manifest, .. } if manifest.items.contains_key("."));
        if parent_has && own_has {
            return Err(AppError::at_path(
                "Conflicting folder metadata ownership",
                &asset_path,
            ));
        }
        if let manifest::ReadManifest::Blocked { error, .. } = folder_manifest {
            return Err(AppError::at_path(
                format!("Folder manifest is blocked: {error}"),
                &asset_path,
            ));
        }
        if let manifest::ReadManifest::Blocked { error, .. } = parent_manifest {
            return Err(AppError::at_path(
                format!("Parent manifest is blocked: {error}"),
                parent,
            ));
        }
        if own_has || !parent_has {
            (asset_path.clone(), ".".to_string())
        } else {
            (parent.to_path_buf(), basename.to_string())
        }
    } else if relative == "." {
        (root.to_path_buf(), ".".to_string())
    } else {
        let parent = asset_path
            .parent()
            .ok_or_else(|| AppError::from("Invalid asset path"))?;
        let key = asset_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::from("Asset name is not Unicode"))?;
        (parent.to_path_buf(), key.to_string())
    };
    let owner_canonical = fs::canonicalize(&owner_dir)
        .map_err(|error| AppError::at_path(error.to_string(), &owner_dir))?;
    if !owner_canonical.starts_with(root) {
        return Err(AppError::at_path(
            "Metadata directory is outside approved library",
            &owner_dir,
        ));
    }
    validate_inside_root(root, &owner_canonical)
        .map_err(|error| AppError::at_path(error, &owner_canonical))?;
    manifest::validate_key(&key).map_err(AppError::from)?;
    let current = manifest::read(&owner_canonical);
    let selected_entry = match &current {
        manifest::ReadManifest::Missing => None,
        manifest::ReadManifest::Valid { manifest, .. } => manifest.items.get(&key).cloned(),
        manifest::ReadManifest::Blocked { error, .. } => {
            return Err(AppError::at_path(
                format!("Manifest is blocked: {error}"),
                &owner_canonical.join(manifest::MANIFEST_NAME),
            ))
        }
    };
    if let (Some(selected), manifest::ReadManifest::Valid { manifest, .. }) =
        (&selected_entry, &current)
    {
        let selected_id = Uuid::parse_str(&selected.id).expect("parsed manifest has valid UUIDs");
        if manifest
            .items
            .values()
            .filter(|entry| Uuid::parse_str(&entry.id).ok() == Some(selected_id))
            .count()
            > 1
        {
            return Err(AppError::at_path(
                "Duplicate metadata UUID; rescan before editing",
                &owner_canonical.join(manifest::MANIFEST_NAME),
            ));
        }
    }
    let metadata_state = if selected_entry.is_some() {
        "valid"
    } else {
        "none"
    };
    let owner_relative = path_string(owner_dir.strip_prefix(root).unwrap_or(Path::new(".")))
        .filter(|owner| !owner.is_empty())
        .unwrap_or_else(|| ".".into());
    let actual_revision = manifest::metadata_revision(
        selected_entry.as_ref(),
        &key,
        if is_folder { "folder" } else { "file" },
        &owner_relative,
        metadata_state,
    );
    if actual_revision != expected_revision {
        return Err(AppError::from(
            "Metadata changed since scan; rescan before editing",
        ));
    }
    let entry = selected_entry.unwrap_or_else(manifest::Entry::absent);
    let asset = Asset {
        id: asset_id.into(),
        name: if relative == "." {
            root.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(".")
                .into()
        } else {
            asset_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .into()
        },
        relative_path: relative.into(),
        kind: if is_folder {
            "folder".into()
        } else {
            "file".into()
        },
        extension: if is_folder {
            None
        } else {
            asset_path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
        },
        modified_at: asset_meta.modified().ok().and_then(system_time_string),
        size_bytes: asset_meta.is_file().then_some(asset_meta.len()),
        tags: manifest::normalize_tags(entry.tags.iter().cloned()),
        status: if entry.tags.is_empty() {
            "untagged".into()
        } else {
            "ready".into()
        },
        notes: entry.notes.clone(),
        metadata_id: (!entry.id.is_empty()).then(|| entry.id.clone()),
        metadata_state: metadata_state.into(),
        metadata_revision: actual_revision,
    };
    Ok(PreparedTagTarget {
        asset,
        owner_dir: owner_canonical,
        owner_relative,
        key,
        current,
    })
}

fn bulk_edit_tags_domain(
    state: &BackendState,
    library_id: &str,
    targets: &[BulkTagTarget],
    add_tags: &[String],
    remove_tags: &[String],
) -> CommandResult<BulkTagResult> {
    bulk_edit_tags_with_writer(
        state,
        library_id,
        targets,
        add_tags,
        remove_tags,
        manifest::write_atomic,
    )
}

struct PreparedTagGroup {
    manifest: manifest::Manifest,
    original: Option<Vec<u8>>,
    assets: Vec<Asset>,
    changed: bool,
}

fn bulk_edit_tags_with_writer(
    state: &BackendState,
    library_id: &str,
    targets: &[BulkTagTarget],
    add_tags: &[String],
    remove_tags: &[String],
    mut writer: impl FnMut(&Path, Option<&[u8]>, &[u8]) -> Result<(), String>,
) -> CommandResult<BulkTagResult> {
    if targets.is_empty() {
        return Err(AppError::from("Select at least one asset"));
    }
    let mut seen = HashSet::new();
    for target in targets {
        if !seen.insert(&target.asset_id) {
            return Err(AppError::from("Duplicate bulk target asset ID"));
        }
    }
    if add_tags
        .iter()
        .chain(remove_tags)
        .any(|tag| tag.trim().is_empty())
    {
        return Err(AppError::from("Tag cannot be empty"));
    }
    let inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let mut groups: BTreeMap<PathBuf, PreparedTagGroup> = BTreeMap::new();
    let mut selected_ids = HashSet::new();
    for target in targets {
        let prepared = prepare_tag_target(
            &inner,
            library_id,
            &root,
            &target.asset_id,
            &target.expected_revision,
        )?;
        let (source_manifest, original) = match &prepared.current {
            manifest::ReadManifest::Missing => (manifest::Manifest::empty(), None),
            manifest::ReadManifest::Valid { manifest, bytes } => {
                (manifest.clone(), Some(bytes.clone()))
            }
            manifest::ReadManifest::Blocked { .. } => {
                unreachable!("preflight rejects blocked manifests")
            }
        };
        if let Some(entry) = source_manifest.items.get(&prepared.key) {
            let id = Uuid::parse_str(&entry.id).expect("parsed manifest UUID");
            if !selected_ids.insert(id) {
                return Err(AppError::at_path(
                    "Duplicate metadata UUID; rescan before editing",
                    &prepared.owner_dir.join(manifest::MANIFEST_NAME),
                ));
            }
        }
        let group = groups
            .entry(prepared.owner_dir.clone())
            .or_insert_with(|| PreparedTagGroup {
                manifest: source_manifest,
                original: original.clone(),
                assets: Vec::new(),
                changed: false,
            });
        if group.original != original {
            return Err(AppError::at_path(
                "Manifest changed during bulk preflight; rescan before editing",
                &prepared.owner_dir.join(manifest::MANIFEST_NAME),
            ));
        }
        let (entry, changed) =
            manifest::mutate_tags(&mut group.manifest, &prepared.key, add_tags, remove_tags);
        group.changed |= changed;
        group.assets.push(prepared.with_entry(&entry));
    }
    let mut locations: HashMap<Uuid, usize> = HashMap::new();
    for group in groups.values() {
        for entry in group.manifest.items.values() {
            *locations
                .entry(Uuid::parse_str(&entry.id).expect("validated UUID"))
                .or_default() += 1;
        }
    }
    for group in groups.values() {
        if group
            .assets
            .iter()
            .filter_map(|asset| asset.metadata_id.as_ref())
            .any(|id| {
                locations
                    .get(&Uuid::parse_str(id).expect("validated UUID"))
                    .copied()
                    .unwrap_or_default()
                    > 1
            })
        {
            return Err(AppError::from(
                "Duplicate metadata UUID; rescan before editing",
            ));
        }
    }
    // Serialize every group before the first write; preflight errors cannot leave partial edits.
    let writes: Vec<_> = groups
        .into_iter()
        .map(|(directory, group)| {
            let bytes = group
                .changed
                .then(|| group.manifest.serialize())
                .transpose()
                .map_err(|error| {
                    AppError::at_path(error, &directory.join(manifest::MANIFEST_NAME))
                })?;
            Ok((directory, group, bytes))
        })
        .collect::<CommandResult<_>>()?;
    let mut assets = Vec::new();
    for (directory, group, bytes) in writes {
        if let Some(bytes) = bytes {
            // Registration mutex remains held through every replacement; removal cannot race approval.
            if let Err(error) = validate_inside_root(&root, &directory).and_then(|()| {
                writer(
                    &directory.join(manifest::MANIFEST_NAME),
                    group.original.as_deref(),
                    &bytes,
                )
            }) {
                let message = format!("Bulk tag edit partially applied: {} of {} selected assets completed; remaining changes were not applied", assets.len(), targets.len());
                return Ok(BulkTagResult {
                    assets,
                    error: Some(AppError {
                        message,
                        path: Some(
                            directory
                                .join(manifest::MANIFEST_NAME)
                                .to_string_lossy()
                                .into_owned(),
                        ),
                        details: Some(error),
                    }),
                });
            }
        }
        assets.extend(group.assets);
    }
    Ok(BulkTagResult {
        assets,
        error: None,
    })
}

#[tauri::command]
pub async fn scan_library(
    library_id: String,
    scan_id: String,
    on_progress: Channel<ScanProgress>,
    state: State<'_, BackendState>,
) -> CommandResult<Option<ScanResult>> {
    let (root_text, cancellation) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| AppError::from("Library state unavailable"))?;
        if let Some(issue) = &inner.startup_issue {
            return Err(issue.clone());
        }
        let root = inner
            .libraries
            .iter()
            .find(|library| library.id == library_id)
            .map(|library| library.root_path.clone())
            .ok_or_else(|| AppError::from("Unknown library ID"))?;
        let cancellation = Arc::new(AtomicBool::new(false));
        inner
            .scan_cancellations
            .insert((library_id.clone(), scan_id.clone()), cancellation.clone());
        (root, cancellation)
    };
    let state = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root_text);
        let outcome = (|| {
            let canonical = validate_root(&root).map_err(|error| AppError::scan(&root, error))?;
            if canonical != root {
                return Err(AppError::scan(&root, "Approved library root path changed"));
            }
            let progress_channel = on_progress.clone();
            let result = scan_tree_cancellable(
                &canonical,
                &library_id,
                &scan_id,
                move |progress| {
                    let _ = progress_channel.send(progress);
                },
                || cancellation.load(Ordering::Relaxed),
            );
            let result = match result {
                Ok(result) => result,
                Err(error) if error == "SCAN_CANCELLED" => return Ok(None),
                Err(error) => return Err(AppError::scan(&root, error)),
            };
            let mut inner = state
                .lock()
                .map_err(|_| AppError::from("Library state unavailable"))?;
            if cancellation.load(Ordering::Relaxed) {
                return Ok(None);
            }
            let previous_libraries = inner.libraries.clone();
            let previous_active = inner.active_library_id.clone();
            if let Some(library) = inner
                .libraries
                .iter_mut()
                .find(|l| l.id == library_id && l.root_path == root.to_string_lossy())
            {
                library.asset_count = result.assets.len();
                library.last_scan_at = Some(result.scanned_at.clone());
                if let Err(error) = persist(&inner) {
                    inner.libraries = previous_libraries;
                    inner.active_library_id = previous_active;
                    return Err(AppError {
                        message: "Could not save library settings".into(),
                        path: Some(inner.settings_path.to_string_lossy().into_owned()),
                        details: Some(error),
                    });
                }
                record_edit_snapshot(&mut inner, &root, &result);
            }
            Ok(Some(result))
        })();
        if let Ok(mut inner) = state.lock() {
            if inner
                .scan_cancellations
                .get(&(library_id.clone(), scan_id.clone()))
                .is_some_and(|current| Arc::ptr_eq(current, &cancellation))
            {
                inner
                    .scan_cancellations
                    .remove(&(library_id.clone(), scan_id.clone()));
            }
        }
        outcome
    })
    .await
    .map_err(|e| AppError::from(format!("Scanner task failed: {e}")))?
}

#[tauri::command]
pub fn cancel_scan(
    library_id: String,
    scan_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<bool> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let approved = inner
        .libraries
        .iter()
        .any(|library| library.id == library_id);
    if !approved {
        return Err(AppError::from("Unknown library ID"));
    }
    let Some(cancellation) = inner.scan_cancellations.get(&(library_id, scan_id)) else {
        return Ok(false);
    };
    cancellation.store(true, Ordering::Relaxed);
    Ok(true)
}

#[tauri::command]
pub async fn delete_assets(
    library_id: String,
    targets: Vec<BulkTagTarget>,
    state: State<'_, BackendState>,
) -> CommandResult<asset_operations::TrashResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        asset_operations::delete_assets_domain(&state, &library_id, &targets)
    })
    .await
    .map_err(|error| AppError::from(format!("Trash task failed: {error}")))?
}

#[tauri::command]
pub async fn preview_asset(
    library_id: String,
    asset_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<asset_operations::PreviewResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        asset_operations::preview_asset_domain(&state, &library_id, &asset_id)
    })
    .await
    .map_err(|error| AppError::from(format!("Asset preview task failed: {error}")))?
}

#[path = "asset_operations.rs"]
mod asset_operations;

fn validate_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Path is outside approved library".to_string())?;
    if relative.as_os_str().is_empty() {
        return Ok(());
    }
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("Path contains traversal".into());
        };
        current.push(part);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Could not inspect path component: {error}"))?;
        reject_reparse_or_symlink(&metadata)
            .map_err(|_| "Path contains a symlink or reparse point".to_string())?;
        if fs::canonicalize(&current).ok().as_deref() != Some(current.as_path()) {
            return Err("Path component changed or escaped approved library".into());
        }
    }
    if fs::canonicalize(path).ok().as_deref() != Some(path) {
        return Err("Path changed or escaped approved library".into());
    }
    Ok(())
}

fn validate_root(path: &Path) -> Result<PathBuf, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("Library root unavailable: {e}"))?;
    reject_reparse_or_symlink(&metadata)
        .map_err(|_| "Library root cannot be a symlink or reparse point".to_string())?;
    if !metadata.is_dir() {
        return Err("Library root is not a directory".into());
    }
    fs::canonicalize(path).map_err(|e| format!("Library root unavailable: {e}"))
}

#[cfg(unix)]
fn reject_reparse_or_symlink(meta: &fs::Metadata) -> Result<(), ()> {
    use std::os::unix::fs::FileTypeExt;
    let ty = meta.file_type();
    if ty.is_symlink()
        || ty.is_block_device()
        || ty.is_char_device()
        || ty.is_socket()
        || ty.is_fifo()
    {
        Err(())
    } else {
        Ok(())
    }
}
#[cfg(windows)]
fn reject_reparse_or_symlink(meta: &fs::Metadata) -> Result<(), ()> {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    if meta.file_type().is_symlink() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        Err(())
    } else {
        Ok(())
    }
}
#[cfg(not(any(unix, windows)))]
fn reject_reparse_or_symlink(meta: &fs::Metadata) -> Result<(), ()> {
    if meta.file_type().is_symlink() {
        Err(())
    } else {
        Ok(())
    }
}

fn scan_tree(
    root: &Path,
    library_id: &str,
    scan_id: &str,
    progress: impl FnMut(ScanProgress),
) -> Result<ScanResult, String> {
    scan_tree_cancellable(root, library_id, scan_id, progress, || false)
}

fn scan_tree_cancellable(
    root: &Path,
    library_id: &str,
    scan_id: &str,
    mut progress: impl FnMut(ScanProgress),
    mut is_cancelled: impl FnMut() -> bool,
) -> Result<ScanResult, String> {
    let root_meta =
        fs::symlink_metadata(root).map_err(|e| format!("Library root unavailable: {e}"))?;
    reject_reparse_or_symlink(&root_meta)
        .map_err(|_| "Library root cannot be a symlink or reparse point".to_string())?;
    if !root_meta.is_dir() || fs::canonicalize(root).map_err(|e| e.to_string())? != root {
        return Err("Approved library root path changed".into());
    }
    let mut assets = Vec::new();
    let mut issues = Vec::new();
    let mut visited = 0usize;
    let mut stack = vec![(root.to_path_buf(), PathBuf::from("."))];
    let mut seen = HashSet::new();
    while let Some((dir, relative_dir)) = stack.pop() {
        if is_cancelled() {
            return Err("SCAN_CANCELLED".into());
        }
        let metadata = match fs::symlink_metadata(&dir) {
            Ok(metadata) => metadata,
            Err(error) => {
                issues.push(issue(
                    "Could not inspect directory",
                    &relative_dir,
                    Some(error),
                ));
                continue;
            }
        };
        if reject_reparse_or_symlink(&metadata).is_err() || !metadata.is_dir() {
            issues.push(issue_text(
                "Directory changed to symlink or non-directory; not scanned",
                &relative_dir,
            ));
            continue;
        }
        if fs::canonicalize(&dir).ok().as_deref() != Some(dir.as_path()) {
            issues.push(issue_text(
                "Directory path changed; not scanned",
                &relative_dir,
            ));
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if dir == root => {
                return Err(format!("Could not read library root: {error}"))
            }
            Err(error) => {
                issues.push(issue(
                    "Could not read directory",
                    &relative_dir,
                    Some(error),
                ));
                continue;
            }
        };
        let mut children = Vec::new();
        for entry in entries {
            if is_cancelled() {
                return Err("SCAN_CANCELLED".into());
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    issues.push(issue(
                        "Could not read directory entry",
                        &relative_dir,
                        Some(error),
                    ));
                    continue;
                }
            };
            let name_os = entry.file_name();
            let Some(name) = name_os.to_str() else {
                issues.push(issue_text(
                    "Skipped entry with non-Unicode name",
                    &relative_dir,
                ));
                continue;
            };
            if metadata_conflict_copy(name) {
                let relative = if relative_dir == Path::new(".") {
                    PathBuf::from(name)
                } else {
                    relative_dir.join(name)
                };
                issues.push(ScanIssue {
                    message: "Possible metadata conflict copy".into(),
                    path: path_string(&relative).unwrap_or_default(),
                    details:
                        "Noncanonical .asset-tags JSON preserved; no automatic merge or deletion"
                            .into(),
                });
                continue;
            }
            if ignored(name) {
                continue;
            }
            let path = entry.path();
            let child_relative = if relative_dir == Path::new(".") {
                PathBuf::from(name)
            } else {
                relative_dir.join(name)
            };
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    issues.push(issue(
                        "Could not inspect entry",
                        &child_relative,
                        Some(error),
                    ));
                    continue;
                }
            };
            if reject_reparse_or_symlink(&metadata).is_err() {
                issues.push(issue_text(
                    "Skipped symlink or reparse point",
                    &child_relative,
                ));
                continue;
            }
            if fs::canonicalize(&path).ok().as_deref() != Some(path.as_path()) {
                issues.push(issue_text("Entry path changed; skipped", &child_relative));
                continue;
            }
            let ty = metadata.file_type();
            if !ty.is_dir() && !ty.is_file() {
                issues.push(issue_text(
                    "Skipped non-regular filesystem entry",
                    &child_relative,
                ));
                continue;
            }
            if !seen.insert(child_relative.clone()) {
                continue;
            }
            let modified_at = metadata.modified().ok().and_then(system_time_string);
            let relative_text = path_string(&child_relative).unwrap_or_else(|| name.to_string());
            assets.push(Asset {
                id: format!("path:{relative_text}"),
                name: name.to_string(),
                relative_path: relative_text.clone(),
                kind: if ty.is_dir() { "folder" } else { "file" }.into(),
                extension: if ty.is_file() {
                    Path::new(name)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(str::to_ascii_lowercase)
                } else {
                    None
                },
                modified_at,
                size_bytes: ty.is_file().then_some(metadata.len()),
                tags: Vec::new(),
                status: "untagged".into(),
                notes: None,
                metadata_id: None,
                metadata_state: "none".into(),
                metadata_revision: manifest::revision(&(
                    None::<String>,
                    relative_text.as_str(),
                    "none",
                )),
            });
            if ty.is_dir() {
                children.push((path, child_relative));
            }
            visited += 1;
            if visited.is_multiple_of(PROGRESS_INTERVAL) {
                progress(ScanProgress {
                    library_id: library_id.into(),
                    scan_id: scan_id.into(),
                    visited,
                });
            }
        }
        children.reverse();
        stack.extend(children);
    }
    if is_cancelled() {
        return Err("SCAN_CANCELLED".into());
    }
    assets.push(Asset {
        id: "path:.".into(),
        name: root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(".")
            .into(),
        relative_path: ".".into(),
        kind: "folder".into(),
        extension: None,
        modified_at: fs::metadata(root)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(system_time_string),
        size_bytes: None,
        tags: Vec::new(),
        status: "untagged".into(),
        notes: None,
        metadata_id: None,
        metadata_state: "none".into(),
        metadata_revision: manifest::revision(&(None::<String>, ".", "none")),
    });
    merge_manifest_metadata_cancellable(root, &mut assets, &mut issues, &mut is_cancelled)?;
    if is_cancelled() {
        return Err("SCAN_CANCELLED".into());
    }
    assets.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    if is_cancelled() {
        return Err("SCAN_CANCELLED".into());
    }
    let scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    progress(ScanProgress {
        library_id: library_id.into(),
        scan_id: scan_id.into(),
        visited,
    });
    Ok(ScanResult {
        library_id: library_id.into(),
        scan_id: scan_id.into(),
        assets,
        issues,
        scanned_at,
    })
}

#[cfg(test)]
fn merge_manifest_metadata(root: &Path, assets: &mut Vec<Asset>, issues: &mut Vec<ScanIssue>) {
    merge_manifest_metadata_cancellable(root, assets, issues, &mut || false)
        .expect("uncancelled metadata merge");
}

fn merge_manifest_metadata_cancellable(
    root: &Path,
    assets: &mut Vec<Asset>,
    issues: &mut Vec<ScanIssue>,
    is_cancelled: &mut impl FnMut() -> bool,
) -> Result<(), String> {
    use manifest::ReadManifest;
    let mut manifests: HashMap<String, ReadManifest> = HashMap::new();
    let dirs: HashSet<String> = assets
        .iter()
        .filter(|asset| asset.kind == "folder")
        .map(|asset| asset.relative_path.clone())
        .collect();
    for relative in dirs {
        if is_cancelled() {
            return Err("SCAN_CANCELLED".into());
        }
        let absolute = if relative == "." {
            root.to_path_buf()
        } else {
            root.join(&relative)
        };
        if validate_inside_root(root, &absolute).is_err() {
            continue;
        }
        let meta = match fs::symlink_metadata(&absolute) {
            Ok(meta) if reject_reparse_or_symlink(&meta).is_ok() && meta.is_dir() => meta,
            _ => continue,
        };
        let _ = meta;
        let canonical = match fs::canonicalize(&absolute) {
            Ok(path) if path == absolute && path.starts_with(root) => path,
            _ => continue,
        };
        let key = relative.clone();
        let state = manifest::read(&canonical);
        if let ReadManifest::Blocked { error, .. } = &state {
            issues.push(ScanIssue {
                message: "Metadata manifest is blocked".into(),
                path: if relative == "." {
                    manifest::MANIFEST_NAME.into()
                } else {
                    format!("{relative}/{}", manifest::MANIFEST_NAME)
                },
                details: error.clone(),
            });
        }
        manifests.insert(key, state);
    }

    let mut by_uuid: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for (directory, state) in &manifests {
        if let ReadManifest::Valid { manifest, .. } = state {
            for (key, entry) in &manifest.items {
                if is_cancelled() {
                    return Err("SCAN_CANCELLED".into());
                }
                let canonical_id = Uuid::parse_str(&entry.id)
                    .expect("parsed manifest has valid UUIDs")
                    .to_string();
                by_uuid
                    .entry(canonical_id)
                    .or_default()
                    .push((directory.clone(), key.clone()));
            }
        }
    }
    let mut duplicate_locations = HashSet::new();
    for locations in by_uuid.values().filter(|locations| locations.len() > 1) {
        for location in locations {
            duplicate_locations.insert(location.clone());
        }
        issues.push(ScanIssue {
            message: "Duplicate metadata UUID".into(),
            path: locations
                .first()
                .map(|(dir, key)| metadata_display_path(dir, key))
                .unwrap_or_default(),
            details: format!("UUID is shared by {} metadata entries", locations.len()),
        });
    }

    for asset in assets.iter_mut() {
        if is_cancelled() {
            return Err("SCAN_CANCELLED".into());
        }
        let (directory, key) = if asset.relative_path == "." {
            (".".to_string(), ".".to_string())
        } else if asset.kind == "folder" {
            (asset.relative_path.clone(), ".".to_string())
        } else {
            let path = Path::new(&asset.relative_path);
            let parent = path
                .parent()
                .and_then(path_string)
                .filter(|parent| !parent.is_empty())
                .unwrap_or_else(|| ".".into());
            (
                parent,
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string(),
            )
        };
        let selected = if asset.kind == "folder" && asset.relative_path != "." {
            let parent_path = Path::new(&asset.relative_path)
                .parent()
                .and_then(path_string)
                .filter(|parent| !parent.is_empty())
                .unwrap_or_else(|| ".".into());
            let basename = Path::new(&asset.relative_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            let parent_entry = manifest_entry(&manifests, &parent_path, &basename);
            let own_entry = manifest_entry(&manifests, &directory, ".");
            if (parent_entry.is_none()
                && matches!(
                    manifests.get(&parent_path),
                    Some(ReadManifest::Blocked { .. })
                ))
                || (own_entry.is_none()
                    && matches!(
                        manifests.get(&directory),
                        Some(ReadManifest::Blocked { .. })
                    ))
            {
                asset.metadata_state = "blocked".into();
                asset.status = "warning".into();
                asset.metadata_revision =
                    manifest::metadata_revision(None, &basename, "folder", &directory, "blocked");
                continue;
            }
            if parent_entry.is_some() && own_entry.is_some() {
                asset.metadata_state = "blocked".into();
                asset.status = "warning".into();
                asset.metadata_revision = manifest::revision(&(
                    parent_entry,
                    own_entry,
                    asset.relative_path.as_str(),
                    "conflict",
                ));
                issues.push(ScanIssue {
                    message: "Conflicting folder metadata ownership".into(),
                    path: asset.relative_path.clone(),
                    details: "Both parent entry and folder manifest `.` describe this folder"
                        .into(),
                });
                continue;
            }
            if own_entry.is_some() || parent_entry.is_none() {
                (directory.clone(), ".".to_string(), own_entry)
            } else {
                (parent_path, basename, parent_entry)
            }
        } else {
            let entry = manifest_entry(&manifests, &directory, &key);
            if entry.is_none()
                && matches!(
                    manifests.get(&directory),
                    Some(ReadManifest::Blocked { .. })
                )
            {
                asset.metadata_state = "blocked".into();
                asset.status = "warning".into();
                asset.metadata_revision = manifest::metadata_revision(
                    None,
                    &key,
                    if asset.kind == "folder" {
                        "folder"
                    } else {
                        "file"
                    },
                    &directory,
                    "blocked",
                );
                continue;
            }
            (directory.clone(), key.clone(), entry)
        };
        let (owner, item_key, entry) = selected;
        let source_state = manifests.get(&owner);
        let blocked = matches!(source_state, Some(ReadManifest::Blocked { .. }));
        let duplicate = entry
            .as_ref()
            .is_some_and(|_| duplicate_locations.contains(&(owner.clone(), item_key.clone())));
        let state = if blocked {
            "blocked"
        } else if duplicate {
            "duplicate"
        } else if entry.is_some() {
            "valid"
        } else {
            "none"
        };
        let revision = manifest::metadata_revision(
            entry.as_ref(),
            &item_key,
            if asset.kind == "folder" {
                "folder"
            } else {
                "file"
            },
            &owner,
            state,
        );
        asset.metadata_revision = revision;
        if blocked || duplicate {
            asset.metadata_state = "blocked".into();
            asset.status = "warning".into();
            if let Some(entry) = entry {
                asset.metadata_id = Some(entry.id);
                asset.tags = manifest::normalize_tags(entry.tags);
                asset.notes = entry.notes;
            }
            continue;
        }
        if let Some(entry) = entry {
            asset.metadata_state = "valid".into();
            asset.metadata_id = Some(entry.id);
            asset.tags = manifest::normalize_tags(entry.tags);
            asset.notes = entry.notes;
            asset.status = if asset.tags.is_empty() {
                "untagged".into()
            } else {
                "ready".into()
            };
        }
    }

    for (directory, state) in &manifests {
        let ReadManifest::Valid { manifest, .. } = state else {
            continue;
        };
        for key in manifest.items.keys() {
            if is_cancelled() {
                return Err("SCAN_CANCELLED".into());
            }
            if key == "." {
                continue;
            }
            let target = if directory == "." {
                key.clone()
            } else {
                format!("{directory}/{key}")
            };
            let child = if directory == "." {
                root.join(key)
            } else {
                root.join(directory).join(key)
            };
            match fs::symlink_metadata(&child) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    let entry = manifest.items.get(key).expect("key belongs to manifest");
                    let id = format!("path:{target}");
                    assets.push(Asset {
                        id,
                        name: key.clone(),
                        relative_path: target.clone(),
                        kind: "file".into(),
                        extension: Path::new(key)
                            .extension()
                            .and_then(|extension| extension.to_str())
                            .map(str::to_ascii_lowercase),
                        modified_at: None,
                        size_bytes: None,
                        tags: manifest::normalize_tags(entry.tags.iter().cloned()),
                        status: "missing".into(),
                        notes: entry.notes.clone(),
                        metadata_id: Some(entry.id.clone()),
                        metadata_state: if duplicate_locations
                            .contains(&(directory.clone(), key.clone()))
                        {
                            "blocked".into()
                        } else {
                            "valid".into()
                        },
                        metadata_revision: manifest::metadata_revision(
                            Some(entry),
                            key,
                            "file",
                            directory,
                            if duplicate_locations.contains(&(directory.clone(), key.clone())) {
                                "duplicate"
                            } else {
                                "valid"
                            },
                        ),
                    });
                    issues.push(ScanIssue {
                        message: "Metadata reference is missing".into(),
                        path: metadata_display_path(directory, key),
                        details: "Stale entry preserved; no matching direct child exists".into(),
                    });
                }
                Err(error) => issues.push(ScanIssue {
                    message: "Could not inspect metadata reference".into(),
                    path: metadata_display_path(directory, key),
                    details: error.to_string(),
                }),
                Ok(_) => {}
            }
        }
    }
    Ok(())
}

fn metadata_display_path(directory: &str, key: &str) -> String {
    if directory == "." {
        format!("{}/{}", directory, key)
    } else {
        format!("{directory}/{}", key)
    }
}

fn manifest_entry(
    manifests: &HashMap<String, manifest::ReadManifest>,
    directory: &str,
    key: &str,
) -> Option<manifest::Entry> {
    match manifests.get(directory) {
        Some(manifest::ReadManifest::Valid { manifest, .. }) => manifest.items.get(key).cloned(),
        _ => None,
    }
}

fn metadata_conflict_copy(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with(".asset-tags") && lower.ends_with(".json") && name != manifest::MANIFEST_NAME
}

fn ignored(name: &str) -> bool {
    metadata_conflict_copy(name)
        || name == ".asset-tags.json"
        || name == ".DS_Store"
        || name == "Thumbs.db"
        || name == "$RECYCLE.BIN"
        || name.starts_with(".asset-tags.tmp-")
}
fn path_string(path: &Path) -> Option<String> {
    if path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return None;
    }
    let parts: Vec<String> = path
        .components()
        .filter_map(|component| match component {
            Component::CurDir => None,
            Component::Normal(part) => part.to_str().map(str::to_string),
            _ => None,
        })
        .collect();
    if parts.len()
        != path
            .components()
            .filter(|c| matches!(c, Component::Normal(_)))
            .count()
    {
        return None;
    }
    Some(parts.join("/"))
}
fn issue<E: std::fmt::Display>(message: &str, path: &Path, details: Option<E>) -> ScanIssue {
    ScanIssue {
        message: message.into(),
        path: path_string(path).unwrap_or_default(),
        details: details.map(|e| e.to_string()).unwrap_or_default(),
    }
}
fn issue_text(message: &str, path: &Path) -> ScanIssue {
    ScanIssue {
        message: message.into(),
        path: path_string(path).unwrap_or_default(),
        details: String::new(),
    }
}
fn system_time_string(time: SystemTime) -> Option<String> {
    let dt: DateTime<Utc> = time.into();
    Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

#[cfg(test)]
#[path = "milestone4_tests.rs"]
mod milestone4_tests;

#[cfg(test)]
#[path = "milestone5_tests.rs"]
mod milestone5_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::{
        ffi::OsString,
        os::unix::{ffi::OsStringExt, fs::symlink},
    };
    use tempfile::tempdir;

    fn tag_test_library() -> (tempfile::TempDir, PathBuf, BackendState) {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let state = BackendState::load(dir.path().join("settings.json")).unwrap();
        state
            .mutate(|inner| {
                inner.libraries.push(LibrarySummary {
                    id: "library".into(),
                    name: "library".into(),
                    root_path: root.to_str().unwrap().into(),
                    asset_count: 0,
                    last_scan_at: None,
                });
                Ok(())
            })
            .unwrap();
        (dir, root, state)
    }

    fn scanned_asset(root: &Path, state: &BackendState, relative: &str) -> Asset {
        let result = scan_tree(root, "library", "scan", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), root, &result);
        result
            .assets
            .into_iter()
            .find(|asset| asset.relative_path == relative)
            .unwrap()
    }

    fn edit_scanned(
        state: &BackendState,
        asset: &Asset,
        adds: &[&str],
        removes: &[&str],
    ) -> CommandResult<Asset> {
        edit_tags_domain(
            state,
            "library",
            &asset.id,
            &asset.metadata_revision,
            &adds.iter().map(|tag| tag.to_string()).collect::<Vec<_>>(),
            &removes
                .iter()
                .map(|tag| tag.to_string())
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    #[ignore = "165,540-entry phase benchmark; run explicitly with --ignored --nocapture"]
    fn large_catalog_finalization_phase_benchmark() {
        use std::time::Instant;
        let (_dir, root, state) = tag_test_library();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample-library");
        fn copy_fixture(source: &Path, destination: &Path) {
            for entry in fs::read_dir(source).unwrap() {
                let entry = entry.unwrap();
                let target = destination.join(entry.file_name());
                if entry.file_type().unwrap().is_dir() {
                    fs::create_dir(&target).unwrap();
                    copy_fixture(&entry.path(), &target);
                } else {
                    fs::copy(entry.path(), target).unwrap();
                }
            }
        }
        copy_fixture(&fixture, &root);
        let mut result = scan_tree(&root, "library", "benchmark", |_| {}).unwrap();
        let template = result
            .assets
            .iter()
            .find(|asset| asset.kind == "file" && asset.status != "missing")
            .unwrap()
            .clone();
        let baseline: Vec<_> = result.assets.clone();
        for index in 0..165_540 {
            let name = format!("synthetic-{index:06}.stl");
            result.assets.push(Asset {
                id: format!("path:{name}"),
                relative_path: name.clone(),
                name,
                tags: Vec::new(),
                status: "untagged".into(),
                metadata_id: None,
                metadata_state: "none".into(),
                notes: None,
                ..template.clone()
            });
        }
        let start = Instant::now();
        result.issues.clear();
        // Remove stale rows before merging; scan_tree adds these after traversal.
        result.assets.retain(|asset| asset.status != "missing");
        merge_manifest_metadata(&root, &mut result.assets, &mut result.issues);
        let merge = start.elapsed();
        let start = Instant::now();
        result
            .assets
            .sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        let sort = start.elapsed();
        let start = Instant::now();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), &root, &result);
        let snapshot = start.elapsed();
        let start = Instant::now();
        let bytes = serde_json::to_vec(&result).unwrap();
        let serialize = start.elapsed();
        eprintln!("assets={} merge={merge:?} sort={sort:?} snapshot={snapshot:?} serialize={serialize:?} bytes={}", result.assets.len(), bytes.len());
        assert_eq!(result.assets.len(), baseline.len() + 165_540);
        for asset in baseline {
            assert_eq!(
                result.assets.iter().find(|item| item.id == asset.id),
                Some(&asset)
            );
        }
        assert_eq!(
            serde_json::from_slice::<ScanResult>(&bytes).unwrap(),
            result
        );
        let inner = state.inner.lock().unwrap();
        let snapshot = &inner.scan_snapshots["library"];
        assert_eq!(snapshot.assets.len(), result.assets.len());
        assert_eq!(
            snapshot.editable_ids.len(),
            result
                .assets
                .iter()
                .filter(|asset| asset.metadata_state != "blocked" && asset.status != "missing")
                .count()
        );
    }

    #[test]
    fn legacy_tags_display_normalized_without_noop_rewriting_sidecar() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("model.stl"), b"asset").unwrap();
        let bytes = br#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{"model.stl":{"id":"76bfd01c-2055-43b1-996a-c3f9f4ab8f7e","tags":[" Favorite ","FAVORITE"]}}}"#;
        fs::write(root.join(manifest::MANIFEST_NAME), bytes).unwrap();
        let scanned = scanned_asset(&root, &state, "model.stl");
        assert_eq!(scanned.tags, vec!["favorite"]);
        let noop = edit_scanned(&state, &scanned, &["favorite"], &[]).unwrap();
        assert_eq!(noop.tags, vec!["favorite"]);
        assert_eq!(noop.metadata_revision, scanned.metadata_revision);
        assert_eq!(fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(), bytes);
        let removed = edit_scanned(&state, &noop, &[], &[" FAVORITE "]).unwrap();
        assert!(removed.tags.is_empty());
        assert_eq!(removed.metadata_id, scanned.metadata_id);
    }

    #[test]
    fn command_first_folder_edit_uses_own_manifest_and_round_trips_revision() {
        let (_dir, root, state) = tag_test_library();
        fs::create_dir(root.join("Folder")).unwrap();
        let before = scanned_asset(&root, &state, "Folder");
        let edited = edit_scanned(&state, &before, &[" Folder "], &[]).unwrap();
        assert!(!root.join(manifest::MANIFEST_NAME).exists());
        assert!(root.join("Folder").join(manifest::MANIFEST_NAME).exists());
        let after = scanned_asset(&root, &state, "Folder");
        assert_eq!(edited.metadata_revision, after.metadata_revision);
        assert_eq!(edited.metadata_id, after.metadata_id);
        assert_eq!(after.tags, vec!["folder"]);
        edit_scanned(&state, &edited, &[], &["folder"]).unwrap();
    }

    #[test]
    fn command_independent_sibling_edits_accept_original_absent_entry_revision() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("one.stl"), b"one").unwrap();
        fs::write(root.join("two.stl"), b"two").unwrap();
        let one = scanned_asset(&root, &state, "one.stl");
        let two = scanned_asset(&root, &state, "two.stl");
        edit_scanned(&state, &one, &["one"], &[]).unwrap();
        let two_edited = edit_scanned(&state, &two, &["two"], &[]).unwrap();
        assert_eq!(
            two_edited.metadata_revision,
            scanned_asset(&root, &state, "two.stl").metadata_revision
        );
        assert_eq!(fs::read(root.join("one.stl")).unwrap(), b"one");
        assert_eq!(fs::read(root.join("two.stl")).unwrap(), b"two");
    }

    #[test]
    fn command_existing_manifest_without_target_accepts_scan_revision_and_noop() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("new.stl"), b"asset").unwrap();
        let bytes = manifest::Manifest::empty().serialize().unwrap();
        fs::write(root.join(manifest::MANIFEST_NAME), &bytes).unwrap();
        let before = scanned_asset(&root, &state, "new.stl");
        let noop = edit_scanned(&state, &before, &[], &["absent"]).unwrap();
        assert_eq!(noop.metadata_revision, before.metadata_revision);
        assert_eq!(fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(), bytes);
        assert!(noop.metadata_id.is_none());
        edit_scanned(&state, &before, &["new"], &[]).unwrap();
    }

    #[test]
    fn command_rejects_changed_target_changed_owner_unknown_library_and_traversal() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("one.stl"), b"asset").unwrap();
        let before = scanned_asset(&root, &state, "one.stl");
        let edited = edit_scanned(&state, &before, &["one"], &[]).unwrap();
        let bytes = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
        assert!(edit_scanned(&state, &before, &["stale"], &[]).is_err());
        assert_eq!(fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(), bytes);
        assert!(edit_tags_domain(
            &state,
            "unknown",
            &edited.id,
            &edited.metadata_revision,
            &[],
            &[]
        )
        .is_err());
        for id in [
            "path:../escape",
            "path:/tmp/escape",
            "path:Folder/../one.stl",
            "bad",
        ] {
            assert!(
                edit_tags_domain(&state, "library", id, "revision", &["x".into()], &[]).is_err()
            );
        }
        fs::create_dir(root.join("Folder")).unwrap();
        let folder = scanned_asset(&root, &state, "Folder");
        let expected = manifest::revision(&(None::<manifest::Entry>, "Folder"));
        manifest::edit_entry(&root, "Folder", &expected, &["legacy".into()], &[]).unwrap();
        assert!(edit_scanned(&state, &folder, &["stale"], &[]).is_err());
        let legacy = scanned_asset(&root, &state, "Folder");
        let updated = edit_scanned(&state, &legacy, &["new"], &[]).unwrap();
        assert_eq!(updated.metadata_id, legacy.metadata_id);
        assert!(!root.join("Folder").join(manifest::MANIFEST_NAME).exists());
        assert_eq!(
            updated.metadata_revision,
            scanned_asset(&root, &state, "Folder").metadata_revision
        );
    }

    #[test]
    fn command_requires_scan_and_rejects_cached_blocked_assets_with_forged_revision() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("one.stl"), b"one").unwrap();
        fs::write(root.join("two.stl"), b"two").unwrap();
        assert!(edit_tags_domain(
            &state,
            "library",
            "path:one.stl",
            "revision",
            &["x".into()],
            &[]
        )
        .is_err());
        let mut metadata = manifest::Manifest::empty();
        let entry = manifest::Entry {
            id: "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e".into(),
            tags: vec!["one".into()],
            notes: None,
            extra: Default::default(),
        };
        metadata.items.insert("one.stl".into(), entry.clone());
        metadata.items.insert(
            "two.stl".into(),
            manifest::Entry {
                id: entry.id.to_uppercase(),
                ..entry.clone()
            },
        );
        let bytes = metadata.serialize().unwrap();
        fs::write(root.join(manifest::MANIFEST_NAME), &bytes).unwrap();
        let one = scanned_asset(&root, &state, "one.stl");
        assert_eq!(one.metadata_state, "blocked");
        let forged = manifest::metadata_revision(Some(&entry), "one.stl", "file", ".", "valid");
        assert!(edit_tags_domain(&state, "library", &one.id, &forged, &["x".into()], &[]).is_err());
        assert_eq!(fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(), bytes);
    }

    #[test]
    fn command_fresh_folder_conflict_and_malformed_manifest_preserve_bytes() {
        let (_dir, root, state) = tag_test_library();
        fs::create_dir(root.join("Folder")).unwrap();
        let folder = scanned_asset(&root, &state, "Folder");
        let empty = manifest::revision(&(None::<manifest::Entry>, "."));
        manifest::edit_entry(&root.join("Folder"), ".", &empty, &["own".into()], &[]).unwrap();
        let empty = manifest::revision(&(None::<manifest::Entry>, "Folder"));
        manifest::edit_entry(&root, "Folder", &empty, &["parent".into()], &[]).unwrap();
        let own_bytes = fs::read(root.join("Folder").join(manifest::MANIFEST_NAME)).unwrap();
        let parent_bytes = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
        assert!(edit_scanned(&state, &folder, &["x"], &[]).is_err());
        assert_eq!(
            fs::read(root.join("Folder").join(manifest::MANIFEST_NAME)).unwrap(),
            own_bytes
        );
        assert_eq!(
            fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
            parent_bytes
        );
        fs::write(root.join("model.stl"), b"asset").unwrap();
        let file = scanned_asset(&root, &state, "model.stl");
        fs::write(root.join(manifest::MANIFEST_NAME), b"{broken").unwrap();
        assert!(edit_scanned(&state, &file, &["x"], &[]).is_err());
        assert_eq!(
            fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
            b"{broken"
        );
    }

    #[test]
    fn command_root_tag_edit_and_fresh_local_duplicate_guard() {
        let (_dir, root, state) = tag_test_library();
        let root_asset = scanned_asset(&root, &state, ".");
        let root_edited = edit_scanned(&state, &root_asset, &["library"], &[]).unwrap();
        assert_eq!(
            root_edited.metadata_revision,
            scanned_asset(&root, &state, ".").metadata_revision
        );
        fs::write(root.join("model.stl"), b"asset").unwrap();
        let model = scanned_asset(&root, &state, "model.stl");
        let edited = edit_scanned(&state, &model, &["model"], &[]).unwrap();
        let entry = manifest_entry_from(&root, "model.stl");
        let mut current = match manifest::read(&root) {
            manifest::ReadManifest::Valid { manifest, .. } => manifest,
            _ => panic!("expected manifest"),
        };
        current.items.insert("gone.stl".into(), entry.clone());
        let bytes = current.serialize().unwrap();
        fs::write(root.join(manifest::MANIFEST_NAME), &bytes).unwrap();
        assert!(edit_scanned(&state, &edited, &["x"], &[])
            .unwrap_err()
            .message
            .contains("Duplicate metadata UUID"));
        assert_eq!(fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(), bytes);
    }

    #[cfg(unix)]
    #[test]
    fn command_rejects_symlink_ancestor_after_scan_without_touching_outside_assets() {
        let (_dir, root, state) = tag_test_library();
        let folder = root.join("Folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("model.stl"), b"inside").unwrap();
        let model = scanned_asset(&root, &state, "Folder/model.stl");
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("model.stl"), b"outside").unwrap();
        fs::remove_file(folder.join("model.stl")).unwrap();
        fs::remove_dir(&folder).unwrap();
        symlink(outside.path(), &folder).unwrap();
        assert!(edit_scanned(&state, &model, &["x"], &[]).is_err());
        assert!(!outside.path().join(manifest::MANIFEST_NAME).exists());
        assert_eq!(
            fs::read(outside.path().join("model.stl")).unwrap(),
            b"outside"
        );
    }

    fn bulk_targets(assets: &[Asset]) -> Vec<BulkTagTarget> {
        assets
            .iter()
            .map(|asset| BulkTagTarget {
                asset_id: asset.id.clone(),
                expected_revision: asset.metadata_revision.clone(),
            })
            .collect()
    }

    #[test]
    fn bulk_same_manifest_writes_once_preserves_entry_data_and_returns_scan_revision() {
        let (_dir, root, state) = tag_test_library();
        fs::create_dir(root.join("Folder")).unwrap();
        fs::write(root.join("Folder/one.stl"), b"one").unwrap();
        fs::write(root.join("Folder/two.stl"), b"two").unwrap();
        let mut original = manifest::Manifest::empty();
        original
            .extra
            .insert("future".into(), serde_json::json!(42));
        for (name, id) in [
            ("one.stl", "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e"),
            ("two.stl", "bb4e208d-7415-4ba7-9d7d-92192611f6f8"),
            ("stale.stl", "12fd779a-2055-43b1-996a-c3f9f4ab8f7e"),
        ] {
            original.items.insert(
                name.into(),
                manifest::Entry {
                    id: id.into(),
                    tags: vec![" Existing ".into()],
                    notes: (name == "one.stl").then(|| "keep note".into()),
                    extra: [("custom".into(), serde_json::json!(true))]
                        .into_iter()
                        .collect(),
                },
            );
        }
        fs::write(
            root.join("Folder").join(manifest::MANIFEST_NAME),
            original.serialize().unwrap(),
        )
        .unwrap();
        let scanned = scan_tree(&root, "library", "scan", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), &root, &scanned);
        let targets = bulk_targets(
            &scanned
                .assets
                .iter()
                .filter(|asset| {
                    asset.relative_path.starts_with("Folder/") && asset.status != "missing"
                })
                .cloned()
                .collect::<Vec<_>>(),
        );
        let writes = std::cell::Cell::new(0usize);
        let result = bulk_edit_tags_with_writer(
            &state,
            "library",
            &targets,
            &[" Added ".into()],
            &["existing".into()],
            |path, expected, bytes| {
                writes.set(writes.get() + 1);
                manifest::write_atomic(path, expected, bytes)
            },
        )
        .unwrap();
        assert_eq!(writes.get(), 1);
        assert!(result.error.is_none());
        assert_eq!(result.assets.len(), 2);
        for asset in result.assets {
            let rescanned = scan_tree(&root, "library", "again", |_| {})
                .unwrap()
                .assets
                .into_iter()
                .find(|item| item.id == asset.id)
                .unwrap();
            assert_eq!(asset.metadata_revision, rescanned.metadata_revision);
            assert_eq!(asset.tags, vec!["added"]);
        }
        let updated = match manifest::read(&root.join("Folder")) {
            manifest::ReadManifest::Valid { manifest, .. } => manifest,
            other => panic!("expected updated manifest, got {other:?}"),
        };
        assert_eq!(updated.extra["future"], 42);
        assert_eq!(updated.items["one.stl"].id, original.items["one.stl"].id);
        assert_eq!(updated.items["one.stl"].notes.as_deref(), Some("keep note"));
        assert_eq!(updated.items["one.stl"].extra["custom"], true);
        assert!(updated.items.contains_key("stale.stl"));
        assert_eq!(fs::read(root.join("Folder/one.stl")).unwrap(), b"one");
    }

    #[test]
    fn bulk_preflight_rejects_stale_missing_blocked_and_duplicate_before_any_write() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("one.stl"), b"one").unwrap();
        fs::write(root.join("two.stl"), b"two").unwrap();
        let scanned = scan_tree(&root, "library", "scan", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), &root, &scanned);
        let one = scanned
            .assets
            .iter()
            .find(|asset| asset.relative_path == "one.stl")
            .unwrap()
            .clone();
        let two = scanned
            .assets
            .iter()
            .find(|asset| asset.relative_path == "two.stl")
            .unwrap()
            .clone();
        let writes = std::cell::Cell::new(0usize);
        let writer = |_: &Path, _: Option<&[u8]>, _: &[u8]| -> Result<(), String> {
            writes.set(writes.get() + 1);
            Ok(())
        };
        let mut stale = bulk_targets(&[one.clone(), two.clone()]);
        stale[1].expected_revision = "stale".into();
        assert!(bulk_edit_tags_with_writer(
            &state,
            "library",
            &stale,
            &["tag".into()],
            &[],
            writer
        )
        .is_err());
        assert_eq!(writes.get(), 0);
        let mut missing = two.clone();
        missing.id = "path:gone.stl".into();
        assert!(bulk_edit_tags_with_writer(
            &state,
            "library",
            &bulk_targets(&[one.clone(), missing]),
            &["tag".into()],
            &[],
            writer
        )
        .is_err());
        assert_eq!(writes.get(), 0);
        let duplicate = bulk_targets(&[one.clone(), one.clone()]);
        assert!(bulk_edit_tags_with_writer(
            &state,
            "library",
            &duplicate,
            &["tag".into()],
            &[],
            writer
        )
        .is_err());
        assert_eq!(writes.get(), 0);
        fs::write(root.join(manifest::MANIFEST_NAME), b"{broken").unwrap();
        let after_block = scan_tree(&root, "library", "blocked", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), &root, &after_block);
        let blocked = after_block
            .assets
            .iter()
            .find(|asset| asset.relative_path == "one.stl")
            .unwrap()
            .clone();
        assert!(bulk_edit_tags_with_writer(
            &state,
            "library",
            &bulk_targets(&[blocked]),
            &["tag".into()],
            &[],
            writer
        )
        .is_err());
        assert_eq!(writes.get(), 0);
        assert_eq!(
            fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
            b"{broken"
        );
    }

    #[test]
    fn bulk_partial_failure_reports_committed_assets_and_cleans_failed_temp() {
        let (_dir, root, state) = tag_test_library();
        fs::create_dir(root.join("a")).unwrap();
        fs::create_dir(root.join("b")).unwrap();
        fs::write(root.join("a/one.stl"), b"one").unwrap();
        fs::write(root.join("b/two.stl"), b"two").unwrap();
        let scanned = scan_tree(&root, "library", "scan", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), &root, &scanned);
        let targets = bulk_targets(
            &scanned
                .assets
                .iter()
                .filter(|asset| asset.kind == "file")
                .cloned()
                .collect::<Vec<_>>(),
        );
        let mut attempts = 0usize;
        let result = bulk_edit_tags_with_writer(
            &state,
            "library",
            &targets,
            &["bulk".into()],
            &[],
            |path, expected, bytes| {
                attempts += 1;
                manifest::write_atomic_with_replace(path, expected, bytes, |temp, destination| {
                    if attempts == 2 {
                        Err("injected replacement failure".into())
                    } else {
                        fs::rename(temp, destination).map_err(|error| error.to_string())
                    }
                })
            },
        )
        .unwrap();
        assert_eq!(attempts, 2);
        assert_eq!(result.assets.len(), 1);
        assert!(result.error.as_ref().unwrap().message.contains("partial"));
        assert_eq!(
            result.error.unwrap().details.as_deref(),
            Some("injected replacement failure")
        );
        assert!(
            matches!(manifest::read(&root.join("a")), manifest::ReadManifest::Valid { manifest, .. } if manifest.items["one.stl"].tags == ["bulk"])
        );
        assert!(matches!(
            manifest::read(&root.join("b")),
            manifest::ReadManifest::Missing
        ));
        assert_eq!(fs::read_dir(root.join("b")).unwrap().count(), 1);
    }

    #[test]
    fn saved_search_migrates_persists_updates_deletes_and_isolates_library_ids() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"version":1,"libraries":[{"id":"one","name":"One","rootPath":"/one","assetCount":0,"lastScanAt":null},{"id":"two","name":"Two","rootPath":"/two","assetCount":0,"lastScanAt":null}],"activeLibraryId":"one","futureField":{"keep":7}}"#).unwrap();
        let state = BackendState::load(path.clone()).unwrap();
        let filters = SearchFilters {
            query: "favorite".into(),
            view: SearchView::Attention,
            match_mode: MatchMode::Any,
            kind: SearchKind::Folder,
        };
        let created =
            upsert_saved_search_domain(&state, "one", "  Favorites  ", filters.clone(), None)
                .unwrap();
        let saved = created.saved_searches[0].clone();
        assert_eq!(saved.name, "Favorites");
        assert!(
            upsert_saved_search_domain(&state, "one", "favorites", filters.clone(), None).is_err()
        );
        assert!(upsert_saved_search_domain(&state, "one", "  ", filters.clone(), None).is_err());
        assert!(
            upsert_saved_search_domain(&state, "unknown", "Other", filters.clone(), None).is_err()
        );
        assert!(upsert_saved_search_domain(
            &state,
            "two",
            "Wrong owner",
            filters.clone(),
            Some(&saved.id)
        )
        .is_err());
        let changed = SearchFilters {
            query: "status:printed".into(),
            view: SearchView::All,
            match_mode: MatchMode::All,
            kind: SearchKind::File,
        };
        let renamed =
            upsert_saved_search_domain(&state, "one", "Renamed", changed.clone(), Some(&saved.id))
                .unwrap();
        assert_eq!(renamed.saved_searches[0].filters, changed);
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted["futureField"]["keep"], 7);
        assert_eq!(
            BackendState::load(path.clone())
                .unwrap()
                .snapshot()
                .unwrap()
                .saved_searches,
            renamed.saved_searches
        );
        let removed = delete_saved_search_domain(&state, "one", &saved.id).unwrap();
        assert!(removed.saved_searches.is_empty());
        assert!(delete_saved_search_domain(&state, "one", &saved.id).is_err());
    }

    #[test]
    fn remove_library_deletes_only_its_saved_searches_and_persist_failure_rolls_back() {
        let (dir, root, state) = tag_test_library();
        fs::create_dir(root.join("sidecar")).unwrap();
        let filters = SearchFilters {
            query: "x".into(),
            view: SearchView::All,
            match_mode: MatchMode::All,
            kind: SearchKind::All,
        };
        let first = upsert_saved_search_domain(&state, "library", "First", filters.clone(), None)
            .unwrap()
            .saved_searches[0]
            .clone();
        state
            .mutate(|inner| {
                inner.libraries.push(LibrarySummary {
                    id: "other".into(),
                    name: "other".into(),
                    root_path: root.to_string_lossy().into_owned(),
                    asset_count: 0,
                    last_scan_at: None,
                });
                inner.active_library_id = Some("other".into());
                Ok(())
            })
            .unwrap();
        let second = upsert_saved_search_domain(&state, "other", "Second", filters, None)
            .unwrap()
            .saved_searches[1]
            .clone();
        let result = remove_library_domain(&state, "library").unwrap();
        assert_eq!(result.saved_searches, vec![second.clone()]);
        assert!(root.join("sidecar").exists());
        let settings_path = dir.path().join("settings.json");
        fs::remove_file(&settings_path).unwrap();
        fs::create_dir(&settings_path).unwrap();
        let failed = state.mutate(|inner| {
            inner.saved_searches.clear();
            inner.active_library_id = None;
            Ok(())
        });
        assert!(failed.is_err());
        assert_eq!(state.inner.lock().unwrap().saved_searches, vec![second]);
        assert_eq!(
            state.inner.lock().unwrap().active_library_id.as_deref(),
            Some("other")
        );
        assert!(first.id != state.inner.lock().unwrap().saved_searches[0].id);
    }

    #[test]
    fn saved_search_settings_reject_invalid_filters_without_rewriting_original() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let invalid = br#"{"version":1,"libraries":[],"activeLibraryId":null,"savedSearches":[{"id":"x","libraryId":"missing","name":"x","filters":{"query":"x","view":"future","matchMode":"all","kind":"all"}}]}"#;
        fs::write(&path, invalid).unwrap();
        let state = BackendState::load(path.clone()).unwrap();
        assert!(state.snapshot().is_err());
        assert_eq!(fs::read(path).unwrap(), invalid);
    }

    #[test]
    fn settings_round_trip_and_malformed_file_is_preserved() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let state = BackendState::load(path.clone()).unwrap();
        state
            .mutate(|inner| {
                inner.libraries.push(LibrarySummary {
                    id: "id1".into(),
                    name: "x".into(),
                    root_path: "/tmp/x".into(),
                    asset_count: 0,
                    last_scan_at: None,
                });
                inner.active_library_id = Some("id1".into());
                Ok(())
            })
            .unwrap();
        assert_eq!(
            BackendState::load(path.clone())
                .unwrap()
                .snapshot()
                .unwrap()
                .active_library_id
                .as_deref(),
            Some("id1")
        );
        fs::write(&path, b"{broken").unwrap();
        let malformed = BackendState::load(path.clone()).unwrap();
        assert!(malformed
            .snapshot()
            .unwrap_err()
            .message
            .contains("Could not load library settings"));
        assert_eq!(fs::read(path).unwrap(), b"{broken");
    }

    #[test]
    fn scan_filters_junk_and_preserves_files_and_manifest() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("library");
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("folder")).unwrap();
        fs::write(root.join("猫 space.stl"), b"asset bytes").unwrap();
        fs::write(root.join(".asset-tags.json"), b"manifest bytes").unwrap();
        for junk in [
            ".DS_Store",
            "Thumbs.db",
            "$RECYCLE.BIN",
            ".asset-tags.tmp-private",
        ] {
            fs::write(root.join(junk), b"junk").unwrap();
        }
        let before_asset = fs::read(root.join("猫 space.stl")).unwrap();
        let before_manifest = fs::read(root.join(".asset-tags.json")).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let mut progress = Vec::new();
        let result =
            scan_tree(&root, "library-id", "scan-id", |event| progress.push(event)).unwrap();
        assert_eq!(
            result
                .assets
                .iter()
                .map(|a| a.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec![".", "folder", "猫 space.stl"]
        );
        assert_eq!(result.assets[0].id, "path:.");
        assert_eq!(result.assets[2].id, "path:猫 space.stl");
        assert_eq!(result.assets[2].size_bytes, Some(before_asset.len() as u64));
        assert_eq!(result.assets[2].extension.as_deref(), Some("stl"));
        assert_eq!(progress.last().unwrap().visited, 2);
        assert_eq!(fs::read(root.join("猫 space.stl")).unwrap(), before_asset);
        assert_eq!(
            fs::read(root.join(".asset-tags.json")).unwrap(),
            before_manifest
        );
    }

    #[test]
    fn fixture_scan_finds_expected_entries_and_unicode() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample-library");
        let root = fs::canonicalize(root).unwrap();
        let result = scan_tree(&root, "fixture", "scan", |_| {}).unwrap();
        assert_eq!(result.assets.len(), 9);
        assert!(result
            .assets
            .iter()
            .any(|a| a.relative_path == "参考資料/猫と狐.txt"));
        assert!(result
            .assets
            .iter()
            .all(|a| !a.relative_path.contains(".asset-tags.json")));
        assert_eq!(result.assets[0].relative_path, ".");
    }

    #[test]
    fn mutate_errors_roll_back_state() {
        let dir = tempdir().unwrap();
        let state = BackendState::load(dir.path().join("settings.json")).unwrap();
        assert!(state
            .mutate(|inner| {
                inner.active_library_id = Some("bad".into());
                Err::<(), _>("expected".into())
            })
            .is_err());
        assert_eq!(state.snapshot().unwrap().active_library_id, None);
    }

    #[test]
    fn scanning_empty_library_returns_root_only() {
        let dir = tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let result = scan_tree(&root, "empty", "scan-empty", |_| {}).unwrap();
        assert_eq!(result.assets.len(), 1);
        assert_eq!(result.assets[0].relative_path, ".");
        assert_eq!(result.assets[0].kind, "folder");
    }

    #[test]
    fn missing_root_returns_scan_error() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("removed-library");
        let error = validate_root(&root).unwrap_err();
        let command_error = AppError::scan(&root, error);
        assert_eq!(command_error.message, "Could not scan library");
        assert_eq!(command_error.path.as_deref(), Some(root.to_str().unwrap()));
        assert!(command_error
            .details
            .unwrap()
            .contains("Library root unavailable"));
    }

    #[test]
    fn cancellable_scan_stops_traversal_without_final_result() {
        let dir = tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        for index in 0..300 {
            fs::File::create(root.join(format!("asset-{index:03}.bin"))).unwrap();
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let signal = cancelled.clone();
        let result = scan_tree_cancellable(
            &root,
            "library",
            "cancel-me",
            move |_| signal.store(true, Ordering::Relaxed),
            || cancelled.load(Ordering::Relaxed),
        );
        assert_eq!(result.unwrap_err(), "SCAN_CANCELLED");
    }

    #[test]
    fn metadata_merge_can_stop_before_reading_more_manifests() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("model.stl"), b"asset").unwrap();
        let result = scan_tree(&root, "library", "complete", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), &root, &result);
        let mut assets = result.assets.clone();
        let mut issues = Vec::new();
        let stopped =
            merge_manifest_metadata_cancellable(&root, &mut assets, &mut issues, &mut || true);
        assert_eq!(stopped.unwrap_err(), "SCAN_CANCELLED");
        assert!(issues.is_empty());
        assert_eq!(
            state.inner.lock().unwrap().scan_snapshots["library"]
                .assets
                .len(),
            result.assets.len()
        );
    }

    #[test]
    fn reports_progress_every_128_assets_and_at_completion() {
        let dir = tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        for index in 0..130 {
            fs::File::create(root.join(format!("asset-{index:03}.bin"))).unwrap();
        }
        let mut progress = Vec::new();
        let result =
            scan_tree(&root, "library", "batch-scan", |event| progress.push(event)).unwrap();
        assert_eq!(result.assets.len(), 131);
        assert_eq!(
            progress
                .iter()
                .map(|event| event.visited)
                .collect::<Vec<_>>(),
            vec![128, 130]
        );
        assert!(progress
            .iter()
            .all(|event| event.library_id == "library" && event.scan_id == "batch-scan"));
    }

    #[test]
    fn persist_failure_rolls_back_and_keeps_existing_destination() {
        let dir = tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let state = BackendState::load(settings.clone()).unwrap();
        fs::create_dir(&settings).unwrap();
        fs::write(settings.join("keep"), b"preserve").unwrap();
        let result = state.mutate(|inner| {
            inner.active_library_id = Some("not-persisted".into());
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(state.snapshot().unwrap().active_library_id, None);
        let error = result.unwrap_err();
        assert_eq!(error.message, "Could not save library settings");
        assert_eq!(error.path.as_deref(), Some(settings.to_str().unwrap()));
        assert!(error.details.is_some());
        assert_eq!(fs::read(settings.join("keep")).unwrap(), b"preserve");
    }

    #[cfg(unix)]
    #[test]
    fn settings_symlink_is_rejected_without_touching_target() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("real-settings.json");
        fs::write(&target, b"target-bytes").unwrap();
        let link = dir.path().join("settings.json");
        symlink(&target, &link).unwrap();
        let state = BackendState::load(link).unwrap();
        assert!(state
            .snapshot()
            .unwrap_err()
            .message
            .contains("Could not read library settings"));
        assert_eq!(fs::read(target).unwrap(), b"target-bytes");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_root_when_approved_parent_becomes_symlink() {
        let dir = tempdir().unwrap();
        let parent = dir.path().join("parent");
        let root = parent.join("library");
        fs::create_dir_all(&root).unwrap();
        let approved = fs::canonicalize(&root).unwrap();
        let moved_parent = dir.path().join("moved-parent");
        fs::rename(&parent, &moved_parent).unwrap();
        symlink(&moved_parent, &parent).unwrap();
        assert!(scan_tree(&approved, "library", "scan", |_| {}).is_err());
    }

    #[test]
    fn malformed_settings_reject_mutation_without_changing_original_bytes() {
        let dir = tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        fs::write(&settings, b"{not-json").unwrap();
        let state = BackendState::load(settings.clone()).unwrap();
        let error = state.mutate(|_| Ok(())).unwrap_err();
        assert_eq!(error.path.as_deref(), settings.to_str());
        assert_eq!(fs::read(settings).unwrap(), b"{not-json");
    }

    #[test]
    fn copied_fixture_scan_edit_and_reload_preserve_assets_and_metadata() {
        let temporary = tempdir().unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample-library");
        let root = temporary.path().join("library");
        copy_tree(&source, &root);
        let root = fs::canonicalize(root).unwrap();
        let state = BackendState::load(temporary.path().join("settings.json")).unwrap();
        state
            .mutate(|inner| {
                inner.libraries.push(LibrarySummary {
                    id: "library".into(),
                    name: "fixture".into(),
                    root_path: root.to_str().unwrap().into(),
                    asset_count: 0,
                    last_scan_at: None,
                });
                Ok(())
            })
            .unwrap();
        let model = root.join("Figures/Flexi Dragon.3mf");
        let bytes_before = fs::read(&model).unwrap();
        let first = scan_tree(&root, "library", "one", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), &root, &first);
        assert_eq!(first.assets.len(), 9);
        let asset = first
            .assets
            .iter()
            .find(|asset| asset.relative_path == "Figures/Flexi Dragon.3mf")
            .unwrap();
        assert_eq!(
            asset.metadata_id.as_deref(),
            Some("76bfd01c-2055-43b1-996a-c3f9f4ab8f7e")
        );
        let sibling = first
            .assets
            .iter()
            .find(|asset| asset.relative_path == "Figures/Robot.stl")
            .unwrap()
            .clone();
        assert_eq!(sibling.metadata_state, "none");
        let sibling_revision = sibling.metadata_revision.clone();
        assert!(asset.tags.contains(&"category:animal".to_string()));
        let updated = edit_scanned(&state, asset, &[" NewTag "], &[]).unwrap();
        assert_eq!(updated.metadata_id, asset.metadata_id);
        assert_eq!(updated.notes, asset.notes);
        assert!(edit_scanned(&state, asset, &["stale"], &[]).is_err());
        edit_scanned(&state, &sibling, &[" sibling "], &[]).unwrap();
        assert_eq!(
            sibling_revision,
            manifest::metadata_revision(None, "Robot.stl", "file", "Figures", "none")
        );
        assert_eq!(fs::read(&model).unwrap(), bytes_before);
        let reloaded =
            scan_tree(&fs::canonicalize(&root).unwrap(), "library", "two", |_| {}).unwrap();
        let edited = reloaded
            .assets
            .iter()
            .find(|asset| asset.relative_path == "Figures/Flexi Dragon.3mf")
            .unwrap();
        assert!(edited.tags.contains(&"newtag".to_string()));
        assert_eq!(
            edited.metadata_id.as_deref(),
            Some("76bfd01c-2055-43b1-996a-c3f9f4ab8f7e")
        );
        let missing = reloaded
            .assets
            .iter()
            .find(|asset| asset.relative_path == "Animals/Missing Fox.stl")
            .unwrap();
        assert_eq!(missing.status, "missing");
        assert!(reloaded
            .issues
            .iter()
            .any(|issue| issue.message == "Metadata reference is missing"));
    }

    #[test]
    fn scan_blocks_duplicate_ids_and_folder_ownership_conflict() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("Folder")).unwrap();
        fs::write(root.join("a.stl"), b"a").unwrap();
        let id = "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e";
        let root_manifest = format!(
            r#"{{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{{"a.stl":{{"id":"{id}","tags":["a"]}},"Folder":{{"id":"bb4e208d-7415-4ba7-9d7d-92192611f6f8","tags":["parent"]}}}}}}"#
        );
        fs::write(root.join(manifest::MANIFEST_NAME), root_manifest).unwrap();
        let folder_manifest = format!(
            r#"{{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{{".":{{"id":"{id}","tags":["child"]}}}}}}"#
        );
        fs::write(
            root.join("Folder").join(manifest::MANIFEST_NAME),
            folder_manifest,
        )
        .unwrap();
        let result = scan_tree(&fs::canonicalize(root).unwrap(), "id", "scan", |_| {}).unwrap();
        let file = result
            .assets
            .iter()
            .find(|asset| asset.relative_path == "a.stl")
            .unwrap();
        let folder = result
            .assets
            .iter()
            .find(|asset| asset.relative_path == "Folder")
            .unwrap();
        assert_eq!(file.metadata_state, "blocked");
        assert_eq!(folder.metadata_state, "blocked");
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.message == "Duplicate metadata UUID"));
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.message == "Conflicting folder metadata ownership"));
    }

    fn manifest_entry_from(directory: &Path, key: &str) -> manifest::Entry {
        match manifest::read(directory) {
            manifest::ReadManifest::Valid { manifest, .. } => manifest.items[key].clone(),
            other => panic!("expected valid manifest, got {other:?}"),
        }
    }

    fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for item in fs::read_dir(from).unwrap() {
            let item = item.unwrap();
            let destination = to.join(item.file_name());
            if item.file_type().unwrap().is_dir() {
                copy_tree(&item.path(), &destination);
            } else {
                fs::copy(item.path(), destination).unwrap();
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_and_reports_non_unicode_entries() {
        let dir = tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let link = root.join("link");
        symlink("/", &link).unwrap();
        let name = OsString::from_vec(vec![b'x', 0xff]);
        let can_create_non_unicode = fs::File::create(root.join(name)).is_ok();
        assert!(validate_root(&link).is_err());
        let result = scan_tree(&root, "id", "scan", |_| {}).unwrap();
        if can_create_non_unicode {
            assert!(result
                .issues
                .iter()
                .any(|i| i.message.contains("non-Unicode")));
        }
        assert!(result.issues.iter().any(|i| i.message.contains("symlink")));
        assert!(!result.assets.iter().any(|a| a.relative_path == "link"));
        assert!(path_string(Path::new("../sibling")).is_none());
    }
}
