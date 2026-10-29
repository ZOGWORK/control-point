// A robot's BOM from Control Kit (contract v1.1): every line in its group,
// the choices people make here and what they send, the import banner, the old
// /cad-parts?import= link, and the assembly picture shown whole.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../services/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../components/CadModelViewer', () => ({ default: () => null }));

import { InterfaceModeProvider } from '../interfaceMode';
import { CadPage } from '../pages/cad/CadPage';
import { clearDrafts } from '../drafts';
import { effectivePart } from '../../types/cadBom';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
const res = (body: any, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => body });
const me = { id: 7, name: 'Ada', team_id: 1, interface_mode: 'modern' };

const bearing = { id: 'gobilda:1611001408', vendor: 'gobilda', sku: '1611-0014-0008', normalizedSku: '1611001408', name: '1611 Flanged Bearing - 2 Pack', priceUsd: 5.99, unitsPerPack: 2, stock: 'in', url: 'https://www.gobilda.com/a', image: null, kind: 'match' };
const near = { ...bearing, id: 'gobilda:1611001410', normalizedSku: '1611001410', sku: '1611-0014-0010', name: '1611 Flanged Bearing (10mm) - 2 Pack', stock: 'low', kind: 'near' };
const line = (part: string, over: Record<string, unknown>) => ({ identity: `d:ps:${part}:default`, documentId: 'd', elementId: 'ps', name: part, disposition: 'review', manualOverride: null, matchStatus: 'unmatched', candidates: [], partStudioUrl: 'https://cad.onshape.com/documents/d/w/w/e/ps', ...over });
const row = (id: number, name: string, extra: any, over: Record<string, unknown> = {}) => {
  const p = { id, name, quantity: 4, unit_cost: 0, source: 'other', status: 'to_order', assignee: '', notes: '', section: 'Other', ck_part_key: extra ? `d:ps:${name}:default` : null, ck_import_id: 41, ck_removed_at: null, ck_extra: extra,
    choice_type: null, choice_type_set: 0, choice_type_by: null, choice_type_at: null, choice_product: null, choice_product_by: null, choice_product_at: null, ...over };
  return { ...p, effective: effectivePart(p as any) };
};
let parts: any[] = [];
const seed = () => [
  row(1, 'Bearing block', line('Bearing block', { disposition: 'buy', matchStatus: 'possible', vendor: 'gobilda', matchNormalizedSku: '1611001408', candidates: [bearing, near], reviewReason: null })),
  row(2, 'Intake plate', line('Intake plate', { reviewReason: 'Team-designed part: choose how it is made' })),
  row(3, 'Side panel', line('Side panel', { disposition: 'cut-2d' })),
  row(4, 'M4x12 SHCS', line('M4x12 SHCS', { disposition: 'hardware' })),
  row(5, 'Old sketch body', line('Old sketch body', { disposition: 'ignore' })),
  row(6, 'Yellow Jacket', line('Yellow Jacket', { disposition: 'buy', matchStatus: 'exact', vendor: 'gobilda', matchNormalizedSku: '1611001408', candidates: [bearing], lineTotalUsd: 11.98 }), { unit_cost: 2.995 }),
  row(7, 'Dropped bracket', line('Dropped bracket', { disposition: 'print' }), { ck_removed_at: '2026-10-26T15:00:00.000Z' }),
  row(8, 'Hand bumper', null, { source: 'printed' }),
];
const imports = [{ id: 41, sentAt: '2026-10-26T15:00:00.000Z', sentBy: 'Sam', assemblyName: 'MR. HORS', assemblyUrl: null, revision: 'v/1', partCount: 7, created: 7, updated: 0, markedRemoved: 0,
  files: [{ name: 'MR. HORS assembly.png', stored: true, url: '/api/files/8' }, { name: 'MR. HORS BOM.xlsx', stored: true, url: '/api/files/9' }, { name: 'MR. HORS STEP.zip', stored: false, note: 'Available in Control Kit' }] }];
