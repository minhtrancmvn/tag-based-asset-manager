import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import type { LibrarySummary } from "../types";

interface RemoveLibraryDialogProps {
  library: LibrarySummary;
  savedSearchCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** In-app confirmation for unregistering a library. window.confirm is not usable: the Tauri dialog plugin replaces it with an async stub. */
export function RemoveLibraryDialog({ library, savedSearchCount, onCancel, onConfirm }: RemoveLibraryDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(".secondary-button")?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button")];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section ref={dialogRef} className="workflow-dialog delete-dialog remove-library-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
        <div className="workflow-dialog-heading"><div><span className="dialog-eyebrow">REMOVE LIBRARY REGISTRATION</span><h2 id={titleId}>Remove “{library.name}” from this app?</h2></div><button className="icon-button" type="button" aria-label="Cancel library removal" onClick={onCancel}><X size={17} /></button></div>
        <form aria-label="Remove library confirmation" onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
          <ul className="delete-target-list"><li><span title={library.rootPath}>{library.rootPath}</span></li></ul>
          <p className="bulk-warning">Files and folders will not be changed. {savedSearchCount > 0 ? `${savedSearchCount === 1 ? "Its saved search" : `Its ${savedSearchCount} saved searches`} will be deleted from this app.` : "This library has no saved searches."}</p>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
            <button className="danger-button" type="submit">Remove library</button>
          </div>
        </form>
      </section>
    </div>
  );
}
