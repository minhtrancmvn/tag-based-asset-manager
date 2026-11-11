// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import * as appUpdatesModule from "./appUpdates";
import { DEVELOPMENT_VERSION, getAppVersion } from "./appVersion";
import { useLibrary } from "./useLibrary";
import { deriveRenameMigration } from "./tagRename";
import { themePalettes } from "./themes";
import { usageMessageText } from "./components/UsageConsentDialog";
import type { UsageMessageId } from "./components/UsageConsentDialog";
import type { RenameMigration } from "./tagRename";
import type { Asset, LibraryState, LibrarySummary, RenameApplyResult, RenameMapping, RenamePreview, RenameSkippedRow, RenameTargetSummary, SavedSearch, ScanIssue } from "./types";

vi.mock("./useLibrary", () => ({ useLibrary: vi.fn() }));
vi.mock("./appVersion", () => ({ DEVELOPMENT_VERSION: "Development build · version unavailable", getAppVersion: vi.fn() }));
vi.mock("./appUpdates", () => ({
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
}));

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
  setTheme: vi.fn<(_: import("./themes").AppTheme) => Promise<boolean>>(),
  editTags: vi.fn<(_: Asset, __: string[], ___: string[]) => Promise<boolean>>(),
  editNotes: vi.fn<(_: Asset, __: string) => Promise<boolean>>(),
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
  removeMissingEntry: vi.fn<(_: Asset) => Promise<boolean>>(),
  deleteAssets: vi.fn<(_: Asset[]) => Promise<boolean>>(),
  previewAsset: vi.fn<(_: Asset) => Promise<import("./types").PreviewResult | null>>(),
  previewTagRename: vi.fn<(_: import("./useLibrary").RenamePreviewInput) => Promise<import("./useLibrary").RenamePreviewResult>>(),
  cancelTagRenamePreview: vi.fn<() => Promise<boolean>>(),
  applyTagRename: vi.fn<(_: string, __: import("./useLibrary").ActiveQueryBinding) => Promise<import("./useLibrary").RenameApplyHookResult>>(),
};

function setLibraryResult(overrides: Partial<{
  state: LibraryState;
  library: LibrarySummary | null;
  assets: Asset[];
  issues: ScanIssue[];
  loading: boolean;
  scanning: boolean;
  scanStopped: boolean;
  progress: number;
  error: { message: string; path: string | null; details: string | null } | null;
  isDesktop: boolean;
  editingAssetId: string | null;
  editingNotesAssetId: string | null;
  bulkEditing: boolean;
  savingSearch: boolean;
  savedSearches: import("./types").SavedSearch[];
  actionBusy: boolean;
  recoveryBusy: boolean;
  validation: import("./types").ValidationReport | null;
  exportResult: import("./types").ExportResult | null;
  theme: import("./themes").AppTheme;
  savingTheme: boolean;
  setTheme: (theme: import("./themes").AppTheme) => Promise<boolean>;
  renamePreviewing: boolean;
  renameApplying: boolean;
  renameProgress: number;
}> = {}) {
  vi.mocked(useLibrary).mockReturnValue({
    state: libraryState,
    library,
    assets,
    issues: [],
    loading: false,
    scanning: false,
    scanStopped: false,
    progress: 0,
    error: null,
    chooseLibrary: actions.chooseLibrary,
    activateLibrary: actions.activateLibrary,
    removeLibrary: actions.removeLibrary,
    rescan: actions.rescan,
    cancelScan: actions.cancelScan,
    dismissError: actions.dismissError,
    editTags: actions.editTags,
    editNotes: actions.editNotes,
    editingNotesAssetId: null,
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
    removeMissingEntry: actions.removeMissingEntry,
    deleteAssets: actions.deleteAssets,
    previewAsset: actions.previewAsset,
    theme: "workshop",
    savingTheme: false,
    setTheme: actions.setTheme,
    savingUsage: false,
    setUsageConsent: vi.fn<(_: "granted" | "declined") => Promise<import("./types").UsageConsentResult>>().mockResolvedValue({ status: "saved" }),
    trackUsage: vi.fn<(_: import("./usage").UsageEvent) => void>(),
    deleting: false,
    recoveryBusy: false,
    editingAssetId: null,
    isDesktop: true,
    previewTagRename: actions.previewTagRename,
    cancelTagRenamePreview: actions.cancelTagRenamePreview,
    applyTagRename: actions.applyTagRename,
    renamePreviewing: false,
    renameApplying: false,
    renameProgress: 0,
    ...overrides,
  });
}

function assetRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

function chooseFilter(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppVersion).mockResolvedValue("Version 0.2.0");
  vi.mocked(appUpdatesModule.checkForUpdates).mockResolvedValue({ status: "disabled", reason: "Disabled in test default" });
  vi.mocked(appUpdatesModule.installUpdate).mockResolvedValue();
  actions.setTheme.mockResolvedValue(true);
  actions.previewAsset.mockResolvedValue({ kind: "unsupported", content: null, mimeType: null, truncated: false, message: "No preview available." });
  setLibraryResult();
});

