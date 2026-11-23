// The logo is /logo.png; if it fails to load, BrandLogo draws the same mark inline. Both come from
// scripts/make-icons.py: the faceted C (outer octagon, inner octagon and right-hand wedge masked out)
// with the diamond control point inside it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BrandLogo, LOGO_SRC } from '../BrandMark';

afterEach(cleanup);

type Pt = [number, number];
const points = (el: Element): Pt[] =>
  el.getAttribute('points')!.trim().split(/\s+/).map((p) => p.split(',').map(Number) as Pt);

/** Strictly inside a convex polygon: on the same side of every edge. */
function insideConvex(p: Pt, poly: Pt[]) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const cross = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

function renderFallback() {
  render(<BrandLogo />);
  fireEvent.error(screen.getByRole('img', { name: 'Control Point logo' }));
  return screen.getByRole('img', { name: 'Control Point logo' }).querySelector('svg')!;
}

describe('BrandLogo', () => {
  it('serves the current logo image', () => {
    expect(LOGO_SRC).toMatch(/^\/logo\.png\?v=\d+$/);
    render(<BrandLogo />);
    expect(screen.getByRole('img', { name: 'Control Point logo' }).getAttribute('src')).toBe(LOGO_SRC);
  });

  it('is the only place the logo URL is written, so one bump reaches every logo (the workspace switcher too)', () => {
    const root = join(fileURLToPath(import.meta.url), '../../..'); // src/
    const files = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/__tests__/.test(f) && !/BrandMark\.tsx$/.test(f));
    // Any mention, versioned or not: an unversioned copy would bypass the cache-buster entirely.
    const offenders = files.filter((f) => /logo\.png/.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('falls back to the faceted C: outer octagon, inner octagon and mouth wedge', () => {
    const mask = renderFallback().querySelector('mask')!;
    const [outer, inner, mouth] = [...mask.querySelectorAll('polygon')];
    expect(mask.querySelectorAll('polygon')).toHaveLength(3);
    expect([outer, inner, mouth].map((p) => points(p).length)).toEqual([8, 8, 3]);
    expect([outer, inner, mouth].map((p) => p.getAttribute('fill'))).toEqual(['#fff', '#000', '#000']);
    // The inner octagon sits inside the outer one, so the C has a stroke all round.
    for (const p of points(inner)) expect(insideConvex(p, points(outer))).toBe(true);
    // The mouth starts in the bowl and cuts right through the C's whole right-hand side, so it is open.
    const [apex, ...far] = points(mouth);
    expect(insideConvex(apex, points(inner))).toBe(true);
    const o = points(outer), right = Math.max(...o.map(([x]) => x));
    const edge = o.filter(([x]) => x === right).map(([, y]) => y);
    for (const [x] of far) expect(x).toBeGreaterThanOrEqual(right);
    expect(Math.min(...far.map(([, y]) => y))).toBeLessThan(Math.min(...edge));
    expect(Math.max(...far.map(([, y]) => y))).toBeGreaterThan(Math.max(...edge));
  });

  it('puts the diamond control point inside the C', () => {
    const svg = renderFallback();
    const inner = points(svg.querySelectorAll('mask polygon')[1]);
    const diamond = points(svg.querySelector(':scope > g > polygon')!);
    expect(diamond).toHaveLength(4);
    // Every corner inside the inner octagon itself (not just its bounding box), so it never touches the stroke.
    for (const p of diamond) expect(insideConvex(p, inner)).toBe(true);
    // No round shapes left from the old mark.
    expect(svg.querySelector('circle, path')).toBeNull();
  });
});

// A new mark only reaches browsers and installed apps if every URL to it changes. The manifest link
// carries the same version as the icons it lists: a cached old manifest would keep the old icon URLs.
describe('brand cache-busters', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const iconVersion = () => {
    const manifest = JSON.parse(read('../../../public/manifest.webmanifest')) as { icons: { src: string }[] };
    const versions = new Set(manifest.icons.map((i) => /\?v=(\d+)$/.exec(i.src)?.[1]));
    expect(versions.size).toBe(1);
    const [v] = versions;
    expect(v).toMatch(/^\d+$/);
    return v!;
  };

  // One rule for every brand file: the version the manifest's icons carry. A mark change bumps them all.
  it('lists every manifest icon at one version', () => {
    iconVersion();
  });

  it('serves the in-app logo at the same version', () => {
    expect(LOGO_SRC).toBe(`/logo.png?v=${iconVersion()}`);
  });

  const pages = ['../../../index.html', '../../../server/predict/how-it-works.html'];
  // Each page must link these (the og-image twice: og and twitter tags).
  const required: Record<string, number> = { 'manifest.webmanifest': 1, 'favicon.png': 1, 'apple-touch-icon.png': 1, 'og-image.jpg': 2 };
  const brandFiles = [...Object.keys(required), 'logo.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

  for (const page of pages) {
    it(`${page.split('/').pop()} links every brand file at that version, and nothing unversioned`, () => {
      const v = iconVersion();
      const html = read(page);
      for (const file of brandFiles) {
        const name = file.replace(/[.-]/g, (c) => `\\${c}`);
        const all = html.match(new RegExp(`(?<![\\w-])${name}`, 'g')) ?? [];
        // Anchored on the closing quote, so ?v=70 can't pass for ?v=7.
        const current = html.match(new RegExp(`(?<![\\w-])${name}\\?v=${v}["']`, 'g')) ?? [];
        expect(current.length, `${file}: every reference at ?v=${v}`).toBe(all.length);
        if (required[file]) expect(all.length, file).toBe(required[file]);
      }
    });
  }
});
