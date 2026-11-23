// The logo is /logo.png; if it fails to load, BrandLogo draws the same mark inline. Both come from
// scripts/make-icons.py: the faceted C (outer octagon, inner octagon and right-hand wedge masked out)
// with the diamond control point inside it.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BrandLogo } from '../BrandMark';

afterEach(cleanup);

describe('BrandLogo', () => {
  it('serves the current logo image', () => {
    render(<BrandLogo />);
    expect(screen.getByRole('img', { name: 'Control Point logo' }).getAttribute('src')).toBe('/logo.png?v=6');
  });

  it('falls back to the faceted C with a diamond point when the image fails', () => {
    render(<BrandLogo />);
    fireEvent.error(screen.getByRole('img', { name: 'Control Point logo' }));
    const box = screen.getByRole('img', { name: 'Control Point logo' });
    const svg = box.querySelector('svg')!;
    const mask = svg.querySelector('mask')!;
    expect(mask.querySelectorAll('polygon')).toHaveLength(3); // outer octagon, inner octagon, mouth
    expect(mask.querySelector('polygon')!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(8);
    // The diamond sits inside the C's bowl (the inner octagon spans 36.44..63.56).
    const diamond = svg.querySelector(':scope > g > polygon')!.getAttribute('points')!.split(/\s+/).map((p) => p.split(',').map(Number));
    expect(diamond).toHaveLength(4);
    for (const [x, y] of diamond) {
      expect(x).toBeGreaterThan(36.44);
      expect(x).toBeLessThan(63.56);
      expect(y).toBeGreaterThan(36.44);
      expect(y).toBeLessThan(63.56);
    }
    // No round shapes left from the old mark.
    expect(svg.querySelector('circle, path')).toBeNull();
  });
});
