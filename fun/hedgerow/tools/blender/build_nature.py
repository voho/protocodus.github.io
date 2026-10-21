"""Hedgerow — nature set v2: realistic trees (+ impostor LODs), bocage
hedges, bushes, ground cover with alpha-card foliage, sculpted rocks, logs.

    Blender --background --factory-startup --python build_nature.py \
        [-- [node ...] [--no-previews] [--scenes] [--fast]]

* Foliage, grass, ferns, ivy, litter: alpha cards on three atlases rendered
  here from modelled leaves / needles / blades (nature_parts.make_atlases),
  material alphaMode MASK.
* Trunks, branches, stems, earth banks, rocks, logs: built as geometry with
  palette keys, then baked by bake.bake_model (procedural bark, granite,
  end grain... from surfaces.py and the recipes registered in nature_parts).
* `*_lod`: three crossed planes textured from orthographic renders of the
  finished tree (one shared impostor atlas).

Node names after `--` limit the previews to those nodes (the GLB is always
complete). `--scenes` renders the ground-level scene previews. Deterministic.
"""
import os, sys, math, random, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
if '--fast' in sys.argv:
    os.environ['HEDGEROW_FAST'] = '1'
import bpy
from mathutils import Vector, Matrix, Quaternion
import kit
import bake
import nature_parts as P
from nature_parts import Mesh, TAU, UP, lerp, sstep, clamp, polar

FAST = bake.FAST
GLB = os.path.join(kit.MODELS, 'nature.glb')
NOTES = os.path.join(kit.HERE, 'notes', 'nature.md')
PREV = os.path.join(kit.PREVIEWS, 'nature')
T0 = time.time()

ATL = {}
CARD_KEYS = ('nat_conifer', 'nat_leaf', 'nat_ground', 'nat_impostor', 'nat_far')


def weight_islands(focus):
    """bake.unwrap hook: shrink the UV islands that sit high in a tree, so
    the packer gives the lower trunk and roots (seen from 1-3 m) more
    texels. Runs in object mode on the active 'bake' layer."""
    zmax, k = focus

    def fn(obj):
        import bmesh as _bm
        bm = _bm.new()
        bm.from_mesh(obj.data)
        uv = bm.loops.layers.uv.get('bake') or bm.loops.layers.uv.active
        faces = list(bm.faces)
        parent = list(range(len(faces)))
        idx = {f: i for i, f in enumerate(faces)}

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) != 2:
                continue
            f1, f2 = lf
            l1 = [l for l in f1.loops if l.edge == e][0]
            l2 = [l for l in f2.loops if l.edge == e][0]
            a1, b1 = l1[uv].uv, l1.link_loop_next[uv].uv
            a2, b2 = l2[uv].uv, l2.link_loop_next[uv].uv
            if (a1 - b2).length < 1e-5 and (b1 - a2).length < 1e-5:
                r1, r2 = find(idx[f1]), find(idx[f2])
                if r1 != r2:
                    parent[r1] = r2
        groups = {}
        for i, f in enumerate(faces):
            groups.setdefault(find(i), []).append(f)
        for fs in groups.values():
            zc = sum(f.calc_center_median().z for f in fs) / len(fs)
            if zc < zmax:
                continue
            loops = [l for f in fs for l in f.loops]
            c = sum((l[uv].uv for l in loops), Vector((0, 0))) / len(loops)
            for l in loops:
                l[uv].uv = c + (l[uv].uv - c) * k
        bm.to_mesh(obj.data)
        bm.free()
    return fn


SMALL = FAST and not os.environ.get('NATURE_FULL_ATLAS')


def atlas(name):
    if not ATL:
        ATL.update(P.make_atlases(1024 if SMALL else 2048))
    return ATL[name]


def dirv(az, el):
    return Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))


