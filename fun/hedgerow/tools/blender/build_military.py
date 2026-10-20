"""Hedgerow — the `military` set (models v3): field fortifications, props,
vehicles and guns, every one baked to PBR textures and weathered (rust and
grime streaks, mud, wet sandbags, formwork concrete; see military_parts).

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python fun/hedgerow/tools/blender/build_military.py [-- node ... | --no-bake | --no-previews | --fast]

All nodes: build, bake (bake.bake_model via military_parts.bake, per-node
atlas size in BAKE, weathering kind in KIND_OF), export
assets/models/military.glb with WebP textures (then run
tools/fix_card_alpha.py on it),
then previews (768²: <node>.png front 3/4, <node>_back.png, <node>_close.png
from 2 m) in tools/blender/previews/military/. Naming nodes after `--` builds
and bakes only those and writes $TMPDIR/military_partial.glb instead (the real
GLB is only written by a full build). `--no-bake` exports untextured palette
materials (fast geometry checks), `--fast` sets bake.FAST (tiny bakes).

Contract: docs/models-brief.md + models-brief-v2.md (set `military`) and
kit.py. Blender space, Z up, metres, front = -Y; one mesh object per node,
base on z = 0 unless noted in notes/military.md. Extra palette keys and
surface recipes are registered at runtime by military_parts.register_surfaces.
"""
import bpy, math, os, random, sys, time

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit                                   # noqa: E402
import military_parts as P                   # noqa: E402
from military_parts import V, trs, Mesh, cbox, ccyl, cbox_minmax   # noqa: E402
from mathutils import Matrix                  # noqa: E402

BUILDERS = {}
EXTRA_VIEWS = {}       # node -> list of (suffix, elevation, azimuth)


def builder(fn):
    BUILDERS[fn.__name__[len('build_'):]] = fn
    return fn


# v3 adds spilled sand, nails and saggier bags, which move the bounding box
# of a few nodes: their origins stay pinned where v2 put them (the build-space
# offset `finish` subtracted then), so colliders and anchors do not move.
PIN = {
    'sandbags': (0.0039, 0.0058, -0.009), 'sandbags_low': (0.0, 0.0112, 0.0),
    'sandbags_curve': (-1.18579, -1.20169, -0.01), 'sandbags_ruined': (-0.0035, -0.1039, 0.0),
    'crate': (0.0, -0.0114, 0.002), 'crate_large': (0.0015, 0.0, 0.0),
}


def courses(n, h, depth0, depth1, pattern, **kw):
    out = []
    for i in range(n):
        f = i / max(1, n - 1)
        c = dict(kind=pattern[i % len(pattern)], h=h, depth=depth0 + (depth1 - depth0) * f)
        c.update(kw)
        out.append(c)
    return out


# ==========================================================================
# Sandbags

@builder
def build_sandbags():
    m = Mesh()
    path = P.StraightPath(3.0)
    P.bag_wall(m, path, courses(6, 0.17, 0.68, 0.58, 'SH'), seed=11)
    P.bag_core(m, path, 0.0, 0.93, 0.44, 0.3, 0.05, 0.95)
    obj = P.join([m], 'sandbags')
    obj = P.join([obj, P.spill(obj, (0.72, -2.0, 0.6), (0, 1, 0), 401)], 'sandbags')
    return P.finish(obj, 'sandbags', [cbox((0, 0, 0.525), (3.0, 0.7, 1.05))],
                    grime=0.22, grime_height=0.5, center=PIN['sandbags'])


@builder
def build_sandbags_low():
    m = Mesh()
    path = P.StraightPath(3.0)
    P.bag_wall(m, path, courses(3, 0.17, 0.68, 0.62, 'SHS'), seed=23)
    P.bag_core(m, path, 0.0, 0.44, 0.44, 0.36, 0.05, 0.95)
    obj = P.join([m], 'sandbags_low')
    obj = P.join([obj, P.spill(obj, (-0.85, -2.0, 0.3), (0, 1, 0), 403, 0.85)], 'sandbags_low')
    return P.finish(obj, 'sandbags_low', [cbox((0, 0, 0.275), (3.0, 0.7, 0.55))],
                    grime=0.22, grime_height=0.4, center=PIN['sandbags_low'])


@builder
def build_sandbags_curve():
    m = Mesh()
    R = 2.05
    path = P.ArcPath((0, 0), R, 180, 270)
    P.bag_wall(m, path, courses(6, 0.17, 0.68, 0.58, 'SH', bag_w=0.4), seed=37)
    P.bag_core(m, path, 0.0, 0.93, 0.44, 0.3, 0.04, 0.96, segs=6)
    obj = P.join([m], 'sandbags_curve')
    a = math.radians(236.0)
    obj = P.join([obj, P.spill(obj, (3.6 * math.cos(a), 3.6 * math.sin(a), 0.62), (-math.cos(a), -math.sin(a), 0), 405)],
                 'sandbags_curve')
    cols = []
    for a in (195, 225, 255):
        r = math.radians(a)
        cols.append(cbox((R * math.cos(r), R * math.sin(r), 0.525),
                         (2 * R * math.sin(math.radians(15)) + 0.12, 0.7, 1.05), a + 90))
    return P.finish(obj, 'sandbags_curve', cols, grime=0.22, grime_height=0.5, center=PIN['sandbags_curve'])


@builder
def build_mg_nest():
    m = Mesh()
    R, depth, h = 1.94, 0.58, 0.18
    a0, a1 = 128.0, 412.0                  # opening of 76 deg centred on +Y (90 deg)
    path = P.ArcPath((0, 0), R, a0, a1)
    notch_half = 13.0

    def notch(f):
        return abs(path.angle(f) - 270.0) < notch_half

    def near_notch(f):
        return abs(path.angle(f) - 270.0) < notch_half + 6

    cs = [dict(kind='S', h=h, depth=depth + 0.04, rows=('b',), banked=True, rings=P.BAG_RINGS3, bag_len=0.66)
          for _ in range(3)]
    cs += [dict(kind='H', h=h, depth=depth + 0.02, bag_w=0.42, ties=False),
           dict(kind='S', h=h, depth=depth, bag_len=0.66, exposed=near_notch),
           dict(kind='H', h=h, depth=depth - 0.04, bag_w=0.42, skip=notch, h_profile=P.BAG_ROUND)]
    P.bag_wall(m, path, cs, seed=53)
    P.bag_core(m, path, 3 * h - 0.04, 5 * h - 0.06, depth - 0.24, depth - 0.3, 0.0, 1.0, segs=16)

    # earth banked against the outside of the lower courses
    rin, top = R - 0.02, 3 * h - 0.02
    ro = R + depth / 2
    prof = [(rin, 0.0), (rin, top), (ro + 0.02, top - 0.04), (ro + 0.11, top * 0.68),
            (ro + 0.19, top * 0.26), (ro + 0.23, 0.0)]
    rng = random.Random(5)
    rings = []
    toe = prof[-1][0]
    ends = [(-10.0, 0.04), (-6.0, 0.3), (-2.5, 0.7)]
    angs = [(a0 + da, sc) for da, sc in ends] + [(a0 + i * (a1 - a0) / 17, 1.0) for i in range(18)] \
        + [(a1 - da, sc) for da, sc in reversed(ends)]
    for a, sc in angs:
        ar = math.radians(a)
        ring = []
        mound = [(-1.0, 0.0), (-0.6, 0.7), (-0.2, 1.0), (0.3, 0.75), (0.65, 0.3), (1.0, 0.0)]
        rc, wid = (rin + toe) / 2, (toe - rin) / 2 * (0.6 + 0.4 * sc)
        for k, (r, z) in enumerate(prof):
            if sc < 1.0:            # beyond the wall ends the bank rounds off into a low mound
                u, v = mound[k]
                r, z = rc + u * wid, v * top * sc * 0.9
            elif k >= 2 and 0 < z < top:
                r += rng.uniform(-0.05, 0.05)
                z += rng.uniform(-0.04, 0.04)
            ring.append(V((r * math.cos(ar), r * math.sin(ar), z)))
        rings.append(ring)
    P.loft(m, rings, 'dirt', closed=True, cap0=True, cap1=True, soft=True, skip=(len(prof) - 1,),
           occ=lambda i, k: 0.35 if k in (0, len(prof) - 1) else 0.0)

    # ammunition: cans by the gun (one open with a belt hanging out), spent
    # cases under the gun, the spare-barrel case leaning on the wall
    rng2 = random.Random(57)
    P.ammo_can(m, trs((-0.62, -1.3, 0.0), (0, 0, 14)))
    P.ammo_can(m, trs((-0.6, -1.31, 0.195), (0, 0, 9)))
    P.ammo_can(m, trs((-0.95, -1.08, 0.0), (0, 0, 38)), lid_open=110)
    P.ammo_can(m, trs((0.62, -1.28, 0.0), (0, 0, -22)))
    P.ammo_can(m, trs((0.9, -0.95, 0.053), (90, 0, -60)))
    P.belt(m, [(-0.97, -1.05, 0.2), (-0.9, -1.2, 0.26), (-0.8, -1.33, 0.17), (-0.74, -1.38, 0.012)])
    P.spent_cases(m, rng2, (0.08, -1.25, 0.0), 0.42, 40)
    P.spent_cases(m, rng2, (0.25, -0.95, 0.0), 0.3, 8)
    bc = trs((1.18, -0.42, 0.048), (0, 0, 75)) @ Matrix.Rotation(math.radians(-62), 4, 'X')
    P.cyl_mesh(m, 0.05, 0.86, bc @ trs((0, 0, 0.43)), 'paint_sand', sides=10)
    for z in (0.08, 0.78):
        P.cyl_mesh(m, 0.056, 0.035, bc @ trs((0, 0, z)), 'paint_sand', sides=10)
    P.cyl_mesh(m, 0.04, 0.03, bc @ trs((0, 0, 0.875)), 'metal_dark', sides=8)
    P.tube_mesh(m, [bc @ V(p) for p in ((0.056, 0, 0.3), (0.085, 0, 0.36), (0.085, 0, 0.5), (0.056, 0, 0.56))],
                0.008, 'metal_dark', sides=4)
    # a bag fallen in from the top course
    P.bag(m, 0.6, 0.36, 0.2, trs((0.95, 0.35, 0.025), (6, 3, 115)), rng2, tie=1)

    obj = P.join([m], 'mg_nest')
    a = math.radians(170.0)                  # v3: a split bag on the inside of the wall
    obj = P.join([obj, P.spill(obj, (0.0, 0.0, 0.42), (math.cos(a), math.sin(a), 0.0), 409, 0.85)], 'mg_nest')
    P.material_by_normal(obj, lambda c, n, k: 'grass' if k == 'dirt' and n.z > 0.8 and c.z > 0.3 else k)

    # the gun rests on the course below the notch
    floor = max(v.co.z for v in obj.data.vertices if abs(v.co.x) < 0.12 and abs(v.co.y + R) < 0.15)
    floor = 0.9232            # v2's value (the v3 bags there sag 7 mm lower): the anchor and colliders stay put
    cols = []
    segs = [(a0, 270 - notch_half, 1.1), (270 - notch_half, 270 + notch_half, floor), (270 + notch_half, a1, 1.1)]
    for s0, s1, ht in segs:
        n = max(1, round((s1 - s0) / 24))
        for i in range(n):
            a = s0 + (i + 0.5) * (s1 - s0) / n
            span = (s1 - s0) / n
            ar = math.radians(a)
            cols.append(cbox((R * math.cos(ar), R * math.sin(ar), ht / 2),
                             (2 * R * math.sin(math.radians(span / 2)) + 0.08, depth + 0.1, ht), a + 90))
    anchors = {'gun': ((0.0, -R, floor), 0.0), 'gunner': ((0.0, -R + 1.0, 0.0), 0.0)}
    CLOSE['mg_nest'] = ((0.0, 0.25, -0.2), 168.0, 32.0)
    return P.finish(obj, 'mg_nest', cols, anchors, grime=0.25, grime_height=0.6, center='xy')


# ==========================================================================
# Bunker

@builder
def build_bunker():
    W2, FY, BY, H = 2.9, -2.5, 2.5, 2.7          # half width, front/back faces, height
    IX, IY0, IY1, FLOOR, CEIL = 2.2, -1.6, 1.8, 0.05, 2.05
    DX0, DX1, DTOP = 0.55, 1.65, 1.95           # rear doorway
    CAP = 0.38                                   # roof slab thickness (overhanging cap)

    def outline(cf, cb, grow=0.0):
        w, f, bk = W2 + grow, FY - grow, BY + grow
        return [(-w + cf, f), (w - cf, f), (w, f + cf), (w, bk - cb), (w - cb, bk), (-w + cb, bk), (-w, bk - cb),
                (-w, f + cf)]
    shell = kit.extrude_xy(outline(0.45, 0.15), H - CAP + 0.02, mat='concrete')
    kit.bevel(shell, 0.035, 1, 30)
    cap = kit.extrude_xy(outline(0.5, 0.2, 0.14), CAP, mat='concrete', z0=H - CAP)
    kit.bevel(cap, 0.05, 1, 30)
    inner = kit.box((2 * IX, IY1 - IY0, CEIL - FLOOR), loc=(0, (IY0 + IY1) / 2, (FLOOR + CEIL) / 2), mat='concrete')
    kit.cut(shell, inner)
    door = kit.box((DX1 - DX0, 1.2, DTOP - FLOOR), loc=((DX0 + DX1) / 2, (IY1 + BY) / 2, (FLOOR + DTOP) / 2),
                   mat='concrete')
    kit.cut(shell, door)
    # splayed embrasure: narrow inside, wide outside, plus a stepped outer recess
    yi, yo = IY0 + 0.15, FY - 0.15
    def at(y, a, b):            # interpolate the splay between the inner and outer face
        t = (y - IY0) / (FY - IY0)
        return a + (b - a) * t
    pts = []
    for y in (yi, yo):
        hx = at(y, 0.6, 1.0)
        z0, z1 = at(y, 1.2, 1.12), at(y, 1.55, 1.62)
        pts += [(-hx, y, z0), (hx, y, z0), (hx, y, z1), (-hx, y, z1)]
    kit.cut(shell, P.hull_object(pts, 'concrete'))
    kit.cut(shell, kit.box((2.5, 0.3, 0.72), loc=(0, FY - 0.03, 1.37), mat='concrete'))
    rng = random.Random(71)
    # battle damage: chips round the embrasure, bullet pocks, a shell hit
    # that tore the front-left corner of the roof slab open to the rebar
    def chips(points_list):
        objs_ = [P.hull_object(pl, 'concrete') for pl in points_list]
        return kit.join(objs_, 'chips') if len(objs_) > 1 else objs_[0]

    def blob(c, r, depth_axis, depth, n=7):
        c = V(c)
        pts = []
        for _ in range(n):
            a = rng.uniform(0, 2 * math.pi)
            rr = r * rng.uniform(0.5, 1.0)
            off = V((math.cos(a) * rr, 0, math.sin(a) * rr)) if depth_axis == 'Y' else V((0, math.cos(a) * rr, math.sin(a) * rr))
            pts.append(c + off)
        d = V((0, depth, 0)) if depth_axis == 'Y' else V((depth, 0, 0))
        pts.append(c + d)
        pts.append(c - d * 0.5)
        return pts
    pl = []
    for x, z in ((-1.6, 0.7), (1.55, 1.95), (0.5, 0.55)):
        pl.append(blob((x, FY, z), rng.uniform(0.06, 0.1), 'Y', 0.05))
    for _ in range(16):
        pl.append(blob((rng.uniform(-2.3, 2.3), FY, rng.uniform(0.4, 2.2)), rng.uniform(0.02, 0.04), 'Y', 0.03, n=5))
    for _ in range(6):
        pl.append(blob((-W2, rng.uniform(-2.2, -1.0), rng.uniform(1.7, 2.25)), rng.uniform(0.02, 0.04), 'X', -0.03, n=5))
    kit.cut(shell, chips(pl))
    hit_c = V((-2.78, -2.72, H - 0.02))
    hit = P.hull_object([hit_c + V((rng.uniform(-0.55, 0.55), rng.uniform(-0.5, 0.5), rng.uniform(-0.45, 0.3)))
                         for _ in range(16)], 'concrete')
    kit.cut(cap, hit, keep_cutter=True)
    kit.cut(shell, hit)
    parts = [shell, cap]
    m = Mesh()
    for k in range(6):          # bent rebar in the broken corner
        if k < 3:
            y, z = -2.62 + k * 0.13, H - 0.08 - (k % 2) * 0.17
            pts = [(-2.2, y, z), (-2.75, y, z), (-2.95, y + 0.03, z - 0.06 - 0.05 * k), (-3.05, y + 0.08, z - 0.22)]
        else:
            x, z = -2.62 + (k - 3) * 0.13, H - 0.12 - (k % 2) * 0.14
            pts = [(x, -2.1, z), (x, -2.75, z), (x - 0.04, -2.95, z - 0.08), (x - 0.12, -3.0, z - 0.25 + 0.04 * k)]
        P.tube_mesh(m, pts, 0.008, 'rust', sides=5)
    # roof sod: a lumpy earth mound with grass, its lip hanging over the roof edge
    from mathutils import noise as mnoise
    nx, ny = 12, 10
    x0, x1, y0, y1 = -W2 - 0.1, W2 + 0.1, FY + 0.25, BY - 0.05
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            y = y0 + (y1 - y0) * j / ny
            edge = i in (0, nx) or j in (0, ny)
            dome = 0.42 * (1 - (x / 3.3) ** 2) * (1 - ((y - 0.25) / 2.9) ** 2)
            lump = 0.09 * mnoise.noise(V((x * 0.8, y * 0.8, 3.7)))
            z = H + (0.03 if edge else 0.1 + dome + lump)
            if edge:
                x += rng.uniform(-0.05, 0.05) if j in (0, ny) else 0.0
                y += rng.uniform(-0.08, 0.08) if i in (0, nx) else 0.0
            row.append(m.vert((x, y, z), 0.0))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            m.face((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]), 'grass', True)
    loop = [grid[0][i] for i in range(nx + 1)] + [grid[j][nx] for j in range(1, ny + 1)] + \
        [grid[ny][i] for i in range(nx - 1, -1, -1)] + [grid[j][0] for j in range(ny - 1, 0, -1)]
    lower = []
    for vi in loop:
        p = m.v[vi]
        dx = 0.05 * (1 if p.x > W2 else -1 if p.x < -W2 else 0)
        dy = 0.05 * (1 if p.y > BY else -1 if p.y < y0 + 0.01 else 0)
        lower.append(m.vert((p.x + dx, p.y + dy, H - 0.06 + rng.uniform(-0.04, 0.02)), 0.35))
    for k in range(len(loop)):
        k1 = (k + 1) % len(loop)
        m.face((lower[k], lower[k1], loop[k1], loop[k]), 'dirt', True)
    # side berms: earth piled against the side walls, tapering round the corners
    prof = [(0.0, 0.0), (0.0, 1.75), (0.12, 1.71), (0.26, 1.58), (0.4, 1.38), (0.54, 1.13), (0.68, 0.85),
            (0.81, 0.55), (0.92, 0.27), (1.0, 0.08), (1.04, 0.0)]
    toe = prof[-1][0]
    for side in (1, -1):
        rings = []
        ys = [(FY - 0.15, 0.05), (FY + 0.1, 0.45), (FY + 0.4, 0.85)] + \
             [(FY + 0.4 + (BY - FY - 0.6) * t / 12, 1.0) for t in range(1, 12)] + \
             [(BY - 0.2, 0.85), (BY + 0.15, 0.45), (BY + 0.4, 0.05)]
        for y, sc in ys:
            ring = []
            for k, (u, z) in enumerate(prof):
                if sc < 1.0:
                    u, z = toe + (u - toe) * sc, z * sc
                if k == 1:
                    z += 0.18 * mnoise.noise(V((y * 1.3, side * 2.0, 0.5))) * sc
                if 1 < k < len(prof) - 1:
                    u += 0.14 * mnoise.noise(V((side * 3.1 + u * 2.2, y * 2.0, z * 2.2))) * sc
                    z += 0.12 * mnoise.noise(V((y * 2.3, u * 2.6, side * 5.0))) * sc
                ring.append(V((side * (W2 - 0.02 + u), y, z)))
            if side < 0:
                ring.reverse()
            rings.append(ring)
        P.loft(m, rings, 'dirt', closed=True, cap0=True, cap1=True, soft=True, skip=(len(prof) - 1,),
               occ=lambda i, k, side=side: 0.3 if (k == 0 if side > 0 else k == len(prof) - 1) else 0.0)
    # armoured embrasure plate set in the stepped recess, bolted
    plate = kit.box((2.3, 0.06, 0.64), loc=(0, FY + 0.115, 1.37), mat='metal_dark', bevel=0.012)
    kit.cut(plate, kit.box((1.5, 0.3, 0.22), loc=(0, FY + 0.1, 1.37), mat='metal_dark'))
    parts.append(plate)
    P.nails(m, [(x, FY + 0.085, z) for x in (-1.08, -0.54, 0.0, 0.54, 1.08) for z in (1.11, 1.63)]
            + [(x, FY + 0.085, 1.37) for x in (-1.08, 1.08)], (0, -1, 0), r=0.018, mat='metal_dark')
    # vent pipe through the roof
    parts.append(kit.cyl(0.07, 0.75, loc=(-1.3, 0.9, H + 0.2), mat='metal_dark', verts=8))
    parts.append(kit.cyl(0.11, 0.06, loc=(-1.3, 0.9, H + 0.6), mat='metal_dark', verts=8))
    # steel door in an angle-iron frame, swung open against the right wing wall
    DW = DX1 - DX0
    for (sx, sz, x, z) in ((0.06, DTOP - FLOOR + 0.06, DX0 - 0.03, (FLOOR + DTOP) / 2),
                           (0.06, DTOP - FLOOR + 0.06, DX1 + 0.03, (FLOOR + DTOP) / 2),
                           (DW + 0.12, 0.06, (DX0 + DX1) / 2, DTOP + 0.03)):
        P.bbox_mesh(m, (sx, 0.05, sz), trs((x, BY + 0.02, z)), 'metal_dark', 0.008)
    leaf_m = trs((DX1 + 0.05, BY + 0.06, FLOOR + 0.02)) @ Matrix.Rotation(math.radians(-92), 4, 'Z')
    P.bbox_mesh(m, (DW - 0.04, 0.05, DTOP - FLOOR - 0.04), leaf_m @ trs((-(DW - 0.04) / 2, 0, (DTOP - FLOOR) / 2)),
                'metal_dark', 0.01)
    for z in (0.35, 1.0, 1.65):
        P.bbox_mesh(m, (DW - 0.16, 0.02, 0.05), leaf_m @ trs((-(DW - 0.04) / 2, -0.03, z)), 'metal_dark', 0.005)
    for z in (0.4, 1.55):
        P.cyl_mesh(m, 0.03, 0.14, trs((DX1 + 0.05, BY + 0.05, z)), 'metal_dark', sides=6)
    P.tube_mesh(m, [leaf_m @ V(p) for p in ((-0.85, -0.03, 0.95), (-0.85, -0.09, 0.97), (-0.85, -0.09, 1.11),
                                            (-0.85, -0.03, 1.13))], 0.012, 'metal_dark', sides=4)
    # entrance cutting: concrete wing walls holding the earth back
    for x in (DX0 - 0.42, DX1 + 0.42):
        wing = kit.extrude_profile([(BY - 0.05, 0.0), (BY + 1.45, 0.0), (BY + 1.45, 0.55), (BY - 0.05, 1.75)], 0.3,
                                   axis='X', mat='concrete')
        wing.location = (x, 0, 0)
        kit.apply_transform(wing)
        kit.bevel(wing, 0.03, 1, 30)
        parts.append(wing)
    # interior: a plank bench on the left wall, a shelf under the slit,
    # ammunition, a field telephone, a bulkhead lamp on the ceiling
    P.box_mesh(m, (0.35, 2.0, 0.05), trs((-IX + 0.2, 0.2, 0.45)), 'wood')
    for y in (-0.6, 1.0):
        P.box_mesh(m, (0.3, 0.06, 0.4), trs((-IX + 0.2, y, 0.25)), 'wood', occ_bottom=0.4)
    P.box_mesh(m, (1.3, 0.3, 0.06), trs((0, IY0 + 0.15, 1.12)), 'wood')
    for y in (IY0 + 0.15,):
        for x in (-0.55, 0.55):
            P.box_mesh(m, (0.05, 0.25, 0.3), trs((x, y, 0.94)), 'wood')
    P.ammo_can(m, trs((0.9, IY0 + 0.25, FLOOR), (0, 0, 8)))
    P.ammo_can(m, trs((1.25, IY0 + 0.3, FLOOR), (0, 0, -15)))
    P.ammo_can(m, trs((0.95, IY0 + 0.26, FLOOR + 0.195), (0, 0, 3)))
    P.field_telephone(m, trs((-IX + 0.2, 0.6, 0.475), (0, 0, 80)))
    lamp = V((0.0, 0.1, CEIL))
    P.cyl_mesh(m, 0.1, 0.03, trs(lamp + V((0, 0, -0.015))), 'metal_dark', sides=10)
    P.cyl_mesh(m, 0.075, 0.1, trs(lamp + V((0, 0, -0.08))), 'window_lit', sides=10, r2=0.085)
    for a in range(4):
        aa = math.radians(45 + 90 * a)
        P.tube_mesh(m, [lamp + V((0.09 * math.cos(aa), 0.09 * math.sin(aa), -0.03)),
                        lamp + V((0.095 * math.cos(aa), 0.095 * math.sin(aa), -0.13)),
                        lamp + V((0.0, 0.0, -0.15))], 0.006, 'metal_dark', sides=4)
    P.tube_mesh(m, [lamp + V((0, 0, -0.01)), lamp + V((0.0, 1.6, -0.01)), lamp + V((-2.18, 1.6, -0.01))], 0.008,
                'rubber', sides=4)
    parts.append(m)
    obj = P.join(parts, 'bunker')

    def paint(c, n, k):
        if k == 'dirt' and n.z > 0.2 and c.z > 0.55:
            return 'grass'
        if k == 'concrete':
            inside = abs(c.x) < IX + 0.03 and IY0 - 0.03 < c.y < IY1 + 0.03 and c.z < CEIL + 0.03
            tunnel = abs(c.x) < 1.05 and FY - 0.2 < c.y < IY0 + 0.05 and 1.05 < c.z < 1.75
            door = DX0 - 0.02 < c.x < DX1 + 0.02 and c.y > IY1 - 0.03 and c.z < DTOP + 0.03
            if not (inside or tunnel or door):
                return 'concrete_camo'
        return k
    P.material_by_normal(obj, paint)

    cols = [
        cbox_minmax((-W2, FY, 0), (W2, IY0, 1.2)),                 # front wall below the slit
        cbox_minmax((-W2, FY - 0.35, 1.55), (W2, IY0, H)),         # above the slit (with the brow)
        cbox_minmax((-W2, FY, 1.2), (-0.6, IY0, 1.55)),
        cbox_minmax((0.6, FY, 1.2), (W2, IY0, 1.55)),
        cbox_minmax((-W2 - 0.4, IY0, 0), (-IX, IY1, H)),           # side walls + the steep part of the berms
        cbox_minmax((IX, IY0, 0), (W2 + 0.4, IY1, H)),
        cbox_minmax((-W2 - 0.95, FY, 0), (-W2 - 0.4, BY, 0.6)),     # berm toes (low)
        cbox_minmax((W2 + 0.4, FY, 0), (W2 + 0.95, BY, 0.6)),
        cbox_minmax((-W2, IY1, 0), (DX0, BY, H)),                  # back wall either side of the door
        cbox_minmax((DX1, IY1, 0), (W2, BY, H)),
        cbox_minmax((DX0, IY1, DTOP), (DX1, BY, H)),               # lintel
        cbox_minmax((-W2, FY - 0.35, CEIL), (W2, BY, H + 0.25)),   # roof slab + sod
        cbox_minmax((DX0 - 0.57, BY, 0), (DX0 - 0.27, BY + 1.45, 1.2)),   # entrance wing walls
        cbox_minmax((DX1 + 0.27, BY, 0), (DX1 + 0.57, BY + 1.45, 1.2)),
    ]
    anchors = {'gunner': ((0.0, IY0 + 0.55, FLOOR), 0.0),
               'slit': (0.0, FY, 1.375),
               'door': (((DX0 + DX1) / 2, BY + 0.7, 0.0), 180.0),
               'lamp': (0.0, 0.1, CEIL - 0.12)}
    CLOSE['bunker'] = ((-2.2, -0.15, 0.95), -38.0, 14.0)
    return P.finish(obj, 'bunker', cols, anchors, grime=0.4, grime_height=1.0, center='xy')


