/**
 * The Prints library: a team's 3D print files in folders (where a file lives)
 * and in groups (how the team thinks about it). Smart groups come from each
 * file's details: robot and season, subsystem, material and print status.
 * Collections are groups the team makes itself; a file can sit in any number
 * of them without being copied.
 *
 * Shared by the server (validation, server/prints.ts) and the client (the
 * explorer's filters and counts). Pure: no DOM, no Node.
 */

export type PrintKind = 'stl' | '3mf' | 'obj' | 'step' | 'gcode';

const EXT_KIND: Record<string, PrintKind> = {
  stl: 'stl', '3mf': '3mf', obj: 'obj', step: 'step', stp: 'step', gcode: 'gcode', gco: 'gcode', bgcode: 'gcode',
};
/** Extensions the library accepts, for the file picker's accept list. */
export const PRINT_EXTENSIONS = Object.keys(EXT_KIND);
export const PRINT_ACCEPT = PRINT_EXTENSIONS.map((e) => `.${e}`).join(',');

/** What kind of print file a name is, by its extension; null when the library doesn't take it. */
export function printKind(name: string): PrintKind | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? EXT_KIND[m[1].toLowerCase()] ?? null : null;
}

/** Kinds the browser can show in 3D (and draw a thumbnail for). STEP and G-code show an icon. */
export const PREVIEW_KINDS: readonly PrintKind[] = ['stl', '3mf', 'obj'];
export const canPreview = (kind: PrintKind | string) => (PREVIEW_KINDS as readonly string[]).includes(kind);

export const KIND_LABELS: Record<PrintKind, string> = { stl: 'STL', '3mf': '3MF', obj: 'OBJ', step: 'STEP', gcode: 'G-code' };

export type PrintStatus = 'to_print' | 'printing' | 'printed' | 'failed';
export const PRINT_STATUSES: readonly PrintStatus[] = ['to_print', 'printing', 'printed', 'failed'];
export const STATUS_LABELS: Record<PrintStatus, string> = {
  to_print: 'To print', printing: 'Printing', printed: 'Printed', failed: 'Failed or reprint',
};
export const isPrintStatus = (v: unknown): v is PrintStatus => typeof v === 'string' && (PRINT_STATUSES as readonly string[]).includes(v);
/** Statuses that still need a print. */
export const stillToPrint = (s: PrintStatus) => s === 'to_print' || s === 'failed';

export type PrintPriority = 'urgent' | 'high' | 'normal' | 'low';
/** Most pressing first. */
export const PRINT_PRIORITIES: readonly PrintPriority[] = ['urgent', 'high', 'normal', 'low'];
export const PRIORITY_LABELS: Record<PrintPriority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
export const isPrintPriority = (v: unknown): v is PrintPriority => typeof v === 'string' && (PRINT_PRIORITIES as readonly string[]).includes(v);

/** A due date as stored: "YYYY-MM-DD" for a real day, null for none, undefined when it can't be one. */
export function cleanDueDate(raw: unknown): string | null | undefined {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const [y, m, d] = raw.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? raw : undefined;
}

/** Materials offered first; any other short name is kept as typed. */
export const PRINT_MATERIALS = ['PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'Nylon', 'PC', 'CF Nylon', 'Resin'] as const;

/** A material as stored: a known one in its usual spelling, else trimmed and capped; '' means none. */
export function cleanMaterial(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) : '';
  if (!v) return '';
  return PRINT_MATERIALS.find((m) => m.toLowerCase() === v.toLowerCase()) ?? v;
}

/** A subsystem as stored: trimmed, capped, '' for none. */
export function cleanSubsystem(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32) : '';
}

export const MAX_NAME = 120;
/** Characters that can't be in a file or folder name: path separators, Windows reserved, control characters. */
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

/**
 * A file or folder name as typed, or null when it can't be one: empty, "." or
 * "..", a path separator or reserved character, a trailing dot or space, or
 * longer than 120 characters. Names never become disk paths (files are stored
 * under random keys); this keeps them safe as ZIP entries and in every OS.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.normalize('NFC').trim();
  if (!v || v === '.' || v === '..' || v.length > MAX_NAME) return null;
  if (BAD_NAME.test(v) || /[. ]$/.test(v)) return null;
  return v;
}

/** A name from elsewhere (a robot, a Control Kit part) made safe: bad characters become "-", then cleanName rules. */
export function safeName(raw: unknown, fallback = 'Untitled'): string {
  const v = String(raw ?? '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-').trim().replace(/[. ]+$/, '').slice(0, MAX_NAME).trim();
  return cleanName(v) ?? fallback;
}

