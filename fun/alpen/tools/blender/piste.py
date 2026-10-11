"""Alpen piste furniture — the race gate panel, the piste marker and the
steel snow bridge, built in Blender.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/piste.py -- --out fun/alpen/assets/models/piste

Run from the repository root; writes `piste-furniture.glb`, one node per
object (`gate_panel`, `waymark`, `snow_bridge`). `--preview <dir>` also
renders a contact sheet of the three with Cycles on the CPU.

THE THREE, and what each is in the real Alps:

  * A giant-slalom gate panel. Two flexible gate poles, each screwed into a
    black spring hinge standing on the auger base drilled into the piste, so
    a racer's shin can knock it flat and it springs back up; a stretched
    panel between them, slid over both poles by a sewn sleeve down each
    side, with stitched hems top and bottom and the printed sponsor field
    across its middle. Every part the race colour is white here, because the
    game tints the instance red or blue; the hinges, the snow and the
    sponsor print keep their own colour (`surfaceOwn` 0, see `GATE_LOOKS` in
    `props.js`).
  * A Swiss piste marker. A fibreglass marker pole in the run's colour with
    reflective white bands under its sign, and on top of it the run sign the
    Swiss resorts put along a numbered run: a square aluminium plate in the
    run's colour with a white border and the run's number, clamped to the
    pole by two brackets and facing up the hill, where the rider comes from.
    Snow lies along its top edge and drifts round the foot of the pole.
  * A steel snow bridge (Stahlschneebrücke), one six-metre section of the
    avalanche defences that stand in rows across the starting zones above
    every Swiss resort. Two H-section girders carry eight horizontal
    I-section grate beams on their uphill face; each girder is propped from
    behind by a tubular strut down to its own footing, and anchored at its
    foot by a tension rod into the slope. The grate stands across the slope,
    leaning a few degrees downhill of the slope's normal as the Swiss
    guidelines set it; the snowpack it holds lies against its uphill face,
    and new snow loads the upper beams.

Coordinates are the game's (+Y up; see `riders.py`). The gate stands its
inner pole on the origin and its outer pole `GATE['width']` along +X, cloth
facing ±Z; the marker stands on the origin with its sign facing +Z; the
snow bridge runs along X (±2.97 m), uphill is +Z and the ground is y = 0 —
the game stands it on the bank's own normal. Colour is a role per material,
mapped in `props.js`.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import riders  # noqa: E402
from riders import Part, loft, sweep, realise, collection, clear_collection, tris  # noqa: E402

TAU = math.tau


# ---------------------------------------------------------------------------
# Small kit: boxes and sheets, in game space
# ---------------------------------------------------------------------------

def box(lo, hi, role, faces='all'):
    """An axis-aligned box from corner `lo` to corner `hi`. `faces` may drop
    sides nobody sees (a plate's front, which is drawn as its own sheet)."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    sides = {
        'back': (0, 3, 2, 1), 'front': (4, 5, 6, 7), 'bottom': (0, 1, 5, 4),
        'top': (3, 7, 6, 2), 'left': (0, 4, 7, 3), 'right': (1, 2, 6, 5),
    }
    keep = sides.keys() if faces == 'all' else faces
    f = [sides[k] for k in keep]
    return Part(v, f, [role] * len(f), sub=0)


def oriented_box(centre, axes, half, role):
    """A box along three orthogonal axes (unit vectors) with half-extents."""
    c = Vector(centre)
    ax = [Vector(a) for a in axes]
    v = []
    for sz in (-1, 1):
        for sy, sx in ((-1, -1), (-1, 1), (1, 1), (1, -1)):
            v.append(tuple(c + ax[0] * (sx * half[0]) + ax[1] * (sy * half[1]) + ax[2] * (sz * half[2])))
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]
    return Part(v, f, [role] * 6, sub=0)