# ==========================================================================
# Trench pieces and obstacles

@builder
def build_trench_wall():
    m = Mesh()
    rng = random.Random(81)
    z = 0.0
    gap_course = 1                  # a split board at the foot, earth spilling through
    for c in range(8):
        hgt = rng.uniform(0.195, 0.215)
        th = rng.uniform(0.035, 0.045)
        split = rng.uniform(-0.04, 0.04)
        for j, (xa, xb) in enumerate(((-2.0 + rng.uniform(-0.04, 0.02), split), (split, 2.0 + rng.uniform(-0.02, 0.04)))):
            if c == gap_course and j == 1:
                # broken board: two short pieces, the end of one split off and sagging
                P.bbox_mesh(m, (0.9, th, hgt - 0.014), trs((split + 0.45, 0.02, z + hgt / 2), (0, 0, 1.0)),
                            'wood_h', 0.006, occ_bottom=0.25)
                P.bbox_mesh(m, (0.55, th, hgt - 0.03), trs((1.72, -0.02, z + hgt / 2 - 0.03), (0, -7, -9)),
                            'wood_h', 0.006, occ_bottom=0.25)
                continue
            P.bbox_mesh(m, (xb - xa - 0.008, th, hgt - 0.014),
                        trs(((xa + xb) / 2, 0.02 + rng.uniform(-0.008, 0.008), z + hgt / 2),
                            (rng.uniform(-0.8, 0.8), 0, rng.uniform(-0.3, 0.3))), 'wood_h', 0.006, occ_bottom=0.25)
        z += hgt
    # earth spilled through the gap
    pile = [V((1.2 + 0.42 * math.cos(a), -0.02 - 0.3 * abs(math.sin(a)) * (1 if math.sin(a) < 0 else 0.1),
               0.0)) for a in [i * math.pi / 6 for i in range(12)]]
    top = [V((1.25, -0.08, 0.28)), V((1.15, 0.02, 0.33)), V((1.35, 0.02, 0.3))]
    parts = [m, P.hull_object(pile + top, 'sand_spill')]
    for x in (-1.86, 0.0, 1.86):
        top_z = rng.uniform(1.72, 1.8)
        post = kit.cyl(0.068, top_z, loc=(x, -0.075, top_z / 2 + 0.002), rot=(rng.uniform(-1.0, 1.0), 0, 0),
                       mat='wood_dark', verts=10)
        parts.append(post)
        srng = random.Random(int(x * 100) + 811)          # v3: drying splits in the end grain
        for _ in range(2):
            a = srng.uniform(0, math.pi)
            P.split_end(m, (x, -0.075, top_z + 0.002), (0, 0, 1), (math.cos(a), math.sin(a), 0), 0.136,
                        srng.uniform(0.1, 0.22), srng)
        # anchor wire twisted round the post top, back over the parapet
        P.tube_mesh(m, [(x - 0.07, -0.075, top_z - 0.12), (x, -0.15, top_z - 0.1), (x + 0.07, -0.075, top_z - 0.12),
                        (x, 0.0, top_z - 0.1), (x, 0.07, top_z - 0.05), (x + 0.02, 0.14, top_z - 0.08)],
                    0.004, 'wire', sides=3)
        # wire binding the boards to the post
        for zb in (0.4, 1.05):
            P.tube_mesh(m, [(x - 0.075, -0.075, zb), (x - 0.06, 0.05, zb), (x + 0.06, 0.05, zb), (x + 0.075, -0.075, zb),
                            (x, -0.15, zb), (x - 0.075, -0.075, zb)], 0.003, 'wire', sides=3, caps=False)
    obj = P.join(parts, 'trench_wall')
    return P.finish(obj, 'trench_wall', [cbox((0, -0.05, 0.85), (4.0, 0.22, 1.7))], grime=0.35, grime_height=0.9)


@builder
def build_duckboard():
    m = Mesh()
    rng = random.Random(83)
    for x in (-0.3, 0.3):
        P.box_mesh(m, (0.07, 3.0, 0.07), trs((x, 0, 0.035), (0, 0, rng.uniform(-0.4, 0.4))), 'wood_old_h',
                   occ_bottom=0.4)
    n = 19
    for i in range(n):
        y = -1.43 + i * (2.86 / (n - 1))
        if i == 12:
            P.bbox_mesh(m, (0.42, 0.09, 0.028), trs((-0.18, y, 0.084), (0, 2.5, rng.uniform(-6, -3))), 'wood_old_h', 0.004)
            continue
        P.bbox_mesh(m, (0.8 + rng.uniform(-0.04, 0.02), 0.09 + rng.uniform(-0.01, 0.01), 0.028),
                    trs((rng.uniform(-0.02, 0.02), y + rng.uniform(-0.01, 0.01), 0.084 + rng.uniform(-0.002, 0.004)),
                        (rng.uniform(-0.5, 0.5), 0, rng.uniform(-2.5, 2.5))), 'wood_old_h', 0.005, occ_bottom=0.2)
    obj = P.join([m], 'duckboard')
    return P.finish(obj, 'duckboard', [cbox((0, 0, 0.05), (0.8, 3.0, 0.1))], grime=0.3, grime_height=0.12)


@builder
def build_barbed_wire():
    m = Mesh()
    rng = random.Random(91)
    frames = (-1.8, 0.0, 1.8)
    for x in frames:
        lean = rng.uniform(-0.03, 0.03)
        for sgn in (-1, 1):
            a, b = V((x + sgn * 0.04, sgn * 0.48, 0.03)), V((x + sgn * 0.04 - sgn * lean, -sgn * 0.43, 1.08))
            d = b - a
            yaw = 0.0
            pitch = math.degrees(math.atan2(d.z, d.y))
            P.bbox_mesh(m, (0.065, d.length, 0.065), trs((a + b) / 2, (pitch, 0, yaw)), 'wood_old', 0.008)
            srng = random.Random(int(x * 10) * 7 + sgn + 913)    # v3: split end grain
            P.split_end(m, b, d, (1, 0, 0), 0.066, srng.uniform(0.08, 0.15), srng)
        P.cyl_mesh(m, 0.012, 0.16, trs((x, 0.0, 0.55), (0, 90, 0)), 'metal_dark', sides=6)
    P.bbox_mesh(m, (4.0, 0.07, 0.07), trs((0, 0, 0.6), (0, 0.3, 0)), 'wood_old', 0.008)

    def barb(p, tang, size=0.018):
        """Two short wires wrapped round the strand, four points sticking out."""
        t = V(tang).normalized()
        a = t.cross(V((0, 0, 1)))
        if a.length < 0.1:
            a = t.cross(V((1, 0, 0)))
        a.normalize()
        b = t.cross(a)
        q = V(p)
        for d1, d2 in ((a, b), (b, -a)):
            ang = rng.uniform(0, math.pi)
            u = d1 * math.cos(ang) + d2 * math.sin(ang)
            P.tube_mesh(m, [q + u * size + t * 0.004, q + t * 0.002, q - u * size - t * 0.004], 0.0022, 'wire',
                        sides=3, caps=False)

    # concertina coil along X, through the frames
    pts = []
    loops, per = 18, 8
    for i in range(loops * per + 1):
        t = i / per
        a = 2 * math.pi * t
        x = -1.98 + 3.96 * i / (loops * per)
        r = 0.4 + 0.04 * math.sin(t * 1.7) + rng.uniform(-0.015, 0.015)
        pts.append(V((x + 0.05 * math.sin(a), r * math.cos(a), 0.5 + r * math.sin(a) + 0.02 * math.sin(t * 0.9))))
    P.tube_mesh(m, pts, 0.0055, 'wire', sides=3)
    for i in range(1, len(pts) - 1, 3):
        barb(pts[i], pts[i + 1] - pts[i - 1])
    # straight strands (two twisted wires) strung along the frame arms
    for y, z in ((-0.42, 1.06), (0.42, 1.06), (-0.27, 0.3), (0.27, 0.3)):
        strand = []
        for k in range(25):
            x = -1.9 + 3.8 * k / 24
            sag = 0.05 * math.sin(math.pi * ((x + 1.8) % 1.8) / 1.8) if -1.8 < x < 1.8 else 0.0
            strand.append(V((x, y + rng.uniform(-0.005, 0.005), z - sag)))
        for ph in (0.0, math.pi):
            tw = [p + V((0, 0.004 * math.cos(ph + k * 2.1), 0.004 * math.sin(ph + k * 2.1))) for k, p in enumerate(strand)]
            P.tube_mesh(m, tw, 0.0035, 'wire', sides=3)
        for k in range(1, 26):
            u = k / 26 * 24
            i0 = int(u)
            f = u - i0
            p = strand[i0].lerp(strand[min(i0 + 1, 24)], f)
            barb(p, strand[min(i0 + 1, 24)] - strand[i0], 0.016)
    obj = P.join([m], 'barbed_wire')
    return P.finish(obj, 'barbed_wire', [cbox((0, 0, 0.55), (4.0, 1.0, 1.1), kind='wire')],
                    grime=0.15, grime_height=0.4)


@builder
def build_hedgehog():
    L, leg, t = 2.25, 0.12, 0.013
    r_ = 0.006
    prof = [(0, 0), (leg - r_, 0), (leg, r_), (leg, t), (t + r_, t), (t, t + r_), (t, leg), (r_, leg), (0, leg - r_), (0, r_)]
    prof = [(0, 0), (leg, 0), (leg, t), (t + 0.006, t), (t, t + 0.006), (t, leg), (0, leg)]
    beams = []
    for rot in ((0, 0, 0), (0, 90, 0), (-90, 0, 0)):
        bm_ = Mesh()
        rings = [[V((x - 0.03, y - 0.03, -L / 2 + L * i / 6)) for x, y in prof] for i in range(7)]
        P.loft(bm_, rings, 'iron', closed=True, cap0=True, cap1=True)
        b = bm_.build('beam')
        P.transform(b, trs((0, 0, 0), rot))
        beams.append(b)
    m = Mesh()
    # gusset plates in the three planes of the joint, bolted
    for rot, bolts in (((0, 0, 0), ((0.07, 0.07), (-0.07, 0.07), (0.07, -0.07))),
                       ((90, 0, 0), ((0.07, 0.07), (-0.07, 0.07), (0.07, -0.07))),
                       ((0, 90, 0), ((0.07, 0.07), (-0.07, 0.07), (0.07, -0.07)))):
        M_ = trs((0, 0, 0), rot)
        P.bbox_mesh(m, (0.28, 0.28, 0.012), M_ @ trs((0.03, 0.03, 0.0)), 'iron', 0.004)
        for (bx, by) in bolts:
            for side in (1, -1):
                P.cyl_mesh(m, 0.014, 0.018, M_ @ trs((bx, by, side * 0.014), (0, 0, 30)), 'metal_dark', sides=6)
    # end plates on the beam ends
    for rot in ((0, 0, 0), (0, 90, 0), (-90, 0, 0)):
        M_ = trs((0, 0, 0), rot)
        for side in (-1, 1):
            P.box_mesh(m, (0.13, 0.13, 0.01), M_ @ trs((0.035, 0.035, side * (L / 2 + 0.005))), 'iron')
    obj = P.join(beams + [m], 'hedgehog')
    q = V((1, 1, 1)).normalized().rotation_difference(V((0, 0, 1)))
    P.transform(obj, Matrix.Rotation(math.radians(55), 4, 'Z') @ q.to_matrix().to_4x4())
    P.ground(obj)
    return P.finish(obj, 'hedgehog', [ccyl((0, 0, 0), 0.55, 1.35)], grime=0.2, grime_height=0.5)


@builder
def build_barrier():
    parts = []
    m = Mesh()
    rng = random.Random(97)
    PX, RX, ZB = -2.35, 2.5, 1.04
    for x in (PX, RX):
        P.bbox_mesh(m, (0.38, 0.38, 0.12), trs((x, 0, 0.06)), 'concrete', 0.02, occ_bottom=0.3)
    pivot = kit.box((0.18, 0.18, 1.06), loc=(PX, 0, 0.12 + 0.53), mat='paint_white', bevel=0.015)
    rest = kit.box((0.14, 0.14, 0.82), loc=(RX, 0, 0.12 + 0.41), mat='paint_white', bevel=0.012)
    for o in (pivot, rest):
        P.stripes(o, (0, 0, 1), 0.25, ['paint_red', 'paint_white'], lambda f: abs(f.normal.z) < 0.5, offset=0.12)
    parts += [pivot, rest]
    for x, w, z in ((PX, 0.2, 1.18), (RX, 0.16, 0.94)):
        parts.append(kit.cyl(w * 0.72, 0.06, loc=(x, 0, z + 0.03), rot=(0, 0, 45), mat='paint_red', verts=4,
                             radius2=0.01))
    # pivot: bearing plates with bolts, the axle; rest post: a fork
    for y in (-0.088, 0.088):
        P.bbox_mesh(m, (0.22, 0.016, 0.3), trs((PX, y, ZB - 0.02)), 'metal_dark', 0.004)
        P.box_mesh(m, (0.1, 0.012, 0.16), trs((RX, y * 0.8, 0.96)), 'metal_dark')
        for zz in (ZB - 0.12, ZB + 0.08):
            P.cyl_mesh(m, 0.012, 0.03, trs((PX + 0.06, y * 1.12, zz), (90, 0, 0)), 'metal_dark', sides=6)
    parts.append(kit.cyl(0.02, 0.24, loc=(PX, 0, ZB), rot=(90, 0, 0), mat='metal_dark', verts=8))
    # the boom: octagonal, tapering, red/white bands from the pivot to the tip
    x0, xp, x1 = -2.85, PX, 2.75
    xs = [x0, xp - 0.12] + [xp - 0.12 + 0.5 * k for k in range(1, 11)] + [x1]
    xs = sorted(set(round(x, 3) for x in xs if x <= x1))

    def zb(x):
        return ZB + (x - xp) * (0.98 + 0.045 - ZB) / (RX - xp) if x > xp else ZB
    ids = []
    for x in xs:
        r = 0.07 - 0.022 * max(0.0, (x - xp) / (x1 - xp))
        ring = [V((x, r * math.cos(a), zb(x) + r * math.sin(a))) for a in (2 * math.pi * k / 8 for k in range(8))]
        ids.append([m.vert(p) for p in ring])
    for i in range(len(ids) - 1):
        xm = (xs[i] + xs[i + 1]) / 2
        mat = 'wood_dark' if xm < xp - 0.12 else ('paint_red' if int((xm - xp + 0.12) / 0.5) % 2 == 0 else 'paint_white')
        a, b = ids[i], ids[i + 1]
        for k in range(8):
            k1 = (k + 1) % 8
            m.face((a[k], a[k1], b[k1], b[k]), mat)
    m.face(list(reversed(ids[0])), 'wood_dark')
    m.face(ids[-1], 'paint_white')
    P.cyl_mesh(m, 0.052, 0.06, trs((x1 - 0.02, 0, zb(x1)), (0, 90, 0)), 'metal_dark', sides=8)
    for x in (xp - 0.1, xp + 0.12):
        P.cyl_mesh(m, 0.074, 0.03, trs((x, 0, zb(x)), (0, 90, 0)), 'metal_dark', sides=8)
    # the round stop sign hung from the boom (no lettering)
    sx = 0.3
    for dx in (-0.08, 0.08):
        P.tube_mesh(m, [(sx + dx, 0, zb(sx + dx) - 0.06), (sx + dx * 0.7, 0, zb(sx) - 0.2)], 0.004, 'metal_dark', sides=3)
    disc = trs((sx, 0, zb(sx) - 0.42), (90, 0, 0))
    P.cyl_mesh(m, 0.23, 0.012, disc, 'paint_red', sides=20, soft=False)
    P.cyl_mesh(m, 0.17, 0.016, disc, 'paint_white', sides=20, soft=False)
    # counterweight: a plank box of stones under the short end
    cw = V((x0 + 0.2, 0, ZB - 0.2))
    for dy in (-0.13, 0.13):
        P.bbox_mesh(m, (0.36, 0.03, 0.24), trs(cw + V((0, dy, 0))), 'wood_dark_h', 0.005)
    for dx in (-0.165, 0.165):
        P.bbox_mesh(m, (0.03, 0.29, 0.24), trs(cw + V((dx, 0, 0))), 'wood_dark', 0.005)
    P.box_mesh(m, (0.36, 0.29, 0.02), trs(cw + V((0, 0, -0.12))), 'wood_dark')
    for i in range(7):
        c = cw + V((rng.uniform(-0.11, 0.11), rng.uniform(-0.08, 0.08), rng.uniform(0.02, 0.11)))
        stone = P.hull_object([c + V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 0.6))) * 0.06
                               for _ in range(9)], 'stone')
        parts.append(stone)
    for dy in (-0.1, 0.1):
        P.tube_mesh(m, [cw + V((-0.12, dy, 0.12)), V((x0 + 0.15, dy * 0.5, ZB)), cw + V((0.12, dy, 0.12))], 0.005,
                    'metal_dark', sides=3)
    parts.append(m)
    obj = P.join(parts, 'barrier')
    cols = [cbox((PX, 0, 0.6), (0.2, 0.2, 1.2)), cbox((RX, 0, 0.48), (0.16, 0.16, 0.96)),
            cbox(((x0 + x1) / 2 + 0.1, 0, 1.01), (x1 - x0 - 0.2, 0.14, 0.16)),
            cbox((x0 + 0.2, 0, ZB - 0.2), (0.36, 0.3, 0.3))]
    return P.finish(obj, 'barrier', cols, grime=0.25, grime_height=0.5)


@builder
def build_sentry_box():
    parts = []
    m = Mesh()
    rng = random.Random(99)
    wall = 'paint_white'
    # floor platform on two sleepers
    for x in (-0.4, 0.4):
        P.box_mesh(m, (0.1, 1.1, 0.06), trs((x, 0, 0.03)), 'wood_dark', occ_bottom=0.4)
    P.bbox_mesh(m, (1.04, 1.04, 0.05), trs((0, 0, 0.085)), 'wood_dark_h', 0.006)
    # walls of vertical boards on a frame; the front is open
    bw, gap, th, z0, z1 = 0.163, 0.005, 0.026, 0.11, 2.1
    boards = []
    for wall_i, (cx, cy, along, nrm) in enumerate(((0, 0.487, 'x', (0, 1)), (-0.487, 0, 'y', (-1, 0)),
                                                    (0.487, 0, 'y', (1, 0)))):
        n = 6
        for k in range(n):
            u = -0.5 + (k + 0.5) * 1.0 / n
            hgt = z1 - z0 + rng.uniform(-0.01, 0.01)
            if along == 'x':
                size, loc = (bw - gap, th, hgt), (u, cy, z0 + hgt / 2)
            else:
                size, loc = (th, bw - gap, hgt), (cx, u, z0 + hgt / 2)
            b = kit.box(size, loc=loc, mat=wall)
            boards.append(b)
        # inner battens
        for z in (0.45, 1.85):
            if along == 'x':
                P.box_mesh(m, (0.96, 0.03, 0.08), trs((0, cy - 0.028, z)), 'wood_h')
            else:
                P.box_mesh(m, (0.03, 0.96, 0.08), trs((cx - math.copysign(0.028, cx), 0, z)), 'wood')
    for x in (-0.478, 0.478):
        boards.append(kit.box((0.09, 0.09, 2.0), loc=(x * 0.97, -0.465, 1.1), mat=wall))
    lintel = kit.box((1.04, 0.06, 0.24), loc=(0, -0.47, 1.98), mat=wall)
    body = kit.join(boards + [lintel], 'sb_body')
    period = 0.34
    P.stripes(body, (0, 1, 1), period, ['paint_red', 'paint_white'],
              lambda f: abs(f.normal.x) > 0.9 and abs(f.calc_center_median().x) > 0.49)
    for sgn, sel in ((1, lambda c: c.x < 0), (-1, lambda c: c.x >= 0)):
        P.stripes(body, (sgn, 0, 1), period, ['paint_red', 'paint_white'],
                  lambda f, sel=sel: f.normal.y > 0.9 and f.calc_center_median().y > 0.49 and sel(f.calc_center_median()))
        P.stripes(body, (sgn, 0, 1), period, ['paint_red', 'paint_white'],
                  lambda f, sel=sel: f.normal.y < -0.9 and f.calc_center_median().y < -0.49
                  and sel(f.calc_center_median()) and f.calc_center_median().z < 1.86)
    parts.append(body)
    # roof: boarded pyramid with tarred felt, fascia, knob
    roof = kit.cyl(0.6 * math.sqrt(2), 0.34, loc=(0, 0, 2.1 + 0.17 + 0.03), rot=(0, 0, 45), mat='roof_slate', verts=4,
                   radius2=0.03)
    parts.append(roof)
    for (sx, sy, x, y) in ((1.24, 0.03, 0, -0.605), (1.24, 0.03, 0, 0.605), (0.03, 1.24, -0.605, 0), (0.03, 1.24, 0.605, 0)):
        P.bbox_mesh(m, (sx, sy, 0.1), trs((x, y, 2.1)), 'wood_dark', 0.005)
    P.cyl_mesh(m, 0.03, 0.12, trs((0, 0, 2.48)), 'wood_dark', sides=8)
    P.bbox_mesh(m, (0.09, 0.09, 0.09), trs((0, 0, 2.55), (0, 0, 45)), 'wood_dark', 0.02)
    # inside: a shelf with the field telephone, a coat hook
    P.bbox_mesh(m, (0.5, 0.2, 0.03), trs((0.18, 0.37, 1.18)), 'wood', 0.005)
    P.field_telephone(m, trs((0.2, 0.36, 1.195), (0, 0, 180)))
    parts.append(m)
    obj = P.join(parts, 'sentry_box')
    cols = [cbox((0, 0.478, 1.2), (1.04, 0.08, 2.4)), cbox((-0.478, 0, 1.2), (0.08, 1.04, 2.4)),
            cbox((0.478, 0, 1.2), (0.08, 1.04, 2.4))]
    return P.finish(obj, 'sentry_box', cols, {'guard': ((0, 0.05, 0.11), 0.0)}, grime=0.3, grime_height=0.7)


# ==========================================================================
# Props

@builder
def build_crate():
    m = Mesh()
    rng = random.Random(103)
    # boarded box: two boards per long side, end boards, cleats, a nailed lid
    for y in (-0.2575, 0.2575):
        for z, hgt in ((0.095, 0.175), (0.275, 0.17)):
            P.box_mesh(m, (0.96, 0.025, hgt - 0.006), trs((0, y, z), (rng.uniform(-0.4, 0.4), 0, 0)), 'wood_h',
                       occ_bottom=0.3)
    for x in (-0.4675, 0.4675):
        P.box_mesh(m, (0.025, 0.49, 0.35), trs((x, 0, 0.18)), 'wood', occ_bottom=0.3)
        for z in (0.1, 0.3):
            P.box_mesh(m, (0.03, 0.5, 0.06), trs((x * 1.065, 0, z)), 'wood_dark_h')
        sx = math.copysign(1, x)
        rope = [(sx * 0.5, -0.12, 0.25), (sx * 0.53, -0.06, 0.19), (sx * 0.535, 0.0, 0.18), (sx * 0.53, 0.06, 0.19),
                (sx * 0.5, 0.12, 0.25)]
        P.tube_mesh(m, rope, 0.011, 'webbing', sides=4)
    P.box_mesh(m, (0.93, 0.49, 0.02), trs((0, 0, 0.012)), 'wood_h')
    lid = trs((0, 0, 0.38))
    for y in (-0.135, 0.135):
        P.bbox_mesh(m, (1.0, 0.27, 0.025), lid @ trs((0, y, 0.0125)), 'wood_h', 0.005)
    for x in (-0.38, 0.38):
        P.box_mesh(m, (0.06, 0.53, 0.025), lid @ trs((x, 0, 0.037)), 'wood_dark')
    P.nails(m, [(x, y, 0.43) for x in (-0.38, 0.38) for y in (-0.2, -0.07, 0.07, 0.2)], (0, 0, 1), r=0.005)
    for x in (-0.3, 0.3):
        P.box_mesh(m, (0.04, 0.012, 0.09), trs((x, -0.276, 0.36)), 'iron')
        P.cyl_mesh(m, 0.008, 0.016, trs((x, -0.285, 0.335), (90, 0, 0)), 'iron', sides=6)
    P.box_mesh(m, (0.3, 0.001, 0.11), trs((-0.18, -0.2705, 0.22)), 'stencil_wood')
    P.box_mesh(m, (0.12, 0.001, 0.05), trs((0.25, -0.2705, 0.25)), 'stencil_wood')
    for sy in (-1, 1):            # v3: nails at the board ends
        P.nails(m, [(sx_ * 0.452, sy * 0.27, z) for sx_ in (-1, 1) for z in (0.06, 0.13, 0.24, 0.31)], (0, sy, 0),
                r=0.0045)
    obj = P.join([m], 'crate')
    return P.finish(obj, 'crate', [cbox((0, 0, 0.22), (1.0, 0.55, 0.44))], grime=0.15, grime_height=0.3,
                    center=PIN['crate'])


