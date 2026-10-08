# Task Plan: Windows export CI failure (2026-10-08)

## Goal
Diagnose run37753762418 at commit561d303; correct confirmed Windows traversal-test fixture without relaxing production export boundaries; verify Windows CI/installer artifacts and prepare evidence commit/local merge approval.

## Phases
- [x] Phase 1: Original Windows assertion failure and diagnostic Windows RED show verbatim join normalization; focused macOS controls3/3. Windows failure not rerun3/3; bounded deterministic diagnostic boundary explicit.
- [x] Phase 2: Three candidates recorded; diagnostic isolated lost ParentDir before export.
- [x] Phase 3: ParentDir precondition RED on Windows; GitNexus LOW impact before test-only edits.
- [x] Phase 4: Raw OsString traversal construction; local88/1ignored and Windows76/1ignored GREEN,frontend211/build/fmt/clippy/unsignedNSIS pass. Production untouched.
- [x] Phase 5: Final verified fixture/CI evidence recorded; redundant .debug-session removed after read/coverage check. Evidence documentation commit and local merge await approval; no blanket release readiness claimed.

## Decisions Made
- Retain feature branch ci/windows-release-checks; no main edits/merge/release.
- No real libraries/settings, native-picker bypass, skipped tests or weakened assertions.
- Prior workflow commit/push approval does not cover fix. Ask before committing/pushing.

## Errors Encountered
- Stale GitNexus index omitted native export test; refreshed. Analyzer rewrote AGENTS.md/CLAUDE.md and removed existing worktree rule; restored both exactly to HEAD.
- Rust missing from shell PATH; explicit subprocess PATH corrected. RTK filtered stdout from compound commands; captured complete logs using Python subprocess.
- rtk proxy rg unavailable (rg executable absent); bounded Python inspection used. Unquoted gh URL triggered zsh globbing; quoted subprocess argument corrected.
- Windows runtime unavailable locally; no Wine/Windows Rust target. Existing workflow can test new code only after separate commit/push approval.

## Status
**Windows CI/build acceptance verified; manual platform/distribution gates remain** — Initial Windows run37753762418 failed export test; diagnostic commit0159c24/run37757152265 proved canonical verbatim PathBuf::join removed ParentDir before validator. Approved test-only commitd89f951 constructs raw traversal via OsString/native separator, retaining strict rejection and no-overwrite assertions; production export unchanged. GitNexus LOW/zero affected flows. Full macOS Rust88/1ignored/fmt/strictClippy pass. Windows run37758578777 SUCCESS: frontend211, Rust76/1ignored, build/fmt/strictClippy/unsignedNSIS pass; logs+installer downloaded, PE/checksum verified (2708064bytes; SHA-2566af1774686219524f0a19214de072a0775153b43f29ed0eab3358ee0e4d5d77c). No installer executed; native Windows deferred, macOS notarization deferred until Developer account, Intel hardware/OneDrive/manual partial failure and historical blank cause unverified. Documentation finalized and obsolete session file removed; propose evidence commit then local CI branch merge, both awaiting user approval. No release publication.

---

# Task Plan: Release-readiness checks (2026-10-08)

## Goal
Verify host-supported blank-window recovery, native Trash behavior, and distribution/platform readiness using disposable assets and isolated app-data. Report unavailable environments and manual gates without treating them as passes.

## Native label acceptance and commit preparation (2026-10-08)
- [x] Rebuilt isolated optimized app; frontend211/15 (5.75s), Rust88/1ignored (0.62s), build/fmt/strictClippy/diff gates passed.
- [ ] Native label/dialog acceptance blocked: two bounded filename/row clicks did not select item before timeout. Startup four tagged rows/Needs attention0 verified; no delete confirmation, all six baseline hashes unchanged. Preserved Finder .DS_Store excluded from baseline comparison; initial strict equality failed safely before launch.
- [x] Exact diff, GitNexus low-risk change scope and sensitive scan reviewed. User approved both commit groups/messages. Source/test commit4fa58b2 created and verified; approved documentation commit next. No push or merge authorized.

## Inspector delete clarification (approved 2026-10-08)
- [x] RED: Explicit Delete this item label missing; corrected fixture ordering to two named files; failure verified.
- [x] GREEN: Renamed inspector label/title only; requestDelete(selected, false), bulk/context semantics and confirmation preserved.
- [x] Verify: Frontend211/15 in6.30s, build1.29s, diff check and independent source/test review pass. Updated label native visual check not rerun; open app remains prior build. User-reported manual passes documented separately from hashes. No commit/push.
- GitNexus App upstream impact LOW, zero indexed callers/processes; index limitations retained.
- User reports supplied manual checks passed except ambiguous inspector Delete label. Subsequent folder/manual and bulk/create-only recovery completed; all six original hashes match, final Rescan screenshot four tagged rows/Needs attention0. Finder bulk Put Back/forced partial failure not claimed.
- Plan Edit initially matched18 historical phase headings and failed safely; retried with unique release-readiness context. Inspector test fixture initially mixed folder/file and folders-first order changed latest target; corrected to two files before implementation.

## Phases
- [x] Phase 1: Inspect retained harness, native safety boundary, host/platform availability and signing setup.
- [x] Phase 2: Fresh isolated optimized app first-run/Hide/minimize3/3; six screenshots inspected. Historical blank unresolved; populated-library/sleep/long-background unverified.
- [x] Phase 3 bounded normal flows: User folder/bulk manual checks and final Rescan screenshot pass; four root rows/tags restored, Needs attention0, all six original hashes match. Inspector label clarified/tested. Folder restored manually; bulk files recovered create-only from exact Trash paths. Finder bulk Put Back and forced native partial-failure remain unverified, outside this passed normal-flow boundary.
- [x] Phase 4: Fresh app/DMG build/checksum/copy/isolated-launch checks and regression gates recorded; signed/platform gates explicitly blocked.

## Decisions Made
- Work on test/release-readiness; no commits, push, branch cleanup or release publication requested.
- Preserve existing acceptance evidence, recoverable backups, real settings and user-created manual libraries.
- No native picker authorization bypass or new host permissions. Do not force system sleep without separate approval.
- Windows, Intel macOS and OneDrive acceptance require matching native environments; cross-compilation alone is not runtime acceptance.
- Production fixes require reproducible evidence, symbol impact analysis and failing regression test first.
- Resume: previous temporary evidence disappeared. Recreate isolated acceptance with durable evidence under /Users/coffeemug/Programming/tag-based-asset-manager-release-evidence/release-20261008-58bwlu7l; maximum two picker attempts, then manual gate. Original production identifier never launched.

