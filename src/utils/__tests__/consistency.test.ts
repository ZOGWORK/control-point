// Swing (Control Scout's consistency stat) worked out here must be the number Control Scout shows for the same
// matches. The fixture and pinned numbers are copied from the engine's
// (control-scout packages/predict-engine/src/__tests__/fixtures/consistencyFixture.ts), which Scout's own
// reliability job is tested against: same inputs, same numbers in both apps.
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '@control-scout/predict-engine';
import { eventAlliances, eventSwing, swingText, swingTitle } from '../consistency';
import type { FtcAllianceScore, FtcEventFull, FtcMatchFull, FtcPointSplit, FtcTeamEventStats } from '../../types/ftcScout';

const OPR: Record<number, number> = { 1: 40, 2: 30, 3: 20, 4: 10 };
const FIELD_VAR = 0.04;
/** Team → [contributions, swing to 12 places], exactly as the engine's fixture pins them. */
const PINNED: Record<number, [number, string]> = { 1: [5, '0.243124151165'], 2: [4, '0.205183300301'], 3: [5, '0.206916109560'], 4: [4, '0.198766188424'] };

const split = (np: number): FtcPointSplit => ({ total: np, totalNp: np, auto: 0, teleop: np, endgame: 0, penaltiesCommitted: 0, penaltiesByOpp: 0 });
const side = (np: number, teams: number[], noShow: number[] = []): FtcAllianceScore => ({
  teams: [...teams.map((n) => ({ number: n, name: `T${n}` })), ...noShow.map((n) => ({ number: n, name: `T${n}`, onField: false }))], score: split(np),
});
let k = 0;
const match = (red: FtcAllianceScore, blue: FtcAllianceScore, o: Partial<FtcMatchFull> = {}): FtcMatchFull => {
  k++;
  return { key: `qual:0:${k}`, level: 'qual', series: 0, number: k, label: `Q-${k}`, description: null, time: `2025-11-01T${String(8 + k).padStart(2, '0')}:00:00`, played: true, red, blue, breakdownSource: null, ...o };
};
const stats = (n: number): FtcTeamEventStats => ({ teamNumber: n, name: `T${n}`, rank: null, rp: null, wins: null, losses: null, ties: null, qualMatchesPlayed: null, opr: { ...split(OPR[n]), totalNp: OPR[n] }, avg: null, awards: [] });

// Listed out of order on purpose: the swing follows play order (recorded time), as Scout's does.
const matches = [
  match(side(64, [1, 2]), side(26, [3, 4]), { time: '2025-11-01T12:00:00' }),
  match(side(80, [1, 2]), side(30, [3, 4]), { time: '2025-11-01T09:00:00' }),
  match(side(50, [1, 3]), side(45, [2, 4]), { time: '2025-11-01T10:00:00' }),
  match(side(60, [1, 4]), side(55, [2, 3]), { time: '2025-11-01T11:00:00' }),
  // 4 a no-show: 2 played alone, so neither gets a contribution from this match.
  match(side(66, [1, 3]), side(35, [2], [4]), { time: '2025-11-01T13:00:00' }),
  // Never counted: a playoff, and a qual with no score yet.
  match(side(200, [1, 2]), side(10, [3, 4]), { level: 'playoff' }),
  match(side(0, [1, 2]), { teams: [{ number: 3, name: 'T3' }, { number: 4, name: 'T4' }], score: null }, { played: false }),
];
const ev: Pick<FtcEventFull, 'matches' | 'field'> = { matches, field: [1, 2, 3, 4].map(stats) };

describe('swing (consistency) in Control Point', () => {
  it('runs the shared engine at the version Control Scout ships', () => {
    expect(ENGINE_VERSION).toBe('3.5.0');
  });

  it('the event becomes the engine fixture: played quals in play order, red then blue, no-shows off the field', () => {
    expect(eventAlliances(ev)).toEqual([
      { np: 80, onField: [1, 2] }, { np: 30, onField: [3, 4] },
      { np: 50, onField: [1, 3] }, { np: 45, onField: [2, 4] },
      { np: 60, onField: [1, 4] }, { np: 55, onField: [2, 3] },
      { np: 64, onField: [1, 2] }, { np: 26, onField: [3, 4] },
      { np: 66, onField: [1, 3] }, { np: 35, onField: [2] },
    ]);
  });

  it("the same numbers Control Scout's engine test pins", () => {
    const by = eventSwing(ev, FIELD_VAR)!;
    expect(Object.fromEntries([1, 2, 3, 4].map((t) => [t, [by.get(t)!.matches, by.get(t)!.swing.toFixed(12)]]))).toEqual(PINNED);
  });

  it('reads the exact OPR, not the one-decimal one shown (Scout uses the exact one)', async () => {
    const { eventConsistency } = await import('@control-scout/predict-engine');
    const exact: Record<number, number> = { 1: 40.04, 2: 29.96, 3: 20.049, 4: 9.951 };
    const fractional = { matches, field: [1, 2, 3, 4].map((n) => ({ ...stats(n), opr: { ...split(Math.round(exact[n] * 10) / 10) }, oprNpExact: exact[n] })) };
    const by = eventSwing(fractional, FIELD_VAR)!;
    const want = eventConsistency(eventAlliances(ev), (t) => exact[t] ?? null, FIELD_VAR);
    for (const t of [1, 2, 3, 4]) expect(by.get(t)!.swing).toBe(want.get(t)!.swing);
    // Without the exact one (an event cached before it was kept), the shown OPR still gives a number.
    expect(eventSwing({ matches, field: [1, 2, 3, 4].map(stats) }, FIELD_VAR)!.get(1)!.swing.toFixed(12)).toBe(PINNED[1][1]);
  });

  it('below 5 matches: "—" with the reason; no season field: no number at all', () => {
    const by = eventSwing(ev, FIELD_VAR)!;
    expect(swingText(by.get(1))).toBe('±0.24');
    expect(swingText(by.get(2))).toBe('—');
    expect(swingTitle(by.get(2))).toMatch(/^Only 4 qualification matches with a partner's OPR known \(needs 5\)\. Swing \(consistency\): sd of/);
    expect(eventSwing(ev, null)).toBeNull();
    expect(swingText(null)).toBe('—');
  });
});
