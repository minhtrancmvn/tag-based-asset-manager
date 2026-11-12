# Design: Opt-in usage analytics in Google Analytics

Status: approved by the user on 2026-11-09, then amended the same day after consultation rounds 1 to 5 (`adr/usage-analytics/round-*/concerns.md`) and the user's decisions in between. No code written. Not a legal review.

## Problem Statement

The developer can't see how people use the app. They want named user interactions in Google Analytics (GA4). The app currently promises no analytics in its privacy policy and sends nothing, so collection must be opt-in, disclosed first, and never include file or library information.

## Requirements

- [ ] Nothing leaves the device until the user says yes. Undecided, declined and a dismissed dialog all send nothing.
- [ ] Ask once, on first launch or first launch after updating, with equally weighted choices.
- [ ] User can see and change the choice later from a control that stays visible at every window width (Microsoft Store policy 10.5.2). Looking at the choice never changes it.
- [ ] Turning it off stops sending at once, even if the choice can't be saved, and deletes the random ID once the choice is saved.
- [ ] Only one copy of the app runs at a time, so no other copy can keep sending or write the choice back (user decision, 2026-11-09).
- [ ] Both editions (GitHub and Microsoft Store) behave the same.
- [ ] Only events from a fixed list are sent. Paths, file and folder names, tags, notes, search text and library IDs can't be represented in an event.
- [ ] The GA `api_secret` never ships in the app, and Google never receives users' IP addresses.
- [ ] Analytics can't crash, block or slow the app, including when a settings write fails or a scan is running.
- [ ] Privacy text and UI claims change in the same release that can send data.
- [ ] Crash reporting stays out of scope.

## Approaches

### Approach 1: Rust to Cloudflare Worker to GA (selected by user)

**Pros**: secret stays off devices; Worker rejects anything off-list; Google never sees user IPs; Worker supplies country; secret can be replaced without an app release; CSP and frontend permissions unchanged.
**Cons**: one more service to run; Cloudflare joins the privacy policy; Google warns Measurement Protocol alone may give partial reports.
**Complexity**: Medium. **Risk**: Medium, reduced by spike S0.
**Domain agents needed**: `typescript-frontend-engineer`, `technical-documentation-engineer`, `reviewer-config-safety`.

### Approach 2: Rust direct to GA (rejected)

**Pros**: no server.
**Cons**: secret in every copy, which [Google says not to do](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events); extracted secret allows spam; replacing it needs a release; country data may be missing.
**Complexity**: Low. **Risk**: High.

### Approach 3: `gtag.js` in the webview (rejected)

**Pros**: full GA tagging, no partial-report warning.
**Cons**: loads remote code into a webview that can reach file operations; requires loosening the CSP pinned by `src/native.test.ts`. The app doesn't run at a normal web origin either.
**Complexity**: Low. **Risk**: High.

Aptabase was recommended and declined: the user wants the data in GA.

## Selected Approach

```
React UI ──track_usage(closed enum)──▶ Rust usage.rs ──HTTPS, one event, no secret──▶ Cloudflare Worker ──api_secret──▶ GA4
                                        consent gate                                   allowlist check
                                        send at once                                   adds country, sends no IP
```

Each event is sent on its own as soon as it happens. There is no queue and no batching (user decision, 2026-11-09).

## Spike S0: prove GA shows Measurement Protocol-only data

1. User creates the Web stream and a Measurement Protocol API secret, kept out of chat and the repo.
2. Validate one payload against `/debug/mp/collect`. Events sent there don't appear in reports and it doesn't check the secret.
3. Send one `test_event` to `/mp/collect` with `client_id`, `session_id`, `engagement_time_msec`, `user_location.country_id` and `device`.
4. Check Realtime at once and standard reports after GA processes the data.

**Pass**: event count, users, sessions and country all appear in standard reports. **Fail or partial**: stop, report what is missing, re-decide.

Also confirm in S0:
- Custom dimensions report (S0.3).
- Country comes from `user_location`, not the sender's IP: one event sent from Vietnam with `country_id` `JP` must show Japan.
- Device category and operating system appear in Tech reports. If not, check the property's granular device data setting before using the `operating_system` event param, which is already sent as a backup.
- Data retention: event and user data both 14 months, and **Reset user data on new activity** off, so the 14-month promise in the policy holds. Google's page doesn't state that switch's default.

