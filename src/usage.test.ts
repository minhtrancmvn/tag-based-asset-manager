import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sizeRange, trackUsage, usageEventDefinitions } from "./usage";
import type { UsageEvent } from "./usage";

interface UsageAllowlist {
  events: string[];
  extraParams: Record<string, string>;
  sizeRanges: string[];
}
interface PayloadBody {
  events: { name: string; params: Record<string, unknown> }[];
}
const allowlist = JSON.parse(readFileSync(new URL("../usage-events.json", import.meta.url), "utf8")) as UsageAllowlist;
const payloads = JSON.parse(readFileSync(new URL("../fixtures/usage-payload.json", import.meta.url), "utf8")) as Record<string, PayloadBody>;
const commonParams = ["session_id", "engagement_time_msec", "app_version", "edition", "operating_system"];

describe("usage event definitions", () => {
  it("lists the same names in the same order as usage-events.json", () => {
    expect(usageEventDefinitions.map((definition) => definition.name)).toEqual(allowlist.events);
  });
  it("declares exactly the extra params in usage-events.json", () => {
    const declared = Object.fromEntries(usageEventDefinitions.flatMap((definition) => "extraParam" in definition ? [[definition.name, definition.extraParam]] : []));
    expect(declared).toEqual(allowlist.extraParams);
  });
  it("matches the golden payload fixture's event names and extra-param keys", () => {
    expect(Object.keys(payloads)).toEqual(usageEventDefinitions.map((definition) => definition.name));
    for (const definition of usageEventDefinitions) {
      const body = payloads[definition.name];
      expect(body?.events.map((event) => event.name), definition.name).toEqual([definition.name]);
      const extraKeys = Object.keys(body?.events[0]?.params ?? {}).filter((key) => !commonParams.includes(key));
      expect(extraKeys, definition.name).toEqual("extraParam" in definition ? [definition.extraParam] : []);
    }
  });
  it("buckets library sizes exactly as sizeRanges lists them", () => {
    expect(allowlist.sizeRanges).toEqual(["under_100", "100_1k", "1k_10k", "10k_100k", "over_100k"]);
    const cases: [number, string][] = [
      [0, "under_100"], [99, "under_100"], [100, "100_1k"], [999, "100_1k"], [1000, "1k_10k"], [9999, "1k_10k"],
      [10000, "10k_100k"], [99999, "10k_100k"], [100000, "over_100k"], [5_000_000, "over_100k"],
    ];
    for (const [count, expected] of cases) expect(sizeRange(count), String(count)).toBe(expected);
    expect(new Set(cases.map(([, expected]) => expected))).toEqual(new Set(allowlist.sizeRanges));
  });
  it("types events with their extra param only where declared", () => {
    const events: UsageEvent[] = [
      { name: "tag_edit" }, { name: "theme_change", theme: "aurora" }, { name: "library_scanned", size_range: "1k_10k" },
    ];
    // @ts-expect-error theme_change requires its theme param
    const missingTheme: UsageEvent = { name: "theme_change" };
    // @ts-expect-error payload-free events accept no extra field
    const extraField: UsageEvent = { name: "tag_edit", theme: "aurora" };
    // @ts-expect-error unknown names are rejected at compile time
    const unknownName: UsageEvent = { name: "not_an_event" };
    expect([events.length, missingTheme, extraField, unknownName]).toBeDefined();
  });
});

describe("trackUsage wrapper", () => {
  it("does nothing in browser mode", () => {
    const track = vi.fn().mockResolvedValue(undefined);
    expect(trackUsage({ isDesktop: false, trackUsage: track }, { name: "tag_edit" })).toBeUndefined();
    expect(track).not.toHaveBeenCalled();
  });
  it("forwards the event on desktop", () => {
    const track = vi.fn().mockResolvedValue(undefined);
    trackUsage({ isDesktop: true, trackUsage: track }, { name: "theme_change", theme: "midnight" });
    expect(track).toHaveBeenCalledExactlyOnceWith({ name: "theme_change", theme: "midnight" });
  });
  it("swallows a synchronous throw", () => {
    const track = vi.fn(() => { throw new Error("sync failure"); });
    expect(() => trackUsage({ isDesktop: true, trackUsage: track }, { name: "tag_edit" })).not.toThrow();
    expect(track).toHaveBeenCalledTimes(1);
  });
  it("swallows a rejected promise without an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const track = vi.fn().mockRejectedValue(new Error("async failure"));
      expect(trackUsage({ isDesktop: true, trackUsage: track }, { name: "tag_edit" })).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
