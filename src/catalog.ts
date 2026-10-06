import type { Asset, KindFilter, SortDirection, SortKey, TagGroup, TagMatchMode, ViewKey } from "./types";

export interface CatalogQuery {
  requiredTags: string[];
  excludedTags: string[];
  text: string[];
}

export function tagGroup(tag: string): TagGroup {
  const prefix = tag.split(":", 1)[0].toLowerCase();
  if (prefix === "category") return "Category";
  if (prefix === "style") return "Style";
  if (prefix === "theme") return "Theme";
  if (prefix === "status") return "Status";
  return "Other";
}

export function parseQuery(input: string): CatalogQuery {
  const result: CatalogQuery = { requiredTags: [], excludedTags: [], text: [] };
  const tokens = input.match(/-?"[^"]*"|-?\S+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('"') && token.endsWith('"')) {
      const phrase = token.slice(1, -1).trim().toLowerCase();
      if (phrase) result.text.push(phrase);
    } else if (token.startsWith('-"') && token.endsWith('"')) {
      // Negative text search is not part of the query language.
      result.text.push(token.toLowerCase());
    } else if (token.startsWith("-")) {
      const tag = token.slice(1).trim().toLowerCase();
      if (tag) result.excludedTags.push(tag);
    } else {
      result.requiredTags.push(token.trim().toLowerCase());
    }
  }
  return result;
}

export function matchesAsset(asset: Asset, query: CatalogQuery, view: ViewKey, matchMode: TagMatchMode = "all", kind: KindFilter = "all"): boolean {
  if (kind !== "all" && asset.kind !== kind) return false;
  if (view === "untagged" && (asset.tags.length > 0 || asset.metadataState === "blocked")) return false;
  if (view === "attention" && asset.status !== "missing" && asset.status !== "warning" && asset.metadataState !== "blocked") return false;
  const tags = asset.tags.map((tag) => tag.toLowerCase());
  const path = asset.relativePath.toLowerCase();
  const required = query.requiredTags.length === 0 || (matchMode === "any"
    ? query.requiredTags.some((tag) => tags.includes(tag))
    : query.requiredTags.every((tag) => tags.includes(tag)));
  return required &&
    query.excludedTags.every((tag) => !tags.includes(tag)) &&
    query.text.every((text) => path.includes(text));
}

export function sortAssets(assets: Asset[], key: SortKey, direction: SortDirection): Asset[] {
  const text = (asset: Asset): string => {
    switch (key) {
      case "name": return asset.name;
      case "tags": return asset.tags.join(" ");
      case "type": return asset.kind === "folder" ? "folder" : asset.extension ?? "file";
      case "path": return asset.relativePath;
      case "modified": return asset.modifiedAt ?? "";
      case "size": return String(asset.sizeBytes ?? -1).padStart(16, "0");
      case "status": return asset.status;
    }
  };
  return [...assets].sort((a, b) => direction === "asc"
    ? text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: "base" })
    : text(b).localeCompare(text(a), undefined, { numeric: true, sensitivity: "base" }));
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
