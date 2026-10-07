use super::{
    approved_edit_root, reject_reparse_or_symlink, validate_inside_root, AppError, BackendState,
    BulkTagTarget, CommandResult,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

const TEXT_PREVIEW_LIMIT: usize = 64 * 1024;
const IMAGE_PREVIEW_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub completed_ids: Vec<String>,
    pub error: Option<AppError>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub kind: String,
    pub content: Option<String>,
    pub mime_type: Option<String>,
    pub truncated: bool,
    pub message: Option<String>,
}

struct PlannedTarget {
    asset_id: String,
    relative: String,
    path: PathBuf,
    kind: String,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
}

/// Moves snapshot-authorized rows to system Trash. `expected_revision` is accepted because the
/// frontend reuses `BulkTagTarget`, but is deliberately ignored: Trash does not edit metadata.
/// Freshness binds each selected row to its scanned path, kind, size and modification time.
pub(super) fn delete_assets_domain(
    state: &BackendState,
    library_id: &str,
    targets: &[BulkTagTarget],
) -> CommandResult<TrashResult> {
    delete_assets_with_dispatcher(state, library_id, targets, |path| {
        trash::delete(path).map_err(|error| error.to_string())
    })
}

fn delete_assets_with_dispatcher(
    state: &BackendState,
    library_id: &str,
    targets: &[BulkTagTarget],
    mut dispatch: impl FnMut(&Path) -> Result<(), String>,
) -> CommandResult<TrashResult> {
    if targets.is_empty() {
        return Err(AppError::from("Select at least one asset to move to Trash"));
    }
    let mut seen = HashSet::new();
    if targets
        .iter()
        .any(|target| !seen.insert(target.asset_id.as_str()))
    {
        return Err(AppError::from("Duplicate trash target asset ID"));
    }

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let snapshot = inner
        .scan_snapshots
        .get(library_id)
        .filter(|snapshot| snapshot.root == root)
        .ok_or_else(|| AppError::from("Scan library before moving assets to Trash"))?;
    let mut planned = Vec::with_capacity(targets.len());
    for target in targets {
        let asset = snapshot.assets.get(&target.asset_id).ok_or_else(|| {
            AppError::from("Asset was absent during scan; rescan before deleting")
        })?;
        if asset.status == "missing" {
            return Err(AppError::from(
                "Missing metadata references cannot be moved to Trash",
            ));
        }
        // Trash changes filesystem location only; metadata revision is not a deletion precondition.
        // The snapshot ID authorizes path identity, while fresh path checks below authorize location.
        let relative = asset.relative_path.as_str();
        if relative == "." {
            return Err(AppError::at_path(
                "The library root cannot be moved to Trash",
                &root,
            ));
        }
        let relative_path = Path::new(relative);
        if relative_path.is_absolute()
            || relative_path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(AppError::from("Invalid asset ID path"));
        }
        let path = root.join(relative_path);
        validate_fresh_target(&root, &path)?;
        let current = fs::symlink_metadata(&path)
            .map_err(|error| AppError::at_path(format!("Asset is unavailable: {error}"), &path))?;
        let current_modified = current.modified().ok().and_then(super::system_time_string);
        let expected_kind = if current.is_dir() { "folder" } else { "file" };
        if asset.kind != expected_kind
            || asset.size_bytes != current.is_file().then_some(current.len())
            || asset.modified_at != current_modified
        {
            return Err(AppError::at_path(
                "Asset changed since scan; rescan before deleting",
                &path,
            ));
        }
        planned.push(PlannedTarget {
            asset_id: target.asset_id.clone(),
            relative: relative.to_string(),
            path,
            kind: asset.kind.clone(),
            size_bytes: asset.size_bytes,
            modified_at: asset.modified_at.clone(),
        });
    }
    for target in &planned {
        let prefix = format!("{}/", target.relative);
        if planned
            .iter()
            .any(|other| target.relative != other.relative && other.relative.starts_with(&prefix))
        {
            return Err(AppError::from(
                "Select either a folder or its contents, not both",
            ));
        }
    }

    let completed_relatives: std::collections::HashMap<_, _> = planned
        .iter()
        .map(|target| (target.asset_id.clone(), target.relative.clone()))
        .collect();
    let mut completed_ids = Vec::new();
    for target in planned {
        if let Err(error) = validate_planned_target_freshness(&root, &target) {
            invalidate_completed_snapshot_targets(
                &mut inner,
                library_id,
                &completed_ids,
                &completed_relatives,
            );
            return Ok(TrashResult {
                completed_ids,
                error: Some(error),
            });
        }
        if let Err(details) = dispatch(&target.path) {
            invalidate_completed_snapshot_targets(
                &mut inner,
                library_id,
                &completed_ids,
                &completed_relatives,
            );
            return Ok(TrashResult {
                completed_ids,
                error: Some(AppError {
                    message: "Could not move asset to Trash; later targets were not processed"
                        .into(),
                    path: target.path.to_str().map(str::to_string),
                    details: Some(details),
                }),
            });
        }
        completed_ids.push(target.asset_id);
    }
    invalidate_completed_snapshot_targets(
        &mut inner,
        library_id,
        &completed_ids,
        &completed_relatives,
    );
    Ok(TrashResult {
        completed_ids,
        error: None,
    })
}