## Errors Encountered
- Screenshot helper compilation with -parse-as-library rejected existing top-level async entrypoint; compiled as executable without that flag instead.
- Trash inspection agent API watchdog/malformed response; resumed same agent and obtained bounded source/selector report.
- Initial observer snapshot preceded React mount (empty DOM); same launch screenshot showed complete catalog. Require readiness condition before assertions.
- Initial Hide helper used activate without unhide; hidden state persisted. Added explicit unhide; window returns onscreen but active state can lag/remain false. Do not claim focus recovery from API return alone.
- Native picker shortcut posted directly to PID did not open Go to Folder; frontmost-owned HID shortcut opened it. Return had same issue; corrected guarded Return and waited for nested path sheet closure. Previous attempts canceled without authorizing library or executing Trash.
- Whole-window Accessibility diagnostic exposed native picker sidebar/recent-item labels; keep local, never publish. Subsequent traversal excludes native browser/sidebar/menu trees.
- Debug continuation 2026-10-08: referenced `/private/tmp/release-readiness-20261008.t92rg5fl` and `/tmp/release-readiness-20261008.t92rg5fl` do not exist. No matching release-readiness/acceptance/theme directory found in the checked temporary-directory roots. Screenshot, picker diagnostics and retained harness unavailable; no failed harness attempt repeated.

- Fresh durable run: screenshot helper overload needed explicit CGImage type; capture then aborted with CGS_REQUIRE_INIT until NSApplication.shared initialized. Product unchanged.
- Fresh durable run: immediate NSRunningApplication lookup raced process registration; bounded readiness retry corrected driver setup. Picker then failed text acceptance; canceled without registering assets.

## Status
**Bounded host checks finished; release NO-GO (2026-10-08)** — Recreated clean optimized arm64 app+DMG with unique identifier com.tagbasedassetmanager.releasecheck.r58bwlu7l and unchanged production CSP/window policy. Full first-run no-library UI, true Hide/unhide and AX-confirmed minimize/restore3/3; six screenshots inspected. Additional DMG disposable-install launch passed; mounted package/built/copy hashes match and DMG checksum VALID. Evidence retained durably at /Users/coffeemug/Programming/tag-based-asset-manager-release-evidence/release-20261008-58bwlu7l. Helper process-registration race corrected; capture helper CGS_REQUIRE_INIT crash corrected with NSApplication.shared. Native picker path text rejected, canceled, no library authorization bypass or Trash action. Four synthetic file hashes unchanged. Fresh frontend210/15 (6.20s), Rust88/1ignored (0.71s), build/fmt/strictClippy pass. Domain partial-failure tests are not native OS acceptance. Remaining gates: native folder/bulk/partial Trash/restore, historical intermittent blank, populated-library/background/sleep, Windows/Intel/OneDrive and Developer ID/notarization/stapling/Gatekeeper. Zero valid signing identities; only arm64 Rust target. No product source/config edits, real user data access, permissions, commits or push. Owned processes stopped and DMG detached; only primary worktree. Documentation updated with bounded results and manual gates.

---

# Task Plan: Cleanup and local main merge

## Goal
Remove verified task-owned temporary data and redundant diagnostics, validate feature changes, commit on feature branch and merge locally into main without pushing.

## Phases
- [ ] Phase 1: Inventory ownership, diff scope and safe cleanup targets
- [ ] Phase 2: Remove owned temporary/redundant files and synchronize durable evidence
- [ ] Phase 3: Run full tests/build/lint, independent review and GitNexus change detection
- [ ] Phase 4: Confirm staging/message, commit feature and merge main; verify final state

## Decisions Made
- Preserve user-created manual test library, user settings, unrelated projects and recoverable worktree backups.
- Keep durable progress/manual/debug observations; remove stale .debug-session.md (facts already recorded) and generated caches only when safe.
- User requested local merge; no push or remote publication.
- Preserve pre-existing CLAUDE.md worktree guidance separately unless user includes it in staging confirmation.

## Errors Encountered
- Inventory agent searched isolated stale copy and included unrelated workspace-manager projects; exclude all unrelated paths and verify primary targets directly.

## Status
**Phase 1** — Review/inventory underway; no cleanup deletion or commit yet.

---

# Task Plan: Native actions and reconnect acceptance

## Goal
Verify native copy/reveal/open and confirmed reconnect UI on synthetic assets; record picker/export UI limits without requesting host permissions.

## Phases
- [x] Phase 1: Check host access and prepare isolated runtime/synthetic metadata
- [x] Phase 2: Drive supported Reveal dispatch and reconnect Cancel/Confirm/restart; unsupported host flows skipped
- [x] Phase 3: Verify preservation/results/screenshots, record manual gates and clean owned runtime

## Decisions Made
- Accessibility trusted=false; native picker/save-panel selection/cancel UI cannot be automated with current host access. Do not invoke dialogs that cannot be safely closed or bypass native destination selection.
- Reconnect only synthetic missing entry to explicitly selected synthetic same-folder untagged file; no user libraries/settings.
- Clipboard test must preserve existing clipboard without reading/logging contents; skip unless exact preservation possible.
- Existing branch/uncommitted work preserved; no commits/pushes.

## Errors Encountered
- None yet.

## Status
**Supported native checks verified; manual host gates explicit** — Missing-file actions disabled; reconnect candidates same-folder/untagged only; Cancel+Review byte-identical manifest; Confirm exact-entry transfer preserving UUID/tags/notes/custom/unrelated fields/assets; restart tags/UUID/notes recovered. Reveal native dispatch completed without error; Finder selection not visually verified. Accessibility false; native picker/export UI skipped, Clipboard/Open skipped to preserve host state. Frontend190/13 pass6.65s; Rust79pass1ignored; default debug build restored2.95s; zero warning/error/CSP events. App-only screenshot inspected; fixture/asset hashes preserved; only intended synthetic sidecar changed. Owned app/server/library/settings cleaned. Evidence /private/var/folders/d3/47mnxs2x33q95gbms0193hxr0000gn/T/tag-actions-acceptance-gjhxc3wb/. No app source/config edits, commits/pushes. Human native picker/actions/export and platform/distribution acceptance pending.

---

# Task Plan: Default-policy background recovery

## Goal
Distinguish background observer suspension from user-visible failure by hiding/reactivating optimized WKWebView under unchanged production window policy.

## Phases
- [x] Phase 1: Recreate isolated synthetic library and verify default-policy control binary
- [x] Phase 2: Repeat visible/occluded/reactivated preview/filter/Rescan checks across three fresh sessions; true Hide unavailable
- [x] Phase 3: Inspect app-only screenshots, record evidence/limits, clean owned runtime

## Decisions Made
- Reuse archived optimized binary with corrected production image policy and no throttling override; no default executable overwrite.
- Observer suspension while hidden alone is not application failure. Require visible recovery or reproducible visible defect before changing code.
- Synthetic library/separate app-data only; no commits/pushes or user settings access.

