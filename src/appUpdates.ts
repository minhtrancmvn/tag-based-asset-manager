import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export type UpdateCheck =
  | { status: "disabled"; reason: string }
  | { status: "current" }
  | { status: "available"; version: string; notes: string };

export interface UpdateProgress {
  phase: "downloading" | "installing";
  downloaded: number;
  total: number | null;
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  if (!isTauri()) return { status: "disabled", reason: "Updates require the desktop app." };
  return invoke<UpdateCheck>("check_for_updates");
}

export async function installUpdate(version: string, onProgress: (progress: UpdateProgress) => void): Promise<void> {
  if (!isTauri()) throw new Error("Updates require the desktop app.");
  const channel = new Channel<UpdateProgress>();
  channel.onmessage = onProgress;
  await invoke("install_update", { version, onProgress: channel });
}
