// A quiet, dismissible card suggesting a sister app (Control Scout on the
// stats pages, Control Kit on the CAD pages). Never a modal, never blocks
// the page; dismissing hides it for this person on this device, on every
// page that shares the storage key.
import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '../../components/ui-kit';
import { cn } from '../../components/cn';
import { Reveal } from './motion';
import { CONTROL_SCOUT_ICON, CONTROL_SCOUT_URL } from '../../utils/controlScout';

/** Dismissed suggestions are stored per person: `${prefix}:${userId}` = '1'. */
export const sisterAppKey = (prefix: string, userId: unknown) => `${prefix}:${userId ?? 'anon'}`;
export const CONTROL_KIT_SUGGESTION = 'cp-cad-control-kit-promo-dismissed';
export const CONTROL_SCOUT_SUGGESTION = 'cp-stats-control-scout-suggestion-dismissed';

const isDismissed = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };

type SuggestionProps = {
  storageKey: string; icon: string; title: string; body: string; href: string; cta: string;
  /** The app's name, for the dismiss button's label ("Dismiss the Control Kit card"). */
  app: string; className?: string;
};

/** Keyed by its storage key, so switching workspace (a new user id) re-reads that membership's dismissal. */
export function SisterAppSuggestion(props: SuggestionProps) {
  return <SuggestionCard key={props.storageKey} {...props} />;
}

function SuggestionCard({ storageKey, icon, title, body, href, cta, app, className }: SuggestionProps) {
  const [dismissed, setDismissed] = useState(() => isDismissed(storageKey));
  if (dismissed) return null;
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(storageKey, '1'); } catch { /* storage blocked: hidden for this visit */ } };
  return (
    <Reveal className={cn('mb-8 flex items-start gap-4 rounded-2xl border border-border bg-card p-5', className)}>
      <img src={icon} alt="" aria-hidden className="size-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        <Button asChild variant="outline" size="sm" className="mt-3 max-sm:h-11">
          <a href={href} target="_blank" rel="noopener noreferrer">{cta} <ExternalLink /><span className="sr-only"> (opens in a new tab)</span></a>
        </Button>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label={`Dismiss the ${app} card`} className="max-sm:size-11"><X /></Button>
    </Reveal>
  );
}

/** "Detailed stats in Control Scout", on Team Stats and Predict; one dismissal hides it on both. */
export function ControlScoutSuggestion({ userId, href = CONTROL_SCOUT_URL }: { userId?: number | null; href?: string }) {
  return (
    <SisterAppSuggestion storageKey={sisterAppKey(CONTROL_SCOUT_SUGGESTION, userId)} icon={CONTROL_SCOUT_ICON} href={href}
      title="Detailed stats in Control Scout" body="Full team, event and match overviews, rankings and predictions for every FTC team."
      cta="Open Control Scout" app="Control Scout" />
  );
}
