# SignPath signing handoff

## Status — 2026-10-30

User reported SignPath Foundation rejected the application on 2026-10-30. Rejection reason has not been supplied. No SignPath integration is planned without a new approval; Windows packages remain unsigned. Repository includes MIT licensing and a public code-signing policy, which must not claim the application is still pending. No signed Windows distribution has been verified.

## Resume only if a later application is approved

1. Read SignPath's approval and onboarding requirements. Obtain the organization, project and signing-policy identifiers; confirm allowed build provenance and signing workflow.
2. Store the API token in a protected GitHub Actions secret. Never put the token or private signing material in source, documentation, logs or chat.
3. Integrate signing into `.github/workflows/release.yml` under the approved policy. Preserve pinned actions, tested-source checks and least-privilege permissions. Do not expose signing credentials to untrusted pull requests.
4. Sign the Windows artifacts before generating their Tauri updater signatures and final `SHA256SUMS.txt`. If SignPath changes installer bytes, regenerate both from the final signed installer.
5. Verify the downloaded Windows installer's Authenticode identity and signature; test clean installation and packaged upgrade on Windows. Confirm libraries, app settings, assets and sidecars are preserved.
6. Update release notes and acceptance documentation only after signatures and actual packaged behavior are verified. Approval alone does not establish working signing or upgrades.

## Separate trust gates

- SignPath supplies Windows code signing; it does not supply macOS Developer ID signing or notarization.
- Tauri updater artifacts require a separate private signing key and matching embedded public key. Their signatures are mandatory and do not replace operating-system code signing.
- SignPath rejection does not block updater source work. Tauri update signatures remain mandatory even while Windows Authenticode is unavailable. Existing v0.4.0 installations require one manual installation of the first updater-enabled build.
- Keep current unsigned prerelease warnings until final downloaded artifacts prove otherwise. Never disable signature checks to bypass missing keys.

## Alternative: Microsoft Store MSIX distribution

Microsoft Store can re-sign an MSIX/AppX package with a Microsoft certificate after certification, without a purchased CA-trusted code-signing certificate. This applies to Store distribution, not the existing GitHub NSIS installer: Microsoft does not re-sign EXE/MSI submissions. Individual developer registration currently has a free onboarding route with identity verification; account approval and app certification remain external gates.

Tauri's native bundler currently produces EXE/MSI, not MSIX. A Store edition would require a separate Windows packaging and acceptance task: Partner Center package identity, WebView2 availability, native file pickers and approved-root access, app-data/settings preservation, and Store-managed updates instead of the GitHub NSIS self-updater. Do not assume an existing NSIS installation upgrades in place into a Store package. No Store account, package, submission or release has been created or verified under this task. GitHub packages retain unsigned warnings.

References: [Microsoft MSIX package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements), [individual developer onboarding](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer), and [Tauri Microsoft Store guidance](https://v2.tauri.app/distribute/microsoft-store/).

## Related work

See [APP-UPDATES](product-backlog.md#app-updates--new-release-notification-and-click-to-install-updates) for updater requirements and [release readiness](release-readiness.md) for platform acceptance gates.
