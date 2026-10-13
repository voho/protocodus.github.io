"""Meteora — the Perpetua: the belt's three-hundred-year-old generation ship,
now carrier, dockyard and hospital (perpetua.glb, js/anchors/perpetua.js).

About 1,420 m from the dust shield to the nozzle exits, modelled in Blender
space with the nose along +Y and the top along +Z (the glTF exporter
delivers it nose along three.js -Z). From bow to stern:

  * the dust shield: a scorched, patched, layered lens 400 m across (as wide
    as the ring it shields), ribbed behind, on a strutted neck;
  * the command section: an octagonal drum with deck windows, an
    observation gallery, the bridge tower and mast, a high-gain dish and
    two lifeboat shuttles docked on its flanks;
  * a square truss spine with cargo containers;
  * the hangar module: a block round the spine with a lit bay mouth in its
    belly (two shuttles parked inside) and PERPETUA on both flanks;
  * six cylindrical fuel tanks bound by two hoops (one is a mismatched
    replacement);
  * the habitat ring (r 175 m), a separate node `ring` that turns about the
    spine inside four bearing yokes carried on static spokes;
  * eight spherical tanks, then bare truss with two radiator wings;
  * the thrust plate and three fusion engines (exit radius 35 m).

Two texture sets: `hull` (2048) and `ring` (1024). Repeated parts — the
ring's quadrants, the shield's back sectors, the spokes and yokes, the
tanks, the engines and the mirrored radiator wing — are baked once and
copied afterwards with the master's UVs (perpetua_parts.apply_instances), so
the texels go to unique surfaces. The ring arcs and the shield's front carry
their own seam-free UVs. Turrets are separate nodes with plain glTF factor
materials.

Anchors are empties: col_* (compound colliders: the ring's are evenly
spaced, so they hold at any spin angle; the rest are fitted greedily to the
hull with a bounded bulge), sub_*, bay_0, nozzle_0..2 and light_*; the
turrets are mesh nodes turret_NN (yaw, local +Z up) with a child
turret_NN_gun (pitch, barrels along local +Y). After export they are
written to js/anchors/perpetua.js in glTF space.

  Blender --background --factory-startup --python build_perpetua.py [-- perpetua]

Set METEORA_FAST=1 for quick geometry iterations (tiny textures, 1 sample).
"""
import bpy, bmesh, math, os, random, sys, time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S
import perpetua_parts as PP

FAST = bool(os.environ.get('METEORA_FAST'))
NAME = 'perpetua'

lin = S.lin
OFF = lin('#d9d6cf')
IVORY = lin('#d2ccbf')
TEAL = lin('#2e6f8e')
TEAL_F = lin('#467f97')          # faded mission teal
TEAL_P = lin('#6d97a6')          # worn through to primer
GRAPHITE = lin('#2b2d31')
RUST = lin('#b8652a')
HAZARD = lin('#d9a21b')
BARE = lin('#8e9092')
DIRT = (0.42, 0.38, 0.33)
SOOT = (0.014, 0.012, 0.011)
GLASS = (0.02, 0.024, 0.03)
# replacement plates: fresh off-white, warm grey, cool grey, red-oxide primer, bare
REPL = [(0.0, lin('#ebe9e1')), (0.36, lin('#a69f94')), (0.58, lin('#8d959b')), (0.77, lin('#7b4737')),
        (0.9, lin('#8f9193'))]
GREEBLE = [(0.0, OFF), (0.38, lin('#c4c0b6')), (0.62, lin('#9c9b98')), (0.8, lin('#6b6e72')), (0.93, GRAPHITE)]

# ==========================================================================
# Layout (Blender space, metres)

APEX = 712.0            # dust-shield front apex before the layered steps
DISH_R = 172.0          # rim radius: the shield covers the ring and its yokes
DISH_RC = 390.0         # front cap radius of curvature
LAYERS = ((112.0, 2.5), (156.0, 0.0))  # outer radius, rise of each layer: a raised inner disc, then the lip
BOSS = 30.0             # the nose boss at the centre (radius)
CMD = (470.0, 612.0)    # command drum
CMD_R = 46.0            # drum flat radius
FWD = (340.0, 478.0)    # forward truss (exposed between the hangar and the drum)
HANGAR = (176.0, 350.0)
BAY_X, BAY_Y, BAY_DEPTH = 34.0, (194.0, 332.0), 38.0  # the bay in the hangar's belly: half width, y span, depth
TANK_A = (44.0, 166.0)  # six capsule tanks
TANK_A_AXIS, TANK_A_R = 44.0, 19.5
RING_Y, RING_R = -15.0, 150.0
RING_HY, RING_HR, RING_RC = 20.0, 14.0, 6.0     # ring section: half width (axial), half height (radial), corner
YOKE_IN, YOKE_OUT = 4.0, 7.5                    # yoke clearance and wall
HUB = (-46.0, 16.0)
TANK_B_BIG = (-112.0, 50.0, 34.0)               # y, axis distance, radius
TANK_B_SMALL = (-190.0, 42.0, 26.0)
AFT = (-478.0, -40.0)   # aft truss
PUMP = (-264.0, -224.0) # the pump house on the aft truss, ahead of the radiator roots
RAD = (-440.0, -270.0)  # radiator wings (y), two layers of panels from x 31 to RAD_TIP
RAD_TIP = 110.0
ENG_R = 46.0
ENG_PHI = (90.0, 210.0, 330.0)
THROAT_Y, EXIT_Y = -606.0, -700.0
THROAT_R, EXIT_R = 11.8, 35.0
TRUSS = 16.0

# instancing groups (faces copied after the bake)
G_RING, G_SPOKE, G_TANK_A, G_SPH_BIG, G_SPH_SMALL, G_RAD, G_ENGINE, G_DISH = 1, 2, 3, 4, 5, 6, 7, 8
# vertex-report categories
CATS = {1: 'dish', 2: 'neck', 3: 'command', 4: 'forward', 5: 'hangar', 6: 'tanks A', 7: 'hub+spokes',
        8: 'tanks B', 9: 'aft truss', 10: 'radiators', 11: 'stern+engines', 12: 'sponsons+lamps', 20: 'ring'}


def yb(r):
    """The dish's base front surface (before the layered steps)."""
    return APEX - (DISH_RC - math.sqrt(DISH_RC ** 2 - r * r))


RIM_BACK = yb(DISH_R) - 26.0                            # the rim is a 26 m bumper
DISH_BACK = [(0.0, 640.0), (28.0, 640.8), (34.0, 642.0), (60.0, 642.8), (100.0, 643.8), (140.0, 645.0),
             (168.0, RIM_BACK)]                          # (r, y), centre outward


def back_y(r):
    for (r0, y0), (r1, y1) in zip(DISH_BACK, DISH_BACK[1:]):
        if r0 <= r <= r1:
            return y0 + (y1 - y0) * (r - r0) / (r1 - r0)
    return DISH_BACK[-1][1]


def rise(r):
    for edge, h in LAYERS:
        if r < edge:
            return h
    return 0.0


def bell_r(y):
    t = min(1.0, max(0.0, (THROAT_Y - y) / (THROAT_Y - EXIT_Y)))
    return THROAT_R + (EXIT_R - THROAT_R) * t ** 0.62


polar = PP.polar
about_y = PP.about_y


# ==========================================================================
# Paint: procedural source materials at Perpetua scale

def grey(g, s):
    return g.combine(s, s, s)


def cylmap(g, P, cx=0.0, cz=0.0):
    """(angle from +X toward +Z, radius, y) about an axis parallel to Y."""
    x, y, z = g.sep(P)
    dx, dz = g.sub(x, cx), g.sub(z, cz)
    return g.math('ARCTAN2', dz, dx), g.vmath('LENGTH', g.combine(dx, 0.0, dz), out=1), y


def tiles(g, u, v, w, h, mortar, shift=0.0):
    """Running-bond plates w x h metres on (u, v): (mortar mask, per-plate random)."""
    n = g.node('ShaderNodeTexBrick', offset=0.5, squash=1.0, offset_frequency=2, squash_frequency=1)
    s = 1.0 / w
    g.feed(n.inputs['Vector'], g.combine(g.mul(g.add(u, shift), s), g.mul(g.add(v, shift * 0.37), s), 0.0))
    for k, val in (('Scale', 1.0), ('Mortar Size', mortar * s), ('Mortar Smooth', 0.35), ('Bias', 0.0),
                   ('Brick Width', 1.0), ('Row Height', h * s), ('Color1', (0.0, 0.0, 0.0)),
                   ('Color2', (1.0, 1.0, 1.0)), ('Mortar', (0.0, 0.0, 0.0))):
        g.feed(n.inputs[k], val)
    rnd = g.node('ShaderNodeSeparateColor', [n.outputs['Color']]).outputs[0]
    return n.outputs['Factor'], rnd


def triplanar(g, P, N, fn):
    """Blend fn(u, v, shift) over the dominant normal axis: plates run
    along the ship on top, bottom and sides."""
    x, y, z = g.sep(P)
    nx, ny, nz = (g.absolute(c) for c in g.sep(N))
    top, side, front = fn(y, x, 0.31), fn(y, z, 0.17), fn(x, z, 0.53)
    wz = g.mul(g.math('GREATER_THAN', nz, nx), g.math('GREATER_THAN', nz, ny))
    wx = g.mul(g.sub(1.0, wz), g.math('GREATER_THAN', nx, ny))
    wy = g.sub(g.sub(1.0, wz), wx)
    return tuple(g.add(g.add(g.mul(wz, a), g.mul(wx, b)), g.mul(wy, c)) for a, b, c in zip(top, side, front))


def grid(g, u, v, pu, pv, wu, wv, seed=0.0):
    """Rectangles wu x wv on a pu x pv pitch: (mask, per-cell random)."""
    su, sv = g.mul(u, 1.0 / pu), g.mul(v, 1.0 / pv)
    hu, hv = wu / pu / 2, wv / pv / 2
    mu = g.sub(1.0, g.smooth(g.absolute(g.sub(g.math('FRACT', su), 0.5)), hu - 0.035, hu))
    mv = g.sub(1.0, g.smooth(g.absolute(g.sub(g.math('FRACT', sv), 0.5)), hv - 0.035, hv))
    wn = g.node('ShaderNodeTexWhiteNoise', noise_dimensions='3D')
    g.feed(wn.inputs['Vector'], g.combine(g.math('FLOOR', su), g.math('FLOOR', sv), seed))
    return g.mul(mu, mv), wn.outputs['Value']


def band(g, v, lo, hi, soft=0.4):
    return S.band(g, v, lo, hi, soft)


def lit_windows(g, mask, rnd, share=0.68, warm=(0.95, 0.6, 0.27), cool=(0.55, 0.62, 0.8)):
    """Window glow: most windows lit, warm with a few cool ones, varied."""
    lit = g.mul(mask, g.math('LESS_THAN', rnd, share))
    tone = g.mix(g.math('GREATER_THAN', g.math('FRACT', g.mul(rnd, 7.7)), 0.84), warm, cool)
    level = g.madd(g.math('FRACT', g.mul(rnd, 3.1)), 0.55, 0.45)
    return g.mix(1.0, tone, grey(g, g.mul(lit, level)), 'MULTIPLY')


def plating(g, P, N, base, uv=None, plate=(8.0, 4.0), section=(32.0, 16.0), repl=0.075, teal=None,
            rough=0.58, metal=0.05, glow=None, paint=None, wear=1.0, grime=1.0, ao=18.0, pal=REPL,
            lines=1.0):
    """Aged plating at Perpetua scale: two levels of plates (sections and
    plates) with per-plate tint, mismatched replacement plates (a palette of
    fresh paint, greys, primer and bare metal), faded teal bands that skip
    the replaced plates, broad colour drift, AO grime and aft streaks, and
    chipped edges. `paint(col)` adds markings before the grime."""
    if uv is None:
        l1, r1 = triplanar(g, P, N, lambda u, v, s: tiles(g, u, v, section[0], section[1], 0.45, s))
        l2, r2 = triplanar(g, P, N, lambda u, v, s: tiles(g, u, v, plate[0], plate[1], 0.2, s * 1.9))
    else:
        u, v = uv
        l1, r1 = tiles(g, u, v, section[0], section[1], 0.45, 0.0)
        l2, r2 = tiles(g, u, v, plate[0], plate[1], 0.2, 0.37)
    tint = g.mul(g.madd(r2, 0.08, 0.955), g.madd(r1, 0.05, 0.975))
    big = g.noise(P, 1.0 / 170.0, 3.0, 0.5)
    tint = g.mul(tint, g.madd(big, 0.12, 0.94))
    col = g.mix(1.0, base, grey(g, tint), 'MULTIPLY')
    col = g.mix(g.mul(g.smooth(big, 0.55, 0.75), 0.25), col, IVORY)
    rep = g.math('GREATER_THAN', r2, 1.0 - repl)
    if teal is not None:
        fade = g.noise(P, 1.0 / 11.0, 3.0, 0.6)
        teal_col = g.mix(g.smooth(fade, 0.38, 0.72), TEAL_F, TEAL_P)
        col = g.mix(g.mul(teal, g.sub(1.0, rep)), col, teal_col)
    idx = g.math('FRACT', g.mul(r2, 13.37))
    col = g.mix(rep, col, g.ramp(idx, pal, interp='CONSTANT'))
    bare = g.mul(rep, g.math('GREATER_THAN', idx, 0.9))
    if paint is not None:
        col = paint(col)
    ao_n = g.node('ShaderNodeAmbientOcclusion', [None, ao], samples=10, only_local=False).outputs['AO']
    streak = g.smooth(g.noise(g.vmath('MULTIPLY', P, (1 / 14.0, 1 / 240.0, 1 / 14.0)), 1.0, 4.0, 0.6), 0.48, 0.8)
    dirt = g.mul(g.minimum(g.add(g.mul(g.sub(1.0, ao_n), 0.9), g.mul(streak, 0.3)), 1.0), grime)
    col = g.mix(g.mul(dirt, 0.7), col, DIRT, 'MULTIPLY')
    col = g.mix(g.mul(g.add(g.mul(l1, 0.5), g.mul(l2, 0.22)), lines), col, (0.07, 0.07, 0.075))
    bev = g.node('ShaderNodeBevel', [0.5], samples=6).outputs[0]
    edge = g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1))
    chips = g.mul(g.smooth(edge, 0.04, 0.14), g.smooth(g.noise(P, 1.0 / 3.0, 3.0, 0.6), 0.42, 0.6))
    col = g.mix(g.mul(chips, 0.75 * wear), col, BARE)
    rgh = g.mixf(rep, rough, 0.47)
    rgh = g.mixf(bare, rgh, 0.36)
    rgh = g.mixf(g.mul(streak, 0.35), rgh, 0.74)
    mtl = g.mixf(bare, metal, 0.85)
    h = g.add(g.mul(l1, -0.12 * lines), g.mul(l2, -0.05 * lines))
    h = g.add(h, g.mul(rep, 0.03))
    return dict(albedo=col, rough=rgh, metal=mtl, normal=g.bump(h, 1.0, 1.0), glow=glow)


def simple_glow(name, colour, albedo=(0.05, 0.05, 0.05)):
    return S.material(name, lambda g, P, N: dict(albedo=albedo, rough=0.3, metal=0.0, glow=colour))


def stencil_sampler(g, img, u, v):
    """Sample a stencil mask image at (u, v) in [0, 1] (0 outside)."""
    t = g.node('ShaderNodeTexImage', image=img, interpolation='Closest', extension='CLIP')
    g.feed(t.inputs['Vector'], g.combine(u, v, 0.0))
    return g.node('ShaderNodeSeparateColor', [t.outputs['Color']]).outputs[0]