def make(m, name, colliders=None, tpm=None, size=None, color_fn=None, extra=None, post=None, nsize=None,
         scale_islands=None, tags=False):
    """Build the node object from a Mesh; bake the palette-keyed part (if any)
    while the card faces keep their atlas material."""
    obj = m.build(name, color_fn=color_fn, tags=tags)
    if post:
        obj = post(obj) or obj
    if colliders is not None:
        kit.set_colliders(obj, colliders)
    for k, v in (extra or {}).items():
        kit.set_extra(obj, k, v)
    baked = [s for s in obj.material_slots if s.material and not s.material.get('card')]
    if baked and (tpm or size):
        r = bake.bake_model(obj, tpm=tpm or 110, size=size, keep=CARD_KEYS, scale_islands=scale_islands,
                            normal_size=None if FAST else (nsize or (size // 2 if size and size >= 1024 else None)))
        obj = r['object']
        obj.name = name
        obj.data.name = name
    return obj


# ==========================================================================
# Conifers

def conifer_normal(axis):
    def fn(q):
        d = q - axis(q.z)
        d.z = 0
        if d.length < 1e-4:
            d = Vector((1, 0, 0))
        return (d.normalized() * 0.75 + UP * 0.65).normalized()
    return fn


def roots(m, axis, r0, rnd, n=5, mat=0, reach=1.6, depth=0.12):
    tag0, m.tag = m.tag, P.TAG_ROOT
    ph = rnd.uniform(0, TAU)
    for i in range(n):
        a = ph + TAU * i / n + rnd.uniform(-0.25, 0.25)
        d = polar(1.0, a)
        L = r0 * reach * rnd.uniform(1.6, 2.6)
        p0 = axis(0.0) + d * r0 * 0.4 + UP * r0 * 0.9
        pts = [p0, p0 + d * L * 0.45 - UP * r0 * 0.55, p0 + d * L - UP * (r0 * 0.9 + depth)]
        P.tube(m, pts, [r0 * 0.42, r0 * 0.24, 0.0], sides=5, mat=mat, ao=[0.6, 0.55, 0.5])
    m.tag = tag0


def conifer(name, seed, H, R, z0, r0, kind='spruce', lean=(0.0, 0.0), step=1.0, kmax=1.75, sparse=1.0):
    """Norway spruce (kind 'spruce': drooping branches with up-turned tips and
    hanging 'comb' branchlets) or spruce-fir (kind 'fir': flat, layered
    horizontal tiers of two-ranked sprays)."""
    rnd = random.Random(seed)
    A = atlas('nat_conifer')
    m = Mesh(['bark_spruce' if kind == 'spruce' else 'bark_fir', A.material])
    lx, ly = lean

    def axis(z):
        f = (max(z, 0.0) / H) ** 1.6
        return Vector((lx * f, ly * f, z))
    nfn = conifer_normal(axis)
    zs = [0.0, 0.16, 0.5, 1.3, 3.0, z0 + 1.0, H * 0.45, H * 0.62, H * 0.8, H * 0.92, H - 0.2]
    rr = [r0, r0 * 0.93, r0 * 0.85, r0 * 0.8, r0 * 0.75, r0 * 0.68, r0 * 0.5, r0 * 0.36, r0 * 0.2, r0 * 0.09, 0.0]
    m.tag = P.TAG_TRUNK
    P.tube(m, [axis(z) for z in zs], rr, sides=10, mat=0, rfn=P.flare_fn(6, 0.85, rnd.uniform(0, TAU), rings=2, sharp=3))
    roots(m, axis, r0, rnd, n=6)

    def Rz(z):
        t = clamp((z - z0) / (H - z0))
        return R * (1 - t) ** 0.92 * (0.82 + 0.18 * sstep(0.0, 0.1, t)) + 0.2

    # dead lower branches (spruces keep them): grey stubs, some with dead twig cards
    z = 1.7
    while z < z0 - 0.2:
        for b in range(3):
            if rnd.random() < 0.35:
                continue
            az = rnd.uniform(0, TAU)
            L = rnd.uniform(0.3, 1.0) * (0.6 + 0.6 * z / z0)
            d = dirv(az, rnd.uniform(-0.45, -0.1))
            p0 = axis(z)
            m.tag = P.TAG_TWIG
            P.tube(m, [p0, p0 + d * (r0 + L)], [0.03, 0.012], sides=3, mat=0, ao=0.7)
            if L > 0.55 and rnd.random() < 0.6:
                P.card(m, A, 'dead', p0 + d * r0, d, P.basis(d), k=L * 1.4, mat=1, ao=0.45, ao_tip=0.6,
                       normal=nfn)
        z += rnd.uniform(0.35, 0.6)

    # live whorls
    z = z0
    wi = 0
    while z < H - 1.1:
        t = (z - z0) / (H - z0)
        nb = 6 if t < 0.5 else (5 if t < 0.8 else 4)
        if H > 22:
            nb += 1
        if t > 0.08 and wi % 2:          # dense dark masses round the trunk: no see-through
            q = axis(z)
            m.card_keep = True                      # the _mid keeps the inner masses as they are
            for sd in (0.0, math.pi / 2):
                S0 = Vector((math.cos(wi * 1.3 + sd), math.sin(wi * 1.3 + sd), 0.0))
                P.card(m, A, 'spruce_c' if kind == 'spruce' else 'fir_c', q - UP * Rz(z) * 0.35, UP, S0,
                       k=clamp(Rz(z) / 1.1, 0.7, 2.6), mat=1, ao=0.3, ao_tip=0.5, normal=nfn)
            m.card_keep = False
        ph = wi * 2.4 + rnd.uniform(-0.3, 0.3)
        for b in range(nb):
            az = ph + TAU * b / nb + rnd.uniform(-0.25, 0.25)
            L = Rz(z) * rnd.uniform(0.84, 1.04)
            dh = Vector((math.cos(az), math.sin(az), 0.0))
            if kind == 'spruce':
                el, sag, up = lerp(-0.2, 0.55, t ** 0.8), lerp(0.45, 0.12, t), lerp(0.4, 0.2, t)
            else:
                el, sag, up = lerp(-0.06, 0.35, t ** 1.3), lerp(0.12, 0.03, t), 0.12
            base = axis(z)

            def dv(e):
                return dh * math.cos(e) + UP * math.sin(e)
            p1 = base + dv(el) * L * 0.4
            p2 = p1 + dv(el - sag) * L * 0.35
            p3 = p2 + dv(el - sag + up) * L * 0.25
            path = [base, p1, p2, p3]
            rb = max(0.022, lerp(0.075, 0.03, t) * math.sqrt(L / R))
            if L > 1.1 and t < 0.65:
                m.tag = P.TAG_LIMB
                P.tube(m, path, [rb, rb * 0.6, rb * 0.3, 0.0], sides=4 if t < 0.3 else 3, mat=0, ao=0.75)
            elif L > 0.7:
                m.tag = P.TAG_BRANCH
                P.tube(m, [path[0], path[2], path[3]], [rb * 0.8, rb * 0.35, 0.0], sides=3, mat=0, ao=0.75)
            a0 = lerp(0.35, 0.7, t)
            kk = clamp(L / 1.5, 0.85, kmax) * rnd.uniform(0.9, 1.08)
            clen = 1.24 * kk
            n_s = max(1, int(math.ceil((L * 0.75) / (clen * 0.8))))
            sprays = ('spruce_a', 'spruce_b', 'spruce_d') if kind == 'spruce' else ('fir_a', 'fir_b')
            for k in range(n_s):
                s = 1.0 - (k + 0.15) * (clen * 0.8) / max(L, 0.01)     # from the tip inwards
                s = max(0.25, s)
                q, d = P.along3(path, s)
                yaw = rnd.uniform(-0.25, 0.25)
                D = Quaternion(UP, yaw) @ d
                D = (D + UP * (0.06 if kind == 'fir' else rnd.uniform(-0.05, 0.1))).normalized()
                rolls = (rnd.uniform(-0.35, 0.35), rnd.choice((-1, 1)) * rnd.uniform(1.0, 1.4))
                if kind == 'fir':
                    rolls = (rnd.uniform(-0.2, 0.2), rnd.choice((-1, 1)) * rnd.uniform(0.55, 0.85))
                kq = kk * (1.0 if k == 0 else 0.9)
                start = q - D * (clen * (0.85 if k == 0 else 0.6))
                m.card_group = ('pair', len(m.cards))           # a crossed pair stays together in the _mid
                for ri, roll in enumerate(rolls):
                    m.card_pref = ri == 1                   # the steep one shows from the side: the _mid keeps it
                    S = Quaternion(D, roll) @ P.basis(D)
                    P.card(m, A, rnd.choice(sprays), start, D, S, k=kq * (1.0 if ri == 0 else 0.85), segs=2,
                           droop=0.2 if kind == 'spruce' else 0.05, mat=1, ao=a0 * (0.8 if k else 0.9),
                           ao_tip=lerp(0.8, 1.0, t) * (0.9 if k else 1.0), normal=nfn)
                m.card_group = None
                m.card_pref = False
        z += lerp(0.5, 0.36, t) * rnd.uniform(0.9, 1.1) * (1.15 if kind == 'fir' else 1.0) * step * sparse
        wi += 1
    top = axis(H - 1.5)
    m.card_keep = True
    for sd in (Vector((1, 0, 0)), Vector((0, 1, 0))):
        P.card(m, A, 'spruce_b' if kind == 'spruce' else 'fir_a', top, (axis(H) - top).normalized(), sd, k=1.25,
               mat=1, ao=0.8, ao_tip=1.0, normal=nfn)
    m.card_keep = False
    coll = [kit.collider_cyl((0, 0, 0), round(r0 * 1.05, 3), round(H * 0.75, 2))]
    return m, coll


def scots_pine(name, seed, H, R, z0, r0, lean=(0.3, 0.2)):
    """Scots pine: tall, slightly sinuous bare trunk (orange bark above),
    a high irregular crown of branches ending in clusters of needle brushes."""
    rnd = random.Random(seed)
    A = atlas('nat_conifer')
    m = Mesh(['bark_scots', A.material])
    lx, ly = lean

    def axis(z):
        f = max(z, 0.0) / H
        return Vector((lx * f * f + 0.15 * math.sin(f * 5.2), ly * f * f + 0.08 * math.sin(f * 3.1 + 1), z))
    cen = axis(H - 3.0)
    nfn = P.crown_normal(cen, (R, R, (H - z0) * 0.6), up=0.5)
    zs = [0.0, 0.18, 0.55, 1.5, 3.5, 6.0, 9.0, 12.0, 15.0, H - 2.2, H - 0.6]
    rr = [r0, r0 * 0.92, r0 * 0.85, r0 * 0.8, r0 * 0.75, r0 * 0.68, r0 * 0.6, r0 * 0.5, r0 * 0.36, r0 * 0.2, 0.0]
    m.tag = P.TAG_TRUNK
    P.tube(m, [axis(z) for z in zs], rr, sides=10, mat=0, rfn=P.flare_fn(5, 0.8, rnd.uniform(0, TAU), rings=2, sharp=3))
    roots(m, axis, r0, rnd, n=5)
    m.tag = P.TAG_TWIG
    for i in range(9):                       # self-pruned stubs
        z = rnd.uniform(3.0, z0 - 0.3)
        d = dirv(rnd.uniform(0, TAU), rnd.uniform(-0.3, 0.1))
        p0 = axis(z)
        P.tube(m, [p0, p0 + d * (r0 + rnd.uniform(0.15, 0.5))], [0.035, 0.022], sides=3, mat=0, end='flat', ao=0.7)

    def cluster(p, d, n, k):
        for j in range(n):
            D = (d * 0.8 + UP * 0.55 + Vector((rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(-0.2, 0.5)))).normalized()
            S = Quaternion(D, rnd.uniform(-0.6, 0.6)) @ P.basis(D)
            P.card(m, A, rnd.choice(('pine_a', 'pine_b', 'pine_c')), p - D * 0.15 * k, D, S,
                   k=k * rnd.uniform(0.85, 1.15), segs=2, droop=0.15, mat=1, ao=0.72, ao_tip=1.0, normal=nfn)
    nb = 11
    a0 = rnd.uniform(0, TAU)
    for i in range(nb):
        t = i / (nb - 1)
        z = lerp(z0, H - 1.6, t ** 0.85)
        az = a0 + i * 2.4 + rnd.uniform(-0.3, 0.3)
        L = lerp(R * 1.0, R * 0.45, t) * rnd.uniform(0.8, 1.1)
        el = lerp(0.55, 0.85, t) + rnd.uniform(-0.1, 0.1)
        base = axis(z)
        dh = Vector((math.cos(az), math.sin(az), 0))
        p1 = base + (dh * math.cos(el) + UP * math.sin(el)) * L * 0.45
        p2 = p1 + (dh * math.cos(el * 0.4) + UP * math.sin(el * 0.4)) * L * 0.35
        p3 = p2 + (dh * math.cos(0.15) + UP * math.sin(0.15)) * L * 0.25
        path = [base, p1, p2, p3]
        rb = lerp(0.1, 0.05, t)
        m.tag = P.TAG_LIMB
        P.tube(m, path, [rb, rb * 0.7, rb * 0.45, rb * 0.25], sides=5, mat=0, end='flat', ao=0.75)
        cluster(p3, (p3 - p2).normalized(), 8, 1.5)
        for j in range(6 if t < 0.7 else 4):
            q, d = P.along3(path, rnd.uniform(0.45, 0.9))
            sd = P.perp(d, rnd, prefer=UP * 0.5)
            L2 = rnd.uniform(0.7, 1.4) * (1.1 - 0.4 * t)
            e = q + (d * 0.5 + sd * 0.7 + UP * 0.25).normalized() * L2
            m.tag = P.TAG_BRANCH
            P.tube(m, [q, q.lerp(e, 0.5) + UP * 0.08, e], [rb * 0.45, rb * 0.3, 0.0], sides=3, mat=0, ao=0.7)
            cluster(e, (e - q).normalized(), 6, 1.4)
            cluster(q.lerp(e, 0.5), (e - q).normalized(), 3, 1.2)
    cluster(axis(H - 0.9), UP, 8, 1.5)
    coll = [kit.collider_cyl((0, 0, 0), round(r0 * 1.05, 3), round(H * 0.7, 2))]
    return m, coll


# ==========================================================================
# Broadleaves: a recursive branch system fitted into a crown envelope; leaf
# cards at the shoot ends (clumped), bark baked.

def grow(rnd, start, d0, L, r, depth, spec, segs, tips):
    lv = spec['levels'][depth]
    n = lv.get('segs', 3)
    pts = [start.copy()]
    d = d0.normalized()
    for i in range(n):
        wob = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * lv.get('wobble', 0.25)
        d = (d + wob + UP * lv.get('up', 0.0) - UP * lv.get('droop', 0.0) * (i + 1) / n).normalized()
        pts.append(pts[-1] + d * (L / n))
    last = depth == len(spec['levels']) - 1
    radii = [max(lv.get('rmin', 0.01), r * (1 - (1 - lv.get('taper', 0.55)) * i / n)) for i in range(n + 1)]
    if last:
        radii[-1] = 0.0
    segs.append(dict(pts=pts, radii=radii, depth=depth, sides=lv.get('sides', 4)))
    if last:
        tips.append((pts[-1], d, depth, pts))
        return
    if lv.get('tip_leaves'):
        tips.append((pts[-1], d, depth, pts))
    nc = lv['children']
    if isinstance(nc, tuple):
        nc = rnd.randint(*nc)
    for c in range(nc):
        s = rnd.uniform(*lv.get('at', (0.35, 1.0)))
        p, dp = P.along3(pts, s)
        out = Vector((p.x, p.y, 0.0))
        out = out.normalized() if out.length > 0.2 else Vector((math.cos(c * 2.4), math.sin(c * 2.4), 0))
        side = P.perp(dp, rnd, prefer=out * lv.get('outward', 0.8))
        ang = math.radians(rnd.uniform(*lv.get('angle', (30, 55))))
        cd = (dp * math.cos(ang) + side * math.sin(ang)).normalized()
        nl = spec['levels'][depth + 1]
        cL = L * rnd.uniform(*nl['len']) * (1.0 - 0.35 * s * nl.get('shorten', 0.0))
        cr = max(nl.get('rmin', 0.01), lerp(radii[0], radii[-1] if radii[-1] > 0 else radii[0] * 0.3, s) * nl.get('rk', 0.6))
        grow(rnd, p - dp * 0.02, cd, cL, cr, depth + 1, spec, segs, tips)


def broadleaf(name, seed, spec, sparse=1.0):
    rnd = random.Random(seed)
    A = atlas('nat_leaf')
    H, R, r0 = spec['H'], spec['R'], spec['r0']
    m = Mesh([spec['bark'], A.material])
    F = Vector((spec['lean'][0], spec['lean'][1], spec['fork']))
    trunk = [Vector((0, 0, 0)), Vector((0, 0, 0.3)), Vector((F.x * 0.1, F.y * 0.1, 1.2)),
             Vector((F.x * 0.5, F.y * 0.5, F.z * 0.6)), F]
    if spec.get('leader'):
        trunk += [F + Vector((F.x * 0.1, F.y * 0.1, (H - F.z) * 0.35)), F + Vector((F.x * 0.15, F.y * 0.15, (H - F.z) * 0.62))]
    segs, tips = [], []
    tr = [r0, r0 * 0.93, r0 * 0.86, r0 * 0.8, r0 * 0.74] + ([r0 * 0.5, r0 * 0.3] if spec.get('leader') else [])
    # limbs from the fork (and along the leader)
    lv0 = spec['levels'][0]
    nl = lv0['n']
    a0 = rnd.uniform(0, TAU)
    for j in range(nl):
        if spec.get('leader'):
            s = lerp(0.0, 1.0, j / max(1, nl - 1)) ** 0.8
            q, dq = P.along3(trunk[3:], s)
            rr = lerp(tr[3], tr[-1], s) * 0.62
        else:
            q, rr = F, r0 * 0.62
        az = a0 + j * 2.4 + rnd.uniform(-0.3, 0.3)
        el = math.radians(rnd.uniform(*lv0['el']))
        if spec.get('center') and j < spec['center']:
            el = math.radians(rnd.uniform(68, 80))     # limbs carrying the top of the dome
        d = dirv(az, el)
        L = rnd.uniform(*lv0['len'])
        if spec.get('leader'):
            L *= lerp(1.0, 0.55, j / max(1, nl - 1))
        grow(rnd, q - UP * 0.1, d, L, rr, 0, spec, segs, tips)
    # fit the branch system into the crown (scale about the fork)
    allp = sorted(math.hypot(t[0].x, t[0].y) for t in tips)
    hx = allp[int(len(allp) * 0.9)] + spec['card'] * 0.45        # 90th percentile: one long limb may stick out
    top = max(t[0].z for t in tips) + spec['card'] * 0.5
    sh, sv = R / hx, (H - F.z) / max(0.1, top - F.z)
    sh = sv = min(sh, sv * spec.get('stretch', 1.15))     # (near) uniform: keep the branch angles

    def fit(p):
        d = p - F
        return F + Vector((d.x * sh, d.y * sh, d.z * sv))
    for sg in segs:
        sg['pts'] = [fit(p) for p in sg['pts']]
    tips = [(fit(p), d, dep, [fit(x) for x in pts]) for p, d, dep, pts in tips]
    if spec.get('leader'):
        trunk = [trunk[0], trunk[1], trunk[2], trunk[3], fit(trunk[4]), fit(trunk[5]), fit(trunk[6])]
        tr[-1] = r0 * 0.25
        trunk.append(trunk[-1] + (trunk[-1] - trunk[-2]).normalized() * 0.6)
        tr.append(0.0)
    else:
        trunk.append(F + UP * 0.7)
        tr.append(0.0)
    m.tag = P.TAG_TRUNK
    P.tube(m, trunk, tr, sides=10, mat=0, rfn=P.flare_fn(5, spec.get('flare', 0.7), rnd.uniform(0, TAU), rings=2,
                                                           sharp=2.5))
    roots(m, lambda z: Vector((0, 0, z)), r0, rnd, n=6 if r0 > 0.35 else 5, reach=1.4)
    if spec.get('ivy'):
        ivy_trunk(m, A, rnd, r0 * 1.12, *spec['ivy'])
    for sg in segs:
        m.tag = (P.TAG_LIMB, P.TAG_BRANCH)[sg['depth']] if sg['depth'] < 2 else P.TAG_TWIG
        P.tube(m, sg['pts'], sg['radii'], sides=sg['sides'], mat=0, ao=[lerp(0.7, 0.9, i / len(sg['pts']))
                                                                     for i in range(len(sg['pts']))])
    # leaf anchors: along the outer part of every branch, plus the shoot tips
    keys = spec['tiles']
    hang = spec.get('hang', False)
    anchors = []
    sp = spec.get('spacing', 0.5)
    for sg in segs:
        if sg['depth'] == 0 and len(spec['levels']) > 2:
            s0 = spec.get('s0_limb', 0.75)
        else:
            s0 = spec.get('s0', 0.3)
        L = sum((sg['pts'][i + 1] - sg['pts'][i]).length for i in range(len(sg['pts']) - 1))
        n = max(1, int(L * (1 - s0) / sp))
        for i in range(n):
            s_ = s0 + (1 - s0) * (i + rnd.uniform(0.2, 0.8)) / n
            p, d = P.along3(sg['pts'], s_)
            anchors.append((p, d))
    for (p, d, dep, pts) in tips:
        anchors.append((p, d))
        anchors.append((p, d))
    # the crown ellipsoid from where the leaves actually are (normals, occlusion)
    ax = [p for p, d in anchors]
    lo = Vector((min(p.x for p in ax), min(p.y for p in ax), min(p.z for p in ax)))
    hi = Vector((max(p.x for p in ax), max(p.y for p in ax), max(p.z for p in ax)))
    cen = (lo + hi) / 2
    R = max(hi.x - lo.x, hi.y - lo.y) / 2 + 0.3
    rz = (hi.z - lo.z) / 2 + 0.3
    nfn = P.crown_normal(cen, (R, R, rz), up=spec.get('nup', 0.45))
    ncard = 0
    keep = 1.0 / sparse
    inner_tiles = spec.get('inner_tiles')
    for (p, d) in anchors:
        if rnd.random() > keep:
            continue
        q = Vector((p.x - cen.x, p.y - cen.y, (p.z - cen.z) * R / rz))
        outer = clamp(q.length / R)
        ao0 = lerp(0.5, 0.9, outer)
        if outer < spec.get('inner', 0.4):
            if not inner_tiles or rnd.random() > spec.get('inner_p', 0.7):
                continue
            # a dark inner mass: closes the gaps a viewer at 20-40 m would see through
            nout = Vector(((p.x - cen.x) / R, (p.y - cen.y) / R, (p.z - cen.z) / rz))
            f = nout.normalized() if nout.length > 1e-3 else UP.copy()
            up_t = UP - f * UP.dot(f)
            up_t = up_t.normalized() if up_t.length > 1e-3 else P.basis(f)
            D = Quaternion(f, rnd.uniform(-1.2, 1.2)) @ up_t
            kk = spec['card'] * rnd.uniform(1.0, 1.3)
            W_, H_ = A.size(inner_tiles[0])
            m.card_keep = True                      # inner masses: the _mid keeps them as they are
            P.card(m, A, rnd.choice(inner_tiles), p - D * H_ * kk * 0.5, D, D.cross(f).normalized(), k=kk, segs=1,
                   mat=1, ao=0.38, ao_tip=0.5, normal=nfn)
            m.card_keep = False
            ncard += 1
            continue
        if hang:
            o2 = Vector((p.x - cen.x, p.y - cen.y, 0.0))
            o2 = o2.normalized() if o2.length > 1e-3 else Vector((1, 0, 0))
            for j in range(spec.get('per_anchor', 2)):
                f = Quaternion(UP, rnd.uniform(-0.9, 0.9)) @ o2
                Sx = UP.cross(f).normalized()          # card front = Sx x UP = f (outward)
                pp = p + Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), rnd.uniform(0.0, 0.25))) + f * 0.1
                P.card(m, A, rnd.choice(keys), pp, UP, Sx, k=spec['card'] * rnd.uniform(0.8, 1.2), segs=2,
                       droop=-0.12, mat=1, ao=min(1.0, ao0 + 0.1), ao_tip=ao0 * 0.9, normal=nfn)
                ncard += 1
            continue
        nout = Vector(((p.x - cen.x) / R, (p.y - cen.y) / R, (p.z - cen.z) / rz))
        nout = nout.normalized() if nout.length > 1e-3 else UP.copy()
        for j in range(spec.get('per_anchor', 2)):
            if spec.get('flat'):
                # beech: sprays lie in layers, facing up, pointing out
                o2 = Vector((nout.x, nout.y, 0.0))
                o2 = o2.normalized() if o2.length > 1e-3 else Vector((1, 0, 0))
                D = (o2 + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(-0.1, 0.15)))).normalized()
                S = Quaternion(D, rnd.uniform(-0.45, 0.45)) @ P.basis(D)
                kk = spec['card'] * rnd.uniform(0.8, 1.15)
                pp = p - D * kk * 0.3 + Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), rnd.uniform(-0.15, 0.15)))
            else:
                # clumps facing out of the crown, randomly turned about that direction
                f = (nout + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(-0.3, 0.5)))).normalized()
                up_t = (UP * 0.7 + d * 0.5) - f * (UP * 0.7 + d * 0.5).dot(f)
                if up_t.length < 1e-3:
                    up_t = P.basis(f)
                D = Quaternion(f, rnd.uniform(-1.0, 1.0)) @ up_t.normalized()
                S = D.cross(f).normalized()        # card front = S x D = f
                kk = spec['card'] * rnd.uniform(0.8, 1.15) * lerp(0.85, 1.05, outer)
                pp = p - D * kk * 0.45 + f * rnd.uniform(-0.15, 0.25)
            P.card(m, A, rnd.choice(keys), pp, D, S, k=kk, segs=2, droop=spec.get('droop', 0.2),
                   mat=1, ao=ao0, ao_tip=min(1.0, ao0 + 0.25), normal=nfn)
        ncard += 1
    kit.log(f'{name}: {len(segs)} branches, {len(tips)} tips, {len(anchors)} anchors, {ncard} cards, '
            f'scale {sh:.2f}')
    coll = [kit.collider_cyl((0, 0, 0), round(r0 * 1.05, 3), round(spec['fork'] + 0.5, 2))]
    return m, coll


