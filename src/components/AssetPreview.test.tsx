// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AssetPreview } from "./AssetPreview";
import type { Asset, PreviewResult } from "../types";

afterEach(cleanup);
const asset: Asset = { id: "path:readme.txt", name: "readme.txt", relativePath: "readme.txt", kind: "file", extension: "txt", modifiedAt: null, sizeBytes: 10, tags: [], status: "untagged" };
const text: PreviewResult = { kind: "text", content: "<script>not executed</script>", mimeType: "text/plain", truncated: true, message: null };

describe("AssetPreview", () => {
  it("renders text as plain content and identifies truncation", async () => {
    render(<AssetPreview asset={asset} libraryId="lib" disabled={false} load={vi.fn().mockResolvedValue(text)} />);
    expect(await screen.findByText(text.content!)).toBeTruthy();
    expect(screen.getByText("Showing first 64 KiB.")).toBeTruthy();
    expect(screen.getByLabelText("Asset preview").querySelector("script")).toBeNull();
  });
  it("renders a raster image", async () => {
    const image: PreviewResult = { kind: "image", content: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png", truncated: false, message: null };
    render(<AssetPreview asset={{ ...asset, name: "photo.png" }} libraryId="lib" disabled={false} load={vi.fn().mockResolvedValue(image)} />);
    expect((await screen.findByRole<HTMLImageElement>("img", { name: "Preview of photo.png" })).src).toBe(image.content);
  });
  it("ignores late preview results after selecting another file", async () => {
    let resolve!: (value: PreviewResult) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<PreviewResult>((done) => { resolve = done; })).mockResolvedValue({ ...text, content: "new preview", truncated: false });
    const { rerender } = render(<AssetPreview asset={asset} libraryId="lib" disabled={false} load={load} />);
    rerender(<AssetPreview asset={{ ...asset, id: "path:new.txt", name: "new.txt" }} libraryId="lib" disabled={false} load={load} />);
    expect(await screen.findByText("new preview")).toBeTruthy();
    await act(async () => resolve(text));
    expect(screen.queryByText(text.content!)).toBeNull();
    expect(screen.getByText("new preview")).toBeTruthy();
  });
  it("does not read missing files, folders or disabled previews", () => {
    const load = vi.fn();
    const { rerender } = render(<AssetPreview asset={{ ...asset, status: "missing" }} libraryId="lib" disabled={false} load={load} />);
    expect(screen.getByText("Missing file cannot be previewed.")).toBeTruthy();
    rerender(<AssetPreview asset={{ ...asset, kind: "folder" }} libraryId="lib" disabled={false} load={load} />);
    expect(screen.getByText(/Double-click this folder/)).toBeTruthy();
    rerender(<AssetPreview asset={asset} libraryId="lib" disabled={true} load={load} />);
    expect(load).not.toHaveBeenCalled();
  });
  it("shows an explicit preview error", async () => {
    render(<AssetPreview asset={asset} libraryId="lib" disabled={false} load={vi.fn().mockRejectedValue(new Error("missing"))} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not load preview"));
  });
});
