# Optimized release WKWebView observations

## Symptoms and reproduction (immutable)
Expected: Selecting synthetic PNG shows bounded raster preview; catalog remains usable.
Actual: Optimized custom-protocol app starts with eight rows and correct grouping, but observer times out after PNG selection; prior app-only screenshot is blank white.
Environment: Darwin 27 arm64; Node 24.19.0; Tauri optimized release with copied production frontend and unique app-data identifier. Production image/script CSP retained; loopback observer connection only addition. Synthetic library only, user libraries off-limits.
Steps: Start isolated release; wait for eight-row snapshot; group/filter/navigate; select Readme.txt, Large.txt, Invalid.txt and Unsafe.html successfully; select Pixel.png; observer fails to respond within 30 seconds. Three fresh launches repeat same PNG timeout. Three separate text-only launches pass.
Knowledge base: Existing large-catalog rendering entry found; not applicable to eight-row PNG-specific failure. No prior matching preview/release entry.
Evidence: /private/var/folders/d3/47mnxs2x33q95gbms0193hxr0000gn/T/tag-release-acceptance-_tv_sbmp/selection-reproduction.json and matrix-results.json. No WebKit crash reports found. Runtime logs show background suspension, not confirmed process crash.

## Ranked hypotheses
1. Image CSP mismatch triggers failure during raster render. HIGH: backend returns data:image/png;base64 URL; production img-src excludes data:. Debug live devUrl may use different CSP. Test native preview without rendering, controlled data-image insertion, identical release with only raster data scheme allowed.
2. Native preview IPC or image bytes corrupt WebContent. MEDIUM: text IPC works; failure starts at image. Test native preview invocation without img; decode same synthetic PNG separately.
3. Scratch observer or host lifecycle loses page/telemetry. MEDIUM: receiver previously had bug, stale action on boot gave null-row error; timeout alone does not prove blank/crash. Test heartbeat/mutation/page lifecycle evidence and direct native observation.
4. React image error loop or inspector render error. LOW: image onError sets fixed error state; small text/folder inspectors work. Test image render with native load isolated and existing component tests.

## Status
Confirmed independent image-CSP defect: actual native PNG selection under original production img-src yields blocked data URL and visible decode error with intact catalog 3/3; backend PNG payload valid. img-src-only `data:` addition and config regression fix this image rendering issue. General blank/timeout not attributed to CSP: compatible image policy still times out during occluded/background full sequence, sometimes before PNG. Scratch-only disabled background throttling plus foreground activation passed complete sequence 3/3 with zero runtime warning/error/CSP events. Host suspension logs support lifecycle explanation; this does not prove default-background behavior fixed. Production background-throttling policy unchanged.

## Final evidence (2026-10-07)
190 frontend tests pass; production build, 79 Rust tests/one ignored, fmt/all-target Clippy pass. Optimized bundled WKWebView with scratch disabled throttling verified prefix/exact filtering/folder navigation, literal text, 65,536-byte truncation, invalid UTF-8 rejection, unsupported HTML, decoded PNG, metadata validation and Rescan recovery in three fresh sessions. App-window screenshot inspected. Original image CSP RED/compatible-policy GREEN isolated separately with default throttling; no claim that scratch window-policy control is a production fix. Evidence `matrix-results-disabled-throttling.json`, `diagnostic-blocked-ui-{1,2,3}.json`, `diagnostic-data-ui-alone.json` and `release-awake-window.png` in release acceptance directory.

---

# Large-library scan observations

## Bug signature
Expected: Completed165,540-entry scan yields usable catalog.
Actual: User screenshot OneDrive Workspace165,540 visited,0rows, scanning indefinitely.
Environment: Darwin27 arm64; Node24.19.0, pnpm12.4.2, Rust via Homebrew rustup; branch `fix/large-library-scan-merge`.
Safety: Synthetic DTOs plus disposable copied repository fixture only. Never read/modify OneDrive Workspace. No prior debug knowledge base.

## Components and exact chronology
1. `scan_tree`: iterative filesystem traversal emits every128 visited, then metadata merge, sort, final exact visited event.
2. `merge_manifest_metadata`: HashMap manifest lookup; no catalog-wide lookup per entry. Safety checks revalidate folder ancestry. Slow synced IO remains possible, not measured against user library.
3. `record_edit_snapshot`: linear HashSet and HashMap clones after final progress.
4. serde_json/Tauri: serialize complete DTO after backend command returns.
5. React App: render complete catalog result; independent cost investigation underway.

