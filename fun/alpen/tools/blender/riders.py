"""Alpen riders — the player and the people sharing the piste, built in Blender.

This script is the source of `assets/models/riders/*.glb`. Nothing in those
files was pushed around by hand: every surface is lofted, swept or turned
from the tables below and smoothed with one level of Catmull-Clark, so a
change to the kit is a change to a number here and a rebuild.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/riders.py -- --out fun/alpen/assets/models/riders

Run from the repository root. Without `--out` it only builds the scene,
which is how it is iterated on interactively: exec the file in a running
Blender, then call `preview_player(...)` / `preview_npcs(...)`.

THE COORDINATES ARE THE GAME'S, NOT BLENDER'S.

Every table is written in three.js space — +Y up and −Z down the hill (the
nose of a board, the tips of a pair of skis) — because that is the space the
rig in `js/riderModel.js` and the figures in `js/mountainLife.js` were
solved in, and the numbers have to agree with theirs to the millimetre. `B`
turns a point into Blender's Z-up space as the mesh is written, and the glTF
exporter's +Y-up conversion turns it straight back, so the exported node
carries exactly the coordinates in these tables.

THE PLAYER IS ONE NODE PER RIGID SEGMENT OF THE RIG, each in its segment's
own frame (see the skeleton constants in `riderModel.js`):

  rider_pelvis      waist pivot, 0.07 m above the hip sockets
  rider_torso       waist pivot; +X is where the chest faces, ±Z the shoulders
  rider_head        neck pivot; +X is where he looks
  rider_upperArm    shoulder; the bone hangs down −Y for UPPER
  rider_foreArm_*   elbow; the hand centre is FORE down −Y
  rider_thigh_*     hip socket; the knee is THIGH down −Y
  rider_shin        knee; the ankle is SHIN down −Y
  rider_boot        on the deck under the ankle; +X is the toes
  rider_binding     the same frame, bolted to the deck

and in every limb +X is the side the joint bends *towards* — the kneecap,
the point of the elbow — because the rig now rolls each limb into its own
bend plane (it used to leave the roll to `setFromUnitVectors`, which is why
nothing on a limb could face anywhere in particular). `*_lead` and
`*_rear` are mirror images: the lead hand is a left hand, the rear one a
right, since the rider rides regular and `lead` is over the nose.

Colour is not baked. Each face carries a material whose NAME is its role
(`shell`, `trim`, `ink`…); the game maps roles to vertex colours and to the
cloth masks its shader reads, so the palette stays in `js/` where the rest
of the art direction is written down.
"""

import bpy
import bmesh
import math
import json
import os
import sys
from mathutils import Matrix, Vector

TAU = math.tau


# ---------------------------------------------------------------------------
# Palette — preview colours only; the game assigns its own by role name.
# ---------------------------------------------------------------------------

PALETTE = {
    'shell': '#ff4d12',       # high-vis shell jacket
    'shellDark': '#cc3704',   # yoke, hem, shoulder caps
    'trim': '#00d4ff',        # mint: goggle lens, collar lining, piping
    'gold': '#ffab00',        # yellow: straps, zip pulls, cuffs
    'ink': '#181c24',         # helmet, gloves, soles, hardware
    'charcoal': '#343c47',    # helmet ridges, palm, ratchets
    'boot': '#2a303a',        # boot uppers
    'trouser': '#162342',     # deep navy trousers
    'pocket': '#24324c',      # cargo pocket, a shade up from the cloth
    'gaiter': '#25344d',      # neck gaiter
    'steel': '#aeb6c0',       # lamp lens, lace panel
    'pack': '#304b50',
    'packDark': '#223538',
    'packLight': '#b8ccc5',
    'skin': '#c98f6a',
    'helmet': '#181c24',      # the player's helmet shell
    'lens': '#00d4ff',        # goggle lens
    # NPC roles: recoloured per figure in the game
    'npcJacket': '#1976d2',
    'npcAccent': '#ffd54f',
    'npcTrouser': '#20252e',
    'npcHelmet': '#f0f4f8',
    'npcLens': '#ff7700',
    'npcSkin': '#c98f6a',
    'npcHard': '#181c24',
    'npcDetail': '#101318',
    'npcPale': '#eef2f7',
    'npcBase': '#2b3444',     # ski and board bases/sidewalls
    'npcBoot': '#f0f4f8',     # ski boot shells
    # preview only
    'deck': '#f2f2f2',
    'snow': '#eef3fa',
}

GLOSSY = {'trim', 'gold', 'steel', 'lens', 'npcLens', 'packLight', 'npcPale'}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def material(role):
    mat = bpy.data.materials.get(role)
    if mat:
        return mat
    mat = bpy.data.materials.new(role)
    if hasattr(mat, 'use_nodes'):
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    rgba = hex_rgba(PALETTE.get(role, '#ff00ff'))
    mat.diffuse_color = rgba
    if bsdf:
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Roughness'].default_value = 0.28 if role in GLOSSY else 0.72
        if role == 'steel':
            bsdf.inputs['Metallic'].default_value = 0.6
    return mat


# ---------------------------------------------------------------------------
# The kit. Everything is a Part: verts in three.js space, faces, a material
# role per face, and how many levels of Catmull-Clark it is smoothed with.
# ---------------------------------------------------------------------------

def B(p):
    """three.js (Y up, −Z nose) → Blender (Z up)."""
    return (p[0], -p[2], p[1])


class Part:
    def __init__(self, verts, faces, mats, sub=1):
        self.verts = [tuple(v) for v in verts]
        self.faces = faces
        self.mats = mats
        self.sub = sub

    def xf(self, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        """Transform in three.js space: T · Rx · Ry · Rz · S, the order
        three's default 'XYZ' Euler composes in."""
        m = (Matrix.Translation(pos)
             @ Matrix.Rotation(rot[0], 4, 'X')
             @ Matrix.Rotation(rot[1], 4, 'Y')
             @ Matrix.Rotation(rot[2], 4, 'Z')
             @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1)))
        self.verts = [tuple(m @ Vector(v)) for v in self.verts]
        if scale[0] * scale[1] * scale[2] < 0:
            self.faces = [tuple(reversed(f)) for f in self.faces]
        return self

    def apply(self, m):
        self.verts = [tuple(m @ Vector(v)) for v in self.verts]
        if m.to_3x3().determinant() < 0:
            self.faces = [tuple(reversed(f)) for f in self.faces]
        return self

    def mirror_z(self):
        self.verts = [(x, y, -z) for (x, y, z) in self.verts]
        self.faces = [tuple(reversed(f)) for f in self.faces]
        return self

    def copy(self):
        return Part(list(self.verts), list(self.faces), list(self.mats), self.sub)


def _wrap(a):
    return math.atan2(math.sin(a), math.cos(a))


def ring(st, n):
    """One closed section of a loft, at height st['y'].

    rx/rz are the half-extents along X and Z; `rnd` is the superellipse
    exponent (1 an ellipse, lower creeping towards a rounded rectangle);
    x/z offset the centre; sx/sz tilt the ring's plane (a hem that drops at
    the back is sx > 0); `wob` is a list of radial ripples
    (amp, k, phase[, centre angle, half-width]) that become cloth folds once
    the cage is smoothed. Angle a runs from +X towards +Z."""
    rx = st['rx']
    rz = st.get('rz', rx)
    rnd = st.get('rnd', 1.0)
    a0 = st.get('a0', 0.0)
    pts = []
    for i in range(n):
        a = a0 + i / n * TAU
        c, s = math.cos(a), math.sin(a)
        px = rx * math.copysign(abs(c) ** rnd, c)
        pz = rz * math.copysign(abs(s) ** rnd, s)
        f = 1.0
        for w in st.get('wob', ()):
            win = 1.0
            if len(w) > 3:
                d = abs(_wrap(a - w[3])) / w[4]
                win = 0.0 if d >= 1 else math.cos(d * math.pi / 2) ** 2
            f += w[0] * math.sin(w[1] * a + w[2]) * win
        px *= f
        pz *= f
        y = st['y'] + st.get('sx', 0.0) * px + st.get('sz', 0.0) * pz
        pts.append((st.get('x', 0.0) + px, y, st.get('z', 0.0) + pz))
    return pts


def domed(stations, dome, steps=2):
    """Grow quarter-round shoulders past either end of a station list, the
    way `riderModel.js#domed` does, so a limb ends in a ball instead of a
    lid."""
    if not dome:
        return stations

    def grow(end, nxt, h):
        if not h:
            return []
        sign = 1 if end['y'] >= nxt['y'] else -1
        out = []
        for k in range(1, steps + 1):
            a = k / (steps + 1) * math.pi / 2
            s = dict(end)
            s['y'] = end['y'] + sign * h * math.sin(a)
            s['rx'] = end['rx'] * math.cos(a)
            s['rz'] = end.get('rz', end['rx']) * math.cos(a)
            s.pop('wob', None)
            out.append(s)
        return out

    head = list(reversed(grow(stations[0], stations[1], dome[0])))
    tail = grow(stations[-1], stations[-2], dome[1])
    return head + list(stations) + tail


def loft(stations, mat, n=12, dome=None, caps=(True, True), sub=1):
    """Stack rings into a closed solid. `mat` is a role or a function
    (y, angle, station index) → role, evaluated per face of the cage."""
    sts = domed(stations, dome)
    rings = [ring(s, s.get('n', n)) for s in sts]
    verts = [p for r in rings for p in r]
    faces, mats = [], []
    pick = mat if callable(mat) else (lambda y, a, i: mat)
    for i in range(len(rings) - 1):
        m = len(rings[i])
        for j in range(m):
            a = rings[i][j]
            jn = (j + 1) % m
            faces.append((i * m + j, i * m + jn, (i + 1) * m + jn, (i + 1) * m + j))
            y = 0.5 * (sts[i]['y'] + sts[i + 1]['y'])
            ang = (j + 0.5) / m * TAU + sts[i].get('a0', 0.0)
            mats.append(pick(y, ang, i))
    m0 = len(rings[0])
    if caps[0]:
        faces.append(tuple(reversed(range(m0))))
        mats.append(pick(sts[0]['y'], 0.0, 0))
    if caps[1]:
        last = len(rings) - 1
        ml = len(rings[last])
        faces.append(tuple(last * ml + j for j in range(ml)))
        mats.append(pick(sts[-1]['y'], 0.0, last))
    return Part(verts, faces, mats, sub)


