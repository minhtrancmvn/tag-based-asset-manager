import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSize, matchesAsset, parseQuery, sortAssets, tagGroup, tokenizeQuery } from "./catalog";
import type { CatalogQuery, QueryToken } from "./catalog";
import { mockAssets } from "./data/mockAssets";

describe("query parsing", () => {
  it("parses required tags and NOT tags", () => {
    expect(parseQuery("category:animal style:flexi -status:printed")).toEqual({ requiredTags: ["category:animal", "style:flexi"], excludedTags: ["status:printed"], text: [] });
  });
  it("uses quoted phrases for case-insensitive filename search", () => {
    expect(parseQuery('"Flexi Dragon"')).toEqual({ requiredTags: [], excludedTags: [], text: ["flexi dragon"] });
  });
  it("uses smart double quotes for filename search", () => {
    expect(parseQuery("“Flexi Dragon”")).toEqual({ requiredTags: [], excludedTags: [], text: ["flexi dragon"] });
  });
  it("uses a smart opening quote with an ASCII closing quote", () => {
    expect(parseQuery('“Flexi Dragon"')).toEqual({ requiredTags: [], excludedTags: [], text: ["flexi dragon"] });
  });
  it("uses an ASCII opening quote with a smart closing quote", () => {
    expect(parseQuery('"Flexi Dragon”')).toEqual({ requiredTags: [], excludedTags: [], text: ["flexi dragon"] });
  });
  it("keeps tags and exclusions separate from smart-quoted phrases", () => {
    expect(parseQuery("category:animal “Flexi Dragon” -status:printed")).toEqual({ requiredTags: ["category:animal"], excludedTags: ["status:printed"], text: ["flexi dragon"] });
  });
  it("keeps consecutive mixed-quoted phrases separate", () => {
    expect(parseQuery('"Flexi Dragon” "Fox Pendant”')).toEqual({ requiredTags: [], excludedTags: [], text: ["flexi dragon", "fox pendant"] });
  });
  it("keeps consecutive phrases separate when the next opening quote is smart", () => {
    expect(parseQuery('"Flexi Dragon” “Fox Pendant"')).toEqual({ requiredTags: [], excludedTags: [], text: ["flexi dragon", "fox pendant"] });
  });
  it("keeps tags between mixed-quoted phrases separate", () => {
    expect(parseQuery('"Flexi Dragon” favorite -status:printed “Fox Pendant"')).toEqual({ requiredTags: ["favorite"], excludedTags: ["status:printed"], text: ["flexi dragon", "fox pendant"] });
  });
  it("preserves smart quotes inside an ASCII-quoted filename", () => {
    expect(parseQuery('"The “Fox” Model"')).toEqual({ requiredTags: [], excludedTags: [], text: ["the “fox” model"] });
  });
  it("preserves multiple smart-quoted names inside an ASCII-quoted filename", () => {
    expect(parseQuery('"The “Fox” and “Dog” Model"')).toEqual({ requiredTags: [], excludedTags: [], text: ["the “fox” and “dog” model"] });
  });
  it("preserves closing punctuation before paired smart quotes in an ASCII phrase", () => {
    expect(parseQuery('"3” “Fox” Model"')).toEqual({ requiredTags: [], excludedTags: [], text: ["3” “fox” model"] });
  });
  it("bounds work for many unmatched smart opening quotes", () => {
    const now = performance.now();
    const parsed = parseQuery("“a ".repeat(30000));
    expect(parsed.requiredTags).toHaveLength(30000);
    expect(performance.now() - now).toBeLessThan(500);
  });
  it("preserves a literal smart opening quote inside an ASCII-quoted filename", () => {
    expect(parseQuery('"The “Fox Model"')).toEqual({ requiredTags: [], excludedTags: [], text: ["the “fox model"] });
  });
  it("preserves a literal smart closing quote inside an ASCII-quoted filename", () => {
    expect(parseQuery('"Size 3” Model"')).toEqual({ requiredTags: [], excludedTags: [], text: ["size 3” model"] });
  });
  it("preserves an ASCII phrase adjacent to a tag", () => {
    expect(parseQuery('"Flexi Dragon"favorite')).toEqual({ requiredTags: ["favorite"], excludedTags: [], text: ["flexi dragon"] });
  });
  it("preserves literal smart punctuation in an ASCII phrase adjacent to a tag", () => {
    expect(parseQuery('"Size 3” Model"favorite')).toEqual({ requiredTags: ["favorite"], excludedTags: [], text: ["size 3” model"] });
  });
  it("preserves smart punctuation inside unquoted tags", () => {
    expect(parseQuery("size:3” owner:artist’s -label:6”")).toEqual({ requiredTags: ["size:3”", "owner:artist’s"], excludedTags: ["label:6”"], text: [] });
  });
  it("does not introduce negative text search for smart quotes", () => {
    expect(parseQuery("-“Flexi Dragon”")).toEqual({ requiredTags: [], excludedTags: [], text: ["-“flexi dragon”"] });
  });
  it("trims whitespace and normalizes case", () => {
    expect(parseQuery("  CATEGORY:Animal   -STATUS:Printed  ")).toEqual({ requiredTags: ["category:animal"], excludedTags: ["status:printed"], text: [] });
  });
  it("treats unprefixed plain tokens as required tags", () => {
    expect(parseQuery("Favorite")).toEqual({ requiredTags: ["favorite"], excludedTags: [], text: [] });
  });
});

