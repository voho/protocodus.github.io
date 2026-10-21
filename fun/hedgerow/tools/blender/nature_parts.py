"""Hedgerow — nature set parts (used by build_nature.py only).

v1 helpers: a small mesh builder (`Mesh`: vertices with a per-vertex
occlusion value and optional normal hint, faces with a material slot and
optional per-corner UVs; one Blender object per node), swept tubes with root
flare and broken ends, loft strips, leaf lumps, crown bodies, faceted rocks.

v2 additions:
* alpha-card foliage: atlas tiles are modelled in 2D-plus-relief (leaves
  with lobes, serrations, veins and folds; needles; grass blades; fern
  pinnae; litter) and rendered orthographically to RGBA colour + tangent
  normal (`Atlas`, `make_atlases`, the `art_*` builders); `card()` places a
  textured, bendable card on a tile with explicit (crown) normals;
* runtime surface recipes for bake.py (`register_surfaces`: bark kinds,
  end grain, granite, grassy bank, hedge core, mushrooms);
* `sculpt()`: dense weathered rock surfaces from a faceted hull;
* `Impostors`: orthographic renders of finished trees into one atlas and
  three crossed planes per tree for the `_lod` nodes;
* preview helpers (card materials multiplied by the occlusion attribute and
  given some translucency, cameras placed explicitly).
"""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Quaternion, noise
import kit

TAU = 2 * math.pi
UP = Vector((0, 0, 1))


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def sstep(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def noise_off(seed):
    r = random.Random(seed * 7919 + 13)
    return Vector((r.uniform(-90, 90), r.uniform(-90, 90), r.uniform(-90, 90)))


def fbm(p, octaves=2, lac=2.07, gain=0.5):
    s, a, f = 0.0, 1.0, 1.0
    for _ in range(octaves):
        s += a * noise.noise(p * f)
        a *= gain
        f *= lac
    return s


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Z')


def polar(r, ang, z=0.0):
    return Vector((r * math.cos(ang), r * math.sin(ang), z))


# --------------------------------------------------------------------------
# Mesh builder

class Mesh:
    def __init__(self, mats):
        self.mats = list(mats)
        self.co = []
        self.ao = []
        self.nh = []             # per-vertex normal hint: (centre, radii, blend) or None
        self.faces = []          # (indices, material slot, uv per corner or None, smooth)
        # part tags (TAG_*) per face and a record of every card, for the _mid models
        self.tag = 0
        self.ftag = []
        self.cards = []
        self.card_group = None   # cards sharing a group are kept or dropped together
        self.card_keep = False   # cards that every _mid keeps as they are (ivy)
        self.card_pref = False   # in a group with a preferred card the _mid keeps just that one
        self.tubes = []          # every swept tube (path, radii, tag) for rebuilt _mid branches

    def v(self, co, ao=1.0, nh=None):
        self.co.append(Vector(co))
        self.ao.append(float(ao))
        self.nh.append(nh)
        return len(self.co) - 1

    def f(self, idx, mat=0, uv=None, smooth=True):
        idx = tuple(idx)
        if len(set(idx)) < len(idx):
            return
        self.faces.append((idx, mat, uv, smooth))
        self.ftag.append(self.tag)

    @property
    def tris(self):
        return sum(len(f[0]) - 2 for f in self.faces)

    def mark(self):
        return len(self.co)

    def xform(self, mat4, start=0):
        for i in range(start, len(self.co)):
            self.co[i] = mat4 @ self.co[i]

    def clamp_z(self, z=0.0):
        for c in self.co:
            if c.z < z:
                c.z = z

    def bounds(self):
        xs = [c.x for c in self.co]
        ys = [c.y for c in self.co]
        zs = [c.z for c in self.co]
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

    def build(self, name, color_fn=None, uv_scale=1.0, uv_seed=None, lo=0.05, tags=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(c) for c in self.co], [], [f[0] for f in self.faces])
        me.update()
        if tags:                              # part tags travel through the bake (removed before export)
            at = me.attributes.new('nat_tag', 'INT', 'FACE')
            at.data.foreach_set('value', self.ftag)
        obj = kit.link(bpy.data.objects.new(name, me))
        for key in self.mats:
            if isinstance(key, bpy.types.Material):
                me.materials.append(key)
            elif key in kit.PALETTE:
                me.materials.append(kit.material(key))
            else:
                me.materials.append(bpy.data.materials[key])
        me.polygons.foreach_set('material_index', [f[1] for f in self.faces])
        me.polygons.foreach_set('use_smooth', [bool(f[3]) for f in self.faces])
        # UVs: explicit per corner, else box projection in metres
        uvl = me.uv_layers.new(name='UVMap')
        off = (0.0, 0.0)
        if uv_seed is not None:
            rnd = random.Random(uv_seed)
            off = (rnd.random() * 4, rnd.random() * 4)
        attr = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        me.color_attributes.active_color = attr
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass
        for poly, (idx, mat, uv, _s) in zip(me.polygons, self.faces):
            n = poly.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for k, li in enumerate(poly.loop_indices):
                vi = me.loops[li].vertex_index
                co = self.co[vi]
                if uv is not None:
                    u, w = uv[k]
                else:
                    if az >= ax and az >= ay:
                        u, w = co.x, co.y * (1 if n.z >= 0 else -1)
                    elif ax >= ay:
                        u, w = co.y * (1 if n.x >= 0 else -1), co.z
                    else:
                        u, w = -co.x * (1 if n.y >= 0 else -1), co.z
                    u, w = u * uv_scale + off[0], w * uv_scale + off[1]
                uvl.data[li].uv = (u, w)
                c = self.ao[vi]
                if color_fn:
                    c *= color_fn(co, n, mat)
                c = clamp(c, lo, 1.0)
                attr.data[li].color = (c, c, c, 1.0)
        if any(h is not None for h in self.nh):
            # foliage: blend the shading normal towards the normal of the mass /
            # crown ellipsoid the vertex belongs to, so clumps light as one canopy
            # instead of a pile of balls (custom split normals, exported to glTF)
            out = []
            cn = me.corner_normals
            for poly in me.polygons:
                for li in poly.loop_indices:
                    vi = me.loops[li].vertex_index
                    own = Vector(cn[li].vector) if poly.use_smooth else Vector(poly.normal)
                    h = self.nh[vi]
                    if h is None:
                        out.append(tuple(own))
                        continue
                    if isinstance(h, Vector):          # explicit normal (cards)
                        out.append(tuple(h.normalized()))
                        continue
                    c, rad, k = h[:3]
                    jit = h[3] if len(h) > 3 else 0.0
                    d = self.co[vi] - c
                    d = Vector((d.x / rad[0] ** 2, d.y / rad[1] ** 2, d.z / rad[2] ** 2))
                    nn = own * (1 - k) + (d.normalized() * k if d.length > 1e-6 else own * k)
                    if jit:
                        # per-vertex scatter: leaf clusters catching the light unevenly
                        r = random.Random(vi * 2654435761 % 4294967296)
                        nn = nn.normalized() + Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1))) * jit
                    out.append(tuple(nn.normalized()))
            me.normals_split_custom_set(out)
        me.update()
        return obj


# --------------------------------------------------------------------------
# Tubes (trunks, branches, logs, roots)

def frames(pts):
    """Parallel-transport frames (t, n, b) along a polyline."""
    out = []
    prev = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev is None:
            ref = UP if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev - t * prev.dot(t)).normalized()
        b = t.cross(n)
        prev = n
        out.append((t, n, b))
    return out


def _cap_uv(m, ids, centre, t):
    """UVs in metres about the pith for end-grain faces (growth rings)."""
    n = P_basis(t)
    b = t.cross(n)
    return tuple(((m.co[i] - centre).dot(n), (m.co[i] - centre).dot(b)) for i in ids)


def P_basis(t):
    ref = UP if abs(t.z) < 0.9 else Vector((1, 0, 0))
    return t.cross(ref).normalized()


def _jag(m, ring, centre, t, r, mat, rnd, ao, splinter=True, spl=1.0):
    """Close a ring with a broken, splintered end pointing along t."""
    k = len(ring)
    centre = Vector(centre)
    if splinter:
        inner = []
        for i in range(k):
            p = centre + (m.co[ring[i]] - centre) * rnd.uniform(0.3, 0.6) \
                + t * r * rnd.uniform(-0.2, 1.3) * spl
            inner.append(m.v(p, ao * 0.85))
        for i in range(k):
            j = (i + 1) % k
            ids = (ring[i], ring[j], inner[j], inner[i])
            m.f(ids, mat, _cap_uv(m, ids, centre, t), smooth=False)
        ring = inner
    c = m.v(centre + t * r * rnd.uniform(-0.1, 0.5), ao * 0.7)
    for i in range(k):
        j = (i + 1) % k
        ids = (ring[i], ring[j], c)
        m.f(ids, mat, _cap_uv(m, ids, centre, t), smooth=False)


def tube(m, pts, radii, sides=6, mat=0, ao=1.0, rfn=None, phase=0.0, start=None, end=None,
         cap_mat=None, rnd=None, uv_scale=1.0, smooth=True, splinter=True, jag_amp=0.35, spl=1.0):
    """Sweep a ring along `pts`. A radius <= 0 makes that end a point.
    ao: float, list per ring, or fn(s in 0..1, point) -> float.
    rfn(k, angle) -> radial multiplier (root flare lobes, knots).
    start/end: None (open), 'flat', 'jag' (broken, splintered)."""
    pts = [Vector(p) for p in pts]
    if not hasattr(radii, '__len__'):
        radii = [radii] * len(pts)
    if hasattr(m, 'tubes'):
        m.tubes.append(dict(pts=[p.copy() for p in pts], radii=list(radii), tag=m.tag, sides=sides))
    rnd = rnd or random.Random(len(pts) * 31 + sides)
    cap_mat = mat if cap_mat is None else cap_mat
    fr = frames(pts)
    rings, vs = [], []
    acc = 0.0
    last = len(pts) - 1
    for k, p in enumerate(pts):
        if k:
            acc += (p - pts[k - 1]).length
        vs.append(acc)
        t, n, b = fr[k]
        r = radii[k]
        if callable(ao):
            a_k = ao(k / max(last, 1), p)
        elif hasattr(ao, '__len__'):
            a_k = ao[k]
        else:
            a_k = ao
        if r <= 1e-5:
            rings.append(m.v(p, a_k))
            continue
        ring = []
        for i in range(sides):
            ang = phase + TAU * i / sides
            rr = r * (rfn(k, ang) if rfn else 1.0)
            off = (n * math.cos(ang) + b * math.sin(ang)) * rr
            if (k == last and end == 'jag') or (k == 0 and start == 'jag'):
                off += t * r * rnd.uniform(-jag_amp, jag_amp) * (1 if k else -1)
            ring.append(m.v(p + off, a_k))
        rings.append(ring)
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        circ = TAU * max((radii[k] + radii[k + 1]) / 2, 0.02) * uv_scale
        v0, v1 = vs[k] * uv_scale, vs[k + 1] * uv_scale
        for i in range(sides):
            j = (i + 1) % sides
            u0, u1 = i / sides * circ, (i + 1) / sides * circ
            if isinstance(B, int) and isinstance(A, int):
                continue
            if isinstance(B, int):
                m.f((A[i], A[j], B), mat, ((u0, v0), (u1, v0), ((u0 + u1) / 2, v1)), smooth)
            elif isinstance(A, int):
                m.f((A, B[j], B[i]), mat, (((u0 + u1) / 2, v0), (u1, v1), (u0, v1)), smooth)
            else:
                m.f((A[i], A[j], B[j], B[i]), mat, ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), smooth)
    a0 = m.ao[rings[0]] if isinstance(rings[0], int) else m.ao[rings[0][0]]
    a1 = m.ao[rings[-1]] if isinstance(rings[-1], int) else m.ao[rings[-1][0]]
    if not isinstance(rings[0], int):
        if start == 'flat':
            ids = list(reversed(rings[0]))
            m.f(ids, cap_mat, _cap_uv(m, ids, pts[0], -fr[0][0]), smooth=False)
        elif start == 'jag':
            _jag(m, list(reversed(rings[0])), pts[0], -fr[0][0], radii[0], cap_mat, rnd, a0, splinter, spl)
    if not isinstance(rings[-1], int):
        if end == 'flat':
            ids = rings[-1]
            m.f(ids, cap_mat, _cap_uv(m, ids, pts[-1], fr[-1][0]), smooth=False)
        elif end == 'jag':
            _jag(m, rings[-1], pts[-1], fr[-1][0], radii[-1], cap_mat, rnd, a1, splinter, spl)
    return rings


def curve(p0, p1, bend=Vector((0, 0, 0)), n=3, wobble=0.0, rnd=None):
    """n+1 points from p0 to p1 bowed by `bend` at the middle, optional wobble."""
    p0, p1 = Vector(p0), Vector(p1)
    out = []
    for i in range(n + 1):
        s = i / n
        p = p0.lerp(p1, s) + Vector(bend) * (4 * s * (1 - s))
        if wobble and 0 < i < n and rnd:
            p += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * wobble
        out.append(p)
    return out


def flare_fn(lobes, amount, phase=0.0, rings=1, sharp=2.0):
    """Root-flare multiplier: lobed buttresses on the first `rings` rings."""
    def fn(k, ang):
        if k >= rings:
            return 1.0
        w = (1.0 - k / rings)
        lobe = max(0.0, math.cos(lobes * (ang - phase))) ** sharp
        return 1.0 + amount * w * (0.35 + 0.65 * lobe)
    return fn


# --------------------------------------------------------------------------
# Thin spikes, blades and lofted strips

def loft(m, rings, mat=0, smooth=True, cap0=False):
    """Faces between consecutive rings of vertex indices (a ring may be a single
    index = a point). Rings must run counter-clockwise seen from the direction of
    travel; this is checked on the first two rings and fixed if needed."""
    for k in range(len(rings) - 1):
        r0, nxt = rings[k], rings[k + 1]
        if isinstance(r0, int) or len(r0) < 3:
            continue
        c0 = sum((m.co[i] for i in r0), Vector()) / len(r0)
        c1 = m.co[nxt] if isinstance(nxt, int) else sum((m.co[i] for i in nxt), Vector()) / len(nxt)
        nrm = Vector()
        for i in range(len(r0)):               # Newell normal of the ring
            a, b = m.co[r0[i]], m.co[r0[(i + 1) % len(r0)]]
            nrm += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if nrm.dot(c1 - c0) < 0:
            rings = [r if isinstance(r, int) else list(reversed(r)) for r in rings]
        break
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        if isinstance(A, int):
            if not isinstance(B, int):
                n = len(B)
                for i in range(n):
                    m.f((A, B[(i + 1) % n], B[i]), mat, smooth=smooth)
            continue
        n = len(A)
        for i in range(n):
            j = (i + 1) % n
            if isinstance(B, int):
                m.f((A[i], A[j], B), mat, smooth=smooth)
            else:
                m.f((A[i], A[j], B[j], B[i]), mat, smooth=smooth)
    if cap0 and not isinstance(rings[0], int):
        m.f(list(reversed(rings[0])), mat, smooth=False)
    return rings


def spike(m, base, tip, width, depth=None, mat=0, ao0=0.5, ao1=1.0, mid=None, mid_w=None,
          side=None, smooth=True):
    """A thin three-sided spike (blade, twig, stub): 3 triangles, visible from
    every side; with `mid` a two-segment bent spike (9 triangles)."""
    base, tip = Vector(base), Vector(tip)
    depth = width * 0.35 if depth is None else depth
    axis = ((mid if mid is not None else tip) - base).normalized()
    if side is None:
        side = axis.cross(UP)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
    side = (Vector(side) - axis * Vector(side).dot(axis)).normalized()
    front = side.cross(axis).normalized()

    def ring(c, w, d, a):
        return [m.v(c - side * w / 2 - front * d / 3, a),
                m.v(c + side * w / 2 - front * d / 3, a),
                m.v(c + front * d * 2 / 3, a)]
    rings = [ring(base, width, depth, ao0)]
    if mid is not None:
        mw = mid_w if mid_w is not None else width * 0.7
        rings.append(ring(Vector(mid), mw, depth * mw / width, lerp(ao0, ao1, 0.55)))
    rings.append(m.v(tip, ao1))
    loft(m, rings, mat, smooth)


# --------------------------------------------------------------------------
# Conifer needle tiers ("skirts") and pine pads

def skirt(m, centre, R, drop, tips, rnd, mat=1, rise=None, thick=None, notch=(0.45, 0.62),
          tilt=5.0, ao=(0.4, 0.78, 0.95, 0.62, 0.38, 0.3), long_chance=0.18, lod=False,
          droop_pow=1.7, length=(0.78, 1.1), blunt=0.13, nh=None):
    """A drooping ring of branches around `centre` (the trunk point): a ragged
    star outline (blunt tips and deep notches) with an arched top and a
    concave, hanging underside. Full: 10*tips triangles (blunt) or 8*tips;
    lod: 4*tips (single-vertex tips)."""
    centre = Vector(centre)
    rise = 0.08 * R if rise is None else rise
    thick = 0.7 * drop + 0.06 * R if thick is None else thick
    phase = rnd.uniform(0, TAU)
    T = tips
    angs, Ls, tipz = [], [], []
    for i in range(T):
        angs.append(phase + TAU * (i + rnd.uniform(-0.3, 0.3)) / T)
        L = R * rnd.uniform(*length) * (1.16 if rnd.random() < long_chance else 1.0)
        Ls.append(L)
        tipz.append(-drop * (L / R) * rnd.uniform(0.88, 1.15))

    def top_z(r, L, tz):
        return rise - (rise - tz) * (r / L) ** droop_pow

    ax = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0))
    tilt_q = Quaternion(ax.normalized() if ax.length > 1e-3 else Vector((1, 0, 0)),
                        math.radians(rnd.uniform(-tilt, tilt)))

    def P(local, a):
        return m.v(centre + tilt_q @ local, a, nh)

    a_apex, a_mid, a_tip, a_notch, a_under, a_uc = ao
    use_pair = blunt > 0 and not lod
    apex = P(Vector((0, 0, rise)), a_apex)
    tipL, tipR, notch_i, mid_i, under_i = [], [], [], [], []
    for i in range(T):
        a, L, tz = angs[i], Ls[i], tipz[i]
        if use_pair:
            w = blunt * TAU / T
            tipL.append(P(polar(L * 0.97, a - w, tz + rnd.uniform(-0.05, 0.05) * drop), a_tip))
            tipR.append(P(polar(L * 0.97, a + w, tz + rnd.uniform(-0.05, 0.05) * drop), a_tip))
        else:
            t = P(polar(L, a, tz), a_tip)
            tipL.append(t)
            tipR.append(t)
        j = (i + 1) % T
        a2 = angs[j] + (TAU if j == 0 else 0.0)
        am = (a + a2) / 2 + rnd.uniform(-0.08, 0.08) * (a2 - a)
        Ln = (L + Ls[j]) / 2 * rnd.uniform(*notch)
        nz = top_z(Ln, (L + Ls[j]) / 2, (tz + tipz[j]) / 2) - 0.1 * drop
        notch_i.append(P(polar(Ln, am, nz), a_notch))
        if not lod:
            rm = 0.4 * L
            mid_i.append(P(polar(rm, a + rnd.uniform(-0.05, 0.05), top_z(rm, L, tz) + 0.03 * R), a_mid))
            ru = 0.55 * L
            under_i.append(P(polar(ru, a, top_z(ru, L, tz) - thick * rnd.uniform(0.85, 1.1)), a_under))
    uc = P(Vector((0, 0, -(0.5 * drop + 0.05 * R))), a_uc)
    for i in range(T):
        j = (i + 1) % T
        if lod:
            m.f((apex, tipL[i], notch_i[i]), mat)
            m.f((apex, notch_i[i], tipL[j]), mat)
            m.f((uc, notch_i[i], tipL[i]), mat)
            m.f((uc, tipL[j], notch_i[i]), mat)
            continue
        m.f((apex, mid_i[i], mid_i[j]), mat)
        if use_pair:
            m.f((mid_i[i], tipL[i], tipR[i]), mat)
        m.f((mid_i[i], tipR[i], notch_i[i]), mat)
        m.f((mid_i[i], notch_i[i], mid_i[j]), mat)
        m.f((mid_i[j], notch_i[i], tipL[j]), mat)
        m.f((uc, under_i[j], under_i[i]), mat)
        if use_pair:
            m.f((under_i[i], tipR[i], tipL[i]), mat)
        m.f((under_i[i], notch_i[i], tipR[i]), mat)
        m.f((under_i[i], under_i[j], notch_i[i]), mat)
        m.f((under_i[j], tipL[j], notch_i[i]), mat)


# --------------------------------------------------------------------------
# Leaf lumps

_ICO = {}


def uvs_mesh(seg, rings):
    """Unit UV sphere (verts, faces) with poles, cached under ('uv', seg, rings)."""
    key = ('uv', seg, rings)
    if key not in _ICO:
        verts = [Vector((0, 0, 1))]
        for r in range(1, rings):
            th = math.pi * r / rings
            for k in range(seg):
                ph = TAU * (k + 0.5 * (r % 2)) / seg
                verts.append(Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))))
        verts.append(Vector((0, 0, -1)))
        faces = []
        S = lambda r, k: 1 + (r - 1) * seg + (k % seg)
        for k in range(seg):
            faces.append([0, S(1, k), S(1, k + 1)])
        for r in range(1, rings - 1):
            for k in range(seg):
                if r % 2:
                    faces.append([S(r, k), S(r + 1, k), S(r + 1, k + 1)])
                    faces.append([S(r, k), S(r + 1, k + 1), S(r, k + 1)])
                else:
                    faces.append([S(r, k), S(r + 1, k), S(r, k + 1)])
                    faces.append([S(r, k + 1), S(r + 1, k), S(r + 1, k + 1)])
        last = len(verts) - 1
        for k in range(seg):
            faces.append([last, S(rings - 1, k + 1), S(rings - 1, k)])
        _ICO[key] = (verts, faces)
    return _ICO[key]


