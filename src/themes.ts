export type AppTheme = "workshop" | "coral" | "lavender" | "ocean" | "mint" | "sunset" | "stone" | "midnight" | "rose" | "peach" | "ember" | "amber" | "meadow" | "lagoon" | "glacier" | "sky" | "cobalt" | "iris" | "plum" | "aurora";

/**
 * Flat theme roles. Every theme is one hue: a low-chroma frame (sidebar, top bar, details rail), a near-white or
 * near-black sheet for the catalog, and the hue at full strength only on the accent. No gradients.
 */
export interface ThemePalette {
  label: string;
  /** Frame ground shared by the sidebar, top bar and details rail. */
  floor: string;
  /** The sheet the catalog sits on. */
  paper: string;
  /** One tone step inside the sheet (wells, review boxes). */
  panel: string;
  /** Menus, popovers and dialogs. */
  raised: string;
  /** Primary text. */
  ink: string;
  /** Secondary text; at least 4.8:1 on every surface role. */
  muted: string;
  /** Hairlines: card edges, row rules, dividers. */
  line: string;
  /** Edges of inputs and outlined controls; at least 3:1 on paper and floor. */
  control: string;
  /** Theme hue: primary action, selection marker, focus, bullets. */
  accent: string;
  /** Text on accent. */
  accentInk: string;
  /** Pale accent tint for notes and review wells. */
  accentSoft: string;
  /** Focus ring. */
  focus: string;
  /** Neutral pill behind the active or hovered navigation item. */
  active: string;
  /** Table row hover. */
  rowHover: string;
  /** Selected rows and menu options. */
  selection: string;
  /** Text on selection. */
  selectionInk: string;
  /** Tag chip fill. */
  tag: string;
  /** Tag chip text. */
  tagInk: string;
  /** Error well. */
  error: string;
  /** Error text. */
  errorInk: string;
  /** Error edges and danger marks. */
  errorLine: string;
  /** Success well. */
  success: string;
  /** Success text and the ready dot. */
  successInk: string;
  /** Text field fill. */
  input: string;
  /** Disabled control fill. */
  disabled: string;
  /** Disabled control text. */
  disabledInk: string;
}

export interface ThemeAppearanceRecord {
  mode: "light" | "dark";
}

export const themeOptions: readonly { value: AppTheme; label: string }[] = [
  { value: "workshop", label: "Workshop" },
  { value: "coral", label: "Coral" },
  { value: "lavender", label: "Lavender" },
  { value: "ocean", label: "Ocean" },
  { value: "mint", label: "Mint" },
  { value: "sunset", label: "Sunset" },
  { value: "stone", label: "Stone" },
  { value: "midnight", label: "Midnight" },
  { value: "rose", label: "Rose" },
  { value: "peach", label: "Peach" },
  { value: "ember", label: "Ember" },
  { value: "amber", label: "Amber" },
  { value: "meadow", label: "Meadow" },
  { value: "lagoon", label: "Lagoon" },
  { value: "glacier", label: "Glacier" },
  { value: "sky", label: "Sky" },
  { value: "cobalt", label: "Cobalt" },
  { value: "iris", label: "Iris" },
  { value: "plum", label: "Plum" },
  { value: "aurora", label: "Aurora" },
];

