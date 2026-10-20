"""Hedgerow — shared Blender modelling kit.

Every build script imports this module. Models are built in Blender space
(Z up, metres, the model's front facing -Y); the glTF exporter's +Y-up
conversion (x, y, z) -> (x, z, -y) delivers them front facing three.js +Z.

Contract with the game (see docs/models-brief.md):

* one exported object per model, at the world origin, its base on z = 0;
* material names are palette keys (PALETTE below); the game replaces each
  with its own wet, textured material, so the base colour here only matters
  for previews and as a fallback;
* UVs are box-projected in metres (`uv_box`) so tiling textures line up;
* a vertex colour attribute "Color" carries grime/occlusion (`grime`);
* colliders and anchors travel as JSON strings in the node extras, already
  converted to glTF/three.js space (`set_colliders`, `set_anchors`).

Deterministic: no clock, every random draw from a seeded Random.
"""
import bpy, bmesh, json, math, os, random, sys
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))       # fun/hedgerow
MODELS = os.path.join(ROOT, 'assets', 'models')
PREVIEWS = os.path.join(HERE, 'previews')

sys.dont_write_bytecode = True


def log(*parts):
    print('[hedgerow]', *parts, flush=True)


def args_after_dashes():
    """Arguments after `--` on the Blender command line."""
    argv = sys.argv
    return argv[argv.index('--') + 1:] if '--' in argv else []


# --------------------------------------------------------------------------
# Palette: key -> (sRGB hex, roughness, metallic). The game keys its own
# materials by these names; keep them stable.

PALETTE = {
    # architecture
    'stone':          ('#8a8478', 0.9, 0.0),
    'stone_dark':     ('#5f5a52', 0.9, 0.0),
    'plaster':        ('#b5ab97', 0.9, 0.0),
    'plaster_dirty':  ('#978c77', 0.9, 0.0),
    'brick':          ('#84483a', 0.85, 0.0),
    'roof_tile':      ('#7a4030', 0.75, 0.0),
    'roof_slate':     ('#3f444a', 0.6, 0.0),
    'thatch':         ('#7d6a45', 0.95, 0.0),
    'wood':           ('#6b5039', 0.8, 0.0),
    'wood_dark':      ('#3f2e22', 0.8, 0.0),
    'wood_old':       ('#6d6458', 0.9, 0.0),
    'wood_h':         ('#6b5039', 0.8, 0.0),      # boards running horizontally
    'wood_dark_h':    ('#3f2e22', 0.8, 0.0),
    'wood_old_h':     ('#6d6458', 0.9, 0.0),
    'paint_green':    ('#3d5240', 0.6, 0.0),
    'paint_blue':     ('#4a5d6e', 0.6, 0.0),
    'paint_red':      ('#7a2a22', 0.6, 0.0),
    'paint_white':    ('#c9c6bc', 0.6, 0.0),
    'glass':          ('#151b21', 0.1, 0.0),
    'window_lit':     ('#ffb35c', 0.5, 0.0),
    'iron':           ('#2e2f31', 0.5, 0.8),
    'rust':           ('#6e3b22', 0.8, 0.3),
    'concrete':       ('#8c8a84', 0.95, 0.0),
    'cobble':         ('#6c6862', 0.8, 0.0),
    # military
    'sandbag':        ('#8b7a58', 0.95, 0.0),
    'canvas':         ('#5d5a3e', 0.9, 0.0),
    'canvas_gray':    ('#5f6158', 0.9, 0.0),
    'metal_olive':    ('#4b5132', 0.5, 0.4),
    'metal_gray':     ('#545a5a', 0.5, 0.4),
    'metal_dark':     ('#2b2c2c', 0.45, 0.7),
    'rubber':         ('#1d1d1d', 0.9, 0.0),
    'burnt':          ('#1c1a18', 0.95, 0.1),
    'wire':           ('#3a3632', 0.6, 0.7),
    'marking_white':  ('#d8d4c8', 0.7, 0.0),
    # characters
    'cloth_od':       ('#5b5a3c', 0.95, 0.0),
    'cloth_od_dark':  ('#4a4630', 0.95, 0.0),
    'cloth_khaki':    ('#7d7152', 0.95, 0.0),
    'cloth_feldgrau': ('#5c6152', 0.95, 0.0),
    'cloth_feldgrau_dark': ('#45493f', 0.95, 0.0),
    'skin':           ('#c08f74', 0.7, 0.0),
    'hair':           ('#2e2219', 0.9, 0.0),
    'leather':        ('#3b2a1d', 0.6, 0.0),
    'leather_black':  ('#1e1c1b', 0.5, 0.0),
    'webbing':        ('#8a7d5a', 0.95, 0.0),
    'helmet_od':      ('#4b4d34', 0.7, 0.1),
    'helmet_gray':    ('#4f5650', 0.7, 0.1),
    # weapons
    'gun_wood':       ('#5a3a22', 0.6, 0.0),
    'gun_metal':      ('#2a2b2d', 0.4, 0.85),
    'gun_metal_worn': ('#45474a', 0.45, 0.85),
    # nature
    'bark_pine':      ('#4a3a2e', 0.95, 0.0),
    'bark_oak':       ('#4d473f', 0.95, 0.0),
    'bark_birch':     ('#c4c0b4', 0.9, 0.0),
    'needles':        ('#28372a', 0.85, 0.0),
    'leaves':         ('#3c4a29', 0.8, 0.0),
    'leaves_dry':     ('#6a5a34', 0.85, 0.0),
    'moss':           ('#4a5a32', 0.95, 0.0),
    'rock':           ('#7d7a72', 0.9, 0.0),
    'rock_dark':      ('#57554f', 0.9, 0.0),
    'grass':          ('#4e5a34', 0.9, 0.0),
    'reed':           ('#6d6c42', 0.9, 0.0),
    'dirt':           ('#4a3d2e', 0.95, 0.0),
    'hay':            ('#a08a50', 0.95, 0.0),
    'deadwood':       ('#5e5448', 0.95, 0.0),
}