def ico(subdiv):
    if isinstance(subdiv, tuple):
        return uvs_mesh(*subdiv)
    if subdiv not in _ICO:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv + 1, radius=1.0)   # Blender: 1 = icosahedron
        verts = [v.co.normalized() for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces]
        bm.free()
        _ICO[subdiv] = (verts, faces)
    return _ICO[subdiv]


def lump(m, centre, radii, subdiv=1, seed=0, bump=0.22, freq=1.5, mat=0, ao=1.0, cavity=0.55,
         under=0.45, flat_bottom=None, yaw=0.0, smooth=True, spikes=0.0, nh=None):
    """A clumpy, irregular leaf mass: an icosphere scaled to `radii`, pushed in
    and out by noise; occlusion darkens the dents and the underside.
    subdiv 1 = 80 tris, 0 = 20 tris. `spikes` adds per-vertex raggedness."""
    verts, faces = ico(subdiv)
    off = noise_off(seed)
    rnd = random.Random(seed)
    rz = rot_z(yaw)
    centre = Vector(centre)
    idx = []
    for d in verts:
        nz = fbm(d * freq + off, 2)
        s = 1.0 + bump * nz + (rnd.uniform(-spikes, spikes) if spikes else 0.0)
        p = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * s
        if flat_bottom is not None and p.z < -radii[2] * flat_bottom:
            p.z = -radii[2] * flat_bottom + (p.z + radii[2] * flat_bottom) * 0.3
        a = ao * lerp(1.0, 1.0 - cavity, clamp(-nz * 1.6))
        a *= lerp(1.0 - under, 1.0, sstep(-0.85, 0.55, d.z))
        idx.append(m.v(centre + rz @ p, a, nh))
    for f in faces:
        m.f([idx[i] for i in f], mat, smooth=smooth)
    return idx


# --------------------------------------------------------------------------
# Rocks

def rock_bm(size, seed, planes=6, npts=46, lumpy=0.07, cut_bottom=0.72, extra=(), plane_depth=(0.6, 0.86),
            plane_el=(-15, 75), box=1.0, dissolve=6.0):
    """Convex, faceted rock: points on an ellipsoid clipped by random planes
    (big flat joint faces), hull, near-coplanar faces merged. Returns a bmesh
    centred on the ellipsoid centre."""
    rnd = random.Random(seed)
    rx, ry, rz = size[0] / 2, size[1] / 2, size[2] / 2
    off = noise_off(seed)
    pts = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(npts):
        z = 1 - 2 * (i + 0.5) / npts
        r = math.sqrt(max(0.0, 1 - z * z))
        a = ga * i + rnd.uniform(-0.25, 0.25)
        d = Vector((r * math.cos(a), r * math.sin(a), z))
        s = 1 + lumpy * noise.noise(d * 1.3 + off)
        q = Vector([math.copysign(abs(c) ** box, c) for c in d])      # box < 1: rounded block
        pts.append(Vector((q.x * rx, q.y * ry, q.z * rz)) * s)
    cuts = []
    for k in range(planes):
        az = rnd.uniform(0, TAU)
        el = math.radians(rnd.uniform(*plane_el))
        n = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        sup = math.sqrt((rx * n.x) ** 2 + (ry * n.y) ** 2 + (rz * n.z) ** 2)
        cuts.append((n, sup * rnd.uniform(*plane_depth)))
    cuts.append((Vector((0, 0, -1)), rz * cut_bottom))
    cuts.extend(extra)
    for n, d in cuts:
        n = Vector(n).normalized()
        for p in pts:
            h = p.dot(n)
            if h > d:
                p -= n * (h - d)
    # deterministic de-duplication, then a tiny nudge into general position so
    # the hull is unique (points projected onto a clip plane are coplanar and
    # Blender's hull would triangulate them in a memory-order-dependent way)
    keep = []
    eps = 0.004 * max(size)
    for p in pts:
        if all((p - q).length > eps for q in keep):
            keep.append(p)
    bm = bmesh.new()
    for p in keep:
        bm.verts.new(p + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 2e-4 * max(size))
    res = bmesh.ops.convex_hull(bm, input=bm.verts)
    hull = {v for g in res['geom'] if isinstance(g, bmesh.types.BMFace) for v in g.verts}
    junk = [v for v in bm.verts if v not in hull]
    if junk:
        bmesh.ops.delete(bm, geom=junk, context='VERTS')
    bm = canonical(bm)
    if dissolve:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve), verts=bm.verts[:], edges=bm.edges[:])
        bm = canonical(bm)
    return bm


def canonical(bm):
    """Rebuild a bmesh with vertices sorted by position and faces sorted, so
    later operators see the same element order on every run."""
    verts = sorted(bm.verts, key=lambda v: (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)))
    vid = {v: i for i, v in enumerate(verts)}
    faces = []
    for f in bm.faces:
        ids = [vid[v] for v in f.verts]
        k = ids.index(min(ids))
        faces.append(ids[k:] + ids[:k])
    faces.sort()
    nb = bmesh.new()
    nv = [nb.verts.new(v.co.copy()) for v in verts]
    for ids in faces:
        nb.faces.new([nv[i] for i in ids])
    bm.free()
    nb.verts.index_update()
    nb.faces.index_update()
    nb.normal_update()
    return nb


def weather(bm, amount, seed, freq=1.2):
    """Coherent noise displacement: breaks perfectly flat facets a little."""
    off = noise_off(seed + 5)
    # (not noise.noise_vector: it is randomly seeded per Blender process)
    o2, o3 = Vector((31.7, -12.9, 7.3)), Vector((-5.1, 23.3, -17.9))
    for v in bm.verts:
        q = v.co * freq + off
        v.co += Vector((noise.noise(q), noise.noise(q + o2), noise.noise(q + o3))) * amount
    bm.normal_update()
    return bm


def chamfer(bm, width, angle=22):
    """Bevel the edges sharper than `angle`. Returns a NEW (canonical) bmesh."""
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and
             e.calc_face_angle(0.0) > math.radians(angle)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET', segments=1,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return canonical(bm)


def add_bm(m, bm, xform=None, mat_fn=None, ao_fn=None, smooth=False, triangulate=False):
    """Copy a bmesh into the Mesh. mat_fn(face_centre, normal) -> slot;
    ao_fn(co) -> occlusion."""
    if triangulate:
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.verts.index_update()
    xform = xform or Matrix.Identity(4)
    rot3 = xform.to_3x3()
    idx = {}
    for v in bm.verts:
        p = xform @ v.co
        idx[v.index] = m.v(p, ao_fn(p) if ao_fn else 1.0)
    for f in bm.faces:
        c = xform @ f.calc_center_median()
        nrm = (rot3 @ f.normal).normalized()
        slot = mat_fn(c, nrm) if mat_fn else 0
        m.f([idx[v.index] for v in f.verts], slot, smooth=smooth)


# --------------------------------------------------------------------------
# Preview helpers (only touch materials AFTER export)

def _sock(socks, ident):
    for s in socks:
        if s.identifier == ident:
            return s
    raise KeyError(ident)


def preview_materials(objects):
    """For previews only (call AFTER exporting): give each object copies of
    its materials that multiply the base colour by the "Color" attribute, as
    three.js does with vertexColors, so previews show the fake occlusion. The
    shared palette materials stay untouched (the preview floor uses one)."""
    cache = {}
    for obj in objects:
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or mat.get('_vc'):
                continue
            if mat.name not in cache:
                pv = mat.copy()
                pv.name = mat.name + '_pv'
                pv['_vc'] = 1
                nt = pv.node_tree
                bsdf = nt.nodes.get('Principled BSDF')
                base = tuple(bsdf.inputs['Base Color'].default_value)
                attr = nt.nodes.new('ShaderNodeAttribute')
                attr.attribute_name = 'Color'
                mul = nt.nodes.new('ShaderNodeMix')
                mul.data_type = 'RGBA'
                mul.blend_type = 'MULTIPLY'
                _sock(mul.inputs, 'Factor_Float').default_value = 1.0
                _sock(mul.inputs, 'A_Color').default_value = base
                nt.links.new(attr.outputs['Color'], _sock(mul.inputs, 'B_Color'))
                nt.links.new(_sock(mul.outputs, 'Result_Color'), bsdf.inputs['Base Color'])
                # leaves let light through: the game lights both card sides with the
                # crown normal; Cycles would leave back faces black without this
                out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
                tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
                nt.links.new(_sock(mul.outputs, 'Result_Color'), tr.inputs['Color'])
                mixs = nt.nodes.new('ShaderNodeMixShader')
                mixs.inputs[0].default_value = 0.4
                src_sh = out.inputs['Surface'].links[0].from_socket
                nt.links.new(src_sh, mixs.inputs[1])
                nt.links.new(tr.outputs[0], mixs.inputs[2])
                # keep the alpha cut: transparent where the texture is
                alpha_in = bsdf.inputs['Alpha'].links[0].from_socket if bsdf.inputs['Alpha'].links else None
                if alpha_in is not None:
                    tp = nt.nodes.new('ShaderNodeBsdfTransparent')
                    mx2 = nt.nodes.new('ShaderNodeMixShader')
                    nt.links.new(alpha_in, mx2.inputs[0])
                    nt.links.new(tp.outputs[0], mx2.inputs[1])
                    nt.links.new(mixs.outputs[0], mx2.inputs[2])
                    nt.links.new(mx2.outputs[0], out.inputs['Surface'])
                else:
                    nt.links.new(mixs.outputs[0], out.inputs['Surface'])
                cache[mat.name] = pv
            slot.material = cache[mat.name]


# --------------------------------------------------------------------------
# Hedge body

def hedge_body(m, L, Ht, W, seed, S=26, K=17, amp=(0.26, 0.1, 0.055), ext=0.34, zb=(0.25, 0.6), mat=0,
               smooth=False, nh=None, boxy=0.55, top_var=0.3):
    """A continuous, crumpled leaf body along X: a rounded-rectangle tube
    (bottom raised so the woody base shows) pushed in and out by noise
    stretched vertically (shrub-sized lobes) plus per-vertex crumple, ends
    tapered so neighbouring segments overlap. Occlusion from the dents."""
    rnd = random.Random(seed)
    off, off2 = noise_off(seed), noise_off(seed + 9)
    x0, x1 = -L / 2 - ext, L / 2 + ext
    rings = []
    for k in range(K):
        s = k / (K - 1)
        x = lerp(x0, x1, s)
        e = min(s, 1 - s) * (x1 - x0)
        taper = lerp(0.68, 1.0, sstep(0.0, 0.65, e))
        top = Ht - top_var - 0.25 + top_var * (0.5 + 0.6 * fbm(Vector((x * 0.75, 0, 3.3)) + off2, 2))
        bot = lerp(zb[0], zb[1], 0.5 + 0.6 * fbm(Vector((x * 1.3, 7.0, 0)) + off2, 1))
        bot = max(0.03, bot)
        zc, hh, w = (top + bot) / 2, (top - bot) / 2 * taper, (W / 2 - amp[0] * 0.9 - 0.04) * taper
        ring = []
        for j in range(S):
            th = TAU * j / S - math.pi / 2
            cy, sz = math.cos(th), math.sin(th)
            y = w * math.copysign(abs(cy) ** boxy, cy)
            z = zc + hh * math.copysign(abs(sz) ** boxy, sz)
            nrm = Vector((0, cy / max(w, 0.05), sz / max(hh, 0.05))).normalized()
            p = Vector((x, y, z))
            q = Vector((p.x * 1.25, p.y, p.z * 0.6))          # lobes taller than wide
            d = amp[0] * fbm(q * 1.15 + off, 2) + amp[1] * noise.noise(p * 3.2 + off2)
            d += rnd.uniform(-amp[2], amp[2])
            p += nrm * d
            p.x += rnd.uniform(-0.05, 0.05)
            p.z = max(p.z, 0.02)
            a = lerp(1.0, 0.42, clamp(-d / amp[0])) * lerp(0.86, 1.0, clamp(d / amp[0]))
            a *= lerp(0.5, 1.0, sstep(-0.95, 0.45, sz))
            ring.append(m.v(p, a, nh))
        rings.append(ring)
    c0 = sum((m.co[i] for i in rings[0]), Vector()) / S + Vector((-0.15, 0, 0))
    c1 = sum((m.co[i] for i in rings[-1]), Vector()) / S + Vector((0.15, 0, 0))
    loft(m, [m.v(c0, 0.45, nh)] + rings + [m.v(c1, 0.45, nh)], mat=mat, smooth=smooth)


# --------------------------------------------------------------------------
# Crown bodies

def billow(p, octaves=2, lac=2.2, gain=0.5):
    """Puffy noise: rounded bumps separated by sharp creases (cauliflower)."""
    s, a, f, tot = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        s += a * (1.0 - 2.0 * abs(noise.noise(p * f)))
        tot += a
        a *= gain
        f *= lac
    return s / tot


def crown_body(m, centre, radii, subdiv=2, seed=0, amp=0.28, freq=0.55, crumple=0.05, mat=1, ao=1.0,
               flat_bottom=0.5, yaw=0.0, smooth=False, nh=None, under=0.5, cavity=0.6, octaves=2):
    """A leafy crown volume: ellipsoid pushed out into puffs separated by
    creases (billow noise in world metres, so puff size does not depend on
    the body size), crumpled per vertex, occlusion in the creases and below."""
    verts, faces = ico(subdiv)
    off = noise_off(seed)
    rnd = random.Random(seed)
    rz = rot_z(yaw)
    centre = Vector(centre)
    rmax = max(radii)
    idx = []
    for d in verts:
        base = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2]))
        wp = centre + rz @ base
        b = billow(wp * freq + off, octaves)
        s = 1.0 + amp * b + rnd.uniform(-crumple, crumple)
        p = base * s
        if flat_bottom is not None and p.z < -radii[2] * flat_bottom:
            p.z = -radii[2] * flat_bottom + (p.z + radii[2] * flat_bottom) * 0.25
        a = ao * lerp(1.0 - cavity, 1.0, clamp(0.5 + 0.5 * b * 1.4))
        a *= lerp(1.0 - under, 1.0, sstep(-0.8, 0.5, d.z))
        idx.append(m.v(centre + rz @ p, a, nh))
    for f in faces:
        m.f([idx[i] for i in f], mat, smooth=smooth)
    return idx


def _ray_exit(o, d, c, radii, yaw):
    """Distance along the ray o + t*d to where it leaves the (yawed) ellipsoid, or None."""
    rinv = rot_z(-yaw)
    oo = rinv @ (o - c)
    dd = rinv @ d
    oo = Vector((oo.x / radii[0], oo.y / radii[1], oo.z / radii[2]))
    dd = Vector((dd.x / radii[0], dd.y / radii[1], dd.z / radii[2]))
    a = dd.dot(dd)
    b = 2 * oo.dot(dd)
    c0 = oo.dot(oo) - 1
    disc = b * b - 4 * a * c0
    if disc < 0:
        return None
    t = (-b + math.sqrt(disc)) / (2 * a)
    return t if t > 0 else None


def wrap_body(m, centre, blobs, subdiv=2, seed=0, amp=0.25, freq=0.5, crumple=0.04, mat=1, ao=1.0,
              smooth=False, nh=None, under=0.5, cavity=0.55, flat_z=None):
    """LOD crown: one sphere shrink-wrapped onto the union of ellipsoids
    `blobs` [(centre, radii, yaw_deg)], then puffed like crown_body, so a single
    cheap body keeps the full crown's silhouette."""
    verts, faces = ico(subdiv)
    off = noise_off(seed)
    rnd = random.Random(seed)
    centre = Vector(centre)
    idx = []
    for d in verts:
        t = None
        for c, r, yaw in blobs:
            e = _ray_exit(centre, d, Vector(c), r, math.radians(yaw))
            if e is not None and (t is None or e > t):
                t = e
        if t is None:
            t = min(min(r) for _, r, _ in blobs)
        p = centre + d * t
        b = billow(p * freq + off, 2)
        p = centre + d * t * (1.0 + amp * b + rnd.uniform(-crumple, crumple))
        if flat_z is not None and p.z < flat_z:
            p.z = flat_z + (p.z - flat_z) * 0.25
        a = ao * lerp(1.0 - cavity, 1.0, clamp(0.5 + 0.7 * b))
        a *= lerp(1.0 - under, 1.0, sstep(-0.8, 0.5, d.z))
        idx.append(m.v(p, a, nh))
    for f in faces:
        m.f([idx[i] for i in f], mat, smooth=smooth)
    return idx


# ==========================================================================
# v2: alpha-card foliage
# ==========================================================================
#
# Atlases are rendered in Blender from modelled leaves, needles, blades and
# twigs: every tile is built as real geometry (in metres) with per-vertex
# albedo, laid out in an atlas plane and rendered orthographically from
# above with a transparent film — once for colour (emission = albedo with a
# little baked depth shading) and once for the tangent-space normal
# (emission = N * 0.5 + 0.5). Cards are quads mapped onto the tiles.

import os, tempfile, time
import numpy as np

V2_TMP = os.environ.get('TMPDIR') or tempfile.gettempdir()


class TileMesh:
    """Geometry for one atlas tile, in tile-local metres: x across, y up the
    tile (the card's length), z towards the viewer (relief)."""

    def __init__(self):
        self.co, self.col, self.faces = [], [], []

    def v(self, co, col):
        self.co.append(Vector(co))
        self.col.append(tuple(col))
        return len(self.co) - 1

    def f(self, idx):
        idx = tuple(idx)
        if len(set(idx)) < len(idx):
            return
        # keep every face facing the camera (+z): flip by signed area
        a, b, c = self.co[idx[0]], self.co[idx[1]], self.co[idx[2]]
        if (b - a).cross(c - a).z < 0:
            idx = tuple(reversed(idx))
        self.faces.append(idx)


def hexcol(h, k=1.0):
    c = kit.srgb_to_linear(h)
    return (c[0] * k, c[1] * k, c[2] * k)


def vary(col, rnd, v=0.12, h=0.05):
    """Brightness and slight hue variation of a linear colour."""
    k = 1.0 + rnd.uniform(-v, v)
    t = rnd.uniform(-h, h)
    r, g, b = col
    return (max(0.0, r * k * (1 + t)), max(0.0, g * k), max(0.0, b * k * (1 - t)))


