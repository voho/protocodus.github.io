"""Hedgerow — helpers for the `military` set (build_military.py).

Geometry is accumulated in `Mesh` builders (fast `from_pydata`, a palette
key per face, a per-vertex occlusion value and a per-face "soft" flag) and
mixed freely with kit primitives; `finish` then joins nothing itself but
does what kit.finalize does plus:

* keeps colliders and anchors (authored in build space) in step with the
  re-centring of the geometry;
* multiplies the grime vertex colour by the baked occlusion (`occl`
  attribute: crevices between sandbags, undersides) and removes it;
* marks sharp edges per face kind: soft faces (bags, canvas, earth) stay
  smooth up to a wide angle, hard faces get crisp bevels.

v3 adds the weathering layer (drip maps and per-family overlays wrapped
round every surface recipe, see "v3 weathering"), split sandbags, split end
grain, stencils and number plates.

Conventions as in kit.py: Blender space, Z up, metres, front = -Y.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler, noise
import kit

V = Vector


# --------------------------------------------------------------------------
# Small transform helpers

def trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """Matrix from a location, XYZ Euler rotation in degrees and scale."""
    m = Matrix.Translation(V(loc)) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()
    if scale is not None:
        s = scale if hasattr(scale, '__len__') else (scale, scale, scale)
        m = m @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    return m


def rot_about(axis, deg, pivot):
    """Rotation by `deg` about an axis ('X', 'Y', 'Z' or vector) through `pivot`."""
    p = V(pivot)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p)


def ground(obj):
    """Translate the mesh so its bounds are centred in x/y with the base on
    z = 0 (do this before authoring colliders when the build origin is not
    the base)."""
    vs = obj.data.vertices
    xs, ys, zs = [v.co.x for v in vs], [v.co.y for v in vs], [v.co.z for v in vs]
    off = V(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    obj.data.transform(Matrix.Translation(-off))
    obj.data.update()
    return obj


def transform(obj, matrix):
    """Apply a matrix to the object's mesh data (object transform untouched)."""
    obj.data.transform(matrix)
    obj.data.update()
    return obj


# --------------------------------------------------------------------------
# Mesh builder

class Mesh:
    """Geometry accumulator: verts with occlusion, faces with palette keys."""

    def __init__(self):
        self.v, self.occ = [], []
        self.f, self.fm, self.soft = [], [], []
        # v3: per-vertex hints for the bake ("tone": one bag's own shade,
        # "wet": where water sits - the underside of a bag, a hollow in canvas)
        self.tone, self.wet = [], []
        self.cur_tone = 0.5

    def vert(self, p, occ=0.0, wet=0.0):
        self.v.append(V(p))
        self.occ.append(occ)
        self.tone.append(self.cur_tone)
        self.wet.append(wet)
        return len(self.v) - 1

    def face(self, idx, mat, soft=False):
        self.f.append(list(idx))
        self.fm.append(mat)
        self.soft.append(soft)

    def add(self, verts, faces, mat, matrix=None, occ=None, soft=False):
        base = len(self.v)
        for i, p in enumerate(verts):
            p = V(p)
            if matrix is not None:
                p = matrix @ p
            self.v.append(p)
            self.occ.append(occ[i] if occ else 0.0)
            self.tone.append(self.cur_tone)
            self.wet.append(0.0)
        for fc in faces:
            self.f.append([base + i for i in fc])
            self.fm.append(mat)
            self.soft.append(soft)
        return base

    def build(self, name):
        keys = list(dict.fromkeys(self.fm))
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        for k in keys:
            me.materials.append(kit.material(k) if k in kit.PALETTE else bpy.data.materials[k])
        idx = {k: i for i, k in enumerate(keys)}
        me.polygons.foreach_set('material_index', [idx[k] for k in self.fm])
        a = me.attributes.new('occl', 'FLOAT', 'POINT')
        a.data.foreach_set('value', self.occ)
        s = me.attributes.new('soft', 'BOOLEAN', 'FACE')
        s.data.foreach_set('value', self.soft)
        for an, vals in (('tone', self.tone), ('wet', self.wet)):
            at = me.attributes.new(an, 'FLOAT', 'POINT')
            at.data.foreach_set('value', vals)
        me.update()
        return kit.link(bpy.data.objects.new(name, me))


def loft(mesh, rings, mat, closed=True, cap0=False, cap1=False, soft=False, occ=None, skip=()):
    """Faces between consecutive rings (lists of points, same length). Rings
    must wind counter-clockwise about the direction of increasing ring index
    (right-hand rule) for outward normals. `occ` is a function
    (ring_index, point_index) -> occlusion or None. `skip` = segment indices
    (between point k and k+1) to leave out."""
    ids = []
    for i, ring in enumerate(rings):
        ids.append([mesh.vert(p, occ(i, k) if occ else 0.0) for k, p in enumerate(ring)])
    n = len(rings[0])
    segs = n if closed else n - 1
    for i in range(len(ids) - 1):
        a, b = ids[i], ids[i + 1]
        for k in range(segs):
            if k in skip:
                continue
            k1 = (k + 1) % n
            mesh.face((a[k], a[k1], b[k1], b[k]), mat, soft)
    if cap0:
        mesh.face(list(reversed(ids[0])), mat, soft)
    if cap1:
        mesh.face(ids[-1], mat, soft)
    return ids


def frames_along(path, up=V((0, 0, 1))):
    """Tangent / normal / binormal frames for a polyline (parallel transport)."""
    pts = [V(p) for p in path]
    out = []
    prev_n = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_n is None:
            ref = up if abs(t.dot(up)) < 0.95 else V((1, 0, 0))
            n = (ref - t * ref.dot(t)).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        b = t.cross(n)
        prev_n = n
        out.append((p, t, n, b))
    return out


def sweep(mesh, path, section, mat, closed=True, caps=True, soft=False, lateral=None, scales=None, occ=None):
    """Sweep a 2D section (u, v) along a 3D polyline. With `lateral` (a fixed
    unit vector) the section's u axis is that vector and v = lateral x tangent
    (planar paths: fenders); otherwise parallel-transport frames, u = binormal,
    v = normal. `scales` optionally scales the section per path point."""
    rings = []
    pts = [V(p) for p in path]
    frames = frames_along(pts) if lateral is None else None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if lateral is not None:
            u = V(lateral).normalized()
            v = u.cross(t).normalized()
        else:
            _, _, n, b = frames[i]
            u, v = b, n
        s = scales[i] if scales else 1.0
        su, sv = s if hasattr(s, '__len__') else (s, s)
        rings.append([p + u * (a * su) + v * (c * sv) for a, c in section])
    # orientation: section CCW in (u, v) with v = u x t means CCW about -t;
    # flip ring order so rings wind CCW about +t
    rings = [list(reversed(r)) for r in rings]
    return loft(mesh, rings, mat, closed=closed, cap0=caps, cap1=caps, soft=soft, occ=occ)


def tube_mesh(mesh, points, radius, mat, sides=6, caps=True, radii=None, soft=True, occ=None):
    """Round tube along a polyline into a Mesh builder."""
    fr = frames_along(points)
    rings = []
    for i, (p, t, n, b) in enumerate(fr):
        r = radii[i] if radii else radius
        rings.append([p + (n * math.cos(a) + b * math.sin(a)) * r
                      for a in (2 * math.pi * k / sides for k in range(sides))])
    # n cos + b sin with b = t x n winds CCW about t
    return loft(mesh, rings, mat, closed=True, cap0=caps, cap1=caps, soft=soft, occ=occ)


