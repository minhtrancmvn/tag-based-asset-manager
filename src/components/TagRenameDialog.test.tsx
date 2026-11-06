// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TagRenameDialog, type TagRenameDialogProps } from "./TagRenameDialog";
import type { RenameApplyHookResult, RenamePreviewResult } from "../useLibrary";
import { deriveRenameMigration, normalizeRenameMapping, type RenameMigration } from "../tagRename";
import type {
  AppError, Asset, RenameApplyResult, RenameMapping, RenamePreview, RenameSkippedRow, RenameTargetSummary, SavedSearch, SearchFilters,
} from "../types";

afterEach(cleanup);

const exactMapping: RenameMapping = { mode: "exact", source: "status:printed", destination: "state:printed" };
const prefixMapping: RenameMapping = { mode: "prefix", source: "status", destination: "state" };

function filters(query: string): SearchFilters {
  return { query, view: "all", matchMode: "all", kind: "all" };
}

function savedSearch(id: string, name: string, query: string): SavedSearch {
  return { id, libraryId: "lib-1", name, filters: filters(query) };
}

function asset(relativePath: string, kind: Asset["kind"] = "file"): Asset {
  return {
    id: relativePath, name: relativePath.split("/").pop() ?? relativePath, relativePath, kind, extension: null, modifiedAt: null,
    sizeBytes: null, tags: [], status: "ready",
  };
}

function target(relativePath: string, duplicatesCollapsed = 0): RenameTargetSummary {
  return { assetId: relativePath, relativePath, kind: "file", sidecarOwner: ".", duplicatesCollapsed };
}

function skipped(relativePath: string, reason: RenameSkippedRow["reason"] = "missing", message: string | null = null): RenameSkippedRow {
  return { assetId: relativePath, relativePath, kind: "file", reason, message };
}

function makePreview(overrides: Partial<RenamePreview> = {}): RenamePreview {
  return {
    previewId: "preview-1", libraryId: "lib-1", scanId: "scan-1", mapping: exactMapping,
    scan: { libraryId: "lib-1", scanId: "scan-1", assets: [], issues: [], scannedAt: "2026-11-04T00:00:00Z" },
    targets: [target("Models/A.stl"), target("Models/B.stl")],
    fileCount: 12, folderCount: 3, sidecarCount: 4, destinationExists: false, collisions: [], duplicatesCollapsed: 0,
    skipped: [], uninspectable: [], savedSearchUpdateCount: 0, settingsRetry: false,
    ...overrides,
  };
}

function makeMigration(overrides: Partial<RenameMigration> = {}): RenameMigration {
  return { activeQuery: { before: "", after: "", changed: false }, replacements: [], blockers: [], ...overrides };
}

function ready(preview: RenamePreview = makePreview(), migration: RenameMigration = makeMigration()): RenamePreviewResult {
  return { status: "ready", preview, migration };
}

function makeApplied(overrides: Partial<RenameApplyResult> = {}): RenameApplyResult {
  return {
    previewId: "preview-1", libraryId: "lib-1", mapping: exactMapping, committed: [asset("Models/A.stl"), asset("Models/B.stl")],
    failed: [], unattempted: [], failingSidecar: null, skipped: [], uninspectable: [], savedSearches: [], error: null,
    outcome: "complete", queryMigrated: true,
    ...overrides,
  };
}

