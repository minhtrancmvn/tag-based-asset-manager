use super::*;
use tempfile::tempdir;

#[test]
fn fresh_snapshot_serializes_default_workshop_theme() {
    let dir = tempdir().unwrap();
    let settings_path = dir.path().join("settings.json");
    let state = BackendState::load(settings_path.clone()).unwrap();
    let snapshot = serde_json::to_value(state.snapshot().unwrap()).unwrap();
    assert_eq!(snapshot.get("theme"), Some(&serde_json::json!("workshop")));
    assert!(!settings_path.exists(), "loading must not create settings");
}

#[test]
fn legacy_settings_default_to_workshop_without_rewriting() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let bytes = br#"{"version":1,"libraries":[],"activeLibraryId":null,"custom":{"keep":true}}"#;
    fs::write(&path, bytes).unwrap();
    let state = BackendState::load(path.clone()).unwrap();
    assert_eq!(state.snapshot().unwrap().theme, AppTheme::Workshop);
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn every_theme_round_trips_through_settings_and_snapshot() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = BackendState::load(path.clone()).unwrap();
    for name in [
        "workshop", "coral", "lavender", "ocean", "mint", "sunset", "stone", "midnight",
    ] {
        let theme: AppTheme = serde_json::from_value(serde_json::json!(name)).unwrap();
        let returned = set_app_theme_domain(&state, theme).unwrap();
        assert_eq!(returned.theme, theme);
        assert_eq!(serde_json::to_value(&returned).unwrap()["theme"], name);
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted["theme"], name);
        assert_eq!(
            BackendState::load(path.clone())
                .unwrap()
                .snapshot()
                .unwrap(),
            returned
        );
    }
}

#[test]
fn invalid_theme_arguments_and_settings_preserve_existing_bytes() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = BackendState::load(path.clone()).unwrap();
    set_app_theme_domain(&state, AppTheme::Coral).unwrap();
    let before = fs::read(&path).unwrap();
    for value in [
        serde_json::json!("unknown"),
        serde_json::json!("Coral"),
        serde_json::json!(" coral "),
        serde_json::json!(null),
        serde_json::json!(42),
    ] {
        assert!(serde_json::from_value::<AppTheme>(value.clone()).is_err());
        assert_eq!(state.snapshot().unwrap().theme, AppTheme::Coral);
        assert_eq!(fs::read(&path).unwrap(), before);
        let mut settings: serde_json::Value = serde_json::from_slice(&before).unwrap();
        settings["theme"] = value;
        let invalid_bytes = serde_json::to_vec(&settings).unwrap();
        fs::write(&path, &invalid_bytes).unwrap();
        let invalid = BackendState::load(path.clone()).unwrap();
        assert_eq!(
            invalid.snapshot().unwrap_err().message,
            "Could not load library settings"
        );
        assert!(set_app_theme_domain(&invalid, AppTheme::Mint).is_err());
        assert_eq!(fs::read(&path).unwrap(), invalid_bytes);
        fs::write(&path, &before).unwrap();
    }
}

#[test]
fn theme_rolls_back_on_closure_error() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = BackendState::load(path.clone()).unwrap();
    set_app_theme_domain(&state, AppTheme::Ocean).unwrap();
    let before = state.snapshot().unwrap();
    let bytes = fs::read(&path).unwrap();
    let result: CommandResult<()> = state.mutate(|inner| {
        inner.theme = AppTheme::Sunset;
        inner
            .settings_extra
            .insert("discard".into(), serde_json::json!(true));
        Err("closure rejected".into())
    });
    assert_eq!(result.unwrap_err().message, "closure rejected");
    assert_eq!(state.snapshot().unwrap(), before);
    assert!(!state
        .inner
        .lock()
        .unwrap()
        .settings_extra
        .contains_key("discard"));
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn theme_rolls_back_when_atomic_settings_replacement_fails() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = BackendState::load(path.clone()).unwrap();
    set_app_theme_domain(&state, AppTheme::Lavender).unwrap();
    let before = state.snapshot().unwrap();
    let bytes = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let sentinel = path.join("keep.json");
    fs::write(&sentinel, &bytes).unwrap();
    let error = set_app_theme_domain(&state, AppTheme::Midnight).unwrap_err();
    assert_eq!(error.message, "Could not save library settings");
    assert_eq!(state.snapshot().unwrap(), before);
    assert_eq!(fs::read(sentinel).unwrap(), bytes);
    assert_eq!(
        fs::read_dir(dir.path()).unwrap().count(),
        1,
        "failed temporary cleaned"
    );
}

#[test]
fn library_removal_returns_selected_theme_and_preserves_remaining_registration() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = BackendState::load(path.clone()).unwrap();
    state
        .mutate(|inner| {
            for id in ["remove", "keep"] {
                let root = dir.path().join(id);
                fs::create_dir(&root).map_err(|error| error.to_string())?;
                inner.libraries.push(LibrarySummary {
                    id: id.into(),
                    name: id.into(),
                    root_path: fs::canonicalize(root)
                        .map_err(|error| error.to_string())?
                        .to_string_lossy()
                        .into_owned(),
                    asset_count: 0,
                    last_scan_at: None,
                });
            }
            inner.active_library_id = Some("keep".into());
            Ok(())
        })
        .unwrap();
    set_app_theme_domain(&state, AppTheme::Sunset).unwrap();
    let before = state.snapshot().unwrap();
    let returned = remove_library_domain(&state, "remove").unwrap();
    assert_eq!(returned.theme, AppTheme::Sunset);
    assert_eq!(returned.active_library_id, Some("keep".into()));
    assert_eq!(returned.libraries, vec![before.libraries[1].clone()]);
    assert_eq!(state.snapshot().unwrap(), returned);
    assert_eq!(
        BackendState::load(path).unwrap().snapshot().unwrap(),
        returned
    );
}

