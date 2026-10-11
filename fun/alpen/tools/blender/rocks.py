"""Alpen rocks — the verge boulders, the erratics and the flank crags, grown
in Blender from distance fields and baked to one atlas per family.

    blender --background --factory-startup \\
        --python fun/alpen/tools/blender/rocks.py -- --out fun/alpen/assets/models/nature

Run from the repository root; writes `alpine-boulders.glb` and
`alpine-crags.glb` (add `--preview DIR` to render each family on the snow,
`--only boulders|crags` to build one). About eight minutes on a laptop, most
of it the Cycles bake, on the CPU, so it runs anywhere. See MODELS.md.

THE GEOLOGY FIRST, BECAUSE THE SHAPES FOLLOW FROM IT.

A boulder beside an Alpine piste is a piece of something larger that broke
along the planes it was always going to break along, and then spent a few
thousand years being knocked about and weathered. So each one is built the
way it was made: a body, cut by its joint planes, its edges rounded by as
much weathering as its rock allows, chipped where something hit it, and
dressed by what grows and stains on it.

  * GRANITE breaks along three joint sets roughly at right angles, so it
    comes out of a face as a block; then weathering eats its corners
    fastest (three faces attack a corner, two an edge), which is why an
    erratic is a rounded box rather than a ball. The fracture faces are
    rough at the scale of its crystals and wavy at the scale of a hand.
    Pale grey, speckled black with biotite, the weathered rind a little
    buff; map lichen and grey rosettes on the faces that see the sky, none
    on a fresh scar.
  * SLATE splits along its cleavage — a set of planes a few centimetres
    apart — so every face that cuts across the cleavage is a staircase of
    thin plates, and every face along it a flat, smooth sheet. Blue-black,
    rust where the pyrite in it weathers out.
  * SCHIST (the "iron" boulder, the flat one) splits along its foliation
    into slabs, its weathered faces stained with the iron oxides its
    biotite and garnet leave behind.

The flank crags are the same rocks at the scale of a cliff: bedding and
cross-joints dividing the face into blocks, each standing a little proud
of or set back from its neighbours, which is what leaves the ledges the
snow lies on.

Every model is built at its size in the game (the grown stand-in's metres;
see `props.js#SCAN_ASPECT` and `CRAG_ASPECT`) and then stretched vertically
by the few per cent it takes to give exactly the height over half-width the
game's collision assumes: the drawn rock fills the collider, no more and no
less. Every node stands on y = 0, centred in x and z; the crags look down
+z, which is the way `props.js` turns them to face the run.
"""

import math
import os
import sys
import time

import numpy as np

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fieldkit as fk  # noqa: E402
from fieldkit import (  # noqa: E402
    Field, fbm, ridged, fbm3, hash01, unit, frame, ellipsoid, smax_k,
)
from riders import collection, clear_collection, tris  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TEXTURES = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'textures'))


def log(*a):
    print(*a, flush=True)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, s], [0, -s, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])


# ===========================================================================
# BOULDERS
# ===========================================================================

class Plane:
    """One joint or fracture face: unit normal n, offset d, how sharply it
    meets its neighbours (`k`, the rounding radius — a young face is
    crisper), and how the face itself is shaped: a long wave (`wave`, m),
    crystal-scale roughness (`rough`, m) and, for a step-fractured face,
    ridged terraces (`steps`, m)."""

    def __init__(self, n, d, wave=0.02, rough=0.006, steps=0.0, scale=0.5, seed=0, fresh=0.0, k=None):
        self.n, self.u, self.v = frame(n)
        self.d = d
        self.wave = wave
        self.rough = rough
        self.steps = steps
        self.scale = scale
        self.seed = seed
        self.fresh = fresh
        self.k = k

    def coarse(self, q):
        return q @ self.n - self.d

    def fine(self, q):
        a = q @ self.u / self.scale
        b = q @ self.v / self.scale
        off = self.wave * fbm(a, b, 3, self.seed)
        off = off + self.rough * fbm(a * 9.0, b * 9.0, 2, self.seed + 5)
        if self.steps:
            off = off + self.steps * (ridged(a * 2.2, b * 2.2, 3, self.seed + 9, sharp=2.5) - 0.35)
        return q @ self.n - self.d + off

    @property
    def slack(self):
        return self.wave * 0.8 + self.rough * 0.8 + self.steps * 0.7


