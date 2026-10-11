"""Alpen saplings — the young forest at the edge of the stand, modelled in
Blender with the forest's own kit and photographed into the impostor atlas
the game draws them from (`assets/textures/tree/sapling-impostors.webp`).

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/saplings.py -- --out fun/alpen/assets

Run from the repository root. Rendering is Cycles on the CPU, so it runs in
a sandbox that hides the GPU. It prints the `SAPLINGS` table for
`js/props.js` — each young tree's frame and its three UV rectangles — which
has to be pasted over the old one whenever the atlas is rebuilt.
`--preview <dir>` also renders the six lit, and the atlas as the game sees
it.

They are the four species of `trees.py` — Norway spruce, silver fir, Swiss
stone pine and European larch — built by the same machinery (a `Tree` of
bark tubes and sprig cards cut from `alpine-sprigs.webp`, shaded by the
crown's own occlusion), but grown as young trees, which are not small old
ones:

  * the crown goes to the ground — nothing has shaded the lowest branches
    off yet — and the lowest of them lie on the snow;
  * a young tree is broad for its height: a spruce of two metres is a cone
    as wide as it is tall at its foot, a young fir in the shade of the
    stand wider still, a stone pine a dense narrow column;
  * the cards are sprigs at about life size, not boughs: forty centimetres
    of shoot photographed and drawn at forty centimetres;
  * and each has a young tree's history (`Youth`, the sapling's version of
    the `Growth` the full-grown forest carries): the side its light comes
    from, good and bad years in its whorl spacing, the odd branch broken,
    a stem swept at its foot where the snow creeping downhill bent it — and,
    for one of the spruces, the deer: its leader browsed off year after
    year, so it has gone bushy with three leaders where it should have one.

THE SIX, by slot of `SAPLINGS` (the first three are the shelter species the
placement puts in the stand's lee, the last three the exposed ground's):

  0  spruce_sapling_a   a Norway spruce, 2.4 m
  1  fir_sapling_a      a silver fir in the shade, 1.8 m, level tiers
  2  spruce_sapling_b   a browsed spruce, 1.4 m, bushy, three leaders
  3  pine_sapling_a     a Swiss stone pine, 2.1 m, a dense column
  4  pine_sapling_b     a stone pine of the treeline, 1.3 m, three stems
  5  larch_sapling_a    a European larch, 2.7 m, bare for the winter

THE ATLAS is 1024 × 2048, one sapling per row of 341 px, its three views
(bearings 0°, 60° and 120°, the cards `props.js#saplingCardGeometry`
stands through the trunk) side by side. Each view is an orthographic
photograph across the card, image-right along it, framed from the snow line
to the top of the tree and to the crown's widest reach either side; its
colour is the sprig atlas's own times the baked occlusion — the albedo the
game lights — keyed like the forest's cards, and dilated into the gutter.
"""

import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from riders import B, collection, clear_collection  # noqa: E402
from trees import (  # noqa: E402
    Tree, cell, ASPECT, BARK, SNOW, bend_path, point_on, occlusion, impostor_material, _dilate,
)

TAU = math.tau
UP = Vector((0, 1, 0))


# ---------------------------------------------------------------------------
# A young tree's history
# ---------------------------------------------------------------------------

