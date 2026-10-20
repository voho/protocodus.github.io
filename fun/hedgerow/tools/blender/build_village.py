"""Hedgerow — build the `village` set -> assets/models/village.glb.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
        --python fun/hedgerow/tools/blender/build_village.py [-- [node ...] [--no-preview] [--dev]]

No node names: build everything, export the GLB, render every preview and
the houses overviews. With node names: still build and export the whole GLB
(it is cheap, ~2 s) but only preview the named nodes ('overview' is a name
too). `--dev`: build only the named nodes and skip the export (iteration).
`--no-preview`: skip the deliverable previews.

Review renders into $TMPDIR (not deliverables): `--street` (eye-level shots),
`--detail` (belfry/bridge/barn/ruin close-ups), `--colliders` (colliders and
anchors drawn in), `--normals` (back faces seen by the camera glow magenta).

See notes/village.md for the node table, origins, footprints and colliders.
"""
import math, os, random, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Matrix
import kit
import village_parts as P

V = Vector
PREV = os.path.join(kit.PREVIEWS, 'village')
QUALITY = 80                       # WebP quality of the baked textures in the GLB


# ==========================================================================
# Houses

HERO = 2560        # atlas size of the street houses (v3: sharper at 2 m)


def _v3_dress(m, block, W, D, z_e, wall, cx=0.0, rubble=False, eaves=('front', 'back'), z_eave=None, seed=0, n_stones=22,
              drop_top=True):
    """v3 finishing of a solid house block: drop the hidden top of the block,
    gutter run-off stains under the eaves, irregular proud stones on rubble
    walls (crowded at the corners and the foot)."""
    if drop_top:             # the top of the solid block is under the roof
        P.drop_faces(block, lambda c, n: n.z > 0.2 and c.z > z_e - 0.05)
    T = Matrix.Translation((cx, 0, 0))
    for i, face in enumerate(('front', 'back', 'left', 'right')):
        F = T @ P.face_frame(face, W, D)
        span = W if face in ('front', 'back') else D
        if face in eaves:
            m.eave_stain(F, -span / 2 + 0.08, span / 2 - 0.08, z_eave if z_eave is not None else z_e - 0.08, wall, seed=seed + i)
        if rubble:
            m.add(*P.proud_stones(F, -span / 2, span / 2, 0.15, z_e - 0.2, n_stones, seed=seed * 10 + i))



def build_house_a():
    """Two-storey Norman stone farmhouse: rubble walls, long-and-short dressed
    jambs, plank shutters on pintles, a studded door on two steps, an old tile
    roof with ridge tiles, a few tiles gone, gutters on brackets, ivy."""
    m = P.Model('house_a', seed=11)
    W, D, z_e, rise = 8.4, 5.7, 5.6, 3.15
    cut = []
    block = P.gable_block(W, D, z_e, rise, 'stone_dark')
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        P.quoins(m, sx * W / 2, sy * D / 2, sx, sy, 0.0, z_e, mat='ashlar', seed=20 + i)
    m.box((W + 0.08, D + 0.08, 0.35), (0, 0, 0.175), mat='ashlar')
    F = P.face_frame('front', W, D)
    kw = dict(surround='jambs', surround_mat='ashlar', shutter_mat='shutter_green', reveal='stone_dark', p=0.03, bt=0.3)
    P.door(m, F, 0.0, 1.05, 2.3, cut, kind='segment', rise=0.2, leaf_mat='door_green', keystone=True,
           anchor='door', fanlight=True, b=0.2, reveal='stone_dark', z0=0.3, step_d=0.7)
    P.window(m, F, -2.6, 0.95, 1.0, 1.45, cut, shutters='open', lit=True, lamp='lamp_1', angles=(174, 169), **kw)
    P.window(m, F, 2.6, 0.95, 1.0, 1.45, cut, shutters='ajar', angles=(118, 150), **kw)
    P.window(m, F, -2.6, 3.7, 0.95, 1.3, cut, shutters='closed', **kw)
    P.window(m, F, 0.0, 3.7, 0.95, 1.3, cut, shutters='open', lit=True, lamp='lamp_2', angles=(171, 176), **kw)
    P.window(m, F, 2.6, 3.7, 0.95, 1.3, cut, shutters='open', angles=(165, 172), hang='right', **kw)
    P.flower_box(m, F, -2.6, 0.84, 1.15, seed=3)
    for x in (-1.3, 1.3):
        P.tie_plate(m, F, x, 3.15, 'X', seed=int(x * 10))
    cut += P.pocks(F, 3.4, 2.0, 14, 0.35, seed=5, mat='stone')
    cut += P.chips(F, W / 2 - 0.05, 0.5, 2.5, seed=6)
    Fb = P.face_frame('back', W, D)
    P.window(m, Fb, -1.6, 0.95, 0.9, 1.3, cut, shutters='open', lit=True, lamp='lamp_3', **kw)
    P.window(m, Fb, 1.9, 3.7, 0.85, 1.2, cut, shutters='closed', **kw)
    P.door(m, Fb, 2.0, 0.9, 2.1, cut, leaf_mat='board_old', surround='jambs', surround_mat='ashlar', lintel_mat='oak_beam',
           reveal='stone_dark', z0=0.15)
    Fl = P.face_frame('left', W, D)
    kw2 = {k: v for k, v in kw.items() if k != 'shutter_mat'}
    P.window(m, Fl, 0.0, 6.15, 0.55, 0.75, cut, shutters=None, bars=(1, 1), **kw2)
    Fr = P.face_frame('right', W, D)
    P.window(m, Fr, -1.0, 1.1, 0.7, 0.95, cut, shutters='closed', **kw)
    m.add(P.ivy_cards(Fl, -2.7, 1.2, 0.0, 3.4, 26, seed=4))
    hole_cut = []
    P.gable_roof(m, W, D, z_e, rise, oe=0.4, og=0.22, t=0.17, mat='roof_tile', sag=0.09, seed=5, kick=0.16,
                 downpipes=((-1, -W / 2 + 0.25), (1, W / 2 - 0.25)),
                 missing=((-1, 1.6, 0.45), (-1, 2.0, 0.62), (1, -2.2, 0.5), (-1, -1.4, 0.12), (-1, 3.4, 0.16)),
                 slipped=((-1, -3.0, 0.08), (-1, -1.6, 0.05), (-1, 2.6, 0.04)))
    cutter = kit.join(cut, 'cutters')
    P.cut(block, cutter)
    m.add(block)
    _v3_dress(m, block, W, D, z_e, 'stone_dark', rubble=True, seed=1, n_stones=14)
    zr = z_e + rise
    P.chimney(m, -W / 2 + 0.55, 0.15, zr - 1.0, zr + 0.95, w=0.75, d=0.6, mat='stone', pots=2, seed=2, flash_z=zr - 0.15, cowl=True)
    P.chimney(m, W / 2 - 0.5, 0.0, zr - 1.0, zr + 0.75, w=0.65, d=0.55, mat='stone', pots=1, seed=3, flash_z=zr - 0.12)
    m.col_box((0, 0, z_e / 2), (W, D, z_e))
    return m.build(grime=0.42, grime_height=1.4, jitter=0.03, jitter_scale=0.3, size=HERO)


def build_house_b():
    """Narrow two-storey town house: plaster with stone quoins, a slate roof
    with a dormer, a painted shop front with a lit display window full of
    goods, the awning frame with its rolled canvas, balconettes, louvred
    shutters, an enamel sign and a wall lantern."""
    m = P.Model('house_b', seed=12)
    W, D, z_e, rise = 5.8, 7.6, 6.5, 2.75
    cut = []
    block = P.gable_block(W, D, z_e, rise, 'plaster')
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        P.quoins(m, sx * W / 2, sy * D / 2, sx, sy, 0.5, z_e, mat='ashlar', seed=40 + i, long=0.5, short=0.28, hmin=0.4, hmax=0.48)
    m.box((W + 0.1, D + 0.1, 0.5), (0, 0, 0.25), mat='stone_dark')            # plinth
    m.box((W + 0.1, D + 0.1, 0.16), (0, 0, 3.62), mat='ashlar')                 # string course
    m.box((W + 0.12, D + 0.12, 0.14), (0, 0, z_e - 0.07), mat='ashlar')         # eaves cornice
    F = P.face_frame('front', W, D)
    y0 = -D / 2
    P.shopfront(m, F, -2.45, 2.45, 3.0, cut, paint='shutter_red', windows=((-0.74, 2.9),), door_x=1.56, door_w=0.92,
                lamps=('lamp_1',), goods='shop', seed=12)
    # awning frame: two iron arms, a front bar and the rolled canvas under the fascia
    for xx in (-2.15, 2.15):
        m.add(P.sweep([(xx, y0 - 0.02, 2.88), (xx, y0 - 1.15, 2.5)], P.circle_profile(0.022, 5), 'iron_black', 'arm', up=(1, 0, 0)))
        m.add(P.sweep([(xx, y0 - 0.02, 2.5), (xx, y0 - 0.6, 2.69)], P.circle_profile(0.016, 4), 'iron_black', 'strut', up=(1, 0, 0)))
    m.add(P.sweep([(-2.2, y0 - 1.15, 2.5), (2.2, y0 - 1.15, 2.5)], P.circle_profile(0.022, 5), 'iron_black', 'bar'))
    m.add(P.sweep([(-2.25, y0 - 0.22, 2.84), (2.25, y0 - 0.22, 2.84)], P.circle_profile(0.11, 7), 'canvas', 'roll'))
    P.enamel_sign(m, F, 2.62, 2.2, 0.36, 0.5, colour='enamel_blue', seed=2)
    lan, lp = P.wall_lantern(F, -2.65, 2.6, lit=False)
    m.add(*lan)
    m.anchor('lantern', lp)
    # upper floor: tall French windows with balconettes and louvred shutters
    kw = dict(surround_mat='ashlar', b=0.14, bt=0.22, shutter_mat='shutter_blue', shutter_style='louvre', reveal='plaster')
    P.window(m, F, -1.35, 4.05, 1.0, 1.95, cut, shutters='open', angles=(173, 170), rail=0.95, bars=(1, 3),
             lit=True, lamp='lamp_2', keystone=True, **kw)
    P.window(m, F, 1.35, 4.05, 1.0, 1.95, cut, shutters='closed', rail=0.95, bars=(1, 3), keystone=True, **kw)
    cut += P.pocks(F, -0.2, 5.4, 16, 0.45, seed=8, mat='stone')
    cut += P.pocks(F, 2.4, 1.9, 7, 0.2, seed=9, mat='stone')
    cut += P.chips(F, -W / 2 + 0.05, 3.8, 6.0, seed=10)
    P.tie_plate(m, F, 0.0, 3.75, 'S', seed=1)
    Fb = P.face_frame('back', W, D)
    kw2 = dict(kw, shutter_style='planks', shutter_mat='shutter_grey')
    P.window(m, Fb, 1.3, 1.0, 0.9, 1.35, cut, shutters='open', angles=(160, 172), **kw2)
    P.door(m, Fb, -1.3, 0.9, 2.15, cut, leaf_mat='board_old', surround_mat='ashlar', b=0.12, reveal='plaster')
    P.window(m, Fb, -1.3, 4.2, 0.9, 1.5, cut, shutters='ajar', angles=(110, 165), **kw2)
    P.window(m, Fb, 1.3, 4.2, 0.9, 1.5, cut, shutters='closed', **kw2)
    Fr = P.face_frame('right', W, D)
    P.window(m, Fr, 1.5, 4.4, 0.7, 1.0, cut, shutters='closed', **kw2)
    P.plaster_patch(m, Fb, 0.2, 2.9, 0.5, 0.35, 'stone', seed=5)
    P.wall_breach(m, P.face_frame('left', W, D), 0.6, 4.8, 0.85, cut, seed=31, floor_z=3.55)
    P.cut(block, kit.join(cut, 'cutters'))
    m.add(block)
    _v3_dress(m, block, W, D, z_e, 'plaster', seed=2)
    P.gable_roof(m, W, D, z_e, rise, oe=0.3, og=0.15, t=0.13, mat='roof_slate', sag=0.05, seed=6,
                 ridge_mat='lead', ridge_r=0.08, downpipes=((-1, W / 2 - 0.3), (1, -W / 2 + 0.3)), kick=0.1,
                 missing=((1, 1.2, 0.4), (-1, -1.6, 0.1)))
    # dormer on the front slope
    yf = -D / 2 + 0.75
    zroof = z_e + rise * (0.75 / (D / 2)) + 0.15
    P.dormer(m, P.frame((0, yf, 0), 0), 1.5, 7.0, zroof, 2.3, wall_mat='plaster', roof_mat='roof_slate', cheek_mat='roof_slate')
    zr = z_e + rise
    P.chimney(m, -W / 2 + 0.35, 0.6, zr - 1.2, zr + 0.75, w=0.6, d=1.0, mat='stone', pots=3, seed=4, flash_z=zr - 0.3)
    P.chimney(m, W / 2 - 0.35, -0.5, zr - 1.4, zr + 0.45, w=0.6, d=0.8, mat='plaster', cap_mat='stone', pots=2, seed=5, flash_z=zr - 0.4)
    m.col_box((0, 0, z_e / 2), (W, D, z_e))
    return m.build(grime=0.38, grime_height=1.3, jitter=0.02, size=HERO)


def build_house_c():
    """Wide two-storey double house: dirty plaster with brick quoins and
    segmental brick heads, two doors, a lean-to with a corrugated roof; a
    shell has gone through the front slope of the tile roof."""
    m = P.Model('house_c', seed=13)
    W, D, z_e, rise = 8.2, 6.2, 5.4, 2.85
    cx = -1.2                                   # main block centre (lean-to at +X)
    cut = []
    block = P.gable_block(W, D, z_e, rise, 'plaster_dirty')
    block.location.x = cx
    kit.apply_transform(block)
    m.box((W + 0.08, D + 0.08, 0.6), (cx, 0, 0.3), mat='stone_dark')           # tarred plinth
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        P.quoins(m, cx + sx * W / 2, sy * D / 2, sx, sy, 0.6, z_e, mat='brick', seed=60 + i, long=0.42, short=0.24,
                 hmin=0.34, hmax=0.4, p=0.025)
    m.box((W + 0.1, D + 0.1, 0.12), (cx, 0, 3.0), mat='brick')                 # brick band at the floor
    F = P.face_frame('front', W, D) @ Matrix.Translation((cx, 0, 0))
    kw = dict(kind='segment', rise=0.12, n=3, surround_mat='brick', b=0.12, bt=0.2, sill_mat='ashlar',
              shutter_mat='shutter_grey', shutter_style='planks', reveal='plaster_dirty')
    P.window(m, F, -3.1, 1.0, 0.95, 1.4, cut, shutters='open', lit=True, lamp='lamp_1', **kw)
    P.door(m, F, -1.7, 0.95, 2.25, cut, kind='segment', rise=0.12, n=3, surround_mat='brick', b=0.13, leaf_mat='door_green',
           fanlight=True, anchor='door', step_mat='ashlar_step', reveal='plaster_dirty')
    P.window(m, F, 0.05, 1.0, 0.95, 1.4, cut, shutters='closed', **kw)
    P.door(m, F, 1.55, 0.9, 2.2, cut, kind='segment', rise=0.12, n=3, surround_mat='brick', b=0.13, leaf_mat='board_old',
           step_mat='ashlar_step', canopy='roof_tile', anchor='door_2', reveal='plaster_dirty')
    P.window(m, F, 3.05, 1.0, 0.95, 1.4, cut, shutters='ajar', angles=(125, 172), **kw)
    for i, (u, sh, lit) in enumerate(((-3.1, 'open', False), (-1.0, 'left', True), (1.05, None, False), (3.05, 'closed', False))):
        P.window(m, F, u, 3.55, 0.9, 1.3, cut, shutters=sh, angles=(170, 167), lit=lit, lamp='lamp_2' if lit else None, **kw)
    P.flower_box(m, F, 0.05, 0.89, 1.1, seed=13)
    for x in (-2.0, 2.2):
        P.tie_plate(m, F, x, 3.05, 'bar', seed=int(x * 7))
    P.enamel_sign(m, F, 0.8, 2.25, 0.5, 0.32, colour='enamel_red', seed=13)
    cut += P.pocks(F, 2.3, 2.6, 18, 0.5, seed=14, mat='stone')
    cut += P.pocks(F, -2.4, 4.4, 9, 0.3, seed=15, mat='stone')
    cut += P.chips(F, -W / 2 + 0.05, 0.8, 4.5, seed=16, n=4)
    Fb = P.face_frame('back', W, D) @ Matrix.Translation((-cx, 0, 0))
    P.window(m, Fb, 2.0, 1.0, 0.9, 1.3, cut, shutters='open', lit=True, lamp='lamp_3', **kw)
    P.window(m, Fb, -1.5, 3.55, 0.9, 1.3, cut, shutters='closed', **kw)
    P.door(m, Fb, -0.2, 0.9, 2.1, cut, kind='segment', n=3, surround_mat='brick', b=0.12, leaf_mat='board_old', reveal='plaster_dirty')
    for i, (u, z, sx, sz) in enumerate(((-2.3, 2.3, 0.55, 0.4), (2.4, 4.6, 0.4, 0.3), (0.9, 1.0, 0.3, 0.25))):
        P.plaster_patch(m, F, u, z, sx, sz, 'stone', seed=10 + i)
    P.plaster_patch(m, Fb, 1.0, 4.4, 0.6, 0.4, 'brick', seed=21)
    Fl = P.frame((cx - W / 2, 0, 0), -90)
    P.plaster_patch(m, Fl, 0.5, 3.6, 0.8, 0.5, 'stone', seed=22)
    hole_cut = []
    P.gable_roof(m, W, D, z_e, rise, oe=0.35, og=0.2, t=0.16, mat='roof_tile', sag=0.1, seed=7, x0=cx, kick=0.12,
                 downpipes=((-1, -W / 2 + 0.3),), missing=((1, 1.5, 0.55), (-1, -2.6, 0.7)),
                 slipped=((-1, -1.0, 0.06), (-1, 1.6, 0.1), (-1, -3.2, 0.04)),
                 hole=dict(side=-1, x=2.0, frac=0.55, r=0.75), hole_cutters=hole_cut)
    P.cut(block, kit.join(cut + hole_cut, 'cutters'))
    m.add(block)
    _v3_dress(m, block, W, D, z_e, 'plaster_dirty', cx=cx, seed=3, drop_top=False)
    zr = z_e + rise
    P.chimney(m, cx - W / 2 + 0.45, 0.0, zr - 1.0, zr + 0.8, w=0.65, d=0.55, mat='brick', pots=2, seed=8, flash_z=zr - 0.15)
    P.chimney(m, cx + 0.3, 0.25, zr - 1.0, zr + 0.6, w=0.55, d=0.9, mat='brick', pots=2, seed=9, flash_z=zr - 0.2, cowl=True)
    # --- lean-to at +X: rubble walls, plank door, corrugated iron roof
    lx0, lx1 = cx + W / 2, cx + W / 2 + 2.4
    ly0, ly1 = -2.3, 2.3
    zl_lo, zl_hi = 2.25, 3.35
    lt = 0.35
    lcut = []
    lw = [kit.box((lt, ly1 - ly0, zl_lo), loc=(lx1 - lt / 2, 0, zl_lo / 2), mat='stone')]
    for yy in (ly0 + lt / 2, ly1 - lt / 2):
        prof = [(lx0 - 0.05, 0), (lx1, 0), (lx1, zl_lo), (lx0 - 0.05, zl_hi)]
        o = kit.extrude_profile([(x, z) for x, z in prof], lt, 'Y', mat='stone', name='ltw')
        o.location.y = yy
        lw.append(o)
    lwall = kit.join(lw, 'leanto')
    Flt = P.frame(((lx0 + lx1) / 2, ly0, 0), 0)
    P.door(m, Flt, 0.05, 1.1, 1.95, lcut, z0=0.0, depth=0.12, surround=None, leaf_mat='board_old', step=False,
           through=lt + 0.2, studs_on=False)
    m.box((1.4, 0.08, 0.16), ((lx0 + lx1) / 2 + 0.05, ly0 - 0.03, 2.03), mat='oak_beam')
    P.window(m, P.frame((lx1, 0.4, 0), 90), 0.0, 1.0, 0.55, 0.6, lcut, depth=0.12, surround=None, sill_mat='ashlar',
             frame_mat='board_dark', bars=(2, 0), glass='glass', shutters=None, casement=False)
    for o in lcut:
        P.cut(lwall, o)
    m.add(lwall)
    ang = math.atan2(zl_hi - zl_lo, lx1 - lx0)
    sec = []
    nwave = 14
    span = (lx1 - lx0) / math.cos(ang) + 0.35
    for i in range(nwave * 2 + 1):
        u = -span / 2 + span * i / (nwave * 2)
        sec.append((u, 0.025 if i % 2 else -0.0))
    sec += [(span / 2, -0.03), (-span / 2, -0.03)]
    xm = (lx0 + lx1) / 2 + 0.12
    zm = (zl_lo + zl_hi) / 2 + 0.06
    roof = P.sweep([(xm, ly0 - 0.25, zm), (xm, ly1 + 0.25, zm)], [(-u, v) for u, v in sec], 'rust', 'corrugated', up=(0, 0, 1))
    roof.matrix_basis = Matrix.Translation((xm, 0, zm)) @ Matrix.Rotation(ang, 4, 'Y') @ Matrix.Translation((-xm, 0, -zm))
    m.add(roof)
    m.col_box((cx, 0, z_e / 2), (W, D, z_e))
    m.col_box(((lx0 + lx1) / 2, 0, zl_lo / 2 + 0.3), (lx1 - lx0, ly1 - ly0, zl_lo + 0.6))
    return m.build(grime=0.45, grime_height=1.5, jitter=0.03, size=HERO)