class Boulder:
    """A body (an ellipsoid of semi-axes `body`, the envelope weathering
    has rounded the corners back to), its joint planes rounded into it, the
    whole bent a little (`warp`, real joints are gently curved surfaces), a
    cleavage or foliation staircase, chips knocked off its most exposed
    edges and the odd frost crack — all in the rock's own frame `R` (rows:
    its x, y, z in game space)."""

    def __init__(self, spec):
        self.spec = spec
        rnd = np.random.default_rng(spec['seed'])
        self.rnd = rnd
        self.R = rot_y(spec.get('yaw', 0.0)) @ rot_x(spec.get('tilt', 0.0)) @ rot_z(spec.get('roll', 0.0))
        self.body = np.array(spec['body'], dtype=np.float64)
        self.k = spec.get('round', 0.08)
        self.planes = [Plane(**p) for p in spec['planes']]
        self.floor = spec.get('floor', -self.body[1] * 0.80)
        self.warp = spec.get('warp', (0.05, 1.1))
        self.swell = spec.get('swell', (0.05, 0.9))
        self.grain = spec.get('grain', (0.012, 0.16))
        self.layers = spec.get('layers')
        self.cracks = spec.get('cracks', [])
        self.chips = []         # (centre, radius) — filled in by `chip`

    # -- the field --------------------------------------------------------
    def local(self, P):
        return P @ self.R.T

    def warp_points(self, P):
        """Bend the finished surface: a smooth displacement of the rock's own
        frame, a few centimetres over a metre, applied to the mesh rather
        than inside the field (where it would cost three noises at every
        sample of the band)."""
        a, s = self.warp
        if not a:
            return P
        q = self.local(P)
        seed = self.spec['seed'] + 301
        w = np.stack([fbm3(q / s, 2, seed), fbm3(q / s + 17.3, 2, seed + 3), fbm3(q / s - 9.1, 2, seed + 6)], 1)
        return (q + a * w) @ self.R

    def _shape(self, P, fine):
        q = self.local(P)
        f = ellipsoid(q, self.body)
        if not fine:
            for pl in self.planes:
                f = smax_k(f, pl.coarse(q), pl.k if pl.k is not None else self.k)
        else:
            # Only the faces near the top of the stack shape a point; the rest
            # keep their plain plane, which is cheaper and gives the same max.
            cs = [pl.coarse(q) for pl in self.planes]
            thr = np.maximum.reduce([f] + [c - pl.slack for c, pl in zip(cs, self.planes)])
            for c, pl in zip(cs, self.planes):
                k = pl.k if pl.k is not None else self.k
                need = c + pl.slack >= thr - k
                if need.any():
                    c = c.copy()
                    c[need] = pl.fine(q[need])
                f = smax_k(f, c, k)
        # it rests on a broad, buried foot
        f = smax_k(f, self.floor - P[:, 1], self.k * 0.6)
        return f, q

    def coarse(self, P):
        f, _ = self._shape(P, False)
        return f

    def layer_offset(self, q):
        """The cleavage staircase: plates of irregular thickness, each proud
        or recessed by up to `amp`, and not by the same amount all along —
        a plate breaks back in places — so the edges read as split stone
        rather than as ruled lines."""
        L = self.layers
        n, u, v = frame(L['normal'])
        t = (q @ n) / L['spacing'] + L.get('warp', 0.3) * fbm3(q / L.get('warp_scale', 0.6), 2, L['seed'])
        i = np.floor(t)
        fr = t - i
        ii = i.astype(np.int64)
        a = hash01(ii, L['seed'])
        b = hash01(ii + 1, L['seed'])
        # each plate's own break-back, a noise along it seeded by the plate
        pu = q @ u / L.get('break_scale', 0.35)
        pv = q @ v / L.get('break_scale', 0.35)
        brk_a = fbm(pu + a * 37.0, pv - a * 23.0, 2, L['seed'] + 5)
        brk_b = fbm(pu + b * 37.0, pv - b * 23.0, 2, L['seed'] + 5)
        ha = a + L.get('breaks', 0.8) * brk_a
        hb = b + L.get('breaks', 0.8) * brk_b
        h = ha + (hb - ha) * fk.smoothstep(1.0 - L.get('edge', 0.12), 1.0, fr)
        return L['amp'] * (h - 0.5), i

    def fine(self, P, chips=True):
        f, q = self._shape(P, True)
        a, s = self.swell
        f = f + a * fbm3(q / s, 3, self.spec['seed'] + 101)
        g, gs = self.grain
        f = f + g * fbm3(q / gs, 3, self.spec['seed'] + 151)
        if self.layers:
            off, _ = self.layer_offset(q)
            f = f + off
        for c in self.cracks:
            f = self._crack(f, q, c)
        if chips:
            for (c, r) in self.chips:
                d = np.abs(P - c).max(1) < r
                if d.any():
                    f[d] = smax_k(f[d], r - np.linalg.norm(P[d] - c, axis=1), 0.008)
        return f

    def _crack(self, f, q, c):
        """A frost crack: a slot along a plane through the rock, open `width`
        at the surface and closing to nothing `depth` in, over the part of
        the plane `reach` (a 0..1 band across it) says."""
        n, u, v = frame(c['normal'])
        dist = np.abs(q @ n - c['d'] + c.get('wave', 0.015) * fbm(q @ u / 0.3, q @ v / 0.3, 3, c['seed']))
        along = q @ u
        reach = fk.smoothstep(c['from'], c['from'] + 0.15, along) * \
            (1 - fk.smoothstep(c['to'] - 0.15, c['to'], along))
        w = c['width'] * reach * np.clip(1 + f / c['depth'], 0, 1)
        return np.maximum(f, w - dist)

    @property
    def slack(self):
        s = self.swell[0] + self.grain[0] + max([p.slack for p in self.planes] + [0])
        if self.layers:
            s += self.layers['amp'] * (0.5 + self.layers.get('breaks', 0.8) * 0.5) + 0.01
        return s * 1.1 + 0.01

    def field(self, lo, hi):
        return Field(self.fine, self.coarse, self.slack, lo, hi)

    # -- chips --------------------------------------------------------------
    def chip(self, verts, count, radius, depth):
        """Knock `count` chips off the edges and corners of a first, coarse
        surface — where two faces (or a face and the weathered envelope)
        meet — with a sphere of `radius` biting `depth` into the edge: the
        shallow scallop a falling stone or a frost-split flake leaves. Only
        above the snow line; nobody chips a buried foot."""
        q = self.local(verts)
        ds = np.stack([pl.coarse(q) for pl in self.planes], 1)
        order = np.argsort(ds, axis=1)
        a, b = order[:, -1], order[:, -2]
        rows = np.arange(len(verts))
        first, second = ds[rows, a], ds[rows, b]
        normals = np.array([pl.n for pl in self.planes])
        bend = (normals[a] * normals[b]).sum(1) < math.cos(math.radians(35))
        # a true edge: two faces meeting at an angle, both of them the
        # surface there (not the rounded envelope beyond them)
        on = first > ellipsoid(q, self.body) - 0.01
        edge = ((first - second) < max(self.k, 0.03) * 1.2) & bend & on
        lo_y, hi_y = verts[:, 1].min(), verts[:, 1].max()
        top = verts[:, 1] > lo_y + 0.3 * (hi_y - lo_y)
        cand = np.nonzero(edge & top)[0]
        if not len(cand):
            return
        g = fk.gradient(lambda p: self.fine(p, chips=False), verts[cand], 0.01)
        g /= np.linalg.norm(g, axis=1, keepdims=True)
        picks = self.rnd.choice(len(cand), size=min(count, len(cand)), replace=False)
        for k in picks:
            r = self.rnd.uniform(*radius)
            d = self.rnd.uniform(*depth)
            c = verts[cand[k]] + g[k] * (r - d)
            self.chips.append((c, r))

    # -- what the bake reads ---------------------------------------------
    def attributes(self, verts):
        q = self.local(verts)
        # which face each point is on, and how planar it is there
        dists = np.stack([pl.coarse(q) for pl in self.planes], 1) if self.planes else None
        face = np.zeros(len(verts))
        fresh = np.zeros(len(verts))
        if dists is not None:
            near = np.argmax(dists, 1)
            on = np.abs(dists[np.arange(len(verts)), near]) < 0.08
            face = np.where(on, np.array([hash01(i, self.spec['seed']) for i in range(len(self.planes))])[near], 0.5)
            fresh = np.where(on, np.array([pl.fresh for pl in self.planes])[near], 0.0)
        scar = np.zeros(len(verts))
        for (c, r) in self.chips:
            dd = np.linalg.norm(verts - c, axis=1)
            scar = np.maximum(scar, 1 - fk.smoothstep(r - 0.004, r + 0.012, dd))
        for c in self.cracks:
            n, _, _ = frame(c['normal'])
            scar = np.maximum(scar, 1 - fk.smoothstep(c['width'] * 0.6, c['width'] * 2.5,
                                                      np.abs(q @ n - c['d'])) * 1.0)
        lap = laplacian(self.fine, verts, 0.012)
        layer = np.zeros(len(verts))
        if self.layers:
            _, i = self.layer_offset(q)
            layer = hash01(i.astype(np.int64), self.layers['seed'] + 3)
        return {
            'fresh': np.maximum(fresh, scar),
            'face': face,
            'edge': np.clip(lap * 0.012, 0, 1),
            'crev': np.clip(-lap * 0.012, 0, 1),
            'layer': layer,
        }


def laplacian(f, P, h):
    c = f(P)
    s = np.zeros(len(P))
    for a in range(3):
        d = np.zeros(3)
        d[a] = h
        s += f(P + d) + f(P - d) - 2 * c
    return s / (h * h)


