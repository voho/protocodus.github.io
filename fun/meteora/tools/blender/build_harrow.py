"""Meteora — the Harrow: the Maul bomber, the Eye sentry, the Seed and the
fold anchor, with their generated js/anchors/<name>.js modules.

All four follow the Thorn (build_ships.build_interceptor): faceted
sections, gunmetal and oxblood plates, hazard stripes, red eyes and seams.
Parts are bmesh primitives (helpers in build_ships.py and harrow_parts.py)
modelled in Blender space with the nose along +Y and the top along +Z;
each model is joined into one mesh, unwrapped and its procedural paint
baked to one WebP texture set (normal, base colour, metallic-roughness,
emissive). Animated parts (the sentry's `eye`, the anchor's `emitter`)
are baked with the rest and then split into child nodes whose origin is
their pivot. The Seed's rock is sculpted and decimated as in
build_asteroids.py and baked from the sculpt; its fabricator growths and
rocket clusters are baked from their own paint into the same atlas.

  Blender --background --factory-startup --python build_harrow.py [-- maul sentry seed anchor]

Set METEORA_FAST=1 for quick geometry iterations (tiny textures, 1 sample).
"""
import bpy, bmesh, math, os, random, sys
import numpy as np
from mathutils import Vector, Matrix, noise

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S
import harrow_parts as H
import build_asteroids as A

FAST = H.FAST
band = S.band
GUNMETAL, OXBLOOD, RED = H.GUNMETAL, H.OXBLOOD, H.RED


# ==========================================================================
# Maul — Harrow bomber drone, about 17 m long

MAUL_BODY = [
    # y, chine half-width, roof height above the chine, belly depth below, chine z
    (8.1, 0.32, 0.3, 0.2, -0.3),
    (7.0, 0.84, 0.54, 0.48, -0.34),
    (6.6, 1.0, 1.02, 0.58, -0.34),
    (5.4, 1.42, 1.42, 0.74, -0.3),
    (3.9, 2.0, 2.45, 0.88, -0.26),
    (2.4, 2.22, 2.78, 0.94, -0.24),
    (0.0, 2.2, 2.5, 0.95, -0.22),
    (-3.0, 1.98, 1.98, 0.9, -0.18),
    (-5.6, 1.6, 1.5, 0.8, -0.14),
    (-7.3, 1.22, 1.08, 0.62, -0.1),
]
M_ENG = (1.32, 0.0)                     # engine axis x, z
M_GUN = (1.1, -0.74)                    # gun axis x, z
M_SPINE_Z = -2.32                       # torpedo spine axis z
M_TINES = [(3.4, 1.55), (1.75, 1.95), (0.0, 1.75), (-1.8, 1.45), (-3.55, 1.15), (-5.2, 0.8)]
M_PLATES = [(-5.7, -3.5, 2.3), (-4.0, -1.6, 2.8), (-2.1, 0.3, 3.2), (-0.2, 2.2, 3.5), (1.7, 4.2, 3.4)]
M_WING = [(1.8, 0.9, 0.05, 4.9, 0.12), (4.0, 1.35, -0.72, 3.2, 0.09), (6.05, 1.95, -1.45, 1.6, 0.075)]

M_RCS = [
    ('rcs_01', (0, 7.6, 4), (0, 0, -1), (0, 0, 1)),             # nose up, on the snout
    ('rcs_02', (0, 7.3, -4), (0, 0, 1), (0, 0, -1)),            # nose down
    ('rcs_03', (4, 7.35, -0.3), (-1, 0, 0), (1, 0, 0)),         # nose right
    ('rcs_04', (-4, 7.35, -0.3), (1, 0, 0), (-1, 0, 0)),        # nose left
    ('rcs_05', (0, -6.6, 4), (0, 0, -1), (0, 0, 1)),            # tail up
    ('rcs_06', (0, -6.6, -4), (0, 0, 1), (0, 0, -1)),           # tail down
    ('rcs_07', (5, -6.4, 0.0), (-1, 0, 0), (1, 0, 0)),          # tail right, on the engine housing
    ('rcs_08', (-5, -6.4, 0.0), (1, 0, 0), (-1, 0, 0)),         # tail left
    ('rcs_09', (5.45, 0.9, 4), (0, 0, -1), (0, 0, 1)),          # right wingtip up
    ('rcs_10', (5.45, 0.9, -4), (0, 0, 1), (0, 0, -1)),         # right wingtip down
    ('rcs_11', (-5.45, 0.9, 4), (0, 0, -1), (0, 0, 1)),         # left wingtip up
    ('rcs_12', (-5.45, 0.9, -4), (0, 0, 1), (0, 0, -1)),        # left wingtip down
    ('rcs_13', (0.3, 7.85, 4), (0, 0, -1), (0.3, 1, 0.1)),      # snout, forward-facing right (reverse)
    ('rcs_14', (-0.3, 7.85, 4), (0, 0, -1), (-0.3, 1, 0.1)),    # snout, forward-facing left
    ('rcs_15', (M_ENG[0], -6.9, 4), (0, 0, -1), (0, -1, 0)),    # housing top, aft-facing right
    ('rcs_16', (-M_ENG[0], -6.9, 4), (0, 0, -1), (0, -1, 0)),   # housing top, aft-facing left
]


