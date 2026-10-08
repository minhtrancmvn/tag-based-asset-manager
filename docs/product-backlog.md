# Product backlog

Items below are planned work, not implemented behavior. Release acceptance gates stay in [release readiness](release-readiness.md); build artifacts stay in [REALEASE.md](../REALEASE.md).

## THEME-REVAMP — Gradient palettes and swatch-grid picker

**Status:** Requested by user on 2026-10-08; backlog only. Priority relative to other features not decided.

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

### Design decisions still needed

Palette count/names, which gradients become full themes, light/dark variants, gradient placement, grid dimensions and backward-compatible preset mapping. Resolve in feature design before implementation; no arbitrary new configuration or automatic OS appearance mode implied.

### Verification when implemented

Component/keyboard accessibility tests, native persistence/rollback tests, palette contrast checks and actual native screenshots for selected/focused/pending/error states. Verify Windows and macOS picker behavior; replacing native select must not reduce keyboard accessibility.

## NOTES-EDIT — Single-item notes editor

**Status:** Recommendation from product backlog review, not yet approved for implementation.

Current inspector displays notes read-only. Small next-feature candidate: edit one valid existing metadata entry with explicit Save/Cancel, native ID/revision checks and atomic owning-sidecar writes. Preserve UUID, tags, unknown fields, stale entries and browsing state; retain draft on failure. Define empty versus omitted notes/no-op semantics before implementation. Missing/blocked entries remain read-only. No bulk notes, import, rename or moves in this scope.

## Broader deferred capabilities

- Metadata backup import: requires explicit overwrite/conflict/recovery design.
- Asset rename/arbitrary moves: requires filesystem authorization, sidecar ownership and recovery design.
- Continuous watcher and durable layout preferences: potential later work; priority not established.
