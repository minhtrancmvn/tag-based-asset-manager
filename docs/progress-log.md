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

## Catalog controls, Trash and previews (2026-10-06)

Branch `feat/table-folder-up-button`. Up moved to catalog toolbar; sidebar breadcrumbs remain. Folders lead files for every sort column and direction. Stop cancels recursive scan cooperatively during traversal/metadata merge, discards partial/stale frontend responses and unlocks library selection. Scanning remains recursive; lazy current-level scans were explained but not implemented. OS reads already running cannot be interrupted.

Delete UI supports single and multi-selection, with review and explicit confirmation. Native operation uses system Trash / Recycle Bin, never permanent-delete fallback. All targets authorized from successful scan IDs; root/missing/unsafe/overlapping targets rejected; fresh kind/size/mtime checked. Completed targets and descendants removed from authorization snapshot and UI while untouched rows remain usable. Remaining sidecars are preserved for recovery; contained sidecars travel with a trashed folder. Partial failures return completed IDs and error. Actual system Trash/platform permissions remain manual acceptance; automated native tests inject a dispatcher and never trash user data.

Details previews bounded UTF-8 text (64 KiB) and PNG/JPEG/GIF/WebP images (8 MiB) via native approved IDs; unsupported formats explicit, HTML/SVG not executed. Selection/library changes reject late preview display. No broad frontend filesystem permission.

Verification so far: **182 frontend tests across 13 files passed**, frontend build passed, **78 Rust tests passed with one ignored scale benchmark**, formatting and all-target Clippy passed. Isolated real-browser smoke verifies toolbar Up, folders-first, Details text preview, Trash cancel/one-confirm and Stop unlocking picker; screenshots inspected. Final native release rebuild `pnpm tauri build --no-bundle` passed in 3m 12s on Apple Silicon. Broader native/Windows/Intel/OneDrive acceptance remains unverified. Intermediate parallel test timeouts resolved with two test workers; no production timeout changes. Independent review found per-target regular-file substitution gap; per-target kind/size/mtime recheck and deterministic replacement regression now pass. Last validation/OS-call race remains a known path-based limitation. Custom prefixes such as `oole:identity` now display fully under Other; recognized groups still shorten their own prefix. Final frontend count is **183 tests across 13 files**; final Rust count is **79 passed, one ignored**.

Initial Up/Stop commit `d1281ea` is local only; expanded work uncommitted. No user library reads/trash/metadata changes in verification. Theme settings requested for later after core features stabilize; gradient palette reference/backlog recorded in `notes.md`, not implemented here.

## Prefix-derived tag groups (2026-10-07)

Removed predefined Category/Style/Theme/Status/Other groups and their fixed colors. Sidebar groups derive from lowercase text before the first colon, sorted alphabetically; plain tags use their whole name. All prefixes shorten consistently in sidebar while exact full tags remain filter inputs and row/inspector labels. Groups remain scoped to current-folder tags and update when tags change. Generic chip/swatch styling works without CSS classes derived from arbitrary prefixes. Stored tags, metadata and native behavior unchanged.

Baseline 183 frontend tests passed. Thirteen prefix-grouping regressions failed before implementation; full frontend suite then passed **189 tests across 13 files**, including exact-filter, nested-colon, Unicode, folder-scope and live-tag-change coverage. TypeScript/Vite production build passed; Vite emitted plugin timing notice, not a compilation failure. Native/backend tests and browser smoke not rerun for this frontend-only change. No commits/pushes or user library changes.

## Isolated native acceptance (2026-10-07)

Actual Apple Silicon macOS debug Tauri WKWebView launched with unique identifier and synthetic library, using a scratch Vite observer on port 1421. No React/native mocks and no application source/config edits. Seeded app-data bypassed picker UI only; actual Rust scan authorization, IPC and filesystem commands executed. Noncanonical `/var` test path was correctly rejected; canonical `/private/var` registration fixed test setup without weakening authorization.

Verified alphabetical custom/plain/Unicode groups, exact `oole:identity` excluding `oole:identity:brand`, nested-folder `author` group and toolbar Up. Native text preview displayed script-like content literally without execution; 70,000-byte file truncated to 65,536 bytes with notice; invalid UTF-8 rejected and HTML unsupported. PNG decoded in WKWebView. These are debug-mode results, not production CSP/release acceptance.

Single-file Delete Cancel preserved bytes. Review/final confirmation invoked actual system Trash; unique synthetic file found in macOS Trash with matching SHA-256, remaining sidecar unchanged. Exact-path rename restored only that owned file, and Rescan recovered tags and original UUID. Finder Put Back UI, folder/bulk/partial Trash native platform behavior remain untested. Forty thousand synthetic empty files exercised Stop at 256 visited: partial rows discarded, Choose/picker unlocked, no late rows after 1.5-second observation, subsequent Rescan recovered all 11 root rows. Validation passed for 13 assets.

Rust suite **79 passed, one ignored**; isolated native build passed. Default debug build restored afterward and passed in 10.64s. Repository fixture seven-file hashes and all 13 synthetic asset/sidecar hashes matched after restore. Zero observed runtime warning/error/CSP events. App-only screenshot inspected. Owned app/server stopped, synthetic workload/library and separate settings removed; only primary worktree remains. Scratch evidence retained at `/var/folders/d3/47mnxs2x33q95gbms0193hxr0000gn/T/tag-native-acceptance-hk8mhzs3/`, including `acceptance-results.json`, `events.jsonl` and `tag-native-acceptance-window.png`. Accidental full-desktop screenshot removed; only app-window screenshot retained.

Native picker/open/reveal/clipboard/reconnect/export UI, production release WKWebView/CSP, Windows/Intel and OneDrive remain manual acceptance. No commits/pushes or user library/settings changes.

## Release preview policy and bounded acceptance (2026-10-07)

Optimized custom-protocol executable with copied bundled frontend and isolated app-data reproduced raster preview failure: production image CSP omitted `data:` while native preview returned raster data URLs. Original image policy produced explicit decode error with intact catalog in three isolated native runs. Valid native PNG payload decoded after permitting `data:` in `img-src` only. Added config regression test; scripts/documents remain restricted by self-only default, without data or unsafe-inline script sources. No native asset authorization or preview bounds changed.

A separate full-sequence observer timeout/blank occluded window remained with corrected image policy. Instrumented runs and unified WebKit logs show background suspension; scratch-only `backgroundThrottling: disabled` plus foreground activation completed all checks 3/3 with zero observed warning/error/CSP events. Production window policy was not changed; default-background/recovery behavior remains unverified, and this control is not a shipping fix for blank windows.

