"""Meteora — the campaign's small craft (group `craft`).

Five models, built in the pipeline of build_ships.py, whose helpers this
script imports (importing it builds nothing):

  swift.glb    the Belt Watch interceptor, about 10 m: a slender dart with
               one big engine, small cranked-delta wings set well aft,
               canards and a bubble canopy (the `glass` node)
  anvil.glb    the Belt Watch bomber, about 19 m: a thick lifting body, two
               big engines, armoured stub wings, a recessed torpedo bay, a
               stepped two-seat canopy (`glass`) and a rear auto-turret
               (`turret_rear` with its child `turret_rear_gun`)
  drone.glb    the Tender repair drone, about 3.5 m: a utility body, four
               thruster pods, two folded arms (`arm_L`, `arm_R`) and an
               attach plate underneath
  torpedo.glb  the Lance heavy torpedo, 4.5 m (the game tints a copy dark
               red for the Harrow's Spike)
  shuttle.glb  the Skiff evacuation shuttle, about 28 m

Every model is built in Blender space with the nose along +Y and the top
along +Z (the glTF exporter delivers it nose along three.js -Z) from bmesh
primitives with procedural paint. The parts are joined into one `hull`
mesh, unwrapped and baked: normals selected-to-active from a bevelled copy,
then base colour, roughness, metallic and emission. Parts tagged as a
separate node (the turret, the drone's arms) are baked with the hull, so
they share its texture, and split off afterwards into their own mesh node
whose origin is the pivot the game turns them about.

Anchors are empties parented to the hull: nozzle_* (exhaust along local
-Y), muzzle_*, rcs_NN (puff along local +Z), launcher_*, cam_cockpit, dock,
col_NN (collision sphere; uniform scale = radius), light_* and bay_*
(launch along local -Y). After the export each model's anchors are
written to js/anchors/<name>.js in glTF space.

Run with model names after `--` to rebuild only those. METEORA_FAST=1 gives
a quick geometry iteration (tiny textures, 1 sample).
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S

FAST = bool(os.environ.get('METEORA_FAST'))
ANCHORS_DIR = os.path.join(C.JS, 'anchors')

lin = S.lin
OFF_WHITE, GRAPHITE, ORANGE, HAZARD = S.OFF_WHITE, S.GRAPHITE, S.ORANGE, S.HAZARD
WARM_GREY = lin('#8c857a')
LIGHT_GREY = lin('#b5afa4')
RUST = lin('#b8652a')
WINDOW = lin('#ffd9a0')
CROSS_GREEN = lin('#2a8c4a')
SOOT = S.SOOT
INK = (0.012, 0.012, 0.013)

T, R = Matrix.Translation, Matrix.Rotation
rad = math.radians


# ==========================================================================
# Geometry helpers (on top of build_ships.py)

def rcs_block(name, mat, hole_mat, matrix, size=0.2):
    """An RCS thruster port: a low tapered block with a dark nozzle."""
    h = size * 0.4
    block = S.box(name, (size, size, h), mat, matrix @ T((0, 0, h * 0.19)), taper=0.84)
    k = size / 0.2
    nozzle = S.lathe(name + '_n', [(0.03 * k, 0.0), (0.03 * k, size * 0.2), (0.062 * k, size * 0.27), (0.062 * k, 0.0)],
                     6, (0, 0), hole_mat, smooth=False)
    S.transformed(nozzle, matrix @ R(rad(90), 4, 'X'))
    return [block, nozzle]


def place_rcs(ports, bvh, metal, hole, size=0.2):
    """ports: (name, ray origin, ray direction, puff direction). The block
    sits on the hit surface, or faces the puff direction when the surface
    does not (forward and aft ports); the empty sits just outside its
    nozzle with local +Z along the puff."""
    parts, empties = [], []
    for name, origin, ray, puff in ports:
        loc, m = S.frame_on(bvh, origin, ray)
        d = Vector(puff).normalized()
        if m.col[2].xyz.dot(d) < 0.8:
            m = S.facing(loc + d * size * 0.15, d)
        parts += rcs_block(name + '_block', metal, hole, m, size)
        empties.append(S.empty(name, m.translation + m.col[2].xyz * size * 0.4, d))
    return parts, empties


def sphere_empty(name, location, radius):
    """A collision sphere or subsystem: an empty whose uniform scale is the
    radius in metres."""
    e = S.empty(name, location)
    e.empty_display_type = 'SPHERE'
    e.empty_display_size = 1.0
    e.scale = (radius, radius, radius)
    return e


def aimed_empty(name, location, local_axis, direction):
    """An empty whose local `local_axis` ('-Y' for bays) points along
    `direction`."""
    e = S.empty(name, location)
    d = Vector(direction).normalized()
    e.rotation_mode = 'QUATERNION'
    e.rotation_quaternion = d.to_track_quat(local_axis, 'Z' if abs(d.z) < 0.9 else 'Y')
    return e


def tag(objs, node):
    """Mark parts that are split off as the separate mesh node `node` after
    the bake (they share the hull's texture)."""
    for o in objs:
        vg = o.vertex_groups.new(name='node:' + node)
        vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    return objs


def split_node(hull, node, matrix, parent=None, parent_matrix=None):
    """Separate the faces tagged `node` from the hull into their own object
    whose origin and axes are `matrix` (world)."""
    group = hull.vertex_groups.get('node:' + node)
    C.activate(hull)
    hull.vertex_groups.active_index = group.index
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='VERT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.vertex_group_select()
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    obj = next(o for o in bpy.context.selected_objects if o is not hull)
    obj.name = node
    obj.data.name = node
    obj.vertex_groups.clear()
    obj.data.transform(matrix.inverted())
    obj.data.update()
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix()
        obj.matrix_basis = parent_matrix.inverted() @ matrix
    else:
        obj.matrix_basis = matrix
    return obj


def canonical_mesh(obj):
    """Rebuild obj's mesh with every face starting at its lowest vertex
    index and the faces sorted, so that triangulation and export do not
    depend on the order a bmesh operator happened to leave them in (the
    bisect in bubble() does not keep it from run to run). Keeps material
    indices and smooth flags."""
    me = obj.data
    verts = [v.co.copy() for v in me.vertices]
    polys = []
    for poly in me.polygons:
        vs = list(poly.vertices)
        k = vs.index(min(vs))
        polys.append((tuple(vs[k:] + vs[:k]), poly.material_index, poly.use_smooth))
    polys.sort(key=lambda t: t[0])
    new = bpy.data.meshes.new(me.name)
    new.from_pydata(verts, [], [t[0] for t in polys])
    for poly, (_, mi, smooth) in zip(new.polygons, polys):
        poly.material_index = mi
        poly.use_smooth = smooth
    for m in me.materials:
        new.materials.append(m)
    name = me.name
    obj.data = new
    bpy.data.meshes.remove(me)
    new.name = name
    return obj


def bubble(name, centre, radii, mat, front_taper=0.38, top_taper=0.15, cut=None, u=28, v=16):
    """A canopy bubble: a UV sphere stretched to `radii`, narrowed and
    lowered toward the front (+Y), cut below the plane z = `cut`."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    for vert in bm.verts:
        x, y, z = vert.co
        t = max(0.0, y)
        vert.co = Vector((cx + x * rx * (1.0 - front_taper * t * t), cy + y * ry,
                          cz + z * rz * (1.0 - top_taper * t * t)))
    if cut is not None:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cut),
                               plane_no=(0, 0, 1), clear_inner=True)
    obj = canonical_mesh(S.finish_bm(name, bm, None))
    obj.data.materials.append(mat)
    return obj


def bubble_point(centre, radii, y, angle, grow=1.0, front_taper=0.38, top_taper=0.15):
    """A point on bubble()'s surface at station y and polar angle (0 = +X,
    90 = top), pushed out by `grow`."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    u = (y - cy) / ry
    t = max(0.0, u)
    r = math.sqrt(max(1e-6, 1 - u * u))
    return Vector((cx + math.cos(angle) * r * rx * (1.0 - front_taper * t * t) * grow, y,
                   cz + math.sin(angle) * r * rz * (1.0 - top_taper * t * t) * grow))


def petals(name, count, y0, y1, r0, r1, centre, mat, cover=1.12, thick=0.022, phase=0.0):
    """A ring of overlapping nozzle petals (flaps) on a cone from (y0, r0)
    to (y1, r1) around the axis through `centre` (x, z)."""
    cx, cz = centre
    bm = bmesh.new()
    half = math.pi / count * cover
    for i in range(count):
        a = 2 * math.pi * i / count + phase
        lift = thick * (0.3 if i % 2 else 0.0)        # alternate petals sit proud
        quad = []
        for y, r in ((y0, r0), (y1, r1)):
            for s in (-1, 1):
                quad.append((a + s * half, y, r + lift))
        vs = []
        for off in (0.0, thick):
            for b, y, r in quad:
                rr = r + off
                vs.append(bm.verts.new((cx + rr * math.cos(b), y, cz + rr * math.sin(b))))
        # inner: 0 (y0,-) 1 (y0,+) 2 (y1,-) 3 (y1,+); outer +4
        for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            bm.faces.new([vs[k] for k in f])
    return S.finish_bm(name, bm, mat, smooth=False)


def ring_bar(name, centre, radius, y, width, height, mat, sides=24):
    """A thin solid disc of radius + height across the Y axis through
    `centre` (x, z). Set into a round hull of `radius`, only its rim shows:
    a band standing `height` proud, such as a cooling ring or a strap."""
    cx, cz = centre
    prof = [(y + width / 2, 0.0), (y + width / 2, radius + height), (y - width / 2, radius + height),
            (y - width / 2, 0.0)]
    return S.lathe(name, prof, sides, (cx, cz), mat, smooth=False)


def drape(name, bvh, origin, ray, size, mat, angle=0.0, thick=0.05, inset=0.86, embed=0.02, n=3,
          along=(0, 1, 0)):
    """A plate that follows the surface it lies on: an n x n grid over a
    size[0] x size[1] footprint (turned by `angle` about the surface normal
    at the ray's hit), each point projected onto the surface; the bottom
    sits `embed` under it and the top `thick` over it, drawn in by `inset`
    so the plate has chamfered edges. Unlike a flat box it leaves no gap
    on a curved hull."""
    loc, m = S.frame_on(bvh, origin, ray, along)
    m = m @ R(angle, 4, 'Z')
    X, Y, Z = m.col[0].xyz, m.col[1].xyz, m.col[2].xyz

    def surface(u, v):
        p = loc + X * u + Y * v
        hit = bvh.ray_cast(p + Z * 0.5, -Z, 1.5)[0]
        return hit if hit is not None else p

    bm = bmesh.new()
    grids = []
    for scale_, off in ((1.0, -embed), (inset, thick)):
        grid = [[bm.verts.new(surface((i / (n - 1) - 0.5) * size[0] * scale_, (j / (n - 1) - 0.5) * size[1] * scale_)
                              + Z * off) for j in range(n)] for i in range(n)]
        grids.append(grid)
    lo, hi = grids
    for i in range(n - 1):
        for j in range(n - 1):
            bm.faces.new((hi[i][j], hi[i + 1][j], hi[i + 1][j + 1], hi[i][j + 1]))
            bm.faces.new((lo[i][j], lo[i][j + 1], lo[i + 1][j + 1], lo[i + 1][j]))
    ring = [(i, 0) for i in range(n - 1)] + [(n - 1, j) for j in range(n - 1)] + \
           [(i, n - 1) for i in range(n - 1, 0, -1)] + [(0, j) for j in range(n - 1, 0, -1)]
    for k in range(len(ring)):
        (a, b), (c, d) = ring[k], ring[(k + 1) % len(ring)]
        bm.faces.new((lo[a][b], lo[c][d], hi[c][d], hi[a][b]))
    return S.finish_bm(name, bm, mat, smooth=False)


def section_at(stations, y):
    """Loft row parameters at station y, linearly interpolated between the
    rows (rows run from +Y to -Y)."""
    for a, b in zip(stations, stations[1:]):
        if b[0] <= y <= a[0]:
            t = (a[0] - y) / (a[0] - b[0])
            return tuple(p + (q - p) * t for p, q in zip(a, b))
    return stations[0] if y > stations[0][0] else stations[-1]


