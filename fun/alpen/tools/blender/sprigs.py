"""Alpine sprigs — the foliage the trees are dressed in, modelled needle by
needle and photographed into an atlas.

A card tree is only as good as the picture on its cards, and the picture
was one spruce, twice. The Alps grow four conifers a rider passes, and
each reads differently at a glance precisely because its foliage does:

  * Norway spruce (Picea abies) — short stiff needles all round the shoot,
    side shoots alternating down a main axis, the whole spray hanging.
  * Silver fir (Abies alba) — flat sprays, needles parted into two ranks
    either side of the shoot, dark and glossy above.
  * Swiss stone pine (Pinus cembra) — long needles in bundles of five,
    massed into upturned brushes at the ends of stout shoots.
  * European larch (Larix decidua) — bare in winter: pale twigs knotted
    with the stubs of short shoots, a few small cones.

Each is built here from shoots and needles (thousands of small bipyramids,
nothing a game could draw) and rendered straight down, on black, into one
cell of `assets/textures/tree/alpine-sprigs.webp`, with a snow-loaded twin
half an atlas below — the convention `spruce.js` established, and the layout
`trees.py` (which builds the cards they go on) writes down.

Coordinates here are Blender's: a sprig lies in the XY plane, its stem at
the origin, growing up +Y; +Z is the side the camera sees.
"""

import bpy
import bmesh
import math
import random
import numpy as np
from mathutils import Vector, Matrix


