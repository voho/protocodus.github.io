"""Hedgerow — build the `soldier` set: soldier.glb (rig, allied/axis outfits,
weapon sockets, 16 clips) and weapons.glb (7 weapons), previews and notes.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python fun/hedgerow/tools/blender/build_soldier.py [-- options]

Options after `--`:
    soldier | weapons      build only that GLB (default: both)
    nopreview              skip the preview renders
    quick                  previews only for a few poses (iteration)
    save                   also save the scene to $TMPDIR/hedgerow_soldier.blend
    notes                  only regenerate notes/soldier.md from the last build's summary

v2: the outfits and weapons are baked (bake.py + surfaces.py, extra recipes
registered by soldier_parts.register_surfaces) and exported with WebP
textures. A full build with bakes and previews takes ~18 min on CPU;
HEDGEROW_FAST=1 gives tiny bakes for iteration.
"""
import bpy, json, math, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit                     # noqa: E402
import soldier_parts as sp     # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

V = Vector
PREV = os.path.join(kit.PREVIEWS, 'soldier')
NOTES = os.path.join(kit.HERE, 'notes', 'soldier.md')
FPS = 30
OUTFIT_TEX = 2048
LOD_TRIS = 5800                 # v4.2: the distance LOD per outfit (allied_lod, axis_lod)
# texel density per UV island: the face, eyes and hands up, hidden scalp down (soldier_parts.UV_BOOST4)
UV_BOOST = sp.UV_BOOST4
CLIP_ORDER = ['idle', 'walk', 'walk_back', 'strafe_l', 'strafe_r', 'run', 'crouch_idle', 'crouch_walk',
              'aim', 'crouch_aim', 'reload', 'reload_smg', 'throw', 'hit', 'death_fwd', 'death_back',
              'death_crumple']
LOOPS = {'idle', 'walk', 'walk_back', 'strafe_l', 'strafe_r', 'run', 'crouch_idle', 'crouch_walk',
         'aim', 'crouch_aim'}
DEATHS = ('death_fwd', 'death_back', 'death_crumple')


def make_socket(rig, name, bone, world):
    e = kit.link(bpy.data.objects.new(name, None))
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = 0.08
    e.parent = rig
    e.parent_type = 'BONE'
    e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = world
    bpy.context.view_layer.update()
    return e


def set_action(rig, act):
    rig.animation_data.action = act
    if act is not None and act.slots and rig.animation_data.action_slot is None:
        rig.animation_data.action_slot = act.slots[0]


def mesh_min_z(objs):
    import numpy as np
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get('co', co)
        ev.to_mesh_clear()
        out.append(float(co[2::3].min()))
    return out


def write_clip(rig, sk, clips, name, frames):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    B = [sp.bases(sk, clips.solve(P).M) for P in frames]
    return sp.write_action(rig, name, B)


def ground_deaths(rig, sk, clips, data, meshes):
    """Rest the lowest point of the body on z = 0 at every frame of the deaths."""
    scene = bpy.context.scene
    report = {}
    for name in DEATHS:
        frames = data[name]
        for it in range(2):
            act = bpy.data.actions[name]
            set_action(rig, act)
            lifts = []
            for f in range(len(frames)):
                scene.frame_set(f)
                lifts.append(-min(mesh_min_z(meshes)))
            for P, dz in zip(frames, lifts):
                P['root'] = Matrix.Translation((0, 0, dz)) @ P.get('root', Matrix.Identity(4))
            write_clip(rig, sk, clips, name, frames)
        set_action(rig, bpy.data.actions[name])
        mins = []
        for f in range(len(frames)):
            scene.frame_set(f)
            mins.append(min(mesh_min_z(meshes)))
        report[name] = (min(mins), max(mins))
    return report


def rifle_verts(weapon):
    return [v.co.copy() for v in weapon.data.vertices]


def lay_rifle(rig, sk, clips, data, meshes, socket_obj, rifle_local, blend=8):
    """After grounding: turn the dead soldier's right hand (wrist) so a rifle on
    socket_weapon lies flat just above the ground at the end of each death."""
    scene = bpy.context.scene
    report = {}
    for name in DEATHS:
        frames = data[name]
        n = len(frames) - 1
        set_action(rig, bpy.data.actions[name])
        scene.frame_set(n)
        bpy.context.view_layer.update()
        Mh = rig.matrix_world @ rig.pose.bones['hand_r'].matrix
        S = socket_obj.matrix_world
        rel = Mh.inverted() @ S                    # socket in hand space
        wrist = Mh.translation
        best = None
        for p in range(-90, 91, 15):
            for r in range(-90, 91, 15):
                for y in range(-90, 91, 15):
                    Rd = sp.R(p, r, y).to_4x4()
                    Mn = Matrix.Translation(wrist) @ Rd @ Matrix.Translation(-wrist) @ Mh
                    W = Mn @ rel
                    zs = [(W @ v).z for v in rifle_local[::3]]
                    zmin = min(zs)
                    d = (W.to_3x3() @ V((0, -1, 0)))
                    cost = 400 * max(0.0, -zmin) + 60 * abs(zmin - 0.01) + 4 * abs(d.z) + 0.01 * (abs(p) + abs(r) + abs(y))
                    if best is None or cost < best[0]:
                        best = (cost, p, r, y, zmin)
        Rd = sp.R(best[1], best[2], best[3])
        # pre-multiply the wrist rotation on the hand's FK rotation, blended in
        for f, P in enumerate(frames):
            t = sp.ease((f - (n - blend - 6)) / blend, 'io')
            if t <= 0:
                continue
            spec = P['arm_r']
            if spec[0] != 'fk':
                continue
            D3 = sp.slerp3(Matrix.Identity(3), Rd, t)
            P['arm_r'] = ('fk', spec[1], spec[2], D3 @ spec[3])
        write_clip(rig, sk, clips, name, frames)
        report[name] = [round(x, 3) for x in best[1:]]
    return report


