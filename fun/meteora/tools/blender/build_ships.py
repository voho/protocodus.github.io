"""Meteora — the player fighter, the enemy interceptor and js/anchors.js.

Both ships are modelled in Blender space with the nose along +Y and the
top along +Z; the glTF exporter's +Y-up conversion, (x, y, z) -> (x, z, -y),
delivers them nose along three.js -Z. Every part is built from bmesh
primitives (lofted cross-sections, lathed profiles, airfoil wings, slabs
and boxes) and given a procedural paint material. The parts are joined
into one `hull` mesh, unwrapped, and the paint is baked in Cycles: normals
selected-to-active from a bevelled high copy (rounded edges and panel
lines), then base colour, roughness, metallic and emission from the hull
itself.

Anchors are empties parented to the hull: `nozzle_*` (local -Y is the
exhaust direction), `muzzle_*`, `rcs_NN` (local +Z is the puff direction,
out of the hull) and `cam_cockpit`. After export their world transforms
are converted to glTF space and written to js/anchors.js.

Set METEORA_FAST=1 for quick geometry iterations (tiny textures, 1 sample).
"""
import bpy, bmesh, math, os, random, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

FAST = bool(os.environ.get('METEORA_FAST'))


def lin(hexcode):
    """sRGB hex -> linear RGB."""
    out = []
    for i in (1, 3, 5):
        c = int(hexcode[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


OFF_WHITE, GRAPHITE, ORANGE = lin('#d9d6cf'), lin('#2b2d31'), lin('#c8642a')
GUNMETAL, OXBLOOD, HAZARD = lin('#4a4f55'), lin('#5e1a1d'), lin('#d9a21b')
BARE = lin('#9a9b9d')
SOOT = (0.012, 0.011, 0.010)
DARK = (0.03, 0.032, 0.035)


# ==========================================================================
# Geometry helpers. Every builder returns a new object.

def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def resample(stations, count):
    """Catmull-Rom through the station rows (every column); `count` rows
    out, or the stations themselves when count is None."""
    S = np.array(stations, dtype=float)
    if count is None:
        return list(S)
    n = len(S)
    out = []
    for i in range(count):
        u = i / (count - 1) * (n - 1)
        k = min(int(u), n - 2)
        t = u - k
        out.append(catmull(S[max(k - 1, 0)], S[k], S[k + 1], S[min(k + 2, n - 1)], t))
    return out


def superellipse(around, w, zt, zb, nt, nb, zc, chine=0.0):
    """A rounded-rectangle section: domed top (exponent nt), flatter belly
    (exponent nb), counter-clockwise from +X seen from the front. `chine`
    pulls a sharp ridge out of each side at the centre line."""
    pts = []
    for i in range(around):
        a = 2 * math.pi * i / around
        c, s = math.cos(a), math.sin(a)
        n = nt if s >= 0 else nb
        ridge = 1.0 + chine * math.exp(-(s / 0.09) ** 2)
        pts.append((w * ridge * math.copysign(abs(c) ** (2 / n), c),
                    zc + (zt if s >= 0 else zb) * math.copysign(abs(s) ** (2 / n), s)))
    return pts


def faceted(around, w, zt, zb, zc):
    """An angular octagonal section for the interceptor: a narrow top
    ridge, sloped shoulders, sharp chines and a flat keel."""
    return [(w, zc), (w * 0.62, zc + zt * 0.72), (w * 0.16, zc + zt), (-w * 0.16, zc + zt),
            (-w * 0.62, zc + zt * 0.72), (-w, zc), (-w * 0.58, zc - zb), (w * 0.58, zc - zb)]


def ring_faces(bm, rings, closed=True):
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))


def cap(bm, ring, tip):
    v = bm.verts.new(tip)
    n = len(ring)
    for i in range(n):
        bm.faces.new((ring[i], ring[(i + 1) % n], v))


def finish_bm(name, bm, mat, smooth=True, sharp=None):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = C.object_from_bmesh(name, bm, smooth=smooth)
    if sharp is not None:
        obj.data.set_sharp_from_angle(angle=math.radians(sharp))
    if mat is not None:
        obj.data.materials.append(mat)
    return obj


def loft(name, stations, mat, around=48, along=None, section=superellipse, front_tip=None, back_tip=None,
         smooth=True, sharp=None):
    """Cross-sections along Y; rows are (y, *section parameters). Tips
    close the ends as cones."""
    bm = bmesh.new()
    rings = []
    for row in resample(stations, along):
        y = row[0]
        rings.append([bm.verts.new((x, y, z)) for x, z in section(around, *row[1:])])
    ring_faces(bm, rings)
    if front_tip is not None:
        cap(bm, rings[0], front_tip)
    if back_tip is not None:
        cap(bm, rings[-1], back_tip)
    return finish_bm(name, bm, mat, smooth=smooth, sharp=sharp)


def lathe(name, profile, sides, centre, mat, closed=False, smooth=True, sharp=None, phase=0.0):
    """Revolve a (y, r) profile around the Y axis through `centre` (x, z).
    closed=True joins the last profile point back to the first (a solid
    wall such as a nozzle bell); r == 0 points collapse onto the axis."""
    bm = bmesh.new()
    cx, cz = centre
    rings = []
    for y, r in profile:
        if r <= 1e-6:
            rings.append(bm.verts.new((cx, y, cz)))
        else:
            rings.append([bm.verts.new((cx + r * math.cos(2 * math.pi * i / sides + phase), y,
                                        cz + r * math.sin(2 * math.pi * i / sides + phase))) for i in range(sides)])
    seq = rings + ([rings[0]] if closed else [])
    for a, b in zip(seq, seq[1:]):
        if isinstance(a, list) and isinstance(b, list):
            ring_faces(bm, [a, b])
        elif isinstance(a, list):
            for i in range(sides):
                bm.faces.new((a[i], a[(i + 1) % sides], b))
        elif isinstance(b, list):
            for i in range(sides):
                bm.faces.new((a, b[(i + 1) % sides], b[i]))
    return finish_bm(name, bm, mat, smooth=smooth, sharp=sharp)


def naca(u):
    return 5 * (0.2969 * math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4)


def wing(name, sections, mat, chord_pts=12, belly=0.75, diamond=False, sharp=50):
    """A wing along local X. sections: (x, y_le, z, chord, thickness ratio),
    the chord running toward -Y. NACA thickness, or a faceted diamond
    section. Both ends are capped so the solid is closed."""
    bm = bmesh.new()
    rings = []
    for x, yle, z, chord, thick in sections:
        top, bot = [], []
        for i in range(chord_pts):
            if diamond:
                u = i / (chord_pts - 1)
                t = thick * chord / 2 * max(0.0, 1 - abs(u - 0.38) / (0.62 if u > 0.38 else 0.38))
            else:
                u = (1 - math.cos(math.pi * i / (chord_pts - 1))) / 2
                t = naca(u) * thick * chord / 2
            top.append((x, yle - u * chord, z + t))
            bot.append((x, yle - u * chord, z - t * belly))
        rings.append([bm.verts.new(p) for p in top + bot[::-1][1:-1]])
    ring_faces(bm, rings)
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return finish_bm(name, bm, mat, smooth=True, sharp=sharp)


