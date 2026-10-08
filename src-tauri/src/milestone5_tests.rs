use super::milestone5::{
    asset_action_with_dispatch, export_with_picker, reconnect_asset_domain,
    reconnect_targets_domain, validate_metadata_domain,
};
use super::*;
use tempfile::tempdir;

fn library() -> (tempfile::TempDir, PathBuf, BackendState) {
    let temporary = tempdir().unwrap();
    let root = temporary.path().join("library");
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let state = BackendState::load(temporary.path().join("settings.json")).unwrap();
    state
        .mutate(|inner| {
            inner.libraries.push(LibrarySummary {
                id: "library".into(),
                name: "Test".into(),
                root_path: root.to_str().unwrap().into(),
                asset_count: 0,
                last_scan_at: None,
            });
            Ok(())
        })
        .unwrap();
    (temporary, root, state)
}

fn scan(root: &Path, state: &BackendState) -> ScanResult {
    let result = scan_tree(root, "library", "scan", |_| {}).unwrap();
    record_edit_snapshot(&mut state.inner.lock().unwrap(), root, &result);
    result
}

fn entry() -> manifest::Entry {
    manifest::Entry {
        id: "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e".into(),
        tags: vec![" Favorite ".into()],
        notes: Some("keep note".into()),
        extra: [("future".into(), serde_json::json!({"keep": true}))]
            .into_iter()
            .collect(),
    }
}

fn missing_setup(root: &Path, state: &BackendState) -> Asset {
    fs::write(root.join("猫 replacement.stl"), b"asset bytes").unwrap();
    let mut metadata = manifest::Manifest::empty();
    metadata
        .extra
        .insert("unknown".into(), serde_json::json!(42));
    metadata.items.insert("gone.stl".into(), entry());
    fs::write(
        root.join(manifest::MANIFEST_NAME),
        metadata.serialize().unwrap(),
    )
    .unwrap();
    scan(root, state)
        .assets
        .into_iter()
        .find(|asset| asset.relative_path == "gone.stl")
        .unwrap()
}

#[test]
fn native_actions_dispatch_exact_unicode_paths_without_shell_or_asset_changes() {
    let (_temporary, root, state) = library();
    fs::create_dir(root.join("日本語 folder")).unwrap();
    let relative = "日本語 folder/猫 space;$(unsafe).stl";
    fs::write(root.join(relative), b"unchanged").unwrap();
    let asset = scan(&root, &state)
        .assets
        .into_iter()
        .find(|asset| asset.relative_path == relative)
        .unwrap();
    for action in [
        AssetAction::Open,
        AssetAction::Reveal,
        AssetAction::CopyFullPath,
        AssetAction::CopyRelativePath,
    ] {
        asset_action_with_dispatch(
            &state,
            "library",
            &asset.id,
            action,
            |actual, path, text| {
                assert_eq!(actual, action);
                assert_eq!(path, root.join(relative));
                assert_eq!(
                    text,
                    if action == AssetAction::CopyRelativePath {
                        relative.to_string()
                    } else {
                        root.join(relative).to_str().unwrap().to_string()
                    }
                );
                Ok(())
            },
        )
        .unwrap();
    }
    assert_eq!(fs::read(root.join(relative)).unwrap(), b"unchanged");
}

