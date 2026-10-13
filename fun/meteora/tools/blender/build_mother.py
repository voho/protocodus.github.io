"""Meteora — the Harrow Mother (mother.glb) and js/anchors/mother.js.

The Harrow foundry ship: about 810 m from the mandible tips to the nozzle
exits, modelled like the other ships in Blender space (nose +Y, top +Z,
right +X), which the glTF exporter delivers nose along three.js -Z.

A long faceted armoured spine split in two by the reactor chamber: the
reactor (separate node `reactor`) hangs on glowing conduits inside an open
cage of ribs and longerons that follow the hull's waist, visible from the
sides, top and belly. Transverse harrow frames carry ranks of raked tines
along the back (a plough turned upside down), tallest over the cage.
Fabrication arms lie folded in trenches along both flanks; forge pits are
cut into the deck and ore maws, ringed with tines, into the belly; two
launch bays open under the forward hull with their doors hanging; two
shield-generator domes (separate nodes `shield_0`, `shield_1`) stand on
the aft shoulders; the prow is a V-shaped brow over a great red eye
(separate node `eye`) between toothed pincer mandibles, with the beam
emitter between them; two clusters of three engines aft, the housings
banded and bladed. Eight turrets (`turret_NN` with a child
`turret_NN_gun`) stand on barbettes.

Textures: two baked sets. `mother_hull` (2048² base, normal and
emission, 512² metallic-roughness) covers the plating: the lofted hull
(painted per facet: gunmetal, an oxblood shoulder stripe like the Thorn's
cheeks, dark trench machinery), prow, mandibles and engine housings.
`mother_detail` (2048² base and emission, 1024² normal, 512²
metallic-roughness) covers everything bolted on. Ambient occlusion is
baked once per set with the whole ship in place and read back by the
paint; normals come from the low mesh itself through a Bevel shader node
(rounded edges) plus bumped plating, so no high-poly copy is needed.
The scattered greebles (node `greebles`), turrets, reactor and eye use
plain glTF material factors: thousands of tiny islands would only waste
the atlases, and the hull's bake still carries their shadows.

Anchors are empties parented to the hull: nozzle_* (local -Y = exhaust),
muzzle_beam, col_NN (uniform scale = radius), sub_* (scale = hit radius),
bay_N (local -Y = launch direction) and light_NN. The collision spheres
are fitted by a greedy set cover: each candidate sphere may stand at most
tau metres outside the plating (measured on a voxel field of the distance
outside the hull), every plating sample and vertex must lie inside one,
and tau is the smallest level that needs no more than 78 spheres; a final
pass samples the plating every 1.2 m and grows the nearest sphere over
any sliver left between the samples. After export everything is
converted to glTF space and written to js/anchors/mother.js.

METEORA_FAST=1 bakes tiny textures with one sample for geometry
iterations. METEORA_CHECK=1 also casts rays at the finished ship (any
back face hit means an inverted normal or a hole) and tests every loose
part for contact (nothing floats). METEORA_TIMING=1 logs phase times;
METEORA_DUMP=<dir> writes the baked maps as PNG. METEORA_MOTHER_SKETCH=<dir>
skips bake and export and renders the unbaked model (METEORA_SKETCH_VIEWS,
_SIZE, _CUSTOM, _COLLIDERS=1 to overlay the collision spheres).
"""
import bpy, bmesh, heapq, math, os, random, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S
import mother_parts as MP

FAST = bool(os.environ.get('METEORA_FAST'))
SKETCH = os.environ.get('METEORA_MOTHER_SKETCH')
TIMING = bool(os.environ.get('METEORA_TIMING'))      # log phase durations (debug only; no effect on output)


def phase(label, _last=[None]):
    if TIMING:
        import time
        now = time.perf_counter()
        if _last[0] is not None:
            C.log(f'  [{now - _last[0]:6.1f} s] {label}')
        _last[0] = now


GUN, OX = S.GUNMETAL, S.OXBLOOD
DARKMETAL = (0.034, 0.036, 0.04)
BELLY = (0.026, 0.028, 0.032)
HARROW_RED = (1.0, 0.165, 0.102)          # #ff2a1a as sRGB 0..1 for the light sprites
PERPETUA_WHITE, PERPETUA_TEAL = S.lin('#d9d6cf'), S.lin('#2e6f8e')

# Key dimensions (Blender space, metres)
Y_BULK = 62.0                  # bulkheads either side of the reactor chamber
REACTOR = Vector((0.0, 0.0, 2.0))
R_CORE = 23.0
WAIST = (58.0, 34.0, -30.0)    # the hull section around the reactor chamber (half-width, deck, keel)
EYE_C, EYE_R = Vector((0.0, 294.0, 12.0)), 18.0
BEAM_Z = -24.0
ENG_X, ENG_Z, ENG_R = 60.0, -4.0, 52.0
Y_EXIT = -395.0
NOZ_R = 25.0
NOZ_OFFSETS = [(0.0, 30.0), (-26.0, -15.0), (26.0, -15.0)]     # within a cluster (x, z)
DOMES = [(-54.0, -120.0), (54.0, -120.0)]                     # shield generators (x, y)
PERPETUA_PLATE = (69.2, -152.0, 18.25)     # story detail on the port aft shoulder (x mirrored to port)
TURRETS = [  # name, ray origin, ray direction (Blender)
    ('turret_00', (50, 236, 200), (0, 0, -1)),       # forward deck, starboard
    ('turret_01', (-50, 236, 200), (0, 0, -1)),      # forward deck, port
    ('turret_02', (134, 150, 98), (-0.63, 0, -0.78)),   # forward upper flank, starboard (above the trench)
    ('turret_03', (-134, 150, 98), (0.63, 0, -0.78)),   # forward upper flank, port
    ('turret_04', (50, -170, 200), (0, 0, -1)),      # aft deck, starboard
    ('turret_05', (-50, -170, 200), (0, 0, -1)),     # aft deck, port
    ('turret_06', (38, -142, -200), (0, 0, 1)),      # belly, starboard
    ('turret_07', (-38, -142, -200), (0, 0, 1)),     # belly, port
]
MANDIBLE_TIP = (14.0, 414.0, -24.0)
R_LIMIT = 419.0                # colliders stay inside the game's bounding radius (catalog: 420)
TURRET_LIFT = 3.5              # barbette height: the yaw pivot sits on top
TURRET_SIZE = 15.0             # the game puts the trunnion 0.6 size above the pivot, the muzzle 0.8 size ahead

# Hull stations: y, half-width, deck, keel, trench depth
FORE = [
    (62, 58, 34, -30, 2),          # the waist round the reactor chamber
    (64.5, 78, 46, -42, 2),        # bulkhead step
    (80, 82, 50, -46, 2),
    (94, 82, 50, -46, 2),
    (108, 82, 50, -46, 16),        # the arm trench opens
    (200, 80, 48, -45, 16),
    (240, 72, 45, -40, 16),
    (258, 64, 42, -36, 2),         # and closes
    (280, 58, 39, -33, 2),
    (300, 50, 36, -30, 2),         # prow face
]
AFT = [
    (-62, 58, 34, -30, 2),
    (-64.5, 78, 46, -42, 2),
    (-80, 82, 50, -46, 2),
    (-94, 82, 50, -46, 2),
    (-108, 82, 50, -46, 16),
    (-192, 80, 49, -46, 16),
    (-210, 74, 46, -43, 2),
    (-232, 58, 42, -38, 2),
    (-290, 36, 36, -32, 2),
    (-350, 26, 30, -26, 2),
    (-384, 13, 17, -13, 2),
]
PITS = [136.0, 208.0, -118.0, -190.0, -262.0]      # forge pits cut into the deck between frames (y)
MAWS = [(0.0, 106.0, 17.0, 22.0), (0.0, -124.0, 15.0, 24.0)]   # ore maws in the belly: x, y, half-width, half-length
FRAMES_FORE = [(262, 30), (226, 38), (190, 46), (154, 54), (118, 60)]       # y, centre tine height
FRAMES_AFT = [(-100, 60), (-136, 54), (-172, 48), (-208, 42), (-244, 36), (-280, 30), (-316, 24), (-352, 18)]
HOOPS = [-22.0, 22.0]


def hull_half(w, top, bot, td):
    """Right half of a hull section, top centre to keel centre: a deck
    ridge, sloped upper deck, shoulder, a trench (depth td) along the flank
    for the folded arms, the chine and a flat keel."""
    h = top - bot
    return [
        (0.0, top), (0.17 * w, top), (0.52 * w, top - 0.09 * h), (0.80 * w, top - 0.27 * h),
        (0.93 * w, top - 0.36 * h),              # trench upper lip
        (0.93 * w - td, top - 0.41 * h),         # trench roof, inner edge
        (0.93 * w - td, bot + 0.30 * h),         # trench floor, inner edge
        (0.97 * w, bot + 0.26 * h),              # trench lower lip
        (w, bot + 0.18 * h),                     # chine
        (0.84 * w, bot + 0.06 * h),              # lower flank
        (0.40 * w, bot), (0.0, bot)]


def hull_ring(y, w, top, bot, td, scale=1.0, zc=0.0):
    half = [(x * scale, zc + (z - zc) * scale) for x, z in hull_half(w, top, bot, td)]
    return [(x, y, z) for x, z in half] + [(-x, y, z) for x, z in half[1:-1][::-1]]


