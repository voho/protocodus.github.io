"""Hedgerow — village set: architectural parts on top of kit.py.

Conventions (same as kit): Blender space, Z up, metres, front faces -Y.
Openings (windows, doors) are built in a *wall frame*: the wall's outer face
is the plane y = 0, outside is -Y, the wall mass is +Y, x runs to the right
as seen from outside, z is absolute height. `face_frame` gives the matrix
that puts such a frame on a side of a rectangular block.
"""
import math, os, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise
import kit

V = Vector


# --------------------------------------------------------------------------
# Transforms and raw meshes

def frame(loc=(0, 0, 0), yaw=0.0):
    return Matrix.Translation(V(loc)) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')


def face_frame(face, W, D, u=0.0, z=0.0):
    """Wall frame on a side of a W (x) by D (y) block centred at the origin.
    `u` = position along the face, to the right as seen from outside."""
    if face == 'front':
        return frame((u, -D / 2, z), 0)
    if face == 'back':
        return frame((-u, D / 2, z), 180)
    if face == 'left':
        return frame((-W / 2, -u, z), -90)
    if face == 'right':
        return frame((W / 2, u, z), 90)
    raise ValueError(face)


def xform(objs, M):
    for o in objs:
        o.matrix_basis = M @ o.matrix_basis
    return objs


def mesh(name, verts, faces, mat, recalc=False):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit._new_object(name, bm, mat)


def quad(p0, p1, p2, p3, mat, name='quad'):
    """A single quad; vertex order gives the normal (counter-clockwise)."""
    return mesh(name, [p0, p1, p2, p3], [(0, 1, 2, 3)], mat)


def poly(points, mat, name='poly'):
    return mesh(name, points, [tuple(range(len(points)))], mat)


def sweep(points, profile, mat, name='sweep', up=(0, 0, 1), cap=True, closed=True, loop=False):
    """Sweep a closed 2D profile (u, v) along a polyline. u runs along
    tangent x up, v along the resulting normal."""
    pts = [V(p) for p in points]
    n, m = len(pts), len(profile)
    upv = V(up)
    verts, faces = [], []
    if loop and (pts[0] - pts[-1]).length < 1e-6:
        pts = pts[:-1]
        n = len(pts)
    for i, p in enumerate(pts):
        if loop:
            t = (pts[(i + 1) % n] - pts[(i - 1) % n]).normalized()
        else:
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(upv)
        if side.length < 1e-6:
            side = t.cross(V((1, 0, 0)))
        side.normalize()
        nrm = side.cross(t).normalized()
        for u, v in profile:
            verts.append(p + side * u + nrm * v)
    for i in range(n if loop else n - 1):
        i2 = (i + 1) % n
        for k in range(m if closed else m - 1):
            k2 = (k + 1) % m
            faces.append((i * m + k, i * m + k2, i2 * m + k2, i2 * m + k))
    if cap and closed and not loop:
        faces.append(tuple(reversed(range(m))))
        faces.append(tuple((n - 1) * m + k for k in range(m)))
    return mesh(name, verts, faces, mat, recalc=closed)


def circle_profile(r, n=6, start=0.0):
    return [(r * math.cos(start + 2 * math.pi * k / n), r * math.sin(start + 2 * math.pi * k / n)) for k in range(n)]


def assign_faces(obj, pred, key):
    """Give faces matching pred(center, normal) the material `key`."""
    me = obj.data
    mat = kit.material(key)
    idx = me.materials.find(key)
    if idx < 0:
        me.materials.append(mat)
        idx = len(me.materials) - 1
    mw = obj.matrix_world
    rot = mw.to_3x3()
    for p in me.polygons:
        c = mw @ p.center
        nrm = (rot @ p.normal).normalized()
        if pred(c, nrm):
            p.material_index = idx
    return obj


# --------------------------------------------------------------------------
# Outlines in a wall frame (x, z), counter-clockwise as seen from outside

def outline(hw, z0, zs, kind='rect', n=6, R=None, rise=None):
    """Opening outline: half-width hw, sill/threshold z0, springing zs (top
    for 'rect'). kind: rect | round | segment | lancet. Same point count for
    the same (kind, n) so two outlines can be bridged into a ring."""
    pts = [(-hw, z0), (hw, z0), (hw, zs)]
    if kind == 'rect':
        pts += [(-hw, zs)]
        return pts
    if kind == 'round':
        for i in range(1, n):
            a = math.pi * i / n
            pts.append((hw * math.cos(a), zs + hw * math.sin(a)))
    elif kind == 'segment':
        rise = rise if rise is not None else hw * 0.35
        Rr = (hw * hw + rise * rise) / (2 * rise)
        cz = zs + rise - Rr
        a0 = math.asin(min(1.0, hw / Rr))
        for i in range(1, n):
            a = (math.pi / 2 - a0) + 2 * a0 * i / n
            pts.append((Rr * math.cos(a), cz + Rr * math.sin(a)))
    elif kind == 'lancet':
        R = R if R is not None else hw * 1.7
        cx = hw - R                       # centre of the right-hand arc
        a1 = math.acos(max(-1.0, min(1.0, -cx / R)))
        half = n // 2
        for i in range(1, half + 1):
            a = a1 * i / half
            pts.append((cx + R * math.cos(a), zs + R * math.sin(a)))
        for i in range(half - 1, 0, -1):
            a = a1 * i / half
            pts.append((-(cx + R * math.cos(a)), zs + R * math.sin(a)))
    pts.append((-hw, zs))
    return pts


def outline_top(pts):
    return max(p[1] for p in pts)


def ring(outer, inner, y0, depth, mat, name='ring', back=False, M=None, outer_side=True, open_bottom=False):
    """Bridge two outlines (same count) into a frame: front at y0 facing -Y,
    extending to y0 + depth; outer and inner side faces; optional back."""
    n = len(outer)
    y1 = y0 + depth
    verts = ([(x, y0, z) for x, z in outer] + [(x, y0, z) for x, z in inner] +
             [(x, y1, z) for x, z in outer] + [(x, y1, z) for x, z in inner])
    OF, IF, OB, IB = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(n):
        j = (i + 1) % n
        if open_bottom and i == 0:
            continue                                            # opening reaches the ground
        faces.append((OF + i, OF + j, IF + j, IF + i))          # front
        if outer_side:
            faces.append((OF + i, OB + i, OB + j, OF + j))      # outer side
        faces.append((IF + i, IF + j, IB + j, IB + i))          # inner side
        if back:
            faces.append((OB + i, IB + i, IB + j, OB + j))      # (skipped with the bottom edge above)
    o = mesh(name, verts, faces, mat)
    if M is not None:
        xform([o], M)
    return o


def slab(pts, y0, depth, mat, name='slab'):
    """Outline (x, z) extruded from y0 to y0 + depth (closed solid)."""
    o = kit.extrude_profile(pts, depth, 'Y', mat=mat, name=name)
    o.location.y = y0 + depth / 2
    return o


# --------------------------------------------------------------------------
# Model: parts + cutters + colliders + anchors, finished into one object

