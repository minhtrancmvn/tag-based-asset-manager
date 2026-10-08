# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Model Routing

Use Opus as primary model for planning and synthesis. Delegate independent bounded work to Sonnet, mechanical research to Haiku, and use Fable only if architectural ambiguity warrants its cost. Verify all outputs.

## Development commands

Run commands from repository root. Use Node.js 24+ and pnpm 12 (`packageManager` pins `pnpm@12.4.2`); install with `pnpm install --frozen-lockfile`.

| Task | Command |
|------|---------|
| Browser-only development | `pnpm dev` |
| Native desktop development | `pnpm tauri dev` |
| Frontend type check and production build | `pnpm build` |
| Type check without building | `pnpm exec tsc --noEmit` |
| Preview built frontend | `pnpm preview` |
| Full frontend test suite | `pnpm test` |
| Watch frontend tests | `pnpm test:watch` |
| One test file | `pnpm exec vitest run src/catalog.test.ts` |
| One named test | `pnpm exec vitest run src/catalog.test.ts -t 'parses required tags and NOT tags'` |
| Named test output | `pnpm exec vitest run --reporter=verbose` |
| Rust format check | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` |
| Rust test-profile compilation/tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Native release executable only | `pnpm tauri build --no-bundle` |
| Native bundles for current host | `pnpm tauri build` |

No frontend lint script or ESLint configuration exists; TypeScript checking is not a substitute for linting. Rust tests cover app-data settings and read-only scanner/path behavior; native picker/platform interactions still require manual tests. Use `pnpm exec vitest` when passing runner flags such as `--reporter`; pnpm can consume them when passed to `pnpm test`.

Native commands need Rust stable and Tauri platform prerequisites. For Homebrew-managed Rust missing from PATH, use `export PATH="$(brew --prefix rustup)/bin:$PATH"`. See `README.md` for Xcode Command Line Tools, Windows C++/WebView2 setup, and cross-target builds. Frontend output is `dist/`; native executables and bundles are under `src-tauri/target/release/` and `src-tauri/target/release/bundle/`. Windows/Intel builds and signed installers remain unverified.

## Current implementation boundary

MVP code includes sidecar tags, confirmed grouped bulk editing, filters/saved searches, native open/reveal/copy, fresh metadata validation, explicitly confirmed same-folder reconnect and native-selected new JSON backups. Windows, Intel macOS and OneDrive release acceptance remain unverified. Libraries approved through Rust picker; roots/active library persist in app-data. Rust scans files/folders and per-directory manifests off-thread. Single-row edits write only owning sidecar, never asset contents/paths. Notes editing, import, asset rename/arbitrary moves and permanent delete remain deferred. Explicit confirmed Delete now moves selected scan-authorized items to system Trash / Recycle Bin, with no permanent-delete fallback and no remaining-sidecar writes. Details preview allows bounded UTF-8 text (64 KiB) and raster image (8 MiB) reads only through approved asset IDs; HTML/SVG execution and general filesystem access remain prohibited. Repair only transfers valid missing metadata to explicitly selected untagged same-folder regular file, preserving UUID/tags/notes; no file matching/hash or asset operation. Export destination accepted exclusively from Rust native save picker, new JSON only, never existing asset/sidecar overwrite. Bulk edits preflight all targets, write once per owning sidecar and return completed assets plus error on later failure; no cross-directory transaction/rollback. Saved searches persist in app-data settings with backward-default empty list, never library metadata. App theme is a strict lowercase preset in app-data settings, defaults to workshop for legacy installs; set_app_theme returns committed state and shared settings mutation rolls it back on failure. Row ID stays path-derived; metadataId stores durable sidecar UUID. Selection/filters/layout session-only. Browser mode requires desktop, no silent demo rows. Preserve deduplicated UI: library identity in sidebar, single catalog progress/Rescan.

`fixtures/sample-library/` contains inert model placeholders, manifests, Unicode path and intentional missing reference. Fixture tests read JSON separately; app scans fixture only when explicitly chosen. Rust parses sidecars separately from displayed asset listing and reports malformed/missing/duplicate states; never repairs during scan. Mutate fixture copies only in native tests, not repository fixture.

## Architecture

React mounts through `src/main.tsx`. `src/App.tsx` owns session state for browse views/query, current folder path, navigation history, selection, sorting, virtualized viewport, column layout and inspector. `src/folderBrowse.ts` projects recursively scanned assets into direct children and breadcrumbs; UI shows only current folder level while backend retains recursive scan index. Folder double-click navigates in app; explicit native Open opens OS folder. Filtering/counts/issues are scoped to current folder. `src/types.ts` mirrors native Asset/LibraryState/ScanResult/ScanProgress/AppError DTOs. `src/native.ts` uses invoke plus Channel; `src/useLibrary.ts` serializes metadata/settings operations, applies committed partial bulk results and rejects stale scan responses. Search/theme preference changes do not clear/rescan catalog. Theme tokens apply at document root so menus rendered through portals inherit the selected palette; src/themes.ts defines light presets and dark Midnight. `src/savedSearches.ts` serializes/validates query/view/match mode/kind; dialogs own draft/confirmation UI only. UI changes belong in App; parser/filter/sort logic stays independent of React in catalog.

Rust `src-tauri/src/main.rs` delegates to `src-tauri/src/lib.rs`, which registers backend library commands. `src-tauri/src/backend.rs` owns picker, root authorization, settings and scanner. `src-tauri/capabilities/default.json` grants only `core:default`; dialog/opener/clipboard plugins used from Rust, no broad frontend filesystem/dialog/opener/clipboard grants. `src-tauri/src/milestone5.rs` contains native actions, read-only validation, recovery and create-only backup publication; milestone5_tests.rs tests dispatcher/writer abstractions without opening user assets. Native API accepts library IDs rather than arbitrary requested paths. Manifest module owns strict parse/normalization/revisions/atomic replacement; edit_tags accepts library ID, asset row ID, expected revision, add/remove tag arrays. No arbitrary frontend filesystem API. Tagging leaves asset contents/paths unchanged; asset_operations.rs owns explicit Trash and bounded preview exceptions with injected dispatcher tests. Stop cancels scan cooperatively during traversal/metadata merge; stale UI results discarded. Catalog Up belongs in toolbar; folders always precede files. Target revision excludes unrelated entries; exact fresh bytes rechecked before replace. Missing/blocked rows cannot tag-edit; valid missing rows can request revision-bound manual reconnect only. No optimistic frontend metadata. Native operations serialized through hook, validation/export outputs reset on library changes. Row context menu uses document-body portal and ignores layout scroll; user wheel/Escape/outside interaction closes it.

`src-tauri/tauri.conf.json` runs `pnpm dev` before native development and `pnpm build` before native release, consuming `../dist`. `vite.config.ts` wires React and Tailwind CSS v4, fixes development at `http://localhost:1420` with `strictPort`, and excludes Rust sources from Vite watching. Do not start a second Vite server on that port when using `pnpm tauri dev`. `src/App.css` imports Tailwind and bundled fonts; runtime needs no remote font service.

