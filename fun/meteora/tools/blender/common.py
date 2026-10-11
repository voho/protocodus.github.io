"""Meteora — shared Blender helpers.

Scene reset, a small shader-graph builder, UV unwrapping, Cycles bake
helpers (normal and per-channel emission bakes), channel packing and GLB
export. Every build script imports this module and stays deterministic:
no clock, no unseeded randomness.

glTF cannot carry procedural nodes, so each model is shaded with a
procedural "source" material whose channels (albedo, roughness, metallic,
glow) are registered with `channels()`. `bake()` then routes one channel
at a time through an Emission shader and bakes the EMIT pass, which is
noise-free and exact, while normals use Cycles' NORMAL pass. The result
is wired into a plain Principled material by `baked_material()`, which is
what the glTF exporter understands.
"""
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))       # fun/meteora
MODELS = os.path.join(ROOT, 'assets', 'models')
PREVIEWS = os.path.join(HERE, 'previews')
JS = os.path.join(ROOT, 'js')


def log(*parts):
    print('[meteora]', *parts, flush=True)


def reset(samples=16):
    CHANNELS.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.seed = 7
    return scene


# --------------------------------------------------------------------------
# Objects and meshes

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def object_from_bmesh(name, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    return link(bpy.data.objects.new(name, me))


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


def duplicate(obj, name):
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = name
    copy.data.name = name
    return link(copy)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def join(objects, name):
    activate(objects[0], objects)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def triangulate(obj):
    mod = obj.modifiers.new('tri', 'TRIANGULATE')
    mod.quad_method = 'BEAUTY'
    apply_modifiers(obj)


# --------------------------------------------------------------------------
# Shader graphs

class Graph:
    """A thin builder over a material node tree. Every helper accepts plain
    numbers, colours, sockets or nodes as inputs and returns an output
    socket, so graphs read like arithmetic."""

    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)
        self.output = self.nt.nodes.new('ShaderNodeOutputMaterial')

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

    def geometry(self, kind):
        return self.node('ShaderNodeNewGeometry').outputs[kind]

    def attribute(self, name, kind='Factor'):
        return self.node('ShaderNodeAttribute', attribute_name=name).outputs[kind]

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

    def vmath(self, op, a, b=None, scale=None, out=0):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self.feed(n.inputs[0], a)
        self.feed(n.inputs[1], b)
        if scale is not None:
            self.feed(n.inputs['Scale'], scale)
        return n.outputs[out]

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

    # textures
    def noise(self, vec, scale, detail=4.0, rough=0.5, distortion=0.0, kind='FBM', lac=2.0, out='Factor'):
        n = self.node('ShaderNodeTexNoise', noise_type=kind, noise_dimensions='3D')
        self.feed(n.inputs['Vector'], vec)
        for k, v in (('Scale', scale), ('Detail', detail), ('Roughness', rough),
                     ('Lacunarity', lac), ('Distortion', distortion)):
            self.feed(n.inputs[k], v)
        return n.outputs[out]

    def voronoi(self, vec, scale, feature='F1', rand=1.0, out='Distance', smooth=0.0, detail=0.0):
        n = self.node('ShaderNodeTexVoronoi', feature=feature, voronoi_dimensions='3D')
        self.feed(n.inputs['Vector'], vec)
        self.feed(n.inputs['Scale'], scale)
        self.feed(n.inputs['Randomness'], rand)
        if feature == 'SMOOTH_F1':
            self.feed(n.inputs['Smoothness'], smooth)
        self.feed(n.inputs['Detail'], detail)
        return n.outputs[out]

    def brick(self, vec, scale, mortar, width=0.5, height=0.25, bias=0.0, smooth=0.1, out='Factor'):
        n = self.node('ShaderNodeTexBrick', offset=0.5, squash=1.0)
        self.feed(n.inputs['Vector'], vec)
        for k, v in (('Scale', scale), ('Mortar Size', mortar), ('Mortar Smooth', smooth),
                     ('Bias', bias), ('Brick Width', width), ('Row Height', height)):
            self.feed(n.inputs[k], v)
        return n.outputs[out]

    def bump(self, height, strength=1.0, distance=0.05, normal=None):
        n = self.node('ShaderNodeBump')
        self.feed(n.inputs['Height'], height)
        self.feed(n.inputs['Strength'], strength)
        self.feed(n.inputs['Distance'], distance)
        self.feed(n.inputs['Normal'], normal)
        return n.outputs[0]

    def principled(self, albedo, rough, metal, normal=None, glow=None):
        n = self.node('ShaderNodeBsdfPrincipled')
        self.feed(n.inputs['Base Color'], albedo)
        self.feed(n.inputs['Roughness'], rough)
        self.feed(n.inputs['Metallic'], metal)
        self.feed(n.inputs['Normal'], normal)
        if glow is not None:
            self.feed(n.inputs['Emission Color'], glow)
            self.feed(n.inputs['Emission Strength'], 1.0)
        self.nt.links.new(n.outputs[0], self.output.inputs['Surface'])
        return n


# Channel registry: material name -> {'albedo'|'rough'|'metal'|'glow': socket or value}
CHANNELS = {}


def source_material(name, build):
    """Create a procedural source material. `build(g)` gets a Graph and
    returns a dict with albedo, rough, metal, optional glow and normal."""
    mat = bpy.data.materials.new(name)
    g = Graph(mat)
    ch = build(g)
    g.principled(ch['albedo'], ch['rough'], ch['metal'], ch.get('normal'), ch.get('glow'))
    CHANNELS[mat.name] = ch
    return mat


