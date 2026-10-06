# Manual test plan

## MVP scope

Use disposable test folders on Windows 11 and macOS (Apple Silicon and Intel). Scope: native approved scan, single/bulk tags, All/Any/NOT and kind filters, saved searches, open/reveal/copy, validation, confirmed same-folder reconnect and JSON export. Notes read-only; import and asset operations deferred. Inert model placeholders in `fixtures/sample-library/` are not printable models. Choose a copy explicitly through picker; never mutate canonical repository fixture during manual checks.

Record OS version, architecture, build, test ID, library location, expected/actual result and technical details. These cases are a plan, not execution evidence; see [progress log](progress-log.md) for checks actually run.

## Setup

1. Install Node 24+, pnpm 12, Rust stable and platform prerequisites from README.
2. Run `pnpm install --frozen-lockfile`, `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build`.
3. Start `pnpm tauri dev`. Do not start separate Vite server on port 1420. Browser-only `pnpm dev` must show desktop-required state without local/mock data.
4. Use folder copies created for testing. Snapshot file bytes and metadata before scan; compare afterward. Do not intentionally alter app-data settings without backing up existing registration settings.

## Native acceptance — Windows 11 and macOS

| ID | Action | Expected result |
|---|---|---|
| M2-01 | First launch with no registered library | Welcome, enabled native Choose Library Folder, no fictional rows |
| M2-02 | Cancel picker | Registration, existing rows and active library unchanged |
| M2-03 | Select fixture library | Recursive scan index retains nested files/folders and root `.` for metadata; catalog shows only direct children at each level, excludes root `.` and manifests/junk; double-click folder enters it; breadcrumbs/Up navigate; sidecar tags/notes/UUIDs load; stale child listed missing |
| M2-04 | Add second folder; switch active library | One active at a time; no old rows/selection/progress leak |
| M2-05 | Quit/reopen | Registrations and active library retained from app-data; fresh scan starts |
| M2-06 | Remove registration; cancel then confirm | Cancel changes nothing; confirm unregisters only, all assets/manifests unchanged |
| M2-07 | Search `"Articulated Octopus"` | Case-insensitive filename/relative-path text match; unquoted tokens remain required tags |
| M2-08 | Sort, resize/hide columns, Shift/Ctrl/Command select, keyboard Enter | Dense table works; Name/Tags remain visible; details follow selection |
| M2-09 | Add/remove external asset then rescan | New listing replaces prior rows; removed selected asset no stale inspector |
| M2-10 | Scan empty folder | Empty-library explanation; root row still available; count includes root |
| M2-11 | Scan many nested assets | Progress updates; window stays responsive; no duplicate scans by repeated Rescan click |
| M2-12 | Unreadable nested directory | Scan continues other entries, issue path/details under Needs attention |
| M2-13 | Library root disconnected/deleted | Recoverable error; no stale rows presented as fresh; registration retained |
| M2-14 | Symlink/junction/reparse outside library | Entry skipped/reported; no directory recursion through link |
| M2-15 | Replace approved root with symlink or changed canonical path | Rescan fails, does not follow replacement |
| M2-16 | Corrupt backed-up app-local settings | Startup error in app; original bytes preserved; no silent empty overwrite |
| M2-17 | Write failure in app-data | Clear error; registration not acknowledged as persisted; previous settings remain valid |
| M2-18 | Verify original fixture bytes/timestamps after scans/removal | No asset or manifest content/path changes |

## Single-item metadata acceptance

