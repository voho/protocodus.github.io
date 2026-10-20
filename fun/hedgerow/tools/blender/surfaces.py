"""Hedgerow — the procedural surface library (models v2).

Every palette key (kit.PALETTE) has a recipe here that turns it into a
physical, weathered surface for the bake in bake.py: Caen-limestone rubble
walls with mortar and soot, lime plaster with water stains and patches
fallen off, barrel tiles with lichen, slate, planks with grain and gaps,
paint peeling off wood, chipped and rusted paint on steel, blued gun steel
worn bright at the edges, board-formed concrete, burlap, wool, leather,
bark, granite with moss...

Recipes see a context S:
  S.P    object position in metres, offset per model (3D noise)
  S.Z    true height above the model's base
  S.UV   the kit box UVs in metres (2D layouts: courses, tiles, planks)
  S.N, S.up   normal, its z
  S.ao   baked ambient occlusion (0 occluded .. 1 open)
  S.edge baked edge mask (0 flat .. 1 on an edge)
and return a dict: albedo (colour), rough, metal, height (for bump), bump
(strength), and optionally glow. `finish()` then adds the shared weathering
(occlusion, cavity dirt, ground splash, rain streaks, moss) by the key's
weathering profile.
"""
import bpy
import kit
from bake import Graph

_ROUTES = {}      # material name -> {'albedo': socket, ...,'bsdf': node, 'out': node}


def lin(hexcode):
    return kit.srgb_to_linear(hexcode)


class Ctx:
    def __init__(self, g, ao_img, edge_img, seed, bevel):
        self.g = g
        self.seed = seed
        off = ((seed * 7.31) % 50.0, (seed * 3.17) % 50.0, (seed * 5.93) % 50.0)
        raw = g.coord('Object')
        self.Pobj = raw
        self.P = g.vadd(raw, off)
        self.Z = g.sep(raw)[2]
        self.UV = g.uvmap('UVMap')
        self.U, self.V, _ = g.sep(self.UV)
        self.N = g.geometry('Normal')
        self.up = g.sep(self.N)[2]
        self.ao = g.image(ao_img) if ao_img else 1.0
        self.edge = g.image(edge_img) if edge_img else 0.0
        self.bevel = bevel

    # shorthands
    def n(self, scale, detail=4.0, rough=0.55, vec=None, stretch=None, kind='FBM', distortion=0.0):
        g = self.g
        v = vec if vec is not None else self.P
        if stretch:
            v = g.vscale(v, stretch)
        return g.noise(v, scale, detail=detail, rough=rough, kind=kind, distortion=distortion)

    def uvn(self, scale, stretch=(1, 1, 1), detail=4.0, rough=0.55):
        return self.n(scale, detail, rough, vec=self.g.vadd(self.g.vscale(self.UV, stretch), (self.seed * 0.37, self.seed * 0.71, 0)))

    def col(self, hexcode):
        return lin(hexcode)

    def tint(self, color, amount_socket, lo=0.85, hi=1.15):
        """Brightness variation: color * mix(lo, hi, amount)."""
        g = self.g
        k = g.map_range(amount_socket, 0.0, 1.0, lo, hi)
        return g.mix(1.0, color, g.combine(k, k, k), blend='MULTIPLY')


# --------------------------------------------------------------------------
# recipes

def r_stone(S, key, dark=False):
    """Rubble limestone in rough courses: stones of varied size and tint,
    recessed lime mortar, a few dressed-looking big stones."""
    g = S.g
    # coursed rubble: long low stones, sizes varying from course to course
    course = g.floor(g.mul(S.V, 3.1))
    csz = g.map_range(g.noise(g.combine(course, S.seed * 0.3, 0.0), 7.3, detail=0), 0.3, 0.7, 1.5, 2.6)
    uv = g.combine(g.mul(S.U, csz), g.mul(S.V, 3.1), 0.0)
    uv = g.vadd(uv, g.vscale(g.combine(S.uvn(0.9), S.uvn(1.3), 0.0), (0.35, 0.12, 0.0)))
    ed = g.voronoi_edge(uv, 1.0, rand=0.75, dims='2D')
    cid = g.voronoi(uv, 1.0, out='Color', rand=0.75, dims='2D')
    mortar = g.smooth(ed, 0.06, 0.015)
    rnd = g.sep(cid)[0]
    base = S.col('#6c675e') if dark else S.col('#a59d8c')
    warm = S.col('#58524a') if dark else S.col('#b2a68e')
    cold = S.col('#4e4d4a') if dark else S.col('#8d8b84')
    stone = g.mix(g.sep(cid)[1], g.mix(rnd, cold, warm), base)
    stone = S.tint(stone, S.n(9.0, 6, 0.6), 0.75, 1.2)
    stone = S.tint(stone, S.n(55.0, 3, 0.7), 0.88, 1.1)
    mortar_c = S.col('#8f897c') if dark else S.col('#b9b2a2')
    alb = g.mix(mortar, stone, S.tint(mortar_c, S.n(30.0), 0.8, 1.1))
    h_stone = g.add(g.mul(g.smooth(ed, 0.0, 0.12), 0.7), g.mul(S.n(14.0, 5, 0.65), 0.3))
    h = g.mixf(mortar, h_stone, g.mul(S.n(40.0), 0.15))
    rough = g.mixf(mortar, g.map_range(S.n(20.0), 0, 1, 0.72, 0.92), 0.95)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.9, dist=0.03)


