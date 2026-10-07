# Tag-Based Asset Manager

Local-first Tauri v2 desktop catalog for ordinary files and folders. Milestone 5 completes native open/reveal/copy, metadata validation, confirmed reconnection and JSON backup export alongside tags, bulk edits and saved searches to native library registration/scanning. Tagging and scanning leave asset contents and paths untouched; tags live only in sidecars. Explicit Delete moves selected assets to system Trash / Recycle Bin after confirmation, and Details can preview supported files.

## Current milestone

Choose each library through native folder picker. Rust stores approved library registrations and active library in app-local data. Active library scans recursively on a background worker; progress, files/folders, relative paths, sizes, timestamps and recoverable scan issues appear in dense table. Rescan is manual. Stop in the scan progress bar cancels cooperatively and discards partial results, unlocking library selection without waiting for traversal to finish. Filesystem calls already in progress cannot be interrupted. Browsing is current-level only, but scanning still indexes the entire library recursively; lazy current-level scans are not implemented. Multiple libraries supported, one active at a time. Remove registration only after confirmation; files and sidecars remain untouched.

The table supports sorting, column resizing/hiding, Shift/Ctrl/Command multi-selection and optional details inspector. Scans retain a recursive index, while the catalog displays direct children of the current folder only; double-click a folder to enter, then use sidebar breadcrumbs or Up in the catalog toolbar to navigate back. Folders always appear before files, with the selected sort key/direction applied within each group. Root `.` remains in the scan/metadata index but is not a catalog row or item count. Filters, counts, tags and scan issues apply to the current folder. The selected library name comes from its root folder, not a fixed Workspace/development label. Browser-only development shows a desktop-required state, not fictional data. Fixture placeholders under [`fixtures/sample-library/`](fixtures/sample-library/) support automated tests; native user must explicitly select that folder to scan it.

Scans load tags, notes and UUIDs from each directory’s `.asset-tags.json`. Add a tag directly in row’s Tags column and press Enter; remove with chip’s remove button. Existing tags autocomplete and tag chips filter. Sidebar groups are derived from text before the first `:` and sorted alphabetically, with no predefined groups or fallback bucket: `material:pla` appears as `pla` under `material`; plain tags use their whole name as group. Clicking a shortened label still filters by the full exact tag. Single-row edit writes only owning sidecar; no separate edit mode. Notes displayed read-only. Scanning alone creates no manifests or UUIDs; first explicit metadata edit creates identity.

Malformed/unsupported manifests, duplicate identities, ownership conflicts and missing references surface visibly. Missing metadata remains in sidecar and Needs attention; no automatic deletion/repair. Edits reject blocked or missing targets and stale revisions. Notes editing, asset rename and arbitrary moves remain deferred. Delete in the context menu, inspector or bulk selection opens a two-step confirmation before moving items to Trash / Recycle Bin. Folder deletion includes contents and sidecars; remaining sidecar references are preserved for recovery. Native preflight checks approved scan IDs and fresh file kind/size/mtime, rejects root/missing/unsafe paths and overlapping parent/child targets. Partial failures preserve completed moves and report errors; no permanent-delete fallback. Restore through the OS file manager, then Rescan.

Open existing assets by double-click or inspector/context menu; reveal in Finder/File Explorer, copy full or relative path through native backend. Metadata warnings do not change asset contents. Missing paths cannot open; errors retain underlying details. Details previews UTF-8 text up to 64 KiB and PNG/JPEG/GIF/WebP up to 8 MiB through ID-authorized bounded native reads. HTML/SVG are not executed; models, PDF and other unsupported formats show a message instead of a fake preview. Preview availability still needs native platform acceptance.

Validate metadata scans fresh state and reports malformed manifests, missing referenced children, duplicate UUIDs, invalid tag fields and unreadable directories. It never repairs/deletes automatically. Missing entries can reconnect to an existing regular file in same folder with no metadata identity: choose target, review tags/notes/UUID, then explicitly Confirm reconnect. Only sidecar entry changes; no hashing, matching, rename or move.

Export metadata opens native save picker for one new JSON backup file. Backup contains scanned assets, issues, parsed metadata and exact readable sidecar bytes, including malformed sidecars. Existing destinations refused to protect ordinary files. Import deferred; backup is recovery record, not a live replacement catalog.

Select multiple rows and use Bulk tags. Review exact selected count, additions and removals; Cancel writes nothing. Confirm changes invokes native preflight for every target before any write. Changes sharing one sidecar are merged and replaced once. Across directories this is not a transaction: if later replacement fails, earlier completed rows stay saved and error reports applied count. No silent rollback of synced metadata.

