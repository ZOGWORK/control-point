// Signed-out landing (v8). One job: show a robotics team what Control Point is, with
// real screens, and get them to create a workspace or sign in. A tall wash with grain
// behind the mark, one headline and two buttons; then four feature rows, each with a
// screenshot of that page; a short list of the rest; a few facts; the FAQ; a closing
// line; the footer. Same two exits as before: onSignIn and onGetStarted.
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { usePublicPageView } from '../../../utils/pageViews';
import { cn } from '../../../components/cn';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button,
} from '../../../components/ui-kit';
import { BrandGlyph, BrandLogo } from '../../../components/BrandMark';
import { CONTACT_EMAIL } from '../../../utils/contact';
import { SignedOutModern } from '../../signedOut';
import { LandingWash } from './landing/LandingWash';
import { FadeUp, FeatureRows } from './landing/FeatureRows';

// The one filled button style on the page: the foreground colour, so it reads first in both themes.
const PRIMARY = 'bg-foreground text-background ring-0 hover:bg-foreground/90';
// Plain links get the same visible keyboard ring as the kit's buttons.
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-accent/60';

const MORE = [
  'Team chat with channels and @mentions',
  'Scouting and match predictions from FTC data',
  'Bruno, an AI helper that knows your workspace',
  'Inventory, CAD, prints and code links',
  'The engineering notebook',
  'Roles for captains, mentors and members',
];

const FACTS = [
  { title: 'Free for teams', body: 'Create a workspace and bring the whole team in at no cost.' },
  { title: 'Set up in minutes', body: 'Enter your FTC team number and the team name fills in.' },
  { title: 'One code to join', body: 'Members sign up and join with your access code. You set their roles.' },
  { title: 'Works on phones', body: 'Every screen works on a phone, including QR check-in and the task board.' },
];

const FAQ = [
  { q: 'Who is Control Point for?', a: 'Robotics teams, built around FIRST Tech Challenge. Admins (coaches, mentors or captains) create the workspace, and members join with a code.' },
  { q: 'Do members need their own accounts?', a: 'Yes. Each person signs up (with email, or a Google, Discord or GitHub account where available) and joins your workspace with the access code. Their role decides what they can see and change.' },
  { q: 'Does it work on phones?', a: 'Yes. Every screen works on a phone, including QR check-in and the task board.' },
];

/** The hero's pieces settle in one after another on load (logo, headline, line, buttons).
 *  Same element under reduced motion, which shows them at once. */
