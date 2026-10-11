"""Alpine trees — four species the way they actually grow above 1500 m.

Built in Blender from skeletons, dressed in cards cut from the sprigs that
`sprigs.py` modelled and photographed, shaded by their own canopy (ambient
occlusion found by casting rays through the finished tree), and written to
`assets/models/nature/alpine-trees.glb` for the forest pools in `props.js`.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/trees.py -- --out fun/alpen/assets

Run from the repository root. That rebuilds the atlas
(`textures/tree/alpine-sprigs.webp`) and the trees together, since the
cards' UVs point into the atlas.

THE FOUR, and what makes each one itself at a glance:

  * Norway spruce (Picea abies). The tree of the Alps. Subalpine spruce is
    narrow — a spire, so the snow slides off — with a straight leader, the
    main branches level or a little dropped and turned up at the tips, and
    the second-order shoots hanging from them in curtains. The curtains are
    the whole read: cards hang off the boughs, not along them.
  * Silver fir (Abies alba). Broader and more regular: branches in level
    tiers with flat sprays spread horizontally, and an old tree's top
    flattens into a "stork's nest" where the leader gave up.
  * Swiss stone pine (Pinus cembra). The treeline tree. Dense, columnar to
    ovoid with a rounded top, often forked into several leaders, branches
    to the ground; its foliage is held in upturned brushes at the ends of
    stout branches.
  * European larch (Larix decidua). The one that is bare in winter: an
    open cone of level branches with long twigs drooping from them, grey
    against the snow.

Coordinates are the game's (+Y up; see `riders.py`), and every tree stands
at the origin with its height normalised the way `props.js` expects.
"""

import bpy
import bmesh
import math
import os
import random
import sys

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from riders import B, Part, loft, realise, collection, clear_collection, tris  # noqa: E402

TAU = math.tau


# ---------------------------------------------------------------------------
# A tree as triangles: positions, UVs into the atlas, and what each corner
# is — bark or foliage, and which sprig. Built in three.js space.
# ---------------------------------------------------------------------------

