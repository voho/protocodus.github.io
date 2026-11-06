"""Hedgerow — tileable detail textures.

    python3 fun/hedgerow/tools/textures.py            # all
    python3 fun/hedgerow/tools/textures.py stone mud  # some

Writes `assets/textures/<name>.webp` (512² model detail, 1024² ground).

Two kinds:

* detail textures for models (stone, plaster, brick, tile, slate, planks,
  bark, fabric, concrete, metal, rock, foliage): RGB = tangent-space normal,
  A = albedo detail (0.5 = the palette colour, darker below, lighter above).
  The game tints them with each material's palette colour.
* ground textures for the terrain (mud, grass, forest, cobble): RGB = albedo
  (sRGB), A = height; their normals come from `<name>_n.webp` (RGB normal,
  A = roughness).
* landscape: independent linear broad fields, R = moisture, G = growth,
  B = organic drift, A = secondary noise. 256², lossless scalar data.

Procedural fields use periodic pieces (spectral noise from filtered white
noise, wrapped cells and np.roll). Sward and litter use retained seamless
diffuse sources, sampled with wrapped resampling. Rebuilds are deterministic:
fixed seeds and source bytes. Prompts/provenance: tools/texture-sources/.
"""
import os, sys, json
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'textures')
SOURCES = os.path.join(HERE, 'texture-sources')
N = 512
USE_GENERATED = True


# --------------------------------------------------------------------------
# periodic building blocks

def spectral(n, beta, seed, lo=1.0, hi=None, aniso=(1.0, 1.0)):
    """Tileable fractal noise: white noise filtered by 1/f^beta. aniso
    stretches the spectrum (x, y) for streaky noise. Returns 0..1."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((n, n))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(n)[:, None] * n * aniso[1]
    fx = np.fft.fftfreq(n)[None, :] * n * aniso[0]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    amp = 1.0 / np.power(f, beta)
    amp[f < lo] = 0.0
    if hi is not None:
        amp *= np.exp(-(f / hi) ** 2)
    out = np.real(np.fft.ifft2(F * amp))
    out -= out.min()
    out /= max(out.max(), 1e-9)
    return out


def cells(n, count, seed, stretch=(1.0, 1.0), jitter=1.0, grid=None):
    """Periodic Worley noise. Returns (F1, F2, id) with distances in pixels.
    `grid` = (gx, gy) places one point per grid cell (jittered) instead of
    uniformly random points."""
    rng = np.random.default_rng(seed)
    if grid:
        gx, gy = grid
        xs, ys = np.meshgrid(np.arange(gx), np.arange(gy))
        px = (xs.ravel() + 0.5 + (rng.random(gx * gy) - 0.5) * jitter) * n / gx
        py = (ys.ravel() + 0.5 + (rng.random(gx * gy) - 0.5) * jitter) * n / gy
    else:
        px = rng.random(count) * n
        py = rng.random(count) * n
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    f1 = np.full((n, n), 1e9, np.float32)
    f2 = np.full((n, n), 1e9, np.float32)
    ident = np.zeros((n, n), np.int32)
    sx, sy = stretch
    for i, (x, y) in enumerate(zip(px, py)):
        dx = np.abs(xx - x)
        dx = np.minimum(dx, n - dx) / sx
        dy = np.abs(yy - y)
        dy = np.minimum(dy, n - dy) / sy
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        ident = np.where(closer, i, ident)
        f1 = np.where(closer, d, f1)
    return f1, f2, ident


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blur(img, r):
    """Periodic box-ish blur (three box passes ~ gaussian)."""
    out = img.astype(np.float32)
    for _ in range(3):
        acc = np.zeros_like(out)
        for d in range(-r, r + 1):
            acc += np.roll(out, d, axis=1)
        out = acc / (2 * r + 1)
        acc = np.zeros_like(out)
        for d in range(-r, r + 1):
            acc += np.roll(out, d, axis=0)
        out = acc / (2 * r + 1)
    return out


def normal_from_height(h, strength):
    """Tangent-space normal (OpenGL convention, +Y up in the image = -row)."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) * 0.5
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], axis=-1)


def pack_ground_vectors(normal, rough):
    """Bounded precision for linear data, encoded with lossless WebP.

    Seven effective bits in X/Y and six in roughness save download bytes
    without YUV's directional smearing. Blue follows the stored X/Y vector,
    retaining unit length. On the shipped maps the extra P95 angular error
    is below 0.7 degrees; roughness error is at most 2/255.
    """
    rgb = np.rint((normal * .5 + .5) * 255).clip(0, 255)
    xy = np.clip(np.rint((rgb[..., :2] - 128) / 2) * 2 + 128, 0, 255)
    z = np.sqrt(np.maximum(1 - np.sum((xy / 127.5 - 1) ** 2, axis=-1), .001))
    blue = np.rint((z * .5 + .5) * 255)
    alpha = np.clip(np.rint(np.clip(rough, 0, 1) * 255 / 4) * 4, 0, 255)
    return np.dstack([xy, blue, alpha]).astype(np.uint8)


def per_cell(ident, seed, count=None):
    rng = np.random.default_rng(seed)
    vals = rng.random(int(ident.max()) + 1)
    return vals[ident]