def sheet(xs, ys, at, role_of):
    """A sheet over the grid xs × ys: vertex (i, j) at `at(x, y)`, cell (i, j)
    painted `role_of(i, j)`."""
    verts = [at(x, y) for y in ys for x in xs]
    n = len(xs)
    faces, mats = [], []
    for j in range(len(ys) - 1):
        for i in range(n - 1):
            a = j * n + i
            faces.append((a, a + 1, a + n + 1, a + n))
            mats.append(role_of(i, j))
    return Part(verts, faces, mats, sub=0)


# ===========================================================================
# THE RACE GATE PANEL
# ===========================================================================

# Pole to pole, and where the panel hangs on them — the frame `props.js`'s
# GATE_PANEL describes, which the flutter and the course are built round.
GATE = {'width': 0.92, 'bottom': 0.98, 'top': 1.62, 'pole': 1.92}
POLE_R = 0.016       # a 32 mm flex pole
SLEEVE_R = 0.021     # the panel's sewn sleeve round it
HEM = 0.026          # stitched double fabric along the top and the bottom
PRINT = (1.19, 1.42)  # the printed sponsor field across the middle


def gate_pole(x):
    """One gate pole as it stands in a race piste: the black spring hinge
    on the auger base (its stem running on into the drilled hole), the pole
    screwed into it, and the pole's cap — with the little collar of snow
    the drill threw up round it."""
    P = GATE['pole']
    return [
        loft([{'y': -0.12, 'rx': 0.024},
              {'y': 0.085, 'rx': 0.026},
              {'y': 0.115, 'rx': 0.031},     # the knuckle the pole folds over at
              {'y': 0.205, 'rx': 0.020}],
             'hinge', n=8, caps=(False, False), sub=0).xf(pos=(x, 0, 0)),
        loft([{'y': 0.19, 'rx': POLE_R}, {'y': P - 0.03, 'rx': POLE_R}],
             'pole', n=8, caps=(False, False), sub=0).xf(pos=(x, 0, 0)),
        loft([{'y': P - 0.035, 'rx': 0.0185}, {'y': P + 0.006, 'rx': 0.0185},
              {'y': P + 0.02, 'rx': 0.010}],
             'cap', n=8, caps=(False, True), sub=0).xf(pos=(x, 0, 0)),
        loft([{'y': -0.03, 'rx': 0.078, 'rz': 0.066}, {'y': 0.022, 'rx': 0.044, 'rz': 0.040}],
             'snow', n=6, caps=(False, True), sub=0).xf(pos=(x, 0, 0)),
    ]


def gate_panel():
    W, b, t = GATE['width'], GATE['bottom'], GATE['top']
    parts = gate_pole(0.0) + gate_pole(W)
    # The panel: hems, the race-colour fields and the printed band, on one
    # sheet bellied a few centimetres downwind, edge to edge between the
    # sleeves. Ten columns, so the ripple the game runs across it is smooth.
    xs = [SLEEVE_R, 0.06, 0.15, 0.24, 0.34, 0.46, 0.58, 0.68, 0.77, 0.86, W - SLEEVE_R]
    ys = [b, b + HEM, PRINT[0], PRINT[1], t - HEM, t]

    def at(x, y):
        return (x, y, 0.03 * math.sin(math.pi * x / W))

    def role(i, j):
        if j in (0, 4):
            return 'hem'
        if j == 2 and 2 <= i <= 7:
            return 'print'
        return 'cloth'

    parts.append(sheet(xs, ys, at, role))
    # the sleeves, slid down over the poles
    for x in (0.0, W):
        parts.append(loft([{'y': b, 'rx': SLEEVE_R}, {'y': t, 'rx': SLEEVE_R}],
                          'sleeve', n=8, caps=(False, False), sub=0).xf(pos=(x, 0, 0)))
    return parts


# ===========================================================================
# THE SWISS PISTE MARKER
# ===========================================================================

MARK = {'pole_r': 0.0225, 'top': 3.0, 'sign': (2.46, 2.98), 'half': 0.25, 'border': 0.04}


