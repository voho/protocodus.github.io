"""Hedgerow — realistic PBR bakes (models v2).

A model built with kit.py (palette-keyed materials, box UVs in metres
`UVMap`, origin at its base) goes through `bake_model()`:

1. a fresh atlas unwrap into a `bake` UV layer (smart project + pack);
2. ambient occlusion baked from the model itself and a ground plane under
   it (contact darkening) — the AO image;
3. an edge mask: how far the Cycles Bevel normal leans from the true normal,
   i.e. where edges are — the EDGE image (paint chips, worn edges, dust);
4. every palette material replaced by its procedural surface from
   `surfaces.py` (stone courses, mortar, peeling paint, rust, burlap, wool,
   bark, moss, grime, rain streaks...), which reads the AO and EDGE images;
5. base colour, roughness, metallic and emission baked through an emission
   override (noise-free, one sample), the tangent-space normal baked from the
   surfaces' bump plus rounded bevelled edges;
6. one Principled material wired to the images (base colour, normal, packed
   metallic-roughness, optional emissive); the `bake` UVs become `UVMap` so
   they export as TEXCOORD_0.

Export with `kit.export(..., images=True)` (WebP inside the GLB).

    bake.bake_model(obj, tpm=110)          # texels per metre
    bake.bake_model(obj, size=1024)        # or a fixed size

Set HEDGEROW_FAST=1 for quick iterations (small images, few samples).
Deterministic: fixed seeds; Cycles seed fixed by kit.reset().
"""
import bpy, bmesh, math, os, time
import numpy as np
from mathutils import Vector

import kit

FAST = bool(os.environ.get('HEDGEROW_FAST'))


# --------------------------------------------------------------------------
# A small shader-graph builder (after fun/meteora/tools/blender/common.py)