def build_house_d():
    """One-storey stone cottage: rubble walls, oak lintels, a steep thatched
    roof with a planted ridge, plank shutters, a log pile and a water butt."""
    m = P.Model('house_d', seed=14)
    W, D, z_e, rise = 6.0, 4.4, 2.5, 3.0
    cut = []
    block = P.gable_block(W, D, z_e, rise, 'stone')
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        P.quoins(m, sx * W / 2, sy * D / 2, sx, sy, 0.0, z_e, mat='stone_dark', seed=80 + i, long=0.5, short=0.3,
                 hmin=0.3, hmax=0.4, p=0.035, chip=0.4)
    F = P.face_frame('front', W, D)
    kw = dict(surround=None, sill_mat='stone_dark', shutter_mat='shutter_red', bars=(1, 1), frame_mat='board',
              reveal='stone', frame_t=0.05)
    P.door(m, F, -0.3, 0.95, 1.95, cut, z0=0.14, surround=None, leaf_mat='board_old', anchor='door', step_mat='ashlar_step',
           reveal='stone', depth=0.3)
    for (x, w_, z) in ((-0.3, 1.5, 2.17), (-1.95, 1.1, 1.95), (1.65, 1.1, 1.95)):
        m.box((w_, 0.3, 0.2 if w_ > 1.2 else 0.18), (x, -D / 2 + 0.12, z), mat='oak_beam')
    P.window(m, F, -1.95, 0.9, 0.75, 0.95, cut, shutters='open', angles=(168, 175), lit=True, lamp='lamp_1', **kw)
    P.window(m, F, 1.65, 0.9, 0.75, 0.95, cut, shutters='closed', **kw)
    Fb = P.face_frame('back', W, D)
    P.window(m, Fb, 0.8, 0.9, 0.7, 0.9, cut, shutters='left', angles=(160, 0), lit=True, lamp='lamp_2', **kw)
    m.box((1.05, 0.3, 0.18), (-0.8, D / 2 - 0.12, 1.9), mat='oak_beam')
    Fl = P.face_frame('left', W, D)
    P.window(m, Fl, 0.0, 3.1, 0.5, 0.65, cut, shutters=None, **kw)
    m.box((0.8, 0.3, 0.15), (-W / 2 + 0.12, 0.0, 3.85), mat='oak_beam')
    cut += P.chips(F, W / 2 - 0.05, 0.3, 2.2, seed=17, n=2)
    P.cut(block, kit.join(cut, 'cutters'))
    m.add(block)
    _v3_dress(m, block, W, D, z_e, 'stone', rubble=True, eaves=(), seed=4, n_stones=10)
    m.add(P.ivy_cards(P.face_frame('right', W, D), -1.6, 1.8, 0.0, 2.4, 16, seed=9))
    rp = [(0.24 * math.cos(a), 0.2 * math.sin(a) + 0.02) for a in (math.pi * k / 5 for k in range(6))]
    rp += [(-0.3, -0.12), (0.3, -0.12)]
    P.gable_roof(m, W, D, z_e, rise, oe=0.42, og=0.32, t=0.38, mat='thatch', sag=0.12, seed=8, nseg=10,
                 ridge_mat='moss', ridge_profile=[(-u, v) for u, v in rp], gutter=False, round_eave=0.08, wobble=0.07)
    # planted ridge: clumps of irises along the crest
    rnd = random.Random(14)
    for i in range(14):
        x = -W / 2 - 0.2 + (W + 0.4) * (i + 0.5) / 14
        m.add(kit.sphere(rnd.uniform(0.1, 0.16), loc=(x, rnd.uniform(-0.05, 0.05), z_e + rise + 0.75 + rnd.uniform(-0.02, 0.04)),
                         mat='grass', subdiv=1, scale=(1.4, 0.9, 1.3), name='iris'))
    P.chimney(m, W / 2 - 0.45, 0.3, z_e + rise - 0.9, z_e + rise + 1.15, w=0.7, d=0.6, mat='stone', pots=1, seed=11,
              flash_z=z_e + rise + 0.55)
    for row, (nlog, zz) in enumerate(((4, 0.13), (3, 0.37), (2, 0.6))):
        for k in range(nlog):
            yy = -0.6 + (k - (nlog - 1) / 2) * 0.27 + rnd.uniform(-0.03, 0.03)
            m.add(kit.cyl(0.13, 1.05 + rnd.uniform(-0.1, 0.1), loc=(-W / 2 - 0.25 + rnd.uniform(-0.04, 0.04), yy, zz),
                          rot=(0, 90, rnd.uniform(-6, 6)), mat='oak_beam', verts=7, name='log'))
    m.add(kit.lathe([(0.3, 0.0), (0.315, 0.15), (0.325, 0.16), (0.325, 0.2), (0.34, 0.45), (0.325, 0.7), (0.325, 0.74),
                     (0.31, 0.75), (0.3, 0.9), (0.27, 0.9), (0.27, 0.86)], segments=12, loc=(0.75, -D / 2 - 0.42, 0), mat='board_old', name='butt'))
    m.add(kit.cyl(0.3, 0.03, loc=(0.75, -D / 2 - 0.42, 0.86), mat='water', verts=10, name='bwater'))
    m.col_box((0, 0, z_e / 2), (W, D, z_e))
    m.col_box((-W / 2 - 0.25, -0.6, 0.38), (0.4, 1.2, 0.76))
    m.col_cyl((0.75, -D / 2 - 0.42, 0), 0.34, 0.9)
    return m.build(grime=0.45, grime_height=1.2, jitter=0.04, jitter_scale=0.35, tpm=140)


def build_house_e():
    """Corner house (maison de maître): two storeys and an attic under a
    hipped slate roof, two street facades (front -Y and left -X) with
    dressed quoins, string courses, a door on three steps, dormers, a street
    name plate and a lantern on the corner."""
    m = P.Model('house_e', seed=15)
    W, D, z_e, rise = 9.0, 8.0, 6.6, 3.5
    cut = []
    block = kit.box((W, D, z_e), loc=(0, 0, z_e / 2), mat='plaster', name='block')
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        P.quoins(m, sx * W / 2, sy * D / 2, sx, sy, 0.55, z_e - 0.3, mat='ashlar', seed=150 + i, long=0.6, short=0.32,
                 hmin=0.38, hmax=0.44, chip=0.15)
    m.box((W + 0.12, D + 0.12, 0.55), (0, 0, 0.275), mat='ashlar')                  # ashlar plinth
    m.box((W + 0.14, D + 0.14, 0.18), (0, 0, 3.4), mat='ashlar')                    # string course
    m.box((W + 0.2, D + 0.2, 0.22), (0, 0, z_e - 0.11), mat='ashlar')               # cornice
    m.box((W + 0.1, D + 0.1, 0.12), (0, 0, z_e - 0.3), mat='ashlar')
    F = P.face_frame('front', W, D)
    Fl = P.face_frame('left', W, D)
    kw = dict(surround='stone', surround_mat='ashlar', b=0.14, bt=0.24, keystone=True, shutter_mat='shutter_grey',
              shutter_style='planks', reveal='plaster')
    P.door(m, F, 0.0, 1.2, 2.6, cut, z0=0.45, kind='segment', rise=0.18, surround_mat='ashlar', b=0.22, keystone=True,
           leaf_mat='door_red', fanlight=True, anchor='door', reveal='plaster', step_d=0.9, nsteps=3, planks=6)
    for x, sh, lit in ((-3.3, 'open', True), (-1.75, 'closed', False), (1.75, 'ajar', False), (3.3, 'open', False)):
        P.window(m, F, x, 1.0, 1.0, 1.6, cut, shutters=sh, angles=(172, 168) if sh != 'ajar' else (120, 160),
                 lit=lit, lamp='lamp_1' if lit else None, **kw)
    for x, sh, lit in ((-3.3, 'closed', False), (-1.75, 'open', True), (0.0, 'open', False), (1.75, 'left', False), (3.3, 'open', False)):
        P.window(m, F, x, 4.0, 1.0, 1.7, cut, shutters=sh, angles=(170, 174), lit=lit, lamp='lamp_2' if lit else None,
                 rail=0.9 if x == 0.0 else None, **kw)
    P.flower_box(m, F, -3.3, 3.95, 1.2, seed=5)
    for u, sh, lit in ((-2.2, 'open', False), (0.4, 'closed', False), (2.6, 'open', True)):
        P.window(m, Fl, u, 1.0, 1.0, 1.6, cut, shutters=sh, lit=lit, lamp='lamp_3' if lit else None, **kw)
    for u, sh in ((-2.2, 'open'), (0.4, 'ajar'), (2.6, 'closed')):
        P.window(m, Fl, u, 4.0, 1.0, 1.7, cut, shutters=sh, angles=(170, 168) if sh != 'ajar' else (110, 150),
                 **dict(kw, shutter_style='plain' if sh == 'closed' else 'planks'))
    Fb = P.face_frame('back', W, D)
    kwb = dict(kw, casement=False, shutter_style='plain', keystone=False, bars=(1, 2))
    for x in (-2.5, 2.5):
        P.window(m, Fb, x, 4.0, 0.95, 1.6, cut, shutters='closed', **kwb)
    P.door(m, Fb, 1.0, 0.95, 2.2, cut, leaf_mat='board_old', surround_mat='ashlar', b=0.14, reveal='plaster', z0=0.3, studs_on=False)
    P.window(m, Fb, -2.5, 1.0, 0.95, 1.5, cut, shutters='open', **kwb)
    Fr = P.face_frame('right', W, D)
    P.window(m, Fr, 0.0, 4.0, 0.95, 1.6, cut, shutters='closed', **kwb)
    # the corner: street plate, lantern; damage on the street sides
    corner = P.frame((-W / 2, -D / 2, 0), -45)
    P.enamel_sign(m, P.face_frame('front', W, D), -W / 2 + 0.9, 3.0, 0.55, 0.28, colour='enamel_blue', seed=7)
    lan, lp = P.wall_lantern(Fl, 3.85, 3.0, lit=False, arm=0.5)
    m.add(*lan)
    m.anchor('lantern', lp)
    for x in (-2.55, 2.55):
        P.tie_plate(m, F, x, 3.6, 'X', seed=int(x * 3))
    cut += P.pocks(F, -2.3, 2.6, 14, 0.5, seed=18, mat='stone')
    cut += P.pocks(Fl, 1.5, 5.2, 10, 0.4, seed=19, mat='stone')
    cut += P.chips(F, -W / 2 + 0.05, 0.6, 3.0, seed=20, n=3)
    P.plaster_patch(m, Fl, -0.9, 2.5, 0.5, 0.35, 'stone', seed=23)
    P.plaster_patch(m, Fb, 0.0, 5.5, 0.7, 0.4, 'stone', seed=24)
    P.wall_breach(m, P.face_frame('right', W, D), -2.2, 1.5, 0.95, cut, seed=32, floor_z=0.05, depth=1.8)
    P.cut(block, kit.join(cut, 'cutters'))
    m.add(block)
    _v3_dress(m, block, W, D, z_e, 'plaster', eaves=('front', 'back', 'left', 'right'), z_eave=z_e - 0.36, seed=5)
    sl = P.hip_roof(m, W / 2, D / 2, z_e, rise, oe=0.45, t=0.16, mat='roof_slate', ridge_mat='lead',
                    downpipes=((W / 2 - 0.3, -D / 2), (-W / 2 + 0.3, D / 2)))
    # dormers: two on the front slope, one on the left
    yf = -D / 2 + 0.8
    zroof = z_e + 0.8 * sl + 0.17
    for x in (-2.0, 2.0):
        P.dormer(m, P.frame((x, yf, 0), 0), 1.45, zroof + 0.25, zroof, 2.4, wall_mat='plaster', roof_mat='roof_slate',
                 cheek_mat='roof_slate', window_kw=dict(shutter_mat='shutter_grey'))
    zr = z_e + rise
    for x in (-1.6, 1.6):
        P.chimney(m, x, 0.0, zr - 1.4, zr + 1.0, w=0.6, d=1.0, mat='brick', cap_mat='stone', pots=3, seed=int(x * 5) + 30,
                  flash_z=z_e + rise - 1.6 * sl * 0.0 + 0.0 - (abs(x) - 0.5) * sl * 0.0 - 0.3)
    m.col_box((0, 0, z_e / 2), (W, D, z_e))
    return m.build(grime=0.38, grime_height=1.4, jitter=0.02, size=HERO)


def build_house_f():
    """Norman half-timbered house (colombage): gable to the street, stone
    plinth, brick-nogged ground floor, a jettied upper floor of close studs
    and St Andrew's crosses with ochre daub, a steep tile roof."""
    m = P.Model('house_f', seed=16)
    W, D = 6.4, 8.0
    zg, zu, rise = 3.0, 5.6, 3.9          # ground storey top, upper storey top (eaves), gable rise
    jet = 0.38                             # jetty of the upper floor at the front
    cut = []
    ground = kit.box((W, D, zg), loc=(0, 0, zg / 2), mat='brick', name='ground')
    m.box((W + 0.1, D + 0.1, 0.6), (0, 0, 0.3), mat='ashlar')                      # plinth
    Lu = D + jet
    upper = P.gable_block(Lu, W, zu - zg, rise, 'daub', 'upper')
    upper.matrix_basis = Matrix.Translation((0, -jet / 2, zg)) @ Matrix.Rotation(math.radians(90), 4, 'Z')
    kit.apply_transform(upper)
    yfu = -D / 2 - jet                     # upper front face
    Fg = P.frame((0, -D / 2, 0), 0)        # ground front
    Fu = P.frame((0, yfu, 0), 0)           # upper front (jettied)
    kw = dict(surround=None, sill_mat='oak_beam', frame_mat='board', bars=(1, 2), reveal='daub', frame_t=0.05, depth=0.2,
              shutter_mat='board_old')
    # ground floor: door and two windows, timbers on brick
    P.door(m, Fg, 1.6, 0.95, 2.1, cut, z0=0.6, surround=None, leaf_mat='board_dark', anchor='door', reveal='brick',
           step_d=0.6, nsteps=3)
    P.window(m, Fg, -1.2, 1.0, 1.1, 1.3, cut, lit=True, lamp='lamp_1', shutters='open', angles=(168, 172), **kw)
    P.frame_panel(m, Fg, -W / 2, W / 2, 0.6, zg + 0.05, gaps=((-1.85, -0.55), (1.05, 2.15)), step=0.62, seed=1,
                  rails=(1.0,), brace=((-W / 2 + 0.1, -2.1, 0.75, 2.3), (W / 2 - 0.1, 2.25, 0.75, 2.3)))
    # jetty: bressummer and joist ends
    m.box((W + 0.1, 0.24, 0.26), (0, yfu + 0.12, zg + 0.1), mat='oak_beam')
    for i in range(16):
        x = -W / 2 + 0.2 + (W - 0.4) * i / 15
        m.box((0.14, jet + 0.1, 0.16), (x, -D / 2 - jet / 2 + 0.05, zg - 0.07), mat='oak_beam', name='joist')
    # upper floor: close studs, crosses under the windows, three windows
    gaps = ((-2.35, -1.25), (-0.5, 0.5), (1.25, 2.35))
    for (gx0, gx1), lit in zip(gaps, (False, True, False)):
        P.window(m, Fu, (gx0 + gx1) / 2, zg + 0.95, gx1 - gx0 - 0.1, 1.35, cut, lit=lit, lamp='lamp_2' if lit else None,
                 shutters=None, **kw)
    crosses = []
    for gx0, gx1 in gaps:
        crosses += [(gx0, gx1, zg + 0.3, zg + 0.88), (gx1, gx0, zg + 0.3, zg + 0.88)]
    P.frame_panel(m, Fu, -W / 2, W / 2, zg + 0.22, zu + 0.05, gaps=gaps, step=0.42, seed=2, rails=(zg + 0.9,), brace=crosses)
    # gable: studs clipped by the roof slope, collar, window
    half = W / 2

    def gz(x):
        return zu + rise * (1 - abs(x) / half)
    P.window(m, Fu, 0.0, zu + 0.6, 0.7, 1.0, cut, lit=False, shutters='closed', **dict(kw, shutter_mat='board_old'))
    P.frame_panel(m, Fu, -half + 0.1, half - 0.1, zu, zu + rise, gaps=((-0.45, 0.45),), step=0.45, seed=3,
                  rails=(zu + 1.75,), zfun=gz)
    for sx in (-1, 1):
        P.timber(m, Fu, sx * (half - 0.05), zu + 0.05, 0.0, zu + rise - 0.1, w=0.2)
    # sides: framing on both long walls, a window each floor
    for face, sgn in (('left', -1), ('right', 1)):
        Fs = P.face_frame(face, W, D)
        P.window(m, Fs, 0.8 * sgn, 1.0, 0.9, 1.2, cut, shutters='closed' if sgn > 0 else 'open', lit=False, **kw)
        P.frame_panel(m, Fs, -D / 2, D / 2, 0.6, zg + 0.05, gaps=((0.8 * sgn - 0.55, 0.8 * sgn + 0.55),), step=0.7,
                      seed=4 + sgn, rails=(1.0,), brace=((-D / 2 + 0.1, -D / 2 + 1.4, 0.75, 2.4),))
        Fsu = Fs @ Matrix.Translation((sgn * jet / 2 * -1 if face == 'left' else -jet / 2, 0, 0))
        Fsu = Fs @ Matrix.Translation(((jet / 2) if face == 'left' else (-jet / 2), 0, 0))
        P.window(m, Fsu, -1.0 * sgn, zg + 0.95, 0.9, 1.3, cut, shutters=None, lit=(sgn > 0), lamp='lamp_3' if sgn > 0 else None, **kw)
        P.frame_panel(m, Fsu, -Lu / 2, Lu / 2, zg + 0.22, zu + 0.05, gaps=((-1.0 * sgn - 0.5, -1.0 * sgn + 0.5),), step=0.42,
                      seed=6 + sgn, rails=(zg + 0.9,))
    # back
    Fb = P.face_frame('back', W, D)
    P.door(m, Fb, -1.5, 0.9, 2.0, cut, z0=0.6, surround=None, leaf_mat='board_old', reveal='brick', nsteps=3, step_d=0.6)
    P.frame_panel(m, Fb, -W / 2, W / 2, 0.6, zg + 0.05, gaps=((-2.0, -1.0),), step=0.7, seed=8, rails=(1.0,))
    P.window(m, Fb, 1.2, zg + 0.95, 1.0, 1.3, cut, shutters='open', **kw)
    P.frame_panel(m, Fb, -W / 2, W / 2, zg + 0.22, zu + 0.05, gaps=((0.65, 1.75),), step=0.42, seed=9, rails=(zg + 0.9,))
    P.frame_panel(m, Fb, -half + 0.1, half - 0.1, zu, zu + rise, step=0.5, seed=10, rails=(zu + 1.6,), zfun=gz)
    bpy.context.view_layer.update()
    low = [c for c in cut if kit.bounds(c)[0].z < zg - 0.05]
    high = [c for c in cut if c not in low]
    P.cut(ground, P.join_cutters(low))
    P.cut(upper, P.join_cutters(high))
    P.drop_faces(ground, lambda c, n: n.z > 0.5 and c.z > zg - 0.05)
    P.drop_faces(upper, lambda c, n: (n.z > 0.2 and c.z > zu - 0.05) or (n.z < -0.9 and abs(c.y) < D / 2 - 0.05 and c.z > zg - 0.05))
    m.add(ground, upper)
    cut2 = []
    hc = []
    _rot = Matrix.Translation((0, -jet / 2, 0)) @ Matrix.Rotation(math.radians(90), 4, 'Z')
    n0 = len(m.parts)
    P.gable_roof(m, Lu, W, zu, rise, oe=0.4, og=0.5, t=0.16, mat='roof_tile', sag=0.12, seed=16, kick=0.0,
                 downpipes=((-1, Lu / 2 - 0.3), (1, -Lu / 2 + 0.3)), barge='oak_beam', verge=False,
                 missing=((1, 1.0, 0.5), (-1, -2.6, 0.1)))
    P.xform(m.parts[n0:], _rot)
    P.chimney(m, 0.0, 2.2, zu + rise - 1.6, zu + rise + 0.7, w=0.65, d=0.6, mat='brick', pots=2, seed=16,
              flash_z=zu + rise - 0.9)
    m.col_box((0, 0, zg / 2), (W, D, zg))
    m.col_box((0, -jet / 2, (zg + zu) / 2), (W, Lu, zu - zg))
    return m.build(grime=0.4, grime_height=1.3, jitter=0.03, jitter_scale=0.35, size=HERO)


def build_house_g():
    """Village café: a two-storey plaster house with a painted café front,
    big lit windows, an extended canvas awning, and on the terrace two bistro
    tables and four chairs, most of them knocked over."""
    m = P.Model('house_g', seed=17)
    W, D, z_e, rise = 8.0, 7.4, 6.4, 2.9
    cut = []
    block = P.gable_block(W, D, z_e, rise, 'plaster_dirty')
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        P.quoins(m, sx * W / 2, sy * D / 2, sx, sy, 0.4, z_e, mat='ashlar', seed=170 + i, long=0.48, short=0.28, hmin=0.4, hmax=0.46)
    m.box((W + 0.1, D + 0.1, 0.4), (0, 0, 0.2), mat='stone_dark')
    m.box((W + 0.12, D + 0.12, 0.15), (0, 0, z_e - 0.08), mat='ashlar')
    F = P.face_frame('front', W, D)
    P.shopfront(m, F, -3.7, 3.7, 3.1, cut, paint='door_green', windows=((-2.1, 2.5), (2.1, 2.5)), door_x=0.0, door_w=1.0,
                lamps=('lamp_1', 'lamp_2'), goods='cafe', seed=17, reveal='plaster_dirty')
    P.awning(m, F, -3.6, 3.6, 3.05, out=2.3, drop=0.7, mat='canvas', seed=17)
    P.enamel_sign(m, P.face_frame('left', W, D), 1.5, 2.2, 0.7, 0.45, colour='enamel_red', seed=17)
    lan, lp = P.wall_lantern(F, 3.95, 3.3, lit=True, arm=0.45)
    m.add(*lan)
    m.anchor('lantern', lp)
    kw = dict(surround='stone', surround_mat='ashlar', b=0.13, bt=0.2, shutter_mat='shutter_green', shutter_style='louvre',
              reveal='plaster_dirty')
    for x, sh, lit in ((-2.6, 'open', False), (0.0, 'closed', False), (2.6, 'open', True)):
        P.window(m, F, x, 3.95, 1.0, 1.75, cut, shutters=sh, angles=(172, 169), rail=0.9, bars=(1, 3), lit=lit,
                 lamp='lamp_3' if lit else None, **kw)
    cut += P.pocks(F, 0.8, 5.2, 12, 0.5, seed=21, mat='stone')
    cut += P.chips(F, W / 2 - 0.05, 3.5, 6.0, seed=22, n=3)
    P.tie_plate(m, F, -1.3, 3.55, 'X', seed=3)
    P.tie_plate(m, F, 1.3, 3.55, 'X', seed=4)
    Fb = P.face_frame('back', W, D)
    kw2 = dict(kw, shutter_style='planks', shutter_mat='shutter_grey')
    P.door(m, Fb, 2.2, 0.95, 2.2, cut, leaf_mat='board_old', surround_mat='ashlar', b=0.12, reveal='plaster_dirty')
    P.window(m, Fb, -1.5, 1.0, 1.0, 1.4, cut, shutters='closed', **kw2)
    P.window(m, Fb, -1.5, 3.95, 1.0, 1.5, cut, shutters='open', **kw2)
    P.window(m, Fb, 1.8, 3.95, 1.0, 1.5, cut, shutters='ajar', angles=(115, 160), **kw2)
    P.plaster_patch(m, Fb, 0.2, 2.6, 0.6, 0.4, 'stone', seed=25)
    P.wall_breach(m, P.face_frame('left', W, D), -1.6, 4.7, 0.8, cut, seed=33, floor_z=3.45)
    P.cut(block, kit.join(cut, 'cutters'))
    m.add(block)
    _v3_dress(m, block, W, D, z_e, 'plaster_dirty', seed=7)
    P.gable_roof(m, W, D, z_e, rise, oe=0.35, og=0.2, t=0.14, mat='roof_slate', sag=0.06, seed=17, ridge_mat='lead', ridge_r=0.08,
                 downpipes=((-1, -W / 2 + 0.3), (1, W / 2 - 0.3)), kick=0.1)
    yf = -D / 2 + 0.7
    zroof = z_e + rise * (0.7 / (D / 2)) + 0.15
    for x in (-1.8, 1.8):
        P.dormer(m, P.frame((x, yf, 0), 0), 1.35, zroof + 0.3, zroof, 2.2, wall_mat='plaster', roof_mat='roof_slate', cheek_mat='roof_slate')
    zr = z_e + rise
    P.chimney(m, -W / 2 + 0.4, 0.4, zr - 1.2, zr + 0.8, w=0.6, d=0.9, mat='brick', pots=2, seed=17, flash_z=zr - 0.35)
    # terrace: two tables, four chairs, most knocked over; a broken bottle
    yt = -D / 2 - 1.9
    P.bistro_table(m, Matrix.Translation((-2.2, yt, 0)), knocked=False)
    P.bistro_chair(m, Matrix.Translation((-2.75, yt + 0.25, 0)) @ Matrix.Rotation(math.radians(70), 4, 'Z'))
    P.bistro_chair(m, Matrix.Translation((-1.5, yt - 0.5, 0)) @ Matrix.Rotation(math.radians(-130), 4, 'Z'), knocked=True)
    P.bistro_table(m, Matrix.Translation((1.9, yt - 0.2, 0)) @ Matrix.Rotation(math.radians(35), 4, 'Z'), knocked=True)
    P.bistro_chair(m, Matrix.Translation((1.2, yt + 0.4, 0)) @ Matrix.Rotation(math.radians(160), 4, 'Z'), knocked=True)
    P.bistro_chair(m, Matrix.Translation((2.8, yt - 0.9, 0)) @ Matrix.Rotation(math.radians(-60), 4, 'Z'))
    m.add(kit.cyl(0.035, 0.2, loc=(-1.9, yt - 0.7, 0.035), rot=(90, 0, 40), mat='glass', verts=6, name='bottle'))
    m.col_box((0, 0, z_e / 2), (W, D, z_e))
    m.col_cyl((-2.2, yt, 0), 0.34, 0.76)
    m.col_box((1.9, yt - 0.2, 0.35), (0.8, 1.4, 0.7), yaw=35)
    m.anchor('terrace', (0, yt, 0))
    return m.build(grime=0.4, grime_height=1.3, jitter=0.02, size=HERO)


