use super::persist;
use super::tag_rename::*;
use super::{
    bulk_edit_tags_domain, cancel_scan, edit_notes_domain, edit_tags_domain, prepare_tag_target,
    record_edit_snapshot, remove_library_domain, scan_library, scan_tree, set_app_theme_domain,
    upsert_saved_search_domain, AppError, AppTheme, Asset, BackendState, BulkTagTarget,
    LibrarySummary, MatchMode, SavedSearch, ScanIssue, ScanProgress, ScanResult, SearchFilters,
    SearchKind, SearchView,
};
use crate::manifest;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{ipc::Channel, Manager};

const FIXTURE: &str = include_str!("../../fixtures/tag-rename-mappings.json");

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    mode: RenameMode,
    source: String,
    destination: String,
    expected: Expected,
    #[serde(default)]
    tags: Vec<TagCase>,
}

#[derive(Deserialize)]
struct Expected {
    mapping: Option<RenameMapping>,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagCase {
    input: Vec<String>,
    target: bool,
    output: Vec<String>,
    duplicates_collapsed: usize,
}

fn fixture() -> Fixture {
    serde_json::from_str(FIXTURE).expect("fixture parses")
}

fn error_code(error: &MappingError) -> String {
    serde_json::to_value(error)
        .expect("error serializes")
        .as_str()
        .expect("error is a string")
        .to_string()
}

fn run_case(case: &Case) {
    let result = normalize_mapping(case.mode, &case.source, &case.destination);
    match (&case.expected.mapping, &case.expected.error) {
        (Some(expected), None) => {
            let mapping = result.unwrap_or_else(|error| {
                panic!(
                    "{}: expected mapping, got error {}",
                    case.id,
                    error_code(&error)
                )
            });
            assert_eq!(&mapping, expected, "{}: mapping", case.id);
            for (index, tag_case) in case.tags.iter().enumerate() {
                let entry = map_entry_tags(&tag_case.input, &mapping);
                assert_eq!(
                    entry.target, tag_case.target,
                    "{} tag case {index}: target",
                    case.id
                );
                assert_eq!(
                    entry.output, tag_case.output,
                    "{} tag case {index}: output",
                    case.id
                );
                assert_eq!(
                    entry.duplicates_collapsed, tag_case.duplicates_collapsed,
                    "{} tag case {index}: duplicatesCollapsed",
                    case.id
                );
            }
        }
        (None, Some(code)) => {
            let error = result.expect_err(&format!("{}: expected error {code}", case.id));
            assert_eq!(&error_code(&error), code, "{}: error code", case.id);
        }
        _ => panic!(
            "{}: fixture expected must have exactly one of mapping/error",
            case.id
        ),
    }
}

fn run_named(id: &str) {
    let fixture = fixture();
    let case = fixture
        .cases
        .iter()
        .find(|case| case.id == id)
        .unwrap_or_else(|| panic!("fixture case {id} missing"));
    run_case(case);
}

#[test]
fn tag_rename_fixture_cases_all_agree_with_rust() {
    let fixture = fixture();
    assert!(!fixture.cases.is_empty());
    let mut failures = Vec::new();
    for case in &fixture.cases {
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_case(case))).is_err() {
            failures.push(case.id.clone());
        }
    }
    assert!(
        failures.is_empty(),
        "fixture cases disagreeing with Rust: {failures:?}"
    );
}

#[test]
fn tag_rename_case_exact_final_sigma() {
    run_named("exact-final-sigma");
}

#[test]
fn tag_rename_case_exact_lone_sigma() {
    run_named("exact-lone-sigma");
}

#[test]
fn tag_rename_case_exact_dotted_capital_i() {
    run_named("exact-dotted-capital-i");
}

#[test]
fn tag_rename_case_exact_astral_lowercase() {
    run_named("exact-astral-lowercase");
}

#[test]
fn tag_rename_case_prefix_final_sigma_depends_on_whole_tag_context() {
    run_named("prefix-final-sigma-depends-on-whole-tag-context");
}

#[test]
fn tag_rename_case_prefix_dotted_capital_i() {
    run_named("prefix-dotted-capital-i");
}

