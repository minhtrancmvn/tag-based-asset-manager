import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanProgress } from "./types";

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
