"""The mountains round the run — the backdrop the sky is drawn behind.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/backdrop.py -- --out fun/alpen/assets

Run from the repository root; writes `models/backdrop/alps.glb` and the two
maps in `textures/backdrop/` (add `--maps-only` to rebake just the maps).
Nothing is rendered, so it builds anywhere — about a minute and a half. The
terrain itself is plain numpy and needs no Blender, so the view from the
rider's eye can be drawn on its own while the range is being shaped:

    python3 fun/alpen/tools/blender/backdrop.py --preview view.png

A real-sized range, then made small. The landscape is modelled at its own
scale — the rider's eye at 2100 m on a shoulder above the main valley, which
lies eight kilometres ahead; a horn of 4350 m at fifteen, a row of granite
needles, a glaciated dome at twenty-three, a north face off to the right;
ranges out to forty-eight — and every vertex is then slid along its own line
of sight from the eye until it stands between 1650 and 2800 m away, inside
the game's far plane and just behind its own ground. Moving a point along the
ray through the eye cannot change where the eye sees it, so the picture is
the real one; only the parallax is scaled, and the shader puts that back.

The mesh carries the shape the eye sees — the skyline and the big forms,
decimated by Blender where an error of a metre is an error of about a pixel
— and, per vertex, eight horizons: how high the land stands round it looking
down the run, then every 45° clockwise. The sun is behind the land whenever
its elevation is under the horizon on its bearing, so the range shades
itself at any hour from a table baked once.

The detail is in the maps, on the frame the range was sampled on (u the
bearing, v the log of the distance), where a texel is one patch of real
ground and nothing can be hidden behind anything else: the ground's normal
and cavity, and its snow, forest and ice. See MODELS.md.
"""

import json
import math
import os
import struct
import sys

import numpy as np

TAU = math.tau

# --------------------------------------------------------------------------
# The frame. Bearings are measured from straight down the run (the game's
# -z) towards +x; the eye is at the origin.

EYE = 2100.0                 # metres above the sea
D0, D1 = 2400.0, 48000.0     # the range begins where the game's ground ends
R0, R1 = 1650.0, 2800.0      # and is drawn between these radii
HORIZONS = 8                 # bearings the horizon is baked on


def at(bearing_deg, distance):
    b = math.radians(bearing_deg)
    return distance * math.sin(b), -distance * math.cos(b)


def drawn_radius(d):
    """Where a point `d` metres away is drawn — logarithmic, so every
    doubling of distance gets the same depth, which is how the eye spends
    it."""
    return R0 + (R1 - R0) * np.log(d / D0) / math.log(D1 / D0)


# --------------------------------------------------------------------------
# Noise, vectorised, with derivatives (gradient noise with a quintic fade).

def _hash(ix, iz, seed):
    h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return h ^ (h >> 16)


def noised(x, z, seed):
    """Gradient noise and its two derivatives, roughly in -1..1."""
    xi = np.floor(x)
    zi = np.floor(z)
    fx = x - xi
    fz = z - zi
    ix = xi.astype(np.int64)
    iz = zi.astype(np.int64)

    def grad(dx, dz):
        a = _hash(ix + dx, iz + dz, seed).astype(np.float64) * (TAU / 4294967296.0)
        return np.cos(a), np.sin(a)

    gx00, gz00 = grad(0, 0)
    gx10, gz10 = grad(1, 0)
    gx01, gz01 = grad(0, 1)
    gx11, gz11 = grad(1, 1)
    a = gx00 * fx + gz00 * fz
    b = gx10 * (fx - 1) + gz10 * fz
    c = gx01 * fx + gz01 * (fz - 1)
    d = gx11 * (fx - 1) + gz11 * (fz - 1)
    u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
    du = 30 * fx * fx * (fx * (fx - 2) + 1)
    dv = 30 * fz * fz * (fz * (fz - 2) + 1)
    k = a - b - c + d
    n = a + u * (b - a) + v * (c - a) + u * v * k
    nx = (gx00 + u * (gx10 - gx00) + v * (gx01 - gx00)
          + u * v * (gx00 - gx10 - gx01 + gx11) + du * ((b - a) + v * k))
    nz = (gz00 + u * (gz10 - gz00) + v * (gz01 - gz00)
          + u * v * (gz00 - gz10 - gz01 + gz11) + dv * ((c - a) + u * k))
    return n * 1.41, nx * 1.41, nz * 1.41


# Each octave turned against the last, so no lattice axis survives the sum.
ROT = np.array([[0.8, -0.6], [0.6, 0.8]])


def fbm(x, z, octaves, seed, gain=0.5):
    total = np.zeros_like(x)
    amp = 1.0
    norm = 0.0
    px, pz = x, z
    for i in range(octaves):
        n, _, _ = noised(px, pz, seed + i)
        total += n * amp
        norm += amp
        amp *= gain
        px, pz = (ROT[0, 0] * px + ROT[0, 1] * pz) * 2.03, (ROT[1, 0] * px + ROT[1, 1] * pz) * 2.03
    return total / norm