def box_mesh(mesh, size, matrix=None, mat='wood', occ_bottom=0.0, soft=False):
    """Axis box centred at the origin (then `matrix`) into a Mesh builder."""
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
             (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    occ = [occ_bottom] * 4 + [0.0] * 4
    return mesh.add(verts, faces, mat, matrix, occ, soft)


def hull_object(points, mat, name='hull'):
    """Convex hull of points as an object (for cutters and chunky parts)."""
    bm = bmesh.new()
    for p in points:
        bm.verts.new(V(p))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit._new_object(name, bm, mat)


# --------------------------------------------------------------------------
# Sandbags

# Bag cross-section (y / half-width, z / height), open at the bottom and
# wound counter-clockwise about +X. Segments 0..3 are the +Y side (low side
# to upper edge), 4 the top, 5..8 the -Y side (upper edge down to the low side).
BAG_PROF = [(1.0, 0.0), (1.0, 0.3), (0.95, 0.62), (0.78, 0.88), (0.38, 1.0), (-0.38, 1.0), (-0.78, 0.88),
            (-0.95, 0.62), (-1.0, 0.3), (-1.0, 0.0)]
BAG_ROUND = BAG_PROF            # v1 names
BAG_ROW = BAG_PROF
BAG_RINGS = (0.0, 0.12, 0.5, 0.88, 1.0)
BAG_RINGS3 = (0.0, 0.2, 0.8, 1.0)


def _sides(nseg):
    t = nseg // 2
    return set(range(0, t)), t, set(range(t + 1, nseg))


def _tone_at(p):
    """A repeatable 0..1 shade for whatever sits at p (no shared RNG drawn)."""
    key = (int(math.floor(p[0] / 0.05)), int(math.floor(p[1] / 0.05)), int(math.floor(p[2] / 0.05)))
    return random.Random(key[0] * 73856093 ^ key[1] * 19349663 ^ key[2] * 83492791).random()


def bag(mesh, L, W, H, matrix, rng, tie=1, keep=None, wedge=0.0, tint=1.0, lump=1.0,
        profile=BAG_PROF, rings=BAG_RINGS, mat='sandbag', pinch=(0.5, 0.55), flat_ends=False, cord=True):
    """One filled sandbag lying along local +X, centred, bottom at z = 0.
    `tie` = +1/-1 puts the tied end at +X/-X: gathered into a neck with a
    cord round it and a short ear; the other end is the flat sewn end.
    `wedge` widens the -X end and narrows the +X end (bags in a ring). `keep`
    = set of (ring segment, profile segment) faces to emit (None = all):
    faces buried under or between neighbouring bags are left out."""
    n = len(profile)
    ids = []
    last = len(rings) - 1
    slump_w, slump_h = rng.uniform(1.0, 1.05), rng.uniform(0.95, 1.0)
    slump_w, slump_h = 1.02 + (slump_w - 1.0) * 1.6, 0.97 - (1.0 - slump_h) * 1.8      # v3: sag more
    tone0 = mesh.cur_tone
    mesh.cur_tone = _tone_at(matrix.translation)
    for i, t in enumerate(rings):
        end = i in (0, last)
        tied = end and not flat_ends and ((i == 0 and tie < 0) or (i == last and tie > 0))
        if tied:
            sw, sh = pinch
        elif end:
            sw, sh = 0.9, 0.84
        elif 0.3 < t < 0.7:
            sw, sh = slump_w, slump_h
        else:
            sw, sh = 1.0, 1.0
        wf = 1.0 + wedge * (0.5 - t)
        x0 = (t - 0.5) * L
        ring = []
        for k, (u, v) in enumerate(profile):
            x = x0
            y = u * W / 2 * sw * wf
            z = v * H * sh
            if tied:
                z = H * 0.42 + (v - 0.5) * H * sh
                z = max(z, 0.0) if v == 0 else z
            if v > 0:
                y += rng.uniform(-1, 1) * 0.03 * W * lump
                z += rng.uniform(-1, 1) * 0.04 * H * lump
                if not end:
                    x += rng.uniform(-1, 1) * 0.025 * L * lump
            else:
                y += rng.uniform(-1, 1) * 0.02 * W
            o = 0.45 if v == 0 else (0.08 if v < 0.9 else 0.0)
            if end:
                o = min(0.8, o + (0.3 if tied else 0.15))
            shade = 1.0 - (1.0 - o) * tint
            ring.append(mesh.vert(matrix @ V((x, y, z)), shade, wet=1.0 - v))
        ids.append(ring)
    for i in range(last):
        a, b = ids[i], ids[i + 1]
        for k in range(n - 1):
            if keep is not None and (i, k) not in keep:
                continue
            mesh.face((a[k], a[k + 1], b[k + 1], b[k]), mat, True)
    for i, ring in ((0, ids[0]), (last, ids[-1])):
        tied = not flat_ends and ((i == 0 and tie < 0) or (i == last and tie > 0))
        if not tied:          # sewn end: flat, rounded-rectangle face
            mesh.face(list(reversed(ring)) if i == 0 else ring, mat, True)
            continue
        sgn = -1 if i == 0 else 1
        # the ear: gathered cloth beyond the neck, bent down a little
        tip = matrix @ V((sgn * (L / 2 + 0.055), rng.uniform(-0.02, 0.02), H * rng.uniform(0.3, 0.42)))
        ti = mesh.vert(tip, 1.0 - 0.55 * tint)
        for k in range(n - 1):
            if i == 0:
                mesh.face((ti, ring[k + 1], ring[k]), mat, True)
            else:
                mesh.face((ti, ring[k], ring[k + 1]), mat, True)
        if cord:
            cx = sgn * (L / 2 + 0.012)
            rw, rh = W / 2 * pinch[0] * 0.62, H * pinch[1] * 0.42
            pts = [matrix @ V((cx, rw * math.cos(a), H * 0.42 + rh * math.sin(a)))
                   for a in (2 * math.pi * j / 7 for j in range(8))]
            tube_mesh(mesh, pts, 0.0055, mat, sides=3, caps=False)
    mesh.cur_tone = tone0


def _row_segs(row, top, two_rows, banked, nseg=len(BAG_PROF) - 1):
    """Profile segments of a stretcher row worth drawing."""
    plus, t, minus = _sides(nseg)
    out_side = minus if row == 'f' else plus
    in_side = plus if row == 'f' else minus
    low_in = 0 if row == 'f' else nseg - 1
    segs = set(out_side)
    if top:
        segs.add(t)
        if not banked:
            segs.update(in_side - {low_in} if two_rows else in_side)
    elif not (two_rows or banked):
        segs.update(in_side)
    return segs


def bag_row(mesh, path, d, z, sizes, W, H, rng, segs=None, exposed=None, lump=1.0, tints=None, mat='sandbag'):
    """A row of stretcher bags along `path` at lateral offset d and base z,
    lofted as one surface: bags pinch at shared joint rings (clean creases,
    no hidden end caps). `sizes` = bag lengths (summing to the row length);
    `segs` = profile segments to emit; `exposed(f)` adds the top segment."""
    prof = BAG_PROF
    n = len(prof)
    nseg = n - 1
    top_seg = nseg // 2
    Lr = path.row_len(d)
    rings, occs, ring_f = [], [], []
    acc = 0.0
    nb = len(sizes)

    def ring(f, sw, sh, occ_add, tint, roll=0.0, shift=0.0):
        pos, yaw = path.place(f, d + shift)
        m = trs(pos + V((0, 0, z)), (roll, 0, yaw))
        pts, oc = [], []
        for k, (u, v) in enumerate(prof):
            y = u * W / 2 * sw
            zz = v * H * sh
            if 0 < v:
                y += rng.uniform(-1, 1) * 0.02 * W * lump
                zz += rng.uniform(-1, 1) * 0.02 * H * lump
            pts.append(m @ V((0.0, y, zz)))
            o = 0.45 if v == 0 else (0.1 if v < 0.5 else 0.0)
            o = min(0.85, o + occ_add)
            oc.append(1.0 - (1.0 - o) * tint)
        rings.append(pts)
        occs.append(oc)
        ring_f.append(f)

    tints = tints or [1.0] * nb
    for i, sz in enumerate(sizes):
        t = tints[i]
        bw, bh = rng.uniform(0.95, 1.05), rng.uniform(0.93, 1.05)
        lean = rng.uniform(-3, 3)
        sh_shift = rng.uniform(-0.015, 0.015)
        if i == 0:
            ring(acc / Lr, 0.86, 0.8, 0.2, t)
        for fr, kw, kh in ((0.16, 1.0, 1.0), (0.5, rng.uniform(1.0, 1.05), rng.uniform(0.95, 1.0)), (0.84, 1.0, 1.0)):
            if fr == 0.5:                       # v3: the middle of each bag sags and spreads more
                kw, kh = 1.02 + (kw - 1.0) * 1.6, 0.97 - (1.0 - kh) * 1.8
            ring((acc + fr * sz) / Lr, bw * kw * rng.uniform(0.98, 1.02), bh * kh * rng.uniform(0.97, 1.03), 0.0, t,
                 roll=lean, shift=sh_shift)
        f3 = (acc + sz) / Lr
        if i == nb - 1:
            ring(f3, 0.86, 0.8, 0.2, t)
        else:
            nt = (t + tints[i + 1]) / 2
            ring(f3, rng.uniform(0.8, 0.88), rng.uniform(0.72, 0.8), 0.42, nt)
        acc += sz
    # one shade per bag (from its middle ring), joints halfway
    tones = [_tone_at(sum(rings[4 * i + 2], V((0, 0, 0))) / n) for i in range(nb)]
    ring_tone = [tones[0]]
    for i in range(nb):
        ring_tone += [tones[i]] * 3 + [(tones[i] + tones[min(i + 1, nb - 1)]) / 2]
    tone0 = mesh.cur_tone
    ids = []
    for i, r in enumerate(rings):
        mesh.cur_tone = ring_tone[i]
        ids.append([mesh.vert(p, occs[i][k], wet=1.0 - prof[k][1]) for k, p in enumerate(r)])
    mesh.cur_tone = tone0
    segs = set(range(nseg)) if segs is None else set(segs)
    for i in range(len(ids) - 1):
        a, b = ids[i], ids[i + 1]
        fm = (ring_f[i] + ring_f[i + 1]) / 2
        for k in range(nseg):
            if k not in segs and not (k == top_seg and exposed and exposed(fm)):
                continue
            mesh.face((a[k], a[k + 1], b[k + 1], b[k]), mat, True)
    # domed row ends
    for which in (0, -1):
        r = ids[which]
        pos, yaw = path.place(ring_f[which], d)
        tang = V((math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0.0))
        c = sum((rings[which][k] for k in range(n)), V((0, 0, 0))) / n
        tip = c + tang * (0.03 if which == -1 else -0.03) + V((0, 0, 0.02))
        ti = mesh.vert(tip, 1.0 - 0.75 * (tints[0] if which == 0 else tints[-1]))
        for k in range(nseg):
            if which == 0:
                mesh.face((ti, r[k + 1], r[k]), mat, True)
            else:
                mesh.face((ti, r[k], r[k + 1]), mat, True)


def _keep_h(top, exposed_top, first, last, nrs, nseg):
    """Faces of a header bag (long axis across the wall): its sides touch
    the neighbours, so only the ends (and the top, if exposed) show."""
    plus, t, minus = _sides(nseg)
    open_sides = (plus if first else set()) | (minus if last else set())
    keep = set()
    for i in range(nrs):
        middle = 0 < i < nrs - 1
        for k in range(nseg):
            if k == t:
                ok = top or exposed_top
            elif middle:
                ok = k in open_sides or (top and k not in (0, nseg - 1))
            else:
                ok = True
            if ok:
                keep.add((i, k))
    return keep


class StraightPath:
    """Wall centreline along X, centred on the origin; d > 0 towards -Y (front)."""

    def __init__(self, length):
        self.L = length

    def row_len(self, d):
        return self.L

    def place(self, f, d):
        return V(((f - 0.5) * self.L, -d, 0.0)), 0.0

    def wedge(self, depth):
        return 0.0


class ArcPath:
    """Ring wall: centre, centreline radius, from angle a0 to a1 (degrees,
    counter-clockwise); d > 0 away from the centre."""

    def __init__(self, centre, radius, a0, a1):
        self.c = V((centre[0], centre[1], 0.0))
        self.R, self.a0, self.a1 = radius, a0, a1

    def angle(self, f):
        return self.a0 + f * (self.a1 - self.a0)

    def row_len(self, d):
        return math.radians(self.a1 - self.a0) * (self.R + d)

    def place(self, f, d):
        a = math.radians(self.angle(f))
        r = self.R + d
        return self.c + V((r * math.cos(a), r * math.sin(a), 0.0)), math.degrees(a) + 90.0

    def wedge(self, depth):
        return depth / self.R


class SubPath:
    """The part [f0, f1] of a path, re-parameterised to [0, 1]."""

    def __init__(self, path, f0, f1):
        self.p, self.f0, self.f1 = path, f0, f1

    def row_len(self, d):
        return self.p.row_len(d) * (self.f1 - self.f0)

    def place(self, f, d):
        return self.p.place(self.f0 + f * (self.f1 - self.f0), d)

    def wedge(self, depth):
        return self.p.wedge(depth)


def _split(rng, total, nominal, jit=0.1):
    n = max(1, round(total / nominal))
    sizes = [1.0 + rng.uniform(-jit, jit) for _ in range(n)]
    s = sum(sizes)
    return [total * x / s for x in sizes]


def bag_core(mesh, path, z0, z1, depth0, depth1, f0=0.0, f1=1.0, segs=1, mat='sandbag'):
    """A dark hidden core inside a bag wall: whatever is seen through the
    crevices between bags (whose buried faces are left out) is this surface
    instead of the sky."""
    sec = [(-depth0 / 2, z0), (-depth1 / 2, z1), (depth1 / 2, z1), (depth0 / 2, z0)]
    rings = []
    for i in range(segs + 1):
        f = f0 + (f1 - f0) * i / segs
        ring = []
        for d, z in sec:
            p, _ = path.place(f, d)
            ring.append(p + V((0, 0, z)))
        rings.append(ring)
    return loft(mesh, rings, mat, closed=True, cap0=True, cap1=True, soft=False, skip=(3,),
                occ=lambda i, k: 0.72)


def bag_wall(mesh, path, courses, seed=1, top_jitter=1.0):
    """Lay courses of bags along a path. Each course is a dict:
    kind 'S' (stretchers, rows ('f', 'b') = front/outer and back/inner) or
    'H' (headers spanning the depth); h = course height; depth = wall depth;
    optional skip(f) to leave bags out (notches), exposed(f) for bags whose
    top shows although a course lies above, banked=True when the far side of
    a single row is buried in earth, bag_len / bag_w, rings."""
    rng = random.Random(seed)
    z = 0.0
    n_c = len(courses)
    count = 0
    for ci, c in enumerate(courses):
        h, depth = c['h'], c['depth']
        top = ci == n_c - 1
        lump = c.get('lump', 1.0) * (1.2 if top else 1.0)
        H = h + 0.04
        sink = 0.0 if ci == 0 else 0.012
        zc = c.get('z', z)
        rings = c.get('rings', BAG_RINGS)
        nrs = len(rings) - 1
        skip = c.get('skip') or (lambda f: False)
        exposed = c.get('exposed') or (lambda f: False)
        if c['kind'] == 'S':
            rows = c.get('rows', ('f', 'b'))
            for row in rows:
                d = depth / 4 if row == 'f' else -depth / 4
                Lr = path.row_len(d)
                sizes = _split(rng, Lr, c.get('bag_len', 0.6))
                # notches: split the row into runs of kept bags
                runs, cur = [], []
                acc = 0.0
                for sz in sizes:
                    f = (acc + sz / 2) / Lr
                    if skip(f):
                        if cur:
                            runs.append(cur)
                        cur = []
                    else:
                        cur.append((acc, sz))
                    acc += sz
                if cur:
                    runs.append(cur)
                for run in runs:
                    a0 = run[0][0]
                    tot = sum(sz for _, sz in run)
                    sub = SubPath(path, a0 / Lr, (a0 + tot) / Lr)
                    tints = [rng.uniform(0.8, 1.0) if rng.random() > 0.08 else rng.uniform(0.6, 0.72) for _ in run]
                    bag_row(mesh, sub, d + rng.uniform(-0.01, 0.01), zc - sink, [sz for _, sz in run],
                            depth / 2 + 0.035, H, rng,
                            segs=_row_segs(row, top, len(rows) > 1, c.get('banked', False)),
                            exposed=lambda fm, sub=sub: exposed(sub.f0 + fm * (sub.f1 - sub.f0)),
                            lump=lump, tints=tints)
                    count += len(run)
        else:
            Lc = path.row_len(0.0)
            sizes = _split(rng, Lc, c.get('bag_w', 0.375))
            fs = []
            acc = 0.0
            for s in sizes:
                fs.append(((acc + s / 2) / Lc, s))
                acc += s
            alive = [not skip(f) for f, _ in fs]
            for j, (f, s) in enumerate(fs):
                if not alive[j]:
                    continue
                first = j == 0 or not alive[j - 1]
                last = j == len(fs) - 1 or not alive[j + 1]
                pos, yaw = path.place(f, rng.uniform(-0.015, 0.015))
                jy = rng.uniform(-4, 4) * (1.5 if top else 1.0) * top_jitter
                m = trs(pos + V((0, 0, zc - sink)), (rng.uniform(-2, 2), rng.uniform(-2.5, 2.5), yaw + 90 + jy))
                prof = c.get('h_profile', BAG_ROW if top else BAG_ROUND)
                keep = _keep_h(top, exposed(f), first, last, nrs, len(prof) - 1)
                tint = rng.uniform(0.8, 1.0) if rng.random() > 0.08 else rng.uniform(0.6, 0.72)
                bag(mesh, depth - 0.03, s + 0.03, H * rng.uniform(0.95, 1.05), m, rng,
                    tie=rng.choice((-1, 1)), keep=keep, wedge=path.wedge(depth), tint=tint, lump=lump * 0.8,
                    rings=rings, profile=prof, cord=c.get('ties', True))
                count += 1
        z = zc + h
    return count


# --------------------------------------------------------------------------
# Wheels

def wheel(mesh, centre, radius, width, side, mat_tyre='rubber', mat_rim='metal_gray', segs=14,
          flat=0.0, rim_only=False, rim_mat=None, hub=True, rng=None, tread=0.0, nuts=0, spokes=0, spoked=False):
    """A road wheel, axis along X, `side` = +1 if its outer face looks +X.
    `flat` squashes the bottom of the tyre (0..1); `tread` = lug depth in
    metres (alternate segments of the tread band sink); `nuts` wheel nuts on
    the hub; `spokes` cut-outs as dark pockets in the disc."""
    cx, cy, cz = centre
    hw = width / 2
    r = radius
    if rim_only:
        prof = [(0.62 * r, -hw * 0.75), (0.56 * r, -hw * 0.6), (0.56 * r, hw * 0.6), (0.62 * r, hw * 0.75)]
        mats = [rim_mat or mat_rim] * 3
        tread_rows = ()
    else:
        prof = [(0.6 * r, -hw * 0.82), (0.86 * r, -hw * 0.98), (0.97 * r, -hw * 0.75), (r, -hw * 0.45),
                (r, hw * 0.45), (0.97 * r, hw * 0.75), (0.86 * r, hw * 0.98), (0.6 * r, hw * 0.82)]
        mats = [mat_tyre] * 7
        tread_rows = (2, 3, 4, 5)
        if tread:              # v3: lugs at a real pitch
            segs *= 2
    disc = [(0.56 * r, hw * 0.6), (0.5 * r, hw * 0.5), (0.24 * r, hw * 0.7), (0.15 * r, hw * 0.95),
            (0.0, hw * 0.98)] if hub and not spoked else []
    prof_all = prof + disc
    mats += [rim_mat or mat_rim] * len(disc)
    rings = []
    for j, (pr, px) in enumerate(prof_all):
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ry, rz = math.cos(a), math.sin(a)
            rr = pr
            pxx = px
            if tread and j in tread_rows:      # staggered blocks: shoulders and centre alternate
                if j in (3, 4) and k % 2:
                    rr -= tread * 1.25
                elif j in (2, 5) and not k % 2:
                    rr -= tread * 0.8
            if flat and pr > 0.8 * r and rz < -0.2:
                rr = rr - flat * 0.25 * r * (-rz - 0.2) / 0.8
            if flat and not rim_only and j in (1, 2, 5, 6) and rz < -0.25:      # the loaded sidewall bulges
                pxx = px * (1.0 + 0.5 * flat * (-rz - 0.25) / 0.75)
            ring.append(V((cx + pxx * side, cy + rr * ry, cz + rr * rz)))
        rings.append(ring)
    ids = [[mesh.vert(p, 0.15 if j < 1 else 0.0) for p in ring] for j, ring in enumerate(rings)]
    for j in range(len(ids) - 1):
        a, b = ids[j], ids[j + 1]
        m = mats[j]
        for k in range(segs):
            k1 = (k + 1) % segs
            if side > 0:
                mesh.face((a[k], a[k1], b[k1], b[k]), m, True)
            else:
                mesh.face((a[k], b[k], b[k1], a[k1]), m, True)
    if spoked:      # close the torus with the rim band and put a hub and spokes inside
        a, b = ids[-1], ids[0]
        for k in range(segs):
            k1 = (k + 1) % segs
            if side > 0:
                mesh.face((a[k], a[k1], b[k1], b[k]), rim_mat or mat_rim, True)
            else:
                mesh.face((a[k], b[k], b[k1], a[k1]), rim_mat or mat_rim, True)
        q = V((0, 0, 1)).rotation_difference(V((1, 0, 0))).to_matrix().to_4x4()
        cyl_mesh(mesh, 0.15 * r, width * 0.9, Matrix.Translation(V((cx, cy, cz))) @ q, rim_mat or mat_rim, sides=10)
        for k in range(spokes or 16):
            a_ = 2 * math.pi * k / (spokes or 16)
            off = (1 if k % 2 else -1) * hw * 0.35
            tube_mesh(mesh, [V((cx + off, cy + 0.13 * r * math.cos(a_), cz + 0.13 * r * math.sin(a_))),
                             V((cx - off * 0.3, cy + 0.6 * r * math.cos(a_ + 0.35), cz + 0.6 * r * math.sin(a_ + 0.35)))],
                      0.0025, 'metal_dark', sides=3, caps=False)
        return
    inner = ids[0]
    mesh.face(list(reversed(inner)) if side > 0 else inner, rim_mat or mat_rim, False)
    if not hub:
        outer = ids[-1]
        mesh.face(outer if side > 0 else list(reversed(outer)), mats[-1], False)
    q = V((0, 0, 1)).rotation_difference(V((side, 0, 0))).to_matrix().to_4x4()
    for n_ in range(nuts):
        a = 2 * math.pi * n_ / nuts
        p = V((cx + side * hw * 0.82, cy + 0.19 * r * math.cos(a), cz + 0.19 * r * math.sin(a)))
        cyl_mesh(mesh, 0.012 * r / 0.45, 0.025, Matrix.Translation(p) @ q, 'metal_dark', sides=6)
    for n_ in range(spokes):
        a = 2 * math.pi * (n_ + 0.5) / spokes
        p = V((cx + side * hw * 0.62, cy + 0.38 * r * math.cos(a), cz + 0.38 * r * math.sin(a)))
        cyl_mesh(mesh, 0.06 * r, 0.012, Matrix.Translation(p) @ q, 'metal_dark', sides=8, caps=True)


def jerrycan(mesh, matrix, mat='metal_gray'):
    """A Wehrmacht-Kanister (0.35 x 0.16 x 0.47), origin at the bottom centre."""
    W, T, Hh = 0.345, 0.16, 0.44
    M = matrix
    box_mesh(mesh, (W, T, Hh), M @ trs((0, 0, Hh / 2)), mat, occ_bottom=0.3)
    box_mesh(mesh, (W + 0.008, 0.012, Hh - 0.03), M @ trs((0, 0, Hh / 2 - 0.005)), mat)
    ang = math.degrees(math.atan2(Hh - 0.1, W - 0.08))
    ln = math.hypot(Hh - 0.1, W - 0.08)
    for y in (-T / 2 - 0.003, T / 2 + 0.003):
        for sgn in (1, -1):
            box_mesh(mesh, (ln, 0.008, 0.03), M @ trs((0, y, Hh / 2 - 0.01), (0, sgn * ang, 0)), mat)
    for y in (-0.042, 0.0, 0.042):
        tube_mesh(mesh, [M @ V(p) for p in ((-0.072, y, Hh - 0.005), (-0.064, y, Hh + 0.03), (0.064, y, Hh + 0.03),
                                            (0.072, y, Hh - 0.005))], 0.008, mat, sides=4)
    cyl_mesh(mesh, 0.026, 0.045, M @ trs((0.125, 0, Hh + 0.012), (0, 12, 0)), mat, sides=8)
    box_mesh(mesh, (0.012, 0.03, 0.07), M @ trs((0.158, 0, Hh + 0.03), (0, -20, 0)), 'metal_dark')


# --------------------------------------------------------------------------
# Colliders / anchors in build space, converted after re-centring

def cbox(center, size, yaw=0.0, kind=None):
    return ('box', V(center), tuple(size), yaw, kind)


def cbox_minmax(mn, mx, kind=None):
    mn, mx = V(mn), V(mx)
    return cbox((mn + mx) / 2, mx - mn, 0.0, kind)


def ccyl(base, radius, height, kind=None):
    return ('cyl', V(base), radius, height, kind)


def _convert(colliders, off):
    out = []
    for c in colliders:
        if c[0] == 'box':
            _, ctr, size, yaw, kind = c
            out.append(kit.collider_box(ctr - off, size, yaw, kind))
        else:
            _, base, r, h, kind = c
            out.append(kit.collider_cyl(base - off, r, h, kind))
    return out


# --------------------------------------------------------------------------
# Finishing

def _apply_occlusion(obj):
    me = obj.data
    occ = me.attributes.get('occl')
    col = me.color_attributes.get('Color')
    if occ is None or col is None:
        if occ is not None:
            me.attributes.remove(occ)
        return
    vals = [0.0] * len(me.vertices)
    occ.data.foreach_get('value', vals)
    for li, loop in enumerate(me.loops):
        o = vals[loop.vertex_index]
        if o:
            c = col.data[li].color
            m = 1.0 - o
            col.data[li].color = (c[0] * m, c[1] * m, c[2] * m, 1.0)
    me.attributes.remove(me.attributes.get('occl'))


def _sharp_edges(obj, hard_angle, soft_angle):
    me = obj.data
    me.shade_smooth()
    soft_attr = me.attributes.get('soft')
    soft = [False] * len(me.polygons)
    if soft_attr is not None:
        soft_attr.data.foreach_get('value', soft)
    edge_faces = {}
    for p in me.polygons:
        for ek in p.edge_keys:
            edge_faces.setdefault(ek, []).append(p.index)
    sharp = me.attributes.get('sharp_edge') or me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
    vals = []
    ch, cs = math.cos(math.radians(hard_angle)), math.cos(math.radians(soft_angle))
    polys = me.polygons
    for e in me.edges:
        fs = edge_faces.get(e.key, [])
        if len(fs) != 2:
            vals.append(len(fs) > 2)
            continue
        a, b = polys[fs[0]], polys[fs[1]]
        lim = cs if (soft[fs[0]] and soft[fs[1]]) else ch
        dot = a.normal.dot(b.normal)
        vals.append(dot < lim or a.material_index != b.material_index)
    sharp.data.foreach_set('value', vals)
    if soft_attr is not None:
        me.attributes.remove(me.attributes.get('soft'))
    me.update()


OFFSETS = {}     # node -> build-space offset removed by `finish`


def finish(obj, name, colliders=(), anchors=None, grime=0.25, grime_height=0.6, center='bbox',
           hard_angle=32, soft_angle=85, uv_seed=None, extras=None):
    """kit.finalize plus colliders/anchors, baked occlusion and per-kind
    sharp edges. center: 'bbox' (base-centre of the bounds to the origin),
    'xy' (centre x/y, keep z), None (keep the build-space origin) or an
    explicit build-space offset (x, y, z) to subtract."""
    obj.name = name
    obj.data.name = name
    kit.apply_transform(obj)
    # duplicate faces (two coincident parts) make the exporter complain
    obj.data.validate(clean_customdata=False)
    # drop vertices no face uses (culled bag faces leave some): the GLB would
    # not carry them, so they must not count towards the bounds either
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(obj.data)
        obj.data.update()
    bm.free()
    vs = obj.data.vertices
    xs = [v.co.x for v in vs]
    ys = [v.co.y for v in vs]
    zs = [v.co.z for v in vs]
    if isinstance(center, (tuple, list, V)):      # a pinned offset (keeps an earlier origin)
        off = V(center)
    elif center == 'bbox':
        off = V(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    elif center == 'xy':
        off = V(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0.0))
    else:
        off = V((0, 0, 0))
    if off.length:
        obj.data.transform(Matrix.Translation(-off))
        obj.data.update()
    kit.finalize(obj, name, uv=True, uv_seed=uv_seed, grime_height=grime_height,
                 grime_strength=grime, shade='flat', base_origin=False)
    _apply_occlusion(obj)
    _sharp_edges(obj, hard_angle, soft_angle)
    kit.set_colliders(obj, _convert(colliders, off))
    if anchors:
        conv = {}
        for k, v in anchors.items():
            if len(v) == 2 and hasattr(v[0], '__len__'):
                conv[k] = (tuple(V(v[0]) - off), v[1])
            else:
                conv[k] = tuple(V(v) - off)
        kit.set_anchors(obj, conv)
    for k, v in (extras or {}).items():
        kit.set_extra(obj, k, v)
    OFFSETS[name] = off
    return obj


def join(parts, name):
    """kit.join that also accepts Mesh builders."""
    objs = []
    for p in parts:
        if p is None:
            continue
        if isinstance(p, Mesh):
            if p.f:
                objs.append(p.build(name + '_part'))
        else:
            objs.append(p)
    for o in objs:
        kit.apply_transform(o)
    return kit.join(objs, name) if len(objs) > 1 else _rename(objs[0], name)


def _rename(o, name):
    o.name = name
    o.data.name = name
    return o


def material_by_normal(obj, fn):
    """Reassign face materials: fn(face_centre, normal, current_key) -> key."""
    me = obj.data
    keys = [m.name for m in me.materials]
    for p in me.polygons:
        k = fn(p.center, p.normal, keys[p.material_index])
        if k not in keys:
            me.materials.append(kit.material(k))
            keys.append(k)
        p.material_index = keys.index(k)
    return obj


def stripes(obj, normal, period, mats, face_filter, offset=0.0):
    """Cut the faces passing `face_filter(face)` with a family of parallel
    planes (normal, spacing `period`) and alternate materials `mats`."""
    n = V(normal).normalized()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    faces = [f for f in bm.faces if face_filter(f)]
    if faces:
        ds = [n.dot(v.co) for f in faces for v in f.verts]
        lo, hi = math.floor((min(ds) - offset) / period), math.ceil((max(ds) - offset) / period)
        for k in range(lo, hi + 1):
            geom = list(set([e for f in faces for e in f.edges] + faces + [v for f in faces for v in f.verts]))
            res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=n * (k * period + offset), plane_no=n)
            faces = [f for f in bm.faces if f.is_valid and face_filter(f)]
    keys = [m.name for m in obj.data.materials]
    for key in mats:
        if key not in keys:
            obj.data.materials.append(kit.material(key))
            keys.append(key)
    for f in bm.faces:
        if face_filter(f):
            c = f.calc_center_median()
            i = int(math.floor((n.dot(c) - offset) / period)) % len(mats)
            f.material_index = keys.index(mats[i])
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def noise_material(obj, key, other, threshold, scale=1.2, seed=0, where=None):
    """Swap faces of material `key` to `other` where 3D noise > threshold."""
    me = obj.data
    keys = [m.name for m in me.materials]
    if other not in keys:
        me.materials.append(kit.material(other))
        keys.append(other)
    off = V((seed * 13.1, seed * 7.7, seed * 3.3))
    for p in me.polygons:
        if keys[p.material_index] != key:
            continue
        if where and not where(p.center, p.normal):
            continue
        if noise.noise(p.center * scale + off) > threshold:
            p.material_index = keys.index(other)
    return obj