OAK = dict(H=12.0, R=5.6, r0=0.5, fork=2.8, lean=(0.15, 0.1), bark='bark_oak', flare=0.75, leader=True,
           tiles=('oak_a', 'oak_b', 'oak_c', 'oak_e'), inner_tiles=('oak_d',), card=1.5, droop=0.18, spacing=0.4,
           inner=0.42, per_anchor=2, s0_limb=0.45, stretch=1.5, ivy=(2, 3.5),
           levels=[dict(n=7, el=(15, 42), len=(6.0, 7.0), segs=4, sides=7, taper=0.45, wobble=0.15, up=0.07,
                        children=(3, 4), at=(0.3, 1.0), angle=(25, 55), tip_leaves=True),
                   dict(len=(0.4, 0.55), segs=3, sides=4, taper=0.5, wobble=0.25, up=0.05, droop=0.04,
                        children=(3, 4), at=(0.3, 1.0), angle=(30, 60), rk=0.7, tip_leaves=True),
                   dict(len=(0.45, 0.65), segs=1, sides=3, taper=0.5, wobble=0.3, up=0.08, children=0, rk=0.65,
                        rmin=0.012)])

BEECH = dict(H=13.5, R=4.4, r0=0.38, fork=3.6, lean=(-0.1, 0.12), bark='bark_beech', flare=0.6, leader=True,
             tiles=('beech_a', 'beech_b', 'beech_c', 'beech_e'), inner_tiles=('beech_d',), card=1.45, droop=0.12,
             nup=0.45, spacing=0.49, inner=0.42, per_anchor=2, s0_limb=0.35, stretch=1.3,
             levels=[dict(n=10, el=(40, 62), len=(4.4, 5.2), segs=4, sides=6, taper=0.45, wobble=0.1, up=0.05,
                          children=(3, 4), at=(0.25, 1.0), angle=(30, 55), tip_leaves=True),
                     dict(len=(0.4, 0.55), segs=3, sides=4, taper=0.5, wobble=0.2, droop=0.05,
                          children=(2, 3), at=(0.3, 1.0), angle=(35, 65), rk=0.65, tip_leaves=True),
                     dict(len=(0.5, 0.7), segs=1, sides=3, taper=0.5, wobble=0.25, droop=0.08, children=0, rk=0.6,
                          rmin=0.01)])

BIRCH = dict(H=14.5, R=3.4, r0=0.2, fork=4.5, lean=(0.45, -0.2), bark='bark_birch2', flare=0.5, leader=True,
             tiles=('birch_a', 'birch_b', 'birch_c', 'birch_d'), card=1.35, hang=True, nup=0.3, spacing=0.42,
             inner=0.25, per_anchor=2, s0=0.2, s0_limb=0.4, stretch=1.3,
             levels=[dict(n=11, el=(35, 60), len=(3.0, 4.0), segs=3, sides=5, taper=0.45, wobble=0.12, up=0.05,
                          droop=0.1, children=(3, 4), at=(0.3, 1.0), angle=(25, 45), tip_leaves=True),
                     dict(len=(0.4, 0.55), segs=3, sides=3, taper=0.5, wobble=0.2, droop=0.25, children=(2, 3),
                          at=(0.4, 1.0), angle=(20, 45), rk=0.6, tip_leaves=True),
                     dict(len=(0.5, 0.7), segs=1, sides=3, taper=0.5, droop=0.4, children=0, rk=0.6, rmin=0.008)])

# v3: mature specimens
OAK_BIG = dict(H=20.0, R=9.0, r0=0.85, fork=3.4, lean=(0.3, 0.15), bark='bark_oak', flare=0.85, leader=True,
               tiles=('oak_big', 'oak_big', 'oak_c', 'oak_e', 'oak_a'), inner_tiles=('oak_d',), card=1.7,
               droop=0.15, spacing=0.5, inner=0.5, inner_p=1.0, per_anchor=3, s0_limb=0.35, stretch=1.35,
               ivy=(3, 6.0), center=1,
               levels=[dict(n=8, el=(24, 58), len=(8.0, 10.0), segs=5, sides=8, taper=0.42, wobble=0.12, up=0.06,
                            children=(3, 4), at=(0.25, 1.0), angle=(25, 55), tip_leaves=True),
                       dict(len=(0.35, 0.5), segs=3, sides=5, taper=0.5, wobble=0.2, up=0.05, droop=0.03,
                            children=(2, 3), at=(0.3, 1.0), angle=(30, 60), rk=0.65, tip_leaves=True),
                       dict(len=(0.4, 0.6), segs=1, sides=3, taper=0.5, wobble=0.3, up=0.08, children=0, rk=0.6,
                            rmin=0.02)])

BEECH_BIG = dict(H=24.0, R=7.5, r0=0.62, fork=5.0, lean=(-0.2, 0.15), bark='bark_beech', flare=0.7, leader=True,
                 tiles=('beech_a', 'beech_b', 'beech_c', 'beech_e', 'beech_f'), inner_tiles=('beech_d',), card=2.1,
                 droop=0.12, nup=0.45, spacing=0.58, inner=0.5, inner_p=1.0, per_anchor=3, s0_limb=0.35, stretch=1.6,
                 levels=[dict(n=13, el=(38, 62), len=(7.5, 9.0), segs=4, sides=7, taper=0.42, wobble=0.1, up=0.05,
                              children=(3, 4), at=(0.25, 1.0), angle=(30, 55), tip_leaves=True),
                         dict(len=(0.38, 0.5), segs=3, sides=4, taper=0.5, wobble=0.2, droop=0.05,
                              children=(2, 3), at=(0.3, 1.0), angle=(35, 65), rk=0.62, tip_leaves=True),
                         dict(len=(0.5, 0.7), segs=1, sides=3, taper=0.5, wobble=0.25, droop=0.08, children=0, rk=0.6,
                              rmin=0.015)])


def ivy_trunk(m, A, rnd, r, n, height, mat=1):
    """Ivy climbing a trunk: a few vertical strips hugging the bark."""
    m.card_keep = True
    a0 = rnd.uniform(0, TAU)
    for i in range(n):
        a = a0 + TAU * i / n + rnd.uniform(-0.4, 0.4)
        out = polar(1.0, a)
        S = UP.cross(out).normalized()             # card front = S x UP = out
        hh = height * rnd.uniform(0.6, 1.0)
        P.card(m, A, 'ivy_b', out * (r + 0.02) - UP * 0.05, UP, S, k=hh / 3.0, segs=3, mat=mat, ao=0.5,
               ao_tip=0.85, normal=(out + UP * 0.25).normalized())
    m.card_keep = False


# ==========================================================================
# Dead tree