def prism(name, outline, thickness, mat, matrix=Matrix()):
    """Extrude a convex XY outline by `thickness` along Z (centred)."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, -thickness / 2)) for x, y in outline]
    hi = [bm.verts.new((x, y, thickness / 2)) for x, y in outline]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return finish_bm(name, bm, mat, smooth=False)


def box(name, size, mat, matrix=Matrix(), taper=1.0):
    """A box centred on the origin of `matrix`; `taper` shrinks its top."""
    bm = bmesh.new()
    sx, sy, sz = (s / 2 for s in size)
    vs = []
    for z in (-sz, sz):
        k = taper if z > 0 else 1.0
        for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            vs.append(bm.verts.new((x * k, y * k, z)))
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return finish_bm(name, bm, mat, smooth=False)


def bar(name, path, width, height, mat, up):
    """A rectangular-section bar along a polyline; `up(p)` gives the
    direction the bar stands proud toward at each point."""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(path):
        p = Vector(p)
        t = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])).normalized()
        h = up(p)
        h = (h - t * h.dot(t)).normalized()
        w = t.cross(h).normalized()
        rings.append([bm.verts.new(p + w * sx * width / 2 + h * sz * height)
                      for sx, sz in ((-1, -0.3), (1, -0.3), (1, 1), (-1, 1))])
    ring_faces(bm, rings)
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return finish_bm(name, bm, mat, smooth=False)


def mirror_x(obj, name):
    copy = C.duplicate(obj, name)
    bm = bmesh.new()
    bm.from_mesh(copy.data)
    bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(copy.data)
    bm.free()
    copy.data.update()
    return copy


def mirrored(objs):
    out = []
    for o in objs:
        out += [o, mirror_x(o, o.name + '_m')]
    return out


def transformed(obj, matrix):
    obj.data.transform(matrix)
    obj.data.update()
    return obj


def bvh_of(objects):
    bm = bmesh.new()
    for o in objects:
        bm.from_mesh(o.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def frame_on(bvh, origin, direction, along=(0, 1, 0)):
    """Raycast onto a surface: (location, matrix with Z = surface normal
    and Y as close to `along` as possible)."""
    loc, nrm, _, _ = bvh.ray_cast(Vector(origin), Vector(direction).normalized())
    if loc is None:
        raise RuntimeError(f'ray from {origin} missed the hull')
    z = nrm.normalized()
    if z.dot(Vector(direction)) > 0:
        z = -z
    x = Vector(along).cross(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0)).cross(z)
    x.normalize()
    m = Matrix((x, z.cross(x), z)).transposed().to_4x4()
    m.translation = loc
    return loc, m


def facing(loc, d):
    """A frame at `loc` whose Z points along d."""
    z = Vector(d).normalized()
    x = Vector((0, 0, 1)).cross(z) if abs(z.z) < 0.9 else Vector((0, 1, 0)).cross(z)
    x.normalize()
    m = Matrix((x, z.cross(x), z)).transposed().to_4x4()
    m.translation = loc
    return m


def vent(name, size, mat, matrix, slats=5):
    """A louvred vent: a low frame with angled slats on top."""
    parts = [box(name, size, mat, matrix, taper=0.94)]
    for i in range(slats):
        y = -size[1] / 2 + size[1] * (i + 0.5) / slats
        m = matrix @ Matrix.Translation((0, y * 0.9, size[2] * 0.55)) @ Matrix.Rotation(math.radians(-30), 4, 'X')
        parts.append(box(f'{name}_s{i}', (size[0] * 0.84, size[1] / slats * 0.85, 0.012), mat, m))
    return parts


def rcs_block(name, mat, hole_mat, matrix, size=0.2):
    """An RCS thruster port: a low square block with a dark nozzle."""
    block = box(name, (size, size, 0.08), mat, matrix @ Matrix.Translation((0, 0, 0.015)), taper=0.84)
    nozzle = lathe(name + '_n', [(0.03, 0.0), (0.03, size * 0.2), (0.062, size * 0.27), (0.062, 0.0)], 8,
                   (0, 0), hole_mat, smooth=False)
    transformed(nozzle, matrix @ Matrix.Rotation(math.radians(90), 4, 'X'))
    return [block, nozzle]


def empty(name, location, direction=None):
    """An anchor empty; `direction` sets where its local +Z points."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = 0.3
    e.location = location
    if direction is not None:
        d = Vector(direction).normalized()
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = d.to_track_quat('Z', 'Y' if abs(d.y) < 0.9 else 'X')
    return C.link(e)


def place_rcs(ports, bvh, M, metal='metal', hole='hole'):
    """ports: (name, ray origin, ray direction, puff direction). The block
    sits on the hit surface (flush ports) or faces the puff direction
    (forward and aft ports); the empty sits just outside its nozzle."""
    parts, empties = [], []
    for name, origin, ray, puff in ports:
        loc, m = frame_on(bvh, origin, ray)
        d = Vector(puff).normalized()
        if m.col[2].xyz.dot(d) < 0.8:
            m = facing(loc + d * 0.03, d)
        parts += rcs_block(name + '_block', M[metal], M[hole], m)
        empties.append(empty(name, m.translation + m.col[2].xyz * 0.08, d))
    return parts, empties


# ==========================================================================
# Paint

def panel_lines(g, P, N, scale, mortar, panel):
    """Tri-planar Brick texture: the projection follows the dominant normal
    axis, so panels run along the hull on every side. Returns (line mask,
    per-panel tint near 1)."""
    x, y, z = g.sep(P)
    nx, ny, nz = (g.absolute(c) for c in g.sep(N))

    def proj(u, v, shift):
        vec = g.combine(g.add(u, shift), g.add(v, shift * 0.37), 0.0)
        n = g.node('ShaderNodeTexBrick', offset=0.5, squash=1.0, offset_frequency=2, squash_frequency=2)
        g.feed(n.inputs['Vector'], vec)
        for k, val in (('Scale', scale), ('Mortar Size', mortar), ('Mortar Smooth', 0.2), ('Bias', 0.0),
                       ('Brick Width', panel[0]), ('Row Height', panel[1]),
                       ('Color1', (0.93, 0.93, 0.93)), ('Color2', (1.05, 1.05, 1.05)), ('Mortar', (1, 1, 1))):
            g.feed(n.inputs[k], val)
        tint = g.node('ShaderNodeSeparateColor', [n.outputs['Color']]).outputs[0]
        return n.outputs['Factor'], tint

    l_top, t_top = proj(y, x, 0.31)
    l_side, t_side = proj(y, z, 0.17)
    l_front, t_front = proj(x, z, 0.53)
    wz = g.mul(g.math('GREATER_THAN', nz, nx), g.math('GREATER_THAN', nz, ny))
    wx = g.mul(g.sub(1.0, wz), g.math('GREATER_THAN', nx, ny))
    wy = g.sub(g.sub(1.0, wz), wx)
    lines = g.add(g.add(g.mul(wz, l_top), g.mul(wx, l_side)), g.mul(wy, l_front))
    tint = g.add(g.add(g.mul(wz, t_top), g.mul(wx, t_side)), g.mul(wy, t_front))
    return lines, tint