#[test]
fn tag_rename_serializes_camel_case_mapping_and_lowercase_mode() {
    let mapping = normalize_mapping(RenameMode::Prefix, "Status:", "State").unwrap();
    assert_eq!(
        serde_json::to_value(&mapping).unwrap(),
        serde_json::json!({"mode": "prefix", "source": "status", "destination": "state"})
    );
    assert_eq!(serde_json::to_value(RenameMode::Exact).unwrap(), "exact");
    let parsed: RenameMapping =
        serde_json::from_str(r#"{"mode":"exact","source":"a","destination":"b"}"#).unwrap();
    assert_eq!(parsed.mode, RenameMode::Exact);
}

#[test]
fn tag_rename_error_codes_serialize_as_kebab_case() {
    assert_eq!(error_code(&MappingError::EmptySource), "empty-source");
    assert_eq!(
        error_code(&MappingError::EmptyDestination),
        "empty-destination"
    );
    assert_eq!(error_code(&MappingError::Unchanged), "unchanged");
    assert_eq!(
        error_code(&MappingError::MultiSegmentPrefix),
        "multi-segment-prefix"
    );
}

#[test]
fn tag_rename_map_tag_matches_exact_and_prefix() {
    let exact = normalize_mapping(RenameMode::Exact, "a", "b").unwrap();
    assert_eq!(map_tag("a", &exact), Some("b".to_string()));
    assert_eq!(map_tag("a:x", &exact), None);
    let prefix = normalize_mapping(RenameMode::Prefix, "a", "b").unwrap();
    assert_eq!(map_tag("a:x:y", &prefix), Some("b:x:y".to_string()));
    assert_eq!(map_tag("a", &prefix), None);
}

// ---------------------------------------------------------------------------
// T4: native-owned preview/retry state, invalidation boundaries, DTO contract.
// ---------------------------------------------------------------------------

fn state_mapping() -> RenameMapping {
    normalize_mapping(RenameMode::Prefix, "status", "state").unwrap()
}

fn replacement(search_id: &str) -> SavedSearchReplacement {
    SavedSearchReplacement {
        search_id: search_id.into(),
        expected_filters: dto_filters("status"),
        filters: dto_filters("state"),
    }
}

/// State with no libraries; the temp dir must outlive it.
fn bare_state() -> (tempfile::TempDir, BackendState) {
    let dir = tempfile::tempdir().unwrap();
    let state = BackendState::load(dir.path().join("settings.json")).unwrap();
    (dir, state)
}

fn generation(state: &BackendState) -> u64 {
    state.inner.lock().unwrap().rename.current_generation()
}

/// Binds a preview at the current generation and returns its opaque ID.
fn bind(state: &BackendState, library_id: &str) -> String {
    let mut inner = state.inner.lock().unwrap();
    let bound_at = inner.rename.current_generation();
    let preview = PendingPreview::new(
        library_id,
        PathBuf::from("/approved/root"),
        state_mapping(),
        bound_at,
    );
    inner.rename.bind_preview(preview)
}

fn take(
    state: &BackendState,
    library_id: &str,
    preview_id: &str,
) -> Result<PendingPreview, AppError> {
    state
        .inner
        .lock()
        .unwrap()
        .rename
        .take_preview(library_id, preview_id)
}

fn retry_proof(library_id: &str) -> RetryProof {
    RetryProof {
        library_id: library_id.into(),
        root: PathBuf::from("/approved/root"),
        mapping: state_mapping(),
        committed: vec![CommittedRow {
            asset_id: "path:a.stl".into(),
            revision: "rev-a-2".into(),
        }],
        replacements: vec![replacement("search-1")],
    }
}

fn add_library(state: &BackendState, id: &str, root: &std::path::Path) {
    state
        .mutate(|inner| {
            inner.libraries.push(LibrarySummary {
                id: id.into(),
                name: id.into(),
                root_path: root.to_str().unwrap().into(),
                asset_count: 0,
                last_scan_at: None,
            });
            Ok(())
        })
        .unwrap();
}

/// A temp-dir library "library" with two files, plus a recorded edit snapshot.
fn rename_library() -> (tempfile::TempDir, PathBuf, BackendState) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    std::fs::create_dir(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    std::fs::write(root.join("a.stl"), b"a").unwrap();
    std::fs::write(root.join("b.stl"), b"b").unwrap();
    let state = BackendState::load(dir.path().join("settings.json")).unwrap();
    add_library(&state, "library", &root);
    (dir, root, state)
}

fn snapshot_scan(root: &std::path::Path, state: &BackendState) -> ScanResult {
    let result = scan_tree(root, "library", "setup", |_| {}).unwrap();
    record_edit_snapshot(&mut state.inner.lock().unwrap(), root, &result);
    result
}

fn find_asset(result: &ScanResult, path: &str) -> Asset {
    result
        .assets
        .iter()
        .find(|asset| asset.relative_path == path)
        .unwrap()
        .clone()
}

/// Binds a preview, runs `boundary`, then asserts the stale preview is rejected.
fn assert_stale_preview_rejected_after(state: &BackendState, boundary: impl FnOnce()) {
    let preview_id = bind(state, "library");
    let before = generation(state);
    boundary();
    assert!(
        generation(state) > before,
        "the mutation boundary must advance the generation"
    );
    let error = take(state, "library", &preview_id).expect_err("stale preview must be rejected");
    assert!(
        error.message.contains("preview again"),
        "rejection should tell the user to preview again: {}",
        error.message
    );
}

#[test]
fn tag_rename_second_bind_supersedes_first_preview_id() {
    let (_dir, state) = bare_state();
    let first = bind(&state, "library");
    let second = bind(&state, "library");
    assert_ne!(first, second);
    assert!(take(&state, "library", &first).is_err());
    assert_eq!(
        take(&state, "library", &second).unwrap().preview_id,
        second,
        "a rejected stale ID must not consume the current preview"
    );
}

#[test]
fn tag_rename_preview_ids_are_opaque_uuids_and_other_libraries_are_independent() {
    let (_dir, state) = bare_state();
    let one = bind(&state, "one");
    let two = bind(&state, "two");
    assert!(uuid::Uuid::parse_str(&one).is_ok());
    assert!(uuid::Uuid::parse_str(&two).is_ok());
    assert_eq!(take(&state, "one", &one).unwrap().library_id, "one");
    assert!(
        take(&state, "one", &two).is_err(),
        "an ID is only valid for its own library"
    );
    assert_eq!(take(&state, "two", &two).unwrap().library_id, "two");
}

#[test]
fn tag_rename_take_consumes_the_preview() {
    let (_dir, state) = bare_state();
    let id = bind(&state, "library");
    let taken = take(&state, "library", &id).unwrap();
    assert_eq!(taken.mapping, state_mapping());
    assert!(take(&state, "library", &id).is_err(), "apply consumes");
}

#[test]
fn tag_rename_unknown_library_and_mismatched_id_are_rejected_without_state_change() {
    let (_dir, state) = bare_state();
    let id = bind(&state, "library");
    let before = generation(&state);
    assert!(take(&state, "never-bound", &id).is_err());
    assert!(take(&state, "library", "not-the-id").is_err());
    assert!(take(&state, "library", "").is_err());
    assert_eq!(generation(&state), before);
    assert!(
        take(&state, "library", &id).is_ok(),
        "failed lookups leave the pending preview usable"
    );
}

#[test]
fn tag_rename_preview_stores_bound_replacements_and_target_data() {
    let (_dir, state) = bare_state();
    let id = {
        let mut inner = state.inner.lock().unwrap();
        let mut preview = PendingPreview::new(
            "library",
            PathBuf::from("/approved/root"),
            state_mapping(),
            inner.rename.current_generation(),
        );
        preview.scan_id = "scan-1".into();
        preview.replacements = vec![replacement("search-1"), replacement("search-2")];
        preview.targets = vec![BoundTarget {
            asset_id: "path:Models/dragon.stl".into(),
            relative_path: "Models/dragon.stl".into(),
            kind: "file".into(),
            revision: "rev-dragon-1".into(),
            owner_dir: PathBuf::from("/approved/root/Models"),
            sidecar_owner: "Models".into(),
            duplicates_collapsed: 1,
        }];
        preview
            .sources
            .insert(PathBuf::from("/approved/root/Models"), Some(b"{}".to_vec()));
        preview
            .sources
            .insert(PathBuf::from("/approved/root/Zeta"), None);
        inner.rename.bind_preview(preview)
    };
    let taken = take(&state, "library", &id).unwrap();
    assert_eq!(taken.scan_id, "scan-1");
    assert_eq!(
        taken
            .replacements
            .iter()
            .map(|replacement| replacement.search_id.as_str())
            .collect::<Vec<_>>(),
        ["search-1", "search-2"]
    );
    assert_eq!(
        taken.replacements[0].expected_filters,
        dto_filters("status")
    );
    assert_eq!(taken.replacements[0].filters, dto_filters("state"));
    assert_eq!(taken.targets[0].summary().sidecar_owner, "Models");
    assert_eq!(taken.targets[0].summary().duplicates_collapsed, 1);
    assert_eq!(taken.sources.len(), 2);
    assert_eq!(taken.sources[&PathBuf::from("/approved/root/Zeta")], None);
}

#[test]
fn tag_rename_preview_bound_at_an_older_generation_is_rejected_as_stale() {
    let (_dir, state) = bare_state();
    let id = {
        let mut inner = state.inner.lock().unwrap();
        let bound_at = inner.rename.current_generation();
        inner.rename.note_mutation();
        // A preview built from pre-mutation data is bound only after the mutation.
        inner.rename.bind_preview(PendingPreview::new(
            "library",
            PathBuf::from("/approved/root"),
            state_mapping(),
            bound_at,
        ))
    };
    let error = take(&state, "library", &id).expect_err("stale generation is rejected");
    assert!(error.message.contains("changed"), "{}", error.message);
    assert!(
        take(&state, "library", &id).is_err(),
        "a stale preview is dropped, not kept"
    );
}

#[test]
fn tag_rename_generation_is_monotonic_and_note_mutation_clears_every_library_preview() {
    let (_dir, state) = bare_state();
    let one = bind(&state, "one");
    let two = bind(&state, "two");
    let before = generation(&state);
    state.inner.lock().unwrap().rename.note_mutation();
    let middle = generation(&state);
    state.inner.lock().unwrap().rename.note_mutation();
    assert!(before < middle && middle < generation(&state));
    assert!(take(&state, "one", &one).is_err());
    assert!(take(&state, "two", &two).is_err());
}

#[test]
fn tag_rename_stale_preview_rejected_after_scan_publish() {
    let (_dir, _root, state) = rename_library();
    assert_stale_preview_rejected_after(&state, || {
        let result = scan_through_command(&state, "scan-1");
        assert_eq!(result.assets.len(), 3);
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_theme_change() {
    let (_dir, _root, state) = rename_library();
    assert_stale_preview_rejected_after(&state, || {
        set_app_theme_domain(&state, AppTheme::Midnight).unwrap();
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_saved_search_upsert() {
    let (_dir, _root, state) = rename_library();
    assert_stale_preview_rejected_after(&state, || {
        upsert_saved_search_domain(&state, "library", "Printed", dto_filters("status"), None)
            .unwrap();
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_library_registration() {
    let (dir, _root, state) = rename_library();
    let other = dir.path().join("other");
    std::fs::create_dir(&other).unwrap();
    assert_stale_preview_rejected_after(&state, || add_library(&state, "other", &other));
}

#[test]
fn tag_rename_stale_preview_rejected_after_single_tag_edit() {
    let (_dir, root, state) = rename_library();
    let a = find_asset(&snapshot_scan(&root, &state), "a.stl");
    assert_stale_preview_rejected_after(&state, || {
        edit_tags_domain(
            &state,
            "library",
            &a.id,
            &a.metadata_revision,
            &["status:printed".to_string()],
            &[],
        )
        .unwrap();
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_notes_edit() {
    let (_dir, root, state) = rename_library();
    // Notes need an existing metadata entry, so tag the asset first (setup), then rescan.
    let untagged = find_asset(&snapshot_scan(&root, &state), "a.stl");
    edit_tags_domain(
        &state,
        "library",
        &untagged.id,
        &untagged.metadata_revision,
        &["status:printed".to_string()],
        &[],
    )
    .unwrap();
    let a = find_asset(&snapshot_scan(&root, &state), "a.stl");
    assert_stale_preview_rejected_after(&state, || {
        edit_notes_domain(&state, "library", &a.id, &a.metadata_revision, "hello").unwrap();
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_bulk_edit() {
    let (_dir, root, state) = rename_library();
    let scanned = snapshot_scan(&root, &state);
    let targets: Vec<BulkTagTarget> = ["a.stl", "b.stl"]
        .iter()
        .map(|path| {
            let asset = find_asset(&scanned, path);
            BulkTagTarget {
                asset_id: asset.id,
                expected_revision: asset.metadata_revision,
            }
        })
        .collect();
    assert_stale_preview_rejected_after(&state, || {
        let result = bulk_edit_tags_domain(
            &state,
            "library",
            &targets,
            &["status:printed".to_string()],
            &[],
        )
        .unwrap();
        assert_eq!(result.assets.len(), 2);
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_library_removal() {
    let (_dir, _root, state) = rename_library();
    assert_stale_preview_rejected_after(&state, || {
        remove_library_domain(&state, "library").unwrap();
    });
}

#[test]
fn tag_rename_library_removal_clears_only_that_librarys_retry_proof() {
    let (dir, _root, state) = rename_library();
    let other = dir.path().join("other");
    std::fs::create_dir(&other).unwrap();
    add_library(&state, "other", &other);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.rename.store_retry_proof(retry_proof("library"));
        inner.rename.store_retry_proof(retry_proof("other"));
    }
    remove_library_domain(&state, "library").unwrap();
    let inner = state.inner.lock().unwrap();
    assert!(inner.rename.retry_proof("library").is_none());
    assert_eq!(
        inner.rename.retry_proof("other").unwrap().library_id,
        "other"
    );
}

#[test]
fn tag_rename_scan_publish_keeps_retry_proof_but_invalidates_preview() {
    let (_dir, _root, state) = rename_library();
    state
        .inner
        .lock()
        .unwrap()
        .rename
        .store_retry_proof(retry_proof("library"));
    assert_stale_preview_rejected_after(&state, || {
        scan_through_command(&state, "scan-1");
    });
    assert_eq!(
        state
            .inner
            .lock()
            .unwrap()
            .rename
            .retry_proof("library")
            .unwrap()
            .committed[0]
            .revision,
        "rev-a-2"
    );
}

#[test]
fn tag_rename_settings_mutations_keep_retry_proofs() {
    let (_dir, _root, state) = rename_library();
    state
        .inner
        .lock()
        .unwrap()
        .rename
        .store_retry_proof(retry_proof("library"));
    set_app_theme_domain(&state, AppTheme::Coral).unwrap();
    assert!(state
        .inner
        .lock()
        .unwrap()
        .rename
        .retry_proof("library")
        .is_some());
}

fn scan_through_command(state: &BackendState, scan_id: &str) -> ScanResult {
    let app = tauri::test::mock_app();
    app.manage(state.clone());
    let managed = app.state::<BackendState>();
    let channel: Channel<ScanProgress> = Channel::new(|_| Ok(()));
    tauri::async_runtime::block_on(scan_library(
        "library".into(),
        scan_id.into(),
        channel,
        managed,
    ))
    .unwrap()
    .expect("scan completes")
}

// ---------------------------------------------------------------------------
// Golden DTO fixture (MP-3 / MP2-5): the JSON shape TypeScript sends and reads.
// ---------------------------------------------------------------------------

const DTO_FIXTURE: &str = include_str!("../../fixtures/tag-rename-dto.json");

fn dto_fixture() -> serde_json::Value {
    serde_json::from_str(DTO_FIXTURE).expect("DTO fixture parses")
}

fn dto_section(name: &str) -> serde_json::Value {
    dto_fixture()
        .get(name)
        .unwrap_or_else(|| panic!("fixture section {name}"))
        .clone()
}

fn dto_filters(prefix: &str) -> SearchFilters {
    SearchFilters {
        query: format!("{prefix}:printed -{prefix}:draft \"Flexi Dragon\""),
        view: SearchView::All,
        match_mode: MatchMode::All,
        kind: SearchKind::All,
    }
}

fn dto_asset(path: &str, kind: &str, tags: &[&str], revision: &str, uuid: &str) -> Asset {
    dto_asset_with(path, kind, tags, revision, uuid, "ready", "valid")
}

fn dto_asset_with(
    path: &str,
    kind: &str,
    tags: &[&str],
    revision: &str,
    uuid: &str,
    status: &str,
    metadata_state: &str,
) -> Asset {
    let is_file = kind == "file";
    let present = status != "missing";
    Asset {
        id: format!("path:{path}"),
        name: path.rsplit('/').next().unwrap().into(),
        relative_path: path.into(),
        kind: kind.into(),
        extension: is_file.then(|| "stl".to_string()),
        modified_at: present.then(|| "2026-11-01T10:00:00.000Z".to_string()),
        size_bytes: (is_file && present).then_some(2048),
        tags: tags.iter().map(|tag| tag.to_string()).collect(),
        status: status.into(),
        notes: None,
        metadata_id: Some(uuid.into()),
        metadata_state: metadata_state.into(),
        metadata_revision: revision.into(),
    }
}

const U_ARCHIVE: &str = "22222222-2222-4222-8222-222222222222";
const U_DRAGON: &str = "11111111-1111-4111-8111-111111111111";
const U_PART: &str = "33333333-3333-4333-8333-333333333333";
const U_OLD: &str = "44444444-4444-4444-8444-444444444444";

fn archive(renamed: bool) -> Asset {
    if renamed {
        dto_asset(
            "Archive",
            "folder",
            &["state:draft"],
            "rev-archive-2",
            U_ARCHIVE,
        )
    } else {
        dto_asset(
            "Archive",
            "folder",
            &["status:draft"],
            "rev-archive-1",
            U_ARCHIVE,
        )
    }
}

fn dragon(renamed: bool) -> Asset {
    if renamed {
        dto_asset(
            "Models/dragon.stl",
            "file",
            &["favorite", "state:printed"],
            "rev-dragon-2",
            U_DRAGON,
        )
    } else {
        dto_asset(
            "Models/dragon.stl",
            "file",
            &["favorite", "state:printed", "status:printed"],
            "rev-dragon-1",
            U_DRAGON,
        )
    }
}

fn part(renamed: bool) -> Asset {
    if renamed {
        dto_asset(
            "Zeta/part.stl",
            "file",
            &["state:printed:large"],
            "rev-part-2",
            U_PART,
        )
    } else {
        dto_asset(
            "Zeta/part.stl",
            "file",
            &["status:printed:large"],
            "rev-part-1",
            U_PART,
        )
    }
}

fn summary(asset: &Asset, owner: &str, duplicates_collapsed: usize) -> RenameTargetSummary {
    RenameTargetSummary {
        asset_id: asset.id.clone(),
        relative_path: asset.relative_path.clone(),
        kind: asset.kind.clone(),
        sidecar_owner: owner.into(),
        duplicates_collapsed,
    }
}

fn dto_issue() -> ScanIssue {
    ScanIssue {
        message: "Manifest is malformed".into(),
        path: "Broken/.asset-tags.json".into(),
        details: "expected value at line 1 column 1".into(),
    }
}

fn dto_skipped() -> Vec<RenameSkippedRow> {
    vec![
        RenameSkippedRow {
            asset_id: "path:Models/old.stl".into(),
            relative_path: "Models/old.stl".into(),
            kind: "file".into(),
            reason: SkipReason::Missing,
            message: None,
        },
        RenameSkippedRow {
            asset_id: "path:Dup/copy.stl".into(),
            relative_path: "Dup/copy.stl".into(),
            kind: "file".into(),
            reason: SkipReason::Blocked,
            message: Some("Duplicate metadata UUID; rescan before editing".into()),
        },
    ]
}

fn dto_search(prefix: &str) -> SavedSearch {
    SavedSearch {
        id: "search-1".into(),
        library_id: "lib-1".into(),
        name: "Printed models".into(),
        filters: dto_filters(prefix),
    }
}

fn dto_request() -> RenamePreviewRequest {
    RenamePreviewRequest {
        library_id: "lib-1".into(),
        scan_id: "scan-1".into(),
        mode: RenameMode::Prefix,
        source: " Status: ".into(),
        destination: "State".into(),
        normalized_mapping: state_mapping(),
        saved_search_replacements: vec![replacement("search-1")],
    }
}

fn dto_preview() -> RenamePreview {
    let old = dto_asset_with(
        "Models/old.stl",
        "file",
        &["status:printed"],
        "rev-old-1",
        U_OLD,
        "missing",
        "valid",
    );
    let copy = dto_asset_with(
        "Dup/copy.stl",
        "file",
        &["status:printed"],
        "rev-copy-1",
        U_DRAGON,
        "ready",
        "blocked",
    );
    RenamePreview {
        preview_id: "6f1c1e0a-6a53-4a39-8a55-1b8d3d8f0001".into(),
        library_id: "lib-1".into(),
        scan_id: "scan-1".into(),
        mapping: state_mapping(),
        scan: ScanResult {
            library_id: "lib-1".into(),
            scan_id: "scan-1".into(),
            assets: vec![archive(false), dragon(false), part(false), old, copy],
            issues: vec![dto_issue()],
            scanned_at: "2026-11-04T09:00:00.000Z".into(),
        },
        targets: vec![
            summary(&archive(false), "Archive", 0),
            summary(&dragon(false), "Models", 1),
            summary(&part(false), "Zeta", 0),
        ],
        file_count: 2,
        folder_count: 1,
        sidecar_count: 3,
        destination_exists: true,
        collisions: vec![RenameCollision {
            from: "status:printed".into(),
            to: "state:printed".into(),
        }],
        duplicates_collapsed: 1,
        skipped: dto_skipped(),
        uninspectable: vec![dto_issue()],
        saved_search_update_count: 1,
        settings_retry: false,
    }
}

fn dto_retry_preview() -> RenamePreview {
    RenamePreview {
        preview_id: "6f1c1e0a-6a53-4a39-8a55-1b8d3d8f0002".into(),
        library_id: "lib-1".into(),
        scan_id: "scan-2".into(),
        mapping: state_mapping(),
        scan: ScanResult {
            library_id: "lib-1".into(),
            scan_id: "scan-2".into(),
            assets: vec![archive(true), dragon(true), part(true)],
            issues: vec![],
            scanned_at: "2026-11-04T09:30:00.000Z".into(),
        },
        targets: vec![],
        file_count: 0,
        folder_count: 0,
        sidecar_count: 0,
        destination_exists: false,
        collisions: vec![],
        duplicates_collapsed: 0,
        skipped: vec![],
        uninspectable: vec![],
        saved_search_update_count: 1,
        settings_retry: true,
    }
}

fn dto_apply(outcome: RenameOutcome) -> RenameApplyResult {
    RenameApplyResult {
        preview_id: "6f1c1e0a-6a53-4a39-8a55-1b8d3d8f0001".into(),
        library_id: "lib-1".into(),
        mapping: state_mapping(),
        committed: vec![],
        failed: vec![],
        unattempted: vec![],
        failing_sidecar: None,
        skipped: dto_skipped(),
        uninspectable: vec![dto_issue()],
        saved_searches: vec![dto_search("status")],
        error: None,
        outcome,
        query_migrated: false,
    }
}

fn dto_apply_complete() -> RenameApplyResult {
    RenameApplyResult {
        committed: vec![archive(true), dragon(true), part(true)],
        saved_searches: vec![dto_search("state")],
        query_migrated: true,
        ..dto_apply(RenameOutcome::Complete)
    }
}

fn dto_apply_partial() -> RenameApplyResult {
    RenameApplyResult {
        committed: vec![archive(true)],
        failed: vec![summary(&dragon(false), "Models", 1)],
        unattempted: vec![summary(&part(false), "Zeta", 0)],
        failing_sidecar: Some("Models/.asset-tags.json".into()),
        error: Some(AppError {
            message: "Tag rename partially applied: 1 of 3 sidecars completed; remaining changes were not applied".into(),
            path: Some("/library/Models/.asset-tags.json".into()),
            details: Some("disk full".into()),
        }),
        ..dto_apply(RenameOutcome::Partial)
    }
}

fn dto_apply_settings_failed() -> RenameApplyResult {
    RenameApplyResult {
        committed: vec![archive(true), dragon(true), part(true)],
        error: Some(AppError {
            message: "Could not save library settings".into(),
            path: Some("/app-data/settings.json".into()),
            details: Some("disk full".into()),
        }),
        ..dto_apply(RenameOutcome::SettingsFailed)
    }
}

#[test]
fn tag_rename_dto_request_deserializes_from_golden_fixture() {
    let request: RenamePreviewRequest = serde_json::from_value(dto_section("request")).unwrap();
    assert_eq!(request, dto_request());
    assert_eq!(request.mode, RenameMode::Prefix);
    assert_eq!(request.source, " Status: ");
    let mapping = normalize_mapping(request.mode, &request.source, &request.destination).unwrap();
    assert_eq!(
        mapping, request.normalized_mapping,
        "the fixture mapping is the native normalization of the raw names"
    );
    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        dto_section("request")
    );
}

#[test]
fn tag_rename_dto_request_rejects_unknown_fields_at_every_level() {
    let accept =
        |value: serde_json::Value| serde_json::from_value::<RenamePreviewRequest>(value).is_ok();
    assert!(accept(dto_section("request")));
    let paths: [&[&str]; 5] = [
        &[],
        &["normalizedMapping"],
        &["savedSearchReplacements", "0"],
        &["savedSearchReplacements", "0", "expectedFilters"],
        &["savedSearchReplacements", "0", "filters"],
    ];
    for path in paths {
        let mut value = dto_section("request");
        let mut node = &mut value;
        for key in path {
            node = match key.parse::<usize>() {
                Ok(index) => &mut node[index],
                Err(_) => &mut node[*key],
            };
        }
        node.as_object_mut()
            .unwrap()
            .insert("targets".into(), serde_json::json!([]));
        assert!(!accept(value), "unknown field accepted at {path:?}");
    }
}

#[test]
fn tag_rename_dto_request_requires_the_normalized_mapping() {
    let mut value = dto_section("request");
    value.as_object_mut().unwrap().remove("normalizedMapping");
    assert!(serde_json::from_value::<RenamePreviewRequest>(value).is_err());
}

#[test]
fn tag_rename_dto_results_match_golden_fixture() {
    fn check<T>(name: &str, constructed: T)
    where
        T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let fixture = dto_section(name);
        assert_eq!(
            serde_json::to_value(&constructed).unwrap(),
            fixture,
            "{name}: serialized DTO differs from the fixture"
        );
        let parsed: T = serde_json::from_value(fixture).unwrap();
        assert_eq!(parsed, constructed, "{name}: fixture does not round-trip");
    }
    check("preview", dto_preview());
    check("retryPreview", dto_retry_preview());
    check("applyComplete", dto_apply_complete());
    check("applyPartial", dto_apply_partial());
    check("applySettingsFailed", dto_apply_settings_failed());
    check(
        "previewOutcomeReady",
        RenamePreviewOutcome::Ready {
            preview: Box::new(dto_preview()),
        },
    );
    check("previewOutcomeCancelled", RenamePreviewOutcome::Cancelled);
    check(
        "previewOutcomeDiscarded",
        RenamePreviewOutcome::Discarded {
            reason: DiscardReason::Mutation,
        },
    );
}

#[test]
fn tag_rename_dto_discard_reasons_serialize_as_kebab_case() {
    for (reason, text) in [
        (DiscardReason::Mutation, "mutation"),
        (DiscardReason::LibraryChanged, "library-changed"),
        (DiscardReason::SidecarChanged, "sidecar-changed"),
    ] {
        assert_eq!(
            serde_json::to_value(RenamePreviewOutcome::Discarded { reason }).unwrap(),
            serde_json::json!({"status": "discarded", "reason": text})
        );
    }
    assert_eq!(
        serde_json::to_value(RenamePreviewOutcome::Cancelled).unwrap(),
        serde_json::json!({"status": "cancelled"})
    );
}

#[test]
fn tag_rename_dto_outcome_and_skip_reason_serialize_as_kebab_case() {
    for (outcome, text) in [
        (RenameOutcome::Complete, "complete"),
        (RenameOutcome::Partial, "partial"),
        (RenameOutcome::SettingsFailed, "settings-failed"),
    ] {
        assert_eq!(serde_json::to_value(outcome).unwrap(), text);
    }
    assert_eq!(
        serde_json::to_value(SkipReason::Missing).unwrap(),
        "missing"
    );
    assert_eq!(
        serde_json::to_value(SkipReason::Blocked).unwrap(),
        "blocked"
    );
}

#[test]
fn tag_rename_dto_preview_is_internally_consistent() {
    let preview = dto_preview();
    assert_eq!(
        preview.targets.len(),
        preview.file_count + preview.folder_count
    );
    let retry = dto_retry_preview();
    assert!(retry.settings_retry && retry.targets.is_empty() && retry.sidecar_count == 0);
}

// ---------------------------------------------------------------------------
// T5: recovery invalidation. A committed reconnect, a reconnect-target refresh
// scan that republishes the snapshot, and a missing-entry removal each reject
// a pending preview as stale.
// ---------------------------------------------------------------------------

const MISSING_MANIFEST: &str = r#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{"gone.stl":{"id":"76bfd01c-2055-43b1-996a-c3f9f4ab8f7e","tags":["status:printed"]}}}"#;

/// `rename_library` plus a sidecar entry for the absent `gone.stl`, then a
/// published snapshot. Returns the missing row.
fn missing_row_library() -> (tempfile::TempDir, PathBuf, BackendState, Asset) {
    let (dir, root, state) = rename_library();
    std::fs::write(
        root.join(super::manifest::MANIFEST_NAME),
        MISSING_MANIFEST.as_bytes(),
    )
    .unwrap();
    let missing = find_asset(&snapshot_scan(&root, &state), "gone.stl");
    assert_eq!(missing.status, "missing");
    (dir, root, state, missing)
}

#[test]
fn tag_rename_stale_preview_rejected_after_reconnect_commit() {
    let (_dir, _root, state, missing) = missing_row_library();
    assert_stale_preview_rejected_after(&state, || {
        let result = super::reconnect_asset_domain(
            &state,
            "library",
            &missing.id,
            &missing.metadata_revision,
            "path:a.stl",
        )
        .unwrap();
        assert!(result.assets.iter().all(|asset| asset.status != "missing"));
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_reconnect_targets_refresh_scan() {
    let (_dir, _root, state, missing) = missing_row_library();
    assert_stale_preview_rejected_after(&state, || {
        let targets = super::reconnect_targets_domain(
            &state,
            "library",
            &missing.id,
            &missing.metadata_revision,
        )
        .unwrap();
        assert_eq!(targets.len(), 2);
    });
}

#[test]
fn tag_rename_stale_preview_rejected_after_missing_entry_removal() {
    let (_dir, _root, state, missing) = missing_row_library();
    assert_stale_preview_rejected_after(&state, || {
        let result = super::remove_missing_entry_domain(
            &state,
            "library",
            &missing.id,
            &missing.metadata_revision,
        )
        .unwrap();
        assert!(result.assets.iter().all(|asset| asset.id != missing.id));
    });
}

#[test]
fn tag_rename_failed_reconnect_write_keeps_pending_preview_valid() {
    let (_dir, _root, state, missing) = missing_row_library();
    let preview_id = bind(&state, "library");
    let before = generation(&state);
    let error = super::reconnect_with_writer(
        &state,
        "library",
        &missing.id,
        &missing.metadata_revision,
        "path:a.stl",
        |_, _, _| Err("disk full".into()),
    )
    .expect_err("writer failure must fail the reconnect");
    assert!(error.message.contains("disk full"), "{}", error.message);
    assert_eq!(generation(&state), before, "nothing committed");
    take(&state, "library", &preview_id).expect("uncommitted failure leaves the preview valid");
}

// ---------------------------------------------------------------------------
// T6: fresh, cancellable, read-only preview.
// ---------------------------------------------------------------------------

const LIB: &str = "library";

fn uid(n: u8) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

fn write_manifest(dir: &Path, items: &[(&str, u8, &[&str])]) {
    let mut map = serde_json::Map::new();
    for (key, id, tags) in items {
        map.insert(
            key.to_string(),
            serde_json::json!({"id": uid(*id), "tags": tags}),
        );
    }
    let body = serde_json::json!({
        "schemaVersion": 1,
        "updatedAt": "2026-10-05T00:00:00Z",
        "items": map,
    });
    std::fs::write(
        dir.join(".asset-tags.json"),
        serde_json::to_vec_pretty(&body).unwrap(),
    )
    .unwrap();
}

fn touch(root: &Path, relative: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, b"asset bytes").unwrap();
}

fn mkdir(root: &Path, relative: &str) {
    std::fs::create_dir_all(root.join(relative)).unwrap();
}

/// A canonical temp library with id "library"; `setup` builds its contents.
fn preview_library(setup: impl FnOnce(&Path)) -> (tempfile::TempDir, PathBuf, BackendState) {
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap().join("library");
    std::fs::create_dir(&root).unwrap();
    setup(&root);
    let state = BackendState::load(dir.path().join("settings.json")).unwrap();
    add_library(&state, LIB, &root);
    (dir, root, state)
}

fn request_for(
    scan_id: &str,
    mode: RenameMode,
    source: &str,
    destination: &str,
) -> RenamePreviewRequest {
    RenamePreviewRequest {
        library_id: LIB.into(),
        scan_id: scan_id.into(),
        mode,
        source: source.into(),
        destination: destination.into(),
        normalized_mapping: normalize_mapping(mode, source, destination).unwrap(),
        saved_search_replacements: vec![],
    }
}

fn status_to_state(scan_id: &str) -> RenamePreviewRequest {
    request_for(scan_id, RenameMode::Prefix, "status", "state")
}

fn run_preview(
    state: &BackendState,
    request: RenamePreviewRequest,
) -> Result<RenamePreviewOutcome, AppError> {
    preview_tag_rename_domain(state, request, |_| {}, &mut FsPreviewEnv)
}

fn ready(outcome: RenamePreviewOutcome) -> RenamePreview {
    match outcome {
        RenamePreviewOutcome::Ready { preview } => *preview,
        other => panic!("expected a ready preview, got {other:?}"),
    }
}

fn run_ready(state: &BackendState, request: RenamePreviewRequest) -> RenamePreview {
    ready(run_preview(state, request).expect("preview succeeds"))
}

fn target_paths(preview: &RenamePreview) -> Vec<String> {
    preview
        .targets
        .iter()
        .map(|target| target.relative_path.clone())
        .collect()
}

fn lock(state: &BackendState) -> std::sync::MutexGuard<'_, super::Inner> {
    state
        .inner
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn registrations(state: &BackendState) -> usize {
    lock(state).scan_cancellations.len()
}

fn has_snapshot(state: &BackendState) -> bool {
    lock(state).scan_snapshots.contains_key(LIB)
}

fn tree_bytes(root: &Path) -> BTreeMap<PathBuf, Option<Vec<u8>>> {
    fn walk(dir: &Path, out: &mut BTreeMap<PathBuf, Option<Vec<u8>>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                out.insert(path.clone(), None);
                walk(&path, out);
            } else {
                out.insert(path.clone(), Some(std::fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, &mut out);
    out
}

#[test]
fn tag_rename_preview_writes_nothing_and_creates_no_uuids_or_sidecars() {
    let (dir, root, state) = preview_library(|root| {
        touch(root, "plain.stl");
        touch(root, "deep/er/untagged.stl");
        touch(root, "tagged.stl");
        write_manifest(root, &[("tagged.stl", 1, &["status:printed"])]);
    });
    let settings_path = dir.path().join("settings.json");
    let tree_before = tree_bytes(&root);
    let settings_before = std::fs::read(&settings_path).unwrap();
    let library_before = state.snapshot().unwrap();

    let preview = run_ready(&state, status_to_state("write-nothing"));

    assert_eq!(target_paths(&preview), ["tagged.stl"]);
    assert_eq!(tree_bytes(&root), tree_before, "no library byte may change");
    assert_eq!(
        std::fs::read(&settings_path).unwrap(),
        settings_before,
        "preview must not write settings"
    );
    assert_eq!(
        state.snapshot().unwrap(),
        library_before,
        "preview must not persist asset_count or last_scan_at"
    );
    let sidecars: Vec<_> = tree_bytes(&root)
        .into_keys()
        .filter(|path| {
            path.file_name()
                .is_some_and(|name| name == ".asset-tags.json")
        })
        .collect();
    assert_eq!(sidecars, [root.join(".asset-tags.json")]);
    assert!(
        preview
            .scan
            .assets
            .iter()
            .filter(|asset| asset.relative_path != "tagged.stl")
            .all(|asset| asset.metadata_id.is_none()),
        "no UUID is assigned during preview"
    );
}

#[test]
fn tag_rename_preview_discovers_external_additions_after_an_initial_scan() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "one.stl");
        write_manifest(root, &[("one.stl", 1, &["status:printed"])]);
    });
    let initial = snapshot_scan(&root, &state);
    assert_eq!(initial.assets.len(), 2);

    touch(&root, "new/nested/added.stl");
    write_manifest(
        &root.join("new/nested"),
        &[("added.stl", 2, &["status:printed"])],
    );

    let preview = run_ready(&state, status_to_state("external-add"));
    assert_eq!(target_paths(&preview), ["one.stl", "new/nested/added.stl"]);
    let inner = lock(&state);
    let snapshot = &inner.scan_snapshots[LIB];
    assert!(snapshot.assets.contains_key("path:new/nested/added.stl"));
    assert!(snapshot.editable_ids.contains("path:new/nested/added.stl"));
}

fn counting_library() -> (tempfile::TempDir, PathBuf, BackendState) {
    preview_library(|root| {
        touch(root, "r.stl");
        mkdir(root, "Legacy");
        mkdir(root, "Self");
        touch(root, "G/h/i.stl");
        touch(root, "G/h/j.stl");
        touch(root, "G/k.stl");
        write_manifest(
            root,
            &[
                (".", 1, &["status:a"]),
                ("r.stl", 2, &["status:b"]),
                ("Legacy", 3, &["status:c"]),
            ],
        );
        write_manifest(&root.join("Self"), &[(".", 4, &["status:d"])]);
        write_manifest(
            &root.join("G/h"),
            &[
                ("i.stl", 5, &["status:e"]),
                ("j.stl", 6, &["status:f", "other:x"]),
            ],
        );
        write_manifest(&root.join("G"), &[("k.stl", 7, &["other:x"])]);
    })
}

#[test]
fn tag_rename_preview_counts_nested_files_folders_and_distinct_sidecars() {
    let (_dir, _root, state) = counting_library();
    let preview = run_ready(&state, status_to_state("counts"));
    assert_eq!(
        target_paths(&preview),
        [".", "Legacy", "r.stl", "G/h/i.stl", "G/h/j.stl", "Self"],
        "targets are ordered by owning sidecar, then path"
    );
    assert_eq!(preview.file_count, 3);
    assert_eq!(preview.folder_count, 3);
    assert_eq!(preview.sidecar_count, 3, "root, Self and G/h own targets");
    assert_eq!(
        preview.targets.len(),
        preview.file_count + preview.folder_count
    );
    assert_eq!(preview.saved_search_update_count, 0);
    assert!(!preview.settings_retry);
}

fn exact_ab(scan_id: &str) -> RenamePreviewRequest {
    request_for(scan_id, RenameMode::Exact, "a", "b")
}

#[test]
fn tag_rename_preview_merge_existence_is_distinct_from_per_row_duplicate_collapse() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "both.stl");
        touch(root, "only-a.stl");
        touch(root, "elsewhere.stl");
        write_manifest(
            root,
            &[
                ("both.stl", 1, &["a", "b"]),
                ("only-a.stl", 2, &["a"]),
                ("elsewhere.stl", 3, &["b"]),
            ],
        );
    });
    let preview = run_ready(&state, exact_ab("merge-1"));
    assert_eq!(target_paths(&preview), ["both.stl", "only-a.stl"]);
    assert!(preview.destination_exists);
    assert_eq!(
        preview.collisions,
        [RenameCollision {
            from: "a".into(),
            to: "b".into()
        }]
    );
    assert_eq!(preview.duplicates_collapsed, 1, "only the row holding both");
    let per_row: Vec<_> = preview
        .targets
        .iter()
        .map(|target| (target.relative_path.as_str(), target.duplicates_collapsed))
        .collect();
    assert_eq!(per_row, [("both.stl", 1), ("only-a.stl", 0)]);
}

#[test]
fn tag_rename_preview_destination_existing_elsewhere_collapses_nothing_per_row() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "src.stl");
        touch(root, "elsewhere.stl");
        write_manifest(
            root,
            &[("src.stl", 1, &["a"]), ("elsewhere.stl", 2, &["b"])],
        );
    });
    let preview = run_ready(&state, exact_ab("merge-2"));
    assert!(preview.destination_exists, "a merge exists in the library");
    assert_eq!(preview.collisions.len(), 1);
    assert_eq!(
        preview.duplicates_collapsed, 0,
        "no row collapses a duplicate"
    );
    assert_eq!(preview.targets[0].duplicates_collapsed, 0);
}

#[test]
fn tag_rename_preview_absent_destination_reports_no_merge() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "src.stl");
        write_manifest(root, &[("src.stl", 1, &["a"])]);
    });
    let preview = run_ready(&state, exact_ab("merge-3"));
    assert!(!preview.destination_exists);
    assert!(preview.collisions.is_empty());
}

#[test]
fn tag_rename_preview_prefix_collisions_list_each_existing_destination_mapping() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "one.stl");
        touch(root, "two.stl");
        touch(root, "three.stl");
        touch(root, "existing.stl");
        write_manifest(
            root,
            &[
                ("one.stl", 1, &["status:x"]),
                ("two.stl", 2, &["status:y:z"]),
                ("three.stl", 3, &["status:w"]),
                ("existing.stl", 4, &["state:x", "state:y:z"]),
            ],
        );
    });
    let preview = run_ready(&state, status_to_state("merge-4"));
    assert!(preview.destination_exists);
    assert_eq!(
        preview.collisions,
        [
            RenameCollision {
                from: "status:x".into(),
                to: "state:x".into()
            },
            RenameCollision {
                from: "status:y:z".into(),
                to: "state:y:z".into()
            },
        ],
        "status:w maps to state:w which does not exist"
    );
}

#[test]
fn tag_rename_preview_prefix_destination_exists_for_any_tag_with_that_prefix() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "src.stl");
        touch(root, "other.stl");
        write_manifest(
            root,
            &[
                ("src.stl", 1, &["status:x"]),
                ("other.stl", 2, &["state:unrelated"]),
            ],
        );
    });
    let preview = run_ready(&state, status_to_state("merge-5"));
    assert!(preview.destination_exists);
    assert!(
        preview.collisions.is_empty(),
        "state:x itself does not exist yet"
    );
}

#[test]
fn tag_rename_preview_lists_missing_and_duplicate_uuid_rows_as_skipped_matches() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "good.stl");
        touch(root, "dup1.stl");
        touch(root, "sub/dup2.stl");
        write_manifest(
            root,
            &[
                ("good.stl", 1, &["status:ok"]),
                ("dup1.stl", 9, &["status:dup"]),
                ("gone.stl", 3, &["status:gone"]),
            ],
        );
        write_manifest(&root.join("sub"), &[("dup2.stl", 9, &["status:dup"])]);
    });
    let preview = run_ready(&state, status_to_state("skips"));
    assert_eq!(target_paths(&preview), ["good.stl"]);
    let skipped: Vec<_> = preview
        .skipped
        .iter()
        .map(|row| (row.relative_path.as_str(), row.reason))
        .collect();
    assert_eq!(
        skipped,
        [
            ("dup1.stl", SkipReason::Blocked),
            ("gone.stl", SkipReason::Missing),
            ("sub/dup2.stl", SkipReason::Blocked),
        ]
    );
    for row in &preview.skipped {
        let message = row.message.as_deref().expect("a related issue message");
        match row.reason {
            SkipReason::Blocked => {
                assert!(message.contains("Duplicate metadata UUID"), "{message}")
            }
            SkipReason::Missing => assert!(message.contains("missing"), "{message}"),
        }
    }
    assert!(preview.uninspectable.is_empty());
    assert_eq!(preview.file_count, 1);
}