def tree_dead(name, seed=31):
    rnd = random.Random(seed)
    A = atlas('nat_leaf')
    m = Mesh(['deadwood', A.material])
    trunk = [Vector(p) for p in [(0, 0, 0), (0, 0, 0.3), (0.06, 0.04, 1.6), (0.22, 0.08, 3.4),
                                 (0.34, 0.0, 5.2), (0.3, -0.1, 6.6), (0.26, -0.12, 7.4)]]
    radii = [0.36, 0.33, 0.29, 0.25, 0.2, 0.15, 0.13]
    m.tag = P.TAG_TRUNK
    P.tube(m, trunk, radii, sides=9, rfn=P.flare_fn(4, 0.8, 0.4, rings=2), end='jag', rnd=rnd)
    roots(m, lambda z: Vector((0, 0, z)), 0.36, rnd, n=5, reach=1.2)
    ivy_trunk(m, A, rnd, 0.4, 4, 5.5)                 # ivy smothering the dead trunk
    spec = dict(levels=[dict(segs=3, sides=6, taper=0.5, wobble=0.22, up=0.08, children=(2, 3), at=(0.4, 1.0),
                             angle=(25, 55)),
                        dict(len=(0.4, 0.6), segs=2, sides=4, taper=0.5, wobble=0.3, up=0.05, children=(1, 3),
                             at=(0.3, 1.0), angle=(30, 60), rk=0.6),
                        dict(len=(0.4, 0.7), segs=1, sides=3, taper=0.5, wobble=0.35, children=0, rk=0.6,
                             rmin=0.01)])
    segs, tips = [], []

    def on_trunk(z):
        for k in range(len(trunk) - 1):
            if trunk[k].z <= z <= trunk[k + 1].z:
                s = (z - trunk[k].z) / (trunk[k + 1].z - trunk[k].z)
                return trunk[k].lerp(trunk[k + 1], s), lerp(radii[k], radii[k + 1], s)
        return trunk[-1], radii[-1]
    limbs = [(2.6, 0.3, 22, 2.5), (3.5, 2.4, 38, 3.1), (4.3, 4.2, 30, 2.9), (5.0, 1.2, 52, 3.0),
             (5.8, 3.3, 58, 2.4), (6.6, 5.4, 64, 2.3)]
    for z, az, el, L in limbs:
        c, rr = on_trunk(z)
        grow(rnd, c, dirv(az, math.radians(el)), L, rr * 0.6, 0, spec, segs, tips)
    broken = set(rnd.sample(range(len(segs)), max(2, len(segs) // 4)))
    for i, sg in enumerate(segs):
        m.tag = (P.TAG_LIMB, P.TAG_BRANCH)[sg['depth']] if sg['depth'] < 2 else P.TAG_TWIG
        if i in broken and sg['depth'] < 2:
            rr = list(sg['radii'])
            rr[-1] = max(rr[-2] * 0.8, 0.02)
            P.tube(m, sg['pts'], rr, sides=sg['sides'], end='jag', rnd=rnd, splinter=False)
        else:
            P.tube(m, sg['pts'], sg['radii'], sides=sg['sides'])
    m.tag = P.TAG_TWIG
    for z in (1.9, 2.3, 4.0, 4.7, 6.1):
        c, rr = on_trunk(z)
        d = (polar(1.0, rnd.uniform(0, TAU)) + UP * rnd.uniform(0.0, 0.5)).normalized()
        L = rnd.uniform(0.25, 0.55)
        P.tube(m, [c, c + d * (rr + L * 0.5), c + d * (rr + L)], [0.08, 0.07, 0.06], sides=5, end='jag',
               rnd=rnd, splinter=False)
    return m, [kit.collider_cyl((0, 0, 0), 0.36, 7.0)]


TREES = {
    'pine_a': lambda n, sp: conifer(n, 1, H=18.0, R=3.5, z0=3.6, r0=0.27, kind='spruce', lean=(0.15, -0.1), sparse=sp),
    'pine_b': lambda n, sp: conifer(n, 2, H=15.5, R=4.2, z0=2.8, r0=0.3, kind='fir', lean=(-0.12, 0.1), sparse=sp),
    'pine_c': lambda n, sp: scots_pine(n, 3, H=19.5, R=3.8, z0=9.5, r0=0.28),
    'oak_a': lambda n, sp: broadleaf(n, 4, OAK, sp),
    'oak_b': lambda n, sp: broadleaf(n, 5, BEECH, sp),
    'birch_a': lambda n, sp: broadleaf(n, 6, BIRCH, sp),
    'tree_dead': lambda n, sp: tree_dead(n),
    # v3: mature specimens
    'pine_big': lambda n, sp: conifer(n, 7, H=28.0, R=5.2, z0=6.0, r0=0.46, kind='spruce', lean=(0.25, -0.15),
                                      step=1.2, kmax=2.4, sparse=sp),
    'fir_big': lambda n, sp: conifer(n, 8, H=26.0, R=5.8, z0=4.5, r0=0.5, kind='fir', lean=(-0.2, 0.1),
                                     step=1.15, kmax=2.4, sparse=sp),
    'oak_big': lambda n, sp: broadleaf(n, 9, OAK_BIG, sp),
    'beech_big': lambda n, sp: broadleaf(n, 10, BEECH_BIG, sp),
}
BIG = ('pine_big', 'fir_big', 'oak_big', 'beech_big')


def tree_budget(name):
    return 8000 if name in BIG else 6000


def build_tree(name):
    """Build a tree, thinning its foliage step by step until it fits its
    triangle budget (deterministic)."""
    sp = 1.0
    for _ in range(12):
        m, coll = TREES[name](name, sp)
        if m.tris <= tree_budget(name):
            break
        sp *= 1.0 + max(0.04, min(0.25, (m.tris / tree_budget(name) - 1.0) * 0.9))
    kit.log(f'{name}: {m.tris} tris (foliage x{1 / sp:.2f})')
    big = name in BIG
    MESHES[name] = m
    return make(m, name, coll, size=1024 if name != 'tree_dead' else 512,
                scale_islands=weight_islands((6.0 if big else 4.5, 0.4 if big else 0.45)), tags=True)


# --------------------------------------------------------------------------
# _mid models (22-55 m): trunk and roots kept exactly (baked UVs), limbs and
# branches rebuilt with fewer points and sides on a bark swatch of the trunk,
# fine broadleaf twigs dropped, cards blue-noise thinned to ~45-50 % and
# enlarged (about area-preserving) as single straight quads.

MESHES = {}
WOOD = (P.TAG_TRUNK, P.TAG_ROOT)            # kept exactly: baked faces and UVs
CONIFER_MID = dict(keep=WOOD, rebuild={P.TAG_LIMB: (2, 3), P.TAG_TWIG: (2, 3)}, frac=0.45, pivot=1.0,
                   pref_scale=1.4, pref_width=1.25, edge_flat=0.8)
BROADLEAF_MID = dict(keep=WOOD, rebuild={P.TAG_LIMB: (3, 4), P.TAG_BRANCH: (2, 3)}, frac=0.48)
MID_SPEC = {
    'pine_a': CONIFER_MID, 'pine_big': CONIFER_MID, 'fir_big': CONIFER_MID,
    'pine_b': dict(CONIFER_MID, pref_scale=1.35, pref_width=1.2),       # more rim sprays: a little less each
    'pine_c': dict(keep=WOOD, rebuild={P.TAG_LIMB: (3, 3), P.TAG_BRANCH: (2, 3), P.TAG_TWIG: (2, 3)}, frac=0.43,
                   pivot=0.9, cover=0.88),
    'oak_a': BROADLEAF_MID, 'oak_b': BROADLEAF_MID,
    'birch_a': dict(BROADLEAF_MID, frac=0.56),                           # fine leaves: enlarge less
    'oak_big': dict(BROADLEAF_MID, rebuild={P.TAG_LIMB: (4, 4), P.TAG_BRANCH: (2, 3)}, cover=0.88),
    'beech_big': dict(BROADLEAF_MID, rebuild={P.TAG_LIMB: (4, 4), P.TAG_BRANCH: (2, 3)}),
    'tree_dead': dict(keep=WOOD, rebuild={P.TAG_LIMB: (3, 4), P.TAG_BRANCH: (2, 3), P.TAG_TWIG: (2, 3)}, frac=1.0,
                      tip=1.0, wood_area=True),
}


def build_mid(name, full):
    spec = MID_SPEC[name]
    extra = {k: spec[k] for k in ('pivot', 'pref_scale', 'pref_width', 'cover', 'tip', 'edge_flat', 'wood_area')
             if k in spec}
    extra.setdefault('pivot', 0.85)
    mm, st = P.mid_mesh(full, MESHES[name], set(spec['keep']), spec['frac'], seed=sum(map(ord, name)),
                        rebuild=spec['rebuild'], **extra)
    obj = mm.build(name + '_mid')
    kit.log(f'{name + "_mid":14s} {kit.tri_count(obj):5d} tris ({100 * kit.tri_count(obj) / kit.tri_count(full):.0f} % '
            f'of {kit.tri_count(full)}): wood {st["wood"]}, cards {st["cards"]}/{st["cards_full"]} x{st.get("scale", 1):.2f}'
            f', rim {st.get("rim", 0)}')
    return obj


# ==========================================================================
# Shrubs: stems fanning from the base, leaf cards on a clumpy shell facing out

def shell_cards(m, A, rnd, cen, radii, n, tiles, k, mat=1, zmin=0.08, inner=0.25, nfn=None, aolo=0.45,
                clump=4, droop=0.15):
    """Leaf cards spread over an ellipsoidal shell in clumps, facing out."""
    cen = Vector(cen)
    nfn = nfn or P.crown_normal(cen, radii, up=0.35)
    centres = []
    for i in range(max(1, n // clump)):
        u = rnd.uniform(-0.35, 1.0)
        a = rnd.uniform(0, TAU)
        r = math.sqrt(max(0.0, 1 - u * u))
        centres.append(Vector((r * math.cos(a), r * math.sin(a), u)))
    for i in range(n):
        c = centres[i % len(centres)]
        d = (c + Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), rnd.uniform(-0.3, 0.3)))).normalized()
        depth = rnd.uniform(0.55, 0.88) if rnd.random() > inner else rnd.uniform(0.25, 0.55)
        p = cen + Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * depth
        if p.z < zmin:
            p.z = zmin + rnd.uniform(0.0, 0.1)
        f = Vector((d.x / radii[0], d.y / radii[1], d.z / radii[2])).normalized()
        f = (f + Vector((rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), rnd.uniform(-0.2, 0.4)))).normalized()
        up_t = UP - f * UP.dot(f)
        if up_t.length < 1e-3:
            up_t = P.basis(f)
        D = Quaternion(f, rnd.uniform(-1.2, 1.2)) @ up_t.normalized()
        S = D.cross(f).normalized()
        kk = k * rnd.uniform(0.8, 1.2)
        W, Hh = A.size(tiles[0])
        P.card(m, A, rnd.choice(tiles), p - D * Hh * kk * 0.45, D, S, k=kk, segs=2, droop=droop, mat=mat,
               ao=lerp(aolo, 0.85, depth), ao_tip=min(1.0, lerp(aolo, 0.85, depth) + 0.2), normal=nfn)


def stems(m, rnd, n, H, spread, r=0.035, mat=0, lean=0.0):
    for i in range(n):
        a = TAU * i / n + rnd.uniform(-0.3, 0.3)
        b0 = polar(rnd.uniform(0.02, 0.08), a, -0.02)
        top = polar(spread * rnd.uniform(0.6, 1.0), a + rnd.uniform(-0.3, 0.3), H * rnd.uniform(0.55, 0.85))
        mid = b0.lerp(top, 0.5) + polar(0.08, a + 1.5, 0.0)
        P.tube(m, [b0, mid, top], [r, r * 0.7, 0.0], sides=4, mat=mat, ao=[0.5, 0.6, 0.65])


def bush(name, seed, H, R, tiles, n_cards, n_stems, k):
    rnd = random.Random(seed)
    A = atlas('nat_leaf')
    m = Mesh(['bark_oak', A.material])
    stems(m, rnd, n_stems, H, R * 0.6)
    cen = (0.0, 0.0, H * 0.52)
    radii = (R, R * 0.9, H * 0.48)
    shell_cards(m, A, rnd, cen, radii, n_cards, tiles, k)
    shell_cards(m, A, rnd, cen, (R * 0.6, R * 0.55, H * 0.3), max(6, n_cards // 6), ('mass_a',), k * 0.9,
                aolo=0.3, inner=1.0)
    coll = [kit.collider_cyl((0, 0, 0), round(R * 0.8, 2), round(H, 2), kind='soft')]
    return make(m, name, coll, size=256)


def bramble(name, seed=71):
    """Bramble patch: arching prickly canes rooting at the tips, leaves on top."""
    rnd = random.Random(seed)
    A = atlas('nat_leaf')
    m = Mesh(['bark_cane', A.material])
    canes = []
    for i in range(9):
        a = TAU * i / 9 + rnd.uniform(-0.3, 0.3)
        L = rnd.uniform(1.2, 1.8)
        hgt = rnd.uniform(0.6, 1.05)
        pts = []
        for j in range(6):
            t = j / 5
            pts.append(polar(0.1 + L * t, a + 0.3 * t * (1 if i % 2 else -1), hgt * math.sin(math.pi * min(1.0, t * 1.1)) + 0.02))
        P.tube(m, pts, [0.012, 0.011, 0.01, 0.009, 0.008, 0.0], sides=3, mat=0, ao=0.6)
        canes.append(pts)
    nfn = P.crown_normal((0, 0, 0.2), (1.6, 1.6, 0.9), up=0.6)
    for pts in canes:
        for j in range(1, 8):
            p, d = P.along3(pts, j / 7.5)
            for q in range(2):
                f = (UP * 0.8 + Vector((d.x, d.y, 0)) * 0.3 + Vector((rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 0))).normalized()
                up_t = d - f * d.dot(f)
                D = (Quaternion(f, rnd.uniform(-0.8, 0.8)) @ up_t.normalized())
                S = D.cross(f).normalized()
                kk = rnd.uniform(1.2, 1.7)
                P.card(m, A, rnd.choice(('bramble', 'bramble_b')), p - D * 0.2 * kk, D, S, k=kk, segs=2, droop=0.25,
                       mat=1, ao=lerp(0.5, 0.85, p.z), ao_tip=0.95, normal=nfn)
    coll = [kit.collider_cyl((0, 0, 0), 1.4, 1.0, kind='soft')]
    return make(m, name, coll, size=256)


# ==========================================================================
# Bocage hedges: earth bank (tileable), coppice stools and laid stems, a dark
# leafy core, leaf cards of hawthorn, hazel, bramble and ivy all over.

def bank(m, L, Wb, Wt, Hb, seed, mat=0, rings=17, ext=0.0):
    """Earth bank along X, profile identical at x = +-L/2 (tiles), irregular
    in between; capped ends."""
    off = P.noise_off(seed)
    prof = []
    for j in range(11):                       # a rounded mound, steeper near the top
        u = -1.0 + 2.0 * j / 10
        y = u * Wb / 2
        z = Hb * max(0.0, 1.0 - abs(u) ** 2.4) ** 0.55
        prof.append((y, z))
    ring_ids = []
    for k in range(rings):
        x = lerp(-L / 2 - ext, L / 2 + ext, k / (rings - 1))
        win = math.sin(math.pi * clamp((x + L / 2) / L)) ** 0.7
        ring = []
        for j, (y, z) in enumerate(prof):
            if 0 < j < len(prof) - 1:
                dz = 0.16 * Hb * P.fbm(Vector((x * 1.1, y * 1.5, 0.0)) + off, 3) * win
                dy = 0.14 * P.fbm(Vector((x * 1.0, 3.0 + j, 1.0)) + off, 3) * win
            else:
                dz, dy = 0.0, 0.0
            ring.append(m.v((x, y + dy, max(0.0, z + dz)), lerp(0.7, 1.0, z / Hb)))
        ring_ids.append(ring)
    n = len(prof)
    for k in range(rings - 1):
        A_, B_ = ring_ids[k], ring_ids[k + 1]
        for j in range(n - 1):
            m.f((A_[j], B_[j], B_[j + 1], A_[j + 1]), mat, smooth=True)
    m.f(ring_ids[0], mat, smooth=False)                 # the ring runs clockwise seen from +X
    m.f(list(reversed(ring_ids[-1])), mat, smooth=False)


def hedge(name, L, Ht, W, seed, bank_h, n_cards, n_stools, low=False):
    rnd = random.Random(seed)
    A = atlas('nat_leaf')
    m = Mesh(['bank', A.material, 'bark_oak', 'core'])
    bank(m, L, W + 0.5, W * 0.65, bank_h, seed, mat=0)
    # coppice stools and laid stems on the bank top
    for i in range(n_stools):
        x = lerp(-L / 2 + 0.25, L / 2 - 0.25, (i + rnd.uniform(0.2, 0.8)) / n_stools)
        base = Vector((x, rnd.uniform(-0.15, 0.15), bank_h - 0.05))
        for j in range(3 if not low else 2):
            lean = rnd.uniform(-0.6, 0.6)
            top = base + Vector((lean, rnd.uniform(-0.25, 0.25), (Ht - bank_h) * rnd.uniform(0.45, 0.8)))
            r = rnd.uniform(0.04, 0.07) * (0.7 if low else 1.0)
            P.tube(m, [base, base.lerp(top, 0.5) + Vector((0, rnd.uniform(-0.1, 0.1), 0)), top], [r, r * 0.75, 0.0],
                   sides=4, mat=2, ao=[0.45, 0.4, 0.4])
        if not low and i % 2 == 0:            # a laid pleacher, nearly horizontal
            a = base + Vector((0, 0, 0.15))
            b = a + Vector((rnd.choice((-1, 1)) * rnd.uniform(0.8, 1.2), rnd.uniform(-0.15, 0.15), 0.35))
            P.tube(m, [a, a.lerp(b, 0.5) + Vector((0, 0, 0.05)), b], [0.06, 0.05, 0.0], sides=4, mat=2, ao=0.45)
    # dark leafy core so nothing shows through (baked 'leaves')
    core_h = Ht - bank_h - 0.35
    # (kept well inside the leaf cards: shorter than the segment, lower than the top)
    P.hedge_body(m, L - 1.0, core_h + bank_h - 0.45, W * 0.42, seed, S=10, K=9, amp=(0.08, 0.03, 0.02), ext=0.1,
                 zb=(bank_h - 0.1, bank_h + 0.05), mat=3, top_var=0.15)
    # leaf cards over the whole volume (overlapping the tile ends a little)
    nfn_c = Vector((0, 0, (Ht + bank_h) / 2))
    radii = (L / 2 + 0.35, W / 2, (Ht - bank_h) / 2)

    def nfn(q):
        n = Vector((0.0, q.y / radii[1] ** 2, (q.z - nfn_c.z) / radii[2] ** 2))
        if n.length < 1e-6:
            n = UP.copy()
        return (n.normalized() + UP * 0.35).normalized()
    tiles_main = ('hawthorn', 'hawthorn_b', 'hazel', 'hazel_b', 'mass_a')
    for i in range(n_cards):
        x = rnd.uniform(-L / 2 - 0.3, L / 2 + 0.3)
        side = rnd.choice((-1, 1))
        u = rnd.random()
        if u < 0.2 and not low:                   # top
            y = rnd.uniform(-W * 0.35, W * 0.35)
            z = Ht - rnd.uniform(0.15, 0.45)
            f = (UP + Vector((0, y / W, 0))).normalized()
        else:
            zz = rnd.uniform(bank_h + 0.05, Ht - 0.2)
            t = (zz - bank_h) / max(0.1, Ht - bank_h)
            y = side * (W / 2) * lerp(0.75, 1.0, math.sin(math.pi * min(1.0, t * 0.9 + 0.1))) * rnd.uniform(0.8, 1.05)
            z = zz
            f = Vector((0, side, rnd.uniform(-0.15, 0.4))).normalized()
        f = (f + Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2)))).normalized()
        up_t = UP - f * UP.dot(f)
        if up_t.length < 1e-3:
            up_t = Vector((1, 0, 0))
        D = Quaternion(f, rnd.uniform(-1.3, 1.3)) @ up_t.normalized()
        S = D.cross(f).normalized()
        key = rnd.choice(tiles_main)
        if z < bank_h + 0.6 and rnd.random() < 0.35:
            key = rnd.choice(('bramble', 'bramble_b'))
        if rnd.random() < 0.08:
            key = 'ivy'
        kk = rnd.uniform(1.1, 1.6) * (0.75 if low else 1.0)
        W_, H_ = A.size(key)
        p = Vector((x, y, z))
        P.card(m, A, key, p - D * H_ * kk * 0.45, D, S, k=kk, segs=2, droop=0.15, mat=1,
               ao=lerp(0.4, 0.8, (z - bank_h) / (Ht - bank_h)), ao_tip=0.95, normal=nfn)
    # grass and ferns on the bank (cards standing on its surface)
    for i in range(n_cards // 4):
        x = rnd.uniform(-L / 2, L / 2)
        side = rnd.choice((-1, 1))
        h = rnd.uniform(0.0, 0.8)
        p = Vector((x, side * lerp((W + 0.5) / 2, W * 0.3, h ** 0.8), bank_h * (1.0 - (1.0 - h) ** 1.5) * 0.95))
        nrm = Vector((0, side * 0.8, 0.6)).normalized()
        az = rnd.uniform(0, TAU)
        Sx = Vector((math.cos(az), math.sin(az), 0.0))
        D = (UP * 0.7 + nrm * 0.3).normalized()
        Sx = (Sx - D * Sx.dot(D)).normalized()
        key = 'fern_l' if rnd.random() < 0.25 else 'grass_l'
        P.card(m, A, key, p - D * 0.04, D, Sx, k=rnd.uniform(0.7, 1.0) * (0.75 if low else 1.0), segs=2,
               droop=rnd.uniform(-0.15, 0.15), mat=1, ao=0.55, ao_tip=0.95, normal=(UP + nrm * 0.4).normalized())
    # brambles, ivy and herbs spilling down the bank
    for i in range(n_cards // 6):
        x = rnd.uniform(-L / 2, L / 2)
        side = rnd.choice((-1, 1))
        h = rnd.uniform(0.15, 0.85)
        p = Vector((x, side * lerp((W + 0.5) / 2 - 0.1, W * 0.35, h), bank_h * h))
        f = Vector((0, side, 0.9)).normalized()
        f = (f + Vector((rnd.uniform(-0.3, 0.3), 0, rnd.uniform(-0.2, 0.2)))).normalized()
        D = Quaternion(f, rnd.uniform(-1.2, 1.2)) @ (UP - f * UP.dot(f)).normalized()
        P.card(m, A, rnd.choice(('bramble', 'bramble_b', 'ivy', 'mass_a', 'hawthorn')), p - D * 0.25, D,
               D.cross(f).normalized(), k=rnd.uniform(0.8, 1.2) * (0.7 if low else 1.0), segs=2, droop=0.3, mat=1,
               ao=0.6, ao_tip=0.9, normal=nfn)
    top = Ht * 0.96
    coll = [kit.collider_box((0, 0, round(top / 2, 3)), (L, round(W * 0.85, 2), round(top, 2)))]
    return make(m, name, coll, size=1024 if not low else 512)


# ==========================================================================
# Ground cover (cards only, <= 150 tris; instanced by the thousand)

def up_normal(cen=(0, 0, 0), out=0.35):
    c = Vector(cen)

    def fn(q):
        d = Vector((q.x - c.x, q.y - c.y, 0.0))
        d = d.normalized() if d.length > 1e-4 else Vector((0, 0, 0))
        return (UP + d * out).normalized()
    return fn


def standing(m, A, rnd, key, base, az, k, segs=2, droop=0.12, ao=0.5, ao_tip=1.0, lean=0.0, nfn=None):
    """A vertical card standing on the ground at `base`, facing azimuth `az`."""
    S = Vector((math.cos(az), math.sin(az), 0.0))
    D = (UP + S.cross(UP) * lean).normalized()
    P.card(m, A, key, base, D, S, k=k, segs=segs, droop=droop, mat=0, ao=ao, ao_tip=ao_tip,
           normal=nfn or up_normal(base))


def grass_tuft(name, seed=101):
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    a0 = rnd.uniform(0, TAU)
    for i in range(5):
        az = a0 + i * math.pi / 5 + rnd.uniform(-0.15, 0.15)
        standing(m, A, rnd, rnd.choice(('grass_a', 'grass_b', 'grass_c')),
                 polar(rnd.uniform(0.0, 0.06), rnd.uniform(0, TAU)), az, rnd.uniform(0.75, 1.0),
                 droop=rnd.uniform(0.05, 0.2) * rnd.choice((-1, 1)), ao=0.45, lean=rnd.uniform(-0.15, 0.15))
    return make(m, name, [])


def grass_tall(name, seed=103):
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    for i in range(5):
        az = i * math.pi / 5 + rnd.uniform(-0.2, 0.2)
        standing(m, A, rnd, 'grass_tall', polar(rnd.uniform(0.0, 0.12), rnd.uniform(0, TAU)), az,
                 rnd.uniform(0.85, 1.05), droop=rnd.uniform(0.05, 0.18) * rnd.choice((-1, 1)), ao=0.6)
    for i in range(3):
        standing(m, A, rnd, rnd.choice(('grass_a', 'grass_b')), polar(rnd.uniform(0.05, 0.2), rnd.uniform(0, TAU)),
                 rnd.uniform(0, TAU), rnd.uniform(0.7, 0.9), ao=0.45)
    return make(m, name, [])


def reeds(name, seed=107):
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    for i in range(10):
        az = i * math.pi / 10 + rnd.uniform(-0.2, 0.2)
        standing(m, A, rnd, rnd.choice(('reeds_a', 'reeds_b')), polar(rnd.uniform(0.0, 0.3), rnd.uniform(0, TAU)),
                 az, rnd.uniform(0.75, 1.0), droop=rnd.uniform(0.02, 0.1), ao=0.6, lean=rnd.uniform(-0.1, 0.1))
    return make(m, name, [])


def nettles(name, seed=109):
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    for i in range(5):
        b = polar(rnd.uniform(0.15, 0.45), TAU * i / 5 + rnd.uniform(-0.3, 0.3))
        az = rnd.uniform(0, TAU)
        k = rnd.uniform(1.0, 1.5)
        for j in range(2):
            standing(m, A, rnd, rnd.choice(('nettle', 'nettle_b')), b, az + j * math.pi / 2, k, droop=0.04, ao=0.6,
                     lean=rnd.uniform(-0.12, 0.12))
    standing(m, A, rnd, 'grass_b', Vector((0, 0, 0)), 0.4, 0.8, ao=0.45)
    return make(m, name, [])


def fern(name, seed=111):
    """Bracken / male fern: arching fronds radiating from the crown."""
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    nf = 8
    nfn = up_normal((0, 0, 0), 0.3)
    for i in range(nf):
        az = TAU * (i + rnd.uniform(-0.2, 0.2)) / nf
        out = polar(1.0, az)
        el = math.radians(rnd.uniform(55, 72))
        D = (out * math.cos(el) + UP * math.sin(el)).normalized()
        S = out.cross(UP).normalized()                 # front = S x D faces up; droop bends down
        S = (S - D * S.dot(D)).normalized()
        P.card(m, A, rnd.choice(('fern_a', 'fern_b', 'fern_c')), polar(0.04, az, 0.02), D, S,
               k=rnd.uniform(1.0, 1.25), segs=4, droop=rnd.uniform(0.33, 0.45), fold=0.06, mat=0, ao=0.45,
               ao_tip=1.0, normal=nfn)
    return make(m, name, [])


def weeds(name, seed=113):
    """Broad-leaved dock rosette with a spear thistle."""
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    nfn = up_normal((0, 0, 0), 0.4)
    for i in range(7):
        az = TAU * (i + rnd.uniform(-0.2, 0.2)) / 7
        out = polar(1.0, az)
        el = math.radians(rnd.uniform(35, 60))
        D = (out * math.cos(el) + UP * math.sin(el)).normalized()
        S = (out.cross(UP) - D * out.cross(UP).dot(D)).normalized()
        P.card(m, A, rnd.choice(('dock', 'dock_b')), polar(0.03, az, 0.01), D, S, k=rnd.uniform(0.85, 1.2), segs=3,
               droop=rnd.uniform(0.25, 0.4), mat=0, ao=0.5, ao_tip=1.0, normal=nfn)
    for j in range(2):
        standing(m, A, rnd, 'thistle', polar(0.15, 1.0), 0.7 + j * math.pi / 2, 1.5, droop=0.03, ao=0.5)
    return make(m, name, [])


def flat_patch(m, A, key, size_k, rnd, segs=3, z=0.01, dome=0.02, rot=0.0, centre=(0, 0)):
    W, H = A.size(key)
    nfn = lambda q: UP.copy()
    ca, sa = math.cos(rot), math.sin(rot)
    grid = []
    for j in range(segs + 1):
        row = []
        for i in range(segs + 1):
            x = (i / segs - 0.5) * W
            y = (j / segs - 0.5) * H
            r2 = (2 * i / segs - 1) ** 2 + (2 * j / segs - 1) ** 2
            zz = z + dome * max(0.0, 1 - r2) + rnd.uniform(-0.004, 0.004)
            px = (x * ca - y * sa) * size_k + centre[0]
            py = (x * sa + y * ca) * size_k + centre[1]
            row.append((m.v((px, py, zz), 0.85, UP.copy()), A.uv(key, x, y)))
        grid.append(row)
    for j in range(segs):
        for i in range(segs):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            m.f((a[0], b[0], c[0], d[0]), 0, (a[1], b[1], c[1], d[1]), smooth=False)


def ivy_ground(name, seed=115):
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    for i in range(3):
        flat_patch(m, A, 'ivy_ground', rnd.uniform(1.0, 1.4), rnd, segs=2, z=0.01 + 0.012 * i, dome=0.04,
                   rot=rnd.uniform(0, TAU), centre=(rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25)))
    return make(m, name, [])


def leaf_litter(name, seed=117):
    rnd = random.Random(seed)
    A = atlas('nat_ground')
    m = Mesh([A.material])
    flat_patch(m, A, 'litter', 1.0, rnd, segs=3, z=0.006, dome=0.012)
    return make(m, name, [])


def branches(name, seed=119):
    """A small pile of fallen twigs and a broken branch (baked deadwood)."""
    rnd = random.Random(seed)
    m = Mesh(['deadwood'])
    for i in range(6):
        a = rnd.uniform(0, TAU)
        L = rnd.uniform(0.6, 1.3) if i else 1.6
        r = rnd.uniform(0.015, 0.03) if i else 0.045
        c = polar(rnd.uniform(0, 0.25), rnd.uniform(0, TAU), r + 0.01 * i)
        d = polar(1.0, a)
        pts = [c - d * L / 2, c + Vector((0, 0, r * 0.5)), c + d * L / 2 + Vector((0, 0, rnd.uniform(-0.01, 0.06)))]
        P.tube(m, pts, [r, r * 0.85, r * 0.6], sides=4, mat=0, start='flat', end='jag' if i == 0 else 'flat',
               rnd=rnd, splinter=False)
        if L > 0.9:
            q, dq = P.along3(pts, 0.6)
            e = q + (Quaternion(UP, rnd.choice((-1, 1)) * 0.6) @ dq) * 0.35 + Vector((0, 0, 0.03))
            P.tube(m, [q, e], [r * 0.6, r * 0.3], sides=3, mat=0)
    mn, mx = m.bounds()
    m.xform(Matrix.Translation((0, 0, -mn.z)))
    return make(m, name, [], size=256)


def mushrooms(name, seed=121):
    """A tiny cluster of brown-capped mushrooms."""
    rnd = random.Random(seed)
    m = Mesh(['mushroom'])
    for i in range(4):
        c = polar(rnd.uniform(0.0, 0.08), rnd.uniform(0, TAU))
        h = rnd.uniform(0.04, 0.09)
        rc = rnd.uniform(0.025, 0.045)
        tilt = Vector((rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), 1.0)).normalized()
        P.tube(m, [c, c + tilt * h], [rc * 0.28, rc * 0.24], sides=4, mat=0)
        top = c + tilt * h
        prof = [(rc * 0.25, -rc * 0.1), (rc, -rc * 0.02), (rc * 0.7, rc * 0.42), (0.0, rc * 0.6)]
        rings = []
        for (rr, zz) in prof:
            if rr <= 1e-6:
                rings.append(m.v(top + tilt * zz, 1.0))
                continue
            ring = []
            for j in range(5):
                a = TAU * j / 5
                ring.append(m.v(top + Vector((rr * math.cos(a), rr * math.sin(a), 0)) + tilt * zz, 0.9))
            rings.append(ring)
        P.loft(m, rings, mat=0, smooth=True)
    return make(m, name, [], size=256)


