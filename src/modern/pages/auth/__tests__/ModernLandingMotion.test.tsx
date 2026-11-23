import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Drive the reduced-motion setting by hand so the test can flip it while the page is open.
const motionPref = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (orig) => ({ ...(await orig<object>()), useReducedMotion: () => motionPref.reduce }));
vi.mock('../../../../utils/pageViews', () => ({ usePublicPageView: vi.fn() }));

import { ModernLanding } from '../ModernLanding';
import { FEATURES } from '../landing/FeatureRows';

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

  it('shows every demo in its finished state at once under reduced motion', () => {
    motionPref.reduce = true;
    render(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    for (const f of FEATURES) fireEvent.load(screen.getAllByAltText(f.alt)[0]);
    // Budget: the balance is already the screenshot's figure, not counting up from $0.
    expect(screen.getByTestId('demo-budget').querySelector('[data-demo-part="net"]')).toHaveTextContent('$1,705.1');
    // Tasks: the dragged card is in the Done column; Calendar: both new events are there.
    expect(screen.getByTestId('demo-tasks')).toHaveTextContent('Wire the color sensor');
    expect(screen.getByTestId('demo-calendar').querySelectorAll('[data-demo-part="event"]')).toHaveLength(2);
    expect(screen.getByTestId('demo-attendance').querySelectorAll('[data-demo-part="unmarked"]')).toHaveLength(4);
  });

  it('holds the starting state (balance at $0) until the row scrolls into view with motion on', () => {
    render(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    fireEvent.load(screen.getAllByAltText(FEATURES[3].alt)[0]);
    // The stubbed IntersectionObserver never reports the row in view, so nothing plays.
    expect(screen.getByTestId('demo-budget').querySelector('[data-demo-part="net"]')).toHaveTextContent('$0.0');
  });
});
