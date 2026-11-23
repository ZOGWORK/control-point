// Live demos laid over the landing's product screenshots. Each screenshot is the finished
// state; these overlays start a step earlier and play into it once the row scrolls into
// view: check-ins tick in on Attendance, a card is dragged to Done on Tasks, two events
// land on the Calendar, and Budget's bars grow while the balance counts up.
//
// The shots were captured at 1.5x, so the overlay is laid out in the app's own CSS pixels
// (1600 / 1.5 across) with the app's own classes and tokens, then scaled to the frame.
// Under reduced motion every overlay sits in its finished state from the start.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, motion, type Transition } from 'motion/react';
import { CalendarDays, CheckCircle2, Flag, MousePointer2 } from 'lucide-react';
import { cn } from '../../../../components/cn';

/** The screenshots' scale: 1600px files of a page 1066.67 CSS px wide. */
const SCALE = 1.5;
const STAGE_W = 1600 / SCALE;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** A box in the screenshot's own pixels, placed in app pixels. */
const box = (x: number, y: number, w: number, h: number): CSSProperties => ({
  left: x / SCALE, top: y / SCALE, width: w / SCALE, height: h / SCALE,
});

type DemoProps = { play: boolean; reduce: boolean };

/** `to` once playing (or at once under reduced motion), `from` before. */
function states(play: boolean, reduce: boolean) {
  return { initial: reduce ? false : ('from' as const), animate: reduce || play ? ('to' as const) : ('from' as const) };
}
const timed = (reduce: boolean, t: Transition): Transition => (reduce ? { duration: 0 } : t);

// Attendance: the four P marks start unmarked and light up one after another.
const CHIP_Y = [604, 700, 796, 891];
function AttendanceDemo({ play, reduce }: DemoProps) {
  const s = states(play, reduce);
  return (
    <>
      {CHIP_Y.map((y, i) => {
        const delay = 0.45 + i * 0.32;
        return (
          <div key={y} className="absolute" style={box(563, y, 54, 55)}>
            <motion.span
              data-demo-part="mark-ring"
              className="absolute inset-0 rounded-md ring-2 ring-success"
              {...s}
              variants={{ from: { opacity: 0, scale: 1 }, to: { opacity: [0, 0.7, 0], scale: [1, 1.18, 1.42], transition: timed(reduce, { delay, duration: 0.65, ease: 'easeOut' }) } }}
            />
            {/* An unmarked chip (the roll call's own colours) over the screenshot's P. */}
            <motion.span
              data-demo-part="unmarked"
              className="absolute inset-0 rounded-md bg-card"
              {...s}
              variants={{ from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.92, transition: timed(reduce, { delay, duration: 0.22, ease: 'easeOut' }) } }}
            >
              <span className="flex size-full items-center justify-center rounded-md bg-muted/60 text-sm font-semibold text-muted-foreground">P</span>
            </motion.span>
          </div>
        );
      })}
    </>
  );
}