# ==========================================================================
# Barn

def build_barn():
    """Stone lower walls, plank upper walls, a big open doorway at the front
    (enterable: colliders on the walls only), a hay loft and hay inside."""
    m = P.Model('barn', seed=21)
    W, D, z_e, rise = 11.4, 7.4, 4.6, 3.0
    t, zs = 0.5, 2.3              # stone wall thickness / height
    dw, dh = 4.0, 3.9              # doorway
    h = D / 2
    stone = []
    cut = []
    # stone walls (front split by the doorway)
    stone.append(kit.box((W, t, zs), loc=(0, h - t / 2, zs / 2), mat='stone_dark'))
    for sx in (-1, 1):
        stone.append(kit.box((t, D - 2 * t + 0.02, zs), loc=(sx * (W / 2 - t / 2), 0, zs / 2), mat='stone_dark'))
        xa, xb = sx * W / 2, sx * dw / 2
        stone.append(kit.box((abs(xa - xb), t, zs), loc=((xa + xb) / 2, -h + t / 2, zs / 2), mat='stone_dark'))
    wall = kit.join(stone, 'stonewall')
    # ventilation slits through the stone (back and gables)
    for x in (-3.5, 0.0, 3.5):
        cut.append(kit.box((0.14, 1.5, 0.7), loc=(x, h - t / 2, 1.45), mat='stone'))
    for sx in (-1, 1):
        cut.append(kit.box((1.5, 0.14, 0.7), loc=(sx * (W / 2 - t / 2), 1.2, 1.45), mat='stone'))
    P.cut(wall, kit.join(cut, 'cutters'))
    m.add(wall)
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        P.quoins(m, sx * W / 2, sy * D / 2, sx, sy, 0.0, zs, mat='ashlar', seed=90 + i)
    for i, face in enumerate(('front', 'back', 'left', 'right')):
        span = W if face in ('front', 'back') else D
        stones = P.proud_stones(P.face_frame(face, W, D), -span / 2, span / 2, 0.15, zs - 0.15, 10, seed=900 + i)
        if face == 'front':
            stones = [o for o in stones if abs(o.matrix_basis.translation.x) > 0 and True]
        m.add(*stones)
    # dressed jambs at the doorway
    for sx in (-1, 1):
        rnd = random.Random(5 + sx)
        z = 0.0
        k = 0
        while z < zs - 0.1:
            hh = min(rnd.uniform(0.34, 0.42), zs - z)
            ln = 0.5 if k % 2 == 0 else 0.3
            x0 = sx * dw / 2
            m.add(P.open_box((min(x0, x0 + sx * ln) - (0.03 if sx < 0 else 0), -h - 0.03, z),
                             (max(x0, x0 + sx * ln) + (0.03 if sx > 0 else 0), -h + t + 0.0, z + hh - 0.012), 'ashlar', 'jamb'))
            z += hh
            k += 1
    # timber sill beams on the stone, corner posts, door posts and lintel
    for yy in (-h + 0.22, h - 0.22):
        m.box((W - 0.1, 0.36, 0.2), (0, yy, zs + 0.1), mat='oak_beam')
    for sx in (-1, 1):
        m.box((0.36, D - 0.1, 0.2), (sx * (W / 2 - 0.22), 0, zs + 0.1), mat='oak_beam')
        for sy in (-1, 1):
            m.box((0.22, 0.22, z_e - zs + 0.1), (sx * (W / 2 - 0.08), sy * (h - 0.08), (zs + z_e) / 2 + 0.05), mat='oak_beam')
        m.box((0.24, 0.26, dh), (sx * (dw / 2 + 0.1), -h + 0.2, dh / 2), mat='oak_beam')
    m.box((dw + 0.9, 0.3, 0.3), (0, -h + 0.2, dh + 0.15), mat='oak_beam')
    # plank upper walls
    zt_long = z_e + 0.14
    Ff = P.face_frame('front', W, D)
    Fb = P.face_frame('back', W, D)
    off = 0.1
    m.add(P.board_panel(-W / 2 + 0.05, -dw / 2 - 0.2, zs + 0.15, zt_long, 'board_old', M=Ff @ Matrix.Translation((0, off, 0)), seed=1))
    m.add(P.board_panel(dw / 2 + 0.2, W / 2 - 0.05, zs + 0.15, zt_long, 'board_old', M=Ff @ Matrix.Translation((0, off, 0)), seed=2))
    m.add(P.board_panel(-dw / 2 - 0.2, dw / 2 + 0.2, dh + 0.3, zt_long, 'board_old', M=Ff @ Matrix.Translation((0, off, 0)), seed=3,
                        bottom=True))
    m.add(P.board_panel(-W / 2 + 0.05, W / 2 - 0.05, zs + 0.15, zt_long, 'board_old', M=Fb @ Matrix.Translation((0, off, 0)), seed=4))
    for face, sd in (('left', 5), ('right', 6)):
        F = P.face_frame(face, W, D) @ Matrix.Translation((0, off, 0))
        m.add(P.board_panel(-h + 0.05, h - 0.05, zs + 0.15,
                            lambda x: z_e + rise * (1 - abs(x) / h) + 0.12, 'board_old', M=F, seed=sd))
    # hay door in the left gable (closed), framed
    Fl = P.face_frame('left', W, D) @ Matrix.Translation((0, off - 0.03, 0))
    hd = [kit.box((1.3, 0.06, 1.3), loc=(0, -0.03, 5.3), mat='board_old', name='haydoor')]
    for zz in (4.62, 5.98):
        hd.append(kit.box((1.5, 0.1, 0.12), loc=(0, -0.05, zz), mat='oak_beam', name='hdframe'))
    for xx in (-0.7, 0.7):
        hd.append(kit.box((0.12, 0.1, 1.5), loc=(xx, -0.05, 5.3), mat='oak_beam', name='hdframe'))
    hd.append(kit.box((1.45, 0.03, 0.1), loc=(0, -0.07, 5.3), rot=(0, 42, 0), mat='board_old', name='hdbrace'))
    P.xform(hd, Fl)
    m.add(*hd)
    # roof (old tiles, sagging) with an underside, and trusses inside
    P.gable_roof(m, W, D, z_e, rise, oe=0.35, og=0.3, t=0.15, mat='roof_tile', sag=0.16, seed=22, gutter=False, wobble=0.04,
                 missing=((-1, -3.5, 0.5), (-1, -3.1, 0.55), (1, 2.0, 0.4), (-1, 3.8, 0.3)), slipped=((-1, -2.8, 0.05),))
    for x in (-2.8, 0.0, 2.8):
        m.box((0.2, D - 0.3, 0.24), (x, 0, z_e - 0.05), mat='oak_beam')                  # tie beam
        m.box((0.18, 0.18, rise - 0.25), (x, 0, z_e + (rise - 0.25) / 2), mat='oak_beam')   # king post
        ang = math.degrees(math.atan2(rise, h))
        ln = math.hypot(rise, h) - 0.2
        for sy in (-1, 1):
            m.box((0.18, ln, 0.2), (x, sy * h / 2 * 0.95, z_e + rise / 2 - 0.18), rot=(-sy * ang, 0, 0), mat='oak_beam')
    for sy in (-1, 1):
        m.box((W - 0.4, 0.14, 0.16), (0, sy * h * 0.5, z_e + rise * 0.5 - 0.22), mat='oak_beam')   # purlins
    # big plank doors: left leaf folded back against the wall, right leaf ajar
    lw, lh = dw / 2 + 0.05, dh - 0.1
    for side, ang in ((-1, 172), (1, 100)):
        leaf = [P.board_panel(0.0, lw, 0.06, lh, 'board', t=0.05, board=0.25, relief=0.015, seed=30 + side, top=True, bottom=True)]
        for zz in (0.5, lh - 0.5):
            leaf.append(kit.box((lw - 0.1, 0.05, 0.14), loc=(lw / 2, 0.075, zz), mat='board', name='ledge'))
        dz = lh - 1.0
        leaf.append(kit.box((math.hypot(lw - 0.2, dz), 0.05, 0.14), loc=(lw / 2, 0.075, lh / 2),
                            rot=(0, -math.degrees(math.atan2(dz, lw - 0.2)), 0), mat='board', name='brace'))
        for zz in (0.55, lh - 0.55):
            leaf.append(kit.box((0.9, 0.015, 0.06), loc=(0.45, -0.025, zz), mat='iron', name='strap'))
        if side > 0:                                   # mirror (apply keeps normals outward)
            leaf = P.xform(leaf, Matrix.Scale(-1, 4, (1, 0, 0)))
            for o in leaf:
                kit.apply_transform(o)
        hx = side * (dw / 2 + 0.22)
        P.xform(leaf, Matrix.Translation((hx, -h - 0.02, 0)) @ Matrix.Rotation(math.radians(side * ang), 4, 'Z'))
        m.add(*leaf)
    # right leaf collider (ajar, sticks out of the facade)
    a = math.radians(100)
    cxr = dw / 2 + 0.22 - math.cos(a) * lw / 2
    cyr = -h - 0.02 - math.sin(a) * lw / 2
    m.col_box((cxr, cyr, lh / 2), (lw, 0.08, lh), yaw=-80)
    # hay loft over the left third, ladder, hay
    lx0, lx1 = -W / 2 + t, -1.7
    zl = 2.5
    m.box((lx1 - lx0, D - 2 * t, 0.08), ((lx0 + lx1) / 2, 0, zl), mat='board_old')
    m.box((0.22, D - 2 * t, 0.24), (lx1 - 0.1, 0, zl - 0.16), mat='oak_beam')
    for yy in (-1.6, 1.6):
        m.box((0.2, 0.2, zl - 0.28), (lx1 - 0.1, yy, (zl - 0.28) / 2), mat='oak_beam')
        m.col_box((lx1 - 0.1, yy, (zl - 0.28) / 2), (0.2, 0.2, zl - 0.28))
    P.rubble_pile(m, (lx0 + lx1) / 2 - 0.2, 0.3, 1.6, 2.6, 1.4, mat='straw', seed=7, chunks=0, segs=8)
    m.parts[-1].location.z = zl + 0.04
    # ladder up to the loft
    lad = []
    for xx in (-0.22, 0.22):
        lad.append(kit.box((0.06, 0.08, 3.0), loc=(xx, 0, 1.5), mat='board', name='rail'))
    for k in range(8):
        lad.append(kit.box((0.44, 0.04, 0.04), loc=(0, 0, 0.3 + k * 0.34), mat='board', name='rung'))
    P.xform(lad, Matrix.Translation((lx1 + 0.45, -1.0, 0.0)) @ Matrix.Rotation(math.radians(-14), 4, 'Y') @ Matrix.Rotation(math.radians(90), 4, 'Z'))
    for o in lad:
        o.matrix_basis = Matrix.Translation((0, 0, 0)) @ o.matrix_basis
    m.add(*lad)
    # loose hay heap and a stack of bales at the back right
    P.rubble_pile(m, 3.6, 2.0, 1.6, 1.2, 1.3, mat='straw', seed=8, chunks=0, segs=8)
    m.col_box((3.6, 2.0, 0.45), (2.4, 1.8, 0.9))
    rnd = random.Random(9)
    bales = [(1.2, 2.9, 0), (2.25, 2.9, 0), (1.2, 2.9, 1), (1.75, 2.35, 0), (2.8, 2.35, 0), (1.7, 2.9, 2)]
    for bx, by, lvl in bales:
        m.box((1.0, 0.5, 0.45), (bx + rnd.uniform(-0.05, 0.05), by, 0.225 + lvl * 0.45), rot=(0, 0, rnd.uniform(-6, 6)), mat='straw', name='bale')
    m.col_box((2.0, 2.65, 0.67), (2.2, 1.1, 1.35))
    # tools by the door: a pitchfork and a spare cart wheel against the wall
    pf = [P.sweep([(0, 0, 0.0), (0, 0, 1.45)], P.circle_profile(0.018, 5), 'board', 'handle', up=(1, 0, 0))]
    for k in (-1, 0, 1):
        pf.append(P.sweep([(k * 0.05, 0, 1.45), (k * 0.06, -0.03, 1.62), (k * 0.06, -0.06, 1.75)], P.circle_profile(0.006, 4), 'iron', 'tine', up=(1, 0, 0)))
    pf.append(kit.box((0.14, 0.02, 0.02), loc=(0, 0, 1.45), mat='iron', name='fbar'))
    P.xform(pf, Matrix.Translation((-dw / 2 - 0.8, -h - 0.25, 0.02)) @ Matrix.Rotation(math.radians(-14), 4, 'X'))
    m.add(*pf)
    wh = [P.sweep([(0, math.cos(2 * math.pi * k / 14) * 0.55, 0.55 + math.sin(2 * math.pi * k / 14) * 0.55) for k in range(15)],
                  [(0.04, 0.035), (-0.04, 0.035), (-0.04, -0.035), (0.04, -0.035)], 'board', 'wrim', up=(1, 0, 0), loop=True)]
    for k in range(8):
        a_ = 2 * math.pi * k / 8
        wh.append(P.sweep([(0, math.cos(a_) * 0.09, 0.55 + math.sin(a_) * 0.09), (0, math.cos(a_) * 0.5, 0.55 + math.sin(a_) * 0.5)],
                          [(0.02, 0.015), (-0.02, 0.015), (-0.02, -0.015), (0.02, -0.015)], 'board', 'spoke', up=(1, 0, 0)))
    wh.append(kit.cyl(0.1, 0.2, loc=(0, 0, 0.55), rot=(0, 90, 0), mat='board', verts=8, name='hub'))
    P.xform(wh, Matrix.Translation((W / 2 - 1.6, -h - 0.3, 0.0)) @ Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Rotation(math.radians(-12), 4, 'Y'))
    m.add(*wh)
    m.anchor('door', (0, -h - 1.2, 0))
    # wall colliders
    m.col_box((0, h - t / 2, z_e / 2), (W, t, z_e))
    for sx in (-1, 1):
        m.col_box((sx * (W / 2 - t / 2), 0, z_e / 2), (t, D - 2 * t, z_e))
        xa, xb = sx * W / 2, sx * dw / 2
        m.col_box(((xa + xb) / 2, -h + t / 2, z_e / 2), (abs(xa - xb), t, z_e))
    m.col_box((0, -h + t / 2, (dh + z_e) / 2), (dw, t, z_e - dh))
    return m.build(grime=0.4, grime_height=1.3, jitter=0.035, jitter_scale=0.3, tpm=95)


# ==========================================================================
# Ruin

def _ruin_wall(m, F, outline, t, cutters, seed, jit=0.03, mat='stone_dark', inner='plaster_dirty'):
    o = P.slab(outline, 0.0, t, mat, 'rwall')
    o.matrix_basis = F @ o.matrix_basis
    kit.apply_transform(o)
    if cutters:
        P.cut(o, P.join_cutters(cutters))
    P.wobble(o, jit, seed=seed, scale=0.9)
    inward = (F.to_3x3() @ V((0, 1, 0))).normalized()
    pin = F @ V((0, t, 0))
    P.assign_faces(o, lambda c, n: n.dot(inward) > 0.8 and abs((c - pin).dot(inward)) < 0.08, inner)
    m.add(o)
    return o