Control matrix verified prefix grouping/exact filter/folder navigation, native literal text, 65,536-byte truncation, invalid UTF-8 rejection, unsupported HTML, decoded PNG, clean validation of 10 assets and Rescan recovery to eight root rows. App-window-only screenshot inspected. **190 frontend tests across 13 files**, frontend build, **79 Rust tests/one ignored**, fmt and warnings-denied all-target Clippy passed. Instrumented optimized control build passed in 3m 06s. Final default `pnpm tauri build --no-bundle` passed in 3m 47s; diagnostic identifier/assets/window overrides removed from rebuilt executable. Final frontend rerun passed190/13 in28.14s. Fixture7/synthetic10 hashes preserved; owned library/settings and runtime removed. Only primary worktree remains.

Evidence: `/private/var/folders/d3/47mnxs2x33q95gbms0193hxr0000gn/T/tag-release-acceptance-_tv_sbmp/`, including original/compatible-policy native results, `matrix-results-disabled-throttling.json` and `release-awake-window.png`. Scratch receiver method collision and early stale controls caused setup timeouts; corrected before controlled comparisons. No user library/settings access, commits or pushes. Native picker/action/reconnect/export UI, default-background behavior, signed/distribution, Windows/Intel/OneDrive acceptance remain pending.

## Default-policy occlusion recovery (2026-10-07)

Archived optimized custom-protocol executable with corrected image CSP and no background-throttling override was exercised using a temporary `.app` wrapper, separate app-data and recreated synthetic library. Only loopback telemetry differs from production connect-src; frontend remains bundled. Three fresh sessions rendered native PNG/literal text, then a separate owned opaque full-screen window covered the app for 15 seconds. Removing overlay and reactivating app recovered eight-row snapshots in 0.050/0.129/0.111 seconds. Each session then passed exact-prefix filtering, nested navigation, 65,536-byte text truncation, unsupported HTML, decoded PNG, metadata validation and Rescan recovery. Final app active=true; zero recorded runtime warnings/errors/CSP violations; all three app-only screenshots inspected.

OS `NSRunningApplication.hide()` returned false even with temporary wrapper, so attempted Hide runs are explicitly excluded from hide/recovery evidence. Startup activation before process registration also failed before interaction; bounded startup retry corrected driver. Passing tests establish bounded occlusion/foreground recovery, not true Hide/minimize, sleep/wake, long background intervals, or a root-cause proof for earlier blank screenshots. No production code/config or window-policy changes warranted by this run.

Frontend rerun **190 tests across13 files** passed in7.74s; whitespace diff check passed. Synthetic10/fixture7 file hashes unchanged. Owned app/overlay/receiver stopped; recreated library/separate settings/temporary wrapper removed; default release executable untouched. Evidence `background-recovery-occlusion-results.json`, excluded hide/control results and `recovery-{1,2,3}.png` retained in earlier release acceptance directory. No user library/settings changes, commits or pushes. Remaining manual acceptance: true Hide/minimize/sleep/wake, native picker/actions/reconnect/export UI and cross-platform/distribution.

## Native reconnect UI acceptance (2026-10-07)

Actual debug Tauri WKWebView/native IPC tested synthetic missing metadata and Unicode replacement file with separate app-data. Missing-row Open/Reveal/copy actions disabled; reconnect choices excluded already-tagged file and wrong-folder file. Cancel and Review left manifest byte-identical. Explicit Confirm transferred full entry (UUID/tags/notes/unknown custom fields) to selected same-folder untagged `Replacement 世界.txt`, removed old missing key, preserved unrelated entry/manifest unknown field and all asset bytes. Native restart restored transferred tags/UUID/notes. App-only screenshot inspected.

Reveal inspector button completed real native action without error and Finder running; exact Finder selection was not visually verified. Accessibility check returned false, so native picker/save-panel interaction was not attempted or bypassed. Clipboard tests skipped to avoid replacing user clipboard; default-app Open skipped to avoid uncontrolled external application/data state. These remain explicit manual gates, not passed checks.

**190 frontend tests/13 files passed in6.65s**; **79 Rust tests passed, one ignored**. Default debug executable restored with2.95s build. Zero runtime warning/error/CSP events. Repository fixture hashes and synthetic asset bytes preserved; sole intentional metadata change independently verified. Owned app/server stopped; synthetic library/separate settings removed. No application source/config changes, commits or pushes. Evidence `/private/var/folders/d3/47mnxs2x33q95gbms0193hxr0000gn/T/tag-actions-acceptance-gjhxc3wb/`, including `actions-results.json`, synthetic before/after metadata, events and app-only screenshot.

Remaining UI acceptance requires human host interaction: native Choose/cancel and registration persistence, Open/reveal selection/full/relative clipboard, JSON export/cancel/new-file safeguards. True Hide/minimize/sleep/wake, folder/bulk/partial Trash and Windows/Intel/OneDrive/signed-distribution remain pending.

## User-reported manual macOS checks (2026-10-07)

User reports all checks in the supplied manual sequence passed except existing-destination export, which was not exercised because timestamped default filenames produced separate files. This covers picker Cancel/select, Open, exact Reveal, full/relative path copy, export Cancel/new JSON, restart persistence and Hide/minimize recovery as user-reported results, not independently automated evidence. Screenshot shows successful export to disposable `/private/tmp/tag-manual-acceptance.kld93N/` with 11 metadata items included. Follow-up screenshot and user report confirm native save-panel Replace was accepted, then app refused existing path with `Backup destination already exists; choose a new filename`. App-level collision refusal verified manually; original-byte preservation still awaits before/after SHA-256 confirmation. Native panel Replace consent does not override intentional create-only export policy. No export defect established. Sleep/wake, folder/bulk/partial Trash, Windows/Intel/OneDrive and signed/distribution checks remain pending.

## Theme settings (2026-10-07)

Implemented on `feat/app-theme-settings`: app-local `theme` setting with strict values `workshop|coral|lavender|ocean|mint|sunset|stone|midnight`; missing setting defaults to Workshop without migration rewrite. New `set_app_theme` command uses atomic shared settings mutation and restores prior state if persistence fails. All `LibraryState` responses include selected theme. Roots, saved searches, unknown settings, scan summaries and scan authorization are preserved. Top-bar selector is available without a library and with sidebar collapsed; browser-only selector is disabled. Theme updates serialize with other native mutations, apply only committed theme, do not rescan or clear folder/query/selection, and remain app-data only. Eight semantic token palettes include readable dark Midnight; tag/row content stays neutral.

