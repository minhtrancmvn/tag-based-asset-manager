# Directory metadata format

Milestone 3 uses this version-1 sidecar format as canonical tag metadata. Scans read manifests without creating or repairing them; explicit single-item tag edits write only owning sidecar. Original asset contents/paths remain unchanged. See progress log for implementation verification and platform limits.

## Location and scope

Canonical metadata lives in `.asset-tags.json` next to assets. Each manifest describes only its containing directory via `.` and direct children by basename; never descendants or absolute paths. Create manifests only when metadata must be stored. Ignore manifests and app-private temporary files in asset browsing.

```text
library-root/
  .asset-tags.json
  Figures/
    .asset-tags.json
    Flexi Dragon.3mf
    Robot.stl
  Animals/
    .asset-tags.json
    Articulated Octopus.3mf
```

Directory tags are not inherited. New directory metadata belongs to `.` in its own manifest, so whole-folder moves carry self-tags. Legacy parent manifest entries for direct child folders are honored when child self-entry is absent; edits preserve that existing owner and UUID. If both exist, report ownership conflict and block editing rather than merge, discard or duplicate identities. A malformed child manifest also blocks folder editing because self-ownership cannot be established safely. Manual reconciliation remains later work.

## Schema version 1

UTF-8 JSON object:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-05T00:00:00.000Z",
  "items": {
    ".": {
      "id": "bb4e208d-7415-4ba7-9d7d-92192611f6f8",
      "tags": ["collection:3d-models"],
      "notes": ""
    },
    "Flexi Dragon.3mf": {
      "id": "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e",
      "tags": ["category:animal", "status:printed", "style:flexi", "theme:fantasy"],
      "notes": "Works well in PLA."
    }
  }
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Integer `1`; unsupported versions must be reported, not rewritten |
| `updatedAt` | UTC timestamp of last successful app edit |
| `items` | Map from `.` or direct-child basename to metadata |
| `id` | App-generated UUID, never reassigned or reused for another asset |
| `tags` | Array of strings; trim whitespace, lowercase, deduplicate, sort deterministically on app writes |
| `notes` | Optional string; omission means no notes |

Preserve separator conventions and tag prefixes, including `category:`, `style:`, `theme:`, `status:`, and arbitrary user-defined strings. Prefixes are not a rigid taxonomy. Reject invalid tag value types rather than coercing them. Duplicate JSON object keys, invalid UUID/time fields and explicit null/non-string notes are blocked, not silently collapsed or rewritten. Keys must be `.` or direct basenames, never exact `..`, traversal or absolute paths. Nested path separators are rejected. Basenames containing repeated dots (for example `model..v2.stl`) are ordinary names, not traversal. Unicode basenames are supported; do not rename assets to normalize them. Cross-platform safety rejects metadata keys containing backslash/colon and reserved manifest/private-temp names. Such names can still appear as ordinary filesystem assets on systems that permit them, but metadata editing rejects unsafe keys rather than inventing aliases.

## Safe edits and recovery

1. Authorize selected library root in Rust and validate requested directory against it. Reject traversal and symlink escapes; do not follow symlinked directories recursively by default.
2. Read and validate existing manifest before mutation. If malformed or unsupported, show visible error with path and optional technical details. Preserve original bytes unchanged; never silently replace malformed JSON.
3. Change only requested metadata. Keep unmodified entries, including stale references. Check for external manifest changes before replacement; concurrency/conflict handling needs explicit tests during implementation.
4. Write complete new JSON to uniquely named app-private temporary file in the same directory. Flush and atomically replace destination using platform-correct semantics. Failure must preserve existing manifest and surface error. Rust write abstraction and Windows replacement behavior require tests before enabling edits.
5. Never modify asset contents, embed tags in files, use filesystem metadata as canonical storage, or rename/move/delete/upload/duplicate assets.

Manifest symlinks/reparse points are blocked before reads/writes; Unix hardlinks also blocked. Windows hardlink-specific validation is not implemented. Path-based validation is not race-free sandboxing: hostile process can replace components between OS calls, and cloud/external writer can change metadata after final byte check. No distributed lock or automatic conflict merge is claimed. Untouched entries keep original tag spelling in JSON; display is normalized and targeted tag edits serialize normalized/sorted values. A semantic no-op writes nothing.

Tags, notes and UUIDs persist in manifests; approved roots, UI preferences and saved searches belong in local app-data. No global path-only catalog or authoritative database.

## Missing references and reconciliation

Scan marks a child entry `missing` when child no longer exists. Do not delete entry automatically. `missing` is derived scan state, not an extra stored flag. Show stale entries in Needs attention. Malformed manifests, unreadable directories, duplicate UUIDs and invalid tag types are validation issues. Detect likely OneDrive conflict copies when practical and report them; never merge or delete them automatically.

