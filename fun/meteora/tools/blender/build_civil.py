"""Meteora — the Belt's civilian ships: the Mule ore freighter, Varlaam
station and the colony ark Long Mercy, with js/anchors/<name>.js.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \\
    --python fun/meteora/tools/blender/build_civil.py [-- freighter station colony]

Modelled in Blender space, nose along +Y, top +Z, right +X (the glTF export
turns that into nose -Z, top +Y). Every part is a bmesh primitive with a
procedural paint material (civil_parts.finish: panel seams, replacement
plates, AO grime, rust bleeding, chipped edges, stencils); the parts are
joined per texture set, unwrapped and baked in Cycles. Big hulls carry
their scale in geometry — modules, girders, tanks, greebles at several
sizes — and their lit windows are separate panels that repeat a small
window tile (crisp at any distance, no atlas space).

Anchors are empties: nozzle_* (exhaust along local -Y), col_NN (uniform
scale = radius), sub_<kind>[_n] (scale = hit radius), bay_N (launch along
local -Y), light_N, dock; turrets are mesh nodes turret_NN (yaw pivot,
local +Z up) with a child turret_NN_gun (trunnion, barrels along +Y).

Set METEORA_FAST=1 for quick geometry iterations (tiny textures, 1 sample).
"""
import bpy, bmesh, math, os, random, re, sys, time
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S
import build_asteroids as A
import civil_parts as P

FAST = P.FAST
band, hazard, finish = P.band, P.hazard, P.finish
WHITE, WHITE_B, WARM_GREY, DARK_GREY = P.WHITE, P.WHITE_B, P.WARM_GREY, P.DARK_GREY
GRAPHITE, STEEL, RUST, HAZARD, TEAL, GOLD = P.GRAPHITE, P.STEEL, P.RUST, P.HAZARD, P.TEAL, P.GOLD

NAV_RED, NAV_GREEN = (1.0, 0.08, 0.05), (0.1, 1.0, 0.3)
STROBE, AMBER, FLOOD = (1.0, 1.0, 1.0), (1.0, 0.55, 0.12), (1.0, 0.92, 0.78)


def sign_of(g, v):
    return g.math('SIGN', v)


