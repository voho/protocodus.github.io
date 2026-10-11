"""Alpen wildlife — the mountain hare, the red deer and the grey wolf, built
in Blender.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/wildlife.py -- --out fun/alpen/assets/models/wildlife

Run from the repository root; writes `alpine-wildlife.glb`. Nothing is
rendered on the way, so it builds anywhere. `--preview <dir>` also draws a
sheet per animal there (`hare.png`, `deer-hind.png`, `deer-stag.png`,
`wolf.png`: side on, and from the front and rear quarters, the deer and the
wolf mid-stride and browsing as the game moves them), with Cycles on the CPU
— slow, but it runs where the GPU is hidden; `--only hare,stag` draws just
those.

Five nodes, one per instanced pool in `js/wildlife.js`:

  wild_hare       a mountain hare (Lepus timidus) in its white winter coat,
                  crouched in its form: the long hind feet flat under it,
                  the short black-tipped ears up and laid a little back
  wild_deerBody   a red deer (Cervus elaphus) from the withers down — the
                  body every hind and stag of a herd shares
  wild_hindHead   a hind's neck and head, from the base of the neck
  wild_stagHead   a stag's: the heavier maned neck and a royal's antlers,
                  six points a side
  wild_wolf       a grey wolf (Canis lupus) of the Alpine population in its
                  winter coat, the ruff, the saddle and the low brush

THE COORDINATES ARE THE GAME'S, NOT BLENDER'S, exactly as in `riders.py`:
every table is +Y up and −Z forward, the animal faces −Z with its feet on
y = 0, and `B` turns a point into Blender's Z-up space as the mesh is
written, which the exporter's +Y-up conversion turns straight back. The two
heads are the exception that proves it: their origin is the base of the
neck, the pivot the herd lowers them about, and the body node carries where
that is (`extras.withers`).

EVERY SURFACE IS A TUBE. Not a sculpt and not a subdivided cage: each part
is a run of elliptical sections strung along a spine (`tube`), the stations
of its table interpolated with a Catmull-Rom spline and resampled at even
arc length, so a part costs exactly the rings it is drawn with and the rings
fall where the shape changes. A leg is therefore a stack of clean rings from
the shoulder to the hoof, which is the topology the gait wants: it bends
over the rings at its top, nowhere else. The tubes of an animal are then
fused into one skin (see `realise`), so a leg or a haunch grows out of the
body instead of being stuck through it.

COLOUR IS A ROLE, AS FOR THE RIDERS. Each face carries a material named for
what it is (`fur`, `coat`, `hoof`, `antler`, `eye`…) and the game decides
what each role looks like. A coat is not one colour, though, and the
markings that make these animals legible — a wolf's saddle and pale cheeks,
a deer's rump patch, the black of a hare's ear tip — are soft-edged, which
a material boundary is not. So every vertex also carries two weights the
exporter writes as glTF custom attributes, `_PALE` and `_DARK`, and the
look table in the game names a pale and a dark shade for each role to be
mixed in by them.

THE LEGS SWING IN THE GAME'S SHADER, NOT HERE. The deer and the wolf carry
the two attributes it needs (`_LEG`, `_SWING`): which leg a vertex belongs
to (1 fore −X, 2 fore +X, 3 hind −X, 4 hind +X, 0 none) and how much of it
swings with that leg. The weight is a field in space rather than a property
of a part — the leg's own rings get the whole of a ramp that runs down from
where the leg leaves the body (the elbow, the stifle, which is also what it
turns about) to the forearm or gaskin, and the flank round the top of the
leg gets the same ramp, faded out with its distance from the leg — so where
a leg's surface passes into the body's, the two move together and no seam
can open. The pivot each leg turns about goes out as `extras.legs`; the
gait (the phase of each leg in a stride) stays in the game.
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from riders import B, collection, clear_collection, tris, material, hex_rgba  # noqa: E402

TAU = math.tau


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def smooth(e0, e1, x):
    """GLSL smoothstep, either way round."""
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def ell(p, c, r):
    """Distance from c in units of an axis-aligned ellipsoid's radii."""
    return math.sqrt(sum(((p[i] - c[i]) / r[i]) ** 2 for i in range(3)))


def blot(p, c, r, soft=0.35):
    """1 inside the ellipsoid (c, r), 0 outside, softened across its skin."""
    return 1.0 - smooth(1.0 - soft, 1.0 + soft, ell(p, c, r))


# ---------------------------------------------------------------------------
# The kit: a tube of elliptical sections along a spline
# ---------------------------------------------------------------------------

class Piece:
    """Verts in game space, faces, a role per face, and per vertex the
    tube's own coordinates (s along it 0..1, theta round it) so a part can
    be marked along its length — an ear's black tip, a tine's pale point.

    `marks` is how its `_PALE`/`_DARK` are found: 'body' asks the animal's
    field, a function (p, s, theta) answers for itself, None is unmarked.
    `leg` (1..4) makes every vertex of the piece belong to that leg. `loose`
    keeps it out of the union (see `realise`): an eye in its socket, a hoof
    under its coronet, an antler on its burr are creased in life too."""

    def __init__(self, verts, faces, mats, st, marks='body', leg=0, loose=False):
        self.verts = verts
        self.faces = faces
        self.mats = mats
        self.st = st
        self.marks = marks
        self.leg = leg
        self.loose = loose

    def mirrored(self):
        """The same piece on the other side of the animal (x → −x)."""
        leg = {1: 2, 2: 1, 3: 4, 4: 3}.get(self.leg, 0)
        return Piece([(-x, y, z) for (x, y, z) in self.verts],
                     [tuple(reversed(f)) for f in self.faces],
                     list(self.mats), list(self.st), self.marks, leg, self.loose)

    def kept_loose(self):
        self.loose = True
        return self


KEYS = ('a', 'b', 'bd', 'rnd', 'pinch', 'ou', 'ox', 'tuft', 'cup', 'flat')


def _cr(vals, u):
    """Catmull-Rom through `vals` (floats or Vectors) at fractional index u,
    the ends clamped."""
    n = len(vals)
    if n == 1:
        return vals[0]
    u = clamp(u, 0.0, n - 1.0)
    i = min(int(math.floor(u)), n - 2)
    f = u - i
    p0 = vals[max(i - 1, 0)]
    p1 = vals[i]
    p2 = vals[i + 1]
    p3 = vals[min(i + 2, n - 1)]
    f2 = f * f
    f3 = f2 * f
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * f3)


def _lin(vals, u):
    """Linear interpolation by fractional index: for the section's own
    numbers, where a spline would overshoot a radius into nothing."""
    n = len(vals)
    u = clamp(u, 0.0, n - 1.0)
    i = min(int(math.floor(u)), n - 2) if n > 1 else 0
    if n == 1:
        return vals[0]
    f = u - i
    f = f * f * (3 - 2 * f) * 0.35 + f * 0.65   # eased a little at the stations
    return vals[i] + (vals[i + 1] - vals[i]) * f


