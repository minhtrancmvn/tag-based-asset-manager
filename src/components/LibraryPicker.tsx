import { Check, ChevronDown, FolderOpen } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { LibrarySummary } from "../types";

interface LibraryPickerProps {
  libraries: LibrarySummary[];
  activeLibraryId: string | null;
  disabled: boolean;
  onActivate: (libraryId: string) => void;
}

/** Select-only combobox: focus stays on the trigger, the listbox tracks an active option. */
export function LibraryPicker({ libraries, activeLibraryId, disabled, onActivate }: LibraryPickerProps) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = libraries.find((item) => item.id === activeLibraryId) ?? null;
  const isDisabled = disabled || !libraries.length;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    if (isDisabled) setOpen(false);
  }, [isDisabled]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!listRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, listboxId]);

  function openList(index = Math.max(0, libraries.findIndex((item) => item.id === activeLibraryId))): void {
    if (isDisabled) return;
    setActiveIndex(index);
    setOpen(true);
  }

  function choose(index: number): void {
    const item = libraries[index];
    setOpen(false);
    triggerRef.current?.focus();
    if (item && item.id !== activeLibraryId) onActivate(item.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const last = libraries.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        openList(event.key === "Home" ? 0 : last);
      }
      return;
    }
    if (event.key === "ArrowDown") setActiveIndex((index) => Math.min(last, index + 1));
    else if (event.key === "ArrowUp") setActiveIndex((index) => Math.max(0, index - 1));
    else if (event.key === "Home") setActiveIndex(0);
    else if (event.key === "End") setActiveIndex(last);
    else if (event.key === "Enter" || event.key === " ") choose(activeIndex);
    else if (event.key === "Escape") setOpen(false);
    else if (event.key === "Tab") {
      setOpen(false);
      return;
    } else return;
    event.preventDefault();
  }

  return (
    <div className="library-picker">
      <button
        ref={triggerRef}
        id="library-picker"
        type="button"
        role="combobox"
        className="library-picker-trigger"
        aria-label="Active library"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        disabled={isDisabled}
        title={active?.rootPath}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        <span className="library-avatar"><FolderOpen size={18} strokeWidth={1.7} /></span>
        <span className="library-picker-text">
          <span className="library-picker-name">{active?.name ?? (libraries.length ? "Choose a library" : "No libraries")}</span>
          {active && <span className="library-picker-path">{active.rootPath}</span>}
        </span>
        <ChevronDown size={15} className="library-picker-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul ref={listRef} id={listboxId} role="listbox" aria-label="Libraries" className="library-picker-list">
          {libraries.map((item, index) => (
            <li
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-label={item.name}
              aria-selected={item.id === activeLibraryId}
              className={`library-picker-option${index === activeIndex ? " active" : ""}`}
              title={item.rootPath}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="library-picker-option-text">
                <span className="library-picker-name">{item.name}</span>
                <span className="library-picker-path">{item.rootPath}</span>
              </span>
              {item.id === activeLibraryId && <Check size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
