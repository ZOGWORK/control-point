// The logo is /logo.png; if it fails to load, BrandLogo draws the same mark inline. Both come from
// scripts/make-icons.py: the rounded-square C (outer squircle, inner squircle and right-hand wedge masked out)
// with the diamond control point inside it. /mark.png is the same mark bare, for BrandGlyph.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BrandGlyph, BrandLogo, LOGO_SRC, MARK_SRC } from '../BrandMark';

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
    const offenders = files.filter((f) => /(logo|mark)\.png/.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('falls back to the rounded-square C: outer squircle, inner squircle and mouth wedge', () => {
    const mask = renderFallback().querySelector('mask')!;
    const [outer, inner, mouth] = [...mask.querySelectorAll('polygon')];
    expect(mask.querySelectorAll('polygon')).toHaveLength(3);
    expect(mask.querySelector('circle')).toBeNull(); // not a circle
    expect([outer, inner, mouth].map((p) => p.getAttribute('fill'))).toEqual(['#fff', '#000', '#000']);
    const o = points(outer), i = points(inner);
    // The inner squircle sits inside the outer one, so the C has a stroke all round.
    for (const p of i) expect(insideConvex(p, o)).toBe(true);
    // Squircle, not circle: the corner (on the diagonal) reaches well past a circle's radius.
    const half = (Math.max(...o.map(([x]) => x)) - Math.min(...o.map(([x]) => x))) / 2;
    const corner = Math.max(...o.map(([x, y]) => Math.hypot(x - 50, y - 50)));
    expect(corner).toBeGreaterThan(half * 1.1);
    // The mouth starts in the bowl and cuts right through the C's right-hand side, so it is open.
    const [apex, ...far] = points(mouth);
    expect(insideConvex(apex, i)).toBe(true);
    const right = Math.max(...o.map(([x]) => x));
    for (const [x] of far) expect(x).toBeGreaterThanOrEqual(right);
  });

  it('keeps the mark even: both squircles and the diamond share one centre', () => {
    const svg = renderFallback();
    const [outer, inner] = [...svg.querySelectorAll('mask polygon')].map(points);
    const diamond = points(svg.querySelector(':scope > g > polygon')!);
    const centre = (pts: Pt[]) => {
      const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    };
    for (const pts of [outer, inner, diamond]) {
      const [x, y] = centre(pts);
      expect(x).toBeCloseTo(50, 1);
      expect(y).toBeCloseTo(50, 1);
    }
    expect(diamond).toHaveLength(4);
    // Every corner inside the bowl, so it never touches the stroke.
    for (const p of diamond) expect(insideConvex(p, inner)).toBe(true);
  });
});

describe('BrandGlyph', () => {
  it('paints the bare mark.png in the text colour, hidden from screen readers', () => {
    const { container } = render(<BrandGlyph className="size-16" />);
    const el = container.querySelector('[data-brand-glyph]') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toContain('bg-current');
    expect(el.style.maskImage || el.style.getPropertyValue('-webkit-mask-image')).toContain(MARK_SRC);
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

  it('serves the in-app logo and the bare mark at the same version', () => {
    expect(LOGO_SRC).toBe(`/logo.png?v=${iconVersion()}`);
    expect(MARK_SRC).toBe(`/mark.png?v=${iconVersion()}`);
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