def clip_ground_report(rig, meshes):
    scene = bpy.context.scene
    rep = {}
    for name in CLIP_ORDER:
        act = bpy.data.actions[name]
        set_action(rig, act)
        n = int(act.frame_range[1])
        vals = []
        for f in range(0, n + 1, max(1, n // 8)):
            scene.frame_set(f)
            vals.append(min(mesh_min_z(meshes)))
        rep[name] = (round(min(vals), 3), round(max(vals), 3))
    return rep


def clip_stats(rig, mesh, hand_r_socket):
    """Per clip: top of the helmet, hips height (min/max over the clip)."""
    import numpy as np
    scene = bpy.context.scene
    out = {}
    for name in CLIP_ORDER:
        act = bpy.data.actions[name]
        set_action(rig, act)
        n = int(act.frame_range[1])
        tops, hips = [], []
        for f in range(0, n + 1, max(1, n // 10)):
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            ev = mesh.evaluated_get(dg)
            me = ev.to_mesh()
            co = np.empty(len(me.vertices) * 3, dtype=np.float32)
            me.vertices.foreach_get('co', co)
            ev.to_mesh_clear()
            tops.append(float(co[2::3].max()))
            hips.append((rig.matrix_world @ rig.pose.bones['hips'].head).z)
        out[name] = {'top': (round(min(tops), 3), round(max(tops), 3)),
                     'hips': (round(min(hips), 3), round(max(hips), 3))}
    return out


def set_face(mesh, weights):
    """Shape key values on an outfit (missing keys ignored)."""
    keys = mesh.data.shape_keys
    if not keys:
        return
    for kb in keys.key_blocks[1:]:
        kb.value = weights.get(kb.name, 0.0)


def morph_stats(mesh):
    """Per shape key: max and mean displacement over the vertices it moves (> 0.3 mm)."""
    import numpy as np
    keys = mesh.data.shape_keys
    co = np.array([v.co[:] for v in mesh.data.vertices])
    out = {}
    for kb in (keys.key_blocks[1:] if keys else []):
        d = np.linalg.norm(np.array([p.co[:] for p in kb.data]) - co, axis=1)
        mv = d > 0.0003
        out[kb.name] = {'max_mm': round(float(d.max()) * 1000, 1), 'mean_mm': round(float(d[mv].mean()) * 1000, 2),
                        'moved_verts': int(mv.sum()), 'over_5mm': int((d > 0.005).sum())}
    return out


def lod_compare(rig, outfit, lod, others, gun, poses=(('rest', None, 0), ('aim', 'aim', 0), ('run', 'run', 5),
                                                         ('death_fwd', 'death_fwd', 40))):
    """v4.2: full mesh vs LOD at 10 m and 30 m, as the game would draw them
    (720 px, 60 deg vertical field of view), cropped round the soldier and
    blown up with nearest-neighbour pixels: rows = poses, columns = full 10 m,
    LOD 10 m, full 30 m, LOD 30 m."""
    import numpy as np
    scene = bpy.context.scene
    size, lens = 720, 18.0 / math.tan(math.radians(30.0))
    rows = []
    for tag, act, fr in poses:
        set_action(rig, bpy.data.actions[act] if act else None)
        if act is None:
            for pb in rig.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
        scene.frame_set(fr)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        me = outfit.evaluated_get(dg).to_mesh()
        pts = np.array([v.co[:] for v in me.vertices])
        outfit.evaluated_get(dg).to_mesh_clear()
        c = V(((pts[:, 0].min() + pts[:, 0].max()) / 2, (pts[:, 1].min() + pts[:, 1].max()) / 2,
               (pts[:, 2].min() + pts[:, 2].max()) / 2))
        tiles = []
        for dist, crop in ((10.0, 120), (30.0, 48)):
            d = V((0.55, -1.0, 0.10)).normalized()
            for mesh in (outfit, lod):
                for o in others + [outfit, lod]:
                    o.hide_render = o is not mesh
                p = os.path.join(PREV, f'_lodtile.png')
                sp.render_view([rig, mesh, gun], p, c + d * dist, c, lens=lens, samples=16, size=size)
                im = bpy.data.images.load(p)
                a = np.empty(size * size * 4, np.float32)
                im.pixels.foreach_get(a)
                bpy.data.images.remove(im)
                a = a.reshape(size, size, 4)
                h0 = size // 2 - crop // 2
                t = a[h0:h0 + crop, h0:h0 + crop]
                k = 240 // crop
                tiles.append(np.repeat(np.repeat(t, k, axis=0), k, axis=1))
        rows.append(np.concatenate(tiles, axis=1))
    big = np.concatenate(rows[::-1], axis=0)               # Blender images are bottom-up
    out = bpy.data.images.new(outfit.name + '_lodcmp', big.shape[1], big.shape[0], alpha=False)
    out.pixels.foreach_set(big.ravel())
    out.filepath_raw = os.path.join(PREV, f'{outfit.name}_lod_compare.png')
    out.file_format = 'PNG'
    out.save()
    os.remove(os.path.join(PREV, '_lodtile.png'))
    lod.hide_render = True
    outfit.hide_render = False
    kit.log('lod compare', outfit.name)


def lineup_weights(n=6, seed=1907):
    """The line-up's faces, drawn like the engine's randomFace()."""
    import random
    R = random.Random(seed)
    out = []
    for k in range(n):
        build = R.random() * 2 - 1
        out.append({'face_broad': round(max(0.0, build), 3), 'face_gaunt': round(max(0.0, -build), 3),
                    'face_older': round(R.random() * R.random() * 0.9, 3)})
    return out


def face_lineup(rig, outfit, others, n=6, seed=1907):
    """Six soldiers side by side (face_34) with faces drawn like the engine's
    randomFace(): build = U(-1,1), broad = max(0, build), gaunt = max(0, -build),
    older = U * U * 0.9. Returns the weights."""
    import random
    import numpy as np
    R = random.Random(seed)
    tiles, weights = [], []
    for k in range(n):
        build = R.random() * 2 - 1
        w = {'face_broad': round(max(0.0, build), 3), 'face_gaunt': round(max(0.0, -build), 3),
             'face_older': round(R.random() * R.random() * 0.9, 3)}
        set_face(outfit, w)
        tiles += render_pose(rig, outfit, others, None, 0, [], f'lineup{k}', views=('face_34',))
        weights.append(w)
    set_face(outfit, {})
    if len(tiles) == n:
        ims = [bpy.data.images.load(t) for t in tiles]
        w_, h_ = ims[0].size
        arrs = []
        for im in ims:
            a = np.empty(w_ * h_ * 4, np.float32)
            im.pixels.foreach_get(a)
            arrs.append(a.reshape(h_, w_, 4))
        big = np.concatenate(arrs, axis=1)
        out = bpy.data.images.new(outfit.name + '_lineup', w_ * n, h_, alpha=False)
        out.pixels.foreach_set(big.ravel())
        out.filepath_raw = os.path.join(PREV, f'{outfit.name}_lineup_face_34.png')
        out.file_format = 'PNG'
        out.save()
        for im, t in zip(ims, tiles):
            bpy.data.images.remove(im)
            os.remove(t)
    kit.log('lineup', outfit.name, json.dumps(weights))
    return weights


def eye_checks(rig, meshes, s_r):
    """v4: the aiming (right) eye against the Garand's sight line in `aim` and
    `crouch_aim` (frame 0) with every face, and how far the morphs move the
    eyes and the lids round them."""
    import numpy as np
    scene = bpy.context.scene
    apex = sp.eye4_centre(-1) + V((0, -(sp.EYE4_R + sp.CORNEA4), 0))
    out = {}
    faces = [('rest', {})] + [(k, {k: 1.0}) for k in sp.MORPHS] + [('broad+older', {'face_broad': 1.0, 'face_older': 1.0}),
                                                                   ('gaunt+older', {'face_gaunt': 1.0, 'face_older': 1.0})]
    for mesh in meshes:
        co = np.array([v.co[:] for v in mesh.data.vertices])
        i = int(np.argmin(np.linalg.norm(co - np.array(apex[:]), axis=1)))
        rec = {'apex_vertex_offset_mm': round(float(np.linalg.norm(co[i] - np.array(apex[:]))) * 1000, 2)}
        keys = mesh.data.shape_keys
        near = np.linalg.norm(co - np.array(apex[:]), axis=1) < 0.012
        for kb in (keys.key_blocks[1:] if keys else []):
            d = np.array([kb.data[j].co[:] for j in range(len(co))]) - co
            n = np.linalg.norm(d, axis=1)
            rec[kb.name] = {'eye_apex_mm': round(float(n[i]) * 1000, 3),
                            'within_12mm_of_eye_max_mm': round(float(n[near].max()) * 1000, 2),
                            'max_mm': round(float(n.max()) * 1000, 2)}
        for act in ('aim', 'crouch_aim'):
            set_action(rig, bpy.data.actions[act])
            scene.frame_set(0)
            bpy.context.view_layer.update()
            W = s_r.matrix_world
            a, b = W @ V((0, 0.05, 0.087)), W @ V((0, 0.20, 0.087))
            res = {}
            for tag, wts in faces:
                set_face(mesh, wts)
                bpy.context.view_layer.update()
                dg = bpy.context.evaluated_depsgraph_get()
                ev = mesh.evaluated_get(dg)
                me = ev.to_mesh()
                e = mesh.matrix_world @ me.vertices[i].co
                ev.to_mesh_clear()
                ab = b - a
                t = max(0.0, min(1.0, (e - a).dot(ab) / ab.length_squared))
                res[tag] = round((a + ab * t - e).length * 100, 2)
            set_face(mesh, {})
            rec['sight_line_cm_' + act] = res
        out[mesh.name] = rec
    return out


def export_soldier(objs, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_extras=True, export_yup=True,
        export_apply=False,                 # the outfits carry only their Armature modifier; keeps the shape keys
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_image_format='WEBP', export_image_quality=82,
        export_cameras=False, export_lights=False,
        export_animations=True, export_skins=True, export_morph=True,
        export_morph_normal=True, export_morph_tangent=False, export_morph_animation=False,
        export_try_sparse_sk=True, export_try_omit_sparse_sk=False,
        export_def_bones=True, export_leaf_bone=False,
        export_animation_mode='ACTIONS', export_force_sampling=True,
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_reset_pose_bones=True, export_anim_slide_to_zero=True,
    )
    kit.log(f'exported {os.path.relpath(path, kit.ROOT)} ({os.path.getsize(path) // 1024} KB)')


def read_glb(path):
    data = open(path, 'rb').read()
    n = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + n])


def verify_soldier(path):
    j = read_glb(path)
    nodes = j['nodes']
    names = [n.get('name') for n in nodes]
    out = {'nodes': names}
    skin = j['skins'][0]
    joints = [names[i] for i in skin['joints']]
    out['joints'] = joints
    hand = names.index('hand_r')
    sock = names.index('socket_weapon')
    out['socket_parent_ok'] = sock in nodes[hand].get('children', [])
    out['socket_local'] = {k: nodes[sock].get(k) for k in ('translation', 'rotation', 'scale')}
    if 'socket_weapon_l' in names:
        hl = names.index('hand_l')
        sl = names.index('socket_weapon_l')
        out['socket_l_parent_ok'] = sl in nodes[hl].get('children', [])
        out['socket_l_local'] = {k: nodes[sl].get(k) for k in ('translation', 'rotation', 'scale')}
    out['meshes'] = [n['name'] for n in nodes if 'mesh' in n]
    out['lods'] = {}
    for n in nodes:
        if 'mesh' in n and n.get('name', '').endswith('_lod'):
            m = j['meshes'][n['mesh']]
            full = nodes[names.index(n['name'][:-4])]
            fm = j['meshes'][full['mesh']]
            par = [i for i, x in enumerate(nodes) if names.index(n['name']) in x.get('children', [])]
            out['lods'][n['name']] = {
                'parent': names[par[0]] if par else None, 'skin': n.get('skin'), 'full_skin': full.get('skin'),
                'material': [pr['material'] for pr in m['primitives']], 'full_material': [pr['material'] for pr in fm['primitives']],
                'targets': [len(pr.get('targets', [])) for pr in m['primitives']],
                'tris': sum(j['accessors'][pr['indices']]['count'] // 3 for pr in m['primitives']),
                'attributes': sorted(m['primitives'][0]['attributes'])}
    out['morph_targets'] = {}
    for n in nodes:
        if 'mesh' in n:
            m = j['meshes'][n['mesh']]
            out['morph_targets'][n['name']] = {
                'names': (m.get('extras') or {}).get('targetNames', []),
                'targets_per_primitive': [len(pr.get('targets', [])) for pr in m['primitives']]}
    anims = {}
    for a in j.get('animations', []):
        tgt = {}
        dur = 0.0
        for ch in a['channels']:
            nm = names[ch['target']['node']]
            tgt.setdefault(nm, []).append(ch['target']['path'])
            acc = j['accessors'][a['samplers'][ch['sampler']]['input']]
            dur = max(dur, acc['max'][0])
        rot_bones = sorted(b for b, p in tgt.items() if 'rotation' in p)
        anims[a['name']] = {'duration': round(dur, 4), 'channels': len(a['channels']),
                            'bones_with_rotation': len(rot_bones),
                            'missing_rotation': sorted(set(joints) - set(rot_bones))}
    out['animations'] = anims
    return out, j


def mat_from_node(n):
    from mathutils import Quaternion
    t = V(n.get('translation', (0, 0, 0)))
    r = n.get('rotation', (0, 0, 0, 1))
    q = Quaternion((r[3], r[0], r[1], r[2]))
    s = n.get('scale', (1, 1, 1))
    M = q.to_matrix().to_4x4()
    for i in range(3):
        M.col[i] *= s[i]
    M.translation = t
    return M


def gltf_world(j, name):
    nodes = j['nodes']
    names = [n.get('name') for n in nodes]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    i = names.index(name)
    M = Matrix.Identity(4)
    while i is not None:
        M = mat_from_node(nodes[i]) @ M
        i = parent.get(i)
    return M


def add_preview_vertex_colour(mats):
    """Previews only (after export): multiply the base colour by the Color attribute."""
    for m in mats:
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        if bsdf is None or bsdf.inputs['Base Color'].is_linked:
            continue
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = 'Color'
        mix = nt.nodes.new('ShaderNodeMixRGB') if hasattr(bpy.types, 'ShaderNodeMixRGB') else None
        if mix is None:
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            mix.inputs['A'].default_value = bsdf.inputs['Base Color'].default_value
            nt.links.new(attr.outputs['Color'], mix.inputs['B'])
            nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        else:
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Fac'].default_value = 1.0
            mix.inputs['Color1'].default_value = bsdf.inputs['Base Color'].default_value
            nt.links.new(attr.outputs['Color'], mix.inputs['Color2'])
            nt.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])


VIEWS = {
    'face_front': ((0.0, -0.80, 1.63), (0.0, -0.01, 1.61), 85),
    'face_34': ((0.52, -0.62, 1.65), (0.0, -0.01, 1.61), 85),
    'face_side': ((0.80, -0.01, 1.63), (0.0, -0.01, 1.61), 85),
    'front': ((0.9, -3.3, 1.35), (0, -0.1, 0.92), 40),
    'upper': ((0.95, -1.45, 1.60), (0.0, -0.10, 1.32), 45),
    'upper_back': ((-0.95, 1.35, 1.65), (0.0, -0.05, 1.30), 45),
    'legs': ((1.15, -1.50, 0.85), (0.0, -0.05, 0.50), 45),
    'back34': ((-1.55, 2.55, 1.50), (0, -0.05, 0.95), 40),
    'face': ((0.30, -0.80, 1.66), (0.0, 0.0, 1.62), 70),
    'close': ((0.75, -1.75, 1.45), (0.0, -0.05, 1.20), 50),
    'shoulder': ((-0.62, 1.45, 1.72), (0.08, -0.85, 1.12), 38),
}


def render_pose(rig, outfit, others, action, frame, attach, tag, views=('back34', 'front'), lie=False):
    scene = bpy.context.scene
    set_action(rig, bpy.data.actions[action] if action else None)
    if action is None:
        for pb in rig.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
    scene.frame_set(frame)
    for o in others:
        o.hide_render = True
    outfit.hide_render = False
    paths = []
    for v in views:
        cam, tgt, lens = VIEWS[v]
        if lie:
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            me = outfit.evaluated_get(dg).to_mesh()
            pts = [v.co for v in me.vertices]
            c = V((sum(p.x for p in pts), sum(p.y for p in pts), 0)) / len(pts)
            outfit.evaluated_get(dg).to_mesh_clear()
            tgt = V((c.x, c.y, 0.22))
            off = {'back34': V((-2.2, 1.9, 1.7)), 'front': V((1.0, -2.6, 1.5))}[v]
            cam = tgt + off
        p = os.path.join(PREV, f'{outfit.name}_{tag}_{v}.png')
        try:
            sp.render_view([rig, outfit] + attach, p, cam, tgt, lens=lens, samples=32 if v.startswith('face') else 20,
                           size=768)
            paths.append(p)
        except RuntimeError as e:          # e.g. the disk is full: keep the build going
            kit.log('WARNING preview failed', os.path.basename(p), str(e)[:120])
    return paths


KIT_NOTES = [
    'v3: the face/eye/hand texel boost now uses bake.py\'s new `scale_islands` hook '
    '(`soldier_parts.island_scaler`); nothing in bake.py is patched any more.',
    '`bake_model` ends with `kit.flat_color(obj, 1.0)`, so baked meshes still export a COLOR_0 of 1.0 '
    '(~4 bytes/vertex); harmless, but could be dropped if the shader no longer needs it.',
    '`export(objs, path, animations=True)` works for skins + actions; the soldier uses its own '
    '`export_scene.gltf` call only to turn on `export_optimize_animation_size` (+ `keep_anim_armature`).',
    '`reset()` leaves the scene at 24 fps: an animated set must set `scene.render.fps = 30` before writing '
    'actions, or every clip exports 25 % too long.',
    '`export()` logs the triangle count of the listed objects only, so exporting `[rig]` logs 0 tris.',
    '`preview()` hides any mesh whose parent is not in the list, e.g. a weapon parented to a socket empty '
    'unless it is passed explicitly; it frames from evaluated (posed) vertices while `bounds()` uses the '
    'rest mesh.',
    'The v1-reported issues are fixed in this kit (noise seeding, deterministic jitter, boolean use_self, '
    'uv_cylinder factor); none of them affected this set.',
]


CLIP_NOTES = {
    'idle': 'low ready (rifle across the belly, muzzle forward-left and down), breathing',
    'walk': 'in place; stride 1.40 m per cycle = 1.31 m/s for no foot sliding; hips bob 4 cm',
    'walk_back': 'in place; 0.94 m per cycle = 0.88 m/s',
    'strafe_l': 'side-step to the left (+X Blender = +X three); 0.50 m per cycle = 0.54 m/s',
    'strafe_r': 'mirror of strafe_l; 0.54 m/s',
    'run': 'port arms; 2.40 m per cycle = 3.60 m/s; flight phase, 9 deg forward lean',
    'crouch_idle': 'kneeling on the right knee, left foot forward, rifle ready',
    'crouch_walk': 'crouched walk; 1.0 m per cycle = 0.83 m/s',
    'aim': 'shouldered, cheek on the stock, muzzle level along -Y (three +Z)',
    'crouch_aim': 'aim from the kneel',
    'reload': 'M1 Garand (2.0 s): rifle up, receiver turned to the right shoulder; left hand to the belt, en-bloc pushed into the receiver, op-rod slapped, back to the handguard; starts/ends on idle frame 0',
    'reload_smg': 'Thompson / MP 40 (2.2 s): magazine pulled down and out, dropped; new one from the belt, seated, bolt racked with the left hand; starts/ends on idle frame 0',
    'throw': 'grenade overhand; rifle in the LEFT hand on socket_weapon_l; release at f15',
    'hit': 'flinch back, recovered at f12',
    'death_fwd': 'shot from the front: knees buckle, falls on the back (ends lying face up, head towards +Y Blender = -Z three)',
    'death_back': 'shot from behind: drops to the knees, falls face down (head towards -Y Blender = +Z three)',
    'death_crumple': 'knees buckle, slumps onto the right side',
}


def fmt3(v, nd=3):
    return '(' + ', '.join(f'{x:.{nd}f}' for x in v) + ')'


def write_notes(summary, j, weapons_glb):
    ver = summary['verify']
    diag = summary['diag']
    tris = summary['tris']
    L = []
    w = L.append
    w('# Soldier set — notes')
    w('')
    w('Built by `tools/blender/build_soldier.py` (helpers in `soldier_parts.py`); this file is')
    w('regenerated by every full build. All positions below are in **glTF / three.js space** (Y up,')
    w('the soldier faces **+Z**, his left is **+X**) unless marked Blender.')
    w('')
    w('    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\')
    w('        --python fun/hedgerow/tools/blender/build_soldier.py [-- soldier|weapons] [nopreview]')
    w('')
    w('## soldier.glb (%d KB)' % (os.path.getsize(os.path.join(kit.MODELS, 'soldier.glb')) // 1024))
    w('')
    w('| node | what | tris | material (baked) | textures | size x × y × z (m, Blender, rest) |')
    w('|---|---|---|---|---|---|')
    for n in ('allied', 'axis'):
        b = summary['bounds'][n]
        mats = ', '.join(summary['materials'][n])
        tx = summary.get('textures', {}).get(n) or {'base': OUTFIT_TEX, 'normal': OUTFIT_TEX // 2, 'mr': OUTFIT_TEX}
        txs = ', '.join(f"{k} {v}²" for k, v in tx.items() if v)
        w(f"| `{n}` | skinned mesh, child of `rig` | {tris[n]} | `{mats}` | {txs} | "
          f"{b[1][0]-b[0][0]:.2f} × {b[1][1]-b[0][1]:.2f} × {b[1][2]-b[0][2]:.2f} |")
    for n, st in summary.get('lod', {}).items():
        lv = ver.get('lods', {}).get(n, {})
        w(f"| `{n}` | distance LOD of `{n[:-4]}`, skinned mesh, child of `rig` (same skin) | {lv.get('tris', st['tris'])} | "
          f"`{n[:-4]}` (shared) | the same images | — |")
    w('| `rig` | armature root node (identity) | | | | |')
    w('| `socket_weapon` | empty, child of joint `hand_r` | | | | |')
    w('| `socket_weapon_l` | empty, child of joint `hand_l` (extra, for the throw) | | | | |')
    w('')
    w('Triangles per part — allied: ' + ', '.join(f'{k} {v}' for k, v in tris['parts_allied'].items()) + '.')
    w('Axis: ' + ', '.join(f'{k} {v}' for k, v in tris['parts_axis'].items()) + '.')
    w(f"Both meshes: stature 1.745 m (skull), helmet top ~1.77–1.78 m; {tris['allied']} / {tris['axis']} tris (budget 32k); "
      '≤ 4 influences per vertex, weights')
    w('normalised. **v2**: each outfit is modelled from palette materials (wool, cotton drill, webbing, leather,')
    w('painted steel, skin, …), then baked with `bake.bake_model` in the rest pose *before* skinning into ONE')
    w('material named after the mesh (`allied`, `axis`): base colour 2048², packed metallic-roughness 2048²,')
    w('tangent-space normal 1024², WebP in the GLB. The bake carries the occlusion, the skin and eye detail, the')
    w('cotton net over the M1 helmet, wear at the edges and mud splashed low on the legs; the vertex colour')
    w('`Color` is flat white (kept for the shader contract). Before packing, UV islands are rescaled by')
    w('`soldier_parts.UV_BOOST4` (island centre z): face ×3.0, visible neck ×1.5, eyes ×3.6, hands and nails ×2.0,')
    w('the chin strap ×1.3, and the scalp hidden under the helmet ×0.55.')
    w('Extra palette keys registered at runtime by `soldier_parts.register_surfaces()` (no shared file edited):')
    w('`skin` → v4 skin (`r_skin4`), `eye` (`r_eye4`), `nail`, `helmet_net`, `walnut`, `brass`, `bakelite`.')
    w('')
    w('Geometry (v2; the head and hands are v4, below): four fingers and a thumb closed round a bar (Ø39 mm right,')
    w('Ø47 mm left = the fore-end); uniforms with folds as geometry at the elbows (compression rolls), knees')
    w('(back), waist (bloused above the belt), under the arms and down the skirt; seams, cuffs, collars.')
    w('US: M41 jacket with laid collar and lapels, wool shirt in the V, buttons, slash-pocket welts, cuff tabs,')
    w('epaulettes; wool trousers bloused over M1938 leggings with hooks and crossing laces and an instep')
    w('strap; service shoes with soles and heels; M1 helmet with rolled rim, net (baked), liner and suspension')
    w('band, bales, webbing chin straps; M1923 belt with ten pockets and lift-the-dot snaps, first-aid')
    w('pouch, M1936 suspenders with buckles, M1928 haversack (flap, straps, buckles) with the M1943 e-tool and')
    w('the bayonet in its scabbard, canteen in its cover with snapped flaps. DE: M40 tunic with four pleated')
    w('pockets, scalloped flaps and buttons, stand collar with Litzen bars, shoulder boards; trousers bloused')
    w('into jackboots wrinkled at the ankle, hobnailed soles and heel irons; M40 Stahlhelm with rolled edge,')
    w('split rivets, vent lugs, leather liner band, chin strap and buckle; belt and buckle with roundel,')
    w('Y-straps with D-rings, two three-cell pouches with strapped flaps and studs, bread bag, canteen with')
    w('cup, fluted gas-mask canister with lid and rings, e-tool carrier and bayonet in its frog.')
    w('')
    w('### v4 (realism pass: face and body; the face revised in v4.1 below)')
    w('')
    w('* **Head**: one surface from the crown to inside the collar (head and neck merged, no seam under the jaw),')
    w('  generated on a fine grid of horizontal superellipse rings (`HEAD4`) with the anatomy as displacement')
    w('  (`face4_disp`): brow ridge over deep-set eyes, orbits, nose with bridge, tip lobule, alar wings and')
    w('  nostrils (`nose4`), cheekbones and zygomatic arches with the hollow below, nasolabial folds, philtrum,')
    w('  lips with Cupid\'s bow, vermilion and white roll, stomion and commissures (`lips4`), mentolabial sulcus and')
    w('  chin pad, jaw angle and mandible border, masseters, temples, Adam\'s apple, sternocleidomastoids, nape,')
    w('  a little hair volume above the hairline. Eyelids are wrapped on the eyeballs (`lid4`: tucked fissure,')
    w('  rounded margins, pretarsal lid, crease and fold, lower-lid roll, lid–cheek groove, pink inner corner)')
    w('  and joined to the orbit with a smooth max. The grid (~100k quads) is decimated with a symmetric')
    w('  quadric collapse to ~6.2k tris. Neck ~37–38 cm round at the collar (was 34.6).')
    w('* **Eyes**: ellipsoidal globes (the lids rest on them to the canthi) with a corneal bulge and limbal')
    w('  sulcus; baked sclera with veins and pink corners, grey-green iris with fibres, hazel collarette and a dark')
    w('  limbal ring, black pupil; roughness 0.03–0.10 on the eye only. Apex unchanged (v3\'s `EYE_R`).')
    w('* **Ears**: sculpted helix rim, antihelix, scapha, concha, tragus, antitragus and lobe (~820 tris each).')
    w('* **Skin** (`r_skin4`): satin (roughness ~0.50–0.62, 0.50 on the T-zone, 0.47 lips, 0.64 stubble), warm')
    w('  zones (ruddy cheeks, nose, ears and chin, yellower forehead, darker sockets), blue-grey stubble on the')
    w('  jaw, chin and upper lip, clipped hair on the scalp, hair-strand eyebrows, lash lines, lips with a')
    w('  vermilion border; pores, crow\'s feet, forehead, under-eye, nasolabial, lip and neck lines in the')
    w('  normal map; mud smears, dirt in the creases, sweat on forehead and nose; dirtier hands.')
    w('* **Hands** (`build_hand4`): same grip frames; denser back of the hand with extensor tendons and')
    w('  knuckles, bony finger joints, nail plates (`nail`) on the fingers and thumb.')
    w('* **Body**: `TORSO_JACKET4` (squarer shoulders, rounder and deeper chest and back; the clips keep')
    w('  `TORSO_JACKET` for the rifle butt); sleeves carry the arm under the wool (`arm_muscles`: deltoid,')
    w('  biceps, triceps, bony elbow, forearm masses, flatter wrist); trousers the leg (`leg_muscles`:')
    w('  quadriceps, vastus medialis, hamstrings, inner thigh, kneecap, calf) on fuller thighs; calves in the')
    w('  leggings and jackboots. Collars widened for the thicker neck; the German stand collar dips at the front.')
    w('* **Cloth** (on top of the library wool/drill, `register_wear`): sweat stains with tide marks under the')
    w('  arms and down the back, ~3.5 mm diagonal twill wales in the normal map, besides v3\'s wet shoulders and')
    w('  legs, muddy knees, dusty elbows and mud splashed on the lower legs.')
    w('* **Skinning**: the sleeve cap over the shoulder blends into clavicle/chest, the jacket over the joint')
    w('  takes some upper arm, the elbow blend is wider (±5 cm); the head blends into the neck along a line from')
    w('  under the chin to the skull base (`w_headneck`).')
    w('* **Chin straps**: M1 straps run from the bales along the outside of the shell and buckle at the back,')
    w('  the tail hooked over the rim (as worn in Normandy); the German strap lies on the skin in front of the')
    w('  ears, over the jaw (buckle on the left) and under the chin, skinned like the skin under it; in v4.1 its')
    w('  vertices copy the morph of the skin under them (`add_face_morphs(follow=...)`), so every face keeps it on.')
    w('* **Clips**: not re-animated (bones, rest pose, clip names, frame counts, sockets and reload events are')
    w('  identical to v3); only the deaths\' automatic grounding re-ran against the new body, which moves their')
    w('  `root` translation by ≤ 9 mm.')
    mt = ver.get('morph_targets', {})
    w('')
    w('### v4.1 (second face pass: shorter lower face, fuller lips, wider jaw, distinct face shapes)')
    w('')
    w('* **Shorter lower third**: the face is designed in a warped z (`head4_warp`, `WARP4`): between the nose')
    w('  base and under the chin it is built 16 % shorter than designed (smooth, identity above z_rel −0.038, a')
    w('  constant 12 mm lift below −0.130), so the eyes, nose root and skull do not move; the shader masks use the')
    w('  same warp (`_sg_warp`). The nose is 10 % shorter towards its root, the chin set higher and the under-chin')
    w('  tucked, the hairline raised 1.8 cm (under the helmet).')
    w('* **Wider-reading jaw**: narrower at the cheek and jaw levels in absolute terms (anatomical widths), but a')
    w('  squarer lower face (superellipse front exponent up to 2.25), a stronger jaw angle and masseter over a')
    w('  slimmer upper neck, a ~4 cm chin with mental tubercles, a lighter under-cheekbone hollow.')
    w('* **Fuller lips** (`lips4`): taller and fuller vermilion, defined Cupid\'s bow and philtrum columns, a soft')
    w('  parting line, depressed and darker corners with the modiolus beside them.')
    w('* **Eyes read better**: lighter socket tint and a softer occlusion profile for the skin (`skin4`: 0.55).')
    w('* **Ears** moved in 4.4 mm with the narrower head.')
    w('* German chin strap vs skin (true distance to the posed skin, all 17 clips every other frame, faces rest /')
    w('  broad / gaunt / older / broad+older): its inner edges sit ≤ 0.8 mm into the skin at rest (a tight strap on')
    w('  a convex jaw), ≤ 0.1 mm deeper in every live clip and ≤ 1.6 mm in the death falls (the strap is 2.4 mm')
    w('  thick, so it never cuts through). The US straps ride on the shell and never touch the face.')
    fm = diag.get('face', {})
    if fm:
        w(f"* Measured on the built surface (`face4_measure`): thirds (trichion–glabella–subnasale–menton) "
          f"{fm['thirds_cm'][0]} / {fm['thirds_cm'][1]} / {fm['thirds_cm'][2]} cm (v4: 4.35 / 7.35 / 6.35; the chin "
          'moved up 10.5 mm, the nose base 6.5 mm, nasion–menton 12.25 → 11.2 cm); '
          f"cheekbone width {fm['zygomatic_cm']} cm (v4 15.3), jaw angles {fm['jaw_angles_cm']} cm (v4 13.3), "
          f"chin {fm['chin_cm']} cm (v4 2.9); upper / lower vermilion ~7.7 / 9.7 mm (v4 ~6.4 / 9.4, thin), mouth ~5 cm.")
    w('')
    w('**Morph targets** (shape keys on the head, exported as glTF morph targets on each outfit mesh; names in')
    w('`mesh.extras.targetNames`, sparse accessors, with normals): index order ' +
      ', '.join(f"{i} `{n}`" for i, n in enumerate(sp.MORPHS)) + '. In the GLB: ' +
      '; '.join(f"`{k}`: {v['names']}" for k, v in mt.items()) + '.')
    w('`face_broad` = a heavier, wider face: jaw and lower face out ~15 mm a side, full cheeks, heavy lower')
    w('cheeks, double chin and a thick neck under the jaw, a broad nose, a heavy brow, a shorter, wider chin;')
    w('`face_gaunt` = lean and hollow: cheeks sunk ~15 mm under the cheekbones, hollow temples, prominent')
    w('cheekbones and jaw angles, a sharp line under the jaw, a narrow chin, a longer thinner nose, thin lips,')
    w('a thin neck with the Adam\'s apple, deeper orbits; `face_older` (35–45) = jowls dropping ~10 mm, marionette')
    w('lines, deep nasolabial folds, hooded upper lids and bags, a soft jaw line, thinner lips with the corners')
    w('down, a longer nose tip, the mid-cheek and lateral brow lower, longer ear lobes. All geometric (one shared')
    w('texture). They are smooth fields (`face4_morph`, design z), zero inside the collars, on the eyeballs and')
    w('within ~1–3 mm of the lid margins, damped round the ears, with a smooth 0.8–2.0 mm cut-off of the tails.')
    for n, st in diag.get('morph_stats', {}).items():
        w(f"* `{n}` displacement (max / mean over the moved vertices > 0.3 mm, count): " +
          '; '.join(f"{k} {v['max_mm']} / {v['mean_mm']} mm ({v['moved_verts']} verts, {v['over_5mm']} > 5 mm)"
                    for k, v in st.items()) + '.')
    ey = diag.get('eyes', {})
    for n, rec in ey.items():
        w(f"* `{n}`: aiming eye to the Garand sight line (cm) — aim: " +
          ', '.join(f"{k} {v}" for k, v in rec['sight_line_cm_aim'].items()) + '; crouch_aim: ' +
          ', '.join(f"{k} {v}" for k, v in rec['sight_line_cm_crouch_aim'].items()) + '. Eye apex moved by the morphs: ' +
          ', '.join(f"{k} {rec[k]['eye_apex_mm']} mm" for k in sp.MORPHS if k in rec) + '.')
    lu = summary.get('lineup') or {n: lineup_weights() for n in ('allied', 'axis')}
    for n, ws in lu.items():
        w(f"* Line-up `previews/soldier/{n}_lineup_face_34.png` (left to right, `randomFace()` distribution, seed 1907): " +
          '; '.join(f"broad {x['face_broad']:.2f} gaunt {x['face_gaunt']:.2f} older {x['face_older']:.2f}" for x in ws) + '.')
    w('')
    w('### v4.2 (distance LODs)')
    w('')
    lods = summary.get('lod', {})
    w('`allied_lod` and `axis_lod`: skinned mesh nodes, children of `rig`, bound to the same glTF skin as the full')
    w('meshes (same 20 joints and inverse bind matrices) and drawing with the same glTF material (`allied` / `axis`,')
    w('the same three images — nothing duplicated); COLOR_0 flat white, no morph targets. Made by `soldier_parts.make_lod`')
    w('from the final baked mesh, before skinning:')
    w('* parts smaller than 2.5 cm (buttons, studs, snaps, hobnails, hooks, nails) are dropped — sub-pixel at LOD')
    w('  distances; faces enclosed at depth in another shell (every ray from them meets a surface from behind, ≥ 6 mm')
    w('  away: eyeball backs, limb caps and the neck bottom inside the torso, hand roots in the cuffs) are dropped;')
    w('  faces merely covered by another layer are kept so the decimated covers never open holes;')
    w('* the rest is collapse-decimated to ' + str(LOD_TRIS) + ' tris (silhouette kept: helmet, shoulders, webbing,')
    w('  pack, boots, arms and hands). The shared atlas has many small UV islands, so ~80 % of the LOD\'s vertices')
    w('  are split along island seams (~78 bytes per LOD triangle in the GLB): the two LODs add ~0.9 MB, soldier.glb is')
    w('  7.2 MB (over the 7 MB budget; accepted for v4.2);')
    w('* UVs: collapse decimation smears UVs across island seams, so every LOD face is re-projected onto ONE island')
    w('  of the full mesh\'s atlas (the island under its centre, on the same part; a face switches to the island its')
    w('  neighbours use when its corners lie on it too, for fewer seams) and its corners take that island\'s UV at')
    w('  their closest point — the baked atlas maps unchanged. Islands are not convex, so each face\'s UV triangle is')
    w('  then tested against a 1024² raster of its island; a face that would span empty atlas is shrunk round the texel')
    w('  under its centre until it lies on the island (orientation kept, so the tangent frame stays valid);')
    w('* normals: every LOD corner takes the full mesh\'s split normal at the closest point on a face of the same part')
    w('  facing the same way (custom normals). The decimated mesh\'s own smooth normals tilted where long triangles met')
    w('  a turned edge — the jackboot tops, where the shaft shared its top ring with the turned-in lip: the shaft')
    w('  caught the sun as white glints in the first v4.2 build;')
    w('* skin weights: from the full mesh at the nearest surface point on the same part facing the same way,')
    w('  barycentric, top 4, normalised.')
    for n, st in lods.items():
        lv = ver.get('lods', {}).get(n, {})
        w(f"* `{n}`: {lv.get('tris', st['tris'])} tris (full mesh {summary['tris'][n[:-4]]}); {st['dropped_parts']} small parts and "
          f"{st['culled_faces']} enclosed faces dropped before decimating {st['tris_before']} tris; "
          f"{st.get('uv_flattened_faces', 0)} faces' UVs shrunk onto their island; parent "
          f"`{lv.get('parent')}`, skin {lv.get('skin')} (full {lv.get('full_skin')}), material {lv.get('material')} "
          f"(full {lv.get('full_material')}), morph targets {lv.get('targets')}.")
    w('* Previews: `previews/soldier/{allied,axis}_lod_compare.png` — rows rest, aim, run, death_fwd; columns full 10 m,')
    w('  LOD 10 m, full 30 m, LOD 30 m (720 px, 60° vertical field of view, cropped and blown up pixel for pixel).')
    w('* `character.js` draws `<outfit>` near and `<outfit>_lod` far (switch at 30 m, back at 26 m; tests/lod-check.mjs);')
    w('  the LOD has no face shapes, so the per-soldier face only shows on the full mesh.')
    w('')
    w('### Bones (rest pose)')
    w('')
    w('Every bone: local **+Y runs along the bone** to its child (Blender convention, kept by the exporter:')
    w('a child whose head sits on its parent\'s tail has rest translation `(0, parent_length, 0)`). For `root`, `hips`, `spine`,')
    w('`chest`, `neck`, `head`, the arms and the legs the local **+Z points to the character\'s front** at rest')
    w('(three +Z) and **X = Y × Z**; for the feet +Z points up. So for `spine`/`chest` the local X axis is the')
    w('horizontal towards the character\'s left (three +X) and **a positive rotation about local X bends forward /')
    w('pitches the rifle down**; aim pitch up = negative angle about local X. (Legs point down, so their X')
    w('is three −X: + about X swings the leg back / bends the knee.)')
    w('')
    w('| bone | parent | head (glTF) | length | local X axis (glTF, rest) |')
    w('|---|---|---|---|---|')
    for b in sp.BONE_ORDER:
        par = summary['bone_parent'][b] or '—'
        w(f"| `{b}` | {('`' + par + '`') if par != '—' else par} | {fmt3(summary['bone_head'][b])} | "
          f"{summary['bone_len'][b]:.3f} | {fmt3(summary['bone_x'][b], 2)} |")
    w('')
    w('Upper/lower split as in the brief: legs = `root`, `hips`, `thigh_*`, `shin_*`, `foot_*`; upper =')
    w('`spine` … `hand_*`. The upper-body overlays key `spine` relative to `hips`, so the overlay inherits the')
    w('locomotion clip\'s hip sway (walk ±4° yaw).')
    w('')
    w('**Aim pitch**: apply it on `spine` about its local X: in `aim`/`crouch_aim` the spine has no yaw or roll')
    w('relative to the hips (the bladed shooter\'s twist, −30°, is all in `chest`), so spine-local X is the')
    w('horizontal axis perpendicular to the barrel and the muzzle stays on the centre line while pitching.')
    w('Pitching `chest` about its own local X would swing the muzzle sideways (chest is yawed).')
    w('')
    w('### Weapon sockets')
    w('')
    sl = ver['socket_local']
    w(f"`socket_weapon` (child of `hand_r`): translation {fmt3(sl['translation'], 4)}, rotation (x, y, z, w)")
    w(f"{fmt3(sl['rotation'], 4)}, scale 1. A weapon from weapons.glb added as its child with an identity")
    w('transform has its grip in the right palm, barrel forward, top up — the same placement the clips were')
    w('authored with (verified: socket world matrix in the GLB equals the Blender one converted to Y-up,')
    w(f"error {ver['socket_world_error']:.1e}). At rest the barrel points {summary['socket_barrel_vs_forearm']:.0f}° off the forearm axis")
    w('(the wrist is cocked as on a rifle wrist/pistol grip).')
    w('')
    sl2 = ver['socket_l_local']
    w(f"`socket_weapon_l` (child of `hand_l`, extra): translation {fmt3(sl2['translation'], 4)}, rotation")
    w(f"{fmt3(sl2['rotation'], 4)}. It is the left-hand grip frame expressed in weapon axes: put a weapon under")
    w('it with **position = −offhand anchor** (in the weapon\'s own glTF space) and identity rotation and the')
    w('weapon\'s `offhand` point sits in the left palm. `throw` is authored with the rifle there (move the rifle')
    w('to this socket for the throw and put the grenade on `socket_weapon`: its origin is its centre, which then')
    w('sits in the right fist).')
    w('')
    w('In every two-handed clip the left hand holds weapon-space point **(0, −0.215, −0.012) Blender =')
    w('(0, −0.012, 0.215) glTF** (the Garand\'s `offhand`); other weapons\' `offhand` anchors differ by a few cm')
    w('(table below) — close enough, or the game can IK the left hand to the anchor.')
    w('')
    w('### Actions (30 fps)')
    w('')
    w('Every clip keys rotation on all 20 bones (translation and scale channels are exported too, mostly')
    w('constant; `root` stays at the origin except in the deaths, `hips` carries the bob/crouch). Duration =')
    w('frames / 30; loops end on a key equal to the first (seam error 0).')
    w('')
    w('| action | frames | duration s | loop | helmet top m | hips m | notes |')
    w('|---|---|---|---|---|---|---|')
    for name in CLIP_ORDER:
        a = ver['animations'][name]
        st = diag['stats'][name]
        loop = 'yes' if name in LOOPS else ''
        w(f"| `{name}` | {round(a['duration'] * FPS)} | {a['duration']:.3f} | {loop} | "
          f"{st['top'][0]:.2f}–{st['top'][1]:.2f} | {st['hips'][0]:.2f}–{st['hips'][1]:.2f} | {CLIP_NOTES[name]} |")
    w('')
    am = diag['aim_muzzle']
    cm = diag['crouch_aim_muzzle']
    w(f"* `aim`, Garand on the socket: muzzle at Blender {fmt3(am)} = glTF {fmt3(sp.V((am[0], am[2], -am[1])))},")
    w(f"  barrel direction Blender {fmt3(diag['aim_barrel_dir'])} = glTF (0, 0, +1) — level, straight ahead.")
    w(f"  The aiming (right) eye is within {diag['clips'].get('aim_eye_err', 0) * 100:.1f} cm of the sight line; the butt")
    w('  sits in the right shoulder pocket, the bore 7 cm right of the centre line.')
    w(f"* `crouch_aim`: muzzle at Blender {fmt3(cm)} (kneeling, hips at 0.485 m).")
    w('* Locomotion clips are in place; the speeds in the table make the planted foot stand still.')
    w('* Deaths end lying on the ground: every frame of the three deaths was grounded so the lowest vertex of')
    w('  the body sits on z = 0 (max error < 1 mm); the right wrist is turned at the end so a rifle on')
    w('  `socket_weapon` lies flat just above the ground.')
    w('* Max IK wrist bend (deg) per clip: ' + ', '.join(f"{k} {max(v.values()) if v else 0:.0f}" for k, v in diag['wrist'].items() if v) + '.')
    w('')
    w('## weapons.glb (%d KB)' % (os.path.getsize(weapons_glb) // 1024))
    w('')
    w('Origin at the firing hand\'s grip (the MG 42: bipod feet centre), barrel along −Y Blender = +Z glTF,')
    w('top +Z Blender = +Y glTF. Anchors are in the node extras (`anchors`, JSON, glTF space). Grenades carry no')
    w('anchors. **v2**: each weapon is baked into one material named after it (1024² base/normal/MR, grenades')
    w('256²): blued steel worn bright at the edges, oiled walnut with grain and hand wear, leather slings with')
    w('keepers and brass hook frogs, Bakelite (MP 40 / MG 42 furniture), brass cartridges. Detail: Garand')
    w('en-bloc clip with two rounds showing, op-rod handle, aperture sight with knobs, gas cylinder, stacking')
    w('swivel; K98k turned-down bolt with knob, safety, hooded front sight, cleaning rod, finger grooves, butt')
    w('disc; Thompson M1A1 ribbed 30-round magazine, protected sight, grooved fore-end; MP 40 ribbed receiver')
    w('tube, rest bar, folding stock; MG 42 jacket with real oval cooling holes, belt drum with rounds, bipod,')
    w('feed cover, cocking handle; Mk 2 segmented body with spoon and pin; Stielhandgranate with cap.')
    w('')
    w('| node | size x × y × z (m) | tris | materials | anchors (glTF) |')
    w('|---|---|---|---|---|')
    for n in [k for k in sp.WEAPONS + sp.PROP_NAMES if k in summary['weapons']]:
        d = summary['weapons'][n]
        mn, mx = d['bounds']
        an = '; '.join(f"`{k}` {fmt3(v)}" for k, v in d['anchors'].items()) or '—'
        w(f"| `{n}` | {mx[0]-mn[0]:.2f} × {mx[1]-mn[1]:.2f} × {mx[2]-mn[2]:.2f} | {d['tris']} | "
          f"{', '.join(d['materials'])} | {an} |")
    w('')
    w('* `mg42`: the extra `grip` anchor is the pistol grip (firing hand); `offhand` is on top of the stock.')
    w('')
    w('### Reload props (v3)')
    w('')
    w('`garand_clip` (en-bloc with 8 rounds), `kar98k_clip` (stripper clip with 5 rounds), `thompson_mag`')
    w('(30-round stick), `mp40_mag`: each has its origin at the point the left hand holds it and is oriented to')
    w('sit in **`socket_weapon_l` with an identity transform** (unlike the guns, which go under that socket at')
    w('−offhand). New anchors (glTF, gun space): `m1_garand.clip`, `kar98k.clip` = where the clip is held when')
    w('it seats; `thompson.mag`, `mp40.mag` = where the magazine is held when seated.')
    w('')
    w('**The SMG magazines are now separate child nodes** of their guns: `thompson` → `thompson_mag_seated`,')
    w('`mp40` → `mp40_mag_seated` (same mesh as the prop). Cloning the gun node with its children shows the')
    w('magazine as before. Their local transforms (Blender, rows of the 3×4 matrix):')
    for n, M in summary.get('seated', {}).items():
        w(f"  `{n}_seated`: {M}")
    w('The Garand keeps its clip in the receiver as part of the mesh; the prop is pushed into it and hidden.')
    w('')
    w('Event frames (also in the `rig` node extras, `reload_events`):')
    w('')
    w('| clip | event | frame | what the game does |')
    w('|---|---|---|---|')
    ev = sp.RELOAD_EVENTS
    rows = [('reload', 'clip_in_hand', 'show `garand_clip` (or `kar98k_clip`) on `socket_weapon_l`'),
            ('reload', 'clip_seated', 'hide the prop: it now coincides with the clip in the receiver'),
            ('reload', 'oprod_slap', 'bolt-closing sound'),
            ('reload_smg', 'mag_grab', 'move `*_mag_seated` under `socket_weapon_l` (identity transform)'),
            ('reload_smg', 'mag_out', 'magazine clear of the well'),
            ('reload_smg', 'mag_drop', 'release it (drop to the ground / hide)'),
            ('reload_smg', 'new_mag_in_hand', 'show a fresh `*_mag` on `socket_weapon_l`'),
            ('reload_smg', 'mag_seated', 'put the magazine back under the gun at the `_seated` transform'),
            ('reload_smg', 'bolt_back', 'bolt-racking sound')]
    for clip, e, what in rows:
        w(f"| `{clip}` | `{e}` | {ev[clip][e]} | {what} |")
    w('')
    pe = diag.get('prop_seat_error', {})
    if pe:
        w('Check at the seat frames (prop in the hand vs its seat in the gun): ' +
          ', '.join(f"{k}: {v['pos_mm']} mm / {v['rot_deg']}°" for k, v in pe.items()) + '.')
        w('The clips are authored with the Garand / Thompson; the K98k clip and the MP 40 magazine seat within a')
        w('few centimetres of the same hand positions.')
    w('* `grenade_us`: fuze up (+Y glTF), spoon on +X. `grenade_de`: head towards −Y Blender (+Z glTF), origin')
    w('  at the centre of mass.')
    w('* Before the bake the Mk 2 body is `metal_olive`, the stick grenade head `metal_gray`; stocks `walnut`,')
    w('  MP 40 / MG 42 furniture `bakelite`, cartridges `brass` (keys registered by this set).')
    w('')
    w('## kit.py')
    w('')
    for line in KIT_NOTES:
        w('* ' + line)
    w('')
    os.makedirs(os.path.dirname(NOTES), exist_ok=True)
    with open(NOTES, 'w') as fh:
        fh.write('\n'.join(L))
    kit.log('notes', os.path.relpath(NOTES, kit.ROOT))


def bake_weapons_for_previews(args):
    return 'previews' in args


def attach_to(obj, socket, offset=None):
    obj.parent = socket
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Translation(offset) if offset is not None else Matrix.Identity(4)
    obj.hide_render = False


def main():
    args = kit.args_after_dashes()
    if 'notes' in args:                    # regenerate the notes from the last build's summary
        with open(os.path.join(os.environ.get('TMPDIR', '/tmp'), 'hedgerow_soldier_summary.json')) as fh:
            summary = json.load(fh)
        write_notes(summary, None, os.path.join(kit.MODELS, 'weapons.glb'))
        return
    do_soldier = 'weapons' not in args or 'soldier' in args
    do_weapons = 'soldier' not in args or 'weapons' in args
    previews = 'nopreview' not in args
    quick = 'quick' in args
    scene = kit.reset()
    scene.render.fps = FPS
    summary = {}

    weapons = {}
    sp.register_surfaces()
    if True:     # the soldier previews need the rifle and grenade too
        import bake
        for n in sp.WEAPONS:
            weapons[n] = sp.WEAPON_BUILDERS[n]()
        for n in sp.PROP_NAMES:
            weapons[n] = sp.build_prop(n)
        names = sp.WEAPONS + sp.PROP_NAMES
        if do_weapons or bake_weapons_for_previews(args):
            for n in names:
                r = bake.bake_model(weapons[n], size=sp.WEAPON_TEX[n], ao_distance=0.04, ground=False,
                                    bevel=0.0025, samples_ao=24)
                weapons[n] = r['object']
        # the SMG magazines ride in their guns as child nodes sharing the prop mesh
        seated = {}
        for n in sp.PROP_NAMES:
            d = sp.PROPS[n]
            if not d['seated']:
                continue
            ch = kit.link(bpy.data.objects.new(n + '_seated', weapons[n].data))
            ch.parent = weapons[d['gun']]
            ch.matrix_parent_inverse = Matrix.Identity(4)
            ch.matrix_basis = sp.prop_seat(n)
            seated[n] = ch
        if do_weapons:
            kit.export([weapons[n] for n in names], os.path.join(kit.MODELS, 'weapons.glb'), images=True)
            summary['weapons'] = {n: {'tris': kit.tri_count(o) + sum(kit.tri_count(c) for c in o.children),
                                      'bounds': [list(b) for b in kit.bounds(o)],
                                      'anchors': json.loads(o.get('anchors', '{}'))} for n, o in weapons.items()}
            summary['seated'] = {n: [[round(c.matrix_basis[r][k], 5) for k in range(4)] for r in range(3)]
                                 for n, c in seated.items()}

    if do_soldier:
        rig = sp.build_rig('rig')
        sk = sp.Skel(rig)
        clips = sp.Clips(sk)
        data = clips.all()                       # also picks the socket / grips
        s_r = make_socket(rig, 'socket_weapon', 'hand_r', sk.rest['hand_r'] @ clips.socket)
        socket_l = sk.grip['l'] @ sp.lgrip_socket().inverted()
        s_l = make_socket(rig, 'socket_weapon_l', 'hand_l', sk.rest['hand_l'] @ socket_l)
        import bake
        allied, parts_a = sp.build_allied2(None)
        axis, parts_x = sp.build_axis2(None)
        tex = {}
        for o in (allied, axis):                  # bake in the rest pose, before skinning
            r = bake.bake_model(o, size=OUTFIT_TEX, ao_distance=0.25, bevel=0.004, samples_ao=48,
                                scale_islands=sp.island_scaler(UV_BOOST))
            assert r['object'] is o
            tex[o.name] = {k: (v.size[0] if v is not None and hasattr(v, 'size') else None)
                           for k, v in r.items() if k in ('base', 'normal', 'mr')}
        summary['textures'] = tex
        # v4.2: distance LODs from the baked meshes (same material and atlas, no morphs)
        lods = {}
        summary['lod'] = {}
        for o in (allied, axis):
            lod, st = sp.make_lod(o, o.name + '_lod', LOD_TRIS)
            lods[o.name] = lod
            summary['lod'][lod.name] = st
            kit.log('lod', lod.name, json.dumps(st))
        for o in (allied, axis) + tuple(lods.values()):
            sp.attach_rig(o, rig)
        meshes = [allied, axis]
        kit.log('tris allied', kit.tri_count(allied), 'axis', kit.tri_count(axis))
        diag = {'reach': {}, 'wrist': {}}
        for name in CLIP_ORDER:
            frames = data[name]
            mx_reach, mx_wrist = {}, {}
            for P in frames:
                sol = clips.solve(P)
                for k, r in sol.reach.items():
                    mx_reach[k] = max(mx_reach.get(k, 0), r)
                for k, w in sol.wrist.items():
                    mx_wrist[k] = max(mx_wrist.get(k, 0), w)
            diag['reach'][name] = {k: round(v, 3) for k, v in mx_reach.items()}
            diag['wrist'][name] = {k: round(v, 1) for k, v in mx_wrist.items()}
            write_clip(rig, sk, clips, name, frames)
        diag['clips'] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in clips.diag.items()}
        diag['ground_deaths'] = ground_deaths(rig, sk, clips, data, meshes)
        diag['lay_rifle'] = lay_rifle(rig, sk, clips, data, meshes, s_r, rifle_verts(weapons['m1_garand']))
        diag['ground_deaths2'] = ground_deaths(rig, sk, clips, data, meshes)
        diag['ground'] = clip_ground_report(rig, meshes)
        # aim muzzle check
        set_action(rig, bpy.data.actions['aim'])
        scene.frame_set(0)
        bpy.context.view_layer.update()
        W = s_r.matrix_world
        diag['aim_muzzle'] = [round(x, 3) for x in (W @ sp.GARAND_MUZZLE)]
        diag['aim_barrel_dir'] = [round(x, 3) for x in (W.to_3x3() @ V((0, -1, 0)))]
        set_action(rig, bpy.data.actions['crouch_aim'])
        scene.frame_set(0)
        bpy.context.view_layer.update()
        W = s_r.matrix_world
        diag['crouch_aim_muzzle'] = [round(x, 3) for x in (W @ sp.GARAND_MUZZLE)]
        # props: at the seat frames the prop in the left hand must coincide with its seat in the gun
        diag['prop_seat_error'] = {}
        for act, fr, prop in (('reload', sp.RELOAD_EVENTS['reload']['clip_seated'], 'garand_clip'),
                              ('reload_smg', sp.RELOAD_EVENTS['reload_smg']['mag_seated'], 'thompson_mag'),
                              ('reload_smg', sp.RELOAD_EVENTS['reload_smg']['mag_grab'], 'thompson_mag')):
            set_action(rig, bpy.data.actions[act])
            scene.frame_set(fr)
            bpy.context.view_layer.update()
            A = s_l.matrix_world                                   # prop under socket_weapon_l
            B = s_r.matrix_world @ sp.prop_seat(prop)               # seated in the gun on socket_weapon
            diag['prop_seat_error'][f'{act}@{fr}'] = {
                'pos_mm': round((A.translation - B.translation).length * 1000, 2),
                'rot_deg': round(math.degrees(A.to_quaternion().rotation_difference(B.to_quaternion()).angle), 2)}
        rig['reload_events'] = json.dumps(sp.RELOAD_EVENTS)
        diag['eyes'] = eye_checks(rig, meshes, s_r)
        diag['morph_stats'] = {o.name: morph_stats(o) for o in meshes}
        diag['face'] = sp.face4_measure()
        diag['stats'] = clip_stats(rig, allied, s_r)
        kit.log(json.dumps(diag, indent=1, default=str))
        summary['diag'] = diag

        set_action(rig, bpy.data.actions['idle'])
        out = os.path.join(kit.MODELS, 'soldier.glb')
        export_soldier([rig, allied, axis, s_r, s_l] + list(lods.values()), out)
        ver, j = verify_soldier(out)
        # socket placement check: glTF world == C @ blender world @ C^-1
        set_action(rig, None)
        for pb in rig.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
        Gs = gltf_world(j, 'socket_weapon')
        Bs = C @ s_r.matrix_world @ C.inverted()
        ver['socket_world_error'] = max(abs(Gs[r][c] - Bs[r][c]) for r in range(4) for c in range(4))
        ver['socket_world_gltf'] = [[round(Gs[r][c], 4) for c in range(4)] for r in range(3)]
        ver['bone_heads_gltf'] = {}
        for b in sp.BONE_ORDER:
            Mw = gltf_world(j, b)
            ver['bone_heads_gltf'][b] = [round(x, 4) for x in Mw.translation]
        ver['spine_local_axes_gltf'] = [[round(x, 3) for x in gltf_world(j, 'spine').to_3x3().col[i]] for i in range(3)]
        summary['verify'] = ver
        summary['tris'] = {'allied': kit.tri_count(allied), 'axis': kit.tri_count(axis),
                           'parts_allied': parts_a, 'parts_axis': parts_x}
        summary['socket_blender'] = [[round(s_r.matrix_world[r][c], 4) for c in range(4)] for r in range(3)]
        summary['socket_l_blender'] = [[round(s_l.matrix_world[r][c], 4) for c in range(4)] for r in range(3)]
        summary['size_kb'] = os.path.getsize(out) // 1024
        summary['bounds'] = {o.name: [list(b) for b in kit.bounds(o)] for o in meshes}
        summary['materials'] = {o.name: [m.name for m in o.data.materials] for o in meshes}
        summary['bone_parent'] = dict(sk.parent)
        summary['bone_len'] = dict(sk.length)
        summary['bone_head'] = {b: ver['bone_heads_gltf'][b] for b in sp.BONE_ORDER}
        summary['bone_x'] = {b: list(gltf_world(j, b).to_3x3().col[0]) for b in sp.BONE_ORDER}
        fa = (sk.tail('forearm_r') - sk.head('forearm_r')).normalized()
        bd = (sk.rest['hand_r'] @ clips.socket).to_3x3() @ V((0, -1, 0))
        summary['socket_barrel_vs_forearm'] = math.degrees(fa.angle(bd))
        summary['kit_notes'] = KIT_NOTES
        kit.log(json.dumps({k: v for k, v in ver.items() if k not in ('nodes', 'bone_heads_gltf')}, indent=1))

        if 'save' in args:                   # before the previews, so they can be redone from the file
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ.get('TMPDIR', '/tmp'), 'hedgerow_soldier.blend'))
        if previews:
            add_preview_vertex_colour([m for m in bpy.data.materials])
            gar = weapons['m1_garand']
            gren = weapons['grenade_us']
            for w in weapons.values():
                w.hide_render = True
            for outfit in ([allied, axis] if not quick else [allied]):
                others = [o for o in meshes if o is not outfit]
                attach_to(gar, s_r)
                gren.hide_render = True
                render_pose(rig, outfit, others, None, 0, [], 'rest')
                render_pose(rig, outfit, others, None, 0, [], 'rest', views=('face', 'close', 'face_front', 'face_34',
                                                                         'face_side'))
                for k in sp.MORPHS:                 # each face shape at weight 1, then two blends
                    set_face(outfit, {k: 1.0})
                    render_pose(rig, outfit, others, None, 0, [], 'rest_' + k, views=('face_front', 'face_34', 'face_side'))
                for tag, wts in (('broad_older', {'face_broad': 1.0, 'face_older': 0.9}),
                                 ('gaunt_older', {'face_gaunt': 1.0, 'face_older': 0.9})):
                    set_face(outfit, wts)
                    render_pose(rig, outfit, others, None, 0, [], 'rest_' + tag, views=('face_34',))
                set_face(outfit, {})
                summary.setdefault('lineup', {})[outfit.name] = face_lineup(rig, outfit, others)
                render_pose(rig, outfit, others, 'idle', 0, [gar], 'idle')
                render_pose(rig, outfit, others, 'aim', 0, [gar], 'aim')
                render_pose(rig, outfit, others, 'run', 5, [gar], 'run')
                render_pose(rig, outfit, others, 'crouch_aim', 0, [gar], 'crouch_aim')
                # v4: joints up close (shoulders, elbows, hips, knees)
                render_pose(rig, outfit, others, 'aim', 0, [gar], 'aim', views=('upper', 'upper_back'))
                render_pose(rig, outfit, others, 'crouch_idle', 0, [gar], 'crouch_idle', views=('legs', 'upper'))
                render_pose(rig, outfit, others, 'run', 5, [gar], 'run', views=('legs',))
                render_pose(rig, outfit, others, 'death_fwd', 40, [gar], 'death_fwd', lie=True)
                lod_compare(rig, outfit, lods[outfit.name], others + [l for l in lods.values() if l is not lods[outfit.name]],
                            gar)
                attach_to(gar, s_l, -sp.GARAND_OFFHAND)
                attach_to(gren, s_r)
                render_pose(rig, outfit, others, 'throw', 15, [gar, gren], 'throw')
                render_pose(rig, outfit, others, 'throw', 8, [gar, gren], 'throw_f08', views=('upper', 'upper_back'))
                gren.hide_render = True
                attach_to(gar, s_r)
                # reloads from behind the right shoulder (the game's view) with the props
                clip_p, tmag, tgun = weapons['garand_clip'], weapons['thompson_mag'], weapons['thompson']
                tseat = [c for c in tgun.children][0]
                ev = sp.RELOAD_EVENTS
                for fr in (8, ev['reload']['clip_in_hand'] + 4, 31, ev['reload']['clip_seated'], ev['reload']['oprod_slap']):
                    on_l = fr <= ev['reload']['clip_seated'] and fr > ev['reload']['clip_in_hand']
                    if on_l:
                        attach_to(clip_p, s_l)
                    render_pose(rig, outfit, others, 'reload', fr, [gar] + ([clip_p] if on_l else []),
                                f'reload_f{fr:02d}', views=('shoulder',))
                    clip_p.hide_render = True
                gar.hide_render = True
                attach_to(tgun, s_r)
                for fr in (8, ev['reload_smg']['mag_out'], ev['reload_smg']['new_mag_in_hand'] + 3, 41,
                           ev['reload_smg']['mag_seated'], ev['reload_smg']['bolt_back']):
                    in_hand = ev['reload_smg']['mag_grab'] < fr < ev['reload_smg']['mag_seated']
                    tseat.hide_render = in_hand
                    if in_hand and not (ev['reload_smg']['mag_drop'] <= fr < ev['reload_smg']['new_mag_in_hand']):
                        attach_to(tmag, s_l)
                    render_pose(rig, outfit, others, 'reload_smg', fr, [tgun] + ([tmag] if not tmag.hide_render else []),
                                f'reload_smg_f{fr:02d}', views=('shoulder',))
                    tmag.hide_render = True
                tseat.hide_render = False
                tgun.hide_render = True
                attach_to(gar, s_r)
                if not quick:
                    for nm, fr in (('walk', 8), ('crouch_idle', 0), ('crouch_walk', 9),
                                   ('death_back', 40), ('death_crumple', 36), ('strafe_l', 7)):
                        render_pose(rig, outfit, others, nm, fr, [gar], nm, views=('back34',),
                                    lie=nm.startswith('death'))
            for o in meshes:
                o.hide_render = False

    if do_weapons and previews:
        for n in sp.WEAPONS + sp.PROP_NAMES:
            w = weapons[n]
            w.parent = None
            w.matrix_world = Matrix.Identity(4)
            w.hide_render = False
            mn, mx = kit.bounds(w)
            c = (mn + mx) / 2
            L = max((mx - mn).length, 0.12)
            for tag, d in (('', V((-0.80, -0.30, 0.28))), ('_close', V((-0.30, -0.12, 0.10)))):
                if tag and L < 0.3:
                    continue
                tgt = c if not tag else c + V((0, -L * 0.18, 0))
                cam = tgt + d.normalized() * L * (1.12 if not tag else 0.42)
                try:
                    sp.render_view([w], os.path.join(PREV, f'{n}{tag}.png'), cam, tgt, lens=50, size=768, samples=24,
                                   floor=False)
                except RuntimeError as e:
                    kit.log('WARNING preview failed', n, str(e)[:120])
            w.hide_render = True

    if do_soldier and do_weapons:
        for n in sp.WEAPONS + sp.PROP_NAMES:
            summary['weapons'][n]['materials'] = [m.name for m in weapons[n].data.materials]
        write_notes(summary, j, os.path.join(kit.MODELS, 'weapons.glb'))
    with open(os.path.join(os.environ.get('TMPDIR', '/tmp'), 'hedgerow_soldier_summary.json'), 'w') as fh:
        json.dump(summary, fh, indent=1, default=str)
    kit.log('done')


main()