def support(n, half):
    """How far an ellipsoid of semi-axes `half` reaches along unit n."""
    return float(np.sqrt(((np.asarray(n) * half) ** 2).sum()))


def block_planes(rnd, half, seed, extra=2, depth=(0.93, 1.0), cut=(0.78, 0.90), wave=0.03,
                 rough=0.007, steps=0.0, fresh=(), tilt=0.12, skip=(), scale=0.6, crisp=0.02):
    """A block's faces: the three joint sets (±x, +y, ±z of the rock's own
    frame, each turned a little out of true, at about the body's reach), and
    `extra` younger fractures cut deeper across its corners and edges, which
    is what makes a block a boulder rather than a brick. Indices in `fresh`
    are faces broken recently — paler, unweathered, bare of lichen, and
    meeting their neighbours at a crisp edge (`crisp`)."""
    planes = []
    i = 0
    for ax in ([1.0, 0, 0], [-1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0], [0, 0, -1.0]):
        if i in skip:
            i += 1
            continue
        n = unit(np.array(ax) + rnd.normal(0, tilt, 3))
        planes.append(dict(n=n, d=support(n, half) * rnd.uniform(*depth), wave=wave * rnd.uniform(0.6, 1.3),
                           rough=rough, steps=steps * rnd.uniform(0.4, 1.0), scale=scale,
                           seed=seed + 17 * i, fresh=1.0 if i in fresh else rnd.uniform(0.0, 0.2),
                           k=crisp if i in fresh else None))
        i += 1
    for j in range(extra):
        a = rnd.uniform(0, TAU_)
        y = rnd.uniform(-0.15, 0.85)
        n = unit(np.array([math.cos(a), y, math.sin(a)]))
        planes.append(dict(n=n, d=support(n, half) * rnd.uniform(*cut), wave=wave * 0.6, rough=rough,
                           steps=steps * 0.5, scale=scale * 0.8, seed=seed + 17 * i,
                           fresh=1.0 if i in fresh else rnd.uniform(0.25, 0.8),
                           k=crisp if i in fresh else None))
        i += 1
    return planes


TAU_ = math.tau


# The five boulder pools, in props.js order. `aspect` is SCAN_ASPECT — the
# height over half-width each pool's collider assumes — and `size` the grown
# stand-in's half-width, so the rock is built at the size it is drawn.
BOULDERS = [
    dict(name='boulder_slate', rock='slate', aspect=0.90, size=1.40, sink=0.16),
    dict(name='boulder_iron', rock='schist', aspect=0.45, size=1.42, sink=0.16),
    dict(name='boulder_granite_a', rock='granite', aspect=0.70, size=1.47, sink=0.14),
    dict(name='boulder_granite_b', rock='granite', aspect=1.34, size=1.28, sink=0.14),
    dict(name='boulder_granite_c', rock='granite', aspect=1.20, size=1.32, sink=0.14),
]


def boulder_spec(i):
    b = BOULDERS[i]
    seed = 4100 + 97 * i
    rnd = np.random.default_rng(seed)
    hw = b['size']
    h = b['aspect'] * hw          # the height it must stand
    if b['rock'] == 'slate':
        # A book of plates on edge: the cleavage steep (the rock's own x),
        # the two faces along it smooth sheets, the top and ends cut across
        # it and showing every plate.
        half = np.array([hw * 0.80, h * 0.56, hw * 0.98])
        planes = block_planes(rnd, half, seed, extra=3, depth=(0.94, 1.0), cut=(0.74, 0.86),
                              wave=0.02, rough=0.003, steps=0.006, fresh=(5,), tilt=0.07, crisp=0.012)
        return dict(seed=seed, body=half * 1.5, planes=planes, round=0.022, yaw=rnd.uniform(0, 3),
                    tilt=0.05, warp=(0.05, 1.3), swell=(0.012, 0.7), grain=(0.003, 0.07),
                    layers=dict(normal=(1.0, 0.42, 0.12), spacing=0.04, amp=0.024, seed=seed + 7,
                                warp=0.45, warp_scale=0.9, edge=0.08, breaks=0.45, break_scale=0.6),
                    chips=(22, (0.10, 0.26), (0.015, 0.04)))
    if b['rock'] == 'schist':
        # A slab: the foliation nearly level, top and bottom along it, the
        # edges showing the plates it will one day split into.
        half = np.array([hw * 0.98, h * 0.55, hw * 0.80])
        planes = block_planes(rnd, half, seed, extra=3, depth=(0.92, 1.0), cut=(0.72, 0.86),
                              wave=0.03, rough=0.005, steps=0.008, fresh=(0, 6), tilt=0.08, crisp=0.015)
        planes[2]['wave'] = 0.012       # the top is a foliation plane
        return dict(seed=seed, body=half * 1.45, planes=planes, round=0.03, yaw=rnd.uniform(0, 3),
                    tilt=0.04, roll=0.03, warp=(0.06, 1.4), swell=(0.015, 0.9), grain=(0.004, 0.09),
                    layers=dict(normal=(0.05, 1.0, -0.08), spacing=0.06, amp=0.026, seed=seed + 7,
                                warp=0.3, warp_scale=1.2, edge=0.12, breaks=0.5, break_scale=0.7),
                    chips=(18, (0.12, 0.30), (0.015, 0.04)))
    # granite: a jointed block, its corners eaten by weathering (the
    # envelope), one or two young faces where a piece came away
    half = np.array([hw * 0.92, h * 0.55, hw * 0.84])
    extra = {2: 4, 3: 4, 4: 5}[i]
    planes = block_planes(rnd, half, seed, extra=extra, depth=(0.95, 1.0), cut=(0.74, 0.88),
                          wave=0.06, rough=0.006, steps=0.005, fresh=(5 + (i % 2),), tilt=0.15, crisp=0.02)
    cracks = []
    if b['name'] == 'boulder_granite_b':
        cracks.append(dict(normal=(1.0, 0.05, 0.25), d=0.16, width=0.02, depth=0.40, seed=seed + 41,
                           **{'from': -2.0, 'to': 0.5}))
    return dict(seed=seed, body=half * (1.4 if i < 4 else 1.6), planes=planes, round=0.05 + 0.015 * (i % 2),
                yaw=rnd.uniform(0, 3), tilt=0.05, warp=(0.07, 1.2), swell=(0.02, 0.8), grain=(0.005, 0.11),
                cracks=cracks, chips=(14, (0.16, 0.40), (0.025, 0.06)))


def build_boulder(i, col, step=0.014):
    """The boulder's full-detail surface: (rock, verts, tris, attributes),
    standing on y = 0 at the height over half-width its pool assumes."""
    b = BOULDERS[i]
    spec = boulder_spec(i)
    rock = Boulder(spec)
    lo = -rock.body * 1.1
    hi = rock.body * 1.1
    lo[1] = rock.floor - 0.05
    # a first, coarse pass finds the edges the chips are knocked off
    v0, _ = fk.mesh_field(rock.field(lo, hi), step * 3, project_iters=1)
    rock.chip(v0, spec['chips'][0], spec['chips'][1], spec['chips'][2])
    verts, faces = fk.mesh_field(rock.field(lo, hi), step, project_iters=2, log=log)
    attrs = rock.attributes(verts)
    verts = rock.warp_points(verts)
    shift, k = fit(verts, b['aspect'])
    return rock, apply_fit(verts, shift, k), faces, attrs


