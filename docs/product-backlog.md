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

## Broader deferred capabilities

- Metadata backup import: requires explicit overwrite/conflict/recovery design.
- Asset rename/arbitrary moves: requires filesystem authorization, sidecar ownership and recovery design.
- Continuous watcher and durable layout preferences: potential later work; priority not established.
