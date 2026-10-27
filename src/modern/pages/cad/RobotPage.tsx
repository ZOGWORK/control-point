// One robot: its whole BOM from Control Kit (every line: needs a decision,
// buy, make, fasteners, not needed), the choices people make here, and the
// robot's files, reviews, snapshots and Control Kit sends. A choice made here
// reaches Control Kit at its next scan (contract v1.1 §5); until then the part
// says so.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Check, ClipboardCheck, Trash2, ExternalLink, FileBox, FileCheck2, FileX2, History, Layers, MoreHorizontal, Package, Pencil, Plus, Search,
  Send, Sparkles, Star,
} from 'lucide-react';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, Label, Select, SelectContent,
  SelectItem, SelectTrigger, SelectValue, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTrigger, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui-kit';
import { cn } from '../../../components/cn';
import { useIsNarrow } from '../../../components/scout/ScoutUi';
import { CONTROL_KIT_ICON, CONTROL_KIT_URL } from '../../../utils/controlKit';
import { money } from '../../../utils/cadCost';
import { CadRobotContext, PART_STATUS_LABELS, fmtDate, fmtSize } from '../../../components/cad/useCad';
import { useRecordFocus } from '../../hooks/useRecordFocus';
import { candidateOf, loadChoiceHistory, useRobot, type BomPart, type ChoiceHistory, type RobotDetail, type RobotImport } from '../../../components/cad/useRobots';
import {
  BOM_GROUPS, BOM_GROUP_LABELS, CAD_TYPE_LABELS, CHOOSABLE_TYPES, estimateUsd, parseOnshapeAssembly, seasonName, type BomGroup, type CadType, type Candidate,
} from '../../../types/cadBom';
import { EmptyState, Page } from '../../ui/page';
import { Reveal } from '../../ui/motion';
import { BomBar, GROUP_BAR, GROUP_TEXT, StockNote, TypeChip, vendorName } from './cadUi';
import { CadReviewsTab } from './CadReviewsTab';
import { CadSnapshotsTab } from './CadSnapshotsTab';
import { CadDocsTab } from './CadDocsTab';
import { InvoiceDialog, PartSheet } from './CadPartForms';
import { useCadParts } from '../../../components/cad/useCad';

const TABS = [
  { id: 'bom', label: 'BOM', icon: Package },
  { id: 'files', label: 'Files', icon: FileBox },
  { id: 'reviews', label: 'Design reviews', icon: ClipboardCheck },
  { id: 'snapshots', label: 'Snapshots', icon: Layers },
  { id: 'sends', label: 'Control Kit sends', icon: Send },
] as const;

/** The assembly picture Control Kit sent with the latest import that had one. */
function assemblyPicture(imports: RobotImport[]) {
  for (const i of imports) {
    const f = i.files.find((x) => x.stored && x.url && /\.(png|jpe?g|webp)$/i.test(x.name));
    if (f) return f.url!;
  }
  return null;
}

