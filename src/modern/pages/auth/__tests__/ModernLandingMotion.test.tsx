import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Drive the reduced-motion setting by hand so the test can flip it while the page is open.
const motionPref = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (orig) => ({ ...(await orig<object>()), useReducedMotion: () => motionPref.reduce }));
vi.mock('../../../../utils/pageViews', () => ({ usePublicPageView: vi.fn() }));

import { ModernLanding } from '../ModernLanding';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as any;
afterEach(() => { cleanup(); motionPref.reduce = false; });

describe('ModernLanding and reduced motion', () => {
  it('keeps an open FAQ answer open when reduced motion is turned on or off mid-visit', () => {
    const v = render(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    const q = screen.getByRole('button', { name: 'Does it work on phones?' });
    fireEvent.click(q);
    expect(q).toHaveAttribute('aria-expanded', 'true');

    motionPref.reduce = true;
    v.rerender(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Does it work on phones?' })).toHaveAttribute('aria-expanded', 'true');

    motionPref.reduce = false;
    v.rerender(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Does it work on phones?' })).toHaveAttribute('aria-expanded', 'true');
  });
});
