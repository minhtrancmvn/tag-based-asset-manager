import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { queryTokenTagValue, tokenizeQuery } from "../catalog";
import { deriveRenameMigration, mapTag, normalizeRenameMapping } from "../tagRename";
import type { RenameBlocker, RenameMappingError, RenameMigration, RewriteFailureReason } from "../tagRename";
import type { RenameApplyHookResult, RenamePreviewInput, RenamePreviewResult } from "../useLibrary";
import type {
  AppError, RenameApplyResult, RenameDiscardReason, RenameMapping, RenameMode, RenamePreview, RenameSkippedRow, RenameTargetSummary, SavedSearch, SearchFilters,
} from "../types";

/** What an applied rename reported, kept by the host so an unresolved outcome can outlive the dialog. */
export interface RenameOutcomeReport {
  mode: RenameMode;
  result: RenameApplyResult;
  /** True when the hook migrated the active query through the binding it was given. */
  queryUpdated: boolean;
  migration: RenameMigration;
}

/**
 * Presentation and draft state for a tag or prefix-group rename. It performs no native action and does not call
 * the library hook: every effect arrives as a callback and every busy flag as a prop.
 */
export interface TagRenameDialogProps {
  /** `exact` renames one tag; `prefix` renames a colon-delimited group. Fixed for the life of the dialog. */
  mode: RenameMode;
  /** Current tag, or prefix segment (with or without a trailing colon). Shown read-only and used as the draft's initial value. */
  source: string;
  /** Active library. A change discards the draft's preview and any result still in flight. */
  libraryId: string;
  /** Filters now applied. Used for pre-preview validation and passed through to `onPreview`. */
  activeFilters: SearchFilters;
  /** Saved searches from hook state. The shared derivation selects those belonging to `libraryId`. */
  savedSearches: readonly SavedSearch[];
  /** Hook flag `renamePreviewing`. */
  previewing: boolean;
  /** Hook flag `renameApplying`. */
  applying: boolean;
  /** Hook value `renameProgress`: items visited by the running preview scan. */
  progress: number;
  /** Hook `error`. Read only to explain a `failed` result; never mutated. */
  error: AppError | null;
  /** Explicit Preview. Resolves with the hook result. */
  onPreview: (input: RenamePreviewInput) => Promise<RenamePreviewResult>;
  /** Cancel the running preview scan. Escape and "Cancel preview" call it. */
  onCancelPreview: () => Promise<boolean> | void;
  /** Apply the preview with this opaque ID. Wire to `applyTagRename(previewId, activeQueryBinding)`. */
  onApply: (previewId: string) => Promise<RenameApplyHookResult>;
  /** Close the dialog. The dialog restores focus to the element focused when it mounted. */
  onClose: () => void;
  /**
   * Reports every applied result, including one that arrives after the dialog was unmounted, so the host can keep a
   * partial or settings-failed outcome reachable after Escape or backdrop dismissal.
   */
  onOutcome?: (report: RenameOutcomeReport) => void;
  /** Opens the dialog on an earlier unresolved outcome, with its destination, so its retry is reachable again. */
  resume?: RenameOutcomeReport;
  /**
   * Marks the host's unresolved-outcome notice as finished. Offered only for a dialog opened with `resume`, only for
   * the same rename, and only when nothing remains to do or the retry proof was rejected.
   */
  onResolve?: () => void;
}

const PAGE_SIZE = 25;
const FOCUSABLE = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']";

type Pending = "preview" | "apply" | null;
type NoticeKind = "cancelled" | "discarded" | "unavailable" | "stale" | "failed" | "invalid";
interface Notice { during: "preview" | "apply"; kind: NoticeKind; reason?: RenameDiscardReason }
interface Review { preview: RenamePreview; migration: RenameMigration; confirming: boolean }
interface Outcome { result: RenameApplyResult; queryUpdated: boolean; migration: RenameMigration }
type NativeRejection = "stale-preview" | "unknown-search" | "changed-filters" | "retry-rejected" | "other";

const mappingErrorText: Record<RenameMappingError, string> = {
  "empty-source": "The current name is empty.",
  "empty-destination": "Enter a new name.",
  unchanged: "The new name is the same as the current name.",
  "multi-segment-prefix": "A prefix group name is one segment without colons.",
};

const reasonText: Record<RewriteFailureReason, string> = {
  whitespace: "A name with spaces would split into several query terms.",
  "quote-leading": "A name starting with a quotation mark would be read as quoted path text.",
  "leading-minus": "A name starting with a minus sign would be read as an exclusion.",
  "role-change": "The rewritten query would change meaning.",
};

const discardText: Record<RenameDiscardReason, string> = {
  mutation: "the library changed while it was scanning",
  "library-changed": "the approved library changed while it was scanning",
  "sidecar-changed": "a metadata file changed while it was scanning",
};

