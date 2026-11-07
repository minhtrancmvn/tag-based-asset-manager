# In-App Updates and Preview Feed Architecture

## Overview

Source implementation adds signed in-app updates for preview releases using the Tauri v2 updater plugin (`tauri-plugin-updater` v2.14.1). Checks run automatically once per launch; downloads and installation require explicit confirmation. Repository signing entries and public-key format/local match were checked. Public-key-enabled locked/offline native tests, formatting, strict Clippy and a macOS Apple Silicon `.app` build passed on 2026-10-30; read-only bundle inspection confirmed version, identifier, architecture and embedded public key. The owner-signed local macOS archive passed payload and version-binding verification against the repository public key, including tamper-rejection checks. The GitHub signing credential check passed on Linux in run 41043606325, verifying the uploaded private-key/passphrase pair against the configured public key. Release automation/feed publication and packaged upgrades remain unverified; as of 2026-10-30, the canonical preview feed returned HTTP 404 and latest published v0.4.0 release contained no updater archives/signatures or newer version to install.

The update pipeline uses a static feed hosted on the repository's `update-preview` branch:
```
https://raw.githubusercontent.com/minhtrancmvn/tag-based-asset-manager/update-preview/latest.json
```

Updates target the two supported platforms:
- `darwin-aarch64` (macOS Apple Silicon)
- `windows-x86_64` (Windows x64)

Stable/latest GitHub release endpoints are deliberately not used for updater discovery; preview releases publish directly to the preview manifest on `update-preview`.

---

## Security and Signing Contract

### 1. Compile-Time Key Injection

The Rust backend compiles with:
```rust
option_env!("TAURI_UPDATER_PUBLIC_KEY")
```
- When `TAURI_UPDATER_PUBLIC_KEY` is omitted or empty at compile time, updater check and install capabilities are completely disabled in native code.
- When `TAURI_UPDATER_PUBLIC_KEY` is provided during `pnpm tauri build`, the updater plugin initializes with that embedded public key.
- Source-tree equality is strictly preserved: passing `TAURI_UPDATER_PUBLIC_KEY` via environment variables avoids editing tracked files on disk, ensuring `git write-tree` matches across build runners.
- The build script (`src-tauri/build.rs`) emits `cargo:rerun-if-env-changed=TAURI_UPDATER_PUBLIC_KEY` so cargo invalidates native build artifacts when the key changes.

### 2. Version-Bound Signatures (`requireSignedVersion: true`)

The native updater plugin (`tauri-plugin-updater` v2.14.1) is configured with `requireSignedVersion: true`. Minisign signatures bind to the exact application version via tab-separated fields in the trusted comment header (`updater.rs:1963-1967`):
```
trusted comment: timestamp:<ts>	file:<filename>	version:<canonical-version>
```
The pinned Tauri CLI supports `--app-version` on `pnpm tauri signer sign`:
```bash
pnpm tauri signer sign --app-version "$VERSION" "$artifact"
```
The CLI automatically consumes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from the environment, avoiding exposing secrets on the process command line.

Any signature without `version:<version>` or with a mismatched version is rejected by `scripts/update-feed.mjs` and native client verification, preventing tampered manifests from rolling back or replaying older builds. Versions must be canonical SemVer (`X.Y.Z` without leading zeros).

### 3. Outer Base64 Signature Encoding & Cryptographic Verification

In `tauri-plugin-updater` 2.14.1, `verify_signature` (`updater.rs:1893-1975`) executes `base64_to_string(release_signature)` before decoding the Minisign signature. Therefore, `platforms[platform].signature` in `latest.json` is encoded as standard base64 of the 4-line UTF-8 minisign signature text, generated automatically by `scripts/update-feed.mjs`.

Before release publication, `scripts/update-feed.mjs` cryptographically verifies final artifact bytes and the Minisign global trusted-comment signature against `TAURI_UPDATER_PUBLIC_KEY` using Node.js `crypto` (Ed25519 SPKI DER + BLAKE2b-512 prehash). If artifact bytes, signature, key ID, or version bindings are altered or mismatched, release publication aborts immediately.

