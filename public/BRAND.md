# Brand logo

The logo is a flat volt hex opened into a "C" with one center point, on a
graphite tile. It shares Control Scout's palette so the two apps read as a
family:

- Graphite background: `#111110`
- Volt mark: `#FED305`

## Files

| File | Use |
| --- | --- |
| `logo.png` (512, full bleed) | In-app logo via `src/components/BrandMark.tsx`; CSS rounds the corners |
| `icon-512.png`, `icon-192.png`, `favicon.png` | Rounded tile with transparent corners |
| `icon-maskable-512.png` | Full bleed, mark kept inside the maskable safe zone |
| `apple-touch-icon.png` (180) | Full bleed; iOS rounds it |
| `og-image.jpg` | Social preview; the header shows the logo |

If `logo.png` fails to load, `BrandMark` renders a bolt icon in the same
colors.

## Changing the logo

Replace the files above, then bump the `?v=` query on every reference
(`index.html`, `public/manifest.webmanifest`, `server/predict/how-it-works.html`,
`BrandMark.tsx`, `ModernShell.tsx`) so browsers and installed PWAs refetch.
The wordmark ("Control Point") and the BETA badge are rendered in code.
