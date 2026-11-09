import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { compareVersions, decide, escapeCommand, highestReleaseTag, planRun, readStoreState, storeVersionFromTag } from "./store-submission.mjs";

describe("storeVersionFromTag", () => {
  it("adds the Store revision to a release tag", () => {
    assert.equal(storeVersionFromTag("v0.7.1"), "0.7.1.0");
  });

  it("rejects anything that is not a release tag", () => {
    for (const tag of ["0.7.1", "v0.7", "v0.7.1-rc1", "v0.7.1\n", "", "refs/tags/v0.7.1"]) {
      assert.throws(() => storeVersionFromTag(tag), /release tag/, JSON.stringify(tag));
    }
  });
});

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    assert.ok(compareVersions("0.10.0.0", "0.9.0.0") > 0);
    assert.ok(compareVersions("0.7.0.0", "0.7.1.0") < 0);
    assert.equal(compareVersions("0.7.0.0", "0.7.0.0"), 0);
  });
});

describe("highestReleaseTag", () => {
  it("picks the highest version whatever the order", () => {
    assert.equal(highestReleaseTag(["v0.9.0", "v0.10.0", "v0.2.5"]), "v0.10.0");
  });

  it("ignores tags that are not releases", () => {
    assert.equal(highestReleaseTag(["nightly", "v9.9.9-rc1", "", "v0.7.1"]), "v0.7.1");
  });

  it("returns null without a release", () => {
    assert.equal(highestReleaseTag(["nightly"]), null);
    assert.equal(highestReleaseTag([]), null);
  });
});

describe("planRun", () => {
  const main = "refs/heads/main";
  const tags = ["v0.7.0", "v0.7.1"];

  it("only builds for pull requests, even when submission is configured", () => {
    const plan = planRun({ eventName: "pull_request", ref: "refs/pull/1/merge", productId: "9NABC", releaseTags: tags });
    assert.equal(plan.mode, "build");
    assert.equal(plan.ref, "");
  });

  it("only builds for a manual run without submit, from the selected branch", () => {
    const plan = planRun({ eventName: "workflow_dispatch", submitInput: "false", ref: "refs/heads/some-branch", productId: "9NABC", releaseTags: tags });
    assert.equal(plan.mode, "build");
    assert.equal(plan.ref, "");
  });

  for (const eventName of ["workflow_run", "schedule"]) {
    it(`submits the highest release on ${eventName}`, () => {
      assert.deepEqual(planRun({ eventName, ref: main, productId: "9NABC", releaseTags: tags }), {
        mode: "submit",
        ref: "refs/tags/v0.7.1",
        tag: "v0.7.1",
        storeVersion: "0.7.1.0",
        reason: "Submitting v0.7.1 as 0.7.1.0.",
      });
    });

    it(`does nothing on ${eventName} until the product ID is configured`, () => {
      const plan = planRun({ eventName, ref: main, productId: "", releaseTags: tags });
      assert.equal(plan.mode, "skip");
      assert.match(plan.reason, /MSSTORE_PRODUCT_ID/);
    });
  }

  it("submits on a manual run with submit", () => {
    assert.equal(planRun({ eventName: "workflow_dispatch", submitInput: "true", ref: main, productId: "9NABC", releaseTags: tags }).mode, "submit");
  });

  it("fails a manual submit when nothing is configured", () => {
    assert.throws(() => planRun({ eventName: "workflow_dispatch", submitInput: "true", ref: main, productId: "", releaseTags: tags }), /MSSTORE_PRODUCT_ID/);
  });

  it("refuses to submit from anything but main", () => {
    assert.throws(() => planRun({ eventName: "workflow_dispatch", submitInput: "true", ref: "refs/heads/some-branch", productId: "9NABC", releaseTags: tags }), /main/);
  });

  it("fails when there is no release to submit", () => {
    assert.throws(() => planRun({ eventName: "schedule", ref: main, productId: "9NABC", releaseTags: [] }), /release/);
  });

  it("rejects an event it does not know instead of submitting", () => {
    assert.throws(() => planRun({ eventName: "push", ref: main, productId: "9NABC", releaseTags: tags }), /push/);
  });
});