#[test]
fn native_actions_reject_unknown_unscanned_missing_traversal_and_junk_ids() {
    let (_temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    for (library, id) in [
        ("unknown", "path:."),
        ("library", "path:unscanned.stl"),
        ("library", "path:../escape"),
        ("library", "path:/tmp/outside"),
        ("library", "path:.asset-tags.json"),
        ("library", "path:.DS_Store"),
        ("library", missing.id.as_str()),
    ] {
        assert!(asset_action_with_dispatch(
            &state,
            library,
            id,
            AssetAction::Open,
            |_, _, _| panic!("must reject before dispatch")
        )
        .is_err());
    }
    fs::remove_file(root.join("猫 replacement.stl")).unwrap();
    assert!(asset_action_with_dispatch(
        &state,
        "library",
        "path:猫 replacement.stl",
        AssetAction::Open,
        |_, _, _| panic!("gone file must reject")
    )
    .is_err());
}

#[test]
fn validation_fresh_scan_preserves_settings_and_reports_metadata_errors() {
    let (temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    fs::create_dir(root.join("bad")).unwrap();
    fs::write(root.join("bad/.asset-tags.json"), b"{broken").unwrap();
    fs::create_dir(root.join("invalid")).unwrap();
    let invalid = br#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{"x":{"id":"bad","tags":[42]}}}"#;
    fs::write(root.join("invalid/.asset-tags.json"), invalid).unwrap();
    fs::create_dir(root.join("duplicate")).unwrap();
    let mut duplicate = manifest::Manifest::empty();
    duplicate.items.insert(".".into(), entry());
    fs::write(
        root.join("duplicate/.asset-tags.json"),
        duplicate.serialize().unwrap(),
    )
    .unwrap();
    let before = fs::read(temporary.path().join("settings.json")).unwrap();
    let report = validate_metadata_domain(&state, "library").unwrap();
    assert_eq!(report.library_id, "library");
    assert_eq!(report.assets_checked, 6);
    assert!(DateTime::parse_from_rfc3339(&report.validated_at).is_ok());
    for message in [
        "Metadata manifest is blocked",
        "Duplicate metadata UUID",
        "Metadata reference is missing",
    ] {
        assert!(report.issues.iter().any(|issue| issue.message == message));
    }
    assert_eq!(
        fs::read(temporary.path().join("settings.json")).unwrap(),
        before
    );
    assert_eq!(
        fs::read(root.join("bad/.asset-tags.json")).unwrap(),
        b"{broken"
    );
    assert_eq!(
        fs::read(root.join("invalid/.asset-tags.json")).unwrap(),
        invalid
    );
    assert_eq!(missing.metadata_id, Some(entry().id));
}

#[test]
fn reconnect_transfers_exact_entry_to_same_folder_without_asset_operations() {
    let (temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    let before_settings = fs::read(temporary.path().join("settings.json")).unwrap();
    let targets =
        reconnect_targets_domain(&state, "library", &missing.id, &missing.metadata_revision)
            .unwrap();
    assert_eq!(
        targets
            .iter()
            .map(|asset| asset.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec!["猫 replacement.stl"]
    );
    let result = reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        &targets[0].id,
    )
    .unwrap();
    assert_eq!(result.assets.len(), 2);
    assert!(result.assets.iter().all(|asset| asset.status != "missing"));
    let target = result
        .assets
        .iter()
        .find(|asset| asset.relative_path == "猫 replacement.stl")
        .unwrap();
    assert_eq!(target.metadata_id, missing.metadata_id);
    assert_eq!(target.tags, missing.tags);
    assert_eq!(target.notes, missing.notes);
    let after = match manifest::read(&root) {
        manifest::ReadManifest::Valid { manifest, .. } => manifest,
        _ => panic!("valid"),
    };
    assert_eq!(after.items["猫 replacement.stl"], entry());
    assert!(!after.items.contains_key("gone.stl"));
    assert_eq!(after.extra["unknown"], 42);
    assert_eq!(
        fs::read(root.join("猫 replacement.stl")).unwrap(),
        b"asset bytes"
    );
    assert!(!root.join("gone.stl").exists());
    assert_eq!(
        fs::read(temporary.path().join("settings.json")).unwrap(),
        before_settings
    );
    asset_action_with_dispatch(
        &state,
        "library",
        &target.id,
        AssetAction::CopyRelativePath,
        |_, _, text| {
            assert_eq!(text, "猫 replacement.stl");
            Ok(())
        },
    )
    .unwrap();
}

#[test]
fn reconnect_rejects_stale_source_returned_source_occupied_and_wrong_folder() {
    let (_temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    fs::create_dir(root.join("folder")).unwrap();
    fs::write(root.join("folder/other.stl"), b"outside folder").unwrap();
    fs::create_dir(root.join("directory.stl")).unwrap();
    scan(&root, &state);
    let before = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
    for (source, revision, target) in [
        (&missing.id[..], "stale", "path:猫 replacement.stl"),
        (
            &missing.id[..],
            &missing.metadata_revision[..],
            "path:folder/other.stl",
        ),
        (
            &missing.id[..],
            &missing.metadata_revision[..],
            "path:directory.stl",
        ),
        (
            "path:unscanned.stl",
            &missing.metadata_revision[..],
            "path:猫 replacement.stl",
        ),
        (
            &missing.id[..],
            &missing.metadata_revision[..],
            &missing.id[..],
        ),
    ] {
        assert!(reconnect_asset_domain(&state, "library", source, revision, target).is_err());
        assert_eq!(
            fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
            before
        );
    }
    fs::write(root.join("gone.stl"), b"returned").unwrap();
    assert!(
        reconnect_targets_domain(&state, "library", &missing.id, &missing.metadata_revision)
            .is_err()
    );
    assert_eq!(
        fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
        before
    );
    fs::remove_file(root.join("gone.stl")).unwrap();
    let mut occupied = match manifest::read(&root) {
        manifest::ReadManifest::Valid { manifest, .. } => manifest,
        _ => panic!("valid"),
    };
    occupied.items.insert(
        "猫 replacement.stl".into(),
        manifest::Entry {
            id: "bb4e208d-7415-4ba7-9d7d-92192611f6f8".into(),
            tags: vec![],
            notes: None,
            extra: Default::default(),
        },
    );
    fs::write(
        root.join(manifest::MANIFEST_NAME),
        occupied.serialize().unwrap(),
    )
    .unwrap();
    let occupied_bytes = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
    assert!(reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl"
    )
    .is_err());
    assert_eq!(
        fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
        occupied_bytes
    );
}

#[test]
fn reconnect_rejects_fresh_duplicate_uuid_and_malformed_metadata() {
    let (_temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    fs::create_dir(root.join("duplicate")).unwrap();
    let mut duplicate = manifest::Manifest::empty();
    duplicate.items.insert(".".into(), entry());
    fs::write(
        root.join("duplicate/.asset-tags.json"),
        duplicate.serialize().unwrap(),
    )
    .unwrap();
    let before = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
    assert!(reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl"
    )
    .is_err());
    assert_eq!(
        fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
        before
    );
    fs::remove_file(root.join("duplicate/.asset-tags.json")).unwrap();
    fs::write(root.join(manifest::MANIFEST_NAME), b"{broken").unwrap();
    assert!(reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl"
    )
    .is_err());
    assert_eq!(
        fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
        b"{broken"
    );
}

#[test]
fn export_new_native_selected_json_includes_missing_metadata_and_raw_sidecars() {
    let (temporary, root, state) = library();
    missing_setup(&root, &state);
    fs::create_dir(root.join("bad")).unwrap();
    fs::write(root.join("bad/.asset-tags.json"), b"{broken").unwrap();
    let destination = fs::canonicalize(temporary.path())
        .unwrap()
        .join("backup 日本語.json");
    let before = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
    let before_settings = fs::read(temporary.path().join("settings.json")).unwrap();
    let result = export_with_picker(&state, "library", || Ok(Some(destination.clone())))
        .unwrap()
        .unwrap();
    assert_eq!(result.path, destination.to_str().unwrap());
    assert_eq!(result.asset_count, 4);
    let backup: serde_json::Value =
        serde_json::from_slice(&fs::read(&destination).unwrap()).unwrap();
    assert_eq!(backup["backupVersion"], 1);
    assert_eq!(backup["library"]["id"], "library");
    assert!(DateTime::parse_from_rfc3339(backup["exportedAt"].as_str().unwrap()).is_ok());
    let missing = backup["assets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|asset| asset["relativePath"] == "gone.stl")
        .unwrap();
    assert_eq!(missing["metadataId"], entry().id);
    assert_eq!(missing["notes"], "keep note");
    assert_eq!(missing["status"], "missing");
    let sidecar = backup["manifests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|manifest| manifest["path"] == ".asset-tags.json")
        .unwrap();
    assert_eq!(
        sidecar["metadata"]["items"]["gone.stl"]["future"]["keep"],
        true
    );
    assert_eq!(sidecar["rawBytes"], serde_json::json!(before));
    let broken = backup["manifests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|manifest| manifest["path"] == "bad/.asset-tags.json")
        .unwrap();
    assert_eq!(broken["state"], "blocked");
    assert_eq!(broken["rawBytes"], serde_json::json!(b"{broken".to_vec()));
    assert_eq!(
        fs::read(root.join("猫 replacement.stl")).unwrap(),
        b"asset bytes"
    );
    assert_eq!(
        fs::read(temporary.path().join("settings.json")).unwrap(),
        before_settings
    );
    assert_eq!(fs::read_dir(temporary.path()).unwrap().count(), 3);
}

#[test]
fn export_cancel_writes_nothing_and_existing_destinations_are_never_overwritten() {
    let (temporary, root, state) = library();
    missing_setup(&root, &state);
    assert_eq!(
        export_with_picker(&state, "library", || Ok(None)).unwrap(),
        None
    );
    assert_eq!(fs::read_dir(temporary.path()).unwrap().count(), 2);
    let destination = fs::canonicalize(temporary.path())
        .unwrap()
        .join("ordinary.json");
    fs::write(&destination, b"ordinary asset").unwrap();
    assert!(export_with_picker(&state, "library", || Ok(Some(destination.clone()))).is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"ordinary asset");
    let traversal = root.join("../escape.json");
    assert!(
        traversal
            .components()
            .any(|component| component == std::path::Component::ParentDir),
        "traversal fixture lost ParentDir: root={root:?}, destination={traversal:?}"
    );
    for path in [
        root.join(manifest::MANIFEST_NAME),
        root.join(".asset-tags-conflict.json"),
        root.join(".asset-tags.tmp-export.json"),
        root.join("not-json.stl"),
        traversal,
    ] {
        let result = export_with_picker(&state, "library", || Ok(Some(path.clone())));
        assert!(result.is_err(), "unexpected export success: {path:?}");
    }
    assert!(export_with_picker(&state, "unknown", || panic!(
        "unknown library must reject before picker"
    ))
    .is_err());
    assert_eq!(fs::read_dir(temporary.path()).unwrap().count(), 3);
}

#[cfg(unix)]
#[test]
fn native_actions_reject_symlink_component_replacement_without_dispatch() {
    use std::os::unix::fs::symlink;
    let (_temporary, root, state) = library();
    fs::create_dir(root.join("folder")).unwrap();
    fs::write(root.join("folder/model.stl"), b"inside").unwrap();
    scan(&root, &state);
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("model.stl"), b"outside").unwrap();
    fs::remove_file(root.join("folder/model.stl")).unwrap();
    fs::remove_dir(root.join("folder")).unwrap();
    symlink(outside.path(), root.join("folder")).unwrap();
    assert!(asset_action_with_dispatch(
        &state,
        "library",
        "path:folder/model.stl",
        AssetAction::Reveal,
        |_, _, _| panic!("unsafe dispatch")
    )
    .is_err());
    assert_eq!(
        fs::read(outside.path().join("model.stl")).unwrap(),
        b"outside"
    );
}

#[cfg(unix)]
#[test]
fn validation_reports_unreadable_directory_and_preserves_original_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let (_temporary, root, state) = library();
    let folder = root.join("unreadable");
    fs::create_dir(&folder).unwrap();
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o000)).unwrap();
    let report = validate_metadata_domain(&state, "library");
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(report
        .unwrap()
        .issues
        .iter()
        .any(|issue| issue.message == "Could not read directory" && issue.path == "unreadable"));
}

#[test]
fn reconnect_rejects_external_source_metadata_change_and_deleted_target() {
    let (_temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    let mut changed = match manifest::read(&root) {
        manifest::ReadManifest::Valid { manifest, .. } => manifest,
        _ => panic!("valid"),
    };
    changed.items.get_mut("gone.stl").unwrap().notes = Some("external edit".into());
    let bytes = changed.serialize().unwrap();
    fs::write(root.join(manifest::MANIFEST_NAME), &bytes).unwrap();
    assert!(
        reconnect_targets_domain(&state, "library", &missing.id, &missing.metadata_revision)
            .is_err()
    );
    assert_eq!(fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(), bytes);
    let missing = scan(&root, &state)
        .assets
        .into_iter()
        .find(|asset| asset.status == "missing")
        .unwrap();
    fs::remove_file(root.join("猫 replacement.stl")).unwrap();
    assert!(reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl"
    )
    .is_err());
    assert_eq!(fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(), bytes);
}

#[test]
fn reconnect_atomic_failure_preserves_old_bytes_and_cleans_temporary_file() {
    let (_temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    let before = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
    let result = super::milestone5::reconnect_with_writer(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl",
        |path, expected, bytes| {
            manifest::write_atomic_with_replace(path, expected, bytes, |_, _| {
                Err("injected replacement failure".into())
            })
        },
    );
    assert!(result
        .unwrap_err()
        .message
        .contains("injected replacement failure"));
    assert_eq!(
        fs::read(root.join(manifest::MANIFEST_NAME)).unwrap(),
        before
    );
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    assert_eq!(
        fs::read(root.join("猫 replacement.stl")).unwrap(),
        b"asset bytes"
    );
}

#[test]
fn reconnect_saved_refresh_failure_returns_committed_rows_with_visible_issue() {
    let (_temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    let manifest::ReadManifest::Valid { mut manifest, .. } = manifest::read(&root) else {
        panic!("Expected valid source manifest");
    };
    let mut unrelated = entry();
    unrelated.id = Uuid::new_v4().to_string();
    manifest.items.insert("other-missing.stl".into(), unrelated);
    fs::write(
        root.join(manifest::MANIFEST_NAME),
        manifest.serialize().unwrap(),
    )
    .unwrap();
    scan(&root, &state);
    let moved = root.with_file_name("temporarily-offline");
    let result = super::milestone5::reconnect_with_writer(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl",
        |path, expected, bytes| {
            manifest::write_atomic(path, expected, bytes)?;
            fs::rename(&root, &moved).map_err(|error| error.to_string())
        },
    )
    .unwrap();
    fs::rename(&moved, &root).unwrap();
    assert!(result
        .issues
        .iter()
        .any(|issue| issue.message == "Reconnect saved; library refresh failed"));
    assert!(result.assets.iter().all(|asset| asset.id != missing.id));
    assert!(!result.issues.iter().any(|issue| {
        issue.message == "Metadata reference is missing" && issue.path == "./gone.stl"
    }));
    assert!(result.issues.iter().any(|issue| {
        issue.message == "Metadata reference is missing" && issue.path == "./other-missing.stl"
    }));
    let target = result
        .assets
        .iter()
        .find(|asset| asset.relative_path == "猫 replacement.stl")
        .unwrap();
    assert_eq!(target.metadata_id, missing.metadata_id);
    assert!(
        matches!(manifest::read(&root), manifest::ReadManifest::Valid { manifest, .. } if manifest.items.contains_key("猫 replacement.stl") && !manifest.items.contains_key("gone.stl"))
    );
}

#[cfg(unix)]
#[test]
fn reconnect_rejects_symlink_target_linked_manifest_and_hardlinked_target() {
    use std::os::unix::fs::symlink;
    let (_temporary, root, state) = library();
    let missing = missing_setup(&root, &state);
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("asset.stl"), b"outside").unwrap();
    fs::remove_file(root.join("猫 replacement.stl")).unwrap();
    symlink(
        outside.path().join("asset.stl"),
        root.join("猫 replacement.stl"),
    )
    .unwrap();
    let before = fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
    assert!(reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl"
    )
    .is_err());
    fs::remove_file(root.join("猫 replacement.stl")).unwrap();
    fs::hard_link(
        outside.path().join("asset.stl"),
        root.join("猫 replacement.stl"),
    )
    .unwrap();
    scan(&root, &state);
    assert!(reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl"
    )
    .is_err());
    fs::remove_file(root.join("猫 replacement.stl")).unwrap();
    fs::write(root.join("猫 replacement.stl"), b"asset").unwrap();
    fs::write(outside.path().join("metadata.json"), &before).unwrap();
    fs::remove_file(root.join(manifest::MANIFEST_NAME)).unwrap();
    fs::hard_link(
        outside.path().join("metadata.json"),
        root.join(manifest::MANIFEST_NAME),
    )
    .unwrap();
    assert!(reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:猫 replacement.stl"
    )
    .is_err());
    assert_eq!(
        fs::read(outside.path().join("metadata.json")).unwrap(),
        before
    );
    assert_eq!(
        fs::read(outside.path().join("asset.stl")).unwrap(),
        b"outside"
    );
}

