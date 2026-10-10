"""Alpine winter flora — the small things that still show above the snow
beside a piste, for decoration only (the game gives them no collision).

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/flora.py -- --out fun/alpen/assets/models/nature

Run from the repository root; writes `alpine-flora.glb`, one node per plant.

Six of them, each a thing you actually see on a ski run in the Alps in
January:

  * seed grass — a tuft of reed grass (Calamagrostis) gone to straw, its
    blades arching out of the snow and a few culms still holding their
    panicles;
  * silver thistle (Carlina acaulis) — the dried rosette lying flat on the
    snow, a ring of silver bracts round a golden disc, the plant people nail
    to their doors up here;
  * umbels — the dead stalks of a tall umbellifer standing out of a drift,
    each spoked head holding a cap of snow;
  * alpenrose (Rhododendron ferrugineum) — an evergreen shrublet, leathery
    dark leaves rusty underneath, mostly under the snow with the tips out;
  * bilberry (Vaccinium myrtillus) — leafless in winter, but its zig-zag
    twigs stay green;
  * juniper (Juniperus communis subsp. nana) — the low dark mat that
    creeps over boulders at the treeline;
  * stones — a few small rocks of the moraine the piste was cut through,
    shouldering out of the snow.

Built with the same kit as the riders (`riders.py`), in the game's
coordinates: +Y up, the plant's foot at the origin on the snow line. Colour
is a role per material, mapped in `props.js`, which also decides how much
of the shared flora snow and bark grain each role takes.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from riders import (  # noqa: E402
    Part, loft, sweep, rrect, realise, collection, clear_collection, tris,
)

TAU = math.tau
UP = Vector((0, 1, 0))


def arc(p0, d0, length, bend, steps=3, bend_axis=None):
    """A gently curving path: leaves p0 along d0 and turns by `bend` radians
    about `bend_axis` (default: the horizontal axis that tips it outwards
    and down) over its length."""
    d = Vector(d0).normalized()
    if bend_axis is None:
        h = Vector((d.x, 0, d.z))
        bend_axis = h.cross(UP).normalized() if h.length > 1e-6 else Vector((1, 0, 0))
    pts = [Vector(p0)]
    for _ in range(steps):
        d = Matrix.Rotation(-bend / steps, 3, bend_axis) @ d
        pts.append(pts[-1] + d * (length / steps))
    return [tuple(p) for p in pts]


def blade(path, w, role, taper=1.0, sub=0):
    """A grass blade or bract: a flat ribbon tapering to a point."""
    return sweep(path, [(w, 0), (0, w * 0.18), (-w, 0)], role, up=UP,
                 scale=lambda t: (max(0.05, 1 - taper * t), max(0.05, 1 - taper * t)), sub=sub)


def stem(path, r0, r1, role, sides=4):
    n = len(path)
    return sweep(path, rrect(r0, r0, 1.0, sides), role, up=(1, 0, 0),
                 scale=lambda t: (1 - (1 - r1 / r0) * t, 1 - (1 - r1 / r0) * t), sub=0)


def seed_grass(rnd):
    parts = []
    for k in range(9):
        a = k * 2.39996 + rnd.uniform(-0.2, 0.2)
        out = Vector((math.cos(a), 0, math.sin(a)))
        d = (UP * rnd.uniform(1.6, 3.2) + out).normalized()
        L = rnd.uniform(0.32, 0.55)
        parts.append(blade(arc(out * 0.02 - UP * 0.04, d, L, rnd.uniform(0.6, 1.3), steps=2),
                           rnd.uniform(0.010, 0.014), 'straw' if k % 4 else 'strawDark'))
    for k in range(3):
        a = rnd.random() * TAU
        out = Vector((math.cos(a), 0, math.sin(a)))
        d = (UP * 5 + out).normalized()
        L = rnd.uniform(0.55, 0.78)
        path = arc(-UP * 0.04, d, L, rnd.uniform(0.15, 0.4), steps=2)
        parts.append(stem(path, 0.0035, 0.002, 'straw'))
        # the panicle: a narrow spindle of seed along the culm's last fifth
        tip = Vector(path[-1])
        down = (Vector(path[-2]) - tip).normalized()
        parts.append(loft([{'y': 0, 'rx': 0.004}, {'y': 0.06, 'rx': 0.013},
                           {'y': 0.15, 'rx': 0.003}], 'seed', n=4, sub=0)
                     .xf(rot=(0, 0, 0)).apply(_toward(tip + down * 0.15, -down)))
    return parts


def _toward(origin, direction):
    """A frame at `origin` whose +Y runs along `direction`."""
    y = Vector(direction).normalized()
    x = Vector((1, 0, 0)) if abs(y.x) < 0.9 else Vector((0, 0, 1))
    x = (x - y * x.dot(y)).normalized()
    z = x.cross(y)
    return Matrix(((x.x, y.x, z.x, origin[0]), (x.y, y.y, z.y, origin[1]),
                   (x.z, y.z, z.z, origin[2]), (0, 0, 0, 1)))


def silver_thistle(rnd):
    """Drawn half again life size: at fifteen centimetres a silver thistle
    is lost against the snow from a moving board."""
    parts = []
    # the golden disc of florets, domed
    parts.append(loft([{'y': -0.02, 'rx': 0.035}, {'y': 0.012, 'rx': 0.040},
                       {'y': 0.026, 'rx': 0.028}], 'disc', n=10, dome=(0, 0.012), sub=0))
    # two rings of silver bracts, radiating flat and turned up a little
    for ring, (count, L, lift) in enumerate(((12, 0.085, 0.25), (8, 0.06, 0.45))):
        for k in range(count):
            a = (k + ring * 0.5) / count * TAU
            out = Vector((math.cos(a), 0, math.sin(a)))
            p0 = out * 0.034 + UP * (0.012 + ring * 0.006)
            d = (out + UP * lift).normalized()
            parts.append(blade(arc(p0, d, L * rnd.uniform(0.9, 1.1), -0.25, steps=1), 0.009, 'bract'))
    # the spiny dead leaves of the rosette under it
    for k in range(5):
        a = k / 5 * TAU + 0.3
        out = Vector((math.cos(a), 0, math.sin(a)))
        parts.append(blade(arc(out * 0.03, out + UP * 0.05, rnd.uniform(0.11, 0.15), -0.1, steps=1),
                           0.016, 'stalk'))
    for p in parts:
        p.xf(scale=(1.6, 1.6, 1.6))
    return parts


def umbels(rnd):
    """Two or three dead umbellifer stalks, each spoked head capped with snow."""
    parts = []
    for k in range(rnd.choice((2, 3))):
        a = rnd.random() * TAU
        out = Vector((math.cos(a), 0, math.sin(a)))
        H = rnd.uniform(0.55, 0.95)
        base = out * rnd.uniform(0.0, 0.08) - UP * 0.05
        path = arc(base, (UP * 6 + out).normalized(), H, rnd.uniform(0.1, 0.35), steps=2)
        parts.append(stem(path, 0.009, 0.006, 'stalk', sides=4))
        top = Vector(path[-1])
        rays = 5
        ends = []
        for r in range(rays):
            b = r / rays * TAU
            o = Vector((math.cos(b), 0, math.sin(b)))
            e = top + o * 0.075 + UP * 0.055
            ends.append(e)
            parts.append(stem([tuple(top), tuple(e)], 0.003, 0.002, 'stalk', sides=3))
        # each ray ends in a little cluster of dried fruit
        for e in ends:
            parts.append(loft([{'y': -0.008, 'rx': 0.012}, {'y': 0.004, 'rx': 0.013}],
                              'seed', n=3, sub=0).xf(pos=tuple(e)))
        # and the snow the head has caught
        parts.append(loft([{'y': 0.0, 'rx': 0.078, 'rz': 0.072}, {'y': 0.014, 'rx': 0.072, 'rz': 0.066}],
                          'snowcap', n=8, dome=(0, 0.026), sub=0)
                     .xf(pos=(top.x, top.y + 0.058, top.z)))
    return parts


def alpenrose(rnd):
    """Woody stems branching from under the snow, each tip holding a whorl of
    leathery leaves: dark above, rust beneath."""
    parts = []
    for k in range(5):
        a = k / 5 * TAU + rnd.uniform(-0.4, 0.4)
        out = Vector((math.cos(a), 0, math.sin(a)))
        path = arc(-UP * 0.08, (UP * 1.2 + out).normalized(), rnd.uniform(0.22, 0.38), -0.3, steps=2)
        parts.append(stem(path, 0.011, 0.007, 'twig', sides=4))
        tip = Vector(path[-1])
        for j in range(4):
            b = j / 4 * TAU + rnd.random()
            o = Vector((math.cos(b), 0, math.sin(b)))
            d = (o + UP * 0.45).normalized()
            L = rnd.uniform(0.08, 0.11)
            leaf = sweep([tuple(tip), tuple(tip + d * L * 0.5), tuple(tip + d * L)],
                         [(0.017, 0), (0, 0.004), (-0.017, 0)], 'leaf', up=UP,
                         scale=lambda t: (0.25 + 0.75 * math.sin(math.pi * min(1, t * 0.9 + 0.05)),
                                          0.6 + 0.4 * math.sin(math.pi * t)), sub=0)
            # the rusty underside: the face looking down, closing the profile
            leaf.mats = ['leafRust' if i % 3 == 2 else 'leaf' for i in range(len(leaf.faces))]
            parts.append(leaf)
    return parts


def bilberry(rnd):
    """Leafless zig-zag twigs, green right through the winter."""
    parts = []
    for k in range(5):
        a = k / 5 * TAU + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), 0, math.sin(a)))
        p = Vector((0, -0.06, 0)) + out * 0.02
        d = (UP * 2.2 + out).normalized()
        pts = [p]
        for s in range(4):
            d = (Matrix.Rotation(rnd.choice((-1, 1)) * 0.45, 3, UP.cross(out).normalized()
                                 if s % 2 else out.cross(UP).normalized()) @ d).normalized()
            pts.append(pts[-1] + d * rnd.uniform(0.06, 0.09))
            if s >= 1:
                side = (d + out * rnd.uniform(-0.8, 0.8) + UP * 0.3).normalized()
                parts.append(stem([tuple(pts[-1]), tuple(pts[-1] + side * rnd.uniform(0.05, 0.08))],
                                  0.0042, 0.0028, 'twigGreen', sides=3))
        parts.append(stem([tuple(q) for q in pts], 0.006, 0.0038, 'twigGreen', sides=3))
    return parts


def juniper(rnd):
    """A low dark mat, lumps of foliage run together and pressed flat."""
    st = []
    rings = 6
    for i in range(rings):
        y = -0.05 + i * 0.05
        f = i / (rings - 1)
        r = 0.48 * math.sqrt(max(0.0, 1 - f * f * 0.92))
        st.append({'y': y, 'rx': r, 'rz': r * 0.8,
                   'wob': [(0.18, 3, rnd.random() * TAU), (0.1, 5, rnd.random() * TAU)]})
    return [loft(st, 'juniper', n=16, dome=(0, 0.06), sub=1)]


def stones(rnd):
    """Three to five small stones, partly buried: lumpy rounded blocks of
    the same grey as the moraine, the biggest knee-high at most."""
    parts = []
    count = rnd.choice((3, 4, 5))
    for k in range(count):
        a = k / count * TAU + rnd.uniform(-0.5, 0.5)
        r = rnd.uniform(0.08, 0.24) if k else rnd.uniform(0.22, 0.34)
        at = Vector((math.cos(a), 0, math.sin(a))) * (0 if k == 0 else rnd.uniform(0.25, 0.55))
        st = [{'y': -r * 0.5, 'rx': r * 0.95, 'rz': r * 0.8, 'rnd': 0.75,
               'wob': [(0.12, 3, rnd.random() * TAU)]},
              {'y': r * 0.15, 'rx': r, 'rz': r * 0.85, 'rnd': 0.7,
               'wob': [(0.15, 2, rnd.random() * TAU), (0.08, 5, rnd.random() * TAU)]},
              {'y': r * 0.55, 'rx': r * 0.7, 'rz': r * 0.6, 'rnd': 0.8,
               'wob': [(0.1, 3, rnd.random() * TAU)]}]
        parts.append(loft(st, 'stone', n=7, dome=(0, r * 0.25), sub=1)
                     .xf(pos=(at.x, -r * 0.2, at.z), rot=(rnd.uniform(-0.2, 0.2), rnd.random() * TAU, 0)))
    return parts


def grass_tuft(rnd):
    """The ground cover's grass: the seed grass with half the blades and one
    culm, drawn in its hundreds along the run."""
    parts = []
    for k in range(5):
        a = k * 2.39996 + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), 0, math.sin(a)))
        d = (UP * rnd.uniform(1.4, 3.0) + out).normalized()
        parts.append(blade(arc(out * 0.015 - UP * 0.04, d, rnd.uniform(0.3, 0.52), rnd.uniform(0.6, 1.4), steps=2),
                           rnd.uniform(0.018, 0.024), 'straw' if k % 3 else 'strawDark'))
    a = rnd.random() * TAU
    out = Vector((math.cos(a), 0, math.sin(a)))
    path = arc(-UP * 0.04, (UP * 5 + out).normalized(), rnd.uniform(0.45, 0.6), rnd.uniform(0.2, 0.45), steps=2)
    parts.append(stem(path, 0.0045, 0.003, 'straw', sides=3))
    tip = Vector(path[-1])
    down = (Vector(path[-2]) - tip).normalized()
    parts.append(loft([{'y': 0, 'rx': 0.004}, {'y': 0.06, 'rx': 0.012}, {'y': 0.14, 'rx': 0.003}],
                      'seed', n=4, sub=0).apply(_toward(tip + down * 0.14, -down)))
    return parts


def bilberry_sprig(rnd):
    """The ground cover's bilberry: three green zig-zag twigs."""
    parts = []
    for k in range(3):
        a = k / 3 * TAU + rnd.uniform(-0.4, 0.4)
        out = Vector((math.cos(a), 0, math.sin(a)))
        p = Vector((0, -0.05, 0)) + out * 0.02
        d = (UP * 2.0 + out).normalized()
        pts = [p]
        for s_ in range(3):
            d = (Matrix.Rotation(rnd.choice((-1, 1)) * 0.45, 3, out.cross(UP).normalized()
                                 if s_ % 2 else UP.cross(out).normalized()) @ d).normalized()
            pts.append(pts[-1] + d * rnd.uniform(0.06, 0.09))
        parts.append(stem([tuple(q) for q in pts], 0.006, 0.0038, 'twigGreen', sides=3))
        side = (d + out * 0.6 + UP * 0.3).normalized()
        parts.append(stem([tuple(pts[2]), tuple(pts[2] + side * 0.07)], 0.0042, 0.0028, 'twigGreen', sides=3))
    return parts