// Generated from one hue per theme in OKLCH and contrast-fitted; docs/design/theme-palettes.json is the approved copy.
export const themePalettes: Record<AppTheme, ThemePalette> = {
  workshop: {
    label: "Workshop", floor: "#ECF2E9", paper: "#FCFDFC", panel: "#F5F8F4", raised: "#FEFFFE", ink: "#1F231C", muted: "#5C6259", line: "#DADED7", control: "#868C83", accent: "#3B724B", accentInk: "#FFFFFF", accentSoft: "#DFF0E3", focus: "#3B724B", active: "#DDE4DA", rowHover: "#F5F8F3", selection: "#D8EEDD", selectionInk: "#1F231C", tag: "#E2F0E5", tagInk: "#2D4A35", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E5E7E3", disabledInk: "#646763",
  },
  coral: {
    label: "Coral", floor: "#FBEDE9", paper: "#FEFDFC", panel: "#FCF5F4", raised: "#FEFEFE", ink: "#281F1D", muted: "#695D5A", line: "#E4DAD7", control: "#948784", accent: "#B03F35", accentInk: "#FFFFFF", accentSoft: "#FEE4E0", focus: "#B03F35", active: "#EEDEDA", rowHover: "#FDF5F3", selection: "#FEDFDA", selectionInk: "#281F1D", tag: "#FEE5E1", tagInk: "#62332D", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#EAE5E3", disabledInk: "#6A6563",
  },
  lavender: {
    label: "Lavender", floor: "#F1EEFA", paper: "#FDFDFF", panel: "#F8F6FB", raised: "#FEFEFE", ink: "#232027", muted: "#615E68", line: "#DDDBE3", control: "#8C8993", accent: "#7257A4", accentInk: "#FFFFFF", accentSoft: "#EDE7FE", focus: "#7257A4", active: "#E3DFED", rowHover: "#F7F6FC", selection: "#EAE2FF", selectionInk: "#232027", tag: "#EEE8FE", tagInk: "#473A63", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E7E5EA", disabledInk: "#67656A",
  },
  ocean: {
    label: "Ocean", floor: "#E7F2F7", paper: "#FBFDFE", panel: "#F3F8FA", raised: "#FEFEFE", ink: "#1B2327", muted: "#566267", line: "#D6DEE1", control: "#818C90", accent: "#0D6E94", accentInk: "#FFFFFF", accentSoft: "#D8EFFC", focus: "#0D6E94", active: "#D7E4EA", rowHover: "#F2F8FB", selection: "#CFECFD", selectionInk: "#1B2327", tag: "#DBEFFB", tagInk: "#1C485D", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E2E7E9", disabledInk: "#616668",
  },
  mint: {
    label: "Mint", floor: "#E6F4EE", paper: "#FBFEFD", panel: "#F3F9F6", raised: "#FDFFFE", ink: "#1B2421", muted: "#58635F", line: "#D6DFDB", control: "#828E89", accent: "#1F745A", accentInk: "#FFFFFF", accentSoft: "#DBF1E8", focus: "#1F745A", active: "#D7E6E0", rowHover: "#F1F9F6", selection: "#D2EFE3", selectionInk: "#1B2421", tag: "#DEF1E9", tagInk: "#224C3D", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E2E8E5", disabledInk: "#616765",
  },
  sunset: {
    label: "Sunset", floor: "#FAEDE5", paper: "#FEFDFC", panel: "#FCF6F2", raised: "#FEFEFE", ink: "#27201B", muted: "#685E58", line: "#E3DAD5", control: "#948881", accent: "#A74A05", accentInk: "#FFFFFF", accentSoft: "#FFE5D9", focus: "#A74A05", active: "#EDDFD5", rowHover: "#FCF5F1", selection: "#FEE0D1", selectionInk: "#27201B", tag: "#FEE6DB", tagInk: "#60361F", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#EAE5E2", disabledInk: "#6A6561",
  },
  stone: {
    label: "Stone", floor: "#F3F0EA", paper: "#FEFDFC", panel: "#F8F7F4", raised: "#FFFEFE", ink: "#25211A", muted: "#655F56", line: "#DEDCD8", control: "#8D8A85", accent: "#706457", accentInk: "#FFFFFF", accentSoft: "#EEEAE6", focus: "#706457", active: "#E5E1DB", rowHover: "#F8F6F3", selection: "#EBE6E1", selectionInk: "#25211A", tag: "#EFEBE7", tagInk: "#48413A", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E7E6E4", disabledInk: "#676663",
  },
  midnight: {
    label: "Midnight", floor: "#0E1319", paper: "#161C21", panel: "#1B2127", raised: "#1E252C", ink: "#EAEFF4", muted: "#AAB2BA", line: "#2E363E", control: "#676F76", accent: "#7DC4D5", accentInk: "#0B181C", accentSoft: "#1D3339", focus: "#7DC4D5", active: "#1F282F", rowHover: "#1D2329", selection: "#19363D", selectionInk: "#EAEFF4", tag: "#1E3136", tagInk: "#BDDEE7", error: "#3E211F", errorInk: "#FEC4BE", errorLine: "#E97871", success: "#1D2F21", successInk: "#B3E2BE", input: "#12181D", disabled: "#262C32", disabledInk: "#9EA6AD",
  },
  rose: {
    label: "Rose", floor: "#FAECF1", paper: "#FFFCFD", panel: "#FBF5F7", raised: "#FEFEFE", ink: "#271F22", muted: "#685D61", line: "#E3D9DD", control: "#93878B", accent: "#A3456A", accentInk: "#FFFFFF", accentSoft: "#FFE3EB", focus: "#A3456A", active: "#EDDDE2", rowHover: "#FCF4F7", selection: "#FEDDE7", selectionInk: "#271F22", tag: "#FEE4EC", tagInk: "#603142", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#EAE4E6", disabledInk: "#6A6466",
  },
  peach: {
    label: "Peach", floor: "#FDECE3", paper: "#FEFDFC", panel: "#FDF5F1", raised: "#FEFEFE", ink: "#27201C", muted: "#685E58", line: "#E5DAD4", control: "#96877F", accent: "#99533D", accentInk: "#FFFFFF", accentSoft: "#FEE5DD", focus: "#99533D", active: "#F1DED3", rowHover: "#FEF5F0", selection: "#FEE0D6", selectionInk: "#27201C", tag: "#FCE6E0", tagInk: "#5E372A", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#EBE5E1", disabledInk: "#6C6461",
  },
  ember: {
    label: "Ember", floor: "#18110F", paper: "#201917", panel: "#261F1C", raised: "#2A2220", ink: "#F4EDEA", muted: "#B9AEAA", line: "#3C3330", control: "#746B68", accent: "#F2A07C", accentInk: "#1E130E", accentSoft: "#42281C", focus: "#F2A07C", active: "#2D2421", rowHover: "#27201E", selection: "#482819", selectionInk: "#F4EDEA", tag: "#3F271D", tagInk: "#F8CDBA", error: "#3E211F", errorInk: "#FEC4BE", errorLine: "#E97871", success: "#1D2F21", successInk: "#B3E2BE", input: "#1C1513", disabled: "#312927", disabledInk: "#ACA29F",
  },
  amber: {
    label: "Amber", floor: "#F7EFE0", paper: "#FEFDFA", panel: "#FAF7F0", raised: "#FEFEFE", ink: "#25211A", muted: "#656056", line: "#E1DCD1", control: "#90897B", accent: "#8B5D02", accentInk: "#FFFFFF", accentSoft: "#F9E9D3", focus: "#8B5D02", active: "#EAE1CF", rowHover: "#FAF6EE", selection: "#F8E4C9", selectionInk: "#25211A", tag: "#F7EAD7", tagInk: "#573D14", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E9E6E0", disabledInk: "#68655E",
  },
  meadow: {
    label: "Meadow", floor: "#EDF3E4", paper: "#FCFEFB", panel: "#F6F8F2", raised: "#FEFFFD", ink: "#20231C", muted: "#5E6258", line: "#DADED4", control: "#888D80", accent: "#4C7129", accentInk: "#FFFFFF", accentSoft: "#E3F0DA", focus: "#4C7129", active: "#DEE5D5", rowHover: "#F5F8F0", selection: "#DDEED1", selectionInk: "#20231C", tag: "#E5F0DD", tagInk: "#354A23", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E5E7E1", disabledInk: "#646660",
  },
  lagoon: {
    label: "Lagoon", floor: "#E5F4F2", paper: "#FBFEFD", panel: "#F2F9F8", raised: "#FDFFFF", ink: "#1A2423", muted: "#576362", line: "#D5DFDE", control: "#808E8D", accent: "#08746E", accentInk: "#FFFFFF", accentSoft: "#D8F1EE", focus: "#08746E", active: "#D5E6E4", rowHover: "#F1F9F8", selection: "#CFEFEB", selectionInk: "#1A2423", tag: "#DBF1EF", tagInk: "#194C48", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E2E8E7", disabledInk: "#606766",
  },
  glacier: {
    label: "Glacier", floor: "#E8F2F6", paper: "#FBFDFE", panel: "#F3F8FA", raised: "#FEFFFF", ink: "#1A2326", muted: "#566266", line: "#D7DEE0", control: "#838C90", accent: "#356D85", accentInk: "#FFFFFF", accentSoft: "#DDEEF6", focus: "#356D85", active: "#D8E4E8", rowHover: "#F2F8FA", selection: "#D6EBF5", selectionInk: "#1A2326", tag: "#E0EFF6", tagInk: "#294754", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E3E7E8", disabledInk: "#626768",
  },
  sky: {
    label: "Sky", floor: "#E6F2FB", paper: "#FCFDFE", panel: "#F2F8FC", raised: "#FEFEFE", ink: "#1C2328", muted: "#586168", line: "#D5DEE4", control: "#818C95", accent: "#016BAA", accentInk: "#FFFFFF", accentSoft: "#DCEEFE", focus: "#016BAA", active: "#D6E4EF", rowHover: "#F1F8FD", selection: "#D4EBFF", selectionInk: "#1C2328", tag: "#DDEEFE", tagInk: "#1E4665", error: "#FFF0EE", errorInk: "#892A25", errorLine: "#C0453D", success: "#E4F9E9", successInk: "#215E36", input: "#FFFFFF", disabled: "#E2E7EB", disabledInk: "#61666A",
  },
  cobalt: {
    label: "Cobalt", floor: "#0E131A", paper: "#161B23", panel: "#1C2128", raised: "#1F252D", ink: "#EBEFF4", muted: "#ACB2BA", line: "#2F363F", control: "#686E77", accent: "#8BB9FD", accentInk: "#10161F", accentSoft: "#213045", focus: "#8BB9FD", active: "#202731", rowHover: "#1D222A", selection: "#1F324D", selectionInk: "#EBEFF4", tag: "#212E42", tagInk: "#C2D9FC", error: "#3E211F", errorInk: "#FEC4BE", errorLine: "#E97871", success: "#1D2F21", successInk: "#B3E2BE", input: "#13171F", disabled: "#262C33", disabledInk: "#9EA5AF",
  },
  iris: {
    label: "Iris", floor: "#131119", paper: "#1B1A22", panel: "#211F27", raised: "#25232C", ink: "#EFEDF3", muted: "#B1AFB9", line: "#36343E", control: "#6E6C76", accent: "#C0A8F5", accentInk: "#17141E", accentSoft: "#322A42", focus: "#C0A8F5", active: "#272530", rowHover: "#222129", selection: "#352B4A", selectionInk: "#EFEDF3", tag: "#30293F", tagInk: "#DBD0F8", error: "#3E211F", errorInk: "#FEC4BE", errorLine: "#E97871", success: "#1D2F21", successInk: "#B3E2BE", input: "#18161E", disabled: "#2C2A33", disabledInk: "#A5A3AE",
  },
  plum: {
    label: "Plum", floor: "#171015", paper: "#20191D", panel: "#251E23", raised: "#2A2227", ink: "#F2ECF0", muted: "#B8AEB4", line: "#3C3238", control: "#746B70", accent: "#E69DC6", accentInk: "#1D1218", accentSoft: "#3E2734", focus: "#E69DC6", active: "#2D2329", rowHover: "#272024", selection: "#442737", selectionInk: "#F2ECF0", tag: "#3B2632", tagInk: "#F1CBDF", error: "#3E211F", errorInk: "#FEC4BE", errorLine: "#E97871", success: "#1D2F21", successInk: "#B3E2BE", input: "#1C1519", disabled: "#30292D", disabledInk: "#ABA1A7",
  },
  aurora: {
    label: "Aurora", floor: "#0C1513", paper: "#141D1C", panel: "#192321", raised: "#1C2725", ink: "#EBF2F1", muted: "#A8B4B2", line: "#2C3836", control: "#65716F", accent: "#70CCAE", accentInk: "#0D1915", accentSoft: "#18362C", focus: "#70CCAE", active: "#1C2928", rowHover: "#1B2423", selection: "#123A2E", selectionInk: "#EBF2F1", tag: "#1A342B", tagInk: "#B8E3D2", error: "#3E211F", errorInk: "#FEC4BE", errorLine: "#E97871", success: "#1D2F21", successInk: "#B3E2BE", input: "#101918", disabled: "#242E2C", disabledInk: "#9BA8A6",
  },
};

