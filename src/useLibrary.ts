import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryClient } from "./native";
import { nativeClient, toAppError } from "./native";
import type { AppError, Asset, AssetAction, ExportResult, LibraryState, ScanIssue, SearchFilters, ValidationReport } from "./types";

const emptyState: LibraryState = { libraries: [], activeLibraryId: null };

export function useLibrary(client: LibraryClient = nativeClient) {
  const [state, setState] = useState<LibraryState>(emptyState);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [issues, setIssues] = useState<ScanIssue[]>([]);
  const [loading, setLoading] = useState(client.isDesktop);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const scanBusy = useRef(false);
  const activeScan = useRef<{ libraryId: string; scanId: string; cancelled: boolean } | null>(null);
  const mounted = useRef(false);
  const stateRef = useRef(emptyState);
  const scanGeneration = useRef(0);
  const operation = useRef(false);

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
    scanBusy.current = true;
    setError(null);
    setValidation(null);
    try {
      const result = await client.scan(libraryId, scanId, (update) => {
        if (current() && update.libraryId === libraryId && update.scanId === scanId) setProgress(update.visited);
      });
      if (!current() || request.cancelled || result === null) return;
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
    } catch (failure) {
      if (current()) setError(toAppError(failure));
    } finally {
      if (current()) {
        activeScan.current = null;
        setScanning(false);
        scanBusy.current = false;
      }
    }
  }, [client]);

  const cancelScan = useCallback(async () => {
    const scan = activeScan.current;
    if (!client.isDesktop || !scan || scan.cancelled) return false;
    scan.cancelled = true;
    ++scanGeneration.current;
    setAssets([]);
    setIssues([]);
    setScanning(false);
    scanBusy.current = false;
    activeScan.current = null;
    try {
      return await client.cancelScan(scan.libraryId, scan.scanId);
    } catch (failure) {
      if (mounted.current) setError(toAppError(failure));
      return false;
    }
  }, [client]);

  const applyState = useCallback((next: LibraryState) => {
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
    scanBusy.current = false;
    if (next.activeLibraryId) void scan(next.activeLibraryId);
  }, [scan]);

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
    return () => { cancelled = true; mounted.current = false; ++scanGeneration.current; };
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

  const chooseLibrary = useCallback(() => mutateRegistration(client.choose), [client, mutateRegistration]);
  const activateLibrary = useCallback((id: string) => mutateRegistration(() => client.activate(id)), [client, mutateRegistration]);
  const removeLibrary = useCallback((id: string) => mutateRegistration(() => client.remove(id)), [client, mutateRegistration]);
  const rescan = useCallback(async () => {
    const id = stateRef.current.activeLibraryId;
    if (client.isDesktop && id && !operation.current) await scan(id);
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
      return true;
    } catch (failure) {
      if (current()) setError(toAppError(failure));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setEditingAssetId(null);
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
  }, [client]);

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
  const saveSearch = useCallback((name: string, filters: SearchFilters, searchId?: string) => mutateSearch((libraryId) => client.saveSearch(libraryId, name, filters, searchId ?? null)), [client, mutateSearch]);
  const deleteSearch = useCallback((searchId: string) => mutateSearch((libraryId) => client.deleteSearch(libraryId, searchId)), [client, mutateSearch]);
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
    return runNativeOperation((libraryId) => client.performAction(libraryId, asset.id, action), () => true);
  }, [client, runNativeOperation]);
  const validateMetadata = useCallback(() => runNativeOperation((libraryId) => client.validateMetadata(libraryId), (report, libraryId) => {
    if (report.libraryId !== libraryId) throw new Error("Validation response did not match active library.");
    setValidation(report);
    return true;
  }), [client, runNativeOperation]);
  const exportMetadata = useCallback(async () => {
    setExportResult(null);
    return runNativeOperation((libraryId) => client.exportMetadata(libraryId), (result) => {
      setExportResult(result);
      return result !== null;
    });
  }, [client, runNativeOperation]);
  const getReconnectTargets = useCallback(async (asset: Asset): Promise<Asset[] | null> => {
    if (asset.status !== "missing" || asset.metadataState !== "valid" || !asset.metadataRevision || !asset.metadataId) return null;
    let choices: Asset[] | null = null;
    await runNativeOperation((libraryId) => client.getReconnectTargets(libraryId, asset.id, asset.metadataRevision!), (rows) => { choices = rows; return true; }, true);
    return choices;
  }, [client, runNativeOperation]);
  const reconnectAsset = useCallback(async (source: Asset, target: Asset) => {
    if (source.status !== "missing" || source.metadataState !== "valid" || !source.metadataRevision || !source.metadataId || target.status === "missing" || target.kind !== "file" || target.metadataId || target.metadataState === "blocked") return false;
    return runNativeOperation((libraryId) => client.reconnectAsset(libraryId, source.id, source.metadataRevision!, target.id), (result, libraryId) => {
      if (result.libraryId !== libraryId) throw new Error("Repair response did not match active library.");
      ++scanGeneration.current;
      setAssets(result.assets);
      setIssues(result.issues);
      setValidation(null);
      const next = { ...stateRef.current, libraries: stateRef.current.libraries.map((library) => library.id === libraryId ? { ...library, assetCount: result.assets.length, lastScanAt: result.scannedAt } : library) };
      stateRef.current = next;
      setState(next);
      return true;
    }, true);
  }, [client, runNativeOperation]);
  const dismissError = useCallback(() => setError(null), []);

  return {
    state, library: state.libraries.find((library) => library.id === state.activeLibraryId) ?? null,
    assets, issues, loading, scanning, progress, error, cancelScan,
    chooseLibrary, activateLibrary, removeLibrary, rescan, editTags, editingAssetId,
    bulkEditTags, bulkEditing, savedSearches: (state.savedSearches ?? []).filter((search) => search.libraryId === state.activeLibraryId),
    savingSearch, saveSearch, deleteSearch, performAction, actionBusy,
    validateMetadata, validation, exportMetadata, exportResult, getReconnectTargets, reconnectAsset, recoveryBusy,
    dismissError, isDesktop: client.isDesktop,
  };
}