class Tree:
    def __init__(self):
        self.p = []      # positions
        self.uv = []
        self.kind = []   # 0 bark, 1 foliage, per vertex
        self.out = []    # an outward hint per vertex, for the occlusion rays
        self.tri = []

    def _v(self, p, uv, kind, out):
        self.p.append(tuple(p))
        self.uv.append(tuple(uv))
        self.kind.append(kind)
        self.out.append(tuple(out))
        return len(self.p) - 1

    def card(self, root, along, face, width, length, cell, fold=0.0, out=None, snow=False):
        """A sprig card: its stem at `root`, growing `length` along `along`,
        `width` across, facing `face`. `fold` creases it down its spine into
        a shallow V so a crown has thickness from the side. Its UVs are the
        cell's rectangle, stem at the low v."""
        along = Vector(along).normalized()
        face = Vector(face)
        face = (face - along * face.dot(along)).normalized()
        side = along.cross(face).normalized()
        root = Vector(root)
        u0, v0, u1, v1 = cell
        if snow:
            # the snow-loaded twin of the same sprig, half an atlas below
            v0, v1 = v0 - FROST_DROP, v1 - FROST_DROP
        kind = 2 if snow else 1
        um = (u0 + u1) / 2
        hw = width / 2
        lift = face * (hw * fold)
        o = Vector(out) if out is not None else face
        tip = root + along * length
        if not fold:
            a = self._v(root - side * hw, (u0, v0), kind, o)
            b = self._v(root + side * hw, (u1, v0), kind, o)
            c = self._v(tip + side * hw, (u1, v1), kind, o)
            d = self._v(tip - side * hw, (u0, v1), kind, o)
            self.tri += [(a, b, c), (a, c, d)]
            return
        a = self._v(root - side * hw + lift, (u0, v0), kind, o)
        m0 = self._v(root, (um, v0), kind, o)
        b = self._v(root + side * hw + lift, (u1, v0), kind, o)
        c = self._v(tip + side * hw + lift, (u1, v1), kind, o)
        m1 = self._v(tip, (um, v1), kind, o)
        d = self._v(tip - side * hw + lift, (u0, v1), kind, o)
        self.tri += [(a, m0, m1), (a, m1, d), (m0, b, c), (m0, c, m1)]

    def tube(self, pts, radii, sides, bark, v_per_m=0.35, flare=None):
        """Bark along a polyline: rings of `sides`, each `radii[i]` across.
        `bark` is the atlas strip (u0, u1, v0, v1); v runs up the trunk."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        rings = []
        dist = 0.0
        for i, p in enumerate(pts):
            if i:
                dist += (pts[i] - pts[i - 1]).length
            d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            s = d.cross(ref).normalized()
            u = s.cross(d).normalized()
            ring = []
            for j in range(sides + 1):
                a = j / sides * TAU
                r = radii[i] * (flare(i, a) if flare else 1.0)
                q = p + (s * math.cos(a) + u * math.sin(a)) * r
                uu = bark[0] + (bark[1] - bark[0]) * j / sides
                vv = bark[2] + ((dist * v_per_m) % 1.0) * (bark[3] - bark[2])
                ring.append(self._v(q, (uu, vv), 0, (s * math.cos(a) + u * math.sin(a))))
            rings.append(ring)
        for i in range(n - 1):
            for j in range(sides):
                a, b = rings[i][j], rings[i][j + 1]
                c, d = rings[i + 1][j + 1], rings[i + 1][j]
                self.tri += [(a, b, c), (a, c, d)]

    def triangles(self):
        return len(self.tri)


def bend_path(p0, d0, length, steps, droop=0.0, rise=0.0):
    """A branch: leaves `p0` along `d0`, sagging by `droop` and turning up
    at its end by `rise` (both radians over its length)."""
    pts = [Vector(p0)]
    d = Vector(d0).normalized()
    horiz = Vector((d.x, 0, d.z))
    axis = horiz.cross(Vector((0, 1, 0))).normalized() if horiz.length > 1e-6 else Vector((1, 0, 0))
    for i in range(steps):
        t = (i + 0.5) / steps
        # a positive turn about horiz × up lifts the branch
        turn = (-droop + rise * (2 * t if t > 0.5 else 0)) / steps
        d = Matrix.Rotation(turn, 3, axis) @ d
        pts.append(pts[-1] + d * (length / steps))
    return pts


def point_on(pts, t):
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    at = t * sum(seg)
    for i, L in enumerate(seg):
        if at <= L or i == len(seg) - 1:
            f = 0 if L == 0 else min(1.0, at / L)
            return pts[i].lerp(pts[i + 1], f), (pts[i + 1] - pts[i]).normalized()
        at -= L
    return pts[-1], (pts[-1] - pts[-2]).normalized()


# ---------------------------------------------------------------------------
# The atlas the cards point into (see sprigs.py#build_atlas), in three.js
# flipY space: v = 0 is the image's bottom row, so a sprig's stem, drawn at
# the bottom of its cell, is at the cell's low v.
# ---------------------------------------------------------------------------

ATLAS_PX = 2048
# The left eighth holds the three bark strips — all of them left of
# u = 0.116, which is where the foliage material starts keying out black.
BARK_COLUMN = 0.125
CELL_W = (1 - BARK_COLUMN) / 4
COLUMNS = {'spruce': 0, 'fir': 1, 'pine': 2, 'larch': 3}
FROST_DROP = 0.5
BARK = {   # u0, u1, v0, v1
    'spruce': (0.003, 0.035, 0.01, 0.99),
    'fir': (0.003, 0.035, 0.01, 0.99),
    'pine': (0.041, 0.073, 0.01, 0.99),
    'larch': (0.079, 0.111, 0.01, 0.99),
}
PAD = 2 / ATLAS_PX


def cell(species, row):
    u0 = BARK_COLUMN + COLUMNS[species] * CELL_W
    v1 = 1.0 - row * 0.25
    return (u0 + PAD, v1 - 0.25 + PAD, u0 + CELL_W - PAD, v1 - PAD)


ASPECT = CELL_W / 0.25   # a card's width over its length, as drawn

# How likely a lying spray is to carry snow, before height raises it. A
# spruce after a week of snowfall is white on every bough that faces the
# sky — the Christmas-card tree of every January photograph — so nearly
# all of them do.
SNOW = {'spruce': 0.95, 'fir': 0.92, 'pine': 0.85, 'larch': 0.5}


# ---------------------------------------------------------------------------
# How a real tree grows: irregularly. Two trees of one species on one slope
# are not one tree twice — the light came from a different side for each,
# they had different good years and bad ones, one lost a branch to a slide
# and the other its top to lightning. That history is what the eye reads as
# "natural" long before it reads the species, so every tree carries one.
# ---------------------------------------------------------------------------

class Growth:
    """One tree's history, as the few numbers that make it itself rather
    than its species: which side the light comes from (the crown is longer
    and fuller there), a vigour that swells and thins up the stem (good
    years and bad ones, which are bulges and waists in the crown), how often
    a branch has been lost, how far up the lower crown has died back, and
    the sweep and wobble of the stem. Built from the tree's own seed."""

    def __init__(self, rnd, asym=(0.10, 0.36), gap=(0.06, 0.22), dead=(0.04, 0.3),
                 sweep=(0.0, 0.045), wobble=(0.0, 0.012)):
        self.rnd = rnd
        a = rnd.random() * TAU
        self.light = Vector((math.cos(a), 0, math.sin(a)))
        self.asym = rnd.uniform(*asym)
        self.gap = rnd.uniform(*gap)
        self.dead = rnd.uniform(*dead)
        self.sweep = rnd.uniform(*sweep)
        self.wobble = rnd.uniform(*wobble)
        self.waves = [(rnd.uniform(1.1, 2.4), rnd.random() * TAU, rnd.uniform(0.07, 0.15)),
                      (rnd.uniform(3.5, 6.5), rnd.random() * TAU, rnd.uniform(0.04, 0.09))]

    def vigour(self, f):
        return 1.0 + sum(a * math.sin(k * f * TAU + p) for k, p, a in self.waves)

    def reach(self, out, f):
        """How long a branch on bearing `out` at height `f` grew."""
        return self.vigour(f) * (1.0 + self.asym * out.dot(self.light))

    def lost(self, out, f):
        """Whether this branch is gone — more often on the shaded side, and
        low in the crown, where the stand's own shade kills them."""
        shade = 0.5 - 0.5 * out.dot(self.light)
        return self.rnd.random() < self.gap * (0.5 + shade) * (1.3 - 0.6 * f)

    def bare(self, f):
        """A dead branch: still on the stem, its needles long gone."""
        if f >= self.dead:
            return False
        return self.rnd.random() < 0.2 + 0.6 * (1 - f / self.dead)

    def heights(self, n, lo, hi, power=1.0):
        """`n` whorl heights from `lo` to `hi`, spaced as the years were good
        or bad rather than evenly."""
        steps = [self.rnd.uniform(0.55, 1.5) for _ in range(n)]
        total = sum(steps[:-1]) or 1.0
        acc, out = 0.0, []
        for i in range(n):
            out.append(lo + (hi - lo) * min(1.0, acc / total) ** power)
            acc += steps[i]
        return out


def stem_line(H, lean, rnd, top=1.0, sweep=0.0, wobble=0.0):
    """The leader and a point on it. It leans a little with height, and a
    tree that grew on a slope has a sweep at its foot — the snow creeping
    downhill bent it as a sapling, and it has been straightening ever since
    — and a gentle wobble where the leader was lost and replaced."""
    yaw = rnd.random() * TAU
    off = Vector((math.cos(yaw), 0, math.sin(yaw))) * (H * lean)
    yaw2 = yaw + rnd.uniform(-1.2, 1.2)
    sw = Vector((math.cos(yaw2), 0, math.sin(yaw2))) * (H * sweep)
    yaw3 = rnd.random() * TAU
    wb = Vector((math.cos(yaw3), 0, math.sin(yaw3))) * (H * wobble)
    phase = rnd.random() * TAU

    def at(y):
        f = max(0.0, y / H)
        bend = off * (f * f) + sw * (1 - math.exp(-f / 0.12)) + wb * (math.sin(f * 3 * math.pi + phase) * f)
        return Vector((bend.x, y, bend.z))
    # the trunk starts well under the snow line: props.js beds every tree by
    # its root ring, and a trunk that stops short of it floats on a slope
    ys = [-1.4, 0.0, H * 0.06, H * 0.2, H * 0.38, H * 0.56, H * 0.72, H * 0.86, H * top]
    return at, [at(y) for y in ys], ys