def eroded(x, z, octaves, seed, gain=0.5):
    """Inigo Quilez's trick: each octave is damped by how steep the sum
    already is, so detail gathers on the crests and drains out of the
    gullies, which is most of what erosion looks like from a distance."""
    total = np.zeros_like(x)
    dx = np.zeros_like(x)
    dz = np.zeros_like(x)
    amp = 1.0
    norm = 0.0
    px, pz = x, z
    for i in range(octaves):
        n, nx, nz = noised(px, pz, seed + i)
        dx += nx
        dz += nz
        total += amp * n / (1.0 + 0.6 * (dx * dx + dz * dz))
        norm += amp
        amp *= gain
        px, pz = (ROT[0, 0] * px + ROT[0, 1] * pz) * 2.03, (ROT[1, 0] * px + ROT[1, 1] * pz) * 2.03
    return total / norm


def ridged(x, z, octaves, seed, sharp=2.0, gain=0.5, lacunarity=2.03):
    """Musgrave's ridged multifractal: one minus the folded noise, squared,
    each octave weighted by the last, so the knife edges stand on the
    crests of the coarser ridges and not in the valleys between them.
    Roughly 0..1."""
    total = np.zeros_like(x)
    weight = np.ones_like(x)
    amp = 1.0
    norm = 0.0
    px, pz = x, z
    for i in range(octaves):
        n, _, _ = noised(px, pz, seed + i)
        s = np.clip(1.0 - np.abs(n), 0.0, 1.0) ** sharp
        s *= weight
        weight = np.clip(s * 1.6, 0.0, 1.0)
        total += s * amp
        norm += amp
        amp *= gain
        px, pz = (ROT[0, 0] * px + ROT[0, 1] * pz) * lacunarity, (ROT[1, 0] * px + ROT[1, 1] * pz) * lacunarity
    return total / norm


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def smoothstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# The landscape.
#
# Three layers. The MASS is the range itself everywhere: a ridged
# multifractal over a slow swell, so there are massifs and cols at the
# twenty-kilometre scale and arêtes on top of them. The VALLEYS are cut
# into it — glacial troughs, flat-floored and steep-walled, each a polyline
# with its floor's altitude at every node — and they are what make it a
# place: the valley the run falls into, the main valley across it eight
# kilometres ahead, and the side valleys that lead the eye into the range
# beyond. The LANDMARKS are added last, because a range everybody can name
# has two or three shapes in it no noise will ever draw: a horn, a broad
# glaciated dome, a north face.

def _xz(bearing, distance, floor):
    x, z = at(bearing, distance)
    return (x, z, floor)


# (nodes [(x, z, floor altitude)], floor half-width, wall steepness)
VALLEYS = [
    # the main valley, across the view eight to ten kilometres ahead
    ([(-46000, -4000, 760), (-24000, -9500, 830), (-9000, -10200, 930), (-300, -9400, 1000),
      (8000, -9000, 1020), (19000, -11000, 1060), (46000, -8500, 1180)], 380, 0.85),
    # side valleys leading into the range across it
    ([(-9000, -10200, 930), (-10500, -15500, 1450), (-12500, -24000, 2050)], 320, 0.8),
    ([(8000, -9000, 1020), (5600, -14000, 1520), (3800, -18500, 2150)], 260, 0.9),
    ([(19000, -11000, 1060), (23500, -17500, 1500), (28000, -26000, 2000)], 380, 0.75),
    ([(-24000, -9500, 830), (-27000, -17000, 1300), (-31000, -27000, 1800)], 420, 0.7),
    # the valleys either side of the run's own shoulder
    ([(-6600, 7000, 1900), (-6200, 0, 1450), (-7400, -6000, 1120), (-9000, -10200, 930)], 340, 0.8),
    ([(6000, 7500, 1950), (5800, 0, 1500), (6600, -5000, 1180), (8000, -9000, 1020)], 300, 0.85),
    # and the wide valleys out on either flank
    ([(-16000, 14000, 1300), (-15000, 0, 1080), (-17000, -6000, 900), (-24000, -9500, 830)], 520, 0.7),
    ([(15000, 15000, 1350), (14000, 2000, 1150), (16000, -6000, 1080), (19000, -11000, 1060)], 520, 0.7),
]


def home(x, z):
    """The shoulder the run is on: a broad flank falling ahead at the
    piste's own grade and easing out onto the main valley's floor, and
    rising behind to the peaks the run starts under. Returns the shoulder's
    surface and how far it holds (1 on the run's line, 0 a couple of
    kilometres either side of it)."""
    s = -z
    lateral = np.maximum(0.0, np.abs(x) - 900.0)
    ahead = np.where(s > 0, -1050.0 * (1 - np.exp(-s / 5200.0)), -0.26 * s)
    h = EYE - 40 + ahead - 520.0 * smoothstep(0, 2600, lateral)
    hold = (1 - smoothstep(1600, 3800, np.abs(x))) * (1 - smoothstep(7500, 10500, s))
    return h, hold