/**
 * Native rejections arrive as plain messages in the hook error. The order matters: the changed-filters message
 * also ends in "preview again".
 */
function classifyRejection(error: AppError | null): NativeRejection {
  const message = error?.message ?? "";
  // Checked first: this message also ends in "preview again".
  if (/no verified settings retry/i.test(message)) return "retry-rejected";
  if (/unknown saved search|belongs to another library|appears more than once|may change only the query/i.test(message)) return "unknown-search";
  if (/saved search changed since|replacement makes no change/i.test(message)) return "changed-filters";
  if (/preview again|no rename preview is pending|replaced by a newer one|changed after this rename preview/i.test(message)) return "stale-preview";
  return "other";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function sameMapping(left: RenameMapping, right: RenameMapping): boolean {
  return left.mode === right.mode && left.source === right.source && left.destination === right.destination;
}

/** An apply needs sidecar targets, or a settings-only retry that still has a saved search to migrate. */
function previewHasWork(preview: RenamePreview): boolean {
  return preview.targets.length > 0 || (preview.settingsRetry && preview.savedSearchUpdateCount > 0);
}

function blockerWho(blocker: RenameBlocker): string {
  return blocker.source.kind === "active" ? "Active query" : `Saved search "${blocker.source.name}"`;
}

function skipLabel(row: RenameSkippedRow): string {
  return row.reason === "missing" ? "Missing: the file is gone, so its metadata cannot be edited" : "Blocked: its metadata cannot be safely edited";
}

interface PagedListProps<T> {
  label: string;
  noun: string;
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
}

/** A bounded list in a focusable scroll region, revealed one page at a time. */
function PagedList<T>({ label, noun, items, render }: PagedListProps<T>) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const regionRef = useRef<HTMLDivElement>(null);
  const visible = items.slice(0, shown);
  const remaining = items.length - visible.length;
  return (
    <div className="rename-list">
      <div ref={regionRef} className="rename-list-scroll" role="region" aria-label={label} tabIndex={0}>
        <ul>{visible.map(render)}</ul>
      </div>
      {remaining > 0 && (
        <button
          className="secondary-button" type="button"
          onClick={() => { if (remaining <= PAGE_SIZE) regionRef.current?.focus(); setShown((count) => count + PAGE_SIZE); }}
        >Show {Math.min(PAGE_SIZE, remaining)} more {noun}</button>
      )}
    </div>
  );
}

function describeNotice(notice: Notice, error: AppError | null): { alert: boolean; text: string; detail: string | null } {
  const draftKept = "Your draft is kept; choose Preview again to continue.";
  switch (notice.kind) {
    case "cancelled":
      return { alert: false, text: "Preview cancelled. Nothing was changed; your draft is kept.", detail: null };
    case "discarded":
      return { alert: true, text: `The preview was discarded because ${discardText[notice.reason ?? "mutation"]}. Nothing was changed. ${draftKept}`, detail: null };
    case "invalid":
      return { alert: true, text: "These names do not make a valid rename. Edit the new name, then choose Preview.", detail: null };
    case "unavailable":
      return notice.during === "preview"
        ? { alert: true, text: `Another library operation is running, or no library is open, so the preview could not start. Nothing was changed. ${draftKept}`, detail: null }
        : { alert: true, text: `Another library operation is running, or no library is open, so the rename could not start. Nothing was changed. The preview can no longer be used; choose Preview again.`, detail: null };
    case "stale":
      return notice.during === "preview"
        ? { alert: true, text: `The library changed while the preview was running, so it was dropped. Nothing was changed. ${draftKept}`, detail: null }
        : { alert: true, text: "The library changed while the rename was running, so its result could not be confirmed. Rescan the library to see what changed, then preview again.", detail: null };
    case "failed": {
      const detail = error?.message ?? null;
      switch (classifyRejection(error)) {
        case "unknown-search":
          return { alert: true, text: `A saved search this rename needed no longer exists or belongs to another library. Nothing was changed. ${draftKept}`, detail };
        case "changed-filters":
          return { alert: true, text: `A saved search was edited after this rename was prepared. Nothing was changed. ${draftKept}`, detail };
        case "retry-rejected":
          return { alert: true, text: "Saved searches changed; correct them manually. The unfinished saved-search update can no longer be verified, so it will not be retried. Nothing further was changed.", detail };
        case "stale-preview":
          return { alert: true, text: `This preview is no longer valid because the library or its metadata changed after it was made. Nothing was changed. ${draftKept}`, detail };
        default:
          return notice.during === "preview"
            ? { alert: true, text: `The preview could not be completed. Nothing was changed. ${draftKept}`, detail }
            : { alert: true, text: "The rename did not return a usable result. Rescan the library to see what changed, then preview again.", detail };
      }
    }
  }
}

