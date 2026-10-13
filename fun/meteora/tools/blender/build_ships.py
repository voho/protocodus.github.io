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

The Kestrel (fighter.glb) is built for close inspection in the hangar:
split wings with drooped flaps and ailerons, a rudder on each fin, cheek
intakes with splitter plates, ducts and fans, nozzles with petals, a
stepped liner and a turbine inside, heat-sink fins, RCS thruster clusters,
a slotted gun shroud and muzzle brake, a missile on a railed pylon, a
framed canopy, antennas, a nose sensor turret, vents and plates. Its paint
adds riveted panels with access hatches (panel_grid, weathered_fine),
soot, wear, and markings and stencil text drawn into a decal atlas that
the materials look up (DecalAtlas, decal). bake_ship_fine() deletes the
faces hidden inside other solids before unwrapping and sizes the UV
islands by how closely each part is seen (uv_weights), so the textures
stay as sharp as before over twice the surface.

Anchors are empties parented to the hull: `nozzle_*` (local -Y is the
exhaust direction), `muzzle_*`, `rcs_NN` (local +Z is the puff direction,
out of the hull) and `cam_cockpit`. After export their world transforms
are converted to glTF space and written to js/anchors.js; a build of only
some ships rewrites only their blocks there.

Set METEORA_FAST=1 for quick geometry iterations (tiny textures, 1 sample).
"""
import bpy, bmesh, math, os, random, re, sys
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
# Detail helpers: geometry (written for the Kestrel; usable by any model)

T, R = Matrix.Translation, Matrix.Rotation
YZX = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))).to_4x4()     # maps X -> Y, Y -> Z, Z -> X


def canonical(obj):
    """Rebuild obj's mesh with its vertices sorted by position, every face
    starting at its lowest vertex and the faces sorted, so that the export
    does not depend on the order a bmesh operator (bisect) left them in.
    Keeps materials, material indices and smooth flags."""
    me = obj.data
    co = [tuple(round(c, 6) for c in v.co) for v in me.vertices]
    order = sorted(range(len(co)), key=lambda i: co[i])
    new_index = {old: new for new, old in enumerate(order)}
    verts = [me.vertices[i].co.copy() for i in order]
    polys = []
    for poly in me.polygons:
        vs = [new_index[i] for i in poly.vertices]
        k = vs.index(min(vs))
        polys.append((tuple(vs[k:] + vs[:k]), poly.material_index, poly.use_smooth))
    polys.sort(key=lambda t: t[0])
    new = bpy.data.meshes.new(me.name)
    new.from_pydata(verts, [], [t[0] for t in polys])
    for poly, (_, mi, smooth) in zip(new.polygons, polys):
        poly.material_index = mi
        poly.use_smooth = smooth
    for m in me.materials:
        new.materials.append(m)
    name = me.name
    obj.data = new
    bpy.data.meshes.remove(me)
    new.name = name
    return obj


def finish_multi(name, bm, mats, smooth=True, sharp=None):
    """finish_bm() for a mesh whose faces carry material indices into `mats`."""
    obj = finish_bm(name, bm, mats[0], smooth=smooth, sharp=sharp)
    for m in mats[1:]:
        obj.data.materials.append(m)
    return obj


def interp_rows(rows, x):
    """Every column of `rows` (sorted by their first value) linearly
    interpolated at x, clamped to the end rows."""
    if x <= rows[0][0]:
        return tuple(rows[0])
    for a, b in zip(rows, rows[1:]):
        if a[0] <= x <= b[0]:
            t = (x - a[0]) / (b[0] - a[0]) if b[0] != a[0] else 0.0
            return tuple(p + (q - p) * t for p, q in zip(a, b))
    return tuple(rows[-1])


def airfoil_ring(sec, u0, u1, n, belly):
    """One wing() section (x, y_le, z, chord, thickness) between chord
    fractions u0 and u1: the top surface front to back, then the bottom
    back to front, leaving out the points where the section closes."""
    x, yle, z, chord, thick = sec
    top, bot = [], []
    for i in range(n):
        u = u0 + (u1 - u0) * (1 - math.cos(math.pi * i / (n - 1))) / 2
        t = naca(max(u, 0.0)) * thick * chord / 2
        top.append((x, yle - u * chord, z + t))
        bot.append((x, yle - u * chord, z - t * belly))
    bot = bot[::-1]
    if u1 >= 0.999:
        bot = bot[1:]
    if u0 <= 0.001:
        bot = bot[:-1]
    return top + bot


def wing_slice(name, sections, mat, x0, x1, u0=0.0, u1=1.0, chord_pts=12, belly=0.75, sharp=50):
    """A piece of the wing() with these sections: span x0..x1 (the end
    sections interpolated, those between kept) and chord fractions u0..u1.
    A closed solid with flat cut faces; [0, 1] over the whole span is the
    wing() itself."""
    xs = [x0] + [s[0] for s in sections if x0 + 1e-6 < s[0] < x1 - 1e-6] + [x1]
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in airfoil_ring(interp_rows(sections, x), u0, u1, chord_pts, belly)]
             for x in xs]
    ring_faces(bm, rings)
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return finish_bm(name, bm, mat, smooth=True, sharp=sharp)


def hinge_point(sec, u, belly=0.75):
    """Mid-thickness point of a wing section at chord fraction u."""
    x, yle, z, chord, thick = sec
    t = naca(u) * thick * chord / 2
    return Vector((x, yle - u * chord, z + t * (1 - belly) / 2))


def turn_about(obj, p0, p1, angle):
    """Rotate obj's mesh by `angle` (radians) about the line p0 -> p1."""
    p0 = Vector(p0)
    axis = (Vector(p1) - p0).normalized()
    return transformed(obj, T(p0) @ R(angle, 4, axis) @ T(-p0))


def surfaced_wing(prefix, sections, mat, surfaces, hinge=0.76, gap=0.006, slot=0.03, chord_pts=12,
                  belly=0.75, sharp=50):
    """A wing() split into fixed pieces and hinged control surfaces.
    surfaces: (name, x0, x1, degrees), sorted along the span; a positive
    angle turns the trailing edge toward -Z on a wing along +X. Each
    surface runs from chord fraction hinge + gap to the trailing edge and
    leaves a `slot` to the fixed wing at both of its ends."""
    parts, k = [], 0
    prev, tip = sections[0][0], sections[-1][0]

    def piece(a, b, u1):
        nonlocal k
        parts.append(wing_slice(f'{prefix}{k}', sections, mat, a, b, 0.0, u1, chord_pts, belly, sharp))
        k += 1

    for name, a, b, angle in surfaces:
        if a - prev > 1e-4:
            piece(prev, a, 1.0)
        piece(a, b, hinge)
        cs = wing_slice(name, sections, mat, a + slot / 2, b - slot / 2, hinge + gap, 1.0,
                        max(5, chord_pts // 2), belly, sharp)
        if angle:
            turn_about(cs, hinge_point(interp_rows(sections, a), hinge, belly),
                       hinge_point(interp_rows(sections, b), hinge, belly), math.radians(angle))
        parts.append(cs)
        prev = b
    if tip - prev > 1e-4:
        piece(prev, tip, 1.0)
    return parts


def petal_ring(name, count, y0, y1, r0, r1, centre, mat, cover=1.1, thick=0.018, lift=0.35, phase=0.0):
    """Nozzle petals: `count` curved flaps on the cone from (y0, r0) to
    (y1, r1) round the Y axis through centre (x, z), overlapping by
    `cover`; every other one sits `lift` of its thickness proud."""
    cx, cz = centre
    bm = bmesh.new()
    half = math.pi / count * cover
    for i in range(count):
        a = 2 * math.pi * i / count + phase
        up = thick * (lift if i % 2 else 0.0)
        vs = []
        for off in (0.0, thick):
            for y, r in ((y0, r0), (y1, r1)):
                for s in (-1, 1):
                    b, rr = a + s * half, r + up + off
                    vs.append(bm.verts.new((cx + rr * math.cos(b), y, cz + rr * math.sin(b))))
        for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            bm.faces.new([vs[j] for j in f])
    return finish_bm(name, bm, mat, smooth=False)


def blade_ring(name, count, y, r0, r1, chord, thick, twist, centre, mat, phase=0.0):
    """Flat blades round the Y axis through centre (x, z) at station y,
    from radius r0 to r1, each turned `twist` degrees out of the axial
    plane: turbine and fan blades, stator vanes."""
    cx, cz = centre
    tw = math.radians(twist)
    bm = bmesh.new()
    for i in range(count):
        a = 2 * math.pi * i / count + phase
        radial = Vector((math.cos(a), 0, math.sin(a)))
        tangent = Vector((-math.sin(a), 0, math.cos(a)))
        cdir = Vector((0, 1, 0)) * math.cos(tw) + tangent * math.sin(tw)
        ndir = cdir.cross(radial).normalized()
        vs = []
        for r in (r0, r1):
            base = Vector((cx, y, cz)) + radial * r
            for c in (-0.5, 0.5):
                for t in (-0.5, 0.5):
                    vs.append(bm.verts.new(base + cdir * chord * c + ndir * thick * t))
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            bm.faces.new([vs[j] for j in f])
    return finish_bm(name, bm, mat, smooth=False)


def fin_arcs(name, centre, radius_at, ys, a0, a1, height, thick, mat, segs=12, embed=0.012):
    """Heat-sink fins: annular sectors round the Y axis through centre
    (x, z), one at each station y, from angle a0 to a1 (degrees; 0 is +X,
    90 is +Z), standing `height` proud of the surface radius radius_at(y)."""
    cx, cz = centre
    bm = bmesh.new()
    for y in ys:
        ri, ro = radius_at(y) - embed, radius_at(y) + height
        rings = []
        for k in range(segs + 1):
            a = math.radians(a0 + (a1 - a0) * k / segs)
            c, s = math.cos(a), math.sin(a)
            rings.append([bm.verts.new((cx + r * c, y + dy, cz + r * s))
                          for r, dy in ((ri, -thick / 2), (ro, -thick / 2), (ro, thick / 2), (ri, thick / 2))])
        ring_faces(bm, rings)
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    return finish_bm(name, bm, mat, smooth=False)


def rounded_rect(around, w, h, n, xc, zc):
    """A superellipse ring (exponent n) of half-sizes w, h centred on (xc, zc)."""
    pts = []
    for i in range(around):
        a = 2 * math.pi * i / around
        c, s = math.cos(a), math.sin(a)
        pts.append((xc + w * math.copysign(abs(c) ** (2 / n), c), zc + h * math.copysign(abs(s) ** (2 / n), s)))
    return pts


def intake(name, outer, inner, mats, around=24):
    """An air intake as one closed solid. `outer` rows (y, xc, zc, w, h, n)
    run along the cowl from aft to the lip's apex, `inner` rows from the lip
    into the duct; the cowl's aft end and the duct's floor are capped. The
    duct's faces take the second material."""
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for x, z in rounded_rect(around, w, h, n, xc, zc)]
             for y, xc, zc, w, h, n in outer + inner]
    for k, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(around):
            j = (i + 1) % around
            bm.faces.new((a[i], a[j], b[j], b[i])).material_index = 1 if k >= len(outer) else 0
    bm.faces.new(rings[0][::-1]).material_index = 0
    bm.faces.new(rings[-1]).material_index = 1
    return finish_multi(name, bm, mats, smooth=True, sharp=50)


def tray(name, size, mat, matrix, depth=0.022, wall=0.028, base=-0.03, top=0.045, taper=0.88):
    """A raised housing with a recessed floor, on the frame's XY plane
    (+Z out): outer walls tapering by `taper`, a rim `wall` wide, a well
    `depth` deep."""
    sx, sy = size[0] / 2, size[1] / 2
    bm = bmesh.new()

    def rect(hx, hy, z):
        return [bm.verts.new((x, y, z)) for x, y in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))]
    b0 = rect(sx, sy, base)
    t0 = rect(sx * taper, sy * taper, top)
    t1 = rect(sx * taper - wall, sy * taper - wall, top)
    f0 = rect(sx * taper - wall, sy * taper - wall, top - depth)
    bm.faces.new(b0[::-1])
    ring_faces(bm, [b0, t0, t1, f0])
    bm.faces.new(f0)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return finish_bm(name, bm, mat, smooth=False)


