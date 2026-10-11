"""Alpen mountain hut — the Berghütte the cocoa stop is, built in Blender.

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/hut.py -- --out fun/alpen/assets/models/huts

Run from the repository root; writes `mountain-hut.glb`, one node (`hut`).
`--preview DIR` also renders a three-quarter and a front view with Cycles on
the CPU (no GPU needed, so it runs in a sandbox), and `--debug` adds a
render with every back face painted magenta, which is how a winding mistake
— a face the game's single-sided material would not draw at all — is found.

WHAT IT IS. A hut of the kind that stands above every Austrian and Swiss
piste: a rubble-stone storey dug into the slope, a log storey on it in
Blockbau — squared logs laid crosswise, their ends standing out past every
corner — and a shallow gable roof on purlins, carrying half a metre of snow
that rolls over its eaves into a cornice with icicles under it. The gable
faces the rider and the hill: boarded, with an attic window and the purlin
heads and their struts under a deep overhang; under that, the parlour's two
windows with green shutters, window boxes full of snow, the door with its
transom and the yellow sign over it, a bench along the wall, and the
terrace on stilts with a table, a balustrade of sawn boards and the lantern.
Round the side, the third lit window and the woodpile; behind, a shuttered
window and the cellar's barred openings in the stone.

THE CONTRACTS. The model is drawn where `js/huts.js` and `js/config.js`
already say a hut is, and the numbers below that carry a contract are copied
from there and must move with them: y = 0 is the highest ground corner the
hut is planted at, the front faces −z, the terrace deck's top is
`TERRACE_DECK`, the stone goes `PLINTH_DEPTH` under y = 0, the chimney's top
is `CHIMNEY` (the smoke's origin), and the window openings are exactly the
glass `HUT_LIGHT` lists — the panes, the lantern and the light they throw
are drawn in the game from that table, so a window modelled anywhere else
glows on a log wall. Those numbers also travel on the node as extras, and
`tests/models-check.mjs` holds the two files to each other.

HOW IT IS BUILT. Not with the riders' lofts: a building is boards, logs and
stones, so the kit here is boxes, straight extrusions, polygons (with holes,
for the sawn balustrade) and a few lofted sheets for the snow. Everything is
written in the game's coordinates and turned into Blender's as it is
realised (`riders.B`). Every face carries a material named by its ROLE
(`log`, `masonry`, `snow`, `shutter`…) and a UV the game's hut material
reads by role: wood takes its plank photograph along the grain — a log is
mapped onto exactly one plank of `alpine-wood-planks.jpg` so its seams
never cross the log — stone takes its slate photograph and a coursed rubble
pattern in metres, the woodpile's face a field of sawn log ends. Colour is
not baked: the look table in `huts.js` paints each role. What is baked is
`_SHADE`, per vertex: each piece's own tone (no two logs are quite the same
brown) times ambient occlusion, worked out here by casting rays through the
finished building.
"""

import bmesh
import bpy
import math
import os
import random
import sys
from itertools import product
from mathutils import Matrix, Vector, geometry
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import riders  # noqa: E402
from riders import B, collection, clear_collection, tris  # noqa: E402

TAU = math.tau

# ---------------------------------------------------------------------------
# The contracts — copied from js/huts.js and js/config.js (HUT_LIGHT)
# ---------------------------------------------------------------------------

DECK = 0.55                  # TERRACE_DECK: the terrace boards' top
PLINTH_DEPTH = 4.595         # PLINTH_DEPTH: the stone's foot under y = 0
GLASS_FRONT = -2.25          # HUT_LIGHT.front: the plane of the front glass
GLASS_SIDE = 2.65            # HUT_LIGHT.side: and of the side window's
BAR = 0.045                  # HUT_LIGHT.bar: the glazing bars' width
# HUT_LIGHT.glass: centre (u, y), size (u, y), glazing bars; u is x on the
# front and z on the side
PANES_FRONT = [
    ((-0.05, 1.75), (0.70, 0.84), True),
    ((1.70, 1.75), (0.70, 0.84), True),
    ((-1.70, 2.36), (0.70, 0.28), False),    # the transom over the door
]
PANES_SIDE = [((0.30, 1.75), (0.70, 0.84), True)]
LANTERN = (2.3, 1.55, -4.35)  # HUT_LIGHT.lantern: a 0.22 × 0.30 × 0.22 glow
CHIMNEY_XZ = (0.85, 0.90)     # CHIMNEY.x / .z; its y is the stack's top here

# ---------------------------------------------------------------------------
# The building's own frame
# ---------------------------------------------------------------------------

WX, WZ = 2.75, 2.35          # the log walls' outer faces
PX, PZ = 2.87, 2.47          # the stone storey's, a ledge of twelve cm wider
STONE_TOP = 0.44             # top of the rubble, under its coping
FLOOR = DECK                 # coping top, foot of the logs, the parlour floor
COURSES = 12                 # logs up the front wall
WALL_TOP = 3.40              # top of the front and back walls' logs
LOG_H = (WALL_TOP - FLOOR) / COURSES
SIDE_TOP = WALL_TOP + LOG_H / 2   # the side walls sit half a log higher
LOG_T = 0.14                 # a log's thickness through the wall
CH = 0.022                   # the adze chamfer on its two outer arrises
LOG_OUT = 0.22               # how far the crossing ends stand past a corner
PLATE_TOP = SIDE_TOP + 0.22  # top of the wall plates the rafters sit on
PITCH = math.radians(30)
SLOPE = math.tan(PITCH)
COS = math.cos(PITCH)
EAVE_X = 3.75                # the eaves, a metre past the walls
ROOF_Z0, ROOF_Z1 = -3.685, 3.185  # roof boards, between the verge boards
RAFTER_V = 0.16 / COS        # a rafter's depth, measured plumb
ROOF_V = (0.16 + 0.035) / COS     # rafter and boarding, plumb
SNOW_D = 0.40                # the snow load, square to the roof
PURLIN_Z = (-3.82, 3.32)     # the purlin heads stand past the verge boards


def under(x):
    """The rafters' underside at x."""
    return PLATE_TOP + (WX - abs(x)) * SLOPE


def roof_top(x):
    return under(x) + ROOF_V


RIDGE_UNDER = under(0.0)

# The wood photograph's planks, in pixels from the top of the 1024² image,
# inset off the seams: a log is mapped onto exactly one of these.
PLANK_BANDS = [(10, 110), (130, 255), (275, 390), (410, 498), (518, 622),
               (642, 762), (782, 918), (938, 1014)]

rnd = random.Random(1907)


# ---------------------------------------------------------------------------
# Texture coordinates. A UV here is what three.js samples: u along the
# image, v measured DOWN from its top edge (the exporter flips v, and
# three's loader flips the image, and the two cancel).
# ---------------------------------------------------------------------------

def dom(n):
    a = (abs(n.x), abs(n.y), abs(n.z))
    return a.index(max(a))


def tex_grain(axis=0, su=0.4, sv=0.6, ou=None, ov=None):
    """Boards and beams: the plank photograph with its grain along `axis`
    of the piece's own frame. The planks in the photograph are about a
    third of a metre at 0.4 a metre, so `sv` 0.6 makes a board of twenty
    centimetres between two of its seams."""
    ou = rnd.random() if ou is None else ou
    ov = rnd.random() if ov is None else ov

    def f(p, n):
        a = dom(n)
        if a == axis:
            b, c = [i for i in range(3) if i != axis]
            return (p[b] * su + ou, p[c] * sv + ov)
        other = 3 - a - axis
        return (p[axis] * su + ou, p[other] * sv + ov)
    return f


def tex_rot(angle, su=0.4, sv=0.6, ou=None, ov=None):
    """Boards laid at an angle in the x–y plane: the door's herringbone."""
    ou = rnd.random() if ou is None else ou
    ov = rnd.random() if ov is None else ov
    c, s = math.cos(angle), math.sin(angle)

    def f(p, n):
        return ((p.x * c + p.y * s) * su + ou, (-p.x * s + p.y * c) * sv + ov)
    return f


def tex_log(y0, y1, w0, w1):
    """One log onto one plank: u along the log, v across its face mapped
    onto a single band of the photograph, so the photograph's seams — dark,
    with frost in them — never cut across a log."""
    band = rnd.choice(PLANK_BANDS)
    v0, v1 = band[0] / 1024, band[1] / 1024
    ou = rnd.random()

    def f(p, n):
        if abs(n.y) > 0.9:
            t = (p.z - w0) / (w1 - w0)
        else:
            t = (p.y - y0) / (y1 - y0)
        return (p.x * 0.4 + ou, v0 + (v1 - v0) * min(1.0, max(0.0, t)))
    return f


def tex_metres(p, n):
    """Stone: planar, in metres, for the rubble pattern and the slate."""
    a = dom(n)
    if a == 1:
        return (p.x, p.z)
    if a == 0:
        return (p.z, p.y)
    return (p.x, p.y)


def tex_rings(cb, cc, axis=0):
    """End grain: metres from the member's own axis, for the rings."""
    b, c = [i for i in range(3) if i != axis]

    def f(p, n):
        return (p[b] - cb, p[c] - cc)
    return f


def tex_none(p, n):
    return (0.0, 0.0)


# ---------------------------------------------------------------------------
# The kit
# ---------------------------------------------------------------------------

def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n.normalized() if n.length > 1e-12 else Vector((0, 1, 0))


