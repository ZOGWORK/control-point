// The landing's feature rows: a short heading and a line or two of copy beside a real
// screenshot of that page (captured from a seeded demo workspace, Dark and Light).
import { useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../../../components/cn';

/** Fades a block up once as it scrolls in (300ms). Under reduced motion it is simply there. */
export function FadeUp({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

// h: the screenshot's height at 1600 wide, so the frame holds its place before the image loads.
export type Feature = { id: string; title: string; body: string; shot: string; h: number; alt: string };

export const FEATURES: Feature[] = [
  {
    id: 'attendance',
    title: 'Attendance that takes seconds',
    body: 'Put a QR code on the screen at practice and members check in from their phones, or tap through the roll by hand. Every mark adds to each member’s season record.',
    shot: 'attendance',
    h: 1008,
    alt: 'The Attendance page: today’s roll call with present, late and excused marks, and the QR check-in panel',
  },
  {
    id: 'tasks',
    title: 'Everyone knows what to build next',
    body: 'Give build work an owner, a due date and a priority, then move it across the board as it gets done.',
    shot: 'tasks',
    h: 1076,
    alt: 'The Tasks board with To do, In progress and Done columns, holding cards such as Tune arm PID',
  },
  {
    id: 'calendar',
    title: 'One calendar the whole team checks',
    body: 'Practices, meets, outreach and deadlines in one place, with tasks shown on the day they are due.',
    shot: 'calendar',
    h: 940,
    alt: 'The Calendar in month view: build practices, a league tournament and deadlines, with the next events listed beside it',
  },
  {
    id: 'budget',
    title: 'Know where the money went',
    body: 'Log dues, sponsors and every parts order. The balance and spending by category keep up as you go.',
    shot: 'budget',
    h: 941,
    alt: 'The Budget page: net balance, income and expenses, cash flow by month and spending by category',
  },
];

/** A product screenshot in a hairline frame. Both themes ship; the page's theme picks one.
 *  On phones the frame shows the top-left of the page at a readable size instead of the whole page shrunk.
 *  If a theme's file fails to load, that theme shows the other theme's shot; if both fail, the frame goes. */
export function ProductShot({ shot, h, alt, className }: { shot: string; h: number; alt: string; className?: string }) {
  const [broken, setBroken] = useState({ dark: false, light: false });
  if (broken.dark && broken.light) return null;
  const src = (theme: 'dark' | 'light') => {
    const other = theme === 'dark' ? 'light' : 'dark';
    return `/landing/${shot}-${broken[theme] ? other : theme}.webp`;
  };
  // A failure on the fallback means the other file is broken too.
  const fail = (theme: 'dark' | 'light') => () => setBroken((b) => (b[theme] ? { dark: true, light: true } : { ...b, [theme]: true }));
  const img = 'h-auto w-full max-sm:w-[170%] max-sm:max-w-none';
  return (
    <div data-testid={`shot-${shot}`} className={cn('overflow-hidden rounded-[14px] border border-border bg-card max-sm:aspect-[5/4]', className)}>
      <img src={src('dark')} onError={fail('dark')} alt={alt} width={1600} height={h} loading="lazy" decoding="async" className={cn('block [html.light_&]:hidden', img)} />
      <img src={src('light')} onError={fail('light')} alt={alt} width={1600} height={h} loading="lazy" decoding="async" className={cn('hidden [html.light_&]:block', img)} />
    </div>
  );
}

export function FeatureRows() {
  return (
    <div className="grid gap-20 sm:gap-28">
      {FEATURES.map((f, i) => (
        <FadeUp key={f.id} className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
          <div className={cn('lg:col-span-4', i % 2 === 1 && 'lg:order-2 lg:col-start-9')}>
            <h3 className="font-sans text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-[1.75rem] sm:leading-tight">{f.title}</h3>
            <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{f.body}</p>
          </div>
          <ProductShot shot={f.shot} h={f.h} alt={f.alt} className={cn('lg:col-span-8', i % 2 === 1 && 'lg:order-1 lg:col-start-1 lg:row-start-1')} />
        </FadeUp>
      ))}
    </div>
  );
}