def r_plaster(S, key):
    """Lime render: blotchy, trowel-marked, hairline cracks, patches fallen
    off showing the rubble behind, darker water stains."""
    g = S.g
    base = S.col('#b8ae99') if key == 'plaster' else S.col('#9f9480')
    alb = S.tint(base, S.n(1.2, 4, 0.6), 0.82, 1.12)
    alb = S.tint(alb, S.n(7.0, 4, 0.6), 0.92, 1.06)
    # stains running down under sills and eaves
    streak = g.smooth(S.n(3.0, 3, 0.5, stretch=(6, 6, 0.35)), 0.55, 0.75)
    alb = g.mix(g.mul(streak, 0.45), alb, S.col('#6f6656'))
    # cracks
    crk = g.smooth(g.voronoi_edge(S.P, 2.2, rand=1.0), 0.012, 0.0)
    crk = g.mul(crk, g.smooth(S.n(1.5), 0.55, 0.7))
    alb = g.mix(g.mul(crk, 0.8), alb, S.col('#4a4439'))
    # patches where the render fell off
    patch = g.smooth(g.add(S.n(1.6, 5, 0.6), g.mul(S.edge, 0.25)), 0.66, 0.70)
    st = r_stone(S, 'stone')
    alb = g.mix(patch, alb, st['albedo'])
    h_pl = g.add(0.75, g.mul(S.n(25.0, 4, 0.6), 0.12))
    h_pl = g.sub(h_pl, g.mul(crk, 0.3))
    h = g.mixf(patch, h_pl, g.mul(st['height'], 0.5))
    rough = g.mixf(patch, g.map_range(S.n(6.0), 0, 1, 0.82, 0.95), st['rough'])
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.8, dist=0.03)


def r_brick(S, key):
    g = S.g
    uv = g.vadd(S.UV, (0.03 * S.seed, 0.0, 0.0))
    mortar = g.brick(uv, 1.0, 0.009, width=0.225, height=0.075, smooth=0.25, out='Fac')
    bc = g.brick(uv, 1.0, 0.009, width=0.225, height=0.075, smooth=0.0, out='Color')
    rnd = g.sep(bc)[0]
    brick = g.mix(rnd, S.col('#7a3c2c'), S.col('#9a5a40'))
    brick = g.mix(g.smooth(S.n(3.0), 0.6, 0.8), brick, S.col('#5a2e24'))
    brick = S.tint(brick, S.n(40.0, 3, 0.7), 0.8, 1.15)
    alb = g.mix(mortar, brick, S.tint(S.col('#a29a8a'), S.n(30.0), 0.8, 1.1))
    h = g.mixf(mortar, g.add(0.7, g.mul(S.n(25.0), 0.3)), 0.1)
    rough = g.mixf(mortar, 0.82, 0.95)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.8, dist=0.02)


def r_roof_tile(S, key):
    """Barrel tiles in courses along the ridge, each its own fired colour,
    lichen and moss on the old ones."""
    g = S.g
    uv = g.vadd(S.UV, (0.0, 0.0, 0.0))
    mortar = g.brick(uv, 1.0, 0.012, width=0.21, height=0.3, smooth=0.6, out='Fac')
    bc = g.brick(uv, 1.0, 0.0, width=0.21, height=0.3, out='Color')
    u = g.fract(g.mul(S.U, 1 / 0.21))
    v = g.fract(g.mul(S.V, 1 / 0.3))
    curve = g.power(g.sin(g.mul(u, 3.14159)), 0.6)
    lap = g.smooth(v, 0.0, 0.25)
    tile = g.mix(g.sep(bc)[0], S.col('#7b3a26'), S.col('#9a5636'))
    tile = g.mix(g.smooth(S.n(2.0), 0.55, 0.8), tile, S.col('#5e3426'))
    tile = S.tint(tile, S.n(30.0, 3, 0.6), 0.85, 1.12)
    shade = g.add(0.55, g.mul(g.mul(curve, lap), 0.45))
    alb = g.mix(1.0, tile, g.combine(shade, shade, shade), blend='MULTIPLY')
    lichen = g.mul(g.smooth(S.n(9.0, 5, 0.7), 0.62, 0.7), g.smooth(S.up, 0.2, 0.6))
    alb = g.mix(lichen, alb, S.col('#9a9a6a'))
    h = g.add(g.mul(curve, 0.6), g.mul(g.one_minus(v), 0.3))
    h = g.sub(h, g.mul(mortar, 0.3))
    rough = g.map_range(S.n(8.0), 0, 1, 0.62, 0.85)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=1.0, dist=0.04)


def r_slate(S, key):
    g = S.g
    gap = g.brick(S.UV, 1.0, 0.006, width=0.26, height=0.12, smooth=0.3, out='Fac')
    bc = g.brick(S.UV, 1.0, 0.0, width=0.26, height=0.12, out='Color')
    v = g.fract(g.mul(S.V, 1 / 0.12))
    sl = g.mix(g.sep(bc)[0], S.col('#3b4046'), S.col('#4d535a'))
    sl = S.tint(sl, S.n(40.0, 3, 0.7, stretch=(1, 3, 1)), 0.85, 1.15)
    alb = g.mix(g.mul(g.smooth(v, 0.15, 0.0), 0.5), sl, S.col('#25282c'))
    alb = g.mix(gap, alb, S.col('#202224'))
    h = g.sub(g.add(g.mul(g.one_minus(v), 0.5), g.mul(S.n(30.0), 0.2)), g.mul(gap, 0.4))
    rough = g.map_range(S.n(10.0), 0, 1, 0.45, 0.65)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.8, dist=0.02)