@builder
def build_crate_large():
    sx, sy, sz, b = 1.4, 1.2, 1.0, 0.075
    m = Mesh()
    rng = random.Random(107)
    # plank panels inside the frame
    nb = 4
    for y in (-sy / 2 + 0.03, sy / 2 - 0.03):
        for k in range(nb):
            z = 0.02 + (k + 0.5) * (sz - 0.04) / nb
            P.box_mesh(m, (sx - 0.06, 0.022, (sz - 0.04) / nb - 0.006), trs((0, y, z)), 'wood_h')
    for x in (-sx / 2 + 0.03, sx / 2 - 0.03):
        for k in range(nb):
            z = 0.02 + (k + 0.5) * (sz - 0.04) / nb
            P.box_mesh(m, (0.022, sy - 0.06, (sz - 0.04) / nb - 0.006), trs((x, 0, z)), 'wood_h')
    for k in range(5):
        y = -sy / 2 + 0.05 + (k + 0.5) * (sy - 0.1) / 5
        P.box_mesh(m, (sx - 0.06, (sy - 0.1) / 5 - 0.006, 0.022), trs((0, y, sz - 0.03)), 'wood_h')
    hx, hy = sx / 2 - b / 2, sy / 2 - b / 2
    for x in (-hx, hx):
        for y in (-hy, hy):
            P.box_mesh(m, (b, b, sz), trs((x, y, sz / 2)), 'wood_dark', occ_bottom=0.3)
    for z in (b / 2, sz - b / 2):
        for y in (-hy, hy):
            P.box_mesh(m, (sx - 2 * b, b, b), trs((0, y, z)), 'wood_dark_h')
        for x in (-hx, hx):
            P.box_mesh(m, (b, sy - 2 * b, b), trs((x, 0, z)), 'wood_dark_h')
    diag = math.degrees(math.atan2(sz - 2 * b, sx - 2 * b))
    dl = math.hypot(sz - 2 * b, sx - 2 * b)
    for y, sgn in ((-sy / 2 + 0.005, 1), (sy / 2 - 0.005, -1)):
        P.box_mesh(m, (dl - 0.06, 0.03, b * 0.9), trs((0, y, sz / 2), (0, sgn * diag, 0)), 'wood_dark_h')
    pts = []
    for x in (-hx, hx):
        for z in (0.2, 0.5, 0.8):
            pts.append((x, -sy / 2 - 0.0, z))
    P.nails(m, pts, (0, -1, 0), r=0.007)
    fy = -sy / 2 + 0.03 - 0.011 - 0.0005          # on the planks, not floating at the frame face
    P.box_mesh(m, (0.44, 0.001, 0.2), trs((-0.25, fy, 0.62)), 'stencil_wood')
    P.box_mesh(m, (0.24, 0.001, 0.08), trs((0.3, fy, 0.3)), 'stencil_wood')
    P.box_mesh(m, (0.001, 0.4, 0.16), trs((sx / 2 - 0.03 + 0.011 + 0.0005, 0.0, 0.55)), 'stencil_wood')
    obj = P.join([m], 'crate_large')
    return P.finish(obj, 'crate_large', [cbox((0, 0, sz / 2), (sx, sy, sz))], grime=0.25, grime_height=0.5,
                    center=PIN['crate_large'])


@builder
def build_barrel():
    prof = [(0.0, 0.0), (0.285, 0.0), (0.295, 0.012), (0.293, 0.035), (0.288, 0.05), (0.288, 0.265), (0.298, 0.278),
            (0.302, 0.29), (0.298, 0.302), (0.288, 0.315), (0.288, 0.565), (0.298, 0.578), (0.302, 0.59),
            (0.298, 0.602), (0.288, 0.615), (0.288, 0.83), (0.293, 0.845), (0.295, 0.865), (0.284, 0.878),
            (0.27, 0.868), (0.0, 0.862)]
    body = kit.lathe(prof, segments=18, mat='metal_gray')
    # dents: a few pushed-in patches
    rng = random.Random(29)
    dents = [(V((0.29 * math.cos(a), 0.29 * math.sin(a), z)), r, d) for a, z, r, d in
             ((0.6, 0.42, 0.12, 0.022), (2.9, 0.7, 0.09, 0.015), (4.4, 0.18, 0.08, 0.012))]
    for v in body.data.vertices:
        for c, r, d in dents:
            dist = (v.co - c).length
            if dist < r:
                k = (1 - dist / r) ** 2
                rad = V((v.co.x, v.co.y, 0)).normalized()
                v.co -= rad * d * k
    m = Mesh()
    for x, y, r in ((0.17, 0.05, 0.03), (-0.17, -0.02, 0.022)):
        P.cyl_mesh(m, r + 0.008, 0.012, trs((x, y, 0.868)), 'metal_dark', sides=10)
        P.cyl_mesh(m, r, 0.025, trs((x, y, 0.88)), 'metal_dark', sides=6)
    obj = P.join([body, m], 'barrel')
    return P.finish(obj, 'barrel', [ccyl((0, 0, 0), 0.3, 0.88)], grime=0.2, grime_height=0.4, hard_angle=40)


@builder
def build_jerrycan():
    W, T, Hh = 0.345, 0.16, 0.44
    m = Mesh()
    P.bbox_mesh(m, (W, T, Hh), trs((0, 0, Hh / 2)), 'metal_gray', 0.016, occ_bottom=0.3)
    P.bbox_mesh(m, (W + 0.008, 0.012, Hh - 0.03), trs((0, 0, Hh / 2 - 0.005)), 'metal_gray', 0.004)      # weld seam
    ang = math.degrees(math.atan2(Hh - 0.1, W - 0.08))
    ln = math.hypot(Hh - 0.1, W - 0.08)
    for y in (-T / 2 - 0.003, T / 2 + 0.003):
        for sgn in (1, -1):
            P.bbox_mesh(m, (ln, 0.008, 0.03), trs((0, y, Hh / 2 - 0.01), (0, sgn * ang, 0)), 'metal_gray', 0.003)
        P.bbox_mesh(m, (W - 0.05, 0.006, Hh - 0.06), trs((0, y * 0.985, Hh / 2 - 0.01)), 'metal_gray', 0.01)
    for y in (-0.042, 0.0, 0.042):
        P.tube_mesh(m, [(-0.072, y, Hh - 0.005), (-0.064, y, Hh + 0.03), (0.064, y, Hh + 0.03), (0.072, y, Hh - 0.005)],
                    0.008, 'metal_gray', sides=6)
    P.cyl_mesh(m, 0.026, 0.045, trs((0.125, 0, Hh + 0.012), (0, 12, 0)), 'metal_gray', sides=10)
    P.cyl_mesh(m, 0.03, 0.015, trs((0.128, 0, Hh + 0.04), (0, 12, 0)), 'metal_gray', sides=10)
    P.bbox_mesh(m, (0.012, 0.03, 0.07), trs((0.158, 0, Hh + 0.03), (0, -20, 0)), 'metal_dark', 0.003)
    P.tube_mesh(m, [(0.12, -0.02, Hh + 0.03), (0.09, -0.03, Hh + 0.035), (0.07, -0.02, Hh + 0.03)], 0.003, 'metal_dark',
                sides=3)
    obj = P.join([m], 'jerrycan')
    return P.finish(obj, 'jerrycan', [cbox((0, 0, 0.235), (0.35, 0.17, 0.47))], grime=0.12, grime_height=0.2)


@builder
def build_ammo_box():
    m = Mesh()
    P.ammo_can(m, trs((0, 0, 0)), mat='metal_olive')
    obj = P.join([m], 'ammo_box')
    return P.finish(obj, 'ammo_box', [], grime=0.08, grime_height=0.1)


@builder
def build_medkit():
    W, T, Hh = 0.34, 0.11, 0.22
    body = kit.box((W, T, Hh), loc=(0, 0, Hh / 2), mat='canvas')
    kit.bevel(body, 0.022, 3, 30)
    parts = [body]
    m = Mesh()
    flap = Mesh()
    P.bbox_mesh(flap, (W - 0.01, T + 0.014, 0.085), trs((0, 0.0, Hh - 0.025), (3, 0, 0)), 'canvas', 0.012)
    parts.append(flap)
    for x in (-0.09, 0.09):
        P.bbox_mesh(m, (0.025, 0.006, 0.11), trs((x, -T / 2 - 0.009, Hh - 0.06)), 'leather', 0.002)
        P.bbox_mesh(m, (0.032, 0.006, 0.022), trs((x, -T / 2 - 0.012, Hh - 0.115)), 'metal_dark', 0.002)
        P.bbox_mesh(m, (0.03, 0.008, 0.16), trs((x, T / 2 + 0.006, Hh / 2)), 'leather', 0.002)
    P.box_mesh(m, (0.15, 0.004, 0.115), trs((0, -T / 2 - 0.004, 0.085)), 'paint_white')
    arm, w = 0.045, 0.014
    cross = [(-w, -arm), (w, -arm), (w, -w), (arm, -w), (arm, w), (w, w), (w, arm), (-w, arm), (-w, w), (-arm, w),
             (-arm, -w), (-w, -w)]
    ids_f = [m.vert((x, -T / 2 - 0.0062, 0.085 + z)) for x, z in cross]
    m.face(ids_f, 'paint_red')          # CCW seen from the front (-Y)
    parts.append(m)
    obj = P.join(parts, 'medkit')
    return P.finish(obj, 'medkit', [], grime=0.08, grime_height=0.1, hard_angle=45)


@builder
def build_charge():
    m = Mesh()
    rng = random.Random(101)
    for i in range(3):
        for j in range(2):
            P.box_mesh(m, (0.093, 0.068, 0.165), trs(((i - 1) * 0.096, (j - 0.5) * 0.071, 0.0825 + rng.uniform(0, 0.004)),
                                                    (0, 0, rng.uniform(-1.5, 1.5))), 'canvas')
    for x in (-0.085, 0.085):
        P.bbox_mesh(m, (0.018, 0.152, 0.172), trs((x, 0, 0.084)), 'webbing', 0.004)
        P.bbox_mesh(m, (0.03, 0.006, 0.03), trs((x, -0.078, 0.12)), 'metal_dark', 0.002)
    P.cyl_mesh(m, 0.012, 0.05, trs((0.0, 0.0, 0.18)), 'metal_gray', sides=8)
    P.cyl_mesh(m, 0.009, 0.02, trs((0.0, 0.0, 0.212)), 'metal_gray', sides=8)
    coil = []
    for k in range(28):
        a = k * 0.6
        coil.append((0.06 + 0.035 * math.cos(a), 0.035 * math.sin(a), 0.174 + 0.003 * k / 28 + 0.004))
    P.tube_mesh(m, [(0, 0, 0.222), (0.01, 0.0, 0.235), (0.05, 0.01, 0.235), (0.095, 0.0, 0.2), (0.095, 0.0, 0.18)]
                + coil[::-1][:0], 0.004, 'paint_red', sides=4)
    P.tube_mesh(m, coil, 0.004, 'paint_red', sides=3)
    obj = P.join([m], 'charge')
    return P.finish(obj, 'charge', [], grime=0.06, grime_height=0.1)


# ==========================================================================
# Camp

@builder
def build_tent():
    from mathutils import noise as mnoise
    m = Mesh()
    rng = random.Random(111)
    Y0, Y1, RIDGE, EAVE = -1.7, 1.7, 2.33, 1.0
    half = [(-1.62, 0.0), (-1.6, 0.25), (-1.57, 0.5), (-1.54, 0.75), (-1.52, EAVE), (-1.34, 1.17), (-1.15, 1.34),
            (-0.96, 1.51), (-0.76, 1.68), (-0.57, 1.85), (-0.38, 2.02), (-0.19, 2.18), (0.0, RIDGE)]
    prof = half + [(-x, z) for x, z in reversed(half[:-1])]
    nseg = 20
    ys = [Y0 + (Y1 - Y0) * i / nseg for i in range(nseg + 1)]
    span = nseg // 2

    def ring(i, inset=0.0):
        y = ys[i]
        frac = (i % span) / span
        sag = math.sin(math.pi * frac)
        pts = []
        for k, (x, z) in enumerate(prof):
            eave = abs(z - EAVE) < 1e-6
            dx, dz = 0.0, 0.0
            fold = mnoise.noise(V((y * 2.6, k * 0.45, 1.7)))
            if 0 < z < RIDGE and not eave:
                if z > EAVE:      # roof: sag between the poles and mid-slope, creases
                    slope = math.sin(math.pi * (z - EAVE) / (RIDGE - EAVE))
                    dz = -(0.05 * sag + 0.05 * slope) + 0.015 * fold
                else:             # walls bow in, hang in folds
                    dx = -math.copysign(0.03 * sag + 0.012 * (fold + 0.6) * (1 - z / EAVE + 0.3), x)
            elif eave and i % span:
                dz = -0.03 * sag
            nx = -math.copysign(1, x) if x else 0.0
            pts.append(V((x + dx + nx * inset * (1 if z < RIDGE else 0), y, z + dz - (inset if z > EAVE else 0.0))))
        return pts

    outer = [ring(i) for i in range(nseg + 1)]
    inner = [ring(i, 0.025) for i in range(nseg + 1)]
    P.loft(m, outer, 'canvas', closed=False, soft=True)
    P.loft(m, [list(reversed(r)) for r in inner], 'canvas', closed=False, soft=True, occ=lambda i, k: 0.35)
    back_o = [m.vert(p, 0.1) for p in outer[-1]]
    back_i = [m.vert(p + V((0, -0.025, 0)), 0.4) for p in inner[-1]]
    m.face(back_o, 'canvas', True)
    m.face(list(reversed(back_i)), 'canvas', True)
    # hems / bolt ropes along the eaves and the ridge
    for sx in (-1, 1):
        P.tube_mesh(m, [V((sx * 1.535, y, EAVE - 0.03 * math.sin(math.pi * ((y - Y0) % 1.7) / 1.7) + 0.005))
                        for y in [Y0 + 0.17 * k for k in range(21)]], 0.012, 'canvas', sides=4)
    # door flaps rolled and tied back, with ties
    for sx in (-1, 1):
        P.tube_mesh(m, [(sx * 0.12, Y0 - 0.06, RIDGE - 0.08), (sx * 0.8, Y0 - 0.07, 1.7), (sx * 1.42, Y0 - 0.07, 1.06),
                        (sx * 1.5, Y0 - 0.06, 0.55), (sx * 1.5, Y0 - 0.05, 0.12)], 0.065, 'canvas', sides=8,
                    radii=[0.03, 0.06, 0.075, 0.07, 0.06])
        for p in ((sx * 1.46, Y0 - 0.065, 1.2), (sx * 1.5, Y0 - 0.06, 0.4)):
            P.cyl_mesh(m, 0.08, 0.02, trs(p, (0, 90 if abs(p[2] - 1.2) > 0.1 else 60, 0)), 'webbing', sides=8)
    # poles with brass-capped spikes, ridge pole
    for y in (Y0, Y1):
        P.tube_mesh(m, [(0, y, 0.0), (0, y, RIDGE + 0.04)], 0.035, 'wood', sides=8)
        P.cyl_mesh(m, 0.01, 0.12, trs((0, y, RIDGE + 0.1)), 'iron', sides=6, r2=0.005)
    P.tube_mesh(m, [(0, Y0 - 0.02, RIDGE - 0.05), (0, Y1 + 0.02, RIDGE - 0.05)], 0.03, 'wood', sides=8)
    # guy ropes with wooden runners, pegs
    for y in (Y0, -0.85, 0.0, 0.85, Y1):
        for sx in (-1, 1):
            a = V((sx * 1.53, y, EAVE + 0.01))
            b = V((sx * 2.0, y + rng.uniform(-0.05, 0.05), 0.08))
            P.tube_mesh(m, [a, b], 0.007, 'webbing', sides=3)
            rp = a.lerp(b, 0.62)
            P.bbox_mesh(m, (0.09, 0.03, 0.02), trs(rp, (0, sx * 63, 0)), 'wood', 0.004)
            P.box_mesh(m, (0.03, 0.03, 0.13), trs(V((b.x + sx * 0.02, b.y, 0.068)), (0, sx * 20, 0)), 'wood_dark')
    for y in (Y0, Y1):           # ridge guys fore and aft
        b = V((0.0, y + (-0.07 if y < 0 else 0.07), 0.08))
        P.tube_mesh(m, [(0, y, RIDGE + 0.06), b], 0.007, 'webbing', sides=3)
    # the hurricane lantern hung from the ridge
    lp = V((0.0, 0.0, RIDGE - 0.32))
    P.tube_mesh(m, [lp + V((0, 0, 0.27)), lp + V((0, 0, 0.12))], 0.004, 'wire', sides=3)
    P.cyl_mesh(m, 0.06, 0.03, trs(lp + V((0, 0, 0.1))), 'metal_dark', sides=10, r2=0.03)
    P.cyl_mesh(m, 0.045, 0.11, trs(lp + V((0, 0, 0.03))), 'window_lit', sides=10)
    P.cyl_mesh(m, 0.06, 0.04, trs(lp + V((0, 0, -0.05))), 'metal_dark', sides=10)
    for a in range(3):
        aa = a * 2 * math.pi / 3
        P.tube_mesh(m, [lp + V((0.055 * math.cos(aa), 0.055 * math.sin(aa), -0.03)),
                        lp + V((0.055 * math.cos(aa), 0.055 * math.sin(aa), 0.09))], 0.003, 'metal_dark', sides=3)
    obj = P.join([m], 'tent')
    cols = [cbox((-1.55, 0, 0.7), (0.2, 3.4, 1.4)), cbox((1.55, 0, 0.7), (0.2, 3.4, 1.4)),
            cbox((0, 1.7, 1.0), (3.2, 0.12, 2.0))]
    CLOSE['tent'] = ((0.0, -0.4, 0.4), -18.0, 10.0)
    return P.finish(obj, 'tent', cols, {'lamp': (0.0, 0.0, 2.0)}, grime=0.3, grime_height=0.6, soft_angle=60)


@builder
def build_radio_table():
    m = Mesh()
    rng = random.Random(121)
    # trestle table: three planks on two trestles
    for k in range(3):
        y = -0.27 + k * 0.27
        P.bbox_mesh(m, (1.6, 0.262, 0.035), trs((0, y, 0.7625), (0, 0, rng.uniform(-0.3, 0.3))), 'wood_h', 0.005)
    for x in (-0.62, 0.62):
        for sy in (-1, 1):
            a, b = V((x, sy * 0.36, 0.0)), V((x, sy * 0.12, 0.74))
            d = b - a
            ang = math.degrees(math.atan2(d.y, d.z))
            P.bbox_mesh(m, (0.05, 0.045, d.length), trs((a + b) / 2, (-ang, 0, 0)), 'wood_dark', 0.006, occ_bottom=0.3)
        P.box_mesh(m, (0.05, 0.36, 0.06), trs((x, 0, 0.71)), 'wood_dark')
        P.box_mesh(m, (0.04, 0.6, 0.04), trs((x, 0, 0.22)), 'wood_dark')
        for y in (-0.08, 0.08):
            P.tube_mesh(m, [(x - 0.03, y, 0.7), (x + 0.03, y, 0.7)], 0.006, 'iron', sides=4)
    P.box_mesh(m, (1.24, 0.04, 0.05), trs((0, 0, 0.22)), 'wood_dark')
    # the radio (Torn.Fu): transceiver case with its lid down on the table,
    # front panel with dials, knobs, sockets; the power unit beside it
    RX, RY, RZ = 0.05, 0.08, 0.78
    P.bbox_mesh(m, (0.42, 0.26, 0.32), trs((RX, RY, RZ + 0.16)), 'metal_gray', 0.012)
    for x in (RX - 0.2, RX + 0.2):
        P.tube_mesh(m, [(x, RY - 0.05, RZ + 0.28), (x + math.copysign(0.025, x - RX), RY, RZ + 0.3),
                        (x, RY + 0.05, RZ + 0.28)], 0.008, 'metal_dark', sides=4)
    fy = RY - 0.13
    P.box_mesh(m, (0.36, 0.01, 0.26), trs((RX, fy - 0.004, RZ + 0.16)), 'metal_dark')
    P.box_mesh(m, (0.12, 0.012, 0.05), trs((RX - 0.06, fy - 0.01, RZ + 0.24)), 'glass')
    P.cyl_mesh(m, 0.04, 0.012, trs((RX + 0.1, fy - 0.01, RZ + 0.23), (90, 0, 0)), 'glass', sides=12)
    for (x, z, r) in ((RX + 0.1, RZ + 0.23, 0.026), (RX - 0.06, RZ + 0.12, 0.03), (RX + 0.1, RZ + 0.1, 0.018),
                      (RX + 0.03, RZ + 0.1, 0.014), (RX - 0.15, RZ + 0.07, 0.014), (RX - 0.15, RZ + 0.18, 0.014)):
        P.cyl_mesh(m, r, 0.03, trs((x, fy - 0.025, z), (90, 0, 0)), 'bakelite', sides=10 if r > 0.02 else 8)
    for x in (RX + 0.14, RX + 0.17):
        P.cyl_mesh(m, 0.008, 0.02, trs((x, fy - 0.015, RZ + 0.05), (90, 0, 0)), 'brass', sides=6)
    P.box_mesh(m, (0.012, 0.004, 0.04), trs((RX - 0.1, fy - 0.025, RZ + 0.22), (0, 30, 0)), 'metal_dark')
    P.bbox_mesh(m, (0.4, 0.3, 0.014), trs((RX, RY - 0.29, RZ + 0.007), (0, 0, 2)), 'metal_gray', 0.004)
    P.bbox_mesh(m, (0.26, 0.22, 0.24), trs((0.5, 0.14, RZ + 0.12), (0, 0, -6)), 'metal_gray', 0.01)
    P.tube_mesh(m, [(0.38, 0.12, RZ + 0.1), (0.3, 0.1, RZ + 0.02), (0.27, 0.12, RZ + 0.08)], 0.006, 'rubber', sides=4)
    # handset and headphones, Morse key, notebook, papers, map case, field telephone
    hx, hy = -0.38, -0.12
    P.bbox_mesh(m, (0.17, 0.034, 0.028), trs((hx, hy, RZ + 0.03), (0, 0, 25)), 'bakelite', 0.008)
    for sgn in (-1, 1):
        dx, dy = sgn * 0.085 * math.cos(math.radians(25)), sgn * 0.085 * math.sin(math.radians(25))
        P.cyl_mesh(m, 0.032, 0.03, trs((hx + dx, hy + dy, RZ + 0.018)), 'bakelite', sides=10)
    P.tube_mesh(m, [(hx + 0.08, hy + 0.04, RZ + 0.01), (hx + 0.16, hy + 0.12, RZ + 0.008),
                    (hx + 0.26, hy + 0.1, RZ + 0.008), (RX - 0.21, RY - 0.06, RZ + 0.04),
                    (RX - 0.215, RY - 0.02, RZ + 0.1)], 0.005, 'rubber', sides=4)
    for sgn in (-1, 1):
        P.cyl_mesh(m, 0.042, 0.03, trs((-0.08 + sgn * 0.09, -0.22, RZ + 0.016), (0, sgn * 70, 0)), 'leather', sides=10)
    P.tube_mesh(m, [(-0.17, -0.22, RZ + 0.03), (-0.13, -0.22, RZ + 0.1), (-0.03, -0.22, RZ + 0.1), (0.01, -0.22, RZ + 0.03)],
                0.006, 'metal_dark', sides=4)
    P.bbox_mesh(m, (0.14, 0.06, 0.015), trs((0.36, -0.22, RZ + 0.0075)), 'bakelite', 0.003)
    P.box_mesh(m, (0.09, 0.008, 0.008), trs((0.35, -0.22, RZ + 0.02), (0, -6, 0)), 'brass')
    P.cyl_mesh(m, 0.009, 0.012, trs((0.31, -0.22, RZ + 0.028)), 'bakelite', sides=8)
    P.box_mesh(m, (0.15, 0.21, 0.012), trs((0.62, -0.15, RZ + 0.006), (0, 0, 12)), 'canvas')
    P.cyl_mesh(m, 0.004, 0.15, trs((0.6, -0.08, RZ + 0.016), (0, 90, 30)), 'wood', sides=6)
    P.box_mesh(m, (0.3, 0.22, 0.003), trs((-0.52, 0.16, RZ + 0.0015), (0, 0, 8)), 'paint_white')
    P.box_mesh(m, (0.21, 0.29, 0.003), trs((-0.6, -0.12, RZ + 0.003), (0, 0, -14)), 'paint_white')
    P.bbox_mesh(m, (0.32, 0.04, 0.24), trs((0.62, 0.18, RZ + 0.12), (0, 0, 3)), 'leather', 0.01)
    P.field_telephone(m, trs((-0.55, 0.25, RZ), (0, 0, -100)))
    # whip antenna on an insulator at the back corner
    ax, ay = RX - 0.17, RY + 0.1
    P.cyl_mesh(m, 0.02, 0.07, trs((ax, ay, RZ + 0.355)), 'bakelite', sides=8)
    P.tube_mesh(m, [(ax, ay, RZ + 0.38), (ax + 0.004, ay, 1.55), (ax + 0.02, ay + 0.005, 2.0),
                    (ax + 0.05, ay + 0.01, 2.35), (ax + 0.09, ay + 0.02, 2.6)], 0.006, 'metal_dark', sides=4,
                radii=[0.008, 0.006, 0.005, 0.004, 0.003])
    # the operator's folding stool
    sx_, sy_ = 0.05, -0.62
    for sgn in (-1, 1):
        P.tube_mesh(m, [(sx_ - 0.17, sy_ + sgn * 0.13, 0.0), (sx_ + 0.17, sy_ - sgn * 0.13, 0.43)], 0.012, 'wood', sides=5)
        P.tube_mesh(m, [(sx_ + 0.17, sy_ + sgn * 0.13, 0.0), (sx_ - 0.17, sy_ - sgn * 0.13, 0.43)], 0.012, 'wood', sides=5)
    P.bbox_mesh(m, (0.36, 0.3, 0.012), trs((sx_, sy_, 0.445)), 'canvas', 0.004)
    obj = P.join([m], 'radio_table')
    cols = [cbox((0, 0, 0.39), (1.6, 0.8, 0.78)), cbox((RX + 0.15, RY, RZ + 0.16), (0.75, 0.3, 0.32))]
    anchors = {'radio': (RX, RY, RZ + 0.16), 'operator': ((RX, -0.75, 0.0), 180.0)}
    CLOSE['radio_table'] = ((0.0, 0.25, -0.15), -25.0, 30.0)
    return P.finish(obj, 'radio_table', cols, anchors, grime=0.15, grime_height=0.5)