### 4. Protected Secrets and Key Setup

Key management rules:
- **Never fabricate keys**: Never commit keys, paste private keys into chat, or place mock keys in repositories. Public fixture keys in test suites are nonsecret reference vectors from `tauri-plugin-updater` offline tests and do not grant signing capabilities.
- **Offline Interactive Key Generation**: The repository owner generates the updater keypair once on a secure offline machine using the pinned Tauri CLI, running interactively without password arguments to prevent plaintext passwords in shell history:
  ```bash
  pnpm tauri signer generate -w ~/.tauri/tag-based-asset-manager.key
  ```
  The interactive command prompts securely for a passphrase and outputs:
  - Public key file (`.pub`): Contains the canonical outer base64 encoding of the two-line Minisign public key text (`untrusted comment: minisign public key ...\n<base64>`).
  - Private key file containing the password-encrypted secret key.
- **Canonical Public Key Format**: Native preflight validates outer base64 and the exact second-line key length. The plugin's `verify_signature` executes `base64_to_string(pub_key)` then `PublicKey::decode`. Therefore, `TAURI_UPDATER_PUBLIC_KEY` must strictly be the standard outer base64-encoded string of the two-line Minisign text. Plaintext minisign text or noncanonical base64 is rejected by `scripts/update-feed.mjs` and native client validation.
- **Repository Configuration**:
  - `vars.TAURI_UPDATER_PUBLIC_KEY`: Repository variable containing the standard outer base64 string of the public key. **Setting this variable activates updater artifact production, native verification, and feed publishing in CI.**
  - `secrets.TAURI_SIGNING_PRIVATE_KEY`: Repository secret containing the full text of the private key file.
  - `secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Repository secret containing the decryption passphrase.
  - Secrets are scoped strictly to the signing steps (`Collect macOS packages` and `Collect Windows installer`) and never exposed globally to build dependencies.

### Owner Activation Sequence

Initial preflight on 2026-10-30 found no local keypair or repository signing entries. After owner setup, a names-only recheck confirmed all three repository entries; the configured public key validates and matches the local public file. The owner then signed the local version-`0.4.0` macOS archive in their interactive terminal. Verification against the repository public key accepted the unchanged payload and exact signed version, including the feed's outer-base64 signature representation; changed payload bytes, changed signature bytes, an advertised version mismatch and a modified authenticated version were rejected. Secret values and private-key contents were not read. This proves the local signature matches the configured public key, not the correctness of GitHub's stored private key/passphrase, secure backup, live CI or packaged upgrades. Installed lockfile-resolved Tauri CLI is `2.12.1`; its help exposes `--app-version`. No update feed was published and no app was launched or installed during setup verification.

1. On a trusted offline machine with the project dependencies already installed, generate the keypair interactively. Use a strong, nonempty passphrase; save it in a password manager. Do not run this through chat or a captured automation terminal. The subshell limits permissions for new files; removing `CI` preserves the passphrase prompt. Do not use `--force` or overwrite an existing keypair.

   ```bash
   (umask 077; env -u CI pnpm tauri signer generate -w "$HOME/.tauri/tag-based-asset-manager.key")
   ```

2. Back up the encrypted private key, public key and passphrase securely before activating updates. Loss of the key or passphrase prevents signing updates accepted by already-installed clients. Never paste private material into chat or commit it.

3. In an interactive terminal after reconnecting, upload the encrypted private-key file through standard input, then enter its passphrase directly into GitHub CLI's secret prompt. Do not use `--body`, command-line password arguments or shell tracing for secret values. Run from a trusted machine and verify the repository name before uploading.

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY --repo minhtrancmvn/tag-based-asset-manager < "$HOME/.tauri/tag-based-asset-manager.key"
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo minhtrancmvn/tag-based-asset-manager
   ```

4. Set the public-key variable last, after both secrets exist and the intended release workflow has been reviewed. This variable enables signing-required builds and feed publication in the updater workflow; these commands do not themselves create a release.

   ```bash
   gh variable set TAURI_UPDATER_PUBLIC_KEY --repo minhtrancmvn/tag-based-asset-manager < "$HOME/.tauri/tag-based-asset-manager.key.pub"
   ```