def waymark():
    r = MARK['pole_r']
    y0, y1 = MARK['sign']
    h = MARK['half']
    parts = []
    # The pole, run-coloured, with two reflective white bands under the sign.
    ys = [-0.35, 1.80, 2.00, 2.20, 2.40, MARK['top']]
    parts.append(loft([{'y': y, 'rx': r} for y in ys],
                      lambda y, a, i: 'markBand' if i in (1, 3) else 'markPole', n=8,
                      caps=(False, True), sub=0))
    # The run sign: an aluminium plate, its front drawn as its own sheet —
    # the white border and the run's colour inside it — and the number.
    zb, zf = r + 0.0175, r + 0.0295
    k = MARK['border']
    outer = [(-h, y0), (h, y0), (h, y1), (-h, y1)]
    inner = [(-h + k, y0 + k), (h - k, y0 + k), (h - k, y1 - k), (-h + k, y1 - k)]
    # one closed slab: the back and the edges bare aluminium, the face the
    # border ring and the field inside it
    v = [(x, y, zb) for x, y in outer] + [(x, y, zf) for x, y in outer + inner]
    parts.append(Part(v, [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
                          (4, 5, 9, 8), (5, 6, 10, 9), (6, 7, 11, 10), (7, 4, 8, 11), (8, 9, 10, 11)],
                      ['plateBack'] * 5 + ['plateBorder'] * 4 + ['plate'], sub=0))
    # A "7" in the sign's white, a few millimetres proud: the bar, and the
    # stroke falling from its right end. Every marker on one run carries
    # the run's number, so every marker on this one is a seven.
    zn = zf + 0.003
    cy = (y0 + y1) / 2
    bar = [(-0.115, cy + 0.105), (0.115, cy + 0.105), (0.115, cy + 0.158), (-0.115, cy + 0.158)]
    stem = [(-0.045, cy - 0.158), (0.012, cy - 0.158), (0.115, cy + 0.105), (0.058, cy + 0.105)]
    for quad in (bar, stem):
        parts.append(Part([(x, y, zn) for x, y in quad], [(0, 1, 2, 3)], ['numeral'], sub=0))
    # Two clamp brackets round the pole behind the plate.
    for y in (y0 + 0.09, y1 - 0.09):
        parts.append(box((-0.038, y - 0.018, -0.032), (0.038, y + 0.018, zb), 'clamp'))
    # Snow: a ridge along the sign's top edge, thickest in the middle, and
    # the drift round the foot of the pole.
    zc = (zb + zf) / 2
    parts.append(sweep([(-h - 0.004, y1, zc), (-0.1, y1, zc), (0.1, y1, zc), (h + 0.004, y1, zc)],
                       [(0.016, -0.004), (0.03, 0.024), (0.016, 0.062), (-0.012, 0.068),
                        (-0.028, 0.028), (-0.017, -0.004)],
                       'snow', up=(0, 1, 0),
                       scale=lambda t: (1.0, 0.55 + 0.45 * math.sin(math.pi * min(1, max(0, t))) ** 0.6),
                       sub=0))
    parts.append(loft([{'y': -0.05, 'rx': 0.27, 'rz': 0.21, 'wob': [(0.14, 3, 0.4), (0.06, 5, 1.1)]},
                       {'y': 0.045, 'rx': 0.11, 'rz': 0.095, 'wob': [(0.1, 2, 2.0)]},
                       {'y': 0.085, 'rx': 0.034}],
                      'snow', n=8, caps=(False, True), sub=0))
    return parts


# ===========================================================================
# THE STEEL SNOW BRIDGE
# ===========================================================================

BRIDGE = {
    'half': 2.97,       # the grate beams' half-length along the contour
    'girders': 2.05,    # where the two girders stand, either side of the middle
    'height': 2.80,     # the grate, measured up its own face
    'foot': 0.20,       # the grate's foot, uphill of the origin
    'lean': math.radians(8),   # downhill of the slope's normal
    'beams': 8,
    'strut_at': 1.85,   # how far up the girder the strut props it
    'strut_foot': -1.04,
}


def bridge_frame():
    """The grate's frame: a point up its face at height h, offset `off`
    along its uphill normal. The face leans downhill (−Z) with height."""
    s, c = math.sin(BRIDGE['lean']), math.cos(BRIDGE['lean'])
    up = Vector((0, c, -s))          # up the grate's face
    n = Vector((0, s, c))            # its uphill normal
    base = Vector((0, 0, BRIDGE['foot']))

    def G(x, h, off=0.0):
        return Vector((x, 0, 0)) + base + up * h + n * off
    return G, up, n


