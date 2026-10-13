"""Meteora — parts, paint, baking and anchors for build_civil.py.

Helpers shared by the three civil models (the Mule freighter, Varlaam
station, the Long Mercy ark): oriented primitives (cylinders, capsules,
chamfered lofts, pipes, lattice trusses), window panels textured by a
small repeating window tile, turrets, the industrial paint finish for big
hulls, stencil text, baking a texture set, collider fitting, and the
generated anchors module. Importing this module builds nothing.
"""
import bpy, bmesh, math, os, random, sys, time
import numpy as np
from mathutils import Vector, Matrix

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C
import build_ships as S

FAST = bool(os.environ.get('METEORA_FAST'))
lin = S.lin

# Belt civilian palette (linear RGB).
WHITE = lin('#d3cec4')          # weathered off-white
WHITE_B = lin('#c4beb2')        # a second, older off-white for patch plates
WARM_GREY = lin('#8a8379')
DARK_GREY = lin('#4a4641')
GRAPHITE = lin('#2b2d31')
STEEL = lin('#5d5a55')
RUST = lin('#b8652a')           # cargo paint
RUST_STAIN = lin('#6b3a1e')
HAZARD = lin('#d9a21b')
TEAL = lin('#2e6f8e')           # faded Perpetua mission teal
GOLD = lin('#b8923a')
BARE = lin('#8f8e8b')
SOOT = S.SOOT


# ==========================================================================
# Frames and oriented primitives

def basis(origin, z=(0, 0, 1), y=(0, 1, 0)):
    """A matrix at `origin` whose local Z is `z` and local Y is as close to
    `y` as possible."""
    z = Vector(z).normalized()
    y = Vector(y)
    y = y - z * y.dot(z)
    if y.length < 1e-6:
        y = Vector((0, 1, 0)) if abs(z.y) < 0.9 else Vector((1, 0, 0))
        y = y - z * y.dot(z)
    y.normalize()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