def fit(verts, aspect):
    """Base on y = 0, centred in x and z, and stretched vertically to the
    exact height over half-width the game's collider assumes. Returns the
    transform as (shift, k) so the low surface can be fitted the same."""
    lo = verts.min(0)
    hi = verts.max(0)
    centre = (lo + hi) / 2
    half = max(hi[0] - lo[0], hi[2] - lo[2]) / 2
    k = aspect * half / (hi[1] - lo[1])
    return np.array([centre[0], lo[1], centre[2]]), k


def apply_fit(verts, shift, k):
    out = verts - shift
    out[:, 1] *= k
    return out


# ===========================================================================
# CRAGS
# ===========================================================================

def wavy(q, n, spacing, waves, seed):
    """Position across a joint set, in spacings: the plane's distance plus a
    few long sine undulations — joints are rarely flat over ten metres, and
    sines cost nothing next to a noise at every sample of the grid."""
    n, u, v = frame(n)
    t = (q @ n) / spacing
    rnd = np.random.default_rng(seed)
    for amp, length in waves:
        a, b = rnd.uniform(0, TAU_, 2)
        t = t + amp * np.sin(q @ u / length + a) * np.cos(q @ v / (length * 1.3) + b)
    return t


class Crag:
    """A rock mass: an envelope (joint-bounded like a boulder, under a
    broken skyline), divided into blocks by its bedding and two sets of
    cross-joints, every block set back from the envelope by its own amount.
    That set-back is the whole look: where a block stands proud of the one
    above it there is a ledge, and a ledge is where the snow lies; where a
    joint has opened at the surface there is a cleft. Everything up to the
    blocks is cheap (planes, sines and hashes) and is the coarse field; only
    the surface texture of the stone is noise."""

    def __init__(self, spec):
        self.spec = spec
        self.seed = spec['seed']
        self.rnd = np.random.default_rng(self.seed)
        self.R = rot_y(spec.get('yaw', 0.0))
        self.body = np.array(spec['body'], dtype=np.float64)
        self.planes = [Plane(**p) for p in spec['planes']]
        self.k = spec.get('round', 0.4)
        self.floor = spec['floor']
        self.sets = spec['joints']        # [(normal, spacing, waves)]
        self.recess = spec['recess']      # (metres, power)
        self.soft = spec.get('soft', 0.08)
        self.grooves = spec.get('grooves', (0.0, 0.0))
        self.skyline = spec.get('skyline')
        self.noise = spec.get('noise', [(0.10, 1.2), (0.03, 0.35), (0.008, 0.09)])
        self.layers = None
        self.chips = []
        self.cracks = []

    def local(self, P):
        return P @ self.R.T

    def envelope(self, q, P):
        f = ellipsoid(q, self.body)
        for pl in self.planes:
            f = smax_k(f, pl.coarse(q), pl.k if pl.k is not None else self.k)
        if self.skyline:
            top, waves = self.skyline
            sky = np.full(len(q), top)
            rnd = np.random.default_rng(self.seed + 5)
            for amp, length in waves:
                sky = sky + amp * np.sin(q[:, 0] / length + rnd.uniform(0, TAU_))
            f = smax_k(f, q[:, 1] - sky, self.k)
        return smax_k(f, self.floor - P[:, 1], 0.3)

    def cells(self, q):
        out = []
        for k_, (n, spacing, waves) in enumerate(self.sets):
            t = wavy(q, n, spacing, waves, self.seed + 31 * k_)
            i = np.floor(t)
            out.append((i.astype(np.int64), t - i))
        return out

    def blocks(self, q):
        """Each block's set-back, blended across a joint over `soft` of a
        spacing so a step is a step and not a sampling artefact; and the
        distance (in metres) to the nearest joint, for the clefts.

        A block is not only set back but turned: its face leans by up to
        `tilt` (a slope) along each of the three joint directions, so no two
        neighbouring faces are coplanar — which is the difference between a
        cliff and a wall someone built."""
        cs = self.cells(q)
        R, power = self.recess
        slope = self.spec.get('tilt', 0.0)
        total = np.zeros(len(q))
        weights = []
        for (i, fr), (_, spacing, _) in zip(cs, self.sets):
            w = fk.smoothstep(1.0 - self.soft, 1.0, fr)
            weights.append(w)
        for a in (0, 1):
            for b in (0, 1):
                for c in (0, 1):
                    key = (cs[0][0] + a) * 1_000_003 + (cs[1][0] + b) * 7_919 + (cs[2][0] + c)
                    h = R * hash01(key, self.seed + 77) ** power
                    if slope:
                        for d_, ((_, fr), (_, spacing, _)) in enumerate(zip(cs, self.sets)):
                            local = (fr - (a, b, c)[d_] - 0.5) * spacing
                            h = h + slope * (hash01(key, self.seed + 91 + 13 * d_) - 0.5) * 2 * local
                    w = ((weights[0] if a else 1 - weights[0]) * (weights[1] if b else 1 - weights[1])
                         * (weights[2] if c else 1 - weights[2]))
                    total += w * h
        gap = np.full(len(q), 1e9)
        for (i, fr), (_, spacing, _) in zip(cs[1:], self.sets[1:]):
            gap = np.minimum(gap, np.minimum(fr, 1 - fr) * spacing)
        # Turned blocks lean back into the mass, never out of it: a block
        # proud of the envelope at a flank is a fin of rock in the air.
        return np.maximum(total, 0.02), gap

    def coarse(self, P):
        q = self.local(P)
        f = self.envelope(q, P)
        off, gap = self.blocks(q)
        f = f + off
        w, depth = self.grooves
        if w:
            open_ = w * np.clip(1 + f / depth, 0, 1)
            f = np.maximum(f, np.minimum(open_ - gap, f + depth))
        return f

    def fine(self, P):
        f = self.coarse(P)
        q = self.local(P)
        for k_, (a, s) in enumerate(self.noise):
            f = f + a * fbm3(q / s, 3, self.seed + 100 + 7 * k_)
        return f

    @property
    def slack(self):
        return sum(a for a, _ in self.noise) * 1.1 + 0.02

    def field(self, lo, hi):
        return Field(self.fine, self.coarse, self.slack, lo, hi)

    def warp_points(self, P):
        return P

    def attributes(self, verts):
        q = self.local(verts)
        cs = self.cells(q)
        key = cs[0][0] * 1_000_003 + cs[1][0] * 7_919 + cs[2][0]
        lap = laplacian(self.fine, verts, 0.04)
        _, gap = self.blocks(q)
        bed = hash01(cs[0][0], self.seed + 3)
        # A block that stands well back from its neighbours has lost its
        # face recently; the proud ones have weathered for longest.
        off, _ = self.blocks(q)
        fresh = fk.smoothstep(0.55, 0.95, off / self.recess[0]) * 0.8
        return {
            'fresh': fresh,
            'face': hash01(key, self.seed + 9),
            'edge': np.clip(lap * 0.05, 0, 1),
            'crev': np.clip(-lap * 0.05, 0, 1) + (1 - fk.smoothstep(0.0, 0.25, gap)) * 0.6,
            'layer': bed,
        }


