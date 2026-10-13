"""Meteora — parts and plumbing for the fleet models (build_fleet.py).

On top of build_ships.py's primitives this adds: polygon hull sections and
lofts with flat caps, conformal armour shells that follow a lofted hull,
curved blades for tines and claws, a stern annulus (a hull end with a
rectangular opening), the Harrow and Belt Watch turrets, a size-aware
version of the shared paint finish (so the same panel lines, grime and
edge wear read on a 5 m drone and on a 160 m gunship), the bakes, compound
collision spheres fitted to a hull, and the writer for js/anchors/<name>.js.

The output is deterministic: no unseeded randomness, and the clock is only
read to log how long each stage took.
"""
import bpy, bmesh, heapq, math, os, time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

import common as C
import build_ships as S

FAST = bool(os.environ.get('METEORA_FAST'))
SEAM = (1.0, 0.035, 0.012)          # Harrow red, #ff2a1a-ish, for emissive seams


# ==========================================================================
# Sections and lofts

def polygon(points):
    """A hull section from unit (u, v) points listed counter-clockwise from +X
    (x right, z up): u scales by the half-width w, v by the height above
    (v > 0) or the depth below (v < 0) the centre line zc."""
    def section(around, w, zt, zb, zc):
        return [(u * w, zc + v * (zt if v > 0 else zb)) for u, v in points]
    return section


def loft(name, rows, mat, section, along=None, front=None, back=None, smooth=True, sharp=None):
    """build_ships.loft with flat ends: `front` / `back` is None (open), a
    point (a cone to that tip) or 'cap' (a flat n-gon)."""
    bm = bmesh.new()
    rings = []
    for row in S.resample(rows, along):
        rings.append([bm.verts.new((x, row[0], z)) for x, z in section(0, *row[1:])])
    S.ring_faces(bm, rings)
    for ring, end in ((rings[0], front), (rings[-1], back)):
        if isinstance(end, str):
            bm.faces.new(ring)
        elif end is not None:
            S.cap(bm, ring, end)
    return S.finish_bm(name, bm, mat, smooth=smooth, sharp=sharp)