BOX_FACES = {
    'x-': [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
    'x+': [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    'y-': [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    'y+': [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
    'z-': [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
    'z+': [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
}

# Roles whose faces are lit as one smooth surface: snow is never creased
SMOOTH = {'snow', 'drift', 'ice'}


class Piece:
    """Vertices, faces, a role and a UV per face corner, and a tone.

    Built in whatever frame suits the piece — a log in its wall's, a rafter
    along its own length — with the UVs worked out there, and then carried
    into the hut's frame by `xf`, which turns the faces round if the
    transform mirrors them."""

    def __init__(self, tone=1.0):
        self.v, self.f, self.uv, self.r = [], [], [], []
        self.tone = tone

    def vert(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, role, tex, out=None):
        pts = [self.v[i] for i in idx]
        n = newell(pts)
        if out is not None and n.dot(Vector(out)) < 0:
            idx = list(reversed(idx))
            pts = list(reversed(pts))
            n = -n
        self.f.append(tuple(idx))
        self.r.append(role)
        self.uv.append([tuple(tex(p, n)) for p in pts])

    def poly(self, pts, role, tex, out=None):
        self.face([self.vert(p) for p in pts], role, tex, out)

    def box(self, lo, hi, role, tex, skip=(), roles=None):
        idx = {}
        for bits in product((0, 1), repeat=3):
            idx[bits] = self.vert([hi[i] if bits[i] else lo[i] for i in range(3)])
        for name, corners in BOX_FACES.items():
            if name in skip:
                continue
            self.face([idx[c] for c in corners], (roles or {}).get(name, role), tex)
        return idx

    def sheet(self, rows, role, tex, up):
        """A grid of shared vertices — the snow — facing along `up(p)`.

        The hint is asked once, of the cell that agrees with it most
        strongly, and every other cell is wound the same way: a cornice
        curls under itself, and a per-cell hint would turn its underside
        inside out."""
        ids = [[self.vert(p) for p in row] for row in rows]
        cells = []
        best, sign = 0.0, 1.0
        for i in range(len(rows) - 1):
            for j in range(len(rows[i]) - 1):
                q = [ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]]
                pts = [self.v[k] for k in q]
                d = newell(pts).dot(Vector(up(sum(pts, Vector()) / 4)).normalized())
                if abs(d) > best:
                    best, sign = abs(d), (1.0 if d > 0 else -1.0)
                cells.append(q)
        for q in cells:
            self.face(q if sign > 0 else list(reversed(q)), role, tex)
        return ids

    def slab(self, outline, holes, z0, z1, role, tex, rim=True, hole_walls=False):
        """A board with holes in it, `outline` and `holes` in the x–y plane
        and its two faces at z0 and z1: the sawn balustrade, the heart in a
        shutter."""
        loops = [[Vector((x, y, 0)) for (x, y) in outline]] + \
                [[Vector((x, y, 0)) for (x, y) in h] for h in holes]
        flat = [p for loop in loops for p in loop]
        tris_ = geometry.tessellate_polygon(loops)
        front = [self.vert((p.x, p.y, z1)) for p in flat]
        back = [self.vert((p.x, p.y, z0)) for p in flat]
        for t in tris_:
            self.face([front[i] for i in t], role, tex, out=(0, 0, 1))
            if z1 > z0:
                self.face([back[i] for i in t], role, tex, out=(0, 0, -1))
        if z1 <= z0:
            return
        k = 0
        for li, loop in enumerate(loops):
            if li > 0 and not hole_walls:
                k += len(loop)
                continue
            n = len(loop)
            ctr = sum(loop, Vector()) / n
            for i in range(n):
                a, b = k + i, k + (i + 1) % n
                mid = (flat[a] + flat[b]) / 2
                # outward for the rim, into the hole for a hole's wall
                o = (mid - ctr) if li == 0 else (ctr - mid)
                if rim or li > 0:
                    self.face([back[a], back[b], front[b], front[a]], role, tex,
                              out=(o.x, o.y, 0))
            k += n

    def xf(self, m):
        self.v = [m @ p for p in self.v]
        if m.to_3x3().determinant() < 0:
            self.f = [tuple(reversed(f)) for f in self.f]
            self.uv = [list(reversed(u)) for u in self.uv]
        return self


PIECES = []


def put(pc, m=None):
    if m is not None:
        pc.xf(m)
    PIECES.append(pc)
    return pc


def frame(origin, xdir, ydir):
    """A frame at `origin` whose +x runs along `xdir`, +y as near `ydir` as
    it can be."""
    x = Vector(xdir).normalized()
    y = Vector(ydir)
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    return Matrix(((x.x, y.x, z.x, origin[0]), (x.y, y.y, z.y, origin[1]),
                   (x.z, y.z, z.z, origin[2]), (0, 0, 0, 1)))


def member(p0, p1, w, h, role, up=(0, 1, 0), tone=None, skip=('x-', 'x+')):
    """A squared timber from p0 to p1: a strut, a leg, a pole."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    pc = Piece(tone if tone is not None else rnd.uniform(0.9, 1.08))
    pc.box((0, -h / 2, -w / 2), (L, h / 2, w / 2), role, tex_grain(0), skip=skip)
    return put(pc, frame(p0, p1 - p0, up))


def strip(path, section, role, tex, up=(0, 1, 0), ends=True, tone=1.0):
    """A section carried along a horizontal path — the snow on a rail or a
    sill: `section` is (across, up) pairs, left to right over the top."""
    pc = Piece(tone)
    rows = []
    for i, p in enumerate(path):
        p = Vector(p)
        a = Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])
        a.y = 0
        a.normalize()
        side = a.cross(Vector((0, 1, 0)))
        rows.append([p + side * s + Vector((0, 1, 0)) * h for (s, h) in section])
    pc.sheet(rows, role, tex, up=lambda c: Vector(up))
    if ends:
        for row, sgn in ((rows[0], -1), (rows[-1], 1)):
            a = (Vector(path[-1]) - Vector(path[0])).normalized() * sgn
            pc.poly(row, role, tex, out=a)
    return pc


def snow_strip(x0, x1, z, y, depth, h, axis='x', role='snow'):
    """Snow along a narrow ledge: a sill, a drip cap, a sign's top."""
    if axis == 'x':
        path = [(x0, y, z), (x1, y, z)]
    else:
        path = [(z, y, x0), (z, y, x1)]
    return strip(path, [(-depth / 2 - 0.006, -0.004), (-depth * 0.28, h * 0.8), (0, h),
                        (depth * 0.28, h * 0.8), (depth / 2 + 0.006, -0.004)],
                 role, tex_none)


def pillow(x0, x1, z0, z1, y, h, role='snow', over=0.01):
    """A snow load on a flat top — a bench, a chimney cap, a woodpile."""
    pc = Piece()
    r0 = [(x0 - over, y - 0.004, z0 - over), (x1 + over, y - 0.004, z0 - over),
          (x1 + over, y - 0.004, z1 + over), (x0 - over, y - 0.004, z1 + over)]
    m = min(x1 - x0, z1 - z0)
    i1 = min(h * 0.35, m * 0.18)
    i2 = min(h * 0.9, m * 0.42)
    r1 = [(x0 - over + i1 * 0.3, y + h * 0.65, z0 - over + i1 * 0.3),
          (x1 + over - i1 * 0.3, y + h * 0.65, z0 - over + i1 * 0.3),
          (x1 + over - i1 * 0.3, y + h * 0.65, z1 + over - i1 * 0.3),
          (x0 - over + i1 * 0.3, y + h * 0.65, z1 + over - i1 * 0.3)]
    r2 = [(x0 + i2, y + h, z0 + i2), (x1 - i2, y + h, z0 + i2),
          (x1 - i2, y + h, z1 - i2), (x0 + i2, y + h, z1 - i2)]
    ids = [[pc.vert(p) for p in r] for r in (r0, r1, r2)]
    ctr = Vector(((x0 + x1) / 2, y, (z0 + z1) / 2))
    for a, b in ((0, 1), (1, 2)):
        for j in range(4):
            q = [ids[a][j], ids[a][(j + 1) % 4], ids[b][(j + 1) % 4], ids[b][j]]
            c = sum((pc.v[k] for k in q), Vector()) / 4
            pc.face(q, role, tex_none, out=c - ctr)
    pc.face(ids[2], role, tex_none, out=(0, 1, 0))
    return pc


# ---------------------------------------------------------------------------
# The walls' own frames: local x runs along the wall, y is up, +z is out
# ---------------------------------------------------------------------------

WALLS = {
    'front': Matrix(((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, -1, -WZ), (0, 0, 0, 1))),
    'back': Matrix(((-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, WZ), (0, 0, 0, 1))),
    'right': Matrix(((0, 0, 1, WX), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1))),
    'left': Matrix(((0, 0, -1, -WX), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1))),
}
HALF = {'front': WX, 'back': WX, 'right': WZ, 'left': WZ}
# Which end of a side wall's logs is under the front gable: the side walls'
# top logs step out there as corbels under the eave plates
FRONT_END = {'right': 1, 'left': -1}


def wall_u(side, x, z):
    """A point's position along a wall."""
    return {'front': x, 'back': -x, 'right': -z, 'left': z}[side]


# ---------------------------------------------------------------------------
# The stone storey
# ---------------------------------------------------------------------------

def plinth():
    """Rubble masonry from the snow to the logs, battered six centimetres a
    side over its depth, as every dry-laid wall on a slope is. The pattern
    of the courses is the hut material's, from these UVs in metres."""
    pc = Piece()
    y0, y1 = -PLINTH_DEPTH, STONE_TOP
    bat = 0.06
    lo = [(-PX - bat, y0, -PZ - bat), (PX + bat, y0, -PZ - bat), (PX + bat, y0, PZ + bat), (-PX - bat, y0, PZ + bat)]
    hi = [(-PX, y1, -PZ), (PX, y1, -PZ), (PX, y1, PZ), (-PX, y1, PZ)]
    for i in range(4):
        j = (i + 1) % 4
        q = [lo[i], lo[j], hi[j], hi[i]]
        c = sum((Vector(p) for p in q), Vector()) / 4
        pc.poly(q, 'masonry', tex_metres, out=(c.x, 0, c.z))
    put(pc)

    # The coping: dressed slabs on the rubble, their outer edge drip-cut and
    # standing four centimetres proud. The front and back ones run through
    # the corners and the side ones stop against them, so no two slabs lie
    # in the same place; in front, under the terrace boards, it is lower.
    for side in ('front', 'back', 'right', 'left'):
        across = side in ('front', 'back')
        half = HALF[side] + 0.16 if across else HALF[side] - 0.05
        top = DECK - 0.06 if side == 'front' else DECK
        ow = PZ - WZ + 0.04 if across else PX - WX + 0.04
        sec = [(-0.05, top - 0.005), (ow - 0.015, top), (ow, top - 0.012), (ow, STONE_TOP),
               (ow - 0.04, STONE_TOP), (-0.05, STONE_TOP)]
        pc = Piece(rnd.uniform(0.9, 1.1))
        cw = sum(w for w, _ in sec) / len(sec)
        cy = sum(y for _, y in sec) / len(sec)
        for (wa, ya), (wb, yb) in zip(sec[:4], sec[1:5]):
            mid = ((wa + wb) / 2 - cw, (ya + yb) / 2 - cy)
            pc.poly([(-half, ya, wa), (half, ya, wa), (half, yb, wb), (-half, yb, wb)], 'slate', tex_metres,
                    out=(0, mid[1], mid[0]))
        for u, s in ((-half, -1), (half, 1)):
            pc.poly([(u, y, w) for (w, y) in sec], 'slate', tex_metres, out=(s, 0, 0))
        put(pc, WALLS[side])

    # Quoins: dressed blocks at the corners, long and short in turn, a
    # couple of centimetres proud of the rubble
    for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        y = STONE_TOP - 0.012
        for k in range(8):
            hgt = rnd.uniform(0.30, 0.38)
            yb = y - hgt
            f = (STONE_TOP - (yb + y) / 2) / (STONE_TOP + PLINTH_DEPTH)
            ox, oz = PX + bat * f + 0.022, PZ + bat * f + 0.022
            lx, lz = (0.46, 0.26) if k % 2 == 0 else (0.26, 0.46)
            lx += rnd.uniform(-0.04, 0.04)
            lz += rnd.uniform(-0.04, 0.04)
            pc = Piece(rnd.uniform(0.86, 1.12))
            x0, x1 = sorted((sx * ox, sx * (ox - lx)))
            z0, z1 = sorted((sz * oz, sz * (oz - lz)))
            pc.box((x0, yb, z0), (x1, y, z1), 'quoin', tex_metres)
            put(pc)
            y = yb - 0.014

    # The cellar's openings: a slab lintel, a sill stone, the dark behind
    # and three bars. On the downhill sides only — the front is dug in.
    for side, u, y in (('back', -1.25, -0.80), ('back', 1.05, -0.80), ('back', -0.10, -2.45),
                       ('right', -0.90, -0.80), ('left', -1.50, -0.80)):
        # the wall's face at this height, batter and all
        out = (PZ - WZ if side in ('front', 'back') else PX - WX) \
            + bat * (STONE_TOP - y) / (STONE_TOP + PLINTH_DEPTH)
        hw, hh = 0.23, 0.18
        pc = Piece()
        pc.poly([(u - hw, y - hh, out + 0.004), (u + hw, y - hh, out + 0.004),
                 (u + hw, y + hh, out + 0.004), (u - hw, y + hh, out + 0.004)], 'interior', tex_none, out=(0, 0, 1))
        for bx in (-0.11, 0.0, 0.11):
            pc.poly([(u + bx - 0.011, y - hh, out + 0.03), (u + bx + 0.011, y - hh, out + 0.03),
                     (u + bx + 0.011, y + hh, out + 0.03), (u + bx - 0.011, y + hh, out + 0.03)], 'iron', tex_none, out=(0, 0, 1))
        put(pc, WALLS[side])
        pc = Piece(rnd.uniform(0.9, 1.1))
        pc.box((u - hw - 0.13, y + hh, out - 0.02), (u + hw + 0.13, y + hh + 0.14, out + 0.05), 'slate', tex_metres,
               skip=('z-',))
        pc.box((u - hw - 0.07, y - hh - 0.07, out - 0.02), (u + hw + 0.07, y - hh, out + 0.06), 'slate', tex_metres,
               skip=('z-',))
        put(pc, WALLS[side])
        put(snow_strip(u - hw - 0.06, u + hw + 0.06, out + 0.035, y - hh, 0.07, 0.035), WALLS[side])


# ---------------------------------------------------------------------------
# The log storey
# ---------------------------------------------------------------------------

def openings(side):
    """The holes the logs stop at, as (u0, u1, y0, y1) in the wall's frame.
    Only lit openings cut the wall: a shuttered window is drawn over logs."""
    sash = 0.04
    out = []
    if side == 'front':
        for (cu, cy), (w, h), _ in PANES_FRONT[:2]:
            out.append((cu - w / 2 - sash, cu + w / 2 + sash, cy - h / 2 - sash, cy + h / 2 + sash))
        out.append(DOOR_OPENING)
    if side == 'right':
        for (cz, cy), (w, h), _ in PANES_SIDE:
            cu = wall_u('right', 0, cz)
            out.append((cu - w / 2 - sash, cu + w / 2 + sash, cy - h / 2 - sash, cy + h / 2 + sash))
    return out


DOOR_X = PANES_FRONT[2][0][0]
DOOR_W = 0.88
DOOR_HEAD = 2.14                 # top of the leaf; the transom is over it
DOOR_OPENING = (DOOR_X - DOOR_W / 2, DOOR_X + DOOR_W / 2, FLOOR, 2.54)


def log_courses(side):
    if side in ('front', 'back'):
        return [(FLOOR + k * LOG_H, FLOOR + (k + 1) * LOG_H, k) for k in range(COURSES)]
    out = [(FLOOR, FLOOR + LOG_H / 2, -1)]
    out += [(FLOOR + (k + 0.5) * LOG_H, FLOOR + (k + 1.5) * LOG_H, k) for k in range(COURSES)]
    return out


def log_extents(side, k, end):
    """How far a log's end stands past the corner: (at its foot, at its
    top). The side walls' top three logs step out under the front and back
    overhangs as corbels, the foot of each cut back on the slant."""
    e = LOG_OUT + rnd.uniform(-0.016, 0.016)
    if side in FRONT_END and k >= COURSES - 3:
        step = COURSES - 1 - k            # 0 for the top log
        if end == FRONT_END[side]:
            extra = (0.78, 0.44, 0.18)[step]
        else:
            extra = (0.42, 0.24, 0.10)[step]
        return (e + extra - 0.10, e + extra)
    return (e, e)


def walls():
    for side, m in WALLS.items():
        W = HALF[side]
        holes = openings(side)
        cs = log_courses(side)
        ext = {}
        for (y0, y1, k) in cs:
            for end in (-1, 1):
                ext[(k, end)] = log_extents(side, k, end)
        ks = [k for (_, _, k) in cs]
        for ci, (y0, y1, k) in enumerate(cs):
            o = rnd.uniform(-0.004, 0.007)
            tone = rnd.uniform(0.82, 1.10)
            # weathering: the lowest logs take the splash and darken
            if ci < 2:
                tone *= 0.88
            pc = Piece(tone)
            tex = tex_log(y0, y1, o - LOG_T, o)
            el, er = ext[(k, -1)], ext[(k, 1)]
            # the wall between the two corners, less what the openings take
            spans = [(-(W + el[0]), -(W + el[1]), W + er[0], W + er[1])]
            for (u0, u1, oy0, oy1) in sorted(holes):
                if oy1 <= y0 + 0.001 or oy0 >= y1 - 0.001:
                    continue
                nxt = []
                for (a0, a1, b0, b1) in spans:
                    if u1 <= min(a0, a1) or u0 >= max(b0, b1):
                        nxt.append((a0, a1, b0, b1))
                        continue
                    nxt.append((a0, a1, u0, u0))
                    nxt.append((u1, u1, b0, b1))
                spans = nxt
            # Each log stands a few millimetres in or out of its neighbours,
            # but the V between two of them always closes at the same depth:
            # with each chamfer's root at its own log's depth, two logs of
            # different set left a slit along the groove into the wall.
            g = -CH
            prof = [(g, y0), (o, y0 + CH), (o, y1 - CH), (g, y1)]

            def at(a_lo, a_hi, y):
                return a_lo + (a_hi - a_lo) * (y - y0) / (y1 - y0)
            for (a0, a1, b0, b1) in spans:
                for (wa, ya), (wb, yb) in zip(prof, prof[1:]):
                    pc.poly([(at(a0, a1, ya), ya, wa), (at(b0, b1, ya), ya, wa),
                             (at(b0, b1, yb), yb, wb), (at(a0, a1, yb), yb, wb)],
                            'log', tex, out=(0, (ya + yb) / 2 - (y0 + y1) / 2, 1))
                # the top course is open above under the gable's sawn teeth
                # and the wall plates: closed with the log's own top face
                if k == COURSES - 1:
                    pc.poly([(a1, y1, g), (b1, y1, g), (b1, y1, o - LOG_T), (a1, y1, o - LOG_T)], 'log', tex,
                            out=(0, 1, 0))
            # the crossing ends, past each corner: end grain, the back face
            # beyond the other wall, and the top or foot where they show
            idx = ks.index(k)
            for end in (-1, 1):
                e_lo, e_hi = ext[(k, end)]
                u_lo, u_hi = end * (W + e_lo), end * (W + e_hi)
                end_pts = [(u_lo, y0, g), (at(u_lo, u_hi, y0 + CH), y0 + CH, o),
                           (at(u_lo, u_hi, y1 - CH), y1 - CH, o), (u_hi, y1, g),
                           (u_hi, y1, o - LOG_T), (u_lo, y0, o - LOG_T)]
                pc.poly(end_pts, 'endgrain', tex_rings((y0 + y1) / 2, o - LOG_T / 2, axis=0),
                        out=(end, 0, 0))
                pc.poly([(end * W, y0, o - LOG_T), (u_lo, y0, o - LOG_T), (u_hi, y1, o - LOG_T), (end * W, y1, o - LOG_T)],
                        'log', tex, out=(0, 0, -1))
                above = ext.get((ks[idx + 1], end)) if idx + 1 < len(ks) else None
                below = ext.get((ks[idx - 1], end)) if idx > 0 else None
                if above is None or e_hi > above[0] + 0.002:
                    pc.poly([(end * W, y1, g), (u_hi, y1, g), (u_hi, y1, o - LOG_T), (end * W, y1, o - LOG_T)],
                            'log', tex, out=(0, 1, 0))
                if below is None or e_lo > below[1] + 0.002:
                    pc.poly([(end * W, y0, g), (u_lo, y0, g), (u_lo, y0, o - LOG_T), (end * W, y0, o - LOG_T)],
                            'log', tex, out=(0, -1, 0))
            put(pc, m)

    # The wall plates: the top logs of the side walls run on to the ends of
    # the overhangs and carry the rafters there
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (WX - 0.18), sx * (WX + 0.02)))
        purlin([(x0, SIDE_TOP), (x1, SIDE_TOP), (x1, PLATE_TOP), (x0, PLATE_TOP)], cut=0.14)


def purlin(section, z0=PURLIN_Z[0], z1=PURLIN_Z[1], cut=0.12, role='beam'):
    """A purlin: `section` (x, y) extruded along z, each head cut back at
    the foot — the plainest of the profiles they are carved to."""
    pc = Piece(rnd.uniform(0.88, 1.05))
    tex = tex_grain(2)
    ys = [y for (_, y) in section]
    ylo, yhi = min(ys), max(ys)

    def zcut(y, z, sgn):
        return z + sgn * cut * (yhi - y) / (yhi - ylo)
    front = [Vector((x, y, zcut(y, z0, 1))) for (x, y) in section]
    back = [Vector((x, y, zcut(y, z1, -1))) for (x, y) in section]
    n = len(section)
    cx = sum(p.x for p in front) / n
    cy = sum(p.y for p in front) / n
    for i in range(n):
        j = (i + 1) % n
        mid = (front[i] + front[j]) / 2
        pc.poly([front[i], front[j], back[j], back[i]], role, tex, out=(mid.x - cx, mid.y - cy, 0))
    pc.poly(front, 'endgrain', tex_rings(cx, cy, axis=2), out=(0, -0.3, -1))
    pc.poly(back, 'endgrain', tex_rings(cx, cy, axis=2), out=(0, -0.3, 1))
    return put(pc)


# ---------------------------------------------------------------------------
# Windows, the door and the sign
# ---------------------------------------------------------------------------

def trims(pc, cu, cy, hu, hv, deep=-0.012):
    """The casing round an opening: two jambs, a head with a drip cap over
    it and a sloping sill with an apron under it — and snow on both."""
    tex = tex_grain(1)
    pc.box((cu - hu - 0.09, cy - hv, deep), (cu - hu, cy + hv, 0.03), 'beam', tex,
           skip=('x+', 'z-', 'y-', 'y+'))
    pc.box((cu + hu, cy - hv, deep), (cu + hu + 0.09, cy + hv, 0.03), 'beam', tex,
           skip=('x-', 'z-', 'y-', 'y+'))
    tex = tex_grain(0)
    pc.box((cu - hu - 0.12, cy + hv, deep), (cu + hu + 0.12, cy + hv + 0.11, 0.04), 'beam', tex, skip=('z-', 'y+'))
    pc.box((cu - hu - 0.15, cy + hv + 0.11, deep), (cu + hu + 0.15, cy + hv + 0.14, 0.075), 'beam', tex, skip=('z-',))
    idx = pc.box((cu - hu - 0.13, cy - hv - 0.06, deep), (cu + hu + 0.13, cy - hv, 0.095), 'timber', tex, skip=('z-',))
    for bits in ((0, 1, 1), (1, 1, 1)):     # the sill's top falls outward
        pc.v[idx[bits]].y -= 0.018
    pc.box((cu - hu - 0.09, cy - hv - 0.16, deep), (cu + hu + 0.09, cy - hv - 0.06, 0.03), 'beam', tex,
           skip=('z-', 'y+'))
    return [(cu - hu - 0.15, cu + hu + 0.15, 0.075 / 2 + 0.002, cy + hv + 0.14, 0.085, 0.05),
            (cu - hu - 0.12, cu + hu + 0.12, 0.05, cy - hv - 0.01, 0.10, 0.045)]


def glass_plane(side):
    """`HUT_LIGHT`'s glass plane in a wall's own frame: out from the logs'
    face is +, so the glass, ten centimetres in, is negative."""
    return (-GLASS_FRONT - WZ) if side == 'front' else (GLASS_SIDE - WX)


def lit_window(side, cu, cy, w, h, bars, box=True):
    """A window the room's lamp shines out of, its glass exactly the
    pane `HUT_LIGHT` lists: the opening is the glass and its sash, the
    glazing bars are in front of the glass where the light's own test puts
    them, the reveal runs back past the glass into a dark room with its
    curtains tied back, and the shutters are open flat against the logs."""
    m = WALLS[side]
    glass_w = glass_plane(side)
    gw, gh = w / 2, h / 2
    hu, hv = gw + 0.04, gh + 0.04
    pc = Piece(rnd.uniform(0.92, 1.06))
    face = glass_w + 0.05                     # the pane's own front face
    # the sash, round the glass and outside it
    ring_o = [(cu - hu, cy - hv), (cu + hu, cy - hv), (cu + hu, cy + hv), (cu - hu, cy + hv)]
    ring_i = [(cu - gw, cy - gh), (cu + gw, cy - gh), (cu + gw, cy + gh), (cu - gw, cy + gh)]
    for i in range(4):
        j = (i + 1) % 4
        pc.poly([(ring_o[i][0], ring_o[i][1], face + 0.006), (ring_o[j][0], ring_o[j][1], face + 0.006),
                 (ring_i[j][0], ring_i[j][1], face + 0.006), (ring_i[i][0], ring_i[i][1], face + 0.006)],
                'frame', tex_grain(0 if i % 2 == 0 else 1), out=(0, 0, 1))
    if bars:
        pc.box((cu - BAR / 2, cy - gh, face + 0.002), (cu + BAR / 2, cy + gh, face + 0.028), 'frame',
               tex_grain(1), skip=('z-', 'y-', 'y+'))
        pc.box((cu - gw, cy - BAR / 2, face + 0.002), (cu + gw, cy + BAR / 2, face + 0.026), 'frame',
               tex_grain(0), skip=('z-', 'x-', 'x+'))
    # the reveal: casing wood in front of the glass, the room behind it
    back = glass_w - 0.36
    for (a, b, o) in (((cu - hu, cy - hv), (cu - hu, cy + hv), (1, 0, 0)),
                      ((cu + hu, cy + hv), (cu + hu, cy - hv), (-1, 0, 0)),
                      ((cu - hu, cy + hv), (cu + hu, cy + hv), (0, -1, 0)),
                      ((cu + hu, cy - hv), (cu - hu, cy - hv), (0, 1, 0))):
        pc.poly([(a[0], a[1], 0.03), (b[0], b[1], 0.03), (b[0], b[1], face), (a[0], a[1], face)],
                'frame', tex_grain(2), out=o)
        pc.poly([(a[0], a[1], face), (b[0], b[1], face), (b[0], b[1], back), (a[0], a[1], back)],
                'interior', tex_none, out=o)
    pc.poly([(cu - hu, cy - hv, back), (cu + hu, cy - hv, back), (cu + hu, cy + hv, back), (cu - hu, cy + hv, back)],
            'interior', tex_none, out=(0, 0, 1))
    # curtains, tied back to each side
    cw = back + 0.12
    for s in (-1, 1):
        e = cu + s * gw
        pc.poly([(e, cy + gh, cw), (e - s * 0.20, cy + gh, cw), (e - s * 0.07, cy - 0.06, cw),
                 (e - s * 0.13, cy - gh, cw), (e, cy - gh, cw)], 'curtain', tex_none, out=(0, 0, 1))
    snow = trims(pc, cu, cy, hu, hv)
    put(pc, m)
    # the shutters, open flat against the logs, battens and hinges outward
    for s in (-1, 1):
        sh = Piece(rnd.uniform(0.9, 1.08))
        u0 = cu + s * (hu + 0.10)
        u1 = cu + s * (hu + 0.10 + 0.38)
        a, b = sorted((u0, u1))
        y0, y1 = cy - hv - 0.03, cy + hv + 0.06
        sh.box((a, y0, 0.012), (b, y1, 0.046), 'shutter', tex_grain(1, ou=rnd.random()), skip=('z-',))
        for yb in (y0 + 0.13, y1 - 0.19):
            sh.box((a + 0.03, yb, 0.046), (b - 0.03, yb + 0.075, 0.064), 'shutter', tex_grain(0), skip=('z-', 'x-', 'x+'))
            hx0 = u0 + s * 0.005
            hx1 = u0 + s * 0.20
            ha, hb = sorted((hx0, hx1))
            sh.poly([(ha, yb + 0.02, 0.066), (hb, yb + 0.025, 0.066), (hb, yb + 0.05, 0.066), (ha, yb + 0.055, 0.066)],
                    'iron', tex_none, out=(0, 0, 1))
        put(sh, m)
    # a window box under it, full of snow
    if box:
        bx = Piece(rnd.uniform(0.9, 1.05))
        by0, by1 = cy - hv - 0.38, cy - hv - 0.19
        bx.box((cu - hu - 0.04, by0, 0.0), (cu + hu + 0.04, by1, 0.21), 'timber', tex_grain(0), skip=('z-', 'y+'))
        bx.box((cu - hu - 0.12, by0 - 0.06, -0.01), (cu - hu - 0.09, by0 + 0.08, 0.16), 'beam', tex_grain(1), skip=('z-',))
        bx.box((cu + hu + 0.09, by0 - 0.06, -0.01), (cu + hu + 0.12, by0 + 0.08, 0.16), 'beam', tex_grain(1), skip=('z-',))
        put(bx, m)
        put(pillow(cu - hu - 0.04, cu + hu + 0.04, 0.0, 0.21, by1 - 0.01, 0.10), m)
    for (a, b, z, y, d, hh) in snow:
        put(snow_strip(a, b, z, y, d, hh), m)


def closed_window(side, cu, cy, w, h):
    """A window with its shutters shut — the bedrooms nobody is in today —
    each leaf with the heart sawn through it."""
    m = WALLS[side]
    hu, hv = w / 2 + 0.04, h / 2 + 0.04
    pc = Piece(rnd.uniform(0.92, 1.06))
    snow = trims(pc, cu, cy, hu, hv)
    put(pc, m)
    for s in (-1, 1):
        sh = Piece(rnd.uniform(0.9, 1.08))
        a, b = sorted((cu, cu + s * hu))
        a += 0.004
        b -= 0.004
        sh.box((a, cy - hv, -0.01), (b, cy + hv, 0.032), 'shutter', tex_grain(1, ou=rnd.random()), skip=('z-',))
        hc = ((a + b) / 2, cy + hv * 0.45)
        put(sh, m)
        hp = Piece()
        hp.poly([(x, y, 0.0335) for (x, y) in heart(hc, 0.055)], 'interior', tex_none, out=(0, 0, 1))
        for yb in (cy - hv + 0.12, cy + hv - 0.16):
            hx0 = cu + s * hu - s * 0.005
            hx1 = cu + s * hu - s * 0.24
            ha, hb = sorted((hx0, hx1))
            hp.poly([(ha, yb, 0.034), (hb, yb + 0.005, 0.034), (hb, yb + 0.035, 0.034), (ha, yb + 0.04, 0.034)],
                    'iron', tex_none, out=(0, 0, 1))
        put(hp, m)
    for (a, b, z, y, d, hh) in snow:
        put(snow_strip(a, b, z, y, d, hh), m)


def heart(c, r):
    """A heart, point down, about 2r across."""
    pts = []
    for i in range(12):
        t = TAU * i / 12
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((c[0] + x / 16 * r, c[1] + y / 16 * r))
    return pts


def door():
    """The door: boards in a herringbone, set back in its frame, with the
    transom over it, strap hinges, a handle, a stone threshold — and the
    yellow sign over it, the same yellow as a kicker's lip, because it is
    the same promise."""
    m = WALLS['front']
    u0, u1, y0, top = DOOR_OPENING
    (tcu, tcy), (tw, th), _ = PANES_FRONT[2]
    glass_w = glass_plane('front')
    face = glass_w + 0.05
    leaf = -0.06
    pc = Piece(rnd.uniform(0.9, 1.05))
    sill = FLOOR + 0.07
    mid = (u0 + u1) / 2
    for (a, b, ang) in ((u0, mid, 0.785), (mid, u1, -0.785)):
        pc.poly([(a, sill, leaf), (b, sill, leaf), (b, DOOR_HEAD, leaf), (a, DOOR_HEAD, leaf)],
                'door', tex_rot(ang), out=(0, 0, 1))
    # the reveal, round the leaf and on up past the transom into the hall
    back = glass_w - 0.30
    for (a, b, o, z1) in (((u0, sill), (u0, top), (1, 0, 0), leaf), ((u1, top), (u1, sill), (-1, 0, 0), leaf),
                          ((u0, top), (u1, top), (0, -1, 0), leaf)):
        pc.poly([(a[0], a[1], 0.03), (b[0], b[1], 0.03), (b[0], b[1], z1), (a[0], a[1], z1)], 'frame', tex_grain(2),
                out=o)
    for (a, b, o) in (((u0, DOOR_HEAD), (u0, top), (1, 0, 0)), ((u1, top), (u1, DOOR_HEAD), (-1, 0, 0)),
                      ((u0, top), (u1, top), (0, -1, 0)), ((u1, DOOR_HEAD + 0.08), (u0, DOOR_HEAD + 0.08), (0, 1, 0))):
        pc.poly([(a[0], a[1], leaf), (b[0], b[1], leaf), (b[0], b[1], back), (a[0], a[1], back)], 'interior',
                tex_none, out=o)
    pc.poly([(u0, DOOR_HEAD, back), (u1, DOOR_HEAD, back), (u1, top, back), (u0, top, back)], 'interior', tex_none,
            out=(0, 0, 1))
    # the transom bar and the transom's sash round its glass
    pc.box((u0, DOOR_HEAD, glass_w - 0.02), (u1, DOOR_HEAD + 0.08, face + 0.03), 'frame', tex_grain(0),
           skip=('x-', 'x+', 'z-'))
    gw, gh = tw / 2, th / 2
    ro = [(u0, DOOR_HEAD + 0.08), (u1, DOOR_HEAD + 0.08), (u1, top), (u0, top)]
    ri = [(tcu - gw, tcy - gh), (tcu + gw, tcy - gh), (tcu + gw, tcy + gh), (tcu - gw, tcy + gh)]
    for i in range(4):
        j = (i + 1) % 4
        pc.poly([(ro[i][0], ro[i][1], face + 0.006), (ro[j][0], ro[j][1], face + 0.006),
                 (ri[j][0], ri[j][1], face + 0.006), (ri[i][0], ri[i][1], face + 0.006)], 'frame',
                tex_grain(0), out=(0, 0, 1))
    # casing
    tex = tex_grain(1)
    pc.box((u0 - 0.10, FLOOR, -0.012), (u0, top, 0.03), 'beam', tex, skip=('x+', 'z-', 'y-', 'y+'))
    pc.box((u1, FLOOR, -0.012), (u1 + 0.10, top, 0.03), 'beam', tex, skip=('x-', 'z-', 'y-', 'y+'))
    tex = tex_grain(0)
    pc.box((u0 - 0.14, top, -0.012), (u1 + 0.14, top + 0.12, 0.045), 'beam', tex, skip=('z-', 'y+'))
    pc.box((u0 - 0.17, top + 0.12, -0.012), (u1 + 0.17, top + 0.16, 0.085), 'beam', tex, skip=('z-',))
    put(pc, m)
    # hinges and the handle
    ir = Piece()
    for yb in (0.82, 1.86):
        ir.poly([(u1 - 0.46, yb, leaf + 0.004), (u1 - 0.02, yb - 0.006, leaf + 0.004),
                 (u1 - 0.02, yb + 0.052, leaf + 0.004), (u1 - 0.46, yb + 0.046, leaf + 0.004)], 'iron', tex_none,
                out=(0, 0, 1))
    ir.poly([(u0 + 0.07, 1.30, leaf + 0.004), (u0 + 0.13, 1.30, leaf + 0.004), (u0 + 0.13, 1.52, leaf + 0.004),
             (u0 + 0.07, 1.52, leaf + 0.004)], 'iron', tex_none, out=(0, 0, 1))
    ir.box((u0 + 0.075, 1.425, leaf + 0.004), (u0 + 0.22, 1.455, leaf + 0.06), 'iron', tex_none, skip=('z-',))
    put(ir, m)
    # threshold
    th_ = Piece(rnd.uniform(0.9, 1.1))
    th_.box((u0 - 0.06, FLOOR, -0.07), (u1 + 0.06, FLOOR + 0.07, 0.18), 'slate', tex_metres, skip=('y-', 'z-'))
    put(th_, m)
    put(snow_strip(u0 - 0.17, u1 + 0.17, 0.085 / 2, top + 0.16, 0.085, 0.05), m)

    # The sign, its letters raised on the board
    sy = 2.95
    sg = Piece()
    sg.box((DOOR_X - 0.64, sy - 0.17, 0.0), (DOOR_X + 0.64, sy + 0.17, 0.03), 'beam', tex_grain(0), skip=('z-',))
    sg.box((DOOR_X - 0.60, sy - 0.13, 0.03), (DOOR_X + 0.60, sy + 0.13, 0.045), 'sign', tex_none, skip=('z-',))
    # Seen from in front of the hut, +x is on the reader's LEFT (the front
    # faces −z), so the word is laid out mirrored about the door's centre
    for (a, b, c, d) in lettering('HÜTTE', DOOR_X, sy - 0.07, 0.125, 0.026):
        a, c = 2 * DOOR_X - c, 2 * DOOR_X - a
        sg.poly([(a, b, 0.0465), (c, b, 0.0465), (c, d, 0.0465), (a, d, 0.0465)], 'ink', tex_none, out=(0, 0, 1))
    put(sg, m)
    put(snow_strip(DOOR_X - 0.64, DOOR_X + 0.64, 0.015, sy + 0.17, 0.035, 0.035), m)


def lettering(text, cx, y0, h, s):
    """Block capitals as rectangles (x0, y0, x1, y1): enough of a typeface
    for one word on one sign."""
    w = h * 0.72
    gap = h * 0.36
    total = len(text) * w + (len(text) - 1) * gap
    x = cx - total / 2
    out = []
    for ch in text:
        L, R, top, mid = x, x + w, y0 + h, y0 + h / 2
        if ch == 'H':
            out += [(L, y0, L + s, top), (R - s, y0, R, top), (L + s, mid - s / 2, R - s, mid + s / 2)]
        elif ch == 'Ü':
            out += [(L, y0 + s, L + s, top), (R - s, y0 + s, R, top), (L, y0, R, y0 + s),
                    (L + w * 0.12, top + s * 0.5, L + w * 0.12 + s * 0.85, top + s * 1.35),
                    (R - w * 0.12 - s * 0.85, top + s * 0.5, R - w * 0.12, top + s * 1.35)]
        elif ch == 'T':
            out += [(L, top - s, R, top), ((L + R) / 2 - s / 2, y0, (L + R) / 2 + s / 2, top - s)]
        elif ch == 'E':
            out += [(L, y0, L + s, top), (L + s, top - s, R, top), (L + s, mid - s / 2, R - s * 0.4, mid + s / 2),
                    (L + s, y0, R, y0 + s)]
        x += w + gap
    return out


def windows():
    for (cu, cy), (w, h), bars in PANES_FRONT[:2]:
        lit_window('front', cu, cy, w, h, bars, box=False)
    for (cz, cy), (w, h), bars in PANES_SIDE:
        lit_window('right', wall_u('right', 0, cz), cy, w, h, bars)
    closed_window('back', wall_u('back', -0.6, 0), 1.80, 0.62, 0.78)
    closed_window('left', wall_u('left', 0, -1.45), 1.80, 0.56, 0.70)
    door()


# ---------------------------------------------------------------------------
# The gables and the roof
# ---------------------------------------------------------------------------

def gables():
    """Boards up the gables, their feet sawn to points over the top log, an
    attic window in the front one and a heart cut in the back one."""
    for side in ('front', 'back'):
        m = WALLS[side]
        pc = Piece(rnd.uniform(0.9, 1.05))
        teeth = 22
        pts = []
        for i in range(teeth + 1):
            u = WX - 2 * WX * i / teeth
            pts.append((u, WALL_TOP - 0.03))
            if i < teeth:
                pts.append((u - WX / teeth, WALL_TOP - 0.10))
        top = [(-WX, under(WX) + RAFTER_V), (0.0, RIDGE_UNDER + RAFTER_V), (WX, under(WX) + RAFTER_V)]
        outline = list(reversed(pts)) + list(reversed(top))
        # an x–y outline, counter-clockwise seen from +z
        if newell([Vector((x, y, 0)) for (x, y) in outline]).z < 0:
            outline.reverse()
        pc.slab(outline, [], 0.025, 0.025, 'timber', tex_grain(1, su=0.4, sv=0.85))
        # the boards stand clear of the top log; from below, the gap
        # between them is closed where the teeth begin
        pc.poly([(-WX, WALL_TOP - 0.03, -CH), (WX, WALL_TOP - 0.03, -CH), (WX, WALL_TOP - 0.03, 0.025),
                 (-WX, WALL_TOP - 0.03, 0.025)], 'timber', tex_grain(0), out=(0, -1, 0))
        put(pc, m)
    # the attic window
    m = WALLS['front']
    cu, cy, gw, gh = 0.0, 4.05, 0.22, 0.27
    hu, hv = gw + 0.035, gh + 0.035
    pc = Piece()
    pc.poly([(cu - hu, cy - hv, 0.03), (cu + hu, cy - hv, 0.03), (cu + hu, cy + hv, 0.03), (cu - hu, cy + hv, 0.03)],
            'frame', tex_grain(0), out=(0, 0, 1))
    pc.poly([(cu - gw, cy - gh, 0.034), (cu + gw, cy - gh, 0.034), (cu + gw, cy + gh, 0.034), (cu - gw, cy + gh, 0.034)],
            'glass', tex_none, out=(0, 0, 1))
    pc.box((cu - 0.018, cy - gh, 0.034), (cu + 0.018, cy + gh, 0.05), 'frame', tex_grain(1), skip=('z-', 'y-', 'y+'))
    pc.box((cu - gw, cy - 0.018, 0.034), (cu + gw, cy + 0.018, 0.05), 'frame', tex_grain(0), skip=('z-', 'x-', 'x+'))
    tex = tex_grain(1)
    pc.box((cu - hu - 0.07, cy - hv, 0.025), (cu - hu, cy + hv, 0.055), 'beam', tex, skip=('z-', 'y-', 'y+', 'x+'))
    pc.box((cu + hu, cy - hv, 0.025), (cu + hu + 0.07, cy + hv, 0.055), 'beam', tex, skip=('z-', 'y-', 'y+', 'x-'))
    tex = tex_grain(0)
    pc.box((cu - hu - 0.10, cy + hv, 0.025), (cu + hu + 0.10, cy + hv + 0.09, 0.07), 'beam', tex, skip=('z-',))
    pc.box((cu - hu - 0.10, cy - hv - 0.05, 0.025), (cu + hu + 0.10, cy - hv, 0.10), 'timber', tex, skip=('z-',))
    put(pc, m)
    for s in (-1, 1):
        sh = Piece(rnd.uniform(0.9, 1.08))
        a, b = sorted((cu + s * (hu + 0.08), cu + s * (hu + 0.08 + 0.24)))
        sh.box((a, cy - hv - 0.02, 0.03), (b, cy + hv + 0.03, 0.058), 'shutter', tex_grain(1), skip=('z-',))
        put(sh, m)
    put(snow_strip(cu - hu - 0.10, cu + hu + 0.10, 0.05, cy + hv + 0.09, 0.045, 0.04), m)
    put(snow_strip(cu - hu - 0.10, cu + hu + 0.10, 0.065, cy - hv, 0.075, 0.04), m)
    # the back gable's heart
    hp = Piece()
    hp.poly([(x, y, 0.027) for (x, y) in heart((0.0, 4.35), 0.11)], 'interior', tex_none, out=(0, 0, 1))
    put(hp, WALLS['back'])


def roof():
    """Rafters on purlins, boards on the rafters, verge boards along the
    rakes, struts under the long front overhang."""
    # purlins: the ridge, and one under each pitch midway down
    purlin([(-0.09, RIDGE_UNDER - 0.24), (0.09, RIDGE_UNDER - 0.24), (0.09, under(0.09)), (0.0, RIDGE_UNDER),
            (-0.09, under(0.09))])
    for sx in (-1, 1):
        xc = sx * 1.40
        x0, x1 = sorted((xc - 0.09, xc + 0.09))
        ya, yb = under(x0), under(x1)
        purlin([(x0, min(ya, yb) - 0.22), (x1, min(ya, yb) - 0.22), (x1, yb), (x0, ya)])
    # struts under the front heads
    gw = -WZ - 0.025
    for xc, bottom in ((0.0, RIDGE_UNDER - 0.24), (-1.40, under(1.49) - 0.22), (1.40, under(1.49) - 0.22)):
        foot = 0.50 if xc == 0.0 else 0.62
        member((xc, bottom - foot, gw + 0.02), (xc, bottom + 0.02, gw - 0.62), 0.11, 0.11, 'beam',
               up=(0, 1, -1), skip=())
    # rafters
    count = 9
    for sx in (-1, 1):
        for i in range(count):
            zc = -3.60 + i * (3.10 + 3.60) / (count - 1)
            pc = Piece(rnd.uniform(0.85, 1.05))
            pc.box((0.0, 0.0, -0.05), (EAVE_X, RAFTER_V, 0.05), 'beam', tex_grain(0), skip=('y+', 'x-'))
            put(pc, Matrix(((sx, 0, 0, 0), (-SLOPE, 1, 0, RIDGE_UNDER), (0, 0, 1, zc), (0, 0, 0, 1))))
        # the boards on them
        pc = Piece(rnd.uniform(0.9, 1.05))
        pc.box((0.0, RAFTER_V, ROOF_Z0), (EAVE_X + 0.01, ROOF_V, ROOF_Z1), 'timber',
               tex_grain(0, sv=0.85), skip=('x-',))
        put(pc, Matrix(((sx, 0, 0, 0), (-SLOPE, 1, 0, RIDGE_UNDER), (0, 0, 1, 0), (0, 0, 0, 1))))
        # verge boards, front and back, their tops flush with the boards
        for z0, z1 in ((ROOF_Z0 - 0.035, ROOF_Z0), (ROOF_Z1, ROOF_Z1 + 0.035)):
            pc = Piece(rnd.uniform(0.85, 1.0))
            pc.box((0.0, ROOF_V - 0.30 / COS, z0), (EAVE_X + 0.03, ROOF_V + 0.004, z1), 'beam', tex_grain(0),
                   skip=('x-',))
            put(pc, Matrix(((sx, 0, 0, 0), (-SLOPE, 1, 0, RIDGE_UNDER), (0, 0, 1, 0), (0, 0, 0, 1))))


def snow_load():
    """Half a metre of snow on the roof, as one sheet from eave to eave:
    thinner over the ridge where the wind takes it, thicker towards the
    eaves where it slides to, rolling over each eave into a cornice that
    hangs below the boards, and draped over the verge boards at the gable
    ends. The load undulates along the ridge, the way drifted snow does."""
    D = SNOW_D / COS
    field = [0.0, 0.55, 1.45, 2.4, 3.25]
    # the cornice, relative to the eave's top corner (EAVE_X, roof_top)
    corn = [(0.10, 0.92), (0.20, 0.55), (0.22, 0.08), (0.14, -0.30), (0.04, -0.42)]
    zs = [ROOF_Z0 - 0.05, ROOF_Z0 - 0.02]
    inner = 7
    zs += [ROOF_Z0 + 0.08 + (ROOF_Z1 - ROOF_Z0 - 0.16) * i / (inner - 1) for i in range(inner)]
    zs += [ROOF_Z1 + 0.02, ROOF_Z1 + 0.05]
    fs = [0.12, 0.62] + [1.0] * inner + [0.62, 0.12]
    phase = [rnd.uniform(0, TAU) for _ in range(4)]

    def depth(x, z):
        s = abs(x) / EAVE_X
        d = D * (0.82 + 0.22 * s)
        d *= 1 + 0.07 * math.sin(z * 1.7 + phase[0] + x * 0.4) + 0.05 * math.sin(z * 3.1 + phase[1])
        return d

    rows = []
    for z, f in zip(zs, fs):
        zz = z
        row = []
        for sx in (-1, 1):
            side = []
            for s in field:
                if s == 0.0 and sx == 1:
                    continue
                x = sx * s
                y = roof_top(x) + depth(x, zz) * f
                if s == 0.0:
                    y -= 0.06 * f
                side.append(Vector((x, y, zz)))
            k = 1 + 0.18 * math.sin(zz * 1.3 + phase[2] + sx)
            ye = roof_top(EAVE_X)
            d_e = depth(EAVE_X, zz)
            cpts = [Vector((sx * (EAVE_X + cx * k * f), ye + cy * d_e * f, zz)) for (cx, cy) in corn]
            # and tucks back under onto the eave's edge, so the curl is a
            # closed roll from below rather than an open lip
            cpts.append(Vector((sx * (EAVE_X + 0.035), ye - 0.06 * f, zz)))
            if sx == -1:
                side = list(reversed(cpts)) + list(reversed(side))
            else:
                side = side + cpts
            row += side
        # the last row at each gable end lies just over the verge board's
        # top edge, so the load drapes over it rather than stopping square
        if f < 0.2:
            for p in row:
                if abs(p.x) <= EAVE_X:
                    p.y = roof_top(p.x) - 0.03
        rows.append(row)
    pc = Piece()
    pc.sheet(rows, 'snow', tex_none, up=lambda c: Vector((c.x * 0.3, 1.0, 0)))
    put(pc)
    # icicles where the meltwater leaves the cornice
    for sx in (-1, 1):
        z = ROOF_Z0 + 0.35
        while z < ROOF_Z1 - 0.3:
            L = rnd.choice((0.12, 0.18, 0.26, 0.36, 0.48, 0.22))
            k = 1 + 0.18 * math.sin(z * 1.3 + phase[2] + sx)
            x = sx * (EAVE_X + 0.10 * k)
            y = roof_top(EAVE_X) - 0.30 * depth(EAVE_X, z) + 0.02
            icicle(Vector((x, y, z)), L, rnd.uniform(0.022, 0.034))
            z += rnd.uniform(0.35, 1.1)


def icicle(top, L, r):
    pc = Piece()
    n = 5
    a0 = rnd.uniform(0, TAU)
    lean = Vector((rnd.uniform(-0.02, 0.02), 0, rnd.uniform(-0.02, 0.02)))
    rings = [(0.0, r), (0.45, r * 0.55)]
    ids = []
    for t, rr in rings:
        c = top + Vector((0, -L * t, 0)) + lean * t
        ids.append([pc.vert(c + Vector((math.cos(a0 + TAU * i / n) * rr, 0, math.sin(a0 + TAU * i / n) * rr)))
                    for i in range(n)])
    tip = pc.vert(top + Vector((0, -L, 0)) + lean)
    for i in range(n):
        j = (i + 1) % n
        q = [ids[0][i], ids[0][j], ids[1][j], ids[1][i]]
        c = sum((pc.v[k] for k in q), Vector()) / 4
        pc.face(q, 'ice', tex_none, out=c - (top + Vector((0, -L * 0.2, 0))))
        t3 = [ids[1][i], ids[1][j], tip]
        c = sum((pc.v[k] for k in t3), Vector()) / 3
        pc.face(t3, 'ice', tex_none, out=c - (top + Vector((0, -L * 0.6, 0))))
    put(pc)


def chimney():
    """A rubble stack through the roof near the ridge, a slab on four stones
    for its cap and snow on that; the smoke leaves from just over it."""
    cx, cz = CHIMNEY_XZ
    h = 0.30
    top = 6.30
    pc = Piece()
    corners = [(cx - h, cz - h), (cx + h, cz - h), (cx + h, cz + h), (cx - h, cz + h)]
    for i in range(4):
        j = (i + 1) % 4
        a, b = corners[i], corners[j]
        pc.poly([(a[0], 4.55, a[1]), (b[0], 4.55, b[1]), (b[0], top, b[1]), (a[0], top, a[1])], 'masonry', tex_metres,
                out=((a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz))
    f = 0.12
    inner = [(cx - f, cz - f), (cx + f, cz - f), (cx + f, cz + f), (cx - f, cz + f)]
    for i in range(4):
        j = (i + 1) % 4
        pc.poly([(corners[i][0], top, corners[i][1]), (corners[j][0], top, corners[j][1]),
                 (inner[j][0], top, inner[j][1]), (inner[i][0], top, inner[i][1])], 'slate', tex_metres, out=(0, 1, 0))
    pc.poly([(p[0], top - 0.02, p[1]) for p in inner], 'soot', tex_none, out=(0, 1, 0))
    put(pc)
    for (a, b) in corners:
        st = Piece(rnd.uniform(0.85, 1.1))
        x0, x1 = sorted((a, a - math.copysign(0.13, a - cx)))
        z0, z1 = sorted((b, b - math.copysign(0.13, b - cz)))
        st.box((x0, top, z0), (x1, top + 0.11, z1), 'slate', tex_metres, skip=('y-', 'y+'))
        put(st)
    cap = Piece(rnd.uniform(0.9, 1.05))
    cap.box((cx - 0.42, top + 0.11, cz - 0.42), (cx + 0.42, top + 0.18, cz + 0.42), 'slate', tex_metres)
    put(cap)
    put(pillow(cx - 0.42, cx + 0.42, cz - 0.42, cz + 0.42, top + 0.18, 0.15))
    return top + 0.18 + 0.15 + 0.10


# ---------------------------------------------------------------------------
# The terrace
# ---------------------------------------------------------------------------

TERRACE_X = 2.72
TERRACE_Z = -4.42
RAIL_Z = -4.37


def terrace():
    """On stilts over ground falling away towards the piste, which is why
    it is the side you sit on: boards along the wall on joists and a beam,
    the balustrade sawn from boards with a figure in every gap, a bench
    along the wall under the windows and a table in front of it, and the
    lantern on the rail."""
    pc = Piece(rnd.uniform(0.95, 1.05))
    pc.box((-TERRACE_X, DECK - 0.06, TERRACE_Z), (TERRACE_X, DECK, -WZ), 'board', tex_grain(0, sv=0.85),
           skip=('z+',))
    put(pc)
    # beam, joists, posts and knee braces
    pc = Piece(rnd.uniform(0.85, 1.0))
    pc.box((-TERRACE_X, DECK - 0.26, -4.30), (TERRACE_X, DECK - 0.06, -4.14), 'beam', tex_grain(0), skip=('y+',))
    put(pc)
    for x in (-2.30, -0.77, 0.77, 2.30):
        pc = Piece(rnd.uniform(0.85, 1.0))
        pc.box((x - 0.05, DECK - 0.20, -4.14), (x + 0.05, DECK - 0.06, -PZ), 'beam', tex_grain(2),
               skip=('y+', 'z-', 'z+'))
        put(pc)
    for x in (-2.30, 0.0, 2.30):
        pc = Piece(rnd.uniform(0.85, 1.0))
        pc.box((x - 0.08, -PLINTH_DEPTH, -4.30), (x + 0.08, DECK - 0.26, -4.14), 'beam', tex_grain(1),
               skip=('y-', 'y+'))
        put(pc)
        for s in (-1, 1):
            if abs(x) > 1 and s * x > 0:
                continue
            member((x + s * 0.06, DECK - 0.95, -4.22), (x + s * 0.62, DECK - 0.27, -4.22), 0.08, 0.09, 'beam',
                   up=(0, 0, 1), skip=())

    # balustrade: posts, handrail, a bottom rail, and the sawn boards
    posts = [(-TERRACE_X + 0.05, RAIL_Z), (-0.90, RAIL_Z), (0.90, RAIL_Z), (TERRACE_X - 0.05, RAIL_Z),
             (TERRACE_X - 0.05, -3.40), (TERRACE_X - 0.05, -WZ - 0.06)]
    for (x, z) in posts:
        pc = Piece(rnd.uniform(0.85, 1.0))
        pc.box((x - 0.05, DECK, z - 0.05), (x + 0.05, 1.38, z + 0.05), 'beam', tex_grain(1), skip=('y-', 'y+'))
        put(pc)
    rails = [((-TERRACE_X, RAIL_Z - 0.06), (TERRACE_X, RAIL_Z + 0.06)),
             ((TERRACE_X - 0.11, RAIL_Z + 0.06), (TERRACE_X + 0.01, -WZ))]
    for (x0, z0), (x1, z1) in rails:
        pc = Piece(rnd.uniform(0.9, 1.05))
        pc.box((x0, 1.35, z0), (x1, 1.40, z1), 'timber', tex_grain(0 if x1 - x0 > z1 - z0 else 2))
        put(pc)
    for (x0, z0), (x1, z1) in (((-TERRACE_X, RAIL_Z - 0.03), (TERRACE_X, RAIL_Z + 0.03)),
                               ((TERRACE_X - 0.08, RAIL_Z + 0.03), (TERRACE_X - 0.02, -WZ))):
        pc = Piece(rnd.uniform(0.85, 1.0))
        pc.box((x0, DECK + 0.05, z0), (x1, DECK + 0.11, z1), 'beam', tex_grain(0 if x1 - x0 > z1 - z0 else 2),
               skip=('y-',))
        put(pc)
    balustrade(-TERRACE_X + 0.10, TERRACE_X - 0.10, lambda u: (u, RAIL_Z), 21)
    balustrade(RAIL_Z + 0.08, -WZ - 0.02, lambda u: (TERRACE_X - 0.05, u), 7)

    # snow: drifted in against the front boards, along the handrail, and on
    # the right-hand rail as far as the roof stops sheltering it
    path = []
    for i in range(8):
        x = -TERRACE_X + 0.04 + (2 * TERRACE_X - 0.10) * i / 7
        path.append((x, DECK, -4.02 + 0.02 * math.sin(i * 1.9)))
    put(strip(path, [(0.31, 0.0), (0.10, 0.045), (-0.14, 0.10), (-0.33, 0.16), (-0.335, 0.0)], 'drift', tex_none))
    # (broken where the lantern stands on the rail)
    lx = LANTERN[0]
    for a, b, n in ((-TERRACE_X - 0.01, lx - 0.15, 7), (lx + 0.15, TERRACE_X + 0.01, 1)):
        path = [(a + i * (b - a) / n, 1.40, RAIL_Z + 0.006 * math.sin(i * 2.3)) for i in range(n + 1)]
        sec = [(-0.068, -0.006), (-0.03, 0.05), (0.0, 0.065), (0.03, 0.05), (0.068, -0.006)]
        put(strip(path, sec, 'snow', tex_none))
    path = [(TERRACE_X - 0.05, 1.40, RAIL_Z + 0.06), (TERRACE_X - 0.05, 1.40, -3.75)]
    put(strip(path, [(-0.068, -0.006), (-0.03, 0.04), (0.0, 0.05), (0.03, 0.04), (0.068, -0.006)], 'snow', tex_none))

    lantern()
    furniture()


def balustrade(a, b, at, count):
    """Boards between two posts, sawn so that every gap between two of them
    is a figure — a slot swelling to a lozenge and tapering to a point,
    which is how these are cut: each board's edge is half the figure."""
    y0, y1 = DECK + 0.11, 1.35
    L = b - a
    holes = []
    for i in range(1, count):
        u = L * i / count
        bt, tp, mid = 0.07, y1 - y0 - 0.06, (y1 - y0) * 0.56
        w, Wd = 0.013, 0.05
        holes.append([(u, bt), (u + w, bt + 0.07), (u + Wd, mid - 0.02), (u + w, mid + 0.12), (u, tp),
                      (u - w, mid + 0.12), (u - Wd, mid - 0.02), (u - w, bt + 0.07)])
    outline = [(0, 0), (L, 0), (L, y1 - y0), (0, y1 - y0)]
    pc = Piece(rnd.uniform(0.9, 1.05))
    pc.slab(outline, [list(reversed(h)) for h in holes], -0.0125, 0.0125, 'timber', tex_grain(1, sv=0.85))
    p0 = Vector((at(a)[0], y0, at(a)[1]))
    p1 = Vector((at(b)[0], y0, at(b)[1]))
    put(pc, frame(p0, p1 - p0, (0, 1, 0)))


def lantern():
    """The frame round the lantern's glow, which the game draws itself."""
    x, y, z = LANTERN
    pc = Piece()
    pc.box((x - 0.13, 1.40, z - 0.13), (x + 0.13, 1.415, z + 0.13), 'iron', tex_none, skip=('y-',))
    for sx, sz in product((-1, 1), repeat=2):
        pc.box((x + sx * 0.112 - 0.008, 1.415, z + sz * 0.112 - 0.008),
               (x + sx * 0.112 + 0.008, 1.71, z + sz * 0.112 + 0.008), 'iron', tex_none, skip=('y-', 'y+'))
    pc.box((x - 0.14, 1.70, z - 0.14), (x + 0.14, 1.72, z + 0.14), 'iron', tex_none)
    apex = pc.vert((x, 1.83, z))
    rim = [pc.vert((x + sx * 0.13, 1.72, z + sz * 0.13)) for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i in range(4):
        pc.face([rim[i], rim[(i + 1) % 4], apex], 'iron', tex_none,
                out=(pc.v[rim[i]] + pc.v[rim[(i + 1) % 4]]) / 2 - Vector((x, 1.72, z)))
    pc.box((x - 0.012, 1.83, z - 0.012), (x + 0.012, 1.87, z + 0.012), 'iron', tex_none, skip=('y-',))
    put(pc)
    sn = Piece()
    apex = sn.vert((x, 1.85, z))
    rim = [sn.vert((x + sx * 0.12, 1.745, z + sz * 0.12)) for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i in range(4):
        sn.face([rim[i], rim[(i + 1) % 4], apex], 'snow', tex_none,
                out=(sn.v[rim[i]] + sn.v[rim[(i + 1) % 4]]) / 2 - Vector((x, 1.72, z)))
    put(sn)


def furniture():
    # the bench along the wall
    pc = Piece(rnd.uniform(0.95, 1.08))
    pc.box((-0.80, DECK + 0.42, -WZ - 0.34), (2.42, DECK + 0.47, -WZ - 0.01), 'board', tex_grain(0), skip=('z+',))
    for x in (-0.68, 0.82, 2.30):
        pc.box((x - 0.025, DECK, -WZ - 0.30), (x + 0.025, DECK + 0.42, -WZ - 0.03), 'board', tex_grain(1),
               skip=('y-', 'y+'))
    put(pc)
    # the table, on two crossed trestles
    tx, tz = 0.85, -3.20
    pc = Piece(rnd.uniform(0.95, 1.08))
    pc.box((tx - 0.80, DECK + 0.74, tz - 0.36), (tx + 0.80, DECK + 0.78, tz + 0.36), 'board', tex_grain(0))
    pc.box((tx - 0.55, DECK + 0.28, tz - 0.03), (tx + 0.55, DECK + 0.34, tz + 0.03), 'beam', tex_grain(0),
           skip=('x-', 'x+'))
    put(pc)
    for x in (tx - 0.58, tx + 0.58):
        for s in (-1, 1):
            member((x, DECK, tz - s * 0.30), (x, DECK + 0.74, tz + s * 0.30), 0.045, 0.09, 'beam', up=(1, 0, 0))
    # the bench in front of it, out from under the roof and under snow
    bz = -3.95
    pc = Piece(rnd.uniform(0.95, 1.08))
    pc.box((tx - 0.72, DECK + 0.42, bz - 0.15), (tx + 0.72, DECK + 0.46, bz + 0.15), 'board', tex_grain(0))
    for x in (tx - 0.58, tx + 0.58):
        pc.box((x - 0.025, DECK, bz - 0.13), (x + 0.025, DECK + 0.42, bz + 0.13), 'board', tex_grain(1),
               skip=('y-', 'y+'))
    put(pc)
    put(pillow(tx - 0.72, tx + 0.72, bz - 0.15, bz + 0.15, DECK + 0.46, 0.09))
    # and a dusting on the table, heaviest at the edge the roof does not reach
    put(pillow(tx - 0.76, tx + 0.76, tz - 0.34, tz - 0.05, DECK + 0.78, 0.035, over=0.0))

    # skis and poles against the wall beside the door
    m = WALLS['front']
    for u, lean in ((-2.50, 0.012), (-2.38, -0.008)):
        ski(m, u, lean)
    for u in (-2.31, -2.29):
        p0 = (u + 0.05, FLOOR, 0.36)
        p1 = (u, FLOOR + 1.28, 0.05)
        pole = Piece()
        a, b = Vector(p0), Vector(p1)
        pole.box((0, -0.009, -0.009), ((b - a).length, 0.009, 0.009), 'iron', tex_none, skip=('x-', 'x+'))
        put(pole, m @ frame(a, b - a, (0, 0, 1)))
        disc = Piece()
        c = a + (b - a).normalized() * 0.10
        disc.poly([c + Vector((math.cos(t) * 0.05, 0, math.sin(t) * 0.05)) for t in [TAU * i / 6 for i in range(6)]],
                  'ink', tex_none, out=(0, 1, 0))
        put(disc, m)


def ski(m, u, lean):
    """An old wooden ski stood on its tail, its tip curling away from the
    wall."""
    st = [(0.00, 0.068, 0.0), (1.58, 0.064, 0.0), (1.78, 0.074, 0.03), (1.90, 0.044, 0.10)]
    base = Vector((u, FLOOR, 0.30))
    up = Vector((lean, 1.0, -0.15)).normalized()
    out = Vector((0, 0, 1))
    side = up.cross(out).normalized()
    out = side.cross(up).normalized()
    pc = Piece(rnd.uniform(0.9, 1.05))
    rings = []
    for (s, w, c) in st:
        cpt = base + up * s + out * c
        rings.append([pc.vert(cpt + side * sx * w / 2 + out * so * 0.009) for (sx, so) in
                      ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for i in range(len(rings) - 1):
        for j in range(4):
            k = (j + 1) % 4
            q = [rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]]
            c = sum((pc.v[x] for x in q), Vector()) / 4
            ax = base + up * (up.dot(c - base))
            role = 'ski' if j == 2 else 'ink'
            pc.face(q, role, tex_none, out=c - ax - out * 0.0 if j != 2 else out)
    pc.face(rings[0], 'ink', tex_none, out=-up)
    pc.face(rings[-1], 'ink', tex_none, out=up)
    put(pc, m)


# ---------------------------------------------------------------------------
# The ledge, the woodpile
# ---------------------------------------------------------------------------

def ledge_snow():
    """Snow banked against the logs on the stone ledge, round the three
    sides the terrace does not cover."""
    path = []
    for z in (-2.20, -1.2, 0.0, 1.2, 2.2):
        path.append((WX, z))
    for x in (2.2, 1.1, 0.0, -1.1, -2.2):
        path.append((x, WZ))
    for z in (2.2, 1.2, 0.0, -1.2, -2.20):
        path.append((-WX, z))
    pts = [(x, DECK, z) for (x, z) in path]
    w = 0.16
    pc = Piece()
    rows = []
    for i, p in enumerate(pts):
        p = Vector(p)
        a = Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])
        a.y = 0
        a.normalize()
        out = a.cross(Vector((0, 1, 0)))
        if out.dot(Vector((p.x, 0, p.z))) < 0:
            out = -out
        hgt = 0.22 + 0.10 * math.sin(i * 1.7)
        rows.append([p + out * 0.0 + Vector((0, hgt, 0)), p + out * 0.06 + Vector((0, hgt * 0.42, 0)),
                     p + out * (w + 0.035) + Vector((0, -0.01, 0))])
    pc.sheet(rows, 'drift', tex_none, up=lambda c: Vector((c.x, 3.0, c.z)))
    # closed where it meets the terrace at each front corner
    pc.poly(rows[0], 'drift', tex_none, out=(0, 0, -1))
    pc.poly(rows[-1], 'drift', tex_none, out=(0, 0, -1))
    put(pc)


def woodpile():
    """Split logs stacked under the eave against the left wall, on a stone
    footing of their own — the one part of a hut that says somebody is
    coming back to it."""
    x0, x1 = -3.56, -PX
    z0, z1 = -0.70, 1.70
    pc = Piece()
    for q, o in (([(x0, -PLINTH_DEPTH + 0.3, z0), (x0, -PLINTH_DEPTH + 0.3, z1), (x0, 0.42, z1), (x0, 0.42, z0)], (-1, 0, 0)),
                 ([(x0, -PLINTH_DEPTH + 0.3, z0), (x0, 0.42, z0), (x1, 0.42, z0), (x1, -PLINTH_DEPTH + 0.3, z0)], (0, 0, -1)),
                 ([(x0, -PLINTH_DEPTH + 0.3, z1), (x1, -PLINTH_DEPTH + 0.3, z1), (x1, 0.42, z1), (x0, 0.42, z1)], (0, 0, 1)),
                 ([(x0, 0.42, z0), (x0, 0.42, z1), (x1, 0.42, z1), (x1, 0.42, z0)], (0, 1, 0))):
        pc.poly(q, 'masonry', tex_metres, out=o)
    put(pc)
    # the stack: its face a field of sawn ends, unevenly stacked
    sx0, sx1, sz0, sz1, sy0, sy1 = -3.49, -2.93, -0.62, 1.62, 0.42, 1.20
    pc = Piece()
    nz, ny = 5, 3
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nz + 1):
            jit = 0.0 if i in (0, nz) or j in (0, ny) else rnd.uniform(-0.025, 0.025)
            row.append(Vector((sx0 + jit, sy0 + (sy1 - sy0) * j / ny, sz0 + (sz1 - sz0) * i / nz)))
        grid.append(row)
    pc.sheet(grid, 'woodpile', tex_metres, up=lambda c: Vector((-1, 0, 0)))
    for q, o in (([(sx0, sy0, sz0), (sx1, sy0, sz0), (sx1, sy1, sz0), (sx0, sy1, sz0)], (0, 0, -1)),
                 ([(sx0, sy0, sz1), (sx0, sy1, sz1), (sx1, sy1, sz1), (sx1, sy0, sz1)], (0, 0, 1)),
                 ([(sx0, sy1, sz0), (sx1, sy1, sz0), (sx1, sy1, sz1), (sx0, sy1, sz1)], (0, 1, 0)),
                 ([(sx1, sy0, sz0), (sx1, sy1, sz0), (sx1, sy1, sz1), (sx1, sy0, sz1)], (1, 0, 0))):
        pc.poly(q, 'beam', tex_grain(0), out=o)
    put(pc)
    put(pillow(sx0, sx1 + 0.02, sz0, sz1, sy1, 0.09))
    # a few ends standing proud of the face
    for (z, y, r) in ((-0.30, 0.62, 0.072), (0.55, 0.95, 0.066), (1.25, 0.58, 0.07)):
        pc = Piece(rnd.uniform(0.9, 1.1))
        n = 6
        a0 = rnd.uniform(0, TAU)
        ring_o = [Vector((sx0 - 0.07, y + math.sin(a0 + TAU * i / n) * r, z + math.cos(a0 + TAU * i / n) * r))
                  for i in range(n)]
        ring_i = [p + Vector((0.09, 0, 0)) for p in ring_o]
        io = [pc.vert(p) for p in ring_o]
        ii = [pc.vert(p) for p in ring_i]
        for i in range(n):
            j = (i + 1) % n
            mid = (ring_o[i] + ring_o[j]) / 2
            pc.face([io[i], io[j], ii[j], ii[i]], 'beam', tex_grain(0), out=(0, mid.y - y, mid.z - z))
        pc.face(io, 'endgrain', tex_rings(y, z, axis=0), out=(-1, 0, 0))
        put(pc)


# ---------------------------------------------------------------------------
# Realising, baking, exporting
# ---------------------------------------------------------------------------

# Preview colours (the game paints each role from huts.js#HUT_LOOKS) and the
# kind of surface each is, for the preview's textures
LOOKS = {
    'snow': ('#f4f8ff', 'snow'), 'drift': ('#e7effb', 'snow'), 'ice': ('#dcebf1', 'snow'),
    'masonry': ('#7a766e', 'rubble'), 'quoin': ('#8f8a80', 'stone'), 'slate': ('#5d6066', 'stone'),
    'log': ('#6d4a30', 'wood'), 'timber': ('#7a5636', 'wood'), 'beam': ('#4a3221', 'wood'),
    'board': ('#866142', 'wood'), 'door': ('#5a3a24', 'wood'), 'frame': ('#3f2a1a', 'wood'),
    'endgrain': ('#5e4632', 'plain'), 'shutter': ('#365954', 'paint'),
    'iron': ('#26272a', 'plain'), 'sign': ('#ffab00', 'plain'), 'ink': ('#2c1e14', 'plain'),
    'interior': ('#140e0a', 'plain'), 'curtain': ('#8e2b25', 'plain'), 'glass': ('#1a2128', 'plain'),
    'soot': ('#0c0c0d', 'plain'), 'ski': ('#a84931', 'plain'), 'woodpile': ('#9a7048', 'pile'),
}


def realise(name, col):
    """Every piece into one mesh: roles as material slots, the UVs, and
    `_SHADE` — the piece's tone times the occlusion baked here."""
    for role, (hexc, _) in LOOKS.items():
        riders.PALETTE[role] = hexc
    roles = sorted({r for pc in PIECES for r in pc.r})
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    tone_l = bm.verts.layers.float.new('tone')
    smooth_l = bm.faces.layers.int.new('smooth')
    for pc in PIECES:
        vs = []
        for p in pc.v:
            v = bm.verts.new(B(p))
            v[tone_l] = pc.tone
            vs.append(v)
        for f, uv, r in zip(pc.f, pc.uv, pc.r):
            try:
                face = bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue
            face.material_index = roles.index(r)
            face[smooth_l] = 1 if r in SMOOTH else 0
            for loop, t in zip(face.loops, uv):
                loop[uvl].uv = t
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.normal_update()
    # Hard edges, physically split: every crease over 35° except within snow
    sharp = []
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f0, f1 = e.link_faces
        if f0[smooth_l] and f1[smooth_l]:
            continue
        if f0.normal.angle(f1.normal, 0.0) > math.radians(35):
            sharp.append(e)
    bmesh.ops.split_edges(bm, edges=sharp)
    bm.normal_update()
    ao = occlusion(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    shade = [v[tone_l] * a for v, a in zip(bm.verts, ao)]
    bm.free()
    for r in roles:
        me.materials.append(riders.material(r))
    a = me.attributes.new('_SHADE', 'FLOAT', 'POINT')
    a.data.foreach_set('value', shade)
    me.shade_smooth()
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def occlusion(bm, rays=28, reach=2.4):
    """Sky occlusion per vertex, by casting rays through the building: how
    much of the hemisphere over each vertex the hut itself hides. A soffit
    under the overhang, the back of a window reveal, the logs under the
    eaves and the boards under the terrace come out dark; the roof's snow
    does not."""
    bvh = BVHTree.FromBMesh(bm)
    dirs = []
    for i in range(rays):
        # cosine-weighted, on a Fibonacci spiral
        t = (i + 0.5) / rays
        r = math.sqrt(t)
        a = i * 2.39996323
        dirs.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - t)))))
    out = []
    z = Vector((0, 0, 1))
    for v in bm.verts:
        n = v.normal
        if n.length < 1e-6:
            out.append(1.0)
            continue
        q = z.rotation_difference(n)
        o = v.co + n * 0.012
        hit = 0
        for d in dirs:
            if bvh.ray_cast(o, q @ d, reach)[0] is not None:
                hit += 1
        occ = hit / rays
        out.append(max(0.4, 1.0 - 0.72 * occ))
    return out