class Youth:
    """What makes one sapling itself rather than its species: which side
    its light comes from (it reaches further there), a vigour that swells
    and thins up the stem (good years and bad ones, which space its whorls
    unevenly), the odd branch broken by the snow — fewer than an old tree
    loses, and seldom the lowest, which nothing has shaded yet — and the
    sweep at the foot of its stem where the creeping snowpack bent it."""

    def __init__(self, rnd, asym=(0.1, 0.32), gap=(0.02, 0.1), sweep=(0.01, 0.06)):
        self.rnd = rnd
        a = rnd.random() * TAU
        self.light = Vector((math.cos(a), 0, math.sin(a)))
        self.asym = rnd.uniform(*asym)
        self.gap = rnd.uniform(*gap)
        self.sweep = rnd.uniform(*sweep)
        b = a + rnd.uniform(-1.6, 1.6)
        self.down = Vector((math.cos(b), 0, math.sin(b)))   # the way the snow pushed it
        self.waves = [(rnd.uniform(1.0, 2.2), rnd.random() * TAU, rnd.uniform(0.05, 0.12)),
                      (rnd.uniform(3.0, 5.5), rnd.random() * TAU, rnd.uniform(0.03, 0.07))]

    def vigour(self, f):
        return 1.0 + sum(a * math.sin(k * f * TAU + p) for k, p, a in self.waves)

    def reach(self, out, f):
        return self.vigour(f) * (1.0 + self.asym * out.dot(self.light))

    def lost(self, out, f):
        shade = 0.5 - 0.5 * out.dot(self.light)
        return self.rnd.random() < self.gap * (0.4 + shade) * (0.4 + f)

    def heights(self, n, lo, hi, power=1.0):
        steps = [self.rnd.uniform(0.6, 1.4) for _ in range(n)]
        total = sum(steps[:-1]) or 1.0
        acc, out = 0.0, []
        for i in range(n):
            out.append(lo + (hi - lo) * min(1.0, acc / total) ** power)
            acc += steps[i]
        return out

    def stem(self, H, lean=0.02, base=Vector()):
        """The stem as a function of height: swept at its foot downhill and
        straightening above, with a slight lean towards its light."""
        sw = self.down * (H * self.sweep)
        ln = self.light * (H * lean)

        def at(y):
            f = max(0.0, y / H)
            p = base + sw * (1 - math.exp(-f / 0.14)) + ln * (f * f)
            return Vector((p.x, y, p.z))
        return at


def stem_tube(t, at, H, r0, bark, top=None, sides=5):
    """A sapling's stem, from under the snow line to `top`, tapering to a
    twig at the leader."""
    top = H if top is None else top
    ys = [-0.25, 0.0, top * 0.2, top * 0.45, top * 0.7, top * 0.88, top]
    radii = [max(0.004, r0 * (1.0 - max(0.0, y) / (top * 1.04)) ** 0.9) for y in ys]
    t.tube([at(y) for y in ys], radii, sides, bark, v_per_m=1.0 / (r0 * TAU * 3.0))


def leader(t, at, y0, H, species, rnd, n=3, size=0.32):
    """The leader's tuft: a few sprigs standing round the top of the stem,
    the tallest reaching the tree's height."""
    for k in range(n):
        a = k * 2.4 + rnd.random() * 0.6
        o = Vector((math.cos(a), 0, math.sin(a)))
        L = size * (1.0 - 0.18 * k)
        base = at(H - L * 0.98 - 0.02 * k)
        d = (UP + o * (0.12 + 0.1 * k)).normalized()
        t.card(base, d, o.cross(UP), L * ASPECT * 0.8, L, cell(species, k % 2), out=o + UP)


def sprig(L, rnd, k=1.0):
    return L * k * rnd.uniform(0.88, 1.12)


def roll(face, tan, a):
    """`face` turned about the branch by `a` radians towards `tan`."""
    return face * math.cos(a) + tan * math.sin(a)