def r_thatch(S, key):
    g = S.g
    fib = S.n(30.0, 6, 0.7, vec=S.UV, stretch=(1, 0.06, 1))
    alb = g.mix(fib, S.col('#5e5038'), S.col('#8a7650'))
    alb = g.mix(g.smooth(S.n(2.0), 0.55, 0.75), alb, S.col('#3e3a28'))
    return dict(albedo=alb, rough=0.95, metal=0.0, height=fib, bump=1.2, dist=0.03)


def _planks(S, width=0.17, dark=False, old=False, across=False, gaps=True):
    """Boards with grain along their length, gaps, knots, per-board tone.
    Boards run along v (vertical on walls); `across` turns them to run
    along u (horizontal boards); `gaps=False` for solid timber."""
    g = S.g
    U, V = (S.V, S.U) if across else (S.U, S.V)
    u = g.mul(U, 1 / width)
    board = g.floor(u)
    fu = g.fract(u)
    gap = g.smooth(g.minimum(fu, g.one_minus(fu)), 0.04, 0.0) if gaps else 0.0
    rnd = g.noise(g.combine(board, S.seed * 0.1, 0.0), 13.7, detail=0)
    grain_v = g.combine(g.mul(U, 36.0), g.mul(V, 2.2), g.mul(board, 3.1))
    grain = g.noise(grain_v, 1.0, detail=6, rough=0.65, distortion=0.4)
    rings = g.wave(grain_v, 0.6, kind='RINGS', distortion=3.0, detail=3)
    knots = g.smooth(g.voronoi(g.vscale(S.UV, (6, 1.6, 1)), 1.0, rand=1.0), 0.06, 0.0)
    if old:
        c0, c1 = S.col('#7a7468'), S.col('#9c958a')
    elif dark:
        c0, c1 = S.col('#2d2119'), S.col('#4a382a')
    else:
        c0, c1 = S.col('#5a412d'), S.col('#7c5e43')
    alb = g.mix(g.add(g.mul(grain, 0.6), g.mul(rnd, 0.4)), c0, c1)
    alb = S.tint(alb, rings, 0.85, 1.08)
    alb = g.mix(g.mul(knots, 0.7), alb, S.col('#2a1d14'))
    if gaps:
        alb = g.mix(gap, alb, S.col('#16110c'))
    h = g.sub(g.add(0.7, g.mul(grain, 0.25)), g.mul(gap, 0.7)) if gaps else g.add(0.7, g.mul(grain, 0.25))
    rough = g.map_range(grain, 0, 1, 0.68, 0.9)
    return alb, h, rough, gap


def r_wood(S, key):
    k = key[:-2] if key.endswith('_h') else key
    alb, h, rough, _ = _planks(S, dark=k == 'wood_dark', old=k == 'wood_old', across=key.endswith('_h'))
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.7, dist=0.02)


def r_paint_wood(S, key):
    """Paint over boards, flaking at the edges and in patches."""
    g = S.g
    wood, h_w, r_w, gap = _planks(S, old=True)
    paint = S.col({'paint_green': '#3d5240', 'paint_blue': '#4a5d6e', 'paint_red': '#7a2a22',
                   'paint_white': '#c9c6bc', 'marking_white': '#d8d4c8'}.get(key, '#3d5240'))
    paint = S.tint(paint, S.n(3.0), 0.8, 1.1)
    peel = g.smooth(g.add(g.mul(S.edge, 0.6), S.n(7.0, 5, 0.7)), 0.72, 0.76)
    alb = g.mix(peel, paint, wood)
    alb = g.mix(gap, alb, S.col('#16110c'))
    h = g.mixf(peel, g.add(h_w, 0.08), h_w)
    rough = g.mixf(peel, 0.55, r_w)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.6, dist=0.02)


def r_painted_metal(S, key):
    """Painted steel: fine orange-peel, scratches, chips at edges showing
    dark steel and rust, mud low down, dust on top."""
    g = S.g
    paint = S.col({'metal_olive': '#4d5333', 'metal_gray': '#565c5c', 'helmet_od': '#4a4c33',
                   'helmet_gray': '#4f5650', 'paint_red': '#7a2a22', 'paint_white': '#c9c6bc',
                   'marking_white': '#d8d4c8'}.get(key, '#4d5333'))
    paint = S.tint(paint, S.n(2.0, 3), 0.85, 1.1)
    paint = S.tint(paint, S.n(60.0, 2), 0.93, 1.05)
    chip = g.smooth(g.add(g.mul(S.edge, 0.75), g.mul(S.n(14.0, 6, 0.7), 0.55)), 0.78, 0.82)
    scratch = g.smooth(S.n(20.0, 2, 0.5, stretch=(1, 1, 22), kind='RIDGED_MULTIFRACTAL'), 0.92, 0.98)
    steel = S.col('#2b2b2a')
    rust = g.mix(S.n(30.0), S.col('#5a2c16'), S.col('#8a4a22'))
    under = g.mix(g.smooth(S.n(5.0), 0.45, 0.6), steel, rust)
    alb = g.mix(chip, paint, under)
    alb = g.mix(g.mul(scratch, 0.5), alb, S.col('#6a6a64'))
    sand = S.n(180.0, 2, 0.5) if key.startswith('helmet') else S.n(90.0, 2, 0.5)
    h = g.sub(g.add(0.6, g.mul(sand, 0.08)), g.mul(chip, 0.12))
    rough = g.mixf(chip, 0.62 if key.startswith('helmet') else 0.55, 0.45)
    metal = g.mixf(chip, 0.05, g.mixf(g.smooth(S.n(5.0), 0.45, 0.6), 0.85, 0.2))
    return dict(albedo=alb, rough=rough, metal=metal, height=h, bump=0.35, dist=0.01)