def crag_planes(rnd, defs, seed):
    out = []
    for k_, (n, d, wave) in enumerate(defs):
        out.append(dict(n=unit(n), d=d, wave=wave, rough=0.02, scale=2.5, seed=seed + 13 * k_))
    return out


# The three flank pools, in props.js order: `aspect` is CRAG_ASPECT, and a
# fifth of the height (CRAG_SINK) is below the snow. Each looks down +z.
CRAGS = [
    dict(name='crag_face', rock='gneiss', aspect=1.44, height=14.0),
    dict(name='crag_buttress', rock='gneiss', aspect=2.06, height=16.0),
    dict(name='crag_block', rock='granite', aspect=1.10, height=12.0),
]
CRAG_SINK = 0.20


def crag_spec(i):
    c = CRAGS[i]
    seed = 7300 + 131 * i
    rnd = np.random.default_rng(seed)
    H = c['height']
    floor = -H * CRAG_SINK
    top = H * (1 - CRAG_SINK)
    hw = H / c['aspect']
    if c['name'] == 'crag_face':
        # A face of bedded gneiss: steep and stepped towards the run, the
        # beds dipping gently back into the hill, a broken skyline, and a
        # long back slope into the mountain.
        planes = crag_planes(rnd, [
            ((0.0, 0.16, 1.0), hw * 0.55, 0.25),          # the face
            ((0.0, 0.85, -1.0), top * 0.62, 0.3),         # the back slope
            ((1.0, 0.30, 0.05), hw * 0.95, 0.3),
            ((-1.0, 0.35, 0.12), hw * 0.92, 0.3),
            ((0.55, 0.25, 0.8), hw * 0.80, 0.25),         # the face's shoulders
            ((-0.6, 0.3, 0.8), hw * 0.78, 0.25),
        ], seed)
        return dict(seed=seed, body=(hw * 1.15, top * 1.25, hw * 0.75), planes=planes, round=0.5,
                    floor=floor, skyline=(top * 0.97, [(0.9, 2.1), (0.45, 0.9), (0.2, 0.43)]),
                    joints=[((0.06, 1.0, -0.22), 2.1, [(0.35, 4.0), (0.12, 1.5)]),
                            ((1.0, 0.0, 0.25), 4.3, [(0.3, 5.0)]),
                            ((0.15, 0.1, 1.0), 3.1, [(0.3, 4.5)])],
                    recess=(1.25, 2.6), tilt=0.2, soft=0.09, grooves=(0.06, 0.5),
                    noise=[(0.22, 2.4), (0.07, 0.7), (0.02, 0.2)])
    if c['name'] == 'crag_buttress':
        # A buttress of jointed gneiss standing out of the slope: vertical
        # joints dividing it into columns, a blocky summit.
        planes = crag_planes(rnd, [
            ((0.0, 0.08, 1.0), hw * 0.62, 0.3),
            ((0.0, 0.5, -1.0), hw * 0.75, 0.3),
            ((1.0, 0.12, 0.1), hw * 0.92, 0.3),
            ((-1.0, 0.14, 0.05), hw * 0.92, 0.3),
            ((0.7, 0.9, 0.2), top * 0.78, 0.3),           # the summit's two roofs
            ((-0.75, 0.85, 0.3), top * 0.76, 0.3),
            ((0.6, 0.1, 0.8), hw * 0.80, 0.25),
            ((-0.65, 0.1, 0.75), hw * 0.80, 0.25),
        ], seed)
        return dict(seed=seed, body=(hw * 1.2, top * 1.2, hw * 0.95), planes=planes, round=0.45,
                    floor=floor, skyline=(top * 0.98, [(0.8, 1.6), (0.4, 0.7)]),
                    joints=[((0.1, 1.0, 0.05), 3.2, [(0.3, 4.0)]),
                            ((1.0, 0.0, 0.1), 3.0, [(0.25, 6.0), (0.08, 1.8)]),
                            ((0.05, 0.0, 1.0), 3.4, [(0.25, 5.5)])],
                    recess=(1.5, 2.2), tilt=0.16, soft=0.08, grooves=(0.09, 0.8),
                    noise=[(0.22, 2.4), (0.07, 0.7), (0.02, 0.2)])
    # A granite tor: blocks the size of a hut, rounded where three joints
    # meet, stacked into a dome, the clefts between them open.
    planes = crag_planes(rnd, [
        ((0.0, 0.25, 1.0), hw * 0.62, 0.4),
        ((0.0, 0.6, -1.0), hw * 0.7, 0.4),
        ((1.0, 0.35, 0.1), hw * 0.95, 0.4),
        ((-1.0, 0.3, 0.1), hw * 0.95, 0.4),
        ((0.1, 1.0, 0.05), top * 0.98, 0.4),
    ], seed)
    return dict(seed=seed, body=(hw * 1.05, top * 1.3, hw * 0.78), planes=planes, round=1.2,
                floor=floor, skyline=None,
                joints=[((0.05, 1.0, 0.1), 3.4, [(0.35, 5.0), (0.1, 2.0)]),
                        ((1.0, 0.0, 0.3), 5.0, [(0.3, 6.0)]),
                        ((-0.3, 0.0, 1.0), 4.6, [(0.3, 6.0)])],
                recess=(1.0, 1.6), tilt=0.12, soft=0.24, grooves=(0.28, 1.3),
                noise=[(0.2, 2.0), (0.05, 0.6), (0.012, 0.15)])


def build_crag(i, col, step=0.06):
    c = CRAGS[i]
    rock = Crag(crag_spec(i))
    H = c['height']
    hw = H / c['aspect']
    lo = np.array([-hw * 1.3, rock.floor - 0.2, -hw * 1.3])
    hi = np.array([hw * 1.3, H * 1.05, hw * 1.3])
    verts, faces = fk.mesh_field(rock.field(lo, hi), step, project_iters=2, log=log, probe=0.4)
    attrs = rock.attributes(verts)
    shift, k = fit(verts, c['aspect'])
    return rock, apply_fit(verts, shift, k), faces, attrs


# ===========================================================================
# THE SURFACE: what the bake reads. Colours are linear albedo; the baked map
# is an albedo with the occlusion multiplied in, the way a photoscan's
# diffuse is, and the game's own light and snow do the rest.
# ===========================================================================

def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


