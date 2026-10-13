"""Meteora — Perpetua parts: geometry and fitting helpers for build_perpetua.py.

Partial revolves (ring arcs, bearing sleeves), beams and trusses, flat
discs, a blocky stencil font rasterised into an image, face metadata that
survives joining (texel weight, instancing group, collider coverage),
post-bake instancing (copies share the master's UVs, so a repeated part
costs no texture space) and a greedy compound-collider fit. Importing this
module builds nothing.
"""
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

import common as C

TAU = 2 * math.pi


# --------------------------------------------------------------------------
# Face metadata: stamped on every face just before the parts are joined.
#   uvw  texel-density weight (linear UV scale before packing)
#   grp  instancing group: faces copied after the bake (0 = none)
#   col  collider coverage: 1 fit automatically, 2 covered by hand, 0 exempt

def meta(obj, uvw=None, grp=None, col=None, uvfix=None, cat=None):
    if uvw is not None:
        obj['uvw'] = float(uvw)
    if grp is not None:
        obj['grp'] = int(grp)
    if col is not None:
        obj['col'] = int(col)
    if uvfix is not None:
        obj['uvfix'] = int(uvfix)
    if cat is not None:
        obj['cat'] = int(cat)
    return obj


FACE_META = (('uvw', 'FLOAT', 1.0), ('grp', 'INT', 0), ('col', 'INT', 1), ('uvfix', 'INT', 0), ('cat', 'INT', 0))


def stamp(objs):
    """Write the object-level metadata to face attributes (a part that set
    its own per-face values keeps them)."""
    for o in objs:
        n = len(o.data.polygons)
        for key, kind, default in FACE_META:
            if o.data.attributes.get(key) is not None:
                continue
            a = o.data.attributes.new(key, kind, 'FACE')
            a.data.foreach_set('value', [o.get(key, default)] * n)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')


def face_attr(obj, key):
    a = obj.data.attributes[key]
    out = np.empty(len(obj.data.polygons), np.float32 if a.data_type == 'FLOAT' else np.int32)
    a.data.foreach_get('value', out)
    return out


# --------------------------------------------------------------------------
# Mesh builders

def finish(name, bm, mat, smooth=True, sharp=None, recalc=True, weld=1e-4):
    if weld:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = C.object_from_bmesh(name, bm, smooth=smooth)
    if sharp is not None:
        obj.data.set_sharp_from_angle(angle=math.radians(sharp))
    if mat is not None:
        obj.data.materials.append(mat)
    return obj


def orient(bm, outward):
    """Flip every face whose normal points against outward(face centre)."""
    bm.normal_update()
    for f in bm.faces:
        if f.normal.dot(outward(f.calc_center_median())) < 0:
            f.normal_flip()
    bm.normal_update()


