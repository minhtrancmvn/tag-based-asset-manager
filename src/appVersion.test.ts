import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVELOPMENT_VERSION, getAppVersion } from "./appVersion";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("getAppVersion", () => {
  it("returns the native application version in desktop builds", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVersion).mockResolvedValue("0.2.0");

    await expect(getAppVersion()).resolves.toBe("Version 0.2.0");
  });

  it("returns a development fallback in browser builds without querying native metadata", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    await expect(getAppVersion()).resolves.toBe(DEVELOPMENT_VERSION);
    expect(getVersion).not.toHaveBeenCalled();
  });

  it("returns a development fallback when native metadata is unavailable", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getVersion).mockRejectedValue(new Error("native metadata unavailable"));

    await expect(getAppVersion()).resolves.toBe(DEVELOPMENT_VERSION);
  });
});
