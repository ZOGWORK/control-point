// The Prints explorer: folders and groups together, combined group filters
// with counts, search, selection actions (mark printed, move, download), the
// folder delete question with its file count, drag onto a collection, keyboard
// delete, and the read-only view for members without manage_prints.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const dlg = vi.hoisted(() => ({ confirmDialog: vi.fn(), notify: vi.fn() }));
vi.mock('../../services/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../components/dialog', async (orig) => ({ ...(await orig<object>()), ...dlg }));
vi.mock('../../components/PrintViewer', () => ({ default: ({ name }: any) => <div role="img" aria-label={`3D preview of ${name}`} /> }));

import { PrintsPage } from '../pages/prints/PrintsPage';
import type { PrintFile, PrintLibrary } from '../../types/prints';

// The page and its lazy chunks take a few seconds to settle in jsdom on a busy machine.
configure({ asyncUtilTimeout: 8000 });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
const res = (body: any, ok = true, status = ok ? 200 : 400) => Promise.resolve({ ok, status, json: async () => body });

const file = (id: number, name: string, over: Partial<PrintFile> = {}): PrintFile => ({
  id, folderId: null, name, kind: 'stl', size: 2048 * id, createdAt: '2026-10-20T10:00:00Z', updatedAt: `2026-10-2${id % 8}T10:00:00Z`, uploadedBy: 'Ada', notes: '',
  robotId: null, season: null, cadPart: null, subsystem: null, subsystemFrom: null, material: null, status: 'to_print', copiesNeeded: null, copiesNeededFrom: null,
  copiesPrinted: 0, collections: [], hasThumb: false, source: 'upload', ...over,
});
let lib: PrintLibrary;
const seed = (): PrintLibrary => ({
  canEdit: true,
  usage: { used: 5 * 1048576, quota: 2048 * 1048576, maxFile: 100 * 1048576 },
  folders: [
    { id: 1, parentId: null, name: '2025–26 DECODE', createdAt: '', updatedAt: '2026-10-20T10:00:00Z' },
    { id: 2, parentId: 1, name: 'Intake', createdAt: '', updatedAt: '2026-10-20T10:00:00Z' },
  ],
  files: [
    file(1, 'Roller hub.stl', { folderId: 2, subsystem: 'Intake', subsystemFrom: 'cad', material: 'PETG', copiesNeeded: 4, copiesNeededFrom: 'cad', robotId: 1, season: 2025, collections: [1] }),
    file(2, 'Roller spacer.stl', { folderId: 2, subsystem: 'Intake', material: 'TPU', status: 'printed', robotId: 1, season: 2025 }),
    file(3, 'Lift spool.3mf', { kind: '3mf', folderId: 1, subsystem: 'Lift', material: 'PETG', status: 'failed', robotId: 1, season: 2025 }),
    file(4, 'Camera mount.step', { kind: 'step' }),
    file(5, 'Plate.gcode', { kind: 'gcode', material: 'PLA', status: 'printing' }),
  ],
  collections: [{ id: 1, name: 'Comp spares', files: 1 }, { id: 2, name: 'Worlds kit', files: 0 }],
  robots: [{ id: 1, name: 'MR. HORS', season: 2025, seasonName: '2025–26 DECODE' }],
  subsystems: ['Drivetrain', 'Intake', 'Lift'],
});
const calls = () => api.apiFetch.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([url, init]) => ({ url, method: init.method, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body }));

beforeEach(() => {
  lib = seed();
  api.apiFetch.mockReset();
  api.apiFetch.mockImplementation((url: string, init?: any) => {
    if (url === '/api/prints/library') return res(lib);
    if (url.startsWith('/api/prints/activity')) return res([]);
    if (url.startsWith('/api/cad/robots/')) return res({ parts: [] });
    return res({ success: true, files: 1 });
  });
  dlg.confirmDialog.mockReset().mockResolvedValue(true);
  dlg.notify.mockReset();
  try { localStorage.clear(); } catch { /* none */ }
});
afterEach(cleanup);

let where = '';
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const setup = (url = '/prints') => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="*" element={<><PrintsPage /><Where /></>} /></Routes>
  </MemoryRouter>,
);
const sidebar = () => screen.getAllByRole('navigation', { name: 'Folders and groups' })[0];
const contents = () => screen.getByRole('list', { name: /^Contents of/ });
/** A file's or folder's own button in the list (not its options button). */
const item = (name: string) => within(contents()).getAllByRole('button').find((b) => !b.getAttribute('aria-label') && (b.textContent ?? '').startsWith(name))!;

