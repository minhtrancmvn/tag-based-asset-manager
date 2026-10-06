import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Plus, X } from "lucide-react";
import { tagGroup } from "../catalog";

interface TagEditorProps {
  tags: string[];
  availableTags: string[];
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  onFilter?: (tag: string) => void;
  onAdd: (tag: string) => Promise<boolean>;
  onRemove: (tag: string) => Promise<boolean>;
}

function stopRowEvent(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void {
  event.stopPropagation();
}

export function TagEditor({ tags, availableTags, disabled = false, busy = false, compact = false, onFilter, onAdd, onRemove }: TagEditorProps) {
  const inputId = useId();
  const addPending = useRef(false);
  const [value, setValue] = useState("");
  const normalizedValue = value.trim().toLowerCase();
  const suggestions = useMemo(() => normalizedValue ? availableTags
    .filter((tag) => tag.toLowerCase().startsWith(normalizedValue) && !tags.some((current) => current.toLowerCase() === tag.toLowerCase()))
    .slice(0, 6) : [], [availableTags, normalizedValue, tags]);

  async function addTag(rawTag: string): Promise<void> {
    const tag = rawTag.trim().toLowerCase();
    if (!tag || tags.some((current) => current.toLowerCase() === tag) || disabled || busy || addPending.current) return;
    addPending.current = true;
    try {
      if (await onAdd(tag)) {
        setValue("");
      }
    } finally {
      addPending.current = false;
    }
  }

  async function removeTag(tag: string): Promise<void> {
    if (!disabled && !busy) await onRemove(tag);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    stopRowEvent(event);
    if (event.key === "Enter") {
      event.preventDefault();
      void addTag(value);
    }
  }

  return (
    <div className={`tag-editor ${compact ? "tag-editor-compact" : ""}`} onClick={stopRowEvent} onKeyDown={stopRowEvent}>
      <div className="tags-content">
        {tags.map((tag) => (
          <span className={`tag-chip tag-${tagGroup(tag).toLowerCase()} ${compact ? "tag-small" : ""}`} key={tag} title={tag}>
            <button type="button" className="tag-label-button" disabled={!onFilter} onClick={(event) => { stopRowEvent(event); onFilter?.(tag); }} onKeyDown={stopRowEvent}>{tag}</button>
            <button type="button" className="tag-remove" aria-label={`Remove tag ${tag}`} title={`Remove ${tag}`} disabled={disabled || busy} onClick={(event) => { stopRowEvent(event); void removeTag(tag); }} onKeyDown={stopRowEvent}>
              <X size={compact ? 11 : 12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <div className="tag-add-wrap">
          <label className="sr-only" htmlFor={`tag-input-${inputId}`}>Add tag</label>
          <input
            id={`tag-input-${inputId}`}
            className="tag-add-input"
            value={value}
            placeholder={tags.length ? "Add tag" : "Add a tag"}
            disabled={disabled || busy}
            aria-label="Add tag"
            list={`tag-options-${inputId}`}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onClick={stopRowEvent}
          />
          {busy ? <span className="tag-busy" role="status">Saving…</span> : <Plus size={12} className="tag-add-icon" aria-hidden="true" />}
          <datalist id={`tag-options-${inputId}`}>
            {suggestions.map((tag) => <option key={tag} value={tag} />)}
          </datalist>
        </div>
      </div>
    </div>
  );
}
