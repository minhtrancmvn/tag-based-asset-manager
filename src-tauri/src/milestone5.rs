use super::*;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub library_id: String,
    pub assets_checked: usize,
    pub issues: Vec<ScanIssue>,
    pub validated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub asset_count: usize,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssetAction {
    Open,
    Reveal,
    CopyFullPath,
    CopyRelativePath,
}

fn scanned_row<'a>(
    inner: &'a Inner,
    root: &Path,
    library_id: &str,
    asset_id: &str,
) -> CommandResult<&'a Asset> {
    inner
        .scan_snapshots
        .get(library_id)
        .filter(|snapshot| snapshot.root == root)
        .and_then(|snapshot| snapshot.assets.get(asset_id))
        .ok_or_else(|| AppError::from("Asset absent from latest scan; rescan library"))
}

fn asset_path(root: &Path, asset: &Asset) -> CommandResult<PathBuf> {
    if asset.id != format!("path:{}", asset.relative_path) {
        return Err("Invalid scanned asset identity".into());
    }
    if asset.relative_path == "." {
        return Ok(root.to_path_buf());
    }
    let relative = Path::new(&asset.relative_path);
    if relative.is_absolute() || relative.components().any(|component| !matches!(component, Component::Normal(_)))
        || relative.components().any(|component| matches!(component, Component::Normal(part) if part.to_str().is_none_or(ignored))) {
        return Err("Invalid or ignored asset path".into());
    }
    Ok(root.join(relative))
}

fn existing_asset_path(root: &Path, asset: &Asset) -> CommandResult<PathBuf> {
    if asset.status == "missing" {
        return Err("Asset is missing; reconnect metadata before file actions".into());
    }
    let path = asset_path(root, asset)?;
    validate_inside_root(root, &path).map_err(|error| AppError::at_path(error, &path))?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| AppError::at_path(format!("Asset is unavailable: {error}"), &path))?;
    if reject_reparse_or_symlink(&metadata).is_err() || (!metadata.is_file() && !metadata.is_dir())
    {
        return Err(AppError::at_path(
            "Asset is not a safe regular file or folder",
            &path,
        ));
    }
    if (asset.kind == "file") != metadata.is_file() || (asset.kind == "folder") != metadata.is_dir()
    {
        return Err(AppError::at_path(
            "Asset type changed; rescan library",
            &path,
        ));
    }
    Ok(path)
}

pub(super) fn asset_action_with_dispatch(
    state: &BackendState,
    library_id: &str,
    asset_id: &str,
    action: AssetAction,
    dispatch: impl FnOnce(AssetAction, &Path, &str) -> Result<(), String>,
) -> CommandResult<()> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let asset = scanned_row(&inner, &root, library_id, asset_id)?;
    let path = existing_asset_path(&root, asset)?;
    let text = if action == AssetAction::CopyRelativePath {
        asset.relative_path.as_str()
    } else {
        path.to_str()
            .ok_or_else(|| AppError::at_path("Asset path is not Unicode", &path))?
    };
    dispatch(action, &path, text).map_err(|error| AppError {
        message: "Native asset action failed".into(),
        path: path.to_str().map(str::to_string),
        details: Some(error),
    })
}

#[tauri::command]
pub async fn asset_action(
    app: tauri::AppHandle,
    library_id: String,
    asset_id: String,
    action: AssetAction,
    state: State<'_, BackendState>,
) -> CommandResult<()> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        asset_action_with_dispatch(
            &state,
            &library_id,
            &asset_id,
            action,
            |action, path, text| match action {
                AssetAction::Open => app
                    .opener()
                    .open_path(text, None::<&str>)
                    .map_err(|error| error.to_string()),
                AssetAction::Reveal => app
                    .opener()
                    .reveal_item_in_dir(path)
                    .map_err(|error| error.to_string()),
                AssetAction::CopyFullPath | AssetAction::CopyRelativePath => app
                    .clipboard()
                    .write_text(text)
                    .map_err(|error| error.to_string()),
            },
        )
    })
    .await
    .map_err(|error| AppError::from(format!("Native action task failed: {error}")))?
}