class Model:
    def __init__(self, name, seed=1):
        self.name = name
        self.parts = []
        self.colliders = []
        self.anchors = {}
        self.rnd = random.Random(seed)
        self.seed = seed
        self.openings = {}        # frame key -> [(x0, x1, z0, z1)] areas decals must not cover
        self.decals = []          # pending weathering decals

    def add(self, *objs):
        for o in objs:
            if o is not None:
                self.parts.append(o)
        return objs[0] if len(objs) == 1 else objs

    def box(self, size, loc, rot=None, mat='stone', bevel=0.0, name='box'):
        return self.add(kit.box(size, loc=loc, rot=rot, mat=mat, bevel=bevel, name=name))

    def col_box(self, center, size, yaw=0.0, kind=None):
        self.colliders.append(('box', V(center), tuple(size), yaw, kind))

    def col_cyl(self, base, r, h, kind=None):
        self.colliders.append(('cyl', V(base), r, h, kind))

    def anchor(self, name, pos, yaw=None):
        self.anchors[name] = (V(pos), yaw)

    def eave_stain(self, F, x0, x1, z_top, wall, depth=1.7, seed=1):
        """Gutter overflow stains running down a wall from z_top."""
        self.decals.append(('eave', F, x0, x1, z_top, wall, depth, seed))

    def soot(self, F, x, z, w, h, wall):
        """A soot tongue rising from z (top of an opening)."""
        self.decals.append(('soot', F, x, w, z, wall, h, 0))

    def _make_decals(self):
        for d in self.decals:
            kind, F = d[0], d[1]
            ops = self.openings.get(fkey(F), [])
            if kind == 'sill':
                _, F, x, z_top, w, wall, depth, _ = d
                x0, x1 = x - w / 2, x + w / 2
                zb = z_top - depth
                for (a, b, c, e) in ops:
                    if b > x0 and a < x1 and e <= z_top - 0.05:
                        zb = max(zb, e + 0.02)
                if z_top - zb > 0.25:
                    self.add(decal(F, x0, x1, max(zb, 0.02), z_top, decal_key(wall, 'stain'),
                                   uv=((0.0, (max(zb, 0.02) - zb) / depth), (1.0, 1.0)), name='sillstain'))
            elif kind == 'eave':
                _, F, x0, x1, z_top, wall, depth, seed = d
                rnd = random.Random(seed)
                x = x0
                while x < x1 - 0.05:
                    w = min(rnd.uniform(0.35, 0.8), x1 - x)
                    zb = z_top - depth * rnd.uniform(0.6, 1.0)
                    ok = True
                    for (a, b, c, e) in ops:
                        if b > x and a < x + w:
                            if c < z_top - 0.05:
                                zb = max(zb, e + 0.02)
                    if z_top - zb > 0.2:
                        self.add(decal(F, x, x + w, zb, z_top, decal_key(wall, 'eave'),
                                       uv=((x, 1 - (z_top - zb) / depth), (x + w, 1.0)), name='eavestain'))
                    x += w
            else:
                _, F, x, w, z, wall, h, _ = d
                z1 = z + h
                for (a, b, c, e) in ops:
                    if b > x - w / 2 and a < x + w / 2 and c > z + 0.05:
                        z1 = min(z1, c - 0.02)
                if z1 - z > 0.15:
                    self.add(decal(F, x - w / 2, x + w / 2, z, z1, decal_key(wall, 'soot'),
                                   uv=((0.0, 0.0), (1.0, (z1 - z) / h)), name='soot'))

    def build(self, origin='footprint', grime=0.4, grime_height=1.2, shade='flat', angle=35,
              jitter=0.0, jitter_scale=0.25, top=None, merge=0.0, tpm=110, size=None, bake=True):
        """Join, wobble, set the origin, UV, grime, extras, then bake.
        origin: 'footprint' = built around (0, 0) on z = 0 (anything that dips a
        few cm below the ground is clamped to 0); 'bbox' = bounding-box
        bottom centre; or an explicit point. tpm/size go to bake.bake_model."""
        self._make_decals()
        bpy.context.view_layer.update()
        if os.environ.get('VILLAGE_DEBUG'):
            acc = {}
            for o in self.parts:
                k = o.name.split('.')[0]
                acc[k] = acc.get(k, 0) + kit.tri_count(o)
            kit.log(self.name, sorted(acc.items(), key=lambda kv: -kv[1])[:24])
        obj = kit.join(self.parts, self.name)
        kit.apply_transform(obj)
        if jitter > 0:
            wobble(obj, jitter, seed=self.seed, scale=jitter_scale)
        if merge > 0:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
            bm.to_mesh(obj.data)
            bm.free()
        if origin == 'bbox':
            mn, mx = kit.bounds(obj)
            off = V(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
        elif origin == 'footprint':
            off = V((0, 0, 0))
            for v in obj.data.vertices:
                if v.co.z < 0.0:
                    v.co.z = 0.0
            # faces lying on the ground, facing down, are never seen
            drop_faces(obj, lambda c, n_: n_.z < -0.95 and c.z < 0.004)
        else:
            off = V(origin)
        for v in obj.data.vertices:
            v.co -= off
        obj.data.update()
        me = obj.data
        if me.uv_layers and 'UVMap' not in me.uv_layers:
            me.uv_layers.new(name='UVMap')
        if 'UVMap' in me.uv_layers:
            me.uv_layers.active = me.uv_layers['UVMap']
        kit.finalize(obj, self.name, uv_seed=self.seed, grime_height=grime_height,
                     grime_strength=None, shade=shade, angle=angle, base_origin=False)
        orient_uvs(obj, self.seed)
        has_ivy = False
        if 'ivyuv' in me.uv_layers:
            src, dst = me.uv_layers['ivyuv'], me.uv_layers['UVMap']
            idx = me.materials.find('ivy')
            for p_ in me.polygons:
                if p_.material_index == idx:
                    has_ivy = True
                    for li in p_.loop_indices:
                        dst.data[li].uv = src.data[li].uv
            me.uv_layers.remove(me.uv_layers['ivyuv'])
            me.uv_layers.active = me.uv_layers['UVMap']
        if grime is not None:
            kit.grime(obj, grime_height, grime, seed=self.seed, top=top)
        cols = []
        for c in self.colliders:
            if c[0] == 'box':
                _, cen, size_, yaw, kind = c
                cols.append(kit.collider_box(cen - off, size_, yaw, kind))
            else:
                _, base, r, h, kind = c
                cols.append(kit.collider_cyl(base - off, r, h, kind))
        kit.set_colliders(obj, cols)
        anc = {}
        for k, (p, yaw) in self.anchors.items():
            anc[k] = (p - off, yaw) if yaw is not None else (p - off)
        kit.set_anchors(obj, anc)
        self.offset = off
        self.tris_geo = kit.tri_count(obj)
        if bake and BAKE and (tpm or size):
            only_ivy = has_ivy and all(m_ is not None and m_.name.split('.')[0] == 'ivy' for m_ in me.materials)
            if not only_ivy:
                obj = bake_obj(obj, tpm, size, keep=('ivy',) if has_ivy else ())
        return obj


BAKE = True            # the build script turns this off with --nobake


def bake_obj(obj, tpm=None, size=None, keep=()):
    """bake.bake_model, then trim what the GLB does not need: the packed
    metallic-roughness map goes to half size (it is smooth data), and the
    AO / edge masks are dropped."""
    import bake
    # 2 samples per texel on the channels: crack and joint lines stay whole
    r = bake.bake_model(obj, tpm=tpm or 110, size=size, keep=keep, scale_islands=scale_islands_facing, samples_channels=2)
    obj = r['object']
    mr = r['mr']
    if mr is not None and mr.size[0] > 512:
        k = 4 if mr.size[0] >= 2048 else 2
        mr.scale(mr.size[0] // k, mr.size[1] // k)
        mr.pack()
    for k in ('ao', 'edge'):
        img = r.get(k)
        if img is not None:
            bpy.data.images.remove(img)
    return obj


def wobble(obj, amount, seed=1, scale=0.25):
    """Coherent low-frequency displacement (walls slightly out of true)
    that leaves the ground contact (z ~ 0) on the ground."""
    rnd = random.Random(seed)
    off = V((rnd.uniform(-100, 100), rnd.uniform(-100, 100), rnd.uniform(-100, 100)))
    me = obj.data
    for v in me.vertices:
        d = noise.noise_vector(v.co * scale + off)
        damp = max(0.0, min(1.0, v.co.z / 0.6))
        v.co += V((d.x * amount, d.y * amount, d.z * amount * damp))
    me.update()
    return obj


def cut(obj, cutter):
    """Boolean difference like kit.cut, tolerant of a base mesh made of
    overlapping pieces (self intersection on); the cut faces take the
    cutter's material (a window cutter in the reveal material, a shell-hole
    cutter in 'burnt', bullet pocks in 'stone')."""
    mod = obj.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    mod.use_self = True
    try:
        mod.material_mode = 'TRANSFER'
    except (AttributeError, TypeError):
        pass
    kit.apply_modifiers(obj)
    kit.delete(cutter)
    return obj


def join_cutters(cutters):
    return cutters[0] if len(cutters) == 1 else kit.join(cutters, 'cutters')


# --------------------------------------------------------------------------
# Building pieces

def gable_block(W, D, z_e, rise, mat, name='block'):
    """Solid house mass: W along X, D along Y, eaves at z_e, gables on the
    +-X ends rising `rise` to a ridge along X."""
    h = D / 2
    prof = [(-h, 0), (h, 0), (h, z_e), (0, z_e + rise), (-h, z_e)]
    return kit.extrude_profile(prof, W, 'X', mat=mat, name=name)


def open_box(lo, hi, mat, name='obox', bottom=False):
    """Axis-aligned box from corner lo to hi without its bottom face."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    vs = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
          (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    fs = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    if bottom:
        fs.append((3, 2, 1, 0))
    return mesh(name, vs, fs, mat)


def quoins(m, x, y, sx, sy, z0, z1, mat='stone', seed=1, p=0.03, hmin=0.34, hmax=0.42,
           long=0.55, short=0.3):
    """Dressed corner stones on the corner (x, y); (sx, sy) = outward signs."""
    rnd = random.Random(seed)
    z = z0
    k = 0
    while z < z1 - 0.12:
        h = min(rnd.uniform(hmin, hmax), z1 - z)
        a, b = (long, short) if k % 2 == 0 else (short, long)
        a += rnd.uniform(-0.05, 0.05)
        b += rnd.uniform(-0.05, 0.05)
        pp = p + rnd.uniform(-0.008, 0.01)
        x0, x1 = sorted((x + sx * pp, x - sx * a))
        y0, y1 = sorted((y + sy * pp, y - sy * b))
        m.add(open_box((x0, y0, z), (x1, y1, z + h - 0.012), mat, 'quoin', bottom=z > 0.02))
        z += h
        k += 1


def shutter_leaf(L, H, t, mat, style='planks', dirx=1, seed=1, hinges=True, inner=True):
    """A shutter leaf hinged at the local origin, extending along dirx*x,
    occupying y in [-t, 0] (outside = -Y when closed). style:
    'planks' - 3-4 boards with gaps; ledges, a Z brace and strap hinges on the
               inner (+Y) face, which faces the street once the leaf is open;
    'louvre' - a sawtooth louvred leaf (town houses), hinges inside;
    'plain'  - one board (cheap, for far / small windows)."""
    rnd = random.Random(seed)
    c = dirx * L / 2
    parts = []
    if style == 'louvre':
        n = max(6, int(H / 0.17))
        st = H / n
        pts = [(0.0, 0.0), (0.0, H)]
        for i in range(n):
            zt = H - i * st
            pts.append((-t * 0.55, zt - 0.004))
            pts.append((-t - 0.012, zt - st * 0.92))
        pts.append((-t * 0.55, 0.0))
        o = kit.extrude_profile(list(reversed(pts)), L - 0.06, 'X', mat=mat, name='louvre')
        o.location.x = c
        parts.append(o)
        for xx in (dirx * 0.025, dirx * (L - 0.025)):          # stiles
            parts.append(kit.box((0.05, t + 0.01, H), loc=(xx, -t / 2, H / 2), mat=mat, name='stile'))
        for zz in (0.03, H - 0.03):
            parts.append(kit.box((L, t + 0.01, 0.06), loc=(c, -t / 2, zz), mat=mat, name='rail'))
    elif style == 'plain':
        parts.append(kit.box((L, t, H), loc=(c, -t / 2, H / 2), mat=mat, name='leaf'))
    else:
        n = 3 if L < 0.55 else 4
        pw = L / n
        for i in range(n):
            hh = H - rnd.uniform(0.0, 0.025)
            parts.append(kit.box((pw - 0.007, t + rnd.uniform(-0.004, 0.003), hh),
                                 loc=(dirx * (pw * (i + 0.5)), -t / 2, hh / 2 + rnd.uniform(0, 0.008)), mat=mat, name='splank'))
    if style in ('planks', 'plain') and inner:
        lz = (0.16 * H, 0.84 * H)
        for zz in lz:
            parts.append(kit.box((L - 0.06, 0.024, 0.085), loc=(c, 0.012, zz), mat=mat, name='ledge'))
        dz = lz[1] - lz[0] - 0.07
        ang = math.degrees(math.atan2(dz, L - 0.14))
        parts.append(kit.box((math.hypot(dz, L - 0.14), 0.02, 0.075), loc=(c, 0.01, (lz[0] + lz[1]) / 2),
                             rot=(0, -ang * dirx, 0), mat=mat, name='brace'))
    else:
        lz = (0.2 * H, 0.8 * H)
    if hinges and inner:
        for zz in (lz[0], lz[-1]):
            # strap hinge over the ledge, knuckle at the hinge edge
            parts.append(kit.box((L * 0.72, 0.006, 0.032), loc=(dirx * L * 0.36, 0.027 if style != 'louvre' else 0.003, zz),
                                 mat='iron', name='strap'))
    return parts


def _height_at(pts, x):
    """Highest z of a closed outline at abscissa x."""
    best = None
    n = len(pts)
    for i in range(n):
        (x0, z0), (x1, z1) = pts[i], pts[(i + 1) % n]
        if (x0 - x) * (x1 - x) <= 0 and abs(x1 - x0) > 1e-9:
            z = z0 + (z1 - z0) * (x - x0) / (x1 - x0)
            best = z if best is None else max(best, z)
    return best if best is not None else max(p[1] for p in pts)


def opening_springing(kind, hw, z0, h, R=None, rise=None):
    """Springing height for an opening of total height h (sill to top)."""
    if kind == 'rect':
        return z0 + h
    if kind == 'round':
        return z0 + h - hw
    if kind == 'segment':
        return z0 + h - (rise if rise is not None else hw * 0.35)
    if kind == 'lancet':
        R = R if R is not None else hw * 1.7
        cx = hw - R
        return z0 + h - math.sqrt(max(R * R - cx * cx, 0.0))
    raise ValueError(kind)


def drip_sill(w, y0, y1, z, mat, name='sill'):
    """Stone sill: sloped weathering, a nose 0.1 m proud, a drip groove under it."""
    prof = [(y1, z - 0.085), (y1, z + 0.005), (0.02, z + 0.005), (y0, z - 0.03), (y0, z - 0.085),
            (y0 + 0.025, z - 0.085), (y0 + 0.025, z - 0.07), (y0 + 0.04, z - 0.07), (y0 + 0.04, z - 0.085)]
    o = kit.extrude_profile(prof, w, 'X', mat=mat, name=name)
    return o


def curtains(hw, z0, zs, y, seed=1, gap=0.5):
    """Two drawn-back curtain panels (cloth that glows with the room light)
    and a pelmet, in a wall frame; returns objects."""
    rnd = random.Random(seed)
    parts = []
    for side in (-1, 1):
        w_top = hw * (1 - gap * rnd.uniform(0.7, 1.1))
        w_bot = w_top * rnd.uniform(0.45, 0.7)
        nf = 7
        verts, faces = [], []
        for row, (zz, ww) in enumerate(((z0 + 0.03, w_bot), (zs - 0.06, w_top))):
            for i in range(nf + 1):
                f = i / nf
                xx = side * (hw - ww * f)
                yy = y + (0.018 if i % 2 else -0.012)
                verts.append((xx, yy, zz))
        for i in range(nf):
            a, b_ = i, i + 1
            c_, d_ = nf + 1 + i + 1, nf + 1 + i
            faces.append((a, b_, c_, d_) if side < 0 else (b_, a, d_, c_))
        parts.append(mesh('curtain', verts, faces, 'curtain'))
    parts.append(kit.box((2 * hw - 0.02, 0.05, 0.1), loc=(0, y - 0.03, zs - 0.06), mat='curtain', name='pelmet'))
    return parts


def window(m, F, x, z0, w, h, cutters, depth=0.25, kind='rect', n=6, R=None, rise=None,
           surround='stone', surround_mat='ashlar', b=0.15, bt=None, p=0.035, keystone=False,
           sill=True, sill_mat=None, frame_mat='paint_white', bars=(1, 2), glass=None,
           shutters=None, shutter_mat='shutter_green', angles=(172, 168), shutter_style='planks',
           lit=False, lamp=None, through=0.0, lintel_mat=None, frame_t=0.06, rail=None, pane=True,
           reveal=None, hang=None, dogs=True, seed=None, casement=None, curtain_gap=0.5, tracery=False, stains=True):
    """A recessed window in wall frame F at x (sill z0, width w, height h).
    Adds the parts to `m` and the recess cutter to `cutters`.
    surround: 'stone' (dressed ring + lintel band) | 'jambs' (long-and-short
    dressed jamb stones, a lintel and a sill) | None.
    Rectangular windows get casements (two leaves, glazing bars, glass set
    back); lit ones show curtains in front of the room light (no glass).
    shutters: None | 'open' | 'ajar' | 'closed' | 'left' (one leaf lost);
    hang='left'|'right' leaves that leaf hanging off its lower hinge.
    reveal: material given to the cut reveal faces (default 'stone')."""
    seed = seed if seed is not None else int(abs(x) * 97 + z0 * 31 + w * 13)
    rnd = random.Random(seed)
    hw = w / 2
    if kind == 'segment' and rise is None:
        rise = hw * 0.35
    if kind == 'lancet' and R is None:
        R = hw * 1.7
    zs = opening_springing(kind, hw, z0, h, R, rise)
    inner = outline(hw, z0, zs, kind, n, R, rise)
    top = outline_top(inner)
    M = F @ Matrix.Translation((x, 0, 0))
    local = []
    d_cut = through if through > 0 else depth
    cin = [(px, pz - 0.1 if pz <= z0 + 1e-6 and z0 < 0.05 else pz) for px, pz in inner]   # ground-level: cut below
    cutters.append(xform([slab(cin, -0.3, d_cut + 0.3, reveal or 'stone', 'cut')], M)[0])
    m.openings.setdefault(fkey(F), []).append((x - hw - b - 0.08, x + hw + b + 0.08, z0 - 0.14, top + (bt or 0.3) + 0.1))
    if stains and sill and reveal and through <= 0 and z0 > 0.3:
        m.decals.append(('sill', F, x, z0 - 0.11, w * 0.9 + 0.1, reveal, 1.6, 0))
    if surround == 'jambs' and kind == 'rect':
        # long-and-short jamb stones, one lintel block, the sill below
        sm = surround_mat
        for side in (-1, 1):
            z = z0 - 0.02
            k = rnd.randint(0, 1)
            while z < zs - 0.05:
                hh = min(rnd.uniform(0.26, 0.36), zs - z)
                ln = (0.3 if k % 2 == 0 else 0.2) + rnd.uniform(-0.03, 0.03)
                pp = p + rnd.uniform(-0.01, 0.01)
                x0_ = side * hw
                x1_ = side * (hw + ln)
                local.append(open_box((min(x0_, x1_), -pp, z), (max(x0_, x1_), 0.05, z + hh - 0.01), sm, 'jamb', bottom=True))
                z += hh
                k += 1
        lb = bt or 0.28
        local.append(kit.box((w + 0.5 + rnd.uniform(0, 0.1), p + 0.06, lb), loc=(rnd.uniform(-0.03, 0.03), -(p + 0.06) / 2 + 0.05, zs + lb / 2),
                             mat=lintel_mat or sm, name='lintel'))
    elif surround:
        bt = bt if bt is not None else b * 1.6
        if kind == 'rect':
            outer = [(-hw - b, z0 - 0.04), (hw + b, z0 - 0.04), (hw + b, zs + bt), (-hw - b, zs + bt)]
        else:
            outer = outline(hw + b, z0 - 0.04, zs, kind, n, (R + b) if R else None,
                            (rise + b * 0.6) if rise else None)
        if z0 < 0.05:
            outer = [(x_, max(z_, z0)) for x_, z_ in outer]
        local.append(ring(outer, inner, -p, p + 0.004, surround_mat, 'surround', open_bottom=z0 < 0.05, back=True))
        if keystone:
            local.append(kit.box((0.17, p + 0.03, b + 0.12), loc=(0, -(p + 0.03) / 2 + 0.004, top + b / 2 + 0.02),
                                 mat=surround_mat, name='key'))
        if lintel_mat and kind == 'rect':
            local.append(kit.box((w + 2 * b + 0.1, p + 0.025, bt + 0.04), loc=(0, -(p + 0.025) / 2 + 0.004, zs + bt / 2),
                                 mat=lintel_mat, name='lintel'))
    if sill:
        sm = sill_mat or surround_mat or 'stone'
        local.append(drip_sill(w + 0.24, -0.11, depth - 0.06, z0, sm))
    yf = depth - 0.07
    use_case = casement if casement is not None else (kind == 'rect' and frame_mat is not None and pane)
    if frame_mat and use_case:
        ft = frame_t
        fin = outline(hw - ft, z0 + ft, zs - ft, 'rect')
        local.append(ring(inner, fin, yf, 0.07, frame_mat, 'frame', outer_side=False))
        # two leaves (French casement), glass set back in each
        lt = 0.045
        nz = bars[1]
        yl = yf - 0.012
        for side in (-1, 1):
            lx0, lx1 = (-hw + ft, -0.004) if side < 0 else (0.004, hw - ft)
            lo = [(lx0, z0 + ft), (lx1, z0 + ft), (lx1, zs - ft), (lx0, zs - ft)]
            li = [(lx0 + lt, z0 + ft + lt * 1.4), (lx1 - lt, z0 + ft + lt * 1.4), (lx1 - lt, zs - ft - lt), (lx0 + lt, zs - ft - lt)]
            local.append(ring(lo, li, yl, 0.05, frame_mat, 'leaf', outer_side=True))
            for i in range(1, nz + 1):
                zz = li[0][1] + (li[2][1] - li[0][1]) * i / (nz + 1)
                local.append(kit.box((li[1][0] - li[0][0], 0.03, 0.022), loc=((li[0][0] + li[1][0]) / 2, yl + 0.03, zz),
                                     mat=frame_mat, name='bar'))
            if not lit:
                gk = glass or 'glass_dirty'
                local.append(poly([(px, yl + 0.04, pz) for px, pz in li], gk, 'glass'))
        if lit:
            local.append(poly([(px, depth - 0.012, pz) for px, pz in fin], 'window_lit', 'room'))
            local += curtains(hw - ft, z0 + ft, zs - ft, depth - 0.04, seed=seed, gap=curtain_gap)
    elif frame_mat:
        ft = frame_t
        if kind == 'rect':
            fin = outline(hw - ft, z0 + ft, zs - ft, 'rect')
        else:
            fin = outline(hw - ft, z0 + ft, zs, kind, n, (R - ft) if R else None, (rise - ft * 0.6) if rise else None)
        local.append(ring(inner, fin, yf, 0.06, frame_mat, 'frame', outer_side=not pane, back=not pane))
        gpts = fin
        nx, nz = bars
        gx0, gx1 = -hw + ft, hw - ft
        gz0 = z0 + ft
        gz1 = zs - ft if kind == 'rect' else zs
        for i in range(1, nx + 1):
            xx = gx0 + (gx1 - gx0) * i / (nx + 1)
            zt = _height_at(fin, xx) if kind != 'rect' else gz1
            bw = 0.055 if (nx % 2 == 1 and i == (nx + 1) // 2) else 0.03
            local.append(kit.box((bw, 0.05, zt - gz0), loc=(xx, yf + 0.03, (gz0 + zt) / 2), mat=frame_mat, name='mullion'))
        for i in range(1, nz + 1):
            zz = gz0 + (gz1 - gz0) * i / (nz + 1)
            local.append(kit.box((gx1 - gx0, 0.04, 0.03), loc=(0, yf + 0.032, zz), mat=frame_mat, name='bar'))
        if pane:
            gk = glass or ('window_lit' if lit else 'glass_dirty')
            local.append(poly([(px, yf + 0.035, pz) for px, pz in gpts], gk, 'glass'))
    elif pane:
        gk = glass or ('window_lit' if lit else 'glass_dirty')
        local.append(poly([(px, yf + 0.035, pz) for px, pz in inner], gk, 'glass'))
    if tracery and kind == 'lancet':
        # Y tracery: a mullion splitting into two pointed lights, an oculus above
        yt_ = depth - 0.13
        tw_ = 0.07
        sq = [(tw_ / 2, 0.05), (-tw_ / 2, 0.05), (-tw_ / 2, -0.05), (tw_ / 2, -0.05)]
        local.append(kit.box((tw_, 0.1, zs - z0 + 0.02), loc=(0, yt_, (z0 + zs) / 2), mat=surround_mat or 'stone', name='mullion'))
        shw = hw / 2
        for side in (-1, 1):
            arc = outline(shw, z0, zs, 'lancet', 6, shw * 1.7)
            pts = [(px + side * shw, pz) for px, pz in arc[2:]]
            local.append(sweep([(px, yt_, pz) for px, pz in pts], sq, surround_mat or 'stone', 'tracery', up=(0, 1, 0)))
        oc = zs + (top - zs) * 0.62
        r_ = min(hw * 0.38, (top - zs) * 0.3)
        ring_pts = [(math.cos(2 * math.pi * k / 10) * r_, yt_, oc + math.sin(2 * math.pi * k / 10) * r_) for k in range(10)]
        local.append(sweep(ring_pts + [ring_pts[0]], sq, surround_mat or 'stone', 'oculus', up=(0, 1, 0), loop=True))
    if shutters:
        t = 0.032
        prot = (p + 0.06) if surround == 'jambs' else (p if surround else 0.0)
        hy = -prot - t - 0.012
        L = hw + 0.02
        H = (zs - z0) + 0.04
        if shutters == 'closed':
            a_l, a_r = 0, 0
        elif shutters == 'left':
            a_l, a_r = angles[0], None
        else:
            a_l, a_r = angles
        for side, ang in ((-1, a_l), (1, a_r)):
            if ang is None:
                continue
            leaf = shutter_leaf(L, H, t, shutter_mat, shutter_style, dirx=-side, seed=seed + side, inner=ang > 30)
            hx = side * (hw + 0.02)
            sag = rnd.uniform(0.6, 2.8) if ang else rnd.uniform(0.2, 0.9)
            Mh = (Matrix.Translation((hx, hy, z0 - 0.02)) @ Matrix.Rotation(math.radians(side * ang), 4, 'Z')
                  @ Matrix.Translation((0, 0, 0.16 * H)) @ Matrix.Rotation(math.radians(sag * -side), 4, 'Y')
                  @ Matrix.Translation((0, 0, -0.16 * H)))
            if hang == ('left' if side < 0 else 'right'):
                # top hinge torn out: the leaf swings down about the lower one
                Mh = (Matrix.Translation((hx, hy - 0.03, z0 - 0.02 + H * 0.16)) @ Matrix.Rotation(math.radians(side * 26), 4, 'Y')
                      @ Matrix.Rotation(math.radians(-6), 4, 'X') @ Matrix.Translation((0, 0, -H * 0.16))
                      @ Matrix.Rotation(math.radians(side * ang), 4, 'Z'))
            xform(leaf, Mh)
            local += leaf
            # a shutter dog holding the open leaf
            if dogs and ang and ang > 150 and not hang:
                dx = side * (hw + 0.02 + L + 0.05)
                local.append(kit.box((0.025, 0.06, 0.1), loc=(dx, -prot - 0.03, z0 + H * 0.3), rot=(0, side * 25, 0), mat='iron', name='dog'))
    if rail:
        ry = -0.13
        rz = z0 + rail
        local.append(kit.box((w + 0.14, 0.045, 0.04), loc=(0, ry, rz), mat='iron_black', name='rail'))
        local.append(kit.box((w + 0.14, 0.03, 0.03), loc=(0, ry, z0 + 0.12), mat='iron_black', name='rail'))
        nb = max(3, int(w / 0.12))
        for i in range(nb + 1):
            xx = -hw - 0.05 + (w + 0.1) * i / nb
            local.append(kit.box((0.016, 0.016, rail - 0.12), loc=(xx, ry, z0 + 0.12 + (rail - 0.12) / 2), mat='iron_black', name='baluster'))
        for i in range(nb):
            xx = -hw - 0.05 + (w + 0.1) * (i + 0.5) / nb
            local.append(kit.cyl(0.035, 0.012, loc=(xx, ry, z0 + 0.12 + (rail - 0.12) * 0.55), rot=(90, 0, 0), mat='iron_black', verts=6, name='scroll', cap=False))
        for sx in (-1, 1):
            local.append(kit.box((0.03, 0.15, 0.03), loc=(sx * (hw + 0.05), ry / 2, rz), mat='iron_black', name='stay'))
    xform(local, M)
    m.add(*local)
    if lit and lamp:
        m.anchor(lamp, M @ V((0, depth + 1.0, (z0 + top) / 2)))
    return M


def studs(x0, x1, z, y, n, mat='iron'):
    """A row of nail heads (little pyramids) on a door face at height z."""
    out = []
    for i in range(n):
        xx = x0 + (x1 - x0) * (i + 0.5) / n
        verts = [(xx - 0.012, y, z - 0.012), (xx + 0.012, y, z - 0.012), (xx + 0.012, y, z + 0.012), (xx - 0.012, y, z + 0.012),
                 (xx, y - 0.012, z)]
        out.append(mesh('stud', verts, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], mat))
    return out


def ring_handle(x, y, z, r=0.055):
    pts = [(x + math.cos(2 * math.pi * k / 10) * r * 0.0, y - 0.03, z - r + math.cos(2 * math.pi * k / 10) * r) for k in range(10)]
    pts = [(x + math.sin(2 * math.pi * k / 10) * r, y - 0.035, z - r + math.cos(2 * math.pi * k / 10) * r) for k in range(10)]
    o = sweep(pts + [pts[0]], circle_profile(0.008, 4), 'iron', 'ring', up=(0, 1, 0), loop=True)
    plate = kit.cyl(0.035, 0.012, loc=(x, y - 0.006, z), rot=(90, 0, 0), mat='iron', verts=8, name='rose')
    return [o, plate]


def stone_steps(w, n=2, rise=0.15, tread=0.32, mat='stone', y0=0.0, seed=1):
    """Steps in front of a door (wall frame: outside is -Y); returns objects.
    Each step has a chamfered nosing."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        top = rise * (n - i)
        d = tread * (i + 1) + 0.05
        ww = w + 0.5 + 0.2 * (n - 1 - i) * 0 + 0.25 * i
        ww = w + 0.35 + 0.3 * i
        prof = [(y0 + 0.05, 0.0), (y0 + 0.05, top), (y0 - d + 0.03, top), (y0 - d, top - 0.03), (y0 - d, 0.0)]
        prof = [(yy, zz) for yy, zz in prof]
        o = kit.extrude_profile(list(reversed(prof)), ww + rnd.uniform(-0.03, 0.03), 'X', mat=mat, name='step')
        o.location.x = rnd.uniform(-0.02, 0.02)
        out.append(o)
    return out


def door(m, F, x, w, h, cutters, z0=0.15, depth=0.22, kind='rect', n=6, rise=None,
         surround='stone', surround_mat='ashlar', b=0.18, bt=None, p=0.04, keystone=False,
         leaf_mat='board_dark', planks=None, step=True, step_mat='ashlar_step', step_d=0.45,
         fanlight=False, lit_fan=False, glazed=False, canopy=None, anchor=None, through=0.0,
         lintel_mat=None, tymp_mat=None, reveal=None, nsteps=None, seed=None, studs_on=True):
    """A recessed plank door at x in wall frame F, threshold at z0 on stone
    steps. Ledged boards with nail-head studs, strap hinges, a ring handle and
    escutcheon; a timber lining in the reveal; arched kinds get a tympanum or
    a fanlight above the springing."""
    seed = seed if seed is not None else int(abs(x) * 101 + w * 17)
    rnd = random.Random(seed)
    hw = w / 2
    if kind == 'segment' and rise is None:
        rise = hw * 0.35
    zs = opening_springing(kind, hw, z0, h, None, rise)
    inner = outline(hw, z0, zs, kind, n, None, rise)
    top = outline_top(inner)
    M = F @ Matrix.Translation((x, 0, 0))
    m.openings.setdefault(fkey(F), []).append((x - hw - b - 0.1, x + hw + b + 0.1, -1.0, top + (bt or 0.3) + 0.12))
    local = []
    d_cut = through if through > 0 else depth
    cin = [(px, pz - 0.1 if pz <= z0 + 1e-6 and z0 < 0.05 else pz) for px, pz in inner]   # ground-level: cut below
    cutters.append(xform([slab(cin, -0.3, d_cut + 0.3, reveal or 'stone', 'cut')], M)[0])
    if surround == 'jambs' and kind == 'rect':
        for side in (-1, 1):
            z = max(z0 - 0.02, 0.0)
            k = rnd.randint(0, 1)
            while z < zs - 0.05:
                hh = min(rnd.uniform(0.28, 0.38), zs - z)
                ln = (0.34 if k % 2 == 0 else 0.22) + rnd.uniform(-0.03, 0.03)
                x0_, x1_ = side * hw, side * (hw + ln)
                local.append(open_box((min(x0_, x1_), -p, z), (max(x0_, x1_), 0.05, z + hh - 0.01), surround_mat, 'jamb', bottom=True))
                z += hh
                k += 1
        local.append(kit.box((w + 0.65, p + 0.06, 0.32), loc=(0, -(p + 0.06) / 2 + 0.05, zs + 0.16), mat=lintel_mat or surround_mat, name='lintel'))
    elif surround:
        bt = bt if bt is not None else b * 1.5
        if kind == 'rect':
            outer = [(-hw - b, z0 - 0.02), (hw + b, z0 - 0.02), (hw + b, zs + bt), (-hw - b, zs + bt)]
        else:
            outer = outline(hw + b, z0 - 0.02, zs, kind, n, None, (rise + b * 0.5) if rise else None)
        if z0 < 0.05:
            outer = [(x_, max(z_, z0)) for x_, z_ in outer]
        local.append(ring(outer, inner, -p, p + 0.004, surround_mat, 'dsurround', open_bottom=z0 < 0.05, back=True))
        if keystone:
            local.append(kit.box((0.2, p + 0.03, b + 0.12), loc=(0, -(p + 0.03) / 2 + 0.004, top + b / 2 + 0.02),
                                 mat=surround_mat, name='key'))
        if lintel_mat and kind == 'rect':
            local.append(kit.box((w + 2 * b + 0.1, p + 0.03, bt), loc=(0, -(p + 0.03) / 2 + 0.004, zs + bt / 2),
                                 mat=lintel_mat, name='lintel'))
    yl = depth - 0.07
    # timber lining in the reveal
    fin = [(px * (hw - 0.06) / hw, max(pz - 0.0, z0)) for px, pz in inner]
    fin = outline(hw - 0.06, z0, zs if kind == 'rect' else zs, kind, n, None, (rise - 0.04) if rise else None)
    if kind == 'rect':
        fin = outline(hw - 0.06, z0, zs - 0.06, 'rect')
    local.append(ring(inner, fin, yl - 0.02, 0.1, 'board_dark', 'lining', outer_side=False, open_bottom=True))
    leaf_top = zs - (0.06 if kind == 'rect' else 0.0)
    lhw = hw - 0.06
    if kind == 'rect' and fanlight:
        leaf_top = zs - 0.48
        local.append(kit.box((2 * lhw, 0.08, 0.08), loc=(0, yl + 0.03, leaf_top + 0.04), mat='board_dark', name='transom'))
        gl = [(-lhw, leaf_top + 0.08), (lhw, leaf_top + 0.08), (lhw, zs - 0.06), (-lhw, zs - 0.06)]
        local.append(poly([(px, yl + 0.045, pz) for px, pz in gl], 'window_lit' if lit_fan else 'glass', 'fan'))
        for i in (1, 2):
            local.append(kit.box((0.025, 0.03, zs - 0.06 - leaf_top - 0.08), loc=(-lhw + 2 * lhw * i / 3, yl + 0.03, (zs - 0.06 + leaf_top + 0.08) / 2),
                                 mat='board_dark', name='fanbar'))
    elif kind != 'rect':
        pts = fin[2:]
        tk = ('window_lit' if lit_fan else 'glass') if fanlight else (tymp_mat or leaf_mat)
        local.append(poly([(px, yl + 0.045, pz) for px, pz in pts], tk, 'tymp'))
        local.append(kit.box((2 * lhw, 0.09, 0.09), loc=(0, yl + 0.03, zs - 0.045), mat='board_dark', name='transom'))
        if fanlight:
            for i in (1, 2, 3):
                a = math.pi * i / 4
                local.append(kit.box((0.02, 0.03, (top - zs) * 0.9), loc=(math.cos(a) * lhw * 0.45, yl + 0.03, zs + math.sin(a) * (top - zs) * 0.45),
                                     rot=(0, math.degrees(math.pi / 2 - a), 0), mat='board_dark', name='fanbar'))
        leaf_top = zs - 0.09
    lh = leaf_top - z0
    nplank = planks or max(3, int(round(2 * lhw / 0.19)))
    pw = 2 * lhw / nplank
    for i in range(nplank):
        xx = -lhw + pw * (i + 0.5)
        local.append(kit.box((pw - 0.008, 0.05 + rnd.uniform(-0.006, 0.006), lh - rnd.uniform(0, 0.01)), loc=(xx, yl + 0.025, z0 + lh / 2),
                             mat=leaf_mat, name='plank'))
    rows = (z0 + 0.25, z0 + lh * 0.5, z0 + lh - 0.25)
    if studs_on:
        for zz in rows:
            local += studs(-lhw + 0.02, lhw - 0.02, zz, yl - 0.002, nplank * 2)
    if glazed:
        gz0 = z0 + lh * 0.5
        local.append(poly([(-lhw + 0.13, yl - 0.003, gz0), (lhw - 0.13, yl - 0.003, gz0),
                           (lhw - 0.13, yl - 0.003, z0 + lh - 0.13), (-lhw + 0.13, yl - 0.003, z0 + lh - 0.13)], 'glass', 'dglass'))
    for zz in (rows[0], rows[2]):
        local.append(kit.box((2 * lhw * 0.62, 0.012, 0.045), loc=(-lhw + 2 * lhw * 0.31, yl - 0.006, zz + 0.05), mat='iron', name='strap'))
        local.append(kit.box((0.06, 0.012, 0.06), loc=(-lhw + 2 * lhw * 0.62, yl - 0.006, zz + 0.05), rot=(0, 45, 0), mat='iron', name='strapend'))
    local += ring_handle(lhw - 0.16, yl, z0 + 1.0)
    local.append(kit.box((0.05, 0.01, 0.1), loc=(lhw - 0.16, yl - 0.005, z0 + 0.85), mat='iron', name='escutcheon'))
    if step and z0 > 0.02:
        ns = nsteps or (1 if z0 < 0.2 else 2)
        st = stone_steps(w, n=ns, rise=z0 / ns, tread=step_d / ns if ns > 1 else step_d, mat=step_mat, seed=seed)
        local += st
        dd = step_d + 0.05
        m.col_box(M @ V((0, -dd / 2 + 0.05, z0 / 2)), (w + 0.35 + 0.3 * (ns - 1), dd, z0), yaw=math.degrees(M.to_euler().z))
    if canopy:
        cw = w + 0.7
        cz = top + 0.38
        cd = 0.7
        c = kit.extrude_profile([(0.0, 0.0), (-cd, -0.25), (-cd, -0.31), (0.0, -0.08)], cw, 'X', mat=canopy, name='canopy')
        c.location = (0, 0, cz + 0.1)
        local.append(c)
        for sx in (-1, 1):
            br = kit.extrude_profile([(0.0, 0.05), (-cd + 0.06, -0.15), (-cd + 0.06, -0.2), (0.0, -0.5)], 0.04, 'X',
                                     mat='iron', name='bracket')
            br.location = (sx * (cw / 2 - 0.12), 0, cz + 0.02)
            local.append(br)
    xform(local, M)
    m.add(*local)
    if anchor:
        m.anchor(anchor, M @ V((0, -1.0, 0)))
    return M


def barrel_tile(length, r0, r1, mat='roof_tile', name='rtile', n=5):
    """A half-round tile along +X from 0 to length, open side down (radius
    r0 at x = 0, r1 at the other end), as a closed shell."""
    verts, faces = [], []
    th = 0.018
    for x, r in ((0.0, r0), (length, r1)):
        for k in range(n + 1):
            a = math.pi * k / n
            verts.append((x, r * math.cos(a), r * math.sin(a)))
        for k in range(n + 1):
            a = math.pi * (n - k) / n
            verts.append((x, (r - th) * math.cos(a), (r - th) * math.sin(a) + 0.002))
    m_ = 2 * (n + 1)
    for k in range(m_):
        k2 = (k + 1) % m_
        faces.append((k, k2, m_ + k2, m_ + k))
    faces.append(tuple(reversed(range(m_))))
    faces.append(tuple(m_ + k for k in range(m_)))
    return mesh(name, verts, faces, mat, recalc=True)


def gable_roof(m, L, D, z_e, rise, oe=0.35, og=0.25, t=0.16, mat='roof_tile', sag=0.07, nseg=8,
               ridge_mat=None, ridge_r=0.12, gutter=True, gutter_sides=(-1, 1), downpipes=(), seed=1,
               barge=None, round_eave=0.0, ridge_profile=None, x0=0.0, y0=0.0, kick=0.0, wobble=0.025,
               ridge_tiles=None, eave_tiles=None, verge=None, brackets=True, missing=(), slipped=(),
               hole=None, block=None, hole_cutters=None, north='back', courses=2, hide_under=False):
    """Gable roof, ridge along X over an L x D block whose walls end at z_e.
    Two slab slopes with a sagging ridge; for tiled roofs individual ridge
    tiles on a mortar bed, the round tile ends along the eaves and mortared
    verges; slate roofs get a lead roll. Gutters on iron brackets, downpipes
    with a hopper, clips and a shoe.
    missing: [(side, x, frac)] tiles gone (hole in the cover, battens show);
    slipped: [(side, x, frac)] loose tiles lying askew;
    hole: dict(side, x, frac, r) a shell hole through the roof (and, if
    `hole_cutters` is a list, a cavity cutter into the house block below)
    with splintered battens and rafters.
    Returns f(x, y) -> roof underside height."""
    rnd = random.Random(seed)
    h = D / 2
    tan_a = rise / h
    alpha = math.atan(tan_a)
    cos_a = math.cos(alpha)
    tv = t / cos_a
    Lr = L + 2 * og
    off = V((rnd.uniform(-9, 9), rnd.uniform(-9, 9), rnd.uniform(-9, 9)))
    tiled = mat == 'roof_tile'
    ridge_tiles = tiled if ridge_tiles is None else ridge_tiles
    eave_tiles = tiled if eave_tiles is None else eave_tiles
    verge = tiled if verge is None else verge

    def sagz(x, frac):            # frac: 0 eaves .. 1 ridge
        f = max(0.0, 1 - (2 * x / Lr) ** 2)
        nz = noise.noise(V((x * 0.6, frac * 2, 0)) + off) * wobble
        return -sag * f * (0.35 + 0.65 * frac) + nz * (0.3 + frac)

    def zu(yabs):
        z = z_e + rise * (1 - yabs / h)
        if kick and yabs > h:                # coyau: the slope flattens over the eaves
            z += kick * ((yabs - h) / oe) ** 1.4
        return z

    def top_point(s, x, frac):
        """A point on the top surface: frac 0 = eave edge, 1 = ridge."""
        yy = (1 - frac) * (h + oe)
        return V((x + x0, y0 + s * yy, zu(yy) + tv + sagz(x, frac if yy <= h else 0.0)))

    ye = h + oe
    slopes = {}
    for s in (-1, 1):
        rows = [(ye, 0.0), (h, 0.1), (h * 0.45, 0.6), (0.0, 1.0)] if (kick or hide_under) else [(ye, 0.0), (h * 0.5, 0.5), (0.0, 1.0)]
        verts, faces = [], []
        ncol = nseg + 1
        sect = []
        for yy, fr in rows:
            sect.append((s * yy, zu(yy), fr, 'b'))
        for yy, fr in reversed(rows):
            sect.append((s * yy, zu(yy) + tv, fr, 't'))
        if round_eave > 0:
            sect.append((s * (ye + round_eave), zu(ye) + tv * 0.45, 0.0, 'n'))
        nsec = len(sect)
        xs = [-Lr / 2 + Lr * i / nseg for i in range(nseg + 1)]
        if hide_under:        # columns on the gable walls so the underside splits there
            xs = sorted(set([round(x_, 6) for x_ in xs] + [-L / 2, L / 2]))
        for x in xs:
            for yy, zz, fr, _ in sect:
                verts.append((x + x0, yy + y0, zz + sagz(x, fr)))
        nc = len(xs) - 1
        for i in range(nc):
            for k in range(nsec):
                k2 = (k + 1) % nsec
                faces.append((i * nsec + k, i * nsec + k2, (i + 1) * nsec + k2, (i + 1) * nsec + k))
        faces.append(tuple(range(nsec)))
        faces.append(tuple(nc * nsec + k for k in reversed(range(nsec))))
        smat = mat
        if north and ((north == 'back' and s > 0) or (north == 'front' and s < 0)) and (mat + '_n') in kit.PALETTE:
            smat = mat + '_n'
        slopes[s] = mesh('roof', verts, faces, smat, recalc=True)
        if hide_under:          # the underside inside the walls is never seen: give its texels to the rest
            drop_faces(slopes[s], lambda c, n_: n_.z < -0.3 and abs(c.y - y0) < h - 0.03 and abs(c.x - x0) < L / 2 - 0.01)

    def slope_frame(s, x, frac):
        """Matrix at a point on slope s: X along the eave, Y down-slope
        (outwards), Z = surface normal."""
        p0 = top_point(s, x, frac)
        p1 = top_point(s, x, max(0.0, frac - 0.05))
        dn = (p1 - p0).normalized()
        ax = V((1, 0, 0))
        nz = ax.cross(dn) if s < 0 else dn.cross(ax)
        nz.normalize()
        if nz.z < 0:
            nz = -nz
        dn = nz.cross(ax).normalized()          # right-handed (ax, dn, nz)
        mtx = Matrix((ax, dn, nz)).transposed().to_4x4()
        mtx.translation = p0
        return mtx

    # missing tiles: shallow holes in the cover with battens showing
    for (s, x, frac) in missing:
        Mf = slope_frame(s, x, frac)
        c = kit.box((0.24, 0.42, 0.14), loc=(0, 0, 0.0), mat='board_dark', name='mcut')
        c.matrix_basis = Mf @ Matrix.Rotation(math.radians(rnd.uniform(-4, 4)), 4, 'Z') @ c.matrix_basis
        cut(slopes[s], c)
        for dy in (-0.1, 0.12):
            bt_ = kit.box((0.34, 0.035, 0.022), loc=(0, dy, -0.045), mat='board_dark', name='batten')
            bt_.matrix_basis = Mf @ bt_.matrix_basis
            m.add(bt_)
    hole_parts = []
    if hole:
        s, x, frac, r = hole['side'], hole['x'], hole['frac'], hole['r']
        Mf = slope_frame(s, x, frac)
        pts = []
        for k in range(11):
            a = 2 * math.pi * k / 11
            rr = r * rnd.uniform(0.65, 1.15)
            pts.append((math.cos(a) * rr, math.sin(a) * rr * 1.2))
        hc = kit.extrude_xy(pts, 1.2, mat='burnt', name='hcut', z0=-0.6)
        hc.matrix_basis = Mf
        cut(slopes[s], hc)
        if hole_cutters is not None:
            cav = kit.extrude_xy([(px * 0.9, py * 0.9) for px, py in pts], 1.4, mat='burnt', name='cav', z0=-1.6)
            p0 = Mf.translation
            cav.matrix_basis = Matrix.Translation((p0.x, p0.y, p0.z - 0.1))
            hole_cutters.append(cav)
        # splintered battens across the hole and a broken rafter
        for k in range(5):
            dy = -r * 1.1 + k * r * 0.55
            for side_ in (-1, 1):
                ln = rnd.uniform(0.15, r * 0.9)
                bx = side_ * (r * 1.15 - ln / 2)
                b_ = kit.box((ln, 0.04, 0.025), loc=(bx, dy, -0.06), rot=(rnd.uniform(-8, 8), side_ * rnd.uniform(5, 25), rnd.uniform(-6, 6)),
                             mat='board_dark', name='splinter')
                b_.matrix_basis = Mf @ b_.matrix_basis
                hole_parts.append(b_)
        for side_ in (-1, 1):
            rf = kit.box((0.08, r * 1.3, 0.12), loc=(side_ * r * 0.35, side_ * r * 0.4, -0.25),
                         rot=(side_ * rnd.uniform(15, 30), rnd.uniform(-10, 10), rnd.uniform(-8, 8)), mat='burnt', name='rafter')
            rf.matrix_basis = Mf @ rf.matrix_basis
            hole_parts.append(rf)
        # broken tiles scattered below the hole
        for k in range(9):
            fr2 = max(0.03, frac - rnd.uniform(0.1, 0.5))
            M2 = slope_frame(s, x + rnd.uniform(-1.2, 1.2), fr2)
            tl = barrel_tile(rnd.uniform(0.12, 0.25), 0.07, 0.065, mat='roof_tile', name='shard', n=2)
            tl.matrix_basis = M2 @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, 'Z') @ Matrix.Translation((0, 0, -0.02))
            hole_parts.append(tl)
        m.add(*hole_parts)
    m.add(slopes[-1], slopes[1])
    # loose tiles lying askew
    for (s, x, frac) in slipped:
        Mf = slope_frame(s, x, frac)
        tl = barrel_tile(0.42, 0.11, 0.1, mat='roof_tile', name='slipped')
        tl.matrix_basis = Mf @ Matrix.Rotation(math.radians(rnd.uniform(20, 70)), 4, 'Z') @ Matrix.Rotation(0.15, 4, 'X') @ Matrix.Translation((-0.2, 0, -0.03))
        m.add(tl)
    # ridge
    if ridge_tiles:
        rz = lambda x: z_e + rise + tv + sagz(x, 1.0)
        bed = []
        for i in range(nseg + 1):
            x = -Lr / 2 + Lr * i / nseg
            bed.append((x + x0, y0, rz(x) - 0.05))
        m.add(sweep(bed, [(0.16, 0.0), (0.1, 0.06), (-0.1, 0.06), (-0.16, 0.0), (0.0, -0.08)], 'stone', 'ridgebed'))
        x = -Lr / 2 - 0.02
        tl_len = 0.42
        while x < Lr / 2 - 0.05:
            ln = min(tl_len, Lr / 2 + 0.02 - x)
            tile = barrel_tile(ln + 0.05, ridge_r, ridge_r * 1.1, mat=ridge_mat or mat, name='ridgetile', n=3)
            zz0, zz1 = rz(x), rz(x + ln)
            ang = math.atan2(zz1 - zz0, ln)
            tile.matrix_basis = (Matrix.Translation((x + x0, y0, zz0 - ridge_r * 0.25)) @ Matrix.Rotation(-ang, 4, 'Y')
                                 @ Matrix.Rotation(math.radians(rnd.uniform(-1.5, 1.5)), 4, 'Z'))
            m.add(tile)
            x += ln - 0.04
    else:
        rpts = []
        for i in range(nseg + 1):
            x = -Lr / 2 - 0.02 + (Lr + 0.04) * i / nseg
            rpts.append((x + x0, y0, z_e + rise + tv + sagz(x, 1.0) - ridge_r * 0.35))
        if ridge_profile is None:
            prof = [(ridge_r * math.cos(a), ridge_r * math.sin(a)) for a in (math.pi * k / 4 for k in range(5))]
            prof += [(-ridge_r, -ridge_r * 0.6), (ridge_r, -ridge_r * 0.6)]
        else:
            prof = ridge_profile
        m.add(sweep(rpts, prof, ridge_mat or mat, 'ridge'))
    # round tile ends along the eaves
    if eave_tiles:
      for ci in range(courses + 1):
        f0 = ci * 0.34 / (h + oe)
        for s in ((-1, 1) if ci == 0 else (-1,)):
            pitch = 0.21
            npts = int(Lr / pitch * 3)
            verts, faces = [], []
            ph = (ci % 2) * pitch * 0.5
            for i in range(npts + 1):
                x = -Lr / 2 + Lr * i / npts
                bump = 0.055 * abs(math.sin(math.pi * (x + ph) / pitch)) ** 0.8 * (1.0 if ci == 0 else 0.7)
                pe = top_point(s, x, f0)
                pu = top_point(s, x, f0 + 0.33 / (h + oe))
                nrm = V((0, -s * math.sin(alpha), math.cos(alpha)))
                verts += [pe + V((0, s * 0.012, -0.004)), pe + nrm * bump + V((0, s * 0.012, 0)), pu + nrm * bump * 0.7]
            for i in range(npts):
                a_, b_ = 3 * i, 3 * (i + 1)
                f1 = (a_, b_, b_ + 1, a_ + 1)
                f2 = (a_ + 1, b_ + 1, b_ + 2, a_ + 2)
                if s > 0:
                    f1, f2 = tuple(reversed(f1)), tuple(reversed(f2))
                faces += [f1, f2]
            m.add(mesh('eavetiles', verts, faces, slopes[s].data.materials[0].name))
    # mortared verges
    if verge:
        for sx in (-1, 1):
            xv = sx * (Lr / 2)
            for s in (-1, 1):
                pts = [top_point(s, xv, f) for f in (0.0, 0.5, 1.0)]
                pts = [p_ + V((-sx * 0.04, 0, -0.03)) for p_ in pts]
                m.add(sweep(pts, [(0.05, 0.0), (0.04, 0.05), (-0.06, 0.06), (-0.07, 0.0), (0.0, -0.1)], 'stone', 'verge', up=(1, 0, 0)))
    # gutters on brackets, downpipes with hoppers, clips and shoes
    if gutter:
        for s in gutter_sides:
            gpts = []
            xa, xb = -L / 2 - og * 0.6, L / 2 + og * 0.6
            ng = max(6, int((xb - xa) / 0.45))
            for i in range(ng + 1):
                x = xa + (xb - xa) * i / ng
                dip = -0.035 * abs(math.sin(math.pi * (x - xa) / 0.9)) ** 1.5
                fall = -0.05 * (x - xa) / (xb - xa)
                gpts.append((x + x0, y0 + s * (ye + 0.04), zu(ye) - 0.03 + sagz(x, 0.0) + dip + fall))
            gp = [(0.07, 0.03), (0.0, -0.06), (-0.07, 0.03), (-0.05, 0.03), (0.0, -0.035), (0.05, 0.03)]
            m.add(sweep(gpts, [(-u, v) for u, v in gp], 'iron', 'gutter', cap=True))
            if brackets:
                nb = int((xb - xa) / 0.9)
                for i in range(nb + 1):
                    x = xa + 0.9 * i
                    zg = zu(ye) - 0.03 + sagz(x, 0.0) - 0.05 * (x - xa) / (xb - xa)
                    br = kit.box((0.025, 0.2, 0.012), loc=(x + x0, y0 + s * (ye - 0.02), zg - 0.06),
                                 rot=(s * -15, 0, 0), mat='iron', name='gbracket')
                    m.add(br)
    for s, xdp in downpipes:
        yg = y0 + s * (ye + 0.04)
        yw = y0 + s * (h + 0.07)
        zg = zu(ye) - 0.06
        pts = [(xdp + x0, yg, zg), (xdp + x0, yg, zg - 0.12), (xdp + x0, yw, zg - 0.4), (xdp + x0, yw, 0.35),
               (xdp + x0, yw, 0.2), (xdp + x0, yw - s * 0.12, 0.06)]
        m.add(sweep(pts, circle_profile(0.045, 6), 'iron', 'downpipe', up=(1, 0, 0)))
        m.add(kit.box((0.16, 0.14, 0.14), (xdp + x0, yg, zg - 0.02), mat='iron', name='hopper'))
        zc = 0.9
        while zc < zg - 0.6:
            m.add(kit.box((0.12, 0.1, 0.035), (xdp + x0, yw - s * 0.01, zc), mat='iron', name='clip'))
            zc += 1.6
    if barge:
        for sx in (-1, 1):
            xb = x0 + sx * (L / 2 + og + 0.015)
            for s in (-1, 1):
                p0 = V((xb, y0 + s * ye, zu(ye) + tv * 0.5))
                p1 = V((xb, y0, z_e + rise + tv * 0.5))
                ln = (p1 - p0).length
                mid = (p0 + p1) / 2
                ang = math.degrees(math.atan2(p1.z - p0.z, abs(p1.y - p0.y)))
                bx = kit.box((0.035, ln + 0.05, tv + 0.12), loc=mid, rot=((ang if s < 0 else -ang), 0, 0), mat=barge, name='barge')
                m.add(bx)

    def under(x, y):
        return zu(abs(y - y0)) + sagz(x - x0, 1 - min(1, abs(y - y0) / h))
    return under


def chimney(m, x, y, z_base, z_top, w=0.7, d=0.55, mat='stone', cap_mat=None, pots=2, pot_mat='roof_tile', seed=1,
            flash_z=None, cowl=False):
    rnd = random.Random(seed)
    zs_ = z_top - 0.55
    m.box((w, d, zs_ - z_base), (x, y, (z_base + zs_) / 2), mat=mat, name='chimney')
    m.box((w, d, z_top - zs_), (x, y, (zs_ + z_top) / 2), mat=soot_key(mat), name='chimneytop')
    cm = soot_key(cap_mat or 'ashlar')
    m.box((w + 0.12, d + 0.12, 0.1), (x, y, z_top - 0.22), mat=cm, name='chband')
    m.box((w + 0.08, d + 0.08, 0.1), (x, y, z_top + 0.05), mat=cm, name='chcap')
    m.box((w - 0.06, d - 0.06, 0.06), (x, y, z_top + 0.12), mat='stone', name='flaunch')
    if flash_z is not None:
        m.box((w + 0.1, d + 0.1, 0.16), (x, y, flash_z), mat='lead', name='flashing')
    for i in range(pots):
        px = x + (i - (pots - 1) / 2) * (w / max(pots, 1)) * 0.85
        hgt = rnd.uniform(0.38, 0.6)
        m.add(kit.lathe([(0.125, 0), (0.105, hgt * 0.75), (0.13, hgt * 0.82), (0.13, hgt * 0.9), (0.11, hgt)], segments=7,
                        loc=(px, y, z_top + 0.1), mat=pot_mat, name='pot', cap=True))
        if cowl and i == 0:
            pts = [(px, y, z_top + 0.1 + hgt - 0.02), (px, y, z_top + 0.1 + hgt + 0.18), (px, y - 0.12, z_top + 0.1 + hgt + 0.3)]
            m.add(sweep(pts, circle_profile(0.07, 7), 'iron', 'cowl'))


def plaster_patch(m, F, x, z, sx, sz, mat='stone_dark', seed=1, y=-0.006):
    """Irregular patch where plaster has fallen off (flat polygon on the face)."""
    rnd = random.Random(seed)
    k = 9
    pts = []
    for i in range(k):
        a = 2 * math.pi * i / k
        r = rnd.uniform(0.65, 1.0)
        pts.append((x + math.cos(a) * sx * r, y, z + math.sin(a) * sz * r))
    o = poly(pts, mat, 'patch')
    xform([o], F)
    m.add(o)


def rubble_pile(m, cx, cy, rx, ry, hgt, mat='stone_rubble', seed=1, chunks=8, chunk_mat=None, segs=7):
    """A low lumpy mound of broken masonry plus loose blocks on it."""
    rnd = random.Random(seed)
    prof = [(1.0, 0.0), (0.86, 0.3), (0.58, 0.68), (0.24, 0.94), (0.0, 1.0)]
    o = kit.lathe([(r, z) for r, z in prof], segments=segs, mat=mat, name='mound', cap=False)
    o.scale = (rx, ry, hgt)
    o.location = (cx, cy, 0)
    kit.apply_transform(o)
    wobble(o, min(rx, ry) * 0.22, seed=seed, scale=1.6)
    for v in o.data.vertices:
        v.co.z = max(0.0, v.co.z)
    m.add(o)
    for i in range(chunks):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.2, 0.95)
        px, py = cx + math.cos(a) * rx * r, cy + math.sin(a) * ry * r
        pz = hgt * max(0.0, 1 - r * r) * 0.85
        sz = rnd.uniform(0.18, 0.4)
        m.box((sz * rnd.uniform(1.0, 1.8), sz, sz * rnd.uniform(0.5, 0.9)), (px, py, pz + sz * 0.2),
              rot=(rnd.uniform(-25, 25), rnd.uniform(-25, 25), rnd.uniform(0, 180)), mat=chunk_mat or 'fieldstone_fresh', name='chunk')


