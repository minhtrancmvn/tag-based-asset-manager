import { describe, expect, it } from "vitest";
import { formatSize, matchesAsset, parseQuery, sortAssets, tagGroup } from "./catalog";
import { mockAssets } from "./data/mockAssets";

describe("query parsing", () => {
  it("parses required tags and NOT tags", () => {
    expect(parseQuery("category:animal style:flexi -status:printed")).toEqual({ requiredTags: ["category:animal", "style:flexi"], excludedTags: ["status:printed"], text: [] });
  });
  it("uses quoted phrases for case-insensitive filename search", () => {
    expect(parseQuery('"Flexi Dragon"')).toEqual({ requiredTags: [], excludedTags: [], text: ["flexi dragon"] });
  });
  it("trims whitespace and normalizes case", () => {
    expect(parseQuery("  CATEGORY:Animal   -STATUS:Printed  ")).toEqual({ requiredTags: ["category:animal"], excludedTags: ["status:printed"], text: [] });
  });
  it("treats unprefixed plain tokens as required tags", () => {
    expect(parseQuery("Favorite")).toEqual({ requiredTags: ["favorite"], excludedTags: [], text: [] });
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
    ["category:animal", "Category"], ["style:flexi", "Style"], ["theme:fantasy", "Theme"],
    ["status:printed", "Status"], ["material:pla", "Other"], ["favorite", "Other"],
  ])("classifies %s as %s", (tag, group) => expect(tagGroup(tag)).toBe(group));
});

describe("sorting and formatting", () => {
  it("sorts by name without changing input", () => {
    const original = mockAssets.map((asset) => asset.id);
    const sorted = sortAssets(mockAssets, "name", "asc");
    expect(sorted[0].name).toBe("Animals");
    expect(mockAssets.map((asset) => asset.id)).toEqual(original);
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