def dress(t, species, root, path, out, L, rnd, loaded, flat=False, sides=2, curtain=False):
    """Clothe one branch in sprigs at about life size.

    A sprig card held level is a line from the side, and the side is where
    a sapling is photographed from and seen from, so nothing here is level:
    the spray along the branch is folded down its spine, a second one is
    turned up the branch's flank, and the side shoots fan out at every
    tilt a real shoot holds. `flat` is the fir's way — two-ranked plates,
    tilted but never crossed. `curtain` hangs a shoot under the branch."""
    tip, _ = point_on(path, 1.0)
    along = (tip - root).normalized()
    tan = UP.cross(out).normalized()
    face = along.cross(tan)
    if face.y < 0:
        face = -face
    s = min(L * 1.02, sprig(L, rnd, 0.98))
    w = 1.12 if flat else 1.0
    t.card(root, along, roll(face, tan, rnd.uniform(-0.35, 0.35)), s * ASPECT * w, s,
           cell(species, rnd.randrange(2)), fold=0.18 if flat else 0.4, out=out + UP * 0.7,
           snow=rnd.random() < loaded)
    if not flat:
        a = rnd.choice((-1, 1)) * rnd.uniform(0.7, 1.25)
        t.card(root + along * L * 0.08, along, roll(face, tan, a), s * ASPECT * 0.8, s * 0.9,
               cell(species, rnd.randrange(2)), out=out)
    for c in range(sides):
        sgn = 1 if (c % 2) else -1
        p, _ = point_on(path, min(0.85, 0.3 + 0.5 * c / max(1, sides - 1) + rnd.uniform(-0.06, 0.06)))
        sd = (along + tan * sgn * rnd.uniform(0.55, 1.0) + UP * rnd.uniform(-0.12, 0.3)).normalized()
        ss = min(L * 0.75, sprig(L, rnd, 0.55))
        if flat:
            tilt = UP + tan * sgn * rnd.uniform(0.15, 0.6) + out * rnd.uniform(0.05, 0.45)
        else:
            tilt = roll(UP, tan * sgn, rnd.uniform(-0.2, 1.2))
        t.card(p - sd * ss * 0.08, sd, tilt, ss * ASPECT, ss, cell(species, rnd.randrange(2)),
               out=out + UP * 0.6, snow=rnd.random() < loaded * 0.7)
    if curtain:
        p, _ = point_on(path, rnd.uniform(0.45, 0.7))
        ss = min(L * 0.7, sprig(L, rnd, 0.5))
        t.card(p + UP * 0.02, (-UP + out * rnd.uniform(0.3, 0.6)).normalized(),
               out + tan * rnd.uniform(-0.4, 0.4), ss * ASPECT * 0.9, ss, cell(species, rnd.randrange(2)),
               out=out)


def branch_len(R, g, out, f, rnd):
    return R * min(1.15, max(0.72, rnd.uniform(0.86, 1.08) * g.reach(out, f)))


# ---------------------------------------------------------------------------
# The species, young
# ---------------------------------------------------------------------------