Filter required tags using All (AND) or Any (OR), exclude tags with `-tag`, and limit kind to files/folders. Save current query/view/mode/kind with a name. Saved searches scoped per registered library; create, explicitly update/overwrite, rename preserving filters, or confirm deletion. Stored in app-data settings, never library manifests. Restart restores searches; deleting search does not change assets.

## Prerequisites

- Node.js 24.x (milestone development used `v24.19.0`).
- pnpm 12.x (milestone development used `12.4.2`).
- For the desktop shell: Rust stable toolchain (`rustup`, `cargo`, `rustc`) and the platform prerequisites below.

### Windows 11

Install Microsoft C++ Build Tools with the **Desktop development with C++** workload. Install the Microsoft Edge WebView2 Runtime if it is not present. Install Rust using rustup and select the MSVC toolchain. Follow the current [Tauri v2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

### macOS (Apple Silicon and Intel)

Install Xcode Command Line Tools with `xcode-select --install`. Install Rust using rustup and ensure `cargo` and `rustc` are on `PATH`. Follow the current [Tauri v2 macOS prerequisites](https://v2.tauri.app/start/prerequisites/#macos).

For Homebrew-managed Rust on macOS, install rustup and expose its keg binaries first:

```sh
brew install rustup
export PATH="$(brew --prefix rustup)/bin:$PATH"
rustup toolchain install stable
rustup default stable
```

The active Homebrew prefix resolves correctly on both Apple Silicon and Intel. Add the `PATH` line to your shell startup file to keep it across terminals. Confirm setup with `rustup --version`, `cargo --version`, and `rustc --version`. Rustup can also be installed from the official rustup installer; follow [Tauri macOS prerequisites](https://v2.tauri.app/start/prerequisites/#macos).

## Install and run

From the repository root, install exactly the dependency versions recorded in `pnpm-lock.yaml`:

```sh
pnpm install --frozen-lockfile
```

Run the frontend preview in a browser:

```sh
pnpm dev
```

Vite serves at `http://localhost:1420`. This is frontend-only; it does not launch the native desktop shell.

Run the desktop shell after installing platform prerequisites:

```sh
pnpm tauri dev
```

## Checks and production build

```sh
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`pnpm test` runs Vitest. `pnpm build` runs TypeScript checking and creates the Vite production assets in `dist/`. Latest recorded verification status, including any failing check, appears in [`docs/progress-log.md`](docs/progress-log.md); check that log before relying on build status.

## Build and package

`pnpm build` produces frontend assets in `dist/`; it does not produce a distributable desktop installer by itself. To build Tauri bundles for the current host platform after installing that platform's prerequisites, run:

```sh
pnpm tauri build
```

Tauri writes release executables under `src-tauri/target/release/` and platform bundles under `src-tauri/target/release/bundle/`. For an executable without installer bundles, use `pnpm tauri build --no-bundle` (verified on Apple Silicon). Windows and macOS packaging must be built and validated on their respective supported host environments; no signed release artifacts or signing configuration are supplied by this milestone. For Intel macOS from Apple Silicon, install `rustup target add x86_64-apple-darwin` and use `pnpm tauri build --target x86_64-apple-darwin`; cross-target output is under `src-tauri/target/x86_64-apple-darwin/release/`. Intel and Windows builds are not verified here. Apple Silicon macOS application bundle verified with `pnpm tauri build --bundles app`; unsigned output at `src-tauri/target/release/bundle/macos/Tag-Based Asset Manager.app`. This is not signed/notarized distribution; manual native integration acceptance still required. DMG installers can be requested via `pnpm tauri build --bundles dmg` on macOS, Windows NSIS via `pnpm tauri build --bundles nsis` on Windows host; neither installer path validated here.

## Architecture and safety boundary

- `src/App.tsx` renders library/table/error states; `src/catalog.ts` remains pure query/filter/sort logic.
- `src/useLibrary.ts` manages native library lifecycle and ignores stale scan results/progress after switching, removal or unmount. `src/native.ts` is the typed invoke/Channel bridge; `src/types.ts` mirrors native DTOs.
- `src-tauri/src/backend.rs` owns native folder picker, approved roots, settings persistence and off-thread scanning. `tauri-plugin-dialog` is used from Rust only; no frontend dialog or filesystem permission granted.
- Webview sends library IDs, never arbitrary scan paths. Rust canonicalizes approved roots and rejects traversal, links/junctions/reparse entries and changed canonical paths. Symlinked directories are not followed. Skipped/unreadable entries surface as issues.
- Scans inspect directory listings, file attributes and JSON sidecars, never asset contents. Explicit single-item tag edits normalize/merge metadata and atomically replace only corresponding sidecar with same-directory temporary file. Existing UUID, notes, unknown fields and stale entries retained. Malformed metadata blocks writes; changed target revisions reject stale edits. Tagging never renames, moves, deletes, uploads or duplicates assets. The separate confirmed Trash command is the only asset-removal path; it does not rewrite sidecars. Bounded preview is the only in-app asset-content read path. Settings writes—including saved-search query/view/mode/kind—remain app-data only. Export alone authorizes one native-selected new backup path outside libraries; no generic path write command exposed. Grouped bulk edits use same validation/write pipeline; every target preflighted before first sidecar replacement.
- `src-tauri/src/manifest.rs` owns strict manifest parsing, normalization, revision and atomic write logic; backend selects approved owners and supplies scanned metadata DTOs.
- Vite/Tailwind build the frontend; Vitest tests DTO bridge, asynchronous lifecycle, catalog and UI; Rust tests cover settings and scanner safety.

Canonical tags live in per-directory sidecars, never app-local catalog paths or database. Scan row IDs remain path-derived UI identifiers; `metadataId` is persistent manifest UUID. New folder tags use local `.` entry. Legacy parent-owned folder entries honored when no self-entry exists; both-present ownership conflicts block writes. See [`docs/metadata-format.md`](docs/metadata-format.md). Path-based checks protect against stable symlink escapes but are not a sandbox against a hostile process racing filesystem substitution between validation and native operations. Do not scan untrusted folders undergoing hostile concurrent mutation. Strong handle-relative traversal is a later hardening item. Removing registration stops future requests and discards its frontend results, but a scan already running can finish reading its previously approved root; it cannot restore removed registration.

## Search examples

- `category:animal style:flexi` — require both exact tags.
- `Favorite` — require exact plain tag `favorite` (case-insensitive matching).
- `-status:printed` — exclude assets with exact tag `status:printed`.
- `"Flexi Dragon"` — search relative path text, case-insensitively.

Unquoted tokens require exact tags, with or without colon. Quoted phrases search relative-path text. Required tags default to AND; Any mode matches at least one required tag. Excluded tags and quoted text remain mandatory in either mode. No required tags means no positive tag restriction. File/folder kind and Untagged/Needs attention views combine with query. Example `category:animal style:flexi -status:printed` matches unprinted flexi animals in loaded sidecar metadata. Clicking a chip adds its exact required tag without changing row selection.

## Known limitations

MVP supports single/bulk sidecar tags, saved filters, native file integration and metadata recovery/export. No notes editing, import, asset rename/arbitrary move, permanent delete or continuous watcher. Theme settings are deferred until core features stabilize; gradient palette references and constraints are recorded in notes.md. Cross-platform usability still needs manual Windows/Intel/OneDrive acceptance before release. Backup create-only publication needs hardlink-capable local filesystem (APFS/NTFS); unsupported destination filesystems return visible error, no overwrite fallback. Bulk replacements atomic per directory, not whole library; partial errors intentionally preserve completed writes and require review before retry. Missing entries cannot reliably reveal original file/folder kind; displayed file until later repair. No automatic matching, hashing or conflict-copy merging. Edits compare metadata snapshots before replacement, but cannot fully exclude external changes during final check/rename gap; OneDrive is synchronization transport, not cross-process transactional lock. Scan results arrive as one final recursive array with intermediate progress; the current-folder table is virtualized, but initial traversal and sidecar loading can still take time on large or synced libraries. Stop requests cooperative cancellation rather than terminating an in-progress OS read. Selection/layout preferences session-only. Links and Windows reparse points are skipped, including OneDrive Files On-Demand placeholders; make intended assets locally available where provider marks them as reparse entries. No cloud APIs used. Non-Unicode filesystem names are reported/skipped rather than converted to ambiguous paths. Windows 11, Intel macOS, signing and cross-OS OneDrive synchronization require manual verification. Browser smoke does not prove native picker/WKWebView interaction.

## Documentation

- [Metadata format and target design](docs/metadata-format.md)
- [Manual test plan](docs/manual-test-plan.md)
- [Milestone progress log](docs/progress-log.md)

Metadata document specifies current sidecar schema and future reconciliation limits. Progress log records actual verification rather than assuming all platforms tested.