def tube(stations, n=12, rings=None, ref=(1, 0, 0), mat='fur', marks='body', leg=0,
         tuft_k=7, tuft_phase=0.0, caps=(True, True), dome=(0.5, 0.5)):
    """Elliptical sections strung along a spline through the stations' `c`.

    A station's section, in the frame of the spine there (X is `ref` made
    square to the spine, U = X × T, which for a body running −Z is +Y and for
    a leg running down is forward): half-width `a` along X, `b` along +U and
    `bd` along −U (so a body's back and belly, a leg's front and back, can
    differ), `rnd` the superellipse exponent (below 1 squarer), `pinch`
    narrowing it towards +U (a spine, a keel), `ou`/`ox` offsets, `cup`
    bowing it towards −U (an ear's hollow), `flat` flattening its −U side
    (a sole, a belly on the snow) and `tuft` the depth of the ripples that
    read as locks of fur at the silhouette.

    `rings` resamples the spine at even arc length (default: one ring per
    station); the ends close on a pole pushed out by `dome` × the end
    section's smaller radius, which rounds them. `mat` is a role or a
    function (s, theta) → role per face."""
    m = len(stations)
    cs = [Vector(st['c']) for st in stations]
    par = {}
    for k in KEYS:
        col = []
        for st in stations:
            if k in st:
                col.append(float(st[k]))
            elif k == 'b':
                col.append(float(st['a']))
            elif k == 'bd':
                col.append(float(st.get('b', st['a'])))
            elif k == 'rnd':
                col.append(1.0)
            else:
                col.append(0.0)
        par[k] = col

    # where the rings go: even arc length along the spline
    if rings is None:
        us = [float(i) for i in range(m)]
    else:
        fine = [i * (m - 1) / 400 for i in range(401)]
        pts = [_cr(cs, u) for u in fine]
        acc = [0.0]
        for i in range(1, len(pts)):
            acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
        total = acc[-1]
        us = []
        j = 0
        for r in range(rings):
            target = total * r / (rings - 1)
            while j < len(acc) - 2 and acc[j + 1] < target:
                j += 1
            span = acc[j + 1] - acc[j]
            f = 0.0 if span <= 0 else (target - acc[j]) / span
            us.append(fine[j] + (fine[j + 1] - fine[j]) * f)

    refv = Vector(ref).normalized()
    verts, st_of = [], []
    frames = []
    for ri, u in enumerate(us):
        c = _cr(cs, u)
        t = _cr(cs, min(u + 0.02, m - 1)) - _cr(cs, max(u - 0.02, 0))
        t.normalize()
        x = refv - t * refv.dot(t)
        if x.length < 1e-6:
            x = Vector((0, 0, 1)) - t * t.z
        x.normalize()
        uu = x.cross(t)
        frames.append((c, t, x, uu))
        a = max(_lin(par['a'], u), 1e-4)
        b = max(_lin(par['b'], u), 1e-4)
        bd = max(_lin(par['bd'], u), 1e-4)
        rnd = _lin(par['rnd'], u)
        pinch = _lin(par['pinch'], u)
        ou = _lin(par['ou'], u)
        ox = _lin(par['ox'], u)
        tuft = _lin(par['tuft'], u)
        cup = _lin(par['cup'], u)
        flat = _lin(par['flat'], u)
        s = u / (m - 1) if m > 1 else 0.0
        for j in range(n):
            th = j / n * TAU
            co, si = math.cos(th), math.sin(th)
            w = a * math.copysign(abs(co) ** rnd, co)
            h = (b if si >= 0 else bd) * math.copysign(abs(si) ** rnd, si)
            w *= 1.0 - pinch * si
            if si < 0 and flat:
                h *= 1.0 - flat * (abs(co) ** 0.5)
            f = 1.0
            if tuft:
                f += tuft * (0.65 * math.sin(tuft_k * th + tuft_phase + 2.1 * ri)
                             + 0.35 * math.sin(2 * tuft_k * th + 1.7 * ri + tuft_phase))
            hh = h * f + ou - cup * (w / a) ** 2 * a
            p = c + x * (w * f + ox) + uu * hh
            verts.append(tuple(p))
            st_of.append((s, th))

    faces, mats = [], []
    pick = mat if callable(mat) else (lambda s, th: mat)
    R = len(us)
    for i in range(R - 1):
        s_mid = 0.5 * (st_of[i * n][0] + st_of[(i + 1) * n][0])
        for j in range(n):
            jn = (j + 1) % n
            faces.append((i * n + j, i * n + jn, (i + 1) * n + jn, (i + 1) * n + j))
            mats.append(pick(s_mid, (j + 0.5) / n * TAU))
    for end, ring_i in ((0, 0), (1, R - 1)):
        if not caps[end]:
            continue
        c, t, x, uu = frames[ring_i]
        u = us[ring_i]
        rad = min(_lin(par['a'], u), _lin(par['b'], u), _lin(par['bd'], u))
        sign = -1 if end == 0 else 1
        pole = c + t * (sign * dome[end] * rad)
        pi = len(verts)
        verts.append(tuple(pole))
        st_of.append((0.0 if end == 0 else 1.0, 0.0))
        for j in range(n):
            jn = (j + 1) % n
            a_, b_ = ring_i * n + j, ring_i * n + jn
            faces.append((a_, b_, pi) if end == 1 else (b_, a_, pi))
            mats.append(pick(0.0 if end == 0 else 1.0, (j + 0.5) / n * TAU))
    return Piece(verts, faces, mats, st_of, marks, leg)


def blob(c, axis, half, a, b, n=10, rings=7, ref=(1, 0, 0), mat='fur', marks='body', leg=0, bd=None,
         tuft=0.0, tuft_k=7):
    """An ellipsoid as a tube: `half` along `axis`, `a` along ref, `b`/`bd`
    either side across it."""
    ax = Vector(axis).normalized()
    sts = []
    for k in range(rings):
        ph = math.pi * (k + 0.5) / rings
        sts.append({'c': tuple(Vector(c) - ax * (half * math.cos(ph))),
                    'a': a * math.sin(ph), 'b': b * math.sin(ph),
                    'bd': (bd if bd is not None else b) * math.sin(ph), 'tuft': tuft})
    end = half * (1 - math.cos(math.pi * 0.5 / rings))
    rad0 = min(a, b, bd if bd is not None else b) * math.sin(math.pi * 0.5 / rings)
    return tube(sts, n=n, ref=ref, mat=mat, marks=marks, leg=leg, tuft_k=tuft_k,
                dome=(end / rad0, end / rad0))


def path(points, radii, **kw):
    """A tube through `points` with sections from `radii`: a list of (a, b)
    or (a, b, bd) per point."""
    sts = []
    for p, r in zip(points, radii):
        st = {'c': p, 'a': r[0], 'b': r[1] if len(r) > 1 else r[0]}
        if len(r) > 2:
            st['bd'] = r[2]
        sts.append(st)
    return tube(sts, **kw)


def curve(base, direction, length, k, bend=0.0, axis=(1, 0, 0)):
    """k + 1 points from `base`, setting off along `direction` and turning
    steadily by `bend` radians about `axis` over the length — an ear, a
    tine."""
    d = Vector(direction).normalized()
    ax = Vector(axis).normalized()
    pts = [Vector(base)]
    for i in range(k):
        d = Matrix.Rotation(bend / k, 3, ax) @ d
        pts.append(pts[-1] + d * (length / k))
    return [tuple(p) for p in pts]


# ---------------------------------------------------------------------------
# Legs: which leg a vertex swings with, and how much
# ---------------------------------------------------------------------------

class Leg:
    """One leg's swing: it turns about `pivot` (y, z) in the body's YZ
    plane; its weight ramps from 0 at `top` to 1 at `full` (heights); its
    axis is the centre line of its tube, sampled as (x, y, z, radius
    across, radius along) from the top down, which is how far the flank
    round it is drawn along."""

    def __init__(self, index, pivot, top, full, axis):
        self.index = index
        self.pivot = pivot
        self.top = top
        self.full = full
        self.axis = axis

    def ramp(self, y):
        return smooth(self.top, self.full, y)

    def at(self, y):
        ax = self.axis
        if y >= ax[0][1]:
            return ax[0]
        if y <= ax[-1][1]:
            return ax[-1]
        for i in range(1, len(ax)):
            if ax[i][1] <= y:
                p, q = ax[i - 1], ax[i]
                f = (p[1] - y) / (p[1] - q[1])
                return tuple(p[k] + (q[k] - p[k]) * f for k in range(5))
        return ax[-1]


def leg_weight(p, legs, own=0):
    """(leg index, weight) for a vertex at p. A leg's own piece takes the
    ramp whole; anything else takes it faded by its distance from the
    nearest leg on its side, measured in that leg's radii at its height."""
    x, y, z = p
    if own:
        lg = legs[own]
        return own, lg.ramp(y)
    best, bw = 0, 0.0
    for lg in legs.values():
        ax = lg.at(y)
        if x * ax[0] <= 0:
            continue
        d = math.hypot((x - ax[0]) / ax[3], (z - ax[2]) / ax[4])
        w = lg.ramp(y) * (1.0 - smooth(1.05, 1.9, d))
        if w > bw:
            best, bw = lg.index, w
    return (best, bw) if bw > 1e-4 else (0, 0.0)


# ---------------------------------------------------------------------------
# Realising an animal: one mesh, roles as materials, the attributes on it
# ---------------------------------------------------------------------------