def mixc(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def rot2(v, ang):
    c, s = math.cos(ang), math.sin(ang)
    return Vector((v.x * c - v.y * s, v.x * s + v.y * c, v.z))


def strip2d(tm, pts, widths, col, col_end=None, z0=0.0, dz=None, round_end=True):
    """A flat strip (twig, stem, blade, rachis) along 2D points; widths per point."""
    pts = [Vector((p[0], p[1], p[2] if len(p) > 2 else z0)) for p in pts]
    n = len(pts)
    if not hasattr(widths, '__len__'):
        widths = [widths] * n
    elif len(widths) != n:
        ws = list(widths)
        widths = []
        for i in range(n):
            t = i / max(n - 1, 1) * (len(ws) - 1)
            k = min(int(t), len(ws) - 2)
            widths.append(lerp(ws[k], ws[k + 1], t - k))
    L, R = [], []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        d.z = 0
        d = d.normalized() if d.length > 1e-9 else Vector((0, 1, 0))
        s = Vector((d.y, -d.x, 0))
        t = i / max(n - 1, 1)
        c = mixc(col, col_end, t) if col_end else col
        w = widths[i] / 2
        L.append(tm.v(p - s * w, c))
        R.append(tm.v(p + s * w, c))
    for i in range(n - 1):
        tm.f((L[i], R[i], R[i + 1], L[i + 1]))
    return L, R


def leaf2d(tm, base, ang, length, width, col, rnd, shape='ellipse', segs=12, fold=0.25, curl=0.0,
           lobes=0, lobe_depth=0.0, serr=0, serr_depth=0.0, z=0.0, midrib=None, veins=0, vein_col=None,
           asym=0.0, petiole=0.0, petiole_col=None, wavy=0.0, tip_col=None):
    """A leaf blade along a midrib from `base` in direction `ang` (radians,
    0 = +y): outline from `shape` with optional lobes, serrations and a wavy
    margin, folded along the midrib (relief for the normal map), the tip
    curling towards the viewer, a lighter midrib and lateral veins."""
    base = Vector((base[0], base[1], z))
    d = rot2(Vector((0, 1, 0)), ang)
    s = Vector((d.y, -d.x, 0))
    if petiole > 0:
        pc = petiole_col or mixc(col, (0.06, 0.05, 0.02), 0.45)
        strip2d(tm, [base, base + d * petiole], [max(width * 0.06, 0.0012), max(width * 0.04, 0.001)], pc, z0=z)
        base = base + d * petiole

    def half(t):
        if shape == 'ellipse':
            w = math.sin(math.pi * min(1.0, t ** 0.9)) ** 0.8
        elif shape == 'ovate':
            w = math.sin(math.pi * t ** 0.62) ** 0.8
        elif shape == 'obovate':
            w = math.sin(math.pi * t ** 1.35) ** 0.75
        elif shape == 'lance':
            w = math.sin(math.pi * t ** 0.75) ** 1.25
        elif shape == 'heart':
            w = math.sin(math.pi * (0.16 + 0.84 * t) ** 0.72) ** 0.6
        elif shape == 'triangle':
            w = min(1.0, (t / 0.32) ** 0.6) * (1 - max(0.0, t - 0.32) / 0.68) ** 1.1
        elif shape == 'blade':
            w = min(1.0, t * 10) * (1 - t ** 2.5)
        elif shape == 'round':
            w = math.sin(math.pi * t ** 0.8) ** 0.55
        else:
            w = math.sin(math.pi * t)
        if lobes:
            w *= 1.0 - lobe_depth * (0.5 - 0.5 * math.cos(2 * math.pi * lobes * t)) * min(1.0, t * 5) * (1 - t ** 5)
        if wavy:
            w *= 1.0 + wavy * math.sin(t * 31.0)
        return max(0.0, w)
    n = segs
    mid, lft, rgt = [], [], []
    tc = tip_col or col
    for i in range(n + 1):
        t = i / n
        hw = width / 2 * half(t)
        if serr and 0.06 < t < 0.97:
            hw *= 1.0 - (i % 2) * serr_depth
        p = base + d * (length * t) + s * (asym * width * math.sin(math.pi * t) * 0.2)
        zc = z + curl * length * t * t
        c = mixc(col, tc, t)
        mid.append(tm.v((p.x, p.y, zc + fold * hw * 0.6), mixc(c, tuple(min(1.0, x * 1.18) for x in c), 0.5)))
        lft.append(tm.v((p.x - s.x * hw, p.y - s.y * hw, zc), tuple(x * 0.9 for x in c)))
        rgt.append(tm.v((p.x + s.x * hw, p.y + s.y * hw, zc), tuple(x * 0.98 for x in c)))
    for i in range(n):
        tm.f((lft[i], mid[i], mid[i + 1], lft[i + 1]))
        tm.f((mid[i], rgt[i], rgt[i + 1], mid[i + 1]))
    lift = Vector((0, 0, 0.0004))
    if midrib:
        pts = [tm.co[mid[i]] + lift for i in range(n + 1)]
        strip2d(tm, pts, [max(width * 0.035 * (1 - i / n), 0.0006) for i in range(n + 1)], midrib)
    if veins:
        vc = vein_col or midrib or mixc(col, (0.45, 0.5, 0.25), 0.35)
        for k in range(1, veins + 1):
            t = k / (veins + 1) * 0.9
            i = int(t * n)
            for side, edge in ((-1, lft), (1, rgt)):
                a = tm.co[mid[i]] + lift
                j = min(n, i + 1)
                e = tm.co[edge[j]] * 0.85 + tm.co[mid[j]] * 0.15 + lift
                strip2d(tm, [a, e], [max(width * 0.018, 0.0005), max(width * 0.008, 0.0004)], vc)
    return mid


def needle2d(tm, base, ang, length, width, col, col_tip=None, z=0.0, droop=0.0):
    """A single needle: a tapering sliver (2 triangles)."""
    base = Vector((base[0], base[1], z))
    d = rot2(Vector((0, 1, 0)), ang)
    s = Vector((d.y, -d.x, 0))
    tip = base + d * length + Vector((0, 0, -droop))
    # a keeled needle: one flank raised, so the normal map gives every
    # needle its own facing (glints across a spray instead of flat card light)
    k = Vector((0, 0, width * 0.45))
    a = tm.v(base - s * width * 0.5 - k, col)
    b = tm.v(base + s * width * 0.5 + k, col)
    c = tm.v(tip + s * width * 0.18 + k * 0.4, col_tip or col)
    e = tm.v(tip - s * width * 0.18 - k * 0.4, col_tip or col)
    tm.f((a, b, c, e))


class Atlas:
    """A set of tiles rendered into one RGBA colour image and one normal
    image. Tile rects are in pixels from the top-left; each tile holds W x H
    metres of content (pixels per metre equal on both axes)."""

    def __init__(self, name, w, h, normal_div=2, samples=16, dilate=0):
        self.name, self.w, self.h = name, w, h
        self.dilate = dilate
        self.normal_div = normal_div
        self.samples = samples
        self.tiles = {}
        self.color = self.normal = self.material = None

    def tile(self, key, rect, W, builder, pivot=(0.5, 0.0), seed=1, opaque=False):
        px, py, pw, ph = rect
        H = W * ph / pw
        self.tiles[key] = dict(rect=rect, W=W, H=H, builder=builder, pivot=pivot, seed=seed, opaque=opaque)
        return self.tiles[key]

    def size(self, key):
        t = self.tiles[key]
        return t['W'], t['H']

    def uv(self, key, x, y):
        """Tile-local metres (pivot at the origin) -> atlas UV (v up)."""
        t = self.tiles[key]
        px, py, pw, ph = t['rect']
        fx = x / t['W'] + t['pivot'][0]
        fy = y / t['H'] + t['pivot'][1]
        return ((px + fx * pw) / self.w, 1.0 - (py + (1.0 - fy) * ph) / self.h)

    # ---- rendering
    def _scene_objects(self):
        objs = []
        for key, t in self.tiles.items():
            tm = TileMesh()
            t['builder'](tm, random.Random(t['seed']), t['W'], t['H'])
            if not tm.faces:
                continue
            px, py, pw, ph = t['rect']
            # keep the drawing inside its rect: shrink about the pivot if needed
            xs = [c.x for c in tm.co]
            ys = [c.y for c in tm.co]
            lo_x, hi_x = -t['pivot'][0] * t['W'], (1 - t['pivot'][0]) * t['W']
            lo_y, hi_y = -t['pivot'][1] * t['H'], (1 - t['pivot'][1]) * t['H']
            f = 1.0
            for v, lo, hi in ((min(xs), lo_x, hi_x), (max(xs), lo_x, hi_x), (min(ys), lo_y, hi_y), (max(ys), lo_y, hi_y)):
                if v > 0 and hi > 0:
                    f = min(f, hi * 0.985 / v)
                elif v < 0 and lo < 0:
                    f = min(f, lo * 0.985 / v)
            if f < 1.0:
                for c in tm.co:
                    c.x *= f
                    c.y *= f
            k = pw / t['W'] / 1000.0
            ox = (px + t['pivot'][0] * pw) / 1000.0
            oy = (self.h - py - ph + t['pivot'][1] * ph) / 1000.0
            zs = [c.z for c in tm.co]
            z0, z1 = min(zs), max(zs)
            verts = [(ox + c.x * k, oy + c.y * k, c.z * k) for c in tm.co]
            me = bpy.data.meshes.new('tile_' + key)
            me.from_pydata(verts, [], list(tm.faces))
            me.update()
            # albedo with a little depth shading (lower layers darker)
            att = me.color_attributes.new('albedo', 'FLOAT_COLOR', 'POINT')
            for i, (c, p) in enumerate(zip(tm.col, tm.co)):
                sh = 1.0 if t['opaque'] or z1 - z0 < 1e-6 else 0.62 + 0.38 * (p.z - z0) / (z1 - z0)
                att.data[i].color = (c[0] * sh, c[1] * sh, c[2] * sh, 1.0)
            me.shade_flat()
            obj = kit.link(bpy.data.objects.new('tile_' + key, me))
            objs.append(obj)
        return objs

    def _render(self, objs, mode, res_div=1):
        scene = bpy.context.scene
        mat = bpy.data.materials.new('atlas_' + mode)
        from bake import Graph
        g = Graph(mat)
        if mode == 'color':
            g.emission(g.attribute('albedo', 'Color'))
        else:
            nrm = g.geometry('Normal')
            x, y, z = g.sep(nrm)
            zz = g.absolute(z)
            enc = g.combine(g.madd(x, 0.5, 0.5), g.madd(y, 0.5, 0.5), g.madd(zz, 0.5, 0.5))
            g.emission(enc)
        for o in objs:
            o.data.materials.clear()
            o.data.materials.append(mat)
        cam_data = bpy.data.cameras.new('atlas_cam')
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = max(self.w, self.h) / 1000.0
        cam = kit.link(bpy.data.objects.new('atlas_cam', cam_data))
        cam.location = (self.w / 2000.0, self.h / 2000.0, 5.0)
        cam.rotation_euler = (0, 0, 0)
        keep = {
            'camera': scene.camera, 'rx': scene.render.resolution_x, 'ry': scene.render.resolution_y,
            'pct': scene.render.resolution_percentage, 'film': scene.render.film_transparent,
            'vt': scene.view_settings.view_transform, 'look': scene.view_settings.look,
            'samples': scene.cycles.samples, 'fp': scene.render.filepath, 'denoise': scene.cycles.use_denoising,
            'mode': scene.render.image_settings.color_mode, 'depth': scene.render.image_settings.color_depth,
        }
        hidden = []
        for o in scene.objects:
            if o.type == 'MESH' and o not in objs and not o.hide_render:
                o.hide_render = True
                hidden.append(o)
        scene.camera = cam
        scene.render.resolution_x = self.w // res_div
        scene.render.resolution_y = self.h // res_div
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.view_settings.view_transform = 'Standard' if mode == 'color' else 'Raw'
        scene.view_settings.look = 'None'
        scene.cycles.samples = self.samples
        scene.cycles.use_denoising = False
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '8'
        path = os.path.join(V2_TMP, f'hedgerow_{self.name}_{mode}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        scene.camera = keep['camera']
        scene.render.resolution_x, scene.render.resolution_y = keep['rx'], keep['ry']
        scene.render.resolution_percentage = keep['pct']
        scene.render.film_transparent = keep['film']
        scene.view_settings.view_transform = keep['vt']
        scene.view_settings.look = keep['look']
        scene.cycles.samples = keep['samples']
        scene.cycles.use_denoising = keep['denoise']
        scene.render.filepath = keep['fp']
        scene.render.image_settings.color_mode = keep['mode']
        scene.render.image_settings.color_depth = keep['depth']
        for o in hidden:
            o.hide_render = False
        kit.delete(cam)
        bpy.data.cameras.remove(cam_data)
        bpy.data.materials.remove(mat)
        img = bpy.data.images.load(path)
        img.name = f'{self.name}_{mode}_src'
        return img

    def render(self):
        import bake
        t0 = time.time()
        objs = self._scene_objects()
        src_c = self._render(objs, 'color')
        src_n = self._render(objs, 'normal')
        for o in objs:
            me = o.data
            kit.delete(o)
            bpy.data.meshes.remove(me)
        col = bake.pixels(src_c).copy()
        nrm = bake.pixels(src_n).copy()
        bpy.data.images.remove(src_c)
        bpy.data.images.remove(src_n)
        a = col[..., 3:4]
        # Blender writes straight alpha: keep the colour as it is, and fill
        # every texel that is not fully opaque from the opaque leaves around
        # it, so mipmaps never mix in a foreign colour
        rgb = fill_under_alpha(col[..., :3], a[..., 0])
        for _ in range(self.dilate):          # thicken thin needles so the alpha test keeps them
            mxa = a.copy()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                mxa = np.maximum(mxa, np.roll(np.roll(a, dy, 0), dx, 1))
            a = np.maximum(a, mxa * 0.8)
        out = np.concatenate([rgb, a], axis=2)
        # normal: flat (0.5, 0.5, 1) where nothing was rendered, downsampled
        na = nrm[..., 3:4]
        flat = np.array([0.5, 0.5, 1.0], np.float32)
        w = np.clip(na / 0.25, 0.0, 1.0)              # straight alpha: keep thin needles' normals
        nv = nrm[..., :3] * w + flat * (1 - w)
        if self.normal_div > 1:
            d = self.normal_div
            h2, w2 = nv.shape[0] // d, nv.shape[1] // d
            nv = nv[:h2 * d, :w2 * d].reshape(h2, d, w2, d, 3).mean(axis=(1, 3))
        v = nv * 2 - 1
        v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
        nv = v * 0.5 + 0.5
        nout = np.concatenate([nv, np.ones(nv.shape[:2] + (1,), np.float32)], axis=2)
        ci = bake.new_image(self.name + '_color', self.w, alpha=True)
        if ci.size[1] != self.h:
            bpy.data.images.remove(ci)
            ci = bpy.data.images.new(self.name + '_color', self.w, self.h, alpha=True)
        ci.alpha_mode = 'STRAIGHT'
        bake.set_pixels(ci, out)
        ni = bpy.data.images.new(self.name + '_normal', nv.shape[1], nv.shape[0], alpha=False)
        ni.colorspace_settings.name = 'Non-Color'
        bake.set_pixels(ni, nout)
        self.color, self.normal = ci, ni
        self.material = card_material(self.name, ci, ni)
        kit.log(f'atlas {self.name}: {self.w}x{self.h} ({len(self.tiles)} tiles) in {time.time() - t0:.1f}s')
        return self.material


def push_pull(rgb, w):
    """Alpha-weighted push-pull fill: where w is small, the weighted average
    of ever coarser neighbourhoods (after tools/fix_card_alpha.py)."""
    levels = []
    c = rgb * w[..., None]
    ww = w.copy()
    while min(ww.shape) > 1:
        levels.append((c, ww))
        h, wd = ww.shape
        h2, w2 = h // 2 * 2, wd // 2 * 2
        c = c[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2, 3).sum((1, 3))
        ww = ww[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2).sum((1, 3))
    fill = c / np.maximum(ww, 1e-6)[..., None]
    for c_l, w_l in reversed(levels):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)
        up = np.pad(up, ((0, c_l.shape[0] - up.shape[0]), (0, c_l.shape[1] - up.shape[1]), (0, 0)), mode='edge')
        own = c_l / np.maximum(w_l, 1e-6)[..., None]
        k = np.clip(w_l, 0, 1)[..., None]
        fill = own * k + up * (1 - k)
    return fill


def fill_under_alpha(rgb, a, solid=0.95):
    """Keep the colour of fully opaque texels, replace all others (the
    transparent ones and the anti-aliased fringe) with a push-pull fill of
    the opaque colours around them."""
    rgb = np.clip(rgb, 0.0, 1.0).astype(np.float32)
    w = (a > solid).astype(np.float32)
    if w.sum() < 1:
        return rgb
    filled = push_pull(rgb, w)
    return np.where((a > solid)[..., None], rgb, filled).astype(np.float32)


def _resample(a, w, h):
    """Area-resample an (H, W, 4) straight-alpha image to (h, w): colour is
    averaged with alpha weights so edges keep their own colour."""
    H, W = a.shape[:2]
    ys = (np.arange(h + 1) * H / h).astype(int)
    xs = (np.arange(w + 1) * W / w).astype(int)
    al = a[..., 3:4]
    cw = np.concatenate([a[..., :3] * al, al], 2)
    # integral image for box sums
    ii = np.zeros((H + 1, W + 1, 4), np.float64)
    ii[1:, 1:] = cw.cumsum(0).cumsum(1)
    s = ii[ys[1:]][:, xs[1:]] - ii[ys[:-1]][:, xs[1:]] - ii[ys[1:]][:, xs[:-1]] + ii[ys[:-1]][:, xs[:-1]]
    area = ((ys[1:] - ys[:-1])[:, None] * (xs[1:] - xs[:-1])[None, :])[..., None].astype(np.float64)
    alpha = s[..., 3:4] / area
    rgb = s[..., :3] / np.maximum(s[..., 3:4], 1e-9)
    return np.concatenate([rgb, alpha], 2).astype(np.float32)


def _bleed(rgb, a, passes=10):
    """Push colour from opaque pixels into transparent ones (iterative
    weighted blur), keeping opaque pixels as they are."""
    known = (a > 0.5).astype(np.float32)
    acc = rgb * known[..., None]
    w = known.copy()
    cur_rgb, cur_w = acc.copy(), w.copy()
    for i in range(passes):
        s = 1 << min(i, 6)
        tot_rgb = cur_rgb.copy()
        tot_w = cur_w.copy()
        for dy, dx in ((s, 0), (-s, 0), (0, s), (0, -s)):
            tot_rgb += np.roll(np.roll(cur_rgb, dy, 0), dx, 1)
            tot_w += np.roll(np.roll(cur_w, dy, 0), dx, 1)
        cur_rgb = np.where(cur_w[..., None] > 0, cur_rgb, tot_rgb)
        cur_w = np.where(cur_w > 0, cur_w, tot_w)
    fill = np.where(cur_w[..., None] > 0, cur_rgb / np.maximum(cur_w[..., None], 1e-6), rgb)
    return np.where(known[..., None] > 0, rgb, np.where(a[..., None] > 0.02, rgb, fill)).astype(np.float32)


def card_material(name, col_img, nrm_img, rough=0.85):
    """Alpha-card material: base colour + alpha (MASK through GREATER_THAN
    0.5), tangent normal map, double-sided."""
    from bake import Graph
    mat = bpy.data.materials.new(name)
    g = Graph(mat)
    tc = g.node('ShaderNodeTexImage', image=col_img, interpolation='Linear')
    g.nt.links.new(g.uvmap('UVMap'), tc.inputs['Vector'])
    tn = g.node('ShaderNodeTexImage', image=nrm_img, interpolation='Linear')
    g.nt.links.new(g.uvmap('UVMap'), tn.inputs['Vector'])
    nm = g.node('ShaderNodeNormalMap', space='TANGENT', uv_map='UVMap')
    g.nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    alpha = g.math('GREATER_THAN', tc.outputs['Alpha'], 0.5)
    bsdf = g.principled(tc.outputs['Color'], rough, 0.0, nm.outputs[0], alpha=alpha)
    for k in ('Specular IOR Level', 'Specular'):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.25
            break
    # thin leaves let light through: a little subsurface-like translucency in previews
    if 'Transmission Weight' in bsdf.inputs:
        bsdf.inputs['Transmission Weight'].default_value = 0.0
    mat.use_backface_culling = False
    try:
        mat.surface_render_method = 'DITHERED'
    except Exception:
        pass
    mat['card'] = 1
    return mat


def card(m, atlas, key, P, D, S, k=1.0, segs=1, droop=0.0, fold=0.0, mat=0, ao=1.0, ao_tip=None,
         normal=None, flip_u=False):
    """A textured card for atlas tile `key`: its pivot at P, its length along
    D, its width along S (front face = S x D), scaled by k; `segs` segments
    bending by `droop` radians each (towards -front), optional V `fold`
    along the middle. normal: None (geometric), a Vector, or fn(point) ->
    Vector for custom (crown) normals. Returns the number of triangles."""
    W, H = atlas.size(key)
    pvx, pvy = atlas.tiles[key]['pivot']
    D = Vector(D).normalized()
    S = Vector(S)
    S = (S - D * S.dot(D)).normalized()
    tag0 = m.tag
    m.tag = 0
    x0, x1 = -pvx * W, (1 - pvx) * W
    y0, y1 = -pvy * H, (1 - pvy) * H
    cols = [x0, 0.0, x1] if fold else [x0, x1]
    rows = []
    d = D.copy()
    front = S.cross(D)
    p = Vector(P) + D * y0 * k
    for j in range(segs + 1):
        y = y0 + (y1 - y0) * j / segs
        f = S.cross(d)
        a = ao if ao_tip is None else lerp(ao, ao_tip, j / segs)
        row = []
        for x in cols:
            q = p + S * (x * k)
            if fold and x == 0.0:
                q = q + f * (fold * W * k * 0.5)
            nn = normal(q) if callable(normal) else normal
            u, v = atlas.uv(key, (-x if flip_u else x), y)
            row.append((m.v(q, a, nn), (u, v)))
        rows.append(row)
        if j < segs:
            p = p + d * ((y1 - y0) / segs * k)
            d = Quaternion(S, -droop) @ d
    n0 = len(m.faces)
    for j in range(segs):
        for i in range(len(cols) - 1):
            a, b = rows[j][i], rows[j][i + 1]
            c, e = rows[j + 1][i + 1], rows[j + 1][i]
            m.f((a[0], b[0], c[0], e[0]), mat, (a[1], b[1], c[1], e[1]), smooth=False)
    # the outline of the card (base left/right, tip right/left) for the _mid models
    grp = m.card_group if m.card_group is not None else ('c', len(m.cards))
    m.cards.append(dict(corners=(rows[0][0], rows[0][-1], rows[-1][-1], rows[-1][0]), mat=mat, group=grp,
                        keep=m.card_keep, pref=m.card_pref))
    m.tag = tag0
    return 2 * (len(m.faces) - n0)


def basis(D, up=None):
    """A side vector perpendicular to D (horizontal when possible)."""
    D = Vector(D).normalized()
    ref = Vector(up) if up is not None else UP
    s = D.cross(ref)
    if s.length < 1e-4:
        s = D.cross(Vector((1, 0, 0)))
    return s.normalized()


def crown_normal(centre, radii, up=0.35, k=1.0):
    """fn(point) -> normal pointing out of an ellipsoidal crown, biased up."""
    c = Vector(centre)

    def fn(q):
        d = q - c
        n = Vector((d.x / radii[0] ** 2, d.y / radii[1] ** 2, d.z / radii[2] ** 2))
        if n.length < 1e-6:
            n = UP.copy()
        n = n.normalized() * k + UP * up
        return n.normalized()
    return fn


# --------------------------------------------------------------------------
# Atlas art: every tile is real geometry (leaves, needles, blades, twigs)

def dirang(a):
    return rot2(Vector((0, 1, 0)), a)


def angof(v):
    return math.atan2(-v.x, v.y)


def path2d(p0, ang, length, n, bend=0.0, rnd=None, jit=0.04):
    """Points along a gently curving line starting at p0 in direction ang."""
    pts = [Vector((p0[0], p0[1], 0.0))]
    a = ang
    for i in range(n):
        a += bend / n + (rnd.uniform(-jit, jit) if rnd else 0.0)
        pts.append(pts[-1] + dirang(a) * (length / n))
    return pts


def along(pts, t):
    """Point and direction angle at fraction t of a polyline."""
    segs = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    tot = sum(segs) or 1e-6
    d = t * tot
    for i, L in enumerate(segs):
        if d <= L or i == len(segs) - 1:
            f = min(1.0, d / L) if L > 0 else 0.0
            p = pts[i].lerp(pts[i + 1], f)
            return p, angof(pts[i + 1] - pts[i])
        d -= L
    return pts[-1], angof(pts[-1] - pts[-2])


def plen(pts):
    return sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))


def twig(tm, pts, w0, w1, col, z=0.0):
    n = len(pts)
    strip2d(tm, [Vector((p.x, p.y, z)) for p in pts], [lerp(w0, w1, i / max(n - 1, 1)) for i in range(n)], col)


# ---- conifers