def build_ruin():
    """Shelled two-storey house: jagged walls, no roof, charred joists and
    beams, rubble; open front doorway and a breach in the back wall."""
    m = P.Model('ruin', seed=31)
    W, D, t = 8.6, 6.6, 0.55
    h = D / 2
    Ff = P.face_frame('front', W, D)
    Fb = P.face_frame('back', W, D)
    Fl = P.face_frame('left', W, D)
    Fr = P.face_frame('right', W, D)
    win = dict(through=t + 0.1, depth=t, frame_mat=None, pane=False, surround='stone', surround_mat='ashlar', b=0.15, bt=0.24)
    # --- front wall (u = x): tall at the left, broken low to the right
    ctrl = [(-4.3, 6.5), (-3.4, 6.1), (-2.2, 5.8), (-1.5, 4.5), (-0.6, 3.7), (0.5, 4.1), (1.2, 3.3), (2.5, 3.15), (3.4, 2.5), (4.3, 2.1)]
    out = [(-W / 2, 0.0), (W / 2, 0.0)] + P.jagged_top(-W / 2, W / 2, ctrl, seed=1)
    cut = []
    P.window(m, Ff, -0.7, 0.0, 1.15, 2.3, cut, sill=False, **win)                                  # doorway
    P.window(m, Ff, -2.9, 0.9, 1.0, 1.4, cut, **dict(win, frame_mat='burnt', bars=(1, 1)))
    P.window(m, Ff, 2.3, 0.9, 1.0, 1.4, cut, **win)
    P.window(m, Ff, -2.9, 3.75, 0.95, 1.3, cut, **win)
    P.window(m, Ff, 1.6, 3.75, 0.95, 1.3, cut, **dict(win, surround=None, sill=False))             # top gone
    cut += P.pocks(Ff, 2.6, 2.4, 14, 0.5, seed=50, mat='stone')
    _ruin_wall(m, Ff, out, t, cut, seed=2)
    # a shutter hanging off its lower hinge at the right-hand window
    leaf = P.shutter_leaf(0.52, 1.44, 0.035, 'paint_green', 'batten', dirx=1)
    P.xform(leaf, Ff @ Matrix.Translation((2.3 + 0.52, -0.09, 0.88)) @ Matrix.Rotation(math.radians(-150), 4, 'Z')
            @ Matrix.Rotation(math.radians(-24), 4, 'Y'))
    m.add(*leaf)
    # --- back wall (u = -x) with a breach between x = -0.4 .. 1.2
    ctrl_l = [(1.4, 3.1), (2.4, 4.4), (3.4, 4.8), (4.3, 5.3)]          # world-left part (u > 0)
    top = P.jagged_top(1.45, W / 2, ctrl_l, seed=3)
    edge = P.ragged_edge(0.4, 1.45, 0.0, top[-1][1], seed=4)
    out = [(0.4, 0.0), (W / 2, 0.0)] + top + list(reversed(edge))
    cut = []
    P.window(m, Fb, 2.8, 0.95, 0.95, 1.35, cut, **win)
    _ruin_wall(m, Fb, out, t, cut, seed=5)
    ctrl_r = [(-4.3, 1.9), (-3.2, 2.6), (-2.2, 2.1), (-1.8, 1.7)]       # world-right part (u < 0)
    edge = P.ragged_edge(-1.2, -1.8, 0.0, 1.7, seed=6)
    top = P.jagged_top(-W / 2, -1.85, ctrl_r, seed=7)
    out = [(-W / 2, 0.0), (-1.2, 0.0)] + edge + top
    _ruin_wall(m, Fb, out, t, [], seed=8)
    # --- left wall (u = -y): the gable stands highest; a fireplace breast inside
    yi = h - t
    ctrl = [(-yi, 5.0), (-1.6, 5.5), (-0.5, 6.4), (0.6, 7.0), (1.5, 6.4), (yi, 6.1)]
    out = [(-yi, 0.0), (yi, 0.0)] + P.jagged_top(-yi, yi, ctrl, seed=9)
    cut = []
    P.window(m, Fl, -1.7, 3.8, 0.8, 1.2, cut, **win)
    _ruin_wall(m, Fl, out, t, cut, seed=10)
    breast_out = [(-0.95, 0.0), (0.95, 0.0), (0.95, 5.3), (0.4, 5.9), (-0.1, 5.5), (-0.95, 6.0)]
    breast = P.slab(breast_out, t - 0.02, 0.48, 'stone', 'breast')
    breast.matrix_basis = Fl @ Matrix.Translation((0.6, 0, 0)) @ breast.matrix_basis
    kit.apply_transform(breast)
    fc = []
    for (zz, ww, hh) in ((0.0, 1.15, 1.05), (3.2, 0.75, 0.75)):
        c = kit.box((ww, 0.8, hh), loc=(0, t + 0.48, zz + hh / 2), mat='stone', name='fcut')
        c.matrix_basis = Fl @ Matrix.Translation((0.6, 0, 0)) @ c.matrix_basis
        fc.append(c)
    P.cut(breast, kit.join(fc, 'fc'))
    m.add(breast)
    fp = [kit.box((1.5, 0.22, 0.12), loc=(0, t + 0.5, 1.12), mat='stone', name='mantel'),
          P.poly([(-0.57, t + 0.12, 0.0), (0.57, t + 0.12, 0.0), (0.57, t + 0.12, 1.05), (-0.57, t + 0.12, 1.05)], 'burnt', 'soot')]
    fp[1].data.flip_normals()
    P.xform(fp, Fl @ Matrix.Translation((0.6, 0, 0)))
    m.add(*fp)
    # --- right wall (u = y): collapsed low
    ctrl = [(-yi, 2.5), (-1.6, 1.5), (-0.6, 1.0), (0.4, 1.15), (1.4, 1.7), (yi, 2.2)]
    out = [(-yi, 0.0), (yi, 0.0)] + P.jagged_top(-yi, yi, ctrl, seed=11, amp=0.18)
    cut = []
    P.window(m, Fr, 1.6, 0.95, 0.9, 1.3, cut, **dict(win, surround=None))
    _ruin_wall(m, Fr, out, t, cut, seed=12)
    # quoins on the standing front-left corner and the back-left corner
    P.quoins(m, -W / 2, -h, -1, -1, 0.0, 6.0, mat='ashlar', seed=33)
    P.quoins(m, -W / 2, h, -1, 1, 0.0, 4.9, mat='ashlar', seed=34)
    P.quoins(m, W / 2, -h, 1, -1, 0.0, 1.9, mat='ashlar', seed=35)
    # --- charred joists at the first floor (z ~ 3) between front and back
    rnd = random.Random(36)
    span = D - 2 * t + 0.4
    for x in (-3.65, -3.05, -2.45, -1.85):
        m.box((0.16, span, 0.22), (x + rnd.uniform(-0.03, 0.03), 0, 3.0 + rnd.uniform(-0.03, 0.03)), mat='burnt', name='joist')
    for i, (x0, x1, y0, ln) in enumerate(((-4.0, -1.7, -1.9, 0.0), (-4.0, -2.3, -1.65, 0.0), (-3.6, -1.75, -1.4, 0.0),
                                          (-4.0, -2.9, -1.15, 0.0), (-4.0, -1.6, -0.2, 0.0), (-3.3, -2.0, 0.05, 0.0))):
        m.box((x1 - x0, 0.21, 0.035), ((x0 + x1) / 2, y0, 3.13), rot=(0, 0, rnd.uniform(-2, 2)), mat='burnt', name='board')
    # stubs and fallen joists
    m.box((0.16, 1.5, 0.22), (-1.25, -h + t + 0.5, 2.85), rot=(-14, 0, 0), mat='burnt', name='stub')
    m.box((0.16, 0.9, 0.22), (-0.62, -h + t + 0.22, 2.97), rot=(-6, 0, 0), mat='burnt', name='stub')
    p0, p1 = V((1.9, h - t + 0.25, 1.55)), V((2.45, -1.2, 0.1))
    m.box((0.17, (p1 - p0).length, 0.22), (p0 + p1) / 2,
          rot=(math.degrees(math.atan2(p0.z - p1.z, p0.y - p1.y)), 0, math.degrees(math.atan2(-(p1.x - p0.x), p0.y - p1.y))),
          mat='burnt', name='fallen')
    m.box((0.18, 3.2, 0.2), (3.1, 0.6, 0.35), rot=(0, 8, 25), mat='burnt', name='fallen')
    # a big charred roof beam leaning from the gable down into the room
    p0, p1 = V((-W / 2 + t + 0.1, 0.4, 5.6)), V((-1.2, -0.9, 0.0))
    d = p1 - p0
    beam = kit.box((0.26, d.length, 0.28), loc=(0, 0, 0), mat='burnt', name='beam')
    beam.matrix_basis = Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat('Y', 'Z').to_matrix().to_4x4()
    m.add(beam)
    # --- flagstone floor remnant and rubble
    m.box((W - 2 * t, D - 2 * t, 0.04), (0, 0, 0.02), mat='cobble', name='floor')
    P.rubble_pile(m, 2.9, 0.3, 1.1, 1.9, 0.75, seed=40, chunks=9)
    m.col_box((2.9, 0.3, 0.2), (1.8, 3.2, 0.4))
    P.rubble_pile(m, W / 2 + 0.7, 0.2, 0.9, 2.3, 0.55, seed=41, chunks=7)
    m.col_box((W / 2 + 0.6, 0.2, 0.2), (1.2, 3.6, 0.4))
    P.rubble_pile(m, 0.45, h - t - 0.6, 1.2, 0.8, 0.45, seed=42, chunks=6)
    m.col_box((0.45, h - t - 0.5, 0.17), (1.8, 1.1, 0.34))
    P.rubble_pile(m, 0.4, h + 0.75, 1.3, 0.85, 0.4, seed=43, chunks=6)
    m.col_box((0.4, h + 0.7, 0.15), (2.0, 1.2, 0.3))
    P.rubble_pile(m, -3.3, -1.9, 0.8, 0.6, 0.5, seed=44, chunks=4)
    m.col_box((-3.3, -1.9, 0.2), (1.2, 0.9, 0.4))
    P.rubble_pile(m, 2.6, -h - 0.6, 0.9, 0.55, 0.35, seed=45, chunks=4)
    rnd = random.Random(46)
    for i in range(14):
        x, y = rnd.uniform(-3.5, 3.6), rnd.uniform(-2.4, 2.4)
        if -1.4 < x < 0.9:
            continue                              # keep the walk-through path clear-ish
        sz = rnd.uniform(0.15, 0.32)
        m.box((sz * 1.5, sz, sz * 0.7), (x, y, sz * 0.3), rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 180)),
              mat='fieldstone_fresh', name='chunk')
    # --- colliders: wall pieces (between openings), rubble already added
    m.col_box((-3.85, -h + t / 2, 3.0), (0.9, t, 6.0))
    m.col_box((-2.9, -h + t / 2, 0.45), (1.0, t, 0.9))
    m.col_box((-2.9, -h + t / 2, 3.9), (1.0, t, 3.2))
    m.col_box((-1.83, -h + t / 2, 2.5), (1.15, t, 5.0))
    m.col_box((-0.7, -h + t / 2, 3.0), (1.15, t, 1.4))
    m.col_box((0.84, -h + t / 2, 1.8), (1.92, t, 3.6))
    m.col_box((2.3, -h + t / 2, 0.45), (1.0, t, 0.9))
    m.col_box((2.3, -h + t / 2, 2.65), (1.0, t, 0.7))
    m.col_box((3.55, -h + t / 2, 1.2), (1.5, t, 2.4))
    m.col_box((-2.375, h - t / 2, 2.2), (3.85, t, 4.4))
    m.col_box((2.75, h - t / 2, 1.0), (3.1, t, 2.0))
    m.col_box((-W / 2 + t / 2, 0, 3.0), (t, D - 2 * t, 6.0))
    m.col_box((-W / 2 + t + 0.24, -0.6, 2.75), (0.48, 1.9, 5.5))
    m.col_box((W / 2 - t / 2, -2.3, 1.1), (t, 1.0, 2.2))
    m.col_box((W / 2 - t / 2, -0.4, 0.55), (t, 2.8, 1.1))
    m.col_box((W / 2 - t / 2, 1.9, 0.9), (t, 1.7, 1.8))
    m.anchor('door', (-0.7, -h - 1.0, 0.0))
    for k in range(12):
        x, y = rnd.uniform(-3.6, 3.8), rnd.uniform(-2.6, 2.6)
        if -1.4 < x < 0.9:
            continue
        tl = P.barrel_tile(rnd.uniform(0.15, 0.4), 0.09, 0.085, mat='roof_tile', name='shard', n=2)
        tl.matrix_basis = Matrix.Translation((x, y, 0.03)) @ Matrix.Rotation(rnd.uniform(0, 6.3), 4, 'Z') @ Matrix.Rotation(rnd.uniform(-0.5, 0.5), 4, 'X')
        m.add(tl)
    m.add(P.ivy_cards(Fl, -2.6, 1.5, 0.0, 4.2, 22, seed=51))
    return m.build(grime=0.4, grime_height=1.2, jitter=0.0, top=(3.2, 0.25), tpm=100)


def _soot_plume(m, F, x, z, w, h, seed=1):
    """A blackened tongue of soot licking up the wall above an opening."""
    rnd = random.Random(seed)
    pts = [(x - w / 2, z)]
    k = 6
    for i in range(1, k):
        f = i / k
        pts.append((x - w / 2 * (1 - f * 0.7) + rnd.uniform(-0.08, 0.08), z + h * f))
    pts.append((x + rnd.uniform(-0.1, 0.1), z + h * rnd.uniform(1.0, 1.15)))
    for i in range(k - 1, 0, -1):
        f = i / k
        pts.append((x + w / 2 * (1 - f * 0.7) + rnd.uniform(-0.08, 0.08), z + h * f))
    pts.append((x + w / 2, z))
    o = P.poly([(px, -0.012, pz) for px, pz in pts], 'burnt', 'soot')
    P.xform([o], F)
    m.add(o)


def build_ruin_b():
    """Burnt-out house: blackened walls standing to the gables, empty openings
    with charred frames and soot plumes, the roof timbers burnt and partly
    fallen in, a hole through the upper floor, rubble spilling out of the
    front door into the street. Walk-through: front door to back door."""
    m = P.Model('ruin_b', seed=33)
    W, D, t, z_e, rise = 8.8, 7.0, 0.55, 5.8, 3.0
    h = D / 2
    Ff, Fb = P.face_frame('front', W, D), P.face_frame('back', W, D)
    Fl, Fr = P.face_frame('left', W, D), P.face_frame('right', W, D)
    win = dict(through=t + 0.1, depth=t, frame_mat=None, pane=False, surround='stone', surround_mat='stone_soot', b=0.14, bt=0.24,
               reveal='stone_soot')
    charred = dict(win, frame_mat='burnt', bars=(1, 1))
    # front / back walls: full height, ragged tops where stones fell
    for F, seed, openings in (
            (Ff, 1, [('door', -1.0, 0.0, 1.15, 2.35), ('w', -3.0, 0.9, 1.0, 1.4), ('w', 2.2, 0.9, 1.0, 1.4),
                     ('w', -3.0, 3.6, 0.95, 1.35), ('w', -0.2, 3.6, 0.95, 1.35), ('w', 2.6, 3.6, 0.95, 1.35)]),
            (Fb, 2, [('door', -1.5, 0.0, 1.0, 2.2), ('w', 2.2, 0.9, 1.0, 1.4), ('w', 1.4, 3.6, 0.95, 1.35), ('w', -2.4, 3.6, 0.95, 1.35)])):
        ctrl = [(-W / 2, z_e), (-2.0, z_e - 0.15), (0.5, z_e - 0.7), (1.4, z_e - 0.2), (W / 2, z_e)]
        out = [(-W / 2, 0.0), (W / 2, 0.0)] + P.jagged_top(-W / 2, W / 2, ctrl, seed=seed, amp=0.12)
        cut = []
        for i, (kind, x, z0, w, hh) in enumerate(openings):
            kw = charred if i % 2 == 0 else win
            if kind == 'door':
                P.window(m, F, x, 0.0, w, hh, cut, sill=False, **win)
            else:
                P.window(m, F, x, z0, w, hh, cut, **kw)
            m.soot(F, x, z0 + hh + (0.22 if kind != 'door' else 0.0), w * 1.6, 1.9 + 0.6 * (z0 < 2), 'stone_soot')
        cut += P.pocks(F, 1.0, 2.0, 10, 0.6, seed=seed + 40, mat='stone')
        _ruin_wall(m, F, out, t, cut, seed=seed + 2, jit=0.02, mat='stone_soot', inner='plaster_soot')
    # gable walls standing to the apex
    yi = h - t
    for F, seed, wx in ((Fl, 5, 0.4), (Fr, 6, -0.6)):
        top = []
        n = 9
        rnd = random.Random(seed)
        for k in range(n + 1):
            u = yi - 2 * yi * k / n
            zz = z_e + (rise + 0.55) * (1 - abs(u) / (yi + 0.55)) + rnd.uniform(-0.18, 0.08)
            top.append((u, zz))
        out = [(-yi, 0.0), (yi, 0.0)] + top
        cut = []
        P.window(m, F, wx, 3.7, 0.9, 1.3, cut, **win)
        m.soot(F, wx, 3.7 + 1.3 + 0.22, 1.5, 1.8, 'stone_soot')
        _ruin_wall(m, F, out, t, cut, seed=seed + 4, jit=0.02, mat='stone_soot', inner='plaster_soot')
    P.quoins(m, -W / 2, -h, -1, -1, 0.0, z_e - 0.2, mat='stone_soot', seed=34)
    P.quoins(m, W / 2, -h, 1, -1, 0.0, z_e - 0.4, mat='stone_soot', seed=35)
    # upper floor: burnt joists and boards, a hole in the middle
    rnd = random.Random(36)
    span = D - 2 * t + 0.4
    for i in range(15):
        x = -W / 2 + t + 0.25 + (W - 2 * t - 0.5) * i / 14
        if 0.3 < x < 2.6:
            for sy in (-1, 1):
                ln = rnd.uniform(0.6, 1.4)
                m.box((0.16, ln, 0.22), (x, sy * (h - t - ln / 2 + 0.2), 2.95 - 0.1 * (ln > 1.1)), rot=(sy * rnd.uniform(4, 16), 0, 0),
                      mat='burnt', name='stub')
            continue
        m.box((0.16, span, 0.22), (x, 0, 2.95), mat='burnt', name='joist')
    for k in range(12):
        y = -h + t + 0.15 + (D - 2 * t - 0.3) * k / 11
        for (xa, xb) in ((-W / 2 + t, 0.3 + rnd.uniform(-0.3, 0.2)), (2.6 + rnd.uniform(-0.2, 0.3), W / 2 - t)):
            if rnd.random() < 0.85:
                m.box((xb - xa, 0.21, 0.03), ((xa + xb) / 2, y, 3.075), rot=(0, 0, rnd.uniform(-1, 1)), mat='board_dark', name='board')
    # roof timbers: a broken ridge, rafters left on the back slope, purlins
    zr = z_e + rise
    m.box((W / 2 + 0.6, 0.22, 0.26), (-W / 4 + 0.2, 0.0, zr - 0.1), mat='burnt', name='ridge')
    p0, p1 = V((0.6, 0.1, zr - 0.15)), V((W / 2 - t, 0.3, 3.1))
    d = p1 - p0
    rb = kit.box((0.22, d.length, 0.26), mat='burnt', name='ridgefall')
    rb.matrix_basis = Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat('Y', 'Z').to_matrix().to_4x4()
    m.add(rb)
    ang = math.atan2(rise, h)
    ln = math.hypot(rise, h) + 0.3
    for i in range(9):
        x = -W / 2 + 0.6 + i * 0.6
        if x > 0.5:
            break
        if i in (3, 6):
            continue
        m.box((0.1, ln * rnd.uniform(0.55, 1.0), 0.14), (x, h / 2, z_e + rise / 2), rot=(ang * 57.3, 0, 0), mat='burnt', name='rafter')
    for i in range(4):
        x = -W / 2 + 0.9 + i * 0.6
        m.box((0.1, ln * 0.5, 0.14), (x, -h / 2 - 0.6, z_e + rise / 4 - 0.4), rot=(-ang * 57.3 + 10, 0, 0), mat='burnt', name='rafter')
    m.box((W / 2 + 0.4, 0.15, 0.18), (-W / 4, h / 2 - 0.05, z_e + rise / 2 - 0.1), mat='burnt', name='purlin')
    for k in range(4):                                        # battens and a few tiles left on the back slope
        yy = h - 0.3 - k * 0.38
        zz = z_e + rise * (1 - yy / h) + 0.12
        m.box((3.0, 0.04, 0.03), (-W / 2 + 1.8, yy, zz), mat='board_dark', name='batten')
        for j in range(rnd.randint(2, 6)):
            tl = P.barrel_tile(0.4, 0.1, 0.09, mat='roof_tile', name='tile', n=3)
            tl.matrix_basis = (Matrix.Translation((-W / 2 + 0.5 + j * 0.24 + rnd.uniform(0, 0.4), yy + 0.18, zz + 0.05))
                               @ Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Rotation(ang + rnd.uniform(-0.1, 0.1), 4, 'Y'))
            m.add(tl)
    # rubble: inside, and spilling out of the front door into the street
    P.rubble_pile(m, 1.5, 0.2, 1.4, 1.6, 0.8, seed=40, chunks=10, mat='stone_rubble')
    m.col_box((1.5, 0.2, 0.2), (2.4, 2.8, 0.4))
    P.rubble_pile(m, -1.0, -h - 1.0, 1.3, 1.1, 0.42, seed=41, chunks=8, mat='stone_rubble')
    m.col_box((-1.0, -h - 0.9, 0.17), (2.2, 1.8, 0.34))
    P.rubble_pile(m, -3.0, 1.6, 0.9, 0.8, 0.5, seed=42, chunks=5, mat='stone_rubble')
    m.col_box((-3.0, 1.6, 0.2), (1.4, 1.2, 0.4))
    for k in range(10):
        x, y = rnd.uniform(-3.5, 3.5), rnd.uniform(-2.5, 2.5)
        if -1.8 < x < -0.4 or -2.2 < x < -0.9:
            continue
        tl = P.barrel_tile(rnd.uniform(0.15, 0.4), 0.09, 0.085, mat='roof_tile', name='shard', n=2)
        tl.matrix_basis = Matrix.Translation((x, y, 0.02)) @ Matrix.Rotation(rnd.uniform(0, 6.3), 4, 'Z') @ Matrix.Rotation(rnd.uniform(-0.5, 0.5), 4, 'X')
        m.add(tl)
    for k in range(3):
        m.box((0.18, rnd.uniform(1.5, 2.8), 0.2), (rnd.uniform(-3, 3.2), rnd.uniform(-1.5, 2.0), 0.2 + k * 0.05),
              rot=(rnd.uniform(-8, 8), rnd.uniform(-10, 10), rnd.uniform(0, 180)), mat='burnt', name='fallenbeam')
    m.box((W - 2 * t, D - 2 * t, 0.04), (0, 0, 0.02), mat='cobble', name='floor')
    # colliders: walls with the two doorways open
    m.col_box(((-W / 2 + (-1.0 - 0.575)) / 2, -h + t / 2, z_e / 2), ((-1.0 - 0.575) + W / 2, t, z_e))
    m.col_box(((W / 2 + (-1.0 + 0.575)) / 2, -h + t / 2, z_e / 2), (W / 2 - (-1.0 + 0.575), t, z_e))
    m.col_box((-1.0, -h + t / 2, (2.35 + z_e) / 2), (1.15, t, z_e - 2.35))
    m.col_box(((W / 2 + (1.5 + 0.5)) / 2, h - t / 2, z_e / 2), (W / 2 - 2.0, t, z_e))
    m.col_box(((-W / 2 + 1.0) / 2, h - t / 2, z_e / 2), (1.0 + W / 2, t, z_e))
    m.col_box((1.5, h - t / 2, (2.2 + z_e) / 2), (1.0, t, z_e - 2.2))
    for sx in (-1, 1):
        m.col_box((sx * (W / 2 - t / 2), 0, (z_e + rise) / 2), (t, D - 2 * t, z_e + rise))
    m.anchor('door', (-1.0, -h - 1.0, 0.0))
    m.anchor('smoke', (1.5, 0.2, 0.6))
    return m.build(grime=0.4, grime_height=1.2, jitter=0.0, top=(3.0, 0.2), tpm=100)


# ==========================================================================
# Church

def _rotated(m, fn, M):
    """Run fn() (which adds parts to m) and transform the new parts by M."""
    n0 = len(m.parts)
    r = fn()
    P.xform(m.parts[n0:], M)
    return r