def young_spruce(seed, H, browsed=False):
    """A young Norway spruce: a cone to the ground, whorls of five or six
    branches level or a little raised and turned up at their tips, the
    shoots on them going every way (a spruce's foliage is a bottle-brush),
    short shoots between the whorls and, low down, second-order shoots
    hanging from the branches. Browsed, its leader has been eaten back so
    often that three side shoots have turned up to replace it, and it has
    gone bushy and broad."""
    rnd = random.Random(seed)
    g = Youth(rnd)
    t = Tree()
    at = g.stem(H)
    r0 = 0.008 * H + 0.007
    tops = []
    if browsed:
        # the stem stops where it was bitten; three new leaders take over
        stop = H * 0.62
        stem_tube(t, at, H, r0, BARK['spruce'], top=stop)
        for k in range(3):
            a = k / 3 * TAU + rnd.uniform(-0.4, 0.4)
            o = Vector((math.cos(a), 0, math.sin(a)))
            p0 = at(stop - 0.04)
            h_top = H * rnd.uniform(0.86, 1.0)
            pts = [p0, p0 + o * 0.06 + UP * (h_top - stop) * 0.4, p0 + o * 0.1 + UP * (h_top - stop)]
            t.tube(pts, [r0 * 0.35, r0 * 0.25, 0.004], 4, BARK['spruce'])
            tops.append((lambda y, p0=p0, o=o, stop=stop, h=h_top: (
                p0 + o * (0.1 * min(1.0, max(0.0, (y - stop) / max(0.01, h - stop))))
                + UP * max(0.0, y - stop)), h_top))
    else:
        stem_tube(t, at, H, r0, BARK['spruce'])
    base = H * 0.04
    top = H - (0.34 if not browsed else 0.3)
    Rmax = H * (0.3 if not browsed else 0.36)
    whorls = max(7, int(round(H / 0.16)))
    for w, y in enumerate(g.heights(whorls, base, top, 1.2)):
        f = (y - base) / (top - base)
        R = Rmax * (1 - f) ** 0.85 + 0.08
        k = 6 if f < 0.55 else 5
        phase = rnd.random() * TAU
        for b in range(k):
            ang = phase + b / k * TAU + rnd.uniform(-0.4, 0.4)
            out = Vector((math.cos(ang), 0, math.sin(ang)))
            if w > 0 and g.lost(out, f):
                continue
            stem = at if (not browsed or y < H * 0.6) else tops[b % 3][0]
            L = branch_len(R, g, out, f, rnd)
            # the lowest whorl is pressed down onto the snow
            lift = -0.1 if w == 0 else (0.28 * f - 0.04)
            root = stem(y) + out * 0.015
            path = bend_path(root, (out + UP * lift).normalized(), L, 3,
                             droop=0.28 * (1 - f) + (0.2 if w == 0 else 0.0), rise=0.45)
            if L > 0.25:
                t.tube(path[:3], [r0 * 0.22 + 0.004, 0.006, 0.003], 3, BARK['spruce'])
            dress(t, 'spruce', root, path, out, L, rnd, SNOW['spruce'] * (0.3 + 0.45 * (1 - f)),
                  sides=3 if L > 0.4 else 2, curtain=f < 0.6 and L > 0.3)
        # short shoots between this whorl and the next
        if f < 0.85:
            for c in range(3):
                a = rnd.random() * TAU
                o = Vector((math.cos(a), 0, math.sin(a)))
                L = R * rnd.uniform(0.35, 0.55)
                yy = y + rnd.uniform(0.04, 0.1)
                t.card(at(yy), (o + UP * rnd.uniform(0.0, 0.4)).normalized(),
                       roll(UP, o.cross(UP), rnd.uniform(-1.2, 1.2)), L * ASPECT, L,
                       cell('spruce', rnd.randrange(2)), out=o)
    if browsed:
        for stem, h in tops:
            for k in range(3):
                a = rnd.random() * TAU
                o = Vector((math.cos(a), 0, math.sin(a)))
                L = 0.24 - 0.04 * k
                t.card(stem(h - L * 0.95), (UP + o * 0.25).normalized(), o.cross(UP),
                       L * ASPECT * 0.8, L, cell('spruce', k % 2), out=o + UP)
    else:
        leader(t, at, top, H, 'spruce', rnd, n=4, size=0.34)
    return t


def young_fir(seed, H):
    """A young silver fir in the shade of the stand: wide for its height,
    its branches held level in tiers, and the shoots on them spread flat in
    two ranks — a fir is a stack of plates, each a little tilted, its rim
    drooping — under a short leader."""
    rnd = random.Random(seed)
    g = Youth(rnd, asym=(0.08, 0.24))
    t = Tree()
    at = g.stem(H, lean=0.01)
    r0 = 0.009 * H + 0.008
    stem_tube(t, at, H, r0, BARK['fir'])
    base = H * 0.05
    top = H - 0.28
    Rmax = H * 0.38
    whorls = max(6, int(round(H / 0.17)))
    for w, y in enumerate(g.heights(whorls, base, top, 1.15)):
        f = (y - base) / (top - base)
        R = Rmax * (1 - f) ** 0.75 + 0.08
        k = 6 if f < 0.5 else 5
        phase = rnd.random() * TAU
        for b in range(k):
            ang = phase + b / k * TAU + rnd.uniform(-0.3, 0.3)
            out = Vector((math.cos(ang), 0, math.sin(ang)))
            if w > 0 and g.lost(out, f):
                continue
            L = branch_len(R, g, out, f, rnd)
            root = at(y) + out * 0.015
            path = bend_path(root, (out + UP * (0.06 * f - (0.08 if w == 0 else 0.0))).normalized(), L, 3,
                             droop=0.18 * (1 - f), rise=0.12)
            if L > 0.28:
                t.tube(path[:3], [r0 * 0.22 + 0.004, 0.006, 0.003], 3, BARK['fir'])
            dress(t, 'fir', root, path, out, L, rnd, SNOW['fir'] * (0.35 + 0.45 * (1 - f)), flat=True,
                  sides=4 if L > 0.35 else 2)
            # the plate's drooping rim, facing out of the crown
            tip, _ = point_on(path, 1.0)
            ss = min(L * 0.6, sprig(L, rnd, 0.45))
            t.card(tip - (tip - root).normalized() * ss * 0.3 + UP * 0.03,
                   (-UP * rnd.uniform(0.4, 0.8) + out).normalized(), out + UP.cross(out) * rnd.uniform(-0.3, 0.3),
                   ss * ASPECT, ss, cell('fir', rnd.randrange(2)), out=out)
    leader(t, at, top, H, 'fir', rnd, n=3, size=0.3)
    return t


