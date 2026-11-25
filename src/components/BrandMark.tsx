import { useId, useState } from 'react';
import { cn } from './ui';

/** The logo's URL. Bump the version whenever scripts/make-icons.py changes the mark; every logo <img> uses this. */
export const LOGO_SRC = '/logo.png?v=8';
/** The bare mark (white on transparent, no tile), same version as the logo. */
export const MARK_SRC = '/mark.png?v=8';

/**
 * BrandMark — the Control Point logo slot.
 *
 * The logo is `public/logo.png` (Control Scout's v8 icon family: a rounded-square
 * "C" cut open by a crisp wedge, with the control point, a diamond, inside it; soft white on
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

/** The mark alone (the rounded-square C and its diamond point) filling its box, in the icon's soft-white ink.
 *  Shapes from scripts/make-icons.py (mark_shapes), scaled to the 100-unit box: the C is the outer
 *  squircle with the inner squircle and the right-hand wedge masked out; the diamond is dead centre. */
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
          <polygon points="77.51,50.00 77.39,59.94 77.04,64.00 76.44,67.02 75.60,69.45 74.51,71.47 73.13,73.13 71.47,74.51 69.45,75.60 67.02,76.44 64.00,77.04 59.94,77.39 50.00,77.51 40.06,77.39 36.00,77.04 32.98,76.44 30.55,75.60 28.53,74.51 26.87,73.13 25.49,71.47 24.40,69.45 23.56,67.02 22.96,64.00 22.61,59.94 22.49,50.00 22.61,40.06 22.96,36.00 23.56,32.98 24.40,30.55 25.49,28.53 26.87,26.87 28.53,25.49 30.55,24.40 32.98,23.56 36.00,22.96 40.06,22.61 50.00,22.49 59.94,22.61 64.00,22.96 67.02,23.56 69.45,24.40 71.47,25.49 73.13,26.87 74.51,28.53 75.60,30.55 76.44,32.98 77.04,36.00 77.39,40.06" fill="#fff" />
          <polygon points="64.51,50.00 64.45,55.24 64.26,57.38 63.95,58.98 63.51,60.26 62.93,61.32 62.20,62.20 61.32,62.93 60.26,63.51 58.98,63.95 57.38,64.26 55.24,64.45 50.00,64.51 44.76,64.45 42.62,64.26 41.02,63.95 39.74,63.51 38.68,62.93 37.80,62.20 37.07,61.32 36.49,60.26 36.05,58.98 35.74,57.38 35.55,55.24 35.49,50.00 35.55,44.76 35.74,42.62 36.05,41.02 36.49,39.74 37.07,38.68 37.80,37.80 38.68,37.07 39.74,36.49 41.02,36.05 42.62,35.74 44.76,35.55 50.00,35.49 55.24,35.55 57.38,35.74 58.98,36.05 60.26,36.49 61.32,37.07 62.20,37.80 62.93,38.68 63.51,39.74 63.95,41.02 64.26,42.62 64.45,44.76" fill="#000" />
          <polygon points="50,50 100,23.68 100,76.32" fill="#000" />
        </mask>
      </defs>
      <g fill={`url(#${ink})`}>
        <rect width="100" height="100" mask={`url(#${cut})`} />
        <polygon points="50,42.03 57.97,50 50,57.97 42.03,50" />
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

/** The bare C (public/mark.png, no tile), painted in the current text colour through a CSS mask
 *  so it reads in both themes. Decorative: callers put it next to the name. */
export function BrandGlyph({ className }: { className?: string }) {
  const url = `url(${MARK_SRC})`;
  return (
    <span
      aria-hidden="true"
      data-brand-glyph=""
      className={cn('inline-block flex-shrink-0 bg-current', className)}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' }}
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
