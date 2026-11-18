import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { X } from "lucide-react";
import type { UsageSummary } from "../types";

/** One id per non-saved row of the design's messages table. Saved rows are announced by App's status region, not by this dialog. */
export type UsageMessageId =
  | "busyAsk"
  | "busyTurnOn"
  | "failedAsk"
  | "failedTurnOn"
  | "stoppedBusy"
  | "stoppedFailed"
  | "unreachableTurnOff";

export interface UsageMessage {
  id: UsageMessageId;
  /** Changes on every attempt so a repeated failure re-mounts and re-announces the alert. */
  attempt: number;
}

const MESSAGE_TEXT: Record<UsageMessageId, string> = {
  busyAsk: "Another action is running, such as a scan or metadata check. Nothing is being sent. Try again when it finishes, or close this and the app will ask next time.",
  busyTurnOn: "Another action is running, such as a scan or metadata check. Nothing is being sent. Try again when it finishes.",
  failedAsk: "Your choice couldn't be saved. Nothing is being sent. Try again, or close this and the app will ask next time.",
  failedTurnOn: "Usage data couldn't be turned on. Nothing is being sent. Try again.",
  stoppedBusy: "Sending has stopped, but this choice couldn't be saved yet because another action is running. Press Save \"off\" when it finishes. Until it's saved, sharing will resume the next time the app opens.",
  stoppedFailed: "Sending has stopped, but this choice couldn't be saved, so sharing will resume the next time the app opens. Press Save \"off\" to try again.",
  unreachableTurnOff: "The app couldn't confirm the change. Try again.",
};

export function usageMessageText(id: UsageMessageId): string {
  return MESSAGE_TEXT[id];
}

type ChoiceAction = "granted" | "declined" | "close";

interface Choice {
  label: string;
  action: ChoiceAction;
}

const NO_THANKS: Choice = { label: "No thanks", action: "declined" };
const SHARE: Choice = { label: "Share usage data", action: "granted" };

function currentLine(usage: UsageSummary): string {
  if (usage.consent === "granted") return "Currently: sharing usage data";
  if (usage.consent === "undecided") return "Currently: not sharing usage data. You haven't chosen yet.";
  if (!usage.saved) return "Currently: not sharing usage data. This choice isn't saved yet, so sharing will resume the next time the app opens.";
  return "Currently: not sharing usage data";
}

function reviewChoices(usage: UsageSummary): [Choice, Choice] {
  if (usage.consent === "granted") return [{ label: "Turn off", action: "declined" }, { label: "Keep sharing", action: "close" }];
  if (usage.consent === "undecided") return [NO_THANKS, SHARE];
  if (!usage.saved) return [{ label: "Save \"off\"", action: "declined" }, { label: "Turn on", action: "granted" }];
  return [{ label: "Turn on", action: "granted" }, { label: "Keep off", action: "close" }];
}

interface UsageConsentDialogProps {
  mode: "first" | "review";
  usage: UsageSummary;
  saving: boolean;
  message: UsageMessage | null;
  onChoose: (consent: "granted" | "declined") => void;
  onClose: () => void;
}

function SentLists() {
  return (
    <>
      <div className="usage-consent-sent">
        <strong>Sent:</strong>
        <ul>
          <li>Actions you take and when, such as editing tags, moving between folders or using search, and which theme you picked</li>
          <li>Roughly how many items are in your library</li>
          <li>App version, whether you got the app from GitHub or the Microsoft Store, and operating system</li>
          <li>Your country, worked out by Cloudflare from your IP address; Google doesn't receive the address</li>
          <li>A random ID, deleted if you turn this off</li>
        </ul>
      </div>
      <p><strong>Never sent:</strong> file or folder names, paths, tags, notes, search text or file contents.</p>
    </>
  );
}