def foothills(x, z):
    """How far the range round the eye is pressed down towards the valleys:
    the near ground is the same range at under half its height, so the
    rider looks out over forested ridges to the high peaks rather than up
    at a wall a few kilometres off. Behind the eye nothing is lowered —
    that is the mountain the run comes down."""
    s = -z
    reach = np.sqrt((x / 6200.0) ** 2 + (np.maximum(s, 0) / 10500.0) ** 2
                    + (np.minimum(s, 0) / 1800.0) ** 2)
    return 1 - smoothstep(0.75, 1.3, reach)


def valley_floor(x, z):
    """The valleys as one surface: for every point the lowest of the
    troughs it is near, each a flat floor with walls rising off it."""
    best = np.full_like(x, 1e9)
    for nodes, half, steep in VALLEYS:
        dist = np.full_like(x, 1e18)
        floor = np.zeros_like(x)
        for (ax, az, af), (bx, bz, bf) in zip(nodes[:-1], nodes[1:]):
            ex, ez = bx - ax, bz - az
            ll = ex * ex + ez * ez
            t = np.clip(((x - ax) * ex + (z - az) * ez) / ll, 0.0, 1.0)
            qx = x - (ax + ex * t)
            qz = z - (az + ez * t)
            dd = qx * qx + qz * qz
            closer = dd < dist
            dist = np.where(closer, dd, dist)
            floor = np.where(closer, af + (bf - af) * t, floor)
        d = np.sqrt(dist)
        # A meander on the floor's edge, so no trough is drawn with a ruler.
        d = d + 90 * fbm(x / 2600, z / 2600, 2, 911)
        out = np.maximum(0.0, d - half)
        # U-shaped: steep off the floor, easing onto the shoulders above,
        # with fans and terraces on the floor itself
        wall = steep * out + 0.00022 * out * out
        best = np.minimum(best, floor + wall + 22 * (fbm(x / 900, z / 900, 3, 917) + 0.6))
    return best


def gullies(along, down, seed):
    """Couloirs and the buttresses between them: incisions running down a
    face, a couple of hundred metres apart, deepening as they descend."""
    n, _, _ = noised(along / 210.0, down / 900.0, seed)
    m, _, _ = noised(along / 90.0 + 7.1, down / 400.0, seed + 1)
    return (1 - np.abs(n)) ** 3 * 0.75 + (1 - np.abs(m)) ** 3 * 0.25


def pyramid(x, z, cx, cz, peak, turn, reach, faces=4, power=0.86, aretes=0.18, seed=600,
            lean=(0.0, 0.0)):
    """A horn: `faces` glacier-cut faces meeting at arêtes, concave the
    whole way down and scored with couloirs. `reach` is how far out the
    faces run before they are lost in the mass; `lean` is how far (x, z)
    its summit has moved off its base, which is what gives a famous horn
    its hook."""
    dx = x - cx
    dz = z - cz
    if lean[0] or lean[1]:
        w = np.exp(-np.sqrt(dx * dx + dz * dz) / (reach * 0.3))
        dx = dx - lean[0] * w
        dz = dz - lean[1] * w
    r = np.sqrt(dx * dx + dz * dz) + 1e-6
    out = np.full_like(x, -1e4)
    near = r < reach * 1.8
    if not near.any():
        return out
    r = r[near]
    a = np.arctan2(dz[near], dx[near]) + turn
    # distance to the face: the polygon's own norm, with the arêtes left
    # standing proud of it where two faces meet
    sector = TAU / faces
    which = np.floor(np.mod(a, TAU) / sector)
    local = np.mod(a, sector) - sector / 2
    face = r * np.cos(local) / math.cos(sector / 2)
    arete = 1 - np.abs(local) / (sector / 2)
    norm = face * (1 - aretes * arete ** 6)
    # each face its own steepness, so no two arêtes fall alike
    steep = 1 + 0.22 * np.sin(which * 2.39 + seed)
    drop = (reach ** (1 - power)) * norm ** power * steep
    # and the shoulders on the arêtes: a step where the ridge eases and
    # steepens again, a third and two thirds of the way down
    step = sum(smoothstep(f * reach - 140, f * reach + 140, norm) for f in (0.3, 0.62))
    drop -= 120 * step * arete ** 2
    cut = gullies(a * r, r, seed) * np.minimum(r, 1400.0) * 0.16 * (1 - arete ** 8)
    # a broken skyline: towers and notches along every arête and face
    rough = fbm(a * r / 380.0, r / 300.0, 4, seed + 3) * np.minimum(r, 900.0) * 0.16
    out[near] = peak - drop - cut + rough
    return out


def dome(x, z, cx, cz, peak, flat, fall, seed=660):
    """A broad ice dome on a rock plinth, its outline pushed out along the
    spurs that run off it and pulled in between them."""
    dx = x - cx
    dz = z - cz
    r = np.sqrt(dx * dx + dz * dz)
    a = np.arctan2(dz, dx)
    spur = fbm(np.cos(a) * 1.6 + 3.1, np.sin(a) * 1.6, 3, seed)
    r = r * (1 - 0.32 * spur)
    return peak - np.where(r < flat, (r / flat) ** 2 * 160.0,
                           160.0 + (r - flat) * fall)