let canManage = true;
const detail = () => ({
  robot: { id: 1, name: 'MR. HORS', season: 2025, seasonName: '2025–26 DECODE', isMain: true, assemblyUrl: 'https://cad.onshape.com/documents/d/w/w/e/a', documentId: 'd', elementId: 'a', notes: '' },
  canManage, parts, imports,
  summary: { counts: { review: 1, buy: 2, make: 2, hardware: 1, ignore: 1 }, parts: 7, totalUsd: 11.98, priced: 1, buyLines: 2, pending: 0 },
});

beforeEach(() => {
  canManage = true;
  parts = seed();
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation((url: string, init?: any) => {
    if (init?.method === 'POST' && /\/choice$/.test(url)) {
      const id = Number(url.split('/')[4]);
      const body = JSON.parse(init.body);
      const p = parts.find((x) => x.id === id)!;
      const next = { ...p, ...(body.type !== undefined ? { choice_type: body.type, choice_type_set: 1, choice_type_by: 'Ada', choice_type_at: '2099-01-01T00:00:00Z' } : {}),
        ...(body.product !== undefined ? { choice_product: body.product, choice_product_by: 'Ada', choice_product_at: '2099-01-01T00:00:00Z' } : {}) };
      const saved = { ...next, effective: effectivePart(next as any) };
      parts = parts.map((x) => (x.id === id ? saved : x));
      return res(saved);
    }
    if (url === '/api/cad/robots/1') return res(detail());
    if (url === '/api/cad/records/import/41/robot') return res({ robotId: 1 });
    return res([]);
  });
  clearDrafts();
});
afterEach(cleanup);

let where = '';
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const setup = (url: string) => render(
  <InterfaceModeProvider user={me} team={{}} onUserSaved={() => {}}>
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="*" element={<><CadPage currentUser={{ id: 7 }} isAdmin={false} /><Where /></>} /></Routes>
    </MemoryRouter>
  </InterfaceModeProvider>,
);

