# Usage analytics

Opt-in usage analytics for the developer. Nothing is sent until the user chooses **Share usage data**, and no file names, paths, tags, notes, search text or library IDs can be represented in an event. The user-facing promise is the [privacy policy](privacy-policy.md); the design and the reasons behind it are in [the design](design/usage-analytics.md). This page is for the person reading the numbers and running the service.

## How it works

```
React UI -- track_usage(closed enum) --> Rust usage.rs -- HTTPS, one event, no secret --> Cloudflare Worker -- api_secret --> Google Analytics 4
                                         consent gate                                       allowlist check
                                         send at once                                       adds country, sends no IP
```

- The choice is stored in the app's own settings (`usageConsent`: `undecided`, `granted` or `declined`; `usageClientId`: a random UUID that exists only while granted). Undecided, declined and a dismissed dialog all send nothing.
- Each event goes out on its own as soon as it happens. There is no queue and no batching. Turning sharing off, or saving "No thanks", stops sending at once and cancels any request still in progress.
- The Worker in `usage-proxy/` accepts `POST /v1/events` with exactly one event, checks every name, parameter and value against `usage-events.json`, and builds a fresh request to the Google Analytics Measurement Protocol with only a `content-type` header. The app's IP address and headers are never forwarded. The Worker adds the country from Cloudflare's own lookup as `user_location.country_id` and sends `consent` with `ad_user_data` and `ad_personalization` set to `DENIED`.
- The endpoint is compiled in from `TAG_ASSET_MANAGER_USAGE_ENDPOINT`. Builds compiled without it never ask and never send: forks, and `pnpm tauri dev` unless the variable is set in that shell. A dev build compiled with it does ask and send, shares the installed GitHub copy's settings file and has no single-instance lock, so give it a separate identifier with `--config`. The official value is `https://usage.minhtran.id.vn/v1/events`.
- Both editions (GitHub and Microsoft Store) behave the same. They keep separate settings, so each has its own choice and its own random ID. The `edition` parameter tells them apart.

Every event carries `session_id`, `engagement_time_msec`, `app_version`, `edition` (`github` or `store`) and `operating_system` (`macOS`, `Windows` or `Linux`), plus the device category `desktop`.

## Event catalog

