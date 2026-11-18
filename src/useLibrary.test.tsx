// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLibrary } from "./useLibrary";
import type { LibraryClient } from "./native";
import type { AppTheme, LibraryState, RenameApplyResult, RenamePreviewOutcome, ScanProgress, ScanResult } from "./types";

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
    setTheme: vi.fn(async (theme) => ({ ...registered, theme })),
    activate: vi.fn().mockResolvedValue(registered), remove: vi.fn().mockResolvedValue({ libraries: [], activeLibraryId: null }),
    scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId })), cancelScan: vi.fn().mockResolvedValue(true),
    editTags: vi.fn(async (_libraryId, _assetId, _revision, addTags) => ({ ...scanResult.assets[0], tags: addTags, metadataId: "new-uuid", metadataRevision: "rev2", metadataState: "valid" as const, status: "ready" as const })),
    editNotes: vi.fn(async (_libraryId, _assetId, _revision, notes) => ({ ...scanResult.assets[0], notes: notes || undefined, metadataId: "new-uuid", metadataRevision: "rev-notes", metadataState: "valid" as const, status: "ready" as const })),
    bulkEditTags: vi.fn().mockResolvedValue({ assets: [], error: null }),
    saveSearch: vi.fn().mockResolvedValue(registered), deleteSearch: vi.fn().mockResolvedValue(registered),
    performAction: vi.fn().mockResolvedValue(undefined),
    validateMetadata: vi.fn().mockResolvedValue({ libraryId: "root1", assetsChecked: 1, issues: [], validatedAt: "2026-10-06T00:00:00Z" }),
    exportMetadata: vi.fn().mockResolvedValue(null),
    getReconnectTargets: vi.fn().mockResolvedValue([]),
    reconnectAsset: vi.fn().mockResolvedValue({ ...scanResult, scanId: "repair" }),
    removeMissingEntry: vi.fn().mockResolvedValue({ ...scanResult, scanId: "removal", assets: [] }),
    deleteAssets: vi.fn().mockResolvedValue({ completedIds: ["path:a.stl"], error: null }),
    previewAsset: vi.fn().mockResolvedValue({ kind: "text", content: "preview", mimeType: "text/plain", truncated: false, message: null }),
    previewTagRename: vi.fn().mockResolvedValue({ status: "cancelled" } satisfies RenamePreviewOutcome),
    applyTagRename: vi.fn().mockResolvedValue({
      previewId: "preview-1", libraryId: "root1", mapping: { mode: "exact", source: "old", destination: "new" },
      committed: [], failed: [], unattempted: [], failingSidecar: null, skipped: [], uninspectable: [],
      savedSearches: [], error: null, outcome: "complete", queryMigrated: true,
    } satisfies RenameApplyResult),
    setUsageConsent: vi.fn().mockResolvedValue({ status: "saved", usage: { available: true, consent: "declined", saved: true } }),
    trackUsage: vi.fn().mockResolvedValue(undefined),
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