def materials():
    M = {}
    name_img = PP.mask_image('stencil_name', PP.stencil('PERPETUA', cell=10, gap=1))

    # --- dust shield: scorched ablative tiles in rings on the front, plating behind
    def dish(g, P, N):
        x, y, z = g.sep(P)
        ny = g.sep(N)[1]
        rad = g.vmath('LENGTH', g.combine(x, 0.0, z), out=1)
        ang = g.math('ARCTAN2', x, z)                       # seam at the bottom
        front = g.smooth(ny, 0.0, 0.35)
        inner = g.sub(1.0, g.smooth(rad, LAYERS[0][0] - 0.5, LAYERS[0][0] + 0.5))
        # petal tiling: 24 tiles round the inner disc, 60 round the outer ring, rows of 13 m
        u = g.mixf(inner, g.mul(ang, 60 * 14.0 / (2 * math.pi)), g.mul(ang, 24 * 14.0 / (2 * math.pi)))
        line, rnd = tiles(g, u, rad, 14.0, 13.0, 0.4, 0.0)
        col = g.mix(1.0, IVORY, grey(g, g.madd(rnd, 0.12, 0.9)), 'MULTIPLY')
        streaks = g.noise(g.combine(g.mul(ang, 9.0), g.mul(rad, 0.015), 0.0), 2.0, 4.0, 0.6)
        radial = g.smooth(g.noise(g.combine(g.mul(ang, 26.0), g.mul(rad, 0.004), 0.0), 3.0, 3.0, 0.5), 0.5, 0.75)
        # patched regions: whole blocks of newer (and a few older, darker) tiles
        _, region = tiles(g, u, rad, 42.0, 39.0, 0.0, 0.73)
        newer = g.math('GREATER_THAN', region, 0.8)
        older = g.math('LESS_THAN', region, 0.12)
        scorch = g.smooth(g.add(rad, g.mul(streaks, 55.0)), 172.0, 18.0)
        scorch = g.minimum(g.add(scorch, g.mul(g.mul(radial, 0.8), g.sub(1.0, g.smooth(rad, 125.0, 168.0)))), 1.0)
        scorch = g.mul(scorch, g.sub(1.0, g.mul(newer, 0.6)))
        heat = g.mul(band(g, g.add(rad, g.mul(streaks, 25.0)), 55.0, 140.0, 14.0), 0.6)
        col = g.mix(g.mul(newer, 0.85), col, lin('#dcd8cd'))
        col = g.mix(g.mul(older, 0.7), col, lin('#8d867b'))
        col = g.mix(heat, col, (0.26, 0.19, 0.13))
        col = g.mix(g.mul(scorch, 0.94), col, (0.036, 0.031, 0.027))
        boss = g.sub(1.0, g.smooth(rad, BOSS - 2.0, BOSS + 1.0))
        col = g.mix(g.mul(boss, 0.85), col, (0.03, 0.03, 0.032))
        pits = g.smooth(g.voronoi(P, 1.0 / 6.5, out='Distance'), 0.2, 0.06)
        pits = g.mul(pits, g.smooth(g.noise(P, 1.0 / 34.0, 2.0), 0.42, 0.6))
        col = g.mix(g.mul(pits, 0.75), col, (0.018, 0.016, 0.014))
        new = g.math('GREATER_THAN', rnd, 0.9)
        old = g.mul(g.math('GREATER_THAN', rnd, 0.82), g.sub(1.0, new))
        col = g.mix(old, col, g.mix(g.mul(scorch, 0.8), lin('#a49c8f'), lin('#4f4840')))
        col = g.mix(new, col, g.mix(g.mul(scorch, 0.35), lin('#e9e6de'), lin('#8e8a82')))
        lip = band(g, rad, 157.0, 170.5, 0.5)
        col = g.mix(g.mul(lip, g.sub(1.0, g.mul(scorch, 0.5))), col, TEAL_F)
        col = g.mix(g.mul(line, 0.65), col, (0.03, 0.028, 0.026))
        # behind: plating with a teal ring band
        bline, brnd = tiles(g, g.mul(ang, g.maximum(rad, 10.0)), rad, 18.0, 12.0, 0.4, 0.21)
        bcol = g.mix(1.0, OFF, grey(g, g.madd(brnd, 0.08, 0.94)), 'MULTIPLY')
        bcol = g.mix(band(g, rad, 125.0, 133.0, 0.5), bcol, TEAL_F)
        bcol = g.mix(g.math('GREATER_THAN', brnd, 0.92), bcol, g.ramp(g.math('FRACT', g.mul(brnd, 11.0)), REPL, 'CONSTANT'))
        bcol = g.mix(g.mul(bline, 0.5), bcol, (0.07, 0.07, 0.075))
        col = g.mix(front, bcol, col)
        ao_n = g.node('ShaderNodeAmbientOcclusion', [None, 16.0], samples=10, only_local=False).outputs['AO']
        col = g.mix(g.mul(g.sub(1.0, ao_n), 0.7), col, DIRT, 'MULTIPLY')
        rgh = g.mixf(front, 0.55, g.mixf(scorch, 0.6, 0.86))
        rgh = g.mixf(new, rgh, 0.5)
        h = g.add(g.mul(line, -0.16), g.mul(pits, -0.3))
        h = g.add(h, g.mul(g.mul(new, front), 0.06))
        return dict(albedo=col, rough=rgh, metal=g.mixf(front, 0.08, g.mixf(boss, 0.03, 0.4)), normal=g.bump(h, 1.0, 1.0))
    M['dish'] = S.material('p_dish', dish)

    # --- command drum, neck and tower: deck windows, teal bands, the programme emblem
    def cmd(g, P, N):
        ang, rad, y = cylmap(g, P)
        x, _, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        arc = g.mul(ang, CMD_R)
        side = g.smooth(g.absolute(ny), 0.6, 0.3)
        win, wr = grid(g, arc, y, 4.6, 6.0, 2.2, 1.5, 3.0)
        decks = g.add(band(g, y, 489.0, 534.0, 0.3), band(g, y, 561.0, 596.0, 0.3))
        decks = g.mul(g.mul(decks, side), g.math('LESS_THAN', rad, 47.5))
        teal = g.mul(g.add(band(g, y, 568.0, 582.0, 0.3), band(g, y, 560.5, 562.5, 0.2)), side)
        teal = g.add(teal, g.mul(band(g, y, 600.0, 607.0, 0.3), g.math('LESS_THAN', rad, 40.0)))
        emb_d = g.vmath('LENGTH', g.combine(g.sub(y, 522.0), z, 0.0), out=1)
        flank = g.mul(g.smooth(g.absolute(nx), 0.85, 0.95), g.math('GREATER_THAN', g.absolute(x), 40.0))
        emblem = g.mul(flank, g.add(band(g, emb_d, 7.0, 9.5, 0.25), g.smooth(emb_d, 4.2, 3.6)))
        win = g.mul(g.mul(win, decks), g.sub(1.0, g.mul(flank, g.smooth(emb_d, 13.0, 11.0))))

        def paint(col):
            col = g.mix(win, col, GLASS)
            return g.mix(emblem, col, TEAL)
        return plating(g, P, N, OFF, uv=(arc, y), plate=(7.0, 4.0), section=(28.0, 12.0), teal=teal,
                       glow=lit_windows(g, win, wr, 0.7), paint=paint)
    M['cmd'] = S.material('p_cmd', cmd)

    def gallery(g, P, N):
        ang, rad, y = cylmap(g, P)
        arc = g.mul(ang, 48.6)
        band_ = g.mul(g.math('GREATER_THAN', rad, 48.0), band(g, y, 541.0, 555.0, 0.2))
        mull = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(arc, 1 / 3.2)), 0.5)), 0.36, 0.42)
        rail = band(g, y, 547.6, 548.4, 0.15)
        win = g.mul(g.mul(band_, g.sub(1.0, mull)), g.sub(1.0, rail))
        rnd = g.noise(g.mul(arc, 0.05), 1.0, 2.0)
        level = g.madd(g.smooth(rnd, 0.3, 0.7), 0.6, 0.4)
        glow = g.mix(1.0, (0.95, 0.66, 0.32), grey(g, g.mul(win, level)), 'MULTIPLY')
        col = g.mix(win, (0.18, 0.18, 0.19), GLASS)
        return dict(albedo=col, rough=g.mixf(win, 0.5, 0.08), metal=0.3, glow=glow)
    M['gallery'] = S.material('p_gallery', gallery)

    def bridge(g, P, N):
        x, y, z = g.sep(P)
        nz = g.sep(N)[2]
        side = g.smooth(g.absolute(nz), 0.5, 0.2)
        u = g.add(x, y)
        mull = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(u, 1 / 2.6)), 0.5)), 0.38, 0.44)
        win = g.mul(side, g.sub(1.0, mull))
        glow = g.mix(1.0, (0.98, 0.78, 0.45), grey(g, g.mul(win, 0.9)), 'MULTIPLY')
        return dict(albedo=g.mix(win, (0.12, 0.12, 0.13), GLASS), rough=g.mixf(win, 0.5, 0.06), metal=0.3, glow=glow)
    M['bridge'] = S.material('p_bridge', bridge)

    def strip(g, P, N):
        x, y, z = g.sep(P)
        u = g.add(g.add(x, y), z)
        mull = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(u, 1 / 1.7)), 0.5)), 0.3, 0.38)
        lit = g.mul(g.sub(1.0, mull), g.math('LESS_THAN', g.noise(g.mul(u, 0.3), 1.0, 1.0), 0.62))
        glow = g.vmath('SCALE', (0.95, 0.7, 0.38), None, scale=lit)
        return dict(albedo=g.mix(lit, (0.1, 0.1, 0.11), GLASS), rough=0.2, metal=0.2, glow=glow)
    M['strip'] = S.material('p_strip', strip)

    # --- hangar module: plating, PERPETUA in teal on both flanks, a teal band, windows
    def hangar(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        flank = g.smooth(g.absolute(nx), 0.9, 0.97)
        stb = g.math('GREATER_THAN', x, 0.0)
        u0 = g.mul(g.sub(y, 199.0), 1 / 128.0)
        u = g.mixf(stb, g.sub(1.0, u0), u0)            # reads aft to fore on starboard, fore to aft on port
        v = g.mul(g.sub(z, -27.0), 1 / 19.0)
        letters = g.mul(stencil_sampler(g, name_img, u, v), flank)
        teal = g.add(g.mul(band(g, y, 318.0, 332.0, 0.3), g.smooth(g.absolute(ny), 0.6, 0.3)),
                     g.mul(band(g, z, -35.0, -32.0, 0.2), flank))
        win, wr = grid(g, y, z, 5.0, 6.0, 2.4, 1.4, 7.0)
        rows = g.add(band(g, z, 6.0, 17.0, 0.2), band(g, z, -66.0, -55.0, 0.2))
        win = g.mul(g.mul(win, rows), flank)
        win = g.mul(win, g.math('LESS_THAN', g.absolute(g.sub(y, 263.0)), 82.0))

        def paint(col):
            col = g.mix(g.mul(letters, g.smooth(g.noise(P, 1 / 4.0, 3.0), 0.25, 0.4)), col, TEAL)
            return g.mix(win, col, GLASS)
        return plating(g, P, N, OFF, plate=(9.0, 4.5), section=(36.0, 18.0), teal=teal, paint=paint,
                       glow=lit_windows(g, win, wr, 0.62))
    M['hangar'] = S.material('p_hangar', hangar)

    def hangar_in(g, P, N):
        x, y, z = g.sep(P)
        ceil = g.smooth(g.sep(N)[2], -0.5, -0.8)
        panels, prnd = grid(g, x, y, 12.0, 10.0, 7.0, 4.0, 5.0)
        strips = g.add(band(g, z, -58.0, -57.0, 0.15), band(g, z, -70.0, -69.0, 0.15))
        strips = g.add(strips, band(g, z, -82.0, -81.2, 0.15))
        wall = g.sub(1.0, ceil)
        ribs = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(g.add(x, y), 1 / 12.0)), 0.5)), 0.44, 0.47)
        light = g.add(g.mul(ceil, g.mul(panels, g.math('LESS_THAN', prnd, 0.9))), g.mul(wall, strips))
        col = g.mix(ribs, (0.2, 0.2, 0.21), (0.05, 0.05, 0.055))
        col = g.mix(light, col, (0.9, 0.88, 0.82))
        glow = g.vmath('ADD', g.vmath('SCALE', (0.95, 0.85, 0.66), None, scale=light), (0.035, 0.032, 0.028))
        return dict(albedo=col, rough=0.6, metal=0.2, glow=glow)
    M['hangar_in'] = S.material('p_hangar_in', hangar_in)

    def hazard_frame(g, P, N):
        x, y, z = g.sep(P)
        stripes = S.hazard(g, g.mul(x, 0.25), g.mul(y, 0.25), 0.5)
        inner = g.minimum(g.sub(BAY_X + 0.5, g.absolute(x)),
                          g.sub((BAY_Y[1] - BAY_Y[0]) / 2 + 0.5, g.absolute(g.sub(y, (BAY_Y[0] + BAY_Y[1]) / 2))))
        edge = g.smooth(inner, 3.5, 2.0)
        col = g.mix(g.mul(edge, stripes), OFF, HAZARD)
        col = g.mix(g.mul(edge, g.sub(1.0, stripes)), col, (0.03, 0.03, 0.03))
        dots, drnd = grid(g, g.add(x, y), z, 8.0, 50.0, 1.4, 60.0, 9.0)
        lamp = g.mul(dots, g.smooth(inner, 1.2, 0.6))
        green = g.math('LESS_THAN', drnd, 0.7)
        glow = g.mix(green, (0.9, 0.9, 0.85), (0.15, 0.95, 0.35))
        glow = g.vmath('SCALE', glow, None, scale=lamp)
        return plating(g, P, N, col, plate=(6.0, 6.0), section=(24.0, 24.0), repl=0.02, glow=glow, wear=1.6)
    M['hazard'] = S.material('p_hazard', hazard_frame)

    def patch(g, P, N):
        t = g.attribute('tint')
        col = g.ramp(t, [(0.0, lin('#ebe8df')), (0.3, lin('#b9b3a6')), (0.55, lin('#8a9196')), (0.75, lin('#7a4a3b')),
                         (0.88, lin('#cfc9ba'))], interp='CONSTANT')
        return plating(g, P, N, col, plate=(6.0, 3.0), section=(18.0, 9.0), repl=0.12, wear=1.4)
    M['patch'] = S.material('p_patch', patch)

    def greeble(g, P, N):
        col = g.ramp(g.attribute('tint'), GREEBLE, interp='CONSTANT')
        return plating(g, P, N, col, plate=(5.0, 2.5), section=(15.0, 7.5), repl=0.1, metal=0.15, wear=1.4,
                       lines=0.6)
    M['greeble'] = S.material('p_greeble', greeble)

    def frame(g, P, N):
        t = g.attribute('tint')
        col = g.mix(g.smooth(t, 0.7, 0.72), GRAPHITE, lin('#4a4d52'))
        col = g.mix(g.smooth(g.noise(P, 1 / 25.0, 3.0), 0.55, 0.75), col, lin('#3a3530'))
        ao_n = g.node('ShaderNodeAmbientOcclusion', [None, 12.0], samples=8, only_local=False).outputs['AO']
        col = g.mix(g.mul(g.sub(1.0, ao_n), 0.6), col, DIRT, 'MULTIPLY')
        bev = g.node('ShaderNodeBevel', [0.35], samples=6).outputs[0]
        edge = g.smooth(g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1)), 0.05, 0.16)
        col = g.mix(g.mul(edge, 0.5), col, BARE)
        return dict(albedo=col, rough=0.52, metal=0.55)
    M['frame'] = S.material('p_frame', frame)

    def cargo(g, P, N):
        t = g.attribute('tint')
        col = g.ramp(t, [(0.0, RUST), (0.3, lin('#a8822f')), (0.48, TEAL), (0.62, lin('#7c8084')),
                         (0.78, lin('#cfcabe')), (0.9, lin('#6c2d25'))], interp='CONSTANT')
        x, y, z = g.sep(P)
        ny = g.absolute(g.sep(N)[1])
        ribs = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(g.add(y, g.add(x, z)), 1 / 2.4)), 0.5)), 0.3, 0.45)
        ends = g.smooth(ny, 0.8, 0.9)
        col = g.mix(g.mul(ribs, 0.25), col, (0.0, 0.0, 0.0), 'MULTIPLY')
        marks, mrnd = grid(g, y, g.add(x, z), 7.0, 5.0, 3.0, 1.2, 4.0)
        col = g.mix(g.mul(g.mul(marks, g.math('LESS_THAN', mrnd, 0.35)), g.sub(1.0, ends)), col, lin('#e9e5d8'))
        return plating(g, P, N, col, plate=(10.0, 5.0), section=(21.0, 10.0), repl=0.03, wear=1.6,
                       lines=0.3, rough=0.62, metal=0.2)
    M['cargo'] = S.material('p_cargo', cargo)

    # --- tanks: capsules (cluster A) and spheres (cluster B)
    def tank_paint(cx, cz, ends, mid, base=OFF, teal_on=True, primer=False):
        def build(g, P, N):
            ang, rad, y = cylmap(g, P, cx, cz)
            arc = g.mul(ang, TANK_A_R)
            teal = None
            if teal_on:
                teal = g.add(band(g, y, ends[0][0], ends[0][1], 0.3), band(g, y, ends[1][0], ends[1][1], 0.3))
            dark = band(g, y, mid[0], mid[1], 0.3)
            marks, mrnd = grid(g, arc, y, 9.0, 30.0, 4.0, 2.2, 2.0)
            marks = g.mul(marks, g.math('LESS_THAN', mrnd, 0.5))

            def paint(col):
                col = g.mix(dark, col, GRAPHITE)
                col = g.mix(g.mul(marks, 0.85), col, (0.06, 0.06, 0.065))
                if primer:
                    patchy = g.smooth(g.noise(P, 1 / 18.0, 3.0, 0.6), 0.5, 0.62)
                    col = g.mix(patchy, col, lin('#7b4737'))
                    haz = band(g, y, 126.0, 134.0, 0.2)
                    col = g.mix(haz, col, g.mix(S.hazard(g, arc, y, 1.6), (0.03, 0.03, 0.03), HAZARD))
                return col
            return plating(g, P, N, base, uv=(arc, y), plate=(7.5, 5.0), section=(22.0, 15.0), teal=teal,
                           paint=paint, repl=0.06)
        return build
    a_axis = polar(TANK_A_AXIS, 90.0, 0.0)
    o_axis = polar(TANK_A_AXIS, 270.0, 0.0)
    M['tank'] = S.material('p_tank', tank_paint(a_axis.x, a_axis.z, ((150.0, 157.0), (53.0, 60.0)), (103.0, 107.0)))
    M['tank_odd'] = S.material('p_tank_odd', tank_paint(o_axis.x, o_axis.z, ((150.0, 157.0), (53.0, 60.0)),
                                                        (103.0, 107.0), base=lin('#aaa397'), teal_on=False,
                                                        primer=True))

    def sphere_paint(cx, cy, cz, R):
        def build(g, P, N):
            ang, rad, y = cylmap(g, P, cx, cz)
            arc = g.mul(ang, R)
            teal = band(g, y, cy - 5.0, cy + 5.0, 0.3)
            polecap = g.smooth(g.absolute(g.sub(y, cy)), R * 0.86, R * 0.9)
            return plating(g, P, N, OFF, uv=(arc, y), plate=(7.0, 5.0), section=(21.0, 15.0), teal=teal,
                           paint=lambda col: g.mix(polecap, col, lin('#9a9488')))
        return build
    big = polar(TANK_B_BIG[1], 45.0, 0.0)
    small = polar(TANK_B_SMALL[1], 0.0, 0.0)
    M['sphere_big'] = S.material('p_sphere_big', sphere_paint(big.x, TANK_B_BIG[0], big.z, TANK_B_BIG[2]))
    M['sphere_small'] = S.material('p_sphere_small', sphere_paint(small.x, TANK_B_SMALL[0], small.z, TANK_B_SMALL[2]))

    # --- hub, bearings, thrust plate: plating about the ship axis
    def axial(g, P, N):
        ang, rad, y = cylmap(g, P)
        arc = g.mul(ang, 50.0)
        side = g.smooth(g.absolute(g.sep(N)[1]), 0.6, 0.3)
        teal = g.add(g.add(band(g, y, -486.0, -476.0, 0.3), band(g, y, -10.0, -2.0, 0.3)),
                     band(g, y, PUMP[0] + 14.0, PUMP[0] + 22.0, 0.3))
        teal = g.mul(teal, side)
        haz = g.mul(band(g, y, -470.5, -467.0, 0.2), side)
        hub = g.mul(g.mul(band(g, y, HUB[0] + 9.0, HUB[1] - 9.0, 0.2), band(g, rad, 49.0, 51.0, 0.3)), side)
        win, wr = grid(g, arc, y, 4.0, 5.5, 2.0, 1.4, 41.0)
        win = g.mul(g.mul(win, hub), g.sub(1.0, band(g, y, -12.0, 0.0, 0.2)))

        def paint(col):
            col = g.mix(haz, col, g.mix(S.hazard(g, arc, y, 2.0), (0.03, 0.03, 0.03), HAZARD))
            return g.mix(win, col, GLASS)
        return plating(g, P, N, OFF, uv=(arc, y), plate=(8.0, 4.0), section=(32.0, 12.0), teal=teal, paint=paint,
                       glow=lit_windows(g, win, wr, 0.72))
    M['axial'] = S.material('p_axial', axial)

    # --- spokes (static; along +X at the master) and their bearing yokes
    def spoke(g, P, N):
        x, y, z = g.sep(P)
        ang = g.math('ARCTAN2', z, g.sub(y, RING_Y))
        arc = g.mul(ang, 6.5)
        teal = g.add(band(g, x, 62.0, 68.0, 0.3), band(g, x, 108.0, 112.0, 0.3))
        haz = band(g, x, 117.0, 121.0, 0.2)
        win, wr = grid(g, g.add(arc, g.mul(y, 0.3)), x, 3.0, 4.0, 1.4, 1.0, 11.0)
        pod = g.mul(band(g, x, 84.0, 96.0, 0.1), g.smooth(g.absolute(g.sep(N)[0]), 0.5, 0.3))
        win = g.mul(win, pod)

        def paint(col):
            col = g.mix(haz, col, g.mix(S.hazard(g, arc, x, 1.2), (0.03, 0.03, 0.03), HAZARD))
            return g.mix(win, col, GLASS)
        return plating(g, P, N, OFF, plate=(6.0, 3.0), section=(18.0, 9.0), teal=teal, paint=paint,
                       glow=lit_windows(g, win, wr, 0.7))
    M['spoke'] = S.material('p_spoke', spoke)

    def yoke(g, P, N):
        ang, rad, y = cylmap(g, P)
        arc = g.mul(ang, RING_R)
        stripes = S.hazard(g, arc, g.add(y, rad), 2.5)
        rim = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(arc, 1 / 27.5)), 0.5)), 0.36, 0.42)
        col = g.mix(rim, lin('#5d6166'), g.mix(stripes, (0.03, 0.03, 0.03), HAZARD))
        lamps, lrnd = grid(g, arc, g.add(y, rad), 5.0, 6.0, 1.2, 1.2, 13.0)
        lamps = g.mul(g.mul(lamps, g.sub(1.0, rim)), g.math('LESS_THAN', lrnd, 0.25))
        glow = g.vmath('SCALE', (1.0, 0.55, 0.12), None, scale=lamps)
        return plating(g, P, N, col, plate=(5.0, 5.0), section=(15.0, 15.0), repl=0.03, metal=0.35,
                       glow=glow, wear=1.6)
    M['yoke'] = S.material('p_yoke', yoke)

    # --- radiators: charcoal panels with lighter heat-pipe ribs, a faint glow at the root
    def radiator(g, P, N):
        x, y, z = g.sep(P)
        ax = g.absolute(x)
        face = g.smooth(g.absolute(g.sep(N)[2]), 0.7, 0.9)
        pipes = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(y, 1 / 2.4)), 0.5)), 0.3, 0.42)
        cells = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(x, 1 / 15.0)), 0.5)), 0.46, 0.48)
        col = g.mix(pipes, (0.07, 0.075, 0.082), (0.035, 0.038, 0.043))
        col = g.mix(g.mul(cells, face), col, (0.16, 0.16, 0.165))
        heat = g.mul(g.smooth(ax, 62.0, 31.0), face)
        heat = g.mul(heat, g.madd(g.noise(g.combine(g.mul(x, 0.03), g.mul(y, 0.4), 0.0), 1.0, 3.0), 0.5, 0.6))
        glow = g.vmath('SCALE', (0.6, 0.22, 0.06), None, scale=g.mul(g.mul(heat, heat), 0.38))
        return plating(g, P, N, col, plate=(15.0, 6.0), section=(30.0, 48.0), repl=0.04, metal=0.5, rough=0.4,
                       glow=glow, lines=0.6, pal=[(0.0, (0.09, 0.092, 0.1)), (0.5, (0.13, 0.12, 0.115))])
    M['radiator'] = S.material('p_radiator', radiator)

    # --- engines: plated bodies, magnet coils with a cyan seam, heat-tinted bells
    e_axis = polar(ENG_R, ENG_PHI[0], 0.0)

    def engine(g, P, N):
        ang, rad, y = cylmap(g, P, e_axis.x, e_axis.z)
        arc = g.mul(ang, 25.0)
        teal = band(g, y, -502.0, -497.0, 0.3)
        dark = g.smooth(y, -592.0, -600.0)
        heat = g.smooth(y, -585.0, -606.0)

        def paint(col):
            col = g.mix(dark, col, lin('#4a4c50'))
            return g.mix(g.mul(heat, 0.6), col, (0.2, 0.14, 0.1))
        return plating(g, P, N, OFF, uv=(arc, y), plate=(6.0, 4.0), section=(18.0, 12.0), teal=teal,
                       paint=paint, metal=0.1)
    M['engine'] = S.material('p_engine', engine)

    def coil(g, P, N):
        ang, rad, y = cylmap(g, P, e_axis.x, e_axis.z)
        outer = g.smooth(rad, 28.0, 28.8)
        # metres from the nearest coil's mid-plane (coils every 30 m from y = -515)
        d = g.mul(g.absolute(g.sub(g.math('FRACT', g.add(g.mul(g.sub(y, -515.0), 1 / 30.0), 0.5)), 0.5)), 30.0)
        seam = g.mul(outer, g.smooth(d, 0.9, 0.4))
        col = g.mix(g.smooth(g.noise(P, 1 / 6.0, 3.0), 0.4, 0.6), lin('#5a4a3a'), lin('#3a312a'))
        ao_n = g.node('ShaderNodeAmbientOcclusion', [None, 8.0], samples=8, only_local=False).outputs['AO']
        col = g.mix(g.mul(g.sub(1.0, ao_n), 0.6), col, DIRT, 'MULTIPLY')
        glow = g.vmath('SCALE', (0.15, 0.55, 0.85), None, scale=g.mul(seam, 0.9))
        return dict(albedo=col, rough=0.4, metal=0.7, glow=glow)
    M['coil'] = S.material('p_coil', coil)

    def bell(g, P, N):
        ang, rad, y = cylmap(g, P, e_axis.x, e_axis.z)
        t = g.map_range(y, THROAT_Y, EXIT_Y, 0.0, 1.0)
        inner_r = g.add(THROAT_R, g.mul(EXIT_R - THROAT_R, g.power(g.maximum(t, 0.0), 0.62)))
        inner = g.sub(1.0, g.smooth(g.sub(rad, inner_r), 0.4, 0.9))
        tint = g.ramp(t, [(0.0, (0.44, 0.31, 0.16)), (0.22, (0.36, 0.24, 0.3)), (0.45, (0.22, 0.24, 0.4)),
                          (0.75, (0.3, 0.3, 0.32)), (1.0, (0.24, 0.24, 0.25))])
        streak = g.noise(g.combine(g.mul(ang, 14.0), g.mul(y, 0.02), 0.0), 2.0, 3.0)
        tint = g.mix(g.mul(g.smooth(streak, 0.45, 0.72), 0.55), tint, (0.07, 0.07, 0.075))
        lip = g.smooth(t, 0.9, 1.0)
        tint = g.mix(g.mul(lip, 0.6), tint, (0.05, 0.05, 0.05))
        col = g.mix(inner, tint, SOOT)
        glow = g.vmath('SCALE', (0.35, 0.62, 1.0), None,
                       scale=g.mul(inner, g.mul(g.smooth(t, 0.35, 0.0), 0.85)))
        ao_n = g.node('ShaderNodeAmbientOcclusion', [None, 10.0], samples=8, only_local=False).outputs['AO']
        col = g.mix(g.mul(g.sub(1.0, ao_n), 0.5), col, DIRT, 'MULTIPLY')
        return dict(albedo=col, rough=g.mixf(inner, 0.36, 0.7), metal=g.mixf(inner, 0.55, 0.2), glow=glow)
    M['bell'] = S.material('p_bell', bell)

    M['throat'] = simple_glow('p_throat', (0.72, 0.86, 1.0), (0.5, 0.6, 0.7))
    M['red'] = simple_glow('p_nav_red', (1.0, 0.06, 0.03), (0.3, 0.02, 0.02))
    M['green'] = simple_glow('p_nav_green', (0.06, 1.0, 0.3), (0.02, 0.3, 0.08))
    M['white'] = simple_glow('p_nav_white', (1.0, 0.97, 0.9), (0.5, 0.5, 0.5))
    M['amber'] = simple_glow('p_amber', (1.0, 0.62, 0.18), (0.4, 0.3, 0.15))

    def shuttle(g, P, N):
        x, y, z = g.sep(P)
        t = g.attribute('tint')
        stripe = g.math('GREATER_THAN', g.math('FRACT', g.mul(g.add(g.add(x, y), g.mul(t, 97.0)), 1 / 9.0)), 0.84)
        stripe = g.mul(stripe, g.smooth(g.noise(P, 1 / 2.0, 2.0), 0.3, 0.4))

        def paint(col):
            return g.mix(stripe, col, HAZARD)
        return plating(g, P, N, OFF, plate=(3.0, 1.5), section=(9.0, 4.5), repl=0.05, paint=paint, lines=0.5)
    M['shuttle'] = S.material('p_shuttle', shuttle)

    # --- the ring: deck windows on the side walls, a skylight band inside, teal
    def ring(g, P, N):
        ang, rad, y = cylmap(g, P)
        x, _, z = g.sep(P)
        ny = g.sep(N)[1]
        arc = g.mul(ang, RING_R)
        sidew = g.smooth(g.absolute(ny), 0.75, 0.9)
        nrad = g.vmath('DOT_PRODUCT', N, g.vmath('NORMALIZE', g.combine(x, 0.0, z)), out=1)
        inner = g.smooth(nrad, -0.75, -0.9)
        outer = g.smooth(nrad, 0.75, 0.9)
        seg = g.math('FRACT', g.mul(ang, 12.0 / math.pi))           # 15-degree segments
        clear = g.mul(g.smooth(seg, 0.03, 0.06), g.smooth(seg, 0.97, 0.94))
        swin, swr = grid(g, arc, rad, 4.2, 5.0, 2.2, 1.6, 21.0)
        decks = band(g, rad, RING_R - RING_HR + 3.5, RING_R + RING_HR - 7.5, 0.2)
        swin = g.mul(g.mul(g.mul(swin, decks), sidew), clear)
        sky = g.mul(g.mul(band(g, y, RING_Y - 9.0, RING_Y + 9.0, 0.2), inner), clear)
        mull = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(arc, 1 / 3.6)), 0.5)), 0.38, 0.44)
        trans = band(g, y, RING_Y - 0.5, RING_Y + 0.5, 0.1)
        sky = g.mul(g.mul(sky, g.sub(1.0, mull)), g.sub(1.0, trans))
        own, owr = grid(g, arc, y, 6.0, 9.0, 2.6, 1.5, 23.0)
        own = g.mul(g.mul(g.mul(own, outer), clear), band(g, y, RING_Y - 11.0, RING_Y + 11.0, 0.2))
        own = g.mul(own, g.math('LESS_THAN', owr, 0.55))
        teal = g.add(g.mul(band(g, rad, RING_R + RING_HR - 6.5, RING_R + RING_HR - 2.5, 0.2), sidew),
                     g.mul(g.add(band(g, y, RING_Y - 13.5, RING_Y - 11.5, 0.15),
                                 band(g, y, RING_Y + 11.5, RING_Y + 13.5, 0.15)), outer))
        num, nrnd = grid(g, arc, y, 45.8, 80.0, 9.0, 4.0, 29.0)
        num = g.mul(g.mul(num, outer), g.math('LESS_THAN', nrnd, 0.7))
        skyrnd = g.noise(g.mul(arc, 0.04), 1.0, 2.0)
        v_side = g.mixf(sidew, y, rad)

        def paint(col):
            col = g.mix(swin, col, GLASS)
            col = g.mix(sky, col, GLASS)
            col = g.mix(own, col, GLASS)
            return g.mix(g.mul(num, 0.8), col, GRAPHITE)
        glow = lit_windows(g, swin, swr, 0.66)
        skyglow = g.vmath('SCALE', (0.95, 0.72, 0.42), None,
                          scale=g.mul(sky, g.madd(g.smooth(skyrnd, 0.3, 0.7), 0.5, 0.45)))
        glow = g.vmath('ADD', g.vmath('ADD', glow, skyglow), lit_windows(g, own, owr, 0.9))
        return plating(g, P, N, OFF, uv=(arc, v_side), plate=(7.0, 3.5), section=(21.0, 14.0), teal=teal,
                       paint=paint, glow=glow)
    M['ring'] = S.material('p_ring', ring)

    def collar(g, P, N):
        ang, rad, y = cylmap(g, P)
        arc = g.mul(ang, RING_R)
        lamps, lrnd = grid(g, g.add(rad, y), arc, 6.0, 50.0, 1.0, 100.0, 31.0)
        lamps = g.mul(lamps, g.math('LESS_THAN', lrnd, 0.5))
        stripe = band(g, g.math('FRACT', g.mul(g.add(rad, y), 1 / 20.0)), 0.45, 0.55, 0.01)
        col = g.mix(stripe, GRAPHITE, TEAL_F)
        glow = g.vmath('SCALE', (1.0, 0.85, 0.6), None, scale=g.mul(lamps, 0.8))
        return plating(g, P, N, col, plate=(4.0, 4.0), section=(12.0, 12.0), repl=0.03, metal=0.4, glow=glow,
                       wear=1.4, lines=0.5)
    M['collar'] = S.material('p_collar', collar)
    return M


