// Settings › Profile: the live accent preview never outlives the section, and a
// theme reset loads the teams before App re-applies colours (so a manager's
// reset can't repaint the old team colour from stale state).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../../../services/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock('../../../../components/dialog', () => ({ notify: vi.fn() }));

import { ProfileSection } from '../ProfileSection';
import { clearDrafts, setDraft } from '../../../drafts';
import { applySavedAccent } from '../../../../utils/accent';

const root = document.documentElement;
afterEach(() => {
  cleanup();
  clearDrafts();
  apiFetch.mockReset();
  root.style.removeProperty('--color-accent');
  delete root.dataset.accent;
});

const user = { id: 7, name: 'Dev', role: 'Admin', accent_color: null, team_id: 1 };

describe('ProfileSection accent', () => {
  it('previews a drafted colour, and puts the saved one back when the section closes', () => {
    setDraft('settings:profile:7', { name: 'Dev', role: 'Admin', accent: '#22c55e' });
    const view = render(<ProfileSection currentUser={user} teams={[{ id: 1, accent_color: null }]} />);
    expect(root.style.getPropertyValue('--color-accent')).toBe('#22c55e');
    expect(root.dataset.accent).toBe('team');
    view.unmount();
    expect(root.style.getPropertyValue('--color-accent')).toBe('');
    expect(root.dataset.accent).toBeUndefined();
  });

  it("keeps previewing the draft whenever App re-applies the saved colour, in any order", () => {
    setDraft('settings:profile:7', { name: 'Dev', role: 'Admin', accent: '#22c55e' });
    const view = render(<ProfileSection currentUser={user} teams={[{ id: 1, accent_color: null }]} />);
    // App's colour effect (theme toggle, team load, user change) re-applies the saved colour.
    applySavedAccent(null);
    expect(root.style.getPropertyValue('--color-accent')).toBe('#22c55e');
    expect(root.dataset.accent).toBe('team');
    // Once the section closes, App's saved colour applies again.
    view.unmount();
    applySavedAccent(null);
    expect(root.dataset.accent).toBeUndefined();
  });

  it('keeps the team colour after closing when the member has none', () => {
    setDraft('settings:profile:7', { name: 'Dev', role: 'Admin', accent: '#22c55e' });
    const view = render(<ProfileSection currentUser={user} teams={[{ id: 1, accent_color: '#38bdf8' }]} />);
    view.unmount();
    expect(root.style.getPropertyValue('--color-accent')).toBe('#38bdf8');
    expect(root.dataset.accent).toBe('team');
  });

  it('reset loads the teams before handing back the updated member', async () => {
    const order: string[] = [];
    let finishTeams!: () => void;
    const teams = vi.fn(() => new Promise<void>((res) => { finishTeams = () => { order.push('teams'); res(); }; }));
    const onUserSaved = vi.fn(() => { order.push('user'); });
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, user: { ...user, accent_color: null } }) });
    render(<ProfileSection currentUser={user} teams={[]} onUserSaved={onUserSaved} refresh={{ teams }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset theme' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(teams).toHaveBeenCalled();
    expect(onUserSaved).not.toHaveBeenCalled();
    await act(async () => { finishTeams(); await Promise.resolve(); });
    expect(order).toEqual(['teams', 'user']);
  });

  it('a failed team reload still completes the reset', async () => {
    const teams = vi.fn(() => Promise.reject(new Error('offline')));
    const onUserSaved = vi.fn();
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, user: { ...user, accent_color: null } }) });
    render(<ProfileSection currentUser={user} teams={[]} onUserSaved={onUserSaved} refresh={{ teams }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset theme' }));
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(onUserSaved).toHaveBeenCalledWith(expect.objectContaining({ accent_color: null }));
  });
});
