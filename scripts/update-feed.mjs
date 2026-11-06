#!/usr/bin/env node
// Updater manifest generator for Tauri v2 updater preview feed.
// Generates static latest.json with version-bound signatures and canonical URLs.
// Compatible with tauri-plugin-updater 2.14.1 (updater.rs:1893-1974).
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPPORTED_PLATFORMS = Object.freeze(["darwin-aarch64", "windows-x86_64"]);
export const DEFAULT_REPOSITORY = "minhtrancmvn/tag-based-asset-manager";

// Strict canonical SemVer: no leading zeros on major, minor, or patch numbers
const CANONICAL_SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;
const REPO_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

// Ed25519 SPKI DER header (OID 1.3.101.112): 30 2a 30 05 06 03 2b 65 70 03 21 00
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function validateSemver(version) {
  if (typeof version !== "string") {
    throw new TypeError(`Invalid version type: expected string, got ${typeof version}`);
  }
  const match = CANONICAL_SEMVER.exec(version.trim());
  if (!match) {
    throw new Error(`Invalid semver "${version}"; expected canonical major.minor.patch (no leading zeros)`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * Decodes outer base64 signature matching tauri-plugin-updater updater.rs:1969-1975 base64_to_string.
 */
export function decodeReleaseSignature(releaseSignature) {
  if (typeof releaseSignature !== "string") {
    throw new TypeError("Release signature must be a string");
  }
  const cleaned = releaseSignature.trim();
  const buffer = Buffer.from(cleaned, "base64");
  return buffer.toString("utf8");
}

/**
 * Parses signed version from trusted comment matching updater.rs:1963-1967:
 * trusted_comment.split('\t').find_map(|field| field.strip_prefix("version:"))
 */
function extractSignedVersion(trustedComment) {
  for (const field of trustedComment.split("\t")) {
    if (field.startsWith("version:")) {
      return field.slice("version:".length);
    }
  }
  return null;
}

/**
 * Parses Minisign public key matching tauri-plugin-updater 2.14.1 validate_key.
 * The plugin enforces:
 *   1. pub_key must be standard outer base64 encoding of 2-line minisign text
 *   2. Decoded text must be decoded by minisign-verify PublicKey::decode
 *   3. Supported algorithm bytes are 0x45, 0x64 ('Ed') or 0x45, 0x44 ('ED')
 * Plaintext minisign text or noncanonical base64 are strictly rejected.
 */
export function parsePublicKey(keyInput) {
  if (typeof keyInput !== "string") {
    throw new TypeError("Public key must be a string");
  }

  const cleaned = keyInput.trim();
  if (!cleaned) {
    throw new Error("Invalid minisign public key: empty input");
  }

  if (cleaned.startsWith("untrusted comment:")) {
    throw new Error(
      "Invalid minisign public key: plaintext minisign text provided; key must be canonical standard base64 encoded string matching Tauri plugin format"
    );
  }

  if (!BASE64_REGEX.test(cleaned) || cleaned.length % 4 !== 0) {
    throw new Error("Invalid public key: not canonical base64");
  }

  let text;
  try {
    const decodedBuf = Buffer.from(cleaned, "base64");
    // Verify canonical round-trip base64
    if (decodedBuf.toString("base64") !== cleaned) {
      throw new Error("Non-canonical base64 padding or bits");
    }
    text = decodedBuf.toString("utf8");
  } catch (err) {
    throw new Error(`Invalid public key: failed to decode standard base64 (${err.message})`);
  }

  if (!text.startsWith("untrusted comment:")) {
    throw new Error("Invalid minisign public key: missing untrusted comment header in decoded text");
  }

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("Invalid minisign public key: expected at least 2 lines in decoded text");
  }

  const untrustedCommentLine = lines[0];
  const base64Part = lines[1];

  if (!untrustedCommentLine.startsWith("untrusted comment:")) {
    throw new Error("Invalid minisign public key: missing untrusted comment header in decoded text");
  }

  if (!base64Part || !BASE64_REGEX.test(base64Part) || base64Part.length % 4 !== 0) {
    throw new Error("Invalid minisign public key: line 2 is not valid base64");
  }

  const bin = Buffer.from(base64Part, "base64");
  if (bin.toString("base64") !== base64Part) {
    throw new Error("Invalid minisign public key: line 2 is not canonical base64");
  }
  if (bin.length !== 42) {
    throw new Error(`Invalid minisign public key: decoded length ${bin.length} !== 42`);
  }

  const sigAlg = bin.subarray(0, 2);
  const isEd = sigAlg[0] === 0x45 && (sigAlg[1] === 0x64 || sigAlg[1] === 0x44);
  if (!isEd) {
    throw new Error(
      `Invalid minisign public key: unsupported signature algorithm [0x${sigAlg[0].toString(16)}, 0x${sigAlg[1].toString(16)}]`
    );
  }

  const keyId = bin.subarray(2, 10);
  const rawKey = bin.subarray(10, 42);

  const spki = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
  const keyObj = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });

  const keyIdDisplay = Buffer.from(keyId).reverse().toString("hex").toUpperCase();

  return {
    signatureAlgorithm: sigAlg,
    keyId,
    keyIdHex: keyId.toString("hex"),
    keyIdDisplay,
    rawKey,
    keyObj,
    rawBase64: base64Part,
    outerBase64: cleaned,
  };
}

