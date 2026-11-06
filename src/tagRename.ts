import { parseQuery, queryTokenTagValue, tokenizeQuery } from "./catalog";
import type { QueryToken } from "./catalog";
import type { SavedSearch, SearchFilters } from "./types";

export type RenameMode = "exact" | "prefix";

/** A normalized rename mapping. Prefix mappings carry the single colon segment without its trailing colon. */
export interface RenameMapping {
  mode: RenameMode;
  source: string;
  destination: string;
}

export type RenameMappingError = "empty-source" | "empty-destination" | "unchanged" | "multi-segment-prefix";

export type NormalizeMappingResult = { ok: true; mapping: RenameMapping } | { ok: false; error: RenameMappingError };

// Rust's str::trim strips Unicode White_Space and nothing else. String.prototype.trim also strips U+FEFF,
// so it must not be used for names that Rust treats as authoritative.
const EDGE_WHITE_SPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;

/** Strips leading and trailing Unicode White_Space, then applies Unicode default lowercase. */
export function normalizeTagName(value: string): string {
  return value.replace(EDGE_WHITE_SPACE, "").toLowerCase();
}

function stripOneTrailingColon(value: string): string {
  return value.endsWith(":") ? value.slice(0, -1) : value;
}

export function normalizeRenameMapping(mode: RenameMode, source: string, destination: string): NormalizeMappingResult {
  let normalizedSource = normalizeTagName(source);
  let normalizedDestination = normalizeTagName(destination);
  if (mode === "prefix") {
    // Exactly one trailing colon is removed, with no re-trim.
    normalizedSource = stripOneTrailingColon(normalizedSource);
    normalizedDestination = stripOneTrailingColon(normalizedDestination);
  }
  if (normalizedSource === "") return { ok: false, error: "empty-source" };
  if (normalizedDestination === "") return { ok: false, error: "empty-destination" };
  if (mode === "prefix" && (normalizedSource.includes(":") || normalizedDestination.includes(":"))) {
    return { ok: false, error: "multi-segment-prefix" };
  }
  if (normalizedSource === normalizedDestination) return { ok: false, error: "unchanged" };
  return { ok: true, mapping: { mode, source: normalizedSource, destination: normalizedDestination } };
}

/** Maps one already-normalized tag, or returns null when the mapping does not rename it. */
export function mapTag(normalizedTag: string, mapping: RenameMapping): string | null {
  if (mapping.mode === "exact") return normalizedTag === mapping.source ? mapping.destination : null;
  const prefix = `${mapping.source}:`;
  // The whole remainder after the source segment, including its colon, is kept.
  return normalizedTag.startsWith(prefix) ? mapping.destination + normalizedTag.slice(mapping.source.length) : null;
}

const utf8 = new TextEncoder();

// Rust sorts Strings bytewise (UTF-8). UTF-16 code unit order differs for astral versus U+E000..U+FFFF.
function compareBytewise(left: string, right: string): number {
  const leftBytes = utf8.encode(left);
  const rightBytes = utf8.encode(right);
  const shared = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < shared; index++) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

// Mirrors Rust normalize_tags: trim, lowercase, drop empties, sort bytewise, dedup.
function normalizeTags(tags: readonly string[]): string[] {
  const normalized = tags.map(normalizeTagName).filter((tag) => tag !== "");
  return [...new Set(normalized)].sort(compareBytewise);
}

export interface RenameEntryTags {
  /** True when at least one normalized tag maps. */
  target: boolean;
  /** Normalized, sorted and deduplicated tags for a target; the untouched input for a non-target. */
  output: string[];
  /** Distinct non-empty normalized input tags minus output tags for a target; 0 otherwise. */
  duplicatesCollapsed: number;
}

/** Applies a mapping to one sidecar entry's tags exactly as the native rename does. */
export function renameEntryTags(tags: readonly string[], mapping: RenameMapping): RenameEntryTags {
  const normalized = tags.map(normalizeTagName);
  if (!normalized.some((tag) => mapTag(tag, mapping) !== null)) {
    return { target: false, output: [...tags], duplicatesCollapsed: 0 };
  }
  const output = normalizeTags(normalized.map((tag) => mapTag(tag, mapping) ?? tag));
  const distinctInput = new Set(normalized.filter((tag) => tag !== ""));
  return { target: true, output, duplicatesCollapsed: distinctInput.size - output.length };
}

export type RewriteFailureReason = "whitespace" | "quote-leading" | "leading-minus" | "role-change";

export type RewriteQueryResult =
  | { ok: true; query: string; changed: boolean }
  | { ok: false; reason: RewriteFailureReason; token: string };

interface TagReplacement {
  token: QueryToken;
  /** Mapped tag value, without any exclusion sign. */
  mapped: string;
}

type DetailedRewriteResult =
  | { ok: true; query: string; changed: boolean }
  | { ok: false; reason: RewriteFailureReason; token: string; destination: string };

function replacementText(replacement: TagReplacement): string {
  return replacement.token.role === "excluded" ? `-${replacement.mapped}` : replacement.mapped;
}

