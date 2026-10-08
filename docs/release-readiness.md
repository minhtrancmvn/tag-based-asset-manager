# Release readiness

Snapshot: **2026-10-08**, application version **0.1.0**, source baseline [`95a287a`](https://github.com/minhtrancmvn/tag-based-asset-manager/commit/95a287aad19c89cf82a4eee91e61aaa1f7b3ca5a). This checklist records acceptance evidence; it is not release approval.

**Public distribution: NO-GO.** Functional/build checks have passed within the boundaries below. Signed distribution, deferred platform testing and remaining reliability/data-safety checks are not complete. No release has been published. macOS notarization is deferred until an Apple Developer account is available; Windows manual testing is deferred by the user. Deferral does not mean passed.

For chronological evidence, see [progress log](progress-log.md). For reproducible native cases, see [manual test plan](manual-test-plan.md). Browser/component tests do not establish desktop filesystem, picker or platform behavior.

## Verified checks

| Area | Evidence | Acceptance boundary |
|---|---|---|
| macOS automated regression | Post-merge frontend **211 tests / 15 files**, Rust **88 passed / 1 ignored**, TypeScript/Vite build, fmt, strict Clippy and actionlint passed | Apple Silicon host. Ignored test is existing large-catalog benchmark. |
| Windows CI | [Main run 37763555390](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/37763555390) passed on exact `95a287a`; tests, build, fmt, strict Clippy and unsigned NSIS build succeeded | Build/test acceptance, not installer execution or interactive WebView2/picker/Recycle Bin acceptance. |
| Windows fixture regression | [Branch run 37758578777](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/37758578777) at `d89f951`: frontend **211**, Rust **76 passed / 1 ignored**, unsigned installer built | Diagnostic RED proved Windows verbatim-path joining removed `..` from test input. Raw `OsString` fixture construction restored intended traversal test; production export unchanged. Unix-only tests explain lower Windows count. |
| Windows artifact integrity | Branch-run installer downloaded; PE header valid; SHA-256 matches runner | Installer not executed. Checksum below belongs to branch run, not main-run artifact. |
| Apple Silicon packaging | Isolated unsigned `.app` and DMG built; DMG checksum valid; read-only package copy matched built app; disposable installed copy launched | Local packaging/launch only. No signing, notarization or downloaded/quarantined install acceptance. Duplicate install copy/DMG later pruned; retained results/logs record checks. |
| Intel macOS cross-build | Unsigned isolated `.app` built; `lipo` confirms `x86_64`; source/config/lock hashes unchanged | No Intel hardware runtime test. Existing x86_64 translation check on host failed; Rosetta not installed. |
| Native startup/background | Empty-library startup and short Hide/minimize recovery **3/3**; populated Coral catalog startup **5/5**; recovery after **120 seconds app-hidden**, six populated screenshots inspected | Small synthetic library on Apple Silicon. No claim of long-duration soak or fix for historical blank startup. Separate Rescan check proved new persisted timestamp; original catalog-ready predicate did not prove every scan commit. |
| Inspector deletion scope | Component regression plus user-confirmed native label/dialog checks: **Delete this item** targets displayed item; **Delete selected** targets selection; dialogs canceled | No broadening of destructive scope. Native label acceptance is manual report, not successful automated row-click test. |
| Normal folder/bulk Trash recovery | User-confirmed operations/final Rescan screenshot; six original asset/sidecar hashes restored, tags/UUIDs preserved, Needs attention 0 | Folder restored manually. Bulk files restored with create-only filesystem recovery from exact Trash paths, not Finder Put Back. No forced OS partial failure. |
| Manual sleep/wake | User reports supplied preview/query/selection/Rescan checks passed; screenshots show quoted search one selected row and final four tagged rows/Needs attention 0; six hashes unchanged | OS sleep chronology and preview retention not independently established. Distinct from automated 120-second Hide test. |
| Local OneDrive library | User reports scan/tag/nested/Rescan/restart/sync-status pass. Three ordinary file hashes unchanged; nested sidecar byte-identical; root changes only `status:checked` on `Sync sample.txt` plus timestamp; UUIDs/notes/unknown fields preserved | Explicit disposable synced directory only. Cloud sync status user-reported; no second-device/cross-OS proof. |
| Dependency advisory checks | pnpm audit: **0 reported advisories**. cargo-audit 0.22.2: **0 vulnerability entries**, **2 informational warnings** | Not complete security sign-off. Rust advisory database revision `b8a1a33e246a0a9a3b5f377248c41a503defec74`, updated 2026-10-07. |

Windows branch-run unsigned installer: `Tag-Based Asset Manager_0.1.0_x64-setup.exe`, **2,708,064 bytes**. Verified SHA-256:

```text
6af1774686219524f0a19214de072a0775153b43f29ed0eab3358ee0e4d5d77c
```

Rust warnings are retained, not suppressed: `proc-macro-error 1.0.4` unmaintained (`RUSTSEC-2024-0370`), and `glib 0.18.5` unsound iterator implementation (`RUSTSEC-2024-0429`). They belong to GTK dependency paths gated to Linux/BSD and are absent from resolved macOS arm64 and Intel graphs. Windows target advisory graph was not separately resolved. Linux distribution would require coordinated upstream GTK/Tauri dependency reassessment; do not force an incompatible GLib major override.

## Remaining gates

- [ ] **Signed macOS distribution:** Developer ID signing, sealed resources, notarization, stapling and Gatekeeper/quarantine install acceptance. Current isolated `--no-sign` app fails strict codesign and Gatekeeper assessment with missing sealed resources. Deferred until Developer account available; never bypass host policy to claim a pass.
- [ ] **Windows native acceptance:** Install/uninstall unsigned test package in a disposable Windows environment; verify WebView2, picker authorization/cancellation, metadata persistence, export collision preservation, preview and Recycle Bin/restore. Deferred by user. CI installer build does not close [M5-17](manual-test-plan.md#native-actions-validation-and-recovery-acceptance).
- [ ] **Intel hardware acceptance:** Launch isolated app on supported Intel Mac and run native matrix. Cross-build is not runtime acceptance.
- [ ] **OneDrive cross-device/cross-OS sync:** Independently verify files/sidecars arrive on second device and retain tags/UUIDs after edits/restart. Existing approved cloud path does not authorize new locations or real-library mutations.
- [ ] **OneDrive edge cases:** Locally available versus online-only/placeholder entries, hydration policy, conflict-copy reporting and concurrent sync/edit failures. No automatic conflict merge/delete. See [PLATFORM-04 through PLATFORM-06](manual-test-plan.md#spaces-unicode-and-onedrive).
- [ ] **Native partial Trash failure:** OS-level later-target failure and recovery without silent rollback/permanent-delete fallback. Injected domain and React tests pass, but native failure/restoration case remains open. See [TRASH-04](manual-test-plan.md#catalog-controls-trash-and-preview-acceptance).
- [ ] **Historical blank-window reliability:** Earlier native blank screenshots remain unexplained. Recent startup/background/manual sleep checks are positive bounded evidence, not root-cause resolution. Preserve failure evidence if symptom recurs.
- [ ] **Release sign-off:** Decide supported platforms and unresolved-risk disposition, verify exact signed/release artifacts and approve publication. No authorization inferred from successful tests or Git pushes.

Manual export collision refusal was previously reported; independent before/after checksum of that exact human-selected existing destination remains unverified. Automated create-only collision/race tests are separate evidence.

## Safe release and recovery rules

1. Use disposable libraries and isolated app-data for remaining checks. No credentials, private files or screenshots in synced fixtures.
2. Do not delete malformed/stale metadata or merge conflict copies automatically. Preserve original sidecar bytes and report errors.
3. Stop testing and block distribution on unexpected asset modification, overwrite, unauthorized path access, lost metadata identity, permanent-delete fallback or reproducible unusable window.
4. A code rollback does not reverse committed tag edits or Trash moves. Preserve sidecar backups, restore assets through system file manager and Rescan; backup import is not implemented.
5. Keep exact previous executable, settings backup and metadata backup before installing a release candidate. Downgrade compatibility and timed installer rollback have not been rehearsed; do not claim rollback readiness.
6. Do not publish CI test installers as signed releases. CI artifacts expire after 14 days; local evidence is not a public download channel.

## Evidence locations

Durable local evidence lives outside Git at `/Users/coffeemug/Programming/tag-based-asset-manager-release-evidence/`:

- `release-20261008-58bwlu7l/`: native startup/manual Trash hashes and local package results; active rebuilt app retained. Original app and synthetic library removed after acceptance. `prune-result.json` and final cleanup manifest record removals; do not assume every historical artifact still exists.
- `recovery-20261008-2mxziv4d/`: populated startup/120-second Hide screenshots/results, separate Rescan, manual sleep result, advisory and bundle-security reports.
- `intel-build-20261008-mennxj_s/`: build logs and architecture/source-baseline result; test app removed after verification.
- `windows-readiness-20261008-vq3zrj1z/`: workflow validation, Windows RED/GREEN/test logs, checksum verification and main-run observation. Downloaded test installer/validator removed; retained CI artifacts expire after 14 days.
- `onedrive-20261008-_swdwhww/`: synthetic library baselines, exact local tag-delta verification and `final-cleanup-manifest.json`/`final-cleanup-result.json`. User requested test-data cleanup: all five known test files and nested directory removed; approved `/Users/coffeemug/Library/CloudStorage/OneDrive-Personal/test-tag-sync` left empty. Cloud deletion delivery not independently verified. Further sync tests require new disposable setup.

Final cleanup removed94 task-owned files/30,838,118bytes, retaining final screenshots/results/logs and hash-verifying retained evidence. All11 recoverable agent backup files remain separately at `/Users/coffeemug/Programming/tag-based-asset-manager-worktree-backups/`. Active rebuilt test app and its app-data were preserved because user added a non-test registration; associated real-library contents were not inspected or changed. Remaining test registrations may point to removed synthetic folders; unregister them explicitly if continuing to use that app. Neither archive retention nor this checklist implies full release readiness.
