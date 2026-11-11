import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { OFFICIAL_ENDPOINT, OFFICIAL_REPOSITORY, checkUsageEndpoint } from "./check-usage-endpoint.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-usage-endpoint.mjs");

function runCli(env) {
  const childEnv = { ...process.env };
  delete childEnv.GITHUB_REPOSITORY;
  delete childEnv.TAG_ASSET_MANAGER_USAGE_ENDPOINT;
  return spawnSync(process.execPath, [script], { env: { ...childEnv, ...env }, encoding: "utf8" });
}

describe("checkUsageEndpoint in the official repository", () => {
  it("passes only the exact official endpoint", () => {
    assert.equal(checkUsageEndpoint({ repository: OFFICIAL_REPOSITORY, endpoint: OFFICIAL_ENDPOINT }).ok, true);
  });

  it("fails an empty or missing endpoint", () => {
    assert.equal(checkUsageEndpoint({ repository: OFFICIAL_REPOSITORY, endpoint: "" }).ok, false);
    assert.equal(checkUsageEndpoint({ repository: OFFICIAL_REPOSITORY, endpoint: undefined }).ok, false);
  });

  it("fails any other value, including near misses", () => {
    for (const endpoint of [
      "http://usage.minhtran.id.vn/v1/events",
      "https://usage.minhtran.id.vn/v1/events/",
      " https://usage.minhtran.id.vn/v1/events",
      "https://usage.minhtran.id.vn",
      "https://example.com/v1/events",
    ]) {
      assert.equal(checkUsageEndpoint({ repository: OFFICIAL_REPOSITORY, endpoint }).ok, false, endpoint);
    }
  });
});

describe("checkUsageEndpoint elsewhere", () => {
  it("passes an empty or missing endpoint, so forks and local builds stay silent", () => {
    assert.equal(checkUsageEndpoint({ repository: "someone/fork", endpoint: "" }).ok, true);
    assert.equal(checkUsageEndpoint({ repository: undefined, endpoint: undefined }).ok, true);
  });

  it("passes a fork's own HTTPS endpoint and fails one the app would ignore", () => {
    assert.equal(checkUsageEndpoint({ repository: "someone/fork", endpoint: "https://usage.example/v1/events" }).ok, true);
    assert.equal(checkUsageEndpoint({ repository: "someone/fork", endpoint: "http://usage.example/v1/events" }).ok, false);
  });
});

describe("check-usage-endpoint CLI", () => {
  it("exits 0 for the official endpoint and never prints it as an error", () => {
    const result = runCli({ GITHUB_REPOSITORY: OFFICIAL_REPOSITORY, TAG_ASSET_MANAGER_USAGE_ENDPOINT: OFFICIAL_ENDPOINT });
    assert.equal(result.status, 0, result.stderr);
  });

  it("exits 1 with a GitHub error annotation when the official build has no endpoint", () => {
    const result = runCli({ GITHUB_REPOSITORY: OFFICIAL_REPOSITORY, TAG_ASSET_MANAGER_USAGE_ENDPOINT: "" });
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /::error::/);
    assert.match(result.stdout + result.stderr, /USAGE_ENDPOINT/);
  });

  it("exits 0 elsewhere with no endpoint", () => {
    const result = runCli({ GITHUB_REPOSITORY: "someone/fork" });
    assert.equal(result.status, 0, result.stderr);
  });
});
