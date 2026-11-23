// @vitest-environment jsdom
// The accent colour and its data-accent marker always change together: the
// stylesheet fills primary buttons only while data-accent="team" is set.
import { afterEach, describe, expect, it } from 'vitest';
import { applyAccent } from '../accent';

const root = document.documentElement;
afterEach(() => { root.style.removeProperty('--color-accent'); delete root.dataset.accent; });

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
});