5. Verify configuration by listing names only, then perform a controlled signed-artifact check and isolated packaged-upgrade tests before publishing a feed for users. Secret-name presence does not prove the passphrase or keypair matches. macOS and Windows acceptance remain separate; use disposable app-data and fixture copies, not existing user libraries/settings.

### Non-Publishing CI Signing Check

The standalone `.github/workflows/updater-signing-check.yml` was committed with its test to `ci/updater-signing-check` as `ba781da76507ae42aa74d1a18034dd9420daa124` after explicit owner approval. [GitHub run 41043606325](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/41043606325) passed on 2026-10-30. Downloaded nonsecret evidence matches the exact commit and configured public-key fingerprint; signing, version binding and all negative controls passed. This verifies the uploaded signing key/passphrase pair on Linux, not app packaging or upgrades. Existing remote `Windows checks` does not sign, and invoking `Release` is not a safe credential-only test because it publishes releases.

The standalone check runs only on a push to `ci/updater-signing-check` in this repository. It needs no default-branch workflow registration, checks out no repository code, grants no repository token permissions and does not build or install the app. It downloads only the Tauri `2.12.1` Linux native CLI package, checks the exact SHA-512 integrity recorded in the lockfile, and signs inert run-specific text bound to version `0.0.0`. Signing secrets exist only in the signing step. Signer stdout/stderr are captured without printing, including on failure. Public-key verification checks payload integrity, authenticated version and tamper rejection. Only a nonsecret `verification.json` report is uploaded, with seven-day retention; no release package or feed is published.

Local policy and cryptographic tests live in `scripts/updater-signing-check.test.mjs`. On 2026-10-30, all 72 release/workflow script tests and actionlint across all three workflows passed; read-only configuration-safety review found no confirmed defects. The inline verifier also accepted the owner's existing signed macOS archive and rejected tampering. Local validation alone did not prove GitHub secret correctness; the subsequently successful GitHub run and downloaded report now verify that gate. Only the workflow and test were pushed; unrelated updater changes remain local and `main` was not changed. As of 2026-10-30, the fixed preview feed returned HTTP 404 and latest v0.4.0 release has no updater archives/signatures or newer version; packaged upgrade acceptance is blocked pending a valid newer signed candidate. The successful CI report verifies signing credentials only, not Windows packaging or actual macOS/Windows upgrades.

---

## Artifact Pipeline & Release Sequencing

### 1. Artifact Sequence

When `vars.TAURI_UPDATER_PUBLIC_KEY` is present, the build matrix produces and signs updater bundles:

| Platform | Manual Package | Updater Artifact | Signature Artifact |
|----------|----------------|------------------|---------------------|
| macOS Apple Silicon | `Tag-Based-Asset-Manager_${VERSION}_arm64.app.zip`<br>`Tag-Based-Asset-Manager_${VERSION}_aarch64.dmg` | `Tag-Based-Asset-Manager_${VERSION}_aarch64.app.tar.gz` | `Tag-Based-Asset-Manager_${VERSION}_aarch64.app.tar.gz.sig` |
| Windows x64 | `Tag-Based-Asset-Manager_${VERSION}_x64-setup.exe` | *(Same existing NSIS exe)* | `Tag-Based-Asset-Manager_${VERSION}_x64-setup.exe.sig` |

- macOS updater archive: `tar -czf "$tar_gz" -C "$bundle/macos" "$(basename "$app")"`, signed with `--app-version "$VERSION"`.
- Windows updater archive: The standard NSIS installer is signed directly with `--app-version "$VERSION"`.
- Checksums: `(cd release && sha256sum -- * > SHA256SUMS.txt)` checksums the final bytes of all 6 release files.
- Unsigned Manual Fallback: If `vars.TAURI_UPDATER_PUBLIC_KEY` is absent, the release job produces exactly the 3 original packages (`.app.zip`, `.dmg`, `.exe`), with no updater artifacts and no feed publication.

### 2. Publication Order