def maul_materials(eye_c, eye_axis):
    M = H.common_materials('m')

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.3, -0.6)
        side = g.smooth(g.absolute(nx), 0.45, 0.6)
        cheek = g.mul(g.mul(band(g, y, 2.9, 6.4, 0.015), side), band(g, z, -0.45, -0.12, 0.01))
        col = g.mix(cheek, GUNMETAL, OXBLOOD)
        col = g.mix(under, col, H.UNDER)
        haz = g.mul(band(g, y, -6.45, -5.95, 0.006), g.sub(1.0, under))
        col = g.mix(haz, col, H.hazard_paint(g, x, z, 0.14))
        col = g.mix(g.smooth(y, 7.75, 7.8), col, H.BLACKED)
        # gills: slanted glowing slits on the neck, behind the head
        s = g.math('FRACT', g.mul(g.add(y, g.mul(z, 0.6)), 1 / 0.38))
        slit = g.mul(g.smooth(s, 0.0, 0.04), g.sub(1.0, g.smooth(s, 0.12, 0.16)))
        gills = g.mul(g.mul(slit, band(g, y, 3.4, 5.3, 0.02)), g.mul(band(g, z, -0.05, 0.75, 0.02), side))
        col = g.mix(gills, col, (0.02, 0.005, 0.004))
        glow = g.mix(gills, (0, 0, 0), RED)
        return H.finish(g, col, 0.44, g.mixf(cheek, 0.55, 0.32), P, N, panel=(1.1, 0.42), glow=glow)

    def carapace(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        ridge = g.sub(1.0, g.smooth(ax, 0.62, 0.66))
        col = g.mix(ridge, GUNMETAL, OXBLOOD)
        col = g.mix(g.smooth(ax, 1.25, 1.3), col, OXBLOOD)
        col = g.mix(g.mul(band(g, ax, 0.82, 1.0, 0.01), band(g, y, 2.4, 4.1, 0.01)), col,
                    H.hazard_paint(g, x, y, 0.1))
        return H.finish(g, col, g.mixf(ridge, 0.44, 0.5), g.mixf(ridge, 0.55, 0.3), P, N, panel_scale=1.4,
                        panel=(1.3, 0.5), wear=1.2)

    def tine(g, P, N):
        x, y, z = g.sep(P)
        steel = g.smooth(z, 2.9, 3.7)
        col = g.mix(steel, OXBLOOD, H.STEEL)
        col = g.mix(band(g, z, 2.55, 2.7, 0.01), col, H.BLACKED)
        return H.finish(g, col, g.mixf(steel, 0.42, 0.3), g.mixf(steel, 0.35, 0.8), P, N, lines=False, wear=1.4)

    def keel(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(y, 3.3, 3.4), (0.05, 0.053, 0.058), OXBLOOD)
        col = g.mix(band(g, y, -3.4, -2.8, 0.006), col, H.hazard_paint(g, y, z, 0.12))
        return H.finish(g, col, 0.46, 0.5, P, N, panel_scale=1.4)

    def wing(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        outer = g.smooth(ax, 4.6, 4.65)
        col = g.mix(outer, GUNMETAL, OXBLOOD)
        col = g.mix(band(g, ax, 4.15, 4.5, 0.006), col, H.hazard_paint(g, x, y, 0.12))
        under = g.smooth(g.sep(N)[2], -0.2, -0.45)
        col = g.mix(g.mul(under, 0.7), col, H.UNDER)
        return H.finish(g, col, 0.45, g.mixf(outer, 0.55, 0.32), P, N, panel=(1.1, 0.42))

    def engine(g, P, N):
        x, y, z = g.sep(P)
        heat = g.smooth(y, -6.6, -7.5)
        col = g.mix(heat, (0.05, 0.053, 0.058), (0.085, 0.065, 0.06))
        col = g.mix(band(g, y, -5.05, -4.7, 0.006), col, H.hazard_paint(g, x, z, 0.12))
        return H.finish(g, col, g.mixf(heat, 0.45, 0.4), g.mixf(heat, 0.55, 0.68), P, N, wear=0.7,
                        panel_scale=1.4)

    def spine(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(band(g, y, 4.35, 5.1, 0.006), H.BLACKED, H.hazard_paint(g, y, z, 0.12))
        for lo, hi in ((1.6, 1.85), (-1.1, -0.85), (-3.8, -3.55)):
            col = g.mix(band(g, y, lo, hi, 0.006), col, OXBLOOD)
        return H.finish(g, col, 0.5, 0.5, P, N, panel_scale=1.6, wear=0.8)

    M.update(body=S.material('m_body', body), carapace=S.material('m_carapace', carapace),
             tine=S.material('m_tine', tine), keel=S.material('m_keel', keel), wing=S.material('m_wing', wing),
             engine=S.material('m_engine', engine), spine=S.material('m_spine', spine),
             nozzle=S.nozzle_material('m_nozzle', M_ENG[0], M_ENG[1]),
             eye=H.eye_material('m_eye', eye_c + eye_axis * 0.33, eye_axis, 0.4))
    return M


def build_maul():
    # The eye sits in the steep brow face; find it before painting.
    probe = S.loft('probe', MAUL_BODY, None, section=H.roofed, front_tip=(0, 8.45, -0.3), back_tip=(0, -7.6, -0.1))
    hit, nrm = H.surface_hit(S.bvh_of([probe]), (0, 12, 0.42), (0, -1, 0))
    bpy.data.objects.remove(probe)
    eye_axis = (nrm.normalized() + Vector((0, 0.9, 0))).normalized()
    eye_c = hit + eye_axis * 0.02
    M = maul_materials(eye_c, eye_axis)
    C.log('  eye', tuple(round(v, 3) for v in eye_c), tuple(round(v, 3) for v in eye_axis))

    parts = []
    body = S.loft('body', MAUL_BODY, M['body'], section=H.roofed, front_tip=(0, 8.45, -0.3),
                  back_tip=(0, -7.6, -0.1), smooth=True, sharp=14)
    parts.append(body)
    bvh = S.bvh_of([body])

    # The eye: a hexagonal housing set in the brow face, a big red lens.
    eye_m = S.facing(eye_c, eye_axis) @ Matrix.Rotation(math.radians(90), 4, 'X')
    parts.append(S.transformed(S.lathe('eye_housing', [(-0.3, 0.0), (-0.3, 0.64), (0.1, 0.62), (0.18, 0.5),
                                                       (0.18, 0.0)], 6, (0, 0), M['metal'], smooth=False,
                                       phase=math.pi / 6), eye_m))
    parts.append(S.transformed(S.lathe('eye', [(0.11, 0.44), (0.21, 0.41), (0.3, 0.24), (0.34, 0.0)], 20, (0, 0),
                                       M['eye']), eye_m))
    # Two small sensor eyes low on the cheeks, either side of the snout.
    for sgn in (1, -1):
        loc, nrm = H.surface_hit(bvh, (sgn * 3, 6.05, -0.05), (-sgn, 0.35, 0))
        axis = (nrm + Vector((0, 0.9, 0))).normalized()
        m = S.facing(loc + axis * 0.01, axis) @ Matrix.Rotation(math.radians(90), 4, 'X')
        side_name = 'rl'[sgn < 0]
        parts.append(S.transformed(S.lathe(f'pit{side_name}', [(-0.2, 0.0), (-0.2, 0.25), (0.08, 0.24), (0.08, 0.0)],
                                           6, (0, 0), M['metal'], smooth=False, phase=math.pi / 6), m))
        parts.append(S.transformed(S.lathe(f'pit_lens{side_name}', [(0.06, 0.16), (0.1, 0.12), (0.13, 0.0)], 8,
                                           (0, 0), M['red']), m))
    # The brow: a V of oxblood armour over the eye.
    parts.append(H.hug_plate('brow', bvh, (0, 10, eye_c.z + 0.72), (0, -1, -0.12), (1, 0, 0), (0, 0, 1),
                             (1.7, 0.42), M['armour'], thick=0.16, grid=(6, 2),
                             shape=lambda s, t: (s, t - 0.42 + 1.05 * abs(s))))

    # Layered carapace plates down the back, each riding on the one behind.
    plates = []
    for i, (y0, y1, w) in enumerate(M_PLATES):
        under = S.bvh_of([body] + plates)
        plates.append(H.hug_plate(f'carapace{i}', under, (0, (y0 + y1) / 2, 6), (0, 0, -1), (1, 0, 0), (0, 1, 0),
                                  (w, y1 - y0), M['carapace'], thick=0.13, grid=(6, 2),
                                  shape=lambda s, t: (s, t - 0.55 * abs(s))))
    parts += plates
    back = S.bvh_of([body] + plates)

    # One row of raked harrow tines along the ridge.
    for i, (yy, h) in enumerate(M_TINES):
        loc, nrm = H.surface_hit(back, (0, yy, 6), (0, 0, -1))
        up, aft = Vector((0, 0, 1)), Vector((0, -1, 0))
        parts.append(H.tine(f'tine{i}', loc - Vector((0, 0, 0.5)), loc + up * h * 0.55 + aft * h * 0.38,
                            loc + up * h * 0.92 + aft * h * 0.95, 0.3 + 0.17 * h, 0.1, M['tine'], (0, 1, 0.3), n=6,
                            taper=1.0))

    # The deep keel: a faceted blade under the belly whose lower edge
    # carries the torpedo spine, like the bulb of a yacht's keel.
    rows = [  # y, top (buried in the belly), bottom edge
        (8.25, -0.42, -0.62), (7.3, -0.55, -1.12), (6.0, -0.7, -1.66), (5.3, -0.8, -1.86), (4.2, -0.85, -2.05),
        (-2.8, -0.85, -2.05), (-4.1, -0.8, -1.75), (-5.1, -0.7, -1.05)]
    parts.append(H.blade('keel', [(0, yy, (tz + bz) / 2) for yy, tz, bz in rows], [(tz - bz) / 2 for _, tz, bz in rows],
                         [0.05, 0.11, 0.17, 0.21, 0.24, 0.24, 0.2, 0.1], M['keel'], (0, 0, 1), sharp=20))
    parts.append(S.lathe('spine', [(-6.1, 0.0), (-5.85, 0.24), (-5.3, 0.48), (4.75, 0.48), (4.92, 0.55), (5.45, 0.55),
                                   (5.45, 0.42)], 8, (0, M_SPINE_Z), M['spine'], smooth=True, sharp=20,
                         phase=math.pi / 8))
    parts.append(S.lathe('spine_bore', [(5.45, 0.42), (5.12, 0.38), (5.12, 0.0)], 8, (0, M_SPINE_Z), M['hole'],
                         smooth=False, phase=math.pi / 8))
    for k, yy in enumerate((2.3, -0.7, -3.7)):
        parts.append(S.lathe(f'spine_ring{k}', [(yy + 0.2, 0.0), (yy + 0.2, 0.54), (yy + 0.12, 0.56), (yy - 0.12, 0.56),
                                                (yy - 0.2, 0.54), (yy - 0.2, 0.0)], 8, (0, M_SPINE_Z), M['metal'],
                             smooth=False, phase=math.pi / 8))
    for k in range(4):
        m = (Matrix.Translation((0, -5.15, M_SPINE_Z)) @ Matrix.Rotation(math.radians(45 + 90 * k), 4, 'Y')
             @ Matrix.Translation((0, 0, 0.42)))
        parts.append(S.box(f'spine_fin{k}', (0.06, 0.9, 0.42), M['armour'], m, taper=0.55))

    side = []
    # Forward-swept drooping blade wings, armoured leading edges, tip spikes.
    side.append(S.wing('wing', M_WING, M['wing'], chord_pts=7, diamond=True, sharp=20))
    path = [Vector((sx, sy - 0.05, sz)) for sx, sy, sz, _, _ in M_WING]
    path[0] = path[0].lerp(path[1], 0.2)
    side.append(S.bar('wing_edge', path, 0.18, 0.08, M['black'], lambda p: Vector((0, 0.35, 1.0))))
    tip_x, tip_y, tip_z, tip_c, _ = M_WING[-1]
    side.append(S.lathe('wing_spike', [(tip_y - tip_c + 0.1, 0.0), (tip_y - tip_c + 0.15, 0.1), (tip_y + 0.3, 0.1),
                                       (tip_y + 1.75, 0.0)], 6, (tip_x + 0.03, tip_z), M['metal'], smooth=False))
    side.append(S.lathe('runlight', [(tip_y - tip_c + 0.3, 0.0), (tip_y - tip_c + 0.33, 0.14),
                                     (tip_y - tip_c + 0.47, 0.14), (tip_y - tip_c + 0.5, 0.0)], 8,
                        (tip_x + 0.03, tip_z), M['red']))
    # Engines: octagonal armoured housings, big bells, glowing throats.
    side.append(S.lathe('housing', [(-3.5, 0.0), (-3.55, 0.62), (-4.05, 0.98), (-7.05, 0.98), (-7.42, 0.9),
                                    (-7.48, 0.0)], 8, M_ENG, M['engine'], smooth=True, sharp=20, phase=math.pi / 8))
    side.append(S.lathe('bell', [(-7.38, 0.8), (-7.9, 0.76), (-8.42, 0.84), (-8.5, 0.84), (-8.52, 0.79),
                                 (-8.0, 0.66), (-7.7, 0.47), (-7.58, 0.45), (-7.48, 0.57), (-7.42, 0.7)],
                        24, M_ENG, M['nozzle'], closed=True, sharp=35))
    side.append(S.lathe('throat', [(-7.66, 0.0), (-7.66, 0.47), (-7.62, 0.47), (-7.62, 0.0)], 24, M_ENG,
                        M['glow'], smooth=False))
    for k, yy in enumerate((-5.6, -6.6)):
        side.append(S.lathe(f'collar{k}', [(yy, 0.0), (yy, 1.03), (yy - 0.16, 1.03), (yy - 0.16, 0.0)], 8, M_ENG,
                            M['metal'], smooth=False, phase=math.pi / 8))
    # Gun blisters low on the cheeks, barrels forward like mandibles.
    gx, gz = M_GUN
    gun = S.loft('gun', [(6.6, 0.05, 0.04, 0.04, 0.0), (6.3, 0.27, 0.22, 0.17, 0.0), (4.7, 0.36, 0.28, 0.23, 0.0),
                         (3.3, 0.32, 0.24, 0.2, 0.0)], M['metal'], section=S.faceted, back_tip=(0, 3.0, 0.0),
                 smooth=True, sharp=15)
    side.append(S.transformed(gun, Matrix.Translation((gx, 0, gz))))
    side.append(S.lathe('barrel', [(6.2, 0.0), (6.2, 0.075), (7.68, 0.075), (7.71, 0.105), (7.96, 0.105), (7.98, 0.0)],
                        8, (gx, gz), M['metal'], sharp=40))
    side.append(S.lathe('bore', [(7.9, 0.0), (7.9, 0.055), (7.985, 0.055), (7.985, 0.0)], 8, (gx, gz), M['hole'],
                        smooth=False))
    # Shoulder armour over the wing roots, layered front over back.
    pauldrons = []
    for i, (yy, zz, size) in enumerate(((-1.3, 0.6, (1.5, 2.5)), (0.9, 0.75, (1.7, 2.6)))):
        under = S.bvh_of([body] + pauldrons)
        pauldrons.append(H.hug_plate(f'pauldron{i}', under, (4, yy, zz + 0.6), (-1, 0, -0.3), (0, 0, 1),
                                     (0, 1, 0), size, M['armour'], thick=0.16, grid=(3, 3),
                                     shape=lambda s, t: (s, t - 0.35 * (s + 0.5))))
    # flank plates and a louvred vent behind the gills
    flank = S.bvh_of([body] + pauldrons)
    for i, (yy, zz, size) in enumerate(((2.85, 0.15, (0.75, 1.0)), (-3.6, 0.05, (0.7, 1.3)))):
        side.append(H.hug_plate(f'flank{i}', flank, (4, yy, zz), (-1, 0, -0.1), (0, 0, 1), (0, 1, 0), size,
                                M['body'], thick=0.07, grid=(2, 2)))
    _, m = S.frame_on(flank, (4, -2.2, 0.35), (-1, 0, -0.15))
    side += S.vent('vent', (0.55, 0.9, 0.06), M['metal'], m, slats=5)
    side += pauldrons
    chine = [Vector((w * 1.0, yy, zc)) for yy, w, _, _, zc in MAUL_BODY[3:9]]
    side.append(S.bar('strake', chine, 0.2, 0.14, M['armour'], lambda p: Vector((1, 0, 0.15))))
    parts += S.mirrored(side)
    parts.append(H.tine('tail_spike', (0, -6.8, 0.1), (0, -8.0, 0.12), (0, -9.0, 0.1), 0.42, 0.13, M['tine'],
                        (0, 0, 1), n=5, lead=1.0))

    _, m = S.frame_on(S.bvh_of([body] + plates), (0.45, -6.3, 6), (0, 0, -1))
    parts.append(S.transformed(S.lathe('antenna', [(0.0, 0.03), (1.0, 0.012), (1.04, 0.0)], 5, (0, 0), M['metal']),
                               m @ Matrix.Rotation(math.radians(64), 4, 'X')
                               @ Matrix.Rotation(math.radians(180), 4, 'Z')))
    rcs_bvh = S.bvh_of([o for o in parts if o.name.startswith(('body', 'housing', 'wing'))])
    rcs_parts, empties = S.place_rcs(M_RCS, rcs_bvh, M)
    parts += rcs_parts
    dock = H.surface_hit(S.bvh_of([body] + plates), (0, -4.55, 6), (0, 0, -1))[0] + Vector((0, 0, 0.05))
    light = (tip_x + 0.03, tip_y - tip_c + 0.4, tip_z)
    empties += [
        H.empty('nozzle_R', (M_ENG[0], -8.52, M_ENG[1])), H.empty('nozzle_L', (-M_ENG[0], -8.52, M_ENG[1])),
        H.empty('muzzle_R', (gx, 7.985, gz)), H.empty('muzzle_L', (-gx, 7.985, gz)),
        H.empty('launcher_0', (0, 5.6, M_SPINE_Z)),
        H.empty('cam_cockpit', tuple(eye_c + eye_axis * 0.45)),
        H.empty('dock', tuple(dock)),
        H.empty('light_0', light), H.empty('light_1', (-light[0], light[1], light[2])),
    ]
    for i, (c, r) in enumerate((((0, 6.7, -0.2), 1.2), ((0, 4.5, 0.1), 1.75), ((0, 2.0, 0.45), 2.3),
                                ((0, -1.0, 0.4), 2.3), ((0, -4.0, 0.25), 2.05), ((0, -6.9, 0.0), 1.65),
                                ((3.4, 0.3, -0.5), 1.25), ((-3.4, 0.3, -0.5), 1.25),
                                ((5.4, 1.1, -1.2), 0.95), ((-5.4, 1.1, -1.2), 0.95),
                                ((0, 2.6, M_SPINE_Z), 0.65), ((0, -1.8, M_SPINE_Z), 0.65))):
        empties.append(H.empty(f'col_{i:02d}', c, radius=r))
    info = dict(nozzle_size={'nozzle_L': 0.75, 'nozzle_R': 0.75},
                lights={'light_0': ((1.0, 0.16, 0.1), 0), 'light_1': ((1.0, 0.16, 0.1), 0)})
    return parts, empties, info


# ==========================================================================
# Eye — Harrow sentry, an armoured sphere about 8 m across

E_C = Vector((0, 1.05, 0))              # eye centre: the `eye` node's origin and pivot
E_R = 1.15                              # eyeball radius
E_SHELL = 2.4                           # armour sphere radius
E_FINS = [(90, 4.6), (210, 4.6), (330, 4.6), (30, 3.5), (150, 3.5), (270, 3.5)]   # lon, tip radius


def sentry_materials():
    M = H.common_materials('s')

    def lat_cos(g, P):
        return g.math('DIVIDE', g.sep(P)[1], g.vmath('LENGTH', P, out=1))

    def plate(g, P, N):
        x, y, z = g.sep(P)
        front = g.smooth(lat_cos(g, P), 0.02, 0.12)
        col = g.mix(front, GUNMETAL, OXBLOOD)
        return H.finish(g, col, g.mixf(front, 0.44, 0.48), g.mixf(front, 0.55, 0.32), P, N,
                        panel_scale=1.0, panel=(0.95, 0.4), wear=1.1)

    def shell(g, P, N):
        c = lat_cos(g, P)
        lit = g.mul(g.smooth(c, -0.8, -0.74), g.sub(1.0, g.smooth(c, 0.6, 0.66)))
        glow = g.mix(lit, (0, 0, 0), (RED[0] * 0.12, RED[1] * 0.12, RED[2] * 0.12))
        return H.plain(g, P, N, (0.03, 0.012, 0.011), 0.5, 0.4, glow)

    def socket(g, P, N):
        y = g.sep(P)[1]
        lit = g.smooth(y, 0.2, 1.5)
        glow = g.mix(lit, (0.004, 0.0, 0.0), (0.05, 0.001, 0.0005))
        return H.plain(g, P, N, (0.025, 0.01, 0.01), 0.45, 0.5, glow)

    def belt(g, P, N):
        x, y, z = g.sep(P)
        a = g.math('ARCTAN2', z, x)
        seg = g.smooth(g.math('SINE', g.mul(a, 3.0)), 0.55, 0.6)
        col = g.mix(seg, H.BLACKED, H.hazard_paint(g, g.mul(a, 2.5), y, 0.13))
        col = g.mix(g.maximum(band(g, y, 0.04, 0.1, 0.005), band(g, y, -0.68, -0.62, 0.005)), col, OXBLOOD)
        return H.finish(g, col, 0.5, 0.5, P, N, lines=False, wear=0.9)

    def fin(g, P, N):
        x, y, z = g.sep(P)
        rad = g.vmath('LENGTH', g.combine(x, 0.0, z), out=1)
        col = g.mix(g.smooth(rad, 3.5, 3.55), GUNMETAL, OXBLOOD)
        col = g.mix(band(g, rad, 2.85, 3.12, 0.006), col, H.hazard_paint(g, rad, y, 0.1))
        return H.finish(g, col, 0.45, 0.5, P, N, panel_scale=1.1, panel=(0.9, 0.35), wear=1.2)

    apex = E_C + Vector((0, E_R + 0.08, 0))
    M.update(plate=S.material('s_plate', plate), shell=S.material('s_shell', shell),
             socket=S.material('s_socket', socket),
             belt=S.material('s_belt', belt), fin=S.material('s_fin', fin),
             eye=H.eye_material('s_eye', apex, (0, 1, 0), 0.82, hot=1.0),
             sclera=S.material('s_sclera', lambda g, P, N: H.plain(g, P, N, (0.02, 0.016, 0.016), 0.22, 0.85)))
    return M


def build_sentry():
    M = sentry_materials()
    parts = []
    cx = (0, 0)
    # Armour sphere: a faceted shell, a socket behind the eye that glows
    # red, a hexagonal collar round the opening.
    parts.append(S.lathe('shell', [(1.85, 1.4), (1.98, 1.58), (1.88, 1.82), (1.42, 2.13), (0.72, 2.33), (0.0, 2.4),
                                   (-0.72, 2.32), (-1.42, 2.02), (-1.95, 1.48), (-2.25, 0.82), (-2.38, 0.0)],
                         12, cx, M['shell'], smooth=True, sharp=20))
    parts.append(S.lathe('socket', [(-0.15, 0.0), (-0.15, 0.95), (0.6, 1.3), (1.6, 1.3), (1.85, 1.4)], 12, cx,
                         M['socket'], smooth=True, sharp=30))
    parts.append(S.lathe('collar', [(1.55, 1.5), (1.62, 1.94), (1.94, 1.98), (2.14, 1.78), (2.17, 1.52), (2.06, 1.45)],
                         6, cx, M['metal'], closed=True, smooth=False, phase=math.pi / 6))
    parts.append(S.lathe('belt', [(0.15, 2.3), (0.12, 2.53), (0.03, 2.59), (-0.63, 2.59), (-0.72, 2.53), (-0.75, 2.25)],
                         12, cx, M['belt'], smooth=True, sharp=30))
    for k in range(6):
        parts.append(H.sphere_plate(f'front{k}', (0, 0, 0), E_SHELL, (47, 84), (60 * k - 29, 60 * k + 29), M['plate'],
                                    thick=0.12, grid=(3, 2)))
        parts.append(H.sphere_plate(f'rear{k}', (0, 0, 0), E_SHELL, (107, 141), (60 * k + 1.5, 60 * k + 58.5),
                                    M['plate'], thick=0.12, grid=(3, 2)))
    # Radial blade fins from the belt, swept back; three long, three short.
    for k, (lon, tip) in enumerate(E_FINS):
        d = H.sphere_dir(90, lon)
        root = d * 2.1 + Vector((0, -0.2, 0))
        ctrl = d * (tip * 0.72) + Vector((0, -0.35, 0))
        end = d * tip + Vector((0, -1.35 if tip > 4 else -1.0, 0))
        parts.append(H.tine(f'fin{k}', root, ctrl, end, 0.82 if tip > 4 else 0.62, 0.09, M['fin'], (0, 1, 0), n=6,
                            lead=1.1, taper=0.75))
    # Spines raking back from the gaps between the rear plates.
    for k in range(6):
        base = H.sphere_dir(128, 60 * k) * 2.2
        d = (H.sphere_dir(150, 60 * k) * 1.0 + Vector((0, -0.5, 0))).normalized()
        m = S.facing(base, d) @ Matrix.Rotation(math.radians(90), 4, 'X')
        parts.append(S.transformed(S.lathe(f'spine{k}', [(0.0, 0.09), (1.7, 0.035), (2.1, 0.0)], 5, (0, 0), M['metal'],
                                           smooth=False), m))
    # The drive boss at the back: three vents and an aerial with a red tip.
    parts.append(S.lathe('boss', [(-1.95, 0.0), (-1.95, 1.0), (-2.3, 0.94), (-2.55, 0.66), (-2.6, 0.0)], 6, cx,
                         M['belt'], smooth=False))
    for k in range(3):
        a = math.radians(90 + 120 * k)
        c = (0.36 * math.cos(a), 0.36 * math.sin(a))
        parts.append(S.lathe(f'vent{k}', [(-2.5, 0.17), (-2.78, 0.2), (-2.8, 0.17), (-2.66, 0.12), (-2.55, 0.12)], 8, c,
                             M['metal'], closed=True, sharp=35))
        parts.append(S.lathe(f'vent_hole{k}', [(-2.64, 0.0), (-2.64, 0.13), (-2.6, 0.13), (-2.6, 0.0)], 8, c, M['hole'],
                             smooth=False))
    parts.append(S.lathe('aerial', [(-2.55, 0.0), (-2.55, 0.06), (-4.55, 0.025), (-4.56, 0.0)], 5, cx, M['metal'],
                         smooth=False))
    parts.append(S.lathe('aerial_tip', [(-4.5, 0.0), (-4.53, 0.07), (-4.66, 0.07), (-4.7, 0.0)], 6, cx, M['red']))
    # The eye: a dark glossy ball with a domed red lens, its own node.
    ball = S.lathe('eyeball', [(E_C.y + E_R * math.cos(math.radians(a)), E_R * math.sin(math.radians(a)))
                               for a in (45, 49, 64, 90, 130, 180)], 24, cx, M['sclera'])
    rim = (E_C.y + E_R * math.cos(math.radians(45)), E_R * math.sin(math.radians(45)))
    lens = S.lathe('lens', [(E_C.y + E_R + 0.08, 0.0), (E_C.y + 1.19, 0.38), (E_C.y + 1.04, 0.66),
                            (E_C.y + 0.86, 0.8), rim], 24, cx, M['eye'])
    parts += [H.tag(ball, 'eye'), H.tag(lens, 'eye')]

    empties = [H.empty('sub_eye', tuple(E_C), radius=1.4)]
    for i, (c, r) in enumerate([((0, 0, 0), 2.6)] + [(tuple(H.sphere_dir(90, lon) * (tip * 0.72) +
                                                         Vector((0, -0.55, 0))), 0.75 if tip > 4 else 0.55)
                                                   for lon, tip in E_FINS]):
        empties.append(H.empty(f'col_{i:02d}', c, radius=r))
    info = dict(nodes={'eye': 'eye'})
    return parts, empties, info


def make_sentry():
    parts, empties, info = build_sentry()
    export_model('sentry', 'hull', parts, empties, info, (1024, 1024), children={'eye': tuple(E_C)},
                 remarks=('The eye node turns about its origin (the eye centre) and looks along its local -Z,',
                          'like a three.js camera; Object3D.lookAt aims +Z, so face it away from the target.'))


# ==========================================================================
# Seed — a seeded nest rock, radius about 20 m

SEED_R = 20.0
SEED_CUT = 16.4                         # the machined rear face: the plane y = -SEED_CUT
SEED_PODS = [  # surface direction, long axis (tangent-ish), half length, half width
    ((0.25, 0.3, 0.92), (0.1, 1.0, -0.25), 5.0, 2.3),
    ((0.94, 0.28, 0.05), (0.1, 1.0, 0.5), 4.5, 2.1),
    ((-0.62, 0.05, -0.75), (-0.2, 1.0, 0.3), 4.7, 2.2),
]
SEED_TINES = [  # surface direction, lean (added to the normal), heights
    ((0.72, 0.6, 0.38), (0.0, 0.45, 0.25), (6.6, 5.0, 3.8)),
    ((-0.78, 0.45, 0.4), (0.0, 0.5, 0.3), (5.2, 4.0, 3.0)),
    ((0.4, -0.15, -0.88), (0.0, 0.35, -0.25), (4.8, 3.6, 2.8)),
]
SEED_CREEP = [  # extra growth sites without a pod: surface direction, reach (m), nodules
    ((0.15, 1.0, 0.1), 11.0, 4),
    ((-0.75, 0.55, 0.45), 8.0, 2),
    ((0.55, 0.5, -0.65), 8.0, 2),
]
SEED_CLUSTERS = [90, 210, 330]          # angles of the rocket clusters round the rear face
SEED_CLUSTER_R = 5.0


def seed_sculpt():
    """The rock sculpt (build_asteroids recipe), scaled to metres, with the
    rear sliced flat for the engines and an eruption crater with a broken
    rim under each pod. Point attributes: cavity, crater, fresh, infest."""
    A.SHAPES['seed'] = dict(stretch=(0.82, 1.0, 0.78), lumps=0.08, freq=0.9, cuts=(4, 0.03, 0.09), cut_soft=0.03,
                            craters=(16, 0.05, 0.22), crater_depth=0.8, subdiv=6 if FAST else 7, presmooth=6)
    high = A.sculpt(dict(name='seed', kind='seed', seed=73))
    me = high.data
    n = len(me.vertices)
    P = np.empty(n * 3)
    me.vertices.foreach_get('co', P)
    P = P.reshape(-1, 3)
    P -= (P.max(0) + P.min(0)) / 2
    P *= SEED_R / np.abs(P).max()
    get = lambda name: np.array([d.value for d in me.attributes[name].data])
    crater, fresh = get('crater'), get('fresh')
    R = np.linalg.norm(P, axis=1)
    D = P / R[:, None]

    # the rear face, cut flat by the fabricators
    dn = -D[:, 1]
    t = np.where(dn > 1e-3, SEED_CUT / np.maximum(dn, 1e-3), 1e9)
    cut = A.smin(R, t, 0.6)
    fresh = np.maximum(fresh, np.clip((R - cut) / 0.25, 0, 1))
    R = cut

    # eruption craters, stretched along each pod; `infest` (0..1) spreads
    # the growth paint out from them and from the creeping sites
    infest = np.zeros(n)
    for k, (c, axis, L, W) in enumerate(SEED_PODS):
        P = D * R[:, None]
        c = Vector(c).normalized()
        idx = int(np.argmax(D @ np.array(c)))
        S0 = P[idx]
        nrm = S0 / np.linalg.norm(S0)
        a = np.array(axis, float)
        a -= nrm * (a @ nrm)
        a /= np.linalg.norm(a)
        b = np.cross(a, nrm)
        V = P - S0
        x = np.sqrt(((V @ a) / (L * 1.08)) ** 2 + ((V @ b) / (W * 1.3)) ** 2)
        m = x < 2.6
        broken = np.array([0.25 + 1.3 * noise_at(p * 0.5, k) for p in P[m]])
        h = A.crater_shape(x[m]) * W * 0.75 + W * 0.45 * np.exp(-((x[m] - 1.1) / 0.24) ** 2) * broken
        R[m] += h
        crater[m] = np.maximum(crater[m], np.clip(1.2 - x[m], 0, 1))
        infest = np.maximum(infest, np.clip(1.25 - x / 3.2, 0, 1) ** 1.5)

    P = D * R[:, None]
    for c, reach, _ in SEED_CREEP:
        c = np.array(c) / np.linalg.norm(c)
        S0 = P[int(np.argmax(D @ c))]
        dist = np.linalg.norm(P - S0, axis=1)
        infest = np.maximum(infest, np.clip(1.0 - dist / reach, 0, 1) ** 1.2 * 0.8)
    for v, p in zip(me.vertices, P):
        v.co = p
    me.update()
    E = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get('vertices', E)
    E = E.reshape(-1, 2)
    cav = (R - A.laplacian(R, E, n, 12)) + 0.6 * (R - A.laplacian(R, E, n, 60))
    cav = np.clip(cav / (3.0 * cav.std() + 1e-9), -1, 1)
    for name, values in (('cavity', cav), ('crater', crater), ('fresh', fresh), ('infest', infest)):
        attr = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
        attr.data.foreach_set('value', values.astype(np.float32))
    return high


def noise_at(p, k):
    return noise.noise(Vector(p) + Vector((k * 17.3, k * 5.1, -k * 9.7)), noise_basis='PERLIN_NEW') * 0.5 + 0.5


def seed_rock_material(name):
    """The sculpt's paint: build_asteroids' carbonaceous rock, darker and
    stained metallic oxblood where the growths spread, threaded with
    glowing red veins; the machined rear face greyer, with tool rings."""
    radius = SEED_R

    def build(g):
        P = g.vmath('SCALE', g.coord('Object'), scale=1.0 / radius)
        N = g.geometry('Normal')
        radial = g.vmath('NORMALIZE', P)
        slope = g.sub(1.0, g.vmath('DOT_PRODUCT', N, radial, out=1))
        cavity, crater = g.attribute('cavity'), g.attribute('crater')
        fresh, infest = g.attribute('fresh'), g.attribute('infest')
        n1 = g.noise(P, 1.3, 3.0, 0.55, 0.3)
        n2 = g.noise(P, 5.5, 6.0, 0.6)
        n3 = g.noise(P, 22.0, 4.0, 0.55)
        base = g.ramp(g.madd(n1, 0.7, g.mul(n2, 0.3)),
                      [(0.3, (0.04, 0.037, 0.034)), (0.48, (0.066, 0.06, 0.054)), (0.64, (0.09, 0.08, 0.068))])
        base = g.mix(g.mul(g.absolute(g.sub(n3, 0.5)), 0.5), base, (0.05, 0.045, 0.04), 'MULTIPLY')
        pit = g.smooth(g.mul(cavity, -1.0), 0.12, 0.7)
        reg = g.mul(g.maximum(pit, g.mul(crater, 0.6)), g.madd(n2, 0.7, 0.45))
        base = g.mix(g.mul(reg, 0.6), base, (0.13, 0.115, 0.1))
        steep = g.smooth(slope, 0.22, 0.5)
        base = g.mix(g.mul(g.mul(steep, 0.5), g.madd(n3, 0.6, 0.4)), base, (0.11, 0.105, 0.1))
        # machined rear face: grey, smoother, faint tool rings
        x, y, z = g.sep(g.coord('Object'))
        ring = g.math('FRACT', g.mul(g.vmath('LENGTH', g.combine(x, 0.0, z), out=1), 1.6))
        tool = g.mul(g.smooth(g.absolute(g.sub(ring, 0.5)), 0.42, 0.5), 0.5)
        face = g.smooth(fresh, 0.5, 0.9)
        base = g.mix(face, base, g.mix(tool, (0.085, 0.083, 0.08), (0.06, 0.058, 0.056)))
        # growth film: dark oxblood metal creeping out from the pods
        warped = g.vmath('ADD', P, g.vmath('SCALE', g.noise(P, 3.0, 3.0, 0.5, out='Color'), scale=0.12))
        creep = g.mul(g.smooth(infest, 0.12, 0.55), g.smooth(g.noise(warped, 4.0, 4.0, 0.6), 0.38, 0.55))
        base = g.mix(creep, base, (0.07, 0.016, 0.014))
        # veins: strongly warped cell edges, only some of them, thick near
        # the pods and thinning to threads; fine capillaries round the pods
        warp2 = g.vmath('ADD', P, g.vmath('SCALE', g.noise(P, 1.6, 3.0, 0.55, out='Color'), scale=0.3))
        edges = g.voronoi(warp2, 3.2, 'DISTANCE_TO_EDGE', 1.0, 'Distance')
        pick = g.smooth(g.noise(g.vmath('SCALE', warp2, scale=2.0), 2.0, 3.0, 0.5), 0.47, 0.56)
        width = g.madd(g.smooth(infest, 0.1, 0.9), 0.013, 0.003)
        main = g.mul(g.sub(1.0, g.smooth(edges, g.mul(width, 0.4), width)), g.mul(pick, g.smooth(infest, 0.1, 0.35)))
        fine_e = g.voronoi(warped, 11.0, 'DISTANCE_TO_EDGE', 1.0, 'Distance')
        fine = g.mul(g.sub(1.0, g.smooth(fine_e, 0.0, 0.006)), g.mul(g.smooth(infest, 0.55, 0.85),
                                                                       g.smooth(g.noise(P, 6.0, 2.0), 0.45, 0.6)))
        vein = g.maximum(main, g.mul(fine, 0.7))
        halo = g.mul(g.sub(1.0, g.smooth(edges, 0.0, g.mul(width, 4.0))),
                     g.mul(g.mul(pick, g.smooth(infest, 0.2, 0.6)), 0.18))
        base = g.mix(vein, base, (0.12, 0.012, 0.008))
        glow = g.mix(g.maximum(vein, halo), (0, 0, 0), RED)
        rough = g.mixf(creep, g.map_range(n2, 0.3, 0.7, 0.95, 0.85), 0.45)
        rough = g.mixf(face, rough, 0.7)
        metal = g.mul(creep, 0.6)
        # bump: micro craters, grain, sunken veins
        density = g.mul(g.smooth(g.noise(P, 1.6, 2.0, 0.5), 0.3, 0.7), g.sub(1.0, g.mul(fresh, 0.9)))
        h = A.micro_craters(g, P, 5.0, 3.1, density)
        h = g.add(h, g.mul(A.micro_craters(g, P, 11.0, 7.7, density), 0.9))
        h = g.add(h, g.mul(A.micro_craters(g, P, 26.0, 1.9, g.madd(density, 0.6, 0.3)), 0.8))
        h = g.add(h, g.mul(g.sub(g.noise(P, 9.0, 8.0, 0.62), 0.5), g.mixf(face, 0.016, 0.003)))
        h = g.add(h, g.mul(g.sub(g.noise(P, 40.0, 3.0, 0.5), 0.5), 0.004))
        h = g.sub(h, g.mul(vein, 0.004))
        h = g.add(h, g.mul(creep, 0.002))
        return dict(albedo=base, rough=rough, metal=metal, glow=glow, normal=g.bump(h, 1.0, radius))
    return C.source_material(name, build)


def cocoon(name, L, W, mat, core_mat, petals=4, steps=2, gap=10.0, phase=45.0):
    """A hatching pod along +Y (front +Y): a glowing ovoid core held by
    `petals` armour shells that hug it at the back and splay open at the
    front into claw tips. Returns its parts."""
    core = [(-0.96 * L, 0.0), (-0.84 * L, 0.42 * W), (-0.5 * L, 0.82 * W), (0.0, 0.93 * W), (0.42 * L, 0.84 * W),
            (0.74 * L, 0.6 * W), (0.92 * L, 0.3 * W), (1.0 * L, 0.0)]
    parts = [S.lathe(name + '_core', core, 8, (0, 0), core_mat, smooth=True, sharp=50)]
    span = 360.0 / petals
    ys = [-0.94, -0.72, -0.3, 0.15, 0.5, 0.76, 0.98, 1.16]
    for k in range(petals):
        c = phase + span * k
        bm = bmesh.new()
        rows_out, rows_in = [], []
        for u in ys[:-1]:
            y = u * L
            opening = max(0.0, min(1.0, (u - 0.1) / 0.9)) ** 2
            r = W * math.sqrt(max(0.0, 1 - (u / 1.05) ** 2)) * 1.02 + opening * W * 0.62
            ha = (span - gap) / 2 * (1 - 0.6 * opening) * min(1.0, 0.45 + (u + 0.94) * 2.2)
            th = W * (0.16 - 0.06 * opening)
            angs = [math.radians(c - ha + 2 * ha * j / steps) for j in range(steps + 1)]
            ridge = [1.0 + 0.08 * math.sin(math.pi * j / steps) for j in range(steps + 1)]
            rows_out.append([bm.verts.new((r * q * math.cos(a), y, r * q * math.sin(a))) for a, q in zip(angs, ridge)])
            rows_in.append([bm.verts.new(((r - th) * math.cos(a), y, (r - th) * math.sin(a))) for a in angs])
        tip_r = W * 0.67
        tip = bm.verts.new((tip_r * math.cos(math.radians(c)), ys[-1] * L, tip_r * math.sin(math.radians(c))))
        rows = len(rows_out)
        for i in range(rows - 1):
            for j in range(steps):
                bm.faces.new((rows_out[i][j], rows_out[i][j + 1], rows_out[i + 1][j + 1], rows_out[i + 1][j]))
                bm.faces.new((rows_in[i][j], rows_in[i + 1][j], rows_in[i + 1][j + 1], rows_in[i][j + 1]))
            for j in (0, steps):
                bm.faces.new((rows_out[i][j], rows_out[i + 1][j], rows_in[i + 1][j], rows_in[i][j]))
        for j in range(steps):          # rear edge
            bm.faces.new((rows_out[0][j], rows_in[0][j], rows_in[0][j + 1], rows_out[0][j + 1]))
        last_o, last_i = rows_out[-1], rows_in[-1]
        for j in range(steps):          # claw tip
            bm.faces.new((last_o[j], last_o[j + 1], tip))
            bm.faces.new((last_i[j + 1], last_i[j], tip))
        bm.faces.new((last_o[0], tip, last_i[0]))
        bm.faces.new((last_o[-1], last_i[-1], tip))
        parts.append(S.finish_bm(f'{name}_petal{k}', bm, mat, smooth=True, sharp=35))
    return parts


def seed_materials():
    M = H.common_materials('d', k=2.0)

    def shell(g, P, N):
        x, y, z = g.sep(P)
        n = g.noise(P, 0.35, 2.0)
        col = g.mix(g.smooth(n, 0.45, 0.55), OXBLOOD, (0.075, 0.03, 0.03))
        return H.finish(g, col, 0.4, 0.55, P, N, k=1.6, panel_scale=1.0, panel=(1.0, 0.45), wear=0.8, grime=1.2)

    def mount(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(band(g, y, -17.25, -17.0, 0.01), GUNMETAL, H.hazard_paint(g, x, z, 0.16))
        return H.finish(g, col, 0.45, 0.55, P, N, k=1.6, panel_scale=1.0, wear=1.0)

    def cable(g, P, N):
        n = g.noise(P, 0.6, 2.0)
        col = g.mix(g.smooth(n, 0.4, 0.6), (0.05, 0.022, 0.021), OXBLOOD)
        return H.finish(g, col, 0.42, 0.7, P, N, k=1.6, lines=False, wear=0.15)

    def spur(g, P, N):
        rad = g.vmath('LENGTH', P, out=1)
        steel = g.smooth(rad, 20.0, 24.0)
        col = g.mix(steel, OXBLOOD, H.STEEL)
        return H.finish(g, col, g.mixf(steel, 0.42, 0.3), g.mixf(steel, 0.4, 0.85), P, N, k=1.6, lines=False, wear=1.2)

    def pod_core(g, P, N):
        cells = g.voronoi(P, 2.2, 'F1', 1.0, 'Distance')
        hot = g.smooth(cells, 0.05, 0.45)
        glow = g.mix(hot, (1.0, 0.32, 0.12), (RED[0] * 0.55, RED[1] * 0.55, RED[2] * 0.55))
        return H.plain(g, P, N, (0.1, 0.012, 0.008), 0.3, 0.1, glow, k=2.0)

    M.update(shell=S.material('d_shell', shell), mount=S.material('d_mount', mount), spur=S.material('d_spur', spur),
             cable=S.material('d_cable', cable),
             pod_core=S.material('d_pod_core', pod_core),
             idle=S.material('d_idle', lambda g, P, N: H.plain(g, P, N, (0.03, 0.02, 0.02), 0.5, 0.3,
                                                                (0.05, 0.004, 0.002), k=2.0)),
             nozzle=S.material('d_nozzle', lambda g, P, N: H.finish(
                 g, (0.11, 0.1, 0.105), 0.4, 0.75, P, N, k=1.2, lines=False, wear=0.3)))
    return M


def pore(name, r, mat):
    """The glowing pore on top of a nodule of radius r."""
    return S.lathe(name, [(0.79 * r, 0.0), (0.79 * r, 0.47 * r), (0.88 * r, 0.0)], 6, (0, 0), mat, smooth=False)


def nodule(name, r, mat):
    """A hexagonal growth nodule along +Y, its closed base sunk below y = 0."""
    return S.lathe(name, [(-0.3 * r, 0.0), (0.0, r), (0.45 * r, 0.82 * r), (0.8 * r, 0.42 * r), (0.86 * r, 0.0)], 6,
                   (0, 0), mat, smooth=True, sharp=40)


def pod_frame(S0, axis, nrm):
    """Matrix taking lathe space (+Y the pod's axis, +Z up) to the rock."""
    n = Vector(nrm).normalized()
    a = Vector(axis)
    a = (a - n * a.dot(n)).normalized()
    b = a.cross(n)
    m = Matrix((b, a, n)).transposed().to_4x4()
    m.translation = S0
    return m


def build_seed():
    high = seed_sculpt()
    high.data.materials.append(seed_rock_material('seed_src'))
    low = A.decimated(high, 'rock', 2500, smooth=6)
    for attr in ('cavity', 'crater', 'fresh', 'infest'):
        if low.data.attributes.get(attr):
            low.data.attributes.remove(low.data.attributes[attr])
    low.data.set_sharp_from_angle(angle=math.radians(58))
    C.placeholder_material(low)
    bvh = S.bvh_of([low])
    M = seed_materials()
    parts = []

    # Three pods breaking out of the rock, small nodules round them.
    rng = random.Random(29)
    spheres = []                        # colliders for the parts standing proud of the rock
    for k, (c, axis, L, W) in enumerate(SEED_PODS):
        c = Vector(c).normalized()
        hit, nrm = H.surface_hit(bvh, c * 40, -c)
        radial = hit.normalized()
        frame = pod_frame(hit + radial * W * 0.15, Vector(axis) + radial * 0.3, radial)
        for o in cocoon(f'pod{k}', L, W, M['shell'], M['pod_core']):
            parts.append(S.transformed(o, frame))
        spheres += [(frame @ Vector((0, 0, 0)), W * 1.05), (frame @ Vector((0, 0.62 * L, W * 0.2)), W * 0.95),
                    (frame @ Vector((0, -0.6 * L, 0)), W * 0.8)]
        for j in range(2):
            d = (c + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.36).normalized()
            try:
                p, nn = H.surface_hit(bvh, d * 40, -d)
            except RuntimeError:
                continue
            if (p - hit).length < W * 1.6:
                continue
            r = rng.uniform(0.8, 1.5)
            m = S.facing(p - nn * r * 0.25, nn) @ Matrix.Rotation(math.radians(90), 4, 'X')
            parts.append(S.transformed(nodule(f'nodule{k}{j}', r, M['shell']), m))
            parts.append(S.transformed(pore(f'pore{k}{j}', r, M['red']), m))

    # Nodules at the creeping growth sites.
    for k, (c, reach, count) in enumerate(SEED_CREEP):
        c = Vector(c).normalized()
        for j in range(count):
            jitter = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
            d = (c + jitter * (0.12 if j else 0.0)).normalized()
            p, nn = H.surface_hit(bvh, d * 40, -d)
            r = rng.uniform(1.1, 1.7) if j == 0 else rng.uniform(0.6, 1.1)
            m = S.facing(p - nn * r * 0.25, nn) @ Matrix.Rotation(math.radians(90), 4, 'X')
            parts.append(S.transformed(nodule(f'cnodule{k}{j}', r, M['shell']), m))
            parts.append(S.transformed(pore(f'cpore{k}{j}', r, M['red']), m))

    # Clusters of harrow tines breaking out of the rock.
    for k, (c, lean, heights) in enumerate(SEED_TINES):
        c = Vector(c).normalized()
        for j, h in enumerate(heights):
            off = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.09
            d = (c + off).normalized()
            p, nn = H.surface_hit(bvh, d * 40, -d)
            up = (nn + Vector(lean) + off * 3).normalized()
            chord = up.cross(nn).cross(up) if up.cross(nn).length > 1e-3 else Vector((0, 1, 0))
            parts.append(H.tine(f'spur{k}{j}', p - nn * 1.0, p + up * h * 0.5 + nn * 0.2, p + up * h, 0.24 * h + 0.25,
                                0.07 * h + 0.06, M['spur'], chord, n=5, lead=1.0, taper=0.9))
            if j == 0:
                spheres += [(p + up * h * 0.3, 0.9 + 0.08 * h), (p + up * h * 0.68, 0.5 + 0.06 * h)]

    # The machined rear face: a three-armed thrust frame, three rocket
    # clusters of three octagonal bells each.
    face_y = H.surface_hit(bvh, (0, -40, 0), (0, 1, 0))[0].y
    cx = (0, 0)
    parts.append(S.lathe('hub', [(face_y + 0.5, 0.0), (face_y + 0.5, 1.9), (face_y - 0.45, 1.9), (face_y - 0.7, 1.45),
                                 (face_y - 0.7, 0.0)], 6, cx, M['mount'], smooth=False, phase=math.pi / 6))
    parts.append(S.lathe('hub_cap', [(face_y - 0.68, 0.0), (face_y - 0.68, 0.7), (face_y - 1.4, 0.55),
                                     (face_y - 2.2, 0.0)], 6, cx, M['spur'], smooth=False, phase=math.pi / 6))
    empties = []
    for k, ang in enumerate(SEED_CLUSTERS):
        a = math.radians(ang)
        rad = Vector((math.cos(a), 0, math.sin(a)))
        tan = Vector((-math.sin(a), 0, math.cos(a)))
        centre = (rad.x * SEED_CLUSTER_R, rad.z * SEED_CLUSTER_R)
        m = Matrix((tan, rad, Vector((0, 1, 0)))).transposed().to_4x4()
        m.translation = rad * SEED_CLUSTER_R * 0.5 + Vector((0, face_y - 0.15, 0))
        parts.append(S.box(f'arm{k}', (1.3, SEED_CLUSTER_R, 0.9), M['mount'], m, taper=0.85))
        parts.append(S.lathe(f'mount{k}', [(face_y + 0.5, 0.0), (face_y + 0.5, 2.45), (face_y - 0.55, 2.45),
                                           (face_y - 0.95, 2.05), (face_y - 0.95, 0.0)], 6, centre, M['mount'],
                             smooth=False, phase=a))
        y0 = face_y - 0.95
        for j in range(3):
            b = a + math.radians(60 + 120 * j)
            bc = (centre[0] + 1.0 * math.cos(b), centre[1] + 1.0 * math.sin(b))
            parts.append(S.lathe(f'bell{k}{j}', [(y0 + 0.1, 0.5), (y0 - 1.0, 0.58), (y0 - 2.45, 0.78), (y0 - 2.47, 0.7),
                                                (y0 - 0.55, 0.42), (y0 - 0.1, 0.45)],
                                 8, bc, M['nozzle'], closed=True, smooth=True, sharp=35, phase=math.pi / 8))
            parts.append(H.disc(f'throat{k}{j}', y0 - 0.5, 0.43, 8, bc, M['idle'], phase=math.pi / 8))
        empties.append(H.empty(f'nozzle_{k}', (centre[0], y0 - 2.47, centre[1])))
        spheres.append((Vector((centre[0], y0 - 1.2, centre[1])), 2.25))
    spheres.append((Vector((0, face_y - 0.9, 0)), 1.8))

    # Fabricator roots: cables crawling over the rock from the pods to the frame.
    for k, (c, axis, L, W) in enumerate(SEED_PODS):
        start = Vector(c).normalized()
        a = math.radians(SEED_CLUSTERS[k])
        end = Vector((math.cos(a) * 0.55, -0.83, math.sin(a) * 0.55)).normalized()
        path = []
        for i in range(10):
            d = start.slerp(end, 0.12 + 0.88 * i / 9)
            p, nn = H.surface_hit(bvh, d * 40, -d)
            path.append(p + nn * 0.12)
        parts.append(H.tube(f'cable{k}', path, [0.34] * 9 + [0.2], M['cable'], sides=6))

    rock_spheres = seed_colliders(low)
    for i, (cen, r) in enumerate(rock_spheres + [(tuple(round(v, 2) for v in p), round(r, 2)) for p, r in spheres]):
        empties.append(H.empty(f'col_{i:02d}', cen, radius=r))
    info = dict(nozzle_size={f'nozzle_{k}': 1.6 for k in range(3)}, nodes={'rock': 'rock'})
    return low, high, parts, empties, info


def seed_colliders(low, most=16, skin=0.9, inset=1.4, goal=0.98):
    """A compound of spheres hugging the rock: candidate centres on an
    interior grid, each sphere reaching `skin` past the nearest surface.
    Greedily take the sphere that covers the most still-uncovered surface
    vertices (pulled `inset` inward along their normals, so the compound
    may sit that far inside a bump) until `goal` of them are covered."""
    bvh = S.bvh_of([low])
    me = low.data
    surf = np.array([(v.co - v.normal * inset)[:] for v in me.vertices])
    lo, hi = surf.min(0), surf.max(0)
    step = 1.0
    centres, radii = [], []
    for x in np.arange(lo[0], hi[0], step):
        for y in np.arange(lo[1], hi[1], step):
            for z in np.arange(lo[2], hi[2], step):
                p = Vector((x, y, z))
                loc, nrm, _, dist = bvh.find_nearest(p)
                if loc is not None and (p - loc).dot(nrm) < 0 and dist > 1.5:
                    centres.append((x, y, z))
                    radii.append(dist + skin)
    centres, radii = np.array(centres), np.array(radii)
    covers = np.zeros((len(centres), len(surf)), bool)
    for i in range(0, len(centres), 512):
        d = np.linalg.norm(centres[i:i + 512, None, :] - surf[None, :, :], axis=2)
        covers[i:i + 512] = d <= radii[i:i + 512, None]
    covered = np.zeros(len(surf), bool)
    out = []
    while len(out) < most and covered.mean() < goal:
        gain = (covers & ~covered).sum(1) + radii * 1e-3
        i = int(np.argmax(gain))
        out.append((tuple(round(float(v), 2) for v in centres[i]), round(float(radii[i]), 2)))
        covered |= covers[i]
    C.log(f'  seed colliders: {len(out)} spheres cover {covered.mean() * 100:.1f} % of the rock '
          f'(to {inset} m inside its surface)')
    return out


def make_seed():
    low, high, parts, empties, info = build_seed()
    groups = {}
    for o in parts:
        key = ''.join(ch for ch in o.name.split('_')[0] if not ch.isdigit())
        groups[key] = groups.get(key, 0) + C.tri_count(o)
    C.log(f'  seed rock {C.tri_count(low)} tris; parts ' + ', '.join(f'{k} {v}' for k, v in sorted(groups.items())))
    tex = (256, 128) if FAST else (1024, 1024)
    size, size_mr = tex
    for o in [low] + parts:
        attr = o.data.attributes.new('part', 'INT', 'FACE')
        attr.data.foreach_set('value', [0 if o is low else 1] * len(o.data.polygons))
    rock = C.join([low] + parts, 'rock')
    C.smart_uv(rock, angle=60.0, margin=0.006)
    # give the growths and rockets about twice (2.2x) the texel density of the bare rock
    me = rock.data
    flags = np.empty(len(me.polygons), np.int32)
    me.attributes['part'].data.foreach_get('value', flags)
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        if flags[poly.index]:
            for li in poly.loop_indices:
                uv[li].uv = uv[li].uv * 2.2
    C.activate(rock)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method='CONCAVE', margin_method='FRACTION',
                            margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    C.triangulate(rock)
    H.add_sharp(rock, 50)
    flags = np.empty(len(me.polygons), np.int32)
    me.attributes['part'].data.foreach_get('value', flags)

    imgs = {}
    reach = SEED_R * 0.06
    kw = dict(sources=[high], extrusion=reach, max_ray=reach * 2.5)
    margin = max(2, size // 128)
    for key, sz, nc in (('normal', size, True), ('albedo', size, False), ('rough', size_mr, True),
                        ('metal', size_mr, True), ('glow', size_mr, False)):
        rock_img = C.new_image(f'seed_{key}_rock', sz, non_color=nc)
        part_img = C.new_image(f'seed_{key}_part', sz, non_color=nc)
        samples = 1 if FAST else (4 if key in ('normal', 'albedo') else 2)
        if key == 'normal':
            C.bake(rock, rock_img, 'NORMAL', margin=margin, samples=samples, **kw)
            C.bake(rock, part_img, 'NORMAL', margin=margin, samples=1 if FAST else 6)
        else:
            C.bake(rock, rock_img, channel=key, margin=margin, samples=samples, **kw)
            C.bake(rock, part_img, channel=key, margin=margin, samples=1 if FAST else (16 if key == 'albedo' else 8))
        label = H.owner_map([H.uv_coverage(rock, sz, flags == 0), H.uv_coverage(rock, sz, flags == 1)], grow=margin + 2)
        imgs[key] = H.composite(C.new_image(f'seed_{key}', sz, non_color=nc), [rock_img, part_img], label)
    mr = C.pack_mr('seed_mr', imgs['rough'], imgs['metal'])
    base, nrm, glow = imgs['albedo'], imgs['normal'], imgs['glow']
    base.name, nrm.name, glow.name = 'seed_base', 'seed_normal', 'seed_emissive'
    H.dump(base, nrm, mr, glow)
    H.assign(rock, C.baked_material('seed', base, nrm, mr, glow))
    me.attributes.remove(me.attributes['part'])
    bpy.data.objects.remove(high)
    for e in empties:
        e.parent = rock
    C.log(f'  seed: {C.tri_count(rock)} tris')
    C.export_glb(os.path.join(C.MODELS, 'seed.glb'), [rock] + empties)
    data = H.anchors_of([rock], empties, 1, info['nozzle_size'], {}, info['nodes'])
    H.write_anchors('seed', data)


# ==========================================================================
# Fold anchor — Harrow interdiction pylon, 64 m tall along +Z

A_EMIT = Vector((0, 0, 28.0))           # emitter centre: the `emitter` node's origin and spin axis
A_LEGS = [90, 210, 330]                 # leg azimuths (degrees from +X toward +Y)
A_BLADES = [30, 150, 270]               # blade azimuths, between the legs
A_MAST = [  # height z, radius (a 6-sided lathe round Z)
    (-27.5, 0.0), (-25.6, 1.6), (-23.8, 3.2), (-23.6, 4.4), (-19.4, 4.4), (-18.7, 3.5), (-18.4, 3.3), (-7.4, 2.9),
    (-7.2, 3.65), (-5.2, 3.65), (-4.8, 2.75), (8.8, 2.35), (9.0, 3.05), (10.8, 3.05), (11.2, 2.2), (20.2, 1.85),
    (20.4, 3.0), (22.4, 3.0), (22.9, 1.9), (24.0, 1.9), (24.0, 0.0)]


def mast_radius(z):
    """The mast's radius at height z (between its foot and its top)."""
    pts = A_MAST[2:-1]
    for (h0, r0), (h1, r1) in zip(pts, pts[1:]):
        if h0 <= z <= h1:
            return r0 + (r1 - r0) * (z - h0) / max(h1 - h0, 1e-6)
    return pts[-1][1]


def anchor_materials():
    M = H.common_materials('a', k=3.0)

    def az(g, P):
        x, y, z = g.sep(P)
        return g.math('ARCTAN2', y, x)

    def mast(g, P, N):
        x, y, z = g.sep(P)
        a = az(g, P)
        # three faces (toward the legs) carry glowing conduits up the mast
        face = g.smooth(g.math('COSINE', g.mul(g.sub(a, math.radians(90)), 3.0)), 0.8, 0.9)
        rad = g.vmath('LENGTH', g.combine(x, y, 0.0), out=1)
        col = g.mix(g.mul(face, g.smooth(rad, 2.0, 1.0)), GUNMETAL, OXBLOOD)
        col = g.mix(g.maximum(band(g, z, -23.4, -22.2, 0.02), band(g, z, 20.9, 21.9, 0.02)), col,
                    H.hazard_paint(g, g.mul(a, 3.0), z, 0.55))
        ridge = g.smooth(g.math('COSINE', g.mul(g.sub(a, math.radians(90)), 3.0)), 0.985, 0.995)
        broken = g.smooth(g.noise(g.combine(0.0, 0.0, z), 0.12, 2.0), 0.3, 0.42)
        cond = g.mul(g.mul(ridge, band(g, z, -18.0, 19.5, 0.1)), broken)
        col = g.mix(cond, col, (0.05, 0.005, 0.004))
        glow = g.mix(cond, (0, 0, 0), RED)
        return H.finish(g, col, 0.46, 0.5, P, N, k=3.0, panel=(1.0, 0.5), glow=glow)

    def blade(g, P, N):
        x, y, z = g.sep(P)
        rad = g.vmath('LENGTH', g.combine(x, y, 0.0), out=1)
        col = g.mix(g.smooth(rad, 3.2, 3.4), GUNMETAL, OXBLOOD)
        return H.finish(g, col, 0.44, 0.5, P, N, k=3.0, panel=(1.2, 0.5))

    def tine(g, P, N):
        x, y, z = g.sep(P)
        rad = g.vmath('LENGTH', g.combine(x, y, 0.0), out=1)
        steel = g.smooth(rad, 6.5, 9.5)
        col = g.mix(steel, OXBLOOD, H.STEEL)
        col = g.mix(band(g, rad, 4.6, 5.0, 0.02), col, H.BLACKED)
        return H.finish(g, col, g.mixf(steel, 0.42, 0.3), g.mixf(steel, 0.4, 0.85), P, N, k=3.0, lines=False, wear=1.2)

    def leg(g, P, N):
        x, y, z = g.sep(P)
        rad = g.vmath('LENGTH', g.combine(x, y, 0.0), out=1)
        a = az(g, P)
        col = g.mix(g.smooth(rad, 8.5, 9.0), GUNMETAL, OXBLOOD)
        col = g.mix(g.maximum(band(g, rad, 4.6, 6.0, 0.02), band(g, z, -29.4, -28.4, 0.02)), col,
                    H.hazard_paint(g, g.mul(a, 6.0), g.add(z, rad), 0.4))
        return H.finish(g, col, 0.45, 0.5, P, N, k=3.0, panel=(1.1, 0.45))

    def cage(g, P, N):
        x, y, z = g.sep(P)
        inward = g.sub(0.0, g.vmath('DOT_PRODUCT', N, g.vmath('NORMALIZE', g.combine(x, y, 0.0)), out=1))
        lit = g.smooth(inward, 0.2, 0.7)
        glow = g.mix(lit, (0, 0, 0), (RED[0] * 0.6, RED[1] * 0.6, RED[2] * 0.6))
        return H.finish(g, (0.05, 0.03, 0.03), 0.4, 0.7, P, N, k=2.0, lines=False, wear=0.2, glow=glow)

    def crystal(g, P, N):
        x, y, z = g.sep(P)
        core = g.sub(1.0, g.smooth(g.absolute(g.sub(z, A_EMIT.z)), 0.5, 2.6))
        flick = g.smooth(g.noise(P, 1.2, 3.0), 0.3, 0.7)
        glow = g.mix(g.mul(core, 0.8), (1.0, 0.04, 0.02), (1.0, 0.45, 0.22))
        glow = g.mix(g.mul(flick, 0.25), glow, (0.6, 0.02, 0.01))
        return dict(albedo=(0.3, 0.03, 0.02), rough=0.15, metal=0.0, glow=glow)

    def mplate(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(g.noise(P, 0.08, 2.0), 0.48, 0.52), OXBLOOD, (0.25, 0.045, 0.045))
        col = g.mix(g.maximum(band(g, z, -13.0, -12.3, 0.02), band(g, z, 1.4, 2.1, 0.02)), col,
                    H.hazard_paint(g, g.add(x, y), z, 0.45))
        return H.finish(g, col, 0.45, 0.4, P, N, k=3.0, panel=(1.0, 0.6), wear=1.1)

    M.update(mast=S.material('a_mast', mast), mplate=S.material('a_mplate', mplate),
             blade=S.material('a_blade', blade), tine=S.material('a_tine', tine), leg=S.material('a_leg', leg),
             cage=S.material('a_cage', cage), crystal=S.material('a_crystal', crystal))
    return M


def build_anchor():
    M = anchor_materials()
    up = H.up_from_y()
    parts = []
    parts.append(S.transformed(S.lathe('mast', [(z, r) for z, r in A_MAST], 6, (0, 0), M['mast'], smooth=True,
                                       sharp=30, phase=math.radians(90)), up))

    # Three blades up the mast with harrow tines hooked upward along them.
    for k, a in enumerate(A_BLADES):
        rad = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        rows = [(-18.4, 4.6), (-12.0, 4.4), (-5.0, 4.1), (3.0, 3.6), (11.0, 3.1), (17.5, 2.6), (20.2, 1.7)]
        path = [rad * ((mast_radius(z) * 0.55 + r) / 2) + Vector((0, 0, z)) for z, r in rows]
        chord = [(r - mast_radius(z) * 0.55) / 2 for z, r in rows]
        chord[-1] = 0.0
        parts.append(H.blade(f'blade{k}', path, chord, [0.22, 0.26, 0.26, 0.24, 0.22, 0.2, 0.0], M['blade'], rad,
                             sharp=25))
        for j, (z, L) in enumerate(((-15.0, 7.6), (-6.5, 6.0), (2.0, 5.0), (10.5, 3.9), (16.5, 2.8))):
            z += 2.6 * k - 2.6
            edge = None
            for (z0, r0_), (z1, r1_) in zip(rows, rows[1:]):
                if z0 <= z <= z1:
                    edge = r0_ + (r1_ - r0_) * (z - z0) / (z1 - z0)
            root = rad * (edge - 0.8) + Vector((0, 0, z))
            hook = 0.62 if j % 2 == 0 else 0.35
            parts.append(H.tine(f'atine{k}{j}', root, root + rad * L * 0.62 + Vector((0, 0, L * 0.04)),
                                root + rad * L * 0.9 + Vector((0, 0, L * hook)), 0.55 + 0.1 * L, 0.2 + 0.02 * L,
                                M['tine'], (0, 0, 1), n=6, lead=1.1, taper=0.9))
    # layered armour plates on the three faces between the blades
    mast_bvh = S.bvh_of([o for o in parts if o.name == 'mast'])
    for k, a in enumerate(A_LEGS):
        rad = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        tan = Vector((-rad.y, rad.x, 0))
        for j, (z0, z1) in enumerate(((-17.6, -12.4), (-12.9, -8.0), (-4.0, 2.2), (2.0, 8.0), (12.0, 19.4))):
            parts.append(H.hug_plate(f'mplate{k}{j}', mast_bvh, rad * 8 + Vector((0, 0, (z0 + z1) / 2)), -rad, tan,
                                     (0, 0, 1), (2.2, z1 - z0), M['mplate'], thick=0.3, grid=(1, 2), chamfer=0.9,
                                     shape=lambda s, t: (s * (1 - 0.25 * (t + 0.5)), t)))

    # The tripod: hexagonal struts, a knee hinge, a clawed foot.
    empties = []
    for k, a in enumerate(A_LEGS):
        rad = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        tan = Vector((-rad.y, rad.x, 0))
        hip = rad * 3.6 + Vector((0, 0, -21.0))
        knee = rad * 13.2 + Vector((0, 0, -14.8))
        foot = rad * 22.0 + Vector((0, 0, -28.9))
        parts.append(H.tube(f'thigh{k}', [hip, hip.lerp(knee, 0.5) + Vector((0, 0, 0.8)), knee], [1.35, 1.2, 1.0],
                            M['leg'], sides=6, sharp=40))
        parts.append(H.tube(f'shin{k}', [knee, knee.lerp(foot, 0.5) + rad * 0.6, foot], [1.05, 0.88, 0.72], M['leg'],
                            sides=6, sharp=40))
        m = Matrix((rad, tan, Vector((0, 0, 1)))).transposed().to_4x4()
        m.translation = knee
        parts.append(S.transformed(S.lathe(f'knee{k}', [(-1.35, 0.0), (-1.35, 1.35), (1.35, 1.35), (1.35, 0.0)], 6,
                                           (0, 0), M['metal'], smooth=False), m))
        parts.append(H.tine(f'kspur{k}', knee + Vector((0, 0, 0.6)), knee + rad * 0.8 + Vector((0, 0, 2.6)),
                            knee + rad * 0.2 + Vector((0, 0, 4.2)), 0.7, 0.24, M['tine'], rad, n=5, lead=1.0))
        brace_a = rad * 3.8 + Vector((0, 0, -23.6))
        brace_b = knee.lerp(foot, 0.42)
        parts.append(H.tube(f'piston{k}', [brace_a, brace_a.lerp(brace_b, 0.55), brace_b], [0.5, 0.5, 0.36], M['metal'],
                            sides=6, sharp=40))
        mf = S.facing(foot, (0, 0, -1)) @ Matrix.Rotation(math.radians(90), 4, 'X')
        pad = S.transformed(S.lathe(f'pad{k}', [(-0.5, 0.0), (-0.5, 1.2), (0.3, 1.45), (0.8, 1.0), (0.8, 0.0)], 6,
                                    (0, 0), M['leg'], smooth=False), mf)
        parts.append(pad)
        for j in range(3):
            b = math.radians(a + 60 + 120 * j)
            d = Vector((math.cos(b), math.sin(b), 0))
            base = foot + d * 0.6 + Vector((0, 0, -0.4))
            parts.append(H.tine(f'claw{k}{j}', base, base + d * 1.5 + Vector((0, 0, -0.5)),
                                base + d * 2.2 + Vector((0, 0, -1.6)), 0.45, 0.16, M['tine'], (0, 0, 1), n=5, lead=1.0))
        lamp_at, lamp_n = H.surface_hit(S.bvh_of([pad]), foot + rad * 5 + Vector((0, 0, 0.05)), -rad)
        parts.append(H.lamp(f'foot_lamp{k}', lamp_at, lamp_n, 0.24, M['red']))
        empties.append(H.empty(f'light_{k}', tuple(lamp_at + lamp_n * 0.3)))

    # The emitter: a glowing crystal in a six-pronged cage, its own node.
    ez = A_EMIT.z
    emit = []
    emit.append(S.transformed(S.lathe('crystal', [(ez - 3.5, 0.0), (ez - 1.9, 1.15), (ez, 1.85), (ez + 1.9, 1.15),
                                                  (ez + 3.5, 0.0)], 6, (0, 0), M['crystal'], smooth=False), up))
    emit.append(S.transformed(S.lathe('spindle', [(ez - 4.0, 0.0), (ez - 4.0, 0.22), (ez + 3.7, 0.22),
                                                  (ez + 3.7, 0.0)], 6, (0, 0), M['cage'], smooth=False), up))
    emit.append(S.transformed(S.lathe('cage_ring', [(ez - 4.0, 1.5), (ez - 4.0, 2.6), (ez - 3.2, 2.6), (ez - 3.2, 1.5)],
                                      12, (0, 0), M['cage'], closed=True, smooth=False), up))
    emit.append(S.transformed(S.lathe('cage_belt', [(ez - 0.35, 4.1), (ez - 0.35, 4.55), (ez + 0.35, 4.55),
                                                    (ez + 0.35, 4.1)], 12, (0, 0), M['cage'], closed=True,
                                      smooth=False), up))
    emit.append(S.transformed(S.lathe('cage_cap', [(ez + 3.6, 0.0), (ez + 3.6, 1.1), (ez + 4.0, 0.95), (ez + 4.6, 0.0)],
                                      6, (0, 0), M['cage'], smooth=False), up))
    for j in range(6):
        b = math.radians(30 + 60 * j)
        rad = Vector((math.cos(b), math.sin(b), 0))
        tan = Vector((-rad.y, rad.x, 0))
        prof = [(-3.65, 2.05), (-2.4, 3.55), (-0.6, 4.3), (1.2, 4.0), (2.8, 2.45), (3.75, 0.9)]
        path = [rad * r + Vector((0, 0, ez + dz)) for dz, r in prof]
        emit.append(H.blade(f'prong{j}', path, [0.4, 0.36, 0.34, 0.3, 0.26, 0.2], [0.18, 0.17, 0.16, 0.15, 0.13, 0.1],
                            M['cage'], tan, sharp=30))
        tip = rad * 4.3 + Vector((0, 0, ez - 0.6))
        emit.append(H.tine(f'barb{j}', tip - rad * 0.3, tip + rad * 1.4 + Vector((0, 0, -0.2)),
                           tip + rad * 2.0 + Vector((0, 0, -1.4)), 0.42, 0.14, M['cage'], (0, 0, 1), n=4, lead=1.0))
    parts += [H.tag(o, 'emitter') for o in emit]

    for k, a in enumerate((0, 120, 240)):                  # on the top collar's faces
        rad = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        lamp_at = rad * 3.0 * math.cos(math.radians(30)) + Vector((0, 0, 21.4))
        parts.append(H.lamp(f'collar_lamp{k}', lamp_at, rad, 0.3, M['red']))
        empties.append(H.empty(f'light_{k + 3}', tuple(lamp_at + rad * 0.3)))
    empties.append(H.empty('sub_emitter', tuple(A_EMIT), radius=5.2))
    cols = [((0, 0, z), r) for z, r in ((-23.0, 5.2), (-16.0, 4.8), (-9.5, 4.6), (-3.0, 4.3), (3.5, 4.0), (9.8, 3.8),
                                        (15.8, 3.4), (21.2, 3.4), (A_EMIT.z, 4.8))]
    for a in A_LEGS:
        rad = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        cols += [(tuple(rad * 8.4 + Vector((0, 0, -17.8))), 2.1), (tuple(rad * 13.2 + Vector((0, 0, -15.0))), 2.0),
                 (tuple(rad * 16.2 + Vector((0, 0, -19.6))), 1.7), (tuple(rad * 19.0 + Vector((0, 0, -24.3))), 1.7),
                 (tuple(rad * 22.0 + Vector((0, 0, -29.3))), 2.4)]
    for i, (c, r) in enumerate(cols):
        empties.append(H.empty(f'col_{i:02d}', c, radius=r))
    info = dict(nodes={'emitter': 'emitter'},
                lights={**{f'light_{k}': ((1.0, 0.12, 0.06), 1.4) for k in range(3)},
                        **{f'light_{k}': ((1.0, 0.12, 0.06), 0) for k in range(3, 6)}})
    return parts, empties, info


def make_anchor():
    parts, empties, info = build_anchor()
    export_model('anchor', 'hull', parts, empties, info, (1024, 1024), children={'emitter': tuple(A_EMIT)},
                 length_axis=2, uv_margin=0.004,
                 remarks=('A pylon standing along +Y: `length` is its height (glTF Y extent), origin near mid-height.',
                          'The emitter node spins about its local Y through its origin (the cage centre).'))


# ==========================================================================
# Pipeline

def export_model(name, mesh_name, parts, empties, info, tex, children=None, length_axis=1, remarks=(),
                 uv_margin=0.003, sharp=50):
    """Join, unwrap and bake the parts into one textured mesh, split out
    the child nodes, parent the empties, export the GLB and write the
    anchors module."""
    children = children or {}
    obj = H.join_parts(parts, mesh_name, children)
    H.prepare(obj, uv_margin=uv_margin, sharp=sharp)
    images = H.bake_maps(obj, name, tex)
    H.assign(obj, C.baked_material(name, *images))
    kids = H.split_children(obj, children, images)
    H.drop_attribute([obj] + kids)
    for e in empties:
        e.parent = obj
    meshes = [obj] + kids
    tris = sum(C.tri_count(o) for o in meshes)
    C.log(f'  {name}: {tris} tris (' + ', '.join(f'{o.name} {C.tri_count(o)}' for o in meshes) + ')')
    C.export_glb(os.path.join(C.MODELS, name + '.glb'), meshes + empties)
    data = H.anchors_of(meshes, empties, length_axis, info.get('nozzle_size'), info.get('lights'),
                        info.get('nodes'))
    H.write_anchors(name, data, remarks)
    return data


def make_maul():
    parts, empties, info = build_maul()
    export_model('maul', 'hull', parts, empties, info, (2048, 1024))


MODELS = [
    ('maul', make_maul),
    ('sentry', make_sentry),
    ('seed', make_seed),
    ('anchor', make_anchor),
]


def main(only=None):
    for name, make in MODELS:
        if only and name not in only:
            continue
        C.reset(samples=8)
        C.log('harrow', name)
        make()


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
