"""Meteora — the five asteroids.

Each rock starts as a high-poly sculpt: a subdivided icosphere whose
radius along every direction comes from an overall body shape (ellipsoid,
rubble-pile blobs, a bent potato), fBm lumps, planar fracture facets,
terraces and ridges, and craters of several scales with raised rims. The
game meshes are decimated from the sculpt (LOD0, then LOD1 from LOD0 so
both share one UV layout), and normals, colour and roughness are baked
from the sculpt's procedural material onto LOD0.

Run through build_all.py, or alone:
  Blender --background --factory-startup --python build_asteroids.py
"""
import bpy, bmesh, math, os, random, sys
import numpy as np
from mathutils import Vector, Matrix, noise, geometry
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

ROCKS = [
    dict(name='asteroid_1', radius=1.5, lod0=300, lod1=80, tex=512, seed=11, kind='shard'),
    dict(name='asteroid_2', radius=4.0, lod0=600, lod1=160, tex=512, seed=23, kind='pile'),
    dict(name='asteroid_3', radius=12.0, lod0=1200, lod1=300, tex=1024, seed=37, kind='potato'),
    dict(name='asteroid_4', radius=40.0, lod0=2500, lod1=600, tex=1024, seed=41, kind='blocky'),
    dict(name='asteroid_5', radius=125.0, lod0=4000, lod1=1000, tex=1024, seed=59, kind='battered'),
]

# Per-kind shape recipe. stretch: ellipsoid semi-axes; lumps: fBm amplitude;
# cuts: (count, min depth, max depth) planar fracture faces; craters:
# (count, min radius, max radius) plus optional hand-placed big ones.
SHAPES = {
    'shard': dict(stretch=(1.0, 0.46, 0.62), lumps=0.07, freq=1.0, cuts=(9, 0.08, 0.36), cut_soft=0.006,
                  craters=(6, 0.05, 0.12), crater_depth=0.7, subdiv=6, presmooth=2),
    'pile': dict(stretch=(1.0, 0.85, 0.8), lumps=0.03, freq=1.4, cuts=(2, 0.03, 0.06), cut_soft=0.05,
                 craters=(8, 0.05, 0.2), lobes=[((-0.42, 0.0, 0.0), 0.62), ((0.38, 0.05, 0.04), 0.52)],
                 boulders=26, crater_depth=0.55, subdiv=6),
    'potato': dict(stretch=(1.6, 0.85, 0.78), lumps=0.07, freq=0.9, cuts=(3, 0.03, 0.08), cut_soft=0.04,
                   craters=(16, 0.05, 0.25), big=[((0.3, 0.55, 0.78), 0.55, 1.6)], bend=0.16, subdiv=7),
    'blocky': dict(stretch=(1.25, 1.0, 0.8), lumps=0.1, freq=0.8, cuts=(6, 0.05, 0.16), cut_soft=0.012, box=(0.14, 0.26),
                   craters=(12, 0.05, 0.2), crater_depth=0.8, terrace=4, ridges=5, subdiv=7),
    'battered': dict(stretch=(1.0, 0.93, 0.88), lumps=0.06, freq=0.9, cuts=(2, 0.03, 0.08), cut_soft=0.05,
                     craters=(26, 0.05, 0.3), big=[((-0.5, -0.6, 0.62), 0.58, 1.0), ((0.8, 0.3, -0.5), 0.46, 1.1),
                                                   ((0.1, 0.9, 0.4), 0.4, 0.9), ((-0.7, 0.5, -0.4), 0.34, 1.2)], subdiv=7),
}


# --------------------------------------------------------------------------
# Field helpers (numpy over the sphere's vertices)

def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def fbm(P, seed_offset, freq, octaves=4, H=1.0, warp=0.25):
    out = np.empty(len(P))
    off = Vector(seed_offset)
    for i, p in enumerate(P):
        v = Vector(p) * freq + off
        w = noise.noise_vector(v * 0.7 + Vector((5.2, 1.3, 2.8)), noise_basis='PERLIN_NEW')
        out[i] = noise.fractal(v + w * warp, H, 2.0, octaves, noise_basis='PERLIN_NEW')
    out -= out.mean()
    return out / (2.0 * out.std() + 1e-9)