def nozzle_paint(name, centre_x, centre_z, r_ref):
    """Bare heat-tinted metal on the outside of a bell, soot inside (where
    the normal faces the engine axis through |x| = centre_x, z = centre_z)."""
    def build(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        if centre_x:
            rx, nxm = g.sub(g.absolute(x), centre_x), g.mul(sign_of(g, x), nx)
        else:
            rx, nxm = x, nx
        rz = g.sub(z, centre_z)
        rl = g.maximum(g.vmath('LENGTH', g.combine(rx, 0.0, rz), out=1), 1e-3)
        facing = g.math('DIVIDE', g.add(g.mul(nxm, rx), g.mul(nz, rz)), rl)
        inner = g.smooth(facing, 0.1, -0.25)
        tint = g.ramp(g.noise(P_, 0.4 / r_ref, 3.0), [(0.3, (0.3, 0.27, 0.24)), (0.55, (0.2, 0.2, 0.26)),
                                                      (0.8, (0.36, 0.28, 0.2))])
        col = g.mix(inner, tint, P.SOOT)
        return finish(g, col, g.mixf(inner, 0.35, 0.6), g.mixf(inner, 0.7, 0.2), P_, N, lines=False, wear=0.0,
                      grime=0.5, ao=r_ref, edge=0.1, chips=(3, 0.4), grain=0.3)
    return S.material(name, build)


# ==========================================================================
# Mule — ore freighter, ~111 m

FR_STATIONS = (8.0, -8.0, -23.6)          # container stations (centre y)
FR_FRAMES = (31.0, 16.0, 0.0, -16.0, -31.0)
FR_FX, FR_FZ = 13.4, 11.2
FR_NUMBERS = ['07', '12', '21', '04', '33', '18', '26', '09', '15', '30', '02', '11']


def freighter_materials():
    kw = dict(size=(4.8, 2.4), line=0.09, depth=0.03, ao=1.8, streak=(0.6, 14.0), edge=0.12, chips=(3.0, 0.5),
              grain=0.0)
    name_img, name_cells, name_aspect = P.text_image('fr_name', ['MULE-07'])
    num_img, num_cells, num_aspect = P.text_image('fr_numbers', FR_NUMBERS)

    def cab(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        side = g.smooth(g.absolute(nx), 0.65, 0.8)
        lower = g.sub(1.0, g.smooth(z, -0.9, -0.75))
        col = g.mix(lower, WHITE, WARM_GREY)
        col = g.mix(g.mul(band(g, z, -0.55, 0.45, 0.03), side), col, RUST)
        col = g.mix(g.mul(band(g, z, -0.8, -0.66, 0.02), side), col, GRAPHITE)
        chin = g.mul(band(g, z, -5.6, -3.6, 0.03), g.smooth(y, 52.9, 53.5))
        col = g.mix(chin, col, g.mix(hazard(g, x, z, 0.6), GRAPHITE, HAZARD))
        H, Wd = 2.3, 2.3 * name_aspect
        u = g.add(0.5, g.mul(sign_of(g, x), g.math('DIVIDE', g.sub(y, 43.3), Wd)))
        v = g.math('DIVIDE', g.sub(z, -3.9), H)
        letters = g.mul(P.decal(g, name_img, name_cells, u, v), side)
        col = g.mix(letters, col, WHITE)
        return finish(g, col, g.mixf(lower, 0.42, 0.5), 0.15, P_, N, rust=0.35, **kw)

    def bridge(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        col = g.mix(g.sub(1.0, g.smooth(z, 7.6, 7.8)), WHITE, RUST)
        visor = g.mul(band(g, z, 13.75, 14.35, 0.02), g.sub(1.0, g.smooth(nz, 0.6, 0.8)))
        col = g.mix(visor, col, GRAPHITE)
        return finish(g, col, 0.42, 0.15, P_, N, rust=0.25, **kw)

    def metal(g, P_, N):
        return finish(g, STEEL, 0.55, 0.45, P_, N, rust=0.9, wear=0.7, tint=0.12, **kw)

    def frame(g, P_, N):
        return finish(g, WARM_GREY, 0.52, 0.25, P_, N, rust=1.0, wear=1.3, tint=0.1, **kw)

    def gusset(g, P_, N):
        x, y, z = g.sep(P_)
        col = g.mix(hazard(g, g.add(x, y), z, 0.45), GRAPHITE, HAZARD)
        return finish(g, col, 0.5, 0.2, P_, N, rust=0.8, wear=1.4, lines=False, **kw)

    def container(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        cid, cx, cy, cz, var = (g.attribute(k) for k in ('cid', 'cx', 'cy', 'cz', 'cvar'))
        ly, lz = g.sub(y, cy), g.sub(z, cz)
        tone = g.ramp(var, [(0.0, lin_mul(RUST, 0.85)), (0.35, RUST), (0.62, lin_mul(RUST, 1.1)),
                            (0.84, WHITE_B), (0.92, TEAL)], 'CONSTANT')
        col = g.mix(g.mul(g.sub(1.0, g.smooth(var, 0.84, 0.85)), g.smooth(g.noise(P_, 0.15, 3.0), 0.3, 0.7)),
                    tone, lin_mul(RUST, 0.7))
        ends = g.smooth(g.absolute(ly), 6.05, 6.15)
        col = g.mix(ends, col, g.mix(hazard(g, g.add(x, y), z, 0.45), GRAPHITE, HAZARD))
        outer = g.mul(g.smooth(g.absolute(nx), 0.7, 0.8), g.math('GREATER_THAN', g.mul(nx, cx), 0.0))
        H = 5.0
        u = g.add(0.5, g.mul(sign_of(g, nx), g.math('DIVIDE', ly, H * num_aspect)))
        v = g.math('DIVIDE', g.add(lz, H / 2), H)
        ink = g.mix(band(g, var, 0.84, 0.92, 0.002), WHITE, GRAPHITE)      # dark stencils on the off-white box
        col = g.mix(g.mul(P.decal(g, num_img, num_cells, u, v, cid), outer), col, ink)
        rib = g.mul(g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', ly, 0.9)), 0.5)), 0.18, 0.3),
                    g.sub(1.0, ends))
        height = g.mul(rib, 0.05)
        return finish(g, col, 0.5, 0.25, P_, N, rust=0.7, wear=1.2, height=height, tint=0.1, **kw)

    def hopper(g, P_, N):
        x, y, z = g.sep(P_)
        col = g.mix(g.smooth(z, 11.3, 11.45), WARM_GREY, g.mix(hazard(g, x, g.add(y, z), 0.5), GRAPHITE, HAZARD))
        return finish(g, col, 0.55, 0.3, P_, N, rust=1.0, wear=1.0, **kw)

    def pod(g, P_, N):
        x, y, z = g.sep(P_)
        col = g.mix(band(g, y, 22.4, 25.0, 0.03), WHITE, RUST)
        col = g.mix(g.add(g.smooth(y, 28.6, 28.8), g.sub(1.0, g.smooth(y, 18.4, 18.6))), col, WARM_GREY)
        return finish(g, col, 0.45, 0.2, P_, N, rust=0.5, **kw)

    def drive(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        lower = g.sub(1.0, g.smooth(z, -2.6, -2.4))
        col = g.mix(lower, WHITE, WARM_GREY)
        side = g.smooth(g.absolute(nx), 0.6, 0.75)
        col = g.mix(g.mul(band(g, y, -45.6, -44.5, 0.02), g.sub(1.0, g.smooth(ny, -0.5, -0.7))), col,
                    g.mix(hazard(g, g.add(x, z), y, 0.6), GRAPHITE, HAZARD))
        col = g.mix(g.mul(band(g, z, 0.8, 1.9, 0.03), side), col, RUST)
        soot = g.mul(g.smooth(y, -40.0, -46.5), g.smooth(g.noise(P_, 0.3, 3.0), 0.35, 0.6))
        col = g.mix(g.mul(soot, 0.8), col, (0.03, 0.028, 0.026))
        return finish(g, col, 0.45, 0.2, P_, N, rust=0.45, **kw)

    def tank(g, P_, N):
        x, y, z = g.sep(P_)
        col = g.mix(band(g, y, -39.2, -37.0, 0.03), WHITE, RUST)
        col = g.mix(band(g, y, -36.2, -35.8, 0.02), col, GRAPHITE)
        return finish(g, col, 0.4, 0.2, P_, N, rust=0.4, **kw)

    def radiator(g, P_, N):
        x, y, z = g.sep(P_)
        fins = g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', y, 0.75)), 0.5)), 0.15, 0.3)
        col = g.mix(fins, (0.13, 0.125, 0.118), (0.26, 0.25, 0.235))
        edge = g.smooth(g.absolute(x), 19.0, 19.4)
        col = g.mix(edge, col, g.mix(hazard(g, y, z, 0.5), GRAPHITE, HAZARD))
        return finish(g, col, 0.45, 0.6, P_, N, height=g.mul(fins, 0.03), wear=0.4, rust=0.3, **kw)

    def engine(g, P_, N):
        x, y, z = g.sep(P_)
        heat = g.smooth(y, -46.0, -48.4)
        col = g.mix(heat, WARM_GREY, (0.07, 0.06, 0.055))
        col = g.mix(band(g, y, -47.1, -46.3, 0.02), col, GRAPHITE)
        return finish(g, col, g.mixf(heat, 0.45, 0.4), g.mixf(heat, 0.3, 0.6), P_, N, rust=0.2, **kw)

    def pad(g, P_, N):
        x, y, z = g.sep(P_)
        rim = g.maximum(g.smooth(g.absolute(x), 2.6, 2.7), g.smooth(g.absolute(g.sub(y, 50.6)), 2.4, 2.5))
        col = g.mix(rim, (0.06, 0.06, 0.062), g.mix(hazard(g, x, y, 0.45), GRAPHITE, HAZARD))
        cross = g.mul(g.maximum(band(g, x, -0.2, 0.2, 0.02), band(g, y, 50.4, 50.8, 0.02)),
                      g.sub(1.0, g.smooth(g.vmath('LENGTH', g.combine(x, g.sub(y, 50.6), 0.0), out=1), 1.6, 1.7)))
        col = g.mix(cross, col, WHITE)
        return finish(g, col, 0.6, 0.2, P_, N, lines=False, **kw)

    hole = S.material('fr_hole', lambda g, P_, N: dict(albedo=P.SOOT, rough=0.7, metal=0.0))
    return dict(
        cab=S.material('fr_cab', cab), bridge=S.material('fr_bridge', bridge), metal=S.material('fr_metal', metal),
        frame=S.material('fr_frame', frame), gusset=S.material('fr_gusset', gusset),
        container=S.material('fr_container', container), hopper=S.material('fr_hopper', hopper),
        pod=S.material('fr_pod', pod), drive=S.material('fr_drive', drive), tank=S.material('fr_tank', tank),
        radiator=S.material('fr_radiator', radiator), engine=S.material('fr_engine', engine),
        pad=S.material('fr_pad', pad), hole=hole,
        nozzle_c=nozzle_paint('fr_nozzle_c', 0.0, 0.0, 3.2), nozzle_s=nozzle_paint('fr_nozzle_s', 7.8, -1.8, 2.4),
        throat=P.glow('fr_throat', (1.0, 0.62, 0.3), (0.5, 0.35, 0.2)),
        vent=P.glow('fr_vent', (1.0, 0.42, 0.1), (0.4, 0.15, 0.05)),
        red=P.glow('fr_red', NAV_RED, (0.3, 0.02, 0.02)), green=P.glow('fr_green', NAV_GREEN, (0.02, 0.3, 0.06)),
        white=P.glow('fr_white', STROBE, (0.6, 0.6, 0.6)), amber=P.glow('fr_amber', AMBER, (0.5, 0.3, 0.08)),
        flood=P.glow('fr_flood', FLOOD, (0.6, 0.58, 0.5)),
    )


def lin_mul(c, k):
    return tuple(min(1.0, v * k) for v in c)


def bell_hoops(name, y0, length, r_exit, r_throat, r_start, centre, mat, fractions=(0.42, 0.6, 0.78), sides=32):
    """Stiffening hoops round the outside of a bell_profile bell."""
    outer = bell_profile(y0, length, r_exit, r_throat, r_start)[:5]
    ys = [-p[0] for p in outer]
    rs = [p[1] for p in outer]
    w, h = max(0.25, r_exit * 0.035), max(0.15, r_exit * 0.022)
    parts = []
    for i, f in enumerate(fractions):
        y = y0 - length * f
        r = float(np.interp(-y, ys, rs))
        parts.append(S.lathe(f'{name}{i}', [(y - w, r - h), (y - w, r + h), (y + w, r + h), (y + w, r - h)], sides,
                             centre, mat, closed=True, sharp=40))
    return parts


def bell_profile(y0, length, r_exit, r_throat, r_start):
    """A closed engine bell wall, (y, r) rows: throat near y0, exit at
    y0 - length (aft is -Y)."""
    ye = y0 - length
    t = r_exit * 0.09
    return [(y0, r_start + t), (y0 - length * 0.3, r_throat + t * 1.6), (y0 - length * 0.7, r_exit * 0.93 + t),
            (ye + 0.1, r_exit + t * 1.2), (ye, r_exit + t * 1.2), (ye, r_exit), (y0 - length * 0.7, r_exit * 0.86),
            (y0 - length * 0.38, r_throat * 1.22), (y0 - length * 0.16, r_throat), (y0 - length * 0.05, r_throat * 1.05),
            (y0 + 0.02, r_start * 0.9)]


def build_freighter():
    M = freighter_materials()
    rng = random.Random(7)
    W = P.Windows(seed=11)
    parts, side = [], []

    # Cab: a chamfered block with a raked bridge on top, crew decks in its sides.
    cab_secs = [(35.0, 8.4, -5.4, 6.4, 1.8), (36.2, 10.0, -6.4, 7.4, 2.2), (48.5, 10.0, -6.4, 7.4, 2.2),
                (52.0, 9.2, -5.6, 6.6, 2.2), (54.5, 7.6, -4.2, 5.0, 1.8)]
    parts.append(P.loft('cab', [(y, P.chamfer_rect(hw, zb, zt, c)) for y, hw, zb, zt, c in cab_secs], M['cab']))
    br = [(6.4, 8.2, 41.4, 51.8, 1.5), (10.4, 8.6, 41.2, 53.4, 1.7), (13.6, 9.0, 41.4, 55.6, 1.9),
          (14.5, 8.6, 41.8, 55.0, 1.7)]
    parts.append(P.loft('bridge', [(z, P.chamfer_rect(hw, yb, yf, c)) for z, hw, yb, yf, c in br], M['bridge'],
                        axis='Z'))
    (z1, hw1, yb1, yf1, c1), (z2, hw2, yb2, yf2, c2) = br[1], br[2]
    cell = (1.9, 2.8)
    W.quad([(-hw1 + c1, yf1, z1), (hw1 - c1, yf1, z1), (hw2 - c2, yf2, z2), (-hw2 + c2, yf2, z2)], cell,
           (0, 1, -0.5), inset=(0.03, 0.1))
    for s in (1, -1):
        W.quad([(s * (hw1 - c1), yf1, z1), (s * hw1, yf1 - c1, z1), (s * hw2, yf2 - c2, z2), (s * (hw2 - c2), yf2, z2)],
               cell, (s, 1, -0.5), inset=(0.08, 0.1))
        zc = 12.0
        xc = hw1 + (zc - z1) * (hw2 - hw1) / (z2 - z1)
        W.panel((s * xc, 48.4, zc), (0, 1, 0), (s * (hw2 - hw1), 0, z2 - z1), 7.6, 2.6, cell, out=(s, 0, 0))
        W.panel((s * 10.0, 42.4, 2.9), (0, 1, 0), (0, 0, 1), 10.0, 3.6, (2.0, 1.8), out=(s, 0, 0))
        xb = 8.2 + (8.4 - 6.4) * (8.6 - 8.2) / (10.4 - 6.4)
        W.panel((s * xb, 46.0, 8.4), (0, 1, 0), (s * 0.4, 0, 4.0), 8.0, 2.6, (2.0, 2.6), out=(s, 0, 0))
    # dock pad, mast, dish and antennae on the bridge roof
    parts.append(P.block('pad', (0, 50.6, 14.6), (6.2, 5.8, 0.3), M['pad']))
    parts.append(P.cylinder('mast', (0, 43.6, 14.3), (0, 43.6, 20.8), 0.32, M['metal'], sides=6))
    parts.append(P.bars('mast_x', [((-2.4, 43.6, 19.2), (2.4, 43.6, 19.2)), ((-1.6, 43.6, 17.4), (1.6, 43.6, 17.4))],
                        0.2, M['metal'], up=(0, 1, 0)))
    parts += P.dish('dish', (-4.6, 44.4, 14.6), (-0.3, 0.5, 1.0), 1.5, M['metal'], depth=0.3, sides=12)
    parts.append(P.cylinder('whip', (5.4, 42.8, 14.4), (5.8, 41.6, 22.0), 0.06, M['metal'], sides=4))
    parts.append(P.cylinder('whip2', (-5.8, 42.6, 14.4), (-6.1, 41.8, 19.0), 0.06, M['metal'], sides=4))
    # nose: docking collar, floodlights, chin sensor
    parts.append(S.lathe('collar', [(54.3, 0.0), (54.3, 3.2), (55.6, 3.2), (55.9, 2.9), (55.9, 2.3), (55.5, 2.1),
                                    (55.5, 0.0)], 24, (0, -0.6), M['metal'], sharp=35))
    for s in (-1, 1):
        parts.append(P.block(f'flood{s}', (s * 5.0, 54.1, -2.9), (1.8, 1.2, 1.2), M['metal']))
        parts.append(P.block(f'floodlens{s}', (s * 5.0, 54.75, -2.9), (1.4, 0.12, 0.8), M['flood']))
    parts.append(P.sphere('chin', (0, 50.0, -6.3), 1.6, M['metal'], segs=12, rings=6, squash=0.6))
    parts.append(P.block('belly_hatch', (0, 42.0, -6.5), (3.4, 4.2, 0.4), M['metal'], taper=0.9, z=(0, 0, -1)))
    # side hatches, rails, and RCS quads at the cab corners
    for s in (-1, 1):
        for zz in (5.0, -4.4):
            side.append(P.block(f'rcs{s}{zz}', (s * 9.9, 50.6, zz), (0.9, 1.4, 1.0), M['metal'], taper=0.8,
                                z=(s, 0, 0)))

    # Neck and spine
    parts.append(P.block('neck', (0, 33.6, 0.2), (9.0, 4.8, 9.0), M['frame']))
    parts.append(P.cylinder('collar_n', (0, 31.2, 0), (0, 32.0, 0), 5.0, M['metal'], sides=12))
    parts.append(P.block('spine', (0, 0.5, 0), (6.0, 64.0, 6.0), M['metal']))
    for s in (-1, 1):
        for zz in (2.3, -2.3):
            parts.append(P.pipe(f'spipe{s}{zz}', [(s * 3.35, 34.5, zz), (s * 3.35, -31.5, zz)], 0.42, M['metal']))
    parts.append(P.pipe('topipe1', [(-0.9, 33.0, 3.5), (-0.9, -31.5, 3.5)], 0.5, M['tank'], sides=8))
    parts.append(P.pipe('topipe2', [(0.6, 33.0, 3.45), (0.6, -31.5, 3.45)], 0.4, M['metal'], sides=6))
    parts.append(P.block('catwalk', (1.8, 0.5, 3.2), (1.2, 63.0, 0.35), M['metal']))

    # Cargo frames: rectangular rings round the container grid.
    e = 0.55
    for i, y in enumerate(FR_FRAMES):
        segs = [((-FR_FX - e, y, FR_FZ), (FR_FX + e, y, FR_FZ)), ((-FR_FX - e, y, -FR_FZ), (FR_FX + e, y, -FR_FZ)),
                ((FR_FX, y, -FR_FZ), (FR_FX, y, FR_FZ)), ((-FR_FX, y, -FR_FZ), (-FR_FX, y, FR_FZ)),
                ((2.9, y, 0), (FR_FX, y, 0)), ((-2.9, y, 0), (-FR_FX, y, 0)),
                ((0, y, 2.9), (0, y, FR_FZ)), ((0, y, -2.9), (0, y, -FR_FZ))]
        parts.append(P.bars(f'frame{i}', segs, 1.2, M['frame'], h=1.6, up=(0, 1, 0)))
        for sx in (-1, 1):
            for sz in (-1, 1):
                parts.append(P.block(f'gusset{i}{sx}{sz}', (sx * FR_FX, y, sz * FR_FZ), (1.9, 2.0, 1.9), M['gusset']))

    # Containers: 2 x 2 round the spine at three stations, one slot empty.
    k = 0
    for si, ys in enumerate(FR_STATIONS):
        for sx, sz in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            if si == 2 and (sx, sz) == (-1, -1):
                continue
            cx, cz = sx * 8.15, sz * 5.95
            body = P.loft(f'cont{k}', [(ys + d, P.chamfer_rect(4.75, cz - 4.65, cz + 4.65, 0.4, cx)) for d in (-6.7, 6.7)],
                          M['container'])
            ribs = [P.loft(f'cont{k}r{j}', [(ys + d + dd, P.chamfer_rect(4.88, cz - 4.78, cz + 4.78, 0.45, cx))
                                            for dd in (-0.3, 0.3)], M['container']) for j, d in enumerate((-2.6, 2.6))]
            # rust-orange in three shades, plus two replacement boxes from
            # other haulers (old off-white, faded teal)
            var = {4: 0.88, 9: 0.95}.get(k, rng.random() * 0.8)
            for o in [body] + ribs:
                P.tag(o, cid=k, cx=cx, cy=ys, cz=cz, cvar=var)
            parts += [body] + ribs
            k += 1

    # Station A: two ore hoppers on top, two ore pods below.
    for s in (-1, 1):
        cx = s * 6.6
        secs = [(2.5, 2.2, 2.6, 0.4), (6.5, 4.9, 6.0, 0.5), (11.4, 5.9, 6.6, 0.5), (12.3, 6.1, 6.8, 0.5)]
        parts.append(P.loft(f'hopper{s}', [(z, P.chamfer_rect(hw, 23.5 - hl, 23.5 + hl, c, cx)) for z, hw, hl, c in secs],
                            M['hopper'], axis='Z'))
        parts.append(P.block(f'lid{s}', (cx, 23.5, 12.55), (7.4, 9.6, 0.5), M['frame'], taper=0.94))
        parts.append(P.cylinder(f'hinge{s}', (cx - 3.6, 18.4, 12.9), (cx - 3.6, 28.6, 12.9), 0.35, M['metal'], sides=6))
        px = s * 7.6
        parts.append(P.capsule(f'pod{s}', (px, 17.4, -6.0), (px, 29.8, -6.0), 4.55, M['pod'], sides=18))
        for yy in (20.6, 26.6):
            parts.append(P.cylinder(f'strap{s}{yy}', (px, yy - 0.4, -6.0), (px, yy + 0.4, -6.0), 4.7, M['metal'], sides=18))
    parts.append(P.truss('loader', (0, 16.0, 13.7), (0, 31.0, 13.7), 1.6, M['metal'], bay=3.6, up=(0, 0, 1),
                         battens=False))
    parts.append(P.bars('loader_posts', [((0, 16.0, 11.6), (0, 16.0, 13.2)), ((0, 31.0, 11.6), (0, 31.0, 13.2))], 0.8,
                        M['metal'], up=(0, 1, 0)))

    # Drive section: engineering block, reactor housing with glowing vents,
    # fuel tanks, V radiators, one big and two smaller engines.
    rad_tip = {}
    dsecs = [(-31.0, 10.2, -8.8, 8.8, 2.6), (-44.6, 10.2, -8.8, 8.8, 2.6), (-46.4, 9.0, -7.6, 7.6, 2.2)]
    parts.append(P.loft('drive', [(y, P.chamfer_rect(hw, zb, zt, c)) for y, hw, zb, zt, c in dsecs], M['drive']))
    parts.append(P.cylinder('reactor', (0, -32.6, 8.6), (0, -43.4, 8.6), 3.7, M['engine'], sides=16))
    for s in (-1, 1):
        a = math.radians(38)
        n = Vector((s * math.sin(a), 0, math.cos(a)))
        c = Vector((0, -38.0, 8.6)) + n * 3.62
        parts.append(P.block(f'ventframe{s}', c, (1.0, 9.4, 0.3), M['metal'], z=n))
        parts.append(P.block(f'vent{s}', c + n * 0.08, (0.5, 8.8, 0.3), M['vent'], z=n))
        tx = s * 12.9
        parts.append(P.capsule(f'tank{s}', (tx, -30.4, -1.6), (tx, -43.0, -1.6), 3.3, M['tank'], sides=18))
        for yy in (-33.0, -36.7, -40.4):
            parts.append(P.cylinder(f'tstrap{s}{yy}', (tx, yy - 0.35, -1.6), (tx, yy + 0.35, -1.6), 3.42, M['metal'],
                                    sides=18))
        parts.append(P.pipe(f'feed{s}', [(tx - s * 1.0, -42.4, -2.8), (tx - s * 1.6, -44.4, -3.6),
                                          (s * 9.6, -45.2, -3.8)], 0.38, M['metal']))
        ang = math.radians(32)
        n = Vector((-s * math.sin(ang), 0, math.cos(ang)))
        spanv = Vector((s * math.cos(ang), 0, math.sin(ang)))
        hinge = Vector((s * 7.6, -38.6, 9.1))
        parts.append(P.block(f'radiator{s}', hinge + spanv * 6.9, (13.8, 11.0, 0.45), M['radiator'], z=n))
        rad_tip[s] = tuple(hinge + spanv * 13.85)
        parts.append(P.cylinder(f'rhinge{s}', (s * 7.6, -33.0, 9.1), (s * 7.6, -44.2, 9.1), 0.55, M['metal'], sides=8))
        for yy in (-35.0, -42.2):
            parts.append(P.bars(f'rstrut{s}{yy}', [((s * 4.2, yy, 8.8), tuple(hinge + spanv * 7.5 - n * 0.2 + Vector((0, yy + 38.6, 0))))],
                                0.35, M['metal']))
        for yy in (-35.5, -41.0):
            side.append(P.block(f'dvent{s}{yy}', (s * 10.25, yy, 4.6), (0.3, 3.6, 2.2), M['metal']))
    bell_c = bell_profile(-48.1, 7.9, 3.2, 1.72, 2.6)
    parts.append(S.lathe('eng_c', [(-44.0, 0.0), (-44.0, 4.7), (-46.2, 4.7), (-47.6, 4.3), (-48.4, 3.5), (-48.4, 0.0)],
                         32, (0, 0), M['engine'], sharp=40))
    parts.append(S.lathe('eng_c_ring', [(-46.3, 0.0), (-46.3, 4.85), (-46.9, 4.85), (-46.9, 0.0)], 32, (0, 0),
                         M['metal'], sharp=30))
    parts.append(S.lathe('bell_c', bell_c, 32, (0, 0), M['nozzle_c'], closed=True, sharp=35))
    parts += bell_hoops('hoop_c', -48.1, 7.9, 3.2, 1.72, 2.6, (0, 0), M['metal'], (0.5, 0.76), sides=24)
    parts.append(S.lathe('throat_c', [(-49.45, 0.0), (-49.45, 1.75), (-49.35, 1.75), (-49.35, 0.0)], 32, (0, 0),
                         M['throat'], sharp=30))
    for s in (-1, 1):
        cx = s * 7.8
        parts.append(S.lathe(f'eng_s{s}', [(-44.0, 0.0), (-44.0, 3.4), (-46.4, 3.4), (-47.6, 2.7), (-47.6, 0.0)], 24,
                             (cx, -1.8), M['engine'], sharp=40))
        parts.append(S.lathe(f'bell_s{s}', bell_profile(-47.4, 7.0, 2.4, 1.28, 1.95), 24, (cx, -1.8),
                             M['nozzle_s'], closed=True, sharp=35))
        parts += bell_hoops(f'hoop_s{s}', -47.4, 7.0, 2.4, 1.28, 1.95, (cx, -1.8), M['metal'], (0.62,), sides=16)
        parts.append(S.lathe(f'throat_s{s}', [(-48.55, 0.0), (-48.55, 1.3), (-48.45, 1.3), (-48.45, 0.0)], 24,
                             (cx, -1.8), M['throat'], sharp=30))

    # Lights: fixtures in the bake, empties for the game's sprites.
    lights = [('light_0', (-10.25, 48.0, 4.4), NAV_RED, 0.0, 'red'),
              ('light_1', (10.25, 48.0, 4.4), NAV_GREEN, 0.0, 'green'),
              ('light_2', rad_tip[-1], NAV_RED, 0.0, 'red'),
              ('light_3', rad_tip[1], NAV_GREEN, 0.0, 'green'),
              ('light_4', (0, 43.6, 21.1), STROBE, 1.2, 'white'),
              ('light_5', (0, -38.0, -9.05), STROBE, 1.2, 'white'),
              ('light_6', (0, 30.6, 14.75), AMBER, 2.0, 'amber'),
              ('light_7', (0, -42.0, 12.6), AMBER, 2.0, 'amber'),
              ('light_8', (-FR_FX - 0.9, 0.0, 0.0), NAV_RED, 0.0, 'red'),
              ('light_9', (FR_FX + 0.9, 0.0, 0.0), NAV_GREEN, 0.0, 'green')]
    empties, light_info = [], {}
    for name, pos, col, blink, mat in lights:
        parts.append(P.sphere(name + '_fix', pos, 0.42, M[mat], segs=8, rings=4))
        empties.append(P.anchor(name, pos))
        light_info[name] = (col, blink)
    parts += side

    windows = W.build('fr_windows', P.window_material('fr_windows'))
    windows.hide_render = True
    hull = P.bake_set('hull', parts, (2048, 1024), samples=None if FAST else (4, 4, 2))
    hull = P.attach_windows(hull, windows)

    empties += [P.launch('nozzle_C', (0, -56.0, 0), (0, -1, 0)),
                P.launch('nozzle_L', (-7.8, -54.4, -1.8), (0, -1, 0)),
                P.launch('nozzle_R', (7.8, -54.4, -1.8), (0, -1, 0)),
                P.anchor('dock', (0, 50.6, 14.8)),
                P.anchor('sub_bridge', (0, 49.0, 10.5), scale=8.5),
                P.anchor('sub_engine_0', (0, -48.0, 0.0), scale=9.0)]
    pts = P.surface_points([hull], 0.8)
    centres = [(0, 50.5, 4.5), (0, 41.5, 1.5), (0, 33.5, 0.0)]
    centres += [(sx * 7.0, 23.5, sz * 6.5) for sx in (-1, 1) for sz in (-1, 1)]
    centres += [(sx * 8.0, ys, sz * 6.0) for ys in FR_STATIONS for sx in (-1, 1) for sz in (-1, 1)]
    centres += [(0, -38.5, 0), (-12.9, -36.7, -1.6), (12.9, -36.7, -1.6), (-13.4, -38.6, 13.2), (13.4, -38.6, 13.2),
                (0, -51.5, 0), (-7.8, -50.5, -1.8), (7.8, -50.5, -1.8)]
    cc, rr, cov = P.fit_spheres(pts, centres, pct=99.5, pad=0.3)
    C.log(f'  freighter colliders: {len(cc)} spheres, coverage {cov * 100:.1f} %')
    empties += P.collider_empties(cc, rr)
    for e in empties:
        e.parent = hull
    return dict(meshes=[hull], turrets=[], empties=empties, lights=light_info,
                nozzles={'nozzle_C': 3.2, 'nozzle_L': 2.4, 'nozzle_R': 2.4}, turret_size=0, nodes={})


# ==========================================================================
# Varlaam — a mining town built into a ~150 m rock

ROCK_R = 150.0
ROCK_TRIS = 9000
ST_CELL = (2.7, 3.6)                       # window column pitch, deck height
TURRET_ST = 1.2                            # station turret scale (base radius 4.2 m)
# Planar cuts in unit-radius space (normal, distance, softness): the town
# plateau on top, the dock face in front, two cliffs, the reactor face
# behind and a flattened base.
VARLAAM_CUTS = [((0, 0, 1), 0.70, 0.025), ((0, 1, 0), 0.84, 0.02), ((0.96, -0.1, 0.25), 0.80, 0.012),
                ((-0.55, 0.8, 0.25), 0.82, 0.012), ((0.15, -0.9, -0.3), 0.80, 0.02), ((0, 0.15, -1), 0.75, 0.03)]
QUARRY_DIR, QUARRY_R, QUARRY_DEPTH, QUARRY_STEPS = (-0.93, 0.22, 0.28), 0.4, 0.27, 4


def rock_paint(name, radius):
    """build_asteroids' carbonaceous rock (regolith in pits, greyer fresh
    scarps, cracks, micro craters) plus the quarry's cut benches: warm
    ochre walls with strata, pale tailings on the bench floors."""
    def build(g):
        P_ = g.vmath('SCALE', g.coord('Object'), scale=1.0 / radius)
        N = g.geometry('Normal')
        radial = g.vmath('NORMALIZE', P_)
        slope = g.sub(1.0, g.vmath('DOT_PRODUCT', N, radial, out=1))
        cavity, crater, fresh, quarry = (g.attribute(k) for k in ('cavity', 'crater', 'fresh', 'quarry'))
        n1 = g.noise(P_, 1.3, 3.0, 0.55, 0.3)
        n2 = g.noise(P_, 5.5, 6.0, 0.6)
        n3 = g.noise(P_, 22.0, 4.0, 0.55)
        base = g.ramp(g.madd(n1, 0.7, g.mul(n2, 0.3)),
                      [(0.3, (0.052, 0.047, 0.041)), (0.48, (0.088, 0.079, 0.067)), (0.64, (0.12, 0.102, 0.08))])
        base = g.mix(g.mul(g.absolute(g.sub(n3, 0.5)), 0.45), base, (0.05, 0.045, 0.04), 'MULTIPLY')
        pit = g.smooth(g.mul(cavity, -1.0), 0.12, 0.7)
        reg = g.mul(g.maximum(pit, g.mul(crater, 0.7)), g.madd(n2, 0.7, 0.45))
        base = g.mix(g.mul(reg, 0.75), base, (0.16, 0.142, 0.12))
        steep = g.smooth(slope, 0.22, 0.5)
        expo = g.maximum(g.mul(steep, 0.6), g.mul(fresh, 0.5))
        base = g.mix(g.mul(expo, g.madd(n3, 0.6, 0.4)), base, (0.13, 0.124, 0.116))
        x, y, z = g.sep(P_)
        q = g.smooth(quarry, 0.05, 0.5)
        strata = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(g.add(z, g.mul(n2, 0.02)), 22.0)), 0.5)), 0.3, 0.45)
        qcol = g.mix(strata, (0.26, 0.15, 0.075), (0.15, 0.095, 0.06))
        flat = g.sub(1.0, g.smooth(g.vmath('DOT_PRODUCT', N, g.vmath('NORMALIZE', QUARRY_DIR), out=1), 0.75, 0.6))
        qcol = g.mix(g.mul(flat, 0.85), qcol, (0.2, 0.17, 0.135))
        base = g.mix(g.mul(q, 0.95), base, qcol)
        warped = g.vmath('ADD', P_, g.vmath('SCALE', g.noise(P_, 3.0, 3.0, 0.5, out='Color'), scale=0.12))
        crack = g.sub(1.0, g.smooth(g.voronoi(warped, 3.2, 'DISTANCE_TO_EDGE', 1.0, 'Distance'), 0.0, 0.02))
        crack = g.mul(g.mul(crack, g.smooth(g.noise(P_, 2.2, 2.0), 0.52, 0.62)), g.sub(1.0, q))
        base = g.mix(g.mul(crack, 0.55), base, (0.025, 0.022, 0.02))
        rough = g.map_range(n2, 0.3, 0.7, 0.95, 0.85)
        density = g.mul(g.mul(g.smooth(g.noise(P_, 1.6, 2.0, 0.5), 0.3, 0.7), g.sub(1.0, g.mul(fresh, 0.85))),
                        g.sub(1.0, q))
        h = A.micro_craters(g, P_, 5.0, 3.1, density)
        h = g.add(h, g.mul(A.micro_craters(g, P_, 11.0, 7.7, density), 0.9))
        h = g.add(h, g.mul(A.micro_craters(g, P_, 26.0, 1.9, g.madd(density, 0.6, 0.3)), 0.8))
        h = g.add(h, g.mul(g.sub(g.noise(P_, 9.0, 6.0, 0.6), 0.5), 0.014))
        h = g.sub(h, g.mul(crack, 0.005))
        h = g.add(h, g.mul(g.mul(strata, q), 0.002))
        return dict(albedo=base, rough=rough, metal=0.0, normal=g.bump(h, 1.0, radius))
    return C.source_material(name, build)


def varlaam_rock():
    """The high sculpt (unit sphere scaled to ROCK_R): an irregular body with
    knobs, fBm lumps, planar cuts, a terraced quarry pit on the -X flank and
    a few craters, with cavity / crater / fresh / quarry attributes."""
    rng = random.Random(31)
    mnoise.seed_set(31)
    offset = (rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50))
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=6 if FAST else 7, radius=1.0)
    bm.verts.ensure_lookup_table()
    n = len(bm.verts)
    D = np.array([v.co[:] for v in bm.verts])
    D /= np.linalg.norm(D, axis=1, keepdims=True)
    E = np.array([[e.verts[0].index, e.verts[1].index] for e in bm.edges])
    R = A.ellipsoid_radius(D, (1.0, 0.95, 0.86))
    for i in range(9):
        d = A.random_dir(rng)
        size = rng.uniform(0.2, 0.34)
        if d[2] > 0.5 or d[1] > 0.55 or d @ (np.array(QUARRY_DIR) / np.linalg.norm(QUARRY_DIR)) > 0.6:
            continue
        idx = int(np.argmax(D @ d))
        R = A.smax(R, A.blob_radius(D, [D[idx] * R[idx] * (1.0 - size * 0.55)], [size], 0.0), 0.08)
    lumps = A.fbm(D * R[:, None], offset, 0.9)
    R = R * (1.0 + 0.065 * 2.0 * lumps)
    fresh = np.zeros(n)
    for nrm, dist, soft in VARLAAM_CUTS:
        nrm = np.asarray(nrm, float) / np.linalg.norm(nrm)
        dn = D @ nrm
        t = np.where(dn > 1e-3, dist / np.maximum(dn, 1e-3), 1e9)
        cut = A.smin(R, t, soft)
        fresh = np.maximum(fresh, np.clip((R - cut) / 0.012, 0, 1))
        R = cut
    rough = 0.016 * A.fbm(D * 4.0, offset, 0.6, octaves=3) + 0.006 * A.fbm(D * 4.0, offset, 2.5, octaves=3)
    R = R * (1.0 + rough * (0.35 + 0.65 * fresh))
    P_ = D * R[:, None]
    qc = np.asarray(QUARRY_DIR, float) / np.linalg.norm(QUARRY_DIR)
    centre = P_[int(np.argmax(D @ qc))]
    x = np.linalg.norm(P_ - centre, axis=1) / QUARRY_R
    bowl = QUARRY_DEPTH * np.clip(1.0 - x * x, 0.0, None)
    k = bowl / (QUARRY_DEPTH / QUARRY_STEPS)
    fl = np.floor(k)
    s = np.clip((k - fl - 0.7) / 0.3, 0, 1)
    R = R - (fl + s * s * (3 - 2 * s)) * QUARRY_DEPTH / QUARRY_STEPS
    quarry = np.clip((1.1 - x) / 0.1, 0, 1)
    fresh = np.maximum(fresh, quarry)
    P_ = D * R[:, None]
    crater = np.zeros(n)
    craters = [((0.55, -0.35, -0.75), 0.3, 0.8), ((0.7, 0.45, -0.5), 0.2, 0.9), ((-0.4, -0.75, -0.5), 0.24, 0.7),
               ((-0.6, 0.35, -0.7), 0.16, 1.0)]
    for i in range(16):
        u = rng.random()
        r = (0.04 ** -1.6 - u * (0.04 ** -1.6 - 0.14 ** -1.6)) ** (-1 / 1.6)
        craters.append((A.random_dir(rng), r, rng.uniform(0.45, 0.9)))
    for c, r, depth in craters:
        c = np.asarray(c, float) / np.linalg.norm(c)
        if c[2] > 0.55 or c[1] > 0.7 or c @ qc > 0.75:
            continue
        idx = int(np.argmax(D @ c))
        dist = np.linalg.norm(P_ - P_[idx], axis=1)
        mask = dist < r * 2.2
        xx = dist[mask] / r
        R[mask] += A.crater_shape(xx) * r * 0.6 * depth
        crater[mask] = np.maximum(crater[mask], np.clip(1.15 - xx, 0, 1) * min(1.0, depth * 1.4))
    P_ = D * R[:, None]
    r_now = np.linalg.norm(P_, axis=1)
    cav = (r_now - A.laplacian(r_now, E, n, 12)) + 0.6 * (r_now - A.laplacian(r_now, E, n, 60))
    cav = np.clip(cav / (3.0 * cav.std() + 1e-9), -1, 1)
    for v, p in zip(bm.verts, P_ * ROCK_R):
        v.co = p
    high = C.object_from_bmesh('rock_sculpt', bm)
    for key, values in (('cavity', cav), ('crater', crater), ('fresh', fresh), ('quarry', quarry)):
        attr = high.data.attributes.new(key, 'FLOAT', 'POINT')
        attr.data.foreach_set('value', values.astype(np.float32))
    return high