interface QueryFixtureCase {
  id: string;
  query: string;
}

const queryFixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/tag-rename-queries.json"), "utf8")) as { cases: QueryFixtureCase[] };

// Independent of catalog.ts: rebuild a CatalogQuery purely from token roles and text.
function queryFromTokens(tokens: QueryToken[]): CatalogQuery {
  const query: CatalogQuery = { requiredTags: [], excludedTags: [], text: [] };
  for (const token of tokens) {
    if (token.role === "required") query.requiredTags.push(token.text.trim().toLowerCase());
    else if (token.role === "excluded") {
      const tag = token.text.slice(1).trim().toLowerCase();
      if (tag) query.excludedTags.push(tag);
    } else if (token.role === "phrase") {
      const phrase = token.text.slice(1, -1).trim().toLowerCase();
      if (phrase) query.text.push(phrase);
    } else query.text.push(token.text.toLowerCase());
  }
  return query;
}

function reconstruct(input: string, tokens: QueryToken[]): { rebuilt: string; gaps: string[] } {
  let cursor = 0;
  let rebuilt = "";
  const gaps: string[] = [];
  for (const token of tokens) {
    gaps.push(input.slice(cursor, token.start));
    rebuilt += input.slice(cursor, token.start) + token.text;
    cursor = token.end;
  }
  gaps.push(input.slice(cursor));
  rebuilt += input.slice(cursor);
  return { rebuilt, gaps };
}

const spanInputs: string[] = [
  "",
  "   ",
  "category:animal style:flexi -status:printed",
  '"Flexi Dragon" -"Flexi Dragon" tag',
  "“Flexi Dragon” -“Flexi Dragon” tag",
  '“Flexi Dragon" "Flexi Dragon” tag',
  '"a “b” c" d:e',
  "“a \"b\" c” d:e",
  "size:3” owner:artist’s -label:6”",
  '"unclosed phrase',
  "-",
  '"',
  '-"',
  " \t\n\u00a0\ufeff status:a\u2028-status:b\u3000",
  "status:a\u0085status:b",
  ...queryFixture.cases.map((fixtureCase) => fixtureCase.query),
];

describe("query tokenization", () => {
  it("reports ordered spans, exact text and roles", () => {
    const input = '  status:a  -Color:Red "Flexi Dragon"  -"no thanks" ';
    expect(tokenizeQuery(input)).toEqual([
      { start: 2, end: 10, text: "status:a", role: "required" },
      { start: 12, end: 22, text: "-Color:Red", role: "excluded" },
      { start: 23, end: 37, text: '"Flexi Dragon"', role: "phrase" },
      { start: 39, end: 51, text: '-"no thanks"', role: "negative-text" },
    ]);
  });
  it("returns no tokens for empty or whitespace-only input", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery(" \t\n\u00a0\ufeff")).toEqual([]);
  });
  it("classifies smart-quoted phrases and negative smart-quoted text", () => {
    expect(tokenizeQuery("“a b” -“c d”").map((token) => token.role)).toEqual(["phrase", "negative-text"]);
  });
  it("keeps an unclosed quote as a tag token", () => {
    expect(tokenizeQuery('status:a "status:b')).toEqual([
      { start: 0, end: 8, text: "status:a", role: "required" },
      { start: 9, end: 18, text: '"status:b', role: "required" },
    ]);
  });
  it("treats U+FEFF as a separator but U+0085 as part of a token", () => {
    expect(tokenizeQuery("a\ufeffb").map((token) => token.text)).toEqual(["a", "b"]);
    expect(tokenizeQuery("a\u0085b").map((token) => token.text)).toEqual(["a\u0085b"]);
  });
  it("covers at least the shared query fixtures", () => {
    expect(queryFixture.cases.length).toBeGreaterThan(40);
  });
  it.each(spanInputs.map((input, index) => [index, JSON.stringify(input), input] as const))("spans reconstruct the input exactly for input %i %s", (_index, _label, input) => {
    const tokens = tokenizeQuery(input);
    const { rebuilt, gaps } = reconstruct(input, tokens);
    expect(rebuilt).toBe(input);
    for (const gap of gaps) expect(gap).toMatch(/^\s*$/);
    let previousEnd = 0;
    for (const token of tokens) {
      expect(token.start).toBeGreaterThanOrEqual(previousEnd);
      expect(token.end).toBeGreaterThan(token.start);
      expect(input.slice(token.start, token.end)).toBe(token.text);
      expect(token.text).not.toBe("");
      previousEnd = token.end;
    }
  });
  it.each(spanInputs.map((input, index) => [index, JSON.stringify(input), input] as const))("roles match parseQuery classification for input %i %s", (_index, _label, input) => {
    expect(queryFromTokens(tokenizeQuery(input))).toEqual(parseQuery(input));
  });
});