# Rock-forming minerals and the things that grow and stain on them.
BIOTITE = lin('#1e1d1b')
QUARTZ = lin('#55554f')
FELDSPAR = lin('#9a958b')
K_FELDSPAR = lin('#9c8576')
CRUST = lin('#77736b')         # granite's weathering rind, a dull grey-buff
MAP_LICHEN = lin('#9aa23a')    # Rhizocarpon geographicum
PROTHALLUS = lin('#171614')    # its black margin and the lines between areoles
GREY_LICHEN = lin('#9c9d92')   # Lecanora, Aspicilia: pale crustose mosaics
DARK_LICHEN = lin('#2b2925')   # Umbilicaria and the black crusts
ORANGE_LICHEN = lin('#b0601c')  # Xanthoria, where the birds sit
RUST = lin('#6e4428')
SOOT = lin('#1d1c1b')          # the cyanobacterial streaks under every drip line
SOIL = lin('#4a4036')


def rock_axes(rock, normal):
    """The rock's cleavage or foliation frame in game space: the plane's
    normal and two directions in it."""
    n, u, v = frame(normal)
    return [tuple(x @ rock.R) for x in (n, u, v)]


def warped(g, P, scale, amount, w):
    """P pushed about by a noise, so patches have ragged, wandering edges."""
    jitter = g.node('ShaderNodeTexNoise', noise_dimensions='4D')
    g.set(jitter.inputs['Vector'], P)
    g.set(jitter.inputs['W'], w)
    g.set(jitter.inputs['Scale'], scale)
    g.set(jitter.inputs['Detail'], 4.0)
    g.set(jitter.inputs['Roughness'], 0.6)
    off = g.vmath('SUBTRACT', jitter.outputs['Color'], (0.5, 0.5, 0.5))
    return g.vmath('ADD', P, g.vmath('SCALE', off, scale=amount))


def colonies(g, P, scale, density, size, seed, rough=0.9):
    """Lichen thalli: on a jittered cell lattice one cell in `1/density`
    holds a colony, anything from a fifth to the whole of `size` (a fraction
    of the cell) across, its outline torn by a noise. Returns (body, rim)."""
    q = warped(g, P, scale * 2.4, rough / scale, seed * 1.37)
    q = g.vmath('ADD', q, (seed * 3.1, seed * 1.7, -seed * 2.3))
    vor = g.voronoi(q, scale)
    rnd = g.sepc(vor['Color'])
    present = g.math('LESS_THAN', rnd[0], density)
    radius = g.add(size * 0.2, g.mul(g.math('POWER', rnd[1], 1.5), size * 0.8))
    body = g.mul(g.remap(vor['Distance'], radius, g.sub(radius, 0.05)), present)
    outer = g.mul(g.remap(vor['Distance'], g.add(radius, 0.04), radius), present)
    rim = g.math('MAXIMUM', g.sub(outer, body), 0.0)
    return body, rim


def patches(g, P, scale, cover, seed, edge=0.04):
    """Ragged patches covering about `cover` of a surface."""
    q = warped(g, P, scale * 1.8, 0.35 / scale, seed * 2.11)
    n = g.noise(q, scale, 5, 0.62)
    t = 0.5 + (0.5 - cover) * 0.32
    return g.smooth(t - edge, t + edge, n)