describe("scanned library UI", () => {
  it("shows the runtime app version in the persistent topbar", async () => {
    render(<App />);
    expect(await screen.findByText("Version 0.2.0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByText("Version 0.2.0")).toBeTruthy();
  });

  it("shows the development fallback in browser preview", async () => {
    vi.mocked(getAppVersion).mockResolvedValue(DEVELOPMENT_VERSION);
    setLibraryResult({ isDesktop: false });
    render(<App />);
    expect(await screen.findByText(DEVELOPMENT_VERSION)).toBeTruthy();
  });

  it("shows labeled theme picker in topbar, including with collapsed sidebar and no library", async () => {
    setLibraryResult({ state: { libraries: [], activeLibraryId: null }, library: null, assets: [] });
    render(<App />);
    const trigger = screen.getByRole<HTMLButtonElement>("button", { name: "Color theme" });
    expect(trigger.textContent).toContain("Workshop");
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Color theme choices" });
    const group = within(dialog).getByRole("group", { name: "Color themes" });
    expect(within(group).getAllByRole("button")).toHaveLength(20);
    expect(within(group).getByRole("button", { name: "Workshop, light" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(group).getByRole("button", { name: "Coral, light" }));
    expect(actions.setTheme).toHaveBeenCalledWith("coral");
    expect(trigger.textContent).toContain("Workshop");
    expect(screen.getByRole("dialog", { name: "Color theme choices" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Color theme" })).toBeTruthy();
  });

  it("disables theme persistence in browser preview and while theme save is pending", () => {
    setLibraryResult({ state: { libraries: [], activeLibraryId: null }, library: null, assets: [], isDesktop: false });
    const { rerender } = render(<App />);
    const browserTrigger = screen.getByRole<HTMLButtonElement>("button", { name: "Color theme" });
    expect(browserTrigger.getAttribute("aria-disabled")).toBe("true");
    expect(browserTrigger.disabled).toBe(false);
    expect(browserTrigger.title).toBe("Theme setting unavailable");
    browserTrigger.focus();
    expect(document.activeElement).toBe(browserTrigger);
    fireEvent.click(browserTrigger);
    expect(screen.queryByRole("dialog", { name: "Color theme choices" })).toBeNull();
    expect(actions.setTheme).not.toHaveBeenCalled();

    setLibraryResult({ savingTheme: true });
    rerender(<App />);
    const savingTrigger = screen.getByRole<HTMLButtonElement>("button", { name: "Color theme" });
    expect(savingTrigger.getAttribute("aria-disabled")).toBe("true");
    expect(savingTrigger.disabled).toBe(false);
    fireEvent.click(savingTrigger);
    expect(screen.queryByRole("dialog", { name: "Color theme choices" })).toBeNull();
    expect(actions.setTheme).not.toHaveBeenCalled();
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("Saving theme"))).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Rescan$/ }).disabled).toBe(true);
  });

  it("filters filename text entered with native smart quotes", () => {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: '“Gear"' } });
    expect(assetRows().map((row) => row.getAttribute("title"))).toEqual(["Gear.stl"]);
  });

  it("keeps smart-quoted text required in Any mode", () => {
    setLibraryResult({ assets: [{ ...assets[0], tags: ["category:gear"] }, assets[1]] });
    render(<App />);
    chooseFilter("Required tag match", "Any tag");
    fireEvent.change(screen.getByRole("textbox", { name: "Search assets and tags" }), { target: { value: 'category:gear “Missing Phrase"' } });
    expect(assetRows()).toEqual([]);
  });

  it("keeps folder, query, selection and applies committed theme tokens without unrelated actions", () => {
    const root: Asset = { id: "root", name: "Workshop", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged" };
    const folder: Asset = { ...assets[1], id: "folder", relativePath: "Models" };
    const nested = { ...assets[0], id: "gear", relativePath: "Models/Gear.stl", tags: ["favorite"] };
    setLibraryResult({ assets: [root, folder, nested] });
    const { rerender } = render(<App />);
    fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
    const search = screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" });
    fireEvent.change(search, { target: { value: '"Gear"' } });
    const row = assetRows()[0];
    fireEvent.click(row);
    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).toContain("Models");
    expect(search.value).toBe('"Gear"');
    expect(row.getAttribute("aria-selected")).toBe("true");

    const trigger = screen.getByRole<HTMLButtonElement>("button", { name: "Color theme" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Color theme choices" });
    const option = within(dialog).getByRole("button", { name: "Aurora, dark" });
    fireEvent.click(option);
    expect(actions.setTheme).toHaveBeenCalledWith("aurora");
    expect(option.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("Saving Aurora"))).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Rescan$/ }).disabled).toBe(false);

    setLibraryResult({ assets: [root, folder, nested], theme: "aurora", loading: false });
    rerender(<App />);

    expect(screen.getByRole("navigation", { name: "Folder path" }).textContent).toContain("Models");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe('"Gear"');
    expect(assetRows()[0].getAttribute("aria-selected")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("aurora");
    expect(document.documentElement.style.getPropertyValue("--floor")).toBe(themePalettes.aurora.floor);
    expect(document.documentElement.style.getPropertyValue("--paper")).toBe(themePalettes.aurora.paper);
    expect(document.documentElement.style.getPropertyValue("--theme-mode")).toBe("dark");
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByRole("dialog", { name: "Color theme choices" })).toBe(dialog);
    expect(actions.rescan).not.toHaveBeenCalled();
    expect(actions.editTags).not.toHaveBeenCalled();
    expect(actions.deleteAssets).not.toHaveBeenCalled();
    expect(actions.exportMetadata).not.toHaveBeenCalled();
  });

  it("preserves popover focus through committed parent rerender", () => {
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Color theme" }));
    const dialog = screen.getByRole("dialog", { name: "Color theme choices" });
    const aurora = within(dialog).getByRole("button", { name: "Aurora, dark" });
    aurora.focus();
    fireEvent.click(aurora);
    setLibraryResult({ theme: "aurora" });
    rerender(<App />);
    expect(screen.getByRole("dialog", { name: "Color theme choices" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Aurora, dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Color theme" }).textContent).toContain("Aurora");
    expect(document.activeElement).toBe(aurora);
  });

  it("prevents duplicate save while pending and makes same-current tile a no-op", async () => {
    let resolve: ((result: boolean) => void) | undefined;
    actions.setTheme.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Color theme" }));
    const dialog = screen.getByRole("dialog", { name: "Color theme choices" });
    const aurora = within(dialog).getByRole("button", { name: "Aurora, dark" });
    fireEvent.click(aurora);
    fireEvent.click(aurora);
    expect(actions.setTheme).toHaveBeenCalledTimes(1);
    expect(aurora.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Workshop, light" }));
    expect(actions.setTheme).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve?.(true);
      await Promise.resolve();
    });
    expect(screen.queryByText("Saving Aurora")).toBeNull();
  });

  it("uses global theme persistence error only and keeps committed selection", async () => {
    const failure = { message: "Theme setting could not be saved", path: null, details: null };
    actions.setTheme.mockResolvedValueOnce(false);
    setLibraryResult({ error: failure });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Color theme" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Color theme choices" })).getByRole("button", { name: "Aurora, dark" }));
    expect((await screen.findByRole("alert")).textContent).toContain(failure.message);
    expect(within(screen.getByRole("dialog", { name: "Color theme choices" })).getByRole("button", { name: "Workshop, light" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(failure.message, { selector: ".dialog-error" })).toBeNull();
  });

  it("keeps picker enabled with no library and dismisses choices", () => {
    setLibraryResult({ state: { libraries: [], activeLibraryId: null }, library: null, assets: [] });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Color theme" }));
    expect(screen.getByRole("dialog", { name: "Color theme choices" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close theme choices" }));
    expect(screen.queryByRole("dialog", { name: "Color theme choices" })).toBeNull();
    expect((screen.getByRole("button", { name: "Color theme" }) as HTMLButtonElement).disabled).toBe(false);
  });

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

  it("preserves catalog session state across committed theme change", () => {
    const catalog = syntheticAssets(500);
    setLibraryResult({ assets: catalog });
    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Untagged/ }));
    chooseFilter("Asset kind", "Files");
    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    fireEvent.click(screen.getByRole("button", { name: "Choose visible columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Path" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose visible columns" }));

    const scroll = screen.getByRole("table").parentElement!;
    fireEvent.scroll(scroll, { target: { scrollTop: 1200 } });
    expect(scroll.scrollTop).toBe(1200);
    expect(screen.getByRole("columnheader", { name: /^Name/ }).getAttribute("aria-sort")).toBe("descending");
    expect(screen.queryByRole("columnheader", { name: "Path" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Color theme" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Color theme choices" })).getByRole("button", { name: "Aurora, dark" }));
    expect(actions.setTheme).toHaveBeenCalledExactlyOnceWith("aurora");
    setLibraryResult({ assets: catalog, theme: "aurora" });
    rerender(<App />);

    expect(screen.getByRole("heading", { name: "Untagged" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Asset kind" }).textContent).toBe("Files");
    expect(screen.getByRole("columnheader", { name: /^Name/ }).getAttribute("aria-sort")).toBe("descending");
    expect(screen.queryByRole("columnheader", { name: "Path" })).toBeNull();
    expect(scroll.scrollTop).toBe(1200);
    expect(assetRows().length).toBeLessThan(80);
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
    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
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
    const picker = within(sidebar).getByRole("combobox", { name: "Active library" });
    expect(picker.textContent).toContain("Workshop");
    expect(within(picker).getByText(library.rootPath)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Color theme" })).toBeTruthy();
    expect(screen.getAllByText(library.rootPath)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Local app; no account needed" })).toBeNull();
    const summary = screen.getByLabelText("Library summary");
    expect(within(summary).getByText("items in this folder", { exact: false })).toBeTruthy();
    expect(within(summary).getByText("Last scan")).toBeTruthy();
    expect(within(summary).queryByText("Library")).toBeNull();
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

  it("unlocks library controls after Stop without describing an incomplete scan as empty", () => {
    setLibraryResult({ assets: [], scanStopped: true });
    render(<App />);
    expect(screen.getByText("Scan stopped")).toBeTruthy();
    expect(screen.queryByText(/This folder is empty/)).toBeNull();
    const picker = screen.getByRole<HTMLButtonElement>("combobox", { name: "Active library" });
    expect(picker.disabled).toBe(false);
    fireEvent.click(picker);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add library folder…" }).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Stop scanning" })).toBeNull();
  });

  it("retains active library context when sidebar is collapsed", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByText("Workshop", { selector: ".collapsed-library-context" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Color theme" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(within(screen.getByRole("complementary", { name: "Library navigation" })).getByRole("combobox", { name: "Active library" }).textContent).toContain("Workshop");
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

  it("opens the native folder chooser from the library dropdown instead of a duplicate header button", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Choose library folder" })).toBeNull();
    const picker = screen.getByRole("combobox", { name: "Active library" });
    fireEvent.click(picker);
    const add = within(screen.getByRole("complementary", { name: "Library navigation" })).getByRole("button", { name: "Add library folder…" });
    expect(screen.queryByRole("option", { name: "Add library folder…" })).toBeNull();
    fireEvent.click(add);
    expect(actions.chooseLibrary).toHaveBeenCalledExactlyOnceWith();
    expect(actions.activateLibrary).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox", { name: "Libraries" })).toBeNull();
    expect(picker.textContent).toContain("Workshop");
  });

  it("offers adding a folder without a duplicate header when registered libraries have no active selection", () => {
    setLibraryResult({ state: { libraries: [secondLibrary], activeLibraryId: null }, library: null, assets: [] });
    render(<App />);
    expect(screen.queryByRole("button", { name: "Choose library folder" })).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Active library" }));
    fireEvent.click(screen.getByRole("button", { name: "Add library folder…" }));
    expect(actions.chooseLibrary).toHaveBeenCalledExactlyOnceWith();
    expect(actions.activateLibrary).not.toHaveBeenCalled();
  });

  it("disables the library chooser while a native operation is busy", () => {
    const { rerender } = render(<App />);
    const picker = screen.getByRole<HTMLButtonElement>("combobox", { name: "Active library" });
    fireEvent.click(picker);
    expect(screen.getByRole("button", { name: "Add library folder…" })).toBeTruthy();
    setLibraryResult({ actionBusy: true });
    rerender(<App />);
    expect(picker.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Add library folder…" })).toBeNull();
    expect(actions.chooseLibrary).not.toHaveBeenCalled();
  });

  it("disables the dropdown chooser outside the desktop app", () => {
    setLibraryResult({ isDesktop: false });
    render(<App />);
    const picker = screen.getByRole<HTMLButtonElement>("combobox", { name: "Active library" });
    expect(picker.disabled).toBe(true);
    fireEvent.click(picker);
    expect(screen.queryByRole("button", { name: "Add library folder…" })).toBeNull();
    expect(actions.chooseLibrary).not.toHaveBeenCalled();
  });

  it("lists registered libraries and activates selected library", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("combobox", { name: "Active library" }));
    const libraries = screen.getByRole("listbox", { name: "Libraries" });
    expect(within(libraries).getByRole("option", { name: "Workshop /Users/test/Workshop" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(libraries).getByRole("option", { name: "Archive /Users/test/Archive" }));
    expect(actions.activateLibrary).toHaveBeenCalledWith(secondLibrary.id);
    expect(screen.queryByRole("listbox", { name: "Libraries" })).toBeNull();
    expect(screen.getAllByText(library.rootPath).length).toBeGreaterThan(0);
    expect(screen.getByText("2", { selector: ".summary-strip strong" })).toBeTruthy();
  });

  it("allows activating a remaining library when no library is active", () => {
    setLibraryResult({ state: { libraries: [secondLibrary], activeLibraryId: null }, library: null, assets: [] });
    render(<App />);
    const picker = screen.getByRole("combobox", { name: "Active library" });
    expect(picker.textContent).toContain("Choose a library");
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: "Archive /Users/test/Archive" }));
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

  it("confirms registration removal in-app and states that files remain untouched", () => {
    // tauri-plugin-dialog replaces window.confirm with an async function, so a synchronous caller always sees a truthy Promise.
    const confirm = vi.spyOn(window, "confirm").mockImplementation((() => Promise.resolve(false)) as unknown as typeof window.confirm);
    const own = (id: string, name: string): SavedSearch => ({ id, libraryId: library.id, name, filters: { query: "", view: "all", matchMode: "all", kind: "all" } });
    setLibraryResult({ savedSearches: [own("s1", "One"), own("s2", "Two"), { ...own("s3", "Other"), libraryId: "other-library" }] });
    render(<App />);
    const removeButton = screen.getByRole("button", { name: "Remove library registration" });
    const dialogName = `Remove “${library.name}” from this app?`;
    removeButton.focus(); // keyboard activation; focus returns here on cancel
    fireEvent.click(removeButton);
    const dialog = screen.getByRole("dialog", { name: dialogName });
    expect(within(dialog).getByText(/Files and folders will not be changed\. Its 2 saved searches will be deleted from this app\./)).toBeDefined();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(actions.removeLibrary).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();
    expect(document.activeElement).toBe(removeButton);
    fireEvent.click(removeButton);
    fireEvent.keyDown(screen.getByRole("dialog", { name: dialogName }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();
    expect(actions.removeLibrary).not.toHaveBeenCalled();
    fireEvent.click(removeButton);
    fireEvent.click(within(screen.getByRole("dialog", { name: dialogName })).getByRole("button", { name: "Remove library" }));
    expect(screen.queryByRole("dialog", { name: dialogName })).toBeNull();
    expect(actions.removeLibrary).toHaveBeenCalledOnce();
    expect(actions.removeLibrary).toHaveBeenCalledWith(library.id);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("states when a library being removed has no saved searches", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Remove library registration" }));
    expect(within(screen.getByRole("dialog", { name: `Remove “${library.name}” from this app?` })).getByText(/This library has no saved searches\./)).toBeDefined();
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

  it("keeps scan issues in one disclosure without a duplicate instructional banner", () => {
    setLibraryResult({ issues: [issue] });
    render(<App />);
    const summary = screen.getByText("Scan issues in this folder").closest("summary")!;
    const disclosure = summary.parentElement as HTMLDetailsElement;
    expect(summary.textContent).toContain("1 issue");
    expect(disclosure.open).toBe(false);
    expect(screen.queryByText(/issue.*need attention/)).toBeNull();
    expect(screen.queryByText(/Tags and notes are stored in per-directory/)).toBeNull();
    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText(issue.message)).toBeTruthy();
    expect(within(disclosure).getByText(issue.details)).toBeTruthy();
  });

  it("keeps error paths inside collapsed technical details", () => {
    const failure = { message: "Source exists again; rescan before removing it", path: "/Users/test/Workshop/Gear.stl", details: "Fresh source check rejected removal" };
    setLibraryResult({ error: failure, issues: [issue] });
    render(<App />);
    const alert = screen.getByRole("alert");
    expect(screen.getAllByText(failure.message)).toHaveLength(1);
    const path = within(alert).getByText(failure.path);
    const disclosure = path.closest("details")!;
    expect(disclosure).not.toBeNull();
    expect(disclosure.open).toBe(false);
    fireEvent.click(within(alert).getByText("Technical details"));
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText(failure.details)).toBeTruthy();
  });

  it("offers technical details when an error has only a path", () => {
    setLibraryResult({ error: { message: "Folder unavailable", path: "/Users/test/Workshop", details: null } });
    render(<App />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("/Users/test/Workshop").closest("details")).not.toBeNull();
    expect(within(alert).getByText("Technical details")).toBeTruthy();
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

  it("derives sidebar groups from tag prefixes while keeping exact filters", () => {
    const tagged: Asset = { ...assets[0], tags: ["oole:identity", "oole:identity:brand", "material:pla", "favorite", "other:custom"], status: "ready" };
    const different: Asset = { ...assets[1], tags: ["oole:identity:brand", "material:petg"], status: "ready" };
    setLibraryResult({ assets: [tagged, different] });
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "Library navigation" });
    // A plain tag that would only repeat its own name as a heading lists flat, ahead of the prefix groups.
    expect([...sidebar.querySelectorAll(".group-label")].map((label) => label.textContent)).toEqual(["material", "oole", "other"]);
    expect([...sidebar.querySelectorAll(".tag-group-plain .tag-nav")].map((button) => button.textContent)).toEqual(["favorite1"]);
    expect(within(sidebar).queryByText("Other")).toBeNull();
    expect(within(sidebar).getByRole("button", { name: "favorite1" })).toBeTruthy();
    expect(within(sidebar).getByRole("button", { name: "pla1" })).toBeTruthy();
    expect(within(sidebar).getByRole("button", { name: "petg1" })).toBeTruthy();
    expect(within(sidebar).getByRole("button", { name: "identity:brand2" })).toBeTruthy();
    expect(within(sidebar).getByRole("button", { name: "custom1" })).toBeTruthy();
    const filter = within(sidebar).getByRole("button", { name: "identity1" });
    expect(filter.title).toBe("Filter by oole:identity");
    fireEvent.click(filter);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe("oole:identity");
    expect(assetRows()).toHaveLength(1);
    expect(assetRows()[0].getAttribute("data-asset-id")).toBe(tagged.id);
  });
  it("adds a clicked tag to the search once, even when two clicks land before a render", () => {
    setLibraryResult({ assets: [{ ...assets[0], tags: ["favorite"], status: "ready" }] });
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "Library navigation" });
    const search = screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" });
    const favorite = within(sidebar).getByRole("button", { name: "favorite1" });
    act(() => { favorite.click(); favorite.click(); });
    expect(search.value).toBe("favorite");
    fireEvent.click(favorite);
    expect(search.value).toBe("favorite");
    fireEvent.change(search, { target: { value: "-favorite" } });
    fireEvent.click(favorite);
    expect(search.value).toBe("favorite");
  });
  it("updates prefix groups for the current folder and live tag changes", () => {
    const folder: Asset = { ...assets[1], tags: ["category:model"] };
    const nested: Asset = { ...assets[0], relativePath: "Models/Gear.stl", tags: ["material:pla"] };
    setLibraryResult({ assets: [folder, nested] });
    const { rerender } = render(<App />);
    const labels = () => [...screen.getByRole("complementary", { name: "Library navigation" }).querySelectorAll(".group-label")].map((label) => label.textContent);
    expect(labels()).toEqual(["category"]);
    fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
    expect(labels()).toEqual(["material"]);
    setLibraryResult({ assets: [folder, { ...nested, tags: ["author:someone"] }] });
    rerender(<App />);
    expect(labels()).toEqual(["author"]);
    setLibraryResult({ assets: [folder, { ...nested, tags: [] }] });
    rerender(<App />);
    expect(labels()).toEqual([]);
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
    const row = screen.getByRole("table").querySelector<HTMLTableRowElement>('tr[data-asset-id="asset-1"]')!;
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
    expect(screen.queryByText(/Tags and notes are stored in per-directory/)).toBeNull();
  });

  it("edits notes with explicit Save and Cancel; empty Save clears optional notes", async () => {
    const noted: Asset = { ...assets[0], notes: "Print slowly.", metadataId: "notes-uuid", metadataRevision: "revision-notes", metadataState: "valid" };
    setLibraryResult({ assets: [noted] });
    actions.editNotes.mockResolvedValue(true);
    render(<App />);
    fireEvent.click(assetRows()[0]);
    expect(screen.getByText("Print slowly.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    const editor = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
    expect(editor.value).toBe("Print slowly.");
    fireEvent.change(editor, { target: { value: "  Keep exact spaces.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel notes" }));
    expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save notes" })); });
    expect(actions.editNotes).toHaveBeenCalledWith(noted, "");
    expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull();
  });

  it("retains notes draft on save failure and cancels with Escape", async () => {
    const noted: Asset = { ...assets[0], notes: "Original", metadataId: "notes-uuid", metadataRevision: "revision-notes", metadataState: "valid" };
    setLibraryResult({ assets: [noted] });
    actions.editNotes.mockResolvedValue(false);
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "Draft" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save notes" })); });
    expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement).value).toBe("Draft");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull();
    expect(screen.getByText("Original")).toBeTruthy();
  });

  it("discards notes draft immediately when selection moves to another valid asset", async () => {
    const first: Asset = { ...assets[0], notes: "First", metadataId: "notes-uuid-1", metadataRevision: "revision-one", metadataState: "valid" };
    const second: Asset = { ...assets[0], id: "asset-2", name: "Second.stl", relativePath: "Second.stl", notes: "Second", metadataId: "notes-uuid-2", metadataRevision: "revision-two", metadataState: "valid" };
    setLibraryResult({ assets: [first, second] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "Draft" } });
    fireEvent.click(assetRows()[1]);
    expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit notes" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Second", { selector: ".notes-text" })).toBeTruthy());
  });

  it("does not restore a discarded notes draft after switching away and back", async () => {
    const first: Asset = { ...assets[0], notes: "First", metadataId: "notes-uuid-1", metadataRevision: "revision-one", metadataState: "valid" };
    const second: Asset = { ...assets[0], id: "asset-2", name: "Second.stl", relativePath: "Second.stl", notes: "Second", metadataId: "notes-uuid-2", metadataRevision: "revision-two", metadataState: "valid" };
    setLibraryResult({ assets: [first, second] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "Draft" } });
    fireEvent.click(assetRows()[1]);
    await waitFor(() => expect(screen.getByText("Second", { selector: ".notes-text" })).toBeTruthy());
    fireEvent.click(assetRows()[0]);
    await waitFor(() => expect(screen.getByText("First", { selector: ".notes-text" })).toBeTruthy());
    expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("enforces the byte limit on notes editor", () => {
    const noted: Asset = { ...assets[0], notes: "First", metadataId: "notes-uuid-1", metadataRevision: "revision-one", metadataState: "valid" };
    setLibraryResult({ assets: [noted] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
    const editor = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
    expect(editor.maxLength).toBe(64 * 1024);
    fireEvent.change(editor, { target: { value: "n".repeat(64 * 1024) } });
    expect((screen.getByRole("button", { name: "Save notes" }) as HTMLButtonElement).disabled).toBe(false);
    expect(editor.value.length).toBe(64 * 1024);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(editor, { target: { value: "é".repeat(32 * 1024 + 1) } });
    expect(editor.value.length).toBe(32 * 1024 + 1);
    expect(screen.getByRole("alert").textContent).toContain("UTF-8 limit");
    expect((screen.getByRole("button", { name: "Save notes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps notes read-only for missing and blocked metadata", () => {
    const missing = { ...assets[0], status: "missing", metadataState: "valid", notes: "Historical" } as Asset;
    const blocked = { ...assets[1], status: "warning", metadataState: "blocked", notes: "Blocked note" } as Asset;
    setLibraryResult({ assets: [missing, blocked] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    expect(screen.queryByRole("button", { name: "Edit notes" })).toBeNull();
    fireEvent.click(assetRows()[1]);
    expect(screen.queryByRole("button", { name: "Edit notes" })).toBeNull();
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
    chooseFilter("Required tag match", "Any tag");
    chooseFilter("Asset kind", "Folders");
    expect(assetRows()).toHaveLength(1);
    expect(within(assetRows()[0]).getByText("Models", { selector: ".folder-name" })).toBeTruthy();
    const storedSearch: import("./types").SavedSearch = { id: "saved-1", libraryId: secondLibrary.id, name: "Gear OR flexi folders", filters: { query: "category:gear style:flexi", view: "all", matchMode: "any", kind: "folder" } };
    setLibraryResult({ state: { ...libraryState, activeLibraryId: secondLibrary.id }, library: secondLibrary, assets: [], savedSearches: [storedSearch] });
    rerender(<App />);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe("");
    expect(screen.getByRole("combobox", { name: "Required tag match" }).textContent).toBe("All tags");
    expect(screen.getByRole("combobox", { name: "Asset kind" }).textContent).toBe("Files & folders");
    fireEvent.click(screen.getByRole("button", { name: /Gear OR flexi folders/ }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe(storedSearch.filters.query);
    expect(screen.getByRole("combobox", { name: "Required tag match" }).textContent).toBe("Any tag");
    expect(screen.getByRole("combobox", { name: "Asset kind" }).textContent).toBe("Folders");
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
    expect((screen.getByRole("combobox", { name: "Active library" }) as HTMLButtonElement).disabled).toBe(true);
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
    chooseFilter("Required tag match", "Any tag");
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
    fireEvent.contextMenu(screen.getByRole("table").querySelector('tr[data-asset-id="asset-2"]')!);
    const menu = screen.getByRole("menu", { name: "Actions for Models" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open" }));
    expect(actions.performAction).toHaveBeenCalledWith(assets[1], "open");
    expect(actions.performAction).toHaveBeenCalledOnce();
  });

  it("disables file actions for missing assets and starts explicit metadata recovery", async () => {
    const missing: Asset = { ...assets[0], name: "Old Fox.stl", relativePath: "Old Fox.stl", status: "missing", metadataState: "valid", metadataId: "metadata-uuid", metadataRevision: "missing-revision", tags: ["theme:fox"], notes: "Keep supports." };
    actions.getReconnectTargets.mockResolvedValueOnce([assets[0]]);
    actions.reconnectAsset.mockResolvedValueOnce(true);
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
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reconnect metadata" })).toBeNull());
    expect(screen.queryByText(/Could not reconnect/)).toBeNull();
  });

  it("deletes a confirmed row through the destructive dialog and not before", async () => {
    const confirm = actions.deleteAssets.mockResolvedValue(true);
    setLibraryResult({ assets: [{ ...assets[0], status: "ready", tags: ["favorite"] }] });
    render(<App />);
    fireEvent.contextMenu(assetRows()[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: /Delete Gear.stl/ });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review delete" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete item" }));
    expect(confirm).toHaveBeenCalledWith([expect.objectContaining({ id: "asset-1" })]);
  });

  it("labels inspector delete as single-item when multiple rows are selected", async () => {
    const targets: Asset[] = [{ ...assets[0], name: "First.stl", relativePath: "First.stl", status: "ready" }, { ...assets[0], id: "asset-2", name: "Second.stl", relativePath: "Second.stl", status: "ready" }];
    actions.deleteAssets.mockResolvedValue(true);
    setLibraryResult({ assets: targets });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(assetRows()[1], { metaKey: true });
    const inspector = screen.getByRole("complementary", { name: "Asset details" });
    const deleteItem = within(inspector).getByRole("button", { name: "Delete this item" });
    expect(deleteItem.getAttribute("title")).toBe("Move this item to Trash / Recycle Bin");
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeTruthy();
    fireEvent.click(deleteItem);
    const dialog = await screen.findByRole("dialog", { name: `Delete ${targets[1].name}` });
    expect(within(dialog).queryByText(targets[0].relativePath)).toBeNull();
    expect(actions.deleteAssets).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review delete" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete item" }));
    expect(actions.deleteAssets).toHaveBeenCalledExactlyOnceWith([targets[1]]);
  });

  it("offers bulk delete for the exact selection and keeps the folder row protected", () => {
    const root: Asset = { id: "path:.", name: "Workshop", relativePath: ".", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "ready", metadataRevision: "rev-root" };
    setLibraryResult({ assets: [root, { ...assets[0], status: "ready" }] });
    render(<App />);
    expect(assetRows()).toHaveLength(1);
    fireEvent.click(assetRows()[0]);
    expect(screen.queryByRole("button", { name: "Delete selected" })).toBeNull();
    expect(within(screen.getByRole("table")).queryByText("Workshop")).toBeNull();
    cleanup();
    setLibraryResult({ assets: [{ ...assets[0], status: "ready" }, { ...assets[1], status: "ready" }] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(assetRows()[1], { metaKey: true });
    const bulk = screen.getByRole("button", { name: "Delete selected" });
    expect((bulk as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(bulk);
    expect(screen.getByRole("dialog", { name: /Delete 2 items/ })).toBeTruthy();
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

  it("removes a missing entry only after explicit confirmation", async () => {
    const missing: Asset = { ...assets[0], name: "Old Fox.stl", relativePath: "Old Fox.stl", status: "missing", metadataState: "valid", metadataId: "metadata-uuid", metadataRevision: "missing-revision", tags: ["theme:fox"] };
    actions.removeMissingEntry.mockResolvedValue(true);
    setLibraryResult({ assets: [missing] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    expect(screen.queryByRole("button", { name: /Delete this item/ })).toBeNull();
    expect(screen.getByText(/remove the entry if the file was deleted on purpose/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Remove missing entry/ }));
    let dialog = await screen.findByRole("dialog", { name: "Remove entry for Old Fox.stl" });
    expect(within(dialog).getByText(/No asset files are changed/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Remove entry for Old Fox.stl" })).toBeNull();
    expect(actions.removeMissingEntry).not.toHaveBeenCalled();

    fireEvent.contextMenu(assetRows()[0]);
    fireEvent.click(within(screen.getByRole("menu", { name: "Actions for Old Fox.stl" })).getByRole("menuitem", { name: "Remove missing entry" }));
    dialog = await screen.findByRole("dialog", { name: "Remove entry for Old Fox.stl" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove entry" }));
    await waitFor(() => expect(actions.removeMissingEntry).toHaveBeenCalledWith(missing));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove entry for Old Fox.stl" })).toBeNull());
  });

  it.each(["Cancel", "Escape"])("returns focus to the missing row after context-menu removal %s", async (dismiss) => {
    const missing: Asset = { ...assets[0], status: "missing", metadataState: "valid", metadataId: "metadata-uuid" };
    setLibraryResult({ assets: [missing] });
    render(<App />);
    const row = assetRows()[0];
    row.focus();
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove missing entry" }));
    const dialog = await screen.findByRole("dialog");
    if (dismiss === "Cancel") fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    else fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("shows removal failure once inside the dialog and retains it after Cancel", async () => {
    const missing: Asset = { ...assets[0], status: "missing", metadataState: "valid", metadataId: "metadata-uuid" };
    const failure = { message: "Source exists again; rescan before removing it", path: "/Users/test/Workshop/Gear.stl", details: "File returned after the last scan" };
    actions.removeMissingEntry.mockResolvedValue(false);
    setLibraryResult({ assets: [missing] });
    const { rerender } = render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove missing entry" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove entry" }));
    await waitFor(() => expect(actions.removeMissingEntry).toHaveBeenCalledWith(missing));
    setLibraryResult({ assets: [missing], error: failure });
    rerender(<App />);
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain(failure.message));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByText(failure.message)).toHaveLength(1);
    expect(within(dialog).queryByText(/Review the library error/)).toBeNull();
    const details = within(dialog).getByText(failure.path).closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(within(dialog).getByText("Technical details"));
    expect(details.open).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(failure.message);
  });

  it("clears an earlier operation error before opening removal confirmation", () => {
    const missing: Asset = { ...assets[0], status: "missing", metadataState: "valid", metadataId: "metadata-uuid" };
    setLibraryResult({ assets: [missing], error: { message: "Earlier operation failed", path: null, details: null } });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove missing entry" }));
    expect(actions.dismissError).toHaveBeenCalledOnce();
  });

  it("keeps missing entry removal unavailable without valid metadata", () => {
    const blocked: Asset = { ...assets[0], status: "missing", metadataState: "blocked", metadataId: "metadata-uuid", metadataRevision: "missing-revision" };
    setLibraryResult({ assets: [blocked] });
    render(<App />);
    fireEvent.click(assetRows()[0]);
    expect((screen.getByRole("button", { name: /Remove missing entry/ }) as HTMLButtonElement).disabled).toBe(true);
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

  it("fits the complete missing-entry menu inside the viewport", () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { x: 0, y: 0, top: 0, left: 0, right: 224, bottom: this.classList.contains("asset-context-menu") ? 310 : 0, width: 224, height: this.classList.contains("asset-context-menu") ? 310 : 0, toJSON: () => ({}) };
    });
    try {
      const missing: Asset = { ...assets[0], status: "missing", metadataState: "valid", metadataId: "metadata-uuid" };
      setLibraryResult({ assets: [missing] });
      render(<App />);
      fireEvent.contextMenu(assetRows()[0], { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 });
      const menu = screen.getByRole("menu");
      expect(Number.parseFloat(menu.style.top) + 310).toBeLessThanOrEqual(window.innerHeight - 8);
      expect(Number.parseFloat(menu.style.left) + 224).toBeLessThanOrEqual(window.innerWidth - 8);
    } finally {
      measure.mockRestore();
    }
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
    expect(screen.queryByRole("columnheader", { name: "Path" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(screen.getByRole("columnheader", { name: /^Name/ }).getAttribute("aria-sort")).toBe("descending");
  });

  describe("in-app updates integration", () => {
    it("performs silent background update check on mount when on desktop, disabled on browser", async () => {
      const checkSpy = vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
        status: "available",
        version: "0.5.0",
        notes: "New release available",
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
      });
      expect(checkSpy).toHaveBeenCalled();

      cleanup();
      checkSpy.mockClear();

      setLibraryResult({ isDesktop: false });
      render(<App />);

      const button = screen.getByRole("button", { name: /check for updates/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(checkSpy).not.toHaveBeenCalled();
    });

    it("allows manual offer confirmation and invokes installUpdate", async () => {
      vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
        status: "available",
        version: "0.5.0",
        notes: "Release notes",
      });
      const installSpy = vi.spyOn(appUpdatesModule, "installUpdate").mockReturnValue(new Promise(() => {}));

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeDefined();

      const installBtn = within(dialog).getByRole("button", { name: /download and install/i });
      fireEvent.click(installBtn);

      expect(installSpy).toHaveBeenCalledWith("0.5.0", expect.any(Function));
    });

    it("blocks install when busy with scans, editing notes, or open dialogs", async () => {
      vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
        status: "available",
        version: "0.5.0",
        notes: "Release notes",
      });

      // 1. Scanning
      setLibraryResult({ scanning: true });
      const { rerender } = render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      let dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/scan in progress/i)).toBeDefined();
      let installBtn = within(dialog).getByRole("button", { name: /download and install/i });
      expect((installBtn as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(within(dialog).getByRole("button", { name: /later/i }));

      // 2. Editing notes
      setLibraryResult({ scanning: false, editingNotesAssetId: "asset-1" });
      rerender(<App />);

      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/notes edit in progress/i)).toBeDefined();
      installBtn = within(dialog).getByRole("button", { name: /download and install/i });
      expect((installBtn as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(within(dialog).getByRole("button", { name: /later/i }));

      // 3. Delete confirmation open
      setLibraryResult({ editingNotesAssetId: null });
      rerender(<App />);

      fireEvent.click(assetRows()[0]);
      fireEvent.click(screen.getByRole("button", { name: /delete this item/i }));
      expect(screen.getByRole("dialog", { name: /delete/i })).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      const dialogs = screen.getAllByRole("dialog");
      const updateDialog = dialogs.find((d) => within(d).queryByRole("button", { name: /download and install/i }));
      expect(updateDialog).toBeDefined();
      expect(within(updateDialog!).getByText(/delete confirmation open/i)).toBeDefined();
      installBtn = within(updateDialog!).getByRole("button", { name: /download and install/i });
      expect((installBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it("synchronously blocks install via getBlockedReason if an inline tag-add-input has unconfirmed text", async () => {
      vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
        status: "available",
        version: "0.5.0",
        notes: "Release notes",
      });
      const installSpy = vi.spyOn(appUpdatesModule, "installUpdate");

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
      });

      const tagInputs = screen.getAllByRole("combobox", { name: "Add tag" });
      fireEvent.change(tagInputs[0], { target: { value: "unconfirmed-tag-draft" } });

      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      const dialog = screen.getByRole("dialog");

      const installBtn = within(dialog).getByRole("button", { name: /download and install/i });
      expect((installBtn as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(installBtn);

      expect(installSpy).not.toHaveBeenCalled();
      expect(within(dialog).getByText(/unsaved tag input draft/i)).toBeDefined();
    });

    it("sets .app-shell inert during installation while update dialog portal remains interactive", async () => {
      vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
        status: "available",
        version: "0.5.0",
        notes: "Release notes",
      });

      let progressCb: ((p: any) => void) | undefined;
      vi.spyOn(appUpdatesModule, "installUpdate").mockImplementation((_v, cb) => {
        progressCb = cb;
        return new Promise(() => {});
      });

      const { container } = render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      const dialog = screen.getByRole("dialog");

      const installBtn = within(dialog).getByRole("button", { name: /download and install/i });
      fireEvent.click(installBtn);

      const appShell = container.querySelector(".app-shell");
      expect(appShell?.hasAttribute("inert")).toBe(true);

      expect(appShell?.contains(dialog)).toBe(false);
      expect(document.body.contains(dialog)).toBe(true);
      expect(dialog.closest("[inert]")).toBeNull();

      act(() => {
        progressCb?.({ phase: "downloading", downloaded: 1000, total: 2000 });
      });
      expect(within(dialog).getByText(/50%/)).toBeDefined();
    });

    it("removes inert on install failure with literal native string rejection without clearing selection, query, or drafts", async () => {
      vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
        status: "available",
        version: "0.5.0",
        notes: "Release notes",
      });

      const nativeError = "Update download or signature verification failed: invalid checksum";
      vi.spyOn(appUpdatesModule, "installUpdate").mockRejectedValue(nativeError);

      const { container } = render(<App />);

      const searchInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" });
      fireEvent.change(searchInput, { target: { value: '"Gear"' } });
      fireEvent.click(assetRows()[0]);
      expect(assetRows()[0].getAttribute("aria-selected")).toBe("true");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      const dialog = screen.getByRole("dialog");

      const installBtn = within(dialog).getByRole("button", { name: /download and install/i });
      fireEvent.click(installBtn);

      const appShell = container.querySelector(".app-shell");

      await waitFor(() => {
        expect(within(dialog).getByText(nativeError)).toBeDefined();
      });

      expect(appShell?.hasAttribute("inert")).toBe(false);
      expect(searchInput.value).toBe('"Gear"');
      expect(assetRows()[0].getAttribute("aria-selected")).toBe("true");
    });
  });
});

describe("tag rename menus", () => {
  const renameTags = ["status", "status:printed", "oole:identity", "favorite"];
  const taggedAsset: Asset = { ...assets[0], tags: renameTags, status: "ready" };
  let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

  function sidebar(): HTMLElement {
    return screen.getByRole("complementary", { name: "Library navigation" });
  }
  function tagButton(name: string): HTMLButtonElement {
    return within(sidebar()).getByRole<HTMLButtonElement>("button", { name });
  }
  function groupButton(group: string): HTMLButtonElement {
    return within(sidebar()).getByRole<HTMLButtonElement>("button", { name: `Actions for prefix group ${group}:` });
  }
  function renameRequest(): { mode: string | null; source: string | null } {
    const dialog = screen.queryByRole("dialog", { name: /^Rename (tag|prefix group)$/ });
    if (!dialog) return { mode: null, source: null };
    const current = within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Current name" }).value;
    return within(dialog).queryByRole("heading", { name: "Rename prefix group" })
      ? { mode: "prefix", source: current.replace(/:$/, "") }
      : { mode: "exact", source: current };
  }
  function menuItems(menu: HTMLElement): string[] {
    return within(menu).getAllByRole("menuitem").map((item) => item.textContent ?? "");
  }
  function mockRects(): void {
    rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const box = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) });
      if (this.classList.contains("tag-nav") || this.classList.contains("group-action")) return box(40, 180, 200, 26);
      if (this.classList.contains("asset-context-menu")) return box(0, 0, 224, 90);
      return box(0, 0, 0, 0);
    });
  }

  beforeEach(() => {
    setLibraryResult({ assets: [taggedAsset] });
  });
  afterEach(() => {
    rectSpy?.mockRestore();
    rectSpy = null;
  });

  it("opens a pointer menu with the exact action and the prefix action for a colon-bearing tag", () => {
    render(<App />);
    fireEvent.contextMenu(tagButton("identity1"), { clientX: 120, clientY: 220 });
    const menu = screen.getByRole("menu", { name: "Actions for tag oole:identity" });
    expect(menu.parentElement).toBe(document.body);
    expect(within(menu).getByText("Tag oole:identity")).toBeTruthy();
    expect(menuItems(menu)).toEqual(["Rename tag oole:identity", "Rename prefix group oole:"]);
    expect(menu.className).toContain("asset-context-menu");
  });

  it("offers only the exact action for a plain tag", () => {
    render(<App />);
    fireEvent.contextMenu(tagButton("favorite1"));
    expect(menuItems(screen.getByRole("menu", { name: "Actions for tag favorite" }))).toEqual(["Rename tag favorite"]);
    expect(within(sidebar()).queryByRole("button", { name: "Actions for prefix group favorite:" })).toBeNull();
  });

  it("keeps a plain tag exact-only when a colon-bearing tag shares its first segment", () => {
    render(<App />);
    fireEvent.contextMenu(tagButton("status1"));
    expect(menuItems(screen.getByRole("menu", { name: "Actions for tag status" }))).toEqual(["Rename tag status"]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(tagButton("printed1"));
    expect(menuItems(screen.getByRole("menu", { name: "Actions for tag status:printed" }))).toEqual(["Rename tag status:printed", "Rename prefix group status:"]);
  });

  it("offers the prefix action from the group action and never an exact action there", () => {
    render(<App />);
    fireEvent.contextMenu(groupButton("status"));
    const menu = screen.getByRole("menu", { name: "Actions for prefix group status:" });
    expect(within(menu).getByText("Prefix group status:")).toBeTruthy();
    expect(menuItems(menu)).toEqual(["Rename prefix group status:"]);
  });

  it("opens the group menu from a click on the group action", () => {
    render(<App />);
    fireEvent.click(groupButton("oole"));
    expect(menuItems(screen.getByRole("menu"))).toEqual(["Rename prefix group oole:"]);
  });

  it("labels the full normalized name and mode, not the displayed suffix or raw casing", () => {
    setLibraryResult({ assets: [{ ...assets[0], tags: [" Mixed:Case "], status: "ready" }] });
    render(<App />);
    fireEvent.contextMenu(tagButton("Case1"));
    const menu = screen.getByRole("menu", { name: "Actions for tag mixed:case" });
    expect(menuItems(menu)).toEqual(["Rename tag mixed:case", "Rename prefix group mixed:"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename tag mixed:case" }));
    expect(renameRequest()).toEqual({ mode: "exact", source: "mixed:case" });
  });

  it.each([
    ["ContextMenu", { key: "ContextMenu" }],
    ["Shift+F10", { key: "F10", shiftKey: true }],
  ])("opens the menu with %s, prevents the default, and anchors to the element rect", (_name, init) => {
    mockRects();
    render(<App />);
    const button = tagButton("identity1");
    button.focus();
    expect(fireEvent.keyDown(button, init)).toBe(false);
    const menu = screen.getByRole("menu", { name: "Actions for tag oole:identity" });
    expect(menu.style.left).toBe("40px");
    expect(menu.style.top).toBe("206px");
  });

  it("does not open a menu for F10 without Shift or for other keys", () => {
    render(<App />);
    const button = tagButton("identity1");
    expect(fireEvent.keyDown(button, { key: "F10" })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the group menu from the keyboard", () => {
    render(<App />);
    const button = groupButton("status");
    expect(fireEvent.keyDown(button, { key: "F10", shiftKey: true })).toBe(false);
    expect(menuItems(screen.getByRole("menu"))).toEqual(["Rename prefix group status:"]);
  });

  it("ignores the duplicate keyboard-origin contextmenu event", () => {
    mockRects();
    render(<App />);
    const button = tagButton("identity1");
    fireEvent.keyDown(button, { key: "ContextMenu" });
    const duplicate = fireEvent.contextMenu(button, { clientX: 700, clientY: 500 });
    expect(duplicate).toBe(false);
    const menus = screen.getAllByRole("menu");
    expect(menus).toHaveLength(1);
    expect(menus[0].style.left).toBe("40px");
    expect(menus[0].style.top).toBe("206px");
  });

  it("still opens a pointer menu after a keyboard-opened one once a real mouse press happens", () => {
    mockRects();
    render(<App />);
    const button = tagButton("identity1");
    fireEvent.keyDown(button, { key: "ContextMenu" });
    fireEvent.mouseDown(button);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(button, { clientX: 300, clientY: 400 });
    expect(screen.getByRole("menu").style.left).toBe("300px");
  });

  it("focuses the first menu item on open and moves between items with the arrow keys", () => {
    render(<App />);
    fireEvent.contextMenu(tagButton("identity1"));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[1]);
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["outside click", () => fireEvent.mouseDown(document.body)],
    ["wheel", () => fireEvent.wheel(window)],
    ["Tab", () => fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" })],
  ])("dismisses on %s and returns focus to the originating tag", (_name, dismiss) => {
    render(<App />);
    const button = tagButton("identity1");
    button.focus();
    fireEvent.contextMenu(button);
    expect(document.activeElement).not.toBe(button);
    dismiss();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(renameRequest()).toEqual({ mode: null, source: null });
  });

  it("returns focus to the group action after dismissing its menu", () => {
    render(<App />);
    const button = groupButton("oole");
    fireEvent.contextMenu(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(button);
  });

  it("keeps the tag menu inside the viewport", () => {
    rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const big = this.classList.contains("asset-context-menu");
      return { x: 0, y: 0, left: 0, top: 0, right: big ? 224 : 0, bottom: big ? 310 : 0, width: big ? 224 : 0, height: big ? 310 : 0, toJSON: () => ({}) };
    });
    render(<App />);
    fireEvent.contextMenu(tagButton("identity1"), { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 });
    const menu = screen.getByRole("menu");
    expect(Number.parseFloat(menu.style.top) + 310).toBeLessThanOrEqual(window.innerHeight - 8);
    expect(Number.parseFloat(menu.style.left) + 224).toBeLessThanOrEqual(window.innerWidth - 8);
  });

  it("focuses the originating tag before the menu closes and records the request", () => {
    render(<App />);
    const button = tagButton("identity1");
    const menuMountedWhenFocused: boolean[] = [];
    button.addEventListener("focus", () => menuMountedWhenFocused.push(document.querySelector(".asset-context-menu") !== null));
    fireEvent.contextMenu(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename prefix group oole:" }));
    expect(menuMountedWhenFocused).toEqual([true]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(renameRequest()).toEqual({ mode: "prefix", source: "oole" });
    // The dialog now takes focus, and returns it to the originating tag when it closes.
    expect(document.activeElement).toBe(within(screen.getByRole("dialog", { name: "Rename prefix group" })).getByRole("textbox", { name: /^New name for/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(button);
  });

  it("records an exact request from the exact action and a prefix request from the group action", () => {
    render(<App />);
    fireEvent.contextMenu(tagButton("printed1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename tag status:printed" }));
    expect(renameRequest()).toEqual({ mode: "exact", source: "status:printed" });
    // A second request is only possible once the first dialog is closed; see "second rename request while a dialog is open".
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(renameRequest()).toEqual({ mode: null, source: null });
    const group = groupButton("status");
    fireEvent.contextMenu(group);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename prefix group status:" }));
    expect(renameRequest()).toEqual({ mode: "prefix", source: "status" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(group);
  });

  it("falls back to the TAGS header when the source tag is gone at dismissal", () => {
    const { rerender } = render(<App />);
    fireEvent.contextMenu(tagButton("favorite1"));
    setLibraryResult({ assets: [{ ...taggedAsset, tags: ["status", "status:printed", "oole:identity"] }] });
    rerender(<App />);
    fireEvent.keyDown(document, { key: "Escape" });
    const header = within(sidebar()).getByText("Tags", { selector: ".nav-section-label" });
    expect(header.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(header);
  });

  it("restores focus to the tag after busy clears, not while its buttons are disabled", () => {
    const { rerender } = render(<App />);
    const button = tagButton("identity1");
    fireEvent.contextMenu(button);
    setLibraryResult({ assets: [taggedAsset], scanning: true });
    rerender(<App />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(button);
    setLibraryResult({ assets: [taggedAsset] });
    rerender(<App />);
    expect(document.activeElement).toBe(tagButton("identity1"));
  });

  it("does not open a menu or record a request while busy", () => {
    setLibraryResult({ assets: [taggedAsset], scanning: true });
    render(<App />);
    fireEvent.contextMenu(tagButton("identity1"));
    fireEvent.keyDown(groupButton("oole"), { key: "ContextMenu" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(renameRequest()).toEqual({ mode: null, source: null });
  });

  it("keeps a filter click as a filter and never starts a rename", () => {
    render(<App />);
    fireEvent.click(tagButton("identity1"));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" }).value).toBe("oole:identity");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(renameRequest()).toEqual({ mode: null, source: null });
  });

  it("does not nest buttons in the tag sidebar", () => {
    render(<App />);
    expect(sidebar().querySelectorAll("button button")).toHaveLength(0);
  });

  it("shows one menu at a time across row and tag menus", () => {
    render(<App />);
    fireEvent.contextMenu(assetRows()[0]);
    fireEvent.contextMenu(tagButton("identity1"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu", { name: "Actions for tag oole:identity" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(assetRows()[0]);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu", { name: "Actions for Gear.stl" })).toBeTruthy();
  });

  it("drops an open menu and a recorded request when the library changes", () => {
    const { rerender } = render(<App />);
    fireEvent.contextMenu(tagButton("favorite1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename tag favorite" }));
    expect(renameRequest().source).toBe("favorite");
    fireEvent.contextMenu(tagButton("identity1"));
    setLibraryResult({ assets: [taggedAsset], library: secondLibrary, state: { ...libraryState, activeLibraryId: secondLibrary.id } });
    rerender(<App />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(renameRequest()).toEqual({ mode: null, source: null });
  });
});

describe("tag rename integration", () => {
  const exact: RenameMapping = { mode: "exact", source: "status:printed", destination: "state:printed" };
  const prefix: RenameMapping = { mode: "prefix", source: "status", destination: "state" };

  function file(relativePath: string, tags: string[], metadataRevision = "rev-a"): Asset {
    return {
      id: relativePath, name: relativePath.split("/").pop() ?? relativePath, relativePath, kind: "file", extension: "stl",
      modifiedAt: "2026-10-01T10:00:00.000Z", sizeBytes: 1024, tags, status: tags.length ? "ready" : "untagged", metadataRevision,
    };
  }
  function folder(relativePath: string, tags: string[] = [], metadataRevision = "rev-a"): Asset {
    return { ...file(relativePath, tags, metadataRevision), kind: "folder", extension: null, modifiedAt: null, sizeBytes: null };
  }
  // Root shows Gear.stl and Models (printed x2); inside Models only Dragon.stl is printed, so the sidebar differs by folder.
  const catalog: Asset[] = [
    file("Gear.stl", ["status:printed", "favorite"]),
    folder("Models", ["status:printed"]),
    file("Models/Dragon.stl", ["status:printed"]),
    file("Models/Elf.stl", ["favorite"]),
    folder("Models/Deep"),
    file("Models/Deep/Knight.stl", ["status:printed"]),
  ];
  function renamedCatalog(): Asset[] {
    return catalog.map((asset) => ({ ...asset, metadataRevision: "rev-b", tags: asset.tags.map((tag) => tag === "status:printed" ? "state:printed" : tag) }));
  }
  function target(relativePath: string): RenameTargetSummary {
    return { assetId: relativePath, relativePath, kind: "file", sidecarOwner: ".", duplicatesCollapsed: 0 };
  }
  function skippedRow(relativePath: string): RenameSkippedRow {
    return { assetId: relativePath, relativePath, kind: "file", reason: "missing", message: null };
  }
  function previewFor(overrides: Partial<RenamePreview> = {}): RenamePreview {
    const mapping = overrides.mapping ?? exact;
    return {
      previewId: "preview-1", libraryId: library.id, scanId: "scan-1", mapping,
      scan: { libraryId: library.id, scanId: "scan-1", assets: catalog.map((asset) => ({ ...asset, metadataRevision: "rev-scan" })), issues: [], scannedAt: "2026-11-04T00:00:00Z" },
      targets: [target("Gear.stl"), target("Models/Dragon.stl"), target("Models/Deep/Knight.stl")],
      fileCount: 3, folderCount: 1, sidecarCount: 3, destinationExists: false, collisions: [], duplicatesCollapsed: 0,
      skipped: [], uninspectable: [], savedSearchUpdateCount: 0, settingsRetry: false,
      ...overrides,
    };
  }
  function resultFor(overrides: Partial<RenameApplyResult> = {}): RenameApplyResult {
    return {
      previewId: "preview-1", libraryId: library.id, mapping: exact, committed: renamedCatalog().filter((asset) => asset.tags.includes("state:printed")),
      failed: [], unattempted: [], failingSidecar: null, skipped: [], uninspectable: [], savedSearches: [], error: null, outcome: "complete", queryMigrated: true,
      ...overrides,
    };
  }
  function savedSearch(id: string, name: string, query: string, libraryId = library.id): SavedSearch {
    return { id, libraryId, name, filters: { query, view: "all", matchMode: "all", kind: "all" } };
  }
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  let lastMigration: RenameMigration | null = null;
  let searches: SavedSearch[] = [];

  /** Preview mock that derives the migration with the real canonical helper, as the hook does. */
  function wirePreview(preview: RenamePreview = previewFor()): void {
    actions.previewTagRename.mockImplementation(async (input) => {
      lastMigration = deriveRenameMigration({ libraryId: library.id, activeFilters: input.activeFilters, savedSearches: searches, mapping: preview.mapping });
      return { status: "ready", preview, migration: lastMigration };
    });
  }
  /** Apply mock that mirrors the hook's compare-and-set through the binding it is given. */
  function wireApply(result: RenameApplyResult, gate?: Promise<void>): void {
    actions.applyTagRename.mockImplementation(async (_previewId, binding) => {
      if (gate) await gate;
      const { before, after, changed } = lastMigration!.activeQuery;
      let queryUpdated = false;
      if (result.outcome === "complete" && result.queryMigrated && changed && binding.read() === before) { binding.write(after); queryUpdated = true; }
      return { status: "applied", result, queryUpdated };
    });
  }

  function sidebar(): HTMLElement {
    return screen.getByRole("complementary", { name: "Library navigation" });
  }
  function tagButton(name: string): HTMLButtonElement {
    return within(sidebar()).getByRole<HTMLButtonElement>("button", { name });
  }
  function renameDialog(): HTMLElement {
    return screen.getByRole("dialog", { name: /^Rename (tag|prefix group)$/ });
  }
  function searchBox(): HTMLInputElement {
    return screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" });
  }
  function notices(): HTMLElement | null {
    return screen.queryByRole("region", { name: "Unfinished tag renames" });
  }
  function typeNewName(value: string): void {
    fireEvent.change(within(renameDialog()).getByRole("textbox", { name: /^New name for/ }), { target: { value } });
  }
  async function pressIn(root: HTMLElement, name: string | RegExp): Promise<void> {
    await act(async () => { fireEvent.click(within(root).getByRole("button", { name })); });
  }
  async function press(name: string | RegExp): Promise<void> {
    await pressIn(renameDialog(), name);
  }
  function openRename(tag: string, item: string): void {
    fireEvent.contextMenu(tagButton(tag));
    fireEvent.click(screen.getByRole("menuitem", { name: item }));
  }
  async function toConfirm(destination = "state:printed"): Promise<void> {
    typeNewName(destination);
    await press("Preview");
    await press("Review rename");
  }
  async function runRename(destination = "state:printed"): Promise<void> {
    await toConfirm(destination);
    await press("Confirm rename");
  }
  async function closeWithEscape(): Promise<void> {
    await act(async () => { fireEvent.keyDown(renameDialog(), { key: "Escape" }); });
  }
  /** Opens the in-app update dialog; the available-update mock must be set before App renders. */
  async function openUpdateDialog(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole("button", { name: /update available/i }));
    const updateDialog = screen.getAllByRole("dialog").find((candidate) => within(candidate).queryByRole("button", { name: /download and install/i }));
    expect(updateDialog).toBeDefined();
    return updateDialog!;
  }
  function offerUpdate(): void {
    vi.mocked(appUpdatesModule.checkForUpdates).mockResolvedValue({ status: "available", version: "0.5.0", notes: "Release notes" });
  }
  function installButton(dialog: HTMLElement): HTMLButtonElement {
    return within(dialog).getByRole<HTMLButtonElement>("button", { name: /download and install/i });
  }
  function switchLibrary(rerender: (ui: React.ReactElement) => void): void {
    setLibraryResult({ assets: catalog, library: secondLibrary, state: { ...libraryState, activeLibraryId: secondLibrary.id } });
    rerender(<App />);
  }

  beforeEach(() => {
    actions.previewTagRename.mockReset();
    actions.applyTagRename.mockReset();
    actions.cancelTagRenamePreview.mockReset();
    actions.cancelTagRenamePreview.mockResolvedValue(false);
    lastMigration = null;
    searches = [];
    setLibraryResult({ assets: catalog });
    wirePreview();
    wireApply(resultFor());
  });

  describe("dialog mounting", () => {
    it("mounts the real dialog for the recorded request and no longer leaks the request into data attributes", () => {
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      const dialog = renameDialog();
      expect(within(dialog).getByRole("textbox", { name: "Current name" })).toHaveProperty("value", "status:printed");
      expect(document.querySelector(".app-shell")!.hasAttribute("data-rename-mode")).toBe(false);
      expect(document.querySelector(".app-shell")!.hasAttribute("data-rename-source")).toBe(false);
    });

    it("mounts a prefix dialog from the group action", () => {
      render(<App />);
      openRename("printed2", "Rename prefix group status:");
      expect(screen.getByRole("dialog", { name: "Rename prefix group" })).toBeTruthy();
      expect(within(renameDialog()).getByRole("textbox", { name: "Current name" })).toHaveProperty("value", "status:");
    });

    it("passes hook flags, scan progress and the live filters and library searches to the dialog", async () => {
      searches = [savedSearch("s1", "Printed models", "status:printed"), savedSearch("s9", "Elsewhere", "status:printed", secondLibrary.id)];
      setLibraryResult({ assets: catalog, savedSearches: searches.filter((search) => search.libraryId === library.id) });
      const { rerender } = render(<App />);
      fireEvent.change(searchBox(), { target: { value: "status:printed" } });
      openRename("printed2", "Rename tag status:printed");
      typeNewName("state:printed");
      await press("Preview");
      expect(actions.previewTagRename).toHaveBeenCalledExactlyOnceWith({
        mode: "exact", source: "status:printed", destination: "state:printed",
        activeFilters: { query: "status:printed", view: "all", matchMode: "all", kind: "all" },
      });
      expect(within(renameDialog()).getByText("Printed models")).toBeTruthy();
      expect(within(renameDialog()).queryByText("Elsewhere")).toBeNull();

      typeNewName("state:printed2");
      setLibraryResult({ assets: catalog, savedSearches: [], renamePreviewing: true, renameProgress: 42 });
      rerender(<App />);
      expect(renameDialog().textContent).toMatch(/42 items visited/);
    });

    it("keeps the dialog open and never mounts a second one for the same request across hook updates", () => {
      const { rerender } = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      typeNewName("state:printed");
      setLibraryResult({ assets: renamedCatalog() });
      rerender(<App />);
      expect(screen.getAllByRole("dialog", { name: "Rename tag" })).toHaveLength(1);
      expect(within(renameDialog()).getByRole<HTMLInputElement>("textbox", { name: /^New name for/ }).value).toBe("state:printed");
    });
  });

  describe("second rename request while a dialog is open", () => {
    function noTagMenu(): void {
      expect(screen.queryByRole("menu", { name: /^Actions for (tag|prefix group)/ })).toBeNull();
    }

    it("never opens a tag menu from the page behind the dialog, so the open dialog cannot receive new props", async () => {
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      typeNewName("state:printed");
      await press("Preview");
      expect(within(renameDialog()).getByRole("region", { name: "Rename preview" })).toBeTruthy();

      // Focus has left the dialog (Shift+Tab from body text is not trapped); the page behind it is still reachable.
      const other = tagButton("favorite1");
      other.focus();
      fireEvent.keyDown(other, { key: "F10", shiftKey: true });
      noTagMenu();
      fireEvent.keyDown(other, { key: "ContextMenu" });
      noTagMenu();
      fireEvent.contextMenu(other, { clientX: 40, clientY: 40 });
      noTagMenu();
      fireEvent.click(within(sidebar()).getByRole("button", { name: "Actions for prefix group status:" }));
      noTagMenu();

      expect(screen.getAllByRole("dialog", { name: /^Rename/ })).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Rename tag" })).toBeTruthy();
      expect(within(renameDialog()).getByRole("textbox", { name: "Current name" })).toHaveProperty("value", "status:printed");
      expect(within(renameDialog()).getByRole<HTMLInputElement>("textbox", { name: /^New name for/ }).value).toBe("state:printed");
      expect(within(renameDialog()).getByRole("region", { name: "Rename preview" })).toBeTruthy();
    });

    it("opens tag menus again once the dialog is closed", async () => {
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await closeWithEscape();
      fireEvent.contextMenu(tagButton("favorite1"), { clientX: 40, clientY: 40 });
      expect(screen.getByRole("menu", { name: "Actions for tag favorite" })).toBeTruthy();
    });
  });

  describe("whole-library counts (UA-6)", () => {
    it.each([["the library root", false, "printed2"], ["a subfolder where the sidebar is scoped to that folder", true, "printed1"]])("shows whole-library counts from %s", async (_where, intoModels, sidebarName) => {
      render(<App />);
      if (intoModels) fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
      openRename(sidebarName, "Rename tag status:printed");
      typeNewName("state:printed");
      await press("Preview");
      const review = within(renameDialog()).getByRole("region", { name: "Rename preview" });
      const count = (label: string) => within(review).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
      expect([count("Files"), count("Folders"), count("Sidecar files")]).toEqual(["3", "1", "3"]);
      expect(review.textContent).toMatch(/whole active library, including subfolders, not only the folder you are viewing/);
      // The sidebar stays scoped to the folder being viewed; only the dialog is whole-library.
      expect(within(sidebar()).getByRole("button", { name: sidebarName }).textContent).toContain(sidebarName.slice(-1));
    });
  });

  describe("session preservation", () => {
    it("keeps selection, folder, sort and column layout through preview and apply", async () => {
      const { rerender } = render(<App />);
      fireEvent.doubleClick(within(screen.getByRole("table")).getByText("Models", { selector: ".folder-name" }));
      fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
      fireEvent.click(screen.getByRole("button", { name: "Choose visible columns" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Path" }));
      fireEvent.click(screen.getByRole("button", { name: "Choose visible columns" }));
      fireEvent.mouseDown(screen.getByRole("separator", { name: "Resize Name column" }), { clientX: 100 });
      fireEvent.mouseMove(window, { clientX: 160 });
      fireEvent.mouseUp(window);
      const dragon = () => assetRows().find((row) => row.textContent?.includes("Dragon.stl"))!;
      fireEvent.click(dragon());
      const snapshot = () => ({
        folder: screen.getByRole("navigation", { name: "Folder path" }).textContent,
        sort: screen.getByRole("columnheader", { name: /^Name/ }).getAttribute("aria-sort"),
        path: screen.queryByRole("columnheader", { name: "Path" }),
        width: (screen.getByRole("columnheader", { name: /^Name/ }) as HTMLElement).style.width,
        selected: dragon().getAttribute("aria-selected"),
        order: assetRows().map((row) => row.getAttribute("title")),
      });
      const before = snapshot();
      expect(before).toMatchObject({ sort: "descending", path: null, width: "315px", selected: "true" });
      expect(before.folder).toContain("Models");

      openRename("printed1", "Rename tag status:printed");
      typeNewName("state:printed");
      await press("Preview");
      // The hook replaces the catalog behind the modal with the fresh scan.
      setLibraryResult({ assets: previewFor().scan.assets });
      rerender(<App />);
      expect(snapshot()).toEqual(before);

      await press("Review rename");
      await press("Confirm rename");
      setLibraryResult({ assets: renamedCatalog() });
      rerender(<App />);
      expect(snapshot()).toEqual(before);
      expect(within(renameDialog()).getByRole("heading", { name: "Rename complete" })).toBeTruthy();
    });
  });

  describe("active query", () => {
    const quoted = 'status:printed "Flexi status:printed Dragon"';

    it("migrates the active query on complete success and preserves quoted path text", async () => {
      render(<App />);
      fireEvent.change(searchBox(), { target: { value: quoted } });
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      expect(searchBox().value).toBe('state:printed "Flexi status:printed Dragon"');
      expect(within(renameDialog()).getByText("Active query updated.")).toBeTruthy();
    });

    it("hands the hook a binding that reads the live query at completion, so a mid-flight edit is never overwritten", async () => {
      const gate = deferred();
      wireApply(resultFor(), gate.promise);
      render(<App />);
      fireEvent.change(searchBox(), { target: { value: quoted } });
      openRename("printed2", "Rename tag status:printed");
      await toConfirm();
      await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name: "Confirm rename" })); });
      expect(actions.applyTagRename).toHaveBeenCalledOnce();
      expect(actions.applyTagRename.mock.calls[0]?.[0]).toBe("preview-1");
      fireEvent.change(searchBox(), { target: { value: "my own search" } });
      await act(async () => { gate.resolve(); });
      expect(searchBox().value).toBe("my own search");
      expect(within(renameDialog()).getByText(/edited while the rename ran, so it was left as you typed it/)).toBeTruthy();
    });

    it.each([
      ["partial", () => resultFor({ outcome: "partial", queryMigrated: false, committed: [renamedCatalog()[0]!], failed: [target("Models/Dragon.stl")], unattempted: [target("Models/Deep/Knight.stl")], failingSidecar: "Models", error: { message: "Disk full", path: null, details: null } })],
      ["settings-failed", () => resultFor({ outcome: "settings-failed", queryMigrated: false, error: { message: "Settings file is read-only", path: null, details: null } })],
    ])("leaves the active query alone after a %s outcome and shows the old-query limitation", async (_name, build) => {
      wireApply(build());
      render(<App />);
      fireEvent.change(searchBox(), { target: { value: quoted } });
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      expect(searchBox().value).toBe(quoted);
      expect(renameDialog().textContent).toMatch(/active query/i);
      expect(renameDialog().textContent).toMatch(/still use the old name|were not changed|not updated/);
    });
  });

  describe("skipped rows", () => {
    it("warns before confirming and after completing that skipped rows may keep the old tag", async () => {
      wirePreview(previewFor({ skipped: [skippedRow("Gone/Old.stl")] }));
      wireApply(resultFor({ skipped: [skippedRow("Gone/Old.stl")] }));
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await toConfirm();
      expect(within(renameDialog()).getByRole("region", { name: "Confirm rename" }).textContent).toMatch(/1 skipped row keeps its old tag/);
      await press("Confirm rename");
      expect(within(renameDialog()).getByText(/1 skipped row may still have the old tag/)).toBeTruthy();
    });
  });

  describe("persistent outcome notice (UA-2)", () => {
    const partial = () => resultFor({
      outcome: "partial", queryMigrated: false, committed: [renamedCatalog()[0]!], failed: [target("Models/Dragon.stl")], unattempted: [target("Models/Deep/Knight.stl")],
      failingSidecar: "Models", error: { message: "Disk full", path: null, details: null },
    });
    const settingsFailed = () => resultFor({ outcome: "settings-failed", queryMigrated: false, error: { message: "Settings file is read-only", path: null, details: null } });

    it("shows no notice for a complete outcome", async () => {
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      await closeWithEscape();
      expect(notices()).toBeNull();
    });

    it.each([
      ["partial", "Escape", partial, /1 of 3 rows were renamed/],
      ["settings-failed", "Escape", settingsFailed, /saved searches were not updated/i],
      ["partial", "backdrop", partial, /1 of 3 rows were renamed/],
      ["settings-failed", "backdrop", settingsFailed, /saved searches were not updated/i],
    ] as const)("keeps a %s notice with retry access after %s dismissal, near the active filter", async (_name, how, build, text) => {
      wireApply(build());
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      if (how === "Escape") await closeWithEscape();
      else fireEvent.mouseDown(renameDialog().parentElement!);
      expect(screen.queryByRole("dialog", { name: /^Rename/ })).toBeNull();
      const region = notices()!;
      expect(region).toBeTruthy();
      expect(region.textContent).toMatch(text);
      expect(region.textContent).toMatch(/status:printed to state:printed/);
      expect(region.textContent).toMatch(/still use the old name/);
      expect(within(region).getByRole("button", { name: /^Review outcome and retry/ })).toBeTruthy();
      const filterBar = document.querySelector(".filter-bar")!;
      expect(filterBar.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(region.closest(".catalog-panel")).toBeTruthy();
    });

    it("reopens on the outcome from the notice and finishes with a complete retry, which clears the notice", async () => {
      wireApply(partial());
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      await closeWithEscape();

      wirePreview(previewFor({ previewId: "preview-2", targets: [target("Models/Dragon.stl"), target("Models/Deep/Knight.stl")] }));
      wireApply(resultFor({ previewId: "preview-2" }));
      await pressIn(notices()!, /^Review outcome and retry/);
      expect(within(renameDialog()).getByRole("heading", { name: "Rename partly applied" })).toBeTruthy();
      await press("Preview remaining rows");
      expect(actions.previewTagRename).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "exact", source: "status:printed", destination: "state:printed" }));
      await press("Review rename");
      await press("Confirm rename");
      expect(within(renameDialog()).getByRole("heading", { name: "Rename complete" })).toBeTruthy();
      expect(notices()).toBeNull();
    });

    it("keeps one notice per rename so a later failure never hides an earlier one", async () => {
      wireApply(settingsFailed());
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      await closeWithEscape();
      wirePreview(previewFor({ mapping: prefix }));
      wireApply(resultFor({ mapping: prefix, outcome: "settings-failed", queryMigrated: false, error: { message: "Settings file is read-only", path: null, details: null } }));
      openRename("printed2", "Rename prefix group status:");
      await runRename("state");
      await closeWithEscape();
      expect(within(notices()!).getAllByRole("button", { name: /^Review outcome and retry/ })).toHaveLength(2);
      // Completing one leaves the other.
      wirePreview(previewFor({ previewId: "preview-3", targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 1 }));
      wireApply(resultFor({ previewId: "preview-3", committed: [] }));
      await pressIn(notices()!, /^Review outcome and retry: status:printed to state:printed/);
      await press("Preview settings retry");
      await press("Review rename");
      await press("Confirm rename");
      await closeWithEscape();
      expect(within(notices()!).getAllByRole("button", { name: /^Review outcome and retry/ })).toHaveLength(1);
      expect(notices()!.textContent).toMatch(/status: to state:/);
    });

    it("clears the notice, and closes any dialog, when the library changes", async () => {
      wireApply(settingsFailed());
      const { rerender } = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      await closeWithEscape();
      expect(notices()).toBeTruthy();
      switchLibrary(rerender);
      expect(notices()).toBeNull();
      expect(screen.queryByRole("dialog", { name: /^Rename/ })).toBeNull();
    });

    it("ignores an outcome reported for a library that is no longer active", async () => {
      const gate = deferred();
      wireApply(settingsFailed(), gate.promise);
      const { rerender } = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await toConfirm();
      await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name: "Confirm rename" })); });
      switchLibrary(rerender);
      await act(async () => { gate.resolve(); });
      expect(notices()).toBeNull();
    });

    it("keeps a notice when an unrelated rename later completes", async () => {
      wireApply(settingsFailed());
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      await closeWithEscape();
      wirePreview(previewFor({ previewId: "preview-9", mapping: { mode: "exact", source: "favorite", destination: "starred" } }));
      wireApply(resultFor({ previewId: "preview-9", mapping: { mode: "exact", source: "favorite", destination: "starred" } }));
      openRename("favorite1", "Rename tag favorite");
      await runRename("starred");
      await closeWithEscape();
      expect(notices()).toBeTruthy();
    });
  });

  describe("zero-target retry and nothing left to migrate (UA2-3)", () => {
    const settingsFailed = () => resultFor({
      outcome: "settings-failed", queryMigrated: false, error: { message: "Settings file is read-only", path: null, details: null },
      savedSearches: [savedSearch("s1", "Printed models", "status:printed")],
    });

    async function reachNotice(): Promise<void> {
      searches = [savedSearch("s1", "Printed models", "status:printed")];
      setLibraryResult({ assets: catalog, savedSearches: searches });
      wireApply(settingsFailed());
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      await closeWithEscape();
    }

    it("completes a settings-only retry with zero targets, migrates the saved search and clears the notice", async () => {
      render(<App />);
      await reachNotice();
      wirePreview(previewFor({ previewId: "preview-2", targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 1 }));
      wireApply(resultFor({ previewId: "preview-2", committed: [], savedSearches: [savedSearch("s1", "Printed models", "state:printed")] }));
      await pressIn(notices()!, /^Review outcome and retry/);
      await press("Preview settings retry");
      expect(within(renameDialog()).getByText(/finishes the saved-search and active-query update from a rename already saved/i)).toBeTruthy();
      await press("Review rename");
      await press("Confirm rename");
      expect(actions.applyTagRename).toHaveBeenLastCalledWith("preview-2", expect.anything());
      expect(within(renameDialog()).getByText(/Finished the saved-search update/)).toBeTruthy();
      expect(notices()).toBeNull();
    });

    it("lets the user dismiss the notice when no saved search is left to migrate", async () => {
      render(<App />);
      await reachNotice();
      wirePreview(previewFor({ previewId: "preview-2", targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 0 }));
      await pressIn(notices()!, /^Review outcome and retry/);
      await press("Preview settings retry");
      expect(within(renameDialog()).getByText(/nothing remains to migrate/i)).toBeTruthy();
      expect(within(renameDialog()).queryByRole("button", { name: "Review rename" })).toBeNull();
      await press("Dismiss notice");
      expect(notices()).toBeNull();
      expect(screen.queryByRole("dialog", { name: /^Rename/ })).toBeNull();
    });

    it("explains a rejected retry proof as 'saved searches changed; correct them manually' and lets the user dismiss it", async () => {
      const { rerender } = render(<App />);
      await reachNotice();
      wirePreview(previewFor({ previewId: "preview-2", targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 1 }));
      const gate = deferred();
      actions.applyTagRename.mockImplementation(async () => {
        await gate.promise;
        return { status: "failed" };
      });
      await pressIn(notices()!, /^Review outcome and retry/);
      await press("Preview settings retry");
      await press("Review rename");
      await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name: "Confirm rename" })); });
      // The hook records the native rejection before the call settles.
      setLibraryResult({ assets: catalog, savedSearches: searches, error: { message: "No editable rename targets and no verified settings retry; preview again", path: null, details: null } });
      rerender(<App />);
      await act(async () => { gate.resolve(); });
      expect(within(renameDialog()).getByRole("alert").textContent).toMatch(/saved searches changed; correct them manually/i);
      await press("Dismiss notice");
      expect(notices()).toBeNull();
      expect(screen.queryByRole("dialog", { name: /^Rename/ })).toBeNull();
    });
  });

  describe("updater blockers (UA-1, UA-9)", () => {
    it("allows installation when no rename state exists", async () => {
      offerUpdate();
      render(<App />);
      expect(installButton(await openUpdateDialog()).disabled).toBe(false);
    });

    it("blocks installation while the rename dialog is open, even before any preview", async () => {
      offerUpdate();
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      const updateDialog = await openUpdateDialog();
      expect(within(updateDialog).getByText(/tag rename dialog open/i)).toBeTruthy();
      expect(installButton(updateDialog).disabled).toBe(true);
      fireEvent.click(installButton(updateDialog));
      expect(vi.mocked(appUpdatesModule.installUpdate)).not.toHaveBeenCalled();
    });

    it("blocks installation once a preview is ready and while the apply is confirmed", async () => {
      offerUpdate();
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await toConfirm();
      const updateDialog = await openUpdateDialog();
      expect(within(updateDialog).getByText(/tag rename dialog open/i)).toBeTruthy();
      expect(installButton(updateDialog).disabled).toBe(true);
    });

    it.each([
      ["previewing", { renamePreviewing: true }],
      ["applying", { renameApplying: true }],
    ] as const)("blocks installation with the in-progress reason while the hook reports %s", async (_name, flags) => {
      offerUpdate();
      const { rerender } = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      setLibraryResult({ assets: catalog, ...flags });
      rerender(<App />);
      const updateDialog = await openUpdateDialog();
      expect(within(updateDialog).getByText(/tag rename in progress/i)).toBeTruthy();
      expect(installButton(updateDialog).disabled).toBe(true);
    });

    it("blocks installation while an unresolved retry notice remains after the dialog closed, and unblocks once it is resolved", async () => {
      offerUpdate();
      wireApply(resultFor({ outcome: "settings-failed", queryMigrated: false, error: { message: "Settings file is read-only", path: null, details: null } }));
      render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await runRename();
      await closeWithEscape();
      let updateDialog = await openUpdateDialog();
      expect(within(updateDialog).getByText(/tag rename not finished/i)).toBeTruthy();
      expect(installButton(updateDialog).disabled).toBe(true);
      fireEvent.click(within(updateDialog).getByRole("button", { name: /later/i }));

      wirePreview(previewFor({ previewId: "preview-2", targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 0 }));
      await pressIn(notices()!, /^Review outcome and retry/);
      await press("Preview settings retry");
      await press("Dismiss notice");
      updateDialog = await openUpdateDialog();
      expect(installButton(updateDialog).disabled).toBe(false);
    });

    it("keeps the fixed update checks ahead of the rename reasons", async () => {
      offerUpdate();
      setLibraryResult({ assets: catalog, scanning: true });
      render(<App />);
      const updateDialog = await openUpdateDialog();
      expect(within(updateDialog).getByText(/scan in progress/i)).toBeTruthy();
    });
  });

  describe("busy controls and the hook error", () => {
    it("disables the library picker and sidebar tag actions while a preview or apply runs", () => {
      const { rerender } = render(<App />);
      expect(tagButton("favorite1").disabled).toBe(false);
      for (const flags of [{ renamePreviewing: true }, { renameApplying: true }]) {
        setLibraryResult({ assets: catalog, ...flags });
        rerender(<App />);
        expect(tagButton("favorite1").disabled).toBe(true);
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /^Rescan$/ }).disabled).toBe(true);
      }
    });

    it("shows the hook error once, inside the dialog, and dismisses it when the dialog closes", async () => {
      const { rerender } = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      actions.dismissError.mockClear();
      setLibraryResult({ assets: catalog, error: { message: "Preview exploded", path: null, details: null } });
      rerender(<App />);
      expect(screen.queryByRole("button", { name: "Dismiss error" })).toBeNull();
      await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name: "Cancel" })); });
      expect(actions.dismissError).toHaveBeenCalledOnce();
    });

    it("clears an error that predates the dialog when it opens", () => {
      setLibraryResult({ assets: catalog, error: { message: "Older failure", path: null, details: null } });
      render(<App />);
      actions.dismissError.mockClear();
      openRename("printed2", "Rename tag status:printed");
      expect(actions.dismissError).toHaveBeenCalledOnce();
    });
  });

  describe("stale work and focus", () => {
    it("closes the dialog and cancels a running preview when the library changes", () => {
      const { rerender } = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      actions.cancelTagRenamePreview.mockClear();
      switchLibrary(rerender);
      expect(screen.queryByRole("dialog", { name: /^Rename/ })).toBeNull();
      expect(actions.cancelTagRenamePreview).toHaveBeenCalledOnce();
    });

    it("cancels a running preview natively and leaves the catalog, selection and notices untouched", async () => {
      const gate = deferred<import("./useLibrary").RenamePreviewResult>();
      actions.previewTagRename.mockImplementation(() => gate.promise);
      render(<App />);
      fireEvent.click(assetRows()[0]!);
      openRename("printed2", "Rename tag status:printed");
      typeNewName("state:printed");
      await press("Preview");
      await act(async () => { fireEvent.keyDown(renameDialog(), { key: "Escape" }); });
      expect(actions.cancelTagRenamePreview).toHaveBeenCalledOnce();
      await act(async () => { gate.resolve({ status: "cancelled" }); });
      expect(within(renameDialog()).getByText(/Preview cancelled\. Nothing was changed/)).toBeTruthy();
      expect(assetRows()[0]!.getAttribute("aria-selected")).toBe("true");
      expect(actions.applyTagRename).not.toHaveBeenCalled();
      await act(async () => { fireEvent.keyDown(renameDialog(), { key: "Escape" }); });
      expect(notices()).toBeNull();
    });

    it("ignores an apply result that arrives after the app unmounted", async () => {
      const gate = deferred();
      wireApply(resultFor({ outcome: "settings-failed", queryMigrated: false, error: { message: "Settings file is read-only", path: null, details: null } }), gate.promise);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const view = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      await toConfirm();
      await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name: "Confirm rename" })); });
      view.unmount();
      await act(async () => { gate.resolve(); });
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it("does not reopen the dialog for the new library", () => {
      const { rerender } = render(<App />);
      openRename("printed2", "Rename tag status:printed");
      switchLibrary(rerender);
      setLibraryResult({ assets: catalog });
      rerender(<App />);
      expect(screen.queryByRole("dialog", { name: /^Rename/ })).toBeNull();
    });

    it("returns focus to the originating tag when the dialog is cancelled", async () => {
      render(<App />);
      const origin = tagButton("favorite1");
      origin.focus();
      openRename("favorite1", "Rename tag favorite");
      expect(document.activeElement).toBe(within(renameDialog()).getByRole("textbox", { name: /^New name for/ }));
      await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name: "Cancel" })); });
      expect(document.activeElement).toBe(tagButton("favorite1"));
    });

    it("falls back to the TAGS header when the renamed tag has disappeared at close", async () => {
      const { rerender } = render(<App />);
      const favorite = { mode: "exact", source: "favorite", destination: "starred" } as const;
      wirePreview(previewFor({ mapping: favorite }));
      wireApply(resultFor({ mapping: favorite }));
      openRename("favorite1", "Rename tag favorite");
      await runRename("starred");
      setLibraryResult({ assets: catalog.map((asset) => ({ ...asset, tags: asset.tags.map((tag) => tag === "favorite" ? "starred" : tag) })) });
      rerender(<App />);
      await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name: "Close" })); });
      const header = within(sidebar()).getByText("Tags", { selector: ".nav-section-label" });
      expect(document.activeElement).toBe(header);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Usage analytics: consent dialog, topbar, events and install gate (T13)
