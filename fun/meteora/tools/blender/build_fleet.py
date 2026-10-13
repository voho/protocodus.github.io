"""Meteora — the fleet group: Mite, Talon, Warden and Halberd.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
    --python fun/meteora/tools/blender/build_fleet.py [-- mite talon warden halberd]

Four more ship classes so the fight varies by size, armour, firepower and
speed: two Harrow small craft (the Mite swarm drone and the Talon heavy
fighter), a Harrow escort corvette (the Warden) and a Belt Watch gunship
(the Halberd). They follow the pipeline of build_ships.py: bmesh parts with
procedural paint, joined into one `hull`, unwrapped and baked in Cycles to
WebP textures, anchors as empties. The capital ships add turrets (separate
`turret_NN` nodes with a `turret_NN_gun` child, which carries an empty
`turret_NN_muzzle` at the barrels' tip; every turret of a ship shares two
meshes and one small baked texture), compound collision spheres (`col_NN`,
fitted to the hull by fleet_parts.fit_colliders) and subsystems (`sub_*`).

Modelled in Blender space, nose along +Y, top +Z, right +X; the glTF
exporter delivers them nose along three.js -Z. Each build writes
assets/models/<name>.glb and js/anchors/<name>.js.

Set METEORA_FAST=1 for quick geometry iterations (tiny textures, 1 sample),
and METEORA_CHECK=1 to report parts that float free of the hull, have holes
or face inward.
"""
import bpy, bmesh, math, os, sys, time
from mathutils import Vector, Matrix

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S
import fleet_parts as F

lin = S.lin
GUNMETAL, OXBLOOD, HAZARD = S.GUNMETAL, S.OXBLOOD, S.HAZARD
OFF_WHITE, GRAPHITE, ORANGE = S.OFF_WHITE, S.GRAPHITE, S.ORANGE
UNDER = (0.035, 0.038, 0.042)
band, hazard = S.band, S.hazard
BLACK = (0.0, 0.0, 0.0)


def hazard_col(g, u, v, width):
    return g.mix(hazard(g, u, v, width), (0.02, 0.02, 0.02), HAZARD)


# ==========================================================================
# Mite — Harrow swarm drone, 5 m from the gun's muzzle to the nozzle exit

MITE_BODY = [
    # y, half-width, top, bottom, centre z   (faceted octagon sections)
    (2.00, 0.42, 0.42, 0.30, 0.04),     # the face, behind the eye
    (1.75, 0.62, 0.52, 0.38, 0.06),
    (1.20, 0.78, 0.62, 0.44, 0.08),
    (0.40, 0.86, 0.72, 0.46, 0.10),     # thorax hump under the wing cases
    (-0.40, 0.80, 0.68, 0.44, 0.10),
    (-1.00, 0.56, 0.52, 0.36, 0.08),
]
M_ENG_Z = 0.07
M_EYE_C = Vector((0, 2.02, 0.03))
M_EYE_AXIS = Vector((0, 1, 0.08)).normalized()
M_WING = [(0.55, 0.62, 0.0, 1.38, 0.1), (1.4, 0.9, -0.2, 0.8, 0.09), (2.2, 1.22, -0.44, 0.36, 0.08)]
M_GUN_Z = -0.36
M_TAIL = -2.43                          # nozzle exit

MITE_RCS = [
    # name, ray origin, ray direction, puff direction (Blender space). Eight
    # ports still cover every axis and turn twice: the head and tail pairs
    # puff diagonally (sideways and fore or aft), the wingtips sit ahead of
    # the centre so their up and down puffs also pitch.
    ('rcs_01', (1.5, 1.45, 0.06), (-1, 0, 0), (0.7, 0.7, 0)),      # head right, out and forward
    ('rcs_02', (-1.5, 1.45, 0.06), (1, 0, 0), (-0.7, 0.7, 0)),     # head left
    ('rcs_03', (1.5, -1.55, M_ENG_Z), (-1, 0, 0), (0.7, -0.7, 0)),    # engine right, out and aft
    ('rcs_04', (-1.5, -1.55, M_ENG_Z), (1, 0, 0), (-0.7, -0.7, 0)),   # engine left
    ('rcs_05', (2.0, 0.95, 1.5), (0, 0, -1), (0, 0, 1)),           # right wingtip up
    ('rcs_06', (2.0, 0.95, -1.5), (0, 0, 1), (0, 0, -1)),          # right wingtip down
    ('rcs_07', (-2.0, 0.95, 1.5), (0, 0, -1), (0, 0, 1)),          # left wingtip up
    ('rcs_08', (-2.0, 0.95, -1.5), (0, 0, 1), (0, 0, -1)),         # left wingtip down
]


