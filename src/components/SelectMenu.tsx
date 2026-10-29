import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface SelectMenuOption {
  value: string;
  label: string;
  /** Optional second line, such as a library path. */
  detail?: string;
}

interface SelectMenuProps {
  id?: string;
  /** Accessible name of the combobox. */
  label: string;
  /** Accessible name of the popup list. */
  listLabel: string;
  options: SelectMenuOption[];
  value: string | null;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Variant class on the root, for example `library-picker` or `filter-menu`. */
  className: string;
  leading?: ReactNode;
}

/** Select-only combobox: focus stays on the trigger, the listbox tracks an active option. */
export function SelectMenu({ id, label, listLabel, options, value, placeholder = "", disabled, onChange, className, leading }: SelectMenuProps) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value) ?? null;
  const isDisabled = disabled || !options.length;
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

  function openList(index = Math.max(0, options.findIndex((option) => option.value === value))): void {
    if (isDisabled) return;
    setActiveIndex(index);
    setOpen(true);
  }

  function choose(index: number): void {
    const option = options[index];
    setOpen(false);
    triggerRef.current?.focus();
    if (option && option.value !== value) onChange(option.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (isDisabled) return;
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const now = Date.now();
      const text = (open && now - typeahead.current.time < 700 ? typeahead.current.text : "") + event.key.toLocaleLowerCase();
      typeahead.current = { text, time: now };
      const prefix = [...text].every((character) => character === text[0]) ? text[0] : text;
      const current = open ? activeIndex : Math.max(0, options.findIndex((option) => option.value === value));
      const start = prefix.length === 1 ? current + 1 : current;
      const index = Array.from({ length: options.length }, (_, offset) => (start + offset) % options.length)
        .find((candidate) => options[candidate].label.toLocaleLowerCase().startsWith(prefix));
      setActiveIndex(index ?? current);
      setOpen(true);
      return;
    }
    typeahead.current = { text: "", time: 0 };
    const last = options.length - 1;
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
    <div className={`select-menu ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className="select-menu-trigger"
        aria-label={label}
        aria-describedby={`${listboxId}-value${selected?.detail ? ` ${listboxId}-detail` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        disabled={isDisabled}
        title={selected?.detail}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        {leading}
        <span className="select-menu-text">
          <span id={`${listboxId}-value`} className="select-menu-label">{selected?.label ?? placeholder}</span>
          {selected?.detail && <span id={`${listboxId}-detail`} className="select-menu-detail">{selected.detail}</span>}
        </span>
        <ChevronDown size={15} className="select-menu-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul ref={listRef} id={listboxId} role="listbox" aria-label={listLabel} className="select-menu-list">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-label={[option.label, option.detail].filter(Boolean).join(" ")}
              aria-selected={option.value === value}
              className={`select-menu-option${index === activeIndex ? " active" : ""}`}
              title={option.detail}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span className="select-menu-text">
                <span className="select-menu-label">{option.label}</span>
                {option.detail && <span className="select-menu-detail">{option.detail}</span>}
              </span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