def cylinder(name, p0, p1, r, mat, sides=8, smooth=True, caps=True):
    """A cylinder between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    prof = [(0.0, 0.0), (0.0, r), (length, r), (length, 0.0)] if caps else [(0.0, r), (length, r)]
    obj = S.lathe(name, prof, sides, (0, 0), mat, smooth=smooth, sharp=40)
    S.transformed(obj, T(p0) @ d.to_track_quat('Y', 'Z').to_matrix().to_4x4())
    return obj


# ==========================================================================
# Paint helpers

def rect(g, u, v, u0, u1, v0, v1, soft=0.01):
    return g.mul(S.band(g, u, u0, u1, soft), S.band(g, v, v0, v1, soft))


def union(g, masks):
    out = masks[0]
    for m in masks[1:]:
        out = g.maximum(out, m)
    return out


SEGMENTS = {'0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
            '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g'}


def digits(g, u, v, text, h, uc=0.0, vc=0.0, soft=0.004, weight=0.17):
    """Seven-segment paint-block digits of height h centred on (uc, vc),
    reading along +u with v up. Returns a 0..1 mask."""
    w, t, gap = h * 0.56, h * weight, h * 0.24
    total = len(text) * w + (len(text) - 1) * gap
    x = uc - total / 2
    v0 = vc - h / 2
    masks = []
    for ch in text:
        boxes = {
            'a': (x, x + w, v0 + h - t, v0 + h), 'd': (x, x + w, v0, v0 + t),
            'g': (x, x + w, v0 + h / 2 - t / 2, v0 + h / 2 + t / 2),
            'b': (x + w - t, x + w, v0 + h / 2, v0 + h), 'c': (x + w - t, x + w, v0, v0 + h / 2),
            'e': (x, x + t, v0, v0 + h / 2), 'f': (x, x + t, v0 + h / 2, v0 + h),
        }
        for s in SEGMENTS.get(ch, ''):
            masks.append(rect(g, u, v, *boxes[s], soft))
        x += w + gap
    return union(g, masks) if masks else 0.0


def stencil(g, u, v, u0, v0, length, h, seed=0.0, soft=0.002):
    """A line of small blocks of varying width that reads as stencilled
    text from a few metres away."""
    pitch = h * 0.78
    s = g.mul(g.sub(u, u0), 1.0 / pitch)
    cell = g.math('FLOOR', s)
    f = g.math('FRACT', s)
    noise = g.node('ShaderNodeTexWhiteNoise', [g.combine(cell, seed, seed * 1.7)], noise_dimensions='3D').outputs['Value']
    on = g.math('GREATER_THAN', noise, 0.16)
    glyph = g.mul(g.math('LESS_THAN', f, g.add(0.42, g.mul(noise, 0.38))), on)
    return g.mul(glyph, rect(g, u, v, u0, u0 + length, v0, v0 + h, soft))


def side_uv(g, x, y, z, nx, yc):
    """Coordinates for decals on the flanks: u runs nose-ward on the right
    and aft on the left, so text reads left to right from either side."""
    sgn = g.math('SIGN', nx)
    return g.mul(g.sub(y, yc), sgn), z


def ring_marks(g, y, angle, y0, y1, count, duty=0.5):
    """`count` alternating blocks around a ring between y0 and y1."""
    s = g.math('FRACT', g.mul(angle, count / (2 * math.pi)))
    return g.mul(S.band(g, y, y0, y1, 0.004), g.math('LESS_THAN', s, duty))


def polar_angle(g, x, z, cx=0.0, cz=0.0):
    return g.math('ARCTAN2', g.sub(z, cz), g.sub(x, cx))


def nozzle_paint(name, cx, cz, mirror=True, exit_y=None, ridges=0.0):
    """Bare heat-tinted metal outside, soot inside the bell. Inner faces are
    told apart by their normals pointing at the engine axis (at |x| = cx
    when `mirror`, else x = cx; z = cz), so any bell size works."""
    def build(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        if mirror and cx:
            sgn = g.math('SIGN', x)
            rx, nxx = g.sub(g.absolute(x), cx), g.mul(nx, sgn)
        else:
            rx, nxx = g.sub(x, cx), nx
        rz = g.sub(z, cz)
        r = g.vmath('LENGTH', g.combine(rx, 0.0, rz), out=1)
        facing = g.math('DIVIDE', g.add(g.mul(nxx, rx), g.mul(nz, rz)), g.maximum(r, 1e-4))
        inner = g.sub(1.0, g.smooth(facing, -0.35, -0.05))
        tint = g.ramp(g.noise(P, 2.0, 3.0), [(0.3, (0.16, 0.13, 0.1)), (0.55, (0.11, 0.11, 0.15)),
                                             (0.8, (0.2, 0.15, 0.1))])
        if exit_y is not None:
            heat = g.smooth(y, exit_y + 0.6, exit_y)
            tint = g.mix(g.mul(heat, 0.7), tint, (0.07, 0.06, 0.1))
        col = g.mix(inner, tint, SOOT)
        ch = S.weathered(g, col, g.mixf(inner, 0.36, 0.62), g.mixf(inner, 0.65, 0.2), P, N,
                         wear=0.0, lines=False, grime=0.6)
        if ridges:
            rib = g.mul(g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(y, ridges)), 0.5)), 0.38, 0.46),
                        g.sub(1.0, inner))
            ch['normal'] = g.bump(g.mul(rib, -0.002), 1.0, 1.0, normal=ch['normal'])
        return ch
    return S.material(name, build)


def glass_material(name, tint=(0.006, 0.008, 0.011), glow=(0.003, 0.009, 0.011)):
    return C.flat_material(name, tint, 0.04, 0.0, emission=glow, strength=1.0)


def flat_paint(name, colour, rough=0.45, metal=0.2, wear=0.6, lines=False):
    return S.material(name, lambda g, P, N: S.weathered(g, colour, rough, metal, P, N, lines=lines, wear=wear))


# ==========================================================================
# Bake, split, export, anchors

def bake_craft(name, model, tex):
    """Join, unwrap and bake a model; split off its tagged nodes. Returns
    (hull, node objects)."""
    parts, extras, empties = model['parts'], model['extras'], model['empties']
    hull = C.join(parts, 'hull')
    C.smart_uv(hull, angle=model.get('uv_angle', 60.0), margin=model.get('uv_margin', 0.003))
    C.triangulate(hull)
    hull.data.set_sharp_from_angle(angle=math.radians(42))
    size_base, size_mr = (256, 128) if FAST else tex
    base = C.new_image(name + '_base', size_base)
    nrm = C.new_image(name + '_normal', size_base, non_color=True)
    rough = C.new_image(name + '_rough', size_mr, non_color=True)
    metal = C.new_image(name + '_metal', size_mr, non_color=True)
    glow = C.new_image(name + '_emissive', size_mr)
    for o in extras:
        o.hide_render = True
    bevel = model.get('bevel', 0.02)
    high = C.duplicate(hull, 'hull_high')
    bev = high.modifiers.new('bevel', 'BEVEL')
    bev.width = bevel
    bev.segments = 3
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(40)
    C.apply_modifiers(high)
    high.data.shade_smooth()
    margin = max(2, size_base // 256)
    C.bake(hull, nrm, 'NORMAL', sources=[high], extrusion=bevel * 0.75, max_ray=bevel * 2.0, margin=margin,
           samples=1 if FAST else 4)
    bpy.data.objects.remove(high)
    s = 1 if FAST else 16
    C.bake(hull, base, channel='albedo', margin=margin, samples=s)
    small = max(1, margin * size_mr // size_base)
    C.bake(hull, rough, channel='rough', margin=small, samples=max(1, s // 2))
    C.bake(hull, metal, channel='metal', margin=small, samples=max(1, s // 2))
    C.bake(hull, glow, channel='glow', margin=small, samples=1 if FAST else 4)
    for o in extras:
        o.hide_render = False
    mr = C.pack_mr(name + '_mr', rough, metal)
    dump = os.environ.get('METEORA_DUMP')
    if dump:
        os.makedirs(dump, exist_ok=True)
        for img in (base, nrm, mr, glow):
            copy = img.copy()
            copy.filepath_raw = os.path.join(dump, img.name + '.png')
            copy.file_format = 'PNG'
            copy.save()
            bpy.data.images.remove(copy)
    mat = C.baked_material(name, base, nrm, mr, glow)
    hull.data.materials.clear()
    hull.data.materials.append(mat)
    hull.data.polygons.foreach_set('material_index', [0] * len(hull.data.polygons))
    nodes = {}
    for node, matrix, parent in model.get('nodes', []):
        p = nodes.get(parent)
        nodes[node] = split_node(hull, node, matrix, p, p.matrix_basis.copy() if p else None)
        nodes[node].data.set_sharp_from_angle(angle=math.radians(42))
    hull.vertex_groups.clear()
    for e in empties:
        e.parent = hull
    bpy.context.view_layer.update()
    return hull, list(nodes.values())


def gl_pos(v):
    return [round(c, 3) + 0.0 for c in C.to_gltf(v)]


def gl_dir(v):
    return [round(c, 4) + 0.0 for c in C.to_gltf(Vector(v).normalized())]


def craft_anchors(meshes, empties, model):
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    ys = [p.y for p in pts]
    by = lambda prefix: sorted((e for e in empties if e.name.startswith(prefix)), key=lambda e: e.name)
    one = lambda name: next((e for e in empties if e.name == name), None)
    pos = lambda e: gl_pos(e.matrix_world.translation)
    axis = lambda e, local: gl_dir(e.matrix_world.to_3x3() @ Vector(local))
    meta = model.get('meta', {})
    out = {'radius': round(max(p.length for p in pts), 2), 'length': round(max(ys) - min(ys), 2)}
    out['nozzles'] = [dict(name=e.name, pos=pos(e), dir=axis(e, (0, -1, 0)), size=meta['nozzles'][e.name])
                      for e in by('nozzle_')]
    out['muzzles'] = [dict(name=e.name, pos=pos(e)) for e in by('muzzle_')]
    out['rcs'] = [dict(name=e.name, pos=pos(e), dir=axis(e, (0, 0, 1))) for e in by('rcs_')]
    out['launchers'] = [dict(name=e.name, pos=pos(e)) for e in by('launcher_')]
    cam, dock = one('cam_cockpit'), one('dock')
    out['cockpit'] = pos(cam) if cam else None
    out['dock'] = pos(dock) if dock else None
    out['colliders'] = [dict(pos=pos(e), r=round(e.matrix_world.to_scale()[0], 3)) for e in by('col_')]
    out['subsystems'] = [dict(name=e.name, kind=e.name.split('_')[1], pos=pos(e),
                              r=round(e.matrix_world.to_scale()[0], 3)) for e in by('sub_')]
    turrets = [o for o in meshes if o.name in meta.get('turrets', {})]
    out['turrets'] = [dict(name=t.name, pos=pos(t), up=axis(t, (0, 0, 1)), fwd=axis(t, (0, 1, 0)),
                           size=meta['turrets'][t.name]) for t in sorted(turrets, key=lambda o: o.name)]
    out['bays'] = [dict(name=e.name, pos=pos(e), dir=axis(e, (0, -1, 0))) for e in by('bay_')]
    out['lights'] = [dict(name=e.name, pos=pos(e), color=list(meta['lights'][e.name][0]),
                          blink=meta['lights'][e.name][1]) for e in by('light_')]
    out['nodes'] = dict(meta.get('nodes', {}))
    return out


def mesh_points(objs):
    """World-space vertices and triangles of a list of mesh objects."""
    co, tris, base = [], [], 0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        mw = o.matrix_world
        co += [tuple(mw @ v.co) for v in me.vertices]
        tris += [tuple(i + base for i in t.vertices) for t in me.loop_triangles]
        base += len(me.vertices)
    return np.array(co, dtype=float).reshape(-1, 3), np.array(tris, dtype=int).reshape(-1, 3)


def enclosing_ball(pts, centre=None, iterations=200):
    """Approximate minimal enclosing ball (Badoiu-Clarkson)."""
    c = pts.mean(axis=0) if centre is None else centre.copy()
    for i in range(iterations):
        far = pts[np.argmax(((pts - c) ** 2).sum(axis=1))]
        c += (far - c) / (i + 2)
    return c, float(np.sqrt(((pts - c) ** 2).sum(axis=1).max()))


def fit_colliders(objs, k_half, tol=0.0, seed=1, samples=24000):
    """Collision spheres hugging a left-right symmetric model: surface
    samples (half by area, half evenly along the length, so thin spikes get
    their share), folded onto x >= 0 and clustered with k-means; each
    cluster gets its minimal enclosing ball, mirrored to the left, or one
    ball on the centre plane when it straddles it. Finally every vertex is
    brought to within `tol` of a sphere. Deterministic for a given seed."""
    rng = np.random.default_rng(seed)
    co, tris = mesh_points(objs)
    tris = np.sort(tris, axis=1)                      # order-independent sampling
    tris = tris[np.lexsort(tris.T[::-1])]
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    by_area = rng.choice(len(tris), samples // 2, p=area / area.sum())
    ty = (a[:, 1] + b[:, 1] + c[:, 1]) / 3
    lo, hi = ty.min(), ty.max()
    bins = np.clip(((ty - lo) / max(hi - lo, 1e-6) * 64).astype(int), 0, 63)
    w = area / np.maximum(np.bincount(bins, weights=area, minlength=64)[bins], 1e-9)
    by_length = rng.choice(len(tris), samples - samples // 2, p=w / w.sum())
    pick = np.concatenate([by_area, by_length])
    u, v = rng.random(samples), rng.random(samples)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pts = a[pick] + (b[pick] - a[pick]) * u[:, None] + (c[pick] - a[pick]) * v[:, None]
    pts[:, 0] = np.abs(pts[:, 0])
    # k-means++ seeding, then Lloyd iterations
    centres = [pts[rng.integers(len(pts))]]
    for _ in range(1, k_half):
        d2 = np.min([((pts - q) ** 2).sum(axis=1) for q in centres], axis=0)
        centres.append(pts[rng.choice(len(pts), p=d2 / d2.sum())])
    centres = np.array(centres)
    for _ in range(40):
        label = np.argmin(((pts[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2), axis=1)
        for j in range(k_half):
            if np.any(label == j):
                centres[j] = pts[label == j].mean(axis=0)
    spheres = []
    for j in range(k_half):
        cl = pts[label == j]
        if len(cl) == 0:
            continue
        cen, r = enclosing_ball(cl)
        if cen[0] < 0.5 * r:
            both = np.concatenate([cl, cl * (-1, 1, 1)])
            cen[0] = 0.0
            cen, r = enclosing_ball(both, cen)
            cen[0] = 0.0
            r = float(np.sqrt(((both - cen) ** 2).sum(axis=1).max()))
            spheres.append([cen, r])
        else:
            spheres += [[cen, r], [cen * (-1, 1, 1), r]]
    verts = mesh_points(objs)[0]
    for p in verts:
        gaps = [np.linalg.norm(p - cen) - r for cen, r in spheres]
        j = int(np.argmin(gaps))
        if gaps[j] > tol:
            cen, r = spheres[j]
            spheres[j][1] = float(np.linalg.norm(p - cen)) - tol + 1e-3
            m = cen * (-1, 1, 1)
            for other in spheres:            # keep mirror twins equal
                if other is not spheres[j] and np.allclose(other[0], m) and other[1] < spheres[j][1]:
                    other[1] = spheres[j][1]
    spheres.sort(key=lambda sr: (-sr[0][1], sr[0][0], sr[0][2]))
    return [(Vector(tuple(round(float(x), 3) for x in cen)), round(r + 0.0005, 3)) for cen, r in spheres]


def collider_report(meshes, empties):
    """How closely the col_* spheres wrap the meshes: the share of vertices
    inside a sphere, and the worst vertex's distance outside."""
    cols = [(e.matrix_world.translation.copy(), e.matrix_world.to_scale()[0]) for e in empties
            if e.name.startswith('col_')]
    if not cols:
        return 'no colliders'
    centres = np.array([c for c, _ in cols])
    radii = np.array([r for _, r in cols])
    pts = np.array([tuple(o.matrix_world @ v.co) for o in meshes for v in o.data.vertices])
    gap = (np.linalg.norm(pts[:, None, :] - centres[None, :, :], axis=2) - radii[None, :]).min(axis=1)
    return f'{len(cols)} colliders cover {100 * (gap <= 0).mean():.1f} % of vertices, worst {gap.max():.2f} m outside'


def fmt(v):
    return '[' + ', '.join(f'{x:g}' for x in v) + ']'


