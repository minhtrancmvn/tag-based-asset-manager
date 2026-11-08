import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { checkForUpdates, installUpdate } from "../appUpdates";
import type { UpdateCheck, UpdateProgress } from "../appUpdates";

export interface AppUpdatesProps {
  enabled: boolean;
  blockedReason: string | null;
  getBlockedReason?: () => string | null;
  onInstallingChange: (installing: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const clampedIndex = Math.min(Math.max(0, i), units.length - 1);
  return `${(bytes / Math.pow(1024, clampedIndex)).toFixed(1)} ${units[clampedIndex]}`;
}

export function AppUpdates({
  enabled,
  blockedReason,
  getBlockedReason,
  onInstallingChange,
}: AppUpdatesProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const mountedRef = useRef<boolean>(true);
  const checkPromiseRef = useRef<Promise<UpdateCheck> | null>(null);
  const installingRef = useRef<boolean>(false);

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [dynamicBlockedReason, setDynamicBlockedReason] = useState<string | null>(null);

  const [installingState, setInstallingState] = useState<UpdateProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  // StrictMode-safe mount tracking
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // On unmount must NOT unlock onInstallingChange incorrectly if currently installing
    };
  }, []);

  // Silent non-blocking check on mount when enabled.
  // Uses shared promise ref so StrictMode remount re-subscribes to the same in-flight check
  // without re-invoking checkForUpdates and successfully adopts the result.
  useEffect(() => {
    let active = true;
    if (enabled) {
      if (!checkPromiseRef.current) {
        const p = checkForUpdates();
        checkPromiseRef.current = p;
        p.then((result) => {
          if (active && mountedRef.current) {
            setUpdateCheck(result);
          }
        })
          .catch(() => {
            // Silent background check failure: avoid unhandled rejection, don't open modal
          })
          .finally(() => {
            if (checkPromiseRef.current === p) {
              checkPromiseRef.current = null;
            }
          });
      } else {
        checkPromiseRef.current
          .then((result) => {
            if (active && mountedRef.current) {
              setUpdateCheck(result);
            }
          })
          .catch(() => {});
      }
    }
    return () => {
      active = false;
    };
  }, [enabled]);

  // Focus trap and initial focus on modal open
  useEffect(() => {
    if (modalOpen) {
      if (!previousFocus.current && document.activeElement instanceof HTMLElement) {
        previousFocus.current = document.activeElement;
      }
      dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    }
  }, [modalOpen]);

  async function runCheck(): Promise<void> {
    if (isChecking) return;
    setIsChecking(true);
    setCheckError(null);
    try {
      const promise = checkPromiseRef.current ?? checkForUpdates();
      checkPromiseRef.current = promise;
      const result = await promise;
      if (mountedRef.current) {
        setUpdateCheck(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setCheckError(typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to check for updates.");
      }
    } finally {
      checkPromiseRef.current = null;
      if (mountedRef.current) {
        setIsChecking(false);
      }
    }
  }

  function handleTriggerClick(): void {
    if (!enabled) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDynamicBlockedReason(null);
    setModalOpen(true);
    if (updateCheck?.status !== "available") {
      void runCheck();
    }
  }

  function closeModal(): void {
    if (installingRef.current) return;
    setModalOpen(false);
    setDynamicBlockedReason(null);
    const target = previousFocus.current;
    if (target && typeof target.focus === "function") {
      try {
        target.focus();
      } catch {
        // Ignore if element is inert or unmounted
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      if (!installingRef.current) {
        event.stopPropagation();
        closeModal();
      }
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
      ),
    ];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget && !installingRef.current) {
      closeModal();
    }
  }

  async function handleInstallClick(version: string): Promise<void> {
    if (installingRef.current || blockedReason) return;
    setDynamicBlockedReason(null);

    if (getBlockedReason) {
      const dynamicReason = getBlockedReason();
      if (dynamicReason) {
        setDynamicBlockedReason(dynamicReason);
        return;
      }
    }

    installingRef.current = true;
    setInstallError(null);
    setInstallingState({ phase: "downloading", downloaded: 0, total: null });
    onInstallingChange(true);

    try {
      await installUpdate(version, (progress) => {
        if (mountedRef.current) {
          setInstallingState(progress);
        }
      });
      // On successful promise stay installing because native app restarts.
      // Do not restore onInstallingChange(false) and do not close dialog.
    } catch (err) {
      installingRef.current = false;
      if (mountedRef.current) {
        setInstallingState(null);
        setInstallError(typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to install update.");
      }
      onInstallingChange(false);
    }
  }

  const isAvailable = updateCheck?.status === "available";
  const triggerLabel = isAvailable ? "Update available" : "Check for updates";

  return (
    <>
      <button
        type="button"
        className="quiet-button app-updates-trigger"
        data-available={isAvailable ? "" : undefined}
        onClick={handleTriggerClick}
        disabled={!enabled}
        aria-haspopup="dialog"
      >
        {triggerLabel}
      </button>

      {modalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="dialog-backdrop" onMouseDown={handleBackdropMouseDown}>
            <section
              ref={dialogRef}
              className="workflow-dialog update-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onKeyDown={handleKeyDown}
            >
              <div className="workflow-dialog-heading">
                <div>
                  <h2 id={titleId}>
                    {installingState
                      ? "Installing update"
                      : isAvailable
                      ? `Update ${updateCheck.version} available`
                      : "Check for updates"}
                  </h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Cancel update"
                  onClick={closeModal}
                  disabled={Boolean(installingState)}
                >
                  <X size={17} />
                </button>
              </div>

              {/* In-flight installation progress */}
              {installingState && (
                <div className="update-progress">
                  <div className="bulk-review">
                    <div>
                      <span>Phase</span>
                      <p>
                        {installingState.phase === "downloading"
                          ? "Downloading update…"
                          : "Installing update…"}
                      </p>
                    </div>
                    <div>
                      <span>Progress</span>
                      <p>
                        {installingState.total !== null && installingState.total > 0
                          ? `${Math.min(
                              100,
                              Math.max(
                                0,
                                Math.round(
                                  (installingState.downloaded / installingState.total) * 100
                                )
                              )
                            )}% (${formatBytes(installingState.downloaded)} / ${formatBytes(
                              installingState.total
                            )})`
                          : `${formatBytes(installingState.downloaded)} downloaded`}
                      </p>
                    </div>
                  </div>
                  <p className="bulk-warning">
                    App will close and restart. Save or cancel drafts and stop scans before
                    updating.
                  </p>
                </div>
              )}

              {/* Check in flight */}
              {!installingState && isChecking && (
                <div className="bulk-review">
                  <p>Checking for updates…</p>
                </div>
              )}

              {/* Check error */}
              {!installingState && !isChecking && checkError && (
                <div className="dialog-error" role="alert">
                  {checkError}
                </div>
              )}

              {/* Disabled update check */}
              {!installingState && !isChecking && !checkError && updateCheck?.status === "disabled" && (
                <div className="bulk-review">
                  <div>
                    <span>Reason</span>
                    <p>{updateCheck.reason}</p>
                  </div>
                </div>
              )}

              {/* Current (up to date) */}
              {!installingState && !isChecking && !checkError && updateCheck?.status === "current" && (
                <div className="bulk-review">
                  <p>Current version is up to date.</p>
                </div>
              )}

              {/* Available update */}
              {!installingState && !isChecking && isAvailable && (
                <>
                  <div className="bulk-review">
                    <div>
                      <span>Channel</span>
                      <p>Preview channel</p>
                    </div>
                    <div>
                      <span>Version</span>
                      <p>{updateCheck.version}</p>
                    </div>
                  </div>

                  <div className="dialog-field">
                    <span>Release notes</span>
                    <pre
                      className="update-release-notes"
                      style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    >
                      {updateCheck.notes}
                    </pre>
                  </div>

                  <p className="bulk-warning">
                    App will close and restart. Save or cancel drafts and stop scans before
                    updating.
                  </p>

                  {installError && (
                    <div className="dialog-error" role="alert">
                      {installError}
                    </div>
                  )}

                  {blockedReason && (
                    <div className="dialog-error" role="alert">
                      {blockedReason}
                    </div>
                  )}

                  {dynamicBlockedReason && (
                    <div className="dialog-error" role="alert">
                      {dynamicBlockedReason}
                    </div>
                  )}
                </>
              )}

              {/* Dialog Actions */}
              <div className="dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeModal}
                  disabled={Boolean(installingState)}
                >
                  Later
                </button>

                {!installingState && !isChecking && checkError && (
                  <button
                    className="secondary-button dialog-confirm"
                    type="button"
                    onClick={() => void runCheck()}
                  >
                    Retry
                  </button>
                )}

                {!installingState && !isChecking && isAvailable && (
                  <button
                    className="secondary-button dialog-confirm"
                    type="button"
                    onClick={() => void handleInstallClick(updateCheck.version)}
                    disabled={Boolean(blockedReason)}
                  >
                    Download and install
                  </button>
                )}
              </div>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