## Errors Encountered
- Initial driver activated process before NSRunningApplication registration (3 setup failures, no app interaction). Added bounded startup retry.
- Bare CLI executable and temporary .app wrapper both returned hide=false/hidden=false; their usable sessions are controls only, not hidden recovery. Switched to opaque full-screen owned overlay for 15-second occlusion, then foreground activation; preserve true Hide/minimize/sleep limits.
- One no-op Edit rejected; no workspace change from that call.

## Status
**Bounded default-policy occlusion recovery verified** — Archived optimized bundle with current image CSP/default throttling, temporary .app wrapper, 15s opaque overlay, then active=true: full recovery sequence3/3, snapshots0.050/0.129/0.111s, eight rows/PNG/text/exact-filter/navigation/validation/Rescan intact; zero runtime warning/error/CSP. App-only screenshots3 inspected. Hide returned false (excluded controls); true Hide/minimize/sleep/wake/longbackground remain unverified. Frontend190/13 pass7.74s; fixture7/synthetic10 hashes preserved. Owned app/overlay/receiver/library/settings/wrapper cleaned; default executable untouched, only primary worktree. No source/config/window-policy edits, commits or pushes.

---

# Task Plan: Optimized WKWebView blank-window investigation

## Goal
Reproduce optimized custom-protocol selection failure on existing synthetic library, isolate cause without accessing user libraries, and verify any confirmed fix.

## Phases
- [x] Phase 1: Reproduce three fresh sessions and collect crash/runtime evidence
- [x] Phase 2: Rank transport, rendering and instrumentation hypotheses
- [x] Phase 3: Confirm image-CSP defect and RED regression; blank timeout isolated separately
- [x] Phase 4: Verify image fix natively/full suites; test scratch-only suspension control
- [x] Phase 5: Record learning and restore default executable/clean owned runtime

## Decisions Made
- Preserve feature branch and all existing uncommitted work; no commits/pushes.
- Existing release acceptance library/identifier only; user libraries/settings off-limits.
- No source fix before deterministic reproduction and impact analysis.

## Errors Encountered
- Existing release observer snapshot timed out after 30 seconds on already blank WKWebView.
- GitNexus query index predates preview symbols; index coverage limited.
- Requested useLibrary offset exceeded file length; corrected bounded read.

## Status
**Phase 5** — Image CSP defect independently fixed (img-src data: only) with config regression/native PNG GREEN; scripts/docs remain restricted. Full optimized sequence passes3/3 under scratch-only disabled throttling+foreground, zero runtime warning/error/CSP events. Default-background acceptance unresolved; production window-policy unchanged. 190frontend tests/build,79Rust/1ignored,fmt/strictClippy pass. Fixture7/synthetic10 hashes preserved; only native.test.ts source changed, config image scheme changed; owned app/receiver/library/settings removed. App-window screenshot inspected. Final default release rebuild passed3m47s; frontend final rerun190/13 in28.14s. Default-background/recovery remains release gate, not claimed fixed. No commits/pushes.

---

# Task Plan: Isolated release acceptance

## Goal
Exercise bundled production frontend in optimized native WKWebView, retaining production image CSP and using synthetic assets/separate app-data.

## Phases
- [ ] Phase 1: Build isolated optimized executable with copied bundled frontend and bounded observer
- [ ] Phase 2: Drive prefix filtering/navigation and native preview checks; inspect app-only screenshot
- [ ] Phase 3: Record verified results/limits, clean owned data and restore default executable

## Decisions Made
- No user libraries/settings or app source changes; preserve current branch/uncommitted work.
- Scratch observer may add loopback telemetry connection to copied config, but must retain production image/script policy and bundled UI.
- No signed/distribution/cross-platform acceptance claim from instrumented local executable.

## Errors Encountered
- Scratch receiver method `headers` collided with BaseHTTPRequestHandler.headers, causing observer fetch failures and three action timeouts. Renamed receiver method; application code unchanged.

## Status
**Phase 2** — Optimized custom-protocol bundle built in 2m 19s; exercising release UI with corrected receiver.

---

# Task Plan: Isolated native acceptance

## Goal
Verify prefix grouping and native catalog controls/previews/Trash on disposable assets with separate app-data, preserving user libraries/settings and repository fixtures.

## Phases
- [x] Phase 1: Inspect reusable host drivers and set up isolated runtime
- [x] Phase 2: Drive real app grouping, folder navigation and exact filtering
- [x] Phase 3: Exercise native Stop, bounded previews and confirmed Trash/restore where host allows
- [x] Phase 4: Record evidence and limits, verify preservation and stop owned runtime

## Decisions Made
- Existing feat/table-folder-up-button branch and uncommitted work preserved; no commit/push.
- Use unique test identifier, synthetic/copied fixture only; no real library access.
- Native safety-sensitive actions only on assets created for this acceptance run.
- Theme settings remain deferred until core acceptance is established.

## Errors Encountered
- Seeded macOS /var temporary root was not canonical (/private/var); native scanner correctly refused it. Canonicalized disposable settings and relaunched; no application fix required.
- Image CSP initially considered for diagnostic override; retained production policy instead to avoid masking rendering failures.

## Status
**Host debug acceptance verified; broader native release acceptance pending** — Real Tauri WKWebView grouped prefixes/plain/Unicode, exact-filtered and navigated folders. Native literal text/64 KiB truncation/UTF-8 rejection/HTML unsupported/decoded PNG verified. Cancel/confirmed single synthetic file Trash, OS Trash hash, exact-path restore and UUID/tags recovery pass. Stop on 40,000-file workload at 256 visited clears partial rows/unlocks controls; Rescan recovers; metadata validation 13 checked. Rust79pass/1ignored; isolated and restored-default debug builds pass; zero warning/error/CSP events. Repository fixture7 and synthetic13 file hashes unchanged. App-window screenshot inspected; accidental desktop screenshot removed. Owned app/server/library/settings/workload cleaned; only primary worktree. Evidence under /var/folders/d3/47mnxs2x33q95gbms0193hxr0000gn/T/tag-native-acceptance-hk8mhzs3/. Native picker/open/reveal/clipboard/reconnect/export UI, Finder Put Back, folder/bulk/partial Trash, production CSP/release, Windows/Intel/OneDrive unverified. No app code/config changes, commits or pushes.

---

# Task Plan: Prefix-derived tag groups

## Goal
Remove fixed tag groups; derive each group from tag text before first colon, using whole name for plain tags.

## Phases
- [x] Phase 1: Inspect grouping consumers and impact
- [x] Phase 2: Add regression tests and replace fixed groups
- [x] Phase 3: Verify full frontend tests/build and update affected docs