# ==========================================================================
# Geometry. Every builder returns a list of objects (meta-tagged).

def tagged(objs, **kw):
    for o in objs:
        PP.meta(o, **kw)
    return objs


def set_tint(obj, value):
    a = obj.data.attributes.get('tint') or obj.data.attributes.new('tint', 'FLOAT', 'FACE')
    a.data.foreach_set('value', [value] * len(obj.data.polygons))
    return obj


def frame_at(loc, normal, along=(0, 1, 0)):
    z = Vector(normal).normalized()
    x = Vector(along).cross(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0)).cross(z)
    x.normalize()
    m = Matrix((x, z.cross(x), z)).transposed().to_4x4()
    m.translation = Vector(loc)
    return m


def greeble(name, size, M, frame, rng, taper=None, sink=0.4):
    b = PP.cap_box(name, size, M['greeble'], frame, taper=rng.uniform(0.78, 0.95) if taper is None else taper,
                   sink=sink)
    return set_tint(b, rng.random())


def lathe(name, profile, sides, centre, mat, closed=False, sharp=None, smooth=True, uv_radius=None):
    """S.lathe's solid of revolution with one seam-free strip of UVs (u
    along the profile, v round it), so a lathed part costs one UV seam."""
    rs = [r for _, r in profile if r > 1e-6]
    obj = PP.revolve(name, profile, mat, sides, 0.0, PP.TAU, closed=closed, centre=centre, smooth=smooth,
                     sharp=sharp, uv='strip', uv_radius=uv_radius or sum(rs) / len(rs))
    return PP.meta(obj, uvfix=1)


