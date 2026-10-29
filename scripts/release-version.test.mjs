import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { applyVersion, bumpLevel, planVersion, readVersions } from "./release-version.mjs";

describe("bumpLevel", () => {
  it("returns null without commits", () => {
    assert.equal(bumpLevel([]), null);
  });

  it("treats fixes, docs and non-conventional subjects as patch", () => {
    assert.equal(bumpLevel(["fix: handle missing sidecar", "docs: update readme", "Update README"]), "patch");
  });

  it("treats a scoped feat subject as minor", () => {
    assert.equal(bumpLevel(["fix: typo", "feat(ui): polish library controls (#8)"]), "minor");
  });

  it("ignores commit types listed in a squash-merge body", () => {
    assert.equal(bumpLevel(["fix: tidy dialog\n\n* feat: add draft option\n* fix: spacing"]), "patch");
  });

  it("treats a bang subject as major", () => {
    assert.equal(bumpLevel(["feat!: change sidecar format"]), "major");
  });

  it("treats a BREAKING CHANGE footer as major", () => {
    assert.equal(bumpLevel(["refactor: move settings\n\nBREAKING CHANGE: settings file relocated"]), "major");
  });
});

describe("planVersion", () => {
  it("bumps minor from the latest tag for a feature", () => {
    assert.equal(planVersion({ tagVersion: "0.2.0", fileVersion: "0.2.0", level: "minor" }), "0.3.0");
  });

  it("bumps patch from the latest tag", () => {
    assert.equal(planVersion({ tagVersion: "0.3.0", fileVersion: "0.3.0", level: "patch" }), "0.3.1");
  });

  it("keeps breaking changes at minor before 1.0", () => {
    assert.equal(planVersion({ tagVersion: "0.3.1", fileVersion: "0.3.1", level: "major" }), "0.4.0");
  });

  it("bumps major after 1.0", () => {
    assert.equal(planVersion({ tagVersion: "1.4.2", fileVersion: "1.4.2", level: "major" }), "2.0.0");
  });

  it("releases a manually raised file version as-is", () => {
    assert.equal(planVersion({ tagVersion: "0.3.1", fileVersion: "1.0.0", level: "patch" }), "1.0.0");
  });

  it("returns null without commits", () => {
    assert.equal(planVersion({ tagVersion: "0.3.1", fileVersion: "0.3.1", level: null }), null);
  });

  it("rejects a file version below the latest tag", () => {
    assert.throws(() => planVersion({ tagVersion: "0.3.1", fileVersion: "0.2.0", level: "patch" }), /below latest tag/);
  });

  it("rejects versions that are not plain major.minor.patch", () => {
    assert.throws(() => planVersion({ tagVersion: "0.3.1-beta", fileVersion: "0.3.1", level: "patch" }), /Invalid version/);
  });
});

describe("applyVersion", () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function fixture(eol = "\n", versions = {}) {
    const v = { pkg: "0.2.0", conf: "0.2.0", toml: "0.2.0", lock: "0.2.0", ...versions };
    root = mkdtempSync(join(tmpdir(), "release-version-"));
    mkdirSync(join(root, "src-tauri"));
    const lines = (items) => items.join(eol) + eol;
    writeFileSync(join(root, "package.json"), lines(["{", '  "name": "tag-based-asset-manager",', `  "version": "${v.pkg}",`, '  "devDependencies": {', '    "vite": "^8.0.0"', "  }", "}"]));
    writeFileSync(join(root, "src-tauri", "tauri.conf.json"), lines(["{", '  "productName": "Tag-Based Asset Manager",', `  "version": "${v.conf}",`, '  "plugins": { "x": { "version": "9.9.9" } }', "}"]));
    writeFileSync(join(root, "src-tauri", "Cargo.toml"), lines(["[package]", 'name = "tag-based-asset-manager"', `version = "${v.toml}"`, "", "[dependencies]", 'serde = { version = "1.0.0" }', "", "[dependencies.tauri]", 'version = "2.0.0"']));
    writeFileSync(join(root, "src-tauri", "Cargo.lock"), lines(["[[package]]", 'name = "serde"', 'version = "0.2.0"', "", "[[package]]", 'name = "tag-based-asset-manager"', `version = "${v.lock}"`, "dependencies = ["]));
    return root;
  }

  it("reads the four version declarations", () => {
    assert.deepEqual(readVersions(fixture()), { packageJson: "0.2.0", tauriConf: "0.2.0", cargoToml: "0.2.0", cargoLock: "0.2.0" });
  });

  it("updates only the app version in every file", () => {
    fixture();
    applyVersion(root, "0.3.0");
    assert.deepEqual(readVersions(root), { packageJson: "0.3.0", tauriConf: "0.3.0", cargoToml: "0.3.0", cargoLock: "0.3.0" });
    const lock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");
    assert.match(lock, /name = "serde"\nversion = "0\.2\.0"/);
    const toml = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
    assert.match(toml, /\[dependencies\.tauri\]\nversion = "2\.0\.0"/);
    const conf = readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8");
    assert.match(conf, /"version": "9\.9\.9"/);
  });

  it("preserves CRLF line endings", () => {
    fixture("\r\n");
    applyVersion(root, "0.3.0");
    const lock = readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8");
    assert.match(lock, /name = "tag-based-asset-manager"\r\nversion = "0\.3\.0"\r\n/);
    assert.doesNotMatch(lock.replaceAll("\r\n", ""), /\n/);
  });

  it("is a no-op when files already carry the version", () => {
    fixture();
    const before = readFileSync(join(root, "package.json"), "utf8");
    applyVersion(root, "0.2.0");
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
  });

  it("refuses to apply when declarations disagree", () => {
    fixture("\n", { lock: "0.1.0" });
    assert.throws(() => applyVersion(root, "0.3.0"), /disagree/);
  });
});
