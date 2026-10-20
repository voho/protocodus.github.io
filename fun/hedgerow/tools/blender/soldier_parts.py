"""Hedgerow — soldier set helpers (rig, skinned outfits, poses, clips, weapons).

Used by build_soldier.py. Blender space: Z up, metres, the soldier faces -Y,
his left is +X. Everything is deterministic (no clock, seeded noise only).

Geometry is generated straight into a `MeshBuilder` that carries per-vertex
skin weights (dict bone -> weight) and a grime/occlusion value, so the skin
weights are analytic functions of the rest position: lofted limbs blend
across their joints, the torso blends along the spine, rigid parts (head,
hands, helmet, kit) follow one bone.
"""
import bpy, bmesh, json, math, os, random
from mathutils import Vector, Matrix, Quaternion, noise

import kit

rad = math.radians
V = Vector


def smoothstep(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def catmull(table, z, cols):
    """Catmull-Rom interpolation of rows (z, c1, c2, ...) at z (clamped)."""
    zs = [r[0] for r in table]
    if z <= zs[0]:
        return list(table[0][1:cols + 1])
    if z >= zs[-1]:
        return list(table[-1][1:cols + 1])
    i = 0
    while zs[i + 1] < z:
        i += 1
    t = (z - zs[i]) / (zs[i + 1] - zs[i])
    out = []
    for c in range(1, cols + 1):
        p1, p2 = table[i][c], table[i + 1][c]
        p0 = table[i - 1][c] if i > 0 else p1
        p3 = table[i + 2][c] if i + 2 < len(table) else p2
        # non-uniform spacing tolerated: plain CR on values, clamped to avoid overshoot
        v = 0.5 * (2 * p1 + (-p0 + p2) * t +
                   (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
        lo, hi = min(p1, p2), max(p1, p2)
        span = hi - lo
        v = max(lo - 0.25 * span, min(hi + 0.25 * span, v))
        out.append(v)
    return out


# ==========================================================================
# Rig

H = 1.745            # stature (top of the skull); the helmet brings it to ~1.78

BONE_ORDER = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
              'clavicle_l', 'upperarm_l', 'forearm_l', 'hand_l',
              'clavicle_r', 'upperarm_r', 'forearm_r', 'hand_r',
              'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r']

_A = rad(45)         # A-pose: upper arm 45 deg below horizontal
_UA = V((math.sin(_A), 0, -math.cos(_A)))
_FA = (_UA * math.cos(rad(15)) + V((0, -1, 0)) * math.sin(rad(15))).normalized()

SHOULDER_L = V((0.172, 0.030, 1.390))
ELBOW_L = SHOULDER_L + _UA * 0.290
WRIST_L = ELBOW_L + _FA * 0.250
HIP_L = V((0.088, 0.010, 0.915))
KNEE_L = V((0.095, -0.005, 0.495))
ANKLE_L = V((0.100, 0.020, 0.085))
BALL_L = V((0.104, -0.115, 0.022))

FWD = V((0, -1, 0))
UP = V((0, 0, 1))


def _mx(v):
    return V((-v.x, v.y, v.z))


def bone_table():
    """(name, head, tail, parent, roll_vector) — roll_vector is the direction the
    bone's local Z axis is aligned to (align_roll)."""
    t = [
        ('root', V((0, 0, 0)), V((0, 0, 0.15)), None, FWD),
        ('hips', V((0, 0.012, 0.955)), V((0, 0.020, 1.065)), 'root', FWD),
        ('spine', V((0, 0.020, 1.065)), V((0, 0.030, 1.215)), 'hips', FWD),
        ('chest', V((0, 0.030, 1.215)), V((0, 0.035, 1.430)), 'spine', FWD),
        ('neck', V((0, 0.035, 1.430)), V((0, 0.015, 1.555)), 'chest', FWD),
        ('head', V((0, 0.015, 1.555)), V((0, 0.015, 1.745)), 'neck', FWD),
    ]
    for s, mir in (('l', lambda v: v), ('r', _mx)):
        t += [
            ('clavicle_' + s, mir(V((0.030, 0.000, 1.405))), mir(SHOULDER_L), 'chest', FWD),
            ('upperarm_' + s, mir(SHOULDER_L), mir(ELBOW_L), 'clavicle_' + s, FWD),
            ('forearm_' + s, mir(ELBOW_L), mir(WRIST_L), 'upperarm_' + s, FWD),
            ('hand_' + s, mir(WRIST_L), mir(WRIST_L + _FA * 0.09), 'forearm_' + s, FWD),
            ('thigh_' + s, mir(HIP_L), mir(KNEE_L), 'hips', FWD),
            ('shin_' + s, mir(KNEE_L), mir(ANKLE_L), 'thigh_' + s, FWD),
            ('foot_' + s, mir(ANKLE_L), mir(BALL_L), 'shin_' + s, UP),
        ]
    order = {n: i for i, n in enumerate(BONE_ORDER)}
    return sorted(t, key=lambda r: order[r[0]])


def build_rig(name='rig'):
    arm = bpy.data.armatures.new(name)
    rig = kit.link(bpy.data.objects.new(name, arm))
    kit.activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for bname, head, tail, parent, rollv in bone_table():
        eb = arm.edit_bones.new(bname)
        eb.head, eb.tail = head, tail
        eb.align_roll(rollv)
        eb.use_deform = True
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = False
        ebs[bname] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    arm.display_type = 'STICK'
    return rig


# ==========================================================================
# Mesh builder with skin weights

class MeshBuilder:
    def __init__(self):
        self.co, self.w, self.c = [], [], []
        self.faces, self.fmat, self.fsm = [], [], []
        self.parts = {}
        self.morph_idx = []          # vertices the face morph targets act on (v4)
        self.morph_follow = []       # vertices that copy the morph of the skin under them (the chin strap)

    def part(self, name):
        """Context-free tally of triangles per named part (for notes)."""
        self._part = name
        self.parts.setdefault(name, 0)

    def vert(self, p, w, c=1.0):
        self.co.append(V(p))
        self.w.append(w)
        self.c.append(c)
        return len(self.co) - 1

    def face(self, idx, mat, smooth=True, flip=False):
        idx = tuple(idx)
        if flip:
            idx = idx[::-1]
        self.faces.append(idx)
        self.fmat.append(mat)
        self.fsm.append(smooth)
        if getattr(self, '_part', None):
            self.parts[self._part] += len(idx) - 2

    def loft(self, rings, mat, wfn, cfn=None, cap0=False, cap1=False, smooth=True,
             closed=True, flip=False, mats=None):
        """Quads between consecutive rings (same vertex count). Rings must run
        counter-clockwise seen from the direction of travel for outward
        normals (flip=True reverses). `mats(k, i)` may override per quad."""
        ids = []
        for ring in rings:
            ids.append([self.vert(p, wfn(p), cfn(p) if cfn else 1.0) for p in ring])
        n = len(rings[0])
        m = n if closed else n - 1
        for k in range(len(rings) - 1):
            a, b = ids[k], ids[k + 1]
            for i in range(m):
                j = (i + 1) % n
                mk = mats(k, i) if mats else mat
                self.face((a[i], a[j], b[j], b[i]), mk, smooth, flip)
        if cap0:
            self._fan(ids[0], rings[0], mat, wfn, cfn, smooth, not flip, cap0)
        if cap1:
            self._fan(ids[-1], rings[-1], mat, wfn, cfn, smooth, flip, cap1)
        return ids

    def _fan(self, ids, ring, mat, wfn, cfn, smooth, flip, cap):
        if isinstance(cap, (Vector, tuple, list)):
            c = V(cap)
        else:
            c = sum(ring, V()) / len(ring)
        ci = self.vert(c, wfn(c), cfn(c) if cfn else 1.0)
        n = len(ids)
        for i in range(n):
            j = (i + 1) % n
            self.face((ids[i], ids[j], ci), mat, smooth, flip)

    def add_bmesh(self, bm, matrix, mat, wfn, cfn=None, smooth=False, flip=False):
        base = len(self.co)
        for v in bm.verts:
            p = matrix @ v.co
            self.vert(p, wfn(p), cfn(p) if cfn else 1.0)
        for f in bm.faces:
            self.face([base + v.index for v in f.verts], mat, smooth, flip)
        bm.free()

    def face_out(self, idx, mat, outward, smooth=True):
        """A face whose winding is chosen so its normal points along `outward`."""
        p = [self.co[i] for i in idx]
        n = (p[1] - p[0]).cross(p[2] - p[1])
        self.face(idx, mat, smooth, flip=n.dot(outward) < 0)

    def box(self, center, size, mat, wfn, rot=None, cfn=None, bevel=0.0, smooth=False, segs=1):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=V(size), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect='EDGES',
                            profile=0.5)
        bm.verts.index_update()
        m = Matrix.Translation(center) @ (rot.to_4x4() if rot is not None else Matrix.Identity(4))
        self.add_bmesh(bm, m, mat, wfn, cfn, smooth)

    def cylinder(self, a, b, r, mat, wfn, seg=8, cfn=None, r2=None, cap=True, smooth=True):
        """Cylinder from point a to b."""
        rings = [ring_around(a, b - a, r, seg), ring_around(b, b - a, r if r2 is None else r2, seg)]
        self.loft(rings, mat, wfn, cfn, cap0=cap, cap1=cap, smooth=smooth)

    def build(self, name, rig=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(c) for c in self.co], [], self.faces)
        keys = []
        for m in self.fmat:
            if m not in keys:
                keys.append(m)
        for k in keys:
            me.materials.append(kit.material(k))
        kidx = {k: i for i, k in enumerate(keys)}
        me.polygons.foreach_set('material_index', [kidx[m] for m in self.fmat])
        me.polygons.foreach_set('use_smooth', self.fsm)
        obj = kit.link(bpy.data.objects.new(name, me))
        # grime / occlusion colour per corner
        attr = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        me.color_attributes.active_color = attr
        loops_v = [0] * len(me.loops)
        me.loops.foreach_get('vertex_index', loops_v)
        flat = []
        for vi in loops_v:
            g = max(0.0, min(1.0, self.c[vi]))
            flat += (g, g, g, 1.0)
        attr.data.foreach_set('color', flat)
        if any(self.w):
            groups = {b: obj.vertex_groups.new(name=b) for b in BONE_ORDER}
            for i, w in enumerate(self.w):
                items = sorted(((b, x) for b, x in w.items() if x > 1e-4), key=lambda t: -t[1])[:4]
                tot = sum(x for _, x in items) or 1.0
                for b, x in items:
                    groups[b].add([i], x / tot, 'REPLACE')
        if rig is not None:
            attach_rig(obj, rig)
        kit.uv_box(obj)
        try:
            me.set_sharp_from_angle(angle=rad(self.sharp if hasattr(self, 'sharp') else 50))
        except AttributeError:
            pass
        me.validate()
        me.update()
        if self.morph_idx:
            assert len(me.vertices) == len(self.co), 'mesh validation changed the vertex count'
            add_face_morphs(obj, self.morph_idx, self.morph_follow)
        return obj


def add_face_morphs(obj, idx, follow=()):
    """Shape keys face_broad, face_gaunt, face_older (glTF morph targets, in
    this order) from the face morph fields, on the listed vertices; the
    `follow` vertices (the chin strap) copy the morph of the skin under them
    (inverse-distance mean of the three nearest skin vertices) so they stay on it."""
    import numpy as np
    from mathutils.kdtree import KDTree
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    idx = np.array(sorted(set(idx) - set(follow)), dtype=np.int64)
    fol = np.array(sorted(set(follow)), dtype=np.int64)
    near = []
    if len(fol):
        kd = KDTree(len(idx))
        for k, i in enumerate(idx):
            kd.insert(co[i], k)
        kd.balance()
        for i in fol:
            hits = kd.find_n(co[i], 3)
            w = np.array([1.0 / max(d, 1e-4) for _, _, d in hits])
            near.append(([k for _, k, _ in hits], w / w.sum()))
    obj.shape_key_add(name='Basis', from_mix=False)
    for name in MORPHS:
        kb = obj.shape_key_add(name=name, from_mix=False)
        new = co.copy()
        D = face4_morph(co[idx], name)
        new[idx] += D
        for i, (ks, w) in zip(fol, near):
            new[i] += (D[ks] * w[:, None]).sum(axis=0)
        kb.data.foreach_set('co', new.astype(np.float32).ravel())
        kb.value = 0.0
    me.shape_keys.use_relative = True
    obj.active_shape_key_index = 0           # edit-mode passes (the bake's unwrap) work on the basis


def attach_rig(obj, rig):
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)
    mod = obj.modifiers.new('rig', 'ARMATURE')
    mod.object = rig
    return obj


def frame_from(t, ref=None):
    """Orthonormal (n, b) perpendicular to tangent t with b = t x n."""
    t = t.normalized()
    ref = ref if ref is not None else (V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0)))
    n = (ref - t * ref.dot(t))
    if n.length < 1e-6:
        n = V((1, 0, 0)) - t * t.x
    n.normalize()
    return n, t.cross(n)


def ring_around(c, t, r, seg, ref=None, rx=None, ry=None, phase=0.0, shape=None):
    """A ring of `seg` points around centre c, perpendicular to t, CCW seen
    from +t. Elliptic radii rx (along n) / ry (along b). shape(a) -> radius scale."""
    n, b = frame_from(t, ref)
    rx = r if rx is None else rx
    ry = r if ry is None else ry
    pts = []
    for i in range(seg):
        a = phase + 2 * math.pi * i / seg
        s = shape(a) if shape else 1.0
        pts.append(c + (n * math.cos(a) * rx + b * math.sin(a) * ry) * s)
    return pts


# ==========================================================================
# Skin weights

def w_rigid(bone):
    d = {bone: 1.0}
    return lambda p: d


def _mix(*pairs):
    out = {}
    for b, x in pairs:
        if x > 0:
            out[b] = out.get(b, 0.0) + x
    return out


def chain_param(p, pts):
    """Arc-length parameter of the closest point on polyline pts."""
    best, best_s, s0 = 1e9, 0.0, 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L = ab.length
        t = max(0.0, min(1.0, (p - a).dot(ab) / (L * L)))
        d = (a + ab * t - p).length
        if d < best:
            best, best_s = d, s0 + t * L
        s0 += L
    return best_s


def w_chain(pts, bones, blends, extra=None):
    """Weights along a joint chain: bones[i] covers segment i; at interior
    joint i (between bones[i-1] and bones[i]) blend over +-blends[i-1]."""
    joints = [0.0]
    for i in range(len(pts) - 1):
        joints.append(joints[-1] + (pts[i + 1] - pts[i]).length)

    def f(p):
        s = chain_param(p, pts)
        w = {bones[0]: 1.0}
        for k in range(1, len(bones)):
            sj, bw = joints[k], blends[k - 1]
            t = smoothstep(sj - bw, sj + bw, s)
            if t <= 0:
                break
            prev = dict(w)
            w = {b: x * (1 - t) for b, x in prev.items()}
            w[bones[k]] = w.get(bones[k], 0) + t
        if extra:
            w = extra(p, w)
        return w
    return f


def w_torso(skirt=0.0):
    """Torso shell: hips -> spine -> chest -> neck along z, clavicles at the
    shoulders, optional thigh pull on the skirt below the belt."""
    def f(p):
        z = p.z
        t1 = smoothstep(1.025, 1.10, z)          # hips -> spine
        t2 = smoothstep(1.17, 1.27, z)           # spine -> chest
        t3 = smoothstep(1.455, 1.50, z)          # chest -> neck
        w = {'hips': (1 - t1)}
        w['spine'] = t1 * (1 - t2)
        w['chest'] = t1 * t2 * (1 - t3)
        w['neck'] = t1 * t2 * t3
        ax = abs(p.x)
        side = 'l' if p.x > 0 else 'r'
        cl = smoothstep(0.07, 0.15, ax) * smoothstep(1.31, 1.40, z) * 0.85
        if cl > 0:
            for k in list(w):
                w[k] *= (1 - cl)
            w['clavicle_' + side] = cl
        # v4: the jacket over the shoulder joint follows the upper arm a little
        d = (V((ax, p.y, z)) - SHOULDER_L).length
        ua = 0.40 * (1 - smoothstep(0.035, 0.085, d)) * smoothstep(0.13, 0.17, ax)
        if ua > 0:
            for k in list(w):
                w[k] *= (1 - ua)
            w['upperarm_' + side] = w.get('upperarm_' + side, 0.0) + ua
        if skirt > 0 and z < 0.97:
            front = p.y < 0.02
            k = skirt * smoothstep(0.97, 0.80, z) * (1.0 if front else 0.55) * smoothstep(0.0, 0.07, ax)
            if k > 0:
                for kk in list(w):
                    w[kk] *= (1 - k)
                w['thigh_' + side] = w.get('thigh_' + side, 0) + k
        return w
    return f


def w_pelvis(p):
    side = 'l' if p.x > 0 else 'r'
    k = smoothstep(0.90, 0.78, p.z) * 0.6 * smoothstep(0.0, 0.06, abs(p.x))
    if p.z < 0.80 and abs(p.x) < 0.06:
        k = smoothstep(0.86, 0.76, p.z) * 0.35
        return {'hips': 1 - 2 * k, 'thigh_l': k, 'thigh_r': k}
    return {'hips': 1 - k, 'thigh_' + side: k}


def w_neck(p):
    t1 = smoothstep(1.40, 1.46, p.z)
    t2 = smoothstep(1.53, 1.575, p.z)
    return _mix(('chest', 1 - t1), ('neck', t1 * (1 - t2)), ('head', t1 * t2))


def w_arm(side):
    mir = (lambda v: v) if side == 'l' else _mx
    pts = [mir(SHOULDER_L), mir(ELBOW_L), mir(WRIST_L)]
    sh = mir(SHOULDER_L)
    ua = (mir(ELBOW_L) - sh).normalized()

    def shoulder(p, w):
        # v4: the cap of the sleeve over the joint blends into the clavicle and chest
        s_ = (p - sh).dot(ua)
        k = 1.0 - smoothstep(-0.050, 0.060, s_)
        if k <= 0:
            return w
        w = {b: x * (1 - k) for b, x in w.items()}
        w['clavicle_' + side] = w.get('clavicle_' + side, 0.0) + 0.70 * k
        w['chest'] = w.get('chest', 0.0) + 0.30 * k
        return w
    return w_chain(pts, ['upperarm_' + side, 'forearm_' + side], [0.050], extra=shoulder)


def w_leg(side, ankle_blend=0.035):
    mir = (lambda v: v) if side == 'l' else _mx
    pts = [mir(HIP_L), mir(KNEE_L), mir(ANKLE_L), mir(BALL_L)]
    return w_chain(pts, ['thigh_' + side, 'shin_' + side, 'foot_' + side], [0.055, ankle_blend])


# ==========================================================================
# Grime / occlusion helpers (vertex colour, 1 = clean)

_NOFF = V((13.7, -5.1, 2.3))


def c_cloth(base=1.0, mud=0.25, var=0.06, ao=None):
    def f(p):
        g = base * (1 - mud * (1 - smoothstep(0.0, 0.45, p.z)))
        g *= 1 + var * noise.noise(p * 9 + _NOFF)
        if ao:
            g *= ao(p)
        return g
    return f


def ao_body(p):
    """Soft occlusion: armpits, crotch, under the collar."""
    g = 1.0
    ax = abs(p.x)
    # armpits
    d = (V((ax, p.y, p.z)) - V((0.165, 0.03, 1.33))).length
    g *= 1 - 0.25 * (1 - smoothstep(0.03, 0.09, d))
    # crotch
    d = (V((ax, p.y, p.z)) - V((0.0, 0.01, 0.78))).length
    g *= 1 - 0.3 * (1 - smoothstep(0.03, 0.12, d))
    return g


# ==========================================================================
# Torso surface: superellipse sections interpolated along z.
# theta = 0 at the front (-Y), pi/2 at the left (+X), increasing CCW from above.

class Section:
    def __init__(self, table, cx=0.0):
        self.table = table     # rows (z, rx, rf, rb, cy, n)
        self.cx = cx

    def point(self, th, z, off=0.0):
        rx, rf, rb, cy, n = catmull(self.table, z, 5)
        c, s = math.cos(th), math.sin(th)
        e = 2.0 / n
        x = math.copysign(abs(s) ** e, s) * (rx + off)
        r = (rf if c > 0 else rb) + off
        y = cy - math.copysign(abs(c) ** e, c) * r
        return V((self.cx + x, y, z))

    def normal(self, th, z):
        d = 1e-3
        a = self.point(th + d, z) - self.point(th - d, z)
        b = self.point(th, z + d) - self.point(th, z - d)
        n = a.cross(b)
        return n.normalized() if n.length > 1e-9 else V((math.sin(th), -math.cos(th), 0))

    def surf(self, th, z, off=0.0):
        """Point offset along the true surface normal."""
        return self.point(th, z) + self.normal(th, z) * off

    def ring(self, z, seg, off=0.0, fn=None):
        pts = []
        for i in range(seg):
            th = 2 * math.pi * i / seg
            o = off + (fn(th, z) if fn else 0.0)
            pts.append(self.point(th, z, o))
        return pts

    def theta_at_x(self, x, z, front=True):
        """theta whose point has the given x (search)."""
        lo, hi = (0.0, math.pi / 2) if x >= 0 else (-math.pi / 2, 0.0)
        if not front:
            lo, hi = (math.pi / 2, math.pi) if x >= 0 else (math.pi, 1.5 * math.pi)
        best, bt = 1e9, lo
        for i in range(81):
            th = lo + (hi - lo) * i / 80
            d = abs(self.point(th, z).x - x)
            if d < best:
                best, bt = d, th
        return bt


TORSO_JACKET = [
    (0.785, 0.182, 0.120, 0.134, 0.012, 2.4),
    (0.840, 0.178, 0.115, 0.131, 0.012, 2.4),
    (0.900, 0.172, 0.110, 0.126, 0.012, 2.4),
    (0.960, 0.166, 0.106, 0.118, 0.015, 2.5),
    (1.020, 0.160, 0.104, 0.110, 0.018, 2.5),
    (1.080, 0.157, 0.106, 0.106, 0.020, 2.5),
    (1.150, 0.160, 0.112, 0.106, 0.022, 2.5),
    (1.220, 0.168, 0.120, 0.108, 0.024, 2.5),
    (1.280, 0.176, 0.124, 0.108, 0.026, 2.6),
    (1.330, 0.182, 0.120, 0.108, 0.028, 2.7),
    (1.375, 0.188, 0.112, 0.104, 0.030, 2.9),
    (1.405, 0.186, 0.102, 0.098, 0.032, 3.0),
    (1.430, 0.168, 0.090, 0.090, 0.034, 3.0),
    (1.450, 0.130, 0.076, 0.080, 0.034, 2.8),
    (1.468, 0.090, 0.066, 0.068, 0.034, 2.5),
    (1.482, 0.068, 0.060, 0.060, 0.032, 2.2),
]

# v4: squarer shoulders (trapezius to the deltoid), a rounder chest and back
# with some depth; the front at the rifle butt (z ~1.37) as TORSO_JACKET
TORSO_JACKET4 = [
    (0.785, 0.182, 0.120, 0.134, 0.012, 2.4),
    (0.840, 0.178, 0.115, 0.131, 0.012, 2.4),
    (0.900, 0.172, 0.110, 0.126, 0.012, 2.4),
    (0.960, 0.165, 0.106, 0.118, 0.015, 2.4),
    (1.020, 0.159, 0.105, 0.111, 0.018, 2.4),
    (1.080, 0.157, 0.108, 0.108, 0.020, 2.35),
    (1.150, 0.162, 0.115, 0.110, 0.022, 2.3),
    (1.220, 0.171, 0.123, 0.114, 0.024, 2.3),
    (1.280, 0.180, 0.127, 0.116, 0.026, 2.35),
    (1.330, 0.187, 0.122, 0.114, 0.028, 2.45),
    (1.375, 0.193, 0.113, 0.108, 0.030, 2.6),
    (1.405, 0.194, 0.103, 0.100, 0.032, 2.7),
    (1.430, 0.179, 0.091, 0.091, 0.034, 2.7),
    (1.450, 0.142, 0.077, 0.081, 0.034, 2.6),
    (1.468, 0.094, 0.067, 0.069, 0.034, 2.4),
    (1.482, 0.070, 0.061, 0.061, 0.032, 2.2),
]

PELVIS = [
    (0.755, 0.060, 0.040, 0.050, 0.012, 2.0),
    (0.780, 0.112, 0.066, 0.086, 0.012, 2.2),
    (0.820, 0.146, 0.088, 0.110, 0.012, 2.3),
    (0.880, 0.160, 0.098, 0.118, 0.012, 2.4),
    (0.960, 0.160, 0.102, 0.112, 0.015, 2.4),
    (1.060, 0.150, 0.098, 0.100, 0.018, 2.4),
]


# ==========================================================================
# Limbs

def chain_eval(pts, s, blend=0.05):
    """Position and smoothed tangent at arc length s along polyline pts
    (s may run before the start / past the end: extrapolated)."""
    segs = []
    acc = 0.0
    for i in range(len(pts) - 1):
        L = (pts[i + 1] - pts[i]).length
        segs.append((acc, L, (pts[i + 1] - pts[i]) / L, pts[i]))
        acc += L
    k = 0
    while k < len(segs) - 1 and s > segs[k][0] + segs[k][1]:
        k += 1
    s0, L, d, a = segs[k]
    pos = a + d * (s - s0)
    tan = V(d)
    # blend tangents near interior joints
    for j in range(1, len(segs)):
        sj = segs[j][0]
        if abs(s - sj) < blend:
            t = smoothstep(sj - blend, sj + blend, s)
            tan = (segs[j - 1][2] * (1 - t) + segs[j][2] * t).normalized()
    return pos, tan


def limb(mb, pts, prof, seg, mat, wfn, cfn=None, ball=None, ref=FWD, lip=None, mirror=False):
    """Loft a garment tube along a joint chain.
    prof: rows (s, rn, rb, dn) radius along n (ref direction ⊥ tangent),
    along b, and centre offset along n. ball: radius of a hemispherical cap
    centred on the first joint. lip: (inner radius, depth) for an open end
    turned inward. mirror: geometry for the right side (x -> -x)."""
    rings = []
    p0, t0 = chain_eval(pts, 0.0)
    if ball:
        for beta in (78, 55, 30):
            b = rad(beta)
            c = p0 - t0 * ball * math.sin(b)
            rings.append(ring_around(c, t0, ball * math.cos(b), seg, ref))
    for row in prof:
        s, rn, rb = row[0], row[1], row[2]
        dn = row[3] if len(row) > 3 else 0.0
        c, t = chain_eval(pts, s)
        n, _ = frame_from(t, ref)
        rings.append(ring_around(c + n * dn, t, 0, seg, ref, rx=rn, ry=rb))
    if lip:
        # open end turned inward: annulus facing +t, then a short inner wall
        s_end = prof[-1][0]
        r_in, depth = lip
        for s in (s_end, s_end - depth):
            c, t = chain_eval(pts, s)
            rings.append(ring_around(c, t, r_in, seg, ref))
    if mirror:
        rings = [[_mx(p) for p in r] for r in rings]
    cap0 = (p0 - t0 * ball) if ball else True
    if mirror and ball:
        cap0 = _mx(cap0)
    mb.loft(rings, mat, wfn, cfn, cap0=cap0, cap1=True, flip=mirror)


# ==========================================================================
# Head

HEAD_C = V((0, 0.015, 1.635))
HEAD_TABLE = [   # z_rel, half-width, front, back, cy
    (-0.117, 0.022, 0.058, 0.030, 0.030),
    (-0.106, 0.036, 0.080, 0.046, 0.026),
    (-0.092, 0.047, 0.089, 0.058, 0.023),
    (-0.075, 0.057, 0.093, 0.068, 0.020),
    (-0.058, 0.064, 0.097, 0.078, 0.016),
    (-0.040, 0.071, 0.099, 0.088, 0.012),
    (-0.020, 0.076, 0.097, 0.095, 0.008),
    (-0.002, 0.078, 0.095, 0.100, 0.006),
    (0.018, 0.080, 0.097, 0.103, 0.006),
    (0.040, 0.079, 0.093, 0.102, 0.008),
    (0.065, 0.075, 0.085, 0.096, 0.010),
    (0.085, 0.066, 0.071, 0.082, 0.012),
    (0.100, 0.046, 0.049, 0.058, 0.012),
]
HEAD_SKIN_TOP = 0.072
HEAD_TH = [0, 10, 20, 30, 41, 53, 67, 82, 100, 120, 142, 165, 180]
HEAD_TH = [rad(a) for a in HEAD_TH] + [rad(360 - a) for a in reversed(HEAD_TH[1:-1])]


def _g(x, mu, sig):
    return math.exp(-0.5 * ((x - mu) / sig) ** 2)


def head_disp(th, zr):
    """Facial relief: radial displacement (m) at azimuth th (0 = front), z_rel."""
    a = math.degrees(th)
    if a > 180:
        a -= 360
    aa = abs(a)
    d = 0.0
    d += 0.0075 * _g(zr, 0.015, 0.008) * _g(aa, 0, 26)                 # brow ridge
    d -= 0.0140 * _g(zr, -0.004, 0.010) * _g(aa, 25, 10)                # eye sockets
    d += 0.0060 * _g(zr, -0.026, 0.010) * _g(aa, 50, 12)                # cheekbones
    d -= 0.0045 * _g(zr, -0.068, 0.0035) * _g(aa, 0, 12)                # mouth line
    d += 0.0030 * _g(zr, -0.059, 0.005) * _g(aa, 0, 12)                 # upper lip
    d += 0.0035 * _g(zr, -0.077, 0.005) * _g(aa, 0, 10)                 # lower lip
    d -= 0.0030 * _g(zr, -0.085, 0.004) * _g(aa, 0, 10)                 # chin crease
    d += 0.0075 * _g(zr, -0.098, 0.009) * _g(aa, 0, 14)                 # chin
    d += 0.0045 * _g(zr, -0.082, 0.012) * _g(aa, 82, 12)                # jaw angle
    d -= 0.0040 * _g(zr, 0.030, 0.015) * _g(aa, 72, 14)                 # temples
    d -= 0.0045 * _g(zr, -0.052, 0.011) * _g(aa, 45, 11)                # under cheekbone
    return d


def head_point(th, zr, off=0.0):
    w, f, b, cy = catmull(HEAD_TABLE, zr, 4)
    c, s = math.cos(th), math.sin(th)
    e = 2.0 / 2.25
    d = head_disp(th, zr) + off
    x = math.copysign(abs(s) ** e, s) * (w + d)
    r = (f if c > 0 else b) + d
    y = cy - math.copysign(abs(c) ** e, c) * r
    return HEAD_C + V((x, y, zr))


def head_front_y(x, zr):
    """Approximate y of the face surface at small |x| (for the nose)."""
    best, by = 1e9, 0
    for i in range(41):
        th = rad(-40 + 2 * i)
        p = head_point(th, zr)
        if abs(p.x - x) < best:
            best, by = abs(p.x - x), p.y
    return by


def build_head(mb, hair_line, eye_ao=0.4):
    """Head with face relief, nose, ears, eyebrows. hair_line(th, zr) -> bool."""
    wfn = w_rigid('head')

    def cfn(p):
        zr = p.z - HEAD_C.z
        th = math.atan2(p.x - HEAD_C.x, -(p.y - HEAD_C.y))
        a = abs(math.degrees(th))
        g = 1.0
        g *= 1 - (1 - eye_ao) * _g(zr, -0.003, 0.010) * _g(a, 25, 12)
        g *= 1 - 0.35 * _g(zr, -0.003, 0.005) * _g(a, 26, 6)            # the eye itself
        g *= 1 - 0.18 * _g(zr, 0.006, 0.006) * _g(a, 22, 12)            # under the brow
        g *= 1 - 0.45 * _g(zr, -0.068, 0.004) * _g(a, 0, 12)            # mouth
        g *= 1 - 0.12 * _g(zr, -0.052, 0.010) * _g(a, 45, 12)           # cheek hollow
        g *= 1 - 0.15 * _g(zr, -0.112, 0.01)
        g *= 1 + 0.05 * noise.noise(p * 30 + _NOFF)
        return g

    zrows = [r[0] for r in HEAD_TABLE if r[0] < HEAD_SKIN_TOP - 0.01] + [HEAD_SKIN_TOP]
    rings = [[head_point(th, z) for th in HEAD_TH] for z in zrows]
    mb.loft(rings, 'skin', wfn, cfn, cap0=HEAD_C + V((0, 0.032, -0.118)),
            cap1=HEAD_C + V((0, 0.012, HEAD_SKIN_TOP + 0.01)))
    # short-cropped hair: a thin cap whose lower edge follows a smooth hairline
    hrings = []
    for k in range(4):
        ring = []
        for th in HEAD_TH:
            z0 = hair_z(th)
            z = lerp(z0, 0.103, (k / 3) ** 1.3)
            ring.append(head_point(th, z, 0.0035 if k else 0.0015))
        hrings.append(ring)
    mb.loft(hrings, 'hair', wfn, lambda p: 0.85, cap1=HEAD_C + V((0, 0.012, 0.115)))

    # nose: rings from bridge to tip (z_rel), (half width, protrusion)
    nose = [(0.006, 0.006, 0.004), (-0.008, 0.008, 0.010), (-0.024, 0.011, 0.020),
            (-0.037, 0.016, 0.027), (-0.045, 0.017, 0.016), (-0.050, 0.012, 0.004)]
    nrings = []
    for zr, hw, pr in nose:
        yf = head_front_y(0.0, zr)
        yfs = head_front_y(hw, zr)
        ring = [V((hw, yfs + 0.004, 0)), V((hw * 0.75, yf - pr * 0.55, 0)), V((0, yf - pr, 0)),
                V((-hw * 0.75, yf - pr * 0.55, 0)), V((-hw, yfs + 0.004, 0)), V((0, yf + 0.010, 0))]
        nrings.append([HEAD_C + V((p.x, p.y - HEAD_C.y, zr)) for p in ring])
    # rings run clockwise seen from above = CCW seen along the travel (-z)
    mb.loft(nrings, 'skin', wfn,
            lambda p: 0.92 if p.z < HEAD_C.z - 0.044 else 1.0, cap0=True, cap1=True)

    # ears
    for side in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=7, v_segments=4, radius=1.0)
        for v in bm.verts:
            v.co = V((v.co.x * 0.011, v.co.y * 0.019, v.co.z * 0.032))
            if v.co.x > 0.003:                       # cupped outer face
                v.co.x -= 0.004
        bm.verts.index_update()
        m = (Matrix.Translation(HEAD_C + V((side * 0.084, 0.016, -0.017))) @
             Matrix.Rotation(rad(-24 * side), 4, 'Z') @ Matrix.Rotation(rad(-12), 4, 'X') @
             Matrix.Scale(side, 4, V((1, 0, 0))))
        ec = HEAD_C + V((side * 0.084, 0.016, -0.017))
        mb.add_bmesh(bm, m, 'skin', wfn, lambda p: 0.62 + 0.3 * smoothstep(0.004, 0.016, (p - ec).length),
                     smooth=True, flip=(side < 0))

    # eyebrows
    for side in (1, -1):
        pts = []
        for a in (9, 19, 29, 38):
            th = rad(a * side)
            zr = 0.016 + 0.0025 * math.sin(rad((a - 9) * 6))
            pts.append(head_point(th, zr, 0.0025))
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, 3)] - pts[max(i - 1, 0)]).normalized()
            out = (p - HEAD_C)
            out.z = 0
            out.normalize()
            up = V((0, 0, 1))
            hw = 0.0035 if i in (1, 2) else 0.0025
            ring = [p + up * hw - out * 0.002, p + up * hw + out * 0.0025,
                    p - up * hw + out * 0.0025, p - up * hw - out * 0.002]
            rings.append(ring)
        if side < 0:
            rings = [list(reversed(r)) for r in rings]
        mb.loft(rings, 'hair', wfn, cap0=True, cap1=True, smooth=False)


# ==========================================================================
# Hands — built in a canonical frame (u: wrist->knuckles, v: palm normal,
# w = u x v: thumb side of the RIGHT hand). Gripping pose around a bar of
# radius ~0.018 whose axis is parallel to w through GRIP_UVW.

GRIP_UVW = V((0.068, 0.032, 0.0))


def hand_frame(side):
    """Rest-pose canonical frame (origin wrist, U, V, W) in armature space."""
    mir = (lambda v: v) if side == 'l' else _mx
    U = mir(_FA)
    Vp = mir(V((-1.0, 0.25, -0.15)))                 # palm faces the thigh, a bit back
    Vp = (Vp - U * Vp.dot(U)).normalized()
    W = U.cross(Vp)
    return mir(WRIST_L), U, Vp, W


def hand_to_world(side):
    o, U, Vp, W = hand_frame(side)
    M = Matrix.Identity(4)
    for r in range(3):
        M[r][0], M[r][1], M[r][2], M[r][3] = U[r], Vp[r], W[r], o[r]
    return M


def build_hand(mb, side, mat='skin'):
    wfn = w_rigid('hand_' + side)
    M = hand_to_world(side)
    flip = (side == 'l')              # thumb on -w for the left hand: mirror w
    sw = -1.0 if side == 'l' else 1.0

    def P(u, v, w):
        return M @ V((u, v, w * sw))

    cfn = lambda p: 0.95
    # palm block: rings along u, rounded rects in (v, w)
    prof = [(-0.034, 0.024, 0.021, 0.0), (0.0, 0.027, 0.019, 0.0), (0.03, 0.037, 0.016, 0.002),
            (0.062, 0.042, 0.015, 0.002), (0.088, 0.042, 0.013, -0.001)]
    rings = []
    seg = 8
    for u, hw, hv, vc in prof:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg + math.pi / seg
            c, s_ = math.cos(a), math.sin(a)
            ww = math.copysign(abs(c) ** 0.7, c) * hw
            vv = vc + math.copysign(abs(s_) ** 0.8, s_) * hv
            if s_ > 0 and c > 0.3 and 0.0 < u < 0.07:      # thenar bulge (palm, thumb side)
                vv += 0.006 * s_
            ring.append(P(u, vv, ww))
        rings.append(ring)
    # (w = cos, v = sin) runs clockwise about +u (w = u x v): flip for the right hand
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=True, flip=not flip)

    # four fingers as one curled slab around the grip bar
    pts = [V((0.086, -0.002, 0)), V((0.096, 0.018, 0)), V((0.097, 0.039, 0)), V((0.088, 0.059, 0)),
           V((0.069, 0.066, 0)), V((0.050, 0.053, 0))]
    widths = [0.040, 0.040, 0.039, 0.037, 0.035, 0.033]
    thick = [0.011, 0.0105, 0.010, 0.0095, 0.009, 0.0085]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, 5)] - pts[max(i - 1, 0)]).normalized()
        ring = ring_around(p + V((0, 0, -0.002)), t, 0, 8, ref=V((0, 0, 1)), rx=widths[i], ry=thick[i],
                           shape=lambda a: 1.0 - 0.12 * abs(math.sin(a)) ** 6)
        rings.append([P(q.x, q.y, q.z) for q in ring])
    tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.006
    mb.loft(rings, mat, wfn, lambda p: 0.9, cap0=True, cap1=P(tip.x, tip.y, tip.z - 0.002), flip=flip)

    # thumb: from the thenar over the bar
    tp = [V((0.012, 0.010, 0.026)), V((0.036, 0.026, 0.042)), V((0.062, 0.050, 0.038)),
          V((0.082, 0.064, 0.016))]
    rings = []
    for i, p in enumerate(tp):
        t = (tp[min(i + 1, 3)] - tp[max(i - 1, 0)]).normalized()
        rr = [0.014, 0.0115, 0.010, 0.0088][i]
        ring = ring_around(p, t, rr, 5, ref=V((0, 1, 0)))
        rings.append([P(q.x, q.y, q.z) for q in ring])
    tip = tp[-1] + (tp[-1] - tp[-2]).normalized() * 0.007
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=P(tip.x, tip.y, tip.z), flip=flip)


def grip_frame_world(side):
    """Rest-pose grip frame (armature space): origin at the grip centre,
    Y = pinky->thumb along the gripped bar, Z = back of the hand (dorsal)."""
    M = hand_to_world(side)
    sw = -1.0 if side == 'l' else 1.0
    gu = grip_uvw(side)
    o = M @ V((gu.x, gu.y, gu.z * sw))
    R = M.to_3x3()
    U, Vp, W = R.col[0], R.col[1], R.col[2]
    Y = W * sw
    Z = -Vp
    X = Y.cross(Z)
    G = Matrix.Identity(4)
    for r in range(3):
        G[r][0], G[r][1], G[r][2], G[r][3] = X[r], Y[r], Z[r], o[r]
    return G


def axes_matrix(X, Y, Z, o=V((0, 0, 0))):
    M = Matrix.Identity(4)
    for r in range(3):
        M[r][0], M[r][1], M[r][2], M[r][3] = X[r], Y[r], Z[r], o[r]
    return M


# ==========================================================================
# Feet

def foot_rings(stations, seg=10, n=2.6, xc=0.102, mirror=False):
    rings = []
    for y, hw, top, bot, xo in stations:
        zc, hh = (top + bot) / 2, (top - bot) / 2
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            c, s = math.cos(a), math.sin(a)
            x = xc + xo + math.copysign(abs(c) ** (2 / n), c) * hw
            e = 2 / n if s > 0 else 2 / 4.0          # flatter sole
            z = zc + math.copysign(abs(s) ** e, s) * hh
            ring.append(V((x, y, z)))
        rings.append(ring)
    if mirror:
        rings = [[_mx(p) for p in r] for r in rings]
    return rings


SHOE = [  # y, half width, top z, bottom z, x offset   (left foot, heel -> toe)
    (0.078, 0.026, 0.060, 0.010, 0.000),
    (0.068, 0.037, 0.105, 0.000, 0.000),
    (0.045, 0.041, 0.132, 0.000, 0.000),
    (0.005, 0.043, 0.134, 0.000, -0.002),
    (-0.040, 0.046, 0.112, 0.000, -0.004),
    (-0.090, 0.050, 0.083, 0.000, -0.005),
    (-0.140, 0.051, 0.066, 0.000, -0.004),
    (-0.180, 0.046, 0.057, 0.003, -0.002),
    (-0.205, 0.036, 0.048, 0.009, 0.000),
    (-0.217, 0.020, 0.038, 0.017, 0.000),
]

HEEL_PT = V((0.102, 0.078, 0.0))     # rest sole points of the left foot
TOE_PT = V((0.102, -0.205, 0.0))


def build_shoe(mb, side, mat, stations=SHOE, top_cut=None):
    st = list(stations)
    if top_cut is not None:
        st = [(y, hw, min(t, top_cut), b, xo) for y, hw, t, b, xo in st]
    rings = foot_rings(st, mirror=(side == 'r'))
    # rings run heel -> toe (travel -Y); ring param CCW seen from -Y needs flip for left
    mb.loft(rings, mat, w_rigid('foot_' + side), c_cloth(0.9, 0.3), cap0=True, cap1=True,
            flip=(side == 'r'))


# ==========================================================================
# Things that sit on the torso surface

def surf_strip(mb, sec, path, width, thick, mat, wfn, cfn=None, base=0.001, smooth=False):
    """A flat strap following (theta, z) points on a Section surface."""
    pts = [sec.surf(th, z, base) for th, z in path]
    nrm = [sec.normal(th, z) for th, z in path]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = nrm[i]
        s = n.cross(t).normalized() * (width / 2)
        o = n * thick
        rings.append([p - s, p + s, p + s + o, p - s + o])
    # s = n x t makes (s, n, t) right-handed: -s -> +s -> +s+n is CCW about t.
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=True, smooth=smooth)


def surf_patch(mb, sec, th0, th1, z0, z1, thick, mat, wfn, cfn=None, nth=4, nz=2, base=-0.002,
               bulge=0.0, smooth=False):
    """A conforming slab (pocket, pouch) between theta th0..th1 and z0..z1."""
    rings = []
    for k in range(nz + 1):
        z = lerp(z0, z1, k / nz)
        outer, inner = [], []
        for i in range(nth + 1):
            th = lerp(th0, th1, i / nth)
            b = bulge * math.sin(math.pi * i / nth) * math.sin(math.pi * (0.3 + 0.7 * k / nz))
            outer.append(sec.surf(th, z, thick + b))
            inner.append(sec.surf(th, z, base))
        rings.append(outer + list(reversed(inner)))
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=True, smooth=smooth)


def surf_band(mb, sec, z0, z1, off_in, off_out, seg, mat, wfn, cfn=None, th_range=None, smooth=False, zfn=None):
    """A belt / collar band all around (or over th_range); zfn(th) shifts it
    vertically (a belt sagging under its load)."""
    def ring(z, off):
        if th_range:
            a0, a1 = th_range
            return [sec.surf(lerp(a0, a1, i / seg), z + (zfn(lerp(a0, a1, i / seg)) if zfn else 0.0), off)
                    for i in range(seg + 1)]
        if zfn:
            return [sec.surf(2 * math.pi * i / seg, z + zfn(2 * math.pi * i / seg), off) for i in range(seg)]
        return sec.ring(z, seg, off)
    prof = [(z0, off_out), (z1, off_out), (z1, off_in), (z0, off_in), (z0, off_out)]
    rings = [ring(z, o) for z, o in prof]
    mb.loft(rings, mat, wfn, cfn, closed=th_range is None, smooth=smooth)


def oriented_box(mb, sec, th, z, size, lift, mat, wfn, cfn=None, bevel=0.006, tilt=0.0, yaw=0.0, segs=1):
    """A box sitting on the surface at (th, z): size = (along tangent, out, up)."""
    p = sec.point(th, z)
    n = sec.normal(th, z)
    up = V((0, 0, 1))
    side = up.cross(n).normalized()
    upv = n.cross(side).normalized()
    R = axes_matrix(side, -n, upv).to_3x3()       # local X along surface, -Y outward, Z up
    R = R @ Matrix.Rotation(rad(tilt), 3, 'X') @ Matrix.Rotation(rad(yaw), 3, 'Z')
    c = p + n * (lift + size[1] / 2)
    mb.box(c, (size[0], size[1], size[2]), mat, wfn, rot=R, cfn=cfn, bevel=bevel, segs=segs)
    return c, R


def lathe_axis(mb, a, b, prof, seg, mat, wfn, cfn=None, ref=None, smooth=True):
    """Revolve rows (t in 0..1 along a->b, radius) around the axis a->b."""
    d = b - a
    rings = [ring_around(a + d * t, d, r, seg, ref) for t, r in prof]
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=True, smooth=smooth)


# ==========================================================================
# Helmets (rigid on the head)

def build_m1_helmet(mb, mat='helmet_od', strap='webbing'):
    wfn = w_rigid('head')
    c = HEAD_C + V((0, 0.004, 0))
    seg = 20
    a_len, a_wid = 0.143, 0.121
    z_top = c.z + 0.140

    def rim_z(th):
        cth = math.cos(th)
        return c.z + 0.012 + 0.016 * cth - 0.012 * (1 - abs(math.sin(th))) * (cth < 0)

    def rim_xy(th, k=1.0):
        s, cth = math.sin(th), math.cos(th)
        e = 2 / 2.3
        return (math.copysign(abs(s) ** e, s) * a_wid * k, -math.copysign(abs(cth) ** e, cth) * a_len * k)

    rings = []
    # lip (rolled edge) -> shell up to the crown
    for t in (-0.06, 0.0, 0.18, 0.40, 0.60, 0.76, 0.88, 0.96):
        ring = []
        for i in range(seg):
            th = 2 * math.pi * i / seg
            z0 = rim_z(th)
            if t < 0:
                x, y = rim_xy(th, 1.05)
                ring.append(V((c.x + x, c.y + y, z0 - 0.003)))
                continue
            psi = t * math.pi / 2
            k = math.cos(psi) ** 0.8
            x, y = rim_xy(th, k)
            z = z0 + (z_top - z0) * math.sin(psi) ** 1.15
            ring.append(V((c.x + x, c.y + y, z)))
        rings.append(ring)
    # inner rim (gives the shell thickness), facing in
    inner = []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        x, y = rim_xy(th, 0.95)
        inner.append(V((c.x + x, c.y + y, rim_z(th) + 0.02)))
    cfn = lambda p: 0.85 + 0.15 * smoothstep(c.z, c.z + 0.08, p.z)
    mb.loft([inner] + rings, mat, wfn, cfn, cap0=V((c.x, c.y, c.z + 0.05)), cap1=V((c.x, c.y, z_top + 0.002)))
    # chin strap: from the bales behind the jaw, under the chin
    for side in (1, -1):
        path = [V((side * 0.106, 0.012, 0.006)), V((side * 0.082, 0.004, -0.040)),
                V((side * 0.064, -0.012, -0.080)), V((side * 0.040, -0.044, -0.110)),
                V((side * 0.010, -0.064, -0.122))]
        pts = [HEAD_C + p for p in path]
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, 4)] - pts[max(i - 1, 0)]).normalized()
            out = (p - HEAD_C)
            out = (out - t * out.dot(t)).normalized()
            s = out.cross(t).normalized() * 0.008
            o = out * 0.003
            rings.append([p - s, p + s, p + s + o, p - s + o])
        mb.loft(rings, strap, wfn, None, cap0=True, cap1=True, smooth=False)


def build_stahlhelm(mb, mat='helmet_gray', strap='leather_black'):
    """M40 Stahlhelm: low dome, a crease ("step") at the temples, then a skirt
    flaring out over the ears and the nape and a short visor over the eyes."""
    wfn = w_rigid('head')
    c = HEAD_C + V((0, 0.012, 0))
    seg = 22
    z_top = c.z + 0.132

    def ang(th):
        a = abs(math.degrees(th)) % 360
        return 360 - a if a > 180 else a

    def step_z(th):
        a = ang(th)
        return c.z + lerp(0.042, 0.026, smoothstep(0, 85, a)) - 0.016 * smoothstep(95, 175, a)

    def drop(th):
        a = ang(th)
        return lerp(0.020, 0.066, smoothstep(12, 80, a)) + 0.020 * smoothstep(100, 170, a)

    def flare(th):
        a = ang(th)
        return lerp(0.036, 0.030, smoothstep(0, 70, a)) + 0.022 * smoothstep(100, 172, a)

    def dome_xy(th, k):
        s_, cth = math.sin(th), math.cos(th)
        e = 2 / 2.4
        return V((math.copysign(abs(s_) ** e, s_) * 0.111 * k,
                  -math.copysign(abs(cth) ** e, cth) * (0.126 if cth > 0 else 0.123) * k, 0))

    def out_dir(th):
        return V((math.sin(th), -math.cos(th), 0))

    def skirt_pt(th, t):
        zs = step_z(th)
        base = dome_xy(th, 1.0)
        # concave flare: little at first, most near the rim
        f = 0.006 + flare(th) * (0.35 * t + 0.65 * t ** 2.2)
        p = base + out_dir(th) * f
        return V((c.x + p.x, c.y + p.y, zs - drop(th) * t))

    rings = []
    rings.append([skirt_pt(2 * math.pi * i / seg, 1.0) + V((0, 0, -0.003)) for i in range(seg)])
    for t in (0.75, 0.4, 0.12):
        rings.append([skirt_pt(2 * math.pi * i / seg, t) for i in range(seg)])
    for t in (0.0, 0.22, 0.45, 0.66, 0.82, 0.94):
        ring = []
        for i in range(seg):
            th = 2 * math.pi * i / seg
            zs = step_z(th)
            psi = t * math.pi / 2
            k = math.cos(psi) ** 0.62
            pp = dome_xy(th, k)
            z = zs + 0.004 + (z_top - zs) * math.sin(psi) ** 1.05
            ring.append(V((c.x + pp.x, c.y + pp.y, z)))
        rings.append(ring)
    inner = []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        q = skirt_pt(th, 0.55) - out_dir(th) * 0.012
        inner.append(q)
    cfn = lambda p: 0.85 + 0.15 * smoothstep(c.z - 0.04, c.z + 0.08, p.z)
    mb.loft([inner] + rings, mat, wfn, cfn, cap0=V((c.x, c.y, c.z + 0.03)), cap1=V((c.x, c.y, z_top + 0.002)))
    # vent lugs
    for side in (1, -1):
        p = c + V((side * 0.104, 0.004, 0.060))
        mb.cylinder(p, p + V((side * 0.007, 0, 0.002)), 0.0065, mat, wfn, seg=6)
    # chin strap
    for side in (1, -1):
        path = [V((side * 0.100, 0.012, -0.030)), V((side * 0.078, 0.004, -0.070)),
                V((side * 0.050, -0.035, -0.110)), V((side * 0.012, -0.058, -0.124))]
        pts = [HEAD_C + p for p in path]
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, 3)] - pts[max(i - 1, 0)]).normalized()
            out = (p - HEAD_C)
            out = (out - t * out.dot(t)).normalized()
            s = out.cross(t).normalized() * 0.006
            o = out * 0.003
            rings.append([p - s, p + s, p + s + o, p - s + o])
        mb.loft(rings, strap, wfn, None, cap0=True, cap1=True, smooth=False)


# ==========================================================================
# Outfits

def hair_z(th):
    """z_rel of the hairline at azimuth th (smooth)."""
    a = abs(math.degrees(th)) % 360
    if a > 180:
        a = 360 - a
    z = 0.060 - 0.040 * smoothstep(35, 75, a)            # temples
    z += 0.016 * _g(a, 84, 10)                           # up and over the ear
    z -= 0.072 * smoothstep(100, 165, a)                 # down to the nape
    return z


def hair_line(th, zr):
    return zr > hair_z(th)


ARM_PROFILE = [
    (0.00, 0.062, 0.062), (0.12, 0.055, 0.053), (0.21, 0.050, 0.048),
    (0.27, 0.047, 0.046), (0.31, 0.047, 0.046, 0.002), (0.36, 0.049, 0.047), (0.45, 0.044, 0.042),
    (0.532, 0.042, 0.040),
]


def arm_points(side):
    mir = (lambda v: v) if side == 'l' else _mx
    return [mir(SHOULDER_L), mir(ELBOW_L), mir(WRIST_L)]


def leg_points(side):
    mir = (lambda v: v) if side == 'l' else _mx
    return [mir(HIP_L), mir(KNEE_L), mir(ANKLE_L)]


def build_body_common(mb, sleeve_mat, cuff=None):
    """Head, neck, hands, sleeves (shared proportions)."""
    mb.part('head')
    build_head(mb, hair_line)
    mb.part('neck')
    np_ = [V((0, 0.040, 1.395)), V((0, 0.036, 1.46)), V((0, 0.028, 1.53)), V((0, 0.024, 1.588))]
    rings = [ring_around(p, V((0, -0.08, 1.0)).normalized(), 0, 10, FWD, rx=0.052, ry=0.057) for p in np_]
    mb.loft(rings, 'skin', w_neck, lambda p: 0.9 if p.z < 1.52 else 1.0, cap0=True, cap1=True)
    mb.part('hands')
    for s in ('l', 'r'):
        build_hand(mb, s)
    mb.part('sleeves')
    for s in ('l', 'r'):
        limb(mb, arm_points('l'), ARM_PROFILE, 10, sleeve_mat, w_arm(s), c_cloth(1.0, 0, ao=ao_body),
             ball=0.062, lip=(0.034, 0.02), mirror=(s == 'r'))


def build_allied(rig):
    mb = MeshBuilder()
    sec = Section(TORSO_JACKET)
    wt = w_torso(skirt=0.5)
    cf = c_cloth(1.0, 0.0, ao=ao_body)
    build_body_common(mb, 'cloth_khaki')

    mb.part('jacket')
    zs = [r[0] for r in TORSO_JACKET]
    seg = 20

    def jm(k, i):
        z = 0.5 * (zs[k] + zs[k + 1])
        th = 2 * math.pi * (i + 0.5) / seg
        a = math.degrees(th)
        if z > 1.452 and (a < 19 or a > 341):
            return 'cloth_od'       # wool shirt in the open collar
        return 'cloth_khaki'
    rings = [sec.ring(z, seg) for z in zs]
    # turned-in hem
    hem = sec.ring(zs[0], seg, -0.008)
    hem2 = sec.ring(zs[0] + 0.03, seg, -0.010)
    rings = [hem2, hem] + rings
    zs_m = [zs[0] + 0.03, zs[0]] + zs

    def jm2(k, i):
        if k < 2:
            return 'cloth_khaki'
        return jm(k - 2, i)
    mb.loft(rings, 'cloth_khaki', wt, cf, cap1=V((0, 0.032, 1.49)), mats=jm2)
    # placket, slash pockets, epaulettes
    surf_strip(mb, sec, [(0.0, z) for z in (0.80, 0.95, 1.10, 1.25, 1.38, 1.44)], 0.032, 0.004,
               'cloth_khaki', wt, cf)
    for sd in (1, -1):
        surf_strip(mb, sec, [(sd * rad(26), 0.99), (sd * rad(36), 0.94), (sd * rad(46), 0.885)],
                   0.026, 0.004, 'cloth_khaki', wt, cf)
        surf_strip(mb, sec, [(sd * rad(90), z) for z in (1.476, 1.462, 1.448, 1.432, 1.414)],
                   0.045, 0.004, 'cloth_khaki', wt, cf)
    mb.part('collar')
    # shirt collar band and the jacket's laid-down collar
    neck_sec = Section([(1.44, 0.060, 0.058, 0.060, 0.034, 2.2), (1.53, 0.058, 0.057, 0.058, 0.026, 2.2)])
    surf_band(mb, neck_sec, 1.452, 1.505, -0.004, 0.006, 12, 'cloth_od', w_neck)
    coll = Section([(1.44, 0.090, 0.075, 0.080, 0.034, 2.3), (1.475, 0.072, 0.064, 0.066, 0.032, 2.2),
                    (1.50, 0.066, 0.062, 0.064, 0.030, 2.2)])
    surf_band(mb, coll, 1.455, 1.495, -0.006, 0.006, 12, 'cloth_khaki', wt, cf,
              th_range=(rad(28), rad(332)))

    mb.part('trousers')
    zp = [r[0] for r in PELVIS]
    mb.loft([Section(PELVIS).ring(z, 12) for z in zp], 'cloth_od', w_pelvis, cf, cap0=True, cap1=True)
    LEG = [(0.00, 0.090, 0.090), (0.14, 0.087, 0.084), (0.26, 0.079, 0.075),
           (0.37, 0.067, 0.063), (0.42, 0.063, 0.060, 0.004), (0.47, 0.062, 0.060),
           (0.505, 0.067, 0.065, -0.004), (0.535, 0.068, 0.066, -0.004), (0.555, 0.057, 0.055),
           (0.585, 0.051, 0.049), (0.61, 0.047, 0.045)]
    for s in ('l', 'r'):
        limb(mb, leg_points('l'), LEG, 10, 'cloth_od', w_leg(s), c_cloth(1.0, 0.3, ao=ao_body),
             ball=0.090, mirror=(s == 'r'))

    mb.part('leggings')
    for s in ('l', 'r'):
        mir = (lambda v: v) if s == 'l' else _mx
        rows = [(0.068, 0.058, 0.080, 0.006), (0.10, 0.056, 0.072, 0.008), (0.16, 0.054, 0.060, 0.012),
                (0.23, 0.058, 0.060, 0.012), (0.30, 0.063, 0.064, 0.008), (0.345, 0.066, 0.067, 0.004)]
        rings = []
        for z, rx, ry, yc in rows:
            c = V((0.100, yc, z))
            rings.append(ring_around(c, UP, 0, 10, V((1, 0, 0)), rx=rx, ry=ry))
        top_in = ring_around(V((0.100, 0.004, 0.345)), UP, 0, 10, V((1, 0, 0)), rx=0.059, ry=0.060)
        rings.append(top_in)
        rings = [[mir(p) for p in r] for r in rings]
        mb.loft(rings, 'webbing', w_leg(s, 0.03), c_cloth(1.0, 0.35), cap0=False, cap1=True, flip=(s == 'r'))
        # lace/hook ridge on the outside
        sec_l = Section([(r[0], r[1], r[2], r[2], r[3], 2.0) for r in rows], cx=0.100)
        th = rad(90) if s == 'l' else rad(270)
        surf_strip(mb, sec_l if s == 'l' else _MirSec(sec_l), [(th, z) for z in (0.075, 0.15, 0.24, 0.335)],
                   0.016, 0.006, 'webbing', w_leg(s, 0.03), c_cloth(0.85, 0.3))
    mb.part('boots')
    for s in ('l', 'r'):
        build_shoe(mb, s, 'leather')

    mb.part('helmet')
    build_m1_helmet(mb)

    mb.part('webbing')
    wh = w_rigid('hips')
    surf_band(mb, sec, 0.965, 1.035, -0.004, 0.010, 20, 'webbing', wh, c_cloth(0.95, 0))
    # belt plate
    oriented_box(mb, sec, 0.0, 1.0, (0.05, 0.010, 0.050), 0.010, 'helmet_od', wh, bevel=0.003)
    # ten rifle pockets
    for sd in (1, -1):
        for k in range(5):
            th = sd * rad(22 + 15.5 * k)
            w = rad(6.6)
            surf_patch(mb, sec, th - w, th + w, 0.93, 1.042, 0.040, 'webbing', wh, c_cloth(0.9, 0),
                       nth=2, nz=2, bulge=0.006)
    # suspenders
    for sd in (1, -1):
        path = [(30, 1.03), (29, 1.15), (30, 1.28), (40, 1.38), (60, 1.44), (90, 1.462), (120, 1.44),
                (140, 1.38), (150, 1.28), (155, 1.15), (158, 1.03)]
        surf_strip(mb, sec, [(sd * rad(a), z) for a, z in path], 0.035, 0.004, 'webbing', wt,
                   c_cloth(0.95, 0))
    # small pack (haversack) with the entrenching tool strapped on
    wc = w_rigid('chest')
    c, R = oriented_box(mb, sec, math.pi, 1.27, (0.27, 0.10, 0.30), 0.005, 'cloth_od_dark', wc,
                        bevel=0.02, tilt=-4)
    out = -R.col[1]
    mb.box(c + out * 0.052 + V((0, 0, 0.11)), (0.27, 0.016, 0.10), 'cloth_od_dark', wc, rot=R, bevel=0.006)
    for sx in (-0.07, 0.07):
        mb.box(c + out * 0.053 + R.col[0] * sx, (0.028, 0.012, 0.31), 'webbing', wc, rot=R)
    # e-tool carrier and handle
    ec = c + out * 0.07 + V((0, 0, -0.02))
    mb.box(ec, (0.16, 0.035, 0.21), 'cloth_od_dark', wc, rot=R, bevel=0.008)
    mb.cylinder(ec + V((0, 0, -0.10)), ec + V((0, 0, -0.30)), 0.017, 'wood', wc, seg=6)
    # canteen on the right hip
    c2, R2 = oriented_box(mb, sec, rad(-140), 0.93, (0.15, 0.075, 0.18), 0.012, 'cloth_od_dark', wh,
                          bevel=0.025)
    mb.box(c2 + V((0, 0, 0.10)), (0.05, 0.03, 0.03), 'webbing', wh, rot=R2)
    # first aid pouch at the front left
    oriented_box(mb, sec, rad(-9), 0.945, (0.07, 0.035, 0.08), 0.012, 'webbing', wh, bevel=0.008)

    obj = mb.build('allied', rig)
    return obj, mb.parts


class _MirSec:
    """Mirror a Section in x (for right-side features)."""
    def __init__(self, sec):
        self.sec = sec

    def point(self, th, z, off=0.0):
        return _mx(self.sec.point(-th, z, off))

    def normal(self, th, z):
        return _mx(self.sec.normal(-th, z))

    def surf(self, th, z, off=0.0):
        return _mx(self.sec.surf(-th, z, off))


def build_axis(rig):
    mb = MeshBuilder()
    sec = Section(TORSO_JACKET)
    wt = w_torso(skirt=0.5)
    cf = c_cloth(1.0, 0.0, ao=ao_body)
    build_body_common(mb, 'cloth_feldgrau')

    mb.part('tunic')
    zs = [r[0] for r in TORSO_JACKET]
    seg = 20
    rings = [sec.ring(z, seg) for z in zs]
    hem = sec.ring(zs[0], seg, -0.008)
    hem2 = sec.ring(zs[0] + 0.03, seg, -0.010)
    mb.loft([hem2, hem] + rings, 'cloth_feldgrau', wt, cf, cap1=V((0, 0.032, 1.49)))
    surf_strip(mb, sec, [(0.0, z) for z in (0.80, 0.95, 1.10, 1.25, 1.38, 1.46)], 0.030, 0.004,
               'cloth_feldgrau', wt, cf)
    # buttons
    for z in (1.40, 1.31, 1.215, 1.12, 0.93):
        oriented_box(mb, sec, 0.0, z, (0.013, 0.006, 0.013), 0.004, 'helmet_gray', wt, bevel=0)
    # four pockets with flaps
    for sd in (1, -1):
        for (a0, a1, z0, z1) in ((10, 38, 1.215, 1.325), (13, 44, 0.84, 0.965)):
            t0, t1 = sd * rad(a0), sd * rad(a1)
            if sd < 0:
                t0, t1 = t1, t0
            surf_patch(mb, sec, t0, t1, z0, z1, 0.010, 'cloth_feldgrau', wt, cf, nth=2, nz=1, bulge=0.004)
            surf_patch(mb, sec, t0 - rad(1), t1 + rad(1), z1 - 0.032, z1 + 0.006, 0.015, 'cloth_feldgrau',
                       wt, c_cloth(0.9, 0), nth=2, nz=1)
        # shoulder boards
        surf_strip(mb, sec, [(sd * rad(90), z) for z in (1.476, 1.462, 1.448, 1.432, 1.414)],
                   0.042, 0.005, 'cloth_feldgrau_dark', wt, cf)
    mb.part('collar')
    coll = Section([(1.44, 0.064, 0.062, 0.064, 0.034, 2.2), (1.53, 0.062, 0.060, 0.062, 0.026, 2.2)])
    surf_band(mb, coll, 1.452, 1.522, -0.002, 0.010, 14, 'cloth_feldgrau_dark', w_neck, cf)

    mb.part('trousers')
    zp = [r[0] for r in PELVIS]
    mb.loft([Section(PELVIS).ring(z, 12) for z in zp], 'cloth_feldgrau_dark', w_pelvis, cf,
            cap0=True, cap1=True)
    LEG = [(0.00, 0.090, 0.090), (0.14, 0.087, 0.084), (0.26, 0.079, 0.075),
           (0.37, 0.067, 0.063), (0.42, 0.064, 0.060, 0.004), (0.46, 0.066, 0.064),
           (0.49, 0.072, 0.070, -0.004), (0.512, 0.071, 0.069, -0.004), (0.53, 0.057, 0.055),
           (0.55, 0.050, 0.048)]
    for s in ('l', 'r'):
        limb(mb, leg_points('l'), LEG, 10, 'cloth_feldgrau_dark', w_leg(s), c_cloth(1.0, 0.3, ao=ao_body),
             ball=0.090, mirror=(s == 'r'))

    mb.part('boots')
    for s in ('l', 'r'):
        mir = (lambda v: v) if s == 'l' else _mx
        build_shoe(mb, s, 'leather_black', top_cut=0.10, stations=[SHOE[i] for i in (0, 1, 3, 4, 5, 6, 8, 9)])
        rows = [(0.055, 0.050, 0.074, 0.012), (0.13, 0.048, 0.060, 0.012), (0.24, 0.055, 0.057, 0.005),
                (0.385, 0.066, 0.067, -0.004)]
        rings = []
        for z, rx, ry, yc in rows:
            rings.append(ring_around(V((0.100, yc, z)), UP, 0, 10, V((1, 0, 0)), rx=rx, ry=ry))
        rings.append(ring_around(V((0.100, -0.004, 0.385)), UP, 0, 10, V((1, 0, 0)), rx=0.060, ry=0.061))
        rings.append(ring_around(V((0.100, -0.004, 0.355)), UP, 0, 10, V((1, 0, 0)), rx=0.057, ry=0.058))
        rings = [[mir(p) for p in r] for r in rings]
        mb.loft(rings, 'leather_black', w_leg(s, 0.03), c_cloth(0.95, 0.3), cap0=False, cap1=True,
                flip=(s == 'r'))

    mb.part('helmet')
    build_stahlhelm(mb)

    mb.part('kit')
    wh = w_rigid('hips')
    surf_band(mb, sec, 1.00, 1.05, -0.004, 0.009, 18, 'leather_black', wh, c_cloth(1.0, 0))
    oriented_box(mb, sec, 0.0, 1.025, (0.065, 0.008, 0.052), 0.009, 'helmet_gray', wh, bevel=0)
    # two three-cell rifle pouches
    for sd in (1, -1):
        for k in range(3):
            a = 14 + 11.5 * k
            t0, t1 = sd * rad(a), sd * rad(a + 10.5)
            if sd < 0:
                t0, t1 = t1, t0
            surf_patch(mb, sec, t0, t1, 0.965, 1.060, 0.040, 'leather_black', wh, c_cloth(0.95, 0),
                       nth=2, nz=1, bulge=0.004)
        t0, t1 = sd * rad(13), sd * rad(48)
        if sd < 0:
            t0, t1 = t1, t0
        surf_patch(mb, sec, t0, t1, 1.035, 1.072, 0.046, 'leather_black', wh, c_cloth(0.9, 0), nth=6, nz=1)
    # Y-straps
    for sd in (1, -1):
        path = [(33, 1.05), (32, 1.18), (34, 1.30), (46, 1.39), (66, 1.445), (90, 1.462), (115, 1.44),
                (140, 1.37), (162, 1.29), (178, 1.23)]
        surf_strip(mb, sec, [(sd * rad(a), z) for a, z in path], 0.032, 0.004, 'leather_black', wt,
                   c_cloth(1.0, 0))
    surf_strip(mb, sec, [(math.pi, z) for z in (1.245, 1.15, 1.05)], 0.034, 0.004, 'leather_black', wt,
               c_cloth(1.0, 0))
    # bread bag (right hip, behind) with the canteen
    c, R = oriented_box(mb, sec, rad(-128), 0.90, (0.25, 0.075, 0.19), 0.012, 'canvas', wh, bevel=0.02)
    out = -R.col[1]
    mb.box(c + out * 0.04 + V((0, 0, 0.055)), (0.25, 0.014, 0.10), 'canvas', wh, rot=R, bevel=0.006)
    cc = c + out * 0.085 + R.col[0] * 0.05 + V((0, 0, -0.01))
    mb.box(cc, (0.10, 0.06, 0.16), 'cloth_feldgrau_dark', wh, rot=R, bevel=0.022)
    mb.cylinder(cc + V((0, 0, 0.075)), cc + V((0, 0, 0.11)), 0.032, 'leather_black', wh, seg=8)
    # fluted gas-mask canister across the lower back
    gc = sec.point(rad(188), 0.96) + sec.normal(rad(188), 0.96) * 0.075
    axis = V((-math.cos(rad(32)), 0.0, math.sin(rad(32))))
    a, b = gc - axis * 0.13, gc + axis * 0.13
    prof = [(0.0, 0.046), (0.025, 0.055)]
    for k in range(4):
        t = 0.12 + 0.22 * k
        prof += [(t, 0.051), (t + 0.11, 0.056)]
    prof += [(0.975, 0.055), (1.0, 0.047)]
    lathe_axis(mb, a, b, prof, 8, 'helmet_gray', wh, None, ref=V((0, 1, 0)))
    # entrenching tool and bayonet on the left hip
    c3, R3 = oriented_box(mb, sec, rad(118), 0.92, (0.16, 0.035, 0.21), 0.012, 'leather_black', wh,
                          bevel=0.01, tilt=8)
    hd = c3 + V((0, 0, -0.10))
    mb.cylinder(hd, hd + R3 @ V((0.0, 0.0, -0.20)) + V((0, -0.03, 0)), 0.016, 'wood', wh, seg=6)
    bc = sec.point(rad(102), 0.93) + sec.normal(rad(102), 0.93) * 0.05
    mb.cylinder(bc + V((0, 0.02, 0.05)), bc + V((0, -0.06, -0.24)), 0.013, 'leather_black', wh, seg=6)

    obj = mb.build('axis', rig)
    return obj, mb.parts


# ==========================================================================
# Preview renders (fixed framing, Cycles)

def render_view(objs, path, cam, target, lens=50, size=512, samples=16, floor=True, light=1.0):
    scene = bpy.context.scene
    keep = set(objs)
    for o in objs:
        keep.update(o.children_recursive)
    hidden = []
    for o in scene.objects:
        if o.type in ('MESH', 'EMPTY', 'ARMATURE') and o not in keep and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    cd = bpy.data.cameras.new('pv_cam')
    cd.lens = lens
    camo = kit.link(bpy.data.objects.new('pv_cam', cd))
    camo.location = V(cam)
    camo.rotation_euler = (V(target) - V(cam)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camo
    sd = bpy.data.lights.new('pv_sun', 'SUN')
    sd.energy = 3.2 * light
    sd.angle = rad(10)
    sun = kit.link(bpy.data.objects.new('pv_sun', sd))
    sun.rotation_euler = (rad(48), rad(8), rad(-35))
    fill_d = bpy.data.lights.new('pv_fill', 'SUN')
    fill_d.energy = 0.9 * light
    fill = kit.link(bpy.data.objects.new('pv_fill', fill_d))
    fill.rotation_euler = (rad(60), rad(0), rad(150))
    fl = None
    if floor:
        fl = kit.plane(12, 12, loc=(0, 0, -0.0005), mat='dirt', name='pv_floor')
    world = bpy.data.worlds.get('pv') or bpy.data.worlds.new('pv')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.36, 0.39, 0.43, 1)
    bg.inputs['Strength'].default_value = 0.8 * light
    scene.world = world
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    vt = [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items]
    scene.view_settings.view_transform = 'AgX' if 'AgX' in vt else 'Filmic'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    for o in (camo, sun, fill) + ((fl,) if fl else ()):
        kit.delete(o)
    for o in hidden:
        o.hide_render = False
    return path


# ==========================================================================
# Weapons (v2) — weapon space: origin at the firing hand's grip, barrel
# along -Y, top +Z (the MG 42: origin at the bipod feet centre). Built
# unskinned, then baked (blued steel, walnut, leather, brass, Bakelite).

W0 = lambda p: {}
C1 = lambda p: 1.0


def wloft(mb, stations, mat, seg=16, x=0.0, caps=True, smooth=True, groove=None):
    """Loft along Y through stations (y, half width, z bottom, z top[, n]).
    groove(k, x, z) -> inward offset for finger grooves etc."""
    rings = []
    for k, st in enumerate(stations):
        y, hw, zb, zt = st[:4]
        n = st[4] if len(st) > 4 else 2.6
        zc, hh = (zb + zt) / 2, (zt - zb) / 2
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            c, s_ = math.cos(a), math.sin(a)
            px = math.copysign(abs(c) ** (2 / n), c) * hw
            pz = math.copysign(abs(s_) ** (2 / n), s_) * hh
            if groove:
                d = groove(k, px, pz + zc)
                if d:
                    px -= math.copysign(d, px)
            ring.append(V((x + px, y, zc + pz)))
        rings.append(ring)
    flip = len(stations) > 1 and stations[1][0] > stations[0][0]
    mb.loft(rings, mat, W0, C1, cap0=caps, cap1=caps, smooth=smooth, flip=flip)


def wbox(mb, center, size, mat, bevel=0.0, rot=None, segs=1):
    mb.box(V(center), size, mat, W0, rot=rot, cfn=C1, bevel=bevel, segs=segs)


def wcyl(mb, a, b, r, mat, seg=12, r2=None, cap=True):
    mb.cylinder(V(a), V(b), r, mat, W0, seg=seg, cfn=C1, r2=r2, cap=cap)


def wlathe(mb, a, b, prof, mat, seg=14, ref=None):
    """prof rows: (t 0..1 along a->b, radius)."""
    lathe_axis(mb, V(a), V(b), prof, seg, mat, W0, C1, ref=ref)


def wtube(mb, pts, r, mat, seg=8, cap=True):
    pts = [V(p) for p in pts]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        rings.append(ring_around(p, t, r, seg, V((1, 0, 0)) if abs(t.x) < 0.9 else V((0, 0, 1))))
    mb.loft(rings, mat, W0, C1, cap0=cap, cap1=cap)


def wtorus(mb, c, axis, R_, r, mat, seg=12, tseg=6, arc=1.0, start=0.0):
    """Ring / loop (sling swivel, D-ring) around `axis` through c; a partial
    ring (arc < 1) starts at angle `start` from the frame's n axis."""
    n, b = frame_from(V(axis).normalized())
    pts = []
    m = seg if arc >= 1.0 else seg + 1
    for i in range(m):
        a = start + 2 * math.pi * arc * i / seg
        pts.append(V(c) + (n * math.cos(a) + b * math.sin(a)) * R_)
    if arc >= 1.0:
        pts += pts[:2]
    rings = []
    for i in range(len(pts) - (1 if arc >= 1.0 else 0)):
        p = pts[i]
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        rings.append(ring_around(p, t, r, tseg, V(axis)))
    if arc >= 1.0:
        rings = rings[:seg] + [rings[0]]
    mb.loft(rings, mat, W0, C1, cap0=arc < 1.0, cap1=arc < 1.0)


def wstrap(mb, pts, width, thick, mat, side=V((1, 0, 0))):
    """Flat strap along points, its width along `side`."""
    pts = [V(p) for p in pts]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        s_ = (side - t * side.dot(t)).normalized() * (width / 2)
        n = t.cross(s_).normalized() * (thick / 2)
        rings.append([p - s_ - n, p + s_ - n, p + s_ + n, p - s_ + n])
    mb.loft(rings, mat, W0, C1, cap0=True, cap1=True, smooth=False, flip=True)


def wsphere(mb, c, r, mat, seg=8, rings=5, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = V((v.co.x * r * scale[0], v.co.y * r * scale[1], v.co.z * r * scale[2]))
    bm.verts.index_update()
    mb.add_bmesh(bm, Matrix.Translation(V(c)), mat, W0, C1, smooth=True)


def wscrew(mb, c, normal, r, mat='gun_metal_worn', h=0.002):
    c = V(c)
    nrm = V(normal).normalized()
    wcyl(mb, c - nrm * 0.001, c + nrm * h, r, mat, seg=8)


def sling(mb, a, b, sag, mat='leather', n=9, width=0.030, side=V((1, 0, 0)), keepers=(), hook=None):
    """A leather sling hanging between two swivels, with keepers (loops) and
    an optional brass hook frog at parameter `hook`."""
    pts = []
    for i in range(n):
        t = i / (n - 1)
        p = V(a).lerp(V(b), t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    wstrap(mb, pts, width, 0.0035, mat, side)
    # doubled-over tail near the front swivel
    tail = [V(a).lerp(V(b), t) - V((0, 0, sag * 4 * t * (1 - t) - 0.006)) for t in (0.0, 0.08, 0.18, 0.28)]
    wstrap(mb, tail, width * 0.98, 0.003, mat, side)
    for t in keepers:
        p = V(a).lerp(V(b), t)
        p.z -= sag * 4 * t * (1 - t) + 0.003
        d = (V(b) - V(a)).normalized()
        R3 = axes_matrix(V(side).normalized(), d, V(side).normalized().cross(d)).to_3x3()
        wbox(mb, p, (width + 0.006, 0.014, 0.012), mat, bevel=0.002, rot=R3)
    if hook is not None:
        p = V(a).lerp(V(b), hook)
        p.z -= sag * 4 * hook * (1 - hook) + 0.004
        for k in (-0.012, 0.012):
            q = p + (V(b) - V(a)).normalized() * k
            wtorus(mb, q, V(side), 0.007, 0.0016, 'brass', seg=8, tseg=4, arc=0.6)


def swivel(mb, c, axis=V((1, 0, 0)), r=0.009):
    wtorus(mb, c, axis, r, 0.0018, 'gun_metal', seg=10, tseg=4)


def cartridge(mb, base, direction, length=0.084, r=0.0060, tip=0.030):
    """A .30 rifle round: brass case with a neck, copper-jacketed bullet."""
    d = V(direction).normalized()
    b = V(base)
    case_l = length - tip
    wlathe(mb, b, b + d * case_l, [(0.0, r * 0.95), (0.03, r), (0.72, r * 0.97), (0.80, r * 0.70),
                                   (1.0, r * 0.62)], 'brass', seg=8)
    wlathe(mb, b + d * case_l, b + d * length, [(0.0, r * 0.60), (0.45, r * 0.52), (0.85, r * 0.22),
                                                (1.0, r * 0.05)], 'brass', seg=8)


def panel_with_holes(mb, origin, u_dir, v_dir, outward, length, height, holes, a, b, t, mat, hseg=12):
    """A flat sheet (thickness t, inward along -outward) in the plane
    origin + u*u_dir + v*v_dir, 0<=u<=length, 0<=v<=height, with elliptic
    holes centred at (u_k, height/2) radii a (along u) x b (along v)."""
    O, U, Vv, N = V(origin), V(u_dir).normalized(), V(v_dir).normalized(), V(outward).normalized()
    cells = []
    edges = [0.0]
    for uk in holes:
        edges.append(uk)
    edges.append(length)
    # cell boundaries halfway between holes
    bounds_ = [0.0] + [(holes[i] + holes[i + 1]) / 2 for i in range(len(holes) - 1)] + [length]
    vc = height / 2

    def P(u, v, inner=False):
        return O + U * u + Vv * v - (N * t if inner else V())
    for k, uk in enumerate(holes):
        u0, u1 = bounds_[k], bounds_[k + 1]
        for inner in (False, True):
            ring_h, ring_r = [], []
            for i in range(hseg):
                ang = 2 * math.pi * i / hseg
                c, s_ = math.cos(ang), math.sin(ang)
                ring_h.append(mb.vert(P(uk + a * c, vc + b * s_, inner), {}, 1.0))
                # project onto the cell rectangle
                sx = (u1 - uk) if c >= 0 else (uk - u0)
                sy = vc
                kx = sx / abs(c) if abs(c) > 1e-6 else 1e9
                ky = sy / abs(s_) if abs(s_) > 1e-6 else 1e9
                k_ = min(kx, ky)
                ring_r.append(mb.vert(P(uk + c * k_, vc + s_ * k_, inner), {}, 1.0))
            out = -N if inner else N
            for i in range(hseg):
                j = (i + 1) % hseg
                mb.face_out((ring_r[i], ring_r[j], ring_h[j], ring_h[i]), mat, out, smooth=False)
            if not inner:
                outer_h = ring_h
            else:
                for i in range(hseg):
                    j = (i + 1) % hseg
                    ci = (P(uk, vc) + P(uk, vc, True)) / 2
                    q = [outer_h[i], outer_h[j], ring_h[j], ring_h[i]]
                    mid = sum((mb.co[x] for x in q), V()) / 4
                    mb.face_out(q, mat, ci - mid, smooth=False)


def _uv_islands(bm, uvl):
    """Face islands connected through edges whose UVs coincide."""
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
        f0, f1 = lf
        ok = True
        for v in e.verts:
            u0 = next(l[uvl].uv for l in f0.loops if l.vert == v)
            u1 = next(l[uvl].uv for l in f1.loops if l.vert == v)
            if (u0 - u1).length > 1e-5:
                ok = False
                break
        if ok:
            a, b = find(f0.index), find(f1.index)
            if a != b:
                parent[a] = b
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def island_scaler(rules):
    """A `scale_islands(obj)` callback for bake.bake_model: UV islands of the
    face, eyes, ears and hands are scaled up (texel density) before the
    atlas is packed. rules: [(material, z from, z to, linear factor)]."""
    def scale(obj):
        me = obj.data
        names = [m.name.split('.')[0] if m else '' for m in me.materials]
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        uvl = bm.loops.layers.uv['bake']
        for isl in _uv_islands(bm, uvl):
            fac = 1.0
            c = sum((f.calc_center_median() for f in isl), V()) / len(isl)
            mats = {names[f.material_index] for f in isl}
            grow = [k for mat, z0, z1, k in rules if mat in mats and z0 <= c.z <= z1 and k >= 1.0]
            shrink = [k for mat, z0, z1, k in rules if mat in mats and z0 <= c.z <= z1 and k < 1.0]
            if grow:
                fac = max(grow)
            elif shrink:                         # v4: hidden skin (under the helmet, inside the collar)
                fac = min(shrink)
            if fac == 1.0:
                continue
            uvs = [l[uvl].uv for f in isl for l in f.loops]
            cu = sum((u for u in uvs), V((0.0, 0.0))) / len(uvs)
            for f in isl:
                for l in f.loops:
                    l[uvl].uv = cu + (l[uvl].uv - cu) * fac
        bm.to_mesh(me)
        bm.free()
    return scale




def register_wear(surfaces):
    """v3 wear on top of the library recipes (this process only): uniforms wet
    on the shoulders and dark and muddy at the trouser legs and knees, kit
    darker where wet; gun steel and walnut more worn."""
    if getattr(surfaces, '_soldier_wear', False):
        return
    surfaces._soldier_wear = True
    cloth_keys = ('cloth_od', 'cloth_od_dark', 'cloth_khaki', 'cloth_feldgrau', 'cloth_feldgrau_dark',
                  'webbing', 'canvas')
    base = {k: surfaces.RECIPES[k] for k in cloth_keys if k in surfaces.RECIPES}

    def masks(S):
        g = S.g
        x, y, z = g.sep(S.Pobj)
        ny = g.sep(S.N)[1]
        ax = g.absolute(x)
        # rain soaking into the shoulders, the tops of the arms and the back of the neck
        wet_sh = g.mul(g.smooth(z, 1.24, 1.40), g.smooth(S.up, -0.45, 0.25))
        wet_sh = g.mul(wet_sh, g.smooth(g.add(S.n(3.5, 4, 0.6), g.mul(wet_sh, 0.35)), 0.30, 0.55))
        # wet trouser legs from the wet grass, darker towards the feet
        leg = g.smooth(z, 0.72, 0.22)
        wet_leg = g.mul(leg, g.smooth(S.n(2.5, 4, 0.6), 0.20, 0.50))
        # knees from kneeling, elbows from going prone
        knee = g.mul(g.mul(g.smooth(g.absolute(g.sub(z, 0.49)), 0.105, 0.040), g.smooth(ny, 0.0, -0.45)),
                     g.smooth(S.n(8.0, 5, 0.65), 0.30, 0.52))
        elbow = g.mul(g.mul(g.smooth(g.absolute(g.sub(ax, 0.377)), 0.07, 0.02),
                            g.smooth(g.absolute(g.sub(z, 1.185)), 0.07, 0.02)),
                      g.smooth(S.n(9.0, 5, 0.65), 0.30, 0.55))
        splash = g.mul(g.smooth(z, 0.40, 0.06), g.smooth(S.n(24.0, 5, 0.7), 0.44, 0.60))
        return wet_sh, wet_leg, knee, elbow, splash

    def wrap_cloth(fn):
        def r(S, key):
            ch = fn(S, key)
            g = S.g
            wet_sh, wet_leg, knee, elbow, splash = masks(S)
            wet = g.maximum(wet_sh, g.mul(wet_leg, 0.9))
            dark = g.map_range(wet, 0.0, 1.0, 1.0, 0.50)
            alb = g.mix(1.0, ch['albedo'], g.combine(dark, dark, dark), blend='MULTIPLY')
            mud = g.mix(S.n(18.0), S.col('#2a2117'), S.col('#4e3d29'))
            dust = g.mix(S.n(14.0), S.col('#6a5c46'), S.col('#857358'))
            alb = g.mix(g.mul(knee, 0.85), alb, mud)
            alb = g.mix(g.mul(elbow, 0.55), alb, dust)
            alb = g.mix(g.mul(splash, 0.85), alb, mud)
            # v4: sweat under the arms and down the back, darker with tide marks
            x, y, z = g.sep(S.Pobj)
            ax = g.absolute(x)
            pit = g.math('SQRT', g.add(g.mul(g.sub(ax, 0.165), g.sub(ax, 0.165)),
                                        g.add(g.mul(g.sub(y, 0.03), g.sub(y, 0.03)), g.mul(g.sub(z, 1.30), g.sub(z, 1.30)))))
            sw = g.mul(g.smooth(pit, 0.075, 0.035), g.smooth(S.n(6.0, 3, 0.6), 0.30, 0.55))
            back = g.mul(g.mul(g.smooth(ax, 0.070, 0.030), g.mul(g.smooth(z, 1.12, 1.20), g.smooth(z, 1.42, 1.34))),
                         g.smooth(y, 0.04, 0.09))
            sw = g.maximum(sw, g.mul(back, g.smooth(S.n(5.0, 3, 0.6), 0.35, 0.60)))
            alb = g.mix(1.0, alb, g.combine(*([g.map_range(sw, 0.0, 1.0, 1.0, 0.72)] * 3)), blend='MULTIPLY')
            tide = g.mul(g.smooth(sw, 0.05, 0.12), g.smooth(sw, 0.25, 0.14))
            alb = g.mix(g.mul(tide, 0.25), alb, S.col('#8a7d62'))
            # twill: fine diagonal wales in the relief
            wale = g.wave(S.P, 105.0, kind='BANDS', direction='DIAGONAL',                # ~3.5 mm wales
                          distortion=0.4, detail=1)
            ch['albedo'] = alb
            ch['rough'] = g.mixf(g.maximum(knee, splash), g.mixf(wet, g.mixf(g.mul(sw, 0.6), ch['rough'], 0.70), 0.55), 0.97)
            ch['height'] = g.add(ch['height'], g.mul(g.maximum(knee, splash), g.mul(S.n(60.0, 3), 0.4)))
            ch['height'] = g.add(ch['height'], g.mul(wale, 0.12))
            return ch
        return r
    for k, fn in base.items():
        surfaces.RECIPES[k] = wrap_cloth(fn)

    def wrap_leather(fn):
        def r(S, key):
            ch = fn(S, key)
            g = S.g
            wet_sh, wet_leg, knee, elbow, splash = masks(S)
            mud = g.mix(S.n(18.0), S.col('#2a2117'), S.col('#4e3d29'))
            alb = g.mix(g.mul(splash, 0.8), ch['albedo'], mud)
            ch['albedo'] = alb
            ch['rough'] = g.mixf(splash, g.mixf(g.mul(wet_leg, 0.8), ch['rough'], 0.22), 0.95)
            return ch
        return r
    for k in ('leather', 'leather_black', 'rubber'):
        if k in surfaces.RECIPES:
            surfaces.RECIPES[k] = wrap_leather(surfaces.RECIPES[k])

    steel = surfaces.RECIPES.get('gun_metal')

    def r_steel_worn(S, key):
        ch = steel(S, key)
        g = S.g
        # holster/handling wear: bluing gone to grey-silver on edges and grip areas, pitting, oily grime
        rub = g.smooth(g.add(g.mul(S.edge, 0.9), g.mul(S.n(5.0, 4, 0.6), 0.35)), 0.40, 0.75)
        alb = g.mix(g.mul(rub, 0.75), ch['albedo'], S.tint(S.col('#7c7f84'), S.n(60.0, 2), 0.8, 1.1))
        pits = g.mul(g.smooth(g.voronoi(S.P, 160.0, rand=1.0), 0.10, 0.02), g.smooth(S.n(4.0), 0.5, 0.65))
        alb = g.mix(g.mul(pits, 0.7), alb, S.col('#3a2414'))
        grime = g.mul(g.smooth(S.ao, 0.85, 0.35), 0.6)
        alb = g.mix(grime, alb, S.col('#16130f'))
        ch['albedo'] = alb
        ch['rough'] = g.mixf(rub, g.mixf(grime, ch['rough'], 0.7), 0.22)
        ch['height'] = g.sub(ch['height'], g.mul(pits, 0.3))
        return ch
    surfaces.RECIPES['gun_metal'] = r_steel_worn
    surfaces.RECIPES['gun_metal_worn'] = r_steel_worn

    walnut = surfaces.RECIPES.get('walnut')
    if walnut is not None:
        def r_walnut_worn(S, key):
            ch = walnut(S, key)
            g = S.g
            dents = g.mul(g.smooth(g.voronoi(S.P, 45.0, rand=1.0), 0.06, 0.0), g.smooth(S.n(3.0), 0.5, 0.62))
            scratch = g.smooth(S.n(30.0, 2, 0.5, stretch=(14, 1, 14), kind='RIDGED_MULTIFRACTAL'), 0.90, 0.97)
            alb = g.mix(g.mul(dents, 0.6), ch['albedo'], S.col('#1a0e07'))
            alb = g.mix(g.mul(scratch, 0.5), alb, S.col('#8a6040'))
            dirt = g.mul(g.smooth(S.ao, 0.8, 0.3), 0.7)
            alb = g.mix(dirt, alb, S.col('#1c140c'))
            ch['albedo'] = alb
            ch['rough'] = g.mixf(g.maximum(dents, dirt), ch['rough'], 0.75)
            ch['height'] = g.sub(ch['height'], g.add(g.mul(dents, 0.5), g.mul(scratch, 0.2)))
            ch['bump'] = 0.3
            return ch
        surfaces.RECIPES['walnut'] = r_walnut_worn


def register_surfaces():
    """Extra surface recipes for this set (registered at runtime, brief §1)."""
    import surfaces
    kit.PALETTE.setdefault('brass', ('#9c7a3c', 0.35, 1.0))
    kit.PALETTE.setdefault('bakelite', ('#2a1c16', 0.45, 0.0))

    def r_brass(S, key):
        g = S.g
        alb = S.tint(S.col('#a8843e'), S.n(12.0, 3), 0.8, 1.1)
        tarn = g.smooth(g.add(S.n(6.0, 4, 0.6), g.mul(g.one_minus(S.ao), 0.6)), 0.45, 0.8)
        alb = g.mix(g.mul(tarn, 0.7), alb, S.col('#4a3a1c'))
        rough = g.mixf(tarn, 0.3, 0.6)
        return dict(albedo=alb, rough=rough, metal=g.mixf(tarn, 1.0, 0.6), height=S.n(80.0, 2), bump=0.1,
                    dist=0.002)

    def r_bakelite(S, key):
        g = S.g
        alb = S.tint(S.col('#2e1e17'), S.n(25.0, 4, 0.6), 0.8, 1.2)
        worn = g.smooth(S.edge, 0.2, 0.8)
        alb = g.mix(g.mul(worn, 0.4), alb, S.col('#5a3a28'))
        return dict(albedo=alb, rough=g.mixf(worn, 0.45, 0.3), metal=0.0, height=S.n(120.0, 2), bump=0.1,
                    dist=0.002)
    def r_walnut(S, key):
        """Oiled walnut stock: fine grain along the weapon (Y), darker figure,
        lighter where hands wear it, glossy oil finish."""
        g = S.g
        P = S.P
        fine = S.n(1.0, 6, 0.65, vec=g.vscale(P, (90.0, 5.0, 90.0)), distortion=0.6)
        fig = S.n(1.0, 4, 0.6, vec=g.vscale(P, (9.0, 1.2, 9.0)), distortion=2.5)
        pores = g.smooth(S.n(1.0, 2, 0.5, vec=g.vscale(P, (420.0, 30.0, 420.0))), 0.62, 0.75)
        t = g.add(g.mul(fine, 0.55), g.mul(fig, 0.45))
        alb = g.mix(g.smooth(t, 0.30, 0.70), S.col('#2e1a0f'), S.col('#5e3a20'))
        alb = g.mix(g.mul(g.smooth(fig, 0.62, 0.78), 0.6), alb, S.col('#1f120a'))
        alb = g.mix(g.mul(pores, 0.35), alb, S.col('#1a0f08'))
        worn = g.smooth(g.add(g.mul(S.edge, 0.8), g.mul(S.n(6.0), 0.3)), 0.45, 0.9)
        alb = g.mix(g.mul(worn, 0.55), alb, S.col('#7a5032'))
        rough = g.mixf(worn, g.map_range(S.n(12.0), 0, 1, 0.32, 0.48), 0.55)
        h = g.add(g.mul(fine, 0.25), g.mul(pores, -0.15))
        return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.12, dist=0.002)
    kit.PALETTE.setdefault('walnut', ('#4e3020', 0.4, 0.0))
    surfaces.RECIPES['walnut'] = r_walnut
    surfaces.PROFILE['walnut'] = 'weapon'
    surfaces.RECIPES['brass'] = r_brass
    surfaces.RECIPES['bakelite'] = r_bakelite

    # ---- the soldier's skin, eyes and the US helmet net
    kit.PALETTE.setdefault('skin2', ('#c08f74', 0.6, 0.0))
    kit.PALETTE.setdefault('eye', ('#cfc6bb', 0.15, 0.0))
    kit.PALETTE.setdefault('helmet_net', ('#4b4d34', 0.8, 0.0))
    hc = HEAD_C

    def r_skin2(S, key):
        ch = surfaces.r_skin(S, 'skin')
        g = S.g
        x, y, z = g.sep(S.Pobj)
        ax = g.absolute(x)
        zr = g.sub(z, hc.z)
        front = g.smooth(y, hc.y + 0.020, hc.y - 0.030)
        jaw = g.mul(g.smooth(zr, -0.036, -0.058), g.smooth(zr, -0.150, -0.120))
        side_ok = g.smooth(ax, 0.074, 0.060)
        lip_zone = g.mul(g.mul(g.smooth(ax, 0.024, 0.016), g.smooth(zr, -0.084, -0.079)),
                         g.smooth(zr, -0.055, -0.059))
        moustache = g.mul(g.mul(g.smooth(ax, 0.024, 0.014), g.smooth(zr, -0.062, -0.058)),
                          g.smooth(zr, -0.046, -0.050))
        beard = g.maximum(g.mul(g.mul(jaw, front), side_ok), moustache)
        beard = g.mul(beard, g.one_minus(lip_zone))
        dots = g.smooth(S.n(1.0, 2, 0.5, vec=g.vscale(S.P, (700.0, 700.0, 700.0))), 0.42, 0.62)
        stub = g.mul(beard, g.add(0.55, g.mul(dots, 0.45)))
        alb = g.mix(g.mul(stub, 0.42), ch['albedo'], S.col('#3b2f27'))
        alb = g.mix(g.mul(g.mul(lip_zone, front), 0.45), alb, S.col('#9a5a50'))
        cheek = g.mul(g.mul(g.smooth(g.absolute(g.sub(ax, 0.045)), 0.02, 0.0), g.smooth(g.absolute(g.add(zr, 0.03)), 0.02, 0.0)), front)
        alb = g.mix(g.mul(cheek, 0.22), alb, S.col('#b0645a'))
        # tone variation: ruddy nose and ears, sallow forehead, blotches, darker round the eyes
        head = g.smooth(zr, -0.16, -0.12)
        blot = g.smooth(S.n(14.0, 4, 0.6), 0.45, 0.80)
        alb = g.mix(g.mul(g.mul(blot, head), 0.22), alb, S.col('#a95e4c'))
        nose = g.mul(g.mul(g.smooth(ax, 0.020, 0.0), g.smooth(g.absolute(g.add(zr, 0.035)), 0.020, 0.0)), front)
        alb = g.mix(g.mul(nose, 0.25), alb, S.col('#b4604e'))
        ears = g.mul(g.smooth(ax, 0.074, 0.082), g.smooth(g.absolute(g.add(zr, 0.017)), 0.035, 0.0))
        alb = g.mix(g.mul(ears, 0.30), alb, S.col('#b0604e'))
        fore = g.mul(g.mul(g.smooth(zr, 0.012, 0.040), g.smooth(zr, 0.090, 0.070)), front)
        alb = g.mix(g.mul(fore, 0.18), alb, S.col('#c8a07a'))
        sock = g.mul(g.mul(g.smooth(g.absolute(g.sub(ax, 0.031)), 0.022, 0.006),
                           g.smooth(g.absolute(g.add(zr, 0.004)), 0.016, 0.004)), front)
        alb = g.mix(g.mul(sock, 0.30), alb, S.col('#6a4a40'))
        alb = S.tint(alb, S.n(260.0, 2, 0.5), 0.95, 1.04)
        ch['albedo'] = alb
        # oily T-zone, wet lid margins and lips
        rough = g.mixf(stub, ch['rough'], 0.75)
        rough = g.mixf(g.mul(g.add(nose, fore), 0.7), rough, 0.38)
        wet = g.mul(g.mul(g.smooth(g.absolute(g.sub(ax, 0.031)), 0.016, 0.008),
                          g.smooth(g.absolute(g.add(zr, 0.006)), 0.008, 0.002)), front)
        rough = g.mixf(g.add(wet, g.mul(lip_zone, 0.7)), rough, 0.18)
        ch['rough'] = rough
        return ch

    E = eye_centre(1)

    def r_eye(S, key):
        g = S.g
        x, y, z = g.sep(S.Pobj)
        fwd = g.mul(g.sub(y, E.y), -1.0 / EYEBALL_R)
        iris = g.smooth(fwd, 0.835, 0.865)
        pupil = g.smooth(fwd, 0.960, 0.972)
        limbal = g.mul(g.smooth(fwd, 0.80, 0.84), g.smooth(fwd, 0.885, 0.855))
        sclera = S.tint(S.col('#c9bfb2'), S.n(60.0, 2), 0.9, 1.04)
        ir = g.mix(S.n(1.0, 3, 0.6, vec=g.vscale(S.P, (900.0, 30.0, 900.0))), S.col('#3a2c1e'), S.col('#6a5236'))
        alb = g.mix(iris, sclera, ir)
        alb = g.mix(g.mul(limbal, 0.6), alb, S.col('#1c1610'))
        alb = g.mix(pupil, alb, S.col('#080605'))
        return dict(albedo=alb, rough=g.mixf(iris, 0.035, 0.05), metal=0.0, height=0.5, bump=0.0, dist=0.001)

    def r_helmet_net(S, key):
        """Olive-drab steel under a cotton net: the net's cords and knots carry
        the relief; scuffed paint shows between them."""
        g = S.g
        paint = S.tint(S.col('#4a4c33'), S.n(2.0, 3), 0.85, 1.1)
        paint = S.tint(paint, S.n(60.0, 2), 0.93, 1.05)
        sand = S.n(180.0, 2, 0.5)
        x, y, z = g.sep(S.Pobj)
        qx, qy, qz = g.sub(x, hc.x), g.sub(y, hc.y + 0.004), g.sub(z, hc.z + 0.03)
        az = g.math('ARCTAN2', qx, g.mul(qy, -1.0))
        el = g.math('ARCTAN2', qz, g.math('SQRT', g.add(g.mul(qx, qx), g.mul(qy, qy))))
        wob = g.mul(S.n(9.0), 0.25)
        k = 5.2
        a1 = g.fract(g.add(g.mul(g.add(az, el), k), wob))
        a2 = g.fract(g.add(g.mul(g.sub(az, el), k), wob))
        d1 = g.minimum(a1, g.one_minus(a1))
        d2 = g.minimum(a2, g.one_minus(a2))
        cord = g.maximum(g.smooth(d1, 0.085, 0.035), g.smooth(d2, 0.085, 0.035))
        knot = g.mul(g.smooth(d1, 0.12, 0.05), g.smooth(d2, 0.12, 0.05))
        cc = g.mix(S.n(40.0), S.col('#3a3524'), S.col('#5a5236'))
        alb = g.mix(cord, paint, cc)
        alb = g.mix(g.mul(knot, 0.6), alb, S.col('#2a2618'))
        rough = g.mixf(cord, 0.62, 0.95)
        h = g.add(g.mul(sand, 0.05), g.add(g.mul(cord, 0.6), g.mul(knot, 0.3)))
        return dict(albedo=alb, rough=rough, metal=g.mixf(cord, 0.05, 0.0), height=h, bump=0.9, dist=0.004)
    surfaces.RECIPES['skin2'] = r_skin2
    surfaces.RECIPES['skin'] = r_skin4           # v4: the whole face (and the hands) from one recipe
    register_wear(surfaces)
    surfaces.RECIPES['eye'] = r_eye4
    kit.PALETTE.setdefault('nail', ('#c99a8c', 0.4, 0.0))
    surfaces.RECIPES['nail'] = r_nail
    surfaces.PROFILE['nail'] = 'skin'
    surfaces.WEATHER.setdefault('skin4', (0.55, 0.0, 0.0, 0.0, 0.0, 0.0))   # v4.1: softer occlusion
    surfaces.PROFILE['skin'] = 'skin4'
    surfaces.RECIPES['helmet_net'] = r_helmet_net
    surfaces.PROFILE['skin2'] = 'skin'
    surfaces.PROFILE['eye'] = 'none'
    surfaces.PROFILE['helmet_net'] = 'cloth'
    surfaces.PROFILE['brass'] = 'weapon'
    surfaces.PROFILE['bakelite'] = 'weapon'


# ---- v4 skin, eyes and nails (surface recipes for the bake) -----------------

def _sg_gauss(g, x, mu, sig):
    t = g.mul(g.sub(x, mu), 1.0 / sig)
    return g.math('EXPONENT', g.mul(g.mul(t, t), -0.5))


def _sg_powc(g, x, e):
    """x ** e for x clamped to >= 0."""
    return g.power(g.maximum(x, 0.0), e)


def _sg_fissure(g, dx, dz):
    """Shader version of fissure4: (z_up, z_lo, z_c, u) of the eye fissure."""
    F = FIS4
    u = g.map_range(dx, F['din'], F['dout'], 0.0, 1.0)            # clamped 0..1
    zc = g.add(F['zc0'], g.mul(u, F['zc1'] - F['zc0']))
    su = _sg_powc(g, g.sin(g.mul(_sg_powc(g, u, 0.82), math.pi)), 0.72)
    sl = _sg_powc(g, g.sin(g.mul(_sg_powc(g, u, 1.15), math.pi)), 0.80)
    return g.add(zc, g.mul(su, F['hup'])), g.sub(zc, g.mul(sl, F['hlo'])), zc, u


def _sg_warp(g, zr):
    """Shader version of head4_warp (design z of the face)."""
    W = WARP4
    h = W['h']

    def s2(z0):
        u = g.mul(g.sub(z0 + h, zr), 1.0 / (2 * h))
        uc = g.minimum(g.maximum(u, 0.0), 1.0)
        return g.add(g.sub(g.power(uc, 3.0), g.mul(g.power(uc, 4.0), 0.5)), g.maximum(g.sub(u, 1.0), 0.0))
    return g.sub(zr, g.mul(g.sub(s2(W['z0']), s2(W['z1'])), (W['s'] - 1) * 2 * h))


def r_skin4(S, key):
    """Field-worn skin of a young soldier: warm tone zones (ruddy cheeks, nose
    and ears, yellower forehead, darker round the eyes), blue-grey stubble,
    cropped hair and hair-like brows, lips with a vermilion border, pink lid
    margins and tear ducts, dark lash lines; pores, crow's feet, nasolabial and
    neck creases in the normal map; grime, mud smears and sweat. The hands get
    dirt in the creases and on the knuckles."""
    g = S.g
    x, y, z = g.sep(S.Pobj)
    ax = g.absolute(x)
    zr = _sg_warp(g, g.sub(z, HEAD_C.z))                           # design z (v4.1 shorter lower face)
    yr = g.sub(y, HEAD_C.y)
    A = g.math('ARCTAN2', ax, g.mul(yr, -1.0))                     # 0 front .. pi back
    deg = math.pi / 180.0
    head = g.smooth(z, 1.30, 1.38)
    front = g.mul(g.smooth(A, 85 * deg, 55 * deg), head)
    G = lambda v, mu, sig: _sg_gauss(g, v, mu, sig)
    # ---- base tone with mottling
    alb = S.tint(S.col('#c4957a'), S.n(3.0, 3, 0.5), 0.92, 1.06)
    blot = g.smooth(S.n(16.0, 4, 0.6), 0.48, 0.78)
    alb = g.mix(g.mul(blot, 0.22), alb, S.col('#b3705e'))
    alb = g.mix(g.mul(g.smooth(S.n(40.0, 3, 0.6), 0.55, 0.75), 0.12), alb, S.col('#d9b39a'))
    # ---- zones: forehead yellower, cheeks / nose / ears / chin ruddy
    fore = g.mul(g.mul(g.smooth(zr, 0.020, 0.040), g.smooth(zr, 0.090, 0.060)), front)
    alb = g.mix(g.mul(fore, 0.30), alb, S.col('#caa47e'))
    cheek = g.mul(g.mul(G(ax, 0.044, 0.013), G(zr, -0.034, 0.014)), front)
    alb = g.mix(g.mul(cheek, 0.42), alb, S.col('#c0705e'))
    nose = g.mul(g.mul(g.smooth(ax, 0.017, 0.004), G(zr, -0.036, 0.012)), front)
    alb = g.mix(g.mul(nose, 0.40), alb, S.col('#c26e5c'))
    ears = g.mul(g.smooth(ax, 0.074, 0.082), g.mul(G(zr, -0.017, 0.028), g.smooth(A, 70 * deg, 85 * deg)))
    ears = g.mul(ears, head)
    alb = g.mix(g.mul(ears, 0.26), alb, S.col('#bb6654'))
    chin = g.mul(g.mul(G(ax, 0.0, 0.018), G(zr, -0.100, 0.010)), front)
    alb = g.mix(g.mul(chin, 0.18), alb, S.col('#bf7a66'))
    # ---- the eyes: lid margins, lash lines, tear ducts, darker sockets
    dx = g.sub(ax, EYE4_X)
    dz = g.sub(zr, EYE4_Z)
    zup, zlo, zc, u = _sg_fissure(g, dx, dz)
    span = g.mul(g.smooth(dx, FIS4['din'] - 0.002, FIS4['din'] + 0.002), g.smooth(dx, FIS4['dout'] + 0.002, FIS4['dout'] - 0.002))
    eyez = g.mul(span, front)
    inside = g.mul(g.mul(g.smooth(g.sub(dz, zup), 0.0006, -0.0002), g.smooth(g.sub(zlo, dz), 0.0006, -0.0002)), eyez)
    sock = g.mul(g.mul(G(dx, 0.0, 0.016), G(dz, -0.002, 0.011)), front)
    alb = g.mix(g.mul(sock, 0.05), alb, S.col('#946a5c'))
    under = g.mul(g.mul(G(dx, -0.002, 0.010), G(dz, -0.0115, 0.0035)), front)
    alb = g.mix(g.mul(under, 0.08), alb, S.col('#86605a'))
    alb = g.mix(g.mul(inside, 0.85), alb, S.col('#c4776e'))                        # caruncle, wet margins
    lash_up = g.mul(G(g.sub(dz, zup), 0.00035, 0.00055), g.add(0.55, g.mul(u, 0.45)))
    lash_lo = g.mul(G(g.sub(zlo, dz), 0.00030, 0.00040), 0.45)
    lash = g.mul(g.maximum(lash_up, lash_lo), eyez)
    alb = g.mix(g.mul(lash, 0.92), alb, S.col('#1b1310'))
    crease = g.mul(G(g.sub(dz, zup), 0.0063, 0.0009), eyez)
    alb = g.mix(g.mul(crease, 0.25), alb, S.col('#7a5248'))
    # ---- lips with the vermilion border
    X = g.minimum(ax, 0.026)
    zst = g.sub(-0.0680, g.mul(g.mul(g.mul(X, X), 1 / 0.025 ** 2), 0.0013))
    hu = g.mul(_sg_powc(g, g.sub(1.0, _sg_powc(g, g.mul(X, 1 / 0.0258), 2.2)), 0.7), 0.0098)
    hu = g.add(hu, g.sub(g.mul(G(X, 0.0056, 0.0021), 0.0013), g.mul(G(X, 0.0, 0.0016), 0.0009)))
    hl = g.mul(_sg_powc(g, g.sub(1.0, g.power(g.mul(X, 1 / 0.0242), 2.0)), 0.6), 0.0112)
    in_up = g.mul(g.smooth(g.sub(zr, zst), -0.0004, 0.0003), g.smooth(g.sub(zr, g.add(zst, hu)), 0.0003, -0.0003))
    in_lo = g.mul(g.smooth(g.sub(zst, zr), -0.0004, 0.0003), g.smooth(g.sub(g.sub(zst, hl), zr), 0.0003, -0.0003))
    lips = g.mul(g.mul(g.maximum(in_up, in_lo), g.smooth(ax, 0.0262, 0.0235)), front)
    lipc = S.tint(S.col('#985650'), S.n(90.0, 2, 0.5, stretch=(1, 1, 6)), 0.86, 1.06)
    alb = g.mix(g.mul(lips, 0.62), alb, lipc)
    corner = g.mul(g.mul(G(ax, 0.0262, 0.0028), G(g.sub(zr, zst), 0.0, 0.0030)), front)
    alb = g.mix(g.mul(corner, 0.35), alb, S.col('#6a3e38'))
    dry = g.mul(lips, g.smooth(S.n(60.0, 3, 0.6), 0.55, 0.75))
    alb = g.mix(g.mul(dry, 0.25), alb, S.col('#b89082'))                          # dry, cracked patches
    stom = g.mul(g.mul(G(g.sub(zr, zst), 0.0, 0.0006), g.smooth(ax, 0.027, 0.020)), front)
    alb = g.mix(g.mul(stom, 0.55), alb, S.col('#4a2a26'))
    # ---- cropped hair (back and sides nearly clipped), brows
    hz = g.add(0.082, g.mul(g.smooth(A, 30 * deg, 72 * deg), -0.054))
    hz = g.add(hz, g.mul(G(A, 84 * deg, 9 * deg), 0.010))
    hz = g.sub(hz, g.mul(G(A, 68 * deg, 6 * deg), 0.006))
    hz = g.sub(hz, g.mul(g.smooth(A, 100 * deg, 160 * deg), 0.086))
    hairn = S.n(1.0, 3, 0.6, vec=g.vscale(S.P, (420.0, 420.0, 110.0)))
    hair = g.mul(g.smooth(g.sub(zr, hz), g.sub(-0.004, g.mul(hairn, 0.004)), 0.006), head)
    hair = g.mul(hair, g.smooth(zr, -0.120, -0.095))
    hairc = g.mix(g.smooth(hairn, 0.35, 0.70), S.col('#3b2c22'), S.col('#18110d'))
    alb = g.mix(g.mul(hair, 0.82), alb, hairc)
    t = g.map_range(ax, 0.010, 0.050, 0.0, 1.0)
    bzc = g.add(0.0170, g.sub(g.mul(g.sin(g.mul(_sg_powc(g, t, 0.8), math.pi)), 0.0028), g.mul(t, 0.0010)))
    bhw = g.sub(0.0037, g.mul(t, 0.0019))
    bdist = g.absolute(g.sub(zr, bzc))
    brow = g.mul(g.mul(g.smooth(ax, 0.008, 0.013), g.smooth(ax, 0.055, 0.048)), front)
    browh = g.mul(brow, g.smooth(bdist, g.add(bhw, 0.0008), g.mul(bhw, 0.3)))
    strands = S.n(1.0, 3, 0.6, vec=g.vscale(S.P, (160.0, 700.0, 700.0)), distortion=0.4)
    browd = g.mul(browh, g.smooth(strands, 0.30, 0.62))
    alb = g.mix(g.mul(browd, 0.92), alb, S.col('#21170f'))
    alb = g.mix(g.mul(browh, 0.30), alb, S.col('#5a4232'))
    # ---- stubble: jaw, chin, upper lip, under the chin
    cl = g.add(-0.050, g.mul(g.smooth(A, 40 * deg, 80 * deg), 0.042))
    beard = g.mul(g.smooth(zr, g.add(cl, 0.005), g.sub(cl, 0.006)), g.smooth(zr, -0.175, -0.150))
    beard = g.mul(beard, g.smooth(A, 100 * deg, 84 * deg))
    must = g.mul(g.mul(g.smooth(ax, 0.027, 0.022), g.smooth(zr, -0.0470, -0.0495)), front)
    beard = g.mul(g.maximum(beard, must), g.mul(g.one_minus(lips), head))
    dots = g.smooth(S.n(1.0, 2, 0.5, vec=g.vscale(S.P, (900.0, 900.0, 900.0))), 0.40, 0.66)
    stub = g.mul(beard, g.add(0.62, g.mul(dots, 0.38)))
    alb = g.mix(g.mul(stub, 0.58), alb, S.col('#3d3735'))
    # ---- field grime: mud smears, dust in the creases, sweat on the forehead and nose
    smear = g.mul(g.smooth(S.n(9.0, 5, 0.65), 0.60, 0.72), g.add(0.35, g.mul(g.one_minus(head), 0.65)))
    mudc = g.mix(S.n(30.0), S.col('#4a3a2a'), S.col('#6e5a44'))
    alb = g.mix(g.mul(smear, 0.55), alb, mudc)
    crev = g.mul(g.smooth(S.ao, 0.85, 0.45), 0.45)
    alb = g.mix(crev, alb, S.col('#4a3328'))
    hand = g.one_minus(head)
    alb = g.mix(g.mul(hand, 0.35), alb, S.col('#a87a60'))                          # tanned, weathered hands
    grime_h = g.mul(hand, g.smooth(S.n(5.0, 5, 0.6), 0.38, 0.60))
    alb = g.mix(g.mul(grime_h, 0.50), alb, S.col('#5a4636'))
    sweat = g.mul(g.add(fore, g.mul(nose, 0.8)), g.smooth(S.n(7.0, 4, 0.6), 0.45, 0.62))
    alb = g.mix(g.mul(sweat, 0.10), alb, S.col('#9a6a52'))
    alb = S.tint(alb, S.n(260.0, 2, 0.5), 0.95, 1.04)
    # ---- roughness: satin skin, oilier T-zone, wet eyes and lips, dry stubble and hair, sweat
    rough = g.map_range(S.n(30.0, 3, 0.5), 0.0, 1.0, 0.50, 0.62)
    rough = g.mixf(g.mul(g.add(fore, nose), 0.8), rough, 0.50)
    rough = g.mixf(g.mul(sweat, 0.9), rough, 0.44)
    rough = g.mixf(lips, rough, 0.47)
    rough = g.mixf(stub, rough, 0.64)
    rough = g.mixf(g.maximum(hair, browh), rough, 0.72)
    rough = g.mixf(g.maximum(smear, grime_h), rough, 0.74)
    rough = g.mixf(g.mul(inside, 0.9), rough, 0.22)
    # ---- relief for the normal map
    pores = g.smooth(g.voronoi(S.P, 900.0, rand=1.0), 0.0, 0.35)
    grain = S.n(1.0, 3, 0.6, vec=g.vscale(S.P, (500.0, 500.0, 500.0)))
    h = g.add(0.5, g.mul(g.sub(pores, 0.5), 0.25))
    h = g.add(h, g.mul(g.sub(grain, 0.5), 0.20))
    # crow's feet: radial lines from the outer canthus
    cfx, cfz = g.sub(dx, FIS4['dout'] + 0.0015), g.sub(dz, 0.0005)
    ang = g.math('ARCTAN2', cfz, cfx)
    cr = g.math('SQRT', g.add(g.mul(cfx, cfx), g.mul(cfz, cfz)))
    crow = g.mul(g.mul(g.smooth(cr, 0.003, 0.006), g.smooth(cr, 0.016, 0.010)), g.smooth(cfx, -0.001, 0.003))
    lines = g.smooth(g.absolute(g.sin(g.add(g.mul(ang, 7.0), g.mul(S.n(40.0), 1.5)))), 0.80, 0.98)
    h = g.sub(h, g.mul(g.mul(g.mul(crow, lines), front), 0.45))
    # forehead lines, under-eye lines, nasolabial crease, neck creases, knuckle creases
    fl = g.smooth(g.absolute(g.sin(g.add(g.mul(zr, 2 * math.pi / 0.0085), g.mul(S.n(12.0), 2.0)))), 0.82, 0.98)
    h = g.sub(h, g.mul(g.mul(fl, g.mul(fore, g.smooth(ax, 0.050, 0.030))), 0.40))
    ul = g.mul(G(g.sub(zlo, dz), 0.0030, 0.0008), eyez)
    h = g.sub(h, g.mul(ul, 0.35))
    h = g.sub(h, g.mul(crease, 0.6))
    nl = g.mul(g.mul(G(g.sub(ax, g.add(0.0195, g.mul(g.sub(-0.0405, zr), 0.36))), 0.0, 0.0010),
                     g.mul(g.smooth(zr, -0.038, -0.043), g.smooth(zr, -0.080, -0.072))), front)
    h = g.sub(h, g.mul(nl, 0.5))
    nk = g.mul(g.mul(g.smooth(g.absolute(g.sin(g.add(g.mul(zr, 2 * math.pi / 0.014), g.mul(S.n(10.0), 1.2)))), 0.85, 0.99),
                     g.mul(g.smooth(zr, -0.185, -0.165), g.smooth(zr, -0.120, -0.135))), head)
    h = g.sub(h, g.mul(nk, 0.30))
    h = g.add(h, g.mul(g.mul(stub, dots), 0.18))
    h = g.add(h, g.mul(g.mul(hair, hairn), 0.35))
    h = g.add(h, g.mul(g.mul(browh, strands), 0.45))
    h = g.sub(h, g.mul(lash, 0.3))
    lipl = g.smooth(g.absolute(g.sin(g.add(g.mul(ax, 2 * math.pi / 0.0016), g.mul(S.n(30.0), 2.0)))), 0.85, 1.0)
    h = g.sub(h, g.mul(g.mul(lips, lipl), 0.20))
    kn = g.mul(hand, g.smooth(g.absolute(g.sin(g.add(g.mul(S.Z, 2 * math.pi / 0.0030), g.mul(S.n(50.0), 3.0)))), 0.88, 0.99))
    h = g.sub(h, g.mul(g.mul(kn, g.smooth(S.ao, 0.95, 0.75)), 0.25))
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.32, dist=0.0012)


def r_eye4(S, key):
    """Eyeball: off-white sclera with fine veins and pink corners, a grey-green
    iris with radial fibres, a hazel collarette and a dark limbal ring, a black
    pupil; wet (glossy cornea)."""
    g = S.g
    x, y, z = g.sep(S.Pobj)
    ax = g.absolute(x)
    dx = g.sub(ax, EYE4_X)
    dz = g.sub(z, HEAD_C.z + EYE4_Z)
    rf = g.math('SQRT', g.add(g.mul(dx, dx), g.mul(dz, dz)))           # front-projected radius
    G = lambda v, mu, sig: _sg_gauss(g, v, mu, sig)
    # sclera: warm off-white, pinker and veined towards the corners
    sc = S.tint(S.col('#d6ccbe'), S.n(60.0, 2), 0.94, 1.03)
    side = g.smooth(g.absolute(dx), 0.007, 0.013)
    sc = g.mix(g.mul(side, 0.35), sc, S.col('#d6a8a0'))
    veins = g.smooth(S.n(1.0, 4, 0.6, vec=g.vscale(S.P, (300.0, 300.0, 300.0)), kind='RIDGED_MULTIFRACTAL'), 0.80, 0.95)
    sc = g.mix(g.mul(g.mul(veins, side), 0.55), sc, S.col('#b04848'))
    # iris
    psi = g.math('ARCTAN2', dz, dx)
    fib = S.n(1.0, 3, 0.6, vec=g.combine(g.mul(psi, 9.0), g.mul(rf, 900.0), 0.0))
    ir = g.mix(g.smooth(fib, 0.30, 0.75), S.col('#3c4a4c'), S.col('#76877c'))
    coll = G(rf, 0.0028, 0.0008)
    ir = g.mix(g.mul(coll, 0.65), ir, S.col('#8a7444'))
    limb = g.smooth(rf, IRIS4_R - 0.0012, IRIS4_R - 0.0002)
    ir = g.mix(g.mul(limb, 0.75), ir, S.col('#1e2628'))
    iris = g.smooth(rf, IRIS4_R + 0.0002, IRIS4_R - 0.0003)
    alb = g.mix(iris, sc, ir)
    pupil = g.smooth(rf, 0.0020, 0.0016)
    alb = g.mix(pupil, alb, S.col('#060505'))
    rough = g.mixf(iris, 0.10, 0.03)
    h = g.add(0.5, g.mul(g.mul(veins, side), 0.1))
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.05, dist=0.0005)


def r_nail(S, key):
    """Finger nails: pink-beige plate, paler free edge, dirt under and around."""
    g = S.g
    alb = S.tint(S.col('#c99a8c'), S.n(200.0, 2, 0.5, stretch=(1, 1, 8)), 0.92, 1.06)
    edge = g.smooth(S.edge, 0.15, 0.6)
    alb = g.mix(g.mul(edge, 0.65), alb, S.col('#3e3024'))
    alb = g.mix(g.mul(g.smooth(S.n(12.0), 0.55, 0.70), 0.35), alb, S.col('#6a5644'))
    return dict(albedo=alb, rough=g.mixf(edge, 0.30, 0.70), metal=0.0, height=S.n(400.0, 2, 0.5, stretch=(1, 1, 6)),
                bump=0.08, dist=0.0005)


# ---- M1 Garand ---------------------------------------------------------

GARAND_BZ = 0.045


def build_m1_garand():
    mb = MeshBuilder()
    bz = GARAND_BZ
    # walnut stock: butt, comb, semi-pistol wrist, magazine well, fore-end
    st = [(0.318, 0.0200, -0.111, 0.033, 3.0), (0.312, 0.0215, -0.113, 0.035, 2.8), (0.290, 0.0222, -0.107, 0.036),
          (0.250, 0.0224, -0.098, 0.037), (0.200, 0.0222, -0.086, 0.037), (0.150, 0.0212, -0.072, 0.036),
          (0.105, 0.0200, -0.059, 0.033), (0.065, 0.0188, -0.048, 0.028), (0.032, 0.0180, -0.040, 0.024),
          (0.004, 0.0180, -0.035, 0.022), (-0.020, 0.0190, -0.039, 0.025), (-0.045, 0.0210, -0.049, 0.030),
          (-0.090, 0.0222, -0.053, 0.031), (-0.150, 0.0222, -0.050, 0.031), (-0.195, 0.0216, -0.038, 0.031),
          (-0.232, 0.0205, -0.022, 0.032), (-0.300, 0.0198, -0.013, 0.033), (-0.380, 0.0192, -0.009, 0.034),
          (-0.470, 0.0184, -0.004, 0.036), (-0.548, 0.0175, 0.000, 0.038), (-0.556, 0.0168, 0.003, 0.037)]
    wloft(mb, st, 'walnut', seg=18)
    # butt plate with the trap door
    wloft(mb, [(0.3215, 0.0205, -0.114, 0.036, 3.0), (0.3175, 0.0212, -0.115, 0.037, 3.0)], 'gun_metal', seg=18)
    wbox(mb, (0, 0.323, -0.040), (0.016, 0.003, 0.055), 'gun_metal_worn', bevel=0.001)
    # receiver: heel, legs, bridge over the clip, front ring
    rec = [(0.012, 0.0150, 0.024, 0.055, 4), (0.004, 0.0168, 0.020, 0.061, 4), (-0.030, 0.0178, 0.018, 0.063, 4),
           (-0.060, 0.0180, 0.018, 0.058, 4), (-0.180, 0.0180, 0.018, 0.058, 4), (-0.205, 0.0180, 0.018, 0.064, 4),
           (-0.222, 0.0168, 0.022, 0.062, 4), (-0.236, 0.0150, 0.027, 0.059, 3)]
    wloft(mb, rec, 'gun_metal', seg=16)
    # the en-bloc clip with its rounds showing on top
    for sx in (-0.0122, 0.0122):
        wbox(mb, (sx, -0.120, 0.061), (0.0022, 0.092, 0.014), 'gun_metal_worn', bevel=0.0006)
    for k, (cx, cz) in enumerate(((0.0048, 0.0585), (-0.0048, 0.0535))):
        cartridge(mb, (cx, -0.074, cz), (0, -1, 0), length=0.084, r=0.0060, tip=0.029)
    # bolt and its lugs, operating rod handle on the right
    wbox(mb, (0, -0.052, 0.061), (0.022, 0.034, 0.012), 'gun_metal_worn', bevel=0.002, segs=2)
    wbox(mb, (-0.020, -0.050, 0.055), (0.006, 0.020, 0.010), 'gun_metal_worn', bevel=0.0015)
    wbox(mb, (-0.026, -0.228, 0.052), (0.020, 0.013, 0.012), 'gun_metal', bevel=0.003, segs=2)
    wbox(mb, (-0.020, -0.40, bz - 0.010), (0.0055, 0.33, 0.009), 'gun_metal', bevel=0.0015)
    # rear sight: aperture ears and windage / elevation knobs
    wbox(mb, (0, -0.010, 0.072), (0.010, 0.016, 0.020), 'gun_metal', bevel=0.002)
    for sx in (-0.0075, 0.0075):
        wbox(mb, (sx, -0.008, 0.074), (0.003, 0.014, 0.024), 'gun_metal', bevel=0.001)
    for sx in (-1, 1):
        wcyl(mb, (sx * 0.018, -0.012, 0.064), (sx * 0.026, -0.012, 0.064), 0.0085, 'gun_metal_worn', seg=12)
        wcyl(mb, (sx * 0.026, -0.012, 0.064), (sx * 0.029, -0.012, 0.064), 0.0070, 'gun_metal_worn', seg=12)
    # barrel
    wlathe(mb, (0, -0.236, bz), (0, -0.792, bz), [(0, 0.0120), (0.06, 0.0118), (0.4, 0.0108), (1.0, 0.0096)],
           'gun_metal', seg=14)
    # handguards with their ferrule and clip
    hg = lambda y0, y1: [(y0, 0.0180, bz - 0.009, bz + 0.0205, 2.4), (y1, 0.0168, bz - 0.009, bz + 0.0190, 2.4)]
    wloft(mb, hg(-0.240, -0.372), 'walnut', seg=14)
    wloft(mb, hg(-0.398, -0.566), 'walnut', seg=14)
    wloft(mb, [(-0.236, 0.0188, bz - 0.010, bz + 0.0218, 2.6), (-0.248, 0.0188, bz - 0.010, bz + 0.0218, 2.6)],
          'gun_metal', seg=14)
    wloft(mb, [(-0.366, 0.0186, bz - 0.006, bz + 0.0212, 2.6), (-0.376, 0.0186, bz - 0.006, bz + 0.0212, 2.6)],
          'gun_metal', seg=14)
    # lower band + stacking swivel, gas cylinder, front sight, bayonet lug
    wloft(mb, [(-0.378, 0.0215, -0.016, bz + 0.024, 3.2), (-0.396, 0.0215, -0.014, bz + 0.024, 3.2)],
          'gun_metal', seg=16)
    swivel(mb, (0, -0.387, -0.024), axis=V((1, 0, 0)), r=0.008)
    wlathe(mb, (0, -0.566, bz - 0.003), (0, -0.774, bz - 0.003), [(0, 0.0160), (0.04, 0.0170), (0.94, 0.0170),
                                                               (1.0, 0.0150)], 'gun_metal', seg=16)
    wcyl(mb, (0, -0.585, bz - 0.020), (0, -0.700, bz - 0.020), 0.0085, 'gun_metal', seg=10)
    wlathe(mb, (0, -0.774, bz), (0, -0.794, bz), [(0, 0.0125), (0.5, 0.0128), (1.0, 0.0110)], 'gun_metal_worn', seg=12)
    wbox(mb, (0, -0.762, bz + 0.026), (0.004, 0.010, 0.022), 'gun_metal', bevel=0.0008)
    for sx in (-0.0085, 0.0085):
        wbox(mb, (sx, -0.760, bz + 0.022), (0.003, 0.014, 0.022), 'gun_metal', bevel=0.0008)
    wbox(mb, (0, -0.720, bz - 0.030), (0.008, 0.030, 0.010), 'gun_metal', bevel=0.0015)
    swivel(mb, (0, -0.612, bz - 0.036), axis=V((1, 0, 0)), r=0.008)
    for y in (-0.62, -0.69):
        wscrew(mb, (-0.0168, y, bz - 0.003), (-1, 0, 0), 0.0028)
    # trigger guard with the safety, trigger
    wtube(mb, [(0, -0.006, -0.026), (0, -0.010, -0.052), (0, -0.030, -0.066), (0, -0.060, -0.066),
               (0, -0.082, -0.054), (0, -0.090, -0.030)], 0.0042, 'gun_metal', seg=8)
    wbox(mb, (0, -0.048, -0.028), (0.016, 0.090, 0.008), 'gun_metal', bevel=0.002)
    wbox(mb, (0, -0.088, -0.040), (0.006, 0.008, 0.018), 'gun_metal_worn', bevel=0.001)
    wtube(mb, [(0, -0.040, -0.030), (0, -0.044, -0.042), (0, -0.040, -0.054)], 0.0026, 'gun_metal_worn', seg=6)
    # rear swivel, screws, sling with keepers and the hook frog
    swivel(mb, (0, 0.188, -0.097), axis=V((1, 0, 0)), r=0.009)
    for y in (0.300, 0.250):
        wscrew(mb, (0, y + 0.024, -0.04), (0, 1, 0), 0.0025)
    sling(mb, (0, -0.612, bz - 0.045), (0, 0.188, -0.106), 0.075, keepers=(0.2, 0.62), hook=0.42)
    obj = mb.build('m1_garand')
    kit.set_anchors(obj, {'muzzle': (0, -0.794, bz), 'offhand': (0, -0.215, -0.012), 'clip': (0, -0.114, 0.074)})
    return obj


# ---- Kar 98k --------------------------------------------------------------

def build_kar98k():
    mb = MeshBuilder()
    bz = 0.048

    def groove(k, x, z):           # finger grooves along the fore-end
        if 11 <= k <= 13 and abs(z - 0.010) < 0.007:
            return 0.0035 * (1 - abs(z - 0.010) / 0.007)
        return 0.0
    st = [(0.334, 0.0205, -0.114, 0.029, 3.0), (0.327, 0.0215, -0.115, 0.032, 2.8), (0.300, 0.0220, -0.108, 0.034),
          (0.240, 0.0222, -0.092, 0.036), (0.180, 0.0216, -0.076, 0.035), (0.120, 0.0202, -0.061, 0.033),
          (0.070, 0.0186, -0.050, 0.027), (0.030, 0.0176, -0.044, 0.022), (0.000, 0.0175, -0.041, 0.022),
          (-0.030, 0.0196, -0.034, 0.033), (-0.120, 0.0205, -0.036, 0.034), (-0.200, 0.0200, -0.016, 0.036),
          (-0.280, 0.0196, -0.006, 0.038), (-0.400, 0.0188, 0.002, 0.040), (-0.520, 0.0178, 0.008, 0.041),
          (-0.620, 0.0166, 0.014, 0.042), (-0.636, 0.0160, 0.017, 0.042)]
    wloft(mb, st, 'walnut', seg=18, groove=groove)
    wloft(mb, [(0.338, 0.0208, -0.116, 0.030, 3.0), (0.333, 0.0214, -0.117, 0.032, 3.0)], 'gun_metal', seg=18)
    wcyl(mb, (-0.0214, 0.245, -0.040), (-0.0230, 0.245, -0.040), 0.0125, 'gun_metal_worn', seg=14)   # butt disc
    wtorus(mb, (0.0, 0.205, -0.076), V((1, 0, 0)), 0.010, 0.002, 'gun_metal', seg=10, tseg=4, arc=1.0)
    # receiver, bolt with the shroud and safety flag, turned-down bolt handle
    wlathe(mb, (0, 0.040, bz), (0, -0.218, bz), [(0, 0.0150), (0.05, 0.0165), (0.45, 0.0165), (0.55, 0.0175),
                                                 (0.97, 0.0175), (1.0, 0.0160)], 'gun_metal', seg=16)
    wbox(mb, (0, -0.120, bz - 0.006), (0.032, 0.090, 0.022), 'gun_metal', bevel=0.003, segs=2)
    wlathe(mb, (0, 0.078, bz + 0.002), (0, 0.040, bz + 0.002), [(0, 0.0095), (0.4, 0.0118), (1.0, 0.0125)],
           'gun_metal_worn', seg=12)
    wbox(mb, (0, 0.066, bz + 0.016), (0.004, 0.012, 0.016), 'gun_metal_worn', bevel=0.001)
    wtube(mb, [(-0.010, -0.004, bz + 0.004), (-0.030, 0.000, bz + 0.002), (-0.046, 0.006, bz - 0.010),
               (-0.052, 0.010, bz - 0.024)], 0.0048, 'gun_metal', seg=8)
    wsphere(mb, (-0.054, 0.011, bz - 0.032), 0.0105, 'gun_metal_worn', seg=10, rings=6)
    # barrel: stepped, rear sight, handguard, bands, nose cap, hooded front sight
    wlathe(mb, (0, -0.218, bz), (0, -0.783, bz), [(0, 0.0140), (0.10, 0.0132), (0.11, 0.0122), (0.45, 0.0112),
                                                  (0.46, 0.0104), (1.0, 0.0094)], 'gun_metal', seg=14)
    wbox(mb, (0, -0.215, bz + 0.017), (0.024, 0.040, 0.012), 'gun_metal', bevel=0.002, segs=2)
    wbox(mb, (0, -0.205, bz + 0.024), (0.016, 0.050, 0.004), 'gun_metal_worn', bevel=0.001)
    wloft(mb, [(-0.240, 0.0165, bz - 0.004, bz + 0.0160, 2.4), (-0.420, 0.0158, bz - 0.004, bz + 0.0150, 2.4)],
          'walnut', seg=14)
    wloft(mb, [(-0.420, 0.0200, -0.004, bz + 0.0185, 3.0), (-0.436, 0.0200, -0.004, bz + 0.0185, 3.0)],
          'gun_metal', seg=16)
    wtorus(mb, (0.021, -0.428, bz - 0.020), V((0, 0, 1)), 0.009, 0.0018, 'gun_metal', seg=10, tseg=4)
    wloft(mb, [(-0.616, 0.0180, 0.008, bz + 0.0165, 3.0), (-0.650, 0.0175, 0.010, bz + 0.0160, 3.0)],
          'gun_metal', seg=16)
    wbox(mb, (0, -0.640, 0.010), (0.010, 0.045, 0.012), 'gun_metal', bevel=0.002)
    wcyl(mb, (0, -0.650, bz - 0.019), (0, -0.788, bz - 0.019), 0.0036, 'gun_metal_worn', seg=8)
    wsphere(mb, (0, -0.789, bz - 0.019), 0.0045, 'gun_metal_worn', seg=8, rings=4)
    wbox(mb, (0, -0.758, bz + 0.018), (0.006, 0.014, 0.014), 'gun_metal', bevel=0.001)
    wtorus(mb, (0, -0.758, bz + 0.004), V((0, 1, 0)), 0.0165, 0.0018, 'gun_metal', seg=14, tseg=4, arc=0.5,
           start=-math.pi / 2)
    # trigger guard, floor plate, trigger
    wbox(mb, (0, -0.075, -0.039), (0.026, 0.090, 0.007), 'gun_metal', bevel=0.002)
    wtube(mb, [(0, -0.006, -0.034), (0, -0.010, -0.058), (0, -0.032, -0.067), (0, -0.056, -0.056),
               (0, -0.062, -0.040)], 0.0042, 'gun_metal', seg=8)
    wtube(mb, [(0, -0.030, -0.034), (0, -0.034, -0.046), (0, -0.030, -0.058)], 0.0026, 'gun_metal_worn', seg=6)
    for y in (-0.030, -0.115):
        wscrew(mb, (0, y, -0.043), (0, 0, -1), 0.0028)
    # sling on the left side: lower band swivel to the slot in the butt
    sling(mb, (0.024, -0.428, bz - 0.024), (0.023, 0.205, -0.084), 0.06, side=V((0, 0, 1)), keepers=(0.25,))
    obj = mb.build('kar98k')
    kit.set_anchors(obj, {'muzzle': (0, -0.789, bz), 'offhand': (0, -0.225, -0.010), 'clip': (0, 0.030, 0.118)})
    return obj


# ---- Thompson M1A1 -------------------------------------------------------

def build_thompson():
    mb = MeshBuilder()
    bz = 0.068
    # receiver: chamfered box, top rail, protected rear sight, cocking knob (right)
    wloft(mb, [(0.044, 0.0180, 0.040, 0.094, 5), (0.036, 0.0200, 0.038, 0.098, 5), (-0.180, 0.0200, 0.038, 0.098, 5),
               (-0.198, 0.0185, 0.044, 0.094, 4)], 'gun_metal', seg=16)
    wbox(mb, (0, -0.075, 0.101), (0.016, 0.20, 0.008), 'gun_metal', bevel=0.002)
    wbox(mb, (0, 0.026, 0.110), (0.006, 0.014, 0.020), 'gun_metal', bevel=0.001)
    for sx in (-0.008, 0.008):
        wbox(mb, (sx, 0.022, 0.112), (0.003, 0.022, 0.022), 'gun_metal', bevel=0.001)
    wbox(mb, (-0.0205, -0.060, 0.080), (0.002, 0.050, 0.016), 'gun_metal_worn', bevel=0.0006)   # ejection port
    wcyl(mb, (-0.020, -0.130, 0.080), (-0.032, -0.130, 0.080), 0.004, 'gun_metal', seg=8)
    wsphere(mb, (-0.034, -0.130, 0.080), 0.0075, 'gun_metal_worn', seg=10, rings=6)
    # trigger frame with selector + safety levers on the left, magazine catch
    wbox(mb, (0, -0.040, 0.026), (0.034, 0.170, 0.026), 'gun_metal', bevel=0.003, segs=2)
    for y in (-0.010, 0.012):
        wbox(mb, (0.019, y, 0.030), (0.004, 0.010, 0.020), 'gun_metal_worn', bevel=0.001)
    wbox(mb, (0, -0.128, 0.026), (0.022, 0.012, 0.012), 'gun_metal_worn', bevel=0.001)
    # barrel and front sight
    wlathe(mb, (0, -0.198, bz), (0, -0.455, bz), [(0, 0.0125), (0.05, 0.0118), (1.0, 0.0112)], 'gun_metal', seg=14)
    wbox(mb, (0, -0.444, bz + 0.016), (0.004, 0.012, 0.014), 'gun_metal', bevel=0.0008)
    wlathe(mb, (0, -0.446, bz), (0, -0.456, bz), [(0, 0.0128), (1.0, 0.0128)], 'gun_metal', seg=14)
    # walnut stock with butt plate and swivel
    wloft(mb, [(0.372, 0.0198, -0.104, 0.064, 3.0), (0.360, 0.0208, -0.100, 0.068), (0.300, 0.0212, -0.078, 0.072),
               (0.220, 0.0204, -0.046, 0.077), (0.140, 0.0196, -0.010, 0.082), (0.080, 0.0190, 0.020, 0.086),
               (0.048, 0.0186, 0.034, 0.090)], 'walnut', seg=18)
    wloft(mb, [(0.376, 0.0200, -0.106, 0.066, 3.0), (0.371, 0.0206, -0.107, 0.067, 3.0)], 'gun_metal', seg=18)
    wtorus(mb, (0.0, 0.270, -0.068), V((1, 0, 0)), 0.009, 0.0018, 'gun_metal', seg=10, tseg=4)
    # pistol grip (grooved walnut) and trigger guard
    wloft(mb, [(0.040, 0.0158, -0.072, 0.024, 2.4), (0.024, 0.0168, -0.070, 0.026, 2.4), (0.000, 0.0170, -0.064, 0.026, 2.4),
               (-0.018, 0.0160, -0.054, 0.024, 2.4)], 'walnut', seg=14)
    wtube(mb, [(0, -0.022, 0.016), (0, -0.026, -0.006), (0, -0.046, -0.014), (0, -0.064, -0.004), (0, -0.068, 0.016)],
          0.0042, 'gun_metal', seg=8)
    wtube(mb, [(0, -0.040, 0.016), (0, -0.044, 0.004), (0, -0.040, -0.006)], 0.0026, 'gun_metal_worn', seg=6)
    # the 30-round magazine is a separate node (thompson_mag_seated), see geom_thompson_mag
    # horizontal fore-end with grooves, front swivel
    fe = [(-0.205, 0.0180, bz - 0.040, bz - 0.010, 2.6), (-0.215, 0.0220, bz - 0.052, bz - 0.006, 2.6),
          (-0.330, 0.0218, bz - 0.050, bz - 0.006, 2.6), (-0.342, 0.0185, bz - 0.040, bz - 0.010, 2.6)]
    wloft(mb, fe, 'walnut', seg=16,
          groove=lambda k, x, z: 0.0018 if (k in (1, 2) and abs(z - (bz - 0.030)) < 0.004) else 0.0)
    wtorus(mb, (0.0, -0.320, bz - 0.058), V((1, 0, 0)), 0.008, 0.0018, 'gun_metal', seg=10, tseg=4)
    sling(mb, (0, -0.320, bz - 0.064), (0, 0.270, -0.076), 0.07, keepers=(0.3,), hook=0.55)
    obj = mb.build('thompson')
    kit.set_anchors(obj, {'muzzle': (0, -0.456, bz), 'offhand': (0, -0.245, bz - 0.042), 'mag': (0, -0.104, -0.130)})
    return obj


# ---- MP 40 ------------------------------------------------------------------

def build_mp40():
    mb = MeshBuilder()
    bz = 0.060
    # ribbed receiver tube
    prof = [(0.0, 0.0165), (0.02, 0.0178)]
    for k in range(7):
        t = 0.08 + 0.12 * k
        prof += [(t, 0.0178), (t + 0.02, 0.0168), (t + 0.06, 0.0168), (t + 0.08, 0.0178)]
    prof += [(0.98, 0.0178), (1.0, 0.0165)]
    wlathe(mb, (0, 0.078, bz), (0, -0.226, bz), prof, 'gun_metal', seg=14)
    wsphere(mb, (0, 0.080, bz), 0.0165, 'gun_metal', seg=12, rings=5, scale=(1, 0.45, 1))
    # cocking handle (left) with the safety notch
    wcyl(mb, (0.016, -0.040, bz + 0.006), (0.032, -0.040, bz + 0.006), 0.0040, 'gun_metal', seg=8)
    wsphere(mb, (0.036, -0.040, bz + 0.006), 0.0072, 'gun_metal_worn', seg=10, rings=6, scale=(0.7, 1, 1))
    wbox(mb, (0, 0.030, bz + 0.023), (0.016, 0.014, 0.010), 'gun_metal', bevel=0.001)
    wbox(mb, (0, 0.032, bz + 0.031), (0.010, 0.004, 0.010), 'gun_metal_worn', bevel=0.0008)
    # Bakelite lower frame and grip
    wloft(mb, [(0.060, 0.0150, bz - 0.040, bz - 0.012, 4), (-0.070, 0.0150, bz - 0.040, bz - 0.012, 4)], 'bakelite', seg=12)
    wloft(mb, [(0.036, 0.0150, -0.072, 0.034, 2.4), (0.016, 0.0162, -0.070, 0.035, 2.4), (-0.002, 0.0164, -0.064, 0.035, 2.4),
               (-0.016, 0.0152, -0.056, 0.032, 2.4)], 'bakelite', seg=14)
    wtube(mb, [(0, -0.016, 0.030), (0, -0.020, 0.002), (0, -0.042, -0.008), (0, -0.058, 0.008), (0, -0.060, 0.030)],
          0.0040, 'gun_metal', seg=8)
    wtube(mb, [(0, -0.034, 0.030), (0, -0.038, 0.018), (0, -0.034, 0.008)], 0.0025, 'gun_metal_worn', seg=6)
    # ribbed magazine housing, magazine with release button
    wbox(mb, (0, -0.106, bz - 0.052), (0.032, 0.044, 0.074), 'gun_metal', bevel=0.003, segs=2)
    for sx in (-0.0165, 0.0165):
        for k in range(3):
            wbox(mb, (sx, -0.094 - k * 0.012, bz - 0.052), (0.002, 0.005, 0.066), 'gun_metal', bevel=0.0006)
    wcyl(mb, (0.017, -0.096, bz - 0.030), (0.022, -0.096, bz - 0.030), 0.0045, 'gun_metal_worn', seg=8)
    # the magazine is a separate node (mp40_mag_seated), see geom_mp40_mag
    # barrel with the resting bar, front sight hood, muzzle cap
    wlathe(mb, (0, -0.226, bz), (0, -0.422, bz), [(0, 0.0135), (0.03, 0.0110), (1.0, 0.0102)], 'gun_metal', seg=14)
    wbox(mb, (0, -0.330, bz - 0.018), (0.018, 0.080, 0.016), 'bakelite', bevel=0.003, segs=2)
    wlathe(mb, (0, -0.408, bz), (0, -0.424, bz), [(0, 0.0118), (1.0, 0.0118)], 'gun_metal', seg=14)
    wbox(mb, (0, -0.414, bz + 0.016), (0.004, 0.010, 0.012), 'gun_metal', bevel=0.0008)
    wtorus(mb, (0, -0.414, bz + 0.010), V((0, 1, 0)), 0.0125, 0.0018, 'gun_metal', seg=12, tseg=4, arc=0.5,
           start=-math.pi / 2)
    # folding stock, extended: hinge, two struts, pressed butt plate
    wcyl(mb, (-0.014, 0.070, bz - 0.032), (0.014, 0.070, bz - 0.032), 0.0060, 'gun_metal', seg=10)
    for sx in (-0.012, 0.012):
        wcyl(mb, (sx, 0.070, bz - 0.032), (sx, 0.398, bz - 0.056), 0.0055, 'gun_metal', seg=8)
    wcyl(mb, (-0.012, 0.300, bz - 0.049), (0.012, 0.300, bz - 0.049), 0.0035, 'gun_metal', seg=6)
    Rb = Matrix.Rotation(rad(6), 3, 'X')
    wbox(mb, (0, 0.402, bz - 0.062), (0.040, 0.008, 0.124), 'gun_metal', bevel=0.004, rot=Rb, segs=2)
    wbox(mb, (0, 0.397, bz - 0.010), (0.030, 0.012, 0.010), 'gun_metal', bevel=0.002, rot=Rb)
    # sling swivels (the sling itself is left off: it hangs too freely to model rigidly)
    swivel(mb, (0, -0.235, bz - 0.020), axis=V((1, 0, 0)), r=0.007)
    wtorus(mb, (0.017, 0.050, bz - 0.030), V((1, 0, 0)), 0.006, 0.0016, 'gun_metal', seg=10, tseg=4)
    obj = mb.build('mp40')
    kit.set_anchors(obj, {'muzzle': (0, -0.424, bz), 'offhand': (0, -0.150, bz - 0.032), 'mag': (0, -0.106, -0.130)})
    return obj


# ---- MG 42 ------------------------------------------------------------------

def build_mg42():
    """Origin at the bipod feet centre; the bipod stands on the ground."""
    mb = MeshBuilder()
    bz = 0.300
    hw, hh, zc = 0.029, 0.027, bz + 0.004
    y0, y1 = -0.098, 0.392                     # jacket from the muzzle end to the receiver
    L = y1 - y0
    holes = [0.035 + i * 0.058 for i in range(8)]
    # left (+X), right (-X) and top faces with oval cooling holes; plain bottom
    panel_with_holes(mb, (hw, y1, zc - hh), (0, -1, 0), (0, 0, 1), (1, 0, 0), L, 2 * hh, holes, 0.019, 0.011,
                     0.0016, 'gun_metal_worn')
    panel_with_holes(mb, (-hw, y1, zc - hh), (0, -1, 0), (0, 0, 1), (-1, 0, 0), L, 2 * hh, holes, 0.019, 0.011,
                     0.0016, 'gun_metal_worn')
    panel_with_holes(mb, (-hw, y1, zc + hh), (0, -1, 0), (1, 0, 0), (0, 0, 1), L, 2 * hw, holes, 0.019, 0.012,
                     0.0016, 'gun_metal_worn')
    wbox(mb, (0, (y0 + y1) / 2, zc - hh + 0.001), (2 * hw, L, 0.003), 'gun_metal_worn')
    for sx in (-1, 1):
        for sz in (-1, 1):
            wcyl(mb, (sx * hw, y1, zc + sz * hh), (sx * hw, y0, zc + sz * hh), 0.0022, 'gun_metal_worn', seg=6)
    # the barrel inside, muzzle booster, front sight, barrel change hatch (right)
    wlathe(mb, (0, 0.40, bz), (0, -0.11, bz), [(0, 0.0120), (1.0, 0.0105)], 'gun_metal', seg=12)
    wlathe(mb, (0, y0, bz), (0, -0.208, bz), [(0, 0.031), (0.15, 0.028), (0.5, 0.026), (0.8, 0.021), (1.0, 0.017)],
           'gun_metal', seg=16)
    wbox(mb, (0, -0.080, bz + 0.042), (0.004, 0.012, 0.030), 'gun_metal', bevel=0.0008)
    wbox(mb, (-hw - 0.003, 0.330, zc), (0.004, 0.110, 0.042), 'gun_metal', bevel=0.002)
    wbox(mb, (-hw - 0.010, 0.385, zc - 0.006), (0.012, 0.016, 0.014), 'gun_metal', bevel=0.002)
    # receiver, feed cover with the tangent rear sight, cocking handle (right)
    wloft(mb, [(0.392, 0.032, bz - 0.044, bz + 0.040, 5), (0.400, 0.034, bz - 0.046, bz + 0.042, 5),
               (0.700, 0.034, bz - 0.046, bz + 0.040, 5), (0.712, 0.030, bz - 0.040, bz + 0.034, 4)], 'gun_metal', seg=16)
    wloft(mb, [(0.420, 0.037, bz + 0.036, bz + 0.058, 3), (0.600, 0.037, bz + 0.036, bz + 0.058, 3)], 'gun_metal', seg=12)
    wbox(mb, (0, 0.410, bz + 0.060), (0.022, 0.030, 0.010), 'gun_metal', bevel=0.002)
    wbox(mb, (0, 0.402, bz + 0.072), (0.014, 0.020, 0.018), 'gun_metal_worn', bevel=0.001)
    wbox(mb, (0, 0.470, bz - 0.040), (0.058, 0.028, 0.012), 'gun_metal_worn', bevel=0.002)     # feed tray
    wcyl(mb, (-0.036, 0.560, bz + 0.004), (-0.060, 0.560, bz + 0.004), 0.0045, 'gun_metal', seg=8)
    wsphere(mb, (-0.064, 0.560, bz + 0.004), 0.008, 'gun_metal_worn', seg=10, rings=6)
    wcyl(mb, (-0.035, 0.520, bz - 0.010), (-0.035, 0.640, bz - 0.010), 0.0035, 'gun_metal', seg=6)
    # trigger housing, pistol grip, guard
    wbox(mb, (0, 0.630, bz - 0.058), (0.032, 0.090, 0.026), 'gun_metal', bevel=0.003, segs=2)
    wloft(mb, [(0.668, 0.0160, bz - 0.150, bz - 0.046, 2.4), (0.648, 0.0172, bz - 0.150, bz - 0.046, 2.4),
               (0.628, 0.0168, bz - 0.142, bz - 0.046, 2.4), (0.612, 0.0156, bz - 0.132, bz - 0.046, 2.4)],
          'bakelite', seg=14)
    wtube(mb, [(0, 0.606, bz - 0.066), (0, 0.600, bz - 0.096), (0, 0.578, bz - 0.104), (0, 0.556, bz - 0.090),
               (0, 0.552, bz - 0.066)], 0.0042, 'gun_metal', seg=8)
    wtube(mb, [(0, 0.585, bz - 0.068), (0, 0.582, bz - 0.080), (0, 0.586, bz - 0.090)], 0.0028, 'gun_metal_worn', seg=6)
    # Bakelite butt stock with the shoulder piece
    wloft(mb, [(0.712, 0.026, bz - 0.038, bz + 0.030, 3), (0.760, 0.025, bz - 0.050, bz + 0.026, 3),
               (0.840, 0.022, bz - 0.076, bz + 0.024, 2.8), (0.960, 0.022, bz - 0.104, bz + 0.030, 2.8),
               (1.020, 0.023, bz - 0.112, bz + 0.034, 3), (1.034, 0.023, bz - 0.112, bz + 0.034, 3)], 'bakelite', seg=16)
    wloft(mb, [(1.034, 0.024, bz - 0.116, bz + 0.038, 3.2), (1.044, 0.024, bz - 0.114, bz + 0.036, 3.2)],
          'gun_metal', seg=16)
    wbox(mb, (0, 1.000, bz + 0.040), (0.020, 0.050, 0.010), 'gun_metal', bevel=0.002)
    # 50-round belt drum on the left of the feed tray, the belt going in
    wlathe(mb, (0.050, 0.470, bz - 0.036), (0.112, 0.470, bz - 0.036), [(0, 0.056), (0.04, 0.060), (0.96, 0.060),
                                                                        (1.0, 0.056)], 'gun_metal_worn', seg=18,
           ref=V((0, 0, 1)))
    wbox(mb, (0.081, 0.470, bz + 0.028), (0.050, 0.010, 0.012), 'gun_metal', bevel=0.002)
    for k in range(4):
        y = 0.455 + 0.0 * k
        cartridge(mb, (0.050 - k * 0.014, 0.446, bz - 0.012 - k * 0.004), (0, -1, 0), length=0.080, r=0.0058, tip=0.028)
        wbox(mb, (0.050 - k * 0.014, 0.430, bz - 0.012 - k * 0.004), (0.010, 0.010, 0.014), 'gun_metal', bevel=0.001)
    # bipod: clamp at the front of the jacket, two legs with feet
    wbox(mb, (0, -0.030, zc - hh - 0.012), (0.044, 0.030, 0.016), 'gun_metal', bevel=0.003, segs=2)
    for sx in (-1, 1):
        top = V((sx * 0.014, -0.030, zc - hh - 0.018))
        foot = V((sx * 0.150, -0.030, 0.014))
        wcyl(mb, top, foot, 0.0085, 'gun_metal', seg=8)
        wcyl(mb, top.lerp(foot, 0.45), foot, 0.0070, 'gun_metal_worn', seg=8)
        wbox(mb, (sx * 0.153, -0.030, 0.007), (0.030, 0.046, 0.014), 'gun_metal', bevel=0.003, segs=2)
    obj = mb.build('mg42')
    kit.set_anchors(obj, {'muzzle': (0, -0.208, bz), 'offhand': (0, 0.86, bz + 0.035),
                          'grip': (0, 0.64, bz - 0.095)})
    return obj


# ---- grenades -------------------------------------------------------------

def build_grenade_us():
    """Mk 2 'pineapple', origin at its centre, fuze up (+Z), spoon on +X."""
    mb = MeshBuilder()
    nu, nv = 32, 16
    rings = []
    for k in range(nv + 1):
        t = k / nv
        z = -0.044 + 0.080 * t
        prof = math.sin(math.pi * min(1.0, 0.04 + 0.96 * t)) ** 0.62
        r0 = 0.029 * prof
        ring = []
        for i in range(nu):
            a = 2 * math.pi * i / nu
            col = abs(math.cos(4 * a)) ** 0.25          # 8 columns of segments
            row = abs(math.sin(math.pi * (t * 5.0 + 0.5))) ** 0.3 if 0.08 < t < 0.94 else 1.0
            groove = 0.85 + 0.15 * min(col, row)
            ring.append(V((math.cos(a) * r0 * groove, math.sin(a) * r0 * groove, z)))
        rings.append(ring)
    mb.loft(rings, 'metal_olive', W0, C1, cap0=V((0, 0, -0.046)), cap1=True, smooth=True)
    wlathe(mb, (0, 0, 0.032), (0, 0, 0.054), [(0, 0.0105), (0.4, 0.0090), (1.0, 0.0085)], 'gun_metal', seg=12)
    wstrap(mb, [(0.006, 0, 0.054), (0.020, 0, 0.046), (0.031, 0, 0.022), (0.033, 0, -0.004), (0.029, 0, -0.022)],
           0.012, 0.0024, 'metal_olive', side=V((0, 1, 0)))
    wtorus(mb, (-0.020, 0.0, 0.050), V((0, 1, 0)), 0.0095, 0.0011, 'gun_metal_worn', seg=12, tseg=4)
    wcyl(mb, (-0.004, 0, 0.048), (-0.012, 0, 0.049), 0.0011, 'gun_metal_worn', seg=4)
    return mb.build('grenade_us')


def build_grenade_de():
    """Stielhandgranate 24, origin at its centre of mass, head towards -Y."""
    mb = MeshBuilder()
    hc = -0.053
    wlathe(mb, (0, hc + 0.040, 0), (0, hc - 0.040, 0), [(0, 0.030), (0.06, 0.034), (0.20, 0.0352), (0.85, 0.0352),
                                                       (0.96, 0.033), (1.0, 0.028)], 'metal_gray', seg=16)
    wlathe(mb, (0, hc + 0.040, 0), (0, hc + 0.050, 0), [(0, 0.018), (1.0, 0.016)], 'gun_metal_worn', seg=12)
    wlathe(mb, (0, hc + 0.050, 0), (0, 0.256, 0), [(0, 0.0160), (0.05, 0.0152), (1.0, 0.0140)], 'walnut', seg=12)
    wlathe(mb, (0, 0.256, 0), (0, 0.272, 0), [(0, 0.0150), (0.7, 0.0150), (1.0, 0.0125)], 'gun_metal_worn', seg=12)
    wstrap(mb, [(0.0, 0.035, 0.0165), (0.0, 0.010, 0.0170), (0.0, -0.002, 0.0150)], 0.010, 0.002, 'gun_metal_worn',
           side=V((1, 0, 0)))
    return mb.build('grenade_de')


# ---- reload props ------------------------------------------------------------
# Each prop is modelled in its gun's space at the seated position, then moved
# into "hand space": origin at the point the left hand holds it and axes such
# that, parented to socket_weapon_l with an identity transform, it sits in the
# left hand exactly as the reload clips carry it. At the clips' "seat" frames
# the left hand's grip frame is, in gun space, Tr(hold) @ grip, so the prop in
# the hand coincides with its seat.

SOCKET_L_ROLL, SOCKET_L_YAW = 0.0, -20.0        # socket_weapon_l: the fore-end hold of the low ready


def lgrip_socket():
    return _lgf(SOCKET_L_ROLL, SOCKET_L_YAW)


def _lgf(roll=0.0, yaw=0.0):
    """left_grip_frame (defined further down) for module-level constants."""
    base = axes_matrix(V((1, 0, 0)), V((0, -1, 0)), V((0, 0, -1)))
    return Matrix.Rotation(rad(roll), 4, 'Y') @ base @ Matrix.Rotation(rad(yaw), 4, 'Z')


# left-hand grip orientations (gun space) fitted for a straight wrist in the reload key poses:
# pushing the clip: hand from the left of the receiver, fingers curled over its top;
# magazine: a fist round the magazine body, thumb up.
G_PUSH = (Matrix.Rotation(rad(-180), 3, 'Z') @ Matrix.Rotation(rad(-30), 3, 'Y') @ Matrix.Rotation(rad(-20), 3, 'X')
          ).to_4x4() @ _lgf(180.0, 0.0)
G_MAG = (Matrix.Rotation(rad(-80), 3, 'Z') @ Matrix.Rotation(rad(10), 3, 'Y')
         ).to_4x4() @ axes_matrix(V((0, 1, 0)), V((0, 0, 1)), V((1, 0, 0)))
POLE_PUSH = V((0.687, -0.722, -0.076))          # left elbow poles (chest-delta space) for these grips
POLE_MAG = V((0.750, -0.641, 0.161))
# reload stagings (chest-delta space): the weapon canted out to the right in front of the right
# shoulder, receiver / magazine well turned towards a camera behind the right shoulder; right
# elbow poles fitted for them (right wrist ~30 deg)
RELOAD_RIFLE = dict(pos=(-0.21, -0.20, 1.20), yaw=10, pitch=0, roll=-36)
RELOAD_SMG = dict(pos=(-0.21, -0.21, 1.19), yaw=10, pitch=0, roll=-34)
POLE_R_RIFLE = V((-0.774, 0.598, -0.208))
POLE_R_SMG = V((-0.829, 0.541, -0.144))


def geom_thompson_mag(mb):
    R3 = Matrix.Rotation(rad(-2), 3, 'X')
    wbox(mb, (0, -0.104, -0.088), (0.0245, 0.040, 0.230), 'gun_metal', bevel=0.003, rot=R3, segs=2)
    for k in range(4):
        wbox(mb, (0, -0.104, -0.150 + k * 0.040), (0.026, 0.030, 0.006), 'gun_metal', bevel=0.001, rot=R3)
    wbox(mb, (0, -0.105, -0.204), (0.027, 0.043, 0.006), 'gun_metal_worn', bevel=0.002, rot=R3)
    cartridge(mb, (0, -0.088, 0.026), (0, -1, 0), length=0.032, r=0.0058, tip=0.016)      # .45 round on top


def geom_mp40_mag(mb):
    bz = 0.060
    wbox(mb, (0, -0.106, bz - 0.200), (0.023, 0.034, 0.240), 'gun_metal_worn', bevel=0.0025, segs=2)
    for k in range(3):
        wbox(mb, (0.0122, -0.106, bz - 0.150 - 0.05 * k), (0.002, 0.020, 0.030), 'gun_metal_worn', bevel=0.0006)
    wbox(mb, (0, -0.106, bz - 0.322), (0.025, 0.037, 0.006), 'gun_metal', bevel=0.0015)
    cartridge(mb, (0, -0.093, bz - 0.079), (0, -1, 0), length=0.029, r=0.0048, tip=0.014)


def geom_garand_clip(mb):
    """En-bloc clip with eight .30-06 rounds in two staggered columns."""
    for k in range(4):
        for col, (x, z0) in enumerate(((0.0049, 0.0585), (-0.0049, 0.0535))):
            cartridge(mb, (x, -0.074, z0 - 0.0103 * k), (0, -1, 0), length=0.084, r=0.0060, tip=0.029)
    for sx in (-1, 1):
        wbox(mb, (sx * 0.0122, -0.110, 0.042), (0.0016, 0.062, 0.048), 'gun_metal_worn', bevel=0.0005)
        wbox(mb, (sx * 0.0100, -0.110, 0.0668), (0.0045, 0.062, 0.0016), 'gun_metal_worn', bevel=0.0005)
    wbox(mb, (0, -0.078, 0.042), (0.0244, 0.0016, 0.044), 'gun_metal_worn', bevel=0.0005)


def geom_kar98k_clip(mb):
    """Stripper clip with five 7.92 mm rounds, standing in the charger guides."""
    bz = 0.048
    for k in range(5):
        cartridge(mb, (0, 0.034, bz + 0.010 + 0.0118 * k), (0, -1, 0), length=0.080, r=0.0059, tip=0.028)
    wbox(mb, (0, 0.037, bz + 0.034), (0.013, 0.0016, 0.066), 'gun_metal_worn', bevel=0.0004)
    for sx in (-1, 1):
        wbox(mb, (sx * 0.0058, 0.035, bz + 0.034), (0.0016, 0.004, 0.066), 'gun_metal_worn', bevel=0.0004)


PROPS = {
    'garand_clip': dict(gun='m1_garand', hold=V((0, -0.114, 0.074)), grip=G_PUSH, anchor='clip',
                        geom=geom_garand_clip, seated=False),
    'kar98k_clip': dict(gun='kar98k', hold=V((0, 0.030, 0.118)), grip=G_PUSH, anchor='clip',
                        geom=geom_kar98k_clip, seated=False),
    'thompson_mag': dict(gun='thompson', hold=V((0, -0.104, -0.130)), grip=G_MAG, anchor='mag',
                         geom=geom_thompson_mag, seated=True),
    'mp40_mag': dict(gun='mp40', hold=V((0, -0.106, -0.130)), grip=G_MAG, anchor='mag',
                     geom=geom_mp40_mag, seated=True),
}
PROP_NAMES = ['garand_clip', 'kar98k_clip', 'thompson_mag', 'mp40_mag']


def prop_seat(name):
    """Prop local space -> gun space when seated (4x4)."""
    d = PROPS[name]
    R4 = (d['grip'].to_3x3() @ lgrip_socket().to_3x3().inverted()).to_4x4()
    return Matrix.Translation(d['hold']) @ R4


def prop_grip(name, offset=(0, 0, 0)):
    """The left hand's grip frame (gun space) holding the prop at its seat,
    optionally shifted by `offset` (gun axes)."""
    d = PROPS[name]
    return Matrix.Translation(d['hold'] + V(offset)) @ d['grip'].to_3x3().to_4x4()


def build_prop(name):
    mb = MeshBuilder()
    PROPS[name]['geom'](mb)
    M = prop_seat(name).inverted()
    mb.co = [M @ c for c in mb.co]
    return mb.build(name)


WEAPONS = ['m1_garand', 'thompson', 'kar98k', 'mp40', 'mg42', 'grenade_us', 'grenade_de']
WEAPON_BUILDERS = {'m1_garand': build_m1_garand, 'thompson': build_thompson, 'kar98k': build_kar98k,
                   'mp40': build_mp40, 'mg42': build_mg42, 'grenade_us': build_grenade_us,
                   'grenade_de': build_grenade_de}
WEAPON_TEX = {'m1_garand': 1024, 'kar98k': 1024, 'thompson': 1024, 'mp40': 1024, 'mg42': 1024,
              'grenade_us': 256, 'grenade_de': 256, 'garand_clip': 256, 'kar98k_clip': 256,
              'thompson_mag': 256, 'mp40_mag': 256}


# ==========================================================================
# Pose solver.
#
# A pose `P` is a dict:
#   'root'   4x4 rigid transform of the whole body (deaths), default identity
#   'hips'   (offset Vector, R 3x3) — R about the hips head, armature axes
#   'spine', 'chest', 'neck', 'head', 'clavicle_l', 'clavicle_r': R 3x3,
#            a rotation in armature axes about the bone head, applied in the
#            parent's frame as if the parent were at rest (basis = rest^-1 R rest)
#   'leg_l', 'leg_r': ('ik', T, pole) foot transform T (4x4, root space, applied
#            to the rest foot) | ('fk', R_thigh, R_shin, R_foot)
#   'arm_l', 'arm_r': ('weapon',) | ('ik', M_hand (armature space), pole) |
#            ('fk', R_upper, R_fore, R_hand)
#   'weapon' 4x4 placement (weapon space -> chest-delta space, or root space
#            when 'wspace' == 'root'); 'pole_l'/'pole_r' elbow pole vectors in
#            the same space; 'lroll' roll (deg) of the left hand about the bar.

def Rx(a):
    return Matrix.Rotation(rad(a), 3, 'X')


def Ry(a):
    return Matrix.Rotation(rad(a), 3, 'Y')


def Rz(a):
    return Matrix.Rotation(rad(a), 3, 'Z')


def R(p=0.0, r=0.0, y=0.0):
    """Rotation in armature axes: pitch about X, roll about Y, yaw about Z
    (applied in that order). For a bone pointing UP (spine, neck) + pitch bends
    it forward; for a bone pointing DOWN (thigh, shin, arms) + pitch swings its
    end backward (hip extension, knee flexion), - pitch forward (hip/shoulder
    flexion, elbow flexion). + roll tips the top towards +X (the character's
    left); + yaw turns towards the left."""
    return Rz(y) @ Ry(r) @ Rx(p)


def place(pos, yaw=0.0, pitch=0.0, roll=0.0):
    """Weapon placement: muzzle direction from -Y, yaw + turns the muzzle left,
    pitch + raises it, roll + tips the top to the left."""
    return Matrix.Translation(V(pos)) @ (Rz(yaw) @ Rx(-pitch) @ Ry(roll)).to_4x4()


def T4(R3=None, t=None):
    M = (R3 if R3 is not None else Matrix.Identity(3)).to_4x4()
    if t is not None:
        M.translation = V(t)
    return M


class Skel:
    def __init__(self, rig):
        bones = rig.data.bones
        self.rig = rig
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.rest_inv = {n: m.inverted() for n, m in self.rest.items()}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.length = {b.name: b.length for b in bones}
        # IK sign so the hinge axis matches the bones' rest X axes
        self.sign = {}
        for up, lo in (('upperarm_l', 'forearm_l'), ('upperarm_r', 'forearm_r'),
                       ('thigh_l', 'shin_l'), ('thigh_r', 'shin_r')):
            yu = self.rest[up].to_3x3().col[1]
            yl = self.rest[lo].to_3x3().col[1]
            xu = self.rest[up].to_3x3().col[0]
            self.sign[up] = 1.0 if yu.cross(yl).dot(xu) > 0 else -1.0
        # grip frames in hand-bone space
        self.grip = {s: self.rest_inv['hand_' + s] @ grip_frame_world(s) for s in 'lr'}

    def head(self, n):
        return self.rest[n].translation.copy()

    def tail(self, n):
        return self.rest[n] @ V((0, self.length[n], 0))


def two_bone(S, W, a, b, pole, sign, arm=True):
    """Analytic 2-bone IK. Returns (M_upper, M_lower, reach) with M as 4x4
    armature matrices (Y along the bone, X the hinge axis)."""
    d_vec = W - S
    d = d_vec.length
    reach = d / (a + b)
    d = max(abs(a - b) + 1e-4, min(a + b - 1e-4, d))
    u = d_vec.normalized()
    v = pole - u * pole.dot(u)
    if v.length < 1e-6:
        v = V((0, 0, -1)) - u * (-u.z)
    v.normalize()
    x = (a * a - b * b + d * d) / (2 * d)
    h = math.sqrt(max(0.0, a * a - x * x))
    E = S + u * x + v * h
    Wc = S + u * d
    yu = (E - S).normalized()
    yl = (Wc - E).normalized()
    X = (-sign) * u.cross(v).normalized()
    Mu = axes_matrix(X, yu, X.cross(yu), S)
    Ml = axes_matrix(X, yl, X.cross(yl), E)
    return Mu, Ml, reach


class Solved:
    def __init__(self):
        self.M = {}
        self.reach = {}
        self.weapon = None
        self.wrist = {}


def left_grip_frame(roll=0.0, yaw=0.0):
    """Left-hand grip frame in weapon space (rotation only): thumb towards the
    muzzle (-Y), back of the hand down, rolled about the bar by `roll` and
    turned by `yaw` about the vertical (bar lying diagonally in the palm)."""
    base = axes_matrix(V((1, 0, 0)), V((0, -1, 0)), V((0, 0, -1)))
    return Matrix.Rotation(rad(roll), 4, 'Y') @ base @ Matrix.Rotation(rad(yaw), 4, 'Z')


def solve_pose(sk, P, socket, offhand):
    """Armature-space matrices of every bone for pose P."""
    out = Solved()
    M = out.M
    I3 = Matrix.Identity(3)

    def delta(name):
        par = sk.parent[name]
        return M[par] @ sk.rest_inv[par] if par else Matrix.Identity(4)

    def fk(name, R3=None, off=None):
        D = delta(name)
        h = sk.head(name)
        L = Matrix.Translation(h) @ (R3 if R3 is not None else I3).to_4x4() @ Matrix.Translation(-h)
        if off is not None:
            L = Matrix.Translation(off) @ L
        M[name] = D @ L @ sk.rest[name]

    root = P.get('root', Matrix.Identity(4))
    M['root'] = root @ sk.rest['root']
    off, Rh = P.get('hips', (V((0, 0, 0)), I3))
    fk('hips', Rh, off)
    for n in ('spine', 'chest', 'neck', 'head', 'clavicle_l', 'clavicle_r'):
        fk(n, P.get(n))
    D_root = M['root'] @ sk.rest_inv['root']
    D_chest = M['chest'] @ sk.rest_inv['chest']

    # legs
    for s in 'lr':
        spec = P.get('leg_' + s, ('fk', None, None, None))
        th, sh, ft = 'thigh_' + s, 'shin_' + s, 'foot_' + s
        if spec[0] == 'ik':
            T, pole = spec[1], spec[2]
            Mf = D_root @ T @ sk.rest[ft]
            S = (delta(th) @ sk.rest[th]).translation
            Wp = Mf.translation
            pole_w = D_root.to_3x3() @ V(pole)
            Mu, Ml, reach = two_bone(S, Wp, sk.length[th], sk.length[sh], pole_w, sk.sign[th])
            M[th], M[sh] = Mu, Ml
            Mf.translation = Ml @ V((0, sk.length[sh], 0))
            M[ft] = Mf
            out.reach[s + '_leg'] = reach
        else:
            fk(th, spec[1])
            fk(sh, spec[2])
            fk(ft, spec[3])

    # weapon
    if 'weapon' in P:
        base = D_root if P.get('wspace') == 'root' else D_chest
        out.weapon = base @ P['weapon']
        pole_base = base.to_3x3()
    else:
        pole_base = D_chest.to_3x3()

    for s in 'lr':
        spec = P.get('arm_' + s, ('fk', None, None, None))
        ua, fa, hd = 'upperarm_' + s, 'forearm_' + s, 'hand_' + s
        if spec[0] == 'fk':
            fk(ua, spec[1])
            fk(fa, spec[2])
            fk(hd, spec[3])
            continue
        if spec[0] == 'weapon':
            if s == 'r':
                Mh = out.weapon @ socket.inverted()
            else:
                G = Matrix.Translation(offhand) @ left_grip_frame(P.get('lroll', 0.0), P.get('lyaw', 0.0))
                Mh = out.weapon @ G @ sk.grip['l'].inverted()
            pole = pole_base @ V(P['pole_' + s])
        else:
            Mh, pole = spec[1], V(spec[2])
        S = (delta(ua) @ sk.rest[ua]).translation
        Mu, Ml, reach = two_bone(S, Mh.translation, sk.length[ua], sk.length[fa], pole, sk.sign[ua])
        M[ua], M[fa] = Mu, Ml
        Mh = Mh.copy()
        Mh.translation = Ml @ V((0, sk.length[fa], 0))
        M[hd] = Mh
        out.reach[s + '_arm'] = reach
        yf = Ml.to_3x3().col[1]
        yh = Mh.to_3x3().col[1]
        out.wrist[s] = math.degrees(yf.angle(yh))
    return out


def bases(sk, M):
    """Pose-bone basis matrices (local) from armature matrices."""
    B = {}
    for n in BONE_ORDER:
        par = sk.parent[n]
        D = M[par] @ sk.rest_inv[par] if par else Matrix.Identity(4)
        B[n] = sk.rest_inv[n] @ D.inverted() @ M[n]
    return B


def foot_T(ankle=None, R3=None, side='l', base=None):
    """Foot transform: rotate the rest foot by R3 about its ankle and move the
    ankle to `ankle` (root space)."""
    a0 = (ANKLE_L if side == 'l' else _mx(ANKLE_L)).copy()
    R3 = R3 if R3 is not None else Matrix.Identity(3)
    tgt = V(ankle) if ankle is not None else a0
    return Matrix.Translation(tgt) @ R3.to_4x4() @ Matrix.Translation(-a0)


# ==========================================================================
# Keyframes

def write_action(rig, name, frames, loc_bones=('root', 'hips')):
    """frames: list of {bone: basis 4x4}. Keys every frame (linear)."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    n = len(frames)
    for b in BONE_ORDER:
        group = b
        quats, locs = [], []
        prev = None
        for B in frames:
            q = B[b].to_quaternion()
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            quats.append(q)
            prev = q
            locs.append(B[b].to_translation())
        path_q = f'pose.bones["{b}"].rotation_quaternion'
        for i in range(4):
            fc = act.fcurve_ensure_for_datablock(rig, path_q, index=i, group_name=group)
            fc.keyframe_points.add(n)
            co = []
            for f, q in enumerate(quats):
                co += (float(f), q[i])
            fc.keyframe_points.foreach_set('co', co)
            fc.keyframe_points.foreach_set('interpolation', [1] * n)    # LINEAR
            fc.update()
        if b in loc_bones:
            path_l = f'pose.bones["{b}"].location'
            for i in range(3):
                fc = act.fcurve_ensure_for_datablock(rig, path_l, index=i, group_name=group)
                fc.keyframe_points.add(n)
                co = []
                for f, l in enumerate(locs):
                    co += (float(f), l[i])
                fc.keyframe_points.foreach_set('co', co)
                fc.keyframe_points.foreach_set('interpolation', [1] * n)
                fc.update()
    act.frame_range = (0, n - 1)
    return act


# ==========================================================================
# Clip authoring helpers

# frames at which the game moves reload props (see notes/soldier.md)
RELOAD_EVENTS = {
    'reload': {'clip_in_hand': 21, 'clip_seated': 36, 'oprod_slap': 47},
    'reload_smg': {'mag_grab': 8, 'mag_out': 17, 'mag_drop': 21, 'new_mag_in_hand': 31, 'mag_seated': 45,
                   'bolt_back': 57},
}

def ease(t, kind='io'):
    t = max(0.0, min(1.0, t))
    if kind == 'in':
        return t * t
    if kind == 'out':
        return 1 - (1 - t) ** 2
    if kind == 'lin':
        return t
    return t * t * (3 - 2 * t)


def slerp3(A, B, t):
    return A.to_quaternion().slerp(B.to_quaternion(), t).to_matrix()


def interp4(A, B, t):
    q = A.to_quaternion().slerp(B.to_quaternion(), t)
    M = q.to_matrix().to_4x4()
    M.translation = A.translation.lerp(B.translation, t)
    return M


def grip_target(pos, ydir, zdir):
    """A grip frame (armature space) at pos: Y = pinky->thumb, Z = back of hand."""
    Y = V(ydir).normalized()
    Z = V(zdir)
    Z = (Z - Y * Z.dot(Y)).normalized()
    return axes_matrix(Y.cross(Z), Y, Z, V(pos))


def hand_from_grip(sk, side, G):
    return G @ sk.grip[side].inverted()


def fk_extract(sk, M):
    """FK description (root, hips offset, R per bone) of solved matrices."""
    P = {'root': M['root'] @ sk.rest_inv['root']}
    for n in BONE_ORDER[1:]:
        par = sk.parent[n]
        D = M[par] @ sk.rest_inv[par]
        L = D.inverted() @ M[n] @ sk.rest_inv[n]
        R3 = L.to_3x3().normalized()
        h = sk.head(n)
        off = L.translation - (h - R3 @ h)
        P[n] = R3
        if n == 'hips':
            P['hips_off'] = off
    return P


def fk_pose(F):
    """Turn an fk_extract-like dict into a solve_pose dict."""
    P = {'root': F['root'], 'hips': (F.get('hips_off', V((0, 0, 0))), F['hips'])}
    for n in ('spine', 'chest', 'neck', 'head', 'clavicle_l', 'clavicle_r'):
        P[n] = F[n]
    for s in 'lr':
        P['leg_' + s] = ('fk', F['thigh_' + s], F['shin_' + s], F['foot_' + s])
        P['arm_' + s] = ('fk', F['upperarm_' + s], F['forearm_' + s], F['hand_' + s])
    return P


def fk_blend(A, B, t):
    out = {}
    for k in A:
        if k == 'root':
            out[k] = interp4(A[k], B[k], t)
        elif k == 'hips_off':
            out[k] = A[k].lerp(B[k], t)
        else:
            out[k] = slerp3(A[k], B[k], t)
    return out


def fk_apply(base, delta):
    """Compose authored rotations on top of a FK pose: delta {bone: R} is
    pre-multiplied (armature axes), 'root' / 'hips_off' replaced if present."""
    out = dict(base)
    for k, v in delta.items():
        if k in ('root', 'hips_off'):
            out[k] = v
        elif k == 'root_mul':
            out['root'] = v @ base['root']
        elif k == 'hips_add':
            out['hips_off'] = base['hips_off'] + v
        else:
            out[k] = v @ base[k]
    return out


EYE_R = HEAD_C + V((-0.033, -0.074, -0.004))     # right eye, rest pose (front of the eyeball)


# ==========================================================================
# Gait

def gait_foot(phi, g, side):
    """Foot transform (root space) and lift for one foot at cycle phase phi."""
    off = g['phase_l'] if side == 'l' else g['phase_r']
    t = (phi + off) % 1.0
    duty, D = g['duty'], g['stride']
    bias = g['bias_l'] if side == 'l' else g['bias_r']
    s_on, s_off = D * duty / 2 + bias, -D * duty / 2 + bias
    lift, pitch = 0.0, 0.0
    c_p, o_p = g['contact_pitch'], g['off_pitch']
    if t < duty:
        u = t / duty
        s = s_on + (s_off - s_on) * u
        if u < g['roll_in']:
            pitch = c_p * (1 - ease(u / g['roll_in'], 'out'))
        elif u > 1 - g['roll_out']:
            pitch = o_p * ease((u - (1 - g['roll_out'])) / g['roll_out'], 'in')
    else:
        u = (t - duty) / (1 - duty)
        k = ease(u, 'io')
        s = s_off + (s_on - s_off) * k
        s -= g.get('kick', 0.0) * math.sin(math.pi * u) * (1 - u) ** 1.5
        lift = g['lift'] * math.sin(math.pi * u ** g.get('lift_skew', 0.85))
        pitch = lerp(o_p, c_p, ease((u - 0.1) / 0.85, 'io'))
    d = g['dir']
    sx = 1 if side == 'l' else -1
    pos = V((d.x * s + sx * g['width'], d.y * s, lift))
    yaw = sx * g.get('toe_out', 0.0)
    # pivot: heel when the toe is up, toe tip when the heel is up
    heel = HEEL_PT if side == 'l' else _mx(HEEL_PT)
    toe = TOE_PT if side == 'l' else _mx(TOE_PT)
    piv = heel if pitch > 0 else toe
    Rp = Rz(yaw) @ Rx(-pitch)
    Tm = (Matrix.Translation(pos) @ Matrix.Translation(piv) @ Rp.to_4x4() @ Matrix.Translation(-piv))
    return Tm, lift, t < duty


def legs_ik(P, Tl, Tr, pole_l=None, pole_r=None):
    P['leg_l'] = ('ik', Tl, pole_l or V((0.05, -1, 0)))
    P['leg_r'] = ('ik', Tr, pole_r or V((-0.05, -1, 0)))


def knee_pole(T, side, out=0.08):
    f = T.to_3x3() @ V((0, -1, 0))
    f.z = 0
    f.normalize()
    sx = 1 if side == 'l' else -1
    return (f + V((sx * out, 0, 0))).normalized()


def auto_drop(sk, P_list, margin=0.992, smooth=2):
    """Lower the hips where a leg would over-extend (cyclic smoothing)."""
    L = {s: sk.length['thigh_' + s] + sk.length['shin_' + s] for s in 'lr'}
    drops = []
    for P in P_list:
        sol = solve_pose(sk, {k: v for k, v in P.items() if not k.startswith('arm_')}, Matrix.Identity(4), V())
        need = 0.0
        for s in 'lr':
            spec = P['leg_' + s]
            if spec[0] != 'ik':
                continue
            Hp = (sol.M['hips'] @ sk.rest_inv['hips'] @ sk.rest['thigh_' + s]).translation
            A = (P.get('root', Matrix.Identity(4)) @ spec[1] @ sk.rest['foot_' + s]).translation
            dv = A - Hp
            h2 = dv.x ** 2 + dv.y ** 2
            Lm = L[s] * margin
            if h2 < Lm * Lm:
                dz_ok = math.sqrt(Lm * Lm - h2)
                need = max(need, (Hp.z - A.z) - dz_ok)
        drops.append(max(0.0, need))
    n = len(drops)
    cyc = drops[:-1] if n > 1 else drops      # last frame duplicates the first
    m = len(cyc)
    sm = []
    for i in range(m):
        acc, wsum = 0.0, 0.0
        for k in range(-smooth * 2, smooth * 2 + 1):
            w = math.exp(-0.5 * (k / max(smooth, 1e-3)) ** 2)
            acc += max(cyc[(i + k) % m], cyc[i] * 0.999) * w if k == 0 else cyc[(i + k) % m] * w
            wsum += w
        sm.append(max(cyc[i], acc / wsum))
    sm.append(sm[0])
    for P, d in zip(P_list, sm):
        off, Rh = P['hips']
        P['hips'] = (off - V((0, 0, d)), Rh)
    return sm


def nelder_mead(f, x0, step=5.0, iters=300):
    n = len(x0)
    pts = [list(x0)]
    for i in range(n):
        p = list(x0)
        p[i] += step
        pts.append(p)
    vals = [f(p) for p in pts]
    for _ in range(iters):
        order = sorted(range(n + 1), key=lambda i: vals[i])
        pts = [pts[i] for i in order]
        vals = [vals[i] for i in order]
        c = [sum(p[i] for p in pts[:-1]) / n for i in range(n)]
        xr = [c[i] + (c[i] - pts[-1][i]) for i in range(n)]
        fr = f(xr)
        if fr < vals[0]:
            xe = [c[i] + 2 * (c[i] - pts[-1][i]) for i in range(n)]
            fe = f(xe)
            pts[-1], vals[-1] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < vals[-2]:
            pts[-1], vals[-1] = xr, fr
        else:
            xc = [c[i] + 0.5 * (pts[-1][i] - c[i]) for i in range(n)]
            fc = f(xc)
            if fc < vals[-1]:
                pts[-1], vals[-1] = xc, fc
            else:
                for k in range(1, n + 1):
                    pts[k] = [pts[0][i] + 0.5 * (pts[k][i] - pts[0][i]) for i in range(n)]
                    vals[k] = f(pts[k])
    i = min(range(n + 1), key=lambda i: vals[i])
    return pts[i], vals[i]


GARAND_BUTT = V((0, 0.316, -0.040))        # butt plate centre, weapon space
GARAND_MUZZLE = V((0, -0.794, 0.045))
GARAND_OFFHAND = V((0, -0.215, -0.012))
GARAND_EYE = V((0, 0.130, 0.087))          # where the aiming eye goes (over the comb)


class Clips:
    FPS = 30

    def __init__(self, sk, offhand=None):
        self.sk = sk
        self.GW = grip_frame_weapon_r2(30, 0)
        self.socket = sk.grip['r'] @ self.GW.inverted()
        self.offhand = offhand if offhand is not None else GARAND_OFFHAND
        self.diag = {}
        self.hips_idle = (V((0, 0.0, -0.028)), R(2, 0, 0))
        self.low = dict(spine=R(4, 0, -3), chest=R(3, 0, -9), neck=R(-3, 0, 5), head=R(-2, 0, 7),
                        clavicle_l=R(0, 0, -4), clavicle_r=R(0, 0, 0),
                        weapon=place((-0.085, -0.215, 1.115), yaw=32, pitch=-10, roll=8),
                        pole_r=V((-0.55, 0.55, -0.6)), pole_l=V((0.35, 0.1, -1.0)), lroll=25)
        self.port = dict(spine=R(4, 0, 0), chest=R(4, 0, -6), neck=R(-6, 0, 4), head=R(-6, 0, 4),
                         clavicle_l=R(0, 0, -6), clavicle_r=R(0, 0, 0),
                         weapon=place((-0.10, -0.20, 1.075), yaw=58, pitch=46, roll=-30),
                         pole_r=V((-0.7, 0.3, -0.6)), pole_l=V((0.6, 0.2, -0.75)), lroll=-20)
        self.aim = None

    # ---- poses ----------------------------------------------------------
    def stance_legs(self, P, wide=1.0):
        Tl = foot_T((0.118 * wide, -0.035, 0.085), Rz(7), 'l')
        Tr = foot_T((-0.118 * wide, 0.050, 0.085), Rz(-12), 'r')
        legs_ik(P, Tl, Tr, knee_pole(Tl, 'l'), knee_pole(Tr, 'r'))

    def kneel_legs(self, P):
        """Right knee down, left foot forward."""
        sk = self.sk
        hips_off = V((0.01, 0.060, 0.485 - 0.955))
        P['hips'] = (hips_off, R(4, 0, 0))
        sol = solve_pose(sk, {'hips': P['hips']}, Matrix.Identity(4), V())
        Hr = (sol.M['hips'] @ sk.rest_inv['hips'] @ sk.rest['thigh_r']).translation
        L1, L2 = sk.length['thigh_r'], sk.length['shin_r']
        kz = 0.088
        dz = Hr.z - kz
        dx = -0.022
        dy = math.sqrt(max(0.0, L1 * L1 - dz * dz - dx * dx))
        K = V((Hr.x + dx, Hr.y - dy, kz))
        shin_dir = V((0, math.cos(rad(18)), math.sin(rad(18))))
        A = K + shin_dir * (L2 * 0.999)
        Tr = foot_T(A, Rx(108), 'r')
        Tl = foot_T((0.135, -0.33, 0.085), Rz(10), 'l')
        legs_ik(P, Tl, Tr, V((0.35, -1, 0.25)).normalized(), V((-0.05, -1, -0.25)).normalized())

    def ub_set(self, P, ub, add=None, wadd=None):
        for k in ('spine', 'chest', 'neck', 'head', 'clavicle_l', 'clavicle_r'):
            Rk = ub[k]
            if add and k in add:
                Rk = add[k] @ Rk
            P[k] = Rk
        W = ub['weapon']
        if wadd is not None:
            W = wadd @ W
        P['weapon'] = W
        P['pole_l'], P['pole_r'], P['lroll'] = ub['pole_l'], ub['pole_r'], ub['lroll']
        P['lyaw'] = ub.get('lyaw', 0.0)
        P['arm_l'] = ('weapon',)
        P['arm_r'] = ('weapon',)

    def solve(self, P):
        return solve_pose(self.sk, P, self.socket, self.offhand)

    def trunk_delta(self, P):
        Q = {k: v for k, v in P.items() if not k.startswith('arm_') and k != 'weapon'}
        sol = solve_pose(self.sk, Q, self.socket, self.offhand)
        return sol.M['chest'] @ self.sk.rest_inv['chest'], sol

    def build_aim(self, hips=None, legs='stance', muzzle_z=1.46, bore_x=-0.072):
        """Shouldered rifle, level along -Y. Returns an upper-body preset."""
        sk = self.sk
        P = {'hips': hips or self.hips_idle}
        if legs == 'stance':
            self.stance_legs(P)
        else:
            self.kneel_legs(P)
            P['hips'] = hips
        ub = dict(spine=R(6, 0, 0), chest=R(4, -2, -30), neck=R(0, 0, 0), head=R(0, 0, 0),
                  clavicle_l=R(0, 0, -18), clavicle_r=R(0, 5, 6))
        for k, v in ub.items():
            P[k] = v
        D, sol = self.trunk_delta(P)
        sec = Section(TORSO_JACKET)
        best = None
        for i in range(81):
            th = rad(-80 + i)
            q = D @ sec.point(th, 1.37, 0.012)
            if best is None or abs(q.x - bore_x) < abs(best.x - bore_x):
                best = q
        butt_z = muzzle_z - (GARAND_MUZZLE.z - GARAND_BUTT.z)
        target_butt = V((best.x, best.y - 0.004, butt_z))
        Wworld = place(target_butt - GARAND_BUTT)
        a = Wworld @ V((0, 0.05, 0.087))
        b = Wworld @ V((0, 0.20, 0.087))

        def eye_of(Q):
            s_ = solve_pose(sk, Q, self.socket, self.offhand)
            Mh = s_.M['head']
            R3 = Mh.to_3x3() @ sk.rest_inv['head'].to_3x3()
            return Mh @ sk.rest_inv['head'] @ EYE_R, R3

        def cost(x):
            Q = dict(P)
            Q['neck'] = R(x[0], x[1], x[2])
            Q['head'] = R(x[3], x[4], x[5])
            eye, R3 = eye_of(Q)
            ab = b - a
            t = max(0.0, min(1.0, (eye - a).dot(ab) / ab.length_squared))
            dist = (a + ab * t - eye).length
            fwd = R3 @ V((0, -1, 0))
            up = R3 @ V((0, 0, 1))
            yaw_err = math.degrees(math.atan2(fwd.x, -fwd.y))
            roll = math.degrees(math.atan2(up.x, up.z))
            e = 2.0e5 * dist * dist
            e += 0.05 * yaw_err ** 2 + 0.03 * max(0.0, abs(roll) - 16) ** 2
            e += 0.004 * sum(v * v for v in x)
            return e
        x, val = nelder_mead(cost, [12, -4, 14, 8, -8, 14], step=6.0, iters=700)
        ub['neck'] = R(x[0], x[1], x[2])
        ub['head'] = R(x[3], x[4], x[5])
        ub['weapon'] = D.inverted() @ Wworld
        ub['pole_r'] = V((-0.85, 0.25, -0.45))
        ub['pole_l'] = V((0.30, 0.0, -1.0))
        ub['lroll'] = 35
        Q = dict(P)
        Q['neck'], Q['head'] = ub['neck'], ub['head']
        eye, _ = eye_of(Q)
        ab = b - a
        t = max(0.0, min(1.0, (eye - a).dot(ab) / ab.length_squared))
        tag = 'aim' if legs == 'stance' else 'aim_crouch'
        self.diag[tag + '_eye_err'] = round((a + ab * t - eye).length, 4)
        self.diag[tag + '_head'] = [round(v, 1) for v in x]
        self.diag[tag + '_butt'] = [round(v, 3) for v in target_butt]
        return ub

    # ---- clip builders --------------------------------------------------
    def breathe(self, phi, amp=1.0):
        a = math.sin(2 * math.pi * phi)
        return {'chest': R(-0.8 * amp * a, 0, 0), 'spine': R(-0.3 * amp * a, 0, 0),
                'neck': R(0.6 * amp * a, 0, 0)}

    def idle(self, n=60):
        frames = []
        for f in range(n + 1):
            phi = f / n
            P = {'hips': (self.hips_idle[0] + V((0.004 * math.sin(2 * math.pi * phi), 0,
                                                0.002 * math.sin(4 * math.pi * phi))), self.hips_idle[1])}
            self.stance_legs(P)
            b = self.breathe(phi)
            self.ub_set(P, self.low, add=b, wadd=place((0, 0, 0.004 * math.sin(2 * math.pi * phi)),
                                                          pitch=0.8 * math.sin(2 * math.pi * phi)))
            frames.append(P)
        return frames

    def aim_clip(self, n=30, crouch=False):
        ub = self.aim_crouch if crouch else self.aim
        frames = []
        for f in range(n + 1):
            phi = f / n
            P = {}
            if crouch:
                self.kneel_legs(P)
            else:
                P['hips'] = self.hips_idle
                self.stance_legs(P)
            sway = place((0.0015 * math.sin(2 * math.pi * phi), 0, 0.0012 * math.sin(4 * math.pi * phi)),
                         yaw=0.25 * math.sin(2 * math.pi * phi), pitch=0.2 * math.sin(4 * math.pi * phi + 1))
            self.ub_set(P, ub, add={'chest': R(-0.4 * math.sin(2 * math.pi * phi), 0, 0)}, wadd=None)
            # sway is applied in weapon space around the shoulder pocket
            P['weapon'] = P['weapon'] @ sway
            frames.append(P)
        return frames

    def locomotion(self, n, g, ub, hips_fn, ub_fn=None, wfn=None):
        frames = []
        for f in range(n + 1):
            phi = f / n
            Tl, ll, _ = gait_foot(phi, g, 'l')
            Tr, lr, _ = gait_foot(phi, g, 'r')
            P = {'hips': hips_fn(phi)}
            legs_ik(P, Tl, Tr, knee_pole(Tl, 'l'), knee_pole(Tr, 'r'))
            add = ub_fn(phi) if ub_fn else None
            wadd = wfn(phi) if wfn else None
            self.ub_set(P, ub, add=add, wadd=wadd)
            frames.append(P)
        self.diag.setdefault('drops', {})
        drops = auto_drop(self.sk, frames)
        return frames, max(drops)

    def walk(self, n=32, back=False):
        if back:
            g = dict(dir=V((0, 1, 0)), stride=0.94, duty=0.64, lift=0.065, contact_pitch=-10, off_pitch=12,
                     roll_in=0.2, roll_out=0.25, width=-0.004, bias_l=0.04, bias_r=0.04,
                     phase_l=0.0, phase_r=0.5, toe_out=5)
        else:
            g = dict(dir=V((0, -1, 0)), stride=1.40, duty=0.61, lift=0.085, contact_pitch=13, off_pitch=-32,
                     roll_in=0.16, roll_out=0.36, width=-0.006, bias_l=-0.085, bias_r=-0.085,
                     phase_l=0.0, phase_r=0.5, toe_out=5)
        c2 = lambda phi: math.cos(2 * math.pi * phi)
        s2 = lambda phi: math.sin(2 * math.pi * phi)
        c4 = lambda phi: math.cos(4 * math.pi * phi)
        k = -1 if back else 1

        def hips(phi):
            return (V((0.020 * s2(phi), 0.0, -0.012 - 0.012 * c4(phi))),
                    R(3 + 1.2 * c4(phi), -3.0 * s2(phi), -4.0 * k * c2(phi)))

        def ub(phi):
            return {'spine': R(0, 2.0 * s2(phi), 3.0 * k * c2(phi)), 'chest': R(-0.6 * c4(phi), 0.8 * s2(phi),
                                                                                   2.5 * k * c2(phi)),
                    'neck': R(0.8 * c4(phi), -1.2 * s2(phi), -0.8 * k * c2(phi)),
                    'head': R(0, -0.8 * s2(phi), -0.7 * k * c2(phi))}

        def wb(phi):
            return place((0.004 * s2(phi), 0, 0.006 * math.cos(4 * math.pi * phi - 0.9)),
                         pitch=1.2 * math.cos(4 * math.pi * phi - 0.9), yaw=-1.0 * k * c2(phi))
        fr, d = self.locomotion(n, g, self.low, hips, ub, wb)
        self.diag['drop_' + ('walk_back' if back else 'walk')] = d
        return fr

    def strafe(self, n=28, left=True):
        sgn = 1 if left else -1
        g = dict(dir=V((sgn, 0, 0)), stride=0.50, duty=0.65, lift=0.055, contact_pitch=4, off_pitch=-8,
                 roll_in=0.2, roll_out=0.2, width=-0.004, phase_l=0.0 if left else 0.5,
                 phase_r=0.5 if left else 0.0, toe_out=8,
                 bias_l=0.105 if left else -0.105, bias_r=-0.105 if left else 0.105)
        s2 = lambda phi: math.sin(2 * math.pi * phi)
        c4 = lambda phi: math.cos(4 * math.pi * phi)

        def hips(phi):
            return (V((0.012 * sgn * math.sin(2 * math.pi * phi - 1.2), 0.0, -0.030 - 0.010 * c4(phi))),
                    R(3, 2.0 * sgn * s2(phi), 4.0 * sgn))

        def ub(phi):
            return {'spine': R(0, -1.5 * sgn * s2(phi), -2.0 * sgn), 'chest': R(0, -0.8 * sgn * s2(phi), -2.0 * sgn),
                    'neck': R(0, 0.6 * sgn * s2(phi), 0)}

        def wb(phi):
            return place((0.0, 0, 0.004 * math.cos(4 * math.pi * phi - 0.8)), pitch=0.8 * math.cos(4 * math.pi * phi))
        fr, d = self.locomotion(n, g, self.low, hips, ub, wb)
        self.diag['drop_strafe'] = d
        return fr

    def run(self, n=20):
        g = dict(dir=V((0, -1, 0)), stride=2.40, duty=0.38, lift=0.20, contact_pitch=6, off_pitch=-36,
                 roll_in=0.2, roll_out=0.5, width=-0.012, bias_l=-0.17, bias_r=-0.17, phase_l=0.0, phase_r=0.5,
                 toe_out=3, kick=0.10, lift_skew=0.7)
        c2 = lambda phi: math.cos(2 * math.pi * phi)
        s2 = lambda phi: math.sin(2 * math.pi * phi)

        def hips(phi):
            return (V((0.014 * s2(phi), 0.0, -0.050 - 0.030 * math.cos(4 * math.pi * (phi - 0.18)))),
                    R(9 + 1.5 * math.cos(4 * math.pi * phi), -2.5 * s2(phi), -6.0 * c2(phi)))

        def ub(phi):
            return {'spine': R(3, 1.5 * s2(phi), 4.5 * c2(phi)), 'chest': R(1, 0.8 * s2(phi), 4.0 * c2(phi)),
                    'neck': R(-4, -1.0 * s2(phi), -1.5 * c2(phi)), 'head': R(-3, -1.0 * s2(phi), -1.5 * c2(phi))}

        def wb(phi):
            return place((0.0, 0, 0.012 * math.cos(4 * math.pi * phi - 1.2)), yaw=-3.0 * c2(phi),
                         pitch=2.0 * math.cos(4 * math.pi * phi - 1.2))
        fr, d = self.locomotion(n, g, self.port, hips, ub, wb)
        self.diag['drop_run'] = d
        return fr

    def crouch_walk(self, n=36):
        g = dict(dir=V((0, -1, 0)), stride=1.0, duty=0.66, lift=0.07, contact_pitch=8, off_pitch=-16,
                 roll_in=0.2, roll_out=0.3, width=0.02, bias_l=0.0, bias_r=0.0, phase_l=0.0, phase_r=0.5,
                 toe_out=9)
        c2 = lambda phi: math.cos(2 * math.pi * phi)
        s2 = lambda phi: math.sin(2 * math.pi * phi)
        c4 = lambda phi: math.cos(4 * math.pi * phi)

        def hips(phi):
            return (V((0.018 * s2(phi), 0.03, -0.30 - 0.012 * c4(phi))),
                    R(8 + 1.0 * c4(phi), -2.5 * s2(phi), -4.0 * c2(phi)))

        def ub(phi):
            return {'spine': R(-6, 1.5 * s2(phi), 3.0 * c2(phi)), 'chest': R(-3, 0.6 * s2(phi), 2.0 * c2(phi)),
                    'neck': R(-2, -1.0 * s2(phi), -0.6 * c2(phi)), 'head': R(0, 0, -0.6 * c2(phi))}
        fr, d = self.locomotion(n, g, self.crouch_ub, hips, ub,
                                lambda phi: place((0, 0, 0.004 * math.cos(4 * math.pi * phi - 0.9))))
        self.diag['drop_crouch_walk'] = d
        return fr

    def crouch_idle(self, n=60):
        frames = []
        for f in range(n + 1):
            phi = f / n
            P = {}
            self.kneel_legs(P)
            self.ub_set(P, self.crouch_ub, add=self.breathe(phi),
                        wadd=place((0, 0, 0.003 * math.sin(2 * math.pi * phi)), pitch=0.6 * math.sin(2 * math.pi * phi)))
            frames.append(P)
        return frames

    # ---- presets that depend on the aim solve -----------------------------
    def init_presets(self):
        self.aim = self.build_aim()
        P = {}
        self.kneel_legs(P)
        kneel_hips = P['hips']
        self.aim_crouch = self.build_aim(hips=kneel_hips, legs='kneel', muzzle_z=1.0)
        self.crouch_ub = dict(spine=R(22, 0, -3), chest=R(12, 0, -9), neck=R(-8, 0, 5), head=R(-14, 0, 7),
                              clavicle_l=R(0, 0, -4), clavicle_r=R(4, 0, 0),
                              weapon=place((-0.075, -0.20, 1.14), yaw=26, pitch=18, roll=8),
                              pole_r=V((-0.55, 0.55, -0.6)), pole_l=V((0.35, 0.1, -1.0)), lroll=25)
        erg = Ergo(self)

        def stand(P):
            P['hips'] = self.hips_idle
            self.stance_legs(P)

        def kneel(P):
            self.kneel_legs(P)
        presets = [('low', self.low, stand, 1.0), ('port', self.port, stand, 0.6), ('aim', self.aim, stand, 1.4),
                   ('crouch', self.crouch_ub, kneel, 0.6), ('aim_crouch', self.aim_crouch, kneel, 0.8)]
        ctx = {}
        for name, ub, base, _ in presets:
            ctx[name] = erg.context(ub, base)
            if not name.startswith('aim'):
                erg.fit_reach(ub, ctx[name], self.offhand)
        # right-hand socket: grip-axis pitch / hand roll that keep the wrist
        # straight when aiming (the shouldered rifle's orientation is fixed)
        best = None
        for phi in range(-10, 71, 5):
            for psi in range(-90, 91, 10):
                GW = grip_frame_weapon_r2(phi, psi)
                cost = 0.0
                for name, ub, base, wgt in presets:
                    if name in ('aim', 'aim_crouch', 'low'):
                        r = erg.best_right(ub, ctx[name], GW, ub['pole_r'])
                        cost += {'aim': 1.0, 'aim_crouch': 0.6, 'low': 0.4}[name] * r[0]
                if best is None or cost < best[0]:
                    best = (cost, phi, psi)
        self.GW = grip_frame_weapon_r2(best[1], best[2])
        self.socket = self.sk.grip['r'] @ self.GW.inverted()
        self.diag['socket_phi_psi'] = best[1:]
        # carried rifles: roll / tilt the rifle about the grip to suit both hands
        for name, ub, base, _ in presets:
            if name.startswith('aim'):
                continue
            W0 = ub['weapon']
            bestw = None
            for roll in range(-60, 61, 10):
                for yaw in (-10, 0, 10):
                    for pitch in (-10, 0, 10):
                        ub['weapon'] = W0 @ (Rz(yaw) @ Rx(-pitch) @ Ry(roll)).to_4x4()
                        erg.fit_reach(ub, ctx[name], self.offhand)
                        r = erg.best_right(ub, ctx[name], self.GW, ub['pole_r'])
                        l = erg.best_left(ub, ctx[name], ub['pole_l'], self.offhand,
                                          rolls=range(-40, 81, 20), yaws=(-20, 0, 20))
                        cost = r[0] + l[0] + 0.05 * (abs(roll) + abs(yaw) + abs(pitch))
                        if bestw is None or cost < bestw[0]:
                            bestw = (cost, ub['weapon'].copy(), roll, yaw, pitch)
            ub['weapon'] = bestw[1]
            self.diag['fit_' + name] = bestw[2:]
        for name, ub, base, _ in presets:
            Dc = ctx[name][0]
            r = erg.best_right(ub, ctx[name], self.GW, ub['pole_r'])
            ub['pole_r'] = (Dc.to_3x3().inverted() @ r[1]).normalized()
            l = erg.best_left(ub, ctx[name], ub['pole_l'], self.offhand)
            ub['lroll'], ub['lyaw'] = l[1], l[2]
            ub['pole_l'] = (Dc.to_3x3().inverted() @ l[3]).normalized()
            self.diag['ergo_' + name] = dict(r_wrist=round(r[2], 1), r_reach=round(r[3], 3),
                                             l_wrist=round(l[4], 1), l_reach=round(l[5], 3),
                                             lroll=l[1], lyaw=l[2])

    # ---- keyed upper-body clips --------------------------------------------
    def keyed(self, n, keys, base_fn):
        """keys: list of (frame, dict) with optional 'ease'. Dict entries are
        interpolated: rotations ('spine'...'clavicle_r', as deltas on the
        base preset), 'weapon' (chest-delta 4x4), 'lhand' / 'rhand' grip
        frames ('w', M) weapon-relative or ('c', M) chest-delta, poles."""
        frames = []
        rot_keys = ('spine', 'chest', 'neck', 'head', 'clavicle_l', 'clavicle_r')
        keys = [(fk_, dict(K)) for fk_, K in keys]
        for fk_, K in keys:
            for s_ in 'lr':
                h = K.get(s_ + 'hand')
                if h is None or h[0] not in ('n', 'nw'):
                    continue
                if h[0] == 'nw':                   # wrist target given in weapon space
                    h = ('n', K['weapon'] @ V(h[1])) + tuple(h[2:])
                P = {}
                base_fn(P)
                for rk in rot_keys:
                    P[rk] = K.get(rk, Matrix.Identity(3)) @ self.low[rk]
                D, sol = self.trunk_delta(P)
                ua, fa = 'upperarm_' + s_, 'forearm_' + s_
                S = (sol.M['clavicle_' + s_] @ self.sk.rest_inv['clavicle_' + s_] @ self.sk.rest[ua]).translation
                pole = D.to_3x3() @ V(K.get('pole_' + s_, self.low['pole_' + s_]))
                Mu, Ml, reach = two_bone(S, D @ V(h[1]), self.sk.length[ua], self.sk.length[fa], pole,
                                         self.sk.sign[ua])
                Mh = Ml @ Matrix.Rotation(rad(h[2]), 4, 'Y')
                Mh.translation = Ml @ V((0, self.sk.length[fa], 0))
                if len(h) > 3:                     # extra wrist bend (pitch about the hand's X)
                    Mh = Mh @ Matrix.Rotation(rad(h[3]), 4, 'X')
                K[s_ + 'hand'] = ('c', D.inverted() @ Mh @ self.sk.grip[s_])
        for f in range(n + 1):
            k = 0
            while k < len(keys) - 2 and f > keys[k + 1][0]:
                k += 1
            fa, A = keys[k]
            fb, B = keys[k + 1]
            t = 0.0 if fb == fa else (f - fa) / (fb - fa)
            t = ease(t, B.get('ease', 'io'))
            P = {}
            base_fn(P)
            ub = self.low
            for rk in rot_keys:
                Ra = A.get(rk, Matrix.Identity(3))
                Rb = B.get(rk, Matrix.Identity(3))
                P[rk] = slerp3(Ra, Rb, t) @ ub[rk]
            W = interp4(A['weapon'], B['weapon'], t)
            P['weapon'] = W
            P['lroll'] = lerp(A.get('lroll', ub['lroll']), B.get('lroll', ub['lroll']), t)
            P['lyaw'] = lerp(A.get('lyaw', ub.get('lyaw', 0.0)), B.get('lyaw', ub.get('lyaw', 0.0)), t)
            for s in 'lr':
                pa = A.get('pole_' + s, ub['pole_' + s])
                pb = B.get('pole_' + s, ub['pole_' + s])
                P['pole_' + s] = pa.lerp(pb, t)
                ha, hb = A.get(s + 'hand'), B.get(s + 'hand')
                if ha is None and hb is None:
                    P['arm_' + s] = ('weapon',)
                    continue
                Wa, Wb = A['weapon'], B['weapon']
                ga = self._grip_cd(s, ha, W, P['lroll'], P['lyaw'])
                gb = self._grip_cd(s, hb, W, P['lroll'], P['lyaw'])
                G = interp4(ga, gb, t)
                P['arm_' + s] = ('grip_cd', G)
            frames.append(P)
        return frames

    def _grip_cd(self, side, h, W, lroll, lyaw=0.0):
        """A grip frame in chest-delta space for a key entry."""
        if h is None:        # on the weapon
            if side == 'r':
                return W @ self.GW
            return W @ Matrix.Translation(self.offhand) @ left_grip_frame(lroll, lyaw)
        space, M = h
        return W @ M if space == 'w' else M

    def resolve(self, P):
        """Turn ('grip_cd', G) arm specs into armature-space IK specs."""
        D, _ = self.trunk_delta(P)
        for s in 'lr':
            spec = P.get('arm_' + s)
            if spec and spec[0] == 'grip_cd':
                Mh = hand_from_grip(self.sk, s, D @ spec[1])
                pole = D.to_3x3() @ V(P['pole_' + s])
                P['arm_' + s] = ('ik', Mh, pole)
        return P

    # ---- reloads (v3) ---------------------------------------------------------
    # Event frames (the game moves the props): see RELOAD_EVENTS.
    def _base_stand(self, P):
        P['hips'] = self.hips_idle
        self.stance_legs(P)

    def reload(self, n=60):
        """M1 Garand: rifle comes up, the receiver turned to the right shoulder;
        left hand to the belt, an en-bloc clip pushed down into the receiver
        with the thumb, the hand slaps the operating-rod handle, back to the
        handguard. Starts and ends on the low ready (idle frame 0)."""
        lo = self.low['weapon']
        Wr = place(**RELOAD_RIFLE)
        look = dict(neck=R(10, 0, -4), head=R(16, 0, -10), pole_r=POLE_R_RIFLE)
        belt_hi = ('n', V((0.105, -0.128, 1.095)), -80, 15)
        belt_lo = ('n', V((0.105, -0.122, 1.072)), -80, 15)
        clip = lambda off=(0, 0, 0): ('w', prop_grip('garand_clip', off))
        slap = lambda p: ('nw', V(p), -100, 10)
        pl_belt, pl_top = V((0.9, 0.3, -0.3)), POLE_PUSH
        keys = [
            (0, dict(weapon=lo)),
            (7, dict(weapon=Wr, lhand=('n', V((0.13, -0.33, 1.10)), -50, 10), pole_l=V((0.6, 0.2, -0.8)),
                     chest=R(3, 0, -6), **look)),
            (12, dict(weapon=Wr, lhand=('n', V((0.17, -0.27, 1.13)), -60, 10), pole_l=pl_belt, chest=R(3, 0, -6), **look)),
            (18, dict(weapon=Wr, lhand=belt_hi, pole_l=pl_belt, chest=R(6, 0, -3), neck=R(14, 0, 0), head=R(14, 0, -4))),
            (21, dict(weapon=Wr, lhand=belt_lo, pole_l=pl_belt, chest=R(6, 0, -3), neck=R(14, 0, 0), head=R(14, 0, -4))),
            (24, dict(weapon=Wr, lhand=belt_hi, pole_l=pl_belt, chest=R(5, 0, -3), **look)),
            (31, dict(weapon=Wr, lhand=clip((0, 0.0, 0.070)), pole_l=pl_top, chest=R(3, 0, -6), clavicle_l=R(0, 0, -12), **look)),
            (36, dict(weapon=Wr @ place((0, 0, -0.010)), lhand=clip(), pole_l=pl_top, chest=R(3, 0, -6), clavicle_l=R(0, 0, -12), ease='out', **look)),
            (39, dict(weapon=Wr, lhand=clip((0, 0.004, 0.030)), pole_l=pl_top, chest=R(3, 0, -6), clavicle_l=R(0, 0, -12), **look)),
            (44, dict(weapon=Wr, lhand=slap((0.006, -0.130, 0.105)), pole_l=pl_top, chest=R(3, 0, -6), **look)),
            (47, dict(weapon=Wr @ place((0, -0.004, 0)), lhand=slap((0.000, -0.185, 0.090)), pole_l=pl_top,
                      chest=R(3, 0, -6), ease='in', **look)),
            (50, dict(weapon=Wr, lhand=slap((0.020, -0.175, 0.120)), pole_l=pl_top, chest=R(3, 0, -3), **look)),
            (56, dict(weapon=lo @ place((0, 0.010, 0.020), pitch=4, roll=-4), chest=R(1, 0, -1))),
            (60, dict(weapon=lo)),
        ]
        return [self.resolve(P) for P in self.keyed(n, keys, self._base_stand)]

    def reload_smg(self, n=66):
        """Thompson / MP 40: left hand pulls the stick magazine down and out and
        drops it, takes a fresh one from the belt, seats it with a push, racks
        the bolt with the left hand. Starts and ends on the low ready."""
        lo = self.low['weapon']
        Ws = place(**RELOAD_SMG)
        look = dict(neck=R(10, 0, -4), head=R(16, 0, -10), pole_r=POLE_R_SMG)
        mag = lambda off=(0, 0, 0): ('w', prop_grip('thompson_mag', off))
        belt_hi = ('n', V((0.105, -0.128, 1.095)), -80, 15)
        belt_lo = ('n', V((0.105, -0.122, 1.072)), -80, 15)
        rack = lambda p: ('w', Matrix.Translation(V(p)) @ G_PUSH.to_3x3().to_4x4())
        pl_mag, pl_belt, pl_top = POLE_MAG, V((0.9, 0.3, -0.3)), POLE_PUSH
        keys = [
            (0, dict(weapon=lo)),
            (8, dict(weapon=Ws, lhand=mag(), pole_l=pl_mag, chest=R(3, 0, -6), **look)),
            (11, dict(weapon=Ws, lhand=mag((0, 0, -0.012)), pole_l=pl_mag, chest=R(3, 0, -6), **look)),
            (17, dict(weapon=Ws @ place((0, 0, 0.008)), lhand=mag((0, 0.01, -0.160)), pole_l=pl_mag,
                      chest=R(3, 0, -6), ease='in', **look)),
            (21, dict(weapon=Ws, lhand=('n', V((0.25, -0.24, 0.97)), -40), pole_l=pl_belt, chest=R(5, 0, -3), **look)),
            (28, dict(weapon=Ws, lhand=belt_hi, pole_l=pl_belt, chest=R(6, 0, -3), neck=R(14, 0, 0), head=R(14, 0, -4))),
            (31, dict(weapon=Ws, lhand=belt_lo, pole_l=pl_belt, chest=R(6, 0, -3), neck=R(14, 0, 0), head=R(14, 0, -4))),
            (34, dict(weapon=Ws, lhand=belt_hi, pole_l=pl_belt, chest=R(5, 0, -3), **look)),
            (41, dict(weapon=Ws, lhand=mag((0, 0.01, -0.100)), pole_l=pl_mag, chest=R(3, 0, -6), **look)),
            (45, dict(weapon=Ws @ place((0, 0, 0.006)), lhand=mag(), pole_l=pl_mag, chest=R(3, 0, -6), ease='out', **look)),
            (48, dict(weapon=Ws, lhand=mag((0, 0, -0.035)), pole_l=pl_mag, chest=R(3, 0, -6), **look)),
            (53, dict(weapon=Ws, lhand=rack((-0.008, -0.112, 0.096)), pole_l=pl_top, chest=R(3, 0, -6),
                      clavicle_l=R(0, 0, -10), **look)),
            (57, dict(weapon=Ws @ place((0, -0.006, 0)), lhand=rack((-0.008, -0.035, 0.096)), pole_l=pl_top,
                      chest=R(3, 0, -6), clavicle_l=R(0, 0, -10), ease='in', **look)),
            (60, dict(weapon=Ws, lhand=rack((0.010, -0.040, 0.130)), pole_l=pl_top, chest=R(2, 0, -3), **look)),
            (66, dict(weapon=lo)),
        ]
        return [self.resolve(P) for P in self.keyed(n, keys, self._base_stand)]

    def throw(self, n=30):
        lo = self.low['weapon']
        # rifle held by the left hand (offhand point), as on socket_weapon_l
        def rifle_at(pos, yaw, pitch, roll, lroll=25):
            Rw = place((0, 0, 0), yaw=yaw, pitch=pitch, roll=roll)
            G = Rw @ Matrix.Translation(self.offhand)
            return Matrix.Translation(V(pos) - G.translation) @ Rw
        r_lo = lo @ self.GW
        k = [
            (0, dict(weapon=lo, rhand=('c', r_lo))),
            (5, dict(weapon=lo, chest=R(2, 0, -6), lhand=('n', V((0.17, -0.27, 1.10)), -30),
                     rhand=('n', V((-0.15, -0.16, 1.20)), 60), pole_r=V((-0.8, 0.3, -0.5)),
                     pole_l=V((0.6, 0.2, -0.8)))),
            (11, dict(weapon=lo, spine=R(-4, -3, -14), chest=R(-8, -5, -22),
                      neck=R(2, 2, 14), head=R(4, 2, 14), lhand=('n', V((0.24, -0.36, 1.22)), -40),
                      rhand=('n', V((-0.30, 0.16, 1.52)), 90, -35),
                      pole_r=V((-0.6, 0.3, -0.4)), pole_l=V((0.6, 0.2, -0.8)), ease='io')),
            (15, dict(weapon=lo, spine=R(5, 1, 6), chest=R(8, 2, 12),
                      neck=R(-4, 0, -8), head=R(-4, 0, -8), lhand=('n', V((0.22, -0.24, 1.10)), -40),
                      rhand=('n', V((-0.20, -0.36, 1.66)), 90, 15),
                      pole_r=V((-0.8, 0.2, -0.2)), pole_l=V((0.7, 0.2, -0.7)), ease='in')),
            (21, dict(weapon=lo, spine=R(11, 2, 12), chest=R(12, 2, 15),
                      neck=R(-8, 0, -10), head=R(-6, 0, -10), lhand=('n', V((0.18, -0.12, 1.00)), -30),
                      rhand=('n', V((0.02, -0.33, 1.06)), 60),
                      pole_r=V((-0.6, -0.1, -0.8)), pole_l=V((0.7, 0.3, -0.6)), ease='out')),
            (30, dict(weapon=lo, rhand=('c', r_lo))),
        ]

        def base(P):
            P['hips'] = self.hips_idle
            self.stance_legs(P)
        frames = self.keyed(n, k, base)
        return [self.resolve(P) for P in frames]

    # ---- FK clips (hit, deaths) -----------------------------------------
    def idle_fk(self):
        P = self.idle()[0]
        sol = self.solve(P)
        return fk_extract(self.sk, sol.M)

    def fk_clip(self, n, keys):
        """keys: (frame, F, ease) with F complete fk dicts."""
        frames = []
        for f in range(n + 1):
            k = 0
            while k < len(keys) - 2 and f > keys[k + 1][0]:
                k += 1
            fa, Fa, _ = keys[k]
            fb, Fb, kind = keys[k + 1]
            t = 0.0 if fb == fa else ease((f - fa) / (fb - fa), kind)
            frames.append(fk_pose(fk_blend(Fa, Fb, t)))
        return frames

    def hit(self, n=12):
        keys = [(0, {}), (3, {'spine': R(-6, 0, 3), 'chest': R(-9, 3, 7), 'neck': R(12, 0, -4), 'head': R(8, 0, -6),
                              'clavicle_l': R(0, -4, -4), 'clavicle_r': R(0, 4, 4), 'hy': 0.022, 'hp': -3}),
                (7, {'spine': R(-2, 0, 1), 'chest': R(-3, 1, 2), 'neck': R(4, 0, -1), 'head': R(3, 0, -2),
                     'hy': 0.008, 'hp': -1}), (12, {})]
        kinds = ['io', 'out', 'io', 'io']
        frames = []
        I = Matrix.Identity(3)
        for f in range(n + 1):
            k = 0
            while k < len(keys) - 2 and f > keys[k + 1][0]:
                k += 1
            fa, A = keys[k]
            fb, B = keys[k + 1]
            t = ease((f - fa) / (fb - fa), kinds[k + 1])
            add = {}
            for rk in ('spine', 'chest', 'neck', 'head', 'clavicle_l', 'clavicle_r'):
                add[rk] = slerp3(A.get(rk, I), B.get(rk, I), t)
            hy = lerp(A.get('hy', 0.0), B.get('hy', 0.0), t)
            hp = lerp(A.get('hp', 0.0), B.get('hp', 0.0), t)
            P = {'hips': (self.hips_idle[0] + V((0, hy, 0)), R(hp, 0, 0) @ self.hips_idle[1])}
            self.stance_legs(P)
            self.ub_set(P, self.low, add=add)
            frames.append(P)
        return frames

    def death_fwd(self, n=40):
        F0 = self.idle_fk()
        root = lambda a, y=0.0: Matrix.Translation((0, y, 0)) @ Matrix.Rotation(rad(a), 4, 'X')
        F1 = fk_apply(F0, {'spine': R(-10, 0, 4), 'chest': R(-12, 2, 6), 'neck': R(-8, 0, 0), 'head': R(-14, 0, -6),
                           'upperarm_l': R(-25, -15, 0), 'upperarm_r': R(-15, 18, 0),
                           'hips_add': V((0, 0.03, -0.01)), 'root': root(-5)})
        F2 = fk_apply(F0, {'spine': R(-8, 0, 3), 'chest': R(-8, 2, 5), 'neck': R(4, 0, 0), 'head': R(4, 0, -10),
                           'thigh_l': R(-30, 0, 0), 'thigh_r': R(-38, 0, 0), 'shin_l': R(55, 0, 0),
                           'shin_r': R(62, 0, 0), 'foot_l': R(-10, 0, 0), 'foot_r': R(-10, 0, 0),
                           'upperarm_l': R(-40, -35, 0), 'upperarm_r': R(-20, 30, 0), 'forearm_l': R(-20, 0, 0),
                           'hips_add': V((0, 0.10, -0.24)), 'root': root(-18, 0.05)})
        F3 = dict(F2)
        F3.update({'root': root(-60, 0.18), 'hips_off': V((0, 0.10, -0.28)), 'spine': R(-4, 0, 3), 'chest': R(-2, 0, 4),
                   'neck': R(10, 0, 0), 'head': R(8, 0, -10)})
        Fe = dict(F0)
        Fe.update({'root': root(-90, 0.30), 'hips_off': V((0, 0.0, -0.02)), 'hips': R(0, 0, 0),
                   'spine': R(-3, 0, 3), 'chest': R(-4, 0, 4), 'neck': R(-4, 0, 8), 'head': R(-2, 6, 32),
                   'clavicle_l': R(0, 0, 0), 'clavicle_r': R(0, 0, 0),
                   'upperarm_l': R(0, -38, 5), 'forearm_l': R(-12, 0, 0), 'hand_l': R(0, 0, 0),
                   'upperarm_r': R(0, 30, -5), 'forearm_r': R(-3, 0, 0), 'hand_r': R(0, 0, 0),
                   'thigh_l': R(1, -9, 8), 'shin_l': R(3, 0, 0), 'foot_l': R(28, 0, 28),
                   'thigh_r': R(-24, 9, -10), 'shin_r': R(52, 0, 0), 'foot_r': R(18, 0, -26)})
        F4 = fk_apply(Fe, {'root': root(-88, 0.30), 'head': R(-10, 0, 0) @ Fe['head'], 'hips_off': V((0, 0, 0.0))})
        return self.fk_clip(n, [(0, F0, 'io'), (5, F1, 'out'), (14, F2, 'io'), (24, F3, 'in'), (29, Fe, 'in'),
                                (32, F4, 'out'), (40, Fe, 'io')])

    def death_back(self, n=40):
        F0 = self.idle_fk()
        root = lambda a, y=0.0: Matrix.Translation((0, y, 0)) @ Matrix.Rotation(rad(a), 4, 'X')
        F1 = fk_apply(F0, {'spine': R(12, 0, -3), 'chest': R(10, 0, -4), 'neck': R(-10, 0, 0), 'head': R(-14, 0, 4),
                           'upperarm_l': R(-10, -12, 0), 'upperarm_r': R(-6, 12, 0),
                           'hips_add': V((0, -0.04, -0.01)), 'hips': R(-6, 0, 0), 'root': root(4)})
        F2 = fk_apply(F0, {'spine': R(18, 0, -2), 'chest': R(10, 0, -3), 'neck': R(-6, 0, 0), 'head': R(-8, 0, 6),
                           'thigh_l': R(-20, 0, 0), 'thigh_r': R(-14, 0, 0), 'shin_l': R(70, 0, 0),
                           'shin_r': R(80, 0, 0), 'foot_l': R(30, 0, 0), 'foot_r': R(35, 0, 0),
                           'upperarm_l': R(-30, -20, 0), 'upperarm_r': R(-25, 20, 0),
                           'hips_add': V((0, -0.02, -0.34)), 'root': root(8, -0.05)})
        F3 = dict(F2)
        F3.update({'root': root(48, -0.25), 'hips_off': V((0, 0.0, -0.36)), 'spine': R(12, 0, -2),
                   'upperarm_l': R(-70, -25, 0), 'upperarm_r': R(-65, 25, 0), 'forearm_l': R(-30, 0, 0),
                   'forearm_r': R(-30, 0, 0)})
        Fe = dict(F0)
        Fe.update({'root': root(90, -0.25), 'hips_off': V((0, 0.0, -0.02)), 'hips': R(0, 0, 0),
                   'spine': R(2, 0, -3), 'chest': R(0, 0, -4), 'neck': R(-10, 0, -20), 'head': R(-8, 0, -55),
                   'clavicle_l': R(0, 0, 0), 'clavicle_r': R(0, 0, 0),
                   'upperarm_l': R(-163, -22, 0), 'forearm_l': R(-12, 0, 0), 'hand_l': R(0, 0, 0),
                   'upperarm_r': R(-6, 30, 0), 'forearm_r': R(-8, 0, 0), 'hand_r': R(0, 0, 0),
                   'thigh_l': R(-4, -7, 22), 'shin_l': R(8, 0, 0), 'foot_l': R(40, 0, 0),
                   'thigh_r': R(-2, 9, -16), 'shin_r': R(14, 0, 0), 'foot_r': R(38, 0, 0)})
        F4 = fk_apply(Fe, {'root': root(86, -0.25)})
        return self.fk_clip(n, [(0, F0, 'io'), (5, F1, 'out'), (15, F2, 'io'), (24, F3, 'in'), (30, Fe, 'in'),
                                (33, F4, 'out'), (40, Fe, 'io')])

    def death_crumple(self, n=36):
        F0 = self.idle_fk()
        rootr = lambda a, x=0.0: Matrix.Translation((x, 0, 0)) @ Matrix.Rotation(rad(a), 4, 'Y')
        F1 = fk_apply(F0, {'chest': R(-5, -4, 4), 'neck': R(6, 0, 0), 'head': R(8, -4, 0),
                           'hips_add': V((0, 0, -0.03))})
        F2 = fk_apply(F0, {'spine': R(16, 0, 0), 'chest': R(8, -4, 0), 'neck': R(8, 0, 0), 'head': R(10, -6, 0),
                           'thigh_l': R(-40, 0, 0), 'thigh_r': R(-46, 0, 0), 'shin_l': R(95, 0, 0),
                           'shin_r': R(100, 0, 0), 'foot_l': R(30, 0, 0), 'foot_r': R(30, 0, 0),
                           'upperarm_l': R(-10, 10, 0), 'upperarm_r': R(-6, -8, 0),
                           'hips_add': V((0, 0.06, -0.40))})
        F3 = dict(F2)
        F3.update({'root': rootr(-38, -0.05), 'hips_off': V((0, 0.08, -0.46)), 'spine': R(18, -6, 0),
                   'chest': R(10, -6, 0)})
        Fe = dict(F0)
        Fe.update({'root': rootr(-88, -0.10), 'hips_off': V((0, 0.10, -0.40)), 'hips': R(0, 0, 0),
                   'spine': R(18, 0, 0), 'chest': R(12, 0, 4), 'neck': R(14, 0, 0), 'head': R(16, 0, 10),
                   'clavicle_l': R(0, 0, 0), 'clavicle_r': R(0, 0, 0),
                   'upperarm_l': R(-45, 75, -30), 'forearm_l': R(-35, 0, 0),
                   'upperarm_r': R(-75, -75, 30), 'forearm_r': R(-15, 0, 0), 'hand_r': R(0, 0, 0),
                   'thigh_l': R(-62, 4, 0), 'shin_l': R(92, 0, 0), 'foot_l': R(30, 0, 0),
                   'thigh_r': R(-46, -4, 0), 'shin_r': R(78, 0, 0), 'foot_r': R(28, 0, 0)})
        F4 = fk_apply(Fe, {'root': rootr(-84, -0.10)})
        return self.fk_clip(n, [(0, F0, 'io'), (5, F1, 'out'), (14, F2, 'in'), (22, F3, 'in'), (28, Fe, 'in'),
                                (31, F4, 'out'), (36, Fe, 'io')])

    def all(self):
        self.init_presets()
        return {
            'idle': self.idle(60), 'walk': self.walk(32), 'walk_back': self.walk(32, back=True),
            'strafe_l': self.strafe(28, True), 'strafe_r': self.strafe(28, False), 'run': self.run(20),
            'crouch_idle': self.crouch_idle(60), 'crouch_walk': self.crouch_walk(36),
            'aim': self.aim_clip(30), 'crouch_aim': self.aim_clip(30, crouch=True),
            'reload': self.reload(60), 'reload_smg': self.reload_smg(66), 'throw': self.throw(30), 'hit': self.hit(12),
            'death_fwd': self.death_fwd(40), 'death_back': self.death_back(40), 'death_crumple': self.death_crumple(36),
        }




# ==========================================================================
# Ergonomics: choose the right-hand socket, left-hand roll and elbow poles so
# wrists stay near neutral, and pull the weapon in until the arms reach it.

def grip_frame_weapon_r2(phi, psi):
    """Right grip frame in weapon space: grip axis (pinky->thumb) pitched up by
    phi from the barrel direction, hand rolled by psi about that axis
    (psi = 0: back of the hand facing the weapon's right side)."""
    c, s = math.cos(rad(phi)), math.sin(rad(phi))
    Y = V((0, -c, s))
    Z0 = V((-1, 0, 0))
    Z = Matrix.Rotation(rad(psi), 3, Y) @ Z0
    return axes_matrix(Y.cross(Z), Y, Z)


def swivel_poles(S, Wp, n=36):
    u = (Wp - S).normalized()
    r0 = V((0, 0, -1)) - u * (-u.z)
    if r0.length < 1e-6:
        r0 = V((1, 0, 0)) - u * u.x
    r0.normalize()
    r1 = u.cross(r0)
    return [r0 * math.cos(2 * math.pi * k / n) + r1 * math.sin(2 * math.pi * k / n) for k in range(n)]


def arm_eval(sk, side, S, Mh, pole, Dc):
    """(wrist angle deg, penalty, reach) of an arm reaching hand matrix Mh."""
    ua, fa = 'upperarm_' + side, 'forearm_' + side
    a, b = sk.length[ua], sk.length[fa]
    Wp = Mh.translation
    Mu, Ml, reach = two_bone(S, Wp, a, b, pole, sk.sign[ua])
    yf = Ml.to_3x3().col[1]
    yh = Mh.to_3x3().col[1]
    wrist = math.degrees(yf.angle(yh))
    E = Ml.translation
    Er = Dc.inverted() @ E
    pen = 0.0
    sx = 1 if side == 'l' else -1
    if 0.92 < Er.z < 1.50 and (Er.x / 0.205) ** 2 + ((Er.y - 0.02) / 0.135) ** 2 < 1:
        pen += 120
    if Er.x * sx < 0.02:            # elbow crossing the body's midline
        pen += 60
    if E.z > S.z + 0.06:
        pen += 300 * (E.z - S.z - 0.06)
    pen += 400 * max(0.0, reach - 0.97)
    return wrist, pen, reach


class Ergo:
    def __init__(self, clips):
        self.c = clips
        self.sk = clips.sk

    def context(self, ub, base_fn):
        P = {}
        base_fn(P)
        for k in ('spine', 'chest', 'neck', 'head', 'clavicle_l', 'clavicle_r'):
            P[k] = ub[k]
        Dc, sol = self.c.trunk_delta(P)
        S = {s: (sol.M['clavicle_' + s] @ self.sk.rest_inv['clavicle_' + s] @ self.sk.rest['upperarm_' + s]).translation
             for s in 'lr'}
        return Dc, S

    def best_right(self, ub, ctx, GW, hint):
        Dc, S = ctx
        W = Dc @ ub['weapon']
        Mh = W @ GW @ self.sk.grip['r'].inverted()
        best = None
        for pole in swivel_poles(S['r'], Mh.translation):
            w, pen, reach = arm_eval(self.sk, 'r', S['r'], Mh, pole, Dc)
            hint_w = (Dc.to_3x3() @ hint).normalized()
            cost = w + pen + 0.08 * math.degrees(pole.angle(hint_w))
            if best is None or cost < best[0]:
                best = (cost, pole, w, reach)
        return best

    def best_left(self, ub, ctx, hint, offhand, rolls=range(-60, 101, 10), yaws=(-20, 0, 20)):
        Dc, S = ctx
        W = Dc @ ub['weapon']
        best = None
        for roll in rolls:
            for yaw in yaws:
                G = Matrix.Translation(offhand) @ left_grip_frame(roll, yaw)
                Mh = W @ G @ self.sk.grip['l'].inverted()
                hint_w = (Dc.to_3x3() @ hint).normalized()
                for pole in swivel_poles(S['l'], Mh.translation, 24):
                    w, pen, reach = arm_eval(self.sk, 'l', S['l'], Mh, pole, Dc)
                    cost = w + pen + 0.08 * math.degrees(pole.angle(hint_w)) + 0.05 * abs(roll - 20)
                    if best is None or cost < best[0]:
                        best = (cost, roll, yaw, pole, w, reach)
        return best

    def fit_reach(self, ub, ctx, offhand, target=0.93, iters=30):
        """Pull the weapon towards the left shoulder until the left hand reaches."""
        Dc, S = ctx
        for _ in range(iters):
            W = Dc @ ub['weapon']
            G = Matrix.Translation(offhand) @ left_grip_frame(20)
            Mh = W @ G @ self.sk.grip['l'].inverted()
            d = (Mh.translation - S['l']).length / (self.sk.length['upperarm_l'] + self.sk.length['forearm_l'])
            if d <= target:
                break
            step = (S['l'] - Mh.translation).normalized() * 0.01
            stepc = Dc.to_3x3().inverted() @ step
            ub['weapon'] = Matrix.Translation(stepc) @ ub['weapon']
        return ub


# ==========================================================================
# v2 body: denser lofts with geometric folds, a sculpted head with eyes,
# individual fingers, detailed boots, helmets and kit.

def interp_prof(prof, s):
    """Linear interpolation of limb profile rows (s, rn, rb[, dn]) at s."""
    rows = [(r[0], r[1], r[2], r[3] if len(r) > 3 else 0.0) for r in prof]
    if s <= rows[0][0]:
        return rows[0][1:]
    for a, b in zip(rows, rows[1:]):
        if s <= b[0]:
            t = (s - a[0]) / (b[0] - a[0])
            t = t * t * (3 - 2 * t) * 0.35 + t * 0.65
            return tuple(lerp(a[i], b[i], t) for i in (1, 2, 3))
    return rows[-1][1:]


def s_steps(s0, s1, base, dense=()):
    """Arc-length samples from s0 to s1: `base` spacing, finer inside `dense`
    windows given as (s_from, s_to, step)."""
    out = []
    s = s0
    while s < s1 - 1e-6:
        out.append(s)
        step = base
        for a, b, st in dense:
            if a <= s < b:
                step = min(step, st)
        s += step
    out.append(s1)
    return out


def limb2(mb, pts, prof, steps, seg, mat, wfn, cfn=None, ball=None, ref=FWD, lip=None, mirror=False,
          disp=None, mats=None):
    """Garment tube along a joint chain with displacement disp(s, a) (m,
    radial; a = 0 towards `ref` i.e. the front, pi/2 towards t x n)."""
    rings, ss = [], []
    p0, t0 = chain_eval(pts, 0.0)
    if ball:
        for beta in (80, 62, 44, 26):
            b = rad(beta)
            c = p0 - t0 * ball * math.sin(b)
            rings.append(ring_around(c, t0, ball * math.cos(b), seg, ref))
            ss.append(-ball * math.sin(b))
    for s in steps:
        rn, rb, dn = interp_prof(prof, s)
        c, t = chain_eval(pts, s)
        n, b = frame_from(t, ref)
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            d = disp(s, a) if disp else 0.0
            ring.append(c + n * dn + n * math.cos(a) * (rn + d) + b * math.sin(a) * (rb + d))
        rings.append(ring)
        ss.append(s)
    if lip:
        s_end = steps[-1]
        r_in, depth = lip
        for s in (s_end, s_end - depth):
            c, t = chain_eval(pts, s)
            rings.append(ring_around(c, t, r_in, seg, ref))
    if mirror:
        rings = [[_mx(p) for p in r] for r in rings]
    cap0 = (p0 - t0 * ball) if ball else True
    if mirror and ball:
        cap0 = _mx(cap0)
    mf = None
    if mats:
        mf = lambda k, i: mats(ss[min(k, len(ss) - 1)], 2 * math.pi * i / seg)
    mb.loft(rings, mat, wfn, cfn, cap0=cap0, cap1=True, flip=mirror, mats=mf)


def fold_noise(seed):
    off = V((seed * 3.7, seed * 1.3, seed * 2.9))
    return lambda x, y=0.0, z=0.0: noise.noise(V((x, y, z)) + off)


# ---- head ---------------------------------------------------------------

HEAD2_HALF = [0, 5, 10, 14, 17, 20, 23, 26, 29, 33, 38, 44, 52, 61, 72, 85, 102, 125, 152, 180]
HEAD2_TH = [rad(a) for a in HEAD2_HALF] + [rad(360 - a) for a in reversed(HEAD2_HALF[1:-1])]
EYE_Z = -0.004               # z_rel of the eye centres
EYE_TH = 21.5                # azimuth (deg) of the eyes
EYEBALL_R = 0.0115           # eyeball radius


def head2_rows():
    rows = set()
    z = -0.117
    while z < HEAD_SKIN_TOP:
        rows.add(round(z, 4))
        z += 0.012
    for a, b, st in ((-0.018, 0.014, 0.004), (-0.084, -0.054, 0.005), (-0.048, -0.032, 0.008)):
        z = a
        while z <= b:
            rows.add(round(z, 4))
            z += st
    rows.add(HEAD_SKIN_TOP)
    rows = sorted(r for r in rows if r <= HEAD_SKIN_TOP)
    out = []
    for r in rows:
        if not out or r - out[-1] > 0.0018:
            out.append(r)
    return out


def head2_disp(th, zr):
    a = math.degrees(th)
    if a > 180:
        a -= 360
    aa = abs(a)
    d = 0.0
    d += 0.0070 * _g(zr, 0.016, 0.008) * _g(aa, 0, 30)                  # brow ridge
    d += 0.0020 * _g(zr, 0.010, 0.004) * _g(aa, 22, 9)                   # upper lid fold
    d -= 0.0095 * _g(zr, EYE_Z, 0.011) * _g(aa, EYE_TH, 11)              # orbit
    # almond eye opening: the eyeball shows through here
    u = (aa - EYE_TH) / 10.0
    if abs(u) < 1.0:
        h = 0.0050 * (1 - u * u) ** 0.65
        v = (zr - EYE_Z - 0.0006 * (1 - u * u)) / max(h, 1e-4)
        d -= 0.0080 * smoothstep(1.15, 0.65, abs(v)) * smoothstep(1.0, 0.75, abs(u))
    d += 0.0055 * _g(zr, -0.026, 0.010) * _g(aa, 50, 13)                 # cheekbones
    d -= 0.0040 * _g(zr, -0.052, 0.011) * _g(aa, 44, 11)                 # under the cheekbone
    d -= 0.0018 * _g(zr, -0.050, 0.012) * _g(aa, 23, 4)                  # nasolabial crease
    d += 0.0016 * _g(zr, -0.055, 0.006) * _g(aa, 0, 4)                   # philtrum
    d -= 0.0050 * _g(zr, -0.0675, 0.0028) * _g(aa, 0, 13)                # mouth line
    d += 0.0034 * _g(zr, -0.0615, 0.0042) * _g(aa, 0, 13)                # upper lip
    d += 0.0042 * _g(zr, -0.0745, 0.0045) * _g(aa, 0, 11)                # lower lip
    d -= 0.0032 * _g(zr, -0.0845, 0.0040) * _g(aa, 0, 12)                # chin crease
    d += 0.0078 * _g(zr, -0.0985, 0.0090) * _g(aa, 0, 15)                # chin
    d += 0.0048 * _g(zr, -0.084, 0.012) * _g(aa, 82, 12)                 # jaw angle
    d -= 0.0040 * _g(zr, 0.030, 0.015) * _g(aa, 72, 14)                  # temples
    return d


def head2_point(th, zr, off=0.0, plain=False):
    w, f, b, cy = catmull(HEAD_TABLE, zr, 4)
    c, s_ = math.cos(th), math.sin(th)
    e = 2.0 / 2.25
    d = (0.0 if plain else head2_disp(th, zr)) + off
    x = math.copysign(abs(s_) ** e, s_) * (w + d)
    r = (f if c > 0 else b) + d
    y = cy - math.copysign(abs(c) ** e, c) * r
    return HEAD_C + V((x, y, zr))


def eye_centre(side=1):
    """Eyeball centre: 1 mm behind the orbit surface (shows only in the almond)."""
    th = rad(EYE_TH) * side
    a = math.degrees(abs(th))
    p_orbit = head2_point(th, EYE_Z, 0.0, plain=True)
    orbit = 0.0095 * _g(EYE_Z, EYE_Z, 0.011) * _g(a, EYE_TH, 11)
    y = p_orbit.y + orbit + 0.0010 + EYEBALL_R
    return V((p_orbit.x * 0.97, y, HEAD_C.z + EYE_Z))


def head2_front_y(x, zr):
    best, by = 1e9, 0
    for i in range(61):
        th = rad(-30 + i)
        p = head2_point(th, zr)
        if abs(p.x - x) < best:
            best, by = abs(p.x - x), p.y
    return by


def build_head2(mb):
    """Head with eyes, lids, nose with wings, lips, ears, brows, cropped hair."""
    wfn = w_rigid('head')

    def cfn(p):
        zr = p.z - HEAD_C.z
        th = math.atan2(p.x - HEAD_C.x, -(p.y - HEAD_C.y))
        a = abs(math.degrees(th))
        g = 1.0
        g *= 1 - 0.30 * _g(zr, EYE_Z, 0.010) * _g(a, EYE_TH, 12)
        g *= 1 - 0.35 * _g(zr, -0.0675, 0.003) * _g(a, 0, 12)
        g *= 1 - 0.15 * _g(zr, -0.112, 0.01)
        return g

    zrows = head2_rows()
    rings = [[head2_point(th, z) for th in HEAD2_TH] for z in zrows]
    mb.loft(rings, 'skin', wfn, cfn, cap0=HEAD_C + V((0, 0.032, -0.118)),
            cap1=HEAD_C + V((0, 0.012, HEAD_SKIN_TOP + 0.01)))
    # hair: thin cap above a smooth hairline
    hrings = []
    for k in range(7):
        ring = []
        for th in HEAD2_TH:
            z = lerp(hair_z(th), 0.1065, (k / 6) ** 1.15)
            ring.append(head2_point(th, z, 0.0012 if k == 0 else 0.0030, plain=True))
        hrings.append(ring)
    mb.loft(hrings, 'hair', wfn, None, cap1=HEAD_C + V((0, 0.012, 0.1135)))
    # eyeballs
    for side in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=EYEBALL_R)
        bm.verts.index_update()
        R3 = Matrix.Rotation(rad(90), 4, 'X')          # poles front/back: the iris gets the cap
        mb.add_bmesh(bm, Matrix.Translation(eye_centre(side)) @ R3, 'eye', wfn, None, smooth=True)
    # nose: bridge -> tip -> columella, wings
    nose = [(0.008, 0.0090, -0.0030), (0.002, 0.0085, 0.0005), (-0.005, 0.0078, 0.0040), (-0.013, 0.0076, 0.0090), (-0.022, 0.0085, 0.0150),
            (-0.031, 0.0102, 0.0208), (-0.038, 0.0118, 0.0245), (-0.043, 0.0118, 0.0232), (-0.047, 0.0102, 0.0165),
            (-0.050, 0.0080, 0.0075), (-0.052, 0.0060, 0.0015)]
    nrings = []
    for zr, hw, pr in nose:
        yf = head2_front_y(0.0, zr)
        ring = []
        for i in range(10):
            ang = math.pi * i / 9                      # 0 .. pi across the front
            x = math.cos(ang) * hw
            fr = math.sin(ang)
            yb = head2_front_y(x * 1.25, zr) + 0.003
            y = lerp(yb, yf - pr, fr ** 0.8)
            ring.append(V((x, y, HEAD_C.z + zr)))
        # close behind the face surface
        ring.append(V((-hw * 0.6, yf + 0.008, HEAD_C.z + zr)))
        ring.append(V((hw * 0.6, yf + 0.008, HEAD_C.z + zr)))
        nrings.append(ring)
    mb.loft(nrings, 'skin', wfn, lambda p: 0.85 if p.z < HEAD_C.z - 0.046 else 1.0, cap0=False, cap1=True)
    for side in (1, -1):
        yf = head2_front_y(side * 0.015, -0.045)
        c = V((side * 0.0118, yf + 0.0010, HEAD_C.z - 0.0440))
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=1.0)
        for v in bm.verts:
            v.co = V((v.co.x * 0.0048, v.co.y * 0.0070, v.co.z * 0.0046))
        bm.verts.index_update()
        mb.add_bmesh(bm, Matrix.Translation(c) @ Matrix.Rotation(rad(-25 * side), 4, 'Z'), 'skin', wfn,
                     lambda p: 0.9, smooth=True)
    # ears: a cupped body and the helix rim
    for side in (1, -1):
        ec = HEAD_C + V((side * 0.0815, 0.017, -0.017))
        out = V((side * math.cos(rad(22)), math.sin(rad(22)), 0)).normalized()
        up = V((0, 0.21, 1)).normalized()
        fw = up.cross(out).normalized() * side
        up = out.cross(fw).normalized() * side
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0)
        for v in bm.verts:
            v.co = V((v.co.x * 0.0075, v.co.y * 0.0175, v.co.z * 0.029))
            if v.co.x > 0.002:
                v.co.x -= 0.0035 * (1 - abs(v.co.z) / 0.029)
        bm.verts.index_update()
        M = axes_matrix(out, fw, up, ec)
        if side < 0:
            M = M @ Matrix.Scale(-1, 4, V((0, 1, 0)))
        mb.add_bmesh(bm, M, 'skin', wfn, lambda p: 0.75, smooth=True)
        rim = []
        for t in range(10):
            ang = rad(100 - 21 * t)                  # top front, over the top, down the back to the lobe
            f_ = 0.0170 * math.cos(ang) - 0.001      # fw points backwards
            u_ = 0.0295 * math.sin(ang)
            rim.append(ec + out * (0.0045 - 0.0015 * t / 9) + fw * f_ + up * u_)
        rr = []
        for i, p in enumerate(rim):
            t = (rim[min(i + 1, 9)] - rim[max(i - 1, 0)]).normalized()
            rr.append(ring_around(p, t, 0.0032 if 2 < i < 8 else 0.0025, 6, out))
        mb.loft(rr, 'skin', wfn, lambda p: 0.9, cap0=True, cap1=True)
    # eyebrows
    for side in (1, -1):
        pts = []
        for a in (8, 14, 20, 27, 33, 38):
            th = rad(a * side)
            zr = 0.0165 + 0.0030 * math.sin(rad((a - 8) * 5.5))
            pts.append(head2_point(th, zr, 0.0006))
        rings = []
        for i, p in enumerate(pts):
            out = (p - HEAD_C)
            out.z = 0
            out.normalize()
            up = V((0, 0, 1))
            hw = [0.0024, 0.0029, 0.0028, 0.0024, 0.0018, 0.0012][i]
            ring = [p + up * hw - out * 0.0016, p + up * hw * 0.6 + out * 0.0003,
                    p - up * hw * 0.6 + out * 0.0005, p - up * hw - out * 0.0016]
            rings.append(ring)
        if side < 0:
            rings = [list(reversed(r)) for r in rings]
        mb.loft(rings, 'hair', wfn, cap0=True, cap1=True, smooth=True)


def build_neck2(mb):
    np_ = [V((0, 0.040, 1.395)), V((0, 0.039, 1.43)), V((0, 0.036, 1.465)), V((0, 0.032, 1.50)),
           V((0, 0.028, 1.535)), V((0, 0.025, 1.565)), V((0, 0.024, 1.590))]
    rings = []
    for c in np_:
        ring = []
        for i in range(16):
            a = 2 * math.pi * i / 16          # 0 = front (-Y)
            rx, ry = 0.057, 0.053
            d = 0.0055 * _g(c.z, 1.505, 0.012) * max(0.0, math.cos(a)) ** 12         # Adam's apple
            d += 0.0025 * _g(abs(math.sin(a)), 0.72, 0.12) * max(0.0, math.cos(a)) * _g(c.z, 1.49, 0.04)
            ring.append(c + V((math.sin(a) * (rx + d), -math.cos(a) * (ry + d), 0)))
        rings.append(ring)
    mb.loft(rings, 'skin', w_neck, lambda p: 0.85 if p.z < 1.50 else 1.0, cap0=True, cap1=True)


# ---- v4 head ----------------------------------------------------------------
# One surface from the crown to inside the collar (head and neck merged), on a
# fine grid of horizontal superellipse rings around the head axis: the base
# shape (HEAD4) carries the cranium, face mass and neck; the anatomy is
# displacement (numpy, vectorised over the grid); the eyelids wrap on the
# eyeballs (smooth max of the orbit and the lids). The grid is decimated
# (symmetric quadric collapse) to the triangle budget. Morph targets
# (face_broad, face_gaunt, face_older) are smooth 3D vector fields applied to
# the head, neck, ears and anything sitting on the skin.

EYE4_X = 0.033               # pupil |x| (v3's EYE_R: the clips' aiming eye)
EYE4_Z = -0.004              # pupil z_rel
EYE4_APEX_Y = -0.074         # cornea apex y_rel
EYE4_R = 0.0118              # eyeball depth / radius
EYE4_AXM, EYE4_AXL, EYE4_AZ = 0.0160, 0.0138, 0.0128    # eyeball semi-axes: medial, lateral, vertical
EYE4_SHEAR = 0.10            # lateral side of the globe set back (y += shear * dx)
CORNEA4 = 0.0021             # corneal bulge at the apex
IRIS4_R = 0.0059             # iris radius (front projection)
LID4 = dict(axm=0.0158, axl=0.0142, ay=0.0121, az=0.0146, azu=0.0134)  # the lid base (globe + 0.2-0.3 mm)
FIS4 = dict(din=-0.0150, dout=0.0128, zc0=-0.0010, zc1=0.0012, hup=0.0050, hlo=0.0046)
MORPHS = ('face_broad', 'face_gaunt', 'face_older')
# texel density per UV island (material, island centre z from, to, linear factor): the face, eyes and
# hands get more texels, the scalp under the helmet less (v4)
UV_BOOST4 = [['eye', 1.50, 1.80, 3.6], ['skin', 1.50, 1.685, 3.0], ['skin', 1.44, 1.50, 1.5],
             ['skin', 1.685, 1.90, 0.55], ['skin', 0.80, 1.20, 2.0], ['nail', 0.80, 1.20, 2.0],
             ['leather_black', 1.45, 1.70, 1.3]]
MORPH_GAIN = {'face_broad': 1.10, 'face_gaunt': 1.15, 'face_older': 1.20}

# rings: z_rel, half width, front, back, superellipse n (the ring axis is the
# head axis x = 0, y = HEAD_C.y)
HEAD4 = [   # design z_rel, half width, front, back, n front, n back (v4.1: narrower at the
    # cheek and jaw levels, a squarer lower face, the chin set higher, the jaw angle
    # standing out over a slimmer upper neck)
    (-0.232, 0.071, 0.045, 0.079, 2.1, 2.1),     # inside the collar: neck base, trapezius
    (-0.215, 0.067, 0.044, 0.074, 2.05, 2.05),
    (-0.190, 0.064, 0.044, 0.071, 2.0, 2.0),
    (-0.165, 0.0600, 0.043, 0.068, 2.0, 2.0),
    (-0.148, 0.0565, 0.042, 0.067, 2.0, 2.0),
    (-0.137, 0.0550, 0.046, 0.067, 1.95, 2.0),    # throat point
    (-0.128, 0.0535, 0.050, 0.067, 1.8, 2.0),
    (-0.121, 0.0520, 0.060, 0.067, 1.7, 2.0),     # under the chin
    (-0.114, 0.0515, 0.075, 0.068, 1.75, 2.05),   # menton
    (-0.103, 0.0520, 0.080, 0.069, 1.95, 2.1),
    (-0.088, 0.0525, 0.080, 0.071, 2.15, 2.2),
    (-0.070, 0.0585, 0.081, 0.076, 2.25, 2.25),
    (-0.055, 0.0630, 0.082, 0.083, 2.25, 2.25),
    (-0.040, 0.0665, 0.080, 0.091, 2.3, 2.25),
    (-0.022, 0.0690, 0.079, 0.098, 2.3, 2.25),
    (-0.005, 0.0720, 0.079, 0.102, 2.3, 2.25),
    (0.012, 0.0765, 0.081, 0.104, 2.3, 2.25),
    (0.030, 0.0785, 0.083, 0.1055, 2.25, 2.2),
    (0.050, 0.0775, 0.081, 0.104, 2.15, 2.15),
    (0.068, 0.0725, 0.075, 0.098, 2.1, 2.1),
    (0.085, 0.0630, 0.064, 0.085, 2.05, 2.05),
    (0.098, 0.0490, 0.049, 0.066, 2.0, 2.0),
    (0.106, 0.033, 0.032, 0.043, 2.0, 2.0),
    (0.1105, 0.014, 0.013, 0.017, 2.0, 2.0),
]
HEAD4_TOP = 0.1125


def _np():
    import numpy as np
    return np


# v4.1: the lower face (nose base to under the chin) is designed 12.5 % taller
# than it is built: every face function works in "design z" = head4_warp(z_rel),
# a smooth vertical compression between z0 and z1 (identity above: eyes, nose
# root and skull do not move; a constant 9.5 mm lift below: the neck).
WARP4 = dict(s=1.16, z0=-0.046, z1=-0.122, h=0.008)


def _s2ext(u):
    np = _np()
    uc = np.clip(u, 0.0, 1.0)
    return uc ** 3 - uc ** 4 / 2 + np.maximum(u - 1.0, 0.0)


def head4_warp(zr):
    """Design z of the face at real z_rel (arrays or floats)."""
    np = _np()
    W = WARP4
    h = W['h']
    zr = np.asarray(zr, dtype=float)
    u0 = (W['z0'] + h - zr) / (2 * h)
    u1 = (W['z1'] + h - zr) / (2 * h)
    return zr - (W['s'] - 1) * 2 * h * (_s2ext(u0) - _s2ext(u1))


_W4_INV = None


def head4_unwarp(zd):
    """Real z_rel of a design z (inverse of head4_warp)."""
    global _W4_INV
    np = _np()
    if _W4_INV is None:
        zs = np.linspace(-0.40, 0.20, 6001)
        _W4_INV = (head4_warp(zs), zs)
    a, b = _W4_INV
    return np.interp(zd, a, b)


def _G(x, mu, sig):
    np = _np()
    return np.exp(-0.5 * ((x - mu) / sig) ** 2)


def _S(e0, e1, x):
    np = _np()
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


_H4_LUT = None


def head4_rows_at(zr):
    """(w, f, b, n) of the base rings at z_rel (arrays), Catmull-Rom between rows."""
    global _H4_LUT
    np = _np()
    if _H4_LUT is None:
        zs = np.linspace(HEAD4[0][0], HEAD4[-1][0], 3001)
        vals = np.array([catmull([r for r in HEAD4], float(z), 5) for z in zs])
        _H4_LUT = (zs, vals)
    zs, vals = _H4_LUT
    z = np.clip(zr, zs[0], zs[-1])
    return [np.interp(z, zs, vals[:, k]) for k in range(5)]


def head4_base(th, zr):
    """Base ring point (rel. HEAD_C) and the displacement direction for
    parameter angles th (0 = front, + towards +X) and z_rel (arrays)."""
    np = _np()
    w, f, b, nf, nb = head4_rows_at(zr)
    s, c = np.sin(th), np.cos(th)
    e = 2.0 / np.where(c > 0, nf, nb)
    Sx = np.sign(s) * np.abs(s) ** e
    Cc = np.sign(c) * np.abs(c) ** e
    F = np.where(c > 0, f, b)
    return Sx * w, -Cc * F, Sx, -Cc


def smax(a, b, k):
    np = _np()
    h = np.clip(k - np.abs(a - b), 0.0, None) / k
    return np.maximum(a, b) + h * h * k * 0.25


def fissure4(dx, dz):
    """Eye fissure in the front projection (dx lateral from the pupil, dz up):
    returns (u, z_up, z_lo, inside) with u 0..1 inner -> outer canthus."""
    np = _np()
    F = FIS4
    u = (dx - F['din']) / (F['dout'] - F['din'])
    uc = np.clip(u, 0.0, 1.0)
    zc = F['zc0'] + (F['zc1'] - F['zc0']) * uc
    up = zc + F['hup'] * np.sin(np.pi * uc ** 0.82) ** 0.72
    lo = zc - F['hlo'] * np.sin(np.pi * uc ** 1.15) ** 0.80
    return u, up, lo, zc


def lid4(P0x, P0y, zr, Dx, Dy):
    """Outward displacement d of the eyelid surface along the ray (P0 + d D)
    or -1 where the ray misses the lid base; also the fissure tuck."""
    np = _np()
    L = LID4
    ax_ = np.abs(P0x)
    sx = np.sign(P0x) + (P0x == 0)
    Dxa = Dx * sx                               # mirror the left half onto the right eye's maths
    Ey = EYE4_APEX_Y + EYE4_R + CORNEA4
    qx0 = ax_ - EYE4_X
    qz = zr - EYE4_Z
    dhit = np.full(P0x.shape, np.nan)
    for axs, lateral in ((L['axl'], True), (L['axm'], False)):
        # shear: y' = y - shear * dx
        qy0 = (P0y - Ey) - EYE4_SHEAR * qx0
        Dyp = Dy - EYE4_SHEAR * Dxa
        A = (Dxa / axs) ** 2 + (Dyp / L['ay']) ** 2
        B = 2 * (qx0 * Dxa / axs ** 2 + qy0 * Dyp / L['ay'] ** 2)
        azz = np.where(qz > 0, L['azu'], L['az'])
        C = (qx0 / axs) ** 2 + (qy0 / L['ay']) ** 2 + (qz / azz) ** 2 - 1
        disc = B * B - 4 * A * C
        ok = disc > 0
        d = (-B + np.sqrt(np.where(ok, disc, 0.0))) / (2 * A)
        hx = qx0 + d * Dxa
        good = ok & ((hx >= 0) if lateral else (hx < 0))
        dhit = np.where(good & np.isnan(dhit), d, dhit)
    hit = ~np.isnan(dhit)
    d = np.where(hit, dhit, 0.0)
    dx = qx0 + d * Dxa
    u, zup, zlo, zc = fissure4(dx, qz)
    upper = qz >= zc
    t_v = np.where(upper, qz - zup, zlo - qz)              # + outside the fissure
    # beyond the canthi: the distance to the corner point
    cx = np.where(u < 0, (u) * (FIS4['dout'] - FIS4['din']), np.where(u > 1, (u - 1) * (FIS4['dout'] - FIS4['din']), 0.0))
    t = np.where((u < 0) | (u > 1), np.sqrt(cx ** 2 + (qz - zc) ** 2) - 0.0002, t_v)
    # lid offset from the globe: tucked inside the fissure, rounded margin,
    # pretarsal lid, the crease and the fold above it (upper), the lower lid roll
    # and the lid-cheek groove (lower)
    medial = _S(0.10, 0.0, u)
    tuck = -0.0030 + 0.0012 * medial                         # shallow pink pocket at the inner corner
    off = tuck + (0.0011 - tuck) * _S(-0.0009, 0.0004, t)
    tp = np.clip(t, 0.0, None)
    span = np.sin(np.pi * np.clip(u, 0, 1)) ** 0.5
    off_up = 0.0003 * tp / 0.0055 - 0.00065 * _G(tp, 0.0064, 0.0008) * span + 0.0012 * _G(tp, 0.0090, 0.0019) * span
    off_lo = 0.00045 * _G(tp, 0.0017, 0.0009) * span - 0.0006 * _G(tp, 0.0078, 0.0016) * span
    off = off + np.where(upper, off_up, off_lo) * _S(0.0, 0.0006, t)
    out = np.where(hit, d + off / np.sqrt(Dx * Dx + Dy * Dy), -1.0)
    return out, t, u, upper


def nose4(X, Z):
    """Nose protrusion (m) at |x| = X, z_rel = Z (arrays)."""
    np = _np()
    NOSE_K = 0.90                       # v4.1: a shorter nose, the root (z 0.012) where it was
    Z = 0.012 + (Z - 0.012) / NOSE_K
    zt = np.array([0.012, 0.004, -0.004, -0.012, -0.020, -0.027, -0.033, -0.0375, -0.0410, -0.0440, -0.0470, -0.0495, -0.0515, -0.0530])
    ht = np.array([0.0000, 0.0040, 0.0072, 0.0105, 0.0140, 0.0172, 0.0198, 0.0212, 0.0206, 0.0170, 0.0105, 0.0050, 0.0016, 0.0])
    wt = np.array([0.0080, 0.0076, 0.0068, 0.0064, 0.0066, 0.0071, 0.0080, 0.0088, 0.0090, 0.0084, 0.0072, 0.0060, 0.0052, 0.0050])
    zz = np.clip(Z, zt[-1], zt[0])
    H = np.interp(-zz, -zt, ht) * (Z <= zt[0]) * (Z >= zt[-1])
    W = np.interp(-zz, -zt, wt)
    t = np.clip(X / W, 0.0, 1.0)
    dorsum = H * (1 - t ** 2) ** 0.62 * (X < W)
    # alar wings: lower, wider lobes either side of the tip lobule
    ah = 0.0074 * _G(Z, -0.0445, 0.0058) * (Z < -0.034) + 0.0074 * _G(Z, -0.0445, 0.0040) * (Z >= -0.034) * _S(-0.030, -0.040, Z)
    aw = 0.0175
    ta = np.clip(X / aw, 0.0, 1.0)
    ala = ah * (1 - ta ** 2) ** 1.1 * (X < aw)
    ala *= _S(-0.0525, -0.0490, Z)                          # the alar base sits on the lip
    p = smax(dorsum, ala, 0.003)
    # supra-alar groove between the lobule and the wing, alar-facial groove
    p -= 0.0011 * _G(X, 0.0098, 0.0014) * _G(Z, -0.0385, 0.0035)
    p -= 0.0008 * _G(X, aw + 0.0006, 0.0010) * _G(Z, -0.0450, 0.0060)
    # nostrils (underside), columella
    p -= 0.0032 * _G(X, 0.0062, 0.0020) * _G(Z, -0.0482, 0.0018)
    return np.clip(p, 0.0, None)


def lips4(X, Z):
    """Lip relief (m, design z): philtrum columns, Cupid's bow, full vermilion
    with its white roll, a soft parting line, depressed corners (v4.1)."""
    np = _np()
    zst = -0.0680 - 0.0013 * (X / 0.025) ** 2
    lat = np.clip(1 - (X / 0.0262) ** 4, 0.0, 1.0)
    hu = 0.0098 * np.clip(1 - (X / 0.0258) ** 2.2, 0.0, 1.0) ** 0.7 + 0.0013 * _G(X, 0.0056, 0.0021) - 0.0009 * _G(X, 0.0, 0.0016)
    hl = 0.0112 * np.clip(1 - (X / 0.0242) ** 2.0, 0.0, 1.0) ** 0.6
    vu = (Z - zst) / np.maximum(hu, 1e-4)
    vl = (zst - Z) / np.maximum(hl, 1e-4)
    up = 0.0037 * np.sin(np.pi * np.clip(vu, 0, 1) ** 0.85) ** 0.5 * (vu > 0) * (vu < 1) * lat
    lo = 0.0043 * np.sin(np.pi * np.clip(vl, 0, 1) ** 0.95) ** 0.5 * (vl > 0) * (vl < 1) * lat
    roll = 0.00050 * _G(vu, 1.0, 0.09) * lat + 0.0003 * _G(vl, 1.0, 0.10) * lat
    p = up + lo + roll
    p -= 0.0018 * _G(Z - zst, 0.0, 0.0008) * lat                      # the soft parting line
    p -= 0.0024 * _G(X, 0.0262, 0.0026) * _G(Z, zst, 0.0032)           # depressed corners
    p += 0.0008 * _G(X, 0.0310, 0.0030) * _G(Z, zst, 0.0050)           # the modiolus beside them
    # upper lip body, philtrum columns and groove
    p += 0.0020 * _G(Z, -0.0570, 0.0070) * _G(X, 0.0, 0.0190)
    ph = _G(Z, -0.0530, 0.0040)
    p += 0.0010 * _G(X, 0.0047, 0.0013) * ph - 0.0007 * _G(X, 0.0, 0.0016) * ph
    # lower lip body and the mentolabial sulcus
    p += 0.0012 * _G(Z, -0.0770, 0.0065) * _G(X, 0.0, 0.0170)
    p -= 0.0032 * _G(Z, -0.0870, 0.0045) * _G(X, 0.0, 0.0180)
    return p


def _nasolabial(X, Z):
    """Signed distance (m) to the nasolabial line (+ = cheek side), and how far
    along it (0 at the ala, 1 at the mouth corner, >1 below)."""
    np = _np()
    a = (0.0195, -0.0380)
    b = (0.0300, -0.0690)
    c = (0.0350, -0.0840)
    best = np.full(X.shape, 1e9)
    sgn = np.zeros(X.shape)
    along = np.zeros(X.shape)
    for k, (p, q) in enumerate(((a, b), (b, c))):
        vx, vz = q[0] - p[0], q[1] - p[1]
        L2 = vx * vx + vz * vz
        t = np.clip(((X - p[0]) * vx + (Z - p[1]) * vz) / L2, 0.0, 1.0)
        ex, ez = X - (p[0] + vx * t), Z - (p[1] + vz * t)
        dist = np.sqrt(ex * ex + ez * ez)
        side = np.sign(vx * ez - vz * ex) * -1.0                  # left of the line going down = cheek
        better = dist < best
        best = np.where(better, dist, best)
        sgn = np.where(better, side, sgn)
        along = np.where(better, k + t, along)
    return best * sgn, along


def face4_disp(th, zr, P0x, P0y):
    """Displacement (m, along the ring direction) of the face, skull and neck."""
    np = _np()
    X = np.abs(P0x)
    Z = zr
    A = np.degrees(np.abs(np.arctan2(np.sin(th), np.cos(th))))   # 0 front .. 180 back
    front = _S(85.0, 55.0, A)
    d = np.zeros(np.shape(th))
    # forehead, brow ridge, glabella, frontal eminences
    d += 0.0052 * _G(Z, 0.0160, 0.0060) * _G(X, 0.018, 0.020) * front
    d += 0.0030 * _G(Z, 0.0130, 0.0052) * _G(X, 0.045, 0.010) * front
    d -= 0.0010 * _G(Z, 0.0140, 0.0050) * _G(X, 0.0, 0.0045)
    d += 0.0014 * _G(Z, 0.050, 0.014) * _G(X, 0.028, 0.014) * front
    # the orbit: a bowl the eye and lids sit in, deeper under the brow and
    # towards the nose
    dx = X - EYE4_X
    dz = Z - EYE4_Z
    rx = np.where(dx < 0, 0.0215, 0.0200)
    rz = np.where(dz > 0, 0.0170, 0.0150)
    rho2 = (dx / rx) ** 2 + ((dz - 0.0015) / rz) ** 2
    bowl = np.clip(1 - rho2, 0.0, None) ** 2
    d -= 0.0170 * bowl * front
    # nose root: the bridge rises between the eyes
    d += nose4(X, Z) * front
    d -= 0.0012 * _G(X, 0.0115, 0.0030) * _G(Z, -0.006, 0.010) * front     # side of the nose bridge
    # cheekbones (malar eminence), zygomatic arch, the hollow below, tear trough
    d += 0.0056 * _G(Z, -0.0240, 0.0100) * _G(X, 0.0510, 0.0115) * front
    d += 0.0022 * _G(Z, -0.0160, 0.0070) * _G(A, 68.0, 14.0)
    d -= 0.0012 * _G(Z, -0.0540, 0.0120) * _G(X, 0.0500, 0.0110) * front
    d -= 0.0009 * _G(Z, -0.0185, 0.0030) * _G(X, 0.0290, 0.0090) * front
    d += 0.0020 * _G(Z, -0.0380, 0.0090) * _G(X, 0.0380, 0.0090) * front      # the cheek's apple
    # nasolabial fold: the cheek stands proud of the lip, a crease between
    sd, along = _nasolabial(X, Z)
    win = _S(-0.20, 0.05, along) * _S(1.6, 1.1, along) * _S(-0.025, -0.040, Z)
    d += 0.0018 * _S(-0.0010, 0.0050, sd) * win * _G(sd, 0.004, 0.009) / _G(0.004, 0.004, 0.009)
    d -= 0.0010 * _G(sd, 0.0004, 0.0012) * win
    # lips, chin, jaw
    d += lips4(X, Z) * front
    d += 0.0080 * _G(Z, -0.0975, 0.0085) * _G(X, 0.0, 0.0210) * front       # mentalis pad (a ~4 cm chin)
    d += 0.0014 * _G(Z, -0.1005, 0.0070) * _G(X, 0.0125, 0.0050) * front    # mental tubercles
    d += 0.0068 * _G(Z, -0.0880, 0.0085) * _G(A, 84.0, 13.0)               # gonial angle
    d += 0.0035 * _G(Z, -0.0700, 0.0140) * _G(A, 70.0, 14.0)               # masseter
    # the mandible's lower border: under it the skin tucks in to the neck
    jl = -0.1035 + 0.0280 * _S(20.0, 95.0, A)                              # jaw line z (front .. angle)
    under = _S(jl + 0.002, jl - 0.012, Z) * _S(110.0, 70.0, A) * _S(-0.150, -0.128, Z)
    d -= 0.0030 * under * _S(5.0, 30.0, A)
    d += 0.0016 * _G(Z, jl + 0.001, 0.0045) * _S(10.0, 40.0, A) * _S(100.0, 80.0, A)
    # temples
    d -= 0.0036 * _G(Z, 0.028, 0.0140) * _G(A, 72.0, 10.0)
    # neck: Adam's apple, the sternocleidomastoids, the hollow beside them
    d += 0.0050 * _G(Z, -0.1530, 0.0080) * _G(X, 0.0, 0.0085) * front
    d += 0.0010 * _G(Z, -0.1420, 0.0060) * _G(X, 0.0, 0.0120) * front
    t_scm = np.clip((Z + 0.075) / (-0.240 + 0.075), 0.0, 1.0)
    a_scm = 108.0 + (22.0 - 108.0) * t_scm
    scm = _G(A - a_scm, 0.0, 10.0) * _S(-0.070, -0.090, Z) * _S(-0.262, -0.225, Z)
    d += 0.0034 * scm
    d -= 0.0015 * _G(A - a_scm - 26.0, 0.0, 9.0) * _S(-0.110, -0.140, Z)
    # occipital bump, nape groove, trapezius
    d += 0.0020 * _G(Z, -0.030, 0.014) * _G(A, 180.0, 22.0)
    d -= 0.0016 * _G(A, 180.0, 7.0) * _S(-0.060, -0.085, Z) * _S(-0.24, -0.20, Z)
    # cropped hair: a little volume above the hairline (short back and sides)
    hz = hair4_z(A)
    d += (0.0006 + 0.0034 * _S(0.050, 0.095, Z)) * _S(hz - 0.006, hz + 0.012, Z)
    # eyebrows: a little volume
    d += 0.0005 * brow4_mask(X, Z) * front
    return d


def hair4_z(A):
    """z_rel of the hairline at azimuth A (deg, 0 front .. 180 back)."""
    z = 0.082 - 0.054 * _S(30.0, 72.0, A)          # temples
    z += 0.010 * _G(A, 84.0, 9.0)                   # over the ear
    z -= 0.006 * _G(A, 68.0, 6.0)                   # sideburn
    z -= 0.086 * _S(100.0, 160.0, A)                # down to the nape
    return z


def brow4_mask(X, Z):
    np = _np()
    t = np.clip((X - 0.010) / 0.040, 0.0, 1.0)
    zc = 0.0170 + 0.0028 * np.sin(np.pi * t ** 0.8) - 0.0010 * t
    hw = 0.0042 - 0.0022 * t
    return _S(0.009, 0.013, X) * _S(0.054, 0.048, X) * _S(hw, hw * 0.4, np.abs(Z - zc))


def head4_field(th, zr):
    """Final points (rel. HEAD_C) of the head surface on a (th, zr) grid."""
    np = _np()
    zd = head4_warp(zr)                     # v4.1: the face is designed in warped z
    P0x, P0y, Dx, Dy = head4_base(th, zd)
    d = face4_disp(th, zd, P0x, P0y)
    dl, t, u, upper = lid4(P0x, P0y, zr, Dx, Dy)
    A = np.degrees(np.abs(np.arctan2(np.sin(th), np.cos(th))))
    dl = np.where(A < 70.0, dl, -1.0)
    d = smax(d, dl, 0.0022)
    return P0x + d * Dx, P0y + d * Dy, zr


def _steps(a, b, spans):
    """Samples from a to b with the spacing of the first matching (lo, hi, step) span."""
    out, x = [], a
    while x < b - 1e-9:
        out.append(x)
        st = None
        for lo, hi, s in spans:
            if lo <= x < hi:
                st = s if st is None else min(st, s)
        x += st if st is not None else spans[-1][2]
    out.append(b)
    return out


def head4_grid():
    np = _np()
    half = _steps(0.0, 180.0, [(0.0, 48.0, 0.55), (48.0, 100.0, 1.4), (100.0, 181.0, 3.0)])
    cols = sorted(set([round(a, 5) for a in half] + [round(-a, 5) for a in half if 0 < a < 180.0]))
    rows = _steps(HEAD4[0][0], HEAD4[-1][0], [(-0.095, 0.026, 0.0005), (-0.140, -0.095, 0.0010),
                                               (0.026, 0.060, 0.0012), (-1.0, 1.0, 0.0030)])
    return np.radians(np.array(cols)), np.array(rows)


def _decimate_mesh(verts, faces, tris, name='h4tmp'):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    ob = kit.link(bpy.data.objects.new(name, me))
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    ntri = sum(len(f) - 2 for f in faces)
    mod.ratio = min(1.0, tris / ntri)
    mod.use_symmetry = True
    mod.symmetry_axis = 'X'
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m2 = ev.to_mesh()
    vv = [V(v.co) for v in m2.vertices]
    ff = [tuple(p.vertices) for p in m2.polygons]
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return vv, ff


def head4_surface(tris=6200):
    """The decimated head+neck surface: (verts, faces) in armature space."""
    np = _np()
    cols, rows = head4_grid()
    TH, ZR = np.meshgrid(cols, rows)
    X, Y, Z = head4_field(TH, ZR)
    nr, nc = TH.shape
    verts = np.stack([X + HEAD_C.x, Y + HEAD_C.y, Z + HEAD_C.z], axis=-1).reshape(-1, 3)
    faces = []
    idx = lambda r, c: r * nc + (c % nc)
    for r in range(nr - 1):
        for c in range(nc):
            faces.append((idx(r, c), idx(r, c + 1), idx(r + 1, c + 1), idx(r + 1, c)))
    top = len(verts)
    verts = np.vstack([verts, [[HEAD_C.x, HEAD_C.y + 0.004, HEAD_C.z + HEAD4_TOP]]])
    for c in range(nc):
        faces.append((idx(nr - 1, c), idx(nr - 1, c + 1), top))
    return _decimate_mesh(verts, faces, tris)


EAR4 = dict(c=(0.0778, 0.0085, -0.0170), yaw=22.0, tilt=14.0)


def ear4_frame(side=1):
    """Left-ear frame (mirrored for the right): origin at the concha, n the
    front of the ear (lateral, turned forward), b backwards, u up."""
    yaw, tilt = rad(EAR4['yaw']), rad(EAR4['tilt'])
    n = V((math.cos(yaw), -math.sin(yaw), 0.0))
    u = V((0.0, math.sin(tilt), math.cos(tilt)))
    u = (u - n * u.dot(n)).normalized()
    b = u.cross(n).normalized()                 # points backwards (+y)
    if b.y < 0:
        b = -b
    c = HEAD_C + V(EAR4['c'])
    return c, n, b, u


def ear4_point(rho, phi, back=0.0):
    """Ear surface in the frame (b, u, n): rho 0 (concha) .. 1 (rim), phi the
    angle in the ear plane (0 = back, 90 = up, 180 = front, 270 = down)."""
    cph, sph = math.cos(phi), math.sin(phi)
    rb = 0.0182 if cph > 0 else 0.0105         # back / front half widths
    ru = 0.0300 if sph > 0 else 0.0340         # up / down (lobe)
    lobe = smoothstep(0.2, -0.75, sph)          # 1 at the lobe
    front = smoothstep(-0.55, -0.92, cph)       # the front edge (attached)
    bb = rho * rb * cph
    uu = rho * ru * sph
    if back:
        h = back
    else:
        ph = math.degrees(phi) % 360.0
        lobe = smoothstep(0.30, 0.55, rho) * _g(ph, 268.0, 34.0) / _g(0.0, 0.0, 34.0)
        attach = _g(ph, 182.0, 20.0) / _g(0.0, 0.0, 20.0)
        rimw = (1 - lobe) * (1 - attach)
        # concha (bowl in front of the antihelix), cymba above it
        dc = math.hypot(bb + 0.0012, (uu + 0.0035) / 1.30)
        h = -0.0060 * max(0.0, 1 - (dc / 0.0088) ** 2) ** 1.2
        h -= 0.0016 * smoothstep(0.62, 0.40, rho) * smoothstep(-0.2, 0.5, sph) * rimw
        # antihelix ridge, scapha groove, helix rim
        anti = _g(rho, 0.62, 0.075) * smoothstep(-0.85, -0.45, cph if sph < 0 else 1.0) * smoothstep(-0.3, 0.2, cph + 0.6 * sph)
        h += 0.0034 * anti * (1 - lobe)
        h -= 0.0016 * _g(rho, 0.79, 0.045) * rimw
        h += 0.0036 * smoothstep(0.84, 0.97, rho) * rimw
        h += 0.0016 * lobe
        # tragus and antitragus
        h += 0.0042 * math.exp(-0.5 * ((bb + 0.0088) ** 2 + (uu + 0.0040) ** 2) / 0.0026 ** 2)
        h += 0.0022 * math.exp(-0.5 * ((bb - 0.0035) ** 2 + (uu + 0.0150) ** 2) / 0.0024 ** 2)
        # the front edge runs into the head
        h -= 0.0065 * attach * smoothstep(0.70, 1.0, rho)
    return bb, uu, h


def build_ear4(mb, side, wfn):
    c, n, b, u = ear4_frame()
    seg = 30
    phis = [2 * math.pi * i / seg for i in range(seg)]
    rows = []
    for rho in (0.08, 0.17, 0.26, 0.35, 0.43, 0.50, 0.57, 0.63, 0.69, 0.75, 0.81, 0.86, 0.91, 0.95, 0.985, 1.0):
        rows.append([ear4_point(rho, ph) for ph in phis])
    # the helix rim curls over to the back, then the back of the ear runs into the head
    last = rows[-1]
    rows.append([(bb * 1.035, uu * 1.03, h - 0.0018) for bb, uu, h in last])
    rows.append([(bb * 1.0, uu * 1.0, h - 0.0042) for bb, uu, h in last])
    for k, (sc, dh) in enumerate(((0.82, -0.0080), (0.55, -0.0140), (0.25, -0.0190))):
        rows.append([(bb * sc, uu * sc, h - 0.0042 + dh) for bb, uu, h in last])
    mir = (lambda v: v) if side == 1 else _mx
    pts = [[mir(c + b * bb + u * uu + n * h) for bb, uu, h in r] for r in rows]
    apex = mir(c + n * (-0.0045))
    back_c = mir(c + n * (-0.0262))
    base = len(mb.co)
    verts, faces = [], []
    for r in pts:
        verts += r
    verts += [apex, back_c]
    ia, ib = len(verts) - 2, len(verts) - 1
    nr = len(pts)
    for k in range(nr - 1):
        for i in range(seg):
            j = (i + 1) % seg
            faces.append((k * seg + i, k * seg + j, (k + 1) * seg + j, (k + 1) * seg + i))
    for i in range(seg):
        j = (i + 1) % seg
        faces.append((ia, j, i))
        faces.append(((nr - 1) * seg + i, (nr - 1) * seg + j, ib))
    if side == -1:                              # mirrored: keep the normals outward
        faces = [f[::-1] for f in faces]
    vv, ff = _decimate_mesh(verts, faces, 820, name='ear4tmp')
    for p in vv:
        mb.vert(p, wfn(p), 1.0)
    for f in ff:
        mb.face([base + i for i in f], 'skin', True)


def _g3(px, py, pz, c, sg):
    np = _np()
    return np.exp(-0.5 * (((px - c[0]) / sg[0]) ** 2 + ((py - c[1]) / sg[1]) ** 2 + ((pz - c[2]) / sg[2]) ** 2))


def face4_morph(P, name):
    """Morph target `name` as a displacement field over points P (N x 3, armature
    space): (N x 3) deltas, evaluated in design z (v4.1: three clearly different
    men). Mirror-symmetric; the eyeballs never move, the lid margins stay on
    them, the ears keep their attachment, nothing moves inside the collars, and
    deltas under 0.3 mm are dropped (sparse morph data)."""
    np = _np()
    x, y = P[:, 0] - HEAD_C.x, P[:, 1] - HEAD_C.y
    zr = P[:, 2] - HEAD_C.z
    z = head4_warp(zr)
    ax = np.abs(x)
    sx = np.clip(x / 0.006, -1.0, 1.0)          # lateral sign, smooth through the midline (no crease)
    r = np.sqrt(x * x + y * y) + 1e-9
    ox, oy = x / r, y / r                       # outward, horizontal from the head axis
    D = np.zeros((len(x), 3))
    late = np.zeros((len(x), 3))                # terms the ear guard must not damp (ear lobes)

    def out(k):
        D[:, 0] += k * ox
        D[:, 1] += k * oy

    def vec(k, vx, vy, vz, into=None):
        into = D if into is None else into
        n = math.sqrt(vx * vx + vy * vy + vz * vz)
        into[:, 0] += k * vx / n * sx
        into[:, 1] += k * vy / n
        into[:, 2] += k * vz / n

    G = lambda c, sg: _g3(ax, y, z, c, sg)
    if name == 'face_broad':                                   # a heavier, wider face
        out(0.0150 * G((0.052, -0.020, -0.080), (0.020, 0.040, 0.024)))      # jaw and lower face out
        out(0.0110 * G((0.045, -0.055, -0.045), (0.017, 0.026, 0.019)))      # full cheeks
        out(0.0080 * G((0.035, -0.060, -0.092), (0.016, 0.022, 0.012)))      # heavy lower cheeks
        vec(0.0120 * G((0.0, -0.045, -0.124), (0.032, 0.024, 0.012)), 0.0, -0.35, -0.94)   # double chin
        out(0.0070 * _G(z, -0.122, 0.014) * _G(ax, 0.0, 0.050))               # thick neck under the jaw
        vec(0.0040 * G((0.017, -0.088, -0.045), (0.006, 0.014, 0.008)), 1.0, 0.0, 0.0)     # broad nose
        out(0.0020 * G((0.0, -0.105, -0.038), (0.008, 0.010, 0.007)))
        out(0.0045 * G((0.028, -0.080, 0.018), (0.024, 0.016, 0.006)))      # heavy brow
        vec(0.0050 * G((0.0, -0.085, -0.104), (0.018, 0.018, 0.010)), 0.0, 0.4, 0.92)      # shorter chin
        vec(0.0060 * G((0.016, -0.080, -0.104), (0.010, 0.018, 0.012)), 1.0, 0.0, 0.0)     # wide chin
        out(0.0040 * G((0.068, -0.030, 0.025), (0.009, 0.020, 0.014)))      # full temples
        out(0.0015 * G((0.0, -0.090, -0.070), (0.022, 0.012, 0.010)))      # fuller lips
    elif name == 'face_gaunt':                                 # lean, hollow
        out(-0.0165 * G((0.048, -0.040, -0.060), (0.015, 0.026, 0.019)))     # cheeks sunk under the bones
        out(-0.0080 * G((0.069, -0.030, 0.025), (0.010, 0.022, 0.016)))     # hollow temples
        out(0.0040 * G((0.054, -0.050, -0.020), (0.011, 0.018, 0.008)))     # prominent cheekbones
        out(0.0040 * G((0.058, 0.000, -0.088), (0.008, 0.018, 0.010)))      # prominent jaw angle
        out(-0.0070 * G((0.040, -0.030, -0.116), (0.024, 0.032, 0.009)))    # sharp line under the jaw
        vec(-0.0050 * G((0.015, -0.080, -0.104), (0.010, 0.018, 0.012)), 1.0, 0.0, 0.0)    # narrow chin
        vec(0.0040 * G((0.0, -0.110, -0.038), (0.008, 0.012, 0.008)), 0.0, -0.3, -1.0)     # longer nose
        vec(-0.0030 * G((0.017, -0.088, -0.045), (0.006, 0.014, 0.008)), 1.0, 0.0, 0.0)    # thin nose
        out(-0.0020 * G((0.0, -0.092, -0.070), (0.020, 0.010, 0.008)))     # thin lips
        out(-0.0040 * _G(z, -0.140, 0.020) * _G(ax, 0.0, 0.060))            # thin neck
        out(0.0026 * G((0.0, -0.045, -0.153), (0.008, 0.010, 0.008)))      # Adam's apple
        out(-0.0020 * G((0.033, -0.070, -0.022), (0.012, 0.012, 0.005)))   # deeper orbits
        out(-0.0018 * G((0.030, -0.070, 0.0120), (0.012, 0.012, 0.0035)))
    elif name == 'face_older':                                 # 35-45 years
        vec(0.0120 * G((0.040, -0.050, -0.095), (0.016, 0.025, 0.014)), 0.35, -0.1, -1.0)   # jowls dropping
        out(-0.0030 * G((0.026, -0.080, -0.088), (0.004, 0.014, 0.010)))   # marionette lines
        vec(0.0075 * G((0.036, -0.075, -0.055), (0.011, 0.018, 0.015)), 0.0, -1.0, -0.8)   # nasolabial folds
        out(-0.0025 * G((0.026, -0.085, -0.058), (0.004, 0.010, 0.012)))
        vec(0.0032 * G((0.040, -0.068, 0.0090), (0.012, 0.012, 0.0032)), 0.0, -0.45, -1.0)  # heavy upper lids
        vec(0.0034 * G((0.033, -0.072, -0.0165), (0.012, 0.010, 0.0032)), 0.0, -1.0, -0.25) # bags
        out(-0.0015 * G((0.035, -0.070, -0.0235), (0.012, 0.012, 0.0025)))
        vec(0.0110 * G((0.0, -0.040, -0.120), (0.036, 0.025, 0.013)), 0.0, -0.35, -1.0)    # soft jaw line
        out(-0.0018 * G((0.0, -0.092, -0.070), (0.020, 0.010, 0.008)))     # thinner lips
        vec(0.0020 * G((0.026, -0.085, -0.069), (0.005, 0.010, 0.004)), 0.0, 0.0, -1.0)    # corners down
        vec(0.0032 * G((0.0, -0.110, -0.038), (0.008, 0.012, 0.008)), 0.0, -0.4, -1.0)     # longer nose tip
        vec(0.0065 * G((0.042, -0.065, -0.035), (0.015, 0.020, 0.016)), 0.0, 0.0, -1.0)    # mid-cheek descends
        vec(0.0025 * G((0.046, -0.070, 0.015), (0.010, 0.015, 0.006)), 0.0, 0.0, -1.0)     # lateral brow
        out(-0.0020 * G((0.069, -0.030, 0.025), (0.008, 0.020, 0.014)))
        out(-0.0020 * G((0.050, -0.040, -0.055), (0.012, 0.018, 0.013)))
        vec(0.0030 * G((0.086, 0.010, -0.046), (0.012, 0.014, 0.007)), 0.0, 0.0, -1.0, into=late)  # ear lobes
    else:
        raise KeyError(name)
    # the ears keep their attachment: damp the field round the ear
    c, n_, b_, u_ = ear4_frame()
    ec = c - HEAD_C
    ear = _g3(ax, y, zr, (abs(ec.x), ec.y, ec.z), (0.016, 0.018, 0.024))
    D *= (1.0 - 0.85 * ear)[:, None]
    D += late
    # keep the lid margins on the eyeballs: no movement within ~2 mm of the fissure
    dx, dz = ax - EYE4_X, zr - EYE4_Z
    u, zup, zlo, zc = fissure4(dx, dz)
    t = np.where(dz >= zc, dz - zup, zlo - dz)
    t = np.where((u < -0.15) | (u > 1.15) | (y > -0.040), 1.0, t)
    D *= _S(0.0010, 0.0032, t)[:, None]
    # nothing moves inside the collars (front top ~ design -0.145, the stand collar's back -0.118)
    back = _S(30.0, 120.0, np.degrees(np.arctan2(ax, -y)))
    lo = -0.150 + 0.028 * back
    D *= _S(lo, lo + 0.016, z)[:, None]
    D *= MORPH_GAIN[name]
    # smooth cut-off of the long tails (sparse morph data, no seam): |D| 0.8 -> 2.0 mm
    m = np.linalg.norm(D, axis=1)
    D *= _S(0.0008, 0.0020, m)[:, None]
    return D

def face4_measure():
    """Facial measurements of the built head surface (real z_rel, metres): the
    thirds (trichion, glabella, subnasale, menton), cheekbone and jaw-angle
    widths, chin width."""
    np = _np()
    th = np.radians(np.linspace(-179.75, 179.75, 1439))
    A = np.degrees(np.abs(th))

    def ring(zr):
        X, Y, _ = head4_field(th, np.full(th.shape, zr))
        return X, Y

    def front_y(zr):
        X, Y = ring(zr)
        return Y[np.abs(X) < 0.0015].min()
    zs = np.arange(0.035, -0.140, -0.0005)
    fy = np.array([front_y(z) for z in zs])
    m = (zs < -0.02) & (zs > -0.06)
    tip = zs[m][np.argmin(fy[m])]
    m = (zs < tip) & (zs > tip - 0.02)
    sn = zs[m][np.argmax(fy[m])]
    m = zs < -0.08
    pog = zs[m][np.argmin(fy[m])]
    py = fy[m].min()
    men = zs[(zs < pog) & (fy < py + 0.015)].min()
    m = (zs > 0.008) & (zs < 0.035)
    gl = zs[m][np.argmin(fy[m])]
    tr = float(hair4_z(np.array([0.0]))[0])

    def maxw(z0, z1, amax):
        return max(2 * np.abs(ring(z)[0][A < amax]).max() for z in np.arange(z0, z1, -0.001))
    X, Y = ring(pog + 0.004)
    y0 = Y[np.abs(X) < 0.0015].min()
    chin = 2 * np.abs(X[(A < 60) & (Y < y0 + 0.006)]).max()
    return dict(trichion=tr, glabella=float(gl), subnasale=float(sn), menton=float(men),
                thirds_cm=[round((tr - gl) * 100, 2), round((gl - sn) * 100, 2), round((sn - men) * 100, 2)],
                zygomatic_cm=round(maxw(-0.005, -0.030, 78) * 100, 1), jaw_angles_cm=round(maxw(-0.070, -0.095, 90) * 100, 1),
                chin_cm=round(chin * 100, 1))


def eye4_centre(side=1):
    return HEAD_C + V((side * EYE4_X, EYE4_APEX_Y + EYE4_R + CORNEA4, EYE4_Z))


def eye4_point(side, a, psi):
    """Eyeball surface at polar angle a from the visual axis (front) and psi."""
    E = eye4_centre(side)
    ux, uy, uz = math.sin(a) * math.cos(psi), -math.cos(a), math.sin(a) * math.sin(psi)
    dx = ux * (EYE4_AXL if ux > 0 else EYE4_AXM)
    dz = uz * EYE4_AZ
    dy = uy * EYE4_R + EYE4_SHEAR * dx
    rf = math.sqrt(dx * dx + dz * dz)
    dy -= CORNEA4 * max(0.0, 1 - (rf / 0.0063) ** 2) ** 1.6
    dy += 0.00018 * math.exp(-0.5 * ((rf - 0.0062) / 0.0004) ** 2)        # limbal sulcus
    return E + V((side * dx, dy, dz))


def build_eye4(mb, side, wfn):
    alphas = [rad(a) for a in (5, 11, 17, 23, 28, 32, 36, 43, 53, 66, 82)]
    seg = 18
    rings = [[eye4_point(side, a, 2 * math.pi * i / seg) for i in range(seg)] for a in alphas]
    apex = eye4_centre(side) + V((0, -(EYE4_R + CORNEA4), 0))
    # winding: outward normals (towards the front at the apex)
    p0, p1, p2 = rings[0][0], rings[0][1], rings[1][1]
    n = (p1 - p0).cross(p2 - p1)
    mb.loft(rings, 'eye', wfn, None, cap0=apex, flip=n.y > 0)


def build_head4(mb, tris=6200):
    vv, ff = head4_surface(tris)
    base = len(mb.co)
    for p in vv:
        mb.vert(p, w_headneck(p), 1.0)
    for f in ff:
        mb.face([base + i for i in f], 'skin', True)
    mb.morph_idx += list(range(base, len(mb.co)))
    for side in (1, -1):
        build_eye4(mb, side, w_rigid('head'))
        b0 = len(mb.co)
        build_ear4(mb, side, w_rigid('head'))
        mb.morph_idx += list(range(b0, len(mb.co)))


def w_headneck(p):
    """Head / neck / chest weights for the merged head-neck surface: the head
    above a line from under the chin to the skull base, the neck below it,
    the chest at the collar."""
    zr = float(head4_warp(p.z - HEAD_C.z))     # design z: the jaw line moves with the face
    yr = p.y - HEAD_C.y
    # line A (under the chin) -> B (skull base, nape)
    ay_, az_, by_, bz_ = -0.060, -0.124, 0.070, -0.062
    tx, tz = by_ - ay_, bz_ - az_
    L = math.hypot(tx, tz)
    s = ((yr - ay_) * (-tz) + (zr - az_) * tx) / L          # + above the line
    th = smoothstep(-0.018, 0.014, s)
    t1 = smoothstep(1.40, 1.46, p.z)
    return _mix(('chest', 1 - t1), ('neck', t1 * (1 - th)), ('head', t1 * th))


# ---- hands ----------------------------------------------------------------

def grip_uvw(side):
    """Grip-bar centre in the canonical hand frame: the left hand closes on
    the thicker fore-end."""
    r = GRIP_R[side]
    return V((0.068, 0.016 + r, 0.0))


GRIP_R = {'r': 0.0195, 'l': 0.0235}


def build_hand2(mb, side, mat='skin'):
    """A gripping hand: palm, four fingers wrapped round a bar of radius
    GRIP_R[side], the thumb closing over them."""
    wfn = w_rigid('hand_' + side)
    M = hand_to_world(side)
    flip = (side == 'l')
    sw = -1.0 if side == 'l' else 1.0

    def P(u, v, w):
        return M @ V((u, v, w * sw))
    G = grip_uvw(side)
    rg = GRIP_R[side]
    cfn = lambda p: 0.95
    # palm and back of the hand
    prof = [(-0.036, 0.0245, 0.0215, 0.0), (-0.004, 0.0275, 0.0195, 0.0), (0.024, 0.0360, 0.0165, 0.002),
            (0.052, 0.0415, 0.0150, 0.002), (0.078, 0.0435, 0.0140, 0.000), (0.091, 0.0410, 0.0115, -0.002),
            (0.097, 0.0360, 0.0075, -0.003)]
    rings = []
    seg = 12
    for u, hw, hv, vc in prof:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg + math.pi / seg
            c, s_ = math.cos(a), math.sin(a)
            ww = math.copysign(abs(c) ** 0.65, c) * hw
            vv = vc + math.copysign(abs(s_) ** 0.8, s_) * hv
            if s_ > 0 and c > 0.2 and 0.0 < u < 0.07:
                vv += 0.0065 * s_ * c                     # thenar eminence
            if s_ < 0 and 0.07 < u:
                vv -= 0.0025 * (abs(s_) ** 4) * (0.5 + 0.5 * math.cos(c * 4 * math.pi))   # knuckle ridges
            ring.append(P(u, vv, ww))
        rings.append(ring)
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=True, flip=not flip)
    # fingers: (w, length scale, radius, knuckle u)
    fingers = [(0.0290, 1.00, 0.0094, 0.0905), (0.0098, 1.07, 0.0097, 0.0930),
               (-0.0098, 1.00, 0.0091, 0.0905), (-0.0285, 0.82, 0.0082, 0.0840)]
    for wf, sc, r, ku in fingers:
        Rf = rg + r + 0.0005
        K = V((ku - 0.004, 0.001))
        lens = [0.040 * sc, 0.026 * sc, 0.021 * sc]
        # first joint: the point on the bar circle at the proximal length from K
        best = None
        for k in range(200):
            phi = rad(-60 + k)
            q = V((G.x + Rf * math.cos(phi), G.y + Rf * math.sin(phi)))
            dd = abs((q - K).length - lens[0])
            if best is None or dd < best[0]:
                best = (dd, phi, q)
        phi = best[1]
        joints = [K, best[2]]
        for L in lens[1:]:
            phi += 2 * math.asin(min(0.99, L / (2 * Rf)))
            joints.append(V((G.x + Rf * math.cos(phi), G.y + Rf * math.sin(phi))))
        pts = []
        for a, b in zip(joints, joints[1:]):
            pts += [a, a.lerp(b, 0.5)]
        pts.append(joints[-1])
        pts3 = [V((p.x, p.y, wf)) for p in pts]
        rad_ = [r * 1.04, r, r * 0.98, r * 0.94, r * 0.93, r * 0.88, r * 0.84]
        rings = []
        for i, p in enumerate(pts3):
            t = (pts3[min(i + 1, len(pts3) - 1)] - pts3[max(i - 1, 0)]).normalized()
            ring = ring_around(p, t, rad_[i], 8, ref=V((0, 0, 1)))
            rings.append([P(q.x, q.y, q.z) for q in ring])
        tip = pts3[-1] + (pts3[-1] - pts3[-2]).normalized() * r * 0.75
        mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=P(tip.x, tip.y, tip.z), flip=flip)
    # thumb over the fingers
    v_top = G.y + rg + 0.019
    tp = [V((0.010, 0.010, 0.024)), V((0.030, 0.022, 0.038)), V((0.050, 0.040, 0.044)),
          V((0.064, v_top - 0.006, 0.036)), V((0.077, v_top, 0.022)), V((0.087, v_top + 0.002, 0.008))]
    rr = [0.0145, 0.0128, 0.0112, 0.0102, 0.0096, 0.0086]
    rings = []
    for i, p in enumerate(tp):
        t = (tp[min(i + 1, 5)] - tp[max(i - 1, 0)]).normalized()
        ring = ring_around(p, t, rr[i], 8, ref=V((0, 1, 0)))
        rings.append([P(q.x, q.y, q.z) for q in ring])
    tip = tp[-1] + (tp[-1] - tp[-2]).normalized() * 0.0075
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=P(tip.x, tip.y, tip.z), flip=flip)


def build_hand4(mb, side, mat='skin'):
    """v4 gripping hand (same frame and grip as v2): a denser palm with the
    extensor tendons and the knuckles on its back, fingers with bony joints
    and nail plates, the thumb with its nail; still closed round a bar of
    radius GRIP_R[side]."""
    wfn = w_rigid('hand_' + side)
    M = hand_to_world(side)
    flip = (side == 'l')
    sw = -1.0 if side == 'l' else 1.0

    def P(u, v, w):
        return M @ V((u, v, w * sw))
    G = grip_uvw(side)
    rg = GRIP_R[side]
    fingers = [(0.0290, 1.00, 0.0094, 0.0905), (0.0098, 1.07, 0.0097, 0.0930),
               (-0.0098, 1.00, 0.0091, 0.0905), (-0.0285, 0.82, 0.0082, 0.0840)]
    # palm and back of the hand
    prof = [(-0.036, 0.0245, 0.0215, 0.0), (-0.018, 0.0258, 0.0205, 0.0), (-0.004, 0.0275, 0.0195, 0.0),
            (0.010, 0.0320, 0.0180, 0.001), (0.024, 0.0360, 0.0165, 0.002), (0.038, 0.0392, 0.0157, 0.002),
            (0.052, 0.0415, 0.0150, 0.002), (0.066, 0.0428, 0.0145, 0.001), (0.078, 0.0435, 0.0140, 0.000),
            (0.086, 0.0428, 0.0130, -0.001), (0.091, 0.0410, 0.0115, -0.002), (0.097, 0.0360, 0.0075, -0.003)]
    seg = 32
    rings = []
    for u, hw, hv, vc in prof:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg + math.pi / seg
            a += 0.33 * math.sin(2 * a)                   # denser across the back and the palm
            c, s_ = math.cos(a), math.sin(a)
            ww = math.copysign(abs(c) ** 0.95, c) * hw
            vv = vc + math.copysign(abs(s_) ** 0.6, s_) * hv
            if s_ > 0 and c > 0.2 and 0.0 < u < 0.07:
                vv += 0.0065 * s_ * c                     # thenar eminence
            if s_ < 0:
                back = abs(s_) ** 3
                for wf, sc, r, ku in fingers:
                    # extensor tendons fanning from the wrist to each knuckle, the knuckle itself
                    wt = wf * (0.45 + 0.55 * smoothstep(-0.02, 0.085, u))
                    ten = 0.0011 * _g(ww, wt, 0.0026) * smoothstep(-0.015, 0.02, u) * smoothstep(0.092, 0.075, u)
                    kn = 0.0032 * _g(ww, wf * 0.95, 0.0050) * _g(u, ku - 0.002, 0.0055)
                    vv -= (ten + kn) * back
            ring.append(P(u, vv, ww))
        rings.append(ring)
    mb.loft(rings, mat, wfn, None, cap0=True, cap1=True, flip=not flip)
    for wf, sc, r, ku in fingers:
        Rf = rg + r + 0.0005
        K = V((ku - 0.004, 0.001))
        lens = [0.040 * sc, 0.026 * sc, 0.021 * sc]
        best = None
        for k in range(200):
            phi = rad(-60 + k)
            q = V((G.x + Rf * math.cos(phi), G.y + Rf * math.sin(phi)))
            dd = abs((q - K).length - lens[0])
            if best is None or dd < best[0]:
                best = (dd, phi, q)
        phi = best[1]
        joints = [K, best[2]]
        for L in lens[1:]:
            phi += 2 * math.asin(min(0.99, L / (2 * Rf)))
            joints.append(V((G.x + Rf * math.cos(phi), G.y + Rf * math.sin(phi))))
        pts = []
        for a_, b_ in zip(joints, joints[1:]):
            pts += [a_, a_.lerp(b_, 0.5)]
        pts.append(joints[-1])
        pts3 = [V((p.x, p.y, wf)) for p in pts]
        rad_ = [r * 1.04, r * 0.97, r * 1.0, r * 0.92, r * 0.94, r * 0.88, r * 0.84]
        bony = [0.14, 0.0, 0.16, 0.0, 0.12, 0.0, 0.0]          # dorsal bumps at the joints
        rings = []
        for i, p in enumerate(pts3):
            t = (pts3[min(i + 1, len(pts3) - 1)] - pts3[max(i - 1, 0)]).normalized()
            dors = V((p.x - G.x, p.y - G.y, 0.0)).normalized()
            ring = ring_around(p, t, rad_[i], 10, ref=V((0, 0, 1)))
            out = []
            for q in ring:
                dq = (q - p).normalized()
                k = 1.0 + bony[i] * max(0.0, dq.dot(dors)) ** 2
                out.append(p + (q - p) * k)
            rings.append([P(q.x, q.y, q.z) for q in out])
        tip = pts3[-1] + (pts3[-1] - pts3[-2]).normalized() * r * 0.75
        mb.loft(rings, mat, wfn, None, cap0=True, cap1=P(tip.x, tip.y, tip.z), flip=flip)
        # the nail on the last phalanx
        a_, b_ = pts3[-3], pts3[-1]
        nail_plate(mb, P, a_.lerp(b_, 0.40), b_ + (b_ - a_).normalized() * r * 0.30, G, r * 0.93, wfn, flip)
    # thumb over the fingers, with its nail
    v_top = G.y + rg + 0.019
    tp = [V((0.010, 0.010, 0.024)), V((0.030, 0.022, 0.038)), V((0.050, 0.040, 0.044)),
          V((0.064, v_top - 0.006, 0.036)), V((0.077, v_top, 0.022)), V((0.087, v_top + 0.002, 0.008))]
    rr = [0.0145, 0.0128, 0.0112, 0.0102, 0.0096, 0.0086]
    rings = []
    for i, p in enumerate(tp):
        t = (tp[min(i + 1, 5)] - tp[max(i - 1, 0)]).normalized()
        ring = ring_around(p, t, rr[i], 10, ref=V((0, 1, 0)))
        if i == 3:
            ring = [p + (q - p) * (1.0 + 0.10 * max(0.0, (q - p).normalized().y) ** 2) for q in ring]
        rings.append([P(q.x, q.y, q.z) for q in ring])
    tip = tp[-1] + (tp[-1] - tp[-2]).normalized() * 0.0075
    mb.loft(rings, mat, wfn, None, cap0=True, cap1=P(tip.x, tip.y, tip.z), flip=flip)
    up = V((0.0, 1.0, 0.0))
    nail_plate(mb, P, tp[4].lerp(tp[5], 0.15), tp[5] + (tp[5] - tp[4]).normalized() * 0.003, None, 0.0094,
               wfn, flip, dorsal=up)


def nail_plate(mb, P, a, b, G, r, wfn, flip, dorsal=None):
    """A slightly domed nail plate on a finger's back, from a to b (hand frame)."""
    t = (b - a).normalized()
    if dorsal is None:
        mid = (a + b) * 0.5
        dorsal = V((mid.x - G.x, mid.y - G.y, 0.0)).normalized()
    dorsal = (dorsal - t * dorsal.dot(t)).normalized()
    side = t.cross(dorsal).normalized()
    rows = []
    n_a, n_b = 4, 3
    for j in range(n_b):
        f = j / (n_b - 1)
        c = a.lerp(b, f)
        half = math.radians(52) * (0.85 + 0.15 * math.sin(math.pi * f))
        outer, inner = [], []
        for i in range(n_a):
            ang = -half + 2 * half * i / (n_a - 1)
            dirv = dorsal * math.cos(ang) + side * math.sin(ang)
            outer.append(c + dirv * (r + 0.00055))
            inner.append(c + dirv * (r - 0.0006))
        rows.append(outer + list(reversed(inner)))
    rows = [[P(q.x, q.y, q.z) for q in ring] for ring in rows]
    mb.loft(rows, 'nail', wfn, None, cap0=True, cap1=True, smooth=True, flip=flip)


# ---- garment helpers --------------------------------------------------------

def wrap_deg(a):
    a = math.degrees(a) % 360
    return a - 360 if a > 180 else a


def surf_patch2(mb, sec, th0, th1, z_top, z_bot, thick, mat, wfn, nth=4, nz=2, base=-0.002, bulge=0.0,
                smooth=False, cfn=None, zfn=None, sag_out=0.0):
    """Conforming slab whose bottom edge z_bot(t) may vary across (scalloped
    flaps); t runs 0..1 from th0 to th1 (th0 < th1)."""
    zb = z_bot if callable(z_bot) else (lambda t: z_bot)
    rings = []
    for k in range(nz + 1):
        v = k / nz
        outer, inner = [], []
        for i in range(nth + 1):
            t = i / nth
            th = lerp(th0, th1, t)
            z = lerp(zb(t), z_top, v) + (zfn(th) if zfn else 0.0)
            b = bulge * math.sin(math.pi * t) * math.sin(math.pi * (0.3 + 0.7 * v))
            b += sag_out * (1 - v) ** 1.5             # loaded pouch bellying out at the bottom
            outer.append(sec.surf(th, z, thick + b))
            inner.append(sec.surf(th, z, base))
        rings.append(outer + list(reversed(inner)))
    mb.loft(rings, mat, wfn, cfn, cap0=True, cap1=True, smooth=smooth)


def stud(mb, p, n, r, mat, wfn, h=0.003, seg=8):
    """A button / snap: a short cylinder with a domed top along normal n."""
    n = V(n).normalized()
    p = V(p)
    lathe_axis(mb, p - n * 0.001, p + n * h, [(0, r), (0.6, r), (1.0, r * 0.55)], min(seg, 6), mat, wfn)


def surf_stud(mb, sec, th, z, off, r, mat, wfn, h=0.003):
    stud(mb, sec.surf(th, z, off), sec.normal(th, z), r, mat, wfn, h)


def sag_front(depth):
    """Belt sag: lowest at the front buckle, level at the back."""
    return lambda th: -depth * (0.5 + 0.5 * math.cos(th)) ** 1.5


def frame_buckle(mb, c, R3, w, h, t, mat, wfn):
    """Rectangular buckle frame (w x h, bar thickness t) in the plane of R3's
    X (width) and Z (height) axes."""
    X = R3.col[0].normalized()
    Z = (R3.col[2] - X * X.dot(R3.col[2])).normalized()
    Y = Z.cross(X)
    R3 = axes_matrix(X, Y, Z).to_3x3()
    for sx, sz, sw, sh in ((0, h / 2, w, t), (0, -h / 2, w, t), (w / 2, 0, t, h), (-w / 2, 0, t, h)):
        mb.box(V(c) + X * sx + Z * sz, (sw, t, sh), mat, wfn, rot=R3)
    mb.box(V(c), (t * 0.8, t, h), mat, wfn, rot=R3)         # the prong bar


def strap_path(mb, pts, normals, width, thick, mat, wfn):
    """A flat strap following points with given outward normals."""
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = V(normals[i]).normalized()
        s_ = n.cross(t).normalized() * (width / 2)
        o = n * thick
        rings.append([p - s_, p + s_, p + s_ + o, p - s_ + o])
    mb.loft(rings, mat, wfn, None, cap0=True, cap1=True, smooth=False)


def torso_rings(sec, zs, seg, disp):
    rings = []
    for z in zs:
        ring = []
        for i in range(seg):
            th = 2 * math.pi * i / seg
            ring.append(sec.point(th, z, disp(th, z)))
        rings.append(ring)
    return rings


def torso_folds(belt_top, seed, back_yoke=1.36):
    nz = fold_noise(seed)

    def f(th, z):
        a = wrap_deg(th)
        aa = abs(a)
        ca, sa = math.cos(th), math.sin(th)
        d = 0.0
        # bloused cloth above the belt: soft horizontal rolls
        w = smoothstep(belt_top - 0.002, belt_top + 0.012, z) * smoothstep(belt_top + 0.11, belt_top + 0.06, z)
        if w > 0:
            ph = 2 * math.pi * (z - belt_top) / 0.030 + 1.8 * nz(ca * 1.5, sa * 1.5)
            d += w * 0.0050 * (0.35 + 0.65 * max(0.0, math.sin(ph)) ** 0.8)
        # under the arms: diagonal pull folds
        for side in (1, -1):
            da = a - side * 90
            w = _g(da, 0, 28) * smoothstep(1.19, 1.25, z) * smoothstep(1.39, 1.33, z)
            if w > 0:
                d += w * 0.0032 * math.sin(z * 75 + side * th * 3.2 + nz(z * 4) * 2)
        # chest / back drape between the shoulder blades
        w = smoothstep(1.22, 1.27, z) * smoothstep(1.40, 1.34, z) * _g(aa, 180, 30)
        d += w * 0.0025 * math.sin(th * 9 + z * 30)
        # skirt below the belt: vertical drape
        w = smoothstep(belt_top - 0.085, belt_top - 0.11, z) * smoothstep(0.79, 0.83, z)
        if w > 0:
            d += w * 0.0042 * math.sin(th * 11 + 2.2 * nz(z * 6, ca, sa))
        # side seams and the back yoke seam
        d -= 0.0012 * (_g(a, 90, 2.5) + _g(a, -90, 2.5)) * smoothstep(1.32, 1.28, z)
        d -= 0.0012 * _g(z, back_yoke, 0.004) * smoothstep(110, 130, aa)
        # crumple
        d += 0.0014 * nz(ca * 7, sa * 7, z * 14) * smoothstep(1.44, 1.40, z)
        return d
    return f


def arm_muscles(s, a):
    """v4: the arm under the sleeve (radial m): deltoid cap, biceps, triceps,
    the bony elbow, the forearm's extensor and flexor masses, a flatter wrist.
    a = 0 front, 90 medial (towards the body), 180 back, 270 lateral (top)."""
    A = math.degrees(a) % 360
    dl = lambda c, w: _g(((A - c + 180) % 360) - 180, 0.0, w)
    d = 0.0
    d += 0.0060 * _g(s, 0.045, 0.040) * (0.35 + 0.65 * dl(270, 70))          # deltoid
    d += 0.0038 * _g(s, 0.170, 0.045) * dl(0, 48)                             # biceps
    d += 0.0034 * _g(s, 0.150, 0.055) * dl(200, 55)                           # triceps
    d -= 0.0022 * _g(s, 0.285, 0.020) * dl(90, 60)                            # inside of the elbow
    d += 0.0020 * _g(s, 0.300, 0.016) * dl(180, 35)                           # olecranon
    d += 0.0042 * _g(s, 0.350, 0.035) * dl(300, 55)                           # brachioradialis / extensors
    d += 0.0030 * _g(s, 0.355, 0.040) * dl(60, 55)                            # flexors
    d -= 0.0020 * smoothstep(0.40, 0.48, s) * (dl(0, 40) + dl(180, 40))       # flatter towards the wrist
    return d


def sleeve_folds(seed):
    nz = fold_noise(seed)

    def f(s, a):
        A = math.degrees(a) % 360
        Af = A if A <= 180 else 360 - A          # 0 front (inner elbow) .. 180 back
        d = 1.0 * arm_muscles(s, a)
        w = smoothstep(0.235, 0.26, s) * smoothstep(0.36, 0.335, s)
        if w > 0:
            d += w * _g(Af, 0, 62) * 0.0048 * math.sin(2 * math.pi * (s - 0.24) / 0.024 + 0.6 * math.cos(a))
        d += 0.0022 * _g(s, 0.305, 0.03) * _g(Af, 180, 55)
        w = smoothstep(0.05, 0.10, s) * smoothstep(0.22, 0.17, s)
        d += w * 0.0026 * math.sin(3 * a + s * 42 + nz(s * 5))
        w = smoothstep(0.37, 0.41, s) * smoothstep(0.50, 0.46, s)
        d += w * 0.0020 * math.sin(2 * a + s * 55 + nz(s * 6, 1.0))
        d += 0.0020 * smoothstep(0.499, 0.506, s)
        d -= 0.0014 * _g(s, 0.032, 0.0045)
        d += 0.0010 * nz(math.cos(a) * 3, math.sin(a) * 3, s * 20)
        return d
    return f


def leg_muscles(s, a):
    """v4: the leg under the trousers (radial m): quadriceps, the inner thigh,
    hamstrings, the kneecap, the calf. a = 0 front, 90 medial, 180 back."""
    A = math.degrees(a) % 360
    dl = lambda c, w: _g(((A - c + 180) % 360) - 180, 0.0, w)
    d = 0.0
    d += 0.0055 * _g(s, 0.200, 0.080) * dl(345, 55)                           # quadriceps (front, outer)
    d += 0.0035 * _g(s, 0.300, 0.040) * dl(40, 30)                            # vastus medialis (teardrop)
    d += 0.0040 * _g(s, 0.180, 0.080) * dl(180, 55)                           # hamstrings
    d += 0.0025 * _g(s, 0.100, 0.060) * dl(95, 40)                            # inner thigh
    d += 0.0022 * _g(s, 0.420, 0.020) * dl(0, 35)                             # kneecap
    d -= 0.0015 * _g(s, 0.430, 0.025) * dl(180, 40)                           # back of the knee
    d += 0.0050 * _g(s, 0.560, 0.055) * dl(175, 50)                           # calf
    return d


def leg_folds(seed, bunch):
    nz = fold_noise(seed)
    b0, b1 = bunch

    def f(s, a):
        A = math.degrees(a) % 360
        Af = A if A <= 180 else 360 - A          # 0 front .. 180 back
        d = 0.9 * leg_muscles(s, a)
        w = smoothstep(0.355, 0.375, s) * smoothstep(0.475, 0.455, s)
        if w > 0:
            d += w * _g(Af, 180, 58) * 0.0045 * math.sin(2 * math.pi * (s - 0.36) / 0.022)
        d += 0.0020 * _g(s, 0.42, 0.03) * _g(Af, 0, 50)
        w = smoothstep(0.03, 0.07, s) * smoothstep(0.20, 0.15, s)
        d += w * _g(A, 90, 50) * 0.0030 * math.sin(s * 95 + a * 2)
        w = smoothstep(b0, b0 + 0.012, s) * smoothstep(b1, b1 - 0.010, s)
        if w > 0:
            d += w * 0.0055 * (0.45 + 0.55 * math.sin(2 * math.pi * (s - b0) / 0.017 + 2.2 * nz(math.cos(a), math.sin(a))))
        d += 0.0016 * _g(Af, 0, 7) * smoothstep(0.08, 0.12, s) * smoothstep(b0, b0 - 0.05, s)
        d += 0.0012 * nz(math.cos(a) * 3, math.sin(a) * 3, s * 16)
        return d
    return f


SLEEVE2 = [(0.00, 0.064, 0.063), (0.06, 0.060, 0.059), (0.13, 0.056, 0.053), (0.21, 0.051, 0.049),
           (0.27, 0.048, 0.047), (0.31, 0.048, 0.047, 0.002), (0.36, 0.050, 0.048), (0.45, 0.045, 0.043),
           (0.50, 0.042, 0.040), (0.532, 0.042, 0.040)]


def build_sleeves(mb, mat, seed):
    steps = s_steps(0.0, 0.532, 0.026, dense=((0.225, 0.365, 0.0095), (0.0, 0.05, 0.016), (0.49, 0.532, 0.014)))
    for s in ('l', 'r'):
        limb2(mb, arm_points('l'), SLEEVE2, steps, 16, mat, w_arm(s), None, ball=0.064, lip=(0.034, 0.02),
              mirror=(s == 'r'), disp=sleeve_folds(7 if s == 'l' else 11))


def build_trousers(mb, mat, prof, end, bunch, seed):
    steps = s_steps(0.0, end, 0.030, dense=((0.35, 0.475, 0.010), (bunch[0] - 0.005, bunch[1] + 0.005, 0.0085)))
    for s in ('l', 'r'):
        limb2(mb, leg_points('l'), prof, steps, 16, mat, w_leg(s), None, ball=0.090, mirror=(s == 'r'),
              disp=leg_folds(seed + (0 if s == 'l' else 5), bunch))


def build_pelvis(mb, mat):
    zp = [r[0] for r in PELVIS]
    mb.loft([Section(PELVIS).ring(z, 16) for z in zp], mat, w_pelvis, None, cap0=True, cap1=True)


def build_head_common(mb):
    mb.part('head')
    build_head4(mb)
    mb.part('hands')
    for s in ('l', 'r'):
        build_hand4(mb, s)


# ---- footwear ----------------------------------------------------------------

SHOE2 = [  # y, half width, top z, bottom z, x offset
    (0.080, 0.024, 0.062, 0.016, 0.000), (0.074, 0.034, 0.094, 0.014, 0.000), (0.060, 0.039, 0.118, 0.014, 0.000),
    (0.035, 0.042, 0.134, 0.014, 0.000), (0.005, 0.044, 0.135, 0.014, -0.002), (-0.030, 0.046, 0.120, 0.014, -0.004),
    (-0.065, 0.049, 0.098, 0.014, -0.005), (-0.100, 0.051, 0.082, 0.014, -0.005), (-0.135, 0.052, 0.070, 0.014, -0.004),
    (-0.165, 0.050, 0.063, 0.015, -0.003), (-0.188, 0.045, 0.058, 0.017, -0.002), (-0.204, 0.036, 0.052, 0.021, -0.001),
    (-0.214, 0.024, 0.046, 0.026, 0.000), (-0.219, 0.010, 0.040, 0.030, 0.000)]


def sole_outline(n=24, xc=0.102, yc=-0.069, half_len=0.1505):
    """Sole outline of the left foot, CCW seen from above (toe towards -Y)."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s_ = math.cos(a), math.sin(a)
        toe = s_ < 0
        hw = 0.050 if toe else 0.040
        if s_ < -0.6:
            hw *= 0.88
        x = xc + c * hw - 0.004 * max(0.0, -s_)
        y = yc + half_len * s_
        pts.append(V((x, y, 0)))
    return pts


def build_sole(mb, side, mat='rubber', z1=0.015, heel=0.026, nails=False):
    z0 = 0.0018 if nails else 0.0
    """Sole slab under the whole foot with a heel block; optional hobnails and
    a heel iron (Wehrmacht marching boots)."""
    wfn = w_rigid('foot_' + side)
    mx = (lambda v: v) if side == 'l' else _mx
    out = sole_outline(24)
    shrink = [V((0.102 + (p.x - 0.102) * 0.965, -0.069 + (p.y + 0.069) * 0.985, 0)) for p in out]
    rings = [[V((p.x, p.y, z0)) for p in shrink], [V((p.x, p.y, z0 + 0.002)) for p in out],
             [V((p.x, p.y, z1)) for p in out]]
    rings = [[mx(p) for p in r] for r in rings]
    mb.loft(rings, mat, wfn, None, cap0=True, cap1=True, flip=(side == 'r'), smooth=False)
    hb = []
    for i in range(14):
        a = 2 * math.pi * i / 14
        hb.append(V((0.102 + 0.037 * math.cos(a), 0.048 + (0.032 if math.sin(a) > 0 else 0.022) * math.sin(a), 0)))
    hr = [[mx(V((p.x, p.y, z))) for p in hb] for z in (z0, heel)]
    mb.loft(hr, mat, wfn, None, cap0=True, cap1=True, flip=(side == 'r'), smooth=False)
    if nails:
        for i in range(14):
            a = 2 * math.pi * (i + 0.5) / 14
            if math.sin(a) < -0.5:
                continue
            p = V((0.102 + 0.031 * math.cos(a), 0.048 + (0.026 if math.sin(a) > 0 else 0.017) * math.sin(a), 0.0011))
            mb.box(mx(p), (0.007, 0.007, 0.0022), 'gun_metal_worn', wfn)
        for y in (-0.050, -0.090, -0.130, -0.170):
            for x in (-0.028, 0.0, 0.028):
                mb.box(mx(V((0.100 + x, y, 0.0011))), (0.005, 0.005, 0.0022), 'gun_metal_worn', wfn)


def build_shoe2(mb, side, mat, top_cut=None, stations=SHOE2):
    st = list(stations)
    if top_cut is not None:
        st = [(y, hw, min(t, top_cut), b, xo) for y, hw, t, b, xo in st]
    rings = foot_rings(st, seg=14, mirror=(side == 'r'))
    mb.loft(rings, mat, w_rigid('foot_' + side), None, cap0=True, cap1=True, flip=(side == 'r'))


def legging_us(mb, side):
    """M1938 canvas legging: laced on the outside with hooks, a strap under
    the instep."""
    mir = (lambda v: v) if side == 'l' else _mx
    wfn = w_leg(side, 0.03)
    rows = [(0.060, 0.059, 0.082, 0.004), (0.085, 0.057, 0.076, 0.006), (0.12, 0.055, 0.066, 0.010),
            (0.16, 0.055, 0.062, 0.012), (0.20, 0.057, 0.061, 0.012), (0.24, 0.060, 0.062, 0.011),
            (0.28, 0.063, 0.064, 0.009), (0.315, 0.066, 0.067, 0.006), (0.345, 0.068, 0.069, 0.004)]
    nz = fold_noise(23 if side == 'l' else 29)
    rings = []
    for z, rx, ry, yc in rows:
        ring = []
        for i in range(16):
            a = 2 * math.pi * i / 16
            d = 0.0012 * nz(math.cos(a) * 2, math.sin(a) * 2, z * 15)
            d += 0.0060 * _g(z, 0.285, 0.050) * max(0.0, math.sin(a)) ** 2      # the calf (v4)
            if z < 0.10:
                d += 0.0015 * math.sin(a * 6)
            ring.append(V((0.100 + math.cos(a) * (rx + d), yc + math.sin(a) * (ry + d), z)))
        rings.append(ring)
    sec = Section([(z, rx, ry, ry, yc, 2.0) for z, rx, ry, yc in rows], cx=0.100)
    rings.append([V((0.100 + math.cos(2 * math.pi * i / 16) * 0.061, 0.004 + math.sin(2 * math.pi * i / 16) * 0.062, 0.345))
                  for i in range(16)])
    rings = [[mir(p) for p in r] for r in rings]
    mb.loft(rings, 'webbing', wfn, None, cap0=False, cap1=True, flip=(side == 'r'))
    # lacing on the outer side: overlap flap, hooks, crossing lace
    S = sec if side == 'l' else _MirSec(sec)
    th = rad(90) if side == 'l' else rad(270)
    surf_strip(mb, S, [(th - rad(4) * (1 if side == 'l' else -1), z) for z in (0.065, 0.15, 0.25, 0.34)], 0.020,
               0.003, 'webbing', wfn)
    zs = [0.090 + 0.040 * k for k in range(7)]
    hooks = []
    for k, z in enumerate(zs):
        for e in (-1, 1):
            t2 = th + e * rad(10)
            p = S.surf(t2, z, 0.0045)
            n = S.normal(t2, z)
            mb.box(p, (0.006, 0.006, 0.006), 'gun_metal_worn', wfn)
            hooks.append((k, e, p + n * 0.003))
    lace = []
    for k in range(len(zs)):
        e = 1 if k % 2 == 0 else -1
        lace.append([q for (kk, ee, q) in hooks if kk == k and ee == e][0])
        lace.append([q for (kk, ee, q) in hooks if kk == k and ee == -e][0])
    for a_, b_ in zip(lace, lace[1:]):
        mb.cylinder(a_, b_, 0.0014, 'leather', wfn, seg=3, cap=False)
    # instep strap under the shoe
    pts = [mir(V((0.100 + 0.051 * math.cos(a), -0.012, 0.004 + 0.075 * (0.5 + 0.5 * math.sin(a)) ** 1.6)))
           for a in [math.pi * (-0.05 + 1.1 * i / 10) for i in range(11)]]
    pts = [V((p.x, p.y, max(0.001, p.z))) for p in pts]
    nrm = [V((p.x - mir(V((0.100, 0, 0))).x, 0, p.z - 0.05)).normalized() for p in pts]
    strap_path(mb, pts, nrm, 0.018, 0.003, 'leather', w_rigid('foot_' + side))


def jackboot(mb, side):
    """Marschstiefel: tall shaft wrinkled at the ankle, hobnailed sole."""
    mir = (lambda v: v) if side == 'l' else _mx
    wfn = w_leg(side, 0.03)
    nz = fold_noise(31 if side == 'l' else 37)
    rows = [(0.050, 0.050, 0.076, 0.012), (0.080, 0.049, 0.068, 0.012), (0.110, 0.047, 0.060, 0.012),
            (0.140, 0.047, 0.057, 0.011), (0.165, 0.049, 0.056, 0.010), (0.190, 0.051, 0.056, 0.008),
            (0.230, 0.055, 0.058, 0.005), (0.280, 0.059, 0.060, 0.002), (0.330, 0.062, 0.063, -0.002),
            (0.365, 0.064, 0.065, -0.003), (0.392, 0.066, 0.067, -0.004)]
    rings = []
    for z, rx, ry, yc in rows:
        ring = []
        for i in range(18):
            a = 2 * math.pi * i / 18
            d = 0.0
            w = smoothstep(0.09, 0.11, z) * smoothstep(0.215, 0.19, z)
            d += w * 0.0035 * math.sin(2 * math.pi * (z - 0.10) / 0.028 + 1.6 * nz(math.cos(a), math.sin(a)))
            d += 0.0008 * nz(math.cos(a) * 3, math.sin(a) * 3, z * 10)
            d += 0.0035 * _g(z, 0.300, 0.055) * max(0.0, math.sin(a)) ** 2      # the calf (v4)
            ring.append(V((0.100 + math.cos(a) * (rx + d), yc + math.sin(a) * (ry + d), z)))
        rings.append(ring)
    rings.append([V((0.100 + math.cos(2 * math.pi * i / 18) * 0.061, -0.004 + math.sin(2 * math.pi * i / 18) * 0.062, 0.392))
                  for i in range(18)])
    rings.append([V((0.100 + math.cos(2 * math.pi * i / 18) * 0.058, -0.004 + math.sin(2 * math.pi * i / 18) * 0.059, 0.36))
                  for i in range(18)])
    rings = [[mir(p) for p in r] for r in rings]
    mb.loft(rings, 'leather_black', wfn, None, cap0=False, cap1=True, flip=(side == 'r'))
    # back seam
    sec = Section([(z, rx, ry, ry, yc, 2.0) for z, rx, ry, yc in rows], cx=0.100)
    S = sec if side == 'l' else _MirSec(sec)
    surf_strip(mb, S, [(math.pi, z) for z in (0.06, 0.15, 0.25, 0.39)], 0.006, 0.0018, 'leather_black', wfn)


# ---- helmets ------------------------------------------------------------------

def build_m1_helmet2(mb):
    """M1: steel pot under a cotton net (baked), stainless rim, the liner
    edge and suspension inside, webbing chin straps on bales."""
    wfn = w_rigid('head')
    c = HEAD_C + V((0, 0.004, 0))
    seg = 32
    a_len, a_wid = 0.143, 0.121
    z_top = c.z + 0.140

    def rim_z(th):
        cth = math.cos(th)
        return c.z + 0.012 + 0.016 * cth - 0.012 * (1 - abs(math.sin(th))) * (cth < 0)

    def rim_xy(th, k=1.0):
        s_, cth = math.sin(th), math.cos(th)
        e = 2 / 2.3
        return (math.copysign(abs(s_) ** e, s_) * a_wid * k, -math.copysign(abs(cth) ** e, cth) * a_len * k)

    def shell(t, k=1.0, dz=0.0):
        ring = []
        for i in range(seg):
            th = 2 * math.pi * i / seg
            z0 = rim_z(th)
            psi = t * math.pi / 2
            kk = math.cos(psi) ** 0.8 * k
            x, y = rim_xy(th, kk)
            z = z0 + (z_top - z0) * math.sin(psi) ** 1.15 + dz
            ring.append(V((c.x + x, c.y + y, z)))
        return ring
    # rim: rolled stainless edge
    lip = []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        x, y = rim_xy(th, 1.045)
        lip.append(V((c.x + x, c.y + y, rim_z(th) - 0.004)))
    inner = []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        x, y = rim_xy(th, 0.955)
        inner.append(V((c.x + x, c.y + y, rim_z(th) + 0.012)))
    mb.loft([inner, lip, shell(0.0, 1.03, -0.001)], 'gun_metal_worn', wfn, None, smooth=True)
    rings = [shell(0.0, 1.03, -0.001)] + [shell(t) for t in (0.04, 0.16, 0.30, 0.44, 0.58, 0.70, 0.80, 0.88, 0.94, 0.98)]
    mb.loft(rings, 'helmet_net', wfn, None, cap1=V((c.x, c.y, z_top + 0.001)))
    # liner: visible inside the rim, with the suspension band
    liner = [shell(0.0, 0.935, 0.010), shell(0.12, 0.925, 0.010)]
    mb.loft([list(reversed(r)) for r in liner], 'helmet_od', wfn, None, cap1=V((c.x, c.y, c.z + 0.07)))
    band = [[V((c.x + rim_xy(2 * math.pi * i / seg, 0.86)[0], c.y + rim_xy(2 * math.pi * i / seg, 0.86)[1],
                rim_z(2 * math.pi * i / seg) + dz)) for i in range(seg)] for dz in (0.016, 0.034)]
    mb.loft([list(reversed(r)) for r in band], 'webbing', wfn, None, smooth=False)
    # chin straps: from the bales along the outside of the shell to the back,
    # buckled there and hooked up over the rim (as worn in Normandy, v4)
    def shell_pt(th, t, out=0.0):
        p = shell_at(th, t)
        dth, dt = 1e-3, 1e-3
        n = (shell_at(th + dth, t) - shell_at(th - dth, t)).cross(shell_at(th, t + dt) - shell_at(th, max(0.0, t - dt)))
        n.normalize()
        if n.dot(p - V((c.x, c.y, c.z + 0.05))) < 0:
            n = -n
        return p + n * out, n

    def shell_at(th, t):
        z0 = rim_z(th)
        psi = t * math.pi / 2
        kk = math.cos(psi) ** 0.8
        x, y = rim_xy(th, kk)
        return V((c.x + x, c.y + y, z0 + (z_top - z0) * math.sin(psi) ** 1.15))
    for side in (1, -1):
        b_ = V((c.x + side * a_wid * 1.005, c.y + 0.012, rim_z(rad(90)) + 0.006))
        wtorus_w(mb, b_, V((side, 0, 0)), 0.0065, 0.0013, 'gun_metal_worn', wfn)
        pts, nrm = [], []
        for k in range(12):
            th = side * rad(lerp(88.0, 171.0, k / 11))
            t = lerp(0.092, 0.075, k / 11)
            p, n = shell_pt(th, t, 0.0024)
            pts.append(p)
            nrm.append(n)
        strap_path(mb, pts, nrm, 0.016, 0.0020, 'cloth_od_dark', wfn)
    # the buckle at the back, its tail hooked over the rolled edge and tucked under
    p, n = shell_pt(math.pi, 0.068, 0.0040)
    X = V((1, 0, 0))
    Z = (V((0, 0, 1)) - n * n.z).normalized()
    frame_buckle(mb, p, axes_matrix(X, -n, Z).to_3x3(), 0.020, 0.018, 0.0024, 'gun_metal_worn', wfn)
    tail = [shell_pt(math.pi + rad(4), 0.062, 0.0030), shell_pt(math.pi + rad(4), 0.012, 0.0040)]
    q = rim_xy(math.pi + rad(4), 1.05)
    lip = V((c.x + q[0], c.y + q[1], rim_z(math.pi) - 0.0065))
    q2 = rim_xy(math.pi + rad(4), 0.975)
    under = V((c.x + q2[0], c.y + q2[1], rim_z(math.pi) - 0.0010))
    pts = [tail[0][0], tail[1][0], lip, under]
    nrm = [tail[0][1], tail[1][1], (tail[1][1] + V((0, 0, -1))).normalized(), V((0, 0, -1))]
    strap_path(mb, pts, nrm, 0.015, 0.0020, 'cloth_od_dark', wfn)


def wtorus_w(mb, c, axis, R_, r, mat, wfn, seg=10, tseg=4):
    n, b = frame_from(V(axis).normalized())
    pts = [V(c) + (n * math.cos(2 * math.pi * i / seg) + b * math.sin(2 * math.pi * i / seg)) * R_ for i in range(seg)]
    rings = []
    for i in range(seg):
        t = (pts[(i + 1) % seg] - pts[i - 1]).normalized()
        rings.append(ring_around(pts[i], t, r, tseg, V(axis)))
    mb.loft(rings + [rings[0]], mat, wfn, None)


def build_stahlhelm2(mb):
    """M40 Stahlhelm with rolled edge, liner band, split rivets, vent lugs and
    a leather chin strap."""
    wfn = w_rigid('head')
    c = HEAD_C + V((0, 0.012, 0))
    seg = 32
    z_top = c.z + 0.132

    def ang(th):
        a = abs(math.degrees(th)) % 360
        return 360 - a if a > 180 else a

    def step_z(th):
        a = ang(th)
        return c.z + lerp(0.042, 0.026, smoothstep(0, 85, a)) - 0.016 * smoothstep(95, 175, a)

    def drop(th):
        a = ang(th)
        return lerp(0.020, 0.066, smoothstep(12, 80, a)) + 0.020 * smoothstep(100, 170, a)

    def flare(th):
        a = ang(th)
        return lerp(0.036, 0.030, smoothstep(0, 70, a)) + 0.022 * smoothstep(100, 172, a)

    def dome_xy(th, k):
        s_, cth = math.sin(th), math.cos(th)
        e = 2 / 2.4
        return V((math.copysign(abs(s_) ** e, s_) * 0.111 * k,
                  -math.copysign(abs(cth) ** e, cth) * (0.126 if cth > 0 else 0.123) * k, 0))

    def out_dir(th):
        return V((math.sin(th), -math.cos(th), 0))

    def skirt_pt(th, t, inset=0.0):
        zs = step_z(th)
        base = dome_xy(th, 1.0)
        f = 0.006 + flare(th) * (0.35 * t + 0.65 * t ** 2.2) - inset
        p = base + out_dir(th) * f
        return V((c.x + p.x, c.y + p.y, zs - drop(th) * t))

    def ring(fn):
        return [fn(2 * math.pi * i / seg) for i in range(seg)]
    rings = [ring(lambda th: skirt_pt(th, 0.80, 0.009)),                   # inside face of the skirt
             ring(lambda th: skirt_pt(th, 1.0, 0.004) + V((0, 0, -0.003))),
             ring(lambda th: skirt_pt(th, 1.0) + V((0, 0, -0.0045))),        # rolled edge
             ring(lambda th: skirt_pt(th, 0.96) + out_dir(th) * 0.0022)]
    for t in (0.80, 0.58, 0.34, 0.12):
        rings.append(ring(lambda th, t=t: skirt_pt(th, t)))
    for t in (0.0, 0.14, 0.32, 0.50, 0.66, 0.80, 0.91, 0.97):
        def dome(th, t=t):
            zs = step_z(th)
            psi = t * math.pi / 2
            k = math.cos(psi) ** 0.62
            pp = dome_xy(th, k)
            z = zs + 0.004 + (z_top - zs) * math.sin(psi) ** 1.05
            if t == 0.0:
                pp = dome_xy(th, 1.0) - out_dir(th) * 0.0015          # the crease at the step
            return V((c.x + pp.x, c.y + pp.y, z))
        rings.append(ring(dome))
    mb.loft(rings, 'helmet_gray', wfn, None, cap0=V((c.x, c.y, c.z + 0.035)), cap1=V((c.x, c.y, z_top + 0.0015)))
    # leather liner band just inside the step
    lb = [ring(lambda th: V((c.x, c.y, 0)) + dome_xy(th, 0.93) + V((0, 0, step_z(th) - dz))) for dz in (0.004, 0.026)]
    mb.loft([list(reversed(r)) for r in lb], 'leather', wfn, None, smooth=True)
    # split rivets (sides and back) and vent lugs
    for th in (rad(90), rad(-90), rad(180)):
        p = skirt_pt(th, 0.30) + out_dir(th) * 0.0015
        stud(mb, p, out_dir(th), 0.0048, 'helmet_gray', wfn, h=0.0022)
    for side in (1, -1):
        th = rad(90 * side)
        p = V((c.x, c.y, 0)) + dome_xy(th, 0.93) + V((0, 0.004, c.z + 0.060))
        stud(mb, p, out_dir(th), 0.0066, 'helmet_gray', wfn, h=0.006, seg=10)
        stud(mb, p + out_dir(th) * 0.006, out_dir(th), 0.0030, 'gun_metal_worn', wfn, h=0.0015, seg=8)
    # chin strap under the chin (v4): from the liner inside the skirt, in front
    # of the ears, over the jaw and under the chin, lying on the skin; skinned
    # like the skin under it and moved by the face morphs with it
    path = [(84.0, 0.024, 0.0050), (81.5, 0.004, 0.0028), (79.0, -0.018, 0.0010), (76.0, -0.042, 0.0005),
            (72.0, -0.064, 0.0005), (65.0, -0.085, 0.0005), (55.0, -0.101, 0.0005), (43.0, -0.112, 0.0005),
            (30.0, -0.119, 0.0005), (15.0, -0.1235, 0.0005), (0.0, -0.1250, 0.0005)]
    skin_strap(mb, path, 0.013, 0.0024, 'leather_black')
    # buckle on the left, over the jaw
    p, n, t = skin_frame(58.0, float(head4_unwarp(-0.0965)), 0.0030)
    b0 = len(mb.co)
    frame_buckle(mb, p, axes_matrix(t, -n, n.cross(t).normalized() * -1.0).to_3x3(), 0.017, 0.015, 0.0022,
                 'gun_metal_worn', w_headneck)
    mb.morph_follow += list(range(b0, len(mb.co)))


def skin_frame(th_deg, zr, lift):
    """Point on the v4 head surface at parameter angle th_deg (left side), z_rel,
    lifted along the normal; with the normal and the tangent along +theta."""
    np = _np()
    e = 1e-4
    th = np.radians(np.array([th_deg, th_deg + 0.05, th_deg - 0.05, th_deg, th_deg]))
    zz = np.array([zr, zr, zr, zr + e, zr - e])
    X, Y, Z = head4_field(th, zz)
    P = [V((X[i], Y[i], Z[i])) + HEAD_C for i in range(5)]
    tt = (P[1] - P[2]).normalized()
    tz = (P[3] - P[4]).normalized()
    n = tt.cross(tz).normalized()
    if n.dot(P[0] - (HEAD_C + V((0, 0, zr)))) < 0:
        n = -n
    return P[0] + n * lift, n, tt


def skin_strap(mb, path, width, thick, mat):
    """A strap lying on the v4 head (both sides, joined under the chin):
    path rows (theta deg on the left side, z_rel, lift)."""
    b0 = len(mb.co)
    left = [skin_frame(th, float(head4_unwarp(zr)), lift) for th, zr, lift in path]   # path in design z
    pts = [p for p, n, t in left] + [_mx(p) for p, n, t in reversed(left[:-1])]
    nrm = [n for p, n, t in left] + [_mx(n) for p, n, t in reversed(left[:-1])]
    strap_path(mb, pts, nrm, width, thick, mat, w_headneck)
    mb.morph_follow += list(range(b0, len(mb.co)))


# ---- outfits v2 ---------------------------------------------------------------

def torso_zs(belt_top):
    return s_steps(0.785, 1.482, 0.026, dense=((0.785, 0.83, 0.015), (belt_top - 0.005, belt_top + 0.115, 0.011),
                                               (1.19, 1.40, 0.018), (1.40, 1.482, 0.013)))


def jacket_shell(mb, sec, mat, belt_top, seed, wt, mats=None, seg=32):
    zs = torso_zs(belt_top)
    disp = torso_folds(belt_top, seed)
    rings = torso_rings(sec, zs, seg, disp)
    hem = sec.ring(zs[0], seg, -0.008)
    hem2 = sec.ring(zs[0] + 0.03, seg, -0.010)
    mf = None
    if mats:
        def mf(k, i):
            if k < 2:
                return mat
            z = 0.5 * (zs[k - 2] + zs[min(k - 1, len(zs) - 1)])
            return mats(2 * math.pi * (i + 0.5) / seg, z)
    mb.loft([hem2, hem] + rings, mat, wt, None, cap1=V((0, 0.032, 1.49)), mats=mf)
    return disp


def flap_pocket(mb, sec, a0, a1, z0, z1, mat, wt, button='helmet_gray', pleat=True, scallop=True,
                flap_h=0.034, thick=0.009):
    """Patch pocket (with a box pleat) and a scalloped flap with a button."""
    t0, t1 = (a0, a1) if a0 < a1 else (a1, a0)
    surf_patch2(mb, sec, t0, t1, z1, z0, thick, mat, wt, nth=4, nz=2, bulge=0.004)
    if pleat:
        surf_strip(mb, sec, [((t0 + t1) / 2, z) for z in (z0 + 0.004, (z0 + z1) / 2, z1 - flap_h + 0.004)], 0.018,
                   thick + 0.0022, mat, wt)
    zb = (lambda t: z1 - flap_h - (0.010 * (1 - abs(2 * t - 1)) if scallop else 0.0))
    surf_patch2(mb, sec, t0 - rad(1.2), t1 + rad(1.2), z1 + 0.005, zb, thick + 0.004, mat, wt, nth=4, nz=1)
    tm = (t0 + t1) / 2
    surf_stud(mb, sec, tm, z1 - flap_h - (0.006 if scallop else -0.004), thick + 0.006, 0.0062, button, wt)


def build_allied2(rig=None):
    """US infantryman 1944 (v2, v4 anatomy)."""
    mb = MeshBuilder()
    mb.sharp = 60
    sec = Section(TORSO_JACKET4)
    wt = w_torso(skirt=0.5)
    wh = w_rigid('hips')
    wc = w_rigid('chest')
    build_head_common(mb)
    mb.part('sleeves')
    build_sleeves(mb, 'cloth_khaki', 3)
    # cuff tabs with buttons
    for side in ('l', 'r'):
        pts = arm_points(side)
        c, t = chain_eval(pts, 0.515)
        n, b = frame_from(t, FWD)
        out = (b if side == 'l' else -b)
        out = (-n * 0.6 + out * 0.8).normalized()
        R3 = axes_matrix(t.cross(out).normalized(), -out, t).to_3x3()
        mb.box(c + out * 0.044, (0.020, 0.004, 0.034), 'cloth_khaki', w_arm(side), rot=R3, bevel=0.0012)
        stud(mb, c + out * 0.046 + t * 0.006, out, 0.0045, 'gun_metal_worn', w_arm(side), h=0.002)

    mb.part('jacket')

    def jmat(th, z):
        a = abs(wrap_deg(th))
        if z > 1.425 and a < 22 - (z - 1.425) * 60:
            return 'cloth_od'
        return 'cloth_khaki'
    jacket_shell(mb, sec, 'cloth_khaki', 1.038, 3, wt, mats=jmat)
    # zip/button placket, buttons, slash pocket welts, epaulettes with buttons
    surf_strip(mb, sec, [(0.0, z) for z in (0.80, 0.92, 1.04, 1.16, 1.28, 1.36, 1.42)], 0.034, 0.0045,
               'cloth_khaki', wt)
    for z in (0.88, 1.13, 1.23, 1.33, 1.405):
        surf_stud(mb, sec, rad(-4), z, 0.0055, 0.0068, 'gun_metal_worn', wt)
    for sd in (1, -1):
        surf_strip(mb, sec, [(sd * rad(a), z) for a, z in ((22, 1.00), (30, 0.955), (38, 0.91), (46, 0.865))],
                   0.016, 0.0045, 'cloth_khaki', wt)
        surf_strip(mb, sec, [(sd * rad(90), z) for z in (1.478, 1.466, 1.452, 1.437, 1.420, 1.408)],
                   0.046, 0.0045, 'cloth_khaki', wt)
        surf_stud(mb, sec, sd * rad(90), 1.468, 0.0065, 0.0058, 'gun_metal_worn', wt)
    mb.part('collar')
    # wool shirt collar band inside the V, its points, then the jacket collar + lapels
    neck_sec = Section([(1.44, 0.067, 0.061, 0.063, 0.032, 2.2), (1.53, 0.065, 0.066, 0.061, 0.024, 2.2)])
    surf_band(mb, neck_sec, 1.452, 1.508, -0.004, 0.006, 24, 'cloth_od', w_neck,
              zfn=lambda th: -0.008 * (0.5 + 0.5 * math.cos(th)) ** 2)
    for sd in (1, -1):
        surf_patch2(mb, sec, min(sd * rad(2), sd * rad(12)), max(sd * rad(2), sd * rad(12)), 1.468,
                    lambda t, sd=sd: 1.440 + 0.014 * (t if sd > 0 else 1 - t), 0.004, 'cloth_od', wt, nth=2, nz=1)
    # laid-down collar: from the neck seam it rolls over and lies on the shoulders
    rings = []
    prof = [(1.468, 0.069, -0.002), (1.494, 0.073, 0.000), (1.500, 0.081, 0.004), (1.486, 0.095, 0.006),
            (1.462, 0.110, 0.006)]
    n_th = 26
    for z, r, lift in prof:
        ring = []
        for i in range(n_th + 1):
            th = rad(24 + 312 * i / n_th)
            a = abs(wrap_deg(th))
            k = smoothstep(70, 24, a)                       # towards the front the collar runs down the lapels
            rr = r + 0.012 * k
            zz = z - 0.040 * k * (rr - 0.06) / 0.05
            sx, sy = math.sin(th), -math.cos(th)
            ring.append(V((sx * rr * 1.04, 0.032 + sy * rr * (0.98 if sy < 0 else 1.0), zz + lift)))
        rings.append(ring)
    mb.loft(rings, 'cloth_khaki', wt, None, closed=False, smooth=True)
    # lapels: triangular flaps folded back on the chest
    for sd in (1, -1):
        t0, t1 = (rad(9), rad(34)) if sd > 0 else (rad(-34), rad(-9))
        zb = (lambda t, sd=sd: 1.375 + 0.065 * (t if sd > 0 else 1 - t))
        surf_patch2(mb, sec, t0, t1, 1.448, zb, 0.006, 'cloth_khaki', wt, nth=4, nz=2)

    mb.part('trousers')
    build_pelvis(mb, 'cloth_od')
    LEG = [(0.00, 0.093, 0.093), (0.14, 0.092, 0.089), (0.26, 0.083, 0.079), (0.37, 0.069, 0.065),
           (0.42, 0.064, 0.061, 0.004), (0.47, 0.063, 0.061), (0.505, 0.068, 0.066, -0.004),
           (0.535, 0.069, 0.067, -0.004), (0.555, 0.058, 0.056), (0.585, 0.052, 0.050), (0.61, 0.048, 0.046)]
    build_trousers(mb, 'cloth_od', LEG, 0.61, (0.49, 0.56), 41)
    mb.part('leggings')
    for s in ('l', 'r'):
        legging_us(mb, s)
    mb.part('boots')
    for s in ('l', 'r'):
        build_shoe2(mb, s, 'leather')
        build_sole(mb, s, 'rubber')
    mb.part('helmet')
    build_m1_helmet2(mb)

    mb.part('webbing')
    # M1923 cartridge belt: band, ten pockets with lift-the-dot snaps, buckle
    sag = sag_front(0.014)
    surf_band(mb, sec, 0.962, 1.038, -0.004, 0.011, 36, 'webbing', wh, zfn=sag)
    for z in (0.968, 1.032):
        surf_band(mb, sec, z - 0.002, z + 0.002, 0.010, 0.0125, 36, 'webbing', wh, zfn=sag)
    c, R = oriented_box(mb, sec, 0.0, 1.0 + sag(0.0), (0.058, 0.008, 0.056), 0.011, 'webbing', wh, bevel=0.003)
    mb.box(c + (-R.col[1]) * 0.0055, (0.044, 0.003, 0.040), 'gun_metal_worn', wh, rot=R, bevel=0.0012)
    for sd in (1, -1):
        for k in range(5):
            th = sd * rad(23 + 15.2 * k)
            w = rad(6.4)
            surf_patch2(mb, sec, th - w, th + w, 1.03, 0.928, 0.040, 'webbing', wh, nth=2, nz=2, bulge=0.006,
                        zfn=sag, sag_out=0.006)
            surf_patch2(mb, sec, th - w * 1.06, th + w * 1.06, 1.044, 1.000, 0.046, 'webbing', wh, nth=2, nz=1,
                        zfn=sag)
            surf_stud(mb, sec, th, 1.008 + sag(th), 0.048, 0.0048, 'gun_metal_worn', wh, h=0.0025)
    # suspenders with their buckles
    for sd in (1, -1):
        path = [(30, 1.04), (29, 1.15), (30, 1.28), (40, 1.38), (60, 1.44), (90, 1.462), (120, 1.44),
                (140, 1.38), (150, 1.28), (155, 1.15), (158, 1.04)]
        surf_strip(mb, sec, [(sd * rad(a), z) for a, z in path], 0.035, 0.0035, 'webbing', wt)
        p = sec.surf(sd * rad(29.5), 1.20, 0.006)
        n = sec.normal(sd * rad(29.5), 1.20)
        frame_buckle(mb, p, axes_matrix(V((0, 0, 1)).cross(n).normalized(), -n, V((0, 0, 1))).to_3x3(), 0.040, 0.024,
                     0.0028, 'gun_metal_worn', wt)
    # haversack with flap, straps and buckles; e-tool carrier; bayonet in scabbard
    c, R = oriented_box(mb, sec, math.pi, 1.27, (0.27, 0.095, 0.30), 0.005, 'cloth_od_dark', wc, bevel=0.025, tilt=-4)
    out = -R.col[1]
    mb.box(c + out * 0.050 + R.col[2] * 0.090, (0.275, 0.014, 0.13), 'cloth_od_dark', wc, rot=R, bevel=0.006)
    for sx in (-0.075, 0.075):
        mb.box(c + out * 0.058 + R.col[0] * sx, (0.026, 0.006, 0.30), 'webbing', wc, rot=R, bevel=0.001)
        frame_buckle(mb, c + out * 0.062 + R.col[0] * sx + R.col[2] * 0.02, R, 0.032, 0.022, 0.003,
                     'gun_metal_worn', wc)
    for sz in (-0.08, 0.06):
        mb.box(c + R.col[2] * sz, (0.290, 0.105, 0.022), 'webbing', wc, rot=R, bevel=0.002)
    ec = c + out * 0.074 + R.col[2] * -0.035
    mb.box(ec, (0.165, 0.034, 0.215), 'cloth_od_dark', wc, rot=R, bevel=0.010)
    mb.box(ec + out * 0.018 + R.col[2] * 0.075, (0.168, 0.008, 0.07), 'cloth_od_dark', wc, rot=R, bevel=0.003)
    stud(mb, ec + out * 0.023 + R.col[2] * 0.050, out, 0.005, 'gun_metal_worn', wc)
    lathe_axis(mb, ec + R.col[2] * -0.10, ec + R.col[2] * -0.32, [(0, 0.017), (0.9, 0.016), (1.0, 0.012)], 8,
               'wood', wc)
    bs = c + R.col[0] * 0.150 + out * 0.01
    lathe_axis(mb, bs + R.col[2] * 0.06, bs + R.col[2] * -0.30, [(0, 0.016), (0.9, 0.012), (1.0, 0.007)], 8,
               'metal_olive', wc)
    lathe_axis(mb, bs + R.col[2] * 0.06, bs + R.col[2] * 0.17, [(0, 0.015), (0.8, 0.016), (1.0, 0.013)], 8,
               'rubber', wc)
    mb.box(bs + R.col[2] * 0.065, (0.07, 0.014, 0.010), 'gun_metal_worn', wc, rot=R, bevel=0.002)
    # canteen in its cover on the right hip, cup handle and cap
    c2, R2 = oriented_box(mb, sec, rad(-140), 0.912, (0.150, 0.075, 0.185), 0.012, 'cloth_od_dark', wh,
                          bevel=0.030, tilt=-6)
    o2 = -R2.col[1]
    for sx in (-0.036, 0.036):
        mb.box(c2 + o2 * 0.039 + R2.col[0] * sx + R2.col[2] * 0.070, (0.068, 0.010, 0.055), 'cloth_od_dark', wh,
               rot=R2, bevel=0.004)
        stud(mb, c2 + o2 * 0.045 + R2.col[0] * sx + R2.col[2] * 0.050, o2, 0.0045, 'gun_metal_worn', wh)
    lathe_axis(mb, c2 + R2.col[2] * 0.09, c2 + R2.col[2] * 0.112, [(0, 0.017), (1.0, 0.016)], 10, 'metal_olive', wh)
    mb.box(c2 - o2 * 0.03 + R2.col[2] * 0.105, (0.05, 0.01, 0.02), 'gun_metal_worn', wh, rot=R2)
    # first aid pouch
    c3, R3 = oriented_box(mb, sec, rad(-9.5), 0.94 + sag(rad(-9.5)), (0.072, 0.034, 0.085), 0.012, 'webbing', wh,
                          bevel=0.008, tilt=-5)
    mb.box(c3 + (-R3.col[1]) * 0.018 + R3.col[2] * 0.028, (0.075, 0.006, 0.035), 'webbing', wh, rot=R3, bevel=0.002)
    stud(mb, c3 + (-R3.col[1]) * 0.021 + R3.col[2] * 0.015, -R3.col[1], 0.0045, 'gun_metal_worn', wh)

    obj = mb.build('allied', rig)
    return obj, mb.parts


def build_axis2(rig=None):
    """German Heer rifleman 1944 (v2, v4 anatomy)."""
    mb = MeshBuilder()
    mb.sharp = 60
    sec = Section(TORSO_JACKET4)
    wt = w_torso(skirt=0.5)
    wh = w_rigid('hips')
    build_head_common(mb)
    mb.part('sleeves')
    build_sleeves(mb, 'cloth_feldgrau', 5)
    for side in ('l', 'r'):                    # cuff vent button
        pts = arm_points(side)
        c, t = chain_eval(pts, 0.512)
        n, b = frame_from(t, FWD)
        out = (b if side == 'l' else -b)
        out = (n * 0.4 + out * 0.9).normalized()
        stud(mb, c + out * 0.043, out, 0.0045, 'helmet_gray', w_arm(side), h=0.0022)

    mb.part('tunic')
    jacket_shell(mb, sec, 'cloth_feldgrau', 1.052, 9, wt)
    surf_strip(mb, sec, [(0.0, z) for z in (0.80, 0.92, 1.04, 1.16, 1.28, 1.38, 1.46)], 0.030, 0.0045,
               'cloth_feldgrau', wt)
    for z in (1.415, 1.335, 1.255, 1.175, 1.098, 0.93):
        surf_stud(mb, sec, 0.0, z, 0.0055, 0.0072, 'helmet_gray', wt, h=0.0035)
    for sd in (1, -1):
        flap_pocket(mb, sec, sd * rad(10), sd * rad(38), 1.215, 1.330, 'cloth_feldgrau', wt)
        flap_pocket(mb, sec, sd * rad(13), sd * rad(45), 0.835, 0.975, 'cloth_feldgrau', wt, flap_h=0.040)
        surf_strip(mb, sec, [(sd * rad(90), z) for z in (1.478, 1.466, 1.452, 1.437, 1.420, 1.408)],
                   0.044, 0.0055, 'cloth_feldgrau_dark', wt)
        surf_stud(mb, sec, sd * rad(90), 1.469, 0.0075, 0.0058, 'helmet_gray', wt)
        # belt hooks support (small tabs at the sides)
        surf_patch2(mb, sec, sd * rad(78) - rad(2), sd * rad(78) + rad(2), 1.045, 1.065, 0.004, 'cloth_feldgrau',
                    wt, nth=1, nz=1)
    mb.part('collar')
    coll = Section([(1.44, 0.069, 0.064, 0.066, 0.032, 2.2), (1.53, 0.067, 0.066, 0.064, 0.024, 2.2)])
    cdrop = lambda th: -0.024 * (0.5 + 0.5 * math.cos(th)) ** 1.6       # the stand collar dips at the front
    surf_band(mb, coll, 1.452, 1.522, -0.002, 0.010, 32, 'cloth_feldgrau_dark', w_neck, zfn=cdrop)
    surf_band(mb, coll, 1.508, 1.526, 0.010, 0.014, 32, 'cloth_feldgrau_dark', w_neck, zfn=cdrop)
    for sd in (1, -1):                          # Litzen (collar patches): two bars each
        for dz in (0.006, -0.006):
            th0, th1 = sd * rad(24), sd * rad(52)
            if sd < 0:
                th0, th1 = th1, th0
            surf_patch2(mb, coll, th0, th1, 1.494 + dz + 0.0035, 1.494 + dz - 0.0035, 0.0125, 'canvas_gray', w_neck,
                        nth=3, nz=1, zfn=cdrop)

    mb.part('trousers')
    build_pelvis(mb, 'cloth_feldgrau_dark')
    LEG = [(0.00, 0.093, 0.093), (0.14, 0.092, 0.089), (0.26, 0.083, 0.079), (0.37, 0.069, 0.065),
           (0.42, 0.065, 0.061, 0.004), (0.46, 0.067, 0.065), (0.49, 0.073, 0.071, -0.004),
           (0.512, 0.072, 0.070, -0.004), (0.53, 0.058, 0.056), (0.55, 0.051, 0.049)]
    build_trousers(mb, 'cloth_feldgrau_dark', LEG, 0.55, (0.455, 0.522), 43)
    mb.part('boots')
    for s in ('l', 'r'):
        jackboot(mb, s)
        build_shoe2(mb, s, 'leather_black', top_cut=0.10, stations=[SHOE2[i] for i in (0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)])
        build_sole(mb, s, 'leather_black', nails=True)
    mb.part('helmet')
    build_stahlhelm2(mb)

    mb.part('kit')
    sag = sag_front(0.010)
    surf_band(mb, sec, 1.002, 1.052, -0.004, 0.009, 36, 'leather_black', wh, zfn=sag)
    c, R = oriented_box(mb, sec, 0.0, 1.027 + sag(0.0), (0.068, 0.006, 0.052), 0.009, 'helmet_gray', wh, bevel=0.003,
                        segs=2)
    o = -R.col[1]
    lathe_axis(mb, c + o * 0.002, c + o * 0.0055, [(0, 0.017), (0.7, 0.016), (1.0, 0.013)], 16, 'helmet_gray', wh)
    # two three-cell rifle pouches: cells, a flap each with its strap and stud
    for sd in (1, -1):
        for k in range(3):
            a = 14 + 11.6 * k
            t0, t1 = sd * rad(a), sd * rad(a + 10.6)
            if sd < 0:
                t0, t1 = t1, t0
            surf_patch2(mb, sec, t0, t1, 1.058, 0.962, 0.040, 'leather_black', wh, nth=2, nz=2, bulge=0.004,
                        zfn=sag, sag_out=0.007)
            surf_patch2(mb, sec, t0 - rad(0.5), t1 + rad(0.5), 1.074, 1.030, 0.046, 'leather_black', wh, nth=2, nz=1,
                        zfn=sag)
            tm = (t0 + t1) / 2
            surf_strip(mb, sec, [(tm, z + sag(tm)) for z in (1.044, 1.000, 0.968)], 0.012, 0.0465 + 0.004,
                       'leather_black', wh, base=0.0)
            surf_stud(mb, sec, tm, 0.972 + sag(tm), 0.054, 0.0040, 'helmet_gray', wh, h=0.002)
    # Y-straps with D-rings
    for sd in (1, -1):
        path = [(33, 1.06), (32, 1.18), (34, 1.30), (46, 1.39), (66, 1.445), (90, 1.462), (115, 1.44),
                (140, 1.37), (162, 1.29), (178, 1.23)]
        surf_strip(mb, sec, [(sd * rad(a), z) for a, z in path], 0.032, 0.0040, 'leather_black', wt)
        p = sec.surf(sd * rad(34.5), 1.35, 0.008)
        n = sec.normal(sd * rad(34.5), 1.35)
        wtorus_w(mb, p, n.cross(V((0, 0, 1))), 0.012, 0.0022, 'gun_metal_worn', wt)
    surf_strip(mb, sec, [(math.pi, z) for z in (1.245, 1.15, 1.06)], 0.034, 0.0040, 'leather_black', wt)
    p = sec.surf(math.pi, 1.235, 0.010)
    wtorus_w(mb, p, V((1, 0, 0)), 0.016, 0.0025, 'gun_metal_worn', wt)
    # bread bag with flap straps, canteen with cup
    c, R = oriented_box(mb, sec, rad(-128), 0.90, (0.25, 0.072, 0.19), 0.012, 'canvas', wh, bevel=0.022)
    out = -R.col[1]
    mb.box(c + out * 0.038 + R.col[2] * 0.05, (0.255, 0.012, 0.105), 'canvas', wh, rot=R, bevel=0.005)
    for sx in (-0.07, 0.07):
        mb.box(c + out * 0.045 + R.col[0] * sx + R.col[2] * 0.03, (0.018, 0.004, 0.10), 'leather_black', wh, rot=R)
        stud(mb, c + out * 0.047 + R.col[0] * sx + R.col[2] * -0.018, out, 0.004, 'helmet_gray', wh)
    cc = c + out * 0.082 + R.col[0] * 0.05 + R.col[2] * -0.012
    mb.box(cc, (0.100, 0.060, 0.165), 'cloth_feldgrau_dark', wh, rot=R, bevel=0.024)
    lathe_axis(mb, cc + R.col[2] * 0.075, cc + R.col[2] * 0.118, [(0, 0.034), (0.9, 0.034), (1.0, 0.031)], 12,
               'leather_black', wh)
    mb.box(cc + out * 0.032, (0.016, 0.004, 0.17), 'leather_black', wh, rot=R)
    # fluted gas-mask canister across the lower back, with its lid and strap
    gc = sec.point(rad(188), 0.955) + sec.normal(rad(188), 0.955) * 0.074
    axis = V((-math.cos(rad(32)), 0.0, math.sin(rad(32))))
    a, b = gc - axis * 0.13, gc + axis * 0.13
    prof = [(0.0, 0.046), (0.02, 0.055)]
    for k in range(6):
        t = 0.09 + 0.135 * k
        prof += [(t, 0.051), (t + 0.035, 0.056), (t + 0.10, 0.056)]
    prof += [(0.94, 0.056), (0.95, 0.058), (1.0, 0.058)]
    lathe_axis(mb, a, b, prof, 16, 'helmet_gray', wh, None, ref=V((0, 1, 0)))
    lathe_axis(mb, b, b + axis * 0.012, [(0, 0.058), (0.6, 0.057), (1.0, 0.050)], 16, 'helmet_gray', wh,
               ref=V((0, 1, 0)))
    for e in (a + axis * 0.03, b - axis * 0.02):
        wtorus_w(mb, e + V((0, 0.0, 0.056)), axis, 0.008, 0.0016, 'gun_metal_worn', wh)
    # entrenching tool in its carrier, bayonet in the frog
    c3, R3 = oriented_box(mb, sec, rad(118), 0.915, (0.16, 0.035, 0.21), 0.012, 'leather_black', wh,
                          bevel=0.010, tilt=8)
    o3 = -R3.col[1]
    for sz in (0.04, -0.04):
        mb.box(c3 + o3 * 0.019 + R3.col[2] * sz, (0.165, 0.004, 0.018), 'leather_black', wh, rot=R3)
    hd = c3 + R3.col[2] * -0.10
    lathe_axis(mb, hd, hd + R3.col[2] * -0.20 + V((0, -0.03, 0)), [(0, 0.017), (0.9, 0.016), (1.0, 0.013)], 8,
               'wood', wh)
    bc = sec.point(rad(103), 0.93) + sec.normal(rad(103), 0.93) * 0.055
    lathe_axis(mb, bc + V((0, 0.02, 0.06)), bc + V((0, -0.065, -0.25)), [(0, 0.014), (0.9, 0.012), (1.0, 0.008)],
               8, 'helmet_gray', wh)
    lathe_axis(mb, bc + V((0, 0.02, 0.06)), bc + V((0, 0.045, 0.165)), [(0, 0.013), (0.8, 0.013), (1.0, 0.010)],
               8, 'walnut', wh)
    mb.box(bc + V((0, 0.012, 0.03)), (0.034, 0.03, 0.05), 'leather_black', wh, bevel=0.003)

    obj = mb.build('axis', rig)
    return obj, mb.parts