@builder
def build_watchtower():
    m = Mesh()
    rng = random.Random(131)
    PZ, B, T = 4.5, 1.38, 1.02               # platform top, leg half-spread at the base / platform

    def leg_at(sx, sy, z):
        h = B + (T - B) * z / PZ
        return V((sx * h, sy * h, z))
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for sx, sy in corners:
        P.tube_mesh(m, [leg_at(sx, sy, 0.0), leg_at(sx, sy, PZ - 0.02)], 0.09, 'wood_dark', sides=8,
                    occ=lambda i, k: 0.3 if i == 0 else 0.0)
        P.tube_mesh(m, [V((sx * T, sy * T, PZ)), V((sx * T, sy * T, 6.55))], 0.065, 'wood_dark', sides=6)
    # girts and cross braces on the four sides
    levels = (0.35, 2.3, 4.3)
    for c in range(4):
        (ax, ay), (bx, by) = corners[c], corners[(c + 1) % 4]
        for z in levels:
            p, q = leg_at(ax, ay, z), leg_at(bx, by, z)
            d = q - p
            P.box_mesh(m, (d.length, 0.06, 0.11), trs((p + q) / 2, (0, 0, math.degrees(math.atan2(d.y, d.x)))),
                       'wood_h')
        for z0, z1 in ((levels[0], levels[1]), (levels[1], levels[2])):
            for (p, q) in ((leg_at(ax, ay, z0), leg_at(bx, by, z1)), (leg_at(bx, by, z0), leg_at(ax, ay, z1))):
                d = q - p
                yaw = math.degrees(math.atan2(d.y, d.x))
                pitch = math.degrees(math.atan2(d.z, math.hypot(d.x, d.y)))
                out = V((p + q) / 2) + V(((ax + bx) * 0.02, (ay + by) * 0.02, 0))
                P.box_mesh(m, (d.length, 0.045, 0.1), trs(out, (0, -pitch, yaw)), 'wood')
    # platform: bearers and planks
    for x in (-0.95, 0.95):
        P.box_mesh(m, (0.12, 2.5, 0.14), trs((x, 0, PZ - 0.12)), 'wood_dark')
    for i in range(8):
        y = -1.12 + i * 0.32
        P.box_mesh(m, (2.5 + rng.uniform(-0.04, 0.04), 0.3, 0.05), trs((rng.uniform(-0.02, 0.02), y, PZ - 0.025),
                                                                        (0, 0, rng.uniform(-0.8, 0.8))), 'wood_old_h')
    # rails and kick boards (gap at the back where the ladder arrives)
    for c in range(4):
        (ax, ay), (bx, by) = corners[c], corners[(c + 1) % 4]
        p, q = V((ax * T, ay * T, 0)), V((bx * T, by * T, 0))
        back = ay > 0 and by > 0
        segs = [(p, q)]
        if back:
            g0, g1 = V((0.62, T, 0)), V((0.0, T, 0))
            segs = [(p, g0), (g1, q)]
        for a, b in segs:
            d = b - a
            yaw = math.degrees(math.atan2(d.y, d.x))
            for z, hgt, th in ((PZ + 1.0, 0.07, 0.06), (PZ + 0.55, 0.06, 0.05), (PZ + 0.14, 0.24, 0.035)):
                P.box_mesh(m, (d.length, th, hgt), trs((a + b) / 2 + V((0, 0, z)), (0, 0, yaw)), 'wood_h')
    # roof: shallow pyramid on a fascia
    parts = [m, kit.cyl(2.0, 0.42, loc=(0, 0, 6.55 + 0.21 + 0.06), rot=(0, 0, 45), mat='wood_dark', verts=4,
                        radius2=0.06),
             kit.box((2.5, 2.5, 0.12), loc=(0, 0, 6.6), mat='wood_dark')]
    # ladder up the back
    lb, lt = V((0.31, 1.66, 0.0)), V((0.31, T + 0.06, PZ + 0.05))
    d = lt - lb
    tilt = math.degrees(math.atan2(-d.y, d.z))
    for sx in (-0.23, 0.23):
        a = lb + V((sx, 0, 0))
        P.box_mesh(m, (0.06, 0.045, d.length + 0.6), trs(a + d / 2 + d.normalized() * 0.3, (tilt, 0, 0)), 'wood')
    n = 15
    for i in range(1, n + 1):
        p = lb + d * (i / (n + 0.6))
        P.box_mesh(m, (0.46, 0.035, 0.035), trs(p + V((0, 0.0, 0.0)), (tilt, 0, 0)), 'wood_dark')
    # bolts through the brace crossings and girt ends
    bolts = []
    for c in range(4):
        (ax, ay), (bx, by) = corners[c], corners[(c + 1) % 4]
        for z in levels:
            for (sx, sy) in ((ax, ay), (bx, by)):
                bolts.append((leg_at(sx, sy, z), V(((ax + bx) / 2, (ay + by) / 2, 0)).normalized()))
        for z0, z1 in ((levels[0], levels[1]), (levels[1], levels[2])):
            mid = (leg_at(ax, ay, (z0 + z1) / 2) + leg_at(bx, by, (z0 + z1) / 2)) / 2
            bolts.append((mid, V(((ax + bx) / 2, (ay + by) / 2, 0)).normalized()))
    for p_, n_ in bolts:
        P.nails(m, [p_ + n_ * 0.05], n_, r=0.016, mat='metal_dark')
    # searchlight on a post at the front rail
    sl = V((0.55, -T + 0.05, PZ + 1.16))
    P.cyl_mesh(m, 0.03, 0.2, trs(sl + V((0, 0, -0.1))), 'metal_dark', sides=8)
    P.tube_mesh(m, [sl + V((-0.2, 0, 0.0)), sl + V((-0.2, 0, 0.16)), sl + V((0.2, 0, 0.16)), sl + V((0.2, 0, 0.0))],
                0.012, 'metal_dark', sides=5)
    lamp_m = trs(sl + V((0, 0, 0.16)), (75, 0, 0))
    P.cyl_mesh(m, 0.17, 0.32, lamp_m, 'metal_gray', sides=16, r2=0.16)
    P.cyl_mesh(m, 0.185, 0.03, lamp_m @ trs((0, 0, 0.16)), 'metal_dark', sides=16)
    P.cyl_mesh(m, 0.155, 0.01, lamp_m @ trs((0, 0, 0.175)), 'glass', sides=16)
    P.cyl_mesh(m, 0.1, 0.06, lamp_m @ trs((0, 0, -0.18)), 'metal_dark', sides=10)
    P.tube_mesh(m, [sl + V((0.12, 0.08, 0.1)), sl + V((0.2, 0.25, -0.1)), V((T - 0.05, -T + 0.05, PZ + 0.6)),
                    V((T - 0.02, -T + 0.02, 0.6)), V((B, -B, 0.02))], 0.008, 'rubber', sides=4)
    # sandbags along the front of the platform, a field telephone on a shelf
    rng3 = random.Random(133)
    for k in range(4):
        P.bag(m, 0.58, 0.34, 0.19, trs((-0.75 + k * 0.42, -T + 0.25, PZ), (0, 0, rng3.uniform(-6, 6))), rng3, tie=1)
    P.bbox_mesh(m, (0.4, 0.22, 0.025), trs((-T + 0.15, 0.35, PZ + 0.85), (0, 0, 90)), 'wood', 0.004)
    P.field_telephone(m, trs((-T + 0.15, 0.35, PZ + 0.8625), (0, 0, 90)))
    obj = P.join(parts, 'watchtower')
    cols = [ccyl(((B + T) / 2 * sx, (B + T) / 2 * sy, 0), 0.22, PZ - 0.1) for sx, sy in corners]
    cols.append(cbox((0, 0, PZ - 0.075), (2.5, 2.5, 0.15)))
    for (cx, cy, lx, ly) in ((0, -T, 2.1, 0.08), (-T, 0, 0.08, 2.1), (T, 0, 0.08, 2.1), (-0.5, T, 1.0, 0.08),
                             (0.85, T, 0.35, 0.08)):
        cols.append(cbox((cx, cy, PZ + 0.55), (lx, ly, 1.1), kind='wire'))
    anchors = {'lookout': ((0.0, -0.2, PZ), 0.0), 'ladder': ((0.31, 1.95, 0.0), 0.0),
               'ladder_top': ((0.31, T - 0.35, PZ), 180.0), 'light': (tuple(sl + V((0, -0.2, 0.2))), 0.0)}
    CLOSE['watchtower'] = ((0.0, 0.3, 0.0), -30.0, 12.0)
    return P.finish(obj, 'watchtower', cols, anchors, grime=0.3, grime_height=1.2)


# ==========================================================================
# 2 cm Flak 38

@builder
def build_flak38():
    parts = []
    m = Mesh()
    G = 'metal_gray'
    D = 'metal_dark'
    # cruciform platform: hub with a bolt circle, four tapered box arms with
    # top ribs, levelling jacks with screw housings, crank handles and pads
    parts.append(kit.cyl(0.42, 0.14, loc=(0, 0, 0.24), mat=G, verts=16))
    P.nails(m, [(0.33 * math.cos(a), 0.33 * math.sin(a), 0.31) for a in [k * math.pi / 6 for k in range(12)]],
            (0, 0, 1), r=0.014, mat=D)
    arm_len = {(1, 0): 1.02, (-1, 0): 1.02, (0, 1): 1.22, (0, -1): 1.22}
    for (dx, dy), L in arm_len.items():
        d = V((dx, dy, 0))
        side = V((-dy, dx, 0))
        pts = []
        for t, w, z0, z1 in ((0.2, 0.11, 0.17, 0.31), (L, 0.07, 0.17, 0.27)):
            c = d * t
            for sw in (-w, w):
                for z in (z0, z1):
                    pts.append(c + side * sw + V((0, 0, z)))
        arm = P.hull_object(pts, G)
        kit.bevel(arm, 0.012, 1, 30)
        parts.append(arm)
        yaw = math.degrees(math.atan2(dy, dx))
        P.box_mesh(m, (L - 0.35, 0.02, 0.03), trs(d * ((L + 0.35) / 2) + V((0, 0, 0.295 - 0.02 * (L - 0.35) / 2 / L)),
                                                (0, math.degrees(math.atan2(0.04, L - 0.2)), yaw)), G)
        P.nails(m, [d * t + side * s_ + V((0, 0, 0.31 - 0.04 * t / L)) for t in (0.45, 0.8) for s_ in (-0.06, 0.06)],
                (0, 0, 1), r=0.012, mat=D)
        tip = d * (L - 0.05)
        P.cyl_mesh(m, 0.11, 0.035, trs(tip + V((0, 0, 0.018))), G, sides=12)
        P.cyl_mesh(m, 0.026, 0.4, trs(tip + V((0, 0, 0.2))), D, sides=8)
        P.cyl_mesh(m, 0.045, 0.13, trs(tip + V((0, 0, 0.27))), G, sides=10)
        P.box_mesh(m, (0.16, 0.016, 0.016), trs(tip + V((0, 0, 0.4)), (0, 0, yaw + 90)), D)
        knob = tip + V((0, 0, 0.4)) + V((-dy, dx, 0)) * 0.08
        P.cyl_mesh(m, 0.012, 0.06, trs(knob + V((0, 0, 0.03))), D, sides=6)
    # traverse ring with gear teeth, turntable
    ring_pts = []
    for z in (0.31, 0.34):
        ring_pts.append([V(((0.385 if k % 2 else 0.4) * math.cos(2 * math.pi * k / 72),
                            (0.385 if k % 2 else 0.4) * math.sin(2 * math.pi * k / 72), z)) for k in range(72)])
    P.loft(m, ring_pts, D, closed=True, cap0=True, cap1=True)
    parts.append(kit.cyl(0.35, 0.08, loc=(0, 0, 0.385), mat=G, verts=24))
    # upper carriage: base plate, trunnion cheeks with lightening holes, bosses
    TR = V((0, 0.05, 0.98))
    P.bbox_mesh(m, (0.74, 0.72, 0.06), trs((0, 0.05, 0.455)), G, 0.01)
    cheek = [(-0.26, 0.47), (0.36, 0.47), (0.26, 0.86), (0.12, 1.06), (-0.06, 1.08), (-0.2, 0.96), (-0.3, 0.72)]
    for x in (-0.2, 0.2):
        c = kit.extrude_profile(cheek, 0.026, axis='X', mat=G)
        c.location = (x, 0, 0)
        kit.apply_transform(c)
        for (yy, zz, rr) in ((0.12, 0.64, 0.07), (-0.12, 0.66, 0.05)):
            kit.cut(c, kit.cyl(rr, 0.1, loc=(x, yy, zz), rot=(0, 90, 0), mat=G, verts=12))
        parts.append(c)
        P.cyl_mesh(m, 0.07, 0.04, trs((x * 1.15, TR.y, TR.z), (0, 90, 0)), G, sides=12)
    parts.append(kit.cyl(0.045, 0.56, loc=tuple(TR), rot=(0, 90, 0), mat=D, verts=10))
    sector = [(0.0, 0.0)] + [(0.3 * math.cos(math.radians(a)), 0.3 * math.sin(math.radians(a)))
                             for a in range(-150, -19, 10)]
    sec = kit.extrude_profile([(TR.y + y, TR.z + z) for y, z in sector], 0.02, axis='X', mat=D)
    sec.location = (-0.24, 0, 0)
    parts.append(sec)
    # handwheels (elevation left, traverse right) with spokes and grips
    for x, y, z in ((-0.36, 0.34, 0.8), (0.36, 0.3, 0.66)):
        ring = [(x, y + 0.11 * math.cos(2 * math.pi * k / 14), z + 0.11 * math.sin(2 * math.pi * k / 14)) for k in range(15)]
        P.tube_mesh(m, ring, 0.012, D, sides=5, caps=False)
        for a in (0, 120, 240):
            aa = math.radians(a)
            P.tube_mesh(m, [(x, y, z), (x, y + 0.105 * math.cos(aa), z + 0.105 * math.sin(aa))], 0.007, D, sides=4)
        P.box_mesh(m, (abs(x) - 0.2, 0.025, 0.025), trs(((x + math.copysign(0.2, x)) / 2, y, z)), D)
        P.cyl_mesh(m, 0.012, 0.08, trs((x + math.copysign(0.04, x), y + 0.11, z), (0, 90, 0)), 'rubber', sides=6)
    # seats: pressed pans with backrests on arms, footrests, firing pedal
    for x, y, z, r in ((-0.32, 0.66, 0.74, 0.15), (0.34, 0.6, 0.66, 0.14)):
        pan = kit.lathe([(0.0, -0.02), (r * 0.9, -0.02), (r, 0.0), (r * 1.02, 0.03), (r * 0.92, 0.035), (0.0, 0.01)],
                        segments=14, mat=G)
        pan.location = (x, y, z)
        parts.append(pan)
        P.bbox_mesh(m, (0.26, 0.03, 0.2), trs((x, y + r + 0.01, z + 0.13), (-12, 0, 0)), G, 0.008)
        P.box_mesh(m, (0.05, abs(y) - 0.3, 0.05), trs((x * 0.8, (y + 0.3) / 2 + 0.02, z - 0.08)), G)
        P.box_mesh(m, (0.05, 0.05, z - 0.47), trs((x * 0.7, 0.32, (z + 0.47) / 2 - 0.02)), G)
        P.tube_mesh(m, [(x - 0.1, y - 0.25, 0.52), (x + 0.1, y - 0.25, 0.52)], 0.012, D, sides=5)
    P.bbox_mesh(m, (0.1, 0.06, 0.02), trs((-0.3, 0.38, 0.5), (15, 0, 0)), D, 0.004)
    # shield: front plate with the barrel slot, bolted edges, a sight hatch, wings
    plate = [(-0.72, 0.44), (0.72, 0.44), (0.72, 1.34), (0.56, 1.5), (0.17, 1.5), (0.17, 0.92), (-0.17, 0.92),
             (-0.17, 1.5), (-0.56, 1.5), (-0.72, 1.34)]
    sh = kit.extrude_profile(plate, 0.016, axis='Y', mat=G)
    shield_m = Matrix.Translation(V((0, -0.44, 0))) @ P.rot_about('X', -8, (0, 0, 0.44))
    P.transform(sh, shield_m)
    parts.append(sh)
    bolts = [(x, 0.47) for x in (-0.6, -0.3, 0.3, 0.6)] + [(sx * 0.69, z) for sx in (-1, 1) for z in (0.7, 1.0, 1.25)] \
        + [(sx * 0.37, 1.47) for sx in (-1, 1)]
    P.nails(m, [shield_m @ V((x, -0.012, z)) for x, z in bolts], shield_m.to_3x3() @ V((0, -1, 0)), r=0.012, mat=D)
    P.bbox_mesh(m, (0.2, 0.02, 0.14), shield_m @ trs((-0.42, -0.018, 1.25)), G, 0.005)
    P.cyl_mesh(m, 0.012, 0.18, shield_m @ trs((-0.42, -0.02, 1.33), (0, 90, 0)), D, sides=6)
    for sx in (-1, 1):
        wing = [(0.0, 0.5), (0.36, 0.56), (0.36, 1.22), (0.0, 1.34)]
        wg = kit.extrude_profile([(sx * u, v) for u, v in wing] if sx > 0 else [(-u, v) for u, v in reversed(wing)],
                                 0.014, axis='Y', mat=G)
        P.transform(wg, Matrix.Translation(V((sx * 0.72, -0.44, 0))) @ Matrix.Rotation(math.radians(-sx * 32), 4, 'Z'))
        P.transform(wg, P.rot_about('X', -8, (0, -0.44, 0.44)))
        parts.append(wg)
    for x in (-0.5, 0.5):
        P.tube_mesh(m, [(x, -0.4, 0.62), (x * 0.5, -0.2, 0.46)], 0.02, G, sides=5)
    # the elevating mass, built along -Y at the trunnion then raised 25 deg
    g = Mesh()
    P.bbox_mesh(g, (0.15, 0.72, 0.2), trs((0, 0.1, 0.02)), D, 0.012)                      # receiver
    for x in (-0.045, 0.045):
        P.box_mesh(g, (0.02, 0.6, 0.015), trs((x, 0.08, 0.128)), D)                         # top cover ribs
    P.cyl_mesh(g, 0.05, 0.16, trs((0, 0.53, 0.02), (90, 0, 0)), D, sides=10)              # buffer housing
    P.bbox_mesh(g, (0.21, 0.6, 0.07), trs((0, 0.06, -0.11)), G, 0.008)                     # cradle
    P.tube_mesh(g, [(0.075, 0.25, 0.05), (0.13, 0.25, 0.06), (0.15, 0.3, 0.06)], 0.008, D, sides=4)   # cocking lever
    mag = [((-0.17, 0.02, 0.03), 0), ((-0.31, 0.035, 0.03), -12)]
    for (pos, yaw) in mag:                                                                  # curved 20-rd magazine
        P.bbox_mesh(g, (0.15, 0.095, 0.17), trs(pos, (0, 0, yaw)), D, 0.008)
    P.bbox_mesh(g, (0.11, 0.2, 0.13), trs((-0.2, 0.2, 0.22)), G, 0.01)                     # Flakvisier body
    P.box_mesh(g, (0.08, 0.012, 0.06), trs((-0.2, 0.094, 0.24)), 'glass')
    P.cyl_mesh(g, 0.025, 0.12, trs((-0.2, 0.32, 0.24), (90, 0, 0)), D, sides=8)
    P.box_mesh(g, (0.04, 0.04, 0.12), trs((-0.16, 0.26, 0.11)), G)
    ring = [(-0.2 + 0.07 * math.cos(2 * math.pi * k / 12), -0.12, 0.33 + 0.07 * math.sin(2 * math.pi * k / 12))
            for k in range(13)]
    P.tube_mesh(g, ring, 0.004, D, sides=3, caps=False)                                    # ring foresight
    P.tube_mesh(g, [(-0.27, -0.12, 0.33), (-0.13, -0.12, 0.33)], 0.002, D, sides=3)
    P.tube_mesh(g, [(-0.2, -0.12, 0.26), (-0.2, -0.12, 0.4)], 0.002, D, sides=3)
    P.box_mesh(g, (0.015, 0.18, 0.015), trs((-0.2, -0.04, 0.27)), D)
    P.box_mesh(g, (0.06, 0.22, 0.05), trs((0.0, 0.52, -0.06)), D)
    gun = [g]
    for y0, y1, r0, r1, verts in ((-0.25, -0.78, 0.05, 0.05, 12), (-0.78, -1.95, 0.029, 0.027, 10),
                                  (-1.95, -2.18, 0.03, 0.052, 12), (-0.2, -0.62, 0.034, 0.034, 10)):
        c = kit.cyl(r0, abs(y1 - y0), loc=(0, (y0 + y1) / 2, -0.085 if y0 == -0.2 else 0.0), rot=(90, 0, 0),
                    mat=D, verts=verts, radius2=r1)
        gun.append(c)
    for yb in (-0.3, -0.72):
        gun.append(kit.cyl(0.058, 0.03, loc=(0, yb, 0.0), rot=(90, 0, 0), mat=D, verts=12))
    gun_obj = P.join(gun, 'flak_gun')
    P.transform(gun_obj, Matrix.Translation(TR) @ Matrix.Rotation(math.radians(-25), 4, 'X'))
    muzzle = TR + Matrix.Rotation(math.radians(-25), 4, 'X') @ V((0, -2.18, 0))
    parts.append(gun_obj)
    # spare magazines: two on the rear arm, three in a rack on the carriage
    for i, (x, y) in enumerate(((0.12, 0.92), (-0.1, 1.0))):
        P.bbox_mesh(m, (0.3, 0.12, 0.17), trs((x, y, 0.27 + 0.085), (0, 0, 8 - 14 * i)), D, 0.01)
    for k in range(3):
        P.bbox_mesh(m, (0.095, 0.17, 0.15), trs((0.29, -0.12 + k * 0.11, 0.56), (90, 0, 90)), D, 0.008)
    P.box_mesh(m, (0.12, 0.36, 0.02), trs((0.29, -0.01, 0.48)), G)
    parts.append(m)
    obj = P.join(parts, 'flak38')
    cols = [ccyl((0, 0.05, 0), 0.5, 1.1), cbox((0, -0.47, 0.97), (1.5, 0.16, 1.06)),
            cbox((0, 0, 0.16), (2.04, 0.26, 0.32)), cbox((0, 0, 0.16), (0.26, 2.44, 0.32))]
    anchors = {'muzzle': tuple(muzzle), 'charge': ((0.82, 0.0, 0.27), 90.0), 'gunner': ((-0.32, 0.66, 0.76), 0.0)}
    CLOSE['flak38'] = ((0.0, 0.35, 0.2), -55.0, 15.0)
    return P.finish(obj, 'flak38', cols, anchors, grime=0.1, grime_height=0.4)


# ==========================================================================
# Opel Blitz 3-ton truck (intact / burnt out)

