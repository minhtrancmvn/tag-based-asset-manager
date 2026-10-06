import { describe, expect, it } from "vitest";
import { folderBreadcrumbs, folderIndex, parentFolder } from "./folderBrowse";
import { mockAssets } from "./data/mockAssets";

describe("current folder browsing", () => {
  it("indexes only immediate children without flattening descendants", () => {
    const index = folderIndex(mockAssets);
    expect(index.get("")?.map((asset) => asset.name)).toEqual(["Figures", "Animals", "Reference", "Miniatures", "Packaging"]);
    expect(index.get("Figures")?.map((asset) => asset.name)).toEqual(["Flexi Dragon.3mf", "Robot.stl", "Display stand.3mf"]);
  });
  it("omits root self asset from catalog children", () => {
    const root = { ...mockAssets[0], relativePath: "." };
    expect(folderIndex([root]).size).toBe(0);
  });
  it("preserves exact Unicode, spaces and Unix backslash basenames", () => {
    expect(parentFolder("Models/猫 file.stl")).toBe("Models");
    expect(parentFolder("Models\\literal")).toBe("");
    expect(folderBreadcrumbs("模型/動物 Figures")).toEqual([{ name: "模型", path: "模型" }, { name: "動物 Figures", path: "模型/動物 Figures" }]);
  });
  it("root has no ancestor and nested up uses direct parent", () => {
    expect(parentFolder("")).toBe("");
    expect(parentFolder("Figures")).toBe("");
    expect(parentFolder("Figures/Animals")).toBe("Figures");
  });
});
