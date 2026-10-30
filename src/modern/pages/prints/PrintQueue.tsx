// The print queue: what's on a printer now, then what's up next in the order
// the team will print it. Up next starts in priority order (then due date);
// dragging a file, or Alt+↑/↓ on it, or its menu's Move items, saves an order
// the whole workspace shares. Files nobody has placed slot in by priority
// (queueOrder() in src/types/prints.ts). The view is ?view=queue.
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Check, GripVertical, ListFilter, ListOrdered, MoreHorizontal, RotateCcw, XCircle } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/ui-kit';
import { cn } from '../../../components/cn';
import { confirmDialog } from '../../../components/dialog';
import {
  PRINT_PRIORITIES, PRIORITY_LABELS, byPriority, dueText, folderTrail, moveInOrder, queueOrder, type PrintFile, type PrintLibrary, type PrintPriority, type PrintStatus,
} from '../../../types/prints';
import { EmptyState } from '../../ui/page';
import { DueChip, FileArt, PriorityChip, StatusChip, copiesText } from './printsUi';
import type { Prints } from './usePrints';

/** "3 printing · 5 up next" */
export function queueSummary(files: readonly PrintFile[]): string {
  const printing = files.filter((f) => f.status === 'printing').length;
  const next = queueOrder(files).length;
  return [printing ? `${printing} printing` : '', `${next} up next`].filter(Boolean).join(' · ');
}