def wall(x, z, ax, az, bx, bz, crest, face, back, toward, seed=700):
    """A long ridge with one side a cliff: `face` is its slope on the side
    nearest `toward`, `back` on the other. The cliff is ribbed with
    buttresses and crossed by the ledges that hold snow."""
    ex, ez = bx - ax, bz - az
    ll = ex * ex + ez * ez
    t = np.clip(((x - ax) * ex + (z - az) * ez) / ll, 0.0, 1.0)
    qx = x - (ax + ex * t)
    qz = z - (az + ez * t)
    d = np.sqrt(qx * qx + qz * qz)
    # which side of the crest line the point is on
    nx, nz = -ez, ex
    side = np.sign(qx * nx + qz * nz)
    tside = math.copysign(1.0, (toward[0] - ax) * nx + (toward[1] - az) * nz)
    on_face = side == tside
    slope = np.where(on_face, face, back)
    along = t * math.sqrt(ll)
    ends = np.minimum(t, 1 - t) * math.sqrt(ll)
    sag = 260.0 * (1 - smoothstep(0, 1800, ends)) + 120 * (fbm(along / 700, d / 3000, 2, seed) + 0.5)
    ribs = gullies(along, d * 2.0, seed + 5) * np.minimum(d, 900.0) * 0.30
    ledges = np.where(on_face, 40 * np.sin(d / 95.0 + 3 * fbm(along / 400, d / 400, 2, seed + 9)), 0)
    return crest - sag - d * slope - ribs + ledges


HORN = _xz(-17.0, 15000, 4350)
MASSIF = _xz(23.0, 23500, 4470)


def landmarks(x, z):
    out = np.full_like(x, -1e4)
    hx, hz, hp = HORN
    out = np.maximum(out, pyramid(x, z, hx, hz, hp, 0.42, 2600, seed=610, lean=(-320.0, 160.0)))
    # its shoulder, a lower horn on the ridge running off its west arête
    sx, sz, _ = _xz(-23.5, 15800, 0)
    out = smax(out, pyramid(x, z, sx, sz, 3720, 0.1, 2000, faces=3, seed=620), 120)
    mx, mz, mp = MASSIF
    dm = dome(x, z, mx, mz, mp, 1500, 0.42)
    dm -= 90 * (ridged(x / 1100, z / 1100, 4, 631, sharp=1.4) - 0.4) * smoothstep(1200, 3500,
        np.hypot(x - mx, z - mz))
    out = smax(out, dm, 200)
    for k, (b, d, p, turn) in enumerate([(17.5, 21500, 4120, 0.3), (28.5, 22800, 4210, 1.1),
                                         (31, 26500, 4050, 0.7)]):
        px, pz, _ = _xz(b, d, 0)
        out = smax(out, pyramid(x, z, px, pz, p, turn, 2200, faces=3, power=0.8, seed=640 + 10 * k), 160)
    # the aiguilles between them: a row of granite needles
    for i, (b, d, p) in enumerate([(1.0, 19000, 3820), (3.2, 19400, 3900), (5.0, 18900, 3760),
                                    (6.6, 19600, 3870), (8.6, 19200, 3700)]):
        px, pz, _ = _xz(b, d, 0)
        out = smax(out, pyramid(x, z, px, pz, p, i * 0.7, 900, faces=3, power=0.78, seed=680 + 10 * i), 80)
    # a north face on the right, looking straight across at the run
    ax, az = at(64, 7600)
    bx, bz = at(81, 8400)
    out = smax(out, wall(x, z, ax, az, bx, bz, 3920, 1.9, 0.62, (0, 0)), 150)
    # the head of the run's valley, behind the eye
    for b, d, p, turn, reach in [(158, 7200, 3480, 0.2, 2400), (196, 6400, 3390, 0.9, 2300),
                                 (226, 8800, 3560, 0.5, 2600)]:
        px, pz, _ = _xz(b, d, 0)
        out = smax(out, pyramid(x, z, px, pz, p, turn, reach, faces=4, seed=750 + int(b)), 150)
    return out


def mass(x, z):
    """The range everywhere: a slow swell for massifs and cols, a ridged
    multifractal for the crests (warped, so no ridge runs ruler-straight),
    an eroded sum for the gullies on them."""
    swell = smoothstep(0.33, 0.70, 0.5 + 0.5 * fbm(x / 26000, z / 26000, 3, 101))
    wx = x + 1800 * fbm(x / 9000, z / 9000, 2, 151)
    wz = z + 1800 * fbm(x / 9000, z / 9000, 2, 163)
    crests = np.clip((ridged(wx / 6800, wz / 6800, 8, 211, sharp=2.0, gain=0.52) - 0.1) / 0.75, 0, 1)
    gully = eroded(x / 2200, z / 2200, 6, 307)
    return 1650 + (700 + 2400 * swell ** 1.5) * crests ** 1.35 + 300 * gully


