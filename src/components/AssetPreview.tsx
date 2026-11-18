import { useEffect, useRef, useState } from "react";
import type { Asset, PreviewResult } from "../types";

interface AssetPreviewProps {
  asset: Asset;
  libraryId: string;
  disabled: boolean;
  load: (asset: Asset) => Promise<PreviewResult | null>;
  /** Called when an image has loaded or text has rendered; never on error or for unsupported previews. */
  onShown?: (kind: "image" | "text") => void;
}

export function AssetPreview({ asset, libraryId, disabled, load, onShown }: AssetPreviewProps) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept in a ref so a new callback never restarts the preview load.
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const textShown = !disabled && asset.status !== "missing" && asset.kind !== "folder" && !loading && !error && preview?.kind === "text" && preview.content !== null;

  useEffect(() => {
    if (textShown) onShownRef.current?.("text");
  }, [textShown]);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    setLoading(false);
    if (disabled || asset.status === "missing" || asset.kind === "folder") return;
    setLoading(true);
    void load(asset).then((result) => {
      if (!cancelled) setPreview(result);
    }).catch(() => {
      if (!cancelled) setError("Could not load preview. The file may be unavailable or changed since scanning.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [asset.id, asset.relativePath, asset.modifiedAt, asset.sizeBytes, asset.status, asset.kind, libraryId, disabled, load]);

  return (
    <section className="asset-preview" aria-label="Asset preview">
      <div className="detail-heading">Preview</div>
      {asset.status === "missing" ? <p>Missing file cannot be previewed.</p>
        : asset.kind === "folder" ? <p>Double-click this folder to browse its contents.</p>
          : disabled ? <p>Preview unavailable while another operation is running.</p>
            : loading ? <p role="status">Loading preview…</p>
              : error ? <p role="alert">{error}</p>
                : preview?.kind === "image" && preview.content ? <img src={preview.content} alt={`Preview of ${asset.name}`} onLoad={() => onShownRef.current?.("image")} onError={() => setError("Image could not be decoded.")} />
                  : preview?.kind === "text" && preview.content !== null ? <><pre>{preview.content || "Empty file."}</pre>{preview.truncated && <p>Showing first 64 KiB.</p>}</>
                    : <p>{preview?.message ?? "No preview available for this file."}</p>}
    </section>
  );
}
