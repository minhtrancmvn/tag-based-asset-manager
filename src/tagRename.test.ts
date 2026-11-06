import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseQuery } from "./catalog";
import { deriveRenameMigration, mapTag, normalizeRenameMapping, normalizeTagName, renameEntryTags, rewriteQuery } from "./tagRename";
import type { RenameMapping, RenameMappingError, RenameMode, RewriteFailureReason } from "./tagRename";
import type { SavedSearch, SearchFilters } from "./types";

interface MappingTagCase {
  input: string[];
  target: boolean;
  output: string[];
  duplicatesCollapsed: number;
}

interface MappingCase {
  id: string;
  mode: RenameMode;
  source: string;
  destination: string;
  expected: { mapping: RenameMapping } | { error: RenameMappingError };
  tags?: MappingTagCase[];
}

interface QueryCase {
  id: string;
  query: string;
  mapping: RenameMapping;
  expected: { query: string; changed: boolean } | { error: { reason: RewriteFailureReason; token: string } };
}

const fixtureDirectory = resolve(import.meta.dirname, "../fixtures");
const readFixture = <T>(name: string): T => JSON.parse(readFileSync(resolve(fixtureDirectory, name), "utf8")) as T;
const mappingCases = readFixture<{ cases: MappingCase[] }>("tag-rename-mappings.json").cases;
const queryCases = readFixture<{ cases: QueryCase[] }>("tag-rename-queries.json").cases;

describe("fixtures are loaded", () => {
  it("contains mapping and query cases of every kind", () => {
    expect(mappingCases.length).toBeGreaterThan(50);
    expect(mappingCases.some((fixtureCase) => "mapping" in fixtureCase.expected)).toBe(true);
    expect(mappingCases.some((fixtureCase) => "error" in fixtureCase.expected)).toBe(true);
    expect(queryCases.length).toBeGreaterThan(40);
    expect(queryCases.some((fixtureCase) => "query" in fixtureCase.expected)).toBe(true);
    expect(queryCases.some((fixtureCase) => "error" in fixtureCase.expected)).toBe(true);
  });
});

describe("normalizeTagName", () => {
  it("strips Unicode White_Space at the edges and lowercases", () => {
    expect(normalizeTagName(" 　 Status  \u0085\t\n")).toBe("status");
  });
  it("preserves interior whitespace", () => {
    expect(normalizeTagName(" My  Status ")).toBe("my  status");
  });
  it("does not strip U+FEFF, unlike String.prototype.trim", () => {
    expect("﻿a".trim()).toBe("a");
    expect(normalizeTagName("﻿A﻿")).toBe("﻿a﻿");
    expect(normalizeTagName("﻿")).toBe("﻿");
  });
  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeTagName(" 　\u0085\n")).toBe("");
  });
});

describe("normalizeRenameMapping fixtures", () => {
  it.each(mappingCases.map((fixtureCase) => [fixtureCase.id, fixtureCase] as const))("%s", (_id, fixtureCase) => {
    const result = normalizeRenameMapping(fixtureCase.mode, fixtureCase.source, fixtureCase.destination);
    if ("mapping" in fixtureCase.expected) expect(result).toEqual({ ok: true, mapping: fixtureCase.expected.mapping });
    else expect(result).toEqual({ ok: false, error: fixtureCase.expected.error });
  });
});

describe("tag mapping fixtures", () => {
  const withTags = mappingCases.filter((fixtureCase): fixtureCase is MappingCase & { expected: { mapping: RenameMapping }; tags: MappingTagCase[] } => "mapping" in fixtureCase.expected && fixtureCase.tags !== undefined);
  const tagCases = withTags.flatMap((fixtureCase) => fixtureCase.tags.map((tagCase, index) => ({ label: `${fixtureCase.id} #${index}`, mapping: fixtureCase.expected.mapping, tagCase })));
  it("has tag cases to run", () => {
    expect(tagCases.length).toBeGreaterThan(50);
  });
  it.each(tagCases.map((entry) => [entry.label, entry] as const))("%s", (_label, entry) => {
    expect(renameEntryTags(entry.tagCase.input, entry.mapping)).toEqual({
      target: entry.tagCase.target,
      output: entry.tagCase.output,
      duplicatesCollapsed: entry.tagCase.duplicatesCollapsed,
    });
  });
});

describe("mapTag", () => {
  const exact: RenameMapping = { mode: "exact", source: "status", destination: "state" };
  const prefix: RenameMapping = { mode: "prefix", source: "status", destination: "state" };
  it("exact mode renames only a tag equal to the source", () => {
    expect(mapTag("status", exact)).toBe("state");
    expect(mapTag("status:printed", exact)).toBeNull();
    expect(mapTag("statusx", exact)).toBeNull();
  });
  it("prefix mode keeps the whole remainder and ignores the plain tag", () => {
    expect(mapTag("status:printed:large", prefix)).toBe("state:printed:large");
    expect(mapTag("status:", prefix)).toBe("state:");
    expect(mapTag("status", prefix)).toBeNull();
    expect(mapTag("statusx:y", prefix)).toBeNull();
  });
});

