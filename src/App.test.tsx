// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";
import { useLibrary } from "./useLibrary";
import type { Asset, LibraryState, LibrarySummary, ScanIssue } from "./types";

vi.mock("./useLibrary", () => ({ useLibrary: vi.fn() }));

afterEach(cleanup);

const library: LibrarySummary = {
  id: "library-1", name: "Workshop", rootPath: "/Users/test/Workshop", assetCount: 2, lastScanAt: "2026-10-05T10:00:00.000Z",
};
const secondLibrary: LibrarySummary = {
  id: "library-2", name: "Archive", rootPath: "/Users/test/Archive", assetCount: 0, lastScanAt: null,
};
const assets: Asset[] = [
  { id: "asset-1", name: "Gear.stl", relativePath: "Gear.stl", kind: "file", extension: "stl", modifiedAt: "2026-10-01T10:00:00.000Z", sizeBytes: 1024, tags: [], status: "untagged", metadataRevision: "rev-1" },
  { id: "asset-2", name: "Models", relativePath: "Models", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged", metadataRevision: "rev-2" },
];
const issue: ScanIssue = { message: "Could not read directory", path: "Private", details: "Permission denied" };

const libraryState: LibraryState = { libraries: [library, secondLibrary], activeLibraryId: library.id };
const actions = {
  editTags: vi.fn<(_: Asset, __: string[], ___: string[]) => Promise<boolean>>(),
  bulkEditTags: vi.fn<(_: Asset[], __: string[], ___: string[]) => Promise<boolean>>(),
  saveSearch: vi.fn<(_: string, __: import("./types").SearchFilters, ___?: string) => Promise<boolean>>(),
  deleteSearch: vi.fn<(_: string) => Promise<boolean>>(),
  chooseLibrary: vi.fn<() => Promise<void>>(),
  activateLibrary: vi.fn<(_: string) => Promise<void>>(),
  removeLibrary: vi.fn<(_: string) => Promise<void>>(),
  rescan: vi.fn<() => Promise<void>>(),
  cancelScan: vi.fn<() => Promise<boolean>>(),
  dismissError: vi.fn<() => void>(),
  performAction: vi.fn<(_: Asset, __: import("./types").AssetAction) => Promise<boolean>>(),
  validateMetadata: vi.fn<() => Promise<boolean>>(),
  exportMetadata: vi.fn<() => Promise<boolean>>(),
  getReconnectTargets: vi.fn<(_: Asset) => Promise<Asset[] | null>>(),
  reconnectAsset: vi.fn<(_: Asset, __: Asset) => Promise<boolean>>(),
};

function setLibraryResult(overrides: Partial<{
  state: LibraryState;
  library: LibrarySummary | null;
  assets: Asset[];
  issues: ScanIssue[];
  loading: boolean;
  scanning: boolean;
  progress: number;
  error: { message: string; path: string | null; details: string | null } | null;
  isDesktop: boolean;
  editingAssetId: string | null;
  bulkEditing: boolean;
  savingSearch: boolean;
  savedSearches: import("./types").SavedSearch[];
  actionBusy: boolean;
  recoveryBusy: boolean;
  validation: import("./types").ValidationReport | null;
  exportResult: import("./types").ExportResult | null;
}> = {}) {
  vi.mocked(useLibrary).mockReturnValue({
    state: libraryState,
    library,
    assets,
    issues: [],
    loading: false,
    scanning: false,
    progress: 0,
    error: null,
    chooseLibrary: actions.chooseLibrary,
    activateLibrary: actions.activateLibrary,
    removeLibrary: actions.removeLibrary,
    rescan: actions.rescan,
    cancelScan: actions.cancelScan,
    dismissError: actions.dismissError,
    editTags: actions.editTags,
    bulkEditTags: actions.bulkEditTags,
    bulkEditing: false,
    savedSearches: [],
    savingSearch: false,
    saveSearch: actions.saveSearch,
    deleteSearch: actions.deleteSearch,
    performAction: actions.performAction,
    actionBusy: false,
    validateMetadata: actions.validateMetadata,
    validation: null,
    exportMetadata: actions.exportMetadata,
    exportResult: null,
    getReconnectTargets: actions.getReconnectTargets,
    reconnectAsset: actions.reconnectAsset,
    recoveryBusy: false,
    editingAssetId: null,
    isDesktop: true,
    ...overrides,
  });
}

function assetRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  setLibraryResult();
});

