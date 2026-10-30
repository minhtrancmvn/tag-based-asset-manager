import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

export const DEVELOPMENT_VERSION = "Development build · version unavailable";

export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return DEVELOPMENT_VERSION;
  try {
    return `Version ${await getVersion()}`;
  } catch {
    return DEVELOPMENT_VERSION;
  }
}
