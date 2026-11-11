import type { LibraryClient } from "./native";
import type { AppTheme } from "./types";

/**
 * Mirrors `usage-events.json`: same names, same order, same extra params. `src/usage.test.ts` fails if either
 * side drifts, and Rust rejects any name or field outside this list.
 */
export const usageEventDefinitions = [
  { name: "app_open" },
  { name: "tag_edit" },
  { name: "bulk_tag_edit" },
  { name: "tag_rename" },
  { name: "saved_search_save" },
  { name: "saved_search_apply" },
  { name: "saved_search_delete" },
  { name: "asset_preview" },
  { name: "metadata_export" },
  { name: "asset_reconnect" },
  { name: "missing_entry_remove" },
  { name: "asset_trash" },
  { name: "asset_open" },
  { name: "asset_reveal" },
  { name: "path_copy" },
  { name: "library_add" },
  { name: "library_remove" },
  { name: "library_switch" },
  { name: "library_scanned", extraParam: "size_range" },
  { name: "folder_navigate" },
  { name: "search_used" },
  { name: "tag_filter_click" },
  { name: "filter_change" },
  { name: "sort_change" },
  { name: "details_panel_close" },
  { name: "theme_change", extraParam: "theme" },
] as const;

export type SizeRange = "under_100" | "100_1k" | "1k_10k" | "10k_100k" | "over_100k";

type UsageEventDefinition = (typeof usageEventDefinitions)[number];
type ExtraParamValues = { theme: AppTheme; size_range: SizeRange };

/** Payload-free events are `{ name }`; the two with an extra param carry exactly that param. */
export type UsageEvent = {
  [D in UsageEventDefinition as D["name"]]: D extends { extraParam: infer P extends keyof ExtraParamValues }
    ? { name: D["name"] } & { [K in P]: ExtraParamValues[P] }
    : { name: D["name"] };
}[UsageEventDefinition["name"]];

export function sizeRange(count: number): SizeRange {
  if (count < 100) return "under_100";
  if (count < 1_000) return "100_1k";
  if (count < 10_000) return "1k_10k";
  if (count < 100_000) return "10k_100k";
  return "over_100k";
}

/** Fire-and-forget: does nothing outside the desktop app and never lets a failure reach the caller. */
export function trackUsage(client: Pick<LibraryClient, "isDesktop" | "trackUsage">, event: UsageEvent): void {
  if (!client.isDesktop) return;
  try {
    client.trackUsage(event).catch(() => undefined);
  } catch {
    // Analytics must never harm the app.
  }
}
