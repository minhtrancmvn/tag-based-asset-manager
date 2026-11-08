import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import type { AppTheme } from "../themes";
import { themeAppearance, themeOptions, themePalettes } from "../themes";

interface ThemeSettingsProps {
  theme: AppTheme;
  saving: boolean;
  disabled: boolean;
  onThemeChange: (theme: AppTheme) => Promise<boolean>;
}

interface PopoverPosition {
  left: number;
  top: number;
  maxHeight: number;
  columns: number;
}

const VIEWPORT_MARGIN = 8;
const POPOVER_WIDTH = 640;
const TILE_MIN_WIDTH = 72;
const TILE_GAP = 8;
const POPOVER_CHROME = 30;
/** Seven columns hold the 14 light themes in two full rows and the 6 dark themes in one; narrower steps are fallbacks. */
const COLUMN_STEPS = [7, 5, 4, 3] as const;

/** Light themes first, then dark, each in preset order; the stored preset order is unchanged. */
const themeGroups = (["light", "dark"] as const).map((mode) => ({
  mode,
  label: mode === "light" ? "Light" : "Dark",
  options: themeOptions.filter((option) => themeAppearance[option.value].mode === mode),
}));
const orderedOptions = themeGroups.flatMap((group) => group.options);
const groupStarts = themeGroups.map((_, index) => themeGroups.slice(0, index).reduce((total, group) => total + group.options.length, 0));

function orderedIndexOf(theme: AppTheme): number {
  return Math.max(0, orderedOptions.findIndex((option) => option.value === theme));
}

/** Option index one row up or down, moving between the light and dark grids at the same column where possible. */
function verticalIndex(index: number, direction: 1 | -1, columns: number): number {
  const group = index >= groupStarts[1] ? 1 : 0;
  const size = themeGroups[group].options.length;
  const offset = index - groupStarts[group];
  const row = Math.floor(offset / columns);
  const column = offset % columns;
  const lastRow = Math.floor((size - 1) / columns);
  if (direction === 1 && row < lastRow) return groupStarts[group] + Math.min(offset + columns, size - 1);
  if (direction === -1 && row > 0) return index - columns;
  const target = group + direction;
  if (target < 0 || target >= themeGroups.length) return index;
  const targetSize = themeGroups[target].options.length;
  const targetRow = direction === 1 ? 0 : Math.floor((targetSize - 1) / columns);
  return groupStarts[target] + Math.min(targetRow * columns + column, targetSize - 1);
}
const POPOVER_GAP = 8;
const FALLBACK_POPOVER_HEIGHT = 260;

function columnsForWidth(viewportWidth: number): number {
  const availableWidth = Math.min(POPOVER_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  for (const columns of COLUMN_STEPS) {
    if (availableWidth >= columns * TILE_MIN_WIDTH + (columns - 1) * TILE_GAP + POPOVER_CHROME) return columns;
  }
  return 2;
}

function calculatePopoverPosition(
  triggerRect: Pick<DOMRect, "left" | "bottom" | "top">,
  viewport: { width: number; height: number },
  popoverSize: { width: number; height: number },
): PopoverPosition {
  const width = Math.min(popoverSize.width, Math.max(0, viewport.width - VIEWPORT_MARGIN * 2));
  const height = Math.min(popoverSize.height, Math.max(0, viewport.height - VIEWPORT_MARGIN * 2));
  const maxHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2);
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, triggerRect.left),
    Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN),
  );
  const belowTop = triggerRect.bottom + POPOVER_GAP;
  const aboveTop = triggerRect.top - height - POPOVER_GAP;
  const fitsBelow = belowTop + height <= viewport.height - VIEWPORT_MARGIN;
  const fitsAbove = aboveTop >= VIEWPORT_MARGIN;
  const top = fitsBelow
    ? belowTop
    : fitsAbove
      ? aboveTop
      : Math.min(Math.max(VIEWPORT_MARGIN, belowTop), Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN));
  return { left, top, maxHeight, columns: columnsForWidth(viewport.width) };
}