describe('Prints explorer', () => {
  it('opens on the top level: folders, loose files, the path and the counts', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: /All prints · 2 files · 1 still to print/ })).toBeTruthy();
    const list = contents();
    expect(item('2025–26 DECODE')).toBeTruthy();
    expect(item('Camera mount.step')).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /Roller hub/ })).toBeNull();
    fireEvent.click(item('2025–26 DECODE'));
    expect(where).toBe('/prints?folder=1');
    expect(await screen.findByRole('heading', { name: /2025–26 DECODE · 1 file · 1 still to print/ })).toBeTruthy();
    const path = screen.getByRole('navigation', { name: 'Folder path' });
    expect(within(path).getByRole('button', { name: '2025–26 DECODE' }).getAttribute('aria-current')).toBe('page');
  });

  it('combines groups from the sidebar: Intake + PETG + To print', async () => {
    setup();
    await screen.findByRole('heading', { name: /All prints/ });
    const nav = sidebar();
    fireEvent.click(within(nav).getByRole('button', { name: /^Intake:/ }));
    expect(await screen.findByRole('heading', { name: /Intake · 2 files · 1 still to print/ })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: /^PETG:/ }));
    fireEvent.click(within(nav).getByRole('button', { name: /^To print:/ }));
    expect(await screen.findByRole('heading', { name: /Intake \+ PETG \+ To print · 1 file · 1 still to print/ })).toBeTruthy();
    expect(where).toContain('sub=Intake');
    expect(where).toContain('mat=PETG');
    expect(where).toContain('status=to_print');
    // The file shows where it lives.
    expect(within(contents()).getByRole('button', { name: /Roller hub\.stl.*2025–26 DECODE \/ Intake/ })).toBeTruthy();
    // A chip removes one group.
    fireEvent.click(screen.getByRole('button', { name: 'Remove PETG' }));
    expect(await screen.findByRole('heading', { name: /Intake \+ To print · 1 file/ })).toBeTruthy();
  });

  it('searches the whole library', async () => {
    setup();
    await screen.findByRole('heading', { name: /All prints/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the library' }), { target: { value: 'roller' } });
    expect(await screen.findByRole('heading', { name: /Search “roller” · 2 files/ })).toBeTruthy();
  });

  it('marks a selection printed, and downloads a group as one ZIP', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setup('/prints?sub=Intake');
    await screen.findByRole('heading', { name: /Intake · 2 files/ });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Roller hub.stl' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Roller spacer.stl' }));
    const bar = screen.getByRole('toolbar', { name: 'Selected files' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Printed' }));
    await waitFor(() => expect(calls()).toContainEqual({ url: '/api/prints/files/bulk', method: 'POST', body: { ids: [1, 2], action: 'status', status: 'printed' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Download all' }));
    const a = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/api/prints/zip?files=1,2&name=Intake');
    click.mockRestore();
  });

  it('moves a file with the Move to picker', async () => {
    setup();
    await screen.findByRole('heading', { name: /All prints/ });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Camera mount.step' }));
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selected files' })).getByRole('button', { name: /Move to/ }));
    const dialog = await screen.findByRole('dialog', { name: /Move/ });
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Intake/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Move here/ }));
    await waitFor(() => expect(calls()).toContainEqual({ url: '/api/prints/files/bulk', method: 'POST', body: { ids: [4], action: 'move', folderId: 2 } }));
  });

  it('asks before deleting a folder that holds files, and says how many', async () => {
    setup();
    await screen.findByRole('heading', { name: /All prints/ });
    fireEvent.pointerDown(within(contents()).getByRole('button', { name: '2025–26 DECODE options' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    await waitFor(() => expect(dlg.confirmDialog).toHaveBeenCalled());
    const ask = dlg.confirmDialog.mock.calls[0][0];
    expect(ask.message).toContain('3 files');
    expect(ask.message).toContain('1 folder inside it');
    expect(ask.confirmLabel).toBe('Delete folder and 3 files');
    await waitFor(() => expect(calls()).toContainEqual({ url: '/api/prints/folders/1?files=3', method: 'DELETE', body: undefined }));
  });

  it('adds dragged files to a collection dropped on in the sidebar', async () => {
    setup();
    await screen.findByRole('heading', { name: /All prints/ });
    const store: Record<string, string> = {};
    const dataTransfer = { types: [] as string[], setData: (k: string, v: string) => { store[k] = v; dataTransfer.types = Object.keys(store); }, getData: (k: string) => store[k] ?? '', files: [] as File[], effectAllowed: '', dropEffect: '' };
    const row = item('Plate.gcode').closest('li')!;
    fireEvent.dragStart(row, { dataTransfer });
    const target = within(sidebar()).getByRole('button', { name: /^Worlds kit:/ }).closest('li')!;
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(calls()).toContainEqual({ url: '/api/prints/files/bulk', method: 'POST', body: { ids: [5], action: 'collect', collectionId: 2 } }));
  });

  it('deletes the focused file with the Delete key, after asking', async () => {
    setup();
    await screen.findByRole('heading', { name: /All prints/ });
    const name = item('Camera mount.step');
    name.focus();
    fireEvent.keyDown(name, { key: 'Delete' });
    await waitFor(() => expect(dlg.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Camera mount.step?' })));
    await waitFor(() => expect(calls()).toContainEqual({ url: '/api/prints/files/bulk', method: 'POST', body: { ids: [4], action: 'delete' } }));
  });

  it('opens details with the CAD-derived subsystem and copies', async () => {
    setup('/prints?folder=2');
    await screen.findByRole('heading', { name: /Intake ·/ });
    fireEvent.click(item('Roller hub.stl'));
    const sheet = await screen.findByRole('dialog', { name: 'Roller hub.stl' });
    expect(within(sheet).getByText(/The robot needs 4, from the CAD part's quantity/)).toBeTruthy();
    expect(within(sheet).getByText(/Subsystem Intake comes from the CAD part's section/)).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Comp spares' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Printing' }));
    await waitFor(() => expect(calls()).toContainEqual({ url: '/api/prints/files/1', method: 'PATCH', body: { status: 'printing' } }));
  });

  it('is read-only for members without manage_prints', async () => {
    lib = { ...seed(), canEdit: false };
    api.apiFetch.mockImplementation((url: string) => (url === '/api/prints/library' ? res(lib) : res([])));
    setup();
    await screen.findByRole('heading', { name: /All prints/ });
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New collection' })).toBeNull();
    fireEvent.click(item('Camera mount.step'));
    const sheet = await screen.findByRole('dialog', { name: 'Camera mount.step' });
    expect(within(sheet).queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(within(sheet).getByRole('button', { name: /Download/ })).toBeTruthy();
  });
});