#[test]
fn export_publication_failure_cleans_temp_without_touching_existing_asset() {
    let temporary = tempdir().unwrap();
    let directory = fs::canonicalize(temporary.path()).unwrap();
    fs::write(directory.join("ordinary.stl"), b"asset").unwrap();
    let destination = directory.join("backup.json");
    let result = super::milestone5::write_backup_with_publish(&destination, b"{}", |_, _| {
        Err("injected publication failure".into())
    });
    assert!(result
        .unwrap_err()
        .message
        .contains("injected publication failure"));
    assert!(!destination.exists());
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    assert_eq!(fs::read(directory.join("ordinary.stl")).unwrap(), b"asset");
}

#[test]
fn export_create_only_publication_rejects_concurrent_existing_destination() {
    let temporary = tempdir().unwrap();
    let directory = fs::canonicalize(temporary.path()).unwrap();
    let destination = directory.join("backup.json");
    let result =
        super::milestone5::write_backup_with_publish(&destination, b"{}", |temp, destination| {
            fs::write(destination, b"concurrent asset").unwrap();
            fs::hard_link(temp, destination).map_err(|error| error.to_string())
        });
    assert!(result.is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"concurrent asset");
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn export_rejects_symlink_destination_and_ancestor_without_external_writes() {
    use std::os::unix::fs::symlink;
    let (temporary, root, state) = library();
    missing_setup(&root, &state);
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("ordinary.json"), b"outside").unwrap();
    let directory = fs::canonicalize(temporary.path()).unwrap();
    symlink(
        outside.path().join("ordinary.json"),
        directory.join("backup.json"),
    )
    .unwrap();
    assert!(export_with_picker(&state, "library", || Ok(Some(
        directory.join("backup.json")
    )))
    .is_err());
    symlink(outside.path(), directory.join("linked")).unwrap();
    assert!(export_with_picker(&state, "library", || Ok(Some(
        directory.join("linked/new.json")
    )))
    .is_err());
    assert_eq!(
        fs::read(outside.path().join("ordinary.json")).unwrap(),
        b"outside"
    );
    assert!(!outside.path().join("new.json").exists());
}

