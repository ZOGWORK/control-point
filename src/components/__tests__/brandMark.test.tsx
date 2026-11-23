// The logo is /logo.png; if it fails to load, BrandLogo draws the same mark inline. Both come from
// scripts/make-icons.py: the faceted C (outer octagon, inner octagon and right-hand wedge masked out)
// with the diamond control point inside it.
import { readFileSync } from 'node:fs';
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

// A new mark only reaches browsers and installed apps if every URL to it changes. The manifest link
// carries the same version as the icons it lists: a cached old manifest would keep the old icon URLs.
describe('brand cache-busters', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const manifest = JSON.parse(read('../../../public/manifest.webmanifest')) as { icons: { src: string }[] };
  const iconVersions = new Set(manifest.icons.map((i) => /\?v=(\d+)$/.exec(i.src)?.[1]));

  it('lists every manifest icon at one version', () => {
    expect(iconVersions.size).toBe(1);
    expect([...iconVersions][0]).toBeTruthy();
  });

  for (const page of ['../../../index.html', '../../../server/predict/how-it-works.html']) {
    it(`${page.split('/').pop()} links the manifest, favicon and touch icon at the icons' version`, () => {
      const html = read(page);
      const v = [...iconVersions][0];
      expect(html).toContain(`/manifest.webmanifest?v=${v}`);
      expect(html).toContain(`/favicon.png?v=${v}`);
      expect(html).toContain(`/apple-touch-icon.png?v=${v}`);
    });
  }
});
