// The explorer's sidebar: folders (where a file lives) and groups (how the
// team thinks about it) side by side. Smart groups are worked out from each
// file's details; collections are the team's own. Picking a group filters the
// library; picks in different groups combine ("Intake + PETG + To print").
// Folders and collections take dropped files. The print queue sits on top.
import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { ChevronRight, Library, ListOrdered, MoreHorizontal, Plus } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui-kit';
import { cn } from '../../../components/cn';
import { seasonName } from '../../../types/cadBom';
import {
  PRINT_STATUSES, STATUS_LABELS, dueState, facetValues, matchesFilters, stillToPrint, type FilterKey, type PrintFilters, type PrintFolder, type PrintLibrary,
} from '../../../types/prints';
import { FolderArt, STATUS_DOT } from './printsUi';

export interface DropHandlers {
  /** Props that make an element accept dragged prints (and, for folders, files from the computer). */
  target: (key: string, accepts?: { folders?: boolean; os?: boolean }) => {
    onDragOver: (e: DragEvent) => void; onDragLeave: (e: DragEvent) => void; onDrop: (e: DragEvent) => void; 'data-drop'?: string;
  };
  over: string | null;
}

function Item({ active, onClick, icon, label, count, sub, depth = 0, drop, over, menu, expand, children }: {
  active: boolean; onClick: () => void; icon?: ReactNode; label: ReactNode; count?: number; sub?: string; depth?: number;
  drop?: ReturnType<DropHandlers['target']>; over?: boolean; menu?: ReactNode; expand?: ReactNode; children?: ReactNode;
}) {
  return (
    <li className="group/item relative" {...(drop ?? {})}>
      <div className={cn('flex items-center rounded-lg', active ? 'bg-accent/15 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground', over && 'ring-2 ring-accent')}
        style={{ paddingLeft: depth * 14 }}>
        {expand ?? <span className="w-1 shrink-0" />}
        <button type="button" onClick={onClick} aria-pressed={active}
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:min-h-8">
          {icon}
          <span className={cn('min-w-0 flex-1 truncate', active && 'font-medium')}>{label}</span>
          {(sub || count !== undefined) && <span className="sr-only">: </span>}
          {sub && <span className="shrink-0 text-xs text-orange-600 dark:text-orange-300">{sub}<span className="sr-only">, </span></span>}
          {count !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}<span className="sr-only"> {count === 1 ? 'file' : 'files'}</span></span>}
        </button>
        {menu}
      </div>
      {children}
    </li>
  );
}

function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1 mt-5 flex items-center justify-between px-2 first:mt-0">
      <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

