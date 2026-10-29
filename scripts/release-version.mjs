#!/usr/bin/env node
// Plans and applies release versions for .github/workflows/release.yml.
//   node scripts/release-version.mjs next            -> GitHub output lines for the next release
//   node scripts/release-version.mjs apply <version> -> rewrite the four version declarations
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const CONVENTIONAL_SUBJECT = /^(\w+)(?:\([^)]*\))?(!)?:/;
const TOP_LEVEL_JSON_VERSION = /^(  "version": ")([^"]+)(")/m;
// `version` inside [package], before the next table header.
const CARGO_PACKAGE_VERSION = /^(\[package\]\r?\n(?:(?!\[)[^\n]*\n)*?version = ")([^"]+)(")/m;
const CARGO_PACKAGE_NAME = /^\[package\]\r?\n(?:(?!\[)[^\n]*\n)*?name = "([^"]+)"/m;

function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Invalid version "${version}"; expected major.minor.patch`);
  return match.slice(1).map(Number);
}

function compare(a, b) {
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** Highest bump implied by commit messages: only the subject decides the type; any BREAKING CHANGE footer is major. */
export function bumpLevel(messages) {
  if (!messages.length) return null;
  let level = "patch";
  for (const message of messages) {
    const subject = message.split("\n", 1)[0].trim();
    const match = CONVENTIONAL_SUBJECT.exec(subject);
    if (match?.[2] || /^BREAKING[ -]CHANGE:/m.test(message)) return "major";
    if (match?.[1] === "feat") level = "minor";
  }
  return level;
}

/** Next release version, or null when there is nothing to release. Breaking changes bump minor before 1.0. */
export function planVersion({ tagVersion, fileVersion, level }) {
  const order = compare(fileVersion, tagVersion);
  if (order < 0) throw new Error(`File version ${fileVersion} is below latest tag v${tagVersion}`);
  if (order > 0) return fileVersion;
  if (!level) return null;
  const [major, minor, patch] = parse(tagVersion);
  if (level === "major" && major > 0) return `${major + 1}.0.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor + 1}.0`;
}

function declarations(root) {
  const cargoToml = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
  const crate = CARGO_PACKAGE_NAME.exec(cargoToml)?.[1];
  if (!crate) throw new Error("Cargo.toml has no [package] name");
  const escaped = crate.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return {
    packageJson: { path: join(root, "package.json"), pattern: TOP_LEVEL_JSON_VERSION },
    tauriConf: { path: join(root, "src-tauri", "tauri.conf.json"), pattern: TOP_LEVEL_JSON_VERSION },
    cargoToml: { path: join(root, "src-tauri", "Cargo.toml"), pattern: CARGO_PACKAGE_VERSION },
    cargoLock: {
      path: join(root, "src-tauri", "Cargo.lock"),
      pattern: new RegExp(`^(\\[\\[package\\]\\]\\r?\\nname = "${escaped}"\\r?\\nversion = ")([^"]+)(")`, "m"),
    },
  };
}

export function readVersions(root) {
  const versions = {};
  for (const [key, { path, pattern }] of Object.entries(declarations(root))) {
    const match = pattern.exec(readFileSync(path, "utf8"));
    if (!match) throw new Error(`No app version found in ${path}`);
    versions[key] = match[2];
  }
  return versions;
}

function agreedVersion(versions) {
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) throw new Error(`Version declarations disagree: ${JSON.stringify(versions)}`);
  return [...unique][0];
}

export function applyVersion(root, version) {
  parse(version);
  agreedVersion(readVersions(root));
  const changed = [];
  for (const { path, pattern } of Object.values(declarations(root))) {
    const before = readFileSync(path, "utf8");
    const after = before.replace(pattern, `$1${version}$3`);
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(path);
    }
  }
  return changed;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function tagExists(root, tag) {
  try {
    git(root, ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

function next(root) {
  const previousTag = git(root, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"]).trim();
  const messages = git(root, ["log", "--format=%B%x00", `${previousTag}..HEAD`]).split("\0").map((message) => message.trim()).filter(Boolean);
  const version = planVersion({ tagVersion: previousTag.slice(1), fileVersion: agreedVersion(readVersions(root)), level: bumpLevel(messages) });
  if (version && tagExists(root, `v${version}`)) throw new Error(`Tag v${version} already exists`);
  return [`previous_tag=${previousTag}`, `release=${version ? "true" : "false"}`, `version=${version ?? ""}`].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, version] = process.argv.slice(2);
  if (command === "next") {
    console.log(next(root));
  } else if (command === "apply" && version) {
    for (const path of applyVersion(root, version)) console.log(`updated ${path}`);
  } else {
    console.error("Usage: release-version.mjs next | apply <version>");
    process.exit(2);
  }
}
