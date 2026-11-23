import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../../../utils/pageViews', () => ({ usePublicPageView: vi.fn() }));

import { ModernLanding } from '../ModernLanding';
import { FEATURES } from '../landing/FeatureRows';
import { usePublicPageView } from '../../../../utils/pageViews';

globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as any;
afterEach(cleanup);

const setup = () => {
  const onSignIn = vi.fn(); const onGetStarted = vi.fn();
  render(<ModernLanding onSignIn={onSignIn} onGetStarted={onGetStarted} />);
  return { onSignIn, onGetStarted };
};

describe('ModernLanding (v8)', () => {
  it('counts the page view for /', () => {
    setup();
    expect(usePublicPageView).toHaveBeenCalledWith('/');
  });

  it('has one headline and every exit: Sign in (bar and hero), Get started, Create your workspace', () => {
    const { onSignIn, onGetStarted } = setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const signIns = screen.getAllByRole('button', { name: 'Sign in' });
    expect(signIns).toHaveLength(2);
    signIns.forEach((b) => fireEvent.click(b));
    expect(onSignIn).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: /Create your workspace/ }));
    screen.getAllByRole('button', { name: 'Get started' }).forEach((b) => fireEvent.click(b));
    expect(onGetStarted).toHaveBeenCalledTimes(3);
  });

  it('keeps the in-page anchors pointing at sections that exist', () => {
    const { container } = render(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
    for (const name of ['Features', 'FAQ']) {
      const href = within(nav).getByRole('link', { name }).getAttribute('href')!;
      expect(container.querySelector(href)).not.toBeNull();
    }
  });

  it('shows a real screenshot for each feature row, Dark and Light, with alt text', () => {
    setup();
    for (const f of FEATURES) {
      expect(screen.getByRole('heading', { name: f.title })).toBeInTheDocument();
      const imgs = screen.getAllByAltText(f.alt);
      expect(imgs.map((i) => i.getAttribute('src'))).toEqual([`/landing/${f.shot}-dark.webp`, `/landing/${f.shot}-light.webp`]);
      for (const theme of ['dark', 'light']) {
        expect(() => readFileSync(resolve(__dirname, '../../../../../public/landing', `${f.shot}-${theme}.webp`))).not.toThrow();
      }
    }
  });

  it('keeps the three FAQ answers and the footer links', () => {
    setup();
    for (const q of ['Who is Control Point for?', 'Do members need their own accounts?', 'Does it work on phones?']) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument();
    }
    const footer = screen.getByRole('navigation', { name: 'Footer' });
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(footer).getByRole('link', { name: 'Contact' }).getAttribute('href')).toMatch(/^mailto:/);
  });

  it('draws the v8 wash behind the hero, hidden from screen readers', () => {
    setup();
    const wash = screen.getByTestId('landing-wash');
    expect(wash).toHaveAttribute('aria-hidden', 'true');
    expect(wash.querySelectorAll('.landing-wash-glow')).toHaveLength(3);
  });

  it('keeps the screenshots lazy, and lays no demo over a frame until its image has loaded', () => {
    setup();
    for (const f of FEATURES) {
      for (const img of screen.getAllByAltText(f.alt)) expect(img).toHaveAttribute('loading', 'lazy');
      expect(screen.queryByTestId(`demo-${f.shot}`)).not.toBeInTheDocument();
      fireEvent.load(screen.getAllByAltText(f.alt)[0]);
      const demo = screen.getByTestId(`demo-${f.shot}`);
      expect(demo).toHaveAttribute('aria-hidden', 'true');
      // Inside the frame, beside the image, so it moves with the phone crop.
      expect(demo.parentElement).toBe(screen.getAllByAltText(f.alt)[0].parentElement);
    }
  });

  it('drops the demo when a screenshot falls back to the other theme (its colours would not match)', () => {
    setup();
    const f = FEATURES[1];
    const [dark] = screen.getAllByAltText(f.alt);
    fireEvent.load(dark);
    expect(screen.getByTestId(`demo-${f.shot}`)).toBeInTheDocument();
    fireEvent.error(dark);
    expect(screen.queryByTestId(`demo-${f.shot}`)).not.toBeInTheDocument();
  });

  it("falls back to the other theme's screenshot when one fails, and drops the frame when both do", () => {
    setup();
    const f = FEATURES[0];
    const [dark, light] = screen.getAllByAltText(f.alt);
    fireEvent.error(dark);
    expect(dark).toHaveAttribute('src', `/landing/${f.shot}-light.webp`);
    expect(screen.getByTestId(`shot-${f.shot}`)).toBeInTheDocument();
    fireEvent.error(light);
    expect(screen.queryByTestId(`shot-${f.shot}`)).not.toBeInTheDocument();
    // The other rows are untouched.
    expect(screen.getByTestId(`shot-${FEATURES[1].shot}`)).toBeInTheDocument();
  });

  it('uses no yellow or gradient text anywhere on the page, and hex colours only for the wash', () => {
    const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');
    const files = ['../ModernLanding.tsx', '../landing/FeatureRows.tsx', '../landing/ShotDemos.tsx', '../landing/LandingWash.tsx', '../landing/landing.css'];
    const all = files.map(read).join(' ');
    expect(all).not.toMatch(/yellow|volt|amber|gold|bg-clip-text|teal|mint/i);
    // The page and rows use tokens only.
    expect(read('../ModernLanding.tsx') + read('../landing/FeatureRows.tsx') + read('../landing/ShotDemos.tsx')).not.toMatch(/#[0-9a-f]{3,8}(?![0-9a-z])/i);
    // The wash's own colours (Control Scout's three) and its black fade mask are the only hex values.
    const hex = new Set((read('../landing/LandingWash.tsx') + read('../landing/landing.css')).match(/#[0-9a-f]{3,8}(?![0-9a-z])/gi)?.map((h) => h.toLowerCase()));
    expect([...hex].sort()).toEqual(['#000', '#5a76ad', '#5f5785', '#91689c']);
  });
});
