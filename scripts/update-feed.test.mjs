import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_REPOSITORY,
  SUPPORTED_PLATFORMS,
  buildPlatformUrl,
  decodeReleaseSignature,
  generateFeed,
  generateFeedFromArtifacts,
  getExpectedArtifactFilename,
  parsePublicKey,
  parseSignature,
  validatePlatformUrl,
  validateSemver,
  validateSignature,
  verifyMinisign,
} from "./update-feed.mjs";

// Real nonsecret test vectors from tauri-plugin-updater 2.14.1 updater.rs:2117-2123
export const TEST_PUBLIC_KEY_TEXT =
  "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
// Canonical Tauri public key configuration format: standard outer base64 of the 2-line minisign text
export const TEST_PUBLIC_KEY = Buffer.from(TEST_PUBLIC_KEY_TEXT, "utf8").toString("base64");

export const TEST_SIGNATURE =
  "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";
export const TEST_PAYLOAD = Buffer.from("test");

export const UNVERSIONED_PUBLIC_KEY_TEXT =
  "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
export const UNVERSIONED_PUBLIC_KEY = Buffer.from(UNVERSIONED_PUBLIC_KEY_TEXT, "utf8").toString("base64");

export const UNVERSIONED_SIGNATURE =
  "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==";

describe("validateSemver", () => {
  it("accepts valid canonical semver strings", () => {
    assert.equal(validateSemver("0.4.0"), "0.4.0");
    assert.equal(validateSemver("1.0.0"), "1.0.0");
    assert.equal(validateSemver("12.34.56"), "12.34.56");
  });

  it("normalizes leading v to canonical semver", () => {
    assert.equal(validateSemver("v0.4.0"), "0.4.0");
    assert.equal(validateSemver("v1.2.3"), "1.2.3");
  });

  it("rejects leading zeros on numeric identifiers", () => {
    assert.throws(() => validateSemver("01.0.0"), /Invalid semver/);
    assert.throws(() => validateSemver("0.04.0"), /Invalid semver/);
    assert.throws(() => validateSemver("1.2.03"), /Invalid semver/);
  });

  it("rejects non-semver, prerelease or incomplete versions", () => {
    assert.throws(() => validateSemver("0.4"), /Invalid semver/);
    assert.throws(() => validateSemver("latest"), /Invalid semver/);
    assert.throws(() => validateSemver("0.4.0-alpha"), /Invalid semver/);
    assert.throws(() => validateSemver(""), /Invalid semver/);
    assert.throws(() => validateSemver(null), /Invalid version type/);
    assert.throws(() => validateSemver(123), /Invalid version type/);
  });
});

describe("parsePublicKey", () => {
  it("parses canonical standard outer base64 two-line minisign public key (matching native plugin)", () => {
    const key = parsePublicKey(TEST_PUBLIC_KEY);
    assert.equal(key.keyIdDisplay, "A49EF4746FA6E6D7");
    assert.equal(key.rawKey.length, 32);
    assert.ok(key.keyObj);
    assert.equal(key.outerBase64, TEST_PUBLIC_KEY);
  });

  it("rejects plaintext minisign public key string (native plugin base64_to_string requirement)", () => {
    assert.throws(
      () => parsePublicKey(TEST_PUBLIC_KEY_TEXT),
      /plaintext minisign text provided|must be canonical standard base64/
    );
  });

  it("rejects noncanonical base64 input with invalid characters or formatting", () => {
    assert.throws(() => parsePublicKey("not valid base64!@#$"), /Invalid public key/);
    assert.throws(() => parsePublicKey(""), /Invalid minisign public key/);
  });

  it("rejects public key with unsupported algorithm", () => {
    // Modify algorithm bytes from [0x45, 0x64] (Ed) to [0x00, 0x00]
    const keyBytes = Buffer.from("RWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe", "base64");
    keyBytes[0] = 0x00;
    keyBytes[1] = 0x00;
    const badKeyText = `untrusted comment: bad\n${keyBytes.toString("base64")}`;
    const badKeyB64 = Buffer.from(badKeyText, "utf8").toString("base64");
    assert.throws(() => parsePublicKey(badKeyB64), /unsupported signature algorithm/);
  });

  it("rejects outer-base64 containing blank line after header", () => {
    const textWithBlankLine =
      "untrusted comment: minisign public key: A49EF4746FA6E6D7\n\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const b64 = Buffer.from(textWithBlankLine, "utf8").toString("base64");
    assert.throws(() => parsePublicKey(b64), /line 2 is not valid base64|expected at least 2 lines/);
  });

  it("rejects outer-base64 containing leading spaces on line 2 key", () => {
    const textWithLeadingSpaces =
      "untrusted comment: minisign public key: A49EF4746FA6E6D7\n  RWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const b64 = Buffer.from(textWithLeadingSpaces, "utf8").toString("base64");
    assert.throws(() => parsePublicKey(b64), /line 2 is not valid base64/);
  });
});