def revolve(name, profile, mat, sides, a0=0.0, a1=TAU, closed=True, centre=(0.0, 0.0), smooth=True,
            sharp=None, caps=False, outward=None, uv=None, uv_radius=1.0, side=None):
    """Sweep a (y, r) profile about the axis parallel to Y through `centre`
    (x, z), from angle a0 to a1 (radians, from +X toward +Z). `closed` joins
    the last profile point to the first; r == 0 points become one apex
    vertex. A partial sweep with caps closes its ends (closed profiles only);
    an open shell is oriented by `side` ('left' or 'right': where the
    outside lies, walking along the profile in the (r, y) plane with r to
    the right and y up) or by `outward(p)`, instead of a normal
    recalculation. uv='strip' lays the sweep out as one island in metres
    (u = arc length along the profile, v = angle x uv_radius); uv='polar'
    as a seamless disc (u, v = s cos a, s sin a, s the profile arc length
    from the first point)."""
    full = abs((a1 - a0) - TAU) < 1e-6
    cols = sides if full else sides + 1
    cx, cz = centre
    bm = bmesh.new()
    rings, where = [], {}
    for i, (y, r) in enumerate(profile):
        if r <= 1e-6:
            v = bm.verts.new((cx, y, cz))
            where[v] = (i, None)
            rings.append([v] * cols)
            continue
        ring = []
        for j in range(cols):
            a = a0 + (a1 - a0) * j / sides
            v = bm.verts.new((cx + r * math.cos(a), y, cz + r * math.sin(a)))
            where[v] = (i, j)
            ring.append(v)
        rings.append(ring)
    n = len(profile)
    pairs = list(zip(range(n - 1), range(1, n))) + ([(n - 1, 0)] if closed else [])
    made = []
    for ia, ib in pairs:
        A, B = rings[ia], rings[ib]
        for j in range(sides):
            k = (j + 1) % cols
            vs = []
            for v in (A[j], A[k], B[k], B[j]):
                if v not in vs:
                    vs.append(v)
            if len(vs) >= 3:
                made.append((bm.faces.new(vs), ia, ib, j))
    if caps and not full and closed:
        bm.faces.new([ring[0] for ring in rings])
        bm.faces.new([ring[-1] for ring in rings])
    if uv:
        arc = [0.0]
        for (y0, r0), (y1, r1) in zip(profile, profile[1:]):
            arc.append(arc[-1] + math.hypot(y1 - y0, r1 - r0))
        arc_close = arc[-1] + math.hypot(profile[0][0] - profile[-1][0], profile[0][1] - profile[-1][1])
        layer = bm.loops.layers.uv.new('UVMap')
        for f, ia, ib, jf in made:
            for loop in f.loops:
                i, j = where[loop.vert]
                s_ = arc_close if (closed and ia == n - 1 and ib == 0 and i == 0) else arc[i]
                if j is None:
                    je = jf + 0.5
                elif full and jf == sides - 1 and j == 0:
                    je = sides
                else:
                    je = j
                a = a0 + (a1 - a0) * je / sides
                loop[layer].uv = (s_, (a - a0) * uv_radius) if uv == 'strip' else (s_ * math.cos(a), s_ * math.sin(a))
    if side is not None:
        bm.normal_update()
        for f, ia, ib, j in made:
            (ya, ra), (yb, rb) = profile[ia], profile[ib]
            tr, ty = rb - ra, yb - ya
            nr, ny = (-ty, tr) if side == 'left' else (ty, -tr)
            a = a0 + (a1 - a0) * (j + 0.5) / sides
            if f.normal.dot(Vector((nr * math.cos(a), ny, nr * math.sin(a)))) < 0:
                f.normal_flip()
        bm.normal_update()
        return finish(name, bm, mat, smooth=smooth, sharp=sharp, recalc=False, weld=0)
    if outward is not None:
        orient(bm, outward)
        return finish(name, bm, mat, smooth=smooth, sharp=sharp, recalc=False, weld=0)
    return finish(name, bm, mat, smooth=smooth, sharp=sharp)


def rounded_rect(yc, rc, hy, hr, corner, per_corner=3):
    """A closed (y, r) loop: a rectangle of half sizes (hy, hr) centred on
    (yc, rc) with rounded corners, counter-clockwise."""
    pts = []
    for (sy, sr, a0) in ((1, 1, 0.0), (-1, 1, 90.0), (-1, -1, 180.0), (1, -1, 270.0)):
        cy, cr = yc + sy * (hy - corner), rc + sr * (hr - corner)
        for i in range(per_corner + 1):
            a = math.radians(a0 + 90.0 * i / per_corner)
            pts.append((cy + corner * math.cos(a), cr + corner * math.sin(a)))
    return pts