def young_pine(seed, H, stems=1):
    """A young Swiss stone pine: a dense column to the ground, its short
    branches climbing at forty degrees, every one ending in upturned
    brushes of five-needle bundles. At the treeline, three stems from one
    root, broader and lower."""
    rnd = random.Random(seed)
    g = Youth(rnd, asym=(0.12, 0.36), sweep=(0.02, 0.08))
    t = Tree()
    r0 = 0.011 * H + 0.01
    ats = []
    for s in range(stems):
        if stems == 1:
            at = g.stem(H, lean=0.03)
            Hs = H
        else:
            a = s / stems * TAU + rnd.uniform(-0.3, 0.3)
            o = Vector((math.cos(a), 0, math.sin(a)))
            at0 = g.stem(H, lean=0.0, base=o * 0.06)
            spread = rnd.uniform(0.1, 0.2)
            Hs = H * (rnd.uniform(0.8, 0.95) if s else 1.0)

            def at(y, at0=at0, o=o, spread=spread):
                return at0(y) + o * (spread * max(0.0, y))
        stem_tube(t, at, Hs, r0 * (0.8 if stems > 1 else 1.0), BARK['pine'], top=Hs)
        ats.append((at, Hs))
    for at, Hs in ats:
        base = Hs * 0.05
        top = Hs - 0.28
        Rmax = Hs * (0.27 if stems == 1 else 0.22)
        whorls = max(6, int(round(Hs / 0.15)))
        for w, y in enumerate(g.heights(whorls, base, top, 1.1)):
            f = (y - base) / (top - base)
            R = Rmax * (1.0 - 0.72 * f ** 1.4) + 0.06
            phase = rnd.random() * TAU
            for b in range(5):
                ang = phase + b / 5 * TAU + rnd.uniform(-0.45, 0.45)
                out = Vector((math.cos(ang), 0, math.sin(ang)))
                if w > 0 and g.lost(out, f):
                    continue
                L = branch_len(R, g, out, f, rnd)
                climb = (0.55 + 0.45 * f) * rnd.uniform(0.8, 1.2) * (0.7 if w == 0 else 1.0)
                root = at(y) + out * 0.02
                path = bend_path(root, (out + UP * climb).normalized(), L, 3, droop=0.2, rise=0.35)
                t.tube(path[:3], [r0 * 0.25 + 0.004, 0.008, 0.005], 3, BARK['pine'])
                tip, dd = point_on(path, 1.0)
                tan = UP.cross(out).normalized()
                loaded = SNOW['pine'] * (0.3 + 0.45 * (1 - f))
                dress(t, 'pine', root, path, out, L, rnd, loaded, sides=1)
                # the brushes at its end, upturned and crowded
                bs = max(0.2, min(0.36, L * 0.75)) * rnd.uniform(0.9, 1.1)
                for c in range(3):
                    a2 = c / 3 * TAU + rnd.random()
                    spread = out * (0.5 + 0.5 * math.cos(a2)) + tan * math.sin(a2) * 0.9
                    d = (UP * 1.1 + spread * 0.5 + dd * 0.3).normalized()
                    t.card(tip - d * bs * 0.5 + spread * 0.03, d, out + tan * math.sin(a2) * 0.7,
                           bs * ASPECT, bs, cell('pine', rnd.randrange(2)), out=out + UP * 0.4,
                           snow=rnd.random() < loaded * 0.5)
                for c in (0.35, 0.65):
                    mid, _ = point_on(path, c)
                    t.card(mid - UP * bs * 0.3, (UP + out * 0.45 + tan * rnd.uniform(-0.4, 0.4)).normalized(),
                           out + tan * rnd.uniform(-0.6, 0.6), bs * ASPECT * 0.9, bs * 0.85,
                           cell('pine', rnd.randrange(2)), out=out + UP * 0.4)
        leader(t, at, top, Hs, 'pine', rnd, n=4, size=0.3)
    return t