// Tasks: a card is dragged from In progress into the empty space under Done and lands done.
const CARD_END = { x: 1082 / SCALE, y: 899 / SCALE };
const CARD_START = { x: 600 / SCALE, y: 842 / SCALE };
function TasksDemo({ play, reduce }: DemoProps) {
  const s = states(play, reduce);
  const lift = 0.3; const travel = 0.95; const land = lift + travel; const done = land + 0.25;
  return (
    <motion.div
      data-demo-part="dragged-card"
      className="absolute"
      style={{ left: 0, top: 0, width: 449 / SCALE }}
      {...s}
      variants={{
        from: { opacity: 0, x: CARD_START.x, y: CARD_START.y, rotate: -2, scale: 1.03 },
        to: {
          opacity: 1, x: CARD_END.x, y: CARD_END.y, rotate: 0, scale: 1,
          transition: timed(reduce, {
            opacity: { duration: lift, ease: 'easeOut' },
            default: { delay: lift, duration: travel, ease: EASE_OUT },
            scale: { delay: land - 0.1, duration: 0.3, ease: 'easeOut' },
          }),
        },
      }}
    >
      <div className="relative min-h-[88px] rounded-lg border border-border bg-card p-3 text-left shadow-sm">
        {/* The lifted shadow, gone once the card is dropped. */}
        <motion.span
          className="absolute inset-0 rounded-lg shadow-xl"
          {...s}
          variants={{ from: { opacity: 1 }, to: { opacity: 0, transition: timed(reduce, { delay: land - 0.1, duration: 0.35 }) } }}
        />
        <p className="relative text-sm font-medium">
          <span className="relative inline-block">
            <span className="text-muted-foreground">Wire the color sensor</span>
            {/* Open (foreground) until it lands, then it fades to the Done column's muted, struck-through title. */}
            <motion.span
              className="absolute inset-0 text-foreground"
              {...s}
              variants={{ from: { opacity: 1 }, to: { opacity: 0, transition: timed(reduce, { delay: done, duration: 0.3 }) } }}
            >
              Wire the color sensor
            </motion.span>
            <motion.span
              data-demo-part="strike"
              className="absolute inset-x-0 top-1/2 h-px origin-left bg-muted-foreground"
              {...s}
              variants={{ from: { scaleX: 0 }, to: { scaleX: 1, transition: timed(reduce, { delay: done, duration: 0.35, ease: 'easeOut' }) } }}
            />
          </span>
        </p>
        <div className="relative mt-[15px] flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap text-sky-600 dark:text-sky-300">
            <Flag className="size-3" />Medium
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="size-3" />Nov 23</span>
          <span className="ml-auto flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-medium">PN</span>
        </div>
        {/* The board's own done check, popping on the corner as it lands. */}
        <motion.span
          className="absolute -left-1.5 -top-1.5"
          {...s}
          variants={{
            from: { opacity: 0, scale: 0.4 },
            to: { opacity: reduce ? 0 : [0, 1, 1, 0], scale: [0.4, 1.15, 1, 1], transition: timed(reduce, { delay: done - 0.1, duration: 1.2, times: [0, 0.35, 0.8, 1], ease: 'easeOut' }) },
          }}
        >
          <CheckCircle2 className="size-5 rounded-full bg-card text-success" />
        </motion.span>
        {/* The pointer doing the dragging, let go on landing. */}
        <motion.span
          className="absolute right-[22%] top-[38%]"
          {...s}
          variants={{ from: { opacity: 1, x: 0, y: 0 }, to: { opacity: 0, x: 6, y: 6, transition: timed(reduce, { delay: land, duration: 0.3, ease: 'easeOut' }) } }}
        >
          <MousePointer2 className="size-5 fill-foreground stroke-background drop-shadow" strokeWidth={1.5} />
        </motion.span>
      </div>
    </motion.div>
  );
}

// Calendar: two events land on empty days, each with a soft flash of its cell.
const EVENTS = [
  { cell: [196, 524], pill: [204, 568], label: '4:00 PM Build practice', chip: 'bg-info/12 text-info', dot: 'bg-info' },
  { cell: [653, 675], pill: [661, 719], label: '8:00 AM League meet', chip: 'bg-chart-4/12 text-chart-4', dot: 'bg-chart-4' },
] as const;
function CalendarDemo({ play, reduce }: DemoProps) {
  const s = states(play, reduce);
  return (
    <>
      {EVENTS.map((e, i) => {
        const delay = 0.45 + i * 0.55;
        return (
          <div key={e.label}>
            <motion.span
              className="absolute bg-accent/10"
              style={box(e.cell[0] + 1, e.cell[1] + 1, 150, 148)}
              {...s}
              variants={{ from: { opacity: 0 }, to: { opacity: reduce ? 0 : [0, 1, 0], transition: timed(reduce, { delay, duration: 1.1, times: [0, 0.3, 1], ease: 'easeOut' }) } }}
            />
            <motion.span
              data-demo-part="event"
              className={cn('absolute flex items-center gap-[5px] truncate rounded-[5px] px-[6px] text-left font-medium', e.chip)}
              // The Calendar shot was taken a little smaller than the others: its pills are 11px type at 0.83x.
              style={{ ...box(e.pill[0], e.pill[1], 134, 28), fontSize: 9.6 }}
              {...s}
              variants={{ from: { opacity: 0, scale: 0.9, y: 4 }, to: { opacity: 1, scale: 1, y: 0, transition: timed(reduce, { delay, duration: 0.35, ease: EASE_OUT }) } }}
            >
              <span className={cn('size-[5px] shrink-0 rounded-full', e.dot)} />
              <span className="truncate">{e.label}</span>
            </motion.span>
          </div>
        );
      })}
    </>
  );
}

