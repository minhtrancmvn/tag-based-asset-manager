import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  Columns3, FileArchive, FileBox, FileImage, FileText, Folder,
  FolderOpen, LayoutList, PanelRightClose, PanelRightOpen,
  Plus, RotateCw, Search, SlidersHorizontal, Tag, X, Copy, ExternalLink, FolderSearch, Download, ShieldCheck, Wrench,
} from "lucide-react";
import { formatDate, formatSize, matchesAsset, parseQuery, sortAssets, tagGroup } from "./catalog";
import { useLibrary } from "./useLibrary";
import type { Asset, KindFilter, SavedSearch, SearchFilters, SortDirection, SortKey, TagGroup, TagMatchMode, ViewKey } from "./types";
import { TagEditor } from "./components/TagEditor";
import { folderBreadcrumbs, folderIndex, parentFolder } from "./folderBrowse";
import { RecoveryDialog } from "./components/RecoveryDialog";
import { BulkTagDialog } from "./components/BulkTagDialog";
import { SavedSearchDialog } from "./components/SavedSearchDialog";
import "./App.css";

const groups: TagGroup[] = ["Category", "Style", "Theme", "Status", "Other"];
// Match fixed catalog row/header heights in App.css.
const rowHeight = 40;
const headerHeight = 32;
const overscanRows = 8;
const defaultWidths: Record<string, number> = {
  name: 255, tags: 365, type: 88, path: 268, modified: 130, size: 100, status: 122,
};

function AssetIcon({ asset, size = 17 }: { asset: Asset; size?: number }) {
  const props = { size, strokeWidth: 1.7, "aria-hidden": true as const };
  if (asset.kind === "folder") return <Folder {...props} className="icon-folder" />;
  if (["png", "jpg", "jpeg", "svg", "webp"].includes(asset.extension ?? "")) return <FileImage {...props} className="icon-image" />;
  if (["3mf", "stl", "step"].includes(asset.extension ?? "")) return <FileBox {...props} className="icon-model" />;
  if (asset.extension === "zip") return <FileArchive {...props} className="icon-archive" />;
  return <FileText {...props} className="icon-document" />;
}

function Status({ asset }: { asset: Asset }) {
  if (asset.metadataState === "blocked") return <span className="status status-missing"><CircleAlert size={13} /> Metadata issue</span>;
  if (asset.status === "missing") return <span className="status status-missing"><CircleAlert size={13} /> Missing</span>;
  if (asset.status === "warning") return <span className="status status-missing"><CircleAlert size={13} /> Review</span>;
  if (!asset.tags.length) return <span className="status status-muted">Untagged</span>;
  return <span className="status status-ready"><span className="status-dot" /> Ready</span>;
}