# --------------------------------------------------------------------------
# Checks and previews

def check_normals(obj):
    """Closed islands whose signed volume is negative (inside-out). Open
    islands are skipped."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    bad = []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack, isl = [f0], []
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            isl.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        if not all(len(e.link_faces) == 2 for f in isl for e in f.edges):
            continue
        vol = 0.0
        for f in isl:
            vs = [v.co for v in f.verts]
            for i in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
        if vol < 0:
            c = sum((f.calc_center_median() for f in isl), V((0, 0, 0))) / len(isl)
            bad.append((len(isl), tuple(round(x, 2) for x in c), round(vol, 4)))
    bm.free()
    return bad


def preview(objects, path, **kw):
    """kit.preview, but the floor plane gets a white Color attribute so the
    vertex-colour preview materials do not render it black."""
    if not isinstance(objects, (list, tuple)):
        objects = [objects]
    orig = kit.plane

    def plane(*a, **k):
        o = orig(*a, **k)
        kit.flat_color(o, 1.0)
        return o
    kit.plane = plane
    try:
        return kit.preview(objects, path, **kw)
    finally:
        kit.plane = orig


def preview_materials():
    """Make every palette material show the vertex colour (grime) and cull
    back faces like three.js does. Call only after the GLB is exported."""
    for mat in bpy.data.materials:
        if mat.name not in kit.PALETTE or not mat.use_nodes:
            continue
        nt = mat.node_tree
        if nt.nodes.get('pv_attr'):
            continue
        bsdf = nt.nodes.get('Principled BSDF')
        out = nt.nodes.get('Material Output')
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.name = 'pv_attr'
        attr.attribute_name = 'Color'
        base = tuple(bsdf.inputs['Base Color'].default_value)
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(attr.outputs['Alpha'], mix.inputs['Factor'])
        mix.inputs['A'].default_value = base
        nt.links.new(attr.outputs['Color'], mix.inputs['B'])
        # factor = alpha (1 when the mesh has Color): base * color, else base
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        transp = nt.nodes.new('ShaderNodeBsdfTransparent')
        ms = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(geo.outputs['Backfacing'], ms.inputs['Fac'])
        nt.links.new(bsdf.outputs['BSDF'], ms.inputs[1])
        nt.links.new(transp.outputs['BSDF'], ms.inputs[2])
        nt.links.new(ms.outputs['Shader'], out.inputs['Surface'])


def closeup(obj, path, focus=(0.0, 0.0, 0.0), azimuth=-28.0, elevation=10.0, dist=2.0, size=768, samples=16):
    """A still from `dist` metres (default 2 m) at a detail of the model: the
    focus is the front of the bounds at chest height, plus `focus`."""
    scene = bpy.context.scene
    hidden = []
    for o in scene.objects:
        if o.type in ('MESH', 'ARMATURE', 'EMPTY') and o is not obj and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    mn, mx = kit.bounds(obj)
    c = (mn + mx) / 2
    f = V((c.x, mn.y + (mx.y - mn.y) * 0.2, min(c.z, mn.z + 1.1))) + V(focus)
    r = (mx - mn).length / 2
    d = min(dist, max(0.6, r * 2.2))
    el, az = math.radians(elevation), math.radians(azimuth)
    cam_data = bpy.data.cameras.new('close_cam')
    cam_data.lens = 35
    cam_data.clip_start = 0.02
    cam = kit.link(bpy.data.objects.new('close_cam', cam_data))
    cam.location = f + V((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * d
    cam.rotation_euler = (f - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun_data = bpy.data.lights.new('close_sun', 'SUN')
    sun_data.energy = 3.0
    sun_data.angle = math.radians(8)
    sun = kit.link(bpy.data.objects.new('close_sun', sun_data))
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-40))
    floor = kit.plane(60, 60, loc=(c.x, c.y, mn.z - 0.001), mat='dirt', name='close_floor')
    kit.flat_color(floor, 1.0)
    world = bpy.data.worlds.get('preview') or bpy.data.worlds.new('preview')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.35, 0.38, 0.42, 1)
    bg.inputs['Strength'].default_value = 0.8
    scene.world = world
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.cycles.samples = samples
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    kit.delete(cam)
    kit.delete(sun)
    kit.delete(floor)
    for o in hidden:
        o.hide_render = False
    kit.log('preview', os.path.basename(path))
    return path


def bake(obj, tpm=110, bevel=0.01, kind='prop', **kw):
    """bake.bake_model with the set's defaults and the v3 weathering context
    (`kind` picks mud line, streak lengths and dent depth, see KIND); frees
    the AO / edge / drip images."""
    import bake as B
    name = obj.name
    extras = {k: obj[k] for k in obj.keys() if k in ('colliders', 'anchors')}
    CTX.clear()
    mn, mx = kit.bounds(obj)
    CTX.update(obj=obj, kind=kind, seed=sum(ord(c) for c in name) % 997, drip=None, height=mx.z - max(mn.z, 0.0))
    kw.setdefault('scale_islands', _scale_islands)
    try:
        r = B.bake_model(obj, tpm=tpm, bevel=bevel, **kw)
    finally:
        drip = CTX.get('drip')
        CTX.clear()
    mr = r.get('mr')
    if mr is not None and mr.size[0] >= 1024:      # roughness / metal at half resolution
        mr.scale(mr.size[0] // 2, mr.size[1] // 2)
        mr.pack()
    o = r['object']
    o.name = name
    for an in ('tone', 'wet'):            # bake hints, not for export
        at = o.data.attributes.get(an)
        if at is not None:
            o.data.attributes.remove(at)
    for k, v in extras.items():
        o[k] = v
    for k in ('ao', 'edge'):
        if r.get(k):
            bpy.data.images.remove(r[k])
    if drip is not None:
        if os.environ.get('MIL_DRIP_DIR'):          # debugging: keep the drip maps
            drip.filepath_raw = os.path.join(os.environ['MIL_DRIP_DIR'], name + '_drip.png')
            drip.file_format = 'PNG'
            drip.save()
        bpy.data.images.remove(drip)
    return o


# --------------------------------------------------------------------------
# Extra surfaces for the bake (registered at runtime; surfaces.py is shared)

def _painted_steel(S, paint, rough=0.55, chip_k=1.0, rust_k=1.0):
    """Painted steel after surfaces.r_painted_metal, with any paint colour
    socket: orange peel, scratches, chips at edges to dark steel and rust."""
    g = S.g
    paint = S.tint(paint, S.n(2.0, 3), 0.85, 1.1)
    paint = S.tint(paint, S.n(60.0, 2), 0.93, 1.05)
    chip = g.smooth(g.add(g.mul(S.edge, 0.75 * chip_k), g.mul(S.n(14.0, 6, 0.7), 0.55)), 0.78, 0.82)
    scratch = g.smooth(S.n(20.0, 2, 0.5, stretch=(1, 1, 22), kind='RIDGED_MULTIFRACTAL'), 0.92, 0.98)
    rust = g.mix(S.n(30.0), S.col('#5a2c16'), S.col('#8a4a22'))
    rmask = g.smooth(S.n(5.0), 0.6 - 0.15 * rust_k, 0.75 - 0.15 * rust_k)
    under = g.mix(rmask, S.col('#2b2b2a'), rust)
    alb = g.mix(chip, paint, under)
    alb = g.mix(g.mul(scratch, 0.45), alb, S.col('#6a6a64'))
    # rust bleeding from chips and seams
    bleed = g.mul(g.smooth(g.one_minus(S.ao), 0.3, 0.7), g.mul(g.smooth(S.n(7.0, 4, 0.6), 0.55, 0.7), rust_k))
    alb = g.mix(g.mul(bleed, 0.7), alb, S.col('#5e3018'))
    h = g.sub(g.add(0.6, g.mul(S.n(90.0, 2, 0.5), 0.08)), g.mul(chip, 0.12))
    rgh = g.mixf(chip, rough, 0.45)
    metal = g.mixf(chip, 0.05, g.mixf(rmask, 0.85, 0.2))
    return dict(albedo=alb, rough=rgh, metal=metal, height=h, bump=0.35, dist=0.01)


def r_camo_de(S, key):
    """1944 German three-tone: dunkelgelb sprayed with olive green and red
    brown, soft-edged blotches, worn and chipped."""
    g = S.g
    base = S.col('#8f8160')
    green, brown = S.col('#4a5434'), S.col('#5c3d2a')
    v1 = g.vadd(g.vscale(S.P, (1.0, 1.0, 0.8)), (3.1, 0.0, 0.0))
    v2 = g.vadd(g.vscale(S.P, (1.0, 1.0, 0.8)), (17.3, 9.1, 4.4))
    b1 = g.smooth(g.noise(v1, 0.75, detail=3, rough=0.55), 0.53, 0.575)
    b2 = g.smooth(g.noise(v2, 0.9, detail=3, rough=0.55), 0.56, 0.6)
    paint = g.mix(b1, base, green)
    paint = g.mix(b2, paint, brown)
    if key == 'paint_sand':
        paint = base
    d = _painted_steel(S, paint, rough=0.62)
    # dust and dried mud
    dust = g.mul(g.smooth(S.n(3.0, 4, 0.6), 0.5, 0.8), g.smooth(S.Z, 1.0, 0.2))
    d['albedo'] = g.mix(g.mul(dust, 0.5), d['albedo'], S.col('#7a6a50'))
    return d


def r_concrete_camo(S, key):
    """Board-formed concrete with weathered camouflage blotches painted on."""
    import surfaces
    g = S.g
    d = surfaces.r_concrete(S, 'concrete')
    green, brown = S.col('#5a6040'), S.col('#6a5038')
    b1 = g.smooth(S.n(0.55, 3, 0.5), 0.55, 0.6)
    b2 = g.smooth(g.noise(g.vadd(S.P, (11.0, 5.0, 2.0)), 0.7, detail=3, rough=0.5), 0.57, 0.62)
    flake = g.smooth(g.add(S.n(9.0, 5, 0.6), g.mul(S.edge, 0.4)), 0.68, 0.62)
    alb = g.mix(g.mul(b1, flake), d['albedo'], S.tint(green, S.n(5.0), 0.8, 1.1))
    alb = g.mix(g.mul(b2, flake), alb, S.tint(brown, S.n(5.0), 0.8, 1.1))
    d['albedo'] = alb
    return d


def r_brass(S, key):
    g = S.g
    alb = S.tint(S.col('#b08a3a'), S.n(30.0), 0.8, 1.15)
    tarn = g.smooth(S.n(8.0, 4, 0.6), 0.5, 0.75)
    alb = g.mix(g.mul(tarn, 0.7), alb, S.col('#4a4024'))
    return dict(albedo=alb, rough=g.mixf(tarn, 0.3, 0.6), metal=1.0, height=S.n(80.0), bump=0.1, dist=0.002)


def r_paint_wood_col(hexcode):
    def r(S, key):
        import surfaces
        g = S.g
        wood, h_w, r_w, gap = surfaces._planks(S, old=True)
        paint = S.tint(S.col(hexcode), S.n(3.0), 0.85, 1.1)
        peel = g.smooth(g.add(g.mul(S.edge, 0.5), S.n(7.0, 5, 0.7)), 0.74, 0.78)
        alb = g.mix(peel, paint, wood)
        h = g.mixf(peel, g.add(h_w, 0.06), h_w)
        return dict(albedo=alb, rough=g.mixf(peel, 0.6, r_w), metal=0.0, height=h, bump=0.5, dist=0.015)
    return r


def r_bakelite(S, key):
    g = S.g
    alb = g.mix(S.n(4.0, 5, 0.6), S.col('#1e1712'), S.col('#3a2a1e'))
    worn = g.smooth(S.edge, 0.3, 0.8)
    alb = g.mix(g.mul(worn, 0.5), alb, S.col('#5a4636'))
    return dict(albedo=alb, rough=g.mixf(worn, 0.35, 0.55), metal=0.0, height=S.n(60.0), bump=0.1, dist=0.002)


def r_burnt_body(S, key):
    """Steel after a petrol fire: rust-brown oxide over most panels, grey-white
    ash where it burnt hottest, black soot round openings and low down, a
    few flecks of surviving paint, blistered."""
    g = S.g
    rust = g.mix(S.n(20.0, 5, 0.6), S.col('#2c170c'), S.col('#56311a'))
    rust = S.tint(rust, S.n(3.0, 4, 0.6), 0.65, 1.1)
    ash = g.mix(S.n(30.0), S.col('#4a4742'), S.col('#67635b'))
    hot = g.smooth(S.n(1.3, 4, 0.6), 0.6, 0.72)
    sooty = g.smooth(g.add(g.mul(g.one_minus(S.ao), 1.4), g.mul(S.n(2.5, 4, 0.6), 0.8)), 0.5, 0.85)
    keep = g.smooth(S.n(6.0, 5, 0.7), 0.73, 0.77)
    alb = g.mix(hot, rust, ash)
    alb = g.mix(keep, alb, S.col('#4e4a36'))
    alb = g.mix(sooty, alb, S.col('#131110'))
    blister = g.smooth(g.voronoi(S.P, 35.0), 0.18, 0.0)
    h = g.add(g.mul(blister, 0.3), g.mul(S.n(25.0, 5, 0.6), 0.4))
    return dict(albedo=alb, rough=g.mixf(hot, 0.86, 0.96), metal=g.mixf(sooty, 0.25, 0.05), height=h, bump=0.7,
                dist=0.012)


def r_rust3(S, key):
    """Rusted iron: dark brown scale, orange only in flakes, pitted."""
    g = S.g
    alb = g.mix(S.n(14.0, 6, 0.7), S.col('#2e1a0e'), S.col('#5e3418'))
    alb = g.mix(g.smooth(S.n(30.0, 4, 0.6), 0.62, 0.72), alb, S.col('#7a4220'))
    alb = g.mix(g.smooth(S.n(4.0), 0.5, 0.7), alb, S.col('#1c1410'))
    pits = g.smooth(g.voronoi(S.P, 120.0), 0.12, 0.04)
    return dict(albedo=alb, rough=0.88, metal=0.2, height=g.sub(S.n(30.0, 5, 0.7), g.mul(pits, 0.3)), bump=0.6,
                dist=0.006)


def r_iron3(S, key):
    """Unpainted structural iron left out for years: dark mill scale and
    brown rust in soft patches at several scales, orange only in fresh
    flakes and runs, worn paler at the edges."""
    g = S.g
    scale = g.mix(S.n(18.0, 5, 0.6), S.col('#2a2826'), S.col('#3c3833'))
    rust = g.mix(S.n(25.0, 5, 0.65), S.col('#3a2414'), S.col('#5e3a20'))
    cover = g.smooth(g.add(g.mul(S.n(2.2, 5, 0.6), 0.7), g.mul(S.n(9.0, 4, 0.6), 0.45)), 0.5, 0.78)
    alb = g.mix(cover, scale, rust)
    flake = g.mul(g.smooth(S.n(40.0, 4, 0.6), 0.66, 0.74), cover)
    alb = g.mix(g.mul(flake, 0.8), alb, S.col('#7a4422'))
    worn = g.smooth(S.edge, 0.35, 0.8)
    alb = g.mix(g.mul(worn, 0.4), alb, S.col('#5a5650'))
    pits = g.smooth(g.voronoi(S.P, 110.0), 0.12, 0.04)
    h = g.sub(g.add(g.mul(S.n(30.0, 5, 0.7), 0.5), g.mul(flake, 0.2)), g.mul(pits, g.mul(cover, 0.3)))
    return dict(albedo=alb, rough=g.mixf(cover, 0.62, 0.88), metal=g.mixf(cover, 0.55, 0.15), height=h, bump=0.5,
                dist=0.005)


def r_rust_dark(S, key):
    g = S.g
    alb = g.mix(S.n(14.0, 6, 0.7), S.col('#26160c'), S.col('#5a3018'))
    alb = g.mix(g.smooth(S.n(4.0), 0.5, 0.7), alb, S.col('#151110'))
    return dict(albedo=alb, rough=0.88, metal=0.2, height=S.n(30.0, 5, 0.7), bump=0.6, dist=0.01)


def r_olive_wreck(S, key):
    """US olive drab on a knocked-out jeep: heavily chipped, rust bleeding,
    dried mud splashed high."""
    g = S.g
    paint = S.tint(S.col('#4a4f30'), S.n(1.5, 4, 0.6), 0.8, 1.1)
    d = _painted_steel(S, paint, rough=0.68, chip_k=1.35, rust_k=1.7)
    mud = g.mul(g.smooth(S.n(4.0, 5, 0.6), 0.45, 0.7), g.smooth(S.Z, 0.9, 0.2))
    d['albedo'] = g.mix(g.mul(mud, 0.8), d['albedo'], S.col('#4a3c2a'))
    return d


def r_board_h(base_key):
    """Modelled boards lying horizontally: the shared plank recipe turned a
    quarter (grain along u) with boards a metre wide, so no false gaps cut
    across boards that are already separate geometry."""
    def r(S, key):
        import surfaces
        g = S.g
        su, sv, suv = S.U, S.V, S.UV
        S.U, S.V = sv, su
        S.UV = g.combine(sv, su, 0.0)
        try:
            alb, h, rough, _ = surfaces._planks(S, width=0.9, dark=base_key == 'wood_dark', old=base_key == 'wood_old')
        finally:
            S.U, S.V, S.UV = su, sv, suv
        return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.6, dist=0.015)
    return r


def register_surfaces():
    """Palette keys and recipes this set adds (kit.py / surfaces.py stay
    untouched; the registry is per process)."""
    import surfaces
    extra = {
        'camo_de': (('#9a875a', 0.6, 0.3), r_camo_de, 'metal'),
        'paint_sand': (('#9a875a', 0.6, 0.3), r_camo_de, 'metal'),
        'concrete_camo': (('#7d7a6e', 0.95, 0.0), r_concrete_camo, 'building'),
        'brass': (('#b08a3a', 0.35, 1.0), r_brass, 'weapon'),
        'paint_black': (('#1c1c1a', 0.6, 0.0), r_paint_wood_col('#1d1d1b'), 'prop'),
        'paint_yellow': (('#b39a4a', 0.6, 0.0), r_paint_wood_col('#b8a25a'), 'prop'),
        'bakelite': (('#2a2018', 0.4, 0.0), r_bakelite, 'weapon'),
        'burnt_body': (('#3a2a20', 0.9, 0.2), r_burnt_body, 'metal'),
        'rust_dark': (('#3e2414', 0.88, 0.2), r_rust_dark, 'metal'),
        'olive_wreck': (('#4a4f30', 0.65, 0.3), r_olive_wreck, 'metal'),
        'wood_h': (('#6b5039', 0.8, 0.0), r_board_h('wood'), 'prop'),
        'wood_old_h': (('#6d6458', 0.9, 0.0), r_board_h('wood_old'), 'prop'),
        'wood_dark_h': (('#3f2e22', 0.8, 0.0), r_board_h('wood_dark'), 'prop'),
        # v3: stencilled lettering and number plates
        'stencil_wood': (('#6b5039', 0.8, 0.0), r_stencil('wood_h', '#161412', 0.03, 0.05), 'prop'),
        'stencil_wood_old': (('#6d6458', 0.9, 0.0), r_stencil('wood_old_h', '#161412', 0.03, 0.05), 'prop'),
        'stencil_wood_dark': (('#3f2e22', 0.8, 0.0), r_stencil('wood_dark_h', '#cfc9b4', 0.026, 0.04), 'prop'),
        'stencil_paint_sand': (('#9a875a', 0.6, 0.3), r_stencil('paint_sand', '#1c1b18', 0.012, 0.018), 'metal'),
        'stencil_metal_olive': (('#4d5333', 0.6, 0.3), r_stencil('metal_olive', '#d2ccb4', 0.012, 0.018), 'metal'),
        'plate': (('#cfcabd', 0.5, 0.0), r_plate, 'metal'),
        'sand_spill': (('#7a6a52', 0.95, 0.0), r_sand, 'none'),
        'crack': (('#1c140e', 0.95, 0.0), r_crack, 'none'),
    }
    for key, (pal, fn, prof) in extra.items():
        kit.PALETTE[key] = pal
        surfaces.RECIPES[key] = fn
        surfaces.PROFILE[key] = prof
    # v3: the set's own takes on shared materials (this process only)
    surfaces.RECIPES['sandbag'] = r_sandbag3
    surfaces.RECIPES['concrete'] = r_concrete3
    surfaces.RECIPES['concrete_camo'] = r_concrete_camo3
    surfaces.RECIPES['rubber'] = r_tyre
    surfaces.RECIPES['glass'] = r_glass3
    surfaces.RECIPES['rust'] = r_rust3
    surfaces.RECIPES['iron'] = r_iron3
    for key, fn in list(surfaces.RECIPES.items()):
        if not getattr(fn, 'v3', False):
            surfaces.RECIPES[key] = _weathered(fn)
    # the overlays lay their own mud: the shared ground splash is turned off
    # for the families they cover (weathering profiles copied, splash 0)
    for prof, w in list(surfaces.WEATHER.items()):
        if not prof.startswith('mil_'):
            surfaces.WEATHER['mil_' + prof] = (w[0], w[1], 0.0) + tuple(w[3:])
    for key in FAMILY:
        prof = surfaces.PROFILE.get(key, 'nature')
        if not prof.startswith('mil_'):
            surfaces.PROFILE[key] = 'mil_' + prof


# --------------------------------------------------------------------------
# v3 weathering. Every recipe of this process is wrapped (`_weathered`) with
# an overlay chosen by material family (painted steel, bare steel, burnt,
# wood, canvas, cloth, rubber, sandbag, concrete, glass). The overlays read a
# per-model DRIP map baked just before the surfaces (`_drip_maps`):
#   R  rust streaks running down from seams, bolt and nail heads, chips;
#   G  grime / rain streaks running down from edges and ledges;
#   B  crevices (occlusion over 3.5 cm: seams, joints, round bolt heads).
# Streaks follow "down" in the atlas: the baked object-space position gives
# the direction of -Z in every UV island, and each texel takes the strongest
# source above it on the same surface, fading with the distance.

CTX = {}          # the model being baked: obj, kind, seed, drip image

# mud line (m), rust and grime streak lengths (m), dent depth (m)
KIND = {
    'vehicle': (0.85, 0.22, 0.5, 0.006), 'wreck': (0.95, 0.32, 0.6, 0.012), 'gun': (0.55, 0.2, 0.42, 0.004),
    'bags': (0.32, 0.08, 0.3, 0.0), 'concrete': (0.55, 0.45, 1.1, 0.0), 'wood': (0.32, 0.16, 0.4, 0.0),
    'prop': (0.18, 0.09, 0.22, 0.002), 'small': (0.07, 0.04, 0.09, 0.0012),
}


def _smoothstep(x, a, b):
    import numpy as np
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _hash3(c, seed):
    """Uniform [0, 1) per integer cell (int64 array, last axis xyz)."""
    import numpy as np
    x = (c[..., 0] * np.int64(73856093)) ^ (c[..., 1] * np.int64(19349663)) ^ (c[..., 2] * np.int64(83492791))
    x = x ^ np.int64((seed * 2654435761) % (1 << 31))
    x = (x ^ (x >> 13)) * np.int64(1274126177)
    x = x ^ (x >> 16)
    return (x & 0xFFFFFF).astype(np.float32) / float(0x1000000)


def _float_image(name, w, h):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    return img


def _bake_flat(obj, img, graph_fn, kind='EMIT', samples=1, margin=0):
    import bake as B
    restore = B._flat_override(obj, graph_fn)
    try:
        B._bake(obj, img, kind, samples, margin=margin)
    finally:
        restore()


def _drip_maps(obj, ao_img, edge_img):
    """Bake position and short-range occlusion in the atlas, then run rust
    and grime down every face (see the section comment). Deterministic."""
    import numpy as np
    import bake as B
    import time
    t0 = time.time()
    line, Lr, Lg, _ = KIND[CTX.get('kind', 'prop')]
    w = h = min(ao_img.size[0], 1024)          # streaks are soft: at most 1024 texels
    mn, mx = kit.bounds(obj)
    ext = [max(mx[i] - mn[i], 1e-3) for i in range(3)]
    pos = _float_image(obj.name + '_pos', w, h)

    def g_pos(g):
        p = g.vmath('SUBTRACT', g.coord('Object'), tuple(mn))
        g.emission(g.vmath('MULTIPLY', p, tuple(1.0 / e for e in ext)))
    _bake_flat(obj, pos, g_pos, 'EMIT', 1, 0)
    cav = B.new_image(obj.name + '_cav', w, non_color=True)
    ls = bpy.context.scene.world.light_settings
    d0 = ls.distance
    ls.distance = 0.035
    _bake_flat(obj, cav, lambda g: g.emission((1, 1, 1)), 'AO', 12, 4)
    B.blur_image(cav, 1)
    ls.distance = d0
    A = B.pixels(pos)
    cov = A[..., 3] > 0.5
    Pp = (A[..., :3] * np.array(ext, np.float32) + np.array(mn[:], np.float32)).astype(np.float32)
    C = np.clip((1.0 - B.pixels(cav)[..., 0] - 0.05) / 0.45, 0.0, 1.0)
    if edge_img.size[0] != w:
        ec = edge_img.copy()
        ec.scale(w, h)
        E = B.pixels(ec)[..., 0]
        bpy.data.images.remove(ec)
    else:
        E = B.pixels(edge_img)[..., 0]
    bpy.data.images.remove(pos)
    bpy.data.images.remove(cav)

    def sh(a, dr, dc):          # a[r + dr, c + dc]
        return np.roll(a, (-dr, -dc), axis=(0, 1))
    d1 = np.linalg.norm(sh(Pp, 0, 1) - Pp, axis=-1)
    ok1 = cov & sh(cov, 0, 1)
    ts = max(float(np.median(d1[ok1])) if ok1.any() else 0.005, 1e-4)      # metres per texel
    z = Pp[..., 2]

    def nbz(dr, dc):
        c = cov & sh(cov, dr, dc) & (np.linalg.norm(sh(Pp, dr, dc) - Pp, axis=-1) < 3 * ts)
        return sh(z, dr, dc), c
    zr, cr = nbz(0, 1)
    zl, cl = nbz(0, -1)
    zu, cu = nbz(1, 0)
    zd, cd = nbz(-1, 0)
    gx = np.where(cr & cl, (zr - zl) * 0.5, np.where(cr, zr - z, np.where(cl, z - zl, 0.0)))
    gy = np.where(cu & cd, (zu - zd) * 0.5, np.where(cu, zu - z, np.where(cd, z - zd, 0.0)))
    gm = np.hypot(gx, gy)
    ok = cov & (gm > 0.25 * ts)
    s = 3                       # look 3 texels up: direction error under 10 degrees
    inv = np.where(ok, 1.0 / np.maximum(gm, 1e-9), 0.0)
    dc = np.rint(s * gx * inv).astype(np.int64)
    dr = np.rint(s * gy * inv).astype(np.int64)
    rows, cols = np.indices((h, w))
    nb = (np.clip(rows + dr, 0, h - 1) * w + np.clip(cols + dc, 0, w - 1)).ravel()
    Pf, covf, zf = Pp.reshape(-1, 3), cov.ravel(), z.ravel()
    dist = np.linalg.norm(Pf[nb] - Pf, axis=1)
    okf = ok.ravel() & covf[nb] & (dist < 2.5 * s * ts) & (zf[nb] - zf > 0.25 * s * gm.ravel())
    N = np.where(okf, nb, np.arange(h * w))
    Dr = np.where(okf, np.exp(-dist / Lr), 0.0).astype(np.float32)
    Dg = np.where(okf, np.exp(-dist / Lg), 0.0).astype(np.float32)
    # sources: sparse spots on crevices and edges, world-space cells
    seed = CTX.get('seed', 0)
    c1 = np.floor(Pp / 0.011).astype(np.int64)
    hA, hB = _hash3(c1, seed), _hash3(c1, seed + 101)
    c2 = np.floor(Pp / 0.018 + 0.37).astype(np.int64)
    hC, hD = _hash3(c2, seed + 202), _hash3(c2, seed + 303)
    Cs, Es = _smoothstep(C, 0.1, 0.45), _smoothstep(E, 0.3, 0.8)
    # the top rows of every sloping face: where rain runs over an edge onto it
    top = (ok.ravel() & ~okf).reshape(h, w)
    Sr = (hA < 0.32) * (0.35 + 0.65 * hB) * np.maximum(np.maximum(Cs, 0.55 * Es * (hB > 0.45)), 0.5 * top * (hB > 0.85))
    Sg = (hC < 0.5) * (0.4 + 0.6 * hD) * np.maximum(np.maximum(Es, 0.7 * Cs), 0.85 * top * (hD > 0.55))
    R = (Sr * cov).astype(np.float32).ravel()
    G = (Sg * cov).astype(np.float32).ravel()
    steps = 3.0 * Lg / (s * ts)
    for _ in range(min(11, max(1, int(math.ceil(math.log2(steps + 1)))))):     # pointer jumping
        R = np.maximum(R, Dr * R[N])
        G = np.maximum(G, Dg * G[N])
        Dr = Dr * Dr[N]
        Dg = Dg * Dg[N]
        N = N[N]
    R, G = R.reshape(h, w), G.reshape(h, w)
    cf = cov.astype(np.float32)

    def blur(a):
        acc, n = np.zeros_like(a), np.zeros_like(a)
        for y in (-1, 0, 1):
            for x in (-1, 0, 1):
                acc += sh(a * cf, y, x)
                n += sh(cf, y, x)
        return np.where(cov, acc / np.maximum(n, 1.0), 0.0)
    out = np.zeros((h, w, 4), np.float32)
    out[..., 0], out[..., 1], out[..., 3] = blur(R), blur(G), 1.0
    filled = cov.copy()
    for _ in range(4):           # grow into the island margins
        for y, x in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            take = ~filled & sh(filled, y, x)
            out[take] = sh(out, y, x)[take]
            filled |= take
    out[..., 2] = C
    img = B.new_image(obj.name + '_drip', w, non_color=True)
    B.set_pixels(img, out)
    kit.log(f'  drip {obj.name}: {w}px, {ts * 1000:.1f} mm/texel, {time.time() - t0:.1f}s')
    return img


def _drip(S):
    """(rust, grime, crevice) sockets of the model's drip map."""
    img = CTX.get('drip')
    if img is None:
        ao = getattr(S.ao, 'node', None)
        edge = getattr(S.edge, 'node', None)
        if ao is None or edge is None or CTX.get('obj') is None:
            return 0.0, 0.0, 0.0
        img = CTX['drip'] = _drip_maps(CTX['obj'], ao.image, edge.image)
    return S.g.sep(S.g.image(img))