def art_spruce(tm, rnd, W, H, kind='spruce'):
    """A conifer spray seen from above: the shoot with alternate side shoots
    and needles. kind: 'spruce' (needles all round, fresh tips), 'fir'
    (flat two-ranked rows, glossy), 'dead' (grey twigs, a few brown needles,
    lichen)."""
    wood = hexcol('#4e3c2a') if kind != 'dead' else hexcol('#6a6258')
    if kind == 'spruce':
        old, new = hexcol('#1f2e1b'), hexcol('#3f5a26')
    elif kind == 'fir':
        old, new = hexcol('#1c2c1c'), hexcol('#33502a')
    else:
        old, new = hexcol('#4a3826'), hexcol('#6a5236')
    main = path2d((0.0, 0.0), rnd.uniform(-0.05, 0.05), H * 0.95, 10, rnd.uniform(-0.2, 0.2), rnd)
    shoots = [(main, 1.0, 0.0)]
    n = 15 if kind != 'dead' else 7
    for i in range(n):
        t = 0.06 + 0.88 * i / n + rnd.uniform(-0.015, 0.015)
        p, a = along(main, t)
        side = 1 if i % 2 else -1
        a2 = a + side * rnd.uniform(0.6, 0.95)
        L = (1 - t) ** 0.5 * W * 0.5 * rnd.uniform(0.85, 1.05)
        sub = path2d(p, a2, L, 4, -side * rnd.uniform(0.1, 0.35), rnd)
        shoots.append((sub, 0.65, t))
        if L > 0.06:
            for j in range(3 if kind != 'dead' else 2):
                q, b = along(sub, 0.22 + 0.24 * j)
                sd = 1 if (j + i) % 2 else -1
                sub2 = path2d(q, b + sd * rnd.uniform(0.55, 0.85), L * rnd.uniform(0.32, 0.48), 2, 0.0, rnd)
                shoots.append((sub2, 0.45, t))
    for pts, ws, t0 in shoots:
        twig(tm, pts, 0.011 * ws if kind != 'fir' else 0.008 * ws, 0.003, wood, z=0.0)
    for pts, ws, t0 in shoots:
        L = plen(pts)
        if kind == 'dead':
            step = 0.012
        else:
            step = 0.0024 if kind == 'spruce' else 0.0027
        cnt = max(2, int(L / step))
        for k in range(cnt):
            t = k / cnt
            p, a = along(pts, t)
            fresh = sstep(0.62, 0.95, t) * (0.9 if kind != 'dead' else 0.0)
            if kind == 'dead' and rnd.random() < 0.6:
                continue
            for side in (-1, 1):
                if kind == 'fir':
                    na = a + side * rnd.uniform(1.2, 1.55)
                    nl = rnd.uniform(0.024, 0.032) * (1 - 0.3 * t)
                    nw = 0.0034
                else:
                    na = a + side * rnd.uniform(0.5, 1.25)
                    nl = rnd.uniform(0.018, 0.027) * (1 - 0.2 * t)
                    nw = 0.003
                c = vary(mixc(old, new, fresh), rnd, 0.16, 0.05)
                needle2d(tm, p, na, nl, nw, c, tuple(x * 1.15 for x in c), z=rnd.uniform(0.0008, 0.004))
            if kind == 'spruce':          # needles pointing up out of the spray
                c = vary(mixc(old, new, fresh), rnd, 0.16, 0.05)
                needle2d(tm, p, a + rnd.uniform(-0.7, 0.7), rnd.uniform(0.007, 0.013), 0.0024,
                         tuple(x * 1.2 for x in c), z=0.006)
    if kind == 'dead':                     # lichen tufts
        for i in range(10):
            pts, ws, t0 = shoots[rnd.randrange(len(shoots))]
            p, a = along(pts, rnd.uniform(0.1, 0.9))
            for k in range(5):
                leaf2d(tm, p, rnd.uniform(0, TAU), 0.012, 0.006, vary(hexcol('#8f9478'), rnd, 0.15), rnd,
                       shape='round', segs=4, z=0.004)


def art_spruce_mass(tm, rnd, W, H, kind='spruce'):
    """Overlapping sprays packed into a dense, shadowed mass (crown interior
    fill, no see-through), pivot bottom centre."""
    for i in range(7):
        a = rnd.uniform(-0.9, 0.9)
        x0 = rnd.uniform(-W * 0.2, W * 0.2)
        sub = TileMesh()
        art_spruce(sub, rnd, W * 0.75, H * rnd.uniform(0.75, 0.95), kind)
        ca, sa = math.cos(a), math.sin(a)
        dark = lerp(0.55, 0.9, i / 6)
        off = len(tm.co)
        for co, col in zip(sub.co, sub.col):
            x, y = co.x * ca - co.y * sa, co.x * sa + co.y * ca
            tm.v((x + x0, y * 0.95 + H * 0.02, co.z + i * 0.006), tuple(cc * dark for cc in col))
        for f in sub.faces:
            tm.faces.append(tuple(off + i_ for i_ in f))


def art_spruce_hang(tm, rnd, W, H):
    """Norway spruce 'comb': a branch along the top edge with pendant
    branchlets hanging from it, seen from the side (pivot top-left)."""
    wood = hexcol('#4e3c2a')
    old, new = hexcol('#1f2e1b'), hexcol('#3d5826')
    br = path2d((0.0, -0.035), -math.pi / 2 + 0.02, W * 0.98, 8, -0.06, rnd, jit=0.01)
    twig(tm, br, 0.016, 0.006, wood)
    n = 26
    for i in range(n):
        t = 0.03 + 0.94 * i / n + rnd.uniform(-0.015, 0.015)
        p, a = along(br, t)
        L = rnd.uniform(0.4, 0.9) * (H - 0.06) * (1 - 0.25 * t)
        hang = path2d(p, math.pi + rnd.uniform(-0.3, 0.3), L, 5, rnd.uniform(-0.35, 0.35), rnd)
        twig(tm, hang, 0.006, 0.0025, wood, z=-0.002)
        if L > 0.2:                               # small side branchlets
            for j in range(2):
                q0, b0 = along(hang, 0.35 + 0.3 * j)
                sb = path2d(q0, b0 + (0.5 if (i + j) % 2 else -0.5), L * 0.3, 2, 0.0, rnd)
                twig(tm, sb, 0.003, 0.002, wood, z=-0.001)
                for k in range(int(plen(sb) / 0.003)):
                    q1, b1 = along(sb, k / max(1, int(plen(sb) / 0.003)))
                    for side in (-1, 1):
                        c = vary(mixc(old, new, 0.3), rnd, 0.16, 0.05)
                        needle2d(tm, q1, b1 + side * rnd.uniform(0.45, 1.2), rnd.uniform(0.014, 0.022), 0.003, c,
                                 tuple(x * 1.15 for x in c), z=rnd.uniform(0.0, 0.004))
        cnt = int(L / 0.0024)
        for k in range(cnt):
            tt = k / cnt
            q, b = along(hang, tt)
            fresh = sstep(0.7, 1.0, tt)
            for side in (-1, 1, 0):
                c = vary(mixc(old, new, fresh), rnd, 0.16, 0.05)
                if side == 0:
                    needle2d(tm, q, b + rnd.uniform(-0.6, 0.6), rnd.uniform(0.007, 0.012), 0.003,
                             tuple(x * 1.15 for x in c), z=0.005)
                    continue
                needle2d(tm, q, b + side * rnd.uniform(0.45, 1.2), rnd.uniform(0.016, 0.026), 0.003, c,
                         tuple(x * 1.15 for x in c), z=rnd.uniform(0.0, 0.004))
    for k in range(int(plen(br) / 0.004)):
        q, b = along(br, k / int(plen(br) / 0.004))
        for side in (-1, 1):
            c = vary(old, rnd, 0.16, 0.05)
            needle2d(tm, q, b + side * rnd.uniform(0.5, 1.3), rnd.uniform(0.012, 0.018), 0.0019, c, z=0.004)


def _pine_brush(tm, rnd, p0, a0, L, wood, c0, c1, z0=0.0):
    sub = path2d(p0, a0, L, 3, 0.0, rnd)
    twig(tm, sub, 0.008, 0.005, wood, z=z0)
    cnt = int(L / 0.0034)
    for k in range(cnt):
        t = k / cnt
        q, b = along(sub, t)
        for side in (-1, 1, 0):
            spread = lerp(0.7, 0.3, t) + rnd.uniform(-0.15, 0.15)
            if side == 0:
                spread = rnd.uniform(-0.3, 0.3)
            c = vary(mixc(c0, c1, rnd.random() * 0.7 + 0.15 * t), rnd, 0.14, 0.04)
            needle2d(tm, q, b + (side or 1) * spread, rnd.uniform(0.05, 0.07) * (0.6 if side == 0 else 1.0),
                     0.0026, c, tuple(x * 1.2 for x in c), z=z0 + rnd.uniform(0.0, 0.006) + (0.006 if side == 0 else 0))


def art_pine_tuft(tm, rnd, W, H):
    """Scots pine branchlet: an orange-brown twig forking into several shoots,
    each ending in a brush of long paired grey-green needles."""
    wood = hexcol('#6a4630')
    c0, c1 = hexcol('#2c3a2c'), hexcol('#56684a')
    main = path2d((0.0, 0.0), rnd.uniform(-0.1, 0.1), H * 0.55, 5, rnd.uniform(-0.25, 0.25), rnd)
    twig(tm, main, 0.016, 0.009, wood)
    p_end, a_end = along(main, 1.0)
    for j, da in enumerate((-0.8, -0.3, 0.15, 0.6)):
        _pine_brush(tm, rnd, p_end, a_end + da + rnd.uniform(-0.1, 0.1), rnd.uniform(0.2, 0.28), wood, c0, c1, 0.004)
    for k in range(4):
        q, b = along(main, 0.3 + 0.17 * k)
        side = 1 if k % 2 else -1
        sub = path2d(q, b + side * rnd.uniform(0.7, 1.0), rnd.uniform(0.12, 0.2), 3, -side * 0.3, rnd)
        twig(tm, sub, 0.009, 0.006, wood)
        q2, b2 = along(sub, 1.0)
        for da in (-0.35, 0.3):
            _pine_brush(tm, rnd, q2, b2 + da, rnd.uniform(0.15, 0.22), wood, c0, c1, 0.002 * k)


# ---- broadleaves

def _leafcol(rnd, base, spread=0.16, hue=0.07, yellow=0.0):
    c = vary(hexcol(base), rnd, spread, hue)
    if yellow and rnd.random() < yellow:
        c = mixc(c, hexcol('#7a7a30'), rnd.uniform(0.2, 0.5))
    return c


def _oak_rosette(tm, tip, ta, rnd, z, n=None, size=1.0):
    n = n or (8 + rnd.randrange(4))
    order = list(range(n))
    rnd.shuffle(order)
    for idx in order:
        a = ta + (idx / (n - 1) - 0.5) * 3.2 + rnd.uniform(-0.15, 0.15)
        L = rnd.uniform(0.075, 0.11) * size * (1.0 - 0.25 * abs(idx / (n - 1) - 0.5))
        col = _leafcol(rnd, rnd.choice(['#3e5426', '#36501f', '#46602a']), yellow=0.1)
        z += 0.0012
        leaf2d(tm, tip - dirang(ta) * rnd.uniform(0, 0.02), a, L, L * 0.56, col, rnd, shape='obovate', segs=14,
               fold=0.3, curl=0.12, lobes=4.5, lobe_depth=0.42, z=z, petiole=0.005,
               midrib=mixc(col, hexcol('#9aa060'), 0.35), veins=3, tip_col=tuple(x * 1.1 for x in col))
    return z


def art_oak(tm, rnd, W, H):
    """Oak branchlet: a forked twig system with leaf rosettes at every shoot
    end and leaves along the shoots (pivot bottom centre)."""
    wood = hexcol('#4a3b2c')
    main = path2d((0.0, 0.0), rnd.uniform(-0.1, 0.1), H * 0.72, 6, rnd.uniform(-0.3, 0.3), rnd)
    twig(tm, main, 0.014, 0.006, wood)
    shoots = [main]
    for i in range(5):
        t = 0.25 + 0.15 * i + rnd.uniform(-0.03, 0.03)
        p, a = along(main, t)
        side = 1 if i % 2 else -1
        sub = path2d(p, a + side * rnd.uniform(0.55, 0.95), H * rnd.uniform(0.22, 0.36) * (1.1 - 0.4 * t), 4,
                     -side * rnd.uniform(0.1, 0.4), rnd)
        twig(tm, sub, 0.008, 0.004, wood)
        shoots.append(sub)
    z = 0.0
    for sh in shoots:                       # leaves along the shoots
        L = plen(sh)
        for k in range(int(L / 0.07)):
            q, b = along(sh, 0.2 + 0.6 * k / max(1, int(L / 0.07)))
            side = 1 if k % 2 else -1
            ll = rnd.uniform(0.065, 0.09)
            col = _leafcol(rnd, '#384d22', yellow=0.1)
            z += 0.0008
            leaf2d(tm, q, b + side * rnd.uniform(0.6, 1.1), ll, ll * 0.55, col, rnd, shape='obovate', segs=12,
                   fold=0.3, curl=0.1, lobes=4, lobe_depth=0.4, z=z, petiole=0.005,
                   midrib=mixc(col, hexcol('#9aa060'), 0.3), veins=3)
    for sh in shoots:
        tip, ta = along(sh, 1.0)
        z = _oak_rosette(tm, tip, ta, rnd, z + 0.002)


def art_beech(tm, rnd, W, H):
    """Beech spray: flat, layered zigzag shoots with two-ranked oval leaves."""
    wood = hexcol('#5a4a3a')

    def zig(p0, a0, L, n):
        pts = [Vector((p0[0], p0[1], 0.0))]
        a = a0
        for i in range(n):
            a += (0.24 if i % 2 else -0.24) + rnd.uniform(-0.05, 0.05)
            pts.append(pts[-1] + dirang(a) * (L / n))
        return pts
    main = zig((0.0, 0.0), rnd.uniform(-0.08, 0.08), H * 0.9, 12)
    shoots = [main]
    for i in range(6):
        t = 0.2 + 0.12 * i
        p, a = along(main, t)
        side = 1 if i % 2 else -1
        shoots.append(zig(p, a + side * rnd.uniform(0.6, 0.9), H * rnd.uniform(0.25, 0.38) * (1.1 - 0.5 * t), 6))
    for sh in shoots:
        twig(tm, sh, 0.007 if sh is main else 0.004, 0.002, wood)
    z = 0.0
    for si, sh in enumerate(shoots):
        for i in range(1, len(sh)):
            q = sh[i]
            b = angof(sh[i] - sh[i - 1])
            side = 1 if i % 2 else -1
            L = rnd.uniform(0.06, 0.09)
            col = _leafcol(rnd, rnd.choice(['#466628', '#3e5e24', '#4e6e2c']), spread=0.14, yellow=0.04)
            z += 0.0006
            leaf2d(tm, q, b + side * rnd.uniform(0.8, 1.15), L, L * 0.6, col, rnd, shape='ellipse', segs=12,
                   fold=0.25, curl=0.05, wavy=0.03, z=z, petiole=0.005,
                   midrib=mixc(col, hexcol('#a4b070'), 0.35), veins=6)
        q = sh[-1]
        leaf2d(tm, q, angof(sh[-1] - sh[-2]), 0.06, 0.036, _leafcol(rnd, '#4e702c'), rnd, shape='ellipse', segs=10,
               fold=0.25, z=z + 0.001, petiole=0.004, midrib=hexcol('#7a8a50'), veins=5)


def art_birch(tm, rnd, W, H):
    """Birch: thin pendulous twigs (pivot top) with small serrated
    triangular leaves on long stalks."""
    wood = hexcol('#5a3a2a')
    for j in range(3):
        x0 = (j - 1) * W * 0.22 + rnd.uniform(-0.02, 0.02)
        pts = path2d((x0, -0.01), math.pi + rnd.uniform(-0.15, 0.15), H * rnd.uniform(0.75, 0.95), 7,
                     rnd.uniform(-0.25, 0.25), rnd)
        twig(tm, pts, 0.004, 0.0015, wood, z=0.0)
        L = plen(pts)
        cnt = int(L / 0.035)
        for k in range(cnt):
            q, b = along(pts, (k + 0.5) / cnt)
            side = 1 if k % 2 else -1
            ll = rnd.uniform(0.04, 0.058)
            col = _leafcol(rnd, '#5a7a2e', spread=0.16, hue=0.08, yellow=0.12)
            leaf2d(tm, q, b + side * rnd.uniform(0.35, 0.8), ll, ll * 0.72, col, rnd, shape='triangle', segs=10,
                   fold=0.2, serr=1, serr_depth=0.18, z=0.001 * k + 0.002 * j, petiole=0.012,
                   midrib=mixc(col, hexcol('#b0b878'), 0.3), veins=3)


def art_hazel(tm, rnd, W, H):
    """Hazel / field maple shrub spray: big round double-serrate leaves."""
    wood = hexcol('#6a5040')
    main = path2d((0.0, 0.0), rnd.uniform(-0.1, 0.1), H * 0.8, 5, rnd.uniform(-0.3, 0.3), rnd)
    twig(tm, main, 0.008, 0.004, wood)
    for i in range(7):
        q, b = along(main, 0.12 + 0.13 * i)
        side = 1 if i % 2 else -1
        L = rnd.uniform(0.09, 0.13) * (1 - 0.2 * i / 7)
        col = _leafcol(rnd, '#47612a', spread=0.15, yellow=0.06)
        leaf2d(tm, q, b + side * rnd.uniform(0.7, 1.1), L, L * 0.85, col, rnd, shape='heart', segs=18, fold=0.22,
               curl=0.05, serr=1, serr_depth=0.1, z=0.0015 * i, petiole=0.01,
               midrib=mixc(col, hexcol('#a0a868'), 0.35), veins=5)
    q, b = along(main, 1.0)
    leaf2d(tm, q, b, 0.09, 0.075, _leafcol(rnd, '#50692e'), rnd, shape='heart', segs=16, fold=0.22,
           serr=1, serr_depth=0.1, z=0.012, petiole=0.008, midrib=hexcol('#8a9858'), veins=5)


def art_hawthorn(tm, rnd, W, H):
    """Hawthorn / blackthorn hedge spray: dense small lobed leaves, spiny twigs."""
    wood = hexcol('#3e3028')
    main = path2d((0.0, 0.0), rnd.uniform(-0.1, 0.1), H * 0.88, 6, rnd.uniform(-0.4, 0.4), rnd)
    twig(tm, main, 0.008, 0.004, wood)
    shoots = [main]
    for i in range(9):
        q, b = along(main, 0.08 + 0.1 * i)
        side = 1 if i % 2 else -1
        sub = path2d(q, b + side * rnd.uniform(0.5, 0.9), rnd.uniform(0.1, 0.2) * (1.1 - 0.5 * i / 9), 3, -side * 0.2, rnd)
        twig(tm, sub, 0.005, 0.0025, wood)
        shoots.append(sub)
        q2, b2 = along(sub, 0.5)
        strip2d(tm, [q2, q2 + dirang(b2 - side * 0.9) * 0.015], [0.003, 0.0005], wood)     # thorn
    z = 0.0
    for sub in shoots:
        L = plen(sub)
        for k in range(int(L / 0.022)):
            q, b = along(sub, (k + 0.5) / int(L / 0.022))
            for side in (-1, 1):
                if rnd.random() < 0.25:
                    continue
                ll = rnd.uniform(0.03, 0.045)
                col = _leafcol(rnd, '#334a20', spread=0.18, hue=0.06, yellow=0.05)
                z += 0.0002
                leaf2d(tm, q, b + side * rnd.uniform(0.4, 1.0), ll, ll * 0.75, col, rnd, shape='obovate', segs=10,
                       fold=0.25, lobes=2.5, lobe_depth=0.5, z=z, petiole=0.004,
                       midrib=mixc(col, hexcol('#8a9a58'), 0.3))


def art_bramble(tm, rnd, W, H):
    """Bramble: arching prickly canes with compound leaves (3-5 serrated
    leaflets), a few white flowers (June)."""
    _bramble_cane(tm, rnd, W, H, (-W * 0.38, 0.0), -0.5, 1.2, 1.0, 0.0)
    _bramble_cane(tm, rnd, W, H, (W * 0.3, 0.0), 0.45, -1.1, 0.85, 0.03)