def laplacian(values, E, n, iterations):
    deg = np.bincount(E[:, 0], minlength=n) + np.bincount(E[:, 1], minlength=n)
    v = values.copy()
    for _ in range(iterations):
        s = np.bincount(E[:, 0], weights=v[E[:, 1]], minlength=n) + np.bincount(E[:, 1], weights=v[E[:, 0]], minlength=n)
        v = 0.5 * v + 0.5 * s / deg
    return v


def crater_shape(x, rim_w=0.55, rim_k=0.42, floor=-0.62, k=0.22):
    """Height in crater radii vs distance x (in crater radii): a parabolic
    bowl with a flattened floor, a raised rim and an ejecta apron."""
    cavity = x * x - 1.0
    rim_x = np.minimum(x - 1.0 - rim_w, 0.0)
    rim = rim_k * rim_x * rim_x
    shape = smax(cavity, floor, k)
    return smin(shape, rim, k)


def ellipsoid_radius(D, s):
    return 1.0 / np.sqrt((D[:, 0] / s[0]) ** 2 + (D[:, 1] / s[1]) ** 2 + (D[:, 2] / s[2]) ** 2)


def blob_radius(D, centres, radii, k=0.18):
    """Ray-from-origin exit distance through a smooth union of spheres."""
    R = np.zeros(len(D))
    for c, s in zip(centres, radii):
        c = np.asarray(c)
        b = D @ c
        disc = b * b - c @ c + s * s
        t = np.where(disc > 0, b + np.sqrt(np.maximum(disc, 0)), 0.0)
        R = smax(R, t, k) if R.any() else t
    return R


def random_dir(rng):
    z = rng.uniform(-1, 1)
    a = rng.uniform(0, 2 * math.pi)
    s = math.sqrt(1 - z * z)
    return np.array([s * math.cos(a), s * math.sin(a), z])


# --------------------------------------------------------------------------
# Sculpt