#[test]
fn tag_rename_preview_lists_unreadable_manifests_as_uninspectable_never_as_matches() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "good.stl");
        touch(root, "bad/hidden.stl");
        write_manifest(root, &[("good.stl", 1, &["status:ok"])]);
        std::fs::write(root.join("bad/.asset-tags.json"), b"{ not json").unwrap();
    });
    let preview = run_ready(&state, status_to_state("uninspectable"));
    assert_eq!(target_paths(&preview), ["good.stl"]);
    assert!(preview.skipped.is_empty(), "tags are unknown, not matched");
    assert_eq!(preview.uninspectable.len(), 1);
    assert_eq!(preview.uninspectable[0].path, "bad/.asset-tags.json");
    assert_eq!(
        preview.uninspectable[0].message,
        "Metadata manifest is blocked"
    );
    assert_eq!(preview.file_count + preview.folder_count, 1);
}

#[test]
fn tag_rename_preview_lists_conflicting_folder_ownership_as_uninspectable() {
    let (_dir, _root, state) = preview_library(|root| {
        touch(root, "Both/x.stl");
        write_manifest(root, &[("Both", 1, &["status:a"])]);
        write_manifest(&root.join("Both"), &[(".", 2, &["status:a"])]);
    });
    let preview = run_ready(&state, status_to_state("conflict"));
    assert!(preview.targets.is_empty());
    assert!(preview.skipped.is_empty());
    assert!(preview
        .uninspectable
        .iter()
        .any(|issue| issue.message == "Conflicting folder metadata ownership"));
}

// Ownership parity: each bound target must resolve to the same owner and revision as
// the existing `prepare_tag_target`, which tag edits use.

fn assert_ownership_matches_tag_edits(
    state: &BackendState,
    root: &Path,
    id: &str,
) -> PendingPreview {
    let pending = lock(state)
        .rename
        .take_preview(LIB, id)
        .expect("preview is valid right after binding");
    assert!(!pending.targets.is_empty());
    {
        let inner = lock(state);
        for target in &pending.targets {
            let prepared =
                prepare_tag_target(&inner, LIB, root, &target.asset_id, &target.revision)
                    .unwrap_or_else(|error| {
                        panic!("{} rejected by tag-edit logic: {error:?}", target.asset_id)
                    });
            assert_eq!(prepared.owner_dir, target.owner_dir, "{}", target.asset_id);
            assert_eq!(prepared.owner_relative, target.sidecar_owner);
        }
    }
    let owners: std::collections::BTreeSet<_> = pending
        .targets
        .iter()
        .map(|t| t.owner_dir.clone())
        .collect();
    assert_eq!(
        pending
            .sources
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>(),
        owners,
        "sources are bound for exactly the owning sidecars"
    );
    for (owner, bytes) in &pending.sources {
        assert_eq!(
            bytes.as_deref(),
            Some(
                std::fs::read(owner.join(".asset-tags.json"))
                    .unwrap()
                    .as_slice()
            ),
            "exact on-disk bytes"
        );
    }
    pending
}

fn owner_of<'a>(pending: &'a PendingPreview, path: &str) -> &'a BoundTarget {
    pending
        .targets
        .iter()
        .find(|target| target.relative_path == path)
        .unwrap_or_else(|| panic!("{path} is a target"))
}

#[test]
fn tag_rename_preview_ownership_root_self_entry() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "a.stl");
        write_manifest(root, &[(".", 1, &["status:a"])]);
    });
    let preview = run_ready(&state, status_to_state("own-root"));
    assert_eq!(target_paths(&preview), ["."]);
    assert_eq!(preview.targets[0].kind, "folder");
    assert_eq!(preview.targets[0].sidecar_owner, ".");
    let pending = assert_ownership_matches_tag_edits(&state, &root, &preview.preview_id);
    assert_eq!(owner_of(&pending, ".").owner_dir, root);
}

#[test]
fn tag_rename_preview_ownership_folder_self_entry() {
    let (_dir, root, state) = preview_library(|root| {
        mkdir(root, "Self");
        write_manifest(&root.join("Self"), &[(".", 1, &["status:a"])]);
    });
    let preview = run_ready(&state, status_to_state("own-self"));
    assert_eq!(target_paths(&preview), ["Self"]);
    assert_eq!(preview.targets[0].sidecar_owner, "Self");
    let pending = assert_ownership_matches_tag_edits(&state, &root, &preview.preview_id);
    assert_eq!(owner_of(&pending, "Self").owner_dir, root.join("Self"));
}

#[test]
fn tag_rename_preview_ownership_legacy_parent_entry() {
    let (_dir, root, state) = preview_library(|root| {
        mkdir(root, "Legacy");
        write_manifest(root, &[("Legacy", 1, &["status:a"])]);
    });
    let preview = run_ready(&state, status_to_state("own-legacy"));
    assert_eq!(target_paths(&preview), ["Legacy"]);
    assert_eq!(preview.targets[0].sidecar_owner, ".");
    let pending = assert_ownership_matches_tag_edits(&state, &root, &preview.preview_id);
    assert_eq!(owner_of(&pending, "Legacy").owner_dir, root);
}

#[test]
fn tag_rename_preview_ownership_legacy_parent_entry_with_unrelated_folder_manifest() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "Legacy/inner.stl");
        write_manifest(root, &[("Legacy", 1, &["status:a"])]);
        write_manifest(&root.join("Legacy"), &[("inner.stl", 2, &["other:x"])]);
    });
    let preview = run_ready(&state, status_to_state("own-legacy-2"));
    assert_eq!(target_paths(&preview), ["Legacy"]);
    let pending = assert_ownership_matches_tag_edits(&state, &root, &preview.preview_id);
    assert_eq!(owner_of(&pending, "Legacy").owner_dir, root);
}

#[test]
fn tag_rename_preview_ownership_nested_file_uses_its_parent_manifest() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "a/b/c.stl");
        touch(root, "a/b/d.stl");
        write_manifest(
            &root.join("a/b"),
            &[("c.stl", 1, &["status:a"]), ("d.stl", 2, &["status:b"])],
        );
    });
    let preview = run_ready(&state, status_to_state("own-nested"));
    assert_eq!(target_paths(&preview), ["a/b/c.stl", "a/b/d.stl"]);
    assert_eq!(preview.sidecar_count, 1);
    assert_eq!(preview.targets[0].sidecar_owner, "a/b");
    let pending = assert_ownership_matches_tag_edits(&state, &root, &preview.preview_id);
    assert_eq!(owner_of(&pending, "a/b/c.stl").owner_dir, root.join("a/b"));
    assert_eq!(pending.targets[0].revision, {
        let asset = preview
            .scan
            .assets
            .iter()
            .find(|asset| asset.relative_path == "a/b/c.stl")
            .unwrap();
        asset.metadata_revision.clone()
    });
}

#[test]
fn tag_rename_preview_binds_a_fresh_valid_preview_at_the_current_generation() {
    let (_dir, _root, state) = counting_library();
    let preview = run_ready(&state, status_to_state("bound"));
    let inner = lock(&state);
    assert!(inner.rename.has_pending_preview(LIB));
    drop(inner);
    let pending = lock(&state)
        .rename
        .take_preview(LIB, &preview.preview_id)
        .expect("valid immediately after binding");
    assert_eq!(pending.scan_id, "bound");
    assert_eq!(pending.mapping, preview.mapping);
    assert_eq!(pending.targets.len(), preview.targets.len());
    assert!(!pending.settings_retry);
}

// Rejection before any scan registration: no state change at all.

fn state_fingerprint(state: &BackendState) -> (u64, usize, bool, Vec<u8>) {
    let inner = lock(state);
    (
        inner.rename.current_generation(),
        inner.scan_cancellations.len(),
        inner.scan_snapshots.contains_key(LIB) || inner.rename.has_pending_preview(LIB),
        std::fs::read(&inner.settings_path).unwrap_or_default(),
    )
}

fn assert_rejected_before_scan(state: &BackendState, request: RenamePreviewRequest, needle: &str) {
    let before = state_fingerprint(state);
    let progress_calls = std::cell::Cell::new(0);
    let error = preview_tag_rename_domain(
        state,
        request,
        |_| progress_calls.set(progress_calls.get() + 1),
        &mut FsPreviewEnv,
    )
    .expect_err("request must be rejected");
    assert!(
        error
            .message
            .to_lowercase()
            .contains(&needle.to_lowercase()),
        "expected {needle:?} in {:?}",
        error.message
    );
    assert_eq!(progress_calls.get(), 0, "no scan may start");
    assert_eq!(state_fingerprint(state), before, "no state change");
}

fn simple_library() -> (tempfile::TempDir, PathBuf, BackendState) {
    preview_library(|root| {
        touch(root, "a.stl");
        write_manifest(root, &[("a.stl", 1, &["status:a"])]);
    })
}

#[test]
fn tag_rename_preview_rejects_a_mapping_that_differs_from_native_normalization() {
    let (_dir, _root, state) = simple_library();
    let mut request = status_to_state("reject-1");
    request.normalized_mapping.destination = "other".into();
    assert_rejected_before_scan(&state, request, "mapping");
    let mut request = status_to_state("reject-1b");
    request.normalized_mapping.mode = RenameMode::Exact;
    assert_rejected_before_scan(&state, request, "mapping");
    let mut request = status_to_state("reject-1c");
    request.source = "Status".into();
    request.normalized_mapping.source = "Status".into();
    assert_rejected_before_scan(&state, request, "mapping");
}

#[test]
fn tag_rename_preview_rejects_names_that_native_normalization_refuses() {
    let (_dir, _root, state) = simple_library();
    for (mode, source, destination, needle) in [
        (RenameMode::Exact, "a", "A ", "unchanged"),
        (RenameMode::Exact, " ", "b", "source"),
        (RenameMode::Exact, "a", "", "destination"),
        (RenameMode::Prefix, "a:b", "c", "prefix"),
    ] {
        let mut request = status_to_state("reject-2");
        request.mode = mode;
        request.source = source.into();
        request.destination = destination.into();
        assert_rejected_before_scan(&state, request, needle);
    }
}

#[test]
fn tag_rename_preview_rejects_an_unknown_library_without_state_change() {
    let (_dir, _root, state) = simple_library();
    let mut request = status_to_state("reject-3");
    request.library_id = "no-such-library".into();
    assert_rejected_before_scan(&state, request, "unknown library");
}

fn searches_library() -> (tempfile::TempDir, PathBuf, BackendState, String, String) {
    let (dir, root, state) = simple_library();
    let other_root = dir.path().join("other-root");
    std::fs::create_dir(&other_root).unwrap();
    add_library(
        &state,
        "other",
        &std::fs::canonicalize(&other_root).unwrap(),
    );
    let ours = upsert_saved_search_domain(&state, LIB, "Ours", dto_filters("status"), None)
        .unwrap()
        .saved_searches
        .into_iter()
        .find(|search| search.name == "Ours")
        .unwrap()
        .id;
    let theirs = upsert_saved_search_domain(&state, "other", "Theirs", dto_filters("status"), None)
        .unwrap()
        .saved_searches
        .into_iter()
        .find(|search| search.name == "Theirs")
        .unwrap()
        .id;
    (dir, root, state, ours, theirs)
}

fn replacement_for(id: &str) -> SavedSearchReplacement {
    SavedSearchReplacement {
        search_id: id.into(),
        expected_filters: dto_filters("status"),
        filters: dto_filters("state"),
    }
}

fn with_replacements(
    scan_id: &str,
    replacements: Vec<SavedSearchReplacement>,
) -> RenamePreviewRequest {
    RenamePreviewRequest {
        saved_search_replacements: replacements,
        ..status_to_state(scan_id)
    }
}

#[test]
fn tag_rename_preview_rejects_unknown_saved_search_ids() {
    let (_dir, _root, state, _ours, _theirs) = searches_library();
    assert_rejected_before_scan(
        &state,
        with_replacements("rep-1", vec![replacement_for("no-such-search")]),
        "unknown saved search",
    );
}

#[test]
fn tag_rename_preview_rejects_a_saved_search_from_another_library() {
    let (_dir, _root, state, _ours, theirs) = searches_library();
    assert_rejected_before_scan(
        &state,
        with_replacements("rep-2", vec![replacement_for(&theirs)]),
        "another library",
    );
}

#[test]
fn tag_rename_preview_rejects_expected_filters_that_differ_from_current_settings() {
    let (_dir, _root, state, ours, _theirs) = searches_library();
    let mut stale = replacement_for(&ours);
    stale.expected_filters.query = "status:printed".into();
    assert_rejected_before_scan(&state, with_replacements("rep-3", vec![stale]), "changed");
}

#[test]
fn tag_rename_preview_rejects_replacements_that_change_more_than_the_query() {
    let (_dir, _root, state, ours, _theirs) = searches_library();
    let mut view = replacement_for(&ours);
    view.filters.view = SearchView::Untagged;
    assert_rejected_before_scan(
        &state,
        with_replacements("rep-4a", vec![view]),
        "only the query",
    );
    let mut mode = replacement_for(&ours);
    mode.filters.match_mode = MatchMode::Any;
    assert_rejected_before_scan(
        &state,
        with_replacements("rep-4b", vec![mode]),
        "only the query",
    );
    let mut kind = replacement_for(&ours);
    kind.filters.kind = SearchKind::File;
    assert_rejected_before_scan(
        &state,
        with_replacements("rep-4c", vec![kind]),
        "only the query",
    );
}

#[test]
fn tag_rename_preview_rejects_duplicate_saved_search_ids() {
    let (_dir, _root, state, ours, _theirs) = searches_library();
    assert_rejected_before_scan(
        &state,
        with_replacements(
            "rep-5",
            vec![replacement_for(&ours), replacement_for(&ours)],
        ),
        "more than once",
    );
}

#[test]
fn tag_rename_preview_rejects_a_no_op_replacement() {
    let (_dir, _root, state, ours, _theirs) = searches_library();
    let mut noop = replacement_for(&ours);
    noop.filters = noop.expected_filters.clone();
    assert_rejected_before_scan(&state, with_replacements("rep-6", vec![noop]), "no change");
}

#[test]
fn tag_rename_preview_accepts_empty_and_valid_replacement_sets_and_binds_them() {
    let (_dir, _root, state, ours, _theirs) = searches_library();
    let empty = run_ready(&state, with_replacements("rep-7a", vec![]));
    assert_eq!(empty.saved_search_update_count, 0);

    let preview = run_ready(
        &state,
        with_replacements("rep-7b", vec![replacement_for(&ours)]),
    );
    assert_eq!(preview.saved_search_update_count, 1);
    let pending = lock(&state)
        .rename
        .take_preview(LIB, &preview.preview_id)
        .unwrap();
    assert_eq!(pending.replacements, [replacement_for(&ours)]);
    assert_eq!(
        lock(&state)
            .saved_searches
            .iter()
            .find(|search| search.id == ours)
            .unwrap()
            .filters,
        dto_filters("status"),
        "preview never rewrites settings"
    );
}

#[test]
fn tag_rename_shared_validator_checks_current_settings_for_any_caller() {
    let (_dir, _root, state, ours, theirs) = searches_library();
    let inner = lock(&state);
    assert!(validate_saved_search_replacements(&inner, LIB, &[]).is_ok());
    assert!(validate_saved_search_replacements(&inner, LIB, &[replacement_for(&ours)]).is_ok());
    assert!(validate_saved_search_replacements(&inner, LIB, &[replacement_for(&theirs)]).is_err());
    assert!(
        validate_saved_search_replacements(&inner, "other", &[replacement_for(&theirs)]).is_ok()
    );
}

#[test]
fn tag_rename_preview_settings_retry_requires_a_proof_with_an_identical_mapping() {
    let (_dir, root, state) = simple_library();
    assert!(!run_ready(&state, status_to_state("retry-0")).settings_retry);
    lock(&state).rename.store_retry_proof(RetryProof {
        library_id: LIB.into(),
        root: root.clone(),
        mapping: normalize_mapping(RenameMode::Prefix, "other", "thing").unwrap(),
        committed: vec![],
        replacements: vec![],
    });
    assert!(
        !run_ready(&state, status_to_state("retry-1")).settings_retry,
        "a proof for another mapping does not apply"
    );
    lock(&state).rename.store_retry_proof(RetryProof {
        library_id: LIB.into(),
        root,
        mapping: state_mapping(),
        committed: vec![],
        replacements: vec![],
    });
    let preview = run_ready(&state, status_to_state("retry-2"));
    assert!(preview.settings_retry);
    let pending = lock(&state)
        .rename
        .take_preview(LIB, &preview.preview_id)
        .unwrap();
    assert!(pending.settings_retry);
    assert!(
        lock(&state).rename.retry_proof(LIB).is_some(),
        "preview does not consume the proof"
    );
}

// Cancellation, discard, supersession.

#[test]
fn tag_rename_preview_cancellation_through_the_registry_yields_cancelled() {
    let (_dir, _root, state) = simple_library();
    let before_generation = lock(&state).rename.current_generation();
    let app = tauri::test::mock_app();
    app.manage(state.clone());
    let saw_registration = std::cell::Cell::new(false);
    let outcome = preview_tag_rename_domain(
        &state,
        status_to_state("cancel-1"),
        |_| {
            assert_eq!(
                state.with_update_install_lock(|| Ok(())),
                Err("Stop scans and wait for them to finish before updating".to_string()),
                "the preview scan is visible to updater exclusion"
            );
            let cancelled =
                cancel_scan(LIB.into(), "cancel-1".into(), app.state::<BackendState>()).unwrap();
            saw_registration.set(cancelled);
        },
        &mut FsPreviewEnv,
    )
    .unwrap();
    assert!(saw_registration.get(), "cancel_scan found the registration");
    assert_eq!(outcome, RenamePreviewOutcome::Cancelled);
    assert_eq!(registrations(&state), 0);
    assert!(!has_snapshot(&state), "cancelled previews publish nothing");
    assert!(!lock(&state).rename.has_pending_preview(LIB));
    assert_eq!(lock(&state).rename.current_generation(), before_generation);
}

struct HookEnv<F: FnMut()> {
    inner: FsPreviewEnv,
    hook: F,
}

impl<F: FnMut()> PreviewEnv for HookEnv<F> {
    fn sidecar_exists(&mut self, dir: &Path) -> bool {
        self.inner.sidecar_exists(dir)
    }
    fn read_sidecar(&mut self, dir: &Path) -> manifest::ReadManifest {
        self.inner.read_sidecar(dir)
    }
    fn after_registered(&mut self) {
        (self.hook)();
    }
}

#[test]
fn tag_rename_preview_cancelled_before_traversal_stops_immediately() {
    let (_dir, _root, state) = simple_library();
    let app = tauri::test::mock_app();
    app.manage(state.clone());
    let mut env = HookEnv {
        inner: FsPreviewEnv,
        hook: || {
            assert!(
                cancel_scan(LIB.into(), "cancel-2".into(), app.state::<BackendState>()).unwrap()
            );
        },
    };
    let outcome =
        preview_tag_rename_domain(&state, status_to_state("cancel-2"), |_| {}, &mut env).unwrap();
    assert_eq!(outcome, RenamePreviewOutcome::Cancelled);
    assert_eq!(registrations(&state), 0);
    assert!(!has_snapshot(&state));
}

#[test]
fn tag_rename_preview_conflicting_mutation_during_traversal_is_discarded_without_publication() {
    let (_dir, root, state) = simple_library();
    let prior = snapshot_scan(&root, &state);
    let prior_ids: Vec<_> = prior.assets.iter().map(|a| a.id.clone()).collect();
    touch(&root, "added-after-prior-scan.stl");
    let done = std::cell::Cell::new(false);
    let outcome = preview_tag_rename_domain(
        &state,
        status_to_state("discard-1"),
        |_| {
            if !done.replace(true) {
                set_app_theme_domain(&state, AppTheme::Midnight).unwrap();
            }
        },
        &mut FsPreviewEnv,
    )
    .unwrap();
    assert_eq!(
        outcome,
        RenamePreviewOutcome::Discarded {
            reason: DiscardReason::Mutation
        }
    );
    assert_eq!(registrations(&state), 0);
    assert!(!lock(&state).rename.has_pending_preview(LIB));
    let inner = lock(&state);
    let snapshot = &inner.scan_snapshots[LIB];
    let mut ids: Vec<_> = snapshot.assets.keys().cloned().collect();
    ids.sort();
    let mut expected = prior_ids;
    expected.sort();
    assert_eq!(ids, expected, "the prior snapshot is untouched");
}

#[test]
fn tag_rename_preview_library_removed_during_traversal_is_discarded() {
    let (_dir, _root, state) = simple_library();
    let done = std::cell::Cell::new(false);
    let outcome = preview_tag_rename_domain(
        &state,
        status_to_state("discard-2"),
        |_| {
            if !done.replace(true) {
                remove_library_domain(&state, LIB).unwrap();
            }
        },
        &mut FsPreviewEnv,
    )
    .unwrap();
    assert_eq!(
        outcome,
        RenamePreviewOutcome::Discarded {
            reason: DiscardReason::LibraryChanged
        }
    );
    assert_eq!(registrations(&state), 0);
    assert!(!has_snapshot(&state));
}

#[test]
fn tag_rename_preview_root_changed_during_traversal_is_discarded() {
    let (dir, root, state) = simple_library();
    let done = std::cell::Cell::new(false);
    let outcome = preview_tag_rename_domain(
        &state,
        status_to_state("discard-3"),
        |_| {
            if !done.replace(true) {
                std::fs::rename(&root, dir.path().join("moved-away")).unwrap();
            }
        },
        &mut FsPreviewEnv,
    )
    .unwrap();
    assert_eq!(
        outcome,
        RenamePreviewOutcome::Discarded {
            reason: DiscardReason::LibraryChanged
        }
    );
    assert_eq!(registrations(&state), 0);
    assert!(!has_snapshot(&state));
    assert!(!lock(&state).rename.has_pending_preview(LIB));
}

#[test]
fn tag_rename_preview_sidecar_changed_after_the_scan_is_discarded_without_publication() {
    for mutate in [
        (|root: &Path| std::fs::remove_file(root.join(".asset-tags.json")).unwrap()) as fn(&Path),
        |root: &Path| write_manifest(root, &[("a.stl", 1, &["status:a", "extra"])]),
    ] {
        let (_dir, root, state) = simple_library();
        let done = std::cell::Cell::new(false);
        let outcome = preview_tag_rename_domain(
            &state,
            status_to_state("discard-4"),
            |_| {
                if !done.replace(true) {
                    mutate(&root);
                }
            },
            &mut FsPreviewEnv,
        )
        .unwrap();
        assert_eq!(
            outcome,
            RenamePreviewOutcome::Discarded {
                reason: DiscardReason::SidecarChanged
            }
        );
        assert_eq!(registrations(&state), 0);
        assert!(!has_snapshot(&state));
        assert!(!lock(&state).rename.has_pending_preview(LIB));
    }
}

#[test]
fn tag_rename_preview_second_preview_supersedes_the_first() {
    let (_dir, _root, state) = simple_library();
    let first = run_ready(&state, status_to_state("super-1"));
    let second = run_ready(&state, status_to_state("super-2"));
    assert_ne!(first.preview_id, second.preview_id);
    assert!(lock(&state)
        .rename
        .take_preview(LIB, &first.preview_id)
        .is_err());
    assert!(lock(&state)
        .rename
        .take_preview(LIB, &second.preview_id)
        .is_ok());
    assert_eq!(registrations(&state), 0);
}