# ==========================================================================
# Rocks: faceted hull -> dense sculpted surface -> decimated; granite bake

def decimate_to(target):
    def post(obj):
        t = kit.tri_count(obj)
        if t > target:
            kit.decimate(obj, target / t)
        obj.data.shade_smooth()
        return obj
    return post


def rock_piece(m, size, seed, loc=(0, 0, 0), yaw=0.0, sink=0.1, planes=6, box=0.7, extra=(), tilt=None,
               amp=0.035, crack=0.018, cuts=3, top_cut=None, plane_el=(-15, 75)):
    ex = list(extra)
    if top_cut is not None:
        ex.append((Vector((0.03, -0.02, 1.0)), size[2] / 2 * top_cut))
    bm = P.rock_bm(size, seed, planes=planes, npts=72, box=box, lumpy=0.05, plane_depth=(0.72, 0.92),
                   extra=ex, dissolve=0, plane_el=plane_el)
    bm = P.chamfer(bm, 0.035 * max(size))
    P.sculpt(bm, size, seed, amp=amp, crack=crack, cuts=cuts, bottom=0.15 * size[2])
    zs = [v.co.z for v in bm.verts]
    M = Matrix.Translation(Vector(loc) + Vector((0, 0, -min(zs) - sink))) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')
    if tilt is not None:
        M = M @ tilt
    P.add_bm(m, bm, xform=M, smooth=True)
    bm.free()