describe("mock catalog filtering", () => {
  it("requires all tags while excluding printed assets", () => {
    const query = parseQuery("category:animal style:flexi -status:printed");
    expect(mockAssets.filter((asset) => matchesAsset(asset, query, "all")).map((asset) => asset.id)).toEqual(["a5", "a15"]);
  });
  it("matches quoted path text case insensitively", () => {
    expect(mockAssets.filter((asset) => matchesAsset(asset, parseQuery('"FLEXI DRAGON"'), "all")).map((asset) => asset.id)).toEqual(["a2"]);
  });
  it("ANY requires at least one required tag but still excludes NOT tags", () => {
    const query = parseQuery("category:animal theme:fantasy -status:printed");
    expect(mockAssets.filter((asset) => matchesAsset(asset, query, "all", "any", "file")).map((asset) => asset.id)).toEqual(["a5", "a6", "a8", "a12", "a15", "a16"]);
  });
  it("ANY keeps a smart-quoted phrase required", () => {
    const query = parseQuery('category:animal theme:fantasy “Fox Pendant" -status:printed');
    expect(mockAssets.filter((asset) => matchesAsset(asset, query, "all", "any", "file")).map((asset) => asset.id)).toEqual(["a6"]);
  });
  it("ANY rejects nonmatching smart-quoted text despite a matching tag", () => {
    const query = parseQuery('category:animal “Missing Phrase"');
    expect(mockAssets.filter((asset) => matchesAsset(asset, query, "all", "any", "file")).map((asset) => asset.id)).toEqual([]);
  });
  it("ANY with no required tags matches all kinds and keeps text required", () => {
    const query = parseQuery('"animals" -status:printed');
    expect(mockAssets.filter((asset) => matchesAsset(asset, query, "all", "any", "file")).map((asset) => asset.id)).toEqual(["a5", "a6", "a12", "a15"]);
  });
  it("filters folders independently from required tags", () => {
    expect(mockAssets.filter((asset) => matchesAsset(asset, parseQuery(""), "all", "all", "folder")).map((asset) => asset.id)).toEqual(["a1", "a4", "a7", "a9", "a14"]);
  });
  it("shows only untagged rows", () => {
    expect(mockAssets.filter((asset) => matchesAsset(asset, parseQuery(""), "untagged")).map((asset) => asset.id)).toEqual(["a7", "a11", "a14"]);
  });
  it("does not classify blocked metadata as untagged", () => {
    const blocked = { ...mockAssets[6], metadataState: "blocked" as const, status: "warning" as const };
    expect(matchesAsset(blocked, parseQuery(""), "untagged")).toBe(false);
    expect(matchesAsset(blocked, parseQuery(""), "attention")).toBe(true);
  });
  it("shows stale metadata reference in needs attention", () => {
    expect(mockAssets.filter((asset) => matchesAsset(asset, parseQuery(""), "attention")).map((asset) => asset.id)).toEqual(["a16"]);
  });
});

describe("tag grouping", () => {
  it.each([
    ["category:animal", "category"], ["style:flexi", "style"], ["theme:fantasy", "theme"],
    ["status:printed", "status"], ["material:pla", "material"], ["favorite", "favorite"],
    ["oole:identity", "oole"], ["oole:identity:brand", "oole"], ["MATERIAL:pla", "material"],
    ["other:custom", "other"], ["chất-liệu:nhựa", "chất-liệu"],
  ])("classifies %s as %s", (tag, group) => expect(tagGroup(tag)).toBe(group));
});

describe("sorting and formatting", () => {
  it("sorts by name without changing input", () => {
    const original = mockAssets.map((asset) => asset.id);
    const sorted = sortAssets(mockAssets, "name", "asc");
    expect(sorted[0].name).toBe("Animals");
    expect(mockAssets.map((asset) => asset.id)).toEqual(original);
  });
  it("lists every folder before files for both directions", () => {
    for (const direction of ["asc", "desc"] as const) {
      for (const key of ["name", "tags", "type", "path", "modified", "size", "status"] as const) {
        const sorted = sortAssets(mockAssets, key, direction);
        const firstFile = sorted.findIndex((asset) => asset.kind === "file");
        expect(sorted.slice(0, firstFile).every((asset) => asset.kind === "folder")).toBe(true);
        expect(sorted.slice(firstFile).every((asset) => asset.kind === "file")).toBe(true);
      }
    }
  });
  it("sorts numeric sizes and keeps empty sizes first ascending", () => {
    const sorted = sortAssets(mockAssets, "size", "asc");
    expect(sorted[0].sizeBytes).toBeNull();
    expect(sorted[sorted.length - 1]?.name).toBe("Fox in motion.zip");
  });
  it.each([[null, "—"], [0, "0 B"], [512, "512 B"], [1536, "1.5 KB"], [1572864, "1.5 MB"]])("formats size %s", (bytes, expected) => {
    expect(formatSize(bytes as number | null)).toBe(expected);
  });
});