describe("renameEntryTags", () => {
  it("returns non-targets untouched, including their original order and spelling", () => {
    const input = [" Z ", "a"];
    const result = renameEntryTags(input, { mode: "exact", source: "status", destination: "state" });
    expect(result).toEqual({ target: false, output: [" Z ", "a"], duplicatesCollapsed: 0 });
    expect(result.output).not.toBe(input);
  });
  it("sorts by UTF-8 bytes, not UTF-16 code units", () => {
    // U+FF5E sorts after an astral code point in UTF-16 order (surrogates are D800..DFFF) but before it in UTF-8 byte order.
    const result = renameEntryTags(["status", "～", "\u{1f4e6}"], { mode: "exact", source: "status", destination: "state" });
    expect(result.output).toEqual(["state", "～", "\u{1f4e6}"]);
  });
});

describe("rewriteQuery fixtures", () => {
  it.each(queryCases.map((fixtureCase) => [fixtureCase.id, fixtureCase] as const))("%s", (_id, fixtureCase) => {
    const result = rewriteQuery(fixtureCase.query, fixtureCase.mapping);
    if ("query" in fixtureCase.expected) {
      expect(result).toEqual({ ok: true, query: fixtureCase.expected.query, changed: fixtureCase.expected.changed });
      if (result.ok) {
        // The accepted rewrite must satisfy the stated representability equality.
        const before = parseQuery(fixtureCase.query);
        const mapList = (tags: string[]): string[] => tags.map((tag) => mapTag(tag, fixtureCase.mapping) ?? tag);
        expect(parseQuery(result.query)).toEqual({ requiredTags: mapList(before.requiredTags), excludedTags: mapList(before.excludedTags), text: before.text });
      }
    } else {
      expect(result).toEqual({ ok: false, reason: fixtureCase.expected.error.reason, token: fixtureCase.expected.error.token });
    }
  });
});

describe("rewriteQuery behavior beyond the fixtures", () => {
  const prefix: RenameMapping = { mode: "prefix", source: "status", destination: "state" };
  it("reports a combination-only failure on the first token that triggers it", () => {
    // Each token alone is representable; together the two leading quotes pair up into one phrase.
    const result = rewriteQuery("favorite Favorite", { mode: "exact", source: "favorite", destination: "\"fav" });
    expect(result).toEqual({ ok: false, reason: "quote-leading", token: "Favorite" });
  });
  it("does not touch a query it cannot match, even when the destination would be unrepresentable", () => {
    expect(rewriteQuery("color:red", { mode: "prefix", source: "status", destination: "my state" })).toEqual({ ok: true, query: "color:red", changed: false });
  });
  it("leaves quoted path text containing the source byte-for-byte unchanged", () => {
    expect(rewriteQuery("-\"status:x\" “status:y” status:z", prefix)).toEqual({ ok: true, query: "-\"status:x\" “status:y” state:z", changed: true });
  });
});

