import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../services/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../components/CadModelViewer', () => ({ default: () => null }));

import { InterfaceModeProvider } from '../interfaceMode';
import { CadPage, TABS, partsHint } from '../pages/cad/CadPage';
import { clearDrafts } from '../drafts';
import { bomCost, subtotalText } from '../../utils/cadCost';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
const json = (body: any) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const me = { id: 7, name: 'Ada', team_id: 1, interface_mode: 'modern' };
// The CAD page from the owner's screenshot: ten goBILDA parts, none priced, all to order.
const unpriced = ['104mm Mecanum Wheel', '1611 Bearing', '5203 Yellow Jacket Motor', '1120 U-Channel', '1121 U-Channel']
  .flatMap((name, i) => [
    { id: i * 2 + 1, name, section: 'Drivetrain', quantity: 2, source: 'gobilda', unit_cost: 0, status: 'to_order', assignee: '' },
    { id: i * 2 + 2, name: `${name} spare`, section: 'Chassis', quantity: 1, source: 'gobilda', unit_cost: 0, status: 'to_order', assignee: '' },
  ]);
let db: Record<string, any>;

beforeEach(() => {
  db = {
    '/api/cad/dashboard': { docsCount: 1, pendingReviews: 0, snapshotsCount: 0, partsCount: 10, partsTotalCost: 0, partsPriced: 0, partsToOrder: 10, needsAttention: [], recent: [] },
    '/api/cad/parts': unpriced,
  };
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation((url: string) => json(db[url] ?? []));
  clearDrafts();
  localStorage.clear();
});
afterEach(cleanup);

const setup = (tab: string) => render(
  <InterfaceModeProvider user={me} team={{}} onUserSaved={() => {}}>
    <MemoryRouter initialEntries={[`/${tab}`]}>
      <Routes><Route path="*" element={<CadPage activeTab={tab} currentUser={{ id: 7 }} isAdmin={false} />} /></Routes>
    </MemoryRouter>
  </InterfaceModeProvider>,
);

describe('CAD remodel', () => {
  it('orders the tabs Overview, Parts list, Onshape docs, Design reviews, Snapshots without renaming routes', () => {
    expect(TABS.map((t) => t.id)).toEqual(['cad', 'cad-parts', 'cad-docs', 'cad-reviews', 'cad-snapshots']);
    setup('cad');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Parts list', 'Onshape docs', 'Design reviews', 'Snapshots']);
  });

  it('an unpriced BOM is never shown as a complete $0.00 total', async () => {
    setup('cad-parts');
    expect(await screen.findByText('No prices yet', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00 priced subtotal · 0 of 10 lines priced · 10 to order/)).toBeInTheDocument();
    // Each subsystem says it has no prices instead of a bare $0.00.
    expect(screen.getAllByText('No prices yet', { selector: 'span' })).toHaveLength(2);
  });

  it('partly priced totals say how much is covered', () => {
    const parts = [{ quantity: 4, unit_cost: 10, status: 'installed' }, { quantity: 2, unit_cost: 0, status: 'to_order' }];
    expect(bomCost(parts)).toEqual({ total: 40, priced: 1, unpriced: 1, lines: 2, toOrder: 1 });
    expect(subtotalText(bomCost(parts))).toBe('$40.00 priced · 1 unpriced');
    expect(partsHint({ partsCount: 10, partsTotalCost: 0, partsPriced: 0 })).toBe('No prices yet');
    expect(partsHint({ partsCount: 3, partsTotalCost: 120.5, partsPriced: 2 })).toBe('$120.50 · 2 of 3 priced');
  });

  it('Import from Control Kit opens the app in a new tab, beside Import invoice and Add part', async () => {
    setup('cad-parts');
    const link = await screen.findByRole('link', { name: /Import from Control Kit/ });
    expect(link).toHaveAttribute('href', 'https://control-kit.pages.dev');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: /Import invoice/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Add part/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/once linking is enabled/)).toBeInTheDocument();
  });

  it('the Overview card links to Control Kit externally and stays dismissed for that person', async () => {
    setup('cad');
    const card = (await screen.findByText('Make a BOM from this CAD')).closest('div')!.parentElement!;
    const link = within(card).getByRole('link', { name: /Open Control Kit/ });
    expect(link).toHaveAttribute('href', 'https://control-kit.pages.dev');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('No prices yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the Control Kit card' }));
    expect(screen.queryByText('Make a BOM from this CAD')).toBeNull();
    cleanup();
    setup('cad');
    await screen.findByText('Parts');
    expect(screen.queryByText('Make a BOM from this CAD')).toBeNull();
  });

  it.each([
    ['cad-docs', 'Turn these Onshape docs into a BOM'],
    ['cad-reviews', 'Check what a design needs before it is approved'],
    ['cad-snapshots', 'Get STEP files and a parts list from Onshape'],
  ])('%s has its own Control Kit card, linking out in a new tab', async (tab, title) => {
    setup(tab);
    const card = (await screen.findByText(title)).closest('div')!.parentElement!;
    const link = within(card).getByRole('link', { name: /Open Control Kit/ });
    expect(link).toHaveAttribute('href', 'https://control-kit.pages.dev');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByText('Make a BOM from this CAD')).toBeNull();
  });

  it('the Parts list keeps its Import button instead of a card', async () => {
    setup('cad-parts');
    await screen.findByRole('link', { name: /Import from Control Kit/ });
    expect(screen.queryByRole('link', { name: /Open Control Kit/ })).toBeNull();
  });

  it('dismissing the card on one CAD tab hides it on every tab', async () => {
    setup('cad-reviews');
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss the Control Kit card' }));
    expect(screen.queryByRole('link', { name: /Open Control Kit/ })).toBeNull();
    for (const tab of ['cad', 'cad-docs', 'cad-snapshots']) {
      cleanup();
      setup(tab);
      await screen.findByRole('tab', { name: 'Overview' });
      expect(screen.queryByRole('link', { name: /Open Control Kit/ })).toBeNull();
    }
  });
});
