"""Regenerate Control Point's brand images in public/: python scripts/make-icons.py

Needs Pillow and numpy. The output is deterministic (the grain uses a seeded RNG),
so a re-run with no code change leaves every file byte-identical.

The tile is a sibling of Control Scout's v8 icon (control-scout scripts/brand-icon.mjs):
the same near-black tile with the same wash of three glows along the top edge, the
same fine grain, and the mark in the same soft white with a soft shadow. The mark is
Control Point's own: a round C cut open by a crisp wedge (sharp, radial ends), with the
control point (a diamond) inside it, so it does not read as Scout's C with its needle.

Geometry is in units of 1/1254 of the tile's width (the master's size).

Writes:
  favicon.png            64   full-bleed tile (browser tab)
  apple-touch-icon.png   180  full-bleed, opaque (iOS rounds it)
  icon-192.png, icon-512.png   full-bleed (the installed app, purpose "any")
  icon-maskable-512.png  512  full-bleed, mark at 78% inside Android's safe zone
  logo.png               512  full-bleed, opaque (in-app logo; CSS rounds the corners)
  mark.png               512  the bare mark, white on transparent, filling the box (landing hero)
  og-image.jpg           1200x630 link-preview card
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"
FONTS = OUT / "fonts"

BG = (0x0A, 0x0A, 0x0B)
# The wash: (centre x as a fraction of the width, colour, radius as a fraction of the width).
WASH = [(0.12, (0x44, 0x58, 0x7F), 0.62), (0.52, (0x4A, 0x44, 0x62), 0.58), (0.90, (0x6E, 0x50, 0x76), 0.62)]
INK_TOP, INK_BOTTOM = (0xFF, 0xFF, 0xFF), (0xDC, 0xD9, 0xE8)
SLATE = (0xA3, 0xB6, 0xE0)
GRAIN = 0.07
MASTER = 1254  # the master's size, as Scout's, so the grain has the same scale
SEED = 8

# The mark: a round C (a ring, opened on the right by a wedge from the centre, so its ends
# are sharp radial cuts) with the control point, a diamond, in the middle.
# Units: 1/1254 of the tile.
U = 1 / 1254
CX = CY = 627
OUTER = 345  # ring radii
INNER = 182
MOUTH = 330  # the wedge's half-height at the tile's right edge
POINT = (617, 627, 105)  # diamond centre x, y, half-diagonal


def mark_shapes() -> list[tuple[str, object, int]]:
    """The mark in tile units (0..1254), painted in order: 255 adds, 0 cuts.
    ("circle", radius) is centred on the tile; ("poly", points) is a polygon."""
    px, py, pr = POINT
    return [
        ("circle", OUTER, 255),
        ("circle", INNER, 0),
        ("poly", [(CX, CY), (1254, CY - MOUTH), (1254, CY + MOUTH)], 0),
        ("poly", [(px, py - pr), (px + pr, py), (px, py + pr), (px - pr, py)], 255),
    ]


def mark_mask(size: int, scale: float = 1.0, ss: int = 8) -> np.ndarray:
    """The mark's coverage (0..1) on a size x size tile, drawn at ss x and box-filtered down
    (8x, so the round edges stay crisp and the cut ends stay sharp)."""
    S = size * ss
    im = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(im)
    o = (1 - scale) / 2
    pt = lambda x, y: ((o + x * U * scale) * S, (o + y * U * scale) * S)
    for kind, geo, fill in mark_shapes():
        if kind == "circle":
            (x0, y0), (x1, y1) = pt(CX - geo, CY - geo), pt(CX + geo, CY + geo)
            d.ellipse([x0, y0, x1, y1], fill=fill)
        else:
            d.polygon([pt(x, y) for x, y in geo], fill=fill)
    im = im.resize((size, size), Image.BOX)
    return np.asarray(im, dtype=np.float32) / 255


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur of a 2-D or 3-D (H, W, C) array, transparent (zero) outside, via FFT."""
    r = int(np.ceil(sigma * 3))
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-x * x / (2 * sigma * sigma))
    k /= k.sum()
    out = a.astype(np.float64)
    for axis in (0, 1):
        n = out.shape[axis] + 2 * r
        size = 1 << int(np.ceil(np.log2(n + len(k))))
        f = np.fft.rfft(out, size, axis=axis)
        shape = [1] * out.ndim
        shape[axis] = -1
        g = np.fft.rfft(k, size).reshape(shape)
        full = np.fft.irfft(f * g, size, axis=axis)
        out = np.take(full, np.arange(r, r + out.shape[axis]), axis=axis)
    return out.astype(np.float32)