describe("deriveRenameMigration", () => {
  const exact: RenameMapping = { mode: "exact", source: "favorite", destination: "starred" };
  const prefix: RenameMapping = { mode: "prefix", source: "status", destination: "state" };
  const filters = (query: string, overrides: Partial<SearchFilters> = {}): SearchFilters => ({ query, view: "all", matchMode: "all", kind: "all", ...overrides });
  const search = (id: string, libraryId: string, query: string, overrides: Partial<SearchFilters> = {}): SavedSearch => ({ id, libraryId, name: `name-${id}`, filters: filters(query, overrides) });

  it("returns an empty migration when nothing matches", () => {
    const savedSearches = [search("s1", "lib-a", "color:red"), search("s2", "lib-a", '"status:x"')];
    expect(deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters("color:red"), savedSearches, mapping: prefix })).toEqual({
      activeQuery: { before: "color:red", after: "color:red", changed: false },
      replacements: [],
      blockers: [],
    });
  });

  it("returns an empty migration with no saved searches and an empty active query", () => {
    expect(deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters(""), savedSearches: [], mapping: prefix })).toEqual({
      activeQuery: { before: "", after: "", changed: false },
      replacements: [],
      blockers: [],
    });
  });

  it("rewrites the active query", () => {
    const migration = deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters("Status:Printed -status:a"), savedSearches: [], mapping: prefix });
    expect(migration.activeQuery).toEqual({ before: "Status:Printed -status:a", after: "state:printed -state:a", changed: true });
  });

  it("never touches other libraries' searches, even ones that would match or be unrepresentable", () => {
    const savedSearches = [
      search("other-match", "lib-b", "status:a"),
      search("other-blocked", "lib-b", "status:a", { view: "untagged" }),
      search("mine", "lib-a", "status:a"),
    ];
    const migration = deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters(""), savedSearches, mapping: { mode: "prefix", source: "status", destination: "my state" } });
    expect(migration.replacements).toEqual([]);
    expect(migration.blockers.map((blocker) => blocker.source)).toEqual([{ kind: "saved", searchId: "mine", name: "name-mine" }]);
    const clean = deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters(""), savedSearches, mapping: prefix });
    expect(clean.replacements.map((replacement) => replacement.searchId)).toEqual(["mine"]);
    expect(clean.blockers).toEqual([]);
  });

  it("creates no no-op replacements and the ID set equals the matching searches exactly", () => {
    const savedSearches = [
      search("a", "lib-a", "status:one"),
      search("b", "lib-a", "color:red"),
      search("c", "lib-a", "-STATUS:two color:red"),
      search("d", "lib-a", ""),
      search("e", "lib-a", "status"),
      search("f", "lib-b", "status:three"),
      search("g", "lib-a", "status:four \"status:quoted\""),
    ];
    const migration = deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters("anything"), savedSearches, mapping: prefix });
    const matching = ["a", "c", "g"];
    expect(migration.replacements.map((replacement) => replacement.searchId)).toEqual(matching);
    expect(new Set(migration.replacements.map((replacement) => replacement.searchId)).size).toBe(matching.length);
    for (const replacement of migration.replacements) expect(replacement.filters.query).not.toBe(replacement.expectedFilters.query);
  });

  it("changes only the query between expectedFilters and filters", () => {
    const savedSearches = [search("a", "lib-a", "Favorite color:red", { view: "attention", matchMode: "any", kind: "folder" })];
    const original = structuredClone(savedSearches);
    const migration = deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters(""), savedSearches, mapping: exact });
    const [replacement] = migration.replacements;
    expect(migration.replacements).toHaveLength(1);
    expect(replacement).toEqual({
      searchId: "a",
      name: "name-a",
      expectedFilters: { query: "Favorite color:red", view: "attention", matchMode: "any", kind: "folder" },
      filters: { query: "starred color:red", view: "attention", matchMode: "any", kind: "folder" },
    });
    // expectedFilters is a copy, and the input is not mutated.
    expect(replacement?.expectedFilters).not.toBe(savedSearches[0]?.filters);
    expect(savedSearches).toEqual(original);
  });

  it("reports an active-query blocker and leaves the active query unchanged", () => {
    const migration = deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters("color:red status:x"), savedSearches: [], mapping: { mode: "prefix", source: "status", destination: "my state" } });
    expect(migration.activeQuery).toEqual({ before: "color:red status:x", after: "color:red status:x", changed: false });
    expect(migration.replacements).toEqual([]);
    expect(migration.blockers).toEqual([{ source: { kind: "active" }, token: "status:x", reason: "whitespace", destination: "my state:x" }]);
  });

  it("collects every blocker with its source in deterministic order and still derives replacements for representable searches", () => {
    const mapping: RenameMapping = { mode: "prefix", source: "status", destination: "-x" };
    const savedSearches = [
      search("ok", "lib-a", "-status:a"),
      search("bad1", "lib-a", "color:red status:b"),
      search("other", "lib-b", "status:c"),
      search("bad2", "lib-a", "-status:d status:e"),
    ];
    const migration = deriveRenameMigration({ libraryId: "lib-a", activeFilters: filters("status:z"), savedSearches, mapping });
    expect(migration.blockers).toEqual([
      { source: { kind: "active" }, token: "status:z", reason: "leading-minus", destination: "-x:z" },
      { source: { kind: "saved", searchId: "bad1", name: "name-bad1" }, token: "status:b", reason: "leading-minus", destination: "-x:b" },
      { source: { kind: "saved", searchId: "bad2", name: "name-bad2" }, token: "status:e", reason: "leading-minus", destination: "-x:e" },
    ]);
    expect(migration.replacements.map((replacement) => replacement.searchId)).toEqual(["ok"]);
    expect(migration.replacements[0]?.filters.query).toBe("--x:a");
  });

  it("is deterministic across repeated calls", () => {
    const input = { libraryId: "lib-a", activeFilters: filters("status:a"), savedSearches: [search("a", "lib-a", "status:b"), search("b", "lib-a", "status:c")], mapping: prefix };
    expect(deriveRenameMigration(input)).toEqual(deriveRenameMigration(input));
  });
});