class Graph:
    """Helpers over a material node tree. Inputs may be numbers, colours,
    sockets or nodes; every helper returns an output socket."""

    def __init__(self, mat, clear=True):
        self.mat = mat
        mat.use_nodes = True
        self.nt = mat.node_tree
        if clear:
            for n in list(self.nt.nodes):
                self.nt.nodes.remove(n)
        self.output = next((n for n in self.nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial'), None) \
            or self.nt.nodes.new('ShaderNodeOutputMaterial')

    def feed(self, sock, val):
        if val is None:
            return
        if isinstance(val, bpy.types.Node):
            val = val.outputs[0]
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, sock)
            return
        dv = sock.default_value
        if isinstance(val, (int, float)) and hasattr(dv, '__len__'):
            val = [val] * len(dv)
            if len(dv) == 4:
                val[3] = 1.0
        elif hasattr(dv, '__len__') and len(dv) == 4 and len(val) == 3:
            val = list(val) + [1.0]
        sock.default_value = val

    def node(self, kind, inputs=None, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        if inputs:
            items = inputs.items() if isinstance(inputs, dict) else enumerate(inputs)
            for key, val in items:
                self.feed(n.inputs[key], val)
        return n

    # inputs
    def coord(self, kind='Object'):
        return self.node('ShaderNodeTexCoord').outputs[kind]

    def uvmap(self, name):
        return self.node('ShaderNodeUVMap', uv_map=name).outputs['UV']

    def geometry(self, kind):
        return self.node('ShaderNodeNewGeometry').outputs[kind]

    def attribute(self, name, kind='Fac'):
        n = self.node('ShaderNodeAttribute', attribute_name=name)
        return n.outputs[kind]

    def image(self, img, uv='bake', out='Color'):
        n = self.node('ShaderNodeTexImage', image=img, interpolation='Linear')
        self.nt.links.new(self.uvmap(uv), n.inputs['Vector'])
        return n.outputs[out]

    # arithmetic
    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        self.feed(n.inputs[1], b)
        self.feed(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b, clamp=False): return self.math('ADD', a, b, clamp=clamp)
    def sub(self, a, b, clamp=False): return self.math('SUBTRACT', a, b, clamp=clamp)
    def mul(self, a, b, clamp=False): return self.math('MULTIPLY', a, b, clamp=clamp)
    def madd(self, a, b, c, clamp=False): return self.math('MULTIPLY_ADD', a, b, c, clamp=clamp)
    def maximum(self, a, b): return self.math('MAXIMUM', a, b)
    def minimum(self, a, b): return self.math('MINIMUM', a, b)
    def power(self, a, b): return self.math('POWER', a, b)
    def absolute(self, a): return self.math('ABSOLUTE', a)
    def sin(self, a): return self.math('SINE', a)
    def fract(self, a): return self.math('FRACT', a)
    def floor(self, a): return self.math('FLOOR', a)
    def one_minus(self, a): return self.math('SUBTRACT', 1.0, a)

    def vmath(self, op, a, b=None, scale=None, out=0):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self.feed(n.inputs[0], a)
        self.feed(n.inputs[1], b)
        if scale is not None:
            self.feed(n.inputs['Scale'], scale)
        return n.outputs[out]

    def vscale(self, v, s):
        """Component-wise scale: s is a number or an (x, y, z) tuple."""
        if isinstance(s, (int, float)):
            return self.vmath('SCALE', v, scale=s)
        return self.vmath('MULTIPLY', v, tuple(s))

    def vadd(self, v, o):
        return self.vmath('ADD', v, tuple(o) if not isinstance(o, bpy.types.NodeSocket) else o)

    def sep(self, v):
        n = self.node('ShaderNodeSeparateXYZ', [v])
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def combine(self, x, y, z):
        return self.node('ShaderNodeCombineXYZ', [x, y, z]).outputs[0]

    def map_range(self, x, a, b, c=0.0, d=1.0, interp='LINEAR', clamp=True):
        n = self.node('ShaderNodeMapRange', interpolation_type=interp, clamp=clamp)
        for i, v in enumerate((x, a, b, c, d)):
            self.feed(n.inputs[i], v)
        return n.outputs[0]

    def smooth(self, x, a, b):
        return self.map_range(x, a, b, 0.0, 1.0, interp='SMOOTHSTEP')

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_factor=True)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[6], a)
        self.feed(n.inputs[7], b)
        return n.outputs[2]

    def mixf(self, fac, a, b):
        n = self.node('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[2], a)
        self.feed(n.inputs[3], b)
        return n.outputs[0]

    def cmul(self, a, b):
        return self.mix(1.0, a, b, blend='MULTIPLY')

    def ramp(self, fac, stops, interp='LINEAR'):
        n = self.node('ShaderNodeValToRGB')
        self.feed(n.inputs[0], fac)
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > len(stops):
            cr.elements.remove(cr.elements[-1])
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = tuple(col) + ((1.0,) if len(col) == 3 else ())
        return n.outputs[0]

    def hsv(self, col, h=0.5, s=1.0, v=1.0):
        return self.node('ShaderNodeHueSaturation', {'Hue': h, 'Saturation': s, 'Value': v, 'Fac': 1.0, 'Color': col}).outputs[0]

    # textures
    def noise(self, vec, scale, detail=4.0, rough=0.5, distortion=0.0, kind='FBM', lac=2.0, out='Fac'):
        n = self.node('ShaderNodeTexNoise', noise_type=kind, noise_dimensions='3D')
        self.feed(n.inputs['Vector'], vec)
        for k, v in (('Scale', scale), ('Detail', detail), ('Roughness', rough),
                     ('Lacunarity', lac), ('Distortion', distortion)):
            self.feed(n.inputs[k], v)
        return n.outputs['Fac' if out in ('Fac', 'Factor') else out]

    def voronoi(self, vec, scale, feature='F1', rand=1.0, out='Distance', smooth=0.0, dims='3D', metric='EUCLIDEAN'):
        n = self.node('ShaderNodeTexVoronoi', feature=feature, voronoi_dimensions=dims, distance=metric)
        self.feed(n.inputs['Vector'], vec)
        self.feed(n.inputs['Scale'], scale)
        self.feed(n.inputs['Randomness'], rand)
        if feature == 'SMOOTH_F1':
            self.feed(n.inputs['Smoothness'], smooth)
        return n.outputs[out]

    def voronoi_edge(self, vec, scale, rand=1.0, dims='3D'):
        """Distance to the nearest cell border (0 on the border)."""
        return self.voronoi(vec, scale, feature='DISTANCE_TO_EDGE', rand=rand, dims=dims)

    def brick(self, vec, scale, mortar, width=0.5, height=0.25, bias=0.0, smooth=0.1, offset=0.5, out='Fac'):
        n = self.node('ShaderNodeTexBrick', offset=offset, squash=1.0)
        self.feed(n.inputs['Vector'], vec)
        for k, v in (('Scale', scale), ('Mortar Size', mortar), ('Mortar Smooth', smooth),
                     ('Bias', bias), ('Brick Width', width), ('Row Height', height)):
            self.feed(n.inputs[k], v)
        n.inputs['Color1'].default_value = (1, 1, 1, 1)
        n.inputs['Color2'].default_value = (0, 0, 0, 1)
        return n.outputs[out]

    def wave(self, vec, scale, kind='BANDS', direction='X', distortion=0.0, detail=2.0, profile='SIN'):
        n = self.node('ShaderNodeTexWave', wave_type=kind, bands_direction=direction, wave_profile=profile)
        self.feed(n.inputs['Vector'], vec)
        self.feed(n.inputs['Scale'], scale)
        self.feed(n.inputs['Distortion'], distortion)
        self.feed(n.inputs['Detail'], detail)
        return n.outputs['Fac']

    def bump(self, height, strength=1.0, distance=0.02, normal=None):
        n = self.node('ShaderNodeBump')
        self.feed(n.inputs['Height'], height)
        self.feed(n.inputs['Strength'], strength)
        self.feed(n.inputs['Distance'], distance)
        self.feed(n.inputs['Normal'], normal)
        return n.outputs[0]

    def bevel(self, radius, samples=8):
        n = self.node('ShaderNodeBevel', samples=samples)
        n.inputs['Radius'].default_value = radius
        return n.outputs[0]

    def emission(self, col):
        n = self.node('ShaderNodeEmission')
        self.feed(n.inputs['Color'], col)
        n.inputs['Strength'].default_value = 1.0
        self.nt.links.new(n.outputs[0], self.output.inputs['Surface'])
        return n

    def principled(self, albedo, rough, metal, normal=None, glow=None, alpha=None):
        n = self.node('ShaderNodeBsdfPrincipled')
        self.feed(n.inputs['Base Color'], albedo)
        self.feed(n.inputs['Roughness'], rough)
        self.feed(n.inputs['Metallic'], metal)
        self.feed(n.inputs['Normal'], normal)
        if glow is not None:
            self.feed(n.inputs['Emission Color'], glow)
            self.feed(n.inputs['Emission Strength'], 1.0)
        if alpha is not None:
            self.feed(n.inputs['Alpha'], alpha)
        self.nt.links.new(n.outputs[0], self.output.inputs['Surface'])
        return n


# --------------------------------------------------------------------------
# Images

def new_image(name, size, non_color=False, alpha=False):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def pixels(img):
    a = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def set_pixels(img, arr):
    img.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    img.update()
    img.pack()


def blur_image(img, r=1):
    a = pixels(img)
    out = a.copy()
    acc = np.zeros_like(a)
    n = 0
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            acc += np.roll(np.roll(a, dy, 0), dx, 1)
            n += 1
    out[..., :3] = acc[..., :3] / n
    set_pixels(img, out)
    return img


# --------------------------------------------------------------------------
# UVs

def unwrap(obj, margin=0.004, angle=62.0, shape='AABB', scale_islands=None):
    """A fresh atlas unwrap into a `bake` UV layer (kept beside `UVMap`).
    Packs by bounding box: Blender 5.3's CONCAVE/CONVEX packing can take
    minutes on meshes with many small islands. `scale_islands(obj)` may grow
    islands that need more texels (a face, hands) before the pack."""
    me = obj.data
    if 'bake' in me.uv_layers:
        me.uv_layers.remove(me.uv_layers['bake'])
    lay = me.uv_layers.new(name='bake')
    me.uv_layers.active = lay
    kit.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    if scale_islands:
        bpy.ops.object.mode_set(mode='OBJECT')
        scale_islands(obj)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method=shape,
                                margin_method='FRACTION', margin=margin)
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    return lay