def root_flare(lobes, amount):
    """Buttress roots: lobes swelling the bottom two rings of the trunk."""
    def f(i, a):
        if i > 2:
            return 1.0
        k = (1.0, 0.55, 0.15)[i]
        return 1.0 + amount * k * max(0.0, math.cos(lobes * a)) ** 2
    return f


def trunk(t, at, pts, ys, H, r0, bark, sides=7, lobes=5):
    radii = []
    for y in ys:
        f = max(0.0, y / H)
        radii.append(max(0.02, r0 * (1.0 - f) ** 1.1 * (1.08 if y < 0 else 1.0)))
    t.tube(pts, radii, sides, bark, v_per_m=1.0 / (r0 * TAU * 2.2), flare=root_flare(lobes, 0.6))


def dead_branch(t, path, r, bark):
    """A branch that died: bark only, thinning to a snapped tip."""
    pts = path[::2]
    radii = [r * (1 - i / max(1, len(pts) - 1)) * 0.9 + 0.006 for i in range(len(pts))]
    t.tube(pts, radii, 3, bark)


def spray(L, k, lo, hi, rnd):
    """How long a card is: a share of the branch it dresses, within bounds.
    A card is a photograph of a forty-centimetre sprig standing in for a
    whole spray of the tree, so it is drawn several times life size."""
    return max(lo, min(hi, k * L)) * rnd.uniform(0.88, 1.14)


def skirt(t, root, along, tan, length, cl, out, snow=False, width=1.0):
    """A card laid along a bough with its width round the crown — the
    surface of a cone, not a shelf. From the side, where a rider sees a
    forest from, a shelf is a line and a skirt is a bough."""
    along = Vector(along).normalized()
    face = along.cross(tan)
    if face.y < 0:
        face = -face
    t.card(root, along, face, length * ASPECT * width, length, cl, out=out, snow=snow)


def bough(t, root, out, slope, L, tan, species, rnd, look, snow_odds, width=1.0):
    """A whole bough as skirts: one if it is short, two overlapping halves if
    it is long. A forty-centimetre sprig photographed onto a four-metre card
    is a fern frond from anywhere near it; split in two it is foliage."""
    along = out * math.cos(slope) - Vector((0, 1, 0)) * math.sin(slope)
    if L <= 2.0:
        skirt(t, root, along, tan, L * 1.1, cell(species, rnd.randrange(2)), look,
              snow=rnd.random() < snow_odds, width=width)
        return along
    skirt(t, root, along, tan, L * 0.62, cell(species, rnd.randrange(2)), look,
          snow=rnd.random() < snow_odds, width=width)
    outer = out * math.cos(slope * 0.85) - Vector((0, 1, 0)) * math.sin(slope * 0.85)
    skirt(t, root + along * L * 0.45 + Vector((0, 0.08, 0)), outer, tan, L * 0.66,
          cell(species, rnd.randrange(2)), look, snow=rnd.random() < snow_odds, width=width)
    return along


def spire(t, at, y, species, n, size, rnd, lean=None):
    """The leader's own tuft: a few cards standing up round the top of the
    stem. `lean` tilts it, for a leader that has turned up off a side
    branch."""
    up = Vector((0, 1, 0))
    for k in range(n):
        a = k * 2.4 + rnd.random() * 0.6
        o = Vector((math.cos(a), 0, math.sin(a)))
        d = (up + o * 0.22 + (lean or Vector())).normalized()
        t.card(at(y + k * 0.35 * size), d, o.cross(up), 0.85 * size * ASPECT, (1.1 - 0.15 * k) * size,
               cell(species, k % 2), out=o)


def crown_top(t, at, H, top_kind, species, r0, rnd):
    """How the tree ends. Most have a leader; an old one may carry a dead
    spike above its living crown, a second leader where the first forked,
    or a new top grown up out of a side branch after the old one broke."""
    up = Vector((0, 1, 0))
    if top_kind == 'leader':
        spire(t, at, H * 0.86, species, 4, 1.0, rnd)
    elif top_kind == 'dead':
        # a grey spike of bare stem standing out of the green
        for k in range(3):
            a = k * 2.2 + rnd.random()
            o = Vector((math.cos(a), 0, math.sin(a)))
            y = H * (0.88 + 0.03 * k)
            dead_branch(t, bend_path(at(y), (o + up * 0.1).normalized(), 0.5 + rnd.random() * 0.4, 2,
                                     droop=0.3), 0.025, BARK[species])
    elif top_kind == 'fork':
        spire(t, at, H * 0.85, species, 3, 0.9, rnd)
        a = rnd.random() * TAU
        o = Vector((math.cos(a), 0, math.sin(a)))
        p0 = at(H * 0.76)
        stem = [p0, p0 + (o * 0.35 + up).normalized() * H * 0.09, p0 + o * H * 0.05 + up * H * 0.17]
        t.tube(stem, [r0 * 0.22 + 0.02, r0 * 0.14 + 0.012, 0.012], 5, BARK[species])
        spire(t, lambda y, b=stem[-1]: b + up * (y - H * 0.86), H * 0.86, species, 3, 0.75, rnd, lean=o * 0.25)
    elif top_kind == 'broken':
        # the old top snapped at the stem's end; a side branch has turned up
        a = rnd.random() * TAU
        o = Vector((math.cos(a), 0, math.sin(a)))
        p0 = at(H * 0.84)
        stem = [p0, p0 + o * H * 0.05 + up * H * 0.03, p0 + o * H * 0.07 + up * H * 0.11]
        t.tube(stem, [r0 * 0.16 + 0.02, r0 * 0.1 + 0.012, 0.01], 5, BARK[species])
        spire(t, lambda y, b=stem[-1]: b + up * (y - H * 0.86), H * 0.86, species, 3, 0.8, rnd, lean=o * 0.35)