def truck(name, burnt):
    rng = random.Random(141 if burnt else 139)
    BODY = 'burnt_body' if burnt else 'camo_de'
    DARK = 'rust_dark' if burnt else 'metal_dark'
    WOOD = 'burnt' if burnt else 'wood'
    RUST = 'rust_dark' if burnt else 'rust'
    WOODH = 'burnt' if burnt else 'wood_h'
    R = 0.46
    dz = 0.16 if burnt else 0.0             # tyres gone: the truck sits on its rims
    FA, RA = -1.95, 1.6                      # front / rear axle y
    parts = []
    m = Mesh()
    w = Mesh()

    def Z(z):
        return z - dz

    # ---- running gear: wheels, leaf springs, axles, shaft, frame
    for (y, x) in ((FA, 0.83), (RA, 0.86)):
        for sx in (-1, 1):
            if burnt:
                P.wheel(w, (sx * x, y, 0.3), 0.48, 0.2, sx, rim_only=True, rim_mat=RUST, segs=16, nuts=6)
            else:
                P.wheel(w, (sx * x, y, R), R, 0.21, sx, mat_rim=BODY, segs=22, flat=0.22, tread=0.016, nuts=6)
    parts.append(w)
    for sx in (-1, 1):
        P.leaf_spring(m, (sx * 0.42, FA, Z(0.6)), 1.15, 0.06, 5, DARK if not burnt else RUST)
        P.leaf_spring(m, (sx * 0.42, RA, Z(0.6)), 1.4, 0.065, 6, DARK if not burnt else RUST)
        for y in (FA - 0.6, FA + 0.6, RA - 0.72, RA + 0.72):
            P.box_mesh(m, (0.05, 0.06, 0.1), trs((sx * 0.42, y, Z(0.6))), DARK)
    P.bbox_mesh(m, (1.5, 0.075, 0.11), trs((0, FA, Z(R + 0.04))), DARK, 0.01)
    P.tube_mesh(m, [(-0.72, FA + 0.22, Z(R)), (0.72, FA + 0.22, Z(R))], 0.018, DARK, sides=5)
    P.tube_mesh(m, [(-0.75, RA, Z(R)), (0.75, RA, Z(R))], 0.055, DARK, sides=8)
    P.cyl_mesh(m, 0.17, 0.26, trs((0, RA, Z(R)), (0, 90, 0)), DARK, sides=12)
    P.cyl_mesh(m, 0.1, 0.18, trs((0, RA - 0.18, Z(R + 0.02)), (90, 0, 0)), DARK, sides=10)
    P.tube_mesh(m, [(0, -1.05, Z(0.66)), (0, RA - 0.25, Z(R + 0.06))], 0.035, DARK, sides=6)
    for x in (-0.42, 0.42):
        P.bbox_mesh(m, (0.08, 5.7, 0.18), trs((x, 0.05, Z(0.72))), DARK, 0.01, occ_bottom=0.3)
    for y in (-2.6, -1.3, 0.45, 2.8):
        P.box_mesh(m, (0.84, 0.07, 0.12), trs((0, y, Z(0.72))), DARK)
    P.bbox_mesh(m, (0.6, 1.1, 0.42), trs((0, -2.05, Z(0.8))), DARK, 0.03)              # engine block / gearbox
    P.bbox_mesh(m, (0.32, 0.5, 0.28), trs((0, -1.25, Z(0.68))), DARK, 0.02)
    # ---- bumper, tow hooks, front plate
    bump_rot = (0, 0, 1.5) if burnt else (0, 0, 0)
    P.bbox_mesh(m, (2.0, 0.12, 0.14), trs((0, -2.93, Z(0.6)), bump_rot), DARK, 0.015)
    for x in (-0.42, 0.42):
        P.box_mesh(m, (0.06, 0.2, 0.08), trs((x, -2.82, Z(0.62))), DARK)
        P.tube_mesh(m, [(x, -2.99, Z(0.52)), (x, -3.06, Z(0.52)), (x, -3.07, Z(0.6)), (x, -3.03, Z(0.64))], 0.016,
                    DARK, sides=5)
    P.box_mesh(m, (0.42, 0.012, 0.11), trs((0.48, -3.0, Z(0.6))), 'plate' if not burnt else 'burnt')
    # ---- bonnet: lofted, louvres, catches; burnt: the left side panel gone
    def bon(y, sw, top):
        pr = [(-0.48, 0.95), (-0.48, top - 0.15), (-0.45, top - 0.06), (-0.37, top - 0.02), (-0.2, top - 0.003),
              (0.0, top)]
        pr = pr + [(-x, z) for x, z in reversed(pr[:-1])]
        return [V((x * sw, y, Z(z))) for x, z in pr]
    rings = [bon(-2.78, 0.96, 1.575), bon(-2.42, 0.975, 1.587), bon(-2.06, 0.99, 1.6), bon(-1.7, 0.995, 1.612),
             bon(-1.36, 1.0, 1.625)]
    P.loft(m, rings, BODY, closed=False, cap0=True, skip=(0,) if burnt else ())
    if burnt:   # the side panel lies in the dirt
        P.bbox_mesh(m, (0.012, 1.2, 0.5), trs((-0.95, -2.1, 0.1), (0, 78, 4)), BODY, 0.005)
    for sx in (-1, 1):
        if burnt and sx < 0:
            continue
        for i in range(8):
            y = -2.0 + i * 0.07
            P.box_mesh(m, (0.012, 0.03, 0.26), trs((sx * 0.485, y, Z(1.28)), (0, 0, sx * 25)), DARK)
        for y in (-2.55, -1.6):
            P.box_mesh(m, (0.02, 0.06, 0.04), trs((sx * 0.488, y, Z(1.35))), DARK)
    P.box_mesh(m, (0.012, 1.38, 0.012), trs((0, -2.07, Z(1.625))), DARK)                 # hinge line
    # ---- grille
    grille = [(-0.4, 0.8), (0.4, 0.8), (0.4, 1.4), (0.33, 1.52), (0.18, 1.575), (0.0, 1.585), (-0.18, 1.575),
              (-0.33, 1.52), (-0.4, 1.4)]
    gs = kit.extrude_profile([(x, Z(z)) for x, z in grille], 0.06, axis='Y', mat=BODY)
    gs.location = (0, -2.8, 0)
    parts.append(gs)
    for i in range(13):
        x = -0.33 + i * 0.055
        top = 1.5 - 0.22 * (x / 0.4) ** 2
        P.box_mesh(m, (0.018, 0.03, top - 0.86), trs((x, -2.835, Z((top + 0.86) / 2))), DARK)
    P.box_mesh(m, (0.74, 0.035, 0.05), trs((0, -2.84, Z(0.85))), BODY)
    P.cyl_mesh(m, 0.045, 0.02, trs((0, -2.855, Z(1.47)), (90, 0, 0)), DARK, sides=10)
    # ---- headlights on stalks, blackout lamp on the left wing
    for sx in (-1, 1):
        hc = V((sx * 0.68, -2.55, Z(1.2)))
        P.cyl_mesh(m, 0.105, 0.15, trs(hc, (90, 0, 0)), BODY, sides=14, r2=0.12)
        P.cyl_mesh(m, 0.125, 0.025, trs(hc + V((0, -0.08, 0)), (90, 0, 0)), DARK, sides=14)
        if not burnt:
            P.cyl_mesh(m, 0.105, 0.012, trs(hc + V((0, -0.09, 0)), (90, 0, 0)), 'glass', sides=14)
        P.box_mesh(m, (0.04, 0.04, 0.16), trs((sx * 0.68, -2.5, Z(1.07))), DARK)
    P.cyl_mesh(m, 0.05, 0.1, trs((-0.86, -2.62, Z(1.07)), (90, 0, 0)), DARK, sides=10)
    # ---- front wings sweeping into the running boards, ribbed treads
    sec = list(reversed([(-0.21, -0.07), (-0.2, 0.0), (-0.12, 0.024), (0.0, 0.03), (0.12, 0.024), (0.2, 0.0),
                         (0.21, -0.07), (0.19, -0.07), (0.0, 0.0), (-0.19, -0.07)]))
    path = [(-2.74, 0.74), (-2.7, 0.81), (-2.63, 0.88), (-2.54, 0.95)]
    for th in range(50, 141, 10):
        a = math.radians(th)
        path.append((FA - 0.6 * math.cos(a), R + 0.6 * math.sin(a)))
    path += [(-1.43, 0.84), (-1.38, 0.76), (-1.32, 0.69), (-1.24, 0.645), (-1.0, 0.632), (-0.5, 0.63), (-0.06, 0.63)]
    for sx in (-1, 1):
        pts = [V((sx * 0.86, y, Z(z))) for y, z in path]
        P.sweep(m, pts, sec, BODY, closed=True, caps=True, lateral=(1, 0, 0), soft=True)
        P.box_mesh(m, (0.24, 0.05, 0.04), trs((sx * 0.62, -1.1, Z(0.64))), DARK)       # wing stay
        for k in range(3):
            P.box_mesh(m, (0.012, 1.0, 0.008), trs((sx * (0.78 + k * 0.08), -0.62, Z(0.664))),
                           'burnt' if burnt else 'rubber')
    # ---- cab: extruded side profile, hollowed, window openings, door seams
    side = [(-1.38, 0.64), (-0.06, 0.64), (-0.06, 2.1), (-0.15, 2.2), (-1.12, 2.2), (-1.23, 2.12), (-1.33, 1.63),
            (-1.38, 1.6)]
    cab = kit.extrude_profile([(y, Z(z)) for y, z in side], 1.96, axis='X', mat=BODY)
    kit.bevel(cab, 0.08, 3, 30)
    inner = kit.extrude_profile([(y, Z(z)) for y, z in ((-1.31, 0.7), (-0.11, 0.7), (-0.11, 2.13), (-1.15, 2.13),
                                                       (-1.26, 1.62), (-1.31, 1.6))], 1.88, axis='X', mat=BODY)
    kit.cut(cab, inner)
    for x in (-0.45, 0.45):
        kit.cut(cab, kit.box((0.8, 0.4, 0.4), loc=(x, -1.28, Z(1.87)), rot=(-10.2, 0, 0), mat=BODY))
    kit.cut(cab, kit.box((2.2, 0.62, 0.4), loc=(0, -0.78, Z(1.83)), mat=BODY))
    kit.cut(cab, kit.box((0.62, 0.3, 0.26), loc=(0, -0.06, Z(1.83)), mat=BODY))
    seams = []
    for sx in (-1, 1):
        for y in (-1.15, -0.2):
            seams.append(kit.box((0.05, 0.008, 1.42), loc=(sx * 0.99, y, Z(1.36)), mat=BODY))
        seams.append(kit.box((0.05, 0.95, 0.008), loc=(sx * 0.99, -0.675, Z(0.68)), mat=BODY))
    kit.cut(cab, kit.join(seams, 'seams'))
    if burnt:   # the left door hangs open on one hinge
        kit.cut(cab, kit.box((0.2, 0.94, 1.36), loc=(-0.98, -0.675, Z(1.37)), mat=BODY))
        door = Mesh()
        P.bbox_mesh(door, (0.04, 0.92, 1.34), trs((0, 0.46, 0.67)), BODY, 0.02)
        P.box_mesh(door, (0.03, 0.08, 0.03), trs((-0.03, 0.75, 0.8)), RUST)
        d = door.build('door')
        P.transform(d, trs((-0.99, -1.14, Z(0.69))) @ Matrix.Rotation(math.radians(-38), 4, 'Z')
                    @ Matrix.Rotation(math.radians(5), 4, 'Y'))
        parts.append(d)
    parts.append(cab)
    if not burnt:
        for x in (-0.45, 0.45):
            parts.append(kit.box((0.8, 0.012, 0.4), loc=(x, -1.285, Z(1.87)), rot=(-10.2, 0, 0), mat='glass'))
            P.tube_mesh(m, [(x - 0.25, -1.3, Z(2.06)), (x + 0.12, -1.315, Z(1.75))], 0.006, DARK, sides=4)
        for sx in (-1, 1):
            parts.append(kit.box((0.012, 0.62, 0.4), loc=(sx * 0.955, -0.78, Z(1.83)), mat='glass'))
        parts.append(kit.box((0.62, 0.012, 0.26), loc=(0, -0.085, Z(1.83)), mat='glass'))
    for sx in (-1, 1):
        P.box_mesh(m, (0.03, 0.08, 0.025), trs((sx * 0.995, -0.5, Z(1.45))), DARK)      # door handles
        P.box_mesh(m, (0.03, 1.2, 0.02), trs((sx * 0.99, -0.7, Z(2.06))), BODY)         # rain gutters
        if not (burnt and sx < 0):
            for z in (1.0, 1.75):
                P.cyl_mesh(m, 0.018, 0.09, trs((sx * 0.995, -1.13, Z(z))), DARK, sides=6)
        if not burnt:
            P.tube_mesh(m, [(sx * 0.98, -1.25, Z(1.75)), (sx * 1.18, -1.32, Z(1.85))], 0.012, DARK, sides=4)
            P.bbox_mesh(m, (0.03, 0.12, 0.16), trs((sx * 1.19, -1.32, Z(1.9))), DARK, 0.008)
    # ---- cab interior: bench (springs when burnt), wheel, dash with dials, levers, pedals
    if burnt:
        P.box_mesh(m, (1.7, 0.45, 0.04), trs((0, -0.4, Z(0.98))), RUST)
        for i in range(6):
            for j in range(2):
                P.tube_mesh(m, [(-0.7 + i * 0.28 + 0.06 * math.cos(a), -0.5 + j * 0.2 + 0.06 * math.sin(a),
                                 Z(1.0) + a * 0.012) for a in [k * 0.9 for k in range(9)]], 0.005, RUST, sides=3)
    else:
        P.bbox_mesh(m, (1.7, 0.45, 0.12), trs((0, -0.4, Z(1.05))), 'leather', 0.03)
        P.bbox_mesh(m, (1.7, 0.1, 0.5), trs((0, -0.17, Z(1.35)), (-8, 0, 0)), 'leather', 0.03)
    P.box_mesh(m, (1.8, 0.12, 0.2), trs((0, -1.24, Z(1.5))), BODY)
    if not burnt:
        for x in (-0.55, -0.4, -0.25):
            P.cyl_mesh(m, 0.03, 0.01, trs((x, -1.18, Z(1.52)), (90, 0, 0)), 'glass', sides=8)
    sw = [(-0.45 + 0.19 * math.cos(2 * math.pi * k / 12), -1.0 + 0.04 * math.sin(2 * math.pi * k / 12),
           Z(1.48) + 0.19 * math.sin(2 * math.pi * k / 12)) for k in range(13 if not burnt else 8)]
    P.tube_mesh(m, sw, 0.014, 'rubber' if not burnt else RUST, sides=5, caps=burnt)
    for a in (90, 210, 330):
        aa = math.radians(a)
        P.tube_mesh(m, [(-0.45, -1.0, Z(1.48)), (-0.45 + 0.18 * math.cos(aa), -1.0, Z(1.48) + 0.18 * math.sin(aa))],
                    0.007, DARK, sides=4)
    P.tube_mesh(m, [(-0.45, -1.0, Z(1.48)), (-0.45, -1.3, Z(1.1))], 0.025, DARK, sides=6)
    P.tube_mesh(m, [(0.05, -0.85, Z(0.72)), (0.0, -0.8, Z(1.1))], 0.012, DARK, sides=5)
    P.cyl_mesh(m, 0.025, 0.04, trs((0.0, -0.8, Z(1.12))), 'rubber' if not burnt else RUST, sides=8)
    for x in (-0.6, -0.45, -0.3):
        P.box_mesh(m, (0.06, 0.03, 0.09), trs((x, -1.18, Z(0.8)), (30, 0, 0)), DARK)
    # ---- cargo bed
    BY0, BY1, BW, FLOOR = 0.02, 3.0, 2.26, 1.18
    for y in (0.3, 1.1, 1.9, 2.7):
        P.box_mesh(m, (2.0, 0.08, 0.1), trs((0, y, Z(1.06))), DARK)
    n = 14
    for i in range(n):
        x = -BW / 2 + (i + 0.5) * BW / n
        if burnt:
            if rng.random() < 0.35:
                continue
            L = (BY1 - BY0) * rng.uniform(0.35, 1.0)
            y0 = BY0 if rng.random() < 0.5 else BY1 - L
            P.box_mesh(m, (BW / n - 0.01, L, 0.05), trs((x, y0 + L / 2, Z(1.135)), (rng.uniform(-2, 2), 0, 0)), WOOD)
        else:
            P.box_mesh(m, (BW / n - 0.008, BY1 - BY0, 0.05), trs((x, (BY0 + BY1) / 2, Z(1.155))), WOOD)
    for k in range(3):
        z = FLOOR + 0.075 + k * 0.155
        for sx in (-1, 1):
            if burnt and (k > 0 or rng.random() < 0.4):
                continue
            P.box_mesh(m, (0.035, BY1 - BY0, 0.145), trs((sx * (BW / 2 - 0.0175), (BY0 + BY1) / 2, Z(z))), WOODH)
        if not burnt or k == 0:
            P.box_mesh(m, (BW, 0.035, 0.145), trs((0, BY0 + 0.0175, Z(z + (0.1 if not burnt else 0)))), WOODH)
        if not burnt:
            P.box_mesh(m, (BW, 0.035, 0.145), trs((0, BY1 - 0.0175, Z(z))), WOODH)
    if burnt:
        P.box_mesh(m, (BW - 0.05, 0.04, 0.46), trs((0, BY1 + 0.03, Z(FLOOR - 0.24)), (4, 0, 0)), WOOD)
    else:
        for x in (-1.0, 1.0):
            P.tube_mesh(m, [(x, BY1 - 0.04, Z(FLOOR + 0.42)), (x * 1.01, BY1 + 0.01, Z(FLOOR + 0.3)),
                            (x, BY1 - 0.02, Z(FLOOR + 0.2))], 0.006, DARK, sides=3)
    for sx in (-1, 1):
        for y in (0.45, 1.25, 2.05, 2.85):
            P.box_mesh(m, (0.02, 0.06, 0.5), trs((sx * (BW / 2 + 0.008), y, Z(FLOOR + 0.22))), DARK)
        if not burnt:
            for y in (0.8, 1.6, 2.4):
                P.cyl_mesh(m, 0.015, 0.07, trs((sx * (BW / 2 + 0.01), y, Z(FLOOR + 0.04)), (90, 0, 0)), DARK, sides=6)
    # ---- rear mudguards, tool box, jerrycan rack, fuel tank, exhaust, lights
    rsec = [(-0.13, -0.01), (0.13, -0.01), (0.13, 0.01), (-0.13, 0.01)]
    for sx in (-1, 1):
        pts = [V((sx * 0.86, RA - 0.57 * math.cos(math.radians(a)), Z(R + 0.57 * math.sin(math.radians(a)) - 0.02)))
               for a in (30, 50, 70, 90, 110, 130, 150)]
        P.sweep(m, pts, rsec, DARK if burnt else BODY, closed=True, caps=True, lateral=(1, 0, 0))
    P.bbox_mesh(m, (0.3, 0.6, 0.3), trs((-0.95, 0.55, Z(0.85))), DARK, 0.015)
    if not burnt:
        for y in (0.5, 0.88):
            P.jerrycan(m, trs((0.98, y, Z(0.62)), (0, 0, 90)), BODY)
        P.box_mesh(m, (0.05, 0.6, 0.03), trs((0.98, 0.69, Z(0.6))), DARK)
    P.cyl_mesh(m, 0.17, 0.75, trs((0.78, -0.75, Z(0.84)), (90, 0, 0)), DARK if burnt else BODY, sides=12)
    P.tube_mesh(m, [(-0.55, -1.2, Z(0.6)), (-0.6, 0.4, Z(0.62)), (-0.62, 2.2, Z(0.68)), (-0.64, 2.75, Z(0.72))],
                0.035, RUST, sides=6)
    P.cyl_mesh(m, 0.08, 0.5, trs((-0.6, 0.0, Z(0.62)), (90, 0, 0)), RUST, sides=10)
    for x in (-0.45, 0.45):
        P.bbox_mesh(m, (0.05, 0.12, 0.04), trs((x, -3.0, Z(0.55))), DARK, 0.005)
        P.cyl_mesh(m, 0.04, 0.03, trs((x * 2.0, 3.0, Z(1.0)), (90, 0, 0)), RUST if burnt else 'paint_red', sides=10)
    P.box_mesh(m, (0.42, 0.012, 0.11), trs((-0.6, 3.03, Z(0.95))), 'plate' if not burnt else 'burnt')
    # ---- tilt over hoops (intact: canvas with folds and lashing) / bare hoops (burnt)
    hoop = [(-1.13, 1.6), (-1.13, 2.2), (-1.13, 2.55), (-1.09, 2.68), (-1.0, 2.78), (-0.82, 2.86), (-0.42, 2.9),
            (0.0, 2.91)]
    hoop = hoop + [(-x, z) for x, z in reversed(hoop[:-1])]
    hoops_y = (0.12, 1.08, 2.04, 2.95)
    if burnt:
        for i, y in enumerate(hoops_y):
            if i == 3:
                continue
            lean = (0, 8, -10)[i]
            bend = P.rot_about('X', lean, (0, y, Z(1.6)))
            pts = []
            for x, z in hoop:
                if i == 1 and z > 2.0:
                    z -= 0.32 * max(0.0, x + 0.3) / 1.43 * (z - 2.0) / 0.9
                pts.append(bend @ V((x, y, Z(z))))
            P.tube_mesh(m, pts, 0.018, RUST, sides=5)
    else:
        from mathutils import noise as mnoise
        tilt = Mesh()
        rings = []
        ys = []
        for i in range(len(hoops_y) - 1):
            a, b = hoops_y[i], hoops_y[i + 1]
            ys += [(a + (b - a) * f, math.sin(math.pi * f)) for f in (0.0, 0.2, 0.4, 0.6, 0.8)]
        ys.append((hoops_y[-1], 0.0))
        for j, (y, sag) in enumerate(ys):
            ring = []
            for k, (x, z) in enumerate(hoop):
                if 0 < k < len(hoop) - 1:
                    fold = 0.012 * mnoise.noise(V((y * 3.1, k * 0.7, 2.3)))
                    if z > 2.6:
                        z -= sag * (0.065 + rng.uniform(0, 0.012)) - fold
                    else:
                        x -= math.copysign(sag * (0.02 + rng.uniform(0, 0.008)) + fold, x)
                ring.append(V((x * 1.01, y, Z(z))))
            rings.append(ring)
        rings[0] = [V((p.x, BY0 + 0.03, p.z)) for p in rings[0]]
        rings[-1] = [V((p.x, BY1 + 0.01, p.z)) for p in rings[-1]]
        P.loft(tilt, rings, 'canvas', closed=False, cap0=True, cap1=True, soft=True)
        for vi, p in enumerate(tilt.v):        # water stands in the sag between the hoops
            f = min(abs(p.y - hy) for hy in hoops_y)
            if p.z > Z(2.6):
                tilt.wet[vi] = min(1.0, f / 0.45) * min(1.0, (p.z - Z(2.6)) / 0.25)
        for x in (-0.6, 0.6):          # rear flap straps and buckles
            P.box_mesh(tilt, (0.05, 0.012, 1.1), trs((x, BY1 + 0.016, Z(2.1))), 'webbing')
            P.box_mesh(tilt, (0.06, 0.016, 0.05), trs((x, BY1 + 0.02, Z(1.75))), DARK)
        # lashing rope laced from eyelets in the hem to hooks under the boards
        for sx in (-1, 1):
            pts = []
            for k in range(25):
                y = BY0 + 0.1 + k * (BY1 - BY0 - 0.2) / 24
                pts.append(V((sx * 1.15, y, Z(1.6 if k % 2 == 0 else 1.47))))
            P.tube_mesh(tilt, pts, 0.008, 'webbing', sides=4)
        parts.append(tilt)
    parts.append(m)
    obj = P.join(parts, name)
    if burnt:
        kit.jitter(obj, 0.015, seed=5, scale=3.0)
        P.transform(obj, P.rot_about('Y', 1.6, (0, 0, 0)))
    cols = [cbox((0, -2.15, Z(0.8)), (2.1, 1.6, Z(1.6))), cbox((0, -0.72, Z(1.1)), (1.98, 1.34, Z(2.2))),
            cbox((0, 1.5, Z(1.45 if not burnt else 0.85)), (2.28, 3.0, Z(2.9 if not burnt else 1.7)))]
    anchors = {}
    if burnt:
        anchors['fire'] = (0.0, -0.72, Z(1.25))
    CLOSE[name] = ((0.0, -0.1, 0.0), -32.0, 8.0)
    return P.finish(obj, name, cols, anchors or None, grime=0.45 if burnt else 0.3, grime_height=1.0,
                    hard_angle=35)


@builder
def build_truck():
    return truck('truck', False)


@builder
def build_truck_burnt():
    return truck('truck_burnt', True)


# ==========================================================================
# Willys MB, wrecked nose-down in a ditch

@builder
def build_jeep_wreck():
    O = 'olive_wreck'
    D = 'metal_dark'
    FA, RA, R = -1.0, 1.03, 0.36
    parts = []
    m = Mesh()
    w = Mesh()
    rng = random.Random(151)
    # wheels (combat tread): front right tyre flat
    for y in (FA, RA):
        for sx in (-1, 1):
            flat = 0.85 if (y == FA and sx > 0) else 0.2
            P.wheel(w, (sx * 0.62, y, R), R, 0.16, sx, mat_rim=O, segs=16, flat=flat, tread=0.014, nuts=5)
    parts.append(w)
    sp = Mesh()
    P.wheel(sp, (0, 0, 0), R, 0.16, 1, mat_rim=O, segs=16, tread=0.014, nuts=5)
    spo = sp.build('spare')
    P.transform(spo, Matrix.Translation(V((0.28, 1.8, 0.7))) @ Matrix.Rotation(math.radians(90), 4, 'Z'))
    parts.append(spo)
    P.box_mesh(m, (0.06, 0.1, 0.4), trs((0.28, 1.73, 0.62)), D)
    # chassis, axles with differentials, leaf springs, steering
    for x in (-0.33, 0.33):
        P.bbox_mesh(m, (0.06, 3.25, 0.12), trs((x, 0.02, 0.44)), D, 0.008, occ_bottom=0.3)
        for y, L in ((FA, 0.9), (RA, 1.0)):
            P.leaf_spring(m, (x, y, 0.47), L, 0.045, 4, D, arch=0.04)
    for y in (FA, RA):
        P.tube_mesh(m, [(-0.56, y, R), (0.56, y, R)], 0.04, D, sides=8)
        P.cyl_mesh(m, 0.11, 0.18, trs((0.12, y, R), (0, 90, 0)), D, sides=10)
    P.tube_mesh(m, [(-0.55, FA + 0.15, R + 0.02), (0.55, FA + 0.15, R + 0.02)], 0.014, D, sides=5)
    P.tube_mesh(m, [(0.1, -0.6, 0.48), (0.12, RA - 0.15, R + 0.04)], 0.028, D, sides=6)
    # body tub: extruded side profile, hollowed, rear wheel arches, a dented, bent skin
    side = [(-0.42, 0.45), (1.7, 0.45), (1.7, 0.95), (0.62, 0.95), (0.5, 0.74), (-0.2, 0.74), (-0.3, 0.98),
            (-0.42, 0.98)]
    tub = kit.extrude_profile(side, 1.22, axis='X', mat=O)
    kit.bevel(tub, 0.02, 2, 30)
    kit.cut(tub, kit.box((1.12, 1.88, 0.8), loc=(0, 0.72, 0.55 + 0.4), mat=O))
    for sx in (-1, 1):
        kit.cut(tub, kit.cyl(0.43, 0.3, loc=(sx * 0.62, RA, R), rot=(0, 90, 0), mat=O, verts=20))
    kit.subdivide(tub, 1, simple=True)
    kit.jitter(tub, 0.012, seed=3, scale=2.5)
    parts.append(tub)
    for x in (-0.61, 0.61):                                                  # tub top rail
        P.box_mesh(m, (0.025, 1.05, 0.02), trs((x, 1.17, 0.955)), O)
    P.bbox_mesh(m, (1.22, 0.06, 0.05), trs((0, 1.7, 0.47)), O, 0.008)
    # bonnet sprung and dented, engine below it, grille with slots and headlamps
    hood = kit.box((0.96, 1.13, 0.18), loc=(0, -0.985, 0.89), mat=O, bevel=0.025)
    kit.subdivide(hood, 1, simple=True)
    kit.jitter(hood, 0.015, seed=8, scale=3.0)
    P.transform(hood, P.rot_about('Y', -5, (-0.48, -0.985, 0.98)))
    parts.append(hood)
    for sx in (-1, 1):
        P.box_mesh(m, (0.02, 0.06, 0.03), trs((sx * 0.485, -1.45, 0.93)), D)      # bonnet clamps
    P.bbox_mesh(m, (0.8, 1.05, 0.3), trs((0, -0.98, 0.64)), D, 0.02, occ_bottom=0.5)
    P.bbox_mesh(m, (0.86, 0.04, 0.47), trs((0, -1.57, 0.73)), O, 0.008)
    for i in range(9):
        x = -0.2 + i * 0.05
        P.box_mesh(m, (0.026, 0.012, 0.3), trs((x, -1.592, 0.68)), D)
    for sx in (-1, 1):
        P.cyl_mesh(m, 0.085, 0.05, trs((sx * 0.3, -1.6, 0.86), (90, 0, 0)), O, sides=14)
        P.cyl_mesh(m, 0.09, 0.012, trs((sx * 0.3, -1.625, 0.86), (90, 0, 0)), D, sides=14)
        if sx < 0:
            P.cyl_mesh(m, 0.075, 0.01, trs((sx * 0.3, -1.632, 0.86), (90, 0, 0)), 'glass', sides=14)
    # flat front wings with a turned-down outer lip, bent on the right
    sec = [(-0.16, -0.008), (0.14, -0.008), (0.14, -0.06), (0.16, -0.06), (0.16, 0.012), (-0.16, 0.012)]
    path = [(-1.63, 0.6), (-1.61, 0.68), (-1.57, 0.75), (-1.52, 0.8), (-1.2, 0.81), (-0.8, 0.81), (-0.44, 0.8)]
    for sx in (-1, 1):
        sct = sec if sx > 0 else [(-u, v) for u, v in reversed(sec)]
        pts = [V((sx * 0.63, y, z - (0.07 * max(0.0, -1.0 - y) if sx > 0 else 0.0))) for y, z in path]
        P.sweep(m, pts, sct, O, closed=True, caps=True, lateral=(1, 0, 0))
        P.box_mesh(m, (0.2, 0.08, 0.04), trs((sx * 0.68, -0.36, 0.56)), O)
    # bumper, the right half bent back; tow hooks; tail lights, pintle
    P.bbox_mesh(m, (0.8, 0.08, 0.12), trs((-0.38, -1.68, 0.47)), D, 0.008)
    P.bbox_mesh(m, (0.78, 0.08, 0.12), trs((0.36, -1.64, 0.43), (8, 0, -12)), D, 0.008)
    for x in (-0.55, 0.55):
        P.bbox_mesh(m, (0.1, 0.08, 0.1), trs((x, 1.73, 0.5)), D, 0.008)
        P.tube_mesh(m, [(x * 0.8, -1.7, 0.4), (x * 0.8, -1.76, 0.4), (x * 0.8, -1.77, 0.46)], 0.012, D, sides=5)
        P.cyl_mesh(m, 0.035, 0.03, trs((x, 1.71, 0.72), (90, 0, 0)), 'paint_red', sides=8)
    P.tube_mesh(m, [(0, 1.72, 0.47), (0, 1.8, 0.47), (0, 1.82, 0.53)], 0.018, D, sides=6)
    # windscreen frame folded onto the bonnet: one pane shattered, the right post torn and bent up
    ws = Mesh()
    for (sx_, sz_, x, z) in ((1.24, 0.035, 0, 0.02), (1.24, 0.035, 0, 0.42), (0.035, 0.42, -0.6, 0.22),
                             (0.03, 0.42, 0.0, 0.22)):
        P.bbox_mesh(ws, (sx_, 0.035, sz_), trs((x, 0, z)), O, 0.006)
    P.box_mesh(ws, (0.56, 0.01, 0.36), trs((-0.3, 0, 0.22)), 'glass')
    tri = ((0.04, 0.0, 0.05), (0.3, 0.0, 0.05), (0.12, 0.0, 0.2))
    ws.face([ws.vert(p) for p in tri], 'glass')                                   # a shard, both sides
    ws.face([ws.vert((x, y + 0.002, z)) for x, y, z in reversed(tri)], 'glass')
    wso = ws.build('windscreen')
    P.transform(wso, Matrix.Translation(V((0, -0.42, 0.99))) @ Matrix.Rotation(math.radians(78), 4, 'X')
                @ Matrix.Rotation(math.radians(4), 4, 'Y'))
    parts.append(wso)
    P.tube_mesh(m, [(0.6, -0.42, 0.99), (0.62, -0.5, 1.12), (0.66, -0.66, 1.2), (0.7, -0.75, 1.18)], 0.016, O, sides=5)
    # seats on tube frames, wheel, levers, dash, pedals
    for x in (-0.3, 0.3):
        P.bbox_mesh(m, (0.42, 0.42, 0.09), trs((x, 0.0, 0.62)), 'canvas', 0.03)
        P.bbox_mesh(m, (0.42, 0.07, 0.36), trs((x, 0.24, 0.84), (-12, 0, 0)), 'canvas', 0.025)
        P.tube_mesh(m, [(x - 0.2, -0.2, 0.55), (x - 0.2, 0.2, 0.55), (x - 0.2, 0.26, 1.0)], 0.012, D, sides=4)
        P.tube_mesh(m, [(x + 0.2, -0.2, 0.55), (x + 0.2, 0.2, 0.55), (x + 0.2, 0.26, 1.0)], 0.012, D, sides=4)
    P.bbox_mesh(m, (1.0, 0.36, 0.08), trs((0, 1.2, 0.64)), 'canvas', 0.02)
    P.bbox_mesh(m, (1.0, 0.06, 0.28), trs((0, 1.62, 0.8)), 'canvas', 0.02)
    sw = []
    for k in range(15):
        a = 2 * math.pi * k / 14
        sw.append(V((-0.3 + 0.17 * math.cos(a), -0.2 + 0.1 * math.sin(a), 1.02 + 0.14 * math.sin(a))))
    P.tube_mesh(m, sw, 0.012, 'rubber', sides=5, caps=False)
    for a in (90, 210, 330):
        aa = math.radians(a)
        P.tube_mesh(m, [(-0.3, -0.2, 1.02), (-0.3 + 0.16 * math.cos(aa), -0.2 + 0.09 * math.sin(aa),
                                              1.02 + 0.13 * math.sin(aa))], 0.006, D, sides=4)
    P.tube_mesh(m, [(-0.3, -0.2, 1.02), (-0.3, -0.38, 0.8)], 0.02, D, sides=6)
    for x, lean in ((0.0, 8), (0.07, -5), (0.12, 12)):
        P.tube_mesh(m, [(x, -0.25, 0.55), (x + 0.02, -0.25 + 0.05 * math.sin(math.radians(lean)), 0.8)], 0.008, D, sides=4)
        P.cyl_mesh(m, 0.016, 0.03, trs((x + 0.02, -0.25, 0.81)), 'rubber', sides=6)
    P.box_mesh(m, (1.1, 0.06, 0.16), trs((0, -0.36, 0.9)), O)
    for x in (-0.35, -0.2, 0.15):
        P.cyl_mesh(m, 0.03, 0.01, trs((x, -0.39, 0.92), (90, 0, 0)), 'glass', sides=8)
    # pioneer tools strapped to the left side: shovel and axe
    P.tube_mesh(m, [(-0.625, -0.2, 0.62), (-0.625, 0.62, 0.66)], 0.016, 'wood', sides=6)
    P.bbox_mesh(m, (0.01, 0.24, 0.17), trs((-0.627, 0.72, 0.67)), D, 0.003)
    P.tube_mesh(m, [(-0.625, 0.95, 0.62), (-0.625, 1.55, 0.68)], 0.016, 'wood', sides=6)
    P.bbox_mesh(m, (0.012, 0.09, 0.15), trs((-0.627, 1.57, 0.66)), D, 0.003)
    for y in (0.1, 0.5, 1.1, 1.4):
        P.box_mesh(m, (0.012, 0.03, 0.06), trs((-0.63, y, 0.64)), 'leather')
    # jerrycan in its bracket at the rear left
    P.jerrycan(m, trs((-0.36, 1.81, 0.52), (0, 0, 0)), 'metal_olive')
    P.box_mesh(m, (0.38, 0.03, 0.03), trs((-0.36, 1.81, 0.86)), D)
    parts.append(m)
    obj = P.join(parts, 'jeep_wreck')
    # nose down into the ditch: pitch about the rear-left tyre contact, then roll to the right
    P.transform(obj, P.rot_about('Y', 5.0, (-0.62, RA, 0)) @ P.rot_about('X', 9.0, (0, RA, 0)))
    cols = [cbox((0, 0.85, 0.5), (1.4, 1.75, 1.0)), cbox((0, -0.95, 0.22), (1.5, 1.45, 0.9))]
    CLOSE['jeep_wreck'] = ((0.0, 0.0, 0.0), -35.0, 14.0)
    return P.finish(obj, 'jeep_wreck', cols, {'smoke': (0.0, -1.0, 0.9)}, grime=0.45, grime_height=0.9,
                    center='xy', hard_angle=35)