def row_at(rows, y):
    """The loft row at `y`, linearly interpolated (clamped at the ends), which
    is exactly the hull surface of a loft built without resampling."""
    rs = sorted(rows, key=lambda r: r[0])
    if y <= rs[0][0]:
        return tuple(rs[0])
    if y >= rs[-1][0]:
        return tuple(rs[-1])
    for a, b in zip(rs, rs[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return tuple(av + (bv - av) * t for av, bv in zip(a, b))


def offset_polyline(pts, d):
    """Offset an open 2D polyline (in counter-clockwise hull order) outward by
    d, with mitred corners."""
    P = [Vector(p) for p in pts]
    normals = []
    for a, b in zip(P, P[1:]):
        e = (b - a).normalized()
        normals.append(Vector((e.y, -e.x)))
    out = []
    for i, p in enumerate(P):
        if i == 0:
            n, k = normals[0], 1.0
        elif i == len(P) - 1:
            n, k = normals[-1], 1.0
        else:
            n = (normals[i - 1] + normals[i]).normalized()
            k = 1.0 / max(0.35, n.dot(normals[i]))
        out.append(p + n * d * k)
    return out


def trim_polyline(pts, c):
    """Pull both end points of a polyline in along it by c (never past the
    next point)."""
    P = [p.copy() for p in pts]
    for i, j in ((0, 1), (len(P) - 1, len(P) - 2)):
        e = P[j] - P[i]
        P[i] = P[i] + e.normalized() * min(c, e.length * 0.45)
    return P


def shell(name, rows, section, idx, y0, y1, mat, lift=0.05, thick=0.12, bevel=0.08):
    """A conformal armour plate on a lofted hull. It follows the section
    vertices `idx` (a run in counter-clockwise order; indices wrap) from y0
    down to y1, its outer face `lift` proud of the hull and its underside
    `thick` below that, sunk into the hull so the plate never floats. The
    front, rear and side edges are chamfered by `bevel`."""
    lo, hi = min(y0, y1), max(y0, y1)
    inner_ys = {r[0] for r in rows if lo + bevel < r[0] < hi - bevel}
    ys = sorted({hi, hi - bevel, lo + bevel, lo} | inner_ys, reverse=True)
    bm = bmesh.new()
    rings = []
    for y in ys:
        row = row_at(rows, y)
        sec = section(0, *row[1:])
        pts = [Vector(sec[i % len(sec)]) for i in idx]
        end = y in (lo, hi)
        outer = trim_polyline(offset_polyline(pts, lift - (thick * 0.6 if end else 0.0)), bevel)
        inner = offset_polyline(pts, lift - thick)
        ring = [(p.x, y, p.y) for p in outer] + [(p.x, y, p.y) for p in reversed(inner)]
        rings.append([bm.verts.new(v) for v in ring])
    S.ring_faces(bm, rings)
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    return S.finish_bm(name, bm, mat, smooth=False)


def surface_point(rows, section, i, y, out=0.0):
    """Section vertex i of the hull at y (Blender space), pushed `out` along
    the outward vertex normal."""
    row = row_at(rows, y)
    sec = section(0, *row[1:])
    n = len(sec)
    p = Vector(sec[i % n])
    a, b = Vector(sec[(i - 1) % n]), Vector(sec[(i + 1) % n])
    e1, e2 = (p - a).normalized(), (b - p).normalized()
    nrm = (Vector((e1.y, -e1.x)) + Vector((e2.y, -e2.x))).normalized()
    q = p + nrm * out
    return Vector((q.x, y, q.y)), Vector((nrm.x, 0, nrm.y))


def facet_frame(rows, section, i, y, along=(0, 1, 0), t=0.5, out=0.0):
    """A frame on the hull facet between section vertices i and i+1 at y:
    origin on the facet (t of the way from vertex i), Z = the facet's
    outward normal, Y as close to `along` as it can be."""
    row = row_at(rows, y)
    sec = section(0, *row[1:])
    n = len(sec)
    a, b = Vector(sec[i % n]), Vector(sec[(i + 1) % n])
    e = (b - a).normalized()
    nrm = Vector((e.y, -e.x, 0))
    p = a.lerp(b, t)
    z = Vector((nrm.x, 0, nrm.y))
    loc = Vector((p.x, y, p.y)) + z * out
    return frame(loc, z, along)


def frame(loc, up=(0, 0, 1), fwd=(0, 1, 0)):
    """A 4x4 frame at `loc`: Z along `up`, Y as close to `fwd` as it can be."""
    z = Vector(up).normalized()
    y = Vector(fwd)
    y = y - z * y.dot(z)
    if y.length < 1e-6:
        y = Vector((0, 0, 1)) - z * z.z
    y.normalize()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = loc
    return m


def blade(name, spine, chord, thick, mat, side=(1, 0, 0), lead=0.4, sharp=25, tip=True):
    """A curved blade (a tine, a claw, a fin) along a spine polyline, root
    first. At each spine point the section is a flat hexagon: `chord` wide in
    the plane of the spine (the leading edge on side x tangent) and `thick`
    along `side`, its thickest line `lead` of the chord behind the leading
    edge. chord and thick are lists matching the spine. The root is capped
    (bury it in the hull); the last point is the tip."""
    sv = Vector(side).normalized()
    pts = [Vector(p) for p in spine]
    n = len(pts)
    bm = bmesh.new()
    rings = []
    last = n - 1 if tip else n
    for i in range(last):
        p = pts[i]
        tan = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = sv.cross(tan).normalized()
        c, h = chord[i], thick[i]
        f, b = c * lead, c * (1 - lead)
        sec = [p + nrm * f, p + nrm * f * 0.3 + sv * h / 2, p - nrm * b * 0.45 + sv * h / 2,
               p - nrm * b, p - nrm * b * 0.45 - sv * h / 2, p + nrm * f * 0.3 - sv * h / 2]
        rings.append([bm.verts.new(v) for v in sec])
    S.ring_faces(bm, rings)
    bm.faces.new(rings[0][::-1])
    if tip:
        S.cap(bm, rings[-1], pts[-1])
    else:
        bm.faces.new(rings[-1])
    return S.finish_bm(name, bm, mat, smooth=True, sharp=sharp)


def faceted_pod(name, rows, mat, sides=8, phase=None, sharp=20, front=None, back=None):
    """A faceted round body along Y: rows of (y, radius, x, z)."""
    phase = math.pi / sides if phase is None else phase
    bm = bmesh.new()
    rings = []
    for y, r, x, z in rows:
        rings.append([bm.verts.new((x + r * math.cos(2 * math.pi * k / sides + phase), y,
                                    z + r * math.sin(2 * math.pi * k / sides + phase))) for k in range(sides)])
    S.ring_faces(bm, rings)
    for ring, end in ((rings[0], front), (rings[-1], back)):
        if isinstance(end, str):
            bm.faces.new(ring)
        elif end is not None:
            S.cap(bm, ring, end)
    return S.finish_bm(name, bm, mat, smooth=True, sharp=sharp)


def annulus(bm, outer, inner):
    """Fill the ring between two loops around a common centre (both star-
    shaped about it, same winding) with triangles."""
    cx = sum(v.co.x for v in inner) / len(inner)
    cz = sum(v.co.z for v in inner) / len(inner)
    ang = lambda v: math.atan2(v.co.z - cz, v.co.x - cx) % (2 * math.pi)
    o0 = min(range(len(outer)), key=lambda i: ang(outer[i]))
    i0 = min(range(len(inner)), key=lambda i: ang(inner[i]))
    O = outer[o0:] + outer[:o0]
    I = inner[i0:] + inner[:i0]
    O.append(O[0])
    I.append(I[0])
    a, b = 0, 0
    while a < len(O) - 1 or b < len(I) - 1:
        ta = ang(O[a + 1]) if a < len(O) - 1 else 9e9
        tb = ang(I[b + 1]) if b < len(I) - 1 else 9e9
        if a + 1 == len(O) - 1:
            ta = 2 * math.pi
        if b + 1 == len(I) - 1:
            tb = 2 * math.pi
        if (ta <= tb and a < len(O) - 1) or b >= len(I) - 1:
            bm.faces.new((O[a], O[a + 1], I[b]))
            a += 1
        else:
            bm.faces.new((O[a], I[b + 1], I[b]))
            b += 1


def place_rcs(ports, bvh, M, size=0.2, metal='metal', hole='hole'):
    """build_ships.place_rcs with a port size: ports are (name, ray origin,
    ray direction, puff direction); the empty's local +Z is the puff."""
    parts, empties = [], []
    for name, origin, ray, puff in ports:
        loc, m = S.frame_on(bvh, origin, ray)
        d = Vector(puff).normalized()
        if m.col[2].xyz.dot(d) < 0.8:
            m = S.facing(loc + d * 0.03, d)
        parts += S.rcs_block(name + '_block', M[metal], M[hole], m, size=size)
        empties.append(S.empty(name, m.translation + m.col[2].xyz * 0.08, d))
    return parts, empties


def tagged(objs, value):
    """Mark every face of `objs` with an integer face attribute `part`, so a
    joined mesh can be split again after baking."""
    for o in objs:
        attr = o.data.attributes.get('part') or o.data.attributes.new('part', 'INT', 'FACE')
        attr.data.foreach_set('value', [value] * len(o.data.polygons))
    return objs


def split_part(obj, value, name):
    """A copy of `obj` keeping only the faces whose `part` equals value."""
    copy = C.duplicate(obj, name)
    bm = bmesh.new()
    bm.from_mesh(copy.data)
    layer = bm.faces.layers.int.get('part')
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != value], context='FACES')
    bm.to_mesh(copy.data)
    bm.free()
    copy.data.attributes.remove(copy.data.attributes['part'])
    return copy