def r_steel(S, key):
    """Bare / blued steel and iron: scratches, worn bright edges, rust in
    the corners."""
    g = S.g
    base = S.col({'gun_metal': '#1d1f22', 'gun_metal_worn': '#34363a', 'iron': '#2a2b2c',
                  'metal_dark': '#262727', 'wire': '#3a3530'}.get(key, '#262727'))
    alb = S.tint(base, S.n(8.0, 4), 0.8, 1.2)
    scratch = g.smooth(S.n(25.0, 2, 0.5, stretch=(1, 1, 18), kind='RIDGED_MULTIFRACTAL'), 0.9, 0.97)
    worn = g.smooth(S.edge, 0.25, 0.7)
    alb = g.mix(g.add(g.mul(worn, 0.8), g.mul(scratch, 0.4)), alb, S.col('#7a7c80'))
    rust = g.mul(g.smooth(g.one_minus(S.ao), 0.25, 0.6), g.smooth(S.n(9.0), 0.45, 0.6))
    if key == 'wire' or key == 'iron':
        rust = g.maximum(rust, g.smooth(S.n(6.0), 0.4, 0.55))
    alb = g.mix(rust, alb, g.mix(S.n(40.0), S.col('#4a2412'), S.col('#7a3e1c')))
    rough = g.mixf(rust, g.map_range(S.n(30.0), 0, 1, 0.3, 0.5), 0.85)
    rough = g.mixf(worn, rough, 0.25)
    metal = g.mixf(rust, 0.9, 0.2)
    h = g.sub(g.add(0.5, g.mul(rust, 0.15)), g.mul(scratch, 0.1))
    return dict(albedo=alb, rough=rough, metal=metal, height=h, bump=0.3, dist=0.005)


def r_rust(S, key):
    g = S.g
    alb = g.mix(S.n(12.0, 6, 0.7), S.col('#4a2210'), S.col('#8a4a22'))
    alb = g.mix(g.smooth(S.n(4.0), 0.5, 0.7), alb, S.col('#2a1a12'))
    return dict(albedo=alb, rough=0.85, metal=0.25, height=S.n(30.0, 5, 0.7), bump=0.6, dist=0.01)


def r_burnt(S, key):
    """Burnt-out steel: char, ash, scorched paint blisters, rust."""
    g = S.g
    alb = g.mix(S.n(6.0, 5, 0.6), S.col('#121110'), S.col('#2a2724'))
    ash = g.smooth(S.n(3.5, 5, 0.6), 0.64, 0.74)
    alb = g.mix(g.mul(ash, 0.6), alb, S.col('#5e5a54'))
    rust = g.smooth(g.add(S.n(5.0, 5, 0.6), g.mul(S.edge, 0.2)), 0.7, 0.78)
    rc = g.mix(S.n(25.0), S.col('#3a1c0e'), S.col('#5e2e16'))
    alb = g.mix(g.mul(rust, 0.85), alb, rc)
    blister = g.smooth(g.voronoi(S.P, 40.0), 0.15, 0.0)
    h = g.add(g.mul(blister, 0.3), g.mul(S.n(25.0), 0.4))
    return dict(albedo=alb, rough=0.92, metal=0.15, height=h, bump=0.6, dist=0.01)


def r_concrete(S, key):
    """Board-formed concrete: board marks, air pits, rust and lime stains."""
    g = S.g
    alb = S.tint(S.col('#8a877f'), S.n(1.5, 4, 0.6), 0.8, 1.12)
    boards = g.wave(g.combine(S.U, g.mul(S.V, 1.0), 0.0), 6.5, kind='BANDS', direction='Y', distortion=0.3, detail=1)
    alb = S.tint(alb, boards, 0.93, 1.04)
    grain = S.n(40.0, 5, 0.6, vec=S.UV, stretch=(8, 0.4, 1))
    alb = S.tint(alb, grain, 0.92, 1.06)
    pits = g.smooth(g.voronoi(S.P, 60.0, rand=1.0), 0.08, 0.02)
    pits = g.mul(pits, g.smooth(S.n(5.0), 0.5, 0.65))
    alb = g.mix(g.mul(pits, 0.7), alb, S.col('#3a3834'))
    stain = g.smooth(S.n(2.0, 3, 0.5, stretch=(5, 5, 0.3)), 0.6, 0.78)
    alb = g.mix(g.mul(stain, 0.5), alb, S.col('#5a4a38'))
    h = g.sub(g.add(0.6, g.mul(boards, 0.1)), g.mul(pits, 0.4))
    rough = g.map_range(S.n(10.0), 0, 1, 0.82, 0.97)
    return dict(albedo=alb, rough=rough, metal=0.0, height=h, bump=0.6, dist=0.02)