#[test]
fn tag_rename_preview_overlapping_latest_supersedes_in_flight_and_old_ready_preview() {
    let (_dir, _root, state) = simple_library();
    let initial = run_ready(&state, request_for("initial", RenameMode::Exact, "a", "b"));
    assert!(lock(&state).rename.has_pending_preview(LIB));
    let initial_id = initial.preview_id.clone();

    let ordinary_flag = Arc::new(AtomicBool::new(false));
    lock(&state).scan_cancellations.insert(
        (LIB.to_string(), "ordinary-scan-1".to_string()),
        ordinary_flag.clone(),
    );

    let (t1_reg_tx, t1_reg_rx) = std::sync::mpsc::sync_channel::<()>(0);
    let (t1_proceed_tx, t1_proceed_rx) = std::sync::mpsc::sync_channel::<()>(0);
    let (t2_reg_tx, t2_reg_rx) = std::sync::mpsc::sync_channel::<()>(0);
    let (t2_proceed_tx, t2_proceed_rx) = std::sync::mpsc::sync_channel::<()>(0);

    let state_t1 = state.clone();
    let handle_1 = std::thread::spawn(move || {
        let mut env = HookEnv {
            inner: FsPreviewEnv,
            hook: || {
                t1_reg_tx.send(()).unwrap();
                t1_proceed_rx.recv().unwrap();
            },
        };
        preview_tag_rename_domain(
            &state_t1,
            request_for("oldest", RenameMode::Exact, "a", "old_dst"),
            |_| {},
            &mut env,
        )
    });

    t1_reg_rx.recv().unwrap();

    let state_t2 = state.clone();
    let handle_2 = std::thread::spawn(move || {
        let mut env = HookEnv {
            inner: FsPreviewEnv,
            hook: || {
                t2_reg_tx.send(()).unwrap();
                t2_proceed_rx.recv().unwrap();
            },
        };
        preview_tag_rename_domain(
            &state_t2,
            request_for("latest", RenameMode::Exact, "a", "new_dst"),
            |_| {},
            &mut env,
        )
    });

    t2_reg_rx.recv().unwrap();

    // Old ready preview is invalid as soon as new valid preview starts.
    assert!(
        !lock(&state).rename.has_pending_preview(LIB),
        "old ready preview must be invalid once new valid preview starts"
    );
    assert!(
        lock(&state).rename.take_preview(LIB, &initial_id).is_err(),
        "old ready preview cannot be taken"
    );
    // Ordinary scan must not be cancelled.
    assert!(
        !ordinary_flag.load(Ordering::Relaxed),
        "ordinary unrelated scans must not be cancelled"
    );

    // Oldest finishes traversal first.
    t1_proceed_tx.send(()).unwrap();
    let outcome_1 = handle_1
        .join()
        .unwrap()
        .expect("domain execution succeeded");
    assert_eq!(
        outcome_1,
        RenamePreviewOutcome::Cancelled,
        "oldest in-flight preview must be cancelled by the newer preview"
    );

    // Latest finishes traversal second.
    t2_proceed_tx.send(()).unwrap();
    let outcome_2 = handle_2
        .join()
        .unwrap()
        .expect("domain execution succeeded");
    let preview_2 = match outcome_2 {
        RenamePreviewOutcome::Ready { preview } => *preview,
        other => panic!("expected latest preview to be Ready, got {other:?}"),
    };
    assert_eq!(preview_2.mapping.destination, "new_dst");

    // State reflects latest preview.
    let pending = lock(&state)
        .rename
        .take_preview(LIB, &preview_2.preview_id)
        .expect("latest preview is pending and valid");
    assert_eq!(pending.mapping.destination, "new_dst");

    // Registrations are cleaned, ordinary scan remains untouched.
    assert_eq!(
        registrations(&state),
        1,
        "only the ordinary scan remains registered"
    );
    assert!(!ordinary_flag.load(Ordering::Relaxed));
    assert!(lock(&state)
        .scan_cancellations
        .contains_key(&(LIB.to_string(), "ordinary-scan-1".to_string())));
}

#[test]
fn tag_rename_preview_overlapping_with_same_scan_id_cleans_registrations_and_latest_wins() {
    let (_dir, _root, state) = simple_library();

    let (t1_reg_tx, t1_reg_rx) = std::sync::mpsc::sync_channel::<()>(0);
    let (t1_proceed_tx, t1_proceed_rx) = std::sync::mpsc::sync_channel::<()>(0);
    let (t2_reg_tx, t2_reg_rx) = std::sync::mpsc::sync_channel::<()>(0);
    let (t2_proceed_tx, t2_proceed_rx) = std::sync::mpsc::sync_channel::<()>(0);

    let state_t1 = state.clone();
    let handle_1 = std::thread::spawn(move || {
        let mut env = HookEnv {
            inner: FsPreviewEnv,
            hook: || {
                t1_reg_tx.send(()).unwrap();
                t1_proceed_rx.recv().unwrap();
            },
        };
        preview_tag_rename_domain(
            &state_t1,
            request_for("shared-scan", RenameMode::Exact, "a", "dst_1"),
            |_| {},
            &mut env,
        )
    });

    t1_reg_rx.recv().unwrap();

    let state_t2 = state.clone();
    let handle_2 = std::thread::spawn(move || {
        let mut env = HookEnv {
            inner: FsPreviewEnv,
            hook: || {
                t2_reg_tx.send(()).unwrap();
                t2_proceed_rx.recv().unwrap();
            },
        };
        preview_tag_rename_domain(
            &state_t2,
            request_for("shared-scan", RenameMode::Exact, "a", "dst_2"),
            |_| {},
            &mut env,
        )
    });

    t2_reg_rx.recv().unwrap();

    // Oldest finishes first.
    t1_proceed_tx.send(()).unwrap();
    let outcome_1 = handle_1.join().unwrap().expect("domain call succeeded");
    assert_eq!(outcome_1, RenamePreviewOutcome::Cancelled);

    // Latest finishes second.
    t2_proceed_tx.send(()).unwrap();
    let outcome_2 = handle_2.join().unwrap().expect("domain call succeeded");
    let preview_2 = match outcome_2 {
        RenamePreviewOutcome::Ready { preview } => *preview,
        other => panic!("expected Ready, got {other:?}"),
    };
    assert_eq!(preview_2.mapping.destination, "dst_2");

    assert_eq!(
        registrations(&state),
        0,
        "registrations must be completely cleaned"
    );
}

#[test]
fn tag_rename_preview_rejected_request_does_not_invalidate_existing_ready_preview() {
    let (_dir, _root, state) = simple_library();
    let initial = run_ready(&state, request_for("initial", RenameMode::Exact, "a", "b"));
    let initial_id = initial.preview_id.clone();
    assert!(lock(&state).rename.has_pending_preview(LIB));

    // Submit an invalid request (destination empty).
    let mut invalid = request_for("invalid", RenameMode::Exact, "a", "b");
    invalid.destination = "".into();
    let res = preview_tag_rename_domain(&state, invalid, |_| {}, &mut FsPreviewEnv);
    assert!(res.is_err(), "invalid request must fail before start");

    // Existing ready preview remains intact and valid!
    assert!(lock(&state).rename.has_pending_preview(LIB));
    assert!(lock(&state).rename.take_preview(LIB, &initial_id).is_ok());
}

#[test]
fn tag_rename_preview_republishing_invalidates_other_librarys_previews() {
    let (dir, _root, state) = simple_library();
    let other_root = dir.path().join("second-root");
    std::fs::create_dir(&other_root).unwrap();
    add_library(
        &state,
        "second",
        &std::fs::canonicalize(other_root).unwrap(),
    );
    let first = run_ready(&state, status_to_state("super-3"));
    let mut request = status_to_state("super-4");
    request.library_id = "second".into();
    let second = run_ready(&state, request);
    assert!(
        lock(&state)
            .rename
            .take_preview(LIB, &first.preview_id)
            .is_err(),
        "publishing another snapshot conservatively invalidates earlier previews"
    );
    assert!(lock(&state)
        .rename
        .take_preview("second", &second.preview_id)
        .is_ok());
}

// RAII registration cleanup, with explicit deadlock protection.

fn run_with_timeout<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> std::thread::Result<T> {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
        let _ = sender.send(result);
    });
    receiver
        .recv_timeout(std::time::Duration::from_secs(30))
        .expect("the preview must finish; a hang means the cleanup guard deadlocked")
}

#[test]
fn tag_rename_preview_registration_is_removed_on_success_and_every_terminal_path() {
    let (_dir, _root, state) = simple_library();
    run_ready(&state, status_to_state("raii-ok"));
    assert_eq!(registrations(&state), 0, "success");

    let mut unchanged = status_to_state("raii-bad");
    unchanged.destination = "status".into();
    assert!(run_preview(&state, unchanged).is_err());
    assert_eq!(registrations(&state), 0, "pre-scan rejection");

    let seen = std::cell::Cell::new(0);
    let _ = preview_tag_rename_domain(
        &state,
        status_to_state("raii-live"),
        |_| seen.set(registrations(&state)),
        &mut FsPreviewEnv,
    );
    assert_eq!(seen.get(), 1, "registered while the scan runs");
    assert_eq!(registrations(&state), 0);
}

#[test]
fn tag_rename_preview_registration_is_removed_when_the_scan_errors() {
    let (dir, root, state) = simple_library();
    let moved = dir.path().join("gone");
    let mut env = HookEnv {
        inner: FsPreviewEnv,
        hook: || std::fs::rename(&root, &moved).unwrap(),
    };
    let error = preview_tag_rename_domain(&state, status_to_state("raii-err"), |_| {}, &mut env)
        .expect_err("a vanished root is a scan error");
    assert!(!error.message.is_empty());
    assert_eq!(registrations(&state), 0);
    assert!(!has_snapshot(&state));
    assert!(!lock(&state).rename.has_pending_preview(LIB));
}

#[test]
fn tag_rename_preview_registration_is_removed_when_traversal_panics() {
    let (_dir, _root, state) = simple_library();
    let worker = state.clone();
    let result = run_with_timeout(move || {
        preview_tag_rename_domain(
            &worker,
            status_to_state("raii-panic"),
            |_| panic!("injected traversal panic"),
            &mut FsPreviewEnv,
        )
    });
    assert!(result.is_err(), "the panic propagated");
    assert_eq!(registrations(&state), 0);
    assert!(
        state.inner.lock().is_ok(),
        "a panic outside the lock does not poison the backend mutex"
    );
    assert!(!has_snapshot(&state));
}

struct PanickingReader;

impl PreviewEnv for PanickingReader {
    fn sidecar_exists(&mut self, dir: &Path) -> bool {
        FsPreviewEnv.sidecar_exists(dir)
    }
    fn read_sidecar(&mut self, _dir: &Path) -> manifest::ReadManifest {
        panic!("injected panic while the backend mutex is held");
    }
}

#[test]
fn tag_rename_preview_guard_drop_does_not_deadlock_when_panicking_under_the_lock() {
    let (_dir, _root, state) = simple_library();
    let worker = state.clone();
    let result = run_with_timeout(move || {
        preview_tag_rename_domain(
            &worker,
            status_to_state("raii-panic-locked"),
            |_| {},
            &mut PanickingReader,
        )
    });
    assert!(result.is_err(), "the panic propagated and the guard ran");
    assert_eq!(
        registrations(&state),
        0,
        "cleanup recovers from the poisoned mutex"
    );
}

#[test]
fn tag_rename_preview_guard_removes_only_its_own_registration() {
    let (_dir, _root, state) = simple_library();
    // A different live scan under the same key must survive this preview's cleanup.
    let other = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let replaced = other.clone();
    let mut env = HookEnv {
        inner: FsPreviewEnv,
        hook: || {
            lock(&state)
                .scan_cancellations
                .insert((LIB.into(), "raii-own".into()), replaced.clone());
        },
    };
    let _ = preview_tag_rename_domain(&state, status_to_state("raii-own"), |_| {}, &mut env);
    let inner = lock(&state);
    let kept = inner
        .scan_cancellations
        .get(&(LIB.to_string(), "raii-own".to_string()))
        .expect("the foreign registration is kept");
    assert!(std::sync::Arc::ptr_eq(kept, &other));
}

// CON-2: each owning sidecar is read exactly once.

struct CountingEnv {
    reads: Vec<PathBuf>,
}

impl PreviewEnv for CountingEnv {
    fn sidecar_exists(&mut self, dir: &Path) -> bool {
        FsPreviewEnv.sidecar_exists(dir)
    }
    fn read_sidecar(&mut self, dir: &Path) -> manifest::ReadManifest {
        self.reads.push(dir.to_path_buf());
        FsPreviewEnv.read_sidecar(dir)
    }
}

#[test]
fn tag_rename_preview_reads_each_owning_sidecar_exactly_once() {
    let (_dir, _root, state) = counting_library();
    let mut env = CountingEnv { reads: vec![] };
    let preview = ready(
        preview_tag_rename_domain(&state, status_to_state("reads-1"), |_| {}, &mut env).unwrap(),
    );
    assert_eq!(preview.targets.len(), 6, "six targets share three owners");
    assert_eq!(preview.sidecar_count, 3);
    let mut sorted = env.reads.clone();
    sorted.sort();
    let distinct: std::collections::BTreeSet<_> = env.reads.iter().cloned().collect();
    assert_eq!(sorted.len(), distinct.len(), "no sidecar is read twice");
    assert_eq!(env.reads.len(), preview.sidecar_count);
    let pending = lock(&state)
        .rename
        .take_preview(LIB, &preview.preview_id)
        .unwrap();
    assert_eq!(
        distinct,
        pending.sources.keys().cloned().collect(),
        "reads are exactly the bound owners"
    );
}

#[test]
fn tag_rename_preview_legacy_folder_ownership_needs_no_extra_sidecar_read() {
    let (_dir, _root, state) = preview_library(|root| {
        mkdir(root, "Legacy");
        touch(root, "f.stl");
        write_manifest(
            root,
            &[("Legacy", 1, &["status:a"]), ("f.stl", 2, &["status:b"])],
        );
    });
    let mut env = CountingEnv { reads: vec![] };
    let preview = ready(
        preview_tag_rename_domain(&state, status_to_state("reads-2"), |_| {}, &mut env).unwrap(),
    );
    assert_eq!(preview.sidecar_count, 1);
    assert_eq!(env.reads.len(), 1, "one owner, one read");
}

// Command wrapper over the domain function.

#[test]
fn tag_rename_preview_command_reports_progress_and_returns_the_tagged_outcome() {
    let (_dir, _root, state) = counting_library();
    let app = tauri::test::mock_app();
    app.manage(state.clone());
    let managed = app.state::<BackendState>();
    let progress = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = progress.clone();
    let channel: Channel<ScanProgress> = Channel::new(move |_| {
        counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    });
    let outcome = tauri::async_runtime::block_on(preview_tag_rename(
        status_to_state("command-1"),
        channel,
        managed,
    ))
    .unwrap();
    let preview = ready(outcome.clone());
    assert_eq!(preview.scan_id, "command-1");
    assert!(progress.load(std::sync::atomic::Ordering::SeqCst) >= 1);
    let value = serde_json::to_value(&outcome).unwrap();
    assert_eq!(value["status"], "ready");
    assert_eq!(value["preview"]["previewId"], preview.preview_id);
    assert_eq!(registrations(&state), 0);
}

#[test]
fn tag_rename_preview_dto_scan_matches_the_published_snapshot() {
    let (_dir, _root, state) = counting_library();
    let preview = run_ready(&state, status_to_state("snapshot"));
    let inner = lock(&state);
    let snapshot = &inner.scan_snapshots[LIB];
    assert_eq!(snapshot.assets.len(), preview.scan.assets.len());
    for asset in &preview.scan.assets {
        assert_eq!(snapshot.assets[&asset.id], *asset);
    }
    assert_eq!(preview.scan.library_id, LIB);
    assert_eq!(preview.scan.scan_id, "snapshot");
}

// ---------------------------------------------------------------------------
// T8: revision-bound grouped sidecar preparation (preflight only).
//
// The preflight consumes the opaque preview, rechecks everything it bound and
// builds every serialized sidecar in memory. It never writes. Every rejection
// test asserts that the injected writer recorded zero calls and that the
// disposable tree and settings are byte-identical afterwards.
// ---------------------------------------------------------------------------

fn pf_run(
    state: &BackendState,
    preview_id: &str,
    env: &mut dyn PreviewEnv,
) -> (Result<PreparedRename, AppError>, usize) {
    let writes = std::cell::Cell::new(0usize);
    let result = preflight_tag_rename_apply(state, LIB, preview_id, env, |_, _, _| {
        writes.set(writes.get() + 1);
        Ok(())
    });
    (result, writes.get())
}

fn pf_ok(state: &BackendState, root: &Path, preview_id: &str) -> PreparedRename {
    let before = tree_bytes(root);
    let (result, writes) = pf_run(state, preview_id, &mut FsPreviewEnv);
    assert_eq!(writes, 0, "preflight must never call the writer");
    assert_eq!(
        tree_bytes(root),
        before,
        "preflight must not touch the tree"
    );
    result.expect("preflight should succeed")
}

/// Asserts a rejection carrying `needle`, with zero writer calls and no change
/// to the tree, settings file or mutation generation.
fn pf_reject(state: &BackendState, root: &Path, preview_id: &str, needle: &str) {
    let tree = tree_bytes(root);
    let settings = std::fs::read(&lock(state).settings_path).unwrap_or_default();
    let generation_before = generation(state);
    let (result, writes) = pf_run(state, preview_id, &mut FsPreviewEnv);
    let error = result.expect_err("preflight must reject");
    assert!(
        error
            .message
            .to_lowercase()
            .contains(&needle.to_lowercase()),
        "expected {needle:?} in {:?}",
        error.message
    );
    assert_eq!(writes, 0, "a rejected preflight made writer calls");
    assert_eq!(
        tree_bytes(root),
        tree,
        "a rejected preflight touched the tree"
    );
    assert_eq!(
        std::fs::read(&lock(state).settings_path).unwrap_or_default(),
        settings,
        "a rejected preflight touched settings"
    );
    assert_eq!(generation(state), generation_before);
    assert_eq!(registrations(state), 0);
}

fn pf_json(path: &Path) -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn pf_group<'a>(prepared: &'a PreparedRename, owner: &Path) -> &'a PreparedGroup {
    prepared
        .groups
        .iter()
        .find(|group| group.owner_dir == owner)
        .unwrap_or_else(|| panic!("no group for {}", owner.display()))
}

fn pf_group_json(group: &PreparedGroup) -> serde_json::Value {
    serde_json::from_slice(&group.bytes).unwrap()
}

/// Re-binds the pending preview to what is on disk now, so a test can build a
/// state that is internally consistent but invalid in one specific way.
fn pf_rebind_to_disk(state: &BackendState, preview_id: &str) {
    let mut pending = lock(state).rename.take_preview(LIB, preview_id).unwrap();
    for target in &mut pending.targets {
        let bytes = std::fs::read(target.owner_dir.join(manifest::MANIFEST_NAME)).unwrap();
        let parsed = manifest::Manifest::parse(&bytes).unwrap();
        let key = Path::new(&target.relative_path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        target.revision = manifest::metadata_revision(
            parsed.items.get(key),
            key,
            &target.kind,
            &target.sidecar_owner,
            "valid",
        );
        pending
            .sources
            .insert(target.owner_dir.clone(), Some(bytes));
    }
    lock(state).rename.bind_preview(pending);
}

fn pf_tamper(state: &BackendState, preview_id: &str, change: impl FnOnce(&mut PendingPreview)) {
    let mut pending = lock(state).rename.take_preview(LIB, preview_id).unwrap();
    change(&mut pending);
    lock(state).rename.bind_preview(pending);
}

/// Root manifest with two matching files and a third that does not match, plus
/// a nested directory with its own manifest.
fn pf_grouped_library() -> (tempfile::TempDir, PathBuf, BackendState) {
    preview_library(|root| {
        touch(root, "a.stl");
        touch(root, "b.stl");
        touch(root, "c.stl");
        touch(root, "sub/d.stl");
        write_manifest(
            root,
            &[
                ("a.stl", 1, &["status:a"]),
                ("b.stl", 2, &["status:b", "keep:me"]),
                ("c.stl", 3, &["other:x"]),
            ],
        );
        write_manifest(&root.join("sub"), &[("d.stl", 4, &["status:d"])]);
    })
}

// Preview resolution: exact opaque ID for the library, nothing else accepted.

#[test]
fn tag_rename_preflight_resolves_only_the_exact_pending_preview() {
    let (_dir, root, state) = pf_grouped_library();
    let first = run_ready(&state, status_to_state("pf-id-1"));
    let second = run_ready(&state, status_to_state("pf-id-2"));
    pf_reject(&state, &root, &first.preview_id, "preview again");
    pf_reject(&state, &root, "not-a-preview-id", "preview again");
    let (unknown, writes) = pf_run_for(&state, "unknown-library", &second.preview_id);
    assert!(unknown.is_err());
    assert_eq!(writes, 0);
    let prepared = pf_ok(&state, &root, &second.preview_id);
    assert_eq!(prepared.preview_id, second.preview_id);
    assert_eq!(prepared.library_id, LIB);
    assert_eq!(prepared.mapping, second.mapping);
    assert_eq!(prepared.root, root);
}

fn pf_run_for(
    state: &BackendState,
    library_id: &str,
    preview_id: &str,
) -> (Result<PreparedRename, AppError>, usize) {
    let writes = std::cell::Cell::new(0usize);
    let result = preflight_tag_rename_apply(
        state,
        library_id,
        preview_id,
        &mut FsPreviewEnv,
        |_, _, _| {
            writes.set(writes.get() + 1);
            Ok(())
        },
    );
    (result, writes.get())
}

#[test]
fn tag_rename_preflight_consumes_the_preview_on_success_and_on_rejection() {
    let (_dir, root, state) = pf_grouped_library();
    let ok = run_ready(&state, status_to_state("pf-consume-1"));
    pf_ok(&state, &root, &ok.preview_id);
    pf_reject(
        &state,
        &root,
        &ok.preview_id,
        "No rename preview is pending",
    );

    let stale = run_ready(&state, status_to_state("pf-consume-2"));
    std::fs::write(root.join("sub").join(manifest::MANIFEST_NAME), b"{}").unwrap();
    pf_reject(&state, &root, &stale.preview_id, "bytes");
    pf_reject(
        &state,
        &root,
        &stale.preview_id,
        "No rename preview is pending",
    );
}

#[test]
fn tag_rename_preflight_rejects_a_preview_made_before_a_later_library_mutation() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-generation"));
    lock(&state).rename.note_mutation();
    let before = tree_bytes(&root);
    let (result, writes) = pf_run(&state, &preview.preview_id, &mut FsPreviewEnv);
    assert!(result.is_err());
    assert_eq!(writes, 0);
    assert_eq!(tree_bytes(&root), before);
}

// Grouping: two targets in one sidecar become one document, one write each.