def _hadd(S, ch, hsock, metres):
    """Add relief `hsock` (about 0..1) worth `metres` to the recipe height."""
    g = S.g
    k = metres / max(ch.get('dist', 0.01), 1e-4)
    ch['height'] = g.add(ch.get('height', 0.5), g.mul(hsock, k))


def _wn(S, vec):
    return S.g.node('ShaderNodeTexWhiteNoise', {'Vector': vec}, noise_dimensions='3D').outputs['Value']


def _mud(S, ch, line, k=1.0, cake=0.0, drops=1.0):
    """Mud splashed up from the ground: a ragged band up to `line` metres,
    droplets and spatter flung higher, wet and dark low down, dried pale
    higher up; `cake` adds a lumpy crust in the band."""
    g = S.g
    line = min(line, 0.36 * CTX.get('height', 99.0))      # "the lower third"
    if line <= 0:
        return
    t = g.map_range(S.Z, 0.0, line, 1.0, 0.0)
    rag = S.n(3.2, 4, 0.62)
    band = g.smooth(g.add(t, g.mul(g.sub(rag, 0.5), 0.9)), 0.42, 0.56)
    vec = g.vscale(S.P, (1.0, 1.0, 0.65))
    d1 = g.voronoi(vec, 75.0)
    r1 = g.sep(g.voronoi(vec, 75.0, out='Color'))[0]
    dens = g.map_range(S.Z, 0.0, line * 1.6, 0.5, 0.0)
    dens = g.mul(dens, g.smooth(S.up, 0.55, 0.1))              # flung onto sides and undersides
    dots = g.mul(g.smooth(d1, 0.32, 0.12), g.smooth(g.sub(dens, r1), 0.0, 0.04))
    d2 = g.voronoi(vec, 22.0)
    r2 = g.sep(g.voronoi(vec, 22.0, out='Color'))[0]
    dens2 = g.mul(g.map_range(S.Z, 0.0, line * 1.3, 0.4, 0.0), g.smooth(S.up, 0.55, 0.1))
    blobs = g.mul(g.smooth(g.add(d2, g.mul(S.n(40.0, 3), 0.25)), 0.38, 0.22), g.smooth(g.sub(dens2, r2), 0.0, 0.04))
    mud = g.maximum(band, g.mul(g.maximum(dots, blobs), drops))
    mud = g.mul(mud, k)
    wet = g.smooth(g.add(t, g.mul(S.n(6.0), 0.4)), 0.65, 1.1)
    mc = g.mix(wet, g.mix(S.n(14.0, 4), S.col('#4e3f2e'), S.col('#665440')), S.col('#2c241a'))
    ch['albedo'] = g.mix(g.mul(mud, 0.88), ch['albedo'], mc)
    ch['rough'] = g.mixf(mud, ch['rough'], g.mixf(wet, 0.93, 0.62))
    ch['metal'] = g.mixf(mud, ch['metal'], 0.0)
    lump = g.mul(S.n(28.0, 4, 0.6), g.add(0.4, g.mul(band, cake * 3.0)))
    _hadd(S, ch, g.mul(mud, lump), 0.0015 + 0.004 * cake)


