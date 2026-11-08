# Design: Clean theme and layout refresh

**Status:** Implemented on branch `style/ui-theme-refresh` (2026-11-08). Supersedes the gradient treatment in [gradient-theme-revamp.md](gradient-theme-revamp.md); theme IDs, persistence and the picker's interaction model are unchanged.

## Problem

The user found the gradient themes "not clean enough", and some bullets had too little contrast. Measured causes:

- Saturated gradient sidebars and gradient primary buttons competed with the catalog.
- Several dots were painted in the surface colour: `.status-dot` and `.offline-dot` used `--paper`, and `.group-swatch` used `--sidebar-active` on a near-identical sidebar. They were close to invisible.
- Three typefaces plus tracked uppercase monospace labels, 8–10px text, and the same slogan repeated in four places.

## Decisions

- **Layout:** a tinted frame (sidebar, top bar, details rail) around one sheet that holds the catalog. Depth comes from one lightness step, with no resting shadows. The folder breadcrumb moved from the sidebar into the catalog toolbar next to Up. The library summary moved into the title row.
- **Palettes:** each theme is one hue. `docs/design/theme-palettes.json` is the approved copy of `themePalettes`. Frame, sheet and neutral surfaces stay at OKLCH chroma ≤ 0.03. The hue appears at full strength only on the accent (primary action, selection marker, focus, bullets), tag chips and selection. There are no gradients anywhere.
- **Roles:** `sidebar*`, `tableHeader` and `gradient` were removed because they duplicated other roles. `control` (input edges, ≥3:1) and `active` (neutral navigation pill) were added.
- **Contrast floors, enforced by `src/themes.test.ts`:**
  - Ink ≥7:1 and muted ≥4.5:1 on every surface.
  - Accent, focus, success dot and control edges ≥3:1 against the surfaces they sit on.
  - Bullets must use tested roles and never the surface colour.
- **Type:**
  - Work Sans for the UI, with a 13px body and an 11px minimum.
  - IBM Plex Mono only for paths, IDs and code.
  - Barlow Condensed was removed. The sidebar now carries the app icon and the full product name.
- **Tags:** plain tags that would repeat their own name as a group heading now list flat, ahead of the prefix groups. In the table, chip remove buttons and the add field appear on the hovered, focused or selected row.
- **Theme picker:** the 14 light and 6 dark themes appear in separate labelled groups (seven columns: two rows of light, one row of dark). Arrow keys move between the groups at the same column. The stored preset order is unchanged.
- **Dialogs:** eyebrow labels were removed. The delete and saved-search dialogs gained a one-line subtitle that keeps the essential context (Trash, not permanent; app-local).

## Verification

- Vitest, tsc and the production build all pass.
- Screenshots of all 20 themes and every dialog, menu and empty/scanning state were taken from a mocked IPC harness at 1440, 1100 and 820px.
- Native WKWebView and Windows rendering are unverified.