# ==========================================================================
# main

@builder
def build_ammo_stack():
    m = Mesh()
    rng = random.Random(161)
    # boarded 7.5 cm shell crates cross-stacked three high, MG cans on top
    layout = [(0, [((i - 0.5) * 0.73, (j - 1) * 0.42, 0) for i in range(2) for j in range(3)]),
              (1, [((i - 0.5) * 0.42, (j - 0.5) * 0.73, 90) for i in range(2) for j in range(2)]),
              (2, [(-0.365, (j - 0.5) * 0.42, 0) for j in range(2)])]
    for layer, cells in layout:
        for (x, y, yaw) in cells:
            P.plank_crate(m, trs((x, y, layer * 0.335), (0, 0, yaw + rng.uniform(-3, 3))), (0.7, 0.4, 0.3), rng=rng)
    P.ammo_can(m, trs((0.25, 0.2, 0.67), (0, 0, 80)))
    P.ammo_can(m, trs((0.25, -0.2, 0.67), (0, 0, 95)))
    P.ammo_can(m, trs((-0.3, 0.1, 1.005), (0, 0, 15)))
    obj = P.join([m], 'ammo_stack')
    return P.finish(obj, 'ammo_stack', [cbox((0, 0, 0.335), (1.45, 1.26, 0.67)), cbox((-0.365, 0, 0.84), (0.72, 0.84, 0.34))],
                    grime=0.2, grime_height=0.4)


@builder
def build_jerrycan_stack():
    m = Mesh()
    rng = random.Random(163)
    # a low plank pallet, two rows of three upright, three lying across on top, one fallen
    for y in (-0.3, 0.0, 0.3):
        P.box_mesh(m, (1.2, 0.09, 0.03), trs((0, y, 0.085)), 'wood_old_h')
    for x in (-0.5, 0.0, 0.5):
        P.box_mesh(m, (0.09, 0.75, 0.07), trs((x, 0, 0.035)), 'wood_old', occ_bottom=0.4)
    for i in range(3):
        for j in range(2):
            P.jerrycan(m, trs(((i - 1) * 0.37, (j - 0.5) * 0.18 * 1.05, 0.1), (0, 0, rng.uniform(-3, 3))),
                       'metal_gray' if (i + j) % 3 else 'paint_sand')
    # top: two cans laid flat across the row at odd angles, one standing
    P.jerrycan(m, trs((-0.25, 0.02, 0.655), (90, 0, 78)) @ trs((0, 0, -0.235)), 'metal_gray')
    P.jerrycan(m, trs((0.22, -0.03, 0.655), (90, 0, 104)) @ trs((0, 0, -0.235)), 'paint_sand')
    P.jerrycan(m, trs((-0.2, 0.0, 0.738), (0, 0, 12)), 'metal_gray')
    P.jerrycan(m, trs((0.85, -0.25, 0.08), (90, 0, 30)) @ trs((0, 0, 0.0)), 'paint_sand')
    obj = P.join([m], 'jerrycan_stack')
    return P.finish(obj, 'jerrycan_stack', [cbox((0, 0, 0.45), (1.2, 0.75, 0.9))], grime=0.2, grime_height=0.3)


@builder
def build_drum_stack():
    m = Mesh()
    rng = random.Random(167)
    # three drums upright, two lying on log chocks, one knocked over
    for (x, y) in ((-0.62, 0.3), (-0.02, 0.32), (-0.35, -0.22)):
        P.drum(m, trs((x, y, 0), (rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0, 180))),
               rng.choice(('metal_gray', 'paint_sand', 'metal_gray')))
    for y in (-0.25, 0.35):
        P.cyl_mesh(m, 0.07, 1.0, trs((0.75, y, 0.07), (0, 90, 0)), 'wood_old', sides=8)
    for k, x in enumerate((0.45, 1.05)):
        P.drum(m, trs((x, 0.47, 0.37), (90, 0, rng.uniform(-3, 3))) @ trs((0, 0, 0)),
               'metal_gray' if k else 'paint_sand')
    P.drum(m, trs((0.3, -0.6, 0.3), (0, 90, 25)) @ trs((0, 0, -0.44)), 'metal_gray')
    obj = P.join([m], 'drum_stack')
    cols = [ccyl((-0.62, 0.3, 0), 0.3, 0.88), ccyl((-0.02, 0.32, 0), 0.3, 0.88), ccyl((-0.35, -0.22, 0), 0.3, 0.88),
            cbox((0.75, -0.1, 0.33), (0.95, 1.2, 0.66))]
    return P.finish(obj, 'drum_stack', cols, grime=0.25, grime_height=0.4)


@builder
def build_stretcher():
    m = Mesh()
    # two poles with handles, the canvas bed sagging between, spreader bars, feet
    for x in (-0.26, 0.26):
        P.tube_mesh(m, [(x, -1.15, 0.13), (x, 1.15, 0.13)], 0.022, 'wood', sides=8)
        for y in (-0.82, 0.82):
            P.tube_mesh(m, [(x, y - 0.06, 0.11), (x, y, 0.0), (x, y + 0.06, 0.11)], 0.008, 'metal_dark', sides=4)
    rings = []
    for k in range(9):
        y = -0.85 + k * 1.7 / 8
        sag = 0.04 * math.sin(math.pi * k / 8)
        rings.append([V((x, y, 0.13 - (sag + 0.015 * (1 - abs(x) / 0.26)) if abs(x) < 0.26 else 0.13))
                      for x in (-0.27, -0.13, 0.0, 0.13, 0.27)])
    P.loft(m, rings, 'canvas', closed=False, soft=True)
    P.loft(m, [list(reversed([p - V((0, 0, 0.006)) for p in r])) for r in rings], 'canvas', closed=False, soft=True)
    for y in (-0.88, 0.88):
        P.tube_mesh(m, [(-0.27, y, 0.115), (0.0, y, 0.09), (0.27, y, 0.115)], 0.008, 'metal_dark', sides=4)
    # a folded blanket and a strap
    P.bbox_mesh(m, (0.4, 0.5, 0.05), trs((0.0, 0.45, 0.13)), 'cloth_feldgrau_dark', 0.015)
    P.box_mesh(m, (0.6, 0.04, 0.006), trs((0.0, -0.2, 0.125)), 'webbing')
    obj = P.join([m], 'stretcher')
    return P.finish(obj, 'stretcher', [], grime=0.15, grime_height=0.15)


@builder
def build_dropped_helmet_de():
    m = Mesh()
    # dropped on its rim, tipped back onto the skirt
    P.helmet_de(m, trs((0.0, 0.0, 0.07), (-24, 6, 35)))
    obj = P.join([m], 'dropped_helmet_de')
    return P.finish(obj, 'dropped_helmet_de', [], grime=0.15, grime_height=0.15)


@builder
def build_dropped_helmet_us():
    m = Mesh()
    # dropped, tipped onto its rim, the chinstraps trailing
    P.helmet_us(m, trs((0.0, 0.0, 0.05), (28, -8, -20)))
    obj = P.join([m], 'dropped_helmet_us')
    return P.finish(obj, 'dropped_helmet_us', [], grime=0.15, grime_height=0.15)


@builder
def build_cable_reel():
    m = Mesh()
    # telephone cable drum on its carrier frame, a loose end trailing on the ground
    ax = trs((0, 0, 0.3), (0, 90, 0))
    P.cyl_mesh(m, 0.13, 0.26, ax, 'rubber', sides=20)
    for x in (-0.14, 0.14):
        P.cyl_mesh(m, 0.2, 0.015, trs((x, 0, 0.3), (0, 90, 0)), 'metal_gray', sides=20)
        P.cyl_mesh(m, 0.04, 0.03, trs((x * 1.15, 0, 0.3), (0, 90, 0)), 'metal_dark', sides=10)
    for k in range(6):                                       # cable turns showing on the drum
        P.tube_mesh(m, [V((-0.12 + k * 0.048, 0.132 * math.cos(a), 0.3 + 0.132 * math.sin(a)))
                        for a in [j * 2 * math.pi / 16 for j in range(17)]], 0.006, 'rubber', sides=3, caps=False)
    for x in (-0.19, 0.19):
        P.tube_mesh(m, [(x, -0.18, 0.0), (x, 0.0, 0.3), (x, 0.18, 0.0)], 0.012, 'metal_dark', sides=5)
        P.tube_mesh(m, [(x, 0.0, 0.3), (x, 0.03, 0.56)], 0.012, 'metal_dark', sides=5)
    P.tube_mesh(m, [(-0.19, 0.03, 0.56), (0.19, 0.03, 0.56)], 0.014, 'metal_dark', sides=6)
    P.tube_mesh(m, [(0.17, 0.0, 0.3), (0.24, 0.0, 0.3), (0.24, 0.0, 0.18), (0.29, 0.0, 0.18)], 0.008, 'metal_dark', sides=4)
    P.cyl_mesh(m, 0.013, 0.06, trs((0.32, 0.0, 0.18), (0, 90, 0)), 'wood', sides=6)
    P.tube_mesh(m, [(0.0, -0.13, 0.33), (0.05, -0.2, 0.2), (0.12, -0.32, 0.01), (0.4, -0.6, 0.008), (0.75, -0.7, 0.008),
                    (1.1, -0.55, 0.008)], 0.005, 'rubber', sides=4)
    obj = P.join([m], 'cable_reel')
    return P.finish(obj, 'cable_reel', [cbox((0, 0, 0.29), (0.45, 0.4, 0.58))], grime=0.15, grime_height=0.2)


@builder
def build_field_telephone():
    m = Mesh()
    P.field_telephone(m, trs((0, 0, 0)))
    obj = P.join([m], 'field_telephone')
    return P.finish(obj, 'field_telephone', [], grime=0.08, grime_height=0.1)


@builder
def build_sign_minen():
    m = Mesh()
    rng = random.Random(171)
    # a stake with a board nailed on, painted, a black skull and crossed bones
    P.bbox_mesh(m, (0.07, 0.07, 1.35), trs((0, 0.045, 0.675), (0, rng.uniform(-3, 3), 0)), 'wood_old', 0.008)
    P.cyl_mesh(m, 0.04, 0.12, trs((0, 0.045, 1.38), (0, 0, 45)), 'wood_old', sides=4, r2=0.005)
    board = trs((0, 0.0, 1.0), (0, 4, 0))
    P.bbox_mesh(m, (0.62, 0.025, 0.4), board, 'paint_yellow', 0.006)
    P.nails(m, [board @ V((0.0, -0.013, z)) for z in (-0.12, 0.12)], (0, -1, 0), r=0.008)
    y = -0.0138
    sk = [board @ V((0.11 * math.cos(a), y, 0.04 + 0.12 * math.sin(a))) for a in
          [math.radians(d) for d in range(-30, 211, 20)]]
    sk += [board @ V((-0.06, y, -0.07)), board @ V((0.06, y, -0.07))]
    ids = [m.vert(p) for p in sk]
    m.face(list(reversed(ids)), 'paint_black')
    for ex in (-0.045, 0.045):
        eye = [m.vert(board @ V((ex + 0.028 * math.cos(a), y - 0.001, 0.05 + 0.03 * math.sin(a))))
               for a in [k * math.pi / 4 for k in range(8)]]
        m.face(eye, 'paint_yellow')
    nose = [m.vert(board @ V(p)) for p in ((0.0, y - 0.001, 0.02), (-0.015, y - 0.001, -0.01), (0.015, y - 0.001, -0.01))]
    m.face(nose, 'paint_yellow')
    for ang in (35, -35):
        P.box_mesh(m, (0.42, 0.003, 0.035), board @ trs((0, y + 0.001, -0.1), (0, ang, 0)), 'paint_black')
        for sx in (-1, 1):
            c = Matrix.Rotation(math.radians(ang), 4, 'Y') @ V((sx * 0.21, 0, 0))
            P.cyl_mesh(m, 0.022, 0.003, board @ trs(V((c.x, y + 0.001, -0.1 + c.z)), (90, 0, 0)), 'paint_black', sides=8)
    obj = P.join([m], 'sign_minen')
    return P.finish(obj, 'sign_minen', [ccyl((0, 0.045, 0), 0.06, 1.2)], grime=0.3, grime_height=0.6)


@builder
def build_sandbags_ruined():
    m = Mesh()
    rng = random.Random(173)
    path = P.StraightPath(3.4)
    # the stump: two full courses, the ends standing four courses high
    P.bag_wall(m, path, courses(2, 0.17, 0.68, 0.66, 'SH'), seed=175)
    for f0, f1 in ((0.0, 0.24), (0.8, 1.0)):
        sub = P.SubPath(path, f0, f1)
        P.bag_wall(m, sub, [dict(kind=k, h=0.17, depth=d, z=0.34 + i * 0.17) for i, (k, d) in
                            enumerate((('S', 0.64), ('H', 0.62)))], seed=177 + int(f0 * 10))
    P.bag_core(m, path, 0.0, 0.26, 0.42, 0.36, 0.04, 0.96)
    # the spilled bags: tumbled in front and behind, some split open in a heap of earth
    for k in range(17):
        x = rng.uniform(-0.9, 1.0)
        y = rng.choice((-1, 1)) * rng.uniform(0.45, 1.1)
        z = 0.0 if abs(y) > 0.55 else 0.33
        roll = rng.uniform(-25, 25) if z == 0 else rng.uniform(-10, 10)
        P.bag(m, 0.6, 0.35, 0.19, trs((x, y, z), (roll, rng.uniform(-12, 12), rng.uniform(0, 180))), rng,
              tie=rng.choice((-1, 1)), tint=rng.uniform(0.75, 1.0))
    for (cx, cy, r, h) in ((0.2, -0.75, 0.45, 0.22), (-0.35, 0.8, 0.35, 0.16), (0.1, 0.0, 0.5, 0.42)):
        pts = [V((cx + r * math.cos(a) * rng.uniform(0.8, 1.1), cy + r * math.sin(a) * rng.uniform(0.8, 1.1), 0.0))
               for a in [i * math.pi / 5 for i in range(10)]]
        pts += [V((cx + rng.uniform(-0.1, 0.1), cy + rng.uniform(-0.1, 0.1), h)),
                V((cx + r * 0.4, cy, h * 0.6)), V((cx - r * 0.4, cy + 0.05, h * 0.55))]
        hill = P.hull_object(pts, 'dirt')
        m_obj = hill
        m.add([v.co.copy() for v in m_obj.data.vertices], [list(p.vertices) for p in m_obj.data.polygons], 'dirt',
              soft=True)
        kit.delete(m_obj)
    obj = P.join([m], 'sandbags_ruined')
    obj = P.join([obj, P.spill(obj, (-1.3, -2.0, 0.5), (0, 1, 0), 407, 0.9)], 'sandbags_ruined')
    cols = [cbox((0, 0, 0.17), (3.4, 0.7, 0.34)), cbox((-1.3, 0, 0.36), (0.8, 0.66, 0.72)),
            cbox((1.36, 0, 0.36), (0.7, 0.66, 0.72))]
    return P.finish(obj, 'sandbags_ruined', cols, grime=0.25, grime_height=0.5, center=PIN['sandbags_ruined'])


@builder
def build_camo_net():
    from mathutils import noise as mnoise
    m = Mesh()
    rng = random.Random(181)
    net = P.net_material()
    poles = [(-2.0, -1.5), (2.0, -1.5), (2.0, 1.5), (-2.0, 1.5)]
    PH = 2.2
    for (x, y) in poles:
        P.tube_mesh(m, [(x, y, 0.0), (x + rng.uniform(-0.03, 0.03), y + rng.uniform(-0.03, 0.03), PH - 0.02)], 0.04,
                    'wood_old', sides=7)
        for dx in (-0.06, 0.06):         # forked top holding the net
            P.tube_mesh(m, [(x, y, PH - 0.1), (x + dx, y, PH + 0.04)], 0.015, 'wood_old', sides=4)
    # the net: a draped sheet, sagging between the poles, hanging down outside them
    xs = [-2.6 + 5.2 * i / 26 for i in range(27)]
    ys = [-2.1 + 4.2 * j / 21 for j in range(22)]

    def height(x, y):
        ox = max(0.0, abs(x) - 2.0)
        oy = max(0.0, abs(y) - 1.5)
        out = math.hypot(ox, oy)
        inner = PH + 0.03 - 0.22 * (1 - (x / 2.0) ** 2) ** 2 * (1 - (y / 1.5) ** 2) ** 2 if out == 0 else PH + 0.03
        z = inner - 1.6 * (out / 0.6) ** 1.3 if out > 0 else inner
        near = min(math.hypot(x - px, y - py) for px, py in poles)
        z -= 0.08 * (1 - math.exp(-near * 2.0)) * (1 if out == 0 else 0.3)
        return z + 0.05 * mnoise.noise(V((x * 1.3, y * 1.3, 4.2)))
    ids = [[m.vert((x, y, max(0.25, height(x, y)))) for x in xs] for y in ys]
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            m.face((ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]), 'camo_net_cards', True)
    # tufts of garnish hanging off the edges
    border = [(x, ys[0]) for x in xs] + [(xs[-1], y) for y in ys[1:]] + [(x, ys[-1]) for x in reversed(xs[:-1])] + \
             [(xs[0], y) for y in reversed(ys[1:-1])]
    for k in range(0, len(border), 3):
        x, y = border[k]
        z = max(0.25, height(x, y))
        nx_ = -1 if x <= xs[0] + 1e-6 else (1 if x >= xs[-1] - 1e-6 else 0)
        ny_ = -1 if y <= ys[0] + 1e-6 else (1 if y >= ys[-1] - 1e-6 else 0)
        t = V((-ny_, nx_, 0)) if (nx_ or ny_) else V((1, 0, 0))
        w_, d_ = rng.uniform(0.25, 0.4), rng.uniform(0.25, 0.45)
        q = [V((x, y, z)) - t * w_ / 2, V((x, y, z)) + t * w_ / 2]
        q += [q[1] + V((nx_ * 0.04, ny_ * 0.04, -min(d_, z - 0.03))), q[0] + V((nx_ * 0.04, ny_ * 0.04, -min(d_ * 0.8, z - 0.03)))]
        f = [m.vert(p) for p in q]
        m.face(f, 'camo_net_cards', True)
    # guy ropes from the poles and the net corners to pegs
    for (x, y) in poles:
        sx, sy = math.copysign(1, x), math.copysign(1, y)
        peg = V((x + sx * 0.9, y + sy * 0.7, 0.05))
        P.tube_mesh(m, [V((x, y, PH)), peg], 0.006, 'webbing', sides=3)
        P.box_mesh(m, (0.03, 0.03, 0.12), trs(peg + V((0, 0, 0.0))), 'wood_dark')
    obj = P.join([m], 'camo_net')
    cols = [ccyl((x, y, 0), 0.06, PH) for x, y in poles]
    return P.finish(obj, 'camo_net', cols, grime=0.15, grime_height=0.6, soft_angle=89)


