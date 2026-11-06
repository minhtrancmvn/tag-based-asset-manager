import type { AppTheme } from "./themes";
export type { AppTheme } from "./themes";
export type { RenameMapping, RenameMode } from "./tagRename";
import type { RenameMapping, RenameMode } from "./tagRename";

export type AssetKind = "file" | "folder";
export type AssetStatus = "ready" | "untagged" | "missing" | "warning";

/** Native asset DTO. Row ID is path-derived; metadataId is durable sidecar UUID. */
export interface Asset {
  id: string;
  name: string;
  relativePath: string;
  kind: AssetKind;
  extension: string | null;
  modifiedAt: string | null;
  sizeBytes: number | null;
  tags: string[];
  status: AssetStatus;
  notes?: string;
  metadataId?: string | null;
  metadataState?: "none" | "valid" | "blocked";
  metadataRevision?: string;
}

export interface LibrarySummary {
  id: string;
  name: string;
  rootPath: string;
  assetCount: number;
  lastScanAt: string | null;
}

export type TagMatchMode = "all" | "any";
export type KindFilter = "all" | AssetKind;

export interface SearchFilters {
  query: string;
  view: ViewKey;
  matchMode: TagMatchMode;
  kind: KindFilter;
}

export interface SavedSearch {
  id: string;
  libraryId: string;
  name: string;
  filters: SearchFilters;
}

export interface BulkTagTarget {
  assetId: string;
  expectedRevision: string;
}

export interface BulkTagResult {
  assets: Asset[];
  error: AppError | null;
}

export interface LibraryState {
  libraries: LibrarySummary[];
  activeLibraryId: string | null;
  savedSearches?: SavedSearch[];
  theme?: AppTheme;
}

export interface AppError {
  message: string;
  path: string | null;
  details: string | null;
}

export interface ScanIssue {
  message: string;
  path: string;
  details: string;
}

export type AssetAction = "open" | "reveal" | "copyFullPath" | "copyRelativePath";

export interface ValidationReport {
  libraryId: string;
  assetsChecked: number;
  issues: ScanIssue[];
  validatedAt: string;
}

export interface ExportResult {
  path: string;
  assetCount: number;
}

export interface TrashResult {
  completedIds: string[];
  error: AppError | null;
}

export interface PreviewResult {
  kind: "text" | "image" | "unsupported";
  content: string | null;
  mimeType: string | null;
  truncated: boolean;
  message: string | null;
}

export interface ScanProgress {
  libraryId: string;
  scanId: string;
  visited: number;
}

export interface ScanResult {
  libraryId: string;
  scanId: string;
  assets: Asset[];
  issues: ScanIssue[];
  scannedAt: string;
}

export type ViewKey = "all" | "untagged" | "attention";
export type SortKey = "name" | "tags" | "type" | "path" | "modified" | "size" | "status";
export type SortDirection = "asc" | "desc";

/** One saved-search replacement in a native rename preview request; native excludes `name`. */
export interface RenameSavedSearchReplacement {
  searchId: string;
  expectedFilters: SearchFilters;
  filters: SearchFilters;
}

export interface RenamePreviewRequest {
  libraryId: string;
  scanId: string;
  mode: RenameMode;
  source: string;
  destination: string;
  normalizedMapping: RenameMapping;
  savedSearchReplacements: RenameSavedSearchReplacement[];
}

export interface RenameTargetSummary {
  assetId: string;
  relativePath: string;
  kind: AssetKind;
  sidecarOwner: string;
  duplicatesCollapsed: number;
}

export interface RenameCollision {
  from: string;
  to: string;
}

export type RenameSkipReason = "missing" | "blocked";

export interface RenameSkippedRow {
  assetId: string;
  relativePath: string;
  kind: AssetKind;
  reason: RenameSkipReason;
  message: string | null;
}

export interface RenamePreview {
  previewId: string;
  libraryId: string;
  scanId: string;
  mapping: RenameMapping;
  scan: ScanResult;
  targets: RenameTargetSummary[];
  fileCount: number;
  folderCount: number;
  sidecarCount: number;
  destinationExists: boolean;
  collisions: RenameCollision[];
  duplicatesCollapsed: number;
  skipped: RenameSkippedRow[];
  uninspectable: ScanIssue[];
  savedSearchUpdateCount: number;
  settingsRetry: boolean;
}

export type RenameDiscardReason = "mutation" | "library-changed" | "sidecar-changed";

export type RenamePreviewOutcome =
  | { status: "ready"; preview: RenamePreview }
  | { status: "cancelled" }
  | { status: "discarded"; reason: RenameDiscardReason };

export type RenameOutcome = "complete" | "partial" | "settings-failed";

export interface RenameApplyResult {
  previewId: string;
  libraryId: string;
  mapping: RenameMapping;
  committed: Asset[];
  failed: RenameTargetSummary[];
  unattempted: RenameTargetSummary[];
  failingSidecar: string | null;
  skipped: RenameSkippedRow[];
  uninspectable: ScanIssue[];
  savedSearches: SavedSearch[];
  error: AppError | null;
  outcome: RenameOutcome;
  queryMigrated: boolean;
}