## Decisions Made
- Preserve existing uncommitted work on feat/table-folder-up-button; no commit/push.
- Grouping affects presentation only; preserve stored tags and exact filtering.

## Errors Encountered
- Initial lookup agent failed with provider HTTP 503 before returning results; resume with available frontend specialist.
- Resume sources HANDOFF.json and .continue-here.md absent; task_plan.md and live conversation supply state.

## Status
**Verified** — Fixed group list/union/colors removed; lowercase first-part groups built from current-folder tag counts in one pass and sorted alphabetically. Plain tags use whole name; nested suffixes preserved; exact filter/stored tags unchanged. Baseline 183 tests passed; 13 RED regressions confirmed; full suite 189 tests/13 files and TypeScript/Vite production build pass. Build emitted plugin timing notice. Scoped baseline diffs reviewed; no backend edits, native/browser rerun, commits or pushes. Read-only task agent worktrees auto-cleaned; earlier worktree untouched.

---

# Task Plan: Catalog controls, cancellation, trash and previews

## Goal
Move Up into catalog toolbar, allow scan Stop, keep folders first, add confirmed Trash/Recycle Bin for files/folders and safe Details previews.

## Phases
- [x] Phase 1: Inspect scanner, metadata safety and impact
- [x] Phase 2: Complete cancellable scan, confirmed trash and preview contracts/backend/frontend
- [x] Phase 3: Run frontend/Rust suites, builds and isolated browser smoke
- [x] Phase 4: Update docs and deliver without further commits unless requested

## Key Questions
1. How does cancellation prevent stale results and preserve completed metadata?
2. How does trash validate all targets and report partial completion without unsafe metadata writes?
3. Which bounded preview formats are supported without executing asset code?

## Decisions Made
- Preserve existing unstaged CLAUDE.md change. Work on feat/table-folder-up-button.
- Recursive indexing remains unchanged pending explicit lazy-scan request; explain first-scan cost.
- Trash only, never permanent-delete fallback. Explicit confirmation includes folder contents; root and missing assets rejected. Sidecars remain for recovery, except those naturally moved inside trashed folders.
- Preview bounded images and text first; no HTML execution, unsupported formats explicitly identified.
- Stop invalidates current UI result and cancels backend cooperatively, not merely hides progress. OS filesystem calls already in progress cannot be interrupted.

## Errors Encountered
- Repeated parallel frontend tests timed out at 5 seconds; rerun passed without raising timeouts.
- Native build absent cargo PATH; Homebrew rustup path used.
- Delete prototype borrow error and stale revision test corrected; unsafe permanent-delete prototype to be replaced before delivery.
- Folders-first sorting invalidated row-index assumptions in three UI tests; switch to ID-based assertions.
- Initial Vite start failed because existing server occupies 1420; use existing server, do not stop user process.

## Status
**Implemented and verified within host boundary** — Up/Stop, folders-first, confirmed Trash/Recycle Bin, Details text/image preview and full custom prefixes under Other implemented. 183 frontend tests pass, 79 Rust tests pass (one ignored), fmt/Clippy and browser inert-hook smoke pass. Final native release rebuild passed in 3m 12s; native platform Trash/preview/manual acceptance remains unverified. Independent Trash freshness issue fixed with deterministic per-target replacement regression. Theme presets deferred in notes.md. Initial d1281ea local commit predates expanded scope; current work uncommitted and no pushes.

---

# Task Plan: Current-folder browsing

## Goal
Show only direct children of current folder, navigate folders in-app by double-click and breadcrumbs/Up, scope filters to current folder, and clarify selected library without changing metadata safety or viewport windowing.

## Phases
- [x] Phase 1: Inspect latest virtualized table and impact
- [x] Phase 2: Add folder-scope/navigation regressions and implement
- [x] Phase 3: Verify full tests/build and browser navigation/windowing
- [x] Phase 4: Update browsing docs and deliver

## Key Questions
1. How are root/self rows hidden from listing while current folder remains taggable?
2. How do scoped counts/filters/issues/saved searches avoid flattening descendants?
3. How does removed current folder recover safely during rescan?

## Decisions Made
- Recursive approved-library scan remains disposable index; default visible rows only direct children, excluding current folder self row.
- Double-click folder navigates in app; explicit context/inspector Open still opens OS folder. Double-click file opens native app.
- Query/view/tag/kind filters current-folder only; breadcrumbs/Up let user move freely without broad authorization.
- New location navigation resets selection and virtual scroll, preserves filters. Library change resets current folder to root.
- Remove development Workspace/milestone labels; sidebar selected name reflects ordinary root basename, not rigid workspace.

## Errors Encountered
- Full suite exposed two stale filename selectors: path column duplicated filename text. Scoped both test queries to `.name-cell .name-content span`; App tests passed.
- Final edge review found stale current-folder state after rescan to an empty library. Removed nonempty-assets guard and added regression; full suite passes.
- TypeScript build flagged two unused intermediate values; removed both after verifying direct-child projection already supplies required state.
- First live browser smoke tried to click a folder via `button` role; folders render table rows. Updated scratch driver to target the table cell; rerun passed.

## Status
**Current-folder browsing implemented and host-verified** — All 158 frontend tests pass; TypeScript/Vite build passes; real-browser route-mocked smoke validates three-level direct-child browsing, current-folder filtering, breadcrumbs and Up. Viewport virtualization/windowing preserved. Documentation updated. Native-specific behavior remains covered by existing manual acceptance, not browser smoke.

---

# Task Plan: Large-library scan stall

## Goal
Reproduce and fix post-traversal scan stall at 165,540 visited using synthetic assets and disposable copied fixture only; preserve manifests and asset bytes.

## Phases
- [x] Phase 1: Observe scanner finalization and reproduce three times
- [x] Phase 2: Rank merge, serialization, and render hypotheses
- [x] Phase 3: Add RED regression and confirm bottleneck
- [x] Phase 4: Apply impact-checked scoped fix and run full validation
- [x] Phase 5: Record evidence and remove owned diagnostics

## Decisions Made
- Branch `fix/large-library-scan-merge`; no commit/push requested.
- Never access OneDrive Workspace or any real user library.
- Preserve previous debug evidence and immutable sections. Use existing investigation files, not new report files.

## Errors Encountered
- Cargo absent from default PATH; use `/opt/homebrew/opt/rustup/bin`.
- Initial branch snapshot stale; current branch verified before creating fix branch.
- RTK cargo output omitted timings; captured raw subprocess logs and read them.
- Test name/path duplicate selectors corrected; bounded mount and keyboard RED remain genuine.
- zsh nonexistent project-skill glob aborted validation command; used Python inventory and reran Rust checks.
- Native `tauri build --debug` embeds production assets, preventing injected observer; stopped owned app and rebuilt via cargo with TAURI_CONFIG for live devUrl1421.