# ==========================================================================
# Paint

def finish(g, base, rough, metal, P, N, s=1.0, wear=1.0, grime=1.0, lines=True, glow=None,
           panel=(1.3, 0.55), mortar=0.011, plates=None, grain=True, line_dark=0.6):
    """build_ships.weathered with every length scaled by `s` (panel size,
    noise features, AO reach, edge-wear radius and bump depth), so the same
    finish reads on a drone and a gunship. `plates` = (scale, (width,
    height), mortar) adds a second, larger layer of plate seams for the
    capital ships, so they show detail at two scales."""
    Q = g.vmath('SCALE', P, scale=1.0 / s)
    height = 0.0
    if lines:
        mask, tint = S.panel_lines(g, Q, N, 1.0, mortar, panel)
        base = g.mix(1.0, base, g.combine(tint, tint, tint), 'MULTIPLY')
        base = g.mix(g.mul(mask, line_dark), base, (0.008, 0.008, 0.009))
        rough = g.mixf(g.mul(mask, 0.5), rough, 0.7)
        height = g.mul(mask, -0.0018 * s)
    if plates:
        ps, ppanel, pmortar = plates
        Q2 = g.vmath('SCALE', P, scale=1.0 / ps)
        mask2, tint2 = S.panel_lines(g, Q2, N, 1.0, pmortar, ppanel)
        t2 = g.add(g.mul(g.sub(tint2, 1.0), 1.6), 1.0)
        base = g.mix(1.0, base, g.combine(t2, t2, t2), 'MULTIPLY')
        base = g.mix(g.mul(mask2, 0.8), base, (0.006, 0.006, 0.007))
        rough = g.mixf(g.mul(mask2, 0.5), rough, 0.75)
        height = g.add(height, g.mul(mask2, -0.0016 * ps))
    ao = g.node('ShaderNodeAmbientOcclusion', [None, 0.45 * s], samples=6, only_local=False).outputs['AO']
    streak = g.smooth(g.noise(g.vmath('MULTIPLY', Q, (7.0, 0.35, 7.0)), 1.0, 4.0, 0.6), 0.5, 0.8)
    dirt = g.add(g.mul(g.sub(1.0, ao), 0.85), g.mul(streak, 0.25))
    dirt = g.mul(g.minimum(dirt, 1.0), grime)
    base = g.mix(g.mul(dirt, 0.7), base, (0.035, 0.03, 0.026), 'MULTIPLY')
    rough = g.mixf(g.mul(dirt, 0.5), rough, 0.62)
    bev = g.node('ShaderNodeBevel', [0.03 * s], samples=4).outputs[0]
    edge = g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1))
    patches = g.smooth(g.noise(Q, 2.2, 3.0, 0.5), 0.5, 0.62)
    chips = g.mul(g.mul(g.smooth(edge, 0.02, 0.08), patches), g.smooth(g.noise(Q, 14.0, 4.0, 0.6), 0.4, 0.55))
    scratches = g.mul(g.smooth(g.noise(g.vmath('MULTIPLY', Q, (1.0, 14.0, 1.0)), 6.0, 3.0, 0.5), 0.74, 0.8),
                      g.smooth(g.noise(Q, 2.5, 2.0), 0.55, 0.7))
    worn = g.mul(g.maximum(chips, g.mul(scratches, 0.6)), wear)
    base = g.mix(worn, base, S.BARE)
    rough = g.mixf(worn, rough, 0.35)
    metal = g.mixf(worn, metal, 0.6)
    # (the wear stays out of the bump: the normal bake then never has to
    # evaluate the Bevel node, which is most of its cost)
    height = g.add(height, g.mul(scratches, -0.0003 * s))
    if grain:
        height = g.add(height, g.mul(g.noise(Q, 60.0, 3.0, 0.5), 0.00015 * s))
    return dict(albedo=base, rough=rough, metal=metal, normal=g.bump(height, 1.0, 1.0), glow=glow)


def eye_material(name, centre, axis, depth, iris, pupil, rim=None):
    """A machine eye: a dark red lens whose glow rises from a faint rim
    through a hot red iris ring to an orange-white core. `depth` is how far
    the lens dome stands along `axis` from `centre`; iris and pupil are radii
    on the dome."""
    tip = Vector(centre) + Vector(axis).normalized() * depth
    rim = rim if rim is not None else iris * 1.6

    def build(g, P, N):
        d = g.vmath('DISTANCE', P, tuple(tip), out=1)
        outer = g.smooth(d, rim, iris * 0.95)
        ring = g.mul(g.smooth(d, iris * 1.05, iris * 0.9), g.smooth(d, iris * 0.55, iris * 0.75))
        core = g.smooth(d, pupil, pupil * 0.35)
        glow = g.mix(outer, (0.05, 0.002, 0.001), (0.55, 0.015, 0.006))
        glow = g.mix(g.smooth(d, iris * 0.95, iris * 0.6), glow, (1.0, 0.05, 0.015))
        glow = g.mix(g.mul(ring, 0.6), glow, (1.0, 0.16, 0.05))
        glow = g.mix(core, glow, (1.0, 0.55, 0.3))
        return dict(albedo=(0.05, 0.004, 0.003), rough=0.08, metal=0.0, glow=glow)
    return S.material(name, build)


