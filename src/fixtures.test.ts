import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { matchesAsset, parseQuery } from "./catalog";
import type { Asset } from "./types";

interface FixtureManifest {
  schemaVersion: number;
  updatedAt: string;
  items: Record<string, { id: string; tags: string[]; notes?: string }>;
}

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/sample-library");
const readManifest = (directory: string): FixtureManifest => JSON.parse(readFileSync(resolve(fixtureRoot, directory, ".asset-tags.json"), "utf8")) as FixtureManifest;

describe("sample fixture library", () => {
  it("contains root and folder self metadata with unique UUIDs", () => {
    const manifests = [readManifest("."), readManifest("Animals"), readManifest("Figures")];
    expect(manifests[0].items["."].tags).toEqual(["collection:3d-models"]);
    expect(manifests[1].items["."].tags).toEqual(["category:animal"]);
    const ids = manifests.flatMap((manifest) => Object.values(manifest.items).map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
  });
  it("filters real fixture tags without treating model placeholders as printable", () => {
    const animals = readManifest("Animals");
    const figures = readManifest("Figures");
    const rows: Asset[] = [
      { id: animals.items["Articulated Octopus.3mf"].id, name: "Articulated Octopus.3mf", relativePath: "Animals/Articulated Octopus.3mf", kind: "file", extension: "3mf", modifiedAt: null, sizeBytes: null, tags: animals.items["Articulated Octopus.3mf"].tags, status: "ready" },
      { id: figures.items["Flexi Dragon.3mf"].id, name: "Flexi Dragon.3mf", relativePath: "Figures/Flexi Dragon.3mf", kind: "file", extension: "3mf", modifiedAt: null, sizeBytes: null, tags: figures.items["Flexi Dragon.3mf"].tags, status: "ready" },
    ];
    expect(rows.filter((asset) => matchesAsset(asset, parseQuery("category:animal style:flexi -status:printed"), "all")).map((asset) => asset.name)).toEqual(["Articulated Octopus.3mf"]);
  });
  it("keeps intentional missing reference and Unicode sample file", () => {
    expect(readManifest("Animals").items["Missing Fox.stl"].tags).toContain("status:printed");
    expect(existsSync(resolve(fixtureRoot, "Animals/Missing Fox.stl"))).toBe(false);
    expect(readFileSync(resolve(fixtureRoot, "参考資料/猫と狐.txt"), "utf8")).toContain("猫と狐");
  });
});
