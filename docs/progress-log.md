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

## Bounded foreground restart investigation (2026-10-08)

Historical blank restart not reproduced in six fresh launches of the same archived bundles and unchanged Midnight setting: clean bundle **3/3** rendered full UI, both synthetic rows and saved search; instrumented bundle **3/3** returned real native DOM snapshots with Midnight selector, `data-theme="midnight"` and `--floor: #171d24`. App-only screenshots inspected. Clean stdout/stderr empty; instrumented telemetry captured zero window errors, unhandled rejections, console errors or CSP violations. Synthetic asset hashes unchanged; theme/registration/searches/unknown settings preserved, only normal startup scan `lastScanAt` changed.

This verifies bounded foreground restart acceptance, not a fix or explanation for earlier blank screenshots. Foreground activation/lifecycle timing remains an unconfirmed hypothesis. No deterministic RED reproduction, no production source/config/window-policy change justified. Historical blank remains unresolved intermittent release risk. Evidence in earlier bundled-retry folder: `restart-reproduction-results.json`, `restart-{1,2,3}.png`, `runtime-retry-results.json`, `runtime-3.png`, `restart-investigation.json`. Owned apps/receiver stopped; synthetic app-data and diagnostic evidence retained. No real user library/settings accessed, permission changes, builds, commits or pushes in this investigation.