fn validate_planned_target_freshness(root: &Path, target: &PlannedTarget) -> CommandResult<()> {
    validate_fresh_target(root, &target.path)?;
    let metadata = fs::symlink_metadata(&target.path).map_err(|error| {
        AppError::at_path(format!("Asset is unavailable: {error}"), &target.path)
    })?;
    let current_modified = metadata.modified().ok().and_then(super::system_time_string);
    let current_kind = if metadata.is_dir() { "folder" } else { "file" };
    if target.kind != current_kind
        || target.size_bytes != metadata.is_file().then_some(metadata.len())
        || target.modified_at != current_modified
    {
        return Err(AppError::at_path(
            "Asset changed since scan; rescan before deleting",
            &target.path,
        ));
    }
    Ok(())
}

fn invalidate_completed_snapshot_targets(
    inner: &mut super::Inner,
    library_id: &str,
    completed_ids: &[String],
    completed_relatives: &std::collections::HashMap<String, String>,
) {
    let Some(snapshot) = inner.scan_snapshots.get_mut(library_id) else {
        return;
    };
    for id in completed_ids {
        let Some(relative) = completed_relatives.get(id) else {
            continue;
        };
        let prefix = format!("{relative}/");
        let removed: Vec<_> = snapshot
            .assets
            .iter()
            .filter(|(_, asset)| {
                asset.relative_path == *relative || asset.relative_path.starts_with(&prefix)
            })
            .map(|(asset_id, _)| asset_id.clone())
            .collect();
        for asset_id in removed {
            snapshot.assets.remove(&asset_id);
            snapshot.editable_ids.remove(&asset_id);
        }
    }
}

fn validate_fresh_target(root: &Path, path: &Path) -> CommandResult<()> {
    validate_inside_root(root, path).map_err(|error| AppError::at_path(error, path))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| AppError::at_path(format!("Asset is unavailable: {error}"), path))?;
    if reject_reparse_or_symlink(&metadata).is_err() || (!metadata.is_file() && !metadata.is_dir())
    {
        return Err(AppError::at_path(
            "Only regular files and folders can be moved to Trash",
            path,
        ));
    }
    Ok(())
}