def thruster_bell(name, r, h, sides, mats, matrix, base=0.018):
    """A small thruster bell along the frame's +Z: bare outside and lip
    (first material), a dark cone inside (second)."""
    bm = bmesh.new()

    def ring(z, rr):
        return [bm.verts.new((rr * math.cos(2 * math.pi * i / sides), rr * math.sin(2 * math.pi * i / sides), z))
                for i in range(sides)]
    b, e, lip = ring(base, r * 0.72), ring(base + h, r), ring(base + h, r * 0.7)
    bot, tip = bm.verts.new((0, 0, base)), bm.verts.new((0, 0, base + h * 0.3))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((bot, b[j], b[i]))
        bm.faces.new((b[i], b[j], e[j], e[i]))
        bm.faces.new((e[i], e[j], lip[j], lip[i]))
        bm.faces.new((lip[i], lip[j], tip)).material_index = 1
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return finish_multi(name, bm, mats, smooth=False)


def rcs_cluster(name, metal, bell_mats, matrix, size=0.2):
    """An RCS thruster cluster: a housing with a recessed well, the main
    bell on the frame's +Z (where rcs_block's nozzle was) and two small
    bells fore and aft of it, canted outward."""
    parts = [tray(name, (size * 1.05, size * 1.6), metal, matrix, top=0.032, taper=0.8)]
    parts.append(thruster_bell(name + '_n', 0.046, 0.05, 8, bell_mats, matrix, base=0.006))
    for k, s in enumerate((-1, 1)):
        m = matrix @ T((0, s * size * 0.36, 0)) @ R(math.radians(s * -22), 4, 'X')
        parts.append(thruster_bell(f'{name}_s{k}', 0.026, 0.036, 6, bell_mats, m, base=0.006))
    return parts


def place_rcs_clusters(ports, bvh, housing, bell_mats, size=0.2):
    """place_rcs() with thruster clusters: the same frames, and the same
    empties (just outside the main bell, local +Z along the puff).
    `housing` is a material, or a function of the port's name giving one
    (the paint of the surface the cluster sits on)."""
    parts, empties = [], []
    for name, origin, ray, puff in ports:
        loc, m = frame_on(bvh, origin, ray)
        d = Vector(puff).normalized()
        if m.col[2].xyz.dot(d) < 0.8:
            m = facing(loc + d * 0.03, d)
        mat = housing(name) if callable(housing) else housing
        parts += rcs_cluster(name + '_block', mat, bell_mats, m, size)
        empties.append(empty(name, m.translation + m.col[2].xyz * 0.08, d))
    return parts, empties


def tube(name, p0, p1, r, mat, sides=8, smooth=True):
    """A capped cylinder from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    obj = lathe(name, [(0.0, 0.0), (0.0, r), (d.length, r), (d.length, 0.0)], sides, (0, 0), mat,
                smooth=smooth, sharp=40)
    return transformed(obj, T(p0) @ d.to_track_quat('Y', 'Z').to_matrix().to_4x4())


def dome(name, r, h, mat, matrix, sides=12):
    """A small dome on the frame's XY plane (+Z out): lights, sensors."""
    prof = [(-0.02, 0.0), (-0.02, r), (0.0, r), (h * 0.5, r * 0.87), (h * 0.85, r * 0.5), (h, 0.0)]
    return transformed(lathe(name, prof, sides, (0, 0), mat, sharp=70), matrix @ R(math.radians(90), 4, 'X'))


def blade_antenna(name, mat, matrix, height=0.26, root=0.34, tip=0.11, sweep=0.2, thick=0.022):
    """A swept blade antenna standing on the frame's XY plane, leading
    edge toward the frame's +Y."""
    outline = [(-0.03, root / 2), (-0.03, -root / 2), (height, root / 2 - sweep - tip), (height, root / 2 - sweep)]
    return prism(name, outline, thick, mat, matrix @ R(math.radians(-90), 4, 'Y'))


def drape_plate(name, bvh, origin, ray, size, mat, angle=0.0, thick=0.016, inset=0.9, embed=0.02, n=3,
                along=(0, 1, 0)):
    """A plate that follows the surface it lies on: an n x n grid over a
    size[0] x size[1] footprint (turned `angle` radians about the normal
    at the ray's hit), each point projected onto the surface; the bottom
    `embed` under it, the top `thick` over it and drawn in by `inset`, so
    the plate has chamfered edges and leaves no gap on a curved hull."""
    loc, m = frame_on(bvh, origin, ray, along)
    m = m @ R(angle, 4, 'Z')
    X, Y, Z = m.col[0].xyz, m.col[1].xyz, m.col[2].xyz

    def surface(u, v):
        p = loc + X * u + Y * v
        hit = bvh.ray_cast(p + Z * 0.5, -Z, 1.5)[0]
        return hit if hit is not None else p

    bm = bmesh.new()
    grids = []
    for k, off in ((1.0, -embed), (inset, thick)):
        grids.append([[bm.verts.new(surface((i / (n - 1) - 0.5) * size[0] * k, (j / (n - 1) - 0.5) * size[1] * k)
                                    + Z * off) for j in range(n)] for i in range(n)])
    lo, hi = grids
    for i in range(n - 1):
        for j in range(n - 1):
            bm.faces.new((hi[i][j], hi[i + 1][j], hi[i + 1][j + 1], hi[i][j + 1]))
            bm.faces.new((lo[i][j], lo[i][j + 1], lo[i + 1][j + 1], lo[i + 1][j]))
    ring = [(i, 0) for i in range(n - 1)] + [(n - 1, j) for j in range(n - 1)] + \
           [(i, n - 1) for i in range(n - 1, 0, -1)] + [(0, j) for j in range(n - 1, 0, -1)]
    for k in range(len(ring)):
        (a, b), (c, d) = ring[k], ring[(k + 1) % len(ring)]
        bm.faces.new((lo[a][b], lo[c][d], hi[c][d], hi[a][b]))
    return finish_bm(name, bm, mat, smooth=False)


def grille(name, size, mat, matrix, bars=6):
    """A cooling grille: a housing with a recessed well and bars across it."""
    sx, sy, h = size
    parts = [tray(name, (sx, sy), mat, matrix, depth=h * 0.85, wall=0.024, base=-0.025, top=h, taper=0.94)]
    inner = sx * 0.94 - 0.048
    for i in range(bars):
        x = -inner / 2 + inner * (i + 0.5) / bars
        parts.append(box(f'{name}_b{i}', (0.014, sy * 0.94 - 0.05, h * 0.7), mat, matrix @ T((x, 0, h * 0.5))))
    return parts


# ==========================================================================
# Detail helpers: decals. Markings and stencil text are drawn once into an
# image (the "atlas") that the paint materials look up, rather than built
# from shader nodes: text from Blender's built-in font, emblems from simple
# vector shapes, all white on black in the R, G and B channels.