`vitest.config.ts` limits discovery to src tests to avoid nested worktree copies. Vitest uses Node by default; `src/App.test.tsx` opts into jsdom with its file-level environment directive and uses Testing Library. Fixture tests use Node filesystem APIs against repository fixtures only.

## Search behavior

`src/catalog.ts` owns query parsing and in-memory catalog operations. Required tags default to AND; Any mode uses OR for required tags only. Excluded tags and quoted text always required. Kind filtering combines with browse view/query:

- Unquoted tokens require exact tags, including plain tags without `:`. Matching trims whitespace and ignores case; `Favorite` requires tag `favorite`, not a filename substring.
- `-status:printed` excludes that exact tag.
- Quoted phrases such as `"Flexi Dragon"` match relative-path text case-insensitively.

Keep these semantics distinct when changing query handling. `src/catalog.test.ts` covers parser/filter/sort helpers; `src/App.test.tsx` covers UI interaction; `src/fixtures.test.ts` covers repository fixture consistency.

## Metadata persistence

`docs/metadata-format.md` specifies version-1 per-directory `.asset-tags.json`; no authoritative global path database. Entries use `.` or direct-child basenames with stable UUIDs, tags and optional notes; folder tags do not inherit. New folder tags use self `.`; existing parent folder entry honored if no self entry exists. Both-present ownership conflicts block edits and remain for later manual reconciliation. Scans generate no UUID or sidecars; first explicit metadata edit assigns identity. Preserve existing UUID/notes/unknown fields/stale entries.

Future native work must authorize library roots in Rust, reject traversal/symlink escapes, preserve malformed manifests and stale references, and write sidecars atomically without modifying asset bytes or paths. Approved roots, UI preferences, and saved searches belong in local app-data. Read the metadata specification before implementing filesystem features.

`docs/progress-log.md` records milestone evidence and pending scope; `docs/manual-test-plan.md` separates current read-only native acceptance from future metadata/platform checks. Browser smoke results do not prove native WKWebView interaction.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **tag-based-asset-manager** (133 symbols, 197 relationships, 4 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST clean up agent-created worktrees after agents finish.** An agent is finished only after its task is complete and its changes are committed and pushed. Then remove its worktree immediately, run `git worktree prune`, and verify `git worktree list` contains no stale agent-created worktrees. Never remove active or user-created worktrees.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/tag-based-asset-manager/context` | Codebase overview, check index freshness |
| `gitnexus://repo/tag-based-asset-manager/clusters` | All functional areas |
| `gitnexus://repo/tag-based-asset-manager/processes` | All execution flows |
| `gitnexus://repo/tag-based-asset-manager/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->