Verification: **209 frontend tests across 15 files passed**, TypeScript/Vite production build passed; **88 Rust tests passed, 1 ignored**, format check, strict all-target Clippy and `git diff --check` passed. Contrast regressions cover text/surface/status/focus pairs. Isolated native WKWebView built/launched using unique app identifier, synthetic library with two inert text files, one saved search and unknown settings sentinel; real native scan showed three metadata entries. Workshop screenshot was captured with existing Screen Recording permission and visually inspected. Native observer did not become ready; controller could not receive commands (HTTP 403) despite scratch-only origin/CSP experiments. No palette selections, theme IPC, changed-settings comparison or restart persistence were exercised. Thus Rust/native command path is unit-tested, but native theme-selection UI acceptance remains unverified. Synthetic app-data and scratch evidence preserved at `/private/tmp/theme-native-acceptance.Q8MgJi/`; no real library/settings touched, no product config/CSP/throttling changes, no commits or pushes. Native UI acceptance harness issue remains release/manual gate.

## Theme native retry and sidebar separators (2026-10-08)

Removed repeating 40px sidebar background stripes that looked like misaligned menu separators; actual header/footer borders remain. Selected row marker uses theme accent. Regression added against repeating sidebar stripes; full frontend suite **210 tests / 15 files** and TypeScript/Vite build passed. Rust rerun **88 passed, 1 ignored**, fmt and strict all-target Clippy passed. Independent review found no confirmed defects after withdrawing an operation-lock claim contradicted by source.

Previous debug-build acceptance executable bundled assets instead of loading Vite observer, explaining absent telemetry. Actual development executable emitted native observer readiness but instrumented page remained blank. A separate copied production bundle with same-origin external observer and loopback-only telemetry connection succeeded: actual WKWebView UI changed through all eight presets, native Rust IPC persisted each value, query and selected row remained intact, and all non-theme settings (including scan timestamp/count), registered root, saved search and unknown sentinel were byte-semantically unchanged. Two synthetic asset hashes matched before/after. Midnight selected-row screenshot visually inspected; sidebar no longer has repeating false separator lines. Evidence `/private/tmp/theme-native-acceptance.Q8MgJi/bundled-retry/matrix-results.json` and `midnight-selected.png`.

Restart preserved `midnight` in isolated app-data, registration, saved search and unknown fields. However restarted instrumented window was blank and observer timed out. Clean copied bundle without observer and with original production CSP also produced blank window; screenshot inspected. Therefore settings persistence is verified, but successful native restart rendering remains unverified and blocks full acceptance. No root-cause attribution to theme or host lifecycle established. Evidence `restart-settings.json`, `midnight-restart.png`, `midnight-clean.png`. Only synthetic test library/app-data used; no user library/settings or production CSP/window-policy changes. Owned app/receiver stopped; default debug executable restoration tracked in task plan. No commit or push.

## Published unsigned prerelease and remaining native checks (2026-10-08)