def boulder(name, size, seed, split=False, target=1500):
    m = Mesh(['granite'])
    sink = size[2] * 0.12
    if split:
        rnd = random.Random(seed)
        az = rnd.uniform(0.2, 0.6)
        n = Vector((math.cos(az), math.sin(az), 0.0))
        for side in (-1, 1):
            tilt = Matrix.Translation(n * side * 0.05) @ Matrix.Rotation(math.radians(3.5 * side), 4, UP.cross(n))
            rock_piece(m, size, seed, sink=sink, extra=[(-n * side, -0.07)], tilt=tilt, box=0.8, planes=5)
    else:
        rock_piece(m, size, seed, sink=sink)
    mn, mx = m.bounds()
    top = mx.z
    c = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, top * 0.47)
    coll = [kit.collider_box(c, ((mx.x - mn.x) * 0.84, (mx.y - mn.y) * 0.84, top * 0.94))]
    return make(m, name, coll, size=512 if max(size) < 1.5 else 1024, post=decimate_to(target))


def outcrop(name, seed=71):
    """Layered granite outcrop for hillsides: stepped sheets climbing towards
    +Y (into the slope), sunk 0.45 m."""
    m = Mesh(['granite_dark'])
    rnd = random.Random(seed)
    slabs = [((0.0, -0.45, -0.45), (7.0, 3.1, 1.9), 0.0),
             ((0.35, 0.35, 0.95), (5.6, 2.9, 1.5), 3.0),
             ((-0.55, 0.9, 2.05), (3.9, 2.2, 1.3), -5.0),
             ((2.35, 0.8, 1.75), (2.0, 1.8, 1.25), 12.0),
             ((-2.6, 0.6, 0.85), (1.9, 2.0, 1.4), -9.0)]
    cols = []
    for i, (c, size, yaw) in enumerate(slabs):
        rock_piece(m, size, seed + i * 7, loc=(c[0], c[1], c[2]), yaw=yaw, sink=0.0, planes=5, box=0.45,
                   top_cut=0.8, plane_el=(-10, 35), amp=0.025, crack=0.012, cuts=2)
        top = c[2] + size[2] * 0.86
        bot = max(c[2], -0.4)
        cols.append(kit.collider_box((c[0], c[1], (top + bot) / 2), (size[0] * 0.82, size[1] * 0.8, top - bot), yaw=yaw))
    return make(m, name, cols, size=1024, post=decimate_to(4200))


def rocks_small(name, seed=81):
    m = Mesh(['granite'])
    rnd = random.Random(seed)
    stones = [((0.0, 0.0), (0.62, 0.5, 0.46)), ((0.5, 0.36), (0.36, 0.3, 0.26)),
              ((-0.48, 0.26), (0.4, 0.34, 0.3)), ((0.24, -0.5), (0.34, 0.28, 0.22)),
              ((-0.34, -0.42), (0.26, 0.22, 0.18)), ((0.6, -0.14), (0.22, 0.2, 0.16)),
              ((-0.62, -0.04), (0.2, 0.18, 0.14))]
    for i, ((x, y), size) in enumerate(stones):
        rock_piece(m, size, seed + i, loc=(x, y, 0), yaw=rnd.uniform(0, 360), sink=size[2] * 0.15, planes=3,
                   box=0.7, cuts=2, amp=0.04, crack=0.01)
    return make(m, name, [], size=512, post=decimate_to(900))


# ==========================================================================
# Logs, stump, the fallen-tree bridge

def log(name, seed=91):
    rnd = random.Random(seed)
    m = Mesh(['bark_oak', 'wood_end'])
    n = 9
    pts, radii = [], []
    for i in range(n):
        s = i / (n - 1)
        pts.append(Vector((lerp(-2.45, 2.45, s), 0.06 * math.sin(s * 3.1), 0.26 + 0.015 * math.sin(s * 5))))
        radii.append(lerp(0.265, 0.22, s) * rnd.uniform(0.95, 1.05))
    P.tube(m, pts, radii, sides=14, mat=0, start='flat', end='jag', cap_mat=1, rnd=rnd, jag_amp=0.5)
    for (s, az, L) in ((0.3, 0.55, 0.45), (0.62, 2.5, 0.35), (0.8, 0.35, 0.5)):
        c, _ = P.along3(pts, s)
        d = Vector((0.3, math.cos(az), math.sin(az))).normalized()
        P.tube(m, [c, c + d * (0.25 + L * 0.5), c + d * (0.25 + L)], [0.075, 0.062, 0.052], sides=6, mat=0,
               end='jag', cap_mat=1, rnd=rnd, splinter=False)
    mn, mx = m.bounds()
    m.xform(Matrix.Translation((0, 0, -mn.z)))
    return make(m, name, [kit.collider_box((0, 0, 0.25), (4.9, 0.46, 0.5))], size=512)


def stump(name, seed=97):
    """Sawn stump with growth rings on the cut, a splinter left standing,
    root flare and roots diving into the ground."""
    rnd = random.Random(seed)
    m = Mesh(['bark_oak', 'wood_end'])
    pts = [Vector((0, 0, 0)), Vector((0, 0, 0.18)), Vector((0.01, 0, 0.44))]
    P.tube(m, pts, [0.31, 0.27, 0.26], sides=14, mat=0, rfn=P.flare_fn(5, 0.5, 0.3, rings=2), end='flat', cap_mat=1)
    for i in range(5):
        a = TAU * (i + rnd.uniform(-0.12, 0.12)) / 5 + 0.93
        d = polar(1.0, a)
        P.tube(m, [d * 0.14 + UP * 0.2, d * 0.32 + UP * 0.07, d * 0.5 - UP * 0.04], [0.1, 0.065, 0.045], sides=6,
               mat=0, end='flat', cap_mat=0)
    mn, mx = m.bounds()
    m.xform(Matrix.Translation((0, 0, -max(mn.z, 0.0))))
    m.clamp_z(0.0)
    return make(m, name, [kit.collider_cyl((0, 0, 0), 0.3, 0.5)], size=256)


def log_bridge(name, seed=95):
    """Big fallen oak across the river: 17 m trunk along Y, broken crown end at
    -Y, torn-up root plate of soil and roots at +Y; walkable box chain."""
    m = Mesh(['bark_oak', 'dirt', 'wood_end'])
    rnd = random.Random(seed)
    y0, y1 = -8.35, 7.45
    n = 17

    def axis_z(y):
        return lerp(0.36, 0.98, (y - y0) / (y1 - y0))

    def rad(y):
        s = (y - y0) / (y1 - y0)
        return lerp(0.33, 0.45, s) + 0.08 * sstep(0.88, 1.0, s)
    pts, radii = [], []
    for i in range(n):
        s = i / (n - 1)
        y = lerp(y0, y1, s)
        pts.append(Vector((0.06 * math.sin(s * 4.0 + 0.5), y, axis_z(y))))
        radii.append(rad(y) * rnd.uniform(0.97, 1.03))
    P.tube(m, pts, radii, sides=16, mat=0, start='jag', cap_mat=2, rnd=rnd, jag_amp=0.6)
    stubs = [(-6.4, 35, 1.0, 0.15), (-4.8, 145, 1.15, 0.17), (-3.0, 80, 0.6, 0.11), (-1.2, 120, 0.9, 0.14),
             (0.9, 50, 0.65, 0.12), (2.6, 155, 0.5, 0.11), (4.1, 25, 0.9, 0.15)]
    for y, ang, L, r in stubs:
        a = math.radians(ang)
        d = Vector((math.cos(a), rnd.uniform(-0.35, 0.15), math.sin(a))).normalized()
        c = Vector((0, y, axis_z(y)))
        P.tube(m, [c, c + d * (rad(y) + L * 0.45), c + d * (rad(y) + L)], [r, r * 0.85, r * 0.72], sides=7,
               mat=0, end='jag', cap_mat=2, rnd=rnd, splinter=L > 0.8)
    for ang, L, r, yl in ((28, 1.15, 0.2, -7.6), (150, 1.05, 0.18, -7.1)):
        a = math.radians(ang)
        d = Vector((math.cos(a), -0.45, math.sin(a))).normalized()
        c = Vector((0, yl, axis_z(yl)))
        P.tube(m, [c, c + d * (rad(yl) + L * 0.5), c + d * (rad(yl) + L)], [r, r * 0.85, r * 0.75], sides=7, mat=0,
               end='jag', cap_mat=2, rnd=rnd, jag_amp=0.5)
    pc = Vector((0.0, y1 + 0.45, 1.12))
    P.crown_body(m, pc, (1.3, 0.55, 1.08), subdiv=2, seed=seed, amp=0.2, freq=1.6, crumple=0.06, mat=1,
                 cavity=0.5, under=0.3, flat_bottom=None)
    for i in range(12):
        a = TAU * (i + rnd.uniform(-0.3, 0.3)) / 12 + 0.2
        if abs(math.sin(a)) > 0.85 and math.sin(a) < 0:
            continue
        rim = pc + Vector((math.cos(a) * 1.0, rnd.uniform(-0.2, 0.2), math.sin(a) * 0.9))
        d = Vector((math.cos(a), rnd.uniform(0.0, 0.5), math.sin(a))).normalized()
        L = rnd.uniform(0.35, 0.65)
        bend = Vector((rnd.uniform(-0.1, 0.1), rnd.uniform(0.0, 0.2), -0.12))
        P.tube(m, [rim - d * 0.3, rim + d * L * 0.5 + bend, rim + d * L + bend * 1.5], [0.14, 0.09, 0.0], sides=5,
               mat=0, ao=0.65)
    for i in range(5):
        a = TAU * i / 5 + 0.6
        c = pc + Vector((math.cos(a) * 0.5, 0.3, math.sin(a) * 0.45))
        d = Vector((math.cos(a) * 0.5, 1.0, math.sin(a) * 0.4)).normalized()
        P.tube(m, [c, c + d * 0.35, c + d * 0.7], [0.09, 0.06, 0.0], sides=4, mat=0, ao=0.7)
    m.clamp_z(0.0)
    cols = []
    edges = [y0 + 0.15, -5.2, -2.0, 1.2, 4.4, y1 - 0.1]
    for a, b in zip(edges, edges[1:]):
        ym = (a + b) / 2
        top, bot = axis_z(ym) + rad(ym), axis_z(ym) - rad(ym)
        cols.append(kit.collider_box((0, ym, (top + bot) / 2), (0.8, b - a, top - bot)))
    cols.append(kit.collider_box((0, pc.y, pc.z), (2.4, 0.9, 2.2)))
    walk = {'y0': round(y0 + 0.15, 2), 'y1': round(y1 - 0.1, 2), 'top0': round(axis_z(y0) + rad(y0), 3),
            'top1': round(axis_z(y1) + rad(y1), 3)}
    return make(m, name, cols, size=1024, extra={'walk': walk})


# ==========================================================================
# Registry, budgets, notes, previews