def bake_rock(high, tex):
    """Decimate the sculpt to the game rock, unwrap it and bake normal,
    colour and roughness from the sculpt."""
    t0 = time.time()
    low = A.decimated(high, 'rock', ROCK_TRIS, smooth=2)
    for key in ('cavity', 'crater', 'fresh', 'quarry'):
        if key in low.data.attributes:
            low.data.attributes.remove(low.data.attributes[key])
    low.data.set_sharp_from_angle(angle=math.radians(58))
    charts = P.unwrap(low, margin=0.0015, edge=60.0, seed=75.0, extent=90.0)
    C.log(f'  rock: {C.tri_count(low)} tris, {charts} charts, UV coverage {P.uv_coverage(low) * 100:.0f} % '
          f'({time.time() - t0:.0f} s)')
    high.data.materials.append(rock_paint('rock_src', ROCK_R))
    C.placeholder_material(low)
    big, small = (256, 128) if FAST else tex
    base = C.new_image('rock_base', big)
    nrm = C.new_image('rock_normal', big, non_color=True)
    rough = C.new_image('rock_rough', small, non_color=True)
    reach = ROCK_R * 0.05
    kw = dict(sources=[high], extrusion=reach, max_ray=reach * 2.5, margin=max(2, big // 512))
    restore = P._normal_only([high])
    C.bake(low, nrm, 'NORMAL', samples=1 if FAST else 3, **kw)
    restore()
    C.bake(low, base, channel='albedo', samples=1 if FAST else 3, **kw)
    kw['margin'] = max(1, kw['margin'] // 2)
    C.bake(low, rough, channel='rough', samples=1 if FAST else 2, **kw)
    if not FAST:
        for img in (base, nrm, rough):
            P.soften(img)
    mr = C.pack_mr('rock_mr', rough)
    if os.environ.get('METEORA_DUMP'):
        for img in (base, nrm, mr):
            P.dump_image(img, os.environ['METEORA_DUMP'])
    mat = C.baked_material('rock', base, nrm, mr)
    low.data.materials.clear()
    low.data.materials.append(mat)
    C.log(f'  rock baked in {time.time() - t0:.0f} s')
    return low


def station_materials():
    kw = dict(size=(6.0, 3.0), line=0.14, depth=0.05, ao=6.0, streak=(1.2, 30.0), axis='Z', edge=0.25,
              chips=(6.0, 1.0), grain=0.0)
    name_img, name_cells, name_aspect = P.text_image('st_name', ['VARLAAM'])
    pad_img, pad_cells, pad_aspect = P.text_image('st_pad', ['V1', 'V2'])

    def hab(g, P_, N):
        x, y, z = g.sep(P_)
        tone = g.attribute('tone')
        accent = g.ramp(tone, [(0.0, RUST), (0.3, TEAL), (0.55, GOLD), (0.8, WARM_GREY)], 'CONSTANT')
        body = g.mix(g.smooth(tone, 0.88, 0.9), WHITE, WHITE_B)
        level = g.math('FRACT', g.math('DIVIDE', z, 22.0))
        stripe = band(g, level, 0.04, 0.12, 0.01)
        col = g.mix(stripe, body, accent)
        return finish(g, col, 0.48, 0.12, P_, N, rust=0.5, patch=0.12, **kw)

    def concrete(g, P_, N):
        return finish(g, WARM_GREY, 0.75, 0.0, P_, N, rust=0.3, wear=0.6, grime=1.4, **kw)

    def metal(g, P_, N):
        return finish(g, STEEL, 0.5, 0.5, P_, N, rust=0.8, wear=0.7, **kw)

    def frame(g, P_, N):
        return finish(g, WARM_GREY, 0.5, 0.3, P_, N, rust=1.0, wear=1.2, **kw)

    def ochre(g, P_, N):
        return finish(g, RUST, 0.55, 0.15, P_, N, rust=0.9, wear=1.2, patch=0.15, patch_col=lin_mul(RUST, 0.75),
                      **kw)

    def dome(g, P_, N):
        x, y, z = g.sep(P_)
        cx, cy, cz, r = (g.attribute(k) for k in ('dcx', 'dcy', 'dcz', 'dr'))
        lx, ly, lz = g.sub(x, cx), g.sub(y, cy), g.sub(z, cz)
        az = g.math('ARCTAN2', ly, lx)
        el = g.math('DIVIDE', lz, g.maximum(r, 1.0))
        rib_a = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(az, 20 / (2 * math.pi))), 0.5)), 0.44, 0.47)
        rib_e = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(el, 7.0)), 0.5)), 0.43, 0.47)
        rib = g.maximum(rib_a, rib_e)
        sk = g.sub(1.0, g.smooth(lz, 0.3, 0.6))
        frame_m = g.maximum(rib, sk)
        cell = g.noise(g.combine(g.math('FLOOR', g.mul(az, 20 / (2 * math.pi))), g.math('FLOOR', g.mul(el, 7.0)), cx),
                       3.3, 1.0, 0.5)
        lit = g.smooth(cell, 0.42, 0.46)
        glass = g.mix(lit, (0.02, 0.028, 0.03), (0.06, 0.09, 0.05))
        glowc = g.mix(g.smooth(cell, 0.6, 0.65), (0.35, 0.55, 0.22), (1.0, 0.82, 0.55))
        col = g.mix(frame_m, glass, WHITE)
        glow = g.mix(frame_m, g.mix(lit, (0, 0, 0), glowc), (0, 0, 0))
        return finish(g, col, g.mixf(frame_m, 0.08, 0.5), g.mixf(frame_m, 0.0, 0.2), P_, N, lines=False, wear=0.5,
                      glow=glow, **{k: v for k, v in kw.items() if k not in ('size', 'line')})

    def pad(g, P_, N):
        x, y, z = g.sep(P_)
        cx, cy, cid = (g.attribute(k) for k in ('pcx', 'pcy', 'pid'))
        lx, ly = g.sub(x, cx), g.sub(y, cy)
        rim = g.maximum(g.smooth(g.absolute(lx), 10.6, 10.9), g.smooth(g.absolute(ly), 10.6, 10.9))
        col = g.mix(rim, (0.07, 0.068, 0.066), g.mix(hazard(g, lx, ly, 0.9), GRAPHITE, HAZARD))
        ring = band(g, g.vmath('LENGTH', g.combine(lx, ly, 0.0), out=1), 7.4, 8.2, 0.05)
        col = g.mix(ring, col, WHITE)
        H = 6.0
        letters = P.decal(g, pad_img, pad_cells, g.add(0.5, g.math('DIVIDE', lx, H * pad_aspect)),
                          g.add(0.5, g.math('DIVIDE', ly, H)), cid)
        col = g.mix(g.mul(letters, g.smooth(g.sep(N)[2], 0.7, 0.9)), col, WHITE)
        return finish(g, col, 0.7, 0.1, P_, N, lines=False, **kw)

    def dockwhite(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        col = WHITE
        col = g.mix(band(g, g.math('FRACT', g.math('DIVIDE', y, 24.0)), 0.0, 0.06, 0.01), col, RUST)
        side = g.smooth(g.absolute(nx), 0.6, 0.8)
        H = 7.0
        u = g.add(0.5, g.mul(sign_of(g, x), g.math('DIVIDE', g.sub(y, 186.0), H * name_aspect)))
        letters = g.mul(P.decal(g, name_img, name_cells, u, g.add(0.5, g.math('DIVIDE', z, H))), side)
        col = g.mix(letters, col, GRAPHITE)
        return finish(g, col, 0.45, 0.15, P_, N, rust=0.35, **kw)

    def ring(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        az = g.math('ARCTAN2', z, x)
        sector = g.math('FRACT', g.mul(az, 16 / (2 * math.pi)))
        front = g.smooth(ny, 0.6, 0.8)
        col = g.mix(g.mul(band(g, sector, 0.0, 0.18, 0.01), front), WHITE, g.mix(hazard(g, g.mul(az, 50.0), y, 0.8),
                                                                              GRAPHITE, HAZARD))
        port = g.smooth(x, -0.5, 0.5)
        strip = g.mul(band(g, g.vmath('LENGTH', g.combine(x, z, 0.0), out=1), 51.4, 52.3, 0.05), front)
        lights = g.mul(strip, g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(az, 48 / (2 * math.pi))), 0.5)), 0.3, 0.38))
        glow = g.mix(port, (1.0, 0.08, 0.05), (0.1, 1.0, 0.3))
        glow = g.mix(lights, (0, 0, 0), glow)
        col = g.mix(lights, col, (0.3, 0.3, 0.3))
        return finish(g, col, 0.42, 0.15, P_, N, rust=0.3, glow=glow, **kw)

    def baydoor(g, P_, N):
        x, y, z = g.sep(P_)
        edge = g.maximum(g.smooth(g.absolute(x), 5.4, 5.6), g.smooth(g.absolute(z), 3.9, 4.1))
        col = g.mix(edge, (0.03, 0.03, 0.032), g.mix(hazard(g, x, z, 0.6), GRAPHITE, HAZARD))
        slats = g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', z, 1.2)), 0.5)), 0.4, 0.46)
        col = g.mix(g.mul(slats, g.sub(1.0, edge)), col, (0.06, 0.06, 0.065))
        dots = g.mul(g.smooth(g.absolute(z), 3.2, 3.3), g.sub(1.0, edge))
        glow = g.mix(dots, (0, 0, 0), (1.0, 0.75, 0.3))
        return finish(g, col, 0.5, 0.4, P_, N, lines=False, glow=glow, **kw)

    def solar(g, P_, N):
        x, y, z = g.sep(P_)
        nz = g.absolute(g.sep(N)[2])
        cells = g.maximum(g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', y, 2.0)), 0.5)), 0.44, 0.48),
                          g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', g.add(x, z), 2.0)), 0.5)), 0.44,
                                   0.48))
        face = g.smooth(nz, 0.7, 0.9)
        col = g.mix(cells, (0.012, 0.022, 0.06), (0.25, 0.25, 0.26))
        col = g.mix(g.sub(1.0, face), col, STEEL)
        return finish(g, col, g.mixf(face, 0.5, 0.2), g.mixf(face, 0.5, 0.3), P_, N, lines=False, wear=0.3,
                      **{k: v for k, v in kw.items() if k not in ('size', 'line')})

    def reactor(g, P_, N):
        x, y, z = g.sep(P_)
        col = g.mix(band(g, g.math('FRACT', g.math('DIVIDE', z, 9.0)), 0.0, 0.12, 0.01), DARK_GREY,
                    g.mix(hazard(g, x, g.add(y, z), 0.8), GRAPHITE, HAZARD))
        return finish(g, col, 0.5, 0.4, P_, N, rust=0.6, **kw)

    def radiator(g, P_, N):
        x, y, z = g.sep(P_)
        fins = g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', z, 1.6)), 0.5)), 0.15, 0.3)
        col = g.mix(fins, (0.12, 0.118, 0.112), (0.24, 0.232, 0.22))
        heat = g.smooth(y, -132.0, -122.0)
        glow = g.mix(g.mul(heat, fins), (0, 0, 0), (0.55, 0.08, 0.02))
        return finish(g, col, 0.45, 0.6, P_, N, lines=False, height=g.mul(fins, 0.05), glow=glow,
                      **{k: v for k, v in kw.items() if k not in ('size', 'line')})

    hole = S.material('st_hole', lambda g, P_, N: dict(albedo=P.SOOT, rough=0.7, metal=0.0))
    return dict(
        hab=S.material('st_hab', hab), concrete=S.material('st_concrete', concrete),
        metal=S.material('st_metal', metal), frame=S.material('st_frame', frame), ochre=S.material('st_ochre', ochre),
        dome=S.material('st_dome', dome), pad=S.material('st_pad', pad), dockwhite=S.material('st_dockwhite', dockwhite),
        ring=S.material('st_ring', ring), baydoor=S.material('st_baydoor', baydoor),
        solar=S.material('st_solar', solar), reactor=S.material('st_reactor', reactor),
        radiator=S.material('st_radiator', radiator), hole=hole,
        vent=P.glow('st_vent', (1.0, 0.45, 0.12), (0.4, 0.15, 0.05)),
        red=P.glow('st_red', NAV_RED, (0.3, 0.02, 0.02)), green=P.glow('st_green', NAV_GREEN, (0.02, 0.3, 0.06)),
        white=P.glow('st_white', STROBE, (0.6, 0.6, 0.6)), amber=P.glow('st_amber', AMBER, (0.5, 0.3, 0.08)),
        flood=P.glow('st_flood', FLOOD, (0.6, 0.58, 0.5)),
    )