export function parseSignature(signatureInput) {
  if (typeof signatureInput !== "string") {
    throw new TypeError("Signature content must be a string");
  }

  let text = signatureInput;

  // If input is outer base64 encoded, decode it first
  if (!text.startsWith("untrusted comment:")) {
    try {
      const decoded = decodeReleaseSignature(text);
      if (decoded.startsWith("untrusted comment:")) {
        text = decoded;
      }
    } catch {
      // not base64, proceed to normal validation failure below
    }
  }

  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();

  if (lines.length !== 4) {
    throw new Error(`Invalid minisign signature: expected 4 lines, found ${lines.length}`);
  }

  const [untrustedCommentLine, signatureBase64, trustedCommentLine, globalSignatureBase64] = lines;

  if (!untrustedCommentLine.startsWith("untrusted comment:")) {
    throw new Error("Invalid signature: missing untrusted comment header");
  }
  if (!trustedCommentLine.startsWith("trusted comment: ")) {
    throw new Error("Invalid signature: missing trusted comment header");
  }

  if (!BASE64_REGEX.test(signatureBase64)) {
    throw new Error("Invalid signature: line 2 is not valid base64");
  }
  if (!BASE64_REGEX.test(globalSignatureBase64)) {
    throw new Error("Invalid signature: line 4 is not valid base64");
  }

  const bin1 = Buffer.from(signatureBase64, "base64");
  if (bin1.length !== 74) {
    throw new Error(`Invalid minisign signature: line 2 decoded length ${bin1.length} !== 74`);
  }
  const bin2 = Buffer.from(globalSignatureBase64, "base64");
  if (bin2.length !== 64) {
    throw new Error(`Invalid minisign signature: line 4 decoded length ${bin2.length} !== 64`);
  }

  const sigAlg = bin1.subarray(0, 2);
  const isEd = sigAlg[0] === 0x45 && (sigAlg[1] === 0x64 || sigAlg[1] === 0x44);
  if (!isEd) {
    throw new Error(
      `Invalid minisign signature: unsupported signature algorithm [0x${sigAlg[0].toString(16)}, 0x${sigAlg[1].toString(16)}]`
    );
  }
  const keyId = bin1.subarray(2, 10);
  const signatureBytes = bin1.subarray(10, 74);
  const globalSignatureBytes = bin2;

  // [0x45, 0x44] -> ED (prehashed blake2b512) vs [0x45, 0x64] -> Ed
  const isPrehashed = sigAlg[0] === 0x45 && sigAlg[1] === 0x44;

  const trustedComment = trustedCommentLine.slice("trusted comment: ".length);
  const appVersion = extractSignedVersion(trustedComment);
  const rawMinisign = lines.join("\n");
  const outerBase64 = Buffer.from(rawMinisign, "utf8").toString("base64");

  return {
    untrustedComment: untrustedCommentLine.slice("untrusted comment:".length).trim(),
    signature: signatureBase64,
    trustedComment,
    globalSignature: globalSignatureBase64,
    appVersion,
    raw: rawMinisign,
    outerBase64,
    keyId,
    keyIdHex: keyId.toString("hex"),
    signatureBytes,
    globalSignatureBytes,
    isPrehashed,
  };
}

/**
 * Cryptographically verifies payload bytes and Minisign signature against a public key.
 * Strictly replicates minisign-verify crate lib.rs verify / verify_ed25519.
 */
export function verifyMinisign({ data, signatureContent, publicKey }) {
  const pubKey = parsePublicKey(publicKey);
  const sig = parseSignature(signatureContent);

  if (Buffer.compare(sig.keyId, pubKey.keyId) !== 0) {
    throw new Error(
      `Signature key ID does not match public key ID (sig: ${sig.keyIdHex}, pub: ${pubKey.keyIdHex})`
    );
  }

  let digest;
  if (sig.isPrehashed) {
    digest = crypto.createHash("blake2b512").update(data).digest();
  } else {
    digest = data;
  }

  const validPrimary = crypto.verify(null, digest, pubKey.keyObj, sig.signatureBytes);
  if (!validPrimary) {
    throw new Error("Minisign signature verification failed for data");
  }

  const globalData = Buffer.concat([sig.signatureBytes, Buffer.from(sig.trustedComment, "utf8")]);
  const validGlobal = crypto.verify(null, globalData, pubKey.keyObj, sig.globalSignatureBytes);
  if (!validGlobal) {
    throw new Error("Minisign global signature verification failed (tampered trusted comment or key)");
  }

  return true;
}