describe("verifyMinisign", () => {
  it("verifies authentic payload and signature against matching public key (real vector)", () => {
    const ok = verifyMinisign({
      data: TEST_PAYLOAD,
      signatureContent: TEST_SIGNATURE,
      publicKey: TEST_PUBLIC_KEY,
    });
    assert.equal(ok, true);
  });

  it("verifies unversioned real vector", () => {
    const ok = verifyMinisign({
      data: TEST_PAYLOAD,
      signatureContent: UNVERSIONED_SIGNATURE,
      publicKey: UNVERSIONED_PUBLIC_KEY,
    });
    assert.equal(ok, true);
  });

  it("rejects altered payload data", () => {
    assert.throws(
      () =>
        verifyMinisign({
          data: Buffer.from("tampered payload"),
          signatureContent: TEST_SIGNATURE,
          publicKey: TEST_PUBLIC_KEY,
        }),
      /Minisign signature verification failed/
    );
  });

  it("rejects altered trusted comment (e.g. version tampering)", () => {
    const lines = TEST_SIGNATURE.split("\n");
    lines[2] = "trusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.1";
    const tampered = lines.join("\n");
    assert.throws(
      () =>
        verifyMinisign({
          data: TEST_PAYLOAD,
          signatureContent: tampered,
          publicKey: TEST_PUBLIC_KEY,
        }),
      /Minisign global signature verification failed/
    );
  });

  it("rejects extra whitespace in authenticated trusted comment instead of normalizing it", () => {
    const signature = TEST_SIGNATURE.replace("trusted comment: timestamp:", "trusted comment:  timestamp:");
    assert.throws(
      () => verifyMinisign({ data: TEST_PAYLOAD, signatureContent: signature, publicKey: TEST_PUBLIC_KEY }),
      /Minisign global signature verification failed/
    );
  });

  it("rejects mismatched public key", () => {
    assert.throws(
      () =>
        verifyMinisign({
          data: TEST_PAYLOAD,
          signatureContent: TEST_SIGNATURE,
          publicKey: UNVERSIONED_PUBLIC_KEY,
        }),
      /Signature key ID does not match public key ID/
    );
  });
});

describe("parseSignature", () => {
  it("parses valid minisign 4-line signature with tab-separated version:<v>", () => {
    const parsed = parseSignature(TEST_SIGNATURE);
    assert.equal(parsed.untrustedComment, "signature from tauri secret key");
    assert.equal(parsed.appVersion, "2.0.0");
    assert.match(parsed.trustedComment, /\bversion:2\.0\.0\b/);
    assert.equal(typeof parsed.signature, "string");
    assert.equal(typeof parsed.globalSignature, "string");
  });

  it("handles outer base64 encoded minisign text transparently", () => {
    const b64 = Buffer.from(TEST_SIGNATURE, "utf8").toString("base64");
    const parsed = parseSignature(b64);
    assert.equal(parsed.appVersion, "2.0.0");
  });

  it("exact version-field parsing without per-field trimming matching plugin strip_prefix", () => {
    // Space before version: must NOT match, exactly like Rust strip_prefix("version:")
    const withLeadingSpace = TEST_SIGNATURE.replace("version:2.0.0", " version:2.0.0");
    const parsed = parseSignature(withLeadingSpace);
    assert.equal(parsed.appVersion, null);
  });

  it("returns null appVersion when version field is omitted", () => {
    const parsed = parseSignature(UNVERSIONED_SIGNATURE);
    assert.equal(parsed.appVersion, null);
  });

  it("rejects signature with incorrect line count", () => {
    assert.throws(() => parseSignature("only one line"), /expected 4 lines/);
  });

  it("requires native trusted-comment header including space after colon", () => {
    const signature = TEST_SIGNATURE.replace("trusted comment: timestamp:", "trusted comment:timestamp:");
    assert.throws(() => parseSignature(signature), /missing trusted comment header/);
  });

  it("rejects signature with unsupported signature algorithm", () => {
    const lines = TEST_SIGNATURE.split("\n");
    const sigBytes = Buffer.from(lines[1], "base64");
    sigBytes[0] = 0x00;
    sigBytes[1] = 0x00;
    lines[1] = sigBytes.toString("base64");
    const badSig = lines.join("\n");
    assert.throws(() => parseSignature(badSig), /unsupported signature algorithm/);
  });
});