@builder
def build_dugout_entrance():
    from mathutils import noise as mnoise
    m = Mesh()
    rng = random.Random(191)
    CW, PY, TOP = 0.62, 1.25, 2.15            # cutting half-width, portal plane, earth top
    xs = [-2.2, -1.8, -1.4, -1.0, -0.62, -0.3, 0.0, 0.3, 0.62, 1.0, 1.4, 1.8, 2.2]
    ys = [-1.4, -1.1, -0.8, -0.5, -0.2, 0.1, 0.4, 0.7, 1.0, 1.25, 1.6, 2.0, 2.4]

    def sm(t):
        t = max(0.0, min(1.0, t))
        return t * t * (3 - 2 * t)

    def h(x, y):
        z = TOP * sm((y + 1.4) / 1.9) * (0.35 + 0.65 * sm((2.2 - abs(x)) / 1.0))
        return max(0.0, z + 0.06 * mnoise.noise(V((x * 1.4, y * 1.4, 0.7))) * (z > 0.05))
    grid = [[m.vert((x, y, h(x, y) if not (abs(x) < CW + 0.01 and y >= PY - 0.01) else max(h(x, y), TOP - 0.05)))
             for x in xs] for y in ys]
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if abs(cx) < CW and cy < PY:
                continue
            m.face((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]), 'grass', True)
    # close the mound down to the ground at the sides and the back
    ring_ = [grid[j][0] for j in range(len(ys))] + [grid[-1][i] for i in range(1, len(xs))] + \
        [grid[j][-1] for j in range(len(ys) - 2, -1, -1)]
    low = [m.vert((m.v[k].x, m.v[k].y, 0.0), 0.4) for k in ring_]
    for k in range(len(ring_) - 1):
        m.face((ring_[k], ring_[k + 1], low[k + 1], low[k]), 'dirt', True)
    # log revetments either side of the cutting, stakes holding them
    for sx in (-1, 1):
        z = 0.09
        while z < TOP - 0.05:
            y0 = next((y for y in [-1.4 + 0.05 * k for k in range(60)] if h(sx * CW, y) > z + 0.06), None)
            if y0 is None:
                break
            P.cyl_mesh(m, 0.09, PY - y0 + 0.1, trs((sx * (CW + 0.06), (y0 + PY) / 2 + 0.05, z), (90, 0, rng.uniform(-1, 1))),
                       'bark_pine', sides=8)
            z += 0.17
        for y in (-0.7, 0.25):
            P.cyl_mesh(m, 0.06, h(sx * CW, y) + 0.1, trs((sx * (CW - 0.06), y, (h(sx * CW, y) + 0.1) / 2)), 'bark_pine',
                       sides=7)
    # the portal: door posts, lintel, roof logs, a board under the earth
    for sx in (-1, 1):
        P.cyl_mesh(m, 0.1, 1.95, trs((sx * 0.55, PY, 0.975)), 'bark_pine', sides=9)
    P.cyl_mesh(m, 0.11, 1.5, trs((0, PY, 1.95), (0, 90, 0)), 'bark_pine', sides=9)
    for k in range(7):
        x = -0.6 + k * 0.2
        P.cyl_mesh(m, 0.095, 1.25, trs((x, PY + 0.6, 2.06 + rng.uniform(-0.01, 0.01)), (90, 0, rng.uniform(-2, 2))),
                   'bark_pine', sides=8)
    P.box_mesh(m, (1.3, 0.04, 0.3), trs((0, PY - 0.02, 2.2)), 'wood_dark')
    # inside: plank walls, steps down into the dark, a gas curtain half drawn
    for sx in (-1, 1):
        for k in range(6):
            P.box_mesh(m, (0.03, 1.05, 0.3), trs((sx * 0.5, PY + 0.55, -0.45 + k * 0.32)), 'wood_dark_h')
    for k in range(8):
        P.box_mesh(m, (0.13, 0.03, 2.55), trs((-0.455 + k * 0.13, PY + 1.08, 0.62)), 'wood_dark')
    for k, (y, z) in enumerate(((PY + 0.1, -0.05), (PY + 0.35, -0.25), (PY + 0.6, -0.45))):
        P.cyl_mesh(m, 0.07, 0.95, trs((0, y + 0.1, z), (0, 90, 0)), 'bark_pine', sides=8)
        P.box_mesh(m, (0.95, 0.25, 0.1), trs((0, y, z - 0.05)), 'dirt')
    P.box_mesh(m, (0.95, 0.45, 0.1), trs((0, PY + 0.85, -0.7)), 'dirt')
    cq = ((-0.48, PY + 0.03, 1.82), (0.02, PY + 0.03, 1.82), (-0.08, PY + 0.06, 0.02), (-0.48, PY + 0.04, 0.02))
    m.face([m.vert(p) for p in cq], 'canvas', True)                               # the curtain, both sides
    m.face([m.vert((x, y + 0.008, z)) for x, y, z in reversed(cq)], 'canvas', True)
    P.tube_mesh(m, [(0.02, PY + 0.04, 1.8), (0.42, PY + 0.04, 1.8)], 0.05, 'canvas', sides=6)
    # a duckboard on the cutting floor, a couple of sandbags by the door
    for k in range(12):
        P.box_mesh(m, (0.7, 0.08, 0.025), trs((rng.uniform(-0.02, 0.02), -1.25 + k * 0.2, 0.075), (0, 0, rng.uniform(-2, 2))),
                   'wood_old_h')
    for x in (-0.3, 0.3):
        P.box_mesh(m, (0.06, 2.4, 0.06), trs((x, -0.15, 0.03)), 'wood_old')
    for k, (x, y, z, yaw) in enumerate(((-0.75, PY - 0.3, h(-0.75, PY - 0.3), 80), (0.85, PY - 0.2, h(0.85, PY - 0.2), 100))):
        P.bag(m, 0.58, 0.34, 0.19, trs((x, y, z - 0.03), (0, 0, yaw)), rng, tie=1)
    obj = P.join([m], 'dugout_entrance')
    cols = [cbox_minmax((-2.2, -0.4, 0), (-CW, 2.4, 1.8)), cbox_minmax((CW, -0.4, 0), (2.2, 2.4, 1.8)),
            cbox_minmax((-2.2, -1.4, 0), (-CW, -0.4, 0.6)), cbox_minmax((CW, -1.4, 0), (2.2, -0.4, 0.6)),
            cbox_minmax((-CW, PY, 1.85), (CW, 2.4, 2.25)), cbox_minmax((-CW, PY + 1.05, -0.7), (CW, 2.4, 1.85))]
    anchors = {'door': ((0.0, PY - 0.35, 0.0), 180.0), 'inside': ((0.0, PY + 0.85, -0.65), 180.0)}
    CLOSE['dugout_entrance'] = ((0.0, 1.6, 0.4), -15.0, 6.0)
    return P.finish(obj, 'dugout_entrance', cols, anchors, grime=0.35, grime_height=0.8, center='xy')


@builder
def build_mg42_tripod():
    m = Mesh()
    rng = random.Random(197)
    D = 'metal_gray'
    head = V((0.0, 0.0, 0.4))
    # Lafette 34: two front legs with pads, the long rear leg with its rest, the
    # cradle with buffer, traverse dial, the MGZ 34 sight on the left
    for sx in (-1, 1):
        foot = V((sx * 0.38, -0.42, 0.02))
        P.tube_mesh(m, [head + V((sx * 0.05, -0.04, -0.02)), foot + V((0, 0, 0.03))], 0.018, D, sides=7)
        P.bbox_mesh(m, (0.1, 0.07, 0.025), trs(foot + V((0, 0, 0.0125))), D, 0.006)
    rear = V((0.0, 0.88, 0.03))
    P.tube_mesh(m, [head + V((0, 0.05, -0.03)), rear + V((0, 0, 0.04))], 0.022, D, sides=7)
    P.bbox_mesh(m, (0.14, 0.09, 0.03), trs(rear + V((0, 0, 0.015))), D, 0.006)
    P.bbox_mesh(m, (0.16, 0.2, 0.04), trs(head.lerp(rear, 0.55) + V((0, 0, 0.03)), (-22, 0, 0)), 'leather', 0.015)
    P.tube_mesh(m, [head.lerp(rear, 0.3) + V((-0.12, 0, 0)), head.lerp(rear, 0.3) + V((0.12, 0, 0))], 0.01, D, sides=5)
    P.cyl_mesh(m, 0.06, 0.06, trs(head + V((0, 0, 0.01))), D, sides=12)
    P.cyl_mesh(m, 0.075, 0.015, trs(head + V((0, 0, -0.03))), 'metal_dark', sides=16)
    P.bbox_mesh(m, (0.07, 0.6, 0.05), trs(head + V((0, 0.02, 0.06))), D, 0.008)
    P.cyl_mesh(m, 0.022, 0.45, trs(head + V((0, 0.05, 0.03)), (90, 0, 0)), 'metal_dark', sides=8)
    for y in (-0.22, 0.25):
        P.box_mesh(m, (0.09, 0.03, 0.05), trs(head + V((0, y, 0.1))), D)
    P.cyl_mesh(m, 0.025, 0.08, trs(head + V((0.06, 0.12, 0.02)), (0, 90, 0)), 'metal_dark', sides=8)
    sight = head + V((-0.11, 0.08, 0.16))
    P.bbox_mesh(m, (0.06, 0.16, 0.08), trs(sight), 'metal_dark', 0.008)
    P.cyl_mesh(m, 0.018, 0.08, trs(sight + V((0, 0.1, 0.02)), (90, 0, 0)), 'metal_dark', sides=8)
    P.cyl_mesh(m, 0.022, 0.03, trs(sight + V((0, -0.09, 0.02)), (90, 0, 0)), 'glass', sides=8)
    P.box_mesh(m, (0.06, 0.03, 0.03), trs(head + V((-0.07, 0.08, 0.1))), D)
    # the gun on the cradle, a belt running into it from a can on the ground
    P.mg42(m, trs(head + V((0, 0.1, 0.085))), bipod=True)
    P.ammo_can(m, trs((-0.32, -0.05, 0.0), (0, 0, 75)), lid_open=110)
    P.belt(m, [(-0.31, -0.02, 0.2), (-0.25, 0.0, 0.33), (-0.15, 0.02, 0.48), (-0.06, 0.06, 0.6)])
    P.spent_cases(m, rng, (0.2, 0.15, 0.0), 0.35, 26)
    obj = P.join([m], 'mg42_tripod')
    muzzle = head + V((0, 0.1 - 0.82, 0.085 + 0.06))
    anchors = {'gunner': ((0.0, 1.05, 0.0), 0.0), 'muzzle': tuple(muzzle)}
    CLOSE['mg42_tripod'] = ((0.0, 0.3, -0.5), -40.0, 25.0)
    return P.finish(obj, 'mg42_tripod', [cbox((0, 0.2, 0.25), (0.8, 1.3, 0.5))], anchors, grime=0.1,
                    grime_height=0.2)


@builder
def build_kubelwagen():
    C = 'camo_de'
    D = 'metal_dark'
    FA, RA, R, TX = -1.2, 1.2, 0.345, 0.685
    rng = random.Random(201)
    parts = []
    m = Mesh()
    w = Mesh()
    for y in (FA, RA):
        for sx in (-1, 1):
            P.wheel(w, (sx * TX, y, R), R, 0.14, sx, mat_rim=C, segs=18, flat=0.15, tread=0.012, nuts=5)
    parts.append(w)
    # the bath-tub body: side profile extruded, nose narrowed, compartment hollowed, arches cut
    side = [(-1.87, 0.36), (1.86, 0.36), (1.87, 0.6), (1.8, 0.66), (1.05, 0.95), (-0.9, 0.95), (-1.82, 0.64),
            (-1.87, 0.58)]
    body = kit.extrude_profile(side, 1.38, axis='X', mat=C)
    for v in body.data.vertices:
        if v.co.y < -1.0:
            v.co.x *= 1.0 - 0.22 * min(1.0, (-1.0 - v.co.y) / 0.87)
        if v.co.y > 1.4:
            v.co.x *= 1.0 - 0.12 * min(1.0, (v.co.y - 1.4) / 0.47)
    body.data.update()
    kit.bevel(body, 0.03, 2, 30)
    kit.cut(body, kit.box((1.28, 1.86, 0.8), loc=(0, 0.06, 0.45 + 0.4 + 0.08), mat=C))
    for y in (FA, RA):
        kit.cut(body, kit.cyl(0.4, 1.6, loc=(0, y, R), rot=(0, 90, 0), mat=C, verts=20))
    seams = []
    for sx in (-1, 1):
        for y in (-0.86, -0.02, 0.05, 0.9):
            seams.append(kit.box((0.04, 0.007, 0.5), loc=(sx * 0.69, y, 0.72), mat=C))
    kit.cut(body, kit.join(seams, 'seams'))
    parts.append(body)
    # mudguards bolted on, pressed ribs, door handles and hinges
    msec = [(-0.11, -0.006), (0.11, -0.006), (0.11, 0.008), (-0.11, 0.008)]
    for y in (FA, RA):
        for sx in (-1, 1):
            pts = [V((sx * 0.7, y - 0.42 * math.cos(math.radians(a)), R + 0.42 * math.sin(math.radians(a))))
                   for a in range(15, 166, 15)]
            P.sweep(m, pts, msec, C, closed=True, caps=True, lateral=(1, 0, 0))
    for sx in (-1, 1):
        for z in (0.6, 0.8):
            P.box_mesh(m, (0.012, 1.7, 0.025), trs((sx * 0.693, 0.03, z)), C)
        for y in (-0.6, 0.3):
            P.box_mesh(m, (0.025, 0.08, 0.02), trs((sx * 0.7, y + 0.25, 0.86)), D)
            P.cyl_mesh(m, 0.012, 0.06, trs((sx * 0.695, y - 0.2, 0.86)), D, sides=6)
    # spare wheel in its well on the bonnet, headlamps on the wings, tow eye
    sp = Mesh()
    P.wheel(sp, (0, 0, 0), R, 0.14, 1, mat_rim=C, segs=18, tread=0.012, nuts=5)
    spo = sp.build('spare')
    P.transform(spo, trs((0, -1.44, 0.84)) @ Matrix.Rotation(math.radians(18.6), 4, 'X')
                @ Matrix.Rotation(math.radians(90), 4, 'Y'))
    parts.append(spo)
    for sx in (-1, 1):
        hc = V((sx * 0.55, -1.6, 0.86))
        P.cyl_mesh(m, 0.08, 0.1, trs(hc, (90, 0, 0)), C, sides=12, r2=0.09)
        P.cyl_mesh(m, 0.075, 0.012, trs(hc + V((0, -0.055, 0)), (90, 0, 0)), 'glass', sides=12)
        P.box_mesh(m, (0.03, 0.04, 0.1), trs(hc + V((0, 0.03, -0.09))), D)
    P.cyl_mesh(m, 0.05, 0.08, trs((-0.45, -1.63, 0.78), (90, 0, 0)), D, sides=8)            # Notek
    P.tube_mesh(m, [(0, -1.86, 0.4), (0, -1.94, 0.4), (0, -1.94, 0.47), (0, -1.88, 0.47)], 0.014, D, sides=5)
    # windscreen in its frame, folded hood on the rear deck with its bows
    for (sx_, sz_, x, z) in ((1.3, 0.035, 0, 0.96), (1.3, 0.035, 0, 1.36), (0.035, 0.4, -0.63, 1.16),
                             (0.035, 0.4, 0.63, 1.16), (0.03, 0.4, 0.0, 1.16)):
        P.bbox_mesh(m, (sx_, 0.035, sz_), trs((x, -0.9, z), (-6, 0, 0)), C, 0.006)
    for x in (-0.31, 0.31):
        P.box_mesh(m, (0.6, 0.008, 0.37), trs((x, -0.9, 1.16), (-6, 0, 0)), 'glass')
    P.tube_mesh(m, [(-0.66, 1.08, 1.03), (0.66, 1.08, 1.03)], 0.11, 'canvas', sides=10)
    for k in range(3):
        P.tube_mesh(m, [(-0.68, 1.02 + k * 0.05, 0.95), (-0.66, 1.0 + k * 0.05, 1.12), (0.66, 1.0 + k * 0.05, 1.12),
                        (0.68, 1.02 + k * 0.05, 0.95)], 0.012, D, sides=4)
    # interior: two front seats, the rear bench, wheel, levers
    for x in (-0.33, 0.33):
        P.bbox_mesh(m, (0.44, 0.44, 0.1), trs((x, -0.35, 0.58)), 'canvas', 0.03)
        P.bbox_mesh(m, (0.44, 0.08, 0.42), trs((x, -0.1, 0.82), (-12, 0, 0)), 'canvas', 0.025)
    P.bbox_mesh(m, (1.15, 0.42, 0.1), trs((0, 0.62, 0.6)), 'canvas', 0.03)
    P.bbox_mesh(m, (1.15, 0.08, 0.42), trs((0, 0.86, 0.82), (-10, 0, 0)), 'canvas', 0.025)
    sw = [(-0.33 + 0.18 * math.cos(a), -0.68 + 0.08 * math.sin(a), 1.0 + 0.16 * math.sin(a))
          for a in [k * 2 * math.pi / 14 for k in range(15)]]
    P.tube_mesh(m, sw, 0.012, 'bakelite', sides=5, caps=False)
    P.tube_mesh(m, [(-0.33, -0.68, 1.0), (-0.33, -0.86, 0.8)], 0.02, D, sides=6)
    P.tube_mesh(m, [(0.0, -0.45, 0.45), (0.02, -0.42, 0.7)], 0.008, D, sides=4)
    P.box_mesh(m, (1.2, 0.05, 0.14), trs((0, -0.86, 0.88)), C)
    # engine deck louvres, tail lights, number plate, exhaust
    for sx in (-1, 1):
        for k in range(6):
            P.box_mesh(m, (0.2, 0.02, 0.008), trs((sx * 0.25, 1.3 + k * 0.07, 0.94 - (1.3 + k * 0.07 - 1.05) * 0.39),
                                                 (-21, 0, 0)), D)
        P.cyl_mesh(m, 0.035, 0.03, trs((sx * 0.45, 1.86, 0.55), (90, 0, 0)), 'paint_red', sides=8)
    P.box_mesh(m, (0.32, 0.01, 0.1), trs((0.0, 1.875, 0.48)), 'plate')
    P.tube_mesh(m, [(0.4, 1.6, 0.38), (0.42, 1.9, 0.36)], 0.025, 'rust', sides=6)
    # a jerrycan in the rear foot well, an MP 40 lying on the seat? (no: just the can)
    P.jerrycan(m, trs((0.35, 0.3, 0.38), (0, 0, 90)), 'paint_sand')
    parts.append(m)
    obj = P.join(parts, 'kubelwagen')
    cols = [cbox((0, 0, 0.5), (1.45, 3.74, 1.0))]
    anchors = {'driver': ((-0.33, -0.35, 0.68), 0.0), 'passenger': ((0.33, -0.35, 0.68), 0.0)}
    CLOSE['kubelwagen'] = ((0.0, 0.2, -0.1), -35.0, 12.0)
    return P.finish(obj, 'kubelwagen', cols, anchors, grime=0.35, grime_height=0.8, hard_angle=35)


@builder
def build_motorcycle_sidecar():
    S_ = 'paint_sand'
    D = 'metal_dark'
    BX, FY_, RY_, R = -0.32, -0.74, 0.72, 0.34      # bike centre line, wheel positions, wheel radius
    CX = 0.5                                        # sidecar centre line
    rng = random.Random(211)
    parts = []
    m = Mesh()
    w = Mesh()
    # wheels: bike front and rear, the sidecar wheel; a spare on the sidecar's tail
    for (x, y, side) in ((BX, FY_, -1), (BX, RY_, -1), (CX + 0.36, 0.12, 1)):
        P.wheel(w, (x, y, R), R, 0.11, side, mat_rim=S_, segs=18, tread=0.012, flat=0.12, spoked=True,
                spokes=18)
    parts.append(w)
    # frame: steering head, downtubes, backbone, rear frame, the fork
    head = V((BX, FY_ + 0.22, 0.86))
    P.tube_mesh(m, [head + V((0, 0, 0.06)), head - V((0, -0.03, 0.12))], 0.03, D, sides=8)
    for dx in (-0.06, 0.06):
        P.tube_mesh(m, [head, V((BX + dx, FY_ + 0.45, 0.28)), V((BX + dx, 0.2, 0.26)), V((BX + dx, RY_, R + 0.05))],
                    0.017, D, sides=6)
        P.tube_mesh(m, [V((BX + dx, 0.25, 0.86)), V((BX + dx, RY_ - 0.02, R + 0.08))], 0.014, D, sides=6)
        P.tube_mesh(m, [head + V((dx, 0.02, 0.05)), V((BX + dx, FY_, R + 0.04))], 0.02, D, sides=7)      # fork legs
    P.tube_mesh(m, [head + V((0, 0, 0.04)), V((BX, 0.3, 0.86))], 0.02, D, sides=6)
    # boxer engine: crankcase, finned cylinders sticking out, heads, gearbox, shaft
    P.bbox_mesh(m, (0.26, 0.34, 0.28), trs((BX, -0.22, 0.42)), 'iron', 0.04)
    for sx in (-1, 1):
        cyl_m = trs((BX + sx * 0.22, -0.3, 0.5), (0, 90, 0))
        P.cyl_mesh(m, 0.06, 0.2, cyl_m, 'iron', sides=10)
        for k in range(5):
            P.cyl_mesh(m, 0.085, 0.008, cyl_m @ trs((0, 0, -0.06 + k * 0.03)), 'iron', sides=10)
        P.bbox_mesh(m, (0.09, 0.15, 0.15), trs((BX + sx * 0.35, -0.3, 0.5)), 'iron', 0.02)
        P.tube_mesh(m, [V((BX + sx * 0.34, -0.38, 0.45)), V((BX + sx * 0.3, -0.45, 0.3)), V((BX + sx * 0.25, -0.2, 0.24)),
                        V((BX + sx * 0.22, 0.6, 0.3))], 0.022, 'rust', sides=6)
        P.cyl_mesh(m, 0.04, 0.32, trs((BX + sx * 0.22, 0.75, 0.32), (90, 0, 0)), D, sides=8)
    P.bbox_mesh(m, (0.2, 0.22, 0.22), trs((BX, 0.05, 0.42)), 'iron', 0.03)
    P.tube_mesh(m, [V((BX + 0.08, 0.15, 0.36)), V((BX + 0.08, RY_, R))], 0.025, D, sides=6)
    # tank with knee pads, saddle on springs, pillion, carrier, handlebar, headlamp
    P.bbox_mesh(m, (0.25, 0.52, 0.2), trs((BX, -0.18, 0.88), (4, 0, 0)), S_, 0.06)
    for sx in (-1, 1):
        P.bbox_mesh(m, (0.02, 0.12, 0.09), trs((BX + sx * 0.13, -0.05, 0.84)), 'rubber', 0.01)
    P.bbox_mesh(m, (0.24, 0.3, 0.07), trs((BX, 0.25, 0.97), (-6, 0, 0)), 'leather', 0.03)
    for dx in (-0.07, 0.07):
        P.tube_mesh(m, [V((BX + dx, 0.36, 0.95)), V((BX + dx, 0.38, 0.86))], 0.012, D, sides=4)
    P.bbox_mesh(m, (0.2, 0.22, 0.06), trs((BX, 0.62, 0.86)), 'leather', 0.02)
    P.box_mesh(m, (0.22, 0.25, 0.02), trs((BX, 0.95, 0.78)), D)
    bar = [V((BX - 0.36, FY_ + 0.12, 1.08)), V((BX - 0.2, FY_ + 0.15, 1.04)), V((BX, FY_ + 0.18, 1.02)),
           V((BX + 0.2, FY_ + 0.15, 1.04)), V((BX + 0.36, FY_ + 0.12, 1.08))]
    P.tube_mesh(m, bar, 0.012, D, sides=6)
    for sx in (-1, 1):
        P.cyl_mesh(m, 0.018, 0.12, trs(bar[0 if sx < 0 else -1] + V((sx * 0.04, 0, 0)), (0, 90, 0)), 'rubber', sides=8)
    hl = V((BX, FY_ + 0.05, 0.93))
    P.cyl_mesh(m, 0.09, 0.14, trs(hl, (90, 0, 0)), S_, sides=14, r2=0.095)
    P.cyl_mesh(m, 0.082, 0.012, trs(hl + V((0, -0.075, 0)), (90, 0, 0)), 'glass', sides=14)
    P.box_mesh(m, (0.16, 0.012, 0.06), trs(hl + V((0, -0.082, 0.045))), S_)
    # mudguards: deep front guard, rear guard
    msec = [(-0.07, -0.006), (0.07, -0.006), (0.07, 0.006), (-0.07, 0.006)]
    for (y, a0, a1) in ((FY_, 20, 170), (RY_, 10, 150)):
        pts = [V((BX, y - (R + 0.06) * math.cos(math.radians(a)), R + (R + 0.06) * math.sin(math.radians(a))))
               for a in range(a0, a1 + 1, 15)]
        P.sweep(m, pts, msec, S_, closed=True, caps=True, lateral=(1, 0, 0))
    # sidecar: a boat-shaped tub lofted along Y, its cockpit cut out, on a chassis
    sec_r = []
    for k, (y, wv, hv, z0) in enumerate(((-0.95, 0.08, 0.1, 0.62), (-0.82, 0.3, 0.3, 0.5), (-0.55, 0.52, 0.42, 0.42),
                                         (0.0, 0.6, 0.48, 0.38), (0.6, 0.6, 0.48, 0.38), (0.98, 0.5, 0.42, 0.42),
                                         (1.12, 0.22, 0.25, 0.5))):
        ring = []
        for j in range(12):
            a = 2 * math.pi * j / 12
            ring.append(V((CX + wv / 2 * math.cos(a), y, z0 + hv / 2 + hv / 2 * math.sin(a) * (1.0 if math.sin(a) > 0 else 0.8))))
        sec_r.append(ring)
    tubo = Mesh()
    P.loft(tubo, sec_r, S_, closed=True, cap0=True, cap1=True, soft=True)
    tub = tubo.build('sidecar')
    kit.cut(tub, kit.box((0.46, 0.85, 0.4), loc=(CX, 0.32, 0.98), mat=S_))
    parts.append(tub)
    P.bbox_mesh(m, (0.44, 0.3, 0.1), trs((CX, 0.4, 0.66)), 'leather', 0.03)
    P.bbox_mesh(m, (0.44, 0.08, 0.28), trs((CX, 0.66, 0.8), (-15, 0, 0)), 'leather', 0.03)
    P.tube_mesh(m, [V((CX - 0.22, -0.06, 0.88)), V((CX - 0.18, -0.1, 0.96)), V((CX + 0.18, -0.1, 0.96)),
                    V((CX + 0.22, -0.06, 0.88))], 0.01, D, sides=4)
    for y in (-0.4, 0.55):
        P.tube_mesh(m, [V((BX + 0.06, y, 0.28)), V((CX, y, 0.3)), V((CX + 0.36, y * 0.4 + 0.12, R))], 0.02, D, sides=6)
    pts = [V((CX + 0.36, 0.12 - (R + 0.06) * math.cos(math.radians(a)), R + (R + 0.06) * math.sin(math.radians(a))))
           for a in range(20, 161, 20)]
    P.sweep(m, pts, msec, S_, closed=True, caps=True, lateral=(1, 0, 0))
    sp = Mesh()
    P.wheel(sp, (0, 0, 0), R, 0.11, 1, mat_rim=S_, segs=16, tread=0.012, spoked=True, spokes=12)
    spo = sp.build('spare')
    P.transform(spo, trs((CX, 1.2, 0.62)) @ Matrix.Rotation(math.radians(90), 4, 'Z') @
                Matrix.Rotation(math.radians(8), 4, 'Y'))
    parts.append(spo)
    # the MG on its pintle at the front of the sidecar
    P.cyl_mesh(m, 0.018, 0.25, trs((CX, -0.55, 0.92)), D, sides=8)
    P.mg42(m, trs((CX, -0.5, 1.03), (0, 0, rng.uniform(-6, 6))), bipod=False)
    # tail light, number plate, a jerrycan behind the sidecar seat
    P.cyl_mesh(m, 0.03, 0.03, trs((BX, 1.02, 0.74), (90, 0, 0)), 'paint_red', sides=8)
    P.box_mesh(m, (0.2, 0.01, 0.12), trs((BX, 1.07, 0.66)), 'plate')
    parts.append(m)
    obj = P.join(parts, 'motorcycle_sidecar')
    cols = [cbox((BX, 0.0, 0.5), (0.5, 2.1, 1.0)), cbox((CX + 0.1, 0.1, 0.45), (0.75, 2.1, 0.9))]
    anchors = {'rider': ((BX, 0.25, 0.98), 0.0), 'gunner': ((CX, 0.35, 0.68), 0.0)}
    CLOSE['motorcycle_sidecar'] = ((0.0, 0.3, -0.1), -40.0, 15.0)
    return P.finish(obj, 'motorcycle_sidecar', cols, anchors, grime=0.35, grime_height=0.6, hard_angle=35)