Release publication is strictly ordered and serialized (`release-main` concurrency group):
1. **Pre-Publication Cryptographic Verification**:
   Before creating any GitHub release, `node scripts/update-feed.mjs verify` validates the exact updater packages (`Tag-Based-Asset-Manager_${VERSION}_aarch64.app.tar.gz` and `Tag-Based-Asset-Manager_${VERSION}_x64-setup.exe`) and their corresponding `.sig` files against `TAURI_UPDATER_PUBLIC_KEY`. This verifies payload integrity, version matching (`version:<canonical-version>`), and global trusted-comment cryptographic signature. Manual standalone archives (`.app.zip`, `.dmg`) are distributed for direct manual installation and are not updater artifacts. If the private signing key did not match the configured public key or any updater payload was corrupted, the release job terminates immediately before creating the release.
2. **GitHub Release Publication**:
   All packages (`.app.zip`, `.dmg`, `.app.tar.gz`, `.app.tar.gz.sig`, `.exe`, `.exe.sig`, `SHA256SUMS.txt`) are uploaded via `gh release create` with `--generate-notes`. Assets become accessible at canonical HTTPS URLs:
   `https://github.com/<owner>/<repo>/releases/download/v<version>/<asset-filename>`
3. **Feed Manifest Generation**:
   `gh release view "v$VERSION" --json body -q .body` extracts the exact published release notes. `scripts/update-feed.mjs generate` writes `latest.json` containing the real notes and outer base64 signatures.
4. **Feed Branch Fast-Forward Push (`update-preview`)**:
   `latest.json` is committed to `update-preview` and pushed fast-forward to GitHub:
   ```bash
   git -C "$feed_dir" commit -m "chore(update): publish v$VERSION manifest"
   git -C "$feed_dir" push origin update-preview
   ```

### 3. OS Platform Warnings vs Updater Cryptographic Signing

OS-level code signing warnings remain distinct from updater cryptographic signing:
- **macOS Apple Silicon**: Binaries remain unsigned with Apple Developer ID and unnotarized (Gatekeeper controls apply).
- **Windows x64**: The Windows installer remains unsigned. The SignPath free open-source signing application was rejected on 2026-10-30; the application is not awaiting approval. Windows SmartScreen warnings apply as expected for unsigned open-source binaries.
- **Updater Signing Key Isolation**: Updater signing keys (Minisign keypair) verify update authenticity within the Tauri runtime and are completely separate from OS-level code signing certificates (Apple Developer ID / Authenticode).
- **Release Notes Policy**: Release notes explicitly preserve platform warning notices and link to the repository Code Signing Policy.

---

## Native & UI Contract

- **Once-Per-Launch Background Check**: If compiled with `TAURI_UPDATER_PUBLIC_KEY`, the client performs a background query against `update-preview/latest.json` once on startup (and on explicit user request via **Check for updates** in the top bar). If no public key was compiled in, updater functionality is completely disabled and no network requests are made.
- **Explicit User Confirmation**: In-app updates are strictly opt-in. The application never downloads update binaries in the background. Choosing "Later" or dismissing the modal dismisses the notice with zero network download.
- **Literal Release Notes**: Release notes from `latest.json` are rendered as literal text without HTML/SVG execution or external resource fetches.
- **Safety Locks & Operation Blocking**: The update install action is disabled and blocked whenever:
  - A directory scan is active (including during scan cancellation wind-down)
  - A metadata sidecar write or bulk edit is in progress
  - The user has an uncommitted metadata draft in the inspector
  - Any confirmation or edit modal dialog is open
