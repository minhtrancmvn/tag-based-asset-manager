use super::*;
use tempfile::tempdir;

fn fixture() -> (tempfile::TempDir, PathBuf, BackendState) {
    let dir = tempdir().unwrap();
    let root = dir.path().join("library");
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let state = BackendState::load(dir.path().join("settings.json")).unwrap();
    state
        .mutate(|inner| {
            inner.libraries.push(LibrarySummary {
                id: "library".into(),
                name: "Library".into(),
                root_path: root.to_str().unwrap().into(),
                asset_count: 0,
                last_scan_at: None,
            });
            inner.active_library_id = Some("library".into());
            Ok(())
        })
        .unwrap();
    (dir, root, state)
}

fn scan(root: &Path, state: &BackendState) -> ScanResult {
    let result = scan_tree(root, "library", "scan", |_| {}).unwrap();
    record_edit_snapshot(&mut state.inner.lock().unwrap(), root, &result);
    result
}

fn targets(result: &ScanResult, paths: &[&str]) -> Vec<BulkTagTarget> {
    paths
        .iter()
        .map(|path| {
            let asset = result
                .assets
                .iter()
                .find(|asset| asset.relative_path == *path)
                .unwrap();
            BulkTagTarget {
                asset_id: asset.id.clone(),
                expected_revision: asset.metadata_revision.clone(),
            }
        })
        .collect()
}

#[test]
fn folder_self_and_child_share_one_atomic_write() {
    let (_dir, root, state) = fixture();
    fs::create_dir(root.join("Folder")).unwrap();
    fs::write(root.join("Folder/model.stl"), b"model").unwrap();
    let before = scan(&root, &state);
    let targets = targets(&before, &["Folder", "Folder/model.stl"]);
    let mut writes = 0;
    let result = bulk_edit_tags_with_writer(
        &state,
        "library",
        &targets,
        &[" Favorite ".into()],
        &[],
        |path, expected, bytes| {
            writes += 1;
            manifest::write_atomic(path, expected, bytes)
        },
    )
    .unwrap();
    assert_eq!(writes, 1);
    assert!(result.error.is_none());
    assert_eq!(result.assets.len(), 2);
    assert!(!root.join(manifest::MANIFEST_NAME).exists());
    let metadata = match manifest::read(&root.join("Folder")) {
        manifest::ReadManifest::Valid { manifest, .. } => manifest,
        other => panic!("{other:?}"),
    };
    assert_eq!(metadata.items["."].tags, vec!["favorite"]);
    assert_eq!(metadata.items["model.stl"].tags, vec!["favorite"]);
    assert_ne!(metadata.items["."].id, metadata.items["model.stl"].id);
    assert_eq!(fs::read(root.join("Folder/model.stl")).unwrap(), b"model");
}

#[test]
fn later_failure_preserves_existing_sidecar_and_reports_exact_completed_count() {
    let (_dir, root, state) = fixture();
    for folder in ["a", "b"] {
        fs::create_dir(root.join(folder)).unwrap();
        fs::write(root.join(folder).join("model.stl"), folder.as_bytes()).unwrap();
    }
    let mut original = manifest::Manifest::empty();
    original.items.insert(
        "model.stl".into(),
        manifest::Entry {
            id: "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e".into(),
            tags: vec!["old".into()],
            notes: Some("keep".into()),
            extra: Default::default(),
        },
    );
    let bytes = original.serialize().unwrap();
    fs::write(root.join("b").join(manifest::MANIFEST_NAME), &bytes).unwrap();
    let before = scan(&root, &state);
    let targets = targets(&before, &["a/model.stl", "b/model.stl"]);
    let mut attempt = 0;
    let result = bulk_edit_tags_with_writer(
        &state,
        "library",
        &targets,
        &["new".into()],
        &[],
        |path, expected, replacement| {
            attempt += 1;
            if attempt == 1 {
                manifest::write_atomic(path, expected, replacement)
            } else {
                manifest::write_atomic_with_replace(path, expected, replacement, |_, _| {
                    Err("replace denied".into())
                })
            }
        },
    )
    .unwrap();
    assert_eq!(result.assets.len(), 1);
    assert_eq!(result.assets[0].relative_path, "a/model.stl");
    assert!(result.error.as_ref().unwrap().message.contains("1 of 2"));
    assert_eq!(
        result.error.unwrap().details.as_deref(),
        Some("replace denied")
    );
    assert_eq!(
        fs::read(root.join("b").join(manifest::MANIFEST_NAME)).unwrap(),
        bytes
    );
    assert_eq!(fs::read_dir(root.join("b")).unwrap().count(), 2);
    assert_eq!(fs::read(root.join("a/model.stl")).unwrap(), b"a");
    assert_eq!(fs::read(root.join("b/model.stl")).unwrap(), b"b");
}

#[test]
fn preferences_rollback_on_closure_error_and_survive_scan_summary_persistence() {
    let (dir, root, state) = fixture();
    let filters = SearchFilters {
        query: "favorite -status:printed".into(),
        view: SearchView::Untagged,
        match_mode: MatchMode::Any,
        kind: SearchKind::Folder,
    };
    let saved =
        upsert_saved_search_domain(&state, "library", "Favorites", filters.clone(), None).unwrap();
    let before = fs::read(dir.path().join("settings.json")).unwrap();
    let failed = state.mutate(|inner| {
        inner.saved_searches.clear();
        inner.libraries.clear();
        inner.active_library_id = None;
        Err::<(), String>("cancelled".into())
    });
    assert!(failed.is_err());
    assert_eq!(state.snapshot().unwrap(), saved);
    assert_eq!(fs::read(dir.path().join("settings.json")).unwrap(), before);
    let result = scan(&root, &state);
    state
        .mutate(|inner| {
            inner.libraries[0].asset_count = result.assets.len();
            inner.libraries[0].last_scan_at = Some(result.scanned_at.clone());
            Ok(())
        })
        .unwrap();
    let loaded = BackendState::load(dir.path().join("settings.json"))
        .unwrap()
        .snapshot()
        .unwrap();
    assert_eq!(loaded.active_library_id.as_deref(), Some("library"));
    assert_eq!(loaded.libraries[0].root_path, root.to_str().unwrap());
    assert_eq!(loaded.saved_searches, saved.saved_searches);
    assert_eq!(loaded.saved_searches[0].filters, filters);
    assert_eq!(loaded.libraries[0].last_scan_at, Some(result.scanned_at));
}
