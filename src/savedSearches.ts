import type { SearchFilters } from "./types";

export const defaultFilters: SearchFilters = { query: "", view: "all", matchMode: "all", kind: "all" };

export function serializeFilters(filters: SearchFilters): string {
  return JSON.stringify({ query: filters.query, view: filters.view, matchMode: filters.matchMode, kind: filters.kind });
}

export function deserializeFilters(json: string): SearchFilters {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || !("query" in value) || typeof value.query !== "string" ||
    !("view" in value) || typeof value.view !== "string" || !["all", "untagged", "attention"].includes(value.view) ||
    !("matchMode" in value) || typeof value.matchMode !== "string" || !["all", "any"].includes(value.matchMode) ||
    !("kind" in value) || typeof value.kind !== "string" || !["all", "file", "folder"].includes(value.kind)) {
    throw new Error("Saved search contains invalid filters.");
  }
  return { query: value.query, view: value.view as SearchFilters["view"], matchMode: value.matchMode as SearchFilters["matchMode"], kind: value.kind as SearchFilters["kind"] };
}