/** A path "Season / Robot / Control Kit" (or segments) as cleaned names, or null when any part is unusable. */
export function splitPath(path: string | readonly string[]): string[] | null {
  const parts = (Array.isArray(path) ? [...path] : String(path).split('/')).map((p) => String(p).trim()).filter((p) => p !== '');
  if (!parts.length || parts.length > 12) return null;
  const out: string[] = [];
  for (const p of parts) {
    const c = cleanName(p);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

/** A file name's stem and extension ("bracket.v2.stl" → ["bracket.v2", ".stl"]). */
export function splitExt(name: string): [string, string] {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(name)!;
  return m[1] ? [m[1], m[2] ?? ''] : [name, ''];
}

/** The name, or "name (2).stl", "name (3).stl"… — the first one not in `taken` (lower-cased names). */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const [stem, ext] = splitExt(name);
  const base = stem.replace(/ \(\d+\)$/, '');
  for (let i = 2; i < 10_000; i++) {
    const room = MAX_NAME - ext.length - ` (${i})`.length;
    const next = `${base.slice(0, room)} (${i})${ext}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${base.slice(0, MAX_NAME - ext.length - 14)} (${Date.now()})${ext}`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// The library as the explorer sees it (GET /api/prints/library).

export interface PrintFolder { id: number; parentId: number | null; name: string; createdAt: string; updatedAt: string }
export interface PrintCollection { id: number; name: string; files: number }
export interface PrintRobot { id: number; name: string; season: number; seasonName: string }
export interface PrintCadPart { id: number; name: string; section: string | null; quantity: number; robotId: number | null }
export interface PrintFile {
  id: number;
  folderId: number | null;
  name: string;
  kind: PrintKind;
  size: number;
  createdAt: string;
  updatedAt: string;
  uploadedBy: string | null;
  notes: string;
  robotId: number | null;
  /** The robot's season when a robot is linked, else the one set by hand. */
  season: number | null;
  cadPart: PrintCadPart | null;
  /** Set by hand, else the linked CAD part's section. */
  subsystem: string | null;
  subsystemFrom: 'manual' | 'cad' | null;
  material: string | null;
  status: PrintStatus;
  /** Set by hand, else the linked CAD part's quantity. */
  copiesNeeded: number | null;
  copiesNeededFrom: 'manual' | 'cad' | null;
  copiesPrinted: number;
  priority: PrintPriority;
  /** "YYYY-MM-DD", or null. */
  dueDate: string | null;
  /** Where a person placed it in the queue (1 is next), or null when it slots in by priority and due date. */
  queuePos: number | null;
  collections: number[];
  hasThumb: boolean;
  source: 'upload' | 'control-kit';
}
export interface PrintLibrary {
  /** The workspace this library belongs to; every write names it (a write after a workspace switch is refused). */
  teamId: number;
  canEdit: boolean;
  usage: { used: number; quota: number; maxFile: number };
  folders: PrintFolder[];
  files: PrintFile[];
  collections: PrintCollection[];
  robots: PrintRobot[];
  /** The team's subsystem names (Settings → Workspace), offered first. */
  subsystems: string[];
}

/** Folders from the root down to `id` (empty for the root). */
export function folderTrail(folders: readonly PrintFolder[], id: number | null): PrintFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: PrintFolder[] = [];
  const seen = new Set<number>();
  let cur = id != null ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = cur.parentId != null ? byId.get(cur.parentId) : undefined; }
  return out;
}

/** `id` and every folder inside it, at any depth. */
export function folderAndBelow(folders: readonly PrintFolder[], id: number): Set<number> {
  const kids = new Map<number, number[]>();
  for (const f of folders) if (f.parentId != null) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f.id]);
  const out = new Set<number>([id]);
  const stack = [id];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) if (!out.has(k)) { out.add(k); stack.push(k); }
  return out;
}