def r_cobble(S, key):
    g = S.g
    ed = g.voronoi_edge(g.vscale(S.UV, (5.5, 5.5, 1)), 1.0, rand=0.6, dims='2D')
    cid = g.voronoi(g.vscale(S.UV, (5.5, 5.5, 1)), 1.0, out='Color', rand=0.6, dims='2D')
    joint = g.smooth(ed, 0.05, 0.01)
    st = g.mix(g.sep(cid)[0], S.col('#5d5952'), S.col('#7d776c'))
    alb = g.mix(joint, st, S.col('#2a221a'))
    h = g.mixf(joint, g.smooth(ed, 0.0, 0.2), 0.0)
    return dict(albedo=alb, rough=g.mixf(joint, 0.55, 0.9), metal=0.0, height=h, bump=1.0, dist=0.03)


def r_sandbag(S, key):
    """Hessian sacks: coarse fibres, damp and dirty, each bag its own tone."""
    g = S.g
    bag = S.n(0.9, 2, 0.5)
    base = g.mix(bag, S.col('#7d6b4d'), S.col('#98875f'))
    fib = S.n(60.0, 3, 0.7, vec=S.UV, stretch=(1, 6, 1))
    fib2 = S.n(60.0, 3, 0.7, vec=S.UV, stretch=(6, 1, 1))
    weave = g.mul(g.add(fib, fib2), 0.5)
    alb = S.tint(base, weave, 0.8, 1.12)
    mud = g.smooth(S.n(3.0, 4, 0.6), 0.55, 0.7)
    alb = g.mix(g.mul(mud, 0.6), alb, S.col('#4a3c2a'))
    h = g.add(g.mul(weave, 0.5), g.mul(S.n(6.0), 0.3))
    return dict(albedo=alb, rough=0.95, metal=0.0, height=h, bump=0.5, dist=0.01)


def r_canvas(S, key):
    g = S.g
    base = S.col('#5d5a3e') if key == 'canvas' else S.col('#5f6158')
    fib = S.n(80.0, 3, 0.6, vec=S.UV, stretch=(1, 4, 1))
    alb = S.tint(base, fib, 0.9, 1.08)
    alb = S.tint(alb, S.n(2.5, 4, 0.6), 0.8, 1.1)
    stain = g.smooth(S.n(4.0, 4, 0.6), 0.62, 0.75)
    alb = g.mix(g.mul(stain, 0.45), alb, S.col('#2e2c22'))
    return dict(albedo=alb, rough=0.92, metal=0.0, height=g.add(g.mul(fib, 0.4), g.mul(S.n(10.0), 0.2)), bump=0.4, dist=0.01)


def r_cloth(S, key):
    """Wool serge / cotton drill: fibre noise, darker seams and folds (the
    occlusion does most of it), mud splashed on the legs."""
    g = S.g
    base = S.col({'cloth_od': '#5d5b3d', 'cloth_od_dark': '#4a4631', 'cloth_khaki': '#7d7152',
                  'cloth_feldgrau': '#5e6354', 'cloth_feldgrau_dark': '#474b40', 'webbing': '#8a7d5a',
                  'hair': '#2a1f17'}.get(key, '#5d5b3d'))
    twill = S.n(140.0, 2, 0.5, vec=S.P, stretch=(1, 1, 1))
    alb = S.tint(base, twill, 0.92, 1.06)
    alb = S.tint(alb, S.n(4.0, 4, 0.6), 0.86, 1.1)
    worn = g.smooth(S.edge, 0.2, 0.8)
    alb = g.mix(g.mul(worn, 0.35), alb, g.hsv(alb, 0.5, 0.7, 1.35))
    if key == 'webbing':
        bands = g.wave(S.P, 120.0, kind='BANDS', direction='Z', distortion=0.5, detail=1)
        alb = S.tint(alb, bands, 0.9, 1.05)
    h = g.add(g.mul(twill, 0.4), g.mul(S.n(25.0), 0.3))
    return dict(albedo=alb, rough=0.93, metal=0.0, height=h, bump=0.3, dist=0.004)


def r_skin(S, key):
    g = S.g
    base = S.col('#b88a70')
    alb = g.mix(g.smooth(S.n(9.0, 3, 0.5), 0.5, 0.75), base, S.col('#b07060'))
    alb = S.tint(alb, S.n(80.0, 2, 0.5), 0.93, 1.05)
    # dirt and stubble in the hollows
    alb = g.mix(g.mul(g.smooth(S.ao, 0.8, 0.4), 0.35), alb, S.col('#5a4234'))
    return dict(albedo=alb, rough=g.map_range(S.n(30.0), 0, 1, 0.48, 0.65), metal=0.0, height=S.n(160.0, 2), bump=0.15, dist=0.002)


def r_leather(S, key):
    g = S.g
    base = S.col('#3b2a1d') if key == 'leather' else S.col('#1c1a19')
    grain = g.smooth(g.voronoi(S.P, 180.0, rand=1.0), 0.0, 0.5)
    alb = S.tint(base, grain, 0.85, 1.12)
    scuff = g.smooth(g.add(g.mul(S.edge, 0.7), g.mul(S.n(10.0), 0.4)), 0.55, 0.85)
    alb = g.mix(g.mul(scuff, 0.6), alb, g.hsv(base, 0.5, 0.8, 2.2))
    rough = g.mixf(scuff, 0.4 if key == 'leather_black' else 0.5, 0.75)
    return dict(albedo=alb, rough=rough, metal=0.0, height=grain, bump=0.25, dist=0.003)


