# Product backlog

Items below track feature status and planned work; each item states whether it is implemented or remains proposed. Release acceptance gates stay in [release readiness](release-readiness.md); build artifacts stay in [REALEASE.md](../REALEASE.md).

## THEME-REVAMP — Gradient palettes and swatch-grid picker

**Status:** Implemented, validated on feature source and published in unsigned prerelease v0.2.0 on 2026-10-12. Exact merged source: [`f63186fd9db9502266c98320905dd71645c5bd20`](https://github.com/minhtrancmvn/tag-based-asset-manager/commit/f63186fd9db9502266c98320905dd71645c5bd20). Automated checks and isolated macOS native acceptance passed for feature source. Windows native UI, exact Tab focus handoff and signed distribution remain open; no stable/all-platform acceptance implied.

### User request

Revamp theme styling/color theming to follow supplied gradient reference. Replace current native dropdown list of theme names with a grid of gradient swatches that users can select.

### Visual direction

Reference is a four-row, five-column set of rounded gradient tiles: vivid coral/magenta, violet/blue, deep navy/teal, mint/aqua, orange/pink, pastel gray/blush, sky/cyan, indigo, burgundy/red and multicolor variants. Swatches use soft blended color transitions rather than flat single-color chips. Reference suggests visual direction, not a requirement to ship exactly twenty themes or reproduce an operating-system menu.

### Proposed acceptance criteria

- Theme control opens an in-app grid of rounded gradient swatches instead of the current native name-list dropdown.
- Each swatch represents a real theme and applies coordinated semantic colors across sidebar, toolbar, catalog, inspector, menus, dialogs, inputs and states—not just a decorative picker preview.
- Swatches show accessible theme names and a clear selected indicator that does not rely on color alone. Keyboard navigation, activation, Escape/dismissal and focus restoration are supported.
- Gradients follow supplied blended styles; dense catalog rows and text remain readable. Use gradients selectively for accent/surface areas, not saturated gradients behind every row.
- Verify text contrast, selected rows, focus indicators, tags, disabled controls and error/success states for every palette. Support readable light/dark treatments as designed.
- Grid fits available window space without clipping or covering inaccessible controls; portal menus inherit applied tokens.
- Selection persists through existing app-local native settings path, with committed-state application, saving/error feedback and rollback on persistence failure. No browser storage fallback.
- Theme changes preserve current folder, filters, selection, sort/layout and catalog; no rescan or asset/sidecar writes.
- Existing stored preset IDs remain valid or receive an explicitly tested backward-compatible migration. Do not silently break legacy settings.

### Resolved design decisions

Approved on 2026-10-09: twenty full themes (all original eight visually redesigned plus twelve new IDs), fourteen light and six dark treatments, responsive five-by-four toolbar popover. Existing IDs and Workshop default retained. Palette/primary-gradient contrast tests and isolated macOS native acceptance passed. Older eight-theme builds cannot read new IDs; downgrade requires selecting an original ID or restoring compatible settings backup.

### Verification status and remaining acceptance

Frontend full suite: **248 tests / 15 files** pass; typecheck/production build pass. Rust: **88 pass / 1 ignored** on macOS; **76 pass / 1 ignored** on Windows CI. Formatting and strict Clippy passed. Palette tests cover twenty themes, semantic text/focus states and sampled primary/sidebar gradients. Signature gradients drive primary actions; disabled primary actions revert to readable solid disabled colors. Sidebar/search disabled text remains on existing parent surface.

Isolated macOS native matrix report records commits for all twenty themes; native settings record final `aurora` and per-theme results report catalog/settings/asset/sidecar preservation. At minimum 820×600 all twenty swatches fit. Validation report records Right Arrow focus-only, Return commit and Escape trigger-focus restoration; the archived task plan remains stale/unchecked despite later results, and raw keyboard snapshots do not independently establish each event. A later Tab event dismissed the popover, but exact focus destination was not captured. Synthetic library/app-data only; Windows native UI/installer acceptance remains unverified. These are isolated-source checks, not package runtime acceptance. v0.2.0 was published as an unsigned prerelease from exact merged source `f63186fd9db9502266c98320905dd71645c5bd20`; downloaded public assets match preserved local manifest. Older eight-theme builds cannot load new IDs; downgrade requires original preset or compatible settings backup.

## NOTES-EDIT — Single-item notes editor

**Status:** Recommendation from product backlog review, not yet approved for implementation.

Current inspector displays notes read-only. Small next-feature candidate: edit one valid existing metadata entry with explicit Save/Cancel, native ID/revision checks and atomic owning-sidecar writes. Preserve UUID, tags, unknown fields, stale entries and browsing state; retain draft on failure. Define empty versus omitted notes/no-op semantics before implementation. Missing/blocked entries remain read-only. No bulk notes, import, rename or moves in this scope.

## MODEL-PREVIEW — 3MF preview and Space shortcut

**Status:** User-requested backlog addition on 2026-10-11; proposed, not implemented or approved for inclusion in v0.2.0.

### User request

Allow previews of `.3mf` files. Press Space on a selected catalog file to preview on macOS, and on Windows when Peek is installed.

### Proposed acceptance criteria

- A valid, locally available `.3mf` file has a real model preview rather than the current unsupported-format message. Define whether preview uses an in-app renderer, an embedded thumbnail or a native preview provider during design; do not assume macOS Quick Look or Windows Peek supports 3MF without verification.
- With catalog focus and one existing file selected, Space opens its preview on macOS. On Windows, support the same interaction when Peek is installed and usable; investigate its supported invocation mechanism and file-type support before choosing an integration.
- Space continues normal behavior in text inputs, tag editing, dialogs, theme swatches and other controls. Preview dismissal restores catalog focus without changing selection, filters or browsing state.
- Missing/blocked files, unsupported or malformed models, unavailable native providers and Windows without Peek produce a clear unavailable/error state; do not silently open an editor, install software or modify file associations.
- Preview stays read-only, resolves approved library/asset IDs in Rust and preserves asset/sidecar bytes. Any 3MF archive parsing needs explicit compressed/uncompressed size and model-complexity limits, traversal checks and no embedded script execution or network fetches.
- Verify macOS and Windows-with-Peek behavior separately, including dismissal, provider failures and 3MF support. No native-preview compatibility claimed before actual platform testing.

## APP-VERSION — Display app build version number

**Status:** Implemented on 2026-10-29; UI/helper tests, full frontend suite and build passed. Packaged-app display not yet manually verified.

### User request

Display the app's build version number.

### Current state

The version is declared in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`; the Release workflow bumps all four together. The topbar shows the runtime native app version; browser preview and native metadata lookup failure show an explicit development/unknown fallback. Display is local-only and requires no settings, library, sidecar or network access.

### Proposed acceptance criteria

- The UI shows its version in an unobtrusive, always-reachable place, selectable as text so it can be copied into bug reports. Implemented in the persistent topbar, including when the sidebar is collapsed. Native packaging runtime not yet manually verified.
- The value comes from the built application at runtime via Tauri app metadata, not a hand-typed string, so it cannot drift from the packaged build. `core:app:default` grants the read-only metadata command.
- Development/browser mode and unavailable native metadata show `Development build · version unavailable`. Prerelease and unsigned labels remain deferred because runtime build provenance is not currently embedded.
- Browser-only development mode shows a clear development/unknown value instead of a fake version.
- No settings, library, sidecar or network access is needed to show it.
- Tests cover the displayed value and the development fallback.

### Deferred

- Source commit (short SHA) alongside the semantic version.

## APP-UPDATES — New-release notification and click-to-install updates

**Status:** Source implementation and local automated verification completed on 2026-10-30; changes remain uncommitted on `feat/app-updates`. Frontend: 355 tests across 21 files plus TypeScript/production build passed. Rust: 110 passed / 1 intentionally ignored benchmark, format check and strict locked all-target Clippy passed on macOS. Release/workflow scripts: 72 tests and actionlint across all three workflows passed; independent native/release/signing-check reviews found no confirmed defects. Standalone non-publishing signing check was committed only to `ci/updater-signing-check` and passed GitHub run 41043606325. Owner uploaded signing configuration: all three repository entries exist and the public key matches the local public file. Public-key-enabled locked/offline native checks and macOS Apple Silicon `.app` build passed; bundle version, identifier, architecture and embedded key were inspected without launching it. Owner-signed local macOS archive passed payload, exact-version and tamper-rejection verification against the repository public key. GitHub signing key/passphrase match configured public key verified by non-publishing Linux CI run 41043606325 on 2026-10-30. Canonical preview feed currently returns HTTP 404; latest v0.4.0 release has no signed updater archive or signature, so newer-version macOS/Windows packaged upgrades cannot yet run. Windows OS artifact signing and live release/feed publication remain unverified gates. SignPath application rejected; Windows OS signing remains unavailable.

### User request

Notify users in the app when a new build is available, with an action that downloads and installs the new version automatically after they click.

### Proposed acceptance criteria

- Check for a newer published release without blocking catalog use, and provide a manual **Check for updates** action. Selected preview channel follows published prereleases, not every CI build or GitHub's stable-only latest endpoint.
- Show the available version and release notes with **Download and install** and **Later** actions. No forced download, installation or restart.
- Show download/install progress and clear offline, download, signature and installation failures with a retry path. Failed checks must not prevent normal library use; invalid signatures must prevent installation.
- Select the correct package for the running OS/architecture, compare semantic versions and reject downgrades by default. Each offered update needs a newer version, not merely a rebuilt binary with the same version.
- Explain required app exit/restart before installation. Finish pending metadata/settings writes, handle unsaved drafts explicitly and stop scans safely before exiting; Windows updater installation automatically exits the app.
- Preserve registered libraries, app settings, assets and sidecars across upgrades. Updates must not scan or modify libraries as part of installation, or send library paths, tags or notes to the update service.
- Keep endpoints and update operations controlled in Rust, with only the narrow UI commands needed for checking, progress and user-confirmed installation; no arbitrary URL/path or general frontend filesystem access.
- Verify newer/no-update, offline/retry, invalid signature, wrong platform, busy/unsaved state and settings/library preservation. Test actual packaged upgrades separately on macOS and Windows before claiming support.

### Implementation direction and prerequisites

- Use the [Tauri v2 updater plugin](https://v2.tauri.app/plugin/updater/) with an HTTPS update feed. GitHub Releases can host the static manifest, platform packages and signatures; a separate update server is not required for this approach.
- Enable updater artifact generation in release builds. Embed the updater public key in the app; protect and back up the private signing key outside source control, using protected release secrets when builds run in CI. Tauri requires valid updater signatures; this verification cannot be disabled.
- Updater artifact signatures are separate from macOS Developer ID signing/notarization and Windows code signing. Existing unsigned prereleases do not establish trusted distribution or verified upgrade behavior; platform signing and installer acceptance remain separate release work.
- Existing installations without updater support need one manual installation of the first updater-enabled version. APP-VERSION can share the version/About surface, but version display alone does not enable updates.

### Selected implementation scope

- Explicit preview channel matches existing prereleases; fixed HTTPS static manifest on the repository's `update-preview` branch, not GitHub's stable-only latest endpoint.
- Topbar manual check plus once-per-launch nonblocking check; only explicit confirmation downloads or installs. macOS Apple Silicon and Windows x64 only.
- Native offer binding, newer-version and exact package URL checks; mandatory version-bound updater signatures. Missing embedded public key disables checks/installation.
- Signing secrets and real packaged/platform acceptance remain release gates, separate from source tests. See [SignPath handoff](signpath-handoff.md) for rejection status.

## TAG-RENAME — Rename a tag from the tag panel

**Status:** Source implemented with automated tests on 2026-11-04; user-requested on 2026-10-21. Not merged or released, and native UI acceptance on macOS and Windows has not been run. Release and Store acceptance are not claimed. See [Implementation status](#implementation-status-2026-11-04).

### User request

Allow right-clicking a tag in the tag panel and selecting **Rename** to rename it. Once renamed, existing files and folders carrying that tag are updated accordingly.

### Starting state (before implementation)

The sidebar **TAGS** panel lists tags grouped by `prefix:` with counts; tags are filter buttons only and have no context menu. Tags live in per-directory `.asset-tags.json` sidecars and are normalized on write (trimmed, lowercased, deduplicated, sorted). Bulk tag edits already preflight all targets, write once per owning sidecar and report completed items plus an error on later failure, with no cross-directory transaction or rollback.

### Proposed acceptance criteria

- Right-click (and the keyboard context-menu key / Shift+F10) on a tag in the TAGS panel opens a menu with **Rename…**; the menu uses the existing portal context-menu behavior and closes on Escape, outside click and scroll.
- Rename opens a dialog prefilled with the current tag, validates the new name with the same normalization as tag edits, and shows exactly how many files and folders will change **across the whole active library** (not only the current folder), before an explicit confirm.
- Renaming to a tag that already exists merges: affected items end with the new tag once, and the old tag is removed; the dialog states that a merge will happen.
- Only sidecars that contain the tag are written, once per owning sidecar, with expected-revision checks; asset files, paths, UUIDs, notes, unknown fields and stale entries are preserved. Missing or metadata-blocked items are not modified and are listed as skipped.
- Partial failure follows existing bulk semantics: completed items are reported, the failing sidecar and the remaining items are reported, and the UI reflects only committed state (no optimistic rename).
- Folder tags (self `.` entries) are renamed the same way as file tags; tags never inherit.
- After rename, the TAGS panel, counts, row tags and active filters using the old tag update without a rescan of untouched directories; selection, folder, sort and layout are preserved.
- Saved searches that reference the old tag are updated automatically to the new tag.
- Renaming a prefix group (for example every `status:*` tag) is supported, with the same preview, merge, skip and partial-failure rules.
- There is no undo; the explicit confirm step and the metadata backup export are the recovery path.
- Tests cover single and multi-directory rename, prefix-group rename, merge into an existing tag, saved-search update, blocked/missing skip, revision conflict, partial-failure reporting, keyboard access and focus restoration; Rust tests use fixture copies only.

### Decisions (2026-10-28)

- Saved searches referencing the old tag: updated automatically.
- Prefix-group rename (e.g. every `status:*` tag): in scope.
- Undo: not needed; the confirm step and metadata backup export are sufficient.

### Implementation status (2026-11-04)

Delivered in source, with these differences from the criteria above:

- Entry points: right-click, the context-menu key and Shift+F10 on a sidebar tag open a menu with **Rename tag** and, for a tag containing a colon, **Rename prefix group**. The group header also opens the prefix action. The menu closes on Escape, an outside press, wheel, window resize or Tab, and focus returns to the originating tag, or to the TAGS header if that tag no longer exists.
- Preview is an explicit, cancellable, read-only scan of the whole library including subfolders. Files, folders and sidecar files are counted separately. Preview writes no sidecars, UUIDs or settings.
- Skips: missing and metadata-blocked rows are listed with reasons and never changed. Rows whose metadata cannot be read are listed separately because their tags are unknown. The lists cannot be copied as text.
- Write order: one atomic write per owning sidecar, committed sequentially. The first failure stops the run; the result reports committed, failed and unattempted rows and the failing sidecar.
- Saved searches and the active query: rewritten with the app's query parser, and only after every eligible sidecar was written. A rename whose destination would change a query's meaning is refused before preview, with a blocker naming the saved search or the active query. Nothing is guessed. A partial result leaves searches and the query on the old name.
- Merge: renaming onto an existing tag merges without duplicate tags. The dialog discloses that migrated searches match differently afterwards, including that an excluded term also excludes rows that already had the destination.
- Settings failure: if sidecars commit but the saved-search write fails, the app keeps an in-memory retry proof so only that half can be retried. The proof lives until the app closes, the library is removed or a later rename overwrites it. Dismissing the notice clears the in-app notice, not the proof. Nothing is persisted; after a restart the saved searches must be corrected by hand. This limit is accepted for now.
- Updates: an unresolved partial or settings-failed notice blocks app update installation. It clears on a complete retry, a library change, or **Dismiss notice** once a retry preview shows nothing to migrate or the retry is rejected. A partial rename whose rows keep failing blocks updates until the library is switched or the app restarted. This limit is accepted for now.
- No undo; confirmation and the user's own backup are the recovery path.

Automated evidence at the last full run: frontend 897 tests across 23 files; `pnpm exec tsc --noEmit` and `pnpm build` exit 0; Rust 284 passed / 1 ignored; `cargo fmt --check` exit 0; strict Clippy with `-D warnings` clean; `git diff --check` exit 0. Interface tests run in jsdom.

Still open, none of it verified:

- Native acceptance on macOS (WKWebView) and Windows 11, Intel macOS, and a run against a real library. See [manual test plan](manual-test-plan.md#tag-and-prefix-group-rename-acceptance).
- A misplaced `#[cfg(unix)]` that would have broken the Windows test build was fixed in source. It could not be verified on the development host because the MSVC cross-compile fails for lack of C headers. A real Windows build, from CI, is still outstanding.
- Commit, merge, release and Store submission have not happened.

## AUTO-SCAN — Background scanning for file and folder changes

**Status:** Proposed; user-requested on 2026-11-03. Not implemented. This entry does not authorize implementation or replace the current tag-rename task.

### User request

Automatically keep the catalog up to date when files or folders are added, changed, removed or moved, using background auto-scan or periodic polling instead of requiring manual Rescan.

### Proposed acceptance criteria

- Detect external file/folder changes throughout the active approved library, including nested folders, and refresh catalog rows, folder contents, counts and metadata issues without a manual Rescan.
- Detect external sidecar changes through the same read-only refresh path; never create or repair metadata as part of background scanning.
- Keep browsing responsive, coalesce bursts of changes and prevent overlapping scans. Serialize refresh publication with metadata/settings operations; discard stale results after cancellation or library/root changes.
- Preserve current folder, filters, selection, sort and layout where their targets still exist. Handle removed or moved folders and selected items explicitly; do not silently discard unsaved drafts or confirm edits against stale revisions.
- Respect native approved-root authorization and existing symlink/path restrictions. No general frontend filesystem access or asset/sidecar writes.
- Show nonintrusive scanning/error feedback, retain manual Rescan/Stop, and pause or stop background work safely for library removal, app shutdown and updater installation.
- Verify additions, changes, deletions, moves, sidecar updates, bursts, unavailable roots, stale responses and concurrent edits using disposable libraries. Check native behavior and resource use separately on macOS and Windows.

### Open design decisions

- Native filesystem watcher, periodic polling, or a combination; refresh interval and idle/background behavior.
- Enablement controls and default behavior, including safeguards for large libraries, network mounts and cloud-synced folders.

## Broader deferred capabilities

- Metadata backup import: requires explicit overwrite/conflict/recovery design.
- Asset rename/arbitrary moves: requires filesystem authorization, sidecar ownership and recovery design.
- Continuous watcher and durable layout preferences: potential later work; priority not established.