def young_larch(seed, H):
    """A young European larch, bare for the winter: a slender open cone,
    a long leader, thin level branches turned up at their tips, and the
    fine twigs on them that make a larch a grey haze rather than a shape.
    Its branches are its shape, so every one is drawn as wood."""
    rnd = random.Random(seed)
    g = Youth(rnd, asym=(0.12, 0.36), gap=(0.05, 0.12))
    t = Tree()
    at = g.stem(H, lean=0.025)
    r0 = 0.008 * H + 0.008
    stem_tube(t, at, H, r0, BARK['larch'])
    base = H * 0.06
    top = H - 0.4
    Rmax = H * 0.26
    whorls = max(7, int(round(H / 0.2)))
    for w, y in enumerate(g.heights(whorls, base, top, 1.1)):
        f = (y - base) / (top - base)
        R = Rmax * (1 - f) ** 0.8 + 0.06
        k = 4 if f > 0.5 else 5
        phase = rnd.random() * TAU
        for b in range(k):
            ang = phase + b / k * TAU + rnd.uniform(-0.5, 0.5)
            out = Vector((math.cos(ang), 0, math.sin(ang)))
            if g.lost(out, f) or rnd.random() < 0.1:
                continue
            L = branch_len(R, g, out, f, rnd)
            root = at(y) + out * 0.01
            path = bend_path(root, (out + UP * (0.1 + 0.2 * f)).normalized(), L, 4, droop=0.3, rise=0.5)
            t.tube(path[::2], [r0 * 0.2 + 0.004, 0.005, 0.0025], 3, BARK['larch'])
            dress(t, 'larch', root, path, out, L, rnd, SNOW['larch'] * (0.3 + 0.4 * (1 - f)),
                  sides=2 if L > 0.25 else 1, curtain=L > 0.22)
    leader(t, at, top, H, 'larch', rnd, n=2, size=0.4)
    return t


# One sapling per slot of `props.js`'s SAPLINGS table: (name, species,
# exposed-ground, generator). The placement takes 0–2 in the stand's
# shelter and 3–5 on the open, exposed ground (`pine` in the table).
SAPLINGS = [
    ('spruce_sapling_a', 'spruce', False, lambda: young_spruce(3, 2.4)),
    ('fir_sapling_a', 'fir', False, lambda: young_fir(5, 1.8)),
    ('spruce_sapling_b', 'spruce', False, lambda: young_spruce(9, 1.4, browsed=True)),
    ('pine_sapling_a', 'pine', True, lambda: young_pine(13, 2.1)),
    ('pine_sapling_b', 'pine', True, lambda: young_pine(17, 1.3, stems=3)),
    ('larch_sapling_a', 'larch', True, lambda: young_larch(19, 2.7)),
]


# ---------------------------------------------------------------------------
# Meshes, the atlas, the table
# ---------------------------------------------------------------------------

def realise_sapling(name, t, col):
    """The sapling as a Blender mesh carrying UVs into the sprig atlas and
    its occlusion (`_AO`), in Blender's space."""
    H = max(p[1] for p in t.p)
    ao = occlusion(t, H)
    me = bpy.data.meshes.new(name)
    me.from_pydata([B(p) for p in t.p], [], t.tri)
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uv.data[li].uv = t.uv[vi]
    a = me.attributes.new('_AO', 'FLOAT', 'POINT')
    a.data.foreach_set('value', ao)
    me.shade_smooth()
    normals = []
    for o, k in zip(t.out, t.kind):
        n = Vector(o)
        if k:
            n = (n.normalized() + Vector((0, 0.45, 0))).normalized()
        normals.append(B(n.normalized()))
    me.normals_split_custom_set_from_vertices(normals)
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob['height'] = round(H, 4)
    return ob