## Ranked hypotheses
1. Unbounded frontend rendering consumes main thread after result. HIGH candidate: exact165,540 final event not multiple128, merge already complete; all rows mapped. Test synthetic165,540-row result in real browser three times, bounded-row regression.
2. Metadata merge/folder IO stalls. MEDIUM candidate: per-folder ancestor validation and synced sidecar reads can be costly. Test isolated merge with165,540 synthetic assets and copied fixture, then separate phase timings. No library IO allowed.
3. DTO serialization/snapshot/IPC transfer dominates. MEDIUM candidate: large serialized payload follows final progress. Test serialization bytes/time and snapshot separately, native copied workload if required.
4. Stale callback/navigation lifecycle. LOW candidate: previous controlled reload reproduced warnings but no screenshot chronology ties current stall to reload. Test live page without navigation; do not dismiss concrete scale issue as lifecycle.

## Backend isolation results
Three synthetic165,540 extra assets plus9 copied fixture rows:165,549 rows. Merge1.936/1.972/2.185s; sort18.6/21.3/24.0ms; snapshot328/277/296ms; JSON serialization2.116/2.380/2.821s,58,604,923 bytes. All metadata fixture DTOs unchanged and serialized round-trip exact. No quadratic metadata join found. Benchmark uses nonexistent inert DTO names to isolate merge/serialization, not filesystem traversal.
Evidence `/tmp/large-scan-evidence/backend-{1,2,3}.log`.

## Confirmed root cause and RED test
Isolated browser result injection165,540 rows3/3 calls setAssets then never commits within30s; no navigation or nativeIPC involved. Before fix React synchronously maps every filtered row, mounts TagEditor plus icons/cells for165,540 entries. Regression with500rows fails expected mounted<80 (actual500); keyboard End fails focus navigation; range test corrected duplicate name/path selectors before rerun. Root cause unbounded render, not proven merge hang. Phase3 inspection: no null/off-by-one/silent exceptions/resources relevant; rows assumed small; synchronous commit monopolizes main thread.

## Scoped fix and GREEN evidence
App impactLOW,no upstream indexed callers/flows. Viewport+8rowoverscan window with hidden spacer rows; counts/search/sort/selection still full result. Full-selection IDMap/Set and memoized summaries avoid quadratic selection/issue matching during scroll. Query parsed once. Keyboard Arrow/Home/End focus crosses windows, tag-control keys ignored. Fixed40px rowCSS matches scroll math. Manifest safety/DTO contract unchanged.
149frontend tests pass;64Rust tests pass (1explicit large benchmark separately passes3runs); TypeScript/Vite build and strictClippy pass. Same synthetic browser3runs commits in945/890/919ms from setAssets;24initialrows,28viewportrows plus spacer after measurement. Native safe workload verified in actual WKWebView:165,540syntheticfiles plus copied fixture yielded165,550rows,165,548visited; boot-to-catalog12.251s, final-progress-to-catalog3.440s.23–28rows mounted,40pxheight measured,scroll finalUnicodefile,Shiftselect165,550,quoted FlexiDragonfilter1row/resetTop0. Zero runtime warnings/errors. Native instrumentation first production-asset build not observed; dev rebuild used separate identifier and devUrl1421. Background-window requestAnimationFrame paused; condition-basedDOM polling corrected driver, no app fix for driver issue. Native screenshot inspected. Copied/original fixture7fileSHA256 identical; synthetic165,540files all0bytes; owned library/appdata removed, default native identifier build restored. Independent delta review found no confirmed defects and reran3window tests.
Follow-up tag-refresh RED exposed jumpingtop on everyasset update; App LOW impact reset narrowed to library/filter/sortcontrols. Fourth regression GREEN;150frontendtests nowpass. OriginalVite1420 ended externally during final browserrerun (not killed by this task); own1422server used. GitNexusdetect_changeszero because all appsourceuntracked; explicit baseline diffs reviewed, not empty detection treated as proof.

---

# Native IPC observations

## Bug signature
Expected: Native IPC resolves commands and progress in live WKWebView without transport/stale callback warnings.
Actual prior report: Native dev launch emitted fallback/stale callback warnings before exit; exact original exception and chronology unavailable.
Environment: macOS Darwin 27.0.0 arm64, Node 24.19.0, pnpm 12.4.2, Tauri 2.12.1, wry 0.57.0. Current feature branch retained. No existing debug knowledge base.

## Reproduction
Isolated identifier `com.tagbasedassetmanager.ipcprobe20261006`; disposable copy `/private/tmp/native-ipc-evidence/library`. Instrumented Vite server uses existing source unchanged. Three direct native debug launches; actual WKWebView boots with Tauri internals. Each session renders 9 rows, scans through real Rust IPC with Channel progress, validates intentional missing reference, and rejects out-of-snapshot action. 21 IPC fetches return HTTP 200. Zero warning/error/CSP/fetch-failure events.