/** The group filters the explorer combines ("Intake + PETG + To print"). Unset means any. */
export interface PrintFilters {
  /** A robot id, or 'none' for files on no robot. */
  robot?: number | 'none';
  season?: number;
  subsystem?: string;
  material?: string;
  status?: PrintStatus;
  collection?: number;
  query?: string;
}
export type FilterKey = Exclude<keyof PrintFilters, 'query'>;
export const FILTER_KEYS: readonly FilterKey[] = ['robot', 'season', 'subsystem', 'material', 'status', 'collection'];
export const hasGroupFilter = (f: PrintFilters) => FILTER_KEYS.some((k) => f[k] !== undefined);

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Does a file match every filter set? The query matches its name, notes, subsystem, material or CAD part. */
export function matchesFilters(file: PrintFile, f: PrintFilters): boolean {
  if (f.robot === 'none' ? file.robotId != null : f.robot !== undefined && file.robotId !== f.robot) return false;
  if (f.season !== undefined && file.season !== f.season) return false;
  if (f.subsystem !== undefined && (file.subsystem ?? '').toLowerCase() !== f.subsystem.toLowerCase()) return false;
  if (f.material !== undefined && (file.material ?? '').toLowerCase() !== f.material.toLowerCase()) return false;
  if (f.status !== undefined && file.status !== f.status) return false;
  if (f.collection !== undefined && !file.collections.includes(f.collection)) return false;
  const q = fold(f.query?.trim() ?? '');
  if (q) {
    const hay = fold([file.name, file.notes, file.subsystem, file.material, file.cadPart?.name, file.uploadedBy].filter(Boolean).join(' \u0001 '));
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** Counts for a group: files, files still to print, and copies left (where copies are known). */
export function groupCounts(files: readonly PrintFile[]) {
  let toPrint = 0, printing = 0, printed = 0, failed = 0, copiesLeft = 0;
  for (const f of files) {
    if (f.status === 'to_print') toPrint++;
    else if (f.status === 'printing') printing++;
    else if (f.status === 'printed') printed++;
    else failed++;
    if (f.copiesNeeded != null) copiesLeft += Math.max(0, f.copiesNeeded - f.copiesPrinted);
  }
  return { files: files.length, stillToPrint: toPrint + failed, toPrint, printing, printed, failed, copiesLeft };
}

/** "Intake · 12 files · 4 still to print" (the label first, when given). */
export function groupLine(label: string | null, files: readonly PrintFile[]): string {
  const c = groupCounts(files);
  const parts = [`${c.files} file${c.files === 1 ? '' : 's'}`];
  if (c.files) parts.push(c.stillToPrint ? `${c.stillToPrint} still to print` : 'all printed or printing');
  return [label, ...parts].filter(Boolean).join(' · ');
}

/** The values a smart group can take in this library, with how many files each holds. Sorted by name. */
export function facetValues(files: readonly PrintFile[], key: 'subsystem' | 'material'): { value: string; count: number }[] {
  const m = new Map<string, { value: string; count: number }>();
  for (const f of files) {
    const v = f[key];
    if (!v) continue;
    const k = v.toLowerCase();
    const hit = m.get(k);
    if (hit) hit.count++; else m.set(k, { value: v, count: 1 });
  }
  return [...m.values()].sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }));
}

export type SortKey = 'name' | 'date' | 'size';
/** Files by the key, then by name. */
export function sortFiles(files: readonly PrintFile[], key: SortKey, dir: 'asc' | 'desc'): PrintFile[] {
  const s = dir === 'asc' ? 1 : -1;
  const byName = (a: PrintFile, b: PrintFile) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => {
    const d = key === 'size' ? a.size - b.size : key === 'date' ? a.updatedAt.localeCompare(b.updatedAt) : byName(a, b);
    return (d || byName(a, b) || a.id - b.id) * s;
  });
}

// ---------------------------------------------------------------------------
// The print queue: what's printing now, then what's up next in the order the
// team will print it.

/** Most pressing first: priority, then the earlier due date (none last), then the older file. */
export function byPriority(a: PrintFile, b: PrintFile): number {
  return PRINT_PRIORITIES.indexOf(a.priority) - PRINT_PRIORITIES.indexOf(b.priority)
    || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
    || a.createdAt.localeCompare(b.createdAt)
    || a.id - b.id;
}

/**
 * The files still to print (To print and Failed), next first. Files a person placed keep their order; the rest slot
 * in by priority and due date, each before the first placed file it beats (an urgent new file goes to the top).
 */
export function queueOrder(files: readonly PrintFile[]): PrintFile[] {
  const waiting = files.filter((f) => stillToPrint(f.status));
  const placed = waiting.filter((f) => f.queuePos != null).sort((a, b) => a.queuePos! - b.queuePos! || a.id - b.id);
  const loose = waiting.filter((f) => f.queuePos == null).sort(byPriority);
  const out: PrintFile[] = [];
  let i = 0;
  for (const p of placed) {
    while (i < loose.length && byPriority(loose[i], p) < 0) out.push(loose[i++]);
    out.push(p);
  }
  return out.concat(loose.slice(i));
}

/** `ids` with `id` moved to `to` (an index in the list as it is now, clamped). */
export function moveInOrder(ids: readonly number[], id: number, to: number): number[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const out = ids.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
  return out;
}

/** Today in the viewer's time zone, "YYYY-MM-DD". */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How a due date stands against `today`: past, today, within the next 3 days, or later. */
export function dueState(due: string | null, today = localDay()): 'overdue' | 'today' | 'soon' | 'later' | null {
  if (!due) return null;
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  const [y, m, d] = today.split('-').map(Number);
  return due <= localDay(new Date(y, m - 1, d + 3)) ? 'soon' : 'later';
}

/** "Due Nov 3", "Due today", "Overdue · Oct 28" (the year when it isn't this one). */
export function dueText(due: string, today = localDay()): string {
  const [y, m, d] = due.split('-').map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(String(y) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
  const s = dueState(due, today);
  return s === 'overdue' ? `Overdue · ${day}` : s === 'today' ? 'Due today' : `Due ${day}`;
}
