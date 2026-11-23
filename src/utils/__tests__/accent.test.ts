// @vitest-environment jsdom
// The accent colour and its data-accent marker always change together: the
// stylesheet fills primary buttons only while data-accent="team" is set.
import { afterEach, describe, expect, it } from 'vitest';
import { applyAccent, applySavedAccent, setAccentPreview } from '../accent';

const root = document.documentElement;
afterEach(() => { setAccentPreview(false); root.style.removeProperty('--color-accent'); delete root.dataset.accent; });

describe('applyAccent', () => {
  it('sets the chosen colour and marks it as a team colour', () => {
    applyAccent('#22c55e');
    expect(root.style.getPropertyValue('--color-accent')).toBe('#22c55e');
    expect(root.dataset.accent).toBe('team');
  });

  it('clears both for the default accent', () => {
    applyAccent('#22c55e');
    applyAccent(null);
    expect(root.style.getPropertyValue('--color-accent')).toBe('');
    expect(root.dataset.accent).toBeUndefined();
    applyAccent('#22c55e');
    applyAccent(undefined);
    expect(root.dataset.accent).toBeUndefined();
  });

  it('applySavedAccent yields to an active preview, and applies the saved colour once it ends', () => {
    setAccentPreview(true, '#22c55e');
    applySavedAccent('#38bdf8');
    expect(root.style.getPropertyValue('--color-accent')).toBe('#22c55e');
    setAccentPreview(true, null); // previewing "no colour" (the default)
    applySavedAccent('#38bdf8');
    expect(root.dataset.accent).toBeUndefined();
    setAccentPreview(false);
    applySavedAccent('#38bdf8');
    expect(root.style.getPropertyValue('--color-accent')).toBe('#38bdf8');
    expect(root.dataset.accent).toBe('team');
  });
});