User explicitly selected publication of unsigned prerelease, not stable release. Existing GitHub release406923852 was published at **2026-10-08T15:27:50Z** as [v0.1.0 — unsigned preview builds](https://github.com/minhtrancmvn/tag-based-asset-manager/releases/tag/v0.1.0), retaining prerelease status and requesting `make_latest: false`. Newly created lightweight tag resolves to exact build source `09fc921e4e11a7ab5a8a586e45720f856e1a1f1c`; no tag moved. Independent API reads verified four asset IDs/names/sizes/digests unchanged, matching preserved local packages/checksum manifest. Notes changed draft/publication wording only; unsigned/runtime limitations retained. No packages rebuilt or production app launched for publication. [Release ledger](../REALEASE.md) records exact artifacts; stable/signed readiness remains NO-GO.

Follow-up native checks used clean source `f1ae63084a08277e3bdfc8f3b7405c9e6c31c2af` (application source identical to published source) and pre-theme source `0cd2e38cfa933ef9c3b5ef98b4821b3ec30a0acb`, rebuilt with fresh identifier `com.tagbasedassetmanager.remaininggates.waizam2a`. Both version0.1.0; isolated rebuilds are not the published production-identifier packages. User registered only new synthetic library through native picker. Asset47bytes and valid sidecar315bytes retained original SHA-256 throughout.

**Native export collision:** User selected exact synthetic existing `collision.json` through actual export save picker. Screenshot and independent accessibility snapshot confirm native error `Backup destination already exists; choose a new filename` and exact path. Before/after destination remains55bytes, SHA-256 `db3dae3077ae52267a87e2871fe3933a7afdd5928660c212225866d54b8bcf0a`; ordinary asset and sidecar hashes unchanged. This closes bounded current macOS native collision-preservation case, not earlier manual destination bytes or Windows picker acceptance.

**Source/settings rollback:** Selected Coral through UI and verified committed settings. Stopped current app, launched pre-theme build with same isolated settings, verified loaded synthetic catalog and absence of theme control. Old Rescan advanced `lastScanAt` from `2026-10-08T15:46:47.148Z` to `2026-10-08T15:51:32.592Z`, retaining root/library ID and opaque `theme: coral`. Stopped old app; current restore rendered catalog and Coral. Separately stopped current app, restored exact settings backup bytes (SHA-256 `49d61240c3a5059ab40d26b1f3a04f3b0a224fae8ea631d21ad64dd9193eb7c6`), then verified current native restart recovered library and Coral. Source/settings reversal and settings-backup recovery passed; signed/versioned/timed installer downgrade and nonempty saved-search mutation remain untested. Search-name automation failed despite AX value-set success and guarded HID attempts; retries stopped, dialog closed, no searches created. Code rollback does not reverse metadata edits or Trash; import still absent.

**Reliability:** Three populated Coral sessions passed startup, minimize/restore and Hide/unhide; hidden intervals5/5/120seconds. Each final Rescan independently advanced settings timestamp; nine app-only screenshots visually inspected. Original production CSP/background policy unchanged; no instrumentation injected into frontend and no blank reproduced. Historical blank-window cause remains unresolved, not fixed. Scoped app-process unified logs retained; healthy-run diagnostics cannot establish a past failure's cause. No new OS sleep, long-duration soak, PNG-preview failure reproduction or Windows/Intel runtime acceptance claimed.

**Cleanup:** All owned rehearsal processes stopped. After hash/ownership checks, removed175task-owned files/22,653,962bytes: old-source copy, temporary current/old app bundles, synthetic library/destination, isolated settings and incidental picker screenshot. Logs, JSON results, nine clean native screenshots, scripts and synthetic settings snapshots retained at `remaining-gates-20261008-wAizAM2A/` under local release-evidence root; publication records under `release-build-6jm1apzo/`. Requested release artifacts, recoverable worktree backups and prior user-expanded app/settings preserved; real libraries untouched. Optional contact-sheet failed because PIL unavailable; no dependency installed, originals inspected directly. Repository unchanged/clean and only primary worktree remained after tests. This later documentation update does not rerun tests or alter application behavior.

## Synthetic OneDrive conflict-copy acceptance (2026-10-08)

Checklist merged/pushed to main8cd35bf; [Windows CI run37767252623](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/37767252623) passed. New fixture created exclusively in empty approved `test-tag-sync`: inert Conflict sample.txt, canonical `.asset-tags.json` tagged acceptance:canonical, and divergent `.asset-tags-conflict-test.json` tagged acceptance:conflict-copy. Screenshot shows one ordinary file row/canonical tag, conflict JSON excluded from catalog, one scan issue and canonical preview/notes. User explicitly confirms expanded scan issue and Validate metadata both report expected conflict warning. Independent SHA-256 checks prove all three bytes unchanged; app performed no conflict merge/delete.

Under standing user cleanup request, removed only three known synthetic files after baseline/type/content verification; approved cloud root left empty. Final result/preservation evidence retained at `/Users/coffeemug/Programming/tag-based-asset-manager-release-evidence/onedrive-conflict-20261008-xfe1jns8/final-result.json`. Later documentation verification found approved root no longer present; cause not established, parent exists, no directory recreated or other cloud contents inspected. This verifies detection/preservation of a synthetic noncanonical sidecar on local OneDrive path, not actual OneDrive conflict generation, second-device/cross-OS sync, placeholder behavior or cloud deletion delivery. No source changes or release publication; real libraries/settings untouched. Remaining platform/signing/reliability gates retained in [release readiness](release-readiness.md).

## Consolidated release acceptance snapshot (2026-10-08)

[Release readiness](release-readiness.md) now consolidates exact verified/deferred gates against main95a287a. [Windows main run37763555390](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/37763555390) passed tests/build/fmt/strict Clippy/unsigned NSIS. Branch-run installer hash recorded below is not assumed to be main-run artifact hash. Intel x86_64 cross-build passed but hardware runtime remains unverified. Populated Coral native startup5/5 and120-second app-hidden recovery passed with screenshots and six unchanged hashes; separate explicit Rescan timestamp transition proved scan commit. Original repeated-ready predicate did not prove every scan commit. Manual label/dialog and sleep/wake passes are user-reported; OS sleep chronology/preview retention not independently established. Evidence lives outside repository in release-evidence recovery/intel/windows directories.

User-approved OneDrive `/Users/coffeemug/Library/CloudStorage/OneDrive-Personal/test-tag-sync` was initially empty. Created three inert Unicode/nested assets and two sidecars exclusively. User reports native scan, single-tag edit, nested navigation, sync-status and restart passed. Independent hashes show all ordinary assets unchanged, nested sidecar byte-identical, root sidecar only adds status:checked on Sync sample.txt plus timestamp; UUIDs/notes/unknown fields preserved. Evidence `onedrive-20261008-_swdwhww/manual-result-verification.json`; cloud sync is user-reported, second-device/cross-OS/placeholder/conflict tests remain open. Synthetic synced files subsequently removed under explicit test-data cleanup request; approved cloud root left empty, unrelated cloud files untouched. Local deletion verified; cloud deletion delivery not independently verified.

pnpm audit reported0 advisories; installed cargo-audit0.22.2 reported0 vulnerability entries and2 informational GTK warnings (unmaintained proc-macro-error, unsound glib), absent resolved macOS arm64/Intel graphs; not full security sign-off. Isolated no-sign bundle fails strict signing/Gatekeeper checks as expected distribution blocker. Windows manual acceptance deferred by user; signing/notarization deferred until Developer account available. Historical blank startup cause, forced native partial failure and platform/sync edge cases remain open. Public distribution remains NO-GO; no release authorized. This documentation consolidation changes no source behavior and does not publish test installers.

User-requested post-acceptance cleanup: removed94 task-owned files/30,838,118bytes (inactive app copies, Intel test app, downloaded unsigned Windows installer/validator, synthetic local library, five OneDrive test files/nested directory, redundant harness/empty logs/summary copies). Retained final evidence files were hash-verified; all11 recoverable worktree backup files unchanged. Active rebuilt app and user-expanded app-data preserved after finding a non-test registration; real library files not accessed. Approved OneDrive root remains empty; cloud deletion delivery unverified. Cleanup manifest/results retained in onedrive evidence directory. No source behavior changes, commits/push or release publication in this consolidation.

## Windows CI and traversal fixture correction (2026-10-08)

Added `.github/workflows/windows-checks.yml` on `ci/windows-release-checks`: GitHub-hosted Windows runner, Node24/pnpm12.4.2, stable Rust, locked dependency installs/tests, frontend JUnit/build, Rust fmt/tests/strict Clippy and unsigned NSIS installer. Actions pinned to reviewed commit SHAs; read-only contents permission, checkout credentials not persisted, concurrency cancellation,45-minute timeout and14-day log/installer artifacts. No release publishing or signing credentials. Local actionlint and frontend211/Rust88+1ignored/build/fmt/Clippy passed before approved workflow commit561d303/push.

First Windows run37753762418 failed `export_cancel_writes_nothing_and_existing_destinations_are_never_overwritten`; diagnostic commit0159c24/run37757152265 then failed explicit ParentDir fixture precondition. Canonical Windows verbatim root joined with ../escape.json had normalized into legitimate sibling JSON destination before export validator invocation. This was test construction error, not production safety bypass. Approved test-only commitd89f951 builds raw path with OsString/native separator and retains ParentDir/rejection/existing-byte assertions; production export logic unchanged. Windows RED diagnostic and subsequent full GREEN verified; no test disabled or security check relaxed.

[Successful Windows run37758578777](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/37758578777) at d89f951: **211 frontend tests**, **76 Rust tests passed / 1 pre-existing ignored benchmark**, type/build/fmt/strict Clippy and unsigned NSIS build passed. Logs/JUnit and installer artifacts downloaded to separate untrusted directory, never executed. Installer `Tag-Based Asset Manager_0.1.0_x64-setup.exe`,2708064bytes; PE header valid; SHA-256 matches runner `6af1774686219524f0a19214de072a0775153b43f29ed0eab3358ee0e4d5d77c`. Evidence `/Users/coffeemug/Programming/tag-based-asset-manager-release-evidence/windows-readiness-20261008-vq3zrj1z/windows-final-verification.json` and downloaded logs. Windows-specific tests differ from macOS because Unix-only cases are naturally gated; neither CI nor artifact checks establish native installer/picker/WebView2/Recycle Bin UI acceptance. User defers Windows manual testing; notarization deferred until Developer account available. Intel cross-build passed separately but hardware runtime unverified. OneDrive/cross-OS sync and forced native partial-failure remain open. Historical intermittent blank startup cause not claimed fixed. No main merge or release publication at this recording.

## Manual Trash report and inspector label clarification (2026-10-08)

User reports remaining supplied manual checks passed except ambiguity between toolbar Delete selected and inspector Delete. Screenshots show two selected rows, bulk toolbar, and inspector action opening a one-item dialog for the displayed file. This is existing intentional scope, not lost selection. Approved clarification changes inspector label to **Delete this item** and tooltip to **Move this item to Trash / Recycle Bin**; `requestDelete(selected, false)`, bulk/context targeting, native API and two-step confirmation unchanged.

Regression written/executed RED for missing explicit label, then GREEN; multi-selection test requires dialog and final dispatch contain only displayed Second.stl and verifies no dispatch before final confirmation. Full frontend **211 tests / 15 files passed in6.30s**, TypeScript/Vite build passed1.29s, whitespace check passed; independent source/test review found no defects. GitNexus upstream App impact LOW with zero indexed callers/processes; index limitations noted. Rust unchanged; prior88/1ignored remains last Rust verification, not newly rerun. No refactor needed for this bounded wording change. Current open native acceptance app is prior build; updated label has component/build validation, not fresh native visual acceptance.

Manual results remain user-reported, not blanket release/platform sign-off. Independent post-report SHA-256 checks confirm root `.asset-tags.json`, keep file and both bulk files at original library paths match baseline. Folder remains absent from library; exact known `~/.Trash/folder-r58bwlu7l` contains nested.txt and contained sidecar, both byte-identical to baseline. No other Trash contents read or modified; no restoration performed by agent. Folder Put Back and fresh Rescan/UUID/tag recovery still need verification. Native forced partial failure not exercised; existing injected tests remain separate. Evidence: `manual-trash-after-user-report.json`, `manual-folder-trash-verification.json`, `inspector-label-red-corrected.log`, `inspector-label-green.log`, `inspector-full-tests.log`, `inspector-build.log` in durable release evidence directory. No commit, push or release publication.

Follow-up: user restored folder through system file manager and reports successful Rescan. Independent SHA-256 confirms restored nested.txt and folder sidecar match baseline, preserving folder/nested UUIDs/tags; root sidecar and keep file also unchanged. Both bulk files are now absent at original paths after user deletion. Screenshot shows four catalog rows and two scan issues, consistent with preserved missing metadata rows for deleted bulk files, not four existing filesystem assets. Exact issue text not visible because issue section is collapsed; expand it to confirm missing references rather than treating screenshot count alone as a new defect. Bulk-file restore/Rescan remains next recovery check. Evidence `manual-trash-restored-folder-check.json`.

Bulk recovery continuation: on explicit proceed, verified only the two exact disposable bulk-file paths in system Trash against original SHA-256, then restored them to absent original destinations with create-only hardlinks and removed only the verified Trash sources. No overwrite or unrelated Trash access. All six baseline files now exist in disposable library and match original bytes, including both sidecars/UUIDs/tags. This verifies byte recovery, not Finder Put Back UI. Existing owned app PID22530 exposes only AXApplication and no Rescan control even after activation; native Rescan/zero-issue UI remains manual/unverified. No process force-quit/restart or permission request. Evidence `bulk-recovery-precheck.json`, `bulk-restoration-results.json`, `bulk-restored-native-state.json`.

Final recovery screenshot/user confirmation: native Rescan shows all four root rows, restored folder with acceptance:folder, both bulk files and untouched sibling with acceptance:trash, Needs attention0 and no scan-issue panel. Together with six matching baseline hashes, normal folder/bulk Trash and byte/metadata recovery acceptance is verified through combined manual screenshot and independent filesystem evidence. Bulk restoration used create-only filesystem recovery, not Finder Put Back; forced native partial failure remains untested. No further source changes, commits or pushes.

Commit-preparation verification: fresh frontend211/15 passed5.75s, Rust88/1ignored passed0.62s, TypeScript/Vite build, fmt, strict Clippy and diff check passed. Rebuilt isolated optimized `.app` with label change. First acceptance script stopped prelaunch because Finder added `.DS_Store`; preserved/ignored only that metadata file while still requiring all six baseline files unchanged. Two bounded owned-PID row-click attempts loaded four tagged root rows/Needs attention0 but timed out before inspector label/dialog; no final delete confirmation, all baseline hashes unchanged. Therefore rebuilt native startup is verified, label/dialog native visual acceptance remains manual; component regression is passing. Owned retry apps stopped, original user test app not force-quit. Evidence `precommit-frontend.log`, `precommit-rust.log`, `precommit-build.log`, `precommit-clippy.log`, `label-native-build.log`, `label-native-results.json`. GitNexus detects five expected changed files with low risk/zero affected processes but stale indexed symbols; actual diff reviewed. No files staged, no commit or push.

## Release-readiness continuation (2026-10-08)

Verdict: **NO-GO for distribution**. Continued all three requested areas without source/config changes, real library/settings access, new permissions, commits or pushes. Earlier temporary release evidence disappeared between continuations; do not treat it as currently inspectable. Fresh evidence is retained outside temporary storage at `/Users/coffeemug/Programming/tag-based-asset-manager-release-evidence/release-20261008-58bwlu7l/`.

**Startup/recovery:** Built clean optimized arm64 app with original production CSP/window policy and separate identifier `com.tagbasedassetmanager.releasecheck.r58bwlu7l`. Three fresh launches reached complete no-library first-run UI; actual Hide/unhide and AX-confirmed minimize/restore completed in all three, with six app-only screenshots visually inspected. An additional disposable installation copied from DMG launched and recovered with complete first-run UI. These checks cover empty registration/Workshop only, not populated-library recovery, long background or sleep/wake. Historical Midnight blank restart remains unexplained, not fixed. Current clean stderr logs and accessibility snapshots are not browser console/error telemetry. Initial driver raced process registration; later screenshot helper crashed with `CGS_REQUIRE_INIT`; initializing `NSApplication.shared` fixed the helper, not product code. Evidence: `visual-results.json`, `first-run-{1,2,3}.png`, `restored-{1,2,3}.png`, `installed-results.json`, `installed-first-run-1.png`.

**Trash:** Native Choose button opened actual picker, but bounded owned-foreground Go to Folder attempt failed with `Native path field did not accept text`. Picker canceled and owned app stopped. No disposable library registered through picker; no folder/bulk Trash operation executed, no native authorization bypass. Four disposable file SHA-256 values unchanged. Existing Rust second-dispatcher-failure/preservation tests and frontend completed-target tests pass, but do not establish real OS partial-failure/restoration acceptance. TRASH-01 through TRASH-04 remain manual/native gates for folder/bulk/partial scenarios. Evidence: `native-results.json`, `asset-baseline.json`, full regression logs. Do not induce failures using valuable files or add a production fault-injection API.

**Platform/distribution:** Fresh unsigned/ad hoc `.app` and `.dmg` built locally with isolated identifier. `hdiutil verify` reports VALID; read-only mounted DMG app matches built app, disposable install copy matches DMG byte-for-byte, `/Applications` link present. DMG SHA-256 `e4a4b208a49fb03a087530b613dc593796031950cddf531a296a30be1d841e7e`. This is local packaging/copy/launch acceptance, not signed distribution or Gatekeeper/quarantine acceptance. Host macOS 27.0 arm64; only `aarch64-apple-darwin` Rust target installed; `security find-identity` reports zero valid identities. Signature ad hoc, TeamIdentifier absent, resources unsealed. Developer ID signing, notarization, stapling, Windows 11/NSIS, Intel runtime and OneDrive/cross-OS sync remain blocked/unverified. Real cloud files untouched. Evidence: `native-build.log`, `dmg-verify.log`, `signature.log`, `dmg-results.json`.

Fresh regression gates: **210 frontend tests / 15 files passed in 6.20s**, TypeScript/Vite build passed, **88 Rust tests passed / 1 pre-existing benchmark ignored in 0.71s**, fmt and strict all-target Clippy passed. Full named-test/build logs retained in evidence directory. Only primary worktree remains. Owned native apps stopped, owned DMG detached, diagnostic bundles/data preserved. Release sign-off not given; no release published.

## Bounded foreground restart investigation (2026-10-08)

Historical blank restart not reproduced in six fresh launches of the same archived bundles and unchanged Midnight setting: clean bundle **3/3** rendered full UI, both synthetic rows and saved search; instrumented bundle **3/3** returned real native DOM snapshots with Midnight selector, `data-theme="midnight"` and `--floor: #171d24`. App-only screenshots inspected. Clean stdout/stderr empty; instrumented telemetry captured zero window errors, unhandled rejections, console errors or CSP violations. Synthetic asset hashes unchanged; theme/registration/searches/unknown settings preserved, only normal startup scan `lastScanAt` changed.

This verifies bounded foreground restart acceptance, not a fix or explanation for earlier blank screenshots. Foreground activation/lifecycle timing remains an unconfirmed hypothesis. No deterministic RED reproduction, no production source/config/window-policy change justified. Historical blank remains unresolved intermittent release risk. Evidence in earlier bundled-retry folder: `restart-reproduction-results.json`, `restart-{1,2,3}.png`, `runtime-retry-results.json`, `runtime-3.png`, `restart-investigation.json`. Owned apps/receiver stopped; synthetic app-data and diagnostic evidence retained. No real user library/settings accessed, permission changes, builds, commits or pushes in this investigation.

## Gradient theme revamp acceptance and v0.2.0 authorization (2026-10-09)

The approved gradient-theme feature replaces the eight-name native selector with a toolbar popover containing twenty full themes: the existing eight preset IDs remain valid with redesigned palettes, twelve IDs are added, and treatments include fourteen light and six dark themes. Workshop remains the default. Swatch gradients identify themes; coordinated semantic tokens preserve readable catalog surfaces. Theme persistence uses the existing native settings operation and applies only committed state; theme selection must preserve the active library/catalog session and leave asset/sidecar bytes unchanged.

Automated feature-source verification passed: **248 frontend tests across 15 files**, Rust **88 passed / 1 ignored**, TypeScript/Vite production build, Rust format check and strict all-target Clippy. Isolated Apple Silicon macOS `feedback-matrix-results.json` records all twenty theme commits and catalog/settings/asset/sidecar preservation; `settings-after-theme-matrix.json` records final Aurora. Minimum-window geometry records 820×600. Validation report records Right Arrow focus-only, Return commit, and Escape trigger-focus restoration; the exact Tab destination was not captured. The archived task plan remains unchecked at setup despite later matrix outputs and validation report; rely on dated results/report for completed checks. Windows native UI acceptance remains unavailable. These are feature-source/native synthetic checks, not v0.2.0 package acceptance; fresh release build and CI evidence remain pending. Full results are archived at `theme-native-20261009-q4FEamMu/` in the local release-evidence archive.

User authorized PR-based preparation and publication of unsigned prerelease **v0.2.0**, not stable. No v0.2.0 PR, merge, package or release exists at this snapshot. Signing/notarization, Windows native acceptance, exact Tab focus destination, Intel runtime, cross-device OneDrive sync and other listed release gates remain open. See [release readiness](release-readiness.md) and [theme backlog/design decisions](product-backlog.md#theme-revamp--gradient-palettes-and-swatch-grid-picker). This documentation records acceptance and authorization only; it does not publish a package or authorize stable distribution.

## v0.2.0 unsigned prerelease publication and verification (2026-10-12)

PR #4 merged; release source is exact commit `f63186fd9db9502266c98320905dd71645c5bd20` (tree `f831a822fb3c0b866a00b01526950ef1e759fe80`). GitHub release [v0.2.0 — unsigned preview builds](https://github.com/minhtrancmvn/tag-based-asset-manager/releases/tag/v0.2.0), release ID `410138488`, published at **2026-10-12T03:52:17Z**. Tag points to exact source commit. Release state: prerelease=true, draft=false, latest=false; latest endpoint returned 404, confirming no stable/latest release designated. v0.1.0 tag, release and assets remained unchanged. Four public asset digests, downloaded byte counts and SHA-256 values match local manifest: Apple Silicon macOS DMG (3,360,926 bytes), app ZIP (3,255,381 bytes), Windows x64 NSIS installer (2,713,054 bytes), and `SHA256SUMS.txt` (328 bytes). Exact hashes and evidence references appear in [release readiness](release-readiness.md) and [release ledger](../REALEASE.md).

Exact-source checks: macOS frontend **248 tests / 15 files**, Rust **88 passed / 1 ignored**, TypeScript/Vite build, Rust fmt and strict Clippy passed. Windows [main CI run 38197210176](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/38197210176) passed on the exact commit: frontend 248, Rust **76 passed / 1 ignored**, build, fmt, strict Clippy and unsigned NSIS packaging. Local arm64 macOS bundle reports identifier `com.tagbasedassetmanager.desktop`, bundle version/short version 0.2.0, minimum OS 10.13; DMG and ZIP integrity checks passed. Windows installer PE header is valid and runner checksum matches; bootstrapper machine is x86, CI output records x64 payload target, which was not independently extracted. Production macOS package and Windows installer were not launched. These results verify packaging and CI, not native package runtime acceptance.

The feature-source isolated macOS theme matrix remains bounded evidence: twenty selections, Aurora restart, minimum 820×600 layout, Right Arrow focus-only, Return commit and Escape dismissal/focus restoration passed. Exact Tab focus destination and Windows native UI remain unverified. Intel hardware, cross-device/cross-OS OneDrive, signing/notarization, startup reliability, partial native Trash failure and stable sign-off remain open. v0.2.0 is unsigned prerelease only; stable release remains NO-GO. 3MF preview/Space shortcut remains proposed backlog, not implemented in v0.2.0. No new source behavior or runtime capability was added by this record.

## Tag and prefix-group rename (2026-11-04)

Implemented on branch `feat/tag-rename` from base `64b5c55`. Nothing is committed, pushed, merged or released, and no release or Store acceptance is claimed. Design and plan were approved by the user, then re-reviewed after one amendment: saved-search query rewriting moved to the TypeScript parser, so native code never parses queries.

### Built

- Native `preview_tag_rename` and `apply_tag_rename` in `src-tauri/src/tag_rename.rs`: fresh cancellable read-only whole-library preview, native-held preview and in-memory settings-retry state, all-target preflight, one atomic write per owning sidecar committed in order, exact committed/failed/unattempted partitions, and bound saved-search replacements persisted only after every eligible sidecar commits.
- Frontend: `src/tagRename.ts` (mapping normalization, query rewrite, blockers), hook operations in `src/useLibrary.ts`, `src/components/TagRenameDialog.tsx`, and sidebar tag and prefix-group menus in `src/App.tsx` reachable by right-click, the context-menu key and Shift+F10. Unresolved outcome notices block update installation.
- Shared fixtures `fixtures/tag-rename-mappings.json`, `fixtures/tag-rename-queries.json` and `fixtures/tag-rename-dto.json`.

### Verification

Last full run on the final source:

- `pnpm exec vitest run`: 897 tests passed in 23 files.
- `pnpm exec tsc --noEmit` and `pnpm build`: exit 0.
- `cargo test`: 284 passed, 1 ignored.
- `cargo fmt --check`: exit 0. `cargo clippy --all-targets -- -D warnings`: clean.
- `git diff --check`: exit 0.

An independent source review found no blocking product defect. It found a `#[cfg(unix)]` attribute placed on a helper instead of the symlink test it guarded, which would have broken the Windows test compile; merge disclosure for migrated searches missing from the dialog; a second rename request reachable by keyboard while the dialog was open; wording of native rejections that the dialog matches by regular expression with no guard; and a brittle command-count assertion. Each was fixed in source. All but the Windows compile fix are covered by passing tests, including a Rust test that reads the dialog source to pin the rejection wording; the Windows fix is unverified (see below).

### Unverified

- All interface evidence is jsdom. No application launch, WKWebView run, real-library run, Windows 11 run or Intel macOS run has happened. The 1 s duplicate-`contextmenu` guard is proven only against synthetic events. See the [rename acceptance cases](manual-test-plan.md#tag-and-prefix-group-rename-acceptance).
- The `#[cfg(unix)]` fix could not be verified on the development host: `cargo check --all-targets --target x86_64-pc-windows-msvc` fails in the `ring` build script (`assert.h` not found) before this crate compiles. A real Windows build, from the Windows checks workflow, is outstanding.

### Accepted limits

- The settings-retry proof is in memory only. It ends when the app closes, the library is removed or a later rename overwrites it; dismissing the notice does not clear it. No persisted retry exists, and no native command discards the proof.
- An unresolved partial or settings-failed notice blocks update installation. A partial rename whose rows keep failing blocks updates until the library is switched or the app restarted.
- No undo and no cross-directory or sidecar-plus-settings rollback. Skipped-row lists cannot be copied as text.

## macOS native acceptance of v0.5.1 and in-app confirmations (2026-11-06)

Apple Silicon, macOS 27. The user ran M2-01 to M2-11 by hand on the installed 0.5.1 release. Claude Code ran the rest of the macOS plan on an isolated build of the v0.5.1 source (`a309b00`). That build has its own bundle identifier and app-data folder, and was used only on disposable library copies. It drove the real WKWebView interface through the accessibility API and synthetic input, and checked each case against file hashes, sidecar and settings bytes, and screenshots. It is the release source, not the signed release binary, so in-app update, Gatekeeper and quarantine behaviour are not covered.

### Results

All 116 cases in the [manual test plan](manual-test-plan.md) have a recorded result:

| Result | Count | Cases |
|---|---|---|
| Passed | 92 | |
| Passed with a note | 14 | Notes below |
| Partial | 2 | RENAME-01, RENAME-03 |
| Failed on v0.5.1 | 2 | M2-06, M4-11 (fixed below) |
| Not run | 5 | M3-17, M4-14 (saves finish too fast to see the busy state; need a slow filesystem); PLATFORM-04 to 06 (need a disposable OneDrive folder) |
| Not applicable | 1 | M4-04: the folder-level catalog never shows a folder and its own child together |

All tag-rename cases ran natively for the first time. RENAME-12 and RENAME-13 injected the write failures into disposable copies only. RENAME-14 used an updater-enabled 0.5.0 build of the same source against the live 0.5.1 feed. It showed that an unresolved rename notice blocks installation, but Install was never clicked. RENAME-16 cancelled a running preview on a 96,000-file library.

### Failures: confirmations that never asked

- **M2-06:** **Remove library registration** removed the library at once, with no confirmation, and deleted that library's saved searches with it.
- **M4-11:** **Delete…** on a saved search deleted it at once.

In both cases no files or sidecars changed.

**Cause:** `tauri-plugin-dialog` 2.8.1 injects a script that replaces `window.confirm` with an async function. `if (!window.confirm(...))` then tests a Promise, which is always truthy, so the check never stops the action. The frontend has no dialog permission, so no prompt appears either. jsdom keeps the synchronous browser `confirm`, so the interface tests passed.

**Fix:**
- Remove library registration now opens an in-app dialog (`src/components/RemoveLibraryDialog.tsx`). It states that files and folders are not changed and how many of the library's saved searches will be deleted. Focus starts on Cancel; Escape and a click on the backdrop cancel.
- Saved-search **Delete…** now shows an in-app second step inside its dialog, with **Keep search** and **Delete search**. Escape at that step returns to the dialog and does not close it.
- The tests now stub `window.confirm` the way the plugin does. `src/nativeDialogs.test.ts` fails if app source calls `window.confirm`, `alert` or `prompt`. Against the old source the new tests fail, and the guard names both call sites.
- No dialog permission was added; frontend dialog grants stay out of scope.

**Re-test on an isolated build of the fix branch:**
- **M2-06 passed.** The library had 3 saved searches, and the dialog said so. Cancel and Escape each left settings byte-equal. Confirm removed only that library and its searches; other libraries and searches were unchanged, and the library's files had no changes.
- **M4-11 passed.** Delete… kept the search stored. Keep search and Escape each kept it and the dialog. Delete search removed only that search; the other searches were byte-equal.

The user's earlier manual pass of M2-06 on the installed release conflicts with this result. That release was built from the same source and lockfile, so it is expected to have the same defect.

### Partial cases

On macOS the PC keyboard's context-menu key reaches WebKit's own menu, which offers only "Reload", instead of the tag rename menu (RENAME-01 and RENAME-03). Right-click and Shift+F10 open the app menu and close it correctly. Apple keyboards have no such key. Windows WebView2 is unverified.

### Findings not fixed here

- The first Trash move asks macOS for permission to let the app control Finder, which is how the `trash` crate moves items.
- A Trash rejection for a file changed since the scan also says "Some items may already be in Trash / Recycle Bin", even when nothing moved.
- Quoted path search is sensitive to Unicode normalization: `"café"` typed in composed form (NFC) misses a name that macOS stores decomposed (NFD). Exact names, clipboard copies and sidecar keys keep the decomposed form.
- One invalid saved search in settings makes startup refuse the whole settings file, so every library disappears until the file is fixed. The original bytes are preserved.
- In the Figures test folder, "Needs attention" showed 2 while listing one row.
- The first scan of a legacy settings file that has an active library writes `"theme": "workshop"` into the file.
- Tab from a theme swatch closes the picker and moves focus to the page itself, not to a control.
- The Export JSON save panel opens in the library folder.
- The release build shows WebKit's default text menu (Look Up, Translate and similar) on right-click outside app menus.
- Re-adding an existing tag does nothing and leaves the text in the field, with no message.
- Choosing a sidebar view resets the query, match mode, Kind filter and selection. This is by design.

### Still open

- Windows 11 native acceptance.
- Intel macOS.
- OneDrive (PLATFORM-04 to 06).
- A real in-app upgrade from 0.5.0.
- Gatekeeper and quarantine behaviour of the downloaded package.
- The context-menu key on Windows.
- M3-17 and M4-14 on a slow filesystem.

## Microsoft Store MSIX package (2026-11-07)

PR #16 adds a Microsoft Store edition. Builds compiled with `TAG_ASSET_MANAGER_STORE_BUILD=1` refuse the in-app update check and install before any network request; the Store installs their updates. The edition uses its own Tauri identifier (`com.tagbasedassetmanager.store`), so its settings stay separate from the GitHub copy. The manual workflow **Microsoft Store package** packs an unsigned MSIX for Partner Center and test-signed `.0`/`.1` copies for sideloading. Package identity comes from Partner Center: the `Publisher` derives the given package family name, and the account owner confirmed `DisplayName` and `PublisherDisplayName`. Details and the test are in [Microsoft Store edition](microsoft-store.md).

Verification:

- macOS: `cargo fmt --check`, strict Clippy, 285 Rust tests (1 ignored) on a clean checkout, 902 frontend tests, actionlint on all workflows.
- GitHub Actions on `windows-latest`: Windows checks and the Store package workflow green on commit `64204c7` (run 42238367518). The downloaded artifacts were checked: checksums, identity, versions `0.5.2.0`/`0.5.2.1`, upload package unsigned, test copies signed by a certificate whose subject matches the publisher.
- Windows 11 x64, the account owner's PC: STORE-01 to STORE-10 all passed, as reported by the account owner. This is the first native Windows run of the app. It covered a fresh start, the Store update message, folder picker and scan, tagging with restart, open/reveal/copy, JSON export, Recycle Bin delete, in-place upgrade from `.0` to `.1`, side-by-side with the GitHub copy, and uninstall keeping library files.

Not done: Partner Center upload and certification; the GitHub NSIS installer and the rest of the manual test plan on Windows; Windows 10.

2026-11-08: the first Partner Center upload of `0.6.0.0` (Store package run 42420532367 on `eb420bc`) failed package acceptance: "The PublisherDisplayName element in the app manifest of Tag-Based-Asset-Manager_0.6.0.0_x64.msix is Minh Tran, which doesn't match your publisher display name: kaishj91." The name `Minh Tran` is taken in Partner Center, so the manifest now uses `kaishj91`, the account's publisher display name. The rebuilt `0.6.0.0` package (Store package run 42422444473 on PR #17) passed Partner Center's upload validation, as reported by the account owner. Certification is pending.

2026-11-09: Submission 1 (`0.6.0.0`, Store package run 42422444473) passed Microsoft certification and is published on the Microsoft Store, as reported by the account owner. The Store copy updates only through new submissions; GitHub releases after `0.6.0` (currently `0.7.0`) do not reach Store users until a higher version is submitted.

## Usage analytics: shared contract and Worker (2026-11-11)

Branch `feature/usage-analytics` adds opt-in usage analytics, as specified in [the design](design/usage-analytics.md) and [the ADR](../adr/usage-analytics.md). Nothing is sent unless the user opts in. This first wave adds:
- the shared allowlist `usage-events.json`;
- one golden request body per event in `fixtures/usage-payload.json`;
- the Cloudflare Worker in `usage-proxy/`, which validates each event and forwards it to Google Analytics without the user's IP address or headers.

Before any code, a test property (563333501) showed that Google Analytics' standard reports work for Measurement Protocol events:
- event count, users, sessions and country;
- every custom dimension;
- device category and operating system.

An event sent from Vietnam with `user_location.country_id` set to `JP` showed Japan, with no city, so the country comes from the request body, not the sender's IP address. Retention is 14 months for event and user data, with reset on new activity off. Granular location and device data collection is off.

Wrangler: `4.154.0`, published 2026-10-27, which is at least 14 days before first use on 2026-11-11. It runs through `pnpm dlx --allow-build=esbuild --allow-build=workerd wrangler@4.154.0`, so the app's lockfile doesn't change. pnpm 12 blocks the install scripts of those two dependencies unless they're allowed by name. `deploy --dry-run` bundles the Worker (7.63 KiB) with the rate limit and both variables bound.

### Rust core (2026-11-11)

The usage module (`src-tauri/src/usage.rs`) and the consent setting are in place.
- **Not active in any build yet.** The frontend doesn't call `track_usage` or `set_usage_consent` yet, and no build carries an endpoint, so nothing is asked or sent.
- **New dependencies:**
  - `reqwest` 0.13.5 and `rustls` 0.23.46 are now direct dependencies, at the versions and TLS stack the updater already locks. `Cargo.lock` gains only the two dependency edges and no packages; `cargo tree -i native-tls` and `-i openssl` find nothing.
  - `tauri-plugin-single-instance` is pinned to `=2.5.5`, published 2026-10-28, with `Cargo.lock` checksum `726b6da0dd5bd1344f84f4108a622c07d01923baacb5c803a605189672c5352f`. The lock diff adds only that crate; its dependencies were already locked. Version 2.5.4 can leave a second process running on Windows.
- **How the single-instance plugin behaves:**
  - It is registered first, in release builds only.
  - It keeps its lock as an app resource and closes it in `cleanup_before_exit`, after `RunEvent::Exit`, which includes the updater's restart.
  - On Windows that releases and closes the named mutex, and the OS also closes it on any process exit.
  - On macOS it removes `/tmp/<identifier>_si.sock`. A socket left by a crash is cleared on the next launch when the connection is refused.
- **Tests:** strict Clippy (debug and `--release`) and 328 Rust tests pass, 1 ignored, on macOS.