describe("scanned library UI", () => {
  it("shows only immediate child files and folders, never recursive descendants at root", () => {
    const folder: Asset = { id: "folder", name: "Models", relativePath: "Models", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const nested: Asset = { ...assets[0], id: "nested", relativePath: "Models/Nested.stl", name: "Nested.stl" };
    const root: Asset = { id: "root", name: "Workshop", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    setLibraryResult({ assets: [root, folder, nested] });
    render(<App />);
    expect(assetRows()).toHaveLength(1);
    expect(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" })).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText("Nested.stl")).toBeNull();
  });
  it("navigates double-clicked folders, restores parent filter, and scopes saved query rows", () => {
    const root: Asset = { id: "root", name: "Workshop", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const folder: Asset = { id: "folder", name: "Models", relativePath: "Models", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const directGear: Asset = { ...assets[0], id: "gear", name: "DirectGear.stl", relativePath: "Gear.stl" };
    const nestedGear: Asset = { ...assets[0], id: "nested-gear", name: "Gear.stl", relativePath: "Models/Gear.stl" };
    const nestedFolder: Asset = { ...folder, id: "nested-folder", name: "Parts", relativePath: "Models/Parts" };
    const deepFile: Asset = { ...assets[0], id: "deep", name: "Deep.stl", relativePath: "Models/Parts/Deep.stl" };
    const saved: import("./types").SavedSearch = { id: "saved-nested", libraryId: library.id, name: "Nested gear", filters: { query: '"Gear.stl"', view: "all", matchMode: "all", kind: "file" } };
    setLibraryResult({ assets: [root, folder, directGear, nestedGear, nestedFolder, deepFile], savedSearches: [saved] });
    render(<App />);
    expect(assetRows()).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByText("DirectGear.stl")).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText("Gear.stl", { selector: ".name-content span" })).toBeNull();
    fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).toContain("Models");
    expect(screen.getByRole("button", { name: "Go up one folder" })).toBeTruthy();
    expect(assetRows()).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByText("Gear.stl", { selector: ".name-content span" })).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Parts", { selector: ".folder-name" })).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText("Deep.stl")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Nested gear/ }));
    expect(assetRows()).toHaveLength(1);
    expect(within(screen.getByRole("table")).getByText("Gear.stl", { selector: ".name-content span" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear active filter" }));
    expect(assetRows()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Go up one folder" }));
    expect(assetRows()).toHaveLength(2);
    expect(within(screen.getByRole("table")).queryByText("Gear.stl", { selector: ".name-content span" })).toBeNull();
  });
  it("keeps folder Up navigation in the catalog toolbar, outside the sidebar", () => {
    const folder: Asset = { ...assets[1], id: "folder-codes", name: "Codes", relativePath: "Codes" };
    const nested: Asset = { ...assets[0], id: "nested", name: "Example.ts", relativePath: "Codes/Example.ts" };
    setLibraryResult({ assets: [folder, nested] });
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "Library navigation" });
    expect(within(sidebar).queryByRole("button", { name: "Go up one folder" })).toBeNull();
    fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Codes", { selector: ".folder-name" }));
    const catalog = screen.getByRole("region", { name: "Assets catalog" });
    expect(within(catalog).getByRole("button", { name: "Go up one folder" })).toBeTruthy();
    fireEvent.click(within(catalog).getByRole("button", { name: "Go up one folder" }));
    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).not.toContain("Codes");
    expect(within(sidebar).queryByRole("button", { name: "Go up one folder" })).toBeNull();
  });
  it("returns to library root when a rescan clears all folders", () => {
    const root: Asset = { id: "root", name: "Workshop", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const folder: Asset = { ...assets[1], id: "nested-folder", relativePath: "Models" };
    const child: Asset = { ...assets[0], id: "nested-file", relativePath: "Models/Gear.stl" };
    setLibraryResult({ assets: [root, folder, child] });
    const { rerender } = render(<App />);
    fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).toContain("Models");
    setLibraryResult({ assets: [] });
    rerender(<App />);
    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).not.toContain("Models");
    expect(assetRows()).toHaveLength(0);
  });
  it("folder Open stays in native file action context while double-click enters", () => {
    const folder: Asset = { ...assets[1], relativePath: "Models" };
    const root: Asset = { id: "root", name: "Workshop", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const nested: Asset = { ...assets[0], id: "nested", relativePath: "Models/Nested.stl", name: "Nested.stl" };
    setLibraryResult({ assets: [root, folder, nested] });
    render(<App />);
    fireEvent.click(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(actions.performAction).toHaveBeenCalledWith(folder, "open");
    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).not.toContain("Models");
    fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).toContain("Models");
  });
  function syntheticAssets(count: number): Asset[] {
    return Array.from({ length: count }, (_, index) => ({ ...assets[0], id: `synthetic-${index}`, name: `synthetic-${String(index).padStart(6, "0")}.stl`, relativePath: `synthetic-${String(index).padStart(6, "0")}.stl` }));
  }

  it("bounds mounted rows while retaining full catalog counts and last-row access", () => {
    const catalog = syntheticAssets(500);
    setLibraryResult({ assets: catalog });
    render(<App />);
    expect(assetRows().length).toBeLessThan(80);
    expect(screen.getByText("500", { selector: ".table-footer strong" })).toBeTruthy();
    const scroll = screen.getByRole("table").parentElement!;
    fireEvent.scroll(scroll, { target: { scrollTop: 500 * 40 } });
    expect(assetRows().length).toBeLessThan(80);
    expect(within(screen.getByRole("table")).getByText(catalog[499].name, { selector: ".name-content span" })).toBeTruthy();
    fireEvent.doubleClick(within(screen.getByRole("table")).getByText(catalog[499].name, { selector: ".name-content span" }));
    expect(actions.performAction).toHaveBeenCalledWith(catalog[499], "open");
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: '"synthetic-000001"' } });
    expect(assetRows()).toHaveLength(1);
    expect(within(assetRows()[0]).getByText(catalog[1].name, { selector: ".name-content span" })).toBeTruthy();
  });

  it("mounts only the current folder window, not nested descendants", () => {
    const root: Asset = { id: "root", name: "Library", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const folder: Asset = { id: "folder", name: "Folder", relativePath: "Folder", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const nested: Asset = { ...assets[0], id: "nested", name: "Nested.stl", relativePath: "Folder/Nested.stl" };
    const deep: Asset = { ...assets[0], id: "deep", name: "Deep.stl", relativePath: "Folder/Deep.stl" };
    setLibraryResult({ assets: [root, folder, nested, deep] });
    render(<App />);
    expect(screen.getAllByRole("row").length).toBe(2);
    expect(screen.getByText("Folder", { selector: ".folder-name" })).toBeTruthy();
    expect(screen.queryByText("Nested.stl")).toBeNull();
    fireEvent.doubleClick(screen.getByText("Folder", { selector: ".folder-name" }));
    expect(screen.getAllByRole("row").length).toBe(3);
    expect(screen.getByText("Nested.stl", { selector: ".name-content span" })).toBeTruthy();
    expect(screen.getByText("Deep.stl", { selector: ".name-content span" })).toBeTruthy();
  });

  it("keeps scrolled row visible after tag data refresh and resets for sort changes", () => {
    const catalog = syntheticAssets(500);
    setLibraryResult({ assets: catalog });
    const { rerender } = render(<App />);
    const scroll = screen.getByRole("table").parentElement!;
    fireEvent.scroll(scroll, { target: { scrollTop: 500 * 40 } });
    setLibraryResult({ assets: catalog.map((asset, index) => index === 499 ? { ...asset, tags: ["favorite"], metadataRevision: "updated" } : asset) });
    rerender(<App />);
    expect(within(screen.getByRole("table")).getByText(catalog[499].name, { selector: ".name-content span" })).toBeTruthy();
    expect(scroll.scrollTop).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^NAME/ }));
    expect(scroll.scrollTop).toBe(0);
  });

  it("preserves full range selection across unmounted rows", () => {
    const catalog = syntheticAssets(500);
    setLibraryResult({ assets: catalog });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.scroll(screen.getByRole("table").parentElement!, { target: { scrollTop: 500 * 40 } });
    fireEvent.click(within(screen.getByRole("table")).getByText(catalog[499].name, { selector: ".name-content span" }), { shiftKey: true });
    expect(screen.getByText("500 rows selected · showing most recent")).toBeTruthy();
    expect(assetRows().every((row) => row.getAttribute("aria-selected") === "true")).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Edit tags in bulk" }).disabled).toBe(false);
  });

  it("moves keyboard focus across virtual windows without selecting tag input events", () => {
    const catalog = syntheticAssets(500);
    setLibraryResult({ assets: catalog });
    render(<App />);
    const first = assetRows()[0];
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement?.getAttribute("title")).toBe(catalog[499].relativePath);
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement?.getAttribute("title")).toBe(catalog[0].relativePath);
    const input = within(assetRows()[0]).getByRole("combobox", { name: "Add tag" });
    fireEvent.keyDown(input, { key: "End" });
    expect(within(screen.getByRole("table")).getByText(catalog[0].name, { selector: ".name-content span" })).toBeTruthy();
  });
  it("applies search terms to blocked rows in Needs attention", () => {
    setLibraryResult({ assets: [{ ...assets[0], metadataState: "blocked", status: "warning" }], issues: [] });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: '"not-this-file"' } });
    expect(assetRows()).toHaveLength(0);
  });
  it("shows library identity and root path only in the sidebar", () => {
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "Library navigation" });
    expect(within(sidebar).getByRole("combobox", { name: "Active library" })).toBeTruthy();
    expect(screen.getAllByText("Workshop")).toHaveLength(1);
    expect(screen.getAllByText(library.rootPath)).toHaveLength(1);
    const summary = screen.getByLabelText("Library summary");
    expect(within(summary).getByText("ASSETS")).toBeTruthy();
    expect(within(summary).getByText("LAST SCAN")).toBeTruthy();
    expect(within(summary).queryByText("LIBRARY")).toBeNull();
    expect(within(summary).queryByText("LOCATION")).toBeNull();
  });

  it("shows one scan status and one rescan action", () => {
    setLibraryResult({ scanning: true, progress: 165539, assets: [] });
    const { rerender } = render(<App />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getAllByText(`${(165539).toLocaleString()} entries visited`)).toHaveLength(1);
    expect(screen.getAllByText("Scanning library…")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Assets catalog" })).getByRole("status")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Rescan$/ })).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Rescan$/ }).disabled).toBe(true);
    const stop = screen.getByRole<HTMLButtonElement>("button", { name: "Stop scanning" });
    expect(stop.disabled).toBe(false);
    fireEvent.click(stop);
    expect(actions.cancelScan).toHaveBeenCalledOnce();
    setLibraryResult();
    rerender(<App />);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Rescan$/ }));
    expect(actions.rescan).toHaveBeenCalledOnce();
  });

  it("retains active library context when sidebar is collapsed", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByText("Workshop")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getAllByText("Workshop")).toHaveLength(1);
  });
  it("shows actionable first-run state without mock data", () => {
    setLibraryResult({ state: { libraries: [], activeLibraryId: null }, library: null, assets: [] });
    render(<App />);
    expect(assetRows()).toHaveLength(0);
    expect(screen.getByText("Choose a library folder")).toBeTruthy();
    expect(screen.getAllByRole<HTMLButtonElement>("button", { name: "Choose library folder" })).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Choose library folder" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Choose library folder" }));
    expect(actions.chooseLibrary).toHaveBeenCalledOnce();
  });

  it("shows scanned root directory while clearly identifying empty library", () => {
    const root: Asset = { id: "root-asset", name: "Workshop", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "ready" };
    setLibraryResult({ assets: [root] });
    render(<App />);
    expect(within(screen.getByRole("table")).queryByText("Workshop")).toBeNull();
    expect(screen.getByText(/This folder is empty/)).toBeTruthy();
    expect(screen.getByText("0", { selector: ".table-footer strong" })).toBeTruthy();
  });

  it("requires the desktop app instead of silently showing demo assets in browser", () => {
    setLibraryResult({ state: { libraries: [], activeLibraryId: null }, library: null, assets: [], isDesktop: false });
    render(<App />);
    expect(assetRows()).toHaveLength(0);
    expect(screen.getByText(/No demo data is loaded in browser preview/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Choose library folder" }).disabled).toBe(true);
  });

  it("lists registered libraries and activates selected library", () => {
    render(<App />);
    const picker = screen.getByRole<HTMLSelectElement>("combobox", { name: "Active library" });
    expect(within(picker).getByRole("option", { name: "Workshop" })).toBeTruthy();
    expect(within(picker).getByRole("option", { name: "Archive" })).toBeTruthy();
    fireEvent.change(picker, { target: { value: secondLibrary.id } });
    expect(actions.activateLibrary).toHaveBeenCalledWith(secondLibrary.id);
    expect(screen.getAllByText(library.rootPath).length).toBeGreaterThan(0);
    expect(screen.getByText("2", { selector: ".summary-strip strong" })).toBeTruthy();
  });

  it("allows activating a remaining library when no library is active", () => {
    setLibraryResult({ state: { libraries: [secondLibrary], activeLibraryId: null }, library: null, assets: [] });
    render(<App />);
    const picker = screen.getByRole<HTMLSelectElement>("combobox", { name: "Active library" });
    expect(within(picker).getByRole("option", { name: "Choose a library" })).toBeTruthy();
    expect(picker.value).toBe("");
    fireEvent.change(picker, { target: { value: secondLibrary.id } });
    expect(actions.activateLibrary).toHaveBeenCalledWith(secondLibrary.id);
  });

  it("resets filters and selection when active library changes", () => {
    const { rerender } = render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: '"Gear"' } });
    setLibraryResult({ state: { libraries: [library, secondLibrary], activeLibraryId: secondLibrary.id }, library: secondLibrary, assets: [] });
    rerender(<App />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe("");
    expect(screen.queryByText("Gear.stl")).toBeNull();
    expect(screen.getAllByText("Archive").length).toBeGreaterThan(0);
  });

  it("confirms registration removal and states that files remain untouched", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Remove library registration" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Files and folders will not be changed"));
    expect(actions.removeLibrary).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove library registration" }));
    expect(actions.removeLibrary).toHaveBeenCalledWith(library.id);
    confirm.mockRestore();
  });

  it("does not mislabel cleared rows as an empty library during scan or failure", () => {
    setLibraryResult({ assets: [], scanning: true });
    const { rerender } = render(<App />);
    expect(screen.getAllByText("Scanning library…").length).toBeGreaterThan(0);
    expect(screen.queryByText(/This folder is empty/)).toBeNull();
    setLibraryResult({ assets: [], error: { message: "Scan failed", path: null, details: null } });
    rerender(<App />);
    expect(screen.getByText("Scan could not complete")).toBeTruthy();
    expect(screen.queryByText(/This folder is empty/)).toBeNull();
  });

  it("shows scan progress and runs rescan", () => {
    setLibraryResult({ scanning: true, progress: 37 });
    render(<App />);
    expect(screen.getAllByText(/37/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole<HTMLButtonElement>("button", { name: /Rescan/ }).every((button) => button.disabled)).toBe(true);
    cleanup();
    setLibraryResult();
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: /Rescan/ })[0]);
    expect(actions.rescan).toHaveBeenCalledTimes(1);
  });

  it("shows scan errors with path and expandable technical details", () => {
    setLibraryResult({ error: { message: "Library scan failed", path: "Models", details: "OS error 13" } });
    render(<App />);
    expect(screen.getByRole("alert").textContent).toContain("Library scan failed");
    expect(screen.getAllByText("Models").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("OS error 13")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(actions.dismissError).toHaveBeenCalledOnce();
  });

  it("lists unreadable scan issues separately from metadata status", () => {
    setLibraryResult({ issues: [issue] });
    render(<App />);
    expect(screen.getByText("1 issue need attention")).toBeTruthy();
    expect(screen.getByText("Could not read directory")).toBeTruthy();
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(screen.getByText(/Editing changes metadata only/)).toBeTruthy();
  });

  it("renders actual hook assets, filters, selection and summary counts", () => {
    render(<App />);
    expect(assetRows()).toHaveLength(2);
    expect(screen.getByText("2", { selector: ".summary-strip strong" })).toBeTruthy();
    expect(screen.getAllByText("items in this folder", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText("2", { selector: ".table-footer strong" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Untagged2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs attention0" })).toBeTruthy();
    expect(screen.getAllByRole("combobox", { name: "Add tag" })).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: '"Gear"' } });
    expect(assetRows()).toHaveLength(1);
    expect(within(screen.getByRole("table")).getByText("Gear.stl", { selector: ".name-cell .name-content span" })).toBeTruthy();
    fireEvent.click(assetRows()[0]);
    expect(assetRows()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("keeps untagged view and sidebar counts based on live tags", () => {
    const tagged: Asset = { ...assets[0], tags: ["category:gear"], metadataRevision: "rev-1" };
    setLibraryResult({ assets: [tagged, assets[1]] });
    render(<App />);
    expect(screen.getByRole("button", { name: "Untagged1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Untagged1" }));
    expect(assetRows()).toHaveLength(1);
    expect(within(assetRows()[0]).getByText("Models", { selector: ".folder-name" })).toBeTruthy();
  });

  it("keeps tag editing in each single asset row and stops row selection", () => {
    const tagged: Asset = { ...assets[0], tags: ["category:gear"], metadataRevision: "rev-1" };
    setLibraryResult({ assets: [tagged, assets[1]] });
    render(<App />);
    const row = assetRows()[0];
    fireEvent.click(within(row).getByRole("button", { name: "Remove tag category:gear" }));
    expect(actions.editTags).toHaveBeenCalledWith(tagged, [], ["category:gear"]);
    expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("shows blocked metadata warning and disables its tag editor", () => {
    const blocked: Asset = { ...assets[0], tags: ["category:gear"], metadataRevision: "rev-1", metadataState: "blocked" };
    setLibraryResult({ assets: [blocked] });
    render(<App />);
    expect(screen.getAllByText("Metadata issue").length).toBeGreaterThan(0);
    fireEvent.click(assetRows()[0]);
    expect(screen.getByText(/Metadata needs attention\. Tag editing is disabled/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove tag category:gear" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Add tag" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "category:gear" }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    expect(assetRows()).toHaveLength(1);
  });

  it("shows sidecar metadata identity and notes as read-only inspector content", () => {
    const noted: Asset = { ...assets[0], tags: ["style:flexi"], metadataId: "meta-uuid", metadataRevision: "rev-1", notes: "Print slowly." };
    setLibraryResult({ assets: [noted] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    expect(screen.getByText("Metadata ID · meta-uuid")).toBeTruthy();
    expect(screen.getByText("Print slowly.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove tag style:flexi" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "style:flexi" })).toHaveLength(2);
    expect(screen.getByText(/asset files and paths stay untouched/i)).toBeTruthy();
  });

  it("disables edits across rows while one metadata edit is in flight", () => {
    setLibraryResult({ editingAssetId: "asset-1", assets: [{ ...assets[0], tags: ["category:gear"] }, { ...assets[1], tags: ["category:gear"] }] });
    render(<App />);
    expect(screen.getAllByRole("combobox", { name: "Add tag" }).every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getAllByRole("button", { name: /^Remove tag/ }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByText("Saving…")).toBeTruthy();
    expect(screen.getAllByText("Saving…")).toHaveLength(1);
  });

  it("supports keyboard and range selection", () => {
    render(<App />);
    const rows = assetRows();
    fireEvent.keyDown(rows[0], { key: "Enter" });
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(rows[1], { shiftKey: true });
    expect(assetRows().filter((row) => row.getAttribute("aria-selected") === "true")).toHaveLength(2);
  });

  it("combines Any required tags with kind filter and resets filters on library switch", () => {
    const first = { ...assets[0], tags: ["category:gear"], metadataRevision: "rev-1" };
    const second = { ...assets[1], tags: ["style:flexi"], metadataRevision: "rev-2" };
    setLibraryResult({ assets: [first, second] });
    const { rerender } = render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: "category:gear style:flexi" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Required tag match" }), { target: { value: "any" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Asset kind" }), { target: { value: "folder" } });
    expect(assetRows()).toHaveLength(1);
    expect(within(assetRows()[0]).getByText("Models", { selector: ".folder-name" })).toBeTruthy();
    const storedSearch: import("./types").SavedSearch = { id: "saved-1", libraryId: secondLibrary.id, name: "Gear OR flexi folders", filters: { query: "category:gear style:flexi", view: "all", matchMode: "any", kind: "folder" } };
    setLibraryResult({ state: { ...libraryState, activeLibraryId: secondLibrary.id }, library: secondLibrary, assets: [], savedSearches: [storedSearch] });
    rerender(<App />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe("");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Required tag match" }).value).toBe("all");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Asset kind" }).value).toBe("all");
    fireEvent.click(screen.getByRole("button", { name: /Gear OR flexi folders/ }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe(storedSearch.filters.query);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Required tag match" }).value).toBe("any");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Asset kind" }).value).toBe("folder");
  });

  it("opens bulk dialog with exact currently selected rows and confirms once", async () => {
    const confirm = actions.bulkEditTags.mockResolvedValue(true);
    setLibraryResult({ assets: [{ ...assets[0], tags: ["category:gear"] }, assets[1]] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(assetRows()[1], { metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Edit tags in bulk" }));
    expect(screen.getByText("2 selected assets")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Add tags" }), { target: { value: "style:flexi" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Add tags" }), { key: "Enter" });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
    expect(confirm).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "asset-1" }), expect.objectContaining({ id: "asset-2" })]), ["style:flexi"], []);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("disables library mutation controls while bulk edit or saved search persistence is busy", () => {
    setLibraryResult({ bulkEditing: true, assets: [{ ...assets[0], metadataRevision: "rev-1" }, { ...assets[1], metadataRevision: "rev-2" }] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(assetRows()[1], { metaKey: true });
    expect((screen.getByRole("button", { name: "Edit tags in bulk" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^Rescan$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Active library" }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getAllByRole("combobox", { name: "Add tag" })[0] as HTMLInputElement).disabled).toBe(true);
    cleanup();
    setLibraryResult({ savingSearch: true });
    render(<App />);
    expect((screen.getByRole("button", { name: "Save search" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^Rescan$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("manages saved searches through create and explicit update controls", () => {
    const saved: import("./types").SavedSearch = { id: "saved-1", libraryId: library.id, name: "Gear", filters: { query: "category:gear", view: "all", matchMode: "all", kind: "all" } };
    setLibraryResult({ savedSearches: [saved] });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Save search" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: "category:gear" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Required tag match" }), { target: { value: "any" } });
    fireEvent.click(screen.getByRole("button", { name: "Manage saved searches" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    expect((screen.getByRole("button", { name: "Update search" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Tag matching: Any required tag")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search name" }), { target: { value: "Gear OR" } });
    fireEvent.click(screen.getByRole("button", { name: "Update search" }));
    expect(actions.saveSearch).toHaveBeenCalledWith("Gear OR", { query: "category:gear", view: "all", matchMode: "any", kind: "all" }, saved.id);
  });

  it("opens existing row on double-click through native action API", () => {
    const existing = { ...assets[0], status: "ready" as const };
    setLibraryResult({ assets: [existing] });
    render(<App />);
    fireEvent.doubleClick(assetRows()[0]);
    expect(actions.performAction).toHaveBeenCalledWith(existing, "open");
  });

  it("exposes safe context actions for clicked row without applying to bulk selection", () => {
    const existing = { ...assets[0], status: "ready" as const };
    setLibraryResult({ assets: [existing, assets[1]] });
    render(<App />);
    fireEvent.contextMenu(assetRows()[1]);
    const menu = screen.getByRole("menu", { name: "Actions for Models" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open" }));
    expect(actions.performAction).toHaveBeenCalledWith(assets[1], "open");
    expect(actions.performAction).toHaveBeenCalledOnce();
  });

  it("disables file actions for missing assets and starts explicit metadata recovery", async () => {
    const missing: Asset = { ...assets[0], name: "Old Fox.stl", relativePath: "Old Fox.stl", status: "missing", metadataState: "valid", metadataId: "metadata-uuid", metadataRevision: "missing-revision", tags: ["theme:fox"], notes: "Keep supports." };
    actions.getReconnectTargets.mockResolvedValueOnce([assets[0]]);
    setLibraryResult({ assets: [missing] });
    render(<App />);
    fireEvent.contextMenu(assetRows()[0]);
    const menu = screen.getByRole("menu", { name: "Actions for Old Fox.stl" });
    expect((within(menu).getByRole("menuitem", { name: "Open" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(menu).getByRole("menuitem", { name: "Copy full path" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reconnect metadata" }));
    expect(await screen.findByRole("dialog", { name: "Reconnect metadata" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Existing file in same folder" }), { target: { value: assets[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "Review reconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reconnect" }));
    expect(actions.reconnectAsset).toHaveBeenCalledWith(missing, assets[0]);
  });

  it("routes full and relative path copy through native action enums", () => {
    setLibraryResult({ assets: [{ ...assets[0], status: "ready" }] });
    render(<App />);
    fireEvent.click(screen.getByText("Gear.stl", { selector: ".name-cell .name-content span" }));
    fireEvent.click(screen.getByRole("button", { name: /Relative path/ }));
    fireEvent.click(screen.getByRole("button", { name: /Full path/ }));
    expect(actions.performAction).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "asset-1" }), "copyRelativePath");
    expect(actions.performAction).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "asset-1" }), "copyFullPath");
  });

  it("shows validation result paths and JSON export result", () => {
    const validation: import("./types").ValidationReport = { libraryId: library.id, assetsChecked: 12, validatedAt: "2026-10-05T10:00:00.000Z", issues: [{ message: "Malformed sidecar manifest", path: "Models/.asset-tags.json", details: "Unexpected token" }] };
    const exportResult: import("./types").ExportResult = { path: "/Users/test/backup.json", assetCount: 12 };
    setLibraryResult({ validation, exportResult });
    render(<App />);
    expect(screen.getByText("1 validation issue")).toBeTruthy();
    expect(screen.getByText("Malformed sidecar manifest")).toBeTruthy();
    expect(screen.getByText("Models/.asset-tags.json")).toBeTruthy();
    expect(screen.getByText("/Users/test/backup.json")).toBeTruthy();
    fireEvent.click(screen.getByText("Review validation issues"));
    expect(screen.getByText("Unexpected token")).toBeTruthy();
  });

  it("closes a pending recovery target request when active library changes", async () => {
    let resolveTargets: ((value: Asset[]) => void) | undefined;
    actions.getReconnectTargets.mockImplementationOnce(() => new Promise((resolve) => { resolveTargets = resolve; }));
    const missing = { ...assets[0], status: "missing" as const, metadataState: "valid" as const, metadataId: "metadata-uuid" };
    setLibraryResult({ assets: [missing] });
    const { rerender } = render(<App />);
    fireEvent.contextMenu(assetRows()[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reconnect metadata" }));
    setLibraryResult({ state: { libraries: [library, secondLibrary], activeLibraryId: secondLibrary.id }, library: secondLibrary, assets: [] });
    rerender(<App />);
    await Promise.resolve();
    resolveTargets?.([assets[1]]);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole("dialog", { name: "Reconnect metadata" })).toBeNull();
  });

  it("keeps missing asset file actions, including path copies, disabled", () => {
    const missing = { ...assets[0], status: "missing" as const, metadataState: "valid" as const, metadataId: "metadata-uuid" };
    setLibraryResult({ assets: [missing] });
    render(<App />);
    fireEvent.contextMenu(assetRows()[0]);
    const menu = screen.getByRole("menu", { name: "Actions for Gear.stl" });
    expect((within(menu).getByRole("menuitem", { name: "Copy full path" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(menu).getByRole("menuitem", { name: "Copy relative path" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Relative path/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.performAction).not.toHaveBeenCalled();
  });

  it("shows successful metadata validation with clean result", () => {
    const validation: import("./types").ValidationReport = { libraryId: library.id, assetsChecked: 12, validatedAt: "2026-10-05T10:00:00.000Z", issues: [] };
    setLibraryResult({ validation });
    render(<App />);
    expect(screen.getByText("Metadata validation passed")).toBeTruthy();
    expect(screen.getByText("No metadata integrity problems found.")).toBeTruthy();
  });

  it("keeps portal context menu open on layout scroll and closes on user wheel", () => {
    render(<App />);
    fireEvent.contextMenu(assetRows()[0], { clientX: 420, clientY: 520 });
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    fireEvent.scroll(screen.getByRole("table").parentElement!);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.wheel(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("runs validation and export from UI actions", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Validate metadata" }));
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(actions.validateMetadata).toHaveBeenCalledOnce();
    expect(actions.exportMetadata).toHaveBeenCalledOnce();
  });

  it("does not open asset when double-click originates in tag controls", () => {
    const existing = { ...assets[0], tags: ["category:gear"], status: "ready" as const };
    setLibraryResult({ assets: [existing] });
    render(<App />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "category:gear" }));
    expect(actions.performAction).not.toHaveBeenCalled();
  });

  it("supports sortable selectable rows and optional columns", () => {
    render(<App />);
    const rows = assetRows();
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1], { metaKey: true });
    expect(screen.getByText(/2 rows selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose visible columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Path" }));
    expect(screen.queryByRole("columnheader", { name: "PATH" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^NAME/ }));
    expect(screen.getByRole("columnheader", { name: /^NAME/ }).getAttribute("aria-sort")).toBe("descending");
  });
});
