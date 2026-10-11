"""Meteora — preview stills of every exported GLB.

Imports each file from assets/models into an empty scene lit by one sun
(strength 4) over a dark world, frames its bounding sphere from a
three-quarter view and renders a 512 x 512 Eevee still to
tools/blender/previews/<name>.png, so a reviewer can see the models
without Blender. Asteroids show their lod0 node.

Set METEORA_PREVIEW_EXTRA=<dir> to also render front, side, top and rear
views (and asteroid lod1) into that directory for close inspection.
"""
import bpy, math, os, sys
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

SIZE = 512


def scene_for(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    world = bpy.data.worlds.new('space')
    world.color = (0.012, 0.013, 0.016)
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.012, 0.013, 0.016, 1)
        bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.data.angle = math.radians(0.6)
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 0.5
    fill.data.color = (0.6, 0.7, 1.0)
    scene.collection.objects.link(fill)
    bpy.ops.import_scene.gltf(filepath=path)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 70
    cam.data.clip_start = 0.05
    cam.data.clip_end = 10000
    scene.collection.objects.link(cam)
    scene.camera = cam
    return scene, cam


def bounds(objects):
    pts = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    radius = max((p - centre).length for p in pts) * 0.86
    return centre, radius


def shoot(scene, cam, centre, radius, direction, path, fill=1.0):
    direction = Vector(direction).normalized()
    # Key light from above and to the left of the camera, a faint cool
    # fill from the opposite side, both re-aimed for every view.
    key = Matrix.Rotation(math.radians(50), 3, 'Z') @ direction
    lift = Vector((0, 0, 0.8 if direction.z > -0.5 else -0.8))
    key = (key + lift if abs(direction.z) < 0.9 else key + Vector((0.6, -0.5, 0))).normalized()
    scene.objects['sun'].rotation_euler = (-key).to_track_quat('-Z', 'Y').to_euler()
    fill_dir = Vector((-key.x, -key.y, -0.3)).normalized()
    scene.objects['fill'].rotation_euler = (-fill_dir).to_track_quat('-Z', 'Y').to_euler()
    fov = cam.data.angle
    dist = radius / math.sin(fov / 2) * fill
    cam.location = centre + direction * dist
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = dist + radius * 4
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


VIEWS = {
    'front': (0.0, 1.0, 0.15), 'side': (1.0, 0.0, 0.1), 'top': (0.05, 0.02, 1.0),
    'rear': (-0.5, -1.0, 0.35), 'below': (0.6, 0.4, -0.8),
}


def render(name, extra=None):
    path = os.path.join(C.MODELS, name + '.glb')
    scene, cam = scene_for(path)
    meshes = [o for o in scene.objects if o.type == 'MESH']
    is_rock = name.startswith('asteroid')
    shown = [o for o in meshes if o.name != 'lod1'] if is_rock else meshes
    for o in meshes:
        o.hide_render = o not in shown
    centre, radius = bounds(shown)
    three_quarter = (1.0, 0.85, 0.5) if not is_rock else (0.9, 0.6, 0.45)
    shoot(scene, cam, centre, radius, three_quarter, os.path.join(C.PREVIEWS, name + '.png'),
          fill=1.0 if is_rock else 0.8)
    C.log('preview', name)
    if extra:
        for view, d in VIEWS.items():
            shoot(scene, cam, centre, radius, d, os.path.join(extra, f'{name}_{view}.png'))
        if not is_rock:
            ext = radius / 0.86 * 0.5
            for view, offset, d in (('close_nose', (0, 0.4, 0.05), (0.9, 1.0, 0.75)),
                                    ('close_tail', (0, -0.45, 0.0), (-0.8, -1.0, 0.6)),
                                    ('close_wing', (0.45, -0.05, 0.0), (0.6, 0.5, 1.0))):
                shoot(scene, cam, centre + Vector(offset) * ext * 2, radius * 0.38, d,
                      os.path.join(extra, f'{name}_{view}.png'))
        if is_rock:
            for o in meshes:
                o.hide_render = o.name != 'lod1'
            shoot(scene, cam, centre, radius, three_quarter, os.path.join(extra, f'{name}_lod1.png'))


def main(only=None):
    os.makedirs(C.PREVIEWS, exist_ok=True)
    extra = os.environ.get('METEORA_PREVIEW_EXTRA')
    if extra:
        os.makedirs(extra, exist_ok=True)
    names = sorted(f[:-4] for f in os.listdir(C.MODELS) if f.endswith('.glb'))
    for name in names:
        if only and name not in only:
            continue
        render(name, extra)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