pub(super) fn validate_metadata_domain(
    state: &BackendState,
    library_id: &str,
) -> CommandResult<ValidationReport> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let result = scan_tree(&root, library_id, &Uuid::new_v4().to_string(), |_| {})
        .map_err(|error| AppError::scan(&root, error))?;
    Ok(ValidationReport {
        library_id: library_id.into(),
        assets_checked: result.assets.len(),
        issues: result.issues,
        validated_at: result.scanned_at,
    })
}

#[tauri::command]
pub async fn validate_metadata(
    library_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<ValidationReport> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || validate_metadata_domain(&state, &library_id))
        .await
        .map_err(|error| AppError::from(format!("Validation task failed: {error}")))?
}

struct MissingSource {
    path: PathBuf,
    owner: PathBuf,
    owner_relative: String,
    key: String,
    metadata: manifest::Manifest,
    bytes: Vec<u8>,
}

fn prepare_missing_source(
    inner: &Inner,
    root: &Path,
    library_id: &str,
    asset_id: &str,
    expected_revision: &str,
) -> CommandResult<MissingSource> {
    let source = scanned_row(inner, root, library_id, asset_id)?;
    if source.status != "missing"
        || source.kind != "file"
        || source.metadata_state != "valid"
        || source.metadata_id.is_none()
    {
        return Err("Reconnect requires valid missing metadata from latest scan".into());
    }
    if source.metadata_revision != expected_revision {
        return Err("Missing metadata revision changed; rescan before reconnecting".into());
    }
    let path = asset_path(root, source)?;
    let owner = path
        .parent()
        .ok_or_else(|| AppError::from("Invalid missing asset parent"))?
        .to_path_buf();
    validate_inside_root(root, &owner).map_err(|error| AppError::at_path(error, &owner))?;
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(AppError::at_path(
                format!("Could not verify missing source: {error}"),
                &path,
            ))
        }
        Ok(_) => {
            return Err(AppError::at_path(
                "Source exists again; rescan before reconnecting",
                &path,
            ))
        }
    }
    let key = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::from("Invalid missing basename"))?
        .to_string();
    manifest::validate_key(&key).map_err(AppError::from)?;
    let (metadata, bytes) = match manifest::read(&owner) {
        manifest::ReadManifest::Valid { manifest, bytes } => (manifest, bytes),
        manifest::ReadManifest::Blocked { error, .. } => {
            return Err(AppError::at_path(
                format!("Manifest is blocked: {error}"),
                &owner.join(manifest::MANIFEST_NAME),
            ))
        }
        manifest::ReadManifest::Missing => {
            return Err(AppError::at_path(
                "Missing source manifest; rescan before reconnecting",
                &owner,
            ))
        }
    };
    let entry = metadata
        .items
        .get(&key)
        .ok_or_else(|| AppError::from("Missing entry changed; rescan before reconnecting"))?;
    let owner_relative = path_string(
        owner
            .strip_prefix(root)
            .map_err(|_| AppError::from("Metadata owner outside library"))?,
    )
    .filter(|path| !path.is_empty())
    .unwrap_or_else(|| ".".into());
    let revision = manifest::metadata_revision(Some(entry), &key, "file", &owner_relative, "valid");
    if revision != expected_revision || source.metadata_id.as_deref() != Some(entry.id.as_str()) {
        return Err("Missing metadata changed; rescan before reconnecting".into());
    }
    Ok(MissingSource {
        path,
        owner,
        owner_relative,
        key,
        metadata,
        bytes,
    })
}