def realise(name, pieces, col, field=None, legs=None):
    """Fuse the pieces into one mesh object `name`, one material slot per
    role, with `_PALE`/`_DARK` on every vertex (and `_LEG`/`_SWING` when the
    animal has `legs`), smooth shaded.

    FUSED, NOT STACKED. Left as intersecting shells, every leg, haunch and
    ear would meet its body at a crease — two surfaces passing through each
    other, the normal jumping where they cross — which is the balloon-animal
    look the sculpted animals were built to get away from. So the pieces are
    unioned with Blender's exact boolean: what is inside the animal goes,
    the shells are cut along the curves where they meet and joined there,
    and the smooth shading runs across the join. The markings travel through
    the cut as attributes; the leg weights are worked out afterwards, on the
    skin that is left (`_OWN`, the leg a piece belonged to, carries the one
    thing position cannot). Pieces marked `loose` are not cut but laid on
    after, whole."""
    scratch = collection('_fuse')
    clear_collection(scratch)
    verts, faces, froles = [], [], []
    corner = {'_PALE': [], '_DARK': [], '_OWN': []}

    def take(me):
        """Append a mesh's faces, roles and corner values to the lists."""
        base = len(verts)
        verts.extend(tuple(v.co) for v in me.vertices)
        slot = [m.name.split('.')[0] for m in me.materials]
        vals = {nm: [a.value for a in me.attributes[nm].data] for nm in corner}
        for poly in me.polygons:
            faces.append(tuple(base + i for i in poly.vertices))
            froles.append(slot[poly.material_index])
            for nm in corner:
                corner[nm].extend(vals[nm][li] for li in poly.loop_indices)

    whole = [pc for pc in pieces if not pc.loose]
    obs = [bpy.data.objects.new('_piece', _piece_mesh(pc, field)) for pc in whole]
    for ob in obs:
        scratch.objects.link(ob)
    if len(obs) > 1:
        operands = collection('_operands')
        clear_collection(operands)
        for ob in obs[1:]:
            scratch.objects.unlink(ob)
            operands.objects.link(ob)
        mod = obs[0].modifiers.new('fuse', 'BOOLEAN')
        mod.operation = 'UNION'
        mod.solver = 'EXACT'
        mod.operand_type = 'COLLECTION'
        mod.collection = operands
        if hasattr(mod, 'material_mode'):
            mod.material_mode = 'TRANSFER'
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        fused = bpy.data.meshes.new_from_object(obs[0].evaluated_get(dg))
        clear_collection(operands)
        take(fused)
        bpy.data.meshes.remove(fused)
    elif obs:
        take(obs[0].data)
    clear_collection(scratch)
    for pc in pieces:
        if pc.loose:
            me = _piece_mesh(pc, field)
            take(me)
            bpy.data.meshes.remove(me)

    # The corner values back onto the vertices. A vertex the cut made has
    # corners on both shells and takes their mean — except its leg, which is
    # a leg's only where every corner agrees: the seam is the body's.
    nv = len(verts)
    acc = {nm: [0.0] * nv for nm in corner}
    lo = [1e9] * nv
    hi = [-1e9] * nv
    cnt = [0] * nv
    k = 0
    for f in faces:
        for vi in f:
            for nm in corner:
                acc[nm][vi] += corner[nm][k]
            o = corner['_OWN'][k]
            lo[vi] = min(lo[vi], o)
            hi[vi] = max(hi[vi], o)
            cnt[vi] += 1
            k += 1
    pale = [acc['_PALE'][i] / cnt[i] if cnt[i] else 0.0 for i in range(nv)]
    dark = [acc['_DARK'][i] / cnt[i] if cnt[i] else 0.0 for i in range(nv)]
    own = [int(round(lo[i])) if cnt[i] and hi[i] - lo[i] < 1e-3 else 0 for i in range(nv)]

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    roles = list(dict.fromkeys(froles))
    for r in roles:
        me.materials.append(material(r))
    for poly, r in zip(me.polygons, froles):
        poly.material_index = roles.index(r)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.attributes.new('_PALE', 'FLOAT', 'POINT').data.foreach_set('value', pale)
    me.attributes.new('_DARK', 'FLOAT', 'POINT').data.foreach_set('value', dark)
    if legs:
        legi, swing = [], []
        for v, mine in zip(verts, own):
            li, w = leg_weight((v[0], v[2], -v[1]), legs, mine)
            legi.append(float(li))
            swing.append(w)
        me.attributes.new('_LEG', 'FLOAT', 'POINT').data.foreach_set('value', legi)
        me.attributes.new('_SWING', 'FLOAT', 'POINT').data.foreach_set('value', swing)
    me.shade_smooth()
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def _piece_mesh(pc, field):
    """One piece as a closed mesh, its marks and leg on the face corners —
    because the boolean carries an operand's corner attributes through the
    cut and drops its point ones."""
    roles = sorted(set(pc.mats))
    me = bpy.data.meshes.new('_piece')
    me.from_pydata([B(v) for v in pc.verts], [], pc.faces)
    for r in roles:
        me.materials.append(material(r))
    for poly, r in zip(me.polygons, pc.mats):
        poly.material_index = roles.index(r)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    pale, dark = [], []
    for k, v in enumerate(pc.verts):
        s, th = pc.st[k]
        if pc.marks == 'body':
            pl, dk = field(v) if field else (0.0, 0.0)
        elif callable(pc.marks):
            pl, dk = pc.marks(v, s, th)
        else:
            pl, dk = 0.0, 0.0
        pale.append(clamp(pl, 0.0, 1.0))
        dark.append(clamp(dk, 0.0, 1.0))
    corner_vert = [lp.vertex_index for lp in me.loops]
    for nm, vals in (('_PALE', pale), ('_DARK', dark)):
        me.attributes.new(nm, 'FLOAT', 'CORNER').data.foreach_set('value', [vals[i] for i in corner_vert])
    me.attributes.new('_OWN', 'FLOAT', 'CORNER').data.foreach_set('value', [float(pc.leg)] * len(corner_vert))
    return me


# ===========================================================================
# THE MOUNTAIN HARE
# ===========================================================================
#
# Lepus timidus in January: white but for the black ear tips, and in its
# form — the crouch it sits out the day in — which is the pose the game
# draws it in, squashing and pitching it into a bound. The silhouette is
# about weight: the rump is the highest thing on it, the back falls away to
# a much narrower chest, and the head is carried up and forward. Under the
# rump the folded hind legs swell out of either flank and the long hind
# feet, furred into snowshoes, run forward flat on the snow — which is what
# makes a crouched hare look coiled rather than seated. The ears are the
# mountain hare's: shorter than a brown hare's, about the length of the
# head, carried up and a little back, hollow to the front.

HARE_BODY = [
    {'c': (0, 0.170, 0.254), 'a': 0.030, 'b': 0.030},
    {'c': (0, 0.180, 0.236), 'a': 0.096, 'b': 0.104, 'bd': 0.094},
    {'c': (0, 0.186, 0.192), 'a': 0.132, 'b': 0.146, 'bd': 0.128},
    {'c': (0, 0.187, 0.122), 'a': 0.146, 'b': 0.156, 'bd': 0.140, 'flat': 0.25},
    {'c': (0, 0.180, 0.042), 'a': 0.141, 'b': 0.150, 'bd': 0.134, 'flat': 0.3},
    {'c': (0, 0.172, -0.038), 'a': 0.127, 'b': 0.139, 'bd': 0.124, 'flat': 0.25},
    {'c': (0, 0.167, -0.100), 'a': 0.108, 'b': 0.126, 'bd': 0.112, 'pinch': 0.08},
    {'c': (0, 0.170, -0.148), 'a': 0.088, 'b': 0.106, 'bd': 0.100, 'pinch': 0.08, 'tuft': 0.02},
    {'c': (0, 0.177, -0.184), 'a': 0.062, 'b': 0.076, 'bd': 0.074, 'tuft': 0.02},
    {'c': (0, 0.183, -0.203), 'a': 0.026, 'b': 0.030},
]

HARE_HEAD = [
    {'c': (0, 0.188, -0.095), 'a': 0.062, 'b': 0.064},
    {'c': (0, 0.226, -0.158), 'a': 0.074, 'b': 0.080, 'bd': 0.084, 'tuft': 0.025},
    {'c': (0, 0.268, -0.203), 'a': 0.069, 'b': 0.071, 'bd': 0.076, 'tuft': 0.02},
    {'c': (0, 0.296, -0.238), 'a': 0.063, 'b': 0.065, 'bd': 0.069},
    {'c': (0, 0.306, -0.274), 'a': 0.058, 'b': 0.059, 'bd': 0.065, 'pinch': 0.12},
    {'c': (0, 0.298, -0.305), 'a': 0.052, 'b': 0.048, 'bd': 0.060, 'pinch': 0.2},
    {'c': (0, 0.285, -0.332), 'a': 0.043, 'b': 0.036, 'bd': 0.048, 'pinch': 0.22, 'rnd': 0.85},
    {'c': (0, 0.273, -0.350), 'a': 0.032, 'b': 0.025, 'bd': 0.034, 'pinch': 0.15, 'rnd': 0.85},
    {'c': (0, 0.266, -0.359), 'a': 0.014, 'b': 0.011},
]

HARE_EYE = (0.052, 0.312, -0.273)


def hare_field(p):
    """Under-fur: the coat goes a shade bluer where it turns under, at the
    snow line and in the crease under the chin."""
    x, y, z = p
    pale = 0.75 * (1 - smooth(0.012, 0.075, y))
    pale = max(pale, 0.45 * blot(p, (0, 0.215, -0.24), (0.05, 0.03, 0.05), 0.5))
    return pale, 0.0


