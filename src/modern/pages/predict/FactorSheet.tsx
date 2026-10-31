// The full why breakdown for one unplayed match (shared engine 3.3: ForecastMatch.factorSheet, the same sheet
// Control Scout shows): every factor behind the call with its share of it. Collapsed under the match row; open
// for a red-vs-blue bar of what the call leans on, the four game phases, what else the win model weighs, and the
// reasons that never move the odds (0%). Sized by its container: on a wide row the sections sit side by side.
import type { ReactNode } from 'react';
import {
  Bot, CalendarRange, ChartBarBig, ChartPie, ChevronDown, Flag, Gamepad2, Gauge, Hourglass, Scale, ShieldAlert, Swords,
  TrendingUp, Users, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import type { FactorSheet, SheetFactor } from '@control-scout/predict-engine';
import { cn } from '../../../components/cn';

const pctOf = (w: number) => (w <= 0 ? '0%' : w < 0.005 ? '<1%' : `${Math.round(w * 100)}%`);

/** Below this many log-odds (about 52.5% either way) the whole call is a near coin flip. */
const COIN_FLIP = 0.1;

const TONE = {
  A: { text: 'text-red-500', bar: 'bg-red-500', chip: 'bg-red-500/15 text-red-500' },
  B: { text: 'text-blue-500', bar: 'bg-blue-500', chip: 'bg-blue-500/15 text-blue-500' },
  even: { text: 'text-muted-foreground', bar: 'bg-muted-foreground/40', chip: 'bg-muted text-muted-foreground' },
} as const;

const ICON: Record<SheetFactor['id'], LucideIcon> = {
  auto: Bot, teleop: Gamepad2, endgame: Flag, pen: ShieldAlert,
  pointMix: ChartPie, form: TrendingUp, momentum: Zap, reliability: Wrench, partners: Users, experience: Hourglass, certainty: Gauge,
  schedule: CalendarRange, headToHead: Swords,
};

export function FactorSheetPanel({ sheet, className }: { sheet: FactorSheet; className?: string }) {
  const all = [...sheet.phases, ...sheet.model, ...sheet.reasons];
  // Bars are drawn against the largest share, so a call carried by one factor still reads at a glance.
  const top = Math.max(...all.map((f) => f.weight), 0.0001);
  return (
    <details className={cn('@container group rounded-lg border border-border', className)} data-testid="factor-sheet">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent" aria-hidden><ChartBarBig className="size-3.5" /></span>
        <span className="min-w-0 flex-1">Full why breakdown <span className="font-normal text-muted-foreground">· {all.length} factors</span></span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-border px-3 pb-3 pt-2.5">
        <TugOfWar sheet={sheet} />
        {Math.abs(sheet.logit) < COIN_FLIP && (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs">This call is close to a coin flip. Strong factors can pull in opposite directions and cancel each other.</p>
        )}
        <div className="grid gap-4 @3xl:grid-cols-2 @3xl:gap-x-8">
          <div className="space-y-4">
            <Section title="Game phases" note="An exact split of the predicted margin">{sheet.phases.map((f) => <Row key={f.id} f={f} top={top} />)}</Section>
            <Section title="Reasons that don't move the odds">{sheet.reasons.map((f) => <Row key={f.id} f={f} top={top} />)}</Section>
          </div>
          {sheet.model.length > 0 && (
            <Section title="What else the win model weighs" note="How the odds move beyond the score gap">{sheet.model.map((f) => <Row key={f.id} f={f} top={top} />)}</Section>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">Each share is how much of the call that factor carries; the shares add up to 100%. A red bar helps red, a blue bar helps blue.</p>
      </div>
    </details>
  );
}

/** The whole call at a glance: one bar, red's factors from the left and blue's from the right, each segment its share. */
function TugOfWar({ sheet }: { sheet: FactorSheet }) {
  const lean = (side: 'A' | 'B') => [...sheet.phases, ...sheet.model].filter((f) => f.favors === side && f.weight > 0).sort((x, y) => y.weight - x.weight);
  const red = lean('A'), blue = lean('B');
  const sum = (xs: SheetFactor[]) => xs.reduce((s, f) => s + f.weight, 0);
  const total = sum(red) + sum(blue);
  if (total <= 0) return null;
  const seg = (f: SheetFactor, i: number, side: 'A' | 'B') => (
    <div key={f.id} className={cn('h-full', TONE[side].bar, i > 0 && (side === 'A' ? 'border-l border-background/70' : 'border-r border-background/70'))}
      style={{ width: `${(f.weight / total) * 100}%`, opacity: Math.max(0.45, 1 - i * 0.12) }} title={`${f.name}: ${pctOf(f.weight)}`} />
  );
  return (
    <div data-testid="sheet-tug">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold text-red-500"><span className="text-xs tabular-nums">{pctOf(sum(red) / total)}</span> pulls for red</span>
        <span className="hidden text-muted-foreground @md:inline"><Scale className="mr-1 inline size-3 align-[-2px]" aria-hidden />What the call leans on</span>
        <span className="font-semibold text-blue-500">pulls for blue <span className="text-xs tabular-nums">{pctOf(sum(blue) / total)}</span></span>
      </div>
      <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Factors leaning red carry ${pctOf(sum(red) / total)} of the call, blue ${pctOf(sum(blue) / total)}`}>
        {/* Every segment sits in the track itself, its width its share of the whole: red's from the left, blue's
            (largest last) reaching the right end. The two sides add up to the full bar. */}
        {red.map((f, i) => seg(f, i, 'A'))}
        {[...blue].reverse().map((f, i) => seg(f, blue.length - 1 - i, 'B'))}
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-[11px] font-semibold">{title}{note && <span className="font-normal text-muted-foreground"> · {note}</span>}</h4>
      <ul className="mt-1.5 space-y-2">{children}</ul>
    </section>
  );
}

function Row({ f, top }: { f: SheetFactor; top: number }) {
  const tone = TONE[f.favors];
  const Icon = ICON[f.id] ?? Gauge;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5">
      <span className={cn('row-span-2 mt-0.5 flex size-7 items-center justify-center rounded-md', tone.chip)} aria-hidden><Icon className="size-3.5" /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium">{f.name}</p>
        <p className="text-[11px] text-muted-foreground">{f.label}</p>
      </div>
      <span className={cn('text-xs font-semibold tabular-nums', tone.text)} title={f.kind === 'reason' ? 'Words only: this never moves the odds' : undefined}>{pctOf(f.weight)}</span>
      <div className="col-span-2 col-start-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${(f.weight / top) * 100}%` }} />
      </div>
    </li>
  );
}