describe("validateSignature", () => {
  it("succeeds when signature version matches expected version and verifies with public key", () => {
    const valid = validateSignature(TEST_SIGNATURE, "2.0.0", {
      data: TEST_PAYLOAD,
      publicKey: TEST_PUBLIC_KEY,
    });
    assert.equal(valid.appVersion, "2.0.0");
    assert.equal(typeof valid.outerBase64, "string");
  });

  it("rejects signature when signed version does not match expected version", () => {
    assert.throws(
      () => validateSignature(TEST_SIGNATURE, "2.1.0", { publicKey: TEST_PUBLIC_KEY }),
      /Signature version mismatch: expected 2.1.0, found 2.0.0/
    );
  });

  it("rejects signature without version binding", () => {
    assert.throws(
      () => validateSignature(UNVERSIONED_SIGNATURE, "2.0.0", { publicKey: UNVERSIONED_PUBLIC_KEY }),
      /Signature is not version-bound/
    );
  });
});

describe("decodeReleaseSignature", () => {
  it("decodes outer base64 to minisign text matching tauri-plugin-updater base64_to_string", () => {
    const outerBase64 = Buffer.from(TEST_SIGNATURE, "utf8").toString("base64");
    const decoded = decodeReleaseSignature(outerBase64);
    assert.equal(decoded, TEST_SIGNATURE);
  });
});

describe("getExpectedArtifactFilename", () => {
  it("returns canonical macOS updater tarball filename", () => {
    assert.equal(
      getExpectedArtifactFilename("darwin-aarch64", "2.0.0"),
      "Tag-Based-Asset-Manager_2.0.0_aarch64.app.tar.gz"
    );
  });

  it("returns canonical Windows NSIS installer filename", () => {
    assert.equal(
      getExpectedArtifactFilename("windows-x86_64", "2.0.0"),
      "Tag-Based-Asset-Manager_2.0.0_x64-setup.exe"
    );
  });

  it("rejects unsupported platforms", () => {
    assert.throws(() => getExpectedArtifactFilename("linux-x86_64", "2.0.0"), /Unsupported platform/);
  });
});

describe("buildPlatformUrl and validatePlatformUrl", () => {
  it("builds exact canonical GitHub release URLs", () => {
    const macUrl = buildPlatformUrl({
      platform: "darwin-aarch64",
      version: "2.0.0",
    });
    assert.equal(
      macUrl,
      "https://github.com/minhtrancmvn/tag-based-asset-manager/releases/download/v2.0.0/Tag-Based-Asset-Manager_2.0.0_aarch64.app.tar.gz"
    );
  });

  it("rejects local file paths in validatePlatformUrl", () => {
    assert.throws(
      () =>
        validatePlatformUrl("file:///local/path/app.tar.gz", {
          platform: "darwin-aarch64",
          version: "2.0.0",
        }),
      /Local paths are prohibited/
    );
  });
});

describe("generateFeed", () => {
  const version = "2.0.0";
  const notes = "Automated preview release notes.";
  const pubDate = "2026-10-30T15:00:00.000Z";

  function validPlatforms() {
    return {
      "darwin-aarch64": { signature: TEST_SIGNATURE },
      "windows-x86_64": { signature: TEST_SIGNATURE },
    };
  }

  it("requires publicKey and produces outer base64 signatures", () => {
    const feed = generateFeed({
      version,
      notes,
      pubDate,
      platforms: validPlatforms(),
      publicKey: TEST_PUBLIC_KEY,
    });

    assert.equal(feed.version, "2.0.0");
    const macSigRaw = feed.platforms["darwin-aarch64"].signature;
    const macDecoded = Buffer.from(macSigRaw, "base64").toString("utf8");
    assert.equal(macDecoded, TEST_SIGNATURE);
  });

  it("throws when publicKey is missing", () => {
    assert.throws(
      () =>
        generateFeed({
          version,
          notes,
          pubDate,
          platforms: validPlatforms(),
        }),
      /Public key is required/
    );
  });

  it("throws when signature does not match public key", () => {
    assert.throws(
      () =>
        generateFeed({
          version,
          notes,
          pubDate,
          platforms: validPlatforms(),
          publicKey: UNVERSIONED_PUBLIC_KEY,
        }),
      /Signature key ID does not match public key ID/
    );
  });
});