def finish_uvs(obj):
    """After baking: the atlas becomes the only UV layer, named UVMap."""
    me = obj.data
    for lay in list(me.uv_layers):
        if lay.name != 'bake':
            me.uv_layers.remove(lay)
    me.uv_layers['bake'].name = 'UVMap'
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True
    for mat in me.materials:
        if not mat or not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if getattr(n, 'uv_map', None) == 'bake':
                n.uv_map = 'UVMap'


# --------------------------------------------------------------------------
# Baking

def _isolate(objs):
    """Hide every other renderable object while baking these."""
    keep = set(objs)
    hidden = []
    for o in bpy.context.scene.objects:
        if o in keep or o.type not in ('MESH', 'CURVE'):
            continue
        if not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    return hidden


def _restore(hidden):
    for o in hidden:
        o.hide_render = False


def _bake(obj, image, kind, samples, margin=6):
    """Bake into `image` with every material of `obj` holding it as the
    active image node."""
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.bake.margin = margin
    scene.render.bake.margin_type = 'EXTEND'
    scene.render.bake.use_clear = True
    scene.render.bake.normal_space = 'TANGENT'
    scene.render.bake.target = 'IMAGE_TEXTURES'
    added = []
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None:
            continue
        nt = mat.node_tree
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.uv_map = 'bake'
        nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        nt.nodes.active = tex
        tex.select = True
        added.append((nt, tex, uvn))
    kit.activate(obj)
    obj.data.uv_layers.active = obj.data.uv_layers['bake']
    if kind == 'AO':
        bpy.ops.object.bake(type='AO', margin=margin, use_clear=True)
    elif kind == 'NORMAL':
        bpy.ops.object.bake(type='NORMAL', margin=margin, use_clear=True, normal_space='TANGENT')
    else:
        bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True)
    for nt, tex, uvn in added:
        nt.nodes.remove(tex)
        nt.nodes.remove(uvn)
    image.pack()