def altitude(x, z):
    """Metres above the sea at world (x, z)."""
    floor = valley_floor(x, z)
    h = smin(mass(x, z), floor, 220.0)
    h = smax(h, smin(landmarks(x, z), floor + 40, 160.0), 180.0)
    low = foothills(x, z)
    h = np.where(h > 1150, 1150 + (h - 1150) * (1 - 0.58 * low), h)
    cap, hold = home(x, z)
    h = h + (smin(h, cap, 220.0) - h) * hold
    floor = np.minimum(floor, h)
    # fine relief, more of it the higher the ground stands over its valley
    relief = np.clip((h - floor) / 1600.0, 0.0, 1.0)
    h += relief * (300 * (ridged(x / 1500, z / 1500, 5, 401, sharp=1.6) - 0.45)
                   + 70 * fbm(x / 420, z / 420, 3, 431))
    return h


def curvature_drop(d):
    # the Earth's, with the usual refraction (7/6 of its radius)
    return d * d / (2 * 6.371e6 * 7 / 6)


# --------------------------------------------------------------------------
# The cover: what each piece of ground is wearing in January.

def cover(h, ny, x, z):
    """(snow, forest, ice, rock) for ground at altitude `h` whose normal
    has vertical component `ny`. Snow holds on the gentle ground and on
    ledges; faces steeper than about forty degrees show their rock; the
    forest climbs to a treeline near 1950 m on anything it can stand on and
    lies in patches across the valley floors between the fields; glaciers
    fill the gentle ground of the high cirques."""
    steep = np.sqrt(np.clip(1 - ny * ny, 0, 1))      # sine of the slope
    wob = fbm(x / 900, z / 900, 3, 503)
    rock = smoothstep(0.70 + 0.06 * wob, 0.84 + 0.05 * wob, steep)
    # rock ribs and bands show through the snow on the steeper faces, more
    # of them the higher the ground
    bands = smoothstep(0.30, 0.70, fbm(x / 240, z / 240, 3, 513) + 0.25 * wob)
    rock = np.maximum(rock, bands * smoothstep(2400, 3300, h) * smoothstep(0.45, 0.70, steep) * 0.85)
    # and the snow that a rock face holds anyway, on its ledges and in its
    # couloirs, so a north face is dark rock laced with white, not a slab
    ledges = smoothstep(0.05, 0.45, fbm(x / 110, z / 110, 3, 519) + 0.2 * fbm(x / 40, z / 40, 2, 523))
    rock = rock * (1 - 0.6 * ledges * (1 - smoothstep(0.86, 0.95, steep)))
    treeline = 1950 + 160 * fbm(x / 1700, z / 1700, 3, 509)
    patches = smoothstep(-0.25, 0.25, fbm(x / 520, z / 520, 3, 521) + 0.45)
    fields = smoothstep(-0.2, 0.2, fbm(x / 650, z / 650, 3, 527))
    flat = 1 - smoothstep(0.08, 0.20, steep)
    forest = (smoothstep(treeline + 40, treeline - 160, h)
              * (1 - smoothstep(0.72, 0.82, steep)) * patches * (1 - flat * (1 - fields) * 0.85))
    ice = (smoothstep(2850, 3150, h) * (1 - smoothstep(0.30, 0.48, steep))
           * smoothstep(-0.1, 0.3, fbm(x / 1400, z / 1400, 3, 517)))
    forest = forest * (1 - rock)
    ice = ice * (1 - rock)
    snow = np.clip(1 - rock - forest - ice, 0, 1)
    return snow, forest, ice, rock


# --------------------------------------------------------------------------
# The view from the eye, drawn without Blender: a column per bearing, the
# ground marched outward from the eye and each sample painted over the
# rows it rises above (the old voxel-space trick). It is a check on the
# shape of the range, not the game's picture.