OTHERS = {
    'bush_a': lambda n: bush(n, 41, H=1.6, R=1.0, tiles=('hawthorn', 'hawthorn_b', 'mass_a'), n_cards=90,
                             n_stems=6, k=1.15),
    'bush_b': lambda n: bush(n, 43, H=2.1, R=0.85, tiles=('hazel', 'hazel_b', 'mass_a'), n_cards=90, n_stems=7,
                             k=1.15),
    'bramble': bramble,
    'hedge': lambda n: hedge(n, 4.0, 2.85, 1.6, 61, bank_h=0.85, n_cards=330, n_stools=5),
    'hedge_low': lambda n: hedge(n, 4.0, 1.25, 1.2, 63, bank_h=0.32, n_cards=150, n_stools=4, low=True),
    'nettles': nettles, 'fern': fern, 'grass_tuft': grass_tuft, 'grass_tall': grass_tall, 'weeds': weeds,
    'reeds': reeds, 'ivy_ground': ivy_ground, 'leaf_litter': leaf_litter, 'branches': branches,
    'mushrooms': mushrooms,
    'boulder_a': lambda n: boulder(n, (1.3, 1.0, 0.92), 51, target=1200),
    'boulder_b': lambda n: boulder(n, (2.15, 1.65, 1.42), 52, target=1600),
    'boulder_c': lambda n: boulder(n, (3.4, 2.5, 2.2), 53, split=True, target=2400),
    'outcrop': outcrop, 'rocks_small': rocks_small,
    'log': log, 'log_bridge': log_bridge, 'stump': stump,
}

BUDGET = dict({t: tree_budget(t) for t in TREES}, **{t + '_lod': 600 for t in TREES})
BUDGET.update({t + '_mid': int(tree_budget(t) * 0.3) for t in TREES})
BUDGET.update({'bush_a': 1500, 'bush_b': 1500, 'bramble': 1500, 'hedge': 4500, 'hedge_low': 2700,
               'boulder_a': 2400, 'boulder_b': 2400, 'boulder_c': 2400, 'outcrop': 4500, 'rocks_small': 900,
               'log': 1200, 'log_bridge': 5400, 'stump': 900, 'branches': 150, 'mushrooms': 150})
for k_ in ('nettles', 'fern', 'grass_tuft', 'grass_tall', 'weeds', 'reeds', 'ivy_ground', 'leaf_litter'):
    BUDGET[k_] = 150
BUDGET.update({'treeline_far': 50, 'treeline_far_b': 50, 'hill_trees_lod': 50})


def tex_sizes(obj):
    out = []
    for s_ in obj.material_slots:
        mat = s_.material
        if not mat or not mat.use_nodes:
            continue
        imgs = sorted({n.image for n in mat.node_tree.nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image},
                      key=lambda i: i.name)
        if mat.get('card'):
            out.append(f"{mat.name} (atlas)")
        elif imgs:
            out.append(f"{mat.name} {imgs[0].size[0]}px")
    return ', '.join(out)


def collider_summary(obj):
    cols = json.loads(obj.get('colliders', '[]'))
    if not cols:
        return 'none'
    parts = []
    for c in cols:
        k = f" {c['kind']}" if 'kind' in c else ''
        if c['type'] == 'cyl':
            parts.append(f"cyl r {c['r']} h {c['hgt']}{k}")
        else:
            h = c['h']
            parts.append(f"box {2 * h[0]:.2f}×{2 * h[2]:.2f}×{2 * h[1]:.2f} top {c['c'][1] + h[1]:.2f}{k}")
    if len(parts) > 3:
        return f'{len(parts)} boxes: ' + '; '.join(parts)
    return '; '.join(parts)


NOTES_HEAD = """# Nature set v4 — `assets/models/nature.glb`

Built by `tools/blender/build_nature.py` (helpers, atlas artwork, surface
recipes and impostors in `nature_parts.py`); this file is regenerated by the
build. Sizes are Blender x × y × z in metres (x = width, y = depth, z =
height; three.js x × z × y). Tris = triangles after triangulation.

| node | size x × y × z (m) | tris (budget) | materials | colliders |
|---|---|---|---|---|
"""

NOTES_TAIL = """
## Materials and textures

* **Alpha-card materials** (glTF `alphaMode: MASK`, cutoff 0.5,
  `doubleSided: true`, base colour + alpha WebP, tangent normal map):
{cards}
* **Baked materials**: every trunk, branch system, stem, bank, rock, log and
  stump is one baked PBR material named after its node (base colour,
  normal, packed occlusion-free metallic-roughness), from `bake.py` with the
  procedural surfaces of `surfaces.py` plus the recipes registered by
  `nature_parts.register_surfaces()`: `bark_spruce` (flaking scales),
  `bark_fir` and `bark_beech` (smooth grey, lichen), `bark_scots` (grey
  plates low, orange flakes above ~9 m), `bark_birch2` (white, black
  lenticels, dark fissured base), `bark_cane`, `wood_end` (growth rings on
  cut/broken ends), `granite`/`granite_dark`, `bank` (grassy earth),
  `mushroom`. Moss and lichen come from the shared weathering.
* A node has at most two primitives: its baked material + one card atlas
  (ground cover: the card atlas only; `tree_dead`, rocks, logs: baked only).

## What the game must know

* **Cards** are drawn double-sided with alpha test. Their vertex normals are
  NOT the plane normals: they point out of the crown and up (crown-shaped
  normals; ground cover: up), so foliage lights as one volume. three.js
  flips the normal of back faces for `DoubleSide` materials; for card
  materials skip that flip (`onBeforeCompile`: drop the `faceDirection`
  multiply in `normal_fragment_begin`), otherwise the far side of every
  card goes dark. Thin needles survive mipmapping thanks to dense sprays
  and a dilated alpha; `alphaToCoverage: true` (with MSAA) is best at
  distance.
* `COLOR_0`: grey occlusion multiplier on cards (crown interior, card
  bases, ground-cover bases); 1.0 on baked parts (occlusion is in the
  texture). Use `vertexColors: true`.
* **LODs**: three tiers per tree. The full node up to ~22 m (~28 m for the
  four big trees), its `*_mid` from there to ~52 m, then `*_lod` = three
  crossed vertical planes (6 tris) textured from orthographic renders of
  the finished tree (`nat_impostor` atlas: albedo × occlusion and a
  tangent-space normal of the crown). Same origin and footprint as the full
  tree; neither `_mid` nor `_lod` has colliders. Do not yaw LOD instances
  differently from the full tree they replace (the planes are rendered for
  the tree's own yaw).
* **`*_mid` models** (v4, for 22–52 m; the big trees from ~28 m): same
  origin, orientation and scale as the full tree, visual only (no
  colliders). Trunk and root flare are the full tree's own baked faces
  (same faces and UVs); limbs and branches are rebuilt as cheap tubes and
  cones (fewer points and sides, stopping short of the very tip) on a bark
  swatch of the same baked texture; fine broadleaf twigs are dropped. The
  cards become single straight quads with the same atlas UVs, crown
  normals and occlusion. Broadleaf cards are blue-noise thinned to ~45–56 %
  and enlarged ×1.25–1.4 (area-preserving, 5–12 % under: the thinned cards
  overlap less; the birch keeps more of its fine-leaved drapes). Conifers keep the steep card of every crossed spray pair
  (×1.4 along, ×1.25 across) and also the flat one where it sits on the
  crown rim, which keeps the width and the spiky tiers. Inner masses, the
  leader and ivy are kept as they are. Materials are shared with the full
  tree (its baked bark material and the card atlas): no new images. About
  25–30 % of the full triangles (`tree_dead_mid` ~47 %: it has no cards
  to thin; its rebuilt branches keep the side-on area of the originals). Checked against the full trees at 30 and 45 m in dusk light,
  shaded as the game shades (`previews/nature/mid_*.png`): crown coverage
  and total opacity within ~5 %.
* **Big trees** (≤ 8000 tris): `pine_big` Norway spruce ~28 m, `fir_big`
  silver fir ~26 m, `oak_big` field oak ~20 m with a ~18 m crown and ivy,
  `beech_big` ~24 m. Trunk-cylinder colliders like the others.
* **The distance** (`nat_far` atlas, 2048², alphaMode MASK):
  * `treeline_far`, `treeline_far_b`: a 62 m stretch of forest edge (x −31…31,
    up to 31 m; the trees reach 18–29 m) as **three parallel cards** 6 tris
    in all, at y = 1, 8 and 17 m (depth layers rendered separately, so the
    edge has parallax). The cards face **−Y** (three.js +Z): yaw each
    instance so −Y points at the level. Lay them end to end every ~60 m
    (they overlap by 2 m; alternate the two kinds and flip every other one
    with a 180° yaw for variety — the back faces show the same picture
    mirrored) at 150–400 m, several rings at different distances.
    `treeline_far`: a mantle of hedges and shrubs, oaks, birch and beech,
    conifers rising behind; `treeline_far_b`: a dark spruce plantation
    behind a ragged edge of young fir, birch and bramble. Base at z = 0;
    sink them a little into the terrain.
  * `hill_trees_lod`: a clump of rounded broadleaf crowns (32 m across,
    ~16 m high) as two crossed cards — for copses on distant hills.
  * No colliders. Normals point back at the viewer (−Y) bent up; the
    colour already carries the occlusion of the crowns.
* **Origins** as v1: trees/bushes/ground cover at the trunk / clump centre on
  the ground; hedges centred; boulders, `rocks_small` and the outcrop are
  partly sunk (lowest vertex below z = 0). Tree roots and the hedge bank's
  stems dive up to ~0.15 m below z = 0 (bramble card tips ~0.3 m) so they
  meet uneven terrain without a gap. `oak_a` came out as a broad, spreading
  field oak 9.5 m tall (crown ~13 m across); use ±15 % instance scale if a
  taller oak is wanted.
* **Hedges** tile along X every **4.0 m**: the earth bank's profile is
  identical at x = ±2 m, the leaves overhang each end by ~0.3 m. One solid
  collider box per segment (`hedge_low` box top ~1.2 m is vaultable).
* **Bushes / bramble**: `kind: 'soft'` cylinders.
* **`log_bridge`**: along Y, crown (broken) end at −Y, root plate at +Y,
  walkable chain of 5 boxes rising from {top0:.2f} m to {top1:.2f} m plus the
  root-plate box; node extra `walk` = span `y0..y1` and end top heights.
* Trunks carry moss and algae on their weather side (Blender −X−Y, i.e.
  three.js −X+Z) and a mossy collar; `oak_a`, `oak_big` and `tree_dead`
  have ivy climbing the trunk (cards on `nat_leaf`).
* After every build `tools/fix_card_alpha.py` runs on the GLB (also safe to
  re-run by hand).
* **Ground cover** (`grass_tuft`, `grass_tall`, `fern`, `nettles`, `weeds`,
  `reeds`, `ivy_ground`, `leaf_litter`, `branches`, `mushrooms`): ≤ 150 tris,
  no colliders; `leaf_litter` and `ivy_ground` lie flat (normals up) — place
  them on the terrain with a tiny offset, random yaw.
"""


def write_notes(objs):
    rows = []
    for o in objs:
        mn, mx = kit.bounds(o)
        s_ = mx - mn
        mats = tex_sizes(o) or ', '.join(m_.name for m_ in o.data.materials)
        t = kit.tri_count(o)
        rows.append(f"| `{o.name}` | {s_.x:.2f} × {s_.y:.2f} × {s_.z:.2f} (z {mn.z:+.2f}…{mx.z:.2f}) | "
                    f"{t} ({BUDGET[o.name]}) | {mats} | {collider_summary(o)} |")
    cards = []
    for a in list(ATL.values()) + [x for x in (IMP, FAR) if x]:
        mat = a.material
        cards.append(f"  * `{mat.name}` — colour {a.color.size[0]}×{a.color.size[1]}, "
                     f"normal {a.normal.size[0]}×{a.normal.size[1]}")
    walk = json.loads(next(o for o in objs if o.name == 'log_bridge')['walk'])
    os.makedirs(os.path.dirname(NOTES), exist_ok=True)
    with open(NOTES, 'w') as fh:
        fh.write(NOTES_HEAD + '\n'.join(rows) + '\n' + NOTES_TAIL.format(cards='\n'.join(cards), **walk))
    kit.log('notes', os.path.relpath(NOTES, kit.ROOT))


IMP = None
FAR = None

# the distant forest: three depth layers per strip; each layer is one card and
# may hold several rows: (x-spacing m, species weights, scale range, y range)
FAR_SPECS = {
    'treeline_far': [   # mixed broadleaf forest edge: a shrub and hedge mantle, oaks and beech, conifers behind
        (1.0, [(3.7, {'hedge': 1}, (1.0, 1.3), (-1.2, -0.6)),
               (1.7, {'birch_a': 2, 'oak_b': 2, 'oak_a': 2, 'bush_b': 1}, (0.5, 0.95), (0.0, 3.0)),
               (2.6, {'bush_a': 2, 'bush_b': 2, 'bramble': 1}, (1.2, 1.8), (-0.4, 0.4))]),
        (8.0, [(2.3, {'oak_a': 3, 'oak_b': 3, 'beech_big': 1, 'birch_a': 2, 'oak_big': 1}, (0.85, 1.2), (5.0, 11.0))]),
        (17.0, [(2.6, {'pine_big': 2, 'fir_big': 2, 'beech_big': 2, 'oak_big': 1, 'pine_a': 1}, (0.85, 1.1),
                 (13.0, 21.0))]),
    ],
    'treeline_far_b': [  # dark spruce plantation behind a ragged edge of young fir, birch and bramble
        (1.0, [(1.3, {'pine_b': 3, 'birch_a': 2, 'bush_b': 1, 'pine_a': 2}, (0.55, 0.95), (-0.5, 3.0)),
               (2.6, {'bush_a': 2, 'bramble': 2, 'bush_b': 1}, (1.0, 1.7), (-1.5, 0.0))]),
        (8.0, [(2.0, {'pine_a': 3, 'pine_b': 3, 'pine_c': 1}, (0.8, 1.2), (5.0, 11.0))]),
        (17.0, [(2.4, {'pine_big': 3, 'fir_big': 3, 'pine_c': 1}, (0.88, 1.12), (13.0, 21.0))]),
    ],
}


