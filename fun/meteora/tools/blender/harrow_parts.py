"""Meteora — shared parts for the Harrow models (build_harrow.py).

On top of the helpers in build_ships.py: diamond-section blades and curved
tines, tubes, lamps, armour plates that hug a curved hull or a sphere, a
hunched faceted hull section, the Harrow paint (gunmetal, oxblood, hazard
yellow, red glow) with a finish that scales with the model, the bake (one
texture set per model, shared by all of its mesh nodes; child nodes are
split out afterwards with their origin at a pivot), compositing two bakes
into one atlas, and the generated js/anchors/<name>.js modules.

Edges are rounded in the normal map by the Bevel shader node rather than
by a bevelled high copy, so flat facets stay crisp: every textured part
bakes its own shading normal (bevel plus bump) in one pass.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S

FAST = bool(os.environ.get('METEORA_FAST'))
lin = S.lin

GUNMETAL, OXBLOOD, HAZARD = S.GUNMETAL, S.OXBLOOD, S.HAZARD
RED = lin('#ff2a1a')                    # eyes and seams
UNDER = (0.035, 0.038, 0.042)           # the Thorn's dark underside
BLACKED = (0.022, 0.023, 0.026)
STEEL = (0.18, 0.18, 0.19)              # bare blade edges
BARE, SOOT = S.BARE, S.SOOT
HOT = (1.0, 0.42, 0.12)                 # engine throats, as on the Thorn


# ==========================================================================
# Geometry

def skin(bm, rings, cap_start=True, cap_end=True):
    """Join consecutive rings (equal-length vertex lists, or a single vertex
    for a pointed end) with quads or fans; cap list ends with an n-gon."""
    for a, b in zip(rings, rings[1:]):
        if isinstance(a, list) and isinstance(b, list):
            n = len(a)
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((a[i], a[j], b[j], b[i]))
        elif isinstance(a, list):
            n = len(a)
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], b))
        elif isinstance(b, list):
            n = len(b)
            for i in range(n):
                bm.faces.new((a, b[(i + 1) % n], b[i]))
    if cap_start and isinstance(rings[0], list):
        bm.faces.new(rings[0][::-1])
    if cap_end and isinstance(rings[-1], list):
        bm.faces.new(rings[-1])


def bezier(p0, p1, p2, n):
    p0, p1, p2 = Vector(p0), Vector(p1), Vector(p2)
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in (i / (n - 1) for i in range(n))]


def blade(name, path, chord, thick, mat, chord_dir, lead=1.0, sharp=22, smooth=True):
    """A diamond-section blade along `path` (root to tip). Each section
    spans +-chord[i] along `chord_dir` (made square to the path; a vector,
    or f(i, point)) and +-thick[i] across it; `lead` > 1 lengthens the
    half toward +chord_dir. A zero chord closes the end to a point; a list
    end is capped."""
    bm = bmesh.new()
    pts = [Vector(p) for p in path]
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        d = Vector(chord_dir(i, p) if callable(chord_dir) else chord_dir)
        d = (d - t * d.dot(t)).normalized()
        side = t.cross(d).normalized()
        w, th = chord[i], thick[i]
        if w < 1e-6:
            rings.append(bm.verts.new(p))
        else:
            rings.append([bm.verts.new(p + d * w * lead), bm.verts.new(p + side * th),
                          bm.verts.new(p - d * w * (2.0 - lead)), bm.verts.new(p - side * th)])
    skin(bm, rings)
    return S.finish_bm(name, bm, mat, smooth=smooth, sharp=sharp)


def tube(name, path, radius, mat, sides=6, sharp=None):
    """A smooth round tube along a polyline (parallel-transported frame),
    capped at both ends; `radius` is a number or one per point."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    radii = radius if isinstance(radius, (list, tuple)) else [radius] * n
    bm = bmesh.new()
    rings = []
    t0 = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    u = t0.cross(ref).normalized()
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        u = (u - t * u.dot(t)).normalized()
        v = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides))
                                   * radii[i]) for k in range(sides)])
    skin(bm, rings)
    return S.finish_bm(name, bm, mat, smooth=True, sharp=sharp)


