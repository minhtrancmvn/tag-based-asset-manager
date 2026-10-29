// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectMenu } from "./SelectMenu";

afterEach(cleanup);

const options = [
  { value: "all", label: "Files & folders" },
  { value: "file", label: "Files" },
  { value: "folder", label: "Folders" },
];

function renderMenu() {
  const onChange = vi.fn();
  const props = { label: "Asset kind", listLabel: "Asset kinds", className: "filter-menu", options, value: "file", disabled: false, onChange };
  const result = render(<SelectMenu {...props} />);
  return { ...result, props, onChange, trigger: screen.getByRole<HTMLButtonElement>("combobox", { name: "Asset kind" }) };
}

describe("SelectMenu", () => {
  it("exposes the selected value as the combobox description", () => {
    renderMenu();
    expect(screen.getByRole("combobox", { name: "Asset kind", description: "Files" })).toBeTruthy();
  });

  it("shows the committed value until the parent commits a selection", () => {
    const { trigger, onChange, rerender, props } = renderMenu();
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Folders" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("folder");
    expect(trigger.textContent).toBe("Files");
    rerender(<SelectMenu {...props} value="folder" />);
    expect(trigger.textContent).toBe("Folders");
  });

  it("opens at the selected option and supports ArrowUp, Home, End and Space", () => {
    const { trigger, onChange } = renderMenu();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    const active = () => document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "")?.textContent;
    expect(active()).toBe("Files");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(active()).toBe("Files & folders");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(active()).toBe("Files & folders");
    fireEvent.keyDown(trigger, { key: "End" });
    expect(active()).toBe("Folders");
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: " " });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("all");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("finds a typed prefix without committing until Enter", () => {
    const { trigger, onChange } = renderMenu();
    trigger.focus();
    for (const key of "Fol") fireEvent.keyDown(trigger, { key });
    expect(document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "")?.textContent).toBe("Folders");
    expect(document.activeElement).toBe(trigger);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("folder");
  });

  it("cycles repeated letters and resets the prefix after dismissal", () => {
    const { trigger, onChange } = renderMenu();
    fireEvent.click(trigger);
    const active = () => document.getElementById(trigger.getAttribute("aria-activedescendant") ?? "")?.textContent;
    fireEvent.keyDown(trigger, { key: "f" });
    expect(active()).toBe("Folders");
    fireEvent.keyDown(trigger, { key: "f" });
    expect(active()).toBe("Files & folders");
    fireEvent.keyDown(trigger, { key: "Escape" });
    fireEvent.keyDown(trigger, { key: "o" });
    expect(onChange).not.toHaveBeenCalled();
    expect(active()).toBe("Files");
  });

  it("closes on Tab without preventing focus navigation or changing the value", () => {
    const { trigger, onChange } = renderMenu();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(fireEvent.keyDown(trigger, { key: "Tab" })).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes an open list when it becomes disabled", () => {
    const { trigger, rerender, props, onChange } = renderMenu();
    fireEvent.click(trigger);
    rerender(<SelectMenu {...props} disabled />);
    expect(trigger.disabled).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps two menus independent and dismisses the previous list on outside pointer", () => {
    const { trigger, props, onChange } = renderMenu();
    render(<SelectMenu {...props} label="Required tag match" listLabel="Required tag matching" />);
    const second = screen.getByRole("combobox", { name: "Required tag match" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(second);
    fireEvent.click(second);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
