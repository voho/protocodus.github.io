"""A contact sheet for the props built in Blender: the finished nodes stood
in a row on a pale floor under a low sun, rendered with Cycles on the CPU.

EEVEE needs the GPU, which a sandboxed build cannot reach, and these sheets
are only ever made headless — so the preview path is Cycles, with the
denoiser carrying a modest sample count. Nothing here is exported: the
nodes are shown through linked duplicates in a collection of their own,
moved apart for the picture, so the exported originals keep the origin and
the empty transform the game's reader insists on.

    from sheet import render_sheet
    render_sheet([ob_a, ob_b], '/tmp/.../sheet.png')
"""

import math

import bpy
from mathutils import Vector


def _floor(col, size, colour):
    me = bpy.data.meshes.new('sheet_floor')
    s = size
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    mat = bpy.data.materials.get('sheet_floor') or bpy.data.materials.new('sheet_floor')
    if hasattr(mat, 'use_nodes'):
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = colour
        bsdf.inputs['Roughness'].default_value = 0.85
    me.materials.append(mat)
    ob = bpy.data.objects.new('sheet_floor', me)
    col.objects.link(ob)
    return ob


def _bounds(ob):
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return lo, hi


def render_sheet(items, path, res=(1600, 900), gap=0.6, yaw=-28.0, pitch=14.0, lens=50,
                 samples=96, background=(0.62, 0.64, 0.67), floor=(0.50, 0.52, 0.55, 1.0),
                 sun=(38.0, -35.0), materials=None, fill=1.08):
    """Lay `items` out left to right along Blender X, centred, and photograph
    them from `yaw` degrees round the front (−Y) and `pitch` degrees up.

    `items` is a list of objects, or of (object, {role: material}) pairs
    when one node is to be shown in more than one dress (a gate panel in
    the race red and in the blue). Returns the path written."""
    scene = bpy.context.scene
    col = bpy.data.collections.get('_sheet') or bpy.data.collections.new('_sheet')
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    for ob in list(col.objects):
        bpy.data.objects.remove(ob)
    hidden = []
    for ob in scene.objects:
        if ob.name not in col.objects and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)

    # lay the duplicates out by their own footprints
    shown = []
    widths = []
    for it in items:
        ob, dress = (it if isinstance(it, tuple) else (it, None))
        me = ob.data
        if dress:
            me = ob.data.copy()
            for i, m in enumerate(me.materials):
                if m and m.name in dress:
                    me.materials[i] = dress[m.name]
        dup = bpy.data.objects.new(ob.name + '.sheet', me)
        col.objects.link(dup)
        lo, hi = _bounds(ob)
        shown.append((dup, lo, hi))
        widths.append(hi.x - lo.x)
    total = sum(widths) + gap * (len(shown) - 1)
    x = -total / 2
    for (dup, lo, hi), w in zip(shown, widths):
        dup.location = (x - lo.x, 0, 0)
        x += w + gap
    bpy.context.view_layer.update()
    los, his = zip(*[_bounds(d) for d, _, _ in shown])
    lo = Vector((min(v.x for v in los), min(v.y for v in los), min(v.z for v in los)))
    hi = Vector((max(v.x for v in his), max(v.y for v in his), max(v.z for v in his)))
    centre = (lo + hi) / 2
    radius = (hi - lo).length / 2

    _floor(col, max(40.0, radius * 8), floor)

    sun_data = bpy.data.lights.get('sheet_sun') or bpy.data.lights.new('sheet_sun', 'SUN')
    sun_data.energy = 3.2
    sun_data.angle = math.radians(2.5)
    sun_ob = bpy.data.objects.new('sheet_sun', sun_data)
    col.objects.link(sun_ob)
    sun_ob.rotation_euler = (math.radians(90 - sun[0]), 0, math.radians(sun[1]))

    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    if hasattr(world, 'use_nodes'):
        world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = background + (1.0,)
    bg.inputs[1].default_value = 0.9

    cam_data = bpy.data.cameras.get('sheet_cam') or bpy.data.cameras.new('sheet_cam')
    cam_data.lens = lens
    cam = bpy.data.objects.new('sheet_cam', cam_data)
    col.objects.link(cam)
    a = math.radians(yaw)
    p = math.radians(pitch)
    d = Vector((math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), math.sin(p)))
    # far enough back that the whole row fits the frame's width and height
    half_w = (hi.x - lo.x) / 2 + 0.2
    half_h = (hi.z - lo.z) / 2 + 0.2
    fov_x = 2 * math.atan(36 / 2 / lens)
    fov_y = 2 * math.atan(36 * res[1] / res[0] / 2 / lens)
    dist = max(half_w / math.tan(fov_x / 2), half_h / math.tan(fov_y / 2)) / fill + (hi.y - lo.y) * 0.5
    cam.location = centre + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam

    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 32
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

    for ob in list(col.objects):
        bpy.data.objects.remove(ob)
    for ob in hidden:
        ob.hide_render = False
    return path