def _bramble_cane(tm, rnd, W, H, p0, a0, bend, lk, z0):
    cane = hexcol('#5a3036')
    pts = path2d(p0, a0, H * lk, 8, bend, rnd)
    twig(tm, pts, 0.009, 0.005, cane)
    L = plen(pts)
    for k in range(int(L / 0.012)):                # prickles
        q, b = along(pts, k / int(L / 0.012))
        side = 1 if k % 2 else -1
        strip2d(tm, [q, q + dirang(b + side * 1.9) * 0.008], [0.004, 0.0004], hexcol('#7a4a40'), z0=0.0003)
    z = z0
    for i in range(7):
        q, b = along(pts, 0.08 + 0.13 * i)
        side = 1 if i % 2 else -1
        pa = b + side * rnd.uniform(0.6, 1.0)
        pet = q + dirang(pa) * 0.035
        twig(tm, [q, pet], 0.003, 0.002, cane, z=z)
        nleaf = 5 if i < 3 else 3
        for j in range(nleaf):
            a = pa + (j - (nleaf - 1) / 2) * 0.75
            ll = rnd.uniform(0.06, 0.085) * (1.15 if j == (nleaf - 1) // 2 else 1.0)
            col = _leafcol(rnd, '#2f4520', spread=0.16, hue=0.05)
            if rnd.random() < 0.15:
                col = mixc(col, hexcol('#5a3a2a'), 0.35)
            z += 0.0008
            leaf2d(tm, pet, a, ll, ll * 0.6, col, rnd, shape='ovate', segs=12, fold=0.3, serr=1, serr_depth=0.14,
                   z=z, petiole=0.004, midrib=mixc(col, hexcol('#8a9a60'), 0.3), veins=4)
    for i in range(3):                              # flowers
        q, b = along(pts, 0.55 + 0.17 * i)
        c = q + dirang(b + 1.2) * 0.03
        for k in range(5):
            leaf2d(tm, c, k * TAU / 5 + rnd.uniform(-0.1, 0.1), 0.013, 0.011, vary(hexcol('#d8cfd0'), rnd, 0.06),
                   rnd, shape='round', segs=5, fold=0.1, z=0.02)
        leaf2d(tm, c - Vector((0.0, 0.004, 0)), 0.0, 0.008, 0.008, hexcol('#b8a050'), rnd, shape='round', segs=4,
               z=0.021)


def ivy_leaf(tm, q, a, size, col, rnd, z):
    """Ivy: 3-5 lobed palmate leaf with pale veins."""
    vein = mixc(col, hexcol('#b8c0a0'), 0.45)
    for j, (da, k) in enumerate(((0.0, 1.0), (-0.85, 0.68), (0.85, 0.68), (-1.55, 0.42), (1.55, 0.42))):
        leaf2d(tm, q, a + da, size * k, size * k * 0.75, col, rnd, shape='ovate', segs=8, fold=0.12,
               z=z + (0.0003 if j == 0 else 0.0), midrib=vein)


def art_ivy(tm, rnd, W, H):
    stem = hexcol('#4a3a2a')
    pts = path2d((0.0, 0.0), rnd.uniform(-0.2, 0.2), H * 0.95, 8, rnd.uniform(-0.6, 0.6), rnd, jit=0.12)
    twig(tm, pts, 0.006, 0.003, stem)
    for k in range(13):
        q, b = along(pts, 0.04 + 0.075 * k)
        side = 1 if k % 2 else -1
        a = b + side * rnd.uniform(0.6, 1.3)
        pet = q + dirang(a) * rnd.uniform(0.02, 0.04)
        twig(tm, [q, pet], 0.002, 0.0015, stem, z=0.001 * k)
        sz = rnd.uniform(0.04, 0.06)
        col = _leafcol(rnd, '#22361c', spread=0.18, hue=0.05)
        ivy_leaf(tm, pet, a, sz, col, rnd, 0.001 * k + 0.0005)


def art_leafmass(tm, rnd, W, H):
    """A dense mixed leaf clump (hedge and bush interiors): roughly round,
    ragged edge, nearly opaque inside."""
    c = Vector((0.0, H * 0.5, 0.0))
    R = min(W, H) * 0.46
    z = 0.0
    for i in range(140):
        r = R * math.sqrt(rnd.random())
        a = rnd.uniform(0, TAU)
        q = c + Vector((r * math.cos(a), r * math.sin(a), 0))
        ll = rnd.uniform(0.035, 0.07)
        kind = rnd.random()
        col = _leafcol(rnd, ['#2f4520', '#3a5226', '#465e2a'][i % 3], spread=0.2, hue=0.07, yellow=0.04)
        col = tuple(x * lerp(0.75, 1.1, r / R) for x in col)
        z += 0.0004
        if kind < 0.45:
            leaf2d(tm, q, rnd.uniform(0, TAU), ll, ll * 0.75, col, rnd, shape='obovate', segs=8, fold=0.25,
                   lobes=2.5, lobe_depth=0.45, z=z)
        elif kind < 0.8:
            leaf2d(tm, q, rnd.uniform(0, TAU), ll * 1.2, ll * 1.0, col, rnd, shape='heart', segs=10, fold=0.2,
                   serr=1, serr_depth=0.1, z=z, midrib=mixc(col, hexcol('#8a9a58'), 0.3))
        else:
            leaf2d(tm, q, rnd.uniform(0, TAU), ll, ll * 0.6, col, rnd, shape='ovate', segs=8, fold=0.3, serr=1,
                   serr_depth=0.14, z=z)


# ---- ground

def art_grass(tm, rnd, W, H, dry=0.15, tall=False, heads=0, thatch=12):
    """A grass clump from the side (pivot bottom centre): blades fanning from
    the base in mixed greens, dark at the base and paler at the tips, some
    dry and broken stems, dead thatch lying at the foot, seed heads
    (timothy spikes and open panicles)."""
    greens = ['#36501f', '#42602a', '#4e6a2e', '#2c4419', '#566c30', '#3a5a26']
    z = 0.0
    for i in range(thatch):                       # dead thatch at the base
        x0 = rnd.uniform(-0.12, 0.12) * W / 0.6
        a = rnd.choice((-1, 1)) * rnd.uniform(0.9, 1.4)
        pts = path2d((x0, rnd.uniform(0.0, 0.03)), a, rnd.uniform(0.08, 0.2), 4, -a * 0.3, rnd, jit=0.05)
        c = vary(hexcol(rnd.choice(['#6a5a3a', '#7a6a44', '#4e4430'])), rnd, 0.18)
        z += 0.0002
        strip2d(tm, [Vector((p.x, p.y, z)) for p in pts], [0.007, 0.001], tuple(x * 0.6 for x in c), c)
    n = 100 if not tall else 75
    for i in range(n):
        x0 = rnd.uniform(-0.045, 0.045) * W / 0.6
        lean = rnd.uniform(-0.6, 0.6) * (0.45 if tall else 1.0)
        L = H * rnd.uniform(0.4, 0.97) * (0.85 + 0.15 * (1 - abs(lean)))
        bend = lean * rnd.uniform(0.5, 1.8)
        pts = path2d((x0, 0.0), lean * 0.5, L, 8, bend, rnd, jit=0.03)
        w = rnd.uniform(0.006, 0.011) * (1.2 if tall else 1.0)
        u = rnd.random()
        if u < dry:
            c = vary(hexcol(rnd.choice(['#8a7c4a', '#9a8a56', '#7a6a40'])), rnd, 0.15)
            tip = mixc(c, hexcol('#b0a070'), 0.3)
        else:
            c = vary(hexcol(rnd.choice(greens)), rnd, 0.16, 0.07)
            tip = mixc(c, hexcol(rnd.choice(['#7a8a48', '#8a8a50', '#6a7a3a'])), rnd.uniform(0.2, 0.5))
        base = tuple(x * 0.38 for x in c)
        z += 0.0003
        m = len(pts)
        broken = u < dry * 0.4                     # snapped dry stems
        if broken:
            pts = pts[:m // 2 + 1]
            m = len(pts)
        # base -> body -> tip colour along the blade
        cols = [mixc(base, c, min(1.0, k / (m * 0.45))) if k < m * 0.6 else mixc(c, tip, (k - m * 0.6) / (m * 0.4))
                for k in range(m)]
        L_, R_ = [], []
        for k, p in enumerate(pts):
            d = (pts[min(k + 1, m - 1)] - pts[max(k - 1, 0)])
            d = d.normalized() if d.length > 1e-9 else Vector((0, 1, 0))
            sd = Vector((d.y, -d.x, 0))
            ww = (w * (1 - (k / (m - 1)) ** 1.6) + 0.0004) / 2
            L_.append(tm.v((p.x - sd.x * ww, p.y - sd.y * ww, z), cols[k]))
            R_.append(tm.v((p.x + sd.x * ww, p.y + sd.y * ww, z), tuple(x * 1.06 for x in cols[k])))
        for k in range(m - 1):
            tm.f((L_[k], R_[k], R_[k + 1], L_[k + 1]))
    for i in range(heads):
        x0 = rnd.uniform(-0.04, 0.04)
        lean = rnd.uniform(-0.35, 0.35)
        L = H * rnd.uniform(0.78, 0.98)
        pts = path2d((x0, 0.0), lean * 0.4, L, 8, lean * 0.6, rnd, jit=0.02)
        sc = vary(hexcol(rnd.choice(['#6e7044', '#7a7a4a', '#8a8052'])), rnd, 0.12)
        strip2d(tm, [Vector((p.x, p.y, 0.02)) for p in pts], [0.0024, 0.0014], tuple(x * 0.5 for x in sc), sc)
        hc = vary(hexcol(rnd.choice(['#8a7e52', '#9a8a5e', '#7a6e4a', '#86704e'])), rnd, 0.12)
        if i % 2 == 0:                              # timothy: a dense cylindrical spike
            q0, b0 = along(pts, 0.84)
            for k in range(16):
                q, bb = along(pts, 0.84 + 0.155 * k / 16)
                for sd in (-1, 1):
                    leaf2d(tm, q, bb + sd * 0.5, rnd.uniform(0.007, 0.011), 0.004, vary(hc, rnd, 0.1), rnd,
                           shape='lance', segs=3, z=0.021)
        else:                                       # an open panicle
            for k in range(7):
                q, bb = along(pts, 0.7 + 0.28 * k / 7)
                sd = 1 if k % 2 else -1
                br = path2d(q, bb + sd * rnd.uniform(0.4, 0.8), rnd.uniform(0.02, 0.05) * (1 - k / 9), 3, -sd * 0.3, rnd)
                strip2d(tm, [Vector((p.x, p.y, 0.021)) for p in br], 0.0012, sc)
                for j in range(3):
                    qq, b2 = along(br, (j + 1) / 3)
                    leaf2d(tm, qq, b2, rnd.uniform(0.008, 0.012), 0.004, vary(hc, rnd, 0.1), rnd, shape='lance',
                           segs=3, z=0.022)


def art_reeds(tm, rnd, W, H, mace=True):
    """Reeds from the side: long wide blades, stems, a reedmace spike."""
    z = 0.0
    for i in range(14):
        x0 = rnd.uniform(-0.05, 0.05)
        lean = rnd.uniform(-0.3, 0.3)
        L = H * rnd.uniform(0.55, 0.95)
        pts = path2d((x0, 0.0), lean * 0.3, L, 8, lean * rnd.uniform(0.6, 2.0), rnd, jit=0.02)
        w = rnd.uniform(0.012, 0.018)
        c = vary(hexcol(rnd.choice(['#5a6236', '#6a6c3c', '#4e5a30'])), rnd, 0.14, 0.05)
        if rnd.random() < 0.2:
            c = vary(hexcol('#8a7a4a'), rnd, 0.14)
        z += 0.0005
        m = len(pts)
        strip2d(tm, [Vector((p.x, p.y, z)) for p in pts], [w * (1 - (k / (m - 1)) ** 2) + 0.0006 for k in range(m)],
                tuple(x * 0.75 for x in c), mixc(c, hexcol('#a09a68'), 0.3))
    if mace:
        for j in range(2):
            x0 = (j - 0.5) * 0.05
            pts = path2d((x0, 0.0), rnd.uniform(-0.05, 0.05), H * rnd.uniform(0.82, 0.96), 6, 0.0, rnd, jit=0.01)
            strip2d(tm, [Vector((p.x, p.y, 0.01)) for p in pts], [0.006, 0.004], hexcol('#6a6c40'))
            q, b = along(pts, 0.8)
            leaf2d(tm, q, b, H * 0.13, 0.024, vary(hexcol('#4a3222'), rnd, 0.1), rnd, shape='ellipse', segs=8,
                   fold=0.6, z=0.012)


def art_fern(tm, rnd, W, H):
    """Bracken / male fern frond from above: rachis with pinnae, each with
    deep-cut pinnules (pivot bottom centre)."""
    rach = hexcol('#5a5a30')
    pts = path2d((0.0, 0.0), rnd.uniform(-0.05, 0.05), H * 0.96, 10, rnd.uniform(-0.25, 0.25), rnd)
    twig(tm, pts, 0.006, 0.0015, rach)
    n = 15
    for i in range(n):
        t = 0.1 + 0.88 * i / n
        q, b = along(pts, t)
        L = W * 0.46 * math.sin(math.pi * (0.15 + 0.85 * (1 - t)) ** 0.9) * (1 - 0.1 * t) + 0.01
        for side in (-1, 1):
            a = b + side * rnd.uniform(1.0, 1.25)
            col = _leafcol(rnd, '#3e5a24', spread=0.12, hue=0.05)
            col = mixc(col, hexcol('#6a7a36'), 0.3 * t)
            pin = path2d(q, a, L, 4, side * -0.15, rnd, jit=0.0)
            strip2d(tm, [Vector((p.x, p.y, 0.001)) for p in pin], [0.002, 0.0008], rach)
            m = max(3, int(L / 0.009))
            for k in range(m):
                qq, bb = along(pin, (k + 0.5) / m)
                ll = (L * 0.22 + 0.006) * (1 - 0.6 * k / m)
                for sd in (-1, 1):
                    leaf2d(tm, qq, bb + sd * 1.05, ll, ll * 0.6, col, rnd, shape='lance', segs=4, fold=0.2,
                           z=0.0008 + 0.0001 * i)


def art_nettle(tm, rnd, W, H):
    """Stinging nettle stalk from the side: square stem, opposite pairs of
    coarse-toothed heart leaves, catkins of flowers."""
    stem = hexcol('#4a5a2a')
    pts = path2d((0.0, 0.0), rnd.uniform(-0.05, 0.05), H * 0.95, 8, rnd.uniform(-0.15, 0.15), rnd)
    twig(tm, pts, 0.007, 0.003, stem)
    n = 7
    for i in range(n):
        t = 0.12 + 0.86 * i / n
        q, b = along(pts, t)
        ll = lerp(0.16, 0.08, t) * rnd.uniform(0.85, 1.15)
        for side in (-1, 1):
            col = _leafcol(rnd, '#2e4420', spread=0.14, hue=0.05)
            leaf2d(tm, q, b + side * rnd.uniform(0.7, 1.2) + 0.3 * side * (1 - t), ll, ll * 0.62, col, rnd,
                   shape='heart', segs=14, fold=0.35, serr=1, serr_depth=0.2, z=0.001 * i, petiole=0.012,
                   midrib=mixc(col, hexcol('#7a8a50'), 0.3), veins=4)
            if 0.3 < t < 0.8:
                for k in range(3):
                    c0 = q + dirang(b + side * 0.4) * 0.01
                    strip2d(tm, [c0, c0 + dirang(b + side * (0.6 + 0.4 * k)) * 0.05 + Vector((0, -0.02 * k, 0))],
                            0.0025, hexcol('#5e6a3a'), z0=0.002)


def art_dock(tm, rnd, W, H):
    """One big broad-leaved dock leaf (pivot at the stalk end): oblong,
    wavy, red-tinged stalk and midrib, strong veins."""
    col = _leafcol(rnd, '#3e5426', spread=0.1, hue=0.05, yellow=0.2)
    leaf2d(tm, (0.0, 0.0), rnd.uniform(-0.05, 0.05), H * 0.86, W * 0.62, col, rnd, shape='lance', segs=22, fold=0.22,
           wavy=0.05, curl=0.05, petiole=H * 0.12, petiole_col=hexcol('#6a3a2a'), midrib=hexcol('#7a4a34'), veins=9,
           vein_col=mixc(col, hexcol('#8a8a50'), 0.4), tip_col=tuple(x * 1.08 for x in col))


def art_thistle(tm, rnd, W, H):
    """Spear thistle from the side: spiny lobed leaves, purple heads."""
    stem = hexcol('#4e5a32')
    pts = path2d((0.0, 0.0), rnd.uniform(-0.05, 0.05), H * 0.82, 7, 0.1, rnd)
    twig(tm, pts, 0.008, 0.004, stem)
    for i in range(6):
        t = 0.08 + 0.12 * i
        q, b = along(pts, t)
        side = 1 if i % 2 else -1
        ll = lerp(0.16, 0.08, t / 0.8)
        col = _leafcol(rnd, '#3e5030', spread=0.12, hue=0.03)
        a = b + side * rnd.uniform(0.6, 1.0)
        leaf2d(tm, q, a, ll, ll * 0.4, col, rnd, shape='lance', segs=16, fold=0.3, lobes=4, lobe_depth=0.7,
               z=0.001 * i, midrib=hexcol('#b0b498'))
        for k in range(8):                       # spines on the lobe tips
            sp, sb = along([Vector((q.x, q.y, 0)), Vector((q.x, q.y, 0)) + dirang(a) * ll], (k + 0.5) / 8)
            for sd in (-1, 1):
                strip2d(tm, [sp + dirang(a + sd * 1.3) * ll * 0.17, sp + dirang(a + sd * 1.2) * ll * 0.26],
                        [0.0015, 0.0003], hexcol('#c8c4a0'), z0=0.002)
    for j, (t, da) in enumerate(((1.0, 0.0), (0.8, 0.6), (0.85, -0.55))):
        q, b = along(pts, t)
        h = q + dirang(b + da) * (0.0 if j == 0 else 0.07)
        if j:
            strip2d(tm, [q, h], 0.004, stem, z0=0.001)
        leaf2d(tm, h - dirang(b + da) * 0.0, b + da, 0.035, 0.03, hexcol('#4a5a34'), rnd, shape='round', segs=6,
               fold=0.5, z=0.01)
        top = h + dirang(b + da) * 0.03
        for k in range(18):
            a = b + da + (k / 17 - 0.5) * 1.6
            strip2d(tm, [top, top + dirang(a) * rnd.uniform(0.022, 0.03)], [0.0025, 0.001],
                    vary(hexcol('#8a3a7a'), rnd, 0.15), z0=0.012)


def art_ivy_ground(tm, rnd, W, H):
    """Ivy runners creeping over the ground, from above (pivot centre)."""
    stem = hexcol('#4a3a2a')
    z = 0.0
    for r in range(6):
        a0 = r * TAU / 6 + rnd.uniform(-0.3, 0.3)
        pts = path2d(dirang(a0) * 0.02, a0, min(W, H) * rnd.uniform(0.35, 0.47), 8, rnd.uniform(-1.0, 1.0), rnd, jit=0.15)
        twig(tm, pts, 0.005, 0.003, stem, z=0.0)
        for k in range(9):
            q, b = along(pts, 0.05 + 0.11 * k)
            side = 1 if k % 2 else -1
            a = b + side * rnd.uniform(0.6, 1.4)
            pet = q + dirang(a) * 0.025
            z += 0.0006
            ivy_leaf(tm, pet, a, rnd.uniform(0.035, 0.055), _leafcol(rnd, '#22361c', spread=0.2, hue=0.06), rnd, z)


def art_litter(tm, rnd, W, H):
    """Forest-floor litter from above (pivot centre): fallen oak and beech
    leaves, needles, twigs, a cone or two; dense in the middle, thinning to a
    ragged edge."""
    z = 0.0
    browns = ['#4a3624', '#5a4028', '#3a2a1c', '#6a4c30', '#2e2418', '#5e5034', '#4e4630']
    for i in range(2400):
        r = (rnd.random() ** 0.6) * 0.5
        a = rnd.uniform(0, TAU)
        q = Vector((r * math.cos(a) * W, r * math.sin(a) * H, 0))
        keep = 1.0 - sstep(0.32, 0.5, r + 0.08 * math.sin(a * 5 + 1.3))
        if rnd.random() > keep:
            continue
        z += 0.00005
        k = rnd.random()
        col = vary(hexcol(rnd.choice(browns)), rnd, 0.2, 0.06)
        ll = rnd.uniform(0.05, 0.09)
        if k < 0.45:
            leaf2d(tm, q, rnd.uniform(0, TAU), ll, ll * 0.55, col, rnd, shape='obovate', segs=8, fold=0.15,
                   lobes=4, lobe_depth=0.4, z=z, curl=rnd.uniform(-0.2, 0.3), midrib=tuple(x * 0.8 for x in col))
        elif k < 0.85:
            leaf2d(tm, q, rnd.uniform(0, TAU), ll * 0.9, ll * 0.55, col, rnd, shape='ellipse', segs=8, fold=0.15,
                   z=z, curl=rnd.uniform(-0.2, 0.3), midrib=tuple(x * 0.8 for x in col), veins=3)
        elif k < 0.97:
            for n_ in range(6):
                needle2d(tm, q + Vector((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), 0)),
                         rnd.uniform(0, TAU), 0.02, 0.0015, vary(hexcol('#6a4a2c'), rnd, 0.2), z=z)
        else:
            pts = path2d(q, rnd.uniform(0, TAU), rnd.uniform(0.08, 0.2), 3, rnd.uniform(-0.4, 0.4), rnd)
            twig(tm, pts, 0.006, 0.003, vary(hexcol('#4a3a2c'), rnd, 0.15), z=z)
    for i in range(3):
        q = Vector((rnd.uniform(-0.25, 0.25) * W, rnd.uniform(-0.25, 0.25) * H, 0))
        leaf2d(tm, q, rnd.uniform(0, TAU), 0.05, 0.03, hexcol('#5a3e26'), rnd, shape='ellipse', segs=6, fold=0.6,
               z=z + 0.002)


# --------------------------------------------------------------------------
# The three foliage atlases (2048^2 colour + 1024^2 normal each)

def make_atlases(size=2048):
    """Build (and render) the foliage atlases. Returns {name: Atlas}."""
    f = size / 2048
    S = lambda *r: tuple(int(v * f) for v in r)
    A = {}
    c = Atlas('nat_conifer', size, size, dilate=1)
    c.tile('spruce_a', S(0, 0, 512, 1024), 0.62, lambda tm, r, W, H: art_spruce(tm, r, W, H, 'spruce'), seed=11)
    c.tile('spruce_b', S(512, 0, 512, 1024), 0.62, lambda tm, r, W, H: art_spruce(tm, r, W, H, 'spruce'), seed=12)
    c.tile('fir_a', S(1024, 0, 512, 1024), 0.62, lambda tm, r, W, H: art_spruce(tm, r, W, H, 'fir'), seed=13)
    c.tile('fir_b', S(1536, 0, 512, 1024), 0.62, lambda tm, r, W, H: art_spruce(tm, r, W, H, 'fir'), seed=14)
    c.tile('pine_a', S(0, 1024, 512, 512), 0.75, art_pine_tuft, seed=15)
    c.tile('pine_b', S(512, 1024, 512, 512), 0.75, art_pine_tuft, seed=16)
    c.tile('dead', S(1024, 1024, 512, 512), 0.5, lambda tm, r, W, H: art_spruce(tm, r, W, H, 'dead'), seed=17)
    c.tile('pine_c', S(1536, 1024, 512, 512), 0.75, art_pine_tuft, seed=18)
    c.tile('spruce_c', S(0, 1536, 512, 512), 0.9, lambda tm, r, W, H: art_spruce_mass(tm, r, W, H, 'spruce'), seed=19)
    c.tile('fir_c', S(512, 1536, 512, 512), 0.9, lambda tm, r, W, H: art_spruce_mass(tm, r, W, H, 'fir'), seed=20)
    c.tile('spruce_d', S(1024, 1536, 512, 512), 0.62, lambda tm, r, W, H: art_spruce(tm, r, W, H * 2, 'spruce'), seed=21)
    c.tile('pine_d', S(1536, 1536, 512, 512), 0.75, art_pine_tuft, seed=22)
    A['nat_conifer'] = c

    b = Atlas('nat_leaf', size, size * 2)
    b.tile('oak_a', S(0, 0, 512, 512), 0.95, art_oak, seed=21)
    b.tile('oak_b', S(512, 0, 512, 512), 0.95, art_oak, seed=22)
    b.tile('beech_a', S(1024, 0, 512, 512), 0.85, art_beech, seed=23)
    b.tile('beech_b', S(1536, 0, 512, 512), 0.85, art_beech, seed=24)
    b.tile('birch_a', S(0, 512, 256, 768), 0.24, art_birch, pivot=(0.5, 1.0), seed=25)
    b.tile('birch_b', S(256, 512, 256, 768), 0.24, art_birch, pivot=(0.5, 1.0), seed=26)
    b.tile('hazel', S(512, 512, 512, 512), 0.55, art_hazel, seed=27)
    b.tile('hawthorn', S(1024, 512, 512, 512), 0.5, art_hawthorn, seed=28)
    b.tile('bramble', S(1536, 512, 512, 512), 0.5, art_bramble, seed=29)
    b.tile('ivy', S(512, 1024, 512, 512), 0.42, art_ivy, seed=30)
    b.tile('mass_a', S(1024, 1024, 512, 512), 0.55, art_leafmass, seed=31)
    b.tile('hazel_b', S(1536, 1024, 512, 512), 0.55, art_hazel, seed=32)
    b.tile('fern_l', S(0, 1536, 512, 512), 0.5, lambda tm, r, W, H: art_fern(tm, r, W * 0.9, H), seed=33)
    b.tile('hawthorn_b', S(512, 1536, 512, 512), 0.5, art_hawthorn, seed=34)
    b.tile('grass_l', S(1024, 1536, 512, 512), 0.6, lambda tm, r, W, H: art_grass(tm, r, W, H, dry=0.25, heads=3), seed=35)
    b.tile('bramble_b', S(1536, 1536, 512, 512), 0.5, art_bramble, seed=36)
    # v3: more variety for denser, layered crowns
    b.tile('oak_c', S(0, 2048, 512, 512), 1.0, art_oak, seed=37)
    b.tile('oak_d', S(512, 2048, 512, 512), 0.9, lambda tm, r, W, H: art_mass(tm, r, W, H, 'oak'), seed=38)
    b.tile('beech_c', S(1024, 2048, 512, 512), 0.85, art_beech, seed=39)
    b.tile('beech_d', S(1536, 2048, 512, 512), 0.9, lambda tm, r, W, H: art_mass(tm, r, W, H, 'beech'), seed=40)
    b.tile('birch_c', S(0, 2560, 256, 768), 0.24, art_birch, pivot=(0.5, 1.0), seed=41)
    b.tile('ivy_b', S(256, 2560, 256, 1536), 0.5, art_ivy_climb, seed=42)
    b.tile('mass_b', S(512, 2560, 512, 512), 0.6, lambda tm, r, W, H: art_mass(tm, r, W, H, 'beech', dark=0.6), seed=43)
    b.tile('oak_e', S(1024, 2560, 512, 512), 1.0, art_oak, seed=44)
    b.tile('beech_e', S(1536, 2560, 512, 512), 0.85, art_beech, seed=45)
    b.tile('shrub_c', S(512, 3072, 512, 512), 0.55, art_hazel, seed=46)
    b.tile('oak_big', S(1024, 3072, 1024, 1024), 2.0, art_oak_big, seed=47)
    b.tile('birch_d', S(0, 3328, 256, 768), 0.24, art_birch, pivot=(0.5, 1.0), seed=48)
    b.tile('beech_f', S(512, 3584, 512, 512), 1.0, art_beech, seed=49)
    A['nat_leaf'] = b

    g = Atlas('nat_ground', size, size)
    g.tile('grass_a', S(0, 0, 512, 512), 0.6, lambda tm, r, W, H: art_grass(tm, r, W, H, dry=0.12, heads=2), seed=41)
    g.tile('grass_b', S(512, 0, 512, 512), 0.6, lambda tm, r, W, H: art_grass(tm, r, W, H, dry=0.35, heads=4), seed=42)
    g.tile('grass_tall', S(1024, 0, 512, 1024), 0.6, lambda tm, r, W, H: art_grass(tm, r, W, H, 0.25, True, 9), seed=43)
    g.tile('reeds_a', S(1536, 0, 256, 1024), 0.36, art_reeds, seed=44)
    g.tile('reeds_b', S(1792, 0, 256, 1024), 0.36, lambda tm, r, W, H: art_reeds(tm, r, W, H, mace=False), seed=45)
    g.tile('fern_a', S(0, 512, 256, 512), 0.4, art_fern, seed=46)
    g.tile('fern_b', S(256, 512, 256, 512), 0.4, art_fern, seed=47)
    g.tile('nettle', S(512, 512, 256, 512), 0.36, art_nettle, seed=48)
    g.tile('dock', S(768, 512, 256, 512), 0.4, art_dock, seed=49)
    g.tile('thistle', S(0, 1024, 256, 512), 0.36, art_thistle, seed=50)
    g.tile('nettle_b', S(256, 1024, 256, 512), 0.36, art_nettle, seed=51)
    g.tile('ivy_ground', S(512, 1024, 512, 512), 0.7, art_ivy_ground, pivot=(0.5, 0.5), seed=52)
    g.tile('litter', S(1024, 1024, 1024, 1024), 2.0, art_litter, pivot=(0.5, 0.5), seed=53)
    g.tile('grass_c', S(0, 1536, 512, 512), 0.6, lambda tm, r, W, H: art_grass(tm, r, W, H, dry=0.65, heads=6), seed=54)
    g.tile('fern_c', S(512, 1536, 256, 512), 0.4, art_fern, seed=55)
    g.tile('dock_b', S(768, 1536, 256, 512), 0.4, art_dock, seed=56)
    A['nat_ground'] = g
    for a in A.values():
        a.render()
    return A



# ==========================================================================
# v2 surfaces registered at runtime (palette keys + recipes for bake.py)

BARKS = {
    # key: (kind, dark, light, scale)
    'bark_spruce': ('scaly', '#3a2a22', '#7a5e4c', 1.0),
    'bark_fir': ('smooth', '#36332e', '#5e5a54', 1.0),
    'bark_scots': ('scots', '#2e2620', '#6e5848', 1.0),
    'bark_beech': ('smooth', '#46463f', '#6c6c64', 1.0),
    'bark_birch2': ('birch', '#1c1a18', '#c8c4b8', 1.0),
    'bark_cane': ('cane', '#3a2228', '#6a4a40', 1.0),
}


WEATHER_DIR = (-0.6, -0.8, 0.0)       # the wet side of every trunk (moss, algae)


def bark_moss(S, alb, h, rough, top=4.5, amount=1.0):
    """Moss and green algae on the weather side of a stem, thickest low down,
    plus a mossy collar round the root flare."""
    g = S.g
    side = g.vmath('DOT_PRODUCT', S.N, WEATHER_DIR, out=1)
    m = g.mul(g.smooth(side, 0.05, 0.7), g.smooth(S.Z, top, 0.3))
    m = g.maximum(m, g.mul(g.smooth(S.Z, 0.45, 0.05), 0.45))
    m = g.mul(m, g.smooth(g.add(S.n(2.6, 5, 0.65), g.mul(m, 0.25)), 0.56, 0.66))
    m = g.mul(m, amount)
    mc = g.mix(S.n(28.0, 3, 0.6), S.col('#26331a'), S.col('#56662c'))
    mc = g.mix(g.smooth(S.n(6.0), 0.6, 0.7), mc, S.col('#6e7a3a'))
    alb = g.mix(m, alb, mc)
    h = g.add(h, g.mul(m, g.mul(S.n(60.0, 3, 0.6), 0.35)))
    rough = g.mixf(m, rough, 0.98)
    return alb, h, rough


def _mossy(S, d, top=4.5, amount=1.0):
    d['albedo'], d['height'], d['rough'] = bark_moss(S, d['albedo'], d['height'], d['rough'], top, amount)
    return d


def r_bark_v2(S, key):
    d = _r_bark_v2(S, key)
    if BARKS[key][0] in ('cane',):
        return d
    return _mossy(S, d, amount=0.6 if BARKS[key][0] == 'birch' else 1.0)


def _r_bark_v2(S, key):
    """Bark by kind: 'scaly' (spruce: small flaking scales), 'smooth' (beech,
    silver fir: smooth grey skin, dark blotches, lichen), 'scots' (Scots pine:
    deep grey-brown plates low down, thin orange flakes above ~6 m), 'cane'
    (bramble: smooth reddish bloom)."""
    import surfaces
    g = S.g
    kind, dark, light, sc = BARKS[key]
    if kind == 'scaly':
        uv = g.vadd(g.vscale(S.UV, (18.0, 7.5, 1.0)), (S.seed * 0.3, 0.0, 0.0))
        warp = g.vscale(g.combine(S.uvn(6.0), S.uvn(7.4), 0.0), (0.7, 0.7, 0.0))
        uv = g.vadd(uv, warp)
        ed = g.voronoi_edge(uv, 1.0, rand=0.9, dims='2D')
        cid = g.voronoi(uv, 1.0, out='Color', rand=0.9, dims='2D')
        crack = g.smooth(ed, 0.12, 0.0)
        alb = g.mix(g.sep(cid)[0], S.col(dark), S.col(light))
        alb = S.tint(alb, S.n(40.0, 4, 0.6), 0.75, 1.15)
        alb = S.tint(alb, S.n(2.0, 3, 0.5), 0.8, 1.1)
        alb = g.mix(crack, alb, S.col('#140f0b'))
        lichen = g.mul(g.smooth(S.n(4.0, 6, 0.7), 0.66, 0.72), 0.8)
        alb = g.mix(lichen, alb, S.col('#7e866a'))
        h = g.add(g.mul(g.smooth(ed, 0.0, 0.2), 0.8), g.mul(S.n(30.0), 0.2))
        return dict(albedo=alb, rough=0.92, metal=0.0, height=h, bump=1.0, dist=0.012)
    if kind == 'smooth':
        alb = S.tint(S.col(light), S.n(1.6, 5, 0.6), 0.72, 1.12)
        alb = S.tint(alb, S.n(14.0, 3, 0.6), 0.9, 1.06)
        blot = g.smooth(S.n(3.2, 5, 0.7), 0.6, 0.72)
        alb = g.mix(g.mul(blot, 0.75), alb, S.col(dark))
        bands = g.smooth(S.n(28.0, 2, 0.5, vec=S.UV, stretch=(0.15, 4.0, 1.0)), 0.7, 0.8)
        alb = g.mix(g.mul(bands, 0.5), alb, S.col('#3a3832'))
        lichen = g.smooth(S.n(3.0, 6, 0.7), 0.6, 0.66)
        alb = g.mix(g.mul(lichen, 0.85), alb, g.mix(S.n(20.0), S.col('#8c947a'), S.col('#a6aa94')))
        green = g.mul(g.smooth(S.n(2.0, 4, 0.6), 0.55, 0.7), g.smooth(S.Z, 3.0, 0.2))
        alb = g.mix(g.mul(green, 0.7), alb, S.col('#3e4a26'))
        h = g.add(g.mul(S.n(6.0, 4, 0.6), 0.3), g.mul(lichen, 0.3))
        return dict(albedo=alb, rough=0.78, metal=0.0, height=h, bump=0.35, dist=0.008)
    if kind == 'birch':
        # white papery bark, black horizontal lenticels and scars, dark rough
        # fissured bark creeping up from the base
        alb = S.tint(S.col(light), S.n(2.0, 4, 0.6), 0.82, 1.06)
        lent = g.smooth(S.n(14.0, 3, 0.6, vec=S.UV, stretch=(0.35, 7.0, 1.0)), 0.64, 0.7)
        alb = g.mix(g.mul(lent, 0.9), alb, S.col(dark))
        scar = g.smooth(S.n(3.0, 4, 0.6, vec=S.UV, stretch=(0.6, 3.0, 1.0)), 0.7, 0.76)
        alb = g.mix(g.mul(scar, 0.85), alb, S.col('#2a2622'))
        base_h = g.add(1.2, g.mul(S.n(1.5, 3, 0.5), 1.4))
        low = g.smooth(S.Z, base_h, g.sub(base_h, 0.6))
        plates = fissures(S, 5.0, (1.0, 0.3, 1.0), width=0.06)
        lowc = g.mix(plates, S.col('#121110'), S.col('#5e5a52'))
        alb = g.mix(low, alb, lowc)
        h = g.mixf(low, g.sub(0.6, g.mul(lent, 0.3)), plates)
        return dict(albedo=alb, rough=0.75, metal=0.0, height=h, bump=0.6, dist=0.01)
    if kind == 'cane':
        alb = g.mix(S.n(4.0, 3, 0.5), S.col(dark), S.col(light))
        alb = g.mix(g.smooth(S.n(2.0), 0.5, 0.7), alb, S.col('#3a4a26'))
        return dict(albedo=alb, rough=0.6, metal=0.0, height=S.n(40.0), bump=0.2, dist=0.004)
    # scots: plated below, orange flakes above
    plates = fissures(S, 4.0, (1.0, 0.25, 1.0), width=0.05)
    low = g.mix(plates, S.col('#16110d'), S.col('#6e5e52'))
    low = S.tint(low, S.n(25.0), 0.85, 1.12)
    flk_uv = g.vscale(S.UV, (14.0, 6.0, 1.0))
    fed = g.voronoi_edge(flk_uv, 1.0, rand=1.0, dims='2D')
    fid = g.voronoi(flk_uv, 1.0, out='Color', rand=1.0, dims='2D')
    high = g.mix(g.sep(fid)[0], S.col('#6e4430'), S.col('#9a6040'))
    high = g.mix(g.smooth(fed, 0.06, 0.0), high, S.col('#5a3a26'))
    up = g.smooth(g.add(S.Z, g.mul(S.n(0.6, 3, 0.5), 2.0)), 8.0, 11.0)
    alb = g.mix(up, low, high)
    h = g.mixf(up, g.add(g.mul(plates, 0.8), g.mul(S.n(30.0), 0.2)), g.add(g.mul(g.smooth(fed, 0.0, 0.15), 0.5), 0.3))
    return dict(albedo=alb, rough=0.9, metal=0.0, height=h, bump=1.1, dist=0.02)


def fissures(S, scale, stretch, width=0.045, cross_scale=13.0):
    """Bark ridges: 1 on the plates, 0 in narrow fissures along the noise
    zero-crossings (two scales, joined), broken by horizontal cracks."""
    g = S.g
    n1 = S.n(scale, 4, 0.55, vec=S.UV, stretch=stretch)
    n2 = S.n(scale * 1.9, 3, 0.5, vec=S.UV, stretch=stretch)
    f1 = g.smooth(g.absolute(g.sub(n1, 0.5)), 0.0, width)
    f2 = g.smooth(g.absolute(g.sub(n2, 0.5)), 0.0, width * 0.7)
    crk = g.smooth(g.absolute(g.sub(S.n(cross_scale, 2, 0.5, vec=S.UV, stretch=(0.5, 2.6, 1.0)), 0.5)), 0.0, 0.03)
    return g.mul(g.mul(f1, g.maximum(f2, 0.35)), g.maximum(crk, 0.25))


def r_bark_plated(S, key):
    """Oak-type bark: long grey ridges broken by horizontal cracks, deep dark
    furrows, grey-green lichen on the ridges (u around, v along the stem).
    Replaces the library's bark_oak/deadwood for this set only."""
    g = S.g
    dead = key == 'deadwood'
    ridge = fissures(S, 4.5, (1.0, 0.15, 1.0))
    if dead:
        dark, light = S.col('#3a342c'), S.col('#9a9284')
    else:
        dark, light = S.col('#181512'), S.col('#7e786c')
    alb = g.mix(ridge, dark, light)
    alb = S.tint(alb, S.n(30.0, 4, 0.6), 0.8, 1.15)
    alb = S.tint(alb, S.n(1.5, 3, 0.5), 0.82, 1.1)
    lich = g.mul(g.smooth(S.n(4.5, 6, 0.7), 0.6, 0.66), ridge)
    alb = g.mix(g.mul(lich, 0.8), alb, g.mix(S.n(25.0), S.col('#7c8468'), S.col('#a4a890')))
    if dead:
        grain = g.smooth(S.n(30.0, 3, 0.5, vec=S.UV, stretch=(1.0, 0.05, 1.0)), 0.4, 0.7)
        alb = S.tint(alb, grain, 0.85, 1.1)
    h = g.add(g.mul(ridge, 0.85), g.mul(S.n(40.0), 0.15))
    return _mossy(S, dict(albedo=alb, rough=0.95, metal=0.0, height=h, bump=1.5, dist=0.035),
                  amount=0.7 if dead else 1.0)


def r_wood_end(S, key):
    """Cut or broken end grain: growth rings about the UV origin (the faces
    are mapped in metres around the pith), darker heartwood, radial checks,
    weathered grey, a little green algae."""
    g = S.g
    uv = g.combine(S.U, S.V, 0.0)
    warp = g.vscale(g.combine(S.uvn(6.0), S.uvn(7.0), 0.0), (0.012, 0.012, 0.0))
    rings = g.wave(g.vadd(uv, warp), 22.0, kind='RINGS', distortion=2.0, detail=2.0)
    r = g.vmath('LENGTH', uv, out=1)
    heart = g.smooth(r, 0.16, 0.07)
    wood = g.mix(rings, S.col('#9a7a50'), S.col('#c4a678'))
    wood = g.mix(g.mul(heart, 0.6), wood, S.col('#6a4a2c'))
    ang = g.math('ARCTAN2', S.V, S.U)
    check = g.smooth(g.noise(g.combine(g.mul(ang, 3.0), g.mul(r, 2.0), 0.0), 3.0, detail=2), 0.75, 0.8)
    wood = g.mix(g.mul(check, 0.8), wood, S.col('#2a1e14'))
    grey = g.smooth(S.n(2.0, 4, 0.6), 0.35, 0.65)
    wood = g.mix(g.mul(grey, 0.55), wood, S.col('#8a8478'))
    algae = g.smooth(S.n(5.0, 4, 0.6), 0.65, 0.75)
    wood = g.mix(g.mul(algae, 0.5), wood, S.col('#4a5a2a'))
    h = g.sub(g.add(0.6, g.mul(rings, 0.15)), g.mul(check, 0.4))
    return dict(albedo=wood, rough=0.9, metal=0.0, height=h, bump=0.8, dist=0.006)


def r_mushroom(S, key):
    """Brown-capped mushrooms: caps (up-facing) brown with a paler rim and
    spots, stems and gills cream."""
    g = S.g
    cap = g.mix(S.n(14.0, 3, 0.6), S.col('#5a3a22'), S.col('#8a6036'))
    cap = g.mix(g.smooth(S.n(30.0), 0.6, 0.7), cap, S.col('#b08a5a'))
    stem = S.tint(S.col('#d0c4a6'), S.n(20.0), 0.85, 1.05)
    capmask = g.smooth(S.up, 0.15, 0.45)
    alb = g.mix(capmask, stem, cap)
    return dict(albedo=alb, rough=g.mixf(capmask, 0.7, 0.45), metal=0.0, height=S.n(50.0), bump=0.2, dist=0.002)


def r_granite(S, key):
    """Sculpted granite for boulders and outcrops: crystal grain, joint
    cracks, weathering pits and grooves, grey-green lichen crusts, dark
    rain tracks; moss comes from the shared weathering."""
    g = S.g
    base = S.col('#6a675f') if key == 'granite' else S.col('#4e4c47')
    alb = S.tint(base, S.n(1.5, 5, 0.6), 0.72, 1.18)
    xtal = g.voronoi(S.P, 140.0, out='Color', rand=1.0)
    alb = S.tint(alb, g.sep(xtal)[0], 0.78, 1.2)
    feld = g.smooth(g.voronoi(S.P, 60.0, out='Distance', rand=1.0), 0.12, 0.02)
    alb = g.mix(g.mul(feld, 0.35), alb, S.col('#b4aea2'))
    crk = g.smooth(g.voronoi_edge(g.vadd(S.P, g.vscale(g.combine(S.n(1.0), S.n(1.3), S.n(1.6)), 0.3)), 0.45,
                                  rand=1.0), 0.012, 0.0)
    crk = g.mul(crk, g.smooth(S.n(0.8, 3, 0.5), 0.5, 0.62))          # only some joints open
    alb = g.mix(g.mul(crk, 0.7), alb, S.col('#2a2723'))
    pits = g.smooth(S.n(12.0, 5, 0.7), 0.66, 0.76)
    alb = g.mix(g.mul(pits, 0.4), alb, S.col('#3a3632'))
    lich = g.smooth(S.n(4.0, 6, 0.72), 0.62, 0.66)
    lc = g.mix(S.n(40.0), S.col('#9ea08a'), S.col('#c2c2a8'))
    alb = g.mix(g.mul(lich, 0.75), alb, lc)
    tracks = g.mul(g.smooth(S.n(2.5, 3, 0.5, stretch=(6, 6, 0.3)), 0.55, 0.72), g.smooth(g.absolute(S.up), 0.7, 0.2))
    alb = g.mix(g.mul(tracks, 0.5), alb, S.col('#2e2c28'))
    h = g.add(g.mul(S.n(3.0, 6, 0.65), 0.45), g.mul(S.n(25.0, 4, 0.6), 0.15))
    h = g.sub(h, g.add(g.mul(crk, 0.5), g.mul(pits, 0.2)))
    h = g.add(h, g.mul(lich, 0.06))
    rough = g.mixf(lich, g.map_range(S.n(20.0), 0, 1, 0.68, 0.9), 0.95)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=1.2, dist=0.03)


