// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppUpdates } from "./AppUpdates";
import * as appUpdatesModule from "../appUpdates";
import type { UpdateCheck, UpdateProgress } from "../appUpdates";

vi.mock("../appUpdates", () => ({
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
}));

describe("AppUpdates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("browser mode disables button and does not check on mount", () => {
    const checkForUpdatesSpy = vi.spyOn(appUpdatesModule, "checkForUpdates");
    render(
      <AppUpdates enabled={false} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: /check for updates/i });
    expect(button).toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(checkForUpdatesSpy).not.toHaveBeenCalled();
  });

  it("detects update in background on mount without opening modal and does not install", async () => {
    const availableResult: UpdateCheck = {
      status: "available",
      version: "1.5.0",
      notes: "Feature release notes",
    };
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue(availableResult);
    const installSpy = vi.spyOn(appUpdatesModule, "installUpdate");

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(installSpy).not.toHaveBeenCalled();
  });

  it("manual check opens modal and shows current status when up to date", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({ status: "current" });

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    const button = screen.getByRole("button", { name: /check for updates/i });
    fireEvent.click(button);

    expect(screen.getByRole("dialog")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText(/up to date/i)).toBeDefined();
    });

    expect(appUpdatesModule.installUpdate).not.toHaveBeenCalled();
  });

  it("manual check handles disabled check result and displays reason", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "disabled",
      reason: "Managed by enterprise package manager",
    });

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    await waitFor(() => {
      expect(screen.getByText("Managed by enterprise package manager")).toBeDefined();
    });
  });

  it("handles offline check failure and provides retry path", async () => {
    const checkSpy = vi
      .spyOn(appUpdatesModule, "checkForUpdates")
      .mockRejectedValueOnce(new Error("Network offline")) // background check (shared by manual click during initial check)
      .mockResolvedValueOnce({ status: "current" }); // retry

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));

    await waitFor(() => {
      expect(screen.getByText(/Network offline/i)).toBeDefined();
    });

    const retryButton = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText(/up to date/i)).toBeDefined();
    });

    expect(checkSpy).toHaveBeenCalledTimes(2);
  });

  it("renders literal untrusted notes without HTML/markdown interpretation, preview channel and restart warning", async () => {
    const rawNotes = "<script>alert('xss')</script>\n<p>HTML paragraph</p>\n**markdown bold**";
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "2.1.0-preview.3",
      notes: rawNotes,
    });

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /update available/i }));

    expect(screen.getByRole("dialog")).toBeDefined();

    // Check preview channel and restart warning
    expect(screen.getByText(/preview channel/i)).toBeDefined();
    expect(
      screen.getByText(
        "App will close and restart. Save or cancel drafts and stop scans before updating."
      )
    ).toBeDefined();

    // Check pre-wrapped literal notes (no html element injected)
    const notesEl = screen.getByText((content, element) => {
      return (
        element?.tagName.toLowerCase() === "pre" &&
        content.includes("<script>alert('xss')</script>")
      );
    });
    expect(notesEl).toBeDefined();
    expect(notesEl.className).toContain("update-release-notes");
    expect(document.querySelector("script[src]")).toBeNull();
  });

  it("disables download and install when blockedReason is provided", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "2.0.0",
      notes: "Important fixes",
    });

    render(
      <AppUpdates
        enabled={true}
        blockedReason="Scan currently running"
        onInstallingChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates|update available/i }));

    await waitFor(() => {
      expect(screen.getByText("Scan currently running")).toBeDefined();
    });

    const installButton = screen.getByRole("button", { name: /download and install/i });
    expect((installButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("synchronously calls getBlockedReason on confirm install and aborts before onInstallingChange if reason returned", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "2.0.0",
      notes: "Important fixes",
    });

    const installSpy = vi.spyOn(appUpdatesModule, "installUpdate");
    const onInstallingChange = vi.fn();
    const getBlockedReason = vi.fn().mockReturnValue("Unsaved tag input draft");

    render(
      <AppUpdates
        enabled={true}
        blockedReason={null}
        getBlockedReason={getBlockedReason}
        onInstallingChange={onInstallingChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates|update available/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download and install/i })).toBeDefined();
    });

    const installBtn = screen.getByRole("button", { name: /download and install/i });
    expect((installBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(installBtn);

    expect(getBlockedReason).toHaveBeenCalledTimes(1);
    expect(installSpy).not.toHaveBeenCalled();
    expect(onInstallingChange).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved tag input draft")).toBeDefined();
  });

  it("explicit click installs update once, reports progress, blocks close, and stays installing on success", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "2.0.0",
      notes: "Release notes",
    });

    let progressCb: ((progress: UpdateProgress) => void) | undefined;
    let resolveInstall: () => void;
    const installPromise = new Promise<void>((resolve) => {
      resolveInstall = resolve;
    });

    const installSpy = vi
      .spyOn(appUpdatesModule, "installUpdate")
      .mockImplementation((_ver, cb) => {
        progressCb = cb;
        return installPromise;
      });

    const onInstallingChange = vi.fn();

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={onInstallingChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates|update available/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download and install/i })).toBeDefined();
    });

    const installButton = screen.getByRole("button", { name: /download and install/i });
    fireEvent.click(installButton);
    // Duplicate click test (guard ref)
    fireEvent.click(installButton);

    expect(installSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledWith("2.0.0", expect.any(Function));
    expect(onInstallingChange).toHaveBeenCalledWith(true);

    // Progress updates
    act(() => {
      progressCb?.({
        phase: "downloading",
        downloaded: 2500000,
        total: 5000000,
      });
    });

    expect(screen.getByText(/50%/)).toBeDefined();
    expect(screen.getByText("Downloading update…")).toBeDefined();

    act(() => {
      progressCb?.({
        phase: "installing",
        downloaded: 5000000,
        total: 5000000,
      });
    });

    expect(screen.getByText("Installing update…")).toBeDefined();

    // While installing, Escape and backdrop click are blocked
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeDefined();

    const backdrop = document.querySelector(".dialog-backdrop");
    if (backdrop) {
      fireEvent.mouseDown(backdrop);
    }
    expect(screen.getByRole("dialog")).toBeDefined();

    // Resolve install
    await act(async () => {
      resolveInstall!();
    });

    // Stays installing, does not restore false because native app restarts
    expect(onInstallingChange).not.toHaveBeenCalledWith(false);
  });

  it("handles install failure, restores onInstallingChange(false), preserves available metadata, and allows retry", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "3.0.0",
      notes: "Version 3 notes",
    });

    const installSpy = vi
      .spyOn(appUpdatesModule, "installUpdate")
      .mockRejectedValueOnce(new Error("Download failed: connection reset"))
      .mockResolvedValueOnce();

    const onInstallingChange = vi.fn();

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={onInstallingChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates|update available/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download and install/i })).toBeDefined();
    });

    const installBtn = screen.getByRole("button", { name: /download and install/i });
    fireEvent.click(installBtn);

    expect(onInstallingChange).toHaveBeenCalledWith(true);

    await waitFor(() => {
      expect(screen.getByText(/Download failed: connection reset/i)).toBeDefined();
    });

    expect(onInstallingChange).toHaveBeenCalledWith(false);

    // Metadata is preserved (notes and version still present)
    expect(screen.getByText("Version 3 notes")).toBeDefined();

    // Explicit retry click
    const retryBtn = screen.getByRole("button", { name: /download and install/i });
    fireEvent.click(retryBtn);

    expect(installSpy).toHaveBeenCalledTimes(2);
  });

  it("closes modal via Later, Escape, or backdrop click and restores focus; Later does not install", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({ status: "current" });

    render(
      <div>
        <button id="outside-btn" type="button">Outside</button>
        <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
      </div>
    );

    const triggerBtn = screen.getByRole("button", { name: /check for updates/i });
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    // 1. Open and close via Later
    fireEvent.click(triggerBtn);
    expect(screen.getByRole("dialog")).toBeDefined();

    const laterBtn = screen.getByRole("button", { name: /later/i });
    fireEvent.click(laterBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(appUpdatesModule.installUpdate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(triggerBtn);

    // 2. Open and close via Escape
    fireEvent.click(triggerBtn);
    expect(screen.getByRole("dialog")).toBeDefined();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(triggerBtn);

    // 3. Open and close via backdrop click
    fireEvent.click(triggerBtn);
    const backdrop = document.querySelector(".dialog-backdrop");
    expect(backdrop).toBeDefined();
    if (backdrop) {
      fireEvent.mouseDown(backdrop);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(triggerBtn);
  });

  it("formats bytes, clamps percentage between 0 and 100, and supports indeterminate progress", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "1.0.0",
      notes: "Notes",
    });

    let progressCb: ((progress: UpdateProgress) => void) | undefined;
    vi.spyOn(appUpdatesModule, "installUpdate").mockImplementation((_ver, cb) => {
      progressCb = cb;
      return new Promise(() => {});
    });

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates|update available/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download and install/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /download and install/i }));

    // Indeterminate (total is null)
    act(() => {
      progressCb?.({
        phase: "downloading",
        downloaded: 1048576,
        total: null,
      });
    });

    const progressEl = document.querySelector(".update-progress");
    expect(progressEl).toBeDefined();
    expect(screen.getByText(/1\.0 MB downloaded/)).toBeDefined();

    // Clamped percentage: downloaded exceeds total
    act(() => {
      progressCb?.({
        phase: "downloading",
        downloaded: 6000000,
        total: 5000000,
      });
    });

    expect(screen.getByText(/100%/)).toBeDefined();
  });

  it("does not unlock onInstallingChange on unmount if currently installing", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "1.0.0",
      notes: "Notes",
    });

    vi.spyOn(appUpdatesModule, "installUpdate").mockReturnValue(new Promise(() => {}));
    const onInstallingChange = vi.fn();

    const { unmount } = render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={onInstallingChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates|update available/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download and install/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /download and install/i }));
    expect(onInstallingChange).toHaveBeenCalledWith(true);

    unmount();

    // Must not unlock incorrectly on unmount
    expect(onInstallingChange).not.toHaveBeenCalledWith(false);
  });

  it("adopts background check result under React.StrictMode and calls checkForUpdates only once", async () => {
    let resolveCheck: (result: UpdateCheck) => void;
    const checkPromise = new Promise<UpdateCheck>((resolve) => {
      resolveCheck = resolve;
    });
    const checkSpy = vi
      .spyOn(appUpdatesModule, "checkForUpdates")
      .mockReturnValue(checkPromise);

    render(
      <StrictMode>
        <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
      </StrictMode>
    );

    expect(checkSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCheck!({
        status: "available",
        version: "4.0.0",
        notes: "StrictMode safe release",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /update available/i })).toBeDefined();
    });
  });

  it("renders modal via portal to document.body and safely restores focus when trigger is inert", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({ status: "current" });

    const { container } = render(
      <div id="shell">
        <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
      </div>
    );

    const triggerBtn = screen.getByRole("button", { name: /check for updates/i });
    fireEvent.click(triggerBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();

    // Verify dialog is rendered outside the shell directly under document.body via portal
    const shell = container.querySelector("#shell");
    expect(shell?.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);

    // Make trigger inert as parent shell would do
    triggerBtn.setAttribute("inert", "");

    // Close dialog and verify no crash occurred during focus restoration
    const laterBtn = screen.getByRole("button", { name: /later/i });
    expect(() => fireEvent.click(laterBtn)).not.toThrow();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("displays native string rejections literally and unlocks on installing failure", async () => {
    vi.spyOn(appUpdatesModule, "checkForUpdates").mockResolvedValue({
      status: "available",
      version: "3.1.0",
      notes: "Release notes",
    });

    const nativeError = "Update download or signature verification failed: invalid signature";
    vi.spyOn(appUpdatesModule, "installUpdate").mockRejectedValue(nativeError);

    const onInstallingChange = vi.fn();

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={onInstallingChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /check for updates|update available/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download and install/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /download and install/i }));

    expect(onInstallingChange).toHaveBeenCalledWith(true);

    await waitFor(() => {
      expect(screen.getByText(nativeError)).toBeDefined();
    });

    expect(onInstallingChange).toHaveBeenCalledWith(false);
  });

  it("shares in-flight background check promise when trigger clicked during initial check", async () => {
    let resolveCheck: (result: UpdateCheck) => void;
    const checkPromise = new Promise<UpdateCheck>((resolve) => {
      resolveCheck = resolve;
    });

    const checkSpy = vi
      .spyOn(appUpdatesModule, "checkForUpdates")
      .mockReturnValue(checkPromise);

    render(
      <AppUpdates enabled={true} blockedReason={null} onInstallingChange={vi.fn()} />
    );

    expect(checkSpy).toHaveBeenCalledTimes(1);

    // User clicks while background check is still pending
    const triggerBtn = screen.getByRole("button", { name: /check for updates/i });
    fireEvent.click(triggerBtn);

    // Must NOT invoke a duplicate native call
    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Checking for updates…")).toBeDefined();

    await act(async () => {
      resolveCheck!({
        status: "available",
        version: "5.0.0",
        notes: "Shared promise notes",
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/5\.0\.0 available/i)).toBeDefined();
    });
  });
});
