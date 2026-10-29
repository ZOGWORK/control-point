// Prints: the team's 3D print library, as a file explorer with groups at its
// heart. Each file lives once, in a folder; it also belongs to smart groups
// worked out from its details (season and robot, subsystem, material, print
// status) and to any collections the team makes, without copies. The sidebar
// shows folders and groups together; picking groups combines them
// ("Intake + PETG + To print"), and from any group the team can download
// everything or mark a selection printed or failed.
//
// The view lives in the URL (?folder=, ?status=, ?sub=, ?mat=, ?robot=,
// ?season=, ?col=, ?q=), so a group can be linked and Back works.
import React, { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownUp, Check, ChevronRight, Download, FolderInput, FolderPlus, LayoutGrid, List, ListFilter, MoreHorizontal, Pencil, Printer, Search, Tag, Trash2,
  Upload, X, XCircle,
} from 'lucide-react';
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Input, Progress, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton,
} from '../../../components/ui-kit';
import { cn } from '../../../components/cn';
import { confirmDialog, notify } from '../../../components/dialog';
import { fmtDate } from '../../../components/cad/useCad';
import { seasonName } from '../../../types/cadBom';
import {
  FILTER_KEYS, PRINT_ACCEPT, STATUS_LABELS, canPreview, folderAndBelow, folderTrail, formatBytes, groupCounts, hasGroupFilter, isPrintStatus,
  matchesFilters, sortFiles, type FilterKey, type PrintFile, type PrintFilters, type PrintFolder, type PrintLibrary, type PrintStatus, type SortKey,
} from '../../../types/prints';
import { EmptyState, Page, PageHeader } from '../../ui/page';
import { PrintDetails } from './PrintDetails';
import { PrintsSidebar, type DropHandlers } from './PrintsSidebar';
import { FileArt, FolderArt, MoveDialog, NameDialog, StatusChip, copiesText } from './printsUi';
import { download, downloadFiles, fileUrl, folderZipUrl, thumbnailFor, usePrints, type UploadItem } from './usePrints';

const PrintViewer = React.lazy(() => import('../../../components/PrintViewer'));
const DRAG = 'application/x-cp-prints';
const VIEW_KEY = 'cp-prints-view';

// ---- The view in the URL -----------------------------------------------------
const PARAM: Record<FilterKey | 'query', string> = { robot: 'robot', season: 'season', subsystem: 'sub', material: 'mat', status: 'status', collection: 'col', query: 'q' };
function readFilters(p: URLSearchParams): PrintFilters {
  const f: PrintFilters = {};
  const n = (k: string) => { const v = Number(p.get(k)); return Number.isInteger(v) && v > 0 ? v : undefined; };
  const robot = p.get('robot');
  if (robot === 'none') f.robot = 'none'; else if (n('robot')) f.robot = n('robot');
  if (n('season')) f.season = n('season');
  if (p.get('sub')) f.subsystem = p.get('sub')!;
  if (p.get('mat')) f.material = p.get('mat')!;
  const st = p.get('status');
  if (isPrintStatus(st)) f.status = st;
  if (n('col')) f.collection = n('col');
  if (p.get('q')) f.query = p.get('q')!;
  return f;
}