def _arches(S, ch, top=1.4):
    """Mud caked under wings, in wheel arches and on the undersides."""
    g = S.g
    under = g.smooth(S.up, -0.1, -0.55)
    low = g.smooth(S.Z, top, top * 0.45)
    k = g.mul(g.mul(under, low), g.smooth(S.ao, 0.95, 0.55))
    k = g.smooth(g.add(k, g.mul(g.sub(S.n(5.0, 4), 0.5), 0.6)), 0.3, 0.5)
    lumps = S.n(16.0, 5, 0.65)
    mc = g.mix(lumps, S.col('#2c241a'), S.col('#57472f'))
    ch['albedo'] = g.mix(k, ch['albedo'], mc)
    ch['rough'] = g.mixf(k, ch['rough'], 0.95)
    ch['metal'] = g.mixf(k, ch['metal'], 0.0)
    _hadd(S, ch, g.mul(k, lumps), 0.008)


def _streaks(S, ch, rust=1.0, grime=1.0, rust_cols=('#3e200f', '#74401f'), grime_mul=(0.5, 0.45, 0.38)):
    g = S.g
    dr, dg, dc = _drip(S)
    vert = g.smooth(g.absolute(S.up), 0.93, 0.6)
    fine = S.n(38.0, 3, 0.6, stretch=(1, 1, 0.1))
    if rust > 0:
        rs = g.smooth(g.mul(dr, g.add(0.55, g.mul(fine, 0.9))), 0.14, 0.5)
        rs = g.mul(rs, g.mul(g.maximum(vert, 0.35), rust))
        rc = g.mix(g.smooth(dr, 0.25, 0.7), g.mix(S.n(30.0), S.col(rust_cols[0]), S.col(rust_cols[1])),
                   S.col('#3a1a0b'))
        ch['albedo'] = g.mix(g.mul(rs, 0.92), ch['albedo'], rc)
        ch['rough'] = g.mixf(rs, ch['rough'], 0.82)
        ch['metal'] = g.mixf(rs, ch['metal'], 0.08)
    if grime > 0:
        gs = g.smooth(g.mul(dg, g.add(0.4, g.mul(fine, 1.0))), 0.16, 0.7)
        gs = g.mul(gs, g.mul(vert, grime))
        ch['albedo'] = g.mix(g.mul(gs, 0.6), ch['albedo'], grime_mul, blend='MULTIPLY')
    return dc


def _crevices(S, ch, dc, k=1.0, col='#221b14'):
    g = S.g
    cv = g.mul(g.smooth(dc, 0.08, 0.6), k)
    ch['albedo'] = g.mix(g.mul(cv, 0.75), ch['albedo'], S.col(col))
    ch['rough'] = g.mixf(cv, ch['rough'], 0.92)
    ch['metal'] = g.mixf(cv, ch['metal'], 0.0)


def _dents(S, ch, depth, density=0.35):
    """Shallow dents (bowls up to ~20 cm) and a slight waviness in panels."""
    if depth <= 0:
        return
    g = S.g
    d = g.voronoi(S.P, 2.4)
    r = g.sep(g.voronoi(S.P, 2.4, out='Color'))[0]
    bowl = g.smooth(d, 0.45, 0.0)
    dent = g.mul(g.mul(bowl, bowl), g.smooth(g.sub(density, r), 0.0, 0.06))
    d2 = g.voronoi(g.vadd(S.P, (3.3, 1.7, 0.9)), 6.0)
    r2 = g.sep(g.voronoi(g.vadd(S.P, (3.3, 1.7, 0.9)), 6.0, out='Color'))[1]
    small = g.mul(g.smooth(d2, 0.4, 0.0), g.smooth(g.sub(density * 0.6, r2), 0.0, 0.06))
    _hadd(S, ch, g.sub(0.0, g.add(dent, g.mul(small, 0.5))), depth)
    _hadd(S, ch, S.n(1.8, 2, 0.5), depth * 0.3)


def _bleach(S, ch, k=0.4):
    """Sun-faded, chalky paint on surfaces facing the sky."""
    g = S.g
    top = g.mul(g.smooth(S.up, 0.4, 0.9), g.smooth(S.n(1.3, 3, 0.5), 0.3, 0.7))
    ch['albedo'] = g.mix(g.mul(top, k), ch['albedo'], g.hsv(ch['albedo'], 0.5, 0.72, 1.28))


def _steps(S, ch, top=0.75):
    """Paint worn through in patches on treads, running boards, bumpers and
    footholds (flat surfaces low down)."""
    g = S.g
    step = g.mul(g.smooth(S.up, 0.7, 0.95), g.smooth(S.Z, top, top * 0.6))
    wear = g.smooth(g.add(g.mul(step, 0.45), g.mul(S.n(11.0, 5, 0.65), 0.6)), 0.76, 0.84)
    wear = g.mul(wear, step)
    steel = g.mix(S.n(40.0), S.col('#2e2d2b'), S.col('#55524c'))
    ch['albedo'] = g.mix(wear, ch['albedo'], steel)
    ch['rough'] = g.mixf(wear, ch['rough'], 0.42)
    ch['metal'] = g.mixf(wear, ch['metal'], 0.75)


def _scratches(S, ch, k=1.0):
    g = S.g
    sc = g.smooth(S.n(26.0, 2, 0.5, stretch=(1, 1, 14), kind='RIDGED_MULTIFRACTAL'), 0.93, 0.985)
    sc2 = g.smooth(S.n(31.0, 2, 0.5, stretch=(14, 1, 1), kind='RIDGED_MULTIFRACTAL'), 0.93, 0.985)
    sc = g.mul(g.maximum(sc, sc2), k)
    ch['albedo'] = g.mix(g.mul(sc, 0.55), ch['albedo'], S.col('#77736a'))
    ch['rough'] = g.mixf(g.mul(sc, 0.6), ch['rough'], 0.35)
    _hadd(S, ch, g.sub(0.0, sc), 0.0004)


def _wet_low(S, ch, top, k=0.6):
    """Damp wicking up from the ground: darker, a ragged tide line."""
    g = S.g
    t = g.map_range(S.Z, 0.0, top, 1.0, 0.0)
    wet = g.smooth(g.add(t, g.mul(g.sub(S.n(4.0, 4, 0.6), 0.5), 0.5)), 0.35, 0.5)
    wet = g.mul(wet, k)
    ch['albedo'] = g.mix(wet, ch['albedo'], (0.58, 0.56, 0.52), blend='MULTIPLY')
    ch['rough'] = g.mixf(g.mul(wet, 0.6), ch['rough'], 0.6)
    return wet


def _algae(S, ch, top, k=1.0):
    """Green-black algae and moss creeping up from the ground."""
    g = S.g
    t = g.map_range(S.Z, 0.0, top, 1.0, 0.0)
    m = g.smooth(g.add(g.mul(t, 0.9), g.mul(S.n(5.0, 5, 0.65), 0.6)), 0.75, 0.9)
    m = g.mul(m, k)
    mc = g.mix(S.n(25.0, 4), S.col('#1f2716'), S.col('#4a5a26'))
    ch['albedo'] = g.mix(g.mul(m, 0.85), ch['albedo'], mc)
    ch['rough'] = g.mixf(m, ch['rough'], 0.95)
    _hadd(S, ch, g.mul(m, S.n(60.0, 3)), 0.0015)


# -- overlays by family ------------------------------------------------------

def _ov_paint(S, key, ch):
    g = S.g
    kind = CTX.get('kind', 'prop')
    line, _, _, dent = KIND[kind]
    _dents(S, ch, dent, 0.45 if kind == 'wreck' else 0.3)
    _bleach(S, ch, 0.25 if kind in ('vehicle', 'wreck', 'gun') else 0.15)
    _scratches(S, ch, 1.0 if kind != 'small' else 0.7)
    dc = _streaks(S, ch, rust=1.25 if kind == 'wreck' else 1.0, grime=1.0)
    _crevices(S, ch, dc, 1.0)
    if kind in ('vehicle', 'wreck', 'gun'):
        _steps(S, ch)
    _mud(S, ch, line, cake=0.6 if kind in ('vehicle', 'wreck', 'gun') else 0.0)
    if kind in ('vehicle', 'wreck', 'gun'):
        _arches(S, ch, 1.5 if kind != 'gun' else 0.9)
    return ch


def _ov_steel(S, key, ch):
    kind = CTX.get('kind', 'prop')
    line = KIND[kind][0]
    dc = _streaks(S, ch, rust=0.9 if key != 'gun_metal' else 0.3, grime=0.8)
    _crevices(S, ch, dc, 1.0, '#1e1810')
    _mud(S, ch, line, cake=0.5 if kind in ('vehicle', 'wreck', 'gun') else 0.0)
    if kind in ('vehicle', 'wreck', 'gun'):
        _arches(S, ch, 1.5)
    return ch


def _ov_burnt(S, key, ch):
    kind = CTX.get('kind', 'wreck')
    _dents(S, ch, KIND[kind][3] * 1.2, 0.5)
    dc = _streaks(S, ch, rust=1.3, grime=1.2, rust_cols=('#5a2a10', '#9a5424'), grime_mul=(0.35, 0.33, 0.3))
    _crevices(S, ch, dc, 1.0, '#120f0c')
    _mud(S, ch, KIND[kind][0] * 0.8, cake=0.4)
    return ch


def _ov_wood(S, key, ch):
    """Weathered timber: silver-grey where the sky reaches it, darker damp
    end grain low down, rust from nail heads, algae at the foot."""
    g = S.g
    kind = CTX.get('kind', 'prop')
    line = KIND[kind][0]
    a = ch['albedo']
    grey = g.hsv(a, 0.5, 0.2, 0.92)
    grey = g.mix(0.5, grey, S.col('#77736a'))
    expo = g.add(g.mul(g.smooth(S.up, 0.3, 0.85), 0.8), 0.18 if kind in ('wood', 'prop') else 0.08)
    expo = g.mul(expo, g.smooth(g.add(S.n(2.0, 4, 0.6), g.mul(S.edge, 0.4)), 0.3, 0.6))
    ch['albedo'] = g.mix(g.mul(expo, 0.85), a, grey)
    if 'old' in key:            # old timber is already grey: keep it from going chalky
        ch['albedo'] = g.mix(1.0, ch['albedo'], (0.8, 0.79, 0.77), blend='MULTIPLY')
    # checks (drying cracks) along the grain, most on sky-facing surfaces
    crk = g.smooth(S.n(9.0, 3, 0.5, stretch=(1, 1, 1), kind='RIDGED_MULTIFRACTAL'), 0.94, 0.99)
    crk = g.mul(crk, g.maximum(g.smooth(S.up, 0.5, 0.9), 0.45))
    ch['albedo'] = g.mix(g.mul(crk, 0.6), ch['albedo'], S.col('#1c1610'))
    _hadd(S, ch, g.sub(0.0, crk), 0.002)
    dc = _streaks(S, ch, rust=0.6, grime=0.9, rust_cols=('#3a1c0c', '#6e3a1a'))
    _crevices(S, ch, dc, 0.9)
    if kind in ('wood', 'concrete', 'bags'):
        _wet_low(S, ch, line * 0.7, 0.6)
        _algae(S, ch, line * 0.6, 0.9)
    _mud(S, ch, line, drops=0.7)
    return ch


def _ov_canvas(S, key, ch):
    """Canvas that has been rained on: water standing dark in the hollows of
    sagging tops, folds, mildew, mud low down."""
    g = S.g
    kind = CTX.get('kind', 'prop')
    line = KIND[kind][0]
    folds = S.n(4.0, 4, 0.6, stretch=(1, 1, 3.0))
    ridge = g.one_minus(g.mul(g.absolute(g.sub(folds, 0.5)), 2.0))
    _hadd(S, ch, g.smooth(ridge, 0.5, 1.0), 0.003)
    top = g.smooth(S.up, 0.25, 0.75)
    hint = g.attribute('wet')
    pool = g.smooth(g.add(g.add(g.mul(g.smooth(S.ao, 0.98, 0.7), 0.5), g.mul(hint, 0.9)), g.mul(S.n(1.6, 4, 0.6), 0.9)),
                    0.72, 0.82)
    pool = g.mul(pool, top)
    ch['albedo'] = g.mix(g.mul(pool, 0.9), ch['albedo'], (0.5, 0.5, 0.47), blend='MULTIPLY')
    ch['rough'] = g.mixf(pool, ch['rough'], 0.42)
    damp = g.mul(g.smooth(S.n(2.0, 4, 0.6), 0.45, 0.7), 0.5)
    ch['albedo'] = g.mix(damp, ch['albedo'], (0.78, 0.78, 0.74), blend='MULTIPLY')
    mil = g.mul(g.smooth(g.voronoi(S.P, 30.0), 0.18, 0.05), g.smooth(S.n(3.0, 4, 0.6), 0.6, 0.72))
    ch['albedo'] = g.mix(g.mul(mil, 0.6), ch['albedo'], S.col('#23251b'))
    dc = _streaks(S, ch, rust=0.15, grime=1.0)
    _crevices(S, ch, dc, 0.8)
    _mud(S, ch, line, drops=0.8)
    return ch