def sculpt(spec):
    shape = SHAPES[spec['kind']]
    rng = random.Random(spec['seed'])
    noise.seed_set(spec['seed'])
    offset = (rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50))

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=shape['subdiv'], radius=1.0)
    bm.verts.ensure_lookup_table()
    n = len(bm.verts)
    D = np.array([v.co[:] for v in bm.verts])
    D /= np.linalg.norm(D, axis=1, keepdims=True)
    E = np.array([[e.verts[0].index, e.verts[1].index] for e in bm.edges])

    # Body.
    R = ellipsoid_radius(D, shape['stretch'])
    if 'lobes' in shape:
        # contact binary: two lobes, then boulders sitting on the surface
        centres = [c for c, _ in shape['lobes']]
        radii = [r for _, r in shape['lobes']]
        R = blob_radius(D, centres, radii, k=0.28)
        for i in range(shape['boulders']):
            d = random_dir(rng)
            idx = int(np.argmax(D @ d))
            size = 0.05 + 0.15 * rng.random() ** 2.2
            centre = D[idx] * R[idx] * (1.0 - size * 0.35)
            R = smax(R, blob_radius(D, [centre], [size], 0.0), 0.06)

    # Lumps, domain-warped fBm; terraced for the layered rock.
    lumps = fbm(D * R[:, None], offset, shape['freq'])
    if 'terrace' in shape:
        k = shape['terrace']
        steps = np.round(lumps * k) / k
        frac = lumps * k - np.round(lumps * k)
        lumps = steps + frac / k * 0.2             # flat shelves, short steep risers
    R = R * (1.0 + shape['lumps'] * 2.0 * lumps)

    # Planar fracture facets.
    P = D * R[:, None]
    fresh = np.zeros(n)
    count, lo, hi = shape['cuts']
    planes = [(random_dir(rng), rng.uniform(lo, hi)) for _ in range(count)]
    if 'box' in shape:
        # six faces of a tilted box first: the block's main joints
        q = Vector(random_dir(rng)).to_track_quat('Z', 'Y').to_matrix()
        q = Matrix.Rotation(0.4, 3, Vector(random_dir(rng))) @ q
        blo, bhi = shape['box']
        planes = [(np.array(q @ Vector(a)) * sgn, rng.uniform(blo, bhi))
                  for a in ((1, 0, 0), (0, 1, 0), (0, 0, 1)) for sgn in (1, -1)] + planes
    for nrm, depth in planes:
        extent = (P @ nrm).max()
        d = extent * (1.0 - depth)
        dn = D @ nrm
        t = np.where(dn > 1e-3, d / np.maximum(dn, 1e-3), 1e9)
        cut = smin(R, t, shape['cut_soft'] * extent)
        fresh = np.maximum(fresh, np.clip((R - cut) / (0.02 * extent), 0, 1))
        R = cut
    if fresh.any():
        rough = 0.022 * fbm(D * 4.0, offset, 0.6, octaves=3) + 0.007 * fbm(D * 4.0, offset, 2.5, octaves=3)
        R = R * (1.0 + rough * (0.4 + 0.6 * fresh))          # fracture faces are never mirror-flat

    # Bedding strata for the layered rock: irregular layers along a tilted
    # axis, each ending in a ledge of its own random height.
    if 'ridges' in shape:
        axis = np.array([0.35, -0.2, 0.92])
        axis /= np.linalg.norm(axis)
        P = D * R[:, None]
        wobble = fbm(P * 1.5, offset, 1.2, octaves=3)
        s = P @ axis * shape['ridges'] + 0.45 * wobble
        layer = np.floor(s).astype(int)
        frac = s - layer
        amp = np.array([rng.uniform(0.0, 1.0) ** 1.5 for _ in range(64)])[np.mod(layer, 64)]
        ledge = 0.5 - frac                       # sawtooth: a sharp ledge at each layer boundary
        R = R * (1.0 + 0.06 * amp * ledge)

    # Craters: chord distance on the pre-crater surface, height along the radius.
    P = D * R[:, None]
    crater = np.zeros(n)
    count, lo, hi = shape['craters']
    alpha = 1.6
    craters = [(np.asarray(c) / np.linalg.norm(c), r, depth) for c, r, depth in shape.get('big', [])]
    for i in range(count):
        u = rng.random()
        r = (lo ** -alpha - u * (lo ** -alpha - hi ** -alpha)) ** (-1 / alpha)
        depth = rng.uniform(0.45, 1.0) * shape.get('crater_depth', 1.0)
        craters.append((random_dir(rng), r, depth))
    for c, r, depth in craters:
        # centre on the surface along direction c (nearest vertex)
        idx = int(np.argmax(D @ c))
        centre = P[idx]
        dist = np.linalg.norm(P - centre, axis=1)
        mask = dist < r * 2.2
        x = dist[mask] / r
        h = crater_shape(x) * r * 0.6 * depth
        R[mask] += h
        crater[mask] = np.maximum(crater[mask], np.clip(1.15 - x, 0, 1) * min(1.0, depth * 1.4))

    P = D * R[:, None]
    if 'bend' in shape:
        P[:, 2] += shape['bend'] * (P[:, 0] / shape['stretch'][0]) ** 2
        P[:, 1] += 0.5 * shape['bend'] * np.sin(P[:, 0] * 1.4)

    # Cavity: height above the locally smoothed surface, two scales.
    r_now = np.linalg.norm(P, axis=1)
    cav = (r_now - laplacian(r_now, E, n, 12)) + 0.6 * (r_now - laplacian(r_now, E, n, 60))
    cav = np.clip(cav / (3.0 * cav.std() + 1e-9), -1, 1)

    for v, p in zip(bm.verts, P):
        v.co = p
    obj = C.object_from_bmesh(spec['name'] + '_sculpt', bm)
    for name, values in (('cavity', cav), ('crater', crater), ('fresh', fresh)):
        attr = obj.data.attributes.new(name, 'FLOAT', 'POINT')
        attr.data.foreach_set('value', values.astype(np.float32))
    return obj


# --------------------------------------------------------------------------
# Material (procedural source for the bake)

