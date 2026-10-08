import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { AppError, AppTheme, Asset, AssetAction, BulkTagResult, BulkTagTarget, ExportResult, LibraryState, PreviewResult, ScanProgress, ScanResult, SearchFilters, TrashResult, ValidationReport } from "./types";

export interface LibraryClient {
  isDesktop: boolean;
  load: () => Promise<LibraryState>;
  setTheme: (theme: AppTheme) => Promise<LibraryState>;
  choose: () => Promise<LibraryState | null>;
  activate: (libraryId: string) => Promise<LibraryState>;
  remove: (libraryId: string) => Promise<LibraryState>;
  scan: (libraryId: string, scanId: string, onProgress: (progress: ScanProgress) => void) => Promise<ScanResult | null>;
  cancelScan: (libraryId: string, scanId: string) => Promise<boolean>;
  deleteAssets: (libraryId: string, targets: BulkTagTarget[]) => Promise<TrashResult>;
  previewAsset: (libraryId: string, assetId: string) => Promise<PreviewResult>;
  editTags: (libraryId: string, assetId: string, expectedRevision: string, addTags: string[], removeTags: string[]) => Promise<Asset>;
  bulkEditTags: (libraryId: string, targets: BulkTagTarget[], addTags: string[], removeTags: string[]) => Promise<BulkTagResult>;
  saveSearch: (libraryId: string, name: string, filters: SearchFilters, searchId: string | null) => Promise<LibraryState>;
  deleteSearch: (libraryId: string, searchId: string) => Promise<LibraryState>;
  performAction: (libraryId: string, assetId: string, action: AssetAction) => Promise<void>;
  validateMetadata: (libraryId: string) => Promise<ValidationReport>;
  exportMetadata: (libraryId: string) => Promise<ExportResult | null>;
  getReconnectTargets: (libraryId: string, assetId: string, expectedRevision: string) => Promise<Asset[]>;
  reconnectAsset: (libraryId: string, assetId: string, expectedRevision: string, targetAssetId: string) => Promise<ScanResult>;
}

export function toAppError(value: unknown): AppError {
  if (!(value instanceof Error) && typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
    return {
      message: value.message,
      path: "path" in value && typeof value.path === "string" ? value.path : null,
      details: "details" in value && typeof value.details === "string" ? value.details : null,
    };
  }
  return { message: "Operation could not finish. Try again or choose another library.", path: null, details: typeof value === "string" ? value : String(value) };
}

export const nativeClient: LibraryClient = {
  isDesktop: isTauri(),
  load: () => invoke<LibraryState>("library_state"),
  setTheme: (theme) => invoke<LibraryState>("set_app_theme", { theme }),
  choose: () => invoke<LibraryState | null>("choose_library"),
  activate: (libraryId) => invoke<LibraryState>("activate_library", { libraryId }),
  remove: (libraryId) => invoke<LibraryState>("remove_library", { libraryId }),
  editTags: (libraryId, assetId, expectedRevision, addTags, removeTags) => invoke<Asset>("edit_tags", { libraryId, assetId, expectedRevision, addTags, removeTags }),
  bulkEditTags: (libraryId, targets, addTags, removeTags) => invoke<BulkTagResult>("bulk_edit_tags", { libraryId, targets, addTags, removeTags }),
  saveSearch: (libraryId, name, filters, searchId) => invoke<LibraryState>("upsert_saved_search", { libraryId, name, filters, searchId }),
  deleteSearch: (libraryId, searchId) => invoke<LibraryState>("delete_saved_search", { libraryId, searchId }),
  performAction: (libraryId, assetId, action) => invoke<void>("asset_action", { libraryId, assetId, action }),
  validateMetadata: (libraryId) => invoke<ValidationReport>("validate_metadata", { libraryId }),
  exportMetadata: (libraryId) => invoke<ExportResult | null>("export_metadata", { libraryId }),
  getReconnectTargets: (libraryId, assetId, expectedRevision) => invoke<Asset[]>("reconnect_targets", { libraryId, assetId, expectedRevision }),
  reconnectAsset: (libraryId, assetId, expectedRevision, targetAssetId) => invoke<ScanResult>("reconnect_asset", { libraryId, assetId, expectedRevision, targetAssetId }),
  scan: (libraryId, scanId, onProgress) => {
    const channel = new Channel<ScanProgress>();
    channel.onmessage = onProgress;
    return invoke<ScanResult | null>("scan_library", { libraryId, scanId, onProgress: channel });
  },
  cancelScan: (libraryId, scanId) => invoke<boolean>("cancel_scan", { libraryId, scanId }),
  deleteAssets: (libraryId, targets) => invoke<TrashResult>("delete_assets", { libraryId, targets }),
  previewAsset: (libraryId, assetId) => invoke<PreviewResult>("preview_asset", { libraryId, assetId }),
};