/** Flat preview of a theme: its frame, the sheet and the accent, painted by CSS from these three properties. */
function swatchStyle(theme: AppTheme): CSSProperties {
  const palette = themePalettes[theme];
  return { "--swatch-frame": palette.floor, "--swatch-sheet": palette.paper, "--swatch-line": palette.line, "--swatch-accent": palette.accent } as CSSProperties;
}

export function ThemeSettings({ theme, saving, disabled, onThemeChange }: ThemeSettingsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestPending = useRef(false);
  const requestedTheme = useRef<AppTheme | null>(null);
  const [open, setOpen] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(() => orderedIndexOf(theme));

  const isBusy = disabled || saving || requestInFlight;
  const pendingTheme = requestInFlight ? requestedTheme.current : null;
  const selectedOption = themeOptions.find((option) => option.value === theme) ?? themeOptions[0];
  const selectedAppearance = themeAppearance[theme];

  const measureAndPosition = useCallback((): void => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const nextPosition = calculatePopoverPosition(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width: popover.offsetWidth || POPOVER_WIDTH, height: popover.offsetHeight || FALLBACK_POPOVER_HEIGHT },
    );
    setPosition((previous) => previous?.left === nextPosition.left
      && previous.top === nextPosition.top
      && previous.maxHeight === nextPosition.maxHeight
      && previous.columns === nextPosition.columns
      ? previous
      : nextPosition);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measureAndPosition();
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureAndPosition);
    resizeObserver?.observe(trigger);
    resizeObserver?.observe(popover);
    window.addEventListener("resize", measureAndPosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureAndPosition);
    };
  }, [open, measureAndPosition]);

  useEffect(() => {
    if (!open) return;
    function handleDocumentPointerDown(event: globalThis.PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const inPopover = popoverRef.current?.contains(target) ?? false;
      const inTrigger = triggerRef.current?.contains(target) ?? false;
      if (!inPopover && !inTrigger) {
        setOpen(false);
      }
    }
    function handleWindowScroll(event: Event): void {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function handleWindowWheel(event: WheelEvent): void {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    window.addEventListener("scroll", handleWindowScroll, true);
    window.addEventListener("wheel", handleWindowWheel, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      window.removeEventListener("scroll", handleWindowScroll, true);
      window.removeEventListener("wheel", handleWindowWheel, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const initialIndex = orderedIndexOf(theme);
    setFocusedIndex(initialIndex);
    optionRefs.current[initialIndex]?.focus();
  }, [open]);

  const closeAndRestoreTrigger = useCallback((): void => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  function handleTriggerClick(): void {
    if (open) {
      setOpen(false);
      return;
    }
    if (isBusy) return;
    setFocusedIndex(orderedIndexOf(theme));
    setPosition(null);
    setOpen(true);
  }

  async function handleThemeSelect(nextTheme: AppTheme): Promise<void> {
    if (requestPending.current || disabled || saving || nextTheme === theme) return;
    requestPending.current = true;
    requestedTheme.current = nextTheme;
    setRequestInFlight(true);
    try {
      await onThemeChange(nextTheme);
    } catch {
      // Parent owns persistence errors; committed theme stays controlled here.
    } finally {
      requestPending.current = false;
      requestedTheme.current = null;
      setRequestInFlight(false);
    }
  }

  function moveFocus(index: number): void {
    const nextIndex = Math.min(orderedOptions.length - 1, Math.max(0, index));
    setFocusedIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreTrigger();
      return;
    }
    if (event.key === "Tab") return;
    const columns = position?.columns ?? columnsForWidth(window.innerWidth);
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = index + 1;
        break;
      case "ArrowLeft":
        nextIndex = index - 1;
        break;
      case "ArrowDown":
        nextIndex = verticalIndex(index, 1, columns);
        break;
      case "ArrowUp":
        nextIndex = verticalIndex(index, -1, columns);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = orderedOptions.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    moveFocus(nextIndex);
  }

  function handlePopoverFocusOut(event: FocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && (event.currentTarget.contains(nextTarget) || triggerRef.current?.contains(nextTarget))) return;
    setOpen(false);
  }

  const triggerStyle = swatchStyle(theme);

  return (
    <div className="theme-settings">
      <button
        ref={triggerRef}
        type="button"
        className="theme-trigger"
        aria-label="Color theme"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="theme-popover"
        aria-disabled={isBusy && !open}
        title={disabled ? "Theme setting unavailable" : isBusy && !open ? "Theme setting busy" : undefined}
        style={triggerStyle}
        onClick={handleTriggerClick}
        onKeyDown={(event) => {
          if (isBusy && !open && (event.key === "Enter" || event.key === " ")) event.preventDefault();
        }}
      >
        <span className="theme-trigger-swatch" aria-hidden="true" />
        <span>{selectedOption.label}</span>
      </button>
      {(saving || requestInFlight) && (
        <span className="theme-saving" role="status">
          {pendingTheme
            ? `Saving ${themeOptions.find((option) => option.value === pendingTheme)?.label ?? "theme"}…`
            : "Saving theme…"}
        </span>
      )}
      {open && createPortal(
        <div
          ref={popoverRef}
          id="theme-popover"
          className="theme-popover"
          role="dialog"
          aria-label="Color theme choices"
          data-mode={selectedAppearance.mode}
          onBlur={handlePopoverFocusOut}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeAndRestoreTrigger();
            }
          }}
          style={position ? {
            position: "fixed",
            left: `${position.left}px`,
            top: `${position.top}px`,
            width: `min(${POPOVER_WIDTH}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
            maxHeight: `${position.maxHeight}px`,
            overflowY: "auto",
          } : {
            position: "fixed",
            left: `${VIEWPORT_MARGIN}px`,
            top: `${VIEWPORT_MARGIN}px`,
            width: `min(${POPOVER_WIDTH}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
            maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
            overflowY: "auto",
          }}
        >
          <div className="theme-popover-header">
            <span>Choose color theme</span>
            <button type="button" className="theme-popover-close" aria-label="Close theme choices" onClick={closeAndRestoreTrigger}>×</button>
          </div>
          <div className="theme-groups" role="group" aria-label="Color themes">
            {themeGroups.map((group, groupIndex) => <div className="theme-group-section" key={group.mode}>
            <div className="theme-group-label" id={`theme-group-${group.mode}`}>{group.label}</div>
            <div className="theme-grid" role="group" aria-labelledby={`theme-group-${group.mode}`} data-columns={position?.columns ?? columnsForWidth(window.innerWidth)}>
            {group.options.map((option, groupOffset) => {
              const index = groupStarts[groupIndex] + groupOffset;
              const appearance = themeAppearance[option.value];
              const selected = option.value === theme;
              const pending = requestInFlight && pendingTheme === option.value;
              return (
                <button
                  key={option.value}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  type="button"
                  className="theme-option"
                  data-mode={appearance.mode}
                  aria-label={`${option.label}, ${appearance.mode}`}
                  aria-pressed={selected}
                  aria-disabled={isBusy}
                  tabIndex={focusedIndex === index ? 0 : -1}
                  onFocus={() => setFocusedIndex(index)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  onClick={() => { void handleThemeSelect(option.value); }}
                >
                  <span className="theme-option-swatch" aria-hidden="true" style={swatchStyle(option.value)} />
                  <span className="theme-option-name">{option.label}</span>
                  {selected && <span className="theme-selected-indicator" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
                  {pending && <span className="theme-pending-indicator" aria-hidden="true">…</span>}
                </button>
              );
            })}
            </div>
            </div>)}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