# --------------------------------------------------------------------------
# Review renders (not part of the export)

def street_view(objects, path, cam, target, lens=28, size=512, samples=20, res=None, ortho=None):
    """A Cycles still from an explicit camera position (e.g. eye height in the
    street), lit like kit.preview. For review only."""
    scene = bpy.context.scene
    keep = set(objects)
    hidden = []
    for o in scene.objects:
        if o.type in ('MESH', 'ARMATURE', 'EMPTY') and o not in keep and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    cd = bpy.data.cameras.new('sv_cam')
    cd.lens = lens
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    camo = kit.link(bpy.data.objects.new('sv_cam', cd))
    camo.location = V(cam)
    camo.rotation_euler = (V(target) - V(cam)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camo
    sd = bpy.data.lights.new('sv_sun', 'SUN')
    sd.energy = 3.0
    sd.angle = math.radians(8)
    sun = kit.link(bpy.data.objects.new('sv_sun', sd))
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-40))
    zmin = min(kit.bounds(o)[0].z for o in objects if o.type == 'MESH')
    floor = kit.plane(200, 200, loc=(0, 0, min(0.0, zmin) - 0.002), mat='dirt', name='sv_floor')
    world = bpy.data.worlds.get('preview') or bpy.data.worlds.new('preview')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.35, 0.38, 0.42, 1)
    bg.inputs['Strength'].default_value = 0.8
    scene.world = world
    scene.render.resolution_x = res[0] if res else size
    scene.render.resolution_y = res[1] if res else size
    scene.cycles.samples = samples
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    kit.delete(camo)
    kit.delete(sun)
    kit.delete(floor)
    for o in hidden:
        o.hide_render = False
    kit.log('street view', path)