def span(p0, p1, up=(0, 0, 1)):
    """(matrix, length): local Y runs from p0 toward p1 (origin at p0),
    local Z as close to `up` as possible."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    y = d / length
    z = Vector(up)
    z = z - y * z.dot(y)
    if z.length < 1e-6:
        z = Vector((1, 0, 0)) if abs(y.x) < 0.9 else Vector((0, 0, 1))
        z = z - y * z.dot(y)
    z.normalize()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = p0
    return m, length


def revolve(name, profile, p0, p1, mat, sides=16, up=(0, 0, 1), closed=False, smooth=True, sharp=35, phase=None):
    """Lathe a (t, r) profile about the axis p0 -> p1, t in metres from p0."""
    m, _ = span(p0, p1, up)
    ph = math.pi / sides if phase is None else phase
    obj = S.lathe(name, profile, sides, (0, 0), mat, closed=closed, smooth=smooth, sharp=sharp, phase=ph)
    return S.transformed(obj, m)


def cylinder(name, p0, p1, r, mat, sides=16, r1=None, caps=(True, True), up=(0, 0, 1), phase=None,
             smooth=True, sharp=35):
    """A (possibly tapered) cylinder from p0 to p1. Facet k spans the angles
    2*pi*k/sides + phase .. 2*pi*(k+1)/sides + phase about the local Y axis
    (local X = 0 rad, local Z = 90 deg)."""
    _, length = span(p0, p1, up)
    r1 = r if r1 is None else r1
    prof = [(0.0, 0.0)] if caps[0] else []
    prof += [(0.0, r), (length, r1)]
    if caps[1]:
        prof.append((length, 0.0))
    return revolve(name, prof, p0, p1, mat, sides, up, smooth=smooth, sharp=sharp, phase=phase)


def capsule(name, p0, p1, r, mat, sides=16, end=0.55, segs=3, up=(0, 0, 1)):
    """A tank: a cylinder with domed ends `end * r` deep."""
    _, length = span(p0, p1, up)
    h = r * end
    prof = [(0.0, 0.0)]
    for k in range(1, segs + 1):
        a = math.pi / 2 * k / segs
        prof.append((h * (1 - math.cos(a)), r * math.sin(a)))
    for k in range(segs, 0, -1):
        a = math.pi / 2 * k / segs
        prof.append((length - h * (1 - math.cos(a)), r * math.sin(a)))
    prof.append((length, 0.0))
    return revolve(name, prof, p0, p1, mat, sides, up, sharp=60)


def block(name, centre, size, mat, z=(0, 0, 1), y=(0, 1, 0), taper=1.0):
    """S.box centred at `centre`, oriented by basis(z, y)."""
    return S.box(name, size, mat, basis(centre, z, y), taper)


def chamfer_rect(hw, b, t, c, cx=0.0):
    """Eight points of a rectangle |a - cx| <= hw, b <= z <= t with chamfered
    corners, counter-clockwise from +a."""
    return [(cx + hw, b + c), (cx + hw, t - c), (cx + hw - c, t), (cx - hw + c, t), (cx - hw, t - c),
            (cx - hw, b + c), (cx - hw + c, b), (cx + hw - c, b)]


def loft(name, rings, mat, axis='Y', matrix=None, caps=(True, True), smooth=False, sharp=None):
    """Join cross-sections with equal point counts. rings: [(t, [(a, b), ...])];
    axis 'Y' places (a, t, b), 'Z' (a, b, t), 'X' (t, a, b). Ends are capped
    with n-gons."""
    bm = bmesh.new()
    vs = []
    for t, pts in rings:
        if axis == 'Y':
            co = [(a, t, b) for a, b in pts]
        elif axis == 'Z':
            co = [(a, b, t) for a, b in pts]
        else:
            co = [(t, a, b) for a, b in pts]
        vs.append([bm.verts.new(c) for c in co])
    S.ring_faces(bm, vs)
    if caps[0]:
        bm.faces.new(vs[0][::-1])
    if caps[1]:
        bm.faces.new(vs[-1])
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return S.finish_bm(name, bm, mat, smooth=smooth, sharp=sharp)


def sphere(name, centre, r, mat, segs=12, rings=8, squash=1.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co.z *= squash
    bmesh.ops.translate(bm, vec=Vector(centre), verts=bm.verts)
    return S.finish_bm(name, bm, mat, smooth=True)


def dome(name, centre, r, mat, z=(0, 0, 1), segs=16, rings=5, height=1.0, base=0.0):
    """A dome (a spherical cap of `height` * r) standing on its rim, with a
    short skirt `base` metres down so it sits into uneven ground."""
    prof = [(-base, 0.0), (-base, r)]
    for k in range(rings + 1):
        a = math.pi / 2 * k / rings
        prof.append((r * height * math.sin(a), r * math.cos(a)))
    prof[-1] = (r * height, 0.0)
    m = basis(centre, z) @ Matrix.Rotation(math.radians(90), 4, 'X')
    return S.transformed(S.lathe(name, prof, segs, (0, 0), mat, sharp=50, phase=0.0), m)


def add_bar(bm, p0, p1, w, h=None, up=None, caps=True):
    """Append a rectangular bar from p0 to p1 to a bmesh."""
    h = w if h is None else h
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    if d.length < 1e-6:
        return
    t = d.normalized()
    u = Vector(up) if up is not None else Vector((0, 0, 1))
    u = u - t * u.dot(t)
    if u.length < 1e-4:
        u = Vector((1, 0, 0)) - t * t.x
        if u.length < 1e-4:
            u = Vector((0, 1, 0)) - t * t.y
    u.normalize()
    s = t.cross(u)
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    r0 = [bm.verts.new(p0 + s * cx * w / 2 + u * cz * h / 2) for cx, cz in corners]
    r1 = [bm.verts.new(p1 + s * cx * w / 2 + u * cz * h / 2) for cx, cz in corners]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    if caps:
        bm.faces.new(r0[::-1])
        bm.faces.new(r1)


def bars(name, segments, w, mat, h=None, up=None, caps=True):
    """Many bars in one object: segments [(p0, p1)] or [(p0, p1, up)]."""
    bm = bmesh.new()
    for seg in segments:
        add_bar(bm, seg[0], seg[1], w, h, seg[2] if len(seg) > 2 else up, caps)
    return S.finish_bm(name, bm, mat, smooth=False)


def truss(name, p0, p1, w, mat, bay=None, up=(0, 0, 1), chord=None, web=None, tri=False, ends=True, battens=True):
    """A lattice girder from p0 to p1: square (or triangular) section `w`
    wide, chords at the corners, battens and zig-zag diagonals per bay."""
    m, length = span(p0, p1, up)
    n = max(1, round(length / (bay or w * 1.3)))
    chord = chord or w * 0.13
    web = web or w * 0.075
    if tri:
        k = w / math.sqrt(3)
        corners = [(0.0, k), (-w / 2, -k / 2), (w / 2, -k / 2)]
    else:
        corners = [(-w / 2, -w / 2), (w / 2, -w / 2), (w / 2, w / 2), (-w / 2, w / 2)]
    rot = m.to_3x3()
    P = lambda c, y: m @ Vector((c[0], y, c[1]))
    bm = bmesh.new()
    for c in corners:
        add_bar(bm, P(c, 0.0), P(c, length), chord, up=rot @ Vector((c[0], 0, c[1])), caps=ends)
    nc = len(corners)
    for i in range(n + 1):
        if not battens and 0 < i < n:
            continue
        y = length * i / n
        for j in range(nc):
            a, b = corners[j], corners[(j + 1) % nc]
            out = rot @ Vector(((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2))
            add_bar(bm, P(a, y), P(b, y), web, up=out, caps=False)
    for i in range(n):
        y0, y1 = length * i / n, length * (i + 1) / n
        for j in range(nc):
            a, b = corners[j], corners[(j + 1) % nc]
            out = rot @ Vector(((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2))
            if (i + j) % 2:
                add_bar(bm, P(a, y0), P(b, y1), web, up=out, caps=False)
            else:
                add_bar(bm, P(b, y0), P(a, y1), web, up=out, caps=False)
    return S.finish_bm(name, bm, mat, smooth=False)


def pipe(name, path, r, mat, sides=6, caps=True):
    """A round pipe along a polyline (parallel-transported frames)."""
    pts = [Vector(p) for p in path]
    bm = bmesh.new()
    rings, n_prev = [], None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - p).normalized() + (p - pts[i - 1]).normalized()).normalized()
        n = n_prev if n_prev is not None else (Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)))
        n = (n - t * n.dot(t)).normalized()
        n_prev = n
        b = t.cross(n)
        rings.append([bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r)
                      for a in (2 * math.pi * k / sides for k in range(sides))])
    S.ring_faces(bm, rings)
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    return S.finish_bm(name, bm, mat, smooth=True, sharp=60)


def dish(name, centre, axis, r, mat, depth=0.35, sides=16, up=(0, 0, 1)):
    """A parabolic dish facing along `axis` with a feed horn and a back strut."""
    a = Vector(axis).normalized()
    c = Vector(centre)
    prof = [(0.0, 0.0)]
    for k in range(1, 5):
        rr = r * k / 4
        prof.append((depth * r * (rr / r) ** 2, rr))
    prof += [(depth * r + 0.04 * r, r), (depth * r * 0.6, r * 0.55), (-0.05 * r, 0.12 * r), (-0.05 * r, 0.0)]
    body = revolve(name, prof, c, c + a, mat, sides, up, closed=False, sharp=40)
    horn = cylinder(name + '_horn', c + a * (depth * r * 0.1), c + a * (depth * r + 0.55 * r), 0.03 * r, mat, sides=6,
                    up=up)
    tip = cylinder(name + '_feed', c + a * (depth * r + 0.5 * r), c + a * (depth * r + 0.62 * r), 0.07 * r, mat,
                   sides=8, up=up)
    return [body, horn, tip]


def arc(name, profile, a0, a1, steps, mat, centre=(0.0, 0.0), caps=True):
    """Sweep a closed (y, r) profile about the Y axis from angle a0 to a1
    (same angle convention as S.lathe), capped at both ends: a segment of a
    torus-like ring."""
    bm = bmesh.new()
    cx, cz = centre
    rings = []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        rings.append([bm.verts.new((cx + r * math.cos(a), y, cz + r * math.sin(a))) for y, r in profile])
    S.ring_faces(bm, rings)
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    return S.finish_bm(name, bm, mat, smooth=True, sharp=30)


def tag(obj, **values):
    """Per-face float attributes for the paint (read with an Attribute node)."""
    me = obj.data
    n = len(me.polygons)
    for key, val in values.items():
        attr = me.attributes.get(key) or me.attributes.new(key, 'FLOAT', 'FACE')
        attr.data.foreach_set('value', np.full(n, float(val), np.float32))
    return obj


# ==========================================================================
# Window panels

def _srgb(hexcode):
    return np.array([int(hexcode[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)


def window_images(name='windows', size=512, cells=8, seed=5):
    """A repeating tile of cells x cells windows (base colour and emission,
    sRGB). Lit windows vary in warmth and level; some rows are dim, some
    blinds half-drawn, every window has a mullion and a sill."""
    rng = random.Random(seed)
    px = size // cells
    base = np.zeros((size, size, 4), np.float32)
    glow = np.zeros((size, size, 4), np.float32)
    base[..., 3] = glow[..., 3] = 1.0
    frame, sill, dark = _srgb('#3b3936'), _srgb('#77726b'), _srgb('#1a2129')
    lit_glass = _srgb('#d8c29a')
    warm = [_srgb(h) for h in ('#ffd9a0', '#ffe4bb', '#ffc47e', '#fff0d6', '#ffd08e', '#ffdcab')]
    base[..., :3] = frame
    for j in range(cells):
        dim_row = rng.random() < 0.2
        for i in range(cells):
            x0, x1 = i * px + int(px * 0.17), i * px + int(px * 0.83)
            y0, y1 = j * px + int(px * 0.26), j * px + int(px * 0.78)
            base[y0 - 3:y0, x0 - 2:x1 + 2, :3] = sill
            if rng.random() < (0.28 if dim_row else 0.72):
                col = rng.choice(warm) * rng.uniform(0.5, 1.0)
                glow[y0:y1, x0:x1, :3] = col
                base[y0:y1, x0:x1, :3] = lit_glass
                if rng.random() < 0.22:
                    cut = y0 + int((y1 - y0) * rng.uniform(0.35, 0.7))
                    glow[cut:y1, x0:x1, :3] *= 0.1
                    base[cut:y1, x0:x1, :3] = _srgb('#4a4136')
            else:
                base[y0:y1, x0:x1, :3] = dark
                base[y1 - 4:y1, x0:x1, :3] = _srgb('#2c3640')       # a faint reflection at the top
            mx = (x0 + x1) // 2
            base[y0:y1, mx - 1:mx + 2, :3] = frame
            glow[y0:y1, mx - 1:mx + 2, :3] = 0.0
    imgs = []
    for suffix, arr in (('_base', base), ('_emissive', glow)):
        img = bpy.data.images.new(name + suffix, size, size, alpha=False, float_buffer=False)
        img.pixels.foreach_set(np.ascontiguousarray(arr).ravel())
        img.update()
        img.pack()
        imgs.append(img)
    return imgs


def window_material(name='windows'):
    base, glow = window_images(name)
    mat = bpy.data.materials.new(name)
    g = C.Graph(mat)
    tb = g.node('ShaderNodeTexImage', image=base)
    te = g.node('ShaderNodeTexImage', image=glow)
    bsdf = g.principled(tb.outputs['Color'], 0.32, 0.0)
    g.feed(bsdf.inputs['Emission Color'], te.outputs['Color'])
    g.feed(bsdf.inputs['Emission Strength'], 1.0)
    return mat


class Windows:
    """Window panels: quads a few centimetres proud of the hull whose UVs
    repeat the window tile, one tile cell per window. Built into one mesh
    that joins the hull after the bake (it takes no atlas space)."""
    TILE = 8

    def __init__(self, seed):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.rng = random.Random(seed)

    def panel(self, centre, udir, vdir, w, h, cell, out=None, offset=0.06, snap=True):
        """A w x h panel centred at `centre`: window columns along udir,
        rows (decks) along vdir; `cell` = (column pitch, row pitch) in
        metres. `out` flips udir so the panel faces outward."""
        u, v = Vector(udir).normalized(), Vector(vdir).normalized()
        if out is not None and u.cross(v).dot(Vector(out)) < 0:
            u = -u
        n = u.cross(v)
        nu = max(1, round(w / cell[0]))
        nv = max(1, round(h / cell[1]))
        if snap:
            w, h = min(w, nu * cell[0]), min(h, nv * cell[1])
        c = Vector(centre) + n * offset
        corners = [c - u * w / 2 - v * h / 2, c + u * w / 2 - v * h / 2, c + u * w / 2 + v * h / 2,
                   c - u * w / 2 + v * h / 2]
        u0 = self.rng.randrange(self.TILE) / self.TILE
        v0 = self.rng.randrange(self.TILE) / self.TILE
        du, dv = nu / self.TILE, nv / self.TILE
        uvs = [(u0, v0), (u0 + du, v0), (u0 + du, v0 + dv), (u0, v0 + dv)]
        f = self.bm.faces.new([self.bm.verts.new(p) for p in corners])
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        return f

    def quad(self, corners, cell, out, inset=(0.1, 0.12), offset=0.06):
        """A panel on a planar quad face (corners in order around it), inset
        by fractions of its width and height; columns along corners[0]->[1]."""
        a, b, c, d = (Vector(p) for p in corners)
        centre = (a + b + c + d) / 4
        udir = ((b - a) + (c - d)) / 2
        vdir = ((d - a) + (c - b)) / 2
        w, h = udir.length * (1 - 2 * inset[0]), vdir.length * (1 - 2 * inset[1])
        vn = vdir - udir.normalized() * vdir.dot(udir.normalized())
        return self.panel(centre, udir, vn, w, h, cell, out, offset)

    def ring(self, matrix, r, sides, phase, t0, t1, cell, facets=None, margin=0.14, offset=0.06):
        """Panels on the facets of a cylinder built by `cylinder` (same
        sides and phase) whose frame is `matrix` (local Y = axis): window
        columns around, decks along the axis from t0 to t1."""
        rot = matrix.to_3x3()
        apothem = r * math.cos(math.pi / sides)
        width = 2 * r * math.sin(math.pi / sides) * (1 - margin)
        for k in (range(sides) if facets is None else facets):
            a = 2 * math.pi * (k + 0.5) / sides + phase
            out = rot @ Vector((math.cos(a), 0, math.sin(a)))
            tang = rot @ Vector((-math.sin(a), 0, math.cos(a)))
            axis = rot @ Vector((0, 1, 0))
            centre = matrix @ Vector((apothem * math.cos(a), (t0 + t1) / 2, apothem * math.sin(a)))
            self.panel(centre, tang, axis, width, t1 - t0, cell, out, offset, snap=False)

    def build(self, name, mat):
        bm = self.bm
        obj = C.object_from_bmesh(name, bm, smooth=False)
        obj.data.materials.append(mat)
        return obj


# ==========================================================================
# Stencil text (5 x 7 font) for painted names and numbers

FONT = {
    '0': (' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '),
    '1': ('  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '),
    '2': (' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'),
    '3': ('#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '),
    '4': ('   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '),
    '5': ('#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '),
    '6': ('  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '),
    '7': ('#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '),
    '8': (' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '),
    '9': (' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '),
    'A': (' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'),
    'B': ('#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '),
    'C': (' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '),
    'D': ('#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '),
    'E': ('#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'),
    'F': ('#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '),
    'G': (' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ####'),
    'H': ('#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'),
    'I': (' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '),
    'K': ('#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'),
    'L': ('#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'),
    'M': ('#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'),
    'N': ('#   #', '#   #', '##  #', '# # #', '#  ##', '#   #', '#   #'),
    'O': (' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '),
    'P': ('#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '),
    'R': ('#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'),
    'S': (' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '),
    'T': ('#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '),
    'U': ('#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '),
    'V': ('#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '),
    'W': ('#   #', '#   #', '#   #', '# # #', '# # #', '# # #', ' # # '),
    'Y': ('#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '),
    '-': ('     ', '     ', '     ', '#####', '     ', '     ', '     '),
    ' ': ('     ',) * 7,
}


def text_image(name, strings):
    """One row of equal cells, one string per cell, centred; 1 on the
    letters. Returns (image, cell count, cell aspect w/h)."""
    n = max(len(s) for s in strings)
    cw, ch = n * 6 + 1, 9
    arr = np.zeros((ch, cw * len(strings)), np.float32)
    for k, s in enumerate(strings):
        x0 = k * cw + 1 + (n - len(s)) * 3
        for i, letter in enumerate(s):
            for row, line in enumerate(FONT[letter]):
                for col, c in enumerate(line):
                    if c == '#':
                        arr[ch - 2 - row, x0 + i * 6 + col] = 1.0
    h, w = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    px = np.zeros((h, w, 4), np.float32)
    px[..., 0] = px[..., 1] = px[..., 2] = arr
    px[..., 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()
    return img, len(strings), cw / ch


def decal(g, img, cells, u, v, cell=0.0):
    """Letters mask of a text image: u, v run 0..1 over one cell's
    rectangle; `cell` (value or socket) picks which string."""
    inside = g.mul(g.mul(g.math('GREATER_THAN', u, 0.0), g.math('LESS_THAN', u, 1.0)),
                   g.mul(g.math('GREATER_THAN', v, 0.0), g.math('LESS_THAN', v, 1.0)))
    uu = g.math('DIVIDE', g.add(g.minimum(g.maximum(u, 0.0), 0.999), cell), float(cells))
    t = g.node('ShaderNodeTexImage', image=img, interpolation='Closest', extension='EXTEND')
    g.feed(t.inputs['Vector'], g.combine(uu, g.minimum(g.maximum(v, 0.0), 0.999), 0.0))
    letters = g.node('ShaderNodeSeparateColor', [t.outputs['Color']]).outputs[0]
    return g.mul(letters, inside)


# ==========================================================================
# Paint

def band(g, v, lo, hi, soft=0.02):
    return S.band(g, v, lo, hi, soft)


def hazard(g, u, v, width=0.5):
    return S.hazard(g, u, v, width)


def bricks(g, u, v, size, line, shift=0.0):
    """Panel seams on an explicit (u, v) parametrisation in metres."""
    k = min(1.0, 0.08 / max(line, 1e-4))
    n = g.node('ShaderNodeTexBrick', offset=0.5, squash=1.0, offset_frequency=2, squash_frequency=2)
    g.feed(n.inputs['Vector'], g.combine(g.add(u, shift), g.add(v, shift * 0.37), 0.0))
    for key, val in (('Scale', k), ('Mortar Size', line * k), ('Mortar Smooth', 0.2), ('Bias', 0.0),
                     ('Brick Width', size[0] * k), ('Row Height', size[1] * k),
                     ('Color1', (0, 0, 0)), ('Color2', (1, 1, 1)), ('Mortar', (0.5, 0.5, 0.5))):
        g.feed(n.inputs[key], val)
    return n.outputs['Factor'], g.node('ShaderNodeSeparateColor', [n.outputs['Color']]).outputs[0]


def seams(g, P, N, size=(4.0, 2.0), line=0.1, seed=0.0):
    """Tri-planar panel seams: panels size[0] x size[1] metres with seams
    `line` metres wide. Returns (seam mask, per-panel random 0..1)."""
    k = min(1.0, 0.08 / max(line, 1e-4))
    x, y, z = g.sep(P)
    nx, ny, nz = (g.absolute(c) for c in g.sep(N))

    def proj(u, v, shift):
        vec = g.combine(g.add(u, shift + seed), g.add(v, shift * 0.37 + seed * 0.61), 0.0)
        n = g.node('ShaderNodeTexBrick', offset=0.5, squash=1.0, offset_frequency=2, squash_frequency=2)
        g.feed(n.inputs['Vector'], vec)
        for key, val in (('Scale', k), ('Mortar Size', line * k), ('Mortar Smooth', 0.2), ('Bias', 0.0),
                         ('Brick Width', size[0] * k), ('Row Height', size[1] * k),
                         ('Color1', (0, 0, 0)), ('Color2', (1, 1, 1)), ('Mortar', (0.5, 0.5, 0.5))):
            g.feed(n.inputs[key], val)
        cell = g.node('ShaderNodeSeparateColor', [n.outputs['Color']]).outputs[0]
        return n.outputs['Factor'], cell

    l_top, c_top = proj(y, x, 0.31)
    l_side, c_side = proj(y, z, 0.17)
    l_front, c_front = proj(x, z, 0.53)
    wz = g.mul(g.math('GREATER_THAN', nz, nx), g.math('GREATER_THAN', nz, ny))
    wx = g.mul(g.sub(1.0, wz), g.math('GREATER_THAN', nx, ny))
    wy = g.sub(g.sub(1.0, wz), wx)
    lines = g.add(g.add(g.mul(wz, l_top), g.mul(wx, l_side)), g.mul(wy, l_front))
    cell = g.add(g.add(g.mul(wz, c_top), g.mul(wx, c_side)), g.mul(wy, c_front))
    return lines, cell


def finish(g, base, rough, metal, P, N, *, size=(4.0, 2.0), line=0.08, depth=0.03, tint=0.08, patch=0.0,
           patch_col=None, ao=2.0, grime=1.0, streak=(0.6, 14.0), axis='Y', wear=1.0, edge=0.12, chips=(5.0, 0.6),
           rust=0.0, grain=0.4, glow=None, height=None, seed=0.0, lines=True, seam=None):
    """The industrial finish for big hulls (sizes in metres): panel seams
    with per-panel tint and replacement plates, AO grime, streaks along
    `axis`, rust bleeding from seams and recesses, chipped edges showing
    bare metal (patches chips[0] m across, detail chips[1] m), and a fine
    grain `grain` m across."""
    h = height if height is not None else 0.0
    if lines:
        mask, cell = seam if seam is not None else seams(g, P, N, size, line, seed)
        t = g.madd(cell, 2 * tint, 1.0 - tint)
        base = g.mix(1.0, base, g.combine(t, t, t), 'MULTIPLY')
        if patch:
            plate = g.smooth(cell, 1.0 - patch, 1.0 - patch + 0.004)
            base = g.mix(plate, base, patch_col or WHITE_B)
            rough = g.mixf(g.mul(plate, 0.5), rough, 0.6)
        base = g.mix(g.mul(mask, 0.5), base, (0.012, 0.011, 0.01))
        rough = g.mixf(g.mul(mask, 0.4), rough, 0.75)
        h = g.add(h, g.mul(mask, -depth))
    occl = g.node('ShaderNodeAmbientOcclusion', [None, ao], samples=16, only_local=False).outputs['AO']
    across, along = streak
    sc = {'X': (1 / along, 1 / across, 1 / across), 'Y': (1 / across, 1 / along, 1 / across),
          'Z': (1 / across, 1 / across, 1 / along)}[axis]
    st = g.smooth(g.noise(g.vmath('MULTIPLY', P, sc), 1.0, 4.0, 0.6), 0.52, 0.8)
    cav = g.sub(1.0, occl)
    dirt = g.minimum(g.add(g.mul(cav, 0.9), g.mul(st, 0.3)), 1.0)
    base = g.mix(g.mul(dirt, 0.65 * grime), base, (0.04, 0.034, 0.028), 'MULTIPLY')
    rough = g.mixf(g.mul(dirt, 0.4), rough, 0.7)
    if rust:
        bleed = g.mul(g.smooth(g.noise(g.vmath('MULTIPLY', P, sc), 2.3, 3.0, 0.55), 0.55, 0.75),
                      g.add(g.mul(cav, 1.4), 0.25))
        bleed = g.minimum(g.mul(bleed, rust), 1.0)
        base = g.mix(g.mul(bleed, 0.75), base, RUST_STAIN)
        rough = g.mixf(bleed, rough, 0.8)
    bev = g.node('ShaderNodeBevel', [edge], samples=8).outputs[0]
    e = g.sub(1.0, g.vmath('DOT_PRODUCT', bev, N, out=1))
    patches = g.smooth(g.noise(P, 1.0 / chips[0], 3.0, 0.5), 0.45, 0.6)
    detail = g.smooth(g.noise(P, 1.0 / chips[1], 4.0, 0.6), 0.4, 0.55)
    worn = g.mul(g.mul(g.mul(g.smooth(e, 0.02, 0.09), patches), detail), wear)
    base = g.mix(worn, base, BARE)
    rough = g.mixf(worn, rough, 0.4)
    metal = g.mixf(worn, metal, 0.65)
    h = g.add(h, g.mul(worn, -depth * 0.3))
    if grain:
        gr = g.noise(P, 1.0 / grain, 2.0, 0.5)
        base = g.mix(g.mul(g.absolute(g.sub(gr, 0.5)), 0.1), base, (0.0, 0.0, 0.0), 'MULTIPLY')
    # Rounded edges and fillets come from the Bevel normal under the bump;
    # where it disagrees wildly with the surface (thin or overlapping parts)
    # it falls back to the plain normal.
    trust = g.smooth(g.vmath('DOT_PRODUCT', bev, N, out=1), 0.35, 0.65)
    nb = g.vmath('NORMALIZE', g.mix(trust, N, bev))
    return dict(albedo=base, rough=rough, metal=metal, normal=g.bump(h, 1.0, 1.0, normal=nb), glow=glow)


def glow(name, colour, albedo=(0.06, 0.06, 0.06)):
    return S.glow_material(name, colour, albedo)


def flat(name, colour, rough=0.5, metal=0.1):
    return C.flat_material(name, colour, rough, metal)


# ==========================================================================
# Turrets

def turret(index, matrix, size, mats, parts_mat=None):
    """turret_NN (base; origin at the yaw pivot on the hull, local +Z up out
    of it) with child turret_NN_gun (origin at the trunnion, twin barrels
    along local +Y). `size` scales a ~7 m mount. Plain-factor materials."""
    s = size
    nm = f'turret_{index:02d}'
    up = Matrix.Rotation(math.radians(90), 4, 'X')          # lathe Y -> Z
    paint, dark, band_m = mats['paint'], mats['dark'], mats['band']
    parts = [
        S.transformed(S.lathe(nm + '_ring', [(-0.6 * s, 0.0), (-0.6 * s, 3.5 * s), (0.25 * s, 3.5 * s),
                                             (0.45 * s, 3.2 * s), (0.45 * s, 0.0)], 14, (0, 0), dark,
                              sharp=40), up),
        S.transformed(S.lathe(nm + '_house', [(0.4 * s, 0.0), (0.4 * s, 3.05 * s), (1.0 * s, 3.1 * s),
                                              (2.5 * s, 2.7 * s), (3.0 * s, 2.0 * s), (3.0 * s, 0.0)], 8,
                              (0, 0), paint, sharp=30, phase=math.pi / 8), up),
        S.transformed(S.lathe(nm + '_band', [(0.95 * s, 0.0), (0.95 * s, 3.14 * s), (1.35 * s, 3.1 * s),
                                             (1.35 * s, 0.0)], 8, (0, 0), band_m, sharp=30, phase=math.pi / 8),
                      up),
        S.box(nm + '_cheekL', (0.55 * s, 2.6 * s, 1.9 * s), paint, Matrix.Translation((-1.45 * s, 0.2 * s, 3.4 * s))),
        S.box(nm + '_cheekR', (0.55 * s, 2.6 * s, 1.9 * s), paint, Matrix.Translation((1.45 * s, 0.2 * s, 3.4 * s))),
        S.box(nm + '_sensor', (1.1 * s, 1.0 * s, 0.8 * s), dark, Matrix.Translation((0.0, -1.9 * s, 3.2 * s))),
    ]
    base = C.join(parts, nm)
    base.data.name = nm
    pivot = 3.5 * s
    gparts = [
        S.box(nm + '_trun', (2.3 * s, 2.5 * s, 1.5 * s), paint, Matrix.Translation((0, 0.3 * s, 0))),
        S.box(nm + '_mantlet', (2.0 * s, 0.5 * s, 1.2 * s), dark, Matrix.Translation((0, 1.7 * s, 0))),
    ]
    for side in (-1, 1):
        x = side * 0.55 * s
        gparts.append(S.lathe(nm + f'_barrel{side}', [(1.8 * s, 0.0), (1.8 * s, 0.26 * s), (8.0 * s, 0.22 * s),
                                                       (8.0 * s, 0.0)], 8, (x, 0.0), dark, sharp=40))
        gparts.append(S.lathe(nm + f'_brake{side}', [(7.4 * s, 0.0), (7.4 * s, 0.36 * s), (8.4 * s, 0.36 * s),
                                                      (8.4 * s, 0.0)], 8, (x, 0.0), paint, sharp=40))
    gun = C.join(gparts, nm + '_gun')
    gun.data.name = nm + '_gun'
    base.matrix_world = matrix
    gun.parent = base
    gun.matrix_parent_inverse = Matrix()
    gun.location = (0, 0, pivot)
    return base, gun


def turret_materials(prefix):
    return dict(paint=flat(prefix + '_turret_paint', WHITE, 0.5, 0.15),
                dark=flat(prefix + '_turret_dark', GRAPHITE, 0.42, 0.6),
                band=flat(prefix + '_turret_band', RUST, 0.5, 0.1))


# ==========================================================================
# Anchors

def anchor(name, location, direction=None, scale=None, display='ARROWS'):
    e = S.empty(name, location, direction)
    if scale is not None:
        e.scale = (scale, scale, scale)
        e.empty_display_type = display
        e.empty_display_size = 1.0
    return e


def launch(name, location, direction):
    """An empty whose local -Y points along `direction` (bays, nozzles)."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'ARROWS'
    e.location = location
    d = -Vector(direction).normalized()
    e.rotation_mode = 'QUATERNION'
    e.rotation_quaternion = d.to_track_quat('Y', 'Z' if abs(d.z) < 0.9 else 'X')
    return C.link(e)


