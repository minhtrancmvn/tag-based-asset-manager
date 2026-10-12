# Release build ledger

Tracks built artifacts, not release approval. Filename `REALEASE.md` is retained as requested. Add newest build first; preserve prior entries and tie every checksum to one exact build/source commit. Do not reuse a checksum for a rebuilt artifact, another platform or a signed package.

For open release gates, see [release readiness](docs/release-readiness.md). User-approved [GitHub unsigned prerelease v0.1.0](https://github.com/minhtrancmvn/tag-based-asset-manager/releases/tag/v0.1.0) was published on **2026-10-08 at 15:27:50 UTC**. These are public preview downloads, not a stable or signed distribution release; remaining runtime/signing gates are not waived.

## GitHub release storage

- Keep binaries out of Git history; generated `src-tauri/target/` stays ignored.
- Attach packages and `SHA256SUMS.txt` to versioned GitHub Releases; preserve exact source target and immutable build hashes in this ledger.
- Published prerelease `v0.1.0` targets build source `09fc921e4e11a7ab5a8a586e45720f856e1a1f1c`. Publication created the lightweight Git tag at that exact commit; no existing tag was moved or overwritten. Release remains a prerelease and publication explicitly used `make_latest: false`.
- GitHub download names use hyphens rather than spaces: `Tag-Based-Asset-Manager_0.1.0_aarch64.dmg`, `Tag-Based-Asset-Manager_0.1.0_arm64.app.zip`, `Tag-Based-Asset-Manager_0.1.0_x64-setup.exe`. Uploaded checksum manifest uses those exact names; local manifest uses local names. Package bytes/hashes are identical.
- All four remote asset IDs, names, sizes and SHA-256 digests were unchanged by publication; package/server digests match preserved local files. Release notes retain unsigned/deferred acceptance warnings. Stable release approval remains separate.
- Publication evidence: `release-build-6jm1apzo/publication-before.json`, `publication-request.json`, `publication-after.json`, `publication-tag.json` and `published-release-notes.md` under the local evidence root. Later isolated native checks are documented in [release readiness](docs/release-readiness.md); they do not change these package hashes or establish production-installer acceptance.

## Build 2026-10-12 — 0.2.0 — unsigned prerelease candidate

| Field | Value |
|---|---|
| Source | [`f63186fd9db9502266c98320905dd71645c5bd20`](https://github.com/minhtrancmvn/tag-based-asset-manager/commit/f63186fd9db9502266c98320905dd71645c5bd20), squash-merged [PR #4](https://github.com/minhtrancmvn/tag-based-asset-manager/pull/4) |
| Source tree | `f831a822fb3c0b866a00b01526950ef1e759fe80`, identical to reviewed feature source |
| macOS build | Clean `release/build-v0.2.0` worktree; `pnpm tauri build --bundles app,dmg --no-sign --ci -- --locked` |
| Windows build | [Run 38197210176](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/38197210176), SUCCESS on exact merged commit; `pnpm tauri build --bundles nsis --no-sign --ci -- --locked` |
| Tests | Frontend **248 passed / 15 files** on both hosts; Rust **88 passed / 1 ignored** on macOS and **76 passed / 1 ignored** on Windows; type/build/fmt/strict Clippy passed |
| macOS structure | Mach-O `arm64`; bundle identifier `com.tagbasedassetmanager.desktop`; bundle/short version `0.2.0`; DMG and app ZIP integrity passed |
| Windows structure | Valid NSIS PE header; runner/preserved SHA-256 match; CI output targets x64. Bootstrapper is x86; payload not independently extracted |
| Signing/runtime | No Developer ID signing/notarization; linker ad hoc signature present. Windows unsigned. Production app and installer not executed |
| Inputs | All tracked source/config/lockfile bytes unchanged during build; packages preserved outside replaceable target output |
| Publication | [Unsigned prerelease v0.2.0](https://github.com/minhtrancmvn/tag-based-asset-manager/releases/tag/v0.2.0), published **2026-10-12 at 03:52:17 UTC**; prerelease=true, draft=false, latest disabled |
| Remote verification | Tag targets exact `f63186fd9db9502266c98320905dd71645c5bd20`; four asset names/sizes/server digests and downloaded bytes match local manifest. No stable/latest release designated; v0.1.0 tag/release/assets unchanged |

| Download name | Bytes | SHA-256 |
|---|---:|---|
| `Tag-Based-Asset-Manager_0.2.0_aarch64.dmg` | 3,360,926 | `b71040849cf910425282aad6062e9feda386688a4e5d2ba0b66fbcce2306c9c1` |
| `Tag-Based-Asset-Manager_0.2.0_arm64.app.zip` | 3,255,381 | `3c5a5edd5e4dc2b12417ab6461583e5a8618161819d428ce811691eac7ea0d68` |
| `Tag-Based-Asset-Manager_0.2.0_x64-setup.exe` | 2,713,054 | `73f7452e6fbd66fea5b733b4b3e7f22521dbec89bf8a772d3ef85ccfc7d5257e` |
| `SHA256SUMS.txt` | 328 | `f426801bb59f8bff085d83f3e20cc89e8b1f588f8840c580a473fe472725f3b3` |

Preserved evidence folder: `release-v020-20261012-kt3zo6r_/`. Contains package/input manifests, build/test logs, DMG/signature checks and both main/PR CI downloads. Final Windows package comes from merged-source run above, not PR run 38171799710. Earlier v0.1.0 and PR-CI checksums remain specific to their own bytes. No Intel macOS package produced. Declared minimum macOS `10.13` is not runtime-tested. Platform/Tab/OneDrive/reliability/signing gates remain open; 3MF/Space preview remains backlog only.

## Build 2026-10-08 — 0.1.0 — Windows x64

| Field | Value |
|---|---|
| Source | `09fc921e4e11a7ab5a8a586e45720f856e1a1f1c`, same as macOS build below |
| Build host | GitHub-hosted `windows-latest` |
| CI | [Run 37788726148](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/37788726148), SUCCESS on exact source commit |
| Command | `pnpm tauri build --bundles nsis --no-sign --ci -- --locked` |
| Artifact | `Tag-Based Asset Manager_0.1.0_x64-setup.exe`, **2,708,991 bytes** |
| SHA-256 | `db9373f1a164dba8f9e2072c012e6b1b287ae5f0182af0b3830846e80e8cd492` |
| Verification | Downloaded artifact has valid PE header; SHA-256 matches runner checksum and preserved copy |
| Tests | Frontend **211 passed**, Rust **76 passed / 1 pre-existing ignored benchmark**; type/build/fmt/strict Clippy passed |
| Signing/publication | Unsigned NSIS installer; published in user-approved GitHub prerelease v0.1.0, not stable/latest |
| Runtime | Installer not executed; Windows native install/uninstall/WebView2/picker/Recycle Bin acceptance remains deferred |

Preserved in same `release-build-6jm1apzo/artifacts/` directory as macOS artifacts, with shared `SHA256SUMS.txt`. Downloaded logs and `windows-build-result.json` remain in parent build evidence directory. Duplicate downloaded executable removed after verified copy. This checksum is specific to run37788726148, not earlier Windows CI artifacts.

## Build 2026-10-08 — 0.1.0 — macOS arm64

| Field | Value |
|---|---|
| Source | [`09fc921e4e11a7ab5a8a586e45720f856e1a1f1c`](https://github.com/minhtrancmvn/tag-based-asset-manager/commit/09fc921e4e11a7ab5a8a586e45720f856e1a1f1c), pushed to `origin/main` before build |
| Build host | macOS 27.0, Apple Silicon arm64 |
| Application version | `0.1.0`; no version bump |
| Configuration | Production `src-tauri/tauri.conf.json`; identifier `com.tagbasedassetmanager.desktop`; no acceptance overlay |
| Command | `pnpm tauri build --bundles app,dmg --no-sign --ci -- --locked` |
| Result | PASS: optimized executable, `.app`, DMG and archived `.app.zip` |
| Signing/notarization | No Developer ID signing; `--no-sign`; linker ad hoc signature may exist. Not notarized or stapled. |
| Distribution status | Published in user-approved unsigned GitHub prerelease v0.1.0. Stable/signed distribution remains NO-GO. |
| Runtime acceptance | This production-identifier build was not launched; avoids real app-data access. Earlier isolated native acceptance is separate evidence. |
| Build inputs | Package/config/Cargo/frontend lockfile hashes unchanged during build. Ledger/task-plan edits do not alter executable sources. |

### Artifacts

Preserved output directory:

```text
/Users/coffeemug/Programming/tag-based-asset-manager-release-evidence/release-build-6jm1apzo/artifacts/
```

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `Tag-Based Asset Manager_0.1.0_aarch64.dmg` | 3,357,148 | `74dd4eb245f746a93a1cc89b3d46d08c1690aafc58ee8fda6d451d1d665d4e7a` |
| `Tag-Based Asset Manager_0.1.0_arm64.app.zip` | 3,248,084 | `95744d204a8927ca7d7995451e070a062caa20843f0354f19b316fa0333c4246` |

`SHA256SUMS.txt` is stored beside artifacts. Executable SHA-256: `f9c2e34fbf23932ef197927e280c92ddea2d735e6b4cea649ea823bd425bef8d`.

Generated `.app`/DMG also remain under `src-tauri/target/release/bundle/`; those build outputs can be replaced by a later build. Preserved artifacts above are requested deliverables, not disposable test fixtures; retain until explicitly superseded or removed.

### Verification

- Frontend: **211 tests / 15 files passed**, 9.82s.
- Rust: **88 passed / 1 pre-existing ignored benchmark**, 0.78s.
- TypeScript/Vite build, `cargo fmt --check` and strict all-target Clippy passed.
- Mach-O architecture verified as `arm64`; bundle identifier/version verified.
- `hdiutil verify` passed for DMG; preserved copies/checksums recorded in `build-result.json`.
- Native build took 1m14s; warning `Skipping signing due to --no-sign flag` expected. This warning is not waived signed-distribution acceptance.
- Declared bundle minimum macOS version is `10.13`; compatibility with that version was not tested.
- Windows CI for this exact source: [run 37788726148](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/37788726148) passed tests/build/fmt/strict Clippy and unsigned NSIS packaging. Log/installer artifacts available for 14 days. Windows installer subsequently downloaded/checksummed and preserved as recorded above; not executed. Earlier Windows hashes in release checklist are not this build's artifacts.

Evidence/logs: parent `release-build-6jm1apzo/` contains source/input hashes, test/build logs, DMG verification, signing information and `build-result.json`. No new synthetic libraries or cloud data created.

## Recording future builds

1. Record version, full source commit, host/target architecture, exact build command and configuration before publishing anything.
2. Preserve artifacts outside replaceable build directories; record byte sizes and SHA-256 from actual files.
3. Record tests/build/signing/notarization/runtime results separately, including failures and skipped/unavailable checks.
4. Link exact CI run and state whether installer was executed. Do not promote build success into native acceptance.
5. Note publication destination/approval only after an explicitly authorized release is actually published.