#[test]
fn tag_rename_preflight_groups_targets_sharing_a_sidecar_into_one_document() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-group"));
    assert_eq!(preview.targets.len(), 3);
    let on_disk_root = std::fs::read(root.join(manifest::MANIFEST_NAME)).unwrap();
    let on_disk_sub = std::fs::read(root.join("sub").join(manifest::MANIFEST_NAME)).unwrap();
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert!(!prepared.settings_only);
    assert_eq!(prepared.groups.len(), 2, "two owners, two documents");
    let owners: std::collections::BTreeSet<_> = prepared
        .groups
        .iter()
        .map(|group| group.owner_dir.clone())
        .collect();
    assert_eq!(owners.len(), 2, "an owner never appears twice");

    let root_group = pf_group(&prepared, &root);
    assert_eq!(root_group.sidecar_path, root.join(manifest::MANIFEST_NAME));
    assert_eq!(root_group.sidecar_owner, ".");
    assert_eq!(
        root_group.original.as_deref(),
        Some(on_disk_root.as_slice())
    );
    let rows: Vec<_> = root_group
        .rows
        .iter()
        .map(|row| row.target.relative_path.as_str())
        .collect();
    assert_eq!(rows, ["a.stl", "b.stl"]);
    let root_json = pf_group_json(root_group);
    assert_eq!(
        root_json["items"]["a.stl"]["tags"],
        serde_json::json!(["state:a"])
    );
    assert_eq!(
        root_json["items"]["b.stl"]["tags"],
        serde_json::json!(["keep:me", "state:b"])
    );
    assert_eq!(
        root_json["items"]["c.stl"]["tags"],
        serde_json::json!(["other:x"]),
        "a non-matching sibling is untouched"
    );

    let sub_group = pf_group(&prepared, &root.join("sub"));
    assert_eq!(sub_group.sidecar_owner, "sub");
    assert_eq!(sub_group.original.as_deref(), Some(on_disk_sub.as_slice()));
    assert_eq!(sub_group.rows.len(), 1);
    assert_eq!(
        pf_group_json(sub_group)["items"]["d.stl"]["tags"],
        serde_json::json!(["state:d"])
    );
    let total_rows: usize = prepared.groups.iter().map(|group| group.rows.len()).sum();
    assert_eq!(total_rows, preview.targets.len());
}

#[test]
fn tag_rename_preflight_serializes_every_group_before_returning() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-serialized"));
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    for group in &prepared.groups {
        let parsed = manifest::Manifest::parse(&group.bytes)
            .expect("each prepared document is a valid version-1 manifest");
        assert_ne!(
            Some(group.bytes.as_slice()),
            group.original.as_deref(),
            "a changed group differs from its source"
        );
        for row in &group.rows {
            let key = Path::new(&row.target.relative_path)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap();
            assert_eq!(
                parsed.items[key].tags,
                manifest::normalize_tags(row.asset.tags.clone())
            );
        }
    }
}

// Preservation: UUIDs, notes, unknown fields, stale entries, skipped rows.

#[test]
fn tag_rename_preflight_preserves_ids_notes_unknown_fields_stale_and_untouched_entries() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "a.stl");
        touch(root, "b.stl");
        let body = serde_json::json!({
            "schemaVersion": 1,
            "updatedAt": "2026-10-05T00:00:00Z",
            "vendorTopLevel": {"keep": [1, 2, {"x": null}], "f": 1.5},
            "items": {
                ".": {"id": uid(1), "tags": ["Status:Root", "keep:me"], "notes": "root notes", "color": "red"},
                "a.stl": {"id": uid(2), "tags": ["status:a", "state:a", "Zeta:Keep"], "notes": "", "futureField": {"n": 1.5}},
                "b.stl": {"id": uid(3), "tags": ["Other:KeepCase"], "notes": "untouched"},
                "gone.stl": {"id": uid(4), "tags": ["status:old"], "stale": true}
            }
        });
        std::fs::write(
            root.join(manifest::MANIFEST_NAME),
            serde_json::to_vec_pretty(&body).unwrap(),
        )
        .unwrap();
    });
    let before = pf_json(&root.join(manifest::MANIFEST_NAME));
    let preview = run_ready(&state, status_to_state("pf-preserve"));
    assert_eq!(
        preview.skipped.len(),
        1,
        "the stale entry is a known skipped match"
    );
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    let group = pf_group(&prepared, &root);
    let after = pf_group_json(group);

    assert_eq!(after["schemaVersion"], before["schemaVersion"]);
    assert_eq!(after["vendorTopLevel"], before["vendorTopLevel"]);
    assert_eq!(
        after["items"]
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        before["items"]
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        "no entry is added or dropped"
    );
    assert_eq!(
        after["items"]["b.stl"], before["items"]["b.stl"],
        "untouched entry keeps its spelling"
    );
    assert_eq!(
        after["items"]["gone.stl"], before["items"]["gone.stl"],
        "the skipped stale entry is untouched"
    );

    let root_entry = &after["items"]["."];
    assert_eq!(root_entry["id"], before["items"]["."]["id"]);
    assert_eq!(root_entry["notes"], "root notes");
    assert_eq!(root_entry["color"], "red");
    assert_eq!(
        root_entry["tags"],
        serde_json::json!(["keep:me", "state:root"])
    );

    let a_entry = &after["items"]["a.stl"];
    assert_eq!(a_entry["id"], before["items"]["a.stl"]["id"]);
    assert_eq!(
        a_entry["notes"], "",
        "an empty notes string is kept, not dropped"
    );
    assert_eq!(
        a_entry["futureField"],
        before["items"]["a.stl"]["futureField"]
    );
    assert_eq!(
        a_entry["tags"],
        serde_json::json!(["state:a", "zeta:keep"]),
        "the merge collapses into one destination tag and targeted entries are normalized"
    );
    let rows: Vec<_> = group
        .rows
        .iter()
        .map(|row| {
            (
                row.target.relative_path.clone(),
                row.target.duplicates_collapsed,
            )
        })
        .collect();
    assert_eq!(rows, [(".".to_string(), 0), ("a.stl".to_string(), 1)]);
    let parsed = manifest::Manifest::parse(&group.bytes).unwrap();
    assert!(
        chrono::DateTime::parse_from_rfc3339(&parsed.updated_at).is_ok(),
        "updatedAt stays a valid timestamp"
    );
}

#[test]
fn tag_rename_preflight_carries_skipped_and_uninspectable_rows_without_change() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "a.stl");
        touch(root, "dup.stl");
        mkdir(root, "Bad");
        write_manifest(
            root,
            &[
                ("a.stl", 1, &["status:a"]),
                ("dup.stl", 5, &["status:z"]),
                ("gone.stl", 6, &["status:old"]),
                ("dup2.stl", 5, &["status:y"]),
            ],
        );
        std::fs::write(
            root.join("Bad").join(manifest::MANIFEST_NAME),
            b"{ not json",
        )
        .unwrap();
    });
    let preview = run_ready(&state, status_to_state("pf-skips"));
    assert!(!preview.skipped.is_empty());
    assert!(!preview.uninspectable.is_empty());
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert_eq!(
        prepared.skipped, preview.skipped,
        "CON-1 skip reasons are preserved"
    );
    assert_eq!(prepared.uninspectable, preview.uninspectable);
    assert!(prepared
        .skipped
        .iter()
        .any(|skip| skip.reason == SkipReason::Missing));
    assert!(prepared
        .skipped
        .iter()
        .any(|skip| skip.reason == SkipReason::Blocked));
    let skipped_paths: Vec<_> = prepared
        .skipped
        .iter()
        .map(|skip| skip.relative_path.as_str())
        .collect();
    for group in &prepared.groups {
        for row in &group.rows {
            assert!(
                !skipped_paths.contains(&row.target.relative_path.as_str()),
                "a skipped row is never prepared"
            );
        }
    }
    let after = pf_group_json(pf_group(&prepared, &root));
    assert_eq!(
        after["items"]["gone.stl"]["tags"],
        serde_json::json!(["status:old"])
    );
    assert_eq!(
        after["items"]["dup.stl"]["tags"],
        serde_json::json!(["status:z"])
    );
}

#[test]
fn tag_rename_preflight_keeps_per_row_duplicate_collapse_counts_from_the_preview() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "m.stl");
        touch(root, "n.stl");
        write_manifest(
            root,
            &[("m.stl", 1, &["a", "b"]), ("n.stl", 2, &["a", "c"])],
        );
    });
    let preview = run_ready(&state, exact_ab("pf-collapse-2"));
    assert!(preview.destination_exists);
    assert_eq!(preview.duplicates_collapsed, 1);
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    let collapsed: Vec<_> = prepared.groups[0]
        .rows
        .iter()
        .map(|row| {
            (
                row.target.relative_path.clone(),
                row.target.duplicates_collapsed,
            )
        })
        .collect();
    assert_eq!(
        collapsed,
        [("m.stl".to_string(), 1), ("n.stl".to_string(), 0)]
    );
    let json = pf_group_json(&prepared.groups[0]);
    assert_eq!(json["items"]["m.stl"]["tags"], serde_json::json!(["b"]));
    assert_eq!(
        json["items"]["n.stl"]["tags"],
        serde_json::json!(["b", "c"])
    );
}

#[test]
fn tag_rename_preflight_prepared_rows_match_what_a_tag_edit_would_accept_after_the_write() {
    let (_dir, root, state) = counting_library();
    let preview = run_ready(&state, status_to_state("pf-parity"));
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert_eq!(prepared.groups.len(), 3);
    // Disposable library: apply the prepared bytes directly, as T9 will, and
    // confirm the ordinary tag-edit path accepts each committed revision.
    for group in &prepared.groups {
        std::fs::write(&group.sidecar_path, &group.bytes).unwrap();
    }
    let inner = lock(&state);
    for group in &prepared.groups {
        for row in &group.rows {
            let prepared_target = prepare_tag_target(
                &inner,
                LIB,
                &root,
                &row.target.asset_id,
                &row.asset.metadata_revision,
            )
            .unwrap_or_else(|error| panic!("{} rejected: {error:?}", row.target.asset_id));
            assert_eq!(prepared_target.asset, row.asset, "{}", row.target.asset_id);
            assert_eq!(prepared_target.owner_dir, group.owner_dir);
            assert_ne!(
                row.asset.metadata_revision, row.target.revision,
                "committed rows get a new revision"
            );
            assert!(row.asset.tags.iter().any(|tag| tag.starts_with("state:")));
        }
    }
}

#[test]
fn tag_rename_preflight_resolves_root_self_folder_self_and_legacy_owners() {
    let (_dir, root, state) = counting_library();
    let preview = run_ready(&state, status_to_state("pf-owners"));
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    let root_group = pf_group(&prepared, &root);
    let root_rows: Vec<_> = root_group
        .rows
        .iter()
        .map(|row| row.target.relative_path.as_str())
        .collect();
    assert_eq!(
        root_rows,
        [".", "Legacy", "r.stl"],
        "root self, legacy folder and file"
    );
    let root_keys: Vec<_> = root_group.rows.iter().map(|row| row.key.as_str()).collect();
    assert_eq!(
        root_keys,
        [".", "Legacy", "r.stl"],
        "keys are the entries edited in the root sidecar: self, legacy folder, file"
    );
    let root_json = pf_group_json(root_group);
    assert_eq!(
        root_json["items"]["."]["tags"],
        serde_json::json!(["state:a"])
    );
    assert_eq!(
        root_json["items"]["Legacy"]["tags"],
        serde_json::json!(["state:c"])
    );
    assert_eq!(
        root_json["items"]["r.stl"]["tags"],
        serde_json::json!(["state:b"])
    );

    let self_group = pf_group(&prepared, &root.join("Self"));
    assert_eq!(self_group.rows.len(), 1);
    assert_eq!(self_group.rows[0].target.relative_path, "Self");
    assert_eq!(
        self_group.rows[0].key, ".",
        "a folder self entry is keyed `.`"
    );
    assert_eq!(
        pf_group_json(self_group)["items"]["."]["tags"],
        serde_json::json!(["state:d"]),
        "a folder self entry lives in the folder's own sidecar"
    );
    assert!(
        !root.join("Legacy").join(manifest::MANIFEST_NAME).exists(),
        "a legacy parent entry never creates a child sidecar"
    );
    let nested = pf_group(&prepared, &root.join("G/h"));
    assert_eq!(nested.rows.len(), 2);
    assert_eq!(
        pf_group_json(nested)["items"]["j.stl"]["tags"],
        serde_json::json!(["other:x", "state:f"])
    );
}

// Drift rejections: nothing is written and nothing on disk changes.

#[test]
fn tag_rename_preflight_rejects_a_stale_target_revision() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-revision"));
    write_manifest(
        &root,
        &[
            ("a.stl", 1, &["status:a", "added:later"]),
            ("b.stl", 2, &["status:b", "keep:me"]),
            ("c.stl", 3, &["other:x"]),
        ],
    );
    pf_reject(&state, &root, &preview.preview_id, "revision");
}

#[test]
fn tag_rename_preflight_rejects_changed_sidecar_source_bytes_even_when_revisions_match() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-bytes"));
    let path = root.join("sub").join(manifest::MANIFEST_NAME);
    let mut bytes = std::fs::read(&path).unwrap();
    bytes.push(b'\n');
    std::fs::write(&path, bytes).unwrap();
    pf_reject(&state, &root, &preview.preview_id, "source bytes");
}

#[test]
fn tag_rename_preflight_rejects_a_changed_unrelated_entry_in_a_bound_sidecar() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-bytes-sibling"));
    write_manifest(
        &root,
        &[
            ("a.stl", 1, &["status:a"]),
            ("b.stl", 2, &["status:b", "keep:me"]),
            ("c.stl", 3, &["other:changed"]),
        ],
    );
    pf_reject(&state, &root, &preview.preview_id, "source bytes");
}

#[test]
fn tag_rename_preflight_rejects_an_owner_sidecar_that_became_unreadable_or_vanished() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-unreadable"));
    std::fs::write(root.join("sub").join(manifest::MANIFEST_NAME), b"{ broken").unwrap();
    pf_reject(&state, &root, &preview.preview_id, "source bytes");

    let (_dir2, root2, state2) = pf_grouped_library();
    let preview2 = run_ready(&state2, status_to_state("pf-vanished"));
    std::fs::remove_file(root2.join("sub").join(manifest::MANIFEST_NAME)).unwrap();
    pf_reject(&state2, &root2, &preview2.preview_id, "source bytes");
}

#[test]
fn tag_rename_preflight_rejects_a_target_whose_asset_disappeared() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-asset-gone"));
    std::fs::remove_file(root.join("b.stl")).unwrap();
    pf_reject(&state, &root, &preview.preview_id, "no longer available");
}

#[test]
fn tag_rename_preflight_rejects_a_target_set_that_no_longer_matches_the_scan_snapshot() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-targets-1"));
    lock(&state)
        .scan_snapshots
        .get_mut(LIB)
        .unwrap()
        .editable_ids
        .remove("path:a.stl");
    pf_reject(&state, &root, &preview.preview_id, "targets");

    let preview = run_ready(&state, status_to_state("pf-targets-2"));
    lock(&state).scan_snapshots.remove(LIB);
    pf_reject(&state, &root, &preview.preview_id, "targets");

    let preview = run_ready(&state, status_to_state("pf-targets-3"));
    lock(&state)
        .scan_snapshots
        .get_mut(LIB)
        .unwrap()
        .assets
        .remove("path:a.stl");
    pf_reject(&state, &root, &preview.preview_id, "targets");
}

#[test]
fn tag_rename_preflight_rejects_a_sidecar_that_is_not_bound_by_the_preview() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-unbound"));
    pf_tamper(&state, &preview.preview_id, |pending| {
        pending.sources.remove(&root.join("sub"));
    });
    pf_reject(&state, &root, &preview.preview_id, "source bytes");
}

// Root and mapping.

#[test]
fn tag_rename_preflight_rejects_a_changed_approved_root() {
    let (dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-root"));
    let other = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("other-root");
    std::fs::create_dir(&other).unwrap();
    lock(&state)
        .libraries
        .iter_mut()
        .find(|library| library.id == LIB)
        .unwrap()
        .root_path = other.to_str().unwrap().into();
    pf_reject(&state, &root, &preview.preview_id, "root");
}

#[test]
fn tag_rename_preflight_rejects_a_vanished_approved_root() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-root-gone"));
    let parent = root.parent().unwrap().to_path_buf();
    let moved = parent.join("moved-away");
    std::fs::rename(&root, &moved).unwrap();
    let (result, writes) = pf_run(&state, &preview.preview_id, &mut FsPreviewEnv);
    assert!(result.is_err());
    assert_eq!(writes, 0);
    assert!(moved.join("a.stl").exists());
    assert!(!root.exists(), "the preflight must not recreate the root");
}

#[test]
fn tag_rename_preflight_rejects_a_preview_mapping_that_is_not_native_normalized() {
    for tamper in [
        (|m: &mut RenameMapping| m.source = "STATUS".into()) as fn(&mut RenameMapping),
        |m| m.destination = " state ".into(),
        |m| m.destination = m.source.clone(),
        |m| m.destination = "a:b".into(),
        |m| m.source = String::new(),
    ] {
        let (_dir, root, state) = pf_grouped_library();
        let preview = run_ready(&state, status_to_state("pf-mapping"));
        pf_tamper(&state, &preview.preview_id, |pending| {
            tamper(&mut pending.mapping)
        });
        pf_reject(&state, &root, &preview.preview_id, "mapping");
    }
}

// Duplicate UUID guard across the grouped targets.

#[test]
fn tag_rename_preflight_rejects_a_uuid_shared_across_grouped_sidecars() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-dup-groups"));
    // Same identity now appears in two different owning sidecars.
    write_manifest(&root.join("sub"), &[("d.stl", 1, &["status:d"])]);
    pf_rebind_to_disk(&state, &preview.preview_id);
    pf_reject(
        &state,
        &root,
        &preview.preview_id,
        "Duplicate metadata UUID",
    );
}

#[test]
fn tag_rename_preflight_rejects_a_uuid_shared_inside_one_sidecar() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-dup-one"));
    write_manifest(
        &root,
        &[
            ("a.stl", 1, &["status:a"]),
            ("b.stl", 2, &["status:b", "keep:me"]),
            ("c.stl", 1, &["other:x"]),
        ],
    );
    pf_rebind_to_disk(&state, &preview.preview_id);
    pf_reject(
        &state,
        &root,
        &preview.preview_id,
        "Duplicate metadata UUID",
    );
}

#[test]
fn tag_rename_preflight_accepts_distinct_uuids_after_the_same_rebinding() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-dup-control"));
    write_manifest(&root.join("sub"), &[("d.stl", 9, &["status:d"])]);
    pf_rebind_to_disk(&state, &preview.preview_id);
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert_eq!(prepared.groups.len(), 2);
}

// Ownership conflicts block the whole preflight.

#[test]
fn tag_rename_preflight_blocks_when_a_self_folder_gains_a_parent_entry() {
    let (_dir, root, state) = preview_library(|root| {
        mkdir(root, "Sf");
        write_manifest(&root.join("Sf"), &[(".", 1, &["status:x"])]);
    });
    let preview = run_ready(&state, status_to_state("pf-owner-1"));
    assert_eq!(target_paths(&preview), ["Sf"]);
    write_manifest(&root, &[("Sf", 2, &["status:x"])]);
    pf_reject(&state, &root, &preview.preview_id, "ownership");
}

#[test]
fn tag_rename_preflight_blocks_when_a_legacy_folder_gains_a_self_entry() {
    let (_dir, root, state) = preview_library(|root| {
        mkdir(root, "Lg");
        write_manifest(root, &[("Lg", 1, &["status:x"])]);
    });
    let preview = run_ready(&state, status_to_state("pf-owner-2"));
    assert_eq!(target_paths(&preview), ["Lg"]);
    write_manifest(&root.join("Lg"), &[(".", 2, &["status:x"])]);
    pf_reject(&state, &root, &preview.preview_id, "ownership");
}

#[test]
fn tag_rename_preflight_blocks_when_an_ownership_conflict_blocks_one_of_several_targets() {
    let (_dir, root, state) = preview_library(|root| {
        touch(root, "ok.stl");
        mkdir(root, "Sf");
        write_manifest(root, &[("ok.stl", 3, &["status:a"])]);
        write_manifest(&root.join("Sf"), &[(".", 1, &["status:x"])]);
    });
    let preview = run_ready(&state, status_to_state("pf-owner-3"));
    assert_eq!(preview.targets.len(), 2);
    write_manifest(
        &root,
        &[("ok.stl", 3, &["status:a"]), ("Sf", 2, &["status:x"])],
    );
    pf_reject(&state, &root, &preview.preview_id, "ownership");
}

// Zero eligible targets: refused unless a verified in-memory retry proof exists.

fn pf_search_fixture() -> (tempfile::TempDir, PathBuf, BackendState, String) {
    let (dir, root, state, ours, _theirs) = searches_library();
    (dir, root, state, ours)
}

/// A library whose only matching rows were renamed already, so a repeat preview
/// has no targets; `skipped_row` adds a missing-file match that stays skipped.
fn pf_retry_fixture(
    skipped_row: bool,
) -> (tempfile::TempDir, PathBuf, BackendState, String, String) {
    let (dir, root, state, ours) = pf_search_fixture();
    if skipped_row {
        write_manifest(
            &root,
            &[("a.stl", 1, &["state:a"]), ("gone.stl", 2, &["status:old"])],
        );
    } else {
        write_manifest(&root, &[("a.stl", 1, &["state:a"])]);
    }
    let scan = scan_tree(&root, LIB, "pf-retry-setup", |_| {}).unwrap();
    let revision = find_asset(&scan, "a.stl").metadata_revision;
    (dir, root, state, ours, revision)
}

fn pf_store_proof(
    state: &BackendState,
    root: &Path,
    ours: &str,
    revision: &str,
    change: impl FnOnce(&mut RetryProof),
) {
    let mut proof = RetryProof {
        library_id: LIB.into(),
        root: root.to_path_buf(),
        mapping: state_mapping(),
        committed: vec![CommittedRow {
            asset_id: "path:a.stl".into(),
            revision: revision.into(),
        }],
        replacements: vec![replacement_for(ours)],
    };
    change(&mut proof);
    lock(state).rename.store_retry_proof(proof);
}

fn pf_retry_preview(state: &BackendState, ours: &str, scan_id: &str) -> RenamePreview {
    run_ready(
        state,
        with_replacements(scan_id, vec![replacement_for(ours)]),
    )
}

#[test]
fn tag_rename_preflight_refuses_zero_targets_without_a_retry_proof() {
    let (_dir, root, state, ours, _rev) = pf_retry_fixture(false);
    let preview = pf_retry_preview(&state, &ours, "pf-zero-1");
    assert!(preview.targets.is_empty());
    assert!(!preview.settings_retry);
    pf_reject(
        &state,
        &root,
        &preview.preview_id,
        "No editable rename targets",
    );
}

#[test]
fn tag_rename_preflight_refuses_all_skipped_matches_without_a_retry_proof() {
    let (_dir, root, state, ours, _rev) = pf_retry_fixture(true);
    let preview = pf_retry_preview(&state, &ours, "pf-zero-2");
    assert!(preview.targets.is_empty());
    assert_eq!(preview.skipped.len(), 1, "the only match is a skipped row");
    pf_reject(
        &state,
        &root,
        &preview.preview_id,
        "No editable rename targets",
    );
}

#[test]
fn tag_rename_preflight_accepts_zero_targets_with_a_verified_retry_proof() {
    let (_dir, root, state, ours, revision) = pf_retry_fixture(false);
    pf_store_proof(&state, &root, &ours, &revision, |_| {});
    let preview = pf_retry_preview(&state, &ours, "pf-zero-3");
    assert!(preview.targets.is_empty());
    assert!(preview.settings_retry);
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert!(prepared.settings_only);
    assert!(
        prepared.groups.is_empty(),
        "no sidecar is prepared for a settings retry"
    );
    assert_eq!(prepared.replacements, vec![replacement_for(&ours)]);
    assert_eq!(prepared.mapping, state_mapping());
    assert!(
        lock(&state).rename.retry_proof(LIB).is_some(),
        "preflight never consumes the proof; the apply stage does"
    );
}

#[test]
fn tag_rename_preflight_accepts_a_verified_retry_proof_when_other_matches_stay_skipped() {
    let (_dir, root, state, ours, revision) = pf_retry_fixture(true);
    pf_store_proof(&state, &root, &ours, &revision, |_| {});
    let preview = pf_retry_preview(&state, &ours, "pf-zero-4");
    assert_eq!(preview.skipped.len(), 1);
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert!(prepared.settings_only);
    assert_eq!(prepared.skipped, preview.skipped);
}