def surface_points(objects, spacing, seed=1, extra_vertices=True):
    """Area-weighted random points on the objects' surfaces (world space)."""
    rng = np.random.default_rng(seed)
    out = []
    for o in objects:
        me = o.data
        me.calc_loop_triangles()
        mw = np.array(o.matrix_world)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
        tris = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get('vertices', tris)
        tris = tris.reshape(-1, 3)
        a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
        n = rng.poisson(area / (spacing * spacing))
        idx = np.repeat(np.arange(len(tris)), n)
        r1, r2 = rng.random(len(idx)), rng.random(len(idx))
        s = np.sqrt(r1)
        pts = a[idx] * (1 - s)[:, None] + b[idx] * (s * (1 - r2))[:, None] + c[idx] * (s * r2)[:, None]
        out.append(pts)
        if extra_vertices:
            out.append(co)
    return np.concatenate(out) if out else np.zeros((0, 3))


def fit_spheres(points, centres, pct=99.0, pad=0.0, iterations=3, move=True):
    """Spheres around hand-placed centres that together cover `points`: each
    point goes to the sphere it overshoots least, each radius is the
    `pct` percentile of its points' distances (+ pad); with `move`, the
    centres relax toward their points first (Lloyd steps)."""
    P = np.asarray(points, np.float64)
    Cn = np.asarray(centres, np.float64).copy()
    R = np.zeros(len(Cn))
    for it in range(iterations + 1):
        d = np.sqrt(((P[:, None, :] - Cn[None, :, :]) ** 2).sum(-1))
        a = (d - R[None, :]).argmin(1) if it else d.argmin(1)
        for k in range(len(Cn)):
            sel = a == k
            if sel.sum() == 0:
                continue
            if move and it < iterations:
                Cn[k] = 0.5 * Cn[k] + 0.5 * P[sel].mean(0)
            R[k] = np.percentile(d[sel, k], pct) + pad
    d = np.sqrt(((P[:, None, :] - Cn[None, :, :]) ** 2).sum(-1))
    covered = (d <= R[None, :] + 1e-6).any(1).mean()
    keep = R > 0
    return Cn[keep], R[keep], covered