describe("app theme preference", () => {
  it("defaults legacy settings to workshop", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.theme).toBe("workshop");
  });
  it("loads stored theme without an active library", async () => {
    const api = client({ load: vi.fn().mockResolvedValue({ libraries: [], activeLibraryId: null, theme: "midnight" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.theme).toBe("midnight");
    expect(api.scan).not.toHaveBeenCalled();
  });
  it("loads stored Aurora without an active library", async () => {
    const api = client({ load: vi.fn().mockResolvedValue({ libraries: [], activeLibraryId: null, theme: "aurora" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.theme).toBe("aurora");
    expect(api.scan).not.toHaveBeenCalled();
  });
  it("commits Aurora while preserving catalog and unknown library state", async () => {
    const aurora: AppTheme = "aurora";
    const searches = [{ id: "s1", libraryId: "root1", name: "Saved", filters: { query: "favorite", view: "all" as const, matchMode: "all" as const, kind: "all" as const } }];
    const extension = { source: "future-settings" };
    const initialState = { ...registered, savedSearches: searches, extension };
    const api = client({
      load: vi.fn().mockResolvedValue(initialState),
      setTheme: vi.fn().mockResolvedValue({ ...registered, theme: aurora }),
    });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    const rows = result.current.assets;
    const library = result.current.library;

    await act(async () => { expect(await result.current.setTheme(aurora)).toBe(true); });

    expect(api.setTheme).toHaveBeenCalledOnce();
    expect(api.setTheme).toHaveBeenCalledWith(aurora);
    expect(result.current.theme).toBe(aurora);
    expect(result.current.assets).toBe(rows);
    expect(result.current.library).toBe(library);
    expect(result.current.savedSearches).toEqual(searches);
    expect(result.current.state).toMatchObject({ extension });
    expect(api.scan).toHaveBeenCalledTimes(1);
    expect(api.choose).not.toHaveBeenCalled();
    expect(api.activate).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.editTags).not.toHaveBeenCalled();
    expect(api.bulkEditTags).not.toHaveBeenCalled();
    expect(api.deleteAssets).not.toHaveBeenCalled();
    expect(api.exportMetadata).not.toHaveBeenCalled();
  });
  it("rejects Aurora neutrally while a different native action owns operation lock", async () => {
    const aurora: AppTheme = "aurora";
    const pending = deferred<void>();
    const api = client({ setTheme: vi.fn(), performAction: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let action!: Promise<boolean>;
    act(() => { action = result.current.performAction(result.current.assets[0], "open"); });
    expect(result.current.actionBusy).toBe(true);

    await act(async () => {
      expect(await result.current.setTheme(aurora)).toBe(false);
    });

    expect(result.current.theme).toBe("workshop");
    expect(result.current.error).toBeNull();
    expect(api.setTheme).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); await action; });
    expect(result.current.actionBusy).toBe(false);
  });
  it("commits theme without rescanning or replacing catalog settings", async () => {
    const setTheme = vi.fn().mockResolvedValue({ ...registered, theme: "coral" });
    const searches = [{ id: "s1", libraryId: "root1", name: "Saved", filters: { query: "favorite", view: "all" as const, matchMode: "all" as const, kind: "all" as const } }];
    const api = client({ load: vi.fn().mockResolvedValue({ ...registered, savedSearches: searches }), setTheme });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    const rows = result.current.assets;
    const library = result.current.library;
    expect(result.current.setTheme).toBeTypeOf("function");
    await act(async () => { expect(await result.current.setTheme("coral")).toBe(true); });
    expect(setTheme).toHaveBeenCalledWith("coral");
    expect(result.current.theme).toBe("coral");
    expect(result.current.assets).toBe(rows);
    expect(result.current.library).toBe(library);
    expect(result.current.savedSearches).toEqual(searches);
    expect(api.scan).toHaveBeenCalledTimes(1);
  });
  it("saves theme without a library and holds other mutations while pending", async () => {
    const pending = deferred<LibraryState>();
    const setTheme = vi.fn(() => pending.promise);
    const api = client({ load: vi.fn().mockResolvedValue({ libraries: [], activeLibraryId: null }), setTheme });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setTheme).toBeTypeOf("function");
    let saved!: Promise<boolean>;
    act(() => { saved = result.current.setTheme("midnight"); });
    expect(result.current.savingTheme).toBe(true);
    expect(result.current.theme).toBe("workshop");
    await act(async () => { expect(await result.current.setTheme("mint")).toBe(false); await result.current.chooseLibrary(); });
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(api.choose).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ libraries: [], activeLibraryId: null, theme: "midnight" }); await saved; });
    expect(result.current.theme).toBe("midnight");
    expect(result.current.savingTheme).toBe(false);
  });
  it("preserves committed theme when Aurora persistence fails", async () => {
    const aurora: AppTheme = "aurora";
    const failure = { message: "Settings write failed", path: null, details: "injected" };
    const api = client({ setTheme: vi.fn().mockRejectedValue(failure) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { expect(await result.current.setTheme(aurora)).toBe(false); });

    expect(result.current.theme).toBe("workshop");
    expect(result.current.error).toEqual(failure);
    expect(result.current.savingTheme).toBe(false);
  });
  it("preserves committed theme when persistence fails", async () => {
    const failure = { message: "Settings write failed", path: null, details: "injected" };
    const api = client({ setTheme: vi.fn().mockRejectedValue(failure) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setTheme).toBeTypeOf("function");
    await act(async () => { expect(await result.current.setTheme("coral")).toBe(false); });
    expect(result.current.theme).toBe("workshop");
    expect(result.current.error).toEqual(failure);
    expect(result.current.savingTheme).toBe(false);
  });
  it("rejects theme responses that change active library", async () => {
    const api = client({ setTheme: vi.fn().mockResolvedValue({ ...registered, activeLibraryId: null, theme: "mint" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setTheme).toBeTypeOf("function");
    await act(async () => { expect(await result.current.setTheme("mint")).toBe(false); });
    expect(result.current.theme).toBe("workshop");
    expect(result.current.library?.id).toBe("root1");
    expect(result.current.error?.details).toContain("Theme response");
  });
  it("never invokes theme settings from browser or while loading", async () => {
    const load = deferred<LibraryState>();
    const api = client({ load: vi.fn(() => load.promise), setTheme: vi.fn() });
    const { result, unmount } = renderHook(() => useLibrary(api));
    expect(result.current.setTheme).toBeTypeOf("function");
    await act(async () => { expect(await result.current.setTheme("mint")).toBe(false); });
    expect(api.setTheme).not.toHaveBeenCalled();
    unmount();
    const browser = client({ isDesktop: false, setTheme: vi.fn() });
    const hook = renderHook(() => useLibrary(browser));
    await act(async () => { expect(await hook.result.current.setTheme("mint")).toBe(false); });
    expect(browser.setTheme).not.toHaveBeenCalled();
  });
  it("blocks theme persistence while scan is pending", async () => {
    const pending = deferred<ScanResult>();
    const api = client({ scan: vi.fn(() => pending.promise), setTheme: vi.fn() });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.scanning).toBe(true);
    await act(async () => { expect(await result.current.setTheme("mint")).toBe(false); });
    expect(api.setTheme).not.toHaveBeenCalled();
  });
  it("ignores pending theme result after unmount", async () => {
    const pending = deferred<LibraryState>();
    const api = client({ setTheme: vi.fn(() => pending.promise) });
    const { result, unmount } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setTheme).toBeTypeOf("function");
    let saved!: Promise<boolean>;
    act(() => { saved = result.current.setTheme("coral"); });
    unmount();
    pending.resolve({ ...registered, theme: "coral" });
    expect(await saved).toBe(false);
    expect(result.current.theme).toBe("workshop");
  });
});

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
  it("cancels the active scan, discards partial results and ignores its late completion", async () => {
    const pending = deferred<ScanResult>();
    const api = client({ scan: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    await act(async () => { expect(await result.current.cancelScan()).toBe(true); });
    expect(api.cancelScan).toHaveBeenCalledWith("root1", expect.any(String));
    expect(result.current.scanning).toBe(false);
    expect(result.current.scanStopped).toBe(true);
    expect(result.current.assets).toEqual([]);
    await act(async () => { pending.resolve(scanResult); });
    expect(result.current.assets).toEqual([]);
    expect(result.current.scanning).toBe(false);
  });
  it("ignores late progress and cancellation errors after a new library is chosen", async () => {
    const oldScan = deferred<ScanResult>();
    const cancellation = deferred<boolean>();
    let report!: (value: ScanProgress) => void;
    let oldId = "";
    const otherState = { libraries: [...registered.libraries, { ...registered.libraries[0], id: "root2" }], activeLibraryId: "root2" };
    const api = client({
      scan: vi.fn((libraryId, scanId, progress) => {
        if (libraryId === "root1") { report = progress; oldId = scanId; return oldScan.promise; }
        return Promise.resolve({ ...scanResult, libraryId, scanId });
      }),
      cancelScan: vi.fn(() => cancellation.promise),
      choose: vi.fn().mockResolvedValue(otherState),
    });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    let stop!: Promise<boolean>;
    act(() => { stop = result.current.cancelScan(); });
    await act(() => result.current.chooseLibrary());
    await waitFor(() => expect(result.current.library?.id).toBe("root2"));
    act(() => report({ libraryId: "root1", scanId: oldId, visited: 99999 }));
    await act(async () => { cancellation.reject(new Error("old cancel failed")); await stop; oldScan.resolve(scanResult); });
    expect(result.current.error).toBeNull();
    expect(result.current.library?.id).toBe("root2");
    expect(result.current.progress).not.toBe(99999);
  });
  it("cancels native scan on unmount", async () => {
    const api = client({ scan: vi.fn(() => new Promise<ScanResult>(() => {})) });
    const { result, unmount } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    unmount();
    expect(api.cancelScan).toHaveBeenCalledWith("root1", expect.any(String));
  });
  it("deletes confirmed assets through the native command and applies the fresh scan", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => { expect(await result.current.deleteAssets(result.current.assets)).toBe(true); });
    expect(api.deleteAssets).toHaveBeenCalledWith("root1", [{ assetId: "path:a.stl", expectedRevision: "rev1" }]);
    expect(result.current.assets).toEqual([]);
    expect(result.current.deleting).toBe(false);
  });
  it("refuses to delete the library root or blocked rows without calling native", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(async () => {
      expect(await result.current.deleteAssets([{ ...result.current.assets[0], relativePath: "." }])).toBe(false);
      expect(await result.current.deleteAssets([{ ...result.current.assets[0], metadataState: "blocked" }])).toBe(false);
      expect(await result.current.deleteAssets([{ ...result.current.assets[0], status: "missing" }])).toBe(false);
    });
    expect(api.deleteAssets).not.toHaveBeenCalled();
  });
  it("applies completed trash targets even when a later target fails", async () => {
    const second = { ...scanResult.assets[0], id: "path:b.stl", name: "b.stl", relativePath: "b.stl" };
    const api = client({
      scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId, assets: [scanResult.assets[0], second] })),
      deleteAssets: vi.fn().mockResolvedValue({ completedIds: ["path:a.stl"], error: { message: "1 of 2 items moved to Trash", path: "b.stl", details: "denied" } }),
    });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(2));
    await act(async () => { expect(await result.current.deleteAssets(result.current.assets)).toBe(false); });
    expect(result.current.assets.map((asset) => asset.id)).toEqual(["path:b.stl"]);
    expect(result.current.error?.message).toContain("1 of 2 items moved to Trash / Recycle Bin.");
  });
  it("drops cached descendants when their selected parent is trashed", async () => {
    const folder = { ...scanResult.assets[0], id: "path:Folder", name: "Folder", relativePath: "Folder", kind: "folder" as const };
    const child = { ...scanResult.assets[0], id: "path:Folder/a.stl", relativePath: "Folder/a.stl" };
    const api = client({
      scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId, assets: [folder, child] })),
      deleteAssets: vi.fn().mockResolvedValue({ completedIds: [folder.id], error: null }),
    });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(2));
    await act(async () => { expect(await result.current.deleteAssets([folder])).toBe(true); });
    expect(result.current.assets).toEqual([]);
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
  it("applies notes only from a committed backend row and forwards revision", async () => {
    const initial = { ...scanResult.assets[0], notes: "old" };
    const committed = { ...initial, notes: " exact note ", metadataRevision: "rev-notes" };
    const api = client({ scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId, assets: [initial] })), editNotes: vi.fn().mockResolvedValue(committed) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets[0].notes).toBe("old"));
    await act(async () => { expect(await result.current.editNotes(result.current.assets[0], " exact note ")).toBe(true); });
    expect(api.editNotes).toHaveBeenCalledWith("root1", "path:a.stl", "rev1", " exact note ");
    expect(result.current.assets[0]).toEqual(committed);
    expect(result.current.editingNotesAssetId).toBeNull();
  });
  it("holds shared metadata operation lock while notes save is pending", async () => {
    const pending = deferred<ScanResult["assets"][number]>();
    const initial = { ...scanResult.assets[0], notes: "old" };
    const api = client({ scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId, assets: [initial] })), editNotes: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets[0].notes).toBe("old"));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.editNotes(result.current.assets[0], "new"); });
    expect(result.current.editingNotesAssetId).toBe("path:a.stl");
    await act(async () => { expect(await result.current.editTags(result.current.assets[0], ["favorite"], [])).toBe(false); await result.current.chooseLibrary(); });
    expect(api.editTags).not.toHaveBeenCalled();
    expect(api.choose).not.toHaveBeenCalled();
    expect(result.current.assets[0].notes).toBe("old");
    await act(async () => { pending.resolve({ ...initial, notes: "new" }); await saving; });
    expect(result.current.assets[0].notes).toBe("new");
    expect(result.current.editingNotesAssetId).toBeNull();
  });
  it("retains notes on failure and rejects missing or blocked rows", async () => {
    const initial = { ...scanResult.assets[0], notes: "old" };
    const api = client({ scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId, assets: [initial] })), editNotes: vi.fn().mockRejectedValue({ message: "Metadata changed", path: "/library/.asset-tags.json", details: "Rescan" }) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets[0].notes).toBe("old"));
    await act(async () => { expect(await result.current.editNotes(result.current.assets[0], "new")).toBe(false); });
    expect(result.current.assets[0].notes).toBe("old");
    await act(async () => {
      expect(await result.current.editNotes({ ...initial, status: "missing" }, "x")).toBe(false);
      expect(await result.current.editNotes({ ...initial, metadataState: "blocked" }, "x")).toBe(false);
    });
    expect(api.editNotes).toHaveBeenCalledTimes(1);
  });
  it("ignores pending notes completion after unmount", async () => {
    const pending = deferred<ScanResult["assets"][number]>();
    const initial = { ...scanResult.assets[0], notes: "old" };
    const api = client({ scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId, assets: [initial] })), editNotes: vi.fn(() => pending.promise) });
    const { result, unmount } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets[0].notes).toBe("old"));
    let editing!: Promise<boolean>;
    act(() => { editing = result.current.editNotes(result.current.assets[0], "new"); });
    unmount();
    await act(async () => { pending.resolve({ ...initial, notes: "new" }); expect(await editing).toBe(false); });
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
  it("applies confirmed missing-entry removal as fresh scan and only for valid missing metadata", async () => {
    const api = client();
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(() => result.current.validateMetadata());
    const present = result.current.assets[0];
    await act(async () => { expect(await result.current.removeMissingEntry(present)).toBe(false); });
    await act(async () => { expect(await result.current.removeMissingEntry({ ...present, status: "missing", metadataState: "blocked", metadataId: "uuid" })).toBe(false); });
    expect(api.removeMissingEntry).not.toHaveBeenCalled();
    const missing = { ...present, status: "missing" as const, metadataState: "valid" as const, metadataId: "uuid" };
    await act(async () => { expect(await result.current.removeMissingEntry(missing)).toBe(true); });
    expect(api.removeMissingEntry).toHaveBeenCalledWith("root1", "path:a.stl", "rev1");
    expect(result.current.assets).toEqual([]);
    expect(result.current.validation).toBeNull();
    expect(result.current.state.libraries.find((item) => item.id === "root1")?.assetCount).toBe(0);
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

// ---------------------------------------------------------------------------------------------------------------------
// Tag rename: serialized preview/apply with committed-state validation (T10)
// ---------------------------------------------------------------------------------------------------------------------
type RenameHook = { current: ReturnType<typeof useLibrary> };
type RenamePreviewValue = Extract<RenamePreviewOutcome, { status: "ready" }>["preview"];

const searchFilters = (query: string) => ({ query, view: "all" as const, matchMode: "all" as const, kind: "all" as const });
const renameSearches = [
  { id: "s1", libraryId: "root1", name: "Old things", filters: searchFilters("old") },
  { id: "s2", libraryId: "root1", name: "Favorites", filters: searchFilters("favorite") },
  { id: "s3", libraryId: "other", name: "Other library", filters: searchFilters("old") },
];
const renameState = { ...registered, savedSearches: renameSearches, theme: "aurora" as const, extension: { source: "future-settings" } };
const exactMapping = { mode: "exact" as const, source: "old", destination: "new" };
const renameRow = (name: string, tags: string[], revision: string) => ({
  ...scanResult.assets[0], id: `path:${name}`, name, relativePath: name, tags, metadataRevision: revision,
  metadataId: `uuid-${name}`, metadataState: "valid" as const, status: "ready" as const,
});
const previewRows = [renameRow("a.stl", ["old"], "rev-a"), renameRow("b.stl", ["old", "x"], "rev-b"), renameRow("c.stl", ["old"], "rev-c"), renameRow("d.stl", ["keep"], "rev-d")];
const renamedRows = previewRows.slice(0, 3).map((row, index) => ({ ...row, tags: row.tags.map((tag) => tag === "old" ? "new" : tag), metadataRevision: `renamed-${index}` }));
const targetOf = (row: { id: string; relativePath: string; kind: "file" | "folder" }) => ({ assetId: row.id, relativePath: row.relativePath, kind: row.kind, sidecarOwner: ".", duplicatesCollapsed: 0 });
const previewTargets = previewRows.slice(0, 3).map(targetOf);
const migratedSearch = { ...renameSearches[0], filters: searchFilters("new") };

function basePreview(request: { libraryId: string; scanId: string; savedSearchReplacements: unknown[] }): RenamePreviewValue {
  return {
    previewId: "preview-1", libraryId: request.libraryId, scanId: request.scanId, mapping: exactMapping,
    scan: { libraryId: request.libraryId, scanId: request.scanId, assets: previewRows, issues: [], scannedAt: "2026-11-04T00:00:00Z" },
    targets: previewTargets, fileCount: 3, folderCount: 0, sidecarCount: 1, destinationExists: false, collisions: [],
    duplicatesCollapsed: 0, skipped: [], uninspectable: [], savedSearchUpdateCount: request.savedSearchReplacements.length, settingsRetry: false,
  };
}
type PreviewRequest = Parameters<LibraryClient["previewTagRename"]>[0];
function readyPreview(transform?: (preview: RenamePreviewValue, request: PreviewRequest) => RenamePreviewValue) {
  return vi.fn(async (request: PreviewRequest): Promise<RenamePreviewOutcome> => {
    const preview = basePreview(request);
    return { status: "ready", preview: transform ? transform(preview, request) : preview };
  });
}
function applyResult(overrides: Partial<RenameApplyResult> = {}): RenameApplyResult {
  return {
    previewId: "preview-1", libraryId: "root1", mapping: exactMapping, committed: renamedRows, failed: [], unattempted: [],
    failingSidecar: null, skipped: [], uninspectable: [], savedSearches: [migratedSearch], error: null, outcome: "complete", queryMigrated: true,
    ...overrides,
  };
}
const renameInput = (query = "old") => ({ mode: "exact" as const, source: " Old ", destination: "NEW", activeFilters: searchFilters(query) });
function queryBinding(initial: string) {
  const binding = { current: initial, write: vi.fn((next: string) => { binding.current = next; }) };
  return { read: () => binding.current, write: binding.write, state: binding };
}
async function setupRename(overrides: Partial<LibraryClient> = {}) {
  const api = client({ load: vi.fn().mockResolvedValue(renameState), previewTagRename: readyPreview(), applyTagRename: vi.fn(async () => applyResult()), ...overrides });
  const hook = renderHook(() => useLibrary(api));
  await waitFor(() => expect(hook.result.current.assets).toHaveLength(1));
  return { api, ...hook };
}
async function previewNow(result: RenameHook, input = renameInput()) {
  let outcome!: Awaited<ReturnType<RenameHook["current"]["previewTagRename"]>>;
  await act(async () => { outcome = await result.current.previewTagRename(input); });
  return outcome;
}
async function applyNow(result: RenameHook, binding: ReturnType<typeof queryBinding>, previewId = "preview-1") {
  let outcome!: Awaited<ReturnType<RenameHook["current"]["applyTagRename"]>>;
  await act(async () => { outcome = await result.current.applyTagRename(previewId, binding); });
  return outcome;
}

describe("tag rename preview", () => {
  it("derives saved-search replacements and the active-query rewrite with the T2 helper before every request", async () => {
    const { api, result } = await setupRename();
    const outcome = await previewNow(result, renameInput("old -old:x favorite"));
    expect(api.previewTagRename).toHaveBeenCalledTimes(1);
    const first = vi.mocked(api.previewTagRename).mock.calls[0]![0];
    expect(first).toMatchObject({ libraryId: "root1", mode: "exact", source: " Old ", destination: "NEW", normalizedMapping: exactMapping });
    expect(first.scanId).toEqual(expect.any(String));
    expect(first.savedSearchReplacements).toEqual([{ searchId: "s1", expectedFilters: searchFilters("old"), filters: searchFilters("new") }]);
    expect(first.savedSearchReplacements[0]).not.toHaveProperty("name");
    expect(outcome).toMatchObject({ status: "ready" });
    if (outcome.status === "ready") expect(outcome.migration.activeQuery).toEqual({ before: "old -old:x favorite", after: "new -old:x favorite", changed: true });

    await previewNow(result, { mode: "exact", source: "favorite", destination: "starred", activeFilters: searchFilters("old") });
    const second = vi.mocked(api.previewTagRename).mock.calls[1]![0];
    expect(second.scanId).not.toBe(first.scanId);
    expect(second.savedSearchReplacements).toEqual([{ searchId: "s2", expectedFilters: searchFilters("favorite"), filters: searchFilters("starred") }]);
  });

  it("rejects invalid mappings and unrepresentable query migrations without a native request", async () => {
    const { api, result } = await setupRename();
    expect(await previewNow(result, { mode: "exact", source: "old", destination: " OLD ", activeFilters: searchFilters("old") })).toEqual({ status: "invalid", error: "unchanged" });
    const blocked = await previewNow(result, { mode: "exact", source: "old", destination: "new tag", activeFilters: searchFilters("old") });
    expect(blocked.status).toBe("blocked");
    if (blocked.status === "blocked") {
      expect(blocked.blockers.map((blocker) => blocker.source.kind)).toEqual(["active", "saved"]);
      expect(blocked.blockers[0]).toMatchObject({ reason: "whitespace", token: "old", destination: "new tag" });
    }
    expect(api.previewTagRename).not.toHaveBeenCalled();
    expect(result.current.renamePreviewing).toBe(false);
  });

  it("publishes the preview catalog without resetting session state or scanning", async () => {
    const { api, result } = await setupRename();
    const before = { state: result.current.state, library: result.current.library, saved: result.current.savedSearches };
    const savedBefore = structuredClone(before.saved);
    const outcome = await previewNow(result);
    expect(outcome.status).toBe("ready");
    expect(result.current.assets).toEqual(previewRows);
    expect(result.current.state).toBe(before.state);
    expect(result.current.library).toBe(before.library);
    expect(result.current.savedSearches).toEqual(savedBefore);
    expect(result.current.scanning).toBe(false);
    expect(result.current.scanStopped).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.renamePreviewing).toBe(false);
    expect(api.scan).toHaveBeenCalledTimes(1);
    expect(api.cancelScan).not.toHaveBeenCalled();
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(api.editTags).not.toHaveBeenCalled();
  });

  it("reports progress only for the active request", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    let report!: (progress: ScanProgress) => void;
    const previewTagRename = vi.fn((_request: PreviewRequest, onProgress: (progress: ScanProgress) => void) => { report = onProgress; return pending.promise; });
    const { result } = await setupRename({ previewTagRename });
    let preview!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { preview = result.current.previewTagRename(renameInput()); });
    expect(result.current.renamePreviewing).toBe(true);
    expect(result.current.renameProgress).toBe(0);
    const scanId = previewTagRename.mock.calls[0]![0].scanId;
    act(() => report({ libraryId: "root1", scanId, visited: 7 }));
    expect(result.current.renameProgress).toBe(7);
    act(() => report({ libraryId: "root1", scanId: "someone-else", visited: 99 }));
    act(() => report({ libraryId: "other", scanId, visited: 98 }));
    expect(result.current.renameProgress).toBe(7);
    await act(async () => { pending.resolve({ status: "discarded", reason: "mutation" }); await preview; });
    expect(result.current.renamePreviewing).toBe(false);
  });

  it("refuses a second preview, an apply or another native mutation while a preview is in flight", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    const previewTagRename = vi.fn(() => pending.promise);
    const { api, result } = await setupRename({ previewTagRename });
    let first!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { first = result.current.previewTagRename(renameInput()); });
    expect(await result.current.previewTagRename(renameInput())).toEqual({ status: "unavailable" });
    expect(await result.current.applyTagRename("preview-1", queryBinding("old"))).toEqual({ status: "unavailable" });
    await act(async () => { expect(await result.current.editTags(result.current.assets[0]!, ["x"], [])).toBe(false); });
    await act(async () => { await result.current.rescan(); });
    expect(previewTagRename).toHaveBeenCalledTimes(1);
    expect(api.applyTagRename).not.toHaveBeenCalled();
    expect(api.editTags).not.toHaveBeenCalled();
    expect(api.scan).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ status: "cancelled" }); await first; });
    expect(await previewNow(result)).toMatchObject({ status: "cancelled" });
    expect(previewTagRename).toHaveBeenCalledTimes(2);
  });

  it("returns discarded and cancelled native outcomes without touching the catalog", async () => {
    const previewTagRename = vi.fn<LibraryClient["previewTagRename"]>()
      .mockResolvedValueOnce({ status: "discarded", reason: "sidecar-changed" })
      .mockResolvedValueOnce({ status: "cancelled" });
    const { result } = await setupRename({ previewTagRename });
    const rows = result.current.assets;
    expect(await previewNow(result)).toEqual({ status: "discarded", reason: "sidecar-changed" });
    expect(await previewNow(result)).toEqual({ status: "cancelled" });
    expect(result.current.assets).toBe(rows);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a native preview rejection and releases the lock", async () => {
    const previewTagRename = vi.fn<LibraryClient["previewTagRename"]>().mockRejectedValueOnce({ message: "Library root moved", path: null, details: null });
    const { result } = await setupRename({ previewTagRename });
    const rows = result.current.assets;
    expect(await previewNow(result)).toEqual({ status: "failed" });
    expect(result.current.error?.message).toBe("Library root moved");
    expect(result.current.assets).toBe(rows);
    expect(result.current.renamePreviewing).toBe(false);
    previewTagRename.mockResolvedValueOnce({ status: "cancelled" });
    expect(await previewNow(result)).toEqual({ status: "cancelled" });
  });

  it.each<[string, (preview: RenamePreviewValue) => RenamePreviewValue]>([
    ["another library", (preview) => ({ ...preview, libraryId: "other" })],
    ["another scan id", (preview) => ({ ...preview, scanId: "not-requested" })],
    ["a catalog scanned for another library", (preview) => ({ ...preview, scan: { ...preview.scan, libraryId: "other" } })],
    ["a catalog with another scan id", (preview) => ({ ...preview, scan: { ...preview.scan, scanId: "not-requested" } })],
    ["a different normalized mapping", (preview) => ({ ...preview, mapping: { ...exactMapping, destination: "else" } })],
    ["a target that is not in the catalog", (preview) => ({ ...preview, targets: [...preview.targets, targetOf({ id: "path:ghost.stl", relativePath: "ghost.stl", kind: "file" })] })],
    ["a target with another path", (preview) => ({ ...preview, targets: [{ ...preview.targets[0]!, relativePath: "z.stl" }, ...preview.targets.slice(1)] })],
    ["a duplicate target", (preview) => ({ ...preview, targets: [...preview.targets, preview.targets[0]!] })],
    ["a catalog with duplicate row ids", (preview) => ({ ...preview, scan: { ...preview.scan, assets: [...preview.scan.assets, preview.scan.assets[0]!] } })],
    ["a wrong saved-search update count", (preview) => ({ ...preview, savedSearchUpdateCount: 5 })],
    ["an empty preview id", (preview) => ({ ...preview, previewId: "" })],
  ])("rejects a malformed preview with %s without touching state", async (_label, transform) => {
    const { result } = await setupRename({ previewTagRename: readyPreview(transform) });
    const rows = result.current.assets;
    const state = result.current.state;
    expect(await previewNow(result)).toEqual({ status: "failed" });
    expect(result.current.assets).toBe(rows);
    expect(result.current.state).toBe(state);
    expect(result.current.error).not.toBeNull();
    expect(await result.current.applyTagRename("preview-1", queryBinding("old"))).toEqual({ status: "unavailable" });
  });

  it("rejects an unknown native outcome status", async () => {
    const { result } = await setupRename({ previewTagRename: vi.fn(async () => ({ status: "weird" }) as unknown as RenamePreviewOutcome) });
    expect(await previewNow(result)).toEqual({ status: "failed" });
    expect(result.current.error).not.toBeNull();
  });

  it("ignores a response that arrives after the library state was replaced (stale library)", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    const old = client({ load: vi.fn().mockResolvedValue(renameState), previewTagRename: vi.fn(() => pending.promise) });
    const second: LibraryState = { libraries: [{ id: "root2", name: "Second", rootPath: "/second", assetCount: 0, lastScanAt: null }], activeLibraryId: "root2" };
    const next = client({ load: vi.fn().mockResolvedValue(second) });
    const { result, rerender } = renderHook(({ api }) => useLibrary(api), { initialProps: { api: old } });
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let preview!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { preview = result.current.previewTagRename(renameInput()); });
    rerender({ api: next });
    await waitFor(() => expect(result.current.state.activeLibraryId).toBe("root2"));
    await waitFor(() => expect(result.current.assets[0]?.id).toBe("path:a.stl"));
    const rows = result.current.assets;
    await act(async () => {
      pending.resolve({ status: "ready", preview: basePreview({ libraryId: "root1", scanId: vi.mocked(old.previewTagRename).mock.calls[0]![0].scanId, savedSearchReplacements: [{}] }) });
      expect(await preview).toEqual({ status: "stale" });
    });
    expect(result.current.assets).toBe(rows);
    expect(result.current.state.activeLibraryId).toBe("root2");
    expect(result.current.error).toBeNull();
  });

  it("ignores a response from a superseded generation even for the same library (stale generation)", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    const old = client({ load: vi.fn().mockResolvedValue(renameState), previewTagRename: vi.fn(() => pending.promise) });
    const next = client({ load: vi.fn().mockResolvedValue(renameState) });
    const { result, rerender } = renderHook(({ api }) => useLibrary(api), { initialProps: { api: old } });
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    let preview!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { preview = result.current.previewTagRename(renameInput()); });
    rerender({ api: next });
    await waitFor(() => expect(next.scan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    const rows = result.current.assets;
    await act(async () => {
      pending.resolve({ status: "ready", preview: basePreview({ libraryId: "root1", scanId: vi.mocked(old.previewTagRename).mock.calls[0]![0].scanId, savedSearchReplacements: [{}] }) });
      expect(await preview).toEqual({ status: "stale" });
    });
    expect(result.current.assets).toBe(rows);
    expect(result.current.error).toBeNull();
  });

  it("does not update state after unmount and cancels the native preview best effort", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    const previewTagRename = vi.fn((_request: PreviewRequest) => pending.promise);
    const { api, result, unmount } = await setupRename({ previewTagRename });
    let preview!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { preview = result.current.previewTagRename(renameInput()); });
    const scanId = previewTagRename.mock.calls[0]![0].scanId;
    unmount();
    expect(api.cancelScan).toHaveBeenCalledWith("root1", scanId);
    await act(async () => {
      pending.resolve({ status: "ready", preview: basePreview({ libraryId: "root1", scanId, savedSearchReplacements: [{}] }) });
      expect(await preview).toEqual({ status: "stale" });
    });
  });
});