def sleeve(name, outer, inner, a0, a1, steps, mat, centre=(0.0, 0.0), smooth=True, sharp=None):
    """A hollow partial revolve: two closed (y, r) loops with the same point
    count (an outer one and an inner offset of it) swept from a0 to a1, with
    annular end faces. Closed manifold."""
    bm = bmesh.new()
    cx, cz = centre

    def ring_of(prof):
        rows = []
        for j in range(steps + 1):
            a = a0 + (a1 - a0) * j / steps
            rows.append([bm.verts.new((cx + r * math.cos(a), y, cz + r * math.sin(a))) for y, r in prof])
        return rows

    O, I = ring_of(outer), ring_of(inner)
    n = len(outer)
    for rows in (O, I):
        for j in range(steps):
            for i in range(n):
                k = (i + 1) % n
                bm.faces.new((rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]))
    for j in (0, steps):
        for i in range(n):
            k = (i + 1) % n
            bm.faces.new((O[j][i], O[j][k], I[j][k], I[j][i]))
    return finish(name, bm, mat, smooth=smooth, sharp=sharp)


def _frame(t, up):
    t = Vector(t).normalized()
    u = Vector(up)
    u = u - t * u.dot(t)
    if u.length < 1e-6:
        u = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 0, 1))
        u = u - t * u.dot(t)
    u.normalize()
    return t, u, t.cross(u)


def beam(name, p0, p1, w, h, mat, up=(0, 0, 1), caps=True, taper=1.0, smooth=False, offset=0.0):
    """A rectangular beam from p0 to p1 (w across, h along `up`), centred on
    the segment unless `offset` lifts it along up (in units of h)."""
    p0, p1 = Vector(p0), Vector(p1)
    t, u, s = _frame(p1 - p0, up)
    bm = bmesh.new()
    ends = []
    for p, k in ((p0, 1.0), (p1, taper)):
        ends.append([bm.verts.new(p + s * (sx * w / 2 * k) + u * ((sz / 2 + offset) * h * k))
                     for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((ends[0][i], ends[0][j], ends[1][j], ends[1][i]))
    if caps:
        bm.faces.new(ends[0][::-1])
        bm.faces.new(ends[1])
        return finish(name, bm, mat, smooth=smooth)

    def outward(c):
        d = c - p0
        return d - t * d.dot(t)
    orient(bm, outward)
    return finish(name, bm, mat, smooth=smooth, recalc=False, weld=0)


def tube(name, p0, p1, r, sides, mat, caps=True, smooth=True, r1=None):
    """A cylinder (or cone with r1) from p0 to p1."""
    p0, p1 = Vector(p0), Vector(p1)
    t, u, s = _frame(p1 - p0, (0, 0, 1) if abs((p1 - p0).normalized().z) < 0.9 else (1, 0, 0))
    r1 = r if r1 is None else r1
    bm = bmesh.new()
    rings = []
    for p, rr in ((p0, r), (p1, r1)):
        rings.append([bm.verts.new(p + (u * math.cos(TAU * i / sides) + s * math.sin(TAU * i / sides)) * rr)
                      for i in range(sides)])
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[1])
        return finish(name, bm, mat, smooth=smooth, sharp=40)

    def outward(c):
        d = c - p0
        return d - t * d.dot(t)
    orient(bm, outward)
    return finish(name, bm, mat, smooth=smooth, recalc=False, weld=0)


def disc(name, centre, normal, radius, sides, mat, phase=0.0):
    """A flat polygon facing `normal`."""
    c = Vector(centre)
    n, u, s = _frame(normal, (0, 0, 1) if abs(Vector(normal).normalized().z) < 0.9 else (1, 0, 0))
    bm = bmesh.new()
    vs = [bm.verts.new(c + (u * math.cos(TAU * i / sides + phase) + s * math.sin(TAU * i / sides + phase)) * radius)
          for i in range(sides)]
    f = bm.faces.new(vs)
    bm.normal_update()
    if f.normal.dot(n) < 0:
        f.normal_flip()
    return finish(name, bm, mat, smooth=False, recalc=False, weld=0)


def cap_box(name, size, mat, frame, taper=1.0, sink=0.0):
    """A box with no bottom face, standing on a surface frame (Z = surface
    normal) with its base `sink` below the surface: greebles, where the
    hidden bottom would only cost vertices."""
    sx, sy, sz = (v / 2 for v in size)
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, -sink)) for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy))]
    hi = [bm.verts.new((x * taper, y * taper, 2 * sz - sink)) for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy))]
    bm.faces.new(hi)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    centre = Vector((0, 0, sz - sink))
    orient(bm, lambda c: c - centre)
    bmesh.ops.transform(bm, matrix=frame, verts=bm.verts)
    bm.normal_update()
    return finish(name, bm, mat, smooth=False, recalc=False, weld=0)