export function validateSignature(signatureContent, expectedVersion, options = {}) {
  const normExpected = validateSemver(expectedVersion);
  const parsed = parseSignature(signatureContent);

  if (!parsed.appVersion) {
    throw new Error("Signature is not version-bound: missing version in trusted comment");
  }

  const normSigned = validateSemver(parsed.appVersion);
  if (normSigned !== normExpected) {
    throw new Error(`Signature version mismatch: expected ${normExpected}, found ${normSigned}`);
  }

  if (options.publicKey) {
    const pubKey = parsePublicKey(options.publicKey);
    if (Buffer.compare(parsed.keyId, pubKey.keyId) !== 0) {
      throw new Error(
        `Signature key ID does not match public key ID (sig: ${parsed.keyIdHex}, pub: ${pubKey.keyIdHex})`
      );
    }
    if (options.data) {
      verifyMinisign({
        data: options.data,
        signatureContent: parsed.raw,
        publicKey: options.publicKey,
      });
    } else {
      const globalData = Buffer.concat([
        parsed.signatureBytes,
        Buffer.from(parsed.trustedComment, "utf8"),
      ]);
      const validGlobal = crypto.verify(null, globalData, pubKey.keyObj, parsed.globalSignatureBytes);
      if (!validGlobal) {
        throw new Error("Minisign global signature verification failed for public key");
      }
    }
  }

  return parsed;
}

export function getExpectedArtifactFilename(platform, version) {
  const normVersion = validateSemver(version);
  switch (platform) {
    case "darwin-aarch64":
      return `Tag-Based-Asset-Manager_${normVersion}_aarch64.app.tar.gz`;
    case "windows-x86_64":
      return `Tag-Based-Asset-Manager_${normVersion}_x64-setup.exe`;
    default:
      throw new Error(`Unsupported platform "${platform}"; expected one of: ${SUPPORTED_PLATFORMS.join(", ")}`);
  }
}

export function buildPlatformUrl({ repository, version, platform, filename }) {
  const repo = repository || DEFAULT_REPOSITORY;
  if (!REPO_REGEX.test(repo)) {
    throw new Error(`Invalid repository format "${repo}"; expected "owner/repo"`);
  }
  const normVersion = validateSemver(version);
  const expectedFilename = filename || getExpectedArtifactFilename(platform, normVersion);

  return `https://github.com/${repo}/releases/download/v${normVersion}/${expectedFilename}`;
}

export function validatePlatformUrl(url, { repository, version, platform, filename }) {
  if (typeof url !== "string") {
    throw new TypeError("URL must be a string");
  }
  if (
    url.startsWith("file://") ||
    url.startsWith("/") ||
    url.startsWith("./") ||
    url.startsWith("../") ||
    /^[A-Za-z]:\\/.test(url)
  ) {
    throw new Error(`Local paths are prohibited in updater manifest: "${url}"`);
  }
  if (!url.startsWith("https://")) {
    throw new Error(`URL must use HTTPS: "${url}"`);
  }

  const expectedUrl = buildPlatformUrl({ repository, version, platform, filename });
  if (url !== expectedUrl) {
    throw new Error(`Canonical URL mismatch: expected "${expectedUrl}", got "${url}"`);
  }

  return true;
}