def micro_craters(g, P, scale, seed_shift, density):
    """One octave of small craters from a Voronoi field: per-cell random
    radius, a bowl with a rim, and cells left uncratered where `density`
    (0..1) is low."""
    p = g.vmath('ADD', P, (seed_shift, seed_shift * 0.7, -seed_shift))
    d = g.voronoi(p, scale, 'F1', 1.0, 'Distance')
    rnd = g.node('ShaderNodeSeparateColor', [g.voronoi(p, scale, 'F1', 1.0, 'Color')]).outputs[0]
    r = g.madd(rnd, 0.32, 0.14)
    x = g.math('DIVIDE', d, r)
    xc = g.minimum(x, 1.0)
    bowl = g.sub(g.mul(xc, xc), 1.0)
    rim = g.mul(0.28, g.math('EXPONENT', g.mul(-1.0, g.power(g.math('DIVIDE', g.sub(x, 1.0), 0.32), 2.0))))
    h = g.mul(g.add(bowl, rim), g.mul(r, 0.36 / scale))
    active = g.math('GREATER_THAN', rnd, g.sub(0.9, g.mul(density, 0.7)))
    return g.mul(h, active)


def rock_material(name, radius, tint):
    def build(g):
        P = g.vmath('SCALE', g.coord('Object'), scale=1.0 / radius)
        N = g.geometry('Normal')
        radial = g.vmath('NORMALIZE', P)
        slope = g.sub(1.0, g.vmath('DOT_PRODUCT', N, radial, out=1))
        cavity = g.attribute('cavity')
        crater = g.attribute('crater')
        fresh = g.attribute('fresh')

        n1 = g.noise(P, 1.3, 3.0, 0.55, 0.3)
        n2 = g.noise(P, 5.5, 6.0, 0.6)
        n3 = g.noise(P, 22.0, 4.0, 0.55)
        dark, mid, warm = tint
        base = g.ramp(g.madd(n1, 0.7, g.mul(n2, 0.3)),
                      [(0.3, dark), (0.48, mid), (0.64, warm)])
        # fine grain
        base = g.mix(g.mul(g.absolute(g.sub(n3, 0.5)), 0.5), base, (0.05, 0.045, 0.04), 'MULTIPLY')
        # regolith: pale dust ponded in pits and crater floors
        pit = g.smooth(g.mul(cavity, -1.0), 0.12, 0.7)
        reg = g.mul(g.maximum(pit, g.mul(crater, 0.7)), g.madd(n2, 0.7, 0.45))
        base = g.mix(g.mul(reg, 0.75), base, (0.155, 0.138, 0.118))
        # fresh exposures: steep scarps and fracture faces, greyer and lighter
        steep = g.smooth(slope, 0.22, 0.5)
        expo = g.maximum(g.mul(steep, 0.6), g.mul(fresh, 0.5))
        base = g.mix(g.mul(expo, g.madd(n3, 0.6, 0.4)), base, (0.125, 0.12, 0.114))
        # crack lines: warped cell edges, broken up by noise
        warped = g.vmath('ADD', P, g.vmath('SCALE', g.noise(P, 3.0, 3.0, 0.5, out='Color'), scale=0.12))
        edges = g.voronoi(warped, 3.2, 'DISTANCE_TO_EDGE', 1.0, 'Distance')
        crack = g.sub(1.0, g.smooth(edges, 0.0, 0.022))
        crack = g.mul(crack, g.smooth(g.noise(P, 2.2, 2.0), 0.52, 0.62))
        base = g.mix(g.mul(crack, 0.55), base, (0.025, 0.022, 0.02))
        # metallic flecks: sparse bright specks, glossier
        fleck = g.smooth(g.noise(P, 70.0, 2.0, 0.5), 0.73, 0.78)
        base = g.mix(g.mul(fleck, 0.7), base, (0.3, 0.29, 0.27))
        rough = g.mixf(fleck, g.map_range(n2, 0.3, 0.7, 0.95, 0.85), 0.4)

        # height for the bump: micro craters at three scales, grain, cracks
        density = g.mul(g.smooth(g.noise(P, 1.6, 2.0, 0.5), 0.3, 0.7), g.sub(1.0, g.mul(fresh, 0.85)))
        h = micro_craters(g, P, 5.0, 3.1, density)
        h = g.add(h, g.mul(micro_craters(g, P, 11.0, 7.7, density), 0.9))
        h = g.add(h, g.mul(micro_craters(g, P, 26.0, 1.9, g.madd(density, 0.6, 0.3)), 0.8))
        h = g.add(h, g.mul(g.sub(g.noise(P, 9.0, 8.0, 0.62), 0.5), 0.016))
        h = g.add(h, g.mul(g.sub(g.noise(P, 40.0, 3.0, 0.5), 0.5), 0.004))
        h = g.sub(h, g.mul(crack, 0.006))
        normal = g.bump(h, 1.0, radius)
        return dict(albedo=base, rough=rough, metal=0.0, normal=normal)
    return C.source_material(name, build)


