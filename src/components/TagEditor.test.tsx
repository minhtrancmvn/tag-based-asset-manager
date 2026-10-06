// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagEditor } from "./TagEditor";

afterEach(cleanup);

function editor(onAdd: (tag: string) => Promise<boolean>, onRemove: (tag: string) => Promise<boolean> = vi.fn(async () => true)) {
  return render(<TagEditor tags={["category:animal"]} availableTags={["category:animal", "style:flexi", "theme:fantasy"]} onAdd={onAdd} onRemove={onRemove} />);
}

describe("TagEditor", () => {
  it("normalizes input and adds on Enter", async () => {
    const onAdd = vi.fn(async (_tag: string) => true);
    editor(onAdd);
    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "  STYLE:Flexi  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("style:flexi");
    await vi.waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("adds typed value on Enter even when matching suggestions exist", async () => {
    const onAdd = vi.fn(async () => true);
    editor(onAdd);
    const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "style:flex" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("style:flex");
    expect(onAdd).not.toHaveBeenCalledWith("style:flexi");
  });

  it("offers existing tags as autocomplete suggestions", () => {
    const onAdd = vi.fn(async () => true);
    editor(onAdd);
    const input = screen.getByRole("combobox", { name: "Add tag" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "theme" } });
    expect(input.getAttribute("list")).toMatch(/^tag-options-/);
    expect(document.querySelector("datalist option[value='theme:fantasy']")).toBeTruthy();
  });

  it("filters by clicking tag label without removing it", () => {
    const onFilter = vi.fn();
    render(<TagEditor tags={["category:animal"]} availableTags={[]} onFilter={onFilter} onAdd={vi.fn(async () => true)} onRemove={vi.fn(async () => true)} />);
    fireEvent.click(screen.getByRole("button", { name: "category:animal" }));
    expect(onFilter).toHaveBeenCalledWith("category:animal");
  });

  it("removes tag via chip remove control", () => {
    const onRemove = vi.fn(async () => true);
    render(<TagEditor tags={["category:animal"]} availableTags={[]} onAdd={vi.fn(async () => true)} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag category:animal" }));
    expect(onRemove).toHaveBeenCalledWith("category:animal");
  });

  it("keeps input text when add fails and clears only on success", async () => {
    const onAdd = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    editor(onAdd);
    const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: " new-tag " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(input.value).toBe(" new-tag ");
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(input.value).toBe(""));
  });

  it("ignores repeated Enter while an add is pending", async () => {
    let resolveAdd: ((success: boolean) => void) | undefined;
    const onAdd = vi.fn(() => new Promise<boolean>((resolve) => { resolveAdd = resolve; }));
    editor(onAdd);
    const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "theme:fantasy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledTimes(1);
    resolveAdd?.(true);
    await vi.waitFor(() => expect(input.value).toBe(""));
  });

  it("does not clear input optimistically before edit promise resolves", async () => {
    let resolveAdd: ((success: boolean) => void) | undefined;
    const onAdd = vi.fn(() => new Promise<boolean>((resolve) => { resolveAdd = resolve; }));
    editor(onAdd);
    const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Add tag" });
    fireEvent.change(input, { target: { value: "theme:fantasy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("theme:fantasy");
    resolveAdd?.(true);
    await vi.waitFor(() => expect(input.value).toBe(""));
  });

  it("prevents add and remove while disabled or busy", () => {
    const onAdd = vi.fn(async () => true);
    const onRemove = vi.fn(async () => true);
    render(<TagEditor tags={["category:animal"]} availableTags={[]} disabled busy onAdd={onAdd} onRemove={onRemove} />);
    expect((screen.getByRole("combobox", { name: "Add tag" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove tag category:animal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag category:animal" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