export function generateFeed({
  version,
  notes,
  pubDate,
  repository = DEFAULT_REPOSITORY,
  platforms,
  publicKey,
}) {
  const normVersion = validateSemver(version);

  if (!publicKey) {
    throw new Error("Public key is required to validate updater feed signatures");
  }

  if (typeof notes !== "string" || !notes.trim()) {
    throw new Error("Release notes must be a non-empty string");
  }

  const date = pubDate ? new Date(pubDate) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid pub_date "${pubDate}"; expected ISO 8601 string`);
  }
  const isoPubDate = date.toISOString();

  if (!platforms || typeof platforms !== "object") {
    throw new Error("Platforms must be an object containing platform configurations");
  }

  const platformKeys = Object.keys(platforms);
  for (const required of SUPPORTED_PLATFORMS) {
    if (!platformKeys.includes(required)) {
      throw new Error(`Missing required platform "${required}" in updater feed`);
    }
  }

  for (const key of platformKeys) {
    if (!SUPPORTED_PLATFORMS.includes(key)) {
      throw new Error(`Unsupported platform "${key}" in updater feed; supported: ${SUPPORTED_PLATFORMS.join(", ")}`);
    }
  }

  const platformsOutput = {};
  for (const platform of SUPPORTED_PLATFORMS) {
    const entry = platforms[platform];
    if (!entry || !entry.signature) {
      throw new Error(`Missing signature for platform "${platform}"`);
    }

    const validatedSig = validateSignature(entry.signature, normVersion, { publicKey });

    const url = entry.url || buildPlatformUrl({ repository, version: normVersion, platform });
    validatePlatformUrl(url, { repository, version: normVersion, platform });

    // CRITICAL: tauri-plugin-updater requires outer base64 encoding of 4-line minisign text
    platformsOutput[platform] = {
      signature: validatedSig.outerBase64,
      url,
    };
  }

  return {
    version: normVersion,
    notes: notes.trim(),
    pub_date: isoPubDate,
    platforms: platformsOutput,
  };
}

export function generateFeedFromArtifacts({
  artifactsDir,
  version,
  notes,
  pubDate,
  repository = DEFAULT_REPOSITORY,
  outputPath,
  publicKey,
}) {
  const normVersion = validateSemver(version);

  if (!publicKey) {
    throw new Error("Public key is required to validate updater feed signatures");
  }

  if (!existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory does not exist: "${artifactsDir}"`);
  }

  const platforms = {};

  for (const platform of SUPPORTED_PLATFORMS) {
    const filename = getExpectedArtifactFilename(platform, normVersion);
    const sigFilename = `${filename}.sig`;

    const artifactPath = join(artifactsDir, filename);
    const sigPath = join(artifactsDir, sigFilename);

    if (!existsSync(artifactPath)) {
      throw new Error(`Missing expected artifact for platform "${platform}": "${artifactPath}"`);
    }
    if (!existsSync(sigPath)) {
      throw new Error(`Missing expected signature for platform "${platform}": "${sigPath}"`);
    }

    const artifactBytes = readFileSync(artifactPath);
    const signature = readFileSync(sigPath, "utf8");

    // Cryptographically verify artifact bytes against Minisign signature and public key
    verifyMinisign({
      data: artifactBytes,
      signatureContent: signature,
      publicKey,
    });

    platforms[platform] = { signature };
  }

  const feed = generateFeed({
    version: normVersion,
    notes,
    pubDate,
    repository,
    platforms,
    publicKey,
  });

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(feed, null, 2) + "\n", "utf8");
  }

  return feed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "generate" || command === "verify") {
    let artifactsDir;
    let version;
    let notes = "Tag-Based Asset Manager preview release";
    let repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
    let outputPath;
    let pubDate;
    let publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY;

    for (let i = 1; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--artifacts-dir" || arg === "-a") {
        artifactsDir = args[++i];
      } else if (arg === "--version" || arg === "-v") {
        version = args[++i];
      } else if (arg === "--notes" || arg === "-n") {
        notes = args[++i];
      } else if (arg === "--repository" || arg === "-r") {
        repository = args[++i];
      } else if (arg === "--out" || arg === "-o") {
        outputPath = args[++i];
      } else if (arg === "--pub-date") {
        pubDate = args[++i];
      } else if (arg === "--public-key" || arg === "-k") {
        publicKey = args[++i];
      } else if (!arg.startsWith("-")) {
        if (!artifactsDir) artifactsDir = arg;
        else if (!version) version = arg;
        else if (notes === "Tag-Based Asset Manager preview release") notes = arg;
        else if (repository === (process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY)) repository = arg;
        else if (!outputPath) outputPath = arg;
      }
    }

    if (!artifactsDir || !version || !publicKey) {
      console.error(
        "Usage: update-feed.mjs generate --artifacts-dir <dir> --version <version> --public-key <key> [--notes <notes>] [--out <path>]"
      );
      process.exit(2);
    }

    try {
      const feed = generateFeedFromArtifacts({
        artifactsDir,
        version,
        notes,
        pubDate,
        repository,
        outputPath: command === "verify" ? undefined : outputPath,
        publicKey,
      });
      if (command === "verify") {
        console.log(`Verified signatures for version ${feed.version} against public key.`);
      } else if (!outputPath) {
        console.log(JSON.stringify(feed, null, 2));
      } else {
        console.log(`Generated updater feed at ${outputPath}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error("Usage: update-feed.mjs [generate|verify] ...");
    process.exit(2);
  }
}