def _mat(name, rgb, rough=0.6, spec=0.3, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if hasattr(m, 'use_nodes'):
        m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = spec
    return m


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


class Mesh:
    """An accumulating triangle soup with a material slot per face."""

    def __init__(self):
        self.v = []
        self.f = []
        self.m = []
        self.slots = []

    def slot(self, name):
        if name not in self.slots:
            self.slots.append(name)
        return self.slots.index(name)

    def add(self, verts, faces, mat):
        base = len(self.v)
        self.v.extend(verts)
        k = self.slot(mat)
        for f in faces:
            self.f.append(tuple(base + i for i in f))
            self.m.append(k)

    def build(self, name, collection, materials):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for s in self.slots:
            me.materials.append(materials[s])
        me.polygons.foreach_set('material_index', self.m)
        me.shade_smooth()
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


def frame(d):
    d = d.normalized()
    a = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    s = d.cross(a).normalized()
    u = s.cross(d).normalized()
    return s, u


def needle(mesh, base, d, length, w, h, mat, twist=0.0):
    """A needle as a bipyramid: base, a four-point waist a third of the way
    out, tip. Eight triangles."""
    s, u = frame(d)
    if twist:
        c, sn = math.cos(twist), math.sin(twist)
        s, u = s * c + u * sn, u * c - s * sn
    mid = base + d * (length * 0.35)
    tip = base + d * length
    verts = [tuple(base), tuple(mid + s * w), tuple(mid + u * h), tuple(mid - s * w),
             tuple(mid - u * h), tuple(tip)]
    faces = [(0, 2, 1), (0, 3, 2), (0, 4, 3), (0, 1, 4), (5, 1, 2), (5, 2, 3), (5, 3, 4), (5, 4, 1)]
    mesh.add(verts, faces, mat)


def tube(mesh, pts, r0, r1, mat, sides=6):
    """A tapered twig along a polyline."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        s, u = frame(d)
        r = r0 + (r1 - r0) * i / (n - 1)
        rings.append([tuple(p + (s * math.cos(a) + u * math.sin(a)) * r)
                      for a in (k / sides * math.tau for k in range(sides))])
    verts = [q for ring in rings for q in ring]
    faces = []
    for i in range(n - 1):
        for j in range(sides):
            jn = (j + 1) % sides
            faces.append((i * sides + j, i * sides + jn, (i + 1) * sides + jn, (i + 1) * sides + j))
    faces.append(tuple((n - 1) * sides + j for j in range(sides)))
    mesh.add(verts, faces, mat)


def curve(p0, d0, length, bend, steps=8, droop=0.0):
    """Points along a shoot that bends in the sprig's plane by `bend`
    radians over its length and sags out of it by `droop`."""
    pts = [Vector(p0)]
    d = Vector(d0).normalized()
    seg = length / steps
    axis = Vector((0, 0, 1))
    for i in range(steps):
        d = (Matrix.Rotation(bend / steps, 3, axis) @ d)
        d.z -= droop / steps
        d.normalize()
        pts.append(pts[-1] + d * seg)
    return pts


def along(pts, t):
    """Point and direction a fraction t of the way along a polyline."""
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg)
    at = t * total
    for i, L in enumerate(seg):
        if at <= L or i == len(seg) - 1:
            f = 0 if L == 0 else min(1.0, at / L)
            return pts[i].lerp(pts[i + 1], f), (pts[i + 1] - pts[i]).normalized()
        at -= L
    return pts[-1], (pts[-1] - pts[-2]).normalized()


def shoot_length(pts):
    return sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))


# ---------------------------------------------------------------------------
# The four species
# ---------------------------------------------------------------------------

def spruce_shoot(mesh, pts, rnd, density=1500, length=(0.016, 0.025), angle=0.85):
    """Needles all the way round, spiralled, leaning towards the tip."""
    L = shoot_length(pts)
    n = int(L * density)
    for k in range(n):
        t = (k + rnd.random() * 0.5) / n
        p, d = along(pts, t)
        s, u = frame(d)
        a = k * 2.39996 + rnd.random() * 0.3            # golden-angle phyllotaxis
        radial = s * math.cos(a) + u * math.sin(a)
        lean = angle * (0.85 + 0.3 * rnd.random()) * (1.0 - 0.35 * t)
        nd = (d * math.cos(lean) + radial * math.sin(lean)).normalized()
        ln = (length[0] + (length[1] - length[0]) * rnd.random()) * (0.65 + 0.35 * min(1, t * 4))
        needle(mesh, p + radial * 0.0015, nd, ln, 0.0014, 0.0014,
               'needleSpruce' if rnd.random() > 0.2 else 'needleSpruceLight')


def fir_shoot(mesh, pts, rnd, density=700, length=(0.022, 0.032)):
    """Flat needles parted into two ranks, laid nearly in the spray's plane."""
    L = shoot_length(pts)
    n = int(L * density)
    for k in range(n):
        t = (k + rnd.random() * 0.5) / n
        p, d = along(pts, t)
        side = Vector((0, 0, 1)).cross(d).normalized()
        sgn = 1 if k % 2 else -1
        spread = 1.05 + 0.25 * rnd.random()
        nd = (d * math.cos(spread) + side * sgn * math.sin(spread))
        nd.z += 0.08 + 0.1 * rnd.random()
        nd.normalize()
        ln = (length[0] + (length[1] - length[0]) * rnd.random()) * (0.6 + 0.4 * min(1, t * 3)) * (1 - 0.35 * t)
        needle(mesh, p, nd, ln, 0.0019, 0.0008, 'needleFir', twist=0.0)


def pine_brush(mesh, pts, rnd, start=0.35, bundles=70, length=(0.055, 0.085)):
    """Bundles of five long needles, crowded towards the end of the shoot,
    radiating forward into a brush."""
    for k in range(bundles):
        t = start + (1 - start) * (k + rnd.random()) / bundles
        p, d = along(pts, t)
        s, u = frame(d)
        a = k * 2.39996
        radial = s * math.cos(a) + u * math.sin(a)
        lean = 0.75 - 0.45 * (t - start) / (1 - start) + 0.2 * rnd.random()
        base_dir = (d * math.cos(lean) + radial * math.sin(lean)).normalized()
        for j in range(5):
            jitter = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.12
            nd = (base_dir + jitter).normalized()
            ln = length[0] + (length[1] - length[0]) * rnd.random()
            needle(mesh, p, nd, ln, 0.0007, 0.0007,
                   'needlePine' if rnd.random() > 0.25 else 'needlePineLight')


def larch_spurs(mesh, pts, rnd, every=0.022, size=0.004):
    """The stubs a larch's needle bunches grew from: small knobs along the twig."""
    L = shoot_length(pts)
    n = int(L / every)
    for k in range(n):
        t = (k + 0.5 + rnd.uniform(-0.3, 0.3)) / n
        p, d = along(pts, t)
        s, u = frame(d)
        a = k * 2.39996
        radial = s * math.cos(a) + u * math.sin(a)
        stub = [p, p + radial * size * 1.6 + d * size * 0.6]
        tube(mesh, stub, size * 0.75, size * 0.55, 'twigLarch', sides=5)


def snow_on(mesh_obj, pts_list, rnd, collection, materials, name, amount=1.0):
    """Snow resting on a sprig: metaballs along the upper side of every shoot,
    fused into one lumpy mantle and meshed."""
    mb = bpy.data.metaballs.new(name + '_mb')
    mb.resolution = 0.003
    mb.render_resolution = 0.003
    mb.threshold = 0.55
    for pts in pts_list:
        L = shoot_length(pts)
        n = max(2, int(L / 0.02 * amount))
        for k in range(n):
            # Snow lies in clumps where the spray is densest and leaves gaps,
            # rather than icing every shoot along its length.
            if rnd.random() > 0.7 * amount:
                continue
            t = (k + rnd.random()) / n
            p, d = along(pts, t)
            side = Vector((0, 0, 1)).cross(d).normalized()
            for c in range(1 + int(rnd.random() * 2.2)):
                # pillows, not balls: snow settles flat on a bough
                e = mb.elements.new(type='ELLIPSOID')
                e.co = p + side * rnd.uniform(-0.012, 0.012) + d * rnd.uniform(-0.01, 0.01) \
                    + Vector((0, 0, 0.007 + rnd.random() * 0.004))
                e.radius = (0.010 + rnd.random() * 0.013) * (1.0 - 0.45 * t)
                e.size_x = 1.0 + rnd.random() * 0.6
                e.size_y = 1.0 + rnd.random() * 0.6
                e.size_z = 0.5
                e.rotation = Matrix.Rotation(rnd.random() * math.tau, 4, 'Z').to_quaternion()
                e.stiffness = 1.2 + rnd.random()
    ob = bpy.data.objects.new(name + '_snow', mb)
    collection.objects.link(ob)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    me.materials.clear()
    me.materials.append(materials['snow'])
    snow = bpy.data.objects.new(name + '_snow', me)
    collection.objects.link(snow)
    return snow


def build_spruce(rnd):
    """A spruce spray: an arching main shoot, alternate side shoots that
    shorten towards the tip, and a few third-order shoots on the longest."""
    mesh = Mesh()
    shoots = []
    main = curve((0, 0, 0), (0.05, 1, 0), 0.40, bend=-0.15, droop=0.05)
    shoots.append(main)
    tube(mesh, main, 0.0035, 0.0012, 'twigSpruce')
    for i in range(12):
        t = 0.08 + i * 0.075
        p, d = along(main, t)
        sgn = 1 if i % 2 else -1
        ang = sgn * (0.7 + 0.2 * rnd.random())
        dd = Matrix.Rotation(ang, 3, Vector((0, 0, 1))) @ d
        length = 0.21 * (1 - t * 0.75) * (0.85 + 0.3 * rnd.random())
        side = curve(p, dd, length, bend=-sgn * 0.35, droop=0.04)
        shoots.append(side)
        tube(mesh, side, 0.0018, 0.0008, 'twigSpruce')
        for j in range(3 if length > 0.12 else 1):
            q, e = along(side, 0.3 + 0.22 * j)
            s2 = -sgn if j % 2 else sgn
            ee = Matrix.Rotation(s2 * (0.7 + 0.2 * rnd.random()), 3, Vector((0, 0, 1))) @ e
            sub = curve(q, ee, length * (0.42 - 0.08 * j), bend=0, droop=0.02, steps=4)
            shoots.append(sub)
            tube(mesh, sub, 0.001, 0.0006, 'twigSpruce', sides=4)
    for s in shoots:
        spruce_shoot(mesh, s, rnd)
    return mesh, shoots


def build_fir(rnd):
    """A silver-fir spray: flat and regular, side shoots opposite each other
    like a fishbone, every needle parted to the sides."""
    mesh = Mesh()
    shoots = []
    main = curve((0, 0, 0), (0, 1, 0), 0.40, bend=0.08, droop=0.02)
    shoots.append(main)
    tube(mesh, main, 0.0035, 0.0012, 'twigFir')
    for i in range(6):
        t = 0.16 + i * 0.13
        p, d = along(main, t)
        for sgn in (-1, 1):
            dd = Matrix.Rotation(sgn * (0.9 + 0.1 * rnd.random()), 3, Vector((0, 0, 1))) @ d
            length = 0.17 * (1 - t * 0.7) * (0.9 + 0.2 * rnd.random())
            side = curve(p, dd, length, bend=-sgn * 0.25, droop=0.02)
            shoots.append(side)
            tube(mesh, side, 0.0018, 0.0008, 'twigFir')
    for s in shoots:
        fir_shoot(mesh, s, rnd)
    return mesh, shoots


def build_pine(rnd):
    """A stone-pine branch end: a stout shoot forking into upturned brushes
    of long five-needle bundles, the bare wood showing between them."""
    mesh = Mesh()
    shoots = []
    main = curve((0, 0, 0), (0, 1, 0), 0.26, bend=0.05)
    tube(mesh, main, 0.006, 0.004, 'twigPine')
    shoots.append(main)
    tips = [(main, 0.45, 0.0)]
    for i, (ang, at) in enumerate(((0.55, 0.55), (-0.6, 0.7), (0.3, 0.92), (-0.25, 0.4))):
        p, d = along(main, at)
        dd = Matrix.Rotation(ang, 3, Vector((0, 0, 1))) @ d
        sub = curve(p, dd, 0.14 + 0.05 * rnd.random(), bend=-ang * 0.4)
        tube(mesh, sub, 0.0042, 0.003, 'twigPine')
        shoots.append(sub)
        tips.append((sub, 0.25, 0.0))
    for s, start, _ in tips:
        pine_brush(mesh, s, rnd, start=start, bundles=int(60 * shoot_length(s) / 0.15) + 30)
    return mesh, shoots


def build_larch(rnd):
    """A larch twig in winter: a long shoot drooping at its end, short side
    shoots, every one knotted with spur stubs, and two small cones."""
    mesh = Mesh()
    shoots = []
    main = curve((0, 0, 0), (0.1, 1, 0), 0.42, bend=-0.35, droop=0.1)
    tube(mesh, main, 0.0035, 0.0012, 'twigLarch')
    shoots.append(main)
    for i in range(7):
        t = 0.15 + i * 0.11
        p, d = along(main, t)
        sgn = 1 if i % 2 else -1
        dd = Matrix.Rotation(sgn * (0.6 + 0.3 * rnd.random()), 3, Vector((0, 0, 1))) @ d
        side = curve(p, dd, 0.16 * (1 - t * 0.6) * (0.8 + 0.4 * rnd.random()), bend=-sgn * 0.5, droop=0.06)
        tube(mesh, side, 0.0019, 0.0008, 'twigLarch', sides=5)
        shoots.append(side)
    for s in shoots:
        larch_spurs(mesh, s, rnd)
    # two small upright cones on the upper side of the main shoot
    for t in (0.3, 0.58):
        p, d = along(main, t)
        c = []
        for k in range(7):
            y = k / 6
            r = 0.009 * math.sin(math.pi * min(1, y * 1.1)) + 0.002
            c.append((p.x + 0.0, p.y + 0.0, p.z + 0.006 + y * 0.028, r))
        verts, faces = [], []
        for k, (x, y, z, r) in enumerate(c):
            for j in range(8):
                a = j / 8 * math.tau
                verts.append((x + math.cos(a) * r, y + math.sin(a) * r, z))
        for k in range(len(c) - 1):
            for j in range(8):
                jn = (j + 1) % 8
                faces.append((k * 8 + j, k * 8 + jn, (k + 1) * 8 + jn, (k + 1) * 8 + j))
        mesh.add(verts, faces, 'cone')
    return mesh, shoots


SPECIES = {
    'spruce': (build_spruce, True),
    'fir': (build_fir, True),
    'pine': (build_pine, True),
    'larch': (build_larch, False),
}


def materials():
    # Every needle is redder than it is blue in linear light: the foliage
    # material turns texels whose blue exceeds their red by 6–16% into snow
    # (that is how the snow-loaded twins get the game's snow colour), and a
    # true blue-green stone pine would go white with them.
    return {
        'needleSpruce': _mat('needleSpruce', srgb('#2d4a2b'), 0.55),
        'needleSpruceLight': _mat('needleSpruceLight', srgb('#3f6236'), 0.55),
        'needleFir': _mat('needleFir', srgb('#2c4626'), 0.35, 0.5),
        'needlePine': _mat('needlePine', srgb('#4a5e40'), 0.5),
        'needlePineLight': _mat('needlePineLight', srgb('#64785a'), 0.5),
        'twigSpruce': _mat('twigSpruce', srgb('#6a4a32'), 0.8),
        'twigFir': _mat('twigFir', srgb('#55493c'), 0.8),
        'twigPine': _mat('twigPine', srgb('#6d5a49'), 0.8),
        'twigLarch': _mat('twigLarch', srgb('#8a7a68'), 0.85),
        'cone': _mat('cone', srgb('#6b4e36'), 0.8),
        # a touch blue, so the foliage material's frost test finds it (b/r 1.06–1.16)
        'snow': _mat('snow', (0.84, 0.88, 0.95), 0.45, 0.4),
    }


# ---------------------------------------------------------------------------
# Photographing them
# ---------------------------------------------------------------------------

def build_all(collection, seed=7):
    """Every sprig, green and (for the evergreens) snow-loaded, as objects
    named `<species>` and `<species>_snow` (the snow twin is the same sprig
    with its mantle on). Larch's twin is the same twig under hoar frost."""
    mats = materials()
    out = {}
    for k, (name, (fn, snowy)) in enumerate(SPECIES.items()):
        rnd = random.Random(seed + k)
        mesh, shoots = fn(rnd)
        bare = mesh.build(name, collection, mats)
        out[name] = [bare]
        twin = bpy.data.objects.new(name + '_snowtwin', bare.data)
        collection.objects.link(twin)
        if snowy:
            mantle = snow_on(bare, shoots, rnd, collection, mats, name)
            out[name + '_snow'] = [twin, mantle]
        else:
            rime = bare.data.copy()
            rime.materials.clear()
            rime.materials.append(_mat('rime', (0.78, 0.80, 0.84), 0.7))
            twin.data = rime
            out[name + '_snow'] = [twin]
    return out


def render_cell(objects, all_objects, path, px=(448, 512), margin=0.04):
    """One sprig, straight down, on transparent black, filling a cell of
    `px` pixels with its stem at the bottom centre."""
    scene = bpy.context.scene
    for ob in all_objects:
        ob.hide_render = ob not in objects
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objects:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    aspect = px[0] / px[1]
    h = max(hi.y - lo.y, (hi.x - lo.x) / aspect) * (1 + margin)
    w = h * aspect
    cam = scene.camera
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(w, h)
    stem = objects[0].matrix_world.translation
    cam.location = (stem.x, lo.y + h / 2 - h * margin * 0.5, hi.z + 1.0)
    cam.rotation_euler = (0, 0, 0)
    scene.render.resolution_x, scene.render.resolution_y = px
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return {'width': w, 'height': h}



# ---------------------------------------------------------------------------
# The atlas
# ---------------------------------------------------------------------------

def _load_pixels(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px


def _strip(src, cols, px_h, out_w):
    """A vertical bark strip out of a photograph: `cols` of its width,
    resampled to `out_w` × `px_h`, nearest-neighbour (it is a tiling
    texture, so the resample only has to be stable, not pretty)."""
    h, w = src.shape[:2]
    c0, c1 = int(cols[0] * w), int(cols[1] * w)
    ys = (np.arange(px_h) * h / px_h).astype(int)
    xs = (c0 + np.arange(out_w) * (c1 - c0) / out_w).astype(int)
    return src[ys][:, xs]


def build_atlas(collection, out_path, cell_dir, tex_dir, size=2048):
    """Photograph every sprig into its cell and compose the atlas in the
    layout `trees.py` (and `spruce.js`) read: bark strips down the left
    eighth, the four species in columns, two sprigs each in the top half
    and their snow-loaded twins exactly half an atlas below, all on black."""
    import os
    os.makedirs(cell_dir, exist_ok=True)
    atlas = np.zeros((size, size, 4), dtype=np.float32)
    atlas[..., 3] = 1.0
    bark_col = int(size * 0.125)
    cell_w = (size - bark_col) // 4
    cell_h = size // 4
    order = ['spruce', 'fir', 'pine', 'larch']
    scene = bpy.context.scene
    sizes = {}
    for row, seed in enumerate((7, 29)):
        for ob in list(collection.objects):
            if ob.type in ('MESH', 'META'):
                bpy.data.objects.remove(ob)
        built = build_all(collection, seed)
        everything = [o for v in built.values() for o in v]
        for col, name in enumerate(order):
            for frost in (False, True):
                key = name + ('_snow' if frost else '')
                path = os.path.join(cell_dir, '%s_%d.png' % (key, row))
                sizes[(name, row)] = render_cell(built[key], everything, path, px=(cell_w, cell_h))
                px = _load_pixels(path)
                # straight alpha onto black
                rgb = px[..., :3] * px[..., 3:4]
                # Blender's pixel rows run bottom-up, as the atlas's v does
                y0 = (size // 2 if not frost else 0) + (1 - row) * cell_h
                x0 = bark_col + col * cell_w
                atlas[y0:y0 + cell_h, x0:x0 + cell_w, :3] = rgb
    # bark strips: spruce/fir from the photographed bough atlas's own strip,
    # stone pine and larch from the two bark photographs, each a little
    # darkened and cooled towards the reddish grey their bark actually is
    strip_w = int(size * 0.032)
    sources = [
        (os.path.join(tex_dir, 'spruce-boughs-v2.png'), (0.006, 0.116), (1.0, 1.0, 1.0), 0.003),
        (os.path.join(tex_dir, 'weathered-tree-bark.jpg'), (0.30, 0.62), (0.62, 0.55, 0.52), 0.041),
        (os.path.join(tex_dir, 'tree-bark.jpg'), (0.20, 0.52), (1.10, 0.92, 0.86), 0.079),
    ]
    for path, cols, tint, u0 in sources:
        src = _load_pixels(path)
        strip = _strip(src, cols, size, strip_w)[..., :3] * np.array(tint, dtype=np.float32)
        x0 = int(u0 * size)
        atlas[:, x0:x0 + strip_w, :3] = np.clip(strip, 0, 1)
    # A byte image stores what it is given; the cells are already sRGB as
    # rendered, so nothing may convert them again on the way out.
    img = bpy.data.images.new('alpine-sprigs', size, size, alpha=False)
    img.pixels.foreach_set(atlas.ravel())
    img.filepath_raw = out_path
    img.file_format = 'WEBP'
    img.save(filepath=out_path, quality=88)
    bpy.data.images.remove(img)
    return sizes


def stage():
    """The studio the sprigs are photographed in: straight down, a key light
    raking across so snow has form, a fill from the other side so no needle
    falls to the black the game keys out, on black."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    world = scene.world or bpy.data.worlds.new('sprigs')
    scene.world = world
    if hasattr(world, 'use_nodes'):
        world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0, 0, 0, 1)
    bg.inputs[1].default_value = 0.0
    col = bpy.data.collections.get('sprig_stage') or bpy.data.collections.new('sprig_stage')
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    for ob in list(col.objects):
        bpy.data.objects.remove(ob)
    cd = bpy.data.cameras.new('sprig_cam')
    cd.type = 'ORTHO'
    cam = bpy.data.objects.new('sprig_cam', cd)
    col.objects.link(cam)
    scene.camera = cam
    for name, energy, rot, ang in (('sprig_key', 4.0, (0.85, -0.45, 0.6), 0.25),
                                   ('sprig_fill', 1.2, (-0.5, 0.4, 2.8), 0.8)):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.angle = ang
        lo = bpy.data.objects.new(name, ld)
        col.objects.link(lo)
        lo.rotation_euler = rot
    return scene
