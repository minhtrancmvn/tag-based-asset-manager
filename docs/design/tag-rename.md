# Tag and prefix-group rename

Status: Implemented and merged to `main` via PR #13; released in unsigned prerelease v0.5.0 on 2026-11-06. Native macOS/Windows acceptance is pending user testing. History: design approved by the user on 2026-11-02 after reviewing this document. Approach 2, native preview/apply, and the stated partial-failure/settings policy are accepted. The implementation plan was also approved by the user on 2026-11-02. On 2026-11-03, after consultation, the user decided that saved-search query rewrites are computed by the canonical TypeScript parser and bound by native preview (see "Saved searches and active filters"). ADR consultation on the amended bytes was then still open.

## Problem

The sidebar can filter by tags but cannot rename them. Users need to rename one tag or a colon-delimited prefix across the active library, including nested folders, without changing asset files or losing metadata.

## Requirements

1. Individual tags and prefix groups expose Rename through pointer and keyboard context menus, including Shift+F10 and the context-menu key.
2. A dialog starts with the current name, validates normalization, and presents whole-library file/folder counts before explicit confirmation.
3. Existing destination tags merge without duplicates; preview discloses affected merges.
4. Writes change only matching, editable entries in their owning sidecars, once per sidecar. Preserve UUIDs, notes, unknown fields, unrelated/stale entries, asset bytes and paths.
5. Missing and metadata-blocked rows remain unchanged and appear in a skipped-items list. Unreadable metadata whose tags cannot be determined must be identified as uninspectable, not counted as a known match.
6. All targets preflight before the first write. Revision or ownership conflicts reject stale confirmation. Later write failures return exact committed, failed and unattempted items and the failing sidecar.
7. Folder self entries and legacy parent ownership follow existing rules, with no tag inheritance.
8. Only committed results change frontend/native cached rows. Completion must not rescan untouched directories or reset folder, selection, sort or layout.
9. Successful rename migrates active tag-query tokens and saved searches for the active library. Preserve excluded-tag signs, whitespace, quoted path text, search names and other libraries' searches.
10. Prefix rename preserves everything after the first colon. Exact plain tags remain separate from prefix groups.
11. No undo or cross-directory rollback. Confirmation explains this and points to existing metadata export as recovery preparation.
12. Tests cover safety, merges, skips, revisions, partial failures, query migration, saved-search failure, stale responses, keyboard access and focus restoration, using disposable libraries only.

## Constraints

Preserve the existing dirty updater implementation and all user worktrees. No commit, push, release, Store submission, dependency installation, production app launch, real-library/settings access, credentials or private keys. No broad frontend filesystem permissions or asset operations. Run GitNexus upstream impact and report blast radius before modifying existing functions; warn before HIGH/CRITICAL edits. Keep updater install exclusion and native serialization intact.

## Approaches

### 1. Frontend loops over existing bulk tag edits

Smallest apparent API change, but prefix mappings differ per tag and several calls could write one sidecar repeatedly. Client-selected targets can omit nested assets; preview/apply and saved-search persistence lack one native operation boundary. Rejected: fails requested safety and reporting contract.

### 2. Dedicated native preview and apply

Selected and approved. Native code owns target enumeration, revision binding, grouped writes and settings migration. UI receives an explicit preview and committed outcomes. Reuses existing authorization, manifest and atomic-write rules without claiming a cross-directory transaction.

Cost: new narrow commands, preview state, TypeScript query-rewrite tests, shared mapping fixtures and explicit handling of the separate settings storage boundary.

### 3. Durable transaction journal with recovery/undo

Could support crash recovery across sidecars and settings, but needs a durable journal protocol, replay rules and recovery UX. Rejected for this increment: exceeds requested no-undo scope and introduces another persistent record of library state.

## Proposed native contract

Use narrow library-ID commands, not arbitrary paths. Preview accepts rename mode, source, destination and the frontend-computed active-library saved-search replacements. Apply accepts library ID and an opaque native-owned preview ID. Do not authorize apply from an untrusted client-supplied target list or a checksum of that same list.