def r_gun_wood(S, key):
    g = S.g
    v = g.vscale(S.P, (40.0, 3.0, 40.0))
    grain = g.wave(v, 0.5, kind='RINGS', distortion=6.0, detail=4)
    alb = g.mix(grain, S.col('#3e2414'), S.col('#6e4426'))
    alb = S.tint(alb, S.n(20.0), 0.85, 1.1)
    worn = g.smooth(S.edge, 0.2, 0.7)
    alb = g.mix(g.mul(worn, 0.5), alb, S.col('#8a6040'))
    return dict(albedo=alb, rough=g.mixf(worn, 0.4, 0.6), metal=0.0, height=grain, bump=0.15, dist=0.003)


def r_bark(S, key):
    """Bark in vertical plates and furrows (u around the trunk, v along it)."""
    g = S.g
    if key == 'bark_birch':
        lent = g.smooth(S.n(30.0, 3, 0.6, vec=S.UV, stretch=(1, 12, 1)), 0.68, 0.72)
        alb = g.mix(lent, S.tint(S.col('#c9c5ba'), S.n(5.0), 0.85, 1.1), S.col('#24211d'))
        return dict(albedo=alb, rough=0.8, metal=0.0, height=g.one_minus(lent), bump=0.5, dist=0.01)
    # fissures: ridges of stretched fbm (ridged multifractal output does not
    # stay in 0..1, so build the ridge from fbm instead)
    n = S.n(7.0, 6, 0.62, vec=S.UV, stretch=(1, 0.16, 1))
    ridge = g.one_minus(g.mul(g.absolute(g.sub(n, 0.5)), 2.0))
    plates = g.smooth(ridge, 0.45, 0.85)
    base = {'bark_pine': ('#2e221a', '#6a5240'), 'bark_oak': ('#2e2b26', '#6e6658'),
            'deadwood': ('#4a443c', '#8a8274')}[key if key in ('bark_pine', 'bark_oak', 'deadwood') else 'bark_oak']
    alb = g.mix(plates, S.col(base[0]), S.col(base[1]))
    alb = S.tint(alb, S.n(30.0), 0.85, 1.12)
    lichen = g.mul(g.smooth(S.n(6.0, 5, 0.7), 0.64, 0.7), plates)
    alb = g.mix(lichen, alb, S.col('#7d8466'))
    return dict(albedo=alb, rough=0.95, metal=0.0, height=plates, bump=1.2, dist=0.03)


def r_foliage(S, key):
    g = S.g
    base = {'needles': ('#1d2a1e', '#3a4a30'), 'leaves': ('#2c3a1e', '#55602e'),
            'leaves_dry': ('#5a4a2a', '#8a7444'), 'grass': ('#34421f', '#6a6c36'),
            'reed': ('#5a5a34', '#8a8452'), 'moss': ('#33421f', '#5f6e2e'), 'hay': ('#8a7444', '#b49c62')}[key]
    v = S.n(18.0, 4, 0.6)
    alb = g.mix(v, S.col(base[0]), S.col(base[1]))
    alb = S.tint(alb, S.n(2.0), 0.8, 1.15)
    return dict(albedo=alb, rough=0.8 if key != 'moss' else 0.95, metal=0.0, height=S.n(40.0, 3, 0.6), bump=0.5, dist=0.01)


def r_rock(S, key):
    """Granite: crystals, joints, lichen crusts, moss on the tops."""
    g = S.g
    base = S.col('#807c73') if key == 'rock' else S.col('#5a5852')
    alb = S.tint(base, S.n(3.0, 5, 0.6), 0.75, 1.15)
    xtal = g.voronoi(S.P, 90.0, out='Color', rand=1.0)
    alb = S.tint(alb, g.sep(xtal)[0], 0.82, 1.15)
    crk = g.smooth(g.voronoi_edge(S.P, 1.4, rand=1.0), 0.02, 0.0)
    alb = g.mix(g.mul(crk, 0.7), alb, S.col('#2a2826'))
    lichen = g.smooth(S.n(5.0, 6, 0.7), 0.66, 0.7)
    alb = g.mix(g.mul(lichen, 0.6), alb, S.col('#b3b29a'))
    h = g.sub(g.add(g.mul(S.n(4.0, 6, 0.65), 0.6), g.mul(S.n(40.0), 0.15)), g.mul(crk, 0.4))
    return dict(albedo=alb, rough=g.map_range(S.n(20.0), 0, 1, 0.7, 0.92), metal=0.0, height=h, bump=1.0, dist=0.04)


def r_dirt(S, key):
    g = S.g
    alb = g.mix(S.n(6.0, 5, 0.6), S.col('#2e241b'), S.col('#5a4836'))
    stones = g.smooth(g.voronoi(S.P, 25.0, rand=1.0), 0.12, 0.05)
    alb = g.mix(g.mul(stones, 0.7), alb, S.col('#6e675c'))
    return dict(albedo=alb, rough=0.95, metal=0.0, height=g.add(S.n(15.0), g.mul(stones, 0.5)), bump=0.8, dist=0.02)


def r_rubber(S, key):
    g = S.g
    alb = S.tint(S.col('#1c1c1b'), S.n(20.0), 0.8, 1.2)
    return dict(albedo=alb, rough=0.88, metal=0.0, height=S.n(60.0), bump=0.2, dist=0.005)