def lamp(name, centre, normal, radius, mat, sides=8):
    """A small domed lamp lens sitting on a surface at `centre`, bulging
    along `normal` (its back sunk into the surface)."""
    m = S.facing(Vector(centre), Vector(normal)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    prof = [(-radius * 0.5, 0.0), (-radius * 0.5, radius), (radius * 0.25, radius * 0.95),
            (radius * 0.7, radius * 0.55), (radius * 0.85, 0.0)]
    return S.transformed(S.lathe(name, prof, sides, (0, 0), mat), m)


def disc(name, y, r, sides, centre, mat, facing=-1.0, phase=0.0):
    """A flat single-sided n-gon across the Y axis at `y`, its normal along
    `facing` * Y (a glowing throat seen from behind a nozzle)."""
    bm = bmesh.new()
    cx, cz = centre
    vs = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / sides + phase), y,
                        cz + r * math.sin(2 * math.pi * i / sides + phase))) for i in range(sides)]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.y * facing < 0:
        f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = C.link(bpy.data.objects.new(name, me))
    obj.data.materials.append(mat)
    return obj


def tine(name, root, ctrl, tip, chord0, thick0, mat, chord_dir, n=7, lead=1.2, taper=0.85, sharp=22):
    """A curved, tapering harrow tine: a diamond blade along a quadratic
    Bezier from `root` (buried in the hull) through `ctrl` to a point."""
    path = bezier(root, ctrl, tip, n)
    us = [i / (n - 1) for i in range(n)]
    chord = [chord0 * (1 - u) ** taper for u in us]
    thick = [thick0 * (1 - u) ** (taper * 0.8) for u in us]
    chord[-1] = thick[-1] = 0.0
    return blade(name, path, chord, thick, mat, chord_dir, lead=lead, sharp=sharp)


def surface_hit(bvh, origin, ray):
    loc, nrm, _, _ = bvh.ray_cast(Vector(origin), Vector(ray).normalized())
    if loc is None:
        raise RuntimeError(f'ray from {tuple(origin)} along {tuple(ray)} missed')
    nrm = nrm.normalized()
    if nrm.dot(Vector(ray)) > 0:
        nrm = -nrm
    return loc, nrm


def hug_plate(name, bvh, origin, ray, u, v, size, mat, thick=0.06, grid=(3, 2), chamfer=1.0,
              sink=0.05, shape=None):
    """An armour plate that follows the surface under it: a (nu x nv) grid
    projected along `ray` from a rectangle size=(su, sv) spanned by u and v
    around `origin`. The top stands `thick` proud, inset by chamfer*thick
    at the rim (a chamfered edge); the skirt sinks `sink` below the
    surface and the bottom is closed. shape(s, t) -> (s, t), s and t in
    [-0.5, 0.5], bends the outline (trapezoids, chevrons)."""
    u, v = Vector(u).normalized(), Vector(v).normalized()
    nu, nv = grid
    inset_s = min(0.45, chamfer * thick / size[0])
    inset_t = min(0.45, chamfer * thick / size[1])

    def at(s, t, inset=False):
        if inset:
            s, t = s * (1 - 2 * inset_s), t * (1 - 2 * inset_t)
        if shape:
            s, t = shape(s, t)
        return surface_hit(bvh, Vector(origin) + u * s * size[0] + v * t * size[1], ray)

    bm = bmesh.new()
    ss = [-0.5 + i / nu for i in range(nu + 1)]
    ts = [-0.5 + j / nv for j in range(nv + 1)]
    top = {}
    for i, s in enumerate(ss):
        for j, t in enumerate(ts):
            p, nrm = at(s, t, inset=True)
            top[i, j] = bm.verts.new(p + nrm * thick)
    border = [(i, 0) for i in range(nu + 1)] + [(nu, j) for j in range(1, nv + 1)] + \
             [(i, nv) for i in range(nu - 1, -1, -1)] + [(0, j) for j in range(nv - 1, 0, -1)]
    mid, low = [], []
    for i, j in border:
        p, nrm = at(ss[i], ts[j])
        mid.append(bm.verts.new(p + nrm * thick * 0.3))
        low.append(bm.verts.new(p - nrm * sink))
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((top[i, j], top[i + 1, j], top[i + 1, j + 1], top[i, j + 1]))
    ring = [top[k] for k in border]
    m = len(border)
    for k in range(m):
        q = (k + 1) % m
        bm.faces.new((ring[k], mid[k], mid[q], ring[q]))
        bm.faces.new((mid[k], low[k], low[q], mid[q]))
    bm.faces.new(low[::-1])
    return S.finish_bm(name, bm, mat, smooth=False)