pub(super) fn preview_asset_domain(
    state: &BackendState,
    library_id: &str,
    asset_id: &str,
) -> CommandResult<PreviewResult> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| AppError::from("Library state unavailable"))?;
    let root = approved_edit_root(&inner, library_id)?;
    let snapshot = inner
        .scan_snapshots
        .get(library_id)
        .filter(|snapshot| snapshot.root == root)
        .ok_or_else(|| AppError::from("Scan library before previewing assets"))?;
    let asset = snapshot
        .assets
        .get(asset_id)
        .ok_or_else(|| AppError::from("Asset was absent during scan; rescan before previewing"))?;
    if asset.metadata_state == "blocked" {
        return Err(AppError::from(
            "Asset metadata is blocked; rescan before previewing",
        ));
    }
    if asset.kind != "file" || asset.status == "missing" {
        return Ok(unsupported(
            "Folders and missing assets cannot be previewed",
        ));
    }
    let relative = Path::new(&asset.relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::from("Invalid asset ID path"));
    }
    let path = root.join(relative);
    validate_fresh_target(&root, &path)?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| AppError::at_path(format!("Asset is unavailable: {error}"), &path))?;
    if !metadata.is_file() {
        return Ok(unsupported("Only regular files can be previewed"));
    }
    let mime = image_mime(&path);
    if let Some(mime_type) = mime {
        if metadata.len() > IMAGE_PREVIEW_LIMIT {
            return Ok(unsupported("Image exceeds 8 MiB preview limit"));
        }
        let file = open_checked_file(&root, &path, metadata.len())?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(IMAGE_PREVIEW_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| AppError::at_path(format!("Could not read image: {error}"), &path))?;
        if bytes.len() as u64 > IMAGE_PREVIEW_LIMIT {
            return Ok(unsupported("Image exceeds 8 MiB preview limit"));
        }
        return Ok(PreviewResult {
            kind: "image".into(),
            content: Some(format!(
                "data:{mime_type};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )),
            mime_type: Some(mime_type.into()),
            truncated: false,
            message: None,
        });
    }
    if !is_text_candidate(&path) {
        return Ok(unsupported("Preview unavailable for this file type"));
    }
    let file = open_checked_file(&root, &path, metadata.len())?;
    let mut bytes = Vec::with_capacity(TEXT_PREVIEW_LIMIT + 1);
    file.take((TEXT_PREVIEW_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            AppError::at_path(format!("Could not read text preview: {error}"), &path)
        })?;
    let truncated = bytes.len() > TEXT_PREVIEW_LIMIT;
    if truncated {
        bytes.truncate(TEXT_PREVIEW_LIMIT);
    }
    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_string(),
        Err(error) if truncated && error.error_len().is_none() => {
            bytes.truncate(error.valid_up_to());
            std::str::from_utf8(&bytes)
                .expect("valid prefix reported by UTF-8 decoder")
                .to_string()
        }
        Err(_) => return Ok(unsupported("Text preview requires valid UTF-8")),
    };
    Ok(PreviewResult {
        kind: "text".into(),
        content: Some(text),
        mime_type: Some("text/plain".into()),
        truncated,
        message: truncated.then(|| "Preview truncated to 64 KiB".into()),
    })
}

fn open_checked_file(root: &Path, path: &Path, expected_size: u64) -> CommandResult<fs::File> {
    validate_fresh_target(root, path)?;
    let file = fs::File::open(path).map_err(|error| {
        AppError::at_path(format!("Could not open preview file: {error}"), path)
    })?;
    let handle_metadata = file.metadata().map_err(|error| {
        AppError::at_path(format!("Could not inspect preview file: {error}"), path)
    })?;
    if !handle_metadata.is_file() || handle_metadata.len() != expected_size {
        return Err(AppError::at_path("Asset changed during preview", path));
    }
    validate_fresh_target(root, path)?;
    Ok(file)
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn is_text_candidate(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            "txt"
                | "md"
                | "json"
                | "csv"
                | "log"
                | "xml"
                | "yaml"
                | "yml"
                | "toml"
                | "ini"
                | "cfg"
                | "obj"
                | "mtl"
                | "gcode"
        )
    )
}

