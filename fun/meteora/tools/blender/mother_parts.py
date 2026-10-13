"""Meteora — parts and paint for the Harrow Mother (used by build_mother.py).

Geometry on top of build_ships.py: lofts through arbitrary rings, convex
greeble blocks with open bottoms (they sit on the hull, so the hidden face
would only waste texture space and vertices), polygonal tubes and closed
hoops, harrow tines, and a Batch that collects many small parts per
material into one object.

Paint: the Harrow finish of build_ships.weathered re-scaled for an 800 m
hull. Two scales of tri-planar plating (big plates about 34 x 14 m, small
panels about 8 x 3.4 m) with per-plate tint and random proud or sunken
panels, low-frequency mottling, AO grime, long streaks running aft, chipped
edges and a bevelled normal, so a bake at roughly 0.3 m per texel still
carries layered plates and rounded edges.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
import common as C
import build_ships as S


# ==========================================================================
# Geometry

def solid(name, bm, mat, sharp=28.0, recalc=True):
    """bmesh -> object: merge doubles, turn normals outward (closed shells
    only), mark edges sharper than `sharp` degrees, assign the material."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.object_from_bmesh(name, bm, smooth=True)
    ob.data.set_sharp_from_angle(angle=math.radians(sharp))
    if mat is not None:
        ob.data.materials.append(mat)
    return ob


def loft(name, rings, mat, caps=(True, True), sharp=28.0):
    """A closed solid through `rings` (lists of 3D points, equal length)."""
    bm = bmesh.new()
    vr = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    S.ring_faces(bm, vr)
    if caps[0]:
        bm.faces.new(vr[0][::-1])
    if caps[1]:
        bm.faces.new(vr[-1])
    return solid(name, bm, mat, sharp)


def orient(face, inside):
    """Turn `face` so its normal points away from the point `inside`."""
    face.normal_update()
    if face.normal.dot(face.calc_center_median() - Vector(inside)) < 0:
        face.normal_flip()
    return face


def add_convex(bm, pts, faces, inside=None):
    """A convex polyhedron (or open convex shell) into `bm`; every face is
    turned away from the centroid (or `inside`)."""
    vs = [bm.verts.new(Vector(p)) for p in pts]
    c = Vector(inside) if inside is not None else sum((Vector(p) for p in pts), Vector()) / len(pts)
    return [orient(bm.faces.new([vs[i] for i in f]), c) for f in faces]


def block(bm, m, sx, sy, sz, taper=1.0, sink=0.6, open_bottom=True):
    """A box standing on the surface frame `m` (local Z = surface normal):
    footprint sx by sy, sz tall, top shrunk by `taper`; its base sinks
    `sink` below the surface so it meets curved plating without a gap."""
    hx, hy, tx, ty = sx / 2, sy / 2, sx / 2 * taper, sy / 2 * taper
    lo = [(-hx, -hy, -sink), (hx, -hy, -sink), (hx, hy, -sink), (-hx, hy, -sink)]
    hi = [(-tx, -ty, sz), (tx, -ty, sz), (tx, ty, sz), (-tx, ty, sz)]
    faces = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    if not open_bottom:
        faces.append((3, 2, 1, 0))
    return add_convex(bm, [m @ Vector(p) for p in lo + hi], faces, inside=m @ Vector((0, 0, sz * 0.4 - sink)))


def cblock(bm, m, sx, sy, sz, c, taper=1.0, sink=0.6):
    """A block with chamfered top edges (catches the light on big parts)."""
    hx, hy = sx / 2, sy / 2
    mx, my = hx * taper, hy * taper
    c = min(c, mx * 0.45, my * 0.45, sz * 0.6)
    lo = [(-hx, -hy, -sink), (hx, -hy, -sink), (hx, hy, -sink), (-hx, hy, -sink)]
    mid = [(-mx, -my, sz - c), (mx, -my, sz - c), (mx, my, sz - c), (-mx, my, sz - c)]
    top = [(-mx + c, -my + c, sz), (mx - c, -my + c, sz), (mx - c, my - c, sz), (-mx + c, my - c, sz)]
    faces = [(8, 9, 10, 11)]
    faces += [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)]
    faces += [(i + 4, (i + 1) % 4 + 4, (i + 1) % 4 + 8, i + 8) for i in range(4)]
    return add_convex(bm, [m @ Vector(p) for p in lo + mid + top], faces, inside=m @ Vector((0, 0, sz * 0.4 - sink)))