| ID | Action | Expected result |
|---|---|---|
| M3-01 | Scan copied fixture | Folder self-tags and model tags/notes/UUIDs visible; missing Fox reference retained |
| M3-02 | Add ` STYLE:Flexi ` by Enter on untagged `.3mf` row | `style:flexi` saved sorted/deduplicated in parent sidecar; UUID created once; asset bytes unchanged |
| M3-03 | Add/remove tag on folder | New folder own `.` manifest; no descendant tags inherited |
| M3-04 | Remove all tags then readd | Same UUID and notes retained; metadata entry not deleted |
| M3-05 | Restart and rescan | Tags/notes/UUIDs restored from sidecars, no global path catalog dependency |
| M3-06 | Filter `category:animal style:flexi -status:printed` | AND/NOT matches manifest data; clicking chip adds filter without changing selection |
| M3-07 | Autocomplete suggestion versus typed-prefix Enter | Clicking suggestion selects full tag; Enter creates exact typed tag, not unwanted first suggestion |
| M3-08 | Break JSON, unsupported schema, invalid tag types/UUID/key | Visible blocked state/error; attempted edits preserve original manifest bytes |
| M3-09 | Rename/delete asset externally then rescan | Missing reference shown and not deleted; tags remain, editing missing target blocked |
| M3-10 | Duplicate UUID or parent+self folder ownership conflict | Involved rows warning/blocked, no silent merge or write |
| M3-11 | Change target tags externally after scan then edit | Stale revision rejected; no overwrite, Rescan recovers |
| M3-12 | Edit two sibling rows sequentially | Both edits succeed without whole-library rescan; unrelated/latest entries preserved |
| M3-13 | Add unknown JSON fields/stale entries then edit valid row | Unknown fields, notes and stale metadata retained |
| M3-14 | Deny sidecar write/replace or disconnect during edit | Clear error, old manifest preserved, input retained, no optimistic chips |
| M3-15 | Sidecar symlink/hardlink or unsafe asset traversal | Reads/writes rejected before following unsafe metadata path |
| M3-16 | Scan without edits | No manifest or UUID created; no asset content read/changed |
| M3-17 | Inspect UI during save | Single-item controls busy; registration/rescan cannot race edit; no bulk mutation |

## Bulk tags and saved-search acceptance

| ID | Action | Expected result |
|---|---|---|
| M4-01 | Select two rows, open bulk dialog, type tags and press Enter | Draft tags/count/summary shown; no native writes before Confirm |
| M4-02 | Cancel or Escape bulk dialog | No sidecar changes; selection retained |
| M4-03 | Confirm add/remove for multiple files sharing sidecar | One atomic sidecar replacement; UUID/notes/stale/unknown entries preserved |
| M4-04 | Select folder and direct child together | Self `.` and child changes merged in same manifest; no duplicate identity |
| M4-05 | Include missing/blocked/stale selected row | Entire preflight rejected before any writes, no silent skipping |
| M4-06 | Fail replacement in second directory | Earlier completed rows stay saved; error identifies completed/selected count; failed original sidecar unchanged |
| M4-07 | Change selection behind modal or rescan/switch library | Targets frozen; rescan/library changes cancel stale dialog; no writes to unintended targets |
| M4-08 | Required tags All versus Any, exclusions and quoted text | Any changes positive tag combination only; NOT/text still required; no required tags allows all |
| M4-09 | Filter files/folders plus Untagged/Needs attention | Filters combine consistently; root counted as folder |
| M4-10 | Save named query/view/mode/kind then restart | Same filters load from local app-data; no library metadata changed by saving |
| M4-11 | Update search explicitly, rename, delete cancellation/confirmation | Update replaces filters; rename preserves stored filters; cancelled deletion keeps search; confirmed deletion changes app settings only |
| M4-12 | Duplicate/empty names, invalid settings filter type, settings write failure | Clear errors, drafts retained, prior registrations/searches preserved |
| M4-13 | Two libraries with saved searches | Searches scoped per library; remove registration removes its searches only, no assets/sidecars deleted |
| M4-14 | Save/search changes during tag save | Controls serialized; no hidden race or catalogue-clearing rescan |

## Native actions, validation and recovery acceptance