def board_panel(x0, x1, z0, ztop, mat, t=0.05, board=0.22, relief=0.018, seed=1, top=False, M=None, name='boards',
                bottom=False):
    """Vertical boards in a wall frame: outer face near y=0 (facing -Y),
    inner face at y=t. ztop: height or f(x). Alternate boards stand proud by
    `relief` so the wall reads as planks. No bottom face."""
    zt = ztop if callable(ztop) else (lambda x, _z=ztop: _z)
    rnd = random.Random(seed)
    n = max(1, int(round((x1 - x0) / board)))
    xs = [x0 + (x1 - x0) * i / n for i in range(n + 1)]
    ys = [-(relief if i % 2 == 0 else 0.0) - rnd.uniform(0, 0.006) for i in range(n)]
    verts, faces = [], []

    def v(p):
        verts.append(p)
        return len(verts) - 1
    for i in range(n):
        xa, xb, y = xs[i], xs[i + 1], ys[i]
        faces.append((v((xa, y, z0)), v((xb, y, z0)), v((xb, y, zt(xb))), v((xa, y, zt(xa)))))
        if top:
            faces.append((v((xa, y, zt(xa))), v((xb, y, zt(xb))), v((xb, t, zt(xb))), v((xa, t, zt(xa)))))
        if bottom:
            faces.append((v((xa, y, z0)), v((xa, t, z0)), v((xb, t, z0)), v((xb, y, z0))))
    for i in range(1, n):
        x, yl, yr = xs[i], ys[i - 1], ys[i]
        faces.append((v((x, yl, z0)), v((x, yr, z0)), v((x, yr, zt(x))), v((x, yl, zt(x)))))
    faces.append((v((x0, t, z0)), v((x0, ys[0], z0)), v((x0, ys[0], zt(x0))), v((x0, t, zt(x0)))))
    faces.append((v((x1, ys[-1], z0)), v((x1, t, z0)), v((x1, t, zt(x1))), v((x1, ys[-1], zt(x1)))))
    inner = [v((x0, t, z0))] + [v((x, t, zt(x))) for x in xs] + [v((x1, t, z0))]
    faces.append(tuple(inner))
    o = mesh(name, verts, faces, mat)
    if M is not None:
        xform([o], M)
    return o


def buttress(m, M, w, depths, zs, mat='stone', cap_mat='ashlar', slope=1.0):
    """Stepped buttress against a wall frame M (wall face y=0, outside -Y):
    stage k spans zs[k]..zs[k+1] with depth depths[k]; each stage ends in a
    sloped weathering."""
    parts = []
    cm = cap_mat or mat
    for k in range(len(depths)):
        d = depths[k]
        z0, z1 = zs[k], zs[k + 1]
        dn = depths[k + 1] if k + 1 < len(depths) else 0.0
        parts.append(kit.box((w, d + 0.1, z1 - z0), loc=(0, -d / 2 + 0.05, (z0 + z1) / 2), mat=mat, name='buttress'))
        rise = (d - dn) * slope
        prof = [(-d - 0.02, z1), (0.05, z1), (0.05, z1 + rise + 0.02), (-dn, z1 + rise)]
        parts.append(kit.extrude_profile(prof, w + 0.04, 'X', mat=cm, name='weather'))
    xform(parts, M)
    m.add(*parts)
    return parts


def interp(ctrl, u):
    ctrl = sorted(ctrl)
    if u <= ctrl[0][0]:
        return ctrl[0][1]
    for (u0, z0), (u1, z1) in zip(ctrl, ctrl[1:]):
        if u0 <= u <= u1:
            return z0 + (z1 - z0) * (u - u0) / max(u1 - u0, 1e-9)
    return ctrl[-1][1]


def jagged_top(u0, u1, ctrl, seed=1, step=(0.12, 0.38), amp=0.2):
    """Broken masonry top line from u1 back to u0 (for a counter-clockwise
    outline): heights follow `ctrl` [(u, z)] plus coherent raggedness, with
    the occasional small stepped block (a dropped stone) and ragged slopes."""
    rnd = random.Random(seed)
    ph = rnd.uniform(0, 100)
    pts = []
    u = u1

    def zf(uu):
        return interp(ctrl, uu) + amp * (0.6 * noise.noise(V((uu * 1.7 + ph, 0.3, 0.0))) + 0.4 * rnd.uniform(-1, 1))
    z = zf(u)
    pts.append((u, z))
    while u > u0 + 0.05:
        un = max(u0, u - rnd.uniform(*step))
        zn = zf(un)
        if rnd.random() < 0.25 and un > u0 + 1e-6:
            zb = z + max(-0.22, min(0.22, zn - z))
            pts.append((un + rnd.uniform(0.0, 0.05), z + rnd.uniform(-0.03, 0.03)))   # a stone's flat top
            pts.append((un, zb))
            zn = zb
        else:
            pts.append((un, zn))
        u, z = un, zn
    if pts[-1][0] > u0 + 1e-6:
        pts.append((u0, z))
    return pts


def ragged_edge(ua, ub, z0, z1, seed=1, amp=0.12, step=(0.2, 0.4)):
    """A broken vertical-ish edge from (ua, z0) up to (ub, z1)."""
    rnd = random.Random(seed)
    pts = []
    z = z0
    while z < z1 - 0.15:
        f = (z - z0) / max(z1 - z0, 1e-6)
        pts.append((ua + (ub - ua) * f + rnd.uniform(-amp, amp), z))
        z += rnd.uniform(*step)
    return pts[1:]


def broach_spire(m, cx, cy, z0, a, z_top, hb=1.6, mat='roof_slate'):
    """Octagonal spire on a square base of half-size a, with corner broaches."""
    k = math.tan(math.pi / 8) * a
    octo = [(a, -k), (a, k), (k, a), (-k, a), (-a, k), (-a, -k), (-k, -a), (k, -a)]
    verts = [(cx + x, cy + y, z0) for x, y in octo] + [(cx, cy, z_top)]
    apex = 8
    faces = [(i, (i + 1) % 8, apex) for i in range(8)]
    faces.append(tuple(reversed(range(8))))
    o = mesh('spire', verts, faces, mat, recalc=True)
    m.add(o)
    # broaches: from each square corner up onto the diagonal face
    f = hb / (z_top - z0)
    for sx, sy, ia, ib in ((1, 1, 1, 2), (-1, 1, 3, 4), (-1, -1, 5, 6), (1, -1, 7, 0)):
        c = V((cx + sx * a, cy + sy * a, z0))
        pa, pb = V(verts[ia]), V(verts[ib])
        mid = (pa + pb) / 2
        top = mid + (V((cx, cy, z_top)) - mid) * f
        b = mesh('broach', [c, pa, pb, top], [(0, 3, 1), (0, 2, 3), (0, 1, 2)], mat)
        m.add(b)
    return o


# ==========================================================================
# v2: extra surfaces for the bake (registered at runtime, see brief v2 §1)

def _pmetal(hexcode, rough=0.55):
    """Painted cast iron / sheet steel in a given colour: orange peel, chips at
    the edges down to dark steel and rust (after surfaces.r_painted_metal)."""
    def r(S, key):
        g = S.g
        paint = S.tint(S.col(hexcode), S.n(2.0, 3), 0.85, 1.1)
        chip = g.smooth(g.add(g.mul(S.edge, 0.75), g.mul(S.n(14.0, 6, 0.7), 0.55)), 0.78, 0.82)
        rust = g.mix(S.n(30.0), S.col('#4a2412'), S.col('#7a3e1c'))
        under = g.mix(g.smooth(S.n(5.0), 0.45, 0.6), S.col('#2b2b2a'), rust)
        alb = g.mix(chip, paint, under)
        h = g.sub(g.add(0.6, g.mul(S.n(90.0, 2, 0.5), 0.08)), g.mul(chip, 0.12))
        return dict(albedo=alb, rough=g.mixf(chip, rough, 0.6), metal=g.mixf(chip, 0.05, 0.5),
                    height=h, bump=0.35, dist=0.01)
    return r


def _enamel(hexcode):
    """Vitreous enamel sign: glossy colour, black chips with rust halos."""
    def r(S, key):
        g = S.g
        col = S.tint(S.col(hexcode), S.n(3.0, 3), 0.92, 1.05)
        chip = g.smooth(g.add(g.mul(S.edge, 0.9), g.mul(S.n(11.0, 6, 0.7), 0.6)), 0.8, 0.83)
        halo = g.smooth(g.add(g.mul(S.edge, 0.9), g.mul(S.n(11.0, 6, 0.7), 0.6)), 0.72, 0.8)
        alb = g.mix(g.mul(halo, 0.6), col, S.col('#6a3a1c'))
        alb = g.mix(chip, alb, S.col('#1a1a1a'))
        return dict(albedo=alb, rough=g.mixf(chip, 0.18, 0.7), metal=0.0,
                    height=g.sub(0.6, g.mul(chip, 0.3)), bump=0.4, dist=0.004)
    return r


def _painted_board(hexcode):
    """Paint on a single board (geometry gives the planks): grain, flaking."""
    def r(S, key):
        g = S.g
        grain = S.n(1.0, 6, 0.65, vec=g.combine(g.mul(S.U, 36.0), g.mul(S.V, 2.2), 0.0), distortion=0.4)
        wood = g.mix(grain, S.col('#6e675c'), S.col('#948b7e'))
        paint = S.tint(S.col(hexcode), S.n(3.0), 0.78, 1.1)
        paint = S.tint(paint, grain, 0.92, 1.05)
        peel = g.smooth(g.add(g.mul(S.edge, 0.6), S.n(7.0, 5, 0.7)), 0.7, 0.74)
        alb = g.mix(peel, paint, wood)
        h = g.mixf(peel, g.add(0.75, g.mul(grain, 0.1)), g.add(0.6, g.mul(grain, 0.25)))
        return dict(albedo=alb, rough=g.mixf(peel, 0.6, 0.85), metal=0.0, height=h, bump=0.6, dist=0.015)
    return r


def _board(c0, c1):
    """A single board / beam: grain along V, checks (drying cracks), no gaps."""
    def r(S, key):
        g = S.g
        gv = g.combine(g.mul(S.U, 30.0), g.mul(S.V, 1.6), 0.0)
        grain = g.noise(g.vadd(gv, (S.seed * 0.3, 0.0, 0.0)), 1.0, detail=6, rough=0.65, distortion=0.5)
        rings = g.wave(gv, 0.5, kind='RINGS', distortion=3.0, detail=3)
        alb = g.mix(grain, S.col(c0), S.col(c1))
        alb = S.tint(alb, rings, 0.85, 1.08)
        chk = g.smooth(S.n(3.0, 3, 0.5, vec=gv, stretch=(1.0, 0.25, 1.0), kind='RIDGED_MULTIFRACTAL'), 0.9, 0.97)
        alb = g.mix(g.mul(chk, 0.8), alb, S.col('#120d09'))
        h = g.sub(g.add(0.7, g.mul(grain, 0.2)), g.mul(chk, 0.5))
        return dict(albedo=alb, rough=g.map_range(grain, 0, 1, 0.7, 0.9), metal=0.0, height=h, bump=0.8, dist=0.015)
    return r


