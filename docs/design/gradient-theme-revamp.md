# Design: Gradient theme revamp

**Status:** Design approved by user on 2026-10-09; all twenty palettes implemented and locally validated in isolated feature worktree. Native macOS matrix passed within documented scope; Tab focus destination and Windows native UI remain unverified. User authorized PR-based preparation and publication of unsigned prerelease v0.2.0; no stable release or signing.

## Problem statement

Current eight palettes coordinate application surfaces but use a native name-list selector and solid decorative highlight. User requests soft blended gradients, coordinated color theming and a visual grid of swatches. Expand toward twenty full presets without sacrificing catalog readability or native persistence safety.

## Confirmed intent

- User selected **Expand toward twenty** and explicitly clarified **revamp the existing eight as well**. All twenty receive redesigned gradient signatures and coordinated semantic palettes; existing eight are not retained as unchanged legacy visuals.
- User selected **Toolbar popover** instead of centered dialog or inspector replacement.
- Original reference is four rows of five rounded blended tiles. Colors inspire design; exact reference reproduction is not claimed.
- Existing application layout, typography, catalog density and filesystem boundaries remain intact.

## Requirements

- [x] R1: Revamp all eight existing themes and add twelve, producing twenty named full themes. Preserve existing names/IDs `workshop`, `coral`, `lavender`, `ocean`, `mint`, `sunset`, `stone`, `midnight` for saved preferences, not their old visual palettes. Redesign gradients, sidebar/surfaces, accents, selection, tags and controls for each. Append twelve lowercase IDs, not a settings migration.
- [x] R2: Replace native select with toolbar trigger displaying miniature gradient, committed theme name and expanded state. Open in-app name-labeled rounded swatch grid, five columns/four rows when space permits.
- [x] R3: Apply real coordinated tokens to sidebar, toolbar, catalog, inspector, portals, dialogs, inputs, selection, tags and semantic states. Vivid picker preview alone is not a complete theme.
- [x] R4: Keep dense catalog/input/dialog surfaces solid and low-chroma. Place gradients in swatches and bounded decorative/sidebar atmosphere, not row backgrounds or text-critical buttons.
- [x] R5: Every theme has explicit light/dark surface treatment; no automatic OS switching and no independent appearance setting. Workshop remains default.
- [x] R6: All swatches have visible names, accessible names and noncolor selected checkmark/outline. Keyboard focus is distinct from committed selection. Enter/Space activate; arrows move focus only. Escape/outside dismiss; no focus trap for nonmodal popover. Native Tab-out dismissal passed; the exact destination focus was not captured and remains partially unverified.
- [x] R7: Persist exclusively through current native `set_app_theme` and shared serialized operation path. Apply returned committed state only. Pending status, save failure and retry are accessible; no local/browser-storage fallback.
- [x] R8: Theme changes preserve folder, query, view, match mode, kind, selection, sort, layout, navigation and catalog. No rescan or library/asset/sidecar writes.
- [x] R9: Preserve legacy missing-theme default and eight stored IDs. Invalid settings fail closed/preserve bytes. New presets require updated native enum and round-trip validation.
- [x] R10: Verify text contrast >=4.5:1, meaningful focus/control indicators >=3:1 against adjacent surfaces, selection distinction and readable disabled/error/success states for all twenty. Recheck gradient extrema/interpolated samples wherever text can overlap.
- [x] R11: Fit viewport at supported minimum desktop window, zoom and short-height cases; scroll within popover if needed. Portal inherits root tokens and does not reset catalog scroll. Minimum supported native window capture at 820×600 passed; browser zoom/Windows-specific UI remain unverified.

## Approaches considered

| Approach | Benefit | Cost/risk | Implementation domains |
|---|---|---|---|
| Toolbar popover — selected | Fits current theme control; catalog remains visible; visual choice is immediate | Medium: anchor placement, focus and dismissal need tests; portal may cover content briefly | TypeScript frontend, UI design, test automation, Rust integration |
| Centered dialog | Large swatches and simple modal focus containment | Medium: covers catalog; heavier interaction for preference change | TypeScript frontend, UI design, test automation, Rust integration |
| Inspector panel | Catalog remains visible | Higher: competes with asset details, requires unrelated panel-switching state | TypeScript frontend, UI design, test automation, Rust integration |

## Selected visual direction