def build_hut():
    PIECES.clear()
    plinth()
    walls()
    windows()
    gables()
    roof()
    snow_load()
    top = chimney()
    terrace()
    ledge_snow()
    woodpile()
    col = collection('hut')
    clear_collection(col)
    ob = realise('hut', col)
    cx, cz = CHIMNEY_XZ
    ob['chimney'] = [cx, round(top, 4), cz]
    ob['deck'] = DECK
    ob['plinthDepth'] = PLINTH_DEPTH
    ob['glass'] = {'front': GLASS_FRONT, 'side': GLASS_SIDE,
                   'panesFront': [[c[0], c[1], s[0], s[1]] for c, s, _ in PANES_FRONT],
                   'panesSide': [[c[0], c[1], s[0], s[1]] for c, s, _ in PANES_SIDE]}
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]   # Blender y is game −z
    zs = [v.co.z for v in ob.data.vertices]
    ob['bounds'] = [round(min(xs), 3), round(min(zs), 3), round(-max(ys), 3),
                    round(max(xs), 3), round(max(zs), 3), round(-min(ys), 3)]
    return ob


def export_hut(ob, path):
    for o in bpy.data.objects:
        if o.name in bpy.context.view_layer.objects:
            o.select_set(False)
    ob.hide_set(False)
    ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True,
        export_materials='EXPORT', export_attributes=True, export_extras=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False,
    )
    return os.path.getsize(path)