def sphere_dir(lat, lon):
    """Unit vector at `lat` degrees from +Y and `lon` degrees around Y
    (0 = +X, 90 = +Z)."""
    a, b = math.radians(lat), math.radians(lon)
    return Vector((math.sin(a) * math.cos(b), math.cos(a), math.sin(a) * math.sin(b)))


def sphere_plate(name, centre, radius, lat, lon, mat, thick=0.1, grid=(3, 2), chamfer=1.0, sink=0.1,
                 shape=None, sharp=35):
    """An armour plate on a sphere around `centre`: lat=(lat0, lat1) and
    lon=(lon0, lon1) in degrees about the Y axis. The top stands `thick`
    proud with a chamfered rim; the skirt sinks `sink` below the sphere.
    shape(s, t) -> (s, t) bends the outline (s along lon, t along lat)."""
    centre = Vector(centre)
    nu, nv = grid
    (la0, la1), (lo0, lo1) = lat, lon
    cs = min(0.45, chamfer * thick / (math.radians(lo1 - lo0) * radius * math.sin(math.radians((la0 + la1) / 2))))
    ct = min(0.45, chamfer * thick / (math.radians(la1 - la0) * radius))

    def at(s, t, r, inset=False):
        if inset:
            s, t = s * (1 - 2 * cs), t * (1 - 2 * ct)
        if shape:
            s, t = shape(s, t)
        return centre + sphere_dir(la0 + (t + 0.5) * (la1 - la0), lo0 + (s + 0.5) * (lo1 - lo0)) * r

    bm = bmesh.new()
    ss = [-0.5 + i / nu for i in range(nu + 1)]
    ts = [-0.5 + j / nv for j in range(nv + 1)]
    top = {(i, j): bm.verts.new(at(s, t, radius + thick, True)) for i, s in enumerate(ss) for j, t in enumerate(ts)}
    border = [(i, 0) for i in range(nu + 1)] + [(nu, j) for j in range(1, nv + 1)] + \
             [(i, nv) for i in range(nu - 1, -1, -1)] + [(0, j) for j in range(nv - 1, 0, -1)]
    mid = [bm.verts.new(at(ss[i], ts[j], radius + thick * 0.3)) for i, j in border]
    low = [bm.verts.new(at(ss[i], ts[j], radius - sink)) for i, j in border]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((top[i, j], top[i + 1, j], top[i + 1, j + 1], top[i, j + 1]))
    ring = [top[k] for k in border]
    m = len(border)
    for k in range(m):
        q = (k + 1) % m
        bm.faces.new((ring[k], mid[k], mid[q], ring[q]))
        bm.faces.new((mid[k], low[k], low[q], mid[q]))
    bm.faces.new(low[::-1])
    return S.finish_bm(name, bm, mat, smooth=True, sharp=sharp)


def roofed(around, w, zt, zb, zc):
    """A faceted 12-point section for a hunched hull: a wide sharp chine at
    zc, a steep roof of facets up to a narrow ridge zt above it, and a
    shallow faceted belly zb below."""
    return [(w, zc), (w * 0.84, zc + zt * 0.36), (w * 0.52, zc + zt * 0.76), (w * 0.17, zc + zt),
            (-w * 0.17, zc + zt), (-w * 0.52, zc + zt * 0.76), (-w * 0.84, zc + zt * 0.36), (-w, zc),
            (-w * 0.78, zc - zb * 0.55), (-w * 0.3, zc - zb), (w * 0.3, zc - zb), (w * 0.78, zc - zb * 0.55)]


def up_from_y():
    """Rotation taking a lathe's axis (+Y) to +Z."""
    return Matrix.Rotation(math.radians(90), 4, 'X')


def tag(obj, node):
    """Mark a part as belonging to child node `node` (split out after the bake)."""
    obj['hnode'] = node
    return obj


