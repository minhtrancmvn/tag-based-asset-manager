use super::*;

#[test]
fn update_install_refuses_a_scan_even_after_cancellation_requested() {
    let temp = tempfile::tempdir().unwrap();
    let state = BackendState::load(temp.path().join("settings.json")).unwrap();
    state.inner.lock().unwrap().scan_cancellations.insert(
        ("library".into(), "scan".into()),
        Arc::new(AtomicBool::new(true)),
    );
    let mut called = false;
    let result = state.with_update_install_lock(|| {
        called = true;
        Ok(())
    });
    assert!(result.is_err());
    assert!(!called);
    assert!(!temp.path().join("settings.json").exists());
}

#[test]
fn update_install_holds_native_lock_and_releases_after_failure_without_settings_write() {
    let temp = tempfile::tempdir().unwrap();
    let state = BackendState::load(temp.path().join("settings.json")).unwrap();
    let result: Result<(), String> = state.with_update_install_lock(|| {
        assert!(state.inner.try_lock().is_err());
        Err("Installer failed".into())
    });
    assert_eq!(result.unwrap_err(), "Installer failed");
    assert!(state.inner.try_lock().is_ok());
    assert!(!temp.path().join("settings.json").exists());
}

#[test]
fn update_install_refused_while_tag_rename_apply_holds_the_backend_lock() {
    let temp = tempfile::tempdir().unwrap();
    let state = BackendState::load(temp.path().join("settings.json")).unwrap();
    // A rename apply holds the backend mutex through grouped sidecar writes and settings.
    let apply_guard = state.inner.lock().unwrap();
    let mut called = false;
    let result = state.with_update_install_lock(|| {
        called = true;
        Ok(())
    });
    assert_eq!(
        result.unwrap_err(),
        "Finish pending library operations before updating"
    );
    assert!(!called);
    drop(apply_guard);
    assert!(state.with_update_install_lock(|| Ok(())).is_ok());
}

#[test]
fn update_install_refused_while_tag_rename_preview_scan_is_registered() {
    let temp = tempfile::tempdir().unwrap();
    let state = BackendState::load(temp.path().join("settings.json")).unwrap();
    // A running (not cancelled) preview scan is registered in the shared cancellation registry.
    state.inner.lock().unwrap().scan_cancellations.insert(
        ("library".into(), "preview-scan".into()),
        Arc::new(AtomicBool::new(false)),
    );
    let mut called = false;
    let result = state.with_update_install_lock(|| {
        called = true;
        Ok(())
    });
    assert_eq!(
        result.unwrap_err(),
        "Stop scans and wait for them to finish before updating"
    );
    assert!(!called);
    state
        .inner
        .lock()
        .unwrap()
        .scan_cancellations
        .remove(&("library".to_string(), "preview-scan".to_string()));
    assert!(state.with_update_install_lock(|| Ok(())).is_ok());
}

#[test]
fn update_install_not_blocked_by_a_pending_tag_rename_preview_alone() {
    use super::tag_rename::{normalize_mapping, PendingPreview, RenameMode};
    let temp = tempfile::tempdir().unwrap();
    let state = BackendState::load(temp.path().join("settings.json")).unwrap();
    let preview_id = {
        let mut inner = state.inner.lock().unwrap();
        let generation = inner.rename.current_generation();
        let mapping = normalize_mapping(RenameMode::Prefix, "status", "state").unwrap();
        inner.rename.bind_preview(PendingPreview::new(
            "library",
            temp.path().to_path_buf(),
            mapping,
            generation,
        ))
    };
    let mut called = false;
    let result = state.with_update_install_lock(|| {
        called = true;
        Ok(())
    });
    assert!(result.is_ok());
    assert!(called);
    // Installing neither consumes nor invalidates the preview; draft blockers are a UI concern.
    assert!(state
        .inner
        .lock()
        .unwrap()
        .rename
        .take_preview("library", &preview_id)
        .is_ok());
    assert!(!temp.path().join("settings.json").exists());
}
