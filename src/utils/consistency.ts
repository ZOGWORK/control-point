// Swing: Control Scout's consistency stat for a team at one event, worked out here with the shared engine's own
// function (@control-scout/predict-engine eventConsistency), so for the same matches it is the same number
// Control Scout shows on that event's rankings. Recorded qualification results only:
//   share        Σ alliance non-penalty points ÷ Σ robots on the field (played quals);
//   contribution (alliance non-penalty score − partner's event OPR) ÷ share, two robots on the field;
//   swing        √((Σ (c − team's mean)² + 10 × field variance) ÷ (n + 10)), shown from 5 matches.
// The field variance is the season's (Control Scout's GET /api/reliability consistencyField), the prior every
// stored swing there is pulled toward. Lower = steadier.
import { CONSISTENCY_MIN_MATCHES, CONSISTENCY_PRIOR, eventConsistency, type Consistency, type ConsistencyAlliance } from '@control-scout/predict-engine';
import type { FtcAllianceScore, FtcEventFull, FtcMatchFull } from '../types/ftcScout';

export type { Consistency };

/** One line, next to the number wherever it's shown (the same words as Control Scout's). */
export const SWING_LINE = `Swing (consistency): sd of (alliance non-penalty score − partner's event OPR) ÷ the event's average robot share, over qualification matches, pulled toward the field as if ${CONSISTENCY_PRIOR} more matches. Lower = steadier; shown from ${CONSISTENCY_MIN_MATCHES} matches.`;

// A time without a zone is read as UTC (as Control Scout reads FIRST's), so the order never depends on the device.
const timeOf = (m: FtcMatchFull) => { const t = m.time ? Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(m.time) ? m.time : `${m.time}Z`) : NaN; return Number.isFinite(t) ? t : Infinity; };

/** Played order (recorded time, then series and number; untimed last), as Control Scout orders them. */
export function playOrder(a: FtcMatchFull, b: FtcMatchFull): number {
  const ta = timeOf(a), tb = timeOf(b);
  return (ta === tb ? 0 : ta < tb ? -1 : 1) || (a.series ?? 0) - (b.series ?? 0) || a.number - b.number;
}

const onField = (s: FtcAllianceScore) => s.teams.filter((t) => t.onField !== false).map((t) => t.number);

/** The event's played qualification alliances in play order, red then blue: the engine's input. */
export function eventAlliances(ev: Pick<FtcEventFull, 'matches'>): ConsistencyAlliance[] {
  return ev.matches
    .filter((m) => m.level === 'qual' && m.played && m.red.score?.totalNp != null && m.blue.score?.totalNp != null)
    .sort(playOrder)
    .flatMap((m) => [{ np: m.red.score!.totalNp!, onField: onField(m.red) }, { np: m.blue.score!.totalNp!, onField: onField(m.blue) }]);
}

/** Every team's swing at the event (null without the season's field variance: no number rather than a different one). */
export function eventSwing(ev: Pick<FtcEventFull, 'matches' | 'field'>, fieldVariance: number | null): Map<number, Consistency> | null {
  if (fieldVariance == null || !Number.isFinite(fieldVariance) || fieldVariance < 0) return null;
  const opr = new Map(ev.field.map((t) => [t.teamNumber, t.opr?.totalNp ?? null]));
  return eventConsistency(eventAlliances(ev), (t) => opr.get(t) ?? null, fieldVariance);
}

/** "±0.42", or "—". */
export const swingText = (c: Consistency | null | undefined) => (c?.value == null ? '—' : `±${c.value.toFixed(2)}`);

/** A cell's tooltip: what it rests on or why it's missing, then the formula. */
export const swingTitle = (c: Consistency | null | undefined) =>
  `${c == null ? 'Not available yet (needs the season field from Control Scout). ' : c.value == null ? `${c.reason}. ` : `From ${c.matches} qualification matches. `}${SWING_LINE}`;
