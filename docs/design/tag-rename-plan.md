# Implementation plan: Tag and prefix-group rename

**Status:** Completed: implemented and merged to `main` via PR #13; released in unsigned prerelease v0.5.0 on 2026-11-06. History: user approved this implementation plan on 2026-11-02 after approving the design. Amended on 2026-11-03 by user decision after consultation `review-20261103T161401644330Z`:
- Saved-search query rewrites move to TypeScript and are bound by native preview (CON-3).
- T16 includes `CLAUDE.md` (MP-7).

At the time of the amendment, consultation on the amended bytes was pending and implementation had not started.

**Complexity:** Complex.
**Branch:** `feat/tag-rename`, based on `64b5c55548f873237362f83ebb626c666aba7d54` with existing dirty updater work preserved.
**Inputs:** [Approved design](tag-rename.md), [ADR](../../adr/tag-rename.md), [backlog](../product-backlog.md#tag-rename--rename-a-tag-from-the-tag-panel).

## Execution constraints

No commits, pushes, releases, Store actions, dependencies, application launches, real libraries/settings, credentials or private keys. Do not create worktrees. Use only disposable native test libraries and fixture copies. Preserve the pre-feature dirty baseline under `.git/tag-rename-baseline-20261102/`. Never restore whole overlapping files from HEAD, stage unrelated work or clean user worktrees.

Implementation starts only after user plan approval and a validated hash-bound ADR consultation with three actual PROCEED reviews. All lifecycle state operations use `feature-state.py`; checkpoints record real human approval, not an auto-gate setting. A blocked consultation leaves application code unchanged.

Run upstream GitNexus impact before modifying each existing function/class/method, report direct callers/flows/risk and warn before HIGH/CRITICAL edits. The current index predates dirty updater code, so verify source contracts too. Planning checks: `record_edit_snapshot` CRITICAL, 15 direct dependents/17 flows/69 symbols; `useLibrary` LOW, 3 direct dependents/1 flow; `App` LOW with incomplete JSX coverage. Refresh checks during execution; these values do not authorize unchecked edits to other symbols.

Every task is a bounded 2–5 minute implementation slice, not a promise that the entire feature takes one short session. Read its exact input files before editing. If a slice needs more work, split it into same-agent sequential subtasks with the same acceptance and ownership; do not silently expand file scope. Each implementation dispatch uses a fresh instance of the listed agent type. Wave N must pass its verification checkpoint before Wave N+1. Parallel mode is enabled only for explicitly disjoint file sets; do not start concurrent Cargo jobs against one target directory.

## Contract to implement

### Native module and state

Add `src-tauri/src/tag_rename.rs` as a child of `backend`, following the existing `milestone5.rs` pattern; re-export narrow command/DTO names from backend. Put its tests in `tag_rename_tests.rs`. Keep existing authorization, manifest and scanner helpers in place rather than refactoring bulk writes broadly.

Add native-owned pending-preview and settings-retry state to `Inner`, initialized empty by `BackendState::load`. Preview state is per approved library and stores an opaque UUID, normalized exact/prefix mapping, approved root, target identities/revisions, owning sidecar source bytes, skipped/uninspectable data and the validated frontend-supplied saved-search replacements (search ID, exact expected filters, new filters). New preview supersedes prior preview for that library; apply consumes it. No client-supplied target list is accepted.

Use conservative invalidation at existing scan/settings/single-tag/notes/bulk/recovery/Trash mutation boundaries. A scan invalidates pending preview but can retain a separate settings-retry proof; retry must revalidate that proof. Relevant local writes invalidate preview even when later apply would also catch changed bytes. Unchanged helper behavior and locking must remain intact.

### Narrow DTO surface

Mirrored Rust/TypeScript types must describe:

- Request: mode `exact|prefix`, source and destination names, plus the active-library saved-search replacements computed by the TypeScript parser, each with search ID, expected filters and new filters. UI active-query migration and all saved-search rewrites are preflighted locally before requesting preview.
- Preview: opaque ID, library ID, scan ID, normalized mapping, fresh `ScanResult`, exact target row summaries, file/folder and sidecar counts, destination-exists flag, per-row duplicate-collapse count, skipped known matches, uninspectable metadata/issues, saved-search update count and whether this is an authorized settings-only retry.
- Apply result: preview/library IDs, normalized mapping, committed Asset DTOs, failed-group rows, unattempted rows, skipped/uninspectable information, committed saved searches, error, and outcome `complete|partial|settings-failed` plus explicit query-migration success.

Names may follow surrounding code idiom, but do not omit identity/partition validation or replace native-owned proof with a client hash. Native errors before writes return no committed changes; errors after writes must use a committed result, never a bare rejection that hides saved rows.

### Preview and cancellation

One explicit Preview action invokes a cancellable native read-only scan with progress and the existing cancellation registry. Do not reuse `scan_library` as-is: it persists scan summary settings, which preview must not do. Reuse `scan_tree_cancellable`, root validation and snapshot recording. After traversal, reacquire mutex and revalidate root/library, cancellation and mutation generation before publishing the snapshot/preview. Discard an outcome if a conflicting mutation occurred during traversal. Clean cancellation registration on success, error, cancellation and supersession.

Snapshot/preview publication writes only app memory. Show fresh catalog/issues without resetting navigation, sort, selection or layout; if external deletion requires existing invalid-folder behavior, do not mask it as rename navigation. Apply never triggers another scan.

### Mutation and settings boundary

All matching editable rows preflight before writes. Revalidate exact preview target/revision/ownership bindings and bound sidecar bytes, including multiple targets sharing one sidecar. Reject a stale preview before any mutation. Use existing atomic replacement abstraction; serialize every affected group before the first write. Hold the backend mutex throughout grouped sidecar commits and settings persistence; do not call the mutex-acquiring `BackendState::mutate` recursively.

Group by owning sidecar and update each once. Exact mode replaces only that tag; prefix mode maps only tags beginning with `source:` while preserving the full suffix. Normalize only targeted entries and preserve all other metadata and asset paths/bytes. Update cached native rows/revisions for committed groups, including partial success. A failed group and later groups remain unapplied and appear explicitly in the result.

After all eligible sidecars succeed, apply only the preview-bound active-library saved-search replacements, preserving all other settings fields. Native never derives query text itself. Persist through the existing settings writer.

If persistence fails:
- restore in-memory searches;
- retain committed asset rows;
- create an in-memory retry proof bound to the mapping, committed row revisions/root and the bound replacement set with its unchanged expected filters.

Expose retry in the outcome dialog so removing the old sidebar tag does not remove recovery access. A fresh preview validates that proof; only this proof permits zero-target settings migration. All-skipped/no-match operations cannot retarget queries. Restart recovery is not claimed because proof is not durable.

Active query changes only when sidecars and settings finish successfully. Partial sidecar failures and settings failure leave active query unchanged and show the limitation. Skipped rows may retain old tags even after eligible success; keep this warning visible before confirmation and in the outcome.

### Query migration

Use the existing parser's source spans and ASCII/smart-quote behavior, not a whitespace-only parser or substring replacement. Replace required and excluded tag tokens; retain exclusion signs, all other bytes/whitespace and quoted path text. Prefix migration has no wildcard meaning.

The query language is evaluated only in `src/catalog.ts`, and native settings store query text opaquely. All query rewriting therefore lives in TypeScript, with no Rust tokenizer.
- Query fixtures are TypeScript-only.
- A small shared JSON fixture of mapping-normalization cases (exact/prefix names, trim/lowercase, invalid/unchanged names) is consumed by both Rust and TypeScript tests.
- Native validates each submitted replacement and returns the bound replacement count in the preview. It checks four things:
  - the search ID exists;
  - the search belongs to the active library;
  - its exact current filters equal the expected filters;
  - the new filters pass existing saved-search validation.
- It rejects the preview if the submitted mapping differs from its own normalization.
- Native cannot detect a search the frontend omitted. The TypeScript parser is authoritative for which searches need migration.

Existing tag storage allows names that the query language cannot express as a single required/excluded tag token. Do not change query grammar or ban those names globally.
- Before preview, reject an operation only if a query token that must migrate would become unrepresentable or change meaning.
- Show an actionable error to edit the affected active/saved search or choose another name. This is a query-migration precondition, not a new general tag-edit restriction.
- Cover destinations with spaces, quote-leading strings and leading minus, and preserve token role.
- The UI validates both the active query and every saved-search rewrite before requesting preview.
- Nonmatching queries require no migration.

## Wave 1: Baseline, query/mapping fixtures and contracts

### T1 — Record baseline verification and query cases

- **Agent:** `testing-automation-engineer`
- **Duration:** 5 min
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/.git/tag-rename-baseline-20261102/`, `/Users/coffeemug/Programming/tag-based-asset-manager/fixtures/tag-rename-queries.json`, `/Users/coffeemug/Programming/tag-based-asset-manager/fixtures/tag-rename-mappings.json`
- **Operations:**
  - Validate existing baseline hashes.
  - Run the existing full frontend suite/build and locked Rust tests/format/strict Clippy sequentially, retaining exact exit codes and summaries privately.
  - Create TypeScript query cases for:
    - exact/prefix;
    - exclusions;
    - mixed ASCII/smart quotes;
    - tabs/newlines and Unicode whitespace (U+FEFF, NBSP, U+2028);
    - astral characters;
    - partial tag names;
    - nested-colon suffixes;
    - no-op/invalid names;
    - unrepresentable destinations.
  - Create shared mapping-normalization cases for Rust and TypeScript.
  - Do not change fixture library originals or fix unrelated failures.
  - Long-running checks may finish in background; do not claim completion before their result.
- **Verification:**
  - Baseline commands listed below return recorded statuses.
  - Both JSON files parse, and each case contains input/mapping/expected output or an explicit error.
  - Existing failures block later waves rather than disappearing into feature work.
- **Parallel-safe:** false; baseline commands complete before product edits.

### T2 — Add TypeScript query migration tests and helper

- **Agent:** `typescript-frontend-engineer`
- **Duration:** 5 min
- **Dependencies:** T1
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src/catalog.ts`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/catalog.test.ts`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/tagRename.ts`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/tagRename.test.ts`
- **Operations:**
  - Add failing tests consuming the query and mapping fixtures.
  - Expose source-span tokenization from catalog with no change to parseQuery results; use it for token-role-preserving rename validation/rewrite.
  - Add a pure helper that derives active-library saved-search replacements (search ID, expected filters, new filters) and representability errors from saved searches plus mapping.
  - Run impact for parseQuery and any existing function changed first.
  - Keep mapping/query code independent of React.
- **Verification:** Record RED then GREEN for `pnpm exec vitest run src/catalog.test.ts src/tagRename.test.ts`; run `pnpm exec tsc --noEmit`.
- **Parallel-safe:** true with T3; T1 must already be complete.

### T3 — Add Rust rename mapping domain with shared mapping fixtures

- **Agent:** `general-purpose` (Rust scope)
- **Duration:** 5 min
- **Dependencies:** T1
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename_tests.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/backend.rs`
- **Operations:** Register child module/tests. Add rename modes/name normalization and exact/prefix tag-array mapping matching the shared mapping fixture. Tests precede helper implementation. Reuse manifest normalization and do not change it. Add no query tokenizer or query rewriting in Rust.
- **Verification:** Record RED/GREEN for `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline tag_rename`; format check.
- **Parallel-safe:** true with T2; no shared source files or fixture writes.

**Wave checkpoint:** Full catalog/rename helper tests, Rust rename helper tests and TypeScript check pass. Shared mapping-fixture expected values agree in both languages; query fixtures pass in TypeScript.

## Wave 2: Native preview and invalidation

### T4 — Native-owned preview/retry types and invalidation hooks

- **Agent:** `general-purpose` (Rust scope)
- **Duration:** 5 min
- **Dependencies:** T3
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename_tests.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/backend.rs`
- **Operations:** Add DTOs and per-library state to Inner/load. Add tests proving supersession, consumption, unknown-library rejection, query binding, and scan/settings/single-tag/notes/bulk invalidation. Connect the smallest mutation boundary hooks; do not refactor unrelated bulk behavior. Run impact and publish warnings before existing function edits.
- **Verification:** RED/GREEN targeted invalidation tests; `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline tag_rename`.
- **Parallel-safe:** false; native files single-owner.

### T5 — Recovery/Trash invalidation and updater exclusion

- **Agent:** `general-purpose` (Rust scope)
- **Duration:** 5 min
- **Dependencies:** T4
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/milestone5.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/asset_operations.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename_tests.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/update_install_tests.rs`
- **Operations:** Test then connect preview invalidation for reconnect, missing-entry removal and committed Trash outcomes. Assert updater installation cannot interleave with rename writes or preview scan; retain original updater checks and mutex ownership. No external dispatcher or native picker calls in tests.
- **Verification:** Targeted rename, recovery, Trash and install-lock tests pass, followed by `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline`.
- **Parallel-safe:** false; follows T4, single Cargo target.

### T6 — Fresh cancellable read-only preview

- **Agent:** `general-purpose` (Rust scope)
- **Duration:** 5 min
- **Dependencies:** T5
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename_tests.rs`
- **Operations:**
  - Test then add explicit preview scanning, progress/cancel registration, root/generation revalidation, snapshot publication and exact target/owner/byte binding.
  - Count all nested file/folder targets, distinguish merge existence from duplicate collapses, and list known skips/uninspectable paths.
  - Validate and bind the submitted saved-search replacements before the scan starts and again before publication. Reject any replacement that:
    - has an unknown ID;
    - belongs to another library;
    - has expected filters that differ from current settings;
    - has new filters that fail saved-search validation;
    - uses a mapping that differs from native normalization.
  - Prove preview leaves settings/sidecar/asset bytes unchanged, discovers external additions before preview, and cleans registrations for every terminal path.
- **Verification:** `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline tag_rename` plus snapshot/scanner regressions pass.
- **Parallel-safe:** false; native module follows state hooks.

### T7 — Mirror native DTOs and bridge methods

- **Agent:** `typescript-frontend-engineer`
- **Duration:** 5 min
- **Dependencies:** T6
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src/types.ts`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/native.ts`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/native.test.ts`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/useLibrary.test.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/App.test.tsx`
- **Operations:** Mirror actual native preview/result contracts; add required client preview/apply methods and bridge invoke/progress tests. Update existing LibraryClient mock factories with inert defaults, preserving dirty updater tests. Do not make methods optional to hide mock omissions. Apply impact to each existing edited factory/method.
- **Verification:** TypeScript check and native bridge/hook/App existing tests pass; DTO JSON casing and command argument shape match Rust serialization tests.
- **Parallel-safe:** false; publish actual native DTOs before frontend bridge.

**Wave checkpoint:** Full Rust suite and existing frontend suite/typecheck pass. Preview tests prove zero persistent writes and cancellation cleanup. No apply command registered yet.

## Wave 3: Native apply and search persistence

### T8 — Revision-bound grouped sidecar preparation

- **Agent:** `general-purpose` (Rust scope)
- **Duration:** 5 min
- **Dependencies:** T6
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename_tests.rs`
- **Operations:** Add tests then preflight exact opaque preview, current root/target set/revisions, ownership, duplicate UUID guards and source bytes. Build all grouped/serialized sidecars before writing; preserve UUID/notes/unknown/stale entries, root/self/legacy folder behavior and skipped rows. Require at least one eligible target unless verified settings-retry proof exists.
- **Verification:** `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline tag_rename` passes stale-target, same-sidecar, owner-conflict, duplicate-ID and byte-preservation cases with injected writers reporting zero calls on preflight errors.
- **Parallel-safe:** true with T10 only; T8 precedes T9.

### T9 — Sequential commit, exact partitions and snapshot revisions

- **Agent:** `general-purpose` (Rust scope)
- **Duration:** 5 min
- **Dependencies:** T8
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename_tests.rs`
- **Operations:** Test then execute one atomic write per owner under mutex. Return exact committed/failed/unattempted partitions on first writer failure; update cached rows/revisions only for committed groups. Include tests that a subsequent ordinary metadata edit accepts committed revision without Rescan and that failed groups retain original bytes.
- **Verification:** Inject failures at first/middle/last group; assert exact write counts/partitions, unchanged assets/skips and cached revisions. `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline tag_rename` passes.
- **Parallel-safe:** true with T10; native code single-owner.

### T10 — Serialized preview/apply hook with committed-state validation

- **Agent:** `typescript-frontend-engineer`
- **Duration:** 5 min
- **Dependencies:** T7
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src/useLibrary.ts`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/useLibrary.test.tsx`
- **Operations:** Add failing hook tests. Then add serialized preview/apply operations that compute saved-search replacements through the T2 helper before each preview request, progress/cancel controls and stale library/generation/unmount rejection. Publish preview catalog without session reset; validate identities, unique/exhaustive result partitions, requested paths and committed search library IDs before applying state. Apply valid partial rows despite result error; preserve other settings and current summary. No optimistic tags, applyState call or post-apply scan.
- **Verification:** Hook tests prove concurrency guards, stale/malformed response rejection, partial/settings-failed results, cancellation and no extra scan. Full hook tests and TypeScript pass.
- **Parallel-safe:** true with T8/T9; no Rust files shared.

### T11 — Saved-search commit/failure and bound retry

- **Agent:** `general-purpose` (Rust scope)
- **Duration:** 5 min
- **Dependencies:** T9
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/tag_rename_tests.rs`, `/Users/coffeemug/Programming/tag-based-asset-manager/src-tauri/src/lib.rs`
- **Operations:**
  - Test that only the preview-bound replacements persist and that other settings/libraries stay unchanged.
  - Before any sidecar write, also re-check that every bound expected filter still equals current settings. A mismatch rejects the stale preview with zero writes.
  - Inject settings failure after committed sidecars. Roll back searches only, return committed assets and establish exact in-memory retry proof. Test fresh zero-target retry, changed search/root/committed-row rejection, and all-skipped/no-match refusal. Keep mutex across both stores without recursive mutate lock. Register preview/apply commands in run after impact; preserve all updater registrations.
- **Verification:** Native migration/partial/failure/retry tests and full locked Rust suite pass; formatting/strict Clippy pass. Assert no settings write on partial sidecar failure or preview.
- **Parallel-safe:** false with other native tasks; may overlap T10 only when contracts remain unchanged.

**Wave checkpoint:** Full frontend tests/typecheck/build and locked Rust tests/format/strict Clippy pass. Source API is integrated, still no production application launch.

## Wave 4: Accessible rename UI and App integration

### T12 — Rename dialog draft, preview and outcome

- **Agent:** `ui-design-engineer`
- **Duration:** 5 min
- **Dependencies:** T10, T11
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src/components/TagRenameDialog.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/components/TagRenameDialog.test.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/App.css`
- **Operations:** Add failing UI tests then dialog with prefilled name, validated explicit Preview, normalized mapping, whole-library counts, merge/skips/uninspectable disclosures and explicit confirm. Editing draft invalidates preview; pending work cannot apply an old preview. Provide cancellation, backup/no-undo notice, partial/settings-failed persistent outcome and retry access after sidebar source disappears. Reuse theme tokens and dialog conventions; no new dependency or native action performed inside component.
- **Verification:** `pnpm exec vitest run src/components/TagRenameDialog.test.tsx` and TypeScript pass; test focus trap, Escape, pending state and outcome announcement.
- **Parallel-safe:** false with T13/T14 because App.css/integration ownership is sequential.

### T13 — Sidebar portal menus and keyboard/focus

- **Agent:** `typescript-frontend-engineer`
- **Duration:** 5 min
- **Dependencies:** T12
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src/App.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/App.test.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/App.css`
- **Operations:** Add tests then exact-tag/prefix-group context actions using existing portal/menu styles. Colon-bearing tags establish eligible prefix groups; a same-name plain tag stays exact-only. Support pointer, context-menu key and Shift+F10, Escape/outside/wheel dismissal, viewport placement, menu item focus and return focus. Provide stable TAGS fallback when renamed source disappears. Do not turn filter click into rename or nested buttons.
- **Verification:** App keyboard/pointer/focus tests and existing row context-menu tests pass; no regression in tag filtering.
- **Parallel-safe:** false; App ownership follows T12.

### T14 — Session preservation, active query and updater blockers

- **Agent:** `typescript-frontend-engineer`
- **Duration:** 5 min
- **Dependencies:** T13
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/src/App.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/App.test.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/components/TagRenameDialog.tsx`, `/Users/coffeemug/Programming/tag-based-asset-manager/src/components/TagRenameDialog.test.tsx`
- **Operations:** Wire hook results to dialog/menu; migrate active query only on complete query-migration success. Preserve selected IDs/folder/sort/column layout through preview/apply; display old-query limitations after partial/settings errors. Close/ignore stale dialog work on library switch, cancellation and unmount. Include all rename drafts/preview/apply/retry states in updater blocker and busy controls. No weakening of fixed update checks or existing notes/tag draft guards.
- **Verification:** Integration tests cover nested-library counts from root/current folder, partial/settings failure, zero-target retry, skipped-old-tag warning, query/path-text preservation, layout/selection/folder persistence and update-install blocking. Full frontend suite/typecheck/build pass.
- **Parallel-safe:** false; same App/dialog files as prior UI tasks.

**Wave checkpoint:** Full automated frontend suite, build and locked Rust suite pass. Keyboard tests are jsdom evidence, not WKWebView/Windows acceptance.

## Wave 5: Review, documentation and final verification

### T15 — Independent feature-scope correctness review

- **Agent:** `reviewer-skeptical-senior`
- **Duration:** 5 min
- **Dependencies:** T14
- **Files:** Read-only review of `/Users/coffeemug/Programming/tag-based-asset-manager/.git/tag-rename-baseline-20261102/`, approved ADR/design/plan and all rename source/test changes.
- **Operations:** Review incremental changes against the captured dirty baseline, not all pre-existing updater diff. Trace preview/apply authorization, cancellation, byte/revision guards, partition reporting, settings retry, saved-search replacement binding, TypeScript query rewriting, mapping parity, UI lifecycle and updater exclusion. Return concrete verified failure scenarios; no edits or redelegation.
- **Verification:** Run `git diff --check`; parent verifies every finding against source/tests and records its disposition in the private review log. Blocking defects return to the owning domain agent with RED/GREEN evidence and rerun impacted checks. Architecture deviations require human gate, not silent changes.
- **Parallel-safe:** false; freeze product edits during review.

### T16 — Public feature docs and manual acceptance limits

- **Agent:** `technical-documentation-engineer`
- **Duration:** 5 min
- **Dependencies:** T15 and resolved blockers
- **Files:** `/Users/coffeemug/Programming/tag-based-asset-manager/README.md`, `/Users/coffeemug/Programming/tag-based-asset-manager/docs/product-backlog.md`, `/Users/coffeemug/Programming/tag-based-asset-manager/docs/metadata-format.md`, `/Users/coffeemug/Programming/tag-based-asset-manager/docs/manual-test-plan.md`, `/Users/coffeemug/Programming/tag-based-asset-manager/docs/progress-log.md`, `/Users/coffeemug/Programming/tag-based-asset-manager/CLAUDE.md`
- **Operations:**
  - Document actual rename entry points, fresh preview scope, partial/settings semantics, skips, query limitations, session-only retry, no undo and backup recovery.
  - In `CLAUDE.md`, change only rename-relevant lines in "Current implementation boundary", "Architecture", "Search behavior" and "Metadata persistence". This includes the invariant that new metadata write paths must invalidate pending previews.
  - Leave its GitNexus and Agent Orchestration sections alone, and do not touch `AGENTS.md`.
  - Preserve existing dirty updater text and existing uncommitted `CLAUDE.md` edits. Mark source/tests complete only after evidence exists; distinguish unverified native UI/platform acceptance. Do not mark release/Store acceptance complete.
- **Verification:** Run `git diff --check` and a Python local-link/path validation against the six assigned docs; no private machine/evidence paths in public feature docs. Parent verifies each completion claim against test records.
- **Parallel-safe:** false; docs follow actual outcome.

### T17 — Full final verification and dirty-work preservation audit

- **Agent:** `testing-automation-engineer`
- **Duration:** 5 min
- **Dependencies:** T16
- **Files:** Read-only product review plus private logs under `/Users/coffeemug/Programming/tag-based-asset-manager/.git/tag-rename-validation-20261102/` and lifecycle checkpoints through script.
- **Operations:** Run all final commands below sequentially where toolchain shares build output. Compare hashes and incremental diff to baseline; reject unexpected changes outside planned files, untouched fixture/library originals, dependencies, CI/updater source and original dirty content. Report every failure/skipped gate. Parent saves implementation/validation checkpoints only for actual passing state; no commit/push/release phase.
- **Verification:** Exact command exits/logs, baseline comparison and complete success-criteria evidence matrix. Background completion notifications, not polling, determine finished jobs.
- **Parallel-safe:** false; final source frozen.

## File conflict analysis

| Tasks | Overlap | Ordering |
|---|---|---|
| T2 / T3 | None; query and mapping fixtures are read-only after T1 | May run concurrently |
| T3–T6, T8–T9, T11 | tag_rename.rs/tests and sometimes backend.rs | Native tasks strictly sequential |
| T7 / T10 / T13–T14 | Client mocks, hook, App tests across different stages | T7 finishes before hook/UI work |
| T8–T9 / T10 | No shared writable files or build tooling | May run concurrently |
| T11 / T10 | No shared writable files; actual DTOs already fixed | May overlap only without contract drift |
| T12 / T13 / T14 | App.css and later dialog/App integration | Strictly sequential |
| T15–T17 | Review, public docs and final source verification | Strictly sequential; freeze source for review/checks |

No concurrent task writes the same file. No agent changes branch/state/ADR/plan unless explicitly assigned; parent owns lifecycle and scope synthesis.

## Requirements coverage matrix

| Requirement | Observable outcome | Tasks |
|---|---|---|
| R1 | Pointer and both keyboard menu routes open Rename and restore focus | T12–T14 |
| R2 | Prefilled normalized whole-library preview precedes confirm | T3–T7, T10, T12, T14 |
| R3 | Destination merge disclosed; no duplicate target tags | T2–T3, T6, T8–T9, T12 |
| R4 | One owner write; UUID/notes/extras/stale entries/assets preserved | T8–T9, T11, T15, T17 |
| R5 | Missing/blocked skip and unknown/uninspectable scope explicit | T6, T8–T9, T12, T14 |
| R6 | All-target preflight and exact committed/failed/remaining reports | T4–T6, T8–T11, T15 |
| R7 | Root/self/legacy ownership works without inheritance | T6, T8–T9 |
| R8 | Committed-only cached/UI rows; no apply rescan or session reset | T9–T10, T14, T17 |
| R9 | Queries/searches migrate with correct token semantics and failure policy | T1–T3, T6, T10–T11, T14 |
| R10 | Prefix suffixes preserved and plain tags unaffected | T1–T3, T6, T8–T9, T13 |
| R11 | No undo; confirmation, backup and partial limits explained | T12, T14, T16 |
| R12 | Automated safety, stale-state, retry, keyboard and focus evidence | T1–T17 |

Coverage: 12/12 design requirements mapped. No requirement deferred; native platform acceptance remains an explicit verification limit rather than a completed gate.

## Success criteria

1. A tag or eligible prefix group offers Rename through pointer, context-menu key and Shift+F10; dismissal and completion return focus predictably.
2. Preview is a fresh cancellable read-only whole-library view with exact eligible counts, merge disclosure and named skipped/uninspectable items; no persistent bytes change before confirmation.
3. Confirmed exact/prefix renames preserve asset bytes/paths and untargeted metadata, normalize only changed tags, write each affected owner once and preserve root/self/legacy ownership.
4. Stale, replayed or altered confirmation cannot write. Preview/cancel/root change/conflicting mutation and install-lock tests pass.
5. Partial sidecar failure exposes the precise committed/failed/unattempted partition and shows committed rows only; later groups and skipped rows remain untouched.
6. Successful operations migrate only active-library saved-search and active-query tag tokens, preserving quote/path/whitespace/exclusion semantics and all other settings. Unrepresentable migrated query tokens fail before writes with a clear error.
7. Settings failure never hides committed tags or falsely retargets queries. Explicit session-bound retry can finish migration with zero remaining targets; all-skipped/no-match operations cannot misuse that path.
8. Folder, selection, sort/layout and unrelated updater work survive. Apply performs no rescan. Rename drafts and operations block updater installation.
9. Full frontend tests/build and locked Rust tests/format/strict Clippy pass with recorded evidence. Original sample-library bytes, dependency/CI files and pre-existing unrelated dirty work remain unchanged.
10. Documentation states actual source/test outcome, no undo/transaction/crash-recovery promise, and unverified native UI/platform/release gates. No commit, push, launch or publication occurs.

## Final verification commands

Run from repository root using existing installed dependencies. If Rust is absent from PATH, use the documented Homebrew rustup PATH only; install nothing. Use locked/offline Rust resolution when existing cache permits; a missing cached dependency blocks rather than authorizing installation.

```bash
pnpm exec vitest run --reporter=dot
pnpm exec tsc --noEmit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings
node --test 'scripts/*.test.mjs'
git diff --check
```

Existing ignored benchmark stays identified as ignored, not silently counted as passed. No frontend lint pass is claimed because no lint script/config exists. Validate query/mapping fixture consumption, DTO casing/identities, local docs links, baseline hashes and exact feature file scope with deterministic scripts. Use GitNexus detect_changes for final impact review if available; no commit is authorized. Tests do not prove production package or native UI acceptance.

## Approval and next gate

The user replied `approved` on 2026-11-02 after the explicit request to approve this implementation plan. Record that human approval through the plan checkpoint and advance using `feature-state.py`; gate policy stays human. Run the required three-lens `adr-consultation` on the approved ADR/design/plan and verify hashes/PROCEED immediately before T1 and product changes. Any consultation-driven architecture change is returned for the required human decision rather than treated as already approved.

On 2026-11-03, consultation `review-20261103T161401644330Z` validated PROCEED for the pre-amendment bytes, and the user then made two human decisions:
- **CON-3:** the user replied "would you prefer it? if so then proceed". The assistant recommended TypeScript-side query rewriting, so the Rust tokenizer was removed.
- **MP-7:** the user selected "Add to T16".

The amended text has not been separately re-read by the user. A fresh three-lens consultation on the amended ADR/design/plan bytes is required before T1. The previous consultation's accepted execution conditions in its `synthesis.md` still apply wherever they remain relevant.