function HeroIn({ children, step, className }: { children: ReactNode; step: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.8, delay: 0.08 + step * 0.09, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return scrolled;
}

export function ModernLanding({ onSignIn, onGetStarted }: { onSignIn: () => void; onGetStarted: () => void }) {
  const scrolled = useScrolled();
  usePublicPageView('/');
  return (
    <SignedOutModern>
      <div className="relative min-h-dvh overflow-x-clip bg-background text-foreground">
        <LandingWash />

        <header className={cn('fixed inset-x-0 top-0 z-40 border-b transition-colors', scrolled ? 'border-border bg-background/80 backdrop-blur-lg' : 'border-transparent')}>
          <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6" aria-label="Main">
            <a href="#top" className={cn('flex min-h-11 items-center gap-2.5 rounded-lg', FOCUS)}>
              <BrandGlyph className="size-6 text-foreground" />
              <span className="font-sans text-[15px] font-semibold tracking-[-0.01em]">Control Point</span>
            </a>
            <div className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
              <a href="#features" className={cn('inline-flex min-h-11 items-center rounded-lg px-3 hover:text-foreground', FOCUS)}>Features</a>
              <a href="#faq" className={cn('inline-flex min-h-11 items-center rounded-lg px-3 hover:text-foreground', FOCUS)}>FAQ</a>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" onClick={onSignIn} className="h-11">Sign in</Button>
              <Button onClick={onGetStarted} className={cn('h-11 max-[360px]:px-3', PRIMARY)}>Get started</Button>
            </div>
          </nav>
        </header>

        {/* The bar is fixed (body is the scroller here, so sticky would not hold). */}
        <main id="top" className="relative pt-16">
          <section className="px-4 pb-28 pt-20 sm:px-6 sm:pb-44 sm:pt-28" aria-labelledby="landing-title">
            <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
              <HeroIn step={0}>
                <BrandGlyph className="size-14 text-foreground sm:size-16" />
              </HeroIn>
              <HeroIn step={1}>
                <h1 id="landing-title" className="mt-8 text-balance font-sans text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]">
                  The workspace for your robotics team
                </h1>
              </HeroIn>
              <HeroIn step={2} className="flex flex-col items-center">
                <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                  Attendance, tasks, the calendar and the budget for your FTC team, in one place everyone can open on their phone.
                </p>
              </HeroIn>
              <HeroIn step={3} className="mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
                <Button size="lg" onClick={onGetStarted} className={cn('group h-12 px-6', PRIMARY)}>
                  Create your workspace <ArrowRight className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </Button>
                <Button size="lg" variant="ghost" onClick={onSignIn} className="h-12 px-6 text-foreground">Sign in</Button>
              </HeroIn>
            </div>
          </section>

          {/* A clear break after the hero: a hairline and the section's own heading, so the first
              row reads as the start of the tour rather than the hero's picture. */}
          <section id="features" className="scroll-mt-20 px-4 pb-24 sm:px-6 sm:pb-32" aria-labelledby="features-title">
            <div className="mx-auto max-w-6xl">
              <FadeUp className="mb-16 border-t border-border pt-16 text-center sm:mb-24 sm:pt-24">
                <h2 id="features-title" className="text-balance font-sans text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Run the season from one place</h2>
                <p className="mx-auto mt-3 max-w-lg text-pretty text-muted-foreground">The pages your team opens every week, shown here with a demo team’s data.</p>
              </FadeUp>
              <FeatureRows />

              <FadeUp className="mt-24 border-t border-border pt-10 sm:mt-32">
                <h3 className="font-sans text-lg font-semibold tracking-[-0.01em]">Also in Control Point</h3>
                <ul className="mt-5 grid gap-x-10 gap-y-3 text-[15px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                  {MORE.map((m) => (
                    <li key={m} className="flex gap-3">
                      <span aria-hidden="true" className="mt-[0.6em] size-1 shrink-0 rounded-full bg-ink/40" />
                      {m}
                    </li>
                  ))}
                </ul>
              </FadeUp>
            </div>
          </section>

          <section className="border-y border-border px-4 sm:px-6" aria-labelledby="facts-title">
            <div className="mx-auto max-w-6xl">
              <h2 id="facts-title" className="sr-only">Built for FIRST Tech Challenge teams</h2>
              <dl className="grid sm:grid-cols-2 lg:grid-cols-4">
                {FACTS.map((f, i) => (
                  <div
                    key={f.title}
                    className={cn(
                      'border-border py-8 sm:py-10',
                      i > 0 && 'border-t sm:border-t-0',
                      i >= 2 && 'sm:border-t lg:border-t-0',
                      i % 2 === 1 && 'sm:border-l sm:pl-8',
                      i % 2 === 0 && 'sm:pr-8',
                      i > 0 && 'lg:border-l lg:pl-8',
                    )}
                  >
                    <dt className="font-sans text-[15px] font-semibold text-foreground">{f.title}</dt>
                    <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section id="faq" className="scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32" aria-labelledby="faq-title">
            <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-12">
              <FadeUp className="lg:col-span-4">
                <h2 id="faq-title" className="font-sans text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Questions</h2>
                <p className="mt-3 text-muted-foreground">
                  Something else?{' '}
                  <a href={`mailto:${CONTACT_EMAIL}`} className={cn('rounded text-foreground underline decoration-ink/30 underline-offset-4 hover:decoration-ink', FOCUS)}>Email us</a>
                </p>
              </FadeUp>
              <FadeUp className="lg:col-span-7 lg:col-start-6">
                <Accordion type="single" collapsible className="w-full border-t border-border">
                  {FAQ.map((f) => (
                    <AccordionItem key={f.q} value={f.q}>
                      <AccordionTrigger className="min-h-14 text-left text-base">{f.q}</AccordionTrigger>
                      <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </FadeUp>
            </div>
          </section>

          <section className="border-t border-border px-4 py-24 sm:px-6 sm:py-28" aria-labelledby="closing-title">
            <FadeUp className="mx-auto flex max-w-2xl flex-col items-center text-center">
              <h2 id="closing-title" className="text-balance font-sans text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Set up your team’s workspace</h2>
              <p className="mt-3 text-muted-foreground">It takes a couple of minutes, and it’s free.</p>
              <Button size="lg" onClick={onGetStarted} className={cn('mt-8 h-12 w-full px-6 sm:w-auto', PRIMARY)}>Get started</Button>
            </FadeUp>
          </section>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
            <span className="flex items-center gap-2"><BrandLogo className="size-5 rounded" decorative /> Control Point · Mission control for robotics teams</span>
            <nav className="flex flex-wrap items-center justify-center gap-x-4" aria-label="Footer">
              <a href="/privacy" className={cn('inline-flex min-h-11 items-center rounded hover:text-foreground', FOCUS)}>Privacy</a>
              <a href="/terms" className={cn('inline-flex min-h-11 items-center rounded hover:text-foreground', FOCUS)}>Terms</a>
              <a href={`mailto:${CONTACT_EMAIL}`} className={cn('inline-flex min-h-11 items-center rounded hover:text-foreground', FOCUS)}>Contact</a>
            </nav>
          </div>
        </footer>
      </div>
    </SignedOutModern>
  );
}
