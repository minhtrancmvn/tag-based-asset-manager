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