def r_bank(S, key):
    """Bocage bank: earth showing between matted grass, leaf litter and moss,
    roots, a few stones; greener on top, barer on the steep sides."""
    g = S.g
    soil = g.mix(S.n(5.0, 5, 0.6), S.col('#2e241a'), S.col('#4e3c2a'))
    stones = g.smooth(g.voronoi(S.P, 18.0, rand=1.0), 0.1, 0.04)
    soil = g.mix(g.mul(stones, 0.6), soil, S.col('#6a6458'))
    blades = S.n(60.0, 3, 0.6, stretch=(1.0, 1.0, 0.12))
    grass = g.mix(blades, S.col('#2c3a1a'), S.col('#5a6a2e'))
    grass = g.mix(g.smooth(S.n(3.0), 0.6, 0.75), grass, S.col('#7a6a3a'))
    cover = g.smooth(g.add(g.mul(S.up, 0.9), g.mul(S.n(2.5, 4, 0.6), 0.6)), 0.55, 0.85)
    alb = g.mix(cover, soil, grass)
    litter = g.mul(g.smooth(S.n(4.0, 5, 0.6), 0.6, 0.7), g.one_minus(cover))
    alb = g.mix(g.mul(litter, 0.7), alb, g.mix(S.n(30.0), S.col('#3a2a1a'), S.col('#6a4a2a')))
    h = g.add(g.mul(blades, g.mul(cover, 0.5)), g.mul(S.n(8.0), 0.3))
    return dict(albedo=alb, rough=0.93, metal=0.0, height=h, bump=0.8, dist=0.02)