fn fresh_reconnect_scan(
    root: &Path,
    library_id: &str,
    source_id: &str,
    expected_revision: &str,
) -> CommandResult<ScanResult> {
    let result = scan_tree(root, library_id, &Uuid::new_v4().to_string(), |_| {})
        .map_err(|error| AppError::scan(root, error))?;
    let source = result
        .assets
        .iter()
        .find(|asset| asset.id == source_id)
        .filter(|asset| {
            asset.status == "missing"
                && asset.metadata_state == "valid"
                && asset.metadata_revision == expected_revision
        })
        .ok_or_else(|| {
            AppError::from(
                "Missing metadata changed or duplicate UUID found; rescan before reconnecting",
            )
        })?;
    let _ = source;
    // Cannot establish UUID uniqueness while another manifest/directory is unreadable or malformed.
    if result.issues.iter().any(|issue| {
        issue.message != "Metadata reference is missing"
            && issue.message != "Possible metadata conflict copy"
    }) {
        return Err("Resolve library validation issues before reconnecting metadata".into());
    }
    Ok(result)
}

fn target_has_single_link(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::symlink_metadata(path).is_ok_and(|metadata| metadata.nlink() == 1)
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_OPEN_REPARSE_POINT,
        };
        let Ok(file) = fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
        else {
            return false;
        };
        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        // Borrowed handle stays live through native query. Opening reparse point never follows its target.
        unsafe {
            GetFileInformationByHandle(file.as_raw_handle(), &mut information) != 0
                && information.nNumberOfLinks == 1
                && information.dwFileAttributes & 0x0400 == 0
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        false
    }
}

fn eligible_target(root: &Path, source: &MissingSource, asset: &Asset) -> bool {
    if asset.kind != "file"
        || asset.status == "missing"
        || asset.metadata_state != "none"
        || asset.metadata_id.is_some()
    {
        return false;
    }
    let Ok(path) = existing_asset_path(root, asset) else {
        return false;
    };
    if !target_has_single_link(&path) {
        return false;
    }
    path != source.path
        && path.parent() == Some(source.owner.as_path())
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|key| {
                manifest::validate_key(key).is_ok() && !source.metadata.items.contains_key(key)
            })
}

pub(super) fn reconnect_targets_domain(
    state: &BackendState,
    library_id: &str,
    asset_id: &str,
    expected_revision: &str,
) -> CommandResult<Vec<Asset>> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let source = prepare_missing_source(&inner, &root, library_id, asset_id, expected_revision)?;
    let fresh = fresh_reconnect_scan(&root, library_id, asset_id, expected_revision)?;
    let targets = fresh
        .assets
        .iter()
        .filter(|asset| eligible_target(&root, &source, asset))
        .cloned()
        .collect();
    record_edit_snapshot(&mut inner, &root, &fresh);
    Ok(targets)
}

pub(super) fn reconnect_asset_domain(
    state: &BackendState,
    library_id: &str,
    asset_id: &str,
    expected_revision: &str,
    target_asset_id: &str,
) -> CommandResult<ScanResult> {
    reconnect_with_writer(
        state,
        library_id,
        asset_id,
        expected_revision,
        target_asset_id,
        manifest::write_atomic,
    )
}