def build_far(objs):
    """Render the distant treelines and the hill clump into nat_far."""
    global FAR
    FAR = P.Impostors(name='nat_far', size=1024 if SMALL else 2048, samples=8 if FAST else 12)
    made = []

    def inst(name, x, y, s, yaw):
        o = objs[name].copy()
        o.location = (x, y, 0.0)
        o.rotation_euler = (0, 0, yaw)
        o.scale = (s, s, s)
        kit.link(o)
        made.append(o)
        return o
    for key, layers in FAR_SPECS.items():
        rnd = random.Random(sum(map(ord, key)))
        for (depth, rows) in layers:
            group = []
            for (step, weights, srange, yr) in rows:
                names = [n for n, w in weights.items() for _ in range(w)]
                x = -30.0 + rnd.uniform(0, step * 0.5)
                while x < 30.0:
                    nm = rnd.choice(names)
                    yaw = rnd.choice((0.0, math.pi)) if nm == 'hedge' else rnd.uniform(0, TAU)
                    group.append(inst(nm, x + rnd.uniform(-0.4, 0.4), rnd.uniform(*yr), rnd.uniform(*srange), yaw))
                    x += step * (1.0 if nm == 'hedge' else rnd.uniform(0.7, 1.3))
            bpy.context.view_layer.update()
            FAR.add_group(group, key, -31.0, 31.0, 0.0, 31.0, (1024, 512), ppm=1.5, depth=depth)
            for o in group:
                kit.delete(o)
            made.clear()
    # hill clump: rounded broadleaf crowns, two crossed views
    rnd = random.Random(91)
    spots = [(0.0, 0.0, 'beech_big', 0.85), (-7.0, 3.0, 'oak_a', 1.1), (6.5, 2.0, 'oak_b', 1.05),
             (-3.0, -6.0, 'oak_a', 1.0), (4.0, -5.5, 'oak_big', 0.6), (-9.0, -3.0, 'oak_b', 0.9),
             (9.0, -2.0, 'oak_a', 0.95), (1.0, 7.0, 'beech_big', 0.7)]
    for view in range(2):
        group = []
        for (x, y, nm, s_) in spots:
            if view:
                x, y = -y, x                      # the clump turned 90 degrees
            group.append(inst(nm, x, y, s_, rnd.uniform(0, TAU)))
        bpy.context.view_layer.update()
        e = FAR.add_group(group, 'hill_trees_lod', -16.0, 16.0, 0.0, 16.0, (512, 256), ppm=1.5)
        if view:
            e['T'] = Vector((0.0, -1.0, 0.0))     # rendered turned: this plane faces -X
            e['v'] = Vector((1.0, 0.0, 0.0))
        for o in group:
            kit.delete(o)
    FAR.finish()
    out = {}
    for key in list(FAR_SPECS) + ['hill_trees_lod']:
        m = FAR.lod_mesh(key)
        out[key] = m.build(key)
    return out


def build_all():
    global IMP
    objs = {}
    for name in TREES:
        t = time.time()
        objs[name] = build_tree(name)
        kit.log(f'{name:12s} {kit.tri_count(objs[name]):5d} tris  {time.time() - t:.1f}s')
    IMP = P.Impostors(size=1024 if SMALL else 2048, height=2048 if SMALL else 4096, samples=12 if FAST else 20)
    for name in TREES:
        IMP.add(objs[name])
    IMP.finish()
    for name in TREES:
        lm = IMP.lod_mesh(name)
        objs[name + '_lod'] = lm.build(name + '_lod')
    for name in TREES:
        objs[name + '_mid'] = build_mid(name, objs[name])
    for name in TREES:                        # the part tags were only for the _mid models
        at = objs[name].data.attributes.get('nat_tag')
        if at:
            objs[name].data.attributes.remove(at)
    for name, fn in OTHERS.items():
        t = time.time()
        objs[name] = fn(name)
        kit.log(f'{name:12s} {kit.tri_count(objs[name]):5d} tris  {time.time() - t:.1f}s')
    t = time.time()
    objs.update(build_far(objs))
    kit.log(f'far treelines  {time.time() - t:.1f}s')
    return objs


ORDER = [n for t in TREES for n in (t, t + '_lod', t + '_mid')] + list(OTHERS) + list(FAR_SPECS) + ['hill_trees_lod']


def scene_previews(by):
    """Ground-level views through a few instances (linked duplicates)."""
    rnd = random.Random(5)
    made = []

    def inst(name, x, y, yaw=None, s=1.0):
        o = by[name].copy()
        o.location = (x, y, 0.0)
        o.rotation_euler = (0, 0, math.radians(rnd.uniform(0, 360) if yaw is None else yaw))
        o.scale = (s, s, s)
        kit.link(o)
        made.append(o)
        return o
    # forest edge
    for name, x, y in (('pine_a', -4, 12), ('pine_b', 5, 16), ('pine_c', -9, 22), ('oak_a', 9, 6),
                       ('birch_a', -2, 26), ('pine_a', 2, 30), ('oak_b', -14, 10), ('tree_dead', 4, 9),
                       ('pine_b', 12, 26), ('pine_a', -6, 34), ('pine_big', -12, 40), ('fir_big', 10, 44),
                       ('beech_big', 22, 30), ('pine_big', 3, 52), ('fir_big', -22, 50)):
        inst(name, x, y)
    for i in range(70):
        inst(rnd.choice(('grass_tuft', 'grass_tuft', 'grass_tall', 'fern', 'fern', 'nettles', 'weeds')),
             rnd.uniform(-9, 9), rnd.uniform(0.5, 16))
    for i in range(10):
        inst('leaf_litter', rnd.uniform(-8, 8), rnd.uniform(2, 18))
    for name, x, y in (('boulder_b', -3.5, 6.5), ('boulder_a', 2.5, 4.0), ('log', 0.5, 8.5), ('stump', -1.5, 3.2),
                       ('bush_a', 6.0, 4.5), ('bush_b', -6, 7), ('bramble', 3.5, 11), ('rocks_small', 1.0, 2.6),
                       ('mushrooms', -1.2, 2.8), ('branches', 0.3, 4.0), ('ivy_ground', -2.4, 4.5)):
        inst(name, x, y)
    keep = made
    P.preview(keep, os.path.join(PREV, '_scene_forest.png'), size=1024, samples=24, cam=(0.3, -2.0, 1.7),
              target=(0.5, 12.0, 3.5), lens=28)
    for o in made:
        kit.delete(o)
    made.clear()
    # open field with the far treelines ringing it (150-400 m) and a few near trees
    for i in range(-3, 4):
        inst('treeline_far' if i % 2 else 'treeline_far_b', i * 62.0, 220.0 + 40 * (i % 3), yaw=0)
    for i in range(-2, 3):
        inst('treeline_far_b' if i % 2 else 'treeline_far', i * 62.0 + 30, 380.0, yaw=0)
    inst('hill_trees_lod', -70.0, 150.0, yaw=0)
    inst('hill_trees_lod', 90.0, 170.0, yaw=0)
    for name, x, y in (('oak_big', -22, 45), ('beech_big', 30, 70), ('pine_big', -50, 90), ('fir_big', -40, 95),
                       ('oak_a', 14, 30), ('birch_a', 20, 34), ('hedge', -6, 14), ('hedge', -2, 14)):
        inst(name, x, y)
    for i in range(120):
        inst(rnd.choice(('grass_tuft', 'grass_tuft', 'grass_tall', 'weeds')), rnd.uniform(-12, 12), rnd.uniform(1, 25))
    P.preview(made, os.path.join(PREV, '_scene_far.png'), size=1024, samples=24, cam=(0.0, -2.0, 1.7),
              target=(0.0, 60.0, 4.0), lens=24, floor=500.0)
    for o in made:
        kit.delete(o)
    made.clear()
    # bocage lane: hedges both sides, every 4 m
    for i in range(-2, 9):
        inst('hedge', -3.2, i * 4.0, yaw=90 + (180 if i % 2 else 0))
        inst('hedge' if i % 3 else 'hedge_low', 3.2, i * 4.0 + 2.0, yaw=90 + (180 if i % 2 else 0))
    for name, x, y in (('oak_a', -4.0, 14.0), ('oak_b', 4.2, 24.0), ('birch_a', -4.2, 30.0)):
        inst(name, x, y)
    for i in range(40):
        inst(rnd.choice(('grass_tuft', 'grass_tuft', 'weeds', 'nettles')), rnd.choice((-1, 1)) * rnd.uniform(1.6, 2.4),
             rnd.uniform(1, 30))
    P.preview(made, os.path.join(PREV, '_scene_lane.png'), size=1024, samples=24, cam=(0.4, -3.0, 1.7),
              target=(0.0, 14.0, 1.6), lens=30)
    for o in made:
        kit.delete(o)


def scene_tiers(by, out=None):
    """A forest at eye height rendered twice in dusk light: every tree full,
    then as the game draws it (full to 22 m, 27.5 m for the big ones; _mid
    to 52 m; _lod beyond), side by side."""
    rnd = random.Random(23)
    kinds = ['pine_a', 'pine_a', 'pine_b', 'pine_c', 'oak_a', 'oak_b', 'birch_a', 'pine_big', 'fir_big', 'oak_big',
             'beech_big', 'tree_dead', 'pine_b', 'oak_b']
    spots = []
    for gy in range(14):
        for gx in range(-5, 6):
            x = gx * 8.5 + rnd.uniform(-3.0, 3.0)
            y = 6.0 + gy * 9.0 + rnd.uniform(-3.0, 3.0)
            if abs(x) < 5.0 and y < 30.0:          # keep a view down the middle
                continue
            spots.append((rnd.choice(kinds), x, y, rnd.uniform(0, TAU), rnd.uniform(0.9, 1.1)))
    cam = Vector((0.0, -2.0, 1.7))
    full, tiered = [], []
    for name, x, y, yaw, sc in spots:
        d = (Vector((x, y, 1.7)) - cam).length
        near = 22.0 * (1.25 if name in BIG else 1.0)
        tier = name if d < near else (name + '_mid' if d < 52.0 else name + '_lod')
        for lst, nm in ((full, name), (tiered, tier)):
            o = by[nm].copy()
            o.location = (x, y, 0.0)
            o.rotation_euler = (0, 0, yaw)
            o.scale = (sc, sc, sc)
            kit.link(o)
            lst.append(o)
    out = out or os.path.join(PREV, '_scene_mid_tiers.png')
    a = P.render_dusk(full, out.replace('.png', '_full.png'), cam, (0.0, 60.0, 7.0), lens=30, size=(1024, 640),
                      samples=20, floor=300.0)
    b = P.render_dusk(tiered, out.replace('.png', '_tiers.png'), cam, (0.0, 60.0, 7.0), lens=30, size=(1024, 640),
                      samples=20, floor=300.0)
    P.side_by_side([a, b], out)
    for o in full + tiered:
        kit.delete(o)
    kit.log('preview', os.path.relpath(out, kit.ROOT))


def mid_previews(objs):
    for t in TREES:
        P.compare_mid(objs[t], objs[t + '_mid'], os.path.join(PREV, 'mid_' + t))
        kit.log('preview', f'mid_{t}_30m/45m')
    scene_tiers(objs)


def fix_alpha():
    """Run tools/fix_card_alpha.py on the exported GLB (system python3 with
    Pillow): refills the colour under transparent and fringe texels of every
    card atlas from the opaque leaves (the atlases already are, this is the
    shared safety net) and repacks the WebPs."""
    import shutil, subprocess
    tool = os.path.join(kit.ROOT, 'tools', 'fix_card_alpha.py')
    py = shutil.which('python3')
    if not py or not os.path.exists(tool):
        kit.log('fix_card_alpha: skipped (python3 or the tool not found)')
        return
    r = subprocess.run([py, '-I', tool, GLB], capture_output=True, text=True)
    kit.log('fix_card_alpha:', (r.stdout.strip().splitlines() or [''])[-1], r.stderr.strip()[-300:])


def main():
    args = kit.args_after_dashes()
    flags = {a for a in args if a.startswith('--')}
    wanted = [a for a in args if not a.startswith('--')]
    for w in wanted:
        if w not in ORDER:
            raise SystemExit(f'unknown node {w!r}')
    kit.reset()
    P.register_surfaces()
    atlas('nat_leaf')
    objs = build_all()
    order = [objs[n] for n in ORDER]
    over = [(o.name, kit.tri_count(o)) for o in order if kit.tri_count(o) > BUDGET[o.name]]
    for n, t in over:
        kit.log(f'OVER BUDGET {n}: {t} > {BUDGET[n]}')
    kit.export(order, GLB, images=True)
    fix_alpha()
    write_notes(order)
    kit.log(f'build {time.time() - T0:.0f}s')
    if '--no-previews' in flags:
        return
    P.preview_cards(order)
    if '--mid-previews' in flags:              # only the full-vs-mid comparisons and the tier scene
        mid_previews(objs)
        kit.log(f'total {time.time() - T0:.0f}s')
        return
    names = wanted or ORDER
    for n in names:
        if n.endswith('_mid'):
            continue
        o = objs[n]
        tree = n in TREES or n.endswith('_lod')
        P.preview([o], os.path.join(PREV, n + '.png'), size=768, samples=20, elevation=8 if tree else 20)
        if n in TREES or n.startswith('hedge'):
            P.preview([o], os.path.join(PREV, n + '_back.png'), size=768, samples=20,
                      elevation=8 if tree else 20, azimuth=145)
        if n in TREES:
            P.preview([o], os.path.join(PREV, n + '_close.png'), size=768, samples=20, cam=(1.4, -2.0, 1.7),
                      target=(0.0, 0.0, 2.6), lens=28)
    if '--scenes' in flags or not wanted:
        scene_previews(objs)
        mid_previews(objs)
    kit.log(f'total {time.time() - T0:.0f}s')


if __name__ == '__main__':
    main()
