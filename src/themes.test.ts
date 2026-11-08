import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeAppearance, themeCssVariables, themeOptions, themePalettes, type AppTheme, type ThemePalette } from "./themes";

const themes: readonly AppTheme[] = ["workshop", "coral", "lavender", "ocean", "mint", "sunset", "stone", "midnight", "rose", "peach", "ember", "amber", "meadow", "lagoon", "glacier", "sky", "cobalt", "iris", "plum", "aurora"];
const lightThemes: readonly AppTheme[] = ["workshop", "coral", "lavender", "ocean", "mint", "sunset", "stone", "rose", "peach", "amber", "meadow", "lagoon", "glacier", "sky"];
const darkThemes: readonly AppTheme[] = ["midnight", "ember", "cobalt", "iris", "plum", "aurora"];
const HEX_COLOR = /^#[\da-f]{6}$/i;
type Role = Exclude<keyof ThemePalette, "label">;
const roles = Object.keys(themePalettes.workshop).filter((key) => key !== "label") as Role[];
const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");

function channels(hex: string): number[] {
  return hex.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16) / 255) ?? [];
}

function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/** OKLCH chroma of an sRGB hex colour: how far it sits from grey. */
function chroma(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return Math.hypot(a, bb);
}

function assertPair(palette: ThemePalette, foreground: Role, background: Role, ratio: number): void {
  expect(contrast(palette[foreground], palette[background]), `${palette.label}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(ratio);
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`(?:^|\\n|\\}\\s*)${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  expect(body, `App.css rule ${selector}`).toBeDefined();
  return body ?? "";
}

describe("theme palettes", () => {
  it("defines exactly twenty options with matching palettes and expected mode counts", () => {
    expect(themeOptions.map(({ value }) => value)).toEqual(themes);
    expect(Object.keys(themePalettes).sort()).toEqual([...themes].sort());
    expect(Object.keys(themeAppearance).sort()).toEqual([...themes].sort());
    expect(lightThemes).toHaveLength(14);
    expect(darkThemes).toHaveLength(6);
    for (const theme of themes) expect(themeAppearance[theme].mode, theme).toBe(darkThemes.includes(theme) ? "dark" : "light");
    for (const { value, label } of themeOptions) expect(themePalettes[value].label).toBe(label);
  });

  it("matches every complete palette to the approved palette artifact", () => {
    const approved: unknown = JSON.parse(readFileSync(new URL("../docs/design/theme-palettes.json", import.meta.url), "utf8"));
    if (!Array.isArray(approved)) throw new Error("Approved theme palette artifact must contain an array.");
    const approvedThemes = approved as { id: AppTheme; mode: string; palette: ThemePalette }[];
    expect(approvedThemes.map(({ id }) => id)).toEqual(themes);
    for (const { id, mode, palette } of approvedThemes) {
      expect(themePalettes[id], `${id} palette must match approved artifact`).toEqual(palette);
      expect(themeAppearance[id].mode).toBe(mode);
    }
  });

  it("keeps every colour role an opaque hex value", () => {
    for (const theme of themes) {
      for (const role of roles) expect(themePalettes[theme][role], `${theme}: ${role}`).toMatch(HEX_COLOR);
    }
  });

  it("keeps the frame and sheet quiet so the accent carries the theme", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      for (const role of ["floor", "paper", "panel", "raised", "active", "rowHover", "input", "line"] as const) {
        expect(chroma(palette[role]), `${theme}: ${role} chroma`).toBeLessThanOrEqual(0.03);
      }
      // Elevation by lightness: the sheet is lighter than the frame in both modes.
      expect(luminance(palette.paper), `${theme}: sheet lighter than frame`).toBeGreaterThan(luminance(palette.floor));
      expect(chroma(palette.accent), `${theme}: accent carries the hue`).toBeGreaterThan(chroma(palette.floor));
    }
  });

  it("keeps all running text readable on every surface it sits on", () => {
    const surfaces: Role[] = ["floor", "paper", "panel", "raised", "active", "rowHover", "selection", "accentSoft", "input"];
    for (const theme of themes) {
      const palette = themePalettes[theme];
      for (const surface of surfaces) {
        assertPair(palette, "ink", surface, 7);
        assertPair(palette, "muted", surface, 4.5);
      }
      assertPair(palette, "selectionInk", "selection", 4.5);
      assertPair(palette, "tagInk", "tag", 4.5);
      assertPair(palette, "tagInk", "paper", 4.5);
      for (const surface of ["error", "paper", "floor", "raised"] as const) assertPair(palette, "errorInk", surface, 4.5);
      for (const surface of ["success", "paper", "floor"] as const) assertPair(palette, "successInk", surface, 4.5);
      assertPair(palette, "disabledInk", "disabled", 4.5);
      assertPair(palette, "accentInk", "accent", 4.5);
    }
  });

  it("keeps bullets, markers, focus rings and control edges at 3:1 against their surfaces", () => {
    for (const theme of themes) {
      const palette = themePalettes[theme];
      // Group bullets sit on the frame and the active pill; the selection marker sits beside selected rows.
      for (const surface of ["floor", "active", "paper", "selection", "accentSoft"] as const) assertPair(palette, "accent", surface, 3);
      for (const surface of ["floor", "paper", "selection", "accentSoft"] as const) assertPair(palette, "focus", surface, 3);
      // The ready dot and the local-files dot use the success ink on the sheet, rows and frame.
      for (const surface of ["paper", "rowHover", "selection", "floor"] as const) assertPair(palette, "successInk", surface, 3);
      for (const surface of ["paper", "floor", "input", "raised"] as const) assertPair(palette, "control", surface, 3);
      assertPair(palette, "errorLine", "paper", 3);
      expect(contrast(palette.selection, palette.paper), `${theme}: selection distinct from sheet`).toBeGreaterThanOrEqual(1.15);
    }
  });

  it("exports complete theme variables for document-level portal inheritance", () => {
    const names: Partial<Record<Role, string>> = { tag: "--tag-bg", error: "--error-bg", success: "--success-bg", input: "--input-bg", disabled: "--disabled-bg" };
    for (const theme of themes) {
      const variables = themeCssVariables(theme);
      const palette = themePalettes[theme];
      for (const role of roles) {
        const name = names[role] ?? `--${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
        expect(variables[name as `--${string}`], `${theme}: ${name}`).toBe(palette[role]);
        expect(css, `App.css declares a default for ${name}`).toContain(`${name}:`);
      }
      expect(variables["--theme-mode"]).toBe(themeAppearance[theme].mode);
    }
  });
});

describe("theme styling", () => {
  it("paints no gradients anywhere in the app", () => {
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient/);
    expect(readFileSync(new URL("./components/ThemeSettings.tsx", import.meta.url), "utf8")).not.toMatch(/gradient/i);
  });

  it("fills the primary action with the flat accent and clears it when disabled", () => {
    const primary = rule(".primary-button");
    expect(primary).toContain("background: var(--accent)");
    expect(primary).toContain("color: var(--accent-ink)");
    const disabled = rule(".primary-button:disabled");
    expect(disabled).toContain("background: var(--disabled-bg)");
    expect(disabled).toContain("color: var(--disabled-ink)");
    expect(css).toMatch(/\.attention-banner[^{]*\{[^}]*background: var\(--error-bg\)/);
  });

  it("draws bullets and status dots in tested colours, never in the surface colour", () => {
    expect(rule(".group-swatch")).toContain("background: var(--accent)");
    expect(rule(".status-dot")).toContain("background: var(--success-ink)");
    expect(rule(".offline-dot")).toContain("background: var(--success-ink)");
    expect(css).not.toMatch(/(?:dot|swatch)[^{]*\{[^}]*background: var\(--(?:paper|floor|panel)\)/);
  });

  it("keeps a disabled search input inside its existing field surface", () => {
    const disabledSearch = rule(".search-field input:disabled");
    expect(disabledSearch).toContain("background: transparent");
    expect(disabledSearch).toContain("color: var(--muted)");
  });
});