def norway_spruce(seed, H=17.0, top_kind='leader', growth=None):
    """The narrow subalpine spire: level boughs turned up at the ends, and
    the curtains of second-order shoots hanging from them."""
    rnd = random.Random(seed)
    g = growth or Growth(rnd)
    t = Tree()
    stem_top = 0.88 if top_kind == 'broken' else (0.96 if top_kind == 'dead' else 1.0)
    at, pts, ys = stem_line(H, 0.012, rnd, top=stem_top, sweep=g.sweep, wobble=g.wobble)
    r0 = 0.008 * H + 0.08
    trunk(t, at, pts, ys, H, r0, BARK['spruce'])
    base = H * rnd.uniform(0.05, 0.12)
    reach = H * rnd.uniform(0.15, 0.175)
    green_top = H * (0.84 if top_kind in ('dead', 'broken') else 0.94)
    up = Vector((0, 1, 0))
    for y in g.heights(20, base, green_top, 0.92):
        f = (y - base) / (H * 0.94 - base)
        R = reach * (1 - f) ** 0.92 + 0.45
        k = 4 if f > 0.6 else 5
        phase = rnd.random() * TAU
        for b in range(k):
            ang = phase + b / k * TAU + rnd.uniform(-0.5, 0.5)
            out = Vector((math.cos(ang), 0, math.sin(ang)))
            if g.lost(out, f):
                continue
            L = R * rnd.uniform(0.8, 1.12) * g.reach(out, f)
            d0 = (out + Vector((0, -0.12 - 0.25 * (1 - f) + rnd.uniform(-0.08, 0.08), 0))).normalized()
            path = bend_path(at(y) + out * 0.05, d0, L, 4, droop=0.35 * (1 - f) * rnd.uniform(0.6, 1.5),
                             rise=0.55 * rnd.uniform(0.6, 1.3))
            if g.bare(f):
                dead_branch(t, bend_path(at(y) + out * 0.05, d0, L * 0.7, 4, droop=0.2), r0 * 0.12 + 0.02,
                            BARK['spruce'])
                continue
            if f < 0.3:
                t.tube(path[:2], [r0 * 0.14 + 0.015, 0.015], 3, BARK['spruce'])
            tan = up.cross(out).normalized()
            loaded = SNOW['spruce'] * (0.7 + 0.3 * f)
            # the bough itself, a skirt from the trunk sloping down the way a
            # snow-loaded subalpine bough does — steeper low in the crown
            slope = 0.32 + 0.38 * (1 - f) + rnd.uniform(-0.12, 0.12)
            root = at(y) + out * 0.15
            along = bough(t, root, out, slope, L, tan, 'spruce', rnd, out + up * 0.6, loaded)
            # the curtains of shoots hanging off it, facing out of the crown:
            # they are the crown's surface from the side
            if f < 0.9:
                for c in range(1 if L < 1.6 else 2):
                    p = root + along * L * (0.55 + 0.4 * c)
                    hang = (-up + out * rnd.uniform(0.15, 0.45)).normalized()
                    face = out + tan * rnd.uniform(-0.45, 0.45)
                    size = spray(L, 0.6, 1.1, 2.2, rnd)
                    t.card(p + up * 0.2, hang, face, size * 0.85 * ASPECT, size,
                           cell('spruce', rnd.randrange(2)), out=out)
    crown_top(t, at, H, top_kind, 'spruce', r0, rnd)
    return t


def silver_fir(seed, H=19.0, nest=False, growth=None):
    """Level tiers of flat sprays, broader than the spruce; an old one's top
    gives up its leader and flattens into a stork's nest."""
    rnd = random.Random(seed)
    g = growth or Growth(rnd, asym=(0.08, 0.28))
    t = Tree()
    top = 0.9 if nest else 1.0
    at, pts, ys = stem_line(H, 0.008, rnd, top=top, sweep=g.sweep * 0.7, wobble=g.wobble)
    r0 = 0.009 * H + 0.09
    trunk(t, at, pts, ys, H, r0, BARK['fir'], lobes=4)
    base = H * rnd.uniform(0.12, 0.2)
    reach = H * rnd.uniform(0.2, 0.23)
    up = Vector((0, 1, 0))
    span = H * top * 0.97 - base
    for y in g.heights(16, base, H * top * 0.97):
        f = (y - base) / span
        if nest:
            R = reach * min(1.0, (1 - f) ** 0.55 * 1.05) + 0.6
        else:
            R = reach * (1 - f) ** 0.8 + 0.45
        k = 4 if f > 0.6 else 5
        phase = rnd.random() * TAU
        for b in range(k):
            ang = phase + b / k * TAU + rnd.uniform(-0.4, 0.4)
            out = Vector((math.cos(ang), 0, math.sin(ang)))
            if g.lost(out, f):
                continue
            L = R * rnd.uniform(0.85, 1.08) * g.reach(out, f)
            rise = 0.25 if not nest or f < 0.8 else 0.7
            path = bend_path(at(y) + out * 0.05, (out + Vector((0, -0.05, 0))).normalized(), L, 4,
                             droop=0.12 * (1 - f) * rnd.uniform(0.5, 1.6), rise=rise)
            if g.bare(f):
                dead_branch(t, path, r0 * 0.12 + 0.02, BARK['fir'])
                continue
            if f < 0.35:
                t.tube(path[:2], [r0 * 0.14 + 0.015, 0.015], 3, BARK['fir'])
            tan = up.cross(out).normalized()
            loaded = SNOW['fir'] * (0.7 + 0.3 * f)
            root = at(y) + out * 0.15
            # a near-level skirt for the tier, sloping a little at its rim
            slope = 0.14 + 0.12 * (1 - f) + rnd.uniform(-0.05, 0.05)
            along = bough(t, root, out, slope, L, tan, 'fir', rnd, out + up * 0.8, loaded)
            if L > 1.6:
                skirt(t, root + along * L * 0.3 + up * 0.18, out * math.cos(slope * 1.8) - up * math.sin(slope * 1.8),
                      tan, min(L * 0.6, 2.0), cell('fir', rnd.randrange(2)), out + up * 0.8,
                      snow=rnd.random() < loaded, width=0.95)
            # the tier's drooping rim, facing out
            size = spray(L, 0.45, 1.0, 2.2, rnd)
            t.card(root + along * L * 0.85 + up * 0.15, (-up + out * 0.5).normalized(),
                   out + tan * rnd.uniform(-0.4, 0.4), size * ASPECT, size,
                   cell('fir', rnd.randrange(2)), out=out)
            # and flat sprays spread off it in a fishbone, tilted so a tier
            # has thickness from the side
            s = spray(L, 0.5, 1.1, 2.6, rnd)
            for c, sgn in ((0.55, -1), (0.8, 1)):
                p, dd = point_on(path, c)
                sd = (dd + tan * sgn * 0.8).normalized()
                tilt = up + out * rnd.uniform(0.2, 0.55) + tan * sgn * rnd.uniform(0.0, 0.3)
                t.card(p - sd * s * 0.3, sd - up * 0.08, tilt, s * ASPECT, s,
                       cell('fir', rnd.randrange(2)), out=out + up * 0.8,
                       snow=rnd.random() < loaded)
    if not nest:
        spire(t, at, H * 0.88, 'fir', 3, 0.9, rnd)
    return t


