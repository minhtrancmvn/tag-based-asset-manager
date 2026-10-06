import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { SearchFilters, SavedSearch } from "../types";
import { serializeFilters } from "../savedSearches";

interface SavedSearchDialogProps {
  filters: SearchFilters;
  searches: SavedSearch[];
  busy: boolean;
  onCancel: () => void;
  onSave: (name: string, filters: SearchFilters, searchId?: string) => Promise<boolean>;
  onDelete: (search: SavedSearch) => Promise<boolean>;
}

export function SavedSearchDialog({ filters, searches, busy, onCancel, onSave, onDelete }: SavedSearchDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = searches.find((search) => search.id === selectedId);

  useEffect(() => {
    if (selected) setName(selected.name);
  }, [selected]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>("input[aria-label='Search name']:not(:disabled), select:not(:disabled), button:not(:disabled)");
    first?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); onCancel(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await saveNew();
  }

  async function saveNew(): Promise<void> {
    const normalizedName = name.trim();
    if (busy || !normalizedName) return;
    const collision = searches.find((search) => search.name.toLowerCase() === normalizedName.toLowerCase());
    if (collision) {
      setError(`“${collision.name}” already exists. Select it to update or rename it.`);
      return;
    }
    setError(null);
    if (!await onSave(normalizedName, filters)) setError("Search was not saved. Review the library error details and try again.");
  }

  async function updateCurrent(): Promise<void> {
    if (!selected || busy || !name.trim()) return;
    const collision = searches.find((search) => search.name.toLowerCase() === name.trim().toLowerCase() && search.id !== selected.id);
    if (collision) {
      setError(`“${collision.name}” already exists. Select it to update or rename it.`);
      return;
    }
    setError(null);
    if (!await onSave(name.trim(), filters, selected.id)) setError("Search was not updated. Review the library error details and try again.");
  }

  async function renameCurrent(): Promise<void> {
    if (!selected || busy || !name.trim() || name.trim() === selected.name) return;
    const collision = searches.find((search) => search.name.toLowerCase() === name.trim().toLowerCase() && search.id !== selected.id);
    if (collision) {
      setError(`“${collision.name}” already exists. Select it to update or rename it.`);
      return;
    }
    setError(null);
    if (!await onSave(name.trim(), selected.filters, selected.id)) setError("Search was not renamed. Review the library error details and try again.");
  }

  async function remove(): Promise<void> {
    if (!selected || busy) return;
    if (!window.confirm(`Delete saved search “${selected.name}”? This will not change files or metadata.`)) return;
    setError(null);
    if (!await onDelete(selected)) setError("Search was not deleted. Review the library error details and try again.");
  }

  const savingCurrent = selected ? serializeFilters(selected.filters) === serializeFilters(filters) : false;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section ref={dialogRef} className="workflow-dialog saved-search-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleDialogKeyDown}>
        <div className="workflow-dialog-heading"><div><span className="dialog-eyebrow">APP-LOCAL FILTERS</span><h2 id={titleId}>Saved searches</h2></div><button className="icon-button" type="button" aria-label="Close saved searches" onClick={onCancel} disabled={busy}><X size={17} /></button></div>
        <form onSubmit={(event) => void submit(event)}>
          {searches.length > 0 && <label className="dialog-field">Existing search<select aria-label="Existing saved search" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setError(null); }} disabled={busy}><option value="">Create new search</option>{searches.map((search) => <option key={search.id} value={search.id}>{search.name}</option>)}</select></label>}
          <label className="dialog-field">Search name<input aria-label="Search name" autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(null); }} maxLength={100} placeholder="e.g. Untagged miniatures" disabled={busy} /></label>
          <div className="saved-filter-summary"><strong>Filters saved</strong><span>View: {filters.view}</span><span>Query: {filters.query || "None"}</span><span>Tag matching: {filters.matchMode === "all" ? "All required tags" : "Any required tag"}</span><span>Kind: {filters.kind === "all" ? "Files and folders" : `${filters.kind}s only`}</span></div>
          {selected && !savingCurrent && <p className="dialog-hint">Update replaces saved filters. Rename changes only the name and preserves its saved filters.</p>}
          {error && <div className="dialog-error" role="alert">{error}</div>}
          <div className="dialog-actions saved-search-actions">{selected && <button className="danger-button" type="button" onClick={() => void remove()} disabled={busy}>Delete…</button>}<button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Close</button><button className="secondary-button" type="button" disabled={busy || !name.trim()} onClick={() => void saveNew()}>{busy ? "Saving…" : "Save as new"}</button><button className="primary-button dialog-confirm" type="button" disabled={busy || !name.trim() || !selected || savingCurrent} onClick={() => void updateCurrent()}>{busy ? "Saving…" : "Update search"}</button></div>
          {selected && <div className="rename-row"><span>Rename preserves saved filters</span><button className="text-button" type="button" disabled={busy || !name.trim() || name.trim() === selected.name} onClick={() => void renameCurrent()}>Rename search</button></div>}
        </form>
      </section>
    </div>
  );
}
