// CAD → seasons: pick an FTC season, see its robots. Each robot card shows its
// whole BOM at a glance (one bar by buy / make / fasteners / needs a decision /
// not needed), what it costs so far, its Onshape assembly, and the last
// Control Kit send. Older seasons stay browsable.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Bot, ClipboardCheck, ExternalLink, FileBox, Layers, Plus, Star } from 'lucide-react';
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Skeleton, Tabs, TabsList, TabsTrigger,
} from '../../../components/ui-kit';
import { cn } from '../../../components/cn';
import { CONTROL_KIT_ICON, CONTROL_KIT_URL } from '../../../utils/controlKit';
import { money } from '../../../utils/cadCost';
import { fmtDate } from '../../../components/cad/useCad';
import { useCadSeasons, type RobotCard } from '../../../components/cad/useRobots';
import { parseOnshapeAssembly, seasonName } from '../../../types/cadBom';
import { EmptyState, Page, PageHeader } from '../../ui/page';
import { Stagger, StaggerItem } from '../../ui/motion';
import { BomBar } from './cadUi';

export function CadSeasons() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const s = useCadSeasons();
  const [adding, setAdding] = useState(false);
  const seasons = s.data?.seasons ?? [];
  // The season asked for, else the newest one with robots, else the current one.
  const fallback = seasons.find((x) => x.robots.length)?.season ?? s.data?.currentSeason;
  const asked = Number(params.get('season'));
  const season = seasons.some((x) => x.season === asked) ? asked : fallback;
  const current = seasons.find((x) => x.season === season);
  const pick = (v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('season', v); return n; }, { replace: true });

  return (
    <Page>
      <PageHeader eyebrow="Build" title="CAD"
        description="Every robot, season by season: its full BOM from Control Kit, what it costs, its files, reviews and snapshots."
        actions={s.data?.canManage ? <Button onClick={() => setAdding(true)}><Plus /> Add robot</Button> : undefined}>
        {seasons.length > 0 && season !== undefined && (
          <Tabs value={String(season)} onValueChange={pick}>
            <TabsList aria-label="Seasons" className="max-w-full justify-start overflow-x-auto">
              {seasons.map((x) => (
                <TabsTrigger key={x.season} value={String(x.season)} className="shrink-0 max-sm:h-11">
                  {x.name}{x.robots.length > 0 && <span className="ml-1 tabular-nums text-muted-foreground">{x.robots.length}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </PageHeader>
      {s.state === 'loading' ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : s.state !== 'ready' || !current ? (
        <EmptyState icon={Bot} title="Couldn't load your robots" description="Try refreshing the page." />
      ) : current.robots.length ? (
        <Stagger as="ul" className="grid gap-4 md:grid-cols-2">
          {current.robots.map((r) => (
            <StaggerItem as="li" key={r.id}><RobotCardView robot={r} onOpen={() => navigate(`/cad/robots/${r.id}`)} /></StaggerItem>
          ))}
        </Stagger>
      ) : (
        <NoRobots season={current.season} canManage={!!s.data?.canManage} onAdd={() => setAdding(true)} />
      )}
      {adding && s.data && (
        <AddRobotDialog seasons={seasons.map((x) => x.season)} defaultSeason={season ?? s.data.currentSeason} onClose={() => setAdding(false)}
          onSave={async (body) => { const id = await s.create(body); if (id) { setAdding(false); navigate(`/cad/robots/${id}`); } }} />
      )}
    </Page>
  );
}

function RobotCardView({ robot: r, onOpen }: { robot: RobotCard; onOpen: () => void }) {
  const b = r.bom;
  const unpriced = b.buyLines + b.counts.hardware - b.priced;
  return (
    <article className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent/40">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15"><Bot className="size-5 text-accent" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-lg font-semibold">
            <button type="button" onClick={onOpen} className="truncate text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{r.name}</button>
            {r.isMain && <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"><Star className="size-3" /> Main</span>}
          </h2>
          <p className="text-sm text-muted-foreground">
            {r.lastImport ? `Sent from Control Kit ${fmtDate(r.lastImport.sentAt)}${r.lastImport.sentBy ? ` by ${r.lastImport.sentBy}` : ''}` : 'No Control Kit send yet'}
          </p>
        </div>
      </div>
      <div className="mt-5 flex items-baseline justify-between gap-3">
        <p className="text-2xl font-semibold tabular-nums">{b.parts} <span className="text-sm font-normal text-muted-foreground">unique part{b.parts === 1 ? '' : 's'}</span></p>
        <p className="text-right">
          <span className="block text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{b.priced ? money(b.totalUsd) : 'No prices yet'}</span>
          {b.priced > 0 && unpriced > 0 && <span className="text-xs text-orange-600 dark:text-orange-300">+ {unpriced} not priced yet</span>}
        </p>
      </div>
      <BomBar summary={b} className="mt-3" />
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5"><FileBox className="size-3.5" />{r.files} file{r.files === 1 ? '' : 's'}</li>
        <li className={cn('flex items-center gap-1.5', r.pendingReviews > 0 && 'text-orange-600 dark:text-orange-300')}><ClipboardCheck className="size-3.5" />{r.pendingReviews} waiting for review</li>
        <li className="flex items-center gap-1.5"><Layers className="size-3.5" />{r.snapshots} snapshot{r.snapshots === 1 ? '' : 's'}</li>
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5">
        {r.assemblyUrl
          ? <a href={r.assemblyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Onshape assembly <ExternalLink className="size-3.5" /><span className="sr-only"> (opens in a new tab)</span></a>
          : <span className="text-sm text-muted-foreground">No assembly linked</span>}
        <Button variant={b.counts.review ? 'default' : 'outline'} size="sm" onClick={onOpen} className="max-sm:h-11">
          {b.counts.review ? `Decide ${b.counts.review} part${b.counts.review === 1 ? '' : 's'}` : 'Open BOM'} <ArrowRight />
        </Button>
      </div>
    </article>
  );
}

function NoRobots({ season, canManage, onAdd }: { season: number; canManage: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
      <img src={CONTROL_KIT_ICON} alt="" aria-hidden className="mx-auto size-12 rounded-xl" />
      <h2 className="mt-4 text-lg font-semibold">No robots in {seasonName(season)} yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Scan the robot's assembly with Control Kit in Onshape and send it here: the robot appears with its whole BOM. Or add it by hand and link its assembly.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline"><a href={CONTROL_KIT_URL} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open Control Kit<span className="sr-only"> (opens in a new tab)</span></a></Button>
        {canManage && <Button onClick={onAdd}><Plus /> Add robot</Button>}
      </div>
    </div>
  );
}

function AddRobotDialog({ seasons, defaultSeason, onClose, onSave }: {
  seasons: number[]; defaultSeason: number; onClose: () => void; onSave: (body: { season: number; name: string; assemblyUrl?: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [season, setSeason] = useState(String(defaultSeason));
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const badUrl = url.trim() !== '' && !parseOnshapeAssembly(url);
  // The next season too, for a team starting early.
  const options = useMemo(() => [...new Set([Math.max(...seasons) + 1, ...seasons])].sort((a, b) => b - a), [seasons]);
  useEffect(() => { setSeason(String(defaultSeason)); }, [defaultSeason]);
  const submit = async () => {
    if (!name.trim() || badUrl || busy) return;
    setBusy(true);
    try { await onSave({ season: Number(season), name: name.trim(), ...(url.trim() ? { assemblyUrl: url.trim() } : {}) }); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a robot</DialogTitle>
          <DialogDescription>A season can hold several robots: the competition robot, a practice bot, a prototype.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-2">
            <Label htmlFor="robot-name">Name</Label>
            <Input id="robot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Competition robot" maxLength={80} autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="robot-season">Season</Label>
            <Select value={season} onValueChange={setSeason}>
              <SelectTrigger id="robot-season"><SelectValue /></SelectTrigger>
              <SelectContent>{options.map((y) => <SelectItem key={y} value={String(y)}>{seasonName(y)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="robot-assembly">Onshape assembly (optional)</Label>
            <Input id="robot-assembly" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cad.onshape.com/documents/…/e/…" aria-invalid={badUrl || undefined} />
            <p className={cn('text-xs', badUrl ? 'text-destructive' : 'text-muted-foreground')}>
              {badUrl ? 'Paste the link of an Assembly tab (it has /e/ in it).' : 'Control Kit sends of this assembly land on this robot.'}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || badUrl || busy}>{busy ? 'Adding…' : 'Add robot'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