def sweep(path, profile, mat, up=(0, 1, 0), scale=None, caps=True, sub=1, closed=False):
    """A profile carried along a polyline: straps, ridges, piping, shafts.

    `profile` is a closed list of (w, h): w across the path, h along the
    `up` hint (a vector, or a function of the point and t returning one),
    which is the outward normal for anything lying on a surface. `scale`
    is an optional function of t ∈ [0, 1] → (sw, sh)."""
    pts = [Vector(p) for p in path]
    count = len(pts)
    rings = []
    for i, p in enumerate(pts):
        t = i / (count - 1) if count > 1 else 0
        if closed:
            tan = pts[(i + 1) % count] - pts[i - 1]
        else:
            tan = pts[min(i + 1, count - 1)] - pts[max(i - 1, 0)]
        tan.normalize()
        u = Vector(up(p, t) if callable(up) else up)
        u = (u - tan * u.dot(tan))
        if u.length < 1e-6:
            u = Vector((0, 1, 0)) if abs(tan.y) < 0.9 else Vector((1, 0, 0))
            u = (u - tan * u.dot(tan))
        u.normalize()
        side = tan.cross(u).normalized()
        sw, sh = scale(t) if scale else (1.0, 1.0)
        rings.append([tuple(p + side * (w * sw) + u * (h * sh)) for (w, h) in profile])
    verts = [q for r in rings for q in r]
    m = len(profile)
    faces = []
    span = count if closed else count - 1
    for i in range(span):
        i2 = (i + 1) % count
        for j in range(m):
            jn = (j + 1) % m
            faces.append((i * m + j, i * m + jn, i2 * m + jn, i2 * m + j))
    if caps and not closed:
        faces.append(tuple(reversed(range(m))))
        faces.append(tuple((count - 1) * m + j for j in range(m)))
    mats = [mat] * len(faces)
    return Part(verts, faces, mats, sub)


def rrect(w, h, r=0.35, n=12):
    """A rounded-rectangle profile, half-extents w × h."""
    return [(p[0], p[2]) for p in ring({'y': 0, 'rx': w, 'rz': h, 'rnd': r}, n)]


def ellipse_pts(cx, cz, rx, rz, y, a0, a1, steps, rnd=1.0, out=0.0, ydrop=None):
    """Points along an elliptical arc in a horizontal plane — a strap's path
    round a boot, a goggle band round a helmet. `out` pushes the path off
    the surface along the ellipse's own normal."""
    pts = []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        c, s = math.cos(a), math.sin(a)
        px = rx * math.copysign(abs(c) ** rnd, c)
        pz = rz * math.copysign(abs(s) ** rnd, s)
        nx, nz = c / max(rx, 1e-6), s / max(rz, 1e-6)
        nl = math.hypot(nx, nz) or 1
        yy = y + (ydrop(a) if ydrop else 0.0)
        pts.append((cx + px + out * nx / nl, yy, cz + pz + out * nz / nl))
    return pts


def station_at(stations, y, a=0.0):
    """Interpolate a loft's table at height y — for laying trim on it."""
    for i in range(1, len(stations)):
        s0, s1 = stations[i - 1], stations[i]
        if (s0['y'] - y) * (s1['y'] - y) <= 0 and s0['y'] != s1['y']:
            t = (y - s0['y']) / (s1['y'] - s0['y'])
            out = {'y': y}
            for k in ('rx', 'rz', 'x', 'z', 'rnd'):
                v0 = s0.get(k, s0['rx'] if k == 'rz' else (1.0 if k == 'rnd' else 0.0))
                v1 = s1.get(k, s1['rx'] if k == 'rz' else (1.0 if k == 'rnd' else 0.0))
                out[k] = v0 + (v1 - v0) * t
            return out
    return dict(stations[-1])


def surface_ring(stations, y, out=0.0, n=24, a0=0.0, a1=TAU, closed=True):
    s = station_at(stations, y)
    steps = n if closed else n
    pts = ellipse_pts(s['x'], s['z'], s['rx'], s['rz'], y, a0, a1, steps, s.get('rnd', 1.0), out)
    return pts[:-1] if closed else pts


# ---------------------------------------------------------------------------
# Realising parts in Blender
# ---------------------------------------------------------------------------

def _scratch():
    col = bpy.data.collections.get('_scratch')
    if not col:
        col = bpy.data.collections.new('_scratch')
        bpy.context.scene.collection.children.link(col)
    return col


