# Implementation Plan: Opt-in usage analytics in Google Analytics

Status: approved by the user on 2026-11-09, then amended the same day after consultation rounds 1 to 5 (`adr/usage-analytics/round-*/concerns.md`) and the user's decisions in between: send each event at once, 26 events, only one copy of the app, and no update while an opt-out isn't saved. No code written yet.

Design: `docs/design/usage-analytics.md`. ADR: `adr/usage-analytics.md`. Both files in this worktree are authoritative. The copies checkpointed in the main checkout's `.feature/state/` are the versions first approved and predate the amendments.

`$W` means `/Users/coffeemug/Programming/tag-based-asset-manager/.feature/worktrees/usage-analytics`. Every path below is under it unless it says otherwise.

## Rules for every task

- Branch `feature/usage-analytics`. Write the failing test first where a task names tests.
- Before editing an existing symbol, run GitNexus `impact` on it and report the result. Run `detect_changes` before each commit. Stop and tell the user on HIGH or CRITICAL. This worktree has no index yet, so run `analyze` inside it before T3, and pass `worktree` to these tools if the server started elsewhere.
- Agent calls send only `description`, `prompt`, `subagent_type` and `model`. Rust stays in the main session, because no Rust agent exists. Verify all agent output.
- Native checks use a disposable library and either a separate app identifier or, for the Store package on Windows, an isolated user account, because that package's identifier can't change. Never touch the user's real libraries or app data, or mutate `fixtures/sample-library/`.
- The GA secret never goes in chat, a command argument, a log or the repo.
- Local commits per wave on the feature branch. No push, PR, merge, release or Store upload without the user saying so.
- Commit `adr/usage-analytics.md`, `docs/design/usage-analytics.md` and this plan. Don't commit `.adr-session.json`, `task_plan_usage-analytics.md` or the consultation records in `adr/usage-analytics/`.
- Each Rust and Vitest gate shows that the named tests actually ran. A filter that matches nothing doesn't count.
- **Proof must be current.** Each proof (T17 Worker checks, T18 macOS, T21 Windows) records the commit SHA it ran at.
  - Before the merge go-ahead, T21 runs `git diff --exit-code <proof-sha> HEAD -- <paths>` for each proof. A non-empty diff means repeating that proof.
  - For T17, the paths are `usage-proxy/` and `usage-events.json`. Record its SHA after committing the `routes` edit.
  - For T18 and the Windows check, the paths are `src-tauri/` (all of it, including `Cargo.toml`, `Cargo.lock`, `build.rs` and `tauri.conf.json`), `src/`, `usage-events.json`, `fixtures/usage-payload.json`, `.github/workflows/`, `scripts/check-usage-endpoint.mjs`, `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `index.html` and `tsconfig*.json`.
  - This also covers a rebase onto a newer `main`.
- **One PR.** App code, privacy text and the build change (T16) merge together, in one pull request.

## Decisions made while planning

1. **Wire format.** The app sends `{client_id, device: {category, operating_system}, events: [one event]}`. The event's params are exactly `session_id`, `engagement_time_msec`, `app_version`, `edition`, `operating_system` and that event's extra param, if any. The Worker checks every field against the allowlist and adds `user_location` and `consent`. Free text has nowhere to go.
2. **Throttling lives in Rust**, so a frontend bug can't flood the network.
3. **`app_open` comes from Rust**, at launch with consent and right after opting in, so a webview reload can't double count.
4. **Each event is sent at once** (user decision, 2026-11-09). There is no queue and no timer, and at most 4 requests are in flight.
5. **The Worker is plain ESM with no npm dependencies**, tested with `node --test` like `scripts/*.test.mjs`. It's deployed with a pinned `pnpm dlx wrangler@<version>`, so the app's lockfile doesn't change.
6. **`path_copy` covers both copy actions**, full and relative path.
7. **Only one copy runs** (user decision, 2026-11-09), through `tauri-plugin-single-instance` in release builds, instead of any rule for a second copy.

## Gate S0: prove GA shows the data. Nothing below starts until this passes.

### S0.1: Test event script (done)
- **Agent**: main session
- **Duration**: 3 min
- **Files**: `.feature/state/usage-analytics-s0-test-event.mjs` in the main checkout (not in the repo)
- **Operations**: Node script. Takes the measurement ID and optional `--debug-only` and `--country=XX`, and reads the API secret from a hidden prompt. It validates against `/debug/mp/collect`, then sends one `test_event` to `/mp/collect` with `client_id`, `session_id`, `engagement_time_msec`, `user_location.country_id`, `device` (`desktop`, `macOS`), `consent` (both `DENIED`) and the params `app_version`, `edition`, `theme`, `size_range` and `operating_system`. It never prints the secret.
- **Verification**: Done 2026-11-09. `node --check` passes. Google's validator accepts the payload and rejects reserved names and invalid fields. The user's runs reached GA Realtime.
- **Parallel-safe**: true

### S0.2: GA setup and first event (Realtime done; reports pending)
- **Agent**: the user
- **Dependencies**: S0.1
- **Duration**: 10 min, plus GA processing time
- **Files**: none
- **Operations**: On the user's own GA account:
  - Create a property and a Web stream (done: property 563333501).
  - Set event data and user data retention to 14 months, and turn off **Reset user data on new activity**. Send a screenshot of the Data retention screen.
  - Leave Google signals and ad personalization off, with no Ads link.
  - Create a Measurement Protocol API secret, and run the script in their own terminal (done).
- **Verification**: Realtime showed the event, a user and Vietnam (done). Standard reports, checked 24 to 48 hours after the events, show event count, users, sessions and country. The retention screenshot shows both settings at 14 months with the reset switch off.
- **Parallel-safe**: false
- **If it fails or is partial**: stop, report what's missing and decide again with the user. Nothing else is built.

### S0.3: Custom dimensions report (event sent; reports pending)
- **Agent**: the user, with main session
- **Dependencies**: S0.1
- **Duration**: 5 min, plus GA processing time
- **Files**: the S0.1 script
- **Operations**: The user registers event-scoped custom dimensions `edition`, `app_version`, `theme`, `size_range` and `operating_system`, then reruns the script (done 2026-11-09, 3:04 PM).
- **Verification**: After processing, the Events report or an exploration breaks `test_event` down by each dimension, showing the values sent.
- **Parallel-safe**: true
- **If it fails**: dimensions that don't report are a design problem for the events that rely on them. Report and decide with the user. It doesn't by itself fail S0.

### S0.4: Country source and device data
- **Agent**: the user
- **Dependencies**: S0.1
- **Duration**: 5 min
- **Files**: the S0.1 script
- **Operations**: Run the script with `--country=JP`. Open the user snapshot. In Admin, Data collection, open the granular location and device data setting and note its state.
- **Verification**: The snapshot shows Japan, proving the country comes from `user_location` and not the sender's IP. Then, after processing, Reports > Tech > Tech overview shows desktop and macOS. If device data is missing with the granular setting off, turn it on and retest. If it's still missing, the `operating_system` param, already sent, is the source; record that.
- **Parallel-safe**: true

## Gate C: design consultation

`/feature-implement` requires `adr/usage-analytics/synthesis.md`, at that exact path, with verdict PROCEED before product code, because the ADR is Medium complexity.
- **Round 1:** NEEDS_CHANGES from all three reviewers.
- **Round 2:** stopped at the user's pause after one review.
- **Round 3:** NEEDS_CHANGES from all three, with a blocking defect in the second-copy rule, now replaced by single-instance behavior.
- **Round 4:** NEEDS_CHANGES from all three, with two blocking defects in the consent result and the not-saved dialog.
- **Round 5:** PROCEED from the contrarian and user-advocate lenses. NEEDS_CHANGES from meta-process, with nothing blocking.

This plan is amended for round 6, which reviews the changes since round 5. If S0 changes the design, the consultation runs again on the changed inputs.

## Wave 1: shared contract and Worker (depends on S0 and Gate C)

### T1: Allowlist and golden fixture
- **Agent**: main session
- **Dependencies**: S0.2, S0.3 (or the user's recorded decision on any dimension that doesn't report), S0.4, Gate C
- **Duration**: 4 min
- **Files**: `$W/usage-events.json`, `$W/fixtures/usage-payload.json`
- **Operations**:
  - `usage-events.json` holds these lists:
    - `events`: the 26 names in the design's catalog order: `app_open`, `tag_edit`, `bulk_tag_edit`, `tag_rename`, `saved_search_save`, `saved_search_apply`, `saved_search_delete`, `asset_preview`, `metadata_export`, `asset_reconnect`, `missing_entry_remove`, `asset_trash`, `asset_open`, `asset_reveal`, `path_copy`, `library_add`, `library_remove`, `library_switch`, `library_scanned`, `folder_navigate`, `search_used`, `tag_filter_click`, `filter_change`, `sort_change`, `details_panel_close`, `theme_change`.
    - `extraParams`: `theme_change` → `theme`, `library_scanned` → `size_range`.
    - `themes`: one per `AppTheme` variant in `src-tauri/src/backend.rs`, lowercase.
    - `sizeRanges`: `under_100`, `100_1k`, `1k_10k`, `10k_100k`, `over_100k`.
    - `editions`: `github`, `store`.
    - `operatingSystems`: `macOS`, `Windows`, `Linux`.
    - `commonParams`: `session_id`, `engagement_time_msec`, `app_version`, `edition`, `operating_system`.
  - `fixtures/usage-payload.json`: one request body per event, in the Decision 1 format. Use fixed values: `client_id` `00000000-0000-4000-8000-000000000000`, `session_id` `"1700000000"`, `engagement_time_msec` 1000, `app_version` `"1.2.3"`, `edition` `github`, `operating_system` `macOS`. `theme_change` uses `workshop` and `library_scanned` uses `1k_10k`.
- **Verification**: `node -e` confirms 26 unique names, none on Google's reserved list and each 40 characters or fewer, and that every fixture body uses only allowlisted values.
- **Parallel-safe**: true

### T2: Worker logic and tests
- **Agent**: `typescript-frontend-engineer` (model Sonnet)
- **Dependencies**: T1
- **Duration**: 5 min
- **Files**: `$W/usage-proxy/src/worker.mjs`, `$W/usage-proxy/worker.test.mjs`
- **Operations**: Write the tests first, then the Worker.
  - **Shape**: export a default object with `fetch(request, env)`. Import `../../usage-events.json` with `with { type: "json" }`.
  - **Routing**: only `POST /v1/events` is served. Other paths return 404 and other methods 405. Read the body with an 8 KiB cap; larger returns 413.
  - **Switch**: if `env.FORWARD === "off"`, return 204 after validation without forwarding.
  - **Validation**: anything that fails returns 400 with an empty body.
    - Top-level keys are exactly `client_id`, `device` and `events`.
    - `client_id` is a lowercase UUID.
    - `device` keys are exactly `category` (`desktop`) and `operating_system` (allowlist).
    - `events` holds exactly 1 event, with an allowlisted name.
    - Params are exactly the common params plus that event's extra param, and no other. `session_id` is digits only, `engagement_time_msec` an integer from 1 to 60000, and `app_version` matches `^\d+\.\d+\.\d+$`. `edition`, `operating_system`, `theme` and `size_range` come from the allowlist.
  - **Rate limit**: call `env.USAGE_RATE_LIMIT.limit({ key: "v1-events" })`, and return 429 if it isn't allowed.
  - **Forwarding**:
    - Build a new `Request` to `https://www.google-analytics.com/mp/collect`, with `env.GA_MEASUREMENT_ID` and `env.GA_API_SECRET` in the query string and only a `content-type: application/json` header. Never pass `request.headers` or the incoming request object.
    - Add `user_location.country_id` from `request.cf?.country`, omitted for missing, `XX` and `T1`.
    - Add `consent` with `ad_user_data` and `ad_personalization` `DENIED`. Never send `ip_override`.
    - Return 204 on a GA 2xx, and 502 otherwise, with an empty body.
  - **No leaks**: no `console` calls. Error responses never contain the secret or the upstream URL.
- **Verification**: `node --test 'usage-proxy/*.test.mjs'` exits 0, with tests for:
  - every rejection above, and nothing forwarded on rejection;
  - every body in `fixtures/usage-payload.json` accepted;
  - country handling;
  - the exact header set on the forwarded request (only `content-type`), sent with incoming `cf-connecting-ip`, `x-real-ip` and `x-forwarded-for`, none of which may appear;
  - no IP in the forwarded body;
  - the secret absent from responses;
  - the `FORWARD` switch.
- **Parallel-safe**: true (no shared files with T3)

### T3: Worker config, ignores and CI
- **Agent**: main session
- **Dependencies**: T2
- **Duration**: 4 min
- **Files**: `$W/usage-proxy/wrangler.toml`, `$W/.gitignore`, `$W/.github/workflows/windows-checks.yml`, `$W/docs/progress-log.md`
- **Operations**:
  - Add `.wrangler/` and `.dev.vars` to `.gitignore`.
  - Pick a Wrangler version published at least 14 days ago (`npm view wrangler time --json`). Record it as a comment in `usage-proxy/wrangler.toml` and in `docs/progress-log.md`, not in this plan, which is hash-bound to the consultation.
  - In `wrangler.toml`:
    - name `tag-asset-manager-usage`, `main = "src/worker.mjs"`, a pinned `compatibility_date`;
    - `workers_dev = false`, observability disabled;
    - `[vars] GA_MEASUREMENT_ID` set to the Web stream's ID and `FORWARD = "on"`;
    - a rate limit binding `USAGE_RATE_LIMIT` allowing 600 requests per 60 s.
  - Leave `routes` for T17.
  - In `windows-checks.yml`, change the "Release version script tests" step to a single `node --test 'scripts/*.test.mjs' 'usage-proxy/*.test.mjs'`, so its log isn't overwritten.
- **Verification**: `actionlint .github/workflows/windows-checks.yml` exits 0. `pnpm dlx wrangler@<version> deploy --dry-run --config usage-proxy/wrangler.toml` bundles with no error. `git status` shows no `.wrangler/` files.
- **Parallel-safe**: true

## Wave 2: Rust core (depends on Wave 1; sequential, shared files)

### T4: Module, dependencies and TLS
- **Agent**: main session
- **Dependencies**: T1
- **Duration**: 5 min
- **Files**: `$W/src-tauri/Cargo.toml`, `$W/src-tauri/Cargo.lock`, `$W/src-tauri/build.rs`, `$W/src-tauri/src/lib.rs`, `$W/src-tauri/src/usage.rs`, `$W/src-tauri/src/usage_tests.rs`
- **Operations**:
  - **Dependencies:** add direct dependencies at the versions already locked:
    - `reqwest` `0.13.5` with `default-features = false` and features `json` and `rustls-no-provider`;
    - `rustls` `0.23.46` with `default-features = false` and feature `ring`.
    No `tokio` dependency is needed, because nothing in Rust waits on a timer.
  - **Build:** in `build.rs`, add `cargo:rerun-if-env-changed=TAG_ASSET_MANAGER_USAGE_ENDPOINT`.
  - **Module:** in `lib.rs`, add `mod usage;` now, so later gates compile it.
  - **Lints:** start `usage.rs` with `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::indexing_slicing)]`. Declare the test module with the `#[path = "usage_tests.rs"]` pattern from `backend.rs:2190-2204`, with `#[allow]` for those lints.
  - **Client:** add an async `build_client()` that first installs the ring provider exactly as `tauri-plugin-updater` does at `updater.rs:579`:
    ```rust
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    ```
    It uses a 10 s timeout, and `ClientBuilder::build()` returns a `Result`.
- **Verification**:
  - `git diff src-tauri/Cargo.lock` adds no new packages.
  - `cargo tree --manifest-path src-tauri/Cargo.toml -i native-tls` and `-i openssl` find nothing.
  - The provider test builds the client with no prior provider. Because the provider is process-global, it runs alone (`cargo test ... usage::tests::client_builds_without_provider -- --exact`) and passes.
- **Parallel-safe**: false

### T4b: Single instance
- **Agent**: main session
- **Dependencies**: T4
- **Duration**: 5 min
- **Files**: `$W/src-tauri/Cargo.toml`, `$W/src-tauri/Cargo.lock`, `$W/src-tauri/src/lib.rs`, `$W/docs/progress-log.md`
- **Operations**:
  - Add `tauri-plugin-single-instance`, pinned to 2.5.5 or later, published at least 14 days ago (2.5.5 qualifies from 2026-11-11) and compatible with the locked `tauri` 2.12.1. Version 2.5.4 can leave a second process running on Windows. Check its docs for platform support and setup.
  - Register it first in the builder, under `#[cfg(not(debug_assertions))]`, so `pnpm tauri dev` can run beside an installed copy.
  - Its callback gets the main window, then shows, unminimizes and focuses it, ignoring failures.
  - Don't add anything to `capabilities/default.json`.
- **Verification**:
  - `git diff src-tauri/Cargo.lock` is reviewed, and the expected change is the plugin crate alone. `docs/progress-log.md` records the exact version, its checksum from `Cargo.lock`, the lock diff, and where the pinned source releases its lock on exit.
  - `cargo tree -i native-tls` and `-i openssl` still find nothing.
  - `cargo build --release` succeeds, and `cargo clippy --manifest-path src-tauri/Cargo.toml --release --all-targets -- -D warnings -A dead_code` exits 0, because the registration compiles only in release. The `-A dead_code` is needed only until T8, which wires `usage.rs` and runs this strictly. Don't add `#[allow(dead_code)]` to the code.
  - `git diff --exit-code main -- src-tauri/capabilities` exits 0.
  - The native check is in T18 and T21.
- **Parallel-safe**: false

### T5: Event type, payload and endpoint
- **Agent**: main session
- **Dependencies**: T4b
- **Duration**: 5 min
- **Files**: `$W/src-tauri/src/usage.rs`, `$W/src-tauri/src/usage_tests.rs`, `$W/src-tauri/src/app_updates.rs`
- **Operations**: Write the tests first, then the code.
  - **`UsageEvent`:**
    - A closed enum with the 26 variants, deserialized with `#[serde(tag = "name", rename_all = "snake_case", deny_unknown_fields)]`.
    - Payload-free variants are empty struct variants (`TagEdit {}`), because unit variants silently accept extra fields.
    - Only `ThemeChange { theme: AppTheme }` and `LibraryScanned { size_range: SizeRange }` carry data. No `String` field.
  - **`UsageConsent`:** `Undecided`, `Granted` or `Declined`, serialized lowercase, defined here for `backend.rs` to use.
  - **Payload builder:** produces the Decision 1 format.
    - `app_version` comes from `CARGO_PKG_VERSION`.
    - `edition` comes from `store_build()`; make it `pub(crate)`.
    - `operating_system` comes from an explicit map: `macos` → `macOS`, `windows` → `Windows`, `linux` → `Linux`. Any other OS sends nothing.
    - Version, edition and OS are injectable for tests.
  - **Endpoint:** `option_env!("TAG_ASSET_MANAGER_USAGE_ENDPOINT")`, trimmed, accepted only if it starts with `https://`, otherwise `None`. It is injectable for tests, because test builds have no endpoint.
- **Verification**: `cargo test usage` lists and passes tests for:
  - unknown name rejected;
  - extra field rejected on a payload-free event and on `theme_change`;
  - free-text theme rejected;
  - `http://` endpoint rejected;
  - each OS mapping, and an unknown OS giving no payload;
  - every event's payload equal to its body in `fixtures/usage-payload.json`, read with `include_str!`.
- **Parallel-safe**: false

### T6: Sending, sessions, throttle and the stopped flag
- **Agent**: main session
- **Dependencies**: T5
- **Duration**: 5 min
- **Files**: `$W/src-tauri/src/usage.rs`, `$W/src-tauri/src/usage_tests.rs`
- **Operations**: Write the tests first, with an injected clock, sender and endpoint.
  - **`UsageState`:**
    - Its own `Mutex`, never held while calling anything that locks `BackendState`.
    - It holds consent, client ID, a generation counter, an `Arc<AtomicUsize>` in-flight counter, throttle times, session data and an optional HTTPS client.
    - It also holds the shared `Arc<AtomicBool>` stopped flag, passed in by T8. Until then, tests create their own.
  - **`record(event)`:**
    - Does nothing unless consent is granted, the stopped flag is clear, and an endpoint and client ID exist.
    - Throttles `asset_preview`, `folder_navigate`, `search_used`, `tag_filter_click`, `filter_change` and `sort_change` to once per 10 s per event.
    - Sets `session_id` to Unix seconds, renewed after 30 minutes idle, and `engagement_time_msec` to the time since the previous event, clamped to 1 to 60,000.
    - Builds the payload under the lock, then reserves an in-flight slot with a guard type whose `Drop` decrements the counter. If 4 are already held, the event is dropped.
    - Releases the lock and spawns a send with `tauri::async_runtime::spawn`, moving the guard into the task.
  - **Send task:**
    - Gets the client, or builds one inside the task. A built client is stored back only if the generation is unchanged.
    - Rechecks the generation and the stopped flag just before sending.
    - Drops the event on any failure, with no retry, no surfaced error and nothing on disk. The guard frees the slot on every path.
  - **`stop()`:** sets the stopped flag, bumps the generation and drops the client. It leaves consent as granted, because the opt-out isn't saved yet.
  - **`mark_declined()`:** for a saved decline. It sets consent to declined, forgets the ID and clears the stopped flag.
  - **`start(id)`:** sets granted with that ID, clears the stopped flag, clears session data, throttle times and the previous-event time, and records `app_open`.
- **Verification**: `cargo test usage` lists and passes tests for:
  - no send when undecided, declined, stopped or the endpoint is absent;
  - throttle;
  - the in-flight limit;
  - four sends that fail or return early, then a fifth that goes out;
  - session renewal and the clamp;
  - a failure dropping the event;
  - `stop()` making a send that waits before its generation check send nothing, and leaving no stored client after a build that finishes later;
  - `start()` after `stop()` sending `app_open` with a new `session_id`, and the next throttled event going through;
  - `mark_declined()` leaving nothing able to send and the flag clear.
- **Parallel-safe**: false

### T7: Settings, consent persistence and `try_update`
- **Agent**: main session
- **Dependencies**: T6
- **Duration**: 5 min
- **Files**: `$W/src-tauri/src/backend.rs` and its existing test module
- **Operations**: Write the tests first. Run `impact` on `mutate`, `persist`, `search_state`, `load` and `LibraryState`. `persist`'s struct literal gains the two fields, but its logic and signature don't change, so the sidecar apply path's injected persister is untouched.
  - **Fields:** add `usage_consent` (`#[serde(default)]`, type `usage::UsageConsent`) and `usage_client_id: Option<String>` (`#[serde(default, skip_serializing_if = "Option::is_none")]`) to `PersistedSettings`, `Inner`, `load` and `persist`.
  - **Load rules:** `granted` without a valid UUID loads as `undecided`, and an ID stored with any other choice is dropped. An unrecognized consent value or a non-string ID loads as `undecided` with no ID, using a lenient `deserialize_with`, so it can't make `settings.json` unreadable.
  - **Stopped flag:** `load` creates the `Arc<AtomicBool>` in `Inner`. `pub(crate) fn usage_stop_flag(&self)` returns a clone, and `load`'s signature doesn't change.
  - **Rollback:** add both fields to the two `previous_*` restore paths in `mutate` (`backend.rs:421-425` and `:430-434`), next to `previous_theme` (`:416`).
  - **`try_update`:**
    - It shares one body with `mutate` (same `note_mutation` at entry and the same restore paths), differing only in taking the lock with `try_lock`.
    - On `WouldBlock`, it returns a busy result with nothing changed.
    - Its closure returns `Change(value)` or `Unchanged(value)`, and `Unchanged` skips `persist`.
  - **DTO:**
    - Add `usage: UsageSummary { available, consent, saved }` to `LibraryState` and to every place that builds it (`backend.rs:395`, `:589`, `:613`, `:640` and `search_state`).
    - `consent` is `declined` when the stopped flag is set and the stored choice is `granted`, and the stored choice otherwise.
    - `saved` is false only in that case.
    - The client ID is never in the DTO.
  - **`pub(crate) set_usage_consent_domain(state, requested)`:** runs entirely inside one `try_update`.
    - `Unchanged` if `requested` equals both the stored and the effective choice.
    - `granted`: sets granted with a new UUID.
    - `declined`: sets declined and removes the ID.
    - `undecided` is rejected.
    - It returns whether anything changed, the `LibraryState` for an unchanged choice, and, for `granted`, the new ID.
  - **Startup accessor:** `pub(crate) fn usage_settings(&self) -> (UsageConsent, Option<String>)`.
  - **Test helpers:** a `#[cfg(test)] pub(crate)` helper holds the backend lock on another thread until released, and a `#[cfg(test)] pub(crate)` accessor returns the current `LibraryState` for tests outside `backend`.
- **Verification**:
  - `cargo test --no-run` succeeds.
  - Then the full `cargo test`, including `tag_rename_tests`, lists and passes tests for:
    - legacy settings loading as `undecided`;
    - `granted` without an ID loading as `undecided`;
    - an unrecognized consent value, `null` and a non-string ID each loading as `undecided`, with libraries still loaded;
    - unknown fields surviving a write;
    - a failed write restoring the previous consent and ID;
    - a new ID on each change to granted;
    - `declined`, then saved, then `granted` on a real temp settings file leaving `granted` and a new ID on disk;
    - the same choice twice being a no-op with no write;
    - `try_update` with the lock held by the helper returning busy at once, with nothing changed;
    - the DTO reporting `declined` and `saved: false` when the flag is set over a stored `granted`, and `declined` and `saved: true` when it is set over a stored `declined`;
    - the serialized `LibraryState` containing no client ID.
- **Parallel-safe**: false

### T8: Wiring, commands and contract pin
- **Agent**: main session
- **Dependencies**: T7
- **Duration**: 5 min
- **Files**: `$W/src-tauri/src/lib.rs`, `$W/src-tauri/src/usage.rs`, `$W/src-tauri/src/usage_tests.rs`, `$W/fixtures/usage-consent-result.json`
- **Operations**:
  - **Setup:** in `setup`, after `BackendState::load`, give `UsageState` the backend's stopped flag and `.manage` it. Copy `usage_settings()` into it, and if granted, call `start` with the stored ID.
  - **`track_usage(event)`:** a synchronous command that calls `record` and returns `()`.
  - **`set_usage_consent(consent)`:**
    - The parameter must be named `consent`, because Tauri takes the argument key from the Rust parameter name and T9 invokes it with `{ consent }`.
    - Lives in `usage.rs`. A plain synchronous `pub fn`, like `set_app_theme`, so calls can't interleave.
    - Locks are taken one after the other, never nested, and the backend lock only through `try_update`.
    - It returns `{ status, usage?, reason? }`. `status` is `saved`, `busy`, `failed` or `stoppedNotSaved`. `reason` (`busy` or `failed`) is set only on `stoppedNotSaved`.
    - The command composes `usage` itself, after stopping or starting and without the lock:

      | Outcome | `usage` |
      |---|---|
      | Saved, granted | `{ consent: granted, saved: true }` |
      | Saved, declined | `{ consent: declined, saved: true }` |
      | Unchanged | The domain function's state |
      | `stoppedNotSaved` | `{ consent: declined, saved: false }` |
      | `busy`, `failed` | Absent |

    - **`declined` while `UsageState`'s consent is granted**, which includes a retry after `stoppedNotSaved`: call `stop()` first (repeating it is harmless), then the domain function. Busy or a failed write returns `stoppedNotSaved` with the matching reason. Success calls `mark_declined()` and returns `saved`.
    - **`declined` otherwise (never sharing):** call only the domain function. Busy returns `busy`, a failed write returns `failed`, and success calls `mark_declined()` and returns `saved`.
    - **`granted`:** call the domain function. Busy returns `busy`, a failed write returns `failed`, and success calls `start(new id)` and returns `saved`. If sending was stopped, it stays stopped on busy or failed.
    - **Same choice:** `Unchanged` returns `saved`.
  - Register both commands. Don't add anything to `capabilities/default.json`.
  - **Result fixture:** add `fixtures/usage-consent-result.json`, holding the exact JSON of a `saved`, `busy`, `failed` and `stoppedNotSaved` result. A Rust test serializes each result and compares; T9 reads the same file.
  - **Pin test:** read `../../usage-events.json` with `include_str!` and compare, in both directions, event names, extra params, themes, size ranges, editions, operating systems and common params with the Rust types and payload builder. Event names are compared through an exhaustive `match` on `UsageEvent`, so a new variant fails to compile until it's listed.
- **Verification**:
  - `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, the same with `--release`, and `cargo test` all exit 0, with no `allow(dead_code)` in `usage.rs`.
  - The pin test is listed and fails when a name is removed from either side.
  - An IPC test using `tauri::test::mock_builder` and `get_ipc_response` (precedent at `app_updates.rs:284`) sends `{"consent":"declined"}` through the real command handler and receives a result, so a wrong argument name fails.
  - Command-level tests use an injected sender and endpoint. Each one waits with `recv_timeout`, so a blocking regression fails instead of hanging:
    - with the lock held, each branch returns promptly: off while sharing and a retry give `stoppedNotSaved/busy`, no while undecided gives `busy`, on gives `busy`, and the same choice gives `busy`;
    - nothing is sent after `stoppedNotSaved`;
    - after the lock is released, retrying `declined` writes `declined` and removes the ID;
    - an injected write failure (a directory at the settings path, as `backend.rs:3256-3260` does) gives `stoppedNotSaved/failed` on off while sharing and on a retry, and `failed` on no while undecided;
    - `busy` and `failed` results carry no `usage`;
    - `declined` (saved), then `granted` sends one `app_open` with a new ID;
    - `granted` with a failed write, from undecided, declined and not-saved states, and `granted` with the lock held from the not-saved state, each return `busy` or `failed` with no `usage`, no send and the flag unchanged, and a following state agrees;
    - from a real `stop()`, both granted, declined (saved), granted and granted, declined with the lock held, granted after release return `{ consent: granted, saved: true }`, and a following state agrees.
  - `git diff --exit-code main -- src-tauri/capabilities src-tauri/tauri.conf.json` exits 0.
- **Parallel-safe**: false

## Wave 3: Frontend (depends on Wave 2; sequential, shared files)

### T9: Client, wrapper and contract tests
- **Agent**: `typescript-frontend-engineer` (model Sonnet)
- **Dependencies**: T8
- **Duration**: 5 min
- **Files**: `$W/src/types.ts`, `$W/src/native.ts`, `$W/src/native.test.ts`, `$W/src/usage.ts`, `$W/src/usage.test.ts`, `$W/src/useLibrary.test.tsx`
- **Operations**:
  - **Types:** add `usage?: { available: boolean; consent: "undecided" | "granted" | "declined"; saved: boolean }` to `LibraryState`, and the result type `{ status: "saved" | "busy" | "failed" | "stoppedNotSaved"; usage?: ...; reason?: "busy" | "failed" }`, where `usage` from the command needs only `consent` and `saved`.
  - **Client:** add to `LibraryClient` `setUsageConsent(consent)`, invoking `set_usage_consent` with `{ consent }`, and `trackUsage(event)`, invoking `track_usage` with `{ event }`.
  - **Contract rows:** add `src/native.test.ts` rows pinning both command names and argument names. Add the two methods to the typed client factory in `src/useLibrary.test.tsx:15-44`.
  - **Result pin:** add a `src/native.test.ts` test that reads `fixtures/usage-consent-result.json` and checks each result against the TypeScript result type's expected keys and values.
  - **`src/usage.ts`:**
    - an `as const` array of event definitions matching `usage-events.json`, with the `UsageEvent` union derived from it;
    - `sizeRange(count)`, bucketed as under 100, 100 to 999, 1,000 to 9,999, 10,000 to 99,999, and 100,000 up;
    - a `trackUsage` wrapper that catches and ignores every failure.
  - **`src/usage.test.ts`:** reads `usage-events.json` and `fixtures/usage-payload.json`. It fails if the array's names or extra params, or the `sizeRange` outputs, differ.
- **Verification**: `pnpm exec vitest run src/usage.test.ts src/native.test.ts` exits 0, with bucket boundaries covered. `pnpm exec tsc --noEmit` exits 0.
- **Parallel-safe**: false

### T10: Consent dialog
- **Agent**: `typescript-frontend-engineer` (model Sonnet)
- **Dependencies**: T9
- **Duration**: 5 min
- **Files**: `$W/src/components/UsageConsentDialog.tsx`, `$W/src/App.css`
- **Operations**: Build it like `src/components/RemoveLibraryDialog.tsx` (backdrop, `role="dialog"`, `aria-modal`, focus restore), with these differences.
  - **Props:** `mode` (`first` or `review`), `usage` (effective consent and `saved`), `saving`, `message` (a row of the design's messages table, or none), `onChoose(consent)`, `onClose()`.
  - **Text:** use the design's text exactly:
    - the first-ask body;
    - the review title, Currently line, review body and buttons for each row of the review states table;
    - the messages table.

    Both choice buttons are `secondary-button type="button"`, with the same size.
  - **Focus:** the container has `tabIndex={-1}` and takes focus on open, with a visible outline. The Tab cycle includes a branch for the container, so Shift+Tab from it lands on the last button. `RemoveMissingEntryDialog.tsx:39-50` shows the pattern.
  - **ARIA:** `aria-labelledby` points to the title, and `aria-describedby` to the body, including the Currently line in `review`.
  - **Escape:** in `first` mode it calls `onChoose("declined")`. In `review` mode, including the undecided row, it calls `onClose()`.
  - **Outside clicks:** in `first` mode they're ignored, and the backdrop's `onMouseDown` calls `event.preventDefault()`, so focus stays in the dialog (`SelectMenu.tsx:161,178` is the precedent). In `review` mode they call `onClose()`. `review` mode also has a close button.
  - **Saving:**
    - "Saving…" shows with `role="status"`.
    - Both choice buttons get `aria-disabled="true"` and ignore activation, so focus stays on the pressed button.
    - Escape, outside clicks and the close button are ignored, and the backdrop's `onMouseDown` calls `event.preventDefault()`.
  - **Messages:**
    - Show `message` with `role="alert"`, using the `.dialog-error` pattern from `BulkTagDialog.tsx:90`. Key it on an attempt counter, so each attempt re-mounts the alert and a repeated failure is announced again.
    - The message clears when a save starts and when the dialog opens.
    - The message sits above the buttons.
    - In `first` mode, a busy or failed message also shows a Close button calling `onClose()`, which takes focus. It goes on its own row or first in the row, so the choice buttons don't move. The undecided review row already has a close button, so it doesn't add one, and focus stays on the pressed button.
    - After `stoppedNotSaved`, the row's first button is **Save "off"**, in the position **Turn off** had, and focus moves to it explicitly.
    - Otherwise, focus stays on the pressed button.
- **Verification**: `pnpm exec tsc --noEmit` exits 0. Tests are in T13.
- **Parallel-safe**: false

### T11: Events and consent in `useLibrary`
- **Agent**: `typescript-frontend-engineer` (model Sonnet)
- **Dependencies**: T10
- **Duration**: 5 min
- **Files**: `$W/src/useLibrary.ts`, `$W/src/App.test.tsx`
- **Operations**: Run `impact` on each edited callback. Call `trackUsage` only after success:

  | Callback | Event | Condition |
  |---|---|---|
  | `editTags` | `tag_edit` | |
  | `bulkEditTags` | `bulk_tag_edit` | `result.assets.length > 0`, including partial results |
  | `applyTagRename` | `tag_rename` | `result.committed.length > 0` |
  | `saveSearch` | `saved_search_save` | |
  | `deleteSearch` | `saved_search_delete` | |
  | `exportMetadata` | `metadata_export` | result is non-null |
  | `reconnectAsset` | `asset_reconnect` | |
  | `removeMissingEntry` | `missing_entry_remove` | |
  | `deleteAssets` | `asset_trash` | `result.completedIds.length > 0` |
  | `performAction` | `asset_open`, `asset_reveal` or `path_copy` | returns true |
  | `chooseLibrary` | `library_add` | the library count grew |
  | `removeLibrary` | `library_remove` | the library count shrank |
  | `activateLibrary` | `library_switch` | the active library ID changed, comparing `stateRef` before and after |
  | `setTheme` | `theme_change` | with the theme |
  | `scan` | `library_scanned` | `sizeRange(result.assets.length)`; first completed scan per library per launch, tracked in a `Set` ref, and marked only when the effective consent is `granted` |

  Add `setUsageConsent(consent)` and `savingUsage`:
  - It's guarded only by `client.isDesktop` and an in-flight ref, not by `loading`, `scanBusy` or `operation.current`. It always calls native, because native never waits for the backend lock.
  - It returns native's result. It merges `usage` into state only when present, as `src/useLibrary.ts:401` does for theme, and never calls `applyState`.
  - A rejected `invoke` maps to `{ status: "failed" }` with no `usage`, and the dialog shows the row for what was requested, including "The app couldn't confirm the change. Try again." when turning off.
  - It never sets the hook's global `error`.
  - It needs no override: native reports the effective choice in every `LibraryState`.

  Add the new hook fields to the `useLibrary` mock defaults in `src/App.test.tsx`, so it still compiles.
- **Verification**: `pnpm exec tsc --noEmit` exits 0, and `pnpm exec vitest run src/App.test.tsx` passes unchanged. Tests are in T13.
- **Parallel-safe**: false

### T12: Events and UI in `App.tsx`
- **Agent**: `typescript-frontend-engineer` (model Sonnet)
- **Dependencies**: T11
- **Duration**: 5 min
- **Files**: `$W/src/App.tsx`, `$W/src/App.css`, `$W/src/components/AppUpdates.tsx`, `$W/src/components/AssetPreview.tsx`
- **Operations**: Run `impact` on `navigateFolder`, `changeSort`, `loadSavedSearch`, `addFilter`, `AppUpdates` and `AssetPreview`.
  - **Events:**
    - **`folder_navigate`:** in `navigateFolder`, after its guard.
    - **`sort_change`:** in `changeSort`.
    - **`saved_search_apply`:** in `loadSavedSearch`.
    - **`tag_filter_click`:** in the body of `addFilter` (`src/App.tsx:524`), not inside the `setQuery` updater, which `StrictMode` runs twice in development. Every caller of `addFilter` is a tag click:
      - the sidebar (`:785`, `:792`);
      - row tag lists (`:851`, through `TagEditor`'s `onFilter`);
      - the details panel (`:857`).
    - **`filter_change`:** only in the kind and match-mode `SelectMenu` `onChange` handlers (`:831`), not in an effect on state.
    - **`search_used`:** only from the search field's `onChange`, when the typed text stays non-empty for 2 s. It's a timer in `App.tsx` that sends no text.
    - **`details_panel_close`:** when the user hides the details panel.
    - **`asset_preview`:**
      - Add an optional `onShown(kind)` prop to `AssetPreview`, called from the image's `onLoad` and when text renders, never on error or for `unsupported`. It is optional so the existing tests still compile.
      - App fires `asset_preview` from it when `inspectorOpen` is true and `window.matchMedia("(max-width: 1024px)")` doesn't match (`src/App.css:711-714`), at most once per item ID until the selection changes.
      - Pass a stable callback, so scrolling doesn't reload the preview.
  - **`AppUpdates`:** add an optional `onOpenChange(open)` prop, so App knows when its dialog is open and the existing tests still compile.
  - **First ask:**
    - Open the dialog in `first` mode when `isDesktop`, `usage.available`, the effective consent is `undecided`, it hasn't been dismissed this session, and no other dialog is open, including the update dialog. Don't gate on `error`.
    - Once open, it stays open until a `saved` result, `onClose`, or quit. It isn't recomputed from consent.
  - **Choices:**
    - A choice saves through `setUsageConsent`. Each result shows the row of the design's messages table that matches its mode, status and reason.
    - `onClose` in `first` mode sets the session-only dismissal.
    - In `review` mode, **Keep sharing** and **Keep off** call `onClose`.
    - **Save "off"** sends `declined`.
  - **Topbar control:**
    - Add a **Usage data: On** / **Usage data: Off** button to `.topbar-right` (`src/App.tsx:807`), from the effective consent, when `usage.available`, outside `.topbar-info`.
    - While `usage.saved` is false, it reads **Usage data: Off (not saved)**.
    - It's a `quiet-button` with `aria-haspopup="dialog"`, opening `review` mode, and it's enabled during scans and other operations.
    - An always-mounted polite status region, `sr-only` and outside `.topbar-info`, announces only the saved rows' texts, and clears when the dialog opens.
  - **Status text:** when `usage.available` and the effective consent is granted, change the topbar text to "Local files · sharing usage data" and hide the offline dot. Otherwise leave both as they are.
  - **Busy and update gates:**
    - Add `savingUsage` to `busy`.
    - Add `savingUsage` and an open consent dialog to `updateBlockedReason` (`src/App.tsx:178-198`).
    - Add `usage.saved === false` too, with a reason pointing to **Save "off"** under **Usage data**, because a restart would turn sharing back on.
    - Add these new values to the `updateBlockedReason` dependency array (`src/App.tsx:198`). The repo has no ESLint to catch a missing one.
- **Verification**: `pnpm exec tsc --noEmit` and `pnpm build` exit 0. `git diff --exit-code main -- src-tauri/tauri.conf.json` exits 0.
- **Parallel-safe**: false

### T13: Frontend tests
- **Agent**: `typescript-frontend-engineer` (model Sonnet)
- **Dependencies**: T12
- **Duration**: 5 min
- **Files**: `$W/src/useLibrary.test.tsx`, `$W/src/App.test.tsx`
- **Operations**: Stub `window.matchMedia` in App tests. Add these tests.
  - **`useLibrary.test.tsx`:**
    - Each T11 event fires on success and not on failure, cancel or partial-zero.
    - A cancelled picker sends no `library_add`, and `chooseLibrary` never sends `library_switch`.
    - `setUsageConsent("declined")` reaches the client both with a deferred scan pending (the scan isn't restarted) and with the operation lock held.
    - A double click sends one call.
    - A `stoppedNotSaved` result merges `usage` (declined, unsaved), and a later `applyState` from a library switch carries native's value.
    - `busy` and `failed` results leave `usage` unchanged.
    - A saved decline followed by a busy **Turn on** doesn't reopen the first ask.
    - A rejected `invoke` gives `failed` with no `usage`.
    - No consent result sets the global `error`.
    - `library_scanned` isn't marked while undecided.
  - **`App.test.tsx`:**
    - **When it opens:**
      - The dialog opens once when undecided.
      - It doesn't open when unavailable, already decided, after dismissal, with the update dialog open, with `usage` absent, or in browser mode.
      - A scan error at load doesn't suppress it.
    - **Buttons and focus:**
      - Equal button classes; the container is focused on open.
      - Shift+Tab from the container lands on the last button.
      - `aria-describedby` covers the body and the Currently line.
    - **First mode:**
      - Escape saves `declined`, and an outside mouse-down makes no native call and is `defaultPrevented`.
      - A busy or failed result keeps the dialog open with the first-ask text, and Close takes focus and leaves the app usable. Close comes before the choice buttons in DOM order, or on its own row.
    - **Review mode:**
      - One test per row of the review states table.
      - In the undecided row, a busy or failed result keeps focus on the pressed button, and there is exactly one close control.
      - Escape, outside click and close make no native call, and **Keep sharing** and **Keep off** make no native call.
      - After `stoppedNotSaved`:
        - the first button is **Save "off"**, and it has focus;
        - pressing Enter calls native with `declined`;
        - **Turn on** reaches native;
        - no button is named "Try again".
      - Every review row's description contains "Google Analytics" and doesn't contain "at the top of the app".
    - **While saving:**
      - Buttons have `aria-disabled` and ignore clicks.
      - Focus stays on the pressed button.
      - Escape and outside clicks make no second call.
    - **Messages:** one test per row of the messages table, checking the dialog text and the status region, including that the not-saved rows announce nothing in the polite region. A message clears when a save starts and when the dialog reopens. A second identical failure re-mounts the alert. After "Usage data turned on.", opening the dialog clears the status region.
    - **Topbar:**
      - The button reads On, Off, or Off (not saved) from the effective consent and `saved`, and stays enabled during a pending scan.
      - The sharing text appears only when available and granted, including granted with `available: false`.
    - **Events:**
      - `search_used` carries no query text, asserted on the whole `trackUsage` call.
      - Tag clicks from the sidebar, a row and the details panel each send one `tag_filter_click` and no `search_used`.
      - Loading a saved search, **Clear active filter**, changing view and switching library send no `filter_change`.
      - An `unsupported` preview, a hidden panel, or the same item twice sends no `asset_preview`, and scrolling doesn't reload the preview.
    - **Install gate:** on one render, changing state in place, install is blocked during a consent save and while `usage.saved` is false, and allowed again after a saved retry.
- **Verification**: `pnpm test` exits 0, and the new test names appear with `--reporter=verbose`. Existing tests pass, including the CSP pin in `src/native.test.ts`.
- **Parallel-safe**: false

## Wave 4: Docs and build config (depends on Wave 3; parallel-safe)

### T14: Privacy policy and other text
- **Agent**: `technical-documentation-engineer` (model Sonnet)
- **Dependencies**: T13
- **Duration**: 5 min
- **Files**: `$W/docs/privacy-policy.md`, `$W/README.md`, `$W/docs/app-updates.md`, `$W/docs/microsoft-store.md`, `$W/docs/usage-analytics.md`, `$W/CLAUDE.md`
- **Operations**:
  - Replace `docs/privacy-policy.md` with Appendix A of `docs/design/usage-analytics.md`, word for word, leaving "[release date]" for the release.
  - Apply each row of Appendix B, including the new `docs/usage-analytics.md`, with the event catalog, how to read the numbers, and the runbook.
  - In `CLAUDE.md`, add to "Current implementation boundary" and "Architecture":
    - the analytics flow;
    - that `UsageState` and `BackendState` locks are never nested;
    - that `usage-events.json` and `fixtures/usage-payload.json` are pinned on all three sides;
    - that the allowlist only grows and the Worker deploys first.
    
    Also correct the line that calls notes editing deferred.
- **Verification**:
  - `grep -n "No analytics" docs/privacy-policy.md` finds nothing.
  - `diff` against the Appendix A text shows no differences apart from the date.
  - `docs/usage-analytics.md` has a table mapping each of the 26 events to its phrase in the policy's list, and every phrase exists in `docs/privacy-policy.md`.
- **Parallel-safe**: true

### T15: Test plan rows
- **Agent**: `technical-documentation-engineer` (model Sonnet)
- **Dependencies**: T13
- **Duration**: 4 min
- **Files**: `$W/docs/manual-test-plan.md`
- **Operations**: Add a "Usage data" section with these checks. State that each records the commit SHA it ran at and that jsdom results don't count. Each row runs on macOS (T18) and on Windows before merge (T21, Store package), unless it says otherwise.
  - **Upgrade (macOS):** the dialog appears once, on a disposable identifier with settings in the v0.7.1 shape (no usage fields). On Windows, the Store package's identifier can't change and an isolated account has no old settings, so this is covered by macOS and the T7 test.
  - **Single instance:** opening the app a second time brings the existing window forward and starts no second process (macOS: `open -n`; Windows: launch from Start twice).
  - **Layout:** **Usage data** and the dialog are readable at 820×600, including with a message showing.
  - **Keyboard and screen readers:**
    - Keyboard only: after a failed save, focus stays in the dialog, and Tab and Escape work.
    - At the first ask, click outside, then press Escape: it saves "no".
    - VoiceOver, and Narrator on Windows, read the title, Currently line and body, and announce each message. Run this with a large library still scanning. If scan progress talks over the dialog, drop `role="status"` from the scan row while the consent dialog is open.
  - **No connections:**
    - Undecided, after declining and after opting out, no connection is made to the endpoint while performing tracked actions: navigate folders, sort, click a tag, edit a tag.
    - The capture starts before launch, and opting in is the positive control.
  - **Sharing:** opting in sends `app_open`; opting out deletes `usageClientId` from `settings.json`.
  - **Opt-out not saved:**
    - With settings unwritable, opting out stops sending, the dialog says it isn't saved, and the topbar reads **Usage data: Off (not saved)**.
      - On macOS use `chmod a-w` on the app-data directory, or `chflags uchg` on the file, because the settings write replaces the file by rename.
      - On Windows use `attrib +R settings.json`. For the Store package it's under `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\com.tagbasedassetmanager.store\`.
    - Pressing **Save "off"** while still unwritable shows the not-saved message again.
    - After making it writable, **Save "off"** saves `declined`.
  - **Long operation:**
    - Use a disposable library large enough that Validate metadata runs for several seconds.
    - Start Validate, open **Usage data** and press **Turn off**.
    - Press **Save "off"** while Validate runs, including a double-click in the same spot and a repeated Enter.
    - Wait for Validate to finish, press **Save "off"** and relaunch.
    - The window stays responsive, **Turn on** never fires, and settings hold `declined` with no ID, and nothing connects.
  - **Opt-in after a decline:** declining at the first ask, then turning it on in review, sends `app_open`.
  - **Off, then on:** turning it off and back on in one session sends `app_open`, and the topbar reads **Usage data: On**.
  - **Service down:** with the endpoint unreachable, the app behaves normally.
  - **No endpoint (macOS only; on Windows this rests on T5's test):** a build without an endpoint shows no dialog or button.
  - **After release only (T22):**
    - The update block: on a real offered update of the GitHub edition, with an opt-out not saved, installing is blocked with the reason, and allowed after saving. No pre-merge build is offered an update, so before merge this rests on T13.
    - Update relaunch: at the first in-app update from a build carrying the plugin, the app relaunches, with one process running.
- **Verification**: `grep -n "Usage data" docs/manual-test-plan.md` shows the section with every check.
- **Parallel-safe**: true

### T16: Pass and check the endpoint in release builds
- **Agent**: main session
- **Dependencies**: T13
- **Duration**: 5 min
- **Files**: `$W/scripts/check-usage-endpoint.mjs`, `$W/scripts/check-usage-endpoint.test.mjs`, `$W/.github/workflows/release.yml`, `$W/.github/workflows/store-msix.yml`
- **Operations**:
  - **The script** reads `GITHUB_REPOSITORY` and `TAG_ASSET_MANAGER_USAGE_ENDPOINT`.
    - In `minhtrancmvn/tag-based-asset-manager`, it fails unless the value is exactly `https://usage.minhtran.id.vn/v1/events`. An empty value also fails.
    - Elsewhere it passes when the value is empty.
    - Write the tests first.
  - **`release.yml`:** add `TAG_ASSET_MANAGER_USAGE_ENDPOINT: ${{ vars.USAGE_ENDPOINT }}` to the build job's `env`, next to `TAURI_UPDATER_PUBLIC_KEY` (line 82), and run `node scripts/check-usage-endpoint.mjs` before the build.
  - **`store-msix.yml`:** add the same variable to the "Build Store executable" step's `env`, and run the same check before it, in a step with that variable in its own `env`.
  - The script's tests run in `windows-checks` through the existing `scripts/*.test.mjs` glob.
- **Verification**: `node --test scripts/check-usage-endpoint.test.mjs` passes `GITHUB_REPOSITORY` explicitly, because CI sets it to this repo, and covers these cases. `actionlint` on both workflows exits 0:
  - the exact value passes;
  - empty and wrong values fail in this repo;
  - empty passes elsewhere.
- **Parallel-safe**: true

## Wave 5: Deploy and prove it (depends on Wave 4)

### T17: Deploy the Worker
- **Agent**: the user, with main session
- **Dependencies**: T3, T16
- **Duration**: 20 min
- **Files**: `$W/usage-proxy/wrangler.toml`, `$W/docs/progress-log.md`
- **Operations**:
  - Add `usage.minhtran.id.vn` as a custom domain in `routes`. It's on the user's own Cloudflare account, which the user confirmed on 2026-11-09.
  - The user runs `pnpm dlx wrangler@<version> login` and `pnpm dlx wrangler@<version> secret put GA_API_SECRET --config usage-proxy/wrangler.toml` in their own terminal.
  - After committing the `routes` edit, record the commit SHA in `docs/progress-log.md`.
  - Deploy with `pnpm dlx wrangler@<version> deploy --config usage-proxy/wrangler.toml`.
  - **Header check**: deploy a throwaway Worker on the same account that forwards a test request, built the same way as T2's, to a public header-echo service. Record which IP headers arrive, then delete it.
  - Set the repository variable `USAGE_ENDPOINT` to `https://usage.minhtran.id.vn/v1/events` only after every check below passes.
- **Verification**:
  - `curl` with an off-list event returns 400; GET returns 405.
  - A fixture body returns 204 and shows in GA Realtime with the right country.
  - The header echo shows no address of the test machine in `cf-connecting-ip`, `x-real-ip` or `x-forwarded-for`.
  - With `FORWARD = "off"` redeployed, a fixture body returns 204 and doesn't reach Realtime. Then switch it back.
  - The rate limit binding deploys on the account's plan.
  - Cloudflare shows no request logs.
- **Parallel-safe**: false

### T18: Native proof on macOS
- **Agent**: main session
- **Dependencies**: T17
- **Duration**: 30 min
- **Files**: `$W/docs/progress-log.md` (summary only)
- **Operations**: Record the commit SHA. Build with `pnpm tauri build --bundles app --config <override setting the identifier to com.tagbasedassetmanager.usagecheck>`, so the plugin is included and `open -n` has a `.app`. Use a disposable library on a scratch disk image and settings in the v0.7.1 shape.
  - **Listener build:** endpoint `https://127.0.0.1:<port>/v1/events`, with a local TCP listener started before launch that logs every connection attempt. In each window below, perform tracked actions: navigate folders, sort, click a tag, edit a tag.
    - Undecided, after declining, and after opting out: zero connections.
    - Positive control: opting in makes a connection.
    - With TLS failing, the app stays responsive and shows no error.
  - **Opt-in after a decline:** decline at the first ask, then turn it on in review; a connection appears.
  - **Off, then on:** turn it off and back on in one session. The topbar reads **Usage data: On**, and a connection appears.
  - **Read-only:**
    - Make the app-data directory read-only (`chmod a-w`) and opt out. Confirm the not-saved message, the **Off (not saved)** label, and that the listener sees nothing afterwards.
    - Press **Save "off"** while still read-only, and confirm the message shows again.
    - Make it writable, press **Save "off"**, then relaunch: `settings.json` holds `declined` with no `usageClientId`, and nothing connects.
  - **Long operation:** run the T15 long-operation row, on a disposable library large enough for Validate to take several seconds.
  - **Stray click:** at the first ask, click outside, then press Escape; it saves "no".
  - **Single instance:** run `open -n` on the release build while it's running; no second process stays, and the window comes forward.
  - **No-endpoint build:** no dialog or button, and `strings` on the binary finds no usage host.
  - **Real-endpoint build:** opt in, use several features, and check GA Realtime for the right event names and `edition`.
  - **Layout and accessibility:** check the button and dialog at 820×600, check focus with the keyboard after a failure, and run VoiceOver over the dialog and each message at 820 px wide, with a large library still scanning for the first ask, so the status region is proven at a narrow width.
  - Remove the test app data afterwards.
- **Verification**: listener logs and screenshots are saved to the scratchpad and summarized in `docs/progress-log.md`. The summary lists the SHA, the actions performed in each window, the failure method used, and each check passing.
- **Parallel-safe**: false

### T19: Independent review
- **Agent**: `reviewer-config-safety`, `reviewer-silent-failures`, `reviewer-skeptical-senior` (model Opus)
- **Dependencies**: T18
- **Duration**: 5 min each, in parallel
- **Files**: the branch diff
- **Operations**: Each reviews `git diff main...HEAD` against `adr/usage-analytics.md`.
  - **Config safety**: the secret, workflow variables, the endpoint check, Worker config, CSP and capabilities.
  - **Silent failures**: that analytics failures stay harmless while real errors aren't hidden.
  - **Skeptical senior**: consent bypasses, data leaks into events or headers, a panic path under `panic = "abort"`, and lock use against `BackendState`.

  Fix confirmed findings, then follow the "Proof must be current" rule.
- **Verification**: findings are saved to the scratchpad and summarized for the user, with each one fixed or explained.
- **Parallel-safe**: true

### T20: Full local gates
- **Agent**: main session, with the user for the secret scan
- **Dependencies**: T19
- **Duration**: 10 min
- **Files**: none
- **Operations**:
  - Run everything in order:
    - `pnpm build`, `pnpm test`, and `node --test 'scripts/*.test.mjs' 'usage-proxy/*.test.mjs'`;
    - `cargo fmt --check`, strict `cargo clippy` in both debug and `--release`, and `cargo test`;
    - `actionlint` on all workflows;
    - `git diff --exit-code main...HEAD -- src-tauri/capabilities/default.json src-tauri/tauri.conf.json`;
    - `detect_changes` against `main`.
  - **Secret scan**: the user runs a scratchpad script that reads the GA secret from a hidden prompt and searches tracked files, git history and the T18 build outputs, printing only match counts.
  - Three fixture scan tests are known to fail only in a dirty main checkout; this worktree should pass them.
- **Verification**: every command exits 0, with counts reported, and the secret scan reports zero matches.
- **Parallel-safe**: false

## Wave 6: Ship, only when the user says so

### T21: PR, Windows check before merge, merge and release
- **Agent**: main session, with the user
- **Dependencies**: T20
- **Duration**: 1 hour, plus CI
- **Files**: `$W/docs/privacy-policy.md`, `$W/docs/progress-log.md`
- **Operations**:
  - **PR:** on the user's go-ahead, push and open one PR. Its title names both user-visible changes (the usage data question, and opening the app again brings the window forward), because the generated release notes shown in the update dialog come from PR titles. Wait for Windows checks and the Store package run, which builds the test-signed packages with the endpoint because T5 and T16 touch its paths.
  - **Isolation first:** run `Get-AppxPackage *Tag-basedAssetManager*`.
    - The test-signed package carries the production Store identity, so it would update an installed Store copy in place, on real settings.
    - If one is installed, run the check in a separate Windows user account, and rerun `Get-AppxPackage` inside it first.
    - Otherwise, record the user's explicit exception, after telling them an in-place update can only be undone by uninstalling, which removes that copy's settings.
  - **Windows check:** the user installs the PR's `store-msix-test-signed` package and runs the T15 checks, recording the commit SHA.
    - Connection capture uses `pktmon` as administrator, started before launch.
    - For the zero-connection windows, pin `usage.minhtran.id.vn` to the reserved address `192.0.2.1` in `hosts` and filter that address, plus DNS (port 53) for the name. The host is a shared Cloudflare proxy, so its real addresses can carry other sites' traffic and give false alarms. The opt-in positive control then shows attempts to `192.0.2.1` alone.
    - Perform tracked actions in each window. Run the **Sharing** row with the pin removed.
    - Results go in `docs/progress-log.md` on the branch, listing every T15 row with its platform, artifact and result or the reason it doesn't apply, plus the failure method, the settings path, the isolation used, the `hosts` pin and the cleanup.
    - Afterwards, remove the `hosts` entry, the `pktmon` filters, the test package and the test certificate, following `docs/microsoft-store.md:41` and the STORE-10 row.
  - **Proof currency:** for T17, T18 and the Windows check, run the "Proof must be current" diff. Repeat any proof whose paths changed.
  - **Merge:** on a separate go-ahead, set the policy's release date, then merge. The `feat` commit makes a minor release.
  - **After release:**
    - macOS: mount the DMG, and check that the app binary contains `usage.minhtran.id.vn` and no other usage host.
    - Windows: check the installed or extracted exe from the NSIS installer, in the isolated account, the same way.
- **Verification**: the Windows results and proof SHAs are recorded before the merge. The Release run is green, the published policy URL shows the new text, and the artifact check passes.
- **Parallel-safe**: false

### T22: After release, then Store submission
- **Agent**: the user, with main session
- **Dependencies**: T21
- **Duration**: 30 min, plus certification
- **Files**: `$W/docs/progress-log.md`
- **Operations**:
  - **GitHub edition, Windows:** run the GitHub installer in the isolated Windows account with the same capture.
  - **Own copies:** the user decides whether to opt in on their own installed macOS or Windows copies. That's their real app data, so only they choose.
  - **Update block:** on the GitHub edition, when a real update is offered and an opt-out isn't saved, installing is blocked with the reason, and allowed after saving. Use the isolated Windows copy, or the user's own copy by their explicit choice.
  - **Store submission:**
    - Wait until Submission 2 (`0.7.0.0`) has finished certification.
    - Build the Store package from main and verify it.
    - The user uploads it as a new submission, pastes the new policy into Partner Center, and checks the listing and age rating answers for "no data collected" claims.
  - **Update relaunch:** the next release after this one is the first update from a build carrying the plugin. Updating must relaunch, with one process running, on macOS and Windows.
    - On Windows, keep the isolated copy installed until then.
    - On macOS, a published build has the production identifier, so use a separate macOS account, or the user's own copy by their explicit choice.
  - **Recording:** any merge makes another release, so record these results with the next ordinary PR rather than a PR of their own.
- **Verification**: real events from published GitHub and Store builds appear in GA with the right `edition`, and the results are recorded.
- **Parallel-safe**: false

## Success Criteria

1. A new install, or an existing one after updating, asks once. Escape and No thanks save "no", and the app makes no connection to the analytics service. A failed save never traps the user, and they're asked again next time.
2. Looking at the choice never changes it. Saving the same choice again doesn't create a new user in GA. Someone who said no can later turn sharing on, and it works. What the app shows always matches what it is doing.
3. A user who says yes sees their events in GA within minutes, by name, with country, app version and edition.
4. A user who turns it off stops sending at once, even if the choice can't be saved, and is offered a working retry. A repeated click can't turn sharing back on. An in-app update can't restart sharing while the choice isn't saved. The random ID is gone from `settings.json` once the choice is saved.
5. Only one copy of the app runs. Opening it again brings the existing window forward.
6. The **Usage data** control is visible at the narrowest window width, shows On or Off in words, and works during scans and long operations without freezing the window.
7. A file name, path, tag, note, search term or library ID can't reach GA. Rust refuses anything off the list, and the Worker independently rejects it.
8. Google never receives a user's IP address, in the body or in headers.
9. The GA secret exists only in Cloudflare: it isn't in the repo, the binaries, logs or chat.
10. Builds without an endpoint (forks, development) show no dialog and make no connection. Release builds in this repository can't be made without the official endpoint.
11. If the service or network is down, the app behaves exactly as it does today, with no error, delay or crash.
12. The published privacy policy matches what the release does, on the date that release ships.
13. GitHub and Store builds behave the same, confirmed on macOS before merge, on Windows before merge for the Store package, and after release for the GitHub installer.

## Requirements Coverage Matrix

| # | Requirement from the design | Covered by | Status |
|---|---|---|---|
| R1 | Nothing leaves until yes | T6, T8, T12, T13, T18, T21 | COVERED |
| R2 | Ask once, equal choices | T10, T12, T13, T15 | COVERED |
| R3 | See and change later from a control visible at every width; looking never changes it | T7, T10, T12, T13, T18 | COVERED |
| R4 | Turning off stops at once even if unsaved; deletes ID once saved | T6, T7, T8, T13, T18 | COVERED |
| R5 | Only one copy runs | T4b, T15, T18, T21 | COVERED |
| R6 | Both editions behave the same | T5, T16, T21, T22 | COVERED |
| R7 | Fixed list; sensitive data can't be represented | T1, T2, T5, T8, T9, T13 | COVERED |
| R8 | `api_secret` never ships; Google never gets IPs | S0.1, T2, T17, T19, T20 | COVERED |
| R9 | Analytics can't crash, block or slow the app | T4, T6, T7, T8, T9, T11, T12, T13, T18, T19 | COVERED |
| R10 | Privacy text and claims change in the same release | T12, T14, T15, T21, T22 | COVERED |
| R11 | Crash reporting out of scope | No task adds it; T19 checks the diff | COVERED |
| S0 | Prove GA shows Measurement Protocol data first | S0.1 to S0.4 | COVERED |
| Build | Endpoint only the official value in this repo's release builds | T3, T16, T21 | COVERED |
| Docs | Reading the numbers, runbook | T14 | COVERED |
| Gates | Local proof is complete and current | T20, T21, plus the "Proof must be current" rule | COVERED |

## File conflicts

- **Wave 1:** T2 and T3 touch different files.
- **Wave 2:** T4 to T8 share `usage.rs`, `lib.rs` and the `Cargo` files, so they run in order: T4, T4b, T5, T6, T7, T8.
- **Wave 3:** T9 to T13 share `App.test.tsx`, `useLibrary.test.tsx`, `useLibrary.ts`, `App.tsx` and `App.css`, so they run in order: T9, T10, T11, T12, T13.
- **Wave 4:** T14, T15 and T16 touch different files.

## Not covered by this plan

Crash reporting, automatic Store submission, a settings screen, notes editing, rescan and validate-metadata events, and any legal review of the policy.
