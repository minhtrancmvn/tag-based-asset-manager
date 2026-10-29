import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { AppError, Asset } from "../types";

interface RemoveMissingEntryDialogProps {
  asset: Asset;
  busy: boolean;
  error?: AppError | null;
  onCancel: () => void;
  onConfirm: () => Promise<boolean>;
}

/** Explicit removal of one missing file's sidecar entry; no asset file is touched. */
export function RemoveMissingEntryDialog({ asset, busy, error, onCancel, onConfirm }: RemoveMissingEntryDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const disabled = busy || submitting;
  const failureMessage = error?.message ?? (failed ? "Could not remove the entry. Cancel and rescan before trying again." : null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(".secondary-button:not(:disabled)")?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (disabled) dialogRef.current?.focus();
  }, [disabled]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !disabled) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), summary")];
    if (!controls.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (document.activeElement === dialogRef.current) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function confirmRemoval(): Promise<void> {
    if (disabled) return;
    setFailed(false);
    setSubmitting(true);
    try {
      if (!await onConfirm()) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !disabled) onCancel(); }}>
      <section ref={dialogRef} className="workflow-dialog delete-dialog remove-entry-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={handleKeyDown}>
        <div className="workflow-dialog-heading"><div><span className="dialog-eyebrow">REMOVE MISSING ENTRY</span><h2 id={titleId}>Remove entry for {asset.name}</h2></div><button className="icon-button" type="button" aria-label="Cancel removal" onClick={onCancel} disabled={disabled}><X size={17} /></button></div>
        <form aria-label="Remove missing entry confirmation" onSubmit={(event) => { event.preventDefault(); void confirmRemoval(); }}>
          <ul className="delete-target-list"><li><span title={asset.relativePath}>{asset.relativePath}</span>{asset.tags.length > 0 && <em>{asset.tags.join(", ")}</em>}</li></ul>
          <p className="bulk-warning">This file is no longer in its folder. Removing the entry deletes its tags{asset.notes ? " and notes" : ""} from the folder's .asset-tags.json. No asset files are changed. Export a metadata backup first if you might need them again.</p>
          {failureMessage && <div className="dialog-error" role="alert"><strong>{failureMessage}</strong>{(error?.path || error?.details) && <details><summary>Technical details</summary>{error.path && <p>{error.path}</p>}{error.details && <pre>{error.details}</pre>}</details>}</div>}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>Cancel</button>
            <button className="danger-button" type="submit" disabled={disabled}>{submitting ? "Removing…" : "Remove entry"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