def _ov_cloth(S, key, ch):
    kind = CTX.get('kind', 'prop')
    dc = _streaks(S, ch, rust=0.0, grime=0.6)
    _crevices(S, ch, dc, 0.8)
    _mud(S, ch, KIND[kind][0], drops=0.6)
    return ch


def _ov_misc(S, key, ch):
    kind = CTX.get('kind', 'prop')
    dc = _streaks(S, ch, rust=0.2, grime=0.6)
    _crevices(S, ch, dc, 0.9)
    _scratches(S, ch, 0.6)
    _mud(S, ch, KIND[kind][0] * 0.8, drops=0.6)
    return ch


def _ov_ground(S, key, ch):
    return ch


def _ov_sandbag(S, key, ch):
    g = S.g
    kind = CTX.get('kind', 'bags')
    line = KIND[kind][0]
    dc = _streaks(S, ch, rust=0.0, grime=0.35, grime_mul=(0.6, 0.55, 0.48))
    _crevices(S, ch, dc, 1.0, '#1c160f')
    _wet_low(S, ch, line * 0.9, 0.75)
    _algae(S, ch, line * 0.55, 0.7)
    _mud(S, ch, line, drops=0.8)
    return ch


def _ov_concrete(S, key, ch):
    kind = CTX.get('kind', 'concrete')
    line = KIND[kind][0]
    dc = _streaks(S, ch, rust=0.7, grime=1.2, rust_cols=('#4a2a14', '#7e4a24'), grime_mul=(0.4, 0.42, 0.36))
    _crevices(S, ch, dc, 0.8, '#26231d')
    _wet_low(S, ch, line, 0.7)
    _algae(S, ch, line * 0.7, 1.0)
    _mud(S, ch, line * 0.6, drops=0.5)
    return ch


def _ov_rubber(S, key, ch):
    kind = CTX.get('kind', 'prop')
    dc = _streaks(S, ch, rust=0.0, grime=0.4, grime_mul=(0.7, 0.68, 0.62))
    _crevices(S, ch, dc, 1.0, '#3a3024')
    _mud(S, ch, KIND[kind][0], cake=0.8)
    if kind in ('vehicle', 'wreck', 'gun'):
        _arches(S, ch, 1.2)
    return ch


def _ov_glass(S, key, ch):
    g = S.g
    _, dg, _ = _drip(S)
    film = g.smooth(g.add(S.n(2.5, 4, 0.6), g.mul(S.edge, 0.6)), 0.35, 0.95)
    runs = g.smooth(g.mul(dg, g.add(0.3, S.n(40.0, 3, 0.6, stretch=(1, 1, 0.1)))), 0.35, 0.7)
    dust = g.add(g.mul(film, 0.45), g.mul(runs, 0.15))
    ch['albedo'] = g.mix(dust, ch['albedo'], S.col('#4e4a40'))
    ch['rough'] = g.mixf(dust, ch['rough'], 0.6)
    return ch


OVERLAY = {
    'paint': _ov_paint, 'steel': _ov_steel, 'burnt': _ov_burnt, 'wood': _ov_wood, 'canvas': _ov_canvas,
    'cloth': _ov_cloth, 'misc': _ov_misc, 'sandbag': _ov_sandbag, 'concrete': _ov_concrete,
    'rubber': _ov_rubber, 'glass': _ov_glass,
}
FAMILY = {}
for _k in ('camo_de', 'paint_sand', 'metal_olive', 'metal_gray', 'olive_wreck', 'helmet_gray', 'helmet_od',
           'paint_red', 'paint_white', 'plate', 'stencil_paint_sand', 'stencil_metal_olive'):
    FAMILY[_k] = 'paint'
for _k in ('metal_dark', 'iron', 'wire', 'gun_metal', 'gun_metal_worn', 'rust'):
    FAMILY[_k] = 'steel'
for _k in ('burnt_body', 'rust_dark', 'burnt'):
    FAMILY[_k] = 'burnt'
for _k in ('wood', 'wood_dark', 'wood_old', 'wood_h', 'wood_dark_h', 'wood_old_h', 'paint_black', 'paint_yellow',
           'stencil_wood', 'stencil_wood_old', 'stencil_wood_dark'):
    FAMILY[_k] = 'wood'
for _k in ('canvas', 'canvas_gray'):
    FAMILY[_k] = 'canvas'
for _k in ('webbing', 'cloth_od', 'cloth_od_dark', 'cloth_khaki', 'cloth_feldgrau', 'cloth_feldgrau_dark',
           'leather', 'leather_black'):
    FAMILY[_k] = 'cloth'
for _k in ('bakelite', 'roof_slate', 'stone'):
    FAMILY[_k] = 'misc'
FAMILY.update({'sandbag': 'sandbag', 'concrete': 'concrete', 'concrete_camo': 'concrete', 'rubber': 'rubber',
               'glass': 'glass'})


def _weathered(fn):
    def recipe(S, key):
        ch = fn(S, key)
        fam = FAMILY.get(key)
        if fam and CTX.get('obj') is not None:
            ch = OVERLAY[fam](S, key, ch)
        return ch
    recipe.v3 = True
    recipe.base = fn
    return recipe


# -- v3 base recipes (replace the shared ones in this process only) -----------

def r_sandbag3(S, key):
    """Hessian sacks filled with earth: coarse open weave, slubs, creases
    where the sack is drawn tight, each bag its own tone, tops bleached,
    undersides dark with wet."""
    g = S.g
    tone = g.attribute('tone')
    wetv = g.attribute('wet')
    base = g.mix(tone, S.col('#6a5a41'), S.col('#a3926c'))
    base = S.tint(base, S.n(0.9, 2, 0.5), 0.9, 1.08)
    base = S.tint(base, S.n(3.5, 3, 0.5), 0.88, 1.08)
    wu = S.n(150.0, 2, 0.6, vec=S.UV, stretch=(1, 8, 1))
    wv = S.n(150.0, 2, 0.6, vec=S.UV, stretch=(8, 1, 1))
    weave = g.mul(g.add(wu, wv), 0.5)
    slub = g.smooth(S.n(40.0, 3, 0.6, vec=S.UV, stretch=(1, 10, 1)), 0.68, 0.8)
    alb = S.tint(base, weave, 0.78, 1.14)
    alb = g.mix(g.mul(slub, 0.4), alb, g.hsv(base, 0.5, 0.8, 0.78))
    crease = S.n(5.0, 4, 0.6, stretch=(1, 1, 2.2))
    ridge = g.smooth(g.one_minus(g.mul(g.absolute(g.sub(crease, 0.5)), 2.0)), 0.75, 1.0)
    alb = g.mix(g.mul(ridge, 0.35), alb, (0.62, 0.58, 0.52), blend='MULTIPLY')
    top = g.mul(g.smooth(S.up, 0.35, 0.85), g.smooth(S.n(1.5, 3), 0.3, 0.65))
    alb = g.mix(g.mul(top, 0.45), alb, g.hsv(alb, 0.5, 0.65, 1.22))
    under = g.smooth(S.up, 0.0, -0.6)
    alb = g.mix(g.mul(under, 0.75), alb, (0.5, 0.47, 0.42), blend='MULTIPLY')
    # the lower part of every bag stays wet: dark, with a ragged tide line
    wb = g.smooth(g.add(wetv, g.mul(g.sub(S.n(6.0, 4, 0.6), 0.5), 0.5)), 0.5, 0.62)
    alb = g.mix(g.mul(wb, 0.85), alb, (0.56, 0.52, 0.46), blend='MULTIPLY')
    under = g.maximum(under, g.mul(wb, 0.6))
    stain = g.smooth(S.n(3.0, 4, 0.6), 0.58, 0.72)
    alb = g.mix(g.mul(stain, 0.5), alb, S.col('#4a3c2a'))
    h = g.add(g.mul(weave, 0.45), g.mul(S.n(7.0), 0.25))
    h = g.sub(h, g.mul(ridge, 0.6))
    rough = g.mixf(under, 0.95, 0.8)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.55, dist=0.008)


def r_concrete3(S, key):
    """Board-formed wartime concrete: course lines and grain of the shuttering
    boards, panel joints with a grout fin, tie holes weeping rust, lime
    leaching white under the joints, air pits, chipped arrises showing the
    aggregate."""
    g = S.g
    nx, ny, nz = g.sep(S.N)
    px, py, pz = g.sep(S.Pobj)
    tt = g.sub(g.mul(px, ny), g.mul(py, nx))          # horizontal along a wall
    z = S.Z
    alb = S.tint(S.col('#6d6a62'), S.n(1.4, 4, 0.6), 0.78, 1.1)
    alb = S.tint(alb, S.n(6.0, 4, 0.6), 0.9, 1.06)
    # shuttering boards 16 cm: per-course tone, grain, fins at the joints
    cz = g.mul(z, 1 / 0.16)
    course = g.floor(cz)
    fz = g.fract(cz)
    ctone = _wn(S, g.combine(course, 3.1, 0.0))
    alb = S.tint(alb, ctone, 0.88, 1.07)
    grain = S.n(1.0, 4, 0.6, vec=g.combine(g.mul(tt, 2.0), g.mul(z, 60.0), g.mul(course, 1.7)))
    alb = S.tint(alb, grain, 0.93, 1.05)
    seam = g.smooth(g.minimum(fz, g.one_minus(fz)), 0.045, 0.0)
    vert = g.smooth(g.absolute(nz), 0.6, 0.3)
    seam = g.mul(seam, vert)
    alb = g.mix(g.mul(seam, 0.8), alb, (0.72, 0.7, 0.67), blend='MULTIPLY')
    # panel joints every 1.25 m along, 1.28 m up (8 courses): grout fins
    ft = g.fract(g.mul(tt, 1 / 1.25))
    pj = g.mul(g.smooth(g.minimum(ft, g.one_minus(ft)), 0.006, 0.0), vert)
    fp = g.fract(g.mul(z, 1 / 1.28))
    hj = g.mul(g.smooth(g.minimum(fp, g.one_minus(fp)), 0.01, 0.0), vert)
    joint = g.maximum(pj, hj)
    alb = g.mix(g.mul(joint, 0.4), alb, S.col('#9c988c'))
    # lime leaching below the horizontal joints, white and streaky
    below = g.fract(g.mul(g.sub(z, 0.002), 1 / 1.28))
    dz = g.mul(g.one_minus(below), 1.28)                    # metres below the joint above
    lime_st = S.n(1.0, 3, 0.6, vec=g.combine(g.mul(tt, 45.0), g.mul(z, 2.0), 0.0))
    lime = g.mul(g.smooth(dz, 0.35, 0.0), g.smooth(lime_st, 0.55, 0.75))
    lime = g.mul(g.mul(lime, vert), g.smooth(S.n(1.2, 3, 0.5), 0.35, 0.55))
    alb = g.mix(g.mul(lime, 0.7), alb, S.col('#cdc9bd'))
    # tie holes on a 0.6 m grid, rust weeping below them
    ht = g.sub(tt, g.mul(g.floor(g.add(g.mul(tt, 1 / 0.6), 0.5)), 0.6))
    hz0 = g.add(g.mul(g.floor(g.mul(g.sub(z, 0.3), 1 / 0.6)), 0.6), 0.3)
    hz = g.sub(z, g.add(hz0, 0.6))                          # <= 0 below the next hole up
    hz_near = g.sub(z, g.add(g.mul(g.floor(g.add(g.mul(g.sub(z, 0.3), 1 / 0.6), 0.5)), 0.6), 0.3))
    rr = g.add(g.mul(ht, ht), g.mul(hz_near, hz_near))
    hole = g.mul(g.smooth(rr, 0.00018, 0.00008), vert)
    drop = g.absolute(hz)
    weep = g.mul(g.smooth(g.absolute(ht), g.add(0.006, g.mul(drop, 0.03)), 0.0), g.smooth(drop, 0.3, 0.0))
    weep = g.mul(g.mul(weep, vert), g.smooth(S.n(2.0, 3, 0.5, vec=g.combine(g.mul(tt, 30.0), z, 0.0)), 0.35, 0.6))
    alb = g.mix(g.mul(weep, 0.75), alb, g.mix(S.n(20.0), S.col('#5a3218'), S.col('#8a5428')))
    alb = g.mix(hole, alb, S.col('#2a2520'))
    # air pits
    pits = g.smooth(g.voronoi(S.P, 70.0, rand=1.0), 0.07, 0.02)
    pits = g.mul(pits, g.smooth(S.n(5.0), 0.45, 0.65))
    alb = g.mix(g.mul(pits, 0.75), alb, S.col('#35322d'))
    # chipped arrises: aggregate in a darker matrix
    chip = g.smooth(g.add(g.mul(S.edge, 0.85), g.mul(S.n(7.0, 5, 0.65), 0.55)), 0.86, 0.9)
    stones = g.voronoi(S.P, 85.0, out='Color')
    sd = g.voronoi(S.P, 85.0)
    agg = g.mix(g.sep(stones)[0], S.col('#5a5650'), S.col('#a9a49a'))
    agg = g.mix(g.smooth(g.sep(stones)[1], 0.75, 0.8), agg, S.col('#7a6650'))
    agg = g.mix(g.smooth(sd, 0.28, 0.4), agg, S.col('#4e4a43'))
    alb = g.mix(chip, alb, agg)
    h = g.add(0.6, g.mul(grain, 0.06))
    h = g.add(h, g.mul(seam, 0.05))
    h = g.add(h, g.mul(joint, 0.2))
    h = g.sub(h, g.mul(pits, 0.25))
    h = g.sub(h, g.mul(hole, 0.6))
    h = g.sub(h, g.mul(chip, g.add(0.35, g.mul(g.smooth(sd, 0.35, 0.1), -0.25))))
    rough = g.mixf(lime, g.map_range(S.n(10.0), 0, 1, 0.84, 0.97), 0.97)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.7, dist=0.02)


def r_concrete_camo3(S, key):
    """The v3 concrete with weathered camouflage blotches painted on."""
    g = S.g
    d = r_concrete3(S, 'concrete')
    green, brown = S.col('#5a6040'), S.col('#6a5038')
    b1 = g.smooth(S.n(0.55, 3, 0.5), 0.55, 0.6)
    b2 = g.smooth(g.noise(g.vadd(S.P, (11.0, 5.0, 2.0)), 0.7, detail=3, rough=0.5), 0.57, 0.62)
    flake = g.smooth(g.add(S.n(9.0, 5, 0.6), g.mul(S.edge, 0.4)), 0.68, 0.62)
    alb = g.mix(g.mul(b1, flake), d['albedo'], S.tint(green, S.n(5.0), 0.8, 1.1))
    alb = g.mix(g.mul(b2, flake), alb, S.tint(brown, S.n(5.0), 0.8, 1.1))
    d['albedo'] = alb
    return d


def r_tyre(S, key):
    """Tyre rubber: dark, faintly grey where dusty, brown-grey bloom on the
    sidewalls, worn smooth and a little glossy on the tread, fine cracking."""
    g = S.g
    nx = g.sep(S.N)[0]
    side = g.smooth(g.absolute(nx), 0.5, 0.85)
    alb = S.tint(S.col('#1d1c1b'), S.n(20.0), 0.85, 1.15)
    bloom = g.mul(side, g.smooth(S.n(4.0, 4, 0.6), 0.35, 0.7))
    alb = g.mix(g.mul(bloom, 0.6), alb, S.col('#4a453d'))
    crack = g.mul(g.smooth(g.voronoi_edge(g.vscale(S.P, (1, 1, 1)), 90.0), 0.03, 0.0), side)
    alb = g.mix(g.mul(crack, 0.5), alb, S.col('#0e0e0d'))
    rough = g.mixf(side, 0.72, 0.9)
    h = g.sub(g.mul(S.n(70.0), 0.4), g.mul(crack, 0.3))
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.3, dist=0.004)


def r_glass3(S, key):
    g = S.g
    alb = S.tint(S.col('#12171b'), S.n(3.0), 0.8, 1.2)
    rough = g.map_range(S.n(12.0), 0, 1, 0.05, 0.18)
    return dict(albedo=alb, rough=rough, metal=0.0, height=0.5, bump=0.0, dist=0.01)