// ---------------------------------------------------------------------------------------------------------------------
type UsageSummaryValue = import("./types").UsageSummary;
type ConsentResultValue = import("./types").UsageConsentResult;
const sharingUsage: UsageSummaryValue = { available: true, consent: "granted", saved: true };
const offUsage: UsageSummaryValue = { available: true, consent: "declined", saved: true };
const notSavedUsage: UsageSummaryValue = { available: true, consent: "declined", saved: false };
const undecidedUsage: UsageSummaryValue = { available: true, consent: "undecided", saved: true };

function usageMocks(result: ConsentResultValue = { status: "saved", usage: offUsage }) {
  return {
    setUsageConsent: vi.fn<(_: "granted" | "declined") => Promise<ConsentResultValue>>().mockResolvedValue(result),
    trackUsage: vi.fn<(_: import("./usage").UsageEvent) => void>(),
  };
}
type UsageMocks = ReturnType<typeof usageMocks>;
type UsageSetup = NonNullable<Parameters<typeof setLibraryResult>[0]> & { usage?: UsageSummaryValue; savingUsage?: boolean; mocks?: UsageMocks };
/** setLibraryResult plus the usage fields it doesn't know about. Call it again with the same mocks to change the hook state in place. */
function setUsage({ usage, savingUsage = false, mocks, ...rest }: UsageSetup = {}) {
  const base = rest.state ?? libraryState;
  setLibraryResult({ ...rest, state: usage ? { ...base, usage } : base });
  const current = vi.mocked(useLibrary)();
  vi.mocked(useLibrary).mockReturnValue({ ...current, savingUsage, ...(mocks ?? {}) });
}