/** Opt-in usage-data consent: the first ask (mode "first") and the topbar review (mode "review"). Effects and messages come from App via props. */
export function UsageConsentDialog({ mode, usage, saving, message, onChoose, onClose }: UsageConsentDialogProps) {
  const titleId = useId();
  const currentId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pressedRef = useRef<HTMLButtonElement | null>(null);
  const handledAttempt = useRef<number | null>(null);
  const first = mode === "first";
  const choices: [Choice, Choice] = first ? [NO_THANKS, SHARE] : reviewChoices(usage);
  const attempt = message?.attempt ?? null;
  const messageId = message?.id ?? null;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  // After each new result: Close when the first ask can't save, Save "off" after a stopped-not-saved, otherwise the pressed button stays focused and visible.
  useEffect(() => {
    if (attempt === null) {
      handledAttempt.current = null;
      return;
    }
    if (saving || handledAttempt.current === attempt) return;
    handledAttempt.current = attempt;
    const target = first
      ? closeRef.current
      : messageId === "stoppedBusy" || messageId === "stoppedFailed"
        ? firstChoiceRef.current
        : pressedRef.current;
    if (!target) return;
    if (document.activeElement !== target) target.focus();
    // The new message can push the buttons below the dialog's scroll area at the 820×600 minimum window.
    target.scrollIntoView?.({ block: "nearest" });
  }, [attempt, messageId, first, saving]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (saving) return;
      if (first) onChoose("declined");
      else onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button")];
    const firstControl = controls[0];
    const lastControl = controls[controls.length - 1];
    if (document.activeElement === dialogRef.current) { event.preventDefault(); (event.shiftKey ? lastControl : firstControl)?.focus(); }
    else if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl?.focus(); }
    else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl?.focus(); }
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;
    if (first || saving) {
      event.preventDefault();
      return;
    }
    onClose();
  }

  function choose(event: MouseEvent<HTMLButtonElement>, action: ChoiceAction): void {
    if (saving) return;
    pressedRef.current = event.currentTarget;
    if (action === "close") onClose();
    else onChoose(action);
  }

  const ariaBusy = saving ? "true" : undefined;

  return (
    <div className="dialog-backdrop" onMouseDown={handleBackdropMouseDown}>
      <section
        ref={dialogRef}
        className="workflow-dialog usage-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={first ? bodyId : `${currentId} ${bodyId}`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="workflow-dialog-heading">
          <div><h2 id={titleId}>{first ? "Share usage data?" : "Usage data"}</h2></div>
          {!first && <button className="icon-button" type="button" aria-label="Close usage data" aria-disabled={ariaBusy} onClick={() => { if (!saving) onClose(); }}><X size={17} /></button>}
        </div>
        {!first && <p id={currentId} className="usage-consent-current">{currentLine(usage)}</p>}
        <div id={bodyId} className="usage-consent-body">
          {first ? (
            <p>You can send information about how you use the app to the developer, to help decide what to improve. Nothing is sent unless you choose <strong>Share usage data</strong>.</p>
          ) : (
            <p>This sends information about how you use the app to the developer, to help decide what to improve. Nothing is sent while this is off.</p>
          )}
          <SentLists />
          {first ? (
            <p>It goes through Cloudflare to Google Analytics. You can change this anytime with <strong>Usage data</strong> at the top of the app. The privacy policy is on the app's GitHub page.</p>
          ) : (
            <p>It goes through Cloudflare to Google Analytics. The privacy policy is on the app's GitHub page.</p>
          )}
        </div>
        {saving && <p className="usage-consent-saving" role="status">Saving…</p>}
        {message && <div key={message.attempt} className="dialog-error" role="alert">{usageMessageText(message.id)}</div>}
        {first && message && (
          <div className="usage-consent-close-row">
            <button ref={closeRef} className="quiet-button" type="button" aria-disabled={ariaBusy} onClick={() => { if (!saving) onClose(); }}>Close</button>
          </div>
        )}
        <div className="dialog-actions">
          {choices.map((choice, index) => (
            <button
              key={index}
              ref={index === 0 ? firstChoiceRef : undefined}
              className="secondary-button"
              type="button"
              aria-disabled={ariaBusy}
              onClick={(event) => choose(event, choice.action)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