def _glyph_mask(S, cw, lh, seed, fill=0.55):
    """Stencil lettering on a grid of `cw` x `lh` metres in the box UVs:
    every character is a few of seven strokes (three bars, four uprights),
    the strokes stopping short of each other like the bridges of a stencil;
    a few blanks between words."""
    g = S.g
    cu, cv = g.mul(S.U, 1 / cw), g.mul(S.V, 1 / lh)
    iu, iv = g.floor(cu), g.floor(cv)
    fu, fv = g.fract(cu), g.fract(cv)

    def box(u0, u1, v0, v1):
        e = 0.03
        return g.mul(g.mul(g.smooth(fu, u0 - e, u0), g.smooth(fu, u1 + e, u1)),
                     g.mul(g.smooth(fv, v0 - e, v0), g.smooth(fv, v1 + e, v1)))
    sw, sh = 0.1, 0.07          # stroke half-widths across / along the cell
    strokes = [box(0.26, 0.74, 0.86 - sh, 0.86 + sh), box(0.26, 0.74, 0.5 - sh, 0.5 + sh),
               box(0.26, 0.74, 0.14 - sh, 0.14 + sh),
               box(0.2 - sw, 0.2 + sw, 0.56, 0.8), box(0.2 - sw, 0.2 + sw, 0.2, 0.44),
               box(0.8 - sw, 0.8 + sw, 0.56, 0.8), box(0.8 - sw, 0.8 + sw, 0.2, 0.44)]
    m = 0.0
    for k, st in enumerate(strokes):
        on = g.smooth(_wn(S, g.combine(g.add(g.mul(iu, 7.13), k * 1.31), g.add(g.mul(iv, 3.77), k * 0.71), seed)),
                      1.0 - fill - 0.01, 1.0 - fill + 0.01)
        m = g.maximum(m, g.mul(st, on))
    space = g.smooth(_wn(S, g.combine(iu, iv, seed + 9.0)), 0.16, 0.18)
    return g.mul(m, space)


def r_stencil(base_key, ink, cw=0.022, lh=0.034):
    """Stencilled lettering, worn, on the material `base_key`."""
    def r(S, key):
        import surfaces
        g = S.g
        base = surfaces.RECIPES[base_key]
        d = getattr(base, 'base', base)(S, base_key)
        m = _glyph_mask(S, cw, lh, 3.0)
        worn = g.smooth(g.add(g.mul(S.n(30.0, 4, 0.6), 0.6), g.mul(S.n(4.0), 0.4)), 0.6, 0.48)
        m = g.mul(m, worn)
        d['albedo'] = g.mix(g.mul(m, 0.92), d['albedo'], S.tint(S.col(ink), S.n(40.0), 0.85, 1.1))
        d['rough'] = g.mixf(m, d['rough'], 0.7)
        return d
    return r


def r_plate(S, key):
    """A Wehrmacht number plate: white enamel, black characters, rusty rim."""
    g = S.g
    alb = S.tint(S.col('#cfcabd'), S.n(6.0), 0.85, 1.05)
    m = _glyph_mask(S, 0.045, 0.1, 5.0, fill=0.6)
    alb = g.mix(m, alb, S.col('#161514'))
    d = dict(albedo=alb, rough=0.5, metal=0.0, height=0.5, bump=0.3, dist=0.004)
    chip = g.smooth(g.add(g.mul(S.edge, 0.8), g.mul(S.n(14.0, 5, 0.7), 0.5)), 0.72, 0.78)
    d['albedo'] = g.mix(chip, d['albedo'], g.mix(S.n(30.0), S.col('#4a2410'), S.col('#7a4020')))
    return d


def r_sand(S, key):
    """Earth and sand run out of a split sack: damp, grainy, a few pebbles,
    darker where it is wet underneath."""
    g = S.g
    alb = g.mix(S.n(9.0, 5, 0.6), S.col('#7a6a50'), S.col('#ab9a76'))
    alb = S.tint(alb, S.n(2.5, 3, 0.5), 0.85, 1.1)
    clods = g.smooth(g.voronoi(S.P, 22.0), 0.3, 0.1)
    alb = g.mix(g.mul(clods, 0.35), alb, S.col('#5c4c38'))
    grains = S.n(160.0, 2, 0.6)
    alb = S.tint(alb, grains, 0.85, 1.12)
    peb = g.smooth(g.voronoi(S.P, 90.0, rand=1.0), 0.12, 0.05)
    peb = g.mul(peb, g.smooth(S.n(7.0), 0.5, 0.65))
    alb = g.mix(g.mul(peb, 0.45), alb, g.mix(S.n(40.0), S.col('#5a564e'), S.col('#8c8576')))
    wet = g.smooth(g.add(g.map_range(S.Z, 0.0, 0.05, 1.0, 0.0), g.mul(S.n(4.0), 0.5)), 0.7, 1.0)
    alb = g.mix(g.mul(wet, 0.8), alb, (0.62, 0.58, 0.52), blend='MULTIPLY')
    h = g.add(g.add(g.mul(grains, 0.3), g.mul(peb, 0.6)), g.mul(clods, 0.8))
    return dict(albedo=alb, rough=g.mixf(wet, 0.95, 0.75), metal=0.0, height=h, bump=0.8, dist=0.008)


def r_crack(S, key):
    """The inside of a split in timber: dark, fibrous."""
    g = S.g
    alb = g.mix(S.n(60.0, 3, 0.6, stretch=(1, 1, 0.2)), S.col('#120d09'), S.col('#3a2a1c'))
    return dict(albedo=alb, rough=0.95, metal=0.0, height=S.n(60.0), bump=0.4, dist=0.003)


def spill(obj, ray_from, ray_dir, seed, size=1.0):
    """A split sack: a ragged tear where the ray from `ray_from` along
    `ray_dir` meets the wall, the fill run out of it down the face and
    heaped at the foot. Returns the new geometry object (join it)."""
    from mathutils.bvhtree import BVHTree
    rng = random.Random(seed)
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(obj, dg)
    d = V(ray_dir).normalized()
    side = V((0, 0, 1)).cross(d).normalized()
    best = None                 # the most proud point nearby: the belly of a bag, not a crevice
    for i in range(-5, 6):
        for j in (-1, 0, 1):
            o = V(ray_from) + side * (i * 0.03) + V((0, 0, j * 0.03))
            r = tree.ray_cast(o, d, 6.0)
            if r[0] is not None and (best is None or r[3] < best[3] - 1e-4):
                best = r
    if best is None:
        return None
    hit, n = best[0], best[1]
    n = V((n.x, n.y, 0.0)).normalized() if abs(n.z) < 0.9 else -d
    t = V((0, 0, 1)).cross(n).normalized()
    m = Mesh()
    # the tear: a lens-shaped hole, the fill showing, frayed hessian lips
    K = 12
    Lh, Wh = rng.uniform(0.15, 0.2) * size, rng.uniform(0.045, 0.065) * size
    lip, hole = [], []
    for k in range(K):
        a = 2 * math.pi * k / K
        j = rng.uniform(0.85, 1.2)
        q = hit + t * (math.cos(a) * Lh / 2 * j) + V((0, 0, math.sin(a) * Wh / 2 * j))
        lip.append(m.vert(q + n * 0.012, 0.0))
        hole.append(m.vert(q * 0.7 + hit * 0.3 + n * (0.004 - 0.01 * rng.random()), 0.3))
    c = m.vert(hit - n * 0.012, 0.6)
    for k in range(K):
        k1 = (k + 1) % K
        m.face((lip[k], lip[k1], hole[k1], hole[k]), 'sandbag', True)
        m.face((hole[k], hole[k1], c), 'sand_spill', True)
    # the fill has run out of the tear and down to the foot of the wall
    foot = None
    z = hit.z - Wh * 0.4
    while z > 0.02:
        h2 = tree.ray_cast(V((hit.x, hit.y, z)) + n * 0.5, -n, 1.5)
        if h2[0] is not None:
            foot = h2[0]
        z -= 0.05
    # the heap at the foot
    foot = foot or hit
    base = V((foot.x, foot.y, 0.0)) + n * rng.uniform(0.06, 0.1) * size
    R = rng.uniform(0.26, 0.34) * size
    Hh = rng.uniform(0.12, 0.16) * size
    rings = []
    NS = 20
    lob = [rng.uniform(0.85, 1.15) for _ in range(NS)]
    lob = [(lob[k - 1] + 2 * lob[k] + lob[(k + 1) % NS]) / 4 for k in range(NS)]
    for i, f in enumerate((1.0, 0.86, 0.7, 0.52, 0.34, 0.16)):
        ring = []
        for k in range(NS):
            a = 2 * math.pi * k / NS
            rr = R * f * lob[k] * rng.uniform(0.95, 1.05) * (1.0 + 0.3 * max(0.0, math.sin(a)))
            p = base + t * (math.cos(a) * rr) + n * (math.sin(a) * rr * 0.75)
            zz = Hh * (1 - f) ** 0.7 * rng.uniform(0.9, 1.08)
            ring.append(V((p.x, p.y, zz + (0.004 if i == 0 else 0.0))))
        rings.append(ring)
    ids = [[m.vert(p, 0.3 if i == 0 else 0.0) for p in r] for i, r in enumerate(rings)]
    for i in range(len(ids) - 1):
        a, b = ids[i], ids[i + 1]
        for k in range(NS):
            k1 = (k + 1) % NS
            m.face((a[k], a[k1], b[k1], b[k]), 'sand_spill', True)
    top = m.vert(base + V((0, 0, Hh)), 0.0)
    for k in range(NS):
        m.face((ids[-1][k], ids[-1][(k + 1) % NS], top), 'sand_spill', True)
    return m.build('spill')


def split_end(mesh, top, axis, across, width, depth, rng, mat='crack'):
    """A drying split in the end of a post or beam: a thin dark wedge in the
    end grain at `top` (end centre), running `depth` back along -`axis`,
    across the full `width` along `across` (both unit vectors)."""
    ax, ac = V(axis).normalized(), V(across).normalized()
    side = ax.cross(ac).normalized()
    gap = rng.uniform(0.003, 0.006)
    hw = width / 2 + 0.002
    off = side * rng.uniform(-0.2, 0.2) * width
    p = [V(top) + off + ac * (-hw) + side * (-gap / 2) + ax * 0.001, V(top) + off + ac * hw + side * (-gap / 2) + ax * 0.001,
         V(top) + off + ac * hw + side * (gap / 2) + ax * 0.001, V(top) + off + ac * (-hw) + side * (gap / 2) + ax * 0.001]
    b = [V(top) + off + ac * (-hw) - ax * depth, V(top) + off + ac * hw - ax * depth * rng.uniform(0.6, 0.9)]
    i = [mesh.vert(q, 0.5) for q in p + b]
    mesh.face((i[0], i[1], i[2], i[3]), mat)
    mesh.face((i[0], i[4], i[5], i[1]), mat)
    mesh.face((i[3], i[2], i[5], i[4]), mat)
    mesh.face((i[0], i[3], i[4]), mat)
    mesh.face((i[1], i[5], i[2]), mat)


def _scale_islands(obj):
    """Spend the texels where they are seen: before the pack every UV island
    is scaled by how open its faces are (rays cast from each face; enclosed
    and underside faces get far fewer texels, the rest grow to fill)."""
    from bpy_extras import bmesh_utils
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv['bake']
    tree = BVHTree.FromBMesh(bm)
    dirs = [V((0, 0, 1))] + [V((math.sin(math.radians(55)) * math.cos(a), math.sin(math.radians(55)) * math.sin(a),
                                math.cos(math.radians(55)))) for a in (0.3, 1.87, 3.44, 5.01)]
    open_ = {}
    for f in bm.faces:
        n = f.normal
        if n.length < 0.5:
            open_[f.index] = 1.0
            continue
        q = V((0, 0, 1)).rotation_difference(n)
        c = f.calc_center_median() + n * 0.003
        free = 0
        for d in dirs:
            hit = tree.ray_cast(c, q @ d, 2.5)
            if hit[0] is None:
                free += 1
        open_[f.index] = free / len(dirs)
    for isl in bmesh_utils.bmesh_linked_uv_islands(bm, uv):
        area = sum(f.calc_area() for f in isl)
        if area <= 0:
            continue
        nz = sum(f.normal.z * f.calc_area() for f in isl) / area
        op = sum(open_[f.index] * f.calc_area() for f in isl) / area
        k = (0.3 + 0.7 * op) * (0.45 if nz < -0.55 else 1.0)
        if k > 0.97:
            continue
        pts = [l[uv].uv.copy() for f in isl for l in f.loops]
        c = sum(pts, V((0.0, 0.0))) / len(pts)
        for f in isl:
            for l in f.loops:
                l[uv].uv = c + (l[uv].uv - c) * k
    bm.to_mesh(obj.data)
    bm.free()


# --------------------------------------------------------------------------
# Alpha cards: the camouflage net

def net_material(name='camo_net_cards', size=512, seed=5):
    """An RGBA atlas of diamond netting with cloth garnish strips (1 m per
    tile) and a material that the glTF exporter writes as alphaMode MASK."""
    import numpy as np
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    rng = np.random.default_rng(seed)
    img = bpy.data.images.new(name + '_tex', size, size, alpha=True)
    a = np.zeros((size, size, 4), np.float32)
    yy, xx = np.mgrid[0:size, 0:size] / size
    # diamond mesh, 10 cm openings, twine ~6 mm
    k = 10.0
    d1 = np.abs(((xx + yy) * k) % 1.0 - 0.5)
    d2 = np.abs(((xx - yy) * k) % 1.0 - 0.5)
    net = (np.minimum(d1, d2) > 0.47)
    a[net] = (0.3, 0.27, 0.22, 1.0)
    # byte images hold sRGB values
    cols = np.array([[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)] for h in
                     ('#4a5a30', '#5e6a3a', '#6e5a3c', '#857a56', '#3c4628', '#6a7444', '#8e8060')], np.float32)
    # garnish strips: narrow cloth strips woven through, ~65% cover in clumps
    clump = np.zeros((size, size), np.float32)
    for _ in range(26):
        cx, cy, r = rng.random(), rng.random(), rng.uniform(0.08, 0.2)
        dx = np.minimum(np.abs(xx - cx), 1 - np.abs(xx - cx))
        dy = np.minimum(np.abs(yy - cy), 1 - np.abs(yy - cy))
        clump = np.maximum(clump, 1.0 - np.sqrt(dx * dx + dy * dy) / r)
    for _ in range(1400):
        cx, cy = rng.random(), rng.random()
        if clump[int(cy * size) % size, int(cx * size) % size] < rng.uniform(-0.3, 0.4):
            continue
        ang = rng.uniform(0, math.pi)
        ln, w = rng.uniform(0.04, 0.11), rng.uniform(0.008, 0.02)
        c = cols[rng.integers(len(cols))] * rng.uniform(0.8, 1.15)
        ca, sa = math.cos(ang), math.sin(ang)
        x0, x1 = int((cx - ln) * size), int((cx + ln) * size) + 1
        y0, y1 = int((cy - ln) * size), int((cy + ln) * size) + 1
        ys = np.arange(y0, y1) % size
        xs = np.arange(x0, x1) % size
        gy, gx = np.meshgrid(np.arange(y0, y1) / size - cy, np.arange(x0, x1) / size - cx, indexing='ij')
        u = gx * ca + gy * sa
        v = -gx * sa + gy * ca
        m = (np.abs(u) < ln / 2) & (np.abs(v) < w / 2 * (1 - 0.6 * np.abs(u) / (ln / 2 + 1e-6)))
        sub = a[np.ix_(ys, xs)]
        shade = (0.75 + 0.25 * (v / (w + 1e-6)))[..., None]
        sub[m, :3] = (c * shade)[m]
        sub[m, 3] = 1.0
        a[np.ix_(ys, xs)] = sub
    img.pixels.foreach_set(a.ravel())
    img.update()
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], gt.inputs[0])
    nt.links.new(gt.outputs[0], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.95
    if hasattr(mat, 'blend_method'):
        try:
            mat.blend_method = 'CLIP'
        except Exception:
            pass
    try:
        mat.surface_render_method = 'DITHERED'
    except Exception:
        pass
    mat.use_backface_culling = False
    return mat


# --------------------------------------------------------------------------
# Small reusable props (into Mesh builders)

def bbox_mesh(mesh, size, matrix, mat, bevel=0.01, occ_bottom=0.0, soft=False):
    """A box with chamfered edges (26 faces) into a Mesh builder."""
    sx, sy, sz = (s / 2 for s in size)
    b = min(bevel, sx * 0.45, sy * 0.45, sz * 0.45)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V((size[0], size[1], size[2])), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=1, affect='EDGES', profile=0.5)
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    occ = [occ_bottom if p.z < -sz + b * 1.5 else 0.0 for p in verts]
    return mesh.add(verts, faces, mat, matrix, occ, soft)


def cyl_mesh(mesh, r, length, matrix, mat, sides=8, caps=True, r2=None, soft=True):
    """Cylinder along local Z, centred, into a Mesh builder."""
    r2 = r if r2 is None else r2
    h = length / 2
    pts0 = [matrix @ V((r * math.cos(a), r * math.sin(a), -h)) for a in (2 * math.pi * k / sides for k in range(sides))]
    pts1 = [matrix @ V((r2 * math.cos(a), r2 * math.sin(a), h)) for a in (2 * math.pi * k / sides for k in range(sides))]
    return loft(mesh, [pts0, pts1], mat, closed=True, cap0=caps, cap1=caps, soft=soft)