def truss(name, y0, y1, half, bays, mat, lon=2.6, bat=1.5, diag=1.1, longerons=True):
    """A square truss along Y between y0 and y1: four longerons at
    (±half, ±half), a square frame of battens at every bay station and one
    diagonal per face per bay (alternating, a Warren pattern)."""
    parts = []
    corners = [(half, half), (-half, half), (-half, -half), (half, -half)]
    if longerons:
        for i, (x, z) in enumerate(corners):
            parts.append(beam(f'{name}_lon{i}', (x, y0, z), (x, y1, z), lon, lon, mat, up=(x, 0, z)))
    step = (y1 - y0) / bays
    for k in range(bays + 1):
        y = y0 + k * step
        for i in range(4):
            (xa, za), (xb, zb) = corners[i], corners[(i + 1) % 4]
            parts.append(beam(f'{name}_bat{k}_{i}', (xa, y, za), (xb, y, zb), bat, bat, mat,
                              up=(xa + xb, 0, za + zb), caps=False))
    for k in range(bays):
        ya, yb = y0 + k * step, y0 + (k + 1) * step
        for i in range(4):
            (xa, za), (xb, zb) = corners[i], corners[(i + 1) % 4]
            if (k + i) % 2:
                a, b = (xa, ya, za), (xb, yb, zb)
            else:
                a, b = (xb, ya, zb), (xa, yb, za)
            parts.append(beam(f'{name}_dia{k}_{i}', a, b, diag, diag, mat, up=(xa + xb, 0, za + zb), caps=False))
    return parts


def transformed(obj, matrix):
    obj.data.transform(matrix)
    obj.data.update()
    return obj


def about_y(phi_from, phi_to):
    """The rotation about the ship axis (Blender Y) carrying the angle
    phi_from (degrees, from +X toward +Z) onto phi_to."""
    return Matrix.Rotation(math.radians(phi_from - phi_to), 4, 'Y')


def polar(r, phi, y):
    a = math.radians(phi)
    return Vector((r * math.cos(a), y, r * math.sin(a)))


# --------------------------------------------------------------------------
# Stencil lettering: a blocky 5 x 7 font rasterised into a mask image the
# paint shaders sample (the bake turns it into painted letters).

FONT = {
    'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    'B': ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    'C': ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'G': ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    'H': ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    'I': ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    'K': ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    'L': ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    'M': ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    'N': ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    'O': ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    'R': ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    'T': ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    'U': ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    'V': ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    'W': ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    'Y': ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    '0': ["01110", "10011", "10101", "10101", "11001", "10001", "01110"],
    '1': ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    '2': ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    '3': ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    '4': ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    '5': ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    '6': ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    '7': ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    '8': ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    '9': ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    '-': ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ' ': ["00000"] * 7,
}


def stencil(text, cell=8, gap=1):
    """A (rows, cols) float mask of `text` in the block font: each lit cell
    is a `cell` x `cell` block, letters one cell apart, with a `gap`-pixel
    stencil bridge between the blocks of a letter."""
    cols = len(text) * 6 - 1
    mask = np.zeros((7 * cell, cols * cell), np.float32)
    for n, ch in enumerate(text.upper()):
        rows = FONT.get(ch, FONT[' '])
        for r, line in enumerate(rows):
            for c, bit in enumerate(line):
                if bit == '1':
                    x0, y0 = (n * 6 + c) * cell, r * cell
                    mask[y0:y0 + cell - gap, x0:x0 + cell - gap] = 1.0
    return mask