pub(super) fn reconnect_with_writer(
    state: &BackendState,
    library_id: &str,
    asset_id: &str,
    expected_revision: &str,
    target_asset_id: &str,
    writer: impl FnOnce(&Path, Option<&[u8]>, &[u8]) -> Result<(), String>,
) -> CommandResult<ScanResult> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let mut source =
        prepare_missing_source(&inner, &root, library_id, asset_id, expected_revision)?;
    let cached_target = scanned_row(&inner, &root, library_id, target_asset_id)?;
    if !eligible_target(&root, &source, cached_target) {
        return Err(
            "Target must be an untagged regular file without metadata in same folder".into(),
        );
    }
    let fresh = fresh_reconnect_scan(&root, library_id, asset_id, expected_revision)?;
    let target = fresh
        .assets
        .iter()
        .find(|asset| asset.id == target_asset_id)
        .filter(|asset| eligible_target(&root, &source, asset))
        .ok_or_else(|| {
            AppError::from("Reconnect target changed or already owns metadata; rescan")
        })?;
    let target_path = existing_asset_path(&root, target)?;
    let target_key = target_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::from("Invalid target basename"))?
        .to_string();
    let entry = source
        .metadata
        .items
        .remove(&source.key)
        .ok_or_else(|| AppError::from("Missing source entry"))?;
    if source
        .metadata
        .items
        .insert(target_key.clone(), entry.clone())
        .is_some()
    {
        return Err("Reconnect target already owns metadata".into());
    }
    source.metadata.updated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let bytes = source.metadata.serialize().map_err(AppError::from)?;
    // Recheck ownership, missing source and existing target immediately before the only durable write.
    let _ = prepare_missing_source(&inner, &root, library_id, asset_id, expected_revision)?;
    existing_asset_path(&root, target)?;
    validate_inside_root(&root, &source.owner)
        .map_err(|error| AppError::at_path(error, &source.owner))?;
    writer(
        &source.owner.join(manifest::MANIFEST_NAME),
        Some(&source.bytes),
        &bytes,
    )
    .map_err(|error| AppError::at_path(error, &source.owner.join(manifest::MANIFEST_NAME)))?;
    let result = match scan_tree(&root, library_id, &Uuid::new_v4().to_string(), |_| {}) {
        Ok(result) => result,
        Err(error) => {
            // Durable transfer already succeeded. Return committed rows plus visible refresh issue, never false failure.
            let mut result = fresh;
            result.scan_id = Uuid::new_v4().to_string();
            result.scanned_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            result.assets.retain(|asset| asset.id != asset_id);
            let repaired_path = metadata_display_path(&source.owner_relative, &source.key);
            result.issues.retain(|issue| {
                issue.message != "Metadata reference is missing" || issue.path != repaired_path
            });
            if let Some(target) = result
                .assets
                .iter_mut()
                .find(|asset| asset.id == target_asset_id)
            {
                target.tags = manifest::normalize_tags(entry.tags.iter().cloned());
                target.notes = entry.notes.clone();
                target.metadata_id = Some(entry.id.clone());
                target.metadata_state = "valid".into();
                target.status = if target.tags.is_empty() {
                    "untagged"
                } else {
                    "ready"
                }
                .into();
                target.metadata_revision = manifest::metadata_revision(
                    Some(&entry),
                    &target_key,
                    "file",
                    &source.owner_relative,
                    "valid",
                );
            }
            result.issues.push(ScanIssue {
                message: "Reconnect saved; library refresh failed".into(),
                path: source.owner_relative.clone(),
                details: format!(
                    "Metadata transfer is durable. Reconnect library and rescan: {error}"
                ),
            });
            result
        }
    };
    record_edit_snapshot(&mut inner, &root, &result);
    Ok(result)
}

#[tauri::command]
pub async fn reconnect_targets(
    library_id: String,
    asset_id: String,
    expected_revision: String,
    state: State<'_, BackendState>,
) -> CommandResult<Vec<Asset>> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        reconnect_targets_domain(&state, &library_id, &asset_id, &expected_revision)
    })
    .await
    .map_err(|error| AppError::from(format!("Reconnect target task failed: {error}")))?
}

#[tauri::command]
pub async fn reconnect_asset(
    library_id: String,
    asset_id: String,
    expected_revision: String,
    target_asset_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<ScanResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        reconnect_asset_domain(
            &state,
            &library_id,
            &asset_id,
            &expected_revision,
            &target_asset_id,
        )
    })
    .await
    .map_err(|error| AppError::from(format!("Reconnect task failed: {error}")))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    path: String,
    state: String,
    metadata: Option<manifest::Manifest>,
    raw_bytes: Option<Vec<u8>>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetadataBackup {
    backup_version: u32,
    exported_at: String,
    library: LibrarySummary,
    assets: Vec<Asset>,
    issues: Vec<ScanIssue>,
    manifests: Vec<BackupManifest>,
}

