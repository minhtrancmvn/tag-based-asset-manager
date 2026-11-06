import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(root, ".github/workflows/updater-signing-check.yml");
const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
const directories = [];

// Nonsecret reference vector from tauri-plugin-updater 2.14.1.
const publicKey = Buffer.from(
  "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe",
).toString("base64");
const signature = Buffer.from(
  "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==",
).toString("base64");

function inlineScript(marker) {
  const match = workflow.match(new RegExp(`node --input-type=module <<'${marker}'\\n([\\s\\S]*?)\\n          ${marker}`));
  assert.ok(match, `Workflow must contain executable ${marker} check`);
  return match[1].replace(/^          /gm, "");
}

function runVerifier({ payload = "test", signed = signature, version = "2.0.0", key = publicKey } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "updater-signing-workflow-"));
  directories.push(directory);
  writeFileSync(join(directory, "probe.txt"), payload);
  writeFileSync(join(directory, "probe.txt.sig"), signed);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("TAURI_SIGNING_")));
  Object.assign(env, {
    CHECK_DIR: directory,
    PROBE_VERSION: version,
    TAURI_UPDATER_PUBLIC_KEY: key,
    GITHUB_REPOSITORY: "minhtrancmvn/tag-based-asset-manager",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
  });
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: inlineScript("VERIFY"), env, encoding: "utf8", timeout: 10_000,
  });
  return { ...result, directory };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("non-publishing updater signing workflow", () => {
  it("allows only a push to the dedicated same-repository branch", () => {
    assert.match(workflow, /on:\n  push:\n    branches: \[ci\/updater-signing-check\]/);
    assert.doesNotMatch(workflow, /^  (pull_request|pull_request_target|workflow_run|workflow_dispatch|schedule):/m);
    assert.match(workflow, /github\.repository == 'minhtrancmvn\/tag-based-asset-manager'/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/ci\/updater-signing-check'/);
  });

  it("has no repository write permissions, checkout or publication commands", () => {
    assert.match(workflow, /permissions: \{\}/);
    assert.doesNotMatch(workflow, /contents: write|id-token: write|actions\/checkout|gh release|git push|latest\.json|workflow_call/);
    assert.doesNotMatch(workflow, /pnpm install|npm install|npm exec|npx |pnpm tauri build|cargo /);
  });

  it("pins actions, node runtime and signer package integrity", () => {
    const actions = [...workflow.matchAll(/uses: ([^\s]+)/g)].map((match) => match[1]);
    assert.equal(actions.length, 2);
    for (const action of actions) assert.match(action, /^[\w/-]+@[a-f0-9]{40}$/);
    assert.match(workflow, /node-version: '24'/);
    assert.match(workflow, /package-manager-cache: false/);
    const integrity = "sha512-Z1QGPr49HJZMktu+Spu6Q1b/f9ANadXvqZZZt2645ua1x1ev6prOgp85eiGv2jRzohFEMLo6aJyaLjLUX5KIvA==";
    assert.ok(readFileSync(join(root, "pnpm-lock.yaml"), "utf8").includes(integrity));
    assert.ok(workflow.includes(integrity));
    assert.match(workflow, /cli-linux-x64-gnu-2\.12\.1\.tgz/);
  });

  it("scopes both secrets to the signer step and captures all signer output", () => {
    const before = workflow.split("      - name: Sign inert payload")[0];
    const sign = workflow.split("      - name: Sign inert payload")[1]?.split("      - name: Verify signature")[0] ?? "";
    const after = workflow.split("      - name: Verify signature")[1] ?? "";
    assert.doesNotMatch(before, /secrets\./);
    assert.doesNotMatch(after, /secrets\./);
    assert.match(sign, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
    assert.match(sign, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/);
    assert.match(sign, /stdio: \['ignore', 'pipe', 'pipe'\]/);
    assert.doesNotMatch(sign, /console\.(log|error)\([^\n]*(stdout|stderr|process\.env)|--password|--private-key/);
    assert.match(sign, /'--app-version', process\.env\.PROBE_VERSION/);
  });

  it("bounds job, signer and evidence scope without restoring caches", () => {
    assert.match(workflow, /timeout-minutes: 10/);
    assert.match(workflow, /timeout: 60_000/);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.match(workflow, /retention-days: 7/);
    assert.match(workflow, /path: \$\{\{ env\.CHECK_DIR \}\}\/verification\.json/);
    assert.doesNotMatch(workflow, /actions\/cache|ACTIONS_STEP_DEBUG|set -x|tee /);
  });
});

describe("inline public-key verifier", () => {
  it("accepts authentic versioned bytes and reports negative checks", () => {
    const result = runVerifier();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(result.directory, "verification.json"), "utf8"));
    assert.equal(report.version, "2.0.0");
    assert.equal(report.payload_verified, true);
    assert.equal(report.global_signature_verified, true);
    assert.equal(report.tampered_payload_rejected, true);
    assert.equal(report.tampered_signature_rejected, true);
    assert.equal(report.tampered_comment_rejected, true);
    assert.equal(report.version_mismatch_rejected, true);
    assert.equal(report.published, false);
  });

  it("rejects altered payload without writing success evidence", () => {
    const result = runVerifier({ payload: "corrupt" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(result.directory, "verification.json")), false);
  });

  it("rejects a mismatched advertised version", () => {
    const result = runVerifier({ version: "2.0.1" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(result.directory, "verification.json")), false);
  });

  it("rejects an authenticated-comment modification", () => {
    const changed = Buffer.from(signature, "base64").toString().replace("version:2.0.0", "version:2.0.1");
    const result = runVerifier({ signed: Buffer.from(changed).toString("base64"), version: "2.0.1" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(result.directory, "verification.json")), false);
  });

  it("rejects malformed keys without writing success evidence", () => {
    const result = runVerifier({ key: "not-a-public-key" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(result.directory, "verification.json")), false);
  });
});