def r_core(S, key):
    """Inside of a hedge or bush: deep shade, twigs and dead leaves."""
    g = S.g
    alb = g.mix(S.n(8.0, 5, 0.65), S.col('#0e120a'), S.col('#26301a'))
    alb = g.mix(g.smooth(S.n(3.0), 0.6, 0.75), alb, S.col('#2a2216'))
    return dict(albedo=alb, rough=0.95, metal=0.0, height=S.n(20.0), bump=0.4, dist=0.01)


def register_surfaces():
    import surfaces
    surfaces.RECIPES['bark_oak'] = r_bark_plated        # this process only (higher contrast)
    surfaces.RECIPES['deadwood'] = r_bark_plated
    kit.PALETTE.setdefault('core', ('#1a2012', 0.95, 0.0))
    surfaces.RECIPES['core'] = r_core
    surfaces.PROFILE['core'] = 'none'
    kit.PALETTE.setdefault('bank', ('#4a4a2e', 0.93, 0.0))
    surfaces.RECIPES['bank'] = r_bank
    surfaces.PROFILE['bank'] = 'nature'
    for k in BARKS:
        kit.PALETTE.setdefault(k, (BARKS[k][2], 0.9, 0.0))
        surfaces.RECIPES[k] = r_bark_v2
        surfaces.PROFILE[k] = 'nature'
    kit.PALETTE.setdefault('wood_end', ('#a08860', 0.9, 0.0))
    surfaces.RECIPES['wood_end'] = r_wood_end
    surfaces.PROFILE['wood_end'] = 'nature'
    kit.PALETTE.setdefault('mushroom', ('#7a5a3a', 0.6, 0.0))
    surfaces.RECIPES['mushroom'] = r_mushroom
    surfaces.PROFILE['mushroom'] = 'none'
    for k in ('granite', 'granite_dark'):
        kit.PALETTE.setdefault(k, ('#7e7a72', 0.85, 0.0))
        surfaces.RECIPES[k] = r_granite
        surfaces.PROFILE[k] = 'nature'


# ==========================================================================
# v2: impostor LODs — the finished tree rendered orthographically from three
# directions into an RGBA atlas (albedo x occlusion, and a tangent-space
# normal of the crown), mapped onto three crossed vertical planes.

class Impostors:
    def __init__(self, name='nat_impostor', size=2048, samples=24, height=None):
        self.name, self.size, self.samples = name, size, samples
        self.height = height or size
        self.col = np.zeros((self.height, size, 4), np.float32)
        self.nrm = np.zeros((self.height, size, 4), np.float32)
        self.shelf = [0, 0, 0]          # x, y, row height (pixels, top-left origin)
        self.entries = {}
        self.material = None

    def _alloc(self, w, h):
        x, y, rh = self.shelf
        if x + w > self.size:
            x, y, rh = 0, y + rh, 0
        if y + h > self.height:
            raise RuntimeError('impostor atlas full')
        self.shelf = [x + w, y, max(rh, h)]
        return x, y

    def _override(self, obj, mode, T, B, Nv):
        from bake import Graph
        originals = [s.material for s in obj.material_slots]
        made = []
        for slot in obj.material_slots:
            src = slot.material
            mat = bpy.data.materials.new('imp_tmp')
            g = Graph(mat)
            img, card = None, bool(src and src.get('card'))
            if src and src.use_nodes:
                bsdf = next((n for n in src.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
                if bsdf and bsdf.inputs['Base Color'].links:
                    nd = bsdf.inputs['Base Color'].links[0].from_node
                    if nd.bl_idname == 'ShaderNodeTexImage':
                        img = nd.image
            tex = None
            if img is not None:
                tex = g.node('ShaderNodeTexImage', image=img, interpolation='Linear')
                g.nt.links.new(g.uvmap('UVMap'), tex.inputs['Vector'])
            if mode == 'color':
                c = tex.outputs['Color'] if tex else (0.3, 0.3, 0.3)
                c = g.mix(1.0, c, g.attribute('Color', 'Color'), blend='MULTIPLY')
                em = g.node('ShaderNodeEmission')
                g.feed(em.inputs['Color'], c)
            else:
                n = g.geometry('Normal')
                x = g.vmath('DOT_PRODUCT', n, tuple(T), out=1)
                y = g.vmath('DOT_PRODUCT', n, tuple(B), out=1)
                z = g.absolute(g.vmath('DOT_PRODUCT', n, tuple(Nv), out=1))
                em = g.node('ShaderNodeEmission')
                g.feed(em.inputs['Color'], g.combine(g.madd(x, 0.5, 0.5), g.madd(y, 0.5, 0.5), g.madd(z, 0.5, 0.5)))
            out = g.output
            if card and tex is not None:
                tr = g.node('ShaderNodeBsdfTransparent')
                mx = g.node('ShaderNodeMixShader')
                g.nt.links.new(g.math('GREATER_THAN', tex.outputs['Alpha'], 0.5), mx.inputs[0])
                g.nt.links.new(tr.outputs[0], mx.inputs[1])
                g.nt.links.new(em.outputs[0], mx.inputs[2])
                g.nt.links.new(mx.outputs[0], out.inputs['Surface'])
            else:
                g.nt.links.new(em.outputs[0], out.inputs['Surface'])
            slot.material = mat
            made.append(mat)

        def restore():
            for s_, m_ in zip(obj.material_slots, originals):
                s_.material = m_
            for m_ in made:
                bpy.data.materials.remove(m_)
        return restore

    def _render(self, obj, mode, cam_loc, cam_rot, ortho, w, h, T, B, Nv):
        scene = bpy.context.scene
        objs = obj if isinstance(obj, (list, tuple)) else [obj]
        reps, seen = [], set()
        for o in objs:                     # one override per shared mesh
            if o.data.name not in seen:
                seen.add(o.data.name)
                reps.append(o)
        restores = [self._override(o, mode, T, B, Nv) for o in reps]
        name = objs[0].name
        cam_data = bpy.data.cameras.new('imp_cam')
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = ortho
        cam_data.clip_end = 500
        cam = kit.link(bpy.data.objects.new('imp_cam', cam_data))
        cam.location = cam_loc
        cam.rotation_euler = cam_rot
        keep = dict(camera=scene.camera, rx=scene.render.resolution_x, ry=scene.render.resolution_y,
                    film=scene.render.film_transparent, vt=scene.view_settings.view_transform,
                    look=scene.view_settings.look, samples=scene.cycles.samples,
                    tb=scene.cycles.transparent_max_bounces, fp=scene.render.filepath,
                    mode=scene.render.image_settings.color_mode, world=scene.world)
        hidden = []
        shown = set(objs)
        for o in scene.objects:
            if o.type == 'MESH' and o not in shown and not o.hide_render:
                o.hide_render = True
                hidden.append(o)
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.view_settings.view_transform = 'Standard' if mode == 'color' else 'Raw'
        scene.view_settings.look = 'None'
        scene.cycles.samples = self.samples
        scene.cycles.transparent_max_bounces = 64
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        path = os.path.join(V2_TMP, f'hedgerow_imp_{name}_{mode}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        scene.camera = keep['camera']
        scene.render.resolution_x, scene.render.resolution_y = keep['rx'], keep['ry']
        scene.render.film_transparent = keep['film']
        scene.view_settings.view_transform = keep['vt']
        scene.view_settings.look = keep['look']
        scene.cycles.samples = keep['samples']
        scene.cycles.transparent_max_bounces = keep['tb']
        scene.render.filepath = keep['fp']
        scene.render.image_settings.color_mode = keep['mode']
        for o in hidden:
            o.hide_render = False
        kit.delete(cam)
        bpy.data.cameras.remove(cam_data)
        for r_ in reversed(restores):
            r_()
        import bake
        img = bpy.data.images.load(path)
        a = bake.pixels(img).copy()
        bpy.data.images.remove(img)
        return a

    def add(self, obj, views=3, tile=None):
        """Render `obj` (at the origin) from `views` horizontal directions;
        returns the per-view plane data for lod_mesh()."""
        mn, mx = kit.bounds(obj)
        top = mx.z
        out = []
        for i in range(views):
            az = math.pi * i / views                 # 0, 60, 120 degrees
            v = Vector((math.sin(az), math.cos(az), 0.0))      # view direction
            T = v.cross(UP).normalized()                        # right
            pts = [obj.matrix_world @ vv.co for vv in obj.data.vertices]
            xs = [p.dot(T) for p in pts]
            x0, x1 = min(xs) - 0.05, max(xs) + 0.05
            z0, z1 = min(0.0, mn.z), top + 0.05
            wm, hm = x1 - x0, z1 - z0
            if tile is None:
                tw, th = (256, 512) if hm / wm > 1.4 else (512, 512)
            else:
                tw, th = tile
            f = self.size / 2048
            tw, th = int(tw * f), int(th * f)
            # expand the box to the tile aspect, centred
            if wm / hm < tw / th:
                c = (x0 + x1) / 2
                wm = hm * tw / th
                x0, x1 = c - wm / 2, c + wm / 2
            else:
                c = (z0 + z1) / 2
                hm = wm * th / tw
                z0, z1 = max(z0 - 0.0, c - hm / 2), c + hm / 2
                if z0 > min(0.0, mn.z):
                    z0 = min(0.0, mn.z)
                    z1 = z0 + hm
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            cam_loc = T * cx + UP * cz - v * 200.0
            cam_rot = (v).to_track_quat('-Z', 'Y').to_euler()
            ortho = max(wm, hm)
            res = []
            for mode in ('color', 'normal'):
                res.append(self._render(obj, mode, cam_loc, cam_rot, ortho, tw, th, T, UP, -v))
            col, nrm = res
            px, py = self._alloc(tw, th)
            # rendered images are bottom-up rows; the atlas array is too (Blender pixels)
            Y = self.height - py - th
            self.col[Y:Y + th, px:px + tw] = col
            self.nrm[Y:Y + th, px:px + tw] = nrm
            out.append(dict(T=T, v=v, x0=x0, x1=x1, z0=z0, z1=z1, rect=(px, py, tw, th)))
        self.entries[obj.name] = out
        return out

    def add_group(self, objs, key, x0, x1, z0, z1, tile, ppm=1.5, depth=0.0):
        """Render a group of objects seen from -Y (looking +Y) over the
        window x0..x1, z0..z1 at `ppm` pixels per metre, resampled into a
        tile of `tile` (w, h) pixels; the result is one front-facing plane
        at y = depth (for lod_mesh / far layers)."""
        v = Vector((0.0, 1.0, 0.0))
        T = v.cross(UP).normalized()          # +X
        wm, hm = x1 - x0, z1 - z0
        f0 = self.size / 2048
        rw, rh = int(round(tile[0] * f0 * ppm)), int(round(tile[1] * f0 * ppm))   # ppm = supersampling here
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        cam_loc = Vector((cx, -300.0, cz))
        cam_rot = v.to_track_quat('-Z', 'Y').to_euler()
        f = self.size / 2048
        tw, th = int(tile[0] * f), int(tile[1] * f)
        res = []
        for mode in ('color', 'normal'):
            a = self._render(list(objs), mode, cam_loc, cam_rot, max(wm, hm), rw, rh, T, UP, -v)
            res.append(_resample(a, tw, th))
        px, py = self._alloc(tw, th)
        Y = self.height - py - th
        self.col[Y:Y + th, px:px + tw] = res[0]
        self.nrm[Y:Y + th, px:px + tw] = res[1]
        e = dict(T=-T if False else T, v=v, x0=x0 - 0.0, x1=x1, z0=z0, z1=z1, rect=(px, py, tw, th), depth=depth)
        self.entries.setdefault(key, []).append(e)
        return e

    def finish(self):
        import bake
        col, nrm = self.col, self.nrm
        a = col[..., 3:4]
        rgb = fill_under_alpha(col[..., :3], a[..., 0])
        cimg = bpy.data.images.new(self.name + '_color', self.size, self.height, alpha=True)
        cimg.alpha_mode = 'STRAIGHT'
        bake.set_pixels(cimg, np.concatenate([rgb, a], 2))
        na = nrm[..., 3:4]
        w = np.clip(na / 0.25, 0.0, 1.0)             # straight alpha: keep thin edges' normals
        nv = nrm[..., :3] * w + np.array([0.5, 0.5, 1.0], np.float32) * (1 - w)
        d = 2
        h2, w2 = self.height // d, self.size // d
        nv = nv.reshape(h2, d, w2, d, 3).mean(axis=(1, 3))
        vv = nv * 2 - 1
        vv /= np.maximum(np.linalg.norm(vv, axis=2, keepdims=True), 1e-6)
        nv = vv * 0.5 + 0.5
        nimg = bpy.data.images.new(self.name + '_normal', w2, h2, alpha=False)
        nimg.colorspace_settings.name = 'Non-Color'
        bake.set_pixels(nimg, np.concatenate([nv, np.ones(nv.shape[:2] + (1,), np.float32)], 2))
        self.material = card_material(self.name, cimg, nimg, rough=0.75)
        self.color, self.normal = cimg, nimg
        return self.material

    def lod_mesh(self, name, ao=1.0):
        """Three crossed planes for the tree `name` (after finish())."""
        m = Mesh([self.material])
        for e in self.entries[name]:
            T, v = e['T'], e['v']
            px, py, tw, th = e['rect']
            u0, u1 = px / self.size, (px + tw) / self.size
            v1, v0 = 1.0 - py / self.height, 1.0 - (py + th) / self.height
            off = e['v'] * e.get('depth', 0.0)
            q = [T * e['x0'] + UP * e['z0'] + off, T * e['x1'] + UP * e['z0'] + off,
                 T * e['x1'] + UP * e['z1'] + off, T * e['x0'] + UP * e['z1'] + off]
            nrm = (-v + UP * 0.35).normalized()           # facing the viewer, bent up a little
            ids = [m.v(p, ao, nrm) for p in q]
            m.f(ids, 0, ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), smooth=False)
        return m


def along3(pts, t):
    """Point and unit tangent at fraction t of a 3D polyline."""
    segs = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    tot = sum(segs) or 1e-6
    d = t * tot
    for i, L in enumerate(segs):
        if d <= L or i == len(segs) - 1:
            f = min(1.0, d / L) if L > 0 else 0.0
            return pts[i].lerp(pts[i + 1], f), (pts[i + 1] - pts[i]).normalized()
        d -= L
    return pts[-1], (pts[-1] - pts[-2]).normalized()


def perp(d, rnd, prefer=None):
    """A random unit vector perpendicular to d (biased towards `prefer`)."""
    d = Vector(d).normalized()
    a = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
    if prefer is not None:
        a = a * 0.6 + Vector(prefer) * 1.0
    a = a - d * a.dot(d)
    if a.length < 1e-4:
        a = basis(d)
    return a.normalized()


def preview_cards(objects):
    """For previews only (after export): card materials multiply their
    texture colour by the "Color" attribute, as three.js does with
    vertexColors."""
    cache = {}
    for obj in objects:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or not mat.get('card') or mat.get('_pv'):
                continue
            if mat.name not in cache:
                pv = mat.copy()
                pv['_pv'] = 1
                nt = pv.node_tree
                bsdf = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
                src = bsdf.inputs['Base Color'].links[0].from_socket
                attr = nt.nodes.new('ShaderNodeAttribute')
                attr.attribute_name = 'Color'
                mul = nt.nodes.new('ShaderNodeMix')
                mul.data_type = 'RGBA'
                mul.blend_type = 'MULTIPLY'
                _sock(mul.inputs, 'Factor_Float').default_value = 1.0
                nt.links.new(src, _sock(mul.inputs, 'A_Color'))
                nt.links.new(attr.outputs['Color'], _sock(mul.inputs, 'B_Color'))
                nt.links.new(_sock(mul.outputs, 'Result_Color'), bsdf.inputs['Base Color'])
                # leaves let light through: the game lights both card sides with the
                # crown normal; Cycles would leave back faces black without this
                out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
                tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
                nt.links.new(_sock(mul.outputs, 'Result_Color'), tr.inputs['Color'])
                mixs = nt.nodes.new('ShaderNodeMixShader')
                mixs.inputs[0].default_value = 0.4
                src_sh = out.inputs['Surface'].links[0].from_socket
                nt.links.new(src_sh, mixs.inputs[1])
                nt.links.new(tr.outputs[0], mixs.inputs[2])
                # keep the alpha cut: transparent where the texture is
                alpha_in = bsdf.inputs['Alpha'].links[0].from_socket if bsdf.inputs['Alpha'].links else None
                if alpha_in is not None:
                    tp = nt.nodes.new('ShaderNodeBsdfTransparent')
                    mx2 = nt.nodes.new('ShaderNodeMixShader')
                    nt.links.new(alpha_in, mx2.inputs[0])
                    nt.links.new(tp.outputs[0], mx2.inputs[1])
                    nt.links.new(mixs.outputs[0], mx2.inputs[2])
                    nt.links.new(mx2.outputs[0], out.inputs['Surface'])
                else:
                    nt.links.new(mixs.outputs[0], out.inputs['Surface'])
                cache[mat.name] = pv
            slot.material = cache[mat.name]


def preview(objects, path, size=768, samples=20, elevation=12, azimuth=-35, focus=None, dist=None, lens=50,
            cam=None, target=None, floor=40.0):
    """kit.preview with settings for alpha cards (transparent bounces,
    denoising); `cam`/`target` place the camera explicitly."""
    scene = bpy.context.scene
    scene.cycles.transparent_max_bounces = 64
    scene.cycles.max_bounces = 4
    try:
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    if cam is None:
        p = kit.preview(objects, path, size=size, samples=samples, elevation=elevation, azimuth=azimuth)
    else:
        p = _preview_at(objects, path, size, samples, cam, target, lens, floor)
    scene.cycles.use_denoising = False
    return p


def _preview_at(objects, path, size, samples, cam_pos, target, lens, floor=40.0):
    scene = bpy.context.scene
    keep = set(objects)
    hidden = []
    for o in scene.objects:
        if o.type == 'MESH' and o not in keep and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    cd = bpy.data.cameras.new('pv_cam')
    cd.lens = lens
    cd.clip_end = 2000.0
    cam = kit.link(bpy.data.objects.new('pv_cam', cd))
    cam.location = cam_pos
    cam.rotation_euler = (Vector(target) - Vector(cam_pos)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sd = bpy.data.lights.new('pv_sun', 'SUN')
    sd.energy = 3.0
    sd.angle = math.radians(8)
    sun = kit.link(bpy.data.objects.new('pv_sun', sd))
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-40))
    fl = kit.plane(floor * 2, floor * 2, loc=(target[0], target[1], -0.001), mat='dirt', name='pv_floor')
    world = bpy.data.worlds.get('preview') or bpy.data.worlds.new('preview')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.35, 0.38, 0.42, 1)
    bg.inputs['Strength'].default_value = 0.8
    scene.world = world
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.cycles.samples = samples
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    bpy.ops.render.render(write_still=True)
    kit.delete(cam)
    kit.delete(sun)
    kit.delete(fl)
    for o in hidden:
        o.hide_render = False
    kit.log('preview', os.path.relpath(path, kit.ROOT))
    return path



def sculpt(bm, size, seed, amp=0.035, detail=0.012, crack=0.018, cuts=3, smooth_passes=1, bottom=None):
    """Dense, weathered rock surface from a faceted hull: subdivide, round
    the chamfers a little, then push along the normal by large lumps,
    fine pitting and joint cracks (voronoi cell borders)."""
    S = max(size)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for _ in range(smooth_passes):
        bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True,
                              use_axis_z=True)
    bm.normal_update()
    o1, o2, o3 = noise_off(seed + 11), noise_off(seed + 12), noise_off(seed + 13)
    zmin = min(v.co.z for v in bm.verts)
    moves = []
    for v in bm.verts:
        p = v.co
        n = v.normal
        big = fbm(p * (1.3 / S) + o1, 3) * amp * S
        det = fbm(p * (6.0 / S) + o2, 3) * detail * S
        d, _pts = noise.voronoi(p * (1.8 / S) + o3, distance_metric='DISTANCE')
        edge = d[1] - d[0]
        cr = -crack * S * max(0.0, 1.0 - edge / 0.06) ** 2
        k = 1.0
        if bottom is not None and p.z < zmin + bottom:
            k = (p.z - zmin) / bottom
        moves.append(n * (big + det + cr) * k)
    for v, mv in zip(bm.verts, moves):
        v.co += mv
    bm.normal_update()
    return bm