## Status
**Verified scale fix; OneDrive acceptance manual** — all-row render RED3/3(no commit30s), final windowed render GREEN905/895/930ms. App LOWimpact;150frontend tests/build,64Rust tests plus explicit165540-entry phase benchmark3runs,fmt/strictClippy/defaultnativebuild pass. ActualWKWebView165550safe copiedfixture+synthetic rows12.25s,23–28mounted,40pxheight,finalUnicode/range165550/filter1 verified,zero warnings. Original/copy7filehashes unchanged;owned workload/appdata/servers removed;defaultidentifier restored. Nativeproduction manifestlogic unchanged, ignored benchmark only. LearningDB/knowledgebase recorded. GitNexusempty detection limited by allsourcesuntracked;baseline diffs reviewed. No commits/pushes. Existing earlier agent/user worktrees untouched; current read-only ephemeral agents cleaned automatically.

---

# Task Plan: Native IPC warning investigation

## Goal
Establish provenance of native IPC fallback/stale callback warnings using isolated app-data and copied fixtures, without user library changes.

## Phases
- [x] Phase 1: Run three native baselines and capture environment/evidence; original warnings absent 0/3
- [x] Phase 2: Rank transport, page lifecycle, and application callback hypotheses
- [x] Phase 3: Exercise actual WKWebView/native IPC; controlled fallback recovers, async reload reproduces stale callbacks 3/3
- [x] Phase 4: Verify suites/builds/fixture hashes and preserve explicit platform/manual acceptance limits

## Decisions Made
- Keep application sources/config unchanged unless actual application defect is confirmed.
- Use separate identifier, disposable fixture copy, and local evidence receiver; no user settings or asset mutations.
- Preserve earlier milestone evidence below. No commits/pushes requested.

## Errors Encountered
- Initial command filtering obscured branch output; inspected through Python subprocess and confirmed feature branch.
- Diagnostic invoke reassignment has no effect because Tauri property non-writable; transport instrumentation and actual command responses used instead.
- Initial validation screenshot driver expected collapsed detail text; actual UI shows summary. Corrected assertion to `1 validation issue`/`9 checked`; rerun passed.
- First screenshot read preceded file creation; later image exists and was inspected.

## Status
**Investigation verified; original bug not reproduced, release acceptance still limited** — three actual WKWebView native sessions clean, 21 custom-protocol HTTP 200 responses, real Rust scan/Channel/validation/rejection and UI Rescan/Validate pass. Forced fetch failure recovers through postMessage; pending async scan/reload gives genuine stale callbacks 3/3, new page recovers 6,010 rows. This proves controlled lifecycle provenance, not original exit-time cause. 146 frontend/64 Rust tests, production build, fmt/Clippy pass. Original and copied fixture seven-file hashes unchanged; temporary load removed. Separate identifier/settings used; Accessibility false. Native picker/open/reveal/clipboard/repair/export and release/Windows/Intel/OneDrive manual checks remain unverified. No application source/config edits, fix, commits/pushes. Evidence `/tmp/native-ipc-evidence/`; original-bug red/fix pipeline gates intentionally blocked.

---

# Task Plan: Milestone 5 — native actions, validation, recovery and export

## Goal
Finish MVP native open/reveal/path-copy, visible metadata validation, confirmed same-folder reconnection and explicitly selected JSON backup export without modifying asset files.

## Phases
- [x] Phase 1: Inspect contracts/security/impact and define final command DTOs
- [x] Phase 2: Implement Rust native actions, validation, reconnect/export with safety tests
- [x] Phase 3: Wire native lifecycle/confirmation UI/context menu and recovery/error states
- [x] Phase 4: Run full tests/builds/runtime checks and finalize docs/manual/package evidence

## Key Questions
1. How does repair preserve missing UUID/tags/notes and reject occupied/unsafe same-folder targets?
2. How does explicit export authorize only native-selected backup destination without broad frontend access or asset overwrite?
3. Which platform checks remain unverified rather than falsely marked production-ready?

## Decisions Made
- Native actions accept approved library/scan asset IDs, never arbitrary paths or shell strings.
- Repair transfers missing entry to existing same-folder regular file after confirmation; no auto matching/hash or asset rename/move.
- Export native save picker is narrow explicit exception for backup file. Never overwrite ordinary user assets/manifests; require new backup destination if unsafe/existing.
- Validate reports malformed manifests/missing refs/duplicate UUIDs/invalid tags/unreadable directories; scan never auto-repairs.
- Import deferred; notes editing/file operations remain out of MVP. Preserve dense deduplicated layout and saved-search/bulk behavior.

## Errors Encountered
- Autogenerated UI worktree removed after empty wait; created dedicated populated milestone-5-ui and resumed, no original UI edits from agent.
- Six new native lifecycle hook tests RED missing methods, then implementation GREEN31tests. Bridge command tests added.
- UI inspector relative-path action initially enabled for missing rows while hook rejected it; disabled and regression tested, browser clipboard fallback removed.
- Browser context menu vanished after layout scroll. preventScroll focus alone and portal alone insufficient; portal plus user-wheel/outside/Escape close policy fixed, real-browser smoke and regression passed.
- Native dev launch compiled but emitted IPC custom-protocol fallback/stale callback warnings before exit; no clean native integration claim. Unsigned macOS bundle and release executable separately verified.
- README edit initially targeted obsolete settings sentence/no-op replacement; corrected current text, docs verified links.

## Status
**Milestone 5 code and host verification complete; cross-platform/native acceptance outstanding** —146frontend tests,64Rust tests, TypeScript/Vite build, Rust fmt/all-target Clippy, optimized native executable and unsigned macOS .app bundle pass. Browser isolated-hook smoke/screenshots verify confirmation/actions/report UX. Native dev launch emitted IPC fallback/stale callback warnings before exit; picker/open/reveal/clipboard/repair/export UI and Windows/Intel/OneDrive acceptance unverified. Docs/package commands/evidence saved. No userfilechanges/commits/pushes; agent worktrees retained per project cleanup rule.

---

# Task Plan: Milestone 4 — bulk tags, filters and saved searches

## Goal
Confirm bulk tag changes before sidecar writes, support AND/ANY/NOT and kind filters, and persist editable named searches in app-local data.

## Phases
- [x] Phase 1: Inspect contracts/impact, define bulk failure semantics and saved-search scope
- [x] Phase 2: Implement Rust bulk mutation preflight/results and durable saved-search settings/tests
- [x] Phase 3: Implement filters, saved-search DTO/serialization and native lifecycle bridge
- [x] Phase 4: Build bulk confirmation and saved-search UI; verify tests/builds/runtime/docs