def r_glass(S, key):
    g = S.g
    alb = S.tint(S.col('#141a1f'), S.n(3.0), 0.8, 1.2)
    grime = g.smooth(g.add(S.edge, g.mul(S.n(6.0), 0.4)), 0.4, 0.9)
    alb = g.mix(g.mul(grime, 0.6), alb, S.col('#4a4a40'))
    rough = g.mixf(grime, g.map_range(S.n(12.0), 0, 1, 0.04, 0.16), 0.7)
    return dict(albedo=alb, rough=rough, metal=0.0, height=0.5, bump=0.0, dist=0.01)


def r_window_lit(S, key):
    """A lit window seen through old glass: warm light behind a curtain."""
    g = S.g
    folds = g.add(0.55, g.mul(g.sin(g.mul(S.U, 38.0)), 0.25))
    folds = g.add(folds, g.mul(S.n(4.0), 0.25))
    light = g.mix(1.0, S.col('#ff9a40'), g.combine(folds, folds, folds), blend='MULTIPLY')
    glow = g.mix(1.0, light, g.combine(2.6, 2.4, 2.2), blend='MULTIPLY')
    return dict(albedo=S.col('#3a2a1a'), rough=0.2, metal=0.0, height=0.5, bump=0.0, dist=0.01, glow=glow)


RECIPES = {
    'stone': r_stone, 'stone_dark': lambda S, k: r_stone(S, k, dark=True),
    'plaster': r_plaster, 'plaster_dirty': r_plaster, 'brick': r_brick,
    'roof_tile': r_roof_tile, 'roof_slate': r_slate, 'thatch': r_thatch,
    'wood': r_wood, 'wood_dark': r_wood, 'wood_old': r_wood,
    'wood_h': r_wood, 'wood_dark_h': r_wood, 'wood_old_h': r_wood,
    'paint_green': r_paint_wood, 'paint_blue': r_paint_wood,
    'paint_red': r_painted_metal, 'paint_white': r_painted_metal, 'marking_white': r_painted_metal,
    'glass': r_glass, 'window_lit': r_window_lit,
    'iron': r_steel, 'rust': r_rust, 'concrete': r_concrete, 'cobble': r_cobble,
    'sandbag': r_sandbag, 'canvas': r_canvas, 'canvas_gray': r_canvas,
    'metal_olive': r_painted_metal, 'metal_gray': r_painted_metal, 'metal_dark': r_steel,
    'rubber': r_rubber, 'burnt': r_burnt, 'wire': r_steel,
    'cloth_od': r_cloth, 'cloth_od_dark': r_cloth, 'cloth_khaki': r_cloth,
    'cloth_feldgrau': r_cloth, 'cloth_feldgrau_dark': r_cloth, 'webbing': r_cloth, 'hair': r_cloth,
    'skin': r_skin, 'leather': r_leather, 'leather_black': r_leather,
    'helmet_od': r_painted_metal, 'helmet_gray': r_painted_metal,
    'gun_wood': r_gun_wood, 'gun_metal': r_steel, 'gun_metal_worn': r_steel,
    'bark_pine': r_bark, 'bark_oak': r_bark, 'bark_birch': r_bark, 'deadwood': r_bark,
    'needles': r_foliage, 'leaves': r_foliage, 'leaves_dry': r_foliage, 'grass': r_foliage,
    'reed': r_foliage, 'moss': r_foliage, 'hay': r_foliage,
    'rock': r_rock, 'rock_dark': r_rock, 'dirt': r_dirt,
}

# weathering profile: (ao strength, cavity dirt, ground splash height m, rain streaks, moss, edge dust)
WEATHER = {
    'building': (1.0, 0.35, 0.7, 0.5, 0.5, 0.2),
    'roof': (0.9, 0.3, 0.0, 0.2, 0.45, 0.1),
    'prop': (1.0, 0.4, 0.45, 0.25, 0.15, 0.3),
    'metal': (1.0, 0.45, 0.5, 0.35, 0.0, 0.25),
    'cloth': (1.0, 0.25, 0.45, 0.0, 0.0, 0.15),
    'skin': (0.7, 0.0, 0.0, 0.0, 0.0, 0.0),
    'weapon': (0.8, 0.2, 0.0, 0.0, 0.0, 0.0),
    'nature': (0.9, 0.2, 0.3, 0.0, 0.3, 0.0),
    'none': (0.6, 0.0, 0.0, 0.0, 0.0, 0.0),
}
PROFILE = {
    'stone': 'building', 'stone_dark': 'building', 'plaster': 'building', 'plaster_dirty': 'building',
    'brick': 'building', 'concrete': 'building', 'cobble': 'building',
    'roof_tile': 'roof', 'roof_slate': 'roof', 'thatch': 'roof',
    'wood': 'prop', 'wood_dark': 'prop', 'wood_old': 'prop', 'wood_h': 'prop', 'wood_dark_h': 'prop', 'wood_old_h': 'prop', 'paint_green': 'prop', 'paint_blue': 'prop',
    'sandbag': 'prop', 'canvas': 'prop', 'canvas_gray': 'prop', 'hay': 'prop',
    'metal_olive': 'metal', 'metal_gray': 'metal', 'metal_dark': 'metal', 'iron': 'metal', 'rust': 'metal',
    'burnt': 'metal', 'wire': 'metal', 'paint_red': 'metal', 'paint_white': 'metal', 'marking_white': 'metal', 'rubber': 'metal',
    'cloth_od': 'cloth', 'cloth_od_dark': 'cloth', 'cloth_khaki': 'cloth', 'cloth_feldgrau': 'cloth',
    'cloth_feldgrau_dark': 'cloth', 'webbing': 'cloth', 'leather': 'cloth', 'leather_black': 'cloth',
    'helmet_od': 'cloth', 'helmet_gray': 'cloth', 'hair': 'skin', 'skin': 'skin',
    'gun_wood': 'weapon', 'gun_metal': 'weapon', 'gun_metal_worn': 'weapon',
    'glass': 'none', 'window_lit': 'none',
}