def _flat_override(obj, build):
    """Temporarily give every slot an emission material built by
    `build(graph)`; returns a restore function."""
    originals = [s.material for s in obj.material_slots]
    tmp = bpy.data.materials.new(obj.name + '_tmp')
    g = Graph(tmp)
    build(g)
    for s in obj.material_slots:
        s.material = tmp

    def restore():
        for s, m in zip(obj.material_slots, originals):
            s.material = m
        bpy.data.materials.remove(tmp)
    return restore


def size_for(obj, tpm, lo=256, hi=2048):
    area = sum(p.area for p in obj.data.polygons)
    side = math.sqrt(max(area, 1e-4) * 0.62) * tpm     # ~62% of the atlas is used
    size = 2 ** int(round(math.log2(max(side, lo))))
    return int(max(lo, min(hi, size)))


def _split_kept(obj, keep):
    """Move the faces whose material is in `keep` into their own object."""
    idx = [i for i, s in enumerate(obj.material_slots) if s.material and s.material.name.split('.')[0] in keep]
    if not idx:
        return None
    kit.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    for i in idx:
        obj.active_material_index = i
        bpy.ops.object.material_slot_select()
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    kept = [o for o in bpy.context.selected_objects if o is not obj]
    # drop empty slots on both
    for o in [obj] + kept:
        kit.activate(o)
        bpy.ops.object.material_slot_remove_unused()
    return kept[0] if kept else None


