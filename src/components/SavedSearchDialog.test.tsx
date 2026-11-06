// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SavedSearchDialog } from "./SavedSearchDialog";
import type { SavedSearch, SearchFilters } from "../types";

afterEach(cleanup);

const filters: SearchFilters = { query: "category:gear style:flexi", view: "all", matchMode: "any", kind: "folder" };
const saved: SavedSearch = { id: "search-1", libraryId: "library-1", name: "Gear folders", filters };

function setup(searches: SavedSearch[] = []) {
  const onSave = vi.fn(async () => true);
  const onDelete = vi.fn(async () => true);
  render(<SavedSearchDialog filters={filters} searches={searches} busy={false} onCancel={vi.fn()} onSave={onSave} onDelete={onDelete} />);
  return { onSave, onDelete };
}

describe("SavedSearchDialog", () => {
  it("creates named search with full current filters", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Search name" }), { target: { value: "  Gear folders  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    expect(onSave).toHaveBeenCalledWith("Gear folders", filters);
    expect(screen.getByText("Tag matching: Any required tag")).toBeTruthy();
    expect(screen.getByText("Kind: folders only")).toBeTruthy();
  });

  it("does not mark identical filters changed merely because JSON key order differs", () => {
    const reordered: SearchFilters = { kind: filters.kind, matchMode: filters.matchMode, view: filters.view, query: filters.query };
    setup([{ ...saved, filters: reordered }]);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Update search" }).disabled).toBe(true);
  });
  it("requires explicit update or rename and preserves stored filters for rename", async () => {
    const { onSave } = setup([saved]);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    expect((screen.getByRole("button", { name: "Update search" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Search name" }), { target: { value: "Renamed folders" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename search" }));
    expect(onSave).toHaveBeenCalledWith("Renamed folders", saved.filters, saved.id);
  });

  it("renames only the selected search and keeps original filters", () => {
    const { onSave } = setup([saved]);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search name" }), { target: { value: "Renamed Gear" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename search" }));
    expect(onSave).toHaveBeenCalledWith("Renamed Gear", saved.filters, saved.id);
  });

  it("cancels delete in-app and keeps duplicate names from silently overwriting", () => {
    const { onSave, onDelete } = setup([saved]);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(screen.getByText(/Delete saved search “Gear folders”\? This will not change files or metadata\./)).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep search" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Existing saved search" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep search" }));
    expect(screen.queryByRole("button", { name: "Delete search" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Delete search" })).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search name" }), { target: { value: saved.name } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("deletes a search only after the in-app second step, never through window.confirm", async () => {
    // tauri-plugin-dialog replaces window.confirm with an async function, so a synchronous caller always sees a truthy Promise.
    const confirm = vi.spyOn(window, "confirm").mockImplementation((() => Promise.resolve(false)) as unknown as typeof window.confirm);
    const { onDelete } = setup([saved]);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete search" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(saved));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("keeps the search selected and reports a failed delete", async () => {
    const onDelete = vi.fn(async () => false);
    render(<SavedSearchDialog filters={filters} searches={[saved]} busy={false} onCancel={vi.fn()} onSave={vi.fn(async () => true)} onDelete={onDelete} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete search" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Search was not deleted");
    expect(screen.queryByRole("button", { name: "Delete search" })).toBeNull();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Existing saved search" }).value).toBe(saved.id);
  });

  it("keeps dialog and draft on failed save", async () => {
    const onSave = vi.fn(async () => false);
    render(<SavedSearchDialog filters={filters} searches={[]} busy={false} onCancel={vi.fn()} onSave={onSave} onDelete={vi.fn(async () => false)} />);
    const input = screen.getByRole("textbox", { name: "Search name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Gear folders" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(input.value).toBe("Gear folders");
  });
});
