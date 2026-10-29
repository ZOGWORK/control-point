// One print file's details, in a side sheet: what it is, where it lives, who
// added it, and the details its smart groups come from (robot and season, CAD
// part, subsystem, material, status, copies), plus its collections, notes and
// history. People without manage_prints see the same details read-only.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Download, ExternalLink, FolderInput, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea } from '../../../components/ui-kit';
import { cn } from '../../../components/cn';
import { apiFetch } from '../../../services/api';
import { fmtDate } from '../../../components/cad/useCad';
import { currentSeason, seasonName } from '../../../types/cadBom';
import {
  KIND_LABELS, PRINT_MATERIALS, PRINT_STATUSES, STATUS_LABELS, canPreview, folderTrail, formatBytes, type PrintFile, type PrintLibrary,
} from '../../../types/prints';
import { FileArt, STATUS_DOT, copiesText } from './printsUi';
import { download, fileUrl, type Prints } from './usePrints';

const field = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60';
const ACTION_TEXT: Record<string, string> = {
  upload: 'added it', replace: 'sent a new version', rename: 'renamed it', move: 'moved it', edit: 'changed its details', status: 'changed its status',
  collect: 'added it to a collection', uncollect: 'took it out of a collection', delete: 'deleted it',
};

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-1.5">
      {htmlFor ? <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label> : <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      {children}
    </div>
  );
}