def i_profile(flange, depth, tf, tw):
    """An I (or H) section as a sweep profile: (w, h), flanges at h = ±depth
    spanning w = ±flange, the web between them."""
    f, d = flange, depth
    return [(-f, -d), (f, -d), (f, -d + tf), (tw, -d + tf), (tw, d - tf), (f, d - tf),
            (f, d), (-f, d), (-f, d - tf), (-tw, d - tf), (-tw, -d + tf), (-f, -d + tf)]


def snow_bridge(seed=7):
    rnd = random.Random(seed)
    G, up, n = bridge_frame()
    H = BRIDGE['height']
    parts = []

    # Girders: HEB-like, flanges parallel to the grate, web along its normal.
    for sx in (-1, 1):
        x = sx * BRIDGE['girders']
        parts.append(sweep([tuple(G(x, -0.18)), tuple(G(x, H + 0.03))], i_profile(0.06, 0.06, 0.009, 0.006),
                           'girder', up=tuple(n), sub=0))

    # The grate: eight I-beams across the girders' uphill face, flanges to
    # the snow. Their pitch closes a little towards the foot, where the
    # pressure is greatest.
    beams = BRIDGE['beams']
    centres = []
    for k in range(beams):
        f = k / (beams - 1)
        h = 0.17 + (H - 0.24) * (f ** 1.08)
        centres.append(h)
        c = G(0, h, 0.06 + 0.05)
        parts.append(sweep([(-BRIDGE['half'], c.y, c.z), (BRIDGE['half'], c.y, c.z)],
                           i_profile(0.07, 0.05, 0.009, 0.0055), 'beam', up=tuple(n), sub=0))

    # Struts: tubes from the back of each girder down to their footings.
    for sx in (-1, 1):
        x = sx * BRIDGE['girders']
        top = G(x, BRIDGE['strut_at'], -0.075)
        foot = Vector((x, -0.06, BRIDGE['strut_foot']))
        parts.append(sweep([tuple(top), tuple(foot)], [(0.05 * math.cos(a), 0.05 * math.sin(a))
                                                       for a in [i / 8 * TAU for i in range(8)]],
                           'strut', up=(1, 0, 0), sub=0))
        # the gusset the strut is pinned to
        along = (foot - top).normalized()
        parts.append(oriented_box(G(x, BRIDGE['strut_at'], -0.07), (Vector((1, 0, 0)), up, n),
                                  (0.012, 0.11, 0.03), 'footing'))
        # footings: steel base plates on their micropiles, barely out of the snow
        parts.append(oriented_box(foot + Vector((0, 0.05, -0.02)), (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))),
                                  (0.13, 0.04, 0.16), 'footing'))
        gf = G(x, -0.02)
        parts.append(oriented_box(Vector((x, -0.0, gf.z)), (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))),
                                  (0.12, 0.035, 0.15), 'footing'))
        # the girder's tension anchor: a rod from its foot into the slope uphill
        a0 = Vector((x, 0.02, gf.z + 0.08))
        a1 = Vector((x, -0.4, gf.z + 0.4))
        parts.append(sweep([tuple(a0), tuple(a1)], [(0.017, 0), (0, 0.017), (-0.017, 0), (0, -0.017)],
                           'anchor', up=(1, 0, 0), sub=0, caps=False))
        # and the strut footing's anchor head: a nut on its plate
        parts.append(loft([{'y': 0.02, 'rx': 0.032}, {'y': 0.07, 'rx': 0.032}], 'anchor', n=6,
                          caps=(False, True), sub=0).xf(pos=(x, 0, foot.z + 0.07)))
        _ = along

    # The snow the grate holds back: the snowpack against its uphill face,
    # up over the lowest two beams, falling away up the slope.
    # A closed solid — the slope it lies on is its hidden floor — so it is
    # lit from the side it is seen from whatever way it was wound.
    # It rides highest in the middle of the span and runs out past the
    # beams' ends, where the snow round the structure is only the slope's.
    xs = [-3.35, -2.9, -2.1, -1.2, -0.3, 0.6, 1.5, 2.3, 2.95, 3.35]
    rows = []
    for x in xs:
        edge = min(1.0, max(0.0, (3.35 - abs(x)) / 1.1))
        hl = (0.86 + rnd.uniform(-0.1, 0.1)) * (0.06 + 0.94 * edge ** 0.7)
        reach = 0.25 + 0.65 * edge ** 0.5
        g = G(x, hl, 0.17)
        rows.append([(x, g.y, g.z),
                     (x, hl * 0.84 + rnd.uniform(-0.04, 0.04), g.z + 0.24 * reach),
                     (x, hl * 0.46 + rnd.uniform(-0.04, 0.04), g.z + 0.58 * reach),
                     (x, -0.05, g.z + 0.95 * reach),
                     (x, -0.05, g.z - 0.02)])
    parts.append(Part([p for r in rows for p in r],
                      [(i * 5 + j, i * 5 + (j + 1) % 5, (i + 1) * 5 + (j + 1) % 5, (i + 1) * 5 + j)
                       for i in range(len(xs) - 1) for j in range(5)]
                      + [tuple(range(5)), tuple((len(xs) - 1) * 5 + j for j in range(5))],
                      ['snow'] * ((len(xs) - 1) * 5 + 2), sub=0))

    # New snow on the upper beams, deepest on the top one, wandering along
    # each; a cap on each girder's head.
    # A loaf on each beam's top: wider than the beam it sits on, rounded
    # over, thicker towards the middle of the span and up the grate, with
    # the odd thin stretch where a lump of it has dropped off.
    for k, h in enumerate(centres):
        if k < 2:
            continue
        load = 0.55 + 0.6 * (k - 2) / (beams - 3)
        top = G(0, h + 0.07, 0.11)
        ph = rnd.random() * TAU
        path = [(x, top.y - 0.006, top.z) for x in (-2.97, -1.5, 0.0, 1.5, 2.97)]
        prof = [(-0.058, 0.0), (-0.078, 0.045), (-0.05, 0.105), (0.0, 0.125), (0.05, 0.11),
                (0.079, 0.05), (0.06, 0.0)]
        parts.append(sweep(path, prof, 'snow', up=(0, 1, 0),
                           scale=lambda t, ph=ph, load=load: (
                               1.0 + 0.1 * math.sin(t * 9 + ph),
                               load * (0.3 + 0.7 * math.sin(math.pi * t) ** 0.3)
                               * (0.8 + 0.28 * math.sin(t * 11 + ph * 2))),
                           sub=0))
    for sx in (-1, 1):
        gt = G(sx * BRIDGE['girders'], H + 0.03)
        parts.append(loft([{'y': 0.0, 'rx': 0.08, 'rz': 0.085}, {'y': 0.05, 'rx': 0.055, 'rz': 0.06}],
                          'snow', n=6, caps=(False, True), sub=0).xf(pos=(gt.x, gt.y - 0.005, gt.z)))
    return parts


