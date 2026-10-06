// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLibrary } from "./useLibrary";
import type { LibraryClient } from "./native";
import type { LibraryState, ScanProgress, ScanResult } from "./types";

const registered: LibraryState = {
  libraries: [{ id: "root1", name: "Library", rootPath: "/selected/library", assetCount: 0, lastScanAt: null }],
  activeLibraryId: "root1",
};
const scanResult: ScanResult = {
  libraryId: "root1", scanId: "unused", assets: [{ id: "path:a.stl", name: "a.stl", relativePath: "a.stl", kind: "file", extension: "stl", modifiedAt: null, sizeBytes: 5, tags: [], status: "untagged", metadataRevision: "rev1", metadataState: "none", metadataId: null }], issues: [], scannedAt: "2026-10-05T12:00:00Z",
};
function client(overrides: Partial<LibraryClient> = {}): LibraryClient {
  return {
    isDesktop: true,
    load: vi.fn().mockResolvedValue(registered), choose: vi.fn().mockResolvedValue(null),
    activate: vi.fn().mockResolvedValue(registered), remove: vi.fn().mockResolvedValue({ libraries: [], activeLibraryId: null }),
    scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId })),
    editTags: vi.fn(async (_libraryId, _assetId, _revision, addTags) => ({ ...scanResult.assets[0], tags: addTags, metadataId: "new-uuid", metadataRevision: "rev2", metadataState: "valid" as const, status: "ready" as const })),
    bulkEditTags: vi.fn().mockResolvedValue({ assets: [], error: null }),
    saveSearch: vi.fn().mockResolvedValue(registered), deleteSearch: vi.fn().mockResolvedValue(registered),
    performAction: vi.fn().mockResolvedValue(undefined),
    validateMetadata: vi.fn().mockResolvedValue({ libraryId: "root1", assetsChecked: 1, issues: [], validatedAt: "2026-10-06T00:00:00Z" }),
    exportMetadata: vi.fn().mockResolvedValue(null),
    getReconnectTargets: vi.fn().mockResolvedValue([]),
    reconnectAsset: vi.fn().mockResolvedValue({ ...scanResult, scanId: "repair" }),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
afterEach(cleanup);