def preview(path, width=1600, left=-100.0, right=100.0, top=18.0, bottom=-16.0,
            steps=900, sun=(66.0, 28.0)):
    from PIL import Image
    bearings = np.radians(np.linspace(left, right, width))
    dist = D0 * (D1 / D0) ** np.linspace(0, 1, steps)
    B, Dm = np.meshgrid(bearings, dist, indexing='ij')
    x = Dm * np.sin(B)
    z = -Dm * np.cos(B)
    h = np.empty_like(x)
    for c in range(0, width, 64):
        h[c:c + 64] = altitude(x[c:c + 64], z[c:c + 64])
    # the ground's slope from the grid itself
    dB = bearings[1] - bearings[0]
    dHdD = np.gradient(h, axis=1) / np.gradient(dist)[None, :]
    dHdT = np.gradient(h, axis=0) / (Dm * dB)
    gx = dHdD * np.sin(B) + dHdT * np.cos(B)
    gz = -dHdD * np.cos(B) + dHdT * np.sin(B)
    n = np.stack([-gx, np.ones_like(gx), -gz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    snow, forest, ice, rock = cover(h, n[..., 1], x, z)
    albedo = (snow[..., None] * np.array([0.92, 0.94, 0.97])
              + forest[..., None] * np.array([0.10, 0.13, 0.11])
              + ice[..., None] * np.array([0.74, 0.86, 0.95])
              + rock[..., None] * np.array([0.30, 0.28, 0.27]))
    sa, se = math.radians(sun[0]), math.radians(sun[1])
    s = np.array([math.sin(sa) * math.cos(se), math.sin(se), -math.cos(sa) * math.cos(se)])
    lam = np.clip(n @ s, 0, 1)
    sky = 0.5 + 0.5 * n[..., 1]
    col = albedo * (np.array([1.0, 0.96, 0.88]) * lam[..., None] * 1.25
                    + np.array([0.55, 0.68, 0.9])[None, None, :] * sky[..., None] * 0.30)
    T = np.exp(-Dm / 45000.0)[..., None]
    haze = np.array([0.78, 0.84, 0.93])
    col = col * T + haze * (1 - T)
    elev = np.degrees(np.arctan2(h - EYE - curvature_drop(Dm), Dm))
    res = (top - bottom) / int(width * (top - bottom) / (right - left))
    rows = int(round((top - bottom) / res))
    img = np.zeros((rows, width, 3))
    r = np.arange(rows)
    skyrow = (top - r * res)[:, None]
    skycol = (np.array([0.42, 0.62, 0.92]) * smoothstep(0, 25, skyrow)
              + np.array([0.80, 0.86, 0.95]) * (1 - smoothstep(0, 25, skyrow)))
    for c in range(width):
        rr = (top - elev[c]) / res
        top_so_far = np.minimum.accumulate(rr)
        idx = np.searchsorted(-top_so_far, -(r + 0.5), side='left')
        hit = idx < steps
        img[:, c] = np.where(hit[:, None], col[c, np.minimum(idx, steps - 1)], skycol)
        # below the first sample: the game's own ground
        img[r + 0.5 > rr[0], c] = [0.6, 0.62, 0.66]
    img = np.clip(img, 0, 1) ** (1 / 2.2)
    Image.fromarray((img * 255).astype(np.uint8)).save(path)
    return path


# --------------------------------------------------------------------------
# The mesh. The range is sampled on a log-polar grid round the eye — a
# column per bearing, rows spaced evenly in log distance, which is roughly
# evenly on screen — then slid into the ring it is drawn in, and decimated
# there by Blender, where an error of a metre is an error of about a pixel
# whatever the distance it stands for.

COLS = 3072
ROWS = 480
TARGET_VERTS = 90000
SECTORS = 24                 # 15° each; the frustum keeps about a third
HORIZON_MAX = 50.0           # degrees, the top of the horizons' byte


def ring_grid(cols=COLS, rows=ROWS):
    theta = np.arange(cols) * TAU / cols
    dist = D0 * (D1 / D0) ** np.linspace(0, 1, rows)
    T, Dm = np.meshgrid(theta, dist, indexing='ij')
    x = Dm * np.sin(T)
    z = -Dm * np.cos(T)
    h = np.empty_like(x)
    for c in range(0, cols, 48):
        h[c:c + 48] = altitude(x[c:c + 48], z[c:c + 48])
    return theta, dist, x, z, h


class Field:
    """The sampled range, looked up anywhere: bilinear on the grid, wrapped
    round the ring; inside the first row it holds the first row's height,
    which is near enough for a horizon looking back over the run."""

    def __init__(self, dist, h):
        self.h = h
        self.cols, self.rows = h.shape
        self.lnd = math.log(D1 / D0)

    def __call__(self, x, z):
        theta = np.mod(np.arctan2(x, -z), TAU)
        d = np.maximum(np.hypot(x, z), D0)
        c = theta / TAU * self.cols
        r = np.clip(np.log(d / D0) / self.lnd * (self.rows - 1), 0, self.rows - 1.0001)
        c0 = np.floor(c).astype(np.int64)
        r0 = np.floor(r).astype(np.int64)
        fc = c - c0
        fr = r - r0
        c0 %= self.cols
        c1 = (c0 + 1) % self.cols
        h = self.h
        return ((h[c0, r0] * (1 - fc) + h[c1, r0] * fc) * (1 - fr)
                + (h[c0, r0 + 1] * (1 - fc) + h[c1, r0 + 1] * fc) * fr)


def drawn(x, h, z):
    """Real ground → where it is drawn: along its own line of sight from
    the eye, to its drawn radius."""
    d = np.hypot(x, z)
    k = drawn_radius(d) / d
    y = h - EYE - curvature_drop(d)
    return np.stack([x * k, y * k, z * k], -1)


def real(p):
    """…and back: the drawn radius names the real distance."""
    r = np.hypot(p[:, 0], p[:, 2])
    d = D0 * np.exp((r - R0) / (R1 - R0) * math.log(D1 / D0))
    k = d / r
    x = p[:, 0] * k
    z = p[:, 2] * k
    h = p[:, 1] * k + EYE + curvature_drop(d)
    return x, h, z, d


def importance(p):
    """How much each bearing is worth, for the decimation: the chase camera
    looks down the run, the flanks come into view in a turn, and behind is
    uphill and almost never seen."""
    b = np.degrees(np.abs(np.arctan2(p[:, 0], -p[:, 2])))
    return 0.4 + 0.6 * smoothstep(150.0, 70.0, b)


def grid_faces(cols, rows):
    c = np.arange(cols)[:, None]
    r = np.arange(rows - 1)[None, :]
    a = c * rows + r
    b = ((c + 1) % cols) * rows + r
    quads = np.stack([a, b, b + 1, a + 1], -1).reshape(-1, 4)
    return np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])