def set_col(obj, values):
    a = obj.data.attributes.get('col') or obj.data.attributes.new('col', 'INT', 'FACE')
    a.data.foreach_set('value', values)
    return obj


def octo(around, r, zc=0.0):
    k = r / math.cos(math.pi / 8)
    return [(k * math.cos(math.pi / 8 + i * math.pi / 4), zc + k * math.sin(math.pi / 8 + i * math.pi / 4))
            for i in range(8)]


def back_normal(r, phi):
    """Outward normal of the shield's back (backward, slightly outward)."""
    t = Vector((2.0, back_y(r + 1.0) - back_y(r - 1.0)))
    n = Vector((t.y, -t.x)).normalized()
    return polar(1.0, phi, 0.0) * n.x + Vector((0, n.y, 0))


def build_dish(M, rng):
    parts = []
    h_in = LAYERS[0][1]
    prof = [(yb(0.0) + h_in + 11.0, 0.0), (yb(5.0) + h_in + 10.7, 5.0), (yb(9.0) + h_in + 9.8, 9.0),
            (yb(13.0) + h_in + 7.8, 13.0), (yb(BOSS) + h_in, BOSS)]
    prof += [(yb(r) + h_in, r) for r in (46.0, 62.0, 78.0, 94.0)]
    prof += [(yb(LAYERS[0][0]) + h_in, LAYERS[0][0]), (yb(LAYERS[0][0] + 0.4), LAYERS[0][0] + 0.4)]
    prof += [(yb(r), r) for r in (126.0, 140.0)]
    prof += [(yb(156.0), 156.0), (yb(157.6) + 2.4, 157.6), (yb(169.0) + 2.4, 169.0), (yb(171.4) + 1.3, 171.4),
             (yb(172.4) - 1.2, 172.4), (yb(DISH_R) - 9.0, 172.8), (yb(DISH_R) - 19.0, 172.3),
             (yb(DISH_R) - 24.0, 170.6), (RIM_BACK, 168.0)]
    a0 = math.radians(-22.5)
    front = PP.revolve('dish', prof, M['dish'], 72, a0, a0 + PP.TAU, closed=False, sharp=28, uv='polar', side='left')
    parts.append(PP.meta(front, uvw=1.25, uvfix=1))
    # the back, ribs and pumps: one 45-degree sector, copied round after the bake
    sector = []
    bprof = [(y, r) for r, y in DISH_BACK]
    sector.append(PP.meta(PP.revolve('dish_back', bprof, M['dish'], 9, a0, -a0, closed=False, sharp=28, uv='polar',
                                     side='right'), uvfix=1))
    for k, phi in enumerate((-22.5, -11.25, 0.0, 11.25)):         # one rib on each sector seam
        r0, r1 = 30.0, 164.0
        p0, p1 = polar(r0, phi, back_y(r0) + 0.8), polar(r1, phi, back_y(r1) + 0.8)
        sector.append(PP.beam(f'rib{k}', p0, p1, 3.6, 7.0, M['frame'], up=back_normal(100.0, phi), offset=0.45,
                              taper=0.45))
        set_tint(sector[-1], 0.2)
    for k, (phi, r) in enumerate(((5.6, 100.0), (-16.9, 64.0), (16.9, 140.0))):
        size = (rng.uniform(7, 11), rng.uniform(10, 18), rng.uniform(3, 5))
        sector.append(greeble(f'dback{k}', size, M, frame_at(polar(r, phi, back_y(r)), back_normal(r, phi),
                                                             polar(1, phi + 90, 0)), rng, sink=0.7))
    parts += tagged(sector, uvw=0.55, grp=G_DISH)
    # radial armour ribs over the inner disc and the outer ring
    for k in range(12):
        phi = 30.0 * k
        for j, (ra, rb) in enumerate(((BOSS + 3.0, 72.0), (72.0, LAYERS[0][0] - 3.0), (LAYERS[0][0] + 4.0, 152.0))):
            pa = polar(ra, phi, yb(ra) + rise(ra))
            pb = polar(rb, phi, yb(rb) + rise(rb))
            mid = (ra + rb) / 2
            up = (polar(mid, phi, yb(mid)) - Vector((0, APEX - DISH_RC, 0))).normalized()
            rib = PP.beam(f'frib{k}_{j}', pa, pb, 2.8, 2.4, M['greeble'], up=up, offset=0.3)
            parts.append(PP.meta(set_tint(rib, 0.66), uvw=0.7))
    # patch plates on the front, between the ribs and inside one layer
    zones = ((BOSS + 6.0, 64.0, h_in), (78.0, LAYERS[0][0] - 4.0, h_in), (LAYERS[0][0] + 6.0, 152.0, 0.0))
    for i in range(21):
        lo, hi, step = zones[i % 3]
        w, l = rng.uniform(7, 13), rng.uniform(6, 11)
        r = rng.uniform(lo + w / 2, hi - w / 2) if hi - lo > w else (lo + hi) / 2
        phi = 30.0 * rng.randrange(12) + 15.0 + rng.uniform(-6.0, 6.0)
        centre = Vector((0, APEX - DISH_RC + step, 0))
        p = polar(r, phi, yb(r) + step)
        n = (p - centre).normalized()
        plate = PP.cap_box(f'patch{i}', (w, l, 0.8), M['patch'], frame_at(p, n, polar(1, phi + 90, 0)), sink=0.3)
        parts.append(PP.meta(set_tint(plate, rng.random()), uvw=1.0))
    return tagged(parts, cat=1)


def build_neck(M, rng):
    parts = [PP.meta(lathe('neck', [(604.0, 0.0), (604.0, 21.0), (612.0, 21.0), (618.0, 18.0), (628.0, 16.5),
                                      (634.0, 19.0), (643.0, 24.0), (643.0, 0.0)], 20, (0, 0), M['cmd'], sharp=35),
                     uvw=1.0)]
    for k in range(6):
        phi = 30.0 + 60.0 * k
        a, b = polar(24.0, phi, 611.0), polar(100.0, phi, back_y(100.0) + 1.5)
        parts.append(PP.meta(set_tint(PP.tube(f'strut{k}', a, b, 3.0, 8, M['frame']), 0.2), uvw=0.45))
        parts.append(PP.meta(set_tint(PP.tube(f'sleeve{k}', a.lerp(b, 0.34), a.lerp(b, 0.6), 4.5, 8, M['greeble']),
                                      0.7), uvw=0.45))
    return tagged(parts, cat=2)


def shuttle(name, M, matrix, tint=0.0):
    """A 28 m Skiff-like craft along local +Y (top +Z): a scale cue."""
    rows = [(-13.6, 3.0, 2.4, 2.4, 4, 4, 0.0, 0.0), (-11.5, 4.2, 3.2, 2.9, 4, 4, 0.0, 0.0),
            (8.0, 4.2, 3.2, 2.9, 4, 4, 0.0, 0.0), (11.5, 3.3, 2.6, 2.2, 3, 3, -0.3, 0.0),
            (13.8, 1.6, 1.3, 1.0, 2.5, 2.5, -0.5, 0.0)]
    body = S.loft(name, rows, M['shuttle'], around=10, front_tip=(0, -14.0, 0.0), back_tip=(0, 14.4, -0.5),
                  sharp=40)
    parts = [set_tint(body, tint)]
    for sx in (-1, 1):
        pod = lathe(f'{name}_pod{sx}', [(-15.5, 0.0), (-15.5, 1.3), (-14.0, 1.5), (-8.0, 1.5), (-6.5, 0.0)], 6,
                      (sx * 4.6, -0.6), M['greeble'], sharp=40)
        parts.append(set_tint(pod, 0.75))
        parts.append(S.box(f'{name}_win{sx}', (0.5, 15.0, 1.1), M['strip'], Matrix.Translation((sx * 4.05, 1.5, 1.0))))
    parts.append(set_tint(S.box(f'{name}_fin', (0.6, 5.0, 3.2), M['shuttle'],
                                Matrix.Translation((0, -11.0, 4.2)) @ Matrix.Rotation(math.radians(-14), 4, 'X'),
                                taper=0.6), tint))
    for o in parts:
        PP.transformed(o, matrix)
    return tagged(parts, uvw=0.8)