export function RobotPage({ robotId, currentUser, isAdmin }: { robotId: number; currentUser?: any; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ctl = useRobot(robotId);
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'bom';
  const setTab = (v: string) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'bom') n.delete('tab'); else n.set('tab', v); return n; }, { replace: true });
  const [editing, setEditing] = useState(false);
  const d = ctl.data;
  if (ctl.state === 'loading') return <Page><Skeleton className="mb-6 h-40" /><Skeleton className="h-96" /></Page>;
  if (!d) {
    return (
      <Page>
        <EmptyState icon={Package} title={ctl.state === 'missing' ? 'That robot isn’t in this workspace' : 'Couldn’t load this robot'}
          description={ctl.state === 'missing' ? 'It may belong to another workspace.' : 'Try refreshing the page.'}
          action={<Button variant="outline" onClick={() => navigate('/cad')}><ArrowLeft /> All robots</Button>} />
      </Page>
    );
  }
  const r = d.robot;
  const picture = assemblyPicture(d.imports);
  return (
    <CadRobotContext.Provider value={r.id}>
      <Page>
        <Reveal className="mb-6">
          <Link to={`/cad?season=${r.season}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {seasonName(r.season)}</Link>
          <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-3xl font-semibold tracking-tight">{r.name}</h1>
                {r.isMain && <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"><Star className="size-3" /> Main robot</span>}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{seasonName(r.season)}</span>
                {r.assemblyUrl
                  ? <a href={r.assemblyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">Onshape assembly <ExternalLink className="size-3.5" /><span className="sr-only"> (opens in a new tab)</span></a>
                  : <span>No assembly linked</span>}
                {d.imports[0] && <span>Last sent {fmtDate(d.imports[0].sentAt)}{d.imports[0].sentBy ? ` by ${d.imports[0].sentBy}` : ''}</span>}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm"><a href={CONTROL_KIT_URL} target="_blank" rel="noopener noreferrer"><img src={CONTROL_KIT_ICON} alt="" aria-hidden className="size-4 rounded-[3px]" /> Rescan in Control Kit<span className="sr-only"> (opens in a new tab)</span></a></Button>
                {d.canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="Robot actions"><MoreHorizontal /> Robot</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Rename, season, assembly</DropdownMenuItem>
                      {!r.isMain && <DropdownMenuItem onSelect={() => void ctl.update({ isMain: true })}><Star /> Make main robot of {seasonName(r.season)}</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            {/* The whole assembly, never cropped: the picture keeps its own shape. */}
            {picture && (
              <a href={picture} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-2xl border border-border bg-white" title="Open the full picture">
                <img src={picture} alt={`${r.name} assembly`} className="aspect-[16/10] w-full object-contain" />
              </a>
            )}
          </div>
        </Reveal>
        <Tabs value={tab} onValueChange={setTab} className="mb-6">
          <TabsList aria-label="Robot sections" className="max-w-full justify-start overflow-x-auto">
            {TABS.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} className="shrink-0 max-sm:h-11"><Icon />{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {tab === 'bom' && <RobotBom ctl={ctl} data={d} />}
        {tab === 'files' && <RobotFiles imports={d.imports} />}
        {tab === 'reviews' && <CadReviewsTab currentUser={currentUser} isAdmin={isAdmin} />}
        {tab === 'snapshots' && <CadSnapshotsTab currentUser={currentUser} isAdmin={isAdmin} />}
        {tab === 'sends' && <RobotSends imports={d.imports} />}
        {editing && <EditRobotDialog data={d} onClose={() => setEditing(false)} onSave={async (patch) => { if (await ctl.update(patch)) setEditing(false); }} />}
      </Page>
    </CadRobotContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// BOM
// ---------------------------------------------------------------------------

type Filter = 'all' | BomGroup;

function RobotBom({ ctl, data }: { ctl: ReturnType<typeof useRobot>; data: RobotDetail }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const parts = useMemo(() => data.parts.filter((p) => !p.ck_removed_at), [data.parts]);
  const removed = useMemo(() => data.parts.filter((p) => p.ck_removed_at), [data.parts]);
  const importId = Number(params.get('import')) || null;
  const imported = importId ? data.imports.find((i) => i.id === importId) : null;
  const openId = Number(params.get('part')) || null;
  const open = data.parts.find((p) => p.id === openId) ?? null;
  const setOpen = (id: number | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('part', String(id)); else n.delete('part'); return n; }, { replace: true });
  const hand = useCadParts();
  // Bruno and record links name a part with ?id=.
  useRecordFocus('id', true, 'That part');
  const q = query.trim().toLowerCase();
  const shown = parts.filter((p) => (filter === 'all' || p.effective.group === filter)
    && (!q || [p.name, p.ck_extra?.partNumber, p.ck_extra?.sku, p.effective.product?.name, p.effective.product?.sku].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))));
  const s = data.summary;
  const unpriced = s.buyLines + s.counts.hardware - s.priced;
  return (
    <>
      {imported && (
        <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
          <img src={CONTROL_KIT_ICON} alt="" aria-hidden className="size-8 rounded-lg" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{imported.assemblyName || 'Assembly'} from Control Kit</span>
            <span className="text-muted-foreground"> · sent {fmtDate(imported.sentAt)}{imported.sentBy ? ` by ${imported.sentBy}` : ''} · {imported.partCount} parts · {imported.created} new, {imported.updated} updated{imported.markedRemoved ? `, ${imported.markedRemoved} not in this scan` : ''}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete('import'); return n; }, { replace: true })}>Dismiss</Button>
        </div>
      )}
      <Reveal className="mb-6 grid gap-6 rounded-2xl border border-border bg-card p-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <div>
          <p className="text-sm text-muted-foreground">Known subtotal</p>
          <p className="mt-1 font-display text-4xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{s.priced ? money(s.totalUsd) : 'No prices yet'}</p>
          <p className="text-sm text-muted-foreground">
            {s.priced} of {s.buyLines + s.counts.hardware} to buy priced{unpriced > 0 && <span className="text-orange-600 dark:text-orange-300"> · {unpriced} not priced yet</span>}
          </p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-sm"><span className="text-2xl font-semibold tabular-nums">{s.parts}</span> <span className="text-muted-foreground">unique parts</span>
            {s.pending > 0 && <span className="ml-2 text-muted-foreground">· {s.pending} chosen here, reaching Control Kit at its next scan</span>}</p>
          <BomBar summary={s} />
        </div>
      </Reveal>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a part by name, part number, or SKU" aria-label="Find a part" className="pl-9 max-sm:h-11" />
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {(['all', ...BOM_GROUPS] as Filter[]).map((g) => {
            const n = g === 'all' ? s.parts : s.counts[g];
            if (g !== 'all' && !n) return null;
            return (
              <Button key={g} size="sm" variant={filter === g ? 'secondary' : 'ghost'} aria-pressed={filter === g} onClick={() => setFilter(g)} className="max-sm:h-11">
                {g !== 'all' && <span className={cn('size-2 rounded-full', GROUP_BAR[g])} aria-hidden />}{g === 'all' ? 'All' : BOM_GROUP_LABELS[g]} <span className="tabular-nums text-muted-foreground">{n}</span>
              </Button>
            );
          })}
        </div>
        <Button variant="outline" size="sm" onClick={() => hand.setShowInvoice(true)} className="max-sm:h-11"><Sparkles /> Import invoice</Button>
        <Button variant="outline" size="sm" onClick={() => hand.setEditing('new')} className="max-sm:h-11"><Plus /> Add part</Button>
      </div>
      {!parts.length ? (
        <EmptyState icon={Package} title="No parts yet" description="Send this robot's assembly from Control Kit in Onshape, or add parts by hand."
          action={<Button asChild variant="outline"><a href={CONTROL_KIT_URL} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open Control Kit</a></Button>} />
      ) : (
        BOM_GROUPS.map((g) => {
          const items = shown.filter((p) => p.effective.group === g);
          if (!items.length) return null;
          return <BomGroupTable key={g} group={g} items={items} onOpen={setOpen} highlight={importId} saving={ctl.saving} />;
        })
      )}
      {removed.length > 0 && (
        <details className="mt-8 rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">{removed.length} part{removed.length === 1 ? '' : 's'} not in the latest scan</summary>
          <ul className="mt-3 grid gap-1 text-sm text-muted-foreground">{removed.map((p) => <li key={p.id}><button type="button" className="hover:underline" onClick={() => setOpen(p.id)}>{p.name}</button></li>)}</ul>
        </details>
      )}
      {open && !hand.editing && <PartDrawer part={open} canManage={data.canManage} busy={ctl.saving.has(open.id)} onClose={() => setOpen(null)} onChoose={(c) => ctl.choose(open, c)}
        onEdit={() => hand.setEditing(open)} onDelete={async () => { await hand.remove(open.id); setOpen(null); void ctl.load(); }} />}
      {hand.editing && <PartSheet key={hand.editing === 'new' ? 'new' : hand.editing.id} initial={hand.editing === 'new' ? null : hand.editing} onClose={() => hand.setEditing(null)} onDone={() => { hand.setEditing(null); void ctl.load(); }} />}
      <InvoiceDialog open={hand.showInvoice} onClose={() => hand.setShowInvoice(false)} onDone={() => { hand.setShowInvoice(false); void ctl.load(); }} />
    </>
  );
}

function BomGroupTable({ group, items, onOpen, highlight, saving }: { group: BomGroup; items: BomPart[]; onOpen: (id: number) => void; highlight: number | null; saving: Set<number> }) {
  const subtotal = items.reduce((a, p) => a + (p.effective.totalUsd ?? 0), 0);
  const priced = items.filter((p) => p.effective.totalUsd !== null).length;
  return (
    <section className="mb-8" aria-labelledby={`bom-${group}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={`bom-${group}`} className={cn('flex items-center gap-2 text-base font-semibold', GROUP_TEXT[group])}>
          <span className={cn('size-2.5 rounded-full', GROUP_BAR[group])} aria-hidden />{BOM_GROUP_LABELS[group]} <span className="font-normal tabular-nums text-muted-foreground">{items.length}</span>
        </h2>
        {(group === 'buy' || group === 'hardware') && <span className="text-sm tabular-nums text-muted-foreground">{priced ? `${money(subtotal)} · ${priced} of ${items.length} priced` : 'No prices yet'}</span>}
      </div>
      <div className={cn('overflow-x-auto rounded-xl border border-border border-t-2', group === 'review' ? 'border-t-orange-400' : group === 'buy' ? 'border-t-sky-400' : group === 'make' ? 'border-t-[#ffc700]' : '')}>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Part</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Type</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Cost</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => {
              const e = p.effective;
              const extra = p.ck_extra;
              return (
                <TableRow key={p.id} data-record-id={p.id} onClick={() => onOpen(p.id)} className={cn('cursor-pointer', highlight && p.ck_import_id === highlight && 'bg-accent/5', saving.has(p.id) && 'opacity-60')}>
                  <TableCell className="min-w-[12rem]">
                    <button type="button" onClick={(ev) => { ev.stopPropagation(); onOpen(p.id); }} className="text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{p.name}</button>
                    <span className="block text-xs text-muted-foreground">
                      {[extra?.partNumber, extra?.reviewReason && group === 'review' ? extra.reviewReason : null, !extra ? 'Added by hand' : null].filter(Boolean).join(' · ')}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                  <TableCell>
                    <TypeChip type={e.type} />
                    {(e.typePending || e.productPending) && <span className="mt-1 block text-xs text-muted-foreground">Chosen here · next scan</span>}
                  </TableCell>
                  <TableCell className="min-w-[12rem]">
                    {e.product ? (
                      <span className="block">
                        <span className="block truncate text-sm">{vendorName(e.product.vendor)} {e.product.sku}</span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {extra?.matchStatus === 'possible' && e.productBy !== 'control-point' ? <span className="text-orange-600 dark:text-orange-300">Possible match</span> : null}
                          {e.product.unitsPerPack ? <span>Pack of {e.product.unitsPerPack}</span> : null}
                          <StockNote stock={e.product.stock} />
                        </span>
                      </span>
                    ) : e.candidates.length ? <span className="text-xs text-orange-600 dark:text-orange-300">{e.candidates.length} product{e.candidates.length === 1 ? '' : 's'} to pick from</span>
                      : <span className="text-xs text-muted-foreground">{group === 'buy' || group === 'hardware' ? 'No vendor match' : '—'}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{e.totalUsd !== null ? money(e.totalUsd) : <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Part drawer: everything Control Kit knows about the part, and the choices
// ---------------------------------------------------------------------------

const BY_TEXT: Record<string, string> = {
  'control-point': 'Chosen in Control Point', 'control-kit-person': 'Chosen in Control Kit', 'control-kit': 'Decided by Control Kit', 'manual-row': 'From the row’s source',
};

function PartDrawer({ part, canManage, busy, onClose, onChoose, onEdit, onDelete }: {
  part: BomPart; canManage: boolean; busy: boolean; onClose: () => void; onChoose: (c: { type?: CadType | null; product?: string | null }) => Promise<BomPart | null>;
  onEdit: () => void; onDelete: () => void;
}) {
  const narrow = useIsNarrow();
  const e = part.effective;
  const x = part.ck_extra;
  const [history, setHistory] = useState<ChoiceHistory>([]);
  useEffect(() => { let live = true; if (part.ck_part_key) void loadChoiceHistory(part.id).then((h) => { if (live) setHistory(h); }); return () => { live = false; }; }, [part.id, part.ck_part_key, part.choice_type_at, part.choice_product_at]);
  const fromKit = !!part.ck_part_key;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side={narrow ? 'bottom' : 'right'} className={cn('gap-0 overflow-y-auto p-0', !narrow && 'sm:max-w-xl')}>
        <SheetHeader className="border-b border-border px-6 py-5 pr-12">
          <SheetTitle>{part.name}</SheetTitle>
          <SheetDescription>{[x?.partNumber, x?.material, `${part.quantity} in the robot`].filter(Boolean).join(' · ')}</SheetDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TypeChip type={e.type} />
            <span className="text-xs text-muted-foreground">{BY_TEXT[e.typeBy]}{e.typeBy === 'control-point' && part.choice_type_by ? ` by ${part.choice_type_by}` : ''}</span>
            {e.totalUsd !== null && <span className="text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{money(e.totalUsd)}</span>}
          </div>
          {(e.typePending || e.productPending) && <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">Chosen in Control Point. It reaches Control Kit at its next scan of this assembly; a re-send keeps it.</p>}
        </SheetHeader>
        <div className="grid gap-6 px-6 py-5">
          <section aria-labelledby="part-people" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <h3 id="part-people" className="sr-only">Status and assignee</h3>
            <span>Status <span className="font-medium">{PART_STATUS_LABELS[part.status] ?? part.status}</span></span>
            <span>Assignee <span className="font-medium">{part.assignee || '—'}</span></span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> {fromKit ? 'Edit status, assignee, notes' : 'Edit part'}</Button>
              {(!fromKit || part.ck_removed_at) && <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}><Trash2 /> Delete</Button>}
            </span>
          </section>
          {fromKit && (
            <section aria-labelledby="choose-type">
              <h3 id="choose-type" className="mb-2 text-sm font-medium">How is it made?</h3>
              {!canManage && <p className="mb-2 text-xs text-muted-foreground">Your role can’t change CAD choices. Ask someone with Manage CAD.</p>}
              <div className="flex flex-wrap gap-1.5">
                {CHOOSABLE_TYPES.map((t) => (
                  <Button key={t} size="sm" variant={e.type === t ? 'secondary' : 'outline'} aria-pressed={e.type === t} disabled={!canManage || busy}
                    onClick={() => void onChoose({ type: t })} className="max-sm:h-11">{e.type === t && <Check />}{CAD_TYPE_LABELS[t]}</Button>
                ))}
                {part.choice_type_set === 1 && part.choice_type && (
                  <Button size="sm" variant="ghost" disabled={!canManage || busy} onClick={() => void onChoose({ type: null })} className="max-sm:h-11">Let Control Kit decide</Button>
                )}
              </div>
              {x?.reviewReason && e.type === 'review' && <p className="mt-2 text-xs text-orange-600 dark:text-orange-300">{x.reviewReason}</p>}
            </section>
          )}
          {fromKit && (
            <section aria-labelledby="choose-product">
              <h3 id="choose-product" className="mb-2 text-sm font-medium">Which product?</h3>
              {e.candidates.length ? (
                <ul className="grid gap-2">
                  {e.candidates.map((c) => <CandidateRow key={c.id} c={c} qty={part.quantity} chosen={e.product?.id === c.id} canManage={canManage} busy={busy} onUse={() => void onChoose({ product: c.id })} />)}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Control Kit found no catalog product for this part. Add the vendor SKU to its part number in Onshape and rescan.</p>}
              {part.choice_product && canManage && (
                <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => void onChoose({ product: null })}>Clear my product pick</Button>
              )}
            </section>
          )}
          {x && (
            <section aria-labelledby="part-facts" className="grid gap-2 text-sm">
              <h3 id="part-facts" className="text-sm font-medium">From Control Kit</h3>
              {x.description && <p className="text-muted-foreground">{x.description}</p>}
              {x.priceCheck && <p className="text-rose-600 dark:text-rose-400">{x.priceCheck}</p>}
              {x.packsToOrder != null && <p>{x.packsToOrder} pack{x.packsToOrder === 1 ? '' : 's'} to order{x.unitsPerPack ? ` (${x.unitsPerPack} each)` : ''}{x.packPriceUsd != null ? ` at ${money(x.packPriceUsd)}` : ''}</p>}
              {x.orderedWith && <p className="text-muted-foreground">Ordered together with another line of the same SKU.</p>}
              {Array.isArray(x.matchReasons) && x.matchReasons.length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{x.matchReasons.slice(0, 4).map((m: string, i: number) => <li key={i}>{m}</li>)}</ul>}
              {Array.isArray(x.usedIn) && x.usedIn.length > 0 && <p className="text-muted-foreground">Used in {x.usedIn.slice(0, 3).join('; ')}{x.usedIn.length > 3 ? ` and ${x.usedIn.length - 3} more` : ''}</p>}
              <div className="flex flex-wrap gap-3">
                {x.partStudioUrl && <a href={x.partStudioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">Open Part Studio <ExternalLink className="size-3.5" /></a>}
                {e.product?.url && <a href={e.product.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">Product page <ExternalLink className="size-3.5" /></a>}
              </div>
            </section>
          )}
          {history.length > 0 && (
            <section aria-labelledby="part-history">
              <h3 id="part-history" className="mb-2 flex items-center gap-1.5 text-sm font-medium"><History className="size-4" /> Choices made here</h3>
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {history.map((h, i) => (
                  <li key={i}>{fmtDate(h.at)} · {h.by_name || 'A teammate'} · {h.kind === 'type' ? (h.value ? CAD_TYPE_LABELS[h.value as CadType] ?? h.value : 'let Control Kit decide') : (candidateOf(part, h.value)?.name ?? (h.value ? h.value : 'cleared the product'))}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CandidateRow({ c, qty, chosen, canManage, busy, onUse }: { c: Candidate; qty: number; chosen: boolean; canManage: boolean; busy: boolean; onUse: () => void }) {
  const estimate = estimateUsd(c, qty);
  return (
    <li className={cn('flex gap-3 rounded-xl border p-3', chosen ? 'border-sky-400/60 bg-sky-400/5' : 'border-border')}>
      {c.image ? <img src={c.image.url} alt="" className="size-14 shrink-0 rounded-lg bg-white object-contain" /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{c.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{vendorName(c.vendor)} {c.sku}</span>
          {c.priceUsd !== null && <span>{money(c.priceUsd)}{c.unitsPerPack ? ` per ${c.unitsPerPack}` : ' (pack size unknown)'}</span>}
          {estimate !== null && <span>≈ {money(estimate)} for {qty}</span>}
          <StockNote stock={c.stock} />
          {c.kind === 'near' && <span>Near match</span>}
        </p>
        {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline">Product page <ExternalLink className="size-3" /></a>}
      </div>
      {chosen ? <span className="self-center text-xs font-medium text-sky-600 dark:text-sky-300">In use</span>
        : <Button size="sm" variant="outline" className="self-center" disabled={!canManage || busy} onClick={onUse}>Use this</Button>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Files and sends
// ---------------------------------------------------------------------------

function RobotFiles({ imports }: { imports: RobotImport[] }) {
  const latest = imports.find((i) => i.files.length);
  return (
    <>
      <section className="mb-8">
        <h2 className="mb-1 text-base font-semibold">From Control Kit</h2>
        <p className="mb-3 text-sm text-muted-foreground">The workbook, STEP files and assembly picture from the latest send.</p>
        {latest ? <FileList files={latest.files} /> : <p className="text-sm text-muted-foreground">No files sent yet. Control Kit attaches the workbook and STEP zip when you send.</p>}
      </section>
      <CadDocsTab />
    </>
  );
}

function FileList({ files }: { files: RobotImport['files'] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {files.map((f, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm">
          {f.stored && f.url ? <FileCheck2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <FileX2 className="size-5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1">
            {f.stored && f.url ? <a href={f.url} className="block truncate font-medium hover:underline">{f.name}</a> : <span className="block truncate">{f.name}</span>}
            <span className="block text-xs text-muted-foreground">{f.stored ? (f.sizeBytes ? fmtSize(f.sizeBytes) : 'Stored') : f.note || 'Not included'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function RobotSends({ imports }: { imports: RobotImport[] }) {
  if (!imports.length) return <EmptyState icon={Send} title="Nothing sent yet" description="Scan this robot's assembly in Control Kit and press Send to Control Point." />;
  return (
    <ol className="grid gap-3">
      {imports.map((i) => (
        <li key={i.id} className="rounded-xl border border-border bg-card p-4">
          <p className="font-medium">{i.assemblyName || 'Assembly'} · {fmtDate(i.sentAt)}{i.sentBy ? ` by ${i.sentBy}` : ''}</p>
          <p className="text-sm text-muted-foreground">{i.partCount} parts · {i.created} new · {i.updated} updated{i.markedRemoved ? ` · ${i.markedRemoved} not in this scan` : ''}{i.revision ? ` · revision ${i.revision}` : ''}</p>
          {i.files.length > 0 && <div className="mt-3"><FileList files={i.files} /></div>}
        </li>
      ))}
    </ol>
  );
}

function EditRobotDialog({ data, onClose, onSave }: { data: RobotDetail; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const r = data.robot;
  const [name, setName] = useState(r.name);
  const [season, setSeason] = useState(String(r.season));
  const [url, setUrl] = useState(r.assemblyUrl ?? '');
  const [busy, setBusy] = useState(false);
  const badUrl = url.trim() !== '' && !parseOnshapeAssembly(url);
  const now = new Date();
  const top = (now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1) + 1;
  const options = Array.from({ length: 8 }, (_, i) => top - i);
  const submit = async () => {
    if (!name.trim() || badUrl || busy) return;
    const patch: Record<string, unknown> = {};
    if (name.trim() !== r.name) patch.name = name.trim();
    if (Number(season) !== r.season) patch.season = Number(season);
    if (url.trim() !== (r.assemblyUrl ?? '')) patch.assemblyUrl = url.trim() || null;
    if (!Object.keys(patch).length) { onClose(); return; }
    setBusy(true);
    try { await onSave(patch); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit robot</DialogTitle>
          <DialogDescription>Moving a robot to another season takes its BOM, files, reviews and snapshots with it.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
          <div className="grid gap-2"><Label htmlFor="edit-robot-name">Name</Label><Input id="edit-robot-name" value={name} onChange={(ev) => setName(ev.target.value)} maxLength={80} /></div>
          <div className="grid gap-2">
            <Label htmlFor="edit-robot-season">Season</Label>
            <Select value={season} onValueChange={setSeason}>
              <SelectTrigger id="edit-robot-season"><SelectValue /></SelectTrigger>
              <SelectContent>{options.map((y) => <SelectItem key={y} value={String(y)}>{seasonName(y)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-robot-assembly">Onshape assembly</Label>
            <Input id="edit-robot-assembly" value={url} onChange={(ev) => setUrl(ev.target.value)} placeholder="https://cad.onshape.com/documents/…/e/…" aria-invalid={badUrl || undefined} />
            <p className={cn('text-xs', badUrl ? 'text-destructive' : 'text-muted-foreground')}>{badUrl ? 'Paste the link of an Assembly tab (it has /e/ in it).' : 'Control Kit sends of this assembly land on this robot.'}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || badUrl || busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