def hare_ear(side):
    """The right ear (side 1); the left is its mirror. Up and back and
    splayed, the hollow facing forward and out, black for its last fifth."""
    base = Vector((0.020 * side, 0.334, -0.238))
    d = Vector((0.27 * side, 0.88, 0.40)).normalized()
    pts = curve(base, d, 0.128, 7, bend=0.18 * side, axis=(0, 0, 1))
    widths = [0.012, 0.023, 0.030, 0.032, 0.030, 0.026, 0.018, 0.005]
    thick = [0.009, 0.008, 0.007, 0.0065, 0.006, 0.0055, 0.005, 0.003]
    sts = [{'c': p, 'a': w, 'b': t, 'cup': 0.22} for p, w, t in zip(pts, widths, thick)]
    sts[0]['cup'] = 0.0

    def role(s, th):
        return 'earInner' if math.sin(th) < -0.25 and 0.08 < s < 0.8 else 'fur'

    def tip(p, s, th):
        return 0.0, smooth(0.70, 0.86, s)
    return tube(sts, n=8, rings=12, ref=(1.0 * side, 0.0, -0.45), mat=role, marks=tip,
                dome=(0.3, 0.6))


def hare():
    ear = hare_ear(1)
    parts = [
        tube(HARE_BODY, n=22, rings=20),
        tube(HARE_HEAD, n=18, rings=18, tuft_k=9),
        ear, ear.mirrored(),
    ]
    for side in (1, -1):
        sx = side
        # the folded hind leg, thigh and shank in one, swelling out of the
        # flank low and behind
        parts.append(blob((0.097 * sx, 0.124, 0.110), (0, -0.55, -0.83), 0.118, 0.053, 0.084,
                          n=14, rings=10, ref=(1, 0, 0)))
        # the long hind foot, a snowshoe of fur from the heel under the rump
        # to the toes level with the chest
        parts.append(tube([
            {'c': (0.080 * sx, 0.040, 0.222), 'a': 0.018, 'b': 0.020},
            {'c': (0.083 * sx, 0.035, 0.190), 'a': 0.029, 'b': 0.029, 'bd': 0.027},
            {'c': (0.084 * sx, 0.030, 0.125), 'a': 0.033, 'b': 0.027, 'bd': 0.026, 'flat': 0.5},
            {'c': (0.082 * sx, 0.028, 0.058), 'a': 0.035, 'b': 0.025, 'bd': 0.025, 'flat': 0.6},
            {'c': (0.080 * sx, 0.026, 0.012), 'a': 0.036, 'b': 0.023, 'bd': 0.023, 'flat': 0.6,
             'tuft': 0.04},
            {'c': (0.079 * sx, 0.024, -0.016), 'a': 0.027, 'b': 0.018, 'bd': 0.019, 'tuft': 0.05},
            {'c': (0.078 * sx, 0.022, -0.028), 'a': 0.010, 'b': 0.008},
        ], n=12, rings=12, tuft_k=5))
        # the forelegs, short and mostly lost in the chest fur, and the
        # forepaws flat in front
        parts.append(tube([
            {'c': (0.054 * sx, 0.140, -0.132), 'a': 0.032, 'b': 0.040},
            {'c': (0.052 * sx, 0.098, -0.150), 'a': 0.027, 'b': 0.031},
            {'c': (0.049 * sx, 0.055, -0.170), 'a': 0.021, 'b': 0.023},
            {'c': (0.048 * sx, 0.028, -0.184), 'a': 0.019, 'b': 0.020},
        ], n=10, rings=7, ref=(1, 0, 0)))
        parts.append(blob((0.048 * sx, 0.017, -0.204), (0, -0.1, -1), 0.032, 0.021, 0.016,
                          n=10, rings=6, tuft=0.05, tuft_k=4))
        # the eye: big, dark, set high on the side of the head
        ex, ey, ez = HARE_EYE
        parts.append(blob((ex * sx, ey, ez), (sx, 0.05, 0.12), 0.011, 0.018, 0.016,
                          n=12, rings=6, ref=(0, 1, 0), mat='eye', marks=None).kept_loose())
    # the scut, white all year, turned up against the rump
    parts.append(blob((0, 0.212, 0.272), (0, 0.35, 1), 0.028, 0.040, 0.036, n=12, rings=7,
                      tuft=0.06, tuft_k=6))
    # the nose
    parts.append(blob((0, 0.268, -0.358), (0, 0.45, -1), 0.008, 0.011, 0.008, n=8, rings=4,
                      mat='nose', marks=None).kept_loose())
    return parts


# ===========================================================================
# THE RED DEER
# ===========================================================================
#
# Cervus elaphus in its winter coat, grey-brown rather than red, from the
# withers down: the neck and head are separate nodes hung off the body at
# `DEER_WITHERS`, because the one thing a deer does that reads at two hundred
# metres is put its nose in the snow and take it out again.
#
# A deer rather than a small horse is a matter of taper and of legs. The
# chest is deep and narrow and drops to the elbow, the barrel behind it is
# rounder, the loin is shallower and the croup comes back up over the hips;
# the legs are long and fine below a muscled forearm and gaskin, and they
# bend the right way for each pair — the knee (the carpus) of a foreleg is
# straight under the shoulder, the hock of a hind leg points backwards and
# the cannon below it slants forward to the fetlock. The pale rump patch
# round the short tail is most of what is left of a deer at range.

DEER_WITHERS = (0.0, 1.00, -0.47)


def girth(z, top, bot, a, **kw):
    """A body section by its top and bottom line rather than a centre."""
    st = {'c': (0, 0.5 * (top + bot), z), 'a': a, 'b': 0.5 * (top - bot)}
    st.update(kw)
    return st


DEER_TORSO = [
    girth(0.672, 0.985, 0.865, 0.040),
    girth(0.640, 1.052, 0.785, 0.104),
    girth(0.565, 1.100, 0.735, 0.150, pinch=0.18),
    girth(0.440, 1.122, 0.720, 0.174, pinch=0.22),
    girth(0.300, 1.104, 0.735, 0.168, pinch=0.14),
    girth(0.130, 1.096, 0.690, 0.186, pinch=0.08),
    girth(-0.050, 1.114, 0.660, 0.192, pinch=0.1),
    girth(-0.215, 1.150, 0.640, 0.176, pinch=0.16),
    girth(-0.355, 1.170, 0.662, 0.156, pinch=0.24),
    girth(-0.470, 1.120, 0.712, 0.136, pinch=0.16),
    girth(-0.560, 1.020, 0.790, 0.104, pinch=0.05),
    girth(-0.608, 0.950, 0.850, 0.050),
]

# Legs from the top down, (x, y, z) and the section (a across, b in front,
# bd behind), right side; the left is the mirror. The tops are buried in the
# body: a leg comes out from under a deer, not off its side.
DEER_FORE = [
    ((0.092, 0.960, -0.330), (0.055, 0.095, 0.095)),
    ((0.106, 0.840, -0.330), (0.058, 0.090, 0.090)),
    ((0.118, 0.730, -0.336), (0.054, 0.074, 0.078)),
    ((0.123, 0.620, -0.343), (0.045, 0.057, 0.055)),
    ((0.125, 0.505, -0.349), (0.035, 0.041, 0.040)),
    ((0.125, 0.435, -0.351), (0.033, 0.039, 0.036)),
    ((0.125, 0.360, -0.353), (0.024, 0.028, 0.028)),
    ((0.125, 0.200, -0.356), (0.021, 0.025, 0.025)),
    ((0.125, 0.122, -0.358), (0.025, 0.030, 0.033)),
    ((0.125, 0.078, -0.372), (0.021, 0.025, 0.025)),
    ((0.125, 0.052, -0.386), (0.022, 0.026, 0.026)),
]
# The hind leg's top is the whole thigh seen from the side: the stifle in
# front, the hamstrings behind, running down to the point of the hock.
DEER_HIND = [
    ((0.090, 0.960, 0.480), (0.060, 0.160, 0.150)),
    ((0.104, 0.850, 0.482), (0.064, 0.160, 0.150)),
    ((0.116, 0.750, 0.490), (0.060, 0.135, 0.120)),
    ((0.122, 0.660, 0.505), (0.050, 0.090, 0.088)),
    ((0.125, 0.580, 0.520), (0.038, 0.052, 0.058)),
    ((0.125, 0.512, 0.533), (0.030, 0.034, 0.048)),
    ((0.125, 0.440, 0.522), (0.024, 0.029, 0.030)),
    ((0.125, 0.220, 0.472), (0.021, 0.025, 0.025)),
    ((0.125, 0.122, 0.456), (0.025, 0.030, 0.033)),
    ((0.125, 0.078, 0.441), (0.021, 0.025, 0.025)),
    ((0.125, 0.052, 0.430), (0.022, 0.026, 0.026)),
]


def leg_axis(table, side):
    return [(side * p[0], p[1], p[2], r[0], max(r[1], r[2])) for p, r in table]