# Carbonaceous grey-brown palettes (linear RGB): dark, mid, warm.
TINTS = [
    ((0.045, 0.041, 0.037), (0.075, 0.068, 0.060), (0.10, 0.088, 0.072)),
    ((0.050, 0.044, 0.038), (0.082, 0.072, 0.060), (0.11, 0.092, 0.074)),
    ((0.042, 0.040, 0.038), (0.070, 0.066, 0.061), (0.095, 0.086, 0.074)),
    ((0.048, 0.042, 0.036), (0.080, 0.070, 0.058), (0.112, 0.094, 0.072)),
    ((0.040, 0.038, 0.036), (0.068, 0.064, 0.059), (0.092, 0.084, 0.074)),
]


# --------------------------------------------------------------------------
# Game meshes

def folds(bm):
    """Edges whose two faces point more than ~100 degrees apart: slivers
    the collapse folded over, which would render as black notches."""
    return [e for e in bm.edges if len(e.link_faces) == 2
            and e.link_faces[0].normal.dot(e.link_faces[1].normal) < -0.2]


def unfold(obj, passes=10):
    """Collapse the shortest edge of every face around a fold until none
    are left (a handful of triangles at most)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for _ in range(passes):
        bm.normal_update()
        bad = folds(bm)
        if not bad:
            break
        faces = {f for e in bad for f in e.link_faces}
        edges = {min(f.edges, key=lambda e: e.calc_length()) for f in faces}
        bmesh.ops.collapse(bm, edges=list(edges), uvs=True)
    bm.normal_update()
    left = len(folds(bm))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return left


def decimated(src, name, budget, smooth=0):
    """Collapse-decimate a copy of `src` to 75-100 % of `budget` triangles.
    `smooth` Laplacian passes first take the noise out of the source, so
    the collapse keeps the big shapes and does not fold over fine spikes
    (the baked normal map brings the detail back)."""
    if smooth:
        src = C.duplicate(src, name + '_proxy')
        mod = src.modifiers.new('smooth', 'SMOOTH')
        mod.factor = 0.6
        mod.iterations = smooth
        C.apply_modifiers(src)
    ratio = budget * 0.96 / C.tri_count(src)
    for attempt in range(8):
        obj = C.duplicate(src, name)
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        C.apply_modifiers(obj)
        left = unfold(obj)
        tris = C.tri_count(obj)
        if budget * 0.75 <= tris <= budget and not left:
            if smooth:
                bpy.data.objects.remove(src)
            return obj
        bpy.data.objects.remove(obj)
        ratio *= budget * 0.96 / tris
    raise RuntimeError(f'{name}: decimation missed the budget ({tris} vs {budget})')


def reproject_uvs(src, dst):
    """Give `dst` UVs in `src`'s layout without smearing across islands.
    Decimation collapses seam edges, so a LOD1 face can end up spanning
    two unrelated UV islands. Instead each dst face picks the src island
    nearest its centre, and every corner takes the UV of its closest
    point on that island (clamped to the island, never across a seam)."""
    sbm = bmesh.new()
    sbm.from_mesh(src.data)
    bmesh.ops.triangulate(sbm, faces=sbm.faces[:])
    uv = sbm.loops.layers.uv.active
    sbm.faces.ensure_lookup_table()
    parent = list(range(len(sbm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def corner_uv(face, vert):
        return next(l[uv].uv for l in face.loops if l.vert == vert)

    for e in sbm.edges:
        if len(e.link_faces) != 2:
            continue
        f, g = e.link_faces
        if all((corner_uv(f, v) - corner_uv(g, v)).length < 1e-5 for v in e.verts):
            parent[find(f.index)] = find(g.index)
    islands = {}
    for f in sbm.faces:
        islands.setdefault(find(f.index), []).append(f)
    trees = {}
    for key, faces in islands.items():
        verts = [l.vert.co.copy() for f in faces for l in f.loops]
        polys = [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(len(faces))]
        trees[key] = (BVHTree.FromPolygons(verts, polys), faces)
    whole = BVHTree.FromBMesh(sbm)

    dbm = bmesh.new()
    dbm.from_mesh(dst.data)
    duv = dbm.loops.layers.uv.active
    for f in dbm.faces:
        _, _, idx, _ = whole.find_nearest(f.calc_center_median())
        tree, faces = trees[find(idx)]
        for l in f.loops:
            loc, _, k, _ = tree.find_nearest(l.vert.co)
            tri = faces[k].loops
            a, b, c = (t.vert.co for t in tri)
            ua, ub, uc = (t[uv].uv.to_3d() for t in tri)
            l[duv].uv = geometry.barycentric_transform(loc, a, b, c, ua, ub, uc).to_2d()
    dbm.to_mesh(dst.data)
    dbm.free()
    sbm.free()


def build_rock(spec, index):
    C.log('rock', spec['name'], spec['kind'])
    high = sculpt(spec)
    lod0 = decimated(high, 'lod0', spec['lod0'], smooth=SHAPES[spec['kind']].get('presmooth', 8))
    for attr in ('cavity', 'crater', 'fresh'):
        lod0.data.attributes.remove(lod0.data.attributes[attr])
    lod0.data.set_sharp_from_angle(angle=math.radians(58))
    C.smart_uv(lod0, angle=60.0, margin=0.012)
    lod1 = decimated(lod0, 'lod1', spec['lod1'])
    reproject_uvs(lod0, lod1)

    # Centre on LOD0's box and scale so its bounding radius is nominal.
    co = np.array([v.co[:] for v in lod0.data.vertices])
    centre = (co.max(0) + co.min(0)) / 2
    extent = np.abs(co - centre).max()
    m = Matrix.Scale(spec['radius'] / extent, 4) @ Matrix.Translation(-Vector(centre))
    for obj in (high, lod0, lod1):
        obj.data.transform(m)
        obj.data.update()

    high.data.materials.append(rock_material(spec['name'] + '_src', spec['radius'], TINTS[index]))
    C.placeholder_material(lod0)
    size = spec['tex']
    base = C.new_image(spec['name'] + '_base', size)
    nrm = C.new_image(spec['name'] + '_normal', size, non_color=True)
    rough = C.new_image(spec['name'] + '_rough', size, non_color=True)
    # Rays start on a cage pushed out by `reach` and take the first hit
    # inward. The share of baked normals tilted past 60 degrees is logged
    # as a health check: it jumps when the game mesh folds or misses.
    reach = spec['radius'] * 0.06
    kw = dict(sources=[high], extrusion=reach, max_ray=reach * 2.5, margin=size // 48)
    C.bake(lod0, nrm, 'NORMAL', samples=4, **kw)
    C.log(f"  steep normal texels: {(C.pixels(nrm)[..., 2] < 0.5).mean() * 100:.3f} %")
    C.bake(lod0, base, channel='albedo', samples=4, **kw)
    C.bake(lod0, rough, channel='rough', samples=2, **kw)
    mr = C.pack_mr(spec['name'] + '_mr', rough)
    mat = C.baked_material(spec['name'], base, nrm, mr)
    for obj in (lod0, lod1):
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        obj.data.name = obj.name
    bpy.data.objects.remove(high)
    C.log(f"  lod0 {C.tri_count(lod0)} tris, lod1 {C.tri_count(lod1)} tris")
    C.export_glb(os.path.join(C.MODELS, spec['name'] + '.glb'), [lod0, lod1])


def main(only=None):
    os.makedirs(C.MODELS, exist_ok=True)
    for i, spec in enumerate(ROCKS):
        if only and spec['name'] not in only:
            continue
        C.reset(samples=4)
        build_rock(spec, i)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