- **Shell Inactivity & Retry Recovery**: When an install is confirmed, the app shell becomes inert during download and signature verification. If the download fails or network disconnects, the shell unlocks, reports the error, and re-enables retry without crashing.
- **Network Metadata Disclosure & Zero Telemetry**: Checking the update feed discloses standard HTTP transport metadata (client IP address and user-agent string) to the GitHub raw content endpoint (`raw.githubusercontent.com`). No telemetry, analytics, hardware identifiers, or library data are collected or transmitted.
- **Unsupported Host vs Missing Platform**:
  - *Unsupported Host*: On unsupported operating systems or builds without `TAURI_UPDATER_PUBLIC_KEY`, updater capabilities are disabled at compile-time/runtime; no background checks occur.
  - *Missing Platform in Feed*: If `latest.json` announces a newer version but omits the running target platform in `platforms`, `tauri-plugin-updater` returns `Err(Error::TargetNotFound)` (`updater.rs:127, 720`). When the feed version is equal to or older than the installed version, the plugin returns `Ok(None)` without inspecting target platforms.
- **Zero Metadata Migration**: Updates perform no automated changes to asset sidecars (`.asset-tags.json`), directory structures, or app-data settings.

---

## Store / MSIX Future Route Note

For future Windows distribution through the Microsoft Store:
- **MSIX Signing Model**: The Store re-signing route requires MSIX/AppX packaging. Microsoft re-signs that package with a Microsoft digital certificate after certification approval. The Store also accepts qualifying Win32 `.exe` or `.msi` submissions, but does not re-sign those installers.
- **Tauri Tooling**: Tauri currently lacks an integrated native MSIX bundler (standard desktop targets produce NSIS `.exe` or WiX `.msi`).
- **Updater Compatibility**: A Microsoft Store build must bypass the GitHub/NSIS in-app self-updater entirely; updates for Store apps are delivered exclusively via the Microsoft Store client. Implemented: builds compiled with `TAG_ASSET_MANAGER_STORE_BUILD=1` refuse both check and install before any network request; see [Microsoft Store edition](microsoft-store.md).
- **Packaging Constraints**: Store MSIX packages require explicit verification of package-identity behavior, app-data virtualized storage boundaries, and native folder picker permissions.
- **References**:
  - Microsoft Store MSIX Package Requirements: https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements
  - Tauri Microsoft Store Distribution Guide: https://v2.tauri.app/distribute/microsoft-store/

---

## Feed Schema (`latest.json`)

The generated static feed strictly conforms to Tauri v2 specifications, with outer base64-encoded signatures:

```json
{
  "version": "0.4.0",
  "notes": "Automated unsigned preview release.",
  "pub_date": "2026-10-30T15:00:00.000Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK...",
      "url": "https://github.com/minhtrancmvn/tag-based-asset-manager/releases/download/v0.4.0/Tag-Based-Asset-Manager_0.4.0_aarch64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK...",
      "url": "https://github.com/minhtrancmvn/tag-based-asset-manager/releases/download/v0.4.0/Tag-Based-Asset-Manager_0.4.0_x64-setup.exe"
    }
  }
}
```

---

## Bootstrap & Manual Verification Checklist

1. **Bootstrap Release**:
   - The first updater-capable version must be installed manually by downloading the `.dmg` or `.exe` installer built with `vars.TAURI_UPDATER_PUBLIC_KEY`.
   - Existing installations prior to this release do not contain the embedded public key and will not check the feed.
2. **Packaged Acceptance Gate**:
   - **Packaged in-place upgrade is NOT yet verified on either OS**. Testing must gate preservation of app-data settings, saved searches, library authorizations, and row metadata across actual binary replacement.
3. **Negative Acceptance Test Scenarios**:
   - **Offline / Network Outage**: Network disconnected or raw GitHub endpoint unreachable; update check fails gracefully without crashing or interrupting ongoing browsing.
   - **No Update Available**: Feed version equals or is older than the installed version; check reports app is up-to-date; no modal prompt appears.
   - **Unsupported Platform / Architecture**: Feed manifest omits the platform target for the current host while announcing an update; native check returns `Error::TargetNotFound` and exits cleanly without attempting download.
   - **Stale Update Offer**: Feed points to an older build; ignored.
   - **Invalid Minisign Signature**: Signature bytes or key ID modified; client signature check fails; payload is discarded immediately without executing or installing.
   - **Signed-Version Mismatch**: Announced feed version differs from the version in the signature trusted comment (`version:<canonical-version>`); client rejects the manifest as a tampering attempt under `requireSignedVersion: true`.