def deer_legs():
    """Each leg turns about the point where it leaves the body — the elbow,
    the stifle — and the swing ramps in from a hand above it to the forearm
    or the gaskin, below which the leg is rigid.

    Not about the shoulder or the hip, where the bones turn. The skin of the
    chest round the top of a swinging leg has to give, and how far it is
    asked to is the swing times the distance to the pivot: about a shoulder a
    quarter of a metre above, a gallop pulled the chest beside the elbow
    eleven centimetres out of shape; about the elbow it is a centimetre or
    two, and the leg under the body swings the same."""
    return {
        1: Leg(1, (0.70, -0.340), 0.76, 0.56, leg_axis(DEER_FORE, -1)),
        2: Leg(2, (0.70, -0.340), 0.76, 0.56, leg_axis(DEER_FORE, 1)),
        3: Leg(3, (0.74, 0.490), 0.82, 0.60, leg_axis(DEER_HIND, -1)),
        4: Leg(4, (0.74, 0.490), 0.82, 0.60, leg_axis(DEER_HIND, 1)),
    }


def hoof(c, toe, a, b, leg):
    """A cloven hoof, as one: a short dark block, wider at the sole, the toe
    forward."""
    x, y, z = c
    return tube([
        {'c': (x, 0.056, z), 'a': a * 0.95, 'b': b * 0.95},
        {'c': (x, 0.030, z - toe * 0.35), 'a': a * 1.08, 'b': b * 1.15},
        {'c': (x, 0.008, z - toe * 0.6), 'a': a * 1.18, 'b': b * 1.32, 'bd': b * 1.05, 'flat': 0.4},
    ], n=7, mat='hoof', marks=None, leg=leg, dome=(0.2, 0.15), ref=(1, 0, 0)).kept_loose()


def deer_field(p):
    x, y, z = p
    # the rump patch, buff, round the tail and down the backs of the thighs
    pale = blot(p, (0, 0.965, 0.645), (0.13, 0.18, 0.12), 0.3)
    pale = max(pale, 0.85 * blot(p, (0, 0.80, 0.60), (0.075, 0.13, 0.09), 0.4))
    # legs darken towards the hoof, and the underline and brisket are darker
    # than the flanks, which is a winter red deer
    dark = 0.85 * smooth(0.66, 0.34, y)
    dark = max(dark, 0.5 * smooth(0.80, 0.66, y) * (1 - smooth(0.05, 0.15, abs(x))))
    dark = max(dark, 0.5 * blot(p, (0, 0.78, -0.55), (0.11, 0.15, 0.12), 0.5))
    return pale, dark * (1 - pale)


def deer_body():
    parts = [tube(DEER_TORSO, n=16, rings=20, mat='coat')]
    for side in (1, -1):
        for table, idx in ((DEER_FORE, 2), (DEER_HIND, 4)):
            li = idx if side > 0 else idx - 1
            parts.append(path([(side * p[0], p[1], p[2]) for p, r in table], [r for p, r in table],
                              n=7, rings=14 if table is DEER_FORE else 16, leg=li, mat='coat',
                              dome=(0.3, 0.3)))
            bottom = table[-1][0]
            parts.append(hoof((side * bottom[0], 0, bottom[2] - 0.004), 0.03, 0.022, 0.028, li))

    def tail(p, s, th):
        # dark along its top, pale beneath, over the patch
        return 0.5 * (1 - smooth(-0.2, 0.3, math.sin(th))), 0.7 * smooth(0.0, 0.6, math.sin(th))
    parts.append(path([(0, 1.050, 0.612), (0, 1.018, 0.652), (0, 0.962, 0.676), (0, 0.905, 0.684)],
                      [(0.034, 0.030), (0.036, 0.030), (0.030, 0.026), (0.014, 0.012)],
                      n=8, rings=6, marks=tail, mat='coat', ref=(1, 0, 0)))
    return parts


# The neck, in the head's frame: the origin is the pivot the browse turns
# it about, low in the front of the chest. Its base section is the whole
# root of the neck — from the front of the withers to the breast — and it
# sits inside the body however far the head goes down, which is what lets
# a browse swing the neck without heaving a hump up out of the back.
def deer_neck(stag):
    k = 1.12 if stag else 1.0
    mane = 0.06 if stag else 0.0
    return [
        {'c': (0, -0.040, 0.040), 'a': 0.060, 'b': 0.060},
        {'c': (0, 0.000, 0.000), 'a': 0.112, 'b': 0.160, 'bd': 0.168},
        {'c': (0, 0.130, -0.118), 'a': 0.110 * k, 'b': 0.128 * k, 'bd': 0.148 * k * (1 + mane),
         'tuft': mane * 0.5},
        {'c': (0, 0.265, -0.205), 'a': 0.098 * k, 'b': 0.104 * k, 'bd': 0.112 * k * (1 + 1.8 * mane),
         'tuft': mane},
        {'c': (0, 0.395, -0.272), 'a': 0.084 * k, 'b': 0.086 * k, 'bd': 0.092 * k * (1 + 1.5 * mane),
         'tuft': mane},
        {'c': (0, 0.495, -0.322), 'a': 0.074 * k, 'b': 0.074 * k, 'bd': 0.080 * k},
        {'c': (0, 0.565, -0.352), 'a': 0.064, 'b': 0.064, 'bd': 0.068},
    ]


DEER_HEAD = [
    {'c': (0, 0.598, -0.352), 'a': 0.048, 'b': 0.048},
    {'c': (0, 0.607, -0.392), 'a': 0.072, 'b': 0.060, 'bd': 0.072},
    {'c': (0, 0.594, -0.450), 'a': 0.078, 'b': 0.058, 'bd': 0.082},
    {'c': (0, 0.562, -0.510), 'a': 0.062, 'b': 0.050, 'bd': 0.078, 'pinch': 0.08},
    {'c': (0, 0.524, -0.572), 'a': 0.050, 'b': 0.045, 'bd': 0.058, 'pinch': 0.12},
    {'c': (0, 0.487, -0.627), 'a': 0.044, 'b': 0.040, 'bd': 0.047, 'pinch': 0.08},
    {'c': (0, 0.460, -0.668), 'a': 0.041, 'b': 0.037, 'bd': 0.043},
    {'c': (0, 0.446, -0.688), 'a': 0.026, 'b': 0.022, 'bd': 0.024},
]
DEER_EYE = (0.073, 0.613, -0.460)


def neckness(p):
    """1 on the neck, 0 on the head: the line from behind the poll down to
    behind the jaw, in the head's own frame."""
    x, y, z = p
    return 1 - smooth(-0.03, 0.03, -z - (0.39 + 0.5 * (0.62 - y)))


def deer_head_field(stag):
    def field(p):
        x, y, z = p
        side = 1 if x >= 0 else -1
        # the pale chin and lip, and a pale ring round the eye
        pale = 0.85 * blot(p, (0, 0.418, -0.655), (0.045, 0.034, 0.055), 0.5)
        pale = max(pale, 0.5 * blot(p, (DEER_EYE[0] * side, DEER_EYE[1], DEER_EYE[2]),
                                    (0.03, 0.026, 0.032), 0.4))
        # the bridge of the nose, and the gland in front of the eye
        dark = 0.55 * blot(p, (0, 0.52, -0.60), (0.045, 0.05, 0.09), 0.5)
        dark = max(dark, 0.75 * blot(p, (0.060 * side, 0.582, -0.505), (0.02, 0.018, 0.024), 0.5))
        if stag:
            # the winter mane: the whole neck dark, fading out where it goes
            # into the shoulders, because the body under it is a hind's too
            root = smooth(0.08, 0.24, math.hypot(y, z))
            dark = max(dark, 0.8 * neckness(p) * root)
        else:
            dark = max(dark, 0.3 * neckness(p))
        return pale, dark
    return field


def deer_ear():
    """Wide-set, long, swung out and back: the outline that says deer."""
    base = Vector((0.055, 0.648, -0.380))
    d = Vector((0.80, 0.50, 0.36)).normalized()
    pts = curve(base, d, 0.20, 6, bend=-0.25, axis=(0, 0, 1))
    widths = [0.022, 0.044, 0.058, 0.062, 0.054, 0.036, 0.009]
    thick = [0.018, 0.013, 0.011, 0.010, 0.009, 0.007, 0.004]
    sts = [{'c': p, 'a': w, 'b': t, 'cup': 0.28} for p, w, t in zip(pts, widths, thick)]
    sts[0]['cup'] = 0.0

    def role(s, th):
        return 'earInner' if math.sin(th) < -0.2 and 0.1 < s < 0.86 else 'coat'

    def edge(p, s, th):
        return 0.0, 0.6 * smooth(0.78, 0.98, s)
    return tube(sts, n=6, rings=7, ref=(0.15, 1.0, -0.2), mat=role, marks=edge, dome=(0.3, 0.5))