def stone_pine(seed, H=11.0, leaders=1, flag=0.0, growth=None):
    """The treeline pine: a dense column with a rounded top, branches to the
    ground climbing at forty degrees, foliage in upturned brushes at their
    ends — and, often, two or three leaders where lightning or snow broke
    the first."""
    rnd = random.Random(seed)
    g = growth or Growth(rnd, asym=(0.12, 0.42), gap=(0.04, 0.16), dead=(0.0, 0.15),
                         sweep=(0.01, 0.07), wobble=(0.004, 0.02))
    t = Tree()
    at, pts, ys = stem_line(H, 0.02, rnd, top=0.9, sweep=g.sweep, wobble=g.wobble)
    # Thick for its height — but the pools stand it up to twice as tall, and
    # the trunk grows with it.
    r0 = 0.016 * H + 0.09
    trunk(t, at, pts, ys, H, r0, BARK['pine'], sides=8, lobes=6)
    up = Vector((0, 1, 0))
    stems = [at]
    for k in range(leaders - 1):
        fork = H * rnd.uniform(0.4, 0.62)
        a = rnd.random() * TAU
        o = Vector((math.cos(a), 0, math.sin(a)))
        p0 = at(fork)
        spread = rnd.uniform(0.12, 0.3)
        top = H * rnd.uniform(0.78, 0.95)
        ys2 = [0, (top - fork) * 0.5, top - fork]
        pts2 = [p0 + o * (y * spread) + Vector((0, y, 0)) for y in ys2]
        t.tube(pts2, [r0 * 0.4, r0 * 0.28, 0.04], 6, BARK['pine'])
        stems.append(lambda y, p0=p0, o=o, fork=fork, spread=spread: p0 + o * (max(0, y - fork) * spread)
                     + Vector((0, max(0, y - fork), 0)))
    base = H * 0.03
    for w, y in enumerate(g.heights(14, base, H * 0.9)):
        f = (y - base) / (H * 0.9 - base)
        # ovoid: widest a third of the way up, rounded at the top
        prof = math.sqrt(max(0.0, 1 - ((f - 0.32) / 0.72) ** 2)) if f > 0.32 else 0.86 + 0.14 * f / 0.32
        R = H * 0.25 * prof + 0.4
        stem = stems[w % len(stems)] if f > 0.5 else at
        k = 5
        phase = rnd.random() * TAU
        for b in range(k):
            ang = phase + b / k * TAU + rnd.uniform(-0.5, 0.5)
            out = Vector((math.cos(ang), 0, math.sin(ang)))
            # A flagged tree has lost its windward branches to the wind and
            # the rime: the crown grows on the lee side only.
            if flag and out.x > 0.3 and rnd.random() < flag:
                continue
            if g.lost(out, f):
                continue
            L = R * rnd.uniform(0.74, 1.08) * g.reach(out, f) * (1 + flag * 0.4 * max(0.0, -out.x))
            climb = (0.5 + 0.35 * f) * rnd.uniform(0.7, 1.3)
            path = bend_path(stem(y) + out * 0.08, (out + up * climb).normalized(), L, 3,
                             droop=0.25 * rnd.uniform(0.5, 1.6), rise=0.3)
            if g.bare(f):
                dead_branch(t, path, r0 * 0.15 + 0.02, BARK['pine'])
                continue
            if f < 0.4:
                t.tube(path[:2], [r0 * 0.2 + 0.02, 0.03], 3, BARK['pine'])
            tan = up.cross(out).normalized()
            loaded = SNOW['pine'] * (0.7 + 0.3 * f)
            # the branch's own mass of brushes: a skirt climbing along it
            root = stem(y) + out * 0.15
            tip, dd = point_on(path, 1.0)
            skirt(t, root, tip - root, tan, (tip - root).length * 1.05, cell('pine', rnd.randrange(2)),
                  out + up * 0.5, snow=rnd.random() < loaded)
            # and the upturned brushes at its end, small and many: a stone
            # pine's crown is a dense mass of them, not a few big fans
            s = spray(L, 0.42, 0.9, 1.7, rnd)
            for c in range(3):
                a2 = c / 3 * TAU + rnd.random()
                spread = out * (0.5 + 0.5 * math.cos(a2)) + tan * math.sin(a2) * 0.9
                d = (up * 0.9 + spread * 0.7 + dd * 0.3).normalized()
                face = out + tan * math.sin(a2) * 0.6
                t.card(tip - d * s * 0.5 + spread * 0.15, d, face, s * ASPECT, s,
                       cell('pine', rnd.randrange(2)), out=out + up * 0.4,
                       snow=rnd.random() < loaded)
            mid, _ = point_on(path, 0.55)
            t.card(mid - up * s * 0.3, (up + out * 0.6).normalized(), out + tan * rnd.uniform(-0.4, 0.4),
                   s * ASPECT, s, cell('pine', rnd.randrange(2)), out=out + up * 0.4)
    for k in range(5):
        stem = stems[k % len(stems)]
        a = k / 5 * TAU + rnd.random()
        o = Vector((math.cos(a), 0, math.sin(a)))
        t.card(stem(H * rnd.uniform(0.8, 0.9)) + o * 0.3, (up + o * 0.5).normalized(), o + o.cross(up) * 0.3,
               1.1 * ASPECT, 1.3, cell('pine', k % 2), out=o + up)
    return t