export function PrintQueue({ lib, prints, onOpen, onStatus, onError, onAnnounce, onBrowse, uploads }: {
  lib: PrintLibrary; prints: Prints;
  onOpen: (id: number) => void;
  onStatus: (ids: number[], status: PrintStatus) => Promise<void>;
  onError: (e: unknown) => void;
  onAnnounce: (message: string) => void;
  /** Opens folders and groups on a phone. */
  onBrowse: () => void;
  /** The upload progress panel, while uploads run or report. */
  uploads?: ReactNode;
}) {
  const canEdit = lib.canEdit;
  // The order as the person just left it, shown until the saved one comes back.
  const [pending, setPending] = useState<number[] | null>(null);
  const saving = useRef(0);
  const saves = useRef<Promise<void>>(Promise.resolve());
  /**
   * Save an order (or [] for priority order) after the saves before it, so an older one never lands last. A save a
   * newer move replaced while it waited isn't sent: the newer one carries the whole order. Resolves once sent or skipped.
   */
  const saveOrder = (ids: number[]) => {
    const seq = ++saving.current;
    const run = saves.current.then(() => (seq === saving.current ? prints.setQueueOrder(ids).then(() => {}) : undefined));
    saves.current = run.catch(() => {});
    return run.finally(() => { if (saving.current === seq) setPending(null); });
  };
  const [drag, setDrag] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ id: number; after: boolean } | null>(null);
  const focusAfter = useRef<number | null>(null);
  const handles = useRef(new Map<number, HTMLButtonElement>());

  const computed = queueOrder(lib.files);
  const byId = new Map(computed.map((f) => [f.id, f]));
  const upNext = pending ? [...pending.map((id) => byId.get(id)).filter((f): f is PrintFile => !!f), ...computed.filter((f) => !pending.includes(f.id))] : computed;
  const printing = lib.files.filter((f) => f.status === 'printing').sort(byPriority);
  const placed = computed.some((f) => f.queuePos != null);

  // A row moved by keyboard keeps the focus.
  useLayoutEffect(() => {
    if (focusAfter.current == null) return;
    handles.current.get(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  const reorder = async (id: number, to: number) => {
    const ids = upNext.map((f) => f.id);
    const next = moveInOrder(ids, id, to);
    if (next.every((x, i) => x === ids[i])) return;
    const name = byId.get(id)?.name ?? 'File';
    setPending(next);
    onAnnounce(`${name} is now ${next.indexOf(id) + 1} of ${next.length}`);
    try { await saveOrder(next); } catch (e) { onError(e); }
  };
  const resetOrder = async () => {
    if (!(await confirmDialog({ title: 'Go back to priority order?', message: 'The order people dragged is cleared for everyone. Files line up by priority, then due date.', confirmLabel: 'Use priority order' }))) return;
    try { await saveOrder([]); onAnnounce('The queue is in priority order'); } catch (e) { onError(e); }
  };
  const setPriority = async (f: PrintFile, priority: PrintPriority) => {
    try { await prints.updateFile(f.id, { priority }); onAnnounce(`${f.name} is ${PRIORITY_LABELS[priority].toLowerCase()} priority`); } catch (e) { onError(e); }
  };

  // ---- Drag and drop (Up next only) ----
  const dropProps = (f: PrintFile, index: number) => ({
    onDragOver: (e: DragEvent) => {
      if (drag == null) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (dropAt?.id !== f.id || dropAt.after !== after) setDropAt({ id: f.id, after });
    },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropAt((d) => (d?.id === f.id ? null : d)); },
    onDrop: (e: DragEvent) => {
      if (drag == null) return;
      e.preventDefault();
      e.stopPropagation();
      const from = upNext.findIndex((x) => x.id === drag);
      let to = index + (dropAt?.id === f.id && dropAt.after ? 1 : 0);
      if (from < to) to--;
      setDrag(null);
      setDropAt(null);
      void reorder(drag, to);
    },
  });
  const onRowKey = (f: PrintFile, index: number) => (e: KeyboardEvent) => {
    if (!canEdit || !e.altKey) return;
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? upNext.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    focusAfter.current = f.id;
    void reorder(f.id, to);
  };

  const where = (f: PrintFile) => folderTrail(lib.folders, f.folderId).map((x) => x.name).join(' / ') || 'Top level';
  const meta = (f: PrintFile) => [where(f), f.subsystem, f.material, copiesText(f)].filter(Boolean).join(' · ');
  const chips = (f: PrintFile) => (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 max-sm:hidden">
      {f.dueDate && <DueChip due={f.dueDate} />}
      {f.priority !== 'normal' && <PriorityChip priority={f.priority} />}
      {f.status === 'failed' && <StatusChip status="failed" />}
    </span>
  );
  const fileName = (f: PrintFile) => {
    // On a phone the chips become words in the line under the name.
    const tags = [f.dueDate ? dueText(f.dueDate) : null, f.priority !== 'normal' ? PRIORITY_LABELS[f.priority] : null, f.status === 'failed' ? 'Failed' : null].filter(Boolean);
    return (
      <button type="button" onClick={() => onOpen(f.id)} className="min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        <span className="block truncate text-sm font-medium">{f.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {tags.length > 0 && <span className="sm:hidden">{tags.join(' · ')} · </span>}
          {meta(f)}
        </span>
      </button>
    );
  };

  const menu = (f: PrintFile, index: number | null) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 shrink-0 md:size-8" aria-label={`${f.name} options`}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => onOpen(f.id)}>Details</DropdownMenuItem>
        {canEdit && index !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Move</DropdownMenuLabel>
            <DropdownMenuItem disabled={index === 0} onSelect={() => void reorder(f.id, 0)}>To the top</DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onSelect={() => void reorder(f.id, index - 1)}>Up one</DropdownMenuItem>
            <DropdownMenuItem disabled={index === upNext.length - 1} onSelect={() => void reorder(f.id, index + 1)}>Down one</DropdownMenuItem>
            <DropdownMenuItem disabled={index === upNext.length - 1} onSelect={() => void reorder(f.id, upNext.length - 1)}>To the bottom</DropdownMenuItem>
          </>
        )}
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Priority</DropdownMenuLabel>
            {PRINT_PRIORITIES.filter((p) => p !== f.priority).map((p) => <DropdownMenuItem key={p} onSelect={() => void setPriority(f, p)}>{PRIORITY_LABELS[p]}</DropdownMenuItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Mark as</DropdownMenuLabel>
            {f.status !== 'printing' && <DropdownMenuItem onSelect={() => void onStatus([f.id], 'printing')}>Printing</DropdownMenuItem>}
            {f.status === 'printing' && <DropdownMenuItem onSelect={() => void onStatus([f.id], 'to_print')}>Back to up next</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => void onStatus([f.id], 'printed')}>Printed</DropdownMenuItem>
            {f.status !== 'failed' && <DropdownMenuItem onSelect={() => void onStatus([f.id], 'failed')}>Failed or reprint</DropdownMenuItem>}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <section aria-label="Print queue" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-10 md:hidden" onClick={onBrowse}><ListFilter /> Folders and groups</Button>
          <h2 className="min-w-0 text-base font-semibold">Print queue <span className="font-normal text-muted-foreground">· {queueSummary(lib.files)}</span></h2>
        </div>
        {canEdit && placed && <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => void resetOrder()}><RotateCcw /> Priority order</Button>}
      </div>
      {uploads}

      {printing.length === 0 && upNext.length === 0 ? (
        <EmptyState icon={ListOrdered} title="Nothing to print" description="Files marked To print or Failed line up here, most pressing first. Set a file's priority and due date in its details." />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {printing.length > 0 && (
            <div>
              <h3 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Printing now</h3>
              <ul aria-label="Printing now" className="overflow-hidden rounded-xl border border-border">
                {printing.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                    <span className="hidden w-16 md:block" aria-hidden />
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#1b1b1f]"><FileArt file={f} className="size-full" /></span>
                    {fileName(f)}
                    {chips(f)}
                    {canEdit && (
                      <span className="flex shrink-0 gap-1.5 max-md:hidden">
                        <Button size="sm" variant="outline" className="h-8" onClick={() => void onStatus([f.id], 'printed')}><Check /> Printed</Button>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => void onStatus([f.id], 'failed')}><XCircle /> Failed</Button>
                      </span>
                    )}
                    {menu(f, null)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Up next</h3>
            {upNext.length === 0 ? <p className="px-1 text-sm text-muted-foreground">Nothing waiting. Files marked To print or Failed line up here.</p> : (
              <ol aria-label="Up next" className="overflow-hidden rounded-xl border border-border">
                {upNext.map((f, i) => (
                  <li key={f.id} draggable={canEdit} onKeyDown={onRowKey(f, i)} {...dropProps(f, i)}
                    onDragStart={(e) => { if (!canEdit) return; e.dataTransfer.setData('text/plain', f.name); e.dataTransfer.effectAllowed = 'move'; setDrag(f.id); }}
                    onDragEnd={() => { setDrag(null); setDropAt(null); }}
                    className={cn('relative flex items-center gap-3 border-b border-border bg-background px-3 py-1.5 last:border-b-0', canEdit && 'hover:bg-muted/40', drag === f.id && 'opacity-50')}>
                    {dropAt?.id === f.id && drag !== f.id && <span className={cn('pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-accent', dropAt.after ? '-bottom-px' : '-top-px')} aria-hidden />}
                    {canEdit ? (
                      <button type="button" ref={(el) => { if (el) handles.current.set(f.id, el); else handles.current.delete(f.id); }}
                        aria-label={`${f.name}, ${i + 1} of ${upNext.length}. Alt+Up or Alt+Down moves it`}
                        className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing max-md:hidden">
                        <GripVertical className="size-4" />
                      </button>
                    ) : null}
                    <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground" aria-hidden={canEdit}>{i + 1}</span>
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#1b1b1f]"><FileArt file={f} className="size-full" /></span>
                    {fileName(f)}
                    {chips(f)}
                    {menu(f, i)}
                  </li>
                ))}
              </ol>
            )}
          </div>
          {canEdit && upNext.length > 1 && (
            <p className="hidden text-xs text-muted-foreground md:block">Drag files into the order you'll print them, or press Alt+↑/↓. Everyone sees the same order. Files nobody has placed slot in by priority, then due date.</p>
          )}
        </div>
      )}
    </section>
  );
}