def add_sharp(obj, angle_deg):
    """Mark edges sharper than `angle_deg` sharp, keeping existing marks."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    layer = bm.edges.layers.bool.get('sharp_edge') or bm.edges.layers.bool.new('sharp_edge')
    c = math.cos(math.radians(angle_deg))
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.link_faces[0].normal.dot(e.link_faces[1].normal) < c:
            e[layer] = True
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


# ==========================================================================
# Paint

def finish(g, base, rough, metal, P, N, k=1.0, wear=1.0, grime=1.0, lines=True, glow=None,
           panel_scale=1.25, panel=(1.1, 0.42), mortar=0.011, bevel=0.02):
    """The Thorn's finish (build_ships.weathered) with every length scaled
    by k for bigger models: panel lines with per-panel tint, AO grime and
    streaks, chipped edges and scratches to bare metal, paint grain. The
    shading normal starts from the Bevel node (rounded edges, radius
    bevel*k) with the bump on top."""
    Ps = g.vmath('SCALE', P, scale=1.0 / k) if k != 1.0 else P
    height = 0.0
    if lines:
        mask, tint = S.panel_lines(g, Ps, N, panel_scale, mortar, panel)
        base = g.mix(1.0, base, g.combine(tint, tint, tint), 'MULTIPLY')
        base = g.mix(g.mul(mask, 0.6), base, (0.008, 0.008, 0.009))
        rough = g.mixf(g.mul(mask, 0.5), rough, 0.7)
        height = g.mul(mask, -0.0018 * k)
    ao = g.node('ShaderNodeAmbientOcclusion', [None, 0.45 * k], samples=12, only_local=False).outputs['AO']
    streak = g.smooth(g.noise(g.vmath('MULTIPLY', Ps, (7.0, 0.35, 7.0)), 1.0, 4.0, 0.6), 0.5, 0.8)
    dirt = g.add(g.mul(g.sub(1.0, ao), 0.85), g.mul(streak, 0.25))
    dirt = g.mul(g.minimum(dirt, 1.0), grime)
    base = g.mix(g.mul(dirt, 0.7), base, (0.035, 0.03, 0.026), 'MULTIPLY')
    rough = g.mixf(g.mul(dirt, 0.5), rough, 0.62)
    bev = g.node('ShaderNodeBevel', [bevel * k], samples=8).outputs[0]
    edge = g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1))
    patches = g.smooth(g.noise(Ps, 2.2, 3.0, 0.5), 0.5, 0.62)
    chips = g.mul(g.mul(g.smooth(edge, 0.02, 0.08), patches), g.smooth(g.noise(Ps, 14.0, 4.0, 0.6), 0.4, 0.55))
    scratches = g.mul(g.smooth(g.noise(g.vmath('MULTIPLY', Ps, (1.0, 14.0, 1.0)), 6.0, 3.0, 0.5), 0.74, 0.8),
                      g.smooth(g.noise(Ps, 2.5, 2.0), 0.55, 0.7))
    worn = g.mul(g.maximum(chips, g.mul(scratches, 0.6)), wear)
    base = g.mix(worn, base, BARE)
    rough = g.mixf(worn, rough, 0.35)
    metal = g.mixf(worn, metal, 0.6)
    height = g.add(height, g.mul(worn, -0.0004 * k))
    height = g.add(height, g.mul(g.noise(Ps, 60.0, 3.0, 0.5), 0.00015 * k))
    return dict(albedo=base, rough=rough, metal=metal, normal=g.bump(height, 1.0, 1.0, normal=bev), glow=glow)


def plain(g, P, N, albedo, rough, metal, glow=None, k=1.0):
    """No paint, just the rounded edges in the normal."""
    bev = g.node('ShaderNodeBevel', [0.015 * k], samples=8).outputs[0]
    return dict(albedo=albedo, rough=rough, metal=metal, glow=glow, normal=bev)


def hazard_paint(g, u, v, width=0.16):
    return g.mix(S.hazard(g, u, v, width), (0.02, 0.02, 0.02), HAZARD)


def common_materials(prefix, k=1.0):
    """The shared Harrow parts: bare dark metal, oxblood armour, blackened
    metal, red lamps, the engine-throat glow, soot."""
    M = {}
    M['metal'] = S.material(prefix + '_metal', lambda g, P, N: finish(
        g, (0.04, 0.042, 0.046), 0.46, 0.6, P, N, k, lines=False, wear=0.6))
    M['armour'] = S.material(prefix + '_armour', lambda g, P, N: finish(
        g, OXBLOOD, 0.42, 0.35, P, N, k, lines=False, wear=1.2))
    M['black'] = S.material(prefix + '_black', lambda g, P, N: finish(
        g, BLACKED, 0.55, 0.45, P, N, k, lines=False, wear=0.4))
    M['red'] = S.material(prefix + '_red', lambda g, P, N: plain(g, P, N, (0.3, 0.02, 0.015), 0.3, 0.0, RED, k))
    M['glow'] = S.material(prefix + '_glow', lambda g, P, N: plain(g, P, N, (0.4, 0.2, 0.1), 0.3, 0.0, HOT, k))
    M['hole'] = S.material(prefix + '_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0))
    return M


def eye_material(name, centre, axis, lens_r, hot=1.0):
    """A glossy red lens: a dark rim, a glowing iris cut by aperture blades,
    a dark pupil ring and a hot core, all around `axis` through `centre`."""
    centre, axis = Vector(centre), Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    e1 = axis.cross(ref).normalized()
    e2 = axis.cross(e1)

    def build(g, P, N):
        d = g.vmath('SUBTRACT', P, tuple(centre))
        along = g.vmath('DOT_PRODUCT', d, tuple(axis), out=1)
        radial_v = g.vmath('SUBTRACT', d, g.vmath('SCALE', tuple(axis), scale=along))
        r = g.math('DIVIDE', g.vmath('LENGTH', radial_v, out=1), lens_r)
        a = g.math('ARCTAN2', g.vmath('DOT_PRODUCT', d, tuple(e2), out=1), g.vmath('DOT_PRODUCT', d, tuple(e1), out=1))
        blades = g.smooth(g.absolute(g.math('SINE', g.add(g.mul(a, 8.0), g.mul(r, 5.0)))), 0.9, 0.99)
        iris = g.mul(g.smooth(r, 0.82, 0.62), g.smooth(r, 0.2, 0.3))
        iris = g.mul(iris, g.sub(1.0, g.mul(blades, 0.75)))
        ring = g.mul(g.smooth(r, 0.98, 0.9), g.smooth(r, 0.78, 0.86))
        core = g.smooth(r, 0.17, 0.08)
        glow = g.mix(g.mul(ring, 0.5), (0.0, 0.0, 0.0), (0.35, 0.01, 0.005))
        glow = g.mix(iris, glow, (1.0 * hot, 0.05, 0.018))
        glow = g.mix(core, glow, (1.0, 0.45 * hot, 0.22 * hot))
        albedo = g.mix(g.smooth(r, 1.0, 0.9), (0.02, 0.02, 0.022), (0.08, 0.005, 0.004))
        return dict(albedo=albedo, rough=0.07, metal=0.0, glow=glow)
    return S.material(name, build)


# ==========================================================================
# Bake and export

def tag_faces(parts, children):
    names = list(children)
    for o in parts:
        idx = names.index(o['hnode']) + 1 if 'hnode' in o.keys() else 0
        attr = o.data.attributes.new('hnode', 'INT', 'FACE')
        attr.data.foreach_set('value', [idx] * len(o.data.polygons))


def join_parts(parts, name, children=()):
    tag_faces(parts, children)
    return C.join(parts, name)


def bake_maps(obj, name, tex, margin=None, samples=16):
    """Bake normal, albedo, roughness, metallic and glow of `obj`'s own
    source materials. Returns (base, normal, mr, emissive) images."""
    size_base, size_mr = (256, 128) if FAST else tex
    base = C.new_image(name + '_base', size_base)
    nrm = C.new_image(name + '_normal', size_base, non_color=True)
    rough = C.new_image(name + '_rough', size_mr, non_color=True)
    metal = C.new_image(name + '_metal', size_mr, non_color=True)
    glow = C.new_image(name + '_emissive', size_mr)
    margin = margin or max(2, size_base // 256)
    s = 1 if FAST else samples
    C.bake(obj, nrm, 'NORMAL', margin=margin, samples=1 if FAST else 4)
    C.bake(obj, base, channel='albedo', margin=margin, samples=s)
    small = max(1, margin * size_mr // size_base)
    C.bake(obj, rough, channel='rough', margin=small, samples=max(1, s // 2))
    C.bake(obj, metal, channel='metal', margin=small, samples=max(1, s // 2))
    C.bake(obj, glow, channel='glow', margin=small, samples=1)
    mr = C.pack_mr(name + '_mr', rough, metal)
    dump(base, nrm, mr, glow)
    return base, nrm, mr, glow


def uv_coverage(obj, size, keep):
    """Boolean (size, size) mask of the texels whose centres fall inside
    the UV triangles of the (triangulated) faces with keep[face] True."""
    me = obj.data
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2) * size - 0.5          # texel centres sit on integers
    mask = np.zeros((size, size), bool)
    for poly in me.polygons:
        if not keep[poly.index]:
            continue
        idx = list(poly.loop_indices)
        for k in range(1, len(idx) - 1):
            a, b, c = uv[idx[0]], uv[idx[k]], uv[idx[k + 1]]
            lo, hi = np.minimum(np.minimum(a, b), c), np.maximum(np.maximum(a, b), c)
            x0, y0 = int(max(0, math.floor(lo[0]))), int(max(0, math.floor(lo[1])))
            x1, y1 = int(min(size - 1, math.ceil(hi[0]))), int(min(size - 1, math.ceil(hi[1])))
            if x1 < x0 or y1 < y0:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(d) < 1e-12:
                continue
            w1 = ((X - a[0]) * (c[1] - a[1]) - (Y - a[1]) * (c[0] - a[0])) / d
            w2 = ((b[0] - a[0]) * (Y - a[1]) - (b[1] - a[1]) * (X - a[0])) / d
            inside = (w1 >= -1e-4) & (w2 >= -1e-4) & (w1 + w2 <= 1 + 1e-4)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def owner_map(masks, grow=8):
    """Label every texel with the index of the mask that covers it, then
    grow the labels outward `grow` texels (into the bake margins), so a
    composite never filters one bake's margin into another's island."""
    label = np.full(masks[0].shape, -1, np.int8)
    for i, m in enumerate(masks):
        label[m & (label < 0)] = i
    for _ in range(grow):
        free = label < 0
        if not free.any():
            break
        for axis, step in ((0, 1), (0, -1), (1, 1), (1, -1)):
            nb = np.roll(label, step, axis=axis)
            take = free & (nb >= 0) & (label < 0)
            label[take] = nb[take]
    return label


def composite(target, sources, label):
    """Write into image `target` the pixels of sources[label] per texel
    (texels nobody owns take the first source)."""
    out = C.pixels(sources[0]).copy()
    for i, img in enumerate(sources[1:], start=1):
        sel = label == i
        out[sel] = C.pixels(img)[sel]
    C.set_pixels(target, out)
    return target


def dump(*images):
    folder = os.environ.get('METEORA_DUMP')
    if not folder:
        return
    os.makedirs(folder, exist_ok=True)
    for img in images:
        w, h = img.size
        copy = bpy.data.images.new(img.name + '_dump', w, h, alpha=False)
        copy.colorspace_settings.name = img.colorspace_settings.name
        copy.pixels.foreach_set(C.pixels(img).ravel())
        copy.filepath_raw = os.path.join(folder, img.name + '.png')
        copy.file_format = 'PNG'
        copy.save()
        bpy.data.images.remove(copy)


def prepare(obj, uv_angle=60.0, uv_margin=0.003, sharp=None):
    C.smart_uv(obj, angle=uv_angle, margin=uv_margin)
    C.triangulate(obj)
    if sharp:
        add_sharp(obj, sharp)


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.data.polygons.foreach_set('material_index', [0] * len(obj.data.polygons))


def split_children(obj, children, images):
    """Move the faces tagged for each child node into its own object,
    origin at the child's pivot, parented to `obj`, with its own copy of
    the baked material (same images, so the game can tint it alone)."""
    out = []
    for idx, (name, pivot) in enumerate(children.items(), start=1):
        me = obj.data.copy()
        me.name = name
        child = C.link(bpy.data.objects.new(name, me))
        for target, keep in ((child, True), (obj, False)):
            bm = bmesh.new()
            bm.from_mesh(target.data)
            layer = bm.faces.layers.int.get('hnode')
            doomed = [f for f in bm.faces if (f[layer] == idx) != keep]
            bmesh.ops.delete(bm, geom=doomed, context='FACES')
            bm.to_mesh(target.data)
            bm.free()
            target.data.update()
        child.data.transform(Matrix.Translation(-Vector(pivot)))
        child.location = pivot
        child.parent = obj
        assign(child, C.baked_material(name, *images))
        out.append(child)
    return out


def drop_attribute(objs, attr='hnode'):
    for o in objs:
        a = o.data.attributes.get(attr)
        if a is not None:
            o.data.attributes.remove(a)


# ==========================================================================
# Empties and anchors

def empty(name, location, direction=None, radius=None):
    e = S.empty(name, location, direction)
    if radius is not None:
        e.empty_display_type = 'SPHERE'
        e.empty_display_size = 1.0
        e.scale = (radius, radius, radius)
    return e


def _r(v, nd=3):
    return [round(x, nd) + 0.0 for x in v]


def anchors_of(meshes, empties, length_axis=1, nozzle_size=None, lights=None, nodes=None):
    """Collect the anchors module data from the parented empties (world
    transforms) in glTF space."""
    nozzle_size = nozzle_size or {}
    lights = lights or {}
    radius, lo, hi = 0.0, math.inf, -math.inf
    for o in meshes:
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            radius = max(radius, p.length)
            lo, hi = min(lo, p[length_axis]), max(hi, p[length_axis])
    by = lambda prefix: sorted((e for e in empties if e.name.startswith(prefix)), key=lambda e: e.name)
    pos = lambda e: _r(C.to_gltf(e.matrix_world.translation))

    def direction(e, local):
        d = (e.matrix_world.to_3x3() @ Vector(local)).normalized()
        return _r(C.to_gltf(d), 4)

    def scale_of(e):
        return round(e.matrix_world.to_scale()[0], 3)

    single = lambda name: next((pos(e) for e in empties if e.name == name), None)
    subs = []
    for e in by('sub_'):
        parts = e.name.split('_')
        subs.append(dict(name=e.name, kind=parts[1], pos=pos(e), r=scale_of(e)))
    return dict(
        radius=round(radius, 2),
        length=round(hi - lo, 2),
        nozzles=[dict(name=e.name, pos=pos(e), dir=direction(e, (0, -1, 0)), size=nozzle_size.get(e.name, 1.0))
                 for e in by('nozzle_')],
        muzzles=[dict(name=e.name, pos=pos(e)) for e in by('muzzle_')],
        rcs=[dict(name=e.name, pos=pos(e), dir=direction(e, (0, 0, 1))) for e in by('rcs_')],
        launchers=[dict(name=e.name, pos=pos(e)) for e in by('launcher_')],
        cockpit=single('cam_cockpit'),
        dock=single('dock'),
        colliders=[dict(pos=pos(e), r=scale_of(e)) for e in by('col_')],
        subsystems=subs,
        turrets=[],
        bays=[dict(name=e.name, pos=pos(e), dir=direction(e, (0, -1, 0))) for e in by('bay_')],
        lights=[dict(name=e.name, pos=pos(e), color=list(lights[e.name][0]), blink=lights[e.name][1])
                for e in by('light_')],
        nodes=dict(nodes or {}),
    )


def _num(x):
    return f'{x:g}'


def _vec(v):
    return '[' + ', '.join(_num(x) for x in v) + ']'


def _obj(d):
    out = []
    for k, v in d.items():
        if isinstance(v, str):
            out.append(f"{k}: '{v}'")
        elif isinstance(v, (list, tuple)):
            out.append(f'{k}: {_vec(v)}')
        else:
            out.append(f'{k}: {_num(v)}')
    return '{ ' + ', '.join(out) + ' }'


def write_anchors(name, data, remarks=()):
    lines = [
        f'/* Meteora — {name} anchors. GENERATED by tools/blender/build_harrow.py from',
        f'   the empties in {name}.glb; do not edit by hand. glTF space, metres: nose',
        '   along -Z, top +Y, right +X. */',
    ]
    lines += [f'// {r}' for r in remarks]
    lines += ['export default {', f"  radius: {_num(data['radius'])},", f"  length: {_num(data['length'])},"]
    for key in ('nozzles', 'muzzles', 'rcs', 'launchers'):
        lines += _list(key, data[key])
    for key in ('cockpit', 'dock'):
        v = data[key]
        lines.append(f'  {key}: {_vec(v) if v is not None else "null"},')
    for key in ('colliders', 'subsystems', 'turrets', 'bays', 'lights'):
        lines += _list(key, data[key])
    nodes = ', '.join(f"{k}: '{v}'" for k, v in data['nodes'].items())
    lines.append(f'  nodes: {{ {nodes} }},' if nodes else '  nodes: {},')
    lines.append('};')
    path = os.path.join(C.JS, 'anchors', name + '.js')
    with open(path, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    C.log('wrote', os.path.relpath(path, C.ROOT))


def _list(key, items):
    if not items:
        return [f'  {key}: [],']
    return [f'  {key}: ['] + [f'    {_obj(i)},' for i in items] + ['  ],']