def european_larch(seed, H=18.0, growth=None):
    """Bare for the winter: an open cone of level branches, long twigs
    drooping from them. The branches are the tree, so they are drawn —
    and a larch's are the least regular of the four: long sweeping limbs
    beside short ones, gaps where the snow broke them off."""
    rnd = random.Random(seed)
    g = growth or Growth(rnd, asym=(0.12, 0.4), gap=(0.12, 0.28), dead=(0.0, 0.2),
                         sweep=(0.0, 0.05), wobble=(0.004, 0.018))
    t = Tree()
    at, pts, ys = stem_line(H, 0.015, rnd, sweep=g.sweep, wobble=g.wobble)
    r0 = 0.009 * H + 0.08
    trunk(t, at, pts, ys, H, r0, BARK['larch'], lobes=4)
    up = Vector((0, 1, 0))
    base = H * rnd.uniform(0.15, 0.28)
    reach = H * rnd.uniform(0.17, 0.2)
    for y in g.heights(13, base, H * 0.96):
        f = (y - base) / (H * 0.96 - base)
        R = reach * (1 - f) ** 0.85 + 0.4
        k = 4 if f > 0.6 else 5
        phase = rnd.random() * TAU
        for b in range(k):
            ang = phase + b / k * TAU + rnd.uniform(-0.5, 0.5)
            out = Vector((math.cos(ang), 0, math.sin(ang)))
            if g.lost(out, f):
                continue
            L = R * rnd.uniform(0.7, 1.2) * g.reach(out, f)
            path = bend_path(at(y) + out * 0.05, (out + up * rnd.uniform(-0.05, 0.2)).normalized(), L, 4,
                             droop=0.5 * rnd.uniform(0.6, 1.5), rise=0.35 * rnd.uniform(0.5, 1.4))
            t.tube(path[::2], [r0 * 0.2 * (1 - f) + 0.03, 0.018, 0.008], 3, BARK['larch'])
            if g.bare(f):
                continue
            tan = up.cross(out).normalized()
            root = at(y) + out * 0.15
            # the fine grey haze a bare larch is from any distance: a skirt of
            # twigs along every branch, and long ones hanging from it
            slope = 0.3 + 0.25 * (1 - f) + rnd.uniform(-0.1, 0.1)
            along = bough(t, root, out, slope, L, tan, 'larch', rnd, out + up * 0.5,
                          SNOW['larch'] * (0.7 + 0.3 * f))
            s = spray(L, 0.7, 1.3, 2.4, rnd)
            for c in range(2 if L > 1.5 else 1):
                p, dd = point_on(path, 0.45 + 0.45 * c)
                hang = (-up + out * rnd.uniform(0.2, 0.5)).normalized()
                t.card(p + up * 0.1, hang, out + tan * rnd.uniform(-0.5, 0.5), s * ASPECT, s,
                       cell('larch', rnd.randrange(2)), out=out)
    return t


# Two trees per slot of `props.js`'s SPECIES table — 24, one for each of its
# pools (pool i is slot i % 12; the second dozen read `tree_<slot>_2`). The
# slot names were written for a forest of one spruce in different
# proportions; here each becomes the real tree it stands for, and the mix
# comes out the way a subalpine forest in the Alps actually runs — spruce
# first, stone pine at the edges, fir in the shelter, larch scattered
# through. The second of each pair is the same kind of tree with a
# different history: another light, another top.
SLOTS = [
    ('swissHighPine', 'pine', lambda: stone_pine(61, 11.5)),
    ('toweringAlpineSpruce', 'spruce', lambda: norway_spruce(23, 21.0)),
    ('monarchCathedralPine', 'fir', lambda: silver_fir(53, 23.0, nest=True)),
    ('glacierWhitePine', 'pine', lambda: stone_pine(67, 12.5, leaders=2)),
    ('montaneSilverFir', 'fir', lambda: silver_fir(41, 19.0)),
    ('highAlpineLarch', 'larch', lambda: european_larch(71, 18.0)),
    ('weepingHighSpruce', 'spruce', lambda: norway_spruce(11, 17.0, top_kind='fork')),
    ('crestedRidgePine', 'pine', lambda: stone_pine(73, 10.5, leaders=3)),
    ('stormHighPine', 'pine', lambda: stone_pine(79, 9.0, leaders=1, flag=0.8)),
    ('frostHighPine', 'spruce', lambda: norway_spruce(37, 15.0)),
    ('nobleHighSpruce', 'spruce', lambda: norway_spruce(43, 19.0, top_kind='dead')),
    # not a larch: the game dresses this slot as an evergreen, so it is the
    # tall clear-stemmed timber spruce of a sheltered valley floor
    ('alpineTimberPine', 'spruce', lambda: norway_spruce(83, 22.0)),
    ('swissHighPine_2', 'pine', lambda: stone_pine(161, 10.5, leaders=2)),
    ('toweringAlpineSpruce_2', 'spruce', lambda: norway_spruce(123, 20.0, top_kind='broken')),
    ('monarchCathedralPine_2', 'fir', lambda: silver_fir(153, 21.0)),
    ('glacierWhitePine_2', 'pine', lambda: stone_pine(167, 12.0, leaders=1, flag=0.4)),
    ('montaneSilverFir_2', 'fir', lambda: silver_fir(141, 18.0, nest=True)),
    ('highAlpineLarch_2', 'larch', lambda: european_larch(171, 16.5)),
    ('weepingHighSpruce_2', 'spruce', lambda: norway_spruce(111, 18.0)),
    ('crestedRidgePine_2', 'pine', lambda: stone_pine(173, 11.0, leaders=2)),
    ('stormHighPine_2', 'pine', lambda: stone_pine(179, 8.5, leaders=2, flag=0.6)),
    ('frostHighPine_2', 'spruce', lambda: norway_spruce(137, 14.0, top_kind='fork')),
    ('nobleHighSpruce_2', 'spruce', lambda: norway_spruce(143, 20.0)),
    ('alpineTimberPine_2', 'spruce', lambda: norway_spruce(183, 23.0, top_kind='dead')),
]


