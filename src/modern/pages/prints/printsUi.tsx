// Small pieces of the Prints explorer: status chips, file icons and
// thumbnails, and the dialogs for naming, moving and collecting.
import { useMemo, useState, type ReactNode } from 'react';
import { Box, ChevronRight, FileCode2, Folder, FolderOpen, Layers } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '../../../components/ui-kit';
import { cn } from '../../../components/cn';
import { KIND_LABELS, STATUS_LABELS, folderAndBelow, type PrintFile, type PrintFolder, type PrintKind, type PrintStatus } from '../../../types/prints';
import { thumbUrl } from './usePrints';

export const STATUS_DOT: Record<PrintStatus, string> = {
  to_print: 'bg-orange-400', printing: 'bg-sky-400', printed: 'bg-emerald-500', failed: 'bg-rose-500',
};
const STATUS_CHIP: Record<PrintStatus, string> = {
  to_print: 'border-orange-400/40 bg-orange-400/10 text-orange-700 dark:text-orange-300',
  printing: 'border-sky-400/40 bg-sky-400/10 text-sky-700 dark:text-sky-300',
  printed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export function StatusChip({ status, className }: { status: PrintStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_CHIP[status], className)}>
      <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />{STATUS_LABELS[status]}
    </span>
  );
}

/** "2 of 4 printed" when the copies are known. */
export function copiesText(f: PrintFile): string | null {
  if (f.copiesNeeded == null) return f.copiesPrinted ? `${f.copiesPrinted} printed` : null;
  return `${Math.min(f.copiesPrinted, 999)} of ${f.copiesNeeded} printed`;
}

const KIND_TINT: Record<PrintKind, string> = {
  stl: 'text-[#b38b00] dark:text-[#ffc700]', '3mf': 'text-[#b38b00] dark:text-[#ffc700]', obj: 'text-[#b38b00] dark:text-[#ffc700]',
  step: 'text-sky-600 dark:text-sky-300', gcode: 'text-emerald-600 dark:text-emerald-300',
};

/** A file's picture: its thumbnail when it has one, else an icon for its kind with the format under it. */
export function FileArt({ file, size = 'sm', className }: { file: PrintFile; size?: 'sm' | 'lg'; className?: string }) {
  const [broken, setBroken] = useState(false);
  const Icon = file.kind === 'gcode' ? FileCode2 : file.kind === 'step' ? Layers : Box;
  if (file.hasThumb && !broken) {
    return <img src={thumbUrl(file)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className={cn('object-contain', className)} />;
  }
  return (
    <span className={cn('flex flex-col items-center justify-center gap-1', className)} aria-hidden>
      <Icon className={cn(size === 'lg' ? 'size-10' : 'size-5', KIND_TINT[file.kind])} strokeWidth={1.6} />
      {size === 'lg' && <span className="text-[11px] font-medium tracking-wide text-muted-foreground">{KIND_LABELS[file.kind]}</span>}
    </span>
  );
}

export function FolderArt({ open, className }: { open?: boolean; className?: string }) {
  const I = open ? FolderOpen : Folder;
  return <I className={cn('text-[#b38b00] dark:text-[#ffc700]', className)} strokeWidth={1.6} aria-hidden />;
}

/** One line of text asked for: a new folder or collection, or a rename. */
export function NameDialog({ title, description, label, initial = '', confirm, onClose, onSave, maxLength = 120 }: {
  title: string; description?: ReactNode; label: string; initial?: string; confirm: string; maxLength?: number;
  onClose: () => void; onSave: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const err = await onSave(name.trim()).finally(() => setBusy(false));
    if (err) setError(err); else onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Label htmlFor="prints-name">{label}</Label>
          <Input id="prints-name" value={name} maxLength={maxLength} autoFocus aria-invalid={!!error || undefined} aria-describedby={error ? 'prints-name-error' : undefined}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onFocus={(e) => { const dot = e.target.value.lastIndexOf('.'); if (dot > 0 && initial) e.target.setSelectionRange(0, dot); }} />
          {error && <p id="prints-name-error" className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || busy}>{busy ? 'Saving…' : confirm}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pick a destination folder (the keyboard and phone way to move; drag and drop does the same). */
export function MoveDialog({ folders, count, exclude, current, onClose, onMove }: {
  folders: PrintFolder[]; count: string;
  /** Where it is now; undefined when the files come from several folders. */
  current: number | null | undefined;
  /** Folders being moved: they and everything inside them can't be the destination. */
  exclude?: number[];
  onClose: () => void; onMove: (folderId: number | null) => Promise<void>;
}) {
  const [pick, setPick] = useState<number | null>(current ?? null);
  const [busy, setBusy] = useState(false);
  const blocked = useMemo(() => {
    const s = new Set<number>();
    for (const id of exclude ?? []) for (const x of folderAndBelow(folders, id)) s.add(x);
    return s;
  }, [folders, exclude]);
  const kids = useMemo(() => {
    const m = new Map<number | null, PrintFolder[]>();
    for (const f of [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))) m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]);
    return m;
  }, [folders]);
  const row = (f: PrintFolder | null, depth: number): ReactNode => {
    const id = f?.id ?? null;
    const disabled = id != null && blocked.has(id);
    return (
      <li key={id ?? 'root'}>
        <label className={cn('flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted/60', pick === id && 'bg-accent/15', disabled && 'cursor-not-allowed opacity-50')}
          style={{ paddingLeft: 8 + depth * 18 }}>
          <input type="radio" name="prints-move" className="size-4 accent-[#ffc700]" checked={pick === id} disabled={disabled} onChange={() => setPick(id)} />
          <FolderArt className="size-4 shrink-0" />
          <span className="truncate">{f ? f.name : 'Prints (top level)'}</span>
          {id === current && <span className="ml-auto shrink-0 text-xs text-muted-foreground">current</span>}
        </label>
        {(kids.get(id) ?? []).length > 0 && <ul>{(kids.get(id) ?? []).map((k) => row(k, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Move {count}</DialogTitle>
          <DialogDescription>Choose where it lives. Its groups and collections stay the same.</DialogDescription>
        </DialogHeader>
        <fieldset className="min-h-0 overflow-y-auto rounded-xl border border-border p-1" style={{ maxHeight: '50vh' }}>
          <legend className="sr-only">Destination folder</legend>
          <ul>{row(null, 0)}</ul>
        </fieldset>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || pick === current} onClick={async () => { setBusy(true); try { await onMove(pick); onClose(); } finally { setBusy(false); } }}>
            {busy ? 'Moving…' : 'Move here'} <ChevronRight />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