const firstAskDialog = () => screen.getByRole("dialog", { name: "Share usage data?" });
const reviewDialog = () => screen.getByRole("dialog", { name: "Usage data" });
const anyUsageDialog = () => screen.queryByRole("dialog", { name: /^(Share usage data\?|Usage data)$/ });
const topbarUsageButton = () => screen.getByRole<HTMLButtonElement>("button", { name: /^Usage data: / });
const statusRegion = () => {
  const region = document.querySelector<HTMLElement>('.topbar-right > [aria-live="polite"]');
  if (!region) throw new Error("Usage status region is missing");
  return region;
};
const actionLabels = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>(".dialog-actions button")].map((button) => button.textContent);
const describedText = (dialog: HTMLElement) => (dialog.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); });
}
async function press(dialog: HTMLElement, name: string) {
  await click(within(dialog).getByRole("button", { name }));
}
/** Answers the first ask with a busy result, closes it and clears the call history, leaving the review dialog reachable. */
async function dismissFirstAsk(mocks: UsageMocks) {
  mocks.setUsageConsent.mockResolvedValueOnce({ status: "busy" });
  await press(firstAskDialog(), "No thanks");
  await press(firstAskDialog(), "Close");
  mocks.setUsageConsent.mockClear();
}

const narrowQuery = "(max-width: 1024px)";
function stubMatchMedia(narrow: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({ matches: narrow && query === narrowQuery, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })),
  });
}
const scrollIntoView = vi.fn();