def hit(bvh, origin, direction):
    d = Vector(direction).normalized()
    loc, nrm, _, _ = bvh.ray_cast(Vector(origin), d)
    if loc is None:
        raise RuntimeError(f'ray from {tuple(origin)} along {tuple(d)} missed the rock')
    if nrm.dot(d) > 0:
        nrm = -nrm
    return loc, nrm


def radial(bvh, direction, dist=600.0):
    d = Vector(direction).normalized()
    return hit(bvh, d * dist, -d)


def ground_z(bvh, x, y, r=0.0, n=8):
    """Lowest and highest rock height under a disc of radius r at (x, y)."""
    zs = [hit(bvh, (x, y, 600), (0, 0, -1))[0].z]
    for k in range(n if r else 0):
        a = 2 * math.pi * k / n
        zs.append(hit(bvh, (x + r * math.cos(a), y + r * math.sin(a), 600), (0, 0, -1))[0].z)
    return min(zs), max(zs)


def round_tower(parts, W, M, name, x, y, bvh, height, r, sides, tone, rng, band_every=21.0):
    lo, hi = ground_z(bvh, x, y, r * 1.35)
    z0, zs = lo - 6.0, hi + 6.0
    top = hi + height
    m, _ = P.span((x, y, z0), (x, y, top), (0, 1, 0))
    ph = math.pi / sides
    parts.append(P.tag(P.cylinder(name, (x, y, z0), (x, y, top), r, M['hab'], sides=sides, up=(0, 1, 0)), tone=tone))
    parts.append(P.cylinder(name + '_pod', (x, y, z0), (x, y, zs), r * 1.35, M['concrete'], sides=sides, up=(0, 1, 0)))
    marks = [zs]
    while marks[-1] + band_every < top - 10:
        marks.append(marks[-1] + band_every)
    for k, zb in enumerate(marks[1:]):
        parts.append(P.cylinder(f'{name}_band{k}', (x, y, zb - 0.8), (x, y, zb + 0.8), r + 0.7, M['metal'],
                                sides=sides, up=(0, 1, 0)))
    duct = rng.randrange(sides)
    facets = [k for k in range(sides) if k != duct]
    for a, b in zip(marks, marks[1:] + [top - 2.0]):
        W.ring(m, r, sides, ph, a + 1.6 - z0, b - 1.4 - z0, ST_CELL, facets=facets)
    ang = 2 * math.pi * (duct + 0.5) / sides + ph
    out = m.to_3x3() @ Vector((math.cos(ang), 0, math.sin(ang)))
    c = Vector((x, y, (zs + top) / 2)) + out * (r * math.cos(math.pi / sides) + 0.5)
    parts.append(P.block(name + '_duct', c, (2.4, top - zs, 1.6), M['metal'], z=out, y=(0, 0, 1)))
    parts.append(P.cylinder(name + '_crown', (x, y, top - 0.5), (x, y, top + 5.0), r * 0.74, M['metal'], sides=sides,
                            up=(0, 1, 0)))
    parts.append(P.cylinder(name + '_roof', (x, y, top + 5.0), (x, y, top + 6.2), r * 0.8, M['concrete'], sides=sides,
                            up=(0, 1, 0)))
    for k in range(3):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0.2, 0.5) * r
        parts.append(P.block(f'{name}_mach{k}', (x + d * math.cos(a), y + d * math.sin(a), top + 7.2),
                             (rng.uniform(2, 4), rng.uniform(2, 4), 2.0), M['metal'], y=(math.cos(a), math.sin(a), 0)))
    return top + 6.2


def box_tower(parts, W, M, name, x, y, bvh, levels, tone, yaw=0.0):
    """Stacked boxes with setbacks: levels = [(width, depth, height), ...]."""
    w0, d0, _ = levels[0]
    lo, hi = ground_z(bvh, x, y, max(w0, d0) * 0.7)
    z = hi + 2.0
    fx = Vector((math.cos(yaw), math.sin(yaw), 0))
    fy = Vector((-math.sin(yaw), math.cos(yaw), 0))
    parts.append(P.block(name + '_pod', (x, y, (lo - 6 + z) / 2), (w0 * 1.15, d0 * 1.15, z - lo + 6), M['concrete'],
                         y=fy))
    for i, (w, d, h) in enumerate(levels):
        c = Vector((x, y, z + h / 2))
        parts.append(P.tag(P.block(f'{name}_l{i}', c, (w, d, h), M['hab'], y=fy), tone=tone))
        for axis, half, span_w in ((fx, w / 2, d), (-fx, w / 2, d), (fy, d / 2, w), (-fy, d / 2, w)):
            udir = axis.cross(Vector((0, 0, 1))).normalized()
            W.panel(c + axis * half, udir, (0, 0, 1), span_w * 0.84, h * 0.8, ST_CELL, out=axis)
        parts.append(P.block(f'{name}_lip{i}', (x, y, z + h + 0.4), (w + 1.2, d + 1.2, 0.8), M['metal'], y=fy))
        z += h + 0.8
    return z


def cliff_block(parts, W, M, name, bvh, theta, z, size, tone, rng, struts=True):
    """A house hanging on a cliff like the old monasteries: its back sunk in
    the rock, struts under its front edge."""
    d = Vector((math.cos(theta), math.sin(theta), 0))
    loc, nrm = hit(bvh, d * 600 + Vector((0, 0, z)), -d)
    out = Vector((nrm.x, nrm.y, 0))
    out = out.normalized() if out.length > 0.3 else d
    w, h, depth = size
    centre = loc + out * (depth * 0.5 - depth * 0.42)
    side = out.cross(Vector((0, 0, 1))).normalized()
    parts.append(P.tag(P.block(name, centre, (w, depth, h), M['hab'], y=out), tone=tone))
    parts.append(P.block(name + '_roof', centre + Vector((0, 0, h / 2 + 0.5)) + out * 0.6, (w + 1.4, depth + 1.2, 1.0),
                         M['metal'], y=out))
    W.panel(centre + out * depth / 2, side, (0, 0, 1), w * 0.85, h * 0.72, ST_CELL, out=out)
    for s in ((-1, 1) if struts else ()):
        a = centre + out * (depth / 2 - 0.6) + side * s * (w / 2 - 1.2) - Vector((0, 0, h / 2))
        try:
            b, _ = hit(bvh, a, -out * 0.55 - Vector((0, 0, 0.83)))
        except RuntimeError:
            continue
        if (b - a).length < 60:
            parts.append(P.bars(f'{name}_strut{s}', [(a, b - (b - a).normalized() * -1.5)], 1.1, M['metal'], up=out))
    return centre, out


def cliff_cluster(parts, W, M, name, bvh, theta, z, size, tone, rng):
    """A main cliff house, one or two smaller ones stacked beside and above
    it, and a walkway along their fronts."""
    w, h, depth = size
    c0, out = cliff_block(parts, W, M, name, bvh, theta, z, size, tone, rng)
    fronts = [c0 + out * (depth / 2 + 1.2) - Vector((0, 0, h / 2 - 0.4))]
    for k in range(1 + (rng.random() < 0.6)):
        sgn = rng.choice((-1, 1))
        th = theta + sgn * math.radians(rng.uniform(5, 9))
        zz = z + h * rng.uniform(0.6, 1.0) * (1 if k == 0 else -1)
        sz = (w * rng.uniform(0.5, 0.75), h * rng.uniform(0.7, 0.9), depth * rng.uniform(0.8, 1.0))
        try:
            ck, ok = cliff_block(parts, W, M, f'{name}_{k}', bvh, th, zz, sz, (tone + 0.31 * (k + 1)) % 1.0, rng)
        except RuntimeError:
            continue
        fronts.append(ck + ok * (sz[2] / 2 + 1.2) - Vector((0, 0, sz[1] / 2 - 0.4)))
    for k in range(len(fronts) - 1):
        a, b = fronts[0], fronts[k + 1]
        mid = Vector(((a.x + b.x) / 2, (a.y + b.y) / 2, a.z)) + out * 2.0
        parts.append(P.bars(f'{name}_walk{k}', [(a, mid), (mid, b)], 1.8, M['frame'], h=0.5, up=(0, 0, 1)))


def dome_at(parts, M, name, x, y, bvh, r):
    lo, hi = ground_z(bvh, x, y, r)
    c = Vector((x, y, hi - 1.0))
    parts.append(P.tag(P.dome(name, c, r, M['dome'], segs=20, rings=6, height=0.78, base=hi - lo + 4.0),
                       dcx=c.x, dcy=c.y, dcz=c.z, dr=r))
    parts.append(P.cylinder(name + '_curb', (x, y, lo - 4), (x, y, hi + 1.2), r * 1.04, M['concrete'], sides=20,
                            up=(0, 1, 0)))
    return c


