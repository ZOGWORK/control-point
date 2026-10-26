import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../services/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../components/CadModelViewer', () => ({ default: () => null }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: vi.fn() }));
vi.mock('../../components/dialog', async (orig) => ({ ...(await orig<object>()), ...dialogs }));

import { ControlKitConsentPage } from '../pages/connect/ControlKitConsentPage';
import { ConnectedApps } from '../pages/settings/ConnectedApps';
import { CadPage } from '../pages/cad/CadPage';
import { InterfaceModeProvider } from '../interfaceMode';
import { clearDrafts } from '../drafts';
import { controlKitConnectPending, controlKitRedirect, rememberControlKitConnect, takeControlKitConnect } from '../../utils/controlKitConnect';
import { isKnownRoute } from '../../utils/publicRoutes';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
const res = (body: any, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const REDIRECT = 'https://control-kit.control-kit-worker.workers.dev/control-point/callback';
const consentUrl = `/connect/control-kit?state=abc&redirect_uri=${encodeURIComponent(REDIRECT)}`;
let assign: ReturnType<typeof vi.fn>;
let had: Location;

beforeEach(() => {
  api.apiFetch.mockReset();
  dialogs.notify.mockReset();
  clearDrafts();
  sessionStorage.clear();
  had = window.location;
  assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...had, assign } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: had });
});

const consent = (url = consentUrl, onSignOut = () => {}) => render(
  <MemoryRouter initialEntries={[url]}><ControlKitConsentPage onSignOut={onSignOut} /></MemoryRouter>,
);