Keep workshop-ledger structure and existing bundled fonts. Use vivid two/three-stop blends as theme signatures, coordinated with restrained semantic surface colors. A theme may have a colorful swatch and low-chroma catalog without being cosmetic-only: sidebar atmosphere, accent, surfaces, tags, selection and controls must form one palette.

The implemented inventory is **14 light themes and 6 dark themes**; all original eight names/IDs are preserved while their visual palettes are redesigned. The approved names and direction are listed below.

| ID/name | Surface mode | Gradient direction |
|---|---|---|
| workshop / Workshop | Light | Pine, sage, warm brass |
| coral / Coral | Light | Coral, magenta, soft peach |
| lavender / Lavender | Light | Lavender, periwinkle, blush |
| ocean / Ocean | Light | Navy, teal, aqua |
| mint / Mint | Light | Mint, aqua, pale lime |
| sunset / Sunset | Light | Orange, pink, apricot |
| stone / Stone | Light | Gray, blush, pearl |
| midnight / Midnight | Dark | Deep navy, indigo, cool teal |
| rose / Rose | Light | Rose, fuchsia, mauve |
| peach / Peach | Light | Peach, salmon, cream |
| ember / Ember | Dark | Burgundy, red, burnt orange |
| amber / Amber | Light | Amber, ochre, honey |
| meadow / Meadow | Light | Leaf green, sage, warm lime |
| lagoon / Lagoon | Light | Turquoise, sea green, sky |
| glacier / Glacier | Light | Ice blue, pale cyan, lilac |
| sky / Sky | Light | Sky blue, cyan, soft blue |
| cobalt / Cobalt | Dark | Cobalt, navy, electric blue |
| iris / Iris | Dark | Violet, indigo, magenta |
| plum / Plum | Dark | Plum, burgundy, muted rose |
| aurora / Aurora | Dark | Deep teal, violet, green |

Eight existing IDs keep meaning/default surface mode; revising their colors is an intentional visual revamp, not loss of stored preference. Production tokens are recorded in the checked-in palette artifact; all-theme semantic and sampled-gradient contrast tests passed.

### Gradient placement

- Full blend inside each swatch and miniature trigger preview, without theme name text on gradient.
- Sidebar may use a dark low-luminance gradient under text, or a colorful decorative atmosphere isolated from text. All sidebar text must pass against worst sampled background; use solid text-bearing layers if necessary.
- Small toolbar/header atmosphere only where it does not reduce text/focus contrast. No animated blends, stripes resembling separators or saturated row fills.
- Rows, selection, controls, tags, dialogs and semantic error/success states use explicit solid tokens. Preserve meaning of danger/success across every palette.

## Picker interaction specification

This specification records the intended behavior implemented and validated on the supported macOS test host. The exact Tab focus destination and Windows-native interaction remain unverified.

1. Trigger is a button with `aria-expanded` and `aria-controls`. Shows current committed name and miniature gradient; browser-only preview remains disabled with existing desktop explanation.
2. Popover is an anchored nonmodal region containing labeled group of twenty toggle buttons. Each button uses full visible theme name and `aria-pressed` for committed choice. Avoid menu/radio semantics whose built-in arrow selection would imply immediate persistence.
3. Use one roving tab stop within swatches. Open focuses committed choice; arrows move spatially using actual responsive column count, Home/End reach first/last. No wrapping into unrelated controls. Focus moves without writing settings.
4. Enter/Space/click explicitly requests selected preset. Re-selecting committed ID is no-op. On successful native response, update root tokens/checkmark/name, keep popover open so user can compare with visible catalog.
5. During save keep committed palette/checkmark intact, show `Saving <name>…` status and separate pending tile marker. Prevent second activation; keep focused tile navigable through `aria-disabled` rather than removing focused control. Escape/close remains available; closing does not cancel durable native save.
6. Failure keeps old palette/selection. Show accessible error and leave failed choice available for retry; do not clear folder/session state. Existing app error may also display; avoid duplicate competing announcements. Success after close still updates committed theme normally.
7. Escape, trigger reactivation or close button dismisses and restores trigger focus. Outside pointer dismissal preserves clicked control focus rather than stealing it. Tab exits normally; closing on focus leaving popover/trigger must not trap user. Scrolling catalog/window dismisses; scrolling inside popover does not.
8. Position from trigger bounds, viewport-clamped with margin; reposition on resize/zoom. Use width up to roughly 480px, five equal columns and readable labels, reducing to four/three/two when needed. Vertical overflow stays inside popover; no page-level horizontal overflow. No new overlay dependency required by design.

