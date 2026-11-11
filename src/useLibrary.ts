import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryClient } from "./native";
import { nativeClient, toAppError } from "./native";
import { deriveRenameMigration, normalizeRenameMapping } from "./tagRename";
import { sizeRange, trackUsage as sendUsageEvent } from "./usage";
import type { UsageEvent } from "./usage";
import type { RenameBlocker, RenameMappingError, RenameMigration } from "./tagRename";
import type {
  AppError, AppTheme, Asset, AssetAction, ExportResult, LibraryState, PreviewResult, RenameApplyResult, RenameDiscardReason,
  RenameMapping, RenameMode, RenamePreview, RenamePreviewRequest, RenameTargetSummary, SavedSearch, ScanIssue, ScanResult, SearchFilters, UsageConsentResult, ValidationReport,
} from "./types";

const emptyState: LibraryState = { libraries: [], activeLibraryId: null };

export interface RenamePreviewInput {
  mode: RenameMode;
  /** Raw names as typed; native normalizes them and must agree with the mapping this hook derives. */
  source: string;
  destination: string;
  /** Filters the user currently has applied. The query is captured here for the completion compare-and-set. */
  activeFilters: SearchFilters;
}

/** Access to the session-owned active query. The hook reads it again at completion and writes only if unchanged. */
export interface ActiveQueryBinding {
  read: () => string;
  write: (query: string) => void;
}

export type RenamePreviewResult =
  | { status: "ready"; preview: RenamePreview; migration: RenameMigration }
  | { status: "cancelled" }
  | { status: "discarded"; reason: RenameDiscardReason }
  | { status: "invalid"; error: RenameMappingError }
  | { status: "blocked"; blockers: RenameBlocker[] }
  /** Another native operation is running, no desktop library is active or there is no matching preview. */
  | { status: "unavailable" }
  /** The library, generation or component changed while the request ran; nothing was applied. */
  | { status: "stale" }
  /** A native or validation error was recorded in the hook error state. */
  | { status: "failed" };

export type RenameApplyHookResult =
  | { status: "applied"; result: RenameApplyResult; queryUpdated: boolean }
  | { status: "unavailable" }
  | { status: "stale" }
  | { status: "failed" };

interface PendingRename {
  previewId: string;
  libraryId: string;
  mapping: RenameMapping;
  targets: RenameTargetSummary[];
  migration: RenameMigration;
}

interface ActiveRename {
  kind: "preview" | "apply";
  libraryId: string;
  scanId: string;
  cancelled: boolean;
}

function renameFailure(message: string): never {
  throw new Error(message);
}

function sameMapping(left: RenameMapping, right: RenameMapping): boolean {
  return left.mode === right.mode && left.source === right.source && left.destination === right.destination;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const map = new Map(items.map((item) => [key(item), item]));
  if (map.size !== items.length) renameFailure("Rename response repeated a row.");
  return map;
}

/** Throws unless a native preview is exactly the response to `request`. */
function validateRenamePreview(preview: RenamePreview, request: RenamePreviewRequest): void {
  if (typeof preview.previewId !== "string" || preview.previewId === "") renameFailure("Rename preview has no preview ID.");
  if (preview.libraryId !== request.libraryId || preview.scanId !== request.scanId) renameFailure("Rename preview did not match the requested library.");
  if (preview.scan.libraryId !== request.libraryId || preview.scan.scanId !== request.scanId) renameFailure("Rename preview catalog did not match the requested scan.");
  if (!sameMapping(preview.mapping, request.normalizedMapping)) renameFailure("Rename preview did not match the requested mapping.");
  const rows = uniqueBy(preview.scan.assets, (asset) => asset.id);
  for (const target of uniqueBy(preview.targets, (item) => item.assetId).values()) {
    const row = rows.get(target.assetId);
    if (!row || row.relativePath !== target.relativePath || row.kind !== target.kind) renameFailure("Rename preview target did not match the preview catalog.");
  }
  if (preview.savedSearchUpdateCount !== request.savedSearchReplacements.length) renameFailure("Rename preview did not bind the requested saved searches.");
}