@builder
def build_pak40():
    C = 'camo_de'
    D = 'metal_dark'
    R, WX = 0.42, 0.92
    TR = V((0.0, 0.18, 0.92))                # trunnion
    rng = random.Random(221)
    parts = []
    m = Mesh()
    w = Mesh()
    for sx in (-1, 1):
        P.wheel(w, (sx * WX, 0.0, R), R, 0.14, sx, mat_rim=C, segs=20, tread=0.01, nuts=8, flat=0.1)
    parts.append(w)
    P.tube_mesh(m, [(-WX + 0.05, 0.0, R), (WX - 0.05, 0.0, R)], 0.045, D, sides=8)
    P.bbox_mesh(m, (0.56, 0.62, 0.26), trs((0, 0.12, 0.55)), C, 0.02)
    # split trails, opened: box beams with spades, handles, a towing eye
    for sx in (-1, 1):
        a = V((sx * 0.2, 0.38, 0.52))
        b = V((sx * 1.28, 2.72, 0.12))
        d = b - a
        yaw = math.degrees(math.atan2(d.y, d.x)) - 90
        pitch = math.degrees(math.atan2(d.z, d.xy.length))
        hl = d.length
        pts = []
        for t, wv, hv in ((0.0, 0.11, 0.2), (1.0, 0.08, 0.13)):
            c = a + d * t
            side_ = V((math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0))
            for s_ in (-wv, wv):
                for zz in (-hv / 2, hv / 2):
                    pts.append(c + side_ * s_ + V((0, 0, zz)))
        beam = P.hull_object(pts, C)
        kit.bevel(beam, 0.01, 1, 30)
        parts.append(beam)
        sp_c = b + d.normalized() * 0.06
        P.bbox_mesh(m, (0.3, 0.025, 0.3), trs(sp_c + V((0, 0, -0.04)), (-30, 0, yaw)), C, 0.005)
        hp = a + d * 0.82
        P.tube_mesh(m, [hp + V((-0.12, 0, 0.06)), hp + V((-0.12, 0, 0.16)), hp + V((0.12, 0, 0.16)),
                        hp + V((0.12, 0, 0.06))], 0.012, D, sides=4)
        P.cyl_mesh(m, 0.04, 0.24, trs(a + V((0, -0.02, 0.0)), (0, 0, yaw)), D, sides=8)
    P.tube_mesh(m, [(-1.32, 2.8, 0.14), (-1.36, 2.92, 0.14), (-1.3, 2.98, 0.14)], 0.02, D, sides=5)
    # upper carriage: cradle, recuperator cylinders, the barrel with its muzzle brake, the breech
    g = Mesh()
    P.bbox_mesh(g, (0.26, 1.15, 0.2), trs((0, -0.45, -0.02)), C, 0.015)
    P.cyl_mesh(g, 0.06, 1.1, trs((0, -0.55, 0.15), (90, 0, 0)), C, sides=12)
    P.cyl_mesh(g, 0.07, 1.2, trs((0, -0.55, -0.16), (90, 0, 0)), C, sides=12)
    P.cyl_mesh(g, 0.085, 0.3, trs((0, -1.1, 0.0), (90, 0, 0)), C, sides=14)
    P.cyl_mesh(g, 0.07, 2.25, trs((0, -2.2, 0.0), (90, 0, 0)), C, sides=14, r2=0.055)
    for k, y in enumerate((-3.32, -3.46)):                                       # double-baffle brake
        P.bbox_mesh(g, (0.28, 0.08, 0.16), trs((0, y, 0.0)), C, 0.01)
    P.bbox_mesh(g, (0.12, 0.26, 0.12), trs((0, -3.39, 0.0)), C, 0.01)
    P.cyl_mesh(g, 0.05, 0.08, trs((0, -3.54, 0.0), (90, 0, 0)), C, sides=12)
    P.bbox_mesh(g, (0.32, 0.4, 0.3), trs((0, 0.22, 0.0)), D, 0.02)                 # breech ring and block
    P.box_mesh(g, (0.16, 0.02, 0.12), trs((0, 0.43, 0.0)), 'gun_metal')
    P.tube_mesh(g, [(0.16, 0.3, 0.05), (0.26, 0.38, 0.12), (0.3, 0.42, 0.12)], 0.012, D, sides=5)
    P.bbox_mesh(g, (0.06, 0.6, 0.09), trs((0.19, 0.15, -0.06)), D, 0.01)           # loading tray rails
    gun = g.build('pak_gun')
    P.transform(gun, Matrix.Translation(TR) @ Matrix.Rotation(math.radians(-3), 4, 'X'))
    parts.append(gun)
    muzzle = TR + Matrix.Rotation(math.radians(-3), 4, 'X') @ V((0, -3.58, 0))
    for sx in (-1, 1):
        cheek = [(-0.3, 0.6), (0.4, 0.6), (0.32, 0.95), (0.05, 1.05), (-0.25, 0.95)]
        c = kit.extrude_profile(cheek, 0.03, axis='X', mat=C)
        c.location = (sx * 0.17, 0, 0)
        parts.append(c)
    P.cyl_mesh(m, 0.05, 0.42, trs(TR, (0, 90, 0)), D, sides=10)
    # spaced shield: two plates angled back, the lower apron, a sight port
    shield_m = Matrix.Translation(V((0, -0.42, 0.0))) @ P.rot_about('X', -16, (0, 0, 0.42))
    outline = [(-1.0, 0.42), (1.0, 0.42), (1.0, 1.32), (0.82, 1.45), (0.2, 1.45), (0.2, 1.12), (-0.2, 1.12),
               (-0.2, 1.45), (-0.82, 1.45), (-1.0, 1.32)]
    for dy in (0.0, -0.06):
        pl = kit.extrude_profile(outline, 0.012, axis='Y', mat=C)
        P.transform(pl, shield_m @ Matrix.Translation(V((0, dy, 0))))
        kit.cut(pl, kit.box((0.12, 0.3, 0.08), loc=tuple(shield_m @ V((-0.5, dy, 1.25))), mat=C))
        parts.append(pl)
    apron = kit.box((1.5, 0.012, 0.3), loc=(0, -0.38, 0.28), mat=C)
    parts.append(apron)
    P.nails(m, [shield_m @ V((x, -0.07, z)) for x in (-0.9, -0.5, 0.5, 0.9) for z in (0.5, 1.3)],
            shield_m.to_3x3() @ V((0, -1, 0)), r=0.014, mat=D)
    # sight, handwheels, seats
    sight = V((-0.38, 0.0, 1.12))
    P.cyl_mesh(m, 0.03, 0.36, trs(sight, (90, 0, 0)), D, sides=10)
    P.cyl_mesh(m, 0.04, 0.05, trs(sight + V((0, 0.18, 0)), (90, 0, 0)), 'rubber', sides=10)
    P.box_mesh(m, (0.06, 0.1, 0.2), trs(sight + V((0, 0.0, -0.14))), D)
    for x, y, z in ((-0.36, 0.25, 0.8), (0.36, 0.25, 0.72)):
        ring = [(x, y + 0.1 * math.cos(2 * math.pi * k / 14), z + 0.1 * math.sin(2 * math.pi * k / 14)) for k in range(15)]
        P.tube_mesh(m, ring, 0.011, D, sides=5, caps=False)
        P.box_mesh(m, (abs(x) - 0.16, 0.025, 0.025), trs(((x + math.copysign(0.16, x)) / 2, y, z)), D)
        P.cyl_mesh(m, 0.011, 0.07, trs((x + math.copysign(0.035, x), y + 0.1, z), (0, 90, 0)), 'rubber', sides=6)
    # ammunition: an opened three-round basket, rounds, two spent cases by the breech
    bk = trs((0.85, 1.25, 0.0), (0, 0, 70))
    P.bbox_mesh(m, (0.36, 0.86, 0.12), bk @ trs((0, 0, 0.06)), 'paint_sand', 0.01)
    for k in range(3):
        rp = bk @ trs(((k - 1) * 0.11, 0.0, 0.17), (90, 0, 0))
        P.cyl_mesh(m, 0.048, 0.62, rp @ trs((0, 0, 0.06)), 'brass', sides=10)
        P.cyl_mesh(m, 0.04, 0.22, rp @ trs((0, 0, -0.35)), 'metal_dark', sides=10, r2=0.012)
    for (x, y, yaw) in ((0.35, 1.0, 20), (0.6, 0.75, 75)):
        P.cyl_mesh(m, 0.05, 0.71, trs((x, y, 0.05), (90, 0, yaw)), 'brass', sides=10, r2=0.044)
    parts.append(m)
    obj = P.join(parts, 'pak40')
    cols = [cbox((0, -0.47, 0.95), (2.0, 0.25, 1.05)), ccyl((-WX, 0, 0), R, 0.9), ccyl((WX, 0, 0), R, 0.9),
            cbox((-0.75, 1.55, 0.18), (0.25, 2.6, 0.36), -25), cbox((0.75, 1.55, 0.18), (0.25, 2.6, 0.36), 25)]
    anchors = {'muzzle': tuple(muzzle), 'gunner': ((-0.42, 0.45, 0.0), 0.0), 'loader': ((0.45, 0.75, 0.0), 0.0),
               'charge': ((0.0, 0.62, 0.92), 180.0)}
    CLOSE['pak40'] = ((0.0, 0.4, 0.0), -40.0, 12.0)
    return P.finish(obj, 'pak40', cols, anchors, grime=0.25, grime_height=0.6, hard_angle=35, center='xy')


@builder
def build_halftrack_wreck():
    B = 'burnt_body'
    RD = 'rust_dark'
    rng = random.Random(231)
    parts = []
    m = Mesh()
    w = Mesh()
    # ---- hull: the engine section as a closed loft of the faceted Ausf. D
    # armour; the open troop compartment as a lofted U of plate with walls
    def ring(y, bot, zb, mid, zm, top, zt):
        pts = [(-bot, zb), (-mid, zm), (-top, zt), (top, zt), (mid, zm), (bot, zb)]
        return [V((x, y, z)) for x, z in pts]
    hm = Mesh()
    P.loft(hm, [ring(-2.95, 0.35, 0.62, 0.55, 0.85, 0.45, 1.05), ring(-2.6, 0.55, 0.5, 0.9, 0.95, 0.75, 1.22),
                ring(-1.0, 0.62, 0.5, 1.0, 0.95, 0.85, 1.32), ring(-0.9, 0.62, 0.5, 1.0, 0.95, 0.85, 1.32)],
           B, closed=True, cap0=True, cap1=True)
    t = 0.045

    def uring(y, bot, zb, mid, zm, top, zt):
        outer = [(top, zt), (mid, zm), (bot, zb), (-bot, zb), (-mid, zm), (-top, zt)]
        inner = [(-top + t, zt), (-mid + t, zm), (-bot + t, zb + t), (bot - t, zb + t), (mid - t, zm), (top - t, zt)]
        return [V((x, y, z)) for x, z in outer + inner]
    urings = [uring(-0.92, 0.62, 0.5, 1.0, 0.95, 0.86, 1.62), uring(2.4, 0.62, 0.5, 1.0, 0.95, 0.88, 1.65),
              uring(2.75, 0.6, 0.55, 0.95, 0.95, 0.85, 1.6)]
    P.loft(hm, urings, B, closed=True, cap0=True, cap1=True)      # the U winds counter-clockwise about +Y
    hull = hm.build('hull')
    front = kit.box((1.72, 0.05, 1.12), loc=(0, -0.9, 0.5 + 0.56), mat=B)
    rear = kit.box((1.7, 0.05, 1.05), loc=(0, 2.72, 0.55 + 0.525), mat=B)
    kit.cut(rear, kit.box((0.9, 0.3, 0.72), loc=(0, 2.72, 0.75 + 0.36), mat=B))      # rear door opening
    hull = kit.join([hull, front, rear], 'hull')
    kit.subdivide(hull, 1, simple=True)
    kit.jitter(hull, 0.012, seed=9, scale=2.0)
    parts.append(hull)
    # engine deck: hatches, louvres, the driver's visors; front fenders; headlamp shells; exhaust
    for x in (-0.3, 0.3):
        P.bbox_mesh(m, (0.5, 0.75, 0.02), trs((x, -1.85, 1.29), (-3, 0, 0)), B, 0.006)
    for sx in (-1, 1):
        for k in range(5):
            P.box_mesh(m, (0.012, 0.035, 0.18), trs((sx * 0.94, -2.3 + k * 0.08, 1.05), (0, sx * 12, 0)), RD)
    for x in (-0.4, 0.4):
        P.box_mesh(m, (0.3, 0.015, 0.04), trs((x, -0.935, 1.45)), 'metal_dark')
    fsec = [(-0.17, -0.006), (0.17, -0.006), (0.17, 0.008), (-0.17, 0.008)]
    for sx in (-1, 1):
        pts = [V((sx * 0.9, -1.95 - 0.55 * math.cos(math.radians(a)), 0.42 + 0.55 * math.sin(math.radians(a)) - 0.02))
               for a in range(20, 161, 20)]
        P.sweep(m, pts, fsec, B, closed=True, caps=True, lateral=(1, 0, 0))
        P.cyl_mesh(m, 0.09, 0.14, trs((sx * 0.7, -2.62, 1.1), (90, 0, 0)), B, sides=12, r2=0.1)
    P.tube_mesh(m, [(-0.95, -1.5, 0.75), (-1.05, -1.0, 0.72), (-1.05, -0.4, 0.72)], 0.04, RD, sides=6)
    P.cyl_mesh(m, 0.08, 0.5, trs((-1.05, -0.6, 0.72), (90, 0, 0)), RD, sides=10)
    # the compartment: the front MG shield, burnt bench frames with springs, a rack
    sh = trs((0.0, -0.78, 1.82), (-8, 0, 0))
    P.bbox_mesh(m, (0.55, 0.02, 0.36), sh, B, 0.006)
    P.box_mesh(m, (0.08, 0.04, 0.2), sh @ trs((0, 0, -0.02)), 'metal_dark')
    for sx in (-1, 1):
        P.box_mesh(m, (0.3, 2.6, 0.03), trs((sx * 0.6, 0.95, 1.05)), RD)
        for k in range(9):
            y = -0.25 + k * 0.3
            P.tube_mesh(m, [V((sx * 0.6 + 0.05 * math.cos(a), y + 0.05 * math.sin(a), 1.08 + a * 0.01))
                            for a in [j * 0.9 for j in range(8)]], 0.005, RD, sides=3)
        for y in (-0.3, 1.0, 2.3):
            P.box_mesh(m, (0.03, 0.03, 0.35), trs((sx * 0.6, y, 0.87)), RD)
        P.box_mesh(m, (0.03, 3.0, 0.03), trs((sx * 0.74, 0.9, 1.45)), RD)
    # floor plates, stowage bins along the hull sides, a burnt jerrycan rack
    P.bbox_mesh(m, (1.5, 3.3, 0.03), trs((0, 0.86, 0.715)), RD, 0.005)
    for sx in (-1, 1):
        for (y, L) in ((-0.55, 0.9), (0.55, 1.1), (1.85, 0.9)):
            P.bbox_mesh(m, (0.14, L, 0.3), trs((sx * 1.04, y, 1.1), (0, sx * -8, 0)), B, 0.012)
            P.box_mesh(m, (0.02, 0.06, 0.04), trs((sx * 1.115, y, 1.18)), RD)
    for k in range(2):
        P.jerrycan(m, trs((0.55 + k * 0.0, 2.95, 0.6 + k * 0.0), (0, 0, 90)) if k == 0 else
                   trs((-0.6, 2.93, 0.62), (0, 8, 90)), B)
    # rear door hanging open on one hinge
    door = Mesh()
    P.bbox_mesh(door, (0.44, 0.03, 0.7), trs((0.22, 0, 0.35)), B, 0.008)
    P.box_mesh(door, (0.06, 0.02, 0.04), trs((0.36, -0.03, 0.4)), RD)
    d = door.build('door')
    P.transform(d, trs((0.45, 2.78, 0.76)) @ Matrix.Rotation(math.radians(115), 4, 'Z')
                @ Matrix.Rotation(math.radians(6), 4, 'X'))
    parts.append(d)
    P.bbox_mesh(m, (0.44, 0.03, 0.7), trs((-0.23, 2.76, 1.11)), B, 0.008)
    # ---- running gear: front wheels burnt to the rims, sprockets, idlers, interleaved road wheels
    for sx in (-1, 1):
        P.wheel(w, (sx * 0.85, -1.95, 0.27), 0.44, 0.2, sx, rim_only=True, rim_mat=RD, segs=16, nuts=6)
    P.tube_mesh(m, [(-0.8, -1.95, 0.3), (0.8, -1.95, 0.3)], 0.05, RD, sides=6)
    for sx in (-1, 1):
        thrown = sx < 0
        sp = []
        for k in range(36):
            a = 2 * math.pi * k / 36
            r_ = 0.34 if k % 2 else 0.31
            sp.append(V((sx * 0.8, -1.15 + r_ * math.cos(a), 0.45 + r_ * math.sin(a))))
        P.loft(m, [[p + V((sx * -0.06, 0, 0)) for p in sp], [p + V((sx * 0.06, 0, 0)) for p in sp]][::(1 if sx > 0 else -1)],
               RD, closed=True, cap0=True, cap1=True)
        P.cyl_mesh(m, 0.28, 0.14, trs((sx * 0.8, 2.45, 0.45), (0, 90, 0)), RD, sides=16)
        for k, y in enumerate((-0.68, -0.22, 0.24, 0.7, 1.16, 1.62, 2.06)):
            if thrown and k in (2, 5):
                continue
            x = sx * (0.9 if k % 2 else 0.7)
            P.cyl_mesh(m, 0.29, 0.07, trs((x, y, 0.31), (0, 90, 0)), RD, sides=16)
            P.cyl_mesh(m, 0.08, 0.1, trs((x, y, 0.31), (0, 90, 0)), RD, sides=8)
        tsec = [(-0.14, -0.018), (0.14, -0.018), (0.14, 0.018), (-0.14, 0.018)]
        if not thrown:
            path = [V((sx * 0.8, -1.15 + 0.36 * math.cos(math.radians(a)), 0.45 + 0.36 * math.sin(math.radians(a))))
                    for a in range(90, 271, 30)]
            path += [V((sx * 0.8, y, 0.035)) for y in (-0.7, 0.3, 1.3, 2.1)]
            path += [V((sx * 0.8, 2.45 - 0.34 * math.cos(math.radians(a)), 0.45 + 0.34 * math.sin(math.radians(a))))
                     for a in range(-90, 91, 30)]
            path += [V((sx * 0.8, y, 0.62 + 0.03 * math.sin(y * 3))) for y in (1.8, 1.0, 0.2, -0.6)]
            path.append(path[0])
            P.sweep(m, path, tsec, RD, closed=True, caps=False, lateral=(1, 0, 0))
        else:
            # the track came off: one run lies flat under the wheels and trails out behind, twisted
            path = [V((sx * 0.8, -1.5, 0.02)), V((sx * 0.8, -0.5, 0.02)), V((sx * 0.82, 0.8, 0.02)),
                    V((sx * 0.86, 2.2, 0.02)), V((sx * 0.98, 2.9, 0.02)), V((sx * 1.15, 3.45, 0.03)),
                    V((sx * 1.3, 3.75, 0.1)), V((sx * 1.35, 3.85, 0.22))]
            P.sweep(m, path, tsec, RD, closed=True, caps=True, lateral=(1, 0, 0))
            P.cyl_mesh(m, 0.29, 0.07, trs((sx * 1.35, 1.0, 0.035), (0, 0, 20)), RD, sides=16)
    parts.append(w)
    parts.append(m)
    obj = P.join(parts, 'halftrack_wreck')
    cols = [cbox_minmax((-1.0, -2.95, 0), (1.0, -0.92, 1.32)),
            cbox_minmax((-1.05, -0.92, 0), (-0.78, 2.75, 1.65)), cbox_minmax((0.78, -0.92, 0), (1.05, 2.75, 1.65)),
            cbox_minmax((-0.78, -0.95, 0), (0.78, -0.82, 1.62)),
            cbox_minmax((-0.78, -0.82, 0), (0.78, 2.6, 0.7)),
            cbox_minmax((-0.78, 2.6, 0), (-0.45, 2.75, 1.6)), cbox_minmax((0.45, 2.6, 0), (0.78, 2.75, 1.6))]
    anchors = {'fire': (0.0, 0.8, 0.95)}
    CLOSE['halftrack_wreck'] = ((0.0, 0.2, 0.2), -35.0, 15.0)
    return P.finish(obj, 'halftrack_wreck', cols, anchors, grime=0.45, grime_height=1.0, hard_angle=35)


# per-node bake settings (texels per metre, bevel radius of the baked edges)
# v3: atlas sizes chosen per node (2 m close-ups), not from texels per metre.
# 2048 atlases bake with fewer samples (the texels average the noise) and keep
# roughness / metal at half size; islands are scaled by visibility first.
HI = dict(size=2048, samples_ao=14, samples_edge=5, samples_normal=4)
BAKE = {
    # 2048: the big pieces players take cover behind
    'truck': dict(HI), 'truck_burnt': dict(HI), 'halftrack_wreck': dict(HI), 'jeep_wreck': dict(HI),
    'kubelwagen': dict(HI), 'pak40': dict(HI, bevel=0.008), 'bunker': dict(HI), 'mg_nest': dict(HI),
    'sandbags': dict(HI), 'sandbags_curve': dict(HI),
    # 1024
    'flak38': dict(size=1024, bevel=0.008), 'motorcycle_sidecar': dict(size=1024, bevel=0.006),
    'dugout_entrance': dict(size=1024), 'watchtower': dict(size=1024), 'tent': dict(size=1024),
    'sandbags_low': dict(size=1024), 'sandbags_ruined': dict(size=1024), 'trench_wall': dict(size=1024),
    'barbed_wire': dict(size=1024, bevel=0.004), 'hedgehog': dict(size=1024, bevel=0.006),
    'barrier': dict(size=1024, bevel=0.008), 'sentry_box': dict(size=1024, bevel=0.008),
    'radio_table': dict(size=1024, bevel=0.006), 'crate': dict(size=1024, bevel=0.006),
    'crate_large': dict(size=1024, bevel=0.008), 'barrel': dict(size=1024, bevel=0.006),
    'ammo_stack': dict(size=1024, bevel=0.006), 'jerrycan_stack': dict(size=1024, bevel=0.005),
    'drum_stack': dict(size=1024, bevel=0.006), 'camo_net': dict(size=512, keep=('camo_net_cards',)),
    'mg42_tripod': dict(size=1024, bevel=0.003), 'cable_reel': dict(size=512, bevel=0.004),
    # 512: small props
    'jerrycan': dict(size=512, bevel=0.004), 'ammo_box': dict(size=512, bevel=0.003),
    'medkit': dict(size=512, bevel=0.004), 'charge': dict(size=512, bevel=0.003),
    'stretcher': dict(size=512, bevel=0.005), 'dropped_helmet_de': dict(size=512, bevel=0.003),
    'dropped_helmet_us': dict(size=512, bevel=0.003), 'field_telephone': dict(size=512, bevel=0.003),
    'sign_minen': dict(size=512, bevel=0.004), 'duckboard': dict(size=512, bevel=0.006),
}
CLOSE = {}           # node -> (focus offset from the default focus, azimuth, elevation)


KIND_OF = {      # v3 weathering context per node (military_parts.KIND)
    'truck': 'vehicle', 'kubelwagen': 'vehicle', 'motorcycle_sidecar': 'vehicle',
    'truck_burnt': 'wreck', 'jeep_wreck': 'wreck', 'halftrack_wreck': 'wreck',
    'pak40': 'gun', 'flak38': 'gun',
    'sandbags': 'bags', 'sandbags_low': 'bags', 'sandbags_curve': 'bags', 'sandbags_ruined': 'bags',
    'mg_nest': 'bags', 'bunker': 'concrete',
    'trench_wall': 'wood', 'duckboard': 'wood', 'barbed_wire': 'wood', 'watchtower': 'wood', 'sentry_box': 'wood',
    'barrier': 'wood', 'sign_minen': 'wood', 'dugout_entrance': 'wood', 'crate_large': 'wood',
    'jerrycan': 'small', 'ammo_box': 'small', 'medkit': 'small', 'charge': 'small', 'dropped_helmet_de': 'small',
    'dropped_helmet_us': 'small', 'field_telephone': 'small',
}


def bake_cfg(name):
    d = dict(tpm=110, bevel=0.01, kind=KIND_OF.get(name, 'prop'))
    d.update(BAKE.get(name, {}))
    return d


def main():
    t0 = time.time()
    args = kit.args_after_dashes()
    flags = {a for a in args if a.startswith('--')}
    names = [a for a in args if not a.startswith('--')]
    for n in names:
        if n not in BUILDERS:
            raise SystemExit(f'unknown node {n!r}; known: {", ".join(BUILDERS)}')
    do_bake = '--no-bake' not in flags
    if '--fast' in flags:
        import bake as _b
        _b.FAST = True
    kit.reset()
    P.register_surfaces()
    objs = []
    for name, fn in BUILDERS.items():
        if names and name not in names:
            continue
        t = time.time()
        obj = fn()
        assert obj.name == name, (obj.name, name)
        bad = P.check_normals(obj)
        mn, mx = kit.bounds(obj)
        size = mx - mn
        kit.log(f'{name:18s} {size.x:5.2f} x {size.y:5.2f} x {size.z:5.2f} m  {kit.tri_count(obj):5d} tris  '
                f'mats {[m.name for m in obj.data.materials]}  {time.time() - t:.1f}s'
                + (f'  INSIDE-OUT islands: {bad[:4]} (+{len(bad) - 4 if len(bad) > 4 else 0})' if bad else ''))
        if do_bake:
            obj = P.bake(obj, **bake_cfg(name))
        objs.append(obj)
        obj.hide_render = True
    for o in objs:
        o.hide_render = False
    if not names:
        path = os.path.join(kit.MODELS, 'military.glb')
    else:
        path = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'military_partial.glb')
    kit.export(objs, path, images=do_bake)
    if '--no-previews' not in flags:
        if not do_bake:
            P.preview_materials()
        out = os.path.join(kit.PREVIEWS, 'military')
        smp = 16 if do_bake else 12
        for obj in objs:
            P.preview(obj, os.path.join(out, obj.name + '.png'), size=768, samples=smp)
            P.preview(obj, os.path.join(out, obj.name + '_back.png'), size=768, samples=smp, azimuth=150)
            P.closeup(obj, os.path.join(out, obj.name + '_close.png'), *CLOSE.get(obj.name, ()), size=768,
                      samples=smp)
    kit.log(f'military done in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