# --------------------------------------------------------------------------
# UVs, images and baking

def smart_uv(obj, angle=66.0, margin=0.004):
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin,
                             area_weight=0.6, correct_aspect=True)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method='CONCAVE',
                            margin_method='FRACTION', margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def new_image(name, size, non_color=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def placeholder_material(obj):
    """Bake targets need a material slot to hold the active image node."""
    mat = bpy.data.materials.new(obj.name + '_bake')
    Graph(mat).principled((0.5, 0.5, 0.5), 0.5, 0.0)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat


def _channel_value(ch, key):
    if key in ch and ch[key] is not None:
        return ch[key]
    return {'albedo': (0.5, 0.5, 0.5), 'rough': 0.5, 'metal': 0.0, 'glow': (0, 0, 0)}[key]


def bake(target, image, kind='NORMAL', channel=None, sources=(), extrusion=0.0,
         max_ray=0.0, margin=8, samples=None):
    """Bake into `image` on `target`. kind 'NORMAL' bakes the tangent-space
    shading normal; channel='albedo'|'rough'|'metal'|'glow' bakes that
    channel of the source materials through an emission override. With
    `sources`, bakes selected-to-active from those objects."""
    scene = bpy.context.scene
    if samples is not None:
        scene.cycles.samples = samples
    shaders = list(sources) or [target]
    added, restore = [], []
    for slot in target.material_slots:
        if slot.material is None:
            continue
        nt = slot.material.node_tree
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        nt.nodes.active = tex
        added.append((nt, tex))
    if channel:
        seen = set()
        for obj in shaders:
            for slot in obj.material_slots:
                mat = slot.material
                if mat is None or mat.name in seen:
                    continue
                seen.add(mat.name)
                nt = mat.node_tree
                out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
                old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
                em = nt.nodes.new('ShaderNodeEmission')
                val = _channel_value(CHANNELS.get(mat.name, {}), channel)
                if isinstance(val, bpy.types.NodeSocket):
                    nt.links.new(val, em.inputs['Color'])
                else:
                    em.inputs['Color'].default_value = (tuple(val) + (1.0,)) if hasattr(val, '__len__') \
                        else (val, val, val, 1.0)
                em.inputs['Strength'].default_value = 1.0
                nt.links.new(em.outputs[0], out.inputs['Surface'])
                restore.append((nt, out, old, em))
    activate(target, sources)
    bpy.ops.object.bake(type='EMIT' if channel else kind, margin=margin, margin_type='EXTEND',
                        use_selected_to_active=bool(sources), cage_extrusion=extrusion,
                        max_ray_distance=max_ray, use_clear=True, target='IMAGE_TEXTURES')
    for nt, out, old, em in restore:
        nt.nodes.remove(em)
        if old is not None:
            nt.links.new(old, out.inputs['Surface'])
    for nt, tex in added:
        nt.nodes.remove(tex)


def pixels(img):
    a = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def set_pixels(img, arr):
    img.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    img.update()


def pack_mr(name, rough, metal=None):
    """glTF metallic-roughness: G = roughness, B = metallic (R unused, 1)."""
    size = rough.size[0]
    img = new_image(name, size, non_color=True)
    r = pixels(rough)
    out = np.ones_like(r)
    out[..., 1] = r[..., 0]
    out[..., 2] = pixels(metal)[..., 0] if metal is not None else 0.0
    set_pixels(img, out)
    return img


def baked_material(name, base, normal, mr, emissive=None, uv='UVMap'):
    """Principled material wired to the baked images (what the glTF
    exporter reads): base colour, tangent-space normal map, packed
    metallic-roughness and an optional emissive map."""
    mat = bpy.data.materials.new(name)
    g = Graph(mat)
    tb = g.node('ShaderNodeTexImage', image=base)
    tn = g.node('ShaderNodeTexImage', image=normal)
    tm = g.node('ShaderNodeTexImage', image=mr)
    nm = g.node('ShaderNodeNormalMap', [1.0, tn.outputs['Color']], space='TANGENT', uv_map=uv)
    sep = g.node('ShaderNodeSeparateColor', [tm.outputs['Color']])
    bsdf = g.principled(tb.outputs['Color'], sep.outputs['Green'], sep.outputs['Blue'], nm.outputs[0])
    if emissive is not None:
        te = g.node('ShaderNodeTexImage', image=emissive)
        g.feed(bsdf.inputs['Emission Color'], te.outputs['Color'])
        g.feed(bsdf.inputs['Emission Strength'], 1.0)
    return mat


def flat_material(name, color, rough, metal, emission=None, strength=1.0, alpha=1.0):
    """An untextured Principled material (glTF factors only)."""
    mat = bpy.data.materials.new(name)
    g = Graph(mat)
    bsdf = g.principled(color, rough, metal, None, emission)
    if emission is not None:
        g.feed(bsdf.inputs['Emission Strength'], strength)
    if alpha < 1.0:
        g.feed(bsdf.inputs['Alpha'], alpha)
    return mat


# --------------------------------------------------------------------------
# Export

def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_image_format='WEBP',
        export_image_quality=82, export_extras=False, export_cameras=False,
        export_lights=False, export_tangents=True, export_animations=False,
        export_vertex_color='NONE')
    log('wrote', os.path.relpath(path, ROOT), f'{os.path.getsize(path) / 1024:.0f} KB')


def to_gltf(v):
    """Blender (x, y, z) -> glTF (x, z, -y) for the +Y-up export."""
    return (v[0], v[2], -v[1])