describe("tag rename preview cancellation", () => {
  it("cancels through the existing registry and discards a result that still arrives", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    let report!: (progress: ScanProgress) => void;
    const previewTagRename = vi.fn((_request: PreviewRequest, onProgress: (progress: ScanProgress) => void) => { report = onProgress; return pending.promise; });
    const { api, result } = await setupRename({ previewTagRename });
    const rows = result.current.assets;
    expect(await result.current.cancelTagRenamePreview()).toBe(false);
    expect(api.cancelScan).not.toHaveBeenCalled();

    let preview!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { preview = result.current.previewTagRename(renameInput()); });
    const scanId = previewTagRename.mock.calls[0]![0].scanId;
    await act(async () => { expect(await result.current.cancelTagRenamePreview()).toBe(true); });
    expect(api.cancelScan).toHaveBeenCalledWith("root1", scanId);
    expect(await result.current.cancelTagRenamePreview()).toBe(false);
    expect(api.cancelScan).toHaveBeenCalledTimes(1);
    act(() => report({ libraryId: "root1", scanId, visited: 12 }));
    expect(result.current.renameProgress).toBe(0);
    // The native task is still winding down, so the single-flight lock is held until it settles.
    expect(await result.current.previewTagRename(renameInput())).toEqual({ status: "unavailable" });

    await act(async () => {
      pending.resolve({ status: "ready", preview: basePreview({ libraryId: "root1", scanId, savedSearchReplacements: [{}] }) });
      expect(await preview).toEqual({ status: "cancelled" });
    });
    expect(result.current.assets).toBe(rows);
    expect(result.current.renamePreviewing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(await result.current.applyTagRename("preview-1", queryBinding("old"))).toEqual({ status: "unavailable" });
  });

  it("treats a native rejection after cancellation as a quiet cancel", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    const { result } = await setupRename({ previewTagRename: vi.fn(() => pending.promise) });
    let preview!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { preview = result.current.previewTagRename(renameInput()); });
    await act(async () => { await result.current.cancelTagRenamePreview(); });
    await act(async () => { pending.reject({ message: "Preview cancelled", path: null, details: null }); expect(await preview).toEqual({ status: "cancelled" }); });
    expect(result.current.error).toBeNull();
  });

  it("reports a failed cancel request", async () => {
    const pending = deferred<RenamePreviewOutcome>();
    const { api, result } = await setupRename({ previewTagRename: vi.fn(() => pending.promise), cancelScan: vi.fn().mockRejectedValue({ message: "cancel failed", path: null, details: null }) });
    let preview!: ReturnType<RenameHook["current"]["previewTagRename"]>;
    act(() => { preview = result.current.previewTagRename(renameInput()); });
    await act(async () => { expect(await result.current.cancelTagRenamePreview()).toBe(false); });
    expect(api.cancelScan).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe("cancel failed");
    await act(async () => { pending.resolve({ status: "cancelled" }); await preview; });
  });
});