def wedge(bm, m, sx, sy, sz, sink=0.6):
    """A ramp-shaped block: full height at the back (-Y), sloping to the
    surface at the front (+Y), so it reads as an armour wedge or fairing."""
    hx, hy = sx / 2, sy / 2
    pts = [(-hx, -hy, -sink), (hx, -hy, -sink), (hx, hy, -sink), (-hx, hy, -sink),
           (-hx * 0.9, -hy, sz), (hx * 0.9, -hy, sz), (hx * 0.7, hy * 0.2, sz * 0.45), (-hx * 0.7, hy * 0.2, sz * 0.45)]
    faces = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return add_convex(bm, [m @ Vector(p) for p in pts], faces, inside=m @ Vector((0, -hy * 0.3, sz * 0.25)))


def octa(bm, centre, r):
    """A small octahedron (light pods, rivet heads)."""
    c = Vector(centre)
    pts = [c + Vector(d) * r for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
    faces = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    return add_convex(bm, pts, faces, inside=c)


def uv_sphere(bm, centre, r, segments=24, rings=12, rotation=None):
    """A UV sphere into `bm`, poles on the local Z axis (turned by the 3x3
    `rotation`), faces outward. bmesh.ops.create_uvsphere orders its faces
    differently in every Blender 5.3 process, which would make the build
    (the eye, and the hull carved by the eye socket) differ run to run."""
    c = Vector(centre)
    rot = rotation if rotation is not None else Matrix.Identity(3)
    at = lambda v: bm.verts.new(c + rot @ v)
    top, bottom = at(Vector((0, 0, r))), at(Vector((0, 0, -r)))
    rows = []
    for i in range(1, rings):
        th = math.pi * i / rings
        z, w = math.cos(th) * r, math.sin(th) * r
        rows.append([at(Vector((w * math.cos(2 * math.pi * j / segments), w * math.sin(2 * math.pi * j / segments), z)))
                     for j in range(segments)])
    faces = []
    for j in range(segments):
        k = (j + 1) % segments
        faces.append(orient(bm.faces.new((top, rows[0][j], rows[0][k])), c))
    for a, b in zip(rows, rows[1:]):
        for j in range(segments):
            k = (j + 1) % segments
            faces.append(orient(bm.faces.new((a[j], b[j], b[k], a[k])), c))
    for j in range(segments):
        k = (j + 1) % segments
        faces.append(orient(bm.faces.new((bottom, rows[-1][k], rows[-1][j])), c))
    return faces


def frame_axes(t, up):
    """Two unit axes perpendicular to tangent `t`, the first toward `up`."""
    t = Vector(t).normalized()
    up = Vector(up)
    a = up - t * up.dot(t)
    if a.length < 1e-6:
        a = Vector((1, 0, 0)) - t * t.x
    a.normalize()
    return a, t.cross(a)


def tube_rings(bm, path, ra, rb=None, sides=6, phase=0.0, up=(0, 0, 1), closed=False):
    """Rings of a polygonal tube along `path`; ra/rb are the section radii
    toward `up` and across (single values or one per path point)."""
    rb = ra if rb is None else rb
    n = len(path)
    rings = []
    for i, p in enumerate(path):
        p = Vector(p)
        if closed:
            t = Vector(path[(i + 1) % n]) - Vector(path[(i - 1) % n])
        else:
            t = Vector(path[min(i + 1, n - 1)]) - Vector(path[max(i - 1, 0)])
        u = up(p) if callable(up) else up
        a, b = frame_axes(t, u)
        r1 = ra[i] if isinstance(ra, (list, tuple)) else ra
        r2 = rb[i] if isinstance(rb, (list, tuple)) else rb
        if closed:
            # mitre: keep the wall thickness constant through the corners
            t0 = (Vector(path[i]) - Vector(path[(i - 1) % n])).normalized()
            t1 = (Vector(path[(i + 1) % n]) - Vector(path[i])).normalized()
            k = 1.0 / max(0.5, math.cos(t0.angle(t1, 0.0) / 2))
        else:
            k = 1.0
        rings.append([bm.verts.new(p + a * math.cos(2 * math.pi * j / sides + phase) * r1
                                   + b * math.sin(2 * math.pi * j / sides + phase) * r2 * k) for j in range(sides)])
    return rings


def tube(name, path, ra, mat, rb=None, sides=6, phase=0.0, up=(0, 0, 1), closed=False, caps=True, sharp=40.0):
    """A polygonal tube along a polyline (pipes, struts, hoops)."""
    bm = bmesh.new()
    rings = tube_rings(bm, path, ra, rb, sides, phase, up, closed)
    S.ring_faces(bm, rings + ([rings[0]] if closed else []))
    if caps and not closed:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    return solid(name, bm, mat, sharp)


def add_tube(bm, path, ra, rb=None, sides=6, phase=0.0, up=(0, 0, 1), caps=True):
    """A tube into an existing bmesh (pipes in a Batch); faces turned away
    from the path, so no global normal recalculation is needed."""
    rings = tube_rings(bm, path, ra, rb, sides, phase, up)
    for i in range(len(rings) - 1):
        mid = (Vector(path[i]) + Vector(path[i + 1])) / 2
        for j in range(sides):
            k = (j + 1) % sides
            orient(bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j])), mid)
    if caps:
        for ring, p, q in ((rings[0], path[0], path[1]), (rings[-1], path[-1], path[-2])):
            orient(bm.faces.new(ring), Vector(p) + (Vector(q) - Vector(p)).normalized() * 0.01)
    return rings


