// Generates the flat theme palettes from one hue per theme (OKLCH), fitting every text and mark role to its contrast floor.
//   node scripts/generate-theme-palettes.mjs
// Writes docs/design/theme-palettes.json and prints the `themePalettes` entries for src/themes.ts, then a contrast report.
// src/themes.test.ts requires src/themes.ts to match the JSON exactly.
import { writeFileSync } from 'node:fs';
const rad = (d) => d * Math.PI / 180;
function toRgb(L, C, h) {
  const a = C * Math.cos(rad(h)), b = C * Math.sin(rad(h));
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
function hex(L, C, h) {
  let c = C; let rgb = toRgb(L, c, h);
  while (!inGamut(rgb) && c > 0) { c = Math.max(0, c - 0.002); rgb = toRgb(L, c, h); }
  const enc = (v) => { v = Math.min(1, Math.max(0, v)); const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(s * 255).toString(16).padStart(2, '0').toUpperCase(); };
  return '#' + rgb.map(enc).join('');
}
function lum(h) { const c = h.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Move L away from the backgrounds until every pair reaches `ratio`.
function fit(L, C, h, bgs, ratio, dir) {
  let l = L; let c = hex(l, C, h);
  for (let i = 0; i < 400 && bgs.some((bg) => cr(c, bg) < ratio); i++) { l += dir * 0.0025; c = hex(l, C, h); }
  return c;
}
const ERR_L = { bg: [0.966, 0.022, 25], ink: [0.43, 0.13, 27], line: [0.56, 0.16, 27] };
const OK_L = { bg: [0.962, 0.03, 152], ink: [0.43, 0.09, 152] };
const ERR_D = { bg: [0.285, 0.045, 25], ink: [0.87, 0.07, 25], line: [0.7, 0.14, 25] };
const OK_D = { bg: [0.285, 0.035, 152], ink: [0.87, 0.07, 152] };

// id, label, mode, frame hue, frame chroma, accent hue, accent chroma
const specs = [
  ['workshop', 'Workshop', 'light', 135, 0.014, 152, 0.085],
  ['coral', 'Coral', 'light', 35, 0.016, 28, 0.15],
  ['lavender', 'Lavender', 'light', 300, 0.016, 298, 0.12],
  ['ocean', 'Ocean', 'light', 225, 0.014, 232, 0.1],
  ['mint', 'Mint', 'light', 170, 0.016, 168, 0.09],
  ['sunset', 'Sunset', 'light', 55, 0.018, 48, 0.14],
  ['stone', 'Stone', 'light', 80, 0.008, 70, 0.025],
  ['midnight', 'Midnight', 'dark', 245, 0.014, 215, 0.075],
  ['rose', 'Rose', 'light', 355, 0.016, 358, 0.13],
  ['peach', 'Peach', 'light', 50, 0.022, 38, 0.1],
  ['ember', 'Ember', 'dark', 40, 0.012, 45, 0.11],
  ['amber', 'Amber', 'light', 85, 0.022, 75, 0.11],
  ['meadow', 'Meadow', 'light', 125, 0.02, 132, 0.11],
  ['lagoon', 'Lagoon', 'light', 190, 0.016, 188, 0.09],
  ['glacier', 'Glacier', 'light', 220, 0.012, 228, 0.07],
  ['sky', 'Sky', 'light', 240, 0.018, 245, 0.13],
  ['cobalt', 'Cobalt', 'dark', 258, 0.016, 258, 0.11],
  ['iris', 'Iris', 'dark', 295, 0.016, 298, 0.11],
  ['plum', 'Plum', 'dark', 340, 0.014, 345, 0.1],
  ['aurora', 'Aurora', 'dark', 185, 0.014, 170, 0.1],
];
const report = [];
const result = specs.map(([id, label, mode, h, t, ah, ac]) => {
  let p;
  if (mode === 'light') {
    const floor = hex(0.955, t, h), paper = hex(0.994, t * 0.2, h), panel = hex(0.976, t * 0.45, h), raised = hex(0.998, t * 0.1, h);
    const sidebarActive = hex(0.912, t * 1.15, h), rowHover = hex(0.975, t * 0.55, h);
    const accentSoft = hex(0.94, Math.min(0.035, ac * 0.3), ah), selection = hex(0.928, Math.min(0.045, ac * 0.38), ah);
    const tag = hex(0.942, Math.min(0.03, ac * 0.26), ah);
    const disabled = hex(0.925, t * 0.4, h);
    const surfaces = [floor, paper, panel, raised, sidebarActive, rowHover, accentSoft, selection, disabled];
    const ink = fit(0.25, 0.014, h, surfaces, 11, -1);
    const muted = fit(0.5, 0.016, h, surfaces, 4.8, -1);
    const accent = fit(0.56, ac, ah, ['#FFFFFF', floor, selection, accentSoft], 4.6, -1);
    p = {
      label, floor, paper, panel, raised, ink, muted, line: hex(0.895, t * 0.7, h),
      control: fit(0.7, t, h, [paper, floor, panel, '#FFFFFF'], 3, -1),
      accent, accentInk: '#FFFFFF', accentSoft, focus: accent,
      active: sidebarActive, rowHover, selection, selectionInk: ink,
      tag, tagInk: fit(0.38, Math.min(0.07, ac * 0.6), ah, [tag, paper], 7, -1),
      error: hex(...ERR_L.bg), errorInk: fit(...ERR_L.ink, [hex(...ERR_L.bg), paper, floor], 6, -1), errorLine: hex(...ERR_L.line),
      success: hex(...OK_L.bg), successInk: fit(...OK_L.ink, [hex(...OK_L.bg), paper, floor], 6, -1),
      input: hex(0.999, 0, h), disabled, disabledInk: fit(0.52, t * 0.5, h, [disabled], 4.6, -1),
    };
  } else {
    const floor = hex(0.185, t, h), paper = hex(0.222, t, h), panel = hex(0.245, t, h), raised = hex(0.262, t * 1.1, h);
    const sidebarActive = hex(0.27, t * 1.3, h), rowHover = hex(0.252, t, h);
    const accentSoft = hex(0.305, Math.min(0.045, ac * 0.4), ah), selection = hex(0.315, Math.min(0.055, ac * 0.5), ah);
    const tag = hex(0.3, Math.min(0.04, ac * 0.36), ah);
    const disabled = hex(0.29, t, h);
    const surfaces = [floor, paper, panel, raised, sidebarActive, rowHover, accentSoft, selection, disabled];
    const ink = fit(0.95, 0.008, h, surfaces, 11, 1);
    const muted = fit(0.76, 0.014, h, surfaces, 4.8, 1);
    const accentInk = hex(0.2, 0.02, ah);
    const accent = fit(0.78, ac, ah, [accentInk, floor, paper, selection], 4.8, 1);
    p = {
      label, floor, paper, panel, raised, ink, muted, line: hex(0.33, t * 1.2, h),
      control: fit(0.45, t, h, [paper, floor, panel, raised, hex(0.205, t, h)], 3, 1),
      accent, accentInk, accentSoft, focus: accent,
      active: sidebarActive, rowHover, selection, selectionInk: ink,
      tag, tagInk: fit(0.88, Math.min(0.06, ac * 0.5), ah, [tag, paper], 7, 1),
      error: hex(...ERR_D.bg), errorInk: fit(...ERR_D.ink, [hex(...ERR_D.bg), paper, floor], 6, 1), errorLine: hex(...ERR_D.line),
      success: hex(...OK_D.bg), successInk: fit(...OK_D.ink, [hex(...OK_D.bg), paper, floor], 6, 1),
      input: hex(0.205, t, h), disabled, disabledInk: fit(0.72, t, h, [disabled], 4.6, 1),
    };
  }
  report.push(`${id.padEnd(9)} ink/floor ${cr(p.ink, p.floor).toFixed(1)} muted/sel ${cr(p.muted, p.selection).toFixed(2)} muted/act ${cr(p.muted, p.active).toFixed(2)} ctl/paper ${cr(p.control, p.paper).toFixed(2)} ctl/floor ${cr(p.control, p.floor).toFixed(2)} accent/ink ${cr(p.accent, p.accentInk).toFixed(2)} accent/floor ${cr(p.accent, p.floor).toFixed(2)} accent/sel ${cr(p.accent, p.selection).toFixed(2)} sel/paper ${cr(p.selection, p.paper).toFixed(2)} line/paper ${cr(p.line, p.paper).toFixed(2)} tag ${cr(p.tagInk, p.tag).toFixed(1)} succ/paper ${cr(p.successInk, p.paper).toFixed(1)} err/paper ${cr(p.errorInk, p.paper).toFixed(1)}`);
  return { id, label, mode, palette: p };
});
writeFileSync(new URL('../docs/design/theme-palettes.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(result.map(({ id, palette }) => `  ${id}: {\n    ${Object.entries(palette).map(([k, v]) => `${k}: "${v}"`).join(', ')},\n  },`).join('\n'));
console.error(report.join('\n'));
