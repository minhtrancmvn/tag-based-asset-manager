# Microsoft Store edition

Status (2026-11-09): published on the Microsoft Store. Submission 1, the `0.6.0.0` upload package from Store package run [42422444473](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/42422444473), passed Microsoft certification and is live, as reported by the account owner. Before that, the test-signed package passed every Windows 11 test below (STORE-01 to STORE-10), and the first upload failed validation on `PublisherDisplayName` (fixed below).

## What differs from the GitHub download

| | GitHub download (NSIS installer) | Microsoft Store (MSIX) |
|---|---|---|
| Signing | Unsigned; Windows SmartScreen warns | Microsoft signs the package after certification |
| Updates | In-app updater reads the `update-preview` feed | The Store installs updates. The in-app updater refuses before any network request and says so |
| App settings | `%APPDATA%\com.tagbasedassetmanager.desktop` | Its own settings (identifier `com.tagbasedassetmanager.store`). Windows is expected to keep them in the package's private storage and delete them on uninstall (unverified) |
| Libraries, tags, sidecars | Same: tags live in each library's `.asset-tags.json` files, so they are shared by both copies | Same |

Both copies should install side by side (STORE-01 and STORE-09 check this). The Store copy does not see the GitHub copy's registered libraries or saved searches; add the libraries again.

How it works:

- `TAG_ASSET_MANAGER_STORE_BUILD=1` at compile time makes `check_for_updates` and `install_update` in `src-tauri/src/app_updates.rs` refuse before contacting GitHub. The Store workflow also refuses to build if `TAURI_UPDATER_PUBLIC_KEY` is set.
- `src-tauri/store/tauri.store.json` gives the Store build its own Tauri identifier, so its settings never mix with the GitHub copy's.
- `src-tauri/store/AppxManifest.xml` holds the package identity from Partner Center. The `Publisher` value is confirmed: it derives the publisher ID `ae7ec8a4n9cgc` in the package family name `kaishj91.Tag-basedAssetManager_ae7ec8a4n9cgc`. `DisplayName` (`Tag-based Asset Manager`) matches Partner Center → Product identity. `PublisherDisplayName` must equal the account's publisher display name, `kaishj91`, which the Store shows as the developer: the first upload with `Minh Tran` was rejected on 2026-11-08 ("doesn't match your publisher display name: kaishj91"), and renaming the account to `Minh Tran` was not possible because that name is taken.
- The package is a full-trust desktop app (`runFullTrust`). It needs this to read and write library folders the user picks and to move items to the Recycle Bin.

## Building the packages

Actions → **Microsoft Store package** → **Run workflow** on `main`, with **submit** off, builds the packages from the selected branch without touching Partner Center. Pull requests that change Store packaging do the same.

Artifacts, kept for 14 days:

- `store-msix-upload`: `Tag-Based-Asset-Manager_<version>.0_x64.msix`, unsigned, for Partner Center only. Store versions must end in `.0`, and each submission needs a higher version than the last.
- `store-msix-test-signed`: test-signed copies `<version>.0` and `<version>.1`, plus `test-signing-certificate.cer`. Use these for sideloading tests only; never upload them. The certificate's private key is created on the build machine and deleted before the job ends.

## Windows 11 test (sideloading)

Use a throwaway copy of `fixtures/sample-library` (copy the folder somewhere like `Documents\store-test-library`), never a real library.

1. Download `store-msix-test-signed` from the workflow run and unzip it.
2. Trust the test certificate in **Local Machine → Trusted People**. The certificate import wizard's automatic store choice, or a Current User import, leaves the installer showing "Publisher: Unknown" and "This app package's publisher certificate could not be verified". In PowerShell run as administrator, from the unzipped folder:

   ```powershell
   (Get-FileHash .\test-signing-certificate.cer -Algorithm SHA256).Hash   # must match its line in SHA256SUMS.txt
   Import-Certificate -FilePath .\test-signing-certificate.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
   ```

   Note the thumbprint it prints; each workflow run makes a new certificate.
3. Double-click `Tag-Based-Asset-Manager_<version>.0_x64.msix` → **Install**. The publisher now reads `CN=26BEF0A5-…`.

Record each result:

| ID | Do | Expect |
|---|---|---|
| STORE-01 | Start the app from the Start menu | Opens with the welcome screen and no libraries, even if the GitHub copy is installed with libraries |
| STORE-02 | Click **Check for updates** | Says this copy is from the Microsoft Store, which installs its updates. Nothing is downloaded |
| STORE-03 | Add the throwaway library through the folder picker | Scans; rows and existing tags appear |
| STORE-04 | Add a tag to one file, then quit and reopen the app | The library is still registered and the tag is still there; the tag is in that folder's `.asset-tags.json` |
| STORE-05 | Open, Reveal and Copy path on a file | Opens in the default app, File Explorer selects it, and the clipboard has the path |
| STORE-06 | Export JSON to `Documents` | The backup file appears where you chose |
| STORE-07 | Delete one file through the app | It moves to the Recycle Bin and can be restored from there |
| STORE-08 | Double-click `<version>.1_x64.msix` → **Update** | Upgrades in place; the library, tags, saved searches and theme survive |
| STORE-09 | If the GitHub copy is installed, open it | Its own libraries and settings are unchanged |
| STORE-10 | Settings → Apps → uninstall the Store copy | Uninstalls; the throwaway library's files and `.asset-tags.json` stay |