fn backup_manifests(root: &Path, scan: &ScanResult) -> CommandResult<Vec<BackupManifest>> {
    let mut directories: Vec<_> = scan
        .assets
        .iter()
        .filter(|asset| asset.kind == "folder" && asset.status != "missing")
        .collect();
    directories.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let mut backups = Vec::new();
    for asset in directories {
        let directory = existing_asset_path(root, asset)?;
        let path = if asset.relative_path == "." {
            manifest::MANIFEST_NAME.into()
        } else {
            format!("{}/{}", asset.relative_path, manifest::MANIFEST_NAME)
        };
        match manifest::read(&directory) {
            manifest::ReadManifest::Missing => {}
            manifest::ReadManifest::Valid { manifest, bytes } => backups.push(BackupManifest {
                path,
                state: "valid".into(),
                metadata: Some(manifest),
                raw_bytes: Some(bytes),
                error: None,
            }),
            manifest::ReadManifest::Blocked { bytes, error } => backups.push(BackupManifest {
                path,
                state: "blocked".into(),
                metadata: None,
                raw_bytes: bytes,
                error: Some(error),
            }),
        }
    }
    Ok(backups)
}

pub(super) fn same_native_path(canonical: &Path, selected: &Path) -> bool {
    #[cfg(windows)]
    {
        fn nonverbatim(path: &Path) -> PathBuf {
            use std::path::Prefix;
            let mut normalized = PathBuf::new();
            for component in path.components() {
                match component {
                    Component::Prefix(prefix) => match prefix.kind() {
                        Prefix::VerbatimDisk(drive) => {
                            normalized.push(format!("{}:", char::from(drive)))
                        }
                        Prefix::VerbatimUNC(server, share) => normalized.push(format!(
                            "\\\\{}\\{}",
                            server.to_string_lossy(),
                            share.to_string_lossy()
                        )),
                        _ => normalized.push(component.as_os_str()),
                    },
                    _ => normalized.push(component.as_os_str()),
                }
            }
            normalized
        }
        nonverbatim(canonical) == nonverbatim(selected)
    }
    #[cfg(not(windows))]
    {
        canonical == selected
    }
}

fn approved_backup_destination(selected: &Path) -> CommandResult<PathBuf> {
    if !selected.is_absolute()
        || selected
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(AppError::at_path(
            "Backup path must be absolute without traversal",
            selected,
        ));
    }
    let name = selected
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::at_path("Backup filename must be Unicode", selected))?;
    if ignored(name)
        || name.contains(':')
        || name.contains('\\')
        || name.contains('/')
        || selected
            .extension()
            .and_then(|extension| extension.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err(AppError::at_path(
            "Choose a new JSON backup filename, not metadata or app-private files",
            selected,
        ));
    }
    let parent = selected
        .parent()
        .ok_or_else(|| AppError::at_path("Invalid backup parent", selected))?;
    let canonical = fs::canonicalize(parent).map_err(|error| {
        AppError::at_path(format!("Backup folder unavailable: {error}"), parent)
    })?;
    if !same_native_path(&canonical, parent) {
        return Err(AppError::at_path(
            "Backup folder contains a symlink or changed path",
            parent,
        ));
    }
    // Native save-picker authorizes this one directory. Never accept a caller-provided root or broad frontend path grant.
    let mut current = PathBuf::new();
    for component in parent.components() {
        current.push(component.as_os_str());
        // Windows drive prefix alone is drive-relative (C:), not its absolute root (C:\\).
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&current).map_err(|error| {
            AppError::at_path(
                format!("Could not inspect backup directory: {error}"),
                &current,
            )
        })?;
        if reject_reparse_or_symlink(&metadata).is_err() || !metadata.is_dir() {
            return Err(AppError::at_path(
                "Backup directory contains symlink or reparse point",
                &current,
            ));
        }
    }
    match fs::symlink_metadata(selected) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(canonical.join(name)),
        Err(error) => Err(AppError::at_path(
            format!("Could not inspect backup destination: {error}"),
            selected,
        )),
        Ok(_) => Err(AppError::at_path(
            "Backup destination already exists; choose a new filename",
            selected,
        )),
    }
}