function applied(result: RenameApplyResult = makeApplied(), queryUpdated = false): RenameApplyHookResult {
  return { status: "applied", result, queryUpdated };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function appError(message: string): AppError {
  return { message, path: null, details: null };
}

function baseProps(overrides: Partial<TagRenameDialogProps> = {}): TagRenameDialogProps {
  return {
    mode: "exact", source: "status:printed", libraryId: "lib-1", activeFilters: filters(""), savedSearches: [],
    previewing: false, applying: false, progress: 0, error: null,
    onPreview: vi.fn(async () => ready()), onCancelPreview: vi.fn(async () => true), onApply: vi.fn(async () => applied()), onClose: vi.fn(),
    ...overrides,
  };
}

function renderDialog(overrides: Partial<TagRenameDialogProps> = {}) {
  const props = baseProps(overrides);
  const view = render(<TagRenameDialog {...props} />);
  return { props, ...view, update: (next: Partial<TagRenameDialogProps>) => view.rerender(<TagRenameDialog {...props} {...next} />) };
}

function destinationField(): HTMLInputElement {
  return screen.getByRole("textbox", { name: /^New name for/ }) as HTMLInputElement;
}

function typeDestination(value: string): void {
  fireEvent.change(destinationField(), { target: { value } });
}

async function click(name: string | RegExp): Promise<void> {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
}

async function previewReady(overrides: Partial<TagRenameDialogProps> = {}, preview: RenamePreviewResult = ready()) {
  const view = renderDialog({ onPreview: vi.fn(async () => preview), ...overrides });
  typeDestination("state:printed");
  await click("Preview");
  return view;
}

function countOf(label: string): string | null {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? null;
}

describe("TagRenameDialog draft", () => {
  it("prefills the current name, shows the full normalized names and mode in labels, and never previews on its own", () => {
    const { props } = renderDialog({ source: " Status:Printed " });
    expect(screen.getByRole("dialog", { name: "Rename tag" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Current name" }) as HTMLInputElement).value).toBe("status:printed");
    expect((screen.getByRole("textbox", { name: "Current name" }) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole("textbox", { name: 'New name for exact tag "status:printed"' })).toBeTruthy();
    expect(document.activeElement).toBe(destinationField());
    typeDestination("State:Printed");
    expect(screen.getByText(/Exact tag: "status:printed" becomes "state:printed"/)).toBeTruthy();
    expect(props.onPreview).not.toHaveBeenCalled();
  });

  it("labels prefix mode as a prefix group and states that the rest of every tag is kept", () => {
    renderDialog({ mode: "prefix", source: "Status:" });
    expect(screen.getByRole("dialog", { name: "Rename prefix group" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: 'New name for prefix group "status:"' })).toBeTruthy();
    typeDestination("State");
    expect(screen.getByText(/Prefix group: tags starting with "status:" will start with "state:" instead/)).toBeTruthy();
  });

  it("disables Preview for an unchanged or empty destination without raising an alert", () => {
    renderDialog();
    const preview = screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement;
    expect(preview.disabled).toBe(true);
    typeDestination("   ");
    expect(preview.disabled).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    typeDestination("state:printed");
    expect(preview.disabled).toBe(false);
  });

  it("sends the raw typed names and the active filters when Preview is clicked", async () => {
    const filtersNow = filters("status:printed");
    const { props } = renderDialog({ activeFilters: filtersNow });
    typeDestination("  State:Printed ");
    await click("Preview");
    expect(props.onPreview).toHaveBeenCalledOnce();
    expect(props.onPreview).toHaveBeenCalledWith({ mode: "exact", source: "status:printed", destination: "  State:Printed ", activeFilters: filtersNow });
  });
});

describe("TagRenameDialog pre-preview blockers", () => {
  const reasons = [
    { label: "whitespace", destination: "state printed", phrase: /spaces would split into several query terms/ },
    { label: "quote-leading", destination: '"state', phrase: /quotation mark would be read as quoted path text/ },
    { label: "leading-minus", destination: "-state", phrase: /minus sign would be read as an exclusion/ },
  ] as const;
  const sources = [
    // The trailing quoted phrase matters: a lone leading quote with nothing to pair with is an ordinary tag to the
    // query parser, so the canonical derivation reports quote-leading only when a later quote could pair with it.
    { label: "the active query", props: { activeFilters: filters('status:printed "Flexi Dragon"') }, who: "Active query" },
    {
      label: "a named saved search",
      props: { activeFilters: filters(""), savedSearches: [savedSearch("s1", "Printed models", 'status:printed "Flexi Dragon"')] },
      who: 'Saved search "Printed models"',
    },
  ] as const;

  for (const reason of reasons) {
    for (const source of sources) {
      it(`blocks a ${reason.label} destination in ${source.label} and never calls onPreview`, () => {
        const { props, container } = renderDialog(source.props);
        typeDestination(reason.destination);

        const alert = screen.getByRole("alert");
        expect(alert.textContent).toContain(source.who);
        expect(alert.textContent).toContain('"status:printed"');
        expect(alert.textContent).toMatch(reason.phrase);
        expect(alert.textContent).toContain(`"${reason.destination}"`);
        expect(destinationField().getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
        expect(destinationField().getAttribute("aria-invalid")).toBe("true");

        const preview = screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement;
        expect(preview.disabled).toBe(true);
        fireEvent.click(preview);
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(props.onPreview).not.toHaveBeenCalled();
      });
    }
  }

  it("states the three remedies and that the draft is preserved only while the dialog stays open", () => {
    renderDialog({ activeFilters: filters("status:printed") });
    typeDestination("state printed");
    const alert = screen.getByRole("alert");
    expect(within(alert).getAllByRole("listitem").map((item) => item.textContent).filter((text) => /Choose a different new name|edit the active query|edit or delete the saved search/.test(text ?? ""))).toHaveLength(3);
    expect(alert.textContent).toMatch(/draft is preserved while this dialog stays open/);
    expect(alert.textContent).toMatch(/closing it discards the draft/i);
    expect(alert.textContent).toMatch(/Nothing has been changed/);
  });

  it("clears the blocker when the draft is edited to a representable name", () => {
    renderDialog({ activeFilters: filters("status:printed") });
    typeDestination("state printed");
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);
    typeDestination("state:printed");
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(false);
    expect(destinationField().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("agrees with the shared derivation so the dialog never invents its own blockers", () => {
    const active = filters("status:printed");
    const mapping = normalizeRenameMapping("exact", "status:printed", "state printed");
    if (!mapping.ok) throw new Error("mapping");
    const expected = deriveRenameMigration({ libraryId: "lib-1", activeFilters: active, savedSearches: [], mapping: mapping.mapping }).blockers;
    expect(expected).toHaveLength(1);
    renderDialog({ activeFilters: active });
    typeDestination("state printed");
    expect(screen.getByRole("alert").textContent).toContain(expected[0]?.token ?? "missing");
  });
});

describe("TagRenameDialog preview disclosure", () => {
  it("states whole-library scope and shows file, folder, sidecar and search counts separately", async () => {
    const migration = makeMigration({
      activeQuery: { before: "status:printed", after: "state:printed", changed: true },
      replacements: [
        { searchId: "s1", name: "Printed models", expectedFilters: filters("status:printed"), filters: filters("state:printed") },
        { searchId: "s2", name: "Queue", expectedFilters: filters("status:printed x"), filters: filters("state:printed x") },
      ],
    });
    await previewReady({}, ready(makePreview({ savedSearchUpdateCount: 2 }), migration));

    expect(screen.getByText(/Counts cover the whole active library, including subfolders, not only the folder you are viewing/)).toBeTruthy();
    expect(countOf("Files")).toBe("12");
    expect(countOf("Folders")).toBe("3");
    expect(countOf("Sidecar files")).toBe("4");
    expect(countOf("Searches to update")).toBe("2");
    const searches = screen.getByRole("list", { name: "Searches to update" });
    expect(within(searches).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Printed models", "Queue"]);
    expect(screen.getByText(/Active query changes from/).textContent).toContain("status:printed");
    expect(screen.getByText(/Active query changes from/).textContent).toContain("state:printed");
  });

  it("discloses a destination that already exists, collapsed duplicates and per-row collapses", async () => {
    const preview = makePreview({ destinationExists: true, duplicatesCollapsed: 2, targets: [target("Models/A.stl", 2), target("Models/B.stl", 0)] });
    await previewReady({}, ready(preview));
    expect(screen.getByText(/The destination tag "state:printed" already exists in the library/)).toBeTruthy();
    expect(screen.getByText(/Duplicate tags collapsed: 2/)).toBeTruthy();
    const rows = screen.getByRole("region", { name: "Rows that collapse a duplicate" });
    expect(rows.textContent).toContain("Models/A.stl");
    expect(rows.textContent).not.toContain("Models/B.stl");
  });

  it("shows prefix collisions as a count plus the colliding mappings next to the destination flag", async () => {
    const preview = makePreview({
      mapping: prefixMapping, destinationExists: true,
      collisions: [{ from: "status:printed", to: "state:printed" }, { from: "status:queued", to: "state:queued" }],
    });
    renderDialog({ mode: "prefix", source: "status", onPreview: vi.fn(async () => ready(preview)) });
    typeDestination("state");
    await click("Preview");
    expect(screen.getByText(/Colliding mappings: 2/)).toBeTruthy();
    const region = screen.getByRole("region", { name: "Colliding mappings" });
    expect(region.textContent).toContain("status:printed");
    expect(region.textContent).toContain("state:queued");
  });

  it("lists skipped rows with their reasons and uninspectable rows, in focusable scroll regions", async () => {
    const preview = makePreview({
      skipped: [skipped("Gone/Old.stl", "missing"), skipped("Bad/Locked.stl", "blocked", "Malformed manifest")],
      uninspectable: [{ message: "Metadata could not be parsed", path: "Broken", details: "line 3" }],
    });
    await previewReady({}, ready(preview));
    expect(screen.getByText(/2 skipped rows keep their old tag/)).toBeTruthy();
    expect(screen.getByText(/1 row has metadata that cannot be read/)).toBeTruthy();

    const skippedRegion = screen.getByRole("region", { name: "Skipped rows" });
    expect(skippedRegion.getAttribute("tabindex")).toBe("0");
    expect(skippedRegion.textContent).toContain("Gone/Old.stl");
    expect(skippedRegion.textContent).toMatch(/Missing/);
    expect(skippedRegion.textContent).toContain("Bad/Locked.stl");
    expect(skippedRegion.textContent).toMatch(/Blocked/);
    expect(skippedRegion.textContent).toContain("Malformed manifest");

    const unreadable = screen.getByRole("region", { name: "Rows with unreadable metadata" });
    expect(unreadable.getAttribute("tabindex")).toBe("0");
    expect(unreadable.textContent).toContain("Broken");
    expect(unreadable.textContent).toContain("Metadata could not be parsed");
  });

  it("bounds long lists and reveals more on request", async () => {
    const many = Array.from({ length: 60 }, (_, index) => skipped(`Gone/${String(index).padStart(2, "0")}.stl`));
    await previewReady({}, ready(makePreview({ skipped: many })));
    const region = () => screen.getByRole("region", { name: "Skipped rows" });
    expect(within(region()).getAllByRole("listitem")).toHaveLength(25);
    expect(screen.getByText(/60 skipped rows keep their old tag/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show 25 more skipped rows/ }));
    expect(within(region()).getAllByRole("listitem")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: /Show 10 more skipped rows/ }));
    expect(within(region()).getAllByRole("listitem")).toHaveLength(60);
    expect(screen.queryByRole("button", { name: /more skipped rows/ })).toBeNull();
  });

  it("does not offer a rename when nothing is editable and no settings retry is pending", async () => {
    await previewReady({}, ready(makePreview({ targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, skipped: [skipped("Gone/Old.stl")] })));
    expect(screen.getByText(/No editable rows match/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review rename" })).toBeNull();
  });
});

describe("TagRenameDialog confirmation and apply", () => {
  it("requires a second explicit step, repeats the full names and mode, and carries the backup and no-undo notice", async () => {
    const view = await previewReady();
    expect(view.props.onApply).not.toHaveBeenCalled();
    await click("Review rename");
    expect(view.props.onApply).not.toHaveBeenCalled();

    const confirmation = screen.getByRole("region", { name: "Confirm rename" });
    expect(confirmation.textContent).toContain('exact tag "status:printed"');
    expect(confirmation.textContent).toContain('"state:printed"');
    expect(confirmation.textContent).toMatch(/12 files and 3 folders/);
    expect(confirmation.textContent).toMatch(/whole library, including subfolders/);
    expect(confirmation.textContent).toMatch(/cannot be undone/);
    expect(confirmation.textContent).toMatch(/no rollback across folders/i);
    expect(confirmation.textContent).toMatch(/Export JSON/);

    await click("Confirm rename");
    expect(view.props.onApply).toHaveBeenCalledOnce();
    expect(view.props.onApply).toHaveBeenCalledWith("preview-1");
  });

  it("names the prefix group, not just a suffix, in the confirmation", async () => {
    const preview = makePreview({ mapping: prefixMapping });
    renderDialog({ mode: "prefix", source: "status", onPreview: vi.fn(async () => ready(preview)) });
    typeDestination("state");
    await click("Preview");
    await click("Review rename");
    const confirmation = screen.getByRole("region", { name: "Confirm rename" });
    expect(confirmation.textContent).toContain('prefix group "status:"');
    expect(confirmation.textContent).toContain('"state:"');
    expect(confirmation.textContent).toMatch(/everything after the prefix is kept/);
  });

  it("keeps the skipped-rows warning visible in the confirmation step", async () => {
    await previewReady({}, ready(makePreview({ skipped: [skipped("Gone/Old.stl")] })));
    await click("Review rename");
    expect(screen.getByRole("region", { name: "Confirm rename" }).textContent).toMatch(/1 skipped row.*old tag/s);
  });

  it("allows a zero-target settings retry and describes it as a saved-search-only completion", async () => {
    const migration = makeMigration({ replacements: [{ searchId: "s1", name: "Printed models", expectedFilters: filters("status:printed"), filters: filters("state:printed") }] });
    const preview = makePreview({ targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 1 });
    await previewReady({}, ready(preview, migration));
    expect(screen.getByText(/finishes the saved-search and active-query update from a rename already saved/i)).toBeTruthy();
    await click("Review rename");
    expect(screen.getByRole("region", { name: "Confirm rename" }).textContent).toMatch(/No sidecar files are rewritten/);
    await click("Confirm rename");
  });
});

describe("TagRenameDialog invalidation", () => {
  it("drops a ready preview when the draft is edited, so no old preview can be applied", async () => {
    const view = await previewReady();
    expect(screen.getByRole("button", { name: "Review rename" })).toBeTruthy();
    typeDestination("state:printed2");
    expect(screen.queryByRole("button", { name: "Review rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm rename" })).toBeNull();
    expect(screen.queryByText("Rename preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(view.props.onApply).not.toHaveBeenCalled();
  });

  it("drops an open confirmation when the draft is edited", async () => {
    await previewReady();
    await click("Review rename");
    typeDestination("state:other");
    expect(screen.queryByRole("region", { name: "Confirm rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm rename" })).toBeNull();
  });

  it("ignores a preview that finishes after the library changed", async () => {
    const pending = deferred<RenamePreviewResult>();
    const view = renderDialog({ onPreview: vi.fn(() => pending.promise) });
    typeDestination("state:printed");
    await click("Preview");
    view.update({ libraryId: "lib-2" });
    await act(async () => { pending.resolve(ready()); await pending.promise; });
    expect(screen.queryByRole("button", { name: "Review rename" })).toBeNull();
  });
});

describe("TagRenameDialog Escape, focus and busy state", () => {
  it("Escape while idle closes the dialog", () => {
    const { props } = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onCancelPreview).not.toHaveBeenCalled();
  });

  it("Escape during preview cancels the preview and does not close the dialog", async () => {
    const pending = deferred<RenamePreviewResult>();
    const view = renderDialog({ onPreview: vi.fn(() => pending.promise) });
    typeDestination("state:printed");
    await click("Preview");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(view.props.onCancelPreview).toHaveBeenCalledOnce();
    expect(view.props.onClose).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ status: "cancelled" }); await pending.promise; });
    expect(screen.getByText(/Preview cancelled\. Nothing was changed; your draft is kept/)).toBeTruthy();
    expect(destinationField().value).toBe("state:printed");
  });

  it("keeps Escape reachable after Preview starts by moving focus inside the dialog", async () => {
    const pending = deferred<RenamePreviewResult>();
    renderDialog({ onPreview: vi.fn(() => pending.promise) });
    typeDestination("state:printed");
    await click("Preview");
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel preview" }));
  });

  it("Escape during apply does nothing", async () => {
    const pending = deferred<RenameApplyHookResult>();
    const view = await previewReady({ onApply: vi.fn(() => pending.promise) });
    await click("Review rename");
    await click("Confirm rename");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { screen.getByRole("dialog").dispatchEvent(event); });
    expect(view.props.onClose).not.toHaveBeenCalled();
    expect(view.props.onCancelPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await act(async () => { pending.resolve(applied()); await pending.promise; });
  });

  it("disables the draft and Preview while a preview is pending but keeps Cancel preview enabled", async () => {
    const pending = deferred<RenamePreviewResult>();
    renderDialog({ onPreview: vi.fn(() => pending.promise) });
    typeDestination("state:printed");
    await click("Preview");
    expect(destinationField().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel preview" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Close rename dialog" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve({ status: "cancelled" }); await pending.promise; });
  });

  it("disables every control while an apply is pending", async () => {
    const pending = deferred<RenameApplyHookResult>();
    await previewReady({ onApply: vi.fn(() => pending.promise) });
    await click("Review rename");
    await click("Confirm rename");
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button") as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(destinationField().disabled).toBe(true);
    await act(async () => { pending.resolve(applied()); await pending.promise; });
  });

  it("honours the hook busy flags even before the dialog starts its own request", () => {
    renderDialog({ applying: true });
    expect(destinationField().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("traps Tab and Shift+Tab inside the dialog", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']")];
    expect(controls.length).toBeGreaterThan(2);
    controls[controls.length - 1]?.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(controls[0]);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(controls[controls.length - 1]);
  });

  it("restores focus to the element that opened it when it closes", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open rename</button>
          {open && <TagRenameDialog {...baseProps({ onClose: () => setOpen(false) })} />}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Open rename" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("TagRenameDialog preview results and rejections", () => {
  it("announces a ready preview in the single live region", async () => {
    await previewReady();
    expect(screen.getByRole("status").textContent).toMatch(/Preview ready: 12 files, 3 folders, 4 sidecar files/);
  });

  for (const [reason, phrase] of [
    ["mutation", /library changed while it was scanning/],
    ["library-changed", /approved library changed while it was scanning/],
    ["sidecar-changed", /metadata file changed while it was scanning/],
  ] as const) {
    it(`shows the ${reason} discard reason, keeps the draft and offers Preview again`, async () => {
      renderDialog({ onPreview: vi.fn(async () => ({ status: "discarded", reason }) as RenamePreviewResult) });
      typeDestination("state:printed");
      await click("Preview");
      expect(screen.getByRole("alert").textContent).toMatch(phrase);
      expect(destinationField().value).toBe("state:printed");
      expect((screen.getByRole("button", { name: "Preview again" }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole("button", { name: "Review rename" })).toBeNull();
    });
  }

  it("a stale-preview rejection of apply keeps the draft, removes the old preview and offers Preview again", async () => {
    const pending = deferred<RenameApplyHookResult>();
    const view = await previewReady({ onApply: vi.fn(() => pending.promise) });
    await click("Review rename");
    await click("Confirm rename");
    view.update({ error: appError("Metadata revision changed since the rename preview; preview again") });
    await act(async () => { pending.resolve({ status: "failed" }); await pending.promise; });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/preview is no longer valid/i);
    expect(alert.textContent).toMatch(/Nothing was changed/);
    expect(alert.textContent).toContain("Metadata revision changed since the rename preview");
    expect(alert.textContent).not.toMatch(/error panel|above|behind/i);
    expect(destinationField().value).toBe("state:printed");
    expect(screen.queryByRole("button", { name: "Confirm rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review rename" })).toBeNull();
    expect(screen.getByRole("button", { name: "Preview again" }).className).toContain("primary-button");
    expect(view.props.onApply).toHaveBeenCalledOnce();
  });

  it("gives unknown-search and changed-filters rejections their own copy", async () => {
    const copies: string[] = [];
    for (const message of [
      "Unknown saved search in the rename replacements",
      "A saved search changed since the rename request was built; preview again",
      "The rename targets changed since the preview; preview again",
    ]) {
      const view = renderDialog({ onPreview: vi.fn(async () => ({ status: "failed" }) as RenamePreviewResult), error: appError(message) });
      typeDestination("state:printed");
      await click("Preview");
      const alert = screen.getByRole("alert");
      copies.push((alert.textContent ?? "").replace(message, ""));
      expect(destinationField().value).toBe("state:printed");
      expect(screen.getByRole("button", { name: "Preview again" })).toBeTruthy();
      view.unmount();
    }
    expect(copies[0]).toMatch(/no longer exists or belongs to another library/);
    expect(copies[1]).toMatch(/saved search was edited after this rename was prepared/);
    expect(copies[2]).toMatch(/preview is no longer valid/i);
    expect(new Set(copies).size).toBe(3);
  });

  it("does not claim a rename changed nothing when an apply result is unusable for an unclassified reason", async () => {
    const view = await previewReady({ onApply: vi.fn(async () => ({ status: "failed" }) as RenameApplyHookResult) });
    view.update({ error: appError("Rename result omitted requested rows.") });
    await click("Review rename");
    await click("Confirm rename");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Rescan the library to see what changed/);
    expect(alert.textContent).not.toMatch(/Nothing was changed/);
  });

  it("does not claim a rename changed nothing when the library changed during apply", async () => {
    await previewReady({ onApply: vi.fn(async () => ({ status: "stale" }) as RenameApplyHookResult) });
    await click("Review rename");
    await click("Confirm rename");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/result could not be confirmed/);
    expect(alert.textContent).not.toMatch(/Nothing was changed/);
  });
});

describe("TagRenameDialog outcomes", () => {
  async function applyWith(result: RenameApplyHookResult, preview = ready(), extra: Partial<TagRenameDialogProps> = {}) {
    const view = await previewReady({ onApply: vi.fn(async () => result), ...extra }, preview);
    await click("Review rename");
    await click("Confirm rename");
    return view;
  }

  it("shows a complete outcome with the skipped-rows warning and announces it", async () => {
    const preview = ready(makePreview({ skipped: [skipped("Gone/Old.stl")] }), makeMigration({ activeQuery: { before: "status:printed", after: "state:printed", changed: true } }));
    const result = makeApplied({ skipped: [skipped("Gone/Old.stl")], savedSearches: [savedSearch("s1", "Printed models", "state:printed")] });
    const view = await applyWith(applied(result, true), preview);
    expect(screen.getByRole("heading", { name: "Rename complete" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Rename complete/);
    expect(screen.getByText(/Active query updated/)).toBeTruthy();
    expect(screen.getByText(/1 skipped row may still have the old tag/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull();
    await click("Close");
    expect(view.props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps a partial outcome in the dialog with exact counts, the failing sidecar and a way to continue", async () => {
    const result = makeApplied({
      outcome: "partial", queryMigrated: false, committed: [asset("Models/A.stl")], failed: [target("Models/B.stl")], unattempted: [target("Models/C.stl"), target("Models/D.stl")],
      failingSidecar: "Models/.asset-tags.json", error: appError("Disk full"),
    });
    const view = await applyWith(applied(result), ready(makePreview(), makeMigration({ activeQuery: { before: "status:printed", after: "state:printed", changed: true } })));

    expect(screen.getByRole("heading", { name: "Rename partly applied" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Rename partly applied: 1 of 4 rows committed/);
    expect(countOf("Committed")).toBe("1");
    expect(countOf("Failed")).toBe("1");
    expect(countOf("Not attempted")).toBe("2");
    expect(screen.getByText(/Models\/\.asset-tags\.json/)).toBeTruthy();
    expect(screen.getByText(/Disk full/)).toBeTruthy();
    expect(screen.getByText(/Saved searches and the active query were not changed/)).toBeTruthy();
    expect(screen.getByText(/no longer include rows already renamed/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Rows not renamed" }).textContent).toContain("Models/C.stl");

    // Persists across a re-render with the hook state settled.
    view.update({ applying: false, previewing: false });
    expect(screen.getByRole("heading", { name: "Rename partly applied" })).toBeTruthy();

    await click("Preview remaining rows");
    expect(view.props.onPreview).toHaveBeenLastCalledWith({ mode: "exact", source: "status:printed", destination: "state:printed", activeFilters: filters("") });
  });

  it("keeps a settings-failed outcome, names the unmigrated searches and the active query, and states the retry limit", async () => {
    const migration = makeMigration({
      activeQuery: { before: "status:printed -x", after: "state:printed -x", changed: true },
      replacements: [
        { searchId: "s1", name: "Printed models", expectedFilters: filters("status:printed"), filters: filters("state:printed") },
        { searchId: "s2", name: "Queue", expectedFilters: filters("status:printed q"), filters: filters("state:printed q") },
        { searchId: "s3", name: "Already moved", expectedFilters: filters("status:printed z"), filters: filters("state:printed z") },
      ],
    });
    const result = makeApplied({
      outcome: "settings-failed", queryMigrated: false, error: appError("Settings file is read-only"),
      savedSearches: [savedSearch("s1", "Printed models", "status:printed"), savedSearch("s2", "Queue", "status:printed q"), savedSearch("s3", "Already moved", "state:printed z")],
    });
    const view = await applyWith(applied(result), ready(makePreview({ savedSearchUpdateCount: 3 }), migration));

    expect(screen.getByRole("heading", { name: "Rename saved, search update failed" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/saved-search update failed/i);
    expect(screen.getByText(/Settings file is read-only/)).toBeTruthy();
    const list = screen.getByRole("list", { name: "Saved searches not updated" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Printed models", "Queue"]);
    expect(screen.getByText(/Active query not updated/).textContent).toContain("status:printed -x");
    expect(screen.getByText(/only until the app closes/i)).toBeTruthy();
    expect(screen.getByText(/not saved/i)).toBeTruthy();

    // Retry stays reachable and requests a fresh preview with the same draft.
    await click("Preview settings retry");
    expect(view.props.onPreview).toHaveBeenCalledTimes(2);
    expect(view.props.onPreview).toHaveBeenLastCalledWith({ mode: "exact", source: "status:printed", destination: "state:printed", activeFilters: filters("") });
  });

  it("walks a settings retry through a zero-target preview back to Confirm", async () => {
    const migration = makeMigration({ replacements: [{ searchId: "s1", name: "Printed models", expectedFilters: filters("status:printed"), filters: filters("state:printed") }] });
    const failed = makeApplied({ outcome: "settings-failed", queryMigrated: false, error: appError("Settings file is read-only"), savedSearches: [savedSearch("s1", "Printed models", "status:printed")] });
    const retryPreview = ready(makePreview({ previewId: "preview-2", targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 1 }), migration);
    const onPreview = vi.fn<TagRenameDialogProps["onPreview"]>().mockResolvedValueOnce(ready(makePreview({ savedSearchUpdateCount: 1 }), migration)).mockResolvedValueOnce(retryPreview);
    const onApply = vi.fn<TagRenameDialogProps["onApply"]>().mockResolvedValueOnce(applied(failed)).mockResolvedValueOnce(applied(makeApplied({ previewId: "preview-2", committed: [], savedSearches: [savedSearch("s1", "Printed models", "state:printed")] })));
    renderDialog({ onPreview, onApply });
    typeDestination("state:printed");
    await click("Preview");
    await click("Review rename");
    await click("Confirm rename");
    await click("Preview settings retry");
    expect(screen.getByRole("button", { name: "Review rename" })).toBeTruthy();
    await click("Review rename");
    await click("Confirm rename");
    expect(onApply).toHaveBeenLastCalledWith("preview-2");
    expect(screen.getByRole("heading", { name: "Rename complete" })).toBeTruthy();
  });

  it("shows a retry preview that is discarded without losing the earlier persistent outcome", async () => {
    const result = makeApplied({ outcome: "settings-failed", queryMigrated: false, error: appError("Settings file is read-only") });
    const onPreview = vi.fn<TagRenameDialogProps["onPreview"]>().mockResolvedValueOnce(ready()).mockResolvedValueOnce({ status: "discarded", reason: "mutation" });
    renderDialog({ onPreview, onApply: vi.fn(async () => applied(result)) });
    typeDestination("state:printed");
    await click("Preview");
    await click("Review rename");
    await click("Confirm rename");
    await click("Preview settings retry");
    expect(screen.getByRole("heading", { name: "Rename saved, search update failed" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/library changed while it was scanning/);
    expect(screen.getByRole("button", { name: "Preview settings retry" })).toBeTruthy();
  });
});

describe("TagRenameDialog host integration", () => {
  const settingsFailed = (): RenameApplyResult => makeApplied({ outcome: "settings-failed", queryMigrated: false, error: appError("Settings file is read-only"), savedSearches: [savedSearch("s1", "Printed models", "status:printed")] });
  const partial = (): RenameApplyResult => makeApplied({
    outcome: "partial", queryMigrated: false, committed: [asset("Models/A.stl")], failed: [target("Models/B.stl")], failingSidecar: "Models/.asset-tags.json", error: appError("Disk full"),
  });
  const searchMigration = (): RenameMigration => makeMigration({
    activeQuery: { before: "status:printed", after: "state:printed", changed: true },
    replacements: [{ searchId: "s1", name: "Printed models", expectedFilters: filters("status:printed"), filters: filters("state:printed") }],
  });
  const resumeOf = (result: RenameApplyResult, mode: "exact" | "prefix" = "exact") => ({ mode, result, queryUpdated: false, migration: searchMigration() });
  const retryPreview = (overrides: Partial<RenamePreview> = {}) => ready(makePreview({
    previewId: "preview-2", targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0, settingsRetry: true, savedSearchUpdateCount: 1, ...overrides,
  }), searchMigration());

  it.each([
    ["complete", () => makeApplied(), true],
    ["partial", partial, false],
    ["settings-failed", settingsFailed, false],
  ] as const)("reports a %s result to the host with the mode, result, query flag and migration", async (_name, build, queryUpdated) => {
    const onOutcome = vi.fn();
    const result = build();
    const migration = searchMigration();
    const view = await previewReady({ onOutcome, onApply: vi.fn(async () => applied(result, queryUpdated)) }, ready(makePreview({ savedSearchUpdateCount: 1 }), migration));
    await click("Review rename");
    await click("Confirm rename");
    expect(onOutcome).toHaveBeenCalledExactlyOnceWith({ mode: "exact", result, queryUpdated, migration });
    view.unmount();
  });

  it("does not report an apply that produced no result", async () => {
    const onOutcome = vi.fn();
    await previewReady({ onOutcome, onApply: vi.fn(async () => ({ status: "unavailable" }) as RenameApplyHookResult) });
    await click("Review rename");
    await click("Confirm rename");
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("still reports an applied result that arrives after the dialog was unmounted, without touching dialog state", async () => {
    const onOutcome = vi.fn();
    const pending = deferred<RenameApplyHookResult>();
    const view = await previewReady({ onOutcome, onApply: vi.fn(() => pending.promise) });
    await click("Review rename");
    await click("Confirm rename");
    view.unmount();
    const result = partial();
    await act(async () => { pending.resolve(applied(result)); });
    expect(onOutcome).toHaveBeenCalledOnce();
    expect(onOutcome.mock.calls[0]?.[0]).toMatchObject({ result });
  });

  it("opens on a resumed outcome, focuses it and retries with the original destination", async () => {
    const onPreview = vi.fn(async () => ready(makePreview({ savedSearchUpdateCount: 1 }), searchMigration()));
    renderDialog({ resume: resumeOf(partial()), onPreview });
    const heading = screen.getByRole("heading", { name: "Rename partly applied" });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole("textbox", { name: /^New name for/ })).toBeNull();
    await click("Preview remaining rows");
    expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mode: "exact", source: "status:printed", destination: "state:printed", activeFilters: filters("") });
  });

  it("resumes a prefix outcome with the prefix destination and no colon", async () => {
    const onPreview = vi.fn(async () => ready());
    const result = makeApplied({ mapping: prefixMapping, outcome: "settings-failed", queryMigrated: false, error: appError("Settings file is read-only") });
    renderDialog({ mode: "prefix", source: "status", resume: resumeOf(result, "prefix"), onPreview });
    await click("Preview settings retry");
    expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mode: "prefix", source: "status", destination: "state", activeFilters: filters("") });
  });

  it("walks a resumed settings retry to a complete result and reports it", async () => {
    const onOutcome = vi.fn();
    const onPreview = vi.fn(async () => retryPreview());
    const complete = makeApplied({ previewId: "preview-2", committed: [], savedSearches: [savedSearch("s1", "Printed models", "state:printed")] });
    const onApply = vi.fn(async () => applied(complete));
    renderDialog({ resume: resumeOf(settingsFailed()), onPreview, onApply, onOutcome });
    await click("Preview settings retry");
    await click("Review rename");
    await click("Confirm rename");
    expect(onApply).toHaveBeenCalledExactlyOnceWith("preview-2");
    expect(screen.getByRole("heading", { name: "Rename complete" })).toBeTruthy();
    expect(onOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ result: complete }));
  });

  it("offers no Review when a settings retry has no saved search left to migrate, and lets a resumed dialog dismiss the notice", async () => {
    const onResolve = vi.fn();
    const onPreview = vi.fn(async () => retryPreview({ savedSearchUpdateCount: 0 }));
    renderDialog({ resume: resumeOf(settingsFailed()), onPreview, onResolve });
    await click("Preview settings retry");
    expect(screen.queryByRole("button", { name: "Review rename" })).toBeNull();
    expect(screen.getByText(/nothing remains to migrate/i)).toBeTruthy();
    await click("Dismiss notice");
    expect(onResolve).toHaveBeenCalledOnce();
  });

  it("lets a resumed partial outcome be dismissed when no editable row is left to rename", async () => {
    const onResolve = vi.fn();
    const onPreview = vi.fn(async () => ready(makePreview({ targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0 })));
    renderDialog({ resume: resumeOf(partial()), onPreview, onResolve });
    await click("Preview remaining rows");
    expect(screen.queryByRole("button", { name: "Review rename" })).toBeNull();
    await click("Dismiss notice");
    expect(onResolve).toHaveBeenCalledOnce();
  });

  it("offers no dismissal for an ordinary dialog or when the draft is a different rename", async () => {
    const onResolve = vi.fn();
    const empty = ready(makePreview({ targets: [], fileCount: 0, folderCount: 0, sidecarCount: 0 }));
    const view = renderDialog({ onResolve, onPreview: vi.fn(async () => empty) });
    typeDestination("state:printed");
    await click("Preview");
    expect(screen.queryByRole("button", { name: "Dismiss notice" })).toBeNull();
    view.unmount();

    renderDialog({ resume: resumeOf(partial()), onResolve, onPreview: vi.fn(async () => empty) });
    await click("Preview remaining rows");
    expect(screen.getByRole("button", { name: "Dismiss notice" })).toBeTruthy();
    typeDestination("other:name");
    expect(screen.queryByRole("button", { name: "Dismiss notice" })).toBeNull();
  });

  it("explains a rejected retry proof as 'saved searches changed; correct them manually' and offers dismissal", async () => {
    const onResolve = vi.fn();
    const view = renderDialog({
      resume: resumeOf(settingsFailed()), onResolve, onPreview: vi.fn(async () => retryPreview()), onApply: vi.fn(async () => ({ status: "failed" }) as RenameApplyHookResult),
    });
    await click("Preview settings retry");
    await click("Review rename");
    view.update({ error: appError("No editable rename targets and no verified settings retry; preview again") });
    await click("Confirm rename");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/saved searches changed; correct them manually/i);
    expect(alert.textContent).not.toMatch(/library or its metadata changed after it was made/);
    await click("Dismiss notice");
    expect(onResolve).toHaveBeenCalledOnce();
  });

  it("keeps the ordinary stale-preview copy and no dismissal for other rejected applies", async () => {
    const onResolve = vi.fn();
    const view = renderDialog({
      resume: resumeOf(settingsFailed()), onResolve, onPreview: vi.fn(async () => retryPreview()), onApply: vi.fn(async () => ({ status: "failed" }) as RenameApplyHookResult),
    });
    await click("Preview settings retry");
    await click("Review rename");
    view.update({ error: appError("Metadata revision changed since the rename preview; preview again") });
    await click("Confirm rename");
    expect(screen.getByRole("alert").textContent).toMatch(/no longer valid/i);
    expect(screen.queryByRole("button", { name: "Dismiss notice" })).toBeNull();
  });
});

describe("TagRenameDialog merged search disclosure (CON-7)", () => {
  const printed = savedSearch("s1", "Printed models", "status:printed");
  const notPrinted = savedSearch("s2", "Not printed", "-status:printed");
  const merged = (migration: RenameMigration, overrides: Partial<RenamePreview> = {}) =>
    ready(makePreview({ destinationExists: true, savedSearchUpdateCount: migration.replacements.length, ...overrides }), migration);
  const migrationFor = (mapping: RenameMapping, query: string, searches: SavedSearch[]) =>
    deriveRenameMigration({ libraryId: "lib-1", activeFilters: filters(query), savedSearches: searches, mapping });
  const review = () => screen.getByRole("region", { name: "Rename preview" });
  const confirmation = () => screen.getByRole("region", { name: "Confirm rename" });
  const MEANING = /will match differently after this merge/;

  async function previewPrefix(result: RenamePreviewResult): Promise<void> {
    renderDialog({ mode: "prefix", source: "status", onPreview: vi.fn(async () => result) });
    typeDestination("state");
    await click("Preview");
  }

  it("tells an exact-mode user that a migrated search now also matches rows already using the destination", async () => {
    await previewReady({}, merged(migrationFor(exactMapping, "", [printed])));
    expect(review().textContent).toMatch(/The saved searches that this rename updates will match differently after this merge\./);
    expect(review().textContent).toContain('A term "status:printed" becomes "state:printed", so it will now also match rows that already used "state:printed".');
    await click("Review rename");
    expect(confirmation().textContent).toMatch(MEANING);
    expect(confirmation().textContent).toContain('A term "status:printed" becomes "state:printed", so it will now also match rows that already used "state:printed".');
  });

  it("tells a user that an excluded term now also excludes rows already using the destination", async () => {
    await previewReady({}, merged(migrationFor(exactMapping, "", [notPrinted])));
    const sentence = 'An excluded term "-status:printed" becomes "-state:printed", so it will now also exclude rows that already used "state:printed".';
    expect(review().textContent).toContain(sentence);
    expect(review().textContent).not.toContain('A term "');
    await click("Review rename");
    expect(confirmation().textContent).toContain(sentence);
    expect(confirmation().textContent).not.toContain('A term "');
  });

  it("covers both a required and an excluded term, and names the active query when it is migrated too", async () => {
    await previewReady({}, merged(migrationFor(exactMapping, "status:printed", [printed, notPrinted])));
    expect(review().textContent).toMatch(/The saved searches and the active query that this rename updates will match differently after this merge\./);
    expect(review().textContent).toContain('A term "status:printed" becomes "state:printed"');
    expect(review().textContent).toContain('An excluded term "-status:printed" becomes "-state:printed"');
  });

  it("discloses it for an active query alone", async () => {
    await previewReady({}, merged(migrationFor(exactMapping, "-status:printed", [])));
    expect(review().textContent).toMatch(/The active query that this rename updates will match differently after this merge\./);
    expect(review().textContent).toContain('An excluded term "-status:printed" becomes "-state:printed"');
  });

  it("uses the user's own prefix rename for a required and an excluded term", async () => {
    const queued = savedSearch("s3", "Not queued", "-status:queued");
    await previewPrefix(merged(migrationFor(prefixMapping, "", [printed, queued]), { mapping: prefixMapping }));
    expect(review().textContent).toMatch(MEANING);
    expect(review().textContent).toContain('A term "status:printed" becomes "state:printed", so it will now also match rows that already used "state:printed".');
    expect(review().textContent).toContain('An excluded term "-status:queued" becomes "-state:queued", so it will now also exclude rows that already used "state:queued".');
    await click("Review rename");
    expect(confirmation().textContent).toContain('An excluded term "-status:queued" becomes "-state:queued", so it will now also exclude rows that already used "state:queued".');
  });

  it("does not say it when the destination does not exist, even though searches are migrated", async () => {
    await previewReady({}, merged(migrationFor(exactMapping, "status:printed", [printed, notPrinted]), { destinationExists: false }));
    expect(screen.getByText("Printed models")).toBeTruthy();
    expect(review().textContent).not.toMatch(MEANING);
    await click("Review rename");
    expect(confirmation().textContent).not.toMatch(MEANING);
  });

  it("does not say it when nothing is being migrated, even though the destination exists", async () => {
    await previewReady({}, merged(migrationFor(exactMapping, "favorite", [savedSearch("s4", "Favorites", "favorite")])));
    expect(screen.getByText(/The destination tag "state:printed" already exists/)).toBeTruthy();
    expect(review().textContent).not.toMatch(MEANING);
    await click("Review rename");
    expect(confirmation().textContent).not.toMatch(MEANING);
  });

  it("does not say it for a prefix rename that migrates nothing", async () => {
    await previewPrefix(merged(migrationFor(prefixMapping, "favorite", []), { mapping: prefixMapping }));
    expect(review().textContent).not.toMatch(MEANING);
  });
});

describe("TagRenameDialog backdrop dismissal", () => {
  const backdrop = (): HTMLElement => screen.getByRole("dialog").parentElement!;

  it("closes on a backdrop press while idle", () => {
    const { props } = renderDialog();
    fireEvent.mouseDown(backdrop());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("ignores a press inside the dialog while idle", () => {
    const { props } = renderDialog();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("ignores a backdrop press during a preview and keeps the draft and the running preview", async () => {
    const pending = deferred<RenamePreviewResult>();
    const view = renderDialog({ onPreview: vi.fn(() => pending.promise) });
    typeDestination("state:printed");
    await click("Preview");
    fireEvent.mouseDown(backdrop());
    expect(view.props.onClose).not.toHaveBeenCalled();
    expect(view.props.onCancelPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(destinationField().value).toBe("state:printed");
    expect(screen.getByRole("button", { name: "Cancel preview" })).toBeTruthy();
    await act(async () => { pending.resolve(ready()); await pending.promise; });
    expect(screen.getByRole("region", { name: "Rename preview" })).toBeTruthy();
    expect(view.props.onClose).not.toHaveBeenCalled();
  });

  it("ignores a backdrop press during an apply and still shows the outcome", async () => {
    const pending = deferred<RenameApplyHookResult>();
    const view = await previewReady({ onApply: vi.fn(() => pending.promise) });
    await click("Review rename");
    await click("Confirm rename");
    fireEvent.mouseDown(backdrop());
    expect(view.props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Applying the rename\. Controls are disabled/)).toBeTruthy();
    await act(async () => { pending.resolve(applied()); await pending.promise; });
    expect(screen.getByRole("heading", { name: "Rename complete" })).toBeTruthy();
    expect(view.props.onClose).not.toHaveBeenCalled();
  });

  it.each([["previewing", { previewing: true }], ["applying", { applying: true }]] as const)("ignores a backdrop press while the host reports %s", (_name, flag) => {
    const { props } = renderDialog(flag);
    fireEvent.mouseDown(backdrop());
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
