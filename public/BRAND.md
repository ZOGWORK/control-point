# Brand logo

The logo is a faceted "C" (an octagon with sharp, chamfered corners, open on the
right) with the control point, a diamond, inside it, in soft white on a near-black
tile with a wash of colour across the top. It shares Control Scout's v8 tile, wash,
grain and ink, but the mark is its own: sharp where Scout's C is round.

- Graphite background: `#0a0a0b`
- Ink: white `#ffffff` at the top to `#dcd9e8` at the bottom, with a soft shadow
- Wash (three glows along the top edge): `#44587f` slate blue, `#4a4462`, `#6e5076` mauve
- Accent on the share image: slate blue `#a3b6e0`

Volt yellow (`#FED305`) is retired: no brand asset uses it.

## Files

`scripts/make-icons.py` draws every file below (`python scripts/make-icons.py`,
needs Pillow and numpy). The output is deterministic: the grain uses a seeded RNG.

| File | Use |
| --- | --- |
| `logo.png` (512, full bleed) | In-app logo via `src/components/BrandMark.tsx`; CSS rounds the corners |
| `icon-512.png`, `icon-192.png` | Installed app icons (purpose "any"), full bleed like Control Scout's |
| `favicon.png` (64) | Browser tab icon, full bleed |
| `icon-maskable-512.png` | Full bleed, mark at 78% inside the maskable safe zone |
| `apple-touch-icon.png` (180) | Full bleed; iOS rounds it |
| `og-image.jpg` (1200x630) | Social preview: the wash, the icon and name, the headline, the address |

`src/assets/favicon.svg` is the same mark as SVG with a simplified wash. If
`logo.png` fails to load, `BrandMark` renders that SVG mark inline on the
same tile.

`control-scout-icon.png` (96) is Control Scout's own icon, copied from its
`public/icon-512.png`; `control-kit-icon.png` belongs to Control Kit. Neither
is drawn here.

## Changing the logo

Replace the files above, then bump the `?v=` query on every reference
(`index.html`, `public/manifest.webmanifest`, `server/predict/how-it-works.html`,
`BrandMark.tsx`, `ModernShell.tsx`) so browsers and installed PWAs refetch.
The wordmark ("Control Point") and the BETA badge are rendered in code.