Evidence so far: Realtime showed the event, a user, Vietnam and every custom param (`task_plan_usage-analytics.md`).

## Event catalog

Every event carries `session_id`, `engagement_time_msec`, `app_version`, `edition` (`github` or `store`) and `operating_system` (`macOS`, `Windows` or `Linux`, mapped explicitly from Rust's lowercase OS names), plus `device` (`category: desktop`). Names follow [Google's rules](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference): 40 characters or fewer, none reserved. `screen_view` is App-stream only, so it isn't used.

Separate event names, not one event with a parameter, so counts appear in GA's Events report with no setup.

| Event | Group | Fires when | Extra param | Throttled |
|---|---|---|---|---|
| `app_open` | App opened | Launch with consent, or right after opting in | | No |
| `tag_edit` | Feature | `editTags` succeeds | | No |
| `bulk_tag_edit` | Feature | `bulkEditTags` commits at least one row | | No |
| `tag_rename` | Feature | Rename apply commits at least one row | | No |
| `saved_search_save` | Feature | Saved search upsert succeeds | | No |
| `saved_search_apply` | Feature | User applies a saved search | | No |
| `saved_search_delete` | Feature | Saved search delete succeeds | | No |
| `asset_preview` | Feature | The preview for the selected item shows an image or text, while the details panel is visible; once per selected item | | Yes |
| `metadata_export` | Feature | Backup export succeeds | | No |
| `asset_reconnect` | Feature | Reconnect succeeds | | No |
| `missing_entry_remove` | Feature | Remove missing entry succeeds | | No |
| `asset_trash` | Feature | Delete moves at least one item | | No |
| `asset_open` | Feature | Native open succeeds | | No |
| `asset_reveal` | Feature | Native reveal succeeds | | No |
| `path_copy` | Feature | Full or relative path is copied | | No |
| `library_add` | Library | The library list grows (a cancelled picker or an already added folder doesn't count) | | No |
| `library_remove` | Library | The library list shrinks | | No |
| `library_switch` | Library | User picks another library from the library list (adding a library doesn't count) | | No |
| `library_scanned` | Library | First completed scan per library per launch | `size_range` | No |
| `folder_navigate` | Browsing | `navigateFolder` runs | | Yes |
| `search_used` | Browsing | Text typed into the search field leaves it non-empty for 2 s | | Yes |
| `tag_filter_click` | Browsing | User clicks a tag to filter by it, in the sidebar, an item's tag list or the details panel | | Yes |
| `filter_change` | Browsing | Kind filter or match mode changes | | Yes |
| `sort_change` | Browsing | Sort key or direction changes | | Yes |
| `details_panel_close` | Browsing | User hides the details panel | | No |
| `theme_change` | Browsing | Theme commit succeeds | `theme` (preset name) | No |

`size_range` values: `under_100`, `100_1k`, `1k_10k`, `10k_100k`, `over_100k`.

Throttled means the same event at most once every 10 seconds. The first one always goes through, so throttling doesn't reduce the number of users per event, while event counts are lower bounds. Events can still be lost offline, past 4 in flight or when the Worker's rate limit refuses them, and nothing records those losses. `asset_preview` fires when an item is selected and its preview shows, not on an explicit preview action. `search_used` counts typing only. Tag clicks, saved searches and rename rewrites change the query too, but don't count as search.

Not tracked: notes editing (user decision, 2026-11-09), rescan, validate metadata, failures, and consent declines (a decline sends nothing, so GA can't show the opt-in rate).

## Consent

**Stored in app-data settings:**

- `usageConsent`: `undecided` (default, including existing installs), `granted` or `declined`.
- `usageClientId`: random UUID, present only while granted. New one each time sharing is turned on. Never sent to the frontend.
- On load, `granted` without a valid UUID counts as `undecided`, so the user is asked again and nothing is sent. Any ID stored with another choice is ignored and removed at the next write.
- An unrecognized `usageConsent` value or a non-string `usageClientId` also loads as `undecided` with no ID, instead of making `settings.json` unreadable, because analytics must not be able to harm the app.

**The effective choice.** Native code keeps a "stopped, not saved" flag, set when turning off stops sending and cleared by a saved opt-out or by sending starting. Every `LibraryState` reports `usage: { available, consent, saved }`, where:
- `consent` is the effective choice: `declined` while the flag is set over a stored `granted`, otherwise the stored choice;
- `saved` is false only in that state.

Because native reports it, the frontend needs no copy of its own, and it survives library switches and webview reloads.

**Rules for saving the choice:**

- **Never wait for the backend lock.** Synchronous commands run on the main thread, and Validate metadata holds the backend lock for its whole run. So `set_usage_consent` takes the lock once, with a non-blocking attempt (`try_update`), and does its comparison, change and write under that one attempt. It never waits for scans or other operations.
- **Saving the same choice again does nothing:** no write, no new ID, no event. A choice counts as the same only if it matches both the stored and the effective choice.
- **Turning it on** writes first, with a new ID, then starts sending and sends `app_open`. If the lock is busy or the write fails, nothing changes: if sending was stopped, it stays stopped.
- **Turning it off while sharing** stops sending first, unconditionally: the effective choice becomes `declined`, in-flight sends are invalidated and the client is dropped. Then it tries to write.
  - If the lock is busy or the write fails, the result is "stopped, not saved". Sending stays off until the app closes, and the dialog says so and offers **Save "off"**.
  - **Save "off"** writes `declined`. If that doesn't save either, the result is "stopped, not saved" again, with the new reason.
  - A saved opt-out clears the flag and forgets the ID in memory.
- **Saying no when sharing was never on** (first ask, or review while undecided) only writes. If the lock is busy or the write fails, nothing changes, nothing is sent, and the app asks again next launch.
- **The command reports what happened.** It composes `usage` itself from the outcome, after stopping or starting and without the lock: `{granted, saved: true}` or `{declined, saved: true}` when saved, and `{declined, saved: false}` when stopped but not saved. A busy or failed result carries no `usage`, so nothing on screen changes except the message.
- **Consent problems stay in the dialog.** They never set the app's global error panel.

**The first ask** opens when all of these hold, and once open it stays until a saved result, Close or quit:
- the app is running on desktop;
- the backend returned `usage` with `available` true and the effective choice `undecided`;
- the user hasn't dismissed it this session;
- no other dialog is open, including the update dialog.

A startup settings problem means `usage` never arrives, so there's no dialog and nothing is sent.

**First ask, draft text:**

> **Share usage data?**
>
> You can send information about how you use the app to the developer, to help decide what to improve. Nothing is sent unless you choose **Share usage data**.
>
> **Sent:**
> - Actions you take and when, such as editing tags, moving between folders or using search, and which theme you picked
> - Roughly how many items are in your library
> - App version, whether you got the app from GitHub or the Microsoft Store, and operating system
> - Your country, worked out by Cloudflare from your IP address; Google doesn't receive the address
> - A random ID, deleted if you turn this off
>
> **Never sent:** file or folder names, paths, tags, notes, search text or file contents.
>
> It goes through Cloudflare to Google Analytics. You can change this anytime with **Usage data** at the top of the app. The privacy policy is on the app's GitHub page.
>
> [No thanks] [Share usage data]

- Both buttons have the same size and style (`secondary-button`, `type="button"`). Neither takes initial focus: the dialog container takes focus, with a visible outline.
- Escape counts as No thanks and is saved. Clicks outside the dialog are ignored, so a stray click can't answer, and they don't move focus out of the dialog.
- If the answer isn't saved, a Close button appears that dismisses the dialog for this session. The message sits above the buttons, and Close is added on its own row or first in the row, so the choice buttons don't move.

**Reopened from the topbar ("review"):** title **Usage data**, then a "Currently" line directly under it that depends on the effective choice. The body follows:
- It opens with "This sends information about how you use the app to the developer, to help decide what to improve. Nothing is sent while this is off."
- Then come the first ask's **Sent** and **Never sent** lists.
- It ends with "It goes through Cloudflare to Google Analytics. The privacy policy is on the app's GitHub page."

Review is also where people opt in, so it names the recipient too.

| Effective state | Currently line | Buttons |
|---|---|---|
| Sharing | "Currently: sharing usage data" | **Turn off**, **Keep sharing** |
| Not sharing, saved | "Currently: not sharing usage data" | **Turn on**, **Keep off** |
| Not sharing, not saved yet | "Currently: not sharing usage data. This choice isn't saved yet, so sharing will resume the next time the app opens." | **Save "off"**, **Turn on** |
| Undecided (first ask was closed) | "Currently: not sharing usage data. You haven't chosen yet." | **No thanks**, **Share usage data** |

**Keep sharing** and **Keep off** only close the dialog. Escape, clicking outside and the close button change nothing in review.

**Messages:**

| Situation | Shown in the dialog | Status region |
|---|---|---|
| Saved, from sharing or not sharing | Dialog closes | "Usage data turned on." or "Usage data turned off." |
| Saved, from undecided | Dialog closes | "Usage data is on." or "Usage data is off." |
| Busy, first ask or undecided review | "Another action is running, such as a scan or metadata check. Nothing is being sent. Try again when it finishes, or close this and the app will ask next time." | Nothing |
| Busy, turning on from not sharing | "Another action is running, such as a scan or metadata check. Nothing is being sent. Try again when it finishes." | Nothing |
| Failed, first ask or undecided review | "Your choice couldn't be saved. Nothing is being sent. Try again, or close this and the app will ask next time." | Nothing |
| Failed, turning on from not sharing | "Usage data couldn't be turned on. Nothing is being sent. Try again." | Nothing |
| Stopped, not saved, because busy | "Sending has stopped, but this choice couldn't be saved yet because another action is running. Press **Save "off"** when it finishes. Until it's saved, sharing will resume the next time the app opens." | Nothing |
| Stopped, not saved, because the write failed | "Sending has stopped, but this choice couldn't be saved, so sharing will resume the next time the app opens. Press **Save "off"** to try again." | Nothing |
| The app couldn't reach its native side, while turning off | "The app couldn't confirm the change. Try again." | Nothing |

- Dialog messages use `role="alert"`, and each attempt re-mounts the alert, so a repeated failure is announced again and is visible as a new attempt.
- A message clears when a save starts and when the dialog opens.
- The polite status region is always mounted, empty by default, visually hidden and outside `.topbar-info`, which is hidden at narrow widths. It is used only for the saved rows, so nothing is announced twice. It clears when the dialog opens, so it can't keep a sentence that has stopped being true.

**Both modes:**

- **While saving:**
  - "Saving…" shows in the dialog.
  - Both choice buttons get `aria-disabled` and ignore activation, so focus stays on the pressed button.
  - Escape, clicking outside and the close button are ignored.
- **After any result that keeps the dialog open,** focus stays on the pressed button, with two exceptions:
  - it moves to Close when the first ask can't save;
  - it moves to **Save "off"** after "stopped, not saved", because the buttons change. That button keeps the position **Turn off** had, so a repeated click or Enter saves "off" and can't turn sharing on.
- **Structure:** the dialog has `role="dialog"` and `aria-modal`. It is labelled by its title and described by its body, including the Currently line in review. Its Tab cycle includes the container and never leaves the dialog.

**Topbar, `src/App.tsx:807`:**

- **Control:** a **Usage data: On** or **Usage data: Off** text button in `.topbar-right`, from the effective choice, shown whenever `usage.available`. It is a `quiet-button` with `aria-haspopup="dialog"`.
  - Undecided shows Off.
  - While the choice isn't saved, it reads **Usage data: Off (not saved)**.
  - It stays enabled during scans and other operations.
- **Status text:** "Local files · sharing usage data" with the offline dot hidden, only when `usage.available` and the effective choice is `granted`. Otherwise the existing text and dot are unchanged.
- **Other gates:**
  - An open consent dialog or a consent save blocks update installation and counts as busy, like a theme save.
  - While an opt-out isn't saved, update installation is blocked, with a reason pointing to **Save "off"**, because a restart would turn sharing back on (user decision, 2026-11-09).

## Components

### Rust: `src-tauri/src/usage.rs` (new)

- `UsageEvent`: closed enum with 26 variants, internally tagged by `name`. Payload-free events are empty struct variants, so `deny_unknown_fields` rejects extra fields; a serde probe confirmed unit variants silently accept them. Only `theme_change` (`theme: AppTheme`) and `library_scanned` (`size_range: SizeRange`) carry data. No `String` field anywhere. `track_usage` is the only way in.
- `UsageConsent` is defined here and used by `backend.rs`.
- `UsageState`: its own `Mutex`, managed like `UpdateState`. It never takes the `BackendState` lock and is never called with it held, because the sidecar apply path holds that mutex through its commits. The two locks are never nested. It mirrors the stored consent: setup loads it, `start()` sets granted, and a saved decline sets declined and forgets the ID.
- **The `set_usage_consent` command** lives here, as a plain synchronous command like `set_app_theme`, so calls can't interleave. It calls the backend's domain function.
- **Stopped flag:** a lock-free "stopped, not saved" flag, created by `BackendState::load` inside `Inner` and shared with `UsageState` through a crate-private accessor. `stop()` sets it. `start()` and a saved decline clear it. `LibraryState` reads it to report the effective choice.
- **Sending:**
  - Each recorded event goes out in its own request, from a task spawned with `tauri::async_runtime::spawn`.
  - At most 4 requests are in flight. A slot is held by a guard that releases it on every path, including early returns and errors. Further events are dropped.
  - A failure drops the event, with no retry and nothing on disk.
  - Each task checks the consent generation just before sending. Opting out bumps the generation, so recorded but unsent events are dropped. A request already in the network may still complete.
  - The HTTPS client is built inside a spawned task on first use, never on the command thread, and is stored only if the generation hasn't changed. It is dropped on opt-out, so no idle connection lingers.
- **Session:** `session_id` is Unix seconds at session start, renewed after 30 minutes idle. `engagement_time_msec` is time since the previous event, clamped to 1 to 60,000. Turning sharing on starts a new session and clears throttle times, so events under a new ID can't be linked to the old one by `session_id`.
- **Endpoint:** `option_env!("TAG_ASSET_MANAGER_USAGE_ENDPOINT")`, trimmed, `https://` only, otherwise unavailable: no dialog, no button, no task. The official value is `https://usage.minhtran.id.vn/v1/events`. Forks and dev builds stay silent. Tests inject the endpoint.
- **Panic safety:** `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::indexing_slicing)]`, because release builds use `panic = "abort"`.

**TLS trap:** the lockfile's `reqwest` uses `rustls-no-provider`, and the updater installs the `ring` provider only just before its own request (`tauri-plugin-updater` `updater.rs:579`). A client built earlier would have no provider, and `reqwest` then panics, which aborts the app. `usage.rs` must install the provider the same way first. `cargo tree` must show no new TLS stack.

### Rust: `src-tauri/src/backend.rs`

- Add both fields to `PersistedSettings`, `Inner`, `load` and `persist`, and `usage: { available, consent, saved }` to the `LibraryState` DTO.
- Add `BackendState::try_update`: it shares one body with `mutate`, including `note_mutation` and both restore paths. It takes the lock with `try_lock` and returns busy instead of waiting. Its closure can report "unchanged", which skips the write.
- Add a `pub(crate)` `set_usage_consent_domain`, running entirely inside one `try_update`. It returns the outcome plus, when sharing is turned on, the new ID for `UsageState`.
- A crate-private accessor gives startup the stored consent and ID. Another gives `lib.rs` the stopped flag. `load`'s signature doesn't change.
- `persist`'s struct literal gains the two fields. Its logic and signature don't change, so the sidecar apply path's injected persister is untouched.
- A `#[cfg(test)]` helper holds the backend lock from another thread, for busy tests.

### Rust: single instance

- Register `tauri-plugin-single-instance`, version 2.5.5 or later, first in the builder, in release builds only, so `pnpm tauri dev` can still run beside an installed copy. Version 2.5.4 can let a second process keep running on Windows if the first window can't be found.
- Opening the app again brings the existing window forward (show, unminimize, focus), and the second process exits.
- The plugin keys on the app identifier, so the GitHub and Store editions, which have different identifiers and separate settings, still run side by side.
- It needs no frontend capability.

### Frontend

- `src/native.ts` and `src/types.ts`: `setUsageConsent`, `trackUsage`, the `usage` DTO and the command result `{ status, usage?, reason? }`, with `status` `saved`, `busy`, `failed` or `stoppedNotSaved`, `usage` present only on `saved` and `stoppedNotSaved`, and a `reason` of `busy` or `failed` on `stoppedNotSaved`.
- `src/usage.ts` (new): typed fire-and-forget wrapper and `size_range` bucketing. The event list is an `as const` array, and the union is derived from it.
- `src/components/UsageConsentDialog.tsx` (new): first ask and review, saving and message states.
- `src/useLibrary.ts`: emit after success only. `setUsageConsent` is guarded only by `isDesktop` and an in-flight ref, always calls native (native never blocks), merges the returned `usage` into state only when present, never calls `applyState` and never sets the global error.
- `src/components/AppUpdates.tsx`: an optional `onOpenChange` prop reports whether its dialog is open.
- `src/components/AssetPreview.tsx`: an optional `onShown(kind)` callback fires when an image loads or text renders.
- `src/App.tsx`: browsing events, the search idle timer, dialog, topbar control, busy and update gates.

### Cloudflare Worker: `usage-proxy/` (new)

- `POST /v1/events` with exactly one event, body capped at 8 KiB. Returns 204.
- Checks every name, param and value against `usage-events.json`. Anything off-list returns 400 and forwards nothing. With one event per request, a bad event loses only itself.
- Builds the request to Google from scratch with only `content-type`; no header from the app's request is forwarded. Cloudflare documents that forwarding the original headers passes the client IP along.
- Adds `user_location.country_id` from `request.cf.country`, skipped for `XX` and `T1`. Sends `consent` with `ad_user_data` and `ad_personalization` set to `DENIED`. Doesn't send `ip_override`.
- Holds `GA_API_SECRET` via `wrangler secret`.
- `FORWARD = "off"` makes it accept and drop everything with 204, so data can stop without an app release.
- Logs nothing: no `console` calls, observability off.
- [Rate limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) keyed on a fixed route string, because Cloudflare advises against IP keys. It is approximate and per location, and whether it works on the Free plan is confirmed at deploy.
- Free plan allows [100,000 requests a day](https://developers.cloudflare.com/workers/platform/limits/).

### Shared contract

- `usage-events.json` (new) lists event names, theme values, size ranges, editions, operating systems and param keys. The Worker imports it, a Rust test reads it with `include_str!`, and a Vitest test reads it. Changing one side alone fails a test.
- `fixtures/usage-payload.json` (new) holds one golden request body per event. Rust must produce them exactly, the Worker must accept every one, and `src/native.test.ts` pins the `track_usage` and `set_usage_consent` argument names.
- The allowlist only grows. The Worker is deployed before any merge that adds to it, because installed copies and the deployed Worker can't be updated together.

### Build

- `build.rs` adds `rerun-if-env-changed`.
- `release.yml` and `store-msix.yml` pass the endpoint from repository variable `USAGE_ENDPOINT`. It isn't a secret.
- `scripts/check-usage-endpoint.mjs`, with its own tests, is called by both workflows before building. In this repository the value must be exactly the official endpoint, and empty fails, so a release can't ship without the dialog the policy describes. In forks the variable is absent and the check passes, so forks stay silent.

## Verification

| Check | Method |
|---|---|
| No send when undecided, declined, stopped or endpoint absent | Rust tests with injected sender and endpoint |
| Opt-out stops sending when the lock is busy or the write fails, and a retry saves it | Rust tests with the lock held by another thread and with an injected write failure |
| Saying no when never sharing returns busy or failed, never "stopped" | Rust tests |
| Turning on after a saved decline works and sends `app_open` | Rust test on a real temp settings file |
| Turning off and back on in one session reports On and sends `app_open` under a new ID, from a saved opt-out and from "stopped, not saved" | Rust tests asserting the returned `usage`, a following state and the send; native check |
| A retry that doesn't save returns "stopped, not saved" again; busy and failed carry no `usage` | Rust tests |
| Same choice twice is a no-op | Rust test |
| Every branch of the consent command returns promptly with the lock held | Rust tests with a timeout |
| In-flight slots are released on every path | Rust test with four failing sends, then a fifth |
| Legacy settings load as `undecided`; unknown fields preserved; invalid stored states handled | Rust tests |
| Off-list events and extra fields rejected; no `String` in `UsageEvent` | Rust tests, exhaustive allowlist pin |
| Golden payloads match on all three sides | Rust, Worker and Vitest tests |
| The consent command's argument name and exact result JSON match across IPC | A Rust test through the real command handler, plus a golden result fixture read by Rust and Vitest |
| An unrecognized stored consent value or non-string ID leaves libraries loading | Rust tests |
| Client builds with no prior TLS provider | Rust test, run alone |
| Consent save works during a scan and during other operations; no result traps the user | `src/useLibrary.test.tsx`, `src/App.test.tsx` |
| Every row of the review states and messages tables; after "stopped, not saved", the first button is **Save "off"** and has focus | Vitest, one test each |
| Update installation is blocked while an opt-out isn't saved | Vitest, and natively on a real offered update of the GitHub edition after release, because no pre-merge build is offered one |
| Focus rules, equal buttons, Tab cycle, Escape and outside-click rules | Vitest |
| Events fire on success only; no search text in payload; unsupported preview sends nothing | Vitest |
| Endpoint check script: exact value passes, empty and wrong fail in this repo, absent passes elsewhere | `node --test` |
| Worker rejects off-list, sends no client headers or IP, sets country, hides secret, switch off works | Worker tests, plus one echo check at deploy |
| Opening the app again focuses the existing window and starts no second process | Native check on macOS and Windows |
| An in-app update still relaunches with the plugin, with one process running | Native check at the first update from a build carrying the plugin |
| Button and dialog readable at 820×600; screen readers read the dialog | Native manual check, because jsdom has no layout or screen reader |
| **No connection to the endpoint before opt-in or after opt-out, with tracked actions performed** | Capture started before launch, with a positive control, on macOS and on Windows before merge |
| CSP and capabilities unchanged | `git diff --exit-code main...HEAD` on both files |
| Real events reach GA from published builds | Realtime, end to end |

Add rows to `docs/manual-test-plan.md` and `docs/microsoft-store.md`, and update STORE-01 for the dialog. jsdom results don't prove WKWebView behavior.

## Release order

1. S0 passes, and this design's consultation returns PROCEED.
2. GA settings done, Worker deployed and tested.
3. App, tests and docs on the branch. GitNexus `impact` before editing symbols, `detect_changes` before commit.
4. Windows checks on the PR's test-signed Store package, before merge.
5. One PR holds the app code, the policy and the build change. Merge and release with the policy dated to the release.
6. New Store submission, uploaded by hand because Store updates are manual, with a version above the last submission (`0.7.0.0` at the time of writing) and the new policy pasted into Partner Center. Check the listing and age rating answers for "no data collected" claims, which aren't in this repo.
7. End-to-end check against the published builds.

## What the user does

1. Create the Web stream and API secret. Keep the secret out of chat.
2. In Admin, Data collection and modification, Data retention, set event data and user data to 14 months and turn off **Reset user data on new activity**. Send a screenshot.
3. Leave Google signals and ad personalization off, with no Ads link.
4. Register `edition`, `app_version`, `theme`, `size_range` and `operating_system` as event-scoped custom dimensions during S0, before the test event that carries them. Only data sent after registering counts.
5. Run `wrangler login` and `wrangler secret put GA_API_SECRET` in their own terminal when the Worker is deployed to `usage.minhtran.id.vn`.
6. Run the Windows checks on their Windows 11 PC before merge.

## Domain Agents

Rust in the main session, because no Rust agent exists. `typescript-frontend-engineer` for React and the Worker, `technical-documentation-engineer` for docs. Review with `reviewer-config-safety`, `reviewer-silent-failures` and `reviewer-skeptical-senior`. Verify all agent output.

## Open Questions

None. The Worker hostname is `usage.minhtran.id.vn`, on the user's own domain and Cloudflare account (the user confirmed this on 2026-11-09; public DNS shows Cloudflare nameservers).

## Decisions

- 2026-11-09, at approval: design approved; added `asset_open`, `asset_reveal`, `path_copy`, `library_add` and `library_remove`; GA retention 14 months; Worker at `usage.minhtran.id.vn`.
- 2026-11-09, after consultation round 1:
  - Send each event at once instead of a 15 s batch.
  - `details_panel_close` replaces `details_panel_open`, which only counted re-opening.
  - Added `library_switch`, `tag_filter_click`, `missing_entry_remove` and `saved_search_delete`, for 26 events.
  - Notes editing is not tracked.
  - The consent rules, dialog modes, contract pins and release order above came from the review findings.
- 2026-11-09, after consultation round 3: only one copy of the app runs at a time, using Tauri's single-instance plugin, instead of a rule for a second copy. Native code reports the effective choice, replacing a frontend copy of it.
- 2026-11-09, after consultation round 4: update installation is blocked while an opt-out isn't saved.
- 2026-11-09, after consultation round 5: test and text corrections only, with no change to behavior the user chose. An unrecognized stored consent value loads as undecided.

## Trade-offs Accepted

- Google warns of partial reporting. S0 tests this before anything else is built.
- The Worker endpoint is public. Anyone can post valid-shaped events and inflate counts, but can't inject free text. Rate limiting is approximate.
- GA can't show opt-in rate, and numbers cover only people who opted in.
- Events sent while offline, or past the 4 in flight, are lost.
- Browsing counts are lower bounds because of throttling.
- Existing users see one new dialog after updating.
- Cloudflare becomes a runtime dependency, but analytics failing never affects the app.
- Copies already installed can't be told to stop calling the Worker. The Worker's off switch stops data reaching Google instead.
- On Windows, the GitHub installer edition is first checked after release. It runs the same code as the Store package checked before merge, apart from the `edition` value.
- One new dependency, `tauri-plugin-single-instance`. Opening the app a second time now brings the existing window forward instead of opening a second one.
- `library_scanned` is sent for a library only on its first completed scan after sharing is on, so someone who opts in mid-session reports size at the next launch.

## Appendix A: new `docs/privacy-policy.md`

Written for app users and Microsoft reviewers.

```markdown
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
```

## Appendix B: other text changes

| Location | Change |
|---|---|
| `README.md:199` | Add: "Usage data is off by default. If the user opts in, named interaction events go through a Cloudflare Worker to Google Analytics; file names, paths, tags, notes and search text are never sent." |
| `docs/app-updates.md:162` | Rename the bold label "Network Metadata Disclosure" and limit the claim to the update check: "The update check carries no telemetry, analytics, hardware identifiers or library data. Opt-in usage data is separate; see the privacy policy." |
| `docs/microsoft-store.md:73` | Replace the last sentence: "The app sends usage data only after in-app opt-in; with it off, the Store edition makes no network requests of its own." |
| `docs/microsoft-store.md` table at line 10, STORE-01 | Add a row: both editions behave the same for opt-in usage data. Update STORE-01 for the first-launch dialog. |
| `docs/usage-analytics.md` (new) | How to read the numbers: lower bounds; users rather than counts for throttled events; opt-in only; GA users aren't people, because each opt-in, machine or app-data reset makes a new ID; losses nothing records (offline, past 4 in flight, rate limit); `asset_preview` fires on selection; `details_panel_close` can't happen at 1024 px or narrower and the panel starts open. The event catalog with each event's matching phrase in the privacy policy. The runbook: Worker off switch, `wrangler rollback`, rotating the secret, append-only allowlist, deploy before merge. |
| `CLAUDE.md` | Add usage analytics and single-instance behavior to the implementation boundary and architecture sections, and correct the stale line that calls notes editing deferred. Add: when a dev build runs beside an installed copy with sharing on, use `--config` with a separate identifier, because the dev build shares its settings file and isn't covered by single instance. |
| `README.md` | Note that opening the app again brings the existing window forward. |
| Partner Center | Paste the new policy in the same submission. |
| `src-tauri/store/AppxManifest.xml:28` | No change. "Local-first" stays true. |