Clean up afterwards: in PowerShell run as administrator, `Remove-Item Cert:\LocalMachine\TrustedPeople\<thumbprint>` (or `certlm.msc` → **Trusted People** → **Certificates** → delete **Tag-Based Asset Manager MSIX test only**), then delete the throwaway library.

### Results

2026-11-07, Windows 11 x64, the account owner's PC, test-signed packages `0.5.2.0` and `0.5.2.1` from workflow run [42238367518](https://github.com/minhtrancmvn/tag-based-asset-manager/actions/runs/42238367518) (commit `64204c7`): **STORE-01 to STORE-10 all passed**, as reported by the account owner. The first install attempt failed until the certificate was imported into Local Machine → Trusted People (step 2). This is also the first native Windows run of the app; it covers the Store edition's packaged behaviour, not the GitHub NSIS installer.

## Before the first submission

- Upload `store-msix-upload` in a new submission. Partner Center validates the identity on upload.
- Restricted capability `runFullTrust`: Partner Center asks for a reason. Suggested text: "Desktop app that catalogs and tags files in folders the user chooses; it reads those folders, writes tag files next to them, and moves user-selected items to the Recycle Bin."
- Store listing: description, at least one screenshot and the age rating questionnaire.
- Privacy policy: Partner Center requires one because the package declares `runFullTrust`. The policy is [privacy-policy.md](privacy-policy.md); paste its text under **Provide privacy policy text**, or link to it on GitHub. The app collects no personal data and, in the Store edition, makes no network requests of its own.
- Microsoft certification usually takes a few days.

## Store updates

GitHub releases and the in-app updater never reach Store users; each release needs its own submission. Once set up, the **Microsoft Store package** workflow does this with no human step: a release that passes Microsoft certification is published to users automatically, and it has only been tested by CI.

It runs after each Release run and once a day, and takes the highest release:

1. Reads Partner Center through the read-only Store submission API.
2. If that release is newer than the Store's version and nothing is pending, builds the MSIX from the release tag and checks that the tag is on `main`.
3. Reads Partner Center again, then submits with the [Microsoft Store Developer CLI](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/overview).

A run stops with a warning, without changing anything, when:

- **A submission is pending in Partner Center**, including a draft you started by hand or one in certification. This matters because `msstore publish` deletes a pending submission before creating its own. The daily run tries again once the pending one is published or deleted. The one exception is a submission whose commit failed, which the CLI replaces.
- **The Store already has that version or a higher one.** Each submission needs a higher version than the last.

While one submission is in certification, later releases wait, and the daily run then submits only the newest. Store listing text, including "What's new", carries over from the previous submission; change it in Partner Center.

The submit step passes `--priceId Free`, because the app is free and `msstore publish` otherwise stops on a product whose price is managed per market. Change that step before ever charging for the app: it would set the price to free.

To submit without waiting: Actions → **Microsoft Store package** → **Run workflow** on `main`, with **submit** on.

### One-time setup

Nothing is submitted until the repository variable `MSSTORE_PRODUCT_ID` exists. No client secret is stored: Microsoft Entra trusts GitHub's short-lived sign-in token, and only for jobs in this repository's `microsoft-store` environment, which only `main` can use.

1. **Tenant.** Partner Center needs an associated Microsoft Entra tenant: [create a new one](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/create-new-azure-ad-tenant) or [associate an existing one](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/associate-existing-azure-ad-tenant-with-partner-center-account). You need Global administrator rights on it.
2. **App registration.** In the [Entra admin center](https://entra.microsoft.com/), App registrations → New registration, single tenant, no redirect URI. Note the **Application (client) ID** and **Directory (tenant) ID**.
3. **Federated credential.** On that app: Certificates & secrets → Federated credentials → Add credential → **GitHub Actions deploying Azure resources**. Organization `minhtrancmvn`, repository `tag-based-asset-manager`, entity type **Environment**, environment `microsoft-store`. Keep the default audience `api://AzureADTokenExchange`. Do not add a client secret.
4. **Partner Center role.** Account settings → User management → Microsoft Entra applications → add the app with the **Manager** role.
5. **IDs.** Note the **Seller ID** from Partner Center account settings and the app's **Store ID** from its Product identity page.
6. **Repository variables.** These are identifiers, not secrets. Set `MSSTORE_PRODUCT_ID` last, because it switches submission on:

   ```sh
   gh variable set MSSTORE_TENANT_ID --body '<directory (tenant) ID>'
   gh variable set MSSTORE_CLIENT_ID --body '<application (client) ID>'
   gh variable set MSSTORE_SELLER_ID --body '<seller ID>'
   gh variable set MSSTORE_PRODUCT_ID --body '<Store ID>'
   ```

To switch submission off, delete `MSSTORE_PRODUCT_ID`.

## Not verified yet

- Installing from the Store listing, and Store-delivered upgrades between Store versions. The Windows 11 test above used sideloaded, test-signed packages.
- Automatic submission. The workflow's decisions and Store API calls have automated tests against a fake network, but it has not yet signed in to Entra or submitted anything. The first real run is the test.
- WebView2 on older Windows 10 machines; Windows 11 includes it.