def text_triangles(text, bold=0.0):
    """The filled glyphs of `text` in Blender's built-in font (size 1,
    lines 1.2 apart) as an (n, 3, 2) array of triangles."""
    cu = bpy.data.curves.new('_decal_text', 'FONT')
    cu.body = text
    cu.offset = bold
    cu.space_line = 1.2
    ob = bpy.data.objects.new('_decal_text', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    co = np.array([v.co[:2] for v in me.vertices], dtype=float)
    tris = np.array([co[list(t.vertices)] for t in me.loop_triangles], dtype=float).reshape(-1, 3, 2)
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return tris


def raster_triangles(canvas, tris):
    """Set the cells of `canvas` (rows bottom-up) whose centres lie inside
    any of the triangles (pixel coordinates)."""
    H, W = canvas.shape
    for t in tris:
        x0, x1 = max(int(math.floor(t[:, 0].min())), 0), min(int(math.ceil(t[:, 0].max())), W - 1)
        y0, y1 = max(int(math.floor(t[:, 1].min())), 0), min(int(math.ceil(t[:, 1].max())), H - 1)
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (qx, qy) = t
        e0 = (bx - ax) * (Y - ay) - (by - ay) * (X - ax)
        e1 = (qx - bx) * (Y - by) - (qy - by) * (X - bx)
        e2 = (ax - qx) * (Y - qy) - (ay - qy) * (X - qx)
        inside = ((e0 >= 0) & (e1 >= 0) & (e2 >= 0)) | ((e0 <= 0) & (e1 <= 0) & (e2 <= 0))
        canvas[y0:y1 + 1, x0:x1 + 1] |= inside


def fan(points):
    """A convex polygon as triangles (for raster_triangles)."""
    return np.array([[points[0], points[i], points[i + 1]] for i in range(1, len(points) - 1)], dtype=float)


class DecalAtlas:
    """Entries are added with text() (Blender's font) or shape() (a painter
    drawing into supersampled boolean canvases, one per channel), laid out
    in rows, and rasterised into one Non-Color image by build(). rect(name)
    gives an entry's rectangle in image UV and its aspect (width / height).
    Text heights are the cap height in pixels. Keep the image square:
    smart_project(correct_aspect=True) reads the aspect of the image nodes
    in a mesh's materials and would squash the unwrap of a non-square one."""

    def __init__(self, name, width=2048, height=2048, ss=4, pad=10):
        self.name, self.W, self.H, self.ss, self.pad = name, width, height, ss, pad
        self.entries, self.rects, self.image = [], {}, None

    def text(self, name, text, px=40, bold=0.015, channel=0):
        tris = text_triangles(text, bold)
        lo, hi = tris.reshape(-1, 2).min(axis=0), tris.reshape(-1, 2).max(axis=0)
        k = px / 0.72                      # the font's cap height is about 0.72
        w, h = int(math.ceil((hi[0] - lo[0]) * k)) + 2, int(math.ceil((hi[1] - lo[1]) * k)) + 2

        def paint(canvases, s):
            raster_triangles(canvases[channel], (tris - lo) * k * s + s)
        self.entries.append((name, w, h, paint))

    def shape(self, name, w, h, paint):
        self.entries.append((name, w, h, paint))

    def build(self):
        img = np.zeros((self.H, self.W, 4), np.float32)
        img[..., 3] = 1.0
        x = y = self.pad
        row_h = 0
        for name, w, h, paint in self.entries:
            if x + w + self.pad > self.W:
                x, y, row_h = self.pad, y + row_h + self.pad, 0
            if y + h + self.pad > self.H:
                raise RuntimeError(f'decal atlas {self.name} is full at {name}')
            s = self.ss
            canvases = [np.zeros((h * s, w * s), bool) for _ in range(3)]
            paint(canvases, s)
            for c in range(3):
                cov = canvases[c].reshape(h, s, w, s).mean(axis=(1, 3))
                img[y:y + h, x:x + w, c] = np.maximum(img[y:y + h, x:x + w, c], cov)
            self.rects[name] = (x / self.W, y / self.H, (x + w) / self.W, (y + h) / self.H, w / h)
            x += w + self.pad
            row_h = max(row_h, h)
        image = bpy.data.images.new(self.name, self.W, self.H, alpha=False, float_buffer=False)
        image.colorspace_settings.name = 'Non-Color'
        C.set_pixels(image, img)
        image.pack()
        self.image = image
        return self

    def rect(self, name):
        return self.rects[name]


def disc(canvas, s, cx, cy, r0, r1=None):
    """Mark a disc (or the ring r0..r1) centred on (cx, cy), in entry pixels."""
    H, W = canvas.shape
    X, Y = np.meshgrid((np.arange(W) + 0.5) / s, (np.arange(H) + 0.5) / s)
    d = np.hypot(X - cx, Y - cy)
    canvas |= (d <= r0) if r1 is None else ((d >= r0) & (d <= r1))


def poly(canvas, s, points):
    """Mark a convex polygon given in entry pixels."""
    raster_triangles(canvas, fan([(px * s, py * s) for px, py in points]))


# ==========================================================================
# Detail helpers: paint

def rect_mask(g, u, v, u0, u1, v0, v1, soft=0.004):
    return g.mul(band(g, u, u0, u1, soft), band(g, v, v0, v1, soft))


def outline_mask(g, u, v, u0, u1, v0, v1, w, soft=0.002):
    """A rectangle's outline, w wide, inside its edges."""
    return g.sub(rect_mask(g, u, v, u0, u1, v0, v1, soft), rect_mask(g, u, v, u0 + w, u1 - w, v0 + w, v1 - w, soft))


def union(g, masks):
    out = masks[0]
    for m in masks[1:]:
        out = g.maximum(out, m)
    return out


def flank_uv(g, y, z, nx, yc, zc=0.0):
    """Decal coordinates on the flanks: u along +Y on the right side and
    along -Y on the left (text reads left to right from either side), v up."""
    return g.mul(g.sub(y, yc), g.math('SIGN', nx)), g.sub(z, zc)


def decal(g, atlas, name, u, v, uc, vc, height, channel=0):
    """The atlas entry `name` laid on surface coordinates (u, v), centred on
    (uc, vc) and `height` tall (its width follows the entry's aspect);
    returns its mask in `channel` ('rgb' gives the colour), zero outside."""
    x0, y0, x1, y1, aspect = atlas.rect(name)
    width = height * aspect
    su = g.math('DIVIDE', g.sub(u, uc - width / 2), width)
    sv = g.math('DIVIDE', g.sub(v, vc - height / 2), height)
    inside = g.mul(g.mul(g.math('GREATER_THAN', su, 0.0), g.math('LESS_THAN', su, 1.0)),
                   g.mul(g.math('GREATER_THAN', sv, 0.0), g.math('LESS_THAN', sv, 1.0)))
    vec = g.combine(g.madd(su, x1 - x0, x0), g.madd(sv, y1 - y0, y0), 0.0)
    tex = g.node('ShaderNodeTexImage', image=atlas.image, interpolation='Cubic', extension='CLIP')
    g.feed(tex.inputs['Vector'], vec)
    if channel == 'rgb':
        return [g.mul(c, inside) for c in g.node('ShaderNodeSeparateColor', [tex.outputs['Color']]).outputs]
    return g.mul(g.node('ShaderNodeSeparateColor', [tex.outputs['Color']]).outputs[channel], inside)


def chevrons(g, u, v, pitch=0.12, duty=0.5):
    """Hazard chevrons along u, pointing toward +u: 1 on the light stripes."""
    s = g.math('FRACT', g.mul(g.add(u, g.absolute(v)), 1.0 / pitch))
    return g.math('LESS_THAN', s, duty)


def soot_spots(g, P, spots, r0=0.1, r1=0.34, breakup=None):
    """Soot round a list of points (thruster ports): 1 at a point, fading
    out between r0 and r1, broken up by `breakup` (a 0..1 mask)."""
    out = None
    for c in spots:
        d = g.vmath('DISTANCE', P, c, out=1)
        s = g.sub(1.0, g.smooth(d, r0, r1))
        out = s if out is None else g.maximum(out, s)
    return g.mul(out, breakup) if breakup is not None else out


def panel_grid(g, P, N, size=(1.15, 0.5), line=0.0055, seed=0.0, rivets=0.5, hatches=0.12, pitch=0.055):
    """Panels in metres on the hull, projected along the dominant normal
    axis: rows of panels size[1] across, staggered, each row with its own
    panel length around size[0]. Returns masks: `lines` (the seams),
    `rivets` (rows inside the seams of some panels), `hatch` (the inner
    outline of the panels that are access hatches, with corner fasteners),
    `inner` (inside a hatch), the per-panel `tint` (near 1) and `height`."""
    x, y, z = g.sep(P)
    nx, ny, nz = (g.absolute(c) for c in g.sep(N))
    wz = g.mul(g.math('GREATER_THAN', nz, nx), g.math('GREATER_THAN', nz, ny))
    wx = g.mul(g.sub(1.0, wz), g.math('GREATER_THAN', nx, ny))
    wy = g.sub(g.sub(1.0, wz), wx)
    u = g.add(g.mul(g.add(wz, wx), y), g.mul(wy, x))
    v = g.add(g.add(g.mul(wz, x), g.mul(wx, z)), g.mul(wy, z))
    shift = g.add(g.add(g.mul(wz, 0.31), g.mul(wx, 0.17)), g.add(g.mul(wy, 0.53), seed))
    W, Hh = size
    rv = g.madd(v, 1.0 / Hh, shift)
    row = g.math('FLOOR', rv)
    fv = g.math('FRACT', rv)
    rrow = g.node('ShaderNodeTexWhiteNoise', [g.combine(row, shift, 4.7)], noise_dimensions='3D').outputs['Value']
    wr = g.mul(W, g.add(0.7, g.mul(rrow, 0.6)))
    ru = g.add(g.math('DIVIDE', u, wr), g.add(g.mul(g.math('FRACT', g.mul(row, 0.5)), 1.0), g.mul(rrow, 3.7)))
    col = g.math('FLOOR', ru)
    fu = g.math('FRACT', ru)
    cell = g.node('ShaderNodeTexWhiteNoise', [g.combine(col, row, g.add(shift, 11.3))], noise_dimensions='3D')
    r1 = cell.outputs['Value']
    _, r2, r3 = g.sep(cell.outputs['Color'])
    du = g.mul(g.minimum(fu, g.sub(1.0, fu)), wr)
    dv = g.mul(g.minimum(fv, g.sub(1.0, fv)), Hh)
    d = g.minimum(du, dv)
    lines = g.sub(1.0, g.smooth(d, line * 0.5, line * 0.5 + 0.0018))
    # rivets: dashes on a line 2.2 cm inside the seams, on some panels
    along = g.mixf(g.math('LESS_THAN', du, dv), u, v)
    dots = g.math('LESS_THAN', g.absolute(g.sub(g.math('FRACT', g.mul(along, 1.0 / pitch)), 0.5)), 0.2)
    riv = g.mul(g.mul(dots, band(g, d, 0.018, 0.026, 0.0015)), g.math('LESS_THAN', r2, rivets))
    # access hatches: an inner outline 4 cm in, with a fastener in each corner
    is_hatch = g.math('LESS_THAN', r3, hatches)
    hatch = g.mul(band(g, d, 0.038, 0.044, 0.0012), is_hatch)
    corner = g.mul(band(g, du, 0.055, 0.072, 0.002), band(g, dv, 0.055, 0.072, 0.002))
    hatch = g.maximum(hatch, g.mul(corner, is_hatch))
    inner = g.mul(g.smooth(d, 0.042, 0.046), is_hatch)
    tint = g.add(1.0, g.mul(g.sub(r1, 0.5), 0.075))
    height = g.add(g.add(g.mul(lines, -0.0016), g.mul(hatch, -0.0009)),
                   g.add(g.mul(inner, -0.0005), g.mul(riv, 0.00045)))
    return dict(lines=lines, rivets=riv, hatch=hatch, inner=inner, tint=tint, height=height, cell=r1)


def weathered_fine(g, base, rough, metal, P, N, wear=1.0, grime=1.0, lines=True, glow=None,
                   panel=(1.15, 0.5), line=0.0055, rivets=0.5, hatches=0.12, seed=0.0, Pp=None,
                   height=None, soot=None, scuff=None, streaks=1.0):
    """weathered() with finer panelling: seams, rivet rows and access
    hatches from panel_grid() (on Pp, P by default) with a per-panel tone;
    AO grime and aft streaks; chipped edges and scratches to bare metal;
    optional extra `height` (grooves), `soot` (0..1, over everything) and
    `scuff` (boot and handling wear)."""
    h = 0.0
    if lines:
        pg = panel_grid(g, Pp if Pp is not None else P, N, panel, line, seed, rivets, hatches)
        t = pg['tint']
        base = g.mix(1.0, base, g.combine(t, t, t), 'MULTIPLY')
        rough = g.add(rough, g.mul(g.sub(pg['cell'], 0.5), 0.06))
        seam = g.maximum(pg['lines'], g.mul(pg['hatch'], 0.8))
        base = g.mix(g.mul(seam, 0.6), base, (0.008, 0.008, 0.009))
        base = g.mix(g.mul(pg['rivets'], 0.3), base, (0.02, 0.02, 0.022))
        rough = g.mixf(g.mul(seam, 0.5), rough, 0.7)
        h = pg['height']
    if height is not None:
        h = g.add(h, height)
    ao = g.node('ShaderNodeAmbientOcclusion', [None, 0.45], samples=12, only_local=False).outputs['AO']
    streak = g.smooth(g.noise(g.vmath('MULTIPLY', P, (7.0, 0.35, 7.0)), 1.0, 4.0, 0.6), 0.5, 0.8)
    dirt = g.add(g.mul(g.sub(1.0, ao), 0.85), g.mul(streak, 0.25 * streaks))
    dirt = g.mul(g.minimum(dirt, 1.0), grime)
    base = g.mix(g.mul(dirt, 0.7), base, (0.035, 0.03, 0.026), 'MULTIPLY')
    rough = g.mixf(g.mul(dirt, 0.5), rough, 0.62)
    if scuff is not None:
        sc = g.mul(scuff, g.smooth(g.noise(g.vmath('MULTIPLY', P, (9.0, 3.0, 9.0)), 1.0, 4.0, 0.6), 0.45, 0.7))
        base = g.mix(g.mul(sc, 0.35), base, (0.05, 0.048, 0.045), 'MULTIPLY')
        rough = g.mixf(g.mul(sc, 0.6), rough, 0.3)
    bev = g.node('ShaderNodeBevel', [0.03], samples=8).outputs[0]
    edge = g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1))
    patches = g.smooth(g.noise(P, 2.2, 3.0, 0.5), 0.5, 0.62)
    chips = g.mul(g.mul(g.smooth(edge, 0.02, 0.08), patches), g.smooth(g.noise(P, 14.0, 4.0, 0.6), 0.4, 0.55))
    scratches = g.mul(g.smooth(g.noise(g.vmath('MULTIPLY', P, (1.0, 14.0, 1.0)), 6.0, 3.0, 0.5), 0.74, 0.8),
                      g.smooth(g.noise(P, 2.5, 2.0), 0.55, 0.7))
    worn = g.mul(g.maximum(chips, g.mul(scratches, 0.6)), wear)
    if scuff is not None:
        worn = g.maximum(worn, g.mul(g.mul(scuff, g.smooth(g.noise(P, 22.0, 3.0, 0.6), 0.62, 0.7)), 0.8))
    base = g.mix(worn, base, BARE)
    rough = g.mixf(worn, rough, 0.35)
    metal = g.mixf(worn, metal, 0.6)
    h = g.add(h, g.mul(worn, -0.0004))
    h = g.add(h, g.mul(g.noise(P, 60.0, 3.0, 0.5), 0.00015))
    if soot is not None:
        s = g.minimum(soot, 1.0)
        base = g.mix(s, base, SOOT)
        rough = g.mixf(s, rough, 0.75)
        metal = g.mixf(s, metal, 0.1)
    return dict(albedo=base, rough=rough, metal=metal, normal=g.bump(h, 1.0, 1.0), glow=glow)