def rect_layout(n, rows, cols, seed, offset_rows=True, jitter=0.0, widths=None, warp=None):
    """Row/column brick-like layout: returns (u, v) within each cell (0..1),
    cell id, and distance to the cell edge in pixels (min of x and y).
    `warp` = (wx, wy) pixel offset fields bend the joints (periodic)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    if warp is not None:
        xx = (xx + warp[0]) % n
        yy = (yy + warp[1]) % n
    rh = n / rows
    row = np.floor(yy / rh).astype(np.int32)
    v = (yy - row * rh) / rh
    shift = np.where(row % 2 == 1, 0.5, 0.0) if offset_rows else 0.0
    row_jit = rng.random(rows) * jitter
    cw = n / cols
    xs = (xx / cw + shift + row_jit[row]) % cols
    col = np.floor(xs).astype(np.int32)
    u = xs - col
    ident = row * cols + col
    ex = np.minimum(u, 1 - u) * cw
    ey = np.minimum(v, 1 - v) * rh
    return u, v, ident, np.minimum(ex, ey), ex, ey


def pack_detail(name, height, albedo, strength):
    """RGB = normal from height, A = albedo detail (0..1, 0.5 neutral)."""
    nrm = normal_from_height(height, strength)
    rgb = ((nrm * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    a = (np.clip(albedo, 0, 1) * 255).astype(np.uint8)
    img = np.dstack([rgb, a])
    save(name, img)


def pack_ground(name, albedo_rgb, height, rough, strength):
    # Albedo is authored in linear light; the browser decodes the exact sRGB
    # transfer function. Alpha remains linear data, untouched by that decode.
    c = np.clip(albedo_rgb, 0, 1)
    srgb = np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
    rgb = np.rint(srgb * 255).astype(np.uint8)
    a = np.rint(np.clip(height, 0, 1) * 255).astype(np.uint8)
    save(name, np.dstack([rgb, a]))
    # Derive from the *shipped* quantized height so parallax and lighting
    # describe exactly the same surface. Lossy YUV colour subsampling is not
    # suitable for these RGB vectors: it changes the direction of narrow ribs.
    nrm = normal_from_height(a.astype(np.float32) / 255, strength)
    save(name + '_n', pack_ground_vectors(nrm, rough), lossless=True)


def save(name, img, lossless=False):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.webp')
    # The dev server can be reading these while an art iteration runs. Publish
    # each complete file atomically, never a partly encoded WebP.
    pending = path + '.pending'
    Image.fromarray(img, 'RGBA').save(pending, 'WEBP', quality=80 if img.shape[0] > 512 else 88,
                                    lossless=lossless, method=6, exact=True)
    os.replace(pending, path)
    print(f'{name:10s} {os.path.getsize(path) // 1024:4d} KB')


def lin(hexcode):
    c = np.array([int(hexcode[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


# --------------------------------------------------------------------------
# model detail textures (tile = see materials.js for metres per tile)

def stone():
    """Rubble masonry, ~2 m tile: irregular stones in rough courses, mortar."""
    f1, f2, ident = cells(N, 0, 11, stretch=(1.35, 1.0), jitter=0.9, grid=(9, 12))
    edge = f2 - f1
    mortar = 1 - smoothstep(1.5, 6.0, edge)
    rnd = per_cell(ident, 12)
    bulge = smoothstep(0.0, 14.0, edge) ** 0.6
    fine = spectral(N, 1.6, 13, lo=4)
    grain = spectral(N, 1.0, 14, lo=40)
    h = bulge * (0.7 + 0.3 * rnd) + 0.25 * fine + 0.08 * grain
    h = h * (1 - 0.8 * mortar)
    alb = 0.42 + 0.22 * rnd + 0.18 * (fine - 0.5) + 0.08 * (grain - 0.5)
    alb = alb * (1 - 0.35 * mortar) + 0.08 * mortar
    pack_detail('stone', h, alb, 5.0)


def plaster():
    """Lime plaster, ~2 m tile: blotches, trowel marks, hairline cracks,
    a few patches fallen off."""
    low = spectral(N, 2.2, 21, lo=1)
    mid = spectral(N, 1.5, 22, lo=6)
    fine = spectral(N, 0.9, 23, lo=60)
    f1, f2, _ = cells(N, 0, 24, grid=(5, 5), jitter=1.0)
    crack = 1 - smoothstep(0.0, 1.2, f2 - f1)
    crack *= smoothstep(0.55, 0.75, spectral(N, 2.0, 25, lo=2))
    patch = smoothstep(0.8, 0.9, spectral(N, 2.4, 26, lo=2))
    h = 0.5 + 0.25 * (mid - 0.5) + 0.12 * (fine - 0.5) - 0.5 * crack - 0.2 * patch
    alb = 0.5 + 0.28 * (low - 0.5) + 0.1 * (mid - 0.5) + 0.06 * (fine - 0.5) - 0.3 * crack - 0.07 * patch
    pack_detail('plaster', h, alb, 3.0)


def brick():
    """Brick, 1 m tile: 4 bricks across, 14 courses."""
    u, v, ident, edge, ex, ey = rect_layout(N, 14, 4, 31)
    rnd = per_cell(ident, 32)
    mortar = 1 - smoothstep(1.0, 3.0, edge)
    fine = spectral(N, 1.3, 33, lo=8)
    chips = smoothstep(0.72, 0.8, spectral(N, 1.8, 34, lo=4))
    h = (smoothstep(0, 5, edge) * 0.8 + 0.2 * fine) * (1 - mortar) - 0.25 * chips
    alb = 0.38 + 0.3 * rnd + 0.12 * (fine - 0.5)
    alb = alb * (1 - mortar) + 0.62 * mortar
    pack_detail('brick', h, alb, 4.0)


def tile():
    """Barrel (Roman) roof tiles, 2 m tile: 8 channels across, 10 courses."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    rows, cols = 10, 8
    rh, cw = N / rows, N / cols
    row = np.floor(yy / rh)
    v = (yy - row * rh) / rh
    shift = np.where(row % 2 == 1, 0.5, 0.0)
    xs = xx / cw + shift
    col = np.floor(xs)
    u = xs - col
    ident = (row * cols + (col % cols)).astype(np.int32)
    rnd = per_cell(ident, 41)
    curve = np.sin(u * np.pi) ** 0.7
    # each course overlaps the one below: the lower edge is raised, a shadow above it
    overlap = smoothstep(0.0, 0.25, v) * (1 - 0.6 * smoothstep(0.85, 1.0, v))
    fine = spectral(N, 1.4, 42, lo=8)
    h = 0.55 * curve + 0.35 * (1 - v) + 0.1 * fine
    alb = 0.45 + 0.25 * rnd + 0.12 * (fine - 0.5) - 0.25 * (1 - overlap) - 0.15 * (1 - curve)
    lichen = smoothstep(0.7, 0.8, spectral(N, 1.8, 43, lo=3))
    alb = alb * (1 - 0.3 * lichen)
    pack_detail('tile', h, alb, 6.0)


