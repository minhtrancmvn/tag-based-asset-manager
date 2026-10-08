export type AppTheme = "workshop" | "coral" | "lavender" | "ocean" | "mint" | "sunset" | "stone" | "midnight";

export interface ThemePalette {
  label: string;
  floor: string;
  paper: string;
  panel: string;
  raised: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  focus: string;
  sidebar: string;
  sidebarText: string;
  sidebarMuted: string;
  sidebarActive: string;
  sidebarBorder: string;
  tableHeader: string;
  rowHover: string;
  selection: string;
  selectionInk: string;
  tag: string;
  tagInk: string;
  error: string;
  errorInk: string;
  errorLine: string;
  success: string;
  successInk: string;
  input: string;
  disabled: string;
  disabledInk: string;
  gradient: string;
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
];

export const themePalettes: Record<AppTheme, ThemePalette> = {
  workshop: { label: "Workshop", floor: "#f2efe8", paper: "#faf8f3", panel: "#fbfaf6", raised: "#fffefa", ink: "#233129", muted: "#59675d", line: "#d5d8ce", accent: "#4b6553", accentInk: "#ffffff", accentSoft: "#e7eee5", focus: "#94502f", sidebar: "#23372f", sidebarText: "#f4f4eb", sidebarMuted: "#c1d0c2", sidebarActive: "#405c4c", sidebarBorder: "#52675a", tableHeader: "#eeefe8", rowHover: "#f1f3ec", selection: "#dce8da", selectionInk: "#203326", tag: "#e9ece4", tagInk: "#435348", error: "#fff2eb", errorInk: "#773f30", errorLine: "#a94f36", success: "#edf4ea", successInk: "#35533a", input: "#fffefa", disabled: "#e8e9e3", disabledInk: "#51594f", gradient: "#eedfcb" },
  coral: { label: "Coral", floor: "#f7eeeb", paper: "#fff9f6", panel: "#fffaf8", raised: "#fffefd", ink: "#392522", muted: "#68514d", line: "#e3d2cd", accent: "#9e493c", accentInk: "#ffffff", accentSoft: "#f5ded8", focus: "#84372e", sidebar: "#49302e", sidebarText: "#fff7f3", sidebarMuted: "#ead0ca", sidebarActive: "#70433e", sidebarBorder: "#79504a", tableHeader: "#f4e8e3", rowHover: "#f7ece8", selection: "#f1d8d1", selectionInk: "#3e2824", tag: "#f3e3de", tagInk: "#633d36", error: "#fff0eb", errorInk: "#782f24", errorLine: "#a6382c", success: "#eaf3e8", successInk: "#35533a", input: "#fffefd", disabled: "#eee8e5", disabledInk: "#544945", gradient: "#f2d9cf" },
  lavender: { label: "Lavender", floor: "#f1eff7", paper: "#faf9ff", panel: "#fbfaff", raised: "#ffffff", ink: "#2e2a3d", muted: "#565166", line: "#d9d5e5", accent: "#62518e", accentInk: "#ffffff", accentSoft: "#e8e2f5", focus: "#504078", sidebar: "#302d43", sidebarText: "#f6f3ff", sidebarMuted: "#d1cce5", sidebarActive: "#4c4568", sidebarBorder: "#5c5675", tableHeader: "#eceaf3", rowHover: "#f1eff7", selection: "#e1dcf0", selectionInk: "#302943", tag: "#e8e4f2", tagInk: "#4c4267", error: "#fff0f0", errorInk: "#762d35", errorLine: "#a43f49", success: "#eaf3e8", successInk: "#35533a", input: "#ffffff", disabled: "#e9e7ed", disabledInk: "#504d58", gradient: "#e3def4" },
  ocean: { label: "Ocean", floor: "#eaf2f5", paper: "#f7fbfd", panel: "#f8fbfd", raised: "#ffffff", ink: "#1e3039", muted: "#4c626c", line: "#cfdae0", accent: "#276377", accentInk: "#ffffff", accentSoft: "#dcecf1", focus: "#175168", sidebar: "#203943", sidebarText: "#f1f8fa", sidebarMuted: "#c4d9df", sidebarActive: "#315766", sidebarBorder: "#4d6a75", tableHeader: "#e6eff2", rowHover: "#edf5f7", selection: "#d4e8ee", selectionInk: "#213a43", tag: "#dcebf0", tagInk: "#315561", error: "#fff0ea", errorInk: "#752f22", errorLine: "#a43d2d", success: "#e9f3eb", successInk: "#2f5038", input: "#ffffff", disabled: "#e4eaec", disabledInk: "#48565a", gradient: "#cde2e9" },
  mint: { label: "Mint", floor: "#edf4ef", paper: "#f9fcf9", panel: "#f9fcfa", raised: "#ffffff", ink: "#24342c", muted: "#52665a", line: "#d1ded5", accent: "#34684e", accentInk: "#ffffff", accentSoft: "#deeee2", focus: "#28563f", sidebar: "#263d32", sidebarText: "#f2f8f3", sidebarMuted: "#c8ddce", sidebarActive: "#3a5b49", sidebarBorder: "#587061", tableHeader: "#e8f0e9", rowHover: "#eff5ef", selection: "#d9e9dc", selectionInk: "#25392c", tag: "#e2eee4", tagInk: "#355541", error: "#fff0eb", errorInk: "#762f24", errorLine: "#a33e2e", success: "#e4f1e6", successInk: "#2e5137", input: "#ffffff", disabled: "#e7ece8", disabledInk: "#4d5850", gradient: "#d6e8da" },
  sunset: { label: "Sunset", floor: "#f7f0e7", paper: "#fffaf2", panel: "#fcf8f0", raised: "#fffdf9", ink: "#382b21", muted: "#665447", line: "#e2d6c5", accent: "#92552b", accentInk: "#ffffff", accentSoft: "#f3e2c9", focus: "#75411e", sidebar: "#493728", sidebarText: "#fff8eb", sidebarMuted: "#e5d1b5", sidebarActive: "#6b5035", sidebarBorder: "#80664b", tableHeader: "#f1e8da", rowHover: "#f7efe3", selection: "#f0dfc6", selectionInk: "#382a1e", tag: "#f1e5d2", tagInk: "#624a31", error: "#fff0e9", errorInk: "#772f20", errorLine: "#a33a27", success: "#eaf2e7", successInk: "#355138", input: "#fffdf9", disabled: "#ede8df", disabledInk: "#524b42", gradient: "#f0dfc5" },
  stone: { label: "Stone", floor: "#efefed", paper: "#fafaf8", panel: "#f9f9f7", raised: "#ffffff", ink: "#292d2b", muted: "#555d59", line: "#d5d8d5", accent: "#4a5a54", accentInk: "#ffffff", accentSoft: "#e2e8e4", focus: "#35473f", sidebar: "#303936", sidebarText: "#f4f6f4", sidebarMuted: "#cbd2ce", sidebarActive: "#48544f", sidebarBorder: "#626b66", tableHeader: "#e9ebe9", rowHover: "#f0f2f0", selection: "#dce3de", selectionInk: "#29332e", tag: "#e6e9e6", tagInk: "#424b46", error: "#fff0ed", errorInk: "#762f2c", errorLine: "#a33d39", success: "#e9f2e9", successInk: "#35523a", input: "#ffffff", disabled: "#e9ebea", disabledInk: "#505753", gradient: "#e0e2df" },
  midnight: { label: "Midnight", floor: "#171d24", paper: "#202831", panel: "#222b34", raised: "#29343e", ink: "#edf2f5", muted: "#bac5cd", line: "#46535d", accent: "#71b6cc", accentInk: "#10232b", accentSoft: "#293f49", focus: "#91d7e8", sidebar: "#131a20", sidebarText: "#edf3f6", sidebarMuted: "#b8c7d0", sidebarActive: "#2b414d", sidebarBorder: "#43545e", tableHeader: "#2b353e", rowHover: "#2b3740", selection: "#344953", selectionInk: "#f1f7f9", tag: "#34434b", tagInk: "#dcebf0", error: "#402d2d", errorInk: "#ffd4c8", errorLine: "#e38b78", success: "#293b32", successInk: "#c4e5ca", input: "#1b242c", disabled: "#303a41", disabledInk: "#c0c9cd", gradient: "#2c414b" },
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
    "--copper": palette.focus,
    "--accent": palette.accent,
    "--accent-ink": palette.accentInk,
    "--accent-soft": palette.accentSoft,
    "--focus": palette.focus,
    "--sidebar": palette.sidebar,
    "--sidebar-text": palette.sidebarText,
    "--sidebar-muted": palette.sidebarMuted,
    "--sidebar-active": palette.sidebarActive,
    "--sidebar-border": palette.sidebarBorder,
    "--table-header": palette.tableHeader,
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
    "--theme-gradient": palette.gradient,
  };
}