# ---------------------------------------------------------------------------
# Build, export, preview
# ---------------------------------------------------------------------------

OBJECTS = [
    ('gate_panel', gate_panel, 400),
    ('waymark', waymark, 300),
    ('snow_bridge', snow_bridge, 1200),
]

# Preview colours only; the game paints each role from its own tables.
PALETTE_PREVIEW = {
    'pole': '#f4f4f4', 'cap': '#ececec', 'hinge': '#1e2126', 'cloth': '#f4f4f4',
    'sleeve': '#e2e2e2', 'hem': '#cfcfcf', 'print': '#f6f7f9', 'snow': '#e8eef8',
    'markPole': '#c4271d', 'markBand': '#eef1f4', 'plate': '#c4271d', 'plateBorder': '#f1f3f5', 'plateBack': '#a7abb0',
    'numeral': '#f1f3f5', 'clamp': '#3a3d42',
    'girder': '#55585d', 'beam': '#5e6166', 'strut': '#55585d', 'footing': '#34363a',
    'anchor': '#3b3d40',
}


def face_out(ob, roles, toward):
    """Turn every face painted one of `roles` to face `toward` (game space).
    `realise` orients each part by its own closure, which a lone quad does
    not have — and the game draws these single-sided."""
    want = Vector(riders.B(toward))
    me = ob.data
    idx = {i for i, m in enumerate(me.materials) if m and m.name in roles}
    flip = [p.index for p in me.polygons if p.material_index in idx and p.normal.dot(want) < 0]
    if flip:
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        bmesh.ops.reverse_faces(bm, faces=[bm.faces[i] for i in flip])
        bm.to_mesh(me)
        bm.free()
        me.update()


