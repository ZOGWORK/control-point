import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

// Drive the reduced-motion setting by hand so the test can flip it while the page is open.
const motionPref = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (orig) => ({ ...(await orig<object>()), useReducedMotion: () => motionPref.reduce }));
vi.mock('../../../../utils/pageViews', () => ({ usePublicPageView: vi.fn() }));

import { ModernLanding } from '../ModernLanding';
import { FEATURES } from '../landing/FeatureRows';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
// An IntersectionObserver the test can drive: enterAll() reports every observed element in view.
const observers: { cb: IntersectionObserverCallback; els: Element[] }[] = [];
globalThis.IntersectionObserver = class {
  cb: IntersectionObserverCallback; els: Element[] = [];
  constructor(cb: IntersectionObserverCallback) { this.cb = cb; observers.push(this); }
  observe(el: Element) { this.els.push(el); }
  unobserve() {} disconnect() {} takeRecords() { return []; }
} as any;
const enterAll = () => act(() => {
  for (const o of observers) o.cb(o.els.map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 }) as any), o as any);
});
afterEach(() => { cleanup(); motionPref.reduce = false; observers.length = 0; });

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
    const parts = (shot: string, part: string) => [...screen.getByTestId(`demo-${shot}`).querySelectorAll<HTMLElement>(`[data-demo-part="${part}"]`)];
    // Attendance: every unmarked cover is already gone, so the screenshot's P marks show.
    expect(parts('attendance', 'unmarked')).toHaveLength(4);
    for (const c of parts('attendance', 'unmarked')) expect(c.style.opacity).toBe('0');
    // Tasks: the card sits at its Done position, shown, with its title struck through.
    const [card] = parts('tasks', 'dragged-card');
    expect(card).toHaveTextContent('Wire the color sensor');
    expect(card.style.opacity).toBe('1');
    expect(card.style.transform).toMatch(/translateX\(721\.33\d*px\) translateY\(599\.33\d*px\)/);
    expect(card.style.transform).not.toMatch(/rotate/);
    expect(parts('tasks', 'strike')[0].style.transform).toMatch(/none|scaleX\(1\)/);
    // Calendar: both new events are shown.
    expect(parts('calendar', 'event')).toHaveLength(2);
    for (const e of parts('calendar', 'event')) expect(e.style.opacity).toBe('1');
    // Budget: the bars are uncovered and the balance is the screenshot's figure, not counting up from $0.
    for (const b of parts('budget', 'bar-cover')) expect(b.style.transform).toMatch(/scaleY\(0\)/);
    expect(parts('budget', 'net')[0]).toHaveTextContent('$1,705.1');
  });

  it('holds the starting state until the row scrolls into view with motion on, then plays', async () => {
    render(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    fireEvent.load(screen.getAllByAltText(FEATURES[3].alt)[0]);
    fireEvent.load(screen.getAllByAltText(FEATURES[0].alt)[0]);
    const net = () => screen.getByTestId('demo-budget').querySelector('[data-demo-part="net"]');
    expect(net()).toHaveTextContent('$0.0');
    for (const c of screen.getByTestId('demo-attendance').querySelectorAll<HTMLElement>('[data-demo-part="unmarked"]')) expect(c.style.opacity).toBe('1');
    enterAll();
    await waitFor(() => expect(net()).toHaveTextContent('$1,705.1'), { timeout: 4000 });
  });

  it('still counts the balance up when reduced motion is turned off before Budget scrolls in', async () => {
    motionPref.reduce = true;
    const v = render(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    fireEvent.load(screen.getAllByAltText(FEATURES[3].alt)[0]);
    const net = () => screen.getByTestId('demo-budget').querySelector('[data-demo-part="net"]');
    expect(net()).toHaveTextContent('$1,705.1');

    motionPref.reduce = false;
    v.rerender(<ModernLanding onSignIn={vi.fn()} onGetStarted={vi.fn()} />);
    // Back to the start, waiting for the row.
    expect(net()).toHaveTextContent('$0.0');
    enterAll();
    await waitFor(() => expect(net()).toHaveTextContent(/^\$(?!0\.0$)/), { timeout: 2000 });
    await waitFor(() => expect(net()).toHaveTextContent('$1,705.1'), { timeout: 4000 });
  });
});
