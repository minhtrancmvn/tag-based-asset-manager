// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibrarySummary } from "../types";
import { LibraryPicker } from "./LibraryPicker";

afterEach(cleanup);

const libraries: LibrarySummary[] = [
  { id: "a", name: "Workshop", rootPath: "/Users/me/Workshop", assetCount: 3, lastScanAt: null },
  { id: "b", name: "Archive", rootPath: "/Users/me/Archive", assetCount: 1, lastScanAt: null },
  { id: "c", name: "Prints", rootPath: "/Users/me/Prints", assetCount: 0, lastScanAt: null },
];

function renderPicker(overrides: Partial<Parameters<typeof LibraryPicker>[0]> = {}) {
  const onActivate = vi.fn();
  const onChoose = vi.fn();
  const props = { libraries, activeLibraryId: "a", disabled: false, onActivate, onChoose, ...overrides };
  const result = render(<LibraryPicker {...props} />);
  return { ...result, props, onActivate, onChoose, trigger: screen.getByRole<HTMLButtonElement>("combobox", { name: "Active library" }) };
}

describe("LibraryPicker", () => {
  it("offers adding a folder as a separate button, never a library option", () => {
    const { trigger, onActivate, onChoose } = renderPicker();
    trigger.focus();
    expect(screen.queryByRole("button", { name: "Add library folder…" })).toBeNull();
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "Libraries" });
    const add = screen.getByRole("button", { name: "Add library folder…" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(libraries.length);
    expect(listbox.contains(add)).toBe(false);
    fireEvent.pointerDown(add);
    expect(screen.getByRole("listbox", { name: "Libraries" })).toBe(listbox);
    expect(fireEvent.mouseDown(add)).toBe(false);
    expect(document.activeElement).toBe(trigger);
    fireEvent.mouseUp(add);
    fireEvent.click(add);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith();
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.textContent).toContain("Workshop");
  });

  it("reaches the add-folder button with Tab without committing a pending library", () => {
    const { trigger, onActivate, onChoose } = renderPicker();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(fireEvent.keyDown(trigger, { key: "Tab" })).toBe(false);
    const add = screen.getByRole("button", { name: "Add library folder…" });
    expect(document.activeElement).toBe(add);
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false);
    expect(trigger.textContent).toContain("Workshop");
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(add);
    expect(onChoose).toHaveBeenCalledOnce();
  });

  it("returns from the footer with Shift+Tab and dismisses it with Escape", () => {
    const { trigger, onActivate, onChoose } = renderPicker();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "Tab" });
    const add = screen.getByRole("button", { name: "Add library folder…" });
    expect(document.activeElement).toBe(add);
    fireEvent.keyDown(add, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label")).toBe("Workshop /Users/me/Workshop");
    fireEvent.keyDown(trigger, { key: "Tab" });
    fireEvent.keyDown(add, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("keeps the popup open while focusing its footer but closes when focus leaves", () => {
    const { trigger, onChoose } = renderPicker();
    render(<button type="button">Next control</button>);
    trigger.focus();
    fireEvent.click(trigger);
    act(() => screen.getByRole<HTMLButtonElement>("button", { name: "Add library folder…" }).focus());
    expect(screen.getByRole("listbox")).toBeTruthy();
    act(() => screen.getByRole<HTMLButtonElement>("button", { name: "Next control" }).focus());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("lets Tab leave the footer and Shift+Tab leave the trigger without committing", () => {
    const { trigger, onActivate, onChoose } = renderPicker();
    render(<button type="button">Next control</button>);
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Tab" });
    const add = screen.getByRole("button", { name: "Add library folder…" });
    expect(fireEvent.keyDown(add, { key: "Tab" })).toBe(true);
    act(() => screen.getByRole<HTMLButtonElement>("button", { name: "Next control" }).focus());
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(fireEvent.keyDown(trigger, { key: "Tab", shiftKey: true })).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("retains pending library navigation after returning from the footer", () => {
    const { trigger, onActivate, onChoose } = renderPicker();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "a" });
    fireEvent.keyDown(trigger, { key: "Tab" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Add library folder…" }), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(trigger);
    expect(document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "")?.getAttribute("aria-label")).toBe("Archive /Users/me/Archive");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledExactlyOnceWith("b");
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("closes an open footer when busy prevents choosing a folder", () => {
    const { trigger, props, rerender, onChoose } = renderPicker();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Add library folder…" })).toBeTruthy();
    rerender(<LibraryPicker {...props} disabled />);
    expect(trigger.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Add library folder…" })).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("distinguishes duplicate library names by their paths in option names", () => {
    const { trigger } = renderPicker({ libraries: [libraries[0], { ...libraries[1], name: "Workshop" }] });
    expect(screen.getByRole("combobox", { name: "Active library", description: "Workshop /Users/me/Workshop" })).toBe(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Workshop /Users/me/Workshop" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "Workshop /Users/me/Archive" }).getAttribute("aria-selected")).toBe("false");
  });

  it("shows the active library name and path inside the closed box", () => {
    const { trigger } = renderPicker();
    expect(trigger.textContent).toContain("Workshop");
    expect(within(trigger).getByText("/Users/me/Workshop")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens on click, marks the active library and activates another", () => {
    const { trigger, onActivate } = renderPicker();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("option", { name: "Workshop /Users/me/Workshop" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Prints /Users/me/Prints" }));
    expect(onActivate).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("choosing the already active library does not reactivate it", () => {
    const { trigger, onActivate } = renderPicker();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Workshop /Users/me/Workshop" }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("supports the select-only combobox keyboard pattern", () => {
    const { trigger, onActivate } = renderPicker();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox", { name: "Libraries" });
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
    const activeOption = () => document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "");
    expect(activeOption()?.getAttribute("aria-label")).toBe("Workshop /Users/me/Workshop");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(activeOption()?.getAttribute("aria-label")).toBe("Archive /Users/me/Archive");
    fireEvent.keyDown(trigger, { key: "End" });
    expect(activeOption()?.getAttribute("aria-label")).toBe("Prints /Users/me/Prints");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(activeOption()?.getAttribute("aria-label")).toBe("Prints /Users/me/Prints");
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape and outside pointer without choosing", () => {
    const { trigger, onActivate } = renderPicker();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("is disabled while busy or when no library exists", () => {
    const { trigger } = renderPicker({ disabled: true });
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
    cleanup();
    const empty = renderPicker({ libraries: [], activeLibraryId: null });
    expect(empty.trigger.disabled).toBe(true);
    expect(empty.trigger.textContent).toContain("No libraries");
  });

  it("prompts to choose when no library is active", () => {
    const { trigger } = renderPicker({ activeLibraryId: null });
    expect(trigger.textContent).toContain("Choose a library");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option").every((option) => option.getAttribute("aria-selected") === "false")).toBe(true);
  });
});