export function PrintDetails({ file, lib, prints, onClose, onPreview, onRename, onMove, onDelete, onError }: {
  file: PrintFile; lib: PrintLibrary; prints: Prints; onClose: () => void;
  onPreview: () => void; onRename: () => void; onMove: () => void; onDelete: () => void; onError: (message: string) => void;
}) {
  const id = useId();
  const edit = lib.canEdit;
  const [notes, setNotes] = useState(file.notes);
  // Copies printed as clicked: shown at once and saved once the clicks stop (each click reading a stale count lost copies).
  const [copies, setCopies] = useState(file.copiesPrinted);
  const copiesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCopies = useRef<number | null>(null);
  useEffect(() => { if (pendingCopies.current === null) setCopies(file.copiesPrinted); }, [file.id, file.copiesPrinted]);
  const stepCopies = (delta: number) => {
    const next = Math.max(0, Math.min(999, (pendingCopies.current ?? copies) + delta));
    pendingCopies.current = next;
    setCopies(next);
    if (copiesTimer.current) clearTimeout(copiesTimer.current);
    copiesTimer.current = setTimeout(() => {
      const value = pendingCopies.current;
      copiesTimer.current = null;
      if (value === null) return;
      void save({ copiesPrinted: value }).finally(() => { if (pendingCopies.current === value) pendingCopies.current = null; });
    }, 500);
  };
  // A count still waiting when the sheet closes is saved then.
  useEffect(() => () => {
    if (copiesTimer.current) { clearTimeout(copiesTimer.current); if (pendingCopies.current !== null) void prints.updateFile(file.id, { copiesPrinted: pendingCopies.current }).catch(() => {}); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);
  const [parts, setParts] = useState<{ id: number; name: string; section: string; quantity: number; group: string }[] | null>(null);
  const [history, setHistory] = useState<{ id: number; by: string; action: string; detail: any; at: string }[] | null>(null);
  useEffect(() => { setNotes(file.notes); }, [file.id, file.notes]);
  // The linked robot's parts, for the CAD part picker (made parts first).
  useEffect(() => {
    setParts(null);
    if (file.robotId == null) return;
    let live = true;
    apiFetch(`/api/cad/robots/${file.robotId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!live || !d) return;
      const list = (d.parts as any[]).filter((p) => !p.ck_removed_at).map((p) => ({ id: Number(p.id), name: String(p.name), section: String(p.section || ''), quantity: Number(p.quantity) || 0, group: String(p.effective?.group || '') }));
      list.sort((a, b) => Number(b.group === 'make') - Number(a.group === 'make') || a.name.localeCompare(b.name));
      setParts(list);
    }).catch(() => {});
    return () => { live = false; };
  }, [file.robotId]);
  useEffect(() => {
    let live = true;
    setHistory(null);
    prints.activity(file.id).then((h) => { if (live) setHistory(h); }).catch(() => { if (live) setHistory([]); });
    return () => { live = false; };
  // Reload the history when the file changes (updatedAt moves on every save).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, file.updatedAt]);

  const save = async (patch: Record<string, unknown>) => {
    try { await prints.updateFile(file.id, patch); } catch (e: any) { onError(e?.message || "Couldn't save that."); }
  };
  const where = folderTrail(lib.folders, file.folderId).map((f) => f.name);
  const seasons = useMemo(() => {
    const now = currentSeason();
    return [...new Set([now + 1, now, now - 1, now - 2, now - 3, ...lib.robots.map((r) => r.season), ...(file.season != null ? [file.season] : [])])].sort((a, b) => b - a);
  }, [lib.robots, file.season]);
  const subsystemOptions = useMemo(() => [...new Set([...lib.subsystems, ...lib.files.map((f) => f.subsystem).filter(Boolean) as string[]])], [lib]);
  const copiesLabel = copiesText(file);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full gap-5 sm:max-w-md">
        <SheetHeader className="pr-8">
          <SheetTitle className="break-words">{file.name}</SheetTitle>
          <SheetDescription>{KIND_LABELS[file.kind]} · {formatBytes(file.size)} · {where.length ? where.join(' / ') : 'Top level'}</SheetDescription>
        </SheetHeader>

        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-[#1b1b1f]">
          <FileArt file={file} size="lg" className="size-full p-4" />
          {canPreview(file.kind) && (
            <Button size="sm" variant="secondary" className="absolute bottom-3 right-3" onClick={onPreview}><Box /> 3D preview</Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => download(fileUrl(file.id))}><Download /> Download</Button>
          {edit && <Button variant="outline" size="sm" onClick={onRename}><Pencil /> Rename</Button>}
          {edit && <Button variant="outline" size="sm" onClick={onMove}><FolderInput /> Move to…</Button>}
          {edit && <Button variant="outline" size="sm" className="text-destructive" onClick={onDelete}><Trash2 className="size-4" /> Delete</Button>}
        </div>

        <Row label="Print status">
          {edit ? (
            <div role="radiogroup" aria-label="Print status" className="grid grid-cols-2 gap-1.5">
              {PRINT_STATUSES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={file.status === s} onClick={() => file.status !== s && void save({ status: s })}
                  className={cn('flex min-h-10 items-center gap-2 rounded-lg border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                    file.status === s ? 'border-accent bg-accent/15 font-medium' : 'border-border hover:bg-muted/60')}>
                  <span className={cn('size-2 rounded-full', STATUS_DOT[s])} aria-hidden />{STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          ) : <p className="text-sm">{STATUS_LABELS[file.status]}</p>}
        </Row>

        <Row label="Copies">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {edit ? (
              <>
                <Button size="icon" variant="outline" className="size-10" aria-label="One fewer printed" disabled={copies <= 0} onClick={() => stepCopies(-1)}><Minus /></Button>
                <span className="min-w-6 text-center text-base font-semibold tabular-nums" aria-live="polite">{copies}</span>
                <Button size="icon" variant="outline" className="size-10" aria-label="One more printed" disabled={copies >= 999} onClick={() => stepCopies(1)}><Plus /></Button>
                <span className="text-muted-foreground">printed of</span>
                <input id={`${id}-need`} type="number" min={0} max={999} inputMode="numeric" aria-label="Copies the robot needs" className={cn(field, 'w-20')}
                  key={`${file.id}-${file.copiesNeeded}-${file.copiesNeededFrom}`}
                  defaultValue={file.copiesNeededFrom === 'manual' ? String(file.copiesNeeded) : ''}
                  placeholder={file.copiesNeededFrom === 'cad' ? String(file.copiesNeeded) : '–'}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const next = v === '' ? null : Number(v);
                    if (next !== (file.copiesNeededFrom === 'manual' ? file.copiesNeeded : null)) void save({ copiesNeeded: next });
                  }} />
                <span className="text-muted-foreground">needed</span>
              </>
            ) : <span>{copiesLabel ?? "Not counted"}</span>}
          </div>
          {file.copiesNeededFrom === 'cad' && <p className="text-xs text-muted-foreground">The robot needs {file.copiesNeeded}, from the CAD part's quantity.</p>}
        </Row>

        <Row label="Robot" htmlFor={`${id}-robot`}>
          <select id={`${id}-robot`} className={field} disabled={!edit} value={file.robotId ?? ''}
            onChange={(e) => void save({ robotId: e.target.value ? Number(e.target.value) : null, cadPartId: null })}>
            <option value="">No robot</option>
            {lib.robots.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.seasonName}</option>)}
          </select>
        </Row>
        {file.robotId == null && (
          <Row label="Season" htmlFor={`${id}-season`}>
            <select id={`${id}-season`} className={field} disabled={!edit} value={file.season ?? ''} onChange={(e) => void save({ season: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No season</option>
              {seasons.map((s) => <option key={s} value={s}>{seasonName(s)}</option>)}
            </select>
          </Row>
        )}
        {file.robotId != null && (
          <Row label="CAD part it prints" htmlFor={`${id}-part`}>
            <select id={`${id}-part`} className={field} disabled={!edit || parts === null} value={file.cadPart?.id ?? ''} onChange={(e) => void save({ cadPartId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{parts === null ? 'Loading parts…' : 'Not linked'}</option>
              {file.cadPart && !parts?.some((p) => p.id === file.cadPart!.id) && <option value={file.cadPart.id}>{file.cadPart.name}</option>}
              {(parts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.quantity ? ` · ×${p.quantity}` : ''}{p.section && p.section !== 'Other' ? ` · ${p.section}` : ''}</option>)}
            </select>
            {file.cadPart && (
              <a href={`/cad/robots/${file.robotId}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Open the robot's BOM <ExternalLink className="size-3" />
              </a>
            )}
          </Row>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Row label="Subsystem" htmlFor={`${id}-sub`}>
            <input id={`${id}-sub`} list={`${id}-subs`} className={field} disabled={!edit} maxLength={32} key={`${file.id}-${file.subsystem}`}
              defaultValue={file.subsystemFrom === 'manual' ? file.subsystem ?? '' : ''} placeholder={file.subsystemFrom === 'cad' ? file.subsystem ?? '' : 'None'}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (file.subsystemFrom === 'manual' ? file.subsystem ?? '' : '')) void save({ subsystem: v }); }} />
            <datalist id={`${id}-subs`}>{subsystemOptions.map((s) => <option key={s} value={s} />)}</datalist>
          </Row>
          <Row label="Material" htmlFor={`${id}-mat`}>
            <input id={`${id}-mat`} list={`${id}-mats`} className={field} disabled={!edit} maxLength={24} key={`${file.id}-${file.material}`}
              defaultValue={file.material ?? ''} placeholder="None"
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (file.material ?? '')) void save({ material: v }); }} />
            <datalist id={`${id}-mats`}>{PRINT_MATERIALS.map((m) => <option key={m} value={m} />)}</datalist>
          </Row>
        </div>
        {file.subsystemFrom === 'cad' && <p className="-mt-3 text-xs text-muted-foreground">Subsystem {file.subsystem} comes from the CAD part's section. Type one to set it here.</p>}

        <Row label="Collections">
          {lib.collections.length === 0 ? <p className="text-sm text-muted-foreground">No collections yet. Make one in the sidebar.</p> : (
            <ul className="flex flex-wrap gap-1.5">
              {lib.collections.map((c) => {
                const on = file.collections.includes(c.id);
                return (
                  <li key={c.id}>
                    <button type="button" aria-pressed={on} disabled={!edit}
                      onClick={async () => { try { await prints.bulk([file.id], { action: on ? 'uncollect' : 'collect', collectionId: c.id }); } catch (e: any) { onError(e?.message || "Couldn't save that."); } }}
                      className={cn('min-h-9 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default',
                        on ? 'border-accent bg-accent/15 font-medium' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                      {c.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Row>

        <Row label="Notes" htmlFor={`${id}-notes`}>
          <Textarea id={`${id}-notes`} value={notes} readOnly={!edit} maxLength={2000} rows={3} placeholder={edit ? 'Settings, orientation, supports…' : 'No notes'}
            onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== file.notes) void save({ notes }); }} />
        </Row>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Added by</dt><dd>{file.uploadedBy || 'Someone'}{file.source === 'control-kit' ? ' (from Control Kit)' : ''}</dd>
          <dt className="text-muted-foreground">Added</dt><dd>{fmtDate(file.createdAt)}</dd>
          <dt className="text-muted-foreground">Changed</dt><dd>{fmtDate(file.updatedAt)}</dd>
          <dt className="text-muted-foreground">Size</dt><dd>{formatBytes(file.size)}</dd>
        </dl>

        <section aria-label="History">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">History</h3>
          {history === null ? <p className="text-sm text-muted-foreground">Loading…</p> : history.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
            <ol className="grid gap-1.5 text-sm">
              {history.slice(0, 12).map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <span className="min-w-0"><span className="font-medium">{h.by}</span> {ACTION_TEXT[h.action] ?? h.action}{h.action === 'status' && h.detail?.to ? `: ${STATUS_LABELS[h.detail.to as keyof typeof STATUS_LABELS] ?? h.detail.to}` : ''}{(h.action === 'collect' || h.action === 'uncollect') && h.detail?.collection ? ` (${h.detail.collection})` : ''}</span>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={h.at}>{fmtDate(h.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