describe("tag rename apply", () => {
  it("applies a complete result by identity without a scan, applyState or optimistic tags", async () => {
    const { api, result } = await setupRename();
    await previewNow(result, renameInput("old -favorite"));
    const summary = result.current.library;
    const binding = queryBinding("old -favorite");
    const optimisticBefore = vi.mocked(api.editTags).mock.calls.length;
    const outcome = await applyNow(result, binding);
    expect(api.applyTagRename).toHaveBeenCalledOnce();
    expect(api.applyTagRename).toHaveBeenCalledWith("root1", "preview-1");
    expect(outcome).toMatchObject({ status: "applied", queryUpdated: true, result: { outcome: "complete" } });
    expect(result.current.assets.map((row) => [row.id, row.tags, row.metadataRevision])).toEqual([
      ["path:a.stl", ["new"], "renamed-0"], ["path:b.stl", ["new", "x"], "renamed-1"], ["path:c.stl", ["new"], "renamed-2"], ["path:d.stl", ["keep"], "rev-d"],
    ]);
    expect(binding.write).toHaveBeenCalledExactlyOnceWith("new -favorite");
    expect(result.current.savedSearches).toEqual([migratedSearch, renameSearches[1]]);
    expect(result.current.state.savedSearches).toEqual([migratedSearch, renameSearches[1], renameSearches[2]]);
    expect(result.current.state).toMatchObject({ theme: "aurora", extension: { source: "future-settings" }, activeLibraryId: "root1" });
    expect(result.current.library).toBe(summary);
    expect(result.current.renameApplying).toBe(false);
    expect(result.current.error).toBeNull();
    expect(api.scan).toHaveBeenCalledTimes(1);
    expect(api.load).toHaveBeenCalledTimes(1);
    expect(api.cancelScan).not.toHaveBeenCalled();
    expect(api.editTags).toHaveBeenCalledTimes(optimisticBefore);
    expect(api.bulkEditTags).not.toHaveBeenCalled();
    // The preview is consumed: retrying needs a fresh preview.
    expect(await result.current.applyTagRename("preview-1", queryBinding("old"))).toEqual({ status: "unavailable" });
    expect(api.applyTagRename).toHaveBeenCalledOnce();
  });

  it("rewrites the active query only if it still equals the value captured at preview time", async () => {
    const unchanged = await setupRename();
    await previewNow(unchanged.result, renameInput("old plain"));
    const same = queryBinding("old plain");
    expect(await applyNow(unchanged.result, same)).toMatchObject({ status: "applied", queryUpdated: true });
    expect(same.write).toHaveBeenCalledExactlyOnceWith("new plain");
    cleanup();

    const changed = await setupRename();
    await previewNow(changed.result, renameInput("old plain"));
    // The user kept typing while the apply was in flight.
    const live = queryBinding("old plain");
    vi.mocked(changed.api.applyTagRename).mockImplementationOnce(async () => { live.state.current = "old plain extra"; return applyResult(); });
    const outcome = await applyNow(changed.result, live);
    expect(outcome).toMatchObject({ status: "applied", queryUpdated: false, result: { outcome: "complete" } });
    expect(live.write).not.toHaveBeenCalled();
    expect(live.state.current).toBe("old plain extra");
    expect(changed.result.current.savedSearches[0]).toEqual(migratedSearch);
  });

  it("does not call write when the query needs no rewrite", async () => {
    const { result } = await setupRename();
    await previewNow(result, renameInput("favorite"));
    const binding = queryBinding("favorite");
    expect(await applyNow(result, binding)).toMatchObject({ status: "applied", queryUpdated: false });
    expect(binding.write).not.toHaveBeenCalled();
  });

  it("applies valid committed rows from a partial result that carries an error and leaves searches and query alone", async () => {
    const partial = applyResult({
      committed: [renamedRows[0]!], failed: [previewTargets[1]!], unattempted: [previewTargets[2]!], failingSidecar: ".",
      savedSearches: [renameSearches[0]!], error: { message: "disk full", path: "b.stl", details: null }, outcome: "partial", queryMigrated: false,
    });
    const { api, result } = await setupRename({ applyTagRename: vi.fn(async () => partial) });
    await previewNow(result);
    const binding = queryBinding("old");
    const outcome = await applyNow(result, binding);
    expect(outcome).toMatchObject({ status: "applied", queryUpdated: false, result: { outcome: "partial" } });
    expect(result.current.assets.map((row) => [row.id, row.tags, row.metadataRevision])).toEqual([
      ["path:a.stl", ["new"], "renamed-0"], ["path:b.stl", ["old", "x"], "rev-b"], ["path:c.stl", ["old"], "rev-c"], ["path:d.stl", ["keep"], "rev-d"],
    ]);
    expect(result.current.error).toEqual({ message: "disk full", path: "b.stl", details: null });
    expect(binding.write).not.toHaveBeenCalled();
    expect(result.current.state.savedSearches).toEqual(renameSearches);
    expect(api.scan).toHaveBeenCalledTimes(1);
  });

  it("keeps committed rows, other settings and the current summary when settings persistence failed", async () => {
    const failed = applyResult({
      savedSearches: [renameSearches[0]!], error: { message: "settings write failed", path: null, details: null }, outcome: "settings-failed", queryMigrated: false,
    });
    const { result } = await setupRename({ applyTagRename: vi.fn(async () => failed) });
    await previewNow(result);
    const summary = result.current.library;
    const binding = queryBinding("old");
    expect(await applyNow(result, binding)).toMatchObject({ status: "applied", queryUpdated: false, result: { outcome: "settings-failed" } });
    expect(result.current.assets.slice(0, 3).map((row) => row.tags)).toEqual([["new"], ["new", "x"], ["new"]]);
    expect(result.current.state).toMatchObject({ theme: "aurora", extension: { source: "future-settings" }, savedSearches: renameSearches });
    expect(result.current.library).toBe(summary);
    expect(result.current.error?.message).toBe("settings write failed");
    expect(binding.write).not.toHaveBeenCalled();
  });

  it("rejects a complete result that carries an error and does not rewrite the query", async () => {
    const inconsistent = applyResult({ error: { message: "late failure", path: null, details: null } });
    const { result } = await setupRename({ applyTagRename: vi.fn(async () => inconsistent) });
    await previewNow(result);
    const binding = queryBinding("old");
    expect(await applyNow(result, binding)).toEqual({ status: "failed" });
    expect(binding.write).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<RenameApplyResult>]>([
    ["another preview id", { previewId: "preview-2" }],
    ["another library", { libraryId: "other" }],
    ["another mapping", { mapping: { ...exactMapping, destination: "else" } }],
    ["an unknown committed row", { committed: [...renamedRows.slice(0, 2), { ...renamedRows[2]!, id: "path:ghost.stl", relativePath: "ghost.stl" }] }],
    ["a committed row with another path", { committed: [...renamedRows.slice(0, 2), { ...renamedRows[2]!, relativePath: "z/c.stl" }] }],
    ["a committed row outside the target set", { committed: [...renamedRows, renameRow("d.stl", ["new"], "x")] }],
    ["duplicate committed rows", { committed: [renamedRows[0]!, renamedRows[0]!, renamedRows[2]!] }],
    ["overlapping committed and failed partitions", { committed: renamedRows, failed: [previewTargets[0]!], outcome: "partial", queryMigrated: false }],
    ["overlapping failed and unattempted partitions", { committed: [renamedRows[0]!], failed: [previewTargets[1]!, previewTargets[2]!], unattempted: [previewTargets[2]!], outcome: "partial", queryMigrated: false, error: { message: "x", path: null, details: null } }],
    ["a non-exhaustive partition", { committed: renamedRows.slice(0, 2), outcome: "partial", queryMigrated: false, error: { message: "x", path: null, details: null } }],
    ["an unknown failed row", { committed: renamedRows.slice(0, 2), failed: [{ ...previewTargets[2]!, assetId: "path:ghost.stl", relativePath: "ghost.stl" }], outcome: "partial", queryMigrated: false, error: { message: "x", path: null, details: null } }],
    ["a failed row with another path", { committed: renamedRows.slice(0, 2), failed: [{ ...previewTargets[2]!, relativePath: "z/c.stl" }], outcome: "partial", queryMigrated: false, error: { message: "x", path: null, details: null } }],
    ["an unattempted row with another kind", { committed: renamedRows.slice(0, 2), unattempted: [{ ...previewTargets[2]!, kind: "folder" }], outcome: "partial", queryMigrated: false, error: { message: "x", path: null, details: null } }],
    ["a saved search from another library", { savedSearches: [renameSearches[2]!] }],
    ["an unknown saved search", { savedSearches: [{ ...migratedSearch, id: "s-unknown" }] }],
    ["a duplicate saved search", { savedSearches: [migratedSearch, migratedSearch] }],
    ["a complete outcome with a failed row", { committed: renamedRows.slice(0, 2), failed: [previewTargets[2]!] }],
    ["a partial outcome with nothing left unapplied", { outcome: "partial", queryMigrated: false, error: { message: "x", path: null, details: null } }],
    ["a migrated query after a partial outcome", { committed: [renamedRows[0]!], failed: [previewTargets[1]!, previewTargets[2]!], outcome: "partial", queryMigrated: true, error: { message: "x", path: null, details: null } }],
    ["a settings failure without an error", { outcome: "settings-failed", queryMigrated: false }],
    ["an unknown outcome", { outcome: "mystery" as RenameApplyResult["outcome"] }],
  ])("rejects a malformed apply result with %s before touching state", async (_label, overrides) => {
    const { api, result } = await setupRename({ applyTagRename: vi.fn(async () => applyResult(overrides)) });
    await previewNow(result);
    const rows = result.current.assets;
    const state = result.current.state;
    const binding = queryBinding("old");
    expect(await applyNow(result, binding)).toEqual({ status: "failed" });
    expect(result.current.assets).toBe(rows);
    expect(result.current.state).toBe(state);
    expect(binding.write).not.toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
    expect(result.current.renameApplying).toBe(false);
    expect(api.scan).toHaveBeenCalledTimes(1);
  });

  it("refuses apply without a matching preview and never calls native", async () => {
    const { api, result } = await setupRename();
    const binding = queryBinding("old");
    expect(await applyNow(result, binding)).toEqual({ status: "unavailable" });
    await previewNow(result);
    expect(await applyNow(result, binding, "preview-other")).toEqual({ status: "unavailable" });
    expect(api.applyTagRename).not.toHaveBeenCalled();
  });

  it("a new preview supersedes the pending one", async () => {
    const previewTagRename = vi.fn(async (request: PreviewRequest): Promise<RenamePreviewOutcome> => ({
      status: "ready", preview: { ...basePreview(request), previewId: `preview-${previewTagRename.mock.calls.length}` },
    }));
    const { api, result } = await setupRename({ previewTagRename });
    await previewNow(result);
    await previewNow(result);
    expect(await applyNow(result, queryBinding("old"), "preview-1")).toEqual({ status: "unavailable" });
    expect(api.applyTagRename).not.toHaveBeenCalled();
  });

  it("refuses a second apply or other mutations while an apply is in flight", async () => {
    const pending = deferred<RenameApplyResult>();
    const applyTagRename = vi.fn(() => pending.promise);
    const { api, result } = await setupRename({ applyTagRename });
    await previewNow(result);
    let first!: ReturnType<RenameHook["current"]["applyTagRename"]>;
    const binding = queryBinding("old");
    act(() => { first = result.current.applyTagRename("preview-1", binding); });
    expect(result.current.renameApplying).toBe(true);
    expect(await result.current.applyTagRename("preview-1", binding)).toEqual({ status: "unavailable" });
    expect(await result.current.previewTagRename(renameInput())).toEqual({ status: "unavailable" });
    await act(async () => { expect(await result.current.editTags(result.current.assets[0]!, ["x"], [])).toBe(false); });
    expect(applyTagRename).toHaveBeenCalledTimes(1);
    expect(api.previewTagRename).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(applyResult()); expect(await first).toMatchObject({ status: "applied" }); });
    expect(result.current.renameApplying).toBe(false);
  });

  it("surfaces a native apply rejection with no row changes and consumes the preview", async () => {
    const { result } = await setupRename({ applyTagRename: vi.fn().mockRejectedValue({ message: "Preview is stale", path: null, details: null }) });
    await previewNow(result);
    const rows = result.current.assets;
    const binding = queryBinding("old");
    expect(await applyNow(result, binding)).toEqual({ status: "failed" });
    expect(result.current.error?.message).toBe("Preview is stale");
    expect(result.current.assets).toBe(rows);
    expect(binding.write).not.toHaveBeenCalled();
    expect(await applyNow(result, binding)).toEqual({ status: "unavailable" });
  });

  it("does not touch state or the query when the hook unmounts during apply", async () => {
    const pending = deferred<RenameApplyResult>();
    const { api, result, unmount } = await setupRename({ applyTagRename: vi.fn(() => pending.promise) });
    await previewNow(result);
    const binding = queryBinding("old");
    let apply!: ReturnType<RenameHook["current"]["applyTagRename"]>;
    act(() => { apply = result.current.applyTagRename("preview-1", binding); });
    unmount();
    await act(async () => { pending.resolve(applyResult()); expect(await apply).toEqual({ status: "stale" }); });
    expect(binding.write).not.toHaveBeenCalled();
    expect(api.scan).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Usage analytics: events after success and the consent command (T13)
// ---------------------------------------------------------------------------------------------------------------------
const sharing = { available: true, consent: "granted" as const, saved: true };
const notSharing = { available: true, consent: "declined" as const, saved: true };
const undecided = { available: true, consent: "undecided" as const, saved: true };
const stoppedUsage = { available: true, consent: "declined" as const, saved: false };
const second = { id: "root2", name: "Second", rootPath: "/selected/second", assetCount: 0, lastScanAt: null };
const bothLibraries: LibraryState = { libraries: [...registered.libraries, second], activeLibraryId: "root2" };
const failure = { message: "Native failure", path: null, details: "injected" };
const sent = (api: LibraryClient) => vi.mocked(api.trackUsage).mock.calls.map(([event]) => event);
async function loadedHook(api: LibraryClient) {
  const hook = renderHook(() => useLibrary(api));
  await waitFor(() => expect(hook.result.current.assets).toHaveLength(1));
  return hook;
}
const secondRow = { ...scanResult.assets[0]!, id: "path:b.stl", name: "b.stl", relativePath: "b.stl" };

describe("usage events fire only after success", () => {
  it("sends tag_edit after a successful edit and nothing when the edit fails or is refused", async () => {
    const api = client();
    const { result } = await loadedHook(api);
    await act(async () => { expect(await result.current.editTags(result.current.assets[0]!, ["x"], [])).toBe(true); });
    expect(sent(api)).toEqual([{ name: "tag_edit" }]);

    const failing = client({ editTags: vi.fn().mockRejectedValue(failure) });
    const other = await loadedHook(failing);
    await act(async () => { expect(await other.result.current.editTags(other.result.current.assets[0]!, ["x"], [])).toBe(false); });
    const missing = { ...other.result.current.assets[0]!, status: "missing" as const };
    await act(async () => { expect(await other.result.current.editTags(missing, ["x"], [])).toBe(false); });
    expect(sent(failing)).toEqual([]);
  });

  it("sends bulk_tag_edit for a full result and for a partial result with an error, but not for zero committed rows or a rejection", async () => {
    const full = client({ bulkEditTags: vi.fn().mockResolvedValue({ assets: [{ ...scanResult.assets[0]!, tags: ["x"] }], error: null }) });
    const fullHook = await loadedHook(full);
    await act(async () => { expect(await fullHook.result.current.bulkEditTags(fullHook.result.current.assets, ["x"], [])).toBe(true); });
    expect(sent(full)).toEqual([{ name: "bulk_tag_edit" }]);

    const partial = client({ bulkEditTags: vi.fn().mockResolvedValue({ assets: [{ ...scanResult.assets[0]!, tags: ["x"] }], error: failure }) });
    const partialHook = await loadedHook(partial);
    await act(async () => { expect(await partialHook.result.current.bulkEditTags([partialHook.result.current.assets[0]!, secondRow], ["x"], [])).toBe(false); });
    expect(partialHook.result.current.error).toEqual(failure);
    expect(sent(partial)).toEqual([{ name: "bulk_tag_edit" }]);

    const zero = client({ bulkEditTags: vi.fn().mockResolvedValue({ assets: [], error: failure }) });
    const zeroHook = await loadedHook(zero);
    await act(async () => { expect(await zeroHook.result.current.bulkEditTags(zeroHook.result.current.assets, ["x"], [])).toBe(false); });
    expect(sent(zero)).toEqual([]);

    const rejected = client({ bulkEditTags: vi.fn().mockRejectedValue(failure) });
    const rejectedHook = await loadedHook(rejected);
    await act(async () => { expect(await rejectedHook.result.current.bulkEditTags(rejectedHook.result.current.assets, ["x"], [])).toBe(false); });
    expect(sent(rejected)).toEqual([]);
  });

  it("sends tag_rename only when at least one row committed", async () => {
    const complete = await setupRename();
    await previewNow(complete.result);
    await applyNow(complete.result, queryBinding("old"));
    expect(sent(complete.api)).toEqual([{ name: "tag_rename" }]);

    const partialSome = await setupRename({
      applyTagRename: vi.fn(async () => applyResult({
        committed: [renamedRows[0]!], failed: [previewTargets[1]!], unattempted: [previewTargets[2]!], failingSidecar: ".",
        savedSearches: [], error: failure, outcome: "partial", queryMigrated: false,
      })),
    });
    await previewNow(partialSome.result);
    await applyNow(partialSome.result, queryBinding("old"));
    expect(sent(partialSome.api)).toEqual([{ name: "tag_rename" }]);

    const none = await setupRename({
      applyTagRename: vi.fn(async () => applyResult({
        committed: [], failed: [previewTargets[0]!], unattempted: [previewTargets[1]!, previewTargets[2]!], failingSidecar: ".",
        savedSearches: [], error: failure, outcome: "partial", queryMigrated: false,
      })),
    });
    await previewNow(none.result);
    expect(await applyNow(none.result, queryBinding("old"))).toMatchObject({ status: "applied" });
    expect(sent(none.api)).toEqual([]);

    const rejected = await setupRename({ applyTagRename: vi.fn().mockRejectedValue(failure) });
    await previewNow(rejected.result);
    expect(await applyNow(rejected.result, queryBinding("old"))).toEqual({ status: "failed" });
    expect(sent(rejected.api)).toEqual([]);
  });

  it("sends saved_search_save and saved_search_delete after success only", async () => {
    const api = client();
    const { result } = await loadedHook(api);
    await act(async () => { expect(await result.current.saveSearch("Name", searchFilters("x"))).toBe(true); });
    await act(async () => { expect(await result.current.deleteSearch("s1")).toBe(true); });
    expect(sent(api)).toEqual([{ name: "saved_search_save" }, { name: "saved_search_delete" }]);

    const failing = client({ saveSearch: vi.fn().mockRejectedValue(failure), deleteSearch: vi.fn().mockRejectedValue(failure) });
    const other = await loadedHook(failing);
    await act(async () => { expect(await other.result.current.saveSearch("Name", searchFilters("x"))).toBe(false); });
    await act(async () => { expect(await other.result.current.deleteSearch("s1")).toBe(false); });
    expect(sent(failing)).toEqual([]);
  });

  it("sends metadata_export after a saved export and nothing for a cancelled picker or a failure", async () => {
    const api = client({ exportMetadata: vi.fn().mockResolvedValue({ path: "/backup.json", assetCount: 1 }) });
    const { result } = await loadedHook(api);
    await act(async () => { expect(await result.current.exportMetadata()).toBe(true); });
    expect(sent(api)).toEqual([{ name: "metadata_export" }]);

    const cancelled = client({ exportMetadata: vi.fn().mockResolvedValue(null) });
    const cancelledHook = await loadedHook(cancelled);
    await act(async () => { expect(await cancelledHook.result.current.exportMetadata()).toBe(false); });
    expect(sent(cancelled)).toEqual([]);

    const failing = client({ exportMetadata: vi.fn().mockRejectedValue(failure) });
    const failingHook = await loadedHook(failing);
    await act(async () => { expect(await failingHook.result.current.exportMetadata()).toBe(false); });
    expect(sent(failing)).toEqual([]);
  });

  it("sends asset_reconnect and missing_entry_remove after success only", async () => {
    const api = client();
    const { result } = await loadedHook(api);
    const missing = { ...result.current.assets[0]!, status: "missing" as const, metadataState: "valid" as const, metadataId: "uuid" };
    await act(async () => { expect(await result.current.reconnectAsset(missing, result.current.assets[0]!)).toBe(true); });
    await act(async () => { expect(await result.current.removeMissingEntry(missing)).toBe(true); });
    expect(sent(api)).toEqual([{ name: "asset_reconnect" }, { name: "missing_entry_remove" }]);

    const failing = client({ reconnectAsset: vi.fn().mockRejectedValue(failure), removeMissingEntry: vi.fn().mockRejectedValue(failure) });
    const other = await loadedHook(failing);
    const target = other.result.current.assets[0]!;
    await act(async () => { expect(await other.result.current.reconnectAsset(missing, target)).toBe(false); });
    await act(async () => { expect(await other.result.current.removeMissingEntry(missing)).toBe(false); });
    expect(sent(failing)).toEqual([]);
  });

  it("sends asset_trash when at least one item moved, including a partial result, and not for zero or a rejection", async () => {
    const api = client();
    const { result } = await loadedHook(api);
    await act(async () => { expect(await result.current.deleteAssets(result.current.assets)).toBe(true); });
    expect(sent(api)).toEqual([{ name: "asset_trash" }]);

    const partial = client({ deleteAssets: vi.fn().mockResolvedValue({ completedIds: ["path:a.stl"], error: failure }) });
    const partialHook = await loadedHook(partial);
    await act(async () => { expect(await partialHook.result.current.deleteAssets([partialHook.result.current.assets[0]!, secondRow])).toBe(false); });
    expect(sent(partial)).toEqual([{ name: "asset_trash" }]);

    const zero = client({ deleteAssets: vi.fn().mockResolvedValue({ completedIds: [], error: failure }) });
    const zeroHook = await loadedHook(zero);
    await act(async () => { expect(await zeroHook.result.current.deleteAssets(zeroHook.result.current.assets)).toBe(false); });
    expect(sent(zero)).toEqual([]);

    const rejected = client({ deleteAssets: vi.fn().mockRejectedValue(failure) });
    const rejectedHook = await loadedHook(rejected);
    await act(async () => { expect(await rejectedHook.result.current.deleteAssets(rejectedHook.result.current.assets)).toBe(false); });
    expect(sent(rejected)).toEqual([]);
  });

  it("sends asset_open, asset_reveal and path_copy (both copy actions) after success and nothing on failure", async () => {
    const api = client();
    const { result } = await loadedHook(api);
    for (const action of ["open", "reveal", "copyFullPath", "copyRelativePath"] as const) {
      await act(async () => { expect(await result.current.performAction(result.current.assets[0]!, action)).toBe(true); });
    }
    expect(sent(api)).toEqual([{ name: "asset_open" }, { name: "asset_reveal" }, { name: "path_copy" }, { name: "path_copy" }]);

    const failing = client({ performAction: vi.fn().mockRejectedValue(failure) });
    const other = await loadedHook(failing);
    await act(async () => { expect(await other.result.current.performAction(other.result.current.assets[0]!, "open")).toBe(false); });
    expect(sent(failing)).toEqual([]);
  });

  it("sends library_add only when the library list grows, and never library_switch for it", async () => {
    const api = client({ choose: vi.fn().mockResolvedValue(bothLibraries) });
    const { result } = await loadedHook(api);
    await act(() => result.current.chooseLibrary());
    expect(result.current.library?.id).toBe("root2");
    expect(sent(api)).toEqual([{ name: "library_add" }]);

    const cancelled = client({ choose: vi.fn().mockResolvedValue(null) });
    const cancelledHook = await loadedHook(cancelled);
    await act(() => cancelledHook.result.current.chooseLibrary());
    expect(sent(cancelled)).toEqual([]);

    const already = client({ choose: vi.fn().mockResolvedValue(registered) });
    const alreadyHook = await loadedHook(already);
    await act(() => alreadyHook.result.current.chooseLibrary());
    expect(sent(already)).toEqual([]);

    const failing = client({ choose: vi.fn().mockRejectedValue(failure) });
    const failingHook = await loadedHook(failing);
    await act(() => failingHook.result.current.chooseLibrary());
    expect(sent(failing)).toEqual([]);
  });

  it("sends library_remove when the list shrinks and nothing on failure", async () => {
    const api = client();
    const { result } = await loadedHook(api);
    await act(() => result.current.removeLibrary("root1"));
    expect(sent(api)).toEqual([{ name: "library_remove" }]);

    const failing = client({ remove: vi.fn().mockRejectedValue(failure) });
    const other = await loadedHook(failing);
    await act(() => other.result.current.removeLibrary("root1"));
    expect(sent(failing)).toEqual([]);
  });

  it("sends library_switch when another library becomes active and nothing for the same library or a failure", async () => {
    const api = client({ load: vi.fn().mockResolvedValue(bothLibraries), activate: vi.fn(async (id: string) => ({ ...bothLibraries, activeLibraryId: id })) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    await act(() => result.current.activateLibrary("root1"));
    expect(sent(api)).toEqual([{ name: "library_switch" }]);
    await act(() => result.current.activateLibrary("root1"));
    expect(sent(api)).toEqual([{ name: "library_switch" }]);

    const failing = client({ activate: vi.fn().mockRejectedValue(failure) });
    const other = await loadedHook(failing);
    await act(() => other.result.current.activateLibrary("root2"));
    expect(sent(failing)).toEqual([]);
  });

  it("sends theme_change with the committed theme and nothing when the save fails", async () => {
    const api = client();
    const { result } = await loadedHook(api);
    await act(async () => { expect(await result.current.setTheme("coral")).toBe(true); });
    expect(sent(api)).toEqual([{ name: "theme_change", theme: "coral" }]);

    const failing = client({ setTheme: vi.fn().mockRejectedValue(failure) });
    const other = await loadedHook(failing);
    await act(async () => { expect(await other.result.current.setTheme("coral")).toBe(false); });
    expect(sent(failing)).toEqual([]);
  });
});

describe("library_scanned", () => {
  it("is sent once per library per launch with the size range, even after a rescan or a return to that library", async () => {
    const api = client({
      load: vi.fn().mockResolvedValue({ ...bothLibraries, activeLibraryId: "root1", usage: sharing }),
      activate: vi.fn(async (id: string) => ({ ...bothLibraries, activeLibraryId: id, usage: sharing })),
    });
    const { result } = await loadedHook(api);
    expect(sent(api)).toEqual([{ name: "library_scanned", size_range: "under_100" }]);
    await act(() => result.current.rescan());
    expect(api.scan).toHaveBeenCalledTimes(2);
    expect(sent(api)).toHaveLength(1);
    await act(() => result.current.activateLibrary("root2"));
    await waitFor(() => expect(sent(api).filter((event) => event.name === "library_scanned")).toHaveLength(2));
    await act(() => result.current.activateLibrary("root1"));
    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.scanning).toBe(false));
    expect(sent(api).filter((event) => event.name === "library_scanned")).toHaveLength(2);
  });

  it("maps the scanned row count to a size range", async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ ...scanResult.assets[0]!, id: `path:${index}.stl`, relativePath: `${index}.stl` }));
    const api = client({
      load: vi.fn().mockResolvedValue({ ...registered, usage: sharing }),
      scan: vi.fn(async (libraryId, scanId) => ({ ...scanResult, libraryId, scanId, assets: rows })),
    });
    renderHook(() => useLibrary(api));
    await waitFor(() => expect(sent(api)).toEqual([{ name: "library_scanned", size_range: "100_1k" }]));
  });

  it("is not marked while undecided: a scan then sends nothing, and the next completed scan after opting in sends one", async () => {
    const api = client({ load: vi.fn().mockResolvedValue({ ...registered, usage: undecided }) });
    const { result } = await loadedHook(api);
    expect(sent(api)).toEqual([]);
    await act(() => result.current.rescan());
    expect(sent(api)).toEqual([]);
    vi.mocked(api.setUsageConsent).mockResolvedValue({ status: "saved", usage: sharing });
    await act(async () => { await result.current.setUsageConsent("granted"); });
    expect(result.current.state.usage).toEqual(sharing);
    expect(sent(api)).toEqual([]);
    await act(() => result.current.rescan());
    expect(sent(api)).toEqual([{ name: "library_scanned", size_range: "under_100" }]);
    await act(() => result.current.rescan());
    expect(sent(api)).toHaveLength(1);
  });

  it("is not sent when the scan fails", async () => {
    const api = client({ load: vi.fn().mockResolvedValue({ ...registered, usage: sharing }), scan: vi.fn().mockRejectedValue(failure) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.error).toEqual(failure));
    expect(sent(api)).toEqual([]);
  });
});

