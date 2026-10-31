// The full why breakdown for one unplayed match (shared engine 3.3: ForecastMatch.factorSheet, the same sheet
// Control Scout shows): every factor behind the call with its share of it. Collapsed under the match row; open
// for the four game phases, what else the win model weighs, and the reasons that never move the odds (0%).
import { ChevronDown } from 'lucide-react';
import type { FactorSheet, SheetFactor } from '@control-scout/predict-engine';
import { cn } from '../../../components/cn';

const pctOf = (w: number) => (w <= 0 ? '0%' : w < 0.005 ? '<1%' : `${Math.round(w * 100)}%`);

/** Below this many log-odds (about 52.5% either way) the whole call is a near coin flip. */
const COIN_FLIP = 0.1;

const TONE = {
  A: { text: 'text-red-500', bar: 'bg-red-500' },
  B: { text: 'text-blue-500', bar: 'bg-blue-500' },
  even: { text: 'text-muted-foreground', bar: 'bg-muted-foreground/40' },
} as const;

export function FactorSheetPanel({ sheet, className }: { sheet: FactorSheet; className?: string }) {
  const all = [...sheet.phases, ...sheet.model, ...sheet.reasons];
  // Bars are drawn against the largest share, so a call carried by one factor still reads at a glance.
  const top = Math.max(...all.map((f) => f.weight), 0.0001);
  return (
    <details className={cn('group rounded-lg border border-border', className)} data-testid="factor-sheet">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
        <span>Full why breakdown <span className="font-normal text-muted-foreground">· {all.length} factors</span></span>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-border px-3 pb-3 pt-2.5">
        {Math.abs(sheet.logit) < COIN_FLIP && (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs">This call is close to a coin flip. Strong factors can pull in opposite directions and cancel each other.</p>
        )}
        <Section title="Game phases" note="An exact split of the predicted margin" items={sheet.phases} top={top} />
        {sheet.model.length > 0 && <Section title="What else the win model weighs" note="How the odds move beyond the score gap" items={sheet.model} top={top} />}
        <Section title="Reasons that don't move the odds" items={sheet.reasons} top={top} />
        <p className="text-[11px] text-muted-foreground">Each share is how much of the call that factor carries; the shares add up to 100%. A red bar helps red, a blue bar helps blue.</p>
      </div>
    </details>
  );
}

function Section({ title, note, items, top }: { title: string; note?: string; items: SheetFactor[]; top: number }) {
  return (
    <section>
      <h4 className="text-[11px] font-semibold">{title}{note && <span className="font-normal text-muted-foreground"> · {note}</span>}</h4>
      <ul className="mt-1 space-y-1.5">
        {items.map((f) => {
          const tone = TONE[f.favors];
          return (
            <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5">
              <div className="min-w-0">
                <p className="text-xs font-medium">{f.name}</p>
                <p className="text-[11px] text-muted-foreground">{f.label}</p>
              </div>
              <span className={cn('text-xs font-semibold tabular-nums', tone.text)} title={f.kind === 'reason' ? 'Words only: this never moves the odds' : undefined}>{pctOf(f.weight)}</span>
              <div className="col-span-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${(f.weight / top) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