def build_church():
    """Village church: slate-roofed nave with buttresses and lancet windows,
    lower chancel, square west tower at the front (-Y) with an open belfry
    (floor at z = 14, a sniper stands there) and an octagonal broach spire."""
    m = P.Model('church', seed=41)
    # --- layout (Blender space)
    tw = 4.6                      # tower width
    ty0, ty1 = -11.4, -6.8        # tower front / back faces
    tcy = (ty0 + ty1) / 2
    zf = 14.0                     # belfry floor
    zb = 18.4                     # belfry top
    nW, ny0, ny1, nze, nrise = 8.6, -6.9, 7.8, 6.6, 4.6
    nL = ny1 - ny0
    ncy = (ny0 + ny1) / 2
    cW, cy0, cy1, cze, crise = 6.0, 7.8, 11.6, 5.4, 3.5
    cL = cy1 - cy0
    ccy = (cy0 + cy1) / 2
    R90 = Matrix.Rotation(math.radians(90), 4, 'Z')
    # --- nave + chancel masses (gable blocks built along X, turned to Y)
    nave = P.gable_block(nL, nW, nze, nrise, 'stone', 'nave')
    nave.matrix_basis = Matrix.Translation((0, ncy, 0)) @ R90
    kit.apply_transform(nave)
    chan = P.gable_block(cL + 0.4, cW, cze, crise, 'stone', 'chancel')
    chan.matrix_basis = Matrix.Translation((0, ccy + 0.2, 0)) @ R90
    kit.apply_transform(chan)
    m.box((nW + 0.16, nL + 0.1, 0.6), (0, ncy, 0.3), mat='ashlar')          # plinths
    m.box((cW + 0.16, cL + 0.3, 0.6), (0, ccy + 0.1, 0.3), mat='stone_dark')
    for sx in (-1, 1):                                                         # eaves corbel tables
        m.box((0.2, nL + 0.1, 0.22), (sx * (nW / 2 + 0.06), ncy, nze - 0.2), mat='ashlar')
        m.box((0.2, cL + 0.3, 0.2), (sx * (cW / 2 + 0.06), ccy + 0.1, cze - 0.18), mat='ashlar')
    # lancet windows
    lan = dict(kind='lancet', n=6, depth=0.35, surround='stone', surround_mat='ashlar', b=0.17, p=0.05,
               frame_mat='lead', frame_t=0.045, bars=(0, 3), glass='glass_leaded', sill_mat='ashlar', tracery=True)
    ncut, ccut = [], []
    for y in (-4.8, -1.2, 2.4, 5.9):
        P.window(m, P.frame((nW / 2, y, 0), 90), 0, 2.7, 0.95, 3.3, ncut, **lan)
        P.window(m, P.frame((-nW / 2, y, 0), -90), 0, 2.7, 0.95, 3.3, ncut, **lan)
    for sx, yaw in ((1, 90), (-1, -90)):
        P.window(m, P.frame((sx * cW / 2, 9.7, 0), yaw), 0, 2.3, 0.8, 2.7, ccut, **lan)
    Fe = P.frame((0, cy1, 0), 180)
    P.window(m, Fe, 0.0, 1.9, 0.95, 3.7, ccut, **lan)
    P.window(m, Fe, -1.05, 1.9, 0.6, 2.9, ccut, **dict(lan, bars=(0, 3), tracery=False))
    P.window(m, Fe, 1.05, 1.9, 0.6, 2.9, ccut, **dict(lan, bars=(0, 3), tracery=False))
    # small south door into the nave, under a gabled porch with stone benches
    yd = -1.15
    P.door(m, P.frame((nW / 2, yd, 0), 90), 0, 1.0, 2.4, ncut, z0=0.2, depth=0.35, kind='round', n=6,
           surround_mat='ashlar', b=0.2, leaf_mat='board_dark', tymp_mat='stone', step=False)
    px0, px1 = nW / 2, nW / 2 + 2.6
    pw_ = 2.7
    pwalls = []
    for sy in (-1, 1):
        pwalls.append(kit.box((px1 - px0, 0.38, 2.3), loc=((px0 + px1) / 2, yd + sy * (pw_ / 2 - 0.19), 1.15), mat='stone', name='porchwall'))
        m.box((px1 - px0 - 0.5, 0.38, 0.45), ((px0 + px1) / 2 - 0.1, yd + sy * (pw_ / 2 - 0.57), 0.225), mat='stone', name='bench')
        m.col_box(((px0 + px1) / 2, yd + sy * (pw_ / 2 - 0.19), 1.15), (px1 - px0, 0.38, 2.3))
    gab = kit.extrude_profile([(-pw_ / 2, 0.0), (pw_ / 2, 0.0), (pw_ / 2, 2.3), (0.0, 3.55), (-pw_ / 2, 2.3)], 0.4, 'X', mat='stone', name='porchfront')
    gab.location = (px1 - 0.2, yd, 0)
    kit.apply_transform(gab)
    pc = []
    P.window(m, P.frame((px1, yd, 0), 90), 0.0, 0.0, 1.5, 2.6, pc, kind='round', n=8, through=0.6, depth=0.4, frame_mat=None,
             pane=False, surround='stone', surround_mat='ashlar', b=0.16, sill=False, reveal='stone')
    P.cut(gab, pc[0])
    m.add(*pwalls, gab)
    for sy in (-1, 1):
        m.col_box((px1 - 0.2, yd + sy * (pw_ / 2 - 0.3), 1.5), (0.4, 0.6, 3.0))
    proof = kit.gable(pw_ + 0.1, px1 - px0 + 0.35, 1.3, loc=((px0 + px1) / 2 + 0.1, yd, 2.3), overhang=0.2, thickness=0.1,
                      mat='roof_slate', name='porchroof')
    proof.matrix_basis = Matrix.Translation(((px0 + px1) / 2 + 0.1, yd, 2.3)) @ Matrix.Rotation(math.radians(90), 4, 'Z')
    m.add(proof)
    m.add(kit.cyl(0.05, px1 - px0 + 0.7, loc=((px0 + px1) / 2 + 0.1, yd, 2.3 + 1.3 + 0.12), rot=(0, 90, 0), mat='lead', verts=6, name='proll'))
    P.cut(nave, kit.join(ncut, 'ncut'))
    P.cut(chan, kit.join(ccut, 'ccut'))
    m.add(nave, chan)
    # buttresses along the nave and at the chancel corners
    for y in (-3.0, 0.6, 4.2):
        for sx, yaw in ((1, 90), (-1, -90)):
            P.buttress(m, P.frame((sx * nW / 2, y, 0), yaw), 0.7, [0.85, 0.55], [0.0, 2.8, 5.2])
    for sx, yaw in ((1, 90), (-1, -90)):
        P.buttress(m, P.frame((sx * nW / 2, ny1 - 0.4, 0), yaw), 0.7, [0.8, 0.5], [0.0, 2.6, 5.0])
        P.buttress(m, P.frame((sx * nW / 2, ny0 + 0.45, 0), yaw), 0.7, [0.8, 0.5], [0.0, 2.6, 5.0])
        P.buttress(m, P.frame((sx * (cW / 2 - 0.35), cy1, 0), 180), 0.7, [0.7, 0.45], [0.0, 2.2, 4.2])
    # roofs (slate), built along X and turned
    _rotated(m, lambda: P.gable_roof(m, nL, nW, nze, nrise, oe=0.4, og=0.25, t=0.15, mat='roof_slate', sag=0.04,
                                     seed=42, gutter=False, ridge_mat='lead', ridge_r=0.1, kick=0.18, missing=((1, 3.0, 0.4),)),
             Matrix.Translation((0, ncy, 0)) @ R90)
    _rotated(m, lambda: P.gable_roof(m, cL + 0.4, cW, cze, crise, oe=0.35, og=0.3, t=0.14, mat='roof_slate', sag=0.04,
                                     seed=43, gutter=False, ridge_mat='lead', ridge_r=0.09, kick=0.15),
             Matrix.Translation((0, ccy + 0.2, 0)) @ R90)
    # gable crosses (east gables)
    for (yy, zz) in ((cy1 + 0.05, cze + crise + 0.1), (ny1 + 0.05, nze + nrise + 0.12)):
        m.box((0.16, 0.16, 1.1), (0, yy, zz + 0.5), mat='stone')
        m.box((0.6, 0.16, 0.15), (0, yy, zz + 0.72), mat='stone')
    # --- tower: solid to the belfry floor, plinth, string courses
    tower = kit.box((tw, ty1 - ty0, zf), loc=(0, tcy, zf / 2), mat='stone', name='tower')
    tcut = []
    Ft = P.frame((0, ty0, 0), 0)
    P.door(m, Ft, 0.0, 1.7, 3.4, tcut, z0=0.32, depth=0.45, kind='round', n=8, surround_mat='ashlar', b=0.26, p=0.06,
           leaf_mat='door_red', tymp_mat='ashlar', anchor='door', step_d=0.9, step_mat='ashlar_step')
    hw = 0.85
    zs = 0.32 + 3.4 - hw
    o2 = P.ring(P.outline(hw + 0.55, 0.0, zs, 'round', 8), P.outline(hw + 0.26, 0.0, zs, 'round', 8), -0.13, 0.12, 'ashlar', 'order')
    P.xform([o2], Ft)
    m.add(o2)
    P.window(m, Ft, 0.0, 7.9, 0.75, 2.2, tcut, **dict(lan, depth=0.3))
    # clock face (marks, no numerals) where the front slit was
    ck = [kit.lathe([(0.0, 0.0), (0.82, 0.0), (0.82, 0.08), (0.7, 0.1), (0.0, 0.1)], segments=24, mat='stone', name='clockring'),
          kit.cyl(0.68, 0.03, loc=(0, 0, 0.11), mat='enamel_white', verts=24, name='dial')]
    for k in range(12):
        a_ = 2 * math.pi * k / 12
        ln_ = 0.14 if k % 3 == 0 else 0.08
        ck.append(kit.box((0.035, ln_, 0.02), loc=(math.sin(a_) * 0.56, math.cos(a_) * 0.56, 0.13), rot=(0, 0, -math.degrees(a_)),
                          mat='iron_black', name='mark'))
    ck.append(kit.box((0.04, 0.42, 0.02), loc=(math.sin(5.5) * 0.19, math.cos(5.5) * 0.19, 0.15), rot=(0, 0, -math.degrees(5.5)), mat='iron_black', name='hand'))
    ck.append(kit.box((0.05, 0.3, 0.02), loc=(math.sin(2.1) * 0.13, math.cos(2.1) * 0.13, 0.16), rot=(0, 0, -math.degrees(2.1)), mat='iron_black', name='hand'))
    P.xform(ck, Matrix.Translation((0, ty0 + 0.01, 11.9)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    m.add(*ck)
    for F in (P.frame((-tw / 2, tcy, 0), -90), P.frame((tw / 2, tcy, 0), 90)):
        P.window(m, F, 0.0, 10.6, 0.3, 1.4, tcut, **dict(lan, depth=0.25, frame_mat=None, bars=(0, 0), b=0.12))
    P.cut(tower, kit.join(tcut, 'tcut'))
    m.add(tower)
    m.box((tw + 0.14, ty1 - ty0 + 0.14, 0.7), (0, tcy, 0.35), mat='stone_dark')
    for zz in (7.4, zf - 0.1):
        m.box((tw + 0.2, ty1 - ty0 + 0.2, 0.22), (0, tcy, zz), mat='ashlar')
    # angle buttresses at the two front corners
    for sx in (-1, 1):
        P.buttress(m, P.frame((sx * (tw / 2 - 0.4), ty0, 0), 0), 0.8, [0.8, 0.6, 0.4], [0.0, 4.4, 8.6, 12.2])
        P.buttress(m, P.frame((sx * tw / 2, ty0 + 0.4, 0), 90 * sx), 0.8, [0.8, 0.6, 0.4], [0.0, 4.4, 8.6, 12.2])
    # --- belfry: four walls with big round-arched openings, colonnettes, a bell
    bt = 0.65
    bw = [kit.box((tw, bt, zb - zf), loc=(0, ty0 + bt / 2, (zf + zb) / 2), mat='stone'),
          kit.box((tw, bt, zb - zf), loc=(0, ty1 - bt / 2, (zf + zb) / 2), mat='stone')]
    for sx in (-1, 1):
        bw.append(kit.box((bt, ty1 - ty0 - 2 * bt + 0.02, zb - zf), loc=(sx * (tw / 2 - bt / 2), tcy, (zf + zb) / 2), mat='stone'))
    belfry = kit.join(bw, 'belfry')
    bcut = []
    bel = dict(kind='round', n=8, through=bt + 0.2, depth=bt, frame_mat=None, pane=False, surround='stone',
               surround_mat='ashlar', b=0.22, p=0.06, sill=True, sill_mat='ashlar')
    for F in (P.frame((0, ty0, 0), 0), P.frame((0, ty1, 0), 180), P.frame((-tw / 2, tcy, 0), -90), P.frame((tw / 2, tcy, 0), 90)):
        P.window(m, F, 0.0, zf + 0.95, 1.6, 2.95, bcut, **bel)
        col = [kit.cyl(0.09, 2.1, loc=(0, bt / 2, zf + 0.95 + 1.05), mat='stone', verts=8, name='colonnette'),
               kit.box((0.3, 0.42, 0.14), loc=(0, bt / 2, zf + 0.95 + 2.12), mat='stone', name='capital'),
               kit.box((0.26, 0.4, 0.1), loc=(0, bt / 2, zf + 1.0), mat='stone', name='base')]
        P.xform(col, F)
        m.add(*col)
    P.cut(belfry, kit.join(bcut, 'bcut'))
    m.add(belfry)
    m.box((tw + 0.36, ty1 - ty0 + 0.36, 0.36), (0, tcy, zb + 0.18), mat='ashlar')       # cornice
    m.box((tw + 0.2, ty1 - ty0 + 0.2, 0.16), (0, tcy, zb - 0.08), mat='ashlar')
    m.box((tw - 2 * bt + 0.1, 0.22, 0.26), (0, tcy, 17.55), mat='wood_dark')             # bell beam
    m.add(kit.lathe([(0.06, 0.0), (0.42, 0.0), (0.4, 0.08), (0.3, 0.35), (0.24, 0.62), (0.15, 0.72), (0.0, 0.74)],
                    segments=14, loc=(0, tcy, 16.68), mat='bronze', name='bell'))
    m.add(kit.box((0.06, 0.4, 0.3), (0, tcy, 17.42 + 0.05), mat='iron', name='yoke'))
    zt = 23.75
    P.broach_spire(m, 0, tcy, zb + 0.36, tw / 2 + 0.12, zt, hb=1.7, mat='roof_slate')
    m.box((0.07, 0.07, 0.95), (0, tcy, zt + 0.32), mat='iron')                          # iron cross
    m.box((0.46, 0.06, 0.06), (0, tcy, zt + 0.52), mat='iron')
    m.add(kit.sphere(0.09, loc=(0, tcy, zt + 0.02), mat='iron', subdiv=1, name='ball'))
    # --- colliders
    m.col_box((0, tcy, zf / 2), (tw, ty1 - ty0, zf))
    for sx in (-1, 1):
        m.col_box((sx * (tw / 2 - 0.4), ty0 - 0.4, 6.1), (0.8, 0.8, 12.2))
        m.col_box((sx * (tw / 2 + 0.4), ty0 + 0.4, 6.1), (0.8, 0.8, 12.2))
    ph = 0.95
    for (cx, cy, sx_, sy_) in ((0, ty0 + bt / 2, tw, bt), (0, ty1 - bt / 2, tw, bt),
                               (-tw / 2 + bt / 2, tcy, bt, ty1 - ty0 - 2 * bt), (tw / 2 - bt / 2, tcy, bt, ty1 - ty0 - 2 * bt)):
        m.col_box((cx, cy, zf + ph / 2), (sx_, sy_, ph))                                  # parapets under the openings
    pier = (tw - 1.6) / 2
    for sx in (-1, 1):
        for (cy, ly) in ((ty0 + bt / 2, bt), (ty1 - bt / 2, bt)):
            m.col_box((sx * (tw / 2 - pier / 2), cy, (zf + ph + 17.75) / 2), (pier, ly, 17.75 - zf - ph))
        for cy in (ty0 + pier / 2, ty1 - pier / 2):
            m.col_box((sx * (tw / 2 - bt / 2), cy, (zf + ph + 17.75) / 2), (bt, pier, 17.75 - zf - ph))
    m.col_box((0, tcy, (17.75 + zb + 0.36) / 2), (tw, ty1 - ty0, zb + 0.36 - 17.75))
    m.col_box((0, ncy, nze / 2), (nW, nL, nze))
    m.col_box((0, ccy + 0.1, cze / 2), (cW, cL + 0.2, cze))
    for y in (-3.0, 0.6, 4.2, ny1 - 0.4, ny0 + 0.45):
        for sx in (-1, 1):
            m.col_box((sx * (nW / 2 + 0.4), y, 2.6), (0.8, 0.7, 5.2))
    m.anchor('sniper', (0, tcy, zf), 0.0)
    return m.build(grime=0.38, grime_height=1.6, jitter=0.02, jitter_scale=0.15, tpm=80)


# ==========================================================================
# Small buildings, walls, fences

def build_shed():
    """Small plank shed with a mono-pitch corrugated roof (high at the front)."""
    m = P.Model('shed', seed=51)
    W, D = 2.8, 2.2
    zf, zb = 2.3, 1.85            # eaves height front / back
    h = D / 2

    def ztop_side(x):              # in a side-wall frame x runs along -y or +y
        return zb + (zf - zb) * (x + h) / D
    Ff, Fb = P.face_frame('front', W, D), P.face_frame('back', W, D)
    Fl, Fr = P.face_frame('left', W, D), P.face_frame('right', W, D)
    # boards, leaving a doorway in the front
    up = 0.05                     # walls tuck under the roof sheet
    bp = dict(board=0.2, top=True)
    m.add(P.board_panel(-W / 2, -0.55, 0.05, zf + up, 'board_old', M=Ff, seed=1, **bp))
    m.add(P.board_panel(0.45, W / 2, 0.05, zf + up, 'board_old', M=Ff, seed=2, **bp))
    m.add(P.board_panel(-0.55, 0.45, 2.0, zf + up, 'board_old', M=Ff, seed=3, bottom=True, **bp))
    m.add(P.board_panel(-W / 2, W / 2, 0.05, zb + up, 'board_old', M=Fb, seed=4, **bp))
    m.add(P.board_panel(-h, h, 0.05, lambda x: zb + up + (zf - zb) * (x + h) / D, 'board_old', M=Fl, seed=5, **bp))
    m.add(P.board_panel(-h, h, 0.05, lambda x: zb + up + (zf - zb) * (h - x) / D, 'board_old', M=Fr, seed=6, **bp))
    for sx in (-1, 1):
        for sy, zz in ((-1, zf), (1, zb)):
            m.box((0.1, 0.1, zz), (sx * (W / 2 - 0.02), sy * (h - 0.02), zz / 2), mat='board_dark')
    m.box((W + 0.04, 0.1, 0.1), (0, -h - 0.02, zf - 0.05), mat='board_dark')
    m.box((W + 0.04, 0.1, 0.1), (0, h + 0.02, zb - 0.05), mat='board_dark')
    # door: ledged and braced, closed, with a latch
    door = [P.board_panel(0.0, 0.98, 0.07, 1.95, 'board', t=0.04, board=0.2, relief=0.012, seed=7, top=True)]
    for zz in (0.3, 1.7):
        door.append(kit.box((0.92, 0.035, 0.11), loc=(0.49, -0.035, zz), mat='board', name='ledge'))
    door.append(kit.box((math.hypot(0.8, 1.3), 0.03, 0.1), loc=(0.49, -0.035, 1.0), rot=(0, -math.degrees(math.atan2(1.3, 0.8)), 0), mat='board', name='brace'))
    door.append(kit.box((0.18, 0.05, 0.04), loc=(0.86, -0.07, 1.05), mat='iron', name='latch'))
    for zz in (0.3, 1.7):
        door.append(kit.box((0.45, 0.012, 0.04), loc=(0.22, -0.06, zz), mat='iron', name='strap'))
    P.xform(door, Ff @ Matrix.Translation((-0.54, -0.03, 0)))
    m.add(*door)
    # corrugated roof sloping to the back
    ang = math.atan2(zf - zb, D)
    span = D / math.cos(ang) + 0.5
    sec = []
    nwave = 12
    wid = W + 0.35
    for i in range(nwave * 2 + 1):
        u = -wid / 2 + wid * i / (nwave * 2)
        sec.append((u, 0.025 if i % 2 else 0.0))
    sec += [(wid / 2, -0.025), (-wid / 2, -0.025)]
    roof = P.sweep([(0, -span / 2, 0), (0, span / 2, 0)], [(-u, v) for u, v in sec], 'rust', 'roof', up=(0, 0, 1))
    roof.matrix_basis = Matrix.Translation((0, 0.0, (zf + zb) / 2 + 0.06)) @ Matrix.Rotation(-ang, 4, 'X')
    m.add(roof)
    # a rain barrel at the side
    m.add(kit.lathe([(0.26, 0.0), (0.29, 0.4), (0.26, 0.8)], segments=9, loc=(W / 2 + 0.35, 0.5, 0), mat='board_old', name='butt'))
    m.col_box((0, 0, zf / 2), (W, D, zf))
    m.col_cyl((W / 2 + 0.35, 0.5, 0), 0.29, 0.8)
    m.anchor('door', (-0.05, -h - 0.9, 0))
    return m.build(grime=0.3, grime_height=0.7, jitter=0.02, tpm=170)


def _drystone_body(L, base_t, top_t, hgt, mat, seed, nseg=8, amount=0.035):
    """A battered, lumpy wall body along X (ends flat so walls tile)."""
    prof = [(-base_t / 2, 0.0), (-base_t / 2 + 0.02, hgt * 0.5), (-top_t / 2, hgt), (top_t / 2, hgt),
            (base_t / 2 - 0.02, hgt * 0.5), (base_t / 2, 0.0)]
    pts = [(-L / 2 + L * i / nseg, 0, 0) for i in range(nseg + 1)]
    o = P.sweep(pts, [(-u, v) for u, v in prof], mat, 'wallbody', up=(0, 0, 1))
    rnd = random.Random(seed)
    from mathutils import noise as _n
    off = V((rnd.uniform(0, 50), rnd.uniform(0, 50), 0))
    for v in o.data.vertices:
        if abs(abs(v.co.x) - L / 2) < 1e-4:
            continue                    # keep the end sections clean for tiling
        d = _n.noise_vector(v.co * 2.2 + off)
        v.co.y += d.y * amount
        if v.co.z > 0.01:
            v.co.z += d.z * amount * 0.8
            v.co.x += d.x * amount * 0.6
    o.data.update()
    return o


def _coping_stones(m, x0, x1, ztop, depth, mat, seed, tilt=5):
    """Upright 'cock and hen' coping stones along X."""
    rnd = random.Random(seed)
    x = x0
    while x < x1 - 0.06:
        w = min(rnd.uniform(0.17, 0.3), x1 - x)
        hh = rnd.uniform(0.15, 0.23)
        m.box((w - 0.008, depth * rnd.uniform(0.88, 1.0), hh), (x + w / 2, rnd.uniform(-0.02, 0.02), ztop + hh / 2 - 0.03),
              rot=(rnd.uniform(-4, 4), rnd.uniform(-tilt, tilt), rnd.uniform(-5, 5)), mat=mat, name='coping')
        x += w


def build_wall_low():
    m = P.Model('wall_low', seed=52)
    L = 4.0
    m.add(_drystone_body(L, 0.5, 0.42, 0.78, 'stone', 52))
    _coping_stones(m, -L / 2 + 0.02, L / 2 - 0.02, 0.78, 0.4, 'stone', 53)
    rnd = random.Random(54)
    for i in range(4):                          # a few through-stones poking out
        x = rnd.uniform(-1.8, 1.8)
        z = rnd.uniform(0.2, 0.6)
        sy = rnd.choice((-1, 1))
        m.box((rnd.uniform(0.18, 0.3), 0.12, rnd.uniform(0.08, 0.14)), (x, sy * 0.23, z), rot=(0, rnd.uniform(-8, 8), rnd.uniform(-10, 10)), mat='stone')
    m.col_box((0, 0, 0.5), (L, 0.5, 1.0))
    return m.build(grime=0.25, grime_height=0.5, tpm=150)


def build_wall_high():
    m = P.Model('wall_high', seed=55)
    L = 4.0
    m.add(_drystone_body(L, 0.56, 0.5, 2.05, 'stone', 55, nseg=8, amount=0.02))
    m.box((L - 0.002, 0.62, 0.32), (0, 0, 0.16), mat='stone_dark')               # footing course
    rnd = random.Random(56)
    x = -L / 2
    while x < L / 2 - 0.05:
        w = min(rnd.uniform(0.5, 0.75), L / 2 - x)
        prof = [(-0.31, 0.0), (0.31, 0.0), (0.31, 0.08), (0.0, 0.25), (-0.31, 0.08)]
        c = kit.extrude_profile([(u, v) for u, v in reversed(prof)], w - 0.012, 'X', mat='stone', name='coping')
        c.location = (x + w / 2, rnd.uniform(-0.01, 0.01), 2.05 + rnd.uniform(-0.01, 0.01))
        c.rotation_euler = (0, math.radians(rnd.uniform(-1.2, 1.2)), 0)
        m.add(c)
        x += w
    m.col_box((0, 0, 1.15), (L, 0.6, 2.3))
    return m.build(grime=0.3, grime_height=0.7, tpm=140)


def build_wall_broken():
    m = P.Model('wall_broken', seed=57)
    L, t = 4.0, 0.48
    for side, seed in ((-1, 58), (1, 59)):
        # outline in (x, z) for the piece, broken edge towards the centre
        x_out = side * L / 2
        top = [(side * 1.25, 0.8), (side * 1.0, 0.66), (side * 0.9, 0.5), (side * 0.78, 0.38), (side * 0.66, 0.2), (side * 0.6, 0.0)]
        pts = [(x_out, 0.0)] + [(x_out, 0.78)] + top
        if side < 0:
            pts = [(x, z) for x, z in reversed(pts)]
            pts = pts[-1:] + pts[:-1]
        o = P.slab(pts if side > 0 else pts, -t / 2, t, 'stone', 'piece')
        kit.apply_transform(o)
        o.location = (0, 0, 0)
        from mathutils import noise as _n
        for v in o.data.vertices:
            if abs(abs(v.co.x) - L / 2) > 1e-4:
                d = _n.noise_vector(v.co * 2.0 + V((seed, 0, 0)))
                v.co += V((d.x * 0.04, d.y * 0.03, d.z * 0.03 if v.co.z > 0.01 else 0))
        m.add(o)
        x0, x1 = sorted((x_out, side * 1.2))
        _coping_stones(m, x0 + 0.02, x1, 0.78, 0.4, 'stone', seed + 10)
    P.rubble_pile(m, 0.0, 0.05, 0.85, 0.5, 0.36, mat='stone_rubble', seed=60, chunks=9)
    m.col_box((-1.4, 0, 0.5), (1.2, t, 1.0))
    m.col_box((1.4, 0, 0.5), (1.2, t, 1.0))
    m.col_box((0, 0, 0.15), (1.6, 0.9, 0.3))
    return m.build(grime=0.25, grime_height=0.5, tpm=150)


def build_fence():
    m = P.Model('fence', seed=61)
    rnd = random.Random(61)
    for x in (-1.45, 0.0, 1.45):
        hh = 1.1 - rnd.uniform(0, 0.06)
        prof = [(0.06, 0), (0.06, hh - 0.05), (0.0, hh), (-0.06, hh - 0.05), (-0.06, 0)]
        post = kit.extrude_profile([(u, v) for u, v in prof], 0.11, 'Y', mat='board_old', name='post')
        post.location = (x, 0.0, 0)
        post.rotation_euler = (math.radians(rnd.uniform(-2.5, 2.5)), math.radians(rnd.uniform(-2, 2)), 0)
        m.add(post)
    for z in (0.42, 0.88):
        pts = [(-1.5, -0.075, z + rnd.uniform(-0.02, 0.02)), (0.0, -0.08, z - 0.04), (1.5, -0.075, z + rnd.uniform(-0.02, 0.02))]
        m.add(P.sweep(pts, [(0.045, 0.0), (0.0, 0.05), (-0.045, 0.02), (-0.04, -0.04), (0.035, -0.045)], 'board_old', 'rail'))
    m.col_box((0, 0, 0.55), (3.0, 0.15, 1.1), kind=None)
    return m.build(grime=0.2, grime_height=0.3, tpm=200)


def build_gate():
    m = P.Model('gate', seed=62)
    for sx in (-1, 1):
        m.box((0.4, 0.4, 1.25), (sx * 1.3, 0, 0.625), mat='stone')
        cap = kit.lathe([(0.29, 0.0), (0.29, 0.06), (0.0, 0.18)], segments=4, loc=(sx * 1.3, 0, 1.22), mat='stone', name='cap')
        cap.rotation_euler = (0, 0, math.radians(45))
        m.add(cap)
    # five-bar gate between the posts, hung on the left post
    g = []
    x0, x1 = -1.08, 1.08
    g.append(kit.box((0.1, 0.07, 1.22), loc=(x0 + 0.05, 0, 0.71), mat='board_old', name='heel'))
    g.append(kit.box((0.08, 0.07, 1.16), loc=(x1 - 0.04, 0, 0.68), mat='board_old', name='head'))
    for i, z in enumerate((0.2, 0.43, 0.65, 0.88, 1.18)):
        g.append(kit.box((x1 - x0 - 0.1, 0.05 if i < 4 else 0.08, 0.08 if i < 4 else 0.1), loc=(0, 0, z), mat='board_old', name='bar'))
    dl = math.hypot(x1 - x0 - 0.2, 0.9)
    g.append(kit.box((dl, 0.045, 0.08), loc=(0, 0.05, 0.7), rot=(0, -math.degrees(math.atan2(0.9, x1 - x0 - 0.2)), 0), mat='board_old', name='brace'))
    for z in (0.3, 1.1):
        g.append(kit.box((0.4, 0.09, 0.04), loc=(x0 + 0.15, 0, z), mat='iron', name='hinge'))
    g.append(kit.box((0.14, 0.1, 0.05), loc=(x1 + 0.03, 0, 0.95), mat='iron', name='latch'))
    for o in g:
        o.rotation_euler.z += math.radians(1.5)
    m.add(*g)
    m.col_box((0, 0, 0.7), (3.0, 0.4, 1.4))
    return m.build(grime=0.25, grime_height=0.5, tpm=190)


# ==========================================================================
# Square, bridge, street furniture

def build_fountain():
    m = P.Model('fountain', seed=63)
    basin = [(1.62, 0.0), (1.64, 0.5), (1.72, 0.55), (1.72, 0.68), (1.66, 0.72), (1.46, 0.72), (1.4, 0.66),
             (1.38, 0.2), (0.0, 0.2)]
    m.add(kit.lathe(basin, segments=24, mat='stone', name='basin'))
    water = kit.cyl(1.4, 0.02, loc=(0, 0, 0.52), mat='water', verts=24, name='water')
    m.add(water)
    pillar = [(0.36, 0.2), (0.36, 0.6), (0.27, 0.68), (0.22, 0.75), (0.2, 1.65), (0.3, 1.72), (0.32, 1.85),
              (0.46, 1.9), (0.48, 2.02), (0.3, 2.06), (0.12, 2.1), (0.1, 2.22), (0.0, 2.22)]
    m.add(kit.lathe(pillar, segments=8, mat='stone', name='pillar'))
    m.add(kit.sphere(0.12, loc=(0, 0, 2.31), mat='stone', subdiv=1, name='finial'))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = V((math.cos(a), math.sin(a), 0))
        pts = [d * 0.18 + V((0, 0, 1.32)), d * 0.38 + V((0, 0, 1.3)), d * 0.5 + V((0, 0, 1.2))]
        m.add(P.sweep(pts, P.circle_profile(0.025, 6), 'bronze', 'spout'))
        m.add(kit.box((0.16, 0.16, 0.2), loc=tuple(d * 0.2 + V((0, 0, 1.32))), rot=(0, 0, math.degrees(a)), mat='stone', name='mask'))
    m.col_cyl((0, 0, 0), 1.72, 0.72)
    m.col_cyl((0, 0, 0), 0.36, 2.4)
    return m.build(grime=0.3, grime_height=0.6, shade='smooth', angle=40, tpm=160)


def build_bridge_stone():
    """Single segmental arch, deck along Y. Origin = centre of the deck
    surface (deck top at z = 0)."""
    m = P.Model('bridge_stone', seed=64)
    L, Wd = 22.0, 5.0
    s, zsp, rise = 6.5, -3.2, 2.4
    R = (s * s + rise * rise) / (2 * rise)
    zc = zsp + rise - R
    a0 = math.asin(s / R)
    narc = 16
    arc = []
    for i in range(narc + 1):
        a = -a0 + 2 * a0 * i / narc
        arc.append((R * math.sin(a), zc + R * math.cos(a)))
    zb = -3.5
    prof = [(-L / 2, 0.0), (-L / 2, zb), (-s, zb)] + arc + [(s, zb), (L / 2, zb), (L / 2, 0.0)]
    body = kit.extrude_profile(prof, Wd, 'X', mat='stone', name='body')
    kit.apply_transform(body)
    P.assign_faces(body, lambda c, n: n.z > 0.9 and abs(c.z) < 0.01, 'cobble')
    m.add(body)
    # voussoirs (protruding arch ring) on both faces
    rnd = random.Random(65)
    nv = 19
    for sx in (-1, 1):
        for i in range(nv):
            a1 = -a0 + 2 * a0 * i / nv + 0.004
            a2 = -a0 + 2 * a0 * (i + 1) / nv - 0.004
            r1 = R
            r2 = R + (0.62 if i % 2 == 0 else 0.48) + rnd.uniform(-0.03, 0.03)
            pts = [(r1 * math.sin(a1), zc + r1 * math.cos(a1)), (r1 * math.sin(a2), zc + r1 * math.cos(a2)),
                   (r2 * math.sin(a2), zc + r2 * math.cos(a2)), (r2 * math.sin(a1), zc + r2 * math.cos(a1))]
            pts = [(-y, z) for y, z in pts]
            v = kit.extrude_profile(pts, 0.12, 'X', mat='ashlar', name='voussoir')
            v.location.x = sx * (Wd / 2 + 0.01)
            m.add(v)
        m.box((0.16, L, 0.18), (sx * (Wd / 2 + 0.03), 0, -0.42), mat='stone_dark')     # string course
    # parapets: rubble walls with individual saddleback coping stones; the
    # +X parapet is broken open between y = 6.8 and 8.9
    gap = (6.8, 8.9)
    cp = [(0.25, 0.0), (0.25, 0.07), (0.0, 0.18), (-0.25, 0.07), (-0.25, 0.0)]
    for sx in (-1, 1):
        runs = [(-L / 2 + 0.3, L / 2 - 0.3)] if sx < 0 else [(-L / 2 + 0.3, gap[0]), (gap[1], L / 2 - 0.3)]
        for ri, (ya, yb) in enumerate(runs):
            n_ = max(2, int((yb - ya) / 3.0))
            pts = [(sx * (Wd / 2 - 0.2), ya + (yb - ya) * i / n_, 0) for i in range(n_ + 1)]
            par = P.sweep(pts, [(0.2, 0.0), (0.2, 0.72), (-0.2, 0.72), (-0.2, 0.0)], 'stone', 'parapet')
            P.wobble(par, 0.02, seed=66 + sx + ri, scale=0.3)
            m.add(par)
            y = ya
            while y < yb - 0.1:
                ln = min(rnd.uniform(0.7, 0.95), yb - y)
                c = kit.extrude_profile([(u, v) for u, v in reversed(cp)], ln - 0.015, 'X', mat='ashlar', name='coping')
                c.matrix_basis = (Matrix.Translation((sx * (Wd / 2 - 0.2) + rnd.uniform(-0.01, 0.01), y + ln / 2, 0.72 + rnd.uniform(-0.01, 0.01)))
                                  @ Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Rotation(math.radians(rnd.uniform(-1, 1)), 4, 'Y'))
                m.add(c)
                y += ln
        for sy in (-1, 1):
            m.box((0.55, 0.6, 0.95), (sx * (Wd / 2 - 0.22), sy * (L / 2 - 0.3), 0.475), mat='stone')
            m.add(kit.lathe([(0.4, 0.0), (0.0, 0.16)], segments=4, loc=(sx * (Wd / 2 - 0.22), sy * (L / 2 - 0.3), 0.95),
                            mat='stone', name='piercap'))
            m.parts[-1].rotation_euler = (0, 0, math.radians(45))
    # the broken section: ragged stubs, fallen coping and stones on the deck
    for yy, dirn in ((gap[0], 1), (gap[1], -1)):
        for k in range(3):
            m.box((0.38, 0.25, 0.25 + k * 0.12), (Wd / 2 - 0.2 + rnd.uniform(-0.03, 0.03), yy + dirn * (0.12 + 0.2 * k), 0.12 + k * 0.05),
                  rot=(rnd.uniform(-6, 6), 0, rnd.uniform(-8, 8)), mat='stone', name='stub')
    for k in range(5):
        c = kit.extrude_profile([(u, v) for u, v in reversed(cp)], rnd.uniform(0.6, 0.9), 'X', mat='ashlar', name='fallen')
        c.matrix_basis = (Matrix.Translation((Wd / 2 - 0.7 - rnd.uniform(0, 0.9), rnd.uniform(gap[0], gap[1]), 0.12))
                          @ Matrix.Rotation(rnd.uniform(0, 6.28), 4, 'Z') @ Matrix.Rotation(rnd.uniform(1.2, 1.9), 4, 'Y'))
        m.add(c)
    for k in range(9):
        sz = rnd.uniform(0.15, 0.3)
        m.box((sz * 1.4, sz, sz * 0.8), (Wd / 2 - 0.4 - rnd.uniform(0, 1.3), rnd.uniform(gap[0] - 0.3, gap[1] + 0.3), sz * 0.3),
              rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 180)), mat='stone', name='chunk')
    # cutwaters at the feet of the arch, both faces
    for sx in (-1, 1):
        for sy in (-1, 1):
            y0 = sy * (s + 0.55)
            prism = kit.extrude_xy([(0.0, -0.6), (0.9, 0.0), (0.0, 0.6)], 2.4, mat='stone', name='cutwater', z0=zb)
            prism.matrix_basis = Matrix.Translation((sx * Wd / 2 - sx * 0.02, y0, 0)) @ Matrix.Rotation(math.radians(0 if sx > 0 else 180), 4, 'Z')
            m.add(prism)
            cap = kit.lathe([(0.62, 0.0), (0.0, 0.55)], segments=3, mat='stone', name='cwcap')
            cap.matrix_basis = (Matrix.Translation((sx * Wd / 2, y0, zb + 2.4)) @ Matrix.Rotation(math.radians(0 if sx > 0 else 180), 4, 'Z')
                                @ Matrix.Scale(1.0, 4))
            m.add(cap)
    # ivy hanging on the spandrels by the abutments
    for sx, yaw in ((1, 90), (-1, -90)):
        for yc in (-8.5, 8.0):
            F = P.frame((sx * (Wd / 2 + 0.05), yc, 0), yaw)
            m.add(P.ivy_cards(F, -1.6, 1.6, -3.0, -0.3, 14, seed=int(yc * 3 + sx * 7), depth=0.2))
    # colliders: deck (top at 0), parapets (the +X one open at the break),
    # abutments and the spandrels over the haunches
    m.col_box((0, 0, -0.4), (Wd, L, 0.8))
    m.col_box((-(Wd / 2 - 0.2), 0, 0.45), (0.4, L, 0.9))
    m.col_box((Wd / 2 - 0.2, (-L / 2 + gap[0]) / 2, 0.45), (0.4, gap[0] + L / 2, 0.9))
    m.col_box((Wd / 2 - 0.2, (L / 2 + gap[1]) / 2, 0.45), (0.4, L / 2 - gap[1], 0.9))

    def intrados(y):
        return zc + math.sqrt(max(R * R - y * y, 0.0))
    zk = -0.8
    for sy in (-1, 1):
        m.col_box((0, sy * (s + (L / 2 - s) / 2), zb / 2), (Wd, L / 2 - s, -zb))
        for y0, y1 in ((s - 1.0, s), (s - 3.0, s - 1.0)):
            zlo = intrados(y0)
            m.col_box((0, sy * (y0 + y1) / 2, (zlo + zk) / 2), (Wd, y1 - y0, zk - zlo))
    return m.build(origin=(0, 0, 0), grime=0.4, grime_height=2.0, jitter=0.0, tpm=90)