def nozzle_paint_fine(name, cx, cz, exit_y, ridges=0.0, mirror=True):
    """Heat-tinted bare metal outside, soot inside. Inner faces are told
    apart by their normals facing the engine axis (|x| = cx when
    `mirror`, else x = cx; z = cz), so bells, liners and petals all work;
    the last 60 cm before the exit at exit_y is burnt blue-violet, and
    `ridges` (per metre) adds ring grooves inside."""
    def build(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        if mirror and cx:
            sgn = g.math('SIGN', x)
            rx, nxx = g.sub(g.absolute(x), cx), g.mul(nx, sgn)
        else:
            rx, nxx = g.sub(x, cx), nx
        rz = g.sub(z, cz)
        r = g.vmath('LENGTH', g.combine(rx, 0.0, rz), out=1)
        facing_ = g.math('DIVIDE', g.add(g.mul(nxx, rx), g.mul(nz, rz)), g.maximum(r, 1e-4))
        inner = g.sub(1.0, g.smooth(facing_, -0.35, -0.05))
        tint = g.ramp(g.noise(P, 2.0, 3.0), [(0.3, (0.16, 0.13, 0.1)), (0.55, (0.11, 0.11, 0.15)),
                                             (0.8, (0.2, 0.15, 0.1))])
        heat = g.smooth(y, exit_y + 0.6, exit_y + 0.05)
        tint = g.mix(g.mul(heat, 0.75), tint, (0.07, 0.055, 0.11))
        tint = g.mix(g.mul(g.mul(heat, g.smooth(g.noise(P, 6.0, 3.0), 0.5, 0.7)), 0.6), tint, (0.16, 0.1, 0.05))
        col = g.mix(inner, tint, (0.018, 0.016, 0.015))
        ch = weathered_fine(g, col, g.mixf(inner, 0.34, 0.62), g.mixf(inner, 0.7, 0.25), P, N,
                            wear=0.0, lines=False, grime=0.6, streaks=0.0)
        if ridges:
            rib = g.mul(g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(y, ridges)), 0.5)), 0.36, 0.46), inner)
            ch['normal'] = g.bump(g.mul(rib, -0.0025), 1.0, 1.0, normal=ch['normal'])
        return ch
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


F_SW, F_DIH = math.tan(math.radians(28)), math.tan(math.radians(4))
F_TIP_Z = -0.12 + F_DIH * (F_POD_X - 1.2)      # wingtip pod axis z
F_WING = [(0.95, 3.7, -0.04, 7.55, 0.034)] + [
    (x, 1.5 - F_SW * (x - 1.2), -0.12 + F_DIH * (x - 1.2), chord, th)
    for x, chord, th in ((1.75, 4.95, 0.06), (2.4, 4.15, 0.06), (3.8, 2.85, 0.052), (F_POD_X - 0.12, 1.75, 0.048))]
F_HINGE = 0.76                  # chord fraction of the flap, aileron and rudder hinges
F_FIN = [(0.0, -3.7, 0.0, 2.6, 0.07), (0.7, -4.75, 0.0, 1.75, 0.06), (1.3, -5.6, 0.0, 0.95, 0.055)]
F_FIN_M = T((F_ENG[0] * 0.92, 0, 0.5)) @ R(math.radians(-74), 4, 'Y')
F_NACELLE = [(-0.9, 0.0), (-1.0, 0.3), (-1.5, 0.5), (-2.3, 0.62), (-5.5, 0.645), (-6.2, 0.62), (-6.55, 0.6)]
F_EXIT = -7.43                  # nozzle exit plane
F_POD = [(-2.75, 0.0), (-2.68, 0.12), (-2.5, 0.2), (-2.2, 0.235), (0.5, 0.235), (0.95, 0.21),
         (1.35, 0.15), (1.6, 0.09), (1.7, 0.0)]
F_MUZZLE_Y = 3.335
F_MX = 3.05                     # under-wing missile station x
F_MY = 1.5 - F_SW * (F_MX - 1.2) - 1.0
F_WING_LOW = -0.12 + F_DIH * (F_MX - 1.2) - 0.08
F_MZ = F_WING_LOW - 0.33
F_MISSILE_Y0 = F_MY - 0.4       # the missile profile's origin along y
# Cheek intakes under the wing roots (right side): the cowl's rows from aft
# to the lip's apex, then the duct's from the lip in to the fan face.
# (y, centre x, centre z, half-width, half-height, superellipse exponent)
F_INTAKE_OUT = [(-1.4, 1.28, -0.1, 0.38, 0.38, 2.2), (-0.7, 1.42, -0.2, 0.29, 0.27, 2.8),
                (0.1, 1.53, -0.29, 0.235, 0.215, 3.6), (0.8, 1.57, -0.31, 0.225, 0.21, 4.0),
                (1.3, 1.58, -0.31, 0.225, 0.21, 4.0), (1.47, 1.58, -0.31, 0.222, 0.207, 4.0),
                (1.51, 1.58, -0.31, 0.207, 0.192, 4.0)]
F_INTAKE_IN = [(1.47, 1.58, -0.31, 0.192, 0.177, 4.0), (1.25, 1.58, -0.31, 0.188, 0.172, 3.6),
               (0.95, 1.575, -0.305, 0.175, 0.168, 2.8), (0.7, 1.57, -0.3, 0.165, 0.165, 2.0)]
F_FAN = (1.57, -0.3)            # intake fan axis x, z
WARN_RED = lin('#a8261c')
INK = (0.012, 0.012, 0.013)
GLOW_STRIP = (0.22, 0.62, 0.36)
# RCS ports (from js/anchors.js, Blender space, x folded to the right): the
# paint puts soot round them.
F_SOOT_BODY = [(0.0, 5.02, 0.54), (0.0, 5.0, -0.46), (0.98, 5.0, -0.02), (0.0, -5.76, 0.68), (0.0, -5.75, -0.51),
               (0.39, 5.96, 0.21), (0.26, -6.9, 0.22)]
F_SOOT_NACELLE = [(1.92, -5.2, -0.01)]
F_SOOT_POD = [(F_POD_X, -1.9, 0.49), (F_POD_X, -1.9, -0.14)]


def fighter_atlas():
    """The Kestrel's markings: the Lantern wing's number and badge, the
    Watch roundel, warning triangles, the rescue arrow and stencil text."""
    def badge(cv, s):                 # graphite disc, orange lantern, off-white ring and flame
        r, g_, b = cv
        disc(r, s, 128, 128, 126)
        disc(b, s, 128, 128, 107, 116)
        poly(g_, s, [(90, 70), (166, 70), (166, 166), (90, 166)])
        poly(g_, s, [(78, 54), (178, 54), (178, 72), (78, 72)])
        poly(g_, s, [(80, 164), (176, 164), (150, 192), (106, 192)])
        disc(g_, s, 128, 202, 11, 19)
        poly(b, s, [(128, 154), (147, 122), (145, 97), (128, 84), (111, 97), (109, 122)])

    def roundel(cv, s):               # the Belt Watch roundel
        r, g_, b = cv
        disc(r, s, 128, 128, 126)
        disc(g_, s, 128, 128, 29, 101)
        disc(b, s, 128, 128, 46, 84)

    def triangle(cv, s):              # warning triangle: border, field, exclamation mark
        r, g_, b = cv
        poly(r, s, [(4, 4), (156, 4), (80, 136)])
        poly(g_, s, [(23, 15), (137, 15), (80, 114)])
        poly(b, s, [(73, 50), (87, 50), (84, 95), (76, 95)])
        disc(b, s, 80, 34, 7.5)

    def arrow(cv, s):                 # rescue arrow, pointing up
        poly(cv[0], s, [(30, 4), (66, 4), (66, 102), (30, 102)])
        poly(cv[0], s, [(2, 96), (94, 96), (48, 156)])

    A = DecalAtlas('f_decals', 2048, 2048)
    A.text('num', '01', px=200, bold=0.03)
    A.shape('badge', 256, 256, badge)
    A.shape('roundel', 256, 256, roundel)
    A.shape('triangle', 160, 140, triangle)
    A.shape('arrow', 96, 160, arrow)
    for name, text, px, bold in (
            ('watch', 'BELT WATCH', 64, 0.025), ('lantern', 'LANTERN WING', 40, 0.02),
            ('nostep', 'NO STEP', 44, 0.02), ('danger', 'DANGER', 44, 0.02),
            ('intake', 'KEEP CLEAR OF INTAKE', 26, 0.012), ('rescue', 'RESCUE', 44, 0.02),
            ('rescue2', 'PULL HANDLE\nTO JETTISON CANOPY', 22, 0.01), ('eject', 'EJECTION SEAT', 30, 0.015),
            ('serial', 'KF-2   01147', 30, 0.012),
            ('data', 'KESTREL F.2\nSER. 01147\nMASS 30 T\nRCS HYDRAZINE', 20, 0.008),
            ('hot', 'HOT', 40, 0.02), ('gun', 'GUN BAY', 30, 0.015), ('ammo', 'AMMO 20 MM', 24, 0.01),
            ('fuel', 'FUEL', 30, 0.015), ('pwr', 'EXT PWR', 26, 0.012), ('jack', 'JACK', 26, 0.012),
            ('rcs', 'RCS', 26, 0.012), ('hyd', 'HYD', 26, 0.012), ('avn', 'AVIONICS', 24, 0.01),
            ('caution', 'CAUTION', 30, 0.015), ('live', 'LIVE', 30, 0.015), ('walk', 'WALKWAY', 30, 0.015),
            ('arm', 'ARM  SAFE', 26, 0.012)):
        A.text(name, text, px=px, bold=bold)
    return A.build()