26 events, one name each, so counts show in GA's Events report with no setup. The last column is the wording in [the privacy policy's list of what is sent](privacy-policy.md#usage-data-only-if-you-say-yes) that covers the event; every phrase appears there word for word.

| Event | Group | Fires when | Extra param | Throttled | Privacy policy phrase |
|---|---|---|---|---|---|
| `app_open` | App opened | Launch with consent, or right after opting in | | No | `opening the app` |
| `tag_edit` | Feature | `editTags` succeeds | | No | `editing tags` |
| `bulk_tag_edit` | Feature | `bulkEditTags` commits at least one row | | No | `editing tags` |
| `tag_rename` | Feature | Rename apply commits at least one row | | No | `renaming tags` |
| `saved_search_save` | Feature | Saved search upsert succeeds | | No | `saving, using or deleting a saved search` |
| `saved_search_apply` | Feature | User applies a saved search | | No | `saving, using or deleting a saved search` |
| `saved_search_delete` | Feature | Saved search delete succeeds | | No | `saving, using or deleting a saved search` |
| `asset_preview` | Feature | The preview for the selected item shows an image or text, while the details panel is visible; once per selected item | | Yes | `previewing a file` |
| `metadata_export` | Feature | Backup export succeeds | | No | `exporting a backup` |
| `asset_reconnect` | Feature | Reconnect succeeds | | No | `reconnecting a file` |
| `missing_entry_remove` | Feature | Remove missing entry succeeds | | No | `removing a missing one` |
| `asset_trash` | Feature | Delete moves at least one item | | No | `moving items to Trash or the Recycle Bin` |
| `asset_open` | Feature | Native open succeeds | | No | `opening a file or folder` |
| `asset_reveal` | Feature | Native reveal succeeds | | No | `showing it in its folder` |
| `path_copy` | Feature | Full or relative path is copied | | No | `copying its path` |
| `library_add` | Library | The library list grows (a cancelled picker or an already added folder doesn't count) | | No | `adding, removing or switching libraries` |
| `library_remove` | Library | The library list shrinks | | No | `adding, removing or switching libraries` |
| `library_switch` | Library | User picks another library from the library list (adding a library doesn't count) | | No | `adding, removing or switching libraries` |
| `library_scanned` | Library | First completed scan per library per launch | `size_range` | No | `A rounded library size` |
| `folder_navigate` | Browsing | `navigateFolder` runs | | Yes | `moving between folders` |
| `search_used` | Browsing | Text typed into the search field leaves it non-empty for 2 s | | Yes | `using search` |
| `tag_filter_click` | Browsing | User clicks a tag to filter by it, in the sidebar, an item's tag list or the details panel | | Yes | `clicking a tag to filter` |
| `filter_change` | Browsing | Kind filter or match mode changes | | Yes | `using filters` |
| `sort_change` | Browsing | Sort key or direction changes | | Yes | `sorting` |
| `details_panel_close` | Browsing | User hides the details panel | | No | `hiding the details panel` |
| `theme_change` | Browsing | Theme commit succeeds | `theme` (preset name) | No | `changing theme, including which theme you picked` |

`size_range` values: `under_100`, `100_1k`, `1k_10k`, `10k_100k`, `over_100k`. `theme` values are the app's 20 theme presets, listed in `usage-events.json`.

## Reading the numbers in Google Analytics

- **Counts are lower bounds.** Events can be lost when the device is offline, when more than 4 sends are already in flight, or when the Worker's rate limit refuses them. Nothing records those losses.
- **Throttled events undercount further.** A throttled event is sent at most once every 10 seconds, so a user who sorts 30 times in 10 seconds counts once. The first event always goes through, so for throttled events compare **users per event**, not event counts. Throttle times are cleared each time sharing is turned on.
- **Only people who opted in are counted.** A decline sends nothing, so GA can't show the opt-in rate, and the numbers say nothing about people who said no or never answered.
- **GA users are not people.** Each opt-in, each machine and each reset of the app's data creates a new random ID, so one person can appear as several users. The two editions on one machine are two users.
- **`asset_preview` fires on selection.** It fires when an item is selected and its image or text preview shows, once per selected item, and only while the details panel is visible. It is not an explicit "preview" action.
- **`search_used` counts typing only.** Tag clicks, saved searches and tag-rename rewrites change the query too, but don't count as search.
- **`details_panel_close` can't happen at 1024 px or narrower**, and the panel starts open. Zero closes in a narrow-window audience doesn't mean the panel is unused.
- **`library_scanned` is sent once per library per launch**, on the first completed scan after sharing is on. Someone who opts in mid-session reports library size at the next launch.
- **Sessions** use `session_id` (Unix seconds at session start, renewed after 30 minutes idle) and `engagement_time_msec` (time since the previous event, clamped to 1 to 60,000).

Not tracked: notes editing, rescan, validate metadata, failures and consent declines.

Custom dimensions registered in GA as event-scoped: `edition`, `app_version`, `theme`, `size_range` and `operating_system`. Only data sent after a dimension is registered counts toward it.

## GA property settings

Set in Admin by the account owner:

- **Data retention** (Data collection and modification): event data and user data both 14 months, and **Reset user data on new activity** off, so the 14-month promise in the privacy policy holds.
- **Granular location and device data collection**: off.
- Google signals and ad personalization off, and no Google Ads link.

Standard aggregated reports aren't affected by the retention limit, as the privacy policy says.

## Operator runbook

All commands run from the repository root. Wrangler is pinned and run without adding it to the app's lockfile. pnpm 12 blocks the install scripts of `esbuild` and `workerd` unless they're allowed by name, which is what the two `--allow-build` flags do.

Worker settings are in `usage-proxy/wrangler.toml`:

| Setting | Value |
|---|---|
| Worker name | `tag-asset-manager-usage` |
| Public hostname | `usage.minhtran.id.vn` |
| `GA_MEASUREMENT_ID` | `G-3R72WXR2D5` |
| `FORWARD` | `on`. Kill switch, see below: only the exact value `on` forwards |
| Rate limit | `USAGE_RATE_LIMIT`, 600 requests per 60 seconds on one fixed key, approximate and per location |
| `workers_dev`, `preview_urls` | both `false` |
| Observability | off, because incoming requests carry client IPs and the outbound request URL carries the `api_secret`. The Worker has no `console` calls and logs nothing |

The Worker answers:

| Status | When |
|---|---|
| 204 | a valid event was forwarded and Google answered 2xx, or the kill switch dropped it |
| 400 | anything off-list or malformed |
| 404, 405 | another path or another method |
| 413 | a body over 8 KiB |
| 415 | a content type other than `application/json` |
| 429 | the rate limit refused it |
| 502 | Google couldn't be reached or answered with a non-2xx status |
| 503 | the Worker isn't configured: `GA_API_SECRET` is missing or empty, or `GA_MEASUREMENT_ID` isn't a `G-` ID |

Google's `/mp/collect` answers 2xx even for a wrong or revoked secret, so a 204 doesn't prove the event was counted. Only GA Realtime does. The app drops any failed event and doesn't retry. The Free plan allows 100,000 requests a day.

### Deploy the Worker

```sh
pnpm dlx --allow-build=esbuild --allow-build=workerd wrangler@4.154.0 deploy --config usage-proxy/wrangler.toml
```

Run `wrangler login` first in your own terminal (`pnpm dlx --allow-build=esbuild --allow-build=workerd wrangler@4.154.0 login`). Check the deployed Worker before publishing an app build that talks to it: send one valid event from `fixtures/usage-payload.json` and confirm it shows in GA Realtime.

### Set or rotate the GA API secret

`GA_API_SECRET` is a Worker secret. It never goes in `wrangler.toml`, in a command argument, in the repository or in chat. Run this in your own terminal and paste the value at its prompt:

```sh
pnpm dlx --allow-build=esbuild --allow-build=workerd wrangler@4.154.0 secret put GA_API_SECRET --config usage-proxy/wrangler.toml
```

To rotate:

1. Create a new Measurement Protocol API secret on the GA web stream.
2. Run the command above with the new value.
3. Send one valid event from `fixtures/usage-payload.json` and confirm it in GA Realtime. It can take a few minutes to show. A wrong secret still gets 204, so Realtime is the only check that the new value works.
4. Only then delete the old secret in GA. Until you do, putting the old value back undoes a bad rotation.

The secret lives only in the Worker, so rotating needs no app release.

### Stop data reaching Google (kill switch)

Set `FORWARD = "off"` in `usage-proxy/wrangler.toml` and deploy. Only the exact value `"on"` forwards; any other value, or a missing `FORWARD`, also stops forwarding, so a typo fails closed. The Worker still validates every event (an invalid one still gets 400) and answers 204 for the valid ones, but forwards nothing, even with no secret set. Set it back to `"on"` and deploy to resume. Installed copies can't be told to stop calling the Worker; this switch stops the data reaching Google instead. Change the value in the file, not only in the Cloudflare dashboard, or the next deploy overwrites it.

### Roll back a bad deploy

```sh
pnpm dlx --allow-build=esbuild --allow-build=workerd wrangler@4.154.0 versions list --config usage-proxy/wrangler.toml
pnpm dlx --allow-build=esbuild --allow-build=workerd wrangler@4.154.0 rollback <version-id> --config usage-proxy/wrangler.toml
```

Without a version ID, `rollback` picks the version uploaded before the latest one, and every `secret put` makes a new version, so name the version you want. A rollback restores that version's code and `[vars]`, including its `FORWARD` value: rolling back past a kill-switch deploy turns forwarding back on. Whether it also restores an older `GA_API_SECRET` isn't verified. After any rollback, check `FORWARD` in the restored version, send one valid test event and confirm it in GA Realtime. Then make `wrangler.toml` match what's deployed, or the next deploy undoes the rollback.

### Changing the allowlist

The allowlist (`usage-events.json`) only grows. Never remove or rename an event, theme or size range: copies already installed keep sending the old names, and the Worker would answer 400 and lose them. To add one:

1. Add it to `usage-events.json`, `fixtures/usage-payload.json`, the Rust `UsageEvent` and the frontend wrapper. The Worker test, a Rust test and a Vitest test all read these, so changing one side alone fails a test.
2. **Deploy the Worker first.** A new app copy would otherwise send events the deployed Worker rejects, and installed copies and the deployed Worker can't be updated together.
3. Only then merge and release the app.
4. Add the event to the table above, and to the privacy policy's list in the same release if its phrase doesn't already cover it.

### Build and release

- The endpoint comes from the repository variable `USAGE_ENDPOINT` (Settings, Secrets and variables, Actions, Variables). It isn't a secret. `release.yml` and `store-msix.yml` pass it to the build as `TAG_ASSET_MANAGER_USAGE_ENDPOINT`.
- `scripts/check-usage-endpoint.mjs` runs before both builds. In this repository the value must be exactly `https://usage.minhtran.id.vn/v1/events`, and empty fails, so a release can't ship without the dialog the privacy policy describes. In forks the variable is absent and the check passes, so forks stay silent.
- Date the privacy policy: replace `[release date]` at the top of [privacy-policy.md](privacy-policy.md) with the release date, and paste the same text in the Store submission in Partner Center. Check the listing and age rating answers for "no data collected" claims, which aren't in this repository.
- After each release, open the new version once with sharing on and confirm its `app_open` shows in GA Realtime with the new `app_version`. Observability is off, so an event the Worker rejects (for example one released before the Worker's allowlist) is otherwise lost without a trace. To see status codes, run `wrangler tail --config usage-proxy/wrangler.toml` in your own terminal and read it on screen only: its output holds client IPs, so don't save, paste or share it.

## Known limits

- **Test events are in the production property.** There's one GA property, and the Worker strips any parameter that could mark an event as a test, so acceptance events can't be filtered out later. The [progress log](progress-log.md) lists their time windows and client IDs; add a GA annotation for each window and treat the first release date as the start of real reporting.
- **Single instance on macOS isn't per user.** The single-instance plugin's lock socket is in `/tmp`, so with two macOS accounts signed in at once, the second account's copy can run without the lock (a reviewer finding from the plugin source, not tested). Each account has its own settings file, so this doesn't affect anyone's usage choice.

## Checking nothing is sent without consent

Start a packet capture before launching the app, with a positive control (a build with sharing on, to prove the capture sees the traffic). Perform tracked actions with sharing undecided, declined and after turning it off. There must be no connection to `usage.minhtran.id.vn`. Do this on macOS and on Windows before merge, and record the result in the [progress log](progress-log.md).
