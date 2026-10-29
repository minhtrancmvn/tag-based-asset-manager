// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "../types";
import { RemoveMissingEntryDialog } from "./RemoveMissingEntryDialog";

afterEach(cleanup);

const missing: Asset = {
  id: "path:gone.stl", name: "gone.stl", relativePath: "gone.stl", kind: "file", extension: "stl", modifiedAt: null, sizeBytes: null,
  tags: ["theme:fox"], notes: "Keep supports.", status: "missing", metadataId: "uuid", metadataState: "valid", metadataRevision: "rev1",
};

describe("RemoveMissingEntryDialog", () => {
  it("starts on Cancel, names the tags and notes, and closes on Escape without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<RemoveMissingEntryDialog asset={missing} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("theme:fox")).toBeTruthy();
    expect(screen.getByText(/deletes its tags and notes/)).toBeTruthy();
    expect(screen.getByText(/No asset files are changed\./)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("groups the warning and actions in a confirmation form", () => {
    render(<RemoveMissingEntryDialog asset={missing} busy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Remove missing entry confirmation" });
    expect(form.contains(screen.getByRole("list"))).toBe(true);
    expect(form.contains(screen.getByText(/No asset files are changed\./))).toBe(true);
    expect(form.contains(screen.getByRole("button", { name: "Cancel" }))).toBe(true);
    expect(form.contains(screen.getByRole("button", { name: "Remove entry" }))).toBe(true);
  });

  it("reports a failed removal and keeps the dialog open", async () => {
    const onConfirm = vi.fn().mockResolvedValue(false);
    render(<RemoveMissingEntryDialog asset={missing} busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove entry" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Remove entry" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("keeps Tab focus on the modal while removal is pending", async () => {
    let resolve!: (value: boolean) => void;
    const pending = new Promise<boolean>((done) => { resolve = done; });
    render(<RemoveMissingEntryDialog asset={missing} busy={false} onCancel={vi.fn()} onConfirm={() => pending} />);
    const submit = screen.getByRole("button", { name: "Remove entry" });
    submit.focus();
    fireEvent.click(submit);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
    resolve(false);
    await screen.findByRole("alert");
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove entry" }));
  });

  it("disables both actions while the library is busy", () => {
    render(<RemoveMissingEntryDialog asset={missing} busy onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove entry" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