def add_lathe(bm, profile, sides, matrix, phase=0.0, caps=False):
    """A revolved profile into a bmesh: (z, r) pairs about the local Z axis
    of `matrix`, listed along the outside of the solid (the solid on the
    axis side), so each band faces (-dr, dz) in (axial, radial) terms;
    `caps` closes the last ring with a flat face looking along +Z."""
    rings = []
    for z, r in profile:
        if r <= 1e-6:
            rings.append(bm.verts.new(matrix @ Vector((0, 0, z))))
        else:
            rings.append([bm.verts.new(matrix @ Vector((r * math.cos(2 * math.pi * j / sides + phase),
                                                         r * math.sin(2 * math.pi * j / sides + phase), z)))
                          for j in range(sides)])
    rot = matrix.to_3x3()
    axis = (rot @ Vector((0, 0, 1))).normalized()
    centre = matrix.translation

    def face(verts, dz, dr):
        f = bm.faces.new(verts)
        f.normal_update()
        c = f.calc_center_median()
        radial = c - centre
        radial = radial - axis * radial.dot(axis)
        radial = radial.normalized() if radial.length > 1e-9 else Vector((0, 0, 0))
        want = axis * (-dr) + radial * dz
        if f.normal.dot(want) < 0:
            f.normal_flip()

    for (za, ra), (zb, rb), a, b in zip(profile, profile[1:], rings, rings[1:]):
        dz, dr = zb - za, rb - ra
        if isinstance(a, list) and isinstance(b, list):
            for j in range(sides):
                k = (j + 1) % sides
                face((a[j], a[k], b[k], b[j]), dz, dr)
        elif isinstance(a, list):
            for j in range(sides):
                face((a[j], a[(j + 1) % sides], b), dz, dr)
        elif isinstance(b, list):
            for j in range(sides):
                face((a, b[(j + 1) % sides], b[j]), dz, dr)
    if caps and isinstance(rings[-1], list):
        f = bm.faces.new(rings[-1])
        f.normal_update()
        if f.normal.dot(axis) < 0:
            f.normal_flip()
    return rings


def add_tine(bm, base, up, fwd, height, chord, thick, rake=0.35, hook=0.08, sink=3.0, sections=4):
    """A harrow tine: a raked, slightly hooked blade of diamond section
    tapering to a point. `fwd` is the chord direction (leading edge)."""
    up, fwd = Vector(up).normalized(), Vector(fwd)
    fwd = (fwd - up * fwd.dot(up)).normalized()
    side = fwd.cross(up)
    base = Vector(base)

    def spine(s):
        return base + up * (s * height) - fwd * (rake * height * max(s, 0) ** 1.5) + fwd * (hook * height * max(s, 0) ** 4)

    rings, centres = [], []
    for k in range(sections):
        s = -sink / height + (0.92 + sink / height) * k / (sections - 1)
        c = spine(s)
        w = chord * (1.0 - 0.82 * max(s, 0) ** 0.9)
        t = thick * (1.0 - 0.75 * max(s, 0))
        rings.append([bm.verts.new(p) for p in (c + fwd * w * 0.55, c + side * t / 2, c - fwd * w * 0.45, c - side * t / 2)])
        centres.append(c)
    tip = bm.verts.new(spine(1.0))
    for i in range(sections - 1):
        mid = (centres[i] + centres[i + 1]) / 2
        for j in range(4):
            k = (j + 1) % 4
            orient(bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j])), mid)
    for j in range(4):
        orient(bm.faces.new((rings[-1][j], rings[-1][(j + 1) % 4], tip)), centres[-1])
    return spine(1.0), spine(0.86) + fwd * chord * 0.08