def build_command(M, rng):
    parts = []
    y0, y1 = CMD
    drum = S.loft('drum', [(y0, 30.0, 0.0), (y0 + 9.0, 40.0, 0.0), (y0 + 17.0, CMD_R, 0.0), (y1 - 15.0, CMD_R, 0.0),
                           (y1 - 7.0, 38.0, 0.0), (y1, 30.0, 0.0)], M['cmd'], around=8, section=octo,
                  front_tip=(0, y0, 0.0), back_tip=(0, y1, 0.0), sharp=25)
    parts.append(PP.meta(drum, uvw=1.9))
    gal = S.loft('gallery', [(537.5, CMD_R, 0.0), (539.5, 48.6, 0.0), (556.5, 48.6, 0.0), (558.5, CMD_R, 0.0)],
                 M['gallery'], around=8, section=octo, front_tip=(0, 537.5, 0.0), back_tip=(0, 558.5, 0.0), sharp=25)
    parts.append(PP.meta(gal, uvw=1.6))
    # bridge tower, window band, top deck and mast
    tz = CMD_R - 1.0                     # the drum's top flat, less 1 m of embedding
    parts.append(PP.meta(S.box('tower', (34.0, 62.0, 24.0), M['cmd'], Matrix.Translation((0, 553.0, tz + 12.0)),
                               taper=0.8), uvw=1.9))
    k = 1 - 0.2 * (62.5 - tz) / 24.0
    parts.append(PP.meta(S.box('bridge_band', (34.0 * k + 0.7, 62.0 * k + 0.7, 3.0), M['bridge'],
                               Matrix.Translation((0, 553.0, 62.5))), uvw=1.4))
    parts.append(PP.meta(S.box('topdeck', (22.0, 38.0, 9.0), M['cmd'], Matrix.Translation((0, 556.0, tz + 24 + 3.5)),
                               taper=0.85), uvw=1.5))
    mast_base = Vector((0, 560.0, tz + 24 + 7.5))
    parts.append(PP.meta(PP.beam('mast', mast_base, mast_base + Vector((0, 0, 46)), 2.6, 2.6, M['frame'],
                                 up=(0, 1, 0), taper=0.35), uvw=0.5, col=0))
    for zz, ln in ((26.0, 18.0), (36.0, 12.0)):
        parts.append(PP.meta(PP.beam(f'yard{zz}', mast_base + Vector((-ln / 2, 0, zz)), mast_base + Vector((ln / 2, 0, zz)),
                                     0.8, 0.8, M['frame']), uvw=0.4, col=0))
    parts.append(PP.meta(PP.tube('mast_lamp', mast_base + Vector((0, 0, 45.5)), mast_base + Vector((0, 0, 48.0)), 1.1, 8,
                                 M['white']), uvw=0.3, col=0))
    # high-gain antenna on a boom, aft on the drum's top
    boom0, boom1 = Vector((0, 489.0, CMD_R - 1.0)), Vector((0, 482.0, CMD_R + 18.0))
    parts.append(PP.meta(PP.beam('hga_boom', boom0, boom1, 3.0, 3.0, M['frame'], up=(0, 1, 0)), uvw=0.5))
    f = 14.0
    prof = [(-0.9, 0.0)] + [(-0.9 + r * r / (4 * f), r) for r in (6.0, 12.0, 18.0)] + [(18.0 ** 2 / (4 * f) + 0.3, 18.6)]
    prof += [(r * r / (4 * f), r) for r in (18.0, 12.0, 6.0)] + [(0.0, 0.0)]
    hga = lathe('hga', prof, 20, (0, 0), M['greeble'], sharp=50)
    axis = Vector((0, -0.55, 1.0)).normalized()
    rot = Vector((0, 1, 0)).rotation_difference(axis).to_matrix().to_4x4()
    PP.transformed(hga, Matrix.Translation(boom1 + axis * 0.5) @ rot)
    parts.append(PP.meta(set_tint(hga, 0.0), uvw=0.8, col=0))
    tip = boom1 + axis * 13.0
    parts.append(PP.meta(PP.tube('hga_feed', boom1 + axis * 2.0, tip, 0.9, 6, M['frame']), uvw=0.3, col=0))
    for k in range(3):
        a = math.radians(120 * k)
        side = axis.cross(Vector((1, 0, 0))).normalized()
        other = axis.cross(side)
        rim = boom1 + axis * (18.0 ** 2 / (4 * f) + 0.5) + (side * math.cos(a) + other * math.sin(a)) * 17.5
        parts.append(PP.meta(PP.beam(f'hga_strut{k}', rim, tip, 0.6, 0.6, M['frame'], caps=False), uvw=0.2, col=0))
    # sensor blister under the drum
    dome = lathe('blister', [(-1.0, 0.0), (-1.0, 13.0), (0.0, 13.0), (5.0, 12.0), (9.0, 9.2), (12.0, 5.0), (13.0, 0.0)],
                   16, (0, 0), M['greeble'], sharp=60)
    PP.transformed(dome, Matrix.Translation((0, 548.0, -CMD_R + 1.0)) @ Matrix.Rotation(math.radians(-90), 4, 'X'))
    parts.append(PP.meta(set_tint(dome, 0.0), uvw=0.8))
    # docking tubes with lifeboat shuttles on both flanks
    for sx in (-1, 1):
        parts.append(PP.meta(set_tint(PP.beam(f'dock{sx}', (sx * (CMD_R - 1.0), 500.0, 0.0),
                                              (sx * (CMD_R + 9.0), 500.0, 0.0), 6.0, 6.0, M['greeble'], up=(0, 0, 1)),
                                      0.4), uvw=0.7))
        m = Matrix.Translation((sx * (CMD_R + 11.5), 500.0, 0.0)) @ Matrix.Rotation(math.radians(-90 * sx), 4, 'Y')
        parts += shuttle(f'lifeboat{sx}', M, m, tint=0.3 + 0.2 * sx)
    # boxes on the drum flats, comm whips
    bvh = S.bvh_of([drum])
    for k in range(40):
        phi = rng.choice([0, 45, 90, 135, 180, 225, 270, 315]) + rng.uniform(-12, 12)
        y = rng.uniform(490.0, 595.0)
        if 535 < y < 561 or (abs(math.cos(math.radians(phi))) > 0.9 and 486 < y < 536):
            continue                                    # keep the gallery, the docks and the emblem clear
        o = polar(80.0, phi, y)
        loc, nrm, _, _ = bvh.ray_cast(o, (-o.x, 0, -o.z))
        if loc is None:
            continue
        size = (rng.uniform(4, 10), rng.uniform(5, 13), rng.uniform(1.4, 4.0))
        parts.append(PP.meta(greeble(f'cbox{k}', size, M, frame_at(loc, nrm), rng), uvw=0.6))
    for k, (phi, y, ln) in enumerate(((60, 600.0, 26.0), (120, 596.0, 18.0), (250, 590.0, 22.0), (300, 482.0, 30.0))):
        o = polar(80.0, phi, y)
        loc, nrm, _, _ = bvh.ray_cast(o, (-o.x, 0, -o.z))
        d = polar(1.0, phi, 0.0)
        base = loc - d * 0.5
        parts.append(PP.meta(PP.tube(f'whip{k}', base, base + d * ln, 0.45, 5, M['frame'], r1=0.2), uvw=0.2, col=0))
    return tagged(parts, cat=3)


def sponson(name, M, loc, normal, height=2.6, r=7.5):
    n = Vector(normal).normalized()
    t = PP.tube(name, Vector(loc) - n * 1.2, Vector(loc) + n * height, r, 8, M['greeble'], smooth=False)
    return PP.meta(set_tint(t, 0.45), uvw=0.6, cat=12)


def build_forward(M, rng):
    parts = tagged(PP.truss('fwd', FWD[0], FWD[1], TRUSS, 5, M['frame']), uvw=0.28)
    for o in parts:
        set_tint(o, rng.random())
    parts.append(PP.meta(lathe('fwd_core', [(FWD[0], 0.0), (FWD[0], 7.0), (FWD[1], 7.0), (FWD[1], 0.0)], 12, (0, 0),
                                 M['axial'], sharp=40), uvw=0.35))
    for k, (x, z) in enumerate(((8.0, 9.0), (-9.0, -7.0))):
        parts.append(PP.meta(set_tint(PP.tube(f'fwd_pipe{k}', (x, FWD[0], z), (x, FWD[1], z), 1.5, 6, M['frame']), 0.8),
                             uvw=0.2))
    # cargo containers clamped to the truss faces
    k = 0
    step = (FWD[1] - FWD[0]) / 5
    for bay in range(1, 4):
        yc = FWD[0] + step * (bay + 0.5)
        for face in range(3):                           # sides and top; the tug docks underneath
            n = [Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((-1, 0, 0))][face]
            t = n.cross(Vector((0, 1, 0)))
            for slot in (-1, 1):
                if rng.random() < 0.25:
                    continue
                c = n * (TRUSS + 0.2 + 5.0) + t * (slot * 5.6) + Vector((0, yc + rng.uniform(-0.5, 0.5), 0))
                box = S.box(f'cargo{k}', (10.6, 23.0, 10.0), M['cargo'], frame_at(c, n, (0, 1, 0)))
                parts.append(PP.meta(set_tint(box, rng.random()), uvw=0.5))
                k += 1
    # an ore tug docked under the truss: a scale cue (about 46 m long)
    tug = []
    yc = FWD[0] + step * 3.2
    tug.append(set_tint(S.box('tug_body', (14.0, 34.0, 10.0), M['greeble'], Matrix.Translation((0, yc, -TRUSS - 9.0)),
                              taper=0.9), 0.0))
    tug.append(set_tint(S.box('tug_cab', (9.0, 9.0, 6.0), M['shuttle'], Matrix.Translation((0, yc + 20.0, -TRUSS - 8.0)),
                              taper=0.8), 0.6))
    tug.append(S.box('tug_win', (8.2, 0.5, 1.4), M['strip'], Matrix.Translation((0, yc + 24.0, -TRUSS - 7.6))))
    for sx in (-1, 1):
        tug.append(set_tint(lathe(f'tug_pod{sx}', [(yc - 23.0, 0.0), (yc - 23.0, 2.6), (yc - 20.0, 3.0), (yc - 6.0, 3.0),
                                                   (yc - 4.0, 0.0)], 8, (sx * 8.6, -TRUSS - 11.0), M['greeble'], sharp=40),
                            0.75))
        tug.append(S.box(f'tug_clamp{sx}', (2.0, 2.0, 4.0), M['frame'], Matrix.Translation((sx * 5.0, yc, -TRUSS - 2.6))))
    for o in tug:
        if o.data.attributes.get('tint') is None:
            set_tint(o, 0.2)
    parts += tagged(tug, uvw=0.7)
    return tagged(parts, cat=4)


def hangar_block(M):
    """The hangar module: an eight-sided block round the spine with a
    recessed, lit bay in its belly (a closed manifold)."""
    sec = [(52.0, 20.0), (38.0, 36.0), (-38.0, 36.0), (-52.0, 20.0), (-52.0, -74.0), (-42.0, -86.0),
           (42.0, -86.0), (52.0, -74.0)]
    y0, y1 = HANGAR
    stations = [(y0, 0.92), (y0 + 10.0, 1.0), (y1 - 10.0, 1.0), (y1, 0.92)]
    bm = bmesh.new()
    rings = []
    zc = -25.0
    for y, s in stations:
        rings.append([bm.verts.new((x * s, y, zc + (z - zc) * s)) for x, z in sec])
    S.ring_faces(bm, rings)
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.faces.ensure_lookup_table()
    belly = [f for f in bm.faces if all(abs(v.co.z + 86.0) < 1e-3 for v in f.verts)
             and min(v.co.y for v in f.verts) > y0 + 5 and max(v.co.y for v in f.verts) < y1 - 5]
    assert len(belly) == 1, len(belly)
    face = belly[0]
    # an 8 m frame round the mouth (x +-34, y 194..332), then the bay 38 m deep, built corner by corner
    outer = {(round(v.co.x), round(v.co.y)): v for v in face.verts}
    A, B = outer[(-42, round(y0 + 10.0))], outer[(42, round(y0 + 10.0))]
    Cc, D = outer[(42, round(y1 - 10.0))], outer[(-42, round(y1 - 10.0))]
    bm.faces.remove(face)
    rect = [(-BAY_X, BAY_Y[0]), (BAY_X, BAY_Y[0]), (BAY_X, BAY_Y[1]), (-BAY_X, BAY_Y[1])]
    low = [bm.verts.new((x, y, -86.0)) for x, y in rect]
    high = [bm.verts.new((x, y, -86.0 + BAY_DEPTH)) for x, y in rect]
    for i, (o0, o1) in enumerate(((A, B), (B, Cc), (Cc, D), (D, A))):
        j = (i + 1) % 4
        bm.faces.new((o0, o1, low[j], low[i]))
        bm.faces.new((low[i], low[j], high[j], high[i]))
    bm.faces.new(high)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = PP.finish('hangar', bm, None, smooth=False, recalc=False, weld=1e-4)
    obj.data.materials.append(M['hangar'])
    obj.data.materials.append(M['hangar_in'])
    obj.data.materials.append(M['hazard'])
    for p in obj.data.polygons:
        c = p.center
        if abs(c.z + 86.0) < 0.2 and abs(c.x) < 42.5 and y0 + 9 < c.y < y1 - 9:
            p.material_index = 2                        # the mouth's frame
        elif abs(c.x) < BAY_X + 0.1 and BAY_Y[0] - 0.1 < c.y < BAY_Y[1] + 0.1 and -86.0 < c.z < -47.0:
            p.material_index = 1                        # the bay's walls and ceiling
    # the bay's inside needs no collider cover: with it left out of the fit the block counts as solid
    return set_col(obj, [0 if p.material_index == 1 else 1 for p in obj.data.polygons])


def build_hangar(M, rng):
    parts = [PP.meta(hangar_block(M), uvw=1.25)]
    y0, y1 = HANGAR
    # gantries across the bay ceiling and two shuttles parked inside
    for k, y in enumerate((214.0, 263.0, 312.0)):
        parts.append(PP.meta(set_tint(PP.beam(f'gantry{k}', (-BAY_X - 0.6, y, -51.0), (BAY_X + 0.6, y, -51.0), 3.0, 4.0,
                                              M['frame']),
                                      0.2), uvw=0.35))
    for k, (x, y) in enumerate(((-12.0, 238.0), (13.0, 292.0))):
        m = Matrix.Translation((x, y, -60.0)) @ Matrix.Rotation(math.radians(180 * k), 4, 'Z')
        parts += shuttle(f'parked{k}', M, m, tint=0.1 + 0.4 * k)
        parts.append(PP.meta(PP.beam(f'clamp{k}', (x, y, -57.6), (x, y, -47.4), 2.0, 2.0, M['frame']), uvw=0.2))
    # flight-control blister at the bay's forward edge, facing aft into the bay
    parts.append(PP.meta(set_tint(S.box('flightctl', (26.0, 9.0, 7.0), M['greeble'],
                                        Matrix.Translation((0, y1 - 13.0, -88.5)) @ Matrix.Rotation(math.pi, 4, 'X'),
                                        taper=0.8), 0.0), uvw=0.7))
    parts.append(PP.meta(S.box('flightctl_win', (22.0, 0.6, 2.2), M['bridge'], Matrix.Translation((0, y1 - 17.0, -89.2))),
                         uvw=0.5))
    # raised frames across the top and the upper chamfers
    for k, y in enumerate((190.0, 222.0, 254.0, 286.0, 318.0)):
        for x0, z0, x1, z1 in ((-38.0, 36.0, 38.0, 36.0), (38.0, 36.0, 52.0, 20.0), (-38.0, 36.0, -52.0, 20.0)):
            a, b = Vector((x0, y, z0)), Vector((x1, y, z1))
            n = Vector((0, 0, 1)) if z0 == z1 else Vector((math.copysign(16.0, x1), 0, 14.0)).normalized()
            parts.append(PP.meta(set_tint(PP.beam(f'hframe{k}_{x1}', a, b, 3.6, 1.6, M['greeble'], up=n, offset=0.3,
                                                  caps=True), 0.0), uvw=0.5))
    # boxes on the top and flanks, vents near the stern
    bvh = S.bvh_of([parts[0]])
    for k in range(48):
        side = rng.choice(('top', 'top', 'flank'))
        y = rng.uniform(y0 + 14, y1 - 14)
        if side == 'top':
            o, d = Vector((rng.uniform(-30, 30), y, 80.0)), Vector((0, 0, -1))
        else:
            sx = rng.choice((-1, 1))
            z = rng.uniform(-70.0, 14.0)
            if -31 < z < -4 and 195 < y < 331:
                continue                                # keep the name clear
            o, d = Vector((sx * 90.0, y, z)), Vector((-sx, 0, 0))
        loc, nrm, _, _ = bvh.ray_cast(o, d)
        if loc is None:
            continue
        size = (rng.uniform(5, 12), rng.uniform(6, 16), rng.uniform(1.5, 5.0))
        parts.append(PP.meta(greeble(f'hbox{k}', size, M, frame_at(loc, nrm), rng), uvw=0.55))
    for k, x in enumerate((-34.0, -30.0, 32.0)):
        parts.append(PP.meta(set_tint(PP.tube(f'conduit{k}', (x, y0 + 4.0, 37.3), (x, y1 - 4.0, 37.3), 1.6, 6,
                                              M['greeble']), 0.62), uvw=0.25))
    for k in range(4):
        loc = Vector((-24.0 + 16.0 * k, y0 + 22.0 + 6.0 * (k % 2), 36.0))
        for p in S.vent(f'hvent{k}', (9.0, 14.0, 1.2), M['greeble'], frame_at(loc, (0, 0, 1)), slats=4):
            parts.append(PP.meta(set_tint(p, 0.62), uvw=0.4))
    return tagged(parts, cat=5)


def capsule(name, y0, y1, R, centre, mat, sides=18, steps=4):
    prof = [(y1, 0.0)]
    for i in range(1, steps + 1):
        a = math.pi / 2 * i / steps
        prof.append((y1 - R + R * math.cos(a), R * math.sin(a)))
    for i in range(steps, 0, -1):
        a = math.pi / 2 * i / steps
        prof.append((y0 + R - R * math.cos(a), R * math.sin(a)))
    prof.append((y0, 0.0))
    return lathe(name, prof, sides, centre, mat)