# ---------------------------------------------------------------------------
# Shading the crown by itself, and writing it out
# ---------------------------------------------------------------------------

def _hemisphere(n=18):
    """Fixed, roughly cosine-weighted directions about +Y, so the bake is the
    same every run."""
    dirs = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        y = 1 - (i + 0.5) / n
        r = math.sqrt(max(0.0, 1 - y * y))
        a = i * golden
        dirs.append(Vector((math.cos(a) * r, math.sqrt(y), math.sin(a) * r)).normalized())
    return dirs


def occlusion(t, H):
    """How much of the sky each corner sees past the rest of the tree: rays
    cast out of the crown through its own cards and trunk. A card is a
    sprig with daylight through half of it, so a hit counts for a little
    over half; the result is folded with a gentle darkening towards the
    foot, where a forest floor is under more tree than any one tree."""
    bvh = BVHTree.FromPolygons([Vector(p) for p in t.p], t.tri, epsilon=0.0)
    dirs = _hemisphere()
    reach = 0.28 * H
    up = Vector((0, 1, 0))
    ao = []
    for p, o in zip(t.p, t.out):
        p = Vector(p)
        axis = (Vector(o) + up * 0.8).normalized()
        rot = up.rotation_difference(axis)
        hit = 0
        for d in dirs:
            d = rot @ d
            if bvh.ray_cast(p + d * 0.05, d, reach)[0] is not None:
                hit += 1
        occ = hit / len(dirs)
        val = (1.0 - 0.62 * occ) * (0.84 + 0.16 * min(1.0, max(0.0, p.y / H)))
        ao.append(max(0.42, min(1.0, val)))
    return ao


def realise_tree(name, t, H, species, collection):
    """The tree as a Blender mesh carrying everything the forest pools read:
    UVs into the atlas, canopy normals (out of the crown and a little up,
    which is how a card is lit from either side), and two attributes the
    exporter writes as glTF custom attributes — `_AO`, the bake above, and
    `_OWN`, how much of a stand's colour each corner takes (needles 1, snow
    0, bark 0.35)."""
    ao = occlusion(t, H)
    me = bpy.data.meshes.new(name)
    me.from_pydata([B(p) for p in t.p], [], t.tri)
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uv.data[li].uv = t.uv[vi]
    a = me.attributes.new('_AO', 'FLOAT', 'POINT')
    a.data.foreach_set('value', ao)
    own = [(0.35, 1.0, 0.0)[k] for k in t.kind]
    b = me.attributes.new('_OWN', 'FLOAT', 'POINT')
    b.data.foreach_set('value', own)
    me.shade_smooth()
    normals = []
    for o, k in zip(t.out, t.kind):
        n = Vector(o)
        if k:
            n = (n.normalized() + Vector((0, 0.45, 0))).normalized()
        normals.append(B(n.normalized()))
    me.normals_split_custom_set_from_vertices(normals)
    me.materials.append(bpy.data.materials.get('alpineSprigs') or bpy.data.materials.new('alpineSprigs'))
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    top = max(p[1] for p in t.p)
    ob['height'] = round(top, 4)
    ob['species'] = species
    return ob


def build_trees():
    col = collection('trees')
    clear_collection(col)
    out = {}
    for slot, species, make in SLOTS:
        t = make()
        H = max(p[1] for p in t.p)
        out[slot] = realise_tree('tree_' + slot, t, H, species, col)
    return out


def export_trees(path):
    col = collection('trees')
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in col.objects:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True,
        export_materials='PLACEHOLDER', export_attributes=True, export_extras=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False,
    )
    return os.path.getsize(path)


# ---------------------------------------------------------------------------
# Impostors: every tree photographed from three bearings, for the far forest
# ---------------------------------------------------------------------------

IMPOSTOR_PX = (4096, 1024)       # atlas: one column per tree, one row per view
IMPOSTOR_VIEWS = 3               # bearings 0°, 60°, 120° — three crossed cards
IMPOSTOR_ASPECT = 0.5            # a cell's width over its height


