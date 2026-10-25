// Honest BOM totals for the CAD Parts list. A part with no unit cost is
// unpriced, not free: totals say how many lines they cover, and a BOM with
// nothing priced says "No prices yet" instead of a finished-looking $0.00.
export type CostPart = { quantity?: unknown; unit_cost?: unknown; status?: unknown };
export type CostSummary = { total: number; priced: number; unpriced: number; lines: number; toOrder: number };

export function bomCost(parts: CostPart[]): CostSummary {
  let total = 0;
  let priced = 0;
  let toOrder = 0;
  for (const p of parts) {
    const unit = Number(p.unit_cost) || 0;
    if (unit > 0) { priced++; total += (Number(p.quantity) || 0) * unit; }
    if (p.status === 'to_order') toOrder++;
  }
  return { total: Math.round(total * 100) / 100, priced, unpriced: parts.length - priced, lines: parts.length, toOrder };
}

export const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
/** "0 of 10 lines priced" */
export const pricedText = (s: Pick<CostSummary, 'priced' | 'lines'>) => `${s.priced} of ${s.lines} line${s.lines === 1 ? '' : 's'} priced`;
/** A section subtotal: the priced amount, plus how many lines are not priced yet. */
export function subtotalText(s: CostSummary) {
  if (!s.lines) return money(0);
  if (!s.priced) return 'No prices yet';
  return s.unpriced ? `${money(s.total)} priced · ${s.unpriced} unpriced` : money(s.total);
}