def fighter_materials(A):
    """The Kestrel's paint. A is the decal atlas (fighter_atlas())."""
    def stencils(g, items):
        """Union of decal masks: (name, u, v, uc, vc, height, mask)."""
        out = None
        for name, u, v, uc, vc, h, m in items:
            d = decal(g, A, name, u, v, uc, vc, h)
            d = g.mul(d, m) if m is not None else d
            out = d if out is None else g.maximum(out, d)
        return out

    def breakup(g, P, scale=4.0, lo=0.3, hi=0.75):
        return g.smooth(g.noise(P, scale, 4.0, 0.6), lo, hi)

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        Pm = g.combine(ax, y, z)
        top = g.smooth(nz, 0.45, 0.62)
        under = g.smooth(nz, -0.18, -0.42)
        side = g.smooth(g.absolute(nx), 0.5, 0.62)
        flank = g.smooth(g.absolute(nx), 0.3, 0.45)
        nose_cap = g.smooth(y, 6.28, 6.32)
        glare = g.mul(g.mul(band(g, y, 4.5, 6.3, 0.015), g.smooth(nz, 0.3, 0.4)), g.sub(1.0, g.smooth(ax, 0.36, 0.38)))
        spine = g.mul(g.mul(band(g, y, -4.6, 1.3, 0.015), g.sub(1.0, g.smooth(ax, 0.17, 0.19))), g.smooth(nz, 0.5, 0.6))
        dark = union(g, [under, nose_cap, glare, spine])
        col = g.mix(dark, OFF_WHITE, GRAPHITE)
        stripe = g.mul(g.mul(band(g, z, 0.2, 0.34, 0.008), band(g, y, -2.6, 5.3, 0.01)), side)
        pin = g.mul(g.mul(band(g, z, 0.1, 0.135, 0.005), band(g, y, -1.8, 4.7, 0.01)), side)
        col = g.mix(stripe, col, ORANGE)
        col = g.mix(pin, col, GRAPHITE)
        col = g.mix(g.mul(band(g, y, 6.12, 6.2, 0.004), g.sub(1.0, under)), col, ORANGE)
        # side number under the windscreen; the ejection-seat warning and the
        # rescue arrow below the canopy rail; the service name aft of it
        u, v = flank_uv(g, y, z, nx, 3.95)
        col = g.mix(g.mul(decal(g, A, 'num', u, v, 0.0, 0.0, 0.17), flank), col, GRAPHITE)
        u, v = flank_uv(g, y, z, nx, 3.3)
        tr, tg, tb = decal(g, A, 'triangle', u, v, 0.0, 0.43, 0.12, 'rgb')
        col = g.mix(g.mul(tr, flank), col, GRAPHITE)
        col = g.mix(g.mul(tg, flank), col, WARN_RED)
        col = g.mix(g.mul(tb, flank), col, GRAPHITE)
        ub, vb = flank_uv(g, y, z, nx, 2.35)
        col = g.mix(g.mul(decal(g, A, 'arrow', ub, vb, 0.0, 0.44, 0.17), flank), col, ORANGE)
        u2, v2 = flank_uv(g, y, z, nx, 0.6)
        u3, v3 = flank_uv(g, y, z, nx, 4.75)
        text = stencils(g, [('eject', u, v, 0.31, 0.43, 0.042, flank), ('rescue', ub, vb, 0.22, 0.475, 0.05, flank),
                            ('rescue2', ub, vb, 0.24, 0.395, 0.05, flank), ('watch', u2, v2, 0.0, 0.43, 0.075, flank),
                            ('avn', u3, v3, 0.0, 0.0, 0.03, flank)])
        col = g.mix(g.mul(text, 0.92), col, GRAPHITE)
        # data block on the left side, under the canopy rail
        left = g.smooth(g.mul(nx, -1.0), 0.3, 0.45)
        ud, vd = flank_uv(g, y, z, nx, 4.35)
        col = g.mix(g.mul(decal(g, A, 'data', ud, vd, 0.0, 0.43, 0.1), left), col, GRAPHITE)
        # belly: nose gear doors, the two weapon bays, stencils
        bu, bv = g.add(g.mul(x, -1.0), g.mul(g.math('SIGN', x), 0.75)), y
        doors = union(g, [outline_mask(g, x, y, -0.21, 0.21, 2.95, 3.85, 0.009),
                          rect_mask(g, x, y, -0.005, 0.005, 2.95, 3.85, 0.002),
                          outline_mask(g, ax, y, 0.07, 0.55, -0.35, 2.55, 0.009),
                          rect_mask(g, ax, y, 0.306, 0.314, -0.35, 2.55, 0.002)])
        doors = g.mul(doors, under)
        hinge = g.mul(g.mul(band(g, ax, 0.5, 0.53, 0.002), band(g, y, -0.3, 2.5, 0.01)), under)
        col = g.mix(doors, col, (0.004, 0.004, 0.005))
        col = g.mix(g.mul(hinge, 0.6), col, (0.075, 0.078, 0.082))
        belly_txt = stencils(g, [('fuel', bu, bv, 0.0, 1.0, 0.045, under), ('jack', bu, bv, 0.0, -1.6, 0.035, under),
                                 ('pwr', bu, bv, 0.0, 4.5, 0.035, under), ('caution', bu, bv, 0.0, 2.75, 0.04, under)])
        col = g.mix(g.mul(belly_txt, 0.85), col, (0.55, 0.55, 0.52))
        # formation light strips on the nose
        strip = g.mul(rect_mask(g, y, z, 5.2, 5.75, -0.135, -0.09, 0.003), flank)
        col = g.mix(strip, col, (0.55, 0.62, 0.56))
        glow = g.mix(strip, (0, 0, 0), GLOW_STRIP)
        # grooves: the radome seam and the door outlines
        grooves = g.maximum(band(g, y, 6.29, 6.31, 0.002), doors)
        height = g.mul(grooves, -0.0016)
        soot = g.maximum(soot_spots(g, Pm, F_SOOT_BODY, 0.09, 0.3, breakup(g, P, 6.0, 0.25, 0.7)),
                         g.mul(g.smooth(y, -6.1, -6.75), breakup(g, P, 3.0, 0.3, 0.8)))
        scuff = g.mul(g.mul(band(g, y, 1.2, 4.4, 0.2), band(g, ax, 0.42, 0.98, 0.08)), top)
        rough = g.mixf(dark, 0.42, 0.55)
        metal = g.mixf(dark, 0.2, 0.3)
        return weathered_fine(g, col, rough, metal, P, N, panel=(1.15, 0.5), rivets=0.45, hatches=0.14,
                              height=height, soot=g.mul(soot, 0.85), scuff=scuff, glow=glow)

    def wing_paint(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.15, -0.4)
        topside = g.sub(1.0, under)
        le_y = g.sub(1.5, g.mul(g.sub(ax, 1.2), F_SW))
        behind = g.sub(le_y, y)
        leading = g.sub(1.0, g.smooth(behind, 0.3, 0.34))
        sweep = g.add(ax, g.mul(y, 0.3))
        chevron = g.maximum(band(g, sweep, 3.5, 3.82, 0.008), band(g, sweep, 3.93, 4.0, 0.005))
        col = g.mix(g.maximum(under, leading), OFF_WHITE, GRAPHITE)
        col = g.mix(g.mul(chevron, topside), col, ORANGE)
        # the Watch roundel near each tip, NO STEP ahead of the flap, a walkway at the root
        sgn = g.math('SIGN', x)
        u = g.sub(x, g.mul(sgn, 4.5))
        rr, rg, rb = decal(g, A, 'roundel', u, y, 0.0, -1.0, 0.6, 'rgb')
        col = g.mix(g.mul(rr, topside), col, GRAPHITE)
        col = g.mix(g.mul(rg, topside), col, ORANGE)
        col = g.mix(g.mul(rb, topside), col, OFF_WHITE)
        u2 = g.sub(x, g.mul(sgn, 2.78))
        u3 = g.sub(x, g.mul(sgn, 2.2))
        walk = g.mul(outline_mask(g, ax, y, 1.95, 2.45, -1.45, 0.45, 0.025), topside)
        text = stencils(g, [('nostep', u2, y, 0.0, -1.95, 0.075, topside), ('walk', u3, y, 0.0, 0.62, 0.05, topside),
                            ('nostep', u2, y, 0.0, 0.05, 0.06, topside)])
        col = g.mix(g.maximum(walk, text), col, GRAPHITE)
        # under the wing: a stencil by the pylon
        bu = g.add(g.mul(x, -1.0), g.mul(sgn, 3.05))
        utext = stencils(g, [('live', bu, y, 0.0, 0.45, 0.04, under), ('arm', bu, y, 0.0, -2.35, 0.032, under)])
        col = g.mix(g.mul(utext, 0.85), col, (0.55, 0.55, 0.52))
        # leading-edge erosion and boots on the walkway
        scuff = g.maximum(g.mul(g.sub(1.0, g.smooth(behind, 0.03, 0.12)), 0.7),
                          g.mul(rect_mask(g, ax, y, 1.95, 2.45, -1.45, 0.45, 0.05), topside))
        # panels follow the sweep: long side spanwise
        ca, sa = math.cos(math.radians(28)), math.sin(math.radians(28))
        Pp = g.combine(g.add(g.mul(ax, sa), g.mul(y, ca)), g.sub(g.mul(ax, ca), g.mul(y, sa)), z)
        return weathered_fine(g, col, g.mixf(under, 0.42, 0.55), g.mixf(under, 0.2, 0.3), P, N, Pp=Pp,
                              panel=(1.0, 0.42), rivets=0.6, hatches=0.1, scuff=scuff)

    def engine(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        Pm = g.combine(ax, y, z)
        under = g.smooth(nz, -0.1, -0.35)
        flank = g.smooth(g.absolute(nx), 0.4, 0.55)
        heat = g.smooth(y, -5.4, -6.3)
        col = g.mix(under, OFF_WHITE, GRAPHITE)
        col = g.mix(band(g, y, -5.42, -5.3, 0.006), col, GRAPHITE)
        col = g.mix(heat, col, (0.085, 0.07, 0.065))
        col = g.mix(g.mul(heat, g.smooth(g.noise(P, 3.0, 3.0), 0.4, 0.7)), col, (0.05, 0.06, 0.1))
        # HOT on a hazard plate ahead of the heat sinks; the main gear doors
        u, v = flank_uv(g, y, z, nx, -4.85)
        plate = g.mul(rect_mask(g, u, v, -0.13, 0.13, 0.205, 0.285, 0.003), flank)
        col = g.mix(plate, col, HAZARD)
        text = stencils(g, [('hot', u, v, 0.0, 0.245, 0.05, flank), ('rcs', u, v, -0.38, 0.15, 0.03, flank),
                            ('hyd', u, v, 1.05, 0.34, 0.03, flank)])
        col = g.mix(text, col, INK)
        doors = g.mul(union(g, [outline_mask(g, ax, y, 0.98, 1.42, -3.55, -1.95, 0.009),
                                rect_mask(g, ax, y, 1.196, 1.204, -3.55, -1.95, 0.002)]), under)
        col = g.mix(g.mul(doors, 0.8), col, INK)
        strip = g.mul(rect_mask(g, y, z, -3.05, -2.45, 0.27, 0.315, 0.003), flank)
        col = g.mix(strip, col, (0.55, 0.62, 0.56))
        glow = g.mix(strip, (0, 0, 0), GLOW_STRIP)
        soot = g.maximum(soot_spots(g, Pm, F_SOOT_NACELLE, 0.09, 0.3, breakup(g, P, 6.0, 0.25, 0.7)),
                         g.mul(g.smooth(y, -5.9, -6.5), breakup(g, P, 3.0, 0.25, 0.8)))
        rough = g.mixf(heat, g.mixf(under, 0.42, 0.55), 0.42)
        metal = g.mixf(heat, g.mixf(under, 0.2, 0.3), 0.6)
        return weathered_fine(g, col, rough, metal, P, N, wear=0.8, panel=(0.9, 0.42), rivets=0.6, hatches=0.15,
                              height=g.mul(doors, -0.0016), soot=g.mul(soot, 0.8), glow=glow)

    def intake_paint(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.2, -0.45)
        flank = g.smooth(g.absolute(nx), 0.5, 0.65)
        col = g.mix(under, OFF_WHITE, GRAPHITE)
        lip = g.smooth(y, 1.44, 1.47)
        col = g.mix(lip, col, GRAPHITE)
        haz = g.mul(band(g, y, 1.1, 1.38, 0.005), g.sub(1.0, lip))
        col = g.mix(haz, col, g.mix(chevrons(g, y, g.add(z, 0.31), 0.11), INK, HAZARD))
        u, v = flank_uv(g, y, z, nx, 0.6)
        plate = g.mul(rect_mask(g, u, v, -0.3, 0.3, -0.29, -0.19, 0.003), flank)
        col = g.mix(plate, col, HAZARD)
        text = stencils(g, [('danger', u, v, 0.0, -0.24, 0.056, flank), ('intake', u, v, 0.0, -0.33, 0.034, flank)])
        col = g.mix(text, col, INK)
        rough = g.mixf(lip, g.mixf(under, 0.42, 0.55), 0.35)
        metal = g.mixf(lip, 0.2, 0.55)
        return weathered_fine(g, col, rough, metal, P, N, wear=1.3, panel=(0.7, 0.36), rivets=0.7, hatches=0.0)

    def duct(g, P, N):
        x, y, z = g.sep(P)
        deep = g.smooth(y, 1.25, 0.75)
        col = g.mix(deep, (0.42, 0.42, 0.4), (0.12, 0.122, 0.125))
        seam = g.mul(band(g, g.math('FRACT', g.mul(y, 4.0)), 0.47, 0.53, 0.01), 0.7)
        col = g.mix(seam, col, (0.05, 0.05, 0.052))
        return weathered_fine(g, col, 0.55, 0.15, P, N, wear=0.2, lines=False, grime=0.9, streaks=0.0,
                              height=g.mul(seam, -0.0015))

    def pod(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        Pm = g.combine(ax, y, z)
        under = g.smooth(nz, -0.1, -0.4)
        outboard = g.smooth(g.mul(nx, g.math('SIGN', x)), 0.35, 0.5)
        col = g.mix(under, OFF_WHITE, GRAPHITE)
        col = g.mix(band(g, y, 0.4, 0.62, 0.01), col, ORANGE)
        col = g.mix(g.smooth(y, 0.95, 1.0), col, GRAPHITE)
        col = g.mix(g.smooth(y, -2.45, -2.5), col, GRAPHITE)
        # ammunition hatch and stencils on the outboard side
        u, v = flank_uv(g, y, z, nx, -0.75, F_TIP_Z)
        hatch = g.mul(outline_mask(g, u, v, -0.55, 0.55, -0.02, 0.17, 0.008), outboard)
        col = g.mix(g.mul(hatch, 0.85), col, INK)
        text = stencils(g, [('ammo', u, v, 0.0, 0.075, 0.035, outboard), ('gun', u, v, 0.95, 0.06, 0.04, outboard)])
        col = g.mix(text, col, GRAPHITE)
        soot = g.maximum(soot_spots(g, Pm, F_SOOT_POD, 0.08, 0.26, breakup(g, P, 6.0, 0.25, 0.7)),
                         g.mul(g.smooth(y, 0.9, 1.55), breakup(g, P, 5.0, 0.2, 0.7)))
        return weathered_fine(g, col, g.mixf(under, 0.45, 0.55), 0.25, P, N, panel=(0.8, 0.3), rivets=0.7,
                              hatches=0.1, height=g.mul(hatch, -0.0016), soot=g.mul(soot, 0.85))

    def metal(g, P, N):
        return weathered_fine(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, lines=False, wear=0.6)

    def frame(g, P, N):
        return weathered_fine(g, GRAPHITE, 0.5, 0.3, P, N, lines=False, wear=0.9)

    def fin(g, P, N):
        x, y, z = g.sep(P)
        nx = g.sep(N)[0]
        col = g.mix(g.smooth(z, 1.3, 1.33), OFF_WHITE, ORANGE)
        col = g.mix(g.smooth(z, 1.48, 1.51), col, GRAPHITE)
        u, v = flank_uv(g, y, z, nx, -5.2)
        col = g.mix(decal(g, A, 'num', u, v, 0.0, 0.94, 0.27), col, GRAPHITE)
        br, bg, bb = decal(g, A, 'badge', u, v, 0.42, 0.95, 0.2, 'rgb')
        col = g.mix(br, col, GRAPHITE)
        col = g.mix(bg, col, ORANGE)
        col = g.mix(bb, col, OFF_WHITE)
        text = stencils(g, [('serial', u, v, 0.0, 0.755, 0.036, None), ('lantern', u, v, 0.0, 1.13, 0.045, None)])
        col = g.mix(text, col, GRAPHITE)
        strobe = rect_mask(g, y, z, -5.95, -5.7, 1.62, 1.68, 0.004)
        glow = g.mix(strobe, (0, 0, 0), (0.9, 0.9, 0.85))
        soot = g.mul(g.mul(g.smooth(y, -5.8, -6.4), g.smooth(z, 1.05, 0.7)), breakup(g, P, 3.0, 0.25, 0.8))
        return weathered_fine(g, col, 0.42, 0.2, P, N, panel=(0.8, 0.4), rivets=0.6, hatches=0.08,
                              soot=g.mul(soot, 0.7), glow=glow)

    def missile(g, P, N):
        x, y, z = g.sep(P)
        a = g.sub(y, F_MISSILE_Y0)
        col = g.mix(band(g, a, 0.96, 1.07, 0.004), (0.5, 0.5, 0.47), ORANGE)
        col = g.mix(band(g, a, 0.7, 0.76, 0.003), col, HAZARD)
        col = g.mix(band(g, a, -0.82, -0.76, 0.003), col, (0.22, 0.13, 0.06))
        col = g.mix(g.smooth(a, -1.12, -1.16), col, GRAPHITE)
        return weathered_fine(g, col, 0.45, 0.2, P, N, lines=False, wear=0.4)

    def heat(g, P, N):
        x, y, z = g.sep(P)
        t = g.smooth(y, -5.4, -6.2)
        col = g.mix(t, (0.06, 0.058, 0.056), (0.075, 0.058, 0.07))
        col = g.mix(g.mul(t, g.smooth(g.noise(P, 4.0, 3.0), 0.45, 0.7)), col, (0.1, 0.075, 0.05))
        return weathered_fine(g, col, 0.38, 0.75, P, N, lines=False, wear=0.4, grime=0.8)

    def bell(g, P, N):
        return weathered_fine(g, (0.3, 0.29, 0.28), 0.36, 0.8, P, N, lines=False, wear=0.0, grime=1.2)

    def sensor(g, P, N):
        return dict(albedo=(0.008, 0.01, 0.014), rough=0.06, metal=0.0, glow=(0.004, 0.006, 0.004))

    return dict(
        body=material('f_body', body), wing=material('f_wing', wing_paint), engine=material('f_engine', engine),
        intake=material('f_intake', intake_paint), duct=material('f_duct', duct),
        nozzle=nozzle_paint_fine('f_nozzle', F_ENG[0], F_ENG[1], F_EXIT, ridges=9.0),
        pod=material('f_pod', pod), metal=material('f_metal', metal), frame=material('f_frame', frame),
        fin=material('f_fin', fin), missile=material('f_missile', missile), heat=material('f_heat', heat),
        bell=material('f_bell', bell), sensor=material('f_sensor', sensor),
        glow=glow_material('f_glow', (0.55, 0.68, 1.0), (0.3, 0.35, 0.45)),
        red=glow_material('f_nav_red', (1.0, 0.05, 0.03), (0.3, 0.02, 0.02)),
        green=glow_material('f_nav_green', (0.05, 1.0, 0.25), (0.02, 0.3, 0.06)),
        white=glow_material('f_nav_white', (1.0, 0.95, 0.85), (0.4, 0.4, 0.4)),
        beacon=glow_material('f_beacon', (0.9, 0.04, 0.02), (0.25, 0.02, 0.02)),
        hole=material('f_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def canopy_point(y, angle, grow=1.0):
    cy, cz = F_CANOPY
    u = (y - cy) / 1.75
    t = max(0.0, u)
    rad = math.sqrt(max(1e-6, 1 - u * u))
    return Vector((math.cos(angle) * rad * 0.6 * (1.0 - 0.38 * t * t) * grow, y,
                   cz + math.sin(angle) * rad * 0.52 * (1.0 - 0.15 * t * t) * grow))


def canopy_normal(y, angle):
    """Outward normal of the canopy bubble at canopy_point(y, angle)."""
    cy, cz = F_CANOPY
    u = (y - cy) / 1.75
    t = max(0.0, u)
    rx, rz = 0.6 * (1.0 - 0.38 * t * t), 0.52 * (1.0 - 0.15 * t * t)
    p = canopy_point(y, angle)
    return Vector((p.x / rx ** 2, u / 1.75, (p.z - cz) / rz ** 2)).normalized()


def rail(name, path, ups, width, height, mat):
    """bar() with an explicit `up` direction at every point of the path."""
    it = iter(ups)
    return bar(name, path, width, height, mat, lambda p: next(it))


def fighter_canopy(bvh, M):
    """The glass bubble (cut low, so it meets the fuselage everywhere), a
    frame rail round the line where it meets the fuselage, three bows and
    a spine bar."""
    cy, cz = F_CANOPY
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=18, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        t = max(0.0, y)
        v.co = Vector((x * 0.6 * (1.0 - 0.38 * t * t), cy + y * 1.75, cz + z * 0.52 * (1.0 - 0.15 * t * t)))
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0.44),
                           plane_no=(0, 0, 1), clear_inner=True)
    glass = canonical(finish_bm('glass', bm, None))
    glass.data.materials.append(C.flat_material('glass', (0.006, 0.008, 0.011), 0.04, 0.0,
                                                emission=(0.003, 0.009, 0.011), strength=1.0))

    def surface(x, y):
        loc, nrm, _, _ = bvh.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)))
        return (loc.z, nrm) if loc is not None else (-9.0, Vector((0, 0, 1)))

    def gap(y, a):
        p = canopy_point(y, a)
        return p.z - surface(p.x, y)[0]

    def meet(y):
        lo, hi = -math.pi / 2, math.pi / 2
        for _ in range(36):
            mid = (lo + hi) / 2
            if gap(y, mid) > 0:
                hi = mid
            else:
                lo = mid
        return hi

    def edge(inside, outside, test):
        for _ in range(40):
            mid = (inside + outside) / 2
            if test(mid):
                inside = mid
            else:
                outside = mid
        return inside

    exists = lambda y: gap(y, math.pi / 2) > 0 and gap(y, -math.pi / 2) < 0
    y_front = edge(cy, cy + 1.749, exists)
    y_rear = edge(cy, cy - 1.749, exists)
    parts = []
    ys = [y_front + (y_rear - y_front) * (1 - math.cos(math.pi * k / 46)) / 2 for k in range(47)]
    right = []
    for y in ys:
        a = meet(y)
        p = canopy_point(y, a)
        right.append((p, (canopy_normal(y, a) + surface(p.x, y)[1]).normalized()))
    left = [(Vector((-p.x, p.y, p.z)), Vector((-n.x, n.y, n.z))) for p, n in reversed(right)]
    loop = right + left[1:]
    parts.append(rail('canopy_rail', [p for p, _ in loop], [n for _, n in loop], 0.085, 0.045, M['frame']))
    for i, (y, w) in enumerate(((4.02, 0.085), (2.85, 0.06), (1.85, 0.075))):
        a = meet(y)
        angles = np.linspace(a, math.pi - a, 19)
        parts.append(rail(f'canopy_bow{i}', [canopy_point(y, b, 1.02) for b in angles],
                          [canopy_normal(y, b) for b in angles], w, 0.042, M['frame']))
    ys = np.linspace(y_front - 0.12, y_rear + 0.08, 18)
    parts.append(rail('canopy_spine', [canopy_point(y, math.pi / 2, 1.02) for y in ys],
                      [canopy_normal(y, math.pi / 2) for y in ys], 0.05, 0.035, M['frame']))
    # hinge fairings behind the bubble
    for s in (-1, 1):
        _, m = frame_on(bvh, (s * 0.22, y_rear - 0.12, 3), (0, 0, -1))
        parts.append(box(f'canopy_hinge{s}', (0.09, 0.26, 0.07), M['frame'], m, taper=0.7))
    return glass, parts