Observation gate for original bug NOT passed: original warning reproduced 0/3. No application fix or red regression test warranted.

## Components
- Tauri framework `scripts/ipc-protocol.js`: fetch transport, warning on rejected fetch/body/callback processing, then postMessage retry.
- Tauri framework `scripts/core.js`: callback Map scoped to page; warning on missing callback ID.
- React StrictMode `src/main.tsx`: double mount; load invoked twice, cancelled mount ignores result.
- `src/native.ts`: Channel setup for scan; actual native command bridge.
- `src/useLibrary.ts`: mounted/generation/scanId checks discard obsolete UI work.
- Rust scan off-thread and Channel progress; cannot assume frontend page survives async task.

## Ranked hypotheses
1. Lifecycle teardown/reload while IPC pending. MEDIUM. Evidence: prior warnings before exit; framework warning explicitly references reload; fresh sessions clean 3/3. Test: reload during postMessage async scan and compare sessions/timestamps. Original applicability remains unproven.
2. Dev runtime transport temporarily rejects custom protocol. MEDIUM. Evidence: warning is framework catch on fetch failure, fallback supported by runtime; clean current fetches disprove persistent CSP blockage. Test: controlled one-shot rejected fetch, require fallback command and later Channel operations to resolve. Synthetic evidence not original root cause.
3. Application live-session callback lifecycle defect. LOW. Evidence: scan async/StrictMode involve callbacks, but 3 clean sessions and progress/commands succeed. Test: repeated UI Rescan/Validate plus command/Channel checks without navigation, compare warning counts and rendered state.
4. Persistent CSP/security denial. LOW. Evidence: CSP allows ipc:, 21 real fetches succeed, no policy violations. Test: capture securitypolicyviolation and native requests under unchanged CSP. Persistent denial refuted for baseline host; no security relaxation.

## Controlled experiments and findings
- Live native UI: six Rescan clicks and two Validate metadata clicks resolve through actual Rust IPC. WKWebView displays `1 validation issue` and `9 checked`; screenshot inspected. Initial driver incorrectly expected collapsed issue detail in body text; corrected to visible summary, rerun passes. No application defect.
- Forced one-shot fetch rejection: diagnostic `TypeError('Controlled diagnostic fetch failure')` produces exact framework fallback warning. `library_state` then resolves via postMessage; real `scan_library` Channel progress, validation, and rejected invalid action still resolve. This is synthetic transport evidence, NOT original warning reproduction.
- Forced nonexistent callback ID 4294967294 produces exact stale-callback wording. Diagnostic control only; NOT application failure.
- Real pending async scan across reload: add 6,000 disposable files to copied library, force transport fallback, reload on first actual Channel progress (visited 128). Three runs produce genuine stale callbacks in newly booted page (45, 3, 3 warnings); each new page subsequently renders 6,010 rows. Old-page callback IDs do not exist in new-page callback Map. This confirms lifecycle provenance for controlled reload scenario, NOT original launch/exit chronology.
- Persistent CSP denial refuted on tested host: baseline 21 HTTP 200 IPC fetches, no securitypolicyviolation events. No security/config relaxation.
- No live-session callback defect found. Original launch warning remains unreproduced; original exit-time cause cannot be asserted without original timing/exception evidence.

## Verification and limits
- 146 frontend tests pass; TypeScript/production Vite build passes.
- 64 Rust tests pass; formatting check and all-target Clippy with warnings denied pass.
- Temporary 6,000-file workload removed. SHA-256 maps prove original repository fixture and copied fixture unchanged, seven files each including manifests.
- Separate app-data was seeded for diagnostics, bypassing native folder-picker approval UX. Library-state/scan/progress/validation/out-of-snapshot action rejection tested in actual native WKWebView. UI Rescan/Validate tested; screenshot inspected.
- Accessibility permission false. Picker selection, open/reveal, clipboard, repair/export confirmation UI and signed/release WKWebView acceptance remain unverified. Windows/Intel/OneDrive manual acceptance remains unverified.
- No source/config changes, fixes, commits, or pushes. Debug pipeline cannot pass original-bug reproduction/red-regression/fix gates; investigation is evidence-bounded rather than claimed fixed.

## Evidence files
`/tmp/native-ipc-evidence/events.jsonl`, `baseline-summary.json`, `reload-summary.json`, `native-controls.png`, baseline/app/build/test logs, `before-hashes.json`, `after-hashes.json`. Diagnostics only; no source symbols changed.