A preview record binds normalized mapping, approved root/library identity, the exact ordered target set and revisions, skipped/uninspectable rows, merge information and the frontend-computed saved-search replacements with their exact expected filters. A new preview supersedes the previous preview for that library. Apply revalidates authorization and the bound metadata before the first write, consumes the preview, and requires a fresh preview for retry after any outcome. Root removal/change, conflicting native mutations and a new scan invalidate pending previews.

### Preview freshness

Recommended: one cancellable, fresh read-only native scan when the user requests preview, followed by preflight of matching editable rows. This avoids presenting a supposedly current whole-library count from stale cached tags. Do not scan on every name keystroke. Display the preview's catalog/issues and bind apply to this native snapshot; discard stale responses after library switch or cancellation. No sidecars, settings or UUIDs are created during preview.

Apply cannot promise that an external process will never add another matching asset after preview. It must reject changes to bound targets and sidecar source bytes, preserving existing documented filesystem race limits. Newly added assets after preview require a new preview or Rescan; the UI must not imply a filesystem-wide lock.

### Mapping and merge rules

Exact mode normalizes source/destination using existing trim/lowercase behavior and replaces matching tags only. Prefix mode accepts one nonempty prefix segment, with optional trailing colon in the input, and maps `status:printed` to `state:printed`; `status:printed:large` becomes `state:printed:large`. Plain `status` is not renamed by prefix mode. Reject empty, unchanged or ambiguous multi-segment prefix names. Do not add unrelated restrictions to exact tags beyond existing tag-edit rules.

Normalize/deduplicate/sort targeted tag arrays using the manifest module. Disclose both an existing destination tag elsewhere in the library and per-item duplicate collapses; they are not the same count.

### Write and result rules

Preflight every target using existing scan authorization, ownership and revision checks. Group by owning directory; preserve latest unrelated entries and exact source bytes. Serialize all changed groups before writing. Hold the native operation mutex through sidecar writes and settings handling so updater installation, library removal and other local writes cannot interleave.

Return committed Asset DTOs, failed-group items, unattempted items, skipped/uninspectable entries, committed saved-search state and a structured error/outcome. Preflight failure commits nothing. A write failure keeps earlier sidecars committed, leaves the failed and later groups unapplied, and reports their exact paths/items. Update native snapshot revisions for committed assets as well as frontend rows; existing bulk code must not be assumed to do that automatically.

## Saved searches and active filters

Sidecars and app-data settings are separate stores. No atomic commit across both is claimed.

Approved behavior:

- Migrate query tokens only after all eligible sidecar writes succeed. Skipped missing/blocked rows remain explicitly listed even after successful eligible writes; old tags can still exist on those rows.
- On partial sidecar failure, leave saved searches and active query unchanged, apply committed row results, and show a persistent partial-outcome summary. Explain that old-tag filters no longer include already-renamed rows.
- On full sidecar success followed by settings failure, keep committed rows, return the unchanged saved-search state plus an explicit settings error, and leave active query unchanged. Offer a fresh preview/retry that can complete query migration even when no eligible old-tag rows remain. Never present this as a rolled-back rename.
- When both eligible sidecars and settings succeed, update active query from the committed mapping and apply the returned saved searches without using hook logic that clears/rescans the catalog.
- If all matched rows are skipped, do not silently retarget queries. Permit zero-target retry only when it is completing an already committed rename with pending query migration, not as an implicit search-only rename.

Query rewriting must follow the existing ASCII/smart-quote token boundaries, not string replacement or a new simplified whitespace parser. Required and excluded exact tags change; quoted path phrases, including negative quoted text, remain byte-for-byte unchanged. Prefix replacement is colon-delimited; it does not introduce wildcard query semantics.

The query language is parsed only by `src/catalog.ts`; native code stores query text opaquely. All query rewriting therefore uses that TypeScript parser, with no Rust port.
- The frontend computes the active-query rewrite.
- With the preview request it also sends one replacement for each active-library saved search that needs migration, carrying the exact expected filters and the new filters.
- Native rejects the preview if a replacement names another library's or an unknown search, if its expected filters differ from current settings, or if its new filters fail existing saved-search validation. Otherwise it binds the replacements into the preview record.
- Apply persists only the bound replacements, so apply still accepts only the preview ID.
- Native cannot detect a search the frontend omitted; the TypeScript parser is the single source of query semantics.
- Mapping normalization (trim/lowercase, first colon segment) exists in both languages. Shared mapping fixtures cover both. Query fixtures are TypeScript-only.