# Triangles are spent by construction — every part of these is smaller than
# the decimator will touch — except the juniper's smoothed mat.
PLANTS = [
    ('flora_seedGrass', seed_grass, None),
    ('flora_silverThistle', silver_thistle, None),
    ('flora_umbels', umbels, None),
    ('flora_alpenrose', alpenrose, None),
    ('flora_bilberry', bilberry, None),
    ('flora_juniper', juniper, 280),
    ('flora_stones', stones, 260),
    ('flora_grassTuft', grass_tuft, None),
    ('flora_bilberrySprig', bilberry_sprig, None),
]

PALETTE_PREVIEW = {
    'straw': '#b8975f', 'strawDark': '#8e7448', 'seed': '#6e5538', 'stalk': '#6f5640',
    'bract': '#e6e0cc', 'disc': '#a8813f', 'leaf': '#2f4a2a', 'leafRust': '#7a4a2a',
    'twig': '#5a4636', 'twigGreen': '#5f8a3a', 'juniper': '#2b4434', 'snowcap': '#eef3fa',
    'stone': '#7a7570',
}


def build_flora(seed=5):
    import riders
    riders.PALETTE.update(PALETTE_PREVIEW)
    col = collection('flora')
    clear_collection(col)
    out = {}
    for k, (name, make, budget) in enumerate(PLANTS):
        rnd = random.Random(seed * 97 + k)
        ob = realise(name, make(rnd), col, budget=budget)
        lo = min(v.co.z for v in ob.data.vertices)
        hi = max(v.co.z for v in ob.data.vertices)
        reach = max(math.hypot(v.co.x, v.co.y) for v in ob.data.vertices)
        ob['height'] = round(hi, 4)
        ob['radius'] = round(reach, 4)
        out[name] = ob
    return out


def export_flora(path):
    col = collection('flora')
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in col.objects:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=False,
        export_materials='EXPORT', export_extras=True, export_animations=False,
        export_skins=False, export_morph=False, export_cameras=False, export_lights=False,
    )
    return os.path.getsize(path)


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    build_flora()
    if '--out' in args:
        print(export_flora(os.path.join(args[args.index('--out') + 1], 'alpine-flora.glb')))
