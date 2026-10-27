// Small pieces shared by the seasons page and a robot's page. Colours follow
// Control Kit's jobs so the two apps read the same: buy sky, make gold,
// attention orange (needs a decision), done green, blocked red; fasteners are
// a muted sky and "not needed" is neutral.
import type { ReactNode } from 'react';
import { cn } from '../../../components/cn';
import { BOM_GROUPS, BOM_GROUP_LABELS, CAD_TYPE_LABELS, type BomGroup, type CadType } from '../../../types/cadBom';
import type { BomSummary } from '../../../components/cad/useRobots';

export const GROUP_BAR: Record<BomGroup, string> = {
  review: 'bg-orange-400', buy: 'bg-sky-400', make: 'bg-[#ffc700]', hardware: 'bg-sky-400/45', ignore: 'bg-zinc-500/60',
};
export const GROUP_TEXT: Record<BomGroup, string> = {
  review: 'text-orange-600 dark:text-orange-300', buy: 'text-sky-600 dark:text-sky-300', make: 'text-amber-700 dark:text-[#ffc700]',
  hardware: 'text-sky-700/80 dark:text-sky-200/80', ignore: 'text-muted-foreground',
};
const GROUP_CHIP: Record<BomGroup, string> = {
  review: 'border-orange-400/40 bg-orange-400/10', buy: 'border-sky-400/40 bg-sky-400/10', make: 'border-[#ffc700]/40 bg-[#ffc700]/10',
  hardware: 'border-sky-400/25 bg-sky-400/5', ignore: 'border-border bg-transparent',
};
const TYPE_GROUP: Record<CadType, BomGroup> = { buy: 'buy', print: 'make', cnc: 'make', 'cut-2d': 'make', fabricate: 'make', hardware: 'hardware', ignore: 'ignore', review: 'review' };

/** A part type as a coloured chip ("3D print", "Buy", "Needs review"). */
export function TypeChip({ type, className, children }: { type: CadType; className?: string; children?: ReactNode }) {
  const g = TYPE_GROUP[type];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', GROUP_CHIP[g], GROUP_TEXT[g], className)}>
      <span className={cn('size-1.5 rounded-full', GROUP_BAR[g])} aria-hidden />{CAD_TYPE_LABELS[type]}{children}
    </span>
  );
}

/** One bar of every part by group, with a legend; adds up to the robot's part count. */
export function BomBar({ summary, legend = true, className }: { summary: BomSummary; legend?: boolean; className?: string }) {
  const total = summary.parts;
  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded-full bg-secondary" role="img" aria-label={BOM_GROUPS.filter((g) => summary.counts[g]).map((g) => `${summary.counts[g]} ${BOM_GROUP_LABELS[g].toLowerCase()}`).join(', ') || 'No parts yet'}>
        {total > 0 && BOM_GROUPS.filter((g) => summary.counts[g]).map((g) => (
          <div key={g} className={cn(GROUP_BAR[g], 'transition-[width] duration-700')} style={{ width: `${(summary.counts[g] / total) * 100}%` }} />
        ))}
      </div>
      {legend && total > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {BOM_GROUPS.filter((g) => summary.counts[g]).map((g) => (
            <li key={g} className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', GROUP_BAR[g])} />{BOM_GROUP_LABELS[g]} <span className="tabular-nums text-foreground">{summary.counts[g]}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const VENDORS: Record<string, string> = { gobilda: 'goBILDA', servocity: 'ServoCity', rev: 'REV', andymark: 'AndyMark', pitsco: 'Pitsco' };
export const vendorName = (v: string | null | undefined) => (v ? VENDORS[v] ?? v : '');

/** "out of stock" in red, "low stock" in orange, nothing when in stock or unknown. */
export function StockNote({ stock }: { stock: string | null | undefined }) {
  if (stock === 'out') return <span className="text-xs font-medium text-rose-600 dark:text-rose-400">Out of stock</span>;
  if (stock === 'low') return <span className="text-xs font-medium text-orange-600 dark:text-orange-300">Low stock</span>;
  return null;
}