def decimate(verts, faces, target):
    """Blender's quadric collapse, which keeps the crests and spends nothing
    on the flat."""
    import bpy
    mesh = bpy.data.meshes.new('range')
    mesh.from_pydata(verts.tolist(), [], faces.tolist())
    mesh.validate()
    obj = bpy.data.objects.new('range', mesh)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, target / len(verts))
    mod.use_collapse_triangulate = True
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    out = ev.to_mesh()
    n = len(out.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    out.vertices.foreach_get('co', co)
    out.calc_loop_triangles()
    tri = np.empty(len(out.loop_triangles) * 3, dtype=np.int64)
    out.loop_triangles.foreach_get('vertices', tri)
    ev.to_mesh_clear()
    return co.reshape(-1, 3).astype(np.float64), tri.reshape(-1, 3)


def normals_at(x, z, d):
    e = np.clip(d * 0.003, 12.0, 120.0)
    hx = altitude(x + e, z) - altitude(x - e, z)
    hz = altitude(x, z + e) - altitude(x, z - e)
    n = np.stack([-hx / (2 * e), np.ones_like(x), -hz / (2 * e)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def horizons(field, x, z, h):
    """How high the land stands round each vertex, on HORIZONS bearings
    (0 down the run, then clockwise towards +x), in degrees above level."""
    out = np.zeros((len(x), HORIZONS))
    steps = 20.0 * 1.165 ** np.arange(46)
    for k in range(HORIZONS):
        b = k * TAU / HORIZONS
        dx, dz = math.sin(b), -math.cos(b)
        best = np.full(len(x), -90.0)
        for t in steps:
            hh = field(x + dx * t, z + dz * t)
            best = np.maximum(best, np.degrees(np.arctan2(hh - h - 4.0, t)))
        out[:, k] = best
    return out


def bake(field, p):
    """The horizons round every vertex — the one thing the maps cannot
    carry, because it depends on ground kilometres away."""
    x, h, z, d = real(p)
    return horizons(field, x, z, h)


MAP_COLS = 4096
MAP_ROWS = 1024


def bake_maps():
    """The detail the mesh is too coarse for, on the same log-polar frame:
    u the bearing (0 straight down the run, then towards +x), v the log of
    the distance from D0 to D1. A texel is one patch of real ground, so
    unlike a panorama nothing can be hidden behind anything else in it.
    Returns (shape, cover): the ground's normal (x and z, at half range)
    and its cavity; and its snow, forest and ice."""
    theta = (np.arange(MAP_COLS) + 0.5) * TAU / MAP_COLS
    v = (np.arange(MAP_ROWS) + 0.5) / MAP_ROWS
    dist = D0 * (D1 / D0) ** v
    T, Dm = np.meshgrid(theta, dist, indexing='ij')
    x = Dm * np.sin(T)
    z = -Dm * np.cos(T)
    h = np.empty_like(x)
    for c in range(0, MAP_COLS, 32):
        h[c:c + 32] = altitude(x[c:c + 32], z[c:c + 32])
    # slope from the grid itself, in metres
    dT = TAU / MAP_COLS
    hp = np.concatenate([h[-1:], h, h[:1]], 0)
    dHdT = (hp[2:] - hp[:-2]) / (2 * Dm * dT)
    dHdD = np.gradient(h, axis=1) / np.gradient(dist)[None, :]
    gx = dHdD * np.sin(T) + dHdT * np.cos(T)
    gz = -dHdD * np.cos(T) + dHdT * np.sin(T)
    n = np.stack([-gx, np.ones_like(gx), -gz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # cavity: how far below the mean of its neighbours a texel lies, in
    # metres per metre of spacing — gullies dark, crests bright
    lap = (hp[2:] + hp[:-2] - 2 * h) / (Dm * dT) ** 2 * (Dm * dT)
    cav = 0.5 + np.clip(-lap * 0.9, -0.5, 0.5)
    snow, forest, ice, rock = cover(h, n[..., 1], x, z)
    shape = np.stack([0.5 + 0.5 * n[..., 0], 0.5 + 0.5 * n[..., 2], cav], -1)
    cov = np.stack([snow, forest, ice], -1)
    return shape, cov


def save_map(path, rgb, quality=85, half=False):
    """[cols, rows, 3] in 0..1 → a WebP with u across and v up, through
    Blender (its Python has no PIL). Data, not colour. `half` averages it
    down by two each way first."""
    import bpy
    if half:
        rgb = 0.25 * (rgb[0::2, 0::2] + rgb[1::2, 0::2] + rgb[0::2, 1::2] + rgb[1::2, 1::2])
    cols, rows, _ = rgb.shape
    img = bpy.data.images.new(os.path.basename(path), cols, rows, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((rows, cols, 4), dtype=np.float32)
    px[..., :3] = np.transpose(rgb, (1, 0, 2))
    img.pixels.foreach_set(px.ravel())
    img.file_format = 'WEBP'
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)


def sectors(p, tri):
    """The ring cut into SECTORS slices by bearing — boundaries every 15°
    from straight down the run, so one falls on +x, where the sky probe's
    panorama is joined, and no slice straddles it."""
    c = p[tri].mean(axis=1)
    b = np.mod(np.arctan2(c[:, 0], -c[:, 2]), TAU)
    k = np.minimum((b / TAU * SECTORS).astype(np.int64), SECTORS - 1)
    for s in range(SECTORS):
        t = tri[k == s]
        used, inv = np.unique(t.ravel(), return_inverse=True)
        yield s, used, inv.reshape(-1, 3)


def write_glb(path, parts, extras):
    """Plain glTF: float positions, everything else normalised bytes, one
    node per sector, no transforms — what js/glb.js reads."""
    blobs = []
    views = []
    accessors = []
    offset = 0

    def add(arr, comp, kind, normalized=False, minmax=False):
        nonlocal offset
        data = np.ascontiguousarray(arr).tobytes()
        pad = (-len(data)) % 4
        blobs.append(data + b'\0' * pad)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)})
        offset += len(data) + pad
        acc = {'bufferView': len(views) - 1, 'componentType': comp, 'type': kind,
               'count': int(arr.shape[0])}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = arr.min(axis=0).tolist()
            acc['max'] = arr.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    nodes, meshes = [], []
    for name, part in parts:
        attrs = {
            'POSITION': add(part['position'].astype(np.float32), 5126, 'VEC3', minmax=True),
            '_HORIZON_A': add(part['horizons'][:, :4], 5121, 'VEC4', normalized=True),
            '_HORIZON_B': add(part['horizons'][:, 4:], 5121, 'VEC4', normalized=True),
        }
        index = add(part['index'].astype(np.uint16).ravel(), 5123, 'SCALAR')
        meshes.append({'name': name, 'primitives': [
            {'attributes': attrs, 'indices': index, 'material': 0}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'extras': part['extras']})
    gltf = {
        'asset': {'version': '2.0', 'generator': 'alpen tools/blender/backdrop.py'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes))), 'extras': extras}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': [{'name': 'range'}],
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': offset}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    bin_ = b''.join(blobs)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(bin_), 0x004E4942) + bin_
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)


