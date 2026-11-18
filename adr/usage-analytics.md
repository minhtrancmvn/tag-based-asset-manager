# ADR: Opt-in usage analytics in Google Analytics

**Date:** 2026-11-09, amended the same day after consultation rounds 1 to 4
**Status:** Accepted. Not implemented. Spike S0 and this ADR's consultation must pass before any product code is written.
**Complexity:** Medium. It adds a new native module, a new consent setting, a Cloudflare Worker, single-instance behavior, and privacy text that must ship together.

## Context

The developer can't see how people use the app and wants named interactions in Google Analytics (GA4). The app sends nothing today, and its privacy policy promises no analytics.

The app's CSP blocks remote scripts and remote connections, and its webview can reach file operations through IPC. Microsoft Store policy 10.5.2 requires express permission and an in-product opt-out for sharing personal information with third parties.

## Decisions

1. **GA4 through a Worker.** Use the Measurement Protocol, sent from Rust to a Cloudflare Worker at `usage.minhtran.id.vn` on the developer's own domain and account. The Worker holds the `api_secret` and forwards to GA. Aptabase was offered and declined, because the developer wants the data in GA.
2. **Prove it first.** Spike S0 sends test events through the real GA stream. If event count, users, sessions or country don't appear in standard reports, stop and decide again, because Google warns that Measurement Protocol alone may give partial reporting. S0 also confirms custom dimensions, the country source, device data and the retention settings.
3. **Collect only after opt-in, and never change the choice by looking at it.**
   - The app asks once with equally weighted choices. Escape counts as no, and clicks outside the dialog are ignored. Undecided and declined send nothing and start no network activity.
   - A text control visible at every window width shows On or Off and reopens the dialog. In that view, Escape, clicking outside and closing change nothing, and the buttons say exactly what they do.
   - Saving the same choice again is a no-op.
   - The consent command never waits for the backend lock. It makes one non-blocking attempt (`BackendState::try_update`, sharing `mutate`'s body, hook and rollback), so neither scans nor long operations can stall it or freeze the window.
   - A failed or busy save is reported inside the dialog, focus stays inside it, and the first ask can be dismissed for the session. The dialog can never trap the user.
4. **A fixed list of 26 named events.** They are carried by a closed Rust enum with no `String` field. Payload-free events are empty struct variants, so extra fields are rejected. Paths, names, tags, notes, search text and library IDs can't be represented. There is no automatic click capture, because captured UI text could include file names or tags.
5. **The Worker checks everything and leaks nothing.**
   - Each request carries one event. The Worker rejects anything off the list in `usage-events.json`.
   - It builds its request to Google from scratch, forwarding no client header. It adds country from the request and doesn't send the IP.
   - It logs nothing, and an off switch makes it accept and drop everything.
   - `usage-events.json` and a golden payload fixture are shared by Rust, TypeScript and the Worker, so no side can change alone. The list only grows, and the Worker is deployed before any merge that adds to it.
6. **Analytics stays separate from the backend, and opting out always wins.**
   - `UsageState` has its own lock. The two locks are never nested, because tag rename apply holds the backend mutex through its sidecar commits.
   - **Turning sharing on** writes first, with a new ID, then starts sending.
   - **Turning sharing off** stops sending in memory first, unconditionally, then tries to write. If the lock is busy or the write fails, sending stays off until the app closes and the dialog offers **Save "off"**. Every `LibraryState` reports the effective choice from a native "stopped, not saved" flag, and update installation is blocked until the choice is saved, because a restart would turn sharing back on.
   - The command composes the state it returns from the outcome, after stopping or starting, so what the app shows always matches what it is doing.
   - **Saying no when sharing was never on** only writes. On failure nothing changes, and the app asks again next launch.
7. **Only one copy of the app runs** (user decision, 2026-11-09). `tauri-plugin-single-instance`, registered in release builds, brings the existing window forward when the app is opened again. A second copy normally can't run, so it can't keep sending after an opt-out or write an old choice back. The plugin deliberately lets the app start normally if it hits an unexpected local error. The GitHub and Store editions have different identifiers and separate settings, so they still run side by side.
8. **Analytics must not be able to harm the app.**
   - Each event is sent on its own as it happens, from a spawned task.
   - At most 4 sends are in flight, each holding a slot that is released on every path.
   - Failures drop the event, with no retry and nothing on disk.
   - The HTTPS client is built off the command thread, after installing the TLS provider. It is stored only if the generation hasn't changed, and is dropped on opt-out.
   - The module allows no `unwrap`, `expect`, `panic!` or indexing, because release builds use `panic = "abort"`.
9. **No endpoint, no analytics.** The endpoint is compiled in from `TAG_ASSET_MANAGER_USAGE_ENDPOINT`. Without it, builds show no dialog and send nothing, so forks and development builds stay silent. In this repository's release and Store workflows, a checked script requires exactly the official endpoint.
10. **Both editions behave the same.**
11. **GA settings.** Event and user data retention are 14 months, with **Reset user data on new activity** off, and the privacy policy says so. Google signals and ad personalization stay off.
12. **Privacy text ships with the code.** Privacy text and UI claims change in the same pull request and release that can send data. Crash reporting is out of scope.
13. **Prove it before users get it, and keep the proof current.**
    - The "nothing before opt-in" promise is proven on macOS and on Windows before merge. Each check uses a capture started before launch, tracked actions in every window and a positive control.
    - Each proof records the commit it ran at, and is repeated if relevant files changed since.

## Rejected alternatives

- **Sending directly from Rust to GA:** puts the `api_secret` in every copy, which Google says not to do, and a leaked secret allows spam that can only be fixed by a release.
- **`gtag.js` in the webview:** loads remote code into a webview with IPC access to file operations and requires loosening the CSP.
- **`tauri-plugin-http`:** grants the frontend network access it doesn't need.
- **A 15-second batch queue:** at human pace most batches would hold one or two events. The queue added opt-out races and lost the end of short sessions.
- **A rule letting a second running copy adopt an opt-out from disk:** it cancelled legitimate opt-ins after an earlier decline, needed a flag that was hard to clear, and reached into the settings persister. All three round 3 reviewers found the defect, and allowing only one copy removes the problem at its source.

## Consequences

- Cloudflare becomes a runtime dependency and joins the privacy policy, but analytics failing never affects the app.
- **Coverage:**
  - GA can't show the opt-in rate, and all numbers cover only people who said yes.
  - Frequent browsing events are throttled, so their counts are lower bounds.
  - Events sent while offline are lost.
- The Worker address is public, so anyone can inflate counts with valid events, but can't inject free text.
- Existing users see one new dialog after updating.
- One new dependency, the single-instance plugin. Opening the app again focuses the existing window, which also stops two copies overwriting each other's libraries and theme.
- **Rollback:** copies already installed can't be told to stop calling the Worker. The Worker's off switch, `wrangler rollback` and secret rotation stop data reaching Google without a release.
- The Store copy gets this only through a manual submission that also updates the policy in Partner Center.

## Verification required

- S0 passes against the real GA stream.
- Capture shows no connection to the endpoint before opt-in or after opt-out, on macOS and on Windows, before merge.
- Opening the app again focuses the existing window and starts no second process, on macOS and Windows.
- `src-tauri/capabilities/default.json` and the CSP are unchanged against `main`.
- Real events from published builds reach GA.

jsdom results don't prove WKWebView behavior.

## Links

- [Design](../docs/design/usage-analytics.md)
- [Implementation plan](../docs/design/usage-analytics-plan.md)
- Consultation evidence is kept locally in `adr/usage-analytics/` and isn't committed, following the precedent in `adr/tag-rename.md`. The final synthesis the implementation gate reads is `adr/usage-analytics/synthesis.md`.