def stone_material(name, style, H, axes=None):
    """The albedo of one rock, as an emission shader for the bake.

    `style` names the rock and how much of each thing is on it; `H` is the
    model's height (the foot is at y = 0, and the bottom sixth of it is in
    the snow); `axes` the cleavage frame the photo is projected along."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    g = fk.Graph(mat)
    P = g.coords()
    N = g.normal()
    _, ny, _ = g.sep(N)
    _, py, _ = g.sep(P)
    S = style.get('scale', 1.0)
    hgt = g.math('DIVIDE', py, H)
    fresh = g.attr('fresh')
    edge = g.attr('edge')
    crev = g.attr('crev')
    face = g.attr('face')
    layer = g.attr('layer')
    rock = style['rock']
    axes = axes or [(0, 1, 0), (1, 0, 0), (0, 0, 1)]

    # --- the stone itself ---------------------------------------------------
    photo = os.path.join(TEXTURES, 'rock', 'rock-slate.jpg' if rock == 'slate' else 'rock-granite.jpg')
    img = g.triplanar(photo, P, N, axes, style.get('tile', 1.1) * S)
    pv = g.math('POWER', g.lum(img), 1.1)
    if rock == 'granite':
        grain = g.voronoi(P, 150.0 / S)
        r = g.sepc(grain['Color'])[0]
        feld = K_FELDSPAR if style.get('pink') else FELDSPAR
        minerals = g.ramp(r, [(0.0, BIOTITE), (0.13, QUARTZ), (0.45, FELDSPAR), (0.8, feld), (1.0, feld)],
                          'CONSTANT')
        pepper = g.sepc(g.voronoi(P, 380.0 / S)['Color'])[0]
        minerals = g.mix(g.math('LESS_THAN', pepper, 0.05), minerals, BIOTITE)
        # the weathered rind dulls the grain; the photograph gives it the
        # structure — veins, old fractures, tone — no lattice of grains has
        crust = g.mix(0.78, minerals, CRUST)
        tone = g.combine(*(g.remap(pv, 0.05, 0.5, 0.64, 1.24),) * 3)
        crust = g.cmul(crust, tone)
        # a young face shows its grain, but through the same tone: a fresh
        # fracture is paler and crisper, not a different stone
        young = g.cmul(g.mix(0.4, minerals, CRUST), g.cmul(tone, (1.1, 1.1, 1.1)))
        stone = g.mix(g.math('POWER', fresh, 0.7), crust, young)
    else:
        if rock == 'slate':
            dark, light, weathered = lin('#262b33'), lin('#6c727b'), lin('#6c6860')
        else:
            dark, light, weathered = lin('#352e2a'), lin('#8b7d70'), lin('#706558')
        stone = g.mix(g.remap(pv, 0.03, 0.5), dark, light)
        # each plate a shade of its own, the way split slate is
        stone = g.cmul(stone, g.mix(layer, (0.84, 0.85, 0.88), (1.1, 1.08, 1.06)))
        # a weathered skin on the old faces, the blue-black of fresh rock
        # on the young ones
        stone = g.mix(g.mul(g.sub(1.0, fresh), style.get('weather', 0.35)), stone, weathered)
        stone = g.mix(g.mul(fresh, 0.4), stone, g.cmul(stone, (0.74, 0.79, 0.88)))
    # each joint face weathered for its own length of time
    stone = g.cmul(stone, g.mix(face, (0.86, 0.86, 0.86), (1.08, 1.07, 1.05)))
    # weathering at the scale of a hand and of a stride
    stone = g.cmul(stone, g.mix(g.noise(P, 1.3 / S, 5, 0.6), (0.78, 0.78, 0.78), (1.14, 1.13, 1.11)))
    blot = patches(g, P, 0.9 / S, style.get('blots', 0.3), 5)
    stone = g.mix(g.mul(blot, 0.55), stone, g.cmul(stone, (0.62, 0.6, 0.58)))

    # --- stains ------------------------------------------------------------
    # iron: oxide blooms where water lingers, round cracks and in hollows
    iron = g.smooth(0.55, 0.75, g.add(g.noise(warped(g, P, 1.4 / S, 0.2, 3.3), 0.9 / S, 4, 0.55),
                                      g.mul(crev, 0.35)))
    iron = g.mul(iron, style.get('rust', 0.3))
    stone = g.mix(iron, stone, g.cmul(stone, g.mix(0.55, RUST, (1, 1, 1))))
    # drip lines: soot-black streaks down the steep faces, under the edges
    # that shed the melt
    sx, sy, sz = g.sep(P)
    streak_p = g.combine(g.mul(sx, 9.0 / S), g.mul(sy, 0.6 / S), g.mul(sz, 9.0 / S))
    streak = g.smooth(0.52, 0.72, g.noise(streak_p, 1.0, 3, 0.5))
    steep = g.sub(1.0, g.smooth(0.25, 0.75, g.math('ABSOLUTE', ny)))
    streak = g.mul(g.mul(streak, steep), style.get('streaks', 0.5))
    stone = g.mix(g.mul(streak, 0.65), stone, g.cmul(stone, SOOT))

    # --- what grows on it --------------------------------------------------
    # Lichen wants light and a surface that has stood still for decades: the
    # upper faces, not the scars, not the foot the snow lies against for
    # half the year.
    expose = g.smooth(-0.45, 0.5, ny)
    expose = g.mul(expose, g.sub(1.0, g.math('POWER', fresh, 0.5)))
    expose = g.mul(expose, g.smooth(0.2, 0.4, hgt))
    expose = g.mul(expose, g.sub(1.0, g.mul(crev, 0.8)))
    L = style.get('lichen', 1.0)
    # pale crust mosaics, the commonest cover on alpine silicate rock
    grey = g.mul(patches(g, P, 1.6 / S, style.get('grey', 0.35), 23, 0.05), g.mul(expose, L))
    cells = g.voronoi(P, 45.0 / S, feature='DISTANCE_TO_EDGE')['Distance']
    crust_l = g.mix(g.smooth(0.0, 0.12, cells), g.cmul(GREY_LICHEN, (0.62, 0.62, 0.6)), GREY_LICHEN)
    stone = g.mix(g.mul(grey, 0.85), stone, crust_l)
    # the black crusts, on the shadier and wetter faces
    dark = g.mul(patches(g, P, 2.2 / S, style.get('dark', 0.25), 31, 0.06),
                 g.mul(g.smooth(-0.7, 0.3, ny), g.smooth(0.18, 0.35, hgt)))
    dark = g.mul(dark, g.sub(1.0, fresh))
    stone = g.mix(g.mul(dark, 0.8), stone, DARK_LICHEN)
    # map lichen: yellow-green thalli, black-rimmed, cracked into areoles
    if style.get('map', 0.3):
        body, rim = colonies(g, P, 5.0 / S, style.get('map', 0.3), 0.42, 11)
        areole = g.voronoi(P, 110.0 / S, feature='DISTANCE_TO_EDGE')['Distance']
        lines = g.sub(1.0, g.smooth(0.03, 0.12, areole))
        thallus = g.mix(g.mul(lines, 0.7), MAP_LICHEN, PROTHALLUS)
        thallus = g.cmul(thallus, g.mix(g.noise(P, 25.0 / S, 2, 0.5), (0.75, 0.75, 0.7), (1.1, 1.1, 1.05)))
        stone = g.mix(g.mul(body, g.mul(expose, L)), stone, thallus)
        stone = g.mix(g.mul(rim, g.mul(expose, 0.85 * L)), stone, PROTHALLUS)
    if style.get('orange', 0.0):
        body, _ = colonies(g, P, 12.0 / S, style['orange'], 0.35, 37)
        top = g.smooth(0.55, 0.9, ny)
        stone = g.mix(g.mul(body, g.mul(top, g.mul(expose, L))), stone, ORANGE_LICHEN)

    # --- wear and dirt -----------------------------------------------------
    stone = g.mix(g.mul(edge, 0.5), stone, g.cmul(stone, (1.25, 1.24, 1.22)))
    stone = g.mix(g.mul(crev, 0.85), stone, g.cmul(stone, (0.38, 0.36, 0.35)))
    # the foot: wet, darker, with the soil the snow left on it
    foot = g.sub(1.0, g.smooth(0.03, 0.24, hgt))
    stone = g.mix(g.mul(foot, 0.7), stone, g.cmul(stone, g.mix(0.5, SOIL, (0.45, 0.45, 0.45))))

    # --- light that never reaches in, and the sky's gradient -----------------
    ao = g.ao(style.get('ao', 0.6) * S, 16)
    occl = g.add(0.12, g.mul(g.math('POWER', ao, 1.5), 0.88))
    sky = g.add(0.8, g.mul(g.add(0.5, g.mul(ny, 0.5)), 0.2))
    shade = g.mul(occl, sky)
    stone = g.cmul(stone, g.combine(shade, shade, shade))
    g.emit(stone)
    return mat


ROCK_STYLE = {
    'boulder_slate': dict(rock='slate', tile=0.9, map=0.08, grey=0.22, dark=0.3, rust=0.45, streaks=0.45,
                          blots=0.25),
    'boulder_iron': dict(rock='schist', tile=1.2, map=0.15, grey=0.25, dark=0.3, rust=0.85, streaks=0.35,
                         weather=0.25, blots=0.3),
    'boulder_granite_a': dict(rock='granite', tile=1.5, map=0.35, grey=0.4, dark=0.25, rust=0.25, streaks=0.35,
                              orange=0.15, blots=0.3),
    'boulder_granite_b': dict(rock='granite', tile=1.4, pink=True, map=0.28, grey=0.35, dark=0.3, rust=0.3,
                              streaks=0.5, blots=0.35),
    'boulder_granite_c': dict(rock='granite', tile=1.6, map=0.4, grey=0.42, dark=0.22, rust=0.2, streaks=0.4,
                              blots=0.3),
}

# A crag is drawn tens of metres off: its lichen and stains are drawn at
# three times the boulders' scale (`scale`), or they would be lost between
# texels — what reads at that range is the black drip lines and the pale
# crusts on the ledges.
CRAG_STYLE = {
    'crag_face': dict(rock='schist', tile=0.9, scale=3.0, map=0.1, grey=0.3, dark=0.35, rust=0.5, streaks=0.9,
                      weather=0.3, blots=0.35, ao=0.7),
    'crag_buttress': dict(rock='schist', tile=1.0, scale=3.0, map=0.12, grey=0.35, dark=0.3, rust=0.35,
                          streaks=0.95, weather=0.35, blots=0.3, ao=0.7),
    'crag_block': dict(rock='granite', tile=1.1, scale=2.5, map=0.3, grey=0.4, dark=0.3, rust=0.25, streaks=0.75,
                       blots=0.35, ao=0.8),
}


# ===========================================================================
# From field to file.
# ===========================================================================

def vertices(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def refit(low, high, aspect):
    """Fit the *drawn* surface — the low one — to the collider: base on
    y = 0, centred in x and z, height over half-width exactly `aspect`, and
    move the high surface the same way so the bake still lines up. (In
    Blender's space here: z is up.)"""
    v = vertices(low)
    lo, hi = v.min(0), v.max(0)
    centre = (lo + hi) / 2
    half = max(hi[0] - lo[0], hi[1] - lo[1]) / 2
    k = aspect * half / (hi[2] - lo[2]) if aspect else 1.0
    for ob in (low, high):
        w = vertices(ob)
        w[:, 0] -= centre[0]
        w[:, 1] -= centre[1]
        w[:, 2] = (w[:, 2] - lo[2]) * k
        ob.data.vertices.foreach_set('co', w.ravel())
        ob.data.update()
    return k


def shrink_buried(lows, sink_of):
    """Give the buried foot a third of its texels: its islands are scaled
    down before the final pack, so the faces above the snow get the rest."""
    for low in lows:
        cut = sink_of(low)
        me = low.data
        centres = {p.index: p.center.z for p in me.polygons}
        fk.scale_uv_islands(low, lambda f: 0.35 if centres[f.index] < cut else 1.0)
    fk.repack(lows)


def bake_family(pairs, size, samples, extrusion, distance, texture, quality, sink_of=None):
    lows = [low for _, low in pairs]
    fk.unwrap(lows)
    if sink_of:
        shrink_buried(lows, sink_of)
    t = time.time()
    rgb, _ = fk.bake_atlas(pairs, size, samples, extrusion, distance)
    log(f'  baked {size} atlas in {time.time() - t:.0f}s')
    kb = fk.save_webp(texture, rgb, quality) / 1024
    log(f'  {os.path.basename(texture)}: {kb:.0f} KB')
    return lows


def build_boulders(out_dir, preview_dir=None, tmp=None, atlas=2048, samples=32, quality=80, budget=2450):
    col = collection('boulders')
    clear_collection(col)
    pairs = []
    for i, b in enumerate(BOULDERS):
        t = time.time()
        rock, verts, faces, attrs = build_boulder(i, col)
        high = fk.mesh_object(b['name'] + '_high', verts, faces, col, attrs)
        high.data.shade_smooth()
        H = verts[:, 1].max()
        high.data.materials.append(stone_material('stone_' + b['name'], ROCK_STYLE[b['name']], H,
                                                  rock_axes(rock, rock.layers['normal'])
                                                  if rock.layers else None))
        low = fk.decimated(high, b['name'], budget, col, voxel=0.012)
        refit(low, high, b['aspect'])
        assert fk.is_closed(low), b['name'] + ' is not a closed solid'
        low['rock'] = b['rock']
        low['aspect'] = b['aspect']
        low['sink'] = b['sink']
        log(f"{b['name']}: {tris(low)} triangles, {time.time() - t:.0f}s")
        pairs.append((high, low))
    texture = os.path.join(tmp or bpy.app.tempdir, 'alpine-boulders.webp')

    def sink_of(low):
        return vertices(low)[:, 2].max() * low['sink'] * 0.8
    lows = bake_family(pairs, atlas, samples, 0.035, 0.10, texture, quality, sink_of)
    fk.dress(lows, texture, 'alpineBoulders')
    for low in lows:
        fk.finish_normals(low, 55)
    for high, _ in pairs:
        high.hide_render = True
        high.hide_set(True)
    path = os.path.join(out_dir, 'alpine-boulders.glb')
    size = fk.export_glb(lows, path)
    log(f'wrote {path}: {size / 1024:.0f} KB')
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        for low in lows:
            H = vertices(low)[:, 2].max()
            fk.portrait(low, os.path.join(preview_dir, low.name + '.png'), sink=H * low['sink'])
    return lows


def build_crags(out_dir, preview_dir=None, tmp=None, atlas=2048, samples=32, quality=80, budget=4900):
    col = collection('crags')
    clear_collection(col)
    pairs = []
    for i, c in enumerate(CRAGS):
        t = time.time()
        rock, verts, faces, attrs = build_crag(i, col)
        high = fk.mesh_object(c['name'] + '_high', verts, faces, col, attrs)
        high.data.shade_smooth()
        H = verts[:, 1].max()
        style = CRAG_STYLE[c['name']]
        bed = rock.sets[0][0]
        high.data.materials.append(stone_material('stone_' + c['name'], style, H, rock_axes(rock, bed)))
        low = fk.decimated(high, c['name'], budget, col, voxel=0.05)
        refit(low, high, c['aspect'])
        assert fk.is_closed(low), c['name'] + ' is not a closed solid'
        low['rock'] = c['rock']
        low['aspect'] = c['aspect']
        low['sink'] = CRAG_SINK
        low['faces'] = '+z'
        log(f"{c['name']}: {tris(low)} triangles, {time.time() - t:.0f}s")
        pairs.append((high, low))
    texture = os.path.join(tmp or bpy.app.tempdir, 'alpine-crags.webp')
    lows = [low for _, low in pairs]
    fk.unwrap(lows)
    # The buried foot and the back, which faces the mountain, give their
    # texels to the face the run looks at.
    for low in lows:
        cut = vertices(low)[:, 2].max() * CRAG_SINK * 0.85
        info = {p.index: (p.center.z, p.normal.y) for p in low.data.polygons}
        fk.scale_uv_islands(low, lambda f: 0.35 if info[f.index][0] < cut
                            else (0.55 if info[f.index][1] > 0.5 else 1.0))
    fk.repack(lows)
    t = time.time()
    rgb, _ = fk.bake_atlas(pairs, atlas, samples, 0.18, 0.5)
    log(f'  baked {atlas} atlas in {time.time() - t:.0f}s')
    log(f'  {os.path.basename(texture)}: {fk.save_webp(texture, rgb, quality) / 1024:.0f} KB')
    fk.dress(lows, texture, 'alpineCrags')
    for low in lows:
        fk.finish_normals(low, 55)
    for high, _ in pairs:
        high.hide_render = True
        high.hide_set(True)
    path = os.path.join(out_dir, 'alpine-crags.glb')
    log(f'wrote {path}: {fk.export_glb(lows, path) / 1024:.0f} KB')
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        for low in lows:
            H = vertices(low)[:, 2].max()
            # from the run's side: the face looks down +z, which is Blender's -y
            fk.portrait(low, os.path.join(preview_dir, low.name + '.png'), sink=H * CRAG_SINK,
                        yaw=0.45, elev=0.2, fill=0.74)
    return lows


def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)

    def opt(name, default=None, kind=str):
        return kind(args[args.index(name) + 1]) if name in args else default
    import tempfile
    tmp = tempfile.mkdtemp(prefix='alpen-rocks-')
    out = opt('--out', tmp)
    preview_dir = opt('--preview')
    only = opt('--only')
    atlas = opt('--atlas', 2048, int)
    samples = opt('--samples', 32, int)
    if only in (None, 'boulders'):
        build_boulders(out, preview_dir, tmp, atlas=atlas, samples=samples)
    if only in (None, 'crags'):
        build_crags(out, preview_dir, tmp, atlas=atlas, samples=samples)


if __name__ == '__main__' and '--' in sys.argv:
    main()