#[test]
fn copied_fixture_reconnect_removes_missing_row_preserves_all_asset_bytes_and_uuid() {
    fn copy(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for child in fs::read_dir(from).unwrap() {
            let child = child.unwrap();
            if child.file_type().unwrap().is_dir() {
                copy(&child.path(), &to.join(child.file_name()));
            } else {
                fs::copy(child.path(), to.join(child.file_name())).unwrap();
            }
        }
    }
    let temporary = tempdir().unwrap();
    let root = temporary.path().join("library");
    copy(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample-library"),
        &root,
    );
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
    let first = scan(&root, &state);
    assert_eq!(first.assets.len(), 9);
    let bytes: Vec<_> = first
        .assets
        .iter()
        .filter(|asset| asset.kind == "file" && asset.status != "missing")
        .map(|asset| {
            (
                asset.relative_path.clone(),
                fs::read(root.join(&asset.relative_path)).unwrap(),
            )
        })
        .collect();
    let missing = first
        .assets
        .iter()
        .find(|asset| asset.relative_path == "Animals/Missing Fox.stl")
        .unwrap();
    fs::write(
        root.join("Animals/Fox renamed.stl"),
        b"replacement placeholder",
    )
    .unwrap();
    let targets =
        reconnect_targets_domain(&state, "library", &missing.id, &missing.metadata_revision)
            .unwrap();
    let target = targets
        .iter()
        .find(|asset| asset.relative_path == "Animals/Fox renamed.stl")
        .unwrap();
    let result = reconnect_asset_domain(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        &target.id,
    )
    .unwrap();
    assert_eq!(result.assets.len(), 9); // Eight existing fixture rows plus explicitly supplied replacement.
    assert!(result.assets.iter().all(|asset| asset.status != "missing"));
    let repaired = result
        .assets
        .iter()
        .find(|asset| asset.id == target.id)
        .unwrap();
    assert_eq!(repaired.metadata_id, missing.metadata_id);
    assert_eq!(repaired.tags, missing.tags);
    assert_eq!(repaired.notes, missing.notes);
    for (relative, before) in bytes {
        assert_eq!(fs::read(root.join(relative)).unwrap(), before);
    }
    assert_eq!(
        fs::read(root.join("Animals/Fox renamed.stl")).unwrap(),
        b"replacement placeholder"
    );
    assert!(!root.join("Animals/Missing Fox.stl").exists());
}