def build_tanks_a(M, rng):
    parts = []
    y0, y1 = TANK_A
    m_axis = polar(TANK_A_AXIS, 90.0, 0.0)
    master = [capsule('tankA', y0, y1, TANK_A_R, (m_axis.x, m_axis.z), M['tank'])]
    top = TANK_A_AXIS + TANK_A_R
    # a feed line along the tank's crown and a manway box on it
    master.append(set_tint(PP.beam('tankA_feed', (0.0, y0 + 22.0, top - 0.4), (0.0, y1 - 22.0, top - 0.4), 2.2, 2.0,
                                   M['frame'], up=(0, 0, 1), offset=0.4), 0.8))
    master.append(set_tint(PP.cap_box('tankA_manway', (7.0, 9.0, 2.6), M['greeble'],
                                      frame_at((5.5, 118.0, top - 0.8), (0.28, 0, 0.96)), sink=0.6, taper=0.85), 0.4))
    parts += tagged(master, uvw=1.0, grp=G_TANK_A)
    o_axis = polar(TANK_A_AXIS, 270.0, 0.0)
    parts.append(PP.meta(capsule('tankA_odd', y0, y1, TANK_A_R, (o_axis.x, o_axis.z), M['tank_odd']), uvw=0.9))
    parts.append(PP.meta(lathe('coreA', [(4.0, 0.0), (4.0, 22.0), (180.0, 22.0), (180.0, 0.0)], 18, (0, 0),
                                 M['axial'], sharp=40), uvw=0.35))
    for k, yy in enumerate((72.0, 138.0)):
        hoop = lathe(f'hoop{k}', [(yy - 2.6, 62.2), (yy - 1.6, 66.4), (yy + 1.6, 66.4), (yy + 2.6, 62.2)], 48, (0, 0),
                       M['frame'], closed=True)
        parts.append(PP.meta(set_tint(hoop, 0.8), uvw=0.45))
        for j in range(6):
            phi = 60.0 * j
            parts.append(PP.meta(set_tint(PP.beam(f'hoop{k}_spoke{j}', polar(20.0, phi, yy), polar(63.0, phi, yy), 2.2,
                                                  2.6, M['frame'], up=(0, 1, 0), caps=False), 0.8), uvw=0.2))
    return tagged(parts, cat=6)


def build_hub(M, rng):
    parts = []
    parts.append(PP.meta(lathe('hub', [(HUB[0], 0.0), (HUB[0], 40.0), (HUB[0] + 4.0, 44.0), (HUB[0] + 8.0, 50.0),
                                         (HUB[1] - 8.0, 50.0), (HUB[1] - 4.0, 44.0), (HUB[1], 40.0), (HUB[1], 0.0)],
                                 36, (0, 0), M['axial'], sharp=35), uvw=0.9))
    for k, yy in enumerate((HUB[0] + 12.0, HUB[1] - 12.0)):
        fl = lathe(f'hub_flange{k}', [(yy - 1.8, 49.0), (yy - 1.0, 54.0), (yy + 1.0, 54.0), (yy + 1.8, 49.0)], 36,
                     (0, 0), M['frame'], closed=True)
        parts.append(PP.meta(set_tint(fl, 0.8), uvw=0.45))
    for k, phi in enumerate((45.0, 225.0)):
        d = polar(1.0, phi, 0.0)
        base = polar(49.0, phi, -20.0)
        parts.append(PP.meta(set_tint(PP.beam(f'hub_boom{k}', base, base + d * 16.0, 2.2, 2.2, M['frame'],
                                              up=(0, 1, 0)), 0.2), uvw=0.3, col=0))
        f = 6.0
        prof = [(-0.5, 0.0), (-0.5 + 36 / (4 * f), 6.0), (-0.5 + 81 / (4 * f), 9.0), (81 / (4 * f) + 0.2, 9.3),
                (81 / (4 * f), 9.0), (36 / (4 * f), 6.0), (0.0, 0.0)]
        dish = lathe(f'hub_dish{k}', prof, 14, (0, 0), M['greeble'], sharp=50)
        axis = (d + Vector((0, -0.6, 0))).normalized()
        rot = Vector((0, 1, 0)).rotation_difference(axis).to_matrix().to_4x4()
        PP.transformed(dish, Matrix.Translation(base + d * 16.5) @ rot)
        parts.append(PP.meta(set_tint(dish, 0.0), uvw=0.5, col=0))
    for k, phi in enumerate((135.0, 315.0)):
        base = polar(49.5, phi, -26.0)
        parts.append(PP.meta(set_tint(PP.beam(f'hub_mast{k}', base, base + polar(34.0, phi, 0.0), 1.6, 1.6, M['frame'],
                                              up=(0, 1, 0), taper=0.4), 0.2), uvw=0.25, col=0))
    # spoke (static) at phi = 0 with its bearing yoke round the ring section
    sp = []
    x0, x1 = 49.0, RING_R - RING_HR - YOKE_OUT + 1.0
    yr = RING_Y
    sp.append(PP.tube('spoke', (x0, yr, 0), (x1, yr, 0), 6.5, 12, M['spoke']))
    sp.append(PP.tube('spoke_root', (x0, yr, 0), (x0 + 16.0, yr, 0), 12.0, 12, M['spoke'], r1=6.6))
    sp.append(PP.tube('spoke_head', (x1 - 14.0, yr, 0), (x1, yr, 0), 6.6, 12, M['spoke'], r1=11.0))
    for s in (-1, 1):
        sp.append(PP.beam(f'rail{s}', (60.0, yr + s * 8.5, 0), (x1 - 6.0, yr + s * 8.5, 0), 1.8, 1.8, M['frame']))
        for j, xx in enumerate((72.0, 106.0)):
            sp.append(PP.beam(f'rail{s}_{j}', (xx, yr + s * 5.0, 0), (xx, yr + s * 8.6, 0), 1.2, 1.2, M['frame'],
                              up=(1, 0, 0), caps=False))
    sp.append(S.box('spoke_pod', (12.0, 14.0, 14.0), M['spoke'], Matrix.Translation((90.0, yr, 0))))
    outer = PP.rounded_rect(RING_Y, RING_R, RING_HY + YOKE_OUT, RING_HR + YOKE_OUT, RING_RC + 4.5, per_corner=2)
    inner = PP.rounded_rect(RING_Y, RING_R, RING_HY + YOKE_IN, RING_HR + YOKE_IN, RING_RC + 2.5, per_corner=2)
    sp.append(PP.sleeve('yoke', outer, inner, math.radians(-4.5), math.radians(4.5), 3, M['yoke'], sharp=40))
    for s in (-1, 1):
        sp.append(PP.tube(f'yoke_lamp{s}', polar(RING_R + RING_HR + YOKE_OUT - 0.5, s * 3.0, RING_Y),
                          polar(RING_R + RING_HR + YOKE_OUT + 1.8, s * 3.0, RING_Y), 1.2, 6, M['amber']))
    for o in sp:
        set_tint(o, 0.8)
    parts += tagged(sp, uvw=0.9, grp=G_SPOKE)
    return tagged(parts, cat=7)


def build_tanks_b(M, rng):
    parts = []
    for (yc, dist, R), phi0, mat, grp, sides, rows in ((TANK_B_BIG, 45.0, M['sphere_big'], G_SPH_BIG, 20, 11),
                                                        (TANK_B_SMALL, 0.0, M['sphere_small'], G_SPH_SMALL, 16, 9)):
        c = polar(dist, phi0, yc)
        prof = [(yc + R * math.cos(math.pi * i / rows), R * math.sin(math.pi * i / rows)) for i in range(rows + 1)]
        prof[0], prof[-1] = (yc + R, 0.0), (yc - R, 0.0)
        group = [lathe(f'sph{grp}', prof, sides, (c.x, c.z), mat)]
        group.append(lathe(f'sph{grp}_band', [(yc - 2.4, R - 0.6), (yc - 1.4, R + 1.3), (yc + 1.4, R + 1.3),
                                                  (yc + 2.4, R - 0.6)], sides, (c.x, c.z), M['frame'], closed=True))
        inward = Vector((-c.x, 0, -c.z)).normalized()
        for s in (-1, 1):
            a = Vector((c.x, yc + s * R * 0.55, c.z)) + inward * (R * 0.75)
            b = Vector((0.0, yc + s * R * 0.7, 0.0)) - inward * 5.0      # into the core, through the truss
            group.append(PP.beam(f'sph{grp}_strut{s}', a, b, 2.4, 2.4, M['frame'], up=(0, 1, 0), caps=False))
        for o in group[1:]:
            set_tint(o, 0.75)
        parts += tagged(group, uvw=1.0, grp=grp)
    return tagged(parts, cat=8)


def build_aft(M, rng):
    parts = tagged(PP.truss('aft', AFT[0], AFT[1], TRUSS, 14, M['frame']), uvw=0.28)
    for o in parts:
        set_tint(o, rng.random())
    parts.append(PP.meta(lathe('aft_core', [(AFT[0], 0.0), (AFT[0], 7.0), (AFT[1], 7.0), (AFT[1], 0.0)], 12, (0, 0),
                                 M['axial'], sharp=40), uvw=0.3))
    for k, (x, z) in enumerate(((9.0, 8.0), (-8.0, -9.0))):
        parts.append(PP.meta(set_tint(PP.tube(f'aft_pipe{k}', (x, AFT[0], z), (x, AFT[1], z), 1.6, 6, M['frame']), 0.8),
                             uvw=0.2))
    # the pump house: an octagonal drum round the truss, with boxes and vents on it
    y0, y1 = PUMP
    house = S.loft('pumphouse', [(y0, 26.0, 0.0), (y0 + 6.0, 32.0, 0.0), (y1 - 6.0, 32.0, 0.0), (y1, 26.0, 0.0)],
                   M['axial'], around=8, section=octo, front_tip=(0, y0, 0.0), back_tip=(0, y1, 0.0), sharp=25)
    parts.append(PP.meta(house, uvw=0.9))
    hb = S.bvh_of([house])
    for k in range(10):
        phi = 45.0 * rng.randrange(8) + rng.uniform(-10, 10)
        y = rng.uniform(y0 + 8.0, y1 - 8.0)
        o = polar(80.0, phi, y)
        loc, nrm, _, _ = hb.ray_cast(o, (-o.x, 0, -o.z))
        if loc is None:
            continue
        size = (rng.uniform(4, 9), rng.uniform(5, 12), rng.uniform(1.5, 3.5))
        parts.append(PP.meta(greeble(f'pbox{k}', size, M, frame_at(loc, nrm), rng), uvw=0.45))
    # pump and valve boxes clamped inside the bare truss
    for k in range(8):
        y = rng.uniform(-445.0, -255.0)
        n = [Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((-1, 0, 0)), Vector((0, 0, -1))][rng.randrange(4)]
        c = n * 6.2 + Vector((0, y, 0))
        parts.append(PP.meta(greeble(f'pump{k}', (9.0, rng.uniform(8, 16), 6.0), M, frame_at(c, n), rng, taper=0.9),
                             uvw=0.45))
    return tagged(parts, cat=9)


def build_radiators(M, rng):
    """The starboard wing (mirrored to port after the bake): two layers of
    panels 9 m apart between a root manifold on the truss and a tip beam,
    heat-pipe ribs on the outer faces, stays from the longerons."""
    wing = []
    y0, y1 = RAD
    wing.append(PP.beam('rad_root', (24.0, y0 - 2.0, 0.0), (24.0, y1 + 2.0, 0.0), 14.0, 11.0, M['frame'], up=(0, 0, 1)))
    strips = 4
    span = (y1 - y0 - 3.0 * (strips - 1)) / strips
    for layer in (-1, 1):
        zc = layer * 4.5
        for s in range(strips):
            a = y0 + s * (span + 3.0)
            b = a + span
            wing.append(S.box(f'rad_panel{layer}{s}', (RAD_TIP - 31.0, span, 1.2), M['radiator'],
                              Matrix.Translation(((31.0 + RAD_TIP) / 2, (a + b) / 2, zc))))
            for j in range(3):
                y = a + span * (j + 0.5) / 3
                wing.append(PP.beam(f'rad_rib{layer}{s}_{j}', (31.0, y, zc + layer * 1.0), (RAD_TIP, y, zc + layer * 1.0),
                                    1.0, 0.8, M['frame'], up=(0, 0, layer), caps=False))
    wing.append(PP.beam('rad_tip', (RAD_TIP + 2.0, y0 - 1.0, 0.0), (RAD_TIP + 2.0, y1 + 1.0, 0.0), 4.0, 11.0, M['frame'],
                        up=(0, 0, 1)))
    for k, y in enumerate((y0 + 36.0, y1 - 36.0)):
        # stays from the truss's upper and lower longerons out to the outer panels
        wing.append(PP.beam(f'rad_brace{k}', (TRUSS, y, TRUSS), (72.0, y, 5.0), 1.6, 1.6, M['frame'], caps=False))
        wing.append(PP.beam(f'rad_brace{k}b', (TRUSS, y, -TRUSS), (72.0, y, -5.0), 1.6, 1.6, M['frame'], caps=False))
    for o in wing:
        set_tint(o, 0.3)
    return tagged(wing, uvw=0.45, grp=G_RAD, cat=10)


def build_stern(M, rng):
    parts = []
    parts.append(PP.meta(lathe('plate', [(-436.0, 0.0), (-436.0, 24.0), (-466.0, 78.0), (-470.0, 82.0), (-488.0, 82.0),
                                           (-492.0, 77.0), (-492.0, 0.0)], 56, (0, 0), M['axial'], sharp=30), uvw=1.0))
    parts.append(PP.meta(lathe('spike', [(-490.0, 0.0), (-490.0, 21.0), (-540.0, 17.0), (-575.0, 10.0), (-590.0, 0.0)],
                                 18, (0, 0), M['axial'], sharp=40), uvw=0.45))
    for k in range(12):
        phi = 30.0 * k + 15.0
        r = 52.0
        y = -436.0 - (r - 24.0) * 30.0 / 54.0
        n = Vector((math.cos(math.radians(phi)) * 30.0 / 61.6, 54.0 / 61.6, math.sin(math.radians(phi)) * 30.0 / 61.6))
        parts.append(PP.meta(greeble(f'pumpbox{k}', (9.0, 11.0, 5.0), M,
                                     frame_at(polar(r, phi, y), n, polar(1, phi + 90, 0)), rng, taper=0.85, sink=1.0),
                             uvw=0.45))
    # engine (master at the top) with its coils, bell, band and throat glow
    e = polar(ENG_R, ENG_PHI[0], 0.0)
    ex, ez = e.x, e.z
    eng = [lathe('engine', [(-488.0, 0.0), (-488.0, 21.0), (-493.0, 24.5), (-600.0, 24.5), (-604.0, 19.0),
                              (-607.0, 13.2), (-607.0, 0.0)], 20, (ex, ez), M['engine'], sharp=35)]
    for k, yy in enumerate((-515.0, -545.0, -575.0)):
        eng.append(lathe(f'coil{k}', [(yy - 3.4, 24.2), (yy - 2.6, 28.0), (yy - 1.2, 29.0), (yy + 1.2, 29.0),
                                        (yy + 2.6, 28.0), (yy + 3.4, 24.2)], 20, (ex, ez), M['coil'], closed=True))
    inner = [(y, bell_r(y)) for y in np.linspace(EXIT_Y, THROAT_Y, 8)]
    outer = [(y, bell_r(y) + 1.4 + 0.9 * (y - EXIT_Y) / (THROAT_Y - EXIT_Y)) for y in np.linspace(THROAT_Y + 2.0, EXIT_Y, 6)]
    prof = inner + outer + [(EXIT_Y - 0.6, EXIT_R + 0.75)]
    bell = lathe('bell', prof, 32, (ex, ez), M['bell'], closed=True, sharp=50)
    eng.append(set_col(bell, [0 if p.normal.dot(Vector((p.center.x - ex, 0.0, p.center.z - ez))) < 0 else 1
                              for p in bell.data.polygons]))
    yy = THROAT_Y + (EXIT_Y - THROAT_Y) * 0.42
    ro = bell_r(yy) + 1.4 + 0.9 * (yy - EXIT_Y) / (THROAT_Y - EXIT_Y)
    eng.append(lathe('bell_band', [(yy - 2.6, ro - 0.6), (yy - 1.6, ro + 1.4), (yy + 1.6, ro + 1.4), (yy + 2.6, ro - 0.6)],
                       32, (ex, ez), M['frame'], closed=True))
    eng.append(PP.meta(PP.disc('throat', (ex, -612.0, ez), (0, -1, 0), bell_r(-612.0) + 0.4, 24, M['throat']), col=0))
    other = polar(ENG_R, ENG_PHI[1], 0.0)
    eng.append(PP.beam('thrust_frame', (ex, -594.0, ez), (other.x, -594.0, other.z), 5.0, 5.0, M['frame'], caps=False))
    eng.append(PP.beam('thrust_strut', (ex * 0.5, -490.0, ez * 0.5), (ex, -560.0, ez), 3.0, 3.0, M['frame'], caps=False))
    for o in eng:
        set_tint(o, 0.6)
    parts += tagged(eng, uvw=1.0, grp=G_ENGINE)
    # stern mast with its strobe on the plate's top
    base = Vector((0, -479.0, 81.0))
    parts.append(PP.meta(PP.beam('stern_mast', base, base + Vector((0, 0, 26.0)), 2.2, 2.2, M['frame'], up=(0, 1, 0),
                                 taper=0.4), uvw=0.3, col=0))
    parts.append(PP.meta(PP.tube('stern_lamp', base + Vector((0, 0, 25.5)), base + Vector((0, 0, 28.0)), 1.1, 8,
                                 M['white']), uvw=0.2, col=0))
    return tagged(parts, cat=11)


