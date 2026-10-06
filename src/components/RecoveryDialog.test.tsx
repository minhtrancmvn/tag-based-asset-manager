// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecoveryDialog } from "./RecoveryDialog";
import type { Asset } from "../types";

afterEach(cleanup);

const source: Asset = {
  id: "missing-id", name: "Old Fox.stl", relativePath: "Models/Old Fox.stl", kind: "file", extension: "stl",
  modifiedAt: null, sizeBytes: null, tags: ["theme:fox"], notes: "Keep supports.", metadataId: "metadata-uuid",
  metadataState: "valid", metadataRevision: "source-revision", status: "missing",
};
const target: Asset = {
  id: "target-id", name: "Fox Final.stl", relativePath: "Models/Fox Final.stl", kind: "file", extension: "stl",
  modifiedAt: null, sizeBytes: 100, tags: [], metadataState: "none", metadataRevision: "target-revision", status: "untagged",
};

describe("RecoveryDialog", () => {
  it("shows exact source and selected target, then requires explicit confirmation", async () => {
    const onConfirm = vi.fn<(_: Asset, __: Asset) => Promise<boolean>>().mockResolvedValue(true);
    render(<RecoveryDialog source={source} targets={[target]} busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText("Models/Old Fox.stl")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Existing file in same folder" }), { target: { value: target.id } });
    expect(screen.getByText("Models/Fox Final.stl")).toBeTruthy();
    expect(screen.getByText("Keep supports.")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review reconnect" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm reconnect" }));
    expect(onConfirm).toHaveBeenCalledWith(source, target);
    expect(onConfirm).toHaveBeenCalledOnce();
    await screen.findByRole("dialog");
  });

  it("does nothing when cancelled before confirmation", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn<(_: Asset, __: Asset) => Promise<boolean>>().mockResolvedValue(true);
    render(<RecoveryDialog source={source} targets={[target]} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Existing file in same folder" }), { target: { value: target.id } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows no-target state without offering a write action", () => {
    render(<RecoveryDialog source={source} targets={[]} busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/No eligible existing files found/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm reconnect/ })).toBeNull();
  });
});
