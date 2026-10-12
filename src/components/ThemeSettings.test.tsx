// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppTheme } from "../themes";
import { themeOptions } from "../themes";
import { ThemeSettings } from "./ThemeSettings";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function expectAttribute(element: Element, name: string, value: string): void {
  expect(element.getAttribute(name)).toBe(value);
}

function expectFocused(element: HTMLElement): void {
  expect(document.activeElement).toBe(element);
}

function expectEnabled(element: HTMLButtonElement): void {
  expect(element.disabled).toBe(false);
}

function expectPresent(element: Element | null): void {
  expect(element).not.toBeNull();
}

function setup(overrides: Partial<{
  theme: AppTheme;
  saving: boolean;
  disabled: boolean;
  onThemeChange: (theme: AppTheme) => Promise<boolean>;
}> = {}) {
  const onThemeChange = overrides.onThemeChange ?? vi.fn<(theme: AppTheme) => Promise<boolean>>().mockResolvedValue(true);
  const props = {
    theme: overrides.theme ?? "workshop",
    saving: overrides.saving ?? false,
    disabled: overrides.disabled ?? false,
    onThemeChange,
  };
  const view = render(<ThemeSettings {...props} />);
  return { ...view, onThemeChange, trigger: screen.getByRole("button", { name: "Color theme" }) as HTMLButtonElement };
}

function openPicker(trigger: HTMLElement): HTMLElement {
  fireEvent.click(trigger);
  return screen.getByRole("dialog", { name: "Color theme choices" });
}