# ---------------------------------------------------------------------------
# Preview: Cycles on the CPU, the roles dressed roughly as the game dresses
# them (plank photograph, slate photograph, a brick node for the rubble)
# ---------------------------------------------------------------------------

def _hex_lin(h):
    return riders.hex_rgba(h)


def preview_materials(ob, assets, debug=False):
    wood = bpy.data.images.load(os.path.join(assets, 'textures', 'huts', 'alpine-wood-planks.jpg'),
                                check_existing=True)
    slate = bpy.data.images.load(os.path.join(assets, 'textures', 'rock', 'rock-slate.jpg'), check_existing=True)
    for i, mat in enumerate(ob.data.materials):
        role = mat.name.split('.')[0]
        hexc, kind = LOOKS[role]
        m = bpy.data.materials.new('pv_' + role)
        nt = m.node_tree
        nodes, links = nt.nodes, nt.links
        bsdf = nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.85 if kind != 'snow' else 0.55
        col = nodes.new('ShaderNodeRGB')
        col.outputs[0].default_value = _hex_lin(hexc)
        attr = nodes.new('ShaderNodeAttribute')
        attr.attribute_name = '_SHADE'
        attr.attribute_type = 'GEOMETRY'
        mul = nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        links.new(col.outputs[0], mul.inputs[6])
        links.new(attr.outputs['Fac'], mul.inputs[7])
        base = mul.outputs[2]
        if kind in ('wood', 'paint', 'stone', 'rubble'):
            uv = nodes.new('ShaderNodeUVMap')
            sep = nodes.new('ShaderNodeSeparateXYZ')
            comb = nodes.new('ShaderNodeCombineXYZ')
            flip = nodes.new('ShaderNodeMath')
            flip.operation = 'SUBTRACT'
            flip.inputs[0].default_value = 1.0
            links.new(uv.outputs[0], sep.inputs[0])
            scale = 0.45 if kind in ('stone', 'rubble') else 1.0
            if scale != 1.0:
                sc = nodes.new('ShaderNodeVectorMath')
                sc.operation = 'SCALE'
                sc.inputs['Scale'].default_value = scale
                links.new(uv.outputs[0], sc.inputs[0])
                links.new(sc.outputs[0], sep.inputs[0])
            links.new(sep.outputs[0], comb.inputs[0])
            links.new(sep.outputs[1], flip.inputs[1])
            links.new(flip.outputs[0], comb.inputs[1])
            img = nodes.new('ShaderNodeTexImage')
            img.image = wood if kind in ('wood', 'paint') else slate
            links.new(comb.outputs[0], img.inputs[0])
            gain = nodes.new('ShaderNodeMix')
            gain.data_type = 'RGBA'
            gain.blend_type = 'MULTIPLY'
            gain.inputs['Factor'].default_value = 1.0
            links.new(img.outputs[0], gain.inputs[6])
            gain.inputs[7].default_value = (5.2, 5.2, 5.2, 1) if kind in ('wood', 'paint') else (5.9, 5.9, 5.9, 1)
            tex = nodes.new('ShaderNodeMix')
            tex.data_type = 'RGBA'
            tex.blend_type = 'MULTIPLY'
            tex.inputs['Factor'].default_value = {'wood': 0.7, 'paint': 0.38, 'stone': 0.75, 'rubble': 0.6}[kind]
            links.new(base, tex.inputs[6])
            links.new(gain.outputs[2], tex.inputs[7])
            base = tex.outputs[2]
            if kind == 'rubble':
                brick = nodes.new('ShaderNodeTexBrick')
                brick.offset = 0.45
                brick.squash = 1.0
                brick.inputs['Scale'].default_value = 1.0
                brick.inputs['Mortar Size'].default_value = 0.018
                brick.inputs['Brick Width'].default_value = 0.52
                brick.inputs['Row Height'].default_value = 0.27
                brick.inputs['Color1'].default_value = (0.85, 0.85, 0.85, 1)
                brick.inputs['Color2'].default_value = (1.15, 1.12, 1.05, 1)
                brick.inputs['Mortar'].default_value = (1.25, 1.2, 1.1, 1)
                links.new(uv.outputs[0], brick.inputs['Vector'])
                bm_ = nodes.new('ShaderNodeMix')
                bm_.data_type = 'RGBA'
                bm_.blend_type = 'MULTIPLY'
                bm_.inputs['Factor'].default_value = 1.0
                links.new(base, bm_.inputs[6])
                links.new(brick.outputs['Color'], bm_.inputs[7])
                base = bm_.outputs[2]
        if kind == 'pile':
            # the game draws the sawn ends in its shader; this is near enough
            uv = nodes.new('ShaderNodeUVMap')
            vor = nodes.new('ShaderNodeTexVoronoi')
            vor.inputs['Scale'].default_value = 6.7
            vor.inputs['Randomness'].default_value = 0.35
            links.new(uv.outputs[0], vor.inputs['Vector'])
            ramp = nodes.new('ShaderNodeValToRGB')
            ramp.color_ramp.elements[0].position = 0.0
            ramp.color_ramp.elements[0].color = (0.42, 0.26, 0.13, 1)
            ramp.color_ramp.elements[1].position = 0.40
            ramp.color_ramp.elements[1].color = (0.30, 0.18, 0.09, 1)
            e = ramp.color_ramp.elements.new(0.46)
            e.color = (0.05, 0.035, 0.025, 1)
            e = ramp.color_ramp.elements.new(0.55)
            e.color = (0.012, 0.009, 0.007, 1)
            links.new(vor.outputs['Distance'], ramp.inputs[0])
            pm = nodes.new('ShaderNodeMix')
            pm.data_type = 'RGBA'
            pm.blend_type = 'MULTIPLY'
            pm.inputs['Factor'].default_value = 1.0
            links.new(attr.outputs['Fac'], pm.inputs[6])
            pm.inputs[6].default_value = (1, 1, 1, 1)
            links.new(ramp.outputs[0], pm.inputs[7])
            base = pm.outputs[2]
        links.new(base, bsdf.inputs['Base Color'])
        if debug:
            geo = nodes.new('ShaderNodeNewGeometry')
            emis = nodes.new('ShaderNodeEmission')
            emis.inputs['Color'].default_value = (1, 0, 1, 1)
            emis.inputs['Strength'].default_value = 2.0
            mix = nodes.new('ShaderNodeMixShader')
            out = nodes.get('Material Output')
            links.new(geo.outputs['Backfacing'], mix.inputs[0])
            links.new(bsdf.outputs[0], mix.inputs[1])
            links.new(emis.outputs[0], mix.inputs[2])
            links.new(mix.outputs[0], out.inputs['Surface'])
        ob.data.materials[i] = m


