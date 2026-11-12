# Manual test plan

## MVP scope

Use disposable test folders on Windows 11 and macOS (Apple Silicon and Intel). Scope: native approved scan, single/bulk tags, tag and prefix-group rename, All/Any/NOT and kind filters, saved searches, open/reveal/copy, validation, confirmed same-folder reconnect and JSON export. Also verify Stop cancellation, folders-first sorting, confirmed Trash / Recycle Bin and bounded Details previews. Notes read-only; import, arbitrary moves/rename and permanent delete deferred. Inert model placeholders in `fixtures/sample-library/` are not printable models. Choose a copy explicitly through picker; never mutate canonical repository fixture during manual checks.

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
| M2-06 | Remove registration; Cancel, Escape, then confirm | In-app dialog states that files and folders are not changed and how many of this library's saved searches are deleted. Cancel and Escape change nothing; confirm unregisters the library and deletes only its saved searches; all assets/manifests unchanged |
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
| M3-18 | Add `oole:identity`, `material:pla`, `oole:identity:brand` and `favorite` to copied fixture | Alphabetical groups `favorite`, `material`, `oole`; labels `favorite`, `pla`, `identity` and `identity:brand`; no default groups or Other bucket. Clicking `identity` filters exact `oole:identity`, not `oole:identity:brand`. Groups follow current folder and disappear when their last tag is removed |

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
| M4-11 | Update search explicitly, rename; Delete… then Keep search, Delete… then Escape, Delete… then Delete search | Update replaces filters; rename preserves stored filters; Delete… only shows an in-app second step; Keep search and Escape keep the search and the dialog; confirmed deletion changes app settings only |
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
| M5-12a | Delete a tagged file outside the app, rescan, choose Remove missing entry, Cancel, then confirm | Cancel leaves manifest bytes unchanged; confirm removes only that key, keeps other entries/unknown fields and asset bytes, clears the issue; file reappearing or stale revision is rejected |
| M5-13 | Export to native-selected new JSON path then cancel next picker | Valid metadata-only backup with assets/issues/manifest raw bytes; cancellation neutral, no new file |
| M5-14 | Export to `overwrite-check.json` in disposable backup folder; record SHA-256; export again to exact same folder and manually enter `overwrite-check.json` instead of fresh timestamped default; also test asset/sidecar/symlink destinations | Backup refuses overwrite, original SHA-256 unchanged. Saving a new timestamped name does not exercise collision handling |
| M5-15 | Inject publish failure/unsupported filesystem | Error with path/details, no partial backup or overwrite, temp cleanup attempted |
| M5-16 | Validate/export/repair while scan/tag/settings busy | Mutations serialized; reports and dialogs cannot leak across switched libraries |
| M5-17 | Build/install Windows and macOS bundles from host commands | App launches offline, assets remain in place, persisted tags readable after restart |

Native debug reconnect UI was exercised on synthetic assets on 2026-10-07: eligible same-folder candidates, Cancel/Review no writes, explicit transfer preserving UUID/tags/notes/unknown fields and restart persistence passed. Reveal native action completed without error; exact Finder selection unverified. Host Accessibility unavailable: native picker/save-panel UI not automated; Clipboard/Open skipped to preserve existing host state. See [progress log](progress-log.md) for evidence and remaining manual gates.

## Catalog controls, Trash and preview acceptance

| ID | Action | Expected result |
|---|---|---|
| UI-01 | Enter nested folder; collapse sidebar; click Up in catalog toolbar | Up remains available beside table actions, navigates parent; disabled at root and while busy |
| UI-02 | Sort all columns ascending/descending | Every folder precedes files; chosen order applies within each group |
| SCAN-01 | Stop a large scan during traversal or sidecar loading | Partial rows discarded, visible Scan stopped state; Choose library and active selector unlock; late results/progress cannot replace new library |
| SCAN-02 | Stop then immediately choose another folder; cancel picker; Rescan | Cancel picker preserves registration; new scan resets stopped state; no stale cancellation error from previous library |
| TRASH-01 | Context Delete, inspector Delete or Delete selected; Cancel/Escape | Exact target list; no native Trash operation before Review and explicit final confirmation |
| TRASH-02 | Confirm disposable file/folder selection | System Trash / Recycle Bin receives exact targets; folder contents and contained sidecars included; remaining sidecars unchanged; completed rows removed from UI |
| TRASH-03 | Root, missing, unsafe link/reparse, modified file or overlapping folder/child selection | Rejected before first move; no permanent-delete fallback; untouched targets remain |
| TRASH-04 | Inject later-target failure; restore completed target via OS file manager then Rescan | Completed moves reported and never rolled back silently; unprocessed targets remain; restored bytes/UUID/tags recover from preserved sidecars |
| PREVIEW-01 | Select UTF-8 text, PNG/JPEG/GIF/WebP | Details shows bounded text/image; text limit 64 KiB, image limit 8 MiB; no writes |
| PREVIEW-02 | Select another row/library before preview returns | Old content never shown under new selection; errors explicit; missing/folder/unsupported types not read as executable content |
| PREVIEW-03 | Large image, invalid UTF-8, HTML/SVG, model/PDF, symlink replacement | Clear unavailable/unsupported/error state; no HTML execution or broad frontend filesystem permission |

