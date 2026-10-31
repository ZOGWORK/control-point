// The full why breakdown (shared engine 3.3, ForecastMatch.factorSheet) under the Predict tab's upcoming match rows.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FITTED_MODEL, RatingBook, compactFactorSheet, explainMatch, type MatchRecord } from '@control-scout/predict-engine';
import type { ForecastView } from '../../services/predictApi';

vi.mock('../../services/reliabilityApi', () => ({ useReliability: () => ({ by: new Map(), fieldIndex: null }) }));
const { MatchesTab } = await import('../pages/predict/PredictTabs');

/** A real engine sheet: team 1 is the auto specialist. */
function sheet() {
  const book = new RatingBook(FITTED_MODEL.rating);
  book.startSeason(2025);
  const al = (teams: number[], auto: number, teleop: number) => ({ teams, auto, teleop, endgame: 10, np: auto + teleop + 10, penCommitted: 0, total: auto + teleop + 10 });
  for (let n = 1; n <= 12; n++) {
    const m: MatchRecord = { season: 2025, eventCode: 'E', level: 'qual', series: 0, number: n, time: Date.UTC(2025, 10, 1) + n * 6e4, red: al(n % 2 ? [1, 2] : [1, 3], 50, 80), blue: al(n % 2 ? [3, 4] : [2, 4], 15, 70) };
    book.update(m);
  }
  return compactFactorSheet(explainMatch(book, [1, 2], [3, 4], { noise: FITTED_MODEL.noise, contextual: FITTED_MODEL.contextual, context: { level: 'qual', event: 'E' } }).factorSheet);
}

const m = (key: string, played: { red: number; blue: number } | null, factorSheet: unknown) =>
  ({ key, label: key, level: 'qual', red: [1, 2], blue: [3, 4], pRedWin: played ? null : 0.7, redMean: 120, blueMean: 90, redBand: null, blueBand: null, played, factorSheet });
const show = (matches: unknown[]) =>
  render(<MemoryRouter><MatchesTab fc={{ season: 2025, matches } as unknown as ForecastView} myTeam={null} /></MemoryRouter>);

afterEach(() => cleanup());

describe('Predict matches: full why breakdown', () => {
  it('puts every factor with its share behind an expander under an upcoming match', () => {
    const s = sheet();
    show([m('Q1', null, s)]);
    const panel = screen.getByTestId('factor-sheet');
    expect(panel.hasAttribute('open')).toBe(false);
    expect(within(panel).getByText(/Full why breakdown/)).toBeTruthy();
    for (const f of [...s.phases, ...s.model, ...s.reasons]) expect(within(panel).getByText(f.name)).toBeTruthy();
    expect(within(panel).getByText('Schedule strength').closest('li')!.textContent).toContain('0%');
  });

  it('draws what the call leans on as one bar whose segments fill it exactly', () => {
    show([m('Q1', null, sheet())]);
    const bar = within(screen.getByTestId('sheet-tug')).getByRole('img');
    const widths = [...bar.children].map((c) => parseFloat((c as HTMLElement).style.width));
    expect(widths.reduce((a, w) => a + w, 0)).toBeCloseTo(100, 6);
  });

  it('adds nothing to played matches, or to a forecast without sheets', () => {
    show([m('Q2', { red: 50, blue: 60 }, null), m('Q3', null, undefined)]);
    expect(screen.queryByTestId('factor-sheet')).toBeNull();
  });
});