function applyReplacements(query: string, replacements: readonly TagReplacement[]): string {
  let rewritten = "";
  let cursor = 0;
  for (const replacement of replacements) {
    rewritten += query.slice(cursor, replacement.token.start) + replacementText(replacement);
    cursor = replacement.token.end;
  }
  return rewritten + query.slice(cursor);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Valid only when the rewritten query parses to the original parse with tag lists passed through the
// replacements and the text list unchanged.
function isRepresentable(query: string, replacements: readonly TagReplacement[]): boolean {
  const original = parseQuery(query);
  const mappedByStart = new Map(replacements.map((replacement) => [replacement.token.start, replacement]));
  const expectedRequired: string[] = [];
  const expectedExcluded: string[] = [];
  for (const token of tokenizeQuery(query)) {
    const replacement = mappedByStart.get(token.start);
    if (token.role === "required") expectedRequired.push(replacement?.mapped ?? queryTokenTagValue(token) ?? "");
    else if (token.role === "excluded") {
      const value = replacement?.mapped ?? queryTokenTagValue(token);
      if (value) expectedExcluded.push(value);
    }
  }
  const rewritten = parseQuery(applyReplacements(query, replacements));
  return sameList(rewritten.requiredTags, expectedRequired) &&
    sameList(rewritten.excludedTags, expectedExcluded) &&
    sameList(rewritten.text, original.text);
}

// Precedence: whitespace, quote-leading, leading-minus (required tokens only), role-change.
function failureReason(replacement: TagReplacement): RewriteFailureReason {
  if (/\s/.test(replacement.mapped)) return "whitespace";
  if (/^["“]/.test(replacement.mapped)) return "quote-leading";
  if (replacement.token.role === "required" && replacement.mapped.startsWith("-")) return "leading-minus";
  return "role-change";
}

function collectReplacements(query: string, mapping: RenameMapping): TagReplacement[] {
  const replacements: TagReplacement[] = [];
  for (const token of tokenizeQuery(query)) {
    const value = queryTokenTagValue(token);
    if (value === null) continue;
    const mapped = mapTag(value, mapping);
    if (mapped !== null) replacements.push({ token, mapped });
  }
  return replacements;
}

function rewriteQueryDetailed(query: string, mapping: RenameMapping): DetailedRewriteResult {
  const replacements = collectReplacements(query, mapping);
  if (isRepresentable(query, replacements)) {
    return { ok: true, query: applyReplacements(query, replacements), changed: replacements.length > 0 };
  }
  // First input token whose own rewrite fails. If every token is fine alone, the failure comes from tokens
  // interacting (for example two leading quotes pairing up), so blame the token that first breaks the prefix.
  const offending =
    replacements.find((replacement) => !isRepresentable(query, [replacement])) ??
    replacements.find((_replacement, index) => !isRepresentable(query, replacements.slice(0, index + 1)));
  if (!offending) throw new Error("A representable-check failure must have an offending replacement.");
  return { ok: false, reason: failureReason(offending), token: offending.token.text, destination: offending.mapped };
}

/**
 * Rewrites required and excluded tag tokens whose parser value maps, keeping every other byte, or reports the
 * first input token whose replacement would change the query's meaning.
 */
export function rewriteQuery(query: string, mapping: RenameMapping): RewriteQueryResult {
  const result = rewriteQueryDetailed(query, mapping);
  return result.ok ? result : { ok: false, reason: result.reason, token: result.token };
}

export type RenameBlockerSource = { kind: "active" } | { kind: "saved"; searchId: string; name: string };

export interface RenameBlocker {
  source: RenameBlockerSource;
  /** Exact input token that cannot be rewritten. */
  token: string;
  reason: RewriteFailureReason;
  /** Full mapped tag value for the failing token, without any exclusion sign. */
  destination: string;
}

export interface SavedSearchReplacement {
  searchId: string;
  name: string;
  expectedFilters: SearchFilters;
  filters: SearchFilters;
}

export interface RenameMigration {
  /** `after` equals `before` and `changed` is false when the active query is blocked. */
  activeQuery: { before: string; after: string; changed: boolean };
  replacements: SavedSearchReplacement[];
  blockers: RenameBlocker[];
}

export interface DeriveRenameMigrationInput {
  libraryId: string;
  activeFilters: SearchFilters;
  savedSearches: readonly SavedSearch[];
  mapping: RenameMapping;
}

/**
 * Derives the active-query rewrite, the active-library saved-search replacements and every unrepresentable
 * rewrite. Pure and deterministic: the active query comes first, then saved searches in input order.
 */
export function deriveRenameMigration(input: DeriveRenameMigrationInput): RenameMigration {
  const { libraryId, activeFilters, savedSearches, mapping } = input;
  const blockers: RenameBlocker[] = [];
  const replacements: SavedSearchReplacement[] = [];

  const active = rewriteQueryDetailed(activeFilters.query, mapping);
  let activeQuery: RenameMigration["activeQuery"];
  if (active.ok) {
    activeQuery = { before: activeFilters.query, after: active.query, changed: active.changed };
  } else {
    activeQuery = { before: activeFilters.query, after: activeFilters.query, changed: false };
    blockers.push({ source: { kind: "active" }, token: active.token, reason: active.reason, destination: active.destination });
  }

  for (const search of savedSearches) {
    if (search.libraryId !== libraryId) continue;
    const rewritten = rewriteQueryDetailed(search.filters.query, mapping);
    if (!rewritten.ok) {
      blockers.push({ source: { kind: "saved", searchId: search.id, name: search.name }, token: rewritten.token, reason: rewritten.reason, destination: rewritten.destination });
    } else if (rewritten.changed) {
      replacements.push({
        searchId: search.id,
        name: search.name,
        expectedFilters: { ...search.filters },
        filters: { ...search.filters, query: rewritten.query },
      });
    }
  }

  return { activeQuery, replacements, blockers };
}