function App() {
  const {
    state, library, assets, issues, loading, scanning, progress, error,
    chooseLibrary, activateLibrary, removeLibrary, rescan, dismissError, isDesktop, editTags, editingAssetId,
    bulkEditTags, bulkEditing, savedSearches, savingSearch, saveSearch, deleteSearch,
    performAction, actionBusy, validateMetadata, validation, exportMetadata, exportResult,
    getReconnectTargets, reconnectAsset, recoveryBusy,
  } = useLibrary();
  const [view, setView] = useState<ViewKey>("all");
  const [query, setQuery] = useState("");
  const [matchMode, setMatchMode] = useState<TagMatchMode>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [bulkTargets, setBulkTargets] = useState<Asset[] | null>(null);
  const [savedSearchDialogOpen, setSavedSearchDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState({ path: true, modified: true, size: true, status: true });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState(defaultWidths);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pendingRowFocus = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [currentFolder, setCurrentFolder] = useState("");
  const [tableHeight, setTableHeight] = useState(520);
  const [contextTarget, setContextTarget] = useState<{ asset: Asset; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [recovery, setRecovery] = useState<{ source: Asset; targets: Asset[]; libraryId: string } | null>(null);
  const latestAssets = useRef(assets);
  const latestLibraryId = useRef(state.activeLibraryId);
  const reconnectRequest = useRef(0);
  latestAssets.current = assets;
  latestLibraryId.current = state.activeLibraryId;
  const busy = Boolean(loading || scanning || editingAssetId !== null || bulkEditing || savingSearch || actionBusy || recoveryBusy);

  useEffect(() => {
    setView("all");
    setQuery("");
    setMatchMode("all");
    setKindFilter("all");
    setCurrentFolder("");
    setSelectedIds([]);
    setAnchorId(null);
    setBulkTargets(null);
    setSavedSearchDialogOpen(false);
    setContextTarget(null);
    setRecovery(null);
    ++reconnectRequest.current;
  }, [library?.id]);

  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => assetsById.has(id)));
    setAnchorId((current) => current && assetsById.has(current) ? current : null);
  }, [assetsById]);

  useEffect(() => {
    if (!bulkTargets) return;
    if (scanning || bulkTargets.some((target) => assetsById.get(target.id)?.metadataRevision !== target.metadataRevision)) setBulkTargets(null);
  }, [assetsById, scanning, bulkTargets]);

  useEffect(() => {
    if (!contextTarget) return;
    const close = () => setContextTarget(null);
    const outside = (event: globalThis.MouseEvent) => { if (event.target instanceof Node && !contextMenuRef.current?.contains(event.target)) close(); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { capture: true, passive: true });
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    contextMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => { window.removeEventListener("resize", close); window.removeEventListener("wheel", close, true); document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [contextTarget]);

  useEffect(() => {
    if (!recovery) return;
    const freshSource = assets.find((asset) => asset.id === recovery.source.id && asset.metadataId === recovery.source.metadataId && asset.metadataRevision === recovery.source.metadataRevision && asset.status === "missing");
    if (scanning || library?.id !== recovery.libraryId || !freshSource) setRecovery(null);
  }, [assets, scanning, library?.id, recovery]);

  const folderTree = useMemo(() => folderIndex(assets), [assets]);
  const directChildren = useMemo(() => folderTree.get(currentFolder) ?? [], [folderTree, currentFolder]);
  const foldersByPath = useMemo(() => new Map(assets.filter((asset) => asset.kind === "folder" && asset.status !== "missing").map((asset) => [asset.relativePath, asset])), [assets]);
  const visibleIssues = useMemo(() => issues.filter((issue) => parentFolder(issue.path.replace(/^\.\//, "")) === currentFolder), [issues, currentFolder]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of directChildren) for (const tag of asset.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [directChildren]);
  const { untaggedCount, metadataIssueCount, blockedPaths, attentionRows } = useMemo(() => {
    let untaggedCount = 0;
    let metadataIssueCount = 0;
    let attentionRows = 0;
    const blockedPaths = new Set<string>();
    for (const asset of directChildren) {
      if (asset.tags.length === 0 && asset.metadataState !== "blocked") ++untaggedCount;
      if (asset.metadataState === "blocked") { ++metadataIssueCount; blockedPaths.add(asset.relativePath); }
      if (asset.status === "missing" || asset.status === "warning" || asset.metadataState === "blocked") ++attentionRows;
    }
    return { untaggedCount, metadataIssueCount, blockedPaths, attentionRows };
  }, [directChildren]);
  const distinctIssueCount = metadataIssueCount + visibleIssues.filter((issue) => !blockedPaths.has(issue.path)).length;
  const availableTags = tagCounts.map(([tag]) => tag);
  const filtered = useMemo(() => {
    const parsed = parseQuery(query);
    return sortAssets(directChildren.filter((asset) => matchesAsset(asset, parsed, view, matchMode, kindFilter)), sortKey, sortDirection);
  }, [directChildren, query, view, matchMode, kindFilter, sortKey, sortDirection]);
  const breadcrumbs = useMemo(() => folderBreadcrumbs(currentFolder), [currentFolder]);
  const selected = assetsById.get(selectedIds[selectedIds.length - 1]) ?? null;
  const selectedAssets = useMemo(() => selectedIds.map((id) => assetsById.get(id)).filter((asset): asset is Asset => asset !== undefined), [selectedIds, assetsById]);
  const windowSize = Math.ceil(tableHeight / rowHeight) + overscanRows * 2;
  const windowStart = Math.min(Math.max(0, filtered.length - windowSize), Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows));
  const windowEnd = Math.min(filtered.length, windowStart + windowSize);
  const mountedAssets = filtered.slice(windowStart, windowEnd);
  const columnCount = 4 + Object.values(visibleColumns).filter(Boolean).length;

  useLayoutEffect(() => {
    const scroll = tableScrollRef.current;
    if (scroll) scroll.scrollTop = 0;
    setScrollTop(0);
    pendingRowFocus.current = null;
  }, [library?.id, currentFolder, query, view, matchMode, kindFilter, sortKey, sortDirection]);

  useEffect(() => {
    if (!scanning && !loading && !error && currentFolder && !foldersByPath.has(currentFolder)) {
      let parent = parentFolder(currentFolder);
      while (parent && !foldersByPath.has(parent)) parent = parentFolder(parent);
      setCurrentFolder(parent);
      setSelectedIds([]);
      setAnchorId(null);
    }
  }, [currentFolder, foldersByPath, assets.length, scanning, loading, error]);

  useLayoutEffect(() => {
    const scroll = tableScrollRef.current;
    if (!scroll) return;
    const measure = () => { if (scroll.clientHeight) setTableHeight(scroll.clientHeight); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const id = pendingRowFocus.current;
    if (!id) return;
    const row = [...(tableScrollRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-asset-id]") ?? [])].find((item) => item.dataset.assetId === id);
    if (row) { row.focus({ preventScroll: true }); pendingRowFocus.current = null; }
  });
  const librarySavedSearches = (savedSearches ?? []).filter((search) => search.libraryId === library?.id);
  const currentFilters: SearchFilters = { query, view, matchMode, kind: kindFilter };
  const attentionCount = attentionRows + distinctIssueCount - metadataIssueCount;

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>, asset: Asset, index: number) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedIds([asset.id]);
      setAnchorId(asset.id);
      return;
    }
    const nextIndex = event.key === "ArrowDown" ? Math.min(index + 1, filtered.length - 1)
      : event.key === "ArrowUp" ? Math.max(index - 1, 0)
        : event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const scroll = tableScrollRef.current;
    if (!scroll) return;
    const top = nextIndex * rowHeight;
    const bottom = top + rowHeight;
    const viewport = scroll.clientHeight || tableHeight;
    const nextScrollTop = top < scroll.scrollTop ? top : bottom > scroll.scrollTop + viewport - headerHeight ? bottom - viewport + headerHeight : scroll.scrollTop;
    scroll.scrollTop = Math.max(0, nextScrollTop);
    pendingRowFocus.current = filtered[nextIndex].id;
    setScrollTop(scroll.scrollTop);
    const row = [...scroll.querySelectorAll<HTMLTableRowElement>("tr[data-asset-id]")].find((item) => item.dataset.assetId === filtered[nextIndex].id);
    if (row) { row.focus({ preventScroll: true }); pendingRowFocus.current = null; }
  }

  function chooseView(nextView: ViewKey) {
    setView(nextView);
    setQuery("");
    setMatchMode("all");
    setKindFilter("all");
    setSelectedIds([]);
    setAnchorId(null);
  }

  function navigateFolder(path: string) {
    if (busy || path === currentFolder || (path && !foldersByPath.has(path))) return;
    setCurrentFolder(path);
    setSelectedIds([]);
    setAnchorId(null);
    setBulkTargets(null);
    setContextTarget(null);
    setRecovery(null);
    ++reconnectRequest.current;
  }

  function navigateUp() {
    if (currentFolder) navigateFolder(parentFolder(currentFolder));
  }

  function selectRow(event: MouseEvent<HTMLTableRowElement>, id: string) {
    if (event.shiftKey && anchorId) {
      const start = filtered.findIndex((asset) => asset.id === anchorId);
      const end = filtered.findIndex((asset) => asset.id === id);
      if (start >= 0 && end >= 0) {
        setSelectedIds(filtered.slice(Math.min(start, end), Math.max(start, end) + 1).map((asset) => asset.id));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    else setSelectedIds([id]);
    setAnchorId(id);
  }

  function changeSort(key: SortKey) {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("asc"); }
  }

  function loadSavedSearch(search: SavedSearch) {
    if (search.libraryId !== library?.id) return;
    setQuery(search.filters.query);
    setView(search.filters.view);
    setMatchMode(search.filters.matchMode);
    setKindFilter(search.filters.kind);
    setSelectedIds([]);
    setAnchorId(null);
  }

  function addFilter(tag: string) {
    if (!parseQuery(query).requiredTags.includes(tag)) setQuery((current) => `${current.trim()} ${tag}`.trim());
    setView("all");
  }

  function beginResize(event: MouseEvent<HTMLSpanElement>, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const originalWidth = columnWidths[key];
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      setColumnWidths((current) => ({ ...current, [key]: Math.max(82, originalWidth + moveEvent.clientX - startX) }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function handleRemoveLibrary() {
    if (!library || !window.confirm(`Remove “${library.name}” from this app? Files and folders will not be changed.`)) return;
    await removeLibrary(library.id);
  }

  async function runAction(asset: Asset, action: "open" | "reveal" | "copyFullPath" | "copyRelativePath"): Promise<void> {
    setContextTarget(null);
    await performAction(asset, action);
  }

  async function beginReconnect(asset: Asset): Promise<void> {
    setContextTarget(null);
    if (busy || !library || asset.status !== "missing" || asset.metadataState !== "valid" || !asset.metadataId || !asset.metadataRevision) return;
    const libraryId = library.id;
    const request = ++reconnectRequest.current;
    const targets = await getReconnectTargets(asset);
    const current = latestAssets.current.find((row) => row.id === asset.id && row.metadataId === asset.metadataId && row.metadataRevision === asset.metadataRevision && row.status === "missing");
    if (!targets || request !== reconnectRequest.current || latestLibraryId.current !== libraryId || !current) return;
    setRecovery({ source: current, targets, libraryId });
  }

  async function confirmReconnect(source: Asset, target: Asset): Promise<boolean> {
    if (!recovery || recovery.libraryId !== library?.id || recovery.source.id !== source.id || !recovery.targets.some((item) => item.id === target.id && item.metadataRevision === target.metadataRevision)) return false;
    const success = await reconnectAsset(source, target);
    if (success) setRecovery(null);
    return success;
  }

  async function copyRelativePath(asset: Asset): Promise<void> {
    await performAction(asset, "copyRelativePath");
  }

  function openContextMenu(event: MouseEvent<HTMLTableRowElement>, asset: Asset): void {
    event.preventDefault();
    if (busy) return;
    if (!selectedIds.includes(asset.id) || selectedIds.length < 2) {
      setSelectedIds([asset.id]);
      setAnchorId(asset.id);
    }
    setContextTarget({ asset, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 212)) });
  }

  function handleContextMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") { setContextTarget(null); return; }
    if (event.key === "Tab") { setContextTarget(null); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }

  const column = (key: SortKey, label: string, width: number) => (
    <th key={key} scope="col" aria-label={label} aria-sort={sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} style={{ width, minWidth: width }}>
      <button className="sort-button" onClick={() => changeSort(key)} type="button">
        {label} {sortKey === key && (sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
      <span role="separator" aria-label={`Resize ${label} column`} className="column-resize" onMouseDown={(event) => beginResize(event, key)} />
    </th>
  );

  const noLibrary = !library;
  const hasLibraryChildren = directChildren.length > 0;
  const isEmptyLibrary = Boolean(library) && !hasLibraryChildren && !scanning && !error;
  const emptyHeadline = loading ? "Loading libraries…" : scanning ? "Scanning library…" : error ? "Scan could not complete" : noLibrary ? (isDesktop ? "Choose a library to begin" : "Desktop app required") : "No assets found";

  return (
    <div className="app-shell" onKeyDown={(event) => {
      if (event.key === "Escape") {
        if (contextTarget) { setContextTarget(null); return; }
        if (!bulkEditing && !savingSearch) { if (bulkTargets) setBulkTargets(null); if (savedSearchDialogOpen) setSavedSearchDialogOpen(false); }
      }
    }}>
      <aside className={`sidebar ${sidebarOpen ? "" : "sidebar-collapsed"}`} aria-label="Library navigation">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span className="mark-line mark-one" /><span className="mark-line mark-two" /><span className="mark-line mark-three" /></div>
          {sidebarOpen && <div className="brand-copy"><strong>TAG-BASED</strong><span>ASSET MANAGER</span></div>}
          <button className="icon-button sidebar-toggle" title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setSidebarOpen(!sidebarOpen)} type="button">
            {sidebarOpen ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
          </button>
        </div>
        {sidebarOpen ? <>
          <div className="sidebar-scroll">
            <div className="library-heading">LIBRARY <span className="demo-pill">LOCAL</span></div>
            <label className="library-picker-label" htmlFor="library-picker">Active library</label>
            <div className="library-picker" title={library?.rootPath ?? "No library selected"}>
              <div className="library-avatar"><FolderOpen size={18} strokeWidth={1.7} /></div>
              <select id="library-picker" aria-label="Active library" value={state.activeLibraryId ?? ""} disabled={!state.libraries.length || busy} onChange={(event) => { if (event.target.value) void activateLibrary(event.target.value); }}>
                {!state.activeLibraryId && <option value="">{state.libraries.length ? "Choose a library" : "No libraries"}</option>}
                {state.libraries.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </div>
            {library && <div className="library-root" title={library.rootPath}>{library.rootPath}</div>}
            <div className="nav-section-label">BROWSE</div>
            {library && <div className="folder-navigation"><button type="button" className="folder-up" onClick={navigateUp} disabled={!currentFolder || busy} aria-label="Go up one folder">↑ Up</button><nav className="folder-breadcrumbs" aria-label="Folder path"><button type="button" onClick={() => navigateFolder("")} aria-current={!currentFolder ? "location" : undefined}>Library</button>{breadcrumbs.map((crumb) => <span key={crumb.path} className="breadcrumb-segment"><span aria-hidden="true">/</span><button type="button" onClick={() => navigateFolder(crumb.path)} aria-current={crumb.path === currentFolder ? "location" : undefined}>{crumb.name}</button></span>)}</nav></div>}
            <nav className="nav-list" aria-label="Catalog views">
              <button type="button" className={`nav-item ${view === "all" ? "active" : ""}`} onClick={() => chooseView("all")} disabled={noLibrary}><LayoutList size={17} /> <span>All assets</span><em>{directChildren.length}</em></button>
              <button type="button" className={`nav-item ${view === "untagged" ? "active" : ""}`} onClick={() => chooseView("untagged")} disabled={noLibrary}><Tag size={17} /> <span>Untagged</span><em>{untaggedCount}</em></button>
              <button type="button" className={`nav-item ${view === "attention" ? "active" : ""}`} onClick={() => chooseView("attention")} disabled={noLibrary}><CircleAlert size={17} /> <span>Needs attention</span><em className="attention-count">{attentionCount}</em></button>
            </nav>
            <div className="nav-section-label section-between">SAVED SEARCHES <button type="button" className="tiny-icon" title="Save current filters" aria-label="Manage saved searches" disabled={!library || busy} onClick={() => setSavedSearchDialogOpen(true)}><Plus size={14} /></button></div>
            <button type="button" className="nav-hint saved-search-manage" disabled={!library || busy} onClick={() => setSavedSearchDialogOpen(true)}>Save current filters</button>
            {librarySavedSearches.length ? <nav className="saved-search-list" aria-label="Saved searches">{librarySavedSearches.map((search) => <button key={search.id} className="saved-search-item" type="button" onClick={() => loadSavedSearch(search)} disabled={busy} title={`Load ${search.name}`}><Search size={13} /><span>{search.name}</span></button>)}</nav> : <p className="nav-hint">No saved searches for this library.</p>}
            <div className="nav-section-label section-between">TAGS <span className="section-note">{tagCounts.length} TOTAL</span></div>
            <p className="nav-hint">Select a tag to filter assets.</p>
            {groups.map((group) => {
              const tags = tagCounts.filter(([tag]) => tagGroup(tag) === group);
              return tags.length > 0 && <div className="tag-group" key={group}>
                <div className="group-label"><span className={`group-swatch swatch-${group.toLowerCase()}`} />{group}</div>
                {tags.map(([tag, count]) => <button className="tag-nav" key={tag} type="button" disabled={busy} onClick={() => addFilter(tag)} title={`Filter by ${tag}`}><span>{tag.includes(":") ? tag.split(":").slice(1).join(":") : tag}</span><em>{count}</em></button>)}
              </div>;
            })}
          </div>
          <div className="sidebar-bottom">
            <div className="offline-note"><span className="offline-dot" /> LOCAL-FIRST <span>·</span> SIDECAR TAGS</div>
            <button className="sidebar-action" type="button" disabled={!library || busy || !isDesktop} onClick={() => void validateMetadata()} title={!isDesktop ? "Open in desktop app to validate metadata" : undefined}><ShieldCheck size={15} /> Validate metadata</button>
            {validation && validation.libraryId === library?.id && <section className={`validation-panel ${validation.issues.length ? "validation-issues" : "validation-clean"}`} aria-label="Metadata validation results"><div className="validation-heading"><strong>{validation.issues.length ? `${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}` : "Metadata validation passed"}</strong><span>{validation.assetsChecked} checked · {formatDate(validation.validatedAt)}</span></div>{validation.issues.length ? <details><summary>Review validation issues</summary><ul>{validation.issues.map((item, index) => <li key={`${item.path}-${index}`}><strong>{item.message}</strong><code title={item.path}>{item.path}</code>{item.details && <details><summary>Technical details</summary><pre>{item.details}</pre></details>}</li>)}</ul></details> : <p>No metadata integrity problems found.</p>}</section>}
            {library && <button className="sidebar-action remove-library" type="button" disabled={busy} onClick={() => void handleRemoveLibrary()}>Remove library registration</button>}
          </div>
        </> : <div className="collapsed-icons" aria-hidden="true"><LayoutList size={18} /><Tag size={18} /><CircleAlert size={18} /></div>}
      </aside>

      <main className="workspace">
        <header className="topbar">
          {!sidebarOpen && <span className="collapsed-library-context" title={library?.rootPath}>{library?.name ?? "No library selected"}</span>}
          <div className="topbar-right"><span className="topbar-info"><span className="offline-dot" /> Asset files remain untouched</span><button type="button" className="avatar-button" title="Local app; no account needed" aria-label="Local app; no account needed">TA</button></div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><h1>{noLibrary ? "Your library" : view === "all" ? "All assets" : view === "untagged" ? "Untagged" : "Needs attention"}</h1><p className="subheading">{currentFolder ? `Current folder: ${currentFolder}` : "Browse one folder level at a time. Double-click a folder to enter."}</p></div>
            <button type="button" className="primary-button" disabled={!isDesktop || busy} onClick={() => void chooseLibrary()} title={isDesktop ? "Choose a library folder" : "Open the desktop app to select a library"}><Plus size={17} /> Choose library folder</button>
          </div>

          {!isDesktop && <div className="preview-banner"><CircleAlert size={17} /><div><strong>Desktop app required</strong><span>Library selection and scanning need the Tauri desktop app. No demo data is loaded in browser preview.</span></div></div>}
          {noLibrary && isDesktop && !loading && <div className="preview-banner"><FolderOpen size={17} /><div><strong>Choose a library folder</strong><span>Select a folder to register it locally and scan its files. Scanning will not modify files or folders.</span></div></div>}
          {library && <div className={`preview-banner ${distinctIssueCount ? "attention-banner" : ""}`}><CircleAlert size={17} /><div><strong>{distinctIssueCount ? `${distinctIssueCount} issue${distinctIssueCount === 1 ? "" : "s"} need attention` : "Sidecar tags enabled"}</strong><span>Tags and notes are stored in per-directory sidecar manifests. Editing changes metadata only; asset files and paths stay untouched. Validate sidecars, export a backup, and reconnect missing metadata explicitly.</span></div></div>}

          {library && <div className="summary-strip" aria-label="Library summary">
            <div><small>ASSETS</small><strong>{directChildren.length} <span>items in this folder</span></strong></div>
            <div><small>LAST SCAN</small><strong>{library.lastScanAt ? formatDate(library.lastScanAt) : "Not yet scanned"}</strong></div>
          </div>}

          {error && <section className="error-panel" role="alert"><div><CircleAlert size={17} /><strong>{error.message}</strong></div>{error.path && <p className="error-path">{error.path}</p>}{error.details && <details><summary>Technical details</summary><pre>{error.details}</pre></details>}<button type="button" onClick={dismissError} aria-label="Dismiss error"><X size={15} /></button></section>}
          {visibleIssues.length > 0 && library && <details className="issues-panel" key={currentFolder} open={view === "attention"}><summary><CircleAlert size={16} /> Scan issues in this folder <span>{visibleIssues.length} issue{visibleIssues.length === 1 ? "" : "s"}</span></summary><ul>{visibleIssues.map((issue, index) => <li key={`${issue.path}-${index}`}><strong>{issue.message}</strong><code>{issue.path}</code>{issue.details && <details><summary>Details</summary><pre>{issue.details}</pre></details>}</li>)}</ul></details>}
          {isEmptyLibrary && <div className="empty-library-note"><FolderOpen size={16} /><span>This folder is empty. No files or folders at this level.</span></div>}

          <section className="catalog-panel" aria-label="Assets catalog">
            <div className="catalog-toolbar">
              <div className="toolbar-title"><div className="toolbar-icon"><LayoutList size={17} /></div><strong>Catalog</strong><span className="count-badge">{filtered.length}</span></div>
              <div className="toolbar-actions">{library && <button className="quiet-button" type="button" disabled={busy} onClick={() => void exportMetadata()} title="Export selected library metadata as JSON backup"><Download size={15} /> Export JSON</button>}{library && <button className="quiet-button" type="button" disabled={busy} onClick={() => void rescan()} title="Rescan this approved library"><RotateCw size={15} /> Rescan</button>}<div className="column-menu-wrap"><button className="quiet-button" type="button" onClick={() => setColumnMenuOpen(!columnMenuOpen)} aria-expanded={columnMenuOpen} aria-label="Choose visible columns"><Columns3 size={16} /> Columns</button>{columnMenuOpen && <div className="column-menu"><strong>Visible columns</strong><p>Name and Tags stay visible.</p>{(["path", "modified", "size", "status"] as const).map((key) => <label key={key}><input type="checkbox" checked={visibleColumns[key]} onChange={() => setVisibleColumns((current) => ({ ...current, [key]: !current[key] }))} /> {key[0].toUpperCase() + key.slice(1)}</label>)}</div>}</div></div>
            </div>
            <div className="filter-bar"><label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets and tags</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={'Tags or "filename / path"... try category:animal -status:printed'} disabled={!library} />{query && <button className="clear-search" type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}</label><label className="filter-selector">Match<select aria-label="Required tag match" value={matchMode} onChange={(event) => setMatchMode(event.target.value as TagMatchMode)} disabled={!library}><option value="all">All tags</option><option value="any">Any tag</option></select></label><label className="filter-selector">Kind<select aria-label="Asset kind" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)} disabled={!library}><option value="all">Files &amp; folders</option><option value="file">Files</option><option value="folder">Folders</option></select></label><button className="quiet-button save-current-button" type="button" disabled={!library || busy} onClick={() => setSavedSearchDialogOpen(true)}>Save search</button><div className="filter-help"><SlidersHorizontal size={15} /><span>Required tags: {matchMode === "all" ? "all" : "any"}</span></div></div>
            {(query || matchMode !== "all" || kindFilter !== "all") && <div className="active-query"><span>ACTIVE FILTER</span><code>{query || "No tag query"}{matchMode === "any" ? " · any required tag" : " · all required tags"} · {kindFilter === "all" ? "files and folders" : `${kindFilter}s`}</code><button type="button" onClick={() => { setQuery(""); setMatchMode("all"); setKindFilter("all"); }} aria-label="Clear active filter"><X size={13} /></button></div>}
            {library && selectedIds.length >= 2 && <div className="bulk-action-bar"><span><strong>{selectedIds.length}</strong> selected</span><button className="quiet-button" type="button" disabled={busy || selectedAssets.length !== selectedIds.length} onClick={() => setBulkTargets([...selectedAssets])}><Tag size={15} /> Edit tags in bulk</button></div>}
            {contextTarget && createPortal(<div ref={contextMenuRef} className="asset-context-menu" role="menu" aria-label={`Actions for ${contextTarget.asset.name}`} style={{ left: contextTarget.x, top: contextTarget.y }} onKeyDown={handleContextMenuKeyDown} onMouseDown={(event) => event.stopPropagation()}><div className="context-menu-title" title={contextTarget.asset.relativePath}>{contextTarget.asset.name}</div>{contextTarget.asset.status === "missing" ? <><button role="menuitem" type="button" disabled title="Missing asset cannot be opened"><ExternalLink size={14} /> Open</button><button role="menuitem" type="button" disabled title="Missing asset cannot be revealed"><FolderSearch size={14} /> Reveal</button><button role="menuitem" type="button" disabled title="Full path unavailable for missing asset"><Copy size={14} /> Copy full path</button><button role="menuitem" type="button" disabled title="File actions unavailable for missing asset"><Copy size={14} /> Copy relative path</button><button role="menuitem" type="button" onClick={() => void beginReconnect(contextTarget.asset)} disabled={busy || contextTarget.asset.metadataState !== "valid" || !contextTarget.asset.metadataId || !contextTarget.asset.metadataRevision}><Wrench size={14} /> Reconnect metadata</button><p>Missing asset cannot be opened, revealed, or copied by its full path.</p></> : <><button role="menuitem" type="button" disabled={busy || !isDesktop} onClick={() => void runAction(contextTarget.asset, "open")}><ExternalLink size={14} /> Open</button><button role="menuitem" type="button" disabled={busy || !isDesktop} onClick={() => void runAction(contextTarget.asset, "reveal")}><FolderSearch size={14} /> Reveal in {navigator.platform.toLowerCase().includes("mac") ? "Finder" : "File Explorer"}</button><button role="menuitem" type="button" disabled={busy || !isDesktop} onClick={() => void runAction(contextTarget.asset, "copyFullPath")}><Copy size={14} /> Copy full path</button><button role="menuitem" type="button" disabled={busy} onClick={() => { void copyRelativePath(contextTarget.asset); setContextTarget(null); }}><Copy size={14} /> Copy relative path</button></>}</div>, document.body)}
            {exportResult && <div className="operation-notice" role="status"><strong>JSON backup exported</strong><code title={exportResult.path}>{exportResult.path}</code><span>{exportResult.assetCount} metadata item{exportResult.assetCount === 1 ? "" : "s"} included.</span></div>}
            {scanning && <div className="scan-progress" role="status"><span className="progress-spinner" /><span>Scanning library…</span><strong>{progress.toLocaleString()} entries visited</strong></div>}
            <div className="table-scroll" ref={tableScrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><table className="asset-table" aria-rowcount={filtered.length + 1}><thead><tr><th className="selection-header" scope="col"><span className="sr-only">Selection</span></th>{column("name", "NAME", columnWidths.name)}{column("tags", "TAGS", columnWidths.tags)}{column("type", "TYPE", columnWidths.type)}{visibleColumns.path && column("path", "PATH", columnWidths.path)}{visibleColumns.modified && column("modified", "MODIFIED", columnWidths.modified)}{visibleColumns.size && column("size", "SIZE", columnWidths.size)}{visibleColumns.status && column("status", "STATUS", columnWidths.status)}</tr></thead>
                <tbody>{windowStart > 0 && <tr aria-hidden="true" className="virtual-spacer"><td colSpan={columnCount} style={{ height: windowStart * rowHeight }} /></tr>}{mountedAssets.map((asset, index) => <tr key={asset.id} data-asset-id={asset.id} aria-rowindex={windowStart + index + 2} className={selectedIdSet.has(asset.id) ? "selected-row" : ""} tabIndex={0} onKeyDown={(event) => handleRowKeyDown(event, asset, windowStart + index)} onDoubleClick={(event) => { if (event.target instanceof Element && event.target.closest("button, input, select, textarea")) return; if (asset.status !== "missing" && !busy) { if (asset.kind === "folder") navigateFolder(asset.relativePath); else void runAction(asset, "open"); } }} onContextMenu={(event) => openContextMenu(event, asset)} onClick={(event) => { setContextTarget(null); selectRow(event, asset.id); }} aria-selected={selectedIdSet.has(asset.id)} title={asset.relativePath}><td className="row-marker"><span /></td><td className="name-cell" style={{ width: columnWidths.name, maxWidth: columnWidths.name }}><div className="name-content"><AssetIcon asset={asset} /><span className={asset.kind === "folder" ? "folder-name" : ""}>{asset.name}</span></div></td><td className="tags-cell" style={{ width: columnWidths.tags, maxWidth: columnWidths.tags }}><TagEditor tags={asset.tags} availableTags={availableTags} compact onFilter={addFilter} disabled={asset.metadataState === "blocked" || asset.status === "missing" || !asset.metadataRevision || busy} busy={editingAssetId === asset.id} onAdd={(tag) => editTags(asset, [tag], [])} onRemove={(tag) => editTags(asset, [], [tag])} /></td><td className="type-cell" style={{ width: columnWidths.type, maxWidth: columnWidths.type }}>{asset.kind === "folder" ? "Folder" : asset.extension?.toUpperCase() ?? "File"}</td>{visibleColumns.path && <td className="path-cell" style={{ width: columnWidths.path, maxWidth: columnWidths.path }} title={asset.relativePath}>{asset.relativePath}</td>}{visibleColumns.modified && <td className="date-cell" style={{ width: columnWidths.modified, maxWidth: columnWidths.modified }}>{formatDate(asset.modifiedAt)}</td>}{visibleColumns.size && <td className="size-cell" style={{ width: columnWidths.size, maxWidth: columnWidths.size }}>{asset.kind === "folder" ? "—" : formatSize(asset.sizeBytes)}</td>}{visibleColumns.status && <td style={{ width: columnWidths.status, maxWidth: columnWidths.status }}><Status asset={asset} /></td>}</tr>)}{windowEnd < filtered.length && <tr aria-hidden="true" className="virtual-spacer"><td colSpan={columnCount} style={{ height: (filtered.length - windowEnd) * rowHeight }} /></tr>}</tbody></table>{filtered.length === 0 && <div className="empty-results">{noLibrary || !hasLibraryChildren ? <FolderOpen size={22} /> : <Search size={22} />}{!scanning && <strong>{emptyHeadline}</strong>}<span>{noLibrary ? (isDesktop ? "Register a folder to scan its files." : "No sample or local data is available in this browser view.") : error ? "Review the scan error above, then retry the scan." : scanning ? "Catalog rows will appear after scanning finishes." : !hasLibraryChildren ? "No files or folders at this level." : "Try another tag, path, or browse view."}</span>{library && (query || view !== "all") && <button type="button" onClick={() => { setQuery(""); setView("all"); }}>Clear filters</button>}</div>}</div>
            <footer className="table-footer"><span>Showing <strong>{filtered.length}</strong> of {directChildren.length} items in this folder</span><span><span className="keyboard-hint">⌘ / Ctrl</span> or <span className="keyboard-hint">Shift</span> to select multiple</span></footer>
          </section>
          <div className="page-footer"><span>ORGANIZE WITHOUT MOVING A THING.</span><span>Folder-level catalog · original files unchanged</span></div>
        </div>
      </main>

      {inspectorOpen && <aside className="inspector" aria-label="Asset details"><div className="inspector-top"><span>DETAILS</span><button type="button" className="icon-button" onClick={() => setInspectorOpen(false)} title="Hide details" aria-label="Hide details"><PanelRightClose size={17} /></button></div>{selected ? <div className="inspector-body"><div className="inspector-icon"><AssetIcon asset={selected} size={26} /></div><div className="inspector-label">{selected.kind === "folder" ? "FOLDER" : `${selected.extension?.toUpperCase() ?? "FILE"} FILE`}</div><h2 title={selected.name}>{selected.name}</h2><p className="inspector-description">{selected.relativePath}</p>{selectedIds.length > 1 && <div className="selection-note">{selectedIds.length} rows selected · showing most recent</div>}<div className="detail-divider" /><div className="detail-heading"><span>TAGS</span><span className="tag-count">{selected.tags.length}</span></div><div className="inspector-tags">{selected.tags.length ? selected.tags.map((tag) => <button className={`tag-chip tag-${tagGroup(tag).toLowerCase()}`} key={tag} type="button" onClick={() => addFilter(tag)} title={`Filter by ${tag}`}>{tag}</button>) : <span className="empty-inspector-tags">{selected.metadataState === "blocked" ? "Tags unavailable while metadata has an issue." : "No tags yet."}</span>}</div>{selected.metadataState === "blocked" && <p className="metadata-warning" role="status"><CircleAlert size={13} /> Metadata needs attention. Tag editing is disabled until issue is resolved.</p>}{selected.metadataId && <p className="metadata-id">Metadata ID · {selected.metadataId}</p>}{selected.notes && <><div className="detail-heading notes-heading">NOTES</div><p className="notes-text">{selected.notes}</p></>}<div className="detail-divider" /><div className="detail-heading">FILE DETAILS</div><dl className="detail-list"><div><dt>Location</dt><dd title={selected.relativePath}>{selected.relativePath}</dd></div><div><dt>Modified</dt><dd>{formatDate(selected.modifiedAt)}</dd></div><div><dt>Size</dt><dd>{selected.kind === "folder" ? "—" : formatSize(selected.sizeBytes)}</dd></div><div><dt>Scan state</dt><dd><Status asset={selected} /></dd></div></dl><div className="inspector-actions"><button type="button" disabled={busy || selected.status === "missing" || !isDesktop} title={selected.status === "missing" ? "Missing asset cannot be opened" : "Open with system default application"} onClick={() => void runAction(selected, "open")}><ExternalLink size={14} /> Open</button><button type="button" disabled={busy || selected.status === "missing" || !isDesktop} title={selected.status === "missing" ? "Missing asset cannot be revealed" : "Reveal in file manager"} onClick={() => void runAction(selected, "reveal")}><FolderSearch size={14} /> Reveal</button><button type="button" disabled={busy || selected.status === "missing" || !isDesktop} title={selected.status === "missing" ? "Full path unavailable for missing asset" : "Copy full path"} onClick={() => void runAction(selected, "copyFullPath")}><Copy size={14} /> Full path</button><button type="button" disabled={busy || selected.status === "missing" || !isDesktop} title={selected.status === "missing" ? "File actions unavailable for missing asset" : "Copy path relative to library"} onClick={() => void copyRelativePath(selected)}><Copy size={14} /> Relative path</button>{selected.status === "missing" && <button type="button" disabled={busy || selected.metadataState !== "valid" || !selected.metadataId || !selected.metadataRevision} onClick={() => void beginReconnect(selected)}><Wrench size={14} /> Reconnect metadata</button>}</div>{selected.status === "missing" && <p className="metadata-warning">This entry points to a missing asset. File actions stay disabled.</p>}</div> : <div className="inspector-empty"><div className="empty-outline"><Tag size={24} /></div><strong>Nothing selected</strong><p>Select a scanned row to see its location and file details.</p><span>YOUR ASSETS, IN CONTEXT</span></div>}</aside>}
      {!inspectorOpen && <button className="show-inspector" type="button" onClick={() => setInspectorOpen(true)} title="Show details" aria-label="Show details"><PanelRightOpen size={18} /></button>}
      {bulkTargets && <BulkTagDialog assets={bulkTargets} availableTags={availableTags} busy={bulkEditing} onCancel={() => setBulkTargets(null)} onConfirm={async (addTags, removeTags) => { const applied = await bulkEditTags(bulkTargets, addTags, removeTags); if (applied) setBulkTargets(null); return applied; }} />}
      {savedSearchDialogOpen && <SavedSearchDialog filters={currentFilters} searches={librarySavedSearches} busy={savingSearch} onCancel={() => setSavedSearchDialogOpen(false)} onSave={saveSearch} onDelete={async (search) => { const deleted = await deleteSearch(search.id); if (deleted) setSavedSearchDialogOpen(false); return deleted; }} />}
      {recovery && <RecoveryDialog source={recovery.source} targets={recovery.targets} busy={recoveryBusy} onCancel={() => setRecovery(null)} onConfirm={confirmReconnect} />}
    </div>
  );
}

export default App;