def build_station():
    M = station_materials()
    rng = random.Random(41)
    t = time.time()
    high = varlaam_rock()
    C.log(f'  sculpt {time.time() - t:.0f} s')
    rock = bake_rock(high, (2048, 1024))
    bpy.data.objects.remove(high)
    bvh = S.bvh_of([rock])
    W = P.Windows(seed=23)
    parts, lights = [], []

    # --- The town on the plateau: towers, blocks, farm domes, a landing pad.
    tops = {}
    tops['A'] = round_tower(parts, W, M, 'towerA', -16, 6, bvh, 86, 13.0, 16, 0.1, rng)
    tops['C'] = round_tower(parts, W, M, 'towerC', 30, 34, bvh, 48, 9.5, 12, 0.35, rng)
    tops['D'] = round_tower(parts, W, M, 'towerD', -40, -32, bvh, 38, 11.0, 8, 0.6, rng, band_every=18.0)
    tops['B'] = box_tower(parts, W, M, 'towerB', 26, -18, bvh, [(18, 18, 36), (14, 14, 18), (9, 9, 9)], 0.85,
                          yaw=0.3)
    box_tower(parts, W, M, 'blockE', 2, -30, bvh, [(26, 16, 11)], 0.2, yaw=0.1)
    box_tower(parts, W, M, 'blockF', -58, 2, bvh, [(14, 24, 13)], 0.7, yaw=-0.2)
    box_tower(parts, W, M, 'blockG', 52, 6, bvh, [(16, 14, 16), (10, 10, 6)], 0.45, yaw=0.5)
    box_tower(parts, W, M, 'blockH', 6, 40, bvh, [(20, 14, 9)], 0.95, yaw=-0.1)
    dome_at(parts, M, 'domeA', 4, -62, bvh, 19.0)
    dome_at(parts, M, 'domeB', -46, 38, bvh, 14.0)
    pad_lo, pad_hi = ground_z(bvh, 42, -52, 12)
    pad_c = Vector((42, -52, pad_hi + 0.6))
    parts.append(P.tag(P.block('pad', (42, -52, (pad_lo - 3 + pad_hi + 1.2) / 2), (22, 22, pad_hi + 1.2 - pad_lo + 3),
                               M['pad']), pcx=42, pcy=-52, pid=0))
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        p = pad_c + Vector((sx * 10.6, sy * 10.6, 0.9))
        lights.append((f'pad{sx}{sy}', p, AMBER, 1.5, 'amber', 0.5))
    # sky bridges between towers
    for a, b, z, r in ((('towerA', -16, 6, 13.0), ('towerB', 26, -18, 9.0), 0.55, 2.4),
                       (('towerA', -16, 6, 13.0), ('towerC', 30, 34, 9.5), 0.42, 2.0)):
        pa, pb = Vector((a[1], a[2], 0)), Vector((b[1], b[2], 0))
        dirv = (pb - pa).normalized()
        zz = ground_z(bvh, a[1], a[2])[1] + 86 * z
        p0 = Vector((pa.x, pa.y, zz)) + dirv * (a[3] - 1.0)
        p1 = Vector((pb.x, pb.y, zz)) - dirv * (b[3] - 1.0)
        parts.append(P.cylinder(f'bridge_{a[0]}{b[0]}', p0, p1, r, M['hab'], sides=10))
        side = dirv.cross(Vector((0, 0, 1))).normalized()
        for s in (1, -1):
            W.panel((p0 + p1) / 2 + side * s * r * 0.95, dirv, (0, 0, 1), (p1 - p0).length * 0.8, r * 0.7,
                    (2.2, r * 0.7), out=side * s, snap=False)
    tower_top = Vector((-16, 6, tops['A']))
    parts.append(P.cylinder('spire', tower_top, tower_top + Vector((0, 0, 24)), 0.7, M['metal'], sides=6))
    lights.append(('spire', tower_top + Vector((0, 0, 24.6)), STROBE, 1.5, 'white', 0.8))

    # --- Cliff houses on the east and north-west faces, in clusters joined
    # by walkways; terraced houses stepping down from the plateau rim.
    for i, (theta, z, size, tone) in enumerate(((-6, 58, (26, 14, 14), 0.15), (14, 30, (20, 12, 12), 0.45),
                                                (-24, 14, (18, 16, 12), 0.7), (4, -4, (24, 10, 11), 0.25),
                                                (124, 44, (22, 14, 12), 0.55), (110, 18, (16, 12, 10), 0.9),
                                                (138, 20, (14, 10, 10), 0.3), (-40, 40, (16, 12, 11), 0.5),
                                                (30, 6, (16, 10, 10), 0.8))):
        cliff_cluster(parts, W, M, f'cliff{i}', bvh, math.radians(theta), z, size, tone, rng)
    for i, theta in enumerate(range(-170, 190, 26)):
        if 60 < theta < 120 or -112 < theta < -68:
            continue
        for tier, (z, scale) in enumerate(((91.0, 1.0), (70.0, 0.85))):
            th = math.radians(theta + tier * 13 + rng.uniform(-4, 4))
            w, h, d = rng.uniform(12, 20) * scale, rng.uniform(8, 13) * scale, rng.uniform(10, 14)
            try:
                cliff_block(parts, W, M, f'rim{i}_{tier}', bvh, th, z, (w, h, d), rng.random(), rng, struts=tier == 1)
            except RuntimeError:
                pass
    for i, theta in enumerate((35, 145, -35, -145)):
        d = Vector((math.cos(math.radians(theta)), math.sin(math.radians(theta)), 0))
        base_p, _ = hit(bvh, d * 600 + Vector((0, 0, 101)), -d)
        lo, hi = ground_z(bvh, base_p.x - d.x * 4, base_p.y - d.y * 4)
        b = Vector((base_p.x - d.x * 4, base_p.y - d.y * 4, hi - 2))
        parts.append(P.cylinder(f'beacon{i}', b, b + Vector((0, 0, 16)), 0.5, M['metal'], sides=6))
        lights.append((f'beacon{i}', b + Vector((0, 0, 16.5)), NAV_RED, 2.0, 'red', 0.6))
    # plazas and lanes between the plateau buildings
    for i, (x, y, w, d_, yaw) in enumerate(((0, 0, 90, 8, 0.15), (0, 0, 8, 110, 0.15), (24, 20, 40, 7, -0.5),
                                           (-30, -12, 7, 50, 0.6))):
        lo, hi = ground_z(bvh, x, y, max(w, d_) * 0.3)
        parts.append(P.block(f'lane{i}', (x, y, hi - 1.5), (w, d_, 3.4), M['concrete'],
                             y=(-math.sin(yaw), math.cos(yaw), 0)))
    # pipes over the rock, tank farms, airlock domes with work lamps
    for i, ends in enumerate((((0.12, -0.9, -0.32), (0.05, -0.55, 0.83)), ((-0.55, 0.62, -0.56), (-0.2, 0.75, 0.62)),
                              ((0.12, -0.9, -0.32), (0.9, -0.1, -0.42)))):
        a, b = Vector(ends[0]).normalized(), Vector(ends[1]).normalized()
        path = []
        for k in range(11):
            f = k / 10
            dd = a.slerp(b, f) if a.dot(b) > -0.99 else (a * (1 - f) + b * f).normalized()
            hp, hn = radial(bvh, dd)
            path.append(hp + hn * 2.4)
        parts.append(P.pipe(f'rockpipe{i}', path, 1.3, M['ochre' if i == 1 else 'metal'], sides=6))
    for i, d in enumerate(((0.62, -0.35, -0.7), (-0.75, 0.05, -0.66))):
        cp, cn = radial(bvh, d)
        t1 = cn.cross(Vector((0, 0, 1))).normalized()
        t2 = cn.cross(t1)
        for k in range(3):
            o = t1 * (k - 1) * 13.0 + t2 * (4.0 if k == 1 else -3.0)
            tp, tn = hit(bvh, cp + o + cn * 60.0, -cn)
            parts.append(P.sphere(f'tank{i}{k}', tp + tn * 4.5, 6.2, M['dockwhite'], segs=14, rings=8))
            parts.append(P.cylinder(f'tankfoot{i}{k}', tp - tn * 3.0, tp + tn * 2.0, 4.0, M['concrete'], sides=10))
        parts.append(P.pipe(f'tankpipe{i}', [cp - t1 * 13.0 + cn * 9.0, cp + cn * 10.0, cp + t1 * 13.0 + cn * 9.0], 0.9,
                            M['metal']))
    for i in range(12):
        d = Vector(A.random_dir(rng))
        if d.z > 0.55 or d.y > 0.7 or d.dot(Vector(QUARRY_DIR).normalized()) > 0.7:
            continue
        dp, dn = radial(bvh, d)
        parts.append(P.tag(P.dome(f'lock{i}', dp - dn * 0.5, 5.0, M['dome'], z=dn, segs=12, rings=3, height=0.7,
                                  base=3.0), dcx=dp.x, dcy=dp.y, dcz=dp.z, dr=5.0))
        parts.append(P.sphere(f'lamp{i}', dp + dn * 4.2, 0.45, M['flood'], segs=6, rings=3))

    # --- The dock: pylon, hub with the bay door, the docking ring on spokes.
    face, _ = hit(bvh, (0, 600, 0), (0, -1, 0))
    hub0, hub1, ring_y = 238.0, 270.0, 254.0
    parts.append(P.cylinder('pylon_root', (0, face.y - 14, 0), (0, face.y + 10, 0), 15.0, M['concrete'], r1=9.0,
                            sides=16))
    parts.append(P.cylinder('pylon', (0, face.y - 4, 0), (0, hub0 + 2, 0), 7.0, M['dockwhite'], sides=16))
    parts.append(P.truss('pylon_truss', (0, face.y + 6, 0), (0, hub0, 0), 17.0, M['frame'], bay=13.0, up=(0, 0, 1)))
    for s in (-1, 1):
        parts.append(P.pipe(f'pylon_pipe{s}', [(s * 4.2, face.y - 2, 5.6), (s * 4.2, hub0 + 1, 5.6)], 0.9, M['metal']))
    parts.append(S.lathe('hub', [(hub0, 0.0), (hub0, 10.0), (hub0 + 3.0, 13.0), (hub1 - 3.0, 13.0), (hub1, 11.0),
                                 (hub1, 0.0)], 24, (0, 0), M['dockwhite'], sharp=30, phase=math.pi / 24))
    parts.append(P.block('bay_door', (0, hub1 + 0.15, 0), (12.0, 0.6, 9.0), M['baydoor']))
    parts.append(S.lathe('dock_ring', [(ring_y - 5, 45.0), (ring_y - 5, 54.0), (ring_y - 3.5, 55.5),
                                       (ring_y + 3.5, 55.5), (ring_y + 5, 54.0), (ring_y + 5, 45.0),
                                       (ring_y + 3.5, 43.5), (ring_y - 3.5, 43.5)],
                         48, (0, 0), M['ring'], closed=True, sharp=30))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = Vector((math.cos(a), 0, math.sin(a)))
        c0 = Vector((0, ring_y, 0))
        parts.append(P.bars(f'spoke{k}', [(c0 + d * 12.0, c0 + d * 44.5)], 3.2, M['frame'], h=4.4, up=(0, 1, 0)))
    for k in range(8):
        a = math.radians(22.5 + 45 * k)
        c = Vector((49.5 * math.cos(a), ring_y + 5, 49.5 * math.sin(a)))
        parts.append(P.cylinder(f'port{k}', c - Vector((0, 0.6, 0)), c + Vector((0, 2.4, 0)), 2.6, M['metal'], sides=10))
        parts.append(P.cylinder(f'portlip{k}', c + Vector((0, 2.2, 0)), c + Vector((0, 2.8, 0)), 3.1, M['frame'],
                                sides=10))
    for k, (a, col, mat) in enumerate(((90, AMBER, 'amber'), (270, AMBER, 'amber'), (0, NAV_GREEN, 'green'),
                                       (180, NAV_RED, 'red'))):
        p = Vector((56.2 * math.cos(math.radians(a)), ring_y, 56.2 * math.sin(math.radians(a))))
        lights.append((f'ring{k}', p, col, 1.0 if mat == 'amber' else 0.0, mat, 0.9))
    W.ring(P.span((0, hub0, 0), (0, hub1, 0), (0, 0, 1))[0], 13.0, 24, math.pi / 24, 5.0, 27.0, (2.4, 3.2),
           facets=[k for k in range(24) if k % 6 not in (0, 1)])

    # --- Industry: the quarry with a gantry, a conveyor to the mill and silos.
    qdir = Vector(QUARRY_DIR).normalized()
    tang = qdir.cross(Vector((0, 0, 1))).normalized()
    up_q = tang.cross(qdir).normalized()
    rims = []
    for s in (-1, 1):
        d = (qdir + tang * s * 0.5).normalized()
        rims.append(radial(bvh, d))
    legs_top = []
    for (p, n), s in zip(rims, (-1, 1)):
        topp = p + qdir * 30.0 + tang * s * 3.0
        for t in (-1, 1):
            foot = p + up_q * t * 9.0 - n * 3.0
            parts.append(P.bars(f'gleg{s}{t}', [(foot, topp + up_q * t * 2.0)], 1.8, M['frame'], up=qdir))
        legs_top.append(topp)
    parts.append(P.truss('gantry', legs_top[0] - tang * 2.0, legs_top[1] + tang * 2.0, 6.0, M['frame'], bay=10.0,
                         up=qdir))
    trolley = legs_top[0].lerp(legs_top[1], 0.42) - qdir * 5.0
    parts.append(P.block('trolley', trolley, (8, 5, 5), M['ochre'], z=qdir, y=tang))
    bucket_p, _ = radial(bvh, (qdir * 1.0 - tang * 0.07 + up_q * 0.05).normalized())
    parts.append(P.bars('cable', [(trolley - qdir * 2.5, bucket_p + qdir * 9.0)], 0.3, M['metal']))
    parts.append(P.block('bucket', bucket_p + qdir * 7.0, (7, 6, 4.5), M['ochre'], z=qdir, y=tang, taper=0.8))
    for k in range(5):
        hp, hn = radial(bvh, (qdir + tang * rng.uniform(-0.28, 0.28) + up_q * rng.uniform(-0.25, 0.25)).normalized())
        parts.append(P.block(f'hauler{k}', hp + hn * 1.6, (5.0, 9.0, 3.2), M['ochre'], z=hn, y=tang, taper=0.85))
        lights.append((f'hauler{k}', hp + hn * 3.6, AMBER, 1.2 + 0.3 * k, 'amber', 0.45))
    for k, ((p, n), s) in enumerate(zip(rims, (-1, 1))):
        top = legs_top[k] + up_q * 2.0
        leg = (top - (p + up_q * 9.0 - n * 3.0)).normalized()
        side = tang * s - leg * leg.dot(tang * s)
        lights.append((f'gantry{s}', top - leg * 6.0 + side.normalized() * 1.25, FLOOD, 0.0, 'flood', 0.9))
    plant_dir = Vector((-0.55, 0.62, -0.56)).normalized()
    plant, pn = radial(bvh, plant_dir)
    # conveyor gallery from the quarry rim over the rock to the mill
    path = []
    for i in range(10):
        f = i / 9
        d = (qdir * (1 - f) + plant_dir * f + Vector((0, 0.25, 0.15)) * math.sin(math.pi * f)).normalized()
        p, n = radial(bvh, d)
        path.append((p + n * 9.0, p, n))
    for i in range(9):
        a, b = path[i][0], path[i + 1][0]
        parts.append(P.bars(f'conv{i}', [(a, b)], 3.4, M['ochre'], h=3.0, up=path[i][2]))
        if i:
            parts.append(P.bars(f'trestle{i}', [(a - path[i][2] * 1.5, path[i][1] - path[i][2] * 2.0)], 1.0,
                                M['metal'], up=(b - a)))
    n_p = pn.normalized()
    t1 = plant_dir.cross(Vector((0, 0, 1))).normalized()
    t2 = n_p.cross(t1).normalized()
    mill = plant + n_p * 6.0
    parts.append(P.tag(P.block('mill', mill, (30, 22, 20), M['hab'], z=n_p, y=t2), tone=0.05))
    for s in (-1, 1):
        W.panel(mill + t2 * s * 11.0, t1, n_p, 22, 9, ST_CELL, out=t2 * s)
    parts.append(P.block('mill_roof', mill + n_p * 10.6, (24, 16, 1.2), M['metal'], z=n_p, y=t2))
    for k in range(3):
        g0 = plant + t1 * (k - 1) * 14.0 - t2 * 22.0
        sp, sn = hit(bvh, g0 + n_p * 80.0, -n_p)
        parts.append(P.cylinder(f'silo{k}', sp - n_p * 4.0, sp + n_p * 26.0, 6.2, M['ochre'], sides=14))
        parts.append(P.cylinder(f'silocap{k}', sp + n_p * 26.0, sp + n_p * 28.5, 6.2, M['metal'], r1=2.2, sides=14))
        parts.append(P.bars(f'silofeed{k}', [(sp + n_p * 27.5, mill + n_p * 9.0 - t2 * 6.0)], 1.6, M['ochre'],
                            up=n_p))
    parts.append(P.truss('loader_arm', mill + n_p * 8.0 + t2 * 8.0, Vector((-5, face.y + 34, -8)), 4.0, M['frame'],
                         bay=10.0, tri=True))
    lights.append(('mill', mill + n_p * 11.6 + t1 * 11.0, AMBER, 2.0, 'amber', 0.7))

    # --- Solar arrays on masts along the flanks.
    for i, d in enumerate(((0.7, -0.55, 0.42), (0.82, -0.32, -0.45), (-0.62, -0.62, 0.45), (-0.78, -0.25, -0.55))):
        p, n = radial(bvh, d)
        dirv = Vector(d).normalized()
        tip = p + dirv * 44.0
        parts.append(P.truss(f'solarmast{i}', p - dirv * 4.0, tip, 4.0, M['frame'], bay=8.0, up=(0, 0, 1), tri=True))
        boom = Vector((0, 1, 0))
        wing_n = dirv.cross(boom).normalized()
        for s in (-1, 1):
            c = tip + boom * s * 29.0
            parts.append(P.block(f'solar{i}{s}', c, (22.0, 52.0, 0.5), M['solar'], z=wing_n, y=boom))
        parts.append(P.bars(f'solarboom{i}', [(tip - boom * 56.0, tip + boom * 56.0)], 1.4, M['frame'], up=wing_n))

    # --- Comms mast on the back of the plateau.
    cm_p, cm_n = radial(bvh, (0.08, -0.62, 0.78))
    mast_dir = Vector((0.0, -0.42, 0.91)).normalized()
    mast_top = cm_p + mast_dir * 66.0
    parts.append(P.truss('comms_mast', cm_p - mast_dir * 5.0, mast_top, 5.0, M['frame'], bay=7.0, tri=True))
    comms_c = cm_p + mast_dir * 46.0
    parts += P.dish('dishA', comms_c + Vector((0, -3.0, 0)), (0.2, -0.85, 0.5), 8.0, M['concrete'], depth=0.32, sides=18)
    parts += P.dish('dishB', comms_c + mast_dir * 12.0 + Vector((3.0, 0, 0)), (0.9, -0.2, 0.4), 5.0, M['concrete'],
                    depth=0.3, sides=14)
    parts.append(P.cylinder('whipC', mast_top, mast_top + mast_dir * 18.0, 0.4, M['metal'], sides=5))
    lights.append(('comms', mast_top + mast_dir * 18.6, NAV_RED, 2.0, 'red', 0.8))

    # --- Reactor block on the back face with vents and radiator fins.
    rx_p, rx_n = radial(bvh, (0.12, -0.9, -0.32))
    back = Vector((0.15, -0.9, -0.3)).normalized()
    rc = rx_p + back * 6.0
    up_r = Vector((0, 0, 1))
    up_r = (up_r - back * up_r.dot(back)).normalized()
    side_r = back.cross(up_r).normalized()
    parts.append(P.block('reactor', rc, (48, 34, 40), M['reactor'], z=up_r, y=back))
    parts.append(P.block('reactor_base', rc - back * 8.0 - up_r * 4.0, (58, 30, 40), M['concrete'], z=up_r, y=back))
    parts.append(P.dome('containment', rc + up_r * 19.0 - back * 3.0, 14.0, M['reactor'], z=up_r, segs=16, rings=4,
                        height=0.75, base=2.0))
    for s in (-1, 1):
        vc = rc + side_r * s * 17.0 + up_r * 20.0 + back * 8.0
        parts.append(P.cylinder(f'stack{s}', vc - up_r * 4.0, vc + up_r * 14.0, 4.2, M['metal'], sides=12))
        parts.append(P.cylinder(f'stackglow{s}', vc + up_r * 14.0, vc + up_r * 14.8, 3.4, M['vent'], sides=12))
        for k in range(5):
            parts.append(P.block(f'vent{s}{k}', rc + side_r * s * 24.1 + back * (k * 5.5 - 11.0) + up_r * 3.0,
                                 (3.6, 22.0, 0.4), M['vent'], z=side_r * s, y=up_r))
    for k in range(8):
        o = (k - 3.5) * 6.4
        fc = rc + side_r * o + back * 40.0 - up_r * 2.0
        parts.append(P.block(f'fin{k}', fc, (0.8, 46.0, 34.0), M['radiator'], z=up_r, y=back))
    parts.append(P.block('finroot', rc + back * 18.0 - up_r * 2.0, (48, 4, 30), M['metal'], z=up_r, y=back))
    for k in range(3):
        parts.append(P.block(f'rvent{k}', rc + back * 17.1 + side_r * (k - 1) * 13.0 + up_r * 15.0, (9.0, 0.4, 5.0),
                             M['vent'], z=back, y=up_r))

    # --- Turrets: six mounts with clear arcs, on pads.
    tm = P.turret_materials('st')
    turrets = []
    mounts = [(None, (40, 64), (0, 1, 0)), ((0.88, 0.4, -0.27), None, (0, 1, 0)),
              ((-0.66, -0.56, 0.5), None, (0, -1, 0)), ((0.25, 0.5, -0.83), None, (0, 1, 0)),
              ((-0.2, -0.55, -0.81), None, (0, -1, 0)), ('hub', None, (0, 1, 0))]
    for i, (d, xy, fwd) in enumerate(mounts):
        if d == 'hub':
            loc, nrm = Vector((0, hub0 + 12.0, 13.0)), Vector((0, 0, 1))
        elif xy is not None:
            loc, nrm = hit(bvh, (xy[0], xy[1], 600), (0, 0, -1))
            nrm = Vector((0, 0, 1))
        else:
            loc, nrm = radial(bvh, d)
        m = P.basis(loc + nrm * 0.6, nrm, fwd)
        if d != 'hub':
            parts.append(S.lathe(f'tpad{i}', [(-6.0, 0.0), (-6.0, 7.5), (0.6, 6.5), (0.6, 0.0)], 8, (0, 0), M['concrete'],
                                 sharp=30))
            S.transformed(parts[-1], m @ Matrix.Rotation(math.radians(90), 4, 'X'))
        turrets.append(P.turret(i, m @ Matrix.Translation((0, 0, 0.6 if d != 'hub' else 0.0)), TURRET_ST, tm))

    # --- Lights.
    lights += [('port', radial(bvh, (-0.72, -0.45, -0.52))[0], NAV_RED, 0.0, 'red', 1.0),
               ('starboard', radial(bvh, (0.95, -0.3, -0.1))[0], NAV_GREEN, 0.0, 'green', 1.0),
               ('keel', radial(bvh, (0, 0.1, -1))[0], STROBE, 1.5, 'white', 1.0),
               ('hubnose', Vector((0, hub1 + 0.4, 6.0)), AMBER, 1.0, 'amber', 0.5)]
    empties, light_info = [], {}
    for i, (key, pos, col, blink, mat, size) in enumerate(lights):
        name = f'light_{i}'
        pos = Vector(pos)
        parts.append(P.sphere(name + '_fix', pos, size, M[mat], segs=8, rings=4))
        empties.append(P.anchor(name, pos))
        light_info[name] = (col, blink)

    windows = W.build('st_windows', P.window_material('st_windows'))
    windows.hide_render = True
    for b, g in turrets:
        b.hide_render = g.hide_render = False
    def buried(co):
        loc, nrm, _, _ = bvh.find_nearest(co)
        return loc is not None and (co - loc).dot(nrm) < -0.35

    # Colliders: spheres hugging the rock, then k-means spheres over the
    # structures standing out of it (solar wings, whips and cables are left
    # out: spheres round thin panels would only be invisible walls).
    rc_c, rc_r, (rc_cov, rc_out) = P.rock_spheres(rock, bvh, n=48, depth=35.0, pct=95.0)
    # the docking ring keeps its opening and the hub its bay clear: their own spheres
    dock_parts = ('dock_ring', 'port', 'spoke', 'hub', 'bay_door')
    ring_pts = P.surface_points([o for o in parts if o.name.startswith(('dock_ring', 'port'))], 1.5, seed=11)
    ring_c = [(49.5 * math.cos(a), ring_y, 49.5 * math.sin(a)) for a in (2 * math.pi * k / 24 for k in range(24))]
    dk_c, dk_r, dk_cov = P.fit_spheres(ring_pts, ring_c, pct=98.0, pad=0.3, move=False, iterations=1)
    dk_c = list(dk_c) + [np.array((0.0, hub0 + 7.0, 0.0)), np.array((0.0, hub1 - 11.0, 0.0))]
    dk_r = list(dk_r) + [15.0, 16.5]
    thin = ('solarboom', 'whipC', 'spire', 'beacon', 'cable', 'lamp', 'light_')
    solid = [o for o in parts if not o.name.startswith(thin + dock_parts) and not re.match(r'solar\d', o.name)]
    sp = P.surface_points(solid, 2.5, seed=4)
    sp = np.array([p for p in sp if not buried(Vector(p))])
    sp = P.outside(sp, list(rc_c) + dk_c, list(rc_r) + dk_r, margin=1.0)
    st_c, st_r, st_cov = P.cluster_spheres(sp, 28, pct=98.5, pad=0.5, seed=6)
    C.log(f'  station colliders: rock {len(rc_c)} ({rc_cov * 100:.1f} % of the surface inside, worst poke-out '
          f'{rc_out:.1f} m), dock {len(dk_c)} (ring {dk_cov * 100:.1f} %), structures {len(st_c)} '
          f'({st_cov * 100:.1f} % of {len(sp)} points)')

    hull = P.bake_set('hull', parts, (2048, 1024), inside=buried, samples=None if FAST else (4, 4, 2))
    hull = P.attach_windows(hull, windows)
    rock.parent = hull

    bay_y = hub1 + 8.0
    empties += [P.launch('bay_0', (0, bay_y, 0), (0, 1, 0)),
                P.anchor('sub_dock', (0, ring_y, 0), scale=56.0),
                P.anchor('sub_comms', tuple(comms_c), scale=16.0),
                P.anchor('sub_reactor', tuple(rc + back * 6.0), scale=32.0)]
    all_c, all_r = list(rc_c) + dk_c + list(st_c), list(rc_r) + dk_r + list(st_r)
    lane = [np.array((0.0, bay_y + t, 0.0)) for t in np.arange(0.0, 150.0, 2.0)]
    clear = min((np.linalg.norm(np.asarray(all_c) - q, axis=1) - np.asarray(all_r)).min() for q in lane)
    C.log(f'  bay_0 launch lane clearance {clear:.1f} m')
    if clear <= 0:
        raise RuntimeError('a collider blocks the bay launch lane')
    empties += P.collider_empties(all_c, all_r)
    for e in empties:
        e.parent = hull
    return dict(meshes=[hull, rock], turrets=turrets, empties=empties, lights=light_info, nozzles={},
                turret_size=round(3.5 * TURRET_ST, 2), nodes={})


