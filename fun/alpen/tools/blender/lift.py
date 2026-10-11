"""Alpen lift and snow guns — the gondola line over the rocky band and the fan
guns along the piste edge, built in Blender.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/lift.py -- --out fun/alpen/assets/models/resort

Run from the repository root; writes `lift.glb`. `--preview DIR` also
renders a turnaround of every piece into DIR, in Cycles on the CPU, so it
runs anywhere (EEVEE needs a GPU a sandbox will not hand over).

Five nodes, each drawn by one of the InstancedMeshes `js/mountainLife.js`
already keeps, so the resort costs no more draw calls than it did:

  * lift_cabin — a modern eight-seat detachable gondola cabin of the
    Doppelmayr / CWA Omega kind: a tall body with rounded corners and a
    slight tumblehome, a wraparound band of glazing broken by slim pillars,
    a double sliding door on the outboard side under its rail, a rubbing
    strake round the lower body, a domed roof with the hanger's fairing, the
    hanger arm swinging out round the sheave trains and in again to a
    detachable grip on the rope — jaws, spring pack, the carriage and its
    running wheels. Snow lies on the roof.
  * lift_cabinGlass — the glazing alone, so the game can keep the cabins'
    own glass material (dark by day, lit warm at night).
  * lift_tower — a tapered tubular steel tower on a concrete plinth: base
    flange with gussets and anchor nuts, two bolted section flanges, a
    T-head crossarm with stiffeners, the brackets the sheave trains hang
    from, a grated maintenance deck round the head with toe boards and a
    two-rail balustrade, and a ladder with a fall-arrest rail that starts
    out of reach of the ground. Snow on the plinth, the deck and the arm.
  * lift_sheaves — one sheave train: six rubber-lined sheaves cantilevered
    off rocker plates on a balance beam, the pivot the tower's bracket
    holds, and a rope catcher along the outboard side. Every sheave's
    corners carry its own axle (`_AXLE`), so the game turns each one about
    itself in the vertex shader while the train as a whole is pitched to
    the rope.
  * snowgun — a fan gun on a tilting tower: concrete footing, hinged mast
    with its hydraulic ram, slewing ring, yoke, the yellow fan housing with
    the blue nose and nozzle ring, stator and hub inside, grille behind,
    the water manifold, the control cabinet with its beacon, and the
    hydrant pit the hose and the cable come out of. Snow on the footing,
    the pit, the cabinet and along the top of the housing.

THE COORDINATES ARE THE GAME'S. Everything here is written in three.js
space (+Y up, −Z down the hill), the way `riders.py` does it, and every
node sits at its own origin with no transform:

  cabin   the rope runs along Z at y = CABIN_ROPE_Y above the origin; the
          body hangs below. Door on +X, which the game turns to face
          outboard on either rope.
  tower   the origin is the mast's mid-height; the ground is at
          TOWER_GROUND_Y and the ropes at y = TOWER_ROPE_Y, x = ±GAUGE.
  sheaves the origin is the rope's centre over the middle of the train;
          the rope runs along Z, +X is outboard.
  snowgun the origin is the foot on the ground; the barrel points +Z,
          raised by GUN_ELEVATION.

Those numbers are the contract with `mountainLife.js` and go out as node
extras, which the game checks before it swaps anything in. Colour is not
baked: every face carries a material whose name is its role, and the game's
look table decides what a role is drawn as.
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import riders  # noqa: E402
from riders import (  # noqa: E402
    B, Part, loft, sweep, material, collection, clear_collection,
)

TAU = math.tau

# ---------------------------------------------------------------------------
# The contract with js/mountainLife.js
# ---------------------------------------------------------------------------

ROPE_R = 0.05            # the rope's radius as the game draws it
CABIN_ROPE_Y = 1.70      # cabin: the rope above the cabin's origin
TOWER_GROUND_Y = -11.0   # tower: the ground under the mast's mid-height
TOWER_ROPE_Y = 10.5      # tower: the ropes over it (ground + 21.5)
GAUGE = 1.8              # tower: the ropes either side of the mast
GUN_ELEVATION = 0.35     # snow gun: the barrel's rise, radians

# Preview colours only; the game paints every role from its own table.
PALETTE_PREVIEW = {
    'concrete': '#9c9b95', 'liftSteel': '#77818a', 'liftDark': '#3a4249',
    'liftGrating': '#59626a', 'liftRail': '#8d969c', 'liftSign': '#e9edf0',
    'trainFrame': '#4d5861', 'sheaveWheel': '#a9b2b8', 'sheaveHole': '#6f7880',
    'sheaveLiner': '#17191c',
    'cabinPaint': '#b73b2d', 'cabinRoof': '#b4bec5', 'cabinFloor': '#26333c',
    'cabinFrame': '#1b2127', 'cabinTrim': '#c4ced4', 'rubber': '#1a1d22',
    'hanger': '#5b636b', 'grip': '#8e979d', 'gripDark': '#3b4148', 'glass': '#1a3450',
    'gunHousing': '#e3a90c', 'gunAccent': '#1f5ab8', 'gunTrim': '#2a3036',
    'gunInterior': '#15181c', 'gunHub': '#8a949b', 'gunGrille': '#3d444b',
    'gunNozzle': '#2a63c4', 'gunNozzleTip': '#c2cbd0', 'gunCabinet': '#34576b',
    'gunScreen': '#0e1a22', 'gunLamp': '#ff8a1f', 'gunLid': '#4b5a4f',
    'hose': '#1c1f23', 'cable': '#101214', 'snow': '#f1f5f9',
}
GLOSSY_PREVIEW = {'glass', 'cabinPaint', 'gunHousing', 'gunAccent', 'gunNozzle', 'gunNozzleTip',
                  'sheaveWheel', 'cabinTrim', 'gunCabinet', 'gunLamp'}


# ---------------------------------------------------------------------------
# A hard-surface kit on top of the riders' one. Nothing here is smoothed by
# subdivision: steel has edges, so every bevel is modelled as a chamfer and
# the shading is left to the smoothing angle.
# ---------------------------------------------------------------------------

def box_profile(w, h, c=0.0):
    """A rectangle, half-extents w × h, its corners chamfered by c."""
    if c <= 0:
        return [(w, h), (-w, h), (-w, -h), (w, -h)]
    return [(w, h - c), (w - c, h), (-w + c, h), (-w, h - c),
            (-w, -h + c), (-w + c, -h), (w - c, -h), (w, -h + c)]


def circle(r, n, a0=0.0):
    return [(r * math.cos(a0 + k / n * TAU), r * math.sin(a0 + k / n * TAU)) for k in range(n)]


def bar(p0, p1, w, h, role, up=(0, 1, 0), c=0.0, caps=True):
    """A straight member from p0 to p1. `w` is across (tangent × up), `h`
    along `up`."""
    return sweep([p0, p1], box_profile(w, h, c), role, up=up, caps=caps, sub=0)


def tube(path, r, role, n=8, up=(0, 1, 0), caps=True):
    return sweep(path, circle(r, n), role, up=up, caps=caps, sub=0)


def drape(p0, p1, profile, up=(0, 1, 0), steps=6):
    """Snow laid from p0 to p1: a swept mound whose profile runs from one
    buried edge over the top to the other, thinning out at both ends the way
    a drift on a beam does. It has no underside and no end caps — the
    surface it lies on hides the one, and the taper does away with the other,
    which on a round housing would have stood its straight bottom edge out
    through the shell and into the bore."""
    a, b = Vector(p0), Vector(p1)
    path = [tuple(a.lerp(b, k / (steps - 1))) for k in range(steps)]

    def taper(t):
        e = min(t, 1 - t) / 0.18
        f = 0.04 + 0.96 * (1 - (1 - min(1.0, e)) ** 2)
        return f, f
    part = sweep(path, profile, 'snow', up=up, scale=taper, caps=False, sub=0)
    m = len(profile)
    keep = [k for k in range(len(part.faces)) if k % m != m - 1]
    part.faces = [part.faces[k] for k in keep]
    part.mats = [part.mats[k] for k in keep]
    return part


def lathe(profile, n, role, closed=False, a0=0.0):
    """Turn a profile [(r, h), …] about +Y. A point at r = 0 is a single
    apex rather than a ring of coincident ones. `role` is a role or a
    function (segment, step round) → role, which is how a sheave gets its
    lightening holes and a housing its stripe."""
    rings, verts = [], []
    for r, h in profile:
        if r <= 1e-9:
            rings.append([len(verts)])
            verts.append((0.0, h, 0.0))
        else:
            ids = []
            for j in range(n):
                a = a0 + j / n * TAU
                ids.append(len(verts))
                verts.append((r * math.cos(a), h, r * math.sin(a)))
            rings.append(ids)
    pick = role if callable(role) else (lambda k, j: role)
    faces, mats = [], []
    segs = len(rings) if closed else len(rings) - 1
    for k in range(segs):
        lo, hi = rings[k], rings[(k + 1) % len(rings)]
        for j in range(n):
            jn = (j + 1) % n
            if len(lo) == 1 and len(hi) == 1:
                continue
            if len(lo) == 1:
                faces.append((lo[0], hi[j], hi[jn]))
            elif len(hi) == 1:
                faces.append((lo[j], hi[0], lo[jn]))
            else:
                faces.append((lo[j], hi[j], hi[jn], lo[jn]))
            mats.append(pick(k, j))
    return Part(verts, faces, mats, sub=0)


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rx(a):
    return Matrix.Rotation(a, 4, 'X')


def Ry(a):
    return Matrix.Rotation(a, 4, 'Y')


def Rz(a):
    return Matrix.Rotation(a, 4, 'Z')


# A lathe turned about +Y, laid along +X instead: the axle of a wheel.
ALONG_X = Rz(-math.pi / 2)


def plate(points, z0, z1, role):
    """A flat polygon [(x, y), …] in the XY plane, thickened from z0 to z1."""
    n = len(points)
    verts = [(x, y, z0) for x, y in points] + [(x, y, z1) for x, y in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return Part(verts, faces, [role] * len(faces), sub=0)


def spun(part, a):
    """Turn a part about the vertical axis by a, from +X towards +Z."""
    return part.apply(Ry(-a))


# ---------------------------------------------------------------------------
# Writing a node
# ---------------------------------------------------------------------------

def outward(part):
    """A part's faces, wound to face out of it. Blender makes the winding
    agree across each piece, but which way is out it can only guess on an
    open surface — a cup of snow, a roof with no floor, a glazing band — and
    it guesses wrong often enough to matter, because the game culls back
    faces and an inside-out roof is a hole. So the part decides: wound
    outwards, its faces look away from its own centre."""
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in part.verts]
    bm.verts.index_update()
    faces = [bm.faces.new([vs[i] for i in f]) for f in part.faces]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    centre = sum((v.co for v in vs), Vector()) / len(vs)
    facing = sum((f.calc_center_median() - centre).dot(f.normal) * f.calc_area() for f in faces)
    out = []
    for f in faces:
        idx = [v.index for v in f.verts]
        out.append(tuple(reversed(idx)) if facing < 0 else tuple(idx))
    bm.free()
    return out


def forge(name, parts, col, sharp=40):
    """Weld parts into one mesh object `name`, one material per role, each
    part turned outwards on its own. A part may carry `axle` (y, z, 1) — the
    sheave it belongs to — which goes out as `_AXLE` on every one of its
    corners."""
    verts, faces, roles, axle = [], [], [], []
    has_axles = False
    for part in parts:
        base = len(verts)
        verts.extend(B(v) for v in part.verts)
        a = getattr(part, 'axle', None)
        has_axles = has_axles or a is not None
        axle.extend([tuple(a) if a else (0.0, 0.0, 0.0)] * len(part.verts))
        faces.extend(tuple(base + i for i in f) for f in outward(part))
        roles.extend(part.mats)
    order = list(dict.fromkeys(roles))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for r in order:
        me.materials.append(material(r))
    me.polygons.foreach_set('material_index', [order.index(r) for r in roles])
    me.shade_smooth()
    if hasattr(me, 'set_sharp_from_angle'):
        me.set_sharp_from_angle(angle=math.radians(sharp))
    if has_axles:
        attr = me.attributes.new('_AXLE', 'FLOAT_VECTOR', 'POINT')
        attr.data.foreach_set('vector', [c for v in axle for c in v])
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ===========================================================================
# THE CABIN
#
# An eight-seat cabin is about 2.3 m long in the direction of travel, 1.8 m
# across and 2.3 m tall over the body: two benches of four facing each other
# across the length, the door in the middle of a long side. The plan is a
# superellipse — flat sides, big rounded corners where the glass wraps —
# and the section has the slight tumblehome of the real thing: widest at the
# waist, drawn in under the roof, tucked round under the floor.
# ===========================================================================

CAB_A, CAB_B = 0.89, 1.15        # half-width (X) and half-length (Z)
CAB_RND = 0.40                   # superellipse exponent: rounded-rectangle corners
CAB_N = 24
CAB_A0 = math.pi / CAB_N         # no corner on an axis, so the flat sides stay flat

# y, scale, the role of the strip above (None: open, the glass is there; on
# the last station of a capped loft, the role of the cap)
CAB_LOW = [
    (-2.32, 0.78, 'cabinFloor'),
    (-2.27, 0.89, 'cabinFloor'),
    (-2.17, 0.968, 'cabinPaint'),
    (-1.90, 1.000, 'rubber'),
    (-1.865, 1.012, 'rubber'),    # the rubbing strake, a centimetre proud
    (-1.83, 1.000, 'cabinPaint'),
    (-1.47, 1.000, 'cabinFrame'),  # the glazing's rubber seal
    (-1.43, 0.998, None),
]
CAB_GLASS = [(-1.43, 0.998), (-0.90, 0.992), (-0.34, 0.966)]
CAB_ROOF = [
    (-0.34, 0.966, 'cabinFrame'),
    (-0.30, 0.963, 'cabinRoof'),
    (-0.13, 0.946, 'cabinRoof'),
    (-0.04, 0.905, 'cabinRoof'),
    (0.035, 0.780, 'cabinRoof'),
    (0.080, 0.520, 'cabinRoof'),   # the lid
]
CAB_PROFILE = ([(y, s) for y, s, _ in CAB_LOW] + CAB_GLASS[1:-1] + [(y, s) for y, s, _ in CAB_ROOF])


def cab_scale(y):
    for (y0, s0), (y1, s1) in zip(CAB_PROFILE, CAB_PROFILE[1:]):
        if y0 <= y <= y1:
            return s0 + (s1 - s0) * (y - y0) / (y1 - y0)
    return CAB_PROFILE[-1][1]


def roof_y(s):
    """Height of the roof at plan scale s (inside the roof edge)."""
    pts = [(s_, y) for y, s_, _ in CAB_ROOF[2:]]
    for (s0, y0), (s1, y1) in zip(pts, pts[1:]):
        if s1 <= s <= s0:
            return y0 + (y1 - y0) * (s0 - s) / (s0 - s1)
    return pts[-1][1]


def cab_station(y, s):
    return {'y': y, 'rx': CAB_A * s, 'rz': CAB_B * s, 'rnd': CAB_RND, 'a0': CAB_A0}


def se_point(t, a, b):
    c, s = math.cos(t), math.sin(t)
    return a * math.copysign(abs(c) ** CAB_RND, c), b * math.copysign(abs(s) ** CAB_RND, s)


def se_normal(x, z, a, b):
    p = 2.0 / CAB_RND
    nx = math.copysign(abs(x / a) ** (p - 1), x) / a
    nz = math.copysign(abs(z / b) ** (p - 1), z) / b
    n = math.hypot(nx, nz) or 1.0
    return nx / n, nz / n


def shell_at(y, side=None, z=None, t=None):
    """A point on the cabin's skin at height y — on the flat side (`side`,
    `z`) or at superellipse angle `t` — and its outward normal in plan."""
    s = cab_scale(y)
    a, b = CAB_A * s, CAB_B * s
    if t is None:
        p = 2.0 / CAB_RND
        x = side * a * max(0.0, 1 - abs(z / b) ** p) ** (1 / p)
    else:
        x, z = se_point(t, a, b)
    nx, nz = se_normal(x, z, a, b)
    return Vector((x, y, z)), Vector((nx, 0.0, nz))


def on_skin(points, w, proud, role, sunk=0.004):
    """A strip laid on the skin along `points` [(pos, normal)…]: w across,
    standing `proud` out of it — a pillar, a seam, a rail."""
    ups = [n for _, n in points]
    path = [tuple(p) for p, _ in points]
    prof = [(w, -sunk), (-w, -sunk), (-w, proud), (w, proud)]
    count = len(path)
    return sweep(path, prof, role, up=lambda p, t: tuple(ups[round(t * (count - 1))]), sub=0)


def cabin_parts():
    parts = []
    low = [cab_station(y, s) for y, s, _ in CAB_LOW]
    roles = [r for _, _, r in CAB_LOW]
    parts.append(loft(low, lambda y, a, i: roles[i], n=CAB_N, caps=(True, False), sub=0))
    roof = [cab_station(y, s) for y, s, _ in CAB_ROOF]
    rroles = [r for _, _, r in CAB_ROOF]
    parts.append(loft(roof, lambda y, a, i: rroles[i], n=CAB_N, caps=(False, True), sub=0))

    # Pillars over the glass: the door jambs and their twins opposite, and one
    # at each corner where the panoramic end glazing meets the side.
    span = [-1.43, -0.90, -0.34]
    for side in (-1, 1):
        for z in (-0.56, 0.56):
            parts.append(on_skin([shell_at(y, side, z) for y in span], 0.034, 0.016, 'cabinFrame'))
    for t in (0.74, math.pi - 0.74, math.pi + 0.74, TAU - 0.74):
        parts.append(on_skin([shell_at(y, t=t) for y in span], 0.030, 0.016, 'cabinFrame'))
    # The door: a seam down the middle of the glass and three down the panel
    # under it, and the rail it slides out along over the roof band.
    parts.append(on_skin([shell_at(y, 1, 0.0) for y in span], 0.018, 0.012, 'cabinFrame'))
    for z in (-0.56, 0.0, 0.56):
        parts.append(on_skin([shell_at(y, 1, z) for y in (-2.12, -1.865, -1.47)], 0.009, 0.006, 'cabinFrame'))
    rail = [shell_at(-0.25, 1, z) for z in (-1.0, -0.62, -0.25, 0.12, 0.5, 0.88)]
    parts.append(on_skin(rail, 0.028, 0.035, 'grip'))

    # The cabin's number, on both ends of the panel under the glass.
    for sz in (-1, 1):
        p, n = shell_at(-1.64, t=sz * math.pi / 2)
        parts.append(bar(tuple(p - n * 0.004), tuple(p + n * 0.008), 0.15, 0.085, 'liftSign', up=(0, 1, 0)))

    # The hanger's fairing on the roof, and the hanger: up off the roof,
    # out round the sheave trains and back in over the rope to the grip.
    parts.append(loft([
        {'y': 0.030, 'rx': 0.30, 'rz': 0.66, 'rnd': 0.55},
        {'y': 0.140, 'rx': 0.29, 'rz': 0.64, 'rnd': 0.55},
        {'y': 0.190, 'rx': 0.20, 'rz': 0.50, 'rnd': 0.6},
    ], 'cabinRoof', n=12, caps=(False, True), sub=0))
    parts.append(tube([(0, 0.21, -0.48), (0, 0.21, 0.48)], 0.04, 'hanger', n=8, up=(0, 1, 0)))
    hanger = [(0.0, 0.15, 0), (0.0, 0.40, 0), (0.05, 0.68, 0), (0.22, 0.98, 0), (0.38, 1.22, 0),
              (0.43, 1.44, 0), (0.38, 1.62, 0), (0.24, 1.73, 0)]
    parts.append(tube(hanger, 0.05, 'hanger', n=6, up=(0, 0, 1)))

    # The grip, on the rope: jaws round it, the spring pack outboard, the
    # carriage on top with the running wheels the station's rails take.
    ry = CABIN_ROPE_Y
    parts.append(bar((0.03, ry + 0.03, -0.21), (0.03, ry + 0.03, 0.21), 0.10, 0.12, 'gripDark', c=0.025))
    parts.append(tube([(0.20, ry + 0.05, -0.25), (0.20, ry + 0.05, 0.25)], 0.065, 'grip', n=10))
    parts.append(bar((0.05, ry + 0.185, -0.30), (0.05, ry + 0.185, 0.30), 0.12, 0.03, 'grip', c=0.01))
    for z in (-0.20, 0.20):
        wheel = lathe([(0, -0.025), (0.058, -0.025), (0.058, 0.025), (0, 0.025)], 8, 'gripDark')
        parts.append(wheel.apply(T(0.05, ry + 0.27, z) @ ALONG_X))
    parts.append(bar((0.27, ry + 0.0, -0.26), (0.30, ry + 0.13, -0.40), 0.025, 0.02, 'gripDark', up=(1, 0, 0)))

    # Snow on the roof, its edge tucked under the roof's own shoulder.
    snow = [(0.90, -0.006), (0.80, 0.034), (0.40, 0.036)]
    parts.append(loft([cab_station(roof_y(s) + dy, s) for s, dy in snow], 'snow', n=CAB_N,
                      caps=(False, True), sub=0))
    return parts


def glass_parts():
    return [loft([cab_station(y, s) for y, s in CAB_GLASS], 'glass', n=CAB_N, caps=(False, False), sub=0)]


# ===========================================================================
# THE TOWER
#
# A line tower of a detachable gondola, twenty-two metres to the rope: a
# tapered steel tube in three bolted sections on a concrete plinth, a T-head
# crossarm with the sheave trains hung from brackets under its ends, and a
# grated deck round the head for the people who grease the sheaves. The
# ladder starts two and a half metres up, so nobody climbs it off the piste.
# ===========================================================================

T_R0, T_R1 = 0.50, 0.34     # mast radius over the base flange / under the head
T_FOOT = -10.49             # top of the base flange
T_HEAD = 11.10              # underside of the crossarm
ARM_Y, ARM_HALF = 11.35, 2.05
DECK_Y = 9.70
BRACKET_X = GAUGE - 0.25    # the trains hang from their inboard side
PIVOT_Y = TOWER_ROPE_Y - 0.10


def mast_r(y):
    return T_R0 + (T_R1 - T_R0) * (y - T_FOOT) / (T_HEAD - T_FOOT)


def tower_parts():
    parts = []
    a16 = math.pi / 16
    # The plinth runs two metres under the ground at the mast, so the slope
    # never shows its underside.
    parts.append(loft([{'y': TOWER_GROUND_Y - 2.0, 'rx': 1.05, 'rnd': 0.12, 'a0': a16},
                       {'y': -10.62, 'rx': 1.05, 'rnd': 0.12, 'a0': a16},
                       {'y': -10.55, 'rx': 0.99, 'rnd': 0.12, 'a0': a16}],
                      'concrete', n=16, caps=(False, True), sub=0))
    parts.append(lathe([(0.80, -10.55), (0.80, T_FOOT), (T_R0, T_FOOT)], 16, 'liftSteel'))
    for k in range(8):
        g = plate([(T_R0 - 0.01, T_FOOT), (0.76, T_FOOT), (T_R0 - 0.01, T_FOOT + 0.62)], -0.012, 0.012,
                  'liftSteel')
        # plate() lies in XY; turn it into the radial plane at its bearing
        parts.append(spun(g, (k + 0.5) / 8 * TAU))
        nut = lathe([(0.045, T_FOOT), (0.045, T_FOOT + 0.05), (0, T_FOOT + 0.05)], 6, 'liftDark')
        a = k / 8 * TAU
        parts.append(nut.apply(T(0.69 * math.cos(a), 0, 0.69 * math.sin(a))))

    # The mast: one taper, three sections bolted at two flanges.
    parts.append(lathe([(T_R0, T_FOOT), (mast_r(-3.6), -3.6), (mast_r(4.0), 4.0), (T_R1, T_HEAD)], 16,
                       'liftSteel'))
    for y in (-3.6, 4.0):
        r = mast_r(y)
        parts.append(lathe([(r, y - 0.035), (r + 0.075, y - 0.035), (r + 0.075, y + 0.035), (r, y + 0.035)],
                           16, 'liftSteel'))
    parts.append(lathe([(T_R1, 10.95), (T_R1 + 0.05, 11.0), (T_R1 + 0.05, T_HEAD - 0.06), (0, T_HEAD - 0.06)], 16,
                       'liftSteel'))
    parts.append(bar((0, T_HEAD - 0.03, -0.45), (0, T_HEAD - 0.03, 0.45), 0.45, 0.03, 'liftSteel'))

    # The head: crossarm, its end plates, the stiffeners under it either
    # side of the mast, and the brackets the trains hang from.
    parts.append(bar((-ARM_HALF, ARM_Y, 0), (ARM_HALF, ARM_Y, 0), 0.23, 0.25, 'liftSteel', c=0.035))
    for s in (-1, 1):
        parts.append(bar((s * ARM_HALF, ARM_Y, 0), (s * (ARM_HALF + 0.025), ARM_Y, 0), 0.27, 0.29, 'liftSteel'))
        gus = plate([(s * (T_R1 - 0.02), T_HEAD), (s * 0.95, T_HEAD), (s * (T_R1 - 0.02), T_HEAD - 0.62)],
                    -0.015, 0.015, 'liftSteel')
        parts.append(gus)
        x = s * BRACKET_X
        parts.append(bar((x, T_HEAD, 0), (x, PIVOT_Y + 0.05, 0), 0.05, 0.10, 'liftSteel', up=(0, 0, 1), c=0.015))
        eye = lathe([(0, -0.07), (0.075, -0.07), (0.075, 0.07), (0, 0.07)], 10, 'liftSteel')
        parts.append(eye.apply(T(x, PIVOT_Y, 0) @ ALONG_X))

    # The maintenance deck round the head, under the trains.
    parts.append(bar((-1.40, DECK_Y - 0.025, 0), (1.40, DECK_Y - 0.025, 0), 0.85, 0.025, 'liftGrating'))
    # toe boards round the edge, outside it rather than flush with it
    for z in (-0.86, 0.86):
        parts.append(bar((-1.418, DECK_Y + 0.045, z), (1.418, DECK_Y + 0.045, z), 0.008, 0.07, 'liftSteel'))
    for x in (-1.41, 1.41):
        parts.append(bar((x, DECK_Y + 0.045, -0.856), (x, DECK_Y + 0.045, 0.856), 0.008, 0.07, 'liftSteel'))
    for z in (-0.55, 0.55):
        parts.append(bar((-1.38, DECK_Y - 0.10, z), (1.38, DECK_Y - 0.10, z), 0.04, 0.05, 'liftSteel'))
    for sx in (-1, 1):
        for z in (-0.55, 0.55):
            y0 = DECK_Y - 1.15
            r0 = mast_r(y0)
            d = Vector((sx * 1.30, 0, z)).normalized()
            parts.append(bar((d.x * r0, y0, d.z * r0), (sx * 1.30, DECK_Y - 0.13, z), 0.025, 0.025, 'liftSteel',
                             up=(0, 0, 1) if abs(d.z) < 0.9 else (1, 0, 0)))
    for x in (-1.37, -0.46, 0.46, 1.37):
        for z in (-0.82, 0.82):
            parts.append(bar((x, DECK_Y, z), (x, DECK_Y + 1.10, z), 0.022, 0.022, 'liftRail', up=(0, 0, 1)))
    loop = [(-1.37, -0.72), (-1.27, -0.82), (1.27, -0.82), (1.37, -0.72),
            (1.37, 0.72), (1.27, 0.82), (-1.27, 0.82), (-1.37, 0.72)]
    for y in (DECK_Y + 1.10, DECK_Y + 0.55):
        parts.append(sweep([(x, y, z) for x, z in loop], box_profile(0.02, 0.02), 'liftRail', up=(0, 1, 0),
                           closed=True, caps=False, sub=0))

    # The ladder up the uphill face, following the taper, with a fall-arrest
    # rail up its middle and a grab-height past the deck.
    y0, y1 = TOWER_GROUND_Y + 2.4, DECK_Y + 1.0

    def zl(y):
        return mast_r(min(y, T_HEAD)) + 0.20
    for sx in (-0.21, 0.21):
        parts.append(bar((sx, y0, zl(y0)), (sx, y1, zl(y1)), 0.012, 0.035, 'liftRail', up=(0, 0, 1)))
    parts.append(bar((0, y0, zl(y0) + 0.012), (0, y1 - 0.4, zl(y1 - 0.4) + 0.012), 0.015, 0.012, 'liftDark',
                     up=(0, 0, 1)))
    y = y0 + 0.25
    while y < DECK_Y - 0.12:
        parts.append(tube([(-0.21, y, zl(y)), (0.21, y, zl(y))], 0.016, 'liftRail', n=3, caps=False))
        y += 0.28
    for yb in (-8.0, -5.0, -2.0, 1.0, 4.0, 7.0):
        parts.append(bar((0, yb, mast_r(yb) - 0.02), (0, yb, zl(yb)), 0.23, 0.02, 'liftSteel'))

    # The tower's number plate, beside the ladder where the piste can read it.
    a = math.radians(48)
    d = Vector((math.sin(a), 0, math.cos(a)))
    r = mast_r(-7.6)
    parts.append(bar(tuple(d * (r - 0.01) + Vector((0, -7.6, 0))), tuple(d * (r + 0.012) + Vector((0, -7.6, 0))),
                     0.16, 0.21, 'liftSign'))

    # Snow: banked on the plinth round the foot, lying on the deck, along the arm.
    parts.append(loft([{'y': -10.565, 'rx': 0.985, 'rnd': 0.12, 'a0': a16},
                       {'y': -10.50, 'rx': 0.95, 'rnd': 0.12, 'a0': a16},
                       {'y': -10.465, 'rx': 0.86, 'rnd': 0.12, 'a0': a16}], 'snow', n=16, caps=(False, True), sub=0))
    parts.append(loft([{'y': DECK_Y - 0.005, 'rx': 1.34, 'rz': 0.80, 'rnd': 0.18, 'a0': a16},
                       {'y': DECK_Y + 0.035, 'rx': 1.30, 'rz': 0.76, 'rnd': 0.18, 'a0': a16}],
                      'snow', n=16, caps=(False, True), sub=0))
    mound = [(0.185, -0.012), (0.14, 0.045), (0.0, 0.065), (-0.14, 0.045), (-0.185, -0.012)]
    parts.append(drape((-ARM_HALF + 0.08, ARM_Y + 0.25, 0), (ARM_HALF - 0.08, ARM_Y + 0.25, 0), mound))
    return parts


# ===========================================================================
# THE SHEAVE TRAIN
#
# Six line sheaves of 456 mm over the flanges, rubber-lined, on 560 mm
# centres: three rocker plates of two, pinned to a balance beam that swings
# on the bracket's pin. Everything that holds a sheave is on the inboard
# side, because the grip passes on the outboard one; the rope catcher runs
# along that side, low, to take the rope if it ever jumps the groove.
# The rope bends over a support tower, so the sheaves follow a shallow
# vee of TRAIN_BEND — the angle the game's own sagging ropes turn through
# at a tower — and the rope lies on every one of them.
# ===========================================================================

SHEAVES = 6
SHEAVE_PITCH = 0.56
SHEAVE_RG = 0.200     # rope seat
SHEAVE_RF = 0.228     # over the flanges
SHEAVE_W = 0.05       # half the width at the flanges
TRAIN_BEND = 0.09


def sheave_axles():
    out = []
    for k in range(SHEAVES):
        z = (k - (SHEAVES - 1) / 2) * SHEAVE_PITCH
        out.append((-ROPE_R - SHEAVE_RG - abs(z) * math.tan(TRAIN_BEND / 2), z))
    return out


def sheave():
    """One sheave about +Y: the inboard web, the vee of the liner, and the
    outboard web, whose five dark lightening holes are what shows it turn."""
    def role(k, j):
        if k in (1, 2):
            return 'sheaveLiner'
        if k == 3 and j % 2:
            return 'sheaveHole'
        return 'sheaveWheel'
    return lathe([(0, -0.060), (SHEAVE_RF, -SHEAVE_W), (SHEAVE_RG, 0.0), (SHEAVE_RF, SHEAVE_W), (0, 0.068)],
                 10, role)


def sheave_parts():
    parts = []
    axles = sheave_axles()
    for y, z in axles:
        s = sheave().apply(T(0, y, z) @ ALONG_X)
        s.axle = (y, z, 1.0)
        parts.append(s)
    beam_y = axles[SHEAVES // 2][0] - 0.02
    for m in range(SHEAVES // 2):
        (ya, za), (yb, zb) = axles[2 * m], axles[2 * m + 1]
        yc, zc = (ya + yb) / 2, (za + zb) / 2
        tilt = math.atan2(-(yb - ya), zb - za)
        p = bar((-0.105, 0, 0), (-0.07, 0, 0), SHEAVE_PITCH / 2 + 0.085, 0.07, 'trainFrame')
        parts.append(p.apply(T(0, yc, zc) @ Rx(tilt)))
    parts.append(bar((-0.145, beam_y, -1.74), (-0.145, beam_y, 1.74), 0.04, 0.06, 'trainFrame', c=0.012))
    parts.append(bar((-0.17, beam_y, 0), (-0.17, -0.10, 0), 0.04, 0.10, 'trainFrame', up=(0, 0, 1)))
    # the pin the bracket's eye holds, standing a little proud of it both ends
    boss = lathe([(0, -0.10), (0.06, -0.10), (0.06, 0.10), (0, 0.10)], 8, 'trainFrame')
    parts.append(boss.apply(T(-0.235, -0.10, 0) @ ALONG_X))
    catcher = [(0.17, -0.10, -1.84), (0.17, -0.17, -1.60), (0.17, -0.17, 1.60), (0.17, -0.10, 1.84)]
    parts.append(sweep(catcher, box_profile(0.012, 0.035), 'trainFrame', up=(0, 1, 0), sub=0))
    for s in (-1, 1):
        z = s * 1.72
        arm = [(-0.17, beam_y, z), (0.17, beam_y, z), (0.17, -0.17, z)]
        parts.append(sweep(arm, box_profile(0.02, 0.02), 'trainFrame', up=(0, 0, 1), sub=0))
    return parts


# ===========================================================================
# THE SNOW GUN
#
# A fan gun on a tilting tower, the way the big Alpine resorts stand them
# along a piste: the housing is a short fat barrel round a fan, the water is
# atomised at the ring of nozzles round its nose and thrown forty metres by
# the air behind it. The tower hinges at the foot and a hydraulic ram lays
# it down for service; the head slews on a ring and the yoke sets the
# elevation. Yellow housing, blue nose and nozzle ring.
# ===========================================================================

GUN_Y = 4.85                 # the trunnion axis over the foot
GUN_R = 0.585                # housing, outside
NOZZLE_S = 0.795             # the nozzle ring, along the barrel from the trunnion
NOZZLE_R = 0.552


def barrel_frame():
    """The barrel's frame: +Y along the barrel, +X the trunnion axis, −Z the
    top of the housing."""
    return T(0, GUN_Y, 0) @ Rx(math.pi / 2 - GUN_ELEVATION)


def gun_parts():
    parts = []
    a8 = math.pi / 8
    # Footing and its snow.
    parts.append(loft([{'y': -1.20, 'rx': 0.48, 'rnd': 0.12, 'a0': a8}, {'y': 0.15, 'rx': 0.48, 'rnd': 0.12, 'a0': a8},
                       {'y': 0.20, 'rx': 0.45, 'rnd': 0.12, 'a0': a8}], 'concrete', n=8, caps=(False, True), sub=0))
    parts.append(loft([{'y': 0.195, 'rx': 0.445, 'rnd': 0.12, 'a0': a8}, {'y': 0.25, 'rx': 0.43, 'rnd': 0.12, 'a0': a8},
                       {'y': 0.27, 'rx': 0.36, 'rnd': 0.12, 'a0': a8}], 'snow', n=8, caps=(False, True), sub=0))

    # The tilting tower: base plate, hinge, mast, ram.
    parts.append(bar((0, 0.22, -0.46), (0, 0.22, 0.25), 0.25, 0.02, 'liftSteel'))
    for x in (-0.13, 0.13):
        parts.append(bar((x, 0.24, 0), (x, 0.44, 0), 0.015, 0.09, 'liftSteel', up=(0, 0, 1)))
    pin = lathe([(0, -0.16), (0.035, -0.16), (0.035, 0.16), (0, 0.16)], 8, 'liftSteel')
    parts.append(pin.apply(T(0, 0.36, 0) @ ALONG_X))
    parts.append(lathe([(0, 0.30), (0.135, 0.30), (0.135, 0.46), (0.12, 0.48)], 12, 'liftSteel'))
    parts.append(lathe([(0.12, 0.48), (0.105, 3.96)], 12, 'liftSteel'))
    foot, top = Vector((0, 0.27, -0.42)), Vector((0, 1.45, -0.11))
    parts.append(bar(tuple(foot + Vector((0, -0.03, 0))), tuple(foot + Vector((0, 0.03, 0))), 0.04, 0.05, 'liftSteel',
                     up=(0, 0, 1)))
    parts.append(bar((0, 1.45, -0.095), (0, 1.45, -0.16), 0.04, 0.05, 'liftSteel', up=(0, 1, 0)))
    parts.append(tube([tuple(foot), tuple(foot.lerp(top, 0.6))], 0.042, 'gunAccent', n=8, up=(1, 0, 0)))
    parts.append(tube([tuple(foot.lerp(top, 0.55)), tuple(top)], 0.02, 'gunNozzleTip', n=6, up=(1, 0, 0)))

    # The head: slewing ring, yoke, trunnion.
    parts.append(lathe([(0.095, 3.95), (0.22, 3.99), (0.22, 4.10), (0, 4.10)], 12, 'liftSteel'))
    yoke = [(-0.66, GUN_Y + 0.05, 0), (-0.66, 4.20, 0), (-0.60, 4.13, 0), (0.60, 4.13, 0), (0.66, 4.20, 0),
            (0.66, GUN_Y + 0.05, 0)]
    parts.append(sweep(yoke, box_profile(0.045, 0.085), 'liftSteel', up=(0, 0, 1), sub=0))
    # stub trunnions, one each side: an axle straight through would cross the bore
    for sx in (-1, 1):
        stub = lathe([(0, 0.56), (0.06, 0.56), (0.06, 0.72), (0, 0.72)], 10, 'liftSteel')
        parts.append(stub.apply(T(0, GUN_Y, 0) @ ALONG_X @ Rz(0 if sx > 0 else math.pi)))

    # The housing, turned about the barrel: rear lip, yellow body, blue nose,
    # and the bore inside it.
    F = barrel_frame()
    body = [(0.505, -0.86, 'gunTrim'), (0.545, -0.86, 'gunTrim'), (0.583, -0.80, 'gunHousing'),
            (GUN_R, 0.40, 'gunAccent'), (0.558, 0.66, 'gunAccent'), (0.548, 0.77, 'gunInterior'),
            (0.508, 0.77, 'gunInterior'), (0.516, 0.55, 'gunInterior'), (0.516, -0.70, 'gunInterior')]
    parts.append(lathe([(r, s) for r, s, _ in body], 24, lambda k, j: body[k][2], closed=True).apply(F))
    # inside: the hub with its spinner, the stator vanes, the grille behind
    parts.append(lathe([(0, -0.42), (0.15, -0.30), (0.17, -0.10), (0.12, 0.05), (0, 0.10)], 12,
                       'gunHub').apply(F))
    for k in range(6):
        a = (k + 0.25) / 6 * TAU
        c, s = math.cos(a), math.sin(a)
        parts.append(bar((0.16 * c, -0.05, 0.16 * s), (0.515 * c, -0.05, 0.515 * s), 0.008, 0.07, 'gunHub').apply(F))
    parts.append(lathe([(0, -0.815), (0.512, -0.815), (0.512, -0.800), (0, -0.800)], 20, 'gunGrille').apply(F))
    for a in (0.0, math.pi / 2):
        c, s = math.cos(a), math.sin(a)
        parts.append(bar((-0.52 * c, -0.83, -0.52 * s), (0.52 * c, -0.83, 0.52 * s), 0.018, 0.012,
                         'liftSteel').apply(F))
    # the nozzle ring round the nose and its nozzles
    ring = [(NOZZLE_R * math.cos(k / 24 * TAU), NOZZLE_S, NOZZLE_R * math.sin(k / 24 * TAU)) for k in range(24)]
    parts.append(sweep(ring, box_profile(0.028, 0.032), 'gunNozzle', up=(0, 1, 0), closed=True, caps=False,
                       sub=0).apply(F))
    for k in range(10):
        a = (k + 0.5) / 10 * TAU
        tip = lathe([(0.012, 0.0), (0.008, 0.035), (0, 0.04)], 3, 'gunNozzleTip')
        parts.append(tip.apply(F @ T(NOZZLE_R * math.cos(a), NOZZLE_S + 0.03, NOZZLE_R * math.sin(a))))
    # the water manifold along the left flank, fed from the mast
    man = [(-0.40, -0.62, 0.45), (-0.40, 0.52, 0.45), (-0.36, 0.76, 0.40)]
    parts.append(tube(man, 0.022, 'liftSteel', n=6, up=(0, 0, 1)).apply(F))
    rear = F @ Vector(man[0])
    feed = [(-0.13, 3.90, -0.05), (-0.13, 4.02, -0.05), (-0.24, 4.00, -0.24), (-0.36, 4.08, rear.z + 0.06),
            tuple(rear)]
    parts.append(tube(feed, 0.035, 'hose', n=8, up=(1, 0, 0)))
    parts.append(tube([(-0.13, 0.48, -0.05), (-0.13, 3.90, -0.05)], 0.028, 'liftSteel', n=6, up=(1, 0, 0)))
    # the elevation ram under the barrel
    lo, hi = Vector((0.28, 4.17, 0.05)), F @ Vector((0.28, 0.45, 0.53))
    parts.append(tube([tuple(lo), tuple(lo.lerp(hi, 0.6))], 0.035, 'gunAccent', n=6, up=(1, 0, 0)))
    parts.append(tube([tuple(lo.lerp(hi, 0.55)), tuple(hi)], 0.018, 'gunNozzleTip', n=6, up=(1, 0, 0)))
    # snow along the top of the housing
    mound = [(0.30, -0.09), (0.20, 0.022), (0.0, 0.045), (-0.20, 0.022), (-0.30, -0.09)]
    parts.append(drape((0, -0.74, -GUN_R), (0, 0.42, -GUN_R), mound, up=(0, 0, -1)).apply(F))

    # The control cabinet on the mast, its screen, handle and beacon.
    parts.append(bar((0.12, 1.25, 0), (0.12, 1.95, 0), 0.02, 0.18, 'liftSteel', up=(0, 0, 1)))
    parts.append(bar((0.27, 1.20, 0), (0.27, 2.00, 0), 0.13, 0.26, 'gunCabinet', up=(0, 0, 1), c=0.02))
    parts.append(bar((0.28, 2.02, 0), (0.28, 2.05, 0), 0.16, 0.30, 'gunCabinet', up=(0, 0, 1)))
    parts.append(bar((0.402, 1.78, 0.08), (0.402, 1.90, 0.08), 0.006, 0.07, 'gunScreen', up=(0, 0, 1)))
    parts.append(bar((0.407, 1.50, -0.18), (0.407, 1.64, -0.18), 0.012, 0.015, 'liftSteel', up=(0, 0, 1)))
    beacon = lathe([(0, 2.05), (0.045, 2.05), (0.045, 2.10), (0.03, 2.135), (0, 2.14)], 8, 'gunLamp')
    parts.append(beacon.apply(T(0.28, 0, 0.18)))
    parts.append(drape((0.28, 2.05, -0.29), (0.28, 2.05, 0.12),
                       [(0.15, -0.005), (0.10, 0.03), (0.0, 0.04), (-0.10, 0.03), (-0.15, -0.005)], steps=4))

    # The hydrant pit beside the footing, and what comes out of it.
    hx, hz = -0.75, -0.65
    parts.append(lathe([(0.30, -0.60), (0.30, 0.16), (0.27, 0.20), (0.24, 0.205)], 10, 'concrete')
                 .apply(T(hx, 0, hz)))
    parts.append(lathe([(0.245, 0.195), (0.245, 0.225), (0, 0.235)], 10, 'gunLid').apply(T(hx, 0, hz)))
    parts.append(lathe([(0.24, 0.215), (0.19, 0.265), (0, 0.285)], 10, 'snow').apply(T(hx, 0, hz)))
    parts.append(lathe([(0.05, 0.23), (0.05, 0.42), (0.065, 0.44), (0.065, 0.50), (0, 0.51)], 8, 'gunLid')
                 .apply(T(hx + 0.08, 0, hz + 0.05)))
    hose = [(hx + 0.13, 0.47, hz + 0.05), (-0.50, 0.40, -0.56), (-0.42, 0.30, -0.50), (-0.30, 0.29, -0.40),
            (-0.16, 0.34, -0.22), (-0.13, 0.46, -0.08)]
    parts.append(tube(hose, 0.045, 'hose', n=8, up=(0, 1, 0)))
    cable = [(hx + 0.03, 0.36, hz + 0.09), (-0.35, 0.27, -0.30), (0.05, 0.27, -0.12), (0.12, 0.45, -0.10),
             (0.12, 1.10, -0.10), (0.20, 1.20, -0.10)]
    parts.append(tube(cable, 0.016, 'cable', n=5, up=(0, 0, 1)))
    return parts


def gun_nozzle():
    F = barrel_frame()
    at = F @ Vector((0, NOZZLE_S, 0))
    aim = (F.to_3x3() @ Vector((0, 1, 0))).normalized()
    return [round(c, 4) for c in at], [round(c, 5) for c in aim]


# ===========================================================================
# Building, exporting, previewing
# ===========================================================================

BUDGET = {'lift_cabin': 1400, 'lift_cabinGlass': 100, 'lift_tower': 2500, 'lift_sheaves': 600, 'snowgun': 2500}


def build():
    riders.PALETTE.update(PALETTE_PREVIEW)
    riders.GLOSSY.update(GLOSSY_PREVIEW)
    col = collection('lift')
    clear_collection(col)
    out = {
        'lift_cabin': forge('lift_cabin', cabin_parts(), col),
        'lift_cabinGlass': forge('lift_cabinGlass', glass_parts(), col),
        'lift_tower': forge('lift_tower', tower_parts(), col),
        'lift_sheaves': forge('lift_sheaves', sheave_parts(), col),
        'snowgun': forge('snowgun', gun_parts(), col),
    }
    # The contract travels with the file, as glTF extras.
    out['lift_cabin']['ropeY'] = CABIN_ROPE_Y
    out['lift_tower']['ropeY'] = TOWER_ROPE_Y
    out['lift_tower']['groundY'] = TOWER_GROUND_Y
    out['lift_tower']['gauge'] = GAUGE
    sh = out['lift_sheaves']
    sh['sheaves'] = SHEAVES
    sh['radius'] = SHEAVE_RG
    sh['bend'] = TRAIN_BEND
    nozzle, aim = gun_nozzle()
    out['snowgun']['nozzle'] = nozzle
    out['snowgun']['aim'] = aim
    out['snowgun']['nozzleRadius'] = NOZZLE_R
    over = []
    for name, ob in out.items():
        t = tris(ob)
        print('%-16s %5d triangles (budget %d)' % (name, t, BUDGET[name]))
        if t > BUDGET[name]:
            over.append(name)
    assert not over, 'over budget: ' + ', '.join(over)
    return out


def export(path):
    col = collection('lift')
    bpy.context.view_layer.update()
    for ob in bpy.data.objects:
        if ob.name in bpy.context.view_layer.objects:
            ob.select_set(False)
    for ob in col.objects:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=False,
        export_materials='EXPORT', export_attributes=True, export_extras=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False,
    )
    return os.path.getsize(path)


# ---------------------------------------------------------------------------
# Preview: Cycles on the CPU, a light grey studio, a three-quarter view and a
# front view of each piece, and the tower dressed as the game dresses it —
# trains pitched to a nineteen-degree rope, cabins hanging from it.
# ---------------------------------------------------------------------------

C_THREE = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def to_blender(m):
    return C_THREE @ m @ C_THREE.inverted()


def place(src, m, col):
    ob = bpy.data.objects.new(src.name + '.pv', src.data)
    col.objects.link(ob)
    ob.matrix_world = to_blender(m)
    return ob


def tell_backfaces():
    """Cycles draws back faces as happily as front ones, and the game does
    not draw them at all: in the previews every back face glows magenta, so
    a surface that would vanish in the game shows here instead."""
    for mat in bpy.data.materials:
        nt = mat.node_tree
        if not nt or nt.nodes.get('backfacing'):
            continue
        out = nt.nodes.get('Material Output')
        bsdf = nt.nodes.get('Principled BSDF')
        if not out or not bsdf:
            continue
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        geo.name = 'backfacing'
        glow = nt.nodes.new('ShaderNodeEmission')
        glow.inputs['Color'].default_value = (1.0, 0.0, 1.0, 1.0)
        glow.inputs['Strength'].default_value = 2.0
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
        nt.links.new(bsdf.outputs['BSDF'], mix.inputs[1])
        nt.links.new(glow.outputs['Emission'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])


def studio(ground_y=None):
    tell_backfaces()
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    col = collection('stage')
    for ob in list(col.objects):
        bpy.data.objects.remove(ob)
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    if hasattr(world, 'use_nodes'):
        world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.78, 0.80, 0.83, 1)
    bg.inputs[1].default_value = 1.0
    ld = bpy.data.lights.get('sun') or bpy.data.lights.new('sun', 'SUN')
    ld.energy = 3.2
    ld.angle = 0.04
    sun = bpy.data.objects.new('sun', ld)
    col.objects.link(sun)
    sun.rotation_euler = (0.78, 0.0, -0.85)
    if ground_y is not None:
        me = bpy.data.meshes.new('floor')
        me.from_pydata([(-200, -200, ground_y), (200, -200, ground_y), (200, 200, ground_y), (-200, 200, ground_y)],
                       [], [(0, 1, 2, 3)])
        me.materials.append(material('snow'))
        fl = bpy.data.objects.new('floor', me)
        col.objects.link(fl)
    cd = bpy.data.cameras.get('pv') or bpy.data.cameras.new('pv')
    cam = bpy.data.objects.new('pv', cd)
    col.objects.link(cam)
    scene.camera = cam
    return col


def shoot(eye, target, lens, path):
    cam = bpy.context.scene.camera
    cam.data.lens = lens
    cam.data.clip_end = 1000
    cam.location = B(eye)
    d = Vector(B(target)) - Vector(B(eye))
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path)


def preview(models, out_dir, only=None):
    """`only` (cabin, tower, gun) renders one sheet, for iterating."""
    os.makedirs(out_dir, exist_ok=True)
    for ob in models.values():
        ob.hide_render = True
    pv = collection('preview')

    def reset():
        for ob in list(pv.objects):
            bpy.data.objects.remove(ob)

    rope_mesh = forge('_rope', [tube([(0, 0, -1), (0, 0, 1)], ROPE_R, 'cable', n=10, up=(0, 1, 0))],
                      collection('_scratch'))
    rope_mesh.hide_render = True

    def rope(p0, p1):
        p0, p1 = Vector(p0), Vector(p1)
        mid, d = (p0 + p1) / 2, (p1 - p0)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        m = Matrix.Translation(mid) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((1, 1, d.length / 2, 1))
        place(rope_mesh, m, pv)

    if only in (None, 'cabin'):
        cabin_sheet(models, out_dir, reset, rope)
    if only in (None, 'tower'):
        tower_sheet(models, out_dir, reset, rope, pv)
    if only in (None, 'gun'):
        gun_sheet(models, out_dir, reset, pv)


def cabin_sheet(models, out_dir, reset, rope):
    # The cabin, hanging from a length of rope.
    pv = collection('preview')
    reset()
    studio()
    for name in ('lift_cabin', 'lift_cabinGlass'):
        place(models[name], Matrix.Identity(4), pv)
    rope((0, CABIN_ROPE_Y, -3), (0, CABIN_ROPE_Y, 3))
    shoot((6.2, 1.2, 7.4), (0, -0.25, 0), 35, os.path.join(out_dir, 'cabin-34.png'))
    shoot((0.0, -0.1, 10.5), (0, -0.25, 0), 35, os.path.join(out_dir, 'cabin-front.png'))
    shoot((10.5, -0.1, 0.0), (0, -0.25, 0), 35, os.path.join(out_dir, 'cabin-door.png'))


def tower_sheet(models, out_dir, reset, rope, pv):
    # The tower, dressed: both trains on a rope falling nineteen degrees
    # towards −Z, and a cabin on each rope.
    reset()
    studio(ground_y=TOWER_GROUND_Y)
    place(models['lift_tower'], Matrix.Identity(4), pv)
    pitch = math.atan(-0.345)
    for side in (-1, 1):
        yaw = 0.0 if side > 0 else math.pi
        a = pitch if side > 0 else -pitch
        m = T(side * GAUGE, TOWER_ROPE_Y, 0) @ Ry(yaw) @ Rx(a)
        place(models['lift_sheaves'], m, pv)
        for sz in (-1, 1):
            # the rope leaves each end of the train turned down by half the bend
            d = Vector((0, -math.sin(TRAIN_BEND / 2), sz * math.cos(TRAIN_BEND / 2)))
            rope(m @ Vector((0, 0, 0)), m @ (d * 26))
        along = 7.0 if side > 0 else 9.0
        sz = -1 if side > 0 else 1
        d = Vector((0, -math.sin(TRAIN_BEND / 2), sz * math.cos(TRAIN_BEND / 2)))
        grip = m @ (d * along)
        cab = T(*grip) @ Ry(yaw) @ T(0, -CABIN_ROPE_Y, 0)
        place(models['lift_cabin'], cab, pv)
        place(models['lift_cabinGlass'], cab, pv)
    shoot((26, 2, 40), (0, -0.5, 0), 35, os.path.join(out_dir, 'tower-34.png'))
    shoot((0, 0, 52), (0, -0.5, 0), 35, os.path.join(out_dir, 'tower-front.png'))
    shoot((6.5, 12.6, 6.0), (0, 10.2, 0), 40, os.path.join(out_dir, 'tower-head.png'))


def gun_sheet(models, out_dir, reset, pv):
    # The snow gun on its footing.
    reset()
    studio(ground_y=0.0)
    place(models['snowgun'], Matrix.Identity(4), pv)
    shoot((9.0, 4.4, 11.0), (0, 2.75, 0.2), 35, os.path.join(out_dir, 'snowgun-34.png'))
    shoot((0.0, 4.2, 15.5), (0, 2.75, 0), 35, os.path.join(out_dir, 'snowgun-front.png'))
    shoot((3.2, 6.2, 3.9), (0, 4.75, 0.25), 40, os.path.join(out_dir, 'snowgun-head.png'))


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    models = build()
    if '--out' in args:
        out_dir = args[args.index('--out') + 1]
        os.makedirs(out_dir, exist_ok=True)
        print('lift.glb', export(os.path.join(out_dir, 'lift.glb')), 'bytes')
    if '--preview' in args:
        only = args[args.index('--only') + 1] if '--only' in args else None
        preview(models, args[args.index('--preview') + 1], only)