def r_lead(S, key):
    g = S.g
    alb = S.tint(S.col('#6d7275'), S.n(2.5, 4, 0.6), 0.85, 1.15)
    pat = g.smooth(S.n(5.0, 5, 0.65), 0.6, 0.72)
    alb = g.mix(g.mul(pat, 0.6), alb, S.col('#a8aca6'))
    return dict(albedo=alb, rough=g.map_range(S.n(9.0), 0, 1, 0.5, 0.75), metal=0.35,
                height=S.n(12.0, 4, 0.6), bump=0.4, dist=0.01)


def r_curtain(S, key):
    """Cotton / lace curtain lit from the room behind it (glows warm)."""
    g = S.g
    folds = g.add(0.6, g.mul(g.sin(g.mul(S.U, 26.0)), 0.25))
    lace = g.smooth(g.voronoi(g.vscale(S.UV, (40.0, 40.0, 1.0)), 1.0, rand=0.3), 0.3, 0.1)
    k = g.add(g.mul(folds, 0.85), g.mul(lace, 0.15))
    light = g.mix(1.0, S.col('#ffb060'), g.combine(k, k, k), blend='MULTIPLY')
    glow = g.mix(1.0, light, g.combine(1.7, 1.5, 1.3), blend='MULTIPLY')
    return dict(albedo=S.col('#d8c8a6'), rough=0.9, metal=0.0, height=folds, bump=0.2, dist=0.01, glow=glow)


def r_daub(S, key):
    """Cob / wattle-and-daub infill: ochre earth with straw, cracks, a few
    patches fallen off to the laths."""
    g = S.g
    alb = S.tint(S.col('#a48b62'), S.n(1.5, 4, 0.6), 0.82, 1.12)
    straw = g.smooth(S.n(60.0, 3, 0.6, stretch=(1.0, 1.0, 8.0)), 0.68, 0.74)
    alb = g.mix(g.mul(straw, 0.5), alb, S.col('#c2a86a'))
    crk = g.mul(g.smooth(g.voronoi_edge(S.P, 3.0, rand=1.0), 0.01, 0.0), g.smooth(S.n(2.0), 0.5, 0.65))
    alb = g.mix(g.mul(crk, 0.8), alb, S.col('#3e3224'))
    lath = g.smooth(S.n(1.8, 5, 0.6), 0.71, 0.74)
    laths = g.wave(S.P, 9.0, kind='BANDS', direction='Z', detail=1)
    alb = g.mix(lath, alb, g.mix(laths, S.col('#2a1f16'), S.col('#5a4630')))
    h = g.sub(g.add(0.7, g.mul(S.n(18.0, 4, 0.6), 0.15)), g.add(g.mul(crk, 0.3), g.mul(lath, 0.5)))
    return dict(albedo=alb, rough=0.93, metal=0.0, height=h, bump=0.8, dist=0.025)


def r_poster(S, key):
    """Layers of old bill posters: faded colour blocks, torn edges, glue
    stains, print bands (no text)."""
    g = S.g
    cell = g.voronoi(g.vscale(S.UV, (1.3, 1.0, 1.0)), 1.6, out='Color', rand=0.9, dims='2D')
    r_, gg, b_ = g.sep(cell)
    c = g.mix(r_, S.col('#c9bea2'), S.col('#b0574a'))
    c = g.mix(g.smooth(gg, 0.55, 0.6), c, S.col('#58708a'))
    c = g.mix(g.smooth(b_, 0.7, 0.75), c, S.col('#d2b25a'))
    bands = g.mul(g.smooth(g.wave(S.UV, 14.0, kind='BANDS', direction='Y', detail=0), 0.75, 0.9),
                  g.smooth(S.n(1.2), 0.45, 0.6))
    c = g.mix(g.mul(bands, 0.6), c, S.col('#2e2a26'))
    tear = g.smooth(g.add(S.n(4.0, 6, 0.7), g.mul(S.edge, 0.3)), 0.68, 0.7)
    alb = g.mix(tear, S.tint(c, S.n(2.0), 0.75, 1.05), S.col('#8f8676'))
    alb = g.mix(g.mul(g.smooth(S.n(2.5, 3, 0.5, stretch=(6, 6, 0.3)), 0.55, 0.75), 0.5), alb, S.col('#4e4636'))
    h = g.add(0.6, g.mul(tear, -0.15))
    return dict(albedo=alb, rough=0.88, metal=0.0, height=g.add(h, g.mul(S.n(30.0), 0.1)), bump=0.4, dist=0.01)


def r_bronze(S, key):
    g = S.g
    alb = S.tint(S.col('#5a4526'), S.n(6.0), 0.8, 1.15)
    pat = g.smooth(g.add(g.mul(g.one_minus(S.ao), 0.6), S.n(4.0, 5, 0.6)), 0.55, 0.7)
    alb = g.mix(pat, alb, S.col('#4f7a68'))
    return dict(albedo=alb, rough=g.mixf(pat, 0.45, 0.8), metal=g.mixf(pat, 0.85, 0.1),
                height=S.n(20.0), bump=0.3, dist=0.01)


def r_water(S, key):
    g = S.g
    alb = S.tint(S.col('#10181a'), S.n(2.0), 0.8, 1.2)
    scum = g.smooth(S.n(3.0, 5, 0.6), 0.66, 0.74)
    alb = g.mix(g.mul(scum, 0.7), alb, S.col('#3a3c22'))
    return dict(albedo=alb, rough=g.mixf(scum, 0.04, 0.6), metal=0.0, height=S.n(8.0, 3, 0.5), bump=0.15, dist=0.01)


def r_soot(base_key, dark=False):
    """Stone / plaster blackened by fire: soot plumes rising from openings,
    heavier higher up, charred patches."""
    import surfaces as SF

    def r(S, key):
        g = S.g
        ch = SF.RECIPES[base_key](S, base_key)
        soot = g.smooth(g.add(g.mul(S.n(1.2, 5, 0.6, stretch=(1.6, 1.6, 0.5)), 0.8), g.mul(S.Z, 0.08)), 0.45, 0.8)
        soot = g.maximum(soot, 0.35 if dark else 0.15)
        c = g.mix(S.n(8.0), S.col('#151311'), S.col('#2c2824'))
        ch['albedo'] = g.mix(soot, ch['albedo'], c)
        ch['rough'] = g.mixf(soot, ch['rough'], 0.95)
        return ch
    return r


def r_hay_straw(S, key):
    g = S.g
    fib = S.n(40.0, 5, 0.7, stretch=(1.0, 1.0, 0.15))
    alb = g.mix(fib, S.col('#7e6a3e'), S.col('#b8a066'))
    alb = g.mix(g.smooth(S.n(2.0), 0.6, 0.8), alb, S.col('#4a4128'))
    return dict(albedo=alb, rough=0.95, metal=0.0, height=fib, bump=1.0, dist=0.02)


def r_leaded(S, key):
    """Dark church glass in diamond quarries held by lead cames."""
    g = S.g
    k = 1 / 0.13
    a = g.fract(g.mul(g.add(S.U, g.mul(S.V, 0.6)), k))
    b = g.fract(g.mul(g.sub(S.U, g.mul(S.V, 0.6)), k))
    came = g.maximum(g.smooth(g.minimum(a, g.one_minus(a)), 0.05, 0.0), g.smooth(g.minimum(b, g.one_minus(b)), 0.05, 0.0))
    tint = g.mix(S.n(6.0), S.col('#1a2226'), S.col('#2a2a1e'))
    alb = g.mix(came, tint, S.col('#3e4244'))
    return dict(albedo=alb, rough=g.mixf(came, 0.08, 0.6), metal=g.mixf(came, 0.0, 0.3),
                height=g.one_minus(came), bump=0.4, dist=0.004)


EXTRA_SURFACES = {
    'glass_leaded':  ('#1a2226', 0.1, 0.0, r_leaded, 'none'),
    # key: (hex, rough, metal, recipe, weathering profile)
    'lead':          ('#6d7275', 0.6, 0.35, r_lead, 'metal'),
    'curtain':       ('#d8c8a6', 0.9, 0.0, r_curtain, 'none'),
    'daub':          ('#a48b62', 0.93, 0.0, r_daub, 'building'),
    'oak_beam':      ('#3b2c20', 0.85, 0.0, _board('#2a1f17', '#55432f'), 'prop'),
    'board':         ('#6b5039', 0.85, 0.0, _board('#4e3a28', '#7c6044'), 'prop'),
    'board_old':     ('#7a7468', 0.9, 0.0, _board('#6a645a', '#9a9284'), 'prop'),
    'board_dark':    ('#3a2b20', 0.85, 0.0, _board('#261c14', '#45342a'), 'prop'),
    'shutter_green': ('#3d5240', 0.6, 0.0, _painted_board('#3b5140'), 'prop'),
    'shutter_blue':  ('#4a5d6e', 0.6, 0.0, _painted_board('#4a5f72'), 'prop'),
    'shutter_red':   ('#6e2a22', 0.6, 0.0, _painted_board('#6a2820'), 'prop'),
    'shutter_grey':  ('#8a8a80', 0.6, 0.0, _painted_board('#8c8b80'), 'prop'),
    'door_green':    ('#2f4234', 0.6, 0.0, _painted_board('#2e4234'), 'prop'),
    'door_red':      ('#5a1e1a', 0.6, 0.0, _painted_board('#5c201a'), 'prop'),
    'iron_green':    ('#26392d', 0.55, 0.2, _pmetal('#26392d'), 'metal'),
    'iron_black':    ('#1c1c1c', 0.5, 0.2, _pmetal('#1d1d1d', 0.45), 'metal'),
    'enamel_blue':   ('#24407a', 0.2, 0.0, _enamel('#1f3d7a'), 'metal'),
    'enamel_white':  ('#e6e2d6', 0.2, 0.0, _enamel('#e2ded2'), 'metal'),
    'enamel_red':    ('#9a2a20', 0.2, 0.0, _enamel('#9a2a20'), 'metal'),
    'poster':        ('#c9bea2', 0.88, 0.0, r_poster, 'building'),
    'bronze':        ('#5a4526', 0.5, 0.8, r_bronze, 'metal'),
    'water':         ('#10181a', 0.05, 0.0, r_water, 'none'),
    'stone_soot':    ('#3a3632', 0.9, 0.0, r_soot('stone'), 'building'),
    'plaster_soot':  ('#3e3a34', 0.9, 0.0, r_soot('plaster_dirty'), 'building'),
    'straw':         ('#a08a50', 0.95, 0.0, r_hay_straw, 'prop'),
}


def register_surfaces():
    """Add the village's extra keys to kit.PALETTE and surfaces (runtime only)."""
    import surfaces
    for k, (hexcode, rough, metal, fn, prof) in EXTRA_SURFACES.items():
        kit.PALETTE[k] = (hexcode, rough, metal)
        surfaces.RECIPES[k] = fn
        surfaces.PROFILE[k] = prof


# --------------------------------------------------------------------------
# v2: UV orientation fixes before the bake (recipes read the 'UVMap')

ROOF_KEYS = ('roof_tile', 'roof_slate', 'thatch')
GRAIN_KEYS = ('oak_beam', 'board', 'board_old', 'board_dark', 'shutter_green', 'shutter_blue',
              'shutter_red', 'shutter_grey', 'door_green', 'door_red')


def orient_uvs(obj, seed=0):
    """Roof faces: U across the slope, V up the slope (tile/slate courses run
    level on every slope, hips and turned roofs included). Board/beam faces:
    V along the face's longest edge (grain follows the timber)."""
    me = obj.data
    lay = me.uv_layers.get('UVMap')
    if lay is None:
        return obj
    names = [m.name.split('.')[0] if m else '' for m in me.materials]
    rnd = random.Random(seed)
    for p in me.polygons:
        key = names[p.material_index] if p.material_index < len(names) else ''
        n = p.normal
        if (key in ROOF_KEYS or key in ROOF_KEYS_V3) and n.z > 0.15:
            h = V((0, 0, 1)).cross(n)
            if h.length < 1e-6:
                continue
            h.normalize()
            up = n.cross(h).normalized()
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                lay.data[li].uv = (co.dot(h), co.dot(up))
        elif key in GRAIN_KEYS:
            vs = [me.vertices[i].co for i in p.vertices]
            best, axis = -1.0, None
            for i in range(len(vs)):
                e = vs[(i + 1) % len(vs)] - vs[i]
                if e.length > best:
                    best, axis = e.length, e
            if axis is None or best < 1e-6:
                continue
            ax = axis.normalized()
            side = n.cross(ax)
            if side.length < 1e-6:
                continue
            side.normalize()
            o = rnd.uniform(0, 10)
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                lay.data[li].uv = (co.dot(side) + o, co.dot(ax))
    return obj


# --------------------------------------------------------------------------
# v2: facade furniture and damage

def pocks(F, cx, cz, n, spread, seed=1, mat='stone', size=0.045):
    """Bullet strikes: small cones to cut into a wall (a burst around cx, cz).
    Returns cutter objects (their faces take `mat` with the transfer cut)."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        x = cx + rnd.gauss(0, spread)
        z = cz + rnd.gauss(0, spread * 0.6)
        r = size * rnd.uniform(0.6, 1.4)
        c = kit.cyl(r, r * 1.6, loc=(x, -0.004, z), rot=(-90, 0, rnd.uniform(0, 60)), mat=mat, verts=5,
                    radius2=r * 0.15, name='pock')
        c.matrix_basis = F @ Matrix.Translation((0, r * 0.55, 0)) @ c.matrix_basis
        out.append(c)
    return out


def chips(F, x, z0, z1, seed=1, mat='stone', n=3):
    """Chipped-off corner pieces along a vertical building edge at local x
    (cutters: irregular wedges)."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        z = rnd.uniform(z0, z1)
        s_ = rnd.uniform(0.08, 0.18)
        c = kit.box((s_, s_, s_ * rnd.uniform(1.5, 3.0)), loc=(x, 0.0, z), rot=(rnd.uniform(-10, 10), rnd.uniform(-10, 10), 45 + rnd.uniform(-15, 15)),
                    mat=mat, name='chip')
        c.matrix_basis = F @ c.matrix_basis
        out.append(c)
    return out


def tie_plate(m, F, x, z, kind='X', seed=1):
    """Iron wall anchor (tie-rod end plate) on a facade."""
    rnd = random.Random(seed)
    loc = []
    if kind == 'X':
        for a in (45, -45):
            loc.append(kit.box((0.6, 0.025, 0.04), loc=(0, -0.012, 0), rot=(0, a + rnd.uniform(-4, 4), 0), mat='iron', name='tie'))
    elif kind == 'S':
        pts = [(math.sin(t_ * math.pi * 2) * 0.12, -0.012, (t_ - 0.5) * 0.7) for t_ in (0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0)]
        loc.append(sweep(pts, [(0.018, 0.012), (-0.018, 0.012), (-0.018, -0.012), (0.018, -0.012)], 'iron', 'tie', up=(0, 1, 0)))
    else:
        loc.append(kit.box((0.04, 0.025, 0.7), loc=(0, -0.012, 0), mat='iron', name='tie'))
    loc.append(kit.cyl(0.035, 0.05, loc=(0, -0.03, 0), rot=(90, 0, 0), mat='iron', verts=6, name='tienut'))
    xform(loc, F @ Matrix.Translation((x, 0, z)))
    m.add(*loc)


def enamel_sign(m, F, x, z, w=0.6, h=0.4, colour='enamel_blue', seed=1):
    """A rectangular enamel advertising plate (no text): white rim, coloured
    field, screws, slightly askew."""
    rnd = random.Random(seed)
    loc = [kit.box((w, 0.012, h), loc=(0, -0.008, 0), mat='enamel_white', name='plate'),
           kit.box((w - 0.08, 0.006, h - 0.08), loc=(0, -0.016, 0), mat=colour, name='field'),
           kit.box((w * 0.6, 0.004, h * 0.16), loc=(0, -0.02, h * 0.15), mat='enamel_white', name='band')]
    for sx in (-1, 1):
        for sz in (-1, 1):
            loc.append(kit.box((0.018, 0.01, 0.018), loc=(sx * (w / 2 - 0.022), -0.017, sz * (h / 2 - 0.022)), mat='iron', name='screw'))
    xform(loc, F @ Matrix.Translation((x, 0, z)) @ Matrix.Rotation(math.radians(rnd.uniform(-2.5, 2.5)), 4, 'Y'))
    m.add(*loc)


def flower_box(m, F, x, z, w, seed=1):
    """Window box on iron brackets with leafy geraniums."""
    rnd = random.Random(seed)
    loc = [kit.box((w, 0.2, 0.17), loc=(0, -0.22, z - 0.085), mat='board_old', name='fbox'),
           kit.box((w - 0.04, 0.16, 0.02), loc=(0, -0.22, z - 0.015), mat='dirt', name='soil')]
    for sx in (-1, 1):
        loc.append(kit.box((0.025, 0.25, 0.025), loc=(sx * (w / 2 - 0.08), -0.13, z - 0.19), rot=(-30, 0, 0), mat='iron', name='fbracket'))
    k = max(3, int(w / 0.22))
    for i in range(k):
        xx = -w / 2 + w * (i + 0.5) / k + rnd.uniform(-0.04, 0.04)
        loc.append(kit.sphere(rnd.uniform(0.09, 0.13), loc=(xx, -0.22 + rnd.uniform(-0.03, 0.03), z + 0.06), mat='leaves', subdiv=1,
                              scale=(1.2, 1.0, 0.8), name='plant'))
        if rnd.random() < 0.7:
            loc.append(kit.sphere(0.04, loc=(xx + rnd.uniform(-0.05, 0.05), -0.25, z + 0.15), mat='paint_red', subdiv=0, name='bloom'))
    xform(loc, F @ Matrix.Translation((x, 0, 0)))
    m.add(*loc)


def wall_lantern(F, x, z, lit=True, arm=0.42):
    """A wall lantern on a scrolled iron bracket (wall frame F, lantern hanging
    `arm` metres out). Returns (objects, lantern centre in world)."""
    loc = []
    loc.append(kit.box((0.12, 0.03, 0.22), loc=(0, -0.015, 0.0), mat='iron_black', name='wallplate'))
    pts = [(0, -0.03, 0.05), (0, -arm * 0.5, 0.1), (0, -arm, 0.08)]
    loc.append(sweep(pts, [(0.012, 0.012), (-0.012, 0.012), (-0.012, -0.012), (0.012, -0.012)], 'iron_black', 'arm', up=(1, 0, 0)))
    pts = [(0, -0.03, -0.08), (0, -arm * 0.45, -0.02), (0, -arm * 0.75, 0.06)]
    loc.append(sweep(pts, circle_profile(0.008, 4), 'iron_black', 'stay', up=(1, 0, 0)))
    loc.append(kit.cyl(0.07, 0.02, loc=(0, -arm, 0.06), rot=(90, 0, 0), mat='iron_black', verts=8, name='scroll', cap=False))
    cx, cz = -arm, -0.12
    loc.append(kit.cyl(0.006, 0.12, loc=(0, cx, 0.03), mat='iron_black', verts=4, name='hook'))
    body = kit.lathe([(0.075, cz - 0.15), (0.11, cz + 0.12)], segments=4, mat='window_lit' if lit else 'glass', name='lantglass')
    body.rotation_euler = (0, 0, math.radians(45))
    body.location = (0, cx, 0)
    loc.append(body)
    cap = kit.lathe([(0.15, cz + 0.12), (0.15, cz + 0.14), (0.04, cz + 0.24), (0.0, cz + 0.27)], segments=4, mat='iron_black', name='lantcap')
    cap.rotation_euler = (0, 0, math.radians(45))
    cap.location = (0, cx, 0)
    loc.append(cap)
    bot = kit.lathe([(0.09, cz - 0.17), (0.09, cz - 0.15), (0.0, cz - 0.15)], segments=4, mat='iron_black', name='lantbot')
    bot.rotation_euler = (0, 0, math.radians(45))
    bot.location = (0, cx, 0)
    loc.append(bot)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        p0 = V((math.cos(a) * 0.078, cx + math.sin(a) * 0.078, cz - 0.15))
        p1 = V((math.cos(a) * 0.113, cx + math.sin(a) * 0.113, cz + 0.12))
        loc.append(sweep([p0, p1], [(0.01, 0.01), (-0.01, 0.01), (-0.01, -0.01), (0.01, -0.01)], 'iron_black', 'lantbar', up=(1, 0, 0)))
    M = F @ Matrix.Translation((x, 0, z))
    xform(loc, M)
    return loc, M @ V((0, cx, cz))