fn unsupported(message: &str) -> PreviewResult {
    PreviewResult {
        kind: "unsupported".into(),
        content: None,
        mime_type: None,
        truncated: false,
        message: Some(message.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{record_edit_snapshot, scan_tree, LibrarySummary};
    use std::cell::RefCell;
    use tempfile::tempdir;

    fn tag_test_library() -> (tempfile::TempDir, PathBuf, BackendState) {
        let dir = tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
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

    fn targets_for(state: &BackendState, root: &Path, relatives: &[&str]) -> Vec<BulkTagTarget> {
        let scan = scan_tree(root, "library", "ops-scan", |_| {}).unwrap();
        record_edit_snapshot(&mut state.inner.lock().unwrap(), root, &scan);
        relatives
            .iter()
            .map(|relative| {
                let asset = scan
                    .assets
                    .iter()
                    .find(|asset| asset.relative_path == *relative)
                    .unwrap();
                BulkTagTarget {
                    asset_id: asset.id.clone(),
                    expected_revision: asset.metadata_revision.clone(),
                }
            })
            .collect()
    }

    #[test]
    fn trash_preflight_guards_root_unknown_overlap_and_missing_targets() {
        let (_dir, root, state) = tag_test_library();
        fs::create_dir(root.join("Folder")).unwrap();
        fs::write(root.join("Folder/item.txt"), b"item").unwrap();
        let targets = targets_for(&state, &root, &[".", "Folder", "Folder/item.txt"]);
        let dispatches = RefCell::new(0);
        assert!(
            delete_assets_with_dispatcher(&state, "library", &targets[..1], |_| {
                *dispatches.borrow_mut() += 1;
                Ok(())
            })
            .is_err()
        );
        let mut unknown = targets[1].clone();
        unknown.asset_id = "path:unknown".into();
        assert!(delete_assets_with_dispatcher(&state, "library", &[unknown], |_| Ok(())).is_err());
        assert!(delete_assets_with_dispatcher(
            &state,
            "library",
            &[targets[1].clone(), targets[2].clone()],
            |_| {
                *dispatches.borrow_mut() += 1;
                Ok(())
            }
        )
        .is_err());
        assert!(delete_assets_with_dispatcher(
            &state,
            "unknown",
            &[targets[1].clone()],
            |_| Ok(())
        )
        .is_err());
        let mut absent = targets[1].clone();
        absent.asset_id = "path:../outside".into();
        assert!(delete_assets_with_dispatcher(&state, "library", &[absent], |_| Ok(())).is_err());
        assert_eq!(*dispatches.borrow(), 0);
        assert!(root.join("Folder/item.txt").exists());
    }

    #[test]
    fn trash_dispatches_targets_and_preserves_sidecar_bytes_and_unselected_files() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("remove.txt"), b"remove bytes").unwrap();
        fs::write(root.join("keep.txt"), b"keep bytes").unwrap();
        let manifest_bytes = br#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{"remove.txt":{"id":"76bfd01c-2055-43b1-996a-c3f9f4ab8f7e","tags":["x"]},"remove-stale.txt":{"id":"bb4e208d-7415-43b1-996a-c3f9f4ab8f7e","tags":["stale"]}}}"#;
        fs::write(
            root.join(crate::backend::manifest::MANIFEST_NAME),
            manifest_bytes,
        )
        .unwrap();
        let targets = targets_for(&state, &root, &["remove.txt"]);
        let called = RefCell::new(Vec::new());
        let result = delete_assets_with_dispatcher(&state, "library", &targets, |path| {
            called.borrow_mut().push(path.to_path_buf());
            fs::remove_file(path).map_err(|error| error.to_string())
        })
        .unwrap();
        assert_eq!(result.completed_ids, vec!["path:remove.txt"]);
        assert!(result.error.is_none());
        assert_eq!(*called.borrow(), vec![root.join("remove.txt")]);
        assert!(!root.join("remove.txt").exists());
        assert_eq!(fs::read(root.join("keep.txt")).unwrap(), b"keep bytes");
        assert_eq!(
            fs::read(root.join(crate::backend::manifest::MANIFEST_NAME)).unwrap(),
            manifest_bytes
        );
    }

    #[test]
    fn trash_reports_partial_dispatch_failure_and_preserves_unrelated_snapshot_rows() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("one.txt"), b"one").unwrap();
        fs::write(root.join("two.txt"), b"two").unwrap();
        let targets = targets_for(&state, &root, &["one.txt", "two.txt"]);
        let attempts = RefCell::new(0);
        let result = delete_assets_with_dispatcher(&state, "library", &targets, |path| {
            let mut attempts = attempts.borrow_mut();
            *attempts += 1;
            if *attempts == 2 {
                Err("injected trash failure".into())
            } else {
                fs::remove_file(path).map_err(|error| error.to_string())
            }
        })
        .unwrap();
        assert_eq!(result.completed_ids, vec!["path:one.txt"]);
        assert_eq!(
            result.error.as_ref().unwrap().details.as_deref(),
            Some("injected trash failure")
        );
        assert_eq!(*attempts.borrow(), 2);
        assert!(!root.join("one.txt").exists());
        assert!(root.join("two.txt").exists());
        assert!(preview_asset_domain(&state, "library", "path:two.txt").is_ok());
        assert!(preview_asset_domain(&state, "library", "path:one.txt").is_err());
    }

    #[test]
    fn trash_accepts_fresh_metadata_revision_and_preserves_unselected_preview_and_edit() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("tagged.txt"), b"tagged").unwrap();
        fs::write(root.join("keep.txt"), b"keep").unwrap();
        let targets = targets_for(&state, &root, &["tagged.txt", "keep.txt"]);
        let tagged = super::super::edit_tags_domain(
            &state,
            "library",
            &targets[0].asset_id,
            &targets[0].expected_revision,
            &["favorite".into()],
            &[],
        )
        .unwrap();
        let selected = BulkTagTarget {
            asset_id: tagged.id.clone(),
            expected_revision: tagged.metadata_revision.clone(),
        };
        let result = delete_assets_with_dispatcher(&state, "library", &[selected], |path| {
            fs::remove_file(path).map_err(|error| error.to_string())
        })
        .unwrap();
        assert_eq!(result.completed_ids, vec!["path:tagged.txt"]);
        assert_eq!(
            preview_asset_domain(&state, "library", "path:keep.txt")
                .unwrap()
                .content
                .as_deref(),
            Some("keep")
        );
        assert!(preview_asset_domain(&state, "library", "path:tagged.txt").is_err());
        let keep_target = targets
            .iter()
            .find(|target| target.asset_id == "path:keep.txt")
            .unwrap();
        assert!(super::super::edit_tags_domain(
            &state,
            "library",
            &keep_target.asset_id,
            &keep_target.expected_revision,
            &["retained".into()],
            &[],
        )
        .is_ok());
        assert_eq!(fs::read(root.join("keep.txt")).unwrap(), b"keep");
    }

    #[test]
    fn missing_snapshot_row_cannot_trash_if_same_path_reappears() {
        let (_dir, root, state) = tag_test_library();
        let entry = crate::backend::manifest::Entry {
            id: "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e".into(),
            tags: vec!["stale".into()],
            notes: None,
            extra: Default::default(),
        };
        let mut manifest = crate::backend::manifest::Manifest::empty();
        manifest.items.insert("gone.txt".into(), entry);
        fs::write(
            root.join(crate::backend::manifest::MANIFEST_NAME),
            manifest.serialize().unwrap(),
        )
        .unwrap();
        let targets = targets_for(&state, &root, &["gone.txt"]);
        fs::write(root.join("gone.txt"), b"new different asset").unwrap();
        assert!(
            delete_assets_with_dispatcher(&state, "library", &targets, |_| {
                panic!("missing row must not reach trash dispatcher")
            })
            .is_err()
        );
        assert_eq!(
            fs::read(root.join("gone.txt")).unwrap(),
            b"new different asset"
        );
    }

    #[cfg(unix)]
    #[test]
    fn trash_rechecks_each_path_after_preflight_and_rejects_symlink_substitution() {
        use std::os::unix::fs::symlink;
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("one.txt"), b"one").unwrap();
        fs::write(root.join("two.txt"), b"two").unwrap();
        let targets = targets_for(&state, &root, &["one.txt", "two.txt"]);
        let mut calls = Vec::new();
        let result = delete_assets_with_dispatcher(&state, "library", &targets, |path| {
            calls.push(path.to_path_buf());
            if path.ends_with("one.txt") {
                fs::remove_file(root.join("one.txt")).unwrap();
                fs::remove_file(root.join("two.txt")).unwrap();
                symlink("/etc/passwd", root.join("two.txt")).unwrap();
            }
            Ok(())
        })
        .unwrap();
        assert_eq!(calls, vec![root.join("one.txt")]);
        assert_eq!(result.completed_ids, vec!["path:one.txt"]);
        assert!(result.error.as_ref().unwrap().message.contains("symlink"));
        assert!(fs::symlink_metadata(root.join("two.txt"))
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn trash_rechecks_freshness_after_preflight_and_rejects_replaced_file() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("one.txt"), b"one").unwrap();
        fs::write(root.join("two.txt"), b"two").unwrap();
        let targets = targets_for(&state, &root, &["one.txt", "two.txt"]);
        let calls = RefCell::new(Vec::new());
        let result = delete_assets_with_dispatcher(&state, "library", &targets, |path| {
            calls.borrow_mut().push(path.to_path_buf());
            if path.ends_with("one.txt") {
                fs::remove_file(path).unwrap();
                fs::write(root.join("two.txt"), b"replacement has different bytes").unwrap();
            }
            Ok(())
        })
        .unwrap();

        assert_eq!(*calls.borrow(), vec![root.join("one.txt")]);
        assert_eq!(result.completed_ids, vec!["path:one.txt"]);
        assert!(result
            .error
            .as_ref()
            .unwrap()
            .message
            .contains("changed since scan"));
        assert_eq!(
            fs::read(root.join("two.txt")).unwrap(),
            b"replacement has different bytes"
        );
    }

    #[cfg(unix)]
    #[test]
    fn trash_accepts_folder_containing_symlink_without_traversing_children() {
        use std::os::unix::fs::symlink;
        let (_dir, root, state) = tag_test_library();
        fs::create_dir(root.join("Folder")).unwrap();
        symlink("/etc/passwd", root.join("Folder/link.txt")).unwrap();
        let targets = targets_for(&state, &root, &["Folder"]);
        let mut called = Vec::new();
        let result = delete_assets_with_dispatcher(&state, "library", &targets, |path| {
            called.push(path.to_path_buf());
            assert_eq!(path, root.join("Folder"));
            Ok(())
        })
        .unwrap();
        assert_eq!(called, vec![root.join("Folder")]);
        assert_eq!(result.completed_ids, vec!["path:Folder"]);
    }

    #[cfg(unix)]
    #[test]
    fn trash_rejects_symlink_present_before_preflight() {
        use std::os::unix::fs::symlink;
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("regular.txt"), b"bytes").unwrap();
        let targets = targets_for(&state, &root, &["regular.txt"]);
        fs::remove_file(root.join("regular.txt")).unwrap();
        symlink("/etc/passwd", root.join("regular.txt")).unwrap();
        assert!(
            delete_assets_with_dispatcher(&state, "library", &targets, |_| {
                panic!("symlink must not reach trash dispatcher")
            })
            .is_err()
        );
        assert!(fs::symlink_metadata(root.join("regular.txt"))
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn preview_reads_bounded_utf8_and_supported_images_only() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("notes.txt"), "hello 世界".as_bytes()).unwrap();
        fs::write(root.join("large.txt"), vec![b'a'; TEXT_PREVIEW_LIMIT + 10]).unwrap();
        fs::write(root.join("model.stl"), b"solid model").unwrap();
        fs::write(root.join("photo.png"), [137, 80, 78, 71]).unwrap();
        let _targets = targets_for(
            &state,
            &root,
            &["notes.txt", "large.txt", "model.stl", "photo.png"],
        );
        let notes = preview_asset_domain(&state, "library", "path:notes.txt").unwrap();
        assert_eq!(notes.kind, "text");
        assert_eq!(notes.content.as_deref(), Some("hello 世界"));
        let large = preview_asset_domain(&state, "library", "path:large.txt").unwrap();
        assert_eq!(large.content.as_ref().unwrap().len(), TEXT_PREVIEW_LIMIT);
        assert!(large.truncated);
        let model = preview_asset_domain(&state, "library", "path:model.stl").unwrap();
        assert_eq!(model.kind, "unsupported");
        let image = preview_asset_domain(&state, "library", "path:photo.png").unwrap();
        assert_eq!(image.kind, "image");
        assert_eq!(image.mime_type.as_deref(), Some("image/png"));
        assert!(image.content.unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn preview_rejects_unsafe_ids_missing_assets_invalid_utf8_and_oversize_images() {
        let (_dir, root, state) = tag_test_library();
        fs::write(root.join("invalid.txt"), [0xff, 0xfe]).unwrap();
        fs::write(
            root.join("huge.gif"),
            vec![0; IMAGE_PREVIEW_LIMIT as usize + 1],
        )
        .unwrap();
        let _ = targets_for(&state, &root, &["invalid.txt", "huge.gif"]);
        assert!(preview_asset_domain(&state, "library", "path:../outside").is_err());
        assert!(preview_asset_domain(&state, "library", "path:absent.txt").is_err());
        assert_eq!(
            preview_asset_domain(&state, "library", "path:invalid.txt")
                .unwrap()
                .kind,
            "unsupported"
        );
        assert_eq!(
            preview_asset_domain(&state, "library", "path:huge.gif")
                .unwrap()
                .kind,
            "unsupported"
        );
    }

    #[test]
    fn preview_reports_folder_as_unsupported_and_does_not_change_bytes() {
        let (_dir, root, state) = tag_test_library();
        fs::create_dir(root.join("Folder")).unwrap();
        fs::write(root.join("Folder/readme.md"), b"# read me").unwrap();
        let bytes = fs::read(root.join("Folder/readme.md")).unwrap();
        let _ = targets_for(&state, &root, &["Folder", "Folder/readme.md"]);
        assert_eq!(
            preview_asset_domain(&state, "library", "path:Folder")
                .unwrap()
                .kind,
            "unsupported"
        );
        assert_eq!(
            preview_asset_domain(&state, "library", "path:Folder/readme.md")
                .unwrap()
                .kind,
            "text"
        );
        assert_eq!(fs::read(root.join("Folder/readme.md")).unwrap(), bytes);
    }

    #[test]
    fn preview_symlink_replacement_never_reads_target() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let (_dir, root, state) = tag_test_library();
            fs::write(root.join("preview.txt"), b"safe").unwrap();
            let _ = targets_for(&state, &root, &["preview.txt"]);
            fs::remove_file(root.join("preview.txt")).unwrap();
            symlink("/etc/passwd", root.join("preview.txt")).unwrap();
            assert!(preview_asset_domain(&state, "library", "path:preview.txt").is_err());
        }
    }
}