def finish(S, key, ch):
    """The shared weathering on top of a recipe."""
    g = S.g
    ao_k, cav_k, splash_h, streak_k, moss_k, dust_k = WEATHER[PROFILE.get(key, 'nature')]
    alb = ch['albedo']
    # occlusion (baked into the base colour, as a photoscan would carry it)
    occ = g.map_range(S.ao, 0.0, 1.0, 1.0 - 0.8 * ao_k, 1.0)
    alb = g.mix(1.0, alb, g.combine(occ, occ, occ), blend='MULTIPLY')
    rough = ch['rough']
    if cav_k > 0:
        cav = g.mul(g.smooth(S.ao, 0.75, 0.2), cav_k)
        alb = g.mix(cav, alb, S.col('#2c241b'))
    if splash_h > 0:
        splash = g.mul(g.smooth(S.Z, splash_h, 0.0), g.smooth(S.n(9.0, 4, 0.6), 0.25, 0.6))
        alb = g.mix(g.mul(splash, 0.75), alb, S.col('#3a2e22'))
        rough = g.mixf(g.mul(splash, 0.6), rough, 0.95)
    if streak_k > 0:
        vert = g.smooth(g.absolute(S.up), 0.6, 0.2)
        st = g.smooth(S.n(2.2, 4, 0.55, stretch=(7, 7, 0.28)), 0.52, 0.72)
        alb = g.mix(g.mul(g.mul(st, vert), streak_k), alb, S.col('#2f2a22'))
    if moss_k > 0:
        top = g.smooth(S.up, 0.35, 0.85)
        damp = g.add(g.mul(g.smooth(S.ao, 0.9, 0.5), 0.4), top)
        moss = g.mul(g.smooth(g.add(S.n(3.0, 5, 0.65), g.mul(damp, 0.3)), 0.72, 0.8), moss_k)
        mc = g.mix(S.n(30.0), S.col('#2f3c1c'), S.col('#55622c'))
        alb = g.mix(moss, alb, mc)
        rough = g.mixf(moss, rough, 0.95)
    if dust_k > 0:
        dust = g.mul(g.smooth(S.edge, 0.3, 0.9), dust_k)
        alb = g.mix(dust, alb, g.hsv(alb, 0.5, 0.8, 1.35))
    ch['albedo'] = alb
    ch['rough'] = rough
    return ch


def has_glow(key):
    return key == 'window_lit'


def surface_material(key, ao_img, edge_img, seed=0, bevel=0.012):
    """The procedural surface for a palette key, ready to bake."""
    mat = bpy.data.materials.new('srf_' + key)
    g = Graph(mat)
    S = Ctx(g, ao_img, edge_img, seed, bevel)
    recipe = RECIPES.get(key, r_stone)
    ch = recipe(S, key)
    ch = finish(S, key, ch)
    bev = g.bevel(bevel, samples=8) if bevel > 0 else None
    nrm = g.bump(ch['height'], strength=ch.get('bump', 0.6), distance=ch.get('dist', 0.02), normal=bev)
    bsdf = g.principled(ch['albedo'], ch['rough'], ch['metal'], nrm, ch.get('glow'))
    em = g.node('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    _ROUTES[mat.name] = {'ch': ch, 'bsdf': bsdf, 'em': em, 'out': g.output, 'g': g}
    return mat


def route(mats, channel):
    """Send a channel through emission for an EMIT bake (None: back to the
    full shader, for the normal bake)."""
    for mat in mats:
        r = _ROUTES[mat.name]
        g, em, out = r['g'], r['em'], r['out']
        for l in list(out.inputs['Surface'].links):
            g.nt.links.remove(l)
        for l in list(em.inputs['Color'].links):
            g.nt.links.remove(l)
        if channel is None:
            g.nt.links.new(r['bsdf'].outputs[0], out.inputs['Surface'])
            continue
        val = r['ch'].get(channel)
        if val is None:
            val = {'albedo': (0.5, 0.5, 0.5), 'rough': 0.8, 'metal': 0.0, 'glow': (0, 0, 0)}[channel]
        if isinstance(val, bpy.types.NodeSocket):
            if val.type in ('VALUE', 'INT', 'BOOLEAN'):
                c = g.combine(val, val, val)
                g.nt.links.new(c, em.inputs['Color'])
            else:
                g.nt.links.new(val, em.inputs['Color'])
        else:
            em.inputs['Color'].default_value = (tuple(val) + (1.0,)) if hasattr(val, '__len__') else (val, val, val, 1.0)
        g.nt.links.new(em.outputs[0], out.inputs['Surface'])
