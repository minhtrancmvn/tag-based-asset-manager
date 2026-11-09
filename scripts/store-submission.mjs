#!/usr/bin/env node
// Decides what .github/workflows/store-msix.yml does. It never changes anything in Partner Center.
//   node scripts/store-submission.mjs plan            -> mode, ref, tag and store_version outputs
//   node scripts/store-submission.mjs check <version> -> proceed output, from read-only Store API calls
//
// The check exists because `msstore publish` deletes any pending submission before creating
// its own (msstore-cli v0.4.4, IStorePackagedAPIExtensions.PublishAsync). A submission somebody
// started by hand, or one in certification, must stop the run instead of reaching that code.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const STORE_VERSION = /^\d+\.\d+\.\d+\.\d+$/;
const STORE_API = "https://manage.devcenter.microsoft.com/v1.0/my";
const STORE_SCOPE = "https://manage.devcenter.microsoft.com/.default";
const OIDC_AUDIENCE = "api://AzureADTokenExchange";

/** Store packages need four parts, and the fourth must be 0. */
export function storeVersionFromTag(tag) {
  const match = RELEASE_TAG.exec(tag);
  if (!match || match[0] !== tag) throw new Error(`Not a release tag: ${JSON.stringify(tag)}`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

export function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function highestReleaseTag(tags) {
  const valid = tags.filter((tag) => RELEASE_TAG.test(tag));
  if (!valid.length) return null;
  return valid.reduce((highest, tag) => (compareVersions(tag.slice(1), highest.slice(1)) > 0 ? tag : highest));
}

export function planRun({ eventName, submitInput, ref, productId, releaseTags }) {
  const build = (reason) => ({ mode: "build", ref: "", tag: "", storeVersion: "", reason });
  if (eventName === "pull_request") return build("Pull request: package only.");

  let automatic;
  if (eventName === "workflow_dispatch") {
    if (submitInput !== "true") return build("Manual run: package only.");
    automatic = false;
  } else if (eventName === "workflow_run" || eventName === "schedule") {
    automatic = true;
  } else {
    throw new Error(`Unexpected event ${eventName}`);
  }

  if (ref !== "refs/heads/main") throw new Error(`Store submissions run only from main, not ${ref}`);
  if (!productId) {
    const reason = "Store submission is not set up: the repository variable MSSTORE_PRODUCT_ID is empty. See docs/microsoft-store.md.";
    if (!automatic) throw new Error(reason);
    return { mode: "skip", ref: "", tag: "", storeVersion: "", reason };
  }
  const tag = highestReleaseTag(releaseTags);
  if (!tag) throw new Error("There is no release to submit");
  const storeVersion = storeVersionFromTag(tag);
  return { mode: "submit", ref: `refs/tags/${tag}`, tag, storeVersion, reason: `Submitting ${tag} as ${storeVersion}.` };
}

/** Whether `msstore publish` may run. Anything unknown stops it: the next run can try again, a deleted submission cannot be restored. */
export function decide({ version, pending, publishedPackages }) {
  if (pending && pending.status !== "CommitFailed") {
    return {
      proceed: false,
      reason: `Submission ${pending.id} is pending in Partner Center with status ${pending.status ?? "unknown"}, so ${version} was not submitted. The daily run tries again once it is published or deleted.`,
    };
  }
  const versions = publishedPackages
    .filter((entry) => entry.fileStatus !== "PendingDelete" && STORE_VERSION.test(entry.version ?? ""))
    .map((entry) => entry.version);
  if (!versions.length) throw new Error("Could not read a published package version from the Store API");
  const highest = versions.reduce((a, b) => (compareVersions(b, a) > 0 ? b : a));
  if (compareVersions(version, highest) <= 0) {
    return { proceed: false, reason: `The Store already has ${highest}, so ${version} was not submitted.` };
  }
  return { proceed: true, reason: `Submitting ${version}; the Store has ${highest}.` };
}

export function escapeCommand(message) {
  return message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

async function json(response, label, hint = "") {
  if (response.ok) return response.json();
  const detail = await response.json().then((body) => body.error_description ?? body.message ?? "").catch(() => "");
  throw new Error([`${label} failed with HTTP ${response.status}.`, detail, hint].filter(Boolean).join(" "));
}

/** Reads the app through the Store submission API, signing in with this job's GitHub OIDC token. GET only. */
export async function readStoreState({ fetchImpl = fetch, env = process.env }) {
  const missing = ["MSSTORE_TENANT_ID", "MSSTORE_CLIENT_ID", "MSSTORE_PRODUCT_ID"].filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing repository variables: ${missing.join(", ")}. See docs/microsoft-store.md.`);
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("No GitHub OIDC token available: this job needs the id-token: write permission.");
  }

  const oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  oidcUrl.searchParams.set("audience", OIDC_AUDIENCE);
  const oidc = await json(await fetchImpl(oidcUrl, { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } }), "Requesting the GitHub OIDC token");

  const entra = await json(
    await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(env.MSSTORE_TENANT_ID)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.MSSTORE_CLIENT_ID,
        scope: STORE_SCOPE,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: oidc.value,
      }).toString(),
    }),
    "Signing in to Microsoft Entra",
    "Check the app registration's federated credential.",
  );

  const headers = { Authorization: `Bearer ${entra.access_token}` };
  const application = `${STORE_API}/applications/${encodeURIComponent(env.MSSTORE_PRODUCT_ID)}`;
  const get = async (url) => json(await fetchImpl(url, { headers }), "Reading from the Store API", "Check MSSTORE_PRODUCT_ID and that the Entra app has the Manager role in Partner Center.");

  const app = await get(application);
  const pendingId = app.pendingApplicationSubmission?.id;
  const publishedId = app.lastPublishedApplicationSubmission?.id;
  const pending = pendingId ? { id: pendingId, status: (await get(`${application}/submissions/${encodeURIComponent(pendingId)}`)).status } : null;
  const published = publishedId ? await get(`${application}/submissions/${encodeURIComponent(publishedId)}`) : null;
  return { pending, publishedPackages: published?.applicationPackages ?? [] };
}

function output(env, lines) {
  if (!env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is not set; this command runs inside GitHub Actions");
  appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function summary(env, line) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function runPlan(env) {
  const plan = planRun({
    eventName: env.GITHUB_EVENT_NAME,
    submitInput: env.SUBMIT_INPUT,
    ref: env.GITHUB_REF,
    productId: env.MSSTORE_PRODUCT_ID,
    releaseTags: (env.RELEASE_TAGS ?? "").split(/\r?\n/),
  });
  output(env, [`mode=${plan.mode}`, `ref=${plan.ref}`, `tag=${plan.tag}`, `store_version=${plan.storeVersion}`]);
  console.log(plan.reason);
  summary(env, plan.reason);
}

async function runCheck(env, version) {
  if (!STORE_VERSION.test(version ?? "")) throw new Error(`Not a Store version: ${JSON.stringify(version)}`);
  const decision = decide({ version, ...(await readStoreState({ env })) });
  output(env, [`proceed=${decision.proceed}`]);
  console.log(decision.proceed ? decision.reason : `::warning title=Microsoft Store submission skipped::${escapeCommand(decision.reason)}`);
  summary(env, decision.reason);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, version] = process.argv.slice(2);
  try {
    if (command === "plan") {
      runPlan(process.env);
    } else if (command === "check") {
      await runCheck(process.env, version);
    } else {
      console.error("Usage: store-submission.mjs plan | check <store version>");
      process.exit(2);
    }
  } catch (error) {
    console.log(`::error title=Microsoft Store submission::${escapeCommand(error.message)}`);
    process.exit(1);
  }
}