describe("a robot's BOM", () => {
  it('shows every line in its group, the parts a later scan dropped apart, and the assembly picture whole', async () => {
    setup('/cad/robots/1');
    expect(await screen.findByRole('heading', { name: 'MR. HORS' })).toBeInTheDocument();
    for (const [group, name] of [['Needs a decision', 'Intake plate'], ['Buy', 'Bearing block'], ['Make', 'Side panel'], ['Fasteners', 'M4x12 SHCS'], ['Not needed', 'Old sketch body']]) {
      const section = screen.getByRole('heading', { name: new RegExp(`^${group}`) }).closest('section')!;
      expect(within(section).getByRole('button', { name })).toBeInTheDocument();
    }
    // Hand-made rows stay in the BOM by their source.
    expect(within(screen.getByRole('heading', { name: /^Make/ }).closest('section')!).getByRole('button', { name: 'Hand bumper' })).toBeInTheDocument();
    expect(screen.getByText('1 part not in the latest scan')).toBeInTheDocument();
    expect(screen.getByText('$11.98', { selector: 'p' })).toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'MR. HORS assembly' });
    expect(img).toHaveAttribute('src', '/api/files/8');
    expect(img.className).toContain('object-contain');
  });

  it('chooses how a part is made, and a product from its matches; both say they reach Control Kit at its next scan', async () => {
    setup('/cad/robots/1');
    fireEvent.click(await screen.findByRole('button', { name: 'Intake plate' }));
    let drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: '3D print' }));
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith('/api/cad/parts/2/choice', expect.objectContaining({ method: 'POST', body: JSON.stringify({ type: 'print' }) })));
    expect(await within(drawer).findByText(/reaches Control Kit at its next scan/)).toBeInTheDocument();
    // The row moves to Make behind the drawer.
    const make = screen.getByRole('heading', { name: /^Make/, hidden: true }).closest('section')!;
    expect(within(make).getByRole('button', { name: 'Intake plate', hidden: true })).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Bearing block' }));
    drawer = await screen.findByRole('dialog');
    // Control Kit's possible match is a suggestion, not a product in use.
    expect(within(within(drawer).getByText('1611 Flanged Bearing - 2 Pack').closest('li')!).getByText('Suggested')).toBeInTheDocument();
    const nearRow = within(drawer).getByText('1611 Flanged Bearing (10mm) - 2 Pack').closest('li')!;
    expect(within(nearRow).getByText('Low stock')).toBeInTheDocument();
    expect(within(nearRow).getByText('≈ $11.98 for 4')).toBeInTheDocument();
    fireEvent.click(within(nearRow).getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith('/api/cad/parts/1/choice', expect.objectContaining({ body: JSON.stringify({ product: 'gobilda:1611001410' }) })));
    expect(await within(nearRow).findByText('In use')).toBeInTheDocument();
  });

  it("leaves the choices read-only for a role without Manage CAD", async () => {
    canManage = false;
    setup('/cad/robots/1');
    fireEvent.click(await screen.findByRole('button', { name: 'Intake plate' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/Your role can’t change CAD choices/)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '3D print' })).toBeDisabled();
  });

  it('opens an old /cad-parts?import= link on that import’s robot, with the import summary', async () => {
    setup('/cad-parts?import=41');
    await waitFor(() => expect(where).toBe('/cad/robots/1?import=41'));
    expect(await screen.findByText('MR. HORS from Control Kit')).toBeInTheDocument();
    expect(screen.getByText(/7 parts · 7 new, 0 updated/)).toBeInTheDocument();
  });

  it('lists the files Control Kit sent on the Files tab', async () => {
    setup('/cad/robots/1?tab=files');
    expect(await screen.findByRole('link', { name: 'MR. HORS BOM.xlsx' })).toHaveAttribute('href', '/api/files/9');
    expect(screen.getByText('Not uploaded yet. In Control Kit, press Add STEP files.')).toBeInTheDocument();
  });

  it('downloads the newest STEP zip and workbook from the header, the Make group and the Files tab', async () => {
    const zip = { name: 'MR. HORS STEP.zip', stored: true, url: '/api/files/12', sizeBytes: 3_400_000 };
    imports.unshift({ ...imports[0], id: 42, sentAt: '2026-10-27T15:00:00.000Z', files: [{ name: 'MR. HORS BOM.xlsx', stored: true, url: '/api/files/13' }] } as any);
    imports[1] = { ...imports[1], files: [...imports[1].files.filter((f) => !/zip$/.test(f.name)), zip] } as any;
    try {
      setup('/cad/robots/1');
      const step = await screen.findByRole('link', { name: /STEP files for every part to make/ });
      expect(step).toHaveAttribute('href', '/api/files/12');
      expect(step).toHaveAttribute('download', 'MR. HORS STEP.zip');
      // The workbook is the newest send's; the zip comes from the send that had one.
      expect(screen.getByRole('link', { name: 'Workbook' })).toHaveAttribute('href', '/api/files/13');
      const make = screen.getByRole('heading', { name: /^Make/ }).closest('section')!;
      expect(within(make).getByRole('link', { name: 'STEP files' })).toHaveAttribute('href', '/api/files/12');
      cleanup();
      setup('/cad/robots/1?tab=files');
      expect(await screen.findByText(/STEP files from the send of/)).toBeInTheDocument();
    } finally {
      imports.shift();
      imports[0] = { ...imports[0], files: imports[0].files.filter((f) => !/zip$/.test(f.name)).concat({ name: 'MR. HORS STEP.zip', stored: false, note: 'Available in Control Kit' } as any) } as any;
    }
  });

  it("shows each part's Onshape picture in its row and drawer", async () => {
    parts = parts.map((p) => (p.id === 3 ? { ...p, ck_picture_url: '/api/files/30', ck_picture_at: '2026-10-27T15:00:00.000Z' } : p));
    setup('/cad/robots/1');
    const make = (await screen.findByRole('heading', { name: /^Make/ })).closest('section')!;
    expect(within(make).getByRole('img', { name: 'Side panel in Onshape' })).toHaveAttribute('src', '/api/files/30');
    fireEvent.click(within(make).getByRole('button', { name: 'Side panel' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('img', { name: 'Side panel in Onshape' })).toHaveAttribute('src', '/api/files/30');
    expect(within(drawer).getByText(/Picture drawn by Onshape, from Control Kit/)).toBeInTheDocument();
  });
});