describe("usage consent", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    scrollIntoView.mockClear();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  describe("when the first ask opens", () => {
    it("opens once when undecided on desktop and does not reopen after it is answered", async () => {
      const mocks = usageMocks();
      setUsage({ usage: undecidedUsage, mocks });
      const { rerender } = render(<App />);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(firstAskDialog()).toBeTruthy();
      rerender(<App />);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      await press(firstAskDialog(), "No thanks");
      expect(anyUsageDialog()).toBeNull();
      // The mocked state still reports undecided; the session already answered, so it stays closed.
      rerender(<App />);
      expect(anyUsageDialog()).toBeNull();
    });

    it("does not open when usage is unavailable", () => {
      setUsage({ usage: { available: false, consent: "undecided", saved: true }, mocks: usageMocks() });
      render(<App />);
      expect(anyUsageDialog()).toBeNull();
    });

    it.each([
      ["sharing", sharingUsage],
      ["not sharing and saved", offUsage],
      ["stopped and not saved", notSavedUsage],
    ])("does not open when the choice is already made (%s)", (_name, usage) => {
      setUsage({ usage, mocks: usageMocks() });
      render(<App />);
      expect(anyUsageDialog()).toBeNull();
    });

    it("does not reopen after the user dismissed it with Close", async () => {
      const mocks = usageMocks({ status: "busy" });
      setUsage({ usage: undecidedUsage, mocks });
      const { rerender } = render(<App />);
      await press(firstAskDialog(), "No thanks");
      await press(firstAskDialog(), "Close");
      expect(anyUsageDialog()).toBeNull();
      rerender(<App />);
      expect(anyUsageDialog()).toBeNull();
      expect(mocks.setUsageConsent).toHaveBeenCalledTimes(1);
    });

    it("waits while the update dialog is open and opens once it closes", async () => {
      vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({ status: "available", version: "0.5.0", notes: "Release notes" });
      const mocks = usageMocks();
      setUsage({ mocks });
      const { rerender } = render(<App />);
      await waitFor(() => expect(screen.getByRole("button", { name: /update available/i })).toBeDefined());
      fireEvent.click(screen.getByRole("button", { name: /update available/i }));
      const updateDialog = screen.getByRole("dialog");
      setUsage({ usage: undecidedUsage, mocks });
      rerender(<App />);
      expect(anyUsageDialog()).toBeNull();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      fireEvent.click(within(updateDialog).getByRole("button", { name: /later/i }));
      expect(firstAskDialog()).toBeTruthy();
    });

    it("does not open while the backend has sent no usage", () => {
      setUsage({ mocks: usageMocks() });
      render(<App />);
      expect(anyUsageDialog()).toBeNull();
      expect(screen.queryByRole("button", { name: /^Usage data: / })).toBeNull();
    });

    it("does not open in browser mode", () => {
      setUsage({ usage: undecidedUsage, isDesktop: false, mocks: usageMocks() });
      render(<App />);
      expect(anyUsageDialog()).toBeNull();
    });

    it("still opens when a scan error is showing at load", () => {
      setUsage({ usage: undecidedUsage, error: { message: "Scan failed", path: null, details: null }, mocks: usageMocks() });
      render(<App />);
      expect(firstAskDialog()).toBeTruthy();
    });
  });

  describe("buttons and focus", () => {
    it("gives both choice buttons identical classes and type", () => {
      setUsage({ usage: undecidedUsage, mocks: usageMocks() });
      render(<App />);
      const [no, share] = [...firstAskDialog().querySelectorAll<HTMLButtonElement>(".dialog-actions button")];
      expect(no?.textContent).toBe("No thanks");
      expect(share?.textContent).toBe("Share usage data");
      expect(no?.className).toBe(share?.className);
      expect(no?.className).toBe("secondary-button");
      expect(no?.type).toBe("button");
      expect(share?.type).toBe("button");
    });

    it("focuses the dialog container on open and cycles Tab through the container and both buttons", () => {
      setUsage({ usage: undecidedUsage, mocks: usageMocks() });
      render(<App />);
      const dialog = firstAskDialog();
      expect(document.activeElement).toBe(dialog);
      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Share usage data" }));
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "No thanks" }));
    });

    it("sends Tab from the container to the first button", () => {
      setUsage({ usage: undecidedUsage, mocks: usageMocks() });
      render(<App />);
      const dialog = firstAskDialog();
      fireEvent.keyDown(dialog, { key: "Tab" });
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "No thanks" }));
    });

    it("describes the first ask by its body only", () => {
      setUsage({ usage: undecidedUsage, mocks: usageMocks() });
      render(<App />);
      const dialog = firstAskDialog();
      const ids = (dialog.getAttribute("aria-describedby") ?? "").split(" ");
      expect(ids).toHaveLength(1);
      const text = describedText(dialog);
      expect(text).toContain("Nothing is sent unless you choose Share usage data.");
      expect(text).toContain("Never sent:");
      expect(text).toContain("Google Analytics");
      expect(text).toContain("at the top of the app");
    });

    it("describes the review dialog by the Currently line and the body", () => {
      setUsage({ usage: sharingUsage, mocks: usageMocks() });
      render(<App />);
      fireEvent.click(topbarUsageButton());
      const dialog = reviewDialog();
      const ids = (dialog.getAttribute("aria-describedby") ?? "").split(" ");
      expect(ids).toHaveLength(2);
      expect(document.getElementById(ids[0]!)?.textContent).toBe("Currently: sharing usage data");
      expect(document.getElementById(ids[1]!)?.textContent).toContain("Never sent:");
    });
  });

  describe("first ask", () => {
    it("saves declined on Escape", async () => {
      const mocks = usageMocks();
      setUsage({ usage: undecidedUsage, mocks });
      render(<App />);
      await act(async () => { fireEvent.keyDown(firstAskDialog(), { key: "Escape" }); });
      expect(mocks.setUsageConsent).toHaveBeenCalledExactlyOnceWith("declined");
    });

    it("ignores an outside mouse-down (prevented, no native call) but not a mouse-down on the body text", () => {
      const mocks = usageMocks();
      setUsage({ usage: undecidedUsage, mocks });
      render(<App />);
      const dialog = firstAskDialog();
      expect(fireEvent.mouseDown(dialog.parentElement!)).toBe(false);
      expect(mocks.setUsageConsent).not.toHaveBeenCalled();
      expect(firstAskDialog()).toBe(dialog);
      const bodyText = dialog.querySelector<HTMLElement>(".usage-consent-body p");
      expect(bodyText).toBeTruthy();
      expect(fireEvent.mouseDown(bodyText!)).toBe(true);
      expect(mocks.setUsageConsent).not.toHaveBeenCalled();
    });

    it.each<[UsageMessageId, ConsentResultValue]>([
      ["busyAsk", { status: "busy" }],
      ["failedAsk", { status: "failed" }],
    ])("keeps the dialog open with the first-ask text after a %s result and moves focus to Close", async (id, result) => {
      const mocks = usageMocks(result);
      setUsage({ usage: undecidedUsage, mocks });
      render(<App />);
      await press(firstAskDialog(), "Share usage data");
      const dialog = firstAskDialog();
      expect(mocks.setUsageConsent).toHaveBeenCalledExactlyOnceWith("granted");
      expect(within(dialog).getByRole("alert").textContent).toBe(usageMessageText(id));
      expect(describedText(dialog)).toContain("Nothing is sent unless you choose Share usage data.");
      expect(actionLabels(dialog)).toEqual(["No thanks", "Share usage data"]);
      const close = within(dialog).getByRole("button", { name: "Close" });
      expect(document.activeElement).toBe(close);
      // Close comes before the choice buttons, so those don't move.
      const noThanks = within(dialog).getByRole("button", { name: "No thanks" });
      expect(close.compareDocumentPosition(noThanks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(statusRegion().textContent).toBe("");
    });

    it("leaves the app usable after Close", async () => {
      const mocks = usageMocks({ status: "busy" });
      setUsage({ usage: undecidedUsage, mocks });
      render(<App />);
      await press(firstAskDialog(), "No thanks");
      await press(firstAskDialog(), "Close");
      expect(anyUsageDialog()).toBeNull();
      fireEvent.click(assetRows()[0]!);
      expect(assetRows()[0]!.getAttribute("aria-selected")).toBe("true");
      expect(topbarUsageButton().textContent).toBe("Usage data: Off");
      expect(statusRegion().textContent).toBe("");
    });
  });
});

