// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BulkTagDialog } from "./BulkTagDialog";
import type { Asset } from "../types";

afterEach(cleanup);

const targets: Asset[] = [
  { id: "file-1", name: "Gear.stl", relativePath: "Models/Gear.stl", kind: "file", extension: "stl", modifiedAt: null, sizeBytes: 10, tags: ["Category:Gear"], status: "ready", metadataRevision: "rev-1" },
  { id: "folder-1", name: "Models", relativePath: "Models", kind: "folder", extension: null, modifiedAt: null, sizeBytes: null, tags: [], status: "untagged", metadataRevision: "rev-2" },
];

describe("BulkTagDialog", () => {
  it("cancel performs no writes", () => {
    const confirm = vi.fn(async () => true);
    const cancel = vi.fn();
    render(<BulkTagDialog assets={targets} availableTags={[]} busy={false} onCancel={cancel} onConfirm={confirm} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Add tags" }), { target: { value: "style:flexi" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("typing and Enter only compose tags; explicit confirmation writes normalized tags once", async () => {
    const confirm = vi.fn(async () => true);
    render(<BulkTagDialog assets={targets} availableTags={[]} busy={false} onCancel={vi.fn()} onConfirm={confirm} />);
    expect(screen.getByText("2 selected assets")).toBeTruthy();
    const addInput = screen.getByRole("combobox", { name: "Add tags" });
    fireEvent.change(addInput, { target: { value: " Style:Flexi " } });
    fireEvent.keyDown(addInput, { key: "Enter" });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(addInput, { target: { value: "category:Gear" } });
    fireEvent.keyDown(addInput, { key: "Enter" });
    fireEvent.change(screen.getByRole("combobox", { name: "Remove tags" }), { target: { value: "STATUS:Printed" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Remove tags" }), { key: "Enter" });
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
    expect(confirm).toHaveBeenCalledWith(["style:flexi", "category:gear"], ["status:printed"]);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("traps focus and Escape cancels without native writes", () => {
    const confirm = vi.fn(async () => true);
    const cancel = vi.fn();
    render(<BulkTagDialog assets={targets} availableTags={[]} busy={false} onCancel={cancel} onConfirm={confirm} />);
    const dialog = screen.getByRole("dialog");
    const controls = dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    controls[controls.length - 1]?.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(controls[0]);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps targets and reports failure without claiming complete success", async () => {
    const confirm = vi.fn(async () => false);
    render(<BulkTagDialog assets={targets} availableTags={[]} busy={false} onCancel={vi.fn()} onConfirm={confirm} />);
    const addInput = screen.getByRole("combobox", { name: "Add tags" });
    fireEvent.change(addInput, { target: { value: "style:flexi" } });
    fireEvent.keyDown(addInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Bulk edit did not complete");
    expect(screen.getByText("2 selected assets")).toBeTruthy();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("blocks changes when any selected target cannot be safely written", () => {
    render(<BulkTagDialog assets={[targets[0], { ...targets[1], metadataState: "blocked" }]} availableTags={[]} busy={false} onCancel={vi.fn()} onConfirm={vi.fn(async () => true)} />);
    expect(screen.getByRole("alert").textContent).toContain("Cannot bulk edit all selected rows");
    expect((screen.getByRole("button", { name: "Confirm changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