FACING = {'waymark': ({'numeral'}, (0, 0, 1))}


def build():
    riders.PALETTE.update(PALETTE_PREVIEW)
    col = collection('piste')
    clear_collection(col)
    out = {}
    for name, make, budget in OBJECTS:
        ob = realise(name, make(), col, sharp_deg=40)
        if name in FACING:
            face_out(ob, *FACING[name])
        n = tris(ob)
        assert n <= budget, '%s: %d triangles over %d' % (name, n, budget)
        lo = [min(v.co[i] for v in ob.data.vertices) for i in range(3)]
        hi = [max(v.co[i] for v in ob.data.vertices) for i in range(3)]
        # Blender Z is the game's Y
        ob['height'] = round(hi[2], 4)
        out[name] = ob
        print('%-12s %4d tris  x %.2f..%.2f  y %.2f..%.2f  z %.2f..%.2f'
              % (name, n, lo[0], hi[0], lo[2], hi[2], -hi[1], -lo[1]))
    return out


def export(path):
    col = collection('piste')
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


def _tinted(name, hexcol):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = riders.material('cloth').copy()
    m.name = name
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    rgba = riders.hex_rgba(hexcol)
    bsdf.inputs['Base Color'].default_value = rgba
    m.diffuse_color = rgba
    return m


def preview(obs, out_dir):
    from sheet import render_sheet
    os.makedirs(out_dir, exist_ok=True)
    # The gate in the course's red and blue — the white roles tinted, as the
    # game's instance colour does — and the marker's pole in the run's red.
    def dress(tag, hexcol):
        mul = riders.hex_rgba(hexcol)
        d = {}
        for role in ('pole', 'cap', 'cloth', 'sleeve', 'hem'):
            base = riders.hex_rgba(PALETTE_PREVIEW[role])
            rgb = '#%02x%02x%02x' % tuple(int(255 * min(1, (base[i] * mul[i]) ** (1 / 2.2))) for i in range(3))
            d[role] = _tinted('%s_%s' % (role, tag), rgb)
        # the print keeps half of the race colour
        base = riders.hex_rgba(PALETTE_PREVIEW['print'])
        rgb = '#%02x%02x%02x' % tuple(int(255 * min(1, (base[i] * (0.45 + 0.55 * mul[i])) ** (1 / 2.2)))
                                      for i in range(3))
        d['print'] = _tinted('print_%s' % tag, rgb)
        return d
    red = dress('red', '#d81e1e')
    blue = dress('blue', '#1f4fd0')
    render_sheet([(obs['gate_panel'], red), (obs['gate_panel'], blue), obs['waymark']],
                 os.path.join(out_dir, 'gate-and-marker.png'), yaw=-24, pitch=10, gap=0.7)
    render_sheet([obs['snow_bridge']], os.path.join(out_dir, 'snow-bridge-downhill.png'),
                 yaw=-150, pitch=16)
    render_sheet([obs['snow_bridge']], os.path.join(out_dir, 'snow-bridge-uphill.png'),
                 yaw=28, pitch=20)


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    built = build()
    if '--out' in args:
        out = args[args.index('--out') + 1]
        os.makedirs(out, exist_ok=True)
        print(export(os.path.join(out, 'piste-furniture.glb')))
    if '--preview' in args:
        preview(built, args[args.index('--preview') + 1])