| ID | Action | Expected result |
|---|---|---|
| M5-01 | Double-click ordinary file/folder, inspector Open, context menu Open | OS default application opens exact validated asset; no shell concatenation |
| M5-02 | Reveal file/folder in Finder/File Explorer | Correct item selected/revealed; Unicode/spaces preserved |
| M5-03 | Copy full/relative path from inspector/menu | Native clipboard receives exact path; missing actions disabled or visible error, no silent browser fallback |
| M5-04 | Remove selected asset externally then invoke action | Recoverable missing error; no guessed alternate target |
| M5-05 | Double-click tag/input/remove control | Tag action only, never unintentionally opens asset |
| M5-06 | Validate clean library then malformed/missing/duplicate/invalid/unreadable cases | Fresh report with paths/details; zero changes to files/manifests/settings |
| M5-07 | Place likely metadata conflict copy | Excluded from ordinary assets, attention report; no auto-merge/delete |
| M5-08 | Choose missing entry, request reconnect candidates | Same-folder untagged regular files only; occupied metadata identities/directories/links excluded |
| M5-09 | Cancel reconnect review or Escape | Original manifest bytes unchanged |
| M5-10 | Confirm reconnect | UUID/tags/notes/unknown data transferred to explicit target; asset bytes/paths unchanged; source stale key removed only as repair |
| M5-11 | Source reappears, stale revision, target gains identity or changes folder/link | Repair rejected, original preserved; no automatic matching |
| M5-12 | Write failure or refresh failure after reconnect | Write failure original preserved; postcommit refresh failure explicitly says reconnect saved and asks rescan |
| M5-13 | Export to native-selected new JSON path then cancel next picker | Valid metadata-only backup with assets/issues/manifest raw bytes; cancellation neutral, no new file |
| M5-14 | Pick existing JSON/asset/sidecar or symlink destination | Backup refuses overwrite, original untouched |
| M5-15 | Inject publish failure/unsupported filesystem | Error with path/details, no partial backup or overwrite, temp cleanup attempted |
| M5-16 | Validate/export/repair while scan/tag/settings busy | Mutations serialized; reports and dialogs cannot leak across switched libraries |
| M5-17 | Build/install Windows and macOS bundles from host commands | App launches offline, assets remain in place, persisted tags readable after restart |

## Spaces, Unicode and OneDrive

| ID | Scenario | Expected result |
|---|---|---|
| PLATFORM-01 | Folder/file names with spaces and accents, Japanese/Vietnamese names | Paths display/search correctly; no renamed normalized copies |
| PLATFORM-02 | macOS combining Unicode names; Windows non-English folder paths | Exact relative names preserved; no lossy conversion to collisions |
| PLATFORM-03 | Native picker Windows drive/UNC root and macOS path alias | Canonical selected root registered; scan valid on host; reopening restores it |
| PLATFORM-04 | OneDrive locally available library | Read-only scan works without OneDrive API/sign-in inside app; sidecars unchanged |
| PLATFORM-05 | OneDrive Files On-Demand placeholder/reparse entry | Skipped with visible issue where policy rejects reparse points; no content hydration requested by app |
| PLATFORM-06 | OneDrive sync/download during scan | Recoverable issues; manual rescan refreshes; app performs no metadata merge/delete |

Path-based revalidation is not protection against hostile local process swapping paths between checks and OS operations. Run stable-directory tests, not adversarial concurrent mutation of valuable data. Handle-relative hardening remains known limitation.

## Future milestones — not current acceptance

- Sync same library Windows/macOS through OneDrive; metadata compatibility requires cross-OS manual test, not just host unit tests.
- Dedicated metadata validation report/action across library.
- Confirm same-folder reconnect of missing metadata; preserve UUID/tags/notes; no automatic matching/hash.
- Open/reveal/copy spaces/Unicode paths using native integration; no shell interpolation.
- Validate/export to explicitly selected JSON backup location; no upload.
- Write failure/conflict copies preserve metadata, no auto-repair or delete.

## Automation boundary

Frontend suites cover parser/catalog, UI, fixture consistency, typed invoke bridge and async lifecycle/stale results. Rust tests cover scanner/root/settings plus manifest parsing, mutation/identity preservation and atomic-write failure behavior. UI mocks and browser screenshots do not prove native picker or platform permission behavior. Native platform manual matrix still needed before distributing.