## Key Questions
1. How does bulk confirmation bind exact selection, tags and revisions and report partial failures without unsafe rollback?
2. How are saved searches migrated into existing local settings without losing roots or malformed state?
3. Which filter fields persist across search save/load without silently changing query semantics?

## Decisions Made
- Bulk sidecar writes atomic per manifest, not across directories. Preflight all targets; write failure reports committed IDs and stops, never falsely promises transaction or silently rolls back synced data.
- Saved searches app-local and per-library; persist query, view, match mode and asset kind. Create/update/rename/delete via typed native commands.
- Query terms remain tags unless quoted filename/path text. ANY affects required tags only; NOT and text terms always AND.
- No file operations, notes editing, reconciliation or export in milestone 4. Preserve deduplicated dense UI.

## Errors Encountered
- Initial UI agent worktree removed on completion before implementation. Created/restored dedicated populated milestone-4-ui; no original files edited by agent.
- Filter ANY/kind RED tests failed before implementation, then25catalog tests pass.
- Bulk/search lifecycle RED newmethods missing, then newhook implementation tests pass.
- Saved-filter deserialize array type was string-coerced; RED invalidtype tests, strict string checks fix. New helper not indexed impactUNKNOWN; bounded serialization module only.
- Backend agent repeatedly API timed out/stalled; handed back integrated unverified files. Actual42-test run41passed1failed exposed rollback test missing active-library setup, fixed after LOW impact check.
- Added three native coverage tests: grouped folder+child one write, existing failed sidecar unchanged/exact partial count, closure rollback and searches survive scan persistence. Final45 tests pass.
- Clippy found six needless borrows in shared preflight/refactor; CRITICAL preflight impact warning issued, borrow-only fixes, final lint pass.
- Browser smoke initially used Windows Ctrl modifier on macOS and textbox role for datalist combobox; corrected test driver, confirmation/filter/search smoke passed.
- Saved-search dialog JSON key ordering made unchanged filters appear changed; LOW component impact, stable serializer comparison and regression test, final121 frontend tests pass.

## Status
**Milestone 4 implemented and verified within host boundary** —121 frontend tests,45 Rust tests, frontend/TypeScript build and optimized native release passed; Rust fmt/all-target Clippy warnings denied passed. Browser isolated-hook confirmation/filter/search smoke inspected; fixture originals unchanged. Native picker/UI lifecycle, Windows/Intel/OneDrive not rerun. No user metadata edits/commits/pushes; workspaces retained per project rule.

---

# Task Plan: Milestone 3 — sidecar metadata and single-item tagging

## Goal
Read per-directory manifests during scans, preserve durable UUID/tags/notes and stale entries, and safely add/remove tags directly on single file/folder via atomic sidecar writes without modifying asset contents or paths.

## Phases
- [x] Phase 1: Read current scanner/UI/contracts, impact analysis, decide directory ownership and edit concurrency
- [x] Phase 2: Implement tested Rust manifest parsing, scan metadata merge and safe atomic tag mutation
- [x] Phase 3: Wire typed single-item tag commands and direct editable chips/autocomplete/error states
- [x] Phase 4: Verify all tests/builds, fixture persistence and UI; update docs/evidence

## Key Questions
1. Which manifest owns folder tags without duplicating parent-child identities?
2. How are malformed manifests, duplicate UUIDs, missing children and concurrent metadata changes preserved?
3. How can frontend identify fresh/stale assets securely without sending arbitrary paths?

## Decisions Made
- Only single-item tag add/remove in milestone 3; bulk operations, notes editing, saved searches, reconnect and export remain later milestones.
- Folder own `.` preferred for new folder edits; existing parent entry honored if child `.` absent. Both present is visible ownership conflict, no silent merge/write.
- Reading scan never creates manifests/UUIDs. UUID assigned only first explicit metadata edit; existing identity preserved.
- Explicit tag edit writes only sidecar; asset bytes/paths unchanged. Preserve unknown fields and stale entries; reject malformed/unsupported manifests.
- Retain UI deduplication: sidebar library identity; catalog single progress/Rescan.
- Target-entry/ownership revision excludes unrelated entries and updatedAt to allow sibling edits; atomic replacement rechecks exact fresh manifest bytes.
- Row IDs path-based remain stable for selection; metadataId separate durable UUID, scan never invents UUIDs.

## Errors Encountered
- Initial agents received empty worktrees because original sources untracked. No edits landed; replaced with explicitly populated isolated worktrees, copying owned results back later.
- Backend agent API stream timeout; resumed same populated workspace. Later stopped incomplete; replacement Opus backend owner uses separate populated snapshot, old worktree changes not merged.
- Vitest initially discovered nested worktree copies; added explicit src test include, local scoped tests rerun pass.
- Four new hook edit tests RED missing API, then GREEN implementation. Native bridge edit DTO test added.
- Mismatched command-response test exposed JavaScript errors shown in primary message; toAppError HIGH impact warning issued, narrow instanceof Error wrapping fix with regression test, native structured errors preserved.24 parent lifecycle/bridge tests pass.
- UI blocked-row Needs attention OR bypassed query; LOW App/catalog impact checks, RED regression then fix. Integrated81 frontend tests pass.
- Browser UI smoke first removal assertion accidentally matched another row; scoped to selected row, final smoke passed.
- Intermediate parent build failed App test mock missing new edit hook fields; integrated UI agent mock update resolved, production frontend build passed.
- Integrated backend initially34tests pass; final parent review found raw legacy display tags/no-op rewriting. CRITICAL merge/write impact warning issued; normalized display and semantic no-op fix with test,36 native tests pass after invalid-type preservation test.
- Initial native agent incomplete sources replaced; second agent wrapper API timeout but child completed actual backend fixes with validatedhandoff. Primary copied finalownedRust files only, not intermediate oldworktree.
- Native verification used separate app-data identifier; Accessibility permission unavailable, native tag-write UI not automated. No user metadata modified.

## Status
**Milestone 3 implemented and verified within host boundary** —81 frontend tests,36 Rust tests, frontend/native optimized build, Rust fmt/all-target Clippy passed. Copied fixture real command scan/edit/reload verified with asset bytes/UUID/notes/stale data preserved; repository fixture7files unchanged. Browser mock tag-edit smoke and isolated native first-run screenshot inspected. Native picker/write UI automation unavailable; Windows/Intel/OneDrive pending. No user library edits, commits/pushes; populated agent worktrees retained under project cleanup rule requiring committed/pushed changes.

---

# Task Plan: UI deduplication before milestone 3

## Goal
Remove duplicate library identity, progress and rescan presentations while retaining essential library information and dense catalog controls.

## Phases
- [x] Phase 1: Inspect current UI, tests and symbol impact
- [x] Phase 2: Add regression tests and consolidate components
- [x] Phase 3: Run full tests/build and visually verify scan/idle layouts