function useUsageEnvironment(narrow = false) {
  beforeEach(() => {
    stubMatchMedia(narrow);
    scrollIntoView.mockClear();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
}
/** Renders with the given effective choice and opens the review dialog (after dismissing the first ask when undecided). */
async function openReview(usage: UsageSummaryValue, mocks: UsageMocks) {
  setUsage({ usage, mocks });
  const view = render(<App />);
  if (usage.consent === "undecided") await dismissFirstAsk(mocks);
  fireEvent.click(topbarUsageButton());
  return { ...view, dialog: reviewDialog() };
}

describe("usage consent review", () => {
  useUsageEnvironment();

  describe("review states", () => {
    it("sharing: Currently line, Turn off and Keep sharing", async () => {
      const { dialog } = await openReview(sharingUsage, usageMocks());
      expect(dialog.querySelector("h2")?.textContent).toBe("Usage data");
      expect(dialog.querySelector(".usage-consent-current")?.textContent).toBe("Currently: sharing usage data");
      expect(actionLabels(dialog)).toEqual(["Turn off", "Keep sharing"]);
    });

    it("not sharing and saved: Currently line, Turn on and Keep off", async () => {
      const { dialog } = await openReview(offUsage, usageMocks());
      expect(dialog.querySelector("h2")?.textContent).toBe("Usage data");
      expect(dialog.querySelector(".usage-consent-current")?.textContent).toBe("Currently: not sharing usage data");
      expect(actionLabels(dialog)).toEqual(["Turn on", "Keep off"]);
    });

    it("not sharing and not saved: names the unsaved choice, offers Save \"off\" and Turn on", async () => {
      const { dialog } = await openReview(notSavedUsage, usageMocks());
      expect(dialog.querySelector("h2")?.textContent).toBe("Usage data");
      expect(dialog.querySelector(".usage-consent-current")?.textContent).toBe("Currently: not sharing usage data. This choice isn't saved yet, so sharing will resume the next time the app opens.");
      expect(actionLabels(dialog)).toEqual(['Save "off"', "Turn on"]);
    });

    it("undecided after the first ask was closed: No thanks and Share usage data", async () => {
      const { dialog } = await openReview(undecidedUsage, usageMocks());
      expect(dialog.querySelector("h2")?.textContent).toBe("Usage data");
      expect(dialog.querySelector(".usage-consent-current")?.textContent).toBe("Currently: not sharing usage data. You haven't chosen yet.");
      expect(actionLabels(dialog)).toEqual(["No thanks", "Share usage data"]);
    });

    it.each([
      ["sharing", sharingUsage],
      ["not sharing and saved", offUsage],
      ["not sharing and not saved", notSavedUsage],
      ["undecided", undecidedUsage],
    ])("describes the recipient in the %s row without pointing at the topbar", async (_name, usage) => {
      const { dialog } = await openReview(usage, usageMocks());
      const text = describedText(dialog);
      expect(text).toContain("Google Analytics");
      expect(text).not.toContain("at the top of the app");
      expect(text).toContain("Currently:");
    });
  });

  describe("undecided review", () => {
    it.each<[string, ConsentResultValue]>([
      ["busy", { status: "busy" }],
      ["failed", { status: "failed" }],
    ])("keeps focus on the pressed button after a %s result and has exactly one close control", async (_name, result) => {
      const mocks = usageMocks();
      const { dialog } = await openReview(undecidedUsage, mocks);
      mocks.setUsageConsent.mockResolvedValue(result);
      const share = within(dialog).getByRole("button", { name: "Share usage data" });
      share.focus();
      await click(share);
      expect(mocks.setUsageConsent).toHaveBeenCalledExactlyOnceWith("granted");
      expect(within(dialog).getByRole("alert")).toBeTruthy();
      expect(document.activeElement).toBe(share);
      expect(within(dialog).getAllByRole("button", { name: /close/i })).toHaveLength(1);
      expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    });
  });

  describe("scrolling the pressed button into view", () => {
    it("calls scrollIntoView with block nearest on the pressed button when focus stays on it", async () => {
      const mocks = usageMocks({ status: "busy" });
      const { dialog } = await openReview(offUsage, mocks);
      const turnOn = within(dialog).getByRole("button", { name: "Turn on" });
      turnOn.focus();
      scrollIntoView.mockClear();
      await click(turnOn);
      expect(document.activeElement).toBe(turnOn);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrollIntoView.mock.contexts).toContain(turnOn);
    });

    it("also scrolls it into view when focus had moved away from the pressed button", async () => {
      const mocks = usageMocks({ status: "failed" });
      const { dialog } = await openReview(offUsage, mocks);
      const turnOn = within(dialog).getByRole("button", { name: "Turn on" });
      scrollIntoView.mockClear();
      await click(turnOn);
      expect(document.activeElement).toBe(turnOn);
      expect(scrollIntoView.mock.contexts).toContain(turnOn);
    });
  });

  describe("dismissing without a choice", () => {
    it.each([
      ["sharing", sharingUsage],
      ["not sharing and saved", offUsage],
      ["not sharing and not saved", notSavedUsage],
      ["undecided", undecidedUsage],
    ])("makes no native call for Escape, an outside click or the close button (%s)", async (_name, usage) => {
      const mocks = usageMocks();
      const view = await openReview(usage, mocks);
      await act(async () => { fireEvent.keyDown(view.dialog, { key: "Escape" }); });
      expect(anyUsageDialog()).toBeNull();

      fireEvent.click(topbarUsageButton());
      fireEvent.mouseDown(reviewDialog().parentElement!);
      expect(anyUsageDialog()).toBeNull();

      fireEvent.click(topbarUsageButton());
      await click(within(reviewDialog()).getByRole("button", { name: "Close usage data" }));
      expect(anyUsageDialog()).toBeNull();
      expect(mocks.setUsageConsent).not.toHaveBeenCalled();
      expect(statusRegion().textContent).toBe("");
    });

    it.each([
      ["Keep sharing", sharingUsage],
      ["Keep off", offUsage],
    ])("%s closes the dialog without a native call", async (name, usage) => {
      const mocks = usageMocks();
      const { dialog } = await openReview(usage, mocks);
      await press(dialog, name);
      expect(anyUsageDialog()).toBeNull();
      expect(mocks.setUsageConsent).not.toHaveBeenCalled();
      expect(statusRegion().textContent).toBe("");
    });
  });

  describe("stopped, not saved", () => {
    it("moves focus to Save \"off\", which saves declined when pressed again", async () => {
      const mocks = usageMocks();
      mocks.setUsageConsent.mockImplementationOnce(async () => {
        setUsage({ usage: notSavedUsage, mocks });
        return { status: "stoppedNotSaved", reason: "busy", usage: notSavedUsage };
      });
      const { dialog, rerender } = await openReview(sharingUsage, mocks);
      const turnOff = within(dialog).getByRole("button", { name: "Turn off" });
      turnOff.focus();
      await click(turnOff);
      rerender(<App />);
      expect(within(dialog).getByRole("alert").textContent).toBe(usageMessageText("stoppedBusy"));
      expect(actionLabels(dialog)).toEqual(['Save "off"', "Turn on"]);
      const saveOff = within(dialog).getByRole("button", { name: 'Save "off"' });
      expect(document.activeElement).toBe(saveOff);
      expect(within(dialog).queryByRole("button", { name: /try again/i })).toBeNull();
      expect(statusRegion().textContent).toBe("");

      mocks.setUsageConsent.mockResolvedValueOnce({ status: "saved", usage: offUsage });
      await click(document.activeElement as HTMLElement);
      expect(mocks.setUsageConsent.mock.calls).toEqual([["declined"], ["declined"]]);
      expect(anyUsageDialog()).toBeNull();
      expect(statusRegion().textContent).toBe("Usage data turned off.");
    });

    it("sends Turn on to native as granted", async () => {
      const mocks = usageMocks({ status: "saved", usage: sharingUsage });
      const { dialog } = await openReview(notSavedUsage, mocks);
      await press(dialog, "Turn on");
      expect(mocks.setUsageConsent).toHaveBeenCalledExactlyOnceWith("granted");
      expect(statusRegion().textContent).toBe("Usage data turned on.");
    });

    it.each<[UsageMessageId, "busy" | "failed"]>([
      ["stoppedBusy", "busy"],
      ["stoppedFailed", "failed"],
    ])("a repeated stopped-not-saved (%s) keeps Save \"off\" focused and never offers Try again", async (id, reason) => {
      const mocks = usageMocks({ status: "stoppedNotSaved", reason, usage: notSavedUsage });
      const { dialog } = await openReview(notSavedUsage, mocks);
      const saveOff = within(dialog).getByRole("button", { name: 'Save "off"' });
      saveOff.focus();
      await click(saveOff);
      expect(within(dialog).getByRole("alert").textContent).toBe(usageMessageText(id));
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: 'Save "off"' }));
      expect(within(dialog).queryByRole("button", { name: /try again/i })).toBeNull();
    });
  });

  describe.each<["first" | "review"]>([["first"], ["review"]])("while saving (%s)", (mode) => {
    async function startSave() {
      const pending = deferredResult<ConsentResultValue>();
      const mocks = usageMocks();
      mocks.setUsageConsent.mockImplementation(() => pending.promise);
      let dialog: HTMLElement;
      let rerender: ReturnType<typeof render>["rerender"];
      let pressed: HTMLElement;
      if (mode === "first") {
        setUsage({ usage: undecidedUsage, mocks });
        ({ rerender } = render(<App />));
        dialog = firstAskDialog();
        pressed = within(dialog).getByRole("button", { name: "No thanks" });
      } else {
        ({ dialog, rerender } = await openReview(sharingUsage, mocks));
        pressed = within(dialog).getByRole("button", { name: "Turn off" });
      }
      pressed.focus();
      await click(pressed);
      // The hook reports the pending save the way the real one does.
      setUsage({ usage: mode === "first" ? undecidedUsage : sharingUsage, savingUsage: true, mocks });
      rerender(<App />);
      return { dialog, pressed, mocks, pending, rerender };
    }

    it("marks both choice buttons aria-disabled, shows Saving and keeps focus on the pressed button", async () => {
      const { dialog, pressed } = await startSave();
      const buttons = [...dialog.querySelectorAll<HTMLElement>(".dialog-actions button")];
      expect(buttons).toHaveLength(2);
      for (const button of buttons) expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(within(dialog).getByText("Saving…")).toBeTruthy();
      expect(document.activeElement).toBe(pressed);
    });

    it("ignores clicks on either choice button: no second native call", async () => {
      const { dialog, mocks } = await startSave();
      for (const button of dialog.querySelectorAll<HTMLElement>(".dialog-actions button")) await click(button);
      expect(mocks.setUsageConsent).toHaveBeenCalledTimes(1);
      expect(anyUsageDialog()).toBe(dialog);
    });

    it("ignores Escape and an outside click", async () => {
      const { dialog, mocks } = await startSave();
      await act(async () => { fireEvent.keyDown(dialog, { key: "Escape" }); });
      expect(fireEvent.mouseDown(dialog.parentElement!)).toBe(false);
      expect(mocks.setUsageConsent).toHaveBeenCalledTimes(1);
      expect(anyUsageDialog()).toBe(dialog);
    });

    it("ignores the close button while saving (review only)", async () => {
      const { dialog } = await startSave();
      const close = dialog.querySelector<HTMLElement>('button[aria-label="Close usage data"]');
      if (mode === "first") { expect(close).toBeNull(); return; }
      expect(close?.getAttribute("aria-disabled")).toBe("true");
      await click(close!);
      expect(anyUsageDialog()).toBe(dialog);
    });
  });
});
function deferredResult<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