export const themeAppearance: Record<AppTheme, ThemeAppearanceRecord> = {
  workshop: { mode: "light" },
  coral: { mode: "light" },
  lavender: { mode: "light" },
  ocean: { mode: "light" },
  mint: { mode: "light" },
  sunset: { mode: "light" },
  stone: { mode: "light" },
  midnight: { mode: "dark" },
  rose: { mode: "light" },
  peach: { mode: "light" },
  ember: { mode: "dark" },
  amber: { mode: "light" },
  meadow: { mode: "light" },
  lagoon: { mode: "light" },
  glacier: { mode: "light" },
  sky: { mode: "light" },
  cobalt: { mode: "dark" },
  iris: { mode: "dark" },
  plum: { mode: "dark" },
  aurora: { mode: "dark" },
};

export function themeCssVariables(theme: AppTheme): Record<`--${string}`, string> {
  const palette = themePalettes[theme];
  return {
    "--floor": palette.floor,
    "--paper": palette.paper,
    "--panel": palette.panel,
    "--raised": palette.raised,
    "--ink": palette.ink,
    "--muted": palette.muted,
    "--line": palette.line,
    "--control": palette.control,
    "--accent": palette.accent,
    "--accent-ink": palette.accentInk,
    "--accent-soft": palette.accentSoft,
    "--focus": palette.focus,
    "--active": palette.active,
    "--row-hover": palette.rowHover,
    "--selection": palette.selection,
    "--selection-ink": palette.selectionInk,
    "--tag-bg": palette.tag,
    "--tag-ink": palette.tagInk,
    "--error-bg": palette.error,
    "--error-ink": palette.errorInk,
    "--error-line": palette.errorLine,
    "--success-bg": palette.success,
    "--success-ink": palette.successInk,
    "--input-bg": palette.input,
    "--disabled-bg": palette.disabled,
    "--disabled-ink": palette.disabledInk,
    "--theme-mode": themeAppearance[theme].mode,
  };
}