describe("decide", () => {
  const published = [{ version: "0.7.0.0", fileStatus: "Uploaded" }];

  it("proceeds when nothing is pending and the version is newer", () => {
    assert.equal(decide({ version: "0.7.1.0", pending: null, publishedPackages: published }).proceed, true);
  });

  // msstore publish deletes any pending submission, so these must never reach it.
  for (const status of ["PendingCommit", "CommitStarted", "PreProcessing", "Certification", "Release", "PendingPublication", "Publishing", "PreProcessingFailed", "CertificationFailed", "ReleaseFailed", "PublishFailed", "None", "Canceled", "SomethingNew"]) {
    it(`skips when a submission is pending in status ${status}`, () => {
      const decision = decide({ version: "0.7.1.0", pending: { id: "115", status }, publishedPackages: published });
      assert.equal(decision.proceed, false);
      assert.match(decision.reason, /115/);
      assert.match(decision.reason, new RegExp(status));
    });
  }

  it("skips when a pending submission has no readable status", () => {
    assert.equal(decide({ version: "0.7.1.0", pending: { id: "115" }, publishedPackages: published }).proceed, false);
  });

  it("proceeds over a pending submission whose commit failed", () => {
    assert.equal(decide({ version: "0.7.1.0", pending: { id: "115", status: "CommitFailed" }, publishedPackages: published }).proceed, true);
  });

  it("still checks the version over a failed commit", () => {
    assert.equal(decide({ version: "0.7.0.0", pending: { id: "115", status: "CommitFailed" }, publishedPackages: published }).proceed, false);
  });

  it("skips an equal version", () => {
    const decision = decide({ version: "0.7.0.0", pending: null, publishedPackages: published });
    assert.equal(decision.proceed, false);
    assert.match(decision.reason, /0\.7\.0\.0/);
  });

  it("skips a lower version", () => {
    assert.equal(decide({ version: "0.6.9.0", pending: null, publishedPackages: published }).proceed, false);
  });

  it("compares against the highest package", () => {
    const packages = [{ version: "0.8.0.0", fileStatus: "Uploaded" }, { version: "0.6.0.0", fileStatus: "Uploaded" }];
    assert.equal(decide({ version: "0.7.0.0", pending: null, publishedPackages: packages }).proceed, false);
  });

  it("ignores packages marked for deletion", () => {
    const packages = [{ version: "0.8.0.0", fileStatus: "PendingDelete" }, { version: "0.6.0.0", fileStatus: "Uploaded" }];
    assert.equal(decide({ version: "0.7.0.0", pending: null, publishedPackages: packages }).proceed, true);
  });

  it("fails closed when no published version can be read", () => {
    assert.throws(() => decide({ version: "0.7.1.0", pending: null, publishedPackages: [] }), /published/);
    assert.throws(() => decide({ version: "0.7.1.0", pending: null, publishedPackages: [{ fileStatus: "Uploaded" }] }), /published/);
  });
});

describe("escapeCommand", () => {
  it("keeps a message on one workflow command line", () => {
    assert.equal(escapeCommand("100%\r\nnext"), "100%25%0D%0Anext");
  });
});