describe("setUsageConsent", () => {
  it("reaches native while a scan is pending without restarting the scan", async () => {
    const pendingScan = deferred<ScanResult>();
    const api = client({ load: vi.fn().mockResolvedValue({ ...registered, usage: sharing }), scan: vi.fn(() => pendingScan.promise) });
    const { result } = renderHook(() => useLibrary(api));
    await waitFor(() => expect(result.current.scanning).toBe(true));
    let outcome!: Awaited<ReturnType<typeof result.current.setUsageConsent>>;
    await act(async () => { outcome = await result.current.setUsageConsent("declined"); });
    expect(api.setUsageConsent).toHaveBeenCalledExactlyOnceWith("declined");
    expect(outcome).toEqual({ status: "saved", usage: notSharing });
    expect(result.current.state.usage).toEqual(notSharing);
    expect(api.scan).toHaveBeenCalledTimes(1);
    expect(result.current.scanning).toBe(true);
    await act(async () => { pendingScan.resolve({ ...scanResult, scanId: vi.mocked(api.scan).mock.calls[0]![1] }); });
    await waitFor(() => expect(result.current.assets).toHaveLength(1));
    expect(api.scan).toHaveBeenCalledTimes(1);
  });

  it("reaches native while the operation lock is held by another native operation", async () => {
    const pendingEdit = deferred<(typeof scanResult.assets)[number]>();
    const api = client({ editTags: vi.fn(() => pendingEdit.promise) });
    const { result } = await loadedHook(api);
    let edit!: Promise<boolean>;
    act(() => { edit = result.current.editTags(result.current.assets[0]!, ["x"], []); });
    expect(result.current.editingAssetId).toBe("path:a.stl");
    await act(async () => { await result.current.setUsageConsent("declined"); });
    expect(api.setUsageConsent).toHaveBeenCalledExactlyOnceWith("declined");
    expect(result.current.editingAssetId).toBe("path:a.stl");
    await act(async () => { pendingEdit.resolve({ ...scanResult.assets[0]!, tags: ["x"] }); expect(await edit).toBe(true); });
    expect(result.current.editingAssetId).toBeNull();
  });

  it("sends one native call for a double click: the second call reports busy and the first result stands", async () => {
    const pending = deferred<UsageConsentResultValue>();
    const api = client({ setUsageConsent: vi.fn(() => pending.promise) });
    const { result } = await loadedHook(api);
    let first!: Promise<UsageConsentResultValue>;
    let again!: Promise<UsageConsentResultValue>;
    act(() => {
      first = result.current.setUsageConsent("granted");
      again = result.current.setUsageConsent("granted");
    });
    expect(result.current.savingUsage).toBe(true);
    expect(await again).toEqual({ status: "busy" });
    expect(api.setUsageConsent).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ status: "saved", usage: sharing }); expect(await first).toEqual({ status: "saved", usage: sharing }); });
    expect(result.current.savingUsage).toBe(false);
    expect(result.current.state.usage).toEqual(sharing);
    expect(api.setUsageConsent).toHaveBeenCalledTimes(1);
  });

  it("merges a stoppedNotSaved result and lets a later library switch carry native's value", async () => {
    const api = client({
      load: vi.fn().mockResolvedValue({ ...registered, usage: sharing }),
      setUsageConsent: vi.fn().mockResolvedValue({ status: "stoppedNotSaved", reason: "busy", usage: stoppedUsage }),
      activate: vi.fn().mockResolvedValue({ ...registered, usage: sharing }),
    });
    const { result } = await loadedHook(api);
    await act(async () => { expect(await result.current.setUsageConsent("declined")).toEqual({ status: "stoppedNotSaved", reason: "busy", usage: stoppedUsage }); });
    expect(result.current.state.usage).toEqual({ available: true, consent: "declined", saved: false });
    expect(result.current.error).toBeNull();
    await act(() => result.current.activateLibrary("root1"));
    expect(result.current.state.usage).toEqual(sharing);
  });

  it.each([
    ["busy", { status: "busy" } as const],
    ["failed", { status: "failed" } as const],
  ])("leaves usage unchanged for a %s result", async (_name, outcome) => {
    const api = client({ load: vi.fn().mockResolvedValue({ ...registered, usage: sharing }), setUsageConsent: vi.fn().mockResolvedValue(outcome) });
    const { result } = await loadedHook(api);
    const before = result.current.state.usage;
    await act(async () => { expect(await result.current.setUsageConsent("declined")).toEqual(outcome); });
    expect(result.current.state.usage).toBe(before);
    expect(result.current.state.usage).toEqual(sharing);
  });

  it("keeps a saved decline when a later Turn on comes back busy", async () => {
    const setUsageConsent = vi.fn<LibraryClient["setUsageConsent"]>()
      .mockResolvedValueOnce({ status: "saved", usage: notSharing })
      .mockResolvedValueOnce({ status: "busy" });
    const api = client({ load: vi.fn().mockResolvedValue({ ...registered, usage: undecided }), setUsageConsent });
    const { result } = await loadedHook(api);
    await act(async () => { await result.current.setUsageConsent("declined"); });
    expect(result.current.state.usage).toEqual({ available: true, consent: "declined", saved: true });
    await act(async () => { expect(await result.current.setUsageConsent("granted")).toEqual({ status: "busy" }); });
    expect(result.current.state.usage).toEqual({ available: true, consent: "declined", saved: true });
  });

  it("turns a rejected invoke into a failed result without usage", async () => {
    const api = client({ load: vi.fn().mockResolvedValue({ ...registered, usage: sharing }), setUsageConsent: vi.fn().mockRejectedValue(failure) });
    const { result } = await loadedHook(api);
    let outcome!: UsageConsentResultValue;
    await act(async () => { outcome = await result.current.setUsageConsent("declined"); });
    expect(outcome).toEqual({ status: "failed" });
    expect(outcome.usage).toBeUndefined();
    expect(result.current.state.usage).toEqual(sharing);
    expect(result.current.savingUsage).toBe(false);
    // The lock was released: the next call reaches native again.
    await act(async () => { await result.current.setUsageConsent("declined"); });
    expect(api.setUsageConsent).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["saved", { status: "saved", usage: notSharing } as UsageConsentResultValue],
    ["busy", { status: "busy" } as UsageConsentResultValue],
    ["failed", { status: "failed" } as UsageConsentResultValue],
    ["stoppedNotSaved", { status: "stoppedNotSaved", reason: "failed", usage: stoppedUsage } as UsageConsentResultValue],
  ])("never sets the global error for a %s result", async (_name, outcome) => {
    const api = client({ setUsageConsent: vi.fn().mockResolvedValue(outcome) });
    const { result } = await loadedHook(api);
    await act(async () => { await result.current.setUsageConsent("declined"); });
    expect(result.current.error).toBeNull();
  });

  it("never sets the global error for a rejected invoke", async () => {
    const api = client({ setUsageConsent: vi.fn().mockRejectedValue(failure) });
    const { result } = await loadedHook(api);
    await act(async () => { await result.current.setUsageConsent("declined"); });
    expect(result.current.error).toBeNull();
  });
});
type UsageConsentResultValue = Awaited<ReturnType<LibraryClient["setUsageConsent"]>>;