def build_fighter():
    atlas = fighter_atlas()
    M = fighter_materials(atlas)
    parts = []
    body = loft('body', FIGHTER_BODY, M['body'], around=48, along=44,
                front_tip=(0, 7.08, -0.13), back_tip=(0, -6.92, 0.04))
    body['solid'] = True
    parts.append(body)
    body_bvh = bvh_of([body])
    glass, frame_parts = fighter_canopy(body_bvh, M)
    parts += frame_parts

    side = []
    # Wings (swept 28 degrees, 4 degrees of dihedral) with a flap and an
    # aileron, drooped and trimmed a little; gun pods at the tips.
    side += surfaced_wing('wing', F_WING, M['wing'], [('flap', 1.98, 3.42, 4.0), ('aileron', 3.58, 5.02, -2.0)],
                          hinge=F_HINGE, chord_pts=13)
    pod = lathe('pod', F_POD, 18, (F_POD_X, F_TIP_Z), M['pod'], sharp=40)
    pod['solid'] = True
    side.append(pod)
    pc = (F_POD_X, F_TIP_Z)
    for k, yy in enumerate((-1.6, 0.18)):
        side.append(lathe(f'gpod_band{k}', [(yy + 0.025, 0.0), (yy + 0.025, 0.243), (yy - 0.025, 0.243),
                                            (yy - 0.025, 0.0)], 18, pc, M['metal'], smooth=False))
    # the gun: a gimbal collar, the breech, a slotted cooling shroud, a muzzle brake
    side.append(lathe('gun_collar', [(1.36, 0.0), (1.36, 0.118), (1.44, 0.132), (1.54, 0.128), (1.6, 0.105),
                                     (1.62, 0.0)], 16, pc, M['metal'], sharp=50))
    side.append(lathe('barrel', [(1.5, 0.0), (1.5, 0.074), (1.95, 0.074), (1.97, 0.05), (3.26, 0.05), (3.26, 0.0)],
                      12, pc, M['metal'], sharp=40))
    for k, (y0, y1, r) in enumerate(((1.97, 2.03, 0.094), (2.72, 2.78, 0.094), (3.02, 3.08, 0.097),
                                     (3.15, 3.21, 0.097), (3.27, F_MUZZLE_Y, 0.09))):
        side.append(lathe(f'gun_ring{k}', [(y0, 0.047), (y0, r), (y1, r), (y1, 0.047)], 12, pc, M['metal'],
                          closed=True, smooth=False))
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        m = T((pc[0] + 0.082 * math.cos(a), 2.375, pc[1] + 0.082 * math.sin(a))) @ R(-a, 4, 'Y')
        side.append(box(f'gun_slat{k}', (0.016, 0.7, 0.036), M['metal'], m))
    side.append(lathe('bore', [(3.2, 0.0), (3.2, 0.044), (F_MUZZLE_Y + 0.002, 0.044), (F_MUZZLE_Y + 0.002, 0.0)], 10, pc,
                      M['hole'], smooth=False))
    side.append(lathe('navlight', [(-2.83, 0.0), (-2.76, 0.065), (-2.64, 0.065), (-2.62, 0.0)], 8, pc, M['green']))

    # Missile on a pylon under each wing: a swept pylon, a launch rail with
    # sway braces, the missile with its seeker, canards, fins and motor.
    my, mz, wl = F_MY, F_MZ, F_WING_LOW
    side.append(prism('pylon', [(0.02, 0.62), (0.14, 0.5), (0.235, 0.22), (0.235, -0.9), (0.1, -1.15), (0.02, -1.2)],
                      0.075, M['metal'], T((F_MX, my - 0.5, wl + 0.08)) @ R(math.radians(90), 4, 'Y')))
    side.append(box('rail', (0.05, 1.5, 0.04), M['metal'], T((F_MX, my - 0.65, wl - 0.175))))
    side.append(box('rail_lip', (0.09, 1.45, 0.014), M['metal'], T((F_MX, my - 0.65, wl - 0.202))))
    for k, (dy, s) in enumerate(((0.45, 1), (0.45, -1), (-0.6, 1), (-0.6, -1))):
        m = T((F_MX + s * 0.06, my - 0.65 + dy, mz + 0.13)) @ R(math.radians(s * 35), 4, 'Y')
        side.append(box(f'sway{k}', (0.024, 0.05, 0.08), M['metal'], m))
    y0 = F_MISSILE_Y0
    side.append(lathe('missile', [(y0 + a, r) for a, r in ((-1.25, 0.0), (-1.25, 0.06), (-1.21, 0.088), (-1.12, 0.11),
                                                          (0.85, 0.11), (1.05, 0.096), (1.2, 0.072), (1.2, 0.0))],
                      14, (F_MX, mz), M['missile']))
    side.append(lathe('seeker', [(y0 + a, r) for a, r in ((1.19, 0.0), (1.19, 0.072), (1.28, 0.062), (1.35, 0.038),
                                                         (1.39, 0.0))], 14, (F_MX, mz), M['sensor']))
    side.append(lathe('motor', [(y0 + a, r) for a, r in ((-1.24, 0.0), (-1.24, 0.058), (-1.32, 0.064),
                                                        (-1.32, 0.045), (-1.27, 0.04), (-1.27, 0.0))],
                      12, (F_MX, mz), M['hole'], smooth=False))
    for k in range(4):
        rot = R(math.radians(45 + 90 * k), 4, 'Y')
        side.append(box(f'mfin{k}', (0.014, 0.3, 0.15), M['metal'], T((F_MX, my - 1.47, mz)) @ rot @ T((0, 0, 0.17)),
                        taper=0.6))
        side.append(box(f'mcanard{k}', (0.01, 0.12, 0.07), M['metal'], T((F_MX, y0 + 0.95, mz)) @ rot @ T((0, 0, 0.13)),
                        taper=0.5))

    # Cheek intake under the wing root: cowl and duct, a splitter plate
    # standing off the fuselage on two struts, a fan behind a spinner.
    side.append(intake('intake', F_INTAKE_OUT, F_INTAKE_IN, [M['intake'], M['duct']]))
    side.append(prism('splitter', [(1.82, -0.13), (1.1, -0.13), (1.1, -0.5), (1.7, -0.5)], 0.016, M['intake'],
                      T((1.318, 0, 0)) @ YZX))
    for k, zz in enumerate((-0.2, -0.42)):
        hit = body_bvh.ray_cast(Vector((1.318, 1.35, zz)), Vector((-1, 0, 0)))[0]
        xs = hit.x - 0.02 if hit is not None else 1.2
        side.append(box(f'splitter_strut{k}', (1.318 - xs, 0.12, 0.024), M['metal'], T(((1.318 + xs) / 2, 1.35, zz))))
    side.append(lathe('fan_spinner', [(0.69, 0.0), (0.69, 0.062), (0.75, 0.058), (0.83, 0.032), (0.87, 0.0)], 12,
                      F_FAN, M['metal'], sharp=60))
    side.append(blade_ring('fan', 13, 0.735, 0.05, 0.162, 0.07, 0.01, 40, F_FAN, M['metal']))

    # Engines: the nacelle, heat-sink fins, the cooling ring, a liner bell with
    # cooling steps under a ring of petals with actuators, and inside, the
    # turbine: vanes round an exhaust cone in front of the glowing throat.
    nacelle = lathe('nacelle', F_NACELLE, 28, F_ENG, M['engine'])
    nacelle['solid'] = True
    side.append(nacelle)
    nac_r = lambda y: interp_rows([(-y0, r) for y0, r in F_NACELLE], -y)[1]
    side.append(fin_arcs('heatsink', F_ENG, nac_r, (-5.47, -5.63, -5.79, -5.95, -6.11), -112, 84, 0.06, 0.04,
                         M['heat'], segs=12))
    side.append(lathe('ring', [(-6.28, 0.0), (-6.28, 0.665), (-6.4, 0.665), (-6.4, 0.0)], 28, F_ENG, M['metal'],
                      smooth=False))
    liner = [(-6.4, 0.586), (-6.62, 0.585), (-7.36, 0.568), (F_EXIT, 0.566), (F_EXIT, 0.548), (-7.31, 0.532),
             (-7.3, 0.512), (-7.17, 0.492), (-7.16, 0.472), (-7.03, 0.448), (-7.02, 0.428), (-6.9, 0.4),
             (-6.82, 0.378), (-6.7, 0.376), (-6.6, 0.42), (-6.45, 0.5)]
    side.append(lathe('bell', liner, 28, F_ENG, M['nozzle'], closed=True, sharp=35))
    side.append(petal_ring('petals', 16, -6.44, -7.4, 0.6, 0.583, F_ENG, M['nozzle'], thick=0.016))
    for k, a in enumerate((-50, 8, 66)):
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        p0 = Vector((F_ENG[0] + 0.672 * c, -6.36, F_ENG[1] + 0.672 * s))
        p1 = Vector((F_ENG[0] + 0.628 * c, -6.98, F_ENG[1] + 0.628 * s))
        side.append(tube(f'actuator{k}', p0, p1, 0.02, M['metal'], sides=6))
        side.append(box(f'clevis{k}', (0.05, 0.06, 0.04), M['metal'], T(p1) @ R(math.radians(a - 90), 4, 'Y')))
    side.append(lathe('throat', [(-6.74, 0.0), (-6.74, 0.378), (-6.7, 0.378), (-6.7, 0.0)], 28, F_ENG, M['glow'],
                      smooth=False))
    side.append(lathe('cone', [(-6.69, 0.0), (-6.69, 0.15), (-6.8, 0.15), (-6.96, 0.085), (-7.04, 0.03), (-7.06, 0.0)],
                      16, F_ENG, M['metal'], sharp=50))
    side.append(blade_ring('vanes', 14, -6.775, 0.13, 0.374, 0.075, 0.012, 32, F_ENG, M['metal']))
    side.append(lathe('flameholder', [(-6.88, 0.255), (-6.95, 0.283), (-6.95, 0.227)], 24, F_ENG, M['metal'],
                      closed=True, smooth=False))
    # canted fin with a rudder
    for o in surfaced_wing('fin', F_FIN, M['fin'], [('rudder', 0.42, 1.18, 0.0)], hinge=0.72, chord_pts=9):
        side.append(transformed(o, F_FIN_M))
    parts += mirrored(side)
    for o in parts:
        if o.name == 'navlight_m':          # red to port, green to starboard
            o.data.materials[0] = M['red']

    # Greebles, raycast onto the fuselage and nacelles.
    bvh = bvh_of([o for o in parts if o.name.startswith(('body', 'nacelle'))])
    _, m = frame_on(bvh, (0, 0.35, 5), (0, 0, -1))
    parts.append(blade_antenna('blade_dorsal', M['metal'], m, height=0.3, root=0.4, tip=0.13, sweep=0.24))
    _, m = frame_on(bvh, (0, -3.35, 5), (0, 0, -1))
    parts.append(box('antenna_base', (0.12, 0.26, 0.05), M['metal'], m))
    parts.append(transformed(lathe('antenna', [(0.0, 0.022), (0.75, 0.009), (0.78, 0.0)], 6, (0, 0), M['metal']),
                             m @ R(math.radians(66), 4, 'X') @ R(math.radians(180), 4, 'Z')))
    _, m = frame_on(bvh, (0, -2.3, 5), (0, 0, -1))
    parts.append(dome('beacon_top', 0.06, 0.06, M['beacon'], m))
    _, m = frame_on(bvh, (0, -1.25, -5), (0, 0, 1))
    parts.append(dome('beacon_belly', 0.06, 0.055, M['beacon'], m))
    _, m = frame_on(bvh, (0, 5.62, -5), (0, 0, 1))
    parts.append(blade_antenna('blade_chin', M['metal'], m, height=0.17, root=0.24, tip=0.08, sweep=0.13))
    # sensor turret under the nose: a faired blister with a faceted window
    _, m = frame_on(bvh, (0, 4.25, -5), (0, 0, 1))
    zc = m.translation.z + 0.015
    parts.append(lathe('eo_blister', [(4.78, 0.0), (4.62, 0.09), (4.45, 0.125), (4.2, 0.125), (3.98, 0.095),
                                      (3.82, 0.0)], 14, (0, zc), M['body'], sharp=50))
    parts.append(transformed(lathe('eo_window', [(-0.01, 0.0), (-0.01, 0.1), (0.04, 0.094), (0.085, 0.06), (0.1, 0.0)],
                                   6, (0, 0), M['sensor'], smooth=False, phase=math.pi / 6),
                             T((0, 4.6, zc - 0.07)) @ R(math.radians(-30), 4, 'X')))
    parts.append(lathe('probe', [(6.95, 0.035), (7.6, 0.012), (7.65, 0.0)], 6, (0, -0.13), M['metal']))
    parts.append(lathe('probe_collar', [(6.9, 0.0), (6.9, 0.05), (7.02, 0.05), (7.06, 0.036), (7.06, 0.0)], 10,
                       (0, -0.13), M['metal'], smooth=False))
    parts.append(dome('taillight', 0.045, 0.035, M['white'], facing(Vector((0, -6.915, 0.04)), (0, -1, 0))))

    greebles = []
    for i, (yy, size) in enumerate(((-0.5, (0.4, 0.75, 0.05)), (-1.55, (0.4, 0.6, 0.05)))):
        _, m = frame_on(bvh, (0.62, yy, 5), (0, 0, -1))
        greebles += vent(f'vent{i}', size, M['metal'], m)
    for i, yy in enumerate((-3.5, -4.25)):
        _, m = frame_on(bvh, (5, yy, 0.05), (-1, 0, 0))
        greebles += vent(f'radiator{i}', (0.42, 0.55, 0.04), M['metal'], m, slats=6)
    _, m = frame_on(bvh, (3, -0.35, 0.47), (-1, 0, -0.1))
    greebles += grille('grille', (0.24, 0.5, 0.04), M['metal'], m, bars=5)
    # pitot tubes on the nose
    _, m = frame_on(bvh, (3, 5.95, -0.03), (-1, 0, 0))
    greebles.append(box('pitot_base', (0.06, 0.14, 0.05), M['metal'], m, taper=0.7))
    p0 = m.translation + m.col[2].xyz * 0.035
    greebles.append(tube('pitot', p0, p0 + Vector((0.05, 0.36, 0.0)), 0.011, M['metal'], sides=6))
    # access plates and hatches that stand proud of the skin
    for i, (origin, ray, size, mat) in enumerate((
            ((3, -1.05, 0.58), (-1, 0, 0), (0.24, 0.62), 'body'),
            ((3, -2.55, 1.8), (-1.2, 0, -1.4), (0.36, 0.7), 'engine'),
            ((0.45, 5.45, 3), (0, 0, -1), (0.26, 0.36), 'body'))):
        greebles.append(drape_plate(f'plate{i}', bvh, origin, ray, size, M[mat], thick=0.014))
    _, m = frame_on(bvh, (0.75, -2.0, -3), (0, 0, 1))
    greebles.append(blade_antenna('blade_belly', M['metal'], m, height=0.22, root=0.28, tip=0.1, sweep=0.16))
    parts += mirrored(greebles)

    rcs_bvh = bvh_of([o for o in parts if o.name.startswith(('body', 'nacelle', 'pod'))])
    skin = {'rcs_07': 'engine', 'rcs_08': 'engine', 'rcs_09': 'pod', 'rcs_10': 'pod', 'rcs_11': 'pod', 'rcs_12': 'pod'}
    rcs_parts, empties = place_rcs_clusters(F_RCS, rcs_bvh, lambda n: M[skin.get(n, 'body')], [M['bell'], M['hole']])
    parts += rcs_parts
    empties += [
        empty('nozzle_R', (F_ENG[0], F_EXIT, F_ENG[1])), empty('nozzle_L', (-F_ENG[0], F_EXIT, F_ENG[1])),
        empty('muzzle_R', (F_POD_X, F_MUZZLE_Y, F_TIP_Z)), empty('muzzle_L', (-F_POD_X, F_MUZZLE_Y, F_TIP_Z)),
        empty('cam_cockpit', (0, 2.95, 0.98)),
    ]
    uv_weights(parts)
    return parts, [glass], empties