def art_mass(tm, rnd, W, H, kind='oak', dark=0.75):
    """A dense, shadowed leaf mass for crown interiors: overlapping leaves of
    one species in deep greens (pivot bottom centre; fills most of the tile)."""
    c = Vector((0.0, H * 0.5, 0.0))
    R = min(W, H) * 0.47
    z = 0.0
    n = 260
    for i in range(n):
        r = R * math.sqrt(rnd.random())
        a = rnd.uniform(0, TAU)
        q = c + Vector((r * math.cos(a) * 1.05, r * math.sin(a), 0))
        base = rnd.choice(['#2a3e1a', '#34481e', '#3c5222'])
        col = tuple(x * dark * lerp(0.8, 1.15, r / R) for x in _leafcol(rnd, base, spread=0.18, hue=0.07))
        z += 0.0004
        ll = rnd.uniform(0.06, 0.1)
        if kind == 'oak':
            leaf2d(tm, q, rnd.uniform(0, TAU), ll, ll * 0.56, col, rnd, shape='obovate', segs=10, fold=0.3,
                   lobes=4.5, lobe_depth=0.42, z=z, midrib=mixc(col, hexcol('#8a9a58'), 0.25))
        else:
            leaf2d(tm, q, rnd.uniform(0, TAU), ll * 0.85, ll * 0.52, col, rnd, shape='ellipse', segs=10, fold=0.25,
                   wavy=0.03, z=z, midrib=mixc(col, hexcol('#8a9a58'), 0.25), veins=4)
    for k in range(5):                              # twigs showing through
        a = rnd.uniform(0, TAU)
        pts = path2d(c + Vector((math.cos(a), math.sin(a), 0)) * R * 0.2, a, R * rnd.uniform(0.5, 0.8), 3,
                     rnd.uniform(-0.4, 0.4), rnd)
        twig(tm, pts, 0.008, 0.004, hexcol('#3a2e24'), z=z * rnd.uniform(0.3, 0.9))


def art_oak_big(tm, rnd, W, H):
    """A big oak branch section (~2 m): a forked limb end with many shoots,
    leaf rosettes everywhere; used for large crowns and the far treeline."""
    wood = hexcol('#4a3b2c')
    main = path2d((0.0, 0.0), rnd.uniform(-0.1, 0.1), H * 0.7, 7, rnd.uniform(-0.3, 0.3), rnd)
    twig(tm, main, 0.03, 0.01, wood)
    shoots = [main]
    for i in range(7):
        t = 0.2 + 0.11 * i + rnd.uniform(-0.03, 0.03)
        p, a = along(main, t)
        side = 1 if i % 2 else -1
        sub = path2d(p, a + side * rnd.uniform(0.5, 0.9), H * rnd.uniform(0.25, 0.36) * (1.1 - 0.5 * t), 5,
                     -side * rnd.uniform(0.1, 0.4), rnd)
        twig(tm, sub, 0.016, 0.006, wood)
        shoots.append(sub)
        for j in range(2):
            q, b = along(sub, 0.4 + 0.3 * j)
            sd = 1 if (i + j) % 2 else -1
            sub2 = path2d(q, b + sd * rnd.uniform(0.5, 0.9), H * rnd.uniform(0.1, 0.16), 3, 0.0, rnd)
            twig(tm, sub2, 0.008, 0.004, wood)
            shoots.append(sub2)
    z = 0.0
    for sh in shoots:
        L = plen(sh)
        for k in range(int(L / 0.08)):
            q, b = along(sh, 0.2 + 0.7 * k / max(1, int(L / 0.08)))
            side = 1 if k % 2 else -1
            ll = rnd.uniform(0.07, 0.1)
            col = _leafcol(rnd, '#384d22', yellow=0.1)
            z += 0.0004
            leaf2d(tm, q, b + side * rnd.uniform(0.6, 1.1), ll, ll * 0.55, col, rnd, shape='obovate', segs=10,
                   fold=0.3, curl=0.1, lobes=4, lobe_depth=0.4, z=z, petiole=0.005)
    for sh in shoots:
        tip, ta = along(sh, 1.0)
        z = _oak_rosette(tm, tip, ta, rnd, z + 0.001, n=8)


def art_ivy_climb(tm, rnd, W, H):
    """Ivy climbing a trunk (pivot bottom centre): two wandering stems with
    rootlets, dense lobed leaves facing out, bigger at the bottom."""
    stem = hexcol('#4a3a2a')
    z = 0.0
    for s_ in range(2):
        x0 = (s_ - 0.5) * W * 0.3
        pts = [Vector((x0, 0.0, 0.0))]
        for i in range(24):
            pts.append(pts[-1] + Vector((rnd.uniform(-0.05, 0.05) - pts[-1].x * 0.15, H * 0.96 / 24, 0.0)))
        twig(tm, pts, 0.012, 0.005, stem)
        for k in range(int(H / 0.032)):
            t = k / int(H / 0.032)
            q, b = along(pts, t)
            side = 1 if k % 2 else -1
            a = b + side * rnd.uniform(0.5, 1.6)
            pet = q + dirang(a) * rnd.uniform(0.02, 0.05)
            z += 0.0003
            sz = rnd.uniform(0.04, 0.07) * lerp(1.15, 0.8, t)
            if abs(pet.x) > W * 0.47:
                continue
            ivy_leaf(tm, pet, a, sz, _leafcol(rnd, rnd.choice(['#1e321a', '#26381c', '#2e4220']), spread=0.18,
                                             hue=0.05), rnd, z)



# ==========================================================================
# _mid models: the full tree thinned for 22-55 m

TAG_TRUNK, TAG_ROOT, TAG_LIMB, TAG_BRANCH, TAG_TWIG = 1, 2, 3, 4, 5
TAG_NAMES = {0: 'other', 1: 'trunk', 2: 'root', 3: 'limb', 4: 'branch', 5: 'twig'}


def thin_groups(groups, frac, seed):
    """Blue-noise thinning: keep about `frac` of the cards (counted per group)
    spread evenly through the crown. groups: [(centre, ncards)]. Returns the
    kept group indices (sorted)."""
    total = sum(n for _, n in groups)
    target = frac * total
    order = list(range(len(groups)))
    random.Random(seed).shuffle(order)

    def run(d):
        cell = {}
        kept, cnt = [], 0
        d2 = d * d
        for gi in order:
            c, n = groups[gi]
            key = (int(math.floor(c.x / d)), int(math.floor(c.y / d)), int(math.floor(c.z / d)))
            ok = True
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for q in cell.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                            if (q - c).length_squared < d2:
                                ok = False
                                break
                        if not ok:
                            break
                    if not ok:
                        break
                if not ok:
                    break
            if ok:
                cell.setdefault(key, []).append(c)
                kept.append(gi)
                cnt += n
        return kept, cnt
    lo, hi = 0.01, 6.0
    best = None
    for _ in range(26):
        mid = (lo + hi) / 2
        kept, cnt = run(mid)
        if best is None or abs(cnt - target) < abs(best[1] - target):
            best = (kept, cnt)
        if cnt > target:
            lo = mid
        else:
            hi = mid
    return sorted(best[0])


def _swatch(full_obj, bark_slots, tagv):
    """Atlas UVs of one big trunk quad (2-6 m up): the bark the rebuilt
    _mid branches are mapped onto."""
    me = full_obj.data
    uvl = me.uv_layers['UVMap'].data
    best = None
    for poly in me.polygons:
        if poly.material_index not in bark_slots or tagv[poly.index] != TAG_TRUNK or len(poly.loop_indices) != 4:
            continue
        z = poly.center.z
        if not 2.0 < z < 6.0:
            continue
        if best is None or poly.area > best.area:
            best = poly
    if best is None:
        return ((0.0, 0.0), (0.01, 0.0), (0.01, 0.01), (0.0, 0.01))
    return tuple(tuple(uvl[li].uv) for li in best.loop_indices)


def _swatch_tube(out, pts, radii, sides, uvq, slot=0):
    """A plain tube along pts (radius 0 = a point), every face mapped onto
    the bark swatch uvq."""
    fr = frames(pts)
    rings = []
    for k, (p, (t, n, b)) in enumerate(zip(pts, fr)):
        r = radii[k]
        if r <= 1e-5:
            rings.append(out.v(p, 1.0))
            continue
        rings.append([out.v(p + (n * math.cos(TAU * i / sides) + b * math.sin(TAU * i / sides)) * r, 1.0)
                      for i in range(sides)])
    tip_uv = ((uvq[2][0] + uvq[3][0]) / 2, (uvq[2][1] + uvq[3][1]) / 2)
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        if isinstance(A, int):
            continue
        for i in range(sides):
            j = (i + 1) % sides
            if isinstance(B, int):
                out.f((A[i], A[j], B), slot, (uvq[0], uvq[1], tip_uv), smooth=True)
            else:
                out.f((A[i], A[j], B[j], B[i]), slot, uvq, smooth=True)


def _arc_sample(pts, radii, n, upto=1.0):
    """n points (and radii) evenly spaced by arc length along the polyline
    pts, from its start to `upto` of its length."""
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + (b - a).length)
    total = cum[-1] * upto
    out_p, out_r = [], []
    j = 0
    for i in range(n):
        d = total * i / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < d:
            j += 1
        seg = max(1e-9, cum[j + 1] - cum[j])
        t = min(1.0, max(0.0, (d - cum[j]) / seg))
        out_p.append(pts[j].lerp(pts[j + 1], t))
        out_r.append(radii[j] + (radii[j + 1] - radii[j]) * t)
    return out_p, out_r


def mid_mesh(full_obj, m, keep_tags, frac, seed, scale=None, pivot=0.7, scale_clamp=(1.25, 1.6), rebuild=None,
             pref_scale=1.45, pref_width=None, cover=0.95, tip=0.88, edge_flat=None, wood_area=False):
    """The _mid model of a tree: the baked bark faces of `full_obj` whose
    part tag is in keep_tags (positions, baked atlas UVs and smooth flags
    as they are), plus about `frac` of the cards of `m` - blue-noise
    thinned per card group, each turned into a single straight quad (two
    triangles) and enlarged about a point `pivot` of the way up the card so
    the crown keeps its coverage (area-preserving, times `cover`: the
    thinned cards overlap less than the clustered full set), same atlas
    UVs, crown normals and occlusion. Rebuilt branches are resampled by arc
    length and stop at `tip` of their length (a straight cone to the very
    tip pokes out of the foliage). The preferred card of a crossed pair is
    scaled pref_scale along its length and pref_width across it; with
    edge_flat, the other card of the pair is kept too where its tip lies
    beyond edge_flat of the crown radius at that height (the flat sprays at
    the rim give the crown its width and its spiky tiers from the side).
    wood_area: the rebuilt branches are thickened to the side-on area of
    the originals (for bare trees, whose branches are the silhouette).
    Returns (Mesh, stats)."""
    me = full_obj.data
    card_mat = next(s.material for s in full_obj.material_slots if s.material and s.material.get('card'))
    bark_slots = [i for i, s in enumerate(full_obj.material_slots) if s.material and not s.material.get('card')]
    bark_mat = full_obj.material_slots[bark_slots[0]].material if bark_slots else None
    mats = ([bark_mat] if bark_mat else []) + [card_mat]
    out = Mesh(mats)
    cslot = len(mats) - 1
    stats = dict(wood=0, cards_full=len(m.cards), cards=0)
    if bark_mat is not None:
        tags = me.attributes.get('nat_tag')
        tagv = [0] * len(me.polygons)
        if tags:
            tags.data.foreach_get('value', tagv)
        uvl = me.uv_layers['UVMap'].data
        vmap = {}
        for poly in me.polygons:
            if poly.material_index not in bark_slots or tagv[poly.index] not in keep_tags:
                continue
            ids, uvs = [], []
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                if vi not in vmap:
                    vmap[vi] = out.v(me.vertices[vi].co.copy(), 1.0)
                ids.append(vmap[vi])
                uvs.append(tuple(uvl[li].uv))
            out.f(ids, 0, tuple(uvs), smooth=poly.use_smooth)
        # thinner branches rebuilt cheap (fewer points and sides), on a bark swatch of the trunk
        if rebuild:
            uvq = _swatch(full_obj, bark_slots, tagv)
            for tb in m.tubes:
                spec = rebuild.get(tb['tag'])
                if not spec:
                    continue
                npts, sides = spec
                pts, rad = tb['pts'], tb['radii']
                n = len(pts)
                if n < 2:
                    continue
                pp, rr = _arc_sample(pts, rad, npts, tip)
                rr[-1] = 0.0
                if wood_area:
                    a0 = sum((rad[i] + rad[i + 1]) * (pts[i + 1] - pts[i]).length for i in range(n - 1))
                    a1 = sum((rr[i] + rr[i + 1]) * (pp[i + 1] - pp[i]).length for i in range(npts - 1))
                    k = min(1.6, a0 / max(a1, 1e-9))
                    rr = [r * k for r in rr]
                _swatch_tube(out, pp, rr, sides, uvq)
        stats['wood'] = out.tris
    # cards: groups -> centre and count
    gidx, groups = {}, []
    for ci, c in enumerate(m.cards):
        g = c['group']
        if g not in gidx:
            gidx[g] = len(groups)
            groups.append([Vector(), 0, [], c['keep']])
        e = groups[gidx[g]]
        cen = sum((m.co[k[0]] for k in c['corners']), Vector()) / 4
        e[0] += cen
        e[1] += 1
        e[2].append(ci)
    # groups with a preferred card (crossed conifer pairs): every branch keeps its
    # preferred card, enlarged; they take no part in the thinning
    pref_groups = set(i for i, e in enumerate(groups) if not e[3] and any(m.cards[ci].get('pref') for ci in e[2]))
    free = [(e[0] / e[1], e[1]) for i, e in enumerate(groups) if not e[3] and i not in pref_groups]
    free_ids = [i for i, e in enumerate(groups) if not e[3] and i not in pref_groups]
    kept_free = thin_groups(free, frac, seed)
    keep_groups = set(free_ids[i] for i in kept_free) | set(i for i, e in enumerate(groups) if e[3]) | pref_groups
    # rim test for the flat card of a crossed pair: tip radius against the crown radius at that height
    rim = set()
    if edge_flat and pref_groups:
        def tip_of(c):
            q = [m.co[k[0]] for k in c['corners']]
            return (q[2] + q[3]) / 2
        tips = [(gi, ci, tip_of(m.cards[ci])) for gi in pref_groups for ci in groups[gi][2]]
        zs = [t.z for _, _, t in tips]
        z0, z1 = min(zs), max(zs) + 1e-6
        nb = 14
        band = lambda z: min(nb - 1, int((z - z0) / (z1 - z0) * nb))
        R = [0.0] * nb
        for _, _, t in tips:
            R[band(t.z)] = max(R[band(t.z)], math.hypot(t.x, t.y))
        R = [max(R[max(0, i - 1):i + 2]) for i in range(nb)]
        for gi, ci, t in tips:
            if not m.cards[ci].get('pref') and math.hypot(t.x, t.y) >= edge_flat * R[band(t.z)]:
                rim.add(ci)
    stats['rim'] = len(rim)
    n_free = sum(groups[i][1] for i in free_ids)
    n_kept_free = sum(groups[i][1] for i in keep_groups if i in set(free_ids))
    s_ = scale or math.sqrt(n_free / max(1, n_kept_free)) * cover
    s_ = max(scale_clamp[0], min(scale_clamp[1], s_))
    stats['scale'] = s_
    for gi in sorted(keep_groups):
        e = groups[gi]
        sc = 1.0 if e[3] else (pref_scale if gi in pref_groups else s_)
        sw = pref_width if (gi in pref_groups and pref_width) else sc
        for ci in e[2]:
            c = m.cards[ci]
            if gi in pref_groups and not c.get('pref') and ci not in rim:
                continue
            vids = [k[0] for k in c['corners']]
            uvs = tuple(k[1] for k in c['corners'])
            P = [m.co[v] for v in vids]
            base, top = (P[0] + P[1]) / 2, (P[2] + P[3]) / 2
            pv = base.lerp(top, pivot)
            ax = (top - base).normalized()

            def grow(p):
                d = p - pv
                a = ax * d.dot(ax)
                return pv + a * sc + (d - a) * sw
            ids = [out.v(grow(p), m.ao[v], m.nh[v]) for p, v in zip(P, vids)]
            out.f(ids, cslot, uvs, smooth=False)
            stats['cards'] += 1
    return out, stats


def tag_tris(m):
    """Triangles per part tag (cards counted under 'cards')."""
    card_mats = {c['mat'] for c in m.cards}
    out = {}
    for (idx, mat, uv, sm), t in zip(m.faces, m.ftag):
        k = 'cards' if (mat in card_mats and t == 0) else TAG_NAMES.get(t, str(t))
        out[k] = out.get(k, 0) + len(idx) - 2
    return out


# --------------------------------------------------------------------------
# Dusk comparison renders (full vs _mid at a distance)

def _game_card_normals(objects):
    """Shade the cards as the game does: the back with the front normal (the
    game drops the faceDirection flip; Cycles flips it), the colour times
    the COLOR_0 occlusion, and no ray-traced shadows or occlusion between
    the parts (the game has neither). Returns an undo fn."""
    undo = []
    seen = set()
    vis = [(o, o.visible_shadow, o.visible_diffuse) for o in objects]
    for o in objects:
        o.visible_shadow = False
        o.visible_diffuse = False
    for o in objects:
        for sl in o.material_slots:
            mat = sl.material
            if not mat or not mat.get('card') or mat.name in seen:
                continue
            seen.add(mat.name)
            nt = mat.node_tree
            bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            ln = next((l for l in nt.links if l.to_socket == bsdf.inputs['Normal']), None)
            if ln is None:
                continue
            src = ln.from_socket
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            neg = nt.nodes.new('ShaderNodeVectorMath')
            neg.operation = 'SCALE'
            neg.inputs['Scale'].default_value = -1.0
            nt.links.new(src, neg.inputs[0])
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'VECTOR'
            nt.links.new(geo.outputs['Backfacing'], mix.inputs['Factor'])
            nt.links.new(src, mix.inputs[4])
            nt.links.new(neg.outputs['Vector'], mix.inputs[5])
            nt.links.new(mix.outputs[1], bsdf.inputs['Normal'])
            lc = next(l for l in nt.links if l.to_socket == bsdf.inputs['Base Color'])
            csrc = lc.from_socket
            va = nt.nodes.new('ShaderNodeVertexColor')
            va.layer_name = 'Color'
            mul = nt.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1.0
            nt.links.new(csrc, mul.inputs[6])
            nt.links.new(va.outputs['Color'], mul.inputs[7])
            nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
            undo.append((nt, src, csrc, bsdf, (geo, neg, mix, va, mul)))

    def restore():
        for nt, src, csrc, bsdf, nodes in undo:
            for n in nodes:
                nt.nodes.remove(n)
            nt.links.new(src, bsdf.inputs['Normal'])
            nt.links.new(csrc, bsdf.inputs['Base Color'])
        for o, a, b in vis:
            o.visible_shadow, o.visible_diffuse = a, b
    return restore


def render_dusk(objects, path, cam, target, lens=54.0, size=(768, 768), samples=16, floor=80.0):
    """A still in dim dusk light (low warm sun, cool dim sky) at roughly the
    game's angular resolution (~21 px per degree at lens 54, 768 px),
    shaded as the game does (see _game_card_normals)."""
    scene = bpy.context.scene
    restore = _game_card_normals(objects)
    keep = set(objects)
    hidden = []
    for o in scene.objects:
        if o.type == 'MESH' and o not in keep and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    cd = bpy.data.cameras.new('dusk_cam')
    cd.lens = lens
    cd.clip_end = 3000.0
    cam_o = kit.link(bpy.data.objects.new('dusk_cam', cd))
    cam_o.location = cam
    cam_o.rotation_euler = (Vector(target) - Vector(cam)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam_o
    sd = bpy.data.lights.new('dusk_sun', 'SUN')
    sd.energy = 1.6
    sd.color = (1.0, 0.72, 0.52)
    sd.angle = math.radians(3)
    sun = kit.link(bpy.data.objects.new('dusk_sun', sd))
    sun.rotation_euler = (math.radians(82), 0.0, math.radians(-125))
    fl = kit.plane(floor * 2, floor * 2, loc=(target[0], target[1], -0.002), mat='dirt', name='dusk_floor')
    world = bpy.data.worlds.get('dusk') or bpy.data.worlds.new('dusk')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.2, 0.23, 0.3, 1)
    bg.inputs['Strength'].default_value = 0.55
    scene.world = world
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.cycles.samples = samples
    scene.cycles.transparent_max_bounces = 64
    scene.cycles.max_bounces = 4
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    bpy.ops.render.render(write_still=True)
    restore()
    scene.cycles.use_denoising = False
    kit.delete(cam_o)
    kit.delete(sun)
    kit.delete(fl)
    for o in hidden:
        o.hide_render = False
    return path


def side_by_side(paths, out, labels_px=0):
    """Join PNGs left to right into one image."""
    import bake
    imgs = [bpy.data.images.load(p) for p in paths]
    arrs = [bake.pixels(i)[..., :4] for i in imgs]
    h = max(a.shape[0] for a in arrs)
    gap = np.zeros((h, 6, 4), np.float32)
    gap[..., 3] = 1.0
    row = []
    for k, a in enumerate(arrs):
        if a.shape[0] < h:
            a = np.concatenate([np.zeros((h - a.shape[0],) + a.shape[1:], np.float32), a], 0)
        row.append(a)
        if k < len(arrs) - 1:
            row.append(gap)
    full = np.concatenate(row, 1)
    img = bpy.data.images.new('sbs', full.shape[1], full.shape[0])
    img.pixels.foreach_set(np.ascontiguousarray(full).ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    for i in imgs + [img]:
        bpy.data.images.remove(i)
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass
    return out


def compare_mid(full, mid, out_prefix, dists=(30.0, 45.0), size=(768, 768), samples=16):
    """full | mid at each distance, same camera, eye height 1.7 m."""
    mn, mx = kit.bounds(full)
    hgt = mx.z
    for d in dists:
        cam = (0.0, -d, 1.7)
        target = (0.0, 0.0, hgt * 0.48)
        a = render_dusk([full], out_prefix + f'_{int(d)}m_full.png', cam, target, size=size, samples=samples)
        b = render_dusk([mid], out_prefix + f'_{int(d)}m_mid.png', cam, target, size=size, samples=samples)
        side_by_side([a, b], out_prefix + f'_{int(d)}m.png')