def build_ring(M, rng):
    """One quadrant (-45..45 degrees) of the habitat ring: the torus arc,
    segment collars and fittings. Copied to the other three after the bake."""
    parts = []
    prof = PP.rounded_rect(RING_Y, RING_R, RING_HY, RING_HR, RING_RC, per_corner=2)

    parts.append(PP.meta(PP.revolve('torus', prof, M['ring'], 20, math.radians(-45), math.radians(45), closed=True,
                                    side='left', uv='strip', uv_radius=RING_R), uvfix=1))
    cprof = PP.rounded_rect(RING_Y, RING_R, RING_HY + 1.3, RING_HR + 1.3, RING_RC + 1.3, per_corner=1)
    for k, phi in enumerate((-45.0, -30.0, -15.0, 0.0, 15.0, 30.0)):
        parts.append(PP.revolve(f'collar{k}', cprof, M['collar'], 1, math.radians(phi - 0.65), math.radians(phi + 0.65),
                                closed=True, caps=True, sharp=30))
    # fittings on the outer wall and the side walls (all within 2.8 m of the skin)
    for k in range(18):
        phi = rng.uniform(-44.0, 44.0)
        if min(abs(phi - c) for c in (-45, -30, -15, 0, 15, 30, 45)) < 2.4:
            continue
        where = rng.choice(('out', 'out', 'side', 'side', 'in'))
        a = math.radians(phi)
        radial = Vector((math.cos(a), 0, math.sin(a)))
        tang = Vector((-math.sin(a), 0, math.cos(a)))
        flat_y = RING_HY - RING_RC - 0.5                 # half extent of the flat outer and inner walls
        flat_r = RING_HR - RING_RC - 0.5                 # half extent of the flat side walls
        if where == 'out':
            size = (rng.uniform(3, 7), rng.uniform(5, 12), rng.uniform(0.8, 2.4))
            loc = radial * (RING_R + RING_HR) + Vector((0, RING_Y + rng.uniform(-1, 1) * (flat_y - size[0] / 2), 0))
            n = radial
        elif where == 'in':
            size = (rng.uniform(2, 3.5), rng.uniform(4, 9), rng.uniform(0.8, 2.0))
            loc = radial * (RING_R - RING_HR) + Vector((0, RING_Y + rng.choice((-1, 1)) * (flat_y - size[0] / 2), 0))
            n = -radial
        else:
            s = rng.choice((-1, 1))
            size = (rng.uniform(3, 6), rng.uniform(3, 6), rng.uniform(0.6, 1.6))
            loc = radial * (RING_R + rng.uniform(-1, 1) * (flat_r - size[0] / 2)) + Vector((0, RING_Y + s * RING_HY, 0))
            n = Vector((0, s, 0))
        parts.append(greeble(f'rbox{k}', size, M, frame_at(loc, n, tang), rng, taper=0.85, sink=0.5))
    return tagged(parts, uvw=1.0, grp=G_RING, cat=20)


# ==========================================================================
# Turrets: separate nodes with factor materials

def turret_materials():
    return (C.flat_material('turret_body', OFF, 0.55, 0.12),
            C.flat_material('turret_gun', GRAPHITE, 0.42, 0.65))


def build_turret(name, frame, mats):
    body_m, gun_m = mats
    parts = [S.lathe(name + '_ring', [(0.0, 0.0), (0.0, 5.4), (1.2, 5.4), (1.9, 4.8), (2.2, 4.8), (2.2, 0.0)], 12,
                     (0, 0), body_m, sharp=40)]
    PP.transformed(parts[0], Matrix.Rotation(math.radians(90), 4, 'X'))
    parts.append(S.box(name + '_house', (7.6, 8.4, 3.6), body_m, Matrix.Translation((0, -0.8, 3.8)), taper=0.78))
    parts.append(S.box(name + '_sight', (1.6, 2.0, 1.2), gun_m, Matrix.Translation((2.6, -2.6, 6.0))))
    base = C.join(parts, name)
    base.matrix_world = frame
    gparts = [S.box(name + '_mantlet', (4.6, 3.2, 2.8), gun_m, Matrix(), taper=0.9)]
    for sx in (-1.25, 1.25):
        gparts.append(S.lathe(f'{name}_barrel{sx}', [(1.2, 0.0), (1.2, 0.72), (3.6, 0.72), (3.9, 0.48), (10.9, 0.48),
                                                     (11.0, 0.7), (12.4, 0.7), (12.4, 0.0)], 8, (sx, 0.0), gun_m,
                              sharp=40))
    gun = C.join(gparts, name + '_gun')
    gun.parent = base
    gun.matrix_parent_inverse = Matrix()
    gun.location = (0, 0.6, 4.6)
    return base, gun


# ==========================================================================
# Empties

