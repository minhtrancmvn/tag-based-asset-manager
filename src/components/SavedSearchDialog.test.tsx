// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("confirms delete and keeps duplicate names from silently overwriting", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onSave, onDelete } = setup([saved]);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(confirm).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search name" }), { target: { value: saved.name } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    expect(onSave).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("requires user confirmation before deleting a search", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDelete } = setup([saved]);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing saved search" }), { target: { value: saved.id } });
    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Gear folders"));
    expect(onDelete).toHaveBeenCalledWith(saved);
    confirm.mockRestore();
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