ATLAS = (1024, 2048)
ROWS = 6
PAD = 6
VIEWS = 3


def frame_of(ob):
    """The frame a sapling is photographed in: its height, and its crown's
    widest reach from the stem's axis — round, since the three views look
    at it from three bearings."""
    H = ob['height']
    reach = max(math.hypot(v.co.x, v.co.y) for v in ob.data.vertices if v.co.z > 0.02)
    return reach * 1.02, H


def layout(frames):
    """Per sapling: pixels per metre, each view's pixel size, its pixel
    rectangles in the atlas (x, y-from-top), and the frame (R, H) those
    pixels exactly hold."""
    W, Hpx = ATLAS
    row_h = Hpx // ROWS
    out = []
    for r, (R, H) in enumerate(frames):
        ppm = (row_h - 2 * PAD) / H
        if VIEWS * 2 * R * ppm + (VIEWS + 1) * PAD > W:
            ppm = (W - (VIEWS + 1) * PAD) / (VIEWS * 2 * R)
        wpx = int(math.floor(2 * R * ppm))
        hpx = int(math.floor(H * ppm))
        rects = [(PAD + k * (wpx + PAD), r * row_h + PAD) for k in range(VIEWS)]
        out.append({'ppm': ppm, 'w': wpx, 'h': hpx, 'rects': rects,
                    'R': wpx / ppm / 2, 'H': hpx / ppm})
    return out