def mask_image(name, mask, pad=4):
    """A non-colour image holding `mask` (top row first), padded with zeros."""
    h, w = mask.shape
    img = bpy.data.images.new(name, w + 2 * pad, h + 2 * pad, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    full = np.zeros((h + 2 * pad, w + 2 * pad, 4), np.float32)
    full[..., 3] = 1.0
    full[pad:pad + h, pad:pad + w, :3] = mask[::-1, :, None]
    img.pixels.foreach_set(full.ravel())
    img.update()
    img.pack()
    return img


# --------------------------------------------------------------------------
# UVs with texel weights

def unwrap(obj, margin, angle=60.0, method='CONCAVE'):
    """Smart-project the faces without their own UVs (uvfix == 0), bring
    the pre-made islands (laid out in metres) to the same texel scale, scale
    each face's UVs by its `uvw` weight (islands never span parts, so they
    scale whole), then pack everything."""
    me = obj.data
    fix = face_attr(obj, 'uvfix') > 0
    C.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bm = bmesh.from_edit_mesh(me)
    for v in bm.verts:
        v.select = False
    for e in bm.edges:
        e.select = False
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.select = not fix[f.index]
    bm.select_mode = {'FACE'}
    bm.select_flush_mode()
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    starts = np.empty(len(me.polygons), np.int32)
    totals = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_start', starts)
    me.polygons.foreach_get('loop_total', totals)
    poly = np.repeat(np.arange(len(me.polygons)), totals)
    uv = np.empty(len(me.loops) * 2, np.float32)
    layer = me.uv_layers.active.data
    layer.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    if fix.any():
        area3 = np.empty(len(me.polygons), np.float32)
        me.polygons.foreach_get('area', area3)
        uva = np.zeros(len(me.polygons))
        x, y = uv[:, 0], uv[:, 1]
        nxt = np.arange(len(uv)) + 1
        ends = starts + totals
        nxt[ends - 1] = starts                      # wrap each polygon's last corner to its first
        cross = x * y[nxt] - x[nxt] * y
        np.add.at(uva, poly, cross)
        uva = np.abs(uva) / 2
        smart = ~fix
        k = math.sqrt(uva[smart].sum() / max(area3[smart].sum(), 1e-9))
        uv[fix[poly]] *= k
    w = face_attr(obj, 'uvw')
    uv *= w[poly][:, None]
    layer.foreach_set('uv', uv.ravel())
    me.update()
    C.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method=method, scale=True,
                            margin_method='FRACTION', margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def vertex_report(obj, names=None):
    """Approximate glTF vertex counts (unique position, corner normal and
    UV) per `cat` attribute value."""
    me = obj.data
    totals = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_total', totals)
    poly = np.repeat(np.arange(len(me.polygons)), totals)
    vi = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', vi)
    nr = np.empty(len(me.loops) * 3, np.float32)
    me.corner_normals.foreach_get('vector', nr)
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    keys = np.column_stack([vi, np.round(nr.reshape(-1, 3) * 1000), np.round(uv.reshape(-1, 2) * 1e5)])
    cat = face_attr(obj, 'cat')[poly]
    out = {}
    for c in np.unique(cat):
        out[(names or {}).get(int(c), int(c))] = len(np.unique(keys[cat == c], axis=0))
    out['total'] = len(np.unique(keys, axis=0))
    return out


# --------------------------------------------------------------------------
# Post-bake instancing

def apply_instances(obj, groups):
    """groups: {grp id: [Matrix, ...]}. Copies the faces of each group with
    every matrix (relative to the master, which stays), so the copies share
    the master's UVs and baked paint. Mirrored matrices flip the winding."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    layer = bm.faces.layers.int.get('grp')
    for gid, mats in groups.items():
        faces = [f for f in bm.faces if f[layer] == gid]
        if not faces:
            continue
        verts = list(dict.fromkeys(v for f in faces for v in f.verts))     # ordered: reproducible output
        edges = list(dict.fromkeys(e for f in faces for e in f.edges))
        for m in mats:
            ret = bmesh.ops.duplicate(bm, geom=verts + edges + faces)
            nv = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)]
            nf = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMFace)]
            bmesh.ops.transform(bm, matrix=m, verts=nv)
            if m.determinant() < 0:
                bmesh.ops.reverse_faces(bm, faces=nf, flip_multires=False)
            for f in nf:
                f[layer] = -gid
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def weld_where(obj, pick, dist=0.02):
    """Merge coincident vertices among those `pick(co)` selects."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    vs = [v for v in bm.verts if pick(v.co)]
    bmesh.ops.remove_doubles(bm, verts=vs, dist=dist)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


# --------------------------------------------------------------------------
# Checks

def inside_out(obj):
    """Fraction of faces whose normal ray first meets a back face of the
    same object (a face wound inward on a closed part)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    bad = 0
    for f in bm.faces:
        n = f.normal
        if n.length < 0.5:
            continue
        o = f.calc_center_median() + n * 1e-3
        hit, hn, idx, d = tree.ray_cast(o, n)
        if hit is not None and idx != f.index and d > 0.01 and hn.dot(n) > 0.2:
            bad += 1
    total = len(bm.faces)
    bm.free()
    return bad / max(1, total)


# --------------------------------------------------------------------------
# Compound colliders: a greedy cover of surface samples by spheres whose
# bulge beyond the hull stays under a bound.

def fibonacci(n):
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        rr = math.sqrt(max(0.0, 1 - z * z))
        out.append(Vector((rr * math.cos(ga * i), rr * math.sin(ga * i), z)))
    return out


def surface_samples(obj, keep, spacing, seed=3):
    """Area-weighted random points on the faces where `keep` (per polygon)
    is true, plus those faces' vertices. Returns (points, normals, weights,
    polygon index of each point)."""
    me = obj.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    tv = np.empty(n * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', tv)
    tv = tv.reshape(n, 3)
    tp = np.empty(n, np.int32)
    me.loop_triangles.foreach_get('polygon_index', tp)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3).astype(np.float64)
    sel = keep[tp]
    tv, tp = tv[sel], tp[sel]
    a, b, c = co[tv[:, 0]], co[tv[:, 1]], co[tv[:, 2]]
    cr = np.cross(b - a, c - a)
    area = 0.5 * np.linalg.norm(cr, axis=1)
    nrm = cr / np.maximum(2 * area, 1e-9)[:, None]
    rng = np.random.default_rng(seed)
    expect = area / spacing ** 2
    counts = np.floor(expect + rng.random(len(expect))).astype(int)
    idx = np.repeat(np.arange(len(counts)), counts)
    u, v = rng.random(len(idx)), rng.random(len(idx))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pts = a[idx] + (b[idx] - a[idx]) * u[:, None] + (c[idx] - a[idx]) * v[:, None]
    nr = nrm[idx]
    w = np.full(len(pts), spacing ** 2)
    vids = np.unique(tv)
    vn = np.zeros((len(co), 3))
    vpoly = np.zeros(len(co), np.int64)
    for k in range(3):
        np.add.at(vn, tv[:, k], cr)
        vpoly[tv[:, k]] = tp
    vn = vn[vids] / np.maximum(np.linalg.norm(vn[vids], axis=1), 1e-9)[:, None]
    pts = np.concatenate([pts, co[vids]])
    nr = np.concatenate([nr, vn])
    w = np.concatenate([w, np.full(len(vids), 1.0)])
    poly = np.concatenate([tp[idx], vpoly[vids]])
    return pts, nr, w, poly


def bulge_table(bvh, centres, radii, dirs):
    """For every candidate centre and radius, the largest distance from a
    point of the sphere to the hull surface, counting only points outside
    it (judged by the nearest surface point's normal)."""
    table = np.full((len(centres), len(radii)), np.inf)
    for i, c in enumerate(centres):
        cv = Vector(c)
        for j, r in enumerate(radii):
            worst = 0.0
            for d in dirs:
                q = cv + d * r
                loc, nrm, _, dist = bvh.find_nearest(q)
                if loc is None:
                    worst = np.inf
                    break
                if (q - loc).dot(nrm) > 0 and dist > worst:
                    worst = dist
            table[i, j] = worst
            if worst > 60:
                break
    return table


def greedy_cover(points, weights, centres, radii, table, bound, tol, budget, fixed=(), keep_out=()):
    """Pick spheres (centre, largest radius with bulge <= bound that stays
    clear of the keep-out points (point, margin)) to cover the samples
    within r + tol. Returns (spheres, covered mask)."""
    P = np.asarray(points)
    covered = np.zeros(len(P), bool)
    for c, r in fixed:
        covered |= np.linalg.norm(P - np.asarray(c), axis=1) <= r + tol
    best_r = []
    cover = []
    for i, c in enumerate(centres):
        ok = np.nonzero(table[i] <= bound)[0]
        for k, margin in keep_out:
            d = (Vector(c) - Vector(k)).length - margin
            ok = ok[np.asarray(radii)[ok] < d]
        if len(ok) == 0:
            best_r.append(0.0)
            cover.append(np.zeros(0, np.int64))
            continue
        r = radii[ok.max()]
        best_r.append(r)
        cover.append(np.nonzero(np.linalg.norm(P - np.asarray(c), axis=1) <= r + tol)[0])
    chosen = []
    W = np.asarray(weights)
    while len(chosen) < budget and not covered.all():
        gains = np.array([W[idx[~covered[idx]]].sum() if len(idx) else 0.0 for idx in cover])
        k = int(np.argmax(gains))
        if gains[k] <= 0:
            break
        chosen.append((tuple(centres[k]), best_r[k], k))
        covered[cover[k]] = True
    return chosen, covered


def tighten(points, spheres, tol, fixed=(), floor=4.0):
    """Shrink each sphere to the samples only it covers (largest first),
    keeping the overall coverage; drop spheres that cover nothing alone."""
    P = np.asarray(points)
    spheres = [list(s) for s in spheres]
    fixed_cov = np.zeros(len(P), bool)
    for c, r in fixed:
        fixed_cov |= np.linalg.norm(P - np.asarray(c), axis=1) <= r + tol
    for _ in range(2):
        dists = [np.linalg.norm(P - np.asarray(s[0]), axis=1) for s in spheres]
        for i in sorted(range(len(spheres)), key=lambda i: -spheres[i][1]):
            others = fixed_cov.copy()
            for j, s in enumerate(spheres):
                if j != i and s[1] > 0:
                    others |= dists[j] <= s[1] + tol
            mine = (dists[i] <= spheres[i][1] + tol) & ~others
            if not mine.any():
                spheres[i][1] = 0.0
            else:
                spheres[i][1] = max(floor, float(dists[i][mine].max()) - tol)
    return [tuple(s) for s in spheres if s[1] > 0]


def floating(objs, tol=0.02):
    """Names of the parts that neither intersect nor touch (within tol) any
    other part: candidates for a floating piece."""
    trees, all_bm = [], bmesh.new()
    owner = []
    for k, o in enumerate(objs):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        trees.append(BVHTree.FromBMesh(bm))
        before = len(all_bm.faces)
        tmp = bpy.data.meshes.new('tmp_float')
        bm.to_mesh(tmp)
        all_bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        owner += [k] * (len(all_bm.faces) - before)
        bm.free()
    everything = BVHTree.FromBMesh(all_bm)
    owner = np.array(owner)
    lonely = []
    for k, o in enumerate(objs):
        pairs = trees[k].overlap(everything)
        if any(owner[j] != k for _, j in pairs):
            continue
        near = False
        for v in o.data.vertices:
            loc, nrm, idx, d = everything.find_nearest(v.co, tol * 50)
            if loc is None:
                continue
            # look a little further for a face of another part
            for hit in everything.find_nearest_range(v.co, tol):
                if owner[hit[2]] != k:
                    near = True
                    break
            if near:
                break
        if not near:
            lonely.append(o.name)
    all_bm.free()
    return lonely