#[test]
fn tag_rename_preflight_rejects_unverified_retry_proofs_for_zero_targets() {
    let cases: [fn(&mut RetryProof); 6] = [
        |proof| proof.mapping = normalize_mapping(RenameMode::Prefix, "other", "thing").unwrap(),
        |proof| proof.root = PathBuf::from("/somewhere/else"),
        |proof| proof.replacements.clear(),
        |proof| proof.committed[0].revision = "sha256:stale".into(),
        |proof| proof.committed[0].asset_id = "path:never-committed.stl".into(),
        |proof| proof.committed.clear(),
    ];
    for change in cases {
        let (_dir, root, state, ours, revision) = pf_retry_fixture(false);
        let preview = pf_retry_preview(&state, &ours, "pf-zero-bad");
        assert!(preview.targets.is_empty());
        // Force the preview to claim a retry so only the proof checks decide.
        pf_store_proof(&state, &root, &ours, &revision, change);
        pf_tamper(&state, &preview.preview_id, |pending| {
            pending.settings_retry = true
        });
        pf_reject(
            &state,
            &root,
            &preview.preview_id,
            "No editable rename targets",
        );
    }
}

#[test]
fn tag_rename_preflight_requires_the_preview_itself_to_be_a_settings_retry() {
    let (_dir, root, state, ours, revision) = pf_retry_fixture(false);
    let preview = pf_retry_preview(&state, &ours, "pf-zero-5");
    // The proof appears only after this preview was made: not a retry preview.
    pf_store_proof(&state, &root, &ours, &revision, |_| {});
    pf_reject(
        &state,
        &root,
        &preview.preview_id,
        "No editable rename targets",
    );
}

#[test]
fn tag_rename_preflight_never_lets_a_proof_retarget_when_a_preview_has_no_replacements() {
    let (_dir, root, state, ours, revision) = pf_retry_fixture(false);
    pf_store_proof(&state, &root, &ours, &revision, |proof| {
        proof.replacements.clear()
    });
    let preview = run_ready(&state, status_to_state("pf-zero-6"));
    assert!(preview.settings_retry);
    assert!(preview.targets.is_empty());
    pf_reject(
        &state,
        &root,
        &preview.preview_id,
        "No editable rename targets",
    );
}

// Saved-search expected-filter recheck (CON2-7 / MP2-10) through the shared validator.

#[test]
fn tag_rename_preflight_rejects_changed_expected_filters_with_zero_writes() {
    let (_dir, root, state, ours, _theirs) = searches_library();
    let preview = run_ready(
        &state,
        with_replacements("pf-filter-1", vec![replacement_for(&ours)]),
    );
    assert_eq!(preview.saved_search_update_count, 1);
    lock(&state)
        .saved_searches
        .iter_mut()
        .find(|search| search.id == ours)
        .unwrap()
        .filters
        .query = "something:else".into();
    pf_reject(&state, &root, &preview.preview_id, "saved search changed");
}

#[test]
fn tag_rename_preflight_rejects_removed_or_moved_saved_searches() {
    let (_dir, root, state, ours, _theirs) = searches_library();
    let preview = run_ready(
        &state,
        with_replacements("pf-filter-2", vec![replacement_for(&ours)]),
    );
    lock(&state)
        .saved_searches
        .retain(|search| search.id != ours);
    pf_reject(&state, &root, &preview.preview_id, "Unknown saved search");

    let (_dir, root, state, ours, _theirs) = searches_library();
    let preview = run_ready(
        &state,
        with_replacements("pf-filter-3", vec![replacement_for(&ours)]),
    );
    lock(&state)
        .saved_searches
        .iter_mut()
        .find(|search| search.id == ours)
        .unwrap()
        .library_id = "other".into();
    pf_reject(&state, &root, &preview.preview_id, "another library");
}

#[test]
fn tag_rename_preflight_rejects_filters_changed_in_any_field_not_only_the_query() {
    let (_dir, root, state, ours, _theirs) = searches_library();
    let preview = run_ready(
        &state,
        with_replacements("pf-filter-4", vec![replacement_for(&ours)]),
    );
    lock(&state)
        .saved_searches
        .iter_mut()
        .find(|search| search.id == ours)
        .unwrap()
        .filters
        .match_mode = MatchMode::Any;
    pf_reject(&state, &root, &preview.preview_id, "saved search changed");
}

#[test]
fn tag_rename_preflight_accepts_unchanged_bound_replacements_and_carries_them() {
    let (_dir, root, state, ours, _theirs) = searches_library();
    let replacements = vec![replacement_for(&ours)];
    let preview = run_ready(
        &state,
        with_replacements("pf-filter-5", replacements.clone()),
    );
    let settings = std::fs::read(&lock(&state).settings_path).unwrap();
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert_eq!(
        prepared.replacements, replacements,
        "the bound set is carried unchanged"
    );
    assert_eq!(
        std::fs::read(&lock(&state).settings_path).unwrap(),
        settings,
        "preflight persists nothing"
    );
}

// CON-2: at most one read per owning sidecar.

#[test]
fn tag_rename_preflight_reads_each_owning_sidecar_at_most_once() {
    let (_dir, root, state) = counting_library();
    let preview = run_ready(&state, status_to_state("pf-reads-1"));
    let mut env = CountingEnv { reads: vec![] };
    let (result, writes) = pf_run(&state, &preview.preview_id, &mut env);
    let prepared = result.unwrap();
    assert_eq!(writes, 0);
    let distinct: std::collections::BTreeSet<_> = env.reads.iter().cloned().collect();
    assert_eq!(env.reads.len(), distinct.len(), "no sidecar is read twice");
    assert_eq!(
        distinct,
        prepared
            .groups
            .iter()
            .map(|group| group.owner_dir.clone())
            .collect(),
        "reads are exactly the owning sidecars"
    );
    assert_eq!(prepared.groups.len(), 3);
    drop(root);
}

#[test]
fn tag_rename_preflight_legacy_folder_ownership_needs_no_extra_read() {
    let (_dir, root, state) = preview_library(|root| {
        mkdir(root, "Legacy");
        touch(root, "f.stl");
        write_manifest(
            root,
            &[("Legacy", 1, &["status:a"]), ("f.stl", 2, &["status:b"])],
        );
    });
    let preview = run_ready(&state, status_to_state("pf-reads-2"));
    let mut env = CountingEnv { reads: vec![] };
    let (result, writes) = pf_run(&state, &preview.preview_id, &mut env);
    result.unwrap();
    assert_eq!(writes, 0);
    assert_eq!(
        env.reads.as_slice(),
        std::slice::from_ref(&root),
        "one owner, one read"
    );
}

#[test]
fn tag_rename_preflight_read_failure_is_rejected_not_retried() {
    struct FailingEnv;
    impl PreviewEnv for FailingEnv {
        fn sidecar_exists(&mut self, dir: &Path) -> bool {
            FsPreviewEnv.sidecar_exists(dir)
        }
        fn read_sidecar(&mut self, _dir: &Path) -> manifest::ReadManifest {
            manifest::ReadManifest::Blocked {
                bytes: None,
                error: "injected read failure".into(),
            }
        }
    }
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-read-fail"));
    let before = tree_bytes(&root);
    let (result, writes) = pf_run(&state, &preview.preview_id, &mut FailingEnv);
    assert!(result.is_err());
    assert_eq!(writes, 0);
    assert_eq!(tree_bytes(&root), before);
}

// The preflight neither registers scans nor advances the mutation generation.

#[test]
fn tag_rename_preflight_adds_no_registration_and_keeps_the_generation() {
    let (_dir, root, state) = pf_grouped_library();
    let preview = run_ready(&state, status_to_state("pf-quiet"));
    let before = generation(&state);
    let prepared = pf_ok(&state, &root, &preview.preview_id);
    assert!(!prepared.groups.is_empty());
    assert_eq!(generation(&state), before);
    assert_eq!(registrations(&state), 0);
    assert!(
        !lock(&state).rename.has_pending_preview(LIB),
        "the preview is consumed"
    );
}

// ---------------------------------------------------------------------------
// T9: sequential commit, exact partitions and snapshot revisions.
//
// The commit stage takes the T8 `PreparedRename` while the backend mutex stays
// held, writes each owning sidecar once through an injected writer and stops at
// the first failure. These tests inject failures at the first, a middle and the
// last group, and check write counts, exhaustive partitions, on-disk bytes and
// cached snapshot revisions. They persist no settings (that is T11's stage).
// ---------------------------------------------------------------------------

/// Four owning sidecars in write order, six targets, one skipped stale match:
/// `.` (a, x), `d1` (b), `d2` (c, c2), `d3` (e).
const CM_GROUPS: [(&str, &[&str]); 4] = [
    (".", &["a.stl", "x.stl"]),
    ("d1", &["d1/b.stl"]),
    ("d2", &["d2/c.stl", "d2/c2.stl"]),
    ("d3", &["d3/e.stl"]),
];

fn cm_library() -> (tempfile::TempDir, PathBuf, BackendState) {
    preview_library(|root| {
        for path in [
            "a.stl",
            "x.stl",
            "n.stl",
            "d1/b.stl",
            "d2/c.stl",
            "d2/c2.stl",
            "d3/e.stl",
        ] {
            touch(root, path);
        }
        write_manifest(
            root,
            &[
                ("a.stl", 1, &["status:a"]),
                ("x.stl", 2, &["status:x", "keep:me"]),
                ("n.stl", 3, &["other:n"]),
                ("gone.stl", 4, &["status:old"]),
            ],
        );
        write_manifest(&root.join("d1"), &[("b.stl", 5, &["status:b"])]);
        write_manifest(
            &root.join("d2"),
            &[
                ("c.stl", 6, &["status:c", "state:c"]),
                ("c2.stl", 7, &["status:c2"]),
            ],
        );
        write_manifest(&root.join("d3"), &[("e.stl", 8, &["status:e"])]);
    })
}

fn cm_owner_dir(root: &Path, owner: &str) -> PathBuf {
    if owner == "." {
        root.to_path_buf()
    } else {
        root.join(owner)
    }
}

fn cm_sidecar(root: &Path, owner: &str) -> PathBuf {
    cm_owner_dir(root, owner).join(manifest::MANIFEST_NAME)
}

fn cm_ids(owner_rows: &[&str]) -> Vec<String> {
    owner_rows
        .iter()
        .map(|path| format!("path:{path}"))
        .collect()
}

/// Cached snapshot revisions by asset ID.
fn cm_cached(state: &BackendState) -> BTreeMap<String, String> {
    lock(state).scan_snapshots[LIB]
        .assets
        .iter()
        .map(|(id, asset)| (id.clone(), asset.metadata_revision.clone()))
        .collect()
}

fn cm_cached_asset(state: &BackendState, asset_id: &str) -> Asset {
    lock(state).scan_snapshots[LIB].assets[asset_id].clone()
}

/// One writer call as the injected writer saw it.
#[derive(Clone, Debug)]
struct CmCall {
    path: PathBuf,
    expected: Option<Vec<u8>>,
    bytes: Vec<u8>,
}

/// Prepares and commits under one held guard, as the apply command will.
fn cm_apply(
    state: &BackendState,
    preview_id: &str,
    writer: impl FnMut(&Path, Option<&[u8]>, &[u8]) -> Result<(), String>,
) -> Result<SidecarCommit, AppError> {
    let mut inner = lock(state);
    let prepared = prepare_tag_rename(&mut inner, LIB, preview_id, &mut FsPreviewEnv)?;
    Ok(commit_prepared_rename(&mut inner, prepared, writer))
}

/// Commits with the real atomic writer, failing the `fail_at`th call (0-based)
/// before it writes anything. Returns the commit and every writer call.
fn cm_commit_failing_at(
    state: &BackendState,
    preview_id: &str,
    fail_at: Option<usize>,
) -> (SidecarCommit, Vec<CmCall>) {
    let calls = std::cell::RefCell::new(Vec::<CmCall>::new());
    let commit = cm_apply(state, preview_id, |path, expected, bytes| {
        let index = calls.borrow().len();
        calls.borrow_mut().push(CmCall {
            path: path.to_path_buf(),
            expected: expected.map(<[u8]>::to_vec),
            bytes: bytes.to_vec(),
        });
        if fail_at == Some(index) {
            return Err("disk full".into());
        }
        manifest::write_atomic(path, expected, bytes)
    })
    .expect("the preview is valid, so preparation succeeds");
    (commit, calls.into_inner())
}

fn cm_summary_ids(rows: &[RenameTargetSummary]) -> Vec<String> {
    rows.iter().map(|row| row.asset_id.clone()).collect()
}

fn cm_flat(groups: &[(&str, &[&str])]) -> Vec<String> {
    groups.iter().flat_map(|(_, rows)| cm_ids(rows)).collect()
}

/// Every preview target appears in exactly one of committed/failed/unattempted;
/// nothing else does; skipped and uninspectable rows stay outside.
fn cm_assert_exhaustive(preview: &RenamePreview, commit: &SidecarCommit) {
    let mut seen: Vec<String> = commit
        .committed
        .iter()
        .map(|asset| asset.id.clone())
        .collect();
    seen.extend(cm_summary_ids(&commit.failed));
    seen.extend(cm_summary_ids(&commit.unattempted));
    let unique: std::collections::BTreeSet<_> = seen.iter().cloned().collect();
    assert_eq!(
        unique.len(),
        seen.len(),
        "a row sits in two partitions: {seen:?}"
    );
    let targets: std::collections::BTreeSet<_> = preview
        .targets
        .iter()
        .map(|target| target.asset_id.clone())
        .collect();
    assert_eq!(
        unique, targets,
        "the partitions must cover the targets exactly"
    );
    for skipped in &preview.skipped {
        assert!(
            !unique.contains(&skipped.asset_id),
            "skipped row in a partition"
        );
    }
}

#[test]
fn tag_rename_commit_writes_each_owning_sidecar_once_in_order_and_commits_every_row() {
    let (_dir, root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-ok"));
    assert_eq!(preview.targets.len(), 6);
    assert_eq!(
        preview.skipped.len(),
        1,
        "the stale entry is a skipped match"
    );
    let before: Vec<Vec<u8>> = CM_GROUPS
        .iter()
        .map(|(owner, _)| std::fs::read(cm_sidecar(&root, owner)).unwrap())
        .collect();
    let (commit, calls) = cm_commit_failing_at(&state, &preview.preview_id, None);

    assert_eq!(calls.len(), 4, "exactly one write per owning sidecar");
    for (index, (owner, _)) in CM_GROUPS.iter().enumerate() {
        let call = &calls[index];
        assert_eq!(
            call.path,
            cm_sidecar(&root, owner),
            "write order is ascending owner"
        );
        assert_eq!(call.expected.as_deref(), Some(before[index].as_slice()));
        assert_eq!(std::fs::read(&call.path).unwrap(), call.bytes);
        assert_ne!(call.bytes, before[index]);
    }
    assert!(commit.sidecars_complete());
    assert!(commit.failed.is_empty() && commit.unattempted.is_empty());
    assert!(commit.failing_sidecar.is_none() && commit.error.is_none());
    assert_eq!(
        commit
            .committed
            .iter()
            .map(|asset| asset.id.clone())
            .collect::<Vec<_>>(),
        cm_flat(&CM_GROUPS)
    );
    cm_assert_exhaustive(&preview, &commit);
    assert_eq!(commit.mapping, state_mapping());
    assert_eq!(commit.preview_id, preview.preview_id);
    assert_eq!(commit.library_id, LIB);
    assert_eq!(commit.root, root);

    let merged = pf_json(&cm_sidecar(&root, "d2"));
    assert_eq!(
        merged["items"]["c.stl"]["tags"],
        serde_json::json!(["state:c"]),
        "the merge collapses duplicates"
    );
    let root_json = pf_json(&cm_sidecar(&root, "."));
    assert_eq!(
        root_json["items"]["gone.stl"]["tags"],
        serde_json::json!(["status:old"]),
        "the skipped stale row keeps its old tags"
    );
    assert_eq!(
        root_json["items"]["n.stl"]["tags"],
        serde_json::json!(["other:n"])
    );
}

#[test]
fn tag_rename_commit_leaves_asset_bytes_settings_and_saved_searches_alone() {
    let (dir, root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-quiet"));
    let assets_before: Vec<_> = tree_bytes(&root)
        .into_iter()
        .filter(|(path, _)| path.extension().is_some_and(|ext| ext == "stl"))
        .collect();
    let settings_path = dir.path().join("settings.json");
    let settings_before = std::fs::read(&settings_path).unwrap();
    let searches_before = lock(&state).saved_searches.clone();
    let libraries_before = state.snapshot().unwrap();
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, Some(2));
    assert!(!commit.sidecars_complete());
    let assets_after: Vec<_> = tree_bytes(&root)
        .into_iter()
        .filter(|(path, _)| path.extension().is_some_and(|ext| ext == "stl"))
        .collect();
    assert_eq!(
        assets_before, assets_after,
        "asset bytes and paths never change"
    );
    assert_eq!(std::fs::read(&settings_path).unwrap(), settings_before);
    assert_eq!(lock(&state).saved_searches, searches_before);
    assert_eq!(state.snapshot().unwrap(), libraries_before);
}

/// Injects a writer failure at group `fail_group` (0-based) and checks
/// everything the plan requires of the partition.
fn cm_assert_failure_at(fail_group: usize) {
    let (_dir, root, state) = cm_library();
    let preview = run_ready(&state, status_to_state(&format!("cm-fail-{fail_group}")));
    let before_bytes: Vec<Vec<u8>> = CM_GROUPS
        .iter()
        .map(|(owner, _)| std::fs::read(cm_sidecar(&root, owner)).unwrap())
        .collect();
    let tree_before = tree_bytes(&root);
    let cached_before = cm_cached(&state);
    let assets_before: BTreeMap<String, Asset> = lock(&state).scan_snapshots[LIB]
        .assets
        .iter()
        .map(|(id, asset)| (id.clone(), asset.clone()))
        .collect();

    let (commit, calls) = cm_commit_failing_at(&state, &preview.preview_id, Some(fail_group));

    assert_eq!(
        calls.len(),
        fail_group + 1,
        "the writer stops after the first failure"
    );
    let committed_groups = &CM_GROUPS[..fail_group];
    let failed_group = &CM_GROUPS[fail_group];
    let later_groups = &CM_GROUPS[fail_group + 1..];
    assert_eq!(
        commit
            .committed
            .iter()
            .map(|asset| asset.id.clone())
            .collect::<Vec<_>>(),
        cm_flat(committed_groups)
    );
    assert_eq!(cm_summary_ids(&commit.failed), cm_ids(failed_group.1));
    assert_eq!(cm_summary_ids(&commit.unattempted), cm_flat(later_groups));
    assert!(commit
        .failed
        .iter()
        .all(|row| row.sidecar_owner == failed_group.0));
    assert!(!commit.sidecars_complete());
    cm_assert_exhaustive(&preview, &commit);

    let expected_sidecar = if failed_group.0 == "." {
        manifest::MANIFEST_NAME.to_string()
    } else {
        format!("{}/{}", failed_group.0, manifest::MANIFEST_NAME)
    };
    assert_eq!(
        commit.failing_sidecar.as_deref(),
        Some(expected_sidecar.as_str())
    );
    let error = commit
        .error
        .as_ref()
        .expect("a failed commit carries an error");
    assert_eq!(
        error.path.as_deref(),
        cm_sidecar(&root, failed_group.0).to_str(),
        "the error names the failing sidecar"
    );
    assert_eq!(error.details.as_deref(), Some("disk full"));
    assert!(
        error
            .message
            .contains(&format!("{fail_group} of 4 sidecars completed")),
        "{}",
        error.message
    );

    // Disk: committed groups hold their new bytes; failed and unattempted
    // groups are byte-identical to before.
    for (index, (owner, _)) in CM_GROUPS.iter().enumerate() {
        let now = std::fs::read(cm_sidecar(&root, owner)).unwrap();
        if index < fail_group {
            assert_eq!(now, calls[index].bytes, "committed group {owner}");
            assert_ne!(now, before_bytes[index]);
        } else {
            assert_eq!(
                now, before_bytes[index],
                "group {owner} must keep its bytes"
            );
        }
    }
    let tree_after = tree_bytes(&root);
    for (path, bytes) in &tree_before {
        let is_committed_sidecar = committed_groups
            .iter()
            .any(|(owner, _)| *path == cm_sidecar(&root, owner));
        if !is_committed_sidecar {
            assert_eq!(
                tree_after.get(path),
                Some(bytes),
                "{} changed",
                path.display()
            );
        }
    }
    assert_eq!(
        tree_after.len(),
        tree_before.len(),
        "no file appears or vanishes"
    );

    // Snapshot: revisions advance only for committed groups.
    let cached_after = cm_cached(&state);
    let committed_ids = cm_flat(committed_groups);
    for asset in &commit.committed {
        assert_ne!(cached_after[&asset.id], cached_before[&asset.id]);
        assert_eq!(cached_after[&asset.id], asset.metadata_revision);
        assert_eq!(cm_cached_asset(&state, &asset.id), *asset);
    }
    for (id, revision) in &cached_after {
        if !committed_ids.contains(id) {
            assert_eq!(
                revision, &cached_before[id],
                "{id} must keep its cached revision"
            );
            assert_eq!(cm_cached_asset(&state, id), assets_before[id]);
        }
    }
    // The skipped row is unchanged in cache and on disk.
    assert_eq!(
        cached_after["path:gone.stl"],
        cached_before["path:gone.stl"]
    );
    assert_eq!(
        commit
            .committed_rows
            .iter()
            .map(|row| row.asset_id.clone())
            .collect::<Vec<_>>(),
        committed_ids
    );
}

#[test]
fn tag_rename_commit_failure_at_the_first_group_commits_nothing() {
    cm_assert_failure_at(0);
}

#[test]
fn tag_rename_commit_failure_at_the_second_group_keeps_the_first() {
    cm_assert_failure_at(1);
}

#[test]
fn tag_rename_commit_failure_at_a_middle_multi_row_group_splits_the_partitions() {
    cm_assert_failure_at(2);
}

#[test]
fn tag_rename_commit_failure_at_the_last_group_leaves_nothing_unattempted() {
    cm_assert_failure_at(3);
}

#[test]
fn tag_rename_commit_real_atomic_write_failure_never_clobbers_a_concurrent_edit() {
    let (_dir, root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-real"));
    let outside = br#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{}}"#.to_vec();
    let d1_before = std::fs::read(cm_sidecar(&root, "d1")).unwrap();
    let calls = std::cell::Cell::new(0usize);
    // The real writer runs; an outside process rewrites d1 just before its write.
    let commit = cm_apply(&state, &preview.preview_id, |path, expected, bytes| {
        if calls.get() == 1 {
            std::fs::write(path, &outside).unwrap();
        }
        calls.set(calls.get() + 1);
        manifest::write_atomic(path, expected, bytes)
    })
    .unwrap();
    assert_eq!(calls.get(), 2);
    assert_eq!(std::fs::read(cm_sidecar(&root, "d1")).unwrap(), outside);
    assert_ne!(outside, d1_before);
    assert_eq!(cm_summary_ids(&commit.failed), cm_ids(&["d1/b.stl"]));
    assert_eq!(
        cm_summary_ids(&commit.unattempted),
        cm_flat(&CM_GROUPS[2..])
    );
    assert_eq!(commit.committed.len(), 2);
    assert!(commit
        .error
        .as_ref()
        .and_then(|error| error.details.as_deref())
        .is_some_and(|details| details.contains("changed")));
    cm_assert_exhaustive(&preview, &commit);
}

#[test]
fn tag_rename_commit_invalidates_other_previews_once_and_registers_nothing() {
    let (_dir, _root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-generation"));
    let other = bind(&state, "other-library");
    // `bind` itself leaves the generation alone; the commit advances it.
    let before = generation(&state);
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, None);
    assert!(commit.sidecars_complete());
    assert!(
        generation(&state) > before,
        "a commit is a mutation boundary"
    );
    assert!(take(&state, "other-library", &other).is_err());
    assert!(
        !lock(&state).rename.has_pending_preview(LIB),
        "the preview is consumed"
    );
    assert_eq!(registrations(&state), 0);
}

#[test]
fn tag_rename_commit_cached_revisions_let_an_ordinary_edit_proceed_without_a_rescan() {
    let (_dir, root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-edit"));
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, None);
    assert!(commit.sidecars_complete());
    // The cached snapshot rows are what the UI would hand back as the expected revision.
    for asset in &commit.committed {
        let cached = cm_cached_asset(&state, &asset.id);
        let edited = edit_tags_domain(
            &state,
            LIB,
            &asset.id,
            &cached.metadata_revision,
            &["after-rename".to_string()],
            &[],
        )
        .unwrap_or_else(|error| panic!("{} rejected: {error:?}", asset.id));
        assert!(edited.tags.contains(&"after-rename".to_string()));
        assert!(edited.tags.iter().any(|tag| tag.starts_with("state:")));
        assert_ne!(edited.metadata_revision, cached.metadata_revision);
    }
    // The old pre-rename revision is no longer accepted.
    let scan_revision = preview
        .scan
        .assets
        .iter()
        .find(|a| a.id == "path:d1/b.stl")
        .unwrap();
    let error = edit_tags_domain(
        &state,
        LIB,
        "path:d1/b.stl",
        &scan_revision.metadata_revision,
        &["late".to_string()],
        &[],
    )
    .expect_err("the pre-rename revision is stale");
    assert!(error.message.contains("changed since scan"));
    let on_disk = pf_json(&cm_sidecar(&root, "d1"));
    assert_eq!(
        on_disk["items"]["b.stl"]["tags"],
        serde_json::json!(["after-rename", "state:b"])
    );
}

#[test]
fn tag_rename_commit_failed_and_committed_rows_each_accept_exactly_their_own_revision() {
    let (_dir, _root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-edit-partial"));
    let original: BTreeMap<String, String> = preview
        .scan
        .assets
        .iter()
        .map(|asset| (asset.id.clone(), asset.metadata_revision.clone()))
        .collect();
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, Some(1));
    // Committed root rows take the new revision, not the old one.
    let committed = commit
        .committed
        .iter()
        .find(|a| a.id == "path:a.stl")
        .unwrap();
    assert!(edit_tags_domain(
        &state,
        LIB,
        "path:a.stl",
        &original["path:a.stl"],
        &["z".into()],
        &[]
    )
    .is_err());
    assert!(edit_tags_domain(
        &state,
        LIB,
        "path:a.stl",
        &committed.metadata_revision,
        &["z".into()],
        &[]
    )
    .is_ok());
    // A failed group's file is untouched, so its original revision is still the live one.
    assert!(edit_tags_domain(
        &state,
        LIB,
        "path:d1/b.stl",
        &original["path:d1/b.stl"],
        &["z".into()],
        &[]
    )
    .is_ok());
    // An unattempted group likewise.
    assert!(edit_tags_domain(
        &state,
        LIB,
        "path:d3/e.stl",
        &original["path:d3/e.stl"],
        &["z".into()],
        &[]
    )
    .is_ok());
}

#[test]
fn tag_rename_commit_settings_only_prepared_rename_performs_no_write() {
    let (_dir, root, state) = cm_library();
    let before = tree_bytes(&root);
    let prepared = PreparedRename {
        preview_id: "retry-preview".into(),
        library_id: LIB.into(),
        root: root.clone(),
        mapping: state_mapping(),
        groups: Vec::new(),
        skipped: Vec::new(),
        uninspectable: Vec::new(),
        replacements: vec![replacement("search-1")],
        settings_only: true,
    };
    let writes = std::cell::Cell::new(0usize);
    let commit = commit_prepared_rename(&mut lock(&state), prepared, |_, _, _| {
        writes.set(writes.get() + 1);
        Ok(())
    });
    assert_eq!(writes.get(), 0);
    assert!(commit.sidecars_complete());
    assert!(
        commit.committed.is_empty() && commit.failed.is_empty() && commit.unattempted.is_empty()
    );
    assert!(commit.settings_only);
    assert_eq!(commit.replacements, vec![replacement("search-1")]);
    assert_eq!(tree_bytes(&root), before);
}

#[test]
fn tag_rename_commit_skipped_and_uninspectable_rows_travel_with_the_commit() {
    let (_dir, _root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-skipped"));
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, Some(0));
    assert_eq!(commit.skipped, preview.skipped);
    assert_eq!(commit.uninspectable, preview.uninspectable);
}

// The apply-result builder: shapes the frontend validator accepts.

fn cm_search(id: &str, library: &str) -> SavedSearch {
    SavedSearch {
        id: id.into(),
        library_id: library.into(),
        name: id.into(),
        filters: dto_filters("state"),
    }
}

/// The five rules `validateRenameApply` enforces, restated for Rust.
fn cm_assert_contract(
    result: &RenameApplyResult,
    preview: &RenamePreview,
    current_searches: &[SavedSearch],
) {
    let mut seen: Vec<String> = result
        .committed
        .iter()
        .map(|asset| asset.id.clone())
        .collect();
    seen.extend(cm_summary_ids(&result.failed));
    seen.extend(cm_summary_ids(&result.unattempted));
    let unique: std::collections::BTreeSet<_> = seen.iter().cloned().collect();
    assert_eq!(unique.len(), seen.len(), "pairwise disjoint");
    let targets: std::collections::BTreeSet<_> =
        preview.targets.iter().map(|t| t.asset_id.clone()).collect();
    assert_eq!(unique, targets, "covers every target exactly once");
    let unapplied = result.failed.len() + result.unattempted.len();
    match result.outcome {
        RenameOutcome::Complete => {
            assert!(unapplied == 0 && result.error.is_none() && result.query_migrated);
        }
        RenameOutcome::Partial => assert!(unapplied > 0 && !result.query_migrated),
        RenameOutcome::SettingsFailed => {
            assert!(unapplied == 0 && result.error.is_some() && !result.query_migrated);
        }
    }
    let known: std::collections::BTreeSet<_> = current_searches
        .iter()
        .filter(|search| search.library_id == preview.library_id)
        .map(|search| search.id.clone())
        .collect();
    let mut returned = std::collections::BTreeSet::new();
    for search in &result.saved_searches {
        assert_eq!(search.library_id, preview.library_id);
        assert!(known.contains(&search.id));
        assert!(returned.insert(search.id.clone()), "unique search IDs");
    }
    assert_eq!(result.preview_id, preview.preview_id);
    assert_eq!(result.library_id, preview.library_id);
    assert_eq!(result.mapping, preview.mapping);
}

#[test]
fn tag_rename_commit_result_for_a_sidecar_failure_is_a_final_partial_shape() {
    let (_dir, _root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-shape-partial"));
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, Some(1));
    let searches = vec![
        cm_search("ours", LIB),
        cm_search("theirs", "another-library"),
    ];
    let result = commit.into_apply_result(
        searches.clone(),
        Some(AppError::from("must be ignored after a sidecar failure")),
    );
    assert_eq!(result.outcome, RenameOutcome::Partial);
    assert!(!result.query_migrated);
    assert_eq!(
        result.saved_searches,
        vec![cm_search("ours", LIB)],
        "only the active library's existing searches are returned"
    );
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.details.as_deref(), Some("disk full"));
    assert_eq!(
        result.failing_sidecar.as_deref(),
        Some("d1/.asset-tags.json")
    );
    cm_assert_contract(&result, &preview, &searches);
}

#[test]
fn tag_rename_commit_result_complete_holds_even_with_zero_bound_replacements() {
    let (_dir, _root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-shape-complete"));
    assert_eq!(preview.saved_search_update_count, 0);
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, None);
    let result = commit.into_apply_result(Vec::new(), None);
    assert_eq!(result.outcome, RenameOutcome::Complete);
    assert!(result.query_migrated && result.error.is_none());
    assert!(result.failing_sidecar.is_none());
    cm_assert_contract(&result, &preview, &[]);
}

#[test]
fn tag_rename_commit_result_settings_failed_keeps_committed_rows_and_clears_the_flag() {
    let (_dir, _root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-shape-settings"));
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, None);
    let searches = vec![cm_search("ours", LIB)];
    let result = commit.into_apply_result(
        searches.clone(),
        Some(AppError::from("Could not save settings")),
    );
    assert_eq!(result.outcome, RenameOutcome::SettingsFailed);
    assert!(!result.query_migrated);
    assert_eq!(result.committed.len(), 6);
    assert_eq!(
        result.error.as_ref().unwrap().message,
        "Could not save settings"
    );
    cm_assert_contract(&result, &preview, &searches);
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["outcome"], "settings-failed");
    assert_eq!(json["queryMigrated"], false);
}