def spread(points, k, seed=0):
    """Farthest-point sampling: k well-spread points."""
    P = np.asarray(points, np.float64)
    rng = np.random.default_rng(seed)
    idx = [int(rng.integers(len(P)))]
    d = np.linalg.norm(P - P[idx[0]], axis=1)
    for _ in range(k - 1):
        i = int(d.argmax())
        idx.append(i)
        d = np.minimum(d, np.linalg.norm(P - P[i], axis=1))
    return P[idx]


def cluster_spheres(points, k, pct=98.5, pad=0.5, iterations=10, seed=0):
    """k-means spheres over a point cloud (farthest-point start), each
    radius the `pct` percentile of its cluster's distances (+ pad)."""
    P = np.asarray(points, np.float64)
    Cn = spread(P, k, seed)
    for _ in range(iterations):
        a = np.linalg.norm(P[:, None, :] - Cn[None], axis=-1).argmin(1)
        for j in range(len(Cn)):
            sel = a == j
            if sel.any():
                Cn[j] = P[sel].mean(0)
    d = np.linalg.norm(P[:, None, :] - Cn[None], axis=-1)
    a = d.argmin(1)
    R = np.array([np.percentile(d[a == j, j], pct) + pad if (a == j).any() else 0.0 for j in range(len(Cn))])
    keep = R > 0
    return Cn[keep], R[keep], coverage(P, Cn[keep], R[keep])