def build_lamp_post():
    m = P.Model('lamp_post', seed=67)
    base = [(0.2, 0.0), (0.2, 0.28), (0.15, 0.36), (0.1, 0.45), (0.08, 0.85), (0.06, 0.9)]
    b = kit.lathe(base, segments=8, mat='iron_green', name='base')
    m.add(b)
    m.add(kit.cyl(0.055, 1.8, loc=(0, 0, 1.8), mat='iron_green', verts=8, name='shaft'))
    m.add(kit.lathe([(0.06, 2.65), (0.1, 2.72), (0.07, 2.8), (0.09, 2.86)], segments=8, mat='iron_green', name='collar'))
    m.add(kit.box((0.04, 0.8, 0.04), (0, 0, 2.62), mat='iron_green'))                           # ladder bar
    for sy in (-1, 1):
        m.add(kit.sphere(0.04, loc=(0, sy * 0.4, 2.62), mat='iron_green', subdiv=1, name='knob'))
    lant = kit.lathe([(0.12, 2.88), (0.2, 3.24)], segments=4, mat='window_lit', name='lantern', cap=True)
    lant.rotation_euler = (0, 0, math.radians(45))
    m.add(lant)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        for z0, r0, z1, r1 in ((2.88, 0.125, 3.24, 0.205),):
            p0 = V((math.cos(a) * r0, math.sin(a) * r0, z0))
            p1 = V((math.cos(a) * r1, math.sin(a) * r1, z1))
            m.add(P.sweep([p0, p1], [(0.018, 0.018), (-0.018, 0.018), (-0.018, -0.018), (0.018, -0.018)], 'iron_green', 'mullion', up=(1, 0, 0)))
    bot = kit.lathe([(0.15, 2.84), (0.15, 2.88), (0.0, 2.88)], segments=4, mat='iron_green', name='bot')
    bot.rotation_euler = (0, 0, math.radians(45))
    m.add(bot)
    cap = kit.lathe([(0.25, 3.24), (0.25, 3.27), (0.08, 3.36), (0.04, 3.4), (0.0, 3.4)], segments=4, mat='iron_green', name='cap')
    cap.rotation_euler = (0, 0, math.radians(45))
    m.add(cap)
    m.col_cyl((0, 0, 0), 0.2, 2.6)
    m.anchor('light', (0, 0, 3.06))
    return m.build(origin=(0, 0, 0), grime=0.15, grime_height=0.4, tpm=260)


def build_pole():
    m = P.Model('pole', seed=68)
    pole = kit.cyl(0.13, 7.0, loc=(0, 0, 3.5), mat='board_old', verts=8, radius2=0.1, name='pole')
    m.add(pole)
    m.add(kit.lathe([(0.105, 6.98), (0.0, 7.05)], segments=8, mat='board_old', name='top'))
    m.box((1.4, 0.1, 0.12), (0, -0.16, 6.55), mat='board_old')
    for sx in (-1, 1):
        p0, p1 = V((0, -0.12, 6.05)), V((sx * 0.45, -0.14, 6.5))
        m.add(P.sweep([p0, p1], [(0.02, 0.006), (-0.02, 0.006), (-0.02, -0.006), (0.02, -0.006)], 'iron', 'brace', up=(0, 1, 0)))
    for x in (-0.6, -0.27, 0.27, 0.6):
        m.add(kit.cyl(0.012, 0.12, loc=(x, -0.16, 6.67), mat='iron', verts=4, name='pin'))
        m.add(kit.lathe([(0.04, 6.68), (0.045, 6.74), (0.03, 6.77), (0.0, 6.83)], segments=6,
                        loc=(x, -0.16, 0), mat='enamel_white', name='insulator'))
    for o in m.parts:
        o.matrix_basis = Matrix.Rotation(math.radians(1.2), 4, 'X') @ o.matrix_basis
    m.col_cyl((0, 0, 0), 0.14, 7.0)
    return m.build(grime=0.2, grime_height=0.6, shade='smooth', angle=50, tpm=200)


def build_signpost():
    m = P.Model('signpost', seed=69)
    m.box((0.12, 0.12, 2.3), (0, 0, 1.15), mat='board_old')
    m.add(kit.lathe([(0.085, 2.3), (0.0, 2.42)], segments=4, mat='board_old', name='cap'))
    m.parts[-1].rotation_euler = (0, 0, math.radians(45))
    for side, z, yaw, ln in ((1, 2.05, 8, 0.62), (-1, 1.78, -12, 0.6)):
        pts = [(0.0, -0.1), (ln - 0.12, -0.1), (ln, 0.0), (ln - 0.12, 0.1), (0.0, 0.1)]
        if side < 0:
            pts = [(-x, z_) for x, z_ in reversed(pts)]
        board = kit.extrude_profile(pts, 0.03, 'Y', mat='enamel_white', name='board')
        board.location = (side * 0.06, -0.075, z)
        board.rotation_euler = (0, 0, math.radians(yaw))
        m.add(board)
        rim = kit.extrude_profile([(x * 1.0, z_ * 1.25) for x, z_ in pts], 0.02, 'Y', mat='enamel_blue', name='rim')
        rim.location = (side * 0.06, -0.06, z)
        rim.rotation_euler = (0, 0, math.radians(yaw))
        m.add(rim)
    m.col_cyl((0, 0, 0), 0.09, 2.4)
    return m.build(grime=0.2, grime_height=0.5, tpm=220)


def build_cross():
    m = P.Model('cross', seed=70)
    for i, (w, z0) in enumerate(((1.5, 0.0), (1.12, 0.25), (0.78, 0.5))):
        m.box((w, w, 0.25), (0, 0, z0 + 0.125), mat='stone' if i < 2 else 'stone_dark', bevel=0.0)
        m.col_box((0, 0, (z0 + 0.25) / 2), (w, w, z0 + 0.25))
    m.box((0.5, 0.5, 0.85), (0, 0, 0.75 + 0.425), mat='stone')
    m.box((0.6, 0.6, 0.1), (0, 0, 1.65), mat='stone')
    m.box((0.62, 0.62, 0.06), (0, 0, 1.73), mat='stone')
    m.add(kit.cyl(0.11, 1.6, loc=(0, 0, 1.76 + 0.8), mat='stone', verts=8, name='shaft'))
    m.box((0.16, 0.12, 0.62), (0, 0, 3.6 - 0.31 - 0.04), mat='stone')
    m.box((0.74, 0.12, 0.15), (0, 0, 3.2), mat='stone')
    for sx in (-1, 1):
        m.box((0.06, 0.16, 0.22), (sx * 0.39, 0, 3.2), mat='stone')
    m.box((0.2, 0.16, 0.06), (0, 0, 3.57), mat='stone')
    m.col_box((0, 0, 1.75), (0.5, 0.5, 3.5))
    return m.build(grime=0.3, grime_height=0.8, jitter=0.01, tpm=180)


def build_cart():
    """Two-wheeled farm cart resting on its shafts (front = -Y)."""
    m = P.Model('cart', seed=71)
    rw = 0.65                  # wheel radius
    parts = []
    # bed and sides in the cart's level frame: axle at (0, 0, rw)
    parts.append(kit.box((1.36, 2.3, 0.07), loc=(0, 0.1, rw + 0.22), mat='board_old', name='bed'))
    for sx in (-1, 1):
        parts.append(kit.box((0.06, 2.3, 0.3), loc=(sx * 0.68, 0.1, rw + 0.42), mat='board_old', name='side'))
        parts.append(kit.box((0.08, 2.4, 0.07), loc=(sx * 0.7, 0.1, rw + 0.6), mat='board', name='rail'))
        for k in range(4):
            parts.append(kit.box((0.06, 0.06, 0.5), loc=(sx * 0.72, -0.9 + k * 0.66, rw + 0.38), mat='board', name='stake'))
        parts.append(kit.box((0.1, 0.12, 0.12), loc=(sx * 0.55, 0.0, rw + 0.12), mat='board', name='bolster'))
        sp = [(sx * 0.58, 1.1, rw + 0.12), (sx * 0.56, -0.9, rw + 0.12), (sx * 0.52, -1.9, rw + 0.08), (sx * 0.5, -2.7, rw + 0.0)]
        parts.append(P.sweep(sp, P.circle_profile(0.045, 5), 'board', 'shaft'))
    for yy, hh in ((-1.05, 0.38), (1.25, 0.3)):
        parts.append(kit.box((1.36, 0.06, hh), loc=(0, yy, rw + 0.24 + hh / 2), mat='board_old', name='end'))
    parts.append(kit.cyl(0.05, 2.0, loc=(0, 0, rw), rot=(0, 90, 0), mat='iron', verts=6, name='axle'))
    # wheels: rim, 12 spokes, hub
    for sx in (-1, 1):
        x = sx * 0.88
        rim = P.sweep([(x, math.cos(2 * math.pi * k / 16) * (rw - 0.04), rw + math.sin(2 * math.pi * k / 16) * (rw - 0.04)) for k in range(17)],
                      [(0.045, 0.04), (-0.045, 0.04), (-0.045, -0.04), (0.045, -0.04)], 'board', 'rim', up=(1, 0, 0), loop=True)
        parts.append(rim)
        tyre = P.sweep([(x, math.cos(2 * math.pi * k / 16) * (rw - 0.005), rw + math.sin(2 * math.pi * k / 16) * (rw - 0.005)) for k in range(17)],
                       [(0.04, 0.008), (-0.04, 0.008), (-0.04, -0.008), (0.04, -0.008)], 'iron', 'tyre', up=(1, 0, 0), loop=True)
        parts.append(tyre)
        for k in range(10):
            a = 2 * math.pi * k / 10 + 0.2
            d = V((0, math.cos(a), math.sin(a)))
            p0 = V((x, 0, rw)) + d * 0.1
            p1 = V((x, 0, rw)) + d * (rw - 0.07)
            parts.append(P.sweep([p0, p1], [(0.022, 0.016), (-0.022, 0.016), (-0.022, -0.016), (0.022, -0.016)], 'board', 'spoke', up=(1, 0, 0)))
        parts.append(kit.cyl(0.11, 0.24, loc=(x, 0, rw), rot=(0, 90, 0), mat='board', verts=8, name='hub'))
        parts.append(kit.cyl(0.115, 0.04, loc=(x + sx * 0.08, 0, rw), rot=(0, 90, 0), mat='iron', verts=8, name='band'))
    # tip forward around the axle until the shaft ends touch the ground
    tip = V((0, -2.7, rw + 0.0)) - V((0, 0, rw))
    ang = math.atan2(0.0, 2.7) + math.asin((rw - 0.05) / tip.length)
    M = Matrix.Translation((0, 0, rw)) @ Matrix.Rotation(ang, 4, 'X') @ Matrix.Translation((0, 0, -rw))
    body = [o for o in parts if o.name.split('.')[0] not in ('rim', 'tyre', 'spoke', 'hub', 'band', 'axle')]
    P.xform(body, M)
    m.add(*parts)
    m.col_box((0, 0.1, 0.7), (2.0, 2.4, 1.4))
    return m.build(origin='bbox', grime=0.2, grime_height=0.6, tpm=190)