def weathered(g, base, rough, metal, P, N, wear=1.0, grime=1.0, lines=True, glow=None,
              panel_scale=1.0, panel=(1.3, 0.55), mortar=0.011):
    """The shared finish: panel lines (colour and bump) with per-panel
    tint, AO grime and faint streaks running aft, chipped edges and
    scratches showing bare metal, and a fine paint grain."""
    height = 0.0
    if lines:
        mask, tint = panel_lines(g, P, N, panel_scale, mortar, panel)
        base = g.mix(1.0, base, g.combine(tint, tint, tint), 'MULTIPLY')
        base = g.mix(g.mul(mask, 0.6), base, (0.008, 0.008, 0.009))
        rough = g.mixf(g.mul(mask, 0.5), rough, 0.7)
        height = g.mul(mask, -0.0018)
    ao = g.node('ShaderNodeAmbientOcclusion', [None, 0.45], samples=12, only_local=False).outputs['AO']
    streak = g.smooth(g.noise(g.vmath('MULTIPLY', P, (7.0, 0.35, 7.0)), 1.0, 4.0, 0.6), 0.5, 0.8)
    dirt = g.add(g.mul(g.sub(1.0, ao), 0.85), g.mul(streak, 0.25))
    dirt = g.mul(g.minimum(dirt, 1.0), grime)
    base = g.mix(g.mul(dirt, 0.7), base, (0.035, 0.03, 0.026), 'MULTIPLY')
    rough = g.mixf(g.mul(dirt, 0.5), rough, 0.62)
    bev = g.node('ShaderNodeBevel', [0.03], samples=8).outputs[0]
    edge = g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1))
    patches = g.smooth(g.noise(P, 2.2, 3.0, 0.5), 0.5, 0.62)
    chips = g.mul(g.mul(g.smooth(edge, 0.02, 0.08), patches), g.smooth(g.noise(P, 14.0, 4.0, 0.6), 0.4, 0.55))
    scratches = g.mul(g.smooth(g.noise(g.vmath('MULTIPLY', P, (1.0, 14.0, 1.0)), 6.0, 3.0, 0.5), 0.74, 0.8),
                      g.smooth(g.noise(P, 2.5, 2.0), 0.55, 0.7))
    worn = g.mul(g.maximum(chips, g.mul(scratches, 0.6)), wear)
    base = g.mix(worn, base, BARE)
    rough = g.mixf(worn, rough, 0.35)
    metal = g.mixf(worn, metal, 0.6)
    height = g.add(height, g.mul(worn, -0.0004))
    height = g.add(height, g.mul(g.noise(P, 60.0, 3.0, 0.5), 0.00015))
    return dict(albedo=base, rough=rough, metal=metal, normal=g.bump(height, 1.0, 1.0), glow=glow)


def material(name, build):
    def wrapped(g):
        return build(g, g.coord('Object'), g.geometry('Normal'))
    return C.source_material(name, wrapped)


def band(g, v, lo, hi, soft=0.02):
    """1 inside [lo, hi], with soft edges."""
    return g.mul(g.smooth(v, lo - soft, lo + soft), g.sub(1.0, g.smooth(v, hi - soft, hi + soft)))


def hazard(g, u, v, width=0.16):
    """Diagonal hazard stripes: 1 on the yellow stripes."""
    s = g.math('FRACT', g.mul(g.add(u, v), 1.0 / (2 * width)))
    return g.smooth(g.absolute(g.sub(s, 0.5)), 0.24, 0.26)


def glow_material(name, colour, albedo=(0.05, 0.05, 0.05)):
    return material(name, lambda g, P, N: dict(albedo=albedo, rough=0.3, metal=0.0, glow=colour))


def nozzle_material(name, axis_x, axis_z):
    """Heat-tinted bare metal outside, soot inside the bell (by distance
    from the engine axis at |x| = axis_x, z = axis_z)."""
    def build(g, P, N):
        x, y, z = g.sep(P)
        r = g.vmath('LENGTH', g.combine(g.sub(g.absolute(x), axis_x), 0.0, g.sub(z, axis_z)), out=1)
        inner = g.sub(1.0, g.smooth(r, 0.5, 0.58)) if axis_x else g.sub(1.0, g.smooth(r, 0.62, 0.7))
        tint = g.ramp(g.noise(P, 2.0, 3.0), [(0.3, (0.16, 0.13, 0.1)), (0.55, (0.11, 0.11, 0.15)),
                                             (0.8, (0.2, 0.15, 0.1))])
        col = g.mix(inner, tint, SOOT)
        return weathered(g, col, g.mixf(inner, 0.36, 0.6), g.mixf(inner, 0.6, 0.2), P, N,
                         wear=0.0, lines=False, grime=0.6)
    return material(name, build)


# ==========================================================================
# Fighter (about 14.4 m long, 11.3 m span)

FIGHTER_BODY = [
    # y, half-width, top, bottom, top exponent, bottom exponent, centre z, chine
    (7.00, 0.03, 0.03, 0.03, 2.0, 2.0, -0.13, 0.0),
    (6.55, 0.28, 0.18, 0.13, 2.1, 2.6, -0.11, 0.16),
    (5.70, 0.6, 0.38, 0.27, 2.2, 3.0, -0.07, 0.15),
    (4.50, 0.9, 0.58, 0.38, 2.3, 3.4, -0.02, 0.12),
    (3.00, 1.14, 0.75, 0.46, 2.4, 3.8, 0.02, 0.08),
    (1.30, 1.34, 0.84, 0.52, 2.5, 4.0, 0.05, 0.03),
    (-0.70, 1.42, 0.82, 0.54, 2.6, 4.2, 0.06, 0.0),
    (-2.70, 1.34, 0.75, 0.53, 2.6, 4.0, 0.05, 0.0),
    (-4.60, 1.02, 0.65, 0.50, 2.5, 3.6, 0.04, 0.0),
    (-6.10, 0.72, 0.55, 0.44, 2.4, 3.0, 0.02, 0.0),
    (-6.75, 0.52, 0.44, 0.36, 2.2, 2.6, 0.02, 0.0),
]
F_ENG = (1.2, 0.0)              # engine axis x, z
F_POD_X = 5.42
F_CANOPY = (3.0, 0.6)           # centre y, z

F_RCS = [
    # name, ray origin, ray direction, puff direction (Blender space)
    ('rcs_01', (0, 5.0, 3), (0, 0, -1), (0, 0, 1)),           # nose up
    ('rcs_02', (0, 5.0, -3), (0, 0, 1), (0, 0, -1)),          # nose down
    ('rcs_03', (3, 5.0, -0.02), (-1, 0, 0), (1, 0, 0)),       # nose right
    ('rcs_04', (-3, 5.0, -0.02), (1, 0, 0), (-1, 0, 0)),      # nose left
    ('rcs_05', (0, -5.75, 3), (0, 0, -1), (0, 0, 1)),         # tail up
    ('rcs_06', (0, -5.75, -3), (0, 0, 1), (0, 0, -1)),        # tail down
    ('rcs_07', (4, -5.2, 0), (-1, 0, 0), (1, 0, 0)),          # tail right, on the nacelle
    ('rcs_08', (-4, -5.2, 0), (1, 0, 0), (-1, 0, 0)),         # tail left
    ('rcs_09', (F_POD_X, -1.9, 3), (0, 0, -1), (0, 0, 1)),    # right wingtip up
    ('rcs_10', (F_POD_X, -1.9, -3), (0, 0, 1), (0, 0, -1)),   # right wingtip down
    ('rcs_11', (-F_POD_X, -1.9, 3), (0, 0, -1), (0, 0, 1)),   # left wingtip up
    ('rcs_12', (-F_POD_X, -1.9, -3), (0, 0, 1), (0, 0, -1)),  # left wingtip down
    ('rcs_13', (0.36, 5.85, 3), (0, 0, -1), (0.3, 1, 0.1)),   # nose, forward-facing right (reverse)
    ('rcs_14', (-0.36, 5.85, 3), (0, 0, -1), (-0.3, 1, 0.1)), # nose, forward-facing left
    ('rcs_15', (0.24, -9, 0.2), (0, 1, 0), (0, -1, 0)),       # tail cone, aft-facing right
    ('rcs_16', (-0.24, -9, 0.2), (0, 1, 0), (0, -1, 0)),      # tail cone, aft-facing left
]