def ammo_can(mesh, matrix, mat='paint_sand', lid_open=0.0):
    """MG 34/42 Patronenkasten: 0.28 x 0.1 x 0.19 m, ribbed lid, carrying
    handle, latch; origin at the bottom centre."""
    bbox_mesh(mesh, (0.27, 0.098, 0.175), matrix @ trs((0, 0, 0.0875)), mat, 0.008, occ_bottom=0.4)
    for x in (-0.07, 0.07):
        box_mesh(mesh, (0.014, 0.104, 0.16), matrix @ trs((x, 0, 0.0875)), mat)
    lid = trs((0, 0.05, 0.178)) @ Matrix.Rotation(math.radians(-lid_open), 4, 'X') @ trs((0, -0.05, 0.012))
    bbox_mesh(mesh, (0.28, 0.104, 0.024), matrix @ lid, mat, 0.006)
    tube_mesh(mesh, [matrix @ lid @ V(p) for p in ((-0.06, 0, 0.012), (-0.05, 0, 0.035), (0.05, 0, 0.035),
                                                  (0.06, 0, 0.012))], 0.005, 'metal_dark', sides=4)
    box_mesh(mesh, (0.012, 0.05, 0.05), matrix @ trs((0.141, 0, 0.16)), 'metal_dark')
    box_mesh(mesh, (0.09, 0.003, 0.05), matrix @ trs((-0.05, -0.051, 0.1)),
             'stencil_' + mat if mat in ('paint_sand', 'metal_olive') else 'marking_white')


def spent_cases(mesh, rng, centre, radius, n, z=0.0, scale=1.0):
    """Brass cases (7.92 mm) scattered on the ground round `centre`."""
    for _ in range(n):
        a, r = rng.uniform(0, 2 * math.pi), radius * math.sqrt(rng.random())
        p = V(centre) + V((r * math.cos(a), r * math.sin(a), z + 0.0047 * scale))
        m = Matrix.Translation(p) @ Matrix.Rotation(rng.uniform(0, 2 * math.pi), 4, 'Z') @ \
            Matrix.Rotation(math.radians(90 + rng.uniform(-8, 8)), 4, 'Y')
        cyl_mesh(mesh, 0.0047 * scale, 0.057 * scale, m, 'brass', sides=4, caps=True, r2=0.0042 * scale)


def belt(mesh, pts, step=0.0198, link=True):
    # (one round every `step`: a brass case with its bullet, a link every other)
    """An MG belt: cartridges side by side across a polyline of points
    (the belt's centre line), bullets pointing local +X of the path normal."""
    fr = frames_along(pts)
    total = sum((V(pts[i + 1]) - V(pts[i])).length for i in range(len(pts) - 1))
    nrounds = int(total / step)
    seg = 0
    acc = 0.0
    for k in range(nrounds):
        dist = k * step
        while seg < len(pts) - 2 and acc + (V(pts[seg + 1]) - V(pts[seg])).length < dist:
            acc += (V(pts[seg + 1]) - V(pts[seg])).length
            seg += 1
        a, b = V(pts[seg]), V(pts[seg + 1])
        t = (dist - acc) / max((b - a).length, 1e-6)
        p = a.lerp(b, min(1.0, t))
        tang = (b - a).normalized()
        side = tang.cross(V((0, 0, 1))).normalized() if abs(tang.z) < 0.95 else V((1, 0, 0))
        up = tang.cross(side)                  # side, up, tang: right-handed
        m = Matrix((side, up, tang)).transposed().to_4x4()
        rot = Matrix.Translation(p) @ m @ Matrix.Rotation(math.radians(90), 4, 'Y')
        cyl_mesh(mesh, 0.0055, 0.06, rot, 'brass', sides=5, caps=True, r2=0.0047)
        cyl_mesh(mesh, 0.0042, 0.018, rot @ trs((0, 0, 0.039)), 'metal_dark', sides=5, caps=False, r2=0.0012)
        if link and k % 2 == 0:
            box_mesh(mesh, (0.014, 0.02, 0.012), rot @ trs((0, 0, -0.008)), 'metal_dark')


def leaf_spring(mesh, centre, length, width=0.06, leaves=4, mat='metal_dark', arch=0.06, axis='Y'):
    """A semi-elliptic leaf spring along local Y (or X), centred at its eye
    line, leaves shortening downwards, with U-bolts."""
    c = V(centre)
    for i in range(leaves):
        L = length * (1.0 - i * 0.18)
        th = 0.01
        pts = []
        for k in range(7):
            u = -L / 2 + L * k / 6
            z = arch * (1 - (2 * u / length) ** 2) - i * th * 1.05 - arch
            pts.append(V((0, u, z)) if axis == 'Y' else V((u, 0, z)))
        sec = [(-width / 2, -th / 2), (width / 2, -th / 2), (width / 2, th / 2), (-width / 2, th / 2)]
        sweep(mesh, [c + p for p in pts], sec, mat, closed=True, caps=True,
              lateral=(1, 0, 0) if axis == 'Y' else (0, 1, 0))
    for s_ in (-1, 1):
        off = V((0, s_ * 0.05, 0)) if axis == 'Y' else V((s_ * 0.05, 0, 0))
        box_mesh(mesh, (width + 0.025, 0.015, 0.08) if axis == 'Y' else (0.015, width + 0.025, 0.08),
                 Matrix.Translation(c + off + V((0, 0, -0.02))), mat)


def nails(mesh, pts, normal, r=0.006, mat='iron'):
    """Nail / rivet heads: tiny domes on a surface with the given normal."""
    n = V(normal).normalized()
    q = V((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
    for p in pts:
        cyl_mesh(mesh, r, 0.004, Matrix.Translation(V(p) + n * 0.002) @ q, mat, sides=5, caps=True, r2=r * 0.6)


def field_telephone(mesh, matrix):
    """Feldfernsprecher 33: bakelite case, handset in its cradle on top,
    crank on the right, two terminals, leather strap; origin bottom centre."""
    M = matrix
    bbox_mesh(mesh, (0.27, 0.11, 0.2), M @ trs((0, 0, 0.1)), 'bakelite', 0.012, occ_bottom=0.4)
    bbox_mesh(mesh, (0.275, 0.115, 0.03), M @ trs((0, 0, 0.19)), 'bakelite', 0.008)
    for x in (-0.07, 0.07):
        bbox_mesh(mesh, (0.03, 0.05, 0.025), M @ trs((x, 0, 0.215)), 'bakelite', 0.005)
    hs = M @ trs((0, 0, 0.245))
    bbox_mesh(mesh, (0.2, 0.034, 0.026), hs, 'bakelite', 0.008)
    for x in (-0.095, 0.095):
        cyl_mesh(mesh, 0.03, 0.032, hs @ trs((x, 0, -0.012)), 'bakelite', sides=10, r2=0.024)
    # crank
    tube_mesh(mesh, [M @ V(p) for p in ((0.137, 0, 0.11), (0.155, 0, 0.11), (0.155, 0, 0.05), (0.18, 0, 0.05))],
              0.006, 'metal_dark', sides=4)
    cyl_mesh(mesh, 0.009, 0.035, M @ trs((0.195, 0, 0.05), (0, 90, 0)), 'bakelite', sides=6)
    for x in (-0.06, 0.06):
        cyl_mesh(mesh, 0.008, 0.02, M @ trs((x, -0.06, 0.06), (90, 0, 0)), 'brass', sides=6)
    tube_mesh(mesh, [M @ V(p) for p in ((-0.136, 0, 0.14), (-0.14, 0, 0.26), (-0.06, 0, 0.32), (0.06, 0, 0.32),
                                        (0.14, 0, 0.26), (0.136, 0, 0.14))], 0.008, 'leather', sides=4)


def plank_crate(mesh, matrix, size=(0.7, 0.4, 0.3), mat='wood', dark='wood_dark', rng=None, stencil=True):
    """A boarded ammunition crate (boards with gaps, end cleats, rope
    handles, hasps, a stencil block); origin at the bottom centre."""
    sx, sy, sz = size
    M = matrix
    nb = 2
    for y in (-sy / 2 + 0.0125, sy / 2 - 0.0125):
        for k in range(nb):
            h = sz / nb
            box_mesh(mesh, (sx - 0.05, 0.025, h - 0.006), M @ trs((0, y, h * (k + 0.5))), mat + '_h', occ_bottom=0.3)
    for x in (-sx / 2 + 0.0125, sx / 2 - 0.0125):
        box_mesh(mesh, (0.025, sy - 0.03, sz - 0.01), M @ trs((x, 0, sz / 2)), mat)
        box_mesh(mesh, (0.03, sy, 0.05), M @ trs((x * 1.07, 0, sz * 0.3)), dark)
        box_mesh(mesh, (0.03, sy, 0.05), M @ trs((x * 1.07, 0, sz * 0.8)), dark)
        sgn = 1 if x > 0 else -1
        tube_mesh(mesh, [M @ V(p) for p in ((x + sgn * 0.02, -0.08, sz * 0.62), (x + sgn * 0.045, -0.04, sz * 0.5),
                                            (x + sgn * 0.045, 0.04, sz * 0.5), (x + sgn * 0.02, 0.08, sz * 0.62))],
                  0.009, 'webbing', sides=3)
    box_mesh(mesh, (sx - 0.04, sy - 0.02, 0.022), M @ trs((0, 0, sz + 0.011)), mat + '_h')
    for x in (-sx * 0.3, sx * 0.3):
        box_mesh(mesh, (0.035, 0.012, 0.07), M @ trs((x, -sy / 2 - 0.006, sz - 0.02)), 'iron')
    if stencil:
        st = 'stencil_' + mat if mat in ('wood', 'wood_old', 'wood_dark') else 'marking_white'
        box_mesh(mesh, (sx * 0.35, 0.001, sz * 0.3), M @ trs((-sx * 0.15, -sy / 2 - 0.0005, sz * 0.5)), st)
        box_mesh(mesh, (sx * 0.15, 0.001, sz * 0.15), M @ trs((sx * 0.25, -sy / 2 - 0.0005, sz * 0.6)), st)
    for sgn in (-1, 1):             # v3: a nail at each board end
        pts = [M @ V((sxn * (sx / 2 - 0.0125), sgn * sy / 2, sz / nb * (k + 0.5))) for sxn in (-1, 1) for k in range(nb)]
        nails(mesh, pts, (M.to_3x3() @ V((0, sgn, 0))).normalized(), r=0.0045)


def drum(mesh, matrix, mat='metal_gray', segs=14):
    """A 200 l steel drum (0.59 x 0.88) with rolling hoops, origin at the base."""
    prof = [(0.0, 0.0), (0.285, 0.0), (0.295, 0.02), (0.288, 0.05), (0.288, 0.27), (0.302, 0.29), (0.288, 0.31),
            (0.288, 0.57), (0.302, 0.59), (0.288, 0.61), (0.29, 0.85), (0.272, 0.875), (0.0, 0.868)]
    rings = []
    for r, z in prof:
        rings.append([matrix @ V((max(r, 1e-4) * math.cos(2 * math.pi * k / segs),
                                  max(r, 1e-4) * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)])
    loft(mesh, rings, mat, closed=True, soft=True)
    cyl_mesh(mesh, 0.03, 0.025, matrix @ trs((0.17, 0.05, 0.88)), 'metal_dark', sides=6)
    cyl_mesh(mesh, 0.022, 0.025, matrix @ trs((-0.17, -0.02, 0.88)), 'metal_dark', sides=6)


def helmet_de(mesh, matrix, mat='helmet_gray', segs=24):
    """Stahlhelm M40: dome, the flared skirt deep at the back and the sides,
    the short visor; liner and a chinstrap. Origin at the rim centre, crown up."""
    prof = [(0.0, 0.17), (0.06, 0.165), (0.1, 0.15), (0.125, 0.12), (0.135, 0.08), (0.137, 0.04), (0.14, 0.015),
            (0.158, -0.006), (0.18, -0.03), (0.194, -0.046)]
    rings = []
    for i, (r, z) in enumerate(prof):
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ca, sa = math.cos(a), math.sin(a)
            rr, zz = r, z
            front = max(0.0, -sa)                   # -Y is the front
            if i >= 6:                              # the skirt: short visor at the front, deep at the back
                zz = z + 0.03 * front ** 2 * (i - 5) / 4 - 0.03 * max(0.0, sa) * (i - 5) / 4 \
                    - 0.012 * abs(ca) * (i - 5) / 4
                rr = r - 0.03 * front ** 2 * (i - 5) / 4
            ring.append(matrix @ V((rr * ca * 1.05, rr * sa, zz)))
        rings.append(ring)
    # inside: offset inwards and back up (a shell with thickness)
    inner = []
    for ring in reversed(rings[2:]):
        c = matrix @ V((0, 0, 0.03))
        inner.append([c + (p - c) * 0.93 for p in ring])
    loft(mesh, [list(reversed(r)) for r in rings + inner], mat, closed=True, soft=True)   # rings run downwards
    # liner band and the strap
    lc = [matrix @ V((0.12 * math.cos(2 * math.pi * k / 16) * 1.05, 0.12 * math.sin(2 * math.pi * k / 16), 0.035))
          for k in range(17)]
    tube_mesh(mesh, lc, 0.012, 'leather_black', sides=4, caps=False)


def helmet_us(mesh, matrix, mat='helmet_od', segs=24):
    """M1 helmet: a deep round shell with a narrow rolled rim; liner and
    chinstraps. Origin at the rim centre, crown up."""
    prof = [(0.0, 0.17), (0.07, 0.163), (0.115, 0.14), (0.14, 0.1), (0.148, 0.055), (0.15, 0.015), (0.152, 0.0),
            (0.158, -0.004), (0.16, -0.01)]
    rings = []
    for i, (r, z) in enumerate(prof):
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ca, sa = math.cos(a), math.sin(a)
            zz = z + (0.012 * sa if i >= 5 else 0.0)            # rim lower at the back
            ring.append(matrix @ V((r * ca * 1.08, r * sa * 1.0, zz)))
        rings.append(ring)
    inner = []
    for ring in reversed(rings[2:]):
        c = matrix @ V((0, 0, 0.03))
        inner.append([c + (p - c) * 0.94 for p in ring])
    loft(mesh, [list(reversed(r)) for r in rings + inner], mat, closed=True, soft=True)   # rings run downwards
    for sx in (-1, 1):
        tube_mesh(mesh, [matrix @ V(p) for p in ((sx * 0.155, 0.0, 0.03), (sx * 0.168, -0.03, 0.0),
                                                (sx * 0.13, -0.1, -0.012), (sx * 0.04, -0.14, -0.016))],
                  0.006, 'webbing', sides=4)


def mg42(mesh, matrix, D='gun_metal', W='gun_metal_worn', bipod=True, belt_len=0.0):
    """MG 42 along -Y: muzzle at y = -1.22 from the butt end at 0; origin at
    the receiver's underside under the feed cover (where a mount clamps it)."""
    M = matrix
    box_mesh(mesh, (0.06, 0.42, 0.095), M @ trs((0, 0.04, 0.05)), D)                         # receiver
    box_mesh(mesh, (0.075, 0.17, 0.03), M @ trs((0, -0.02, 0.113)), W)                        # feed cover
    box_mesh(mesh, (0.075, 0.5, 0.072), M @ trs((0, -0.42, 0.055)), D)                        # barrel jacket
    for k in range(7):                                                                        # cooling slots
        y = -0.24 - k * 0.055
        for sx in (-1, 1):
            box_mesh(mesh, (0.004, 0.035, 0.03), M @ trs((sx * 0.0385, y, 0.055)), 'metal_dark')
    box_mesh(mesh, (0.004, 0.36, 0.03), M @ trs((0.0385, -0.42, 0.055)), 'metal_dark')       # barrel change slot
    cyl_mesh(mesh, 0.012, 0.12, M @ trs((0, -0.72, 0.06), (90, 0, 0)), D, sides=8)
    cyl_mesh(mesh, 0.024, 0.06, M @ trs((0, -0.79, 0.06), (90, 0, 0)), D, sides=10)          # muzzle booster
    cyl_mesh(mesh, 0.006, 0.05, M @ trs((0, -0.67, 0.105)), D, sides=4)                        # front sight
    box_mesh(mesh, (0.03, 0.06, 0.03), M @ trs((0, -0.09, 0.14)), D)                           # rear sight
    box_mesh(mesh, (0.05, 0.3, 0.07), M @ trs((0, 0.38, 0.03), (-4, 0, 0)), 'bakelite')        # stock
    box_mesh(mesh, (0.05, 0.08, 0.12), M @ trs((0, 0.53, 0.0), (-4, 0, 0)), 'bakelite')
    box_mesh(mesh, (0.03, 0.05, 0.11), M @ trs((0, 0.16, -0.04), (18, 0, 0)), 'bakelite')      # pistol grip
    box_mesh(mesh, (0.012, 0.06, 0.012), M @ trs((0, 0.11, -0.01)), D)                         # trigger guard
    box_mesh(mesh, (0.015, 0.04, 0.03), M @ trs((0.04, -0.05, 0.06)), D)                       # cocking handle
    if bipod:
        for sx in (-1, 1):
            tube_mesh(mesh, [M @ V((sx * 0.02, -0.66, 0.03)), M @ V((sx * 0.03, -0.38, -0.0))], 0.007, D, sides=4)
    if belt_len > 0:
        belt(mesh, [M @ V(p) for p in ((-0.05, -0.02, 0.1), (-0.12, -0.02, 0.06), (-0.18, -0.03, -0.05),
                                       (-0.2, -0.04, -0.05 - belt_len))])
