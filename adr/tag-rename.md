# ADR: Tag and prefix-group rename

**Date:** 2026-11-02
**Status:** Accepted. Implemented and merged to `main` via PR #13; released in unsigned prerelease v0.5.0 on 2026-11-06. Native macOS/Windows acceptance is pending user testing. History: design and implementation plan accepted by the user on 2026-11-02. Amended on 2026-11-03 by user decision after consultation `review-20261103T161401644330Z`: saved-search query rewrites are computed with the canonical TypeScript parser (concern CON-3), and the final documentation task includes `CLAUDE.md` (concern MP-7). That consultation's PROCEED covers the 2026-11-02 bytes only; consultation on these amended bytes is pending. No implementation or native acceptance is claimed.
**Complexity:** Complex: native authorization and grouped persistence, separate app-data settings, asynchronous frontend state, query syntax and accessible UI.

## Context

The user authorized tag and prefix-group rename from the sidebar. Existing tags belong to per-directory `.asset-tags.json` manifests; saved searches belong to app-data settings. Recursive scan snapshots authorize row edits, while the sidebar displays current-folder tags. Existing bulk edits preflight and group writes but do not provide a whole-library rename preview, rename-specific reporting or query migration.

The user approved [the design](../docs/design/tag-rename.md), including a fresh read-only preview scan and an explicit sidecar/settings partial-failure policy. Existing dirty updater work must remain intact. Work is on `feat/tag-rename`, created from the current HEAD without stashing or changing existing files. A private pre-implementation baseline is retained under `.git/tag-rename-baseline-20261102/`.

## Decisions

1. Use dedicated native preview/apply commands with approved library IDs. Preview performs one cancellable read-only scan on explicit request, not on every keystroke. No preview sidecar/settings writes or UUID creation.
2. Store opaque preview IDs and exact target/revision/ownership bindings in native memory. Apply accepts the preview ID, not client-selected mutation targets. Invalidate previews on relevant native mutations, root removal/change and scans; consume apply attempts. Reject stale or altered preconditions before any writes.
3. Exact rename uses existing trim/lowercase semantics. Prefix rename maps only the first colon-delimited segment, preserves suffixes, and does not affect a plain tag with the same spelling. Existing destination tags merge; disclose destination existence and per-item duplicate collapse separately.
4. Reuse existing path authorization, folder ownership, manifest preservation and atomic replacement rules. Preflight and serialize all targets before writes. Write once per owning sidecar; retain the native operation mutex through writes and settings handling. No asset operations, automatic repair, cross-directory rollback or durable transaction journal.
5. Leave missing/blocked metadata unchanged and list skipped items. Distinguish known matches from uninspectable metadata. Respect self `.` and legacy parent ownership without inheritance.
6. Return exact committed, failed and unattempted rows, skipped/uninspectable information, the failing sidecar, structured error and committed saved-search state. Update native snapshot revisions and frontend rows only from committed results.
7. Migrate active-library saved searches and active query only after all eligible sidecar writes and settings persistence succeed. Preserve quote/whitespace/exclusion semantics, names and other libraries. A partial sidecar failure leaves queries unchanged and visibly explains that already-renamed rows no longer match old-tag filters. The query language is parsed only by the frontend (`src/catalog.ts`); native stores query text opaquely. The frontend therefore computes every query rewrite with that parser and sends the active-library saved-search replacements with the preview request. Native binds them into the preview after checking library ownership, exact expected filters and existing saved-search validity, and persists only the bound replacements. Native cannot detect a search the frontend omitted; the TypeScript parser is the single source of query semantics.
8. If sidecars all commit but settings fail, retain committed rows and old saved searches/query with an explicit settings error. Support an explicitly bound fresh-preview retry of pending query migration, including zero remaining eligible targets. Do not mistake an all-skipped operation for a completed rename or permit arbitrary zero-target search-only rename.
9. Preserve current folder, selection, sort and layout. Apply must not rescan untouched directories. Include rename drafts/operations in updater install blockers and retain stale-response/library-switch protection.
10. Provide keyboard/pointer sidebar context menus and a preview/confirmation/outcome dialog, including focus restoration. No undo. Explain backup export and remaining old tags on skipped rows.
11. Use test-first changes and disposable libraries/fixture copies only. Require full frontend tests/build and locked Rust tests/format/strict Clippy; automated tests do not establish macOS/Windows native UI acceptance.

## Alternatives

Frontend loops over bulk-edit calls were rejected because they cannot safely guarantee whole-library native target selection, one write per sidecar, a bound confirmation or one serialized settings boundary. A durable journal/recovery protocol was rejected as outside requested no-undo scope. A Rust port of the query tokenizer for native saved-search rewriting was originally approved but replaced on 2026-11-03. It duplicated a stateful smart-quote heuristic parser that native code never otherwise evaluates. Cross-language parity could not be proven for Unicode whitespace and UTF-16 indexing. It added no safety, because saved searches are app-local preferences that the frontend can already replace through `upsert_saved_search`.

## Consequences and limits

Sidecar and settings stores cannot be committed atomically together. External filesystem changes after preview remain possible under the existing path/byte-check race limits. Skipped rows can retain old tags after eligible writes succeed. Retry proof is native session state, not a new durable path database; process exit after a settings failure leaves a visible error during that session but requires manual saved-search correction after restart if proof is unavailable. Do not claim crash recovery.

Shared snapshot invalidation has CRITICAL indexed upstream impact (15 direct dependents, 17 flows, 69 total symbols); fresh impact checks, explicit warnings and native regression tests are required before changes. Preserve existing updater locking and fixed endpoint/signature/version/platform checks. No dependencies, production app launches, real data, credentials, commits, pushes or publication are authorized.

## References and execution gates

- [Approved design](../docs/design/tag-rename.md)
- [Approved implementation plan](../docs/design/tag-rename-plan.md)
- [Requested acceptance criteria](../docs/product-backlog.md#tag-rename--rename-a-tag-from-the-tag-panel)
- [Metadata contract](../docs/metadata-format.md)

Consultation evidence was kept locally in `adr/tag-rename/` and is not part of the repository. A valid hash-bound `PROCEED` for this ADR, approved design and approved plan is required before Medium+ implementation. `review-20261103T161401644330Z` validated PROCEED for the pre-amendment bytes only; at the time of the amendment, no verdict covered the amended bytes.