def build(out_dir):
    import time
    t0 = time.time()
    theta, dist, x, z, h = ring_grid()
    print(f'range sampled: {h.size} points, {time.time() - t0:.0f}s', flush=True)
    field = Field(dist, h)
    p = drawn(x.ravel(), h.ravel(), z.ravel())
    w = importance(p)
    faces = grid_faces(COLS, ROWS)
    verts, tri = decimate(p * w[:, None], faces, TARGET_VERTS)
    verts /= importance(verts)[:, None]
    print(f'decimated: {len(verts)} vertices, {len(tri)} triangles, {time.time() - t0:.0f}s', flush=True)
    hz = np.round(np.clip(bake(field, verts) / HORIZON_MAX, 0, 1) * 255).astype(np.uint8)
    print(f'horizons baked, {time.time() - t0:.0f}s', flush=True)
    frame = {'eye': EYE, 'distance': [D0, D1], 'radius': [R0, R1],
             'horizons': HORIZONS, 'horizonMax': HORIZON_MAX}
    parts = []
    for s, used, idx in sectors(verts, tri):
        parts.append((f'range_{s:02d}', {
            'position': verts[used], 'horizons': hz[used], 'index': idx,
            'extras': {'bearing': [s * 360 / SECTORS, (s + 1) * 360 / SECTORS], **frame},
        }))
    path = os.path.join(out_dir, 'models', 'backdrop', 'alps.glb')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    size = write_glb(path, parts, frame)
    print(f'wrote {path}: {size / 1e6:.2f} MB, {time.time() - t0:.0f}s', flush=True)
    build_maps(out_dir)
    print(f'maps baked, {time.time() - t0:.0f}s', flush=True)
    return path


def build_maps(out_dir):
    shape, cov = bake_maps()
    tex = os.path.join(out_dir, 'textures', 'backdrop')
    os.makedirs(tex, exist_ok=True)
    # The cover's edges are cut again in the shader, so it can be coarser.
    save_map(os.path.join(tex, 'alps-shape.webp'), shape, quality=84)
    save_map(os.path.join(tex, 'alps-cover.webp'), cov, quality=88, half=True)


if __name__ == '__main__' and '--' in sys.argv and '--out' in sys.argv:
    out = sys.argv[sys.argv.index('--out') + 1]
    if '--maps-only' in sys.argv:
        build_maps(out)
    else:
        build(out)


if __name__ == '__main__' and '--preview' in sys.argv:
    out = sys.argv[sys.argv.index('--preview') + 1]
    kw = {}
    if '--wide' in sys.argv:
        kw = dict(left=-180.0, right=180.0, width=2400)
    print(preview(out, **kw))