def antler():
    """A royal's right antler (the left is its mirror). The beam leaves the
    burr up and back and out, sweeps back over the neck and curves forward
    again at the top, the pair spreading into a wide lyre; the brow and bez
    tines reach forward low over the face, the trez halfway up, and the
    crown — the beam's own tip and two more — cups at the top. Six points,
    twelve the pair. Dark at the burr, its points worn ivory."""
    burr = Vector((0.046, 0.652, -0.410))
    beam = [(0.0, 0.0, 0.0), (0.034, 0.085, 0.050), (0.088, 0.190, 0.112), (0.158, 0.300, 0.160),
            (0.232, 0.410, 0.180), (0.288, 0.520, 0.172), (0.318, 0.618, 0.142), (0.322, 0.700, 0.100)]
    beam_pts = [tuple(burr + Vector(p)) for p in beam]
    beam_r = [(0.034, 0.034), (0.026, 0.026), (0.023, 0.023), (0.021, 0.021), (0.019, 0.019),
              (0.018, 0.018), (0.015, 0.015), (0.005, 0.005)]

    def beam_marks(p, s, th):
        return smooth(0.86, 0.99, s), 0.5 * (1 - smooth(0.0, 0.2, s))

    def tine_marks(p, s, th):
        return smooth(0.45, 0.95, s), 0.0
    pieces = [path(beam_pts, beam_r, n=6, rings=9, mat='antler', marks=beam_marks, ref=(0, 0, 1),
                   dome=(0.3, 0.6)).kept_loose()]
    up = Vector((0, 1, 0))
    for at, d, L, bend, r0 in (
        ((0.008, 0.026, 0.006), (0.18, 0.30, -1.0), 0.27, 0.65, 0.019),   # brow
        ((0.022, 0.060, 0.030), (0.32, 0.30, -1.0), 0.21, 0.55, 0.017),   # bez
        ((0.158, 0.300, 0.155), (0.15, 0.42, -1.0), 0.22, 0.50, 0.016),   # trez
        ((0.316, 0.606, 0.140), (-0.05, 0.70, -1.0), 0.16, 0.40, 0.014),  # crown, forward
        ((0.318, 0.614, 0.150), (0.60, 0.80, 0.35), 0.15, 0.25, 0.013),   # crown, out and back
    ):
        dv = Vector(d).normalized()
        pts = curve(burr + Vector(at), dv, L, 4, bend=bend, axis=tuple(dv.cross(up)))
        radii = [(r0 * (1 - 0.78 * i / 4),) * 2 for i in range(5)]
        pieces.append(path(pts, radii, n=5, rings=4, mat='antler', marks=tine_marks, ref=(0, 1, 0),
                           dome=(0.2, 0.8)).kept_loose())
    return pieces


def deer_head(stag):
    def nose_role(s, th):
        return 'nose' if s > 0.86 else 'coat'
    parts = [
        tube(deer_neck(stag), n=12, rings=8, mat='coat', tuft_k=8),
        tube(DEER_HEAD, n=12, rings=9, mat=nose_role),
    ]
    ear = deer_ear()
    parts += [ear, ear.mirrored()]
    for side in (1, -1):
        ex, ey, ez = DEER_EYE
        parts.append(blob((ex * side, ey, ez), (side, 0.1, -0.25), 0.012, 0.018, 0.016, n=6, rings=3,
                          ref=(0, 1, 0), mat='eye', marks=None).kept_loose())
    if stag:
        right = antler()
        parts += right + [p.mirrored() for p in right]
    return parts


# ===========================================================================
# THE GREY WOLF
# ===========================================================================
#
# Canis lupus of the Alpine population — the Italian lineage that came back
# over the Apennines and the Maritime Alps — in its winter coat. What
# separates a wolf from a big dog at any distance is a set of proportions:
# a chest that is deep and narrow and drops below the elbow, a tucked loin,
# legs long enough that it stands tall for its length, a big head carried
# low on a heavy neck, short rounded ears set wide, and a straight brush
# hanging to the hock rather than curled over the back. In winter the ruff
# round the neck and shoulders and the fur behind the cheeks double the
# neck's width, and that mane, the dark saddle over it and the pale cheeks
# and throat under it are the markings that make the shape read on snow.
# The Italian wolves add one more: a dark stripe down the front of each
# foreleg.

WOLF_TORSO = [
    girth(0.448, 0.660, 0.530, 0.045),
    girth(0.405, 0.702, 0.472, 0.094),
    girth(0.320, 0.726, 0.452, 0.110, pinch=0.16),
    girth(0.180, 0.716, 0.488, 0.100, pinch=0.1),
    girth(0.030, 0.726, 0.440, 0.118, pinch=0.08),
    girth(-0.120, 0.748, 0.385, 0.126, pinch=0.12),
    girth(-0.240, 0.768, 0.372, 0.124, pinch=0.16, tuft=0.015),
    girth(-0.340, 0.762, 0.405, 0.117, pinch=0.12, tuft=0.02),
    girth(-0.420, 0.722, 0.465, 0.100),
    girth(-0.470, 0.662, 0.520, 0.055),
]

# The ruff: the neck and the winter mane round it, fullest at the throat
# and behind the jaw, tufted where it hangs.
WOLF_NECK = [
    {'c': (0, 0.615, -0.250), 'a': 0.075, 'b': 0.075},
    {'c': (0, 0.652, -0.345), 'a': 0.140, 'b': 0.142, 'bd': 0.182, 'tuft': 0.04},
    {'c': (0, 0.692, -0.452), 'a': 0.136, 'b': 0.124, 'bd': 0.172, 'tuft': 0.06},
    {'c': (0, 0.724, -0.535), 'a': 0.116, 'b': 0.100, 'bd': 0.126, 'tuft': 0.055},
    {'c': (0, 0.740, -0.595), 'a': 0.090, 'b': 0.082, 'bd': 0.086},
]

WOLF_HEAD = [
    {'c': (0, 0.746, -0.575), 'a': 0.060, 'b': 0.060},
    {'c': (0, 0.758, -0.612), 'a': 0.090, 'b': 0.072, 'bd': 0.077},
    {'c': (0, 0.754, -0.656), 'a': 0.096, 'b': 0.068, 'bd': 0.082, 'tuft': 0.035},
    {'c': (0, 0.744, -0.700), 'a': 0.070, 'b': 0.058, 'bd': 0.064, 'pinch': 0.08},
    {'c': (0, 0.729, -0.745), 'a': 0.050, 'b': 0.046, 'bd': 0.054, 'rnd': 0.9},
    {'c': (0, 0.716, -0.795), 'a': 0.041, 'b': 0.039, 'bd': 0.045, 'rnd': 0.85},
    {'c': (0, 0.707, -0.840), 'a': 0.037, 'b': 0.035, 'bd': 0.039, 'rnd': 0.85},
    {'c': (0, 0.702, -0.861), 'a': 0.022, 'b': 0.020},
]
WOLF_EYE = (0.042, 0.776, -0.708)

WOLF_FORE = [
    ((0.072, 0.640, -0.292), (0.046, 0.070, 0.070)),
    ((0.082, 0.525, -0.287), (0.046, 0.066, 0.066)),
    ((0.088, 0.420, -0.278), (0.041, 0.052, 0.056)),
    ((0.091, 0.320, -0.274), (0.032, 0.036, 0.039)),
    ((0.092, 0.200, -0.273), (0.025, 0.027, 0.028)),
    ((0.092, 0.140, -0.275), (0.023, 0.025, 0.026)),
    ((0.092, 0.080, -0.283), (0.021, 0.023, 0.024)),
    ((0.092, 0.048, -0.293), (0.024, 0.026, 0.026)),
]
WOLF_HIND = [
    ((0.068, 0.620, 0.320), (0.050, 0.110, 0.110)),
    ((0.080, 0.520, 0.300), (0.056, 0.116, 0.112)),
    ((0.087, 0.420, 0.318), (0.049, 0.090, 0.086)),
    ((0.089, 0.330, 0.358), (0.036, 0.055, 0.056)),
    ((0.090, 0.250, 0.398), (0.026, 0.032, 0.040)),
    ((0.090, 0.200, 0.416), (0.022, 0.026, 0.036)),
    ((0.090, 0.140, 0.406), (0.020, 0.023, 0.024)),
    ((0.090, 0.075, 0.394), (0.020, 0.022, 0.022)),
    ((0.090, 0.045, 0.385), (0.023, 0.025, 0.025)),
]


