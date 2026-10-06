import { describe, expect, it } from "vitest";
import { defaultFilters, deserializeFilters, serializeFilters } from "./savedSearches";

describe("saved-search filter serialization", () => {
  it("round trips query, view, ANY and folder filtering", () => {
    const filters = { query: 'category:animal -status:printed "猫"', view: "untagged" as const, matchMode: "any" as const, kind: "folder" as const };
    expect(deserializeFilters(serializeFilters(filters))).toEqual(filters);
  });
  it("keeps quoted whitespace and case intact", () => {
    const filters = { ...defaultFilters, query: '  "Flexi Dragon"   CATEGORY:Animal ' };
    expect(deserializeFilters(serializeFilters(filters)).query).toBe(filters.query);
  });
  it.each([
    "{broken", "null", "[]", '{}',
    '{"query":4,"view":"all","matchMode":"all","kind":"all"}',
    '{"query":"","view":"invalid","matchMode":"all","kind":"all"}',
    '{"query":"","view":"all","matchMode":"every","kind":"all"}',
    '{"query":"","view":"all","matchMode":"all","kind":"unknown"}',
    '{"query":"","view":["all"],"matchMode":"all","kind":"all"}',
    '{"query":"","view":"all","matchMode":["any"],"kind":"all"}',
  ])("rejects invalid filters %s", (value) => expect(() => deserializeFilters(value)).toThrow());
});
