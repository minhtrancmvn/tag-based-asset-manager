import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeCssVariables, themeOptions, themePalettes, type AppTheme, type ThemePalette } from "./themes";

const themes: AppTheme[] = ["workshop", "coral", "lavender", "ocean", "mint", "sunset", "stone", "midnight"];

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16) / 255) ?? [];
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

function assertText(palette: ThemePalette, foreground: keyof ThemePalette, background: keyof ThemePalette, ratio = 4.5): void {
  expect(contrast(palette[foreground], palette[background]), `${palette.label}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(ratio);
}

describe("theme palettes", () => {
  it("keeps sidebar texture from drawing false menu separators", () => {
    const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
    const sidebar = css.match(/\.sidebar\s*\{([^}]+)\}/)?.[1];
    expect(sidebar).toBeDefined();
    expect(sidebar).not.toContain("repeating-linear-gradient");
    expect(sidebar).toContain("border-right: 1px solid var(--sidebar-border)");
  });
  it("defines exactly eight options with matching palettes", () => {
    expect(themeOptions.map(({ value }) => value)).toEqual(themes);
    expect(Object.keys(themePalettes).sort()).toEqual([...themes].sort());
  });

  it("meets readable contrast for key surfaces and semantic states", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      assertText(palette, "ink", "paper");
      assertText(palette, "ink", "floor");
      assertText(palette, "muted", "paper");
      assertText(palette, "sidebarText", "sidebar");
      assertText(palette, "sidebarMuted", "sidebar");
      assertText(palette, "sidebarText", "sidebarActive");
      assertText(palette, "selectionInk", "selection");
      assertText(palette, "tagInk", "tag");
      assertText(palette, "errorInk", "error");
      assertText(palette, "successInk", "success");
      assertText(palette, "ink", "input");
      assertText(palette, "disabledInk", "disabled");
      assertText(palette, "accentInk", "accent");
    }
  });

  it("uses distinguishable non-text boundaries and focus indicators", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      expect(contrast(palette.accent, palette.paper), `${theme} accent on paper`).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.focus, palette.paper), `${theme} focus on paper`).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.selection, palette.paper), `${theme} selection against row`).toBeGreaterThanOrEqual(1.15);
    }
  });

  it("exports complete theme variables for document-level portal inheritance", () => {
    for (const theme of themes) {
      const variables = themeCssVariables(theme);
      expect(variables["--floor"]).toBe(themePalettes[theme].floor);
      expect(variables["--sidebar"]).toBe(themePalettes[theme].sidebar);
      expect(variables["--selection"]).toBe(themePalettes[theme].selection);
      expect(variables["--focus"]).toBe(themePalettes[theme].focus);
    }
  });
});