def wolf_legs():
    return {
        1: Leg(1, (0.42, -0.280), 0.47, 0.30, leg_axis(WOLF_FORE, -1)),
        2: Leg(2, (0.42, -0.280), 0.47, 0.30, leg_axis(WOLF_FORE, 1)),
        3: Leg(3, (0.46, 0.330), 0.53, 0.34, leg_axis(WOLF_HIND, -1)),
        4: Leg(4, (0.46, 0.330), 0.53, 0.34, leg_axis(WOLF_HIND, 1)),
    }


def wolf_field(p):
    x, y, z = p
    ax = abs(x)
    # pale: the underline, the throat and chest, the cheeks and lips, the
    # insides of the legs
    pale = smooth(0.50, 0.40, y) * (1 - smooth(0.07, 0.12, ax)) * smooth(-0.46, -0.38, z) * smooth(0.40, 0.30, z)
    pale = max(pale, 0.9 * blot(p, (0, 0.56, -0.43), (0.10, 0.15, 0.10), 0.4))
    pale = max(pale, 0.85 * blot(p, (0, 0.665, -0.52), (0.09, 0.07, 0.09), 0.4))
    pale = max(pale, 0.85 * blot(p, (0.072 * (1 if x >= 0 else -1), 0.725, -0.69), (0.04, 0.035, 0.06), 0.45))
    pale = max(pale, 0.9 * blot(p, (0, 0.682, -0.79), (0.035, 0.03, 0.08), 0.5))
    if y < 0.42:
        # the inside of each leg
        leg_x = 0.091 if z < 0 else 0.089
        pale = max(pale, 0.7 * smooth(leg_x - 0.005, leg_x - 0.03, ax) * smooth(0.42, 0.34, y))
    # dark: the saddle, from the shoulders over the back to the tail, the
    # bridge of the nose, and the stripe down the front of each foreleg
    saddle = smooth(0.66, 0.73, y) * smooth(-0.42, -0.30, z) * smooth(0.47, 0.38, z)
    neck_cape = smooth(0.70, 0.78, y) * smooth(-0.60, -0.50, z) * smooth(-0.25, -0.35, z)
    dark = max(saddle, 0.7 * neck_cape)
    dark = max(dark, 0.5 * blot(p, (0, 0.76, -0.75), (0.03, 0.035, 0.07), 0.5))
    if z < -0.2 and 0.10 < y < 0.42:
        front = smooth(-0.262, -0.29, z) * smooth(0.10, 0.16, y) * smooth(0.42, 0.34, y)
        dark = max(dark, 0.65 * front)
    return pale * (1 - dark), dark


def wolf_ear():
    """Short, wide-set, rounded at the tip: a wolf's, not a shepherd's."""
    base = Vector((0.050, 0.795, -0.615))
    d = Vector((0.28, 1.0, 0.12)).normalized()
    pts = curve(base, d, 0.088, 5, bend=0.12, axis=(0, 0, 1))
    widths = [0.034, 0.033, 0.028, 0.020, 0.010, 0.003]
    thick = [0.016, 0.012, 0.010, 0.008, 0.006, 0.003]
    sts = [{'c': p, 'a': w, 'b': t, 'cup': 0.3} for p, w, t in zip(pts, widths, thick)]
    sts[0]['cup'] = 0.0

    def role(s, th):
        return 'earInner' if math.sin(th) < -0.2 and s < 0.85 else 'coat'

    def back(p, s, th):
        return 0.0, 0.5 * smooth(-0.2, 0.4, math.sin(th)) + 0.3 * smooth(0.6, 0.95, s)
    return tube(sts, n=6, rings=6, ref=(1.0, 0.0, -0.35), mat=role, marks=back, dome=(0.3, 0.5))


def wolf():
    parts = [
        tube(WOLF_TORSO, n=14, rings=18, mat='coat', tuft_k=11),
        tube(WOLF_NECK, n=14, rings=9, mat='coat', tuft_k=9),
        tube(WOLF_HEAD, n=14, rings=10, mat='coat', tuft_k=7, tuft_phase=0.6),
    ]
    ear = wolf_ear()
    parts += [ear, ear.mirrored()]
    for side in (1, -1):
        for table, idx, paw_z in ((WOLF_FORE, 2, -0.312), (WOLF_HIND, 4, 0.366)):
            li = idx if side > 0 else idx - 1
            parts.append(path([(side * p[0], p[1], p[2]) for p, r in table], [r for p, r in table],
                              n=7, rings=12 if table is WOLF_FORE else 14, leg=li, mat='coat',
                              dome=(0.3, 0.3)))
            x = side * table[-1][0][0]
            # the paw: big, as a wolf's are, an oval splayed flat for snow
            parts.append(blob((x, 0.019, paw_z - 0.006), (0, -0.2, -1), 0.037, 0.028, 0.018, n=8, rings=5,
                              leg=li, mat='coat', bd=0.019, tuft=0.03, tuft_k=4))
        ex, ey, ez = WOLF_EYE
        parts.append(blob((ex * side, ey, ez), (side * 0.8, 0.15, -0.6), 0.008, 0.012, 0.009, n=6, rings=3,
                          ref=(0, 1, 0), mat='eye', marks=None).kept_loose())

    def brush(p, s, th):
        # the brush: dark along its top and at the tip, pale beneath
        top = smooth(-0.1, 0.5, math.sin(th))
        return 0.5 * (1 - top) * (1 - smooth(0.7, 0.85, s)), max(0.55 * top, smooth(0.72, 0.9, s))
    parts.append(tube([
        {'c': (0, 0.655, 0.395), 'a': 0.030, 'b': 0.030},
        {'c': (0, 0.622, 0.458), 'a': 0.044, 'b': 0.046, 'tuft': 0.05},
        {'c': (0, 0.545, 0.528), 'a': 0.056, 'b': 0.060, 'tuft': 0.08},
        {'c': (0, 0.445, 0.572), 'a': 0.061, 'b': 0.063, 'tuft': 0.09},
        {'c': (0, 0.345, 0.596), 'a': 0.056, 'b': 0.056, 'tuft': 0.08},
        {'c': (0, 0.262, 0.607), 'a': 0.041, 'b': 0.041, 'tuft': 0.06},
        {'c': (0, 0.218, 0.608), 'a': 0.016, 'b': 0.016},
    ], n=10, rings=12, mat='coat', marks=brush, tuft_k=5, ref=(1, 0, 0)))
    # the nose
    parts.append(blob((0, 0.708, -0.864), (0, 0.2, -1), 0.012, 0.019, 0.015, n=8, rings=4,
                      mat='nose', marks=None).kept_loose())
    return parts


# ---------------------------------------------------------------------------
# Building, previewing, exporting
# ---------------------------------------------------------------------------

# [base, pale, dark] per role — preview only; the game keeps its own copy in
# js/wildlife.js, which is the one that counts.
LOOKS = {
    'hare': {
        'fur': ['#eef3fb', '#c9d3e3', '#1b1f27'],
        'earInner': ['#e6dcdc', '#e6dcdc', '#1b1f27'],
        'eye': ['#16110e'],
        'nose': ['#8f7d7d'],
    },
    'deer': {
        'coat': ['#6f6357', '#d2c4a4', '#2e2722'],
        'earInner': ['#b8ab98', '#b8ab98', '#2e2722'],
        'hoof': ['#221c17'],
        'eye': ['#120f0d'],
        'nose': ['#1f1a17'],
        'antler': ['#5e4b39', '#e8dfca', '#2e241b'],
    },
    'wolf': {
        'coat': ['#8d8579', '#dcd3c2', '#302c28'],
        'earInner': ['#d2c9b8', '#d2c9b8', '#302c28'],
        'eye': ['#4a3214'],
        'nose': ['#141312'],
    },
}


def build():
    col = collection('wildlife')
    clear_collection(col)
    out = {}
    hare_ob = realise('wild_hare', hare(), col, field=hare_field)
    hare_ob['eyes'] = [[-HARE_EYE[0], HARE_EYE[1], HARE_EYE[2]], list(HARE_EYE)]
    out['wild_hare'] = hare_ob
    legs = deer_legs()
    body = realise('wild_deerBody', deer_body(), col, field=deer_field, legs=legs)
    body['withers'] = list(DEER_WITHERS)
    body['legs'] = [list(legs[i].pivot) for i in (1, 2, 3, 4)]
    out['wild_deerBody'] = body
    out['wild_hindHead'] = realise('wild_hindHead', deer_head(False), col, field=deer_head_field(False))
    out['wild_stagHead'] = realise('wild_stagHead', deer_head(True), col, field=deer_head_field(True))
    legs = wolf_legs()
    wolf_ob = realise('wild_wolf', wolf(), col, field=wolf_field, legs=legs)
    wolf_ob['legs'] = [list(legs[i].pivot) for i in (1, 2, 3, 4)]
    out['wild_wolf'] = wolf_ob
    for name, ob in out.items():
        print(name, tris(ob), 'tris', len(ob.data.vertices), 'verts')
        ob.hide_render = True
    return out