describe("native library lifecycle", () => {
  it("does not invoke native filesystem from browser", async () => {
    const api = client({ isDesktop: false });
    const { result } = renderHook(() => useLibrary(api));
    expect(result.current.isDesktop).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(api.load).not.toHaveBeenCalled();
    await act(() => result.current.chooseLibrary());
    expect(api.choose).not.toHaveBeenCalled();
  });
  it("loads persisted active library and scans it", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    expect(result.current.library?.id).toBe("root1");
    expect(result.current.library?.assetCount).toBe(1);
    expect(result.current.library?.lastScanAt).toBe(scanResult.scannedAt);
  });
  it("picker cancellation leaves existing library untouched", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(() => result.current.chooseLibrary());
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.library?.id).toBe("root1");
  });
  it("shows startup error rather than treating malformed settings as empty", async () => {
    const api = client({ load: vi.fn().mockRejectedValue({ message: "Settings unreadable", path: "/app/settings.json", details: "invalid JSON" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual({ message: "Settings unreadable", path: "/app/settings.json", details: "invalid JSON" });
  });
  it("ignores stale scan results after library removal", async () => {
    const pending = deferred<ScanResult>();
    const api = client({ scan: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    await act(() => result.current.removeLibrary("root1"));
    await act(async () => pending.resolve(scanResult));
    expect(result.current.library).toBeNull();
    expect(result.current.assets).toEqual([]);
  });
  it("ignores progress from another scan", async () => {
    let report!: (progress: ScanProgress) => void;
    let requestId = "";
    const pending = deferred<ScanResult>();
    const api = client({ scan: vi.fn((_libraryId, scanId, onProgress) => { report = onProgress; requestId = scanId; return pending.promise; }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    act(() => report({ libraryId: "root1", scanId: "old", visited: 999 }));
    expect(result.current.progress).toBe(0);
    act(() => report({ libraryId: "root1", scanId: requestId, visited: 128 }));
    expect(result.current.progress).toBe(128);
    await act(async () => pending.resolve({ ...scanResult, scanId: requestId }));
  });
  it("discards rows when rescan fails instead of presenting stale data as current", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    api.scan = vi.fn().mockRejectedValue({ message: "Library unavailable", path: "/selected/library", details: "not found" });
    await act(() => result.current.rescan());
    expect(result.current.assets).toEqual([]);
    expect(result.current.error?.message).toBe("Library unavailable");
    expect(result.current.scanning).toBe(false);
  });
  it("keeps the newer library when previous scan finishes later", async () => {
    const previous = deferred<ScanResult>();
    const nextState: LibraryState = { libraries: [...registered.libraries, { ...registered.libraries[0], id: "root2", name: "Second" }], activeLibraryId: "root2" };
    const api = client({
      activate: vi.fn().mockResolvedValue(nextState),
      scan: vi.fn((libraryId, scanId) => libraryId === "root1" ? previous.promise : Promise.resolve({ ...scanResult, libraryId, scanId, assets: [{ ...scanResult.assets[0], name: "new.stl" }] })),
    });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    await act(() => result.current.activateLibrary("root2"));
    await waitFor(() => expect(result.current.assets[0]?.name).toBe("new.stl"));
    await act(async () => previous.resolve(scanResult));
    expect(result.current.library?.id).toBe("root2");
    expect(result.current.assets[0].name).toBe("new.stl");
  });
  it("rejects mismatched response identifiers", async () => {
    const api = client({ scan: vi.fn().mockResolvedValue(scanResult) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.assets).toEqual([]);
    expect(result.current.scanning).toBe(false);
  });
  it("does not launch duplicate pickers while registration operation is pending", async () => {
    const pending = deferred<LibraryState | null>();
    const api = client({ choose: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let first!: Promise<void>;
    act(() => { first = result.current.chooseLibrary(); });
    await act(() => result.current.chooseLibrary());
    expect(api.choose).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(null); await first; });
  });
  it("applies confirmed tag result with revision and durable metadata identity", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.editTags(result.current.assets[0], ["category:animal"], [])).toBe(true); });
    expect(api.editTags).toHaveBeenCalledWith("root1", "path:a.stl", "rev1", ["category:animal"], []);
    expect(result.current.assets[0].tags).toEqual(["category:animal"]);
    expect(result.current.assets[0].metadataId).toBe("new-uuid");
  });
  it("retains tags and shows error if backend edit fails", async () => {
    const api = client({ editTags: vi.fn().mockRejectedValue({ message: "Metadata changed", path: "/selected/.asset-tags.json", details: "Rescan first" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.editTags(result.current.assets[0], ["favorite"], [])).toBe(false); });
    expect(result.current.assets[0].tags).toEqual([]);
    expect(result.current.error?.message).toBe("Metadata changed");
  });
  it("blocks missing or malformed metadata rows without native writes", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => {
      expect(await result.current.editTags({ ...result.current.assets[0], status: "missing" }, ["favorite"], [])).toBe(false);
      expect(await result.current.editTags({ ...result.current.assets[0], metadataState: "blocked" }, ["favorite"], [])).toBe(false);
    });
    expect(api.editTags).not.toHaveBeenCalled();
  });
  it("does not optimistically mutate tags or launch concurrent registration during edit", async () => {
    const pending = deferred<ScanResult["assets"][number]>();
    const api = client({ editTags: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let edit!: Promise<boolean>;
    act(() => { edit = result.current.editTags(result.current.assets[0], ["favorite"], []); });
    expect(result.current.editingAssetId).toBe("path:a.stl");
    expect(result.current.assets[0].tags).toEqual([]);
    await act(() => result.current.chooseLibrary());
    expect(api.choose).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ ...scanResult.assets[0], tags: ["favorite"] }); await edit; });
    expect(result.current.assets[0].tags).toEqual(["favorite"]);
    expect(result.current.editingAssetId).toBeNull();
  });
  it("blocks tag edits while scan is in progress", async () => {
    const pending = deferred<ScanResult>();
    const api = client({ scan: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    await act(async () => { expect(await result.current.editTags(scanResult.assets[0], ["favorite"], [])).toBe(false); });
    expect(api.editTags).not.toHaveBeenCalled();
  });
  it("ignores pending edit completion after unmount", async () => {
    const pending = deferred<ScanResult["assets"][number]>();
    const api = client({ editTags: vi.fn(() => pending.promise) });
    const { result, unmount } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let edit!: Promise<boolean>;
    act(() => { edit = result.current.editTags(result.current.assets[0], ["favorite"], []); });
    unmount();
    await act(async () => { pending.resolve({ ...scanResult.assets[0], tags: ["favorite"] }); expect(await edit).toBe(false); });
  });
  it("rejects mismatched tag response without replacing another row", async () => {
    const api = client({ editTags: vi.fn().mockResolvedValue({ ...scanResult.assets[0], id: "path:other.stl" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.editTags(result.current.assets[0], ["favorite"], [])).toBe(false); });
    expect(result.current.assets[0].id).toBe("path:a.stl");
    expect(result.current.error?.details).toContain("Metadata response did not match");
  });
  it("applies committed bulk rows while preserving explicit partial failure", async () => {
    const committed = { ...scanResult.assets[0], tags: ["favorite"], metadataRevision: "rev2" };
    const api = client({ bulkEditTags: vi.fn().mockResolvedValue({ assets: [committed], error: { message: "Only some changes saved", path: "/second/.asset-tags.json", details: "Write denied" } }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.bulkEditTags(result.current.assets, ["favorite"], [])).toBe(false); });
    expect(result.current.assets[0].tags).toEqual(["favorite"]);
    expect(result.current.error?.message).toBe("Only some changes saved");
    expect(api.bulkEditTags).toHaveBeenCalledWith("root1", [{ assetId: "path:a.stl", expectedRevision: "rev1" }], ["favorite"], []);
  });
  it("rejects blocked selection before bulk command rather than silently skipping rows", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.bulkEditTags([{ ...result.current.assets[0], metadataState: "blocked" }], ["favorite"], [])).toBe(false); });
    expect(api.bulkEditTags).not.toHaveBeenCalled();
  });
  it("saves search preferences without rescanning or clearing catalog selection data", async () => {
    const filters = { query: 'category:animal "猫"', view: "all" as const, matchMode: "any" as const, kind: "folder" as const };
    const next = { ...registered, savedSearches: [{ id: "search1", libraryId: "root1", name: "Animals", filters }] };
    const api = client({ saveSearch: vi.fn().mockResolvedValue(next) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.saveSearch("Animals", filters)).toBe(true); });
    expect(result.current.savedSearches).toEqual(next.savedSearches);
    expect(result.current.assets).toHaveLength(1);
    expect(api.scan).toHaveBeenCalledTimes(1);
    expect(api.saveSearch).toHaveBeenCalledWith("root1", "Animals", filters, null);
  });
  it("keeps existing searches if preferences write fails", async () => {
    const api = client({ saveSearch: vi.fn().mockRejectedValue({ message: "Settings write failed", path: "/app/settings.json", details: "Denied" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.saveSearch("Search", { query: "", view: "all", matchMode: "all", kind: "all" })).toBe(false); });
    expect(result.current.savedSearches).toEqual([]);
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.error?.message).toBe("Settings write failed");
  });
  it("deletes saved search registration without rescanning assets", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.deleteSearch("search1")).toBe(true); });
    expect(api.deleteSearch).toHaveBeenCalledWith("root1", "search1");
    expect(api.scan).toHaveBeenCalledTimes(1);
  });
  it("locks registration and single edits while bulk request is pending", async () => {
    const pending = deferred<{ assets: typeof scanResult.assets; error: null }>();
    const api = client({ bulkEditTags: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let bulk!: Promise<boolean>;
    act(() => { bulk = result.current.bulkEditTags(result.current.assets, ["favorite"], []); });
    expect(result.current.bulkEditing).toBe(true);
    await act(() => result.current.chooseLibrary());
    await act(async () => { expect(await result.current.editTags(result.current.assets[0], ["favorite"], [])).toBe(false); });
    expect(api.choose).not.toHaveBeenCalled();
    expect(api.editTags).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ assets: [{ ...scanResult.assets[0], tags: ["favorite"] }], error: null }); expect(await bulk).toBe(true); });
    expect(result.current.bulkEditing).toBe(false);
  });
  it("ignores saved-search completion after unmount", async () => {
    const pending = deferred<LibraryState>();
    const api = client({ saveSearch: vi.fn(() => pending.promise) });
    const { result, unmount } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let save!: Promise<boolean>;
    act(() => { save = result.current.saveSearch("Search", { query: "", view: "all", matchMode: "all", kind: "all" }); });
    unmount();
    await act(async () => { pending.resolve(registered); expect(await save).toBe(false); });
  });
  it("dispatches native actions by approved asset ID and safe enum", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.performAction(result.current.assets[0], "reveal")).toBe(true); });
    expect(api.performAction).toHaveBeenCalledWith("root1", "path:a.stl", "reveal");
    await act(async () => { expect(await result.current.performAction({ ...result.current.assets[0], status: "missing" }, "open")).toBe(false); });
    expect(api.performAction).toHaveBeenCalledTimes(1);
  });
  it("stores fresh validation without clearing scanned assets", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.validateMetadata()).toBe(true); });
    expect(result.current.validation?.assetsChecked).toBe(1);
    expect(result.current.assets).toHaveLength(1);
    expect(api.scan).toHaveBeenCalledTimes(1);
  });
  it("export cancellation is neutral and clears old success result", async () => {
    const api = client({ exportMetadata: vi.fn().mockResolvedValueOnce({ path: "/chosen/backup.json", assetCount: 1 }).mockResolvedValueOnce(null) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.exportMetadata()).toBe(true); });
    expect(result.current.exportResult?.path).toBe("/chosen/backup.json");
    await act(async () => { expect(await result.current.exportMetadata()).toBe(false); });
    expect(result.current.exportResult).toBeNull();
    expect(result.current.error).toBeNull();
  });
  it("requests reconnect choices only for valid missing metadata", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    const missing = { ...result.current.assets[0], status: "missing" as const, metadataState: "valid" as const, metadataId: "uuid" };
    await act(async () => { expect(await result.current.getReconnectTargets(missing)).toEqual([]); });
    expect(api.getReconnectTargets).toHaveBeenCalledWith("root1", "path:a.stl", "rev1");
    await act(async () => { expect(await result.current.getReconnectTargets({ ...missing, metadataState: "blocked" })).toBeNull(); });
    expect(api.getReconnectTargets).toHaveBeenCalledTimes(1);
  });
  it("applies confirmed repair as fresh scan and clears obsolete validation", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(() => result.current.validateMetadata());
    const source = { ...result.current.assets[0], status: "missing" as const, metadataState: "valid" as const, metadataId: "uuid" };
    await act(async () => { expect(await result.current.reconnectAsset(source, result.current.assets[0])).toBe(true); });
    expect(api.reconnectAsset).toHaveBeenCalledWith("root1", "path:a.stl", "rev1", "path:a.stl");
    expect(result.current.validation).toBeNull();
    expect(result.current.recoveryBusy).toBe(false);
  });
  it("holds other mutations while native operation is pending", async () => {
    const pending = deferred<void>();
    const api = client({ performAction: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let action!: Promise<boolean>;
    act(() => { action = result.current.performAction(result.current.assets[0], "open"); });
    expect(result.current.actionBusy).toBe(true);
    await act(() => result.current.chooseLibrary());
    expect(api.choose).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); await action; });
    expect(result.current.actionBusy).toBe(false);
  });
  it("does not expose validation returned for another library", async () => {
    const api = client({ validateMetadata: vi.fn().mockResolvedValue({ libraryId: "other", assetsChecked: 1, issues: [], validatedAt: "2026-10-06T00:00:00Z" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.validateMetadata()).toBe(false); });
    expect(result.current.validation).toBeNull();
    expect(result.current.error?.details).toContain("Validation response did not match");
  });
  it("clears validation and export result when changing library", async () => {
    const api = client({ exportMetadata: vi.fn().mockResolvedValue({ path: "/backup.json", assetCount: 1 }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(() => result.current.validateMetadata());
    await act(() => result.current.exportMetadata());
    await act(() => result.current.removeLibrary("root1"));
    expect(result.current.validation).toBeNull();
    expect(result.current.exportResult).toBeNull();
  });
  it("does not apply repair result after unmount", async () => {
    const pending = deferred<ScanResult>();
    const api = client({ reconnectAsset: vi.fn(() => pending.promise) });
    const { result, unmount } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    const missing = { ...result.current.assets[0], status: "missing" as const, metadataState: "valid" as const, metadataId: "uuid" };
    let repair!: Promise<boolean>;
    act(() => { repair = result.current.reconnectAsset(missing, result.current.assets[0]); });
    unmount();
    await act(async () => { pending.resolve(scanResult); expect(await repair).toBe(false); });
  });
  it("never updates after unmount", async () => {
    const pending = deferred<LibraryState>();
    const api = client({ load: vi.fn(() => pending.promise) });
    const { unmount } = renderHook(() => useLibrary(api));
    unmount();
    await act(async () => pending.resolve(registered));
    expect(api.scan).not.toHaveBeenCalled();
  });
});