#[cfg(windows)]
#[test]
fn windows_native_paths_accept_verbatim_drive_and_unc_representation_only() {
    assert!(super::milestone5::same_native_path(
        Path::new(r"\\?\C:\Users\日本語"),
        Path::new(r"C:\Users\日本語")
    ));
    assert!(super::milestone5::same_native_path(
        Path::new(r"\\?\UNC\server\share\folder"),
        Path::new(r"\\server\share\folder")
    ));
    assert!(!super::milestone5::same_native_path(
        Path::new(r"\\?\C:\outside"),
        Path::new(r"C:\inside")
    ));
}

#[test]
fn scan_reports_conflict_copies_without_listing_or_changing_them() {
    let temporary = tempdir().unwrap();
    let root = fs::canonicalize(temporary.path()).unwrap();
    fs::write(root.join("model.stl"), b"asset").unwrap();
    let conflict = root.join(".asset-tags-PC conflicted copy.json");
    fs::write(&conflict, b"{broken conflict").unwrap();
    let scan = scan_tree(&root, "library", "scan", |_| {}).unwrap();
    assert!(scan
        .issues
        .iter()
        .any(|issue| issue.message == "Possible metadata conflict copy"));
    assert_eq!(
        scan.assets
            .iter()
            .map(|asset| asset.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec![".", "model.stl"]
    );
    assert_eq!(fs::read(conflict).unwrap(), b"{broken conflict");
}
