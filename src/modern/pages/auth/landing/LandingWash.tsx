// The v8 wash behind the landing hero: three soft glows along the top edge (left, middle,
// right) with film grain over them, fading out downward. Ported from Control Scout's Wash
// without the particle wave or the owner's server settings; colours live in landing.css.
import { useId } from 'react';
import './landing.css';

const FADE = 'linear-gradient(to bottom,#000 0%,rgb(0 0 0/.85) 50%,transparent 100%)';
// Each colour mixed into the page by --wash-mix (all of it on Dark, a pale tint on Light).
const tint = (v: string) => `color-mix(in srgb,var(${v}) var(--wash-mix,100%),var(--color-background))`;
// Painted right, middle, left so the left glow sits on top where they overlap.
const GLOWS = [
  `radial-gradient(55% 95% at 12% 0%,${tint('--wash-a')} 0%,transparent 72%)`,
  `radial-gradient(50% 90% at 52% 0%,${tint('--wash-b')} 0%,transparent 72%)`,
  `radial-gradient(55% 95% at 90% 0%,${tint('--wash-c')} 0%,transparent 72%)`,
] as const;

export function LandingWash() {
  const grain = `landing-grain-${useId().replace(/:/g, '')}`;
  return (
    <div
      aria-hidden="true"
      data-testid="landing-wash"
      style={{ maskImage: FADE, WebkitMaskImage: FADE }}
      className="landing-wash pointer-events-none absolute inset-x-0 top-0 h-[clamp(26rem,64vh,40rem)] overflow-hidden"
    >
      {/* No blur filter: the glows are already soft, and a blur over moving layers repaints every frame. */}
      <div className="absolute -inset-x-[10%] -top-1/2 bottom-0">
        {[2, 1, 0].map((i) => (
          <div key={i} data-glow={i} className="landing-wash-glow absolute inset-0" style={{ backgroundImage: GLOWS[i] }} />
        ))}
      </div>
      <svg className="absolute inset-0 size-full opacity-[var(--wash-grain,0.12)] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id={grain}>
          <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${grain})`} />
      </svg>
    </div>
  );
}