function option(dialog: HTMLElement, theme: AppTheme): HTMLElement {
  const label = themeOptions.find((item) => item.value === theme)?.label;
  if (!label) throw new Error(`Missing test theme: ${theme}`);
  return within(dialog).getByRole("button", { name: new RegExp(label, "i") });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ThemeSettings", () => {
  it("opens a responsive popover with all 20 named light and dark palettes", () => {
    const { trigger } = setup();
    expectAttribute(trigger, "aria-expanded", "false");
    const dialog = openPicker(trigger);
    expectAttribute(trigger, "aria-expanded", "true");
    const choices = within(dialog).getAllByRole("button").filter((choice) => choice.classList.contains("theme-option"));
    expect(choices).toHaveLength(20);
    expect(choices.map((choice) => choice.querySelector(".theme-option-name")?.textContent)).toEqual(
      themeOptions.map(({ label }) => label),
    );
    expectAttribute(dialog.querySelector(".theme-grid") as Element, "data-columns", "5");
    expect(within(dialog).getAllByText("Light", { exact: true })).toHaveLength(14);
    expect(within(dialog).getAllByText("Dark", { exact: true })).toHaveLength(6);
    expectAttribute(option(dialog, "workshop"), "aria-pressed", "true");
    expectAttribute(option(dialog, "ocean"), "aria-pressed", "false");
    expectPresent(option(dialog, "workshop").querySelector(".theme-selected-indicator"));
  });

  it("does not persist on open or keyboard focus movement and restores trigger focus on Escape", () => {
    const { trigger, onThemeChange } = setup();
    openPicker(trigger);
    const first = option(screen.getByRole("dialog"), "workshop");
    expectFocused(first);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expectFocused(option(screen.getByRole("dialog"), "coral"));
    fireEvent.keyDown(option(screen.getByRole("dialog"), "coral"), { key: "Home" });
    expectFocused(first);
    fireEvent.keyDown(first, { key: "End" });
    expectFocused(option(screen.getByRole("dialog"), "aurora"));
    expect(onThemeChange).not.toHaveBeenCalled();
    fireEvent.keyDown(option(screen.getByRole("dialog"), "aurora"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expectFocused(trigger);
  });

  it("uses column-aware arrow navigation for narrower grids", () => {
    const { trigger } = setup();
    const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 370 });
    try {
      const dialog = openPicker(trigger);
      expectAttribute(dialog.querySelector(".theme-grid") as Element, "data-columns", "4");
      const first = option(dialog, "workshop");
      fireEvent.keyDown(first, { key: "ArrowDown" });
      expectFocused(option(dialog, "mint"));
      fireEvent.keyDown(option(dialog, "mint"), { key: "ArrowUp" });
      expectFocused(option(dialog, "workshop"));
    } finally {
      if (originalWidth) Object.defineProperty(window, "innerWidth", originalWidth);
      else Reflect.deleteProperty(window, "innerWidth");
    }
  });

  it("does not persist when activating the committed theme", () => {
    const { trigger, onThemeChange } = setup();
    const dialog = openPicker(trigger);
    fireEvent.click(option(dialog, "workshop"));
    expect(onThemeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("disables trigger and choices when parent disables theme setting", () => {
    const { trigger } = setup({ disabled: true });
    expectEnabled(trigger);
    expectAttribute(trigger, "aria-disabled", "true");
    expect(trigger.getAttribute("title")).not.toBeNull();
  });

  it("closes from any focused popover target on Escape", () => {
    const { trigger } = setup();
    const dialog = openPicker(trigger);
    const closeButton = within(dialog).getByRole("button", { name: "Close theme choices" });
    fireEvent.keyDown(closeButton, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expectFocused(trigger);
  });

  it("closes through accessible close button", () => {
    const { trigger } = setup();
    const dialog = openPicker(trigger);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close theme choices" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expectFocused(trigger);
  });

  it("marks a closed saving trigger aria-disabled but keeps it focusable", () => {
    const { trigger } = setup({ saving: true });
    expectEnabled(trigger);
    expectAttribute(trigger, "aria-disabled", "true");
  });

  it("does not open a closed popover while parent reports saving", () => {
    const { trigger } = setup({ saving: true });
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps an open popover dismissible when parent disables setting", () => {
    const onThemeChange = vi.fn<(theme: AppTheme) => Promise<boolean>>().mockResolvedValue(true);
    const view = render(<ThemeSettings theme="workshop" saving={false} disabled={false} onThemeChange={onThemeChange} />);
    const trigger = view.getByRole("button", { name: "Color theme" }) as HTMLButtonElement;
    fireEvent.click(trigger);
    view.rerender(<ThemeSettings theme="workshop" saving={false} disabled={true} onThemeChange={onThemeChange} />);
    expectPresent(screen.getByRole("dialog"));
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps committed theme selected until parent supplies committed value and marks requested choice busy", async () => {
    const request = deferred<boolean>();
    const onThemeChange = vi.fn<(theme: AppTheme) => Promise<boolean>>().mockReturnValue(request.promise);
    const { trigger } = setup({ onThemeChange });
    const dialog = openPicker(trigger);
    fireEvent.click(option(dialog, "ocean"));
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("ocean");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expectEnabled(trigger);
    expectAttribute(option(dialog, "workshop"), "aria-pressed", "true");
    expectPresent(option(dialog, "ocean").querySelector(".theme-pending-indicator"));
    expect(document.activeElement).not.toBe(trigger);
    expectAttribute(trigger, "aria-label", "Color theme");
    expect(trigger.textContent).toContain("Workshop");
    expect(screen.getByRole("status").textContent).toBe("Saving Ocean…");
    expectAttribute(option(dialog, "workshop"), "aria-pressed", "true");
    expectAttribute(option(dialog, "ocean"), "aria-disabled", "true");
    const coral = option(screen.getByRole("dialog"), "coral");
    coral.focus();
    expectFocused(coral);
    fireEvent.click(coral);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expectAttribute(option(dialog, "ocean"), "aria-disabled", "true");
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(false));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByRole("dialog")).toBe(dialog);
    expectAttribute(option(dialog, "ocean"), "aria-disabled", "false");
    expectFocused(coral);
    fireEvent.click(option(dialog, "workshop"));
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("keeps trigger focus after Escape while request pending and prevents reopening", async () => {
    const request = deferred<boolean>();
    const onThemeChange = vi.fn<(theme: AppTheme) => Promise<boolean>>().mockReturnValue(request.promise);
    const { trigger } = setup({ onThemeChange });
    const dialog = openPicker(trigger);
    fireEvent.click(option(dialog, "ocean"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expectFocused(trigger);
    expectAttribute(trigger, "aria-disabled", "true");
    expectEnabled(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: " " });
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(true));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expectFocused(trigger);
    expectAttribute(trigger, "aria-disabled", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("releases local guard on rejection without inventing component error", async () => {
    const onThemeChange = vi.fn<(theme: AppTheme) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("native failure"))
      .mockResolvedValueOnce(true);
    const { trigger } = setup({ onThemeChange });
    const dialog = openPicker(trigger);
    fireEvent.click(option(dialog, "ocean"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(trigger.textContent).toContain("Workshop");
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(option(dialog, "ocean"));
    expect(onThemeChange).toHaveBeenCalledTimes(2);
  });

  it("closes on outside pointer while preserving focus on clicked target", () => {
    const { container, trigger } = setup();
    const external = document.createElement("button");
    external.textContent = "Outside";
    document.body.append(external);
    openPicker(trigger);
    fireEvent.pointerDown(external);
    external.focus();
    expect(screen.queryByRole("dialog")).toBeNull();
    expectFocused(external);
    expectPresent(container.querySelector(".theme-settings"));
  });

  it("closes on Tab leaving the popover without trapping or stealing focus", () => {
    const { trigger } = setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    const dialog = openPicker(trigger);
    const lastChoice = option(dialog, "aurora");
    lastChoice.focus();
    fireEvent.keyDown(lastChoice, { key: "Tab" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    outside.focus();
    fireEvent.focusOut(lastChoice, { relatedTarget: outside });
    expect(screen.queryByRole("dialog")).toBeNull();
    expectFocused(outside);
  });

  it("closes on window scroll but not when scrolling inside popover", () => {
    const { trigger } = setup();
    const dialog = openPicker(trigger);
    fireEvent.scroll(dialog);
    expectPresent(screen.getByRole("dialog"));
    fireEvent.scroll(window);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("positions popover within viewport using bounded geometry", () => {
    const { trigger } = setup();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 780, y: 550, top: 550, right: 820, bottom: 580, left: 780, width: 40, height: 30,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 820 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    const dialog = openPicker(trigger);
    expect(dialog.style.left).toBe("332px");
    expect(dialog.style.top).toBe("282px");
    expect(dialog.style.maxHeight).toBe("584px");
    expectAttribute(dialog.querySelector(".theme-grid") as Element, "data-columns", "5");
  });

  it("keeps native saving and disabling states visible without losing trigger label", () => {
    const { trigger } = setup({ saving: true });
    expectEnabled(trigger);
    expectAttribute(trigger, "aria-disabled", "true");
    expectAttribute(trigger, "aria-label", "Color theme");
    expect(trigger.textContent).toContain("Workshop");
    expect(screen.getByRole("status").textContent).toMatch(/saving/i);
  });
});