def preview_material(role, animal):
    look = LOOKS[animal].get(role, ['#ff00ff'])
    name = 'pv.%s.%s' % (animal, role)
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    base = hex_rgba(look[0])
    pale = hex_rgba(look[1] if len(look) > 1 else look[0])
    dark = hex_rgba(look[2] if len(look) > 2 else look[0])
    c_base = nt.nodes.new('ShaderNodeRGB')
    c_base.outputs[0].default_value = base
    c_pale = nt.nodes.new('ShaderNodeRGB')
    c_pale.outputs[0].default_value = pale
    c_dark = nt.nodes.new('ShaderNodeRGB')
    c_dark.outputs[0].default_value = dark
    a_pale = nt.nodes.new('ShaderNodeAttribute')
    a_pale.attribute_name = '_PALE'
    a_dark = nt.nodes.new('ShaderNodeAttribute')
    a_dark.attribute_name = '_DARK'
    m1 = nt.nodes.new('ShaderNodeMix')
    m1.data_type = 'RGBA'
    nt.links.new(a_pale.outputs['Fac'], m1.inputs[0])
    nt.links.new(c_base.outputs[0], m1.inputs[6])
    nt.links.new(c_pale.outputs[0], m1.inputs[7])
    m2 = nt.nodes.new('ShaderNodeMix')
    m2.data_type = 'RGBA'
    nt.links.new(a_dark.outputs['Fac'], m2.inputs[0])
    nt.links.new(m1.outputs[2], m2.inputs[6])
    nt.links.new(c_dark.outputs[0], m2.inputs[7])
    nt.links.new(m2.outputs[2], bsdf.inputs['Base Color'])
    glossy = role in ('eye', 'nose', 'hoof')
    bsdf.inputs['Roughness'].default_value = 0.25 if glossy else 0.85
    if not glossy and 'Sheen Weight' in bsdf.inputs:
        bsdf.inputs['Sheen Weight'].default_value = 0.4
    return m


def preview_copy(src, name, loc, yaw, col, animal, parent=None, stride=None, pitch=0.0):
    """A painted copy of a node. `stride` = (amplitude, time, phases) bends
    its legs the way the game's shader does, to see that they swing clean;
    `pitch` turns it about its own X, which for a head is the browse."""
    me = src.data.copy()
    for k, mat in enumerate(me.materials):
        me.materials[k] = preview_material(mat.name.split('.')[0], animal)
    if stride:
        amp, t, phases = stride
        pivots = src['legs']
        legs = me.attributes['_LEG'].data
        sw = me.attributes['_SWING'].data
        for i, v in enumerate(me.vertices):
            li = int(round(legs[i].value))
            if not li:
                continue
            py, pz = pivots[li - 1]
            a = amp * sw[i].value * math.sin(t + phases[li - 1])
            # game (y, z) = (blender z, −blender y)
            gy, gz = v.co.z - py, -v.co.y - pz
            c, s = math.cos(a), math.sin(a)
            ny, nz = c * gy - s * gz, s * gy + c * gz
            v.co.z = py + ny
            v.co.y = -(pz + nz)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (pitch, 0, yaw)
    if parent:
        ob.parent = parent
    return ob


def preview_deer(models, out_dir, head, file_name, browse):
    """Three deer: standing alert side on, mid-gallop from the front
    quarter, and browsing from the rear quarter. The gait and the browse
    are the game's (`DEER_GAIT`, `DEER_BROWSE`/`STAG_BROWSE` in
    js/wildlife.js)."""
    col = collection('wl_preview')
    clear_collection(col)
    phases = [0, 0.5, math.pi, math.pi + 0.5]
    wx, wy, wz = DEER_WITHERS
    poses = [((-1.55, 0.6, 0), -math.pi / 2, None, 0.0),
             ((0.0, 0.0, 0), math.pi + 0.7, (0.5, 1.1, phases), 0.0),
             ((1.6, 0.6, 0), -0.75, None, browse)]
    for k, (loc, yaw, stride, browse) in enumerate(poses):
        body = preview_copy(models['wild_deerBody'], 'deer.%d' % k, loc, yaw, col, 'deer', stride=stride)
        preview_copy(models[head], 'deer.head.%d' % k, B((wx, wy, wz)), 0.0, col, 'deer', parent=body,
                     pitch=browse)
    preview_stage((1600, 900), (0, 0.4, 1.0), 7.8, 1.5, lens=50)
    render(os.path.join(out_dir, file_name))


def preview_wolf(models, out_dir):
    """Three wolves: standing side on, trotting from the front quarter, and
    trotting from the rear quarter — the view the rider gets of a pack."""
    col = collection('wl_preview')
    clear_collection(col)
    trot = (0.42, 1.2, [0, math.pi, math.pi, 0])
    preview_copy(models['wild_wolf'], 'wolf.side', (-1.25, 0.4, 0), -math.pi / 2, col, 'wolf')
    preview_copy(models['wild_wolf'], 'wolf.front34', (0.05, 0, 0), math.pi + 0.7, col, 'wolf', stride=trot)
    preview_copy(models['wild_wolf'], 'wolf.rear34', (1.3, 0.4, 0), -0.75, col, 'wolf', stride=trot)
    preview_stage((1600, 900), (0, 0.3, 0.45), 5.0, 1.0, lens=50)
    render(os.path.join(out_dir, 'wolf.png'))


def preview_stage(res, target, dist, height, lens=60):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Base Contrast'
    except Exception:
        pass
    col = collection('wl_stage')
    clear_collection(col)
    me = bpy.data.meshes.new('wl_floor')
    me.from_pydata([(-400, -400, 0), (400, -400, 0), (400, 400, 0), (-400, 400, 0)], [], [(0, 1, 2, 3)])
    fm = bpy.data.materials.get('wl_floor') or bpy.data.materials.new('wl_floor')
    fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.62, 0.64, 0.67, 1)
    fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    me.materials.append(fm)
    fl = bpy.data.objects.new('wl_floor', me)
    col.objects.link(fl)
    for name, energy, rot, ang in (('wl_sun', 3.2, (0.9, 0.15, -0.6), 0.08),
                                   ('wl_fill', 0.7, (1.2, 0.0, 2.6), 0.6)):
        ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.angle = ang
        lo = bpy.data.objects.new(name, ld)
        col.objects.link(lo)
        lo.rotation_euler = rot
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.78, 0.80, 0.83, 1)
    bg.inputs[1].default_value = 0.8
    cd = bpy.data.cameras.get('wl_cam') or bpy.data.cameras.new('wl_cam')
    cd.lens = lens
    cam = bpy.data.objects.new('wl_cam', cd)
    col.objects.link(cam)
    cam.location = (target[0], target[1] - dist, target[2] + height)
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    return col


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path)


def preview_hare(models, out_dir):
    col = collection('wl_preview')
    clear_collection(col)
    # facing −Z in the game is facing +Y in Blender; the camera looks +Y,
    # so yaw π/2 shows the left side (head to the right), and a 3/4 view
    # from the front-left
    preview_copy(models['wild_hare'], 'hare.side', (-0.62, 0.1, 0), -math.pi / 2, col, 'hare')
    preview_copy(models['wild_hare'], 'hare.front34', (0.05, 0, 0), math.pi + 0.6, col, 'hare')
    preview_copy(models['wild_hare'], 'hare.rear34', (0.68, 0.1, 0), -0.7, col, 'hare')
    preview_stage((1600, 900), (0, 0, 0.16), 2.6, 0.85, lens=50)
    render(os.path.join(out_dir, 'hare.png'))


def export(path):
    col = collection('wildlife')
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in col.objects:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=False,
        export_materials='EXPORT', export_attributes=True, export_extras=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False,
    )
    return os.path.getsize(path)


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    models = build()
    if '--out' in args:
        out = args[args.index('--out') + 1]
        os.makedirs(out, exist_ok=True)
        print(export(os.path.join(out, 'alpine-wildlife.glb')))
    if '--preview' in args:
        pdir = args[args.index('--preview') + 1]
        os.makedirs(pdir, exist_ok=True)
        # `--only hare,stag` draws just those sheets
        only = args[args.index('--only') + 1].split(',') if '--only' in args else None
        sheets = {
            'hare': lambda: preview_hare(models, pdir),
            'hind': lambda: preview_deer(models, pdir, 'wild_hindHead', 'deer-hind.png', -1.85),
            'stag': lambda: preview_deer(models, pdir, 'wild_stagHead', 'deer-stag.png', -1.75),
            'wolf': lambda: preview_wolf(models, pdir),
        }
        for key, draw in sheets.items():
            if only is None or key in only:
                draw()
