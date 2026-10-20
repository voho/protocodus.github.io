"""Hedgerow — tileable detail textures.

    python3 fun/hedgerow/tools/textures.py            # all
    python3 fun/hedgerow/tools/textures.py stone mud  # some

Writes `assets/textures/<name>.webp` (512², tileable, lossy WebP).

Two kinds:

* detail textures for models (stone, plaster, brick, tile, slate, planks,
  bark, fabric, concrete, metal, rock, foliage): RGB = tangent-space normal,
  A = albedo detail (0.5 = the palette colour, darker below, lighter above).
  The game tints them with each material's palette colour.
* ground textures for the terrain (mud, grass, forest, cobble): RGB = albedo
  (sRGB), A = height; their normals come from `<name>_n.webp` (RGB normal,
  A = roughness).

Everything is built from periodic pieces (spectral noise from filtered white
noise, cell noise with wrap-around distances, np.roll), so every texture
tiles. Deterministic: fixed seeds.
"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'textures')
N = 512


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
    rgb = (np.clip(albedo_rgb, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    a = (np.clip(height, 0, 1) * 255).astype(np.uint8)
    save(name, np.dstack([rgb, a]))
    nrm = normal_from_height(height, strength)
    nrgb = ((nrm * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    save(name + '_n', np.dstack([nrgb, (np.clip(rough, 0, 1) * 255).astype(np.uint8)]))


def save(name, img):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.webp')
    Image.fromarray(img, 'RGBA').save(path, 'WEBP', quality=80 if img.shape[0] > 512 else 88, method=6, exact=True)
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
    """Churned wet mud: boot and wheel ruts, pebbles, straw, water in the hollows."""
    n = NG
    big = spectral(n, 2.3, 201, lo=1)
    mid = spectral(n, 1.7, 202, lo=6)
    fine = spectral(n, 1.0, 203, lo=60)
    ruts = spectral(n, 1.8, 206, lo=2, aniso=(1.0, 6.0))       # long hollows along v
    ruts = 1 - smoothstep(0.35, 0.75, ruts)
    f1, f2, ident = cells(n, 260, 204)
    psz = 4.0 + 9.0 * per_cell(ident, 210)
    pebble = smoothstep(psz, psz * 0.35, f1) * (per_cell(ident, 205) > 0.55)
    pebble *= smoothstep(0.3, 0.6, spectral(n, 1.4, 211, lo=4))          # half buried
    c1, c2, cid = cells(n, 90, 212)
    clods = smoothstep(0.0, 25.0, c2 - c1) * per_cell(cid, 213)
    straw = np.clip(scratch_lines(n, 200, 207, (12, 40), 0), 0, 1) * (spectral(n, 1.5, 208, lo=3) > 0.6)
    h = 0.35 * big + 0.25 * mid + 0.08 * fine - 0.25 * ruts + 0.22 * pebble + 0.2 * clods
    h = (h - h.min()) / (h.max() - h.min())
    dark, light, stone_c, straw_c = lin('#2a2119'), lin('#5e4c3a'), lin('#5a544a'), lin('#7a6640')
    alb = mix(dark, light, np.clip(0.25 + 0.6 * mid + 0.25 * (fine - 0.5) + 0.2 * (h - 0.5), 0, 1))
    alb = mix(alb, stone_c * (0.6 + 0.7 * per_cell(ident, 209))[..., None], pebble * 0.85)
    alb = alb * (0.9 + 0.2 * clods)[..., None]
    alb = mix(alb, straw_c, straw * 0.5)
    rough = np.clip(0.5 + 0.4 * h - 0.25 * ruts, 0.05, 1)
    pack_ground('mud', alb, h, rough, 7.0)


def grass():
    """Wet meadow: tufts of blades lying in different directions, clover, dead
    stalks, soil between."""
    n = NG
    big = spectral(n, 2.0, 211, lo=1)
    mid = spectral(n, 1.4, 212, lo=8)
    dirx = spectral(n, 2.2, 216, lo=1)        # blade direction field
    b1 = spectral(n, 0.6, 213, lo=120, aniso=(1.0, 0.25))
    b2 = spectral(n, 0.6, 214, lo=120, aniso=(0.25, 1.0))
    bl = np.where(dirx > 0.5, b1, b2) * 0.75 + np.maximum(b1, b2) * 0.25
    clover_cov, clover_v = stamp_ellipses(n, 1600, 217, size=(3, 6), aspect=(0.7, 1.0))
    clover = clover_cov * (spectral(n, 1.8, 218, lo=3) > 0.6)
    dead = smoothstep(0.55, 0.9, spectral(n, 1.5, 215, lo=4)) * 0.7
    stalks = np.clip(scratch_lines(n, 500, 219, (8, 30), 0), 0, 1)
    h = 0.25 * mid + 0.6 * bl + 0.1 * big + 0.2 * clover
    g_dark, g_light, g_dead, soil, clov = lin('#18230f'), lin('#4f5e2c'), lin('#7a6a42'), lin('#2f251b'), lin('#3c5226')
    alb = mix(g_dark, g_light, np.clip(bl * 1.0 + 0.25 * (mid - 0.5), 0, 1))
    alb = mix(alb, g_dead, np.clip(dead * 0.7 + stalks * 0.5, 0, 1))
    alb = mix(alb, clov, clover * 0.8)
    alb = mix(alb, soil, smoothstep(0.32, 0.12, bl) * 0.55)
    rough = 0.7 + 0.25 * mid
    pack_ground('grass', alb, h, rough, 6.0)


def forest():
    """Forest floor: fallen needles, beech and oak leaves, twigs, cones, moss."""
    n = NG
    big = spectral(n, 2.1, 221, lo=1)
    mid = spectral(n, 1.4, 222, lo=6)
    needles = np.maximum(spectral(n, 0.6, 226, lo=160, aniso=(1.0, 0.2)), spectral(n, 0.6, 227, lo=160, aniso=(0.2, 1.0)))
    leaf_cov, leaf_v = stamp_ellipses(n, 2000, 224, size=(6, 18), aspect=(0.35, 0.7))
    leaf_mask = leaf_cov * (spectral(n, 1.6, 229, lo=3) > 0.42)
    twigs = np.clip(scratch_lines(n, 160, 230, (20, 90), 1), 0, 1)
    moss = smoothstep(0.58, 0.85, spectral(n, 1.6, 228, lo=4))
    h = 0.45 * needles + 0.25 * mid + 0.3 * leaf_mask + 0.25 * twigs
    soil, needle_c, moss_c, twig_c = lin('#20170f'), lin('#5d4128'), lin('#3c4c22'), lin('#3e2e20')
    leaf_cols = np.stack([lin('#5a4630'), lin('#3e2e20'), lin('#6a5236'), lin('#30261c')])
    lc = leaf_cols[(leaf_v * 3.999).astype(int)]
    alb = mix(soil, needle_c, np.clip(needles * 1.15, 0, 1))
    alb = mix(alb, lc, np.clip(leaf_mask * 1.2, 0, 1) * 0.75)
    alb = mix(alb, twig_c, twigs * 0.8)
    alb = mix(alb, moss_c, moss * 0.75)
    alb = alb * (0.85 + 0.3 * big)[..., None]
    rough = 0.65 + 0.3 * mid
    pack_ground('forest', alb, h, rough, 6.0)


def cobble():
    """Granite setts laid in courses, worn smooth on top, mud and grit in the
    joints, a few sunk or missing."""
    n = NG
    rows, cols = 24, 17
    wx = (spectral(n, 2.0, 237, lo=6) - 0.5) * 22
    wy = (spectral(n, 2.0, 238, lo=6) - 0.5) * 14
    u, v, ident, edge, ex, ey = rect_layout(n, rows, cols, 231, jitter=0.6, warp=(wx, wy))
    rnd = per_cell(ident, 232)
    rnd2 = per_cell(ident, 235)
    # rounded, slightly irregular tops
    w = spectral(n, 1.6, 236, lo=20)
    e2 = edge + (w - 0.5) * 3.0
    dome = smoothstep(0.0, 16.0, e2) ** 0.8
    dome = dome * (0.85 + 0.3 * rnd2)
    sunk = (rnd2 < 0.04)
    dome = np.where(sunk, dome * 0.3, dome)
    fine = spectral(n, 1.1, 233, lo=40)
    big = spectral(n, 2.2, 234, lo=1)
    h = 0.85 * dome + 0.1 * fine + 0.05 * rnd
    stone_a, stone_b, stone_c, joint = lin('#55524c'), lin('#7c776d'), lin('#6a5f54'), lin('#2a221a')
    alb = mix(stone_a, stone_b, np.clip(rnd * 0.9 + 0.3 * (fine - 0.5), 0, 1))
    alb = mix(alb, stone_c, (rnd2 > 0.7) * 0.6)
    alb = alb * (0.82 + 0.36 * big)[..., None] * (0.9 + 0.2 * dome)[..., None]
    alb = mix(alb, joint, 1 - smoothstep(1.5, 7.0, e2))
    grit = smoothstep(0.6, 0.8, spectral(n, 1.6, 239, lo=5)) * (1 - dome)
    alb = mix(alb, lin('#3a2e22'), grit * 0.7)
    rough = np.clip(0.4 + 0.45 * (1 - dome), 0, 1)
    pack_ground('cobble', alb, h, rough, 7.0)


ALL = dict(stone=stone, plaster=plaster, brick=brick, tile=tile, slate=slate, planks=planks,
           bark=bark, fabric=fabric, concrete=concrete, metal=metal, rock=rock, foliage=foliage,
           mud=mud, grass=grass, forest=forest, cobble=cobble)

if __name__ == '__main__':
    names = sys.argv[1:] or list(ALL)
    for n in names:
        ALL[n]()
