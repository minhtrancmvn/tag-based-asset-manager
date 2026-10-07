// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeleteAssetsDialog } from "./DeleteAssetsDialog";
import type { Asset } from "../types";

afterEach(cleanup);

const file: Asset = { id: "path:a.stl", name: "a.stl", relativePath: "a.stl", kind: "file", extension: "stl", modifiedAt: null, sizeBytes: 5, tags: ["favorite"], status: "ready", metadataRevision: "rev1" };
const folder: Asset = { id: "path:Folder", name: "Folder", relativePath: "Folder", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged", metadataRevision: "rev2" };

describe("DeleteAssetsDialog", () => {
  it("requires an explicit review step before deleting once", async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    render(<DeleteAssetsDialog assets={[file]} busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText("a.stl")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/moves the listed items to Trash/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    expect(onConfirm).toHaveBeenCalledWith([file]);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancel performs no deletion", () => {
    const onConfirm = vi.fn();
    render(<DeleteAssetsDialog assets={[file, folder]} busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("lists every target and reports failure without claiming success", async () => {
    const onConfirm = vi.fn().mockResolvedValue(false);
    render(<DeleteAssetsDialog assets={[file, folder]} busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText("Folder")).toBeTruthy();
    expect(screen.getByText(/1 folder/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 items" }));
    expect(await screen.findByText(/Some items may already be in Trash/)).toBeTruthy();
  });

  it("Escape cancels while idle", () => {
    const onCancel = vi.fn();
    render(<DeleteAssetsDialog assets={[file]} busy={false} onCancel={onCancel} onConfirm={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
