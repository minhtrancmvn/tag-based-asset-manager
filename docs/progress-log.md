# Progress log

## Milestone 1 — scaffold and mocked interface (2026-10-05)

Built on `feat/milestone-1-desktop-scaffold`; no commits or pushes made during this milestone.

### Delivered

- Tauri v2 desktop shell with React, TypeScript, Vite, Tailwind CSS, pnpm and Vitest. Offline bundled fonts; no runtime remote assets.
- Dense 16-row sample catalog: All assets, Untagged, Needs attention, grouped tags with counts, required/excluded tag and quoted-path search, sortable/resizable columns, optional column visibility, click/Shift/Ctrl/Command selection, keyboard row selection and optional inspector.
- Typed frontend `Asset` / `LibrarySummary` shapes; native DTO commands deferred.
- Three frontend test files: catalog logic (21 tests), UI behavior (8), fixture library (3).
- Inert sample library with per-directory version-1 JSON, UUIDs, `.` folder tags, missing reference and Unicode path.
- README setup/build/platform prerequisites; metadata target specification; manual Windows/macOS/OneDrive plan.

### Verification

- `pnpm install --frozen-lockfile`: passed.
- `pnpm test`: **32 tests passed across 3 files**.
- `pnpm build`: **passed**, TypeScript plus Vite production output in `dist/`. Earlier fixture test type errors (`node:fs`, `node:path`, `ImportMeta.dirname`) fixed with explicit Node types in `tsconfig.json` and build rerun.
- `pnpm tauri dev`: native dev compile finished in 48.84 seconds; executable launched. Native on-screen 1440×900 window verified through OS window list on Apple Silicon macOS.
- Native screenshot attempt failed `could not create image from window`. Native WKWebView content/interaction not independently verified. Do not substitute browser screenshots for native screenshots.
- Separate Chrome smoke over Vite frontend: 16 initial rows; query `category:animal style:flexi -status:printed` returns 2; selecting result displays inspector; no JavaScript errors. Screenshots visually inspected.
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed test-profile compilation with **0 Rust tests**. Backend only launches shell; requested manifest/path/atomic-write Rust tests belong with native features.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`: passed.
- Native release `pnpm tauri build --no-bundle`: **passed**, optimized build finished in 2m 29s; 4.5 MB executable at `src-tauri/target/release/tag-based-asset-manager`. This is a host executable, not a signed installer.
- Windows 11, Intel macOS, installers, signing/notarization and OneDrive synchronization **not tested**.

Rust was absent initially. Installed Homebrew `rustup`, stable toolchain, `rustfmt` and `clippy`; used `export PATH="$(brew --prefix rustup)/bin:$PATH"`. Homebrew no longer supplies `rustup-init`; use `rustup toolchain install stable --profile minimal` and `rustup default stable` instead. No shell startup file changed.

### Scope limits

No native folder picker, root authorization, scan, manifest parsing/writes, single/bulk tag editing, saved-search persistence, open/reveal/copy paths, reconciliation, validation or backup export yet. Native-dependent UI actions disabled and marked as later milestones. No user library is read or changed. Demo state and column preferences reset on relaunch.

Query follows requested semantics: unquoted plain tokens required tags; `-tag` excluded; quoted text filename/relative-path search. Earlier concurrent edits briefly disagreed; final code/tests agree.

## Milestone 2 — native libraries and read-only scan (2026-10-05)

Branch `feat/milestone-2-safe-library-scanning`; resumed after interrupted session. No commits or pushes.

### Built

- Rust-only native folder picker; library roots and active registration durable in app-data `settings.json`, never library metadata. ID-only frontend commands, no broad filesystem/dialog permissions.
- Background recursive scan for files/folders plus root `.`; relative paths, type, timestamps and size; excludes sidecars/OS junk/private temporary files. Metadata only, no file/manifest contents read.
- Progress Channel and structured scan issues; links/reparse points/non-Unicode entries skipped and reported. Root canonical validation rejects changed approvals.
- Typed DTO bridge and lifecycle hook; stale scan IDs/generations discarded after switch/remove/unmount, cancellation retains library, old rows cleared on failed rescan.
- Real-library selector, registration-only removal confirmation, first-run/empty/loading/error states, scanned table and optional inspector. Browser shows desktop-required state rather than mock catalog.
- Tag metadata explicitly not loaded; parsing/editing still milestone 3. Existing catalog query semantics unchanged.

### Verification so far

- Frontend frozen-lockfile installation, production build and **53 tests across 5 files passed**, including no-active-library selector regression.
- Browser smoke passed zero rows, disabled picker, desktop-required message, panel toggles and no JS errors; screenshot inspected.
- Native dev executable launched; isolated native window screenshot inspected with real registered library rows and selected asset details. No screenshot or user library data published.
- Native picker automation not run: Accessibility permission unavailable. User picker/cancel/restart/platform tests remain in manual plan.
- **12 Rust tests passed**: settings roundtrip/malformed preservation, rejected malformed mutation, closure/persist rollback, root-only scan, missing-root structured error, fixture Unicode scan, junk/byte invariance, symlink/non-Unicode skipping, settings symlink rejection, approved-parent replacement rejection and 128-entry progress batches.
- Rust format check and `cargo clippy --all-targets -- -D warnings` passed.
- `pnpm tauri build --no-bundle` **passed** on Apple Silicon, optimized build finished in 1m 47s; executable at `src-tauri/target/release/tag-based-asset-manager`. Installer bundles/signing not tested.

### Limits

Windows/Intel, installers/signing and OneDrive synchronization not tested. Standard path revalidation does not eliminate hostile concurrent filesystem substitution. All Windows reparse entries skipped, including some Files On-Demand placeholders. In-flight scan may finish after removal, but cannot restore removed registration; frontend ignores its result. Large tables not virtualized. All scanned tags empty, no sidecar validation or UUID identity yet.

## UI cleanup before milestone 3 (2026-10-05)

Branch `fix/ui-deduplicate-library-scan`. Sidebar is sole expanded-panel location for active library selector and root path; redundant breadcrumb and library/location summary cells removed. Collapsed sidebar shows library context in header only. Compact summary retains asset count and last scan. Catalog owns one progress strip and one Rescan action; duplicate outer progress, sidebar progress/count, and repeated scanning headline removed. Progress counts use locale formatting.

Verification: three new regression tests failed against duplicates before cleanup, then full 56-test frontend suite and TypeScript/Vite build passed. Browser route-intercepted mock hook exercised scanning, idle, rescan and sidebar-collapse states; screenshots inspected, no JavaScript errors. Mock existed only in scratch browser test, never production app. No backend/filesystem changes or user library scans. Native rebuild/interaction not rerun for this UI-only cleanup. No commits/pushes.

## Milestone 3 — sidecar metadata and single-item tags (2026-10-05)

Branch `feat/milestone-3-sidecar-tags`. No commits or pushes.

### Built

- Strict version-1 per-directory manifest parsing with valid UUIDs/timestamps/string tags/notes, safe direct-child keys, duplicate JSON key rejection and unknown-field preservation.
- Scans load normalized display tags, notes and durable metadata UUIDs; no manifests/UUIDs created during scanning. Missing references retained as rows and original metadata left unchanged.
- New folder self `.` ownership; legacy parent entry honored when self absent; both-present/malformed/duplicate ownership blocks edits rather than merging identities.
- Direct compact Tags editor with colored chips, remove control, typed Enter creation, native datalist autocomplete, click-to-filter and horizontal overflow. Notes/UUID inspector read-only. Deduplicated library/progress/Rescan layout retained.
- `edit_tags` uses approved library/row IDs, successful-scan authorization snapshot, target-entry/owner revision and fresh validation. Tag edits serialized; no optimistic chips or erased failed input. Current-directory duplicate IDs and scan-known conflicts blocked.
- Same-directory temporary write, flush, metadata safety and exact-byte recheck, platform replacement; old file and temporary cleanup verified under injected failure. Existing identity, notes, unknown fields and stale entries preserved. Legacy no-op tag edits do not rewrite original bytes.

### Verification

- **81 frontend tests across 6 files passed**; TypeScript/Vite production build passed.
- **36 Rust tests passed**, including real command-domain first folder/root edits, sibling revisions, stale target/ownership, forged blocked-row revision, symlink escape rejection, copied fixture scan/edit/reload, UUID/notes/asset-byte preservation, malformed/invalid field/duplicate-key rejection and atomic failure cleanup.
- Rust formatting and all-target Clippy with warnings denied passed.
- `pnpm tauri build --no-bundle` passed on Apple Silicon; optimized executable built in 2m 49s, about 4.9 MB.
- Native dev launched with separate verification app-data identifier to avoid scanning/editing user library. WKWebView first-run window screenshot inspected. Accessibility automation unavailable; native picker/tag-write UI not automated.
- Browser isolated hook smoke verified add/remove/filter/inspector/error states; screenshot inspected. Backend mocked only in scratch browser route, no production fallback.
- Seven repository fixture files unchanged byte-for-byte after native tests; mutation tests use temporary copies. No user library metadata edited or uploaded.

### Limits and handoff

Windows/Intel, installer signing and cross-OS OneDrive synchronization remain unverified. Path-based checks and exact-byte preconditions minimize but do not eliminate hostile path swaps/external writes in final check/replace gap. Newly introduced cross-directory UUID duplicates need Rescan; edits do not rescan whole filesystem. Unix manifest hardlinks rejected; Windows rejects symlinks/reparse but hardlink-specific check not implemented. OneDrive conflict-copy auto-detection/merge not implemented. Missing item original kind may be unknown. Bulk tags, notes editing, saved searches, open/reveal/reconnect/export and explicit validation command remain later milestones.

Populated agent worktrees retained locally because project cleanup rule requires committed/pushed agent work and no commits/pushes were authorized. Final reviewed files integrated into primary branch; incomplete prior backend worktree not merged.

## Milestone 4 — bulk tags, filters and saved searches (2026-10-06)

Branch `feat/milestone-4-bulk-saved-searches`; no commits/pushes.

### Built

- Frozen-target bulk review modal: exact selected count, normalized added/removed tags, autocomplete, blocked selection handling, focus trap/Escape. Enter composes draft only; Cancel writes nothing; explicit Confirm invokes native mutation.
- Native preflight for every target before any writes. Shared owner entries grouped into one atomic sidecar replacement; UUID/notes/unknown/stale data retained. On later-folder failure, return completed assets and exact completed/selected count with technical details; no unsafe cross-directory rollback.
- All/Any required tags, NOT exclusions, quoted text, file/folder kind and browse view combine consistently.
- Per-library saved searches create, explicitly update/overwrite, rename preserving stored filters, and confirmed delete. Persist query/view/mode/kind atomically in app-data; legacy settings default missing saved-search list to empty. Malformed settings stay unchanged. Settings commands preserve current catalogue, no hidden rescan.
- Existing single-item editor and deduplicated library/progress layout retained.

### Verification

- Frontend full suite: **121 tests passed across 9 files**; TypeScript/Vite production build passed. Tests cover confirmation-only writes, cancellation, full saved filters, rename/delete, serialization, partial bulk response, busy serialization and stale lifecycle.
- Rust full suite: **45 tests passed**. Grouped-write test proves one replacement for folder self `.` and child together; injected later replacement failure preserves existing sidecar and cleans temp; stale/missing/blocked/duplicate preflight writes zero; preference closure/persist rollback and old-settings migration/reload verified.
- Rust formatting and all-target Clippy with warnings denied passed. Initial rollback test setup omitted active-library assignment; corrected. Six needless borrows fixed without validation changes.
- `pnpm tauri build --no-bundle` passed on Apple Silicon; optimized host executable built in 1m 11s, approximately 5.0 MB.
- Browser smoke over isolated mocked native hook: Enter/cancel zero writes, one explicit bulk confirmation, Any/kind filters, saved search create/rename/reload. Screenshots inspected. No production fallback or user file access in browser test.
- Native picker/bulk/settings UI interaction, Windows/Intel, installer signing and OneDrive synchronization not verified in this milestone. Domain tests use disposable libraries only.

### Limits

Atomic per manifest, not whole library. Earlier completed groups stay saved on later failure. External cross-directory UUID changes need Rescan; path/replace races remain existing limitation. Saved searches are local to this installation/library registration, not synchronized via sidecars. File actions, notes editing, reconnect, export and explicit metadata validation remain milestone 5 work. Agent workspaces retained under project rule requiring committed/pushed changes before cleanup; no commits/pushes authorized.

## Milestone 5 — native actions, validation, recovery and backup (2026-10-06)

Branch `feat/milestone-5-native-recovery-export`; no commits/pushes.

### Built

- Native Rust-only opener/reveal/clipboard actions, approved root + latest scan ID authorization and fresh existing-path checks. Double-click, inspector and context menu dispatch safe enum/IDs, never concatenated shell commands or broad webview filesystem access.
- Fresh read-only validation report for malformed/invalid metadata, missing references, duplicate UUIDs and unreadable directories. Likely metadata conflict copies excluded and reported, never merged/deleted.
- Explicit same-folder reconnect choice/review/confirmation for valid missing metadata. Fresh checks reject stale source, reappeared source, occupied/wrong-folder/linked target, duplicate identity and malformed library states. Exact UUID/tags/notes/unknown fields transferred atomically; asset bytes/paths unchanged. Durable repair followed by failed refresh returns committed rows and visible issue, not false failure.
- Native save-picker JSON metadata backup export to a new destination. Existing/symlink/private destinations refused. Backup includes scanned assets/issues and parsed/exact raw readable manifests; no ordinary asset contents copied. Create-only publication prevents overwriting concurrent destination, cleanup/failure tested. Import deferred.
- UI native-action errors, validation/details, export success/cancel state and missing-entry recovery. Context menu rendered in document-body portal and closes on explicit user wheel/outside/Escape, not layout scroll. Existing dense layout, bulk/saved-search/tag behavior preserved.

### Verification

- **146 frontend tests across 10 files passed**; TypeScript and Vite build passed.
- **64 Rust tests passed**; format check and all-target Clippy with warnings denied passed. Tests use dispatcher/picker/writer abstractions and temporary libraries, never open user assets.
- Native optimized executable `pnpm tauri build --no-bundle` passed on Apple Silicon, release built in 1m 40s. `pnpm tauri build --bundles app` also passed, producing unsigned `src-tauri/target/release/bundle/macos/Tag-Based Asset Manager.app` (5.78 MiB). Signing/notarization/DMG/Windows/Intel unverified.
- Browser route-mocked hook smoke: double-click/context action IDs, validation report/export notice, missing-action disabled state, reconnect review/cancel zero writes then one explicit confirm; metadata visible afterward. Screenshots inspected. Mock only test driver, not production fallback.
- Real-browser smoke found context menu closing from table layout scroll despite unit tests. Portal, `preventScroll` focus and explicit wheel-close fixed it; regression test + smoke passed.
- Native dev compiled/launched under isolated verification identifier, then emitted IPC custom-protocol fallback and stale callback warnings before exit. Actual picker/open/reveal/clipboard/reconnect/export UI interaction **not verified**. Compile/tests do not establish cross-platform acceptance.
- Original fixture bytes preserved; native mutation tests copy disposable libraries. No user metadata edited/uploaded.

### Release limits

First usable MVP code is implemented, but release acceptance still needs Windows 11, Apple Silicon/Intel macOS, locally available OneDrive library and cross-OS synchronization/manual native integration checks. Path-based TOCTOU and external final-check/replace races remain; no automatic matching/hash/conflict merge. New external duplicate UUIDs need Rescan. Export requires hardlink-capable destination filesystem and new filename. Existing asset rename/move/delete, import, notes editing and continuous watcher remain deferred. App-data UI preferences still session-only except library registration/saved searches.

Agent-created workspaces retained per repository rule requiring committed/pushed changes before cleanup; no commits/pushes authorized. Final reviewed files integrated, incomplete prior workspaces not merged.

## Current-folder browsing (2026-10-06)

Branch `feat/current-folder-browsing`; no commits/pushes. The recursive scan remains the approved library index, while the table now projects only direct children of the selected folder. Folder double-click enters in-app; breadcrumbs and Up navigate; filters, counts, tags and scan issues scope to current folder. Root `.` remains addressable for metadata but is excluded from catalog rows and counts. Library display name remains derived from root folder rather than development label; existing virtualized viewport remains bounded.

Verification: full frontend suite **158 tests passed across 11 files**; TypeScript/Vite build passed. Browser route-mocked smoke passed three levels of direct-child browsing, root filtering, folder entry, nested navigation, breadcrumb and Up, with no JS errors. The smoke used an isolated browser hook mock and did not read filesystem. Screenshot `/private/tmp/folder-browse-root.png` visually inspected. Rust/native source unchanged; native folder navigation acceptance not separately run. No user files touched, commits or pushes.

A previous test run showed two failures because filename selectors matched both Name and Path columns; selectors now scope to `.name-cell` and all tests pass. First build flagged unused projection temporaries; removed. Edge review found that successful rescan to empty index retained stale current folder; guard removed and regression added. First smoke targeted a folder as button; corrected it to click the table row and reran successfully. Final full frontend suite **159 tests passed across 11 files**, and frontend build passed.
