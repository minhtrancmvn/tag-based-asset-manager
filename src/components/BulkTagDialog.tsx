import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { Asset } from "../types";

interface BulkTagDialogProps {
  assets: Asset[];
  availableTags: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (addTags: string[], removeTags: string[]) => Promise<boolean>;
}

export function BulkTagDialog({ assets, availableTags, busy, onCancel, onConfirm }: BulkTagDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [addValue, setAddValue] = useState("");
  const [removeValue, setRemoveValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<string[]>([]);
  const [removeDraft, setRemoveDraft] = useState<string[]>([]);
  const additions = addDraft;
  const removals = removeDraft;
  const blocked = assets.filter((asset) => asset.status === "missing" || asset.metadataState === "blocked" || !asset.metadataRevision);

  const overlapping = additions.filter((tag) => removals.includes(tag));

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled), button:not(:disabled)");
    first?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  function addTag(rawTag: string, mode: "add" | "remove"): void {
    const tag = rawTag.trim().toLowerCase();
    if (!tag) return;
    if (mode === "add") {
      if (!addDraft.includes(tag)) setAddDraft((current) => [...current, tag]);
      setAddValue("");
    } else {
      if (!removeDraft.includes(tag)) setRemoveDraft((current) => [...current, tag]);
      setRemoveValue("");
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); onCancel(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>, mode: "add" | "remove"): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      addTag(event.currentTarget.value, mode);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || blocked.length || overlapping.length || (!additions.length && !removals.length)) return;
    setError(null);
    if (!await onConfirm(additions, removals)) setError("Bulk edit did not complete. Check the library error above; it reports whether any changes were applied.");
  }


  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section ref={dialogRef} className="workflow-dialog bulk-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleDialogKeyDown}>
        <div className="workflow-dialog-heading"><div><span className="dialog-eyebrow">BULK SIDECAR EDIT</span><h2 id={titleId}>Review tag changes</h2></div><button className="icon-button" type="button" aria-label="Cancel bulk edit" onClick={onCancel} disabled={busy}><X size={17} /></button></div>
        <form onSubmit={(event) => void submit(event)}>
          <p className="bulk-target-summary"><strong>{assets.length} selected assets</strong><span>Exact target snapshot is fixed until this dialog closes.</span></p>
          <label className="dialog-field">Add tags <input aria-label="Add tags" list={`${titleId}-add`} value={addValue} onChange={(event) => setAddValue(event.target.value)} onKeyDown={(event) => handleTagKeyDown(event, "add")} placeholder="Type tag and press Enter" disabled={busy} /></label>
          <datalist id={`${titleId}-add`}>{availableTags.filter((tag) => !addDraft.includes(tag.toLowerCase())).map((tag) => <option key={tag} value={tag} />)}</datalist>
          <div className="bulk-tag-drafts" aria-label="Tags to add">{additions.map((tag) => <button type="button" key={tag} disabled={busy} onClick={() => setAddDraft((current) => current.filter((item) => item !== tag))}>{tag} <span aria-hidden="true">×</span><span className="sr-only">Remove from add list</span></button>)}</div>
          <label className="dialog-field">Remove tags <input aria-label="Remove tags" list={`${titleId}-remove`} value={removeValue} onChange={(event) => setRemoveValue(event.target.value)} onKeyDown={(event) => handleTagKeyDown(event, "remove")} placeholder="Type tag and press Enter" disabled={busy} /></label>
          <datalist id={`${titleId}-remove`}>{availableTags.filter((tag) => !removeDraft.includes(tag.toLowerCase())).map((tag) => <option key={tag} value={tag} />)}</datalist>
          <div className="bulk-tag-drafts" aria-label="Tags to remove">{removals.map((tag) => <button type="button" key={tag} disabled={busy} onClick={() => setRemoveDraft((current) => current.filter((item) => item !== tag))}>{tag} <span aria-hidden="true">×</span><span className="sr-only">Remove from remove list</span></button>)}</div>
          <p className="dialog-hint">Pick existing tags or type a tag and press Enter. No changes write until Confirm changes.</p>
          <div className="bulk-review" aria-live="polite"><strong>Change summary</strong><div><span>Adding</span><p>{additions.length ? additions.join(", ") : "No tags"}</p></div><div><span>Removing</span><p>{removals.length ? removals.join(", ") : "No tags"}</p></div></div>
          {blocked.length > 0 && <div className="dialog-error" role="alert">Cannot bulk edit all selected rows. {blocked.map((asset) => `${asset.name}: ${asset.metadataState === "blocked" ? "metadata issue" : asset.status === "missing" ? "missing asset" : "no metadata revision"}`).join("; ")}</div>}
          {overlapping.length > 0 && <div className="dialog-error" role="alert">Same tag cannot be added and removed: {overlapping.join(", ")}</div>}
          <div className="bulk-warning"><strong>Writes are atomic per manifest, not across folders.</strong> If a write fails, earlier completed changes stay saved and the error reports how many assets were applied. No asset files or paths change.</div>
          {error && <div className="dialog-error" role="alert">{error}</div>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="primary-button dialog-confirm" type="submit" disabled={busy || blocked.length > 0 || overlapping.length > 0 || (!additions.length && !removals.length)}>{busy ? "Saving…" : "Confirm changes"}</button></div>
        </form>
      </section>
    </div>
  );
}