def write_module(name, a):
    lines = [
        f'/* Meteora — {name} anchors. GENERATED by tools/blender/build_craft.py from',
        f'   the empties in {name}.glb; do not edit by hand. glTF space, metres: nose',
        '   along -Z, top +Y, right +X. */',
        'export default {',
        f"  radius: {a['radius']:g},",
        f"  length: {a['length']:g},",
    ]

    def rows(key, items):
        if not items:
            lines.append(f'  {key}: [],')
            return
        lines.append(f'  {key}: [')
        lines.extend(f'    {{ {it} }},' for it in items)
        lines.append('  ],')

    rows('nozzles', [f"name: '{n['name']}', pos: {fmt(n['pos'])}, dir: {fmt(n['dir'])}, size: {n['size']:g}"
                     for n in a['nozzles']])
    rows('muzzles', [f"name: '{n['name']}', pos: {fmt(n['pos'])}" for n in a['muzzles']])
    rows('rcs', [f"name: '{n['name']}', pos: {fmt(n['pos'])}, dir: {fmt(n['dir'])}" for n in a['rcs']])
    rows('launchers', [f"name: '{n['name']}', pos: {fmt(n['pos'])}" for n in a['launchers']])
    lines.append(f"  cockpit: {fmt(a['cockpit']) if a['cockpit'] else 'null'},")
    lines.append(f"  dock: {fmt(a['dock']) if a['dock'] else 'null'},")
    rows('colliders', [f"pos: {fmt(n['pos'])}, r: {n['r']:g}" for n in a['colliders']])
    rows('subsystems', [f"name: '{n['name']}', kind: '{n['kind']}', pos: {fmt(n['pos'])}, r: {n['r']:g}"
                        for n in a['subsystems']])
    rows('turrets', [f"name: '{n['name']}', pos: {fmt(n['pos'])}, up: {fmt(n['up'])}, fwd: {fmt(n['fwd'])}, "
                     f"size: {n['size']:g}" for n in a['turrets']])
    rows('bays', [f"name: '{n['name']}', pos: {fmt(n['pos'])}, dir: {fmt(n['dir'])}" for n in a['bays']])
    rows('lights', [f"name: '{n['name']}', pos: {fmt(n['pos'])}, color: {fmt(n['color'])}, blink: {n['blink']:g}"
                    for n in a['lights']])
    nodes = ', '.join(f"{k}: '{v}'" for k, v in a['nodes'].items())
    lines.append(f'  nodes: {{ {nodes} }},' if nodes else '  nodes: {},')
    lines.append('};')
    os.makedirs(ANCHORS_DIR, exist_ok=True)
    path = os.path.join(ANCHORS_DIR, name + '.js')
    with open(path, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    C.log('wrote', os.path.relpath(path, C.ROOT))


# ==========================================================================
# Swift — Belt Watch interceptor (about 10 m long, 6.9 m span)

SWIFT_BODY = [
    # y, half-width, top, bottom, top exponent, bottom exponent, centre z, chine
    (5.06, 0.014, 0.012, 0.012, 2.0, 2.0, -0.06, 0.0),
    (4.72, 0.095, 0.072, 0.062, 2.0, 2.2, -0.06, 0.30),
    (4.15, 0.215, 0.165, 0.14, 2.1, 2.5, -0.05, 0.27),
    (3.35, 0.335, 0.265, 0.215, 2.2, 2.8, -0.035, 0.22),
    (2.45, 0.435, 0.355, 0.285, 2.3, 3.1, -0.02, 0.18),
    (1.45, 0.515, 0.425, 0.335, 2.45, 3.3, -0.01, 0.15),
    (0.35, 0.565, 0.5, 0.37, 2.8, 3.5, 0.0, 0.12),
    (-0.85, 0.6, 0.6, 0.41, 3.3, 3.5, 0.0, 0.08),
    (-2.0, 0.66, 0.655, 0.48, 3.0, 3.2, 0.01, 0.03),
    (-3.0, 0.72, 0.68, 0.6, 2.5, 2.6, 0.02, 0.0),
    (-3.7, 0.74, 0.7, 0.68, 2.1, 2.2, 0.02, 0.0),
    (-4.12, 0.725, 0.705, 0.695, 2.0, 2.0, 0.02, 0.0),
]
SW_ENG = (0.0, 0.02)                 # engine axis x, z
SW_EXIT_Y = -4.86
SW_CANOPY = ((0.0, 1.12, 0.28), (0.33, 1.1, 0.5))   # bubble centre, radii
SW_GUN = (0.72, 0.0)                  # wing-root gun axis x, z
SW_MUZZLE_Y = 0.32
SW_TIP_X = 3.42
SW_WING_Z = -0.04
SW_ANHEDRAL = math.tan(rad(3.0))
SW_TIP_Z = SW_WING_Z - SW_ANHEDRAL * (SW_TIP_X - 0.95)
SW_FIN_Y = (-3.05, -4.12)             # dorsal fin root leading and trailing edge
SW_FIN_Z = 0.6
SW_DOCK_Y = -1.15                     # dock plate centre on the turtle deck

SW_RCS = [
    # name, ray origin, ray direction, puff direction (Blender space)
    ('rcs_01', (0, 3.55, 3), (0, 0, -1), (0, 0, 1)),            # nose up
    ('rcs_02', (0, 3.55, -3), (0, 0, 1), (0, 0, -1)),           # nose down
    ('rcs_03', (3, 3.3, 0.03), (-1, 0, 0), (1, 0, 0)),          # nose right
    ('rcs_04', (-3, 3.3, 0.03), (1, 0, 0), (-1, 0, 0)),         # nose left
    ('rcs_05', (0, -2.72, 3), (0, 0, -1), (0, 0, 1)),           # tail up, on the deck ahead of the fin
    ('rcs_06', (0, -3.98, -3), (0, 0, 1), (0, 0, -1)),          # tail down, between the strakes
    ('rcs_07', (3, -3.98, 0.2), (-1, 0, 0), (1, 0, 0)),         # tail right, on the engine housing
    ('rcs_08', (-3, -3.98, 0.2), (1, 0, 0), (-1, 0, 0)),        # tail left
    ('rcs_09', (SW_TIP_X, -4.02, 3), (0, 0, -1), (0, 0, 1)),    # right wingtip up
    ('rcs_10', (SW_TIP_X, -4.02, -3), (0, 0, 1), (0, 0, -1)),   # right wingtip down
    ('rcs_11', (-SW_TIP_X, -4.02, 3), (0, 0, -1), (0, 0, 1)),   # left wingtip up
    ('rcs_12', (-SW_TIP_X, -4.02, -3), (0, 0, 1), (0, 0, -1)),  # left wingtip down
    ('rcs_13', (0.15, 3.95, 3), (0, 0, -1), (0.3, 1, 0.1)),     # nose, forward-facing right (reverse)
    ('rcs_14', (-0.15, 3.95, 3), (0, 0, -1), (-0.3, 1, 0.1)),   # nose, forward-facing left
    ('rcs_15', (SW_TIP_X + 0.01, -9, SW_TIP_Z + 0.01), (0, 1, 0), (0, -1, 0)),   # right wingtip fairing, aft
    ('rcs_16', (-SW_TIP_X - 0.01, -9, SW_TIP_Z + 0.01), (0, 1, 0), (0, -1, 0)),  # left wingtip fairing, aft
]


def swift_materials():
    dock_y = SW_DOCK_Y

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        top = g.smooth(nz, 0.45, 0.62)
        under = g.smooth(nz, -0.28, -0.5)
        side = g.smooth(g.absolute(nx), 0.5, 0.66)
        radome = g.smooth(y, 4.43, 4.47)
        glare = g.mul(g.mul(S.band(g, y, 2.1, 4.08, 0.012), top), g.sub(1.0, g.smooth(ax, 0.15, 0.165)))
        belly = g.mul(g.mul(under, g.sub(1.0, g.smooth(ax, 0.2, 0.215))), S.band(g, y, -3.3, 3.9, 0.012))
        shroud = g.smooth(y, -3.6, -3.64)                     # graphite engine shroud
        dark = union(g, [radome, glare, belly, shroud])
        col = g.mix(dark, OFF_WHITE, GRAPHITE)
        nose_ring = g.mul(S.band(g, y, 4.17, 4.33, 0.005), g.sub(1.0, radome))
        col = g.mix(nose_ring, col, ORANGE)
        # an orange speed stripe and a graphite pinline above the chine
        zch = g.madd(y, -0.0125, 0.0)
        dz = g.sub(z, zch)
        stripe = g.mul(g.mul(S.band(g, dz, 0.035, 0.085, 0.005), S.band(g, y, -0.2, 3.95, 0.008)), side)
        pin = g.mul(g.mul(S.band(g, dz, 0.107, 0.12, 0.003), S.band(g, y, 0.2, 3.6, 0.008)), side)
        col = g.mix(stripe, col, ORANGE)
        col = g.mix(pin, col, GRAPHITE)
        # side number on the nose, stencils under the canopy sill
        flank = g.smooth(g.absolute(nx), 0.3, 0.45)
        u, v = side_uv(g, x, y, z, nx, 2.95)
        col = g.mix(g.mul(digits(g, u, v, '21', 0.15, 0.0, 0.165, soft=0.003), flank), col, GRAPHITE)
        # the deck behind the canopy: a graphite walkway, a hazard ring round the dock
        d = g.vmath('LENGTH', g.combine(x, g.sub(y, dock_y), 0.0), out=1)
        ang = polar_angle(g, x, y, 0.0, dock_y)
        walk = g.mul(g.mul(g.sub(1.0, g.smooth(ax, 0.1, 0.112)), top), S.band(g, y, -2.9, -0.15, 0.01))
        col = g.mix(walk, col, GRAPHITE)
        ring = g.mul(S.band(g, d, 0.235, 0.29, 0.004), top)
        stripes = g.math('LESS_THAN', g.math('FRACT', g.mul(ang, 12 / (2 * math.pi))), 0.5)
        col = g.mix(ring, col, g.mix(stripes, INK, HAZARD))
        ticks = g.mul(g.mul(S.band(g, ax, 0.0, 0.02, 0.002), S.band(g, d, 0.33, 0.52, 0.004)), top)
        col = g.mix(ticks, col, HAZARD)
        dsten = g.mul(stencil(g, y, x, -2.55, 0.16, 0.5, 0.04, 11.0), top)
        col = g.mix(g.mul(dsten, 0.8), col, GRAPHITE)
        dark = union(g, [dark, walk, ring])
        u2, _ = side_uv(g, x, y, z, nx, 0.6)
        sten = g.mul(union(g, [stencil(g, u2, z, -0.5, 0.2, 0.7, 0.032, 3.0),
                               stencil(g, u2, z, -0.5, 0.155, 0.45, 0.032, 5.0)]), side)
        col = g.mix(g.mul(sten, 0.85), col, GRAPHITE)
        # an orange warning chevron at the engine cowl seam, and heat toward the nozzle
        cowl = g.mul(S.band(g, y, -2.98, -2.9, 0.004), g.sub(1.0, under))
        col = g.mix(cowl, col, ORANGE)
        heat = g.smooth(y, -3.95, -4.12)
        col = g.mix(heat, col, (0.055, 0.05, 0.058))
        dark_r = g.maximum(dark, heat)
        return S.weathered(g, col, g.mixf(dark_r, 0.4, 0.5), g.mixf(dark_r, 0.18, 0.4), P, N,
                           panel=(1.15, 0.5), panel_scale=1.1)

    def wing_paint(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.15, -0.4)
        # leading-edge strip along the cranked edge (outboard of the LERX)
        le_y = g.maximum(g.sub(-1.2, g.mul(g.sub(ax, 0.95), 2.2)), g.sub(-2.3, g.mul(g.sub(ax, 1.45), 0.68)))
        leading = g.mul(g.smooth(g.sub(y, le_y), -0.17, -0.14), g.smooth(ax, 0.9, 0.95))
        tip = g.smooth(ax, 2.78, 2.81)
        col = g.mix(leading, OFF_WHITE, GRAPHITE)
        col = g.mix(g.mul(tip, g.sub(1.0, leading)), col, ORANGE)
        col = g.mix(g.mul(S.band(g, ax, 2.66, 2.71, 0.004), g.sub(1.0, leading)), col, GRAPHITE)
        # Belt Watch roundel on top: graphite ring, orange ring, graphite dot
        rd = g.vmath('LENGTH', g.combine(g.sub(ax, 2.0), g.sub(y, -3.55), 0.0), out=1)
        topside = g.sub(1.0, under)
        col = g.mix(g.mul(S.band(g, rd, 0.0, 0.3, 0.004), topside), col, GRAPHITE)
        col = g.mix(g.mul(S.band(g, rd, 0.07, 0.24, 0.004), topside), col, ORANGE)
        col = g.mix(g.mul(S.band(g, rd, 0.11, 0.2, 0.004), topside), col, OFF_WHITE)
        sten = g.mul(stencil(g, ax, y, 1.0, -2.95, 0.5, 0.045, 7.0), g.sub(1.0, under))
        col = g.mix(g.mul(sten, 0.8), col, GRAPHITE)
        # flap and aileron lines along the trailing edge
        flap = g.mul(S.band(g, y, -4.06, -4.04, 0.003), S.band(g, ax, 0.95, 3.2, 0.004))
        hinge = g.mul(flap, -0.0012)
        col = g.mix(g.mul(under, 0.3), col, LIGHT_GREY)
        ch = S.weathered(g, col, g.mixf(leading, 0.42, 0.5), g.mixf(leading, 0.18, 0.35), P, N,
                         panel=(0.9, 0.45), panel_scale=1.2)
        ch['normal'] = g.bump(hinge, 1.0, 1.0, normal=ch['normal'])
        return ch

    def fin_paint(g, P, N):
        x, y, z = g.sep(P)
        nx = g.sep(N)[0]
        col = g.mix(g.smooth(z, 1.23, 1.25), OFF_WHITE, ORANGE)
        col = g.mix(g.smooth(z, 1.43, 1.45), col, GRAPHITE)
        u, v = side_uv(g, x, y, z, nx, -3.82)
        col = g.mix(digits(g, u, v, '21', 0.24, 0.02, 0.94, soft=0.003), col, GRAPHITE)
        col = g.mix(rect(g, u, z, -0.3, 0.32, 1.14, 1.165, 0.003), col, ORANGE)
        return S.weathered(g, col, 0.42, 0.2, P, N, panel=(0.8, 0.4), panel_scale=1.3)

    def metal(g, P, N):
        return S.weathered(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, lines=False, wear=0.6)

    def canard(g, P, N):
        x, y, z = g.sep(P)
        le = g.smooth(g.add(y, g.mul(g.absolute(x), 1.0)), 0.5, 0.44)
        col = g.mix(le, OFF_WHITE, GRAPHITE)
        col = g.mix(g.smooth(g.absolute(x), 1.22, 1.25), col, ORANGE)
        return S.weathered(g, col, 0.42, 0.2, P, N, panel=(0.6, 0.3), panel_scale=1.5)

    def missile(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(S.band(g, y, 0.08, 0.2, 0.005), (0.5, 0.5, 0.47), ORANGE)
        col = g.mix(g.smooth(y, 0.42, 0.46), col, GRAPHITE)
        col = g.mix(S.band(g, y, -0.35, -0.31, 0.003), col, HAZARD)
        return S.weathered(g, col, 0.45, 0.2, P, N, lines=False, wear=0.4)

    def tip(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(y, -3.42, -3.46), GRAPHITE, OFF_WHITE)
        return S.weathered(g, col, 0.45, 0.25, P, N, lines=False, wear=0.9)

    return dict(
        body=S.material('sw_body', body), wing=S.material('sw_wing', wing_paint),
        fin=S.material('sw_fin', fin_paint),
        canard=S.material('sw_canard', canard), metal=S.material('sw_metal', metal),
        frame=flat_paint('sw_frame', GRAPHITE, 0.5, 0.3, wear=0.8), tip=S.material('sw_tip', tip),
        missile=S.material('sw_missile', missile),
        nozzle=nozzle_paint('sw_nozzle', SW_ENG[0], SW_ENG[1], mirror=False, exit_y=SW_EXIT_Y, ridges=9.0),
        glow=S.glow_material('sw_glow', (0.55, 0.68, 1.0), (0.3, 0.35, 0.45)),
        red=S.glow_material('sw_nav_red', (1.0, 0.05, 0.03), (0.3, 0.02, 0.02)),
        green=S.glow_material('sw_nav_green', (0.05, 1.0, 0.25), (0.02, 0.3, 0.06)),
        white=S.glow_material('sw_nav_white', (1.0, 0.95, 0.85), (0.4, 0.4, 0.4)),
        sensor=S.material('sw_sensor', lambda g, P, N: dict(albedo=(0.01, 0.012, 0.016), rough=0.08, metal=0.0)),
        hole=S.material('sw_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def build_swift():
    M = swift_materials()
    parts = []
    body = S.loft('body', SWIFT_BODY, M['body'], around=36, along=40, front_tip=(0, 5.075, -0.06),
                  back_tip=(0, -4.12, SW_ENG[1]))
    parts.append(body)

    # Bubble canopy (the separate `glass` node), cut at its equator inside
    # the fuselage; a windscreen bow, a rear hoop and two sills.
    centre, radii = SW_CANOPY
    glass = bubble('glass', centre, radii, glass_material('sw_glass', (0.014, 0.01, 0.005), (0.007, 0.0045, 0.0012)),
                   front_taper=0.42, top_taper=0.2, cut=centre[2] + 0.01, u=24, v=14)
    out = lambda p: Vector((p.x, 0, p.z - centre[2]))
    for i, yy in enumerate((centre[1] + 0.86, centre[1] - 0.9)):
        path = [bubble_point(centre, radii, yy, rad(a), 1.03, 0.42, 0.2) for a in range(6, 175, 12)]
        parts.append(S.bar(f'hoop{i}', path, 0.07, 0.045, M['frame'], out))
    for sgn in (1, -1):
        sill = [bubble_point(centre, radii, yy, rad(90 - sgn * 82), 1.035, 0.42, 0.2)
                for yy in np.linspace(centre[1] + 1.02, centre[1] - 1.02, 13)]
        parts.append(S.bar(f'sill{sgn}', sill, 0.065, 0.04, M['frame'], out))

    # Dock on the turtle deck behind the canopy; the fin stands aft of it on
    # the engine housing, so a docked Tender clears both.
    dy = SW_DOCK_Y
    deck = S.bvh_of([body])
    dloc, _ = S.frame_on(deck, (0, dy, 3), (0, 0, -1))
    dz0 = dloc.z + 0.035
    plate = S.lathe('dock_plate', [(0.0, 0.0), (0.0, 0.22), (0.035, 0.22), (0.05, 0.195), (0.05, 0.13),
                                   (0.035, 0.115), (0.035, 0.0)], 16, (0, 0), M['metal'], sharp=30)
    parts.append(S.transformed(plate, T((0, dy, dz0 - 0.05)) @ R(rad(90), 4, 'X')))
    for k in range(4):
        a = rad(45 + 90 * k)
        parts.append(S.box(f'dock_pin{k}', (0.04, 0.04, 0.07), M['frame'],
                           T((0.17 * math.cos(a), dy + 0.17 * math.sin(a), dz0 + 0.02))))

    # Engine: a big bell inside a ring of petals, a glowing throat round a
    # dark centre cone, a cooling ring at the end of the housing.
    ex = SW_EXIT_Y
    bell = [(-4.0, 0.62), (-4.45, 0.59), (ex + 0.06, 0.6), (ex, 0.6), (ex - 0.01, 0.553),
            (ex + 0.3, 0.48), (-4.31, 0.36), (-4.22, 0.36), (-4.13, 0.45), (-4.04, 0.57)]
    parts.append(S.lathe('bell', bell, 32, SW_ENG, M['nozzle'], closed=True, sharp=35))
    parts.append(S.lathe('throat', [(-4.26, 0.0), (-4.26, 0.37), (-4.22, 0.37), (-4.22, 0.0)], 32, SW_ENG,
                         M['glow'], smooth=False))
    parts.append(S.lathe('cone', [(-4.25, 0.16), (-4.4, 0.12), (-4.52, 0.0)], 12, SW_ENG, M['hole']))
    parts.append(petals('petals', 16, -4.06, ex + 0.05, 0.705, 0.625, SW_ENG, M['nozzle'], thick=0.02))
    parts.append(ring_bar('shroud_ring', SW_ENG, 0.71, -4.0, 0.1, 0.03, M['metal'], sides=24))

    # Dorsal fin and two ventral strakes.
    fy0, fy1 = SW_FIN_Y
    fin = S.wing('fin', [(0.0, fy0, 0.0, fy0 - fy1, 0.075), (0.48, fy0 - 0.42, 0.0, 0.84, 0.065),
                         (0.9, fy0 - 0.86, 0.0, 0.5, 0.06)], M['fin'], chord_pts=9)
    parts.append(S.transformed(fin, T((0, 0, SW_FIN_Z)) @ R(rad(-90), 4, 'Y')))

    side = []
    # Cranked-delta wing, mid-set, with a leading-edge root extension
    # running forward along the chine; 3 degrees of anhedral outboard.
    wz = lambda x: SW_WING_Z - SW_ANHEDRAL * max(0.0, x - 0.95)
    secs = [(x, yle, wz(x), ch, th) for x, yle, ch, th in
            ((0.4, 0.75, 5.15, 0.022), (0.7, -0.25, 4.17, 0.03), (0.95, -1.2, 3.25, 0.036),
             (1.45, -2.3, 2.2, 0.042), (2.45, -3.0, 1.5, 0.042), (SW_TIP_X - 0.03, -3.62, 0.86, 0.04))]
    side.append(S.wing('wing', secs, M['wing'], chord_pts=12))
    # wingtip fairing with a navigation light at its nose
    side.append(S.lathe('tip_fairing', [(-4.6, 0.0), (-4.6, 0.062), (-4.55, 0.072), (-3.7, 0.072), (-3.5, 0.058),
                                        (-3.38, 0.03), (-3.33, 0.0)], 10, (SW_TIP_X, SW_TIP_Z), M['tip'], sharp=40))
    side.append(S.lathe('navlight', [(-3.38, 0.0), (-3.35, 0.034), (-3.27, 0.03), (-3.24, 0.0)], 8,
                        (SW_TIP_X, SW_TIP_Z), M['green']))
    # canards behind the canopy, on the upper shoulders
    can = S.wing('canard', [(0.0, 0.2, 0.0, 1.0, 0.07), (0.5, -0.32, 0.0, 0.56, 0.06), (0.95, -0.72, 0.0, 0.2, 0.05)],
                 M['canard'], chord_pts=7, sharp=40)
    side.append(S.transformed(can, T((0.42, 0, 0.22)) @ R(rad(-5), 4, 'Y')))
    # wing-root gun: a blister over the root and a long barrel out ahead of it
    gx, gz = SW_GUN
    side.append(S.lathe('gun_blister', [(-0.55, 0.0), (-0.6, 0.06), (-0.78, 0.115), (-2.1, 0.12), (-2.5, 0.07),
                                         (-2.65, 0.0)], 12, (gx, gz), M['body'], sharp=40))
    side.append(S.lathe('barrel', [(-0.75, 0.0), (-0.75, 0.048), (SW_MUZZLE_Y - 0.24, 0.048),
                                    (SW_MUZZLE_Y - 0.22, 0.066), (SW_MUZZLE_Y - 0.02, 0.066),
                                    (SW_MUZZLE_Y, 0.044), (SW_MUZZLE_Y, 0.0)], 10, (gx, gz), M['metal'], sharp=40))
    side.append(S.lathe('bore', [(SW_MUZZLE_Y - 0.06, 0.0), (SW_MUZZLE_Y - 0.06, 0.033), (SW_MUZZLE_Y + 0.004, 0.033),
                                 (SW_MUZZLE_Y + 0.004, 0.0)], 8, (gx, gz), M['hole'], smooth=False))
    # ventral strake, canted out 35 degrees
    strake = S.wing('strake', [(0.0, -2.95, 0.0, 1.2, 0.06), (0.44, -3.5, 0.0, 0.62, 0.05)], M['canard'],
                    chord_pts=7, sharp=40)
    side.append(S.transformed(strake, T((0.3, 0, -0.5)) @ R(rad(55), 4, 'Y')))
    parts += S.mirrored(side)
    for o in parts:
        if o.name == 'navlight_m':          # red to port, green to starboard
            o.data.materials[0] = M['red']

    # Ventral missile rail with one missile.
    my, mz = -0.45, -0.64
    parts.append(S.prism('rail', [(-0.115, 0.75), (0.115, 0.75), (0.115, -1.55), (-0.115, -1.3)], 0.12, M['metal'],
                         T((0, my, -0.435)) @ R(rad(90), 4, 'Y')))
    mp = [(-1.02, 0.0), (-1.02, 0.07), (-0.98, 0.095), (0.72, 0.095), (0.92, 0.07), (1.06, 0.03), (1.12, 0.0)]
    parts.append(S.lathe('missile', [(my + a, r) for a, r in mp], 12, (0, mz), M['missile']))
    for k in range(4):
        m = T((0, my - 0.86, mz)) @ R(rad(45 + 90 * k), 4, 'Y') @ T((0, 0, 0.15))
        parts.append(S.box(f'mfin{k}', (0.012, 0.26, 0.12), M['metal'], m, taper=0.6))

    # Greebles raycast onto the fuselage.
    bvh = S.bvh_of([body])
    _, m = S.frame_on(bvh, (0.17, 2.55, 3), (0, 0, -1))
    irst = S.lathe('irst', [(-0.03, 0.0), (-0.03, 0.08), (0.05, 0.075), (0.085, 0.045), (0.1, 0.0)], 10, (0, 0),
                   M['sensor'])
    parts.append(S.transformed(irst, m @ R(rad(90), 4, 'X')))
    _, m = S.frame_on(bvh, (0, -2.45, -3), (0, 0, 1))
    whip = S.lathe('whip', [(-0.03, 0.0), (-0.03, 0.02), (0.55, 0.008), (0.57, 0.0)], 5, (0, 0), M['metal'])
    parts.append(S.transformed(whip, m @ R(rad(62), 4, 'X') @ R(rad(180), 4, 'Z')))
    greebles = []
    for i, yy in enumerate((-2.75, -3.25)):
        _, m = S.frame_on(bvh, (3, yy, 0.32), (-1, 0, -0.15))
        greebles += S.vent(f'vent{i}', (0.32, 0.4, 0.035), M['metal'], m, slats=4)
    for i, (yy, zz, size) in enumerate(((3.0, 1.0, (0.16, 0.42, 0.02)), (1.85, -1.0, (0.22, 0.55, 0.02)))):
        _, m = S.frame_on(bvh, (2.0, yy, zz), (-2.0, 0, -zz * 0.9))
        greebles.append(S.box(f'hatch{i}', size, M['body'], m, taper=0.9))
    _, m = S.frame_on(bvh, (0.3, -0.6, -3), (0, 0, 1))
    greebles.append(S.prism('blade', [(0, 0.1), (0.0, -0.1), (0.22, -0.2), (0.24, -0.1)], 0.018, M['metal'],
                            m @ R(rad(-90), 4, 'Y')))
    parts += S.mirrored(greebles)
    # tail strobe on the fin tip
    parts.append(S.lathe('strobe', [(-4.06, 0.0), (-4.03, 0.025), (-3.93, 0.025), (-3.9, 0.0)], 8,
                         (0, SW_FIN_Z + 0.9), M['white']))

    rcs_bvh = S.bvh_of([o for o in parts if o.name.startswith(('body', 'tip_fairing'))])
    rcs_parts, empties = place_rcs(SW_RCS, rcs_bvh, M['metal'], M['hole'], size=0.15)
    parts += rcs_parts
    empties += [
        S.empty('nozzle_C', (SW_ENG[0], SW_EXIT_Y, SW_ENG[1])),
        S.empty('muzzle_R', (gx, SW_MUZZLE_Y + 0.005, gz)), S.empty('muzzle_L', (-gx, SW_MUZZLE_Y + 0.005, gz)),
        S.empty('launcher_0', (0, my, mz)),
        S.empty('cam_cockpit', (0, centre[1] + 0.2, 0.62)),
        S.empty('dock', (0, dy, dz0 + 0.005)),
        S.empty('light_0', (-SW_TIP_X, -3.26, SW_TIP_Z)), S.empty('light_1', (SW_TIP_X, -3.26, SW_TIP_Z)),
        S.empty('light_2', (0, -3.98, SW_FIN_Z + 0.93)),
    ]
    solid = [o for o in parts + [glass] if not o.name.startswith(('whip',))]
    cols = fit_colliders(solid, 20, tol=0.08)
    empties += [sphere_empty(f'col_{i + 1:02d}', p, r) for i, (p, r) in enumerate(cols)]
    meta = dict(nozzles={'nozzle_C': 0.55},
                lights={'light_0': ((1.0, 0.08, 0.05), 0), 'light_1': ((0.1, 1.0, 0.3), 0),
                        'light_2': ((1.0, 0.95, 0.85), 1.2)})
    return dict(parts=parts, extras=[glass], empties=empties, meta=meta, bevel=0.016)


# ==========================================================================
# Torpedo shape, shared by torpedo.glb and the Anvil's bay

TORPEDO_BODY = [(2.25, 0.0), (2.235, 0.04), (2.19, 0.085), (2.1, 0.13), (1.95, 0.175), (1.72, 0.215),
                (1.42, 0.245), (1.1, 0.25), (-1.62, 0.25), (-1.82, 0.238), (-1.98, 0.205), (-2.02, 0.0)]
TORPEDO_BELL = [(-1.94, 0.172), (-2.1, 0.18), (-2.24, 0.205), (-2.25, 0.205), (-2.255, 0.192), (-2.16, 0.16),
                (-2.06, 0.118), (-1.99, 0.12)]
TORPEDO_FIN = [(0.0, -1.18, 0.0, 0.8, 0.05), (0.2, -1.5, 0.0, 0.52, 0.05), (0.31, -1.72, 0.0, 0.3, 0.05)]


def torpedo_parts(prefix, M, matrix=Matrix(), sides=20, fins=True):
    """The Lance torpedo along +Y, 4.5 m from seeker to motor exit, centred
    on the origin of `matrix`: an ogive seeker nose, a long body, a
    boat-tail, a motor bell and four cruciform fins."""
    parts = [S.lathe(prefix + 'body', TORPEDO_BODY, sides, (0, 0), M['torpedo'], sharp=50),
             S.lathe(prefix + 'bell', TORPEDO_BELL, sides, (0, 0), M['nozzle'], closed=True, sharp=35),
             S.lathe(prefix + 'seeker', [(2.12, 0.0), (2.12, 0.128), (2.2, 0.075), (2.252, 0.0)], max(8, sides // 2),
                     (0, 0), M['sensor'], smooth=True)]
    if fins:
        for k in range(4):
            fin = S.wing(f'{prefix}fin{k}', TORPEDO_FIN, M['torpedo'], chord_pts=5, diamond=True, sharp=30)
            S.transformed(fin, R(rad(45 + 90 * k), 4, 'Y') @ T((0.2, 0, 0)))
            parts.append(fin)
    for o in parts:
        S.transformed(o, matrix)
    return parts


def torpedo_paint(g, P, N, y, scale=1.0):
    """Off-white with a graphite seeker cap, an orange band, a yellow
    warhead ring and stencils; `y` is the coordinate along the torpedo."""
    col = g.mix(g.smooth(y, 1.38, 1.4), OFF_WHITE, GRAPHITE)
    col = g.mix(S.band(g, y, 0.55, 1.0, 0.004), col, ORANGE)
    col = g.mix(S.band(g, y, 1.12, 1.2, 0.003), col, HAZARD)
    col = g.mix(S.band(g, y, -1.66, -1.6, 0.003), col, GRAPHITE)
    return col


# ==========================================================================
# Anvil — Belt Watch bomber (about 19 m long, 13 m span)

ANVIL_BODY = [
    # y, half-width, top, bottom, top exponent, bottom exponent, centre z, chine;
    # a thick slab-sided lifting body with a blunt shovel prow
    (9.45, 0.7, 0.14, 0.2, 2.6, 2.6, -0.3, 0.0),
    (9.25, 1.2, 0.36, 0.44, 3.2, 3.4, -0.29, 0.06),
    (8.6, 1.65, 0.62, 0.68, 3.6, 4.0, -0.25, 0.08),
    (7.3, 2.05, 0.95, 0.92, 4.0, 4.6, -0.18, 0.08),
    (5.4, 2.4, 1.2, 1.12, 4.2, 5.0, -0.1, 0.07),
    (3.0, 2.65, 1.38, 1.25, 4.4, 5.2, -0.03, 0.06),
    (0.5, 2.8, 1.48, 1.3, 4.4, 5.2, 0.0, 0.05),
    (-2.5, 2.85, 1.52, 1.3, 4.4, 5.2, 0.03, 0.04),
    (-5.0, 2.75, 1.52, 1.25, 4.2, 5.0, 0.06, 0.03),
    (-7.0, 2.45, 1.44, 1.15, 3.8, 4.4, 0.1, 0.02),
    (-8.5, 2.1, 1.3, 1.05, 3.4, 3.8, 0.12, 0.0),
]
AV_CABIN = [
    # the raised cockpit cabin on the forward deck (same section rows)
    (7.6, 0.55, 0.15, 0.3, 2.6, 2.0, 0.73, 0.0),
    (6.6, 0.88, 0.4, 0.35, 3.0, 2.0, 0.88, 0.0),
    (5.3, 0.95, 0.52, 0.35, 3.2, 2.0, 1.0, 0.0),
    (4.0, 0.95, 0.64, 0.35, 3.2, 2.0, 1.11, 0.0),
    (2.8, 0.8, 0.5, 0.35, 3.0, 2.0, 1.19, 0.0),
]
AV_ENG = (1.75, 0.45)                  # engine axis |x|, z
AV_NAC_R = 1.15                        # nacelle radius
AV_EXIT_Y = -9.46
AV_GUN_X = 0.8                         # chin gun axis |x| (z from the belly)
AV_MUZZLE_Y = 10.05
AV_TIP = (6.2, -0.31)                  # wingtip pod axis x, z
AV_BAY = (1.0, 2.5, -3.3, -0.36)       # torpedo bay half-width, front y, rear y, ceiling z
AV_TORP = (0.5, -0.4, -0.7)            # torpedo |x|, centre y, z
AV_TURRET = (-6.3, 1.74)               # turret yaw pivot y, z
AV_TRUNNION = 0.5                      # trunnion height above the pivot
AV_DOCK_Y = 0.4
AV_CANOPY = [((0.0, 6.2, 1.25), (0.6, 1.2, 0.48)), ((0.0, 4.35, 1.57), (0.62, 1.15, 0.5))]

AV_RCS = [
    ('rcs_01', (0, 8.05, 5), (0, 0, -1), (0, 0, 1)),              # nose up, ahead of the cabin
    ('rcs_02', (0, 7.2, -5), (0, 0, 1), (0, 0, -1)),              # nose down
    ('rcs_03', (5, 7.3, -0.12), (-1, 0, 0), (1, 0, 0)),           # nose right
    ('rcs_04', (-5, 7.3, -0.12), (1, 0, 0), (-1, 0, 0)),          # nose left
    ('rcs_05', (0, -8.05, 5), (0, 0, -1), (0, 0, 1)),             # tail up, behind the turret
    ('rcs_06', (0, -7.6, -5), (0, 0, 1), (0, 0, -1)),             # tail down
    ('rcs_07', (6, -7.7, 0.25), (-1, 0, 0), (1, 0, 0)),           # tail right, on the nacelle
    ('rcs_08', (-6, -7.7, 0.25), (1, 0, 0), (-1, 0, 0)),          # tail left
    ('rcs_09', (AV_TIP[0], -2.2, 5), (0, 0, -1), (0, 0, 1)),      # right wingtip up
    ('rcs_10', (AV_TIP[0], -2.2, -5), (0, 0, 1), (0, 0, -1)),     # right wingtip down
    ('rcs_11', (-AV_TIP[0], -2.2, 5), (0, 0, -1), (0, 0, 1)),     # left wingtip up
    ('rcs_12', (-AV_TIP[0], -2.2, -5), (0, 0, 1), (0, 0, -1)),    # left wingtip down
    ('rcs_13', (0.62, 8.75, 5), (0, 0, -1), (0.3, 1, 0.1)),       # nose, forward-facing right (reverse)
    ('rcs_14', (-0.62, 8.75, 5), (0, 0, -1), (-0.3, 1, 0.1)),     # nose, forward-facing left
    ('rcs_15', (AV_TIP[0], -12, AV_TIP[1] + 0.09), (0, 1, 0), (0, -1, 0)),   # right wingtip pod tail, aft-facing
    ('rcs_16', (-AV_TIP[0], -12, AV_TIP[1] + 0.09), (0, 1, 0), (0, -1, 0)),  # left wingtip pod tail, aft-facing
]


def anvil_materials():
    bw, by0, by1, bz = AV_BAY

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        top = g.smooth(nz, 0.5, 0.65)
        under = g.smooth(nz, -0.3, -0.5)
        side = g.smooth(g.absolute(nx), 0.45, 0.6)
        # graphite belly and nose cap, anti-glare ahead of the canopy
        nose = g.smooth(y, 9.1, 9.14)
        glare = g.mul(g.mul(S.band(g, y, 7.75, 9.05, 0.01), top), g.sub(1.0, g.smooth(ax, 0.5, 0.52)))
        dark = union(g, [under, nose, glare])
        col = g.mix(dark, OFF_WHITE, GRAPHITE)
        # an orange chine stripe along the flank, broken by the wing
        zch = g.madd(y, -0.025, 0.0)
        stripe = g.mul(g.mul(S.band(g, g.sub(z, zch), 0.3, 0.46, 0.006), S.band(g, y, -1.0, 8.4, 0.01)), side)
        col = g.mix(stripe, col, ORANGE)
        # Ember wing chevrons on the upper rear deck, pointing forward
        chev_u = g.add(y, g.mul(ax, 0.75))
        chev = g.mul(g.mul(union(g, [S.band(g, chev_u, -3.15, -2.95, 0.006), S.band(g, chev_u, -2.75, -2.55, 0.006)]),
                           top), g.sub(1.0, g.smooth(ax, 1.25, 1.3)))
        col = g.mix(chev, col, ORANGE)
        # nose number and stencils
        flank = g.smooth(g.absolute(nx), 0.3, 0.45)
        u, v = side_uv(g, x, y, z, nx, 6.35)
        col = g.mix(g.mul(digits(g, u, v, '07', 0.5, 0.0, -0.15, soft=0.004), flank), col, GRAPHITE)
        u2, _ = side_uv(g, x, y, z, nx, 3.4)
        sten = g.mul(union(g, [stencil(g, u2, z, -0.6, 0.62, 1.1, 0.05, 2.0), stencil(g, u2, z, -0.6, 0.54, 0.7, 0.05, 4.0)]),
                     flank)
        col = g.mix(g.mul(sten, 0.85), col, GRAPHITE)
        # dock ring and walkway on the dorsal deck
        d = g.vmath('LENGTH', g.combine(x, g.sub(y, AV_DOCK_Y), 0.0), out=1)
        ang = polar_angle(g, x, y, 0.0, AV_DOCK_Y)
        ring = g.mul(S.band(g, d, 0.36, 0.44, 0.005), top)
        stripes = g.math('LESS_THAN', g.math('FRACT', g.mul(ang, 16 / (2 * math.pi))), 0.5)
        col = g.mix(ring, col, g.mix(stripes, INK, HAZARD))
        walk = g.mul(g.mul(S.band(g, ax, 0.62, 0.68, 0.004), top), S.band(g, y, -5.2, 2.6, 0.01))
        col = g.mix(walk, col, GRAPHITE)
        # hazard frame round the torpedo bay
        bay_frame = g.mul(g.mul(rect(g, ax, y, 0.0, bw + 0.22, by1 - 0.22, by0 + 0.22, 0.004),
                                g.sub(1.0, rect(g, ax, y, 0.0, bw + 0.02, by1 - 0.02, by0 + 0.02, 0.004))), under)
        col = g.mix(bay_frame, col, g.mix(S.hazard(g, x, y, 0.13), INK, HAZARD))
        heat = g.mul(g.smooth(y, -7.9, -8.45), 1.0)
        col = g.mix(heat, col, (0.06, 0.055, 0.058))
        dark_r = union(g, [dark, heat, bay_frame])
        return S.weathered(g, col, g.mixf(dark_r, 0.4, 0.52), g.mixf(dark_r, 0.18, 0.38), P, N,
                           panel=(1.3, 0.6), panel_scale=0.85, mortar=0.012)

    def wing_paint(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        under = g.smooth(g.sep(N)[2], -0.15, -0.4)
        le_y = g.sub(2.4, g.mul(g.sub(ax, 2.0), 0.85))
        leading = g.smooth(g.sub(y, le_y), -0.3, -0.26)
        col = g.mix(g.maximum(under, leading), OFF_WHITE, GRAPHITE)
        tip = g.mul(S.band(g, ax, 5.2, 5.75, 0.005), g.sub(1.0, g.maximum(under, leading)))
        col = g.mix(tip, col, ORANGE)
        sten = g.mul(stencil(g, ax, y, 3.0, -3.55, 1.0, 0.07, 9.0), g.sub(1.0, under))
        col = g.mix(g.mul(sten, 0.8), col, GRAPHITE)
        dark = g.maximum(under, leading)
        return S.weathered(g, col, g.mixf(dark, 0.42, 0.52), g.mixf(dark, 0.2, 0.35), P, N, panel=(1.2, 0.55),
                           panel_scale=0.9)

    def armour(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(g.noise(P, 0.6, 2.0), 0.4, 0.6), (0.3, 0.29, 0.275), (0.25, 0.245, 0.235))
        # bolt heads round the plate edges
        bolts = g.smooth(g.voronoi(g.vmath('MULTIPLY', P, (1.0, 1.0, 1.0)), 9.0, rand=0.0), 0.06, 0.035)
        ch = S.weathered(g, col, 0.5, 0.45, P, N, lines=False, wear=1.4, grime=1.2)
        ch['normal'] = g.bump(g.mul(bolts, 0.002), 1.0, 1.0, normal=ch['normal'])
        return ch

    def engine(g, P, N):
        x, y, z = g.sep(P)
        under = g.smooth(g.sep(N)[2], -0.15, -0.4)
        heat = g.smooth(y, -7.6, -8.6)
        col = g.mix(under, OFF_WHITE, GRAPHITE)
        col = g.mix(S.band(g, y, -4.55, -4.3, 0.005), col, ORANGE)
        col = g.mix(S.band(g, y, -7.35, -7.2, 0.004), col, GRAPHITE)
        col = g.mix(heat, col, (0.07, 0.06, 0.058))
        col = g.mix(g.mul(heat, g.smooth(g.noise(P, 3.0, 3.0), 0.4, 0.7)), col, (0.05, 0.055, 0.09))
        return S.weathered(g, col, g.mixf(heat, g.mixf(under, 0.42, 0.52), 0.42),
                           g.mixf(heat, g.mixf(under, 0.2, 0.3), 0.6), P, N, wear=0.8, panel_scale=1.1)

    def fin_paint(g, P, N):
        x, y, z = g.sep(P)
        nx = g.sep(N)[0]
        fz = AV_ENG[1] + AV_NAC_R - 0.06
        col = g.mix(g.smooth(z, fz + 1.29, fz + 1.32), OFF_WHITE, ORANGE)
        col = g.mix(g.smooth(z, fz + 1.69, fz + 1.72), col, GRAPHITE)
        u, v = side_uv(g, x, y, z, nx, -6.55)
        col = g.mix(digits(g, u, v, '07', 0.5, 0.0, fz + 0.62, soft=0.004), col, GRAPHITE)
        return S.weathered(g, col, 0.42, 0.2, P, N, panel=(1.0, 0.5), panel_scale=1.0)

    def turret(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(z, 1.2, 1.22), GRAPHITE, (0.12, 0.12, 0.125))
        col = g.mix(S.band(g, z, 1.36, 1.42, 0.004), col, ORANGE)
        return S.weathered(g, col, 0.45, 0.45, P, N, lines=False, wear=1.0)

    def bay(g, P, N):
        x, y, z = g.sep(P)
        ribs = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(y, 1.1)), 0.5)), 0.42, 0.46)
        col = g.mix(ribs, (0.05, 0.052, 0.056), (0.03, 0.031, 0.034))
        ch = S.weathered(g, col, 0.55, 0.4, P, N, lines=False, wear=0.5, grime=1.3)
        ch['normal'] = g.bump(g.mul(ribs, -0.004), 1.0, 1.0, normal=ch['normal'])
        return ch

    def torpedo(g, P, N):
        x, y, z = g.sep(P)
        col = torpedo_paint(g, P, N, g.sub(y, AV_TORP[1]))
        return S.weathered(g, col, 0.42, 0.25, P, N, lines=False, wear=0.5)

    def metal(g, P, N):
        return S.weathered(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, lines=False, wear=0.6)

    def pod(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(g.sep(N)[2], -0.1, -0.4), OFF_WHITE, GRAPHITE)
        col = g.mix(S.band(g, y, -0.7, -0.4, 0.005), col, ORANGE)
        col = g.mix(g.smooth(y, 0.15, 0.2), col, GRAPHITE)
        return S.weathered(g, col, 0.45, 0.25, P, N, panel_scale=1.4)

    return dict(
        body=S.material('av_body', body), wing=S.material('av_wing', wing_paint),
        armour=S.material('av_armour', armour), engine=S.material('av_engine', engine),
        fin=S.material('av_fin', fin_paint), turret=S.material('av_turret', turret),
        bay=S.material('av_bay', bay), torpedo=S.material('av_torpedo', torpedo),
        metal=S.material('av_metal', metal), pod=S.material('av_pod', pod),
        frame=flat_paint('av_frame', GRAPHITE, 0.5, 0.3, wear=0.8),
        nozzle=nozzle_paint('av_nozzle', AV_ENG[0], AV_ENG[1], mirror=True, exit_y=AV_EXIT_Y, ridges=6.0),
        glow=S.glow_material('av_glow', (1.0, 0.62, 0.3), (0.45, 0.3, 0.2)),
        red=S.glow_material('av_nav_red', (1.0, 0.05, 0.03), (0.3, 0.02, 0.02)),
        green=S.glow_material('av_nav_green', (0.05, 1.0, 0.25), (0.02, 0.3, 0.06)),
        white=S.glow_material('av_nav_white', (1.0, 0.95, 0.85), (0.4, 0.4, 0.4)),
        sensor=S.material('av_sensor', lambda g, P, N: dict(albedo=(0.01, 0.012, 0.016), rough=0.08, metal=0.0)),
        hole=S.material('av_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def cut_away(obj, size, matrix, mat):
    """Boolean-subtract a box (with material `mat` on its faces) from obj."""
    cutter = S.box(obj.name + '_cutter', size, mat, matrix)
    mod = obj.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    mod.material_mode = 'TRANSFER'
    C.apply_modifiers(obj)
    bpy.data.objects.remove(cutter)
    return obj


def build_anvil():
    M = anvil_materials()
    parts = []
    body = S.loft('body', ANVIL_BODY, M['body'], around=48, along=36, front_tip=(0, 9.5, -0.28),
                  back_tip=(0, -8.5, 0.1))
    # The recessed torpedo bay, cut out of the belly.
    bw, by0, by1, bz = AV_BAY
    cut_away(body, (2 * bw, by0 - by1, 3.0), T((0, (by0 + by1) / 2, bz - 1.5)), M['bay'])
    parts.append(body)
    cabin = S.loft('cabin', AV_CABIN, M['body'], around=28, along=12, front_tip=(0, 7.95, 0.65),
                   back_tip=(0, 2.2, 1.22))
    parts.append(cabin)
    deck = S.bvh_of([body, cabin])

    # Stepped two-seat canopy (the `glass` node): two bubbles, the rear one
    # higher, with bows, a divider and sills.
    glass_mat = glass_material('av_glass')
    bubbles = []
    for i, (centre, radii) in enumerate(AV_CANOPY):
        bubbles.append(bubble(f'glass{i}', centre, radii, glass_mat, front_taper=0.4, top_taper=0.18,
                              cut=centre[2] - 0.05, u=24, v=14))
        out = lambda p, c=centre: Vector((p.x, 0, p.z - c[2]))
        for j, yy in enumerate((centre[1] + radii[1] * 0.78, centre[1] - radii[1] * 0.2)):
            path = [bubble_point(centre, radii, yy, rad(a), 1.03, 0.4, 0.18) for a in range(6, 175, 12)]
            parts.append(S.bar(f'bow{i}{j}', path, 0.09, 0.055, M['frame'], out))
        for sgn in (1, -1):
            sill = [bubble_point(centre, radii, yy, rad(90 - sgn * 82), 1.035, 0.4, 0.18)
                    for yy in np.linspace(centre[1] + radii[1] * 0.92, centre[1] - radii[1] * 0.92, 11)]
            parts.append(S.bar(f'sill{i}{sgn}', sill, 0.08, 0.05, M['frame'], out))
    glass = C.join(bubbles, 'glass')

    # Dock on the dorsal deck behind the canopy.
    dloc, _ = S.frame_on(S.bvh_of([body]), (0, AV_DOCK_Y, 5), (0, 0, -1))
    dz0 = dloc.z + 0.04
    plate = S.lathe('dock_plate', [(0.0, 0.0), (0.0, 0.32), (0.045, 0.32), (0.065, 0.29), (0.065, 0.2),
                                   (0.045, 0.18), (0.045, 0.0)], 20, (0, 0), M['metal'], sharp=30)
    parts.append(S.transformed(plate, T((0, AV_DOCK_Y, dz0 - 0.065)) @ R(rad(90), 4, 'X')))

    side = []
    # Engines: a big nacelle each side of the rear body, a bell, a glowing
    # throat round a dark cone, a cooling ring.
    ex = AV_EXIT_Y
    nr = AV_NAC_R
    nacelle = [(-2.4, 0.0), (-2.6, 0.5 * nr), (-3.3, 0.84 * nr), (-4.3, 0.985 * nr), (-8.25, nr), (-8.6, nr - 0.06),
               (-8.62, 0.0)]
    side.append(S.lathe('nacelle', nacelle, 32, AV_ENG, M['engine'], sharp=40))
    bell = [(-8.4, 0.92), (-8.9, 0.88), (ex + 0.08, 0.875), (ex, 0.875), (ex - 0.01, 0.8), (ex + 0.36, 0.68),
            (-8.8, 0.55), (-8.68, 0.55), (-8.56, 0.7), (-8.46, 0.86)]
    side.append(S.lathe('bell', bell, 32, AV_ENG, M['nozzle'], closed=True, sharp=35))
    side.append(S.lathe('throat', [(-8.74, 0.0), (-8.74, 0.56), (-8.7, 0.56), (-8.7, 0.0)], 32, AV_ENG, M['glow'],
                        smooth=False))
    side.append(S.lathe('cone', [(-8.73, 0.24), (-8.95, 0.17), (-9.12, 0.0)], 12, AV_ENG, M['hole']))
    side.append(ring_bar('engine_ring', AV_ENG, nr - 0.04, -8.55, 0.14, 0.05, M['metal'], sides=32))
    side.append(ring_bar('intake_ring', AV_ENG, nr - 0.02, -4.45, 0.12, 0.03, M['metal'], sides=32))
    # Fin on each nacelle, canted out 12 degrees.
    fin = S.wing('fin', [(0.0, -5.1, 0.0, 3.2, 0.08), (1.1, -6.05, 0.0, 2.3, 0.07), (2.0, -6.95, 0.0, 1.45, 0.065)],
                 M['fin'], chord_pts=9)
    side.append(S.transformed(fin, T((AV_ENG[0], 0, AV_ENG[1] + nr - 0.06)) @ R(rad(-78), 4, 'Y')))
    # Short thick wings with armour plates, and a pod at each tip.
    secs = [(2.0, 2.4, -0.12, 6.6, 0.17), (3.4, 1.2, -0.18, 5.2, 0.15), (5.0, -0.1, -0.24, 3.9, 0.13),
            (AV_TIP[0] - 0.05, -1.0, -0.3, 3.0, 0.12)]
    wing = S.wing('wing', secs, M['wing'], chord_pts=12)
    side.append(wing)
    tx, tz = AV_TIP
    side.append(S.lathe('tip_pod', [(-4.45, 0.0), (-4.4, 0.1), (-4.2, 0.2), (-0.6, 0.24), (0.1, 0.22), (0.45, 0.13),
                                    (0.62, 0.0)], 14, (tx, tz), M['pod'], sharp=40))
    side.append(S.lathe('navlight', [(0.56, 0.0), (0.6, 0.08), (0.68, 0.07), (0.71, 0.0)], 8, (tx, tz), M['green']))
    wbvh = S.bvh_of([wing])
    for i, (px, py, size) in enumerate(((3.05, 0.75, (1.15, 2.3, 0.14)), (4.2, -0.3, (1.1, 1.95, 0.14)),
                                        (5.25, -1.2, (0.95, 1.6, 0.13)))):
        side.append(drape(f'armour{i}', wbvh, (px, py, 4), (0, 0, -1), size[:2], M['armour'], rad(-28),
                          thick=size[2] * 0.7, inset=0.9))
        side.append(drape(f'belly_armour{i}', wbvh, (px + 0.1, py - 0.2, -4), (0, 0, 1),
                          (size[0] * 0.9, size[1] * 0.8), M['armour'], rad(28), thick=size[2] * 0.5, inset=0.9))
    # flank armour along the forward body, and the guns in chin pods
    for i, (py, pz, size) in enumerate(((3.7, -0.12, (0.95, 2.3)),)):
        side.append(drape(f'cheek{i}', deck, (6, py, pz), (-1, 0, 0), size, M['armour'], thick=0.09, inset=0.92))
    gx = AV_GUN_X
    gz = S.frame_on(S.bvh_of([body]), (gx, 7.2, -5), (0, 0, 1))[0].z - 0.1
    side.append(S.lathe('gun_blister', [(5.6, 0.0), (5.75, 0.13), (6.2, 0.23), (9.1, 0.23), (9.45, 0.17), (9.6, 0.0)],
                        14, (gx, gz), M['body'], sharp=40))
    side.append(S.lathe('barrel', [(9.2, 0.0), (9.2, 0.075), (AV_MUZZLE_Y - 0.3, 0.07), (AV_MUZZLE_Y - 0.28, 0.095),
                                    (AV_MUZZLE_Y - 0.02, 0.095), (AV_MUZZLE_Y, 0.065), (AV_MUZZLE_Y, 0.0)], 10,
                        (gx, gz), M['metal'], sharp=40))
    side.append(S.lathe('bore', [(AV_MUZZLE_Y - 0.08, 0.0), (AV_MUZZLE_Y - 0.08, 0.048), (AV_MUZZLE_Y + 0.005, 0.048),
                                 (AV_MUZZLE_Y + 0.005, 0.0)], 8, (gx, gz), M['hole'], smooth=False))
    # radiator vents on the nacelle tops
    nbvh = S.bvh_of([o for o in side if o.name == 'nacelle'])
    for i, yy in enumerate((-5.3, -6.3)):
        _, m = S.frame_on(nbvh, (AV_ENG[0] + 0.55, yy, 4), (0, 0, -1))
        side += S.vent(f'vent{i}', (0.42, 0.7, 0.05), M['metal'], m, slats=5)
    parts += S.mirrored(side)
    for o in parts:
        if o.name == 'navlight_m':
            o.data.materials[0] = M['red']

    # Bay interior: ribs across the ceiling, cradle rails and two torpedoes.
    tx0, ty, tz0 = AV_TORP
    for k in range(6):
        yy = by1 + 0.45 + k * (by0 - by1 - 0.9) / 5
        parts.append(S.box(f'bay_rib{k}', (2 * bw - 0.04, 0.1, 0.1), M['metal'], T((0, yy, bz - 0.05))))
    for sgn in (1, -1):                      # bay doors folded up against the walls
        parts.append(S.box(f'bay_door{sgn}', (0.05, by0 - by1 - 0.1, 0.5), M['metal'],
                           T((sgn * (bw - 0.04), (by0 + by1) / 2, bz - 0.33))))
    for sgn in (1, -1):
        parts.append(S.box(f'cradle{sgn}', (0.12, 4.0, 0.16), M['metal'], T((sgn * tx0, ty, bz - 0.12))))
        parts += torpedo_parts(f'torp{sgn}_', M, T((sgn * tx0, ty, tz0)), sides=14)

    # Rear auto-turret (the `turret_rear` and `turret_rear_gun` nodes).
    py, pz = AV_TURRET
    ploc, _ = S.frame_on(deck, (0, py, 5), (0, 0, -1))
    parts.append(S.lathe('turret_plinth', [(0.0, 0.0), (0.0, 0.62), (0.08, 0.62), (pz - ploc.z + 0.02, 0.56),
                                           (pz - ploc.z + 0.02, 0.0)], 16, (0, 0), M['metal'], sharp=30))
    S.transformed(parts[-1], T((0, py, ploc.z - 0.1)) @ R(rad(90), 4, 'X'))
    base = S.lathe('turret_base', [(0.0, 0.0), (0.0, 0.55), (0.24, 0.55), (0.32, 0.46), (0.36, 0.3), (0.38, 0.0)], 8,
                   (0, 0), M['turret'], smooth=False, phase=math.pi / 8)
    S.transformed(base, T((0, py, pz)) @ R(rad(90), 4, 'X'))
    yoke = [S.box(f'yoke{s}', (0.08, 0.32, 0.36), M['turret'], T((s * 0.3, py, pz + AV_TRUNNION - 0.1)))
            for s in (1, -1)]
    tz_ = pz + AV_TRUNNION
    gun = [S.box('mantlet', (0.46, 0.5, 0.34), M['turret'], T((0, py, tz_)), taper=0.9)]
    for s in (1, -1):
        gun.append(S.lathe(f'tbarrel{s}', [(0.0, 0.0), (0.0, 0.06), (-1.3, 0.05), (-1.32, 0.07), (-1.5, 0.07),
                                            (-1.52, 0.0)], 8, (0, 0), M['metal'], sharp=40))
        S.transformed(gun[-1], T((s * 0.12, py - 0.2, tz_)))
        gun.append(S.lathe(f'tbore{s}', [(-1.46, 0.0), (-1.46, 0.042), (-1.525, 0.042), (-1.525, 0.0)], 6, (0, 0),
                           M['hole'], smooth=False))
        S.transformed(gun[-1], T((s * 0.12, py - 0.2, tz_)))
    gun.append(S.box('sensor_box', (0.16, 0.2, 0.14), M['frame'], T((0.0, py - 0.05, tz_ + 0.22))))
    gun.append(cylinder('trunnion', (-0.33, py, tz_), (0.33, py, tz_), 0.07, M['metal'], sides=8))
    parts += tag([base] + yoke, 'turret_rear') + tag(gun, 'turret_rear_gun')

    # Greebles: a dorsal antenna, a belly sensor, hatches.
    _, m = S.frame_on(deck, (0, -1.6, 5), (0, 0, -1))
    antenna = S.lathe('antenna', [(-0.04, 0.0), (-0.04, 0.035), (1.1, 0.012), (1.13, 0.0)], 6, (0, 0), M['metal'])
    parts.append(S.transformed(antenna, m @ R(rad(65), 4, 'X') @ R(rad(180), 4, 'Z')))
    _, m = S.frame_on(deck, (0, 6.4, -5), (0, 0, 1))
    chin = S.lathe('chin_sensor', [(-0.04, 0.0), (-0.04, 0.26), (0.1, 0.24), (0.2, 0.15), (0.24, 0.0)], 14, (0, 0),
                   M['sensor'])
    parts.append(S.transformed(chin, m @ R(rad(90), 4, 'X')))
    hatches = []
    for i, (yy, xx) in enumerate(((-3.6, 1.0), (-1.2, 1.55))):
        hatches.append(drape(f'hatch{i}', deck, (xx, yy, 5), (0, 0, -1), (0.7, 1.0), M['body'], thick=0.025, inset=0.95,
                             n=2))
    parts += S.mirrored(hatches)
    fin_root = AV_ENG[1] + AV_NAC_R - 0.06
    for sgn, name in ((1, 'strobe_r'), (-1, 'strobe_l')):
        tipx = sgn * (AV_ENG[0] + 2.0 * math.cos(rad(78)) + 0.0)
        parts.append(S.lathe(name, [(-7.4, 0.0), (-7.36, 0.035), (-7.2, 0.035), (-7.16, 0.0)], 8,
                             (tipx, fin_root + 2.0 * math.sin(rad(78)) + 0.03), M['white']))

    rcs_bvh = S.bvh_of([o for o in parts if o.name.startswith(('body', 'cabin', 'nacelle', 'tip_pod'))])
    rcs_parts, empties = place_rcs(AV_RCS, rcs_bvh, M['metal'], M['hole'], size=0.24)
    parts += rcs_parts
    fin_top = fin_root + 2.0 * math.sin(rad(78)) + 0.07
    fin_x = AV_ENG[0] + 2.0 * math.cos(rad(78))
    empties += [
        S.empty('nozzle_L', (-AV_ENG[0], AV_EXIT_Y, AV_ENG[1])), S.empty('nozzle_R', (AV_ENG[0], AV_EXIT_Y, AV_ENG[1])),
        S.empty('muzzle_L', (-gx, AV_MUZZLE_Y + 0.005, gz)), S.empty('muzzle_R', (gx, AV_MUZZLE_Y + 0.005, gz)),
        S.empty('launcher_0', (-tx0, ty, tz0)), S.empty('launcher_1', (tx0, ty, tz0)),
        S.empty('cam_cockpit', (0, 6.35, 1.42)),
        S.empty('dock', (0, AV_DOCK_Y, dz0 + 0.005)),
        S.empty('light_0', (-tx, 0.7, tz)), S.empty('light_1', (tx, 0.7, tz)),
        S.empty('light_2', (-fin_x, -7.28, fin_top)), S.empty('light_3', (fin_x, -7.28, fin_top)),
    ]
    solid = [o for o in parts + [glass] if not o.name.startswith(('antenna',))]
    cols = fit_colliders(solid, 28, tol=0.15)
    empties += [sphere_empty(f'col_{i + 1:02d}', p, r) for i, (p, r) in enumerate(cols)]
    pivot = T((0, py, pz)) @ R(rad(180), 4, 'Z')
    trunnion = T((0, py, tz_)) @ R(rad(180), 4, 'Z')
    meta = dict(nozzles={'nozzle_L': 0.8, 'nozzle_R': 0.8}, turrets={'turret_rear': 0.6},
                lights={'light_0': ((1.0, 0.08, 0.05), 0), 'light_1': ((0.1, 1.0, 0.3), 0),
                        'light_2': ((1.0, 0.95, 0.85), 1.4), 'light_3': ((1.0, 0.95, 0.85), 1.4)})
    return dict(parts=parts, extras=[glass], empties=empties, meta=meta, bevel=0.025,
                nodes=[('turret_rear', pivot, None), ('turret_rear_gun', trunnion, 'turret_rear')])


# ==========================================================================
# Tender — repair drone (about 3.5 m long)

DRONE_BODY = [
    # y, half-width, top, bottom, top exponent, bottom exponent, centre z, chine
    (1.42, 0.36, 0.2, 0.18, 3.0, 3.0, 0.06, 0.0),
    (1.3, 0.6, 0.36, 0.32, 4.0, 3.6, 0.05, 0.0),
    (1.05, 0.7, 0.44, 0.37, 5.0, 4.2, 0.05, 0.0),
    (0.4, 0.73, 0.47, 0.39, 5.5, 4.6, 0.04, 0.0),
    (-0.5, 0.73, 0.47, 0.39, 5.5, 4.6, 0.04, 0.0),
    (-1.0, 0.68, 0.43, 0.36, 4.6, 4.0, 0.04, 0.0),
    (-1.16, 0.52, 0.32, 0.27, 3.4, 3.0, 0.04, 0.0),
]
DR_PODS = [(-0.9, 0.5), (0.9, 0.5), (-0.9, -0.42), (0.9, -0.42)]   # nozzle_0..3 axis x, z
DR_EXIT_Y = -1.66
DR_SHOULDER = (0.7, 0.98, -0.22)       # right shoulder pivot (mirrored for the left)
DR_PLATE = (-0.15, -0.71)              # attach plate centre y, bottom z


def drone_materials():
    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.35, -0.6)
        col = g.mix(under, OFF_WHITE, GRAPHITE)
        # the green cross band round the waist, white crosses on top and flanks
        bandm = S.band(g, y, -0.2, 0.32, 0.005)
        col = g.mix(bandm, col, CROSS_GREEN)
        cy = 0.06
        top = g.smooth(nz, 0.6, 0.75)
        cross_top = g.mul(top, g.maximum(rect(g, x, y, -0.06, 0.06, cy - 0.19, cy + 0.19, 0.003),
                                         rect(g, x, y, -0.19, 0.19, cy - 0.06, cy + 0.06, 0.003)))
        flank = g.smooth(g.absolute(nx), 0.6, 0.75)
        cross_side = g.mul(flank, g.maximum(rect(g, y, z, cy - 0.06, cy + 0.06, -0.12, 0.26, 0.003),
                                            rect(g, y, z, cy - 0.19, cy + 0.19, 0.01, 0.13, 0.003)))
        col = g.mix(g.maximum(cross_top, cross_side), col, OFF_WHITE)
        # orange nose ring and rear frame, stencils, a unit number
        col = g.mix(S.band(g, y, 1.12, 1.18, 0.004), col, ORANGE)
        col = g.mix(g.smooth(y, -0.98, -1.02), col, GRAPHITE)
        u, v = side_uv(g, x, y, z, nx, -0.62)
        col = g.mix(g.mul(digits(g, u, v, '3', 0.2, 0.0, 0.1, soft=0.003), flank), col, GRAPHITE)
        sten = g.mul(stencil(g, u, z, -0.2, -0.16, 0.42, 0.028, 4.0), flank)
        col = g.mix(g.mul(sten, 0.8), col, GRAPHITE)
        tsten = g.mul(stencil(g, y, x, 0.5, 0.25, 0.32, 0.03, 6.0), top)
        col = g.mix(g.mul(tsten, 0.8), col, GRAPHITE)
        dark = g.maximum(under, g.smooth(y, -0.98, -1.02))
        return S.weathered(g, col, g.mixf(dark, 0.4, 0.5), g.mixf(dark, 0.15, 0.35), P, N, panel=(0.95, 0.42),
                           panel_scale=1.0, mortar=0.007)

    def pod(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(S.band(g, y, -0.98, -0.9, 0.004), GRAPHITE, ORANGE)
        col = g.mix(g.smooth(y, -0.86, -0.82), col, OFF_WHITE)
        return S.weathered(g, col, 0.45, 0.35, P, N, lines=False, wear=1.0)

    def arm(g, P, N):
        x, y, z = g.sep(P)
        haz = S.band(g, y, 0.55, 0.75, 0.004)
        col = g.mix(haz, (0.13, 0.13, 0.135), g.mix(S.hazard(g, y, z, 0.05), INK, HAZARD))
        return S.weathered(g, col, 0.45, 0.45, P, N, lines=False, wear=1.2)

    def metal(g, P, N):
        return S.weathered(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, lines=False, wear=0.6)

    def tank(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(S.band(g, y, -0.08, 0.08, 0.004), OFF_WHITE, ORANGE)
        col = g.mix(g.maximum(g.smooth(y, 0.46, 0.48), g.smooth(y, -0.46, -0.48)), col, GRAPHITE)
        return S.weathered(g, col, 0.38, 0.3, P, N, lines=False, wear=0.9)

    def plate(g, P, N):
        x, y, z = g.sep(P)
        d = g.vmath('LENGTH', g.combine(x, g.sub(y, DR_PLATE[0]), 0.0), out=1)
        ang = polar_angle(g, x, y, 0.0, DR_PLATE[0])
        ring = S.band(g, d, 0.2, 0.27, 0.004)
        stripes = g.math('LESS_THAN', g.math('FRACT', g.mul(ang, 10 / (2 * math.pi))), 0.5)
        col = g.mix(ring, (0.05, 0.052, 0.055), g.mix(stripes, INK, HAZARD))
        return S.weathered(g, col, 0.5, 0.55, P, N, lines=False, wear=1.0)

    return dict(
        body=S.material('dr_body', body), pod=S.material('dr_pod', pod), arm=S.material('dr_arm', arm),
        metal=S.material('dr_metal', metal), plate=S.material('dr_plate', plate),
        frame=flat_paint('dr_frame', GRAPHITE, 0.5, 0.3, wear=0.8),
        nozzle=nozzle_paint('dr_nozzle', 0.86, 0.04, mirror=True, exit_y=DR_EXIT_Y),
        glow=S.glow_material('dr_glow', (0.55, 0.68, 1.0), (0.3, 0.35, 0.45)),
        green=S.glow_material('dr_status', (0.15, 1.0, 0.35), (0.03, 0.3, 0.08)),
        white=S.glow_material('dr_work', (1.0, 0.96, 0.88), (0.5, 0.5, 0.48)),
        torch=S.glow_material('dr_torch', (1.0, 0.55, 0.2), (0.3, 0.2, 0.15)),
        tank=S.material('dr_tank', tank), tool=flat_paint('dr_tool', (0.11, 0.11, 0.115), 0.45, 0.5, wear=1.0),
        sensor=S.material('dr_sensor', lambda g, P, N: dict(albedo=(0.01, 0.012, 0.016), rough=0.08, metal=0.0)),
        hole=S.material('dr_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def drone_arm(prefix, M, sgn, welder):
    """A folded manipulator arm: shoulder, upper arm swung back and down,
    elbow, forearm folded forward under the nose, and a tool: a three-finger
    gripper or a welding head with a heat shield."""
    sx, sy, sz = DR_SHOULDER
    sx *= sgn
    sh = Vector((sx, sy, sz))
    elbow = Vector((sgn * 0.84, 0.42, -0.52))
    wrist = Vector((sgn * 0.84, 1.36, -0.56))
    parts = [cylinder(prefix + 'shoulder', (sx - sgn * 0.12, sy, sz), (sx + sgn * 0.1, sy, sz), 0.13, M['metal'],
                      sides=10),
             cylinder(prefix + 'elbow', (elbow.x - 0.1, elbow.y, elbow.z), (elbow.x + 0.1, elbow.y, elbow.z), 0.1,
                      M['metal'], sides=10)]
    for name, a, b, w in ((prefix + 'upper', sh, elbow, 0.17), (prefix + 'fore', elbow, wrist, 0.14)):
        d = b - a
        m = T((a + b) / 2) @ d.to_track_quat('Y', 'Z').to_matrix().to_4x4()
        parts.append(S.box(name, (w * 0.85, d.length + 0.06, w), M['arm'], m, taper=0.92))
    # hydraulic ram along the upper arm
    ram0, ram1 = sh + Vector((sgn * 0.11, -0.05, 0.06)), elbow + Vector((sgn * 0.1, 0.12, 0.08))
    parts.append(cylinder(prefix + 'ram', ram0, ram1, 0.03, M['frame'], sides=6))
    if welder:
        parts.append(cylinder(prefix + 'torch_body', wrist, wrist + Vector((0, 0.3, 0)), 0.09, M['tool'], sides=10))
        parts.append(S.lathe(prefix + 'torch', [(0.0, 0.08), (0.12, 0.06), (0.2, 0.025), (0.22, 0.0)], 10, (0, 0),
                             M['metal']))
        S.transformed(parts[-1], T(wrist + Vector((0, 0.3, 0))))
        parts.append(S.lathe(prefix + 'torch_tip', [(0.0, 0.0), (0.0, 0.024), (0.04, 0.0)], 6, (0, 0), M['torch']))
        S.transformed(parts[-1], T(wrist + Vector((0, 0.51, 0))))
        parts.append(S.box(prefix + 'shield', (0.3, 0.025, 0.22), M['frame'], T(wrist + Vector((0, 0.12, 0.12)))))
    else:
        parts.append(cylinder(prefix + 'wrist', wrist, wrist + Vector((0, 0.14, 0)), 0.09, M['tool'], sides=10))
        for k in range(3):
            a = rad(90 + 120 * k)
            off = Vector((math.cos(a) * 0.06, 0.0, math.sin(a) * 0.06))
            base = wrist + Vector((0, 0.13, 0)) + off
            mid = base + Vector((off.x * 0.7, 0.16, off.z * 0.7))
            tip = mid + Vector((-off.x * 0.6, 0.14, -off.z * 0.6))
            for j, (p0, p1) in enumerate(((base, mid), (mid, tip))):
                d = p1 - p0
                m = T((p0 + p1) / 2) @ d.to_track_quat('Y', 'Z').to_matrix().to_4x4()
                parts.append(S.box(f'{prefix}finger{k}{j}', (0.05, d.length + 0.02, 0.05), M['metal'], m,
                                   taper=0.8 if j else 1.0))
    return parts


def build_drone():
    M = drone_materials()
    parts = []
    body = S.loft('body', DRONE_BODY, M['body'], around=20, along=12, front_tip=(0, 1.46, 0.06),
                  back_tip=(0, -1.19, 0.04), sharp=50)
    parts.append(body)
    bvh = S.bvh_of([body])

    # Four thruster pods on struts round the rear, all exhausting aft.
    ex = DR_EXIT_Y
    for i, (px, pz) in enumerate(DR_PODS):
        parts.append(S.lathe(f'pod{i}', [(-0.5, 0.0), (-0.54, 0.1), (-0.66, 0.185), (-1.36, 0.185), (-1.42, 0.165),
                                          (-1.43, 0.0)], 10, (px, pz), M['pod'], sharp=40))
        parts.append(S.lathe(f'bell{i}', [(-1.38, 0.15), (ex + 0.02, 0.145), (ex, 0.145), (ex - 0.005, 0.12),
                                           (-1.5, 0.075), (-1.42, 0.1)], 10, (px, pz), M['nozzle'], closed=True,
                             sharp=35))
        parts.append(S.lathe(f'throat{i}', [(-1.48, 0.0), (-1.48, 0.08)], 10, (px, pz), M['glow'], smooth=False))
        # strut from the body corner to the pod
        corner = Vector((math.copysign(0.56, px), -0.95, 0.04 + math.copysign(0.36 if pz > 0 else 0.3, pz)))
        pod_c = Vector((px, -0.95, pz))
        d = pod_c - corner
        dx = d.normalized()
        m = Matrix((dx, Vector((0, 1, 0)), dx.cross(Vector((0, 1, 0))))).transposed().to_4x4()
        m.translation = (corner + pod_c) / 2
        parts.append(S.box(f'strut{i}', (d.length + 0.12, 0.62, 0.08), M['metal'], m))
    # Welding-gas tanks strapped along the upper flanks.
    for sgn in (1, -1):
        parts.append(S.lathe(f'tank{sgn}', [(0.62, 0.0), (0.58, 0.08), (0.5, 0.115), (-0.5, 0.115),
                                            (-0.58, 0.08), (-0.62, 0.0)], 8, (sgn * 0.56, 0.53), M['tank'], sharp=50))
        for k, yy in enumerate((0.3, -0.3)):
            parts.append(ring_bar(f'strap{sgn}{k}', (sgn * 0.56, 0.53), 0.115, yy, 0.05, 0.012, M['frame'], sides=8))

    # Sensor head and work lights on the front face.
    _, m = S.frame_on(bvh, (0, 3, 0.12), (0, -1, 0))
    parts.append(S.transformed(S.lathe('head_ring', [(0.0, 0.0), (0.0, 0.17), (0.06, 0.17), (0.08, 0.14), (0.08, 0.0)],
                                       16, (0, 0), M['frame'], sharp=30), m @ R(rad(90), 4, 'X')))
    parts.append(S.transformed(S.lathe('eye', [(0.0, 0.12), (0.05, 0.11), (0.1, 0.07), (0.12, 0.0)], 16, (0, 0),
                                       M['sensor']), m @ T((0, 0, 0.06)) @ R(rad(90), 4, 'X')))
    lights = []
    for sgn in (1, -1):
        loc, m = S.frame_on(bvh, (sgn * 0.42, 3, -0.06), (0, -1, 0))
        parts.append(S.transformed(S.lathe(f'lamp{sgn}', [(0.0, 0.0), (0.0, 0.1), (0.07, 0.1), (0.07, 0.0)], 10,
                                           (0, 0), M['frame'], smooth=False), m @ R(rad(90), 4, 'X')))
        parts.append(S.transformed(S.lathe(f'lens{sgn}', [(0.07, 0.0), (0.07, 0.08), (0.09, 0.0)], 10, (0, 0),
                                           M['white']), m @ R(rad(90), 4, 'X')))
        lights.append((loc + m.col[2].xyz * 0.1))
    # Status light, antenna and grab rails on top.
    _, m = S.frame_on(bvh, (0, -0.55, 2), (0, 0, -1))
    parts.append(S.transformed(S.lathe('status_base', [(0.0, 0.0), (0.0, 0.07), (0.04, 0.07), (0.04, 0.0)], 10,
                                       (0, 0), M['frame'], smooth=False), m @ R(rad(90), 4, 'X')))
    parts.append(S.transformed(S.lathe('status', [(0.04, 0.0), (0.04, 0.055), (0.09, 0.04), (0.11, 0.0)], 10, (0, 0),
                                       M['green']), m @ R(rad(90), 4, 'X')))
    status = m.translation + m.col[2].xyz * 0.11
    _, m = S.frame_on(bvh, (0.3, -0.75, 2), (0, 0, -1))
    antenna = S.lathe('antenna', [(-0.03, 0.0), (-0.03, 0.016), (0.55, 0.007), (0.57, 0.0)], 5, (0, 0), M['metal'])
    parts.append(S.transformed(antenna, m @ R(rad(80), 4, 'X') @ R(rad(180), 4, 'Z')))
    for sgn in (1, -1):
        rail = []
        for y, lift in ((0.55, -0.01), (0.5, 0.08), (0.0, 0.08), (-0.05, -0.01)):
            loc, _ = S.frame_on(bvh, (sgn * 0.4, y, 2), (0, 0, -1))
            rail.append(Vector((sgn * 0.4, y, loc.z + lift)))
        parts.append(S.bar(f'rail{sgn}', rail, 0.03, 0.03, M['frame'], lambda p: Vector((0, 0, 1))))

    # Attach plate on a short pedestal underneath (the dock).
    py, pz = DR_PLATE
    loc, _ = S.frame_on(bvh, (0, py, -2), (0, 0, 1))
    h = loc.z - pz
    ped = S.lathe('pedestal', [(0.0, 0.0), (0.0, 0.3), (0.05, 0.3), (0.07, 0.17), (h + 0.05, 0.15), (h + 0.05, 0.0)],
                  16, (0, 0), M['plate'], sharp=30)
    parts.append(S.transformed(ped, T((0, py, pz)) @ R(rad(90), 4, 'X')))
    for k in range(3):
        a = rad(90 + 120 * k)
        parts.append(S.box(f'clamp{k}', (0.06, 0.1, 0.12), M['metal'],
                           T((0.31 * math.cos(a), py + 0.31 * math.sin(a), pz + 0.07)) @ R(a, 4, 'Z')))

    # Folded arms (the `arm_L` and `arm_R` nodes), the right one a welder.
    arm_r = drone_arm('armR_', M, 1, True)
    arm_l = drone_arm('armL_', M, -1, False)
    parts += tag(arm_r, 'arm_R') + tag(arm_l, 'arm_L')

    empties = [S.empty(f'nozzle_{i}', (px, DR_EXIT_Y, pz)) for i, (px, pz) in enumerate(DR_PODS)]
    empties += [
        S.empty('dock', (0, py, pz)),
        S.empty('light_0', status), S.empty('light_1', lights[1]), S.empty('light_2', lights[0]),
    ]
    solid = [o for o in parts if not o.name.startswith(('antenna',))]
    cols = fit_colliders(solid, 9, tol=0.04)
    empties += [sphere_empty(f'col_{i + 1:02d}', p, r) for i, (p, r) in enumerate(cols)]
    sx, sy, sz = DR_SHOULDER
    meta = dict(nozzles={f'nozzle_{i}': 0.12 for i in range(4)},
                lights={'light_0': ((0.15, 1.0, 0.35), 1.0), 'light_1': ((1.0, 0.96, 0.88), 0),
                        'light_2': ((1.0, 0.96, 0.88), 0)},
                nodes={'armL': 'arm_L', 'armR': 'arm_R'})
    return dict(parts=parts, extras=[], empties=empties, meta=meta, bevel=0.012,
                nodes=[('arm_R', T((sx, sy, sz)), None), ('arm_L', T((-sx, sy, sz)), None)])


# ==========================================================================
# Torpedo — the Lance (4.5 m)

def torpedo_materials():
    def body(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        col = torpedo_paint(g, P, N, y)
        u = g.mul(polar_angle(g, x, z), 1.0 / (2 * math.pi))
        sten = union(g, [stencil(g, y, g.mul(u, 1.57), -1.3, 0.05, 1.0, 0.03, 3.0),
                         stencil(g, y, g.mul(u, 1.57), -1.3, 0.0, 0.6, 0.03, 8.0),
                         stencil(g, y, g.mul(u, 1.57), -1.3, -0.42, 1.0, 0.03, 5.0)])
        col = g.mix(g.mul(sten, 0.85), col, GRAPHITE)
        marks = g.mul(ring_marks(g, y, polar_angle(g, x, z), -0.25, -0.17, 4, 0.12), 1.0)
        col = g.mix(marks, col, GRAPHITE)
        return S.weathered(g, col, 0.4, 0.22, P, N, panel=(0.9, 0.5), panel_scale=1.8, mortar=0.008, wear=0.5)

    def fin(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(y, -1.93, -1.96), OFF_WHITE, GRAPHITE)
        r = g.vmath('LENGTH', g.combine(x, 0.0, z), out=1)
        col = g.mix(g.smooth(r, 0.5, 0.52), col, ORANGE)
        return S.weathered(g, col, 0.42, 0.25, P, N, lines=False, wear=0.7)

    return dict(
        torpedo=S.material('tp_body', body), fin=S.material('tp_fin', fin),
        nozzle=nozzle_paint('tp_nozzle', 0.0, 0.0, mirror=False, exit_y=-2.255),
        metal=S.material('tp_metal', lambda g, P, N: S.weathered(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, lines=False,
                                                                 wear=0.6)),
        glow=S.glow_material('tp_glow', (1.0, 0.75, 0.45), (0.4, 0.3, 0.2)),
        sensor=S.material('tp_sensor', lambda g, P, N: dict(albedo=(0.012, 0.014, 0.02), rough=0.06, metal=0.0)),
        hole=S.material('tp_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def build_torpedo():
    M = torpedo_materials()
    parts = torpedo_parts('', dict(M, torpedo=M['torpedo']), Matrix(), sides=20, fins=False)
    for k in range(4):
        fin = S.wing(f'fin{k}', TORPEDO_FIN, M['fin'], chord_pts=5, diamond=True, sharp=30)
        parts.append(S.transformed(fin, R(rad(45 + 90 * k), 4, 'Y') @ T((0.2, 0, 0))))
    parts.append(S.lathe('throat', [(-2.05, 0.0), (-2.05, 0.125), (-2.03, 0.125), (-2.03, 0.0)], 16, (0, 0), M['glow'],
                         smooth=False))
    parts.append(ring_bar('guide_ring', (0, 0), 0.25, -0.21, 0.06, 0.012, M['metal'], sides=20))
    parts.append(S.box('raceway', (0.07, 2.6, 0.06), M['metal'], T((0, -0.35, 0.255)), taper=0.75))
    # four small guidance strakes ahead of the warhead ring
    for k in range(4):
        m = R(rad(45 + 90 * k), 4, 'Y') @ T((0, 0.62, 0.26))
        parts.append(S.box(f'strake{k}', (0.018, 0.5, 0.05), M['metal'], m, taper=0.6))
    empties = [S.empty('nozzle_C', (0, -2.255, 0))]
    solid = [o for o in parts if not o.name.startswith(())]
    cols = fit_colliders(solid, 5, tol=0.03)
    empties += [sphere_empty(f'col_{i + 1:02d}', p, r) for i, (p, r) in enumerate(cols)]
    meta = dict(nozzles={'nozzle_C': 0.2})
    return dict(parts=parts, extras=[], empties=empties, meta=meta, bevel=0.008)


# ==========================================================================
# Skiff — evacuation shuttle (about 28 m long)

SHUTTLE_BODY = [
    # y, half-width, top, bottom, top exponent, bottom exponent, centre z, chine
    (14.05, 0.65, 0.18, 0.55, 2.5, 2.5, -0.5, 0.0),
    (13.75, 1.7, 0.6, 1.2, 3.0, 3.4, -0.44, 0.0),
    (13.0, 2.4, 1.25, 1.7, 3.6, 4.2, -0.25, 0.0),
    (11.9, 2.65, 1.88, 1.88, 4.6, 5.0, -0.08, 0.0),
    (10.4, 2.7, 2.1, 1.92, 5.2, 5.6, 0.0, 0.0),
    (8.6, 2.7, 2.1, 1.92, 5.2, 5.6, 0.0, 0.0),
    (-7.6, 2.7, 2.1, 1.92, 5.2, 5.6, 0.0, 0.0),
    (-10.2, 2.65, 2.05, 1.88, 4.8, 5.2, 0.05, 0.0),
    (-12.3, 2.45, 1.9, 1.74, 4.2, 4.6, 0.1, 0.0),
    (-12.95, 2.25, 1.75, 1.6, 3.8, 4.2, 0.1, 0.0),
]
SH_ENG = (4.45, -0.35)                 # engine axis |x|, z
SH_EXIT_Y = -14.0
SH_DOCK_Y = 0.6
SH_NUMBER = '12'
SH_WINDOWS = (-7.0, 5.6, 1.0)          # first and last window centre y, pitch
SH_ROWS = (0.45, 1.38)                 # window row centres z (two decks)
SH_DOOR = (6.55, 8.35, -1.1, 1.5)      # side door y0, y1, z0, z1
SH_COLLARS = ((9.4, 9.05), (-7.75, -8.1), (-12.05, -12.35))

SH_RCS = [
    ('rcs_01', (0, 11.6, 5), (0, 0, -1), (0, 0, 1)),               # nose up
    ('rcs_02', (0, 11.6, -5), (0, 0, 1), (0, 0, -1)),              # nose down
    ('rcs_03', (5, 11.6, 0.95), (-1, 0, 0), (1, 0, 0)),            # nose right
    ('rcs_04', (-5, 11.6, 0.95), (1, 0, 0), (-1, 0, 0)),           # nose left
    ('rcs_05', (0, -11.65, 5), (0, 0, -1), (0, 0, 1)),             # tail up, behind the spine
    ('rcs_06', (0, -11.6, -5), (0, 0, 1), (0, 0, -1)),             # tail down
    ('rcs_07', (8, -9.4, SH_ENG[1]), (-1, 0, 0), (1, 0, 0)),       # tail right, on the engine pod
    ('rcs_08', (-8, -9.4, SH_ENG[1]), (1, 0, 0), (-1, 0, 0)),      # tail left
    ('rcs_09', (1.9, 0.6, 5), (0, 0, -1), (0, 0, 1)),              # amidships right roof, up (roll)
    ('rcs_10', (1.9, 0.6, -5), (0, 0, 1), (0, 0, -1)),             # amidships right belly, down
    ('rcs_11', (-1.9, 0.6, 5), (0, 0, -1), (0, 0, 1)),             # amidships left roof, up
    ('rcs_12', (-1.9, 0.6, -5), (0, 0, 1), (0, 0, -1)),            # amidships left belly, down
    ('rcs_13', (1.45, 13.2, 5), (0, 0, -1), (0.3, 1, 0.1)),        # nose, forward-facing right (reverse)
    ('rcs_14', (-1.45, 13.2, 5), (0, 0, -1), (-0.3, 1, 0.1)),      # nose, forward-facing left
    ('rcs_15', (1.35, -20, 1.35), (0, 1, 0), (0, -1, 0)),          # stern, aft-facing right
    ('rcs_16', (-1.35, -20, 1.35), (0, 1, 0), (0, -1, 0)),         # stern, aft-facing left
]


def windows(g, y, z, y0, y1, pitch, rows, w=0.21, h=0.27, seed=0.0):
    """Rows of rounded window panes along the flank: (pane mask, frame
    mask, lit mask). Some panes are dark, at random but fixed."""
    s = g.mul(g.sub(y, y0 - pitch / 2), 1.0 / pitch)
    cell = g.math('FLOOR', s)
    f = g.sub(g.math('FRACT', s), 0.5)
    inside = S.band(g, y, y0 - pitch / 2, y1 + pitch / 2, 0.002)
    panes, frames, lit = [], [], []
    for k, zc in enumerate(rows):
        dz = g.sub(z, zc)
        e = g.add(g.power(g.absolute(g.math('DIVIDE', g.mul(f, pitch), w)), 4.0),
                  g.power(g.absolute(g.math('DIVIDE', dz, h)), 4.0))
        pane = g.mul(g.sub(1.0, g.smooth(e, 0.85, 1.0)), inside)
        frame = g.mul(g.sub(1.0, g.smooth(e, 1.25, 1.45)), inside)
        n = g.node('ShaderNodeTexWhiteNoise', [g.combine(cell, k + seed, 0.37)], noise_dimensions='3D').outputs['Value']
        panes.append(pane)
        frames.append(frame)
        lit.append(g.mul(pane, g.mul(g.math('GREATER_THAN', n, 0.17), g.add(0.7, g.mul(n, 0.35)))))
    return union(g, panes), union(g, frames), union(g, lit)


def shuttle_materials():
    wy0, wy1, pitch = SH_WINDOWS
    dy0, dy1, dz0, dz1 = SH_DOOR
    fwd_collar, aft_collar = SH_COLLARS[0][1], SH_COLLARS[1][0]

    def hull(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        side = g.smooth(g.absolute(nx), 0.6, 0.75)
        top = g.smooth(nz, 0.6, 0.75)
        under = g.smooth(nz, -0.5, -0.7)
        front = g.smooth(ny, 0.3, 0.5)
        back = g.smooth(ny, -0.6, -0.75)
        lower = g.smooth(z, -0.32, -0.38)
        col = g.mix(g.maximum(lower, under), OFF_WHITE, WARM_GREY)
        # rust-orange cargo paint on the drive section's upper half and a
        # rust cheat line along the cabin
        drive = g.mul(g.smooth(y, aft_collar - 0.35, aft_collar - 0.39), g.sub(1.0, g.maximum(lower, under)))
        col = g.mix(drive, col, RUST)
        cheat = g.mul(g.mul(S.band(g, z, -0.3, -0.06, 0.006), side), S.band(g, y, aft_collar - 0.3, 12.2, 0.02))
        col = g.mix(cheat, col, RUST)
        stern = g.mul(S.band(g, y, -12.95, -12.4, 0.006), g.sub(1.0, back))
        col = g.mix(stern, col, g.mix(S.hazard(g, g.add(x, z), y, 0.22), INK, HAZARD))
        # the side door: a hazard frame, a seam; stencils
        u, v = side_uv(g, x, y, z, nx, (dy0 + dy1) / 2)
        hw = (dy1 - dy0) / 2
        frame_out = rect(g, u, z, -hw - 0.16, hw + 0.16, dz0 - 0.16, dz1 + 0.16, 0.004)
        frame_in = rect(g, u, z, -hw, hw, dz0, dz1, 0.004)
        door_frame = g.mul(g.mul(frame_out, g.sub(1.0, frame_in)), side)
        col = g.mix(door_frame, col, g.mix(S.hazard(g, y, z, 0.12), INK, HAZARD))
        seam = g.mul(g.mul(frame_in, g.sub(1.0, rect(g, u, z, -hw + 0.03, hw - 0.03, dz0 + 0.03, dz1 - 0.03, 0.003))),
                     side)
        col = g.mix(seam, col, INK)
        door_win = g.mul(rect(g, u, z, -0.25, 0.25, 0.75, 1.15, 0.004), side)
        dsten = g.mul(union(g, [stencil(g, u, z, -hw, dz1 + 0.3, 1.5, 0.08, 1.0),
                                stencil(g, u, z, -hw + 0.2, dz0 - 0.4, 1.0, 0.07, 2.0)]), side)
        col = g.mix(g.mul(dsten, 0.85), col, INK)
        # passenger windows: two decks
        pane, wframe, lit = windows(g, y, z, wy0, wy1, pitch, SH_ROWS)
        pane, wframe, lit = (g.mul(m, side) for m in (pane, wframe, lit))
        pane = g.maximum(pane, door_win)
        lit = g.maximum(lit, g.mul(door_win, 0.8))
        col = g.mix(wframe, col, (0.05, 0.05, 0.052))
        # cockpit glazing round the sloped nose, with mullions
        cz = g.mul(S.band(g, z, 0.32, 1.55, 0.006), S.band(g, y, 11.95, 14.1, 0.01))
        mull = union(g, [S.band(g, ax, 0.0, 0.06, 0.004), S.band(g, ax, 0.86, 0.94, 0.004),
                         S.band(g, ax, 1.72, 1.8, 0.004), g.mul(S.band(g, y, 12.46, 12.54, 0.004), side)])
        cockpit = g.mul(g.mul(cz, g.sub(1.0, mull)), g.maximum(front, g.mul(side, S.band(g, y, 12.0, 12.95, 0.01))))
        brow = g.mul(g.mul(S.band(g, z, 1.55, 1.68, 0.004), S.band(g, y, 11.9, 14.1, 0.01)),
                     g.maximum(front, side))
        col = g.mix(brow, col, INK)
        # the big painted number on both flanks of the cockpit section, and on
        # the roof (read from astern)
        u2, v2 = side_uv(g, x, y, z, nx, 10.6)
        num = g.mul(digits(g, u2, v2, SH_NUMBER, 1.35, 0.0, 0.62, soft=0.006, weight=0.18), side)
        roof_num = g.mul(digits(g, x, y, SH_NUMBER, 2.0, 0.0, 4.2, soft=0.008, weight=0.18), top)
        col = g.mix(g.maximum(num, roof_num), col, INK)
        # dock target and walkway lines on the roof
        d = g.vmath('LENGTH', g.combine(x, g.sub(y, SH_DOCK_Y), 0.0), out=1)
        ang = polar_angle(g, x, y, 0.0, SH_DOCK_Y)
        ring = g.mul(S.band(g, d, 0.68, 0.84, 0.006), top)
        stripes = g.math('LESS_THAN', g.math('FRACT', g.mul(ang, 16 / (2 * math.pi))), 0.5)
        col = g.mix(ring, col, g.mix(stripes, INK, HAZARD))
        walk = g.mul(g.mul(S.band(g, ax, 1.02, 1.09, 0.004), top), S.band(g, y, -0.6, 8.6, 0.01))
        col = g.mix(walk, col, (0.25, 0.23, 0.2))
        tsten = g.mul(union(g, [stencil(g, y, x, 6.4, 1.3, 1.6, 0.1, 13.0), stencil(g, y, x, 6.4, -1.45, 1.3, 0.1, 14.0)]),
                      top)
        col = g.mix(g.mul(tsten, 0.7), col, INK)
        # landing-gear bays under the belly
        gear = g.mul(union(g, [rect(g, ax, y, 1.05, 1.95, -6.1, -3.0, 0.004), rect(g, ax, y, 0.0, 0.42, 9.0, 11.25, 0.004)]),
                     under)
        col = g.mix(gear, col, (0.03, 0.03, 0.032))
        glass = g.maximum(pane, cockpit)
        dark = g.maximum(g.maximum(lower, under), drive)
        rough = g.mixf(glass, g.mixf(dark, 0.45, 0.52), 0.08)
        metal = g.mixf(glass, 0.15, 0.0)
        ch = S.weathered(g, col, rough, metal, P, N, panel=(1.6, 0.8), panel_scale=0.62, mortar=0.016, wear=1.1,
                         grime=1.3)
        ch['glow'] = g.add(g.vmath('SCALE', g.combine(*WINDOW), scale=lit),
                           g.vmath('SCALE', g.combine(0.05, 0.08, 0.1), scale=cockpit))
        recess = g.add(g.add(g.mul(wframe, -0.004), g.mul(seam, -0.003)), g.mul(gear, -0.006))
        ch['normal'] = g.bump(recess, 1.0, 1.0, normal=ch['normal'])
        ch['albedo'] = g.mix(glass, ch['albedo'], g.mix(cockpit, (0.02, 0.022, 0.026), (0.012, 0.016, 0.022)))
        return ch

    def pod(g, P, N):
        x, y, z = g.sep(P)
        nz = g.sep(N)[2]
        col = g.mix(g.smooth(nz, -0.3, -0.5), OFF_WHITE, WARM_GREY)
        col = g.mix(g.smooth(y, -6.15, -6.2), RUST, col)
        col = g.mix(S.band(g, y, -6.75, -6.35, 0.006), col, g.mix(S.hazard(g, x, g.add(y, z), 0.16), INK, HAZARD))
        col = g.mix(S.band(g, y, -9.6, -9.0, 0.006), col, RUST)
        col = g.mix(g.smooth(y, -4.9, -4.85), col, (0.03, 0.03, 0.032))
        heat = g.smooth(y, -11.8, -12.8)
        col = g.mix(heat, col, (0.07, 0.06, 0.058))
        return S.weathered(g, col, g.mixf(heat, 0.48, 0.42), g.mixf(heat, 0.2, 0.55), P, N, panel=(1.2, 0.6),
                           panel_scale=0.8, mortar=0.014, wear=1.2, grime=1.4)

    def metal(g, P, N):
        return S.weathered(g, (0.05, 0.05, 0.052), 0.5, 0.5, P, N, lines=False, wear=0.8)

    def strut(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(S.band(g, g.math('FRACT', g.mul(y, 2.0)), 0.0, 0.5, 0.01), (0.12, 0.12, 0.12), HAZARD)
        return S.weathered(g, g.mix(0.6, col, (0.1, 0.1, 0.1)), 0.5, 0.45, P, N, lines=False, wear=1.4)

    def radiator(g, P, N):
        return S.weathered(g, (0.16, 0.15, 0.14), 0.42, 0.6, P, N, lines=False, wear=0.5)

    def ramp(g, P, N):
        x, y, z = g.sep(P)
        edge = g.sub(1.0, rect(g, x, z, -1.4, 1.4, -1.25, 1.0, 0.004))
        col = g.mix(edge, WARM_GREY, g.mix(S.hazard(g, x, z, 0.14), INK, HAZARD))
        sten = stencil(g, x, z, -0.9, 0.55, 1.8, 0.1, 21.0)
        col = g.mix(g.mul(sten, 0.8), col, INK)
        return S.weathered(g, col, 0.5, 0.3, P, N, panel=(1.2, 0.6), panel_scale=0.8, wear=1.3, grime=1.4)

    return dict(
        hull=S.material('sh_hull', hull), pod=S.material('sh_pod', pod), metal=S.material('sh_metal', metal),
        strut=S.material('sh_strut', strut), radiator=S.material('sh_radiator', radiator),
        ramp=S.material('sh_ramp', ramp),
        frame=flat_paint('sh_frame', (0.1, 0.1, 0.1), 0.5, 0.3, wear=0.8),
        nozzle=nozzle_paint('sh_nozzle', SH_ENG[0], SH_ENG[1], mirror=True, exit_y=SH_EXIT_Y, ridges=3.0),
        glow=S.glow_material('sh_glow', (0.6, 0.72, 1.0), (0.3, 0.35, 0.45)),
        red=S.glow_material('sh_nav_red', (1.0, 0.05, 0.03), (0.3, 0.02, 0.02)),
        green=S.glow_material('sh_nav_green', (0.05, 1.0, 0.25), (0.02, 0.3, 0.06)),
        white=S.glow_material('sh_nav_white', (1.0, 0.95, 0.85), (0.4, 0.4, 0.4)),
        hole=S.material('sh_hole', lambda g, P, N: dict(albedo=SOOT, rough=0.7, metal=0.0)),
    )


def landing_leg(prefix, M, hinge, length, belly_z, pad_r=0.45):
    """A landing leg folded flat into its bay under the belly: hinge block,
    strut, drag brace and a foot pad, the strut running aft from the
    hinge."""
    hx, hy = hinge
    z = belly_z - 0.1
    parts = [S.box(prefix + 'hinge', (0.5, 0.36, 0.26), M['metal'], T((hx, hy, belly_z - 0.04))),
             S.box(prefix + 'strut', (0.26, length, 0.22), M['strut'], T((hx, hy - length / 2, z))),
             S.box(prefix + 'brace', (0.12, length * 0.6, 0.12), M['metal'],
                   T((hx + 0.22, hy - length * 0.42, z + 0.04)) @ R(rad(-5), 4, 'Z'))]
    pad = S.lathe(prefix + 'pad', [(0.0, 0.0), (0.0, pad_r), (0.06, pad_r), (0.12, pad_r * 0.7), (0.12, 0.0)], 14,
                  (0, 0), M['strut'], sharp=30)
    parts.append(S.transformed(pad, T((hx, hy - length, z - 0.08)) @ R(rad(-90), 4, 'X')))
    return parts


def build_shuttle():
    M = shuttle_materials()
    parts = []
    body = S.loft('body', SHUTTLE_BODY, M['hull'], around=36, along=32, front_tip=(0, 14.1, -0.5),
                  back_tip=(0, -12.95, 0.1), sharp=60)
    parts.append(body)
    bvh = S.bvh_of([body])
    # module joints: raised collars behind the cockpit, ahead of the drive
    # section and at the stern
    for i, (y0, y1) in enumerate(SH_COLLARS):
        _, w, zt, zb, nt, nb, zc, _ = section_at(SHUTTLE_BODY, (y0 + y1) / 2)
        k = 0.07
        collar = [(y0, w + k, zt + k, zb + k, nt, nb, zc, 0.0), (y1, w + k, zt + k, zb + k, nt, nb, zc, 0.0)]
        parts.append(S.loft(f'collar{i}', collar, M['frame'], around=36, along=None,
                            front_tip=(0, y0, zc), back_tip=(0, y1, zc), smooth=False))
    # a dorsal equipment trough over the rear half of the roof
    spine = [(-0.9, 0.08, 0.05, 0.1, 2.5, 2.0, 2.07, 0.0), (-1.6, 0.66, 0.3, 0.2, 5.0, 2.0, 2.07, 0.0),
             (-10.3, 0.66, 0.3, 0.2, 5.0, 2.0, 2.05, 0.0), (-11.0, 0.08, 0.05, 0.1, 2.5, 2.0, 2.03, 0.0)]
    parts.append(S.loft('spine', spine, M['hull'], around=20, along=None, sharp=50, front_tip=(0, -0.85, 2.07),
                        back_tip=(0, -11.05, 2.03)))
    # the rear ramp, a plate on the stern face
    _, m = S.frame_on(bvh, (0, -20, -0.1), (0, 1, 0), along=(0, 0, 1))
    parts.append(S.box('ramp', (3.0, 2.5, 0.1), M['ramp'], m @ T((0, 0.0, 0.03)), taper=0.97))

    side = []
    # Engines: a pod on a stub pylon at each rear corner, a bell, a glowing
    # throat round a dark cone.
    ex = SH_EXIT_Y
    pod = [(-4.6, 0.0), (-4.68, 0.18), (-5.2, 0.62), (-6.1, 1.16), (-6.9, 1.35), (-12.3, 1.35), (-12.75, 1.3),
           (-12.78, 0.0)]
    side.append(S.lathe('pod', pod, 28, SH_ENG, M['pod'], sharp=40))
    bell = [(-12.5, 1.25), (-13.2, 1.22), (ex + 0.06, 1.28), (ex, 1.28), (ex - 0.01, 1.2), (ex + 0.4, 1.0),
            (-13.1, 0.8), (-12.95, 0.8), (-12.8, 1.0), (-12.6, 1.2)]
    side.append(S.lathe('bell', bell, 28, SH_ENG, M['nozzle'], closed=True, sharp=35))
    side.append(S.lathe('throat', [(-13.0, 0.0), (-13.0, 0.81), (-12.96, 0.81), (-12.96, 0.0)], 28, SH_ENG, M['glow'],
                        smooth=False))
    side.append(S.lathe('cone', [(-12.98, 0.38), (-13.3, 0.25), (-13.55, 0.0)], 12, SH_ENG, M['hole']))
    side.append(ring_bar('cowl_ring', SH_ENG, 1.33, -6.95, 0.2, 0.06, M['metal'], sides=28))
    side.append(ring_bar('aft_ring', SH_ENG, 1.33, -12.2, 0.18, 0.06, M['metal'], sides=28))
    # a thick stub pylon carrying the pod
    side.append(S.wing('pylon', [(2.2, -7.2, SH_ENG[1], 4.4, 0.14), (SH_ENG[0], -7.6, SH_ENG[1], 4.0, 0.13)],
                       M['pod'], chord_pts=8, sharp=40))
    # nav light on the pod's outer flank (green to starboard)
    side.append(S.lathe('navlight', [(-7.7, 0.0), (-7.65, 0.11), (-7.4, 0.11), (-7.35, 0.0)], 8,
                        (SH_ENG[0] + 1.37, SH_ENG[1]), M['green']))
    # side vents and a fuel hatch on the flanks
    for i, yy in enumerate((-9.3, -10.5)):
        _, m = S.frame_on(bvh, (5, yy, 1.4), (-1, 0, 0))
        side += S.vent(f'vent{i}', (0.7, 0.9, 0.05), M['metal'], m, slats=5)
    _, m = S.frame_on(bvh, (5, 3.0, -1.2), (-1, 0, 0))
    side.append(S.box('hatch', (0.55, 0.8, 0.04), M['hull'], m, taper=0.9))
    # floodlight over the door
    _, m = S.frame_on(bvh, (5, 7.45, 1.85), (-1, 0, 0))
    side.append(S.box('door_lamp', (0.14, 0.5, 0.12), M['frame'], m @ T((0, 0, 0.04))))
    side.append(S.box('door_lamp_lens', (0.08, 0.42, 0.04), M['white'], m @ T((-0.06, 0, 0.09))))
    # main landing legs folded into their bays
    loc, _ = S.frame_on(bvh, (1.5, -3.0, -5), (0, 0, 1))
    side += landing_leg('main_', M, (1.5, -3.3), 2.6, loc.z)
    parts += S.mirrored(side)
    for o in parts:
        if o.name == 'navlight_m':
            o.data.materials[0] = M['red']
    loc, _ = S.frame_on(bvh, (0, 11.0, -5), (0, 0, 1))
    parts += landing_leg('nose_', M, (0.0, 11.0), 1.85, loc.z, pad_r=0.36)

    # Roof: the dock ring, a radiator pair, an antenna mast, a beacon.
    dloc, _ = S.frame_on(bvh, (0, SH_DOCK_Y, 5), (0, 0, -1))
    dz = dloc.z + 0.06
    ring = S.lathe('dock_ring', [(0.0, 0.0), (0.0, 0.62), (0.08, 0.62), (0.12, 0.56), (0.12, 0.42), (0.06, 0.38),
                                 (0.06, 0.0)], 24, (0, 0), M['metal'], sharp=30)
    parts.append(S.transformed(ring, T((0, SH_DOCK_Y, dz - 0.12)) @ R(rad(90), 4, 'X')))
    for sgn in (1, -1):
        _, m = S.frame_on(bvh, (sgn * 1.55, -7.6, 5), (0, 0, -1))
        parts += S.vent(f'radiator{sgn}', (1.0, 3.0, 0.1), M['radiator'], m, slats=8)
    _, m = S.frame_on(bvh, (-1.55, -2.6, 5), (0, 0, -1))
    mast = S.lathe('mast', [(-0.05, 0.0), (-0.05, 0.08), (0.9, 0.05), (0.92, 0.0)], 8, (0, 0), M['metal'])
    parts.append(S.transformed(mast, m @ R(rad(90), 4, 'X')))
    parts.append(S.transformed(S.lathe('dish', [(0.0, 0.0), (0.0, 0.42), (0.12, 0.36), (0.16, 0.0)], 14, (0, 0),
                                       M['radiator'], sharp=40), m @ T((0, 0, 0.92)) @ R(rad(-60), 4, 'X')))
    _, m = S.frame_on(bvh, (1.6, 4.0, 5), (0, 0, -1))
    whip = S.lathe('whip', [(-0.04, 0.0), (-0.04, 0.03), (1.4, 0.012), (1.43, 0.0)], 5, (0, 0), M['metal'])
    parts.append(S.transformed(whip, m @ R(rad(70), 4, 'X') @ R(rad(180), 4, 'Z')))
    _, m = S.frame_on(bvh, (0, 9.9, 5), (0, 0, -1))
    parts.append(S.transformed(S.lathe('beacon', [(0.0, 0.0), (0.0, 0.14), (0.1, 0.12), (0.18, 0.0)], 10, (0, 0),
                                       M['red']), m @ R(rad(90), 4, 'X')))
    beacon = m.translation + m.col[2].xyz * 0.18
    _, m = S.frame_on(bvh, (0, -11.9, 5), (0, 0, -1))
    parts.append(S.transformed(S.lathe('strobe', [(0.0, 0.0), (0.0, 0.1), (0.08, 0.09), (0.14, 0.0)], 10, (0, 0),
                                       M['white']), m @ R(rad(90), 4, 'X')))
    strobe = m.translation + m.col[2].xyz * 0.14
    _, m = S.frame_on(bvh, (0, -8.5, -5), (0, 0, 1))
    parts.append(S.transformed(S.lathe('belly_strobe', [(0.0, 0.0), (0.0, 0.1), (0.08, 0.09), (0.14, 0.0)], 10, (0, 0),
                                       M['white']), m @ R(rad(90), 4, 'X')))
    belly_strobe = m.translation + m.col[2].xyz * 0.14

    rcs_bvh = S.bvh_of([o for o in parts if o.name.startswith(('body', 'pod'))])
    rcs_parts, empties = place_rcs(SH_RCS, rcs_bvh, M['metal'], M['hole'], size=0.42)
    parts += rcs_parts
    ex_, ez = SH_ENG
    empties += [
        S.empty('nozzle_L', (-ex_, SH_EXIT_Y - 0.01, ez)), S.empty('nozzle_R', (ex_, SH_EXIT_Y - 0.01, ez)),
        S.empty('dock', (0, SH_DOCK_Y, dz + 0.005)),
        S.empty('cam_cockpit', (0, 12.75, 1.0)),
        S.empty('light_0', (-(ex_ + 1.47), -7.52, ez)), S.empty('light_1', (ex_ + 1.47, -7.52, ez)),
        S.empty('light_2', strobe), S.empty('light_3', beacon), S.empty('light_4', belly_strobe),
        aimed_empty('bay_0', (0, -13.15, -0.15), '-Y', (0, -1, 0)),
    ]
    solid = [o for o in parts if not o.name.startswith(('whip',))]
    cols = fit_colliders(solid, 22, tol=0.15)
    empties += [sphere_empty(f'col_{i + 1:02d}', p, r) for i, (p, r) in enumerate(cols)]
    meta = dict(nozzles={'nozzle_L': 1.2, 'nozzle_R': 1.2},
                lights={'light_0': ((1.0, 0.08, 0.05), 0), 'light_1': ((0.1, 1.0, 0.3), 0),
                        'light_2': ((1.0, 0.95, 0.85), 1.0), 'light_3': ((1.0, 0.12, 0.05), 1.6),
                        'light_4': ((1.0, 0.95, 0.85), 1.0)})
    return dict(parts=parts, extras=[], empties=empties, meta=meta, bevel=0.045, uv_angle=55.0)


# ==========================================================================
# Main

MODELS = [
    ('swift', build_swift, (2048, 1024)),
    ('anvil', build_anvil, (2048, 1024)),
    ('drone', build_drone, (1024, 1024)),
    ('torpedo', build_torpedo, (512, 512)),
    ('shuttle', build_shuttle, (1024, 1024)),
]


def main(only=None):
    for name, build, tex in MODELS:
        if only and name not in only:
            continue
        C.reset(samples=8)
        C.log('craft', name)
        model = build()
        hull, nodes = bake_craft(name, model, tex)
        meshes = [hull] + model['extras'] + nodes
        C.log(f'  {name}: ' + ' + '.join(f'{o.name} {C.tri_count(o)}' for o in meshes) +
              f' = {sum(C.tri_count(o) for o in meshes)} tris')
        C.log('  ' + collider_report(meshes, model['empties']))
        C.export_glb(os.path.join(C.MODELS, name + '.glb'), meshes + model['empties'])
        write_module(name, craft_anchors(meshes, model['empties'], model))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