def build_haystack():
    m = P.Model('haystack', seed=72)
    prof = [(1.38, 0.0), (1.5, 0.35), (1.5, 1.1), (1.38, 1.7), (1.1, 2.25), (0.7, 2.68), (0.3, 2.9), (0.0, 2.96)]
    o = kit.lathe(prof, segments=14, mat='straw', name='stack', cap=True)
    P.wobble(o, 0.09, seed=72, scale=1.4)
    m.add(o)
    skirt = kit.lathe([(1.62, 0.0), (1.5, 0.3), (1.3, 0.34)], segments=14, mat='straw', name='skirt', cap=False)
    P.wobble(skirt, 0.08, seed=73, scale=2.0)
    m.add(skirt)
    m.add(kit.cyl(0.04, 0.6, loc=(0.02, 0.0, 3.0), rot=(4, 3, 0), mat='board_old', verts=5, name='pole'))
    for a in (0.3, 2.4, 4.4):
        pts = []
        for k in range(6):
            t = k / 5
            r = 0.35 + 1.15 * t
            z = 2.85 - 1.95 * t * t
            pts.append((math.cos(a + 0.3 * t) * r, math.sin(a + 0.3 * t) * r, z + 0.04))
        m.add(P.sweep(pts, P.circle_profile(0.015, 3), 'board_dark', 'rope', cap=False, closed=True))
    m.col_cyl((0, 0, 0), 1.45, 2.7)
    return m.build(grime=0.25, grime_height=0.6, shade='smooth', angle=60, tpm=150)


# ==========================================================================
# v2 props

def _layer_cols(m, cx, cy, sx, sy, tops):
    """Stepped collider boxes for a heap: concentric boxes, each top at most
    0.45 m above the one around it (walk up a rubble heap)."""
    n = len(tops)
    for i, tz in enumerate(tops):
        f = 1 - i / n
        m.col_box((cx, cy, tz / 2), (sx * f, sy * f, tz))


def build_rubble_pile():
    """A heap of shell-shattered masonry: stone, bricks, broken roof tiles,
    a couple of beams; ~3 x 3 x 1.2, steppable in 0.4 m terraces."""
    m = P.Model('rubble_pile', seed=81)
    rnd = random.Random(81)
    P.rubble_pile(m, 0.0, 0.0, 1.45, 1.35, 1.15, mat='stone_rubble', seed=81, chunks=16, segs=10)
    P.rubble_pile(m, 0.6, -0.5, 0.9, 0.8, 0.6, mat='stone_rubble', seed=82, chunks=6, segs=8)
    for k in range(10):
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0.3, 1.3)
        z = 1.1 * max(0.0, 1 - (r / 1.45) ** 2) * 0.85
        m.box((0.22, 0.1, 0.06), (math.cos(a) * r, math.sin(a) * r, z + 0.02), rot=(rnd.uniform(-30, 30), rnd.uniform(-30, 30), rnd.uniform(0, 180)),
              mat='brick', name='brick')
    for k in range(9):
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0.2, 1.4)
        z = 1.1 * max(0.0, 1 - (r / 1.45) ** 2) * 0.85
        tl = P.barrel_tile(rnd.uniform(0.15, 0.4), 0.09, 0.085, mat='roof_tile', name='shard', n=2)
        tl.matrix_basis = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, z)) @ Matrix.Rotation(rnd.uniform(0, 6.3), 4, 'Z') @ Matrix.Rotation(rnd.uniform(-0.6, 0.6), 4, 'X')
        m.add(tl)
    m.box((0.18, 2.6, 0.2), (0.3, 0.2, 0.75), rot=(18, 6, 30), mat='burnt', name='beam')
    m.box((0.14, 1.8, 0.16), (-0.6, -0.3, 0.45), rot=(-12, 0, -55), mat='oak_beam', name='beam')
    _layer_cols(m, 0.0, 0.0, 2.6, 2.4, (0.4, 0.8, 1.1))
    return m.build(grime=0.3, grime_height=0.6, tpm=150)


def build_rubble_small():
    m = P.Model('rubble_small', seed=83)
    rnd = random.Random(83)
    P.rubble_pile(m, 0.0, 0.0, 0.75, 0.6, 0.45, mat='stone_rubble', seed=83, chunks=9, segs=8)
    for k in range(5):
        a = rnd.uniform(0, 6.28)
        r = rnd.uniform(0.2, 0.7)
        tl = P.barrel_tile(rnd.uniform(0.12, 0.3), 0.09, 0.085, mat='roof_tile', name='shard', n=2)
        tl.matrix_basis = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 0.1)) @ Matrix.Rotation(rnd.uniform(0, 6.3), 4, 'Z') @ Matrix.Rotation(rnd.uniform(-0.6, 0.6), 4, 'X')
        m.add(tl)
    m.col_box((0, 0, 0.2), (1.3, 1.0, 0.4))
    return m.build(grime=0.3, grime_height=0.4, tpm=180)


def build_beam_charred():
    """A fallen roof beam, charred, split at one end, nails and a strap."""
    m = P.Model('beam_charred', seed=84)
    rnd = random.Random(84)
    L = 4.0
    beam = kit.box((0.26, L, 0.28), loc=(0, 0, 0.14), mat='burnt', name='beam')
    P.wobble(beam, 0.02, seed=84, scale=1.2)
    m.add(beam)
    for k in range(4):                                    # splintered end
        m.box((0.05 + rnd.uniform(0, 0.04), rnd.uniform(0.25, 0.6), 0.06), (-0.1 + k * 0.065, L / 2 + 0.15, 0.06 + rnd.uniform(0, 0.16)),
              rot=(rnd.uniform(-8, 8), 0, rnd.uniform(-10, 10)), mat='burnt', name='splinter')
    m.box((0.3, 0.06, 0.32), (0, -L / 2 + 0.5, 0.15), mat='rust', name='strap')
    m.box((0.08, 0.6, 0.1), (0.12, -1.0, 0.33), rot=(0, 0, 25), mat='burnt', name='peg')
    m.col_box((0, 0, 0.14), (0.3, L + 0.3, 0.28))
    return m.build(grime=0.2, grime_height=0.3, tpm=160)


def build_furniture_broken():
    """A kitchen table thrown on its side (one leg snapped) and a chair on its
    back, as left in a looted house."""
    m = P.Model('furniture_broken', seed=85)
    t = [kit.box((1.4, 0.8, 0.05), loc=(0, 0, 0.75), mat='board', name='top'),
         kit.box((1.26, 0.06, 0.1), loc=(0, -0.35, 0.67), mat='board', name='apron'),
         kit.box((1.26, 0.06, 0.1), loc=(0, 0.35, 0.67), mat='board', name='apron'),
         kit.box((0.06, 0.64, 0.1), loc=(-0.6, 0, 0.67), mat='board', name='apron'),
         kit.box((0.06, 0.64, 0.1), loc=(0.6, 0, 0.67), mat='board', name='apron')]
    for sx in (-1, 1):
        for sy in (-1, 1):
            ln = 0.72 if not (sx > 0 and sy > 0) else 0.32
            t.append(kit.box((0.06, 0.06, ln), loc=(sx * 0.62, sy * 0.33, 0.73 - ln / 2), mat='board', name='leg'))
    t.append(kit.box((0.06, 0.06, 0.4), loc=(0.9, -0.6, 0.03), rot=(90, 0, 30), mat='board', name='leg'))
    P.xform(t[:-1], Matrix.Translation((0, 0.4, 0.4)) @ Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Translation((0, 0, -0.775)))
    m.add(*t)
    c = [kit.box((0.42, 0.4, 0.04), loc=(0, 0, 0.45), mat='board_old', name='seat'),
         kit.box((0.42, 0.04, 0.5), loc=(0, 0.19, 0.72), mat='board_old', name='back')]
    for sx in (-1, 1):
        for sy in (-1, 1):
            c.append(kit.box((0.035, 0.035, 0.45), loc=(sx * 0.18, sy * 0.17, 0.225), mat='board_old', name='cleg'))
        c.append(kit.box((0.03, 0.03, 0.5), loc=(sx * 0.18, 0.19, 0.7), mat='board_old', name='upright'))
    P.xform(c, Matrix.Translation((-0.3, -0.9, 0.0)) @ Matrix.Rotation(math.radians(-80), 4, 'Z') @ Matrix.Translation((0, 0, 0.21))
            @ Matrix.Rotation(math.radians(-90), 4, 'X') @ Matrix.Translation((0, -0.21, 0)))
    m.add(*c)
    m.col_box((0, 0.4, 0.4), (1.5, 0.8, 0.8))
    m.col_box((-0.3, -0.9, 0.22), (0.9, 0.6, 0.45))
    return m.build(grime=0.2, grime_height=0.3, tpm=180)


def build_bench():
    """Village bench: cast-iron ends, slatted wooden seat and back."""
    m = P.Model('bench', seed=86)
    for sx in (-0.78, 0.78):
        pts = [(sx, 0.25, 0.0), (sx, 0.18, 0.42), (sx, 0.22, 0.85)]
        m.add(P.sweep(pts, [(0.02, 0.025), (-0.02, 0.025), (-0.02, -0.025), (0.02, -0.025)], 'iron_green', 'end', up=(1, 0, 0)))
        pts = [(sx, -0.22, 0.0), (sx, -0.2, 0.25), (sx, -0.16, 0.42)]
        m.add(P.sweep(pts, [(0.02, 0.025), (-0.02, 0.025), (-0.02, -0.025), (0.02, -0.025)], 'iron_green', 'end', up=(1, 0, 0)))
        m.add(P.sweep([(sx, -0.24, 0.42), (sx, 0.22, 0.42)], [(0.02, 0.02), (-0.02, 0.02), (-0.02, -0.02), (0.02, -0.02)], 'iron_green', 'end'))
        m.add(P.sweep([(sx, -0.2, 0.42), (sx, -0.2, 0.6), (sx, -0.05, 0.62)], P.circle_profile(0.018, 5), 'iron_green', 'arm', up=(1, 0, 0)))
    for k in range(4):
        m.box((1.8, 0.09, 0.03), (0, -0.17 + k * 0.105, 0.44), mat='board', name='slat')
    for k in range(3):
        m.box((1.8, 0.03, 0.09), (0, 0.22 - k * 0.0, 0.55 + k * 0.11), rot=(-12, 0, 0), mat='board', name='slat')
    m.col_box((0, 0, 0.22), (1.8, 0.5, 0.45))
    return m.build(grime=0.2, grime_height=0.3, tpm=200)


def build_well():
    """Stone well: a round curb, a tile roof on two oak posts, the winding
    drum with crank and rope, a bucket on the rim."""
    m = P.Model('well', seed=87)
    m.add(kit.lathe([(0.82, 0.0), (0.82, 0.78), (0.86, 0.8), (0.86, 0.92), (0.6, 0.92), (0.58, 0.8), (0.58, -0.4)], segments=18,
                    mat='stone', name='curb', cap=False))
    m.add(kit.cyl(0.58, 0.02, loc=(0, 0, -0.35), mat='water', verts=14, name='wellwater'))
    for sx in (-1, 1):
        m.box((0.16, 0.16, 2.1), (sx * 0.72, 0, 1.05 + 0.85), mat='oak_beam', name='post')
        m.box((0.12, 0.6, 0.1), (sx * 0.72, 0, 0.98), rot=(0, 0, 0), mat='oak_beam', name='foot')
    rf = kit.gable(1.0, 2.0, 0.6, loc=(0, 0, 2.95), overhang=0.15, thickness=0.06, mat='roof_tile', name='wroof')
    rf.matrix_basis = Matrix.Translation((0, 0, 2.95)) @ Matrix.Rotation(math.radians(90), 4, 'Z')
    m.add(rf)
    m.add(kit.cyl(0.05, 1.3, loc=(0, 0, 3.62), rot=(0, 90, 0), mat='roof_tile', verts=6, name='wridge'))
    m.add(kit.cyl(0.12, 1.3, loc=(0, 0, 2.3), rot=(0, 90, 0), mat='board_old', verts=10, name='drum'))
    for k in range(5):
        m.add(kit.cyl(0.124, 0.04, loc=(-0.3 + k * 0.12, 0, 2.3), rot=(0, 90, 0), mat='straw', verts=10, name='rope'))
    m.add(P.sweep([(0.72, 0, 2.3), (0.95, 0, 2.3), (0.95, 0, 2.05), (1.05, 0, 2.05)], [(0.015, 0.015), (-0.015, 0.015), (-0.015, -0.015), (0.015, -0.015)],
                  'iron', 'crank', up=(0, 1, 0)))
    m.add(P.sweep([(0.1, 0.12, 2.3), (0.1, 0.0, 1.4)], P.circle_profile(0.012, 4), 'straw', 'rope', up=(1, 0, 0)))
    m.add(kit.lathe([(0.13, 0.0), (0.16, 0.25), (0.15, 0.25), (0.12, 0.02)], segments=9, loc=(0.72, 0.42, 0.92), mat='board_old', name='bucket', cap=False))
    m.add(kit.cyl(0.165, 0.02, loc=(0.72, 0.42, 1.08), mat='iron', verts=9, name='bhoop', cap=False))
    m.col_cyl((0, 0, 0), 0.86, 0.92)
    for sx in (-1, 1):
        m.col_box((sx * 0.72, 0, 1.5), (0.16, 0.16, 3.0))
    return m.build(grime=0.3, grime_height=0.6, tpm=170)


def build_water_trough():
    m = P.Model('water_trough', seed=88)
    o = kit.box((2.2, 0.72, 0.6), loc=(0, 0, 0.3), mat='stone', name='trough')
    c = kit.box((2.0, 0.52, 0.5), loc=(0, 0, 0.62), mat='stone', name='tcut')
    P.cut(o, c)
    P.wobble(o, 0.02, seed=88, scale=1.5)
    m.add(o)
    m.add(kit.box((1.98, 0.5, 0.02), (0, 0, 0.47), mat='water', name='twater'))
    m.box((0.06, 0.3, 0.15), (-1.12, 0, 0.5), mat='stone', name='lip')
    m.add(P.sweep([(-1.0, 0.45, 1.1), (-1.0, 0.45, 0.85), (-1.0, 0.2, 0.75)], P.circle_profile(0.03, 6), 'bronze', 'spout', up=(1, 0, 0)))
    m.box((0.3, 0.18, 1.2), (-1.0, 0.5, 0.6), mat='stone', name='standpipe')
    m.col_box((0, 0.05, 0.3), (2.2, 0.85, 0.6))
    return m.build(grime=0.3, grime_height=0.4, tpm=180)


def build_barrel_wood():
    """Oak cask: bellied staves, iron hoops, a bung, the head."""
    m = P.Model('barrel_wood', seed=89)
    prof = [(0.27, 0.0), (0.285, 0.05), (0.3, 0.06), (0.3, 0.1), (0.315, 0.12), (0.335, 0.3), (0.34, 0.44), (0.335, 0.58),
            (0.315, 0.76), (0.3, 0.78), (0.3, 0.82), (0.285, 0.83), (0.27, 0.88), (0.25, 0.88), (0.25, 0.86)]
    m.add(kit.lathe(prof, segments=16, mat='board', name='cask'))
    for z in (0.08, 0.3, 0.58, 0.8):
        r = 0.335 if 0.2 < z < 0.7 else 0.305
        m.add(kit.lathe([(r + 0.006, z - 0.02), (r + 0.008, z + 0.02)], segments=16, mat='iron', name='hoop', cap=False))
    m.add(kit.cyl(0.03, 0.03, loc=(0.0, -0.335, 0.44), rot=(90, 0, 0), mat='board_dark', verts=6, name='bung'))
    m.col_cyl((0, 0, 0), 0.34, 0.88)
    return m.build(grime=0.25, grime_height=0.3, tpm=220, shade='smooth', angle=40)


def build_bicycle():
    """1940s French roadster leaning on its kickstand: black frame, steel rims,
    a leather saddle, mudguards and a rear rack (front wheel towards -Y)."""
    m = P.Model('bicycle', seed=90)
    R = 0.34
    wf, wr = V((0, -0.55, R)), V((0, 0.55, R))
    bb = V((0, 0.05, 0.28))
    seat = V((0, 0.22, 0.85))
    head_t, head_b = V((0, -0.38, 0.92)), V((0, -0.42, 0.72))
    tube = [(0.016, 0.016), (-0.016, 0.016), (-0.016, -0.016), (0.016, -0.016)]
    for a, b in ((bb, seat), (bb, head_b), (seat + V((0, -0.02, -0.07)), head_t), (bb, wr), (seat + V((0, 0, -0.05)), wr)):
        m.add(P.sweep([a, b], P.circle_profile(0.017, 6), 'iron_black', 'frame', up=(1, 0, 0)))
    m.add(P.sweep([head_b, head_t], P.circle_profile(0.022, 6), 'iron_black', 'head', up=(1, 0, 0)))
    m.add(P.sweep([head_b, head_b + V((0, -0.06, -0.15)), wf], P.circle_profile(0.014, 5), 'iron_black', 'fork', up=(1, 0, 0)))
    m.add(P.sweep([seat, seat + V((0, 0.0, 0.08))], P.circle_profile(0.012, 5), 'iron', 'post', up=(1, 0, 0)))
    m.add(kit.box((0.14, 0.26, 0.05), loc=(0, 0.25, 0.95), mat='leather', name='saddle'))
    m.add(P.sweep([head_t + V((-0.28, 0.12, 0.06)), head_t + V((-0.2, 0.0, 0.06)), head_t + V((0.2, 0.0, 0.06)), head_t + V((0.28, 0.12, 0.06))],
                  P.circle_profile(0.012, 5), 'iron', 'bars', up=(0, 0, 1)))
    for sx in (-1, 1):
        m.add(kit.cyl(0.018, 0.1, loc=(sx * 0.3, -0.26, 0.98), rot=(90, 0, 0), mat='rubber', verts=6, name='grip'))
    for c in (wf, wr):
        rim = [(0, c.y + math.cos(2 * math.pi * k / 20) * R, c.z + math.sin(2 * math.pi * k / 20) * R) for k in range(20)]
        m.add(P.sweep(rim + [rim[0]], P.circle_profile(0.022, 5), 'rubber', 'tyre', up=(1, 0, 0), loop=True))
        rim2 = [(0, c.y + math.cos(2 * math.pi * k / 20) * (R - 0.025), c.z + math.sin(2 * math.pi * k / 20) * (R - 0.025)) for k in range(20)]
        m.add(P.sweep(rim2 + [rim2[0]], tube, 'iron', 'rim', up=(1, 0, 0), loop=True))
        for k in range(12):
            a_ = 2 * math.pi * k / 12
            m.add(P.sweep([c + V(((-0.03 if k % 2 else 0.03), 0, 0)), c + V((0, math.cos(a_) * (R - 0.03), math.sin(a_) * (R - 0.03)))],
                          [(0.003, 0.003), (-0.003, 0.003), (-0.003, -0.003), (0.003, -0.003)], 'iron', 'spoke', up=(1, 0, 0), cap=False))
        m.add(kit.cyl(0.03, 0.08, loc=tuple(c), rot=(0, 90, 0), mat='iron', verts=6, name='hub'))
        guard = [(0, c.y + math.cos(a_) * (R + 0.04), c.z + math.sin(a_) * (R + 0.04)) for a_ in [math.pi * (0.15 + 0.7 * k / 7) for k in range(8)]]
        m.add(P.sweep(guard, [(0.03, 0.005), (-0.03, 0.005), (-0.03, -0.005), (0.03, -0.005)], 'iron_black', 'guard', up=(1, 0, 0)))
    m.add(kit.box((0.12, 0.3, 0.015), loc=(0, 0.52, 0.72), mat='iron_black', name='rack'))
    m.add(P.sweep([(0, 0.66, 0.72), (0, 0.6, 0.45), (0, 0.55, R)], P.circle_profile(0.008, 4), 'iron_black', 'stay', up=(1, 0, 0)))
    m.add(kit.cyl(0.09, 0.02, loc=tuple(bb + V((0.04, 0, 0))), rot=(0, 90, 0), mat='iron', verts=10, name='chainring'))
    m.add(P.sweep([bb + V((0.05, 0, 0)), wr + V((0.05, 0, 0))], [(0.004, 0.01), (-0.004, 0.01), (-0.004, -0.01), (0.004, -0.01)], 'iron', 'chain', up=(1, 0, 0)))
    for sgn in (1, -1):
        m.add(P.sweep([bb + V((sgn * 0.06, 0, 0)), bb + V((sgn * 0.06, sgn * 0.08, -sgn * 0.13))], tube, 'iron', 'crank', up=(1, 0, 0)))
    m.add(P.sweep([bb + V((-0.05, 0.08, 0)), V((-0.16, 0.18, 0.0))], P.circle_profile(0.008, 4), 'iron', 'kickstand', up=(1, 0, 0)))
    for o in m.parts:                                        # lean onto the kickstand
        o.matrix_basis = Matrix.Rotation(math.radians(-9), 4, 'Y') @ o.matrix_basis
    m.col_box((0, 0, 0.5), (0.5, 1.6, 1.0))
    return m.build(origin='bbox', grime=0.15, grime_height=0.3, tpm=260, shade='smooth', angle=45)


