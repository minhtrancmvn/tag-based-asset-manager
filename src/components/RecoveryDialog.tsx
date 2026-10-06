import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { Asset } from "../types";

interface RecoveryDialogProps {
  source: Asset;
  targets: Asset[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (source: Asset, target: Asset) => Promise<boolean>;
}

export function RecoveryDialog({ source, targets, busy, onCancel, onConfirm }: RecoveryDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [targetId, setTargetId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((asset) => asset.id === targetId) ?? null;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (targetId && !targets.some((asset) => asset.id === targetId)) {
      setTargetId("");
      setConfirming(false);
    }
  }, [targetId, targets]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function confirmReconnect(): Promise<void> {
    if (!target || busy || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (!await onConfirm(source, target)) setError("Reconnect did not complete. Review the library error, then rescan before trying again.");
    } finally {
      setSubmitting(false);
    }
  }
  const disabled = busy || submitting;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section ref={dialogRef} className="workflow-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
        <div className="workflow-dialog-heading"><div><span className="dialog-eyebrow">MISSING ASSET RECOVERY</span><h2 id={titleId}>Reconnect metadata</h2></div><button className="icon-button" type="button" aria-label="Cancel reconnect" onClick={onCancel} disabled={disabled}><X size={17} /></button></div>
        <div className="recovery-source"><span>Missing entry</span><strong title={source.relativePath}>{source.relativePath}</strong><small>UUID · {source.metadataId}</small></div>
        {targets.length === 0 ? <p className="dialog-hint">No eligible existing files found in this folder. Nothing has changed.</p> : <label className="dialog-field">Existing file in same folder
          <select aria-label="Existing file in same folder" value={targetId} onChange={(event) => { setTargetId(event.target.value); setConfirming(false); setError(null); }} disabled={disabled || confirming}>
            <option value="">Choose a file</option>
            {targets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}
          </select>
        </label>}
        {target && <div className="recovery-review"><strong>Metadata transfer</strong><div><span>From</span><p title={source.relativePath}>{source.relativePath}</p></div><div><span>To</span><p title={target.relativePath}>{target.relativePath}</p></div><div><span>Tags</span><p>{source.tags.length ? source.tags.join(", ") : "No tags"}</p></div><div><span>Notes</span><p>{source.notes || "No notes"}</p></div><div><span>UUID</span><p>{source.metadataId}</p></div></div>}
        <p className="bulk-warning"><strong>Only sidecar metadata changes.</strong> Asset contents and paths remain untouched. This does not search, compare, or rename files. Review exact source and target before confirming.</p>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={disabled}>Cancel</button>
          {target && !confirming && <button className="primary-button dialog-confirm" type="button" onClick={() => setConfirming(true)} disabled={busy}>Review reconnect</button>}
          {target && confirming && <button className="primary-button dialog-confirm" type="button" onClick={() => void confirmReconnect()} disabled={disabled}>{disabled ? "Reconnecting…" : "Confirm reconnect"}</button>}
        </div>
      </section>
    </div>
  );
}