# ==========================================================================
# Long Mercy — the colony ark, ~890 m: a patchwork stack of habitat and
# cargo modules with the fold-drive ring on struts ahead of the bow

CO_RING_Y, CO_RING_RI, CO_RING_RO, CO_RING_D = 392.0, 120.0, 150.0, 22.0   # centre y, radii, half depth
CO_CELL = (2.7, 3.6)
TURRET_CO = 1.7
CO_NUMBERS = ['41', '17', '58', '23', '36', '62', '09', '44', '71', '28', '15', '33']
DRIVE_GLOW = (0.5, 0.88, 1.0)
CO_ENGINE_X, CO_NOZZLE_Y = 58.0, -470.0

# Stack modules: name, axis start (x, y0, z), y1, radius, sides, tone. Tone
# picks the livery: < 0.4 a Perpetua spare (white, teal bands), 0.4-0.7 the
# ark's own gold bands, >= 0.7 a freighter module (warm grey, rust bands).
CO_MODULES = [
    ('bow', (0, 214, 0), 282, 40.0, 32, 0.12, 0.7),
    ('habA', (-24, 100, 10), 217, 30.0, 28, 0.55, 0.8),
    ('habB', (28, 90, 16), 205, 25.0, 24, 0.32, 0.75),
    ('habC', (2, 118, -37), 197, 21.0, 20, 0.62, 0.5),
    ('habE', (-6, 128, 46), 194, 14.0, 16, 0.78, 0.55),
    ('aftHab', (-6, -258, 0), -88, 48.0, 36, 0.2, 0.8),
    ('aftSide', (46, -238, -46), -112, 24.0, 20, 0.82, 0.3),
    ('podD', (-50, -222, 40), -146, 18.0, 16, 0.4, 0.6),
    ('eng', (0, -378, 0), -262, 34.0, 28, 0.48, 0.0),
]