pub(super) fn write_backup_with_publish(
    destination: &Path,
    bytes: &[u8],
    publish: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> CommandResult<()> {
    use std::io::Write;
    let destination = approved_backup_destination(destination)?;
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::from("Invalid backup parent"))?;
    let temp = parent.join(format!(".asset-tags.tmp-export-{}", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| {
                AppError::at_path(
                    format!("Could not create backup temporary file: {error}"),
                    &temp,
                )
            })?;
        file.write_all(bytes).map_err(|error| {
            AppError::at_path(format!("Could not write backup: {error}"), &destination)
        })?;
        file.sync_all().map_err(|error| {
            AppError::at_path(format!("Could not flush backup: {error}"), &destination)
        })?;
        drop(file);
        approved_backup_destination(&destination)?;
        // hard_link is create-only publication: destination appears complete or fails without replacing anything.
        publish(&temp, &destination).map_err(|error| {
            AppError::at_path(
                format!("Could not publish new backup: {error}"),
                &destination,
            )
        })?;
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    })();
    let cleanup = fs::remove_file(&temp);
    match (result, cleanup) {
        (Ok(()), Err(error)) => Err(AppError::at_path(
            format!("Backup saved, but private temporary file cleanup failed: {error}"),
            &temp,
        )),
        (result, _) => result,
    }
}

pub(super) fn export_with_picker(
    state: &BackendState,
    library_id: &str,
    picker: impl FnOnce() -> CommandResult<Option<PathBuf>>,
) -> CommandResult<Option<ExportResult>> {
    let approved_root = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| AppError::from("Library state unavailable"))?;
        approved_edit_root(&inner, library_id)?
    };
    // No registration mutex held while native dialog waits for user.
    let Some(selected) = picker()? else {
        return Ok(None);
    };
    let destination = approved_backup_destination(&selected)?;
    let inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    if root != approved_root {
        return Err("Library approval changed while selecting backup destination".into());
    }
    let scan = scan_tree(&root, library_id, &Uuid::new_v4().to_string(), |_| {})
        .map_err(|error| AppError::scan(&root, error))?;
    let manifests = backup_manifests(&root, &scan)?;
    let mut library = inner
        .libraries
        .iter()
        .find(|library| library.id == library_id)
        .cloned()
        .ok_or_else(|| AppError::from("Unknown library ID"))?;
    library.asset_count = scan.assets.len();
    library.last_scan_at = Some(scan.scanned_at.clone());
    let asset_count = scan.assets.len();
    let backup = MetadataBackup {
        backup_version: 1,
        exported_at: scan.scanned_at,
        library,
        assets: scan.assets,
        issues: scan.issues,
        manifests,
    };
    let bytes = serde_json::to_vec_pretty(&backup)
        .map_err(|error| AppError::from(format!("Could not serialize metadata backup: {error}")))?;
    write_backup_with_publish(&destination, &bytes, |temp, destination| {
        fs::hard_link(temp, destination).map_err(|error| error.to_string())
    })?;
    Ok(Some(ExportResult {
        path: destination
            .to_str()
            .ok_or_else(|| AppError::from("Backup path is not Unicode"))?
            .into(),
        asset_count,
    }))
}

#[tauri::command]
pub async fn export_metadata(
    app: tauri::AppHandle,
    library_id: String,
    state: State<'_, BackendState>,
) -> CommandResult<Option<ExportResult>> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        export_with_picker(&state, &library_id, || {
            app.dialog()
                .file()
                .add_filter("JSON metadata backup", &["json"])
                .set_file_name(format!(
                    "asset-metadata-backup-{}.json",
                    Utc::now().format("%Y%m%d-%H%M%S")
                ))
                .blocking_save_file()
                .map(|selected| {
                    selected.into_path().map_err(|error| {
                        AppError::from(format!("Invalid selected backup path: {error}"))
                    })
                })
                .transpose()
        })
    })
    .await
    .map_err(|error| AppError::from(format!("Export task failed: {error}")))?
}