def mite_materials():
    s = 0.55

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.3, -0.6)
        col = g.mix(under, GUNMETAL, UNDER)
        haz = g.mul(band(g, y, -1.5, -1.3, 0.004), g.sub(1.0, under))
        col = g.mix(haz, col, hazard_col(g, x, z, 0.05))
        # the seam between the wing cases glows
        seam = g.mul(g.mul(g.smooth(nz, 0.8, 0.9), g.sub(1.0, g.smooth(ax, 0.022, 0.034))), band(g, y, -1.05, 1.3, 0.02))
        col = g.mix(seam, col, (0.25, 0.01, 0.005))
        glow = g.mix(seam, BLACK, F.SEAM)
        return F.harrow_finish(g, col, 0.45, 0.5, P, N, s, glow=glow, grain=False)

    def wing_paint(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        outer = g.smooth(ax, 1.95, 1.98)
        col = g.mix(outer, GUNMETAL, OXBLOOD)
        col = g.mix(band(g, ax, 1.58, 1.84, 0.004), col, hazard_col(g, x, y, 0.05))
        under = g.smooth(g.sep(N)[2], -0.2, -0.45)
        col = g.mix(g.mul(under, 0.6), col, UNDER)
        return F.harrow_finish(g, col, 0.45, g.mixf(outer, 0.55, 0.3), P, N, s, grain=False)

    def engine(g, P, N):
        x, y, z = g.sep(P)
        heat = g.smooth(y, -1.7, -2.1)
        col = g.mix(heat, (0.05, 0.053, 0.058), (0.085, 0.065, 0.06))
        return F.harrow_finish(g, col, g.mixf(heat, 0.45, 0.4), g.mixf(heat, 0.55, 0.65), P, N, s, wear=0.7,
                               grain=False)

    def metal(g, P, N):
        return F.finish(g, (0.04, 0.042, 0.046), 0.48, 0.55, P, N, s=s, lines=False, wear=0.6, grain=False)

    def armour(g, P, N):
        x, y, z = g.sep(P)
        edge = g.smooth(g.absolute(x), 0.62, 0.7)
        col = g.mix(g.mul(edge, g.smooth(y, -0.9, -0.6)), OXBLOOD, (0.07, 0.02, 0.018))
        return F.finish(g, col, 0.42, 0.35, P, N, s=s, wear=1.2, grain=False, panel=(2.0, 0.9))

    return dict(
        body=S.material('m_body', body), wing=S.material('m_wing', wing_paint), engine=S.material('m_engine', engine),
        nozzle=S.nozzle_material('m_nozzle', 0.0, M_ENG_Z), metal=S.material('m_metal', metal),
        armour=S.material('m_armour', armour),
        eye=F.eye_material('m_eye', M_EYE_C, M_EYE_AXIS, 0.2, 0.22, 0.08),
        glow=S.glow_material('m_glow', (1.0, 0.42, 0.12), (0.4, 0.2, 0.1)),
        hole=S.material('m_hole', lambda g, P, N: dict(albedo=S.SOOT, rough=0.7, metal=0.0)),
    )


def build_mite():
    M = mite_materials()
    parts = []
    sec = S.faceted
    body = F.loft('body', MITE_BODY, M['body'], sec, front='cap', back='cap', smooth=True, sharp=12)
    parts.append(body)
    # Wing cases: two oxblood shells over the back with a glowing seam
    # between them, running on past the body over the engine.
    parts.append(F.shell('case_r', MITE_BODY, sec, [0, 1, 2], 1.3, -1.3, M['armour'], lift=0.05, thick=0.12,
                         bevel=0.06))
    parts.append(F.shell('case_l', MITE_BODY, sec, [3, 4, 5], 1.3, -1.3, M['armour'], lift=0.05, thick=0.12,
                         bevel=0.06))
    # Brow: a visor over the eye.
    parts.append(F.shell('brow', MITE_BODY, sec, [1, 2, 3, 4], 2.2, 1.45, M['armour'], lift=0.04, thick=0.1,
                         bevel=0.05))
    # The eye: a big red lens in a hexagonal socket, filling the face.
    eye_m = S.facing(M_EYE_C, M_EYE_AXIS) @ Matrix.Rotation(math.radians(90), 4, 'X')
    parts.append(S.transformed(S.lathe('eye_housing', [(-0.22, 0.0), (-0.22, 0.5), (0.05, 0.48), (0.11, 0.4),
                                                       (0.11, 0.0)], 6, (0, 0), M['metal'], smooth=False,
                                       phase=math.pi / 6), eye_m))
    parts.append(S.transformed(S.lathe('eye', [(0.02, 0.0), (0.02, 0.38), (0.1, 0.35), (0.17, 0.22), (0.2, 0.0)], 20,
                                       (0, 0), M['eye']), eye_m))
    # Chin gun under the eye.
    gun = F.loft('gun', [(2.0, 0.05, 0.04, 0.04, 0.0), (1.9, 0.15, 0.12, 0.1, 0.0), (1.0, 0.18, 0.14, 0.12, 0.0),
                         (0.45, 0.14, 0.1, 0.08, 0.0)], M['metal'], S.faceted, front='cap', back=(0, 0.3, 0.0), sharp=15)
    parts.append(S.transformed(gun, Matrix.Translation((0, 0, M_GUN_Z))))
    parts.append(S.lathe('barrel', [(1.9, 0.0), (1.9, 0.05), (2.3, 0.05), (2.31, 0.066), (2.42, 0.066), (2.43, 0.0)],
                         8, (0, M_GUN_Z), M['metal'], sharp=40))
    parts.append(S.lathe('bore', [(2.38, 0.0), (2.38, 0.036), (2.435, 0.036), (2.435, 0.0)], 8, (0, M_GUN_Z),
                         M['hole'], smooth=False))
    # Engine: octagonal housing, bell, throat, a clamp band.
    t = M_TAIL
    parts.append(S.lathe('housing', [(-0.75, 0.0), (-0.8, 0.32), (-1.05, 0.45), (-1.7, 0.45), (-1.9, 0.41),
                                     (-1.95, 0.0)], 8, (0, M_ENG_Z), M['engine'], smooth=True, sharp=20,
                         phase=math.pi / 8))
    parts.append(S.lathe('bell', [(-1.86, 0.36), (-2.05, 0.35), (-2.38, 0.4), (-2.42, 0.4), (t, 0.36),
                                  (-2.25, 0.3), (-2.0, 0.21), (-1.95, 0.21), (-1.91, 0.29), (-1.88, 0.33)],
                         20, (0, M_ENG_Z), M['nozzle'], closed=True, sharp=35))
    parts.append(S.lathe('throat', [(-1.98, 0.0), (-1.98, 0.21), (-1.96, 0.21), (-1.96, 0.0)], 20, (0, M_ENG_Z),
                         M['glow'], smooth=False))
    parts.append(S.lathe('band', [(-1.42, 0.0), (-1.42, 0.48), (-1.54, 0.48), (-1.54, 0.0)], 8, (0, M_ENG_Z),
                         M['metal'], smooth=False, phase=math.pi / 8))
    # Dorsal tine between the wing cases, a ventral keel blade.
    dorsal = S.wing('dorsal', [(0.0, 0.1, 0.0, 1.3, 0.07), (0.3, -0.6, 0.0, 0.9, 0.065), (0.52, -1.2, 0.0, 0.42, 0.06)],
                    M['armour'], chord_pts=6, diamond=True, sharp=20)
    parts.append(S.transformed(dorsal, Matrix.Translation((0, 0, 0.72)) @ Matrix.Rotation(math.radians(-90), 4, 'Y')))
    keel = S.wing('keel', [(0.0, -0.1, 0.0, 1.1, 0.07), (0.26, -0.62, 0.0, 0.55, 0.06)], M['metal'], chord_pts=6,
                  diamond=True, sharp=20)
    parts.append(S.transformed(keel, Matrix.Translation((0, 0, -0.26)) @ Matrix.Rotation(math.radians(90), 4, 'Y')))

    side = [S.wing('wing', M_WING, M['wing'], chord_pts=7, diamond=True, sharp=20)]
    x, yle, z, chord, _ = M_WING[-1]
    side.append(S.lathe('spike', [(yle - chord + 0.04, 0.0), (yle - chord + 0.08, 0.045), (yle + 0.1, 0.045),
                                  (yle + 0.55, 0.0)], 6, (x + 0.01, z), M['metal'], smooth=False))
    path = [Vector((sx, sy - 0.03, sz)) for sx, sy, sz, _, _ in M_WING]
    path[0] = path[0].lerp(path[1], 0.3)
    side.append(S.bar('edge', path, 0.08, 0.035, M['armour'], lambda p: Vector((0, 0.3, 1.0))))
    # Mandibles: short spikes splayed either side of the eye.
    mand = S.lathe('mandible', [(-0.25, 0.0), (-0.25, 0.08), (0.45, 0.06), (0.85, 0.0)], 5, (0, 0), M['metal'],
                   smooth=False)
    side.append(S.transformed(mand, Matrix.Translation((0.38, 1.62, -0.16)) @ Matrix.Rotation(math.radians(-10), 4, 'Z')))
    parts += S.mirrored(side)

    rcs_bvh = S.bvh_of([o for o in parts if o.name.startswith(('body', 'housing', 'wing', 'case'))])
    rcs_parts, empties = F.place_rcs(MITE_RCS, rcs_bvh, M, size=0.13)
    parts += rcs_parts
    empties += [
        S.empty('nozzle_C', (0, t, M_ENG_Z)),
        S.empty('muzzle_C', (0, 2.435, M_GUN_Z)),
        S.empty('cam_cockpit', (0, 1.95, 0.1)),
    ]
    return dict(parts=parts, empties=empties, nozzle_size={'nozzle_C': 0.36}, lights={},
                tex=(1024, 1024, 512, 512), bevel=0.012, sharp=30, samples=16)


# ==========================================================================
# Talon — Harrow heavy fighter, 13 m

T_SEC = F.polygon([(1.0, 0.0), (0.8, 0.5), (0.36, 0.9), (0.12, 1.0), (-0.12, 1.0), (-0.36, 0.9), (-0.8, 0.5),
                   (-1.0, 0.0), (-0.78, -0.75), (-0.3, -1.0), (0.3, -1.0), (0.78, -0.75)])
# section vertices: 0 right chine, 1 right shoulder, 2 right deck, 3/4 ridge, 5 left deck, 6 left shoulder,
# 7 left chine, 8 left bilge, 9/10 keel, 11 right bilge
TALON_BODY = [
    # y, half-width, top, bottom, centre z
    (5.95, 0.32, 0.20, 0.17, -0.10),
    (5.00, 0.82, 0.40, 0.30, -0.06),
    (3.40, 1.42, 0.64, 0.42, -0.02),
    (1.40, 1.92, 0.82, 0.52, 0.02),
    (-0.80, 2.12, 0.88, 0.56, 0.04),
    (-2.90, 1.92, 0.84, 0.56, 0.04),
    (-4.50, 1.46, 0.74, 0.52, 0.04),
]
T_ENG = (1.34, 0.04)
T_EYE_C = Vector((0, 4.5, 0.32))
T_EYE_AXIS = Vector((0, 0.88, 0.47)).normalized()
T_GUN = (1.2, -0.3)
T_WING = [(1.6, 1.0, 0.0, 4.3, 0.085), (3.1, 1.3, -0.04, 3.2, 0.08), (4.4, 1.55, -0.08, 2.4, 0.075)]
T_KNUCKLE = (4.52, -0.08)
T_PLATES = [(4.1, 2.45, 0.1, 0.18), (2.75, 0.85, 0.14, 0.23), (1.15, -1.05, 0.18, 0.28)]

TALON_RCS = [
    ('rcs_01', (0, 3.75, 3), (0, 0, -1), (0, 0, 1)),            # nose up, on the brow plate
    ('rcs_02', (0, 3.9, -3), (0, 0, 1), (0, 0, -1)),            # nose down
    ('rcs_03', (3, 4.55, 0.02), (-1, 0, 0), (1, 0, 0)),         # nose right
    ('rcs_04', (-3, 4.55, 0.02), (1, 0, 0), (-1, 0, 0)),        # nose left
    ('rcs_05', (0, -3.9, 3), (0, 0, -1), (0, 0, 1)),            # tail up, between the nacelles
    ('rcs_06', (0, -3.9, -3), (0, 0, 1), (0, 0, -1)),           # tail down
    ('rcs_07', (4, -4.55, T_ENG[1]), (-1, 0, 0), (1, 0, 0)),    # tail right, on the nacelle
    ('rcs_08', (-4, -4.55, T_ENG[1]), (1, 0, 0), (-1, 0, 0)),   # tail left
    ('rcs_09', (T_KNUCKLE[0], -0.45, 3), (0, 0, -1), (0, 0, 1)),     # right knuckle up
    ('rcs_10', (T_KNUCKLE[0], -0.45, -3), (0, 0, 1), (0, 0, -1)),    # right knuckle down
    ('rcs_11', (-T_KNUCKLE[0], -0.45, 3), (0, 0, -1), (0, 0, 1)),    # left knuckle up
    ('rcs_12', (-T_KNUCKLE[0], -0.45, -3), (0, 0, 1), (0, 0, -1)),   # left knuckle down
    ('rcs_13', (0.5, 5.25, 3), (0, 0, -1), (0.3, 1, 0.1)),      # nose, forward-facing right (reverse)
    ('rcs_14', (-0.5, 5.25, 3), (0, 0, -1), (-0.3, 1, 0.1)),    # nose, forward-facing left
    ('rcs_15', (0.42, -4.35, 3), (0, 0, -1), (0, -1, 0)),       # tail deck, aft-facing right
    ('rcs_16', (-0.42, -4.35, 3), (0, 0, -1), (0, -1, 0)),      # tail deck, aft-facing left
]


def talon_materials():
    s = 1.0

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.3, -0.6)
        ridge = g.mul(g.mul(g.smooth(nz, 0.85, 0.93), band(g, y, -4.4, 0.0, 0.01)), g.sub(1.0, g.smooth(ax, 0.24, 0.26)))
        col = g.mix(ridge, GUNMETAL, OXBLOOD)
        col = g.mix(under, col, UNDER)
        haz = g.mul(band(g, y, -4.1, -3.75, 0.006), g.sub(1.0, under))
        col = g.mix(haz, col, hazard_col(g, x, z, 0.1))
        col = g.mix(g.smooth(y, 5.55, 5.6), col, S.DARK)
        side = g.smooth(g.absolute(nx), 0.45, 0.6)
        seam = g.mul(g.mul(band(g, z, -0.04, 0.03, 0.006), side), band(g, y, -4.3, 4.9, 0.02))
        # a glowing gap where each nose plate's front edge meets the hull
        lips = g.maximum(g.maximum(band(g, y, 4.16, 4.24, 0.008), band(g, y, 2.76, 2.84, 0.008)),
                         band(g, y, 1.16, 1.24, 0.008))
        lip = g.mul(g.smooth(nz, 0.25, 0.45), lips)
        seam = g.maximum(seam, lip)
        col = g.mix(seam, col, (0.25, 0.01, 0.005))
        glow = g.mix(seam, BLACK, F.SEAM)
        return F.harrow_finish(g, col, g.mixf(ridge, 0.4, 0.5), g.mixf(ridge, 0.55, 0.3), P, N, s, glow=glow)

    def wing_paint(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        under = g.smooth(g.sep(N)[2], -0.2, -0.45)
        col = g.mix(band(g, ax, 3.55, 3.95, 0.006), GUNMETAL, hazard_col(g, x, y, 0.12))
        col = g.mix(band(g, ax, 2.0, 2.35, 0.006), col, OXBLOOD)
        col = g.mix(g.mul(under, 0.6), col, UNDER)
        return F.harrow_finish(g, col, 0.45, 0.5, P, N, s)

    def engine(g, P, N):
        x, y, z = g.sep(P)
        heat = g.smooth(y, -4.6, -5.4)
        col = g.mix(heat, (0.05, 0.053, 0.058), (0.085, 0.065, 0.06))
        col = g.mix(band(g, y, -3.3, -3.0, 0.006), col, hazard_col(g, x, z, 0.12))
        return F.harrow_finish(g, col, g.mixf(heat, 0.45, 0.4), g.mixf(heat, 0.55, 0.65), P, N, s, wear=0.7)

    def metal(g, P, N):
        return F.finish(g, (0.04, 0.042, 0.046), 0.48, 0.55, P, N, s=s, lines=False, wear=0.6)

    def armour(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.mul(band(g, g.absolute(x), 0.0, 0.08, 0.01), g.smooth(g.sep(N)[2], 0.6, 0.8)), OXBLOOD,
                    (0.05, 0.012, 0.012))
        return F.harrow_finish(g, col, 0.42, 0.35, P, N, s, wear=1.2, panel=(2.2, 0.8))

    def plate(g, P, N):
        x, y, z = g.sep(P)
        rim = g.smooth(g.absolute(x), 1.25, 1.4)
        col = g.mix(rim, (0.055, 0.058, 0.064), OXBLOOD)
        return F.harrow_finish(g, col, 0.44, 0.5, P, N, s, wear=1.1, panel=(2.2, 0.8))

    def claw(g, P, N):
        x, y, z = g.sep(P)
        tip = g.smooth(y, 4.1, 4.6)
        col = g.mix(tip, OXBLOOD, (0.06, 0.06, 0.065))
        return F.finish(g, col, g.mixf(tip, 0.42, 0.3), g.mixf(tip, 0.35, 0.8), P, N, s=s, lines=False, wear=1.4)

    def missile(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(y, 1.45, 1.5), (0.06, 0.062, 0.066), OXBLOOD)
        return F.finish(g, col, 0.4, 0.4, P, N, s=s, lines=False, wear=0.5)

    return dict(
        body=S.material('t_body', body), wing=S.material('t_wing', wing_paint), engine=S.material('t_engine', engine),
        nozzle=S.nozzle_material('t_nozzle', T_ENG[0], T_ENG[1]), metal=S.material('t_metal', metal),
        armour=S.material('t_armour', armour), plate=S.material('t_plate', plate), claw=S.material('t_claw', claw),
        missile=S.material('t_missile', missile),
        eye=F.eye_material('t_eye', T_EYE_C, T_EYE_AXIS, 0.29, 0.21, 0.075),
        glow=S.glow_material('t_glow', (1.0, 0.42, 0.12), (0.4, 0.2, 0.1)),
        hole=S.material('t_hole', lambda g, P, N: dict(albedo=S.SOOT, rough=0.7, metal=0.0)),
    )


def build_talon():
    M = talon_materials()
    parts = []
    body = F.loft('body', TALON_BODY, M['body'], T_SEC, front=(0, 6.42, -0.11), back='cap', sharp=12)
    parts.append(body)
    # Layered armour over the nose: three plates, each standing a little
    # prouder than the one ahead, so their front edges step up like scales.
    for i, (y0, y1, lift, thick) in enumerate(T_PLATES):
        parts.append(F.shell(f'plate{i}', TALON_BODY, T_SEC, [1, 2, 3, 4, 5, 6], y0, y1,
                             M['armour'] if i < 2 else M['plate'], lift=lift, thick=thick, bevel=0.09))
    # Cheek armour along the nose sides.
    parts.append(F.shell('cheek_r', TALON_BODY, T_SEC, [11, 0, 1], 4.6, 1.7, M['armour'], lift=0.06, thick=0.14,
                         bevel=0.08))
    parts.append(F.shell('cheek_l', TALON_BODY, T_SEC, [6, 7, 8], 4.6, 1.7, M['armour'], lift=0.06, thick=0.14,
                         bevel=0.08))
    # Sensor eye ahead of the brow plate.
    eye_m = S.facing(T_EYE_C, T_EYE_AXIS) @ Matrix.Rotation(math.radians(90), 4, 'X')
    parts.append(S.transformed(S.lathe('eye_housing', [(-0.2, 0.0), (-0.2, 0.48), (0.08, 0.46), (0.15, 0.38),
                                                       (0.15, 0.0)], 6, (0, 0), M['metal'], smooth=False,
                                       phase=math.pi / 6), eye_m))
    parts.append(S.transformed(S.lathe('eye', [(0.08, 0.0), (0.08, 0.36), (0.18, 0.32), (0.26, 0.19), (0.29, 0.0)], 20,
                                       (0, 0), M['eye']), eye_m))
    # Engines: octagonal nacelles, bells, throats, clamp bands.
    side = []
    side.append(S.lathe('nacelle', [(-1.0, 0.0), (-1.1, 0.5), (-1.7, 0.82), (-5.0, 0.82), (-5.3, 0.76), (-5.36, 0.0)],
                        8, T_ENG, M['engine'], smooth=True, sharp=20, phase=math.pi / 8))
    side.append(S.lathe('bell', [(-5.25, 0.64), (-5.75, 0.62), (-6.35, 0.68), (-6.44, 0.68), (-6.46, 0.63),
                                 (-5.95, 0.52), (-5.55, 0.38), (-5.42, 0.36), (-5.33, 0.47), (-5.28, 0.58)],
                        28, T_ENG, M['nozzle'], closed=True, sharp=35))
    side.append(S.lathe('throat', [(-5.5, 0.0), (-5.5, 0.38), (-5.46, 0.38), (-5.46, 0.0)], 28, T_ENG, M['glow'],
                        smooth=False))
    for k, yy in enumerate((-2.6, -4.3)):
        side.append(S.lathe(f'clamp{k}', [(yy, 0.0), (yy, 0.86), (yy - 0.16, 0.86), (yy - 0.16, 0.0)], 8, T_ENG,
                            M['metal'], smooth=False, phase=math.pi / 8))
    # Canted tail blades on the nacelles.
    fin = S.wing('fin', [(0.0, -2.0, 0.0, 2.7, 0.07), (0.85, -3.25, 0.0, 1.7, 0.06), (1.45, -4.3, 0.0, 0.8, 0.05)],
                 M['armour'], chord_pts=6, diamond=True, sharp=20)
    side.append(S.transformed(fin, Matrix.Translation((T_ENG[0] + 0.15, 0, T_ENG[1] + 0.62))
                              @ Matrix.Rotation(math.radians(-62), 4, 'Y')))
    # Heavy gun: a faceted housing under the chine and a long barrel with a
    # muzzle brake and cooling rings.
    gx, gz = T_GUN
    gun = F.loft('gun', [(3.9, 0.06, 0.05, 0.05, 0.0), (3.6, 0.26, 0.22, 0.2, 0.0), (0.4, 0.32, 0.26, 0.24, 0.0),
                         (-0.9, 0.28, 0.22, 0.2, 0.0)], M['metal'], S.faceted, front='cap', back=(0, -1.1, 0.0),
                 sharp=15)
    side.append(S.transformed(gun, Matrix.Translation((gx, 0, gz))))
    side.append(S.lathe('barrel', [(3.5, 0.0), (3.5, 0.11), (5.55, 0.11), (5.58, 0.165), (6.12, 0.165),
                                   (6.15, 0.12), (6.15, 0.0)], 10, (gx, gz), M['metal'], sharp=40))
    for k, yy in enumerate((4.0, 4.35, 4.7)):
        side.append(S.lathe(f'cool{k}', [(yy, 0.0), (yy, 0.15), (yy + 0.1, 0.15), (yy + 0.1, 0.0)], 10, (gx, gz),
                            M['metal'], smooth=False))
    side.append(S.lathe('bore', [(6.08, 0.0), (6.08, 0.075), (6.16, 0.075), (6.16, 0.0)], 10, (gx, gz), M['hole'],
                        smooth=False))
    # Stub wing, a knuckle at its tip, and two forward-swept claw tines.
    side.append(S.wing('wing', T_WING, M['wing'], chord_pts=7, diamond=True, sharp=20))
    kx, kz = T_KNUCKLE
    side.append(F.faceted_pod('knuckle', [(2.0, 0.12, kx, kz), (1.75, 0.36, kx, kz), (-0.5, 0.42, kx, kz),
                                          (-1.0, 0.3, kx, kz)], M['armour'], sides=6, front=(kx, 2.15, kz),
                              back='cap'))
    side.append(F.blade('claw_u', [(4.45, 0.9, 0.1), (5.05, 2.4, 0.26), (5.42, 3.9, 0.34), (5.32, 5.0, 0.32),
                                   (4.95, 5.85, 0.26)],
                        [0.72, 0.6, 0.46, 0.3, 0.0], [0.19, 0.16, 0.12, 0.08, 0.0], M['claw'], side=(0, 0, 1),
                        lead=0.5))
    side.append(F.blade('claw_l', [(4.45, 0.5, -0.28), (4.92, 1.9, -0.52), (5.14, 3.2, -0.64), (4.98, 4.2, -0.62),
                                   (4.66, 4.85, -0.56)],
                        [0.62, 0.52, 0.4, 0.26, 0.0], [0.17, 0.14, 0.1, 0.07, 0.0], M['claw'], side=(0, 0, 1),
                        lead=0.5))
    path = [Vector((sx, sy - 0.05, sz)) for sx, sy, sz, _, _ in T_WING]
    path[0] = path[0].lerp(path[1], 0.35)
    side.append(S.bar('edge', path, 0.14, 0.06, M['armour'], lambda p: Vector((0, 0.3, 1.0))))
    # Missile rack under the wing root: a pod with three warheads showing.
    wing_bvh = S.bvh_of([o for o in side if o.name.startswith('wing')])
    loc, _ = S.frame_on(wing_bvh, (2.6, 0.2, -3), (0, 0, 1))
    rz = loc.z - 0.3
    side.append(S.box('rack', (0.82, 2.3, 0.44), M['metal'], Matrix.Translation((2.6, 0.2, rz)), taper=0.9))
    side.append(S.prism('pylon', [(-0.9, -0.1), (0.9, -0.1), (0.7, 0.32), (-0.6, 0.32)], 0.12, M['metal'],
                        Matrix.Translation((2.6, 0.2, rz + 0.12)) @ F.YZ))
    for dx in (-0.24, 0.0, 0.24):
        side.append(S.lathe('warhead', [(1.25, 0.0), (1.25, 0.1), (1.48, 0.1), (1.75, 0.0)], 8, (2.6 + dx, rz - 0.04),
                            M['missile'], sharp=40))
    # Armour on the wing, radiators along the nacelle.
    _, m = S.frame_on(wing_bvh, (3.05, -0.55, 3), (0, 0, -1))
    side.append(S.box('wing_plate', (1.25, 2.6, 0.07), M['armour'], m, taper=0.9))
    nac_bvh = S.bvh_of([o for o in side if o.name.startswith('nacelle')])
    for i, yy in enumerate((-3.0, -3.75)):
        _, m = S.frame_on(nac_bvh, (4, yy, T_ENG[1] + 0.12), (-1, 0, 0))
        side += S.vent(f'radiator{i}', (0.4, 0.55, 0.04), M['metal'], m, slats=5)
    # Vents and plates on the back.
    bvh = S.bvh_of([body])
    for i, yy in enumerate((-1.7, -2.6)):
        _, m = S.frame_on(bvh, (0.75, yy, 3), (0, 0, -1))
        side += S.vent(f'vent{i}', (0.42, 0.7, 0.05), M['metal'], m, slats=5)
    _, m = S.frame_on(bvh, (0.4, -3.45, 3), (0, 0, -1))
    side.append(S.transformed(S.lathe('antenna', [(-0.1, 0.0), (-0.1, 0.025), (0.75, 0.01), (0.78, 0.0)], 5, (0, 0),
                                      M['metal']),
                              m @ Matrix.Rotation(math.radians(118), 4, 'X')))
    parts += S.mirrored(side)
    keel = S.wing('keel', [(0.0, -1.9, 0.0, 2.5, 0.07), (0.7, -2.9, 0.0, 1.5, 0.06), (1.0, -3.6, 0.0, 0.8, 0.05)],
                  M['armour'], chord_pts=6, diamond=True, sharp=20)
    parts.append(S.transformed(keel, Matrix.Translation((0, 0, -0.48)) @ Matrix.Rotation(math.radians(90), 4, 'Y')))

    rcs_bvh = S.bvh_of([o for o in parts if o.name.startswith(('body', 'nacelle', 'knuckle', 'plate'))])
    rcs_parts, empties = F.place_rcs(TALON_RCS, rcs_bvh, M, size=0.22)
    parts += rcs_parts
    empties += [
        S.empty('nozzle_L', (-T_ENG[0], -6.46, T_ENG[1])), S.empty('nozzle_R', (T_ENG[0], -6.46, T_ENG[1])),
        S.empty('muzzle_L', (-gx, 6.16, gz)), S.empty('muzzle_R', (gx, 6.16, gz)),
        S.empty('launcher_0', (-2.6, 1.8, rz - 0.04)), S.empty('launcher_1', (2.6, 1.8, rz - 0.04)),
        S.empty('cam_cockpit', (0, 4.3, 0.55)),
    ]
    return dict(parts=parts, empties=empties, nozzle_size={'nozzle_L': 0.63, 'nozzle_R': 0.63}, lights={},
                tex=(2048, 2048, 1024, 1024), bevel=0.02, sharp=30, samples=16)


# ==========================================================================
# Warden — Harrow escort corvette, 140 m

W_SEC = F.polygon([(1.0, 0.0), (0.6, 0.6), (0.14, 1.0), (-0.14, 1.0), (-0.6, 0.6), (-1.0, 0.0), (-0.62, -1.0),
                   (0.62, -1.0)])
# section vertices: 0 right chine, 1 right shoulder, 2/3 ridge, 4 left shoulder, 5 left chine, 6/7 keel
WARDEN_BODY = [
    # y, half-width, top, bottom, centre z
    (59.0, 5.8, 4.8, 3.8, 0.6),         # the face: a blunt hexagon holding the eye
    (55.0, 8.2, 6.2, 4.6, 0.4),
    (38.0, 12.2, 8.6, 5.2, 0.0),
    (18.0, 15.2, 10.6, 5.8, 0.0),
    (-4.0, 16.8, 12.0, 6.0, 0.0),
    (-26.0, 16.6, 12.6, 6.0, 0.0),
    (-44.0, 15.4, 12.2, 6.0, 0.0),
    (-50.0, 14.6, 11.6, 6.0, 0.0),
]
W_EYE_C = Vector((0, 59.0, 0.7))
W_EYE_AXIS = Vector((0, 1, 0.06)).normalized()
W_ENG_SEC = F.polygon([(1.0, 0.55), (0.72, 1.0), (-0.72, 1.0), (-1.0, 0.55), (-1.0, -0.55), (-0.72, -1.0),
                       (0.72, -1.0), (1.0, -0.55)])
W_ENG_ROWS = [(-47.0, 14.4, 11.8, 7.4, 1.0), (-49.5, 16.6, 13.6, 8.8, 1.0), (-60.5, 16.6, 13.6, 8.8, 1.0),
              (-62.5, 15.2, 12.6, 8.0, 1.0)]
W_NOZZLES = [('nozzle_0', 0.0, 8.6), ('nozzle_1', -9.0, -1.6), ('nozzle_2', 9.0, -1.6)]
W_TINES = [(32.0, 9.0), (18.0, 12.0), (4.0, 13.5), (-10.0, 13.5), (-24.0, 12.5), (-38.0, 10.5)]
W_BEAM_X = 4.2
W_TURRET_K = 1.5
W_LIGHTS = {                           # red beacons: the two tail-blade tips, the ram
    'light_0': ((1.0, 0.1, 0.05), 2.4), 'light_1': ((1.0, 0.1, 0.05), 2.4), 'light_2': ((1.0, 0.1, 0.05), 1.2),
}


def keel_z(y):
    row = F.row_at(WARDEN_BODY, y)
    return row[4] - row[3]


def top_z(y):
    row = F.row_at(WARDEN_BODY, y)
    return row[4] + row[2]


def warden_turret_materials():
    s = 0.8

    def body(g, P, N):
        x, y, z = g.sep(P)
        nz = g.sep(N)[2]
        ring = g.mul(band(g, z, 0.12, 0.5, 0.01), g.sub(1.0, g.smooth(g.absolute(nz), 0.6, 0.8)))
        col = g.mix(ring, GUNMETAL, hazard_col(g, g.add(x, y), z, 0.35))
        col = g.mix(g.smooth(nz, 0.9, 0.95), col, OXBLOOD)
        return F.harrow_finish(g, col, 0.42, 0.5, P, N, s)

    def armour(g, P, N):
        return F.finish(g, OXBLOOD, 0.42, 0.35, P, N, s=s, wear=1.2, panel=(2.0, 0.8))

    def metal(g, P, N):
        return F.finish(g, (0.04, 0.042, 0.046), 0.48, 0.55, P, N, s=s, lines=False, wear=0.6)

    k = W_TURRET_K
    return dict(
        body=S.material('wt_body', body), armour=S.material('wt_armour', armour), metal=S.material('wt_metal', metal),
        t_eye=F.eye_material('wt_eye', (0, 2.6 * k, 1.0 * k), (0, 1, 0), 0.16 * k, 0.2 * k, 0.07 * k),
        glow_red=S.glow_material('wt_core', (1.0, 0.08, 0.03), (0.3, 0.02, 0.01)),
    )


def warden_materials():
    s = 4.0
    big = (14.0, (1.3, 0.55), 0.012)

    def hull_finish(g, col, rough, metal, P, N, **kw):
        kw.setdefault('plates', big)
        kw.setdefault('mortar', 0.03)
        kw.setdefault('grain', False)
        return F.harrow_finish(g, col, rough, metal, P, N, s, **kw)

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.35, -0.65)
        ridge = g.mul(g.smooth(nz, 0.9, 0.96), g.sub(1.0, g.smooth(ax, 0.5, 0.7)))
        col = g.mix(ridge, GUNMETAL, (0.03, 0.032, 0.036))
        col = g.mix(under, col, UNDER)
        face = g.mul(g.smooth(y, 58.6, 58.9), g.smooth(ny, 0.6, 0.8))
        col = g.mix(face, col, (0.03, 0.032, 0.036))
        side = g.smooth(g.absolute(nx), 0.5, 0.65)
        seam = g.mul(g.mul(band(g, z, -0.16, 0.16, 0.03), side), band(g, y, -46.0, 50.0, 0.3))
        col = g.mix(seam, col, (0.25, 0.01, 0.005))
        glow = g.mix(seam, BLACK, F.SEAM)
        return hull_finish(g, col, g.mixf(ridge, 0.42, 0.5), g.mixf(ridge, 0.55, 0.3), P, N, glow=glow)

    def engine(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        rim = g.mul(g.smooth(y, -60.2, -60.6), g.smooth(g.absolute(ny), 0.6, 0.3))
        col = g.mix(rim, (0.05, 0.053, 0.058), hazard_col(g, g.add(x, z), y, 1.0))
        heat = g.smooth(ny, -0.7, -0.9)
        col = g.mix(heat, col, (0.07, 0.055, 0.05))
        return hull_finish(g, col, 0.46, 0.6, P, N, wear=0.8)

    def armour(g, P, N):
        return hull_finish(g, OXBLOOD, 0.42, 0.35, P, N, wear=1.2, panel=(2.0, 0.8))

    def plate(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        slit = g.mul(g.smooth(g.math('FRACT', g.mul(y, 1.0 / 2.6)), 0.62, 0.66),
                     g.sub(1.0, g.smooth(g.math('FRACT', g.mul(y, 1.0 / 2.6)), 0.86, 0.9)))
        gills = g.mul(g.mul(slit, band(g, z, 2.6, 4.6, 0.1)), g.smooth(g.absolute(nx), 0.55, 0.7))
        groups = g.maximum(g.maximum(band(g, y, 22.0, 32.0, 0.2), band(g, y, -1.0, 9.0, 0.2)),
                           g.maximum(band(g, y, -21.0, -11.0, 0.2), band(g, y, -43.0, -35.0, 0.2)))
        gills = g.mul(gills, groups)
        col = g.mix(gills, (0.058, 0.061, 0.068), (0.2, 0.01, 0.005))
        return hull_finish(g, col, 0.44, 0.55, P, N, wear=1.3, panel=(2.0, 0.8), glow=g.mix(gills, BLACK, F.SEAM))

    def tine(g, P, N):
        x, y, z = g.sep(P)
        tip = g.smooth(z, -10.0, -14.0)
        col = g.mix(tip, OXBLOOD, (0.06, 0.06, 0.065))
        col = g.mix(band(g, z, -7.6, -6.6, 0.05), col, hazard_col(g, y, z, 0.8))
        return F.finish(g, col, g.mixf(tip, 0.42, 0.3), g.mixf(tip, 0.35, 0.8), P, N, s=s, lines=False, wear=1.5,
                        grain=False)

    def metal(g, P, N):
        return F.finish(g, (0.04, 0.042, 0.046), 0.48, 0.55, P, N, s=s, lines=False, wear=0.6, grain=False)

    nozzles = {f'nozzle{i}': F.nozzle_material(f'w_nozzle{i}', cx, cz, s) for i, (_, cx, cz) in enumerate(W_NOZZLES)}
    return dict(
        body=S.material('w_body', body), engine=S.material('w_engine', engine), armour=S.material('w_armour', armour),
        plate=S.material('w_plate', plate), tine=S.material('w_tine', tine), metal=S.material('w_metal', metal),
        eye=F.eye_material('w_eye', W_EYE_C, W_EYE_AXIS, 1.75, 2.05, 0.7),
        glow=S.glow_material('w_glow', (1.0, 0.42, 0.12), (0.4, 0.2, 0.1)),
        seam=S.glow_material('w_seam', F.SEAM, (0.3, 0.02, 0.01)),
        lens=S.glow_material('w_lens', (1.0, 0.12, 0.04), (0.2, 0.01, 0.005)),
        hole=S.material('w_hole', lambda g, P, N: dict(albedo=S.SOOT, rough=0.7, metal=0.0)),
        **nozzles,
    )


def barbette(name, mat, frame_m, radius, depth, sides=6):
    """A fixed turret ring: a faceted drum on the hull, its top at the
    frame's origin (the turret's yaw pivot), reaching `depth` below."""
    drum = S.lathe(name, [(-depth, 0.0), (-depth, radius), (-0.25, radius), (0.0, radius * 0.93), (0.0, 0.0)],
                   sides, (0, 0), mat, smooth=True, sharp=20, phase=math.pi / sides)
    return S.transformed(drum, frame_m @ Matrix.Rotation(math.radians(90), 4, 'X'))


def build_warden():
    # The turret first, baked alone (nothing else in the scene yet to shade it).
    TM = warden_turret_materials()
    base, gun, T, tsize, tip = F.harrow_turret(TM, W_TURRET_K)
    turret_meshes = F.bake_turret('warden_turret', base, gun, T, 512, bevel=0.04)

    M = warden_materials()
    parts = []
    body = F.loft('body', WARDEN_BODY, M['body'], W_SEC, front='cap', back='cap', sharp=12)
    parts.append(body)
    # Engine block and three nozzles.
    parts.append(F.loft('engine', W_ENG_ROWS, M['engine'], W_ENG_SEC, front='cap', back='cap', smooth=False))
    for i, (nm, cx, cz) in enumerate(W_NOZZLES):
        prof = [(-61.5, 5.6), (-64.5, 5.4), (-69.4, 6.25), (-69.9, 6.25), (-70.0, 5.9), (-67.0, 4.9), (-64.6, 3.6),
                (-63.6, 3.5), (-62.6, 4.4), (-62.0, 5.2)]
        parts.append(S.lathe(f'bell{i}', prof, 24, (cx, cz), M[f'nozzle{i}'], closed=True, sharp=35))
        parts.append(S.lathe(f'throat{i}', [(-64.0, 0.0), (-64.0, 3.6), (-63.8, 3.6), (-63.8, 0.0)], 24, (cx, cz),
                             M['glow'], smooth=False))
        parts.append(S.lathe(f'collar{i}', [(-60.8, 0.0), (-60.8, 6.7), (-62.8, 6.5), (-62.8, 0.0)], 12, (cx, cz),
                             M['metal'], smooth=True, sharp=30))
    # Armour wrapped over the engine block and radiator fins along its top.
    for i, (y0, y1) in enumerate(((-48.0, -55.0), (-53.8, -60.2))):
        for nm, idx in (('r', [7, 0, 1]), ('l', [2, 3, 4])):
            parts.append(F.shell(f'eng_{nm}{i}', W_ENG_ROWS, W_ENG_SEC, idx, y0, y1, M['plate'], lift=0.35 + 0.3 * i,
                                 thick=1.0, bevel=0.45))
    for k in range(4):
        parts.append(S.box(f'radiator{k}', (0.45, 9.5, 2.4), M['metal'],
                           Matrix.Translation((-4.5 + 3.0 * k, -54.6, 15.5)), taper=0.8))
    # The face: a great eye filling the blunt prow, an oxblood brow above it,
    # a plough-share ram below and two pincer tines either side.
    eye_m = S.facing(W_EYE_C, W_EYE_AXIS) @ Matrix.Rotation(math.radians(90), 4, 'X')
    parts.append(S.transformed(S.lathe('eye_housing', [(-2.0, 0.0), (-2.0, 4.1), (0.45, 3.95), (1.0, 3.35),
                                                       (1.0, 0.0)], 6, (0, 0), M['metal'], smooth=False,
                                       phase=math.pi / 6), eye_m))
    parts.append(S.transformed(S.lathe('eye', [(0.55, 0.0), (0.55, 3.2), (1.15, 2.85), (1.6, 1.75), (1.75, 0.0)], 28,
                                       (0, 0), M['eye']), eye_m))
    parts.append(F.shell('brow', WARDEN_BODY, W_SEC, [0, 1, 2, 3, 4, 5], 61.0, 47.0, M['armour'], lift=0.7,
                         thick=1.6, bevel=0.7))
    parts.append(F.loft('share', [(50.0, 4.4, 1.8, 2.0, -3.2), (59.5, 3.6, 1.4, 1.6, -3.4), (64.0, 2.2, 0.9, 1.1, -3.6),
                                  (68.0, 0.8, 0.45, 0.6, -3.8)], M['engine'], W_SEC, front='cap', back=(0, 70.0, -3.9),
                        sharp=12))
    pincer = F.blade('pincer', [(4.6, 54.0, -1.6), (5.6, 59.5, -2.2), (5.4, 64.0, -2.6), (4.2, 67.5, -2.8),
                                (2.4, 69.6, -2.9)], [3.2, 2.8, 2.2, 1.3, 0.0], [1.4, 1.2, 0.95, 0.6, 0.0],
                     M['tine'], side=(0, 0, 1), lead=0.5, sharp=25)
    parts += [pincer, S.mirror_x(pincer, 'pincer_m')]
    bz = top_z(44.0)
    brain = S.lathe('brain', [(-1.5, 0.0), (-1.5, 4.6), (0.6, 4.4), (2.3, 3.0), (3.0, 1.2), (3.1, 0.0)], 6, (0, 0),
                    M['armour'], smooth=True, sharp=20, phase=math.pi / 6)
    parts.append(S.transformed(brain, Matrix.Translation((0, 42.0, bz + 0.6))
                               @ Matrix.Rotation(math.radians(90), 4, 'X')))
    for k, (dx, h) in enumerate(((0.0, 7.5), (1.6, 5.0), (-1.6, 5.0))):
        spine = S.lathe(f'spine{k}', [(-0.5, 0.0), (-0.5, 0.18), (h, 0.05), (h + 0.3, 0.0)], 5, (0, 0), M['metal'],
                        smooth=False)
        parts.append(S.transformed(spine, Matrix.Translation((dx, 40.5, bz + 3.0))
                                   @ Matrix.Rotation(math.radians(122), 4, 'X')))

    # Keel beams carrying two splayed rows of plough tines.
    for sx in (1, -1):
        path = [Vector((sx * W_BEAM_X, yy, keel_z(yy) + 0.2)) for yy in (40.0, 30.0, 18.0, 0.0, -20.0, -44.0)]
        parts.append(S.bar(f'beam{sx}', path, 2.6, 2.2, M['plate'], lambda p: Vector((0, 0, -1))))
    seeds = []                          # collision spheres down each tine
    for i, (y0, L) in enumerate(W_TINES):
        kz = keel_z(y0) - 1.6
        spine = [(0, y0 + 1.0, kz + 2.0), (0, y0 - 0.6, kz - 0.8), (0, y0 - 1.8, kz - L * 0.45),
                 (0, y0 - 0.6, kz - L * 0.8), (0, y0 + 2.4, kz - L)]
        tine = F.blade(f'tine{i}', spine, [7.0, 6.2, 4.6, 2.6, 0.0], [1.7, 1.5, 1.15, 0.7, 0.0], M['tine'],
                       side=(1, 0, 0), lead=0.35, sharp=25)
        for sx in (1, -1):
            t = tine if sx == 1 else S.mirror_x(tine, f'tine{i}_m')
            pivot = Vector((sx * W_BEAM_X, 0, kz))
            mt = (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(sx * 14), 4, 'Y')
                  @ Matrix.Translation(-Vector((0, 0, kz))))
            S.transformed(t, mt)
            parts.append(t)
            p2, p3, p4 = (mt @ Vector((0, sp[1], sp[2])) for sp in spine[2:])
            seeds += [(tuple(p2), 2.7), (tuple(p3.lerp(p4, 0.35)), 1.7)]

    # Armour: oxblood plates stepping along the ridge, darker plates down the flanks.
    for i, (y0, y1, lift) in enumerate(((36.0, 18.5, 0.45), (21.0, 3.0, 0.7), (6.0, -13.0, 0.45),
                                        (-10.0, -30.0, 0.7))):
        parts.append(F.shell(f'ridge{i}', WARDEN_BODY, W_SEC, [1, 2, 3, 4], y0, y1,
                             M['armour'] if i % 2 == 0 else M['plate'], lift=lift, thick=1.3, bevel=0.5))
    for i, (y0, y1, lift) in enumerate(((50.0, 30.0, 0.4), (34.0, 12.0, 0.65), (16.0, -6.0, 0.4), (-2.0, -24.0, 0.65),
                                        (-20.0, -45.0, 0.4))):
        parts.append(F.shell(f'flank_r{i}', WARDEN_BODY, W_SEC, [0, 1], y0, y1, M['plate'], lift=lift, thick=1.3,
                             bevel=0.5))
        parts.append(F.shell(f'flank_l{i}', WARDEN_BODY, W_SEC, [4, 5], y0, y1, M['plate'], lift=lift, thick=1.3,
                             bevel=0.5))

    side = []
    for i, (y0, y1, lift) in enumerate(((44.0, 24.0, 0.35), (28.0, 6.0, 0.6), (10.0, -14.0, 0.35), (-10.0, -32.0, 0.6),
                                        (-28.0, -46.0, 0.35))):
        side.append(F.shell(f'lower{i}', WARDEN_BODY, W_SEC, [7, 0], y0, y1, M['plate'], lift=lift, thick=1.2,
                            bevel=0.5))
    # Twin raked blades on the aft dorsal shoulders.
    blade = S.wing('tail', [(0.0, -24.0, 0.0, 24.0, 0.07), (6.0, -36.0, 0.0, 14.0, 0.065), (11.0, -47.0, 0.0, 5.0, 0.06)],
                   M['armour'], chord_pts=6, diamond=True, sharp=20)
    side.append(S.transformed(blade, Matrix.Translation((5.2, 0, top_z(-36.0) - 2.4))
                              @ Matrix.Rotation(math.radians(-70), 4, 'Y')))
    # Vents on the shoulders.
    for i, (yy, size) in enumerate(((12.0, (3.2, 6.0, 0.4)), (-16.0, (3.2, 7.0, 0.4)), (-38.0, (3.0, 5.0, 0.4)))):
        m = F.facet_frame(WARDEN_BODY, W_SEC, 1, yy, t=0.55, out=0.0)
        side += S.vent(f'vent{i}', size, M['metal'], m, slats=6)
    # Secondary eyes: a row of small red lenses down each forward shoulder.
    for i, (yy, r) in enumerate(((52.5, 0.95), (49.6, 0.8), (46.9, 0.68), (44.4, 0.56))):
        p, nrm = F.surface_point(WARDEN_BODY, W_SEC, 1, yy, out=0.55)
        em = S.facing(p, (nrm + Vector((0, 0.35, 0))).normalized()) @ Matrix.Rotation(math.radians(90), 4, 'X')
        side.append(S.transformed(S.lathe(f'ocell{i}', [(-0.5, 0.0), (-0.5, r * 1.35), (0.15, r * 1.25), (0.3, r * 1.1),
                                                        (0.3, 0.0)], 6, (0, 0), M['metal'], smooth=False,
                                          phase=math.pi / 6), em))
        side.append(S.transformed(S.lathe(f'ocellus{i}', [(0.2, 0.0), (0.2, r), (0.5, r * 0.85), (0.72, r * 0.45),
                                                          (0.8, 0.0)], 12, (0, 0), M['lens']), em))
    # Conduits along the ridge shoulders, glowing exhaust vents on the engine block.
    path = [F.surface_point(WARDEN_BODY, W_SEC, 1, yy, out=0.9)[0] for yy in (40.0, 30.0, 12.0, -6.0, -24.0, -42.0)]
    side.append(S.bar('conduit', path, 0.9, 0.7, M['metal'], lambda p: Vector((0.6, 0, 0.8))))
    for k, (yy, out) in enumerate(((-50.4, 0.42), (-52.2, 0.42), (-57.0, 0.72), (-58.8, 0.72))):
        m = F.facet_frame(W_ENG_ROWS, W_ENG_SEC, 7, yy, t=0.5, out=out)
        side.append(S.box(f'exhaust{k}', (5.2, 0.8, 0.3), M['seam'], m))
    parts += S.mirrored(side)

    # A crest of raked tines along the ridge, low enough for both ridge
    # turrets to fire over it fore and aft.
    for i, yy in enumerate((9.0, 3.0, -3.0)):
        h = (3.4, 3.4, 3.0)[i]
        crest = S.wing(f'crest{i}', [(0.0, yy + 2.0, 0.0, 4.4, 0.09), (h * 0.6, yy - 1.4, 0.0, 2.4, 0.08),
                                     (h, yy - 3.4, 0.0, 0.7, 0.07)], M['armour'], chord_pts=6, diamond=True, sharp=20)
        parts.append(S.transformed(crest, Matrix.Translation((0, 0, top_z(yy) - 0.4))
                                   @ Matrix.Rotation(math.radians(-90), 4, 'Y')))
    # Turret mounts: two on the ridge, two in sponsons on the lower flanks.
    k = W_TURRET_K
    frames = []
    for i, (yy, rise) in enumerate(((24.0, 2.5), (-20.0, 1.3))):
        top = top_z(yy) + (0.7 if i else 0.45)
        pivot = Vector((0, yy, top + rise))
        m = F.frame(pivot, (0, 0, 1), (0, 1, 0))
        parts.append(barbette(f'barbette{i}', M['plate'], m, 4.2 * k, rise + 2.3))
        frames.append(m)
    for sx in (1, -1):
        # the lower flank facets: 7 runs from the starboard keel corner to its chine, 5 from the port chine down
        m0 = F.facet_frame(WARDEN_BODY, W_SEC, 7 if sx > 0 else 5, -3.0, t=0.5)
        up = m0.col[2].xyz
        pivot = m0.translation + up * 1.6
        m = F.frame(pivot, up, (0, 1, 0))
        parts.append(barbette(f'sponson{sx}', M['plate'], m, 4.2 * k, 3.2))
        frames.append(m)

    # Red beacons on the blade tips and the ram.
    tips = [Vector((sx * (5.2 + 11.0 * math.cos(math.radians(70))), -49.0,
                    top_z(-36.0) - 2.4 + 11.0 * math.sin(math.radians(70)))) for sx in (-1, 1)]
    lights = tips + [Vector((0, 66.0, -3.0))]
    empties = []
    for i, p in enumerate(lights):
        parts.append(S.lathe(f'beacon{i}', [(p.y - 0.45, 0.0), (p.y - 0.4, 0.3), (p.y + 0.4, 0.3), (p.y + 0.45, 0.0)],
                             8, (p.x, p.z), M['seam']))
        empties.append(F.marker(f'light_{i}', p))
    for nm, cx, cz in W_NOZZLES:
        empties.append(S.empty(nm, (cx, -70.0, cz)))
    empties += [
        F.marker('sub_engine_0', (0, -56.0, 2.5), scale=15.0, display='SPHERE', size=1.0),
        F.marker('sub_bridge', (0, 44.0, bz + 1.0), scale=6.0, display='SPHERE', size=1.0),
    ]
    return dict(parts=parts, empties=empties, nozzle_size={nm: 5.9 for nm, _, _ in W_NOZZLES}, lights=W_LIGHTS,
                tex=(2048, 2048, 1024, 2048), bevel=0.15, sharp=30, samples=10, uv_shape='AABB',
                turrets=dict(meshes=turret_meshes, T=T, frames=frames, size=round(tsize, 2), muzzle=tip),
                colliders=dict(voxel=0.6, step=1.6, r_min=1.5, grow=1.0, tol=1.6, max_count=72, coverage=0.97,
                               seeds=seeds))


# ==========================================================================
# Halberd — Belt Watch gunship, 160 m

H_SEC = F.polygon([(1.0, 0.42), (0.74, 1.0), (-0.74, 1.0), (-1.0, 0.42), (-1.0, -0.06), (-1.0, -0.42), (-0.7, -1.0),
                   (0.7, -1.0), (1.0, -0.42), (1.0, -0.06)])
# section vertices: 0 right side top, 1/2 deck edges, 3 left side top, 4 left belt top, 5 left side bottom,
# 6/7 keel corners, 8 right side bottom, 9 right belt top
HALBERD_BODY = [
    # y, half-width, top, bottom, centre z
    (76.5, 1.3, 5.6, 5.8, -0.4),        # the stem: a narrow blade of a bow
    (71.0, 7.0, 9.2, 8.2, -0.2),
    (62.0, 12.4, 11.8, 9.7, 0.0),
    (48.0, 15.0, 12.6, 10.2, 0.0),
    (29.0, 15.6, 12.6, 10.5, 0.0),      # the forecastle steps down to the main deck
    (24.0, 15.8, 11.2, 10.6, 0.0),
    (-20.0, 16.0, 11.2, 10.4, 0.0),
    (-44.0, 15.0, 10.8, 9.6, 0.0),
    (-58.0, 13.0, 10.0, 8.6, 0.0),
    (-62.0, 12.4, 9.6, 8.2, 0.0),
]
H_SLOT = (7.0, -5.6, -0.6)              # hangar mouth: half-width, bottom, top (stern face)
H_SLOT_DEPTH = 12.0
H_NAC = (23.2, -1.0)                    # nacelle axis x, z
H_TURRET_K = 1.55
H_LIGHTS = {
    'light_0': ((1.0, 0.08, 0.05), 0.0),     # port, red
    'light_1': ((0.1, 1.0, 0.3), 0.0),      # starboard, green
    'light_2': ((1.0, 1.0, 1.0), 1.5),      # masthead strobe
    'light_3': ((1.0, 1.0, 1.0), 1.5),      # ventral strobe
    'light_4': ((1.0, 1.0, 1.0), 0.0),      # stern
    'light_5': ((1.0, 1.0, 1.0), 0.0),      # bow
}
WINDOW = lin('#ffd9a0')


def h_top(y):
    row = F.row_at(HALBERD_BODY, y)
    return row[4] + row[2]


def h_keel(y):
    row = F.row_at(HALBERD_BODY, y)
    return row[4] - row[3]


def seven_segment(g, u, v, digits, w, h, t, gap):
    """Painted block digits: u runs along the hull, v up; returns 1 on the
    strokes."""
    segs = {'a': (0, w, h - t, h), 'b': (w - t, w, h / 2, h), 'c': (w - t, w, 0, h / 2), 'd': (0, w, 0, t),
            'e': (0, t, 0, h / 2), 'f': (0, t, h / 2, h), 'g': (0, w, h / 2 - t / 2, h / 2 + t / 2)}
    lit = {'0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc',
           '8': 'abcdefg', '9': 'abcdfg'}
    out = 0.0
    for k, ch in enumerate(digits):
        u0 = k * (w + gap)
        for sg in lit[ch]:
            a, b, c, d = segs[sg]
            m = g.mul(band(g, u, u0 + a, u0 + b, 0.03), band(g, v, c, d, 0.03))
            out = m if isinstance(out, float) else g.maximum(out, m)
    return out


def halberd_turret_materials():
    s = 0.8

    def house(g, P, N):
        x, y, z = g.sep(P)
        nz = g.sep(N)[2]
        stripe = band(g, y, 1.4, 2.0, 0.01)
        col = g.mix(stripe, OFF_WHITE, ORANGE)
        col = g.mix(g.mul(band(g, y, 2.0, 2.15, 0.005), g.smooth(nz, 0.5, 0.7)), col, GRAPHITE)
        col = g.mix(g.smooth(nz, -0.3, -0.6), col, GRAPHITE)
        return F.finish(g, col, 0.42, 0.2, P, N, s=s, panel=(1.6, 0.7))

    def metal(g, P, N):
        return F.finish(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, s=s, lines=False, wear=0.6)

    def barrel(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(band(g, y, 7.9, 8.4, 0.01), GRAPHITE, ORANGE)
        return F.finish(g, col, 0.45, 0.4, P, N, s=s, lines=False, wear=0.5)

    return dict(turret=S.material('ht_house', house), metal=S.material('ht_metal', metal),
                barrel=S.material('ht_barrel', barrel))


def halberd_materials():
    s = 6.0
    big = (18.0, (1.3, 0.62), 0.011)

    def watch_finish(g, col, rough, metal, P, N, **kw):
        kw.setdefault('plates', big)
        kw.setdefault('mortar', 0.022)
        kw.setdefault('grain', False)
        kw.setdefault('panel', (1.3, 0.55))
        kw.setdefault('line_dark', 0.32)
        return F.finish(g, col, rough, metal, P, N, s=s, **kw)

    def windows(g, y, z, rows, y0, y1, period=2.6, width=1.1, height=0.75):
        """Rows of small lit windows: centres at height z in `rows`."""
        f = g.math('FRACT', g.mul(y, 1.0 / period))
        col_mask = g.mul(g.smooth(f, 0.5 - width / period / 2 - 0.02, 0.5 - width / period / 2),
                         g.sub(1.0, g.smooth(f, 0.5 + width / period / 2, 0.5 + width / period / 2 + 0.02)))
        out = 0.0
        for zc in rows:
            m = band(g, z, zc - height / 2, zc + height / 2, 0.03)
            out = m if isinstance(out, float) else g.maximum(out, m)
        return g.mul(g.mul(out, col_mask), band(g, y, y0, y1, 0.1))

    def body(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        nx, ny, nz = g.sep(N)
        side = g.smooth(g.absolute(nx), 0.8, 0.9)
        lower = g.maximum(g.smooth(nz, -0.45, -0.65), g.smooth(z, -4.6, -4.8))
        col = g.mix(lower, OFF_WHITE, GRAPHITE)
        pin = g.mul(band(g, z, 3.85, 4.2, 0.02), side)
        col = g.mix(pin, col, ORANGE)
        bow = g.mul(band(g, y, 60.0, 64.0, 0.05), g.sub(1.0, lower))
        col = g.mix(bow, col, ORANGE)
        col = g.mix(g.mul(band(g, y, 64.0, 64.4, 0.02), g.sub(1.0, lower)), col, GRAPHITE)
        # hull number on both bows, read left to right from either side
        u = g.add(g.mul(g.sub(y, 48.5), g.math('SIGN', x)), 3.2)
        num = g.mul(seven_segment(g, u, g.sub(z, 0.2), '07', 2.8, 2.8, 0.55, 0.9), side)
        col = g.mix(num, col, GRAPHITE)
        # lit windows: two decks along the sides, one on the upper chamfer
        win = g.mul(windows(g, y, z, (1.4, 3.0), -54.0, 44.0), side)
        upper = g.mul(g.smooth(nz, 0.25, 0.4), g.sub(1.0, g.smooth(nz, 0.75, 0.85)))
        win = g.maximum(win, g.mul(windows(g, y, z, (7.2,), -40.0, 26.0, period=4.2, width=1.4, height=0.7), upper))
        gaps = g.smooth(g.noise(g.combine(g.mul(y, 0.13), g.math('SIGN', x), z), 1.0, 2.0), 0.36, 0.42)
        win = g.mul(win, gaps)
        # hangar: lit interior and a hazard-striped frame round the mouth
        x0, z0, z1 = H_SLOT
        tunnel = g.mul(g.mul(g.sub(1.0, g.smooth(ax, x0 + 0.05, x0 + 0.15)), band(g, z, z0 - 0.15, z1 + 0.15, 0.02)),
                       g.smooth(y, -61.95, -61.85))
        strip = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(y, 0.5)), 0.5)), 0.3, 0.38)
        ceiling = g.mul(g.smooth(nz, -0.6, -0.8), strip)
        bay_glow = g.mul(tunnel, g.add(0.18, g.mul(ceiling, 0.8)))
        frame = g.mul(g.mul(g.smooth(ny, -0.8, -0.9), g.smooth(y, -61.5, -61.8)),
                      g.mul(g.sub(1.0, g.smooth(ax, x0 + 1.6, x0 + 1.7)), band(g, z, z0 - 1.6, z1 + 1.6, 0.05)))
        col = g.mix(frame, col, hazard_col(g, x, z, 0.7))
        col = g.mix(tunnel, col, (0.18, 0.17, 0.16))
        glow = g.mix(win, BLACK, WINDOW)
        glow = g.mix(bay_glow, glow, (1.0, 0.82, 0.55))
        col = g.mix(win, col, (0.4, 0.33, 0.25))
        rough = g.mixf(lower, 0.42, 0.5)
        return watch_finish(g, col, rough, g.mixf(lower, 0.2, 0.3), P, N, glow=glow)

    def tower(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        vert = g.sub(1.0, g.smooth(g.absolute(nz), 0.5, 0.7))
        band_w = g.mul(band(g, z, 18.6, 20.4, 0.04), vert)
        col = g.mix(band_w, OFF_WHITE, (0.02, 0.022, 0.026))
        col = g.mix(g.mul(band(g, z, 16.2, 16.7, 0.03), vert), col, ORANGE)
        win = g.mul(band_w, g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(g.add(x, y), 0.45)), 0.5)), 0.04, 0.08))
        low = g.mul(windows(g, g.add(x, y), z, (13.2, 15.0), -60.0, 60.0, period=2.4, width=1.0, height=0.6), vert)
        glow = g.mix(g.maximum(g.mul(win, 0.85), low), BLACK, WINDOW)
        return watch_finish(g, col, 0.42, 0.2, P, N, glow=glow, panel=(1.6, 0.7))

    def armour(g, P, N):
        return watch_finish(g, GRAPHITE, 0.5, 0.3, P, N, wear=0.9, panel=(2.0, 0.8))

    def belt(g, P, N):
        x, y, z = g.sep(P)
        nz = g.sep(N)[2]
        col = g.mix(g.smooth(nz, -0.4, -0.6), lin('#a9a7a1'), GRAPHITE)
        col = g.mix(band(g, z, -1.3, -0.95, 0.02), col, GRAPHITE)
        return watch_finish(g, col, 0.46, 0.25, P, N, wear=0.9, panel=(2.4, 0.9))

    def prow(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        stem = g.sub(1.0, g.smooth(g.absolute(x), 1.9, 2.1))
        col = g.mix(g.maximum(stem, g.smooth(nz, -0.45, -0.65)), OFF_WHITE, GRAPHITE)
        chevron = band(g, g.add(y, g.mul(g.absolute(z), 0.35)), 70.4, 71.6, 0.03)
        col = g.mix(g.mul(chevron, g.sub(1.0, stem)), col, ORANGE)
        return watch_finish(g, col, 0.42, 0.25, P, N, wear=1.1, panel=(2.0, 0.8))

    def nacelle(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.2, -0.5)
        col = g.mix(under, OFF_WHITE, GRAPHITE)
        col = g.mix(band(g, y, -38.0, -36.0, 0.05), col, ORANGE)
        col = g.mix(g.maximum(band(g, y, -36.0, -35.6, 0.02), band(g, y, -38.4, -38.0, 0.02)), col, GRAPHITE)
        heat = g.smooth(y, -64.0, -69.0)
        col = g.mix(heat, col, (0.085, 0.07, 0.065))
        intake = g.mul(g.smooth(ny, 0.6, 0.8), g.smooth(y, -27.9, -27.6))
        col = g.mix(intake, col, (0.02, 0.021, 0.024))
        return watch_finish(g, col, g.mixf(heat, 0.42, 0.45), g.mixf(heat, 0.2, 0.6), P, N, wear=0.8)

    def metal(g, P, N):
        return F.finish(g, (0.045, 0.047, 0.05), 0.5, 0.5, P, N, s=s, lines=False, wear=0.6, grain=False)

    def deck(g, P, N):
        x, y, z = g.sep(P)
        walk = g.mul(band(g, g.absolute(x), 2.4, 2.9, 0.03), g.smooth(g.sep(N)[2], 0.8, 0.9))
        col = g.mix(walk, (0.36, 0.36, 0.35), GRAPHITE)
        return watch_finish(g, col, 0.55, 0.15, P, N, panel=(1.2, 1.2))

    return dict(
        body=S.material('h_body', body), tower=S.material('h_tower', tower), armour=S.material('h_armour', armour),
        belt=S.material('h_belt', belt), prow=S.material('h_prow', prow),
        nacelle=S.material('h_nacelle', nacelle), metal=S.material('h_metal', metal), deck=S.material('h_deck', deck),
        nozzle0=F.nozzle_material('h_nozzle0', -H_NAC[0], H_NAC[1], s),
        nozzle1=F.nozzle_material('h_nozzle1', H_NAC[0], H_NAC[1], s),
        glow=S.glow_material('h_glow', (0.55, 0.68, 1.0), (0.3, 0.35, 0.45)),
        red=S.glow_material('h_red', (1.0, 0.05, 0.03), (0.3, 0.02, 0.02)),
        green=S.glow_material('h_green', (0.05, 1.0, 0.25), (0.02, 0.3, 0.06)),
        white=S.glow_material('h_white', (1.0, 0.95, 0.9), (0.4, 0.4, 0.4)),
        hole=S.material('h_hole', lambda g, P, N: dict(albedo=S.SOOT, rough=0.7, metal=0.0)),
    )


def halberd_hull(mat):
    """The hull loft with a stem face at the bow and, at the stern, a ring of
    faces down to the hangar mouth and a tunnel into the hull."""
    bm = bmesh.new()
    rings = [[bm.verts.new((x, row[0], z)) for x, z in H_SEC(0, *row[1:])] for row in HALBERD_BODY]
    S.ring_faces(bm, rings)
    bm.faces.new(rings[0])
    yb = HALBERD_BODY[-1][0]
    x0, z0, z1 = H_SLOT
    mouth = [bm.verts.new((x, yb, z)) for x, z in ((x0, z0), (x0, z1), (-x0, z1), (-x0, z0))]
    F.annulus(bm, rings[-1], mouth)
    back = [bm.verts.new((v.co.x, yb + H_SLOT_DEPTH, v.co.z)) for v in mouth]
    S.ring_faces(bm, [mouth, back])
    bm.faces.new(back)
    return S.finish_bm('body', bm, mat, smooth=True, sharp=12)


def build_halberd():
    TM = halberd_turret_materials()
    base, gun, T, tsize, tip = F.watch_turret(TM, H_TURRET_K)
    turret_meshes = F.bake_turret('halberd_turret', base, gun, T, 512, bevel=0.04)

    M = halberd_materials()
    parts = []
    body = halberd_hull(M['body'])
    parts.append(body)
    # Bow: an armoured prow cap and the spike.
    parts.append(F.shell('prow', HALBERD_BODY, H_SEC, [8, 9, 0, 1, 2, 3, 4, 5], 76.9, 66.5, M['prow'],
                         lift=0.45, thick=1.2, bevel=0.5))
    parts.append(S.lathe('spike', [(74.0, 0.0), (74.0, 1.15), (77.2, 0.9), (79.4, 0.2), (80.0, 0.0)], 10, (0, 1.2),
                         M['metal'], sharp=40))
    # Armour belts along the sides.
    for nm, idx in (('r', [8, 9]), ('l', [4, 5])):
        for i, (y0, y1) in enumerate(((60.0, 30.0), (33.0, 2.0), (5.0, -26.0), (-23.0, -56.0))):
            parts.append(F.shell(f'belt_{nm}{i}', HALBERD_BODY, H_SEC, idx, y0, y1, M['belt'],
                                 lift=0.5 + 0.25 * (i % 2), thick=1.1, bevel=0.45))
    # Deck plates between the turrets.
    for i, (y0, y1) in enumerate(((47.0, 29.5), (22.0, -8.0), (-44.0, -58.0))):
        parts.append(F.shell(f'deck{i}', HALBERD_BODY, H_SEC, [1, 2], y0, y1, M['deck'], lift=0.3, thick=0.9,
                             bevel=0.4))

    # Superstructure: deckhouse, bridge with its window band, mast, radiator.
    top = h_top(-24.0)
    parts.append(S.box('deckhouse', (24.0, 30.0, 7.6), M['tower'], Matrix.Translation((0, -24.0, top - 1.6 + 3.8)),
                       taper=0.9))
    z1 = top - 1.6 + 7.6
    zc = z1 + 1.9
    bridge = F.loft('bridge', [(-11.0, 8.6, 2.2, 2.1, zc), (-12.6, 9.0, 3.0, 2.1, zc), (-25.0, 9.0, 3.0, 2.1, zc),
                               (-26.0, 8.4, 2.6, 2.1, zc)], M['tower'],
                    F.polygon([(1.0, 0.0), (0.8, 1.0), (-0.8, 1.0), (-1.0, 0.0), (-1.0, -1.0), (1.0, -1.0)]),
                    front='cap', back='cap', smooth=False)
    parts.append(bridge)
    zb = z1 + 1.9 + 3.0
    parts.append(S.box('mast', (2.4, 2.6, 9.0), M['tower'], Matrix.Translation((0, -21.0, zb + 4.3)), taper=0.7))
    parts.append(S.lathe('dome', [(-1.9, 0.0), (-1.9, 1.2), (-1.0, 1.9), (0.3, 1.9), (1.4, 1.2), (1.9, 0.0)], 14,
                         (0, 0), M['tower'], sharp=50))
    S.transformed(parts[-1], Matrix.Translation((0, -21.0, zb + 9.6)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    parts.append(S.box('yard', (11.0, 0.8, 0.6), M['metal'], Matrix.Translation((0, -21.0, zb + 6.0))))
    for k, (dx, h) in enumerate(((4.6, 6.0), (-4.6, 4.5))):
        parts.append(S.lathe(f'whip{k}', [(-0.2, 0.0), (-0.2, 0.12), (h, 0.04), (h + 0.2, 0.0)], 5, (0, 0), M['metal'],
                             smooth=False))
        S.transformed(parts[-1], Matrix.Translation((dx, -21.0, zb + 6.2)) @ Matrix.Rotation(math.radians(100), 4, 'X'))
    # Bridge wings either side of the window band, and a fire-control
    # director standing on the deck ahead of the deckhouse.
    parts.append(S.box('wings', (25.0, 3.6, 1.4), M['tower'], Matrix.Translation((0, -12.8, z1 + 0.5)), taper=0.94))
    d0 = h_top(-5.5)
    parts.append(S.box('director', (5.6, 5.0, z1 + 2.6 - d0), M['tower'],
                       Matrix.Translation((0, -5.5, (d0 + z1 + 2.6) / 2)), taper=0.78))
    parts.append(S.box('finder', (8.4, 1.4, 1.2), M['metal'], Matrix.Translation((0, -5.7, z1 + 3.0)), taper=0.9))
    dish = S.lathe('dish', [(0.0, 0.0), (0.6, 2.6), (0.9, 2.7), (0.4, 0.5), (0.4, 0.0)], 14, (0, 0), M['metal'],
                   sharp=50)
    parts.append(S.transformed(dish, Matrix.Translation((-8.8, -30.0, zb - 0.8))
                               @ Matrix.Rotation(math.radians(-50), 4, 'Z') @ Matrix.Rotation(math.radians(20), 4, 'X')))
    parts.append(S.box('dish_post', (0.8, 0.8, 4.4), M['metal'], Matrix.Translation((-8.8, -30.0, z1 + 1.9))))
    rad = S.box('radiator', (14.0, 8.0, 4.0), M['armour'], Matrix.Translation((0, -33.6, z1 + 1.6)), taper=0.85)
    parts.append(rad)
    _, m = S.frame_on(S.bvh_of([rad]), (0, -33.6, z1 + 10), (0, 0, -1))
    parts += S.vent('rad_vent', (11.0, 6.0, 0.4), M['metal'], m, slats=9)

    # Nacelles on pylons, with intakes, bells and blue throats.
    side = []
    nx_, nz_ = H_NAC
    side.append(S.lathe('nacelle', [(-27.4, 0.0), (-27.4, 6.8), (-26.8, 7.7), (-27.8, 8.5), (-33.0, 8.6),
                                    (-66.0, 8.6), (-69.5, 8.2), (-70.5, 0.0)], 32, (nx_, nz_), M['nacelle'], sharp=40))
    side.append(S.lathe('intake', [(-27.0, 0.0), (-27.0, 6.75), (-27.3, 6.75), (-27.3, 0.0)], 32, (nx_, nz_),
                        M['hole'], smooth=False))
    side.append(S.lathe('spinner', [(-27.3, 0.0), (-27.3, 2.4), (-26.2, 2.0), (-25.4, 1.0), (-25.1, 0.0)], 16,
                        (nx_, nz_), M['metal']))
    side.append(S.lathe('bell', [(-69.0, 7.4), (-73.5, 7.1), (-79.5, 7.65), (-80.0, 7.65), (-80.1, 7.1),
                                 (-76.4, 6.0), (-73.4, 4.6), (-72.5, 4.5), (-71.0, 5.6), (-69.8, 6.9)], 32, (nx_, nz_),
                        M['nozzle1'], closed=True, sharp=35))
    side.append(S.lathe('throat', [(-72.8, 0.0), (-72.8, 4.6), (-72.6, 4.6), (-72.6, 0.0)], 32, (nx_, nz_),
                        M['glow'], smooth=False))
    for k, yy in enumerate((-44.0, -58.0)):
        side.append(S.lathe(f'clamp{k}', [(yy, 0.0), (yy, 8.95), (yy - 1.2, 8.95), (yy - 1.2, 0.0)], 32, (nx_, nz_),
                            M['metal'], smooth=False))
    side.append(S.wing('pylon', [(9.0, -29.0, nz_, 27.0, 0.11), (nx_, -32.0, nz_, 23.0, 0.11)], M['armour'],
                       chord_pts=8, diamond=True, sharp=25))
    nac_bvh = S.bvh_of([side[0]])
    for i, yy in enumerate((-40.0, -48.0, -56.0)):
        _, m = S.frame_on(nac_bvh, (nx_, yy, 20), (0, 0, -1))
        side += S.vent(f'nvent{i}', (4.2, 5.0, 0.35), M['metal'], m, slats=6)
    # cooling fins standing round the nacelle's flanks, like a cylinder head's
    for k in range(7):
        yy = -46.0 - 1.6 * k
        for a in (-24.0, 24.0):
            ar = math.radians(a)
            d, t = Vector((math.cos(ar), 0, math.sin(ar))), Vector((-math.sin(ar), 0, math.cos(ar)))
            m = Matrix((Vector((0, 1, 0)), t, d)).transposed().to_4x4()
            m.translation = Vector((nx_, yy, nz_)) + d * 9.05
            side.append(S.box(f'sink{k}_{a:.0f}', (0.3, 4.2, 1.4), M['metal'], m, taper=0.85))
    # RCS quads at the bow and stern quarters.
    bvh = S.bvh_of([body])
    for i, (yy, zz) in enumerate(((64.0, 6.0), (64.0, -6.0), (-56.0, 6.0), (-56.0, -6.0))):
        _, m = S.frame_on(bvh, (40, yy, zz), (-1, 0, 0))
        side.append(S.box(f'rcsq{i}', (1.6, 2.6, 0.9), M['metal'], m @ Matrix.Translation((0, 0, 0.3)), taper=0.8))
        for k, (dy, dz) in enumerate(((0.7, 0.45), (-0.7, 0.45), (0.7, -0.45), (-0.7, -0.45))):
            port = S.lathe(f'rcsq{i}n{k}', [(0.0, 0.0), (0.0, 0.32), (0.5, 0.38), (0.55, 0.0)], 8, (0, 0), M['hole'],
                           smooth=False)
            side.append(S.transformed(port, m @ Matrix.Translation((dz, dy, 0.65))
                                      @ Matrix.Rotation(math.radians(90), 4, 'X')))
    # Point-defence blisters along the chamfers, vents low on the sides.
    for i, yy in enumerate((56.0, 24.0, -8.0, -46.0)):
        _, m = S.frame_on(bvh, (30, yy, 7.5), (-1, 0, -0.55))
        blister = S.lathe(f'blister{i}', [(-0.6, 0.0), (-0.6, 1.7), (0.4, 1.6), (1.2, 0.9), (1.5, 0.0)], 12, (0, 0),
                          M['armour'], sharp=40)
        side.append(S.transformed(blister, m @ Matrix.Rotation(math.radians(90), 4, 'X')))
    for i, (yy, size) in enumerate(((40.0, (4.0, 7.0, 0.5)), (-2.0, (4.0, 9.0, 0.5)), (-32.0, (4.0, 7.0, 0.5)))):
        _, m = S.frame_on(bvh, (30, yy, -9.0), (-1, 0, 0.4))
        side += S.vent(f'lvent{i}', size, M['metal'], m, slats=6)
    parts += S.mirrored(side)
    for o in parts:
        if o.name.startswith('bell_m'):
            o.data.materials[0] = M['nozzle0']

    # Turrets: superfiring pair forward, one aft facing aft, three under the keel.
    k = H_TURRET_K
    mounts = [((0, 53.0, h_top(53.0)), 1.0, (0, 1, 0), 1), ((0, 33.0, h_top(33.0)), 5.2, (0, 1, 0), 1),
              ((0, -52.0, h_top(-52.0)), 2.2, (0, -1, 0), 1), ((0, 44.0, h_keel(44.0)), 1.0, (0, 1, 0), -1),
              ((0, 6.0, h_keel(6.0)), 1.0, (0, 1, 0), -1), ((0, -38.0, h_keel(-38.0)), 1.0, (0, -1, 0), -1)]
    frames = []
    for i, (p, lift, fwd, up) in enumerate(mounts):
        pivot = Vector(p) + Vector((0, 0, up * lift))
        m = F.frame(pivot, (0, 0, up), fwd)
        drum = S.lathe(f'barbette{i}', [(-lift - 1.2, 0.0), (-lift - 1.2, 4.4 * k), (-0.2, 4.4 * k), (0.0, 4.15 * k),
                                       (0.0, 0.0)], 20, (0, 0), M['armour'], smooth=True, sharp=30)
        parts.append(S.transformed(drum, m @ Matrix.Rotation(math.radians(90), 4, 'X')))
        frames.append(m)

    # Nav lights: red to port, green to starboard, white strobes and steady whites.
    lights = [(Vector((-(nx_ + 8.75), -33.5, nz_)), M['red']), (Vector((nx_ + 8.75, -33.5, nz_)), M['green']),
              (Vector((0, -21.0, zb + 11.7)), M['white']), (Vector((0, -14.0, h_keel(-14.0) - 0.3)), M['white']),
              (Vector((0, -62.3, 8.0)), M['white']), (Vector((0, 76.2, 4.9)), M['white'])]
    empties = []
    for i, (p, mat) in enumerate(lights):
        parts.append(S.lathe(f'navlight{i}', [(p.y - 0.55, 0.0), (p.y - 0.5, 0.45), (p.y + 0.5, 0.45),
                                              (p.y + 0.55, 0.0)], 10, (p.x, p.z), mat))
        empties.append(F.marker(f'light_{i}', p))
    empties += [
        S.empty('nozzle_0', (-nx_, -80.1, nz_)), S.empty('nozzle_1', (nx_, -80.1, nz_)),
        F.marker('sub_engine_0', (-nx_, -58.0, nz_), scale=10.0, display='SPHERE', size=1.0),
        F.marker('sub_engine_1', (nx_, -58.0, nz_), scale=10.0, display='SPHERE', size=1.0),
        F.marker('sub_bridge', (0, -18.5, z1 + 2.5), scale=8.0, display='SPHERE', size=1.0),
        F.marker('bay_0', (0, -62.5, (H_SLOT[1] + H_SLOT[2]) / 2), minus_y=(0, -1, 0)),
    ]
    return dict(parts=parts, empties=empties, nozzle_size={'nozzle_0': 7.1, 'nozzle_1': 7.1}, lights=H_LIGHTS,
                tex=(2048, 2048, 1024, 2048), bevel=0.15, sharp=20, samples=10, uv_shape='AABB',
                turrets=dict(meshes=turret_meshes, T=T, frames=frames, size=round(tsize, 2), muzzle=tip),
                colliders=dict(voxel=0.7, step=1.8, r_min=1.5, grow=1.0, tol=1.6, max_count=56, coverage=0.97))


# ==========================================================================
# Assembly: bake, colliders, export, anchors

def assemble(name, spec):
    t0 = time.time()
    parts, empties = spec['parts'], spec['empties']
    turret_objs, turret_records, muzzles = [], [], []
    if spec.get('turrets'):
        t = spec['turrets']
        for b, g, e in F.place_turrets(t['meshes'], t['T'], t['frames'], t['muzzle']):
            turret_objs += [b, g]
            turret_records.append((b, t['size']))
            muzzles.append(e)
    if os.environ.get('METEORA_CHECK'):
        for group in F.floating(parts):
            C.log(f'  FLOATING in {name}: {group}')
        for part, holes, vol in F.open_or_inverted(parts):
            C.log(f'  OPEN OR INVERTED in {name}: {part} ({holes} open edges, volume {vol})')
    hull = C.join(parts, 'hull')
    t1 = time.time()
    F.bake_object(hull, name, spec['tex'], bevel=spec['bevel'], sharp=spec['sharp'], samples=spec['samples'],
                  uv_shape=spec.get('uv_shape', 'CONCAVE'))
    t2 = time.time()
    for b, _ in turret_records:
        b.parent = hull
        b.matrix_parent_inverse = Matrix()
    t3 = time.time()
    if spec.get('colliders'):
        cfg = spec['colliders']
        spheres, _ = F.fit_colliders([hull] + turret_objs, **cfg)
        for i, (c, r) in enumerate(spheres):
            empties.append(F.marker(f'col_{i:02d}', c, scale=round(r, 2), display='SPHERE', size=1.0))
    for e in empties:
        e.parent = hull
        e.matrix_parent_inverse = Matrix()
    meshes = [hull] + turret_objs
    tris = C.tri_count(hull) + sum(C.tri_count(o) for o in turret_objs)
    C.log(f'  {name}: {tris} tris (hull {C.tri_count(hull)})')
    t4 = time.time()
    C.export_glb(os.path.join(C.MODELS, name + '.glb'), meshes + empties + muzzles)
    t5 = time.time()
    data = F.anchors_of(meshes, empties, turret_records, spec['nozzle_size'], spec['lights'], spec.get('nodes'))
    F.write_anchors(name, data)
    C.log(f'  {name} timing: join {t1 - t0:.0f} s, unwrap+bake {t2 - t1:.0f} s, colliders {t4 - t3:.0f} s, '
          f'export {t5 - t4:.0f} s, anchors {time.time() - t5:.0f} s')
    return data


MODELS = [
    ('mite', build_mite),
    ('talon', build_talon),
    ('warden', build_warden),
    ('halberd', build_halberd),
]


def main(only=None):
    for name, build in MODELS:
        if only and name not in only:
            continue
        C.reset(samples=8)
        C.log('model', name)
        assemble(name, build())


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