The settings-failure retry binding and the zero-eligible-target distinction need explicit test cases before implementation. They must not be inferred from the absence of current matching rows.

## Frontend components

- New sidebar context-menu state for exact tags and colon-prefix groups, using existing document-body portal styling and Escape/outside/scroll dismissal.
- Focusable group action with an accessible label. Restore focus to the originating tag/group action after cancellation; if successful rename removes it, focus its renamed successor or a stable TAGS-panel control.
- Rename dialog with draft, read-only preview progress, validation, explicit confirmation, merge disclosure, skipped/uninspectable lists and committed outcome display. Changing the destination invalidates confirmation and requires another preview.
- Narrow DTOs and client methods in `types.ts`/`native.ts`, serialized operations and stale-response guards in `useLibrary.ts`. Before the preview request, compute and validate the active-query rewrite and the saved-search replacements with the canonical parser.
- `App` integration for active query, library-change cleanup and updater draft/busy blockers. Preserve existing dirty updater logic.

## Domain routing

Available native implementation route: `general-purpose` agent with explicit Rust/backend scope; no dedicated Rust agent is currently listed. Frontend route: `typescript-frontend-engineer`. Accessibility UI route: `ui-design-engineer`. Deterministic test/verification route: `testing-automation-engineer`. Plan must sequence shared files rather than assign overlapping parallel edits. No implementation tasks are dispatched before required gates pass.

## Verification plan

Targeted RED/GREEN tests precede product edits. Native tests cover same-sidecar and multi-directory writes, root/self/legacy folder ownership, nested assets, merge counts, immutable skipped rows, unknown fields/notes/UUID/stale-entry preservation, stale previews, source-byte conflicts, partial write results, saved-search replacement binding/rejection, settings failure/retry and native snapshot updates. Frontend tests cover query rewrite fixtures, saved-search replacement derivation, whole-library counts, stale responses, committed partial results, busy/update blockers, library switching, pointer/keyboard menus, confirmation and focus restoration.

Then run full frontend tests, TypeScript/production build, locked Rust tests, formatting and strict locked all-target Clippy. Inspect diff and compare against the pre-feature dirty baseline. No dependency installation or application launch. Record macOS/Windows native UI acceptance as unverified, not implied by jsdom/Rust checks.

## Approval scope and remaining gates

- Approved: dedicated native two-phase approach with a fresh read-only scan only when preview is requested.
- Approved: partial-failure/settings-failure query policy above, including visible limitations when skipped rows retain old tags.
- Implementation plan and required ADR consultation remain separate gates after design approval.

## Evidence

- `docs/product-backlog.md:120-150`: user scope and prior prefix/search/no-undo decisions.
- `docs/metadata-format.md:57-89`: preservation, filesystem limits, authorization and grouped-write semantics.
- `src-tauri/src/backend.rs:256-279`: scan snapshot holds cached rows and editable membership.
- `src-tauri/src/backend.rs:394-435`: settings rollback covers app-data state, not prior sidecar commits.
- `src-tauri/src/backend.rs:1165-1314`: existing grouped bulk preflight and committed partial results; it does not update cached snapshot rows.
- `src/catalog.ts:13-74`: existing query tokenizer and quoted-text distinctions.
- `src/App.tsx:217-231`: sidebar currently counts direct children, not the entire recursive library.

## Approval state

The user replied `approved` on 2026-11-02 with this design open, following the explicit request to approve it. This supplies human approval of documented intent, approach and design. Gate checks still report `mode: human`; the CLI has no approval-setting command, so the design checkpoint records the actual approval without changing gate policy or fabricating auto-approval.

The user then approved the implementation plan on 2026-11-02. On 2026-11-03, after consultation `review-20261103T161401644330Z` raised concern CON-3, the user replied "would you prefer it? if so then proceed". The assistant recommended computing query rewrites in TypeScript, and this amendment records that human architectural decision. The amended text has not been separately re-read by the user. Consultation on the amended bytes remains pending before implementation.