def preview(ob, out_dir, assets, debug=False):
    os.makedirs(out_dir, exist_ok=True)
    preview_materials(ob, assets, debug)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48 if not debug else 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.resolution_percentage = 100
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    col = collection('hut_stage')
    clear_collection(col)
    # a slope like the ones the huts are planted on: level with the deck in
    # front, falling away behind, so the stone storey stands out of it
    me = bpy.data.meshes.new('slope')
    zs = (-40.0, -4.5, 40.0)
    pts = [B((x, 0.45 - 0.42 * max(0.0, z + 4.5), z)) for z in zs for x in (-40.0, 40.0)]
    me.from_pydata(pts, [], [(0, 1, 3, 2), (2, 3, 5, 4)])
    snow = bpy.data.materials.new('pv_ground')
    snow.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.86, 0.88, 0.92, 1)
    me.materials.append(snow)
    fl = bpy.data.objects.new('slope', me)
    col.objects.link(fl)
    ld = bpy.data.lights.new('hut_sun', 'SUN')
    ld.energy = 3.6
    ld.angle = math.radians(3)
    sun = bpy.data.objects.new('hut_sun', ld)
    col.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.80, 0.82, 0.86, 1)
    bg.inputs[1].default_value = 0.9
    cd = bpy.data.cameras.new('hut_cam')
    cd.lens = 40
    cam = bpy.data.objects.new('hut_cam', cd)
    col.objects.link(cam)
    scene.camera = cam
    shots = [('hut-34', (11.5, 6.0, -14.5), (0.2, 2.6, -0.5)),
             ('hut-front', (0.0, 3.0, -17.5), (0.0, 2.9, -0.6)),
             ('hut-back', (-11.0, 3.5, 13.5), (0.0, 1.6, 0.3))]
    if debug:
        shots = [('hut-debug-front', (7.0, 3.0, -11.0), (0.3, 2.2, -0.6)),
                 ('hut-debug-back', (-8.0, 4.0, 11.0), (0.0, 2.0, 0.0)),
                 ('hut-debug-under', (6.0, -1.0, -9.0), (0.5, 2.0, -2.0))]
    written = []
    for name, eye, look in shots:
        cam.location = B(eye)
        d = Vector(B(look)) - Vector(B(eye))
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(out_dir, name + '.png')
        bpy.ops.render.render(write_still=True)
        written.append(scene.render.filepath)
    return written


if __name__ == '__main__' and '--' in sys.argv:
    args = sys.argv[sys.argv.index('--') + 1:]
    # A factory-startup scene opens on a cube, a camera and a lamp, and the
    # cube stands in the middle of the parlour
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    ob = build_hut()
    print('hut: %d triangles, %d vertices' % (tris(ob), len(ob.data.vertices)))
    here = os.path.dirname(os.path.abspath(__file__))
    assets = os.path.normpath(os.path.join(here, '..', '..', 'assets'))
    if '--out' in args:
        out = args[args.index('--out') + 1]
        os.makedirs(out, exist_ok=True)
        print('hut: wrote %d bytes' % export_hut(ob, os.path.join(out, 'mountain-hut.glb')))
    if '--preview' in args:
        print(preview(ob, args[args.index('--preview') + 1], assets, debug='--debug' in args))