def srgb_to_linear(hexcode):
    out = []
    for i in (1, 3, 5):
        c = int(hexcode[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def material(key):
    """The Principled material for a palette key (created once)."""
    if key not in PALETTE:
        raise KeyError(f'unknown palette key {key!r}')
    mat = bpy.data.materials.get(key)
    if mat:
        return mat
    hexcode, rough, metal = PALETTE[key]
    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    col = srgb_to_linear(hexcode)
    bsdf.inputs['Base Color'].default_value = (*col, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if key == 'window_lit':
        bsdf.inputs['Emission Color'].default_value = (*col, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    mat.diffuse_color = (*col, 1.0)
    return mat


# --------------------------------------------------------------------------
# Scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    from mathutils import noise
    noise.seed_set(1944)          # noise_vector & co. are clock-seeded otherwise
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.cycles.seed = 7
    scene.render.fps = 30               # the game's clips are authored at 30 fps
    return scene


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def activate(obj, selected=()):
    bpy.ops.object.select_all(action='DESELECT')
    for o in selected:
        o.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifiers(obj):
    activate(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def apply_transform(obj):
    activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join(objects, name):
    objects = [o for o in objects if o is not None]
    for o in objects:
        if o.parent:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    activate(objects[0], objects)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def duplicate(obj, name=None, loc=None, rot=None, scale=None):
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = name or obj.name + '_copy'
    link(copy)
    if loc is not None:
        copy.location = loc
    if rot is not None:
        copy.rotation_euler = [math.radians(a) for a in rot]
    if scale is not None:
        copy.scale = scale if hasattr(scale, '__len__') else (scale, scale, scale)
    return copy


def delete(obj):
    bpy.data.objects.remove(obj, do_unlink=True)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def _new_object(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    if mat:
        obj.data.materials.append(material(mat))
    return obj


def _place(obj, loc, rot):
    if loc is not None:
        obj.location = loc
    if rot is not None:
        obj.rotation_euler = [math.radians(a) for a in rot]
    return obj


# --------------------------------------------------------------------------
# Primitives. Sizes in metres, rotations in degrees (XYZ Euler), `loc` is
# the CENTRE of the primitive unless stated otherwise.

def box(size, loc=(0, 0, 0), rot=None, mat='wood', name='box', bevel=0.0, segments=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    obj = _new_object(name, bm, mat)
    if bevel > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        apply_modifiers(obj)
    return _place(obj, loc, rot)


def box_base(size, base=(0, 0, 0), rot=None, **kw):
    """A box whose BOTTOM-centre sits at `base`."""
    x, y, z = base
    return box(size, loc=(x, y, z + size[2] / 2), rot=rot, **kw)


def cyl(radius, depth, loc=(0, 0, 0), rot=None, mat='wood', name='cyl', verts=12,
        radius2=None, cap=True):
    """Cylinder along local Z (cone when radius2 differs)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=verts,
                          radius1=radius, radius2=radius if radius2 is None else radius2,
                          depth=depth)
    return _place(_new_object(name, bm, mat), loc, rot)


def sphere(radius, loc=(0, 0, 0), rot=None, mat='rock', name='sphere', subdiv=2, scale=None):
    """Icosphere; subdiv=1 is the bare icosahedron (20 faces), 2 is 80, 3 is 320."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    if scale:
        bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return _place(_new_object(name, bm, mat), loc, rot)


def uv_sphere(radius, loc=(0, 0, 0), rot=None, mat='rock', name='uvs', segments=12, rings=8, scale=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    if scale:
        bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return _place(_new_object(name, bm, mat), loc, rot)


def extrude_xy(points, height, loc=(0, 0, 0), rot=None, mat='stone', name='prism', z0=0.0):
    """A closed polygon in the XY plane extruded along +Z from z0 to z0+height."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in points]
    top = [bm.verts.new((x, y, z0 + height)) for x, y in points]
    n = len(points)
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _place(_new_object(name, bm, mat), loc, rot)


def extrude_profile(points, depth, axis='Y', loc=(0, 0, 0), rot=None, mat='stone', name='profile'):
    """A closed 2D profile extruded symmetrically along an axis.
    For axis 'Y' the profile is in XZ (x, z); for 'X' it is in YZ (y, z)."""
    bm = bmesh.new()
    h = depth / 2
    if axis == 'Y':
        a = [bm.verts.new((u, -h, v)) for u, v in points]
        b = [bm.verts.new((u, h, v)) for u, v in points]
    else:
        a = [bm.verts.new((-h, u, v)) for u, v in points]
        b = [bm.verts.new((h, u, v)) for u, v in points]
    n = len(points)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _place(_new_object(name, bm, mat), loc, rot)


def gable(width, depth, height, loc=(0, 0, 0), rot=None, mat='roof_tile', name='gable',
          overhang=0.0, thickness=0.0):
    """Gable roof: ridge along Y. `loc` is the centre of the eaves line (base).
    With thickness > 0 the two slopes are slabs (with an underside), else a
    solid prism."""
    half = width / 2
    w = half + overhang
    dz = overhang * height / half          # eaves drop, keeping the slope
    if thickness <= 0:
        pts = [(-w, -dz), (w, -dz), (0, height)]
    else:
        tv = thickness / math.cos(math.atan2(height, half))   # vertical slab thickness
        pts = [(-w, -dz), (0, height), (w, -dz), (w, -dz - tv), (0, height - tv), (-w, -dz - tv)]
        pts = [pts[0], pts[5], pts[4], pts[3], pts[2], pts[1]]  # counter-clockwise in XZ
    obj = extrude_profile(pts, depth + 2 * overhang, 'Y', mat=mat, name=name)
    return _place(obj, loc, rot)


def lathe(profile, segments=16, loc=(0, 0, 0), rot=None, mat='metal_dark', name='lathe', cap=True):
    """Revolve a list of (radius, z) points around Z."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    if cap:
        if profile[0][0] > 1e-4:
            bm.faces.new(list(reversed(rings[0])))
        if profile[-1][0] > 1e-4:
            bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _place(_new_object(name, bm, mat), loc, rot)


def tube(points, radius, segments=8, mat='wire', name='tube', radii=None, cap=True):
    """A tube swept along a polyline of 3D points (parallel-transport frames)."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        b = t.cross(n)
        prev_n = n
        r = radii[i] if radii else radius
        ring = [bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r)
                for a in (2 * math.pi * k / segments for k in range(segments))]
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _new_object(name, bm, mat)


def plane(size_x, size_y, loc=(0, 0, 0), rot=None, mat='wood', name='plane'):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=Vector((size_x, size_y, 1)), verts=bm.verts)
    return _place(_new_object(name, bm, mat), loc, rot)


# --------------------------------------------------------------------------
# Mesh operations

def cut(obj, cutter, keep_cutter=False):
    """Boolean difference (exact solver)."""
    mod = obj.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.use_self = True           # targets are often overlapping joined boxes
    mod.object = cutter
    apply_modifiers(obj)
    if not keep_cutter:
        delete(cutter)
    return obj


def union(obj, other):
    mod = obj.modifiers.new('union', 'BOOLEAN')
    mod.operation = 'UNION'
    mod.solver = 'EXACT'
    mod.object = other
    apply_modifiers(obj)
    delete(other)
    return obj


def bevel(obj, width, segments=1, angle=40):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    apply_modifiers(obj)
    return obj


def subdivide(obj, levels=1, simple=False):
    mod = obj.modifiers.new('subsurf', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    if simple:
        mod.subdivision_type = 'SIMPLE'
    apply_modifiers(obj)
    return obj


def decimate(obj, ratio):
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = ratio
    apply_modifiers(obj)
    return obj


def jitter(obj, amount, seed=1, scale=1.0, axes=(1, 1, 1), keep_base=True):
    """Displace vertices by smooth 3D noise (coherent, so faces stay whole).
    Deterministic (three scalar noise lookups); with keep_base the vertices
    on the ground (z <= base + 1 cm) keep their height."""
    from mathutils import noise
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-100, 100), rnd.uniform(-100, 100), rnd.uniform(-100, 100)))
    me = obj.data
    mw = obj.matrix_world
    base = min((mw @ v.co).z for v in me.vertices) if me.vertices else 0.0
    for v in me.vertices:
        w = mw @ v.co
        p = w * scale + off
        d = Vector((noise.noise(p), noise.noise(p + Vector((31.7, 0, 0))), noise.noise(p + Vector((0, 47.3, 0)))))
        dz = 0.0 if (keep_base and w.z <= base + 0.01) else d.z * axes[2]
        v.co += Vector((d.x * axes[0], d.y * axes[1], dz)) * amount
    me.update()
    return obj


def smooth(obj, angle=40):
    """Smooth shading with sharp edges above `angle` degrees."""
    obj.data.shade_smooth()
    try:
        obj.data.set_sharp_from_angle(angle=math.radians(angle))
    except AttributeError:
        pass
    return obj


def flat(obj):
    obj.data.shade_flat()
    return obj


def set_material(obj, key):
    obj.data.materials.clear()
    obj.data.materials.append(material(key))
    return obj


def to_base_origin(obj):
    """Move the geometry so the bounding-box bottom-centre is the origin."""
    apply_transform(obj)
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    off = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    for v in obj.data.vertices:
        v.co -= off
    obj.data.update()
    obj.location = (0, 0, 0)
    return obj


def bounds(obj):
    """(min, max) of the object's world-space bounding box (Blender space)."""
    mw = obj.matrix_world
    pts = [mw @ v.co for v in obj.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


# --------------------------------------------------------------------------
# UVs and vertex colours

def uv_box(obj, scale=1.0, seed=None):
    """Box projection in metres: each face takes the two world axes its
    normal is not dominant on. Optional seeded offset so repeated models do
    not tile identically."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    off = (0.0, 0.0)
    if seed is not None:
        rnd = random.Random(seed)
        off = (rnd.random() * 4, rnd.random() * 4)
    for poly in me.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if az >= ax and az >= ay:
                u, v = co.x, co.y * (1 if n.z >= 0 else -1)
            elif ax >= ay:
                u, v = co.y * (1 if n.x >= 0 else -1), co.z
            else:
                u, v = -co.x * (1 if n.y >= 0 else -1), co.z
            uv[li].uv = (u * scale + off[0], v * scale + off[1])
    return obj


def uv_cylinder(obj, scale=1.0, center=(0, 0)):
    """Cylindrical projection around Z in metres (u = arc length at r=0.3)."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        angs = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            angs.append(math.atan2(co.y - center[1], co.x - center[0]))
        ref = angs[0]
        for k, li in enumerate(poly.loop_indices):
            co = me.vertices[me.loops[li].vertex_index].co
            a = angs[k]
            while a - ref > math.pi:
                a -= 2 * math.pi
            while a - ref < -math.pi:
                a += 2 * math.pi
            uv[li].uv = (a * 0.3 * scale, co.z * scale)
    return obj


def colors(obj, fn):
    """Fill the "Color" corner attribute with fn(vertex_co, normal) -> float
    or (r, g, b)."""
    me = obj.data
    attr = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    me.color_attributes.active_color = attr
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            c = fn(me.vertices[vi].co, poly.normal)
            if isinstance(c, (int, float)):
                c = (c, c, c)
            attr.data[li].color = (c[0], c[1], c[2], 1.0)
    return obj


def grime(obj, height=0.8, strength=0.4, seed=3, variation=0.08, top=None):
    """Darken towards the base (rain splash, damp, dirt) plus a little coherent
    variation; optional `top` = (z, strength) darkening above a height."""
    from mathutils import noise
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
    zs = [v.co.z for v in obj.data.vertices] or [0]
    z0 = min(zs)

    def f(co, n):
        t = max(0.0, min(1.0, (co.z - z0) / max(height, 1e-3)))
        t = t * t * (3 - 2 * t)
        g = 1.0 - strength * (1.0 - t)
        g *= 1.0 + variation * noise.noise(co * 0.7 + off)
        if top:
            zt, st = top
            if co.z > zt:
                g *= 1.0 - st
        return max(0.0, min(1.0, g))
    return colors(obj, f)


def flat_color(obj, value=1.0):
    return colors(obj, lambda co, n: value)


# --------------------------------------------------------------------------
# Extras for the game: colliders and anchors in glTF/three.js space.

def b2g(v):
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def collider_box(center, size, yaw=0.0, kind=None):
    """An oriented box. `center` and `size` (full extents) in BLENDER space,
    `yaw` in degrees about Blender Z (== three.js Y, same sign)."""
    c = {'type': 'box', 'c': b2g(center),
         'h': [round(size[0] / 2, 4), round(size[2] / 2, 4), round(size[1] / 2, 4)],
         'ry': round(math.radians(yaw), 5)}
    if kind:
        c['kind'] = kind
    return c


def collider_cyl(center_base, radius, height, kind=None):
    """A vertical cylinder whose base centre is `center_base` (Blender space)."""
    c = {'type': 'cyl', 'c': b2g(center_base), 'r': round(radius, 4), 'hgt': round(height, 4)}
    if kind:
        c['kind'] = kind
    return c


def set_colliders(obj, colliders):
    obj['colliders'] = json.dumps(colliders, separators=(',', ':'))
    return obj


def set_anchors(obj, anchors):
    """anchors: {name: (x, y, z) in Blender space} or (pos, yaw_degrees)."""
    out = {}
    for k, v in anchors.items():
        if len(v) == 2 and hasattr(v[0], '__len__'):
            out[k] = b2g(v[0]) + [round(math.radians(v[1]), 5)]
        else:
            out[k] = b2g(v)
    obj['anchors'] = json.dumps(out, separators=(',', ':'))
    return obj


def set_extra(obj, key, value):
    obj[key] = json.dumps(value, separators=(',', ':')) if isinstance(value, (dict, list)) else value
    return obj


def finalize(obj, name, uv=True, uv_scale=1.0, uv_seed=None, grime_height=0.8,
             grime_strength=0.35, shade='flat', angle=35, base_origin=True):
    """Apply transforms, put the origin at the base, UV in metres, grime, shading."""
    obj.name = name
    obj.data.name = name
    apply_transform(obj)
    if base_origin:
        to_base_origin(obj)
    if uv:
        uv_box(obj, uv_scale, uv_seed)
    if grime_strength is not None:
        grime(obj, grime_height, grime_strength)
    if shade == 'smooth':
        smooth(obj, angle)
    else:
        flat(obj)
    return obj


# --------------------------------------------------------------------------
# Export and previews

def export(objects, path, animations=False, images=False, quality=82):
    """Export exactly these objects (and their children) to a GLB."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
        for ch in o.children_recursive:
            ch.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_extras=True, export_yup=True, export_apply=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_image_format='WEBP' if images else 'NONE',
        export_image_quality=quality,
        export_cameras=False, export_lights=False,
        export_animations=animations, export_skins=True, export_morph=False,
        export_def_bones=animations, export_leaf_bone=False,
        export_animation_mode='ACTIONS', export_force_sampling=True,
        export_optimize_animation_size=False,
    )
    size = os.path.getsize(path)
    log(f'exported {os.path.relpath(path, ROOT)} ({size // 1024} KB, '
        f'{sum(tri_count(o) for o in objects if o.type == "MESH")} tris)')
    return path


def layout_row(objects, gap=1.5):
    """Spread objects along X for a group preview (Blender space)."""
    x = 0.0
    for o in objects:
        mn, mx = bounds(o)
        w = mx.x - mn.x
        o.location.x += x - mn.x
        x += w + gap
    return objects


def preview(objects, path, size=512, samples=24, elevation=22, azimuth=-35, light=1.0):
    """A quick Cycles still of the given objects (others hidden)."""
    scene = bpy.context.scene
    keep = set(objects)
    hidden = []
    for o in scene.objects:
        if o.type in ('MESH', 'ARMATURE', 'EMPTY') and o not in keep and o.parent not in keep:
            if not o.hide_render:
                o.hide_render = True
                hidden.append(o)
    pts = []
    for o in objects:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        deps = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        for v in deps.data.vertices:
            pts.append(mw @ v.co)
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (mn + mx) / 2
    radius = max((mx - mn).length / 2, 0.2)

    cam_data = bpy.data.cameras.new('preview_cam')
    cam_data.lens = 50
    cam = link(bpy.data.objects.new('preview_cam', cam_data))
    el, az = math.radians(elevation), math.radians(azimuth)
    dist = radius / math.sin(math.radians(19)) * 1.05
    cam.location = centre + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.new('preview_sun', 'SUN')
    sun_data.energy = 3.0 * light
    sun_data.angle = math.radians(8)
    sun = link(bpy.data.objects.new('preview_sun', sun_data))
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-40))

    floor = plane(radius * 8, radius * 8, loc=(centre.x, centre.y, mn.z - 0.001), mat='dirt', name='preview_floor')

    world = bpy.data.worlds.get('preview') or bpy.data.worlds.new('preview')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.35, 0.38, 0.42, 1)
    bg.inputs['Strength'].default_value = 0.8 * light
    scene.world = world

    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.cycles.samples = samples
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)

    delete(cam)
    delete(sun)
    delete(floor)
    for o in hidden:
        o.hide_render = False
    log('preview', os.path.relpath(path, ROOT))
    return path