def nozzle_material(name, cx, cz, s):
    """build_ships.nozzle_material for a nozzle of any size: heat-tinted bare
    metal outside, soot inside the bell. Inside is told by the normal, which
    faces the axis (x = cx, z = cz) there, so it works at any scale."""
    def build(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        rx, rz = g.sub(x, cx), g.sub(z, cz)
        rl = g.maximum(g.vmath('LENGTH', g.combine(rx, 0.0, rz), out=1), 1e-4)
        facing = g.math('DIVIDE', g.add(g.mul(nx, rx), g.mul(nz, rz)), rl)
        inner = g.smooth(facing, 0.1, -0.25)
        Q = g.vmath('SCALE', P, scale=1.0 / s)
        tint = g.ramp(g.noise(Q, 2.0, 3.0), [(0.3, (0.16, 0.13, 0.1)), (0.55, (0.11, 0.11, 0.15)),
                                             (0.8, (0.2, 0.15, 0.1))])
        col = g.mix(inner, tint, S.SOOT)
        return finish(g, col, g.mixf(inner, 0.36, 0.6), g.mixf(inner, 0.6, 0.2), P, N, s=s, wear=0.0,
                      lines=False, grime=0.6, grain=False)
    return S.material(name, build)


def harrow_finish(g, col, rough, metal, P, N, s, **kw):
    kw.setdefault('panel', (1.1, 0.42))
    return finish(g, col, rough, metal, P, N, s=s, **kw)


# ==========================================================================
# Turrets

YZ = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # prism (x, y, thickness) -> (y, z, x)


def harrow_turret(M, scale=1.0):
    """A Harrow turret, origin at the yaw pivot on the hull, up +Z, barrels
    along +Y: a low faceted hexagonal house (a corner forward) with oxblood
    cheek plates and a red sensor eye, and a gun of two prong rails around a
    glowing plasma channel. Returns (base parts, gun parts with the trunnion
    at their origin, trunnion offset, size, muzzle point in the gun's frame)."""
    k = scale
    base = []
    house = S.lathe('t_house', [(0.0, 0.0), (0.0, 3.0 * k), (0.55 * k, 3.0 * k), (1.35 * k, 2.55 * k),
                                (1.9 * k, 1.7 * k), (2.05 * k, 0.0)], 6, (0, 0), M['body'],
                    smooth=True, sharp=20, phase=math.pi / 6)
    base.append(S.transformed(house, Matrix.Rotation(math.radians(90), 4, 'X')))
    for sx in (1, -1):
        base.append(S.box('t_cheek', (0.24 * k, 2.8 * k, 1.0 * k), M['armour'],
                          Matrix.Translation((sx * 2.42 * k, -0.15 * k, 0.88 * k))
                          @ Matrix.Rotation(math.radians(-sx * 26), 4, 'Y'), taper=0.86))
    sensor = S.lathe('t_sensor', [(-0.25 * k, 0.0), (-0.25 * k, 0.4 * k), (0.06 * k, 0.36 * k), (0.16 * k, 0.0)], 6,
                     (0, 0), M['t_eye'], smooth=False)
    base.append(S.transformed(sensor, Matrix.Translation((0, 2.6 * k, 1.0 * k))))
    # a turned skirt round the foot, heat-sink fins at the back, a sensor spine
    skirt = S.lathe('t_skirt', [(-0.1 * k, 0.0), (-0.1 * k, 3.18 * k), (0.3 * k, 3.18 * k), (0.38 * k, 0.0)], 12,
                    (0, 0), M['metal'], smooth=True, sharp=30)
    base.append(S.transformed(skirt, Matrix.Rotation(math.radians(90), 4, 'X')))
    for dx in (-0.55, 0.0, 0.55):
        base.append(S.box('t_sink', (0.16 * k, 1.1 * k, 0.95 * k), M['metal'],
                          Matrix.Translation((dx * k, -2.15 * k, 1.05 * k)), taper=0.8))
    spine = S.lathe('t_spine', [(-0.3 * k, 0.0), (-0.3 * k, 0.07 * k), (1.6 * k, 0.025 * k), (1.7 * k, 0.0)], 5,
                    (0, 0), M['metal'], smooth=False)
    base.append(S.transformed(spine, Matrix.Translation((0.75 * k, -1.0 * k, 1.75 * k))
                              @ Matrix.Rotation(math.radians(125), 4, 'X')))
    tz = 1.45 * k
    gun = [S.box('t_mantlet', (1.9 * k, 1.7 * k, 1.25 * k), M['metal'], Matrix.Translation((0, 0.2 * k, 0)), taper=0.85)]
    for sx in (1, -1):
        gun.append(S.prism('t_rail', [(-0.5 * k, -0.45 * k), (6.4 * k, -0.32 * k), (7.1 * k, 0.04 * k),
                                      (6.5 * k, 0.34 * k), (-0.5 * k, 0.45 * k)], 0.26 * k, M['armour'],
                           Matrix.Translation((sx * 0.5 * k, 0, 0)) @ YZ))
    gun.append(S.lathe('t_core', [(0.6 * k, 0.0), (0.6 * k, 0.16 * k), (5.8 * k, 0.11 * k), (5.9 * k, 0.0)], 6, (0, 0),
                       M['glow_red'], smooth=False))
    # cross-braces tying the rails together, a glowing coil round the channel
    for yy in (3.0, 5.0):
        gun.append(S.box('t_brace', (1.2 * k, 0.32 * k, 0.16 * k), M['metal'],
                         Matrix.Translation((0, yy * k, 0.36 * k))))
    gun.append(S.lathe('t_coil', [(1.05 * k, 0.0), (1.05 * k, 0.3 * k), (1.45 * k, 0.3 * k), (1.45 * k, 0.0)], 8,
                       (0, 0), M['glow_red'], smooth=False, phase=math.pi / 8))
    return base, gun, Vector((0, 0, tz)), 3.0 * k, Vector((0, 7.0 * k, 0))


def watch_turret(M, scale=1.0):
    """A Belt Watch twin turret, origin at the yaw pivot on its barbette, up
    +Z, barrels along +Y: a chamfered gun house with a sloped glacis, a
    rangefinder pod and a turned base ring, and twin barrels with muzzle
    brakes in a mantlet. Returns (base parts, gun parts at the trunnion
    origin, trunnion offset, size, muzzle point in the gun's frame)."""
    k = scale
    sec = polygon([(1.0, 0.25), (0.78, 1.0), (-0.78, 1.0), (-1.0, 0.25), (-1.0, -1.0), (1.0, -1.0)])
    rows = [(3.4 * k, 2.4 * k, 0.55 * k, 0.6 * k, 1.05 * k),
            (2.2 * k, 2.9 * k, 1.35 * k, 0.6 * k, 1.05 * k),
            (-2.4 * k, 3.0 * k, 1.45 * k, 0.6 * k, 1.05 * k),
            (-3.6 * k, 2.6 * k, 1.3 * k, 0.6 * k, 1.05 * k)]
    base = [loft('t_house', rows, M['turret'], sec, front='cap', back='cap', smooth=False)]
    base.append(S.lathe('t_ring', [(0.0, 0.0), (0.0, 3.15 * k), (0.55 * k, 3.15 * k), (0.62 * k, 0.0)], 14, (0, 0),
                        M['metal'], smooth=True, sharp=30))
    S.transformed(base[-1], Matrix.Rotation(math.radians(90), 4, 'X'))
    base.append(S.box('t_finder', (4.2 * k, 0.8 * k, 0.6 * k), M['metal'],
                      Matrix.Translation((0, -1.2 * k, 2.75 * k)), taper=0.85))
    base.append(S.box('t_hatch', (1.0 * k, 1.1 * k, 0.25 * k), M['turret'],
                      Matrix.Translation((1.2 * k, -2.3 * k, 2.55 * k)), taper=0.8))
    cupola = S.lathe('t_cupola', [(-0.2 * k, 0.0), (-0.2 * k, 0.5 * k), (0.25 * k, 0.46 * k), (0.42 * k, 0.24 * k),
                                  (0.47 * k, 0.0)], 6, (0, 0), M['metal'], smooth=True, sharp=40)
    base.append(S.transformed(cupola, Matrix.Translation((-1.3 * k, -0.7 * k, 2.45 * k))
                              @ Matrix.Rotation(math.radians(90), 4, 'X')))
    tz = 1.4 * k
    gun = [S.box('t_mantlet', (2.9 * k, 1.0 * k, 1.3 * k), M['metal'], Matrix.Translation((0, 2.9 * k, 0)), taper=0.9)]
    for sx in (1, -1):
        gun.append(S.lathe('t_barrel', [(2.8 * k, 0.0), (2.8 * k, 0.34 * k), (4.4 * k, 0.3 * k), (8.4 * k, 0.24 * k),
                                        (8.45 * k, 0.36 * k), (9.4 * k, 0.36 * k), (9.45 * k, 0.0)], 8,
                           (sx * 0.8 * k, 0.0), M['barrel'], smooth=True, sharp=40))
    return base, gun, Vector((0, 0, tz)), 3.2 * k, Vector((0, 9.45 * k, 0))


def bake_turret(name, base_parts, gun_parts, T, tex, bevel):
    """Join and bake one turret (house plus gun at its trunnion) into a small
    texture set, then split it back into two meshes: the house with its
    origin at the yaw pivot and the gun with its origin at the trunnion.
    Returns (house mesh, gun mesh)."""
    for o in gun_parts:
        S.transformed(o, Matrix.Translation(T))
    if os.environ.get('METEORA_CHECK'):
        for group in floating(base_parts + gun_parts):
            C.log(f'  FLOATING in {name}: {group}')
        for part, holes, vol in open_or_inverted(base_parts + gun_parts):
            C.log(f'  OPEN OR INVERTED in {name}: {part} ({holes} open edges, volume {vol})')
    house = C.join(tagged(base_parts, 0), name + '_house_tmp')
    gun = C.join(tagged(gun_parts, 1), name + '_gun_tmp')
    proto = C.join([house, gun], name + '_proto')
    bake_object(proto, name, (tex, tex, tex, tex), bevel=bevel, sharp=40, samples=12, uv_margin=0.006,
                uv_shape='AABB')
    hb = split_part(proto, 0, name)
    gb = split_part(proto, 1, name + '_gun')
    gb.data.transform(Matrix.Translation(-T))
    meshes = hb.data, gb.data
    for o in (proto, hb, gb):
        bpy.data.objects.remove(o)
    return meshes


def place_turrets(meshes, T, frames, muzzle):
    """Turret nodes: `turret_NN` (house, origin at the yaw pivot, local +Z up
    out of the hull, +Y the barrels' rest direction) with a child
    `turret_NN_gun` (origin at the trunnion), which carries an empty
    `turret_NN_muzzle` at the barrels' tip. Every turret shares the two
    meshes. Returns [(house, gun, muzzle)]."""
    house, gun = meshes
    out = []
    for i, m in enumerate(frames):
        b = C.link(bpy.data.objects.new(f'turret_{i:02d}', house))
        b.matrix_world = m
        g = C.link(bpy.data.objects.new(f'turret_{i:02d}_gun', gun))
        g.parent = b
        g.matrix_parent_inverse = Matrix()
        g.location = T
        e = marker(f'turret_{i:02d}_muzzle', muzzle, size=0.6)
        e.parent = g
        e.matrix_parent_inverse = Matrix()
        out.append((b, g, e))
    bpy.context.view_layer.update()
    return out


def floating(parts):
    """Names of parts not connected to the main body: parts are linked when
    their surfaces intersect, and every group of linked parts other than the
    largest is reported (a debugging aid: METEORA_CHECK=1)."""
    trees = [S.bvh_of([o]) for o in parts]
    root = list(range(len(parts)))

    def find(i):
        while root[i] != i:
            root[i] = root[root[i]]
            i = root[i]
        return i
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            if find(i) != find(j) and trees[i].overlap(trees[j]):
                root[find(i)] = find(j)
    groups = {}
    for i in range(len(parts)):
        groups.setdefault(find(i), []).append(parts[i].name)
    main = max(groups.values(), key=len)
    return [g for g in groups.values() if g is not main]


def open_or_inverted(parts):
    """Parts with open edges (holes) or with a negative signed volume
    (normals facing in): another debugging aid for METEORA_CHECK=1."""
    bad = []
    for o in parts:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        holes = sum(1 for e in bm.edges if len(e.link_faces) != 2)
        vol = bm.calc_volume(signed=True)
        bm.free()
        if holes or vol <= 0:
            bad.append((o.name, holes, round(vol, 4)))
    return bad


# ==========================================================================
# Bakes

def unwrap(obj, angle=60.0, margin=0.003, shape='CONCAVE'):
    """common.smart_uv with a choice of island shape for the packer: the
    concave packer can take minutes on a small mesh of long thin islands (a
    turret's barrels), where bounding boxes pack in a millisecond."""
    C.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.6,
                             correct_aspect=True)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method=shape, margin_method='FRACTION',
                            margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_object(obj, name, sizes, bevel, sharp=42, samples=16, uv_angle=60.0, uv_margin=0.003, uv_shape='CONCAVE'):
    """Unwrap, triangulate and bake `obj`'s procedural paint into a baked
    material, as build_ships.bake_ship does for a hull: normals
    selected-to-active from a copy bevelled `bevel` metres wide, then base
    colour, roughness, metallic and emission. sizes = (base, normal,
    metallic-roughness, emissive) in pixels."""
    tu = time.time()
    unwrap(obj, angle=uv_angle, margin=uv_margin, shape=uv_shape)
    C.triangulate(obj)
    obj.data.set_sharp_from_angle(angle=math.radians(sharp))
    C.log(f'  unwrap {name}: {time.time() - tu:.0f} s')
    if FAST:
        sizes = tuple(min(v, 256) for v in sizes)
    sb, sn, sm, se = sizes
    base = C.new_image(name + '_base', sb)
    nrm = C.new_image(name + '_normal', sn, non_color=True)
    rough = C.new_image(name + '_rough', sm, non_color=True)
    metal = C.new_image(name + '_metal', sm, non_color=True)
    glow = C.new_image(name + '_emissive', se)
    high = C.duplicate(obj, name + '_high')
    bev = high.modifiers.new('bevel', 'BEVEL')
    bev.width = bevel
    bev.segments = 3
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(40)
    C.apply_modifiers(high)
    high.data.shade_smooth()
    m = lambda size: max(2, size // 256)
    t0 = time.time()
    C.bake(obj, nrm, 'NORMAL', sources=[high], extrusion=bevel * 0.75, max_ray=bevel * 2.0, margin=m(sn),
           samples=1 if FAST else 4)
    bpy.data.objects.remove(high)
    t1 = time.time()
    s = 1 if FAST else samples
    C.bake(obj, base, channel='albedo', margin=m(sb), samples=s)
    t2 = time.time()
    C.bake(obj, rough, channel='rough', margin=m(sm), samples=max(1, s // 2))
    C.bake(obj, metal, channel='metal', margin=m(sm), samples=max(1, s // 2))
    t3 = time.time()
    C.bake(obj, glow, channel='glow', margin=m(se), samples=1)
    C.log(f'  bake {name}: normal {t1 - t0:.0f} s, albedo {t2 - t1:.0f} s, rough+metal {t3 - t2:.0f} s, '
          f'glow {time.time() - t3:.0f} s')
    tp = time.time()
    mr = C.pack_mr(name + '_mr', rough, metal)
    C.log(f'  pack {name}: {time.time() - tp:.0f} s')
    dump = os.environ.get('METEORA_DUMP')
    if dump:
        for img in (base, nrm, mr, glow):
            copy = img.copy()
            copy.filepath_raw = os.path.join(dump, img.name + '.png')
            copy.file_format = 'PNG'
            copy.save()
            bpy.data.images.remove(copy)
    mat = C.baked_material(name, base, nrm, mr, glow)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.data.polygons.foreach_set('material_index', [0] * len(obj.data.polygons))
    return mat


# ==========================================================================
# Compound colliders

def world_copy(objects, name):
    """One mesh object holding every object's world-space geometry."""
    bpy.context.view_layer.update()
    copies = []
    for o in objects:
        c = o.copy()
        c.data = o.data.copy()
        C.link(c)
        c.parent = None
        c.data.transform(o.matrix_world)
        c.matrix_world = Matrix()
        copies.append(c)
    return C.join(copies, name)


def fit_colliders(objects, voxel, step, r_min, grow, max_count, coverage=0.985, tol=None, sample=None, seeds=()):
    """Collision spheres that hug a hull. The union of `objects` is voxel-
    remeshed into one watertight surface; grid points inside it become
    candidate centres, each with the largest sphere that fits (its distance
    to the surface) grown by `grow`, so no sphere stands more than `grow`
    proud of the hull. Spheres are then picked greedily, each covering the
    most still-uncovered surface samples, until `coverage` of the surface is
    covered or `max_count` spheres are used. `seeds` are spheres placed by
    hand first (blades thinner than r_min, which the grid cannot reach).
    Returns ([(centre, radius)], covered fraction)."""
    tol = tol if tol is not None else voxel * 0.6
    sample = sample if sample is not None else step
    u = world_copy(objects, 'union_tmp')
    mod = u.modifiers.new('remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    mod.adaptivity = 0.0
    C.apply_modifiers(u)
    bm = bmesh.new()
    bm.from_mesh(u.data)
    bm.normal_update()
    bvh = BVHTree.FromBMesh(bm)
    verts = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    bm.free()
    bpy.data.objects.remove(u)
    lo, hi = verts.min(0), verts.max(0)
    # surface samples: one remeshed vertex per `sample` cell
    cells = np.floor((verts - lo) / sample).astype(np.int64)
    _, first = np.unique(cells, axis=0, return_index=True)
    samples = verts[np.sort(first)]
    # candidate centres: grid points inside the hull (by ray parity on the
    # watertight remesh, two of three skewed rays), at least r_min deep
    rays = [Vector(d).normalized() for d in ((1, 0.013, 0.007), (0.011, 1, -0.017), (-0.009, 0.015, 1))]

    def inside(p):
        votes = 0
        for d in rays:
            o, n = p.copy(), 0
            while n < 64:
                loc, _, _, _ = bvh.ray_cast(o, d)
                if loc is None:
                    break
                n += 1
                o = loc + d * 1e-3
            votes += n % 2
        return votes >= 2

    axes = [np.arange(lo[i] + step / 2, hi[i], step) for i in range(3)]
    cand, rad = [], []
    for x in axes[0]:
        for y in axes[1]:
            for z in axes[2]:
                p = Vector((x, y, z))
                loc, nrm, _, dist = bvh.find_nearest(p)
                if loc is None or dist < r_min or not inside(p):
                    continue
                cand.append((x, y, z))
                rad.append(dist + grow)
    cand = np.array(cand)
    rad = np.array(rad)
    # coverage of each candidate, in chunks
    cover = []
    s2 = (samples ** 2).sum(1)
    for i in range(0, len(cand), 512):
        c = cand[i:i + 512]
        d2 = (c ** 2).sum(1)[:, None] + s2[None, :] - 2.0 * c @ samples.T
        hit = d2 <= (rad[i:i + 512, None] + tol) ** 2
        cover.extend(np.nonzero(row)[0] for row in hit)
    uncovered = np.ones(len(samples), bool)
    for c, r in seeds:
        d2 = ((samples - np.array(c[:])) ** 2).sum(1)
        uncovered[d2 <= (r + tol) ** 2] = False
    heap = [(-len(cv), i) for i, cv in enumerate(cover)]
    heapq.heapify(heap)
    chosen = []
    while heap and len(chosen) + len(seeds) < max_count and uncovered.mean() > 1.0 - coverage:
        _, i = heapq.heappop(heap)
        gain = int(uncovered[cover[i]].sum())
        if gain == 0:
            continue
        if heap and gain < -heap[0][0]:
            heapq.heappush(heap, (-gain, i))
            continue
        chosen.append(i)
        uncovered[cover[i]] = False
    C.log(f'  colliders: {len(seeds)} seeded + {len(chosen)} fitted spheres ({len(cand)} candidates); '
          f'{100 * (1 - uncovered.mean()):.1f}% of {len(samples)} surface samples lie within {tol:g} m of one')
    spheres = [(Vector(c), float(r)) for c, r in seeds] + [(Vector(cand[i]), float(rad[i])) for i in chosen]
    return spheres, 1.0 - uncovered.mean()


# ==========================================================================
# Anchors

def marker(name, loc, scale=None, minus_y=None, z_dir=None, display='ARROWS', size=0.3):
    """An anchor empty. `minus_y` aims its local -Y (nozzles, bays), `z_dir`
    its local +Z (RCS puffs); `scale` is a uniform scale (a collider's or a
    subsystem's radius, drawn as a sphere)."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = display
    e.empty_display_size = size
    e.location = loc
    if minus_y is not None:
        d = Vector(minus_y).normalized()
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = (-d).to_track_quat('Y', 'Z' if abs(d.z) < 0.9 else 'X')
    if z_dir is not None:
        d = Vector(z_dir).normalized()
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = d.to_track_quat('Z', 'Y' if abs(d.y) < 0.9 else 'X')
    if scale is not None:
        e.scale = (scale, scale, scale)
    return C.link(e)


def _r(v, n=3):
    return [round(x, n) + 0.0 for x in v]


def gltf_pos(m):
    return _r(C.to_gltf(m.translation))


def gltf_dir(m, local):
    return _r(C.to_gltf((m.to_3x3() @ Vector(local)).normalized()), 4)


def anchors_of(meshes, empties, turrets, nozzle_size, lights, nodes=None):
    """The anchors module's data, in glTF space, from the exported objects.
    `turrets` is [(house object, size)]; `nozzle_size` and `lights` map an
    empty's name to its exit radius or to (colour, blink period)."""
    bpy.context.view_layer.update()
    pts = []
    for o in meshes:
        mw = o.matrix_world
        pts.extend(mw @ v.co for v in o.data.vertices)
    radius = max(p.length for p in pts)
    length = max(p.y for p in pts) - min(p.y for p in pts)
    by = lambda prefix: sorted((e for e in empties if e.name.startswith(prefix)), key=lambda e: e.name)
    one = lambda name: next((gltf_pos(e.matrix_world) for e in empties if e.name == name), None)
    subs = []
    for e in by('sub_'):
        parts = e.name.split('_')
        kind = parts[1]
        subs.append(dict(name=e.name, kind=kind, pos=gltf_pos(e.matrix_world),
                         r=round(e.matrix_world.to_scale()[0], 2)))
    return dict(
        radius=round(radius, 2), length=round(length, 2),
        nozzles=[dict(name=e.name, pos=gltf_pos(e.matrix_world), dir=gltf_dir(e.matrix_world, (0, -1, 0)),
                      size=nozzle_size[e.name]) for e in by('nozzle_')],
        muzzles=[dict(name=e.name, pos=gltf_pos(e.matrix_world)) for e in by('muzzle_')],
        rcs=[dict(name=e.name, pos=gltf_pos(e.matrix_world), dir=gltf_dir(e.matrix_world, (0, 0, 1)))
             for e in by('rcs_')],
        launchers=[dict(name=e.name, pos=gltf_pos(e.matrix_world)) for e in by('launcher_')],
        cockpit=one('cam_cockpit'), dock=one('dock'),
        colliders=[dict(pos=gltf_pos(e.matrix_world), r=round(e.matrix_world.to_scale()[0], 2)) for e in by('col_')],
        subsystems=subs,
        turrets=[dict(name=b.name, pos=gltf_pos(b.matrix_world), up=gltf_dir(b.matrix_world, (0, 0, 1)),
                      fwd=gltf_dir(b.matrix_world, (0, 1, 0)), size=size) for b, size in turrets],
        bays=[dict(name=e.name, pos=gltf_pos(e.matrix_world), dir=gltf_dir(e.matrix_world, (0, -1, 0)))
              for e in by('bay_')],
        lights=[dict(name=e.name, pos=gltf_pos(e.matrix_world), color=list(lights[e.name][0]), blink=lights[e.name][1])
                for e in by('light_')],
        nodes=dict(nodes or {}),
    )


def _v(v):
    return '[' + ', '.join(f'{x:g}' for x in v) + ']'


def write_anchors(name, a):
    """js/anchors/<name>.js in the shape the models brief fixes: every list
    present, empty when unused."""
    L = [f'/* Meteora — {name} anchors. GENERATED by tools/blender/build_fleet.py from',
         f'   the empties in {name}.glb; do not edit by hand. glTF space, metres: nose',
         '   along -Z, top +Y, right +X. */',
         'export default {',
         f"  radius: {a['radius']:g},",
         f"  length: {a['length']:g},"]

    def block(key, items, fmt):
        if not items:
            L.append(f'  {key}: [],')
            return
        L.append(f'  {key}: [')
        L.extend(f'    {{ {fmt(it)} }},' for it in items)
        L.append('  ],')

    block('nozzles', a['nozzles'],
          lambda n: f"name: '{n['name']}', pos: {_v(n['pos'])}, dir: {_v(n['dir'])}, size: {n['size']:g}")
    block('muzzles', a['muzzles'], lambda n: f"name: '{n['name']}', pos: {_v(n['pos'])}")
    block('rcs', a['rcs'], lambda n: f"name: '{n['name']}', pos: {_v(n['pos'])}, dir: {_v(n['dir'])}")
    block('launchers', a['launchers'], lambda n: f"name: '{n['name']}', pos: {_v(n['pos'])}")
    L.append(f"  cockpit: {_v(a['cockpit']) if a['cockpit'] else 'null'},")
    L.append(f"  dock: {_v(a['dock']) if a['dock'] else 'null'},")
    block('colliders', a['colliders'], lambda c: f"pos: {_v(c['pos'])}, r: {c['r']:g}")
    block('subsystems', a['subsystems'],
          lambda s: f"name: '{s['name']}', kind: '{s['kind']}', pos: {_v(s['pos'])}, r: {s['r']:g}")
    block('turrets', a['turrets'], lambda t: f"name: '{t['name']}', pos: {_v(t['pos'])}, up: {_v(t['up'])}, "
                                             f"fwd: {_v(t['fwd'])}, size: {t['size']:g}")
    block('bays', a['bays'], lambda b: f"name: '{b['name']}', pos: {_v(b['pos'])}, dir: {_v(b['dir'])}")
    block('lights', a['lights'], lambda l: f"name: '{l['name']}', pos: {_v(l['pos'])}, color: {_v(l['color'])}, "
                                           f"blink: {l['blink']:g}")
    nodes = a['nodes']
    L.append('  nodes: {' + (' ' + ', '.join(f"{k}: '{v}'" for k, v in nodes.items()) + ' ' if nodes else '') + '},')
    L.append('};')
    path = os.path.join(C.JS, 'anchors', name + '.js')
    with open(path, 'w') as f:
        f.write('\n'.join(L) + '\n')
    C.log('wrote', os.path.relpath(path, C.ROOT))