def fighter_materials():
    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.18, -0.42)
        nose_cap = g.smooth(y, 6.28, 6.32)
        glare = g.mul(g.mul(band(g, y, 4.5, 6.3, 0.015), g.smooth(nz, 0.3, 0.4)), g.sub(1.0, g.smooth(ax, 0.36, 0.38)))
        spine = g.mul(g.mul(band(g, y, -4.6, 1.3, 0.015), g.sub(1.0, g.smooth(ax, 0.17, 0.19))), g.smooth(nz, 0.5, 0.6))
        dark = g.maximum(g.maximum(under, nose_cap), g.maximum(glare, spine))
        side = g.smooth(g.absolute(nx), 0.5, 0.62)
        stripe = g.mul(g.mul(band(g, z, 0.2, 0.34, 0.008), band(g, y, -2.6, 5.3, 0.01)), side)
        pin = g.mul(g.mul(band(g, z, 0.1, 0.135, 0.005), band(g, y, -1.8, 4.7, 0.01)), side)
        col = g.mix(dark, OFF_WHITE, GRAPHITE)
        col = g.mix(stripe, col, ORANGE)
        col = g.mix(pin, col, GRAPHITE)
        return weathered(g, col, g.mixf(dark, 0.42, 0.55), g.mixf(dark, 0.2, 0.3), P, N)

    def wing_paint(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        under = g.smooth(g.sep(N)[2], -0.15, -0.4)
        le_y = g.sub(1.5, g.mul(g.sub(ax, 1.2), math.tan(math.radians(28))))
        leading = g.smooth(g.sub(y, le_y), -0.34, -0.3)
        sweep = g.add(ax, g.mul(y, 0.3))
        chevron = g.maximum(band(g, sweep, 3.5, 3.82, 0.008), band(g, sweep, 3.93, 4.0, 0.005))
        col = g.mix(g.maximum(under, leading), OFF_WHITE, GRAPHITE)
        col = g.mix(g.mul(chevron, g.sub(1.0, under)), col, ORANGE)
        return weathered(g, col, g.mixf(under, 0.42, 0.55), g.mixf(under, 0.2, 0.3), P, N)

    def engine(g, P, N):
        x, y, z = g.sep(P)
        under = g.smooth(g.sep(N)[2], -0.1, -0.35)
        heat = g.smooth(y, -5.6, -6.3)
        col = g.mix(under, OFF_WHITE, GRAPHITE)
        col = g.mix(band(g, y, -5.45, -5.25, 0.006), col, GRAPHITE)
        col = g.mix(heat, col, (0.085, 0.07, 0.065))
        col = g.mix(g.mul(heat, g.smooth(g.noise(P, 3.0, 3.0), 0.4, 0.7)), col, (0.05, 0.06, 0.1))
        rough = g.mixf(heat, g.mixf(under, 0.42, 0.55), 0.42)
        metal = g.mixf(heat, g.mixf(under, 0.2, 0.3), 0.6)
        return weathered(g, col, rough, metal, P, N, wear=0.8)

    def pod(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(g.sep(N)[2], -0.1, -0.4), OFF_WHITE, GRAPHITE)
        col = g.mix(band(g, y, 0.4, 0.62, 0.01), col, ORANGE)
        col = g.mix(g.smooth(y, 0.95, 1.0), col, GRAPHITE)
        return weathered(g, col, 0.45, 0.25, P, N, panel_scale=1.6)

    def metal(g, P, N):
        return weathered(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, lines=False, wear=0.6)

    def fin(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(z, 1.3, 1.33), OFF_WHITE, ORANGE)
        col = g.mix(g.smooth(z, 1.48, 1.51), col, GRAPHITE)
        return weathered(g, col, 0.42, 0.2, P, N)

    def missile(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(band(g, y, 0.08, 0.2, 0.005), (0.5, 0.5, 0.47), ORANGE)
        col = g.mix(g.smooth(y, 0.55, 0.6), col, GRAPHITE)
        return weathered(g, col, 0.45, 0.2, P, N, lines=False, wear=0.4)

    return dict(
        body=material('f_body', body), wing=material('f_wing', wing_paint), engine=material('f_engine', engine),
        nozzle=nozzle_material('f_nozzle', F_ENG[0], F_ENG[1]), pod=material('f_pod', pod),
        metal=material('f_metal', metal), fin=material('f_fin', fin), missile=material('f_missile', missile),
        glow=glow_material('f_glow', (0.55, 0.68, 1.0), (0.3, 0.35, 0.45)),
        red=glow_material('f_nav_red', (1.0, 0.05, 0.03), (0.3, 0.02, 0.02)),
        green=glow_material('f_nav_green', (0.05, 1.0, 0.25), (0.02, 0.3, 0.06)),
        hole=material('f_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def canopy_point(y, angle, grow=1.0):
    cy, cz = F_CANOPY
    u = (y - cy) / 1.75
    t = max(0.0, u)
    rad = math.sqrt(max(1e-6, 1 - u * u))
    return Vector((math.cos(angle) * rad * 0.6 * (1.0 - 0.38 * t * t) * grow, y,
                   cz + math.sin(angle) * rad * 0.52 * (1.0 - 0.15 * t * t) * grow))


def build_fighter():
    M = fighter_materials()
    parts = []
    body = loft('body', FIGHTER_BODY, M['body'], around=48, along=44,
                front_tip=(0, 7.08, -0.13), back_tip=(0, -6.92, 0.04))
    parts.append(body)

    # Canopy: a bubble tapered toward the front and cut at the fuselage line.
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        t = max(0.0, y)
        v.co = Vector((x * 0.6 * (1.0 - 0.38 * t * t), F_CANOPY[0] + y * 1.75,
                       F_CANOPY[1] + z * 0.52 * (1.0 - 0.15 * t * t)))
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0.62),
                           plane_no=(0, 0, 1), clear_inner=True)
    glass = finish_bm('glass', bm, None)
    glass.data.materials.append(C.flat_material('glass', (0.006, 0.008, 0.011), 0.04, 0.0,
                                                emission=(0.003, 0.009, 0.011), strength=1.0))
    out = lambda p: Vector((p.x, 0, p.z - F_CANOPY[1]))
    for i, yy in enumerate((3.95, 2.75, 1.6)):
        path = [canopy_point(yy, math.radians(a), 1.02) for a in range(10, 171, 8)]
        parts.append(bar(f'rib{i}', [p for p in path if p.z > 0.64], 0.08, 0.05, M['metal'], out))
    spine = [canopy_point(yy, math.radians(90), 1.02) for yy in np.linspace(4.62, 1.32, 16)]
    parts.append(bar('canopy_spine', spine, 0.06, 0.04, M['metal'], out))
    for sgn in (1, -1):
        sill = [canopy_point(yy, math.radians(90 - sgn * 76), 1.03) for yy in np.linspace(4.55, 1.35, 16)]
        parts.append(bar(f'sill{sgn}', sill, 0.1, 0.05, M['body'], out))

    # Wings, swept 28 degrees with 4 degrees of dihedral; gun pods at the tips.
    sw, dih = math.tan(math.radians(28)), math.tan(math.radians(4))
    secs = [(x, 1.5 - sw * (x - 1.2), -0.12 + dih * (x - 1.2), chord, th)
            for x, chord, th in ((1.75, 4.95, 0.06), (2.4, 4.15, 0.06), (3.8, 2.85, 0.052), (F_POD_X - 0.12, 1.75, 0.048))]
    secs.insert(0, (0.95, 3.7, -0.04, 7.55, 0.034))       # leading-edge root extension
    parts += mirrored([wing('wing', secs, M['wing'], chord_pts=13)])
    tip_z = -0.12 + dih * (F_POD_X - 1.2)
    pod_profile = [(-2.75, 0.0), (-2.68, 0.12), (-2.5, 0.2), (-2.2, 0.235), (0.5, 0.235), (0.95, 0.21),
                   (1.35, 0.15), (1.6, 0.09), (1.7, 0.0)]
    side_parts = [
        lathe('pod', pod_profile, 18, (F_POD_X, tip_z), M['pod'], sharp=40),
        lathe('barrel', [(1.45, 0.0), (1.45, 0.07), (3.0, 0.07), (3.02, 0.095), (3.3, 0.095), (3.32, 0.06), (3.32, 0.0)],
              10, (F_POD_X, tip_z), M['metal'], sharp=40),
        lathe('bore', [(3.26, 0.0), (3.26, 0.045), (3.335, 0.045), (3.335, 0.0)], 8, (F_POD_X, tip_z), M['hole'], smooth=False),
    ]
    # missile on a pylon under each wing
    mx, my = 3.05, 1.5 - sw * (3.05 - 1.2) - 1.0
    wing_low = -0.12 + dih * (3.05 - 1.2) - 0.08
    mz = wing_low - 0.33
    side_parts.append(prism('pylon', [(-0.12, 0.45), (0.12, 0.45), (0.12, -0.95), (-0.12, -0.75)], 0.07, M['metal'],
                            Matrix.Translation((mx, my - 0.5, wing_low - 0.1)) @ Matrix.Rotation(math.radians(90), 4, 'Y')))
    mp = [(-1.25, 0.0), (-1.25, 0.075), (-1.2, 0.11), (0.85, 0.11), (1.15, 0.08), (1.35, 0.03), (1.42, 0.0)]
    side_parts.append(lathe('missile', [(my - 0.4 + a, r) for a, r in mp], 12, (mx, mz), M['missile']))
    for k in range(4):
        m = (Matrix.Translation((mx, my - 1.47, mz)) @ Matrix.Rotation(math.radians(45 + 90 * k), 4, 'Y')
             @ Matrix.Translation((0.0, 0.0, 0.17)))
        side_parts.append(box(f'mfin{k}', (0.014, 0.3, 0.14), M['metal'], m, taper=0.6))
    # Engines: nacelle, lathed bell nozzle, glowing throat, cooling ring, canted fin.
    nacelle = [(-0.9, 0.0), (-1.0, 0.3), (-1.5, 0.5), (-2.3, 0.62), (-5.5, 0.645), (-6.2, 0.62), (-6.55, 0.6)]
    bell = [(-6.4, 0.585), (-6.85, 0.575), (-7.3, 0.6), (-7.42, 0.6), (-7.43, 0.565),
            (-7.1, 0.5), (-6.82, 0.37), (-6.7, 0.36), (-6.6, 0.4), (-6.45, 0.5)]
    side_parts += [
        lathe('nacelle', nacelle, 28, F_ENG, M['engine']),
        lathe('bell', bell, 28, F_ENG, M['nozzle'], closed=True, sharp=35),
        lathe('throat', [(-6.74, 0.0), (-6.74, 0.37), (-6.7, 0.37), (-6.7, 0.0)], 28, F_ENG, M['glow'], smooth=False),
        lathe('ring', [(-6.28, 0.0), (-6.28, 0.665), (-6.4, 0.665), (-6.4, 0.0)], 28, F_ENG, M['metal'], smooth=False),
    ]
    fin = wing('fin', [(0.0, -3.7, 0.0, 2.6, 0.07), (0.7, -4.75, 0.0, 1.75, 0.06), (1.3, -5.6, 0.0, 0.95, 0.055)],
               M['fin'], chord_pts=9)
    side_parts.append(transformed(fin, Matrix.Translation((F_ENG[0] * 0.92, 0, 0.5))
                                  @ Matrix.Rotation(math.radians(-74), 4, 'Y')))
    side_parts.append(lathe('navlight', [(-2.83, 0.0), (-2.76, 0.065), (-2.64, 0.065), (-2.62, 0.0)], 8,
                            (F_POD_X, tip_z), M['green']))
    parts += mirrored(side_parts)
    for o in parts:
        if o.name == 'navlight_m':          # red to port, green to starboard
            o.data.materials[0] = M['red']

    # Greebles, raycast onto the fuselage and nacelles.
    bvh = bvh_of([o for o in parts if o.name.startswith(('body', 'nacelle'))])
    rng = random.Random(5)
    _, m = frame_on(bvh, (0, 0.6, 5), (0, 0, -1))
    parts.append(box('antenna_base', (0.14, 0.32, 0.06), M['metal'], m))
    parts.append(transformed(lathe('antenna', [(0.0, 0.025), (0.8, 0.01), (0.83, 0.0)], 6, (0, 0), M['metal']),
                             m @ Matrix.Rotation(math.radians(70), 4, 'X') @ Matrix.Rotation(math.radians(180), 4, 'Z')))
    _, m = frame_on(bvh, (0, 4.9, -3), (0, 0, 1))
    parts.append(transformed(lathe('sensor', [(0.0, 0.17), (0.07, 0.16), (0.13, 0.1), (0.155, 0.0)], 12, (0, 0), M['hole']),
                             m @ Matrix.Rotation(math.radians(90), 4, 'X')))
    parts.append(lathe('probe', [(6.95, 0.035), (7.6, 0.012), (7.65, 0.0)], 6, (0, -0.13), M['metal']))
    greebles = []
    for i, (yy, size) in enumerate(((-0.5, (0.4, 0.75, 0.05)), (-1.55, (0.4, 0.6, 0.05)))):
        _, m = frame_on(bvh, (0.62, yy, 5), (0, 0, -1))
        greebles += vent(f'vent{i}', size, M['metal'], m)
    for i, yy in enumerate((-3.5, -4.25)):
        _, m = frame_on(bvh, (5, yy, 0.05), (-1, 0, 0))
        greebles += vent(f'radiator{i}', (0.42, 0.55, 0.04), M['metal'], m, slats=6)
    for i in range(10):
        yy = rng.uniform(-4.0, 4.2)
        zz = rng.uniform(0.5, 2.2)
        try:
            _, m = frame_on(bvh, (2.6, yy, zz), (-2.6, 0, 0.1 - zz))
        except RuntimeError:
            continue
        greebles.append(box(f'plate{i}', (rng.uniform(0.2, 0.5), rng.uniform(0.3, 0.8), 0.025), M['body'], m, taper=0.92))
    _, m = frame_on(bvh, (0.75, -2.0, -3), (0, 0, 1))
    greebles.append(prism('blade', [(0, 0.12), (0.0, -0.12), (0.28, -0.24), (0.3, -0.12)], 0.022, M['metal'],
                          m @ Matrix.Rotation(math.radians(-90), 4, 'Y')))
    parts += mirrored(greebles)

    rcs_bvh = bvh_of([o for o in parts if o.name.startswith(('body', 'nacelle', 'pod'))])
    rcs_parts, empties = place_rcs(F_RCS, rcs_bvh, M)
    parts += rcs_parts
    empties += [
        empty('nozzle_R', (F_ENG[0], -7.43, F_ENG[1])), empty('nozzle_L', (-F_ENG[0], -7.43, F_ENG[1])),
        empty('muzzle_R', (F_POD_X, 3.335, tip_z)), empty('muzzle_L', (-F_POD_X, 3.335, tip_z)),
        empty('cam_cockpit', (0, 2.95, 0.98)),
    ]
    return parts, [glass], empties


# ==========================================================================
# Interceptor (about 11 m long)

INTERCEPTOR_BODY = [
    # y, half-width, top, bottom, centre z  (faceted octagon sections)
    (5.55, 0.05, 0.03, 0.03, -0.08),
    (4.30, 0.44, 0.22, 0.15, -0.06),
    (2.70, 0.8, 0.42, 0.26, -0.03),
    (1.00, 1.1, 0.56, 0.34, 0.0),
    (-0.90, 1.26, 0.64, 0.4, 0.0),
    (-2.70, 1.2, 0.64, 0.44, 0.0),
    (-3.85, 1.0, 0.6, 0.44, 0.0),
]
I_ENG_Z = 0.02
I_UPPER = [(0.7, -0.4, 0.4, 2.7, 0.07), (2.6, 0.45, 0.88, 1.9, 0.06), (4.5, 1.25, 1.36, 1.05, 0.05)]
I_LOWER = [(0.7, -1.1, -0.28, 2.5, 0.07), (2.4, -0.35, -0.72, 1.75, 0.06), (4.05, 0.38, -1.16, 0.95, 0.05)]
I_GUN = (0.98, -0.62)          # gun axis x, z under the lower wing root
EYE_C = Vector((0, 3.2, 0.3))
EYE_AXIS = Vector((0, 0.9, 0.42)).normalized()

I_RCS = [
    ('rcs_01', (0, 3.95, 3), (0, 0, -1), (0, 0, 1)),           # nose up, ahead of the eye
    ('rcs_02', (0, 3.95, -3), (0, 0, 1), (0, 0, -1)),          # nose down
    ('rcs_03', (3, 4.25, 0.0), (-1, 0, 0), (1, 0, 0)),         # nose right, ahead of the canard
    ('rcs_04', (-3, 4.25, 0.0), (1, 0, 0), (-1, 0, 0)),        # nose left
    ('rcs_05', (0, -3.35, 3), (0, 0, -1), (0, 0, 1)),          # tail up, on the engine housing
    ('rcs_06', (0, -3.35, -3), (0, 0, 1), (0, 0, -1)),         # tail down
    ('rcs_07', (4, -3.3, -0.15), (-1, 0, 0), (1, 0, 0)),       # tail right, on the booster
    ('rcs_08', (-4, -3.3, -0.15), (1, 0, 0), (-1, 0, 0)),      # tail left
    ('rcs_09', (4.35, 0.75, 4), (0, 0, -1), (0, 0, 1)),        # right upper wingtip, up
    ('rcs_10', (3.9, -0.1, -4), (0, 0, 1), (0, 0, -1)),        # right lower wingtip, down
    ('rcs_11', (-4.35, 0.75, 4), (0, 0, -1), (0, 0, 1)),       # left upper wingtip, up
    ('rcs_12', (-3.9, -0.1, -4), (0, 0, 1), (0, 0, -1)),       # left lower wingtip, down
    ('rcs_13', (0.32, 4.45, 3), (0, 0, -1), (0.3, 1, 0.1)),    # nose, forward-facing right
    ('rcs_14', (-0.32, 4.45, 3), (0, 0, -1), (-0.3, 1, 0.1)),  # nose, forward-facing left
    ('rcs_15', (0.5, -4.25, 3), (0, 0, -1), (0, -1, 0)),       # housing top, aft-facing right
    ('rcs_16', (-0.5, -4.25, 3), (0, 0, -1), (0, -1, 0)),      # housing top, aft-facing left
]


def interceptor_materials():
    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.3, -0.6)
        ridge = g.mul(g.mul(g.smooth(nz, 0.8, 0.9), band(g, y, -3.0, 2.4, 0.01)), g.sub(1.0, g.smooth(ax, 0.2, 0.22)))
        cheek = g.mul(g.mul(band(g, y, -0.6, 2.2, 0.01), g.smooth(g.absolute(nx), 0.5, 0.6)), band(g, z, 0.06, 0.24, 0.008))
        col = g.mix(ridge, GUNMETAL, OXBLOOD)
        col = g.mix(cheek, col, OXBLOOD)
        col = g.mix(under, col, (0.035, 0.038, 0.042))
        haz = g.mul(band(g, y, -3.6, -3.25, 0.006), g.sub(1.0, under))
        col = g.mix(haz, col, g.mix(hazard(g, x, z), (0.02, 0.02, 0.02), HAZARD))
        col = g.mix(g.smooth(y, 5.0, 5.05), col, DARK)
        rough = g.mixf(ridge, 0.4, 0.5)
        return weathered(g, col, rough, g.mixf(ridge, 0.55, 0.3), P, N, panel_scale=1.25, panel=(1.1, 0.42))

    def wing_paint(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        outer = g.smooth(ax, 3.55, 3.6)
        col = g.mix(outer, GUNMETAL, OXBLOOD)
        tipband = band(g, ax, 3.15, 3.5, 0.006)
        col = g.mix(tipband, col, g.mix(hazard(g, x, y, 0.12), (0.02, 0.02, 0.02), HAZARD))
        under = g.smooth(g.sep(N)[2], -0.2, -0.45)
        col = g.mix(g.mul(under, 0.6), col, (0.035, 0.038, 0.042))
        return weathered(g, col, 0.45, g.mixf(outer, 0.55, 0.3), P, N, panel_scale=1.25, panel=(1.1, 0.42))

    def engine(g, P, N):
        x, y, z = g.sep(P)
        heat = g.smooth(y, -3.6, -4.5)
        col = g.mix(heat, (0.05, 0.053, 0.058), (0.085, 0.065, 0.06))
        haz = band(g, y, -2.75, -2.45, 0.006)
        col = g.mix(haz, col, g.mix(hazard(g, x, z, 0.12), (0.02, 0.02, 0.02), HAZARD))
        return weathered(g, col, g.mixf(heat, 0.45, 0.4), g.mixf(heat, 0.55, 0.65), P, N, wear=0.7, panel_scale=1.4)

    def metal(g, P, N):
        return weathered(g, (0.04, 0.042, 0.046), 0.48, 0.55, P, N, lines=False, wear=0.6)

    def armour(g, P, N):
        return weathered(g, OXBLOOD, 0.42, 0.35, P, N, lines=False, wear=1.2)

    def eye(g, P, N):
        x, y, z = g.sep(P)
        tip = tuple(EYE_C + EYE_AXIS * 0.26)
        d = g.vmath('DISTANCE', P, tip, out=1)
        iris = g.smooth(d, 0.16, 0.06)
        pupil = g.smooth(d, 0.05, 0.02)
        glow = g.mix(iris, (0.16, 0.004, 0.002), (1.0, 0.06, 0.02))
        glow = g.mix(pupil, glow, (1.0, 0.5, 0.3))
        return dict(albedo=(0.06, 0.004, 0.003), rough=0.08, metal=0.0, glow=glow)

    return dict(
        body=material('i_body', body), wing=material('i_wing', wing_paint), engine=material('i_engine', engine),
        nozzle=nozzle_material('i_nozzle', 0.0, I_ENG_Z), metal=material('i_metal', metal),
        armour=material('i_armour', armour), eye=material('i_eye', eye),
        glow=glow_material('i_glow', (1.0, 0.42, 0.12), (0.4, 0.2, 0.1)),
        hole=material('i_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def build_interceptor():
    M = interceptor_materials()
    parts = []
    body = loft('body', INTERCEPTOR_BODY, M['body'], section=faceted, front_tip=(0, 5.75, -0.06),
                back_tip=(0, -3.9, 0.0), smooth=True, sharp=12)
    parts.append(body)

    # Engine: an octagonal armoured housing, a big bell, a glowing throat.
    parts.append(lathe('housing', [(-2.0, 0.0), (-2.05, 0.55), (-2.4, 0.86), (-4.1, 0.86), (-4.45, 0.8), (-4.5, 0.0)],
                       8, (0, I_ENG_Z), M['engine'], smooth=True, sharp=20, phase=math.pi / 8))
    parts.append(lathe('bell', [(-4.4, 0.7), (-4.9, 0.68), (-5.38, 0.76), (-5.45, 0.76), (-5.46, 0.72),
                                (-5.0, 0.6), (-4.68, 0.42), (-4.55, 0.4), (-4.47, 0.5), (-4.42, 0.62)],
                       32, (0, I_ENG_Z), M['nozzle'], closed=True, sharp=35))
    parts.append(lathe('throat', [(-4.62, 0.0), (-4.62, 0.42), (-4.58, 0.42), (-4.58, 0.0)], 32, (0, I_ENG_Z),
                       M['glow'], smooth=False))
    for k, yy in enumerate((-2.9, -3.7)):
        parts.append(lathe(f'band{k}', [(yy, 0.0), (yy, 0.9), (yy - 0.14, 0.9), (yy - 0.14, 0.0)], 8, (0, I_ENG_Z),
                           M['metal'], smooth=False, phase=math.pi / 8))

    dorsal = wing('dorsal', [(0.0, -1.9, 0.0, 2.6, 0.06), (0.75, -3.1, 0.0, 1.5, 0.05), (1.15, -3.95, 0.0, 0.7, 0.05)],
                  M['armour'], chord_pts=6, diamond=True, sharp=20)
    parts.append(transformed(dorsal, Matrix.Translation((0, 0, 0.62)) @ Matrix.Rotation(math.radians(-90), 4, 'Y')))
    ventral = wing('ventral', [(0.0, -2.4, 0.0, 2.0, 0.06), (0.55, -3.3, 0.0, 1.1, 0.05)],
                   M['metal'], chord_pts=6, diamond=True, sharp=20)
    parts.append(transformed(ventral, Matrix.Translation((0, 0, -0.62)) @ Matrix.Rotation(math.radians(90), 4, 'Y')))

    # Sensor eye: a red lens with a hot core in a hexagonal housing.
    eye_m = facing(EYE_C, EYE_AXIS)
    parts.append(transformed(lathe('eye_housing', [(-0.12, 0.0), (-0.12, 0.44), (0.07, 0.42), (0.12, 0.34), (0.12, 0.0)],
                                   6, (0, 0), M['metal'], smooth=False, phase=math.pi / 6),
                             eye_m @ Matrix.Rotation(math.radians(90), 4, 'X')))
    lens = lathe('eye', [(0.06, 0.31), (0.15, 0.28), (0.23, 0.16), (0.26, 0.0)], 20, (0, 0), M['eye'])
    parts.append(transformed(lens, eye_m @ Matrix.Rotation(math.radians(90), 4, 'X')))

    side = []
    # forward-swept split wing: an upper and a lower blade per side
    side.append(wing('upper', I_UPPER, M['wing'], chord_pts=7, diamond=True, sharp=20))
    side.append(wing('lower', I_LOWER, M['wing'], chord_pts=7, diamond=True, sharp=20))
    # wingtip spikes, and armoured leading-edge strips along each blade
    for nm, secs in (('u', I_UPPER), ('l', I_LOWER)):
        x, yle, z, chord, _ = secs[-1]
        side.append(lathe('spike_' + nm, [(yle - chord + 0.1, 0.0), (yle - chord + 0.15, 0.07), (yle + 0.2, 0.07),
                                          (yle + 1.2, 0.0)], 6, (x + 0.02, z), M['metal'], smooth=False))
        path = [Vector((sx, sy - 0.04, sz)) for sx, sy, sz, _, _ in secs]
        path[0] = path[0].lerp(path[1], 0.25)
        side.append(bar('strip_' + nm, path, 0.13, 0.05, M['armour'],
                        lambda p, nm=nm: Vector((0, 0.3, 1.0 if nm == 'u' else -1.0))))
    # canards: small swept blades on the nose chines, angled down
    canard = wing('canard', [(0.0, 3.9, 0.0, 1.3, 0.07), (0.85, 3.25, 0.0, 0.5, 0.06)], M['armour'],
                  chord_pts=5, diamond=True, sharp=20)
    side.append(transformed(canard, Matrix.Translation((0.62, 0, -0.04)) @ Matrix.Rotation(math.radians(18), 4, 'Y')))
    # side booster
    side.append(lathe('booster', [(-1.4, 0.0), (-1.55, 0.2), (-1.9, 0.27), (-3.8, 0.27), (-4.0, 0.24)], 8,
                      (1.28, -0.12), M['engine'], smooth=True, sharp=25, phase=math.pi / 8))
    side.append(lathe('booster_bell', [(-3.95, 0.21), (-4.35, 0.24), (-4.37, 0.215), (-4.1, 0.15), (-3.97, 0.17)], 16,
                      (1.28, -0.12), M['nozzle'], closed=True, sharp=35))
    side.append(lathe('booster_glow', [(-4.08, 0.0), (-4.08, 0.16), (-4.05, 0.16), (-4.05, 0.0)], 16, (1.28, -0.12),
                      M['glow'], smooth=False))
    # gun under the lower wing root: a faceted housing and a long barrel
    gx, gz = I_GUN
    side.append(loft('gun', [(1.2, 0.04, 0.03, 0.03, 0.0), (0.9, 0.16, 0.12, 0.1, 0.0), (-0.4, 0.2, 0.14, 0.13, 0.0),
                             (-1.6, 0.18, 0.12, 0.1, 0.0)], M['metal'], section=faceted, back_tip=(0, -1.7, 0.0),
                     smooth=True, sharp=15))
    transformed(side[-1], Matrix.Translation((gx, 0, gz)))
    side.append(lathe('barrel', [(0.9, 0.0), (0.9, 0.055), (2.45, 0.055), (2.47, 0.075), (2.68, 0.075), (2.7, 0.0)],
                      8, (gx, gz), M['metal'], sharp=40))
    side.append(lathe('bore', [(2.62, 0.0), (2.62, 0.04), (2.705, 0.04), (2.705, 0.0)], 8, (gx, gz), M['hole'], smooth=False))
    # armour plates on the shoulders, vents on the spine, a raked antenna
    bvh = bvh_of([body])
    for i, (yy, zz, size) in enumerate(((1.4, 2.0, (0.42, 1.1, 0.06)), (-0.7, 2.0, (0.5, 1.2, 0.06)),
                                        (-2.2, 2.0, (0.46, 0.9, 0.06)))):
        _, m = frame_on(bvh, (1.6, yy, zz), (-1.6, 0, -zz + 0.2))
        side.append(box(f'plate{i}', size, M['armour'], m, taper=0.88))
    for i, yy in enumerate((0.2, -1.6)):
        _, m = frame_on(bvh, (0.32, yy, 3), (0, 0, -1))
        side += vent(f'vent{i}', (0.3, 0.6, 0.05), M['metal'], m, slats=4)
    _, m = frame_on(bvh, (0.0 + 0.4, -3.3, 3), (0, 0, -1))
    side.append(transformed(lathe('antenna', [(0.0, 0.02), (0.65, 0.008), (0.68, 0.0)], 5, (0, 0), M['metal']),
                            m @ Matrix.Rotation(math.radians(62), 4, 'X') @ Matrix.Rotation(math.radians(180), 4, 'Z')))
    parts += mirrored(side)

    rcs_bvh = bvh_of([o for o in parts if o.name.startswith(('body', 'housing', 'booster', 'upper', 'lower'))])
    rcs_parts, empties = place_rcs(I_RCS, rcs_bvh, M)
    parts += rcs_parts
    empties += [
        empty('nozzle_C', (0, -5.46, I_ENG_Z)),
        empty('muzzle_R', (gx, 2.705, gz)), empty('muzzle_L', (-gx, 2.705, gz)),
        empty('cam_cockpit', (0, 2.4, 0.5)),
    ]
    return parts, [], empties


# ==========================================================================
# Bake, export, anchors

def bake_ship(name, parts, extras, empties, tex):
    hull = C.join(parts, 'hull')
    C.smart_uv(hull, angle=60.0, margin=0.003)
    C.triangulate(hull)
    hull.data.set_sharp_from_angle(angle=math.radians(42))
    size_base, size_mr = (256, 128) if FAST else tex
    base = C.new_image(name + '_base', size_base)
    nrm = C.new_image(name + '_normal', size_base, non_color=True)
    rough = C.new_image(name + '_rough', size_mr, non_color=True)
    metal = C.new_image(name + '_metal', size_mr, non_color=True)
    glow = C.new_image(name + '_emissive', size_mr)
    for o in extras:
        o.hide_render = True
    high = C.duplicate(hull, 'hull_high')
    bev = high.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.02
    bev.segments = 3
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(40)
    C.apply_modifiers(high)
    high.data.shade_smooth()
    margin = max(2, size_base // 256)
    C.bake(hull, nrm, 'NORMAL', sources=[high], extrusion=0.015, max_ray=0.04, margin=margin,
           samples=1 if FAST else 4)
    bpy.data.objects.remove(high)
    s = 1 if FAST else 16
    C.bake(hull, base, channel='albedo', margin=margin, samples=s)
    small = max(1, margin * size_mr // size_base)
    C.bake(hull, rough, channel='rough', margin=small, samples=max(1, s // 2))
    C.bake(hull, metal, channel='metal', margin=small, samples=max(1, s // 2))
    C.bake(hull, glow, channel='glow', margin=small, samples=1)
    for o in extras:
        o.hide_render = False
    mr = C.pack_mr(name + '_mr', rough, metal)
    dump = os.environ.get('METEORA_DUMP')
    if dump:
        for img in (base, nrm, mr, glow):
            copy = img.copy()
            copy.filepath_raw = os.path.join(dump, img.name + '.png')
            copy.file_format = 'PNG'
            copy.save()
            bpy.data.images.remove(copy)
    mat = C.baked_material(name, base, nrm, mr, glow)
    hull.data.materials.clear()
    hull.data.materials.append(mat)
    hull.data.polygons.foreach_set('material_index', [0] * len(hull.data.polygons))
    for e in empties:
        e.parent = hull
    return hull


def anchor_record(e, kind):
    mw = e.matrix_world
    rec = {'name': e.name, 'pos': [round(v, 3) + 0.0 for v in C.to_gltf(mw.translation)]}
    if kind in ('rcs', 'nozzle'):
        local = Vector((0, 0, 1)) if kind == 'rcs' else Vector((0, -1, 0))
        d = (mw.to_3x3() @ local).normalized()
        rec['dir'] = [round(v, 4) + 0.0 for v in C.to_gltf(d)]
    return rec


def ship_anchors(hull, extras, empties):
    radius = max(v.co.length for o in [hull] + extras for v in o.data.vertices)
    by = lambda prefix: sorted((e for e in empties if e.name.startswith(prefix)), key=lambda e: e.name)
    cockpit = next(e for e in empties if e.name == 'cam_cockpit')
    return {
        'radius': round(radius, 2),
        'nozzles': [anchor_record(e, 'nozzle') for e in by('nozzle_')],
        'muzzles': [anchor_record(e, 'muzzle') for e in by('muzzle_')],
        'rcs': [anchor_record(e, 'rcs') for e in by('rcs_')],
        'cockpit': anchor_record(cockpit, 'point')['pos'],
    }


def fmt(v):
    return '[' + ', '.join(f'{x:g}' for x in v) + ']'


def write_anchors(data):
    lines = [
        '/* Meteora — ship anchors. GENERATED by tools/blender/build_ships.py from the',
        '   empties in fighter.glb and interceptor.glb; do not edit by hand.',
        '',
        '   glTF / three.js space, metres: nose along -Z, top +Y, right +X; Blender',
        '   (x, y, z) maps to (x, z, -y). `radius` bounds the hull from the origin.',
        '   Nozzle `dir` is the exhaust direction (the empty\'s Blender local -Y); RCS',
        '   `dir` is the puff direction out of the hull (Blender local +Z), so a port',
        '   pushes the ship along -dir. `cockpit` is the nose-camera eye point. */',
        'export const ANCHORS = {',
    ]
    for key, a in data.items():
        lines += [f'  {key}: {{', f"    radius: {a['radius']:g},", '    nozzles: [']
        lines += [f"      {{ name: '{n['name']}', pos: {fmt(n['pos'])}, dir: {fmt(n['dir'])} }}," for n in a['nozzles']]
        lines += ['    ],', '    muzzles: [']
        lines += [f"      {{ name: '{n['name']}', pos: {fmt(n['pos'])} }}," for n in a['muzzles']]
        lines += ['    ],', '    rcs: [']
        lines += [f"      {{ name: '{n['name']}', pos: {fmt(n['pos'])}, dir: {fmt(n['dir'])} }}," for n in a['rcs']]
        lines += ['    ],', f"    cockpit: {fmt(a['cockpit'])},", '  },']
    lines.append('};')
    path = os.path.join(C.JS, 'anchors.js')
    with open(path, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    C.log('wrote', os.path.relpath(path, C.ROOT))


SHIPS = [
    ('fighter', build_fighter, (2048, 1024)),
    ('interceptor', build_interceptor, (1024, 1024)),
]


def main(only=None):
    data = {}
    for name, build, tex in SHIPS:
        if only and name not in only:
            continue
        C.reset(samples=8)
        C.log('ship', name)
        parts, extras, empties = build()
        hull = bake_ship(name, parts, extras, empties, tex)
        C.log(f'  {name}: {C.tri_count(hull) + sum(C.tri_count(o) for o in extras)} tris')
        C.export_glb(os.path.join(C.MODELS, name + '.glb'), [hull] + extras + empties)
        data[name] = ship_anchors(hull, extras, empties)
    if len(data) == len(SHIPS):
        write_anchors(data)
    else:
        C.log('partial build: js/anchors.js left unchanged')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
