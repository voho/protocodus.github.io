"""Alpine shrubs and ground patches — the scrub, the dwarf pine and the
plant patches the game strews over the verges, built in Blender.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/shrubs.py -- --out fun/alpen/assets/models/nature

Run from the repository root; writes `alpine-shrubs.glb`, one node per
plant. `--preview <dir>` also renders a contact sheet (Cycles, CPU).

Four of them, each what actually stands out of the snow round the
treeline in January:

  * green alder and willow scrub (Alnus viridis with Salix) — leafless:
    a clump of grey-brown alder stems that the snow has pressed downhill at
    the foot and that rise in an arc from it, forking into finer and redder
    twigs, the alder's winter catkins hanging in threes at a few of the tips
    and its old cones beside them; a few straight red willow wands through
    it; a drift where the stems leave the ground, and the odd lump of snow
    lodged in a low fork;
  * dwarf mountain pine (Pinus mugo, Latschen) — the krummholz itself: a low
    dense mound of dark needles over prostrate stems that creep out along
    the ground and turn up at their ends, every shoot tip an upturned brush
    of needles, paler at the new growth, with pillows of snow lying in the
    hollows on top;
  * a heath patch — what the wind leaves bare on a ridge: low knobbly mats
    of heather, crowberry and trailing azalea, twiggy sprigs out of them, a
    couple of dead grass tufts with their seed heads, and the snow banked in
    their lee;
  * a tussock — one bunch of grass in its winter straw: a crown of old
    thatch and a fountain of fine blades arching out of it, most of them
    lying over on the snow, two culms still standing, and snow lodged in
    the middle.

Built with the riders' kit (`riders.py`) and the flora's small helpers
(`flora.py`), in the game's coordinates: +Y up, the plant's foot at the
origin on the snow line. Sizes follow the procedural shrubs they replace in
`props.js` — their collision hulls are computed from those. Colour is a
role per material, mapped by `SHRUB_LOOKS` in `props.js`, which also says how
much of the flora material's bark grain and procedural snow each role takes.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import riders  # noqa: E402
from riders import Part, loft, sweep, rrect, realise, collection, clear_collection, tris  # noqa: E402
from flora import arc, blade, _toward  # noqa: E402

TAU = math.tau
UP = Vector((0, 1, 0))


def rod(path, r0, r1, role, sides=4, caps=False):
    """A tapering woody stem along a path."""
    return sweep(path, rrect(r0, r0, 1.0, sides), role, up=(1, 0, 0),
                 scale=lambda t: (1 - (1 - r1 / r0) * t, 1 - (1 - r1 / r0) * t), sub=0, caps=caps)


def flat(d):
    return Vector((d.x, 0, d.z)).normalized() if Vector((d.x, 0, d.z)).length > 1e-6 else Vector((1, 0, 0))


def lump(at, rx, rz, h, role, rnd, n=7, wob=0.18):
    """A lump of lying snow: a flattened, irregular dome."""
    ph = rnd.random() * TAU
    return loft([{'y': 0.0, 'rx': rx, 'rz': rz, 'wob': [(wob, 3, ph), (wob * 0.5, 5, ph * 1.7)]},
                 {'y': h * 0.6, 'rx': rx * 0.78, 'rz': rz * 0.78, 'wob': [(wob * 0.8, 3, ph + 0.4)]},
                 {'y': h, 'rx': rx * 0.32, 'rz': rz * 0.32}],
                role, n=n, caps=(False, True), sub=0).xf(pos=tuple(at), rot=(0, rnd.random() * TAU, 0))


# ===========================================================================
# GREEN ALDER AND WILLOW SCRUB
# ===========================================================================

def alder_scrub(rnd):
    parts = []
    # the way the snow has pressed the clump — towards where the procedural
    # scrub's hull (which the game still collides with) sits off the origin
    press = math.atan2(0.13, 0.08) + rnd.uniform(-0.2, 0.2)
    tips = []
    for k in range(10):
        a = press + rnd.uniform(-1.5, 1.5) * (0.6 + 0.4 * rnd.random())
        out = Vector((math.cos(a), 0, math.sin(a)))
        base = out * rnd.uniform(0.02, 0.09) - UP * 0.09
        # leaves the crown low along the ground, then rises: the snow's doing
        d0 = (out + UP * rnd.uniform(0.35, 1.0)).normalized()
        L = rnd.uniform(0.85, 1.2)
        path = arc(base, d0, L, -rnd.uniform(0.5, 0.95), steps=4)
        parts.append(rod(path, rnd.uniform(0.016, 0.02), 0.006, 'alderBark', sides=4))
        tips.append((Vector(path[-1]), (Vector(path[-1]) - Vector(path[-2])).normalized(), 'alderTwig'))
        # two or three side branches off the upper part of the stem
        for j in range(rnd.choice((2, 2, 3))):
            t = rnd.uniform(0.4, 0.85)
            i = min(len(path) - 2, int(t * (len(path) - 1)))
            p = Vector(path[i]).lerp(Vector(path[i + 1]), t * (len(path) - 1) - i)
            dd = (Vector(path[i + 1]) - Vector(path[i])).normalized()
            side = flat(dd).cross(UP) * (1 if j % 2 else -1)
            bd = (dd + side * rnd.uniform(0.5, 0.9) + UP * rnd.uniform(0.1, 0.4)).normalized()
            bl = rnd.uniform(0.22, 0.4) * (1.1 - t * 0.4)
            bpath = arc(p, bd, bl, -0.3, steps=2)
            parts.append(rod(bpath, 0.0075, 0.003, 'alderTwig', sides=3))
            tips.append((Vector(bpath[-1]), (Vector(bpath[-1]) - Vector(bpath[-2])).normalized(), 'alderTwig'))
    # the willow wands: straighter, upright, red
    for k in range(3):
        a = press + math.pi + rnd.uniform(-1.0, 1.0)
        out = Vector((math.cos(a), 0, math.sin(a)))
        base = out * rnd.uniform(0.03, 0.08) - UP * 0.09
        path = arc(base, (UP * 4 + out).normalized(), rnd.uniform(0.85, 1.05), rnd.uniform(0.05, 0.2), steps=3)
        parts.append(rod(path, 0.011, 0.004, 'willowBark', sides=4))
        tips.append((Vector(path[-1]), (Vector(path[-1]) - Vector(path[-2])).normalized(), 'willowBark'))
    # twigs at every tip, forking in two
    catkins = 0
    for p, d, role in tips:
        for s in (-1, 1):
            side = flat(d).cross(UP) * s
            td = (d + side * rnd.uniform(0.35, 0.7) + UP * 0.15).normalized()
            parts.append(rod([tuple(p), tuple(p + td * rnd.uniform(0.09, 0.16))], 0.003, 0.0016,
                             'willowBark' if role == 'willowBark' else 'alderTwig', sides=3))
        # The alder's winter catkins, hanging in threes, and an old cone
        if role == 'alderTwig' and catkins < 5 and rnd.random() < 0.3:
            catkins += 1
            for c in range(3):
                b = c / 3 * TAU + rnd.random()
                hang = (Vector((math.cos(b) * 0.35, -1, math.sin(b) * 0.35))).normalized()
                parts.append(rod([tuple(p), tuple(p + hang * rnd.uniform(0.045, 0.06))], 0.0055, 0.004,
                                 'catkin', sides=3))
            parts.append(loft([{'y': -0.008, 'rx': 0.006}, {'y': 0.008, 'rx': 0.0065}], 'cone', n=4,
                              caps=(True, True), sub=0).xf(pos=tuple(p + UP * 0.012)))
    # the drift round the foot, and a few lumps of snow lodged in low forks
    parts.append(lump(Vector((0, -0.03, 0)) + Vector((math.cos(press), 0, math.sin(press))) * 0.06,
                      0.36, 0.3, 0.15, 'snow', rnd, n=10, wob=0.16))
    for k in range(3):
        a = press + rnd.uniform(-1.2, 1.2)
        o = Vector((math.cos(a), 0, math.sin(a)))
        parts.append(lump(o * rnd.uniform(0.18, 0.3) + UP * rnd.uniform(0.12, 0.24),
                          0.06, 0.045, 0.045, 'snow', rnd, n=5))
    return parts


# ===========================================================================
# DWARF MOUNTAIN PINE
# ===========================================================================

def brush(at, d, L, rnd, r=0.065):
    """An upturned shoot: a bottle-brush of needles, star-sectioned so its
    edge is spikes and pointed at its end, the newest growth at its tip
    paler. Its foot is buried in the mass it grows out of."""
    ph = rnd.random() * TAU
    st = [{'y': 0.0, 'rx': r * 0.7, 'wob': [(0.3, 4, ph)]},
          {'y': L * 0.55, 'rx': r * 1.3, 'wob': [(0.45, 4, ph + 0.6)]},
          {'y': L, 'rx': r * 0.42, 'wob': [(0.4, 4, ph + 1.2)]}]
    part = loft(st, lambda y, a, i: 'pineShoot' if i >= 1 else 'pineNeedle', n=8,
                caps=(False, True), sub=0)
    return part.apply(_toward(Vector(at), Vector(d)))


def mountain_pine(rnd):
    """The thicket is its shoots: a dome of upturned brushes, the outer ones
    lying low where the prostrate stems run out and turn up, the inner ones
    standing, over a dark core that closes the gaps between them."""
    parts = []
    ph = [rnd.random() * TAU for _ in range(4)]
    R, Hc = 0.8, 0.36
    parts.append(loft([{'y': -0.06, 'rx': R, 'rz': R * 0.86, 'wob': [(0.12, 3, ph[0]), (0.07, 5, ph[1])]},
                       {'y': Hc * 0.55, 'rx': R * 0.8, 'rz': R * 0.7, 'wob': [(0.12, 3, ph[0] + 0.3)]},
                       {'y': Hc, 'rx': R * 0.4, 'rz': R * 0.35, 'wob': [(0.1, 2, ph[2])]}],
                      'pineNeedle', n=12, caps=(False, True), sub=0))

    def dome(f):
        return Hc * math.sqrt(max(0.0, 1 - f * f))

    # the brushes: rings from the rim inwards, with their feet in the core
    for ring, (count, f, lift, L) in enumerate(((11, 0.98, 0.45, 0.4), (9, 0.72, 1.1, 0.36),
                                                 (6, 0.42, 2.2, 0.33), (2, 0.1, 4.0, 0.3))):
        off = rnd.random() * TAU
        for k in range(count):
            a = off + k / count * TAU + rnd.uniform(-0.2, 0.2)
            out = Vector((math.cos(a), 0, math.sin(a)))
            ff = f * rnd.uniform(0.9, 1.06)
            at = Vector((out.x * R * ff, dome(min(ff, 0.98)) * 0.85 - 0.04, out.z * R * 0.86 * ff))
            d = (UP * lift * rnd.uniform(0.8, 1.2) + out).normalized()
            parts.append(brush(at, d, L * rnd.uniform(0.85, 1.15), rnd))
    # the prostrate stems where they run out from under the rim
    for k in range(5):
        a = k / 5 * TAU + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), 0, math.sin(a)))
        side = out.cross(UP) * rnd.uniform(-0.15, 0.15)
        parts.append(rod([tuple(out * 0.55 + UP * 0.03), tuple(out * 0.85 + side + UP * 0.05),
                          tuple(out * 1.05 + side * 2 + UP * 0.16)], 0.03, 0.017, 'pineWood', sides=4))
    # snow pillows lying in the hollows on top
    for k in range(4):
        a = k / 4 * TAU + rnd.uniform(-0.4, 0.4)
        f = rnd.uniform(0.2, 0.5)
        out = Vector((math.cos(a), 0, math.sin(a)))
        parts.append(lump(out * (R * f) + UP * (dome(f) + 0.06), rnd.uniform(0.17, 0.24),
                          rnd.uniform(0.12, 0.17), rnd.uniform(0.08, 0.11), 'snow', rnd, n=7))
    return parts


# ===========================================================================
# THE HEATH PATCH
# ===========================================================================

def mat_cushion(at, R, h, role, rnd):
    ph = rnd.random() * TAU
    # a crenellated rim — a mat of dwarf shrub is shoots at its edge, not a
    # rounded stone — and a knobbly top
    return loft([{'y': -0.03, 'rx': R, 'rz': R * 0.82, 'wob': [(0.24, 5, ph), (0.1, 2, ph * 2)]},
                 {'y': h * 0.6, 'rx': R * 0.86, 'rz': R * 0.7, 'wob': [(0.26, 5, ph + 0.6), (0.08, 3, ph)]},
                 {'y': h, 'rx': R * 0.42, 'rz': R * 0.34, 'wob': [(0.2, 3, ph + 1.1)]}],
                role, n=10, caps=(False, True), sub=0).xf(pos=tuple(at), rot=(0, rnd.random() * TAU, 0))


def grass_tuft(at, rnd, blades=5):
    parts = []
    for k in range(blades):
        a = k * 2.39996 + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), 0, math.sin(a)))
        d = (UP * rnd.uniform(1.2, 2.6) + out).normalized()
        parts.append(blade(arc(Vector(at) + out * 0.012 - UP * 0.03, d, rnd.uniform(0.18, 0.32),
                               rnd.uniform(0.7, 1.5), steps=2),
                           rnd.uniform(0.008, 0.012), ('straw', 'strawDark', 'strawPale')[k % 3]))
    return parts


def seed_stalk(at, rnd, H):
    a = rnd.random() * TAU
    out = Vector((math.cos(a), 0, math.sin(a)))
    path = arc(Vector(at) - UP * 0.03, (UP * 5 + out).normalized(), H, rnd.uniform(0.15, 0.4), steps=2)
    tip = Vector(path[-1])
    down = (Vector(path[-2]) - tip).normalized()
    return [rod(path, 0.0035, 0.002, 'straw', sides=3),
            loft([{'y': 0, 'rx': 0.004}, {'y': 0.045, 'rx': 0.011}, {'y': 0.1, 'rx': 0.003}],
                 'seed', n=4, caps=(False, False), sub=0).apply(_toward(tip + down * 0.1, -down))]


def heath_tuft(at, h, r, role, rnd):
    """One dwarf shrub of the heath: a little bush of shoots, widest above
    its foot and gathered to a crown, its outline irregular."""
    ph = rnd.random() * TAU
    lean = Vector((rnd.uniform(-0.25, 0.25), 1, rnd.uniform(-0.25, 0.25))).normalized()
    return loft([{'y': -0.03, 'rx': r * 0.75, 'wob': [(0.25, 3, ph)]},
                 {'y': h * 0.62, 'rx': r, 'rz': r * 0.85, 'wob': [(0.3, 3, ph + 0.9), (0.12, 2, ph)]},
                 {'y': h, 'rx': r * 0.42, 'rz': r * 0.36, 'wob': [(0.3, 2, ph + 2.0)]}],
                role, n=6, caps=(False, True), sub=0).apply(_toward(Vector(at), lean))


def heath_patch(rnd):
    """Mats of dwarf shrub, each a crowd of little bushes rather than one
    cushion: heather, crowberry and trailing azalea."""
    parts = []
    mats = [(0.0, 0.0, 0.34, 0.2, 'heath', 4), (0.45, 0.24, 0.24, 0.14, 'crowberry', 3),
            (-0.4, 0.3, 0.22, 0.11, 'azalea', 2), (-0.12, -0.44, 0.26, 0.17, 'heath', 3)]
    for x, z, R, h, role, n in mats:
        for k in range(n):
            a = k / n * TAU + rnd.uniform(-0.4, 0.4)
            f = 0.0 if k == 0 else rnd.uniform(0.45, 0.85)
            at = Vector((x + math.cos(a) * R * f, 0, z + math.sin(a) * R * f))
            parts.append(heath_tuft(at, h * (1.0 - 0.45 * f) * rnd.uniform(0.85, 1.15),
                                    R * rnd.uniform(0.45, 0.6), role, rnd))
    # a tuft of dead grass at a mat's rim, with its seed head
    parts += grass_tuft((0.36, 0, -0.2), rnd, blades=4)
    parts += seed_stalk((0.36, 0, -0.2), rnd, rnd.uniform(0.32, 0.42))
    # the snow banked in the lee of the mats
    parts.append(lump(Vector((0.1, -0.03, 0.55)), 0.26, 0.15, 0.08, 'snow', rnd, n=6))
    parts.append(lump(Vector((-0.55, -0.03, -0.35)), 0.2, 0.13, 0.06, 'snow', rnd, n=6))
    return parts


# ===========================================================================
# THE TUSSOCK
# ===========================================================================

def tussock(rnd):
    parts = []
    ph = rnd.random() * TAU
    # the crown of old thatch the blades come out of
    parts.append(loft([{'y': -0.05, 'rx': 0.14, 'rz': 0.12, 'wob': [(0.12, 4, ph)]},
                       {'y': 0.03, 'rx': 0.15, 'rz': 0.13, 'wob': [(0.2, 5, ph + 0.5), (0.06, 9, ph)]},
                       {'y': 0.07, 'rx': 0.08, 'rz': 0.07, 'wob': [(0.1, 3, ph)]}],
                      'thatch', n=10, caps=(False, True), sub=0))
    # the fountain: fine blades from the crown's rim, arching out and down,
    # the outer ones lying over on the snow
    for k in range(25):
        a = k * 2.39996 + rnd.uniform(-0.25, 0.25)
        out = Vector((math.cos(a), 0, math.sin(a)))
        inner = rnd.random()
        p0 = out * (0.02 + 0.09 * inner) + UP * 0.03
        d = (UP * (3.2 - 2.2 * inner) + out).normalized()
        L = rnd.uniform(0.27, 0.46)
        bend = rnd.uniform(0.6, 1.5) * (0.45 + 0.8 * inner)
        role = ('straw', 'strawPale', 'straw', 'strawDark')[k % 4]
        # each drawn blade stands for a sheaf of real ones, so it is wide
        parts.append(blade(arc(p0, d, L, bend, steps=2), rnd.uniform(0.016, 0.024), role))
    # two culms still standing, with what is left of their panicles
    for k in range(2):
        parts += seed_stalk((rnd.uniform(-0.04, 0.04), 0.04, rnd.uniform(-0.04, 0.04)), rnd,
                            rnd.uniform(0.4, 0.5))
    # snow lodged in the middle of it
    parts.append(lump(Vector((0.01, 0.07, -0.01)), 0.1, 0.085, 0.05, 'snow', rnd, n=6))
    return parts


# ---------------------------------------------------------------------------
# Build, export, preview
# ---------------------------------------------------------------------------

SHRUBS = [
    ('shrub_alderScrub', alder_scrub, 1500),
    ('shrub_mountainPine', mountain_pine, 1500),
    ('plant_heath', heath_patch, 500),
    ('plant_tussock', tussock, 500),
]

# Preview colours only; the game paints each role from SHRUB_LOOKS.
PALETTE_PREVIEW = {
    'alderBark': '#6d665c', 'alderTwig': '#6a4d3e', 'willowBark': '#7a3d2b', 'catkin': '#6b4b3f',
    'cone': '#3b2b22', 'pineNeedle': '#26402c', 'pineShoot': '#38583a', 'pineWood': '#4b3d33',
    'heath': '#4c4038', 'crowberry': '#27321f', 'azalea': '#55372b',
    'thatch': '#6f6650', 'straw': '#a8915f', 'strawPale': '#c2ae80', 'strawDark': '#7c6a48',
    'seed': '#5a4532', 'snow': '#e8eef8',
}


def build(seed=11):
    riders.PALETTE.update(PALETTE_PREVIEW)
    col = collection('shrubs')
    clear_collection(col)
    out = {}
    for k, (name, make, budget) in enumerate(SHRUBS):
        rnd = random.Random(seed * 131 + k)
        ob = realise(name, make(rnd), col, sharp_deg=70)
        n = tris(ob)
        assert n <= budget, '%s: %d triangles over %d' % (name, n, budget)
        lo = [min(v.co[i] for v in ob.data.vertices) for i in range(3)]
        hi = [max(v.co[i] for v in ob.data.vertices) for i in range(3)]
        ob['height'] = round(hi[2], 4)
        out[name] = ob
        print('%-20s %4d tris  x %.2f..%.2f  y %.2f..%.2f  z %.2f..%.2f'
              % (name, n, lo[0], hi[0], lo[2], hi[2], -hi[1], -lo[1]))
    return out


def export(path):
    col = collection('shrubs')
    bpy.context.view_layer.update()
    for ob in bpy.context.view_layer.objects:
        if ob:
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


def preview(obs, out_dir):
    from sheet import render_sheet
    os.makedirs(out_dir, exist_ok=True)
    render_sheet([obs[n] for n, _, _ in SHRUBS], os.path.join(out_dir, 'shrubs.png'),
                 yaw=-22, pitch=18, gap=0.35)


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    built = build()
    if '--out' in args:
        out = args[args.index('--out') + 1]
        os.makedirs(out, exist_ok=True)
        print(export(os.path.join(out, 'alpine-shrubs.glb')))
    if '--preview' in args:
        preview(built, args[args.index('--preview') + 1])
