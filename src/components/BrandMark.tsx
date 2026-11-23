import { useId, useState } from 'react';
import { cn } from './ui';

/**
 * BrandMark — the Control Point logo slot.
 *
 * The logo is `public/logo.png` (Control Scout's v8 icon family: a round "C"
 * with a control point in its opening, soft white on the near-black tile with
 * the slate-to-mauve wash; drawn by scripts/make-icons.py). If it fails to
 * load, the same mark renders inline as SVG.
 *
 * Includes the mini BETA badge next to the wordmark (intentionally tiny).
 */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // Beta is always blue, independent of the workspace accent.
        'inline-flex items-center rounded-full border border-sky-400/50 bg-sky-500/15',
        'px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.14em] text-sky-500',
        'leading-none select-none',
        className
      )}
      title="Control Point is in beta"
    >
      Beta
    </span>
  );
}

/** The mark alone (the C and its control point) filling its box, in the icon's soft-white ink. Path from scripts/make-icons.py. */
function MarkSvg() {
  const ink = `cp-ink-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ink} x1="0" y1="18" x2="0" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dcd9e8" />
        </linearGradient>
      </defs>
      <g fill={`url(#${ink})`}>
        <path d="M65.29 26.77A29.47 29.47 0 1 0 75.74 58.57L63.69 51.38A15.3 15.3 0 1 1 53.09 35.35Z" />
        <circle cx="68.42" cy="38.76" r="7.34" />
      </g>
    </svg>
  );
}

// decorative: the name "Control Point" is right next to it, so screen readers
// shouldn't hear it twice.
function LogoImage({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    // Same look as /logo.png: the mark in soft white on the near-black tile, under a simple
    // wash (slate blue to mauve, fading out by two-thirds down).
    return (
      <div
        className={cn('rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden', className)}
        style={{ background: 'linear-gradient(180deg, rgba(10,10,11,.15), #0a0a0b 70%), linear-gradient(90deg, #44587f, #4a4462 52%, #6e5076)' }}
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : 'Control Point logo'}
        aria-hidden={decorative || undefined}
      >
        <MarkSvg />
      </div>
    );
  }
  return (
    <img
      src="/logo.png?v=5"
      alt={decorative ? '' : 'Control Point logo'}
      onError={() => setMissing(true)}
      className={cn('object-contain flex-shrink-0', className)}
    />
  );
}

/** Standalone logo image (with the inline-SVG fallback) for one-off placements. */
export function BrandLogo({ className, decorative }: { className?: string; decorative?: boolean }) {
  return <LogoImage className={className} decorative={decorative} />;
}

export function BrandMark({
  variant = 'sidebar',
  showSubtitle = true,
}: {
  variant?: 'sidebar' | 'compact' | 'landing';
  showSubtitle?: boolean;
}) {
  if (variant === 'compact') {
    return <LogoImage className="w-10 h-10 rounded-2xl" />;
  }
  if (variant === 'landing') {
    return (
      <div className="flex items-center gap-3">
        <LogoImage className="w-11 h-11 rounded-2xl" decorative />
        <div className="flex items-center gap-2">
          <span className="text-2xl font-display font-bold text-text-base tracking-tight">Control Point</span>
          <BetaBadge className="mt-0.5" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      <LogoImage className="w-10 h-10 rounded-2xl" decorative />
      <div className="whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <h1 className="text-[17px] font-display font-bold text-text-base leading-none tracking-tight">Control Point</h1>
          <BetaBadge />
        </div>
        {showSubtitle && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted mt-1">Team workspace</p>
        )}
      </div>
    </div>
  );
}
