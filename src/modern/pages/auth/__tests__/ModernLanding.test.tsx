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

  it('uses no yellow, gradient text or hex colours in the page source', () => {
    const src = ['../ModernLanding.tsx', '../landing/FeatureRows.tsx']
      .map((f) => readFileSync(resolve(__dirname, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(src).not.toMatch(/yellow|volt|amber|bg-clip-text|teal|mint/i);
  });
});