def colony_materials():
    kw = dict(line=0.2, depth=0.07, ao=9.0, streak=(1.6, 45.0), edge=0.32, chips=(9.0, 1.3), grain=0.0)
    name_img, name_cells, name_aspect = P.text_image('co_name', ['LONG MERCY'])
    num_img, num_cells, num_aspect = P.text_image('co_numbers', CO_NUMBERS)

    def cyl(g, P_):
        ax, az = g.attribute('ax'), g.attribute('az')
        x, y, z = g.sep(P_)
        lx, lz = g.sub(x, ax), g.sub(z, az)
        r = g.vmath('LENGTH', g.combine(lx, lz, 0.0), out=1)
        ang = g.math('ARCTAN2', lz, lx)
        return y, ang, r

    def module(g, P_, N):
        y, ang, r = cyl(g, P_)
        tone, phase, named = g.attribute('tone'), g.attribute('phase'), g.attribute('named')
        body = g.ramp(tone, [(0.0, WHITE), (0.4, lin_mul(WHITE, 0.95)), (0.7, lin_mul(WARM_GREY, 1.25))], 'CONSTANT')
        bandcol = g.ramp(tone, [(0.0, TEAL), (0.4, GOLD), (0.7, RUST)], 'CONSTANT')
        s = g.math('FRACT', g.math('DIVIDE', g.add(y, phase), 48.0))
        stripe = g.maximum(band(g, s, 0.0, 0.08, 0.004), band(g, s, 0.11, 0.13, 0.003))
        col = g.mix(stripe, body, bandcol)
        u = g.mul(ang, r)
        seam = P.bricks(g, y, u, (10.0, 5.0), 0.22, 0.0)
        # LONG MERCY along both flanks of the named module
        H = 15.0
        side = g.sub(1.0, g.mul(g.smooth(g.absolute(ang), 0.2, 0.25), g.smooth(g.sub(math.pi, g.absolute(ang)), 0.2,
                                                                                  0.25)))
        right = g.math('LESS_THAN', g.absolute(ang), 1.5708)
        sgn = g.sub(g.mul(right, 2.0), 1.0)
        uu = g.add(0.5, g.mul(sgn, g.math('DIVIDE', g.sub(y, -172.0), H * name_aspect)))
        vv = g.add(0.5, g.math('DIVIDE', g.mul(g.math('SINE', ang), r), H))
        letters = g.mul(g.mul(P.decal(g, name_img, name_cells, uu, vv), named), side)
        col = g.mix(letters, col, g.mix(g.smooth(tone, 0.69, 0.7), lin_mul(TEAL, 0.9), GRAPHITE))
        return finish(g, col, 0.45, 0.15, P_, N, rust=0.45, patch=0.16, seam=seam, **kw)

    def plate(g, P_, N):
        tone = g.attribute('tone')
        col = g.ramp(tone, [(0.0, WHITE_B), (0.3, lin_mul(WHITE, 0.9)), (0.55, lin_mul(WARM_GREY, 1.1)),
                            (0.8, lin_mul(TEAL, 1.1))], 'CONSTANT')
        return finish(g, col, 0.5, 0.2, P_, N, rust=0.7, wear=1.4, size=(6.0, 3.0), **kw)

    def metal(g, P_, N):
        return finish(g, STEEL, 0.5, 0.5, P_, N, rust=0.8, wear=0.8, size=(8.0, 4.0), **kw)

    def frame(g, P_, N):
        return finish(g, WARM_GREY, 0.5, 0.3, P_, N, rust=1.0, wear=1.3, size=(8.0, 4.0), **kw)

    def gold(g, P_, N):
        x, y, z = g.sep(P_)
        col = g.mix(hazard(g, g.add(x, z), y, 2.0), GOLD, lin_mul(GOLD, 0.6))
        return finish(g, col, 0.4, 0.55, P_, N, rust=0.3, wear=0.8, size=(8.0, 4.0), **kw)

    def container(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        cid, cx, cy, cz, var = (g.attribute(k) for k in ('cid', 'cx', 'cy', 'cz', 'cvar'))
        ly, lz = g.sub(y, cy), g.sub(z, cz)
        tone = g.ramp(var, [(0.0, lin_mul(RUST, 0.85)), (0.35, RUST), (0.62, lin_mul(RUST, 1.1)),
                            (0.84, WHITE_B), (0.92, TEAL)], 'CONSTANT')
        ends = g.smooth(g.absolute(ly), 9.2, 9.4)
        col = g.mix(ends, tone, g.mix(hazard(g, g.add(x, y), z, 0.8), GRAPHITE, HAZARD))
        outer = g.mul(g.smooth(g.absolute(nx), 0.7, 0.8), g.math('GREATER_THAN', g.mul(nx, cx), 0.0))
        H = 8.0
        u = g.add(0.5, g.mul(sign_of(g, nx), g.math('DIVIDE', ly, H * num_aspect)))
        v = g.math('DIVIDE', g.add(lz, H / 2), H)
        ink = g.mix(band(g, var, 0.84, 0.92, 0.002), WHITE, GRAPHITE)
        col = g.mix(g.mul(P.decal(g, num_img, num_cells, u, v, cid), outer), col, ink)
        rib = g.mul(g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', ly, 1.4)), 0.5)), 0.18, 0.3),
                    g.sub(1.0, ends))
        return finish(g, col, 0.5, 0.25, P_, N, rust=0.8, wear=1.2, height=g.mul(rib, 0.08), size=(6.0, 3.0), **kw)

    def radiator(g, P_, N):
        x, y, z = g.sep(P_)
        fins = g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', g.add(x, z), 2.2)), 0.5)), 0.15, 0.3)
        col = g.mix(fins, (0.13, 0.126, 0.12), (0.26, 0.25, 0.236))
        root = g.sub(1.0, g.smooth(g.absolute(x), 40.0, 62.0))
        glow = g.mix(g.mul(root, fins), (0, 0, 0), (0.5, 0.07, 0.02))
        return finish(g, col, 0.45, 0.6, P_, N, lines=False, height=g.mul(fins, 0.06), glow=glow, **kw)

    def engine(g, P_, N):
        x, y, z = g.sep(P_)
        heat = g.smooth(y, -392.0, -404.0)
        col = g.mix(heat, WARM_GREY, (0.07, 0.06, 0.055))
        col = g.mix(band(g, y, -390.0, -386.0, 0.05), col, GOLD)
        return finish(g, col, g.mixf(heat, 0.45, 0.4), g.mixf(heat, 0.3, 0.6), P_, N, rust=0.2,
                      size=(8.0, 4.0), **kw)

    def bridge(g, P_, N):
        x, y, z = g.sep(P_)
        col = g.mix(band(g, z, 39.0, 39.8, 0.03), WHITE, GOLD)
        return finish(g, col, 0.42, 0.15, P_, N, rust=0.25, size=(6.0, 3.0), **kw)

    # The drive ring: the casing in bright plates with gold trim and hazard
    # sector marks, a ring of running lights on its rims; the coil track
    # inside glows pale cyan (the game pulses the drive's emissive).
    def drive_body(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        r = g.vmath('LENGTH', g.combine(x, z, 0.0), out=1)
        radial_n = g.math('DIVIDE', g.add(g.mul(nx, x), g.mul(nz, z)), g.maximum(r, 1.0))
        inner = g.smooth(radial_n, -0.5, -0.8)
        rims = g.smooth(g.absolute(ny), 0.7, 0.85)
        ang = g.math('ARCTAN2', z, x)
        sector = g.math('FRACT', g.mul(ang, 24 / (2 * math.pi)))
        col = g.mix(inner, lin_mul(WHITE, 0.95), (0.05, 0.052, 0.058))
        trim = g.mul(g.maximum(band(g, y, -16.0, -14.6, 0.05), band(g, y, 14.6, 16.0, 0.05)), g.sub(1.0, inner))
        col = g.mix(trim, col, GOLD)
        face = g.mul(rims, band(g, r, 143.0, 152.0, 0.3))
        col = g.mix(g.mul(face, band(g, sector, 0.4, 0.6, 0.01)), col, g.mix(hazard(g, g.mul(ang, 60), r, 1.4),
                                                                            GRAPHITE, HAZARD))
        lamps = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(ang, 96 / (2 * math.pi))), 0.5)), 0.38, 0.44)
        run = g.mul(g.mul(rims, band(g, r, 155.2, 156.6, 0.15)), lamps)
        glow = g.mix(run, (0, 0, 0), DRIVE_GLOW)
        u = g.mul(ang, r)
        seam = P.bricks(g, y, u, (9.0, 4.5), 0.22, 0.5)
        return finish(g, col, g.mixf(inner, 0.45, 0.4), g.mixf(inner, 0.2, 0.6), P_, N, rust=0.15, wear=0.6,
                      glow=glow, seam=seam, **kw)

    def coil_track(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        r = g.vmath('LENGTH', g.combine(x, z, 0.0), out=1)
        radial_n = g.math('DIVIDE', g.add(g.mul(nx, x), g.mul(nz, z)), g.maximum(r, 1.0))
        inner = g.smooth(radial_n, -0.5, -0.8)
        rims = g.smooth(g.absolute(ny), 0.7, 0.85)
        ang = g.math('ARCTAN2', z, x)
        wind = g.smooth(g.absolute(g.sub(g.math('FRACT', g.mul(ang, 192 / (2 * math.pi))), 0.5)), 0.22, 0.3)
        col = g.mix(wind, (0.035, 0.038, 0.045), lin_mul(GOLD, 0.55))
        band_in = g.mul(inner, band(g, y, -21.0, 21.0, 0.5))
        band_rim = g.mul(rims, band(g, r, 125.0, 129.0, 0.3))
        glow = g.mix(g.mul(g.maximum(band_in, band_rim), g.sub(1.0, wind)), (0, 0, 0), DRIVE_GLOW)
        col = g.mix(g.maximum(band_in, band_rim), col, (0.25, 0.35, 0.38))
        return finish(g, col, 0.35, 0.75, P_, N, lines=False, wear=0.4, glow=glow, height=g.mul(wind, 0.06), **kw)

    def coil(g, P_, N):
        x, y, z = g.sep(P_)
        nx, ny, nz = g.sep(N)
        r = g.vmath('LENGTH', g.combine(x, z, 0.0), out=1)
        radial_n = g.math('DIVIDE', g.add(g.mul(nx, x), g.mul(nz, z)), g.maximum(r, 1.0))
        inner = g.smooth(radial_n, -0.5, -0.8)
        wind = g.smooth(g.absolute(g.sub(g.math('FRACT', g.math('DIVIDE', g.add(y, r), 1.6)), 0.5)), 0.25, 0.35)
        col = g.mix(wind, (0.06, 0.055, 0.05), lin_mul(GOLD, 0.8))
        slit = g.mul(inner, band(g, y, -18.0, 18.0, 0.4))
        glow = g.mix(slit, (0, 0, 0), DRIVE_GLOW)
        return finish(g, col, 0.35, 0.8, P_, N, lines=False, wear=0.5, glow=glow, height=g.mul(wind, 0.05), **kw)

    def drive_metal(g, P_, N):
        return finish(g, (0.06, 0.062, 0.068), 0.42, 0.75, P_, N, lines=False, wear=0.6, **kw)

    hole = S.material('co_hole', lambda g, P_, N: dict(albedo=P.SOOT, rough=0.7, metal=0.0))
    return dict(
        module=S.material('co_module', module), plate=S.material('co_plate', plate), metal=S.material('co_metal', metal),
        frame=S.material('co_frame', frame), gold=S.material('co_gold', gold),
        container=S.material('co_container', container), radiator=S.material('co_radiator', radiator),
        engine=S.material('co_engine', engine), bridge=S.material('co_bridge', bridge), hole=hole,
        nozzle=nozzle_paint('co_nozzle', CO_ENGINE_X, 0.0, 30.0),
        throat=P.glow('co_throat', (1.0, 0.62, 0.3), (0.5, 0.35, 0.2)),
        drive_body=S.material('co_drive_body', drive_body), coil=S.material('co_coil', coil),
        coil_track=S.material('co_coil_track', coil_track),
        drive_metal=S.material('co_drive_metal', drive_metal),
        emitter=P.glow('co_emitter', DRIVE_GLOW, (0.3, 0.45, 0.5)),
        red=P.glow('co_red', NAV_RED, (0.3, 0.02, 0.02)), green=P.glow('co_green', NAV_GREEN, (0.02, 0.3, 0.06)),
        white=P.glow('co_white', STROBE, (0.6, 0.6, 0.6)), amber=P.glow('co_amber', AMBER, (0.5, 0.3, 0.08)),
        flood=P.glow('co_flood', FLOOD, (0.6, 0.58, 0.5)),
    )


CO_SECTORS = 24


def drive_sector(M):
    """One 15-degree sector of the fold drive, in the drive's own frame
    (origin at the ring's centre, axis along Y, sector centred on angle 0);
    the bake repeats it 24 times round the axis with shared UVs. A white
    outer casing; inside it, past a gap bridged by a radial web, the dark
    coil track (wider than the casing, glowing pale cyan on its inner face
    and rims) with a coil housing wrapped round it and a focusing emitter
    aimed at the centre; conduits and an equipment pod outside."""
    h = math.pi / CO_SECTORS
    track = [(-27.0, 124.0), (-27.0, 130.0), (-23.0, 133.0), (23.0, 133.0), (27.0, 130.0), (27.0, 124.0),
             (23.0, 120.0), (-23.0, 120.0)]
    casing = [(-18.0, 142.0), (-18.0, 154.0), (-13.0, 159.0), (13.0, 159.0), (18.0, 154.0), (18.0, 142.0),
              (14.0, 138.0), (-14.0, 138.0)]
    big = [(-30.0, 121.0), (-30.0, 132.0), (-26.0, 136.0), (26.0, 136.0), (30.0, 132.0), (30.0, 121.0),
           (26.0, 117.0), (-26.0, 117.0)]
    parts = [P.arc('ring_track', track, -h, h, 4, M['coil_track'], caps=False),
             P.arc('ring_casing', casing, -h, h, 4, M['drive_body'], caps=False),
             P.arc('coil', big, -math.radians(2.4), math.radians(2.4), 2, M['coil'])]
    for yy in (-7.0, 7.0):
        parts.append(P.arc(f'conduit{int(yy)}', [(yy - 1.6, 158.0), (yy - 1.6, 160.6), (yy + 1.6, 160.6),
                                                  (yy + 1.6, 158.0)], -h, h, 3, M['drive_metal'], caps=False))
    d = Vector((math.cos(math.radians(4.6)), 0, math.sin(math.radians(4.6))))
    parts.append(P.block('web', d * 135.5, (1.8, 20.0, 8.0), M['drive_metal'], z=d, y=(0, 1, 0)))
    d = Vector((math.cos(h), 0, math.sin(h)))
    base = d * 120.6
    parts.append(P.cylinder('emitter', base, base - d * 6.5, 3.2, M['drive_metal'], r1=1.3, sides=6))
    parts.append(P.cylinder('emittip', base - d * 6.3, base - d * 7.8, 1.35, M['emitter'], r1=0.45, sides=6))
    d = Vector((math.cos(-math.radians(4.4)), 0, math.sin(-math.radians(4.4))))
    parts.append(P.block('pod', d * 160.0, (8.0, 14.0, 3.2), M['drive_metal'], z=d, y=(0, 1, 0)))
    return parts


def co_module(parts, W, M, name, p0, y1, r, sides, tone, rng, named=False, windows=0.8):
    x, y0, z = p0
    p0, p1 = Vector((x, y0, z)), Vector((x, y1, z))
    m, L = P.span(p0, p1, (0, 0, 1))
    ph = math.pi / sides
    body = P.cylinder(name, p0, p1, r, M['module'], sides=sides)
    P.tag(body, tone=tone, ax=x, az=z, phase=rng.uniform(0, 48), named=1.0 if named else 0.0)
    parts.append(body)
    for t, k in ((0.0, 0), (L, 1)):
        c = m @ Vector((0, t, 0))
        parts.append(P.cylinder(f'{name}_collar{k}', c - Vector((0, 2.5, 0)), c + Vector((0, 2.5, 0)), r + 1.4,
                                M['frame' if tone >= 0.7 else 'gold' if tone >= 0.4 else 'metal'], sides=sides))
    rib_t = [t for t in np.arange(16.0, L - 10.0, 26.0) if not (named and 25.0 < t < L - 25.0)]
    for k, t in enumerate(rib_t):
        c = m @ Vector((0, t, 0))
        parts.append(P.cylinder(f'{name}_rib{k}', c - Vector((0, 0.8, 0)), c + Vector((0, 0.8, 0)), r + 0.6, M['metal'],
                                sides=sides))
    if windows:
        skip = set()
        if named:
            for k in range(sides):
                a = 2 * math.pi * (k + 0.5) / sides + ph
                if abs(math.sin(a)) < 0.3:
                    skip.add(k)
        bottom = {k for k in range(sides) if math.sin(2 * math.pi * (k + 0.5) / sides + ph) < -0.55}
        facets = [k for k in range(sides) if k not in skip and k not in bottom]
        edges = [5.0] + [t for t in rib_t] + [L - 5.0]
        for a, b in zip(edges, edges[1:]):
            if b - a > 10 and rng.random() < 0.6 + 0.4 * windows:
                W.ring(m, r, sides, ph, a + 2.2, b - 2.2, CO_CELL,
                       facets=[k for k in facets if rng.random() < windows])
    return m, L


def build_colony():
    M = colony_materials()
    rng = random.Random(53)
    W = P.Windows(seed=29)
    parts, lights = [], []
    frames = {}

    # --- The stack.
    for name, p0, y1, r, sides, tone, dens in CO_MODULES:
        frames[name] = co_module(parts, W, M, name, p0, y1, r, sides, tone, rng, named=name == 'aftHab',
                                 windows=dens)
    # bow: rounded nose with a docking collar, bridge on top, antennae
    parts.append(S.lathe('bow_nose', [(281.0, 40.0), (289.0, 37.5), (297.0, 30.0), (302.0, 20.0), (304.5, 9.0),
                                      (305.0, 0.0)], 32, (0, 0), M['module'], sharp=50, phase=math.pi / 32))
    P.tag(parts[-1], tone=0.12, ax=0, az=0, phase=0.0, named=0.0)
    parts.append(S.lathe('bow_port', [(303.0, 0.0), (303.0, 6.5), (308.0, 6.5), (308.5, 5.6), (308.5, 0.0)], 16, (0, 0),
                         M['metal'], sharp=40))
    br = [(36.0, 15.0, 244.0, 268.0, 2.0), (44.0, 15.0, 244.0, 270.0, 2.0), (47.0, 13.0, 246.0, 268.0, 2.0)]
    parts.append(P.loft('bridge', [(z, P.chamfer_rect(hw, yb, yf, c)) for z, hw, yb, yf, c in br], M['bridge'],
                        axis='Z'))
    W.panel((0, 269.4, 41.6), (1, 0, 0), (0, 2.0, 8.0), 24.0, 3.4, (2.6, 3.4), out=(0, 1, 0))
    for s in (-1, 1):
        W.panel((s * 15.0, 257.0, 41.6), (0, 1, 0), (0, 0, 1), 18.0, 3.4, (2.6, 3.4), out=(s, 0, 0))
    parts.append(P.cylinder('bow_mast', (0, 252, 46.5), (0, 252, 68), 0.8, M['metal'], sides=6))
    parts += P.dish('bow_dish', (-9.5, 250.0, 47.0), (-0.3, 0.6, 1.0), 4.5, M['plate'], depth=0.3, sides=14)
    parts.append(P.cylinder('bow_whip', (8.5, 250.0, 47.0), (9.5, 246.0, 76.0), 0.25, M['metal'], sides=4))
    lights.append(('bow_mast', (0, 252, 68.7), STROBE, 1.5, 'white', 0.9))
    for s, col, mat in ((-1, NAV_RED, 'red'), (1, NAV_GREEN, 'green')):
        lights.append((f'bow_nav{s}', (s * 40.7, 262.0, 0.0), col, 0.0, mat, 1.0))
    # connector tubes and girders binding the forward cluster
    parts.append(P.cylinder('tubeB', (28, 203, 16), (16, 222, 10), 10.0, M['metal'], sides=14))
    parts.append(P.cylinder('tubeC', (2, 195, -37), (2, 222, -22), 8.0, M['metal'], sides=12))
    parts.append(P.cylinder('tubeE', (-6, 192, 46), (-4, 222, 32), 7.0, M['metal'], sides=12))
    hab = {n: (Vector((p0[0], p0[2])), r) for n, p0, y1, r, sides, tone, dens in CO_MODULES}
    for k, y in enumerate((126.0, 152.0, 178.0)):
        segs = []
        for a, b in (('habA', 'habC'), ('habB', 'habC')):
            (ca, ra), (cb, rb) = hab[a], hab[b]
            d = (cb - ca).normalized()
            pa, pb = ca + d * (ra - 2.0), cb - d * (rb - 2.0)
            segs.append(((pa.x, y, pa.y), (pb.x, y, pb.y)))
            segs.append(((pa.x, y - 9.0, pa.y), (pb.x, y + 9.0, pb.y)))
        parts.append(P.bars(f'girder{k}', segs, 2.6, M['frame'], h=3.4, up=(0, 1, 0)))

    # --- Midship: the cargo spine, Mule containers, tanks.
    parts.append(P.truss('spine', (0, 108, 0), (0, -96, 0), 22.0, M['frame'], bay=25.0, up=(0, 0, 1), battens=False))
    parts.append(P.block('spine_core', (0, 6, 0), (10, 204, 10), M['metal']))
    k = 0
    for si, ys in enumerate((70.0, 44.0, 18.0, -8.0)):
        for sx, sz in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            if (si, sx, sz) in ((1, -1, -1), (3, 1, 1)):
                continue
            cx, cz = sx * 19.5, sz * 15.0
            body = P.loft(f'cont{k}', [(ys + d, P.chamfer_rect(8.0, cz - 7.2, cz + 7.2, 0.7, cx)) for d in (-10.0, 10.0)],
                          M['container'])
            ribs = [P.loft(f'cont{k}r{j}', [(ys + d + dd, P.chamfer_rect(8.25, cz - 7.45, cz + 7.45, 0.8, cx))
                                            for dd in (-0.5, 0.5)], M['container']) for j, d in enumerate((-4.0, 4.0))]
            var = rng.random()
            for o in [body] + ribs:
                P.tag(o, cid=k % len(CO_NUMBERS), cx=cx, cy=ys, cz=cz, cvar=var)
            parts += [body] + ribs
            k += 1
        segs = []
        for y in (ys - 11.0, ys + 11.0):
            segs += [((-29, y, 23.5), (29, y, 23.5)), ((-29, y, -23.5), (29, y, -23.5)), ((29, y, -23.5), (29, y, 23.5)),
                     ((-29, y, -23.5), (-29, y, 23.5))]
        parts.append(P.bars(f'cframe{si}', segs, 1.8, M['frame'], h=2.2, up=(0, 1, 0)))
    for name, c, r in (('tankL', (-41, -52, -8), 25.0), ('tankR', (37, -58, 12), 21.0)):
        parts.append(P.tag(P.sphere(name, c, r, M['module'], segs=24, rings=14), tone=0.75, ax=c[0], az=c[2], phase=0.0,
                           named=0.0))
        parts.append(P.cylinder(name + '_belt', Vector(c) - Vector((0, 1.2, 0)), Vector(c) + Vector((0, 1.2, 0)), r + 0.7,
                                M['frame'], sides=24))
        cv, ax_p = Vector(c), Vector((0, c[1], 0))
        inward = (ax_p - cv).normalized()
        parts.append(P.bars(name + '_arm', [(cv + inward * (r - 2.0), ax_p - inward * 4.0)], 4.0, M['frame'],
                            up=(0, 1, 0)))
    for k in range(3):
        a = math.radians(-120 + 30 * k)
        cx, cz = 24 * math.cos(a), 24 * math.sin(a)
        parts.append(P.capsule(f'ltank{k}', (cx, -28, cz), (cx, -92, cz), 6.5, M['plate'], sides=16))
        P.tag(parts[-1], tone=0.3 * k)

    # --- Aft: patch plates and airlocks on the habitats, the engineering
    # section with radiators and tanks, the thrust frame and two engines.
    for k in range(30):
        name, p0, y1, r, sides, tone, dens = CO_MODULES[rng.choice((0, 1, 2, 5, 5, 5, 6, 7))]
        y = rng.uniform(min(p0[1], y1) + 10, max(p0[1], y1) - 10)
        a = rng.uniform(0, 2 * math.pi)
        if name == 'aftHab' and abs(math.sin(a)) < 0.4:
            continue
        half = rng.uniform(4.0, 11.0) / 2
        span_a = rng.uniform(6.0, 16.0) / r
        prof = [(y - half, r - 0.3), (y - half, r + 0.45), (y + half, r + 0.45), (y + half, r - 0.3)]
        parts.append(P.tag(P.arc(f'patch{k}', prof, a - span_a / 2, a + span_a / 2, 3, M['plate'],
                                 centre=(p0[0], p0[2])), tone=rng.random()))
    for k in range(10):
        name, p0, y1, r, sides, tone, dens = CO_MODULES[rng.choice((0, 1, 2, 3, 4, 5, 6, 7))]
        y = rng.uniform(min(p0[1], y1) + 6, max(p0[1], y1) - 6)
        a = rng.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), 0, math.sin(a)))
        c = Vector((p0[0], y, p0[2])) + d * (r - 1.0)
        parts.append(P.cylinder(f'lock{k}', c, c + d * 5.0, 3.4, M['metal'], sides=10))
        parts.append(P.cylinder(f'lockrim{k}', c + d * 4.6, c + d * 5.6, 4.0, M['gold'], sides=10))
    tips = []
    for s, (y, span_, ang, w) in ((-1, (-300.0, 78.0, -14.0, 32.0)), (-1, (-342.0, 64.0, -6.0, 26.0)),
                                  (1, (-322.0, 92.0, 10.0, 40.0))):
        a = math.radians(ang)
        out = Vector((s * math.cos(a), 0, math.sin(a)))
        nrm = Vector((-s * math.sin(a), 0, math.cos(a)))
        root = Vector((0, y, 0)) + out * 29.0
        parts.append(P.block(f'radiator{s}{int(y)}', root + out * span_ / 2, (span_, w, 1.4), M['radiator'],
                             z=nrm, y=(0, 1, 0)))
        parts.append(P.truss(f'radtruss{s}{int(y)}', root - out * 3.0 - nrm * 2.4, root + out * span_ * 0.9 - nrm * 2.4,
                             3.0, M['frame'], bay=16.0, up=nrm, tri=True, battens=False))
        tips.append(root + out * (span_ + 1.0))
    for k in range(4):
        a = math.radians(70 + 40 * k) if k < 2 else math.radians(250 + 40 * (k - 2))
        cx, cz = 38 * math.cos(a), 38 * math.sin(a)
        parts.append(P.capsule(f'etank{k}', (cx, -272, cz), (cx, -360, cz), 8.5, M['plate'], sides=16))
        P.tag(parts[-1], tone=0.25 + 0.2 * k)
    parts.append(P.cylinder('eng_collar', (0, -266, 0), (0, -254, 0), 33.0, M['gold'], sides=28))
    parts.append(P.cylinder('reactor', (0, -330, 0), (0, -330, 46), 14.0, M['metal'], sides=16))
    parts.append(P.cylinder('reactor_cap', (0, -330, 46), (0, -330, 49), 15.5, M['gold'], sides=16))
    for s in (-1, 1):
        x = s * CO_ENGINE_X
        parts.append(P.bars(f'thrust{s}', [((s * 12, -360, 18), (x, -378, 22)), ((s * 12, -360, -18), (x, -378, -22)),
                                           ((s * 24, -376, 0), (x - s * 30, -380, 0))], 6.0, M['frame'], h=7.0))
        parts.append(S.lathe(f'engine{s}', [(-372.0, 0.0), (-372.0, 30.0), (-378.0, 36.0), (-396.0, 36.0),
                                             (-403.0, 33.0), (-406.0, 26.0), (-406.0, 0.0)], 40, (x, 0.0), M['engine'],
                             sharp=40))
        parts.append(S.lathe(f'bell{s}', bell_profile(-402.0, 68.0, 30.0, 16.5, 24.0), 40, (x, 0.0), M['nozzle'],
                             closed=True, sharp=35))
        parts += bell_hoops(f'hoop{s}', -402.0, 68.0, 30.0, 16.5, 24.0, (x, 0.0), M['gold'], (0.36, 0.52, 0.68, 0.84),
                            sides=40)
        parts.append(S.lathe(f'throat{s}', [(-412.5, 0.0), (-412.5, 16.8), (-411.5, 16.8), (-411.5, 0.0)], 40, (x, 0.0),
                             M['throat'], sharp=30))
    lights += [('rad_port', tips[0], NAV_RED, 0.0, 'red', 1.4),
               ('rad_stbd', tips[2], NAV_GREEN, 0.0, 'green', 1.4),
               ('eng_keel', (0, -320, -34.6), STROBE, 1.5, 'white', 1.0),
               ('aft_top', (-6, -150, 48.7), AMBER, 2.0, 'amber', 1.0),
               ('aft_bottom', (-6, -200, -48.7), AMBER, 2.0, 'amber', 1.0)]

    # --- Struts from the bow to the drive ring's mounts.
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = Vector((math.cos(a), 0, math.sin(a)))
        ring_end = Vector((0, CO_RING_Y - 20.0, 0)) + d * 148.0
        bow_end = Vector((0, 244.0, 0)) + d * 36.0
        parts.append(P.truss(f'strut{k}', bow_end, ring_end, 9.0, M['frame'], bay=19.0, up=(0, 1, 0), tri=True,
                             battens=False))
        parts.append(P.pipe(f'conduit{k}', [bow_end + d * 3.0 + Vector((0, -4, 0)), ring_end + d * 3.0 + Vector((0, -1, 0))],
                            1.4, M['gold'], sides=6))
        parts.append(P.block(f'strutfoot{k}', bow_end + d * 5.0, (12, 14, 6), M['metal'], z=d, y=(0, 1, 0)))
        parts.append(P.block(f'mount{k}', Vector((0, CO_RING_Y - 21.0, 0)) + d * 148.0, (16.0, 8.0, 18.0), M['metal'],
                             z=d, y=(0, 1, 0)))
        lights.append((f'ring_strobe{k}', Vector((0, CO_RING_Y - 21.0, 0)) + d * 157.0, STROBE, 1.0, 'white', 1.2))

    # --- Turrets.
    tm = P.turret_materials('co')
    turrets = []
    for i, (mod, y, ang) in enumerate((('bow', 228.0, 180.0), ('bow', 232.0, 0.0), ('aftHab', -150.0, 62.0),
                                       ('aftHab', -214.0, 242.0))):
        name, p0, y1, r, sides, tone, dens = next(m_ for m_ in CO_MODULES if m_[0] == mod)
        a = math.radians(ang)
        d = Vector((math.cos(a), 0, math.sin(a)))
        loc = Vector((p0[0], y, p0[2])) + d * (r - 0.3)
        m = P.basis(loc, d, (0, 1, 0))
        parts.append(S.transformed(S.lathe(f'tpad{i}', [(-3.0, 0.0), (-3.0, 9.0), (0.9, 8.0), (0.9, 0.0)], 10, (0, 0),
                                           M['metal'], sharp=30), m @ Matrix.Rotation(math.radians(90), 4, 'X')))
        turrets.append(P.turret(i, m @ Matrix.Translation((0, 0, 0.9)), TURRET_CO, tm))

    # --- Light fixtures and anchors.
    empties, light_info = [], {}
    for i, (key, pos, col, blink, mat, size) in enumerate(lights):
        name = f'light_{i}'
        pos = Vector(pos)
        parts.append(P.sphere(name + '_fix', pos, size, M[mat], segs=8, rings=4))
        empties.append(P.anchor(name, pos))
        light_info[name] = (col, blink)

    windows = W.build('co_windows', P.window_material('co_windows'))
    windows.hide_render = True
    # Colliders: chains of spheres along the four struts (k-means would lump
    # a strut with its neighbours into one big ball reaching into the ring),
    # k-means spheres over the rest of the stack; radiators, whips and the
    # mast are left out (thin panels would only be invisible walls).
    strut_c, strut_r = [], []
    for k in range(4):
        d = Vector((math.cos(math.radians(45 + 90 * k)), 0, math.sin(math.radians(45 + 90 * k))))
        a, b = Vector((0, 244.0, 0)) + d * 36.0, Vector((0, CO_RING_Y - 20.0, 0)) + d * 148.0
        for i in range(1, 10):
            strut_c.append(np.array(a.lerp(b, i / 9)))
            strut_r.append(12.7 if i == 9 else 10.0)
    thin = ('radiator', 'bow_whip', 'bow_mast', 'light_', 'strut', 'conduit', 'mount')
    pts = P.surface_points([o for o in parts if not o.name.startswith(thin)], 4.0, seed=8)
    pts = P.outside(pts, strut_c, strut_r, margin=0.5)
    cc, rr, cov = P.cluster_spheres(pts, 32, pct=98.0, pad=1.0, seed=9)
    cc, rr = list(cc) + strut_c, list(rr) + strut_r
    drive = P.bake_set('drive', drive_sector(M), (1024, 1024), location=(0, CO_RING_Y, 0),
                       samples=None if FAST else (4, 5, 2), repeat=CO_SECTORS, margin=0.002)
    hull = P.bake_set('hull', parts, (2048, 1024), samples=None if FAST else (4, 4, 2))
    hull = P.attach_windows(hull, windows)
    drive.parent = hull
    drive.matrix_parent_inverse = Matrix()
    drive.location = (0, CO_RING_Y, 0)

    empties += [P.launch('nozzle_0', (-CO_ENGINE_X, CO_NOZZLE_Y, 0), (0, -1, 0)),
                P.launch('nozzle_1', (CO_ENGINE_X, CO_NOZZLE_Y, 0), (0, -1, 0)),
                P.anchor('sub_drive', (0, CO_RING_Y, 0), scale=CO_RING_RI),
                P.anchor('sub_engine_0', (-CO_ENGINE_X, -405.0, 0), scale=40.0),
                P.anchor('sub_engine_1', (CO_ENGINE_X, -405.0, 0), scale=40.0)]
    bpy.context.view_layer.update()
    ring_pts = P.surface_points([drive], 4.0, seed=10)
    ring_c = [140.0 * Vector((math.cos(2 * math.pi * k / 40), 0, math.sin(2 * math.pi * k / 40)))
              + Vector((0, CO_RING_Y, 0)) for k in range(40)]
    cr, rr2, cov2 = P.fit_spheres(ring_pts, ring_c, pct=97.0, pad=0.0, move=False, iterations=1)
    C.log(f'  colony colliders: stack {len(cc) - len(strut_c)} ({cov * 100:.1f} %), struts {len(strut_c)}, '
          f'ring {len(cr)} ({cov2 * 100:.1f} %, opening clear '
          f'to r = {min(np.linalg.norm((np.asarray(cr) - (0, CO_RING_Y, 0))[:, [0, 2]], axis=1) - rr2):.1f} m)')
    empties += P.collider_empties(list(cc) + list(cr), list(rr) + list(rr2))
    for e in empties:
        e.parent = hull
    return dict(meshes=[hull, drive], turrets=turrets, empties=empties, lights=light_info,
                nozzles={'nozzle_0': 30.0, 'nozzle_1': 30.0}, turret_size=round(3.5 * TURRET_CO, 2),
                nodes={'drive': 'drive'})


# ==========================================================================
# Build, export, anchors

MODELS = [
    ('freighter', build_freighter),
    ('station', build_station),
    ('colony', build_colony),
]


def main(only=None):
    for name, build in MODELS:
        if only and name not in only:
            continue
        t = time.time()
        C.reset(samples=8)
        C.log('civil', name)
        model = build()
        meshes = model['meshes']
        turret_objs = [o for pair in model['turrets'] for o in pair]
        for base, _ in model['turrets']:
            base.parent = meshes[0]
            base.matrix_parent_inverse = Matrix()
        tris = sum(C.tri_count(o) for o in meshes + turret_objs)
        C.log(f'  {name}: {tris} tris ' + ', '.join(f'{o.name} {C.tri_count(o)}' for o in meshes))
        C.export_glb(os.path.join(C.MODELS, name + '.glb'), meshes + turret_objs + model['empties'])
        data = P.anchors_data(meshes + turret_objs, model['empties'], model['turrets'], model['lights'],
                              model['nozzles'], model['turret_size'], model['nodes'])
        P.write_anchors(name, data)
        C.log(f'  {name} done in {time.time() - t:.0f} s')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
