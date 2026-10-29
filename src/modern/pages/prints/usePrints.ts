// The Prints library's data: one GET for the whole library (folders, files
// with their details, collections, robots), then small writes that reload it.
// Everything the explorer shows (a folder, a group, a search) is worked out
// from that one answer, so moving between views is instant on a phone.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../services/api';
import { canPreview, printKind, type PrintFile, type PrintLibrary, type PrintStatus } from '../../../types/prints';

export type BulkAction =
  | { action: 'move'; folderId: number | null }
  | { action: 'status'; status: PrintStatus }
  | { action: 'delete' }
  | { action: 'collect' | 'uncollect'; collectionId: number };

export class PrintsError extends Error {
  constructor(message: string, public status: number, public body: any) { super(message); }
}

/** The workspace the open library belongs to, sent with every call so one made after a workspace switch is refused. */
let boundTeam: number | null = null;
async function call<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (boundTeam != null && url !== '/api/prints/library') headers.set('X-CP-Prints-Team', String(boundTeam));
  const r = await apiFetch(url, { ...init, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new PrintsError(body?.error || `Request failed (${r.status})`, r.status, body);
  return body as T;
}
const send = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const fileUrl = (id: number) => `/api/prints/files/${id}/download`;
export const thumbUrl = (f: Pick<PrintFile, 'id' | 'updatedAt'>) => `/api/prints/files/${f.id}/thumbnail?v=${encodeURIComponent(f.updatedAt)}`;
export const folderZipUrl = (folderId: number | null) => `/api/prints/zip?folder=${folderId ?? 'root'}`;
/** Download chosen files as one ZIP: a short-lived ticket names them (a URL can't carry thousands of ids). */
export async function downloadFiles(ids: number[], name: string) {
  const { url } = await call<{ url: string }>('/api/prints/zip', { method: 'POST', body: JSON.stringify({ ids, name }) });
  download(url);
}

/** Start a download by URL (the browser streams it; nothing is held in memory). */
export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface UploadItem { key: string; name: string; state: 'waiting' | 'uploading' | 'done' | 'error'; message?: string }

/** A thumbnail for a model file, drawn in the browser (three.js loads on demand). Null when it can't be drawn. */
export async function thumbnailFor(file: Blob, name: string): Promise<Blob | null> {
  const kind = printKind(name);
  if (!kind || !canPreview(kind) || file.size > 40 * 1024 * 1024) return null;
  try {
    const { drawThumbnail } = await import('../../../components/printModel');
    return await drawThumbnail(await file.arrayBuffer(), kind as 'stl' | '3mf' | 'obj');
  } catch { return null; }
}

export function usePrints() {
  const [lib, setLib] = useState<PrintLibrary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; boundTeam = null; }; }, []);
  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const next = await call<PrintLibrary>('/api/prints/library');
      if (id !== seq.current) return;
      boundTeam = next.teamId;
      setLib(next);
      setState('ready');
    } catch { if (id === seq.current) setState((s) => (s === 'ready' ? s : 'error')); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  /** Run a write, then reload; the error (if any) is thrown back for the caller to show. */
  const write = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } finally { await reload(); }
  }, [reload]);

  return {
    lib, state, reload,
    createFolder: (name: string, parentId: number | null) => write(() => call<{ id: number }>('/api/prints/folders', send('POST', { name, parentId }))),
    updateFolder: (id: number, patch: { name?: string; parentId?: number | null }) => write(() => call(`/api/prints/folders/${id}`, send('PATCH', patch))),
    /** Delete a folder; `files` is the count the person confirmed (a different count now is a 409 with the new one). */
    deleteFolder: (id: number, files?: number) => write(() => call(`/api/prints/folders/${id}${files !== undefined ? `?files=${files}` : ''}`, send('DELETE'))),
    updateFile: (id: number, patch: Record<string, unknown>) => write(() => call<PrintFile>(`/api/prints/files/${id}`, send('PATCH', patch))),
    bulk: (ids: number[], a: BulkAction) => write(() => call<{ files: number }>('/api/prints/files/bulk', send('POST', { ids, ...a }))),
    createCollection: (name: string) => write(() => call<{ id: number; name: string }>('/api/prints/collections', send('POST', { name }))),
    renameCollection: (id: number, name: string) => write(() => call(`/api/prints/collections/${id}`, send('PATCH', { name }))),
    deleteCollection: (id: number) => write(() => call(`/api/prints/collections/${id}`, send('DELETE'))),
    putThumbnail: async (id: number, png: Blob) => {
      const form = new FormData();
      form.append('thumbnail', png, 'thumbnail.png');
      await call(`/api/prints/files/${id}/thumbnail`, { method: 'PUT', body: form });
      await reload();
    },
    activity: (fileId?: number) => call<{ id: number; fileId: number | null; by: string; action: string; detail: any; at: string }[]>(`/api/prints/activity${fileId ? `?file=${fileId}` : ''}`),
    /**
     * Upload files one at a time into a folder, drawing a thumbnail for each model first. `onItem` reports
     * progress; the ids of the files stored come back (for applying the open group's details).
     */
    upload: async (files: File[], folderId: number | null, onItem: (items: UploadItem[]) => void): Promise<{ id: number; name: string; renamed: boolean }[]> => {
      const items: UploadItem[] = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, state: 'waiting' }));
      const update = (i: number, patch: Partial<UploadItem>) => { items[i] = { ...items[i], ...patch }; onItem([...items]); };
      onItem([...items]);
      const stored: { id: number; name: string; renamed: boolean }[] = [];
      for (let i = 0; i < files.length; i++) {
        // Leaving the page stops the queue; the files already sent stay.
        if (!alive.current) break;
        const f = files[i];
        if (!printKind(f.name)) { update(i, { state: 'error', message: 'Not a print file (STL, 3MF, STEP, OBJ or G-code)' }); continue; }
        if (lib && f.size > lib.usage.maxFile) { update(i, { state: 'error', message: `Over the ${Math.round(lib.usage.maxFile / 1048576)} MB limit` }); continue; }
        update(i, { state: 'uploading' });
        try {
          const thumb = await thumbnailFor(f, f.name);
          const form = new FormData();
          // The name as a text field: multipart file names lose non-ASCII characters on the way.
          form.append('name', f.name);
          if (folderId != null) form.append('folderId', String(folderId));
          form.append('file', f, f.name);
          if (thumb) form.append('thumbnail', thumb, 'thumbnail.png');
          const r = await call<{ id: number; name: string; renamed: boolean }>('/api/prints/files', { method: 'POST', body: form });
          stored.push(r);
          update(i, { state: 'done', message: r.renamed ? `Saved as ${r.name}` : undefined });
        } catch (e: any) {
          update(i, { state: 'error', message: e?.message || 'Upload failed' });
          // Out of room, or a workspace switch: the rest stop too (they'd land nowhere, or in the other workspace).
          if (e instanceof PrintsError && (e.body?.code === 'quota' || e.body?.code === 'disk_full' || e.body?.code === 'workspace_changed')) {
            const why = e.body?.code === 'workspace_changed' ? 'Not uploaded: you switched workspaces' : 'Not uploaded: no room left';
            for (let j = i + 1; j < files.length; j++) update(j, { state: 'error', message: why });
            break;
          }
        }
      }
      await reload();
      return stored;
    },
  };
}
export type Prints = ReturnType<typeof usePrints>;