## Key Questions
1. Which location owns library selection, root path, scan progress and rescan action?
2. How do collapsed sidebar and scan failure/loading states preserve useful information?

## Decisions Made
- Sidebar owns active library selector and path; remove redundant breadcrumb and library/location summary cells.
- Catalog owns single progress indicator and Rescan action; remove repeated sidebar action/count and outer progress strip.
- Keep asset count and last scan summary; no milestone 3 backend/tag work.

## Errors Encountered
- Visual smoke route mock initially failed due to Vite cache-key/React import mismatch; matched module query and imported same cached React instance. Final scan/idle/collapsed browser smoke passed.

## Status
**UI cleanup verified** — App impact LOW; three RED duplicate regressions then56 tests GREEN, frontend production build passed. Mocked browser scan/idle/collapsed screenshots inspected. Sidebar owns library context, catalog one progress/Rescan, summary count/date only. No backend changes/native rerun/commits/pushes.

---

# Task Plan: Milestone 2 — native libraries and safe scanning

## Goal
Select real libraries through native picker, persist approvals locally, scan safely off-thread, and display real files/folders without modifying assets or library metadata.

## Phases
- [x] Phase 1: Inspect contracts and impact; define Rust/TypeScript DTOs and security boundary
- [x] Phase 2: Implement and test native root authorization, local settings and scanner
- [x] Phase 3: Wire real library UI, progress and recoverable errors; test lifecycle
- [x] Phase 4: Verify frontend/native builds, safety tests and documentation

## Key Questions
1. How are roots approved only through native picker and restored without broad frontend path access?
2. How does scanner reject traversal/symlink escapes and report unreadable entries?
3. How do progress and library switching avoid stale scan/selection updates?

## Decisions Made
- Implement milestone 2 only. Sidecar parsing and tags deferred to milestone 3; scanner excludes manifests but does not modify or read their contents.
- Library app-data settings writes allowed; library and assets remain read-only.
- Preserve previous completed plans below.

## Errors Encountered
- Previous session ended prematurely with two unfinished agents and no native/bridge files. Resumed both agents; no completed implementation assumed.
- New useLibrary absent from GitNexus index; impact attempted UNKNOWN. Consumers manually bounded to App/tests.
- Hook RED tests six behavior failures, then implementation GREEN eight tests. Native bridge four tests passed.
- Initial UI suite four selector/setup failures; frontend agent fixed and added regression coverage. Final53 frontend tests passed.
- Backend review found picker canonical/relative-path/nullable issue DTO problems, Windows cfg unused import, non-Unicode test portability, structured errors and transactional rollback gaps; corrected and expanded12 Rust tests pass.
- Backend agent API response failed during final edits; resumed and verified complete error helpers/tests. Temporary unused helpers warned until wired; final clippy warnings denied passed.
- GitNexus detect_changes returned zero because application sources remain untracked; reviewed Git status/source manually rather than treating empty detection as proof.
- Native dev watcher rebuild temporarily removed app process; direct executable launch plus isolated screenshot verified real native catalog. Accessibility permission false; no picker automation attempted.

## Status
**Milestone 2 implemented and verified within host test boundary** — 53 frontend tests, 12 Rust tests, frontend build, Rust fmt/all-target clippy warnings denied, optimized native release executable passed. Native WKWebView screenshot shows real registered rows/inspector; browser-required-state smoke passes. Native picker automation unavailable (Accessibility false); Windows/Intel/OneDrive/manual lifecycle checks remain unverified. All docs updated; no commits/pushes/worktrees.

---

# Task Plan: Tag-Based Asset Manager — Milestone 1

## Goal
Deliver runnable Tauri v2 + React + TypeScript + Vite + Tailwind desktop scaffold with dense mocked asset table, automated frontend checks, and honest milestone documentation; defer filesystem/tag persistence to milestones 2–5.

## Phases
- [x] Phase 1: Inspect environment, research compatible setup, define structure/types and milestone boundary
- [x] Phase 2: Scaffold on feature branch; build typed mocked desktop interface and base tests
- [x] Phase 3: Add README, metadata design, manual test plan, fixture and progress log appropriate to milestone 1
- [x] Phase 4: Install, run tests/build, launch Tauri dev when toolchain permits, report verification

## Key Questions
1. Which development tools and Tauri prerequisites are available on this machine?
2. What exact dependency versions and commands produce a current Tauri v2 + Vite + Tailwind scaffold?
3. Which interactions should milestone 1 mock without pretending native filesystem integration exists?
4. Can `pnpm tauri dev` actually launch and be verified here?

## Decisions Made
- Milestone boundary: Only milestone 1 implementation now; later milestone features are documented as planned, not shown as functional.

## Errors Encountered
- `cargo` and `rustc` not on initial PATH; installed Homebrew rustup and stable Rust. Commands use `PATH=/opt/homebrew/opt/rustup/bin:$PATH` without changing shell config.
- `rustup-init` no longer shipped by Homebrew; used `rustup toolchain install stable --profile minimal` and `rustup default stable`.
- Agent worktree isolation reported not a repository despite valid local Git; documentation agent used remote mode and read same workspace. No commits or pushes.
- Initial query regression test caught plain-token behavior; concurrent edits briefly caused code/test disagreement. Final behavior follows original spec: bare tokens required tags, quoted text paths.
- TypeScript build caught unused `Clock3` and ES2020 `.at()` incompatibility; removed import and used indexed access.
- Component column-header test expected exact name but resize separator contributed to accessible name; explicitly labeled headers and adjusted test match.
- Native window screenshot failed `could not create image from window` (screen capture unavailable). Native process and on-screen window verified; Chrome frontend smoke and screenshots verified separately.
- Temporary Playwright package resolution through `pnpm dlx ... node` failed; used cached package explicit path for scratch smoke script.
- Rust fmt initially unavailable under minimal toolchain; installed rustfmt/clippy, both checks passed.
- `pnpm test --reporter=verbose` hit pnpm's reporter flag; direct `pnpm exec vitest run --reporter=verbose` ran all named tests.
- Native release prebuild initially failed fixture Node types; added explicit `node` and `vite/client` types to tsconfig. Frontend and release build rerun passed. Changed identifier suffix from `.app` to `.desktop` to remove Tauri macOS bundle warning.

## Status
**Milestone 1 verified within stated boundary** - 32 frontend tests, production frontend build, Rust formatting/clippy/test-profile build (0 native unit tests), native dev launch/window, and optimized host release executable passed. Browser UI smoke/screenshots verified separately. Native WKWebView interaction, Windows/Intel packaging and cloud sync remain unverified. Milestones 2–5 pending; no user files accessed.

---

# Task Plan: App theme settings