def slate():
    """Slate roof, 2 m tile: 9 courses of staggered rectangular slates."""
    u, v, ident, edge, ex, ey = rect_layout(N, 9, 7, 51, jitter=0.15)
    rnd = per_cell(ident, 52)
    gap = 1 - smoothstep(0.5, 2.0, ex)
    fine = spectral(N, 1.2, 53, lo=10, aniso=(1.0, 0.4))
    h = (1 - v) * 0.6 + 0.15 * fine - 0.4 * gap
    alb = 0.45 + 0.18 * rnd + 0.1 * (fine - 0.5) - 0.3 * smoothstep(0.85, 1.0, v) - 0.25 * gap
    pack_detail('slate', h, alb, 5.0)


def planks():
    """Vertical weathered planks, 2 m tile: 10 boards across."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cols = 10
    cw = N / cols
    col = np.floor(xx / cw).astype(np.int32)
    u = xx / cw - col
    rnd = np.random.default_rng(61).random(cols)[col]
    grain = spectral(N, 1.2, 62, lo=4, aniso=(1.0, 12.0))
    grain2 = spectral(N, 1.0, 63, lo=30, aniso=(1.0, 7.0))
    gap = 1 - smoothstep(0.0, 0.035, np.minimum(u, 1 - u))
    # a few knots
    f1, _, _ = cells(N, 14, 64, stretch=(1.0, 2.2))
    knot = 1 - smoothstep(2.0, 7.0, f1)
    h = 0.6 + 0.25 * (grain - 0.5) + 0.12 * (grain2 - 0.5) - 0.7 * gap - 0.2 * knot
    alb = 0.45 + 0.2 * rnd + 0.25 * (grain - 0.5) + 0.1 * (grain2 - 0.5) - 0.3 * gap - 0.2 * knot
    pack_detail('planks', h, alb, 4.0)


def bark():
    """Furrowed bark, 1 m tile (v along the trunk)."""
    ridge = spectral(N, 1.4, 71, lo=3, aniso=(1.0, 5.5))
    ridge = 1 - np.abs(ridge - 0.5) * 2
    fine = spectral(N, 1.0, 72, lo=20, aniso=(1.0, 2.5))
    plates = smoothstep(0.3, 0.7, ridge)
    h = 0.75 * plates + 0.25 * fine
    alb = 0.32 + 0.45 * plates + 0.12 * (fine - 0.5)
    lichen = smoothstep(0.72, 0.8, spectral(N, 1.6, 73, lo=3))
    alb = alb + 0.25 * lichen * plates
    pack_detail('bark', h, alb, 7.0)


def fabric():
    """Woven cotton/wool with wear, 0.5 m tile."""
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    k = 2 * np.pi * 64 / N
    weave = 0.5 + 0.25 * np.sin(xx * k) * np.sign(np.sin(yy * k / 2)) + 0.25 * np.sin(yy * k) * np.sign(np.sin(xx * k / 2))
    blot = spectral(N, 2.0, 81, lo=1)
    fine = spectral(N, 1.0, 82, lo=40)
    h = 0.5 * weave + 0.3 * fine + 0.2 * blot
    alb = 0.5 + 0.16 * (weave - 0.5) + 0.12 * (blot - 0.5) + 0.1 * (fine - 0.5)
    pack_detail('fabric', h, alb, 2.0)


def concrete():
    """Cast concrete with board marks and pits, 2 m tile."""
    low = spectral(N, 2.1, 91, lo=1)
    fine = spectral(N, 1.1, 92, lo=30)
    yy, _ = np.mgrid[0:N, 0:N].astype(np.float32)
    boards = np.abs(((yy / (N / 8)) % 1.0) - 0.5) * 2
    board_line = 1 - smoothstep(0.92, 0.99, boards)
    rng = np.random.default_rng(93)
    pits = np.zeros((N, N), np.float32)
    for _ in range(900):
        x, y = rng.integers(0, N, 2)
        r = rng.integers(1, 3)
        pits[max(0, y - r):y + r, max(0, x - r):x + r] = 1
    pits = blur(pits, 1)
    grain = spectral(N, 1.2, 94, lo=6, aniso=(1.0, 0.1))
    h = 0.6 + 0.2 * (fine - 0.5) - 0.5 * pits + 0.15 * (board_line - 1) + 0.1 * (grain - 0.5)
    alb = 0.5 + 0.28 * (low - 0.5) + 0.08 * (fine - 0.5) - 0.25 * pits + 0.06 * (grain - 0.5)
    stains = smoothstep(0.6, 0.9, spectral(N, 1.6, 95, lo=2, aniso=(1.0, 4.0)))
    alb -= 0.15 * stains
    pack_detail('concrete', h, alb, 3.0)


def metal():
    """Painted/worn metal, 1 m tile: subtle orange peel, scratches, rust spots."""
    peel = spectral(N, 1.0, 101, lo=40)
    low = spectral(N, 2.0, 102, lo=1)
    rng = np.random.default_rng(103)
    scratch = np.zeros((N, N), np.float32)
    for _ in range(160):
        x, y = rng.random(2) * N
        a = rng.random() * np.pi
        L = rng.integers(10, 70)
        for t in range(L):
            xi = int(x + np.cos(a) * t) % N
            yi = int(y + np.sin(a) * t) % N
            scratch[yi, xi] = 1
    rust = smoothstep(0.7, 0.85, spectral(N, 1.8, 104, lo=3))
    h = 0.5 + 0.08 * (peel - 0.5) - 0.2 * scratch - 0.1 * rust
    alb = 0.5 + 0.18 * (low - 0.5) + 0.25 * scratch - 0.18 * rust
    pack_detail('metal', h, alb, 2.0)


def rock():
    """Weathered granite, 3 m tile: crystals, cracks, lichen."""
    big = spectral(N, 2.0, 111, lo=1)
    mid = spectral(N, 1.5, 112, lo=6)
    crystals = spectral(N, 0.6, 113, lo=80)
    f1, f2, _ = cells(N, 0, 114, grid=(4, 4), jitter=1.0)
    crack = 1 - smoothstep(0.0, 1.5, f2 - f1)
    lichen = smoothstep(0.7, 0.78, spectral(N, 1.7, 115, lo=4))
    h = 0.45 * big + 0.35 * mid + 0.1 * crystals - 0.5 * crack + 0.05 * lichen
    alb = 0.5 + 0.2 * (mid - 0.5) + 0.15 * (crystals - 0.5) + 0.12 * (big - 0.5) - 0.35 * crack + 0.15 * lichen
    pack_detail('rock', h, alb, 5.0)


def foliage():
    """Leaf/needle clumps, 1 m tile."""
    # many small overlapping leaves: two cell layers, soft edges, no outlines
    f1, f2, ident = cells(N, 0, 121, grid=(34, 34), jitter=1.0, stretch=(1.0, 1.6))
    rnd = per_cell(ident, 122)
    g1, g2, ident2 = cells(N, 0, 124, grid=(27, 27), jitter=1.0, stretch=(1.6, 1.0))
    rnd2 = per_cell(ident2, 125)
    leaf = smoothstep(0.0, 5.0, f2 - f1)
    leaf2 = smoothstep(0.0, 5.0, g2 - g1)
    top = np.where(rnd2 > 0.5, leaf2, leaf * 0.8)
    fine = spectral(N, 1.0, 123, lo=40)
    low = spectral(N, 2.0, 126, lo=1)
    h = 0.45 * top + 0.2 * rnd + 0.15 * fine + 0.2 * low
    alb = 0.38 + 0.25 * np.where(rnd2 > 0.5, rnd2, rnd) + 0.12 * top + 0.15 * (low - 0.5) + 0.08 * (fine - 0.5)
    pack_detail('foliage', h, alb, 4.0)


# --------------------------------------------------------------------------
# terrain ground textures (4 m tile, 1024² — the ground fills half the screen)

NG = 1024


def patch_coords(n, cx, cy, radius):
    """A small unwrapped stamp with wrapped destination coordinates.

    Keep both sides of a stamp, including ones crossing a tile boundary. A
    clipped paint operation is a subtle seam even when its noise is periodic.
    """
    r = int(np.ceil(radius))
    x = np.arange(int(cx) - r, int(cx) + r + 1)
    y = np.arange(int(cy) - r, int(cy) + r + 1)
    yy, xx = np.meshgrid(y - cy, x - cx, indexing='ij')
    return np.ix_(y % n, x % n), xx, yy


def sward_blades(alb, h, seed, tufts=1800):
    """Overlapping, tapered leaves in coherent tufts, not anisotropic noise.

    A 4.3 m tile puts these 2–10 cm leaves at their real scale. The tall
    standing grass is separate geometry; this is the compressed basal sward.
    """
    n = len(h)
    rng = np.random.default_rng(seed)
    greens = np.stack([lin(c) for c in ('#303c20', '#4c582d', '#586035', '#3c4d26', '#68623e')])
    for _ in range(tufts):
        cx, cy = rng.random(2) * n
        direction = rng.random() * np.pi * 2
        for _ in range(rng.integers(5, 10)):
            length = rng.uniform(5, 24)
            width = rng.uniform(0.55, 1.3)
            angle = direction + rng.normal(0, 0.8)
            bend = rng.uniform(-4, 4)
            sx, sy = cx + rng.normal(0, 2), cy + rng.normal(0, 2)
            idx, xx, yy = patch_coords(n, sx, sy, length + abs(bend) + 2)
            u = xx * np.cos(angle) + yy * np.sin(angle)
            v = -xx * np.sin(angle) + yy * np.cos(angle)
            t = np.clip(u / length, 0, 1)
            center = bend * np.sin(t * np.pi * 0.7)
            radius = width * (0.8 + 0.5 * np.sin(t * np.pi)) * (1 - t ** 3)
            cross = np.abs(v - center)
            m = smoothstep(-0.65, 0.65, radius - cross)
            m *= smoothstep(-0.5, 0.8, u) * (1 - smoothstep(length - 1, length + 0.4, u))
            crown = np.clip(1 - cross / np.maximum(radius, 0.2), 0, 1)
            col = greens[rng.choice(len(greens), p=(.17, .29, .15, .30, .09))]
            color = col * (0.75 + 0.35 * crown)[..., None]
            alb[idx] = mix(alb[idx], color, m * 0.88)
            # Thin overlapping blades rest just above the mat, never sharp
            # noise spikes that turn into a metallic sheen in lower mip levels.
            raised = 0.47 + rng.uniform(-0.035, 0.035) + 0.07 * crown
            h[idx] = h[idx] * (1 - m) + raised * m
    return alb, h


def mineral_gravel(alb, h, seed, count=700):
    """Partly buried irregular grains, with colour and relief sharing a mask."""
    n = len(h)
    rng = np.random.default_rng(seed)
    palette = np.stack([lin(c) for c in ('#6c6657', '#544e42', '#8a806d', '#454741', '#78664e')])
    for _ in range(count):
        cx, cy = rng.random(2) * n
        size = rng.uniform(1.5, 6.5)
        idx, xx, yy = patch_coords(n, cx, cy, size + 2)
        angle = rng.uniform(0, np.pi)
        u = (xx * np.cos(angle) + yy * np.sin(angle)) / size
        v = (-xx * np.sin(angle) + yy * np.cos(angle)) / (size * rng.uniform(.55, .9))
        theta = np.arctan2(v, u)
        d = np.sqrt(u * u + v * v) / (1 + .12 * np.sin(theta * 5 + angle))
        m = 1 - smoothstep(.68, 1.0, d)
        m *= rng.uniform(.45, .92)  # fines bury the lower half of the stone
        crown = np.clip(1 - d * d, 0, 1)
        color = palette[rng.integers(len(palette))] * (0.82 + 0.26 * crown)[..., None]
        alb[idx] = mix(alb[idx], color, m)
        h[idx] += .12 * m * crown
    return alb, h


def fallen_leaves(alb, h, seed, count=2300):
    """Beech, lobed oak and narrow ash litter, curled and partly decomposed.

    In July these are last year's leaves, mostly dark brown. A shared leaf
    mask drives the pigment, paper-thin relief, rib and broken edge. No baked
    directional light is used, so the runtime sun can move independently.
    """
    n = len(h)
    rng = np.random.default_rng(seed)
    palette = np.stack([lin(c) for c in ('#58432d', '#6b5033', '#403323', '#79603d', '#3e3928', '#5d5133')])
    drifts = spectral(n, 1.9, seed + 1, lo=2)
    decay = spectral(n, 1.2, seed + 2, lo=30)
    coverage = np.zeros_like(h)
    for _ in range(count):
        cx, cy = rng.random(2) * n
        if drifts[int(cy) % n, int(cx) % n] < .28:
            continue
        size = rng.uniform(7, 18)
        species = rng.choice(3, p=(.45, .35, .20))
        aspect = rng.uniform(.40, .58) if species < 2 else rng.uniform(.24, .34)
        idx, xx, yy = patch_coords(n, cx, cy, size + 2)
        angle = rng.random() * np.pi * 2
        u = (xx * np.cos(angle) + yy * np.sin(angle)) / size
        v = (-xx * np.sin(angle) + yy * np.cos(angle)) / (size * aspect)
        shape = np.clip(1 - u * u, 0, 1) ** (.65 if species != 1 else .48)
        if species == 1:
            shape *= .72 + .24 * np.cos((u + .08) * np.pi * 4.2)
        else:
            shape *= 1 + .035 * np.sin(u * 48 + angle)  # small serrations
        m = smoothstep(-.07, .04, shape - np.abs(v)) * (np.abs(u) < 1)
        # Irregular rotted margins and occasional holes interrupt silhouettes.
        local_decay = decay[idx]
        m *= smoothstep(.21, .36, local_decay + .18 * (1 - np.abs(v)))
        cross = np.clip(np.abs(v) / np.maximum(shape, .001), 0, 1)
        rib = 1 - smoothstep(.025, .11, np.abs(v))
        branches = np.abs(((u * 4.5 - np.abs(v) * 1.7) % 1) - .5)
        vein = (1 - smoothstep(.01, .075, branches)) * (1 - cross) * .35
        curl = cross ** 5 * (.7 + .3 * np.sin(u * 7 + angle))
        col = palette[rng.integers(len(palette))]
        col = col * (.79 + .24 * (1 - cross) + .08 * rib + .04 * vein)[..., None]
        col *= (.84 + .32 * local_decay)[..., None]
        alb[idx] = mix(alb[idx], col, m * .94)
        leaf_h = .48 + rng.uniform(-.04, .035) + .055 * curl + .018 * rib + .008 * vein
        h[idx] = h[idx] * (1 - m) + leaf_h * m
        coverage[idx] = np.maximum(coverage[idx], m)
    return alb, h, coverage


def stamp_ellipses(n, count, seed, size=(4, 10), aspect=(0.3, 0.6)):
    """Periodic field of random ellipses: returns (coverage 0..1, id value)."""
    rng = np.random.default_rng(seed)
    cov = np.zeros((n, n), np.float32)
    val = np.zeros((n, n), np.float32)
    for _ in range(count):
        cx, cy = rng.random(2) * n
        a = rng.uniform(*size)
        b = a * rng.uniform(*aspect)
        th = rng.random() * np.pi
        r = int(a + 2)
        ys = (np.arange(int(cy) - r, int(cy) + r + 1)) % n
        xs = (np.arange(int(cx) - r, int(cx) + r + 1)) % n
        yy, xx = np.meshgrid(np.arange(-r, r + 1) + (int(cy) - cy), np.arange(-r, r + 1) + (int(cx) - cx), indexing='ij')
        u = xx * np.cos(th) + yy * np.sin(th)
        v = -xx * np.sin(th) + yy * np.cos(th)
        d = (u / a) ** 2 + (v / b) ** 2
        m = np.clip(1.0 - d, 0, 1) ** 0.5
        sub = cov[np.ix_(ys, xs)]
        upd = m > sub
        sub = np.where(upd, m, sub)
        cov[np.ix_(ys, xs)] = sub
        vs = val[np.ix_(ys, xs)]
        val[np.ix_(ys, xs)] = np.where(upd & (m > 0), rng.random(), vs)
    return cov, val


def scratch_lines(n, count, seed, length=(10, 60), width=1):
    rng = np.random.default_rng(seed)
    out = np.zeros((n, n), np.float32)
    for _ in range(count):
        x, y = rng.random(2) * n
        a = rng.random() * np.pi
        L = rng.integers(*length)
        bend = (rng.random() - 0.5) * 0.02
        for t in range(L):
            a += bend
            xi = int(x + np.cos(a) * t) % n
            yi = int(y + np.sin(a) * t) % n
            out[yi, xi] = 1
    return blur(out, width) * 3 if width else out


def mud():
    """Compacted silty clay, broken aggregates, embedded grit and old straw.

    World-space wheel ruts and water are rendered by the terrain shader; baking
    parallel stripes here would repeat the same rut in every four-metre square.
    """
    n = NG
    big = spectral(n, 2.2, 201, lo=1, hi=8)
    mid = spectral(n, 1.7, 202, lo=10, hi=70)
    grain = spectral(n, .7, 203, lo=90, hi=300)
    aggregate = spectral(n, 1.1, 204, lo=25, hi=140)
    # The clay breaks into rounded, connected clods. A low-amplitude grain
    # layer remains visible near the eye without making the whole lane sparkle.
    clods = smoothstep(.30, .66, aggregate)
    h = .38 + .17 * (big - .5) + .20 * (mid - .5) + .13 * clods + .025 * (grain - .5)
    clay = np.clip(.22 + .52 * mid + .18 * big + .12 * (aggregate - .5), 0, 1)
    alb = mix(lin('#2d241b'), lin('#62513c'), clay)
    alb *= (.95 + .10 * grain)[..., None]
    alb, h = mineral_gravel(alb, h, 205, 850)
    straw = np.clip(scratch_lines(n, 200, 207, (5, 25), 0), 0, 1)
    straw *= smoothstep(.48, .68, spectral(n, 1.5, 208, lo=3))
    alb = mix(alb, lin('#76623f'), straw * .65)
    h += straw * .025
    # A few centimetres of churned clay need more than a nearly flat height
    # interval. Keep its mean stable for blending while restoring broad
    # hollows for the runtime's rain-water cap and near-eye relief.
    h = .44 + (h - .44) * 1.45
    # Dry roughness belongs to the mineral surface. The runtime handles rain,
    # hollows and standing water, so no mirror-smooth patches are baked in.
    rough = np.clip(.76 + .13 * (mid - .5) + .16 * (h - blur(h, 12)) - .08 * (1 - clods), .57, .91)
    pack_ground('mud', alb, np.clip(h, 0, 1), rough, 13.0)


def grass_procedural():
    """Compressed meadow sward with overlapping leaves and sparse clover."""
    n = NG
    big = spectral(n, 2.0, 211, lo=1, hi=6)
    mid = spectral(n, 1.5, 212, lo=8, hi=55)
    fine = spectral(n, .8, 213, lo=60, hi=220)
    h = .40 + .08 * (mid - .5) + .025 * (fine - .5)
    alb = mix(lin('#29331c'), lin('#4c532e'), .35 + .45 * mid)
    alb *= (.87 + .21 * big + .06 * fine)[..., None]
    # A few worn-through patches expose dark humus; they are not large bright
    # clouds in the green, and retain the same fine structure as the sward.
    bare = smoothstep(.66, .82, spectral(n, 1.6, 215, lo=3))
    alb = mix(alb, lin('#3e3523') * (.8 + .3 * fine)[..., None], bare * .8)
    alb, h = sward_blades(alb, h, 216, 2100)
    # Trifoliate clover occurs in groups, not scattered unrelated round dots.
    rng = np.random.default_rng(217)
    clover_color = lin('#43572e')
    for _ in range(160):
        cx, cy = rng.random(2) * n
        size = rng.uniform(2, 4)
        angle = rng.random() * np.pi * 2
        for leaf in range(3):
            a = angle + leaf * np.pi * 2 / 3
            idx, xx, yy = patch_coords(n, cx + np.cos(a) * size, cy + np.sin(a) * size, size + 1)
            u = (xx * np.cos(a) + yy * np.sin(a)) / size
            v = (-xx * np.sin(a) + yy * np.cos(a)) / (size * .8)
            d = np.sqrt(u * u + v * v)
            m = 1 - smoothstep(.65, 1, d)
            crown = np.clip(1 - d, 0, 1)
            alb[idx] = mix(alb[idx], clover_color * (.85 + .3 * crown)[..., None], m * .9)
            h[idx] = h[idx] * (1 - m) + (.54 + .035 * crown) * m
    rough = np.clip(.86 + .07 * (mid - .5) - .06 * (h - .45), .79, .93)
    pack_ground('grass', alb, h, rough, 5.5)


def forest_procedural():
    """Decaying beech/oak/ash litter over humus, twigs, moss and fine roots."""
    n = NG
    big = spectral(n, 2.1, 221, lo=1, hi=8)
    mid = spectral(n, 1.5, 222, lo=8, hi=65)
    fine = spectral(n, .7, 223, lo=80, hi=280)
    h = .36 + .12 * (mid - .5) + .035 * (fine - .5)
    alb = mix(lin('#282217'), lin('#504129'), .30 + .45 * mid)
    alb *= (.88 + .19 * big + .08 * fine)[..., None]
    alb, h, leaf = fallen_leaves(alb, h, 224, 2500)
    twigs = np.clip(scratch_lines(n, 110, 230, (12, 70), 0), 0, 1)
    twigs = np.maximum(twigs, blur(twigs, 1) * .6)
    alb = mix(alb, lin('#51412a'), twigs * .8)
    h += twigs * .055
    moss = smoothstep(.60, .82, spectral(n, 1.7, 228, lo=4, hi=30))
    moss *= (.50 + .50 * fine) * (1 - leaf * .55)
    alb = mix(alb, lin('#414b27') * (.8 + .4 * fine)[..., None], moss * .75)
    h += moss * .035
    rough = np.clip(.89 - .12 * leaf + .08 * (mid - .5) - .04 * moss, .68, .94)
    pack_ground('forest', alb, np.clip(h, 0, 1), rough, 6.0)


def diffuse_source(name, repeats, target):
    """Normalize a retained, generated diffuse source into a periodic tile.

    The original diffuse image is not a measured material scan. The derived
    relief below is deliberately shallow. Repetition sets physical feature
    size: the meadow source covers ~2.15 m, the litter source ~1.15 m.
    """
    source = os.path.join(SOURCES, name + '-source.webp')
    with Image.open(source) as im:
        im = im.convert('RGB')
        # Give Lanczos the real wrapped neighbourhood rather than clamped
        # pixels at each edge. Only the middle resampled tile is retained.
        border = Image.new('RGB', (im.width * 3, im.height * 3))
        for y in range(3):
            for x in range(3):
                border.paste(im, (x * im.width, y * im.height))
        side = NG // repeats
        scaled = border.resize((side * 3, side * 3), Image.Resampling.LANCZOS)
        tile = np.asarray(scaled.crop((side, side, side * 2, side * 2)), dtype=np.float32) / 255
    srgb = np.tile(tile, (repeats, repeats, 1))
    linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)
    # Retain organic pigment variation while matching the established palette
    # in linear light. This is colour calibration, not baked relighting.
    linear = np.maximum(linear, 1e-5) ** .78
    linear *= np.asarray(target) / linear.mean(axis=(0, 1))
    luma = linear @ np.array([.2126, .7152, .0722])
    low, high = np.percentile(luma, [2, 98])
    value = np.clip((luma - low) / max(high - low, 1e-6), 0, 1)
    return linear, value


def grass():
    if not USE_GENERATED:
        return grass_procedural()
    alb, value = diffuse_source('grass', 2, lin('#404b26'))
    mat = blur(value, 1)
    h = .44 + .10 * (mat - .5) + .045 * (mat - blur(value, 5))
    rough = np.clip(.87 + .025 * (blur(value, 12) - .5) - .035 * (value - .5), .82, .92)
    pack_ground('grass', alb, h, rough, 5.5)


def forest():
    if not USE_GENERATED:
        return forest_procedural()
    alb, value = diffuse_source('forest', 4, lin('#503d27'))
    mat = blur(value, 1)
    broad = spectral(NG, 2.1, 221, lo=1, hi=8)
    h = .40 + .22 * (mat - .5) + .10 * (mat - blur(value, 5)) + .08 * (broad - .5)
    rough = np.clip(.88 - .10 * value + .03 * (broad - .5), .74, .94)
    pack_ground('forest', alb, h, rough, 6.0)


def cobble():
    """Granite setts in 2.5 m tiles, worn flat on top by wheels and boots
    with a narrow rounded edge down into the joint, each settled a little
    askew in its bed; mud and grit in the joints, a few sunk or missing."""
    n = NG
    rows, cols = 24, 17
    wx = (spectral(n, 2.0, 237, lo=6) - 0.5) * 22
    wy = (spectral(n, 2.0, 238, lo=6) - 0.5) * 14
    u, v, ident, edge, ex, ey = rect_layout(n, rows, cols, 231, jitter=0.6, warp=(wx, wy))
    rnd = per_cell(ident, 232)
    rnd2 = per_cell(ident, 235)
    # worn flat: a narrow rounded edge (~1.7 cm), then a top with only a slight crown
    w = spectral(n, 1.6, 236, lo=20)
    e2 = edge + (w - 0.5) * 3.0
    dome = smoothstep(0.0, 7.0, e2) ** 0.6
    crown = smoothstep(0.0, 20.0, e2)
    # settled askew: each stone tilted its own way, so the wet street's reflections break up stone by stone
    tilt = ((u - 0.5) * (per_cell(ident, 240) - 0.5) + (v - 0.5) * (per_cell(ident, 241) - 0.5)) * 0.5
    dome = dome * (0.8 + 0.1 * crown + tilt + 0.1 * rnd2)
    sunk = (rnd2 < 0.04)
    dome = np.where(sunk, dome * 0.45, dome)
    fine = spectral(n, 1.1, 233, lo=40)
    big = spectral(n, 2.2, 234, lo=1)
    h = 0.88 * dome + 0.07 * fine * smoothstep(0.0, 4.0, e2) + 0.05 * rnd
    stone_a, stone_b, stone_c, joint = lin('#55524c'), lin('#7c776d'), lin('#6a5f54'), lin('#393126')
    alb = mix(stone_a, stone_b, np.clip(rnd * 0.9 + 0.3 * (fine - 0.5), 0, 1))
    alb = mix(alb, stone_c, (rnd2 > 0.7) * 0.6)
    alb = alb * (0.82 + 0.36 * big)[..., None] * (0.9 + 0.2 * dome)[..., None]
    alb = mix(alb, joint, 1 - smoothstep(1.5, 7.0, e2))
    grit = smoothstep(0.6, 0.8, spectral(n, 1.6, 239, lo=5)) * (1 - dome)
    alb = mix(alb, lin('#3a2e22'), grit * 0.7)
    # Granite minerals interrupt a flat palette without painting sunlight in.
    mineral = spectral(n, 0.6, 242, lo=90, hi=350)
    quartz = smoothstep(0.69, 0.85, mineral) * dome
    mica = (1 - smoothstep(0.16, 0.28, mineral)) * dome
    alb = mix(alb, lin('#aaa18b'), quartz * 0.28)
    alb *= (1 - mica * 0.18)[..., None]
    # Rain is applied at runtime; the dry worn crowns keep a broad sheen.
    rough = np.clip(0.52 + 0.32 * (1 - smoothstep(0.0, 0.8, dome)) + (fine - 0.5) * 0.035, 0, 1)
    pack_ground('cobble', alb, h, rough, 7.0)


def landscape():
    """Independent broad fields: moisture, growth, organic drift, secondary.

    Material height should describe relief, not control where rainwater or
    vegetation occurs. Match the old broad fields' marginal distributions,
    retaining their calibration independently of any current surface assets.
    """
    with open(os.path.join(SOURCES, 'landscape-calibration.json')) as f:
        calibration = json.load(f)
    n = 256
    fields = []
    for channel in ('R', 'G', 'B', 'A'):
        spec = calibration['channels'][channel]
        spectrum = spec['spectrum']
        # Independent random seeds and a bounded correlation guard keep the
        # four unrelated systems from tracing the same patches in the world.
        for trial in range(64):
            noise = spectral(n, spectrum['beta'], spec['seed'] + trial * 101,
                             lo=spectrum['lo'], hi=spectrum['hi'])
            order = np.argsort(noise, axis=None)
            rank = np.empty(n * n, dtype=np.float32)
            rank[order] = np.linspace(0, 1, n * n)
            mapped = np.interp(rank, calibration['quantileProbabilities'], spec['targetQuantiles']).reshape(n, n)
            if all(abs(np.corrcoef(mapped.ravel(), other.ravel())[0, 1]) < .10 for other in fields):
                break
        else:
            raise RuntimeError('could not decorrelate landscape fields')
        fields.append(mapped)
    # Six-bit scalar precision is ample for these softly sampled broad
    # fields. Unlike lossy YUV compression it never mixes their channels.
    data = np.stack(fields, axis=-1)
    rgba = np.clip(np.rint(data * 255 / 4) * 4, 0, 255).astype(np.uint8)
    save('landscape', rgba, lossless=True)


ALL = dict(stone=stone, plaster=plaster, brick=brick, tile=tile, slate=slate, planks=planks,
           bark=bark, fabric=fabric, concrete=concrete, metal=metal, rock=rock, foliage=foliage,
           mud=mud, grass=grass, forest=forest, cobble=cobble, landscape=landscape)

if __name__ == '__main__':
    args = sys.argv[1:]
    if '--procedural' in args:
        USE_GENERATED = False
        args.remove('--procedural')
    names = args or list(ALL)
    for n in names:
        ALL[n]()