F_UV_WEIGHTS = (
    # part name prefix -> texel weight (1 = the hull's density)
    ('fan', 0.4), ('vanes', 0.4), ('cone', 0.45), ('flameholder', 0.4), ('throat', 0.3), ('bell', 0.55),
    ('petals', 0.7), ('heatsink', 0.7), ('actuator', 0.6), ('clevis', 0.5), ('gun_', 0.75), ('barrel', 0.7),
    ('bore', 0.3), ('gpod_band', 0.5), ('missile', 0.75), ('seeker', 0.5), ('motor', 0.4), ('mfin', 0.6),
    ('mcanard', 0.5), ('pylon', 0.7), ('rail', 0.6), ('sway', 0.5), ('splitter', 0.75), ('fan_spinner', 0.4),
    ('rcs_', 0.6), ('vent', 0.7), ('radiator', 0.7), ('grille', 0.7), ('pitot', 0.6), ('blade', 0.7),
    ('antenna', 0.6), ('beacon', 0.4), ('taillight', 0.4), ('probe', 0.6), ('eo_', 0.7), ('navlight', 0.4),
    ('canopy_', 0.85), ('ring', 0.5),
)
F_UV_MATERIALS = (('f_duct', 0.35),)        # material -> texel weight, over the part's own
F_UV_CAPPED = ('wing', 'flap', 'aileron', 'fin', 'rudder')    # slices whose end caps (n-gons) hide in the wing
F_UV_HIDDEN = (('petals', F_ENG),)           # parts whose faces turned to this axis (x, z) are hidden