def empty(name, loc, radius=None, rot=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'SPHERE' if name.startswith(('col_', 'sub_')) else 'ARROWS'
    e.empty_display_size = 1.0
    e.location = loc
    if rot is not None:
        e.rotation_mode = 'QUATERNION'
        e.rotation_quaternion = rot
    if radius is not None:
        e.scale = (radius, radius, radius)
    return C.link(e)


def launch_rotation(direction):
    """A rotation whose local -Y points along `direction`."""
    d = Vector(direction).normalized()
    return (-d).to_track_quat('Y', 'Z')


RIM_Y = yb(DISH_R) - 5.0
RED, GREEN, WHITE = (1.0, 0.08, 0.04), (0.1, 1.0, 0.3), (1.0, 1.0, 1.0)
LIGHTS = [('light_%02d' % i, pos, colour, blink) for i, (pos, colour, blink) in enumerate([
    # lamp centre (about 0.9 m proud of the hull), colour, blink period (s; 0 = steady)
    ((-(DISH_R + 1.6), RIM_Y, 0.0), RED, 0.0),                    # shield rim, port
    ((DISH_R + 1.6, RIM_Y, 0.0), GREEN, 0.0),                     # shield rim, starboard
    ((0.0, RIM_Y, DISH_R + 1.6), WHITE, 1.6),                     # shield rim, top: strobe
    ((0.0, APEX + LAYERS[0][1] + 11.9, 0.0), WHITE, 2.4),         # nose boss: prow strobe
    ((-52.9, 263.0, 8.0), RED, 0.0),                              # hangar, port
    ((52.9, 263.0, 8.0), GREEN, 0.0),                             # hangar, starboard
    ((0.0, 560.0, 123.7), WHITE, 1.2),                            # bridge mast top: strobe
    ((0.0, 188.0, -86.9), WHITE, 1.2),                            # hangar belly, aft of the bay: strobe
    ((-(RAD_TIP + 4.9), -355.0, 0.0), RED, 0.0),                  # radiator tip, port
    ((RAD_TIP + 4.9, -355.0, 0.0), GREEN, 0.0),                   # radiator tip, starboard
    ((0.0, -479.0, 108.3), WHITE, 2.0),                           # stern mast: strobe
    (tuple(polar(82.9, 200.0, -479.0)), RED, 0.0),                # thrust plate, port
    (tuple(polar(82.9, -20.0, -479.0)), GREEN, 0.0),              # thrust plate, starboard
])]

TURRETS = [
    # name, pivot, outward normal (turrets 00-03 on the drum's diagonal flats)
    ('turret_00', polar(CMD_R + 2.6, 135.0, 590.0), polar(1, 135.0, 0)),
    ('turret_01', polar(CMD_R + 2.6, 45.0, 590.0), polar(1, 45.0, 0)),
    ('turret_02', polar(CMD_R + 2.6, 225.0, 497.0), polar(1, 225.0, 0)),
    ('turret_03', polar(CMD_R + 2.6, 315.0, 497.0), polar(1, 315.0, 0)),
]


def hangar_chamfer(top, sx, y):
    """A point and normal on one of the hangar module's chamfers."""
    if top:
        a, b = Vector((52.0, 0, 20.0)), Vector((38.0, 0, 36.0))
    else:
        a, b = Vector((52.0, 0, -74.0)), Vector((42.0, 0, -86.0))
    m = (a + b) / 2
    t = (b - a).normalized()
    n = Vector((t.z, 0, -t.x)) if top else Vector((-t.z, 0, t.x))
    if n.x < 0:
        n = -n
    return Vector((sx * m.x, y, m.z)), Vector((sx * n.x, 0, n.z))


def turret_spots():
    spots = list(TURRETS)
    for name, top, sx, y in (('turret_04', True, -1, 334.0), ('turret_05', True, 1, 334.0),
                             ('turret_06', False, -1, 192.0), ('turret_07', False, 1, 192.0)):
        p, n = hangar_chamfer(top, sx, y)
        spots.append((name, p + n * 2.6, n))
    for name, phi in (('turret_08', 180.0), ('turret_09', 0.0)):
        spots.append((name, polar(82.0 + 2.6, phi, -479.0), polar(1, phi, 0)))
    return spots


# ==========================================================================
# Bake

def bake_set(name, parts, tex, groups, uv_margin):
    t0 = time.time()
    PP.stamp(parts)
    obj = C.join(parts, name)
    PP.unwrap(obj, uv_margin)
    C.log(f'  {name}: unwrapped {len(obj.data.polygons)} faces in {time.time() - t0:.0f} s')
    C.triangulate(obj)
    obj.data.set_sharp_from_angle(angle=math.radians(40))
    sb, sn, sm, sg = (256, 256, 128, 256) if FAST else tex
    base = C.new_image(name + '_base', sb)
    nrm = C.new_image(name + '_normal', sn, non_color=True)
    rough = C.new_image(name + '_rough', sm, non_color=True)
    metal = C.new_image(name + '_metal', sm, non_color=True)
    glow = C.new_image(name + '_emissive', sg)
    high = C.duplicate(obj, name + '_high')
    bev = high.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.45
    bev.segments = 2
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(40)
    C.apply_modifiers(high)
    high.data.shade_smooth()
    C.bake(obj, nrm, 'NORMAL', sources=[high], extrusion=0.3, max_ray=0.6, margin=max(2, sn // 256),
           samples=1 if FAST else 3)
    bpy.data.objects.remove(high)
    C.log(f'  {name}: normals baked at {time.time() - t0:.0f} s')
    s = 1 if FAST else 8
    C.bake(obj, base, channel='albedo', margin=max(2, sb // 256), samples=s)
    C.log(f'  {name}: albedo baked at {time.time() - t0:.0f} s')
    C.bake(obj, rough, channel='rough', margin=max(2, sm // 256), samples=1 if FAST else 2)
    C.bake(obj, metal, channel='metal', margin=max(2, sm // 256), samples=1)
    C.bake(obj, glow, channel='glow', margin=max(2, sg // 256), samples=1 if FAST else 2)
    mr = C.pack_mr(name + '_mr', rough, metal)
    dump = os.environ.get('METEORA_DUMP')
    if dump:
        for img in (base, nrm, mr, glow):
            copy = img.copy()
            copy.filepath_raw = os.path.join(dump, img.name + '.png')
            copy.file_format = 'PNG'
            copy.save()
            bpy.data.images.remove(copy)
    mat = C.baked_material(name, base, nrm, mr, glow)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.data.polygons.foreach_set('material_index', [0] * len(obj.data.polygons))
    PP.apply_instances(obj, groups)
    C.log(f'  {name}: baked in {time.time() - t0:.0f} s')
    return obj


# ==========================================================================
# Colliders

def ring_colliders(count=20, radius=31.0):
    return [(tuple(polar(RING_R, 360.0 * k / count, RING_Y)), radius) for k in range(count)]


BAY = (Vector((0.0, 263.0, -86.0)), Vector((0, 0.25, -1.0)).normalized())


def fit_hull_colliders(hull, fixed, budget, tol=3.0):
    """Greedy sphere cover of the hull faces tagged col=1 (with the ring's
    spheres given as already placed): the smallest bulge bound whose cover
    fits the budget."""
    t0 = time.time()
    col = PP.face_attr(hull, 'col')
    keep = col >= 1
    pts, nrm, w, spoly = PP.surface_samples(hull, keep, 7.0 if not FAST else 10.0)
    bm = bmesh.new()
    bm.from_mesh(hull.data)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if col[f.index] < 1]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    rng = np.random.default_rng(5)
    pick = rng.choice(len(pts), size=min(len(pts), 4500 if not FAST else 1200), replace=False)
    centres = []
    for i in pick:
        p, n = Vector(pts[i]), Vector(nrm[i])
        hit, _, _, d = tree.ray_cast(p - n * 0.05, -n, 400.0)
        if hit is None:
            continue
        centres.append(tuple(p - n * (0.05 + d / 2)))
    keep_out = [(BAY[0] + BAY[1] * d, 8.0) for d in (0.0, 25.0, 50.0)]
    for y in np.arange(-700.0, 716.0, 8.0):
        centres.append((0.0, float(y), 0.0))
    for phi in ENG_PHI:
        e = polar(ENG_R, phi, 0.0)
        for y in np.arange(-700.0, -488.0, 8.0):
            centres.append((e.x, float(y), e.z))
    # the shield's mid-surface, the radiator stacks' mid-planes, the spoke axes,
    # the hangar block's inside and the sphere tanks' centres
    for r in np.arange(0.0, 170.0, 8.0):
        mid = (yb(r) + rise(r) + back_y(r)) / 2
        for phi in (np.arange(0.0, 360.0, 6.0) if r > 0 else (0.0,)):
            centres.append(tuple(polar(float(r), float(phi), mid)))
    for sx in (-1, 1):
        for x in np.arange(31.0, RAD_TIP + 3.0, 6.0):
            for y in np.arange(RAD[0], RAD[1] + 1.0, 8.0):
                centres.append((sx * float(x), float(y), 0.0))
    for phi in (0.0, 90.0, 180.0, 270.0):
        for r in np.arange(50.0, RING_R - RING_HR, 5.0):
            centres.append(tuple(polar(float(r), phi, RING_Y)))
    for x in np.arange(-35.0, 36.0, 14.0):
        for z in np.arange(-72.0, 30.0, 14.0):
            for y in np.arange(HANGAR[0] + 6.0, HANGAR[1], 14.0):
                centres.append((float(x), float(y), float(z)))
    for (yc, dist, R), phi0, n in ((TANK_B_BIG, 45.0, 4), (TANK_B_SMALL, 0.0, 4)):
        for k in range(n):
            centres.append(tuple(polar(dist, phi0 + 90.0 * k, yc)))
    radii = [4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0, 26.0, 28.0, 31.0, 34.0, 37.0, 40.0,
             44.0, 48.0, 52.0, 57.0, 62.0, 68.0, 74.0, 81.0, 90.0, 100.0]
    dirs = PP.fibonacci(40 if not FAST else 24)
    table = PP.bulge_table(tree, centres, radii, dirs)
    C.log(f'  colliders: {len(pts)} samples, {len(centres)} candidates, table in {time.time() - t0:.0f} s')
    if os.environ.get('METEORA_COLDEBUG'):
        cat = PP.face_attr(hull, 'cat')[spoly]
        for bound in (20.0, 25.0, 30.0, 35.0, 40.0):
            chosen, covered = PP.greedy_cover(pts, w, centres, radii, table, bound, tol, 600, fixed=fixed, keep_out=keep_out)
            P = np.asarray(pts)
            owner = {}
            for c, r, _ in chosen:
                inside = np.linalg.norm(P - np.asarray(c), axis=1) <= r + tol
                vals, counts = np.unique(cat[inside], return_counts=True)
                key = CATS.get(int(vals[np.argmax(counts)]), '?') if len(vals) else '?'
                owner[key] = owner.get(key, 0) + 1
            C.log(f'    debug bound {bound:.0f}: {len(chosen)} spheres:', ', '.join(f'{k} {v}' for k, v in sorted(owner.items())))
    best = None
    for bound in (12.0, 15.0, 18.0, 21.0, 24.0, 27.0, 30.0, 33.0, 36.0, 40.0, 45.0, 50.0):
        chosen, covered = PP.greedy_cover(pts, w, centres, radii, table, bound, tol, budget - 4, fixed=fixed,
                                          keep_out=keep_out)
        frac = w[covered].sum() / w.sum()
        C.log(f'    bound {bound:.0f} m: {len(chosen)} spheres, {frac * 100:.3f} % covered')
        if best is None or frac > best[2] + 1e-9:
            best = (bound, chosen, frac, covered)
        if frac >= 0.9999:
            break
    bound, chosen, frac, covered = best
    spheres = [(c, r) for c, r, _ in chosen]
    # patch what is left with small spheres on the nearest medial candidates
    P = np.asarray(pts)
    C_ = np.asarray(centres)
    for _ in range(4):
        left = np.nonzero(~covered)[0]
        if len(left) == 0:
            break
        i = left[0]
        d = np.linalg.norm(C_ - P[i], axis=1)
        k = int(np.argmin(np.where(d < 12.0, d, np.inf)))
        if not np.isfinite(d[k]) or d[k] >= 12.0:
            k = int(np.argmin(d))
        r = float(d[k]) + 0.5
        spheres.append((tuple(C_[k]), r))
        covered |= np.linalg.norm(P - C_[k], axis=1) <= r + tol
    C.log(f'    patched to {w[covered].sum() / w.sum() * 100:.3f} % with {len(spheres)} spheres')
    spheres = PP.tighten(pts, spheres, tol, fixed=fixed)
    C.log(f'  colliders: bound {bound:.0f} m, {len(spheres)} spheres after tightening, {time.time() - t0:.0f} s')
    return spheres, (pts, w, keep)


def coverage(points, spheres, tol):
    P = np.asarray(points)
    cov = np.zeros(len(P), bool)
    for c, r in spheres:
        cov |= np.linalg.norm(P - np.asarray(c), axis=1) <= r + tol
    return cov


# ==========================================================================
# Anchors module

def r3(v, nd=3):
    return [round(float(x), nd) + 0.0 for x in v]


def fmt(v):
    return '[' + ', '.join(f'{x:g}' for x in v) + ']'


def write_anchors(data):
    path = os.path.join(C.JS, 'anchors', NAME + '.js')
    L = [
        f'/* Meteora — {NAME} anchors. GENERATED by tools/blender/build_perpetua.py from',
        f'   the empties in {NAME}.glb; do not edit by hand. glTF space, metres: nose',
        '   along -Z, top +Y, right +X. Nozzle `dir` is the exhaust direction and',
        '   `size` the exit radius; bay `dir` the launch direction; turret `up` is the',
        "   node's local +Y in glTF (its Blender +Z) and `fwd` where the barrels point",
        "   at rest (local -Z in glTF); `size` is the turret's radius about its pivot.",
        '   The ring node turns about the Z axis through its origin; every collider is',
        "   valid at any spin angle (the ring's are evenly spaced round it, the spokes",
        '   and their yokes are static hull). */',
        'export default {',
        f"  radius: {data['radius']:g},",
        f"  length: {data['length']:g},",
        '  nozzles: [',
    ]
    L += [f"    {{ name: '{n['name']}', pos: {fmt(n['pos'])}, dir: {fmt(n['dir'])}, size: {n['size']:g} }},"
          for n in data['nozzles']]
    L += ['  ],', '  muzzles: [],', '  rcs: [],', '  launchers: [],', '  cockpit: null,', '  dock: null,', '  colliders: [']
    L += [f"    {{ pos: {fmt(c['pos'])}, r: {c['r']:g} }}," for c in data['colliders']]
    L += ['  ],', '  subsystems: [']
    L += [f"    {{ name: '{s['name']}', kind: '{s['kind']}', pos: {fmt(s['pos'])}, r: {s['r']:g} }},"
          for s in data['subsystems']]
    L += ['  ],', '  turrets: [']
    L += [f"    {{ name: '{t['name']}', pos: {fmt(t['pos'])}, up: {fmt(t['up'])}, fwd: {fmt(t['fwd'])}, size: {t['size']:g} }},"
          for t in data['turrets']]
    L += ['  ],', '  bays: [']
    L += [f"    {{ name: '{b['name']}', pos: {fmt(b['pos'])}, dir: {fmt(b['dir'])} }}," for b in data['bays']]
    L += ['  ],', '  lights: [']
    L += [f"    {{ name: '{l['name']}', pos: {fmt(l['pos'])}, color: {fmt(l['color'])}, blink: {l['blink']:g} }},"
          for l in data['lights']]
    L += ['  ],', '  nodes: { ' + ', '.join(f"{k}: '{v}'" for k, v in data['nodes'].items()) + ' },', '};']
    with open(path, 'w') as f:
        f.write('\n'.join(L) + '\n')
    C.log('wrote', os.path.relpath(path, C.ROOT))


def gltf_dir(mw, local):
    return r3(C.to_gltf((mw.to_3x3() @ Vector(local)).normalized()), 4)


# ==========================================================================

def build():
    t0 = time.time()
    C.reset(samples=8)
    rng = random.Random(1300)
    M = materials()
    hull_parts = []
    for builder in (build_dish, build_neck, build_command, build_forward, build_hangar, build_tanks_a, build_hub,
                    build_tanks_b, build_aft, build_radiators, build_stern):
        hull_parts += builder(M, rng)
    spots = turret_spots()
    for name, p, n in spots:
        hull_parts.append(sponson(name + '_sponson', M, p - Vector(n) * 2.6, n))
    for name, pos, colour, blink in LIGHTS:
        mat = M['red'] if colour == RED else M['green'] if colour == GREEN else M['white']
        hull_parts.append(PP.meta(S.box(name + '_lamp', (2.6, 2.6, 2.6), mat, Matrix.Translation(Vector(pos))),
                                  uvw=0.3, col=0, cat=12))
    ring_parts = build_ring(M, rng)
    for o in hull_parts + ring_parts:
        if o.data.attributes.get('tint') is None:
            set_tint(o, 0.0)
    bad = [(o.name, round(f, 2)) for o in hull_parts + ring_parts for f in [PP.inside_out(o)] if f > 0.02]
    if bad:
        C.log('  inside-out parts:', bad[:20])
    if os.environ.get('METEORA_CHECK'):
        C.log('  floating hull parts:', PP.floating(hull_parts) or 'none')
        C.log('  floating ring parts:', PP.floating(ring_parts) or 'none')
        def sec(co):                                    # distance outside the ring's rounded section
            qy = abs(co.y - RING_Y) - (RING_HY - RING_RC)
            qr = abs(math.hypot(co.x, co.z) - RING_R) - (RING_HR - RING_RC)
            return math.hypot(max(qy, 0.0), max(qr, 0.0)) + min(max(qy, qr), 0.0) - RING_RC
        ring_out = max(sec(v.co) for o in ring_parts for v in o.data.vertices)
        yoke_in = min(sec(v.co) for o in hull_parts if o.name.startswith('yoke') for v in o.data.vertices)
        C.log(f'  ring sweep: ring reaches {ring_out:.2f} m beyond its section, yokes start at {yoke_in:.2f} m')
    C.log(f'  geometry built in {time.time() - t0:.0f} s')

    mats = turret_materials()
    turrets = [build_turret(name, frame_at(p, n, (0, 1, 0)), mats) for name, p, n in spots]

    hull_groups = {
        G_DISH: [about_y(0, a) for a in range(45, 360, 45)],
        G_SPOKE: [about_y(0, a) for a in (90, 180, 270)],
        G_TANK_A: [about_y(90, a) for a in (30, 150, 210, 330)],
        G_SPH_BIG: [about_y(45, a) for a in (135, 225, 315)],
        G_SPH_SMALL: [about_y(0, a) for a in (90, 180, 270)],
        G_RAD: [Matrix.Scale(-1, 4, (1, 0, 0))],
        G_ENGINE: [about_y(ENG_PHI[0], a) for a in ENG_PHI[1:]],
    }
    hull = bake_set('hull', hull_parts, (2048, 2048, 1024, 2048), hull_groups, 0.0025)
    ring = bake_set('ring', ring_parts, (1024, 1024, 512, 1024), {G_RING: [about_y(0, a) for a in (90, 180, 270)]},
                    0.004)
    # weld the copies' seams (shield back sectors to each other, the ring's quadrants)
    def near_angle(co, offset, step):
        d = (math.degrees(math.atan2(co.z, co.x)) - offset) % step
        return min(d, step - d) < 0.05
    PP.weld_where(hull, lambda co: 638.0 < co.y < 650.0 and math.hypot(co.x, co.z) < 199.0
                  and near_angle(co, 22.5, 45.0), 0.05)
    PP.weld_where(ring, lambda co: near_angle(co, 45.0, 90.0), 0.05)
    report = PP.vertex_report(hull, CATS)
    C.log('  hull vertices by part:', ', '.join(f'{k} {v}' for k, v in report.items()))
    C.log('  ring vertices:', PP.vertex_report(ring, CATS)['total'])
    ring.data.transform(Matrix.Translation((0, -RING_Y, 0)))
    ring.location = (0, RING_Y, 0)
    bpy.context.view_layer.update()

    # empties
    empties = []
    for k in range(3):
        e = polar(ENG_R, ENG_PHI[k], 0.0)
        empties.append(empty(f'nozzle_{k}', (e.x, EXIT_Y - 0.6, e.z)))
        empties.append(empty(f'sub_engine_{k}', (e.x, -596.0, e.z), radius=38.0))
    empties.append(empty('sub_bridge', (0.0, 553.0, 64.0), radius=24.0))
    empties.append(empty('sub_hangar', (0.0, 263.0, -66.0), radius=48.0))
    empties.append(empty('bay_0', BAY[0], rot=launch_rotation(BAY[1])))
    for name, pos, colour, blink in LIGHTS:
        empties.append(empty(name, pos))
    ring_cols = ring_colliders()
    spheres, (pts, w, keep) = fit_hull_colliders(hull, ring_cols, 90 - len(ring_cols))
    for k, (c, r) in enumerate(spheres):
        empties.append(empty(f'col_{k:02d}', c, radius=round(r, 1)))
    ring_empties = [empty(f'col_{len(spheres) + k:02d}', c, radius=r) for k, (c, r) in enumerate(ring_cols)]
    for e in empties:
        e.parent = hull
    for e in ring_empties:
        e.parent = ring
        e.matrix_parent_inverse = ring.matrix_world.inverted()
    for base, gun in turrets:
        base.parent = hull
    bpy.context.view_layer.update()

    # coverage report over every hull and ring vertex (the test checks the same)
    all_cols = spheres + ring_cols
    co = np.array([tuple(v.co) for v in hull.data.vertices])
    rco = np.array([tuple(ring.matrix_world @ v.co) for v in ring.data.vertices])
    C.log(f'  colliders: {len(all_cols)} spheres; hull vertices covered {coverage(co, all_cols, 4.0).mean() * 100:.2f} %, '
          f'ring vertices {coverage(rco, all_cols, 4.0).mean() * 100:.2f} %, '
          f'tagged samples {coverage(pts, all_cols, 3.0).mean() * 100:.2f} %')

    tris = C.tri_count(hull) + C.tri_count(ring) + sum(C.tri_count(b) + C.tri_count(g) for b, g in turrets)
    C.log(f'  {NAME}: hull {C.tri_count(hull)} + ring {C.tri_count(ring)} + turrets '
          f'{sum(C.tri_count(b) + C.tri_count(g) for b, g in turrets)} = {tris} tris')
    objs = [hull, ring] + [o for pair in turrets for o in pair] + empties + ring_empties
    C.export_glb(os.path.join(C.MODELS, NAME + '.glb'), objs)

    # anchors
    meshes = [hull, ring] + [o for pair in turrets for o in pair]
    vmax, zmin, zmax = 0.0, 1e9, -1e9
    for o in meshes:
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            vmax = max(vmax, p.length)
            zmin, zmax = min(zmin, -p.y), max(zmax, -p.y)
    data = dict(radius=round(vmax, 1), length=round(zmax - zmin, 1), nodes={'ring': 'ring'})
    data['nozzles'] = []
    for k in range(3):
        e = bpy.data.objects[f'nozzle_{k}']
        data['nozzles'].append(dict(name=e.name, pos=r3(C.to_gltf(e.matrix_world.translation)),
                                    dir=gltf_dir(e.matrix_world, (0, -1, 0)), size=EXIT_R))
    data['colliders'] = [dict(pos=r3(C.to_gltf(Vector(c)), 2), r=round(r, 1)) for c, r in all_cols]
    data['subsystems'] = []
    for nm in ('sub_bridge', 'sub_hangar', 'sub_engine_0', 'sub_engine_1', 'sub_engine_2'):
        e = bpy.data.objects[nm]
        data['subsystems'].append(dict(name=nm, kind=nm.split('_')[1], pos=r3(C.to_gltf(e.matrix_world.translation), 2),
                                       r=round(e.scale.x, 1)))
    data['turrets'] = []
    for base, gun in turrets:
        mw = base.matrix_world
        size = max((mw @ v.co - mw.translation).length for v in base.data.vertices)
        gmw = gun.matrix_world
        size = max(size, max((gmw @ v.co - mw.translation).length for v in gun.data.vertices))
        data['turrets'].append(dict(name=base.name, pos=r3(C.to_gltf(mw.translation), 2),
                                    up=gltf_dir(mw, (0, 0, 1)), fwd=gltf_dir(mw, (0, 1, 0)), size=round(size, 1)))
    b = bpy.data.objects['bay_0']
    data['bays'] = [dict(name='bay_0', pos=r3(C.to_gltf(b.matrix_world.translation), 2),
                         dir=gltf_dir(b.matrix_world, (0, -1, 0)))]
    data['lights'] = [dict(name=n, pos=r3(C.to_gltf(Vector(p)), 2), color=list(c), blink=bl) for n, p, c, bl in LIGHTS]
    write_anchors(data)
    C.log(f'{NAME} done in {time.time() - t0:.0f} s')
    return tris


def main(only=None):
    if only and NAME not in only:
        C.log('nothing to build (the perpetua group has one model: perpetua)')
        return
    build()


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