def _evaluate(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    return bpy.data.meshes.new_from_object(ob.evaluated_get(dg))


def realise(name, parts, collection, sharp_deg=50, budget=None):
    """Smooth every part, weld the lot into one mesh object named `name`,
    with one material slot per role used.

    Past `budget` triangles every part is collapsed by the same share. Not
    the welded whole: a decimator run over the lot spends its cuts where the
    error is smallest, which is the large, gently curved surfaces — so the
    jacket went to facets while every buckle kept all of its triangles. The
    smallest trim is left alone, since it cannot lose any without losing its
    shape."""
    scratch = _scratch()
    smoothed = []
    for part in parts:
        local_roles = sorted(set(part.mats))
        me = bpy.data.meshes.new('_part')
        me.from_pydata([B(v) for v in part.verts], [], part.faces)
        for r in local_roles:
            me.materials.append(material(r))
        for poly, r in zip(me.polygons, part.mats):
            poly.material_index = local_roles.index(r)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('_part', me)
        scratch.objects.link(ob)
        if part.sub:
            mod = ob.modifiers.new('sub', 'SUBSURF')
            mod.levels = part.sub
            mod.render_levels = part.sub
            mod.quality = 3
            ev = _evaluate(ob)
            ob.modifiers.remove(mod)
            ob.data = ev
            bpy.data.meshes.remove(me)
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        smoothed.append((ob, local_roles, n))

    SMALL = 64
    total = sum(n for _, _, n in smoothed)
    ratio = 1.0
    if budget and total > budget:
        small = sum(n for _, _, n in smoothed if n <= SMALL)
        ratio = max(0.04, (budget - small) / max(total - small, 1))

    roles = []
    verts, faces, fmats = [], [], []
    for ob, local_roles, n in smoothed:
        src = ob.data
        ev = None
        if ratio < 1 and n > SMALL:
            mod = ob.modifiers.new('budget', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            ev = _evaluate(ob)
            src = ev
        base = len(verts)
        verts.extend(tuple(v.co) for v in src.vertices)
        for poly in src.polygons:
            faces.append(tuple(base + i for i in poly.vertices))
            r = local_roles[poly.material_index]
            if r not in roles:
                roles.append(r)
            fmats.append(roles.index(r))
        me = ob.data
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(me)
        if ev:
            bpy.data.meshes.remove(ev)

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for r in roles:
        me.materials.append(material(r))
    for poly, mi in zip(me.polygons, fmats):
        poly.material_index = mi
    me.shade_smooth()
    if hasattr(me, 'set_sharp_from_angle'):
        # A collapsed surface has wider angles between its faces than the
        # smoothed cage it came from; the crease test that keeps a sole's rim
        # crisp would facet a sleeve, so it loosens as the cut deepens.
        angle = sharp_deg if ratio >= 1 else max(sharp_deg, 50 + 40 * (1 - ratio))
        me.set_sharp_from_angle(angle=math.radians(angle))
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------
# The rig's skeleton, copied from `js/riderModel.js`. Not free numbers: the
# IK, the grabs and the physics are all solved against them.
# ---------------------------------------------------------------------------

DECK_DROP = -0.033
DECK_TOP = 0.076 + DECK_DROP
ANKLE_Y = 0.33 + DECK_DROP
FOOT_Z = 0.245
FOOT_X = 0.015
HIP_Y = 1.06 + DECK_DROP
HIP_Z = 0.115
THIGH = 0.42
SHIN = 0.40
WAIST = 0.07
SHOULDER_Y = 0.40
SHOULDER_Z = 0.20
NECK_Y = 0.44
UPPER = 0.29
FORE = 0.29


# ===========================================================================
# THE PLAYER
# ===========================================================================

# The jacket shell, hem to collar, in the torso's frame. The hem drops at the
# back (sx), the waist pulls in under a deeper chest, and the top rolls over
# into the shoulders instead of stopping at a lid.
JACKET = [
    {'y': -0.178, 'rx': 0.168, 'rz': 0.198, 'x': -0.012, 'rnd': 0.86, 'sx': 0.17},
    {'y': -0.150, 'rx': 0.166, 'rz': 0.197, 'x': -0.010, 'rnd': 0.86, 'sx': 0.14},
    {'y': -0.085, 'rx': 0.158, 'rz': 0.190, 'x': -0.006, 'rnd': 0.86, 'sx': 0.05,
     'wob': [(0.025, 5, 0.6)]},
    {'y': -0.010, 'rx': 0.150, 'rz': 0.184, 'rnd': 0.86},
    {'y': 0.090, 'rx': 0.153, 'rz': 0.193, 'x': 0.004, 'rnd': 0.87},
    {'y': 0.190, 'rx': 0.160, 'rz': 0.207, 'x': 0.008, 'rnd': 0.88},
    {'y': 0.280, 'rx': 0.158, 'rz': 0.214, 'x': 0.004, 'rnd': 0.88},
    {'y': 0.345, 'rx': 0.146, 'rz': 0.212, 'rnd': 0.9},
    {'y': 0.400, 'rx': 0.118, 'rz': 0.178, 'x': -0.004, 'rnd': 0.92},
    {'y': 0.442, 'rx': 0.090, 'rz': 0.118, 'x': -0.006, 'rnd': 0.95},
]
YOKE_Y = 0.322


def jacket_face(y, a, i):
    side = abs(math.sin(a)) > 0.93 and -0.06 < y < 0.26
    if y > YOKE_Y or y < -0.135 or side:
        return 'shellDark'
    return 'shell'


def jacket_parts(pocket=True):
    """Torso frame (the waist pivot): the shell, its trim, collar and hood."""
    parts = [loft(JACKET, jacket_face, n=20, caps=(True, True))]

    # Mint piping along the yoke seam, the line that reads from behind.
    parts.append(sweep(surface_ring(JACKET, YOKE_Y, out=0.003, n=40), rrect(0.005, 0.004, 1, 6),
                       'trim', up=(0, 1, 0), closed=True, caps=False, sub=0))

    # Shoulder caps, sunk into the shell where the sleeves' own domes meet them.
    for s in (-1, 1):
        parts.append(loft([
            {'y': 0.300, 'rx': 0.072, 'rz': 0.062},
            {'y': 0.355, 'rx': 0.082, 'rz': 0.074},
            {'y': 0.408, 'rx': 0.070, 'rz': 0.064},
        ], 'shellDark', n=10, dome=(0.03, 0.03)).xf(pos=(0, 0, s * SHOULDER_Z)))

    # The collar stands up round the gaiter, mint inside, and the hood is
    # rolled behind it — the one silhouette from the chase camera that says
    # "jacket" rather than "torso".
    def collar_face(y, a, i):
        return 'trim' if i >= 3 else 'shell'
    parts.append(loft([
        {'y': 0.395, 'rx': 0.092, 'rz': 0.104, 'x': -0.006},
        {'y': 0.470, 'rx': 0.088, 'rz': 0.098, 'x': -0.006},
        {'y': 0.528, 'rx': 0.083, 'rz': 0.090, 'x': -0.008, 'sx': -0.25},
        {'y': 0.531, 'rx': 0.075, 'rz': 0.082, 'x': -0.008, 'sx': -0.25},
        {'y': 0.490, 'rx': 0.072, 'rz': 0.078, 'x': -0.008},
    ], collar_face, n=16))

    def hood_up(p, t):
        return (0, 1, 0)
    hood_path = ellipse_pts(-0.016, 0, 0.118, 0.122, 0.452, math.pi - 1.95, math.pi + 1.95, 18,
                            ydrop=lambda a: 0.030 * math.cos(a - math.pi) ** 2 - 0.012)
    parts.append(sweep(hood_path, rrect(0.044, 0.036, 0.85, 10), 'shell', up=hood_up,
                       scale=lambda t: (0.45 + 0.55 * math.sin(math.pi * t) ** 0.6,
                                        0.45 + 0.55 * math.sin(math.pi * t) ** 0.6)))
    # its drawcord toggles, hanging at the collar's front corners
    for s in (-1, 1):
        parts.append(loft([{'y': 0.36, 'rx': 0.008}, {'y': 0.40, 'rx': 0.008}], 'gold', n=6,
                          dome=(0.006, 0.006), sub=0).xf(pos=(0.085, 0.0, s * 0.040)))

    # Front zip, collar to hem, on the surface rather than standing off it.
    zip_path = []
    for k in range(13):
        y = -0.150 + (0.52 - -0.150) * k / 12
        if y <= JACKET[-1]['y']:
            st = station_at(JACKET, y)
            xf = st['x'] + st['rx'] + 0.002
            yy = y + JACKET_SLOPE(y) * st['rx']
        else:
            xf = 0.078
            yy = y
        zip_path.append((xf, yy, 0.0))
    parts.append(sweep(zip_path, rrect(0.007, 0.004, 0.6, 6), 'ink', up=(1, 0, 0), sub=0))
    parts.append(loft([{'y': -0.02, 'rx': 0.006, 'rz': 0.010, 'rnd': 0.5},
                       {'y': 0.02, 'rx': 0.006, 'rz': 0.010, 'rnd': 0.5}], 'gold', n=8, sub=0)
                 .xf(pos=(0.090, 0.47, 0.0)))

    if not pocket:
        return parts
    # Chest pocket: a diagonal zip on the left breast, its pull in gold.
    pocket = []
    for k in range(7):
        t = k / 6
        y = 0.27 - 0.09 * t
        a = -0.30 - 0.42 * t
        st = station_at(JACKET, y)
        pocket.append(ellipse_pts(st['x'], 0, st['rx'], st['rz'], y, a, a, 1, st['rnd'], 0.003)[0])
    parts.append(sweep(pocket, rrect(0.006, 0.0035, 0.6, 6), 'ink',
                       up=lambda p, t: (p[0], 0, p[2]), sub=0))
    parts.append(loft([{'y': -0.018, 'rx': 0.005, 'rz': 0.009, 'rnd': 0.5},
                       {'y': 0.018, 'rx': 0.005, 'rz': 0.009, 'rnd': 0.5}], 'gold', n=8, sub=0)
                 .xf(pos=pocket[0], rot=(0, 0.35, 0)))
    return parts


def pack_parts():
    """Torso frame: a compact touring pack, and the straps that hold it on."""
    parts = []
    pack_st = [
        {'y': 0.010, 'rx': 0.042, 'rz': 0.112, 'x': -0.192, 'rnd': 0.6},
        {'y': 0.060, 'rx': 0.062, 'rz': 0.134, 'x': -0.206, 'rnd': 0.55},
        {'y': 0.200, 'rx': 0.070, 'rz': 0.145, 'x': -0.214, 'rnd': 0.55},
        {'y': 0.320, 'rx': 0.066, 'rz': 0.141, 'x': -0.208, 'rnd': 0.55},
        {'y': 0.392, 'rx': 0.046, 'rz': 0.118, 'x': -0.192, 'rnd': 0.65},
    ]

    def pack_face(y, a, i):
        if y > 0.33:
            return 'packDark'
        if math.cos(a) < -0.75 and 0.11 < y < 0.15:
            return 'packLight'
        return 'pack'
    parts.append(loft(pack_st, pack_face, n=16, dome=(0.02, 0.03)))
    # the lid's zip and a compression strap across the face
    lid = ellipse_pts(-0.209, 0, 0.068, 0.144, 0.328, math.pi * 0.62, math.pi * 1.38, 10, 0.55, 0.003)
    parts.append(sweep(lid, rrect(0.004, 0.003, 0.6, 6), 'ink', up=lambda p, t: (p[0] + 0.209, 0, p[2]),
                       sub=0))
    for zz in (-0.07, 0.07):
        strap = [(-0.14, 0.05, zz), (-0.262, 0.06, zz), (-0.286, 0.20, zz), (-0.270, 0.33, zz),
                 (-0.17, 0.39, zz)]
        parts.append(sweep(strap, rrect(0.012, 0.003, 0.5, 6), 'ink',
                           up=lambda p, t: (p[0] + 0.15, 0.0, 0.0) if t > 0.15 else (0, -1, 0), sub=0))

    for s in (-1, 1):
        z = s * 0.112
        path = [(-0.170, 0.330, z), (-0.128, 0.418, z), (-0.040, 0.452, z), (0.050, 0.440, z),
                (0.128, 0.392, z), (0.165, 0.300, z), (0.172, 0.200, z), (0.166, 0.120, z)]
        parts.append(sweep(path, rrect(0.024, 0.007, 0.6, 8), 'pack',
                           up=lambda p, t: (p[0], p[1] - 0.18, 0.0)))
    sternum = [(0.168, 0.255, -0.12), (0.182, 0.255, -0.06), (0.186, 0.255, 0.0),
               (0.182, 0.255, 0.06), (0.168, 0.255, 0.12)]
    parts.append(sweep(sternum, rrect(0.008, 0.004, 0.6, 6), 'ink', up=(1, 0, 0), sub=0))
    parts.append(loft([{'y': -0.012, 'rx': 0.008, 'rz': 0.020, 'rnd': 0.4},
                       {'y': 0.012, 'rx': 0.008, 'rz': 0.020, 'rnd': 0.4}], 'gold', n=8, sub=0)
                 .xf(pos=(0.190, 0.255, 0.0)))
    return parts


def player_torso():
    return jacket_parts() + pack_parts()


def JACKET_SLOPE(y):
    st = station_at(JACKET, y)
    for i in range(1, len(JACKET)):
        s0, s1 = JACKET[i - 1], JACKET[i]
        if (s0['y'] - y) * (s1['y'] - y) <= 0 and s0['y'] != s1['y']:
            t = (y - s0['y']) / (s1['y'] - s0['y'])
            return s0.get('sx', 0) + (s1.get('sx', 0) - s0.get('sx', 0)) * t
    return 0.0


def player_pelvis():
    # The seat of the trousers, hung at the waist pivot: everything below the
    # jacket hem. Domed under the crotch for the deep crouch.
    st = [
        {'y': -0.230, 'rx': 0.112, 'rz': 0.150, 'rnd': 0.85},
        {'y': -0.160, 'rx': 0.132, 'rz': 0.172, 'rnd': 0.82},
        {'y': -0.090, 'rx': 0.140, 'rz': 0.178, 'rnd': 0.82},
        {'y': -0.010, 'rx': 0.136, 'rz': 0.174, 'rnd': 0.84},
    ]
    return [loft(st, 'trouser', n=16, dome=(0.05, 0.03))]


HELMET = [
    {'y': 0.112, 'rx': 0.120, 'rz': 0.118, 'x': -0.004, 'sx': 0.55},
    {'y': 0.128, 'rx': 0.124, 'rz': 0.121, 'x': -0.004, 'sx': 0.45},
    {'y': 0.178, 'rx': 0.127, 'rz': 0.123, 'x': -0.004, 'sx': 0.12},
    {'y': 0.232, 'rx': 0.120, 'rz': 0.116, 'x': -0.004},
    {'y': 0.276, 'rx': 0.096, 'rz': 0.093, 'x': -0.006},
    {'y': 0.304, 'rx': 0.056, 'rz': 0.054, 'x': -0.008},
]


def player_head():
    """Neck pivot frame; +X is where he looks. A gaiter to the nose, goggles
    over it and a helmet over those: no face, which is both what a freerider
    on a cold day looks like and what keeps a figure this small out of the
    uncanny valley."""
    return head_parts() + helmet_parts() + lamp_parts()


def helmet_parts():
    def helmet_face(y, a, i):
        return 'ink' if i == 0 else 'helmet'
    parts = []
    # the shell, with a liner lip turned up inside its lower edge
    helmet = [dict(HELMET[0], rx=0.104, rz=0.102, y=0.118)] + HELMET
    parts.append(loft(helmet, helmet_face, n=20, dome=(0, 0.02), caps=(True, True)))
    # ridges over the crown, front to back, and a mint stripe at the nape
    for zz in (-0.072, -0.030, 0.030, 0.072):
        path = []
        for k in range(9):
            t = k / 8
            st_y = 0.27 + 0.03 * math.sin(math.pi * t)
            st = station_at(HELMET, min(st_y, 0.300))
            rr = math.sqrt(max(0.0, 1 - (zz / max(st['rz'], 1e-3)) ** 2))
            x = st['x'] + (st['rx'] * rr + 0.002) * math.cos(math.radians(90) * (2 * t - 1) * 0.92)
            y = 0.205 + (0.302 - 0.205) * math.sin(math.pi * (0.12 + 0.76 * t)) * (1.0 - abs(zz) * 2.2)
            path.append((x, y, zz))
        parts.append(sweep(path, rrect(0.010, 0.006, 0.6, 6), 'charcoal',
                           up=lambda p, t: (p[0], p[1] - 0.12, p[2]), sub=0))
    nape = ellipse_pts(-0.004, 0, 0.122, 0.119, 0.168, math.pi - 0.38, math.pi + 0.38, 6, 1.0, 0.002)
    parts.append(sweep(nape, rrect(0.008, 0.003, 0.6, 6), 'trim',
                       up=lambda p, t: (p[0], 0, p[2]), sub=0))
    return parts


def beanie_parts():
    """A knit beanie with a turned-up cuff and a pompom, the same size as the
    helmet so the goggle strap sits on it."""
    parts = [loft([
        {'y': 0.100, 'rx': 0.121, 'rz': 0.118, 'x': -0.006, 'sx': 0.45},
        {'y': 0.170, 'rx': 0.124, 'rz': 0.120, 'x': -0.008, 'sx': 0.10},
        {'y': 0.235, 'rx': 0.118, 'rz': 0.114, 'x': -0.014, 'wob': [(0.025, 9, 0.0)]},
        {'y': 0.285, 'rx': 0.094, 'rz': 0.090, 'x': -0.024, 'wob': [(0.03, 9, 0.0)]},
        {'y': 0.318, 'rx': 0.052, 'rz': 0.050, 'x': -0.034},
    ], 'helmet', n=18, dome=(0, 0.015))]
    parts.append(loft([
        {'y': 0.096, 'rx': 0.127, 'rz': 0.124, 'x': -0.006, 'sx': 0.45},
        {'y': 0.148, 'rx': 0.129, 'rz': 0.126, 'x': -0.006, 'sx': 0.40},
    ], 'trim', n=18))
    parts.append(loft([{'y': -0.03, 'rx': 0.036}, {'y': 0.03, 'rx': 0.036}], 'trim', n=10,
                      dome=(0.02, 0.02)).xf(pos=(-0.040, 0.345, 0.0)))
    return parts


def lamp_parts():
    # The headlamp the night runs light from, on the front of the helmet where
    # `headlamp.js` aims its beam (0.170, 0.205).
    lamp = loft([{'y': -0.016, 'rx': 0.022, 'rz': 0.030, 'rnd': 0.5},
                 {'y': 0.012, 'rx': 0.020, 'rz': 0.027, 'rnd': 0.5}], 'ink', n=12)
    lens = loft([{'y': -0.002, 'rx': 0.013, 'rz': 0.013},
                 {'y': 0.004, 'rx': 0.012, 'rz': 0.012}], 'steel', n=12, sub=0)
    return [lamp.xf(pos=(0.138, 0.205, 0.0), rot=(0, 0, -math.pi / 2)),
            lens.xf(pos=(0.152, 0.205, 0.0), rot=(0, 0, -math.pi / 2))]


def head_parts():
    """The gaiter and the goggles — what every head has under its hat."""
    parts = []
    gaiter = [
        {'y': -0.075, 'rx': 0.068, 'rz': 0.066},
        {'y': -0.005, 'rx': 0.072, 'rz': 0.070, 'wob': [(0.05, 7, 0.4)]},
        {'y': 0.045, 'rx': 0.083, 'rz': 0.077, 'x': 0.010, 'wob': [(0.03, 6, 1.9)]},
        {'y': 0.092, 'rx': 0.090, 'rz': 0.083, 'x': 0.014},
        {'y': 0.130, 'rx': 0.090, 'rz': 0.086, 'x': 0.010},
    ]
    parts.append(loft(gaiter, 'gaiter', n=14))

    # Goggles: a frame round the front, a lens proud of it, a strap round
    # the back of the helmet.
    def band(r0, half_h, depth, a0, a1, steps, bulge=0.0, taper=0.25):
        rings = []
        for i in range(steps + 1):
            t = i / steps
            a = a0 + (a1 - a0) * t
            edge = abs(2 * t - 1)
            hh = half_h * (1 - taper * edge ** 2)
            rr = r0 + bulge * math.cos(math.pi * (t - 0.5))
            sect = ring({'y': 0, 'rx': depth, 'rz': hh, 'rnd': 0.45}, 10)
            rings.append([(math.cos(a) * (rr + px), 0.140 + pz, math.sin(a) * (rr + px))
                          for (px, _, pz) in sect])
        verts = [p for r in rings for p in r]
        faces = []
        for i in range(steps):
            for j in range(10):
                jn = (j + 1) % 10
                faces.append((i * 10 + j, i * 10 + jn, (i + 1) * 10 + jn, (i + 1) * 10 + j))
        faces.append(tuple(reversed(range(10))))
        faces.append(tuple(steps * 10 + j for j in range(10)))
        return verts, faces
    v, f = band(0.112, 0.048, 0.014, -1.22, 1.22, 16)
    parts.append(Part(v, f, ['ink'] * len(f), 1))
    v, f = band(0.124, 0.040, 0.006, -1.12, 1.12, 16, bulge=0.006, taper=0.3)
    parts.append(Part(v, f, ['lens'] * len(f), 1))
    strap = ellipse_pts(-0.004, 0, 0.127, 0.124, 0.142, 1.16, TAU - 1.16, 20, 1.0, 0.004)
    parts.append(sweep(strap, rrect(0.020, 0.0035, 0.5, 8), 'shellDark',
                       up=lambda p, t: (p[0] + 0.004, 0, p[2]), sub=0))
    return parts


def player_upper_arm():
    # +X is the point of the elbow (the rig rolls it there); the inside of the
    # bend, where a sleeve bunches, is −X.
    st = [
        {'y': 0.040, 'rx': 0.072, 'rz': 0.070},
        {'y': -0.040, 'rx': 0.078, 'rz': 0.074},
        {'y': -0.150, 'rx': 0.073, 'rz': 0.069, 'wob': [(0.03, 4, 0.8)]},
        {'y': -0.235, 'rx': 0.068, 'rz': 0.065, 'wob': [(0.08, 3, 0.0, math.pi, 1.3)]},
        {'y': -0.290, 'rx': 0.064, 'rz': 0.062},
    ]
    return [loft(st, lambda y, a, i: 'shellDark' if y > -0.005 else 'shell', n=12, dome=(0.055, 0.04))]


def player_fore_arm(lead):
    """Elbow to fingertips: the bunched elbow, a sleeve, a gold cuff, the glove.
    Built as a right hand — palm towards +Z, thumb forward at −X — and mirrored
    for the lead (left) arm."""
    parts = []
    parts.append(loft([
        {'y': 0.000, 'rx': 0.066, 'rz': 0.064},
        {'y': -0.080, 'rx': 0.063, 'rz': 0.061, 'wob': [(0.05, 5, 0.3)]},
        {'y': -0.150, 'rx': 0.060, 'rz': 0.058, 'wob': [(0.06, 6, 1.7)]},
        {'y': -0.185, 'rx': 0.061, 'rz': 0.059},
    ], 'shell', n=12, dome=(0.088, 0.0), caps=(True, True)))
    # the cuff and its velcro tab
    parts.append(loft([{'y': -0.168, 'rx': 0.064, 'rz': 0.062}, {'y': -0.198, 'rx': 0.062, 'rz': 0.060}],
                      'gold', n=12, sub=0))
    parts.append(loft([{'y': -0.012, 'rx': 0.006, 'rz': 0.022, 'rnd': 0.5},
                       {'y': 0.012, 'rx': 0.006, 'rz': 0.022, 'rnd': 0.5}], 'gold', n=8, sub=0)
                 .xf(pos=(0.040, -0.184, -0.052), rot=(0, -0.9, 0)))
    # the glove: a short gauntlet, then a mitt whose fingers curl to the palm
    parts.append(loft([{'y': -0.190, 'rx': 0.056, 'rz': 0.054},
                       {'y': -0.228, 'rx': 0.052, 'rz': 0.046}], 'ink', n=12))

    def mitt_face(y, a, i):
        return 'charcoal' if math.sin(a) > 0.45 else 'ink'
    parts.append(loft([
        {'y': -0.215, 'rx': 0.044, 'rz': 0.032},
        {'y': -0.248, 'rx': 0.050, 'rz': 0.030, 'x': 0.004, 'z': -0.004},
        {'y': -0.288, 'rx': 0.052, 'rz': 0.028, 'x': 0.006, 'z': -0.004},
        {'y': -0.318, 'rx': 0.049, 'rz': 0.026, 'x': 0.006, 'z': 0.006},
        {'y': -0.338, 'rx': 0.044, 'rz': 0.024, 'x': 0.006, 'z': 0.022},
        {'y': -0.346, 'rx': 0.036, 'rz': 0.020, 'x': 0.006, 'z': 0.036},
    ], mitt_face, n=12))
    thumb = [(-0.032, -0.226, 0.010), (-0.052, -0.252, 0.020), (-0.058, -0.280, 0.032),
             (-0.050, -0.300, 0.042)]
    parts.append(sweep(thumb, rrect(0.016, 0.015, 1.0, 8), 'ink', up=(0, 0, 1),
                       scale=lambda t: (1.0 - 0.25 * t, 1.0 - 0.25 * t)))
    # a mint tab on the back of the hand
    parts.append(loft([{'y': -0.020, 'rx': 0.016, 'rz': 0.003, 'rnd': 0.5},
                       {'y': 0.020, 'rx': 0.016, 'rz': 0.003, 'rnd': 0.5}], 'trim', n=8, sub=0)
                 .xf(pos=(0.004, -0.268, -0.033)))
    if lead:
        for p in parts:
            p.mirror_z()
    return parts


def player_thigh(lead):
    """Hip socket frame; +X the knee. The cargo pocket is on the outside of
    the leg, which is +Z for the rear (right) leg and −Z for the lead."""
    st = [
        {'y': 0.068, 'rx': 0.104, 'rz': 0.104},
        {'y': -0.050, 'rx': 0.117, 'rz': 0.113},
        {'y': -0.180, 'rx': 0.113, 'rz': 0.108, 'wob': [(0.03, 4, 0.5)]},
        {'y': -0.310, 'rx': 0.104, 'rz': 0.099, 'wob': [(0.05, 3, 0.0, math.pi, 1.2)]},
        {'y': -0.420, 'rx': 0.095, 'rz': 0.093},
    ]
    parts = [loft(st, 'trouser', n=14, dome=(0.07, 0.05))]
    pocket = loft([{'y': -0.002, 'rx': 0.044, 'rz': 0.050, 'rnd': 0.5},
                   {'y': 0.016, 'rx': 0.042, 'rz': 0.048, 'rnd': 0.5}], 'pocket', n=12, dome=(0, 0.004))
    parts.append(pocket.xf(pos=(0.006, -0.185, 0.100), rot=(math.pi / 2, 0, 0)))
    flap = loft([{'y': -0.002, 'rx': 0.047, 'rz': 0.016, 'rnd': 0.5},
                 {'y': 0.010, 'rx': 0.046, 'rz': 0.015, 'rnd': 0.5}], 'pocket', n=12, sub=0)
    parts.append(flap.xf(pos=(0.006, -0.130, 0.112), rot=(math.pi / 2, 0, 0)))
    if lead:
        for p in parts:
            p.mirror_z()
    return parts


def player_shin():
    """Knee frame; +X the knee. The ball at the top is the kneecap the bend
    pivots inside; the hem at the bottom is a gaiter stacked over the boot."""
    st = [
        {'y': 0.000, 'rx': 0.094, 'rz': 0.091},
        {'y': -0.100, 'rx': 0.092, 'rz': 0.089},
        {'y': -0.215, 'rx': 0.096, 'rz': 0.093, 'wob': [(0.03, 4, 1.0)]},
        {'y': -0.295, 'rx': 0.106, 'rz': 0.102, 'wob': [(0.05, 5, 0.3)]},
        {'y': -0.350, 'rx': 0.116, 'rz': 0.111, 'wob': [(0.06, 6, 1.4)]},
        {'y': -0.388, 'rx': 0.118, 'rz': 0.113, 'wob': [(0.05, 6, 2.2)]},
        {'y': -0.382, 'rx': 0.098, 'rz': 0.095},
    ]
    # The cage's dome is taller than the ball it smooths into: Catmull-Clark
    # pulls a dome in by about a fifth.
    return [loft(st, lambda y, a, i: 'ink' if i >= 6 else 'trouser', n=14, dome=(0.118, 0))]


BOOT = [
    {'y': 0.010, 'x': 0.035, 'rx': 0.148, 'rz': 0.068, 'rnd': 0.42},
    {'y': 0.042, 'x': 0.037, 'rx': 0.152, 'rz': 0.071, 'rnd': 0.45},
    {'y': 0.086, 'x': 0.030, 'rx': 0.140, 'rz': 0.069, 'rnd': 0.55},
    {'y': 0.132, 'x': 0.012, 'rx': 0.112, 'rz': 0.067, 'rnd': 0.7},
    {'y': 0.192, 'x': -0.002, 'rx': 0.090, 'rz': 0.065, 'rnd': 0.85},
    {'y': 0.250, 'x': -0.006, 'rx': 0.085, 'rz': 0.065, 'rnd': 0.9},
    {'y': 0.290, 'x': -0.008, 'rx': 0.087, 'rz': 0.067, 'rnd': 0.92},
]


def player_boot():
    """Deck frame under the ankle (y = 0 is the deck's top); +X the toes."""
    st = BOOT + [{'y': 0.286, 'x': -0.008, 'rx': 0.070, 'rz': 0.053, 'rnd': 0.9}]
    parts = [loft(st, lambda y, a, i: 'ink' if i == 0 or i >= 6 else 'boot', n=16)]
    # outsole, a little proud all round
    parts.append(loft([{'y': 0.004, 'x': 0.036, 'rx': 0.155, 'rz': 0.074, 'rnd': 0.42},
                       {'y': 0.032, 'x': 0.037, 'rx': 0.157, 'rz': 0.075, 'rnd': 0.42}], 'ink', n=16))
    # the tongue rising out of the cuff, and the lace panel down it
    tongue = [(0.050, 0.110, 0), (0.070, 0.170, 0), (0.078, 0.240, 0), (0.084, 0.300, 0), (0.080, 0.316, 0)]
    parts.append(sweep(tongue, rrect(0.034, 0.010, 0.6, 8), 'boot', up=(1, 0, 0)))
    lace = [(0.060, 0.112, 0), (0.081, 0.170, 0), (0.090, 0.240, 0)]
    parts.append(sweep(lace, rrect(0.012, 0.004, 0.6, 6), 'steel', up=(1, 0, 0), sub=0))
    # padded collar
    collar = surface_ring(BOOT, 0.278, out=0.004, n=18)
    parts.append(sweep(collar, rrect(0.010, 0.014, 1.0, 8), 'boot', up=lambda p, t: (p[0] + 0.008, 0, p[2]), closed=True, caps=False))
    # a dial on the outside of the shaft
    dial = loft([{'y': -0.006, 'rx': 0.018}, {'y': 0.006, 'rx': 0.016}], 'trim', n=10, sub=0)
    for s in (-1, 1):
        parts.append(dial.copy().xf(pos=(-0.010, 0.200, s * 0.070), rot=(s * math.pi / 2, 0, 0)))
    return parts


def player_binding():
    """Deck frame under the ankle, bolted to the board."""
    parts = []
    parts.append(loft([{'y': -0.004, 'x': 0.028, 'rx': 0.136, 'rz': 0.094, 'rnd': 0.45},
                       {'y': 0.014, 'x': 0.028, 'rx': 0.132, 'rz': 0.090, 'rnd': 0.5}], 'ink', n=16))
    # heel cup, round the back of the boot
    cup = ellipse_pts(0.036, 0, 0.160, 0.084, 0.040, 1.25, TAU - 1.25, 14, 0.45, 0.0)
    parts.append(sweep(cup, rrect(0.006, 0.030, 0.5, 8), 'ink', up=(0, 1, 0)))

    # highback: a contoured shell standing behind the calf
    def hb_ring(y, half, r_out):
        st = station_at(BOOT, min(y, 0.29))
        pts = []
        steps = 10
        outer = ellipse_pts(st['x'], 0, st['rx'] + r_out, st['rz'] + r_out, y,
                            math.pi - half, math.pi + half, steps, st['rnd'])
        inner = ellipse_pts(st['x'], 0, st['rx'] + r_out - 0.010, st['rz'] + r_out - 0.010, y,
                            math.pi + half, math.pi - half, steps, st['rnd'])
        pts = outer + inner
        return pts
    rings = [hb_ring(0.05, 1.25, 0.010), hb_ring(0.12, 1.15, 0.010), hb_ring(0.20, 1.05, 0.014),
             hb_ring(0.27, 0.95, 0.020), hb_ring(0.325, 0.78, 0.028), hb_ring(0.340, 0.55, 0.030)]
    m = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    mats = []
    for i in range(len(rings) - 1):
        for j in range(m):
            jn = (j + 1) % m
            faces.append((i * m + j, i * m + jn, (i + 1) * m + jn, (i + 1) * m + j))
            mats.append('trim' if i >= 4 else 'ink')
    faces.append(tuple(reversed(range(m))))
    mats.append('ink')
    last = len(rings) - 1
    faces.append(tuple(last * m + j for j in range(m)))
    mats.append('trim')
    parts.append(Part(verts, faces, mats, 1))

    # ankle strap over the instep, padded, sloping down to the front
    def ankle_drop(a):
        return 0.045 * (1 - math.cos(a) ** 2) - 0.010
    st = station_at(BOOT, 0.150)
    ankle = ellipse_pts(st['x'], 0, st['rx'], st['rz'], 0.150, -1.75, 1.75, 16, st['rnd'], 0.009,
                        ydrop=ankle_drop)
    parts.append(sweep(ankle, rrect(0.030, 0.008, 0.6, 10), 'gold',
                       up=lambda p, t: (p[0] - 0.012, 0.25, p[2])))
    # toe cap strap over the toe box
    st = station_at(BOOT, 0.070)
    toe = ellipse_pts(st['x'], 0, st['rx'], st['rz'], 0.074, -1.15, 1.15, 12, st['rnd'], 0.006,
                      ydrop=lambda a: -0.015 * (1 - math.cos(a)))
    parts.append(sweep(toe, rrect(0.015, 0.005, 0.6, 8), 'gold',
                       up=lambda p, t: (p[0] - 0.03, 0.3, p[2])))
    # ratchets where the straps meet the heel cup
    for s in (-1, 1):
        parts.append(loft([{'y': -0.012, 'rx': 0.026, 'rz': 0.008, 'rnd': 0.4},
                           {'y': 0.012, 'rx': 0.026, 'rz': 0.008, 'rnd': 0.4}], 'charcoal', n=8, sub=0)
                     .xf(pos=(-0.030, 0.150, s * 0.088), rot=(0, 0, 0.5)))
    return parts



# ===========================================================================
# THE OTHER PEOPLE
#
# The NPCs are the player's own kit, recoloured to roles the game fills per
# figure and posed into a skier's or a boarder's stance by the two-bone
# solver below. Each figure is two rigid halves, exactly as
# `mountainLife.js` draws them: a deck that stays on the snow (skis or board,
# bindings, boots, shins and thighs) and a body hinged at the hip. The
# headgear and the pack are separate nodes so the game can mix them per
# figure before it bakes the body.
#
# Figure frame: the figure faces −Z (downhill), +X is its right hand side,
# y = 0 is the snow. The body is authored in the same frame; the game moves
# it down by the hip height to hang it on its pivot.
# ===========================================================================

NPC_ROLES = {
    'shell': 'npcJacket', 'shellDark': 'npcAccent', 'trim': 'npcAccent', 'gold': 'npcAccent',
    'ink': 'npcHard', 'charcoal': 'npcDetail', 'boot': 'npcHard', 'trouser': 'npcTrouser',
    'pocket': 'npcTrouser', 'gaiter': 'npcTrouser', 'steel': 'npcPale', 'pack': 'npcAccent',
    'packDark': 'npcDetail', 'packLight': 'npcPale', 'helmet': 'npcHelmet', 'lens': 'npcLens',
}
SKIER_HIP = 0.80
BOARDER_HIP = 0.86
BOARDER_OPEN = 0.45   # radians the boarder's hips and chest open towards the nose


def recolour(parts, roles=NPC_ROLES):
    for p in parts:
        p.mats = [roles.get(m, m) for m in p.mats]
    return parts


def placed(parts, m):
    for p in parts:
        p.apply(m)
    return parts


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Ry(a):
    return Matrix.Rotation(a, 4, 'Y')


def Rz(a):
    return Matrix.Rotation(a, 4, 'Z')


def basis(origin, x, y):
    x = Vector(x).normalized()
    y = Vector(y)
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    return Matrix(((x.x, y.x, z.x, origin[0]), (x.y, y.y, z.y, origin[1]),
                   (x.z, y.z, z.z, origin[2]), (0, 0, 0, 1)))


def two_bone(root, target, a, b, pole):
    """The rig's own solver (`riderModel.js#solve`), with the roll it now
    takes: each bone's +X faces the bend."""
    root, target, pole = Vector(root), Vector(target), Vector(pole)
    d = target - root
    f = d.normalized()
    reach = min(max(d.length, abs(a - b) + 0.05), (a + b) * 0.999)
    u = (pole - f * pole.dot(f)).normalized()
    c = max(-1.0, min(1.0, (a * a + reach * reach - b * b) / (2 * a * reach)))
    e = root + f * (a * c) + u * (a * math.sqrt(1 - c * c))
    hand = root + f * reach
    out = []
    for p0, p1 in ((root, e), (e, hand)):
        y = -(p1 - p0).normalized()
        x = u - y * u.dot(y)
        out.append(basis(p0, x, y))
    return out


def align_y(p0, p1):
    """A frame at p0 whose +Y runs to p1."""
    y = (Vector(p1) - Vector(p0)).normalized()
    x = Vector((1, 0, 0)) if abs(y.x) < 0.9 else Vector((0, 0, 1))
    return basis(p0, x - y * x.dot(y), y)


SKI = [   # z, half width, base height, thickness
    (-0.870, 0.016, 0.082, 0.006), (-0.845, 0.046, 0.062, 0.007), (-0.795, 0.058, 0.034, 0.009),
    (-0.700, 0.061, 0.009, 0.012), (-0.420, 0.053, 0.000, 0.016), (-0.120, 0.045, 0.000, 0.018),
    (0.200, 0.047, 0.000, 0.017), (0.540, 0.054, 0.000, 0.014), (0.720, 0.057, 0.010, 0.011),
    (0.790, 0.054, 0.024, 0.008), (0.815, 0.028, 0.030, 0.006),
]


def slab_loft(table, top_role, base_role, n=12, sub=1, nose_role=None, tail_role=None):
    """A thin blade along Z — a ski or a board — whose top face wears one role
    and whose base and sidewalls wear another."""
    rings = []
    for z, w, b, t in table:
        rings.append([(px, b + t / 2 + pz, z) for (px, pz) in rrect(w, t / 2, 0.25, n)])
    verts = [p for r in rings for p in r]
    faces, mats = [], []
    for i in range(len(rings) - 1):
        zc = 0.5 * (table[i][0] + table[i + 1][0])
        for j in range(n):
            jn = (j + 1) % n
            faces.append((i * n + j, i * n + jn, (i + 1) * n + jn, (i + 1) * n + j))
            top = math.sin((j + 0.5) / n * TAU) > 0.3
            role = top_role if top else base_role
            if top and nose_role and zc < table[0][0] + 0.17:
                role = nose_role
            if top and tail_role and zc > table[-1][0] - 0.17:
                role = tail_role
            mats.append(role)
    faces.append(tuple(reversed(range(n))))
    mats.append(base_role)
    faces.append(tuple((len(rings) - 1) * n + j for j in range(n)))
    mats.append(base_role)
    return Part(verts, faces, mats, sub)


SKI_BOOT = [
    {'y': 0.000, 'x': 0.030, 'rx': 0.158, 'rz': 0.054, 'rnd': 0.5},
    {'y': 0.030, 'x': 0.030, 'rx': 0.160, 'rz': 0.058, 'rnd': 0.55},
    {'y': 0.075, 'x': 0.026, 'rx': 0.145, 'rz': 0.062, 'rnd': 0.62},
    {'y': 0.120, 'x': 0.012, 'rx': 0.110, 'rz': 0.064, 'rnd': 0.78},
    {'y': 0.185, 'x': 0.016, 'rx': 0.090, 'rz': 0.064, 'rnd': 0.88},
    {'y': 0.250, 'x': 0.030, 'rx': 0.086, 'rz': 0.062, 'rnd': 0.9},
    {'y': 0.300, 'x': 0.044, 'rx': 0.084, 'rz': 0.060, 'rnd': 0.92},
]


def ski_boot(right):
    """Binding frame under the ankle; +X the toes. A hard shell leaning
    forward, buckles down the outside, a power strap round the cuff."""
    st = SKI_BOOT + [{'y': 0.296, 'x': 0.044, 'rx': 0.068, 'rz': 0.048, 'rnd': 0.9}]
    parts = [loft(st, lambda y, a, i: 'npcHard' if i == 0 or i >= 7 else 'npcBoot', n=14)]
    parts.append(loft([{'y': -0.004, 'x': 0.030, 'rx': 0.166, 'rz': 0.058, 'rnd': 0.45},
                       {'y': 0.022, 'x': 0.030, 'rx': 0.166, 'rz': 0.060, 'rnd': 0.45}], 'npcHard', n=14))
    strap = surface_ring(SKI_BOOT, 0.276, out=0.004, n=16)
    parts.append(sweep(strap, rrect(0.004, 0.016, 0.6, 6), 'npcHard',
                       up=(0, 1, 0), closed=True, caps=False, sub=0))
    for y, a in ((0.075, 0.55), (0.135, 0.75), (0.200, 0.95), (0.255, 1.05)):
        stt = station_at(SKI_BOOT, y)
        p = ellipse_pts(stt['x'], 0, stt['rx'], stt['rz'], y, a, a, 1, stt['rnd'], 0.006)[0]
        parts.append(loft([{'y': -0.008, 'rx': 0.020, 'rz': 0.006, 'rnd': 0.4},
                           {'y': 0.008, 'rx': 0.020, 'rz': 0.006, 'rnd': 0.4}], 'npcPale', n=8, sub=0)
                     .xf(pos=p, rot=(0, -a + math.pi / 2, 0)))
    if not right:
        for p in parts:
            p.mirror_z()
    return parts


def ski_binding():
    """Ski frame, centred under the boot's sole."""
    parts = [loft([{'y': 0.018, 'rx': 0.045, 'rz': 0.165, 'rnd': 0.5},
                   {'y': 0.050, 'rx': 0.042, 'rz': 0.160, 'rnd': 0.5}], 'npcHard', n=10, sub=0)
             .xf(pos=(0, 0, -0.085))]
    parts.append(loft([{'y': 0.040, 'rx': 0.040, 'rz': 0.040, 'rnd': 0.5},
                       {'y': 0.085, 'rx': 0.034, 'rz': 0.034, 'rnd': 0.6}], 'npcPale', n=10)
                 .xf(pos=(0, 0, -0.280)))
    parts.append(loft([{'y': 0.040, 'rx': 0.040, 'rz': 0.050, 'rnd': 0.5},
                       {'y': 0.105, 'rx': 0.034, 'rz': 0.044, 'rnd': 0.6}], 'npcPale', n=10)
                 .xf(pos=(0, 0, 0.115)))
    return parts


def npc_skier():
    deck, body = [], []
    ankle_z = -0.06
    for side in (-1, 1):
        x = side * 0.125
        deck.append(slab_loft(SKI, 'npcAccent', 'npcBase', n=12, sub=1).xf(pos=(x, 0, 0)))
        deck += placed(ski_binding(), T(x, 0, 0))
        deck += placed(ski_boot(side > 0), T(x, 0.052, ankle_z) @ Ry(math.pi / 2))
        thigh, shin = two_bone((side * 0.105, SKIER_HIP, 0.02), (x, 0.162, ankle_z),
                               THIGH, SHIN, (side * 0.12, 0.0, -1.0))
        deck += placed(recolour(player_thigh(side < 0)), thigh)
        deck += placed(recolour(player_shin()), shin)

    waist = T(0, SKIER_HIP + WAIST, 0) @ Ry(math.pi / 2)
    torso = waist @ Rz(-0.42)
    body += placed(recolour(player_pelvis()), waist @ Rz(-0.18))
    body += placed(recolour(jacket_parts(pocket=False)), torso)
    neck = torso @ Vector((0, NECK_Y, 0))
    head = T(*neck) @ Ry(math.pi / 2) @ Rz(0.08)
    body += placed(recolour(head_parts()), head)
    for side in (-1, 1):
        shoulder = torso @ Vector((0, SHOULDER_Y, side * SHOULDER_Z))
        hand = Vector((side * 0.265, 0.905, -0.40))
        upper, fore = two_bone(shoulder, hand, UPPER, FORE, (side * 0.55, -0.35, 0.75))
        body += placed(recolour(player_upper_arm()), upper)
        body += placed(recolour(player_fore_arm(side < 0)), fore)
        basket = Vector((side * 0.38, 0.10, 0.30))
        frame = align_y(hand, basket)
        body += placed([
            loft([{'y': -0.075, 'rx': 0.018}, {'y': 0.055, 'rx': 0.021}], 'npcDetail', n=8, dome=(0.008, 0.006)),
            loft([{'y': 0.050, 'rx': 0.008}, {'y': (basket - hand).length + 0.08, 'rx': 0.006}],
                 'npcPale', n=6, sub=0),
            loft([{'y': (basket - hand).length - 0.004, 'rx': 0.042},
                  {'y': (basket - hand).length + 0.004, 'rx': 0.040}], 'npcDetail', n=10, sub=0),
        ], frame)
    gear = {
        'helmet': placed(recolour(helmet_parts()), head),
        'beanie': placed(recolour(beanie_parts()), head),
        'pack': placed(recolour(pack_parts()), torso),
    }
    return deck, body, gear


def npc_boarder():
    deck, body = [], []
    deck += recolour(preview_deck_parts('npcAccent', 'npcBase', 'npcBase', 'npcBase'))
    for z, yaw, lead in ((-FOOT_Z, 0.28, True), (FOOT_Z, 0.10, False)):
        m = T(FOOT_X, DECK_TOP, z) @ Ry(yaw)
        deck += placed(recolour(player_binding()), m)
        deck += placed(recolour(player_boot()), m)
    hips = T(0, BOARDER_HIP, 0) @ Ry(BOARDER_OPEN)
    for z, lead in ((-FOOT_Z, True), (FOOT_Z, False)):
        sock = hips @ Vector((0, 0, (-1 if lead else 1) * HIP_Z))
        thigh, shin = two_bone(sock, (FOOT_X, ANKLE_Y, z), THIGH, SHIN, (1.0, 0.1, (-0.5 if lead else 0.5)))
        deck += placed(recolour(player_thigh(lead)), thigh)
        deck += placed(recolour(player_shin()), shin)

    waist = hips @ T(0, WAIST, 0)
    torso = waist @ Rz(-0.20)
    body += placed(recolour(player_pelvis()), waist)
    body += placed(recolour(jacket_parts(pocket=False)), torso)
    neck = torso @ Vector((0, NECK_Y, 0))
    head = T(*neck) @ Ry(math.pi / 2) @ Rz(-0.06)
    body += placed(recolour(head_parts()), head)
    for lead, hand, pole in ((True, (0.20, 0.98, -0.34), (-0.7, -0.3, -0.45)),
                             (False, (0.08, 0.96, 0.30), (-0.7, -0.3, 0.45))):
        shoulder = torso @ Vector((0, SHOULDER_Y, (-1 if lead else 1) * SHOULDER_Z))
        upper, fore = two_bone(shoulder, hand, UPPER, FORE, pole)
        body += placed(recolour(player_upper_arm()), upper)
        body += placed(recolour(player_fore_arm(lead)), fore)
    gear = {
        'helmet': placed(recolour(helmet_parts()), head),
        'beanie': placed(recolour(beanie_parts()), head),
        'pack': placed(recolour(pack_parts()), torso),
    }
    return deck, body, gear


NPC_BUDGET = {'deck': 1500, 'body': 2000, 'helmet': 260, 'beanie': 260, 'pack': 300}


def build_npcs():
    col = collection('npc')
    clear_collection(col)
    out = {}
    for kind, build, hip in (('skier', npc_skier, SKIER_HIP), ('boarder', npc_boarder, BOARDER_HIP)):
        deck, body, gear = build()
        out['npc_%s_deck' % kind] = realise('npc_%s_deck' % kind, deck, col, budget=NPC_BUDGET['deck'])
        out['npc_%s_body' % kind] = realise('npc_%s_body' % kind, body, col, budget=NPC_BUDGET['body'])
        for g, parts in gear.items():
            name = 'npc_%s_%s' % (kind, g)
            out[name] = realise(name, parts, col, budget=NPC_BUDGET[g])
        # The hinge the body swings on travels with the file, as glTF extras,
        # so the game reads it rather than keeping a second copy of it.
        for name, ob in out.items():
            if name.startswith('npc_%s_' % kind):
                ob['hip'] = hip
    for ob in out.values():
        ob.hide_render = True
        ob.hide_set(True)
    return out


# ===========================================================================
# Building, previewing, exporting
# ===========================================================================

def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if not col:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def clear_collection(col):
    for ob in list(col.objects):
        me = ob.data
        bpy.data.objects.remove(ob)
        if me and me.users == 0 and isinstance(me, bpy.types.Mesh):
            bpy.data.meshes.remove(me)


# Triangles per segment. Arms, legs, boots and bindings are drawn twice, so
# the rider costs about 13.8k of these plus the board's deck.
PLAYER_BUDGET = {
    'pelvis': 400, 'torso': 3000, 'head': 1600, 'upperArm': 600, 'foreArm': 900,
    'thigh': 600, 'shin': 600, 'boot': 800, 'binding': 900,
}


def build_player():
    col = collection('rider')
    clear_collection(col)
    out = {}
    for name, parts, budget in (
        ('rider_pelvis', player_pelvis(), PLAYER_BUDGET['pelvis']),
        ('rider_torso', player_torso(), PLAYER_BUDGET['torso']),
        ('rider_head', player_head(), PLAYER_BUDGET['head']),
        ('rider_upperArm', player_upper_arm(), PLAYER_BUDGET['upperArm']),
        ('rider_foreArm_lead', player_fore_arm(True), PLAYER_BUDGET['foreArm']),
        ('rider_foreArm_rear', player_fore_arm(False), PLAYER_BUDGET['foreArm']),
        ('rider_thigh_lead', player_thigh(True), PLAYER_BUDGET['thigh']),
        ('rider_thigh_rear', player_thigh(False), PLAYER_BUDGET['thigh']),
        ('rider_shin', player_shin(), PLAYER_BUDGET['shin']),
        ('rider_boot', player_boot(), PLAYER_BUDGET['boot']),
        ('rider_binding', player_binding(), PLAYER_BUDGET['binding']),
    ):
        out[name] = realise(name, parts, col, budget=budget)
    for ob in out.values():
        ob.hide_render = True
        ob.hide_set(True)
    return out


# ---------------------------------------------------------------------------
# Preview: a turnaround sheet, posed exactly as the game's rig poses him.
#
# `pose` is a dict of three.js Matrix4.elements (column-major) for each
# segment relative to the rider's root, dumped from `window.__alpen.model`
# mid-run. The limbs' roll is replaced by the bend-plane roll the rig now
# applies, so the sheet shows the knees and elbows where the game will.
# ---------------------------------------------------------------------------

C_THREE = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def m3(e):
    return Matrix(((e[0], e[4], e[8], e[12]), (e[1], e[5], e[9], e[13]),
                   (e[2], e[6], e[10], e[14]), (0, 0, 0, 1)))


def to_blender(m):
    return C_THREE @ m @ C_THREE.inverted()


def bend_roll(upper, fore, len_fore):
    """Rebuild a two-bone chain's rotations so +X faces the bend."""
    s = upper.to_translation()
    e = fore.to_translation()
    hand = e + (fore.to_3x3() @ Vector((0, -1, 0))) * len_fore
    reach = (hand - s).normalized()
    u = (e - s) - reach * (e - s).dot(reach)
    out = []
    for m, a, b in ((upper, s, e), (fore, e, hand)):
        y = -(b - a).normalized()
        x = u - y * u.dot(y)
        if x.length < 1e-6:
            x = m.to_3x3() @ Vector((1, 0, 0))
            x = x - y * x.dot(y)
        x.normalize()
        z = x.cross(y)
        r = Matrix(((x.x, y.x, z.x, a.x), (x.y, y.y, z.y, a.y), (x.z, y.z, z.z, a.z), (0, 0, 0, 1)))
        out.append(r)
    return out


DECK_COARSE = [
    (-0.800, 0.048, 0.140, 0.0050), (-0.715, 0.100, 0.105, 0.0070), (-0.605, 0.140, 0.069, 0.0090),
    (-0.470, 0.155, 0.041, 0.0110), (-0.250, 0.142, 0.029, 0.0130), (0.000, 0.131, 0.035, 0.0135),
    (0.250, 0.142, 0.029, 0.0130), (0.450, 0.154, 0.041, 0.0110), (0.600, 0.138, 0.070, 0.0090),
    (0.705, 0.098, 0.106, 0.0070), (0.780, 0.046, 0.138, 0.0050),
]


def preview_deck_parts(top='deck', base='ink', nose='trim', tail='ink'):
    table = [(z, rx, b, t + 0.004) for (z, rx, b, t) in DECK_COARSE]
    return [slab_loft(table, top, base, n=12, sub=2, nose_role=nose, tail_role=tail)]


def preview_deck():
    return preview_deck_parts()


def pose_rider(models, pose, parent, deck_ob):
    P = {k: m3(v) for k, v in pose.items()}
    ua, fa = bend_roll(P['upperArmLead'], P['foreArmLead'], FORE)
    ur, fr = bend_roll(P['upperArmRear'], P['foreArmRear'], FORE)
    tl, sl = bend_roll(P['thighLead'], P['shinLead'], SHIN)
    tr, sr = bend_roll(P['thighRear'], P['shinRear'], SHIN)
    T = Matrix.Translation
    Ry = lambda a: Matrix.Rotation(a, 4, 'Y')
    place = [
        ('rider_pelvis', P['pelvis']), ('rider_torso', P['torso']), ('rider_head', P['head']),
        ('rider_upperArm', ua), ('rider_foreArm_lead', fa),
        ('rider_upperArm', ur), ('rider_foreArm_rear', fr),
        ('rider_thigh_lead', tl), ('rider_shin', sl), ('rider_thigh_rear', tr), ('rider_shin', sr),
        ('rider_binding', P['board'] @ T((FOOT_X, DECK_TOP, -FOOT_Z)) @ Ry(0.28)),
        ('rider_boot', P['board'] @ T((FOOT_X, DECK_TOP, -FOOT_Z)) @ Ry(0.28)),
        ('rider_binding', P['board'] @ T((FOOT_X, DECK_TOP, FOOT_Z)) @ Ry(0.10)),
        ('rider_boot', P['rearBoot'] @ T((FOOT_X, DECK_TOP, 0)) @ Ry(0.10)),
    ]
    col = parent.users_collection[0]
    for name, m in place:
        ob = bpy.data.objects.new(name + '.pv', models[name].data)
        col.objects.link(ob)
        ob.parent = parent
        ob.matrix_basis = to_blender(m)
    ob = bpy.data.objects.new('deck.pv', deck_ob.data)
    col.objects.link(ob)
    ob.parent = parent
    ob.matrix_basis = to_blender(P['board'])


def stage(res=(2200, 900), ortho=6.2, target=(0, 0, 0.85), cam_dist=12.0, cam_h=1.5):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    col = collection('stage')
    clear_collection(col)
    for ob in list(col.objects):
        bpy.data.objects.remove(ob)
    # snow floor
    me = bpy.data.meshes.new('floor')
    me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(material('snow'))
    fl = bpy.data.objects.new('floor', me)
    col.objects.link(fl)
    # sun + fill
    for name, energy, rot, ang in (('sun', 4.2, (0.85, 0.0, -0.75), 0.06), ('fill', 0.9, (1.1, 0.0, 2.4), 0.5)):
        ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.angle = ang
        lo = bpy.data.objects.new(name, ld)
        col.objects.link(lo)
        lo.rotation_euler = rot
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    if hasattr(world, 'use_nodes'):
        world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.42, 0.55, 0.78, 1)
    bg.inputs[1].default_value = 0.9
    cd = bpy.data.cameras.get('sheet') or bpy.data.cameras.new('sheet')
    cd.type = 'ORTHO'
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new('sheet', cd)
    col.objects.link(cam)
    cam.location = (target[0], target[1] - cam_dist, target[2] + cam_h)
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    return col


def preview_closeup(pose_path, out_path, yaw=-35, lens=50, dist=3.6, height=1.45, res=(1400, 1400)):
    """One rider, in perspective from three-quarters in front."""
    models = {ob.name: ob for ob in collection('rider').objects}
    pose = json.load(open(pose_path))
    pv = collection('preview')
    clear_collection(pv)
    for ob in list(pv.objects):
        bpy.data.objects.remove(ob)
    deck = realise('_deck', preview_deck(), collection('_scratch'))
    deck.hide_render = True
    root = bpy.data.objects.new('rider.pv.close', None)
    pv.objects.link(root)
    root.rotation_euler = (0, 0, math.radians(yaw))
    pose_rider(models, pose, root, deck)
    stage(res=res, target=(0, 0, 0.78))
    cam = bpy.context.scene.camera
    cam.data.type = 'PERSP'
    cam.data.lens = lens
    cam.location = (0, -dist, height)
    d = Vector((0, 0, 0.80)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    return out_path


def preview_player(pose_path, out_path, views=(0, -90, 90, 180)):
    """Four copies of the posed rider in a row: the chase camera's view of
    him (from up the hill, behind the tail), his front, his back, the nose."""
    models = {ob.name: ob for ob in collection('rider').objects}
    if not models:
        models = build_player()
    pose = json.load(open(pose_path))
    pv = collection('preview')
    clear_collection(pv)
    for ob in list(pv.objects):
        bpy.data.objects.remove(ob)
    deck = realise('_deck', preview_deck(), collection('_scratch'))
    deck.hide_render = True
    spacing = 1.85
    for k, ang in enumerate(views):
        root = bpy.data.objects.new('rider.pv.%d' % k, None)
        pv.objects.link(root)
        root.location = ((k - (len(views) - 1) / 2) * spacing, 0, 0)
        root.rotation_euler = (0, 0, math.radians(ang))
        pose_rider(models, pose, root, deck)
    stage(ortho=spacing * len(views) + 0.2, target=(0, 0, 0.78), cam_h=3.2)
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    return out_path



# The palettes `mountainLife.js` dresses its eight riders in, so the preview
# shows the figures the game will actually draw.
NPC_JACKETS = ['#e64a19', '#1976d2', '#2e7d32', '#f57c00', '#7b1fa2', '#0097a7', '#c2185b', '#37474f']
NPC_ACCENTS = ['#fff3e0', '#0d47a1', '#dcedc8', '#212121', '#ffd54f', '#004d40', '#f8bbd0', '#ff6f00']
NPC_TROUSERS = ['#162342', '#20252e', '#28303d', '#1a1e26']
NPC_GOGGLES = ['#00e1ff', '#ff7700', '#33ff88', '#ff3388']
NPC_HELMETS = ['#1b1f27', '#f0f4f8', '#2b3444', '#90a4ae']


def npc_dress(i):
    return {
        'npcJacket': NPC_JACKETS[i % 8], 'npcAccent': NPC_ACCENTS[(i * 5 + 2) % 8],
        'npcTrouser': NPC_TROUSERS[i % 4], 'npcHelmet': NPC_HELMETS[(i * 3) % 4],
        'npcBoot': NPC_HELMETS[(i * 3) % 4], 'npcLens': NPC_GOGGLES[i % 4],
    }


def tinted(ob, colours, tag):
    me = ob.data.copy()
    for k, mat in enumerate(me.materials):
        role = mat.name.split('.')[0]
        if role in colours:
            name = role + '.' + tag
            m = bpy.data.materials.get(name) or mat.copy()
            m.name = name
            rgba = hex_rgba(colours[role])
            m.diffuse_color = rgba
            m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = rgba
            me.materials[k] = m
    return me


def preview_npcs(out_path, yaw=150, count=8, spacing=1.3, res=(2600, 760), cam_h=2.4):
    models = {ob.name: ob for ob in collection('npc').objects}
    if not models:
        models = build_npcs()
    pv = collection('preview')
    clear_collection(pv)
    for ob in list(pv.objects):
        bpy.data.objects.remove(ob)
    for i in range(count):
        kind = 'skier' if i % 2 == 0 else 'boarder'
        root = bpy.data.objects.new('npc.pv.%d' % i, None)
        pv.objects.link(root)
        root.location = ((i - (count - 1) / 2) * spacing, 0, 0)
        root.rotation_euler = (0, 0, math.radians(yaw))
        hip = SKIER_HIP if kind == 'skier' else BOARDER_HIP
        pieces = ['deck', 'body', 'beanie' if i % 4 == 3 else 'helmet']
        if i % 3 == 1:
            pieces.append('pack')
        dress = npc_dress(i)
        for piece in pieces:
            src = models['npc_%s_%s' % (kind, piece)]
            ob = bpy.data.objects.new(src.name + '.pv', tinted(src, dress, str(i)))
            pv.objects.link(ob)
            ob.parent = root
    stage(res=res, ortho=spacing * count + 0.3, target=(0, 0, 0.8), cam_h=cam_h)
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    return out_path


def export(out_dir):
    """Write rider.glb and npcs.glb. Materials go out under their role names
    and carry nothing the game reads but that name; each node stays at the
    origin in its own segment's frame."""
    os.makedirs(out_dir, exist_ok=True)
    written = {}
    for col_name, file_name in (('rider', 'rider.glb'), ('npc', 'npcs.glb')):
        col = collection(col_name)
        for ob in bpy.context.view_layer.objects:
            ob.select_set(False)
        for ob in col.objects:
            ob.hide_set(False)
            ob.select_set(True)
        path = os.path.join(out_dir, file_name)
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True,
            export_apply=True, export_yup=True, export_normals=True,
            export_texcoords=False, export_materials='EXPORT',
            export_animations=False, export_skins=False, export_morph=False,
            export_extras=True, export_cameras=False, export_lights=False,
        )
        for ob in col.objects:
            ob.select_set(False)
            ob.hide_set(True)
        written[file_name] = os.path.getsize(path)
    return written


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    build_player()
    build_npcs()
    if '--out' in args:
        print(export(args[args.index('--out') + 1]))
