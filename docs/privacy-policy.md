# Privacy Policy

Tag-based Asset Manager. Effective [release date].

Tag-based Asset Manager is a desktop app that catalogs and tags files in folders you choose. It sends no information about how you use it unless you say yes, and even then it never sends your file names, paths, tags, notes or search text. It does not sell personal data.

## What the app stores, all on your device

- App settings: the folders you add as libraries, your saved searches, your theme, your usage data choice and, if you said yes, a random ID, kept in the app's own data folder on your computer.
- Tags and notes: kept in `.asset-tags.json` files inside the folders you tag.
- Backups: JSON files written only where you choose when you export.

## Usage data, only if you say yes

The app asks once. If you say no or close the question, no usage data is sent.

If you say yes, the app sends:

- Actions you take, and when: opening the app; editing tags; renaming tags; saving, using or deleting a saved search; previewing a file; exporting a backup; reconnecting a file or removing a missing one; moving items to Trash or the Recycle Bin; opening a file or folder, showing it in its folder or copying its path; adding, removing or switching libraries; moving between folders; using search; clicking a tag to filter; using filters; sorting; hiding the details panel; and changing theme, including which theme you picked.
- The time between your actions, and when each session started.
- A rounded library size, such as "1,000 to 10,000 items".
- App version, whether you got the app from GitHub or the Microsoft Store, and operating system.
- Your country, worked out from your IP address as described below.
- A random ID created when you say yes.

It never sends file or folder names, paths, tags, notes, search text, file contents, or your name or contact details.

The data is used only to understand which features are used and decide what to improve. It is not used for advertising.

**Who receives it.** The app sends it encrypted over HTTPS to a small service the developer runs on Cloudflare. That service uses your IP address to work out your country, then passes the events and country to Google Analytics without your IP address. Cloudflare and Google handle this data under the [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) and the [Google Privacy Policy](https://policies.google.com/privacy). It is not shared with anyone else.

**How long it is kept.** Google Analytics keeps event data linked to the random ID for 14 months. Totals in standard aggregated reports, such as how many times a feature was used in a month, are not affected by that limit and can be kept longer.

**Your choices.** You can see or change your choice anytime with **Usage data** at the top of the app. Turning it off stops sending, discards anything not yet sent and deletes the random ID from your device. If the app can't save that choice, it tells you, and stops sending until the app closes; the random ID stays on your device until the choice is saved, and sharing resumes the next time the app opens unless the choice is saved first. If you install both the GitHub and Microsoft Store editions, each keeps its own choice. The app doesn't show the ID and collects no name or contact details, so the developer can't look up your past events; they expire as described above.

## What the app does not do

- No account or sign-in.
- No advertising or crash reporting.
- Apart from usage data you agree to share, nothing is sent to the developer or to third parties.
- With usage data off, the Microsoft Store edition makes no network requests of its own; the Microsoft Store delivers its updates. The edition downloaded from GitHub checks GitHub for updates when it starts and when you ask; that request contains no data about you or your files, and GitHub receives standard connection details such as your IP address under the [GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Access to your files

The app reads only the folders you add. It writes tag files in those folders, writes a backup file where you choose, copies a file path to the clipboard when you ask, opens files and folders in other apps when you ask, and moves items to the Recycle Bin or Trash only after you confirm. It never changes the contents of your files.

## Microsoft and Windows

The Microsoft Store and Windows components the app relies on, such as Microsoft Edge WebView2, handle downloading, installation and updates under the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

## Removing your data

Removing a library in the app deletes its saved searches from the app's settings. Deleting the `.asset-tags.json` files in a folder removes its tags. Turning off usage data deletes the random ID once the choice is saved. You can uninstall the app at any time.

## Children

The app does not knowingly collect personal data from children. Usage data is sent only if someone says yes, and it contains no names, contact details or file information.

## Changes

Changes to this policy are published at this page.

## Contact

Open an issue at <https://github.com/minhtrancmvn/tag-based-asset-manager/issues>.