def bake_atlas(obs, sprig_atlas, out_path, tmp_dir):
    """Photograph every sapling from the three bearings its cards stand at
    and pack the views into the atlas; returns the layout."""
    scene = bpy.context.scene
    W, Hpx = ATLAS
    atlas = np.zeros((Hpx, W, 4), dtype=np.float32)
    mat = impostor_material(sprig_atlas)
    cam_data = bpy.data.cameras.new('sapling_cam')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('sapling_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 1
    scene.cycles.transparent_max_bounces = 96
    scene.cycles.filter_width = 1.2
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.resolution_percentage = 100
    frames = [frame_of(ob) for ob in obs]
    lay = layout(frames)
    for i, ob in enumerate(obs):
        old = list(ob.data.materials)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        for o in obs:
            o.hide_render = o is not ob
        L = lay[i]
        R, H = L['R'], L['H']
        scene.render.resolution_x, scene.render.resolution_y = L['w'], L['h']
        cam_data.ortho_scale = max(2 * R, H)
        for k in range(VIEWS):
            phi = k / VIEWS * math.pi
            # the card's image-right is (cos φ, 0, sin φ) in the game, so the
            # camera looks along (sin φ, 0, −cos φ) at the stem
            fwd = Vector(B((math.sin(phi), 0, -math.cos(phi))))
            cam.location = Vector(B((0, H / 2, 0))) - fwd * (R * 4 + 20)
            cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
            path = os.path.join(tmp_dir, '%s_%d.png' % (ob.name, k))
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(path, check_existing=False)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(L['h'], L['w'], 4)
            bpy.data.images.remove(img)
            x, y_top = L['rects'][k]
            y0 = Hpx - y_top - L['h']          # numpy row 0 is the image's bottom
            atlas[y0:y0 + L['h'], x:x + L['w']] = px
        ob.data.materials.clear()
        for m in old:
            ob.data.materials.append(m)
    for o in obs:
        o.hide_render = False
    atlas = _dilate(atlas, steps=10)
    img = bpy.data.images.new('sapling-impostors', W, Hpx, alpha=True)
    img.pixels.foreach_set(atlas.ravel())
    img.file_format = 'WEBP'
    img.save(filepath=out_path, quality=90)
    bpy.data.images.remove(img)
    bpy.data.objects.remove(cam)
    return lay


def table(lay):
    """The `SAPLINGS` table for props.js: frames in metres, view rectangles
    in three's flipY UV space."""
    W, Hpx = ATLAS
    lines = ['const SAPLINGS = [']
    for (name, species, exposed, _), L in zip(SAPLINGS, lay):
        lines.append("  { name: '%s', species: '%s', R: %.4f, H: %.4f, pine: %s, views: ["
                     % (name, species, L['R'], L['H'], 'true' if exposed else 'false'))
        for x, y_top in L['rects']:
            u0, u1 = x / W, (x + L['w']) / W
            v1 = 1 - y_top / Hpx
            v0 = v1 - L['h'] / Hpx
            lines.append('    [%.5f, %.5f, %.5f, %.5f],' % (u0, v0, u1, v1))
        lines.append('  ] },')
    lines.append('];')
    return '\n'.join(lines)


def build():
    col = collection('saplings')
    clear_collection(col)
    obs = []
    for name, species, exposed, make in SAPLINGS:
        t = make()
        ob = realise_sapling(name, t, col)
        R, H = frame_of(ob)
        print('%-18s %-6s H %.2f  R %.2f  %d cards+bark tris' % (name, species, H, R, t.triangles()))
        obs.append(ob)
    return obs


def preview(obs, sprig_atlas, atlas_path, out_dir):
    """The six lit, in a row, and the atlas over a pale grey."""
    from sheet import render_sheet
    os.makedirs(out_dir, exist_ok=True)
    lit = impostor_material(sprig_atlas).copy()
    lit.name = 'saplingLit'
    nt = lit.node_tree
    emit = next(n for n in nt.nodes if n.type == 'EMISSION')
    mix = next(n for n in nt.nodes if n.type == 'MIX_SHADER')
    dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
    nt.links.new(emit.inputs['Color'].links[0].from_socket, dif.inputs['Color'])
    nt.links.new(dif.outputs[0], mix.inputs[2])
    for ob in obs:
        ob.data.materials.clear()
        ob.data.materials.append(lit)
    render_sheet(obs, os.path.join(out_dir, 'saplings.png'), yaw=-18, pitch=8, gap=0.25,
                 background=(0.70, 0.72, 0.75), floor=(0.82, 0.85, 0.9, 1.0))
    img = bpy.data.images.load(atlas_path, check_existing=False)
    W, Hh = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(Hh, W, 4)
    bg = np.array([0.55, 0.58, 0.62], dtype=np.float32)
    rgb = px[..., :3] * px[..., 3:4] + bg * (1 - px[..., 3:4])
    out = bpy.data.images.new('atlas_preview', W, Hh, alpha=False)
    flat = np.concatenate([rgb, np.ones((Hh, W, 1), dtype=np.float32)], axis=2)
    out.pixels.foreach_set(flat.ravel())
    out.file_format = 'PNG'
    out.save(filepath=os.path.join(out_dir, 'sapling-atlas.png'))


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    assets = args[args.index('--out') + 1] if '--out' in args else None
    root = assets or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets')
    tex = os.path.join(root, 'textures', 'tree')
    sprigs = os.path.join(tex, 'alpine-sprigs.webp')
    obs = build()
    atlas_out = os.path.join(tex, 'sapling-impostors.webp') if assets else \
        os.path.join(bpy.app.tempdir, 'sapling-impostors.webp')
    if '--atlas' in args:
        atlas_out = args[args.index('--atlas') + 1]
    if assets or '--atlas' in args:
        cells = os.path.join(bpy.app.tempdir, 'sapling-cells')
        os.makedirs(cells, exist_ok=True)
        lay = bake_atlas(obs, sprigs, atlas_out, cells)
        print(table(lay))
        print('atlas', atlas_out, os.path.getsize(atlas_out))
    if '--preview' in args:
        preview(obs, sprigs, atlas_out, args[args.index('--preview') + 1])