def chamfer_quoin(lo, hi, sx, sy, c, mat):
    """A corner block whose outer vertical edge is chipped off by c."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    xo = x1 if sx > 0 else x0
    yo = y1 if sy > 0 else y0
    xi = x0 if sx > 0 else x1
    yi = y0 if sy > 0 else y1
    pts = [(xi, yi), (xo, yi), (xo, yo - sy * c), (xo - sx * c, yo), (xi, yo)]
    # counter-clockwise for extrude_xy
    area = sum(pts[i][0] * pts[(i + 1) % 5][1] - pts[(i + 1) % 5][0] * pts[i][1] for i in range(5))
    if area < 0:
        pts.reverse()
    return kit.extrude_xy(pts, z1 - z0, mat=mat, name='quoin', z0=z0)


def quoins(m, x, y, sx, sy, z0, z1, mat='stone', seed=1, p=0.03, hmin=0.34, hmax=0.42,
           long=0.55, short=0.3, chip=0.25):
    """Dressed corner stones on the corner (x, y); (sx, sy) = outward signs.
    Irregular sizes, protrusions, a few with the arris chipped off."""
    rnd = random.Random(seed)
    z = z0
    k = 0
    while z < z1 - 0.12:
        h = min(rnd.uniform(hmin, hmax), z1 - z)
        a, b = (long, short) if k % 2 == 0 else (short, long)
        a += rnd.uniform(-0.07, 0.07)
        b += rnd.uniform(-0.07, 0.07)
        pp = p + rnd.uniform(-0.012, 0.014)
        x0, x1 = sorted((x + sx * pp, x - sx * a))
        y0, y1 = sorted((y + sy * pp, y - sy * b))
        hi = (x1, y1, z + h - 0.014)
        if rnd.random() < chip:
            m.add(chamfer_quoin((x0, y0, z), hi, sx, sy, rnd.uniform(0.04, 0.11), mat))
        else:
            m.add(open_box((x0, y0, z), hi, mat, 'quoin', bottom=z > 0.02))
        z += h
        k += 1


# --------------------------------------------------------------------------
# v2: ivy (alpha cards with a procedurally painted atlas)

def ivy_material():
    """The 'ivy' card material: a 512 px RGBA atlas of four leafy sprays
    painted with numpy, alpha clipped (exports as alphaMode MASK)."""
    mat = bpy.data.materials.get('ivy')
    if mat:
        return mat
    import numpy as np
    S = 512
    img = np.zeros((S, S, 4), np.float32)
    rnd = random.Random(77)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)

    def stem(pts, w, col):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
            for k in range(n):
                t = k / max(n - 1, 1)
                cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                r = int(w) + 1
                xs, ys = int(cx), int(cy)
                sl = (slice(max(0, ys - r), min(S, ys + r + 1)), slice(max(0, xs - r), min(S, xs + r + 1)))
                d = np.hypot(xx[sl] - cx, yy[sl] - cy) < w
                img[sl][d] = col

    def leaf(cx, cy, s, a, base):
        r = int(s * 1.3) + 2
        x0, x1 = max(0, int(cx) - r), min(S, int(cx) + r)
        y0, y1 = max(0, int(cy) - r), min(S, int(cy) + r)
        if x1 <= x0 or y1 <= y0:
            return
        dx, dy = xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy
        rr = np.hypot(dx, dy)
        th = np.arctan2(dy, dx) - a
        lobe = 0.6 + 0.4 * np.abs(np.cos(2.5 * th)) ** 1.6
        notch = 1.0 - 0.35 * np.exp(-((np.mod(th, 2 * np.pi) - np.pi) ** 2) / 0.08)
        R = s * lobe * notch
        inside = rr < R
        vein = np.exp(-((rr * np.sin(2.5 * th)) ** 2) / (2 * 1.2 ** 2)) * (rr < R * 0.85)
        shade = 0.75 + 0.35 * (-(dx * 0.6 + dy * 0.8) / (s + 1e-6)).clip(-1, 1) * 0.5
        edge = (rr / (R + 1e-6)) ** 3
        c = np.array(base, np.float32)
        col = c[None, None, :] * (shade * (1 - 0.35 * edge))[..., None]
        col = col + vein[..., None] * np.array((0.10, 0.12, 0.06), np.float32)
        reg = img[y0:y1, x0:x1]
        reg[inside, :3] = col[inside]
        reg[inside, 3] = 1.0

    for cell in range(4):
        ox, oy = (cell % 2) * 256, (cell // 2) * 256
        for br in range(3):
            pts = []
            x, y = ox + rnd.uniform(60, 196), oy + 250
            ang = -math.pi / 2 + rnd.uniform(-0.5, 0.5)
            for k in range(9):
                pts.append((x, y))
                ang += rnd.uniform(-0.45, 0.45)
                x += math.cos(ang) * 30
                y += math.sin(ang) * 30
                x = min(max(x, ox + 15), ox + 241)
                y = min(max(y, oy + 10), oy + 250)
            stem(pts, 1.6, (0.16, 0.11, 0.07, 1.0))
            for (px, py) in pts[1:]:
                for j in range(2):
                    g = rnd.uniform(0.0, 1.0)
                    base = (0.13 + 0.12 * g, 0.24 + 0.14 * g, 0.07 + 0.06 * g)
                    leaf(px + rnd.uniform(-16, 16), py + rnd.uniform(-16, 16), rnd.uniform(13, 22),
                         rnd.uniform(0, 2 * math.pi), base)
    image = bpy.data.images.new('ivy_atlas', S, S, alpha=True)
    image.pixels.foreach_set(np.ascontiguousarray(img[::-1]).ravel())
    image.update()
    image.pack()
    mat = bpy.data.materials.new('ivy')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], gt.inputs[0])
    nt.links.new(gt.outputs[0], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.6
    try:
        mat.blend_method = 'CLIP'
    except (AttributeError, TypeError):
        pass
    return mat


def ivy_cards(F, x0, x1, z0, z1, n, seed=1, depth=0.16, size=(0.45, 0.8), fall=0.0):
    """n ivy cards over a wall area (wall frame F, faces -Y), each a quad
    mapping one atlas cell (UVs in the 'ivyuv' layer), a little off the wall
    and tilted out at the top. fall > 0 lets some hang over an edge."""
    rnd = random.Random(seed)
    verts, faces, uvs = [], [], []
    for i in range(n):
        s_ = rnd.uniform(*size)
        cx = rnd.uniform(x0 + s_ * 0.3, x1 - s_ * 0.3)
        cz = rnd.uniform(z0 + s_ * 0.4, z1 - s_ * 0.3)
        yb = -rnd.uniform(0.02, depth * 0.4)
        yt = yb - rnd.uniform(0.03, depth)
        rot = rnd.uniform(-0.5, 0.5)
        c_, s2 = math.cos(rot), math.sin(rot)
        q = []
        for (u, v) in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
            px = cx + (u * c_ - v * s2) * s_
            pz = cz + (u * s2 + v * c_) * s_
            py = yb + (yt - yb) * (v + 0.5)
            q.append((px, py, pz))
        base = len(verts)
        verts += q
        faces.append((base, base + 1, base + 2, base + 3))
        cell = rnd.randrange(4)
        ox, oy = (cell % 2) * 0.5, 1 - (cell // 2 + 1) * 0.5
        fl = rnd.random() < 0.5
        cu = [(0, 0), (1, 0), (1, 1), (0, 1)]
        if fl:
            cu = [(1, 0), (0, 0), (0, 1), (1, 1)]
        uvs += [(ox + 0.01 + u * 0.48, oy + 0.01 + v * 0.48) for u, v in cu]
    me = bpy.data.meshes.new('ivy')
    me.from_pydata(verts, [], faces)
    me.update()
    lay = me.uv_layers.new(name='ivyuv')
    for li, loop in enumerate(me.loops):
        lay.data[li].uv = uvs[loop.vertex_index]
    me.uv_layers.new(name='UVMap')
    me.materials.append(ivy_material())
    o = kit.link(bpy.data.objects.new('ivy', me))
    xform([o], F)
    return o


# --------------------------------------------------------------------------
# v2: hipped roof and dormers

def hip_roof(m, a, b, z_e, rise, oe=0.35, t=0.15, mat='roof_slate', ridge_mat='lead', x0=0.0, y0=0.0,
             gutter=True, downpipes=()):
    """Hipped roof over a 2a x 2b block (a >= b, ridge along X), eaves
    overhanging `oe`, a boxed soffit underneath; lead hip and ridge rolls,
    a gutter all round on brackets, downpipes at the given (x, y) corners.
    Returns the slope (rise / b)."""
    sl = rise / b
    cos_a = math.cos(math.atan(sl))
    tv = t / cos_a
    A, Bh = a + oe, b + oe
    zt_e = z_e + tv - oe * sl
    zr = z_e + tv + rise
    r = a - b
    zb = zt_e - t
    v = [(-A, -Bh, zt_e), (A, -Bh, zt_e), (A, Bh, zt_e), (-A, Bh, zt_e), (-r, 0, zr), (r, 0, zr),
         (-A, -Bh, zb), (A, -Bh, zb), (A, Bh, zb), (-A, Bh, zb)]
    v = [(x + x0, y + y0, z) for x, y, z in v]
    f = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4), (6, 7, 1, 0), (7, 8, 2, 1), (8, 9, 3, 2), (9, 6, 0, 3), (9, 8, 7, 6)]
    m.add(mesh('hiproof', v, f, mat, recalc=True))
    prof = [(0.07 * math.cos(q), 0.07 * math.sin(q)) for q in (math.pi * k / 4 for k in range(5))] + [(-0.07, -0.03), (0.07, -0.03)]
    for i0, i1 in ((0, 4), (3, 4), (1, 5), (2, 5), (4, 5)):
        p0, p1 = V(v[i0]), V(v[i1])
        pts = [p0 + (p1 - p0) * k / 4 for k in range(5)]
        m.add(sweep(pts, prof, ridge_mat, 'hiproll', up=(0, 0, 1) if i0 != 4 else (0, 0, 1)))
    if gutter:
        ge = 0.05
        loop = [(-A - ge, -Bh - ge), (A + ge, -Bh - ge), (A + ge, Bh + ge), (-A - ge, Bh + ge)]
        pts = []
        for (xa, ya), (xb, yb) in zip(loop, loop[1:] + loop[:1]):
            for k in range(3):
                pts.append((x0 + xa + (xb - xa) * k / 3, y0 + ya + (yb - ya) * k / 3, zt_e - 0.05))
        gp = [(0.07, 0.03), (0.0, -0.06), (-0.07, 0.03), (-0.05, 0.03), (0.0, -0.035), (0.05, 0.03)]
        m.add(sweep(pts, gp, 'iron', 'gutter', loop=True))
        for (xa, ya), (xb, yb) in zip(loop, loop[1:] + loop[:1]):
            ln = math.hypot(xb - xa, yb - ya)
            nb = int(ln / 1.2)
            for k in range(1, nb):
                px, py = xa + (xb - xa) * k / nb, ya + (yb - ya) * k / nb
                yaw = math.degrees(math.atan2(yb - ya, xb - xa))
                m.add(kit.box((0.025, 0.2, 0.012), loc=(x0 + px * 0.985, y0 + py * 0.985, zt_e - 0.09), rot=(0, 0, yaw), mat='iron', name='gbracket'))
    for (xd, yd) in downpipes:
        sx, sy = (1 if xd > 0 else -1), (1 if yd > 0 else -1)
        px = x0 + xd
        yg = y0 + sy * (Bh + 0.05)
        yw = y0 + sy * (b + 0.07)
        pts = [(px, yg, zt_e - 0.08), (px, yg, zt_e - 0.2), (px, yw, zt_e - 0.5), (px, yw, 0.35), (px, yw, 0.2), (px, yw + sy * 0.12, 0.06)]
        m.add(sweep(pts, circle_profile(0.045, 6), 'iron', 'downpipe', up=(1, 0, 0)))
        zc = 0.9
        while zc < zt_e - 0.8:
            m.add(kit.box((0.12, 0.1, 0.035), (px, yw - sy * 0.01, zc), mat='iron', name='clip'))
            zc += 1.6
    return sl


def dormer(m, M, w, z_sill, roof_z, depth, wall_mat='plaster', roof_mat='roof_slate', cheek_mat=None,
           window_kw=None, lit=False, lamp=None):
    """A gabled dormer whose front face is the wall frame M (front at local
    y = 0, going back +Y into the roof). roof_z = height of the main roof
    surface at the front face. The window sits on z_sill."""
    hgt = z_sill + 1.15
    zb = roof_z - 0.25
    body = kit.box((w, depth, hgt - zb), loc=(0, depth / 2, (zb + hgt) / 2), mat=wall_mat, name='dormer')
    dcut = []
    kw = dict(depth=0.14, surround='wood', surround_mat='board_dark', b=0.07, bt=0.09, p=0.02, sill_mat='lead',
              bars=(1, 1), shutters=None, frame_mat='paint_white', reveal=wall_mat, lit=lit, lamp=lamp, stains=False)
    kw.update(window_kw or {})
    loc_parts_before = len(m.parts)
    window(m, Matrix.Identity(4), 0.0, z_sill, w - 0.55, 0.95, dcut, **kw)
    new = m.parts[loc_parts_before:]
    for c in dcut:
        cut(body, c)
    rf = kit.gable(w + 0.1, depth, 0.75, loc=(0, depth / 2 - 0.08, hgt), overhang=0.1, thickness=0.07, mat=roof_mat, name='droof')
    ridge = kit.cyl(0.05, depth + 0.2, loc=(0, depth / 2 - 0.08, hgt + 0.75 + 0.06), rot=(90, 0, 0), mat='lead', verts=6, name='droll')
    fas = kit.box((w + 0.22, 0.04, 0.12), loc=(0, -0.13, hgt - 0.03), mat='board_dark', name='dfascia')
    cheeks = []
    if cheek_mat:
        for sx in (-1, 1):
            cheeks.append(kit.box((0.03, depth, hgt - zb), loc=(sx * (w / 2 + 0.015), depth / 2, (zb + hgt) / 2), mat=cheek_mat, name='cheek'))
    objs = [body, rf, ridge, fas] + cheeks
    xform(objs, M)
    xform(new, M)
    m.add(*objs)
    if lit and lamp and lamp in m.anchors:
        p_, yaw = m.anchors[lamp]
        m.anchors[lamp] = (M @ p_, yaw)


# --------------------------------------------------------------------------
# v2: shop fronts and awnings

def shopfront(m, F, x0, x1, z_top, cutters, paint='shutter_red', windows=(), door_x=None, door_w=0.95,
              lit=True, lamps=(), goods='shop', depth=0.5, reveal='plaster', seed=1, anchor='door'):
    """A painted timber shop front applied to the wall in frame F between x0
    and x1, up to z_top: pilasters with capitals, a fascia with a moulded
    cornice and consoles, deep display windows (lit, with shelves of goods or
    café tables inside), panelled stall risers, a half-glazed door."""
    rnd = random.Random(seed)
    loc = []
    m.openings.setdefault(fkey(F), []).append((x0 - 0.3, x1 + 0.3, -1.0, z_top + 0.65))
    edges = sorted({x0, x1} | {wx - ww / 2 - 0.12 for wx, ww in windows} | {wx + ww / 2 + 0.12 for wx, ww in windows})
    piers = [x0, x1] + [wx - ww / 2 - 0.1 for wx, ww in windows] + [wx + ww / 2 + 0.1 for wx, ww in windows]
    if door_x is not None:
        piers += [door_x - door_w / 2 - 0.1, door_x + door_w / 2 + 0.1]
    piers = sorted(set(round(p_, 3) for p_ in piers))
    merged = []
    for p_ in piers:
        if merged and p_ - merged[-1] < 0.3:
            merged[-1] = (merged[-1] + p_) / 2
        else:
            merged.append(p_)
    for xx in merged:
        loc.append(kit.box((0.2, 0.1, z_top - 0.15), loc=(xx, -0.05, (z_top - 0.15) / 2), mat=paint, name='pilaster'))
        loc.append(kit.box((0.26, 0.15, 0.12), loc=(xx, -0.075, z_top - 0.2), mat=paint, name='capital'))
        loc.append(kit.box((0.25, 0.14, 0.25), loc=(xx, -0.07, 0.125), mat='stone', name='pbase'))
    loc.append(kit.box((x1 - x0 + 0.1, 0.12, 0.5), loc=((x0 + x1) / 2, -0.07, z_top + 0.1), mat=paint, name='fascia'))
    cor = [(0.0, 0.0), (-0.06, 0.0), (-0.1, 0.05), (-0.22, 0.08), (-0.22, 0.14), (0.0, 0.14)]
    c = kit.extrude_profile([(y, z) for y, z in cor], x1 - x0 + 0.34, 'X', mat=paint, name='cornice')
    c.location = ((x0 + x1) / 2, -0.12, z_top + 0.35)
    loc.append(c)
    for xx in (x0 - 0.05, x1 + 0.05):
        loc.append(kit.extrude_profile([(0.0, 0.0), (-0.2, 0.18), (-0.2, 0.55), (0.0, 0.55)], 0.12, 'X', mat=paint, name='console'))
        loc[-1].location = (xx, -0.08, z_top - 0.2)
    # display windows: deep recesses with a frame, bars, room light and goods
    for i, (wx, ww) in enumerate(windows):
        z0, z1 = 0.75, z_top - 0.2
        hw = ww / 2
        inner = [(-hw, z0), (hw, z0), (hw, z1), (-hw, z1)]
        cutters.append(xform([slab(inner, -0.3, depth + 0.3, reveal, 'cut')], F @ Matrix.Translation((wx, 0, 0)))[0])
        part = []
        fin = outline(hw - 0.07, z0 + 0.07, z1 - 0.07, 'rect')
        part.append(ring(inner, fin, 0.0, 0.09, paint, 'sframe', outer_side=False))
        nb = max(1, int(ww / 0.9))
        for k in range(1, nb + 1):
            xx = -hw + 0.07 + (ww - 0.14) * k / (nb + 1)
            part.append(kit.box((0.05, 0.06, z1 - z0 - 0.14), loc=(xx, 0.04, (z0 + z1) / 2), mat=paint, name='sbar'))
        part.append(kit.box((ww - 0.14, 0.06, 0.05), loc=(0, 0.04, z1 - 0.45), mat=paint, name='sbar'))
        part.append(drip_sill(ww + 0.1, -0.08, 0.2, z0, paint))
        part.append(poly([(px, depth - 0.01, pz) for px, pz in fin], 'window_lit' if lit else 'glass', 'shoproom'))
        if goods == 'shop':
            for zz in (z0 + 0.35, z0 + 0.95):
                part.append(kit.box((ww - 0.25, 0.3, 0.03), loc=(0, depth - 0.17, zz), mat='board_dark', name='shelf'))
                xx = -hw + 0.2
                while xx < hw - 0.2:
                    hh = rnd.uniform(0.12, 0.32)
                    part.append(kit.box((rnd.uniform(0.06, 0.14), 0.08, hh), loc=(xx, depth - 0.2, zz + 0.015 + hh / 2),
                                        mat=rnd.choice(('glass', 'board', 'paint_white', 'enamel_red')), name='goods'))
                    xx += rnd.uniform(0.1, 0.22)
        else:
            for k in range(2):
                xx = -hw * 0.5 + k * hw
                part.append(kit.cyl(0.3, 0.03, loc=(xx, depth - 0.25, z0 + 0.0), mat='board_dark', verts=10, name='ctable'))
                part.append(kit.cyl(0.03, 0.7, loc=(xx, depth - 0.25, z0 - 0.35), mat='iron_black', verts=5, name='cleg'))
        # panelled stall riser
        part.append(kit.box((ww + 0.04, 0.06, z0 - 0.25), loc=(0, -0.03, 0.25 + (z0 - 0.25) / 2), mat=paint, name='riser'))
        npn = max(2, int(ww / 0.6))
        for k in range(npn):
            xx = -hw + ww * (k + 0.5) / npn
            part.append(kit.box((ww / npn - 0.12, 0.03, z0 - 0.42), loc=(xx, -0.07, 0.25 + (z0 - 0.25) / 2), mat=paint, name='panel'))
        xform(part, Matrix.Translation((wx, 0, 0)))
        loc += part
        if lit and i < len(lamps):
            m.anchor(lamps[i], F @ V((wx, depth + 1.0, (z0 + z1) / 2)))
    xform(loc, F)
    m.add(*loc)
    if door_x is not None:
        door(m, F, door_x, door_w, z_top - 0.3, cutters, z0=0.14, surround=None, leaf_mat=paint, glazed=True, fanlight=True,
             anchor=anchor, step_mat='stone', reveal=reveal, studs_on=False, depth=0.3)


def awning(m, F, x0, x1, z, out=2.2, drop=0.75, mat='canvas', stripes=None, seed=1):
    """An extended canvas awning: a sloped sheet on iron arms with a scalloped
    valance; in frame F (wall at y = 0)."""
    rnd = random.Random(seed)
    loc = []
    w = x1 - x0
    nx = 10
    verts, faces = [], []
    for j, (yy, zz) in enumerate(((-0.05, z), (-out * 0.5, z - drop * 0.45 - 0.05), (-out, z - drop))):
        for i in range(nx + 1):
            xx = x0 + w * i / nx
            sag = 0.05 * math.sin(math.pi * i / nx * 4) ** 2 * (j > 0)
            verts.append((xx, yy, zz - sag + rnd.uniform(-0.01, 0.01) * j))
    for j in range(2):
        for i in range(nx):
            a_ = j * (nx + 1) + i
            faces.append((a_, a_ + 1, a_ + nx + 2, a_ + nx + 1))
    sheet = mesh('awning', verts, faces, mat)
    sol = sheet.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.012
    kit.apply_modifiers(sheet)
    loc.append(sheet)
    # scalloped valance hanging from the front edge
    nsc = int(w / 0.3)
    vv, ff = [], []
    for i in range(nsc * 4 + 1):
        xx = x0 + w * i / (nsc * 4)
        ph = (i % 4)
        dz = 0.28 if ph == 2 else (0.22 if ph in (1, 3) else 0.12)
        vv += [(xx, -out - 0.005, z - drop), (xx, -out - 0.005, z - drop - dz)]
    for i in range(nsc * 4):
        ff.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    val = mesh('valance', vv, ff, mat)
    sol = val.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.01
    kit.apply_modifiers(val)
    loc.append(val)
    for xx in (x0 + 0.05, x1 - 0.05):
        loc.append(sweep([(xx, -0.03, z - 0.05), (xx, -out, z - drop - 0.03)], circle_profile(0.018, 5), 'iron_black', 'arm', up=(1, 0, 0)))
        loc.append(sweep([(xx, -0.03, z - 0.75), (xx, -out * 0.55, z - drop * 0.55)], circle_profile(0.014, 4), 'iron_black', 'strut', up=(1, 0, 0)))
    loc.append(sweep([(x0, -out, z - drop - 0.02), (x1, -out, z - drop - 0.02)], circle_profile(0.02, 5), 'iron_black', 'frontbar'))
    loc.append(kit.box((w + 0.1, 0.12, 0.12), loc=((x0 + x1) / 2, -0.07, z + 0.02), mat='board_dark', name='awnbox'))
    xform(loc, F)
    m.add(*loc)


# --------------------------------------------------------------------------
# v2: timber framing, bistro furniture

def timber(m, F, x0, z0, x1, z1, w=0.17, proud=0.04, mat='oak_beam', name='timber'):
    """A timber member on a wall face (frame F, face at y = 0) from (x0, z0)
    to (x1, z1), w wide, standing `proud` out of the infill."""
    a = V((x0, 0, z0))
    b = V((x1, 0, z1))
    d = b - a
    ln = d.length
    if ln < 1e-4:
        return None
    o = open_box((-w / 2, -proud, 0.0), (w / 2, 0.02, ln), mat, name, bottom=True)
    ang = math.atan2(d.x, d.z)
    o.matrix_basis = F @ Matrix.Translation(a) @ Matrix.Rotation(ang, 4, 'Y')
    m.add(o)
    return o


def frame_panel(m, F, x0, x1, z0, z1, gaps=(), step=0.45, brace=None, seed=1, w=0.16, rails=(), zfun=None):
    """Close-studded timber frame over a wall area: sill and head beams,
    studs every ~step (skipping the x-ranges in `gaps`, e.g. windows),
    optional rails (z list) and braces ('X' St Andrew's crosses or '/').
    zfun(x) clips the stud tops (gables)."""
    rnd = random.Random(seed)
    top = (lambda x: z1) if zfun is None else zfun
    timber(m, F, x0, z0, x1, z0, w=0.2, name='sill')
    if zfun is None:
        timber(m, F, x0, z1 - 0.18, x1, z1 - 0.18, w=0.2, name='head')
    n = max(1, int(round((x1 - x0) / step)))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n + (rnd.uniform(-0.03, 0.03) if 0 < i < n else 0)
        if any(g0 - 0.05 < x < g1 + 0.05 for g0, g1 in gaps):
            continue
        zt = top(x) - (0.18 if zfun is None else 0.05)
        if zt - z0 > 0.25:
            timber(m, F, x, z0 + 0.1, x, zt, w=w * rnd.uniform(0.9, 1.1), name='stud')
    for zr in rails:
        segs = [(x0, x1)]
        for g0, g1 in gaps:
            nsegs = []
            for a_, b_ in segs:
                if g1 <= a_ or g0 >= b_:
                    nsegs.append((a_, b_))
                else:
                    if g0 > a_:
                        nsegs.append((a_, g0))
                    if g1 < b_:
                        nsegs.append((g1, b_))
            segs = nsegs
        for a_, b_ in segs:
            if b_ - a_ > 0.2:
                timber(m, F, a_, zr, b_, zr, w=0.14, name='rail')
    if brace:
        for (bx0, bx1, bz0, bz1) in brace:
            timber(m, F, bx0, bz0, bx1, bz1, w=0.15, name='brace')


def bistro_table(m, M, knocked=False, seed=1):
    """Café table: cast-iron pedestal and round top; knocked = on its side."""
    loc = [kit.lathe([(0.28, 0.0), (0.26, 0.03), (0.06, 0.08), (0.035, 0.12)], segments=8, mat='iron_green', name='tbase'),
           kit.cyl(0.03, 0.6, loc=(0, 0, 0.42), mat='iron_green', verts=6, name='tcol'),
           kit.cyl(0.33, 0.035, loc=(0, 0, 0.74), mat='enamel_white', verts=14, name='ttop'),
           kit.cyl(0.345, 0.02, loc=(0, 0, 0.715), mat='iron_green', verts=14, name='trim', cap=False)]
    if knocked:
        xform(loc, Matrix.Translation((0, 0, 0.345)) @ Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Translation((0, 0, -0.745 + 0.0)))
        xform(loc, Matrix.Translation((0, 0, 0.0)))
    xform(loc, M)
    m.add(*loc)


def bistro_chair(m, M, knocked=False, seed=1):
    """Bentwood-style café chair: iron legs, slatted wooden seat, hoop back."""
    loc = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            loc.append(sweep([(sx * 0.17, sy * 0.17, 0.0), (sx * 0.16, sy * 0.16, 0.45)], circle_profile(0.012, 4), 'iron_black', 'cleg', up=(1, 0, 0)))
    loc.append(kit.cyl(0.21, 0.03, loc=(0, 0, 0.46), mat='board', verts=10, name='seat'))
    back = [(math.cos(a) * 0.2, 0.16 + math.sin(a) * 0.03, 0.46 + math.sin(a) * 0.38) for a in (math.pi * k / 6 for k in range(7))]
    loc.append(sweep(back, circle_profile(0.013, 4), 'iron_black', 'back', up=(0, 1, 0)))
    loc.append(kit.box((0.34, 0.025, 0.08), loc=(0, 0.17, 0.72), mat='board', name='backrest'))
    if knocked:
        xform(loc, Matrix.Translation((0, 0.0, 0.2)) @ Matrix.Rotation(math.radians(-90), 4, 'X') @ Matrix.Translation((0, 0, -0.2)))
    xform(loc, M)
    m.add(*loc)


# ==========================================================================
# v3: masonry, render, glass, wear and weathering decals (runtime recipes)

def _pick(g, r, cols):
    """Pick one of several colours by a 0..1 random socket (near-step mixes)."""
    out = cols[0]
    n = len(cols)
    for i in range(1, n):
        t = i / n
        out = g.mix(g.smooth(r, t - 0.01, t + 0.01), out, cols[i])
    return out


def r_rubble(S, key, dark=False):
    """Norman rubble walling: rough courses of irregular stones in several
    tones (cream limestone, blue-grey, ochre, dark flint-grey, rusty),
    each stone domed and standing a little proud or sunk, dirty recessed
    lime mortar that has washed out in patches, lichen spots, green algae
    and splash dirt at the foot."""
    g = S.g
    cv = g.mul(S.V, 3.3)
    course = g.floor(g.add(cv, g.mul(S.uvn(0.5), 0.35)))
    csz = g.map_range(g.noise(g.combine(course, S.seed * 0.3, 0.0), 5.3, detail=0), 0.3, 0.7, 1.3, 2.9)
    uv = g.combine(g.mul(S.U, csz), cv, 0.0)
    uv = g.vadd(uv, g.vscale(g.combine(S.uvn(1.1), S.uvn(1.7), 0.0), (0.55, 0.28, 0.0)))
    uv = g.vadd(uv, g.vscale(g.combine(S.uvn(6.0), S.uvn(7.0), 0.0), (0.09, 0.07, 0.0)))
    ed = g.voronoi_edge(uv, 1.0, rand=0.9, dims='2D')
    cid = g.voronoi(uv, 1.0, out='Color', rand=0.9, dims='2D')
    r1, r2, r3 = g.sep(cid)
    if dark:
        cols = [S.col(c) for c in ('#76726a', '#626366', '#746a5c', '#4c4a46', '#6a5e52')]
    else:
        cols = [S.col(c) for c in ('#aca492', '#8e8f90', '#a29280', '#6e6b66', '#988572')]
    stone = _pick(g, r1, cols)
    stone = S.tint(stone, r2, 0.76, 1.16)
    stone = S.tint(stone, S.n(7.0, 6, 0.65), 0.82, 1.14)
    stone = S.tint(stone, S.n(30.0, 6, 0.7), 0.86, 1.1)
    stone = S.tint(stone, S.n(90.0, 3, 0.7), 0.92, 1.06)
    pits = g.smooth(g.voronoi(S.P, 55.0, rand=1.0), 0.07, 0.02)
    stone = g.mix(g.mul(pits, 0.5), stone, S.col('#3a3530'))
    lich = g.mul(g.smooth(g.voronoi(S.P, 6.0, rand=1.0), 0.16, 0.06), g.smooth(S.n(2.0, 3, 0.5), 0.5, 0.62))
    stone = g.mix(g.mul(lich, 0.65), stone, S.col('#bdbca0'))
    mw = g.add(0.065, g.mul(S.n(3.0), 0.04))
    mortar = g.smooth(ed, mw, g.mul(mw, 0.35))
    loss = g.smooth(S.n(1.4, 5, 0.6), 0.56, 0.64)
    mc = S.col('#7d776a') if dark else S.col('#9a9283')
    mcol = g.mix(loss, S.tint(mc, S.n(25.0), 0.75, 1.1), S.col('#2a2520'))
    alb = g.mix(mortar, stone, mcol)
    algae = g.mul(g.smooth(S.Z, 0.9, 0.05), g.smooth(S.n(2.5, 5, 0.6), 0.35, 0.6))
    alb = g.mix(g.mul(algae, 0.55), alb, g.mix(S.n(20.0), S.col('#2f3a22'), S.col('#4d5a33')))
    dome = g.smooth(ed, 0.0, 0.18)
    h_st = g.add(g.add(g.mul(dome, 0.35), g.mul(r3, 0.22)), g.add(0.35, g.add(g.mul(S.n(16.0, 5, 0.65), 0.14), g.mul(S.n(60.0, 3, 0.7), 0.06))))
    h_m = g.mixf(loss, 0.3, 0.05)
    h = g.mixf(mortar, h_st, h_m)
    rough = g.mixf(mortar, g.map_range(S.n(18.0), 0, 1, 0.72, 0.92), 0.96)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=1.1, dist=0.04)


def r_ashlar(S, key):
    """Dressed Caen limestone: warm cream blocks, tooling striations, pits,
    chipped arrises, darker weathering in patches, lichen."""
    g = S.g
    base = S.col('#bdb39b')
    alb = S.tint(base, S.n(1.3, 4, 0.6), 0.78, 1.1)
    alb = S.tint(alb, S.n(9.0, 5, 0.65), 0.9, 1.06)
    tool = g.wave(g.vscale(S.P, (1.0, 1.0, 1.0)), 28.0, kind='BANDS', direction='Z', distortion=2.0, detail=2)
    alb = S.tint(alb, tool, 0.95, 1.03)
    pits = g.smooth(g.voronoi(S.P, 70.0, rand=1.0), 0.06, 0.02)
    alb = g.mix(g.mul(pits, 0.45), alb, S.col('#5a5446'))
    chip = g.mul(g.smooth(S.edge, 0.3, 0.75), g.smooth(S.n(9.0, 5, 0.6), 0.45, 0.6))
    alb = g.mix(g.mul(chip, 0.5), alb, S.col('#d6cfbd'))
    weath = g.smooth(S.n(2.2, 5, 0.6), 0.6, 0.75)
    alb = g.mix(g.mul(weath, 0.4), alb, S.col('#77705f'))
    lich = g.mul(g.smooth(g.voronoi(S.P, 5.0, rand=1.0), 0.14, 0.05), g.smooth(S.n(1.6, 3, 0.5), 0.55, 0.65))
    alb = g.mix(g.mul(lich, 0.55), alb, S.col('#b7b79a'))
    algae = g.mul(g.smooth(S.Z, 0.7, 0.05), g.smooth(S.n(2.5, 5, 0.6), 0.4, 0.62))
    alb = g.mix(g.mul(algae, 0.5), alb, S.col('#3c4a2c'))
    h = g.sub(g.add(0.65, g.mul(S.n(22.0, 5, 0.6), 0.12)), g.add(g.mul(chip, 0.35), g.mul(pits, 0.2)))
    return dict(albedo=alb, rough=g.map_range(S.n(14.0), 0, 1, 0.68, 0.88), metal=0.0, height=h, bump=0.9, dist=0.025)


def r_ashlar_step(S, key):
    """Worn stone steps: polished dip in the middle of the treads, mud."""
    g = S.g
    ch = r_ashlar(S, key)
    worn = g.mul(g.smooth(S.up, 0.7, 0.95), g.smooth(S.n(3.0), 0.35, 0.6))
    ch['albedo'] = g.mix(g.mul(worn, 0.35), ch['albedo'], S.col('#8f8a7e'))
    ch['rough'] = g.mixf(worn, ch['rough'], 0.45)
    return ch


def _crack_dist(S, P, scale=0.6, warp=0.5):
    """Distance in metres to the nearest line of a domain-warped Voronoi net
    (with a small high-frequency wobble): long, meandering crack lines. The
    net is 2D in (x + y, z), along the walls and up, which every wall of a
    box-built house shares, so cracks run on round the corners and cost a
    third of a 3D net."""
    g = S.g
    wv = g.vmath('SUBTRACT', g.noise(P, 0.9, detail=3, rough=0.55, out='Color'), (0.5, 0.5, 0.5))
    jv = g.vmath('SUBTRACT', g.noise(P, 11.0, detail=2, rough=0.5, out='Color'), (0.5, 0.5, 0.5))
    pw = g.vmath('ADD', g.vmath('ADD', P, g.vscale(wv, warp)), g.vscale(jv, 0.035))
    x, y, z = g.sep(pw)
    return g.mul(g.voronoi_edge(g.combine(g.add(x, y), z, 0.0), scale, rand=1.0, dims='2D'), 1.0 / scale)


def _crack_mask(S, P):
    """Where the wall has cracked (about a quarter of it), with the net broken
    now and then into long open runs so no closed cells show."""
    g = S.g
    keep = g.smooth(S.n(0.5, 3, 0.5, vec=P), 0.5, 0.6)
    frag = g.smooth(S.n(0.9, 2, 0.5, vec=g.vadd(P, (11.0, 3.0, 7.0))), 0.38, 0.47)
    return g.mul(keep, frag)


def r_render(S, key):
    """Lime render (crépi): blotchy, trowelled, a few long cracks with dirt
    soaked in round them and washed down below them, blown patches with a
    broken rim showing the rubble, vertical water stains, green algae and
    splash at the foot."""
    g = S.g
    base = S.col('#b9ae98') if key in ('plaster', 'render') else S.col('#9e927d')
    alb = S.tint(base, S.n(0.7, 4, 0.6), 0.8, 1.1)
    alb = S.tint(alb, S.n(4.5, 4, 0.6), 0.9, 1.07)
    trowel = S.n(30.0, 4, 0.7, stretch=(1.0, 1.0, 0.6))
    alb = S.tint(alb, trowel, 0.94, 1.04)
    # run-off stains: a few broad soft streaks (more octaves made fine regular stripes)
    streak = g.smooth(S.n(1.2, 2, 0.5, stretch=(3, 3, 0.3)), 0.6, 0.8)
    alb = g.mix(g.mul(streak, 0.28), alb, S.col('#5f5646'))
    # cracks: only where the wall has cracked, 1.6-2.6 cm across with soft
    # edges so they survive the bake (a texel is ~1 cm) and fading out where
    # they end, dark grey-brown rather than black, a halo of dirt
    # soaked into the render and grime washed down below; chips of render
    # lost along the edges
    keep = _crack_mask(S, S.P)
    d = _crack_dist(S, S.P)
    w = g.add(0.008, g.mul(keep, 0.005))          # never under a texel wide, or it bakes dotted
    crk = g.mul(g.smooth(d, w, g.mul(w, 0.35)), g.smooth(keep, 0.02, 0.3))
    halo = g.mul(g.smooth(d, 0.07, 0.0), keep)
    run = 0.0
    for dz, w in ((0.08, 0.5), (0.24, 0.28)):
        Pz = g.vadd(S.P, (0.0, 0.0, dz))
        dd = _crack_dist(S, Pz)
        run = g.maximum(run, g.mul(g.mul(g.smooth(dd, 0.03 + dz * 0.1, 0.0), w), _crack_mask(S, Pz)))
    run = g.mul(run, g.add(0.4, g.mul(g.smooth(S.n(3.0, 3, 0.5, stretch=(6, 6, 0.3)), 0.4, 0.7), 0.6)))
    spall = g.mul(g.mul(g.smooth(d, 0.035, 0.012), g.smooth(S.n(14.0, 3, 0.6), 0.6, 0.68)), keep)
    alb = g.mix(g.mul(halo, 0.22), alb, S.col('#6d6352'))
    alb = g.mix(g.mul(run, 0.3), alb, S.col('#5f5646'))
    alb = g.mix(g.mul(spall, 0.55), alb, S.col('#cdc3ad'))
    alb = g.mix(g.mul(crk, 0.75), alb, S.col('#4a4236'))
    pn = g.add(S.n(1.0, 6, 0.65), g.mul(S.edge, 0.2))
    patch = g.smooth(pn, 0.67, 0.69)
    rim = g.sub(g.smooth(pn, 0.635, 0.665), patch)
    st = r_rubble(S, 'stone')
    alb = g.mix(g.mul(rim, 0.6), alb, S.col('#6e6555'))
    alb = g.mix(patch, alb, st['albedo'])
    algae = g.mul(g.smooth(S.Z, 0.8, 0.05), g.smooth(S.n(2.2, 5, 0.6), 0.3, 0.6))
    alb = g.mix(g.mul(algae, 0.6), alb, g.mix(S.n(18.0), S.col('#34402a'), S.col('#56603a')))
    h_pl = g.sub(g.sub(g.add(0.8, g.mul(trowel, 0.08)), g.mul(crk, 0.3)), g.mul(spall, 0.06))
    h = g.mixf(patch, h_pl, g.mul(st['height'], 0.55))
    rough = g.mixf(patch, g.map_range(S.n(6.0), 0, 1, 0.83, 0.95), st['rough'])
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.85, dist=0.03)


def r_glass_dirty(S, key):
    """Old window glass: near-black with reflections, a dust film, rain
    streaks running down, grime caked in the corners."""
    g = S.g
    alb = S.tint(S.col('#141a1f'), S.n(3.0), 0.8, 1.25)
    dust = g.add(0.18, g.mul(S.n(4.0, 4, 0.6), 0.25))
    streak = g.smooth(S.n(3.0, 4, 0.5, stretch=(9, 9, 0.25)), 0.5, 0.72)
    corner = g.smooth(S.ao, 0.85, 0.45)
    m_ = g.add(g.add(g.mul(dust, 0.6), g.mul(streak, 0.35)), g.mul(corner, 0.7))
    alb = g.mix(g.minimum(m_, 0.85), alb, S.col('#57564c'))
    rough = g.mixf(g.minimum(m_, 1.0), 0.04, 0.6)
    return dict(albedo=alb, rough=rough, metal=0.0, height=g.mul(streak, 0.2), bump=0.1, dist=0.003)


def _painted_board_v3(hexcode, door=False):
    """Paint on boards: grain, chips and flakes at the edges down to grey
    wood; doors also worn at handle height and rotting at the bottom."""
    def r(S, key):
        g = S.g
        grain = S.n(1.0, 6, 0.65, vec=g.combine(g.mul(S.U, 36.0), g.mul(S.V, 2.2), 0.0), distortion=0.4)
        wood = g.mix(grain, S.col('#625a4e'), S.col('#8f8577'))
        paint = S.tint(S.col(hexcode), S.n(2.5), 0.75, 1.12)
        paint = S.tint(paint, grain, 0.9, 1.06)
        flake = g.add(g.mul(S.edge, 0.95), S.n(6.0, 6, 0.7))
        if door:
            spot = g.smooth(S.n(2.0, 3, 0.5), 0.45, 0.7)
            band = g.mul(g.mul(g.smooth(g.absolute(g.sub(S.Z, 1.05)), 0.16, 0.02), spot), 0.4)
            foot = g.mul(g.mul(g.smooth(S.Z, 0.3, 0.02), g.smooth(S.n(4.0), 0.35, 0.65)), 0.45)
            flake = g.add(flake, g.add(band, foot))
        peel = g.smooth(flake, 0.68, 0.72)
        alb = g.mix(peel, paint, wood)
        if door:
            grime = g.mul(g.mul(g.smooth(g.absolute(g.sub(S.Z, 1.05)), 0.18, 0.0), spot), 0.45)
            alb = g.mix(grime, alb, S.col('#2c241c'))
            rot = g.mul(g.smooth(S.Z, 0.35, 0.0), g.smooth(S.n(5.0), 0.3, 0.6))
            alb = g.mix(g.mul(rot, 0.8), alb, S.col('#2a2118'))
        h = g.mixf(peel, g.add(0.78, g.mul(grain, 0.08)), g.add(0.55, g.mul(grain, 0.3)))
        return dict(albedo=alb, rough=g.mixf(peel, 0.55, 0.88), metal=0.0, height=h, bump=0.7, dist=0.015)
    return r


def _mossy(base_fn, amount=0.75):
    """A roof recipe with heavy moss and lichen (north-facing slopes)."""
    def r(S, key):
        g = S.g
        ch = base_fn(S, key)
        m_ = g.mul(g.smooth(g.add(S.n(2.6, 6, 0.65), g.mul(S.n(9.0, 4, 0.6), 0.3)), 0.52, 0.7), amount)
        mc = g.mix(S.n(25.0, 4, 0.7), S.col('#343c26'), S.col('#5c6436'))
        ch['albedo'] = g.mix(m_, ch['albedo'], mc)
        lich = g.smooth(g.voronoi(S.P, 9.0, rand=1.0), 0.12, 0.04)
        ch['albedo'] = g.mix(g.mul(lich, 0.5), ch['albedo'], S.col('#a8a678'))
        ch['rough'] = g.mixf(m_, ch['rough'], 0.95)
        ch['height'] = g.add(ch['height'], g.mul(m_, 0.3))
        return ch
    return r


# -------- weathering decals: a wall recipe with an effect on top, driven by
# the 'stainuv' layer of the decal quad (u across 0..1, v up 0..1)

def _decal_recipe(base_key, effect):
    import surfaces as SF

    def r(S, key):
        g = S.g
        ch = SF.RECIPES[base_key](S, base_key)
        su, sv, _ = g.sep(g.uvmap('stainuv'))
        streaks = g.smooth(S.n(2.4, 4, 0.55, stretch=(8, 8, 0.25)), 0.4, 0.7)
        if effect == 'stain':                  # run-off under a sill
            across = g.smooth(g.sub(0.5, g.absolute(g.sub(su, 0.5))), 0.0, 0.3)
            m_ = g.mul(g.mul(g.power(sv, 0.8), across), g.add(0.35, g.mul(streaks, 0.65)))
            c = S.col('#433a2e')
            k = 0.7
        elif effect == 'eave':                 # overflow from the gutter
            m_ = g.mul(g.power(sv, 1.6), g.add(0.25, g.mul(streaks, 0.75)))
            c = g.mix(S.n(6.0), S.col('#2f3226'), S.col('#4a4a36'))
            k = 0.75
        else:                                  # soot above a burnt opening / chimney
            w_ = g.mul(g.sub(1.0, g.mul(sv, 0.55)), 0.5)
            shape = g.smooth(g.sub(w_, g.absolute(g.sub(su, 0.5))), 0.0, 0.16)
            m_ = g.mul(g.mul(shape, g.power(g.sub(1.0, sv), 0.6)), g.add(0.6, g.mul(S.n(3.0, 4, 0.6), 0.6)))
            c = S.col('#121110')
            k = 0.95
        mk = g.minimum(g.mul(m_, k), 1.0)
        ch['albedo'] = g.mix(mk, ch['albedo'], c)
        ch['rough'] = g.mixf(mk, ch['rough'], 0.7 if effect != 'soot' else 0.95)
        return ch
    return r


def decal_key(base_key, effect):
    import surfaces as SF
    k = f'{base_key}~{effect}'
    if k not in kit.PALETTE:
        kit.PALETTE[k] = kit.PALETTE[base_key]
        SF.RECIPES[k] = _decal_recipe(base_key, effect)
        SF.PROFILE[k] = SF.PROFILE.get(base_key, 'building')
    return k


def decal(F, x0, x1, z0, z1, key, uv=None, y=-0.004, name='decal'):
    """A weathering decal quad in wall frame F (4 mm proud of the face) with
    its own 'stainuv' coordinates: uv = ((u0, v0), (u1, v1)) at the corners
    (default 0..1 across and up)."""
    (u0, v0), (u1, v1) = uv or ((0.0, 0.0), (1.0, 1.0))
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], [], [(0, 1, 2, 3)])
    me.update()
    lay = me.uv_layers.new(name='stainuv')
    vals = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for li, loop in enumerate(me.loops):
        lay.data[li].uv = vals[loop.vertex_index]
    me.uv_layers.new(name='UVMap')
    me.materials.append(kit.material(key))
    o = kit.link(bpy.data.objects.new(name, me))
    xform([o], F)
    return o


V3_SURFACES = {
    # key: (hex, rough, metal, recipe, profile)
    'ashlar':        ('#bdb39b', 0.8, 0.0, r_ashlar, 'masonry'),
    'ashlar_step':   ('#a9a08c', 0.7, 0.0, r_ashlar_step, 'step'),
    'glass_dirty':   ('#151b20', 0.2, 0.0, r_glass_dirty, 'none'),
    'stone_rubble':  ('#7d7468', 0.9, 0.0, lambda S, k: r_rubble(S, k, dark=True), 'rubble'),
    'cobble_road':   ('#6c6862', 0.8, 0.0, None, 'step'),
}


def register_v3():
    """Runtime-only upgrades for this build process: better masonry and
    render for the existing wall keys, new keys for dressings, steps, glass,
    painted boards, mossy north slopes; gentler moss on steps, decks and
    fresh rubble (new weathering profiles)."""
    import surfaces as SF
    SF.WEATHER['masonry'] = (1.0, 0.4, 0.7, 0.22, 0.14, 0.2)
    # render: the shared fine rain streaks read as regular stripes on a smooth
    # wall; r_render lays its own broad stains, so only a trace of them here
    SF.WEATHER['render'] = (1.0, 0.4, 0.7, 0.05, 0.14, 0.2)
    SF.WEATHER['step'] = (1.0, 0.45, 0.4, 0.1, 0.04, 0.3)
    SF.WEATHER['rubble'] = (1.0, 0.45, 0.3, 0.0, 0.02, 0.25)
    SF.WEATHER['roofn'] = (0.95, 0.35, 0.0, 0.25, 0.2, 0.1)
    SF.RECIPES['stone'] = lambda S, k: r_rubble(S, k, dark=False)
    SF.RECIPES['stone_dark'] = lambda S, k: r_rubble(S, k, dark=True)
    SF.RECIPES['plaster'] = r_render
    SF.RECIPES['plaster_dirty'] = r_render
    for k in ('stone', 'stone_dark', 'brick'):
        SF.PROFILE[k] = 'masonry'
    for k in ('plaster', 'plaster_dirty'):
        SF.PROFILE[k] = 'render'
    SF.PROFILE['cobble'] = 'step'
    for k, (hexcode, rough, metal, fn, prof) in V3_SURFACES.items():
        kit.PALETTE[k] = (hexcode, rough, metal)
        SF.RECIPES[k] = fn if fn is not None else SF.RECIPES['cobble']
        SF.PROFILE[k] = prof
    for k, hexcode in (('shutter_green', '#3b5140'), ('shutter_blue', '#4a5f72'), ('shutter_red', '#6a2820'),
                       ('shutter_grey', '#8c8b80')):
        SF.RECIPES[k] = _painted_board_v3(hexcode)
    for k, hexcode in (('door_green', '#2e4234'), ('door_red', '#5c201a')):
        SF.RECIPES[k] = _painted_board_v3(hexcode, door=True)
    for k, base in (('roof_tile_n', 'roof_tile'), ('roof_slate_n', 'roof_slate'), ('thatch_n', 'thatch')):
        kit.PALETTE[k] = kit.PALETTE[base]
        SF.RECIPES[k] = _mossy(SF.RECIPES[base], 0.55 if base != 'roof_slate' else 0.45)
        SF.PROFILE[k] = 'roofn'
    ROOF_KEYS_V3.update(('roof_tile_n', 'roof_slate_n', 'thatch_n'))
    GRAIN_KEYS_V3.update(('board_door',))


ROOF_KEYS_V3 = set()
GRAIN_KEYS_V3 = set()


def r_fieldstone(S, key):
    """A single rough stone (proud stones, rubble chunks): one tone per stone
    from its position, pitted, lichen, a little moss on top."""
    g = S.g
    cols = [S.col(c) for c in ('#a89e88', '#85878a', '#a08a68', '#66635d', '#937a60')]
    tone = g.voronoi(S.P, 1.2, out='Color', rand=1.0)
    alb = _pick(g, g.sep(tone)[0], cols)
    alb = S.tint(alb, g.sep(tone)[1], 0.75, 1.15)
    alb = S.tint(alb, S.n(8.0, 6, 0.65), 0.8, 1.15)
    pits = g.smooth(g.voronoi(S.P, 50.0, rand=1.0), 0.07, 0.02)
    alb = g.mix(g.mul(pits, 0.5), alb, S.col('#3a3530'))
    h = g.sub(g.add(0.6, g.mul(S.n(14.0, 6, 0.65), 0.3)), g.mul(pits, 0.2))
    return dict(albedo=alb, rough=g.map_range(S.n(12.0), 0, 1, 0.75, 0.92), metal=0.0, height=h, bump=1.0, dist=0.03)


V3_SURFACES['fieldstone'] = ('#8a8478', 0.9, 0.0, r_fieldstone, 'masonry')
V3_SURFACES['fieldstone_fresh'] = ('#8a8478', 0.9, 0.0, r_fieldstone, 'rubble')


def proud_stones(F, x0, x1, z0, z1, n, seed=1, mat='fieldstone', edge_bias=0.6):
    """Irregular stones standing 1.5-4 cm proud of a rubble wall (wall frame F),
    crowded towards the ends of the span (corners) and the foot."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        if rnd.random() < edge_bias:
            side = rnd.choice((0, 1))
            d = abs(rnd.gauss(0, 0.45))
            x = x0 + d if side == 0 else x1 - d
        else:
            x = rnd.uniform(x0, x1)
        z = z0 + (z1 - z0) * rnd.random() ** 1.4
        w = rnd.uniform(0.18, 0.42)
        h = w * rnd.uniform(0.45, 0.75)
        k = 6
        pts = []
        for j in range(k):
            a = 2 * math.pi * j / k + rnd.uniform(-0.25, 0.25)
            rr = rnd.uniform(0.72, 1.0)
            pts.append((x + math.cos(a) * w / 2 * rr, z + math.sin(a) * h / 2 * rr))
        pr = rnd.uniform(0.015, 0.045)
        # front face (domed a little) and sides only: the back is in the wall
        cxz = (sum(p_[0] for p_ in pts) / k, sum(p_[1] for p_ in pts) / k)
        verts = [(px, -pr, pz) for px, pz in pts] + [(px, 0.02, pz) for px, pz in pts] + [(cxz[0], -pr - 0.012, cxz[1])]
        faces = [(j, (j + 1) % k, 2 * k) for j in range(k)]
        faces += [(k + j, k + (j + 1) % k, (j + 1) % k, j) for j in range(k)]
        o = mesh('proud', verts, faces, mat)
        xform([o], F)
        out.append(o)
    return out


def wall_breach(m, F, x, z, r, cutters, seed=1, wall_t=0.6, depth=1.6, floor_z=None, rim_mat='stone_rubble',
                inner_mat='plaster_soot', ground=False):
    """Shell hole through a wall (frame F): a ragged breach through the
    masonry (rubble faces), a charred room behind it, broken joists and
    boards sticking out, rubble in the hole and below it, bullet pocks and
    blown render around. Appends cutters; adds parts to m."""
    rnd = random.Random(seed)
    pts = []
    k = 13
    for i in range(k):
        a = 2 * math.pi * i / k + rnd.uniform(-0.12, 0.12)
        rr = r * rnd.uniform(0.62, 1.12)
        pts.append((x + math.cos(a) * rr * 1.1, z + math.sin(a) * rr * 0.9))
    if ground:
        pts = [(px, max(pz, -0.1)) for px, pz in pts]
    cutters.append(xform([slab(pts, -0.3, wall_t + 0.35, rim_mat, 'breach')], F)[0])
    inner = [(x - r * 1.1, z - r * 0.75), (x + r * 1.15, z - r * 0.75), (x + r * 1.15, z + r * 0.9), (x - r * 1.1, z + r * 0.9)]
    if ground:
        inner = [(px, max(pz, -0.1)) for px, pz in inner]
    cutters.append(xform([slab(inner, wall_t - 0.05, depth, inner_mat, 'room')], F)[0])
    loc = []
    fz = floor_z if floor_z is not None else z - r * 0.4
    for j in range(3):
        bx = x - r * 0.7 + j * r * 0.65 + rnd.uniform(-0.08, 0.08)
        ln = rnd.uniform(0.7, 1.3)
        loc.append(kit.box((0.14, ln, 0.2), loc=(bx, wall_t + 0.4 - ln * 0.35, fz), rot=(rnd.uniform(-25, 10), rnd.uniform(-8, 8), rnd.uniform(-12, 12)),
                           mat='burnt', name='joist'))
    for j in range(4):
        ln = rnd.uniform(0.4, 0.9)
        loc.append(kit.box((ln, 0.18, 0.03), loc=(x + rnd.uniform(-r * 0.6, r * 0.6), wall_t + rnd.uniform(0.2, 0.9), fz + 0.12),
                           rot=(rnd.uniform(-20, 20), rnd.uniform(-15, 15), rnd.uniform(0, 180)), mat='board_dark', name='board'))
    zb = (z - r * 0.75) if not ground else 0.0
    for j in range(9):
        sz = rnd.uniform(0.12, 0.3)
        loc.append(kit.box((sz * 1.4, sz, sz * 0.7), loc=(x + rnd.uniform(-r * 0.8, r * 0.8), rnd.uniform(0.1, wall_t + 0.8), zb + sz * 0.35),
                           rot=(rnd.uniform(-25, 25), rnd.uniform(-25, 25), rnd.uniform(0, 180)), mat='fieldstone_fresh', name='chunk'))
    xform(loc, F)
    m.add(*loc)
    # debris at the wall foot outside, blown render and pocks around the hole
    deb = []
    for j in range(8):
        sz = rnd.uniform(0.1, 0.26)
        deb.append(kit.box((sz * 1.3, sz, sz * 0.7), loc=(x + rnd.gauss(0, r * 0.8), -rnd.uniform(0.1, 0.9), sz * 0.3),
                           rot=(rnd.uniform(-25, 25), rnd.uniform(-25, 25), rnd.uniform(0, 180)), mat='fieldstone_fresh', name='debris'))
    xform(deb, F)
    m.add(*deb)
    cutters += pocks(F, x, z, 26, r * 0.9, seed=seed + 5, mat='stone_rubble')
    # render blown off in a ragged ring round the hole: the rubble shows
    inner_ring = [(x + (px - x) * 1.02, z + (pz - z) * 1.02) for px, pz in pts]
    outer_ring = []
    for i, (px, pz) in enumerate(pts):
        f = rnd.uniform(1.25, 1.75)
        outer_ring.append((x + (px - x) * f, max(0.02, z + (pz - z) * f)))
    o = ring(outer_ring, inner_ring, -0.006, 0.008, rim_mat, 'blown', back=False, outer_side=True)
    xform([o], F)
    m.add(o)
    m.openings.setdefault(fkey(F), []).append((x - r * 1.9, x + r * 1.9, z - r * 1.5, z + r * 1.5))


def fkey(F):
    return tuple(round(F[i][j], 3) for i in range(3) for j in range(4))


def soot_key(base):
    """A heavily sooted variant of a wall key (chimney tops, burnt walls)."""
    import surfaces as SF
    k = f'{base}^soot'
    if k not in kit.PALETTE:
        kit.PALETTE[k] = kit.PALETTE[base]
        SF.RECIPES[k] = r_soot(base, dark=True)
        SF.PROFILE[k] = SF.PROFILE.get(base, 'building')
    return k


def drop_faces(obj, pred):
    """Delete the faces of obj (world space test pred(center, normal))."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_basis
    rot = mw.to_3x3()
    kill = [f for f in bm.faces if pred(mw @ f.calc_center_median(), (rot @ f.normal).normalized())]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def scale_islands_facing(obj):
    """bake.unwrap hook: give street-facing (-Y) faces more texels, roofs and
    undersides fewer, before the atlas is packed."""
    import bmesh as _bm
    me = obj.data
    bm = _bm.new()
    bm.from_mesh(me)
    lay = bm.loops.layers.uv.get('bake')
    if lay is None:
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
        lf = e.link_faces
        if len(lf) != 2:
            continue
        f1, f2 = lf
        ok = True
        for v in e.verts:
            u1 = next(l[lay].uv for l in f1.loops if l.vert == v)
            u2 = next(l[lay].uv for l in f2.loops if l.vert == v)
            if (u1 - u2).length > 1e-6:
                ok = False
                break
        if ok:
            a, b = find(f1.index), find(f2.index)
            if a != b:
                parent[a] = b
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    names = [m_.name.split('.')[0] if m_ else '' for m_ in me.materials]
    for faces in groups.values():
        area = sum(f.calc_area() for f in faces) or 1e-9
        k = 0.0
        for f in faces:
            n = f.normal
            key = names[f.material_index] if f.material_index < len(names) else ''
            if key.startswith('roof') or key.startswith('thatch'):
                w = 0.85
            elif n.z < -0.5:
                w = 0.55
            elif n.y < -0.5:
                w = 1.3
            elif abs(n.z) < 0.5:
                w = 1.05 if n.y < 0.5 else 0.9
            else:
                w = 1.0
            k += w * f.calc_area()
        k /= area
        if abs(k - 1.0) < 0.02:
            continue
        uvs = [l[lay] for f in faces for l in f.loops]
        cx = sum(u.uv.x for u in uvs) / len(uvs)
        cy = sum(u.uv.y for u in uvs) / len(uvs)
        for u in uvs:
            u.uv.x = cx + (u.uv.x - cx) * k
            u.uv.y = cy + (u.uv.y - cy) * k
    bm.to_mesh(me)
    bm.free()