def bake_model(obj, tpm=110, size=None, ao_distance=0.6, ground=True, bevel=0.012,
               normal_size=None, emissive=True, seed=None, keep=(), scale_islands=None,
               samples_ao=32, samples_edge=12, samples_normal=8, samples_channels=1):
    """Turn a palette-material model into a textured PBR model in place.
    `samples_channels` > 1 anti-aliases the colour, roughness and metal bakes
    (fine lines thinner than a texel otherwise break into dashes).
    Faces whose material is listed in `keep` (alpha-card foliage, ...) are
    left exactly as they are and joined back afterwards. Returns a dict of
    the images."""
    import surfaces
    t0 = time.time()
    kept = _split_kept(obj, set(keep)) if keep else None
    if size is None:
        size = size_for(obj, tpm)
    if FAST:
        size = min(size, 256)
        samples_ao, samples_edge, samples_normal, samples_channels = 4, 2, 1, 1
    elif size <= 512:            # small atlases converge with far fewer samples
        samples_ao, samples_edge, samples_normal = min(samples_ao, 10), min(samples_edge, 5), min(samples_normal, 3)
    elif size <= 1024:
        samples_ao, samples_edge, samples_normal = min(samples_ao, 20), min(samples_edge, 8), min(samples_normal, 5)
    nsize = normal_size or (size if size <= 1024 else size // 2)
    name = obj.name
    keys = [(s.material.name if s.material else 'stone') for s in obj.material_slots]
    keys = [k.split('.')[0] for k in keys]
    if not obj.data.uv_layers.get('UVMap'):
        kit.uv_box(obj)
        obj.data.uv_layers[-1].name = 'UVMap'
    unwrap(obj, scale_islands=scale_islands)

    hidden = _isolate([obj])
    plane = None
    if ground:
        mn, mx = kit.bounds(obj)
        span = max(mx.x - mn.x, mx.y - mn.y) * 2 + 4
        plane = kit.plane(span, span, loc=((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z + 0.002), mat='dirt', name=name + '_ground')
        if mn.z < -0.05:       # sunk rocks: the ground at z = 0
            plane.location.z = 0.0
    world = bpy.context.scene.world or bpy.data.worlds.new('bake_world')
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    bpy.context.scene.world.light_settings.distance = ao_distance

    # 2. ambient occlusion
    ao = new_image(name + '_ao', size, non_color=True)
    restore = _flat_override(obj, lambda g: g.emission((1, 1, 1)))
    _bake(obj, ao, 'AO', samples_ao)
    restore()
    if plane:
        kit.delete(plane)
    # 3. edge mask from the bevel normal
    edge = new_image(name + '_edge', size, non_color=True)

    def edge_graph(g):
        bev = g.bevel(bevel * 2.5, samples=8)
        n = g.geometry('Normal')
        d = g.vmath('DOT_PRODUCT', bev, n, out=1)
        e = g.map_range(d, 0.995, 0.75, 0.0, 1.0)
        g.emission(g.combine(e, e, e))
    restore = _flat_override(obj, edge_graph)
    _bake(obj, edge, 'EMIT', samples_edge)
    restore()
    blur_image(edge, 1)

    # 4. procedural surfaces
    rnd_seed = seed if seed is not None else (sum(ord(c) for c in name) % 997)
    mats = []
    for k in keys:
        mats.append(surfaces.surface_material(k, ao, edge, seed=rnd_seed, bevel=bevel))
    for slot, m in zip(obj.material_slots, mats):
        slot.material = m

    # 5. channels
    base = new_image(name + '_base', size)
    rough = new_image(name + '_rough', size, non_color=True)
    metal = new_image(name + '_metal', size, non_color=True)
    normal = new_image(name + '_normal', nsize, non_color=True)
    has_glow = emissive and any(surfaces._ROUTES[m.name]['ch'].get('glow') is not None for m in mats)
    glow = new_image(name + '_glow', max(256, size // 2)) if has_glow else None

    for img, ch in ((base, 'albedo'), (rough, 'rough'), (metal, 'metal')) + (((glow, 'glow'),) if glow else ()):
        surfaces.route(mats, ch)
        _bake(obj, img, 'EMIT', samples_channels)
    surfaces.route(mats, None)
    _bake(obj, normal, 'NORMAL', samples_normal)

    # 6. the final material
    mr = new_image(name + '_mr', size, non_color=True)
    r, m = pixels(rough), pixels(metal)
    out = np.ones_like(r)
    out[..., 1] = r[..., 0]
    out[..., 2] = m[..., 0]
    set_pixels(mr, out)
    for img in (base, normal):
        img.pack()
    final = baked_material(name, base, normal, mr, glow)
    obj.data.materials.clear()
    obj.data.materials.append(final)
    for p in obj.data.polygons:
        p.material_index = 0
    finish_uvs(obj)
    # vertex colours are now in the textures
    kit.flat_color(obj, 1.0)
    for m_ in mats:
        bpy.data.materials.remove(m_)
    for img in (rough, metal):
        bpy.data.images.remove(img)
    _restore(hidden)
    if kept is not None:
        if 'UVMap' not in kept.data.uv_layers and kept.data.uv_layers:
            kept.data.uv_layers[0].name = 'UVMap'
        for lay in list(kept.data.uv_layers):
            if lay.name != 'UVMap':
                kept.data.uv_layers.remove(lay)
        joined = kit.join([obj, kept], name)
        obj = joined
    kit.log(f'baked {name}: {size}px ({nsize}px normal){" +glow" if glow else ""} in {time.time() - t0:.1f}s')
    return {'base': base, 'normal': normal, 'mr': mr, 'glow': glow, 'ao': ao, 'edge': edge, 'object': obj}


def baked_material(name, base, normal, mr, emissive=None, alpha=False):
    """Principled material wired to baked images (what the glTF exporter reads)."""
    mat = bpy.data.materials.new(name)
    g = Graph(mat)
    tb = g.node('ShaderNodeTexImage', image=base)
    g.nt.links.new(g.uvmap('bake'), tb.inputs['Vector'])
    tn = g.node('ShaderNodeTexImage', image=normal)
    g.nt.links.new(g.uvmap('bake'), tn.inputs['Vector'])
    tm = g.node('ShaderNodeTexImage', image=mr)
    g.nt.links.new(g.uvmap('bake'), tm.inputs['Vector'])
    nm = g.node('ShaderNodeNormalMap', space='TANGENT', uv_map='bake')
    g.nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    sep = g.node('ShaderNodeSeparateColor')
    g.nt.links.new(tm.outputs['Color'], sep.inputs['Color'])
    bsdf = g.principled(tb.outputs['Color'], sep.outputs['Green'], sep.outputs['Blue'], nm.outputs[0],
                        alpha=tb.outputs['Alpha'] if alpha else None)
    if emissive is not None:
        te = g.node('ShaderNodeTexImage', image=emissive)
        g.nt.links.new(g.uvmap('bake'), te.inputs['Vector'])
        g.feed(bsdf.inputs['Emission Color'], te.outputs['Color'])
        g.feed(bsdf.inputs['Emission Strength'], 1.0)
    if alpha:
        mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else None
    return mat
