import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates, installUpdate } from "./appUpdates";
import { invoke, isTauri } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(), invoke: vi.fn(),
  Channel: class { onmessage: ((event: unknown) => void) | null = null; },
}));

beforeEach(() => { vi.resetAllMocks(); vi.mocked(isTauri).mockReturnValue(true); });

describe("app update native boundary", () => {
  it("checks through fixed native command without library or URL arguments", async () => {
    vi.mocked(invoke).mockResolvedValue({ status: "current" });
    expect(await checkForUpdates()).toEqual({ status: "current" });
    expect(invoke).toHaveBeenCalledWith("check_for_updates");
  });
  it("does not invoke native commands in browser mode", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect((await checkForUpdates()).status).toBe("disabled");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("passes only offered version and progress channel for explicit install", async () => {
    await installUpdate("0.5.0", vi.fn());
    expect(invoke).toHaveBeenCalledWith("install_update", { version: "0.5.0", onProgress: expect.any(Object) });
  });
  it("propagates native signature and installation failures", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Update signature verification failed"));
    await expect(installUpdate("0.5.0", vi.fn())).rejects.toThrow("signature verification failed");
  });
});