export function PrintsSidebar({ lib, folderId, filters, groupMode, queueMode, onQueue, onFolder, onToggle, drop, onNewCollection, onRenameCollection, onDeleteCollection }: {
  lib: PrintLibrary; folderId: number | null; filters: PrintFilters; groupMode: boolean; queueMode: boolean;
  onQueue: () => void;
  onFolder: (id: number | null) => void;
  /** Toggle one smart group or collection; picks in different groups combine. */
  onToggle: <K extends FilterKey>(key: K, value: PrintFilters[K]) => void;
  drop: DropHandlers;
  onNewCollection: () => void; onRenameCollection: (id: number) => void; onDeleteCollection: (id: number) => void;
}) {
  // Folders opened or closed by hand; the folders holding the open one start open.
  const [toggled, setToggled] = useState<Map<number, boolean>>(() => new Map());
  const kids = useMemo(() => {
    const m = new Map<number | null, PrintFolder[]>();
    for (const f of [...lib.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))) m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]);
    return m;
  }, [lib.folders]);
  const holdsCurrent = useMemo(() => {
    const s = new Set<number>();
    const byId = new Map(lib.folders.map((f) => [f.id, f]));
    let cur = folderId != null ? byId.get(folderId) : undefined;
    while (cur?.parentId != null) { s.add(cur.parentId); cur = byId.get(cur.parentId); }
    return s;
  }, [folderId, lib.folders]);
  // Counts follow the other picks, so each number says what picking it would show.
  const countFor = (key: FilterKey, value: unknown) => lib.files.filter((f) => matchesFilters(f, { ...filters, query: undefined, [key]: value })).length;
  const toPrintIn = (key: FilterKey, value: unknown) => lib.files.filter((f) => matchesFilters(f, { ...filters, query: undefined, [key]: value }) && stillToPrint(f.status)).length;

  const folderItem = (f: PrintFolder, depth: number): ReactNode => {
    const children = kids.get(f.id) ?? [];
    const expanded = toggled.get(f.id) ?? holdsCurrent.has(f.id);
    const active = !groupMode && folderId === f.id;
    return (
        <Item key={f.id} depth={depth} active={active} onClick={() => onFolder(f.id)} icon={<FolderArt open={active} className="size-4 shrink-0" />} label={f.name}
          over={drop.over === `folder:${f.id}`}
          drop={drop.target(`folder:${f.id}`, { folders: true, os: true })}
          expand={children.length ? (
            <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${f.name}`} aria-expanded={expanded}
              onClick={() => setToggled((m) => new Map(m).set(f.id, !expanded))}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:size-6">
              <ChevronRight className={cn('size-3.5 transition-transform motion-reduce:transition-none', expanded && 'rotate-90')} />
            </button>
          ) : <span className="w-8 shrink-0 md:w-6" />}>
          {expanded && children.length > 0 && <ul>{children.map((c) => folderItem(c, depth + 1))}</ul>}
        </Item>
    );
  };

  const seasons = useMemo(() => {
    const m = new Map<number, { season: number; robots: typeof lib.robots }>();
    for (const r of lib.robots) { const s = m.get(r.season) ?? { season: r.season, robots: [] }; s.robots.push(r); m.set(r.season, s); }
    for (const f of lib.files) if (f.season != null && !m.has(f.season)) m.set(f.season, { season: f.season, robots: [] });
    return [...m.values()].sort((a, b) => b.season - a.season);
  }, [lib]);
  const subsystems = facetValues(lib.files, 'subsystem');
  const materials = facetValues(lib.files, 'material');
  const noRobot = lib.files.filter((f) => f.robotId == null).length;
  const queued = lib.files.filter((f) => stillToPrint(f.status) || f.status === 'printing');
  const overdue = queued.filter((f) => dueState(f.dueDate) === 'overdue').length;

  return (
    <nav aria-label="Folders and groups" className="text-sm">
      <ul>
        <Item active={queueMode} onClick={onQueue} icon={<ListOrdered className="size-4 shrink-0 text-[#b38b00] dark:text-[#ffc700]" />} label="Print queue"
          sub={overdue ? `${overdue} overdue` : undefined} count={queued.length} />
      </ul>

      <Heading>Folders</Heading>
      <ul>
        <Item active={!groupMode && !queueMode && folderId === null} onClick={() => onFolder(null)} icon={<Library className="size-4 shrink-0 text-[#b38b00] dark:text-[#ffc700]" />}
          label="All prints" count={lib.files.length} over={drop.over === 'folder:root'} drop={drop.target('folder:root', { folders: true, os: true })} />
        {(kids.get(null) ?? []).map((f) => folderItem(f, 1))}
      </ul>

      <Heading>Print status</Heading>
      <ul>
        {PRINT_STATUSES.map((s) => (
          <Item key={s} active={filters.status === s} onClick={() => onToggle('status', s)} label={STATUS_LABELS[s]} count={countFor('status', s)}
            icon={<span className={cn('ml-1 size-2 shrink-0 rounded-full', STATUS_DOT[s])} aria-hidden />} />
        ))}
      </ul>

      {(seasons.length > 0 || noRobot < lib.files.length) && (
        <>
          <Heading>Seasons and robots</Heading>
          <ul>
            {seasons.map((s) => (
              <Item key={s.season} active={filters.season === s.season} onClick={() => onToggle('season', s.season)} label={seasonName(s.season)} count={countFor('season', s.season)}>
                {s.robots.length > 0 && (
                  <ul>
                    {s.robots.map((r) => (
                      <Item key={r.id} depth={1} active={filters.robot === r.id} onClick={() => onToggle('robot', r.id)} label={r.name} count={countFor('robot', r.id)} />
                    ))}
                  </ul>
                )}
              </Item>
            ))}
            {noRobot > 0 && noRobot < lib.files.length && <Item active={filters.robot === 'none'} onClick={() => onToggle('robot', 'none')} label="No robot" count={countFor('robot', 'none')} />}
          </ul>
        </>
      )}

      <Heading>Subsystems</Heading>
      {subsystems.length ? (
        <ul>
          {subsystems.map((v) => {
            const left = toPrintIn('subsystem', v.value);
            return <Item key={v.value} active={filters.subsystem?.toLowerCase() === v.value.toLowerCase()} onClick={() => onToggle('subsystem', v.value)} label={v.value}
              sub={left ? `${left} to print` : undefined} count={countFor('subsystem', v.value)} />;
          })}
        </ul>
      ) : <p className="px-2 text-xs text-muted-foreground">Set a file's subsystem, or link its CAD part.</p>}

      <Heading>Materials</Heading>
      {materials.length ? (
        <ul>{materials.map((v) => <Item key={v.value} active={filters.material?.toLowerCase() === v.value.toLowerCase()} onClick={() => onToggle('material', v.value)} label={v.value} count={countFor('material', v.value)} />)}</ul>
      ) : <p className="px-2 text-xs text-muted-foreground">Set a file's material to group by it.</p>}

      <Heading action={lib.canEdit ? (
        <Button size="icon" variant="ghost" className="size-8 md:size-6" aria-label="New collection" onClick={onNewCollection}><Plus /></Button>
      ) : undefined}>Collections</Heading>
      {lib.collections.length ? (
        <ul>
          {lib.collections.map((c) => (
            <Item key={c.id} active={filters.collection === c.id} onClick={() => onToggle('collection', c.id)} label={c.name} count={countFor('collection', c.id)}
              icon={<span className="ml-1 size-2 shrink-0 rotate-45 rounded-[2px] bg-[#ffc700]" aria-hidden />}
              over={drop.over === `collection:${c.id}`} drop={lib.canEdit ? drop.target(`collection:${c.id}`) : undefined}
              menu={lib.canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`${c.name} options`} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:size-6 md:opacity-0 md:group-hover/item:opacity-100 md:focus-visible:opacity-100">
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onRenameCollection(c.id)}>Rename</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDeleteCollection(c.id)} className="text-destructive">Delete collection</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : undefined} />
          ))}
        </ul>
      ) : <p className="px-2 text-xs text-muted-foreground">{lib.canEdit ? 'Make groups like "Comp spares" or "Worlds kit" and drag files onto them.' : 'No collections yet.'}</p>}
    </nav>
  );
}