def station(stations, y):
    """Hull section parameters at y, interpolated between stations."""
    rows = sorted(stations, key=lambda r: r[0])
    if y <= rows[0][0]:
        return rows[0][1:]
    for a, b in zip(rows, rows[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return tuple(p + (q - p) * t for p, q in zip(a[1:], b[1:]))
    return rows[-1][1:]


# ==========================================================================
# Paint

def mother_materials():
    mat = S.material

    def hull(g, P, N, base_col=GUN):
        x, y, z = g.sep(P)
        ax, ay = g.absolute(x), g.absolute(y)
        nx, ny, nz = g.sep(N)
        under = g.smooth(nz, -0.35, -0.7)
        big = MP.plates(g, P, N, (34.0, 14.0), 0.6)
        small = MP.plates(g, P, N, (14.0, 6.0), 0.38, shift=3.1)
        m1, r1, _ = big
        ridge = g.mul(g.smooth(nz, 0.9, 0.97), g.sub(1.0, g.smooth(ax, 13.5, 14.5)))
        ox = g.maximum(ridge, g.mul(g.smooth(r1, 0.92, 0.93), g.sub(1.0, under)))
        col = g.mix(ox, base_col, OX)
        col = g.mix(under, col, BELLY)
        # the bulkhead steps round the reactor chamber are scorched dark
        step = g.mul(S.band(g, ay, 62.4, 64.6, 0.1), g.smooth(g.absolute(ny), 0.35, 0.5))
        col = g.mix(step, col, (0.03, 0.026, 0.024))
        # lit seams: a few patches of the big plate seams glow red
        lit = g.mul(m1, g.smooth(g.noise(P, 1.0 / 70.0, 2.0, 0.5), 0.68, 0.71))
        # running lights: rows of dots along the trench lips and the chine
        dots_y = S.band(g, g.math('FRACT', g.mul(g.add(y, 3.0), 1.0 / 16.0)), 0.0, 0.08, 0.01)
        side = g.smooth(g.absolute(nx), 0.35, 0.55)
        rows = g.maximum(S.band(g, z, 17.2, 18.6, 0.15), S.band(g, z, -27.6, -26.2, 0.15))
        dots = g.mul(g.mul(dots_y, rows), side)
        glow = g.mix(g.maximum(g.mul(lit, 0.7), dots), (0, 0, 0), MP.red(1.0))
        return MP.skin(g, col, g.mixf(ox, 0.44, 0.4), g.mixf(ox, 0.5, 0.35), P, N, glow=glow, plating=(big, small))

    def armour(g, P, N):
        return MP.skin(g, OX, 0.42, 0.35, P, N, wear=1.2, panels=0.6, big=(22.0, 9.0), small=(10.0, 4.5))

    def trench(g, P, N):
        x, y, z = g.sep(P)
        ribs = S.band(g, g.math('FRACT', g.mul(y, 1.0 / 9.0)), 0.0, 0.16, 0.02)
        col = g.mix(ribs, (0.04, 0.042, 0.047), (0.022, 0.023, 0.026))
        return MP.skin(g, col, 0.55, 0.6, P, N, wear=0.5, panels=0.5, big=(18.0, 8.0), small=(9.0, 4.0),
                       height=g.mul(ribs, 0.12))

    def plate(g, P, N):
        # gunmetal armour shingles and frames
        x, y, z = g.sep(P)
        under = g.smooth(g.sep(N)[2], -0.35, -0.7)
        col = g.mix(under, GUN, BELLY)
        return MP.skin(g, col, 0.42, 0.5, P, N, wear=1.0, panels=0.7, big=(20.0, 8.0), small=(9.0, 4.0))

    def machine(g, P, N):
        return MP.skin(g, (0.05, 0.053, 0.058), 0.5, 0.62, P, N, wear=0.8, panels=0.35,
                       big=(12.0, 5.0), small=(6.0, 2.8), edge=0.4)

    def tine(g, P, N):
        x, y, z = g.sep(P)
        col = g.mix(g.smooth(z, 70.0, 110.0), OX, (0.1, 0.018, 0.02))
        col = g.mix(g.smooth(g.noise(g.vmath('MULTIPLY', P, (0.4, 0.4, 0.05)), 1.0, 3.0), 0.55, 0.7), col,
                    (0.16, 0.035, 0.035))
        return MP.skin(g, col, 0.4, 0.4, P, N, wear=1.4, panels=0.0, edge=0.4, streak=0.4)

    def hazard(g, P, N):
        x, y, z = g.sep(P)
        return MP.skin(g, MP.hazard_stripes(g, g.add(x, z), y, 2.2), 0.5, 0.25, P, N, wear=1.4, panels=0.0, edge=0.4)

    def engine(g, P, N):
        x, y, z = g.sep(P)
        heat = g.smooth(y, -330.0, -367.0)
        col = g.mix(heat, GUN, (0.07, 0.06, 0.065))
        col = g.mix(g.mul(heat, g.smooth(g.noise(P, 0.05, 3.0), 0.4, 0.7)), col, (0.05, 0.055, 0.09))
        haz = S.band(g, y, -214.0, -204.0, 0.2)
        col = g.mix(haz, col, MP.hazard_stripes(g, g.add(x, z), y, 3.0))
        ox = S.band(g, y, -232.0, -220.0, 0.2)
        col = g.mix(ox, col, OX)
        return MP.skin(g, col, g.mixf(heat, 0.45, 0.4), g.mixf(heat, 0.5, 0.65), P, N, wear=0.8)

    def nozzle(g, P, N):
        x, y, z = g.sep(P)
        tint = g.ramp(g.noise(P, 0.08, 3.0), [(0.3, (0.16, 0.13, 0.1)), (0.55, (0.11, 0.11, 0.15)),
                                               (0.8, (0.2, 0.15, 0.1))])
        col = g.mix(S.band(g, y, -381.0, -378.0, 0.1), tint, (0.03, 0.03, 0.033))
        return MP.skin(g, col, 0.36, 0.75, P, N, wear=0.0, panels=0.0, grime=0.5, edge=0.4)

    def nozzle_in(g, P, N):
        x, y, z = g.sep(P)
        hot = g.power(g.smooth(y, -384.0, -371.5), 2.0)
        glow = g.mix(hot, (0, 0, 0), (1.0, 0.3, 0.08))
        col = g.mix(g.smooth(g.noise(P, 0.3, 3.0), 0.4, 0.6), S.SOOT, (0.03, 0.025, 0.022))
        return dict(albedo=col, rough=0.75, metal=0.1, glow=g.mix(0.45, (0, 0, 0), glow))

    def throat(g, P, N):
        return dict(albedo=(0.4, 0.12, 0.05), rough=0.3, metal=0.0, glow=(0.9, 0.22, 0.05))

    def throat_core(g, P, N):
        return dict(albedo=(0.6, 0.4, 0.25), rough=0.3, metal=0.0, glow=(1.0, 0.62, 0.32))

    def redglow(g, P, N):
        return dict(albedo=(0.3, 0.02, 0.02), rough=0.3, metal=0.0, glow=MP.red(1.0))

    def vent(g, P, N):
        # forge vents: a dim glow under the grille bars
        flick = g.add(0.45, g.mul(g.noise(P, 0.25, 2.0), 0.4))
        return dict(albedo=(0.12, 0.02, 0.012), rough=0.5, metal=0.0, glow=g.mix(flick, (0, 0, 0), (1.0, 0.12, 0.03)))

    def maw(g, P, N):
        # ore maws: ribbed throat walls glowing hotter toward the furnace above
        x, y, z = g.sep(P)
        nz = g.sep(N)[2]
        heat = g.power(g.smooth(z, -44.0, -23.0), 1.6)
        ribs = S.band(g, g.math('FRACT', g.mul(g.add(y, x), 1.0 / 5.0)), 0.0, 0.3, 0.05)
        roof = g.smooth(nz, -0.6, -0.85)
        glow = g.mix(g.maximum(g.mul(heat, g.sub(1.0, g.mul(ribs, 0.7))), roof), (0, 0, 0), (1.0, 0.24, 0.04))
        return MP.skin(g, (0.035, 0.03, 0.03), 0.6, 0.5, P, N, wear=0.2, panels=0.0, glow=g.mix(0.85, (0, 0, 0), glow),
                       height=g.mul(ribs, 0.2), edge=0.3)

    def pit(g, P, N):
        # forge pits: dark walls, a glowing grid on the floor
        x, y, z = g.sep(P)
        nz = g.sep(N)[2]
        floor = g.smooth(nz, 0.6, 0.8)
        grid = g.maximum(S.band(g, g.math('FRACT', g.mul(x, 1.0 / 4.0)), 0.0, 0.25, 0.03),
                         S.band(g, g.math('FRACT', g.mul(y, 1.0 / 4.0)), 0.0, 0.25, 0.03))
        heat = g.mul(floor, g.sub(1.0, grid))
        glow = g.mix(heat, (0, 0, 0), (1.0, 0.2, 0.04))
        wall = g.mul(g.sub(1.0, floor), S.band(g, g.math('FRACT', g.mul(z, 1.0 / 3.0)), 0.45, 0.55, 0.03))
        glow = g.mix(g.mul(wall, 0.6), glow, MP.red(0.8))
        return MP.skin(g, (0.03, 0.03, 0.033), 0.6, 0.5, P, N, wear=0.2, panels=0.0, glow=glow, edge=0.3)

    def bay(g, P, N):
        x, y, z = g.sep(P)
        nx, ny, nz = g.sep(N)
        wall = g.smooth(g.absolute(nx), 0.6, 0.8)
        ceil = g.smooth(nz, -0.6, -0.85)
        strips = g.mul(S.band(g, g.math('FRACT', g.mul(z, 1.0 / 7.0)), 0.44, 0.56, 0.02), wall)
        cross = g.mul(S.band(g, g.math('FRACT', g.mul(y, 1.0 / 12.0)), 0.45, 0.55, 0.02), ceil)
        glow = g.mix(g.maximum(strips, cross), (0, 0, 0), (1.0, 0.16, 0.05))
        return MP.skin(g, (0.03, 0.032, 0.036), 0.55, 0.5, P, N, wear=0.3, panels=0.5, big=(16.0, 7.0),
                       small=(8.0, 3.5), glow=glow)

    def socket(g, P, N):
        d = g.vmath('DISTANCE', P, tuple(EYE_C), out=1)
        glow = g.mix(g.smooth(d, 17.0, 13.0), (0, 0, 0), MP.red(0.45))
        return MP.skin(g, (0.03, 0.03, 0.033), 0.35, 0.7, P, N, wear=0.2, panels=0.0, glow=glow, edge=0.4)

    def dome(g, P, N):
        cells = g.voronoi(P, 1.0 / 4.5, feature='DISTANCE_TO_EDGE', out='Distance')
        edges = g.smooth(cells, 0.07, 0.02)
        glow = g.mix(edges, MP.red(0.22), MP.red(1.0))
        h = g.mul(edges, -0.06)
        return dict(albedo=(0.09, 0.012, 0.012), rough=0.18, metal=0.2, glow=glow,
                    normal=g.bump(h, 1.0, 1.0))

    def perpetua(g, P, N):
        x, y, z = g.sep(P)
        teal = S.band(g, z, PERPETUA_PLATE[2] - 1.3, PERPETUA_PLATE[2] + 1.4, 0.12)
        col = g.mix(0.25, PERPETUA_WHITE, (0.32, 0.31, 0.29))        # faded, sooty
        col = g.mix(teal, col, g.mix(0.3, PERPETUA_TEAL, (0.3, 0.32, 0.32)))
        scorch = g.smooth(g.noise(P, 0.35, 4.0, 0.6), 0.55, 0.75)
        col = g.mix(g.mul(scorch, 0.8), col, (0.02, 0.018, 0.016))
        return MP.skin(g, col, 0.6, 0.15, P, N, wear=1.6, panels=0.0, grime=1.4)

    def cage(g, P, N):
        d = g.vmath('DISTANCE', P, tuple(REACTOR), out=1)
        towards = g.smooth(g.vmath('DOT_PRODUCT', N, g.vmath('NORMALIZE', g.vmath('SUBTRACT', tuple(REACTOR), P)), out=1),
                           0.1, 0.6)
        heat = g.mul(g.smooth(d, 50.0, 30.0), towards)
        glow = g.mix(heat, (0, 0, 0), (0.32, 0.05, 0.01))
        return MP.skin(g, OX, 0.42, 0.45, P, N, wear=1.2, panels=0.25, big=(26.0, 9.0), small=(10.0, 4.0), glow=glow)

    def conduit(g, P, N):
        d = g.vmath('DISTANCE', P, tuple(REACTOR), out=1)
        rings = S.band(g, g.math('FRACT', g.mul(d, 1.0 / 7.0)), 0.0, 0.18, 0.02)
        glow = g.mix(g.add(g.mul(rings, 0.8), g.mul(g.smooth(d, 40.0, 28.0), 0.6)), (0, 0, 0), (1.0, 0.3, 0.08))
        return MP.skin(g, DARKMETAL, 0.4, 0.75, P, N, wear=0.5, panels=0.0, glow=glow, edge=0.4)

    def emitter(g, P, N):
        x, y, z = g.sep(P)
        coils = g.mul(S.band(g, g.math('FRACT', g.mul(g.sub(y, 300.0), 1.0 / 4.0)), 0.35, 0.65, 0.04),
                      S.band(g, y, 306.0, 357.0, 0.3))
        glow = g.mix(coils, (0, 0, 0), (1.0, 0.12, 0.04))
        col = g.mix(S.band(g, y, 272.0, 302.0, 0.3), DARKMETAL, OX)
        return MP.skin(g, col, 0.38, 0.7, P, N, wear=0.6, panels=0.0, glow=glow, edge=0.4)

    return dict(
        hull=mat('m_hull', hull), hull_ox=mat('m_hull_ox', lambda g, P, N: hull(g, P, N, OX)),
        trench=mat('m_trench', trench), armour=mat('m_armour', armour), armour_a=mat('m_armour_a', armour),
        plate=mat('m_plate', plate),
        machine=mat('m_machine', machine), tine=mat('m_tine', tine), hazard=mat('m_hazard', hazard),
        engine=mat('m_engine', engine), nozzle=mat('m_nozzle', nozzle), nozzle_in=mat('m_nozzle_in', nozzle_in),
        throat=mat('m_throat', throat), throat_core=mat('m_throat_core', throat_core),
        redglow=mat('m_redglow', redglow), bay=mat('m_bay', bay),
        vent=mat('m_vent', vent), pit=mat('m_pit', pit), maw=mat('m_maw', maw),
        socket=mat('m_socket', socket), dome=mat('m_dome', dome), perpetua=mat('m_perpetua', perpetua),
        cage=mat('m_cage', cage), conduit=mat('m_conduit', conduit), emitter=mat('m_emitter', emitter),
    )


def factor_materials():
    """Plain glTF factor materials for the turrets, reactor and eye."""
    F = C.flat_material
    return dict(
        t_armour=F('mother_turret', GUN, 0.45, 0.55),
        t_red=F('mother_turret_red', OX, 0.42, 0.35),
        t_dark=F('mother_turret_dark', (0.03, 0.032, 0.035), 0.5, 0.6),
        t_glow=F('mother_turret_eye', (0.3, 0.02, 0.02), 0.3, 0.0, emission=MP.red(1.0), strength=3.0),
        core=F('mother_reactor_core', (0.55, 0.08, 0.015), 0.35, 0.0, emission=(1.0, 0.11, 0.015), strength=1.6),
        core_frame=F('mother_reactor_frame', DARKMETAL, 0.45, 0.7),
        sclera=F('mother_eye_lens', (0.06, 0.004, 0.003), 0.08, 0.0, emission=(0.5, 0.012, 0.006), strength=1.5),
        iris=F('mother_eye_iris', (0.2, 0.01, 0.005), 0.1, 0.0, emission=(1.0, 0.06, 0.02), strength=4.0),
        pupil=F('mother_eye_pupil', (0.3, 0.1, 0.05), 0.1, 0.0, emission=(1.0, 0.45, 0.2), strength=6.0),
        g_machine=F('mother_greeble_dark', (0.05, 0.053, 0.058), 0.5, 0.62),
        g_plate=F('mother_greeble', (0.058, 0.066, 0.078), 0.45, 0.5),
        g_armour=F('mother_greeble_red', OX, 0.42, 0.35),
        g_glow=F('mother_light', (0.3, 0.02, 0.02), 0.3, 0.0, emission=MP.red(1.0), strength=3.0),
        g_vent=F('mother_vent', (0.12, 0.02, 0.012), 0.5, 0.0, emission=(1.0, 0.12, 0.03), strength=1.4),
    )


def greeble_set(F):
    """The keys the greeble builders use, mapped to plain factor materials:
    the scattered kit has no texture (it would only fill the atlas with
    thousands of tiny islands); the hull's bake still carries its shadows."""
    return dict(machine=F['g_machine'], plate=F['g_plate'], armour=F['g_armour'], hazard=F['g_armour'],
                tine=F['g_armour'], vent=F['g_vent'], redglow=F['g_glow'])


# ==========================================================================
# Hull

def box_solid(name, lo, hi, mat):
    bm = bmesh.new()
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    pts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    MP.add_convex(bm, pts, [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    return MP.solid(name, bm, mat, recalc=False)


def carve(target, cutters):
    """Boolean-subtract closed cutters; new faces take the cutter's material."""
    for c in cutters:
        mod = target.modifiers.new('carve', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.material_mode = 'TRANSFER'
        mod.object = c
        C.apply_modifiers(target)
        bpy.data.objects.remove(c)
    target.data.set_sharp_from_angle(angle=math.radians(20))
    return target


def bay_cutter(name, sign, mat):
    """The launch bay cavity: 40 m wide, open down and forward."""
    bm = bmesh.new()
    x0, x1 = sorted((sign * 14.0, sign * 54.0))
    yz = [(140.0, -64.0), (252.0, -64.0), (216.0, -14.0), (140.0, -14.0)]
    pts = [(x, y, z) for x in (x0, x1) for y, z in yz]
    MP.add_convex(bm, pts, [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    return MP.solid(name, bm, mat, recalc=False)


def sphere_cutter(name, centre, r, mat):
    bm = bmesh.new()
    MP.uv_sphere(bm, centre, r, segments=24, rings=14)
    return MP.solid(name, bm, mat, recalc=False)


# paint per facet of the hull section (see hull_half): 0 ridge, 1 upper deck,
# 2 shoulder, 3 upper flank, 4-6 trench roof, wall and floor, 7 lower lip,
# 8 lower flank, 9-10 belly
FACET_PAINT = ['hull', 'hull', 'hull_ox', 'hull', 'trench', 'trench', 'trench', 'hull', 'hull', 'hull', 'hull']


def hull_loft(name, stations, M):
    """A hull section lofted through `stations`, closed at both ends, each
    facet painted per FACET_PAINT (the shoulder stripe in oxblood like the
    Thorn's cheeks, the arm trench in dark machinery)."""
    keys = list(dict.fromkeys(FACET_PAINT))
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in hull_ring(*row)] for row in stations]
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = keys.index(FACET_PAINT[i if i <= 10 else 21 - i])
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    ob = MP.solid(name, bm, M[keys[0]], sharp=20.0)
    for k in keys[1:]:
        ob.data.materials.append(M[k])
    return ob


def build_hull(M):
    """The two hull halves either side of the reactor chamber."""
    fore = hull_loft('hull_fore', FORE, M)
    aft = hull_loft('hull_aft', sorted(AFT, key=lambda r: -r[0]), M)
    pits = {True: [], False: []}
    for y in PITS:
        st = station(FORE if y > 0 else AFT, y)
        pits[y > 0].append(box_solid(f'pit_cut{y}', (-13.0, y - 11.0, st[1] - 9.0), (13.0, y + 11.0, st[1] + 30.0),
                                     M['pit']))
    maws = {True: [], False: []}
    for x, y, hw, hl in MAWS:
        maws[y > 0].append(box_solid(f'maw_cut{y}', (x - hw, y - hl, -80.0), (x + hw, y + hl, -22.0), M['maw']))
    carve(fore, [bay_cutter('bay_cut_R', 1, M['bay']), bay_cutter('bay_cut_L', -1, M['bay']),
                 sphere_cutter('socket_cut', EYE_C + Vector((0, 1.0, 0)), EYE_R + 0.9, M['socket'])] + pits[True]
          + maws[True])
    carve(aft, pits[False] + maws[False])
    return [fore, aft]


BROW = [  # y, half-width, edge height, ridge rise, thickness
    (254, 54, 44, 7, 10), (290, 52, 42, 8, 10), (306, 44, 39, 8, 8), (322, 28, 36, 7, 7), (338, 10, 33, 5, 5)]
BROW_TIP = Vector((0.0, 352.0, 30.0))


def build_prow(M, A, B):
    """A faceted V-brow over the eye, pincer mandibles with teeth, canard
    blades, and the beam emitter between the mandibles."""
    rings = []
    for y, w, ze, k, t in BROW:
        sec = [(-w, ze), (-0.45 * w, ze + 0.6 * k), (0, ze + k), (0.45 * w, ze + 0.6 * k), (w, ze),
               (0.8 * w, ze - t), (0, ze - t + 0.3 * k), (-0.8 * w, ze - t)]
        rings.append([(x, y, z) for x, z in sec])
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    S.ring_faces(bm, vr)
    bm.faces.new(vr[0][::-1])
    S.cap(bm, vr[-1], tuple(BROW_TIP))
    A.append(MP.solid('brow', bm, M['armour_a'], sharp=20.0))
    crest = MP.Batch('crest')
    MP.add_tine(crest(M['tine']), (0, 300, 49.5), (0, 0.15, 1), (0, 1, 0), 13.0, 58.0, 4.0, rake=0.8, hook=0.0, sink=4.0)
    B.extend(crest.objects())

    # mandibles: pincers that bow outward and hook in, with teeth
    stations = [(224, 46, -16, 18, 22), (262, 52, -18, 16, 18), (306, 52, -20, 12.5, 14),
                (346, 44, -22, 9, 10), (380, 33, -23, 6, 6.5), (402, 22, -24, 3, 3.5)]
    rings = []
    for y, cx, cz, w, h in stations:
        sec = [(w, 0.1 * h), (0.35 * w, h), (-0.55 * w, 0.75 * h), (-w, -0.05 * h), (-0.4 * w, -h), (0.5 * w, -0.8 * h)]
        rings.append([(cx + dx, y, cz + dz) for dx, dz in sec])
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    S.ring_faces(bm, vr)
    bm.faces.new(vr[0][::-1])
    S.cap(bm, vr[-1], MANDIBLE_TIP)
    mand = MP.solid('mandible', bm, M['hull'], sharp=20.0)
    side = [mand]
    bvh = S.bvh_of([mand])
    teeth = MP.Batch('teeth')
    for i, y in enumerate((296, 318, 340, 360, 378)):
        cx, cz = station([(s_[0], s_[1], s_[2]) for s_ in stations], y)[:2]
        loc, n = MP.cast(bvh, (0, y, cz), (1, 0, 0))
        if loc is None:
            continue
        MP.add_tine(teeth(M['tine']), loc, (-1, 0.3, 0), (0, 1, 0), 15.0 - 1.6 * i, 11.0 - 1.2 * i, 3.2, rake=0.45,
                    hook=0.1)
    # blades rising from the mandible backs
    for y, hgt in ((262, 26.0), (300, 21.0), (338, 15.0)):
        cx, cz = station([(s_[0], s_[1], s_[2]) for s_ in stations], y)[:2]
        loc, n = MP.cast(bvh, (cx, y, 60), (0, 0, -1))
        if loc is not None:
            MP.add_tine(teeth(M['tine']), loc, (0.45, -0.1, 1), (0, 1, 0), hgt, 15.0, 3.4, rake=0.55)
    # a canard blade on each side of the prow, swept back like the Thorn's
    MP.add_tine(teeth(M['armour']), (44.0, 270.0, 4.0), (1.0, 0.35, 0.05), (0, 1, 0), 34.0, 26.0, 4.0, rake=0.55,
                hook=0.05, sink=6.0)
    side += teeth.objects()
    hz = MP.Batch('mand_haz')
    for y in (366.0,):
        cx, cz, w, h = station(stations, y)
        MP.add_tube(hz(M['hazard']), [(cx, y - 3, cz), (cx, y + 3, cz)], h + 0.8, w + 0.8, sides=6, up=(0, 0, 1))
    side += hz.objects()
    A.extend(S.mirrored([o for o in side if o.name.startswith('mandible')]))
    B.extend(S.mirrored([o for o in side if not o.name.startswith('mandible')]))

    # beam emitter on the centre line, below the eye
    prof = [(268, 0), (268, 10), (300, 10), (305, 8.2), (310, 7.5), (357, 7.5), (361, 9.6), (366, 9.6), (366, 0)]
    B.append(S.lathe('emitter', prof, 16, (0, BEAM_Z), M['emitter'], sharp=30))
    B.append(S.lathe('emitter_tip', [(365, 0), (365, 8.6), (373, 6.0), (382, 2.6), (389, 0)], 16, (0, BEAM_Z),
                     M['redglow'], sharp=30))
    for k, y in enumerate((316, 333, 350)):
        B.append(S.lathe(f'emitter_ring{k}', [(y, 0), (y, 12.5), (y + 3, 12.5), (y + 3, 0)], 16, (0, BEAM_Z),
                         M['machine'], smooth=False))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        m = (Matrix.Translation((math.cos(a) * 9.0, 0, BEAM_Z + math.sin(a) * 9.0))
             @ Matrix.Rotation(-a + math.pi / 2, 4, 'Y'))
        B.append(S.prism(f'emitter_vane{k}', [(-1.0, 300), (1.0, 300), (1.0, 356), (-1.0, 350)], 5.0, M['machine'],
                         m @ Matrix.Rotation(math.radians(90), 4, 'Y')))
    # eye shields either side of the socket
    for sgn in (1, -1):
        m = Matrix.Translation((sgn * 28.5, 300, 12)) @ Matrix.Rotation(math.radians(sgn * 18), 4, 'Z')
        B.append(S.box(f'eye_shield{sgn}', (5.0, 22.0, 36.0), M['plate'], m, taper=0.8))


def build_engines(M, A, B, empties):
    """Two octagonal engine housings, each with three bells."""
    nozzles = []
    for c, sgn in enumerate((-1, 1)):                      # cluster 0 port, 1 starboard
        cx = sgn * ENG_X
        prof = [(-176, 0), (-180, 20), (-196, 42), (-214, ENG_R), (-350, ENG_R), (-360, ENG_R - 2), (-367, ENG_R - 6),
                (-367, 0)]
        A.append(S.lathe(f'housing{c}', prof, 8, (cx, ENG_Z), M['engine'], sharp=20, phase=math.pi / 8))
        # armour collars round the housing, one with a hazard band
        rim = ENG_R - 0.6                                   # rings start inside the housing: no hidden caps
        B.append(S.lathe(f'collar{c}', [(-224, rim), (-224, ENG_R + 3.0), (-238, ENG_R + 3.0), (-242, rim)],
                         8, (cx, ENG_Z), M['armour'], smooth=False, phase=math.pi / 8))
        B.append(S.lathe(f'collar_haz{c}', [(-227, ENG_R + 2.0), (-227, ENG_R + 3.3), (-231, ENG_R + 3.3),
                                            (-231, ENG_R + 2.0)], 8, (cx, ENG_Z), M['hazard'], smooth=False,
                         phase=math.pi / 8))
        for k, y in enumerate((-272.0, -306.0, -340.0)):
            B.append(S.lathe(f'band{c}{k}', [(y + 3, rim), (y + 3, ENG_R + 1.8), (y - 3, ENG_R + 1.8), (y - 3, rim)],
                             8, (cx, ENG_Z), M['plate'], smooth=False, phase=math.pi / 8))
        B.append(S.lathe(f'skirt{c}', [(-352, rim), (-352, ENG_R + 2.4), (-362, ENG_R + 2.4), (-369, ENG_R - 4.0),
                                       (-369, ENG_R - 7.0)], 8, (cx, ENG_Z), M['armour'], smooth=False,
                         phase=math.pi / 8))
        for k, dx in enumerate(NOZ_OFFSETS):
            nx_, nz_ = cx + sgn * dx[0], ENG_Z + dx[1]
            prof = [(-358, 17.0), (-368, 18.6), (-378, 21.6), (-388, 24.4), (Y_EXIT, NOZ_R + 1.0),
                    (Y_EXIT - 0.4, NOZ_R + 0.2), (-389, 22.6), (-380, 18.9), (-371.5, 14.8), (-366, 13.4)]
            bell = S.lathe(f'bell{c}{k}', prof, 24, (nx_, nz_), M['nozzle'], closed=True, sharp=35)
            bell.data.materials.append(M['nozzle_in'])
            for p in bell.data.polygons:
                ctr = Vector(p.center)
                radial = Vector((ctr.x - nx_, 0, ctr.z - nz_))
                if p.normal.dot(radial) < 0 or ctr.y < Y_EXIT + 0.05:
                    p.material_index = 1
            B.append(bell)
            B.append(S.lathe(f'throat{c}{k}', [(-372, 0), (-372, 15.4), (-370.6, 15.4), (-370.6, 0)], 24, (nx_, nz_),
                             M['throat'], smooth=False))
            B.append(S.lathe(f'core{c}{k}', [(-370.9, 0), (-370.9, 8.0), (-370.3, 7.0), (-370.0, 0)], 24, (nx_, nz_),
                             M['throat_core'], smooth=False))
            idx = c * 3 + k
            nozzles.append(S.empty(f'nozzle_{idx}', (nx_, Y_EXIT, nz_)))
    empties += nozzles
    return nozzles


def build_cage(M, B):
    """The reactor cage: ribs following the hull section, longerons, the
    conduits holding the reactor, and collars on the bulkheads."""
    w, top, bot = WAIST
    td = 2.0
    for k, y in enumerate(HOOPS):
        path = [Vector(p) for p in hull_ring(y, w, top, bot, td, scale=0.95, zc=REACTOR.z)]
        B.append(MP.tube(f'hoop{k}', path, 6.0, M['cage'], rb=7.2, sides=4, phase=math.pi / 4, up=(0, 1, 0),
                         closed=True, sharp=30))
    for k, y in enumerate((-Y_BULK + 3, Y_BULK - 3)):
        path = [Vector(p) for p in hull_ring(y, w, top, bot, td, scale=0.99, zc=REACTOR.z)]
        B.append(MP.tube(f'endframe{k}', path, 4.6, M['cage'], rb=8.5, sides=4, phase=math.pi / 4, up=(0, 1, 0),
                         closed=True, sharp=30))
    half = hull_half(w, top, bot, td)
    picks = [(0.0, half[0][1]), half[3], half[8], half[10]]
    for k, (x, z) in enumerate(picks):
        for sgn in ((1,) if x == 0 else (1, -1)):
            px = sgn * x * 0.95
            pz = REACTOR.z + (z - REACTOR.z) * 0.95
            path = [Vector((px, Y_BULK + 6, pz)), Vector((px, -Y_BULK - 6, pz))]
            r = 6.5 if x == 0 else 4.6
            B.append(MP.tube(f'longeron{k}{sgn}', path, r, M['cage'], rb=r * 1.1, sides=4, phase=math.pi / 4,
                             up=(px, 0, pz - REACTOR.z), sharp=30))
    # clamps where the longerons cross the ribs
    clamps = MP.Batch('clamps')
    for y in HOOPS:
        for k, (x, z) in enumerate(picks):
            for sgn in ((1,) if x == 0 else (1, -1)):
                px, pz = sgn * x * 0.95, REACTOR.z + (z - REACTOR.z) * 0.95
                out = Vector((px, 0, pz - REACTOR.z)).normalized()
                m = MP.surface_frame(Vector((px, y, pz)) + out * 4.0, out, (0, 1, 0))
                MP.cblock(clamps(M['machine']), m, 12.0, 14.0, 3.2, 1.2, taper=0.9, sink=2.0)
    B.extend(clamps.objects())
    # conduits from both bulkheads into the core
    pipes = MP.Batch('conduit')
    for sy in (1, -1):
        for ox, oz in ((18, 13), (-18, 13), (18, -12), (-18, -12)):
            start = Vector((ox, sy * (Y_BULK + 2), REACTOR.z + oz))
            d = (REACTOR - start).normalized()
            end = REACTOR - d * (R_CORE - 0.8)
            mid = start.lerp(end, 0.5) + Vector((0, 0, 3.0 if oz > 0 else -3.0))
            MP.add_tube(pipes(M['conduit']), [start, mid, end], 3.4, sides=6, up=(0, 1, 0))
            MP.add_lathe(pipes(M['machine']), [(-1.0, 5.6), (3.0, 5.6), (4.0, 4.2)], 6,
                         MP.surface_frame(start, (0, -sy, 0), (0, 0, 1)), caps=True)
        # a heavy socket ring on the bulkhead, glowing on its inner lip
        y0 = sy * Y_BULK
        prof = [(y0 + sy * 2, 27.0), (y0 - sy * 4, 27.0), (y0 - sy * 6, 24.0), (y0 - sy * 6, 21.0), (y0 - sy * 4, 18.0),
                (y0 + sy * 2, 16.5)]
        B.append(S.lathe(f'socket_ring{sy}', prof, 16, (0, REACTOR.z), M['machine'], closed=True, sharp=30))
        B.append(S.lathe(f'socket_glow{sy}', [(y0 - sy * 5.0, 18.6), (y0 - sy * 6.4, 19.2), (y0 - sy * 6.4, 21.4),
                                             (y0 - sy * 5.0, 22.0)], 16, (0, REACTOR.z), M['redglow'], closed=True,
                         sharp=30))
    B.extend(pipes.objects(sharp=35))


def build_frames(M, B, bvh):
    """Harrow frames across the back, each with three raked tines; the two
    cage ribs and the end frames carry the tallest ones."""
    tines = MP.Batch('tines')
    lights = []
    for y, hgt in FRAMES_FORE + FRAMES_AFT:
        w = station(FORE if y > 0 else AFT, y)[0]
        half = min(34.0, 0.62 * w)
        path = []
        for i in range(9):
            x = -half + 2 * half * i / 8
            loc, n = MP.cast(bvh, (x, y, 300), (0, 0, -1))
            if loc is not None:
                path.append(loc)
        if len(path) < 3:
            continue
        B.append(S.bar(f'frame{y}', path, 6.0, 5.0, M['plate'], lambda p: Vector((p.x * 0.006, 0, 1)).normalized()))
        top = path[len(path) // 2] + Vector((0, 0, 4.5))
        tip, light = MP.add_tine(tines(M['tine']), top, (0, 0, 1), (0, 1, 0), hgt, 15.0, 4.0, rake=0.42, hook=0.06)
        lights.append(('tine', tip))
        for sgn in (1, -1):
            x = sgn * half * 0.68
            loc, n = MP.cast(bvh, (x, y, 300), (0, 0, -1))
            if loc is None:
                continue
            up = Vector((sgn * math.sin(math.radians(26)), 0, math.cos(math.radians(26))))
            MP.add_tine(tines(M['tine']), loc + Vector((0, 0, 4.0)), up, (0, 1, 0), hgt * 0.6, 11.0, 3.2, rake=0.4)
    # cage crown: tines on the ribs and the end frames
    for y, hgt in ((-22.0, 80.0), (22.0, 80.0), (-Y_BULK + 3, 70.0), (Y_BULK - 3, 70.0)):
        z0 = REACTOR.z + (WAIST[1] - REACTOR.z) * (0.95 if abs(y) < 30 else 0.99) + 4.0
        tip, _ = MP.add_tine(tines(M['tine']), (0, y, z0), (0, 0, 1), (0, 1, 0), hgt, 16.0, 4.4, rake=0.42, hook=0.06)
        lights.append(('crown', tip))
    B.extend(tines.objects(sharp=30))
    return lights


def trench(y):
    """(inner wall x, roof z, floor z) of the starboard arm trench at y."""
    w, top, bot, td = station(FORE if y > 0 else AFT, y)
    h = top - bot
    return 0.93 * w - td, top - 0.41 * h, bot + 0.30 * h


def arm_parts(M, y_sh, y_el, y_wr, name):
    """One folded fabrication arm in the starboard trench (mirrored for
    port): upper arm aft from the shoulder, forearm folded forward beneath
    it, a claw head at the wrist. Everything leans on the trench wall."""
    parts = []
    hu, hl = (6.4, 5.0), (5.6, 4.2)          # half sizes (across, up) of the two beams

    def upper(y):
        wall, roof, floor = trench(y)
        return wall - 1.0 + hu[0], roof - 1.4 - hu[1]

    def lower(y):
        wall, roof, floor = trench(y)
        return wall - 1.0 + hl[0], floor + 1.4 + hl[1]

    def beam(y0, y1, centre, hw, hh):
        rings = []
        sgn = math.copysign(1, y1 - y0)
        for y, k in ((y0, 0.8), (y0 + sgn * 8, 1.0), ((y0 + y1) / 2, 1.0), (y1 - sgn * 8, 1.0), (y1, 0.85)):
            cx, cz = centre(y)
            sec = [(hw * k, 0.35 * hh), (0.55 * hw * k, hh * k), (-hw, hh * k), (-hw, -hh * k),
                   (0.55 * hw * k, -hh * k), (hw * k, -0.35 * hh)]
            rings.append([(cx + dx, y, cz + dz) for dx, dz in sec])
        return MP.loft(f'{name}_beam{y0:.0f}', rings, M['plate'], sharp=25)

    parts.append(beam(y_sh, y_el, upper, *hu))
    parts.append(beam(y_el, y_wr, lower, *hl))
    bands = MP.Batch(f'{name}_bands')
    for y0, y1, centre, (hw, hh) in ((y_sh, y_el, upper, hu), (y_el, y_wr, lower, hl)):
        for t in (0.16, 0.84):
            y = y0 + (y1 - y0) * t
            cx, cz = centre(y)
            MP.add_tube(bands(M['hazard']), [(cx, y - 2.2, cz), (cx, y + 2.2, cz)], hh + 0.5, hw + 0.5, sides=4,
                        phase=math.pi / 4, up=(0, 0, 1))

    def hub(y, z, r):
        wall = trench(y)[0]
        m = Matrix.Translation((wall + 6.5, y, z)) @ Matrix.Rotation(math.radians(90), 4, 'Z')
        ob = S.lathe(f'{name}_hub{y:.0f}', [(-7.6, 0), (-7.6, r), (7.6, r), (7.6, 0)], 8, (0, 0), M['machine'],
                     smooth=False, phase=math.pi / 8)
        ring = S.lathe(f'{name}_hubglow{y:.0f}', [(-7.9, 0), (-7.9, r * 0.55), (-7.2, r * 0.55), (-7.2, 0)], 8, (0, 0),
                       M['redglow'], smooth=False, phase=math.pi / 8)
        parts.append(S.transformed(ring, m))
        return S.transformed(ob, m)

    parts.append(hub(y_sh, upper(y_sh)[1], 8.6))
    parts.append(hub(y_el, (upper(y_el)[1] + lower(y_el)[1]) / 2, 9.4))
    parts.append(hub(y_wr, lower(y_wr)[1], 6.2))
    rams = MP.Batch(f'{name}_rams')
    sgn = 1 if y_el < y_sh else -1
    ya, yb = y_sh - sgn * 10, y_el + sgn * 14
    top = lambda y: Vector((upper(y)[0] + 2.4, y, upper(y)[1] + hu[1] + 1.1))
    MP.add_tube(rams(M['machine']), [top(ya), top(yb)], 1.5, sides=6)
    MP.add_tube(rams(M['hazard']), [top(ya - sgn * 2), top((y_sh + y_el) / 2)], 2.4, sides=6)
    ya, yb = y_el - sgn * 12, y_wr + sgn * 10
    out = lambda y: Vector((lower(y)[0] + hl[0] - 0.4, y, lower(y)[1] + 1.0))
    MP.add_tube(rams(M['machine']), [out(ya), out(yb)], 1.2, sides=6)
    # the claw: three hooked fingers and a cutting torch
    d = -sgn
    cx, cz = lower(y_wr)
    for k, dz in enumerate((-4.6, 0.0, 4.6)):
        MP.add_tine(rams(M['tine']), (cx, y_wr + d * 4.0, cz + dz), (0, d, 0.12 * dz / 4.6), (-1, 0, 0),
                    20.0 - abs(dz), 5.5, 2.6, rake=-0.05, hook=0.18, sink=2.0)
    MP.add_tube(rams(M['machine']), [(cx + 4.5, y_wr, cz), (cx + 4.5, y_wr + d * 14.0, cz)], 1.6, sides=6)
    MP.add_tube(rams(M['redglow']), [(cx + 4.5, y_wr + d * 14.0, cz), (cx + 4.5, y_wr + d * 16.0, cz)], 1.0, sides=6)
    parts += rams.objects() + bands.objects()
    return parts


def build_arms(M, B):
    parts = arm_parts(M, 230.0, 114.0, 206.0, 'arm_f') + arm_parts(M, -114.0, -188.0, -134.0, 'arm_a')
    B.extend(S.mirrored(parts))


def build_bays(M, B, bvh, empties):
    bays = MP.Batch('bays')
    for k, sgn in enumerate((-1, 1)):                     # bay 0 port, bay 1 starboard
        cx = sgn * 34.0
        # launch rails under the ceiling
        for dx in (-8.0, 8.0):
            MP.add_tube(bays(M['machine']), [(cx + dx, 146.0, -16.5), (cx + dx, 214.0, -16.5)], 1.6, rb=2.4, sides=4,
                        phase=math.pi / 4)
        # hazard frame round the mouth
        pts = []
        for x, y in ((cx - sgn * 22, 137), (cx + sgn * 22, 137), (cx + sgn * 22, 238), (cx - sgn * 22, 238)):
            loc, n = MP.cast(bvh, (x, y, -200), (0, 0, 1))
            pts.append(loc if loc is not None else Vector((x, y, -42)))
        for a, b in zip(pts, pts[1:] + pts[:1]):
            MP.add_tube(bays(M['hazard']), [a + Vector((0, 0, -0.8)), b + Vector((0, 0, -0.8))], 1.4, rb=3.0, sides=4,
                        phase=math.pi / 4, up=(0, 0, -1))
        # the outer door hangs open, hinged on the mouth's outer edge
        hinge_x = cx + sgn * 20
        m = (Matrix.Translation((hinge_x, 187, -41.0)) @ Matrix.Rotation(math.radians(sgn * 52), 4, 'Y')
             @ Matrix.Translation((sgn * 10.0, 0, 0)))
        MP.block(bays(M['plate']), m, 20.0, 92.0, 2.2, taper=0.96, sink=0.0, open_bottom=False)
        MP.block(bays(M['hazard']), m @ Matrix.Translation((sgn * 8.0, 0, 2.0)), 3.0, 88.0, 0.6, sink=0.0, open_bottom=False)
        bay = S.empty(f'bay_{k}', (cx, 196.0, -40.0))
        d = Vector((0, 0.6, -0.8)).normalized()
        bay.rotation_mode = 'QUATERNION'
        bay.rotation_quaternion = (-d).to_track_quat('Y', 'Z')
        empties.append(bay)
        empties.append(sub_empty(f'sub_bay_{k}', (cx, 190.0, -28.0), 38.0))
    B.extend(bays.objects())


def build_domes(M, B, bvh, empties, lights):
    """Shield generators: a ribbed glowing dome on an octagonal pedestal.
    The dome shells become the `shield_N` nodes after the bake."""
    domes = []
    for k, (x, y) in enumerate(DOMES):
        loc, n = MP.cast(bvh, (x, y, 300), (0, 0, -1))
        base = MP.surface_frame(loc, (0, 0, 1), (0, 1, 0))
        ped = MP.Batch(f'pedestal{k}')
        MP.add_lathe(ped(M['machine']), [(-8.0, 28.0), (2.0, 28.0), (5.0, 26.0), (7.0, 23.5), (7.0, 20.5)], 12, base,
                     phase=math.pi / 12)
        MP.add_lathe(ped(M['hazard']), [(1.0, 28.6), (2.6, 28.6)], 12, base, phase=math.pi / 12)
        r = 22.0
        prof = [(6.6, r), (11.0, r * 0.94), (15.5, r * 0.78), (19.4, r * 0.55), (21.6, r * 0.28), (22.4, 0.0)]
        bm = bmesh.new()
        MP.add_lathe(bm, prof, 28, base)
        dome = MP.solid(f'shield_{k}', bm, M['dome'], sharp=60, recalc=False)
        domes.append((dome, loc + Vector((0, 0, 6.6))))
        for j in range(4):
            a = math.radians(45 + 90 * j)
            path = [base @ Vector((math.cos(a) * (rr + 0.7), math.sin(a) * (rr + 0.7), zz)) for zz, rr in prof[:-1]]
            MP.add_tube(ped(M['plate']), path, 1.2, rb=1.8, sides=4, phase=math.pi / 4,
                        up=lambda p, c=loc: (p - c).normalized())
        tip = base @ Vector((0, 0, 22.4))
        _, _ = MP.add_tine(ped(M['tine']), tip - Vector((0, 0, 1.5)), (0, 0, 1), (0, 1, 0), 9.0, 3.0, 1.6, rake=0.0,
                           hook=0.0, sink=1.0)
        lights.append(('dome', tip + Vector((0, 0, 7.5))))
        B.extend(ped.objects())
        empties.append(sub_empty(f'sub_shield_{k}', loc + Vector((0, 0, 14.0)), r + 4.0))
    return domes


def sub_empty(name, loc, r):
    e = S.empty(name, loc)
    e.empty_display_type = 'SPHERE'
    e.scale = (r, r, r)
    return e


# ==========================================================================
# Greebles

def scatter(M, bvh, rng, avoid, G):
    """Greebles at three scales over deck, flanks, belly and engines, plus
    mirrored rows of identical modules; everything goes to G."""
    gb = MP.Batch('greeble')
    mats = [(M['machine'], 0.6), (M['plate'], 0.24), (M['armour'], 0.14), (M['hazard'], 0.02)]

    def pick():
        u = rng.random()
        for m, w in mats:
            if u < w:
                return m
            u -= w
        return mats[0][0]

    def blocked(p):
        for c, r in avoid:
            if (p - c).length < r:
                return True
        for y in PITS:                              # nothing on the forge pits' floors or rims
            if abs(p.x) < 18.0 and abs(p.y - y) < 16.0 and p.z > 0:
                return True
        return False

    def place(origin, direction, size_range, kind=None, dims=None, mat=None):
        loc, n = MP.cast(bvh, origin, direction)
        if loc is None or blocked(loc):
            return False
        if n.z < -0.98 and abs(loc.x) < 4:          # keep the keel line clean
            return False
        m = MP.surface_frame(loc, n, (0, 1, 0))
        if dims:
            sx, sy, sz = dims
        else:
            lo, hi = size_range
            sx, sy = rng.uniform(lo, hi), rng.uniform(lo, hi) * rng.choice((1.0, 1.6, 2.4))
            sz = rng.uniform(0.25, 0.6) * min(sx, sy) * 0.6 + 0.5
        kind = kind or rng.choices(('block', 'cblock', 'stack', 'wedge', 'vent', 'fins', 'dome'),
                                   (0.4, 0.14, 0.14, 0.12, 0.07, 0.06, 0.07))[0]
        bmx = gb(mat or pick())
        if kind == 'block':
            MP.block(bmx, m, sx, sy, sz, taper=rng.uniform(0.82, 1.0))
        elif kind == 'cblock':
            MP.cblock(bmx, m, sx, sy, sz * 1.3, min(sx, sy) * 0.18, taper=rng.uniform(0.9, 1.0))
        elif kind == 'stack':
            MP.block(bmx, m, sx, sy, sz, taper=0.95)
            m2 = m @ Matrix.Translation((rng.uniform(-0.15, 0.15) * sx, rng.uniform(-0.15, 0.15) * sy, sz))
            MP.block(gb(pick()), m2, sx * 0.55, sy * 0.6, sz * 0.9, taper=0.9, sink=0.3)
            if rng.random() < 0.5:
                MP.block(gb(M['machine']), m2 @ Matrix.Translation((0, 0, sz * 0.9)), sx * 0.25, sy * 0.3, sz * 0.7,
                         taper=0.85, sink=0.3)
        elif kind == 'wedge':
            MP.wedge(bmx, m, sx, sy * 1.4, sz * 1.2)
        elif kind == 'vent':
            MP.block(gb(M['machine']), m, sx, sy, sz * 0.6, taper=0.97)
            MP.block(gb(M['vent']), m @ Matrix.Translation((0, 0, sz * 0.6)), sx * 0.72, sy * 0.78, 0.12, sink=0.2)
            for j in range(2):
                yy = (j - 0.5) * sy * 0.3
                MP.block(gb(M['machine']), m @ Matrix.Translation((0, yy, sz * 0.6)), sx * 0.8, sy * 0.08, 0.45, sink=0.2)
        elif kind == 'fins':
            for j in range(3):
                yy = (j - 1) * sy * 0.3
                MP.block(gb(M['machine']), m @ Matrix.Translation((0, yy, 0)), sx, max(0.4, sy * 0.07), sz * 1.4,
                         taper=0.92)
        elif kind == 'dome':
            r = min(sx, sy) * 0.5
            MP.add_lathe(gb(M['machine']), [(-0.5, r), (r * 0.45, r * 0.85), (r * 0.75, r * 0.45), (r * 0.85, 0)], 8, m)
        return True

    # deck and shoulders: rays straight down
    def deck(count, ys, size, xmax=1.0):
        n = 0
        while n < count:
            y = rng.uniform(*ys)
            st = station(FORE if y > 0 else AFT, y)
            x = rng.uniform(-xmax, xmax) * st[0] * 0.86
            if place(Vector((x, y, 300)), (0, 0, -1), size):
                n += 1
            else:
                n += 0.25

    def flank(count, ys, zs, size):
        n = 0
        while n < count:
            y = rng.uniform(*ys)
            z = rng.uniform(*zs)
            sgn = rng.choice((1, -1))
            if place(Vector((sgn * 300, y, z)), (-sgn, 0, rng.uniform(-0.25, 0.25)), size):
                n += 1
            else:
                n += 0.25

    def belly(count, ys, size):
        n = 0
        while n < count:
            y = rng.uniform(*ys)
            st = station(FORE if y > 0 else AFT, y)
            x = rng.uniform(-1, 1) * st[0] * 0.9
            if place(Vector((x, y, -300)), (0, 0, 1), size):
                n += 1
            else:
                n += 0.25

    def row(xfrac, ys, step, kind, dims, mat=None, flankz=None):
        """A mirrored row of identical modules along the hull: machinery
        that reads as designed, not sprinkled."""
        for y in np.arange(ys[0], ys[1], step):
            st = station(FORE if y > 0 else AFT, y)
            for sgn in (1, -1):
                if flankz is None:
                    place(Vector((sgn * xfrac * st[0], y, 300)), (0, 0, -1), None, kind, dims, mat)
                else:
                    place(Vector((sgn * 300, y, flankz)), (-sgn, 0, 0), None, kind, dims, mat)

    for ys, belly_ys in (((76, 258), (76, 222)), ((-330, -76), (-330, -76))):
        row(0.62, (ys[0] + 6, ys[1]), 12.0, 'vent' if ys[0] > 0 else 'block', (5.0, 7.0, 2.2), M['machine'])
        row(0.36, (ys[0] + 3, ys[1]), 21.0, 'cblock', (8.0, 12.0, 3.0), M['plate'])
        row(0.9, (ys[0] + 10, ys[1]), 9.0, 'block', (2.4, 5.0, 1.6), M['machine'], flankz=-38.0)
        deck(18, ys, (10.0, 20.0))
        deck(34, ys, (4.5, 10.0))
        deck(30, ys, (2.0, 4.5))
        flank(14, ys, (19.0, 44.0), (6.0, 13.0))
        flank(18, ys, (19.0, 44.0), (2.0, 4.5))
        flank(12, ys, (-44.0, -30.0), (6.0, 13.0))
        flank(14, ys, (-44.0, -30.0), (2.0, 4.5))
        belly(20, belly_ys, (7.0, 16.0))
        belly(24, belly_ys, (2.0, 5.0))
    # engine housings
    for sgn in (1, -1):
        for _ in range(18):
            y = rng.uniform(-345, -222)
            a = rng.uniform(-0.2, 1.0) * math.pi
            d = Vector((math.cos(a) * sgn, 0, math.sin(a)))
            place(Vector((sgn * ENG_X, y, ENG_Z)) + d * 200, -d, rng.choice(((5.0, 12.0), (1.6, 4.5))))
    G.extend(gb.objects())


def pipes_and_strips(M, bvh, B):
    """Long conduits along the lower flanks, and glowing strips along the
    trench walls behind the folded arms (lit seams)."""
    pb = MP.Batch('pipes')
    for ys in ((110, 244), (-190, -110)):
        for sgn in (1, -1):
            for level in (1, 2):
                path = []
                for y in np.linspace(ys[0], ys[1], 6):
                    wall, roof, floor = trench(y)
                    z = roof - 1.0 if level == 1 else floor + 1.0
                    path.append(Vector((sgn * (wall - 0.15), y, z)))
                MP.add_tube(pb(M['redglow']), path, 1.0, sides=4, phase=math.pi / 4, up=(sgn, 0, 0))
    for ys in ((96, 250), (-300, -96)):
        for sgn in (1, -1):
            for k, zoff in enumerate((0.0, 3.2, 6.4)):
                path = []
                for y in np.linspace(ys[0], ys[1], 7):
                    st = station(FORE if y > 0 else AFT, y)
                    w, top, bot = st[0], st[1], st[2]
                    h = top - bot
                    loc, n = MP.cast(bvh, (sgn * 300, y, bot + 0.1 * h + zoff), (-sgn, 0, 0))
                    if loc is not None:
                        path.append(loc + n * (1.6 + k * 0.4))
                if len(path) > 2:
                    MP.add_tube(pb(M['machine' if k != 1 else 'plate']), path, 1.4 + 0.3 * (k == 1), sides=6,
                                up=(sgn, 0, 0))
    B.extend(pb.objects(sharp=35))


def build_spine_details(M, Gm, bvh, B, G, lights):
    """Antenna masts, armour shingles, the keel ridge and the Perpetua plate."""
    sb = MP.Batch('spine')
    gb = MP.Batch('spine_kit')
    # armour shingles on the upper deck between frames
    ys = [r[0] for r in FRAMES_FORE] + [r[0] for r in FRAMES_AFT[:4]]
    for y0 in ys:
        for sgn in (1, -1):
            yy = y0 - 18 if y0 > 0 else y0 - 18
            st = station(FORE if yy > 0 else AFT, yy)
            x = sgn * st[0] * 0.38
            loc, n = MP.cast(bvh, (x, yy, 300), (0, 0, -1))
            if loc is None:
                continue
            m = MP.surface_frame(loc, n, (0, 1, 0))
            MP.wedge(sb(M['armour']), m, 16.0, 24.0, 2.4)
    # layered armour along the upper flanks: overlapping plates, each one's
    # raised edge facing aft
    for ys in (np.arange(116, 250, 34), np.arange(-120, -200, -34)):
        for y in ys:
            for sgn in (1, -1):
                w, top, bot, td = station(FORE if y > 0 else AFT, y)
                h = top - bot
                target = Vector((sgn * 0.865 * w, y, top - 0.315 * h))
                loc, n = MP.cast(bvh, target + Vector((sgn * 0.6, 0, 0.8)) * 60, (-sgn * 0.6, 0, -0.8))
                if loc is None or (loc - target).length > 6:
                    continue
                m = MP.surface_frame(loc, n, (0, 1, 0))
                MP.wedge(sb(M['plate' if (int(y) // 34) % 2 else 'armour']), m, 9.0, 30.0, 2.2)
            for sgn in (1, -1):
                w, top, bot, td = station(FORE if y > 0 else AFT, y)
                h = top - bot
                target = Vector((sgn * 0.92 * w, y + 17, bot + 0.12 * h))
                loc, n = MP.cast(bvh, target + Vector((sgn, 0, -0.6)) * 60, (-sgn, 0, 0.6))
                if loc is None or (loc - target).length > 8:
                    continue
                m = MP.surface_frame(loc, n, (0, 1, 0))
                MP.wedge(sb(M['plate']), m, 10.0, 28.0, 2.0)
    # grilles across the forge pits
    for y in PITS:
        top = station(FORE if y > 0 else AFT, y)[1]
        for k in range(4):
            yy = y - 8.0 + k * 5.3
            MP.block(gb(Gm['machine']), Matrix.Translation((0, yy, top - 1.6)), 27.0, 1.4, 1.8, sink=0.0, open_bottom=False)
        MP.block(gb(Gm['machine']), Matrix.Translation((0, y, top - 1.6)), 1.6, 23.0, 1.6, sink=0.0, open_bottom=False)
    # tines ringing the ore maws, pointing down and in like a lamprey's teeth
    for x, y, hw, hl in MAWS:
        ring = [(x + dx * (hw + 3.0), y + dy * (hl + 3.0)) for dx, dy in
                ((-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0))]
        for px, py in ring:
            loc, n = MP.cast(bvh, (px, py, -300), (0, 0, 1))
            if loc is None:
                continue
            inward = Vector((x - px, y - py, 0)).normalized()
            MP.add_tine(sb(M['tine']), loc + Vector((0, 0, 1.5)), Vector((0, 0, -1)) + inward * 0.45, inward,
                        13.0, 7.0, 2.6, rake=0.3, hook=0.15, sink=3.0)
    # raked blades on the engine housings, like the Thorn's fins
    for sgn in (-1, 1):
        cx = sgn * ENG_X
        top = ENG_Z + ENG_R * math.cos(math.pi / 8)
        MP.add_tine(sb(M['armour']), (cx, -296.0, top), (0, -0.15, 1), (0, 1, 0), 34.0, 74.0, 5.0, rake=0.65, hook=0.0,
                    sink=4.0)
        MP.add_tine(sb(M['armour']), (cx + sgn * ENG_R * math.cos(math.pi / 8), -292.0, ENG_Z), (sgn, -0.15, 0.1),
                    (0, 1, 0), 26.0, 60.0, 4.4, rake=0.6, hook=0.0, sink=4.0)
        MP.add_tine(sb(M['armour']), (cx, -292.0, ENG_Z - ENG_R * math.cos(math.pi / 8)), (0, -0.15, -1), (0, 1, 0),
                    22.0, 56.0, 4.4, rake=0.6, hook=0.0, sink=4.0)
    # a ventral blade under the aft hull and smaller ones along the belly
    loc, n = MP.cast(bvh, (0, -262, -300), (0, 0, 1))
    if loc is not None:
        MP.add_tine(sb(M['tine']), loc + Vector((0, 0, 3.0)), (0, -0.25, -1), (0, 1, 0), 38.0, 74.0, 7.0, rake=0.5, hook=0.0,
                    sink=6.0)
    for y in (-200.0, -300.0):
        for sgn in (1, -1):
            loc, n = MP.cast(bvh, (sgn * 22, y, -300), (0, 0, 1))
            if loc is not None:
                MP.add_tine(sb(M['tine']), loc + Vector((0, 0, 2.0)), (sgn * 0.35, -0.2, -1), (0, 1, 0), 18.0, 30.0, 4.0,
                            rake=0.5, hook=0.0, sink=4.0)
    # antenna masts on the aft deck and the engine housings
    for k, (x, y) in enumerate(((22, -262), (-22, -262), (ENG_X + 18, -300), (-ENG_X - 18, -300))):
        loc, n = MP.cast(bvh, (x, y, 300), (0, 0, -1))
        if loc is None:
            continue
        hgt = 34.0 if k < 2 else 26.0
        MP.add_tube(gb(Gm['machine']), [loc - Vector((0, 0, 1)), loc + Vector((0, 0, hgt))], [1.2, 0.5], sides=4)
        MP.block(gb(Gm['machine']), MP.surface_frame(loc, (0, 0, 1)), 5.0, 5.0, 3.0, taper=0.7)
        for j, hh in enumerate((0.45, 0.7)):
            p = loc + Vector((0, 0, hgt * hh))
            MP.add_tube(gb(Gm['machine']), [p - Vector((4.5 - j * 1.5, 0, 0)), p + Vector((4.5 - j * 1.5, 0, 0))], 0.35,
                        sides=4)
        lights.append(('mast', loc + Vector((0, 0, hgt + 0.8))))
    # ventral keel ridge
    path = []
    for y in np.linspace(136, 280, 5):
        loc, n = MP.cast(bvh, (0, y, -300), (0, 0, 1))
        if loc is not None:
            path.append(loc)
    if len(path) > 2:
        B.append(S.bar('keel_f', path, 7.0, 4.0, M['plate'], lambda p: Vector((0, 0, -1))))
    path = []
    for y in np.linspace(-156, -330, 6):
        loc, n = MP.cast(bvh, (0, y, -300), (0, 0, 1))
        if loc is not None:
            path.append(loc)
    if len(path) > 2:
        B.append(S.bar('keel_a', path, 7.0, 4.0, M['plate'], lambda p: Vector((0, 0, -1))))
    # the Perpetua plate: a patched, faded off-white panel with a teal band
    target = Vector((-PERPETUA_PLATE[0], PERPETUA_PLATE[1], PERPETUA_PLATE[2]))
    loc, n = MP.cast(bvh, target + Vector((-0.6, 0, 0.8)) * 100, (0.6, 0, -0.8))
    if loc is not None:
        m = MP.surface_frame(loc, n, (0, 1, 0)) @ Matrix.Rotation(math.radians(3), 4, 'Z')
        MP.block(sb(M['perpetua']), m, 10.5, 26.0, 0.9, taper=0.98)
    B.extend(sb.objects())
    G.extend(gb.objects())


def build_turrets(F, M, B, bvh):
    """Eight turrets on barbettes: shared base and gun meshes (glTF
    factors), each base at its yaw pivot (local +Z out of the hull, +Y
    forward), each gun at its trunnion with the barrels along +Y."""
    k = TURRET_SIZE
    bm = bmesh.new()
    MP.add_lathe(bm, [(0.0, 0.7 * k), (0.12 * k, 0.73 * k), (0.35 * k, 0.64 * k), (0.44 * k, 0.5 * k)], 8, Matrix(),
                 phase=math.pi / 8, caps=True)
    me = bpy.data.meshes.new('turret_base')
    bm.to_mesh(me)
    bm.free()
    # cheeks either side of the gun and a glacis, oxblood; a red sensor
    bm = bmesh.new()
    for sgn in (1, -1):
        MP.block(bm, Matrix.Translation((sgn * 0.4 * k, 0.03 * k, 0.38 * k)), 0.16 * k, 0.62 * k, 0.46 * k, taper=0.8,
                 sink=0.6)
    MP.wedge(bm, Matrix.Translation((0, 0.46 * k, 0.3 * k)) @ Matrix.Rotation(math.pi, 4, 'Z'), 0.6 * k, 0.32 * k,
             0.16 * k, sink=0.4)
    cheek = bpy.data.meshes.new('turret_cheek')
    bm.to_mesh(cheek)
    bm.free()
    bm = bmesh.new()
    MP.octa(bm, (0.66 * k, 0.16 * k, 0.26 * k), 0.07 * k)
    sensor = bpy.data.meshes.new('turret_sensor')
    bm.to_mesh(sensor)
    bm.free()
    base_mesh = join_meshes('turret_base', [(me, F['t_armour']), (cheek, F['t_red']), (sensor, F['t_glow'])], sharp=35)

    bm = bmesh.new()
    MP.cblock(bm, Matrix.Translation((0, 0.04 * k, -0.22 * k)), 0.6 * k, 0.6 * k, 0.44 * k, 0.08 * k, taper=0.92, sink=0.0)
    MP.block(bm, Matrix.Translation((0, -0.34 * k, -0.17 * k)), 0.4 * k, 0.2 * k, 0.3 * k, taper=0.9, sink=0.0,
             open_bottom=False)
    mantlet = bpy.data.meshes.new('gun_mantlet')
    bm.to_mesh(mantlet)
    bm.free()
    bm = bmesh.new()
    for sgn in (1, -1):
        m = Matrix.Translation((sgn * 0.15 * k, 0, 0.02 * k)) @ Matrix.Rotation(math.radians(-90), 4, 'X')
        MP.add_lathe(bm, [(0.25 * k, 0.085 * k), (0.66 * k, 0.07 * k), (0.66 * k, 0.105 * k), (0.84 * k, 0.105 * k),
                          (0.84 * k, 0.0)], 8, m, phase=math.pi / 8)
    barrels = bpy.data.meshes.new('gun_barrels')
    bm.to_mesh(barrels)
    bm.free()
    gun_mesh = join_meshes('turret_gun', [(mantlet, F['t_armour']), (barrels, F['t_dark'])], sharp=35)

    turrets = []
    for name, origin, direction in TURRETS:
        loc, n = MP.cast(bvh, origin, direction)
        if loc is None:
            raise RuntimeError(f'{name}: ray missed the hull')
        frame = MP.surface_frame(loc, n, (0, 1, 0))
        barb = MP.Batch(f'{name}_barbette')
        rb = 0.8 * TURRET_SIZE
        MP.add_lathe(barb(M['machine']), [(-6.0, rb + 1.2), (TURRET_LIFT - 0.8, rb + 1.2), (TURRET_LIFT, rb),
                                          (TURRET_LIFT, 0.6 * TURRET_SIZE)], 8, frame, phase=math.pi / 8)
        MP.add_lathe(barb(M['hazard']), [(TURRET_LIFT - 2.6, rb + 0.9), (TURRET_LIFT - 2.6, rb + 1.5),
                                         (TURRET_LIFT - 1.4, rb + 1.5), (TURRET_LIFT - 1.4, rb + 0.9)], 8, frame,
                     phase=math.pi / 8)
        B.extend(barb.objects())
        base = bpy.data.objects.new(name, base_mesh)
        C.link(base)
        base.matrix_world = frame @ Matrix.Translation((0, 0, TURRET_LIFT))
        gun = bpy.data.objects.new(name + '_gun', gun_mesh)
        C.link(gun)
        gun.parent = base
        gun.matrix_parent_inverse = Matrix()
        gun.location = (0, 0, 0.6 * TURRET_SIZE)
        turrets.append(base)
        turrets.append(gun)
    return turrets


def join_meshes(name, pieces, sharp=35):
    """Mesh datablocks with one material each -> one mesh with slots."""
    objs = []
    for me, mat in pieces:
        me.materials.append(mat)
        objs.append(C.link(bpy.data.objects.new(me.name, me)))
    ob = C.join(objs, name)
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(sharp))
    me = ob.data
    bpy.data.objects.remove(ob)
    me.name = name
    return me


def build_reactor(F):
    """The reactor: a glowing core held in three containment hoops. Its
    origin is the core's centre."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=R_CORE)
    core = bpy.data.meshes.new('reactor_core')
    bm.to_mesh(core)
    bm.free()
    bm = bmesh.new()
    for axis in ('X', 'Y', 'Z'):
        rot = Matrix.Rotation(math.radians(90), 4, axis) if axis != 'Z' else Matrix()
        rot = rot @ Matrix.Rotation(math.radians(20), 4, 'Z')
        path = [rot @ Vector((math.cos(a) * (R_CORE + 2.2), math.sin(a) * (R_CORE + 2.2), 0))
                for a in np.linspace(0, 2 * math.pi, 24, endpoint=False)]
        rings = MP.tube_rings(bm, path, 1.6, 2.2, sides=4, phase=math.pi / 4, up=rot @ Vector((0, 0, 1)), closed=True)
        for i in range(len(rings)):
            a, b = rings[i], rings[(i + 1) % len(rings)]
            for j in range(4):
                k = (j + 1) % 4
                MP.orient(bm.faces.new((a[j], a[k], b[k], b[j])), (Vector(path[i]) + Vector(path[(i + 1) % len(path)])) / 2)
    frame = bpy.data.meshes.new('reactor_frame')
    bm.to_mesh(frame)
    bm.free()
    me = join_meshes('reactor', [(core, F['core']), (frame, F['core_frame'])], sharp=40)
    for p in me.polygons:
        p.use_smooth = p.material_index == 0
    ob = C.link(bpy.data.objects.new('reactor', me))
    ob.location = REACTOR
    return ob


def build_eye(F):
    """The great eye: a sphere looking along +Y (its origin is the centre),
    with a hot pupil and a bright iris on the front."""
    bm = bmesh.new()
    MP.uv_sphere(bm, (0, 0, 0), EYE_R, segments=28, rings=16, rotation=Matrix.Rotation(math.radians(-90), 3, 'X'))
    me = bpy.data.meshes.new('eye')
    bm.to_mesh(me)
    bm.free()
    for m in (F['sclera'], F['iris'], F['pupil']):
        me.materials.append(m)
    for p in me.polygons:
        ang = math.degrees(Vector(p.center).normalized().angle(Vector((0, 1, 0))))
        p.material_index = 2 if ang < 11 else 1 if ang < 34 else 0
    me.shade_smooth()
    ob = C.link(bpy.data.objects.new('eye', me))
    ob.location = EYE_C
    return ob


# ==========================================================================
# Colliders: a greedy set cover of the hull surface by spheres that hug it

def surface_samples(objs, spacing, rng):
    pts = []
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        mw = o.matrix_world
        for tri in me.loop_triangles:
            a, b, c = (mw @ me.vertices[i].co for i in tri.vertices)
            area = ((b - a).cross(c - a)).length / 2
            n = area / (spacing * spacing)
            k = int(n) + (1 if rng.random() < n - int(n) else 0)
            for _ in range(k):
                u, v = rng.random(), rng.random()
                if u + v > 1:
                    u, v = 1 - u, 1 - v
                pts.append(a + (b - a) * u + (c - a) * v)
    return pts


def fit_colliders(proxies, target=(40, 78), margin=1.5, spacing=5.0, step=6.0, voxel=4.0):
    """Collision spheres that hug the hull. A sphere is allowed if no part
    of it lies more than tau outside the plating (measured on a voxel field
    of the distance outside the hull, so spheres may fill trenches and bay
    mouths but not bulge into open space); spheres are picked greedily
    until every surface sample lies `margin` inside one, and tau is the
    smallest level that does it within the target count. Then each sphere
    shrinks to what it alone has to cover, and a dense pass (every 1.2 m)
    grows the nearest sphere over any sliver of plating left between the
    samples, so no point of the hull is outside the set."""
    rng = random.Random(11)
    bvhs = [S.bvh_of([o]) for o in proxies]
    union = S.bvh_of(proxies)
    boxes = []
    for o in proxies:
        vs = [o.matrix_world @ v.co for v in o.data.vertices]
        boxes.append((Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])))

    rays = (Vector((0.577, 0.571, 0.583)).normalized(), Vector((-0.31, 0.27, -0.91)).normalized())

    def parity(b, p, d):
        n, o = 0, p.copy()
        for _ in range(64):
            loc = b.ray_cast(o, d)[0]
            if loc is None:
                break
            n += 1
            o = loc + d * 1e-3
        return n % 2 == 1

    def inside_any(p):
        for (lo_, hi_), b in zip(boxes, bvhs):
            if lo_.x <= p.x <= hi_.x and lo_.y <= p.y <= hi_.y and lo_.z <= p.z <= hi_.z:
                if parity(b, p, rays[0]) and parity(b, p, rays[1]):
                    return True
        return False

    samples = surface_samples(proxies, spacing, rng)
    samples += [o.matrix_world @ v.co for o in proxies for v in o.data.vertices]      # corners and tips too

    def buried(p):
        # inside another proxy by more than half a metre
        for (lo_, hi_), b in zip(boxes, bvhs):
            if lo_.x <= p.x <= hi_.x and lo_.y <= p.y <= hi_.y and lo_.z <= p.z <= hi_.z:
                if b.find_nearest(p)[3] > 0.5 and parity(b, p, rays[0]) and parity(b, p, rays[1]):
                    return True
        return False

    boundary = [p for p in samples if not buried(p)]
    pts = np.array([tuple(p) for p in boundary])
    kd = KDTree(len(boundary))
    for i, p in enumerate(boundary):
        kd.insert(p, i)
    kd.balance()
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    # distance outside the hull on a voxel grid
    pad = 40.0
    grid, dout = [], []
    for x in np.arange(lo[0] - pad, hi[0] + pad, voxel):
        for y in np.arange(lo[1] - pad, hi[1] + pad, voxel):
            for z in np.arange(lo[2] - pad, hi[2] + pad, voxel):
                p = Vector((x, y, z))
                d = union.find_nearest(p)[3]
                if d < 2.0 or inside_any(p):
                    continue
                grid.append((x, y, z))
                dout.append(d)
    grid, dout = np.array(grid), np.array(dout)
    # candidate centres: a grid inside the hull, plus points just under the
    # plating so thin parts (mandibles, brow, emitter) have centres too
    cands = []
    for x in np.arange(lo[0] + step / 2, hi[0], step):
        for y in np.arange(lo[1] + step / 2, hi[1], step):
            for z in np.arange(lo[2] + step / 2, hi[2], step):
                p = Vector((x, y, z))
                if inside_any(p):
                    cands.append(p)
    for p in boundary[::4]:
        h = union.find_nearest(p)
        for depth in (2.5, 5.0, 9.0):
            q = h[0] - h[1] * depth
            if inside_any(q):
                cands.append(q)
    C.log(f'  colliders: {len(boundary)} surface samples, {len(cands)} candidate centres, {len(grid)} outside voxels')
    levels = [16.0, 18.0, 19.0, 20.0, 21.0, 22.0, 23.0, 24.0, 26.0, 28.0, 31.0, 35.0, 40.0]
    reach = {}

    def radii(tau):
        if tau not in reach:
            far = grid[dout > tau]
            tree = KDTree(len(far))
            for i, q in enumerate(far):
                tree.insert(q, i)
            tree.balance()
            reach[tau] = np.array([min(tree.find(c)[2] - voxel * 0.5, R_LIMIT - c.length) for c in cands])
        return reach[tau]

    def solve(tau):
        R = radii(tau)
        covers = []
        for c, r in zip(cands, R):
            if r - margin < 3.0:
                covers.append(np.zeros(0, dtype=np.int64))
                continue
            covers.append(np.array([i for _, i, _ in kd.find_range(c, r - margin)], dtype=np.int64))
        covered = np.zeros(len(boundary), bool)
        heap = [(-len(cv), i) for i, cv in enumerate(covers) if len(cv)]
        heapq.heapify(heap)
        chosen = []
        while heap and not covered.all():
            _, i = heapq.heappop(heap)
            gain = int((~covered[covers[i]]).sum())
            if gain == 0:
                continue
            if heap and gain < -heap[0][0]:
                heapq.heappush(heap, (-gain, i))
                continue
            chosen.append(i)
            covered[covers[i]] = True
        # drop spheres whose samples the others already cover, smallest first
        count = np.zeros(len(boundary), np.int32)
        for i in chosen:
            count[covers[i]] += 1
        for i in sorted(chosen, key=lambda i: len(covers[i])):
            if (count[covers[i]] > 1).all():
                count[covers[i]] -= 1
                chosen.remove(i)
        return chosen, bool(covered.all()), R

    for tau in levels:
        chosen, ok, R = solve(tau)
        C.log(f'    tau {tau:.0f} m: {len(chosen)} spheres{"" if ok else " (incomplete)"}')
        if ok and len(chosen) <= target[1]:
            break
    spheres = [(cands[i], R[i]) for i in chosen]
    centres = np.array([tuple(p) for p, _ in spheres])
    rad = np.array([r for _, r in spheres])
    dist = np.linalg.norm(pts[None, :, :] - centres[:, None, :], axis=2)
    owner = np.argmax(rad[:, None] - dist, axis=0)
    out = []
    for j, (p, r) in enumerate(spheres):
        mine = owner == j
        if not mine.any():
            continue
        out.append([np.array(tuple(p)), min(r, dist[j, mine].max() + margin)])
    # the fit saw samples 5 m apart: check the plating every metre or so
    # and grow the nearest sphere over any sliver left between samples
    dense = grid_samples(proxies, 1.2)
    centres = np.array([c for c, _ in out])

    def deficit(pts_):
        rad = np.array([r for _, r in out])
        best = np.full(len(pts_), np.inf)
        which = np.zeros(len(pts_), np.int64)
        for k in range(0, len(pts_), 40000):
            d = np.linalg.norm(pts_[k:k + 40000, None, :] - centres[None, :, :], axis=2) - rad[None, :]
            which[k:k + 40000] = np.argmin(d, axis=1)
            best[k:k + 40000] = d[np.arange(len(d)), which[k:k + 40000]]
        return best, which

    best, _ = deficit(dense)
    loose = dense[best > -0.3]
    loose = np.array([q for q in loose if not buried(Vector(q))]).reshape(-1, 3)
    before = [r for _, r in out]
    for grown in range(5000):
        if not len(loose):
            break
        best, which = deficit(loose)
        keep = best > -0.3
        if not keep.any():
            break
        loose, best, which = loose[keep], best[keep], which[keep]
        k = int(np.argmax(best))
        j = which[k]
        # grow the sphere nearest the worst point until the point is 0.4 m inside
        out[j][1] = min(float(np.linalg.norm(loose[k] - centres[j])) + 0.4, R_LIMIT - float(np.linalg.norm(centres[j])))
        if np.linalg.norm(loose[k] - centres[j]) - out[j][1] > -0.3:
            loose = np.delete(loose, k, axis=0)          # beyond the radius limit: leave it
    growth = max(r - r0 for (_, r), r0 in zip(out, before))
    out = [(Vector(c), round(r + 0.05, 1)) for c, r in out]
    C.log(f'  colliders: {len(out)} spheres, none more than {tau + growth:.0f} m outside the plating; '
          f'{len(dense)} dense samples, {grown} spheres grown (at most {growth:.1f} m) over slivers between samples')
    return out


def grid_samples(objs, spacing):
    """Points on every triangle of `objs` in a barycentric grid about
    `spacing` metres apart (deterministic, unlike surface_samples)."""
    out = []
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        co = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) @ np.array(o.matrix_world.to_3x3()).T + np.array(tuple(o.matrix_world.translation))
        tris = np.empty(len(me.loop_triangles) * 3, np.int64)
        me.loop_triangles.foreach_get('vertices', tris)
        for a, b, c in co[tris.reshape(-1, 3)]:
            k = max(1, int(math.ceil(max(np.linalg.norm(b - a), np.linalg.norm(c - a), np.linalg.norm(c - b)) / spacing)))
            i, j = np.meshgrid(np.arange(k + 1), np.arange(k + 1), indexing='ij')
            keep = i + j <= k
            u, v = i[keep] / k, j[keep] / k
            out.append(a + np.outer(u, b - a) + np.outer(v, c - a))
    return np.concatenate(out)


def exit_distance(colliders, origin, directions, step=0.5):
    """How far rays from `origin` run before leaving the union of spheres."""
    cs = np.array([tuple(p) for p, _ in colliders])
    rs = np.array([r for _, r in colliders])
    best = 0.0
    for d in directions:
        t = 0.0
        while True:
            q = np.array(tuple(origin + d * t))
            if not (np.linalg.norm(cs - q, axis=1) <= rs).any():
                break
            t += step
        best = max(best, t)
    return best


def fibonacci(n):
    out = []
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        a = i * math.pi * (3 - math.sqrt(5))
        out.append(Vector((r * math.cos(a), r * math.sin(a), z)))
    return out


# ==========================================================================
# Assembly, bake, export

def build_mother():
    M = mother_materials()
    F = factor_materials()
    rng = random.Random(1907)
    A, B, empties, lights = [], [], [], []
    hull = build_hull(M)
    A += hull
    build_prow(M, A, B)
    build_engines(M, A, B, empties)
    core_bvh = S.bvh_of(hull + [o for o in A if o.name.startswith('housing')])
    build_cage(M, B)
    lights += build_frames(M, B, core_bvh)
    build_arms(M, B)
    build_bays(M, B, core_bvh, empties)
    domes = build_domes(M, B, core_bvh, empties, lights)
    turrets = build_turrets(F, M, B, core_bvh)
    avoid = [(Vector((x, y, 0)), 34.0) for x, y in DOMES]
    avoid += [(t.matrix_world.translation, 19.0) for t in turrets if not t.name.endswith('_gun')]
    Gm, G = greeble_set(F), []
    scatter(Gm, core_bvh, rng, avoid + frame_avoid(core_bvh), G)
    pipes_and_strips(M, core_bvh, B)
    build_spine_details(M, Gm, core_bvh, B, G, lights)
    lights += [('mandible', Vector((sgn * (MANDIBLE_TIP[0] + 1.0), MANDIBLE_TIP[1] - 3.0, MANDIBLE_TIP[2])))
               for sgn in (-1, 1)]
    lights += [('engine', Vector((sgn * (ENG_X + 0.924 * (ENG_R - 2) + 0.6), -358.0, ENG_Z))) for sgn in (-1, 1)]
    lights.append(('tail', Vector((0.0, -384.8, 2.0))))
    lights.append(('brow', BROW_TIP + Vector((0, 0.6, 0.0))))
    pods = MP.Batch('pods')
    for kind, p in lights:
        MP.octa(pods(Gm['redglow']), p, 1.4 if kind in ('crown', 'tine', 'dome', 'mast') else 1.8)
    G.extend(pods.objects())
    reactor = build_reactor(F)
    eye = build_eye(F)
    return dict(A=A, B=B, G=G, domes=domes, turrets=turrets, reactor=reactor, eye=eye, empties=empties, lights=lights,
                proxies=hull + [o for o in A if o.name.startswith(('housing', 'mandible', 'brow'))])


def frame_avoid(bvh):
    """Keep greebles off the frames and out of the bays and the chamber."""
    out = []
    for y, _ in FRAMES_FORE + FRAMES_AFT:
        for x in np.linspace(-34, 34, 7):
            loc, _ = MP.cast(bvh, (x, y, 300), (0, 0, -1))
            if loc is not None:
                out.append((loc, 9.0))
    for sgn in (1, -1):
        for y in np.linspace(140, 236, 9):
            out.append((Vector((sgn * 34, y, -42)), 26.0))
    for y in PITS:
        top = station(FORE if y > 0 else AFT, y)[1]
        for x in (-10.0, 0.0, 10.0):
            for dy in (-8.0, 0.0, 8.0):
                out.append((Vector((x, y + dy, top)), 9.0))
    for y in (-200.0, -262.0, -300.0):
        out.append((Vector((0, y, -46.0)), 30.0))
    for x, y, hw, hl in MAWS:
        for dy in np.linspace(-hl, hl, 5):
            out.append((Vector((x, y + dy, -46.0)), hw + 9.0))
    return out


def collision_proxies(parts):
    """Closed stand-ins for the collider fit: the hull lofts, the prow, the
    engine housings and bells, plus solids that close the reactor cage and
    wrap the shield domes (fighters must not slip into either)."""
    keep = [o for o in parts['proxies']]
    extra = [MP.loft('proxy_cage', [hull_ring(y, *WAIST, 2.0) for y in (-Y_BULK - 2, Y_BULK + 2)], None, sharp=20.0)]
    for dome, centre in parts['domes']:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=24.0)
        bmesh.ops.translate(bm, verts=bm.verts, vec=centre + Vector((0, 0, 2.0)))
        extra.append(MP.solid('proxy_dome', bm, None))
    for c, sgn in enumerate((-1, 1)):
        for dx, dz in NOZ_OFFSETS:
            extra.append(S.lathe('proxy_bell', [(-360, 0), (-360, 18.6), (-378, 21.6), (Y_EXIT, NOZ_R + 1.0), (Y_EXIT, 0)],
                                 12, (sgn * ENG_X + sgn * dx, ENG_Z + dz), None))
    extra.append(S.lathe('proxy_beam', [(296, 0), (296, 12.5), (366, 12.5), (389, 0)], 12, (0, BEAM_Z), None))
    return keep + extra, extra


def bake_set(ob, tag, sizes):
    """Bake one texture set from the source materials on `ob`: ambient
    occlusion first, with every part of the ship in place (one noise-free
    pass the paint then reads as an image instead of each channel bake
    tracing its own), then, with the rest of the ship hidden, normals,
    albedo, roughness and metallic together, and emission."""
    size, n_size, mr_size, glow_size = (256, 256, 128, 256) if FAST else sizes
    base = C.new_image(f'mother_{tag}_base', size)
    nrm = C.new_image(f'mother_{tag}_normal', n_size, non_color=True)
    rm = C.new_image(f'mother_{tag}_rm', mr_size, non_color=True)
    glow = C.new_image(f'mother_{tag}_emissive', glow_size)
    ao = C.new_image(f'mother_{tag}_ao', size // 2, non_color=True)
    margin = max(2, size // 256)
    mats = sorted({s_.material for s_ in ob.material_slots if s_.material}, key=lambda m: m.name)
    # AO needs no paint: bake it through a plain material so Cycles does
    # not evaluate the procedural graph on every sample
    slots = [s_.material for s_ in ob.material_slots]
    plain = C.flat_material(f'{tag}_ao_bake', (0.5, 0.5, 0.5), 0.5, 0.0)
    for s_ in ob.material_slots:
        s_.material = plain
    C.bake(ob, ao, 'AO', margin=margin // 2 + 1, samples=1 if FAST else 16)
    for s_, m in zip(ob.material_slots, slots):
        s_.material = m
    bpy.data.materials.remove(plain)
    phase(f'{tag}: ao')
    for mat in mats:
        nt = mat.node_tree
        for n in [n for n in nt.nodes if n.bl_idname == 'ShaderNodeAmbientOcclusion']:
            uv = nt.nodes.new('ShaderNodeUVMap')
            uv.uv_map = ob.data.uv_layers.active.name
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = ao
            tex.interpolation = 'Cubic'
            nt.links.new(uv.outputs[0], tex.inputs['Vector'])
            for link in list(n.outputs['AO'].links):
                nt.links.new(tex.outputs['Color'], link.to_socket)
            nt.nodes.remove(n)
        # roughness and metallic in one bake: R and G of one image
        ch = C.CHANNELS.setdefault(mat.name, {})
        comb = nt.nodes.new('ShaderNodeCombineColor')
        for i, key in ((0, 'rough'), (1, 'metal')):
            v = C._channel_value(ch, key)
            if isinstance(v, bpy.types.NodeSocket):
                nt.links.new(v, comb.inputs[i])
            else:
                comb.inputs[i].default_value = float(v)
        ch['rm'] = comb.outputs[0]
    hidden = [o for o in bpy.context.scene.objects if o is not ob and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    C.bake(ob, nrm, 'NORMAL', margin=max(2, margin * n_size // size), samples=1 if FAST else 4)
    phase(f'{tag}: normal')
    s_ = 1 if FAST else 4
    C.bake(ob, base, channel='albedo', margin=margin, samples=s_)
    phase(f'{tag}: albedo')
    C.bake(ob, rm, channel='rm', margin=max(1, margin * mr_size // size), samples=s_)
    C.bake(ob, glow, channel='glow', margin=max(1, margin * glow_size // size), samples=s_)
    phase(f'{tag}: rough+metal, glow')
    for o in hidden:
        o.hide_render = False
    mr = C.new_image(f'mother_{tag}_mr', mr_size, non_color=True)
    px = C.pixels(rm)
    out = np.ones_like(px)
    out[..., 1] = px[..., 0]                     # glTF: G = roughness, B = metallic
    out[..., 2] = px[..., 1]
    C.set_pixels(mr, out)
    dump = os.environ.get('METEORA_DUMP')
    if dump:
        for img in (base, nrm, mr, glow, ao):
            copy = bpy.data.images.new(img.name + '_dump', img.size[0], img.size[1], alpha=False)
            copy.colorspace_settings.name = img.colorspace_settings.name
            C.set_pixels(copy, C.pixels(img))
            copy.filepath_raw = os.path.join(dump, img.name + '.png')
            copy.file_format = 'PNG'
            copy.save()
            bpy.data.images.remove(copy)
    return C.baked_material(f'mother_{tag}', base, nrm, mr, glow)


def unwrap(ob, angle, margin, shrink):
    """Smart-project UVs, then scale down the islands of faces whose paint
    is (nearly) one flat colour before packing, so the atlas spends its
    texels on plating, not on glowing discs."""
    C.activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.6,
                             correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    me = ob.data
    names = [s_.material.name if s_.material else '' for s_ in ob.material_slots]
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f1, f2 = e.link_faces
        uv1 = {l.vert: l[uv].uv.copy() for l in f1.loops if l.vert in e.verts}
        uv2 = {l.vert: l[uv].uv.copy() for l in f2.loops if l.vert in e.verts}
        if all((uv1[v] - uv2[v]).length < 1e-6 for v in e.verts):
            parent[root(f1.index)] = root(f2.index)
    islands = {}
    for f in bm.faces:
        islands.setdefault(root(f.index), []).append(f)
    for faces in islands.values():
        ks = [shrink.get(names[f.material_index]) if f.material_index < len(names) else None for f in faces]
        if not all(ks):
            continue
        k = min(ks)
        loops = [l for f in faces for l in f.loops]
        c = sum((l[uv].uv for l in loops), Vector((0, 0))) / len(loops)
        for l in loops:
            l[uv].uv = c + (l[uv].uv - c) * k
    bm.to_mesh(me)
    bm.free()
    C.activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method='CONCAVE', margin_method='FRACTION',
                            margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def split_faces(ob, mat_name):
    """Move the faces painted with `mat_name` out of `ob` into a new mesh."""
    idx = next(i for i, s in enumerate(ob.material_slots) if s.material and s.material.name == mat_name)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    part = bm.copy()
    bmesh.ops.delete(part, geom=[f for f in part.faces if f.material_index != idx], context='FACES')
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == idx], context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    me = bpy.data.meshes.new(mat_name + '_split')
    part.to_mesh(me)
    part.free()
    return me


def dome_nodes(me, domes, mat):
    """Split the dome shells (one mesh) into `shield_0` and `shield_1`,
    each with its origin at the dome's base centre."""
    out = []
    for k, (_, centre) in enumerate(domes):
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (f.calc_center_median().x < 0) != (centre.x < 0)],
                         context='FACES')
        bmesh.ops.translate(bm, verts=bm.verts, vec=-centre)
        nm = bpy.data.meshes.new(f'shield_{k}')
        bm.to_mesh(nm)
        bm.free()
        nm.materials.clear()
        own = mat.copy()                   # same images, its own material: the game can darken one dome
        own.name = f'mother_shield_{k}'
        nm.materials.append(own)
        for p in nm.polygons:
            p.material_index = 0
        ob = C.link(bpy.data.objects.new(f'shield_{k}', nm))
        ob.location = centre
        out.append(ob)
    bpy.data.meshes.remove(me)
    return out


def use_material(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    ob.data.polygons.foreach_set('material_index', [0] * len(ob.data.polygons))


def place_empties(parts, colliders):
    """Colliders, subsystems, lights and the beam muzzle as empties."""
    empties = list(parts['empties'])
    for i, (p, r) in enumerate(sorted(colliders, key=lambda c: (-round(c[0].y), round(c[0].x), round(c[0].z)))):
        e = sub_empty(f'col_{i:02d}', p, r)
        empties.append(e)
    # the reactor and the generators must be hittable on the spheres that
    # cover the cage and the domes: the game counts a hit within r + 6 m
    flat = [d for d in fibonacci(400) if abs(d.y) < 0.35]
    r_core = exit_distance(colliders, REACTOR, flat) - 5.0
    empties.append(sub_empty('sub_reactor', REACTOR, round(max(R_CORE + 6.0, r_core), 1)))
    up = [d for d in fibonacci(300) if d.z > 0.6]
    for e in empties:
        if e.name.startswith('sub_shield_'):
            r = exit_distance(colliders, e.location, up) - 5.0
            e.scale = (round(max(e.scale.x, r), 1),) * 3
    empties.append(sub_empty('sub_beam', (0.0, 374.0, BEAM_Z), 26.0))
    for c, sgn in enumerate((-1, 1)):
        empties.append(sub_empty(f'sub_engine_{c}', (sgn * ENG_X, -372.0, ENG_Z), 62.0))
    empties.append(S.empty('muzzle_beam', (0.0, 389.5, BEAM_Z)))
    lights = []
    for i, (kind, p) in enumerate(parts['lights']):
        e = S.empty(f'light_{i:02d}', p)
        lights.append((e, kind))
        empties.append(e)
    return empties, lights


LIGHT_BLINK = {'crown': 2.4, 'tine': 0.0, 'dome': 0.0, 'mast': 1.2, 'mandible': 1.6, 'engine': 0.0, 'tail': 1.0,
               'brow': 0.0}


def main(only=None):
    if only and 'mother' not in only:
        return
    C.reset(samples=8)
    world = bpy.data.worlds.new('bake')
    world.light_settings.distance = 26.0         # the AO bake's reach (m)
    bpy.context.scene.world = world
    C.log('ship', 'mother')
    phase('start')
    parts = build_mother()
    phase('geometry')
    for k in ('A', 'B', 'G'):
        C.log(f'  set {k}: {len(parts[k])} objects, {sum(len(o.data.vertices) for o in parts[k])} verts')
    if SKETCH:
        if os.environ.get('METEORA_SKETCH_COLLIDERS'):
            proxies, extra = collision_proxies(parts)
            spheres = fit_colliders(proxies)
            for o in extra:
                bpy.data.objects.remove(o)
            mat = bpy.data.materials.new('collider_shell')
            nt = mat.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            out = nt.nodes.new('ShaderNodeOutputMaterial')
            mix = nt.nodes.new('ShaderNodeMixShader')
            mix.inputs[0].default_value = 0.22
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (0.1, 0.6, 1.0, 1)
            em.inputs['Strength'].default_value = 0.6
            nt.links.new(nt.nodes.new('ShaderNodeBsdfTransparent').outputs[0], mix.inputs[1])
            nt.links.new(em.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs['Surface'])
            for i, (c, r) in enumerate(spheres):
                bm = bmesh.new()
                MP.uv_sphere(bm, c, r, segments=24, rings=12)
                MP.solid(f'col_vis{i}', bm, mat, recalc=False)
        sketch(SKETCH)
        return
    proxies, extra = collision_proxies(parts)
    colliders = fit_colliders(proxies)
    phase('colliders')
    for o in extra:
        bpy.data.objects.remove(o)
    empties, lights = place_empties(parts, colliders)

    hull_a = C.join(parts['A'], 'hull')
    hull_b = C.join(parts['B'] + [d for d, _ in parts['domes']], 'hull_detail')
    for ob in (hull_a, hull_b):
        unwrap(ob, angle=50.0, margin=0.0025, shrink={'m_throat': 0.08, 'm_throat_core': 0.08, 'm_redglow': 0.15, 'm_nozzle_in': 0.5,
                                                      'm_socket': 0.6})
        C.triangulate(ob)
    phase('join and unwrap')
    mat_a = bake_set(hull_a, 'hull', (2048, 2048, 512, 2048))
    mat_b = bake_set(hull_b, 'detail', (2048, 1024, 512, 2048))
    dome_me = split_faces(hull_b, 'm_dome')
    domes = dome_nodes(dome_me, parts['domes'], mat_b)
    use_material(hull_a, mat_a)
    use_material(hull_b, mat_b)
    hull = C.join([hull_a, hull_b], 'hull')
    greebles = C.join(parts['G'], 'greebles')
    while greebles.data.uv_layers:
        greebles.data.uv_layers.remove(greebles.data.uv_layers[0])
    C.triangulate(greebles)
    nodes = [greebles] + domes + [parts['reactor'], parts['eye']] + parts['turrets']
    for o in nodes + empties:
        if o.parent is None:
            o.parent = hull
    tris = C.tri_count(hull) + sum(C.tri_count(o) for o in nodes)
    C.log(f'  mother: {tris} tris ({C.tri_count(hull)} hull)')
    path = os.path.join(C.MODELS, 'mother.glb')
    phase('assemble')
    if os.environ.get('METEORA_CHECK'):
        check_geometry([hull] + [o for o in nodes if o.type == 'MESH'])
        phase('check')
    C.export_glb(path, [hull] + nodes + empties)
    phase('export')
    write_anchors(anchors(hull, nodes, empties, lights))


def check_geometry(objects):
    """METEORA_CHECK=1: rays from all round the ship must hit front faces
    (a back face means an inverted normal or a hole), and every loose part
    must touch or cut into another part (nothing floats)."""
    bm = bmesh.new()
    owner = []                                  # face -> (object name, loose part)
    for o in objects:
        me = o.data.copy()
        me.transform(o.matrix_world)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        bpy.data.meshes.remove(me)
        bmesh.ops.triangulate(tmp, faces=tmp.faces)
        part = {}
        tmp.verts.ensure_lookup_table()
        seen = 0
        for v in tmp.verts:
            if v.index in part:
                continue
            stack = [v]
            part[v.index] = seen
            while stack:
                w = stack.pop()
                for e in w.link_edges:
                    u = e.other_vert(w)
                    if u.index not in part:
                        part[u.index] = seen
                        stack.append(u)
            seen += 1
        offset = len(bm.verts)
        for v in tmp.verts:
            bm.verts.new(v.co)
        bm.verts.ensure_lookup_table()
        for f in tmp.faces:
            bm.faces.new([bm.verts[offset + v.index] for v in f.verts])
            owner.append((o.name, part[f.verts[0].index]))
        tmp.free()
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    rng = random.Random(3)
    back, total, where = 0, 0, {}
    for d in fibonacci(4000):
        target = Vector((rng.uniform(-110, 110), rng.uniform(-400, 410), rng.uniform(-60, 120)))
        origin = target - d * 900
        loc, nrm, idx, dist = tree.ray_cast(origin, d)
        if loc is None:
            continue
        total += 1
        if bm.faces[idx].normal.dot(d) > 0:
            back += 1
            key = owner[idx][0]
            where[key] = where.get(key, 0) + 1
    C.log(f'  check: {back} of {total} outside rays hit a back face {dict(sorted(where.items())[:12])}')
    # loose parts that neither cut into nor touch anything else
    groups = {}
    for i, key in enumerate(owner):
        groups.setdefault(key, []).append(i)
    floating = []
    for key, faces in groups.items():
        sub = bmesh.new()
        for i in faces:
            sub.faces.new([sub.verts.new(v.co) for v in bm.faces[i].verts])
        t = BVHTree.FromBMesh(sub)
        sub.free()
        touching = any(owner[j] != key for _, j in t.overlap(tree))
        if not touching:
            # coplanar contact does not count as overlap: accept a vertex on another surface
            for i in faces[:50]:
                for v in bm.faces[i].verts:
                    for co, nrm, j, dist in tree.find_nearest_range(v.co, 0.05):
                        if owner[j] != key:
                            touching = True
                            break
                    if touching:
                        break
                if touching:
                    break
        if not touching:
            c = sum((bm.faces[i].calc_center_median() for i in faces), Vector()) / len(faces)
            vs = [v.co for i in faces for v in bm.faces[i].verts]
            size = tuple(round(max(v[k] for v in vs) - min(v[k] for v in vs), 1) for k in range(3))
            floating.append((key[0], tuple(round(x) for x in c), size, len(faces)))
    C.log(f'  check: {len(groups)} loose parts, {len(floating)} not touching anything: {floating[:20]}')
    bm.free()


def anchors(hull, nodes, empties, lights):
    """Everything js/anchors/mother.js needs, in glTF space."""
    radius, ymin, ymax = 0.0, 1e9, -1e9
    for o in [hull] + nodes:
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            radius = max(radius, p.length)
            ymin, ymax = min(ymin, p.y), max(ymax, p.y)
    by = lambda prefix: sorted((e for e in empties if e.name.startswith(prefix)), key=lambda e: e.name)
    pos = lambda o: [round(v, 2) + 0.0 for v in C.to_gltf(o.matrix_world.translation)]
    axis = lambda o, local: [round(v, 4) + 0.0 for v in C.to_gltf((o.matrix_world.to_3x3() @ Vector(local)).normalized())]
    scale = lambda o: round(o.matrix_world.to_scale().x, 1)
    subs = []
    for e in by('sub_'):
        kind = e.name[4:].rsplit('_', 1)[0] if e.name[-1].isdigit() else e.name[4:]
        subs.append(dict(name=e.name, kind=kind, pos=pos(e), r=scale(e)))
    cols = by('col_')
    reach = max((e.matrix_world.translation.length + scale(e) for e in cols), default=0.0)
    turrets = sorted((o for o in nodes if o.name.startswith('turret_') and not o.name.endswith('_gun')),
                     key=lambda o: o.name)
    return dict(
        radius=round(max(radius, reach), 1), length=round(ymax - ymin, 1),
        nozzles=[dict(name=e.name, pos=pos(e), dir=axis(e, (0, -1, 0)), size=NOZ_R) for e in by('nozzle_')],
        muzzles=[dict(name=e.name, pos=pos(e)) for e in by('muzzle_')],
        colliders=[dict(pos=pos(e), r=scale(e)) for e in cols],
        subsystems=subs,
        turrets=[dict(name=t.name, pos=pos(t), up=axis(t, (0, 0, 1)), fwd=axis(t, (0, 1, 0)), size=TURRET_SIZE)
                 for t in turrets],
        bays=[dict(name=e.name, pos=pos(e), dir=axis(e, (0, -1, 0))) for e in by('bay_')],
        lights=[dict(name=e.name, pos=pos(e), color=list(HARROW_RED), blink=LIGHT_BLINK[kind]) for e, kind in lights],
        nodes=dict(reactor='reactor', eye='eye', shield_0='shield_0', shield_1='shield_1'),
    )


def write_anchors(a):
    f = lambda v: '[' + ', '.join(f'{x:g}' for x in v) + ']'
    lines = [
        '/* Meteora — mother anchors. GENERATED by tools/blender/build_mother.py from',
        '   the empties in mother.glb; do not edit by hand. glTF space, metres: nose',
        '   along -Z, top +Y, right +X. */',
        '/* Nozzle dir = exhaust (the empty\'s Blender local -Y), size = exit radius;',
        '   nozzle_0..2 are the port cluster (sub_engine_0), nozzle_3..5 starboard.',
        '   muzzle_beam is the beam emitter tip; sub_beam sits in the emitter head',
        '   (the beam starts there). Collider and subsystem r come from the empties\'',
        '   uniform scale; sub_reactor and sub_shield_* reach the collision spheres',
        '   over the cage and domes so hits on them count. Turret size: pivot to',
        '   trunnion = 0.6 size, trunnion to muzzle = 0.8 size. Bay dir = launch',
        '   (the empty\'s Blender local -Y). Lights: Harrow red sprites, blink',
        '   period in s (0 = steady). nodes: the reactor core, the eye (looks along',
        '   its local -Z, the ship\'s nose, at rest) and the shield domes, each with',
        '   its own material over the detail textures so one can go dark alone. */',
        'export default {',
        f"  radius: {a['radius']:g},",
        f"  length: {a['length']:g},",
        '  nozzles: [',
    ]
    lines += [f"    {{ name: '{n['name']}', pos: {f(n['pos'])}, dir: {f(n['dir'])}, size: {n['size']:g} }},"
              for n in a['nozzles']]
    lines += ['  ],', '  muzzles: [']
    lines += [f"    {{ name: '{n['name']}', pos: {f(n['pos'])} }}," for n in a['muzzles']]
    lines += ['  ],', '  rcs: [],', '  launchers: [],', '  cockpit: null,', '  dock: null,', '  colliders: [']
    lines += [f"    {{ pos: {f(c['pos'])}, r: {c['r']:g} }}," for c in a['colliders']]
    lines += ['  ],', '  subsystems: [']
    lines += [f"    {{ name: '{s_['name']}', kind: '{s_['kind']}', pos: {f(s_['pos'])}, r: {s_['r']:g} }},"
              for s_ in a['subsystems']]
    lines += ['  ],', '  turrets: [']
    lines += [f"    {{ name: '{t['name']}', pos: {f(t['pos'])}, up: {f(t['up'])}, fwd: {f(t['fwd'])}, size: {t['size']:g} }},"
              for t in a['turrets']]
    lines += ['  ],', '  bays: [']
    lines += [f"    {{ name: '{b['name']}', pos: {f(b['pos'])}, dir: {f(b['dir'])} }}," for b in a['bays']]
    lines += ['  ],', '  lights: [']
    lines += [f"    {{ name: '{l['name']}', pos: {f(l['pos'])}, color: {f(l['color'])}, blink: {l['blink']:g} }},"
              for l in a['lights']]
    lines += ['  ],', '  nodes: { ' + ', '.join(f"{k}: '{v}'" for k, v in a['nodes'].items()) + ' },', '};']
    path = os.path.join(C.JS, 'anchors', 'mother.js')
    with open(path, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    C.log('wrote', os.path.relpath(path, C.ROOT))



def sketch(out):
    """Render the unbaked model from a few angles (geometry iterations)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import render_previews as RP
    os.makedirs(out, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = int(os.environ.get('METEORA_PREVIEW_SAMPLES', '12'))
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = int(os.environ.get('METEORA_SKETCH_SIZE', '640'))
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    world = bpy.data.worlds.new('space')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.012, 0.013, 0.016, 1)
    for name, energy, colour in (('sun', 4.0, (1, 1, 1)), ('fill', 0.5, (0.6, 0.7, 1.0))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.data.color = colour
        light.data.angle = math.radians(0.6)
        scene.collection.objects.link(light)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 70
    cam.data.clip_start = 1.0
    scene.collection.objects.link(cam)
    scene.camera = cam
    meshes = [o for o in scene.objects if o.type == 'MESH']
    centre, radius = RP.bounds(meshes)
    views = dict(RP.VIEWS, three_quarter=(1.0, 0.85, 0.5))
    which = os.environ.get('METEORA_SKETCH_VIEWS', 'three_quarter,side,top,front,rear,below').split(',')
    for view in which:
        if view not in views:
            continue
        RP.shoot(scene, cam, centre, radius, views[view], os.path.join(out, f'sketch_{view}.png'))
    ext = radius / 0.86 * 0.5
    closes = {'close_prow': ((0, 0.62, 0.0), (0.9, 1.0, 0.55), 0.3), 'close_cage': ((0, 0.0, 0.0), (1.0, 0.25, 0.45), 0.3),
              'close_aft': ((0, -0.62, 0.0), (-0.7, -1.0, 0.5), 0.34), 'close_belly': ((0, 0.4, -0.1), (0.6, 0.5, -0.8), 0.32)}
    custom = os.environ.get('METEORA_SKETCH_CUSTOM')      # "x,y,z;dx,dy,dz;radius;name" (Blender metres)
    if custom:
        for spec in custom.split('|'):
            at, d, r, name = spec.split(';')
            closes[name] = (None, tuple(float(v) for v in d.split(',')), float(r), Vector([float(v) for v in at.split(',')]))
            which.append(name)
    for view in which:
        if view in closes:
            off, d, f, *at = closes[view]
            if at:
                RP.shoot(scene, cam, at[0], f, d, os.path.join(out, f'sketch_{view}.png'))
            else:
                RP.shoot(scene, cam, centre + Vector(off) * ext * 2, radius * f, d, os.path.join(out, f'sketch_{view}.png'))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