/** "Intake + PETG + To print" */
function filterLabel(f: PrintFilters, lib: PrintLibrary): string {
  const parts: string[] = [];
  if (f.season !== undefined) parts.push(seasonName(f.season));
  if (f.robot === 'none') parts.push('No robot');
  else if (f.robot !== undefined) parts.push(lib.robots.find((r) => r.id === f.robot)?.name ?? 'Robot');
  if (f.subsystem) parts.push(f.subsystem);
  if (f.material) parts.push(f.material);
  if (f.status) parts.push(STATUS_LABELS[f.status]);
  if (f.collection !== undefined) parts.push(lib.collections.find((c) => c.id === f.collection)?.name ?? 'Collection');
  return parts.join(' + ');
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function PrintsPage() {
  const prints = usePrints();
  const { lib, state } = prints;
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const folderParam = Number(params.get('folder'));
  const folderId = lib && Number.isInteger(folderParam) && lib.folders.some((f) => f.id === folderParam) ? folderParam : null;
  const groupMode = hasGroupFilter(filters) || !!filters.query?.trim();
  const [view, setView] = useState<'list' | 'grid'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } });
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [detailsId, setDetailsId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<ReactNode>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [query, setQuery] = useState(filters.query ?? '');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage off */ } }, [view]);
  useEffect(() => { setQuery(filters.query ?? ''); }, [filters.query]);

  const go = useCallback((next: { folder?: number | null; filters?: PrintFilters }) => {
    setParams(() => {
      const p = new URLSearchParams();
      if (next.folder != null) p.set('folder', String(next.folder));
      const f = next.filters ?? {};
      for (const k of [...FILTER_KEYS, 'query'] as const) { const v = f[k]; if (v !== undefined && v !== '') p.set(PARAM[k], String(v)); }
      return p;
    });
    setSelected(new Set());
  }, [setParams]);
  const openFolder = (id: number | null) => { go({ folder: id }); setBrowseOpen(false); };
  const toggle = <K extends FilterKey>(key: K, value: PrintFilters[K]) => {
    const same = key === 'subsystem' || key === 'material'
      ? String(filters[key] ?? '').toLowerCase() === String(value).toLowerCase()
      : filters[key] === value;
    const next: PrintFilters = { ...filters, [key]: same ? undefined : value };
    // A robot belongs to one season: picking it replaces a season pick, and the reverse.
    if (!same && key === 'robot') next.season = undefined;
    if (!same && key === 'season') next.robot = undefined;
    go({ filters: next });
    setBrowseOpen(false);
  };
  // Search as you type, kept in the URL without a history entry per key.
  useEffect(() => {
    if ((filters.query ?? '') === query) return;
    const t = setTimeout(() => setParams((p) => { const n = new URLSearchParams(p); if (query.trim()) n.set('q', query); else n.delete('q'); return n; }, { replace: true }), 200);
    return () => clearTimeout(t);
  }, [query, filters.query, setParams]);

  // ---- What the view shows -------------------------------------------------
  const shown = useMemo(() => {
    if (!lib) return { folders: [] as PrintFolder[], files: [] as PrintFile[] };
    if (groupMode) {
      const files = lib.files.filter((f) => matchesFilters(f, filters));
      const q = filters.query?.trim().toLowerCase();
      const folders = q && !hasGroupFilter(filters) ? lib.folders.filter((f) => f.name.toLowerCase().includes(q)) : [];
      return { folders, files: sortFiles(files, sort.key, sort.dir) };
    }
    const folders = lib.folders.filter((f) => f.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { folders: sort.dir === 'desc' && sort.key === 'name' ? folders.reverse() : folders, files: sortFiles(lib.files.filter((f) => f.folderId === folderId), sort.key, sort.dir) };
  }, [lib, groupMode, filters, folderId, sort]);
  const counts = groupCounts(shown.files);
  const label = lib && groupMode ? (filterLabel(filters, lib) || `Search “${filters.query}”`) : null;
  const trail = lib ? folderTrail(lib.folders, folderId) : [];
  const here = groupMode ? label! : trail.length ? trail[trail.length - 1].name : 'All prints';
  const summary = `${plural(counts.files, 'file')}${counts.files ? (counts.stillToPrint ? ` · ${counts.stillToPrint} still to print` : ' · all printed or printing') : ''}`;
  useEffect(() => { if (lib) setAnnounce(`${here}: ${summary}`); }, [here, summary, lib]);
  const filesBelow = useMemo(() => (lib && !groupMode ? (folderId == null ? lib.files.length : lib.files.filter((f) => f.folderId != null && folderAndBelow(lib.folders, folderId).has(f.folderId)).length) : 0), [lib, groupMode, folderId]);
  // Selection never holds files that left the view.
  useEffect(() => { setSelected((s) => { const ids = new Set(shown.files.map((f) => f.id)); const n = new Set([...s].filter((x) => ids.has(x))); return n.size === s.size ? s : n; }); }, [shown.files]);
  const selectedFiles = shown.files.filter((f) => selected.has(f.id));

  const fail = (e: any, fallback = "That didn't work.") => { notify(e?.message || fallback, 'error'); if (e?.body?.code === 'workspace_changed') { go({}); void prints.reload(); } };
  const say = (msg: string) => { notify(msg, 'success'); setAnnounce(msg); };

  // ---- Actions -------------------------------------------------------------
  const canEdit = !!lib?.canEdit;
  const uploadFiles = async (files: File[], into: number | null = groupMode ? null : folderId) => {
    if (!canEdit || !files.length) return;
    const stored = await prints.upload(files, into, setUploads);
    // Uploading inside a group gives the new files that group's details.
    if (stored.length && groupMode) {
      const patch: Record<string, unknown> = {};
      if (filters.subsystem) patch.subsystem = filters.subsystem;
      if (filters.material) patch.material = filters.material;
      if (filters.status && filters.status !== 'to_print') patch.status = filters.status;
      if (typeof filters.robot === 'number') patch.robotId = filters.robot;
      else if (filters.season !== undefined) patch.season = filters.season;
      try {
        if (Object.keys(patch).length) for (const s of stored) await prints.updateFile(s.id, patch);
        if (filters.collection !== undefined) await prints.bulk(stored.map((s) => s.id), { action: 'collect', collectionId: filters.collection });
      } catch (e) { fail(e); }
    }
    const done = stored.length;
    if (done) say(`Uploaded ${plural(done, 'file')}${groupMode ? ` to ${label}` : ''}`);
  };
  const newFolder = () => setDialog(
    <NameDialog title="New folder" label="Folder name" confirm="Create folder" description={trail.length ? `Inside ${trail.map((f) => f.name).join(' / ')}` : 'At the top level'}
      onClose={() => setDialog(null)} onSave={async (name) => { try { await prints.createFolder(name, folderId); say(`Created ${name}`); return null; } catch (e: any) { return e?.message || "Couldn't create it"; } }} />);
  const renameFile = (f: PrintFile) => setDialog(
    <NameDialog title="Rename file" label="File name" confirm="Rename" initial={f.name}
      onClose={() => setDialog(null)} onSave={async (name) => { try { await prints.updateFile(f.id, { name }); say(`Renamed to ${name}`); return null; } catch (e: any) { return e?.message || "Couldn't rename it"; } }} />);
  const renameFolder = (f: PrintFolder) => setDialog(
    <NameDialog title="Rename folder" label="Folder name" confirm="Rename" initial={f.name}
      onClose={() => setDialog(null)} onSave={async (name) => { try { await prints.updateFolder(f.id, { name }); say(`Renamed to ${name}`); return null; } catch (e: any) { return e?.message || "Couldn't rename it"; } }} />);
  const moveFiles = (ids: number[]) => {
    if (!lib || !ids.length) return;
    const one = ids.length === 1 ? lib.files.find((f) => f.id === ids[0]) : null;
    setDialog(<MoveDialog folders={lib.folders} count={one ? one.name : plural(ids.length, 'file')} current={one ? one.folderId : groupMode ? undefined : folderId}
      onClose={() => setDialog(null)} onMove={async (to) => { await moveTo(ids, to); }} />);
  };
  const moveTo = async (ids: number[], to: number | null) => {
    try {
      await prints.bulk(ids, { action: 'move', folderId: to });
      say(`Moved ${plural(ids.length, 'file')} to ${to == null ? 'the top level' : lib?.folders.find((f) => f.id === to)?.name}`);
    } catch (e) { fail(e); }
  };
  const moveFolder = (f: PrintFolder) => lib && setDialog(
    <MoveDialog folders={lib.folders} count={f.name} current={f.parentId} exclude={[f.id]} onClose={() => setDialog(null)}
      onMove={async (to) => { try { await prints.updateFolder(f.id, { parentId: to }); say(`Moved ${f.name}`); } catch (e) { fail(e); } }} />);
  const moveFolderTo = async (id: number, to: number | null) => {
    if (!lib || id === to || (to != null && folderAndBelow(lib.folders, id).has(to))) return;
    const f = lib.folders.find((x) => x.id === id);
    if (!f || f.parentId === to) return;
    try { await prints.updateFolder(id, { parentId: to }); say(`Moved ${f.name}`); } catch (e) { fail(e); }
  };
  const deleteFiles = async (ids: number[]) => {
    if (!lib || !ids.length) return;
    const one = ids.length === 1 ? lib.files.find((f) => f.id === ids[0]) : null;
    const ok = await confirmDialog({ title: one ? `Delete ${one.name}?` : `Delete ${plural(ids.length, 'file')}?`, message: 'They are removed from every folder and collection. This can’t be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await prints.bulk(ids, { action: 'delete' });
      if (detailsId && ids.includes(detailsId)) setDetailsId(null);
      say(`Deleted ${plural(ids.length, 'file')}`);
    } catch (e) { fail(e); }
  };
  const deleteFolder = async (f: PrintFolder) => {
    if (!lib) return;
    const inside = folderAndBelow(lib.folders, f.id);
    const n = lib.files.filter((x) => x.folderId != null && inside.has(x.folderId)).length;
    const subs = inside.size - 1;
    const ok = await confirmDialog({
      title: `Delete ${f.name}?`,
      message: n ? `It holds ${plural(n, 'file')}${subs ? ` (in it and the ${plural(subs, 'folder')} inside it)` : ''}. They’ll be deleted too, and this can’t be undone.` : `It’s empty${subs ? ` apart from ${plural(subs, 'empty folder')}` : ''}.`,
      confirmLabel: n ? `Delete folder and ${plural(n, 'file')}` : 'Delete folder', danger: true,
    });
    if (!ok) return;
    try {
      await prints.deleteFolder(f.id, n);
      if (folderId != null && inside.has(folderId)) go({ folder: f.parentId });
      say(`Deleted ${f.name}${n ? ` and ${plural(n, 'file')}` : ''}`);
    } catch (e: any) {
      if (e?.status === 409) notify(`${e.message} Someone changed this folder meanwhile; try again.`, 'error'); else fail(e);
    }
  };
  const setStatus = async (ids: number[], status: PrintStatus) => {
    try { await prints.bulk(ids, { action: 'status', status }); say(`Marked ${plural(ids.length, 'file')} ${STATUS_LABELS[status].toLowerCase()}`); } catch (e) { fail(e); }
  };
  const collect = async (ids: number[], collectionId: number, add = true) => {
    const c = lib?.collections.find((x) => x.id === collectionId);
    try { await prints.bulk(ids, { action: add ? 'collect' : 'uncollect', collectionId }); say(`${add ? 'Added' : 'Removed'} ${plural(ids.length, 'file')} ${add ? 'to' : 'from'} ${c?.name}`); } catch (e) { fail(e); }
  };
  const newCollection = (thenAdd?: number[]) => setDialog(
    <NameDialog title="New collection" label="Collection name" confirm="Create" maxLength={40}
      description="A group you make, like “Comp spares” or “Worlds kit”. A file can be in several; nothing is copied."
      onClose={() => setDialog(null)} onSave={async (name) => {
        try { const c = await prints.createCollection(name); if (thenAdd?.length) await prints.bulk(thenAdd, { action: 'collect', collectionId: c.id }); say(`Created ${name}`); return null; }
        catch (e: any) { return e?.message || "Couldn't create it"; }
      }} />);
  const renameCollection = (id: number) => {
    const c = lib?.collections.find((x) => x.id === id);
    if (c) setDialog(<NameDialog title="Rename collection" label="Collection name" confirm="Rename" initial={c.name} maxLength={40}
      onClose={() => setDialog(null)} onSave={async (name) => { try { await prints.renameCollection(id, name); return null; } catch (e: any) { return e?.message || "Couldn't rename it"; } }} />);
  };
  const deleteCollection = async (id: number) => {
    const c = lib?.collections.find((x) => x.id === id);
    if (!c) return;
    if (!(await confirmDialog({ title: `Delete ${c.name}?`, message: `Its ${plural(c.files, 'file')} stay where they live; only the collection goes.`, confirmLabel: 'Delete collection', danger: true }))) return;
    try { await prints.deleteCollection(id); if (filters.collection === id) go({ filters: { ...filters, collection: undefined } }); say(`Deleted ${c.name}`); } catch (e) { fail(e); }
  };
  const downloadAll = () => {
    if (!lib) return;
    if (groupMode) { if (shown.files.length) downloadFiles(shown.files.map((f) => f.id), label || 'Prints').catch(fail); }
    else if (filesBelow) download(folderZipUrl(folderId));
  };

  // ---- Drag and drop ---------------------------------------------------------
  const drop: DropHandlers = {
    over,
    target: (key, accepts) => {
      if (!canEdit) return { onDragOver: () => {}, onDragLeave: () => {}, onDrop: () => {} };
      const ok = (e: DragEvent) => e.dataTransfer.types.includes(DRAG) || (!!accepts?.os && e.dataTransfer.types.includes('Files'));
      return {
        onDragOver: (e) => { if (!ok(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG) ? 'move' : 'copy'; if (over !== key) setOver(key); },
        onDragLeave: (e) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o)); },
        onDrop: (e) => {
          if (!ok(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          const [kind, rawId] = key.split(':');
          const id = rawId === 'root' ? null : Number(rawId);
          const raw = e.dataTransfer.getData(DRAG);
          if (!raw) { if (kind === 'folder') void uploadFiles([...e.dataTransfer.files], id); return; }
          let data: { files?: number[]; folder?: number } = {};
          try { data = JSON.parse(raw); } catch { return; }
          if (kind === 'collection' && data.files?.length && id != null) void collect(data.files, id);
          if (kind === 'folder' && data.files?.length) void moveTo(data.files, id);
          if (kind === 'folder' && data.folder != null && accepts?.folders) void moveFolderTo(data.folder, id);
        },
      };
    },
  };
  const dragFiles = (f: PrintFile) => (e: DragEvent) => {
    const ids = selected.has(f.id) ? [...selected] : [f.id];
    e.dataTransfer.setData(DRAG, JSON.stringify({ files: ids }));
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const dragFolder = (f: PrintFolder) => (e: DragEvent) => { e.dataTransfer.setData(DRAG, JSON.stringify({ folder: f.id })); e.dataTransfer.effectAllowed = 'move'; };
  const mainDrop = drop.target(`folder:${groupMode || folderId == null ? 'root' : folderId}`, { os: true });

  // ---- Keyboard ---------------------------------------------------------------
  const onFileKey = (f: PrintFile) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.rowMain) return;
    if (!canEdit) return;
    if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); void deleteFiles(selected.size && selected.has(f.id) ? [...selected] : [f.id]); }
    if (e.key === 'F2') { e.preventDefault(); renameFile(f); }
  };
  const onFolderKey = (f: PrintFolder) => (e: KeyboardEvent) => {
    if (!canEdit) return;
    if (e.key === 'F2') { e.preventDefault(); renameFolder(f); }
    if (e.key === 'Delete') { e.preventDefault(); void deleteFolder(f); }
  };
  const onListKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && (e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault();
      setSelected(new Set(shown.files.map((f) => f.id)));
    }
    if (e.key === 'Escape' && selected.size) setSelected(new Set());
  };

  // ---- Render -------------------------------------------------------------------
  if (state === 'loading' && !lib) return <Page><PageHeader eyebrow="Build" title="Prints" /><div className="grid gap-4 md:grid-cols-[260px_1fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></Page>;
  if (!lib) return <Page><PageHeader eyebrow="Build" title="Prints" /><EmptyState icon={Printer} title="Couldn't load your prints" description="Check your connection and refresh the page." /></Page>;

  const sidebar = (
    <PrintsSidebar lib={lib} folderId={folderId} filters={filters} groupMode={groupMode} onFolder={openFolder} onToggle={toggle} drop={drop}
      onNewCollection={() => newCollection()} onRenameCollection={renameCollection} onDeleteCollection={(id) => void deleteCollection(id)} />
  );
  const usedPct = Math.min(100, Math.round((lib.usage.used / Math.max(1, lib.usage.quota)) * 100));
  const preview = previewId != null ? lib.files.find((f) => f.id === previewId) : null;
  const details = detailsId != null ? lib.files.find((f) => f.id === detailsId) : null;
  const allSelected = shown.files.length > 0 && shown.files.every((f) => selected.has(f.id));
  const activeChips = FILTER_KEYS.filter((k) => filters[k] !== undefined);

  const fileMenu = (f: PrintFile) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 shrink-0 md:size-8" aria-label={`${f.name} options`}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => setDetailsId(f.id)}>Details</DropdownMenuItem>
        {canPreview(f.kind) && <DropdownMenuItem onSelect={() => setPreviewId(f.id)}>3D preview</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => download(fileUrl(f.id))}><Download /> Download</DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Mark as</DropdownMenuLabel>
            {(['to_print', 'printing', 'printed', 'failed'] as const).filter((s) => s !== f.status).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => void setStatus([f.id], s)}>{STATUS_LABELS[s]}</DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => renameFile(f)}><Pencil /> Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveFiles([f.id])}><FolderInput /> Move to…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void deleteFiles([f.id])} className="text-destructive"><Trash2 className="size-4" /> Delete</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const folderMenu = (f: PrintFolder) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 shrink-0 md:size-8" aria-label={`${f.name} options`}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => openFolder(f.id)}>Open</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download(folderZipUrl(f.id))}><Download /> Download as ZIP</DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => renameFolder(f)}><Pencil /> Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveFolder(f)}><FolderInput /> Move to…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void deleteFolder(f)} className="text-destructive"><Trash2 className="size-4" /> Delete</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const folderCount = (f: PrintFolder) => { const inside = folderAndBelow(lib.folders, f.id); return lib.files.filter((x) => x.folderId != null && inside.has(x.folderId)).length; };
  const where = (f: PrintFile) => { const t = folderTrail(lib.folders, f.folderId); return t.length ? t.map((x) => x.name).join(' / ') : 'Top level'; };
  const meta = (f: PrintFile) => [f.subsystem, f.material, copiesText(f)].filter(Boolean).join(' · ');

  return (
    <Page fullBleed className="mx-auto max-w-[1400px]">
      <PageHeader eyebrow="Build" title="Prints"
        description="Every 3D print file in one library: folders for where a file lives, groups for how you think about it. One file can sit in many groups without a copy."
        actions={canEdit ? (
          <>
            <Button variant="outline" onClick={newFolder} disabled={groupMode}><FolderPlus /> New folder</Button>
            <Button onClick={() => fileInput.current?.click()}><Upload /> Upload</Button>
          </>
        ) : undefined} />
      <input ref={fileInput} type="file" multiple accept={PRINT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; void uploadFiles(list); }} />
      <p className="sr-only" aria-live="polite" role="status">{announce}</p>

      <div className="grid gap-6 md:grid-cols-[250px_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pb-6 pr-1">
            {sidebar}
            <div className="mt-6 px-2">
              <p className="mb-1.5 text-xs text-muted-foreground">{formatBytes(lib.usage.used)} of {formatBytes(lib.usage.quota)} used</p>
              <Progress value={usedPct} aria-label="Storage used" className={cn(usedPct > 90 && '[&>*]:bg-orange-400')} />
              <p className="mt-1.5 text-xs text-muted-foreground">Files up to {formatBytes(lib.usage.maxFile)} each.</p>
            </div>
          </div>
        </aside>

        <section aria-label={here} className={cn('min-w-0 rounded-2xl', over === mainDropKey(groupMode, folderId) && 'ring-2 ring-accent ring-offset-4 ring-offset-background')} {...mainDrop} onKeyDown={onListKey}>
          {/* Location: the folder path, or the groups picked. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-10 md:hidden" onClick={() => setBrowseOpen(true)}><ListFilter /> Folders and groups</Button>
            {groupMode ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {activeChips.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-0.5 pl-2.5 pr-1 text-sm">
                    {filterLabel({ [k]: filters[k] } as PrintFilters, lib)}
                    <button type="button" className="flex size-7 items-center justify-center rounded-full hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:size-5"
                      aria-label={`Remove ${filterLabel({ [k]: filters[k] } as PrintFilters, lib)}`} onClick={() => go({ filters: { ...filters, [k]: undefined } })}><X className="size-3.5" /></button>
                  </span>
                ))}
                <Button variant="ghost" size="sm" onClick={() => go({})}>Clear</Button>
              </div>
            ) : (
              <nav aria-label="Folder path" className="min-w-0">
                <ol className="flex flex-wrap items-center gap-0.5 text-sm">
                  <li {...drop.target('folder:root', { folders: true, os: true })}>
                    <button type="button" onClick={() => openFolder(null)} aria-current={folderId === null ? 'page' : undefined}
                      className={cn('rounded-md px-1.5 py-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60', folderId === null ? 'font-semibold' : 'text-muted-foreground', over === 'folder:root' && 'ring-2 ring-accent')}>
                      All prints
                    </button>
                  </li>
                  {trail.map((f, i) => (
                    <li key={f.id} className="flex items-center gap-0.5" {...drop.target(`folder:${f.id}`, { folders: true, os: true })}>
                      <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                      <button type="button" onClick={() => openFolder(f.id)} aria-current={i === trail.length - 1 ? 'page' : undefined}
                        className={cn('max-w-[14rem] truncate rounded-md px-1.5 py-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60', i === trail.length - 1 ? 'font-semibold' : 'text-muted-foreground', over === `folder:${f.id}` && 'ring-2 ring-accent')}>
                        {f.name}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </div>

          {/* Toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the library" aria-label="Search the library" className="h-10 pl-9" />
            </div>
            <label className="sr-only" htmlFor="prints-sort">Sort by</label>
            <select id="prints-sort" value={sort.key} onChange={(e) => setSort((s) => ({ ...s, key: e.target.value as SortKey }))}
              className="h-10 rounded-lg border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <option value="name">Name</option><option value="date">Date changed</option><option value="size">Size</option>
            </select>
            <Button variant="outline" size="icon" className="size-10" onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
              aria-label={sort.dir === 'asc' ? 'Ascending; switch to descending' : 'Descending; switch to ascending'}><ArrowDownUp className={cn("size-4", sort.dir === "desc" && "rotate-180")} /></Button>
            <div role="group" aria-label="View" className="flex rounded-lg border border-border p-0.5">
              <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon" className="size-9" aria-pressed={view === 'list'} aria-label="List view" onClick={() => setView('list')}><List /></Button>
              <Button variant={view === 'grid' ? 'secondary' : 'ghost'} size="icon" className="size-9" aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => setView('grid')}><LayoutGrid /></Button>
            </div>
          </div>

          {/* What this group or folder holds */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-w-0 text-base font-semibold">
              <span className="break-words">{here}</span>{' '}
              <span className="font-normal text-muted-foreground">· {summary}</span>
            </h2>
            <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={downloadAll} disabled={groupMode ? !shown.files.length : !filesBelow}><Download /> Download all</Button>
          </div>

          {selected.size > 0 && (
            <div role="toolbar" aria-label="Selected files" className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-elevated p-2 shadow-lg">
              <span className="px-2 text-sm font-medium">{selected.size} selected</span>
              {canEdit && <Button size="sm" className="h-10 md:h-8" onClick={() => void setStatus([...selected], 'printed')}><Check /> Printed</Button>}
              {canEdit && <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={() => void setStatus([...selected], 'failed')}><XCircle /> Failed</Button>}
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-10 md:h-8"><Tag /> Group…</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Mark as</DropdownMenuLabel>
                    {(['to_print', 'printing'] as const).map((s) => <DropdownMenuItem key={s} onSelect={() => void setStatus([...selected], s)}>{STATUS_LABELS[s]}</DropdownMenuItem>)}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Add to collection</DropdownMenuLabel>
                    {lib.collections.map((c) => <DropdownMenuItem key={c.id} onSelect={() => void collect([...selected], c.id)}>{c.name}</DropdownMenuItem>)}
                    <DropdownMenuItem onSelect={() => newCollection([...selected])}>New collection…</DropdownMenuItem>
                    {filters.collection !== undefined && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void collect([...selected], filters.collection!, false)}>Remove from {lib.collections.find((c) => c.id === filters.collection)?.name}</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {canEdit && <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={() => moveFiles([...selected])}><FolderInput /> Move to…</Button>}
              <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={() => downloadFiles([...selected], selectedFiles.length === 1 ? selectedFiles[0].name.replace(/\.[^.]+$/, '') : label || here).catch(fail)}><Download /> Download</Button>
              {canEdit && <Button size="sm" variant="outline" className="h-10 text-destructive md:h-8" onClick={() => void deleteFiles([...selected])}><Trash2 className="size-4" /> Delete</Button>}
              <Button size="sm" variant="ghost" className="ml-auto h-10 md:h-8" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          )}

          {uploads.length > 0 && <UploadPanel items={uploads} onClose={() => setUploads([])} />}

          {shown.folders.length === 0 && shown.files.length === 0 ? (
            groupMode
              ? <EmptyState icon={ListFilter} title="Nothing in this group" description="No file matches every group picked. Remove one to see more." action={<Button variant="outline" onClick={() => go({})}>Clear groups</Button>} />
              : <EmptyState icon={Printer} title={folderId == null ? 'No prints yet' : 'This folder is empty'}
                  description={canEdit ? 'Drop STL, 3MF, STEP, OBJ or G-code files here, or upload them. Control Kit files its parts to print here too.' : 'Files your team uploads show up here.'}
                  action={canEdit ? <Button onClick={() => fileInput.current?.click()}><Upload /> Upload files</Button> : undefined} />
          ) : view === 'list' ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="hidden items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:flex">
                <Checkbox aria-label={allSelected ? 'Clear the selection' : 'Select every file shown'} checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(shown.files.map((f) => f.id)) : new Set())} disabled={!shown.files.length} />
                <span className="w-9" aria-hidden />
                <span className="flex-1">Name</span>
                <span className="w-36">Status</span>
                <span className="w-20 text-right">Size</span>
                <span className="w-28">Changed</span>
                <span className="w-8" aria-hidden />
              </div>
              <ul aria-label={`Contents of ${here}`}>
                {shown.folders.map((f) => (
                  <li key={`d${f.id}`} draggable={canEdit} onDragStart={dragFolder(f)} {...drop.target(`folder:${f.id}`, { folders: true, os: true })}
                    className={cn('flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-muted/40', over === `folder:${f.id}` && 'bg-accent/10 ring-2 ring-inset ring-accent')}>
                    <span className="hidden w-4 md:block" aria-hidden />
                    <FolderArt className="size-9 shrink-0 p-1.5" />
                    <button type="button" onClick={() => openFolder(f.id)} data-row-main="1" onKeyDown={onFolderKey(f)}
                      className="min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block text-xs text-muted-foreground">{groupMode ? `Folder in ${folderTrail(lib.folders, f.parentId).map((x) => x.name).join(' / ') || 'Top level'}` : `Folder · ${plural(folderCount(f), 'file')}`}</span>
                    </button>
                    <span className="hidden w-36 md:block" />
                    <span className="hidden w-20 md:block" />
                    <span className="hidden w-28 text-xs text-muted-foreground md:block">{fmtDate(f.updatedAt)}</span>
                    {folderMenu(f)}
                  </li>
                ))}
                {shown.files.map((f) => (
                  <li key={f.id} draggable={canEdit} onDragStart={dragFiles(f)} onKeyDown={onFileKey(f)}
                    className={cn('flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-muted/40', selected.has(f.id) && 'bg-accent/[0.07]')}>
                    <Checkbox aria-label={`Select ${f.name}`} checked={selected.has(f.id)} className="max-md:size-5"
                      onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(f.id); else n.delete(f.id); return n; })} />
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#1b1b1f]"><FileArt file={f} className="size-full" /></span>
                    <button type="button" data-row-main="1" onClick={() => setDetailsId(f.id)}
                      className="min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="md:hidden">{STATUS_LABELS[f.status]} · {formatBytes(f.size)}{meta(f) ? ' · ' : ''}</span>
                        {groupMode ? `${where(f)}${meta(f) ? ' · ' : ''}` : ''}{meta(f)}
                      </span>
                    </button>
                    <span className="hidden w-36 md:block"><StatusChip status={f.status} /></span>
                    <span className="hidden w-20 text-right text-xs tabular-nums text-muted-foreground md:block">{formatBytes(f.size)}</span>
                    <span className="hidden w-28 text-xs text-muted-foreground md:block">{fmtDate(f.updatedAt)}</span>
                    {fileMenu(f)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul aria-label={`Contents of ${here}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {shown.folders.map((f) => (
                <li key={`d${f.id}`} draggable={canEdit} onDragStart={dragFolder(f)} {...drop.target(`folder:${f.id}`, { folders: true, os: true })}
                  className={cn('group relative flex flex-col rounded-xl border border-border bg-card p-3 transition-colors hover:border-accent/40', over === `folder:${f.id}` && 'border-accent ring-2 ring-accent')}>
                  <button type="button" onClick={() => openFolder(f.id)} onKeyDown={onFolderKey(f)} className="flex flex-col items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                    <FolderArt className="size-10" />
                    <span className="line-clamp-2 break-words text-sm font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{plural(folderCount(f), 'file')}</span>
                  </button>
                  <span className="absolute right-1.5 top-1.5">{folderMenu(f)}</span>
                </li>
              ))}
              {shown.files.map((f) => (
                <li key={f.id} draggable={canEdit} onDragStart={dragFiles(f)} onKeyDown={onFileKey(f)}
                  className={cn('group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-accent/40', selected.has(f.id) ? 'border-accent' : 'border-border')}>
                  <button type="button" data-row-main="1" onClick={() => setDetailsId(f.id)} className="flex flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60">
                    <span className="flex aspect-square items-center justify-center bg-[#1b1b1f]"><FileArt file={f} size="lg" className="size-full p-2" /></span>
                    <span className="p-3 pb-2">
                      <span className="line-clamp-2 break-words text-sm font-medium">{f.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta(f) || formatBytes(f.size)}</span>
                    </span>
                  </button>
                  <div className="mt-auto flex items-center justify-between gap-1 px-3 pb-2">
                    <StatusChip status={f.status} />
                    {fileMenu(f)}
                  </div>
                  <span className="absolute left-2 top-2 rounded-md bg-background/80 p-1 backdrop-blur-sm">
                    <Checkbox aria-label={`Select ${f.name}`} checked={selected.has(f.id)} className="max-md:size-5"
                      onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(f.id); else n.delete(f.id); return n; })} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (shown.files.length > 0 || shown.folders.length > 0) && (
            <p className="mt-3 hidden text-xs text-muted-foreground md:block">Drop files here to upload. Drag files onto a folder to move them, or onto a collection to add them. Delete removes, F2 renames, Ctrl+A selects all.</p>
          )}
        </section>
      </div>

      <Sheet open={browseOpen} onOpenChange={setBrowseOpen}>
        <SheetContent side="left" className="w-[88vw] max-w-sm">
          <SheetHeader><SheetTitle>Folders and groups</SheetTitle></SheetHeader>
          {sidebar}
          <p className="mt-4 text-xs text-muted-foreground">{formatBytes(lib.usage.used)} of {formatBytes(lib.usage.quota)} used · files up to {formatBytes(lib.usage.maxFile)}</p>
        </SheetContent>
      </Sheet>

      {details && (
        <PrintDetails file={details} lib={lib} prints={prints} onClose={() => setDetailsId(null)} onError={(m) => notify(m, 'error')}
          onPreview={() => setPreviewId(details.id)} onRename={() => renameFile(details)} onMove={() => moveFiles([details.id])} onDelete={() => void deleteFiles([details.id])} />
      )}
      {preview && (
        <Dialog open onOpenChange={(o) => { if (!o) setPreviewId(null); }}>
          <DialogContent className="flex h-[min(88vh,760px)] w-[min(96vw,1100px)] max-w-none flex-col sm:max-w-none">
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{preview.name}</DialogTitle>
              <DialogDescription>{[where(preview), preview.subsystem, preview.material].filter(Boolean).join(' · ')}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1">
              <React.Suspense fallback={<Skeleton className="h-full" />}>
                <PrintViewer url={fileUrl(preview.id)} kind={preview.kind as 'stl' | '3mf' | 'obj'} name={preview.name}
                  onLoaded={canEdit && !preview.hasThumb ? (buf) => { void thumbnailFor(new Blob([buf]), preview.name).then((png) => png && prints.putThumbnail(preview.id, png)).catch(() => {}); } : undefined} />
              </React.Suspense>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {dialog}
    </Page>
  );
}

const mainDropKey = (groupMode: boolean, folderId: number | null) => `folder:${groupMode || folderId == null ? 'root' : folderId}`;

function UploadPanel({ items, onClose }: { items: UploadItem[]; onClose: () => void }) {
  const done = items.filter((i) => i.state === 'done').length;
  const failed = items.filter((i) => i.state === 'error');
  const busy = items.some((i) => i.state === 'uploading' || i.state === 'waiting');
  return (
    <div className="mb-3 rounded-xl border border-border bg-card p-3" role="region" aria-label="Uploads">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">{busy ? `Uploading ${Math.min(done + 1, items.length)} of ${items.length}…` : `Uploaded ${done} of ${items.length}`}</p>
        {!busy && <Button variant="ghost" size="icon" className="size-9" aria-label="Close uploads" onClick={onClose}><X /></Button>}
      </div>
      <Progress value={(done + failed.length) / Math.max(1, items.length) * 100} className="mt-2" aria-label="Upload progress" />
      {(failed.length > 0 || items.some((i) => i.message)) && (
        <ul className="mt-2 grid gap-1 text-xs">
          {items.filter((i) => i.message).map((i) => (
            <li key={i.key} className={cn(i.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}><span className="font-medium">{i.name}</span>: {i.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