#[test]
fn tag_rename_commit_failing_sidecar_for_the_root_owner_is_the_bare_manifest_name() {
    let (_dir, _root, state) = cm_library();
    let preview = run_ready(&state, status_to_state("cm-root-owner"));
    let (commit, _) = cm_commit_failing_at(&state, &preview.preview_id, Some(0));
    assert_eq!(commit.failing_sidecar.as_deref(), Some(".asset-tags.json"));
    assert_eq!(commit.committed.len(), 0);
    assert_eq!(commit.failed.len(), 2, "both root rows fail together");
    assert_eq!(commit.unattempted.len(), 4);
}

// ---------------------------------------------------------------------------
// T11: settings commit, settings failure after committed sidecars, bound retry
// and command registration.
//
// Apply runs prepare, the sidecar commit and the settings stage under ONE held
// guard. Writers and the settings persister are injected; the production pair
// is `manifest::write_atomic` and `backend::persist`.
// ---------------------------------------------------------------------------

type ApResult = Result<RenameApplyResult, AppError>;

/// `cm_library` plus a second library and three saved searches: `ours` (bound
/// by tests), `unbound` (same library, never bound) and `theirs` (other library).
fn ap_library() -> (
    tempfile::TempDir,
    PathBuf,
    BackendState,
    String,
    String,
    String,
) {
    let (dir, root, state) = cm_library();
    let other_root = dir.path().join("other-root");
    std::fs::create_dir(&other_root).unwrap();
    add_library(
        &state,
        "other",
        &std::fs::canonicalize(&other_root).unwrap(),
    );
    let mut ids = Vec::new();
    for (library, name, query) in [
        (LIB, "Ours", "status:printed"),
        (LIB, "Unbound", "status:other -keep:me"),
        ("other", "Theirs", "status:printed"),
    ] {
        let filters = SearchFilters {
            query: query.into(),
            ..dto_filters("status")
        };
        let saved = upsert_saved_search_domain(&state, library, name, filters, None).unwrap();
        ids.push(
            saved
                .saved_searches
                .into_iter()
                .find(|search| search.name == name)
                .unwrap()
                .id,
        );
    }
    let theirs = ids.pop().unwrap();
    let unbound = ids.pop().unwrap();
    let ours = ids.pop().unwrap();
    (dir, root, state, ours, unbound, theirs)
}

/// The `status` -> `state` rewrite of `ours`, matching `ap_library`'s query.
fn ap_replacement(search_id: &str) -> SavedSearchReplacement {
    SavedSearchReplacement {
        search_id: search_id.into(),
        expected_filters: SearchFilters {
            query: "status:printed".into(),
            ..dto_filters("status")
        },
        filters: SearchFilters {
            query: "state:printed".into(),
            ..dto_filters("status")
        },
    }
}

fn ap_preview(state: &BackendState, scan_id: &str, search_id: &str) -> RenamePreview {
    run_ready(
        state,
        with_replacements(scan_id, vec![ap_replacement(search_id)]),
    )
}

fn ap_settings_bytes(state: &BackendState) -> Vec<u8> {
    std::fs::read(&lock(state).settings_path).unwrap_or_default()
}

fn ap_settings(state: &BackendState) -> serde_json::Value {
    serde_json::from_slice(&ap_settings_bytes(state)).unwrap()
}

fn ap_searches(state: &BackendState) -> Vec<SavedSearch> {
    lock(state).saved_searches.clone()
}

/// Production writer and persister.
fn ap_apply_real(state: &BackendState, preview_id: &str) -> ApResult {
    apply_tag_rename_domain(
        state,
        LIB,
        preview_id,
        &mut FsPreviewEnv,
        manifest::write_atomic,
        persist,
    )
}

/// Real sidecar writer; settings persistence fails with "disk full".
fn ap_apply_settings_failing(state: &BackendState, preview_id: &str) -> ApResult {
    apply_tag_rename_domain(
        state,
        LIB,
        preview_id,
        &mut FsPreviewEnv,
        manifest::write_atomic,
        |_| Err("disk full".to_string()),
    )
}

/// Counts writer and persister calls; sidecar writes go to the real writer.
struct ApCounts {
    writes: std::cell::Cell<usize>,
    persists: std::cell::Cell<usize>,
}

fn ap_apply_counting(
    state: &BackendState,
    preview_id: &str,
    fail_write_at: Option<usize>,
    persist_result: Result<(), String>,
) -> (ApResult, ApCounts) {
    let counts = ApCounts {
        writes: std::cell::Cell::new(0),
        persists: std::cell::Cell::new(0),
    };
    let result = apply_tag_rename_domain(
        state,
        LIB,
        preview_id,
        &mut FsPreviewEnv,
        |path, expected, bytes| {
            let index = counts.writes.get();
            counts.writes.set(index + 1);
            if fail_write_at == Some(index) {
                return Err("disk full".into());
            }
            manifest::write_atomic(path, expected, bytes)
        },
        |inner| {
            counts.persists.set(counts.persists.get() + 1);
            // Whatever the persister sees is what would reach settings.json.
            let _ = &inner.saved_searches;
            persist_result.clone()
        },
    );
    (result, counts)
}

fn ap_filters_of(searches: &[SavedSearch], id: &str) -> SearchFilters {
    searches
        .iter()
        .find(|search| search.id == id)
        .unwrap()
        .filters
        .clone()
}

/// Settings failure after committed sidecars: returns the preview and result.
fn ap_settings_failure(
    state: &BackendState,
    ours: &str,
    scan_id: &str,
) -> (RenamePreview, RenameApplyResult) {
    let preview = ap_preview(state, scan_id, ours);
    let result = ap_apply_settings_failing(state, &preview.preview_id).unwrap();
    (preview, result)
}

/// A settings-only retry preview: every row is already renamed, so no targets.
fn ap_retry_preview(state: &BackendState, ours: &str, scan_id: &str) -> RenamePreview {
    let preview = ap_preview(state, scan_id, ours);
    assert!(preview.targets.is_empty(), "retry preview has no targets");
    assert!(preview.settings_retry);
    preview
}

fn ap_copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            ap_copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

// --- Only the preview-bound replacements persist ---------------------------

#[test]
fn tag_rename_apply_persists_only_the_bound_replacements() {
    let (_dir, _root, state, ours, unbound, theirs) = ap_library();
    let before_searches = ap_searches(&state);
    let before_file = ap_settings(&state);
    let preview = ap_preview(&state, "ap-bound", &ours);
    assert_eq!(
        ap_settings(&state),
        before_file,
        "a preview writes no settings"
    );

    let result = ap_apply_real(&state, &preview.preview_id).unwrap();
    assert_eq!(result.outcome, RenameOutcome::Complete);
    assert!(result.query_migrated && result.error.is_none());
    cm_assert_contract(&result, &preview, &before_searches);

    let after = ap_searches(&state);
    assert_eq!(
        ap_filters_of(&after, &ours),
        ap_replacement(&ours).filters,
        "the bound search takes its new filters"
    );
    assert_eq!(
        ap_filters_of(&after, &unbound),
        ap_filters_of(&before_searches, &unbound)
    );
    assert_eq!(
        ap_filters_of(&after, &theirs),
        ap_filters_of(&before_searches, &theirs)
    );
    for search in &before_searches {
        let now = after.iter().find(|s| s.id == search.id).unwrap();
        assert_eq!(now.name, search.name);
        assert_eq!(now.library_id, search.library_id);
    }
    assert_eq!(after.len(), before_searches.len());

    // The file differs from before in exactly the bound search's filters.
    let mut expected = before_file.clone();
    let entry = expected["savedSearches"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|search| search["id"] == ours.as_str())
        .unwrap();
    entry["filters"] = serde_json::to_value(ap_replacement(&ours).filters).unwrap();
    assert_eq!(ap_settings(&state), expected);

    let mut returned: Vec<_> = result.saved_searches.iter().map(|s| s.id.clone()).collect();
    returned.sort();
    let mut active: Vec<_> = vec![ours.clone(), unbound.clone()];
    active.sort();
    assert_eq!(
        returned, active,
        "only the active library's searches return"
    );
    assert!(lock(&state).rename.retry_proof(LIB).is_none());
}

#[test]
fn tag_rename_apply_without_bound_replacements_completes_and_writes_no_settings() {
    let (_dir, _root, state, _ours, _unbound, _theirs) = ap_library();
    let preview = run_ready(&state, status_to_state("ap-none"));
    assert_eq!(preview.saved_search_update_count, 0);
    let before = ap_settings_bytes(&state);
    let searches = ap_searches(&state);
    let (result, counts) = ap_apply_counting(&state, &preview.preview_id, None, Ok(()));
    let result = result.unwrap();
    assert_eq!(result.outcome, RenameOutcome::Complete);
    assert!(result.query_migrated && result.error.is_none());
    assert_eq!(counts.writes.get(), 4, "one write per owning sidecar");
    assert_eq!(counts.persists.get(), 0, "nothing to persist");
    assert_eq!(ap_settings_bytes(&state), before);
    assert_eq!(ap_searches(&state), searches);
    cm_assert_contract(&result, &preview, &searches);
}

#[test]
fn tag_rename_preview_makes_no_settings_write_and_changes_no_saved_search() {
    let (_dir, _root, state, ours, _unbound, _theirs) = ap_library();
    let before = ap_settings_bytes(&state);
    let searches = ap_searches(&state);
    let _ = ap_preview(&state, "ap-preview-only", &ours);
    assert_eq!(ap_settings_bytes(&state), before);
    assert_eq!(ap_searches(&state), searches);
}

#[test]
fn tag_rename_apply_partial_sidecar_failure_never_touches_settings() {
    let (_dir, root, state, ours, _unbound, _theirs) = ap_library();
    let searches = ap_searches(&state);
    let file = ap_settings_bytes(&state);
    let preview = ap_preview(&state, "ap-partial", &ours);
    let (result, counts) = ap_apply_counting(&state, &preview.preview_id, Some(1), Ok(()));
    let result = result.unwrap();
    assert_eq!(result.outcome, RenameOutcome::Partial);
    assert!(!result.query_migrated);
    assert_eq!(counts.writes.get(), 2, "the failed write stops the loop");
    assert_eq!(counts.persists.get(), 0, "no settings write on a partial");
    assert_eq!(ap_settings_bytes(&state), file);
    assert_eq!(ap_searches(&state), searches);
    assert!(
        lock(&state).rename.retry_proof(LIB).is_none(),
        "a partial rename leaves no settings-retry proof"
    );
    assert_eq!(result.committed.len(), 2, "the first group stays committed");
    assert_eq!(
        std::fs::read_to_string(root.join(".asset-tags.json"))
            .unwrap()
            .matches("state:")
            .count(),
        2
    );
    cm_assert_contract(&result, &preview, &searches);
}

// --- Expected-filter recheck is on the write path ---------------------------

#[test]
fn tag_rename_apply_rejects_a_changed_expected_filter_with_zero_writes() {
    let (_dir, root, state, ours, _unbound, _theirs) = ap_library();
    let preview = ap_preview(&state, "ap-mismatch", &ours);
    // A change that bypasses the mutation hook, so only the recheck can catch it.
    lock(&state)
        .saved_searches
        .iter_mut()
        .find(|search| search.id == ours)
        .unwrap()
        .filters
        .query = "status:changed".into();
    let tree = tree_bytes(&root);
    let file = ap_settings_bytes(&state);
    let searches = ap_searches(&state);
    let (result, counts) = ap_apply_counting(&state, &preview.preview_id, None, Ok(()));
    let error = result.expect_err("a stale expected filter must reject");
    assert!(
        error
            .message
            .to_lowercase()
            .contains("saved search changed"),
        "{}",
        error.message
    );
    assert_eq!(counts.writes.get(), 0, "no sidecar write");
    assert_eq!(counts.persists.get(), 0, "no settings write");
    assert_eq!(tree_bytes(&root), tree);
    assert_eq!(ap_settings_bytes(&state), file);
    assert_eq!(ap_searches(&state), searches);
}

// --- Settings failure after committed sidecars ------------------------------

#[test]
fn tag_rename_apply_settings_failure_rolls_back_searches_but_keeps_committed_sidecars() {
    let (_dir, root, state, ours, unbound, _theirs) = ap_library();
    let before = ap_searches(&state);
    let file = ap_settings_bytes(&state);
    let preview = ap_preview(&state, "ap-settings-fail", &ours);
    let seen_by_persister = std::cell::RefCell::new(Vec::<SavedSearch>::new());
    let result = apply_tag_rename_domain(
        &state,
        LIB,
        &preview.preview_id,
        &mut FsPreviewEnv,
        manifest::write_atomic,
        |inner| {
            *seen_by_persister.borrow_mut() = inner.saved_searches.clone();
            Err("disk full".to_string())
        },
    )
    .unwrap();

    // The persister was asked to save exactly the bound replacement.
    let seen = seen_by_persister.into_inner();
    assert_eq!(ap_filters_of(&seen, &ours), ap_replacement(&ours).filters);
    assert_eq!(
        ap_filters_of(&seen, &unbound),
        ap_filters_of(&before, &unbound)
    );

    // In-memory searches and the settings file are back to the old state.
    assert_eq!(ap_searches(&state), before);
    assert_eq!(ap_settings_bytes(&state), file);

    assert_eq!(result.outcome, RenameOutcome::SettingsFailed);
    assert!(!result.query_migrated);
    assert!(result.failed.is_empty() && result.unattempted.is_empty());
    assert_eq!(result.committed.len(), 6, "committed rows are returned");
    let error = result.error.as_ref().expect("settings error");
    assert_eq!(error.message, "Could not save library settings");
    assert_eq!(error.details.as_deref(), Some("disk full"));
    assert_eq!(
        ap_filters_of(&result.saved_searches, &ours),
        ap_filters_of(&before, &ours),
        "the returned searches are the rolled-back ones"
    );
    cm_assert_contract(&result, &preview, &before);

    // Sidecars stay committed on disk.
    for owner in [".", "d1", "d2", "d3"] {
        let text = std::fs::read_to_string(cm_sidecar(&root, owner)).unwrap();
        assert!(text.contains("state:"), "{owner} is committed");
    }
    assert!(
        !std::fs::read_to_string(root.join("d1").join(".asset-tags.json"))
            .unwrap()
            .contains("status:b")
    );
}

#[test]
fn tag_rename_apply_settings_failure_stores_the_exact_in_memory_retry_proof() {
    let (_dir, root, state, ours, _unbound, _theirs) = ap_library();
    let (_preview, result) = ap_settings_failure(&state, &ours, "ap-proof");
    let proof = lock(&state)
        .rename
        .retry_proof(LIB)
        .cloned()
        .expect("a retry proof exists");
    assert_eq!(proof.library_id, LIB);
    assert_eq!(proof.root, root);
    assert_eq!(proof.mapping, result.mapping);
    assert_eq!(proof.replacements, vec![ap_replacement(&ours)]);
    let expected: Vec<CommittedRow> = result
        .committed
        .iter()
        .map(|asset| CommittedRow {
            asset_id: asset.id.clone(),
            revision: asset.metadata_revision.clone(),
        })
        .collect();
    assert_eq!(proof.committed, expected);
    assert_eq!(proof.committed.len(), 6);
    // The proof matches the native cache a retry will be checked against.
    let cached = cm_cached(&state);
    for row in &proof.committed {
        assert_eq!(cached[&row.asset_id], row.revision);
    }
}