class Batch:
    """Collects many small parts per material into one bmesh each, so a
    few thousand greebles become a handful of objects."""

    def __init__(self, prefix):
        self.prefix = prefix
        self.bms = {}

    def __call__(self, mat):
        if mat.name not in self.bms:
            self.bms[mat.name] = (bmesh.new(), mat)
        return self.bms[mat.name][0]

    def objects(self, sharp=30.0):
        out = []
        for name, (bm, mat) in self.bms.items():
            if len(bm.faces):
                out.append(solid(f'{self.prefix}_{name}', bm, mat, sharp, recalc=False))
            else:
                bm.free()
        self.bms = {}
        return out


def surface_frame(loc, normal, along=(0, 1, 0)):
    """A frame at `loc` with Z = normal and Y as close to `along` as possible."""
    z = Vector(normal).normalized()
    x = Vector(along).cross(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0)).cross(z)
    x.normalize()
    m = Matrix((x, z.cross(x), z)).transposed().to_4x4()
    m.translation = Vector(loc)
    return m


def cast(bvh, origin, direction):
    """Raycast; (location, outward normal) or (None, None)."""
    d = Vector(direction).normalized()
    loc, nrm, _, _ = bvh.ray_cast(Vector(origin), d)
    if loc is None:
        return None, None
    n = nrm.normalized()
    if n.dot(d) > 0:
        n = -n
    return loc, n


# ==========================================================================
# Paint (procedural sources for the bake)

def _plates_proj(g, u, v, size, seam, seed):
    """Irregular plating in one projection: rows of plates `size` (length
    along u, height along v) metres with a random offset per row; each
    plate split once at random, across or along; one plate in five carries
    an inset hatch. Returns (seam mask, per-sub-plate random 0..1, inset
    line mask)."""
    W, H = size
    row = g.math('FLOOR', g.mul(v, 1.0 / H))
    rowrnd = g.node('ShaderNodeTexWhiteNoise', [g.combine(row, seed, 0.5)], noise_dimensions='3D').outputs['Value']
    uu = g.add(g.mul(u, 1.0 / W), rowrnd)
    col = g.math('FLOOR', uu)
    lu = g.math('FRACT', uu)
    lv = g.math('FRACT', g.mul(v, 1.0 / H))
    wn = g.node('ShaderNodeTexWhiteNoise', [g.combine(col, row, seed)], noise_dimensions='3D')
    r1, r2 = wn.outputs['Value'], g.sep(wn.outputs['Color'])[0]
    across = g.math('LESS_THAN', r1, 0.55)                  # split across the plate (a seam along v)
    split = g.add(0.28, g.mul(r2, 0.44))
    du = g.mul(g.minimum(lu, g.sub(1.0, lu)), W)
    dv = g.mul(g.minimum(lv, g.sub(1.0, lv)), H)
    d_border = g.minimum(du, dv)
    d_split = g.mixf(across, g.mul(g.absolute(g.sub(lv, split)), H), g.mul(g.absolute(g.sub(lu, split)), W))
    d = g.minimum(d_border, d_split)
    mask = g.sub(1.0, g.smooth(d, seam * 0.5, seam * 0.5 + 0.12))
    side = g.mixf(across, g.math('GREATER_THAN', lv, split), g.math('GREATER_THAN', lu, split))
    sub = g.node('ShaderNodeTexWhiteNoise', [g.combine(g.add(col, g.mul(side, 0.5)), row, g.add(seed, 3.7))],
                 noise_dimensions='3D').outputs['Value']
    inset = g.mul(g.math('GREATER_THAN', sub, 0.8),
                  g.sub(1.0, g.smooth(g.absolute(g.sub(d, 1.3)), seam * 0.3, seam * 0.3 + 0.1)))
    return mask, sub, inset


def plates(g, P, N, size, seam, shift=0.0):
    """Tri-planar irregular plating: (seam mask, per-plate random 0..1,
    inset-hatch line mask). The projection follows the dominant normal axis
    so plates run along the hull on deck, flanks and faces alike."""
    x, y, z = g.sep(g.vmath('ADD', P, (shift, shift * 0.61, shift * 0.37)) if shift else P)
    nx, ny, nz = (g.absolute(c) for c in g.sep(N))
    top = _plates_proj(g, y, x, size, seam, 1.0 + shift)
    side = _plates_proj(g, y, z, size, seam, 2.0 + shift)
    front = _plates_proj(g, x, z, size, seam, 3.0 + shift)
    wz = g.mul(g.math('GREATER_THAN', nz, nx), g.math('GREATER_THAN', nz, ny))
    wx = g.mul(g.sub(1.0, wz), g.math('GREATER_THAN', nx, ny))
    wy = g.sub(g.sub(1.0, wz), wx)
    return tuple(g.add(g.add(g.mul(wz, a), g.mul(wx, b)), g.mul(wy, c)) for a, b, c in zip(top, side, front))


