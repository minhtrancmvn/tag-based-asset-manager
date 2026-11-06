import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppError, Asset, RenameApplyResult, RenameCollision, RenameDiscardReason, RenameMapping, RenameOutcome, RenamePreview, RenamePreviewOutcome,
  RenamePreviewRequest, RenameSavedSearchReplacement, RenameSkippedRow, RenameTargetSummary, SavedSearch, ScanIssue, ScanProgress, ScanResult, SearchFilters,
} from "./types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), channels: [] as { onmessage: ((value: ScanProgress) => void) | null }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke, isTauri: () => true,
  Channel: class {
    onmessage: ((value: ScanProgress) => void) | null = null;
    constructor() { mocks.channels.push(this); }
  },
}));
import { nativeClient, toAppError } from "./native";

beforeEach(() => { vi.clearAllMocks(); mocks.channels.length = 0; });

describe("native DTO bridge", () => {
  it("allows bounded raster data previews without allowing data scripts or documents", () => {
    const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
    const directives = new Map<string, string[]>(config.app.security.csp.split(";").map((directive: string) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }));
    expect(directives.get("img-src")).toContain("data:");
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src") ?? directives.get("default-src")).not.toContain("data:");
    expect(directives.get("script-src") ?? directives.get("default-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("frame-src") ?? directives.get("default-src")).not.toContain("data:");
    expect(directives.get("connect-src")).not.toContain("*");
  });
  it("uses only library IDs for native operations", async () => {
    await nativeClient.load();
    await nativeClient.choose();
    await nativeClient.activate("root1");
    await nativeClient.remove("root1");
    expect(mocks.invoke.mock.calls).toEqual([
      ["library_state"], ["choose_library"], ["activate_library", { libraryId: "root1" }], ["remove_library", { libraryId: "root1" }],
    ]);
  });
  it("persists app theme without any library or filesystem path", async () => {
    expect(nativeClient.setTheme).toBeTypeOf("function");
    mocks.invoke.mockResolvedValueOnce({ libraries: [], activeLibraryId: null, theme: "midnight" });
    expect(await nativeClient.setTheme("midnight")).toEqual({ libraries: [], activeLibraryId: null, theme: "midnight" });
    expect(mocks.invoke.mock.calls).toEqual([["set_app_theme", { theme: "midnight" }]]);
  });
  it("round-trips Aurora exactly without library ID or filesystem path", async () => {
    const aurora: import("./types").AppTheme = "aurora";
    const committed = { libraries: [], activeLibraryId: null, theme: aurora };
    mocks.invoke.mockResolvedValueOnce(committed);
    expect(await nativeClient.setTheme(aurora)).toBe(committed);
    expect(mocks.invoke.mock.calls).toEqual([["set_app_theme", { theme: "aurora" }]]);
  });
  it("passes typed progress channel with request ID", async () => {
    const progress = vi.fn();
    await nativeClient.scan("root1", "scan1", progress);
    expect(mocks.invoke).toHaveBeenCalledWith("scan_library", { libraryId: "root1", scanId: "scan1", onProgress: mocks.channels[0] });
    mocks.channels[0].onmessage?.({ libraryId: "root1", scanId: "scan1", visited: 128 });
    expect(progress).toHaveBeenCalledWith({ libraryId: "root1", scanId: "scan1", visited: 128 });
  });
  it("requests cancellation by library and scan ID only", async () => {
    await nativeClient.cancelScan("root1", "scan1");
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_scan", { libraryId: "root1", scanId: "scan1" });
  });
  it("sends approved IDs for trash and preview without arbitrary paths", async () => {
    const targets = [{ assetId: "path:photo.png", expectedRevision: "rev" }];
    await nativeClient.deleteAssets("root1", targets);
    await nativeClient.previewAsset("root1", "path:photo.png");
    expect(mocks.invoke.mock.calls).toEqual([
      ["delete_assets", { libraryId: "root1", targets }],
      ["preview_asset", { libraryId: "root1", assetId: "path:photo.png" }],
    ]);
  });
  it("sends only ID and revision for sidecar tag edit", async () => {
    await nativeClient.editTags("root1", "path:Figures/Dragon.3mf", "revision1", ["style:flexi"], ["status:printed"]);
    expect(mocks.invoke).toHaveBeenCalledWith("edit_tags", { libraryId: "root1", assetId: "path:Figures/Dragon.3mf", expectedRevision: "revision1", addTags: ["style:flexi"], removeTags: ["status:printed"] });
  });
  it("sends only library ID, row ID, revision and note text for notes edit", async () => {
    await nativeClient.editNotes("root1", "path:Figures/Dragon.3mf", "revision-notes", "  exact text  ");
    expect(mocks.invoke).toHaveBeenCalledWith("edit_notes", { libraryId: "root1", assetId: "path:Figures/Dragon.3mf", expectedRevision: "revision-notes", notes: "  exact text  " });
  });
  it("passes exact bulk target revisions and tag summary", async () => {
    const targets = [{ assetId: "path:Dragon.3mf", expectedRevision: "rev1" }, { assetId: "path:Folder", expectedRevision: "rev2" }];
    await nativeClient.bulkEditTags("root1", targets, ["favorite"], ["status:printed"]);
    expect(mocks.invoke).toHaveBeenCalledWith("bulk_edit_tags", { libraryId: "root1", targets, addTags: ["favorite"], removeTags: ["status:printed"] });
  });
  it("persists named filters locally with explicit update identity", async () => {
    const filters = { query: 'category:animal "猫"', view: "attention" as const, matchMode: "any" as const, kind: "folder" as const };
    await nativeClient.saveSearch("root1", "Animals", filters, "search1");
    await nativeClient.deleteSearch("root1", "search1");
    expect(mocks.invoke.mock.calls).toEqual([
      ["upsert_saved_search", { libraryId: "root1", name: "Animals", filters, searchId: "search1" }],
      ["delete_saved_search", { libraryId: "root1", searchId: "search1" }],
    ]);
  });
  it("uses ID-only native file actions and picker-only export destination", async () => {
    await nativeClient.performAction("root1", "path:猫 file.stl", "copyFullPath");
    await nativeClient.validateMetadata("root1");
    await nativeClient.exportMetadata("root1");
    expect(mocks.invoke.mock.calls).toEqual([
      ["asset_action", { libraryId: "root1", assetId: "path:猫 file.stl", action: "copyFullPath" }],
      ["validate_metadata", { libraryId: "root1" }],
      ["export_metadata", { libraryId: "root1" }],
    ]);
  });
  it("binds reconnect to missing revision and explicit target ID", async () => {
    await nativeClient.getReconnectTargets("root1", "path:gone.stl", "rev1");
    await nativeClient.reconnectAsset("root1", "path:gone.stl", "rev1", "path:renamed.stl");
    expect(mocks.invoke.mock.calls).toEqual([
      ["reconnect_targets", { libraryId: "root1", assetId: "path:gone.stl", expectedRevision: "rev1" }],
      ["reconnect_asset", { libraryId: "root1", assetId: "path:gone.stl", expectedRevision: "rev1", targetAssetId: "path:renamed.stl" }],
    ]);
  });
  it("binds missing-entry removal to the missing revision", async () => {
    await nativeClient.removeMissingEntry("root1", "path:gone.stl", "rev1");
    expect(mocks.invoke.mock.calls).toEqual([
      ["remove_missing_entry", { libraryId: "root1", assetId: "path:gone.stl", expectedRevision: "rev1" }],
    ]);
  });
  it("starts a tag-rename preview with the request and a typed progress channel", async () => {
    const outcome: RenamePreviewOutcome = { status: "cancelled" };
    mocks.invoke.mockResolvedValueOnce(outcome);
    const request: RenamePreviewRequest = {
      libraryId: "root1", scanId: "preview-scan1", mode: "prefix", source: " Status: ", destination: "State",
      normalizedMapping: { mode: "prefix", source: "status", destination: "state" },
      savedSearchReplacements: [],
    };
    const progress = vi.fn();
    expect(await nativeClient.previewTagRename(request, progress)).toBe(outcome);
    expect(mocks.invoke.mock.calls).toEqual([["preview_tag_rename", { request, onProgress: mocks.channels[0] }]]);
    expect(mocks.invoke.mock.calls[0]?.[1].request).toBe(request);
    mocks.channels[0]?.onmessage?.({ libraryId: "root1", scanId: "preview-scan1", visited: 42 });
    expect(progress).toHaveBeenCalledWith({ libraryId: "root1", scanId: "preview-scan1", visited: 42 });
  });
  it("applies a tag rename by library ID and opaque preview ID only", async () => {
    await nativeClient.applyTagRename("root1", "preview-1");
    expect(mocks.invoke.mock.calls).toEqual([["apply_tag_rename", { libraryId: "root1", previewId: "preview-1" }]]);
  });
  it("cancels a running rename preview through the existing scan cancellation", async () => {
    expect(Object.keys(nativeClient).filter((key) => /cancel/i.test(key))).toEqual(["cancelScan"]);
    await nativeClient.cancelScan("root1", "preview-scan1");
    expect(mocks.invoke.mock.calls).toEqual([["cancel_scan", { libraryId: "root1", scanId: "preview-scan1" }]]);
  });
  it("keeps structured error details", () => {
    expect(toAppError({ message: "Cannot read library", path: "/selected", details: "Permission denied" })).toEqual({ message: "Cannot read library", path: "/selected", details: "Permission denied" });
  });
  it("keeps JavaScript exceptions in technical details", () => {
    const result = toAppError(new Error("Unexpected command response"));
    expect(result.message).toBe("Operation could not finish. Try again or choose another library.");
    expect(result.details).toContain("Unexpected command response");
  });
  it("wraps unexpected failures in nontechnical message", () => {
    expect(toAppError("IPC not available")).toEqual({ message: "Operation could not finish. Try again or choose another library.", path: null, details: "IPC not available" });
  });
});

// Golden DTO fixture (MP2-5): shared with the Rust serialization tests in tag_rename_tests.rs.
// Unknown request keys would be rejected by Rust's deny_unknown_fields; response key drift would
// silently become undefined here, so every DTO is checked for its exact key set.

/** Per key: true = must be present, false = may be absent. Compile-time exhaustive over keyof T. */
type KeyShape<T> = { [K in keyof T]-?: boolean };

function expectExactKeys<T extends object>(value: unknown, shape: KeyShape<T>, label: string): T {
  expect(typeof value === "object" && value !== null && !Array.isArray(value), `${label} is an object`).toBe(true);
  const actual = Object.keys(value as object);
  const allowed = Object.keys(shape);
  const required = allowed.filter((key) => (shape as Record<string, boolean>)[key]);
  expect(actual.filter((key) => !allowed.includes(key)), `${label}: unexpected keys`).toEqual([]);
  expect(required.filter((key) => !actual.includes(key)), `${label}: missing keys`).toEqual([]);
  return value as T;
}

const filtersShape: KeyShape<SearchFilters> = { query: true, view: true, matchMode: true, kind: true };
const mappingShape: KeyShape<RenameMapping> = { mode: true, source: true, destination: true };
const replacementShape: KeyShape<RenameSavedSearchReplacement> = { searchId: true, expectedFilters: true, filters: true };
const requestShape: KeyShape<RenamePreviewRequest> = { libraryId: true, scanId: true, mode: true, source: true, destination: true, normalizedMapping: true, savedSearchReplacements: true };
// notes is omitted when absent; metadata fields are always serialized by the fixture's scan rows.
const assetShape: KeyShape<Asset> = { id: true, name: true, relativePath: true, kind: true, extension: true, modifiedAt: true, sizeBytes: true, tags: true, status: true, notes: false, metadataId: true, metadataState: true, metadataRevision: true };
const issueShape: KeyShape<ScanIssue> = { message: true, path: true, details: true };
const scanShape: KeyShape<ScanResult> = { libraryId: true, scanId: true, assets: true, issues: true, scannedAt: true };
const targetShape: KeyShape<RenameTargetSummary> = { assetId: true, relativePath: true, kind: true, sidecarOwner: true, duplicatesCollapsed: true };
const collisionShape: KeyShape<RenameCollision> = { from: true, to: true };
const skippedShape: KeyShape<RenameSkippedRow> = { assetId: true, relativePath: true, kind: true, reason: true, message: true };
const previewShape: KeyShape<RenamePreview> = {
  previewId: true, libraryId: true, scanId: true, mapping: true, scan: true, targets: true, fileCount: true, folderCount: true, sidecarCount: true,
  destinationExists: true, collisions: true, duplicatesCollapsed: true, skipped: true, uninspectable: true, savedSearchUpdateCount: true, settingsRetry: true,
};
const savedSearchShape: KeyShape<SavedSearch> = { id: true, libraryId: true, name: true, filters: true };
const errorShape: KeyShape<AppError> = { message: true, path: true, details: true };
const applyShape: KeyShape<RenameApplyResult> = {
  previewId: true, libraryId: true, mapping: true, committed: true, failed: true, unattempted: true, failingSidecar: true, skipped: true,
  uninspectable: true, savedSearches: true, error: true, outcome: true, queryMigrated: true,
};
const discardReasons: Record<RenameDiscardReason, true> = { mutation: true, "library-changed": true, "sidecar-changed": true };
const applyOutcomes: Record<RenameOutcome, true> = { complete: true, partial: true, "settings-failed": true };

function checkFilters(value: unknown, label: string): void {
  const filters = expectExactKeys<SearchFilters>(value, filtersShape, label);
  expect(["all", "untagged", "attention"]).toContain(filters.view);
  expect(["all", "any"]).toContain(filters.matchMode);
  expect(["all", "file", "folder"]).toContain(filters.kind);
}
function checkMapping(value: unknown, label: string): void {
  const mapping = expectExactKeys<RenameMapping>(value, mappingShape, label);
  expect(["exact", "prefix"]).toContain(mapping.mode);
}
function checkAssets(values: unknown, label: string): void {
  expect(Array.isArray(values), `${label} is an array`).toBe(true);
  (values as unknown[]).forEach((asset, index) => {
    const row = expectExactKeys<Asset>(asset, assetShape, `${label}[${index}]`);
    expect(["file", "folder"]).toContain(row.kind);
    expect(["ready", "untagged", "missing", "warning"]).toContain(row.status);
    expect(["none", "valid", "blocked"]).toContain(row.metadataState);
  });
}
function checkIssues(values: unknown, label: string): void {
  (values as unknown[]).forEach((issue, index) => expectExactKeys<ScanIssue>(issue, issueShape, `${label}[${index}]`));
}
function checkTargets(values: unknown, label: string): void {
  (values as unknown[]).forEach((target, index) => {
    const row = expectExactKeys<RenameTargetSummary>(target, targetShape, `${label}[${index}]`);
    expect(["file", "folder"]).toContain(row.kind);
    expect(Number.isInteger(row.duplicatesCollapsed)).toBe(true);
  });
}
function checkSkipped(values: unknown, label: string): void {
  (values as unknown[]).forEach((skipped, index) => {
    const row = expectExactKeys<RenameSkippedRow>(skipped, skippedShape, `${label}[${index}]`);
    expect(["file", "folder"]).toContain(row.kind);
    expect(["missing", "blocked"]).toContain(row.reason);
  });
}
function checkRequest(value: unknown): void {
  const request = expectExactKeys<RenamePreviewRequest>(value, requestShape, "request");
  expect(["exact", "prefix"]).toContain(request.mode);
  checkMapping(request.normalizedMapping, "request.normalizedMapping");
  request.savedSearchReplacements.forEach((replacement, index) => {
    expectExactKeys<RenameSavedSearchReplacement>(replacement, replacementShape, `request.savedSearchReplacements[${index}]`);
    checkFilters(replacement.expectedFilters, `request.savedSearchReplacements[${index}].expectedFilters`);
    checkFilters(replacement.filters, `request.savedSearchReplacements[${index}].filters`);
  });
}
function checkPreview(value: unknown, label: string): void {
  const preview = expectExactKeys<RenamePreview>(value, previewShape, label);
  checkMapping(preview.mapping, `${label}.mapping`);
  expectExactKeys<ScanResult>(preview.scan, scanShape, `${label}.scan`);
  checkAssets(preview.scan.assets, `${label}.scan.assets`);
  checkIssues(preview.scan.issues, `${label}.scan.issues`);
  checkTargets(preview.targets, `${label}.targets`);
  preview.collisions.forEach((collision, index) => expectExactKeys<RenameCollision>(collision, collisionShape, `${label}.collisions[${index}]`));
  checkSkipped(preview.skipped, `${label}.skipped`);
  checkIssues(preview.uninspectable, `${label}.uninspectable`);
  expect(typeof preview.settingsRetry).toBe("boolean");
  expect(preview.duplicatesCollapsed).toBe(preview.targets.reduce((total, target) => total + target.duplicatesCollapsed, 0));
}
function checkApply(value: unknown, label: string): void {
  const result = expectExactKeys<RenameApplyResult>(value, applyShape, label);
  checkMapping(result.mapping, `${label}.mapping`);
  checkAssets(result.committed, `${label}.committed`);
  checkTargets(result.failed, `${label}.failed`);
  checkTargets(result.unattempted, `${label}.unattempted`);
  checkSkipped(result.skipped, `${label}.skipped`);
  checkIssues(result.uninspectable, `${label}.uninspectable`);
  result.savedSearches.forEach((search, index) => {
    expectExactKeys<SavedSearch>(search, savedSearchShape, `${label}.savedSearches[${index}]`);
    checkFilters(search.filters, `${label}.savedSearches[${index}].filters`);
  });
  if (result.error !== null) expectExactKeys<AppError>(result.error, errorShape, `${label}.error`);
  expect(Object.keys(applyOutcomes)).toContain(result.outcome);
  expect(typeof result.queryMigrated).toBe("boolean");
}

interface DtoFixture {
  request: RenamePreviewRequest;
  preview: RenamePreview;
  retryPreview: RenamePreview;
  applyComplete: RenameApplyResult;
  applyPartial: RenameApplyResult;
  applySettingsFailed: RenameApplyResult;
  previewOutcomeReady: RenamePreviewOutcome;
  previewOutcomeCancelled: RenamePreviewOutcome;
  previewOutcomeDiscarded: RenamePreviewOutcome;
}
const fixture = JSON.parse(readFileSync(new URL("../fixtures/tag-rename-dto.json", import.meta.url), "utf8")) as DtoFixture;

describe("tag-rename golden DTO fixture", () => {
  it("keeps the preview request to exactly the keys native accepts, with no saved-search name", () => {
    checkRequest(fixture.request);
    const named = { searchId: "s", name: "Printed", expectedFilters: fixture.request.savedSearchReplacements[0]?.expectedFilters, filters: fixture.request.savedSearchReplacements[0]?.filters };
    expect(() => expectExactKeys<RenameSavedSearchReplacement>(named, replacementShape, "named replacement")).toThrow();
    // @ts-expect-error the native replacement has no name field; excess properties are rejected at compile time
    const compileTimeOnly: RenameSavedSearchReplacement = { searchId: "s", name: "Printed", expectedFilters: fixture.request.normalizedMapping as never, filters: fixture.request.normalizedMapping as never };
    expect(compileTimeOnly).toBeDefined();
  });
  it("rejects fixtures that drift from the type shape", () => {
    expect(() => expectExactKeys<RenameCollision>({ from: "a" }, collisionShape, "missing")).toThrow();
    expect(() => expectExactKeys<RenameCollision>({ from: "a", to: "b", extra: 1 }, collisionShape, "extra")).toThrow();
  });
  it("matches the preview DTOs, including the zero-target settings retry", () => {
    checkPreview(fixture.preview, "preview");
    checkPreview(fixture.retryPreview, "retryPreview");
    expect(fixture.preview.targets.map((target) => target.duplicatesCollapsed)).toEqual([0, 1, 0]);
    expect(fixture.preview.settingsRetry).toBe(false);
    expect(fixture.retryPreview).toMatchObject({ targets: [], settingsRetry: true, fileCount: 0, folderCount: 0, sidecarCount: 0 });
  });
  it("matches each tagged preview outcome", () => {
    const { previewOutcomeReady: ready, previewOutcomeCancelled: cancelled, previewOutcomeDiscarded: discarded } = fixture;
    expectExactKeys<Extract<RenamePreviewOutcome, { status: "ready" }>>(ready, { status: true, preview: true }, "ready");
    expectExactKeys<Extract<RenamePreviewOutcome, { status: "cancelled" }>>(cancelled, { status: true }, "cancelled");
    expectExactKeys<Extract<RenamePreviewOutcome, { status: "discarded" }>>(discarded, { status: true, reason: true }, "discarded");
    if (ready.status !== "ready") throw new Error("ready fixture has the wrong status");
    checkPreview(ready.preview, "previewOutcomeReady.preview");
    expect(ready.preview).toEqual(fixture.preview);
    expect(cancelled.status).toBe("cancelled");
    if (discarded.status !== "discarded") throw new Error("discarded fixture has the wrong status");
    expect(Object.keys(discardReasons)).toContain(discarded.reason);
  });
  it("narrows every preview status exhaustively", () => {
    const describeOutcome = (outcome: RenamePreviewOutcome): string => {
      switch (outcome.status) {
        case "ready": return outcome.preview.previewId;
        case "cancelled": return "cancelled";
        case "discarded": return outcome.reason;
        default: { const unreachable: never = outcome; return unreachable; }
      }
    };
    expect([fixture.previewOutcomeReady, fixture.previewOutcomeCancelled, fixture.previewOutcomeDiscarded].map(describeOutcome)).toEqual([fixture.preview.previewId, "cancelled", "mutation"]);
  });
  it("matches the complete, partial and settings-failed apply results", () => {
    checkApply(fixture.applyComplete, "applyComplete");
    checkApply(fixture.applyPartial, "applyPartial");
    checkApply(fixture.applySettingsFailed, "applySettingsFailed");
    expect([fixture.applyComplete.outcome, fixture.applyPartial.outcome, fixture.applySettingsFailed.outcome]).toEqual(["complete", "partial", "settings-failed"]);
    expect(fixture.applyPartial.failed.length).toBe(1);
    expect(fixture.applyPartial.unattempted.length).toBe(1);
    expect(fixture.applyPartial.failingSidecar).toBe("Models/.asset-tags.json");
    expect(fixture.applyComplete.error).toBeNull();
    expect(fixture.applySettingsFailed.queryMigrated).toBe(false);
  });
});
