import { useId, useState } from 'react';
import { cn } from './ui';

/** The logo's URL. Bump the version whenever scripts/make-icons.py changes the mark; every logo <img> uses this. */
export const LOGO_SRC = '/logo.png?v=6';

/**
 * BrandMark — the Control Point logo slot.
 *
 * The logo is `public/logo.png` (Control Scout's v8 icon family: a faceted,
 * sharp-cornered "C" with the control point, a diamond, inside it; soft white on
 * the near-black tile with the slate-to-mauve wash; drawn by scripts/make-icons.py).
 * If it fails to load, the same mark renders inline as SVG.
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

/** The mark alone (the faceted C and its diamond point) filling its box, in the icon's soft-white ink.
 *  Polygons from scripts/make-icons.py (mark_polys), scaled to the 100-unit box: the C is the outer
 *  octagon with the inner octagon and the right-hand wedge masked out. */
function MarkSvg() {
  const id = useId().replace(/:/g, '');
  const ink = `cp-ink-${id}`, cut = `cp-cut-${id}`;
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ink} x1="0" y1="18" x2="0" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dcd9e8" />
        </linearGradient>
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <polygon points="34.45,22.49 65.55,22.49 77.51,34.45 77.51,65.55 65.55,77.51 34.45,77.51 22.49,65.55 22.49,34.45" fill="#fff" />
          <polygon points="42.66,36.44 57.34,36.44 63.56,42.66 63.56,57.34 57.34,63.56 42.66,63.56 36.44,57.34 36.44,42.66" fill="#000" />
          <polygon points="50,50 100,23.68 100,76.32" fill="#000" />
        </mask>
      </defs>
      <g fill={`url(#${ink})`}>
        <rect width="100" height="100" mask={`url(#${cut})`} />
        <polygon points="49.2,41.63 57.58,50 49.2,58.37 40.83,50" />
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
      src={LOGO_SRC}
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