Initial reconciliation: user selects existing regular file in same directory, reviews confirmation, then app transfers missing entry's UUID, tags, notes and unknown fields to chosen basename. Preserve asset bytes/paths. Reject targets already owning metadata—even zero-tag identity—rather than replacing it. Fresh validation checks missing source, revision, duplicate UUIDs, malformed/unreadable manifests and path safety before single atomic sidecar edit. Source entry removed only as part of explicitly confirmed transfer; all unrelated stale entries preserved. No automatic matching or hashing.

After durable reconnect, fresh scan refreshes rows. If refresh fails, report committed transfer plus visible refresh issue rather than pretending nothing was saved. App-local settings persistence is not required after commit. Later Rescan rebuilds snapshot from filesystem/manifests.

## Fixture library

[`fixtures/sample-library/`](../fixtures/sample-library/) contains valid version-1 manifests, inert `.3mf` and `.stl` placeholders, Unicode text path, and intentional `Missing Fox.stl` reference with no matching file. Placeholder model files are not printable models. [`src/fixtures.test.ts`](../src/fixtures.test.ts) checks UUID uniqueness, folder `.` tags, fixture filtering and Unicode path existence. Fixture tests alone do not prove native validation/writes. Milestone 3 Rust domain tests must exercise copied disposable libraries, real manifest edits/reloads and atomic-write failure paths; original fixture content must remain unchanged.

## Frontend DTOs

[`src/types.ts`](../src/types.ts) mirrors native DTOs. `Asset.id` is path-derived UI row identity; `metadataId` is durable manifest UUID or null for never-tagged assets. `metadataState` distinguishes `none`, `valid`, `blocked`; `status` distinguishes ready/untagged/missing/warning. `metadataRevision` is opaque edit precondition based on target metadata and ownership state, not asset contents. Missing entries retain metadata UUID/tags/notes; kind may be unknown after deletion and is presented as file until reconnect/type recovery is implemented.

`edit_tags` accepts approved library ID, row asset ID, expected revision and add/remove tags. UUID conflicts found by latest scan block involved rows on backend; newly introduced cross-directory duplicate IDs require Rescan to discover. No full-library filesystem scan is performed on every tag keystroke/edit. Rust re-reads manifest, rejects changed target/ownership, preserves latest unrelated entries, and compares exact source bytes again before replacement. This permits independent sibling edits without stale revision errors. Edit command also requires an editable row in latest successful native scan snapshot; blocked/missing/absent rows cannot bypass checks by crafting a revision. Snapshot is disposable app-memory authorization context, never authoritative tag storage. Revision is not authentication or filesystem sandbox. App serializes edits locally; OneDrive/external modifications still require manual Rescan when errors/conflicts occur. No asset hashing, automatic matching or automatic merging of conflict copies.

`bulk_edit_tags` accepts exact target IDs/revisions plus add/remove arrays after UI confirmation. Every target preflighted before first write; shared owner entries grouped into one sidecar replacement. Across directories there is no atomic transaction. Failure returns completed Asset DTOs plus AppError with completed/selected count, path and details; earlier saves remain durable. Unchanged rows may be included among completed targets. No automatic cross-directory rollback.

`LibraryState`, `ScanResult`, `ScanProgress`, `ScanIssue` and `AppError` carry typed command/results. App-local settings remain separate from this sidecar schema.

## Validation and backup

`validate_metadata` performs fresh read-only scan and reports malformed/unsupported/invalid-value manifests, duplicate UUIDs, missing direct references and unreadable directories. Likely `.asset-tags*.json` conflict copies are attention issues, excluded from normal assets, never automatically merged or deleted. Validation does not repair or persist scan state.

`export_metadata` accepts only library ID; native save picker authorizes one new JSON destination. Existing destinations—including assets or canonical sidecars—refused. Backup version 1 includes `exportedAt`, library summary, scanned `assets`, `issues` and `manifests`. Each readable manifest record contains relative `path`, `state`, parsed `metadata` when valid and exact `rawBytes` array; blocked/unreadable records include error and raw bytes only when safely readable. No ordinary asset contents copied. Import is not implemented.

Backup publication uses flushed same-directory private temporary file and create-only hardlink publication, so existing destination cannot be replaced by a race. Requires hardlink-capable destination filesystem; unsupported filesystems return error without overwrite fallback. No backup upload. Native-selected parent canonicalized/revalidated; symlink/reparse destinations rejected. Existing filesystem race limitations still apply.

## Saved searches in local settings

Settings version 1 adds optional `savedSearches` (default empty for prior installations), without moving canonical asset metadata. Each search has app UUID, `libraryId`, nonempty name and filters `{query, view, matchMode, kind}`. `view` is `all|untagged|attention`, `matchMode` is `all|any`, `kind` is `all|file|folder`. Query text retained exactly; parser applies case-insensitive semantics when loaded. Names unique case-insensitively within each library. Explicit update/rename/delete persists app-data atomically; failed settings writes roll back in-memory preferences/roots. Library removal deletes associated app-local searches only, never sidecars.