## Implemented components and contract

- `src/themes.ts`: defines the 20-ID union/options, complete semantic palettes, appearance and gradient records. Flat semantic colors remain separate from CSS gradients; contrast helpers only receive opaque hex tokens.
- `src/components/ThemeSettings.tsx`: renders the toolbar swatch popover and owns transient open/focus/pending presentation state, not canonical settings.
- `src/components/ThemeSettings.test.tsx`: covers accessibility, navigation, dismissal, pending and failure behavior. Parent supplies the native committed result.
- `src/App.tsx` / `src/App.css`: apply root tokens and selective gradients while preserving layout/session state and portal inheritance.
- `src/useLibrary.ts`, `src/native.ts`, DTOs: reuse existing serialized native settings operation and strict typed IDs; no generic filesystem/settings API added.
- `src-tauri/src/backend.rs` / `theme_tests.rs`: append enum variants and test all20 IDs, committed persistence, rollback, backward defaults and preservation of roots/searches/extras; unknown-ID validation remains strict.

### Compatibility and downgrade boundary

Loading old settings into new build retains all eight known IDs, missing-theme Workshop default and existing unknown-field preservation. No load-time rewrite/migration required.

Older eight-theme build cannot parse one of twelve new IDs. Do not claim reverse compatibility: before downgrade choose an original preset and back up app-data while app is stopped, or restore compatible app-data backup. Never silently remap new IDs to Workshop to make downgrade appear safe. Prior pre-theme/current rehearsal did not test newly added IDs.

## Domain agents

- UI design engineer: palette/token candidates, gradient placement and native visual review.
- TypeScript frontend engineer: theme types, picker component, root tokens and committed UI wiring.
- General-purpose Rust-capable agent: bounded enum/persistence regression additions; no manifest/filesystem changes.
- Testing automation engineer: keyboard/contrast/lifecycle regressions and native synthetic acceptance harness.
- Integration, scope review and GitNexus risk reporting were coordinated by the parent session. Changes remain on the feature branch for PR review.

## Verification completed

- Component suite covers visible20names, selected/focus distinction, arrow focus-only behavior, explicit activation, Escape/close/outside/Tab interactions and short viewport positioning.
- Deferred native-promise tests cover committed theme during save, duplicate request blocking, failure/retry and successful committed response.
- All20frontend palettes and native enum/options align; exact20round trips plus legacy8/missing/invalid settings regressions pass.
- Contrast tests cover text/state pairs and sampled gradients, selection distinction, focus and forced-colors treatment.
- App integration tests preserve folder/query/view/kind/selection/sort/layout and show no scan or metadata calls on theme changes; portal surfaces inherit committed tokens.
- Isolated macOS native matrix verified all20 commits, persistence/restart, minimum-window layout and Right Arrow/Return/Escape. Windows native acceptance is unavailable. Tab dismissal occurred but exact focus destination was not captured; this handoff remains partially unverified. Browser prototype is design evidence only.

## Trade-offs accepted

- Twenty palettes increase validation scope. No custom color editor, theme import/export, automatic OS appearance or theme search/filter added.
- Popover remains open after committed selection to support comparison; manual close/Escape are explicit.
- Full swatch gradients may be more saturated than catalog surfaces; this protects reading while retaining recognizable theme identity.
- New-ID downgrade needs compatible saved preference/backup; forward legacy compatibility is preserved but reverse eight-theme compatibility is not promised.

## Release notes

- User approved the twenty-name inventory, 14-light/6-dark treatments and gradient placement on 2026-10-09; no product-direction questions remain.
- `docs/design/gradient-theme-palettes.json` records semantic palettes and swatch/sidebar stops used by palette verification. Production theme palettes and primary-gradient tokens are defined in `src/themes.ts`; automated contrast tests passed. Primary gradient stops are not stored in a separate checked-in JSON artifact.
- Design, implementation and local validation are complete. User authorized PR-based preparation and publication of unsigned prerelease v0.2.0. Stable/signed distribution and Windows native UI acceptance remain separate open gates.