def rock_spheres(obj, bvh, n=50, depth=35.0, pct=90.0, spacing=6.0, seed=3):
    """Colliders hugging a rock: a core sphere inscribed at the origin
    plus `n` spheres centred `depth` metres under well-spread surface
    points, each as big as the `pct` percentile of the surface points
    nearest it. A lower `pct` trades a little rock poking out between
    spheres for much less empty bulge over the surface. Returns centres,
    radii and (share of surface inside, worst poke-out in metres)."""
    pts = surface_points([obj], spacing, seed=seed)
    centres = [np.zeros(3)]
    for p in spread(pts, n, seed=seed + 2):
        loc, nrm, _, _ = bvh.find_nearest(Vector(p))
        centres.append(np.array(loc - nrm * depth))
    Cn = np.array(centres)
    d = np.linalg.norm(pts[:, None] - Cn[None], axis=-1)
    R = np.zeros(len(Cn))
    R[0] = np.linalg.norm(pts, axis=1).min() * 0.98
    a = d[:, 1:].argmin(1)
    for k in range(1, len(Cn)):
        sel = a == k - 1
        if sel.any():
            R[k] = np.percentile(d[sel, k], pct) + 0.5
    keep = R > 0
    Cn, R = Cn[keep], R[keep]
    sd = (np.linalg.norm(pts[:, None] - Cn[None], axis=-1) - R[None]).min(1)
    return Cn, R, ((sd <= 0).mean(), sd.max())


