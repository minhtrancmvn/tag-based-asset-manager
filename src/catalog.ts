import type { Asset, KindFilter, SortDirection, SortKey, TagMatchMode, ViewKey } from "./types";

export interface CatalogQuery {
  requiredTags: string[];
  excludedTags: string[];
  text: string[];
}

export function tagGroup(tag: string): string {
  return tag.split(":", 1)[0].toLowerCase();
}

export function parseQuery(input: string): CatalogQuery {
  const result: CatalogQuery = { requiredTags: [], excludedTags: [], text: [] };
  const tokens: string[] = [];
  const words = /\S+/g;
  const lastQuoteEnd = Math.max(input.lastIndexOf('"'), input.lastIndexOf("”"));
  let word: RegExpExecArray | null;
  while ((word = words.exec(input))) {
    const start = word.index;
    const quoteStart = start + (input[start] === "-" ? 1 : 0);
    let end = start + word[0].length;
    if (quoteStart < lastQuoteEnd && (input[quoteStart] === '"' || input[quoteStart] === "“")) {
      const asciiClose = input[quoteStart] === '"' ? input.indexOf('"', quoteStart + 1) : -1;
      let pairedClose = input.indexOf("”", quoteStart + 1);
      let close = -1;
      let smartClose = -1;
      let smartDepth = 0;
      for (let index = quoteStart + 1; index < input.length; index++) {
        const character = input[index];
        if (character === '"') {
          const startsPhrase = /\s/.test(input[index - 1]) && /\S/.test(input[index + 1] ?? "");
          close = smartClose !== -1 && startsPhrase ? smartClose : index;
          break;
        }
        if (character === "“") {
          if (pairedClose !== -1 && pairedClose <= index) pairedClose = input.indexOf("”", index + 1);
          if (smartClose !== -1 && /\s/.test(input[index - 1]) && (asciiClose === -1 || pairedClose === -1 || pairedClose > asciiClose)) {
            close = smartClose;
            break;
          }
          smartDepth++;
        } else if (character === "”") {
          if (input[quoteStart] === "“") {
            close = index;
            break;
          }
          // Paired smart quotes stay literal inside ASCII phrases.
          if (smartDepth > 0) smartDepth--;
          else if (smartClose === -1) smartClose = index;
        }
      }
      if (close === -1) close = smartClose;
      if (close !== -1) end = close + 1;
    }
    tokens.push(input.slice(start, end));
    words.lastIndex = end;
  }
  for (const token of tokens) {
    if (/^["“]/.test(token) && /["”]$/.test(token)) {
      const phrase = token.slice(1, -1).trim().toLowerCase();
      if (phrase) result.text.push(phrase);
    } else if (/^-["“]/.test(token) && /["”]$/.test(token)) {
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
  return [...assets].sort((a, b) => {
    // Folders always lead the catalog, then files; the chosen key orders each group.
    const folderOrder = Number(a.kind !== "folder") - Number(b.kind !== "folder");
    if (folderOrder !== 0) return folderOrder;
    return direction === "asc"
      ? text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: "base" })
      : text(b).localeCompare(text(a), undefined, { numeric: true, sensitivity: "base" });
  });
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
