import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AppTheme } from "../themes";
import { themeAppearance, themeOptions } from "../themes";

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
const POPOVER_WIDTH = 480;
const GRID_MIN_WIDTH = 78;
const POPOVER_GAP = 8;
const FALLBACK_POPOVER_HEIGHT = 260;

function columnsForWidth(viewportWidth: number): number {
  const availableWidth = Math.min(POPOVER_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  if (availableWidth >= GRID_MIN_WIDTH * 5 + 40) return 5;
  if (availableWidth >= GRID_MIN_WIDTH * 4 + 40) return 4;
  if (availableWidth >= GRID_MIN_WIDTH * 3 + 40) return 3;
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

function gradient(stops: readonly string[]): string {
  return `linear-gradient(135deg, ${stops.join(", ")})`;
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
  const [focusedIndex, setFocusedIndex] = useState(() => Math.max(0, themeOptions.findIndex((option) => option.value === theme)));

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
    const initialIndex = Math.max(0, themeOptions.findIndex((option) => option.value === theme));
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
    setFocusedIndex(Math.max(0, themeOptions.findIndex((option) => option.value === theme)));
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
    const nextIndex = Math.min(themeOptions.length - 1, Math.max(0, index));
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
        nextIndex = Math.min(themeOptions.length - 1, index + columns);
        break;
      case "ArrowUp":
        nextIndex = Math.max(0, index - columns);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = themeOptions.length - 1;
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

  const triggerStyle = {
    "--theme-swatch-gradient": gradient(selectedAppearance.swatchStops),
  } as CSSProperties;

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
          <div className="theme-grid" role="group" aria-label="Color themes" data-columns={position?.columns ?? columnsForWidth(window.innerWidth)}>
            {themeOptions.map((option, index) => {
              const appearance = themeAppearance[option.value];
              const selected = option.value === theme;
              const pending = requestInFlight && pendingTheme === option.value;
              const swatchStyle = { background: gradient(appearance.swatchStops) } as CSSProperties;
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
                  <span className="theme-option-swatch" aria-hidden="true" style={swatchStyle} />
                  <span className="theme-option-name">{option.label}</span>
                  <span className="theme-option-mode">{appearance.mode === "dark" ? "Dark" : "Light"}</span>
                  {selected && <span className="theme-selected-indicator" aria-hidden="true">✓</span>}
                  {pending && <span className="theme-pending-indicator" aria-hidden="true">…</span>}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