def build_wall_lamp():
    """Wall lantern on a scrolled bracket. Origin: the wall-plate centre on
    the wall surface (y = 0), plate bottom at z = 0; the lantern hangs out
    towards -Y. Anchor `light` at the lantern centre."""
    m = P.Model('wall_lamp', seed=91)
    lan, lp = P.wall_lantern(Matrix.Identity(4), 0.0, 0.11, lit=True, arm=0.42)
    m.add(*lan)
    m.anchor('light', lp)
    return m.build(origin=(0, 0, 0), grime=0.1, grime_height=0.2, tpm=300)


def build_ivy_patch():
    """Ivy on a wall: alpha cards over 2 x 3 m, the wall plane at y = 0, the
    leaves facing -Y (origin at the bottom centre on the wall plane)."""
    m = P.Model('ivy_patch', seed=92)
    rnd = random.Random(92)
    m.add(P.ivy_cards(Matrix.Identity(4), -1.0, 1.0, 0.0, 3.0, 70, seed=92, depth=0.18, size=(0.45, 0.8)))
    return m.build(origin=(0, 0, 0), grime=0.0, tpm=None, bake=False)


def build_steps_stone():
    """A flight of five worn stone steps between two cheek walls, rising
    0.75 m towards +Y (front edge at -Y); each step is a collider."""
    m = P.Model('steps_stone', seed=93)
    rnd = random.Random(93)
    n, rise_, tread, w = 5, 0.15, 0.32, 1.6
    for i in range(n):
        z1 = rise_ * (i + 1)
        y0 = -n * tread / 2 + i * tread
        prof = [(y0, 0.0), (y0, z1 - 0.03), (y0 + 0.03, z1), (n * tread / 2, z1), (n * tread / 2, 0.0)]
        o = kit.extrude_profile(list(reversed(prof)), w + rnd.uniform(-0.02, 0.02), 'X', mat='stone', name='step')
        o.location.x = rnd.uniform(-0.02, 0.02)
        m.add(o)
        m.col_box((0, (y0 + n * tread / 2) / 2, z1 / 2), (w, n * tread / 2 - y0, z1))
    for sx in (-1, 1):
        prof = [(-n * tread / 2, 0.0), (n * tread / 2, 0.0), (n * tread / 2, n * rise_ + 0.25), (-n * tread / 2, 0.3)]
        o = kit.extrude_profile(list(reversed(prof)) if False else prof, 0.3, 'X', mat='stone_dark', name='cheek')
        o.location.x = sx * (w / 2 + 0.15)
        m.add(o)
        m.col_box((sx * (w / 2 + 0.15), 0, (n * rise_ + 0.25) / 2), (0.3, n * tread, n * rise_ + 0.25))
    return m.build(grime=0.3, grime_height=0.4, jitter=0.01, tpm=170)


def build_fence_picket():
    """Picket fence, 3 m: pointed pickets on two rails between posts, white
    paint flaking, one picket missing and one hanging."""
    m = P.Model('fence_picket', seed=94)
    rnd = random.Random(94)
    for x in (-1.45, 1.45):
        m.box((0.09, 0.09, 1.15), (x, 0.02, 0.575), mat='shutter_grey', name='post')
        m.add(kit.lathe([(0.065, 1.15), (0.0, 1.24)], segments=4, loc=(x, 0.02, 0), mat='shutter_grey', name='postcap'))
    for z in (0.3, 0.8):
        m.box((3.0, 0.04, 0.07), (0, 0.06, z), mat='shutter_grey', name='rail')
    x = -1.35
    k = 0
    while x < 1.4:
        if k != 7:
            hh = 1.0 + rnd.uniform(-0.02, 0.02)
            prof = [(-0.04, 0.05), (0.04, 0.05), (0.04, hh - 0.06), (0.0, hh), (-0.04, hh - 0.06)]
            o = kit.extrude_profile(prof, 0.02, 'Y', mat='shutter_grey', name='picket')
            o.location = (x, 0.03 - 0.0, 0)
            if k == 12:
                o.matrix_basis = Matrix.Translation((x, 0.0, 0.8)) @ Matrix.Rotation(math.radians(25), 4, 'Y') @ Matrix.Translation((0, 0, -0.8))
            m.add(o)
        x += 0.12
        k += 1
    m.col_box((0, 0.03, 0.55), (3.0, 0.12, 1.1))
    return m.build(grime=0.25, grime_height=0.4, tpm=200)


def build_poster_board():
    """Morris column: a cast-iron drum on a stepped base, layers of torn
    posters (no readable text), a domed cap with a finial."""
    m = P.Model('poster_board', seed=95)
    rnd = random.Random(95)
    m.add(kit.lathe([(0.72, 0.0), (0.72, 0.12), (0.66, 0.16), (0.62, 0.3), (0.6, 0.32), (0.6, 2.75), (0.66, 2.8), (0.7, 2.95),
                     (0.6, 3.05), (0.42, 3.3), (0.12, 3.42), (0.06, 3.6), (0.0, 3.65)], segments=20, mat='iron_green', name='column'))
    for k in range(7):
        a0 = k * 2 * math.pi / 7 + rnd.uniform(-0.2, 0.2)
        a1 = a0 + rnd.uniform(0.7, 1.3)
        z0, z1 = rnd.uniform(0.45, 1.6), rnd.uniform(1.8, 2.65)
        r = 0.605 + 0.003 * k
        verts, faces = [], []
        nseg = 6
        for i in range(nseg + 1):
            a = a0 + (a1 - a0) * i / nseg
            tz = rnd.uniform(-0.08, 0.05)
            verts += [(math.cos(a) * r, math.sin(a) * r, z0 + rnd.uniform(-0.05, 0.05)), (math.cos(a) * r, math.sin(a) * r, z1 + tz)]
        for i in range(nseg):
            faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
        m.add(P.mesh('poster', verts, faces, 'poster'))
    m.col_cyl((0, 0, 0), 0.7, 3.1)
    return m.build(grime=0.3, grime_height=0.6, tpm=160, shade='smooth', angle=35)


def build_grave_a():
    """Headstone with a rounded head on a plinth, a kerbed grave with gravel."""
    m = P.Model('grave_a', seed=96)
    head = kit.extrude_profile([(-0.32, 0.0), (0.32, 0.0), (0.32, 0.75)] + [(math.cos(a) * 0.32, 0.75 + math.sin(a) * 0.18) for a in
                               [math.pi * k / 6 for k in range(1, 6)]] + [(-0.32, 0.75)], 0.1, 'Y', mat='stone', name='headstone')
    head.matrix_basis = Matrix.Translation((0, 0.82, 0.2)) @ Matrix.Rotation(math.radians(-4), 4, 'X') @ Matrix.Rotation(math.radians(2), 4, 'Y')
    m.add(head)
    m.box((0.8, 0.26, 0.2), (0, 0.82, 0.1), mat='stone')
    for sx in (-1, 1):
        m.box((0.08, 1.7, 0.16), (sx * 0.4, 0.0, 0.08), mat='stone', name='kerb')
    m.box((0.88, 0.08, 0.16), (0, -0.82, 0.08), mat='stone', name='kerb')
    m.box((0.72, 1.6, 0.06), (0, -0.02, 0.03), mat='cobble', name='gravel')
    m.add(kit.cyl(0.08, 0.14, loc=(0.2, 0.55, 0.13), mat='enamel_white', verts=8, name='vase'))
    m.col_box((0, 0.82, 0.55), (0.8, 0.28, 1.1))
    m.col_box((0, -0.05, 0.08), (0.88, 1.6, 0.16))
    return m.build(grime=0.35, grime_height=0.5, jitter=0.005, tpm=200)


def build_grave_b():
    """Grave with a stone cross on a stepped plinth and a slab, leaning a
    little; an iron enclosure rail on two sides."""
    m = P.Model('grave_b', seed=97)
    m.box((0.95, 2.0, 0.12), (0, 0, 0.06), mat='stone', name='slab')
    m.box((0.7, 0.5, 0.25), (0, 0.72, 0.245), mat='stone', name='plinth')
    m.box((0.5, 0.35, 0.2), (0, 0.72, 0.47), mat='stone', name='plinth2')
    cross = [kit.box((0.12, 0.1, 1.15), loc=(0, 0, 0.575), mat='stone', name='cshaft'),
             kit.box((0.56, 0.1, 0.12), loc=(0, 0, 0.82), mat='stone', name='carm')]
    P.xform(cross, Matrix.Translation((0, 0.72, 0.57)) @ Matrix.Rotation(math.radians(5), 4, 'Y') @ Matrix.Rotation(math.radians(-3), 4, 'X'))
    m.add(*cross)
    for sx in (-1, 1):
        for k in range(5):
            y = -0.95 + k * 0.45
            m.box((0.025, 0.025, 0.55), (sx * 0.55, y, 0.275), mat='iron_black', name='rpost')
        m.box((0.02, 1.9, 0.03), (sx * 0.55, -0.05, 0.5), mat='iron_black', name='rrail')
    m.col_box((0, 0, 0.06), (0.95, 2.0, 0.12))
    m.col_box((0, 0.72, 0.85), (0.6, 0.45, 1.7))
    return m.build(grime=0.35, grime_height=0.5, tpm=200)


def build_churchyard_wall():
    """Churchyard wall, 4 m along X, 1.2 m high, 0.5 m thick, rubble with a
    saddleback coping of separate stones; ends flat so it tiles."""
    m = P.Model('churchyard_wall', seed=98)
    L = 4.0
    m.add(_drystone_body(L, 0.5, 0.46, 1.02, 'stone', 98, nseg=8, amount=0.02))
    rnd = random.Random(98)
    x = -L / 2
    while x < L / 2 - 0.05:
        w = min(rnd.uniform(0.45, 0.7), L / 2 - x)
        prof = [(-0.28, 0.0), (0.28, 0.0), (0.28, 0.06), (0.0, 0.2), (-0.28, 0.06)]
        c = kit.extrude_profile([(u, v) for u, v in reversed(prof)], w - 0.012, 'X', mat='stone', name='coping')
        c.location = (x + w / 2, rnd.uniform(-0.01, 0.01), 1.0 + rnd.uniform(-0.01, 0.01))
        c.rotation_euler = (0, math.radians(rnd.uniform(-1.5, 1.5)), 0)
        m.add(c)
        x += w
    m.col_box((0, 0, 0.6), (L, 0.56, 1.2))
    return m.build(grime=0.35, grime_height=0.6, tpm=150)


# ==========================================================================
# Registry, previews, export

BUILDERS = {
    'house_a': build_house_a,
    'house_b': build_house_b,
    'house_c': build_house_c,
    'house_d': build_house_d,
    'house_e': build_house_e,
    'house_f': build_house_f,
    'house_g': build_house_g,
    'barn': build_barn,
    'ruin': build_ruin,
    'ruin_b': build_ruin_b,
    'church': build_church,
    'shed': build_shed,
    'wall_low': build_wall_low,
    'wall_high': build_wall_high,
    'wall_broken': build_wall_broken,
    'fence': build_fence,
    'gate': build_gate,
    'fountain': build_fountain,
    'bridge_stone': build_bridge_stone,
    'lamp_post': build_lamp_post,
    'pole': build_pole,
    'signpost': build_signpost,
    'cross': build_cross,
    'cart': build_cart,
    'haystack': build_haystack,
    'grave_a': build_grave_a,
    'grave_b': build_grave_b,
    'churchyard_wall': build_churchyard_wall,
    'rubble_pile': build_rubble_pile,
    'rubble_small': build_rubble_small,
    'beam_charred': build_beam_charred,
    'furniture_broken': build_furniture_broken,
    'bench': build_bench,
    'well': build_well,
    'water_trough': build_water_trough,
    'barrel_wood': build_barrel_wood,
    'bicycle': build_bicycle,
    'wall_lamp': build_wall_lamp,
    'ivy_patch': build_ivy_patch,
    'steps_stone': build_steps_stone,
    'fence_picket': build_fence_picket,
    'poster_board': build_poster_board,
}

ORDER = ['house_a', 'house_b', 'house_c', 'house_d', 'house_e', 'house_f', 'house_g', 'barn', 'ruin', 'ruin_b', 'church', 'shed',
         'wall_low', 'wall_high', 'wall_broken', 'fence', 'gate', 'fountain', 'bridge_stone',
         'lamp_post', 'pole', 'signpost', 'cross', 'cart', 'haystack', 'grave_a', 'grave_b', 'churchyard_wall',
         'rubble_pile', 'rubble_small', 'beam_charred', 'furniture_broken', 'bench', 'well', 'water_trough',
         'barrel_wood', 'bicycle', 'wall_lamp', 'ivy_patch', 'steps_stone', 'fence_picket', 'poster_board']

PREVIEW_VIEWS = {
    # node: list of (suffix, elevation, azimuth); a '_close' view is added
    'default': [('', 18, -35), ('_back', 20, 150)],
    'house_a': [('', 14, -32), ('_back', 16, 150)],
    'barn': [('', 18, -30), ('_back', 20, 140)],
    'ruin': [('', 28, -30), ('_back', 30, 150)],
    'church': [('', 12, -38), ('_back', 16, 140)],
    'bridge_stone': [('', 20, -60), ('_side', 6, -90)],
}

# close-up cameras (camera, target, lens) where the default would miss the point
CLOSE = {
    'church': ((-3.2, -14.2, 1.7), (0.0, -11.4, 2.4), 24),
    'bridge_stone': ((-1.6, -12.5, 1.6), (0.4, -8.0, 0.4), 26),
    'barn': ((1.0, -6.0, 1.7), (0.0, -3.0, 1.9), 24),
}


def preview_node(obj, name, size=768, samples=12):
    """768 px previews: front 3/4, back 3/4, and a close-up from 2 m."""
    views = PREVIEW_VIEWS.get(name, PREVIEW_VIEWS['default'])
    for suffix, el, az in views:
        kit.preview([obj], os.path.join(PREV, f'{name}{suffix}.png'), size=size, samples=samples, elevation=el, azimuth=az)
    mn, mx = kit.bounds(obj)
    cx = (mn.x + mx.x) / 2
    if name in CLOSE:
        cam, tgt, lens = CLOSE[name]
    else:
        zt = min(1.5, (mx.z - mn.z) * 0.5) + mn.z
        tgt = (cx + 0.2, mn.y + 0.2, zt)
        cam = (cx - 0.9, mn.y - 1.8, max(zt + 0.15, 1.2))
        lens = 26
    P.street_view([obj], os.path.join(PREV, f'{name}_close.png'), cam=cam, target=tgt, lens=lens, size=size, samples=samples)


def collider_view(obj, name, path):
    """Review render: the node with its colliders (from the extras, converted
    back to Blender space) as translucent red volumes, anchors as small balls."""
    import json
    mat = bpy.data.materials.get('_col') or bpy.data.materials.new('_col')
    mat.use_nodes = True
    b = mat.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (1, 0.05, 0.02, 1)
    b.inputs['Alpha'].default_value = 0.35
    made = []
    for c in json.loads(obj['colliders']):
        gx, gy, gz = c['c']
        cen = V((gx, -gz, gy))
        if c['type'] == 'box':
            hx, hy, hz = c['h']
            o = kit.box((2 * hx, 2 * hz, 2 * hy), loc=cen, rot=(0, 0, math.degrees(c['ry'])), mat='paint_red', name='_cbox')
        else:
            o = kit.cyl(c['r'], c['hgt'], loc=cen + V((0, 0, c['hgt'] / 2)), mat='paint_red', verts=16, name='_ccyl')
        o.data.materials.clear()
        o.data.materials.append(mat)
        made.append(o)
    for k, v in json.loads(obj['anchors']).items():
        o = kit.sphere(0.25, loc=(v[0], -v[2], v[1]), mat='window_lit', subdiv=1, name='_anchor')
        made.append(o)
    kit.preview([obj] + made, path, size=512, samples=16, elevation=35, azimuth=-30)
    for o in made:
        kit.delete(o)


def overview(objs):
    """Houses side by side as along a street (fronts to -Y): an elevation
    from across the street and an eye-level view down the row."""
    dups = [kit.duplicate(o, o.name + '_ov') for o in objs]
    bpy.context.view_layer.update()
    kit.layout_row(dups, gap=1.5)
    bpy.context.view_layer.update()
    mn = V((min(kit.bounds(d)[0].x for d in dups), min(kit.bounds(d)[0].y for d in dups), 0))
    mx = V((max(kit.bounds(d)[1].x for d in dups), max(kit.bounds(d)[1].y for d in dups), max(kit.bounds(d)[1].z for d in dups)))
    cx = (mn.x + mx.x) / 2
    width = mx.x - mn.x
    P.street_view(dups, os.path.join(PREV, 'overview_houses.png'), cam=(cx, -60.0, 14.0), target=(cx, 0.0, 4.2),
                  res=(1800, 520), ortho=width * 1.04, samples=16)
    P.street_view(dups, os.path.join(PREV, 'overview_street.png'), cam=(mn.x - 4.0, mn.y - 7.0, 1.7),
                  target=(mn.x + 22.0, 0.0, 3.2), lens=22, res=(1200, 640), samples=16)
    for d in dups:
        kit.delete(d)


def main():
    args = kit.args_after_dashes()
    flags = {a for a in args if a.startswith('--')}
    names = [a for a in args if not a.startswith('--')]
    dev = '--dev' in flags
    do_prev = '--no-preview' not in flags
    for n in names:
        if n not in BUILDERS and n != 'overview':
            raise SystemExit(f'unknown node {n!r}; known: {sorted(BUILDERS)}')
    kit.reset()
    # mathutils.noise.noise_vector() adds per-process offsets seeded from the
    # clock unless a seed is set: fix it so the build is deterministic.
    from mathutils import noise
    noise.seed_set(1944)
    P.register_surfaces()
    P.register_v3()
    P.BAKE = '--nobake' not in flags
    t0 = time.time()
    build = [n for n in ORDER if n in BUILDERS and (not dev or n in names)]
    objs = {}
    for n in build:
        t = time.time()
        objs[n] = BUILDERS[n]()
        kit.log(f'{n}: {kit.tri_count(objs[n])} tris, {time.time() - t:.1f}s')
    if not dev:
        kit.export([objs[n] for n in build], os.path.join(kit.MODELS, 'village.glb'), images=P.BAKE, quality=QUALITY)
    kit.log(f'built in {time.time() - t0:.1f}s')
    if do_prev:
        sc = bpy.context.scene
        sc.cycles.use_denoising = True            # review renders only (bakes are done)
        targets = names if names else build + ['overview']
        for n in targets:
            if n == 'overview':
                houses = [objs[h] for h in ('house_a', 'house_b', 'house_c', 'house_d', 'house_e', 'house_f', 'house_g',
                                            'barn', 'ruin', 'ruin_b') if h in objs]
                if houses:
                    overview(houses)
            elif n in objs:
                preview_node(objs[n], n)
    if '--normals' in flags:
        # review: every back face seen by the camera glows magenta
        for mat in list(bpy.data.materials):
            if not mat.use_nodes:
                continue
            nt = mat.node_tree
            out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
            bsdf = nt.nodes.get('Principled BSDF')
            if out is None or bsdf is None:
                continue
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (1, 0, 1, 1)
            em.inputs['Strength'].default_value = 3.0
            mix = nt.nodes.new('ShaderNodeMixShader')
            lp = nt.nodes.new('ShaderNodeLightPath')
            mul = nt.nodes.new('ShaderNodeMath')
            mul.operation = 'MULTIPLY'
            nt.links.new(geo.outputs['Backfacing'], mul.inputs[0])
            nt.links.new(lp.outputs['Is Camera Ray'], mul.inputs[1])
            nt.links.new(mul.outputs['Value'], mix.inputs['Fac'])
            nt.links.new(bsdf.outputs['BSDF'], mix.inputs[1])
            nt.links.new(em.outputs['Emission'], mix.inputs[2])
            nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
        tmp = os.environ.get('TMPDIR', '/tmp')
        for n in (names or build):
            if n in objs:
                for suffix, el, az in (('a', 20, -35), ('b', 25, 145), ('c', -8, 60)):
                    kit.preview([objs[n]], os.path.join(tmp, f'nrm_{n}_{suffix}.png'), size=384, samples=8, elevation=el, azimuth=az)
    if '--colliders' in flags:
        tmp = os.environ.get('TMPDIR', '/tmp')
        for n in names:
            if n in objs:
                collider_view(objs[n], n, os.path.join(tmp, f'col_{n}.png'))
    if '--detail' in flags:
        tmp = os.environ.get('TMPDIR', '/tmp')
        shots = {
            'church': [((7.0, -22.0, 9.0), (0.0, -9.1, 15.5), 50), ((-14.0, -26.0, 1.7), (0.0, -6.0, 6.0), 24)],
            'bridge_stone': [((-14.0, -3.0, -2.6), (0.0, 0.0, -1.5), 24), ((-1.2, -16.0, 1.5), (0.0, 0.0, 0.3), 28)],
            'barn': [((0.5, -8.5, 1.7), (0.0, 1.0, 1.8), 24)],
            'ruin': [((1.5, -7.5, 1.7), (-0.5, 0.0, 1.8), 24), ((0.6, 7.5, 1.7), (0.3, 0.0, 1.5), 24)],
            # the render: the cracked side wall from the alley, and from 2 m
            'house_b': [((-7.5, -1.0, 2.2), (-2.9, 0.4, 3.0), 24), ((-5.0, 1.5, 1.6), (-2.9, 1.2, 1.5), 30)],
            'house_e': [((2.0, -9.5, 1.7), (2.0, 0.0, 2.6), 26), ((6.5, 1.5, 1.7), (4.5, 1.5, 1.8), 30)],
        }
        for n in names:
            for i, (cam, tgt, lens) in enumerate(shots.get(n, [])):
                obj = objs[n]
                extra = []
                if n == 'church':
                    import json
                    a = json.loads(obj['anchors'])['sniper']
                    extra.append(kit.box((0.5, 0.3, 1.75), loc=(a[0], -a[2], a[1] + 0.875), mat='paint_red', name='_sniper'))
                P.street_view([obj] + extra, os.path.join(tmp, f'det_{n}_{i}.png'), cam=cam, target=tgt, lens=lens)
                for e in extra:
                    kit.delete(e)
    if '--street' in flags:
        # eye-level review shots into $TMPDIR (not deliverables)
        tmp = os.environ.get('TMPDIR', '/tmp')
        for n in names:
            if n in objs:
                mn, mx = kit.bounds(objs[n])
                P.street_view([objs[n]], os.path.join(tmp, f'sv_{n}.png'), cam=(mn.x - 1.0, mn.y - 6.0, 1.7),
                              target=((mn.x + mx.x) / 2 - 0.5, (mn.y + mx.y) / 2, min(3.0, mx.z * 0.5)))
                P.street_view([objs[n]], os.path.join(tmp, f'sv_{n}_b.png'), cam=(mx.x + 2.0, mx.y + 5.0, 1.7),
                              target=((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, min(3.0, mx.z * 0.5)))
    kit.log(f'done in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