def uv_weights(parts, table=F_UV_WEIGHTS, under=0.7):
    """Store each face's texel weight in a face attribute `uvw` for
    bake_ship_fine(): the part's weight by name prefix, a material's weight
    where one is listed, lower on faces looking down, and low on the end
    caps of wing slices and on the hidden inner faces of nozzle petals."""
    for o in parts:
        w = next((v for k, v in table if o.name.startswith(k)), 1.0)
        mats = {i: dict(F_UV_MATERIALS).get(m.name) for i, m in enumerate(o.data.materials) if m is not None}
        capped = o.name.startswith(F_UV_CAPPED)
        axis = next((a for k, a in F_UV_HIDDEN if o.name.startswith(k)), None)
        me = o.data
        attr = me.attributes.get('uvw') or me.attributes.new('uvw', 'FLOAT', 'FACE')
        vals = []
        for p in me.polygons:
            v = mats.get(p.material_index) or w
            if capped and len(p.vertices) > 8:
                v = 0.25
            if axis is not None:
                c = p.center
                radial = Vector((math.copysign(1.0, c.x) * (abs(c.x) - axis[0]), 0.0, c.z - axis[1]))
                if p.normal.dot(radial) < -0.5 * radial.length:
                    v = 0.25
            vals.append(v * (under if p.normal.z < -0.55 else 1.0))
        attr.data.foreach_set('value', vals)


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
    return bake_hull(name, hull, extras, empties, tex)


def inside_mesh(tree, p, margin, dirs=((0.31, 0.17, 0.94), (-0.52, 0.11, -0.85), (0.93, -0.2, 0.31))):
    """Whether p lies inside the closed mesh of `tree` (by ray parity along
    three directions, which must all agree) and at least `margin` from its
    surface."""
    near = tree.find_nearest(p)
    if near[0] is None or near[3] < margin:
        return False
    for d in dirs:
        d = Vector(d).normalized()
        hits, q = 0, Vector(p)
        while hits < 64:
            loc = tree.ray_cast(q, d)[0]
            if loc is None:
                break
            hits += 1
            q = loc + d * 1e-4
        if hits % 2 == 0:
            return False
    return True


def cull_hidden(parts, margin=0.004):
    """Delete the faces of every part that lie wholly inside one of the
    parts marked obj['solid'] (holes in a solid are filled for the test):
    wing roots inside the fuselage, the fuselage inside the nacelles and so
    on. Nobody sees them, and they would take texture space."""
    solids = []
    for s in (o for o in parts if o.get('solid')):
        bm = bmesh.new()
        bm.from_mesh(s.data)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        tree = BVHTree.FromBMesh(bm)
        co = np.array([v.co[:] for v in bm.verts])
        solids.append((s, tree, Vector(co.min(axis=0)), Vector(co.max(axis=0))))
        bm.free()
    removed = 0
    for o in parts:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        doomed = []
        for f in bm.faces:
            pts = [v.co.copy() for v in f.verts] + [f.calc_center_median()]
            for s, tree, lo, hi in solids:
                if s is o or not all(lo.x <= p.x <= hi.x and lo.y <= p.y <= hi.y and lo.z <= p.z <= hi.z for p in pts):
                    continue
                if all(inside_mesh(tree, p, margin) for p in pts):
                    doomed.append(f)
                    break
        if doomed:
            removed += len(doomed)
            bmesh.ops.delete(bm, geom=doomed, context='FACES')
            bm.to_mesh(o.data)
            o.data.update()
        bm.free()
    C.log(f'  culled {removed} hidden faces')


def weighted_uv(obj, angle=60.0, margin=0.003, attr='uvw', split=4.8):
    """smart_uv(), then every UV island scaled by the area-weighted mean of
    its faces' texel weights (the `attr` face attribute, see uv_weights()),
    then packed again: parts nobody looks at closely give up texture space
    to those they do. Islands longer than `split` metres are cut into
    pieces first, which pack far better than long slivers."""
    C.smart_uv(obj, angle=angle, margin=margin)
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    wl = bm.faces.layers.float.get(attr)
    if wl is None:
        bm.free()
        return
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) != 2:
            continue
        la = next(l for l in fs[0].loops if l.edge == e)
        lb = next(l for l in fs[1].loops if l.edge == e)
        a0, a1 = la[uv].uv, la.link_loop_next[uv].uv
        b0, b1 = (lb[uv].uv, lb.link_loop_next[uv].uv) if la.vert == lb.vert else (lb.link_loop_next[uv].uv, lb[uv].uv)
        if (a0 - b0).length < 1e-6 and (a1 - b1).length < 1e-6:
            ra, rb = find(fs[0].index), find(fs[1].index)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    islands = {}
    for f in bm.faces:
        islands.setdefault(find(f.index), []).append(f)
    # long islands pack badly: cut those longer than `split` metres into
    # pieces along their longest axis (a tiny UV offset disconnects them)
    pieces = []
    for faces in islands.values():
        co = np.array([f.calc_center_median()[:] for f in faces])
        ext = co.max(axis=0) - co.min(axis=0)
        k = int(np.argmax(ext))
        n = int(math.ceil(ext[k] / split)) if split else 1
        if n <= 1:
            pieces.append(faces)
            continue
        lo = co[:, k].min()
        bins = np.minimum((co[:, k] - lo) / (ext[k] / n), n - 1).astype(int)
        for b in range(n):
            part = [f for f, fb in zip(faces, bins) if fb == b]
            if part:
                for f in part:
                    for l in f.loops:
                        l[uv].uv += Vector((b * 1e-3, 0.0))
                pieces.append(part)
    for faces in pieces:
        area = sum(f.calc_area() for f in faces)
        w = sum(f[wl] * f.calc_area() for f in faces) / area if area > 1e-12 else 1.0
        if abs(w - 1.0) < 1e-3 or w <= 0.0:
            continue
        loops = [l for f in faces for l in f.loops]
        c = Vector((0.0, 0.0))
        for l in loops:
            c += l[uv].uv
        c /= len(loops)
        for l in loops:
            l[uv].uv = c + (l[uv].uv - c) * w
    bm.to_mesh(me)
    bm.free()
    C.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method='CONCAVE', scale=True,
                            margin_method='FRACTION', margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_ship_fine(name, parts, extras, empties, tex):
    """bake_ship() for a detailed model: hidden faces culled first, UV
    islands sized by the parts' texel weights, then the same bakes."""
    cull_hidden(parts)
    hull = C.join(parts, 'hull')
    weighted_uv(hull, angle=60.0, margin=0.0025)
    if 'uvw' in hull.data.attributes:
        hull.data.attributes.remove(hull.data.attributes['uvw'])
    return bake_hull(name, hull, extras, empties, tex)


def bake_hull(name, hull, extras, empties, tex):
    """Triangulate an unwrapped hull and bake its paint: normals from a
    bevelled copy, then base colour, roughness, metallic and emission."""
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


def anchor_blocks(path):
    """The per-ship blocks of an existing js/anchors.js by ship key: the
    lines from `  <key>: {` to its closing `  },`."""
    blocks, key = {}, None
    if not os.path.exists(path):
        return blocks
    with open(path) as f:
        for line in f.read().split('\n'):
            m = re.match(r'^  (\w+): \{$', line)
            if m:
                key = m.group(1)
                blocks[key] = [line]
            elif key is not None:
                blocks[key].append(line)
                if line == '  },':
                    key = None
    return blocks


def write_anchors(data, keep=None):
    """Write js/anchors.js from `data` (ship key -> ship_anchors()); ships
    missing from `data` keep their block from `keep` (anchor_blocks())."""
    keys = [n for n, *_ in SHIPS if n in data or (keep and n in keep)]
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
    for key in keys:
        if key not in data:
            lines += keep[key]
            continue
        a = data[key]
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
BAKERS = {'fighter': bake_ship_fine}      # the rest use bake_ship


def main(only=None):
    data = {}
    for name, build, tex in SHIPS:
        if only and name not in only:
            continue
        C.reset(samples=8)
        C.log('ship', name)
        parts, extras, empties = build()
        hull = BAKERS.get(name, bake_ship)(name, parts, extras, empties, tex)
        C.log(f'  {name}: {C.tri_count(hull) + sum(C.tri_count(o) for o in extras)} tris')
        C.export_glb(os.path.join(C.MODELS, name + '.glb'), [hull] + extras + empties)
        data[name] = ship_anchors(hull, extras, empties)
    if len(data) == len(SHIPS):
        write_anchors(data)
        return
    keep = anchor_blocks(os.path.join(C.JS, 'anchors.js'))
    if data and all(n in data or n in keep for n, *_ in SHIPS):
        write_anchors(data, keep)
        C.log('partial build: js/anchors.js updated for', ', '.join(data))
    else:
        C.log('partial build: js/anchors.js left unchanged')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