describe("readStoreState", () => {
  const env = {
    MSSTORE_TENANT_ID: "tenant-1",
    MSSTORE_CLIENT_ID: "client-1",
    MSSTORE_PRODUCT_ID: "9NABC",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id?api-version=2",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token",
  };
  const app = "https://manage.devcenter.microsoft.com/v1.0/my/applications/9NABC";

  function fakeFetch(routes) {
    const calls = [];
    const impl = async (url, init = {}) => {
      const key = String(url).split("?")[0];
      calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
      const route = routes[key];
      if (!route) throw new Error(`Unexpected request to ${key}`);
      return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
    };
    impl.calls = calls;
    return impl;
  }

  const auth = {
    "https://token.actions.example/id": { body: { value: "github-oidc-jwt" } },
    "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token": { body: { access_token: "store-token" } },
  };

  it("returns the pending submission and the published packages", async () => {
    const fetchImpl = fakeFetch({
      ...auth,
      [app]: { body: { pendingApplicationSubmission: { id: "2" }, lastPublishedApplicationSubmission: { id: "1" } } },
      [`${app}/submissions/2`]: { body: { status: "Certification" } },
      [`${app}/submissions/1`]: { body: { applicationPackages: [{ version: "0.6.0.0", fileStatus: "Uploaded" }] } },
    });
    const state = await readStoreState({ fetchImpl, env });
    assert.deepEqual(state.pending, { id: "2", status: "Certification" });
    assert.deepEqual(state.publishedPackages, [{ version: "0.6.0.0", fileStatus: "Uploaded" }]);
  });

  it("reports nothing pending", async () => {
    const fetchImpl = fakeFetch({
      ...auth,
      [app]: { body: { lastPublishedApplicationSubmission: { id: "1" } } },
      [`${app}/submissions/1`]: { body: { applicationPackages: [{ version: "0.6.0.0", fileStatus: "Uploaded" }] } },
    });
    assert.equal((await readStoreState({ fetchImpl, env })).pending, null);
  });

  it("exchanges the GitHub token with no client secret and only reads from the Store API", async () => {
    const fetchImpl = fakeFetch({
      ...auth,
      [app]: { body: { lastPublishedApplicationSubmission: { id: "1" } } },
      [`${app}/submissions/1`]: { body: { applicationPackages: [] } },
    });
    await readStoreState({ fetchImpl, env });

    const [github, entra, ...store] = fetchImpl.calls;
    assert.equal(new URL(github.url).searchParams.get("audience"), "api://AzureADTokenExchange");
    assert.equal(new URL(github.url).searchParams.get("api-version"), "2");
    assert.equal(github.headers.Authorization, "Bearer runner-token");

    assert.equal(entra.method, "POST");
    const form = new URLSearchParams(entra.body);
    assert.equal(form.get("grant_type"), "client_credentials");
    assert.equal(form.get("client_id"), "client-1");
    assert.equal(form.get("scope"), "https://manage.devcenter.microsoft.com/.default");
    assert.equal(form.get("client_assertion_type"), "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    assert.equal(form.get("client_assertion"), "github-oidc-jwt");
    assert.equal(form.has("client_secret"), false);

    assert.ok(store.length > 0);
    for (const call of store) {
      assert.equal(call.method, "GET");
      assert.equal(call.headers.Authorization, "Bearer store-token");
    }
  });

  it("names the missing settings", async () => {
    await assert.rejects(readStoreState({ fetchImpl: fakeFetch({}), env: { ...env, MSSTORE_CLIENT_ID: "" } }), /MSSTORE_CLIENT_ID/);
  });

  it("explains a missing id-token permission", async () => {
    await assert.rejects(readStoreState({ fetchImpl: fakeFetch({}), env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "" } }), /id-token/);
  });

  it("shows the Entra error, without the assertion", async () => {
    const fetchImpl = fakeFetch({
      ...auth,
      "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token": { status: 400, body: { error_description: "AADSTS70021: No matching federated identity record found." } },
    });
    await assert.rejects(readStoreState({ fetchImpl, env }), (error) => {
      assert.match(error.message, /AADSTS70021/);
      assert.doesNotMatch(error.message, /github-oidc-jwt/);
      return true;
    });
  });

  it("points at the Partner Center role on a denied Store call", async () => {
    const fetchImpl = fakeFetch({ ...auth, [app]: { status: 403 } });
    await assert.rejects(readStoreState({ fetchImpl, env }), /403.*Manager/s);
  });
});