def over(dst: np.ndarray, rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Source-over of straight-alpha colour onto an opaque RGB float image (0..1)."""
    a = alpha[..., None]
    return dst * (1 - a) + rgb * a


def tile(size: int, scale: float = 1.0) -> Image.Image:
    """The full icon at `size`, drawn as Scout draws its master."""
    N = size
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) + 0.5
    img = np.empty((N, N, 3), np.float32)
    img[:] = np.array(BG, np.float32) / 255
    # The wash: three radial glows centred just above the top edge, layered source-over
    # (premultiplied), blurred, then faded out towards the bottom.
    prem = np.zeros((N, N, 3), np.float32)
    acc = np.zeros((N, N), np.float32)
    for cx, col, rx in WASH:
        t = np.clip(np.hypot(xx - cx * N, yy + 0.05 * N) / (rx * N * 1.5), 0, 1)
        a = (1 - t) ** 2.2
        prem = prem * (1 - a[..., None]) + (np.array(col, np.float32) / 255) * a[..., None]
        acc = acc + a * (1 - acc)
    layer = blur(np.dstack([prem, acc]), N * 0.04)
    fade = np.clip(1 - (yy[:, :1] / N / 0.92) ** 1.6, 0, 1)
    layer *= fade[..., None]
    a = np.clip(layer[..., 3], 1e-6, 1)
    col = layer[..., :3] / a[..., None]
    img = over(img, col, layer[..., 3])
    img = over(img, col, layer[..., 3] * 0.6)  # a touch brighter, as Scout's
    # Fine grain: uniform noise, overlay-blended at 7%.
    noise = np.random.default_rng(SEED).random((N, N), dtype=np.float32)[..., None]
    ov = np.where(img < 0.5, 2 * img * noise, 1 - 2 * (1 - img) * (1 - noise))
    img = img * (1 - GRAIN) + ov * GRAIN
    # The mark: soft white (white at 18% to a faint lavender grey at 82%), with a tight
    # shadow (black 30%, blur 1.6% of the size, 0.8% down) so the edges stay crisp.
    m = mark_mask(N, scale)
    shadow = blur(m, N * 0.016 / 2)
    dy = int(round(N * 0.008))
    shadow = np.vstack([np.zeros((dy, N), np.float32), shadow[: N - dy]]) * 0.30
    img = over(img, np.zeros(3, np.float32), shadow)
    t = np.clip((yy[..., None] / N - 0.18) / (0.82 - 0.18), 0, 1)
    ink = (np.array(INK_TOP, np.float32) * (1 - t) + np.array(INK_BOTTOM, np.float32) * t) / 255
    img = over(img, ink, m)
    return Image.fromarray(np.clip(np.round(img * 255), 0, 255).astype(np.uint8), "RGB")


def bare_mark(size: int) -> Image.Image:
    """The mark alone, white on transparent, scaled so the C fills the box (a 2% margin)."""
    scale = 1254 / (2 * OUTER) * 0.96
    a = mark_mask(size, scale)
    rgba = np.zeros((size, size, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def down(im: Image.Image, size: int) -> Image.Image:
    """The master at `size`: halved step by step (sharp small sizes), then resized to the target."""
    while im.width / 2 >= size:
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    return im.resize((size, size), Image.LANCZOS)


def font(px: int, weight: int) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTS / f"Inter-{weight}.woff2"), px)
    try:
        f.set_variation_by_axes([weight])
    except OSError:
        pass  # a static cut
    return f


def og_image(icon: Image.Image) -> Image.Image:
    """The 1200x630 link preview, laid out as Scout's: the wash across the top, the icon and the
    name top-left, one headline, one plain line, the address bottom-left. Drawn at 2x."""
    k = 2
    W, H = 1200 * k, 630 * k
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    img = np.empty((H, W, 3), np.float32)
    img[:] = np.array(BG, np.float32) / 255
    # Scout's CSS: radial-gradient(55% 95% at x 0%, colour, transparent 72%) over the top
    # 420px, blurred 40px, masked from opaque to clear by the bottom of that band.
    gh = 420 * k
    prem = np.zeros((H, W, 3), np.float32)
    acc = np.zeros((H, W), np.float32)
    sizes = {0.12: (0.55, 0.95), 0.52: (0.50, 0.90), 0.90: (0.55, 0.95)}
    for cx, col, _ in reversed(WASH):  # CSS paints the first layer on top
        rx, ry = sizes[cx][0] * W, sizes[cx][1] * gh
        d = np.hypot((xx - cx * W) / rx, yy / ry)
        a = np.clip(1 - d / 0.72, 0, 1) * (yy < gh)
        prem = prem * (1 - a[..., None]) + (np.array(col, np.float32) / 255) * a[..., None]
        acc = acc + a * (1 - acc)
    layer = blur(np.dstack([prem, acc]), 40 * k)
    t = yy[:, :1] / gh
    mask = np.clip(np.where(t < 0.45, 1 - 0.25 * t / 0.45, 0.75 * (1 - (t - 0.45) / 0.55)), 0, 1)
    layer *= mask[..., None]
    a = np.clip(layer[..., 3], 1e-6, 1)
    img = over(img, layer[..., :3] / a[..., None], layer[..., 3])
    out = Image.fromarray(np.clip(np.round(img * 255), 0, 255).astype(np.uint8), "RGB")

    # The icon, with app-icon corners (22% radius).
    s = 76 * k
    ic = down(icon, s)
    rmask = Image.new("L", (s * 4, s * 4), 0)
    ImageDraw.Draw(rmask).rounded_rectangle([0, 0, s * 4 - 1, s * 4 - 1], radius=s * 4 * 0.22, fill=255)
    out.paste(ic, (72 * k, 66 * k), rmask.resize((s, s), Image.LANCZOS))

    d = ImageDraw.Draw(out)
    white, grey, dim = (0xF4, 0xF4, 0xF5), (0xC4, 0xC4, 0xCC), (0xA1, 0xA1, 0xAA)
    name = font(46 * k, 600)
    d.text((72 * k + s + 20 * k, (66 + 38) * k), "Control Point", font=name, fill=white, anchor="lm")
    h1 = font(76 * k, 600)
    x, y = 72 * k, 250 * k
    d.text((x, y), "Your whole team,", font=h1, fill=white, anchor="ls")
    d.text((x, y + 80 * k), "one workspace.", font=h1, fill=SLATE, anchor="ls")
    sub = font(32 * k, 500)
    d.text((x, y + 153 * k), "Attendance, tasks, scouting, budget and chat", font=sub, fill=grey, anchor="ls")
    d.text((x, y + 195 * k), "for your robotics team.", font=sub, fill=grey, anchor="ls")
    d.text((x, (630 - 60) * k), "tryctrlpoint.org", font=font(34 * k, 600), fill=dim, anchor="ls")
    return out.resize((1200, 630), Image.LANCZOS)


def main() -> None:
    master = tile(MASTER)
    maskable = tile(MASTER, scale=0.78)
    down(master, 64).save(OUT / "favicon.png", optimize=True)
    down(master, 180).save(OUT / "apple-touch-icon.png", optimize=True)
    down(master, 192).save(OUT / "icon-192.png", optimize=True)
    down(master, 512).save(OUT / "icon-512.png", optimize=True)
    down(master, 512).save(OUT / "logo.png", optimize=True)
    bare_mark(512).save(OUT / "mark.png", optimize=True)
    down(maskable, 512).save(OUT / "icon-maskable-512.png", optimize=True)
    og_image(master).save(OUT / "og-image.jpg", quality=90, optimize=True, progressive=True)
    print("ok")


if __name__ == "__main__":
    main()