/** Throws unless a native apply result is internally consistent and answers the preview that was applied. */
function validateRenameApply(result: RenameApplyResult, pending: PendingRename, currentSearches: readonly SavedSearch[]): void {
  if (result.previewId !== pending.previewId || result.libraryId !== pending.libraryId) renameFailure("Rename result did not match the applied preview.");
  if (!sameMapping(result.mapping, pending.mapping)) renameFailure("Rename result did not match the previewed mapping.");
  const requested = uniqueBy(pending.targets, (target) => target.assetId);
  const seen = new Set<string>();
  const claim = (assetId: string, relativePath: string, kind: string): void => {
    const target = requested.get(assetId);
    if (!target || target.relativePath !== relativePath || target.kind !== kind) renameFailure("Rename result named a row that was not requested.");
    if (seen.has(assetId)) renameFailure("Rename result placed a row in more than one partition.");
    seen.add(assetId);
  };
  for (const asset of result.committed) claim(asset.id, asset.relativePath, asset.kind);
  for (const target of result.failed) claim(target.assetId, target.relativePath, target.kind);
  for (const target of result.unattempted) claim(target.assetId, target.relativePath, target.kind);
  if (seen.size !== requested.size) renameFailure("Rename result omitted requested rows.");

  const unapplied = result.failed.length + result.unattempted.length;
  switch (result.outcome) {
    case "complete":
      if (unapplied > 0 || result.error !== null || !result.queryMigrated) renameFailure("Rename result outcome contradicted its rows.");
      break;
    case "partial":
      if (unapplied === 0 || result.queryMigrated) renameFailure("Rename result outcome contradicted its rows.");
      break;
    case "settings-failed":
      if (unapplied > 0 || result.error === null || result.queryMigrated) renameFailure("Rename result outcome contradicted its rows.");
      break;
    default:
      renameFailure("Rename result has an unknown outcome.");
  }

  const known = new Set(currentSearches.filter((search) => search.libraryId === pending.libraryId).map((search) => search.id));
  const returned = new Set<string>();
  for (const search of result.savedSearches) {
    if (search.libraryId !== pending.libraryId || !known.has(search.id) || returned.has(search.id)) renameFailure("Rename result named a saved search outside the active library.");
    returned.add(search.id);
  }
}