export function TagRenameDialog({
  mode, source, libraryId, activeFilters, savedSearches, previewing, applying, progress, error,
  onPreview, onCancelPreview, onApply, onClose, onOutcome, resume, onResolve,
}: TagRenameDialogProps) {
  const titleId = useId();
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const summaryId = `${baseId}-summary`;
  const mappingErrorId = `${baseId}-mapping-error`;
  const blockersId = `${baseId}-blockers`;
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const destinationRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busyRef = useRef<HTMLDivElement>(null);
  const cancelPreviewRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const pendingRef = useRef<Pending>(null);
  const cancelRequested = useRef(false);
  const lastPending = useRef<Pending>(null);
  const lastLibraryId = useRef(libraryId);

  // The probe is a destination that cannot equal any source. It reuses the canonical normalizer so labels
  // show exactly the name native will see, and stay stable while the destination is edited.
  const probe = useMemo(() => normalizeRenameMapping(mode, source, "\u0000"), [mode, source]);
  const sourceName = probe.ok ? probe.mapping.source : source.trim();
  const sourceDisplay = mode === "prefix" ? `${sourceName}:` : sourceName;
  const modeNoun = mode === "prefix" ? "prefix group" : "exact tag";

  const [destination, setDestination] = useState(resume ? resume.result.mapping.destination : probe.ok ? probe.mapping.source : source);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [cancelling, setCancelling] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(
    resume ? { result: resume.result, queryUpdated: resume.queryUpdated, migration: resume.migration } : null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [serverBlockers, setServerBlockers] = useState<RenameBlocker[]>([]);
  const [announcement, setAnnouncement] = useState("");

  const mappingResult = useMemo(() => normalizeRenameMapping(mode, source, destination), [mode, source, destination]);
  const localBlockers = useMemo(
    () => mappingResult.ok ? deriveRenameMigration({ libraryId, activeFilters, savedSearches, mapping: mappingResult.mapping }).blockers : [],
    [mappingResult, libraryId, activeFilters, savedSearches],
  );
  const blockers = localBlockers.length > 0 ? localBlockers : serverBlockers;

  const previewBusy = pending === "preview" || previewing;
  const applyBusy = pending === "apply" || applying;
  const busy = previewBusy || applyBusy;
  const canPreview = mappingResult.ok && blockers.length === 0 && !busy;
  const stageKey = outcome ? "outcome" : review ? (review.confirming ? "confirm" : "review") : "draft";

  useEffect(() => {
    mounted.current = true;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A resumed dialog opens on the outcome, which has no name field.
    if (resume) headingRef.current?.focus();
    else destinationRef.current?.focus();
    return () => {
      mounted.current = false;
      sequence.current += 1;
      previousFocus.current?.focus();
    };
  }, []);

  // A library switch makes any preview, outcome or in-flight result belong to the wrong library.
  useEffect(() => {
    if (lastLibraryId.current === libraryId) return;
    lastLibraryId.current = libraryId;
    sequence.current += 1;
    pendingRef.current = null;
    setPending(null);
    setCancelling(false);
    setReview(null);
    setOutcome(null);
    setNotice(null);
    setServerBlockers([]);
  }, [libraryId]);

  // Disabling the control that held focus would strand Escape outside the dialog, so focus follows the work.
  useEffect(() => {
    const was = lastPending.current;
    lastPending.current = pending;
    if (pending === "preview") cancelPreviewRef.current?.focus();
    else if (pending === "apply") busyRef.current?.focus();
    else if (was) {
      if (notice && notice.kind !== "cancelled") primaryRef.current?.focus();
      else if (review || outcome) headingRef.current?.focus();
      else destinationRef.current?.focus();
    }
    // Only the end or start of work moves focus; later state changes must not steal it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    if (review?.confirming) headingRef.current?.focus();
  }, [review?.confirming]);

  function editDestination(value: string): void {
    if (busy) return;
    sequence.current += 1;
    setDestination(value);
    setTouched(true);
    setReview(null);
    setNotice(null);
    setServerBlockers([]);
  }

  function requestCancelPreview(): void {
    if (cancelRequested.current) return;
    cancelRequested.current = true;
    setCancelling(true);
    try {
      void Promise.resolve(onCancelPreview()).catch(() => undefined);
    } catch {
      // Cancellation is best effort; the preview result still settles the dialog.
    }
  }

  async function runPreview(): Promise<void> {
    if (!canPreview || pendingRef.current || !mappingResult.ok) return;
    const ticket = ++sequence.current;
    pendingRef.current = "preview";
    cancelRequested.current = false;
    setCancelling(false);
    setPending("preview");
    setNotice(null);
    setServerBlockers([]);
    setAnnouncement("Previewing the rename. Scanning the whole library.");
    let result: RenamePreviewResult;
    try {
      result = await onPreview({ mode, source, destination, activeFilters });
    } catch {
      result = { status: "failed" };
    }
    if (!mounted.current || ticket !== sequence.current) return;
    pendingRef.current = null;
    setCancelling(false);
    switch (result.status) {
      case "ready": {
        const { preview } = result;
        setOutcome(null);
        setReview({ preview, migration: result.migration, confirming: false });
        setAnnouncement(`Preview ready: ${plural(preview.fileCount, "file")}, ${plural(preview.folderCount, "folder")}, ${plural(preview.sidecarCount, "sidecar file")}.`);
        break;
      }
      case "blocked":
        setServerBlockers(result.blockers);
        setAnnouncement("The rename cannot update every saved query.");
        break;
      case "cancelled":
        setNotice({ during: "preview", kind: "cancelled" });
        setAnnouncement("Preview cancelled.");
        break;
      case "discarded":
        setNotice({ during: "preview", kind: "discarded", reason: result.reason });
        setAnnouncement("The preview was discarded.");
        break;
      case "invalid":
        setNotice({ during: "preview", kind: "invalid" });
        setAnnouncement("The names are not a valid rename.");
        break;
      default:
        setNotice({ during: "preview", kind: result.status });
        setAnnouncement("The preview did not complete.");
    }
    setPending(null);
  }

  async function runApply(): Promise<void> {
    if (!review || pendingRef.current || busy) return;
    const { preview, migration } = review;
    const ticket = ++sequence.current;
    pendingRef.current = "apply";
    setPending("apply");
    setNotice(null);
    setAnnouncement("Applying the rename.");
    let result: RenameApplyHookResult;
    try {
      result = await onApply(preview.previewId);
    } catch {
      result = { status: "failed" };
    }
    // The host learns of a committed result even if this dialog is gone; only the dialog's own state is dropped.
    if (result.status === "applied") onOutcome?.({ mode, result: result.result, queryUpdated: result.queryUpdated, migration });
    if (!mounted.current || ticket !== sequence.current) return;
    pendingRef.current = null;
    // Native consumes the preview on every outcome, so none of these paths may leave it usable.
    setReview(null);
    if (result.status === "applied") {
      setOutcome({ result: result.result, queryUpdated: result.queryUpdated, migration });
      setAnnouncement(outcomeAnnouncement(result.result));
    } else {
      setNotice({ during: "apply", kind: result.status });
      setAnnouncement("The rename did not complete.");
    }
    setPending(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (stageKey === "draft") void runPreview();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (applyBusy) return;
      if (previewBusy) requestCancelPreview();
      else onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  const noticeView = notice ? describeNotice(notice, error) : null;
  // Dismissal is for the resumed rename only, and only when retrying cannot achieve anything more.
  const sameRename = Boolean(onResolve && resume && mappingResult.ok && sameMapping(mappingResult.mapping, resume.result.mapping));
  const nothingRemains = review !== null && !review.confirming && !previewHasWork(review.preview);
  const proofRejected = notice?.kind === "failed" && notice.during === "apply" && classifyRejection(error) === "retry-rejected";
  const canDismiss = sameRename && (nothingRemains || proofRejected);
  const previewLabel = notice && notice.kind !== "cancelled" ? "Preview again" : "Preview";
  const describedBy = [hintId, mappingResult.ok ? summaryId : touched ? mappingErrorId : null, blockers.length > 0 ? blockersId : null].filter(Boolean).join(" ");

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} className="workflow-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleDialogKeyDown}>
        <div className="workflow-dialog-heading">
          <div><span className="dialog-eyebrow">TAG RENAME</span><h2 id={titleId}>{mode === "prefix" ? "Rename prefix group" : "Rename tag"}</h2></div>
          <button className="icon-button" type="button" aria-label="Close rename dialog" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
        <form onSubmit={handleSubmit}>
          {stageKey !== "outcome" && (
            <>
              <label className="dialog-field">Current name
                <input value={sourceDisplay} readOnly aria-readonly="true" />
              </label>
              <label className="dialog-field">New name for {modeNoun} "{sourceDisplay}"
                <input
                  ref={destinationRef} value={destination} onChange={(event) => editDestination(event.target.value)} disabled={busy}
                  aria-describedby={describedBy} aria-invalid={blockers.length > 0 || (touched && !mappingResult.ok) ? true : undefined}
                  autoComplete="off" spellCheck={false}
                />
              </label>
              <p id={hintId} className="dialog-hint">
                {mode === "prefix"
                  ? "Renames every tag in this colon-delimited group. Nothing is read or written until you choose Preview."
                  : "Renames this one tag. Nothing is read or written until you choose Preview."}
              </p>
              {mappingResult.ok
                ? <p id={summaryId} className="rename-mapping">{mode === "prefix"
                  ? `Prefix group: tags starting with "${mappingResult.mapping.source}:" will start with "${mappingResult.mapping.destination}:" instead; everything after the prefix is kept.`
                  : `Exact tag: "${mappingResult.mapping.source}" becomes "${mappingResult.mapping.destination}".`}</p>
                : touched && <p id={mappingErrorId} className="dialog-hint">{mappingErrorText[mappingResult.error]}</p>}
              {blockers.length > 0 && (
                <div id={blockersId} className="dialog-error rename-blockers" role="alert">
                  <strong>This rename cannot update every saved query.</strong>
                  <ul>
                    {blockers.map((blocker, index) => (
                      <li key={`${blockerWho(blocker)}-${blocker.token}-${index}`}>
                        {blockerWho(blocker)}: the token "{blocker.token}" cannot become "{blocker.destination}". {reasonText[blocker.reason]}
                      </li>
                    ))}
                  </ul>
                  <p>To continue:</p>
                  <ul>
                    <li>Choose a different new name.</li>
                    <li>Close this dialog, edit the active query, then start the rename again.</li>
                    <li>Close this dialog, then edit or delete the saved search named in the list.</li>
                  </ul>
                  <p>Your draft is preserved while this dialog stays open; closing it discards the draft. Nothing has been changed.</p>
                </div>
              )}
            </>
          )}

          {noticeView && (noticeView.alert
            ? <div className="dialog-error rename-notice" role="alert">{noticeView.text}{noticeView.detail && <span className="rename-native-detail">Detail: {noticeView.detail}</span>}</div>
            : <p className="rename-note">{noticeView.text}</p>)}

          {busy && (
            <div ref={busyRef} className="rename-busy" tabIndex={-1}>
              <span className="progress-spinner" aria-hidden="true" />
              <span>{applyBusy
                ? "Applying the rename. Controls are disabled until it finishes."
                : cancelling ? "Cancelling the preview…" : `Scanning the whole library for matches… ${plural(progress, "item")} visited.`}</span>
            </div>
          )}

          {review && <ReviewSection review={review} mode={mode} headingRef={review.confirming ? undefined : headingRef} />}
          {review?.confirming && <ConfirmSection review={review} mode={mode} headingRef={headingRef} />}
          {outcome && <OutcomeSection outcome={outcome} mode={mode} headingRef={headingRef} />}

          <div className="dialog-actions">
            {previewBusy
              ? <button ref={cancelPreviewRef} className="secondary-button" type="button" onClick={requestCancelPreview}>Cancel preview</button>
              : <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{outcome ? "Close" : "Cancel"}</button>}
            {stageKey === "draft" && (
              <button ref={primaryRef} className="primary-button dialog-confirm" type="submit" disabled={!canPreview}>{previewLabel}</button>
            )}
            {review && !review.confirming && previewHasWork(review.preview) && (
              <button className="primary-button dialog-confirm" type="button" disabled={busy} onClick={() => setReview({ ...review, confirming: true })}>Review rename</button>
            )}
            {review?.confirming && (
              <button className="primary-button dialog-confirm" type="button" disabled={busy} onClick={() => void runApply()}>{applyBusy ? "Renaming…" : "Confirm rename"}</button>
            )}
            {canDismiss && <button className="secondary-button" type="button" disabled={busy} onClick={onResolve}>Dismiss notice</button>}
            {outcome && outcome.result.outcome !== "complete" && (
              <button ref={primaryRef} className="primary-button dialog-confirm" type="button" disabled={!canPreview} onClick={() => void runPreview()}>
                {outcome.result.outcome === "partial" ? "Preview remaining rows" : "Preview settings retry"}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function outcomeAnnouncement(result: RenameApplyResult): string {
  switch (result.outcome) {
    case "complete":
      return `Rename complete: ${plural(result.committed.filter((asset) => asset.kind === "file").length, "file")} and ${plural(result.committed.filter((asset) => asset.kind === "folder").length, "folder")} renamed.`;
    case "partial": {
      const total = result.committed.length + result.failed.length + result.unattempted.length;
      return `Rename partly applied: ${result.committed.length} of ${total} rows committed. Review the outcome in the dialog.`;
    }
    case "settings-failed":
      return "Rename saved but the saved-search update failed. Retry is available in the dialog until the app closes.";
  }
}

function mappingNames(mode: RenameMode, preview: RenamePreview): { from: string; to: string } {
  return mode === "prefix"
    ? { from: `${preview.mapping.source}:`, to: `${preview.mapping.destination}:` }
    : { from: preview.mapping.source, to: preview.mapping.destination };
}

interface MappedTerm { before: string; after: string; tag: string }

/** The first query term, with the given role, that this rename rewrites; the user's own shape for the disclosure. */
function firstMappedTerm(queries: readonly string[], mapping: RenameMapping, role: "required" | "excluded"): MappedTerm | null {
  for (const query of queries) {
    for (const token of tokenizeQuery(query)) {
      if (token.role !== role) continue;
      const value = queryTokenTagValue(token);
      const mapped = value === null ? null : mapTag(value, mapping);
      if (mapped !== null) return { before: token.text, after: role === "excluded" ? `-${mapped}` : mapped, tag: mapped };
    }
  }
  return null;
}

/**
 * CON-7: when the destination already exists, a migrated search or query also matches (or, if excluded, also
 * excludes) the rows that already used it. Null when there is no merge or nothing is migrated.
 */
function searchMeaningNote(mode: RenameMode, preview: RenamePreview, migration: RenameMigration): string | null {
  const searches = migration.replacements.length > 0;
  const active = migration.activeQuery.changed;
  if (!preview.destinationExists || (!searches && !active)) return null;
  const queries = [...migration.replacements.map((replacement) => replacement.expectedFilters.query), ...(active ? [migration.activeQuery.before] : [])];
  const required = firstMappedTerm(queries, preview.mapping, "required");
  const excluded = firstMappedTerm(queries, preview.mapping, "excluded");
  const scope = searches && active ? "The saved searches and the active query" : searches ? "The saved searches" : "The active query";
  const parts = [`${scope} that this rename updates will match differently after this merge.`];
  if (required) parts.push(`A term "${required.before}" becomes "${required.after}", so it will now also match rows that already used "${required.tag}".`);
  if (excluded) parts.push(`An excluded term "${excluded.before}" becomes "${excluded.after}", so it will now also exclude rows that already used "${excluded.tag}".`);
  if (!required && !excluded) {
    const { from, to } = mappingNames(mode, preview);
    parts.push(`A search for "${from}" becomes a search for "${to}", so it will now also match rows that already used the destination.`);
  }
  return parts.join(" ");
}

function SkippedWarning({ skipped, uninspectable, tense }: { skipped: number; uninspectable: number; tense: "before" | "after" }) {
  if (skipped === 0 && uninspectable === 0) return null;
  return (
    <div className="bulk-warning">
      {skipped > 0 && <p>{tense === "before"
        ? `${plural(skipped, "skipped row")} ${skipped === 1 ? "keeps its" : "keep their"} old tag.`
        : `${plural(skipped, "skipped row")} may still have the old tag.`}</p>}
      {uninspectable > 0 && <p>{tense === "before"
        ? `${plural(uninspectable, "row")} ${uninspectable === 1 ? "has" : "have"} metadata that cannot be read, so ${uninspectable === 1 ? "its" : "their"} tags are unknown; ${uninspectable === 1 ? "it" : "they"} may still carry the old tag.`
        : `${plural(uninspectable, "row")} with unreadable metadata may still have the old tag.`}</p>}
    </div>
  );
}

function SkippedLists({ skipped, uninspectable }: { skipped: readonly RenameSkippedRow[]; uninspectable: readonly { message: string; path: string; details: string }[] }) {
  return (
    <>
      {skipped.length > 0 && (
        <div className="rename-subsection">
          <h4>{plural(skipped.length, "skipped row")}</h4>
          <PagedList label="Skipped rows" noun="skipped rows" items={skipped} render={(row) => (
            <li key={row.assetId}><span className="rename-path">{row.relativePath}</span><em>{skipLabel(row)}{row.message ? `: ${row.message}` : ""}</em></li>
          )} />
        </div>
      )}
      {uninspectable.length > 0 && (
        <div className="rename-subsection">
          <h4>{plural(uninspectable.length, "row")} with unreadable metadata</h4>
          <PagedList label="Rows with unreadable metadata" noun="unreadable rows" items={uninspectable} render={(issue, index) => (
            <li key={`${issue.path}-${index}`}><span className="rename-path">{issue.path}</span><em>{issue.message}</em></li>
          )} />
        </div>
      )}
    </>
  );
}

function ReviewSection({ review, mode, headingRef }: { review: Review; mode: RenameMode; headingRef: React.Ref<HTMLHeadingElement> | undefined }) {
  const { preview, migration } = review;
  const titleId = useId();
  const { from, to } = mappingNames(mode, preview);
  const collapsedRows = preview.targets.filter((target) => target.duplicatesCollapsed > 0);
  const noWork = !previewHasWork(preview);
  const meaningNote = searchMeaningNote(mode, preview, migration);
  return (
    <section className="rename-review" aria-labelledby={titleId}>
      <h3 id={titleId} ref={headingRef} tabIndex={-1}>Rename preview</h3>
      <p className="rename-scope">Counts cover the whole active library, including subfolders, not only the folder you are viewing.</p>
      {preview.settingsRetry && !noWork && <p className="rename-note">This preview finishes the saved-search and active-query update from a rename already saved. It rewrites no sidecar files.</p>}
      <dl className="rename-counts">
        <div><dt>Files</dt><dd>{preview.fileCount}</dd></div>
        <div><dt>Folders</dt><dd>{preview.folderCount}</dd></div>
        <div><dt>Sidecar files</dt><dd>{preview.sidecarCount}</dd></div>
        <div><dt>Searches to update</dt><dd>{preview.savedSearchUpdateCount}</dd></div>
      </dl>
      {migration.replacements.length > 0 && (
        <ul className="rename-search-list" aria-label="Searches to update">
          {migration.replacements.map((replacement) => <li key={replacement.searchId}>{replacement.name}</li>)}
        </ul>
      )}
      {migration.activeQuery.changed && (
        <p>Active query changes from <code>{migration.activeQuery.before}</code> to <code>{migration.activeQuery.after}</code>.</p>
      )}
      {noWork && (preview.settingsRetry
        ? <p className="rename-note">Nothing remains to migrate: no saved search still uses "{from}", so there is nothing left to retry. If the active query still uses it, edit the query by hand.</p>
        : <p className="dialog-error">No editable rows match "{from}", so there is nothing to rename. Skipped rows are listed below.</p>)}
      {preview.destinationExists && (
        <p className="rename-note">{mode === "prefix"
          ? `Tags in the destination group "${to}" already exist in the library; colliding tags merge without duplicates.`
          : `The destination tag "${to}" already exists in the library; matching rows merge into it without duplicates.`}</p>
      )}
      {meaningNote && <p className="rename-note">{meaningNote}</p>}
      {mode === "prefix" && preview.collisions.length > 0 && (
        <div className="rename-subsection">
          <h4>Colliding mappings: {preview.collisions.length}</h4>
          <PagedList label="Colliding mappings" noun="mappings" items={preview.collisions} render={(collision) => (
            <li key={`${collision.from}>${collision.to}`}><span className="rename-path">{collision.from}</span><em>becomes {collision.to}, which already exists</em></li>
          )} />
        </div>
      )}
      {(preview.duplicatesCollapsed > 0 || collapsedRows.length > 0) && (
        <div className="rename-subsection">
          <h4>Duplicate tags collapsed: {preview.duplicatesCollapsed}</h4>
          {collapsedRows.length > 0 && (
            <PagedList label="Rows that collapse a duplicate" noun="rows" items={collapsedRows} render={(target: RenameTargetSummary) => (
              <li key={target.assetId}><span className="rename-path">{target.relativePath}</span><em>{plural(target.duplicatesCollapsed, "duplicate")} collapsed</em></li>
            )} />
          )}
        </div>
      )}
      <SkippedWarning skipped={preview.skipped.length} uninspectable={preview.uninspectable.length} tense="before" />
      <SkippedLists skipped={preview.skipped} uninspectable={preview.uninspectable} />
    </section>
  );
}

function ConfirmSection({ review, mode, headingRef }: { review: Review; mode: RenameMode; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { preview, migration } = review;
  const titleId = useId();
  const { from, to } = mappingNames(mode, preview);
  const meaningNote = searchMeaningNote(mode, preview, migration);
  const retryOnly = preview.targets.length === 0;
  const searchPart = preview.savedSearchUpdateCount > 0 ? ` ${plural(preview.savedSearchUpdateCount, "saved search")} will also be updated.` : "";
  return (
    <section className="rename-confirm" aria-labelledby={titleId}>
      <h3 id={titleId} ref={headingRef} tabIndex={-1}>Confirm rename</h3>
      {retryOnly
        ? <p>You are about to finish the update for the {mode === "prefix" ? "prefix group" : "exact tag"} "{from}", renamed to "{to}". No sidecar files are rewritten.{searchPart} The active query is updated if it still uses the old name.</p>
        : <p>You are about to rename the {mode === "prefix" ? "prefix group" : "exact tag"} "{from}" to "{to}" in {plural(preview.fileCount, "file")} and {plural(preview.folderCount, "folder")} across the whole library, including subfolders; {mode === "prefix" ? `everything after the prefix is kept, so "${from}x:y" becomes "${to}x:y". ` : ""}{plural(preview.sidecarCount, "sidecar file")} will be rewritten.{searchPart}</p>}
      {meaningNote && <p>{meaningNote}</p>}
      <SkippedWarning skipped={preview.skipped.length} uninspectable={preview.uninspectable.length} tense="before" />
      <div className="bulk-warning">
        <strong>This cannot be undone, and there is no rollback across folders.</strong> If a write fails part-way, earlier folders stay renamed.
        Only metadata sidecar files change; asset files and paths are untouched. To keep a recovery copy, close this dialog and use Export JSON in the catalog toolbar first; closing discards this preview.
      </div>
    </section>
  );
}

function OutcomeSection({ outcome, mode, headingRef }: { outcome: Outcome; mode: RenameMode; headingRef: React.Ref<HTMLHeadingElement> }) {
  const { result, queryUpdated, migration } = outcome;
  const titleId = useId();
  const names = mode === "prefix"
    ? { from: `${result.mapping.source}:`, to: `${result.mapping.destination}:`, noun: "prefix group" }
    : { from: result.mapping.source, to: result.mapping.destination, noun: "exact tag" };
  const files = result.committed.filter((asset) => asset.kind === "file").length;
  const folders = result.committed.filter((asset) => asset.kind === "folder").length;
  const skippedLists = <SkippedLists skipped={result.skipped} uninspectable={result.uninspectable} />;

  if (result.outcome === "complete") {
    const searchNames = migration.replacements.map((replacement) => replacement.name);
    return (
      <section className="rename-outcome" aria-labelledby={titleId}>
        <h3 id={titleId} ref={headingRef} tabIndex={-1}>Rename complete</h3>
        <p>{result.committed.length > 0
          ? `Renamed the ${names.noun} "${names.from}" to "${names.to}" in ${plural(files, "file")} and ${plural(folders, "folder")}.`
          : `Finished the saved-search update for the ${names.noun} "${names.from}", renamed to "${names.to}". No sidecar files were rewritten.`}</p>
        {searchNames.length > 0 && <p>Saved searches updated: {searchNames.join(", ")}.</p>}
        {migration.activeQuery.changed && (queryUpdated
          ? <p>Active query updated.</p>
          : <p>The active query was edited while the rename ran, so it was left as you typed it.</p>)}
        <SkippedWarning skipped={result.skipped.length} uninspectable={result.uninspectable.length} tense="after" />
        {skippedLists}
      </section>
    );
  }

  if (result.outcome === "partial") {
    const total = result.committed.length + result.failed.length + result.unattempted.length;
    const unrenamed = [
      ...result.failed.map((target) => ({ target, state: "Failed" })),
      ...result.unattempted.map((target) => ({ target, state: "Not attempted" })),
    ];
    return (
      <section className="rename-outcome" aria-labelledby={titleId}>
        <h3 id={titleId} ref={headingRef} tabIndex={-1}>Rename partly applied</h3>
        <p>{result.committed.length} of {total} rows were renamed from "{names.from}" to "{names.to}". The rest still have the old name.</p>
        <dl className="rename-counts">
          <div><dt>Committed</dt><dd>{result.committed.length}</dd></div>
          <div><dt>Failed</dt><dd>{result.failed.length}</dd></div>
          <div><dt>Not attempted</dt><dd>{result.unattempted.length}</dd></div>
        </dl>
        {result.failingSidecar && <p>Failing sidecar: {result.failingSidecar}</p>}
        {result.error && <p className="dialog-error">Error: {result.error.message}</p>}
        <p className="bulk-warning">Saved searches and the active query were not changed. Filters for the old tag name no longer include rows already renamed. Choose Preview remaining rows to rename the rest.</p>
        {unrenamed.length > 0 && (
          <PagedList label="Rows not renamed" noun="rows" items={unrenamed} render={({ target, state }) => (
            <li key={target.assetId}><span className="rename-path">{target.relativePath}</span><em>{state}</em></li>
          )} />
        )}
        <SkippedWarning skipped={result.skipped.length} uninspectable={result.uninspectable.length} tense="after" />
        {skippedLists}
      </section>
    );
  }

  const returned = new Map(result.savedSearches.map((search) => [search.id, search]));
  const notUpdated = migration.replacements.filter((replacement) => returned.get(replacement.searchId)?.filters.query !== replacement.filters.query);
  return (
    <section className="rename-outcome" aria-labelledby={titleId}>
      <h3 id={titleId} ref={headingRef} tabIndex={-1}>Rename saved, search update failed</h3>
      <p>{plural(result.committed.length, "row")} {result.committed.length === 1 ? "was" : "were"} renamed from "{names.from}" to "{names.to}" and stay renamed. Saved searches and the active query still use the old name.</p>
      {result.error && <p className="dialog-error">Settings error: {result.error.message}</p>}
      {notUpdated.length > 0 && (
        <>
          <p>Saved searches not updated:</p>
          <ul className="rename-search-list" aria-label="Saved searches not updated">{notUpdated.map((replacement) => <li key={replacement.searchId}>{replacement.name}</li>)}</ul>
        </>
      )}
      {migration.activeQuery.changed
        ? <p>Active query not updated: still "{migration.activeQuery.before}".</p>
        : <p>Active query: no change was needed.</p>}
      <p className="bulk-warning">Retry is available only until the app closes. The retry is held in memory and is not saved, so after you quit, edit the saved searches and active query by hand.</p>
      {skippedLists}
    </section>
  );
}
