// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeSettings } from "./ThemeSettings";

afterEach(() => document.body.replaceChildren());

describe("ThemeSettings", () => {
  it("shows all named palettes in a labeled, disabled-while-busy selector", () => {
    const onThemeChange = vi.fn();
    render(<ThemeSettings theme="workshop" saving={true} disabled={false} onThemeChange={onThemeChange} />);
    const selector = screen.getByRole("combobox", { name: "Color theme" });
    expect((selector as HTMLSelectElement).value).toBe("workshop");
    expect([...selector.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "workshop", "coral", "lavender", "ocean", "mint", "sunset", "stone", "midnight",
    ]);
    expect((selector as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/saving/i);
  });

  it("requests selected palette without changing committed selection locally", () => {
    const onThemeChange = vi.fn();
    render(<ThemeSettings theme="workshop" saving={false} disabled={false} onThemeChange={onThemeChange} />);
    const selector = screen.getByRole<HTMLSelectElement>("combobox", { name: "Color theme" });
    fireEvent.change(selector, { target: { value: "ocean" } });
    expect(onThemeChange).toHaveBeenCalledWith("ocean");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Color theme" }).value).toBe("workshop");
  });
});