interface MessageCase {
  name: string;
  mode: "first" | "review";
  usage: UsageSummaryValue;
  press: string;
  result: ConsentResultValue;
  alert: UsageMessageId | null;
  status: string;
}
const messageRows: MessageCase[] = [
  { name: "saved turn off from sharing", mode: "review", usage: sharingUsage, press: "Turn off", result: { status: "saved", usage: offUsage }, alert: null, status: "Usage data turned off." },
  { name: "saved turn on from not sharing", mode: "review", usage: offUsage, press: "Turn on", result: { status: "saved", usage: sharingUsage }, alert: null, status: "Usage data turned on." },
  { name: "saved Save \"off\" from not saved", mode: "review", usage: notSavedUsage, press: "Save \"off\"", result: { status: "saved", usage: offUsage }, alert: null, status: "Usage data turned off." },
  { name: "saved Turn on from not saved", mode: "review", usage: notSavedUsage, press: "Turn on", result: { status: "saved", usage: sharingUsage }, alert: null, status: "Usage data turned on." },
  { name: "saved share from the first ask", mode: "first", usage: undecidedUsage, press: "Share usage data", result: { status: "saved", usage: sharingUsage }, alert: null, status: "Usage data is on." },
  { name: "saved No thanks from the first ask", mode: "first", usage: undecidedUsage, press: "No thanks", result: { status: "saved", usage: offUsage }, alert: null, status: "Usage data is off." },
  { name: "saved share from an undecided review", mode: "review", usage: undecidedUsage, press: "Share usage data", result: { status: "saved", usage: sharingUsage }, alert: null, status: "Usage data is on." },
  { name: "saved No thanks from an undecided review", mode: "review", usage: undecidedUsage, press: "No thanks", result: { status: "saved", usage: offUsage }, alert: null, status: "Usage data is off." },
  { name: "busy in the first ask", mode: "first", usage: undecidedUsage, press: "Share usage data", result: { status: "busy" }, alert: "busyAsk", status: "" },
  { name: "busy in an undecided review", mode: "review", usage: undecidedUsage, press: "Share usage data", result: { status: "busy" }, alert: "busyAsk", status: "" },
  { name: "busy turning on from not sharing", mode: "review", usage: offUsage, press: "Turn on", result: { status: "busy" }, alert: "busyTurnOn", status: "" },
  { name: "failed in the first ask", mode: "first", usage: undecidedUsage, press: "No thanks", result: { status: "failed" }, alert: "failedAsk", status: "" },
  { name: "failed in an undecided review", mode: "review", usage: undecidedUsage, press: "No thanks", result: { status: "failed" }, alert: "failedAsk", status: "" },
  { name: "failed turning on from not sharing", mode: "review", usage: offUsage, press: "Turn on", result: { status: "failed" }, alert: "failedTurnOn", status: "" },
  { name: "stopped, not saved, because busy", mode: "review", usage: sharingUsage, press: "Turn off", result: { status: "stoppedNotSaved", reason: "busy", usage: notSavedUsage }, alert: "stoppedBusy", status: "" },
  { name: "stopped, not saved, because the write failed", mode: "review", usage: sharingUsage, press: "Turn off", result: { status: "stoppedNotSaved", reason: "failed", usage: notSavedUsage }, alert: "stoppedFailed", status: "" },
  { name: "native side unreachable while turning off", mode: "review", usage: sharingUsage, press: "Turn off", result: { status: "failed" }, alert: "unreachableTurnOff", status: "" },
];
async function openForCase(row: Pick<MessageCase, "mode" | "usage">, mocks: UsageMocks) {
  if (row.mode === "review") return openReview(row.usage, mocks);
  setUsage({ usage: row.usage, mocks });
  const view = render(<App />);
  return { ...view, dialog: firstAskDialog() };
}

