// The landing's feature rows: a short heading and a line or two of copy beside a real
// screenshot of that page (captured from a seeded demo workspace, Dark and Light).
import { useRef, useState, type ReactNode } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { cn } from '../../../../components/cn';
import { ShotDemo, hasDemo } from './ShotDemos';

/** Fades a block up once as it scrolls in (300ms). Under reduced motion it is simply there.
 *  Always the same element, so flipping the reduced-motion setting never remounts what's inside
 *  (an open FAQ answer, a screenshot's fallback state); a block still hidden when motion is
 *  turned off snaps into place. */
export function FadeUp({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const shown = { opacity: 1, y: 0 };
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={reduce ? shown : undefined}
      whileInView={reduce ? undefined : shown}
      viewport={{ once: true, margin: '-40px' }}
      transition={reduce ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

// h: the screenshot's height at 1600 wide, so the frame holds its place before the image loads.
// phone: which part of the shot the phone crop shows (where that shot's demo plays); top-left by default.
export type Feature = { id: string; title: string; body: string; shot: string; h: number; alt: string; phone?: string };

export const FEATURES: Feature[] = [
  {
    id: 'attendance',
    title: 'Attendance that takes seconds',
    body: 'Put a QR code on the screen at practice and members check in from their phones, or tap through the roll by hand. Every mark adds to each member’s season record.',
    shot: 'attendance',
    h: 1008,
    phone: 'max-sm:-translate-y-[25%]',
    alt: 'The Attendance page: today’s roll call with present, late and excused marks, and the QR check-in panel',
  },
  {
    id: 'tasks',
    title: 'Everyone knows what to build next',
    body: 'Give build work an owner, a due date and a priority, then move it across the board as it gets done.',
    shot: 'tasks',
    h: 1076,
    phone: 'max-sm:-translate-x-[41.25%] max-sm:-translate-y-[30%]',
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
    phone: 'max-sm:-translate-x-[41.25%] max-sm:-translate-y-[20%]',
    alt: 'The Budget page: net balance, income and expenses, cash flow by month and spending by category',
  },
];

/** A product screenshot in a hairline frame, with its live demo laid over it (ShotDemos).
 *  Both themes ship; the page's theme picks one. The demo waits for the image and for the
 *  frame to scroll into view, and under reduced motion shows its finished state.
 *  On phones the frame shows part of the page at a readable size instead of the whole page shrunk.
 *  If a theme's file fails to load, that theme shows the other theme's shot (without the demo,
 *  whose colours follow the page's theme); if both fail, the frame goes. */
export function ProductShot({ shot, h, alt, phone, className }: { shot: string; h: number; alt: string; phone?: string; className?: string }) {
  const [broken, setBroken] = useState({ dark: false, light: false });
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const inView = useInView(frame, { once: true, amount: 0.6 });
  const reduce = !!useReducedMotion();
  if (broken.dark && broken.light) return null;
  const src = (theme: 'dark' | 'light') => {
    const other = theme === 'dark' ? 'light' : 'dark';
    return `/landing/${shot}-${broken[theme] ? other : theme}.webp`;
  };
  // A failure on the fallback means the other file is broken too.
  const fail = (theme: 'dark' | 'light') => () => setBroken((b) => (b[theme] ? { dark: true, light: true } : { ...b, [theme]: true }));
  const onLoad = () => setLoaded(true);
  const demo = loaded && hasDemo(shot) && !broken.dark && !broken.light;
  return (
    <div ref={frame} data-testid={`shot-${shot}`} className={cn('overflow-hidden rounded-[14px] border border-border bg-card max-sm:aspect-[5/4]', className)}>
      <div className={cn('relative max-sm:w-[170%]', phone)}>
        <img src={src('dark')} onError={fail('dark')} onLoad={onLoad} alt={alt} width={1600} height={h} loading="lazy" decoding="async" className="block h-auto w-full [html.light_&]:hidden" />
        <img src={src('light')} onError={fail('light')} onLoad={onLoad} alt={alt} width={1600} height={h} loading="lazy" decoding="async" className="hidden h-auto w-full [html.light_&]:block" />
        {demo && <ShotDemo shot={shot} h={h} play={inView} reduce={reduce} />}
      </div>
    </div>
  );
}

/** A feature row coming in: the words rise first, then the screenshot settles up into place.
 *  Same elements under reduced motion, which simply shows them. */
const RISE = [0.16, 1, 0.3, 1] as const;
function Rise({ children, className, delay = 0, y = 16, scale = 1 }: { children: ReactNode; className?: string; delay?: number; y?: number; scale?: number }) {
  const reduce = useReducedMotion();
  const shown = { opacity: 1, y: 0, scale: 1 };
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y, scale }}
      animate={reduce ? shown : undefined}
      whileInView={reduce ? undefined : shown}
      viewport={{ once: true, margin: '-80px' }}
      transition={reduce ? { duration: 0 } : { duration: 0.7, delay, ease: RISE }}
    >
      {children}
    </motion.div>
  );
}

export function FeatureRows() {
  return (
    <div className="grid gap-24 sm:gap-36">
      {FEATURES.map((f, i) => (
        <div key={f.id} className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
          <Rise className={cn('lg:col-span-4', i % 2 === 1 && 'lg:order-2 lg:col-start-9')}>
            <h3 className="font-sans text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-[1.75rem] sm:leading-tight">{f.title}</h3>
            <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{f.body}</p>
          </Rise>
          <Rise delay={0.08} y={32} scale={0.985} className={cn('lg:col-span-8', i % 2 === 1 && 'lg:order-1 lg:col-start-1 lg:row-start-1')}>
            <ProductShot shot={f.shot} h={f.h} alt={f.alt} phone={f.phone} />
          </Rise>
        </div>
      ))}
    </div>
  );
}