def impostor_material(atlas_path):
    """Albedo only — the atlas, keyed the way the game keys it, times the
    baked occlusion — so the game can light the card itself."""
    m = bpy.data.materials.get('impostorBake') or bpy.data.materials.new('impostorBake')
    if hasattr(m, 'use_nodes'):
        m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    img = bpy.data.images.load(atlas_path, check_existing=True)
    img.reload()
    tex.image = img
    tex.interpolation = 'Linear'
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = '_AO'
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mul.inputs[6])
    nt.links.new(attr.outputs['Fac'], mul.inputs[7])
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(mul.outputs[2], emit.inputs['Color'])
    # coverage: the bark strip is solid, everything else keyed off black
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tex.outputs['Color'], sep.inputs[0])
    mx1 = nt.nodes.new('ShaderNodeMath')
    mx1.operation = 'MAXIMUM'
    nt.links.new(sep.outputs[0], mx1.inputs[0])
    nt.links.new(sep.outputs[1], mx1.inputs[1])
    mx2 = nt.nodes.new('ShaderNodeMath')
    mx2.operation = 'MAXIMUM'
    nt.links.new(mx1.outputs[0], mx2.inputs[0])
    nt.links.new(sep.outputs[2], mx2.inputs[1])
    key = nt.nodes.new('ShaderNodeMath')
    key.operation = 'GREATER_THAN'
    key.inputs[1].default_value = 0.035
    nt.links.new(mx2.outputs[0], key.inputs[0])
    uvn = nt.nodes.new('ShaderNodeUVMap')
    sepuv = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uvn.outputs[0], sepuv.inputs[0])
    bark = nt.nodes.new('ShaderNodeMath')
    bark.operation = 'LESS_THAN'
    bark.inputs[1].default_value = 0.116
    nt.links.new(sepuv.outputs[0], bark.inputs[0])
    cover = nt.nodes.new('ShaderNodeMath')
    cover.operation = 'MAXIMUM'
    nt.links.new(key.outputs[0], cover.inputs[0])
    nt.links.new(bark.outputs[0], cover.inputs[1])
    clear = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(cover.outputs[0], mix.inputs[0])
    nt.links.new(clear.outputs[0], mix.inputs[1])
    nt.links.new(emit.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'DITHERED'
    return m


def _dilate(px, steps=12):
    """Bleed colour into the transparent gutter so a mipmapped card does not
    grow a dark rim: each step fills empty texels with the mean of their
    filled neighbours, alpha untouched."""
    rgb = px[..., :3].copy()
    filled = px[..., 3] > 0.02
    for _ in range(steps):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(rgb, (dy, dx), axis=(0, 1)) * m[..., None]
            cnt += m
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    out = px.copy()
    out[..., :3] = rgb
    return out


def bake_impostors(trees, atlas_path, out_path, tmp_dir):
    """One column per tree (in SLOTS order), one row per bearing. Each view is
    an orthographic camera looking horizontally at the trunk from bearing
    k·60°, with image-right along the card that will stand there in the game,
    framed to the tree's height and a half-width of `IMPOSTOR_ASPECT`·height
    (or the crown's own reach, if wider). Returns, per slot, the cell column
    and the frame (`R`, `H`) the card has to be drawn at."""
    import numpy as np  # noqa: F811
    scene = bpy.context.scene
    W, Hpx = IMPOSTOR_PX
    cols = len(trees)
    cw, ch = W // cols, Hpx // IMPOSTOR_VIEWS
    atlas = np.zeros((Hpx, W, 4), dtype=np.float32)
    mat = impostor_material(atlas_path)
    cam_data = bpy.data.cameras.new('impostor_cam')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('impostor_cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.resolution_x, scene.render.resolution_y = cw, ch
    scene.render.resolution_percentage = 100
    frames = {}
    all_obs = list(trees.values())
    for col, (slot, ob) in enumerate(trees.items()):
        old = list(ob.data.materials)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        for o in all_obs:
            o.hide_render = o is not ob
        H = ob['height']
        reach = max(math.hypot(v.co.x, v.co.y) for v in ob.data.vertices if v.co.z > 0.5)
        R = max(H * 0.26, reach * 1.02)
        Hf = 2 * R / IMPOSTOR_ASPECT
        cam_data.ortho_scale = Hf
        for row in range(IMPOSTOR_VIEWS):
            a = row * math.pi / IMPOSTOR_VIEWS
            # three.js bearing a → Blender: the card's normal is (sin a, cos a)
            # in game xz; the camera looks back along it at the trunk
            d = Vector((math.sin(a), -math.cos(a), 0))
            cam.location = Vector((0, 0, Hf / 2 - 0.02 * Hf)) + d * (R * 4 + 50)
            cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
            path = os.path.join(tmp_dir, '%s_%d.png' % (slot, row))
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(path, check_existing=False)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(ch, cw, 4)
            bpy.data.images.remove(img)
            y0 = (IMPOSTOR_VIEWS - 1 - row) * ch      # row 0 at the top
            atlas[y0:y0 + ch, col * cw:(col + 1) * cw] = _dilate(px)
        ob.data.materials.clear()
        for m in old:
            ob.data.materials.append(m)
        frames[slot] = {'col': col, 'R': round(R, 4), 'H': round(Hf - 0.02 * Hf, 4), 'bottom': round(-0.02 * Hf, 4)}
    for o in all_obs:
        o.hide_render = False
    img = bpy.data.images.new('alpine-impostors', W, Hpx, alpha=True)
    img.pixels.foreach_set(atlas.ravel())
    img.file_format = 'WEBP'
    img.save(filepath=out_path, quality=90)
    bpy.data.images.remove(img)
    bpy.data.objects.remove(cam)
    return frames


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    import sprigs
    assets = args[args.index('--out') + 1] if '--out' in args else None
    # A factory-startup session opens on the default cube, camera and lamp,
    # and the cube stands exactly where every sprig is photographed from
    # above. This only ever runs headless, on a throwaway scene.
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    scene = sprigs.stage()
    stems = collection('sprigs')
    if assets:
        tex = os.path.join(assets, 'textures', 'tree')
        sprigs.build_atlas(stems, os.path.join(tex, 'alpine-sprigs.webp'),
                           os.path.join(bpy.app.tempdir, 'sprig-cells'), tex)
    trees = build_trees()
    if assets:
        tex = os.path.join(assets, 'textures', 'tree')
        cells = os.path.join(bpy.app.tempdir, 'impostor-cells')
        os.makedirs(cells, exist_ok=True)
        frames = bake_impostors(trees, os.path.join(tex, 'alpine-sprigs.webp'),
                                os.path.join(tex, 'alpine-impostors.webp'), cells)
        # the frame each impostor was drawn in travels with its tree
        for slot, f in frames.items():
            trees[slot]['impostor'] = [f['col'], f['R'], f['bottom'], f['H']]
        print(export_trees(os.path.join(assets, 'models', 'nature', 'alpine-trees.glb')))