#[test]
fn tag_rename_apply_a_real_settings_write_failure_gives_the_same_settings_failed_shape() {
    let (_dir, _root, state, ours, _unbound, _theirs) = ap_library();
    let before = ap_searches(&state);
    let path = lock(&state).settings_path.clone();
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    let preview = ap_preview(&state, "ap-real-fail", &ours);
    let result = ap_apply_real(&state, &preview.preview_id).unwrap();
    assert_eq!(result.outcome, RenameOutcome::SettingsFailed);
    assert_eq!(
        result.error.as_ref().unwrap().message,
        "Could not save library settings"
    );
    assert_eq!(ap_searches(&state), before);
    assert!(lock(&state).rename.retry_proof(LIB).is_some());
    cm_assert_contract(&result, &preview, &before);
}

// --- Settings-only retry ----------------------------------------------------

#[test]
fn tag_rename_apply_fresh_zero_target_retry_completes_and_consumes_the_proof() {
    let (_dir, root, state, ours, unbound, theirs) = ap_library();
    let (_first, failed) = ap_settings_failure(&state, &ours, "ap-retry-1");
    assert_eq!(failed.outcome, RenameOutcome::SettingsFailed);
    let before = ap_searches(&state);
    let tree = tree_bytes(&root);

    let retry = ap_retry_preview(&state, &ours, "ap-retry-2");
    let (result, counts) = ap_apply_counting(&state, &retry.preview_id, None, Ok(()));
    let result = result.unwrap();
    assert_eq!(
        counts.writes.get(),
        0,
        "a settings-only retry writes no sidecar"
    );
    assert_eq!(counts.persists.get(), 1);
    assert_eq!(tree_bytes(&root), tree);
    assert_eq!(result.outcome, RenameOutcome::Complete);
    assert!(result.query_migrated && result.error.is_none());
    assert!(result.committed.is_empty());
    assert_eq!(result.skipped, retry.skipped);
    cm_assert_contract(&result, &retry, &before);

    let after = ap_searches(&state);
    assert_eq!(ap_filters_of(&after, &ours), ap_replacement(&ours).filters);
    assert_eq!(
        ap_filters_of(&after, &unbound),
        ap_filters_of(&before, &unbound)
    );
    assert_eq!(
        ap_filters_of(&after, &theirs),
        ap_filters_of(&before, &theirs)
    );
    assert!(
        lock(&state).rename.retry_proof(LIB).is_none(),
        "the proof is consumed"
    );
    // The preview is consumed too; a second apply cannot reuse it.
    assert!(ap_apply_real(&state, &retry.preview_id).is_err());
}

#[test]
fn tag_rename_apply_the_real_persister_saves_a_settings_only_retry() {
    let (_dir, _root, state, ours, _unbound, _theirs) = ap_library();
    ap_settings_failure(&state, &ours, "ap-retry-real-1");
    let retry = ap_retry_preview(&state, &ours, "ap-retry-real-2");
    let result = ap_apply_real(&state, &retry.preview_id).unwrap();
    assert_eq!(result.outcome, RenameOutcome::Complete);
    let saved = ap_settings(&state);
    let entry = saved["savedSearches"]
        .as_array()
        .unwrap()
        .iter()
        .find(|search| search["id"] == ours.as_str())
        .unwrap();
    assert_eq!(entry["filters"]["query"], "state:printed");
}

#[test]
fn tag_rename_apply_a_failed_settings_retry_keeps_the_proof_for_another_attempt() {
    let (_dir, _root, state, ours, _unbound, _theirs) = ap_library();
    ap_settings_failure(&state, &ours, "ap-retry-again-1");
    let proof = lock(&state).rename.retry_proof(LIB).cloned().unwrap();
    let before = ap_searches(&state);

    let retry = ap_retry_preview(&state, &ours, "ap-retry-again-2");
    let failed = ap_apply_settings_failing(&state, &retry.preview_id).unwrap();
    assert_eq!(failed.outcome, RenameOutcome::SettingsFailed);
    assert!(failed.committed.is_empty());
    assert!(failed.error.is_some() && !failed.query_migrated);
    assert_eq!(ap_searches(&state), before, "rolled back again");
    assert_eq!(
        lock(&state).rename.retry_proof(LIB).cloned(),
        Some(proof),
        "the verified proof still stands"
    );
    cm_assert_contract(&failed, &retry, &before);

    let third = ap_retry_preview(&state, &ours, "ap-retry-again-3");
    let done = ap_apply_real(&state, &third.preview_id).unwrap();
    assert_eq!(done.outcome, RenameOutcome::Complete);
    assert!(lock(&state).rename.retry_proof(LIB).is_none());
}

#[test]
fn tag_rename_apply_rejects_a_retry_when_the_bound_search_changed() {
    let (_dir, root, state, ours, _unbound, _theirs) = ap_library();
    ap_settings_failure(&state, &ours, "ap-changed-search-1");
    // The user edits the very search the proof was bound to.
    let edited = SearchFilters {
        query: "status:printed -status:draft".into(),
        ..dto_filters("status")
    };
    upsert_saved_search_domain(&state, LIB, "Ours", edited.clone(), Some(&ours)).unwrap();
    let replacement = SavedSearchReplacement {
        search_id: ours.clone(),
        expected_filters: edited.clone(),
        filters: SearchFilters {
            query: "state:printed -state:draft".into(),
            ..edited.clone()
        },
    };
    let preview = run_ready(
        &state,
        with_replacements("ap-changed-search-2", vec![replacement]),
    );
    assert!(preview.targets.is_empty());
    let tree = tree_bytes(&root);
    let file = ap_settings_bytes(&state);
    let searches = ap_searches(&state);
    let (result, counts) = ap_apply_counting(&state, &preview.preview_id, None, Ok(()));
    let error = result.expect_err("an unverified retry is refused");
    assert!(error.message.contains("No editable rename targets"));
    assert_eq!((counts.writes.get(), counts.persists.get()), (0, 0));
    assert_eq!(tree_bytes(&root), tree);
    assert_eq!(ap_settings_bytes(&state), file);
    assert_eq!(ap_searches(&state), searches);
}

#[test]
fn tag_rename_apply_rejects_a_retry_when_the_approved_root_changed() {
    let (dir, root, state, ours, _unbound, _theirs) = ap_library();
    ap_settings_failure(&state, &ours, "ap-changed-root-1");
    let moved = std::fs::canonicalize(dir.path())
        .unwrap()
        .join("library-moved");
    ap_copy_dir(&root, &moved);
    lock(&state)
        .libraries
        .iter_mut()
        .find(|library| library.id == LIB)
        .unwrap()
        .root_path = moved.to_str().unwrap().into();
    let preview = ap_retry_preview(&state, &ours, "ap-changed-root-2");
    let tree = tree_bytes(&moved);
    let file = ap_settings_bytes(&state);
    let searches = ap_searches(&state);
    let (result, counts) = ap_apply_counting(&state, &preview.preview_id, None, Ok(()));
    let error = result.expect_err("a moved root cannot reuse the proof");
    assert!(error.message.contains("No editable rename targets"));
    assert_eq!((counts.writes.get(), counts.persists.get()), (0, 0));
    assert_eq!(tree_bytes(&moved), tree);
    assert_eq!(ap_settings_bytes(&state), file);
    assert_eq!(ap_searches(&state), searches);
}

#[test]
fn tag_rename_apply_rejects_a_retry_when_a_committed_row_changed() {
    let (_dir, root, state, ours, _unbound, _theirs) = ap_library();
    ap_settings_failure(&state, &ours, "ap-changed-row-1");
    // a.stl gains a tag after the rename committed: its revision moves on.
    write_manifest(
        &root,
        &[
            ("a.stl", 1, &["state:a", "extra:x"]),
            ("x.stl", 2, &["keep:me", "state:x"]),
            ("n.stl", 3, &["other:n"]),
            ("gone.stl", 4, &["status:old"]),
        ],
    );
    let preview = ap_retry_preview(&state, &ours, "ap-changed-row-2");
    let tree = tree_bytes(&root);
    let file = ap_settings_bytes(&state);
    let searches = ap_searches(&state);
    let (result, counts) = ap_apply_counting(&state, &preview.preview_id, None, Ok(()));
    let error = result.expect_err("a changed committed row voids the proof");
    assert!(error.message.contains("No editable rename targets"));
    assert_eq!((counts.writes.get(), counts.persists.get()), (0, 0));
    assert_eq!(tree_bytes(&root), tree);
    assert_eq!(ap_settings_bytes(&state), file);
    assert_eq!(ap_searches(&state), searches);
}

#[test]
fn tag_rename_apply_refuses_all_skipped_and_no_match_requests_without_a_proof() {
    for (skipped_row, scan_id) in [(true, "ap-refuse-skipped"), (false, "ap-refuse-none")] {
        let (_dir, root, state, ours, _rev) = pf_retry_fixture(skipped_row);
        let preview = pf_retry_preview(&state, &ours, scan_id);
        assert!(preview.targets.is_empty());
        assert!(!preview.settings_retry);
        assert_eq!(preview.skipped.is_empty(), !skipped_row);
        let tree = tree_bytes(&root);
        let file = ap_settings_bytes(&state);
        let searches = ap_searches(&state);
        let (result, counts) = ap_apply_counting(&state, &preview.preview_id, None, Ok(()));
        let error = result.expect_err("a request with nothing to do is refused");
        assert!(error.message.contains("No editable rename targets"));
        assert_eq!((counts.writes.get(), counts.persists.get()), (0, 0));
        assert_eq!(tree_bytes(&root), tree);
        assert_eq!(ap_settings_bytes(&state), file);
        assert_eq!(ap_searches(&state), searches);
    }
}

#[test]
fn tag_rename_apply_a_completed_rename_consumes_a_satisfied_proof_for_its_mapping() {
    let (_dir, root, state, ours, _unbound, _theirs) = ap_library();
    ap_settings_failure(&state, &ours, "ap-satisfied-1");
    assert!(lock(&state).rename.retry_proof(LIB).is_some());
    // A new matching row appears, so the next preview has a real target.
    touch(&root, "fresh.stl");
    write_manifest(
        &root,
        &[
            ("a.stl", 1, &["state:a"]),
            ("x.stl", 2, &["keep:me", "state:x"]),
            ("n.stl", 3, &["other:n"]),
            ("gone.stl", 4, &["status:old"]),
            ("fresh.stl", 9, &["status:fresh"]),
        ],
    );
    let preview = ap_preview(&state, "ap-satisfied-2", &ours);
    assert_eq!(preview.targets.len(), 1);
    let result = ap_apply_real(&state, &preview.preview_id).unwrap();
    assert_eq!(result.outcome, RenameOutcome::Complete);
    assert!(
        lock(&state).rename.retry_proof(LIB).is_none(),
        "the migration this proof was waiting for just completed"
    );
}

#[test]
fn tag_rename_apply_a_completed_rename_keeps_a_proof_for_another_mapping() {
    let (_dir, _root, state, ours, _unbound, _theirs) = ap_library();
    ap_settings_failure(&state, &ours, "ap-other-proof-1");
    let proof = lock(&state).rename.retry_proof(LIB).cloned().unwrap();
    // A different rename (n.stl's other:n) completes with no bound replacements.
    let preview = run_ready(
        &state,
        request_for("ap-other-proof-2", RenameMode::Prefix, "other", "misc"),
    );
    let result = ap_apply_real(&state, &preview.preview_id).unwrap();
    assert_eq!(result.outcome, RenameOutcome::Complete);
    assert_eq!(lock(&state).rename.retry_proof(LIB).cloned(), Some(proof));
}

// --- Guard discipline and early refusals ------------------------------------

#[test]
fn tag_rename_apply_holds_the_backend_mutex_across_sidecar_and_settings_writes() {
    let (_dir, _root, state, ours, _unbound, _theirs) = ap_library();
    let preview = ap_preview(&state, "ap-guard", &ours);
    let held_during_writes = std::cell::Cell::new(0usize);
    let held_during_persist = std::cell::Cell::new(false);
    let result = apply_tag_rename_domain(
        &state,
        LIB,
        &preview.preview_id,
        &mut FsPreviewEnv,
        |path, expected, bytes| {
            if state.inner.try_lock().is_err() {
                held_during_writes.set(held_during_writes.get() + 1);
            }
            manifest::write_atomic(path, expected, bytes)
        },
        |inner| {
            held_during_persist.set(state.inner.try_lock().is_err());
            persist(inner)
        },
    )
    .unwrap();
    assert_eq!(result.outcome, RenameOutcome::Complete);
    assert_eq!(held_during_writes.get(), 4, "every sidecar write held it");
    assert!(held_during_persist.get(), "the settings write held it too");
    assert!(
        state.inner.try_lock().is_ok(),
        "the guard is released after"
    );
}

#[test]
fn tag_rename_apply_refuses_a_startup_issue_before_touching_anything() {
    let (_dir, root, state, ours, _unbound, _theirs) = ap_library();
    let preview = ap_preview(&state, "ap-startup", &ours);
    lock(&state).startup_issue = Some(AppError::from("settings are unreadable"));
    let tree = tree_bytes(&root);
    let (result, counts) = ap_apply_counting(&state, &preview.preview_id, None, Ok(()));
    assert_eq!(result.unwrap_err().message, "settings are unreadable");
    assert_eq!((counts.writes.get(), counts.persists.get()), (0, 0));
    assert_eq!(tree_bytes(&root), tree);
    assert!(
        lock(&state).rename.has_pending_preview(LIB),
        "the preview was not consumed"
    );
}

// --- Error wording contract with the rename dialog ---------------------------
//
// CONSUMER: `classifyRejection` in src/components/TagRenameDialog.tsx. `AppError`
// carries a message and no code, so the dialog decides which notice to show by
// regex-matching the text of the native rejection. The regexes are
// case-insensitive, so the phrases below are compared lowercased. Changing any
// of these Rust phrases silently changes what the user sees. The worst case is
// "no verified settings retry": it alone gates the "Dismiss notice" action, so
// if that wording drifts, a user whose retry proof was rejected loops through
// Preview/Review/Confirm/fail with no way out and the updater stays blocked
// until they restart. These tests therefore assert the EXACT phrases, and pin
// the table to the TypeScript source so neither side can drift alone. If a test
// here fails, update the Rust message and the TypeScript regex together.

/// `(kind, phrases)` in the order the dialog checks them. Order matters: the
/// retry-rejected and changed-filters messages also end in "preview again".
const DIALOG_REJECTION_PHRASES: &[(&str, &[&str])] = &[
    ("retry-rejected", &["no verified settings retry"]),
    (
        "unknown-search",
        &[
            "unknown saved search",
            "belongs to another library",
            "appears more than once",
            "may change only the query",
        ],
    ),
    (
        "changed-filters",
        &["saved search changed since", "replacement makes no change"],
    ),
    (
        "stale-preview",
        &[
            "preview again",
            "no rename preview is pending",
            "replaced by a newer one",
            "changed after this rename preview",
        ],
    ),
];

const TAG_RENAME_DIALOG_TSX: &str = include_str!("../../src/components/TagRenameDialog.tsx");

/// The dialog's classifier, mirrored: first kind with a matching phrase wins.
fn classify_like_the_dialog(message: &str) -> &'static str {
    let message = message.to_lowercase();
    DIALOG_REJECTION_PHRASES
        .iter()
        .find(|(_, phrases)| phrases.iter().any(|phrase| message.contains(phrase)))
        .map_or("other", |(kind, _)| kind)
}

fn dialog_preview_rejection(state: &BackendState, request: RenamePreviewRequest) -> String {
    run_preview(state, request)
        .expect_err("request must be rejected")
        .message
}

/// Every phrase the dialog depends on, paired with a real native rejection that
/// carries it and the kind that rejection must classify as.
fn dialog_rejection_cases() -> Vec<(&'static str, Vec<&'static str>, String)> {
    let mut cases = Vec::new();

    let (_dir, _root, state, ours, _rev) = pf_retry_fixture(false);
    let preview = pf_retry_preview(&state, &ours, "wording-retry");
    let (result, _) = pf_run(&state, &preview.preview_id, &mut FsPreviewEnv);
    cases.push((
        "retry-rejected",
        vec!["no verified settings retry"],
        result.expect_err("zero targets without a proof").message,
    ));

    let (_dir, _root, state, ours, theirs) = searches_library();
    let unknown = dialog_preview_rejection(
        &state,
        with_replacements("wording-1", vec![replacement_for("no-such-search")]),
    );
    cases.push(("unknown-search", vec!["unknown saved search"], unknown));
    let other_library = dialog_preview_rejection(
        &state,
        with_replacements("wording-2", vec![replacement_for(&theirs)]),
    );
    cases.push((
        "unknown-search",
        vec!["belongs to another library"],
        other_library,
    ));
    let duplicate = dialog_preview_rejection(
        &state,
        with_replacements(
            "wording-3",
            vec![replacement_for(&ours), replacement_for(&ours)],
        ),
    );
    cases.push(("unknown-search", vec!["appears more than once"], duplicate));
    let mut view = replacement_for(&ours);
    view.filters.view = SearchView::Untagged;
    let more_than_query =
        dialog_preview_rejection(&state, with_replacements("wording-4", vec![view]));
    cases.push((
        "unknown-search",
        vec!["may change only the query"],
        more_than_query,
    ));

    let mut stale = replacement_for(&ours);
    stale.expected_filters.query = "status:printed".into();
    let changed = dialog_preview_rejection(&state, with_replacements("wording-5", vec![stale]));
    cases.push((
        "changed-filters",
        vec!["saved search changed since"],
        changed,
    ));
    let mut noop = replacement_for(&ours);
    noop.filters = noop.expected_filters.clone();
    let no_change = dialog_preview_rejection(&state, with_replacements("wording-6", vec![noop]));
    cases.push((
        "changed-filters",
        vec!["replacement makes no change"],
        no_change,
    ));

    let (_dir, state) = bare_state();
    let none_pending = take(&state, "library", "any-id").expect_err("nothing is pending");
    cases.push((
        "stale-preview",
        vec!["no rename preview is pending", "preview again"],
        none_pending.message,
    ));
    let id = bind(&state, "library");
    let replaced = take(&state, "library", "not-the-pending-id").expect_err("wrong preview id");
    cases.push((
        "stale-preview",
        vec!["replaced by a newer one", "preview again"],
        replaced.message,
    ));
    assert_eq!(take(&state, "library", &id).unwrap().preview_id, id);

    let id = {
        let mut inner = state.inner.lock().unwrap();
        let bound_at = inner.rename.current_generation();
        inner.rename.note_mutation();
        inner.rename.bind_preview(PendingPreview::new(
            "library",
            PathBuf::from("/approved/root"),
            state_mapping(),
            bound_at,
        ))
    };
    let older = take(&state, "library", &id).expect_err("older generation");
    cases.push((
        "stale-preview",
        vec!["changed after this rename preview", "preview again"],
        older.message,
    ));

    cases
}

#[test]
fn tag_rename_rejection_wording_keeps_every_phrase_the_dialog_classifies_on() {
    let cases = dialog_rejection_cases();
    for (kind, phrases, message) in &cases {
        let lowered = message.to_lowercase();
        for phrase in phrases {
            assert!(
                lowered.contains(phrase),
                "the {kind} rejection {message:?} must contain {phrase:?}; \
                 TagRenameDialog.tsx classifyRejection matches that exact text"
            );
        }
        assert_eq!(
            classify_like_the_dialog(message),
            *kind,
            "{message:?} must classify as {kind}"
        );
    }
    // Every phrase the dialog matches on is exercised by a real native message.
    for (kind, phrases) in DIALOG_REJECTION_PHRASES {
        for phrase in *phrases {
            assert!(
                cases
                    .iter()
                    .any(|(case_kind, case_phrases, _)| case_kind == kind
                        && case_phrases.contains(phrase)),
                "no native rejection is asserted to carry {phrase:?} ({kind})"
            );
        }
    }
}

#[test]
fn tag_rename_retry_rejection_is_classified_before_the_trailing_preview_again() {
    let cases = dialog_rejection_cases();
    let (_, _, retry) = cases
        .iter()
        .find(|(kind, _, _)| *kind == "retry-rejected")
        .unwrap();
    assert!(retry.to_lowercase().contains("preview again"));
    assert_eq!(classify_like_the_dialog(retry), "retry-rejected");
    let (_, _, changed) = cases
        .iter()
        .find(|(kind, _, _)| *kind == "changed-filters")
        .unwrap();
    assert!(changed.to_lowercase().contains("preview again"));
    assert_eq!(classify_like_the_dialog(changed), "changed-filters");
}

#[test]
fn tag_rename_dialog_classifier_regexes_match_the_pinned_native_phrases() {
    let start = TAG_RENAME_DIALOG_TSX
        .find("function classifyRejection")
        .expect("classifyRejection exists in TagRenameDialog.tsx");
    let body = &TAG_RENAME_DIALOG_TSX[start..];
    let body = &body[..body.find("return \"other\"").expect("classifier fallback")];
    let mut found = Vec::new();
    for line in body.lines() {
        let Some(test_at) = line.find("/i.test(message)") else {
            continue;
        };
        let open = line[..test_at].rfind("(/").expect("regex literal") + 2;
        let kind_at = line.find("return \"").expect("returns a kind") + "return \"".len();
        let kind = &line[kind_at..kind_at + line[kind_at..].find('"').unwrap()];
        let phrases: Vec<&str> = line[open..test_at].split('|').collect();
        found.push((kind, phrases));
    }
    let expected: Vec<(&str, Vec<&str>)> = DIALOG_REJECTION_PHRASES
        .iter()
        .map(|(kind, phrases)| (*kind, phrases.to_vec()))
        .collect();
    assert_eq!(
        found, expected,
        "TagRenameDialog.tsx classifyRejection and the pinned native phrases diverged; \
         change the Rust error text and the TypeScript regexes together"
    );
}

// --- Command registration (CON2-6 / MP2-11) ----------------------------------

const LIB_RS: &str = include_str!("lib.rs");
const NATIVE_TS: &str = include_str!("../../src/native.ts");

fn registered_commands() -> Vec<String> {
    let start =
        LIB_RS.find("generate_handler![").expect("handler list") + "generate_handler![".len();
    let end = start + LIB_RS[start..].find(']').unwrap();
    LIB_RS[start..end]
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect()
}

#[test]
fn tag_rename_commands_are_registered_under_the_exact_frontend_names() {
    let commands = registered_commands();
    assert!(commands.contains(&"backend::preview_tag_rename".to_string()));
    assert!(commands.contains(&"backend::apply_tag_rename".to_string()));
    // Registered name == Rust function name == the name the bridge invokes.
    for name in ["preview_tag_rename", "apply_tag_rename"] {
        assert!(
            NATIVE_TS.contains(&format!("(\"{name}\"")),
            "src/native.ts must invoke {name}"
        );
    }
    assert!(NATIVE_TS
        .contains("invoke<RenameApplyResult>(\"apply_tag_rename\", { libraryId, previewId })"));
}

#[test]
fn tag_rename_registration_keeps_every_existing_command_including_updates() {
    let expected = [
        "app_updates::check_for_updates",
        "app_updates::install_update",
        "backend::library_state",
        "backend::set_app_theme",
        "backend::choose_library",
        "backend::activate_library",
        "backend::remove_library",
        "backend::scan_library",
        "backend::cancel_scan",
        "backend::delete_assets",
        "backend::preview_asset",
        "backend::edit_tags",
        "backend::edit_notes",
        "backend::bulk_edit_tags",
        "backend::upsert_saved_search",
        "backend::delete_saved_search",
        "backend::asset_action",
        "backend::validate_metadata",
        "backend::reconnect_targets",
        "backend::reconnect_asset",
        "backend::remove_missing_entry",
        "backend::export_metadata",
    ];
    assert_eq!(expected.len(), 22);
    let commands = registered_commands();
    for name in expected {
        assert!(commands.contains(&name.to_string()), "{name} is registered");
    }
    for name in ["backend::preview_tag_rename", "backend::apply_tag_rename"] {
        assert_eq!(
            commands.iter().filter(|command| *command == name).count(),
            1,
            "{name} is registered exactly once"
        );
    }
    let unique: std::collections::BTreeSet<_> = commands.iter().collect();
    assert_eq!(unique.len(), commands.len(), "no duplicate registrations");
}