// Budget: the cash-flow bars grow from the baseline, the income/expense split fills, and
// the net balance counts up. The covers are the card's own colour over the screenshot.
const BARS = [[838, 569, 138, 260], [979, 805, 138, 24], [1184, 790, 138, 39], [1325, 759, 138, 70]] as const;
const NET = 1705.1;
const money = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;
function BudgetDemo({ play, reduce }: DemoProps) {
  const s = states(play, reduce);
  const net = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useLayoutEffect(() => {
    const el = net.current;
    if (!el) return;
    // The figure is written here only (React never owns this text). `started` means the row
    // has played: under reduced motion that happens the moment it is in view (shown finished),
    // so turning motion back on later doesn't recount it; turning it on before the row plays
    // still counts up.
    if (reduce) { if (play) started.current = true; el.textContent = money(NET); return; }
    if (started.current) return;
    if (!play) { el.textContent = money(0); return; }
    started.current = true;
    let finished = false;
    const c = animate(0, NET, {
      delay: 0.3, duration: 1.2, ease: EASE_OUT,
      onUpdate: (v) => { el.textContent = money(v); },
      onComplete: () => { finished = true; },
    });
    // Stopped before the end (StrictMode's remount, or reduced motion turned on mid-count):
    // un-latch so the next run of this effect plays it, or shows it finished, again.
    return () => { c.stop(); if (!finished) started.current = false; };
  }, [play, reduce]);
  return (
    <>
      {BARS.map(([x, y, w, h], i) => (
        <motion.span
          key={x}
          data-demo-part="bar-cover"
          className="absolute origin-top bg-card"
          style={box(x, y, w, h)}
          {...s}
          variants={{ from: { scaleY: 1 }, to: { scaleY: 0, transition: timed(reduce, { delay: 0.35 + i * 0.1, duration: 0.8, ease: EASE_OUT }) } }}
        />
      ))}
      <motion.span
        className="absolute origin-right bg-card"
        style={box(94, 785, 599, 19)}
        {...s}
        variants={{ from: { scaleX: 1 }, to: { scaleX: 0, transition: timed(reduce, { delay: 0.3, duration: 1, ease: EASE_OUT }) } }}
      />
      {/* The balance, in the Budget page's own type, over a cover hiding the screenshot's figure. */}
      <span className="absolute bg-card" style={box(90, 543, 420, 100)}>
        <span
          ref={net}
          data-demo-part="net"
          className="absolute whitespace-nowrap font-display text-5xl font-semibold tabular-nums tracking-tight text-foreground"
          style={{ left: (92.5 - 90) / SCALE, top: (541.5 - 543) / SCALE + 7.5, fontSize: 54.2 }}
        />
      </span>
    </>
  );
}

const DEMOS: Record<string, (p: DemoProps) => ReactNode> = {
  attendance: AttendanceDemo,
  tasks: TasksDemo,
  calendar: CalendarDemo,
  budget: BudgetDemo,
};
export const hasDemo = (shot: string) => shot in DEMOS;

/** Lays a shot's demo over it, scaled to the frame. Decorative: hidden from screen readers. */
export function ShotDemo({ shot, h, play, reduce }: { shot: string; h: number } & DemoProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth, not the bounding box: the row rises in with a slight scale, which must not count.
    const measure = () => setScale(el.offsetWidth / STAGE_W);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const Demo = DEMOS[shot];
  if (!Demo) return null;
  return (
    <div ref={ref} aria-hidden="true" data-testid={`demo-${shot}`} className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      {scale !== null && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: h / SCALE, transform: `scale(${scale})` }}>
          <Demo play={play} reduce={reduce} />
        </div>
      )}
    </div>
  );
}