## Goal
Add app-local theme selection with accessible palette presets while preserving library roots, saved searches, dense catalog readability, and existing metadata behavior.

## Phases
- [x] Phase 1: Inspect settings persistence, UI token architecture, theme backlog, and symbol impact
- [x] Phase 2: Define theme DTO/default/migration and palette token behavior; add regression tests
- [x] Phase 3: Implement native settings persistence and theme selection UI on a feature branch
- [x] Phase 4: Verify frontend/Rust suites, build, contrast/readability, and app-local settings preservation — eight presets passed; bounded foreground restart clean3/3 + instrumented3/3; historical intermittent blank remains unresolved release risk

## Key Questions
1. How should app theme preference coexist with existing roots and saved searches during settings mutation/migration?
2. Which palette tokens can vary without reducing dense table readability or accessible state contrast?
3. How should system appearance and stored user selection interact?
4. Does the native acceptance executable load instrumented development UI or bundled production assets?

## Decisions Made
- Preserve existing app-local library roots and saved searches; never write theme preference to library sidecars.
- Keep rows and table surfaces restrained; use palette tokens, not saturated row gradients.
- Implement only after impact analysis and feature-branch creation; no commit/push unless requested.

## Errors Encountered
- None.

## Status
**Implemented; bounded host acceptance verified; historical blank remains unexplained** — branch `feat/app-theme-settings`. App-local enum/persistence and eight presets (Workshop default, Coral, Lavender, Ocean, Mint, Sunset, Stone, Midnight); explicit selection, including no-library desktop state. Theme save requires desktop, serializes with other native mutations, applies only committed response, and preserves scan/catalog/folder/filter/selection; rollback/error path covered. Rust `LibraryState`, backward settings default, strict enum, atomic persistence rollback and Tauri command wired. Nine Rust theme tests cover all presets round-trip, invalid values/original bytes, closure/write rollback, roots/searches/unknown fields/scan authorization, search/removal state. Frontend tests cover defaults/load, command DTO, busy/failure/unmount, selector, browser disabled, theme/folder/query/selection and document-root tokens.

Validation: **209 frontend tests / 15 files**, `pnpm build`, **88 Rust tests passed, 1 ignored**, `cargo fmt --check`, strict all-target Clippy and `git diff --check` passed. Palette contrast tests enforce 4.5:1 for key text pairs and 3:1 focus/accent contrast; selections and disabled states have semantic tokens. Isolated native app built/launched with unique identifier and synthetic root/search/settings; baseline screenshot captured/inspected. Native instrumentation observer never became ready; enqueue returned HTTP 403 despite scratch-only CORS/CSP fixes. Therefore actual preset click/apply/restart persistence and per-preset rendered screenshots **not verified**. Native command/persistence behavior is Rust-tested but no UI IPC acceptance claim. Screen recording preflight passed; only app-owned native window captured. User library/settings untouched; synthetic settings and scratch evidence preserved. No commits or pushes.

Native retry 2026-10-08: actual bundled WKWebView passed all eight presets via native Rust IPC, selected-row/query preservation, theme-only settings changes, asset hash preservation; Midnight screenshot confirms sidebar stripe removal. Restart retained Midnight/root/search/unknown fields on disk, but instrumented and clean uninstrumented copied bundles rendered blank white after restart. UI restart remains blocked; no fabricated rendering success. Test runtime stopped; default native debug executable restored by normal cargo build (20.77s). Frontend210/15/build, Rust88/1ignored/fmt/strictClippy passed. Evidence and synthetic app-data preserved. Independent review zero confirmed findings. No commit/push.

Foreground restart investigation 2026-10-08: same clean archived bundle renders Midnight/full synthetic catalog/search3/3; instrumented bundle native DOM/tokens restored3/3, zero JS/error/CSP events. Blank symptom0/6, historical blank screenshots genuine but not explained or fixed. Settings only auto-scan timestamp changes; asset hashes preserved. Parent independently parsed result JSON invariants and inspected restart-3 screenshot. No production edit justified; bounded foreground acceptance passes, historical intermittent blank retained as release risk. Apps/receiver stopped; no builds/permissions/user-data/commit/push during investigation.

Impact warnings relayed before edits: Rust `load`, `mutate`, `persist` CRITICAL; other indexed native state helpers LOW. GitNexus detect_changes: 39 symbols, 42 affected, 17 files, CRITICAL summary due shared persistence/scan flows; regression suites pass. Errors: initial inline test client caused repeated effect, fixed stable instance; pre-UI App tests expected only one “Workshop” string, assertions scoped; native Observer harness CORS/CSP/403 blocked UI interaction. No commits/pushes.

# Task Plan: Repository CLAUDE.md Initialization

## Goal
Enrich existing CLAUDE.md with source-verified development commands and architecture while preserving GitNexus instructions.

## Phases
- [x] Phase 1: Inspect implementation, scripts, documentation, and repository rules
- [x] Phase 2: Select concise, nonduplicated guidance grounded in current code
- [x] Phase 3: Add required prefix and repository guidance; preserve GitNexus block
- [x] Phase 4: Verify commands and documentation, then deliver

## Key Questions
1. Which build, test, and native commands are configured and runnable?
2. Which capabilities exist now versus remain planned?
3. Which metadata and query contracts constrain future work?

## Decisions Made
- Preserve completed milestone plan and existing GitNexus guidance.
- Work on existing feature branch `feat/milestone-1-desktop-scaffold`; no commits or pushes requested.
- Detect foreign-agent config paths only; do not read or import them.
- Preserve concurrent Model Routing and worktree-cleanup instructions found during editing; move required CLAUDE.md prefix before Model Routing. No source symbols edited.

## Errors Encountered
- `doc-pipeline` failed with malformed API response after streaming timeout; continue source research using read-only specialist agents.
- Tool probe found `cargo`/`rustc` absent from default PATH (exit 1); native checks succeeded with `/opt/homebrew/opt/rustup/bin` prepended for those commands.
- Exact GitNexus comparison against AGENTS.md failed because CLAUDE.md has an additional concurrent worktree-cleanup instruction. Preserve that addition and verify all AGENTS.md GitNexus lines remain in order instead.
- Reference validator treated documented future bundle output `src-tauri/target/release/bundle/` as an existing source; exclude generated-output references. Bundle build not rerun.

## Status
**Verified and ready to deliver** - CLAUDE.md enriched with commands, architecture, current mock boundary, query semantics, and proposed metadata constraints. Required prefix, 25 source references, preserved GitNexus/concurrent guidance, and dist output validated. Frontend suite (32), build/type check, single-test/file commands, Rust fmt/clippy/test-profile checks passed (0 Rust tests). Native launch/bundles not rerun. No application source edits, commits, pushes, or remaining agent worktrees. Foreign config presence detected without reading; offer deterministic import in final reply.