describe("usage consent messages", () => {
  useUsageEnvironment();

  it.each(messageRows)("$name", async (row) => {
    const mocks = usageMocks();
    const { dialog } = await openForCase(row, mocks);
    mocks.setUsageConsent.mockResolvedValue(row.result);
    await press(dialog, row.press);
    expect(mocks.setUsageConsent).toHaveBeenCalledTimes(1);
    if (row.alert === null) {
      // A saved result closes the dialog; the polite region carries the one sentence.
      expect(anyUsageDialog()).toBeNull();
    } else {
      expect(anyUsageDialog()).toBe(dialog);
      expect(within(dialog).getByRole("alert").textContent).toBe(usageMessageText(row.alert));
    }
    expect(statusRegion().textContent).toBe(row.status);
  });

  it("puts nothing in the polite region for busy, failed and not-saved rows (only saved rows announce)", async () => {
    for (const row of messageRows.filter((candidate) => candidate.alert !== null)) {
      const mocks = usageMocks();
      const { dialog, unmount } = await openForCase(row, mocks);
      mocks.setUsageConsent.mockResolvedValue(row.result);
      await press(dialog, row.press);
      expect(statusRegion().textContent, row.name).toBe("");
      unmount();
    }
  });

  it("clears the message when a save starts", async () => {
    const mocks = usageMocks({ status: "busy" });
    const { dialog } = await openReview(offUsage, mocks);
    await press(dialog, "Turn on");
    expect(within(dialog).getByRole("alert").textContent).toBe(usageMessageText("busyTurnOn"));
    const pending = deferredResult<ConsentResultValue>();
    mocks.setUsageConsent.mockImplementation(() => pending.promise);
    await press(dialog, "Turn on");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await act(async () => { pending.resolve({ status: "failed" }); });
    expect(within(dialog).getByRole("alert").textContent).toBe(usageMessageText("failedTurnOn"));
  });

  it("clears the message when the dialog reopens", async () => {
    const mocks = usageMocks({ status: "busy" });
    const { dialog } = await openReview(offUsage, mocks);
    await press(dialog, "Turn on");
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(dialog, { key: "Escape" }); });
    expect(anyUsageDialog()).toBeNull();
    fireEvent.click(topbarUsageButton());
    expect(within(reviewDialog()).queryByRole("alert")).toBeNull();
  });

  it("re-mounts the alert for a second identical failure", async () => {
    const mocks = usageMocks({ status: "failed" });
    const { dialog } = await openReview(offUsage, mocks);
    await press(dialog, "Turn on");
    const first = within(dialog).getByRole("alert");
    await press(dialog, "Turn on");
    const second = within(dialog).getByRole("alert");
    expect(second.textContent).toBe(first.textContent);
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(mocks.setUsageConsent).toHaveBeenCalledTimes(2);
  });

  it("clears the status region when the dialog is opened after \"Usage data turned on.\"", async () => {
    const mocks = usageMocks({ status: "saved", usage: sharingUsage });
    const { dialog } = await openReview(offUsage, mocks);
    await press(dialog, "Turn on");
    expect(statusRegion().textContent).toBe("Usage data turned on.");
    fireEvent.click(topbarUsageButton());
    expect(statusRegion().textContent).toBe("");
    expect(reviewDialog()).toBeTruthy();
  });

  it("keeps the status region outside the topbar info text that is hidden at narrow widths", () => {
    setUsage({ usage: sharingUsage, mocks: usageMocks() });
    render(<App />);
    expect(statusRegion().closest(".topbar-info")).toBeNull();
    expect(statusRegion().getAttribute("role")).toBeNull();
    expect(statusRegion().getAttribute("aria-atomic")).toBe("true");
  });
});

describe("usage topbar", () => {
  useUsageEnvironment();

  it.each([
    ["sharing", sharingUsage, "Usage data: On"],
    ["not sharing and saved", offUsage, "Usage data: Off"],
    ["not sharing and not saved", notSavedUsage, "Usage data: Off (not saved)"],
    ["undecided", undecidedUsage, "Usage data: Off"],
  ])("reads from the effective choice and saved flag (%s)", (_name, usage, label) => {
    setUsage({ usage, mocks: usageMocks() });
    render(<App />);
    const button = topbarUsageButton();
    expect(button.textContent).toBe(label);
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.className).toContain("quiet-button");
  });

  it("is absent when usage is unavailable", () => {
    setUsage({ usage: { available: false, consent: "declined", saved: true }, mocks: usageMocks() });
    render(<App />);
    expect(screen.queryByRole("button", { name: /^Usage data: / })).toBeNull();
  });

  it("stays enabled during a pending scan and other operations", () => {
    setUsage({ usage: offUsage, scanning: true, actionBusy: true, mocks: usageMocks() });
    render(<App />);
    const button = topbarUsageButton();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(reviewDialog()).toBeTruthy();
  });

  it("shows the sharing status text and hides the offline dot only when available and granted", () => {
    setUsage({ usage: sharingUsage, mocks: usageMocks() });
    const { container, rerender } = render(<App />);
    const info = () => container.querySelector(".topbar-info");
    expect(info()?.textContent).toBe("Local files · sharing usage data");
    expect(info()?.querySelector(".offline-dot")).toBeNull();

    for (const usage of [offUsage, undecidedUsage, notSavedUsage]) {
      setUsage({ usage, mocks: usageMocks() });
      rerender(<App />);
      expect(info()?.textContent).toContain("Local files · explicit actions only");
      expect(info()?.querySelector(".offline-dot")).toBeTruthy();
      expect(container.textContent).not.toContain("sharing usage data");
    }
  });

  it("does not show the sharing text when granted but unavailable", () => {
    setUsage({ usage: { available: false, consent: "granted", saved: true }, mocks: usageMocks() });
    const { container } = render(<App />);
    const info = container.querySelector(".topbar-info");
    expect(info?.textContent).toContain("Local files · explicit actions only");
    expect(info?.querySelector(".offline-dot")).toBeTruthy();
    expect(container.textContent).not.toContain("sharing usage data");
  });
});

describe("usage events from the app", () => {
  useUsageEnvironment();
  const tagged: Asset = { ...assets[0]!, tags: ["favorite"], metadataState: "valid", metadataId: "uuid-1", metadataRevision: "rev-1" };
  const gearRow = () => assetRows().find((row) => row.getAttribute("title") === "Gear.stl")!;
  const tracked = (mocks: UsageMocks) => mocks.trackUsage.mock.calls.map(([event]) => event);
  const searchBox = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Search assets and tags" });
  const sidebarTag = (container: HTMLElement) => container.querySelector<HTMLElement>('.tag-nav[title="Filter by favorite"]')!;
  const savedSearch: SavedSearch = { id: "s1", libraryId: library.id, name: "Gear search", filters: { query: "favorite", view: "all", matchMode: "any", kind: "file" } };

  describe("search_used", () => {
    afterEach(() => { vi.useRealTimers(); });

    it("fires once after 2 s of non-empty typing and carries no query text", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      fireEvent.change(searchBox(), { target: { value: "secret" } });
      act(() => { vi.advanceTimersByTime(1000); });
      fireEvent.change(searchBox(), { target: { value: "secret term" } });
      act(() => { vi.advanceTimersByTime(1999); });
      expect(mocks.trackUsage).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(mocks.trackUsage).toHaveBeenCalledWith({ name: "search_used" });
      expect(mocks.trackUsage.mock.calls).toEqual([[{ name: "search_used" }]]);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(mocks.trackUsage).toHaveBeenCalledTimes(1);
    });

    it("does not fire when the text is cleared within 2 s", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      fireEvent.change(searchBox(), { target: { value: "gear" } });
      act(() => { vi.advanceTimersByTime(1500); });
      fireEvent.change(searchBox(), { target: { value: "" } });
      act(() => { vi.advanceTimersByTime(5000); });
      expect(mocks.trackUsage).not.toHaveBeenCalled();
    });
  });

  describe("tag_filter_click", () => {
    it("sends one tag_filter_click and no search_used from the sidebar", () => {
      const mocks = usageMocks();
      setUsage({ assets: [tagged, assets[1]!], mocks });
      const { container } = render(<App />);
      fireEvent.click(sidebarTag(container));
      expect(searchBox().value).toBe("favorite");
      expect(tracked(mocks)).toEqual([{ name: "tag_filter_click" }]);
    });

    it("sends one tag_filter_click and no search_used from a row's tag list", () => {
      const mocks = usageMocks();
      setUsage({ assets: [tagged, assets[1]!], mocks });
      render(<App />);
      fireEvent.click(within(gearRow()).getByRole("button", { name: "favorite" }));
      expect(searchBox().value).toBe("favorite");
      expect(tracked(mocks)).toEqual([{ name: "tag_filter_click" }]);
    });

    it("sends one tag_filter_click and no search_used from the details panel", () => {
      const mocks = usageMocks();
      setUsage({ assets: [tagged, assets[1]!], mocks });
      render(<App />);
      fireEvent.click(gearRow());
      fireEvent.click(within(screen.getByRole("complementary", { name: "Asset details" })).getByRole("button", { name: "favorite" }));
      expect(searchBox().value).toBe("favorite");
      expect(tracked(mocks)).toEqual([{ name: "tag_filter_click" }]);
    });
  });

  describe("filter_change", () => {
    it("is not sent when loading a saved search that changes the match mode and kind", () => {
      const mocks = usageMocks();
      setUsage({ assets: [tagged, assets[1]!], savedSearches: [savedSearch], mocks });
      render(<App />);
      fireEvent.click(screen.getByTitle("Load Gear search"));
      expect(searchBox().value).toBe("favorite");
      expect(tracked(mocks)).toEqual([{ name: "saved_search_apply" }]);
    });

    it("is not sent by Clear active filter", () => {
      const mocks = usageMocks();
      setUsage({ assets: [tagged, assets[1]!], mocks });
      const { container } = render(<App />);
      fireEvent.click(sidebarTag(container));
      fireEvent.click(screen.getByRole("button", { name: "Clear active filter" }));
      expect(searchBox().value).toBe("");
      expect(tracked(mocks)).toEqual([{ name: "tag_filter_click" }]);
    });

    it("is not sent when changing view", () => {
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: /^Untagged/ }));
      fireEvent.click(screen.getByRole("button", { name: /^All assets/ }));
      expect(tracked(mocks)).toEqual([]);
    });

    it("is not sent when the library switches and resets the filters", () => {
      const mocks = usageMocks();
      setUsage({ assets: [tagged, assets[1]!], mocks });
      const { container, rerender } = render(<App />);
      fireEvent.click(sidebarTag(container));
      expect(screen.getByRole("button", { name: "Clear active filter" })).toBeTruthy();
      setUsage({ assets: [tagged, assets[1]!], library: secondLibrary, state: { ...libraryState, activeLibraryId: secondLibrary.id }, mocks });
      rerender(<App />);
      expect(screen.queryByRole("button", { name: "Clear active filter" })).toBeNull();
      expect(tracked(mocks)).toEqual([{ name: "tag_filter_click" }]);
    });

    it("is sent once when the kind filter changes", () => {
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      chooseFilter("Asset kind", "Files");
      expect(tracked(mocks)).toEqual([{ name: "filter_change" }]);
    });

    it("is sent once when the match mode changes", () => {
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      chooseFilter("Required tag match", "Any tag");
      expect(tracked(mocks)).toEqual([{ name: "filter_change" }]);
    });
  });

  describe("asset_preview", () => {
    const textPreview = { kind: "text" as const, content: "hello preview", mimeType: "text/plain", truncated: false, message: null };

    it("is sent once when a text preview shows", async () => {
      actions.previewAsset.mockResolvedValue(textPreview);
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      fireEvent.click(gearRow());
      expect(await screen.findByText("hello preview")).toBeTruthy();
      expect(tracked(mocks)).toEqual([{ name: "asset_preview" }]);
    });

    it("is not sent for an unsupported preview", async () => {
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      fireEvent.click(gearRow());
      expect(await screen.findByText("No preview available.")).toBeTruthy();
      expect(actions.previewAsset).toHaveBeenCalledTimes(1);
      expect(tracked(mocks)).toEqual([]);
    });

    it("is not sent, and nothing loads, while the details panel is hidden", async () => {
      actions.previewAsset.mockResolvedValue(textPreview);
      const mocks = usageMocks();
      setUsage({ mocks });
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
      fireEvent.click(gearRow());
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByText("hello preview")).toBeNull();
      expect(actions.previewAsset).not.toHaveBeenCalled();
      expect(tracked(mocks)).toEqual([{ name: "details_panel_close" }]);
    });

    describe("in a narrow window", () => {
      beforeEach(() => { stubMatchMedia(true); });

      it("shows the preview but sends no event", async () => {
        actions.previewAsset.mockResolvedValue(textPreview);
        const mocks = usageMocks();
        setUsage({ mocks });
        render(<App />);
        fireEvent.click(gearRow());
        expect(await screen.findByText("hello preview")).toBeTruthy();
        expect(window.matchMedia).toHaveBeenCalledWith(narrowQuery);
        expect(tracked(mocks)).toEqual([]);
      });
    });

    it("is not repeated for the same item, and re-rendering or scrolling does not reload the preview", async () => {
      actions.previewAsset.mockResolvedValue(textPreview);
      const mocks = usageMocks();
      setUsage({ mocks });
      const { rerender } = render(<App />);
      fireEvent.click(gearRow());
      expect(await screen.findByText("hello preview")).toBeTruthy();
      expect(tracked(mocks)).toEqual([{ name: "asset_preview" }]);

      fireEvent.click(gearRow());
      setUsage({ mocks });
      rerender(<App />);
      fireEvent.scroll(screen.getByRole("table").parentElement!);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText("hello preview")).toBeTruthy();
      expect(actions.previewAsset).toHaveBeenCalledTimes(1);
      expect(tracked(mocks)).toEqual([{ name: "asset_preview" }]);
    });
  });
});

describe("usage install gate", () => {
  useUsageEnvironment();
  const installButton = () => {
    const dialog = screen.getAllByRole("dialog").find((candidate) => within(candidate).queryByRole("button", { name: /download and install/i }));
    expect(dialog).toBeDefined();
    return { dialog: dialog!, button: within(dialog!).getByRole<HTMLButtonElement>("button", { name: /download and install/i }) };
  };
  async function openUpdate() {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({ status: "available", version: "0.5.0", notes: "Release notes" });
    await waitFor(() => expect(screen.getByRole("button", { name: /update available/i })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /update available/i }));
  }

  it("blocks during a consent save and while the opt-out is not saved, then allows again once saved", async () => {
    const mocks = usageMocks();
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({ status: "available", version: "0.5.0", notes: "Release notes" });
    setUsage({ usage: sharingUsage, mocks });
    const { rerender } = render(<App />);
    await openUpdate();
    expect(installButton().button.disabled).toBe(false);

    setUsage({ usage: sharingUsage, savingUsage: true, mocks });
    rerender(<App />);
    expect(installButton().button.disabled).toBe(true);
    expect(within(installButton().dialog).getByText(/Saving usage data choice/)).toBeTruthy();

    setUsage({ usage: sharingUsage, mocks });
    rerender(<App />);
    expect(installButton().button.disabled).toBe(false);

    setUsage({ usage: notSavedUsage, mocks });
    rerender(<App />);
    const blocked = installButton();
    expect(blocked.button.disabled).toBe(true);
    expect(blocked.dialog.textContent).toContain('Save "off"');
    expect(blocked.dialog.textContent).toContain("Usage data is off but not saved");

    setUsage({ usage: offUsage, mocks });
    rerender(<App />);
    expect(installButton().button.disabled).toBe(false);
  });

  it("blocks while the consent dialog is open", async () => {
    const mocks = usageMocks();
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({ status: "available", version: "0.5.0", notes: "Release notes" });
    setUsage({ usage: undecidedUsage, mocks });
    render(<App />);
    expect(firstAskDialog()).toBeTruthy();
    await openUpdate();
    expect(installButton().button.disabled).toBe(true);
    expect(installButton().dialog.textContent).toContain("Usage data dialog open");
  });
});
