import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeAppearance, themeCssVariables, themeOptions, themePalettes, type AppTheme, type ThemePalette } from "./themes";

const themes: readonly AppTheme[] = ["workshop", "coral", "lavender", "ocean", "mint", "sunset", "stone", "midnight", "rose", "peach", "ember", "amber", "meadow", "lagoon", "glacier", "sky", "cobalt", "iris", "plum", "aurora"];
const lightThemes: readonly AppTheme[] = ["workshop", "coral", "lavender", "ocean", "mint", "sunset", "stone", "rose", "peach", "amber", "meadow", "lagoon", "glacier", "sky"];
const darkThemes: readonly AppTheme[] = ["midnight", "ember", "cobalt", "iris", "plum", "aurora"];
const HEX_COLOR = /^#[\da-f]{6}$/i;

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
  const foregroundColor = palette[foreground];
  const backgroundColor = palette[background];
  expect(foregroundColor, `${palette.label}: ${foreground} must be opaque hex`).toMatch(HEX_COLOR);
  expect(backgroundColor, `${palette.label}: ${background} must be opaque hex`).toMatch(HEX_COLOR);
  const actualRatio = contrast(foregroundColor, backgroundColor);
  expect(Number.isFinite(actualRatio), `${palette.label}: ${foreground} on ${background} must have finite contrast`).toBe(true);
  expect(actualRatio, `${palette.label}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(ratio);
}

function assertDecorativeColors(palette: ThemePalette, ...roles: (keyof ThemePalette)[]): void {
  for (const role of roles) {
    expect(palette[role], `${palette.label}: ${role} must be an opaque hex color`).toMatch(HEX_COLOR);
  }
}

function gradientStops(gradient: string): string[] {
  const match = gradient.match(/^linear-gradient\(135deg,\s*(.+)\)$/);
  expect(match, `Expected a 135-degree linear gradient, got ${gradient}`).not.toBeNull();
  return match?.[1].split(",").map((stop) => stop.trim()) ?? [];
}

describe("theme palettes", () => {
  it("applies each theme signature to primary action buttons without changing semantic alerts", () => {
    const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
    const primary = css.match(/\.primary-button\s*\{([^}]+)\}/)?.[1];
    expect(primary).toBeDefined();
    expect(primary).toContain("background: var(--theme-primary-gradient)");
    expect(primary).toContain("color: var(--theme-primary-ink)");
    expect(css).toContain("--theme-primary-gradient:");
    for (const theme of themes) {
      const variables = themeCssVariables(theme);
      const stops = gradientStops(variables["--theme-primary-gradient"]);
      expect(stops).toHaveLength(3);
      expect(variables["--theme-primary-ink"]).toMatch(HEX_COLOR);
      for (let segment = 0; segment < stops.length - 1; segment += 1) {
        for (let step = 0; step <= 100; step += 1) {
          expect(contrast(variables["--theme-primary-ink"], interpolateHex(stops[segment], stops[segment + 1], step / 100)), `${theme}: primary gradient text`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    expect(css).toMatch(/\.attention-banner[^\n{]*\{[^}]*background: var\(--error-bg\)/);
  });

  it("retains bright primary signatures when dark text already passes contrast", () => {
    for (const theme of ["coral", "lavender", "mint", "peach", "amber", "glacier", "sky"] as const) {
      expect(themeAppearance[theme].primaryStops).toEqual(themeAppearance[theme].swatchStops);
      expect(themeAppearance[theme].primaryInk).toBe("#101820");
    }
  });

  it("clears primary gradients for disabled actions so disabled text retains contrast", () => {
    const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
    const disabledPrimary = css.match(/\.primary-button:disabled\s*\{([^}]+)\}/)?.[1];
    expect(disabledPrimary).toBeDefined();
    expect(disabledPrimary).toContain("background: var(--disabled-bg)");
    expect(disabledPrimary).toContain("color: var(--disabled-ink)");
  });

  it("keeps a disabled search input inside its existing field surface", () => {
    const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
    const disabledSearch = css.match(/\.search-field input:disabled\s*\{([^}]+)\}/)?.[1];
    expect(disabledSearch).toBeDefined();
    expect(disabledSearch).toContain("background: transparent");
    expect(disabledSearch).toContain("color: var(--muted)");
  });

  it("keeps disabled sidebar controls transparent over their existing surface", () => {
    const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
    const disabledSidebar = css.match(/\.sidebar button:disabled,\s*\.sidebar select:disabled\s*\{([^}]+)\}/)?.[1];
    expect(disabledSidebar).toBeDefined();
    expect(disabledSidebar).toMatch(/background(?:-color)?:\s*transparent/);
    expect(disabledSidebar).not.toMatch(/background(?:-color)?:\s*var\(--(?:sidebar|disabled-bg)\)/);
  });

  it("keeps sidebar texture from drawing false menu separators", () => {
    const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");
    const sidebar = css.match(/\.sidebar\s*\{([^}]+)\}/)?.[1];
    expect(sidebar).toBeDefined();
    expect(sidebar).not.toContain("repeating-linear-gradient");
    expect(sidebar).toContain("border-right: 1px solid var(--sidebar-border)");
  });

  it("defines exactly twenty options with matching palettes and expected mode counts", () => {
    expect(themeOptions.map(({ value }) => value)).toEqual(themes);
    expect(Object.keys(themePalettes).sort()).toEqual([...themes].sort());
    expect(lightThemes).toHaveLength(14);
    expect(darkThemes).toHaveLength(6);
    expect(new Set([...lightThemes, ...darkThemes])).toEqual(new Set(themes));
    expect([...lightThemes, ...darkThemes]).toHaveLength(themes.length);
  });

  it("matches every complete palette to the approved palette artifact", () => {
    const approvedPalettes: unknown = JSON.parse(readFileSync(new URL("../docs/design/gradient-theme-palettes.json", import.meta.url), "utf8"));
    if (!Array.isArray(approvedPalettes)) throw new Error("Approved theme palette artifact must contain an array.");
    const approvedThemes = approvedPalettes as { id: AppTheme; palette: ThemePalette }[];
    expect(approvedThemes.map(({ id }) => id)).toEqual(themes);
    for (const { id, palette } of approvedThemes) {
      expect(themePalettes[id], `${id} palette must match approved artifact`).toEqual(palette);
    }
  });

  it("exposes appearance mode and gradient stops from the single theme appearance source", () => {
    const appearances = themeAppearance as Record<AppTheme, { mode: string; swatchStops: readonly string[]; sidebarStops: readonly string[] }>;
    expect(Object.keys(appearances).sort()).toEqual([...themes].sort());
    for (const theme of themes) {
      const appearance = appearances[theme];
      expect(appearance.mode, `${theme} mode`).toBe(darkThemes.includes(theme) ? "dark" : "light");
      expect(appearance.swatchStops, `${theme} swatch stop count`).toHaveLength(3);
      expect(appearance.sidebarStops, `${theme} sidebar stop count`).toHaveLength(3);
      for (const stop of [...appearance.swatchStops, ...appearance.sidebarStops]) {
        expect(stop, `${theme} gradient stop`).toMatch(HEX_COLOR);
      }
    }
  });

  it("uses saturated sidebar signatures and coordinated active surfaces", () => {
    function saturation(hex: string): number {
      const channels = hex.slice(1).match(/../g)?.map((value) => parseInt(value, 16)) ?? [];
      const maximum = Math.max(...channels);
      return maximum === 0 ? 0 : (maximum - Math.min(...channels)) / maximum;
    }
    for (const theme of themes) {
      const minimum = theme === "stone" ? 0.18 : 0.5;
      for (const stop of themeAppearance[theme].sidebarStops) {
        expect(saturation(stop), `${theme}: sidebar saturation`).toBeGreaterThanOrEqual(minimum);
      }
      expect(saturation(themePalettes[theme].sidebarActive), `${theme}: active sidebar saturation`).toBeGreaterThanOrEqual(minimum);
      expect(themePalettes[theme].sidebar).toBe(themeAppearance[theme].sidebarStops[0]);
    }
  });

  it("keeps sidebar gradient colors readable behind sidebar text", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      const stops = themeAppearance[theme].sidebarStops;
      const samples: string[] = [];
      for (let segment = 0; segment < stops.length - 1; segment += 1) {
        for (let step = 0; step <= 100; step += 1) {
          samples.push(interpolateHex(stops[segment], stops[segment + 1], step / 100));
        }
      }
      for (const color of samples) {
        for (const foreground of ["sidebarText", "sidebarMuted"] as const) {
          const ratio = contrast(palette[foreground], color);
          expect(Number.isFinite(ratio), `${theme}: ${foreground} on ${color} must have finite contrast`).toBe(true);
          expect(ratio, `${theme}: ${foreground} on sidebar gradient ${color}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps all text-role pairs readable across base and elevated surfaces", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      for (const surface of ["paper", "floor", "panel", "raised"] as const) assertText(palette, "ink", surface);
      for (const surface of ["paper", "panel", "tableHeader", "rowHover", "selection", "accentSoft"] as const) assertText(palette, "muted", surface);
      assertText(palette, "ink", "accentSoft");
      assertText(palette, "ink", "input");
    }
  });

  it("keeps selection, tag, error, success, disabled, and accent text readable", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      assertText(palette, "selectionInk", "selection");
      assertText(palette, "sidebarText", "sidebar");
      assertText(palette, "sidebarMuted", "sidebar");
      assertText(palette, "sidebarText", "sidebarActive");
      assertText(palette, "sidebarMuted", "sidebarActive");
      assertText(palette, "tagInk", "tag");
      assertText(palette, "errorInk", "error");
      assertText(palette, "errorInk", "paper");
      assertText(palette, "successInk", "success");
      assertText(palette, "successInk", "paper");
      assertText(palette, "disabledInk", "disabled");
      assertText(palette, "accentInk", "accent");
    }
  });

  it("keeps focus rings distinguishable on paper and selected surfaces", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      assertText(palette, "focus", "paper", 3);
      assertText(palette, "focus", "selection", 3);
      assertText(palette, "focus", "accentSoft", 3);
      assertText(palette, "accent", "paper", 3);
      assertText(palette, "accent", "selection", 3);
      assertText(palette, "selection", "paper", 1.15);
    }
  });

  it("keeps every palette color token valid and every contrast calculation finite", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      for (const [role, color] of Object.entries(palette)) {
        if (role !== "label") expect(color, `${theme}: ${role}`).toMatch(HEX_COLOR);
      }
      for (const foreground of ["ink", "muted", "sidebarText", "sidebarMuted", "selectionInk", "tagInk", "errorInk", "successInk", "disabledInk", "accentInk", "focus"] as const) {
        for (const background of ["floor", "paper", "panel", "raised", "accentSoft", "sidebar", "sidebarActive", "tableHeader", "rowHover", "selection", "tag", "error", "success", "input", "disabled", "accent"] as const) {
          expect(Number.isFinite(contrast(palette[foreground], palette[background])), `${theme}: ${foreground} on ${background}`).toBe(true);
        }
      }
      assertDecorativeColors(palette, "line", "sidebarBorder", "errorLine", "gradient");
    }
  });

  it("exports complete theme variables for document-level portal inheritance", () => {
    for (const theme of themes) {
      const variables = themeCssVariables(theme);
      const palette = themePalettes[theme];
      expect(variables["--floor"]).toBe(palette.floor);
      expect(variables["--paper"]).toBe(palette.paper);
      expect(variables["--panel"]).toBe(palette.panel);
      expect(variables["--raised"]).toBe(palette.raised);
      expect(variables["--ink"]).toBe(palette.ink);
      expect(variables["--muted"]).toBe(palette.muted);
      expect(variables["--input-bg"]).toBe(palette.input);
      expect(variables["--selection"]).toBe(palette.selection);
      expect(variables["--selection-ink"]).toBe(palette.selectionInk);
      expect(variables["--focus"]).toBe(palette.focus);
      expect(variables["--accent-soft"]).toBe(palette.accentSoft);
      expect(variables["--sidebar-text"]).toBe(palette.sidebarText);
      expect(variables["--sidebar-muted"]).toBe(palette.sidebarMuted);
      expect(variables["--sidebar"]).toBe(palette.sidebar);
      expect(variables["--sidebar-active"]).toBe(palette.sidebarActive);
      expect(variables["--table-header"]).toBe(palette.tableHeader);
      expect(variables["--row-hover"]).toBe(palette.rowHover);
      expect(variables["--tag-bg"]).toBe(palette.tag);
      expect(variables["--tag-ink"]).toBe(palette.tagInk);
      expect(variables["--error-bg"]).toBe(palette.error);
      expect(variables["--error-ink"]).toBe(palette.errorInk);
      expect(variables["--success-bg"]).toBe(palette.success);
      expect(variables["--success-ink"]).toBe(palette.successInk);
      expect(variables["--disabled-bg"]).toBe(palette.disabled);
      expect(variables["--disabled-ink"]).toBe(palette.disabledInk);
      expect(variables["--accent"]).toBe(palette.accent);
      expect(variables["--accent-ink"]).toBe(palette.accentInk);
      expect(variables["--theme-gradient"]).toBe(palette.gradient);
      expect(variables["--copper"]).toBe(palette.focus);
      expect(variables["--theme-mode"]).toBe(themeAppearance[theme].mode);
      expect(gradientStops(variables["--theme-swatch-gradient"])).toEqual(themeAppearance[theme].swatchStops);
      expect(gradientStops(variables["--sidebar-gradient"])).toEqual(themeAppearance[theme].sidebarStops);
    }
  });
});

function interpolateHex(start: string, end: string, amount: number): string {
  const startChannels = start.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16)) ?? [];
  const endChannels = end.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16)) ?? [];
  const interpolated = startChannels.map((value, index) => Math.round(value + ((endChannels[index] ?? value) - value) * amount));
  return `#${interpolated.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