def skin(g, base, rough, metal, P, N, wear=1.0, grime=1.0, panels=1.0, glow=None, height=None,
         big=(34.0, 14.0), small=(14.0, 6.0), ao=26.0, edge=0.7, streak=1.0, plating=None):
    """The Harrow finish at capital-ship scale. Returns the channel dict
    (albedo, rough, metal, normal, glow) for common.source_material.
    `plating` may pass in a precomputed (big, small) pair of plates()."""
    h = height if height is not None else 0.0
    if panels:
        (m1, r1, i1), (m2, r2, i2) = plating or (plates(g, P, N, big, 0.6), plates(g, P, N, small, 0.38, shift=3.1))
        tint = g.add(0.92, g.add(g.mul(r1, 0.2), g.mul(r2, 0.08)))
        base = g.mix(1.0, base, g.combine(tint, tint, tint), 'MULTIPLY')
        base = g.mix(g.mul(m1, 0.72 * panels), base, (0.012, 0.012, 0.013))
        base = g.mix(g.mul(g.maximum(m2, i1), 0.3 * panels), base, (0.02, 0.02, 0.022))
        rough = g.mixf(g.mul(r2, 0.25), rough, g.add(rough, 0.08))
        rough = g.mixf(g.mul(m1, 0.5), rough, 0.72)
        h = g.add(h, g.mul(m1, -0.24 * panels))
        h = g.add(h, g.mul(g.maximum(m2, i1), -0.08 * panels))
        # some sub-plates stand proud, some are sunk: layered plating
        h = g.add(h, g.mul(g.sub(g.smooth(r2, 0.7, 0.72), g.smooth(r2, 0.14, 0.12)), 0.14 * panels))
        h = g.add(h, g.mul(g.smooth(r1, 0.6, 0.62), 0.1 * panels))
    # low-frequency mottling so 800 m of the same paint does not look flat
    mott = g.noise(P, 1.0 / 140.0, 3.0, 0.55)
    base = g.mix(1.0, base, g.combine(*(g.add(0.86, g.mul(mott, 0.28)),) * 3), 'MULTIPLY')
    occl = g.node('ShaderNodeAmbientOcclusion', [None, ao], samples=16, only_local=False).outputs['AO']
    streaks = g.smooth(g.noise(g.vmath('MULTIPLY', P, (0.32, 0.011, 0.32)), 1.0, 4.0, 0.6), 0.52, 0.8)
    dirt = g.add(g.mul(g.sub(1.0, occl), 0.75), g.mul(streaks, 0.3 * streak))
    dirt = g.mul(g.minimum(dirt, 1.0), grime)
    base = g.mix(g.mul(dirt, 0.62), base, (0.03, 0.026, 0.024), 'MULTIPLY')
    rough = g.mixf(g.mul(dirt, 0.5), rough, 0.66)
    bev = g.node('ShaderNodeBevel', [edge], samples=4).outputs[0]
    rim = g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1))
    patches = g.smooth(g.noise(P, 0.09, 3.0, 0.5), 0.48, 0.62)
    chips = g.mul(g.mul(g.smooth(rim, 0.02, 0.09), patches), g.smooth(g.noise(P, 0.7, 4.0, 0.6), 0.42, 0.56))
    worn = g.mul(chips, wear)
    base = g.mix(worn, base, S.BARE)
    rough = g.mixf(worn, rough, 0.36)
    metal = g.mixf(worn, metal, 0.7)
    h = g.add(h, g.mul(worn, -0.02))
    return dict(albedo=base, rough=rough, metal=metal, normal=g.bump(h, 1.0, 1.0, normal=bev), glow=glow)


def red(k=1.0):
    """Harrow red (#ff2a1a, linear) times k."""
    return (1.0 * k, 0.023 * k, 0.01 * k)


def hazard_stripes(g, u, v, width):
    """Hazard yellow and near-black diagonal stripes as a colour."""
    return g.mix(S.hazard(g, u, v, width), (0.018, 0.018, 0.02), S.HAZARD)