export function useLibrary(client: LibraryClient = nativeClient) {
  const [state, setState] = useState<LibraryState>(emptyState);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [issues, setIssues] = useState<ScanIssue[]>([]);
  const [loading, setLoading] = useState(client.isDesktop);
  const [scanning, setScanning] = useState(false);
  const [scanStopped, setScanStopped] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editingNotesAssetId, setEditingNotesAssetId] = useState<string | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingUsage, setSavingUsage] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [renamePreviewing, setRenamePreviewing] = useState(false);
  const [renameApplying, setRenameApplying] = useState(false);
  const [renameProgress, setRenameProgress] = useState(0);
  const scanBusy = useRef(false);
  const activeScan = useRef<{ libraryId: string; scanId: string; cancelled: boolean } | null>(null);
  const mounted = useRef(false);
  const stateRef = useRef(emptyState);
  const scanGeneration = useRef(0);
  const operation = useRef(false);
  const activeRename = useRef<ActiveRename | null>(null);
  const pendingRename = useRef<PendingRename | null>(null);
  /** Guards only `setUsageConsent`; deliberately independent of `operation`, `scanBusy` and `loading`. */
  const usageSaving = useRef(false);
  /** Libraries whose first completed scan this launch was already counted for `library_scanned`. */
  const scannedLibraries = useRef(new Set<string>());

  const trackUsage = useCallback((event: UsageEvent): void => sendUsageEvent(client, event), [client]);

  const scan = useCallback(async (libraryId: string) => {
    const generation = ++scanGeneration.current;
    const scanId = crypto.randomUUID();
    const request = { libraryId, scanId, cancelled: false };
    activeScan.current = request;
    const current = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId && activeScan.current === request;
    setAssets([]);
    setIssues([]);
    setProgress(0);
    setScanning(true);
    setScanStopped(false);
    scanBusy.current = true;
    setError(null);
    setValidation(null);
    try {
      const result = await client.scan(libraryId, scanId, (update) => {
        if (current() && update.libraryId === libraryId && update.scanId === scanId) setProgress(update.visited);
      });
      if (!current() || request.cancelled) return;
      if (result === null) { setScanStopped(true); return; }
      if (result.libraryId !== libraryId || result.scanId !== scanId) throw new Error("Scan response did not match the requested library.");
      setAssets(result.assets);
      setIssues(result.issues);
      setProgress(result.assets.length);
      const updated = {
        ...stateRef.current,
        libraries: stateRef.current.libraries.map((library) => library.id === libraryId
          ? { ...library, assetCount: result.assets.length, lastScanAt: result.scannedAt } : library),
      };
      stateRef.current = updated;
      setState(updated);
      // Only an effective "granted" consumes the once-per-launch slot, so a later opt-in still reports one scan.
      if (stateRef.current.usage?.consent === "granted" && !scannedLibraries.current.has(libraryId)) {
        scannedLibraries.current.add(libraryId);
        trackUsage({ name: "library_scanned", size_range: sizeRange(result.assets.length) });
      }
    } catch (failure) {
      if (current()) setError(toAppError(failure));
    } finally {
      if (current()) {
        activeScan.current = null;
        setScanning(false);
        scanBusy.current = false;
      }
    }
  }, [client, trackUsage]);

  const cancelScan = useCallback(async () => {
    const scan = activeScan.current;
    if (!client.isDesktop || !scan || scan.cancelled) return false;
    scan.cancelled = true;
    const generation = ++scanGeneration.current;
    setAssets([]);
    setIssues([]);
    setScanning(false);
    setScanStopped(true);
    scanBusy.current = false;
    activeScan.current = null;
    try {
      return await client.cancelScan(scan.libraryId, scan.scanId);
    } catch (failure) {
      if (mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === scan.libraryId) setError(toAppError(failure));
      return false;
    }
  }, [client]);

  const applyState = useCallback((next: LibraryState) => {
    const previous = activeScan.current;
    if (previous) {
      previous.cancelled = true;
      void client.cancelScan(previous.libraryId, previous.scanId).catch((failure) => {
        if (mounted.current && stateRef.current.activeLibraryId === next.activeLibraryId) setError(toAppError(failure));
      });
    }
    activeScan.current = null;
    ++scanGeneration.current;
    stateRef.current = next;
    setState(next);
    setValidation(null);
    setExportResult(null);
    setAssets([]);
    setIssues([]);
    setProgress(0);
    setScanning(false);
    setScanStopped(false);
    setDeleting(false);
    scanBusy.current = false;
    if (next.activeLibraryId) void scan(next.activeLibraryId);
  }, [client, scan]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    if (client.isDesktop) {
      setLoading(true);
      void client.load().then((next) => {
        if (!cancelled) applyState(next);
      }).catch((failure: unknown) => {
        if (!cancelled) setError(toAppError(failure));
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    return () => {
      cancelled = true;
      mounted.current = false;
      ++scanGeneration.current;
      const pending = activeScan.current;
      activeScan.current = null;
      if (pending) {
        pending.cancelled = true;
        // Unmount has no error surface; cancellation is best effort while native task winds down.
        void client.cancelScan(pending.libraryId, pending.scanId).catch(() => {});
      }
    };
  }, [client, applyState]);

  const mutateRegistration = useCallback(async (action: () => Promise<LibraryState | null>) => {
    if (!client.isDesktop || operation.current) return;
    operation.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await action();
      if (mounted.current && next) applyState(next);
    } catch (failure) {
      if (mounted.current) setError(toAppError(failure));
    } finally {
      operation.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [client, applyState]);

  // mutateRegistration resolves to nothing, so each wrapper compares stateRef (which applyState updates) around the await.
  const chooseLibrary = useCallback(async (): Promise<void> => {
    const before = stateRef.current.libraries.length;
    await mutateRegistration(client.choose);
    if (stateRef.current.libraries.length > before) trackUsage({ name: "library_add" });
  }, [client, mutateRegistration, trackUsage]);
  const activateLibrary = useCallback(async (id: string): Promise<void> => {
    const before = stateRef.current.activeLibraryId;
    await mutateRegistration(() => client.activate(id));
    if (stateRef.current.activeLibraryId !== before) trackUsage({ name: "library_switch" });
  }, [client, mutateRegistration, trackUsage]);
  const removeLibrary = useCallback(async (id: string): Promise<void> => {
    const before = stateRef.current.libraries.length;
    await mutateRegistration(() => client.remove(id));
    if (stateRef.current.libraries.length < before) trackUsage({ name: "library_remove" });
  }, [client, mutateRegistration, trackUsage]);
  const rescan = useCallback(async () => {
    const id = stateRef.current.activeLibraryId;
    if (client.isDesktop && id && !operation.current && !scanBusy.current) await scan(id);
  }, [client, scan]);
  const editTags = useCallback(async (asset: Asset, addTags: string[], removeTags: string[]): Promise<boolean> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current || asset.status === "missing" || asset.metadataState === "blocked" || !asset.metadataRevision) return false;
    operation.current = true;
    const generation = scanGeneration.current;
    const current = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId;
    setEditingAssetId(asset.id);
    setError(null);
    try {
      const updated = await client.editTags(libraryId, asset.id, asset.metadataRevision, addTags, removeTags);
      if (!current()) return false;
      if (updated.id !== asset.id || updated.relativePath !== asset.relativePath) throw new Error("Metadata response did not match the selected asset.");
      setAssets((rows) => rows.map((row) => row.id === asset.id ? updated : row));
      trackUsage({ name: "tag_edit" });
      return true;
    } catch (failure) {
      if (current()) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setEditingAssetId(null);
    }
  }, [client, trackUsage]);
  const editNotes = useCallback(async (asset: Asset, notes: string): Promise<boolean> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current || asset.status === "missing" || asset.metadataState === "blocked" || !asset.metadataRevision) return false;
    operation.current = true;
    const generation = scanGeneration.current;
    const current = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId;
    setEditingNotesAssetId(asset.id);
    setError(null);
    try {
      const updated = await client.editNotes(libraryId, asset.id, asset.metadataRevision, notes);
      if (!current()) return false;
      if (updated.id !== asset.id || updated.relativePath !== asset.relativePath) throw new Error("Notes response did not match the selected asset.");
      setAssets((rows) => rows.map((row) => row.id === asset.id ? updated : row));
      return true;
    } catch (failure) {
      if (current()) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setEditingNotesAssetId(null);
    }
  }, [client]);
  const bulkEditTags = useCallback(async (targets: Asset[], addTags: string[], removeTags: string[]): Promise<boolean> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current || targets.length === 0 ||
      new Set(targets.map((asset) => asset.id)).size !== targets.length ||
      targets.some((asset) => asset.status === "missing" || asset.metadataState === "blocked" || !asset.metadataRevision)) return false;
    operation.current = true;
    const generation = scanGeneration.current;
    const current = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId;
    setBulkEditing(true);
    setError(null);
    try {
      const result = await client.bulkEditTags(libraryId, targets.map((asset) => ({ assetId: asset.id, expectedRevision: asset.metadataRevision! })), addTags, removeTags);
      if (!current()) return false;
      const requested = new Map(targets.map((asset) => [asset.id, asset.relativePath]));
      if (new Set(result.assets.map((asset) => asset.id)).size !== result.assets.length || result.assets.some((asset) => requested.get(asset.id) !== asset.relativePath)) throw new Error("Bulk response did not match selected assets.");
      const updated = new Map(result.assets.map((asset) => [asset.id, asset]));
      setAssets((rows) => rows.map((row) => updated.get(row.id) ?? row));
      // Committed rows count even when the batch later failed; a zero-row result changed nothing.
      if (result.assets.length > 0) trackUsage({ name: "bulk_tag_edit" });
      if (result.error) { setError(result.error); return false; }
      if (result.assets.length !== targets.length) throw new Error("Bulk response omitted selected assets.");
      return true;
    } catch (failure) {
      if (current()) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setBulkEditing(false);
    }
  }, [client, trackUsage]);

  const mutateSearch = useCallback(async (action: (libraryId: string) => Promise<LibraryState>): Promise<boolean> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current) return false;
    operation.current = true;
    setSavingSearch(true);
    setError(null);
    try {
      const next = await action(libraryId);
      if (!mounted.current || stateRef.current.activeLibraryId !== libraryId) return false;
      if (next.activeLibraryId !== libraryId) throw new Error("Search response changed the active library.");
      // Settings commands can return an older scan count; preserve current catalog summary.
      const merged = { ...next, libraries: next.libraries.map((library) => library.id === libraryId ? stateRef.current.libraries.find((current) => current.id === libraryId) ?? library : library) };
      stateRef.current = merged;
      setState(merged);
      return true;
    } catch (failure) {
      if (mounted.current) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setSavingSearch(false);
    }
  }, [client]);
  const setTheme = useCallback(async (theme: AppTheme): Promise<boolean> => {
    if (!client.isDesktop || loading || operation.current || scanBusy.current) return false;
    operation.current = true;
    setSavingTheme(true);
    setError(null);
    try {
      const next = await client.setTheme(theme);
      if (!mounted.current) return false;
      if (next.activeLibraryId !== stateRef.current.activeLibraryId || next.theme !== theme) throw new Error("Theme response did not match the requested settings.");
      const updated = { ...stateRef.current, theme: next.theme };
      stateRef.current = updated;
      setState(updated);
      trackUsage({ name: "theme_change", theme: next.theme });
      return true;
    } catch (failure) {
      if (mounted.current) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setSavingTheme(false);
    }
  }, [client, loading, trackUsage]);
  const setUsageConsent = useCallback(async (consent: "granted" | "declined"): Promise<UsageConsentResult> => {
    if (!client.isDesktop) return { status: "failed" };
    // A second call while one is in flight does not reach native; it reports "busy" and leaves the first call's result untouched.
    if (usageSaving.current) return { status: "busy" };
    usageSaving.current = true;
    setSavingUsage(true);
    try {
      const result = await client.setUsageConsent(consent);
      // Merge the effective choice the way setTheme merges `theme`; never applyState, never the global error.
      if (mounted.current && result.usage) {
        const updated = { ...stateRef.current, usage: result.usage };
        stateRef.current = updated;
        setState(updated);
      }
      return result;
    } catch {
      return { status: "failed" };
    } finally {
      usageSaving.current = false;
      if (mounted.current) setSavingUsage(false);
    }
  }, [client]);
  const saveSearch = useCallback(async (name: string, filters: SearchFilters, searchId?: string): Promise<boolean> => {
    const saved = await mutateSearch((libraryId) => client.saveSearch(libraryId, name, filters, searchId ?? null));
    if (saved) trackUsage({ name: "saved_search_save" });
    return saved;
  }, [client, mutateSearch, trackUsage]);
  const deleteSearch = useCallback(async (searchId: string): Promise<boolean> => {
    const deleted = await mutateSearch((libraryId) => client.deleteSearch(libraryId, searchId));
    if (deleted) trackUsage({ name: "saved_search_delete" });
    return deleted;
  }, [client, mutateSearch, trackUsage]);
  const runNativeOperation = useCallback(async <T,>(action: (libraryId: string) => Promise<T>, onResult: (result: T, libraryId: string) => boolean, recovery = false): Promise<boolean> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current) return false;
    operation.current = true;
    const generation = scanGeneration.current;
    const current = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId;
    if (recovery) setRecoveryBusy(true); else setActionBusy(true);
    setError(null);
    try {
      const result = await action(libraryId);
      return current() ? onResult(result, libraryId) : false;
    } catch (failure) {
      if (current()) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) { if (recovery) setRecoveryBusy(false); else setActionBusy(false); }
    }
  }, [client]);
  const performAction = useCallback(async (asset: Asset, action: AssetAction) => {
    if (asset.status === "missing") return false;
    const succeeded = await runNativeOperation((libraryId) => client.performAction(libraryId, asset.id, action), () => true);
    if (succeeded) trackUsage({ name: action === "open" ? "asset_open" : action === "reveal" ? "asset_reveal" : "path_copy" });
    return succeeded;
  }, [client, runNativeOperation, trackUsage]);
  const validateMetadata = useCallback(() => runNativeOperation((libraryId) => client.validateMetadata(libraryId), (report, libraryId) => {
    if (report.libraryId !== libraryId) throw new Error("Validation response did not match active library.");
    setValidation(report);
    return true;
  }), [client, runNativeOperation]);
  const exportMetadata = useCallback(async () => {
    setExportResult(null);
    return runNativeOperation((libraryId) => client.exportMetadata(libraryId), (result) => {
      setExportResult(result);
      if (result === null) return false;
      trackUsage({ name: "metadata_export" });
      return true;
    });
  }, [client, runNativeOperation, trackUsage]);
  const getReconnectTargets = useCallback(async (asset: Asset): Promise<Asset[] | null> => {
    if (asset.status !== "missing" || asset.metadataState !== "valid" || !asset.metadataRevision || !asset.metadataId) return null;
    let choices: Asset[] | null = null;
    await runNativeOperation((libraryId) => client.getReconnectTargets(libraryId, asset.id, asset.metadataRevision!), (rows) => { choices = rows; return true; }, true);
    return choices;
  }, [client, runNativeOperation]);
  const applyRepairScan = useCallback((result: ScanResult, libraryId: string) => {
    if (result.libraryId !== libraryId) throw new Error("Repair response did not match active library.");
    ++scanGeneration.current;
    setAssets(result.assets);
    setIssues(result.issues);
    setValidation(null);
    const next = { ...stateRef.current, libraries: stateRef.current.libraries.map((library) => library.id === libraryId ? { ...library, assetCount: result.assets.length, lastScanAt: result.scannedAt } : library) };
    stateRef.current = next;
    setState(next);
    return true;
  }, []);
  const reconnectAsset = useCallback(async (source: Asset, target: Asset) => {
    if (source.status !== "missing" || source.metadataState !== "valid" || !source.metadataRevision || !source.metadataId || target.status === "missing" || target.kind !== "file" || target.metadataId || target.metadataState === "blocked") return false;
    const reconnected = await runNativeOperation((libraryId) => client.reconnectAsset(libraryId, source.id, source.metadataRevision!, target.id), applyRepairScan, true);
    if (reconnected) trackUsage({ name: "asset_reconnect" });
    return reconnected;
  }, [client, runNativeOperation, applyRepairScan, trackUsage]);
  const removeMissingEntry = useCallback(async (asset: Asset) => {
    if (asset.status !== "missing" || asset.metadataState !== "valid" || !asset.metadataRevision || !asset.metadataId) return false;
    const removed = await runNativeOperation((libraryId) => client.removeMissingEntry(libraryId, asset.id, asset.metadataRevision!), applyRepairScan, true);
    if (removed) trackUsage({ name: "missing_entry_remove" });
    return removed;
  }, [client, runNativeOperation, applyRepairScan, trackUsage]);
  const deleteAssets = useCallback(async (targets: Asset[]): Promise<boolean> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current || targets.length === 0) return false;
    if (targets.some((asset) => asset.relativePath === "." || asset.status === "missing" || asset.metadataState === "blocked" || !asset.metadataRevision)) return false;
    if (new Set(targets.map((asset) => asset.id)).size !== targets.length) return false;
    operation.current = true;
    const generation = scanGeneration.current;
    const current = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId;
    setDeleting(true);
    setError(null);
    try {
      const result = await client.deleteAssets(libraryId, targets.map((asset) => ({ assetId: asset.id, expectedRevision: asset.metadataRevision! })));
      if (!current()) return false;
      const requested = new Map(targets.map((asset) => [asset.id, asset]));
      if (new Set(result.completedIds).size !== result.completedIds.length || result.completedIds.some((id) => !requested.has(id))) throw new Error("Delete response did not match selected assets.");
      if (result.completedIds.length > 0) trackUsage({ name: "asset_trash" });
      const removed = result.completedIds.map((id) => requested.get(id)!);
      setAssets((rows) => rows.filter((row) => !removed.some((asset) => row.id === asset.id || (asset.kind === "folder" && row.relativePath.startsWith(`${asset.relativePath}/`)))));
      setValidation(null);
      setExportResult(null);
      if (result.error) { setError({ ...result.error, message: `${result.completedIds.length} of ${targets.length} items moved to Trash / Recycle Bin. ${result.error.message}` }); return false; }
      if (result.completedIds.length !== targets.length) throw new Error("Delete response omitted selected assets.");
      return true;
    } catch (failure) {
      if (current()) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setDeleting(false);
    }
  }, [client, trackUsage]);
  const previewAsset = useCallback(async (asset: Asset): Promise<PreviewResult | null> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || asset.status === "missing" || scanBusy.current || operation.current) return null;
    const generation = scanGeneration.current;
    const result = await client.previewAsset(libraryId, asset.id);
    return mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId ? result : null;
  }, [client]);
  useEffect(() => () => {
    // Unmount has no error surface. Cancellation is best effort; the stale-result guards drop whatever still arrives.
    const running = activeRename.current;
    if (running?.kind === "preview" && !running.cancelled) void client.cancelScan(running.libraryId, running.scanId).catch(() => {});
  }, [client]);

  const previewTagRename = useCallback(async (input: RenamePreviewInput): Promise<RenamePreviewResult> => {
    const libraryId = stateRef.current.activeLibraryId;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current) return { status: "unavailable" };
    const normalized = normalizeRenameMapping(input.mode, input.source, input.destination);
    if (!normalized.ok) return { status: "invalid", error: normalized.error };
    // The one canonical derivation covers the active query and every saved search before each request.
    const migration = deriveRenameMigration({
      libraryId, activeFilters: input.activeFilters, savedSearches: stateRef.current.savedSearches ?? [], mapping: normalized.mapping,
    });
    if (migration.blockers.length > 0) return { status: "blocked", blockers: migration.blockers };

    operation.current = true;
    pendingRename.current = null;
    const generation = scanGeneration.current;
    const request: ActiveRename = { kind: "preview", libraryId, scanId: crypto.randomUUID(), cancelled: false };
    activeRename.current = request;
    const live = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId && activeRename.current === request;
    setRenamePreviewing(true);
    setRenameProgress(0);
    setError(null);
    const nativeRequest: RenamePreviewRequest = {
      libraryId, scanId: request.scanId, mode: input.mode, source: input.source, destination: input.destination,
      normalizedMapping: normalized.mapping,
      savedSearchReplacements: migration.replacements.map(({ searchId, expectedFilters, filters }) => ({ searchId, expectedFilters, filters })),
    };
    try {
      const outcome = await client.previewTagRename(nativeRequest, (update) => {
        if (live() && !request.cancelled && update.libraryId === libraryId && update.scanId === request.scanId) setRenameProgress(update.visited);
      });
      if (!live()) return { status: "stale" };
      if (request.cancelled) return { status: "cancelled" };
      switch (outcome.status) {
        case "cancelled": return { status: "cancelled" };
        case "discarded": return { status: "discarded", reason: outcome.reason };
        case "ready": {
          validateRenamePreview(outcome.preview, nativeRequest);
          // Catalog only: no applyState, scan, selection reset or summary write.
          setAssets(outcome.preview.scan.assets);
          setIssues(outcome.preview.scan.issues);
          pendingRename.current = {
            previewId: outcome.preview.previewId, libraryId, mapping: outcome.preview.mapping, targets: outcome.preview.targets, migration,
          };
          return { status: "ready", preview: outcome.preview, migration };
        }
        default: return renameFailure("Rename preview returned an unknown status.");
      }
    } catch (failure) {
      if (!live()) return { status: "stale" };
      if (request.cancelled) return { status: "cancelled" };
      setError(toAppError(failure));
      return { status: "failed" };
    } finally {
      if (activeRename.current === request) activeRename.current = null;
      operation.current = false;
      if (mounted.current) setRenamePreviewing(false);
    }
  }, [client]);

  const cancelTagRenamePreview = useCallback(async (): Promise<boolean> => {
    const request = activeRename.current;
    if (!client.isDesktop || !request || request.kind !== "preview" || request.cancelled) return false;
    request.cancelled = true;
    try {
      return await client.cancelScan(request.libraryId, request.scanId);
    } catch (failure) {
      if (mounted.current && stateRef.current.activeLibraryId === request.libraryId) setError(toAppError(failure));
      return false;
    }
  }, [client]);

  const applyTagRename = useCallback(async (previewId: string, activeQuery: ActiveQueryBinding): Promise<RenameApplyHookResult> => {
    const libraryId = stateRef.current.activeLibraryId;
    const pending = pendingRename.current;
    if (!client.isDesktop || !libraryId || operation.current || scanBusy.current || !pending || pending.previewId !== previewId || pending.libraryId !== libraryId) return { status: "unavailable" };
    // Native consumes the preview on any outcome, so a retry always needs a fresh one.
    pendingRename.current = null;
    operation.current = true;
    const generation = scanGeneration.current;
    const request: ActiveRename = { kind: "apply", libraryId, scanId: previewId, cancelled: false };
    activeRename.current = request;
    const live = () => mounted.current && generation === scanGeneration.current && stateRef.current.activeLibraryId === libraryId;
    setRenameApplying(true);
    setError(null);
    try {
      const result = await client.applyTagRename(libraryId, previewId);
      if (!live()) return { status: "stale" };
      validateRenameApply(result, pending, stateRef.current.savedSearches ?? []);
      // Everything below runs only for a fully validated result, including partial results that carry an error.
      if (result.committed.length > 0) {
        trackUsage({ name: "tag_rename" });
        const committed = new Map(result.committed.map((asset) => [asset.id, asset]));
        setAssets((rows) => rows.map((row) => committed.get(row.id) ?? row));
      }
      if (result.savedSearches.length > 0) {
        const returned = new Map(result.savedSearches.map((search) => [search.id, search]));
        const updated = { ...stateRef.current, savedSearches: (stateRef.current.savedSearches ?? []).map((search) => returned.get(search.id) ?? search) };
        stateRef.current = updated;
        setState(updated);
      }
      let queryUpdated = false;
      const { before, after, changed } = pending.migration.activeQuery;
      // Compare-and-set: a query the user edited while the rename ran is theirs and is never overwritten.
      if (result.outcome === "complete" && result.queryMigrated && changed && activeQuery.read() === before) {
        activeQuery.write(after);
        queryUpdated = true;
      }
      if (result.error) setError(result.error);
      return { status: "applied", result, queryUpdated };
    } catch (failure) {
      if (!live()) return { status: "stale" };
      setError(toAppError(failure));
      return { status: "failed" };
    } finally {
      if (activeRename.current === request) activeRename.current = null;
      operation.current = false;
      if (mounted.current) setRenameApplying(false);
    }
  }, [client, trackUsage]);
  const dismissError = useCallback(() => setError(null), []);

  return {
    state, theme: state.theme ?? "workshop", library: state.libraries.find((library) => library.id === state.activeLibraryId) ?? null,
    assets, issues, loading, scanning, scanStopped, progress, error, cancelScan,
    chooseLibrary, activateLibrary, removeLibrary, rescan, editTags, editingAssetId, editNotes, editingNotesAssetId,
    bulkEditTags, bulkEditing, savedSearches: (state.savedSearches ?? []).filter((search) => search.libraryId === state.activeLibraryId),
    savingSearch, saveSearch, deleteSearch, savingTheme, setTheme, savingUsage, setUsageConsent, trackUsage, performAction, actionBusy,
    validateMetadata, validation, exportMetadata, exportResult, getReconnectTargets, reconnectAsset, removeMissingEntry, recoveryBusy,
    deleteAssets, deleting, previewAsset,
    previewTagRename, cancelTagRenamePreview, applyTagRename, renamePreviewing, renameApplying, renameProgress,
    dismissError, isDesktop: client.isDesktop,
  };
}