describe("generateFeedFromArtifacts", () => {
  let tempDir;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function setupArtifactFixture(version = "2.0.0", overrides = {}) {
    tempDir = mkdtempSync(join(tmpdir(), "feed-fixture-"));
    const macTar = join(tempDir, `Tag-Based-Asset-Manager_${version}_aarch64.app.tar.gz`);
    const macSig = `${macTar}.sig`;
    const winExe = join(tempDir, `Tag-Based-Asset-Manager_${version}_x64-setup.exe`);
    const winSig = `${winExe}.sig`;

    const macData = overrides.macData ?? TEST_PAYLOAD;
    const winData = overrides.winData ?? TEST_PAYLOAD;
    const macSigContent = overrides.macSig ?? TEST_SIGNATURE;
    const winSigContent = overrides.winSig ?? TEST_SIGNATURE;

    if (!overrides.skipMacTar) writeFileSync(macTar, macData);
    if (!overrides.skipMacSig) writeFileSync(macSig, macSigContent);
    if (!overrides.skipWinExe) writeFileSync(winExe, winData);
    if (!overrides.skipWinSig) writeFileSync(winSig, winSigContent);

    return tempDir;
  }

  it("verifies artifacts and writes latest.json with valid cryptographic signatures", () => {
    const dir = setupArtifactFixture("2.0.0");
    const outFile = join(dir, "latest.json");

    const feed = generateFeedFromArtifacts({
      artifactsDir: dir,
      version: "2.0.0",
      notes: "Test preview release.",
      publicKey: TEST_PUBLIC_KEY,
      outputPath: outFile,
    });

    assert.equal(feed.version, "2.0.0");
    const written = JSON.parse(readFileSync(outFile, "utf8"));
    assert.deepEqual(written, feed);
  });

  it("throws and fails before publication when artifact bytes are altered", () => {
    const dir = setupArtifactFixture("2.0.0", { macData: Buffer.from("corrupt bytes") });
    assert.throws(
      () =>
        generateFeedFromArtifacts({
          artifactsDir: dir,
          version: "2.0.0",
          notes: "test",
          publicKey: TEST_PUBLIC_KEY,
        }),
      /Minisign signature verification failed/
    );
  });

  it("throws and fails before publication when public key does not match signing key", () => {
    const dir = setupArtifactFixture("2.0.0");
    assert.throws(
      () =>
        generateFeedFromArtifacts({
          artifactsDir: dir,
          version: "2.0.0",
          notes: "test",
          publicKey: UNVERSIONED_PUBLIC_KEY,
        }),
      /Signature key ID does not match public key ID/
    );
  });
});

describe("release.yml workflow policy", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const releaseYmlPath = join(root, ".github", "workflows", "release.yml");
  const releaseYml = readFileSync(releaseYmlPath, "utf8");

  it("does not set TAURI_SIGNING_PRIVATE_KEY at job level and scopes it only to signing steps", () => {
    const buildJobHeader = releaseYml.split("jobs:")[1].split("steps:")[0];
    assert.doesNotMatch(buildJobHeader, /TAURI_SIGNING_PRIVATE_KEY:/);
  });

  it("does not expose private key arguments in pnpm tauri signer sign command line", () => {
    assert.doesNotMatch(releaseYml, /pnpm tauri signer sign.*--private-key/);
    assert.doesNotMatch(releaseYml, /pnpm tauri signer sign.*--password/);
  });

  it("runs update-feed manifest generation/verification before gh release create", () => {
    const releaseCreateIdx = releaseYml.indexOf("gh release create");
    const updateFeedIdx = releaseYml.indexOf("update-feed.mjs");
    assert.ok(releaseCreateIdx > 0, "gh release create must exist");
    assert.ok(updateFeedIdx > 0, "update-feed.mjs must exist");
    assert.ok(
      updateFeedIdx < releaseCreateIdx,
      "update-feed verification must run before gh release create"
    );
  });

  it("keeps feed clone URLs free of credentials and uses GitHub's credential helper for push", () => {
    assert.doesNotMatch(releaseYml, /https:\/\/x-access-token:/);
    assert.match(releaseYml, /credential\.helper='!gh auth git-credential'/);
  });

  it("fetches actual release notes body and publishes to update-preview branch after release creation", () => {
    assert.match(releaseYml, /gh release view "\$TAG" --json body/);
    assert.match(releaseYml, /push origin update-preview/);
  });
});