Apple Silicon macOS debug WKWebView acceptance on 2026-10-07 verified prefix grouping/exact filtering/folder scope, Stop and recovery, bounded native text/PNG previews, single-file Trash Cancel/Confirm, actual OS Trash contents, exact-path restore and metadata recovery. Separate app-data and synthetic assets were used; see [progress log](progress-log.md). Optimized bundled release checks subsequently confirmed/fixed raster image CSP; complete release control matrix passed only with scratch disabled background throttling. Follow-up default-throttling optimized app passed 15-second opaque-window occlusion/reactivation checks3/3, with previews/filtering/Rescan intact. True Hide/minimize, sleep/wake and long-background recovery remain unverified. This does not cover Finder Put Back UI, folder/bulk/partial Trash platform flows, native picker UI or signed/distribution builds. Remaining cases still require native execution on disposable assets; browser mocked-hook smoke does not prove system Trash or native file reads.

## Tag and prefix-group rename acceptance

Status: **Apple Silicon macOS only** (2026-11-06, see [progress log](progress-log.md#macos-native-acceptance-of-v051-and-in-app-confirmations-2026-11-06)). All cases passed there except RENAME-01 and RENAME-03, which are partial because the PC context-menu key opens WebKit's own menu; RENAME-09 passed with a note. Windows 11 and Intel macOS have not been run. Use a copied library with nested folders and a disposable app-data folder; hash every `.asset-tags.json` and asset before and after each case. Never inject failures against a real library or real settings.

| ID | Action | Expected result |
|---|---|---|
| RENAME-01 | Right-click a sidebar tag; then focus another tag and press the context-menu key; then Shift+F10 on a third | Menu opens at the tag each time with **Rename tag**; Escape, outside click, wheel or Tab closes it and focus returns to the tag. Plain F10 opens nothing |
| RENAME-02 | Open the menu on `oole:identity` and on a plain `favorite` tag; click a prefix group header | Colon tag offers **Rename tag** and **Rename prefix group**; plain tag offers only **Rename tag**; header opens the prefix action |
| RENAME-03 | Press the context-menu key and Shift+F10 in each platform webview | Exactly one menu opens. The app suppresses a duplicate native `contextmenu` for 1 s after a keyboard open; a webview that fires it later or differently is unverified and must be recorded |
| RENAME-04 | Enter a nested folder, open Rename, choose **Preview**; then repeat and cancel with Escape or **Cancel preview** | Counts cover the whole library, not the folder in view, and list files, folders and sidecar files separately. Cancel changes nothing. No sidecar, UUID or settings byte changes; navigation, sort, selection and layout are unchanged |
| RENAME-05 | Confirm an exact rename affecting files and folders in several directories | Only tags in owning sidecars change, once each; asset bytes and paths, UUIDs, notes, unknown fields and stale entries are identical. Table, counts and sidebar update with no rescan |
| RENAME-06 | Prefix rename `status` to `state` with `status:printed:large` and a plain `status` tag present | Suffix kept (`state:printed:large`); plain `status` unchanged |
| RENAME-07 | Rename onto an existing tag, with a saved search `-status:printed` and the same term in the active query | Dialog discloses the merge and that migrated searches match differently (the excluded term also excludes rows already tagged with the destination); no duplicate tags in any sidecar |
| RENAME-08 | Include a missing row, a metadata-blocked row and an unreadable manifest | Missing and blocked rows listed with reasons and unchanged; unreadable metadata listed as uninspectable; none silently dropped |
| RENAME-09 | Type a new name containing a space, a leading quotation mark, or a leading minus while a saved search or the active query uses the old tag | Refused before any preview, with a blocker naming the saved search or "Active query"; nothing is scanned or changed |
| RENAME-10 | Complete a rename with saved searches in two libraries and a quoted phrase such as `"status:printed"` | Required and excluded tag terms in this library's searches and active query are rewritten; quoted path text, search names and the other library's searches are unchanged |
| RENAME-11 | Preview, then edit a tag on another row or change a sidecar externally, then Confirm | Rejected with a message to preview again; no sidecar changed |
| RENAME-12 | Make one directory's sidecar unwritable in the disposable copy and confirm | Partial result lists committed, failed and unattempted rows and the failing sidecar; earlier sidecars stay renamed; saved searches and active query unchanged; notice remains after closing the dialog; **Preview remaining rows** completes after the cause is fixed |
| RENAME-13 | After sidecars commit, make the disposable settings file unwritable | "Rename saved, search update failed"; rows stay renamed, searches keep the old name; retry updates only the searches. After quitting the app the retry is gone and the searches need hand correction |
| RENAME-14 | With a partial or settings-failed notice open, try to install an update; then resolve it by complete retry, by library switch, and by **Dismiss notice** | Install is blocked with a rename message. The notice clears only through those routes; **Dismiss notice** appears only when a retry preview has nothing left to migrate or the retry is rejected. A partial rename that keeps failing blocks updates until library switch or app restart |
| RENAME-15 | Read the confirmation step | States there is no undo and no rollback across folders, that only sidecars change, and points to **Export JSON** as a recovery copy; closing discards the preview |
| RENAME-16 | Keyboard only: Tab through the dialog, press Escape while idle and during a preview, finish a rename | Focus stays inside the dialog; Escape cancels a running preview or closes the idle dialog; focus returns to the originating tag, or to the TAGS header if that tag no longer exists |
| RENAME-17 | Run the Windows checks workflow on the rename branch | **Passed.** The Windows checks workflow (Rust tests, Clippy, frontend tests and unsigned NSIS build) was green on PR #13 before merge and on main afterwards. This is CI only, not Windows UI acceptance |

Rename cases for release acceptance must be run on Windows 11, Apple Silicon macOS and Intel macOS separately; one platform's pass does not cover another.

## Theme settings acceptance

| ID | Action | Expected result |
|---|---|---|
| THEME-01 | First launch or legacy settings without `theme` | Workshop selected; no library required; existing settings not rewritten during load |
| THEME-02 | Select each preset in top-bar Color theme selector | Sidebar accents and neutral catalog surfaces update; Midnight darkens table, inspector, inputs, menus and dialogs; labels, focus and selected rows remain readable |
| THEME-03 | Change theme with selected row, active query and nested folder | Filter, selection, current folder and catalog stay intact; no extra scan |
| THEME-04 | Restart and switch/remove disposable library registrations | Stored theme remains; roots, saved searches and unrelated settings preserved; no sidecar/asset changes |
| THEME-05 | Simulate settings persistence failure using disposable app-data only | Visible error; previous theme remains selected and applied; no false saved state |
| THEME-06 | Collapse sidebar or launch without libraries; inspect browser-only mode | Desktop selector remains available in top bar; browser selector disabled, no native settings invoked |
| THEME-07 | Scan or native operation pending | Theme selector disabled; no concurrent preference writes |

These cases require native execution for persistence claims. Palette/unit UI assertions and browser smoke alone do not prove native save/restart.

## Theme picker acceptance

| ID | Action | Expected result |
|---|---|---|
| THEME-GRID-01 | Open theme picker at minimum supported 820×600 window and inspect all rows | Twenty named flat swatches (frame, sheet, accent) fit or scroll within the popover; selected state uses a check/outline as well as color; no page-level horizontal overflow |
| THEME-GRID-02 | Move with Arrow keys, Home and End, then press Escape | Focus moves without saving; Escape dismisses and restores trigger focus; committed theme remains unchanged |
| THEME-GRID-03 | Focus another swatch and press Return or Space | Theme applies only after native settings commit; selected marker/name/tokens update together; picker stays open for comparison |
| THEME-GRID-04 | Press Tab from a swatch and inspect next focus target | Popover closes without trapping focus; verify and record the exact destination control on each supported platform |
| THEME-GRID-05 | Commit each preset, restart, and inspect theme plus synthetic library state | All 20 IDs persist; catalog/folder/query/selection/layout and asset/sidecar bytes remain unchanged; no rescan is initiated by theme selection |
| THEME-GRID-06 | Attempt a theme change with isolated settings persistence failure | Previous committed theme stays applied; accessible error appears; failed choice can be retried |
| THEME-GRID-07 | Resize window or zoom with picker open; inspect menus/dialogs and semantic states | Popover remains viewport-clamped and readable; portals inherit theme tokens; focus, selection, disabled and error/success states remain distinguishable |

**Completed bounded macOS evidence (2026-10-09):** Isolated Apple Silicon build and synthetic library/app-data only. All 20 swatches fit at 820×600; keyboard Right Arrow moved focus without saving, Return committed, Escape dismissed and restored trigger focus. Native settings show all-theme commits and restart restored final Aurora selection; synthetic library/settings and asset/sidecar bytes were preserved. Tab dismissed the popover, but exact destination focus was not captured. Windows native UI remains unverified; see [release readiness](release-readiness.md). These results are not v0.2.0 package acceptance.

## Usage data acceptance

Status: **macOS run at `e7c0d47` (T18 re-run, 2026-11-12, after the T19 review fixes; the first run was at `d1ccb48`). USAGE-07 is partial and accepted by the account owner. Windows not run (T21).** Covers the opt-in usage data feature ([design](design/usage-analytics.md)): the first-ask dialog, the **Usage data** topbar button and review dialog, the consent settings, single instance and the no-connection guarantee. Vitest tests (jsdom) cover every state and message, but jsdom has no layout, no screen reader, no real settings file and no network capture, so **jsdom results do not count here**. Run each check in a native build.

Every check records the commit SHA it ran at (`git rev-parse HEAD` of the checked-out tree that was built, or the PR commit the Store package was built from), together with the OS version, architecture and build. Unless a row says otherwise, run it on macOS (T18, Apple Silicon) and on Windows before merge (T21, the PR's test-signed Store package). Windows and Intel macOS results never cover each other. Record the outcome in the **Result** cell of the row (`pass` or `fail`, commit SHA, date, one line of evidence such as a settings excerpt or capture count) and copy the same lines into the [progress log](progress-log.md). A row whose cell still reads `not run` is not evidence.

**Isolation.** Never use real libraries or real app data.

- **Library:** a disposable copy of `fixtures/sample-library/`, plus a disposable library large enough that **Validate metadata** runs for several seconds, for the rows that name it. Hash the files before and after.
- **macOS:** a separate app identifier, so settings land in their own folder. The shipped GitHub edition uses `com.tagbasedassetmanager.desktop` (`src-tauri/tauri.conf.json`); never launch that one for these checks. Build with the endpoint and a test identifier (single instance is release-only, so `pnpm tauri dev` does not count):

  ```bash
  TAG_ASSET_MANAGER_USAGE_ENDPOINT=https://usage.minhtran.id.vn/v1/events pnpm tauri build --bundles app --config '{"identifier":"com.tagbasedassetmanager.usagecheck"}'
  ```

  The app is `src-tauri/target/release/bundle/macos/Tag-Based Asset Manager.app`. Its settings are `~/Library/Application Support/com.tagbasedassetmanager.usagecheck/settings.json`. Delete that folder to return to a clean first launch.
- **Windows:** the PR's test-signed Store package (identifier `com.tagbasedassetmanager.store`) installed as in [Microsoft Store](microsoft-store.md), in an isolated Windows account that has no other libraries or settings. Its settings are `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\com.tagbasedassetmanager.store\settings.json`. Find `<PFN>` with `Get-AppxPackage | Where-Object Name -like '*Tag*' | Select-Object Name, PackageFamilyName`.
- **Settings fields:** `usageConsent` (`undecided`, `granted` or `declined`) and `usageClientId` (a UUID, present only while granted). Read the file with the app closed or after each action; do not edit it while the app runs, except where a row says so.
- **Real endpoint:** `https://usage.minhtran.id.vn/v1/events`. Rows that send to it put test events into the real Google Analytics property, so keep them to the minimum the row needs and note the time of each.

**Capture and pin (USAGE-09, 12, 15).** To prove "no connection" without relying on the Worker, pin the endpoint host to an unreachable address and capture traffic to it. Start both before launching the app and keep them in place until the session ends.

- **macOS:** add `192.0.2.1 usage.minhtran.id.vn` to `/etc/hosts`, then `sudo tcpdump -i any -n -w usage-capture.pcap host 192.0.2.1`.
- **Windows:** add the same line to `C:\Windows\System32\drivers\etc\hosts` (as administrator), then `pktmon filter add -i 192.0.2.1` and `pktmon start --capture`.
- **Reading it:** any packet to `192.0.2.1` is an attempt to connect. The pinned address never answers, so an opted-in app shows repeated SYNs (the positive control). Count attempts by source port: a retransmit of an old attempt reuses its port, a new connection uses a new one.
- **Clean up:** afterwards, stop the capture and remove the hosts line. On Windows also run `pktmon stop` and then `pktmon filter remove`, so the filter doesn't stay behind (reviewer item M6-3c). Clean up the same way after the T22 checks.

| ID | Action | Expected result | Result |
|---|---|---|---|
| USAGE-01 | macOS only. Build `v0.7.1` with the same test identifier and run it: add the disposable library, change the theme, save a search, quit. Confirm `settings.json` has neither `usageConsent` nor `usageClientId`. Launch the new build on that identifier, answer **No thanks**, quit and launch again. Windows is covered by this row plus the Rust settings-load test: the Store package's identifier cannot change and an isolated account has no old settings | The dialog **Share usage data?** appears on the first launch only. Afterwards the library, theme and saved search are unchanged, `settings.json` gains `usageConsent: declined` with no `usageClientId` and every other field as before, the second launch shows no dialog and the topbar reads **Usage data: Off** | macOS: pass (variant), `e7c0d47`, 2026-11-12: settings in the v0.7.1 shape (with a saved search and the Ocean theme) were written instead of running a v0.7.1 build, and Escape answered instead of **No thanks**. Dialog on the first launch only; `declined` with no ID; libraries, saved search and theme kept; no dialog on later launches |
| USAGE-02 | With the app running, open it a second time (macOS: `open -n` on the `.app`; Windows: launch from Start twice, including once while the window is minimized) | The existing window comes forward (shown, restored, focused). No second window and no second process: Activity Monitor or Task Manager lists one process for the app, and the second launch exits | macOS: pass, `e7c0d47`, 2026-11-12: `open -n` while running and while minimized left one process; the second launch restored the minimized window and sent nothing. Coming to the front wasn't confirmed this run because other apps were active; it was seen at `d1ccb48`; Windows: not run |
| USAGE-03 | Resize to the minimum 820×600. Inspect the topbar **Usage data** button, the first-ask dialog and the review dialog in each state of the table in the design. Repeat with a message showing (for example after a failed save, using the unwritable settings from USAGE-11) | The button, title, Currently line, body, message and every choice button are readable and reachable without clipping, overlap or page-level horizontal scroll. Long content scrolls inside the dialog. The message does not push the buttons out of view | macOS: pass, `e7c0d47`, 2026-11-12, 820×600: the first ask, the review in each row, and the not-saved, failed and busy messages all fit with their buttons; the focus ring clears the dialog's bottom edge; Windows: not run |
| USAGE-04 | Reviewer item U6-1, at 820×600. In the **undecided review row** (reach it by making settings unwritable, pressing **No thanks** so the save fails, pressing **Close**, restoring write access, then opening **Usage data**): press **No thanks** with settings unwritable again for a failed result, and press it while **Validate metadata** runs on the large library for a busy result. Then, from a saved off state, do the same with **Turn on**: unwritable settings for a failed result, a running Validate for a busy result | In all four cases the pressed button and the alert are both visible in the dialog at the same time, with no scrolling needed to see either. The text matches the "Busy" and "Failed" rows of the design's messages table for that row | macOS: pass, `e7c0d47`, 2026-11-12: undecided-row **No thanks** failed and busy (Validate on 300,000 files), saved-off **Turn on** failed and busy. In each, the pressed button and the alert were visible together with the design's text; Windows: not run |
| USAGE-05 | Keyboard only. Make settings unwritable, open the first ask and press Enter on **No thanks** so the save fails. Then press Tab and Shift+Tab repeatedly, then Escape | The alert appears and focus stays inside the dialog (on **Close**) after the failure. Tab and Shift+Tab cycle through the container and the buttons and never leave the dialog. Escape tries the save again: while unwritable the alert shows again and the dialog stays; once writable it saves "no" and closes | macOS: pass, `e7c0d47`, 2026-11-12: Enter on **No thanks** failed and focus moved to **Close**; Tab and Shift+Tab cycled Close, No thanks and Share usage data only; Escape while unwritable showed the alert again and kept the dialog; once writable, Escape saved `declined` and closed; Windows: not run |
| USAGE-06 | Fresh first ask. Click outside the dialog, then press Escape | The click does nothing: the dialog stays and focus does not leave it. Escape closes it and saves "no": `usageConsent` is `declined` with no `usageClientId`, the status text says "Usage data is off." and the topbar reads **Usage data: Off** | macOS: pass, `e7c0d47`, 2026-11-12: the outside click was ignored and focus stayed on the dialog; Escape saved `declined` with no ID; topbar **Usage data: Off** and "Usage data is off."; Windows: not run |
| USAGE-07 | Screen reader (VoiceOver on macOS, Narrator on Windows) with the large disposable library still scanning. Open the first ask, then the review dialog in each state, and trigger a busy, a failed, a "stopped, not saved" and a saved result | The title, the Currently line (review) and the body are read on opening, and each message is announced when it appears, including a repeat of the same failure. Saved results are announced once through the status region. If scan progress talks over the dialog, drop `role="status"` from the scan row while the consent dialog is open, rerun, and record which way it was | macOS: partial, accepted: at `d1ccb48` VoiceOver read the title, body, Currently line and the failed first-ask message, and announced a saved result once. At `e7c0d47` it read the busy review dialog only as "dialog with 11 items"; the account owner accepted this without further checks; Windows: not run |
| USAGE-08 | Reviewer item U6-3, Windows Narrator setup (the first ask blocks adding a library, so set it up this way). Decline at the first ask. Add the large disposable library, wait for the scan, and quit. In the Store package's `settings.json` remove the `usageConsent` line (and any `usageClientId`). Relaunch with Narrator running so the first ask appears while the startup scan runs, then run USAGE-07 | The first ask appears during the scan. Narrator reads it as in USAGE-07 | Windows: not run |
| USAGE-09 | No connections. Start the capture and pin before launch, then from a fresh app-data folder: (a) undecided: make settings unwritable as in USAGE-11, press **No thanks** (the save fails and the choice stays undecided), press **Close**, then perform tracked actions (navigate folders, sort, click a tag, edit a tag) and restore write access; (b) **Usage data** → **No thanks**, then repeat the actions; (c) positive control: **Usage data** → **Turn on**, then repeat the actions; (d) **Turn off**, wait at least 10 s (the request timeout) or count only new source ports, then repeat the actions. Keep the pin in place from before launch to the end of the session (reviewer item K6-2) | No packets to `192.0.2.1` during (a) and (b). In (c) there are connection attempts, which proves the capture works. In (d) no source port that was not already in use at the moment of opt-out connects, so retries of requests already in flight are not miscounted | macOS: pass (variant), `e7c0d47`, 2026-11-12: a local listener build counted every connection attempt instead of the hosts pin and tcpdump. (a) undecided after a failed save and **Close**: 0 connections across the four actions (write access was restored and the library rescanned first, because a scan can't finish while settings are read-only); (b) declined: 0; (c) on: one connection per action; (d) 12 s after **Turn off**: 0; Windows: not run |
| USAGE-10 | No pin. From a clean state, **Usage data** (or the first ask) → **Share usage data**. Check Google Analytics Realtime. Then **Turn off** and read `settings.json` | `settings.json` has `usageConsent: granted` and a `usageClientId` UUID. Realtime shows `app_open` with the matching `edition` and `operating_system`: on macOS `edition` = `github`; on Windows (Store package) `edition` = `store` (reviewer item M6-3b). After **Turn off**, `usageConsent` is `declined` and `usageClientId` is gone | macOS: pass, `e7c0d47`, 2026-11-12, real endpoint (client `f3814da8`): Realtime showed `app_open`, `sort_change`, `tag_filter_click` and `theme_change`; **Turn off** saved `declined` and removed `usageClientId`. `edition` = `github` and `app_version` = `0.7.1` were confirmed in the standard report for the `d1ccb48` run; Windows: not run |
| USAGE-11 | Opt-out not saved. Start with sharing on. Make settings unwritable (macOS: `chmod a-w` on the app-data folder, or `chflags uchg settings.json`, because the write replaces the file by rename; Windows: `attrib +R settings.json` in the Store package folder). Press **Usage data** → **Turn off**. Press **Save "off"** again while still unwritable. Make settings writable again (`chmod u+w`, `chflags nouchg`, `attrib -R`) and press **Save "off"** | After **Turn off**: sending stops, the dialog says "Sending has stopped, but this choice couldn't be saved, so sharing will resume the next time the app opens. Press **Save "off"** to try again.", its buttons are **Save "off"** and **Turn on** with focus on **Save "off"**, and the topbar reads **Usage data: Off (not saved)**. Pressing **Save "off"** while unwritable shows the not-saved message again. After restoring access, **Save "off"** closes the dialog, the status text says "Usage data turned off.", the topbar reads **Usage data: Off** and `settings.json` holds `usageConsent: declined` with no `usageClientId` | macOS: pass, `e7c0d47`, 2026-11-12: app-data folder read-only; not-saved message, **Save "off"** focused in **Turn off**'s place, topbar **Off (not saved)**, settings still `granted`; Enter repeated the message with the buttons in view; 0 connections across sort, tag filter and Up (the step's tag edit went to another app and isn't counted). After restoring access, **Save "off"** saved `declined` with no ID and showed "Usage data turned off."; Windows: not run |
| USAGE-12 | Long operation, with the USAGE-09 capture running. Start with sharing on in a disposable library large enough that **Validate metadata** runs for several seconds. Start Validate, open **Usage data** and press **Turn off**. While Validate runs press **Save "off"**, including a double-click in the same spot and a repeated Enter. After Validate finishes press **Save "off"**, then quit and relaunch | The window stays responsive throughout. **Turn on** never fires: the button in that position is **Save "off"** each time, and every press while Validate runs shows the busy "stopped, not saved" message. After Validate, **Save "off"** saves. After relaunch `settings.json` holds `declined` with no `usageClientId`, the topbar reads **Usage data: Off**, and the capture shows no new source port after the turn off | macOS: pass, `e7c0d47`, 2026-11-12, 300,000-file library: **Turn off** during Validate gave the busy not-saved message; a double-click and repeated Enter on **Save "off"** never turned sharing on; Validate ended during that burst and a later press saved `declined`; 0 connections after the turn off; still **Off** after relaunch; Windows: not run |
| USAGE-13 | Opt-in after a decline. Decline at the first ask, then **Usage data** → **Turn on**. No pin | A new `usageClientId` is stored, the topbar reads **Usage data: On**, and `app_open` appears in Realtime (or in the pinned capture as connection attempts) | macOS: pass, `e7c0d47`, 2026-11-12, listener build: **Turn on** after a decline stored a new ID and connected at once; Windows: not run |
| USAGE-14 | Off, then on, in one session. With sharing on, **Turn off** (saved), then **Usage data** → **Turn on**, without closing the app | The topbar reads **Usage data: On**, the status line shows "Local files · sharing usage data", `settings.json` holds `granted` with a `usageClientId` different from the first one, and a second `app_open` appears in Realtime | macOS: pass, `e7c0d47`, 2026-11-12, listener build: off then on in one session stored a different ID and connected again; topbar **On**; Windows: not run |
| USAGE-15 | Service down. With the endpoint pinned to the unreachable address and sharing on, use the app normally: browse, sort, edit a tag, rescan, run **Validate metadata**, switch themes, then quit | No error panel, hang or slowdown appears, and the app quits promptly. Nothing queues on disk: `settings.json` is unchanged apart from normal edits | macOS: pass, `e7c0d47`, 2026-11-12, listener build with every request failing at TLS: a library switch, a theme switch, folder, sort, tag filter, tag edit, rescan and Validate showed no error or hang; 9 failed sends; quit took 0.4 s; app-data held only `settings.json`; Windows: not run |
| USAGE-16 | macOS only (on Windows this rests on the Rust endpoint test). Build without `TAG_ASSET_MANAGER_USAGE_ENDPOINT` (confirm with `echo "${TAG_ASSET_MANAGER_USAGE_ENDPOINT:-unset}"`) and the test identifier, and launch from a clean app-data folder | No dialog and no **Usage data** button appear, the status text and offline dot are unchanged, and no packets to the endpoint are seen | macOS: pass, `e7c0d47`, 2026-11-12: from undecided, no dialog and no **Usage data** button; status "Local files · explicit actions only"; 0 connections; no endpoint string in the binary |
| USAGE-17 | After release only (T22), update block. On a real offered update of the GitHub edition, use the GitHub installer in the isolated Windows account (or the account owner's own copy, only by their explicit choice, because that is real app data). Make the opt-out not saved as in USAGE-11, open the update dialog, then press **Save "off"** and try again. No pre-merge build is offered an update, so before merge this rests on the frontend tests | While the opt-out is not saved, installing is blocked and the reason points to **Save "off"**. After it is saved, installing is allowed | Windows: not run (release only) |
| USAGE-18 | After release only (T22), update relaunch, on macOS and Windows. The next release after the one carrying the single-instance plugin is the first update from such a build. Windows: keep the isolated GitHub copy from USAGE-17 installed until then. macOS: a published build has the production identifier, so use a separate macOS user account, or the account owner's own copy only by their explicit choice. Reviewer item M6-3a: on Windows run USAGE-17 and USAGE-18 together in one session: blocked, **Save "off"**, install allowed, install, relaunch, one process | The app relaunches into the new version and Activity Monitor or Task Manager lists one process for it. The T22 record stays open until USAGE-17 and both USAGE-18 results are recorded | macOS: not run (release only); Windows: not run (release only) |

Notes:

- The first ask is modal and blocks adding a library, so every library a row needs is registered before the row starts. USAGE-09 (a) reaches the undecided state with tracked actions available only because a failed save lets **Close** dismiss the dialog for the session.
- The capture rows show that no request is attempted. They do not show what Google Analytics receives; USAGE-10, 13 and 14 do.

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

## Release-readiness follow-up (2026-10-08)

Current acceptance/deferred gates are consolidated in [release readiness](release-readiness.md). Clean optimized Apple Silicon app with isolated app-data and unchanged production CSP/window policy reached complete no-library Workshop UI in three fresh launches; Hide/unhide and minimize/restore completed with screenshots inspected. Disposable copy from unsigned DMG also launched. Subsequent populated Coral startup5/5 and120-second app-hidden recovery passed with screenshots/hashes. User reports manual sleep/wake pass; OS sleep chronology/preview retention not independently verified. Longer background soak and historical blank-window cause remain open.

Initial automated folder/bulk Trash attempt was blocked at picker authorization. Subsequent user manual report says supplied checks passed except ambiguous inspector Delete label; independent hashes confirm remaining/root metadata and both bulk files unchanged at original paths, plus exact disposable folder contents preserved in system Trash. Inspector action now explicitly labeled Delete this item; toolbar Delete selected still applies whole selection. Subsequent folder restore and bulk-file create-only recovery restored all six baseline hashes; final user Rescan screenshot shows four root rows with original tags and Needs attention0. Normal folder/bulk recovery passed; Finder bulk Put Back and forced native partial failure remain unverified. Updated inspector label is component-tested and manually confirmed on rebuilt isolated app after native row-selection automation timed out. Existing injected partial-failure tests pass but do not substitute for TRASH-04 native restore/Rescan. For manual continuation, launch only preserved isolated test app and explicitly choose its disposable library. Test Cancel/Review without changes, then folder and exact two-file selection with untouched sibling; inspect system Trash and verify SHA-256/remaining-sidecar preservation. Restore through system file manager and Rescan. Never empty Trash or induce failures against real libraries. Windows CI tests/unsigned NSIS build and Intel cross-build passed; their native hardware/manual acceptance remains unverified. User reports local OneDrive scan/tag/restart/sync-status pass, with exact asset/sidecar delta independently checked; second-device/cross-OS sync, placeholders/conflict flows and signed/notarized/quarantined installer acceptance remain open. See [progress log](progress-log.md#release-readiness-continuation-2026-10-08) for durable evidence and local packaging checks.

## Automation boundary

Frontend suites cover parser/catalog, UI, fixture consistency, typed invoke bridge and async lifecycle/stale results. Rust tests cover scanner/root/settings plus manifest parsing, mutation/identity preservation and atomic-write failure behavior. Tag rename adds interface tests in jsdom and Rust tests on disposable fixtures; one Rust test reads `src/components/TagRenameDialog.tsx` to pin the native rejection wording the dialog depends on. jsdom keeps the browser's synchronous `window.confirm`, but in the desktop app the dialog plugin replaces it with an async stub that never asks; `src/nativeDialogs.test.ts` therefore fails if app source calls `window.confirm`, `alert` or `prompt`. UI mocks and browser screenshots do not prove native picker or platform permission behavior. Native platform manual matrix still needed before distributing.
