# ADR: Gradient theme revamp

**Date:** 2026-10-09
**Status:** Accepted. Design, implementation plan and required architectural consultation were approved on 2026-10-09. Implementation and local validation completed on the feature branch; user authorized PR-based preparation and publication of unsigned prerelease v0.2.0. Stable release, signing and notarization remain separate/open.

## Context

User requests blended gradient styling and visual theme selection. Existing app has eight strict persisted IDs, root semantic CSS tokens and native committed-state settings writes. User chose expansion toward twenty and toolbar popover, then explicitly required redesign of existing eight as well. Design approved on 2026-10-09.

## Decision

1. Redesign all eight existing palettes and add twelve full palettes, for twenty themes. Preserve existing names/IDs and Workshop default for stored preferences, not unchanged visuals.
2. Adopt named rounded gradient swatches in anchored toolbar popover: five columns/four rows when space permits, responsive fewer columns and bounded vertical scroll.
3. Use coordinated semantic surface/sidebar/accent/tag/selection colors. Gradients belong in signatures and bounded decorative atmosphere; dense rows, inputs, dialogs and semantic controls stay readable solid surfaces.
4. Approve fourteen light and six dark treatments with fixed explicit preset choice, no OS appearance switching or independent mode setting. Inventory: Workshop, Coral, Lavender, Ocean, Mint, Sunset, Stone, Midnight, Rose, Peach, Ember, Amber, Meadow, Lagoon, Glacier, Sky, Cobalt, Iris, Plum, Aurora.
5. Use named toggle buttons with noncolor selected checkmark, distinct focus, roving tab stop, arrow focus-only navigation, Home/End, explicit activation and Escape/outside/Tab dismissal behavior. Preserve focus and no optimistic committed-state theme change.
6. Reuse serialized native settings operation and rollback; no browser storage, asset/sidecar writes, rescan or session resets. Expand strict frontend/native IDs and tests together.
7. Preserve forward compatibility for existing eight IDs and missing-theme default. Older eight-theme build rejects new IDs; downgrade requires selecting original preset or restoring compatible stopped-app settings backup. No silent remapping or blanket reverse-compatibility claim.
8. Exact production tokens must pass all-theme contrast and actual isolated macOS/Windows interaction/persistence validation. Local HTML is illustrative design evidence, not native acceptance.

## Alternatives

Centered modal improves focus containment but covers catalog. Inspector panel competes with asset details and expands unrelated state. User selected toolbar popover.

## Consequences

Twenty palettes increase validation scope. No custom editor, imports, theme search, new filesystem API or automatic mode added. Implementation used fresh GitNexus impact analysis, risk warnings and test-first changes. This ADR records the accepted design. User subsequently authorized implementation and, separately, PR-based preparation/publication of unsigned prerelease v0.2.0. Stable publication, signing and notarization remain unauthorized/open.

## Implementation and validation result

All20 presets, coordinated semantic palettes and toolbar popover are implemented. Native macOS matrix verified committed changes, restart persistence and catalog/asset/sidecar preservation on an isolated synthetic library. Automated frontend, Rust and contrast suites pass. Windows native UI is unavailable; native Tab dismissal occurred but exact destination focus was not captured. These limits remain open rather than inferred as passes.

## References

- [Approved design](../docs/design/gradient-theme-revamp.md)
- [Approved palette data](../docs/design/gradient-theme-palettes.json)
- [Product design summary](../docs/design/gradient-theme-revamp.md)
- [Original backlog](../docs/product-backlog.md)
