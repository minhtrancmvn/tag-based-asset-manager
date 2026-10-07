import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { Asset } from "../types";

interface DeleteAssetsDialogProps {
  assets: Asset[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (assets: Asset[]) => Promise<boolean>;
}

/** Two-step confirmation; native trash never runs before explicit confirm. */
export function DeleteAssetsDialog({ assets, busy, onCancel, onConfirm }: DeleteAssetsDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || submitting;
  const folders = assets.filter((asset) => asset.kind === "folder").length;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !disabled) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function confirmDelete(): Promise<void> {
    if (disabled) return;
    setError(null);
    setSubmitting(true);
    try {
      if (!await onConfirm(assets)) setError("Some items may already be in Trash / Recycle Bin. Review the library error and rescan before retrying.");
    } catch {
      setError("Could not move items to Trash / Recycle Bin. Review the library error and rescan before retrying.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !disabled) onCancel(); }}>
      <section ref={dialogRef} className="workflow-dialog delete-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
        <div className="workflow-dialog-heading"><div><span className="dialog-eyebrow">MOVE TO TRASH / RECYCLE BIN</span><h2 id={titleId}>Delete {assets.length === 1 ? assets[0].name : `${assets.length} items`}</h2></div><button className="icon-button" type="button" aria-label="Cancel delete" onClick={onCancel} disabled={disabled}><X size={17} /></button></div>
        <div className="bulk-target-summary"><span><strong>{assets.length}</strong> selected {assets.length === 1 ? "item" : "items"}{folders ? ` · ${folders} folder${folders === 1 ? "" : "s"}` : ""}</span></div>
        <ul className="delete-target-list">{assets.map((asset) => <li key={asset.id}><span className={asset.kind === "folder" ? "delete-folder" : ""} title={asset.relativePath}>{asset.relativePath}</span>{asset.tags.length > 0 && <em>{asset.tags.join(", ")}</em>}</li>)}</ul>
        {confirming && <p className="dialog-error" role="alert">This moves the listed items to Trash / Recycle Bin. Folders include all their contents and sidecars. Metadata in remaining folders is preserved for recovery; a rescan may show missing references. Restore through your system file manager. No permanent-delete fallback.</p>}
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>Cancel</button>
          {!confirming && <button className="danger-button" type="button" onClick={() => setConfirming(true)} disabled={disabled}>Review delete</button>}
          {confirming && <button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={disabled}>{disabled ? "Deleting…" : `Delete ${assets.length === 1 ? "item" : `${assets.length} items`}`}</button>}
        </div>
      </section>
    </div>
  );
}