def outside(points, centres, radii, margin=0.0):
    """The points not inside any of the spheres (by more than `margin`)."""
    P = np.asarray(points)
    sd = (np.linalg.norm(P[:, None] - np.asarray(centres)[None], axis=-1) - np.asarray(radii)[None]).min(1)
    return P[sd > -margin]


def coverage(points, centres, radii):
    P = np.asarray(points)
    d = np.sqrt(((P[:, None, :] - np.asarray(centres)[None]) ** 2).sum(-1))
    return (d <= np.asarray(radii)[None] + 1e-6).any(1).mean()


def collider_empties(centres, radii, start=0):
    out = []
    for i, (c, r) in enumerate(zip(centres, radii)):
        out.append(anchor(f'col_{start + i:02d}', tuple(float(v) for v in c), scale=round(float(r), 2),
                          display='SPHERE'))
    return out


# ==========================================================================
# Baking

def unwrap(obj, margin=0.001, edge=40.0, seed=70.0, extent=None):
    """Hard-surface unwrap: charts grow across edges sharper than `edge`
    degrees only while every face stays within `seed` degrees of the
    chart's first face; chart borders become seams, each chart is unwrapped
    conformally (cylinder strips unroll, flat faces stay undistorted) and
    the islands are packed at one texel density. (Smart UV Project squashes
    some long faces to slivers here, which wrecks the packing scale.)"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    chart = [-1] * len(bm.faces)
    ce, cs = math.cos(math.radians(edge)), math.cos(math.radians(seed))
    k = 0
    for f in bm.faces:
        if chart[f.index] >= 0:
            continue
        sn = f.normal.copy()
        sc = f.calc_center_median()
        chart[f.index] = k
        stack = [f]
        while stack:
            g = stack.pop()
            for e in g.edges:
                for h in e.link_faces:
                    if chart[h.index] < 0 and h.normal.dot(g.normal) > ce and h.normal.dot(sn) > cs and \
                            (extent is None or (h.calc_center_median() - sc).length < extent):
                        chart[h.index] = k
                        stack.append(h)
        k += 1
    for e in bm.edges:
        lf = e.link_faces
        e.seam = len(lf) != 2 or chart[lf[0].index] != chart[lf[1].index]
    bm.to_mesh(obj.data)
    bm.free()
    C.activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='CONFORMAL', margin=margin)
    ts = bpy.context.scene.tool_settings
    sync = ts.use_uv_select_sync
    ts.use_uv_select_sync = True          # pack every island (no UV editor here)
    bpy.ops.mesh.select_all(action='SELECT')
    # (the exact-shape packer searches exhaustively when islands are few)
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='ANY', shape_method='CONCAVE' if k >= 100 else 'AABB',
                            margin_method='FRACTION', margin=margin)
    ts.use_uv_select_sync = sync
    bpy.ops.object.mode_set(mode='OBJECT')
    me = obj.data
    me.edges.foreach_set('use_seam', [False] * len(me.edges))
    return k


def uv_coverage(obj):
    me = obj.data
    uv = me.uv_layers.active.data
    co = np.zeros(len(uv) * 2, np.float32)
    uv.foreach_get('uv', co)
    co = co.reshape(-1, 2)
    me.calc_loop_triangles()
    tris = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('loops', tris)
    t = co[tris.reshape(-1, 3)]
    a = 0.5 * np.abs((t[:, 1, 0] - t[:, 0, 0]) * (t[:, 2, 1] - t[:, 0, 1]) -
                     (t[:, 2, 0] - t[:, 0, 0]) * (t[:, 1, 1] - t[:, 0, 1]))
    return float(a.sum())


def dump_image(img, folder):
    """Save a copy of a (baked, generated) image as PNG for inspection."""
    os.makedirs(folder, exist_ok=True)
    w, h = img.size
    out = bpy.data.images.new(img.name + '_dump', w, h, alpha=False,
                              float_buffer=img.colorspace_settings.name != 'sRGB')
    out.colorspace_settings.name = img.colorspace_settings.name
    buf = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(buf)
    out.pixels.foreach_set(buf)
    out.filepath_raw = os.path.join(folder, img.name + '.png')
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)


def soften(img, a=1 / 6):
    """A light separable [a, 1 - 2a, a] blur: takes the bake's sampling
    noise out of a map (which also keeps the WebP small) without visibly
    softening detail."""
    px = C.pixels(img)
    out = px * (1 - 2 * a)
    out[:, 1:] += px[:, :-1] * a
    out[:, :-1] += px[:, 1:] * a
    out[:, 0] += px[:, 0] * a
    out[:, -1] += px[:, -1] * a
    px = out
    out = px * (1 - 2 * a)
    out[1:] += px[:-1] * a
    out[:-1] += px[1:] * a
    out[0] += px[0] * a
    out[-1] += px[-1] * a
    C.set_pixels(img, out)


def _rm_channel(objects):
    """Register a combined (roughness, metallic) channel on every source
    material so both bake in one pass."""
    seen = set()
    for o in objects:
        for slot in o.material_slots:
            mat = slot.material
            if mat is None or mat.name in seen or mat.name not in C.CHANNELS:
                continue
            seen.add(mat.name)
            ch = C.CHANNELS[mat.name]
            comb = mat.node_tree.nodes.new('ShaderNodeCombineXYZ')
            for i, key in enumerate(('rough', 'metal')):
                val = C._channel_value(ch, key)
                if isinstance(val, bpy.types.NodeSocket):
                    mat.node_tree.links.new(val, comb.inputs[i])
                else:
                    comb.inputs[i].default_value = float(val if not hasattr(val, '__len__') else val[0])
            ch['rm'] = comb.outputs[0]


def _normal_only(objects):
    """Route each source material's output through a bare Diffuse BSDF
    carrying only its normal, so the normal bake skips the paint (AO and
    all). Returns a function that restores the materials."""
    undo, seen = [], set()
    for o in objects:
        for slot in o.material_slots:
            mat = slot.material
            if mat is None or mat.name in seen:
                continue
            seen.add(mat.name)
            nt = mat.node_tree
            out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
            old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
            dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
            normal = C.CHANNELS.get(mat.name, {}).get('normal')
            if isinstance(normal, bpy.types.NodeSocket):
                nt.links.new(normal, dif.inputs['Normal'])
            nt.links.new(dif.outputs[0], out.inputs['Surface'])
            undo.append((nt, out, old, dif))

    def restore():
        for nt, out, old, dif in undo:
            nt.nodes.remove(dif)
            if old is not None:
                nt.links.new(old, out.inputs['Surface'])
    return restore


def cull_faces(obj, inside):
    """Delete faces whose every vertex `inside(co)` reports as buried
    (inside rock or another solid): they can never be seen and would only
    take atlas space and bytes."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    flags = {v.index: inside(v.co) for v in bm.verts}
    dead = [f for f in bm.faces if all(flags[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(dead)


def bake_set(name, parts, tex, margin=0.001, samples=None, glow=True, smooth=True, inside=None, location=None,
             extent=None, repeat=None):
    """Join `parts` into one mesh called `name`, unwrap and triangulate it,
    then bake its procedural paint from the mesh itself: the shading normal
    (the paint's Bevel-rounded edges and bumped seams), base colour,
    roughness and metallic (one pass) and emission. tex = (base and normal
    size, MR and emissive size)."""
    t0 = time.time()
    obj = C.join(parts, name)
    if location is not None:          # paint is in object space; AO sees the final placement
        obj.location = location
        bpy.context.view_layer.update()
    if inside is not None:
        C.log(f'  {name}: culled {cull_faces(obj, inside)} buried faces')
    charts = unwrap(obj, margin=margin, extent=extent)
    C.triangulate(obj)
    obj.data.set_sharp_from_angle(angle=math.radians(40))
    copies = []
    if repeat:
        # `repeat` rotated copies about the local Y axis share the baked
        # sector's UVs; they stand in the scene during the bake (AO).
        for k in range(1, repeat):
            c = C.duplicate(obj, f'{name}_copy{k}')
            c.data.transform(Matrix.Rotation(2 * math.pi * k / repeat, 4, 'Y'))
            c.data.update()
            copies.append(c)
    big, small = (256, 128) if FAST else tex
    area = sum(p.area for p in obj.data.polygons)
    cov = uv_coverage(obj)
    C.log(f'  {name}: {len(obj.data.polygons)} tris, {charts} charts, UV coverage {cov * 100:.0f} %, '
          f'{big * math.sqrt(cov / max(area, 1)):.1f} px/m ({time.time() - t0:.0f} s)')
    base = C.new_image(name + '_base', big)
    nrm = C.new_image(name + '_normal', big, non_color=True)
    rm = C.new_image(name + '_rm', small, non_color=True)
    emit = C.new_image(name + '_emissive', small) if glow else None
    _rm_channel([obj])
    px = max(2, big // 512)
    s_n, s_a, s_r = samples or ((1, 1, 1) if FAST else (4, 6, 3))
    t = time.time()
    restore = _normal_only([obj])
    C.bake(obj, nrm, 'NORMAL', margin=px, samples=s_n)
    restore()
    C.log(f'    normal {time.time() - t:.0f} s')
    t = time.time()
    C.bake(obj, base, channel='albedo', margin=px, samples=s_a)
    C.log(f'    albedo {time.time() - t:.0f} s')
    sm = max(1, px * small // big)
    t = time.time()
    C.bake(obj, rm, channel='rm', margin=sm, samples=s_r)
    if emit is not None:
        C.bake(obj, emit, channel='glow', margin=sm, samples=1)
    C.log(f'    rough/metal/glow {time.time() - t:.0f} s')
    if smooth and not FAST:
        for img in (base, nrm, rm):
            soften(img)
    rmp = C.pixels(rm)
    mr = C.new_image(name + '_mr', small, non_color=True)
    out = np.ones_like(rmp)
    out[..., 1] = rmp[..., 0]
    out[..., 2] = rmp[..., 1]
    C.set_pixels(mr, out)
    dump = os.environ.get('METEORA_DUMP')
    if dump:
        for img in (base, nrm, mr) + ((emit,) if emit is not None else ()):
            dump_image(img, dump)
    mat = C.baked_material(name, base, nrm, mr, emit)
    for o in [obj] + copies:
        o.data.materials.clear()
        o.data.materials.append(mat)
        o.data.polygons.foreach_set('material_index', [0] * len(o.data.polygons))
    if copies:
        obj = C.join([obj] + copies, name)
    for key in [a.name for a in obj.data.attributes if a.domain == 'FACE' and a.data_type == 'FLOAT'
                and not a.name.startswith('.')]:
        obj.data.attributes.remove(obj.data.attributes[key])
    C.log(f'  {name} baked in {time.time() - t0:.0f} s')
    return obj


def attach_windows(hull, windows):
    """Join the window panels into the baked hull as a second material."""
    if windows is None or not len(windows.data.polygons):
        return hull
    C.triangulate(windows)
    joined = C.join([hull, windows], hull.name)
    return joined


# ==========================================================================
# Anchors module

def gl(v, nd=2):
    return [round(c, nd) + 0.0 for c in C.to_gltf(v)]


def mesh_extent(objects):
    radius, ymin, ymax = 0.0, 1e9, -1e9
    for o in objects:
        mw = o.matrix_world
        co = np.empty(len(o.data.vertices) * 3, np.float32)
        o.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) @ np.array(mw)[:3, :3].T + np.array(mw)[:3, 3]
        if len(co):
            radius = max(radius, float(np.linalg.norm(co, axis=1).max()))
            ymin, ymax = min(ymin, float(co[:, 1].min())), max(ymax, float(co[:, 1].max()))
    return radius, ymax - ymin


def anchors_data(meshes, empties, turrets, lights, nozzle_sizes, turret_size, nodes):
    bpy.context.view_layer.update()
    radius, length = mesh_extent(meshes)
    by = lambda prefix: sorted((e for e in empties if e.name.startswith(prefix)), key=lambda e: e.name)
    pos = lambda e: gl(e.matrix_world.translation)
    axis = lambda e, v: [round(c, 4) + 0.0 for c in C.to_gltf((e.matrix_world.to_3x3() @ Vector(v)).normalized())]
    one = lambda n: next((e for e in empties if e.name == n), None)
    data = dict(radius=round(radius, 2), length=round(length, 2))
    data['nozzles'] = [dict(name=e.name, pos=pos(e), dir=axis(e, (0, -1, 0)), size=nozzle_sizes[e.name])
                       for e in by('nozzle_')]
    data['muzzles'] = [dict(name=e.name, pos=pos(e)) for e in by('muzzle_')]
    data['rcs'] = [dict(name=e.name, pos=pos(e), dir=axis(e, (0, 0, 1))) for e in by('rcs_')]
    data['launchers'] = [dict(name=e.name, pos=pos(e)) for e in by('launcher_')]
    data['cockpit'] = pos(one('cam_cockpit')) if one('cam_cockpit') else None
    data['dock'] = pos(one('dock')) if one('dock') else None
    data['colliders'] = [dict(pos=pos(e), r=round(e.matrix_world.to_scale().x, 2)) for e in by('col_')]
    subs = []
    for e in by('sub_'):
        parts = e.name.split('_')
        kind = parts[1]
        subs.append(dict(name=e.name, kind=kind, pos=pos(e), r=round(e.matrix_world.to_scale().x, 2)))
    data['subsystems'] = subs
    data['turrets'] = [dict(name=b.name, pos=gl(b.matrix_world.translation), up=axis(b, (0, 0, 1)),
                            fwd=axis(b, (0, 1, 0)), size=turret_size) for b, _ in sorted(turrets, key=lambda t: t[0].name)]
    data['bays'] = [dict(name=e.name, pos=pos(e), dir=axis(e, (0, -1, 0))) for e in by('bay_')]
    data['lights'] = [dict(name=e.name, pos=pos(e), color=list(lights[e.name][0]), blink=lights[e.name][1])
                      for e in sorted((e for e in empties if e.name.startswith('light_')),
                                      key=lambda e: int(e.name.split('_')[1]))]
    data['nodes'] = nodes
    return data


def _v(x):
    return '[' + ', '.join(f'{c:g}' for c in x) + ']'


def write_anchors(name, data, group='civil'):
    L = [f'/* Meteora — {name} anchors. GENERATED by tools/blender/build_{group}.py from',
         f'   the empties in {name}.glb; do not edit by hand. glTF space, metres: nose',
         '   along -Z, top +Y, right +X. */',
         'export default {',
         f"  radius: {data['radius']:g},",
         f"  length: {data['length']:g},"]

    def items(key, fmt):
        rows = data[key]
        if not rows:
            L.append(f'  {key}: [],')
            return
        L.append(f'  {key}: [')
        L.extend('    ' + fmt(r) + ',' for r in rows)
        L.append('  ],')

    items('nozzles', lambda n: f"{{ name: '{n['name']}', pos: {_v(n['pos'])}, dir: {_v(n['dir'])}, size: {n['size']:g} }}")
    items('muzzles', lambda n: f"{{ name: '{n['name']}', pos: {_v(n['pos'])} }}")
    items('rcs', lambda n: f"{{ name: '{n['name']}', pos: {_v(n['pos'])}, dir: {_v(n['dir'])} }}")
    items('launchers', lambda n: f"{{ name: '{n['name']}', pos: {_v(n['pos'])} }}")
    L.append(f"  cockpit: {_v(data['cockpit']) if data['cockpit'] else 'null'},")
    L.append(f"  dock: {_v(data['dock']) if data['dock'] else 'null'},")
    items('colliders', lambda c: f"{{ pos: {_v(c['pos'])}, r: {c['r']:g} }}")
    items('subsystems', lambda s: f"{{ name: '{s['name']}', kind: '{s['kind']}', pos: {_v(s['pos'])}, r: {s['r']:g} }}")
    items('turrets', lambda t: f"{{ name: '{t['name']}', pos: {_v(t['pos'])}, up: {_v(t['up'])}, "
                               f"fwd: {_v(t['fwd'])}, size: {t['size']:g} }}")
    items('bays', lambda b: f"{{ name: '{b['name']}', pos: {_v(b['pos'])}, dir: {_v(b['dir'])} }}")
    items('lights', lambda l: f"{{ name: '{l['name']}', pos: {_v(l['pos'])}, color: {_v(l['color'])}, "
                              f"blink: {l['blink']:g} }}")
    nodes = data['nodes']
    L.append('  nodes: {' + (' ' + ', '.join(f"{k}: '{v}'" for k, v in nodes.items()) + ' ' if nodes else '') + '},')
    L.append('};')
    path = os.path.join(C.JS, 'anchors', name + '.js')
    with open(path, 'w') as f:
        f.write('\n'.join(L) + '\n')
    C.log('wrote', os.path.relpath(path, C.ROOT))