#[test]
fn saved_search_mutations_return_selected_theme() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("library");
    fs::create_dir(&root).unwrap();
    let path = dir.path().join("settings.json");
    let state = BackendState::load(path.clone()).unwrap();
    state
        .mutate(|inner| {
            inner.libraries.push(LibrarySummary {
                id: "library".into(),
                name: "Synthetic".into(),
                root_path: fs::canonicalize(&root)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .into_owned(),
                asset_count: 0,
                last_scan_at: None,
            });
            inner.active_library_id = Some("library".into());
            Ok(())
        })
        .unwrap();
    set_app_theme_domain(&state, AppTheme::Mint).unwrap();
    let filters = SearchFilters {
        query: "favorite".into(),
        view: SearchView::All,
        match_mode: MatchMode::Any,
        kind: SearchKind::File,
    };
    let created =
        upsert_saved_search_domain(&state, "library", "Favorite", filters.clone(), None).unwrap();
    assert_eq!(created.theme, AppTheme::Mint);
    assert_eq!(created.saved_searches.len(), 1);
    let id = created.saved_searches[0].id.clone();
    let updated =
        upsert_saved_search_domain(&state, "library", "Updated", filters, Some(&id)).unwrap();
    assert_eq!(updated.theme, AppTheme::Mint);
    assert_eq!(updated.saved_searches[0].id, id);
    assert_eq!(updated.saved_searches[0].name, "Updated");
    let deleted = delete_saved_search_domain(&state, "library", &id).unwrap();
    assert_eq!(deleted.theme, AppTheme::Mint);
    assert!(deleted.saved_searches.is_empty());
    assert_eq!(deleted.libraries, created.libraries);
    assert_eq!(deleted.active_library_id, created.active_library_id);
    assert_eq!(state.snapshot().unwrap(), deleted);
    assert_eq!(
        BackendState::load(path).unwrap().snapshot().unwrap(),
        deleted
    );
}

#[test]
fn theme_updates_preserve_roots_searches_extras_and_scan_authorization() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("library");
    fs::create_dir(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    fs::write(root.join("model.stl"), b"inert asset").unwrap();
    let path = dir.path().join("settings.json");
    let initial = serde_json::json!({
        "version": 1,
        "libraries": [{"id":"library","name":"Synthetic","rootPath":root,
            "assetCount":0,"lastScanAt":null}],
        "activeLibraryId":"library",
        "savedSearches":[{"id":"search","libraryId":"library","name":"Favorite",
            "filters":{"query":"favorite","view":"all","matchMode":"any","kind":"file"}}],
        "custom":{"nested":[1,"keep",true]}, "theme":"stone"
    });
    fs::write(&path, serde_json::to_vec(&initial).unwrap()).unwrap();
    let state = BackendState::load(path.clone()).unwrap();
    let baseline = state.snapshot().unwrap();
    let scan = scan_tree(&root, "library", "theme-scan", |_| {}).unwrap();
    let cancellation = Arc::new(AtomicBool::new(false));
    {
        let mut inner = state.inner.lock().unwrap();
        record_edit_snapshot(&mut inner, &root, &scan);
        inner.scan_cancellations.insert(
            ("library".into(), "theme-scan".into()),
            cancellation.clone(),
        );
    }
    let returned = set_app_theme_domain(&state, AppTheme::Midnight).unwrap();
    assert_eq!(returned.libraries, baseline.libraries);
    assert_eq!(returned.active_library_id, baseline.active_library_id);
    assert_eq!(returned.saved_searches, baseline.saved_searches);
    {
        let mut inner = state.inner.lock().unwrap();
        let snapshot = &inner.scan_snapshots["library"];
        assert_eq!(snapshot.root, root);
        assert_eq!(snapshot.assets.len(), scan.assets.len());
        for asset in &scan.assets {
            assert_eq!(snapshot.assets.get(&asset.id), Some(asset));
            assert!(snapshot.editable_ids.contains(&asset.id));
        }
        assert!(Arc::ptr_eq(
            &inner.scan_cancellations[&("library".into(), "theme-scan".into())],
            &cancellation
        ));
        inner.libraries[0].asset_count = scan.assets.len();
        inner.libraries[0].last_scan_at = Some(scan.scanned_at.clone());
        persist(&inner).unwrap();
    }
    let persisted: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(persisted["custom"], initial["custom"]);
    assert_eq!(persisted["savedSearches"], initial["savedSearches"]);
    assert_eq!(persisted["activeLibraryId"], initial["activeLibraryId"]);
    assert_eq!(
        persisted["libraries"][0]["rootPath"],
        initial["libraries"][0]["rootPath"]
    );
    assert_eq!(persisted["theme"], "midnight");
    let loaded = BackendState::load(path).unwrap().snapshot().unwrap();
    assert_eq!(loaded.theme, AppTheme::Midnight);
    assert_eq!(loaded.libraries[0].asset_count, scan.assets.len());
    assert_eq!(loaded.libraries[0].last_scan_at, Some(scan.scanned_at));
    assert_eq!(loaded.saved_searches, baseline.saved_searches);
    assert_eq!(fs::read(root.join("model.stl")).unwrap(), b"inert asset");
    assert!(!root.join(manifest::MANIFEST_NAME).exists());
}
