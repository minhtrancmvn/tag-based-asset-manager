# Release build ledger

Tracks built artifacts, not release approval. Filename `REALEASE.md` is retained as requested. Add newest build first; preserve prior entries and tie every checksum to one exact build/source commit. Do not reuse a checksum for a rebuilt artifact, another platform or a signed package.

For open release gates, see [release readiness](docs/release-readiness.md). Unsigned test/build artifacts are not signed distribution releases. An authorized [GitHub draft prerelease v0.1.0](https://github.com/minhtrancmvn/tag-based-asset-manager/releases/tag/untagged-6499c74c18cbb4833e7b) holds these assets; it remains unpublished and is not a public distribution release.

## GitHub release storage

- Keep binaries out of Git history; generated `src-tauri/target/` stays ignored.
- Attach packages and `SHA256SUMS.txt` to versioned GitHub Releases; preserve exact source target and immutable build hashes in this ledger.
- Current draft/prerelease `v0.1.0` targets build source `09fc921e4e11a7ab5a8a586e45720f856e1a1f1c`; GitHub may defer creating Git tag until draft publication. No existing tag was moved or overwritten.
- GitHub download names use hyphens rather than spaces: `Tag-Based-Asset-Manager_0.1.0_aarch64.dmg`, `Tag-Based-Asset-Manager_0.1.0_arm64.app.zip`, `Tag-Based-Asset-Manager_0.1.0_x64-setup.exe`. Uploaded checksum manifest uses those exact names; local manifest uses local names. Package bytes/hashes are identical.
- All four remote assets are uploaded and server SHA-256 digests match local files. Publishing requires separate explicit approval; unsigned/deferred acceptance limits remain in draft notes.

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
| Signing/publication | Unsigned NSIS installer; attached to unpublished GitHub draft/prerelease v0.1.0 |
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
| Distribution status | Unsigned build attached to authorized GitHub draft. Public distribution remains NO-GO; no draft publication approved. |
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