describe('Control Kit consent page', () => {
  it('is a known route', () => {
    expect(isKnownRoute('/connect/control-kit')).toBe(true);
  });

  it('shows the account and the workspaces Control Kit will see, and Allow sends the code back', async () => {
    api.apiFetch.mockImplementation((url: string, init?: any) => {
      if (url.startsWith('/api/integrations/control-kit/consent')) {
        expect(url).toContain(encodeURIComponent(REDIRECT));
        return res({ account: { email: 'sam@hors.org', name: 'Sam' }, workspaces: [
          { id: 12, name: 'HORS', ftcNumber: '6980', accentColor: '#2f6bff', canEditCad: true },
          { id: 13, name: 'Alumni', ftcNumber: null, accentColor: null, canEditCad: false },
        ] });
      }
      if (url === '/api/integrations/control-kit/authorize') {
        expect(JSON.parse(init.body)).toEqual({ state: 'abc', redirect_uri: REDIRECT });
        return res({ redirect: `${REDIRECT}?code=xyz&state=abc` });
      }
      return res({}, 404);
    });
    consent();
    expect(await screen.findByText('Control Kit wants to send BOMs from Onshape to your workspaces')).toBeInTheDocument();
    expect(screen.getByText('sam@hors.org')).toBeInTheDocument();
    expect(screen.getByText('HORS')).toBeInTheDocument();
    expect(screen.getByText('FTC 6980')).toBeInTheDocument();
    expect(screen.getByText(/CAD is switched off/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${REDIRECT}?code=xyz&state=abc`));
  });

  it('Cancel goes back with access_denied and the state', async () => {
    api.apiFetch.mockImplementation(() => res({ account: { email: 'a@b.org', name: 'A' }, workspaces: [] }));
    consent();
    expect(await screen.findByText('You’re not on a workspace yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(assign).toHaveBeenCalledWith(`${REDIRECT}?error=access_denied&state=abc`);
  });

  it('a redirect URI the server refuses gets an error page and no way to redirect', async () => {
    api.apiFetch.mockImplementation(() => res({ error: 'bad_redirect_uri' }, 400));
    consent(`/connect/control-kit?state=abc&redirect_uri=${encodeURIComponent('https://evil.example/cb')}`);
    expect(await screen.findByText('This link didn’t come from Control Kit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('an incomplete link asks nothing of the server', async () => {
    consent('/connect/control-kit?state=abc');
    expect(await screen.findByText('This link is incomplete')).toBeInTheDocument();
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it('keeps the consent link across sign-in, and only that page', () => {
    rememberControlKitConnect('/dashboard', '?x=1');
    expect(controlKitConnectPending()).toBe(false);
    rememberControlKitConnect('/connect/control-kit', '?state=abc&redirect_uri=x');
    expect(controlKitConnectPending()).toBe(true);
    expect(takeControlKitConnect()).toBe('/connect/control-kit?state=abc&redirect_uri=x');
    expect(takeControlKitConnect()).toBeNull();
    expect(controlKitRedirect(`${REDIRECT}`, { error: 'access_denied', state: 's t' })).toBe(`${REDIRECT}?error=access_denied&state=s+t`);
  });
});

describe('Connected apps', () => {
  it('lists Control Kit with its link date and disconnects it', async () => {
    api.apiFetch.mockImplementation((url: string) => {
      if (url === '/api/integrations/connected-apps') return res([{ id: 'control-kit', name: 'Control Kit', linkedAt: '2026-10-20T10:00:00.000Z', lastUsedAt: null }]);
      if (url === '/api/integrations/control-kit/disconnect') return res({ revoked: 2 });
      return res({}, 404);
    });
    render(<ConnectedApps />);
    expect(await screen.findByText(/Linked Oct 20, 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith('/api/integrations/control-kit/disconnect', { method: 'POST' }));
    expect(await screen.findByText(/No apps are connected/)).toBeInTheDocument();
  });

  it('says when nothing is connected', async () => {
    api.apiFetch.mockImplementation(() => res([]));
    render(<ConnectedApps />);
    expect(await screen.findByText(/No apps are connected/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disconnect/ })).toBeNull();
  });
});

describe('Parts list: Control Kit imports', () => {
  const me = { id: 7, name: 'Ada', team_id: 1, interface_mode: 'modern' };
  const parts = [
    { id: 1, name: 'Hand bracket', section: 'Chassis', quantity: 1, source: 'other', unit_cost: 0, status: 'to_order', assignee: '' },
    { id: 2, name: 'Mecanum wheel', section: 'Drivetrain', quantity: 4, source: 'gobilda', unit_cost: 30, status: 'ordered', assignee: 'Bo', ck_part_key: 'd:e:p1:', ck_import_id: 41, ck_removed_at: null },
    { id: 3, name: 'Old motor', section: 'Drivetrain', quantity: 1, source: 'gobilda', unit_cost: 40, status: 'to_order', assignee: '', ck_part_key: 'd:e:p2:', ck_import_id: 40, ck_removed_at: '2026-10-26T15:00:00.000Z' },
  ];
  const imp = {
    importId: 41, sentAt: '2026-10-26T15:00:00.000Z', sentBy: 'Sam', created: 1, updated: 0, markedRemoved: 1, filesStored: 1,
    assemblyName: 'Robot', assemblyUrl: 'https://cad.onshape.com/documents/d', revision: 'v/1', partCount: 1,
    files: [{ name: 'Robot BOM.xlsx', stored: true, url: '/api/files/9' }, { name: 'Robot STEP.zip', stored: false, note: 'Available in Control Kit' }],
  };
  const setup = (url: string) => render(
    <InterfaceModeProvider user={me} team={{}} onUserSaved={() => {}}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="*" element={<CadPage activeTab="cad-parts" currentUser={{ id: 7 }} isAdmin={false} />} /></Routes>
      </MemoryRouter>
    </InterfaceModeProvider>,
  );

  it('marks rows Control Kit sent, and the ones the latest scan dropped', async () => {
    api.apiFetch.mockImplementation((url: string) => res(url === '/api/cad/parts' ? parts : []));
    setup('/cad-parts');
    expect(await screen.findByText('Mecanum wheel')).toBeInTheDocument();
    expect(screen.getAllByText('From Control Kit')).toHaveLength(2);
    expect(screen.getAllByText('Not in latest scan')).toHaveLength(1);
    expect(screen.getByText('Old motor').closest('td')).toHaveTextContent('Not in latest scan');
    expect(screen.getByText('Hand bracket').closest('td')).not.toHaveTextContent('From Control Kit');
  });

  it('?import= shows that import and highlights its rows', async () => {
    api.apiFetch.mockImplementation((url: string) => res(url === '/api/cad/parts' ? parts : url === '/api/cad/imports/41' ? imp : []));
    setup('/cad-parts?import=41');
    expect(await screen.findByText('Robot from Control Kit')).toBeInTheDocument();
    expect(screen.getByText(/by Sam · 1 part · 1 new · 0 updated · 1 not in this scan/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Robot BOM.xlsx' })).toHaveAttribute('href', '/api/files/9');
    expect(screen.getByText(/Robot STEP.zip · Available in Control Kit/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Mecanum wheel').closest('tr')).toHaveAttribute('data-import', 'current'));
    expect(screen.getByText('Old motor').closest('tr')).not.toHaveAttribute('data-import');
    fireEvent.click(screen.getByRole('button', { name: 'Close the import summary' }));
    expect(screen.queryByText('Robot from Control Kit')).toBeNull();
  });

  it('an import from another workspace says so', async () => {
    api.apiFetch.mockImplementation((url: string) => (url === '/api/cad/imports/99' ? res({ error: 'Not found' }, 404) : res(url === '/api/cad/parts' ? parts : [])));
    setup('/cad-parts?import=99');
    expect(await screen.findByText(/That Control Kit import isn’t in this workspace/)).toBeInTheDocument();
  });
});
