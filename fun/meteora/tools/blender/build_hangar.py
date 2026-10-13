"""Meteora — the hangar bay, where the hangar screen shows your ship.

A flight deck in the Perpetua: eighty metres of plated floor between
ribbed walls, catwalks along both sides with light strips under them,
girders and light panels overhead, a gantry crane over the turntable pad
where the ship sits, crates, fuel and a rack of torpedoes by the walls,
and at the far end the launch door, open on a lit tube and the stars.

A room this size cannot wear one baked texture without going soft, so
its surfaces wear small tiling textures — deck plates, wall panels, crate
sides, hazard stripes — baked from procedural materials on a swatch and
laid on in world units (`world_uv`), so a plate is two metres wherever it
is. The pad has a texture of its own: radial plates, the Watch's star and
a ring of lights. The lights themselves are emissive: the game lights the
bay (js/hangar.js) and the bloom makes them glow.

Nodes: `bay` (everything fixed) and `turntable` (the pad, which turns with
the ship). Blender is Z-up; the export turns it Y-up, so the launch door at
Blender +Y is the game's −Z, ahead of the camera.

Run through build_all.py, or alone:
  Blender --background --factory-startup --python build_hangar.py
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

sys.dont_write_bytecode = True        # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

# The room, in metres (Blender axes: x across, y toward the door, z up).
HALF_W, BACK, FRONT, HIGH = 40.0, 50.0, -66.0, 24.0
DOOR_W, DOOR_H = 18.0, 16.0
TUBE = 26.0                     # how far the launch tube runs past the door
BAY = 8.0                       # pillar and girder spacing
CATWALK_Z, CATWALK_W = 9.0, 3.0
PAD_R = 9.0


# --------------------------------------------------------------------------
# Tiling textures, baked on a swatch

def swatch_object():
    bm = bmesh.new()
    verts = [bm.verts.new(v) for v in ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0))]
    face = bm.faces.new(verts)
    uv = bm.loops.layers.uv.new('UVMap')
    for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coord
    return C.object_from_bmesh('swatch', bm, smooth=False)


def bake_swatch(name, size, build, glow=False):
    """Bake `build(g)` (a source-material recipe working in UV 0..1) into a
    tiling texture set and return the glTF material wearing it."""
    swatch = swatch_object()
    src = C.source_material(f'{name}_src', build)
    swatch.data.materials.append(src)
    base = C.new_image(f'{name}_base', size)
    rough = C.new_image(f'{name}_rough', size, non_color=True)
    metal = C.new_image(f'{name}_metal', size, non_color=True)
    normal = C.new_image(f'{name}_normal', size, non_color=True)
    C.bake(swatch, base, channel='albedo', margin=0)
    C.bake(swatch, rough, channel='rough', margin=0)
    C.bake(swatch, metal, channel='metal', margin=0)
    C.bake(swatch, normal, kind='NORMAL', margin=0)
    emissive = None
    if glow:
        emissive = C.new_image(f'{name}_glow', size)
        C.bake(swatch, emissive, channel='glow', margin=0)
    mr = C.pack_mr(f'{name}_mr', rough, metal)
    mat = C.baked_material(name, base, normal, mr, emissive)
    bpy.data.objects.remove(swatch)
    return mat


def metres(g, size):
    """The swatch's coordinates in metres, for a tile `size` metres across."""
    u, v, _ = g.sep(g.coord('UV'))
    return g.mul(u, size), g.mul(v, size)


def seam_distance(g, t, cell):
    """Metres from `t` to the nearest multiple of `cell`."""
    f = g.math('FRACT', g.mul(t, 1.0 / cell))
    return g.mul(g.minimum(f, g.sub(1.0, f)), cell)


def deck(g):
    # An eight-metre tile of two-metre plates: grooved seams, a bolt in each
    # corner, every other plate a shade apart, scuffs where traffic runs.
    x, y = metres(g, 8.0)
    d = g.minimum(seam_distance(g, x, 2.0), seam_distance(g, y, 2.0))
    groove = g.sub(1.0, g.smooth(d, 0.010, 0.028))
    bx = g.sub(seam_distance(g, x, 2.0), 0.16)
    by = g.sub(seam_distance(g, y, 2.0), 0.16)
    bolt = g.sub(1.0, g.smooth(g.vmath('LENGTH', g.combine(bx, by, 0.0), out=1), 0.022, 0.034))
    ix, iy = g.math('FLOOR', g.mul(x, 0.5)), g.math('FLOOR', g.mul(y, 0.5))
    checker = g.math('MODULO', g.add(ix, iy), 2.0)
    pos = g.combine(x, y, 0.0)
    grime = g.noise(pos, 0.45, detail=6, rough=0.62)
    scuff = g.noise(g.combine(g.mul(x, 0.12), g.mul(y, 2.4), 0.0), 1.3, detail=5, rough=0.7)
    fine = g.noise(pos, 22.0, detail=3)
    tone = g.add(g.mul(checker, 0.025), g.mul(g.sub(grime, 0.5), 0.05))
    base = g.mix(g.smooth(scuff, 0.55, 0.75), (0.105, 0.112, 0.125), (0.16, 0.165, 0.17))
    albedo = g.mix(g.add(tone, 0.5), (0.0, 0.0, 0.0), base, blend='ADD')
    albedo = g.mix(groove, albedo, (0.03, 0.032, 0.036))
    albedo = g.mix(bolt, albedo, (0.32, 0.33, 0.34))
    rough = g.add(0.48, g.add(g.mul(grime, 0.22), g.mul(g.smooth(scuff, 0.55, 0.75), -0.12)))
    height = g.add(g.mul(groove, -1.0), g.add(g.mul(bolt, 0.6), g.mul(fine, 0.04)))
    return dict(albedo=albedo, rough=rough, metal=0.72, normal=g.bump(height, 0.6, 0.02))


def wall(g):
    # Panels 2 m wide and 1.6 m tall in an 8 m tile, some with vent slats,
    # each a shade of its own.
    x, y = metres(g, 8.0)
    d = g.minimum(seam_distance(g, x, 2.0), seam_distance(g, y, 1.6))
    seam = g.sub(1.0, g.smooth(d, 0.012, 0.03))
    ix, iy = g.math('FLOOR', g.mul(x, 0.5)), g.math('FLOOR', g.mul(y, 1 / 1.6))
    pick = g.math('MODULO', g.add(ix, g.mul(iy, 3.0)), 4.0)
    vent_panel = g.sub(1.0, g.smooth(g.absolute(g.sub(pick, 1.0)), 0.2, 0.4))
    lx = g.math('FRACT', g.mul(x, 0.5))
    ly = g.math('FRACT', g.mul(y, 1 / 1.6))
    inside = g.mul(g.mul(g.smooth(lx, 0.18, 0.2), g.sub(1.0, g.smooth(lx, 0.8, 0.82))),
                   g.mul(g.smooth(ly, 0.25, 0.27), g.sub(1.0, g.smooth(ly, 0.73, 0.75))))
    slat = g.smooth(g.math('FRACT', g.mul(y, 7.5)), 0.45, 0.55)
    vent = g.mul(g.mul(vent_panel, inside), slat)
    shade = g.mul(g.math('MODULO', g.add(g.mul(ix, 7.0), g.mul(iy, 13.0)), 5.0), 0.012)
    pos = g.combine(x, y, 0.0)
    grime = g.noise(pos, 0.6, detail=5, rough=0.6)
    streak = g.noise(g.combine(g.mul(x, 3.0), g.mul(y, 0.15), 0.0), 1.0, detail=4)
    base = g.mix(g.smooth(streak, 0.5, 0.8), (0.2, 0.215, 0.235), (0.15, 0.16, 0.175))
    albedo = g.mix(g.add(0.5, shade), (0.0, 0.0, 0.0), base, blend='ADD')
    albedo = g.mix(g.mul(g.sub(grime, 0.45), 0.6), albedo, (0.1, 0.1, 0.11))
    albedo = g.mix(seam, albedo, (0.035, 0.038, 0.042))
    albedo = g.mix(vent, albedo, (0.04, 0.045, 0.05))
    rough = g.add(0.42, g.mul(grime, 0.25))
    height = g.add(g.mul(seam, -1.0), g.mul(vent, -0.6))
    return dict(albedo=albedo, rough=rough, metal=0.6, normal=g.bump(height, 0.5, 0.02))


def hazard(g):
    # Yellow and black at forty-five degrees, a metre a tile, worn.
    x, y = metres(g, 1.0)
    s = g.math('FRACT', g.mul(g.add(x, y), 2.0))
    band = g.mul(g.smooth(s, 0.03, 0.05), g.sub(1.0, g.smooth(s, 0.48, 0.5)))
    pos = g.combine(x, y, 0.0)
    wear = g.smooth(g.noise(pos, 3.0, detail=6, rough=0.7), 0.58, 0.7)
    paint = g.mix(band, (0.035, 0.035, 0.035), (0.78, 0.55, 0.06))
    albedo = g.mix(wear, paint, (0.16, 0.16, 0.17))
    rough = g.add(0.55, g.mul(wear, 0.15))
    return dict(albedo=albedo, rough=rough, metal=g.mul(wear, 0.6), normal=g.bump(g.mul(wear, -0.4), 0.3, 0.01))


def crate(g):
    # A crate's side, two metres: a frame, a brace across, olive paint
    # chipped at the edges.
    x, y = metres(g, 2.0)
    edge = g.minimum(seam_distance(g, x, 2.0), seam_distance(g, y, 2.0))
    frame = g.sub(1.0, g.smooth(edge, 0.13, 0.15))
    brace = g.sub(1.0, g.smooth(g.absolute(g.sub(x, y)), 0.09, 0.11))
    pos = g.combine(x, y, 0.0)
    chip = g.smooth(g.noise(pos, 6.0, detail=5, rough=0.7), 0.62, 0.68)
    wear = g.mul(chip, g.add(frame, 0.25))
    paint = g.mix(g.maximum(frame, brace), (0.17, 0.19, 0.13), (0.13, 0.145, 0.1))
    albedo = g.mix(wear, paint, (0.3, 0.3, 0.31))
    rough = g.sub(0.72, g.mul(wear, 0.3))
    height = g.add(g.mul(g.maximum(frame, brace), 0.8), g.mul(chip, -0.1))
    return dict(albedo=albedo, rough=rough, metal=g.mul(wear, 0.8), normal=g.bump(height, 0.5, 0.02))


def pad(g):
    # The turntable's top, 18.4 m across: plates in rings and sectors, the
    # Watch's four-pointed star in the middle, a lit ring at the rim and a
    # dozen lamps inside it.
    u, v, _ = g.sep(g.coord('UV'))
    x, y = g.mul(g.sub(u, 0.5), 2 * (PAD_R + 0.2)), g.mul(g.sub(v, 0.5), 2 * (PAD_R + 0.2))
    r = g.vmath('LENGTH', g.combine(x, y, 0.0), out=1)
    a = g.math('ARCTAN2', y, x)
    sector = g.mul(seam_distance(g, g.mul(a, 12 / (2 * math.pi)), 1.0), g.mul(r, 2 * math.pi / 12))
    rings = g.minimum(g.minimum(g.absolute(g.sub(r, 2.6)), g.absolute(g.sub(r, 5.4))), g.absolute(g.sub(r, 7.6)))
    seam = g.mul(g.sub(1.0, g.smooth(g.minimum(sector, rings), 0.012, 0.03)), g.smooth(r, 2.5, 2.6))
    star = g.mul(1.9, g.add(0.18, g.mul(0.82, g.power(g.absolute(g.math('COSINE', g.mul(a, 2.0))), 6.0))))
    emblem = g.sub(1.0, g.smooth(g.sub(r, star), -0.02, 0.02))
    disc = g.sub(1.0, g.smooth(r, 2.35, 2.4))
    ring = g.mul(g.smooth(r, 8.5, 8.55), g.sub(1.0, g.smooth(r, 8.85, 8.9)))
    lamp_a = g.mul(seam_distance(g, g.add(g.mul(a, 12 / (2 * math.pi)), 0.5), 1.0), g.mul(r, 2 * math.pi / 12))
    lamp = g.sub(1.0, g.smooth(g.vmath('LENGTH', g.combine(lamp_a, g.sub(r, 8.1), 0.0), out=1), 0.11, 0.14))
    pos = g.combine(x, y, 0.0)
    grime = g.noise(pos, 0.8, detail=5, rough=0.6)
    wear = g.smooth(g.noise(pos, 4.0, detail=6, rough=0.7), 0.6, 0.7)
    base = g.mix(g.mul(grime, 0.5), (0.13, 0.14, 0.155), (0.08, 0.085, 0.095))
    paint = g.mix(wear, (0.72, 0.33, 0.1), (0.2, 0.17, 0.15))
    albedo = g.mix(g.mul(emblem, g.sub(1.0, disc)), base, paint)
    albedo = g.mix(g.mul(disc, g.sub(1.0, emblem)), albedo, (0.06, 0.065, 0.07))
    albedo = g.mix(seam, albedo, (0.025, 0.027, 0.03))
    albedo = g.mix(g.maximum(ring, lamp), albedo, (0.08, 0.08, 0.08))
    glow = g.add(g.mix(ring, (0, 0, 0), (0.25, 0.75, 1.0)), g.mix(lamp, (0, 0, 0), (1.0, 0.62, 0.25)))
    rough = g.add(0.45, g.mul(grime, 0.2))
    height = g.add(g.mul(seam, -1.0), g.add(g.mul(disc, 0.5), g.mul(emblem, 0.15)))
    return dict(albedo=albedo, rough=rough, metal=0.7, glow=glow, normal=g.bump(height, 0.5, 0.02))


# --------------------------------------------------------------------------
# Geometry

class Builder:
    """Faces and boxes into one bmesh per material, with world-unit UVs."""

    def __init__(self):
        self.meshes = {}

    def bm(self, mat):
        if mat not in self.meshes:
            bm = bmesh.new()
            bm.loops.layers.uv.new('UVMap')
            self.meshes[mat] = bm
        return self.meshes[mat]

    def quad(self, mat, corners, tile, uv=None, face=None):
        """A face; `face` is the way it should look (its corners are turned
        round if they wind the other way)."""
        if face is not None and face_normal(corners).dot(Vector(face)) < 0:
            corners = corners[::-1]
        bm = self.bm(mat)
        layer = bm.loops.layers.uv.active
        face = bm.faces.new([bm.verts.new(c) for c in corners])
        for loop, corner in zip(face.loops, corners):
            loop[layer].uv = uv(Vector(corner)) if uv else world_uv(Vector(corner), face_normal(corners), tile)
        return face

    def box(self, mat, lo, hi, tile, skip=()):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        faces = {
            '-x': [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
            '+x': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            '+y': [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
            '-z': [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
            '+z': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
        }
        for key, corners in faces.items():
            if key not in skip:
                self.quad(mat, corners, tile)

    def cylinder(self, mat, centre, radius, length, axis, tile, segments=20):
        """A closed cylinder along 'x' or 'y' (lying down) or 'z' (standing)."""
        c = Vector(centre)
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments
            p, q = radius * math.cos(a), radius * math.sin(a)
            if axis == 'x':
                ring.append(((-length / 2, p, q), (length / 2, p, q)))
            elif axis == 'y':
                ring.append(((p, -length / 2, q), (p, length / 2, q)))
            else:
                ring.append(((p, q, -length / 2), (p, q, length / 2)))
        along = Vector({'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis])
        for k in range(segments):
            (a0, a1), (b0, b1) = ring[k], ring[(k + 1) % segments]
            mid = (Vector(a0) + Vector(b0)) / 2
            out = mid - along * mid.dot(along)
            self.quad(mat, [tuple(c + Vector(v)) for v in (a0, b0, b1, a1)], tile, face=out)
        for end in (0, 1):
            self.quad(mat, [tuple(c + Vector(r[end])) for r in ring], tile, face=along * (1 if end else -1))

    def objects(self, name):
        out = []
        for mat, bm in self.meshes.items():
            # Every face already looks the way it should: into the room for
            # the room, out of the solid for the rest.
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            obj = C.object_from_bmesh(f'{name}_{mat.name}', bm, smooth=False)
            obj.data.materials.append(mat)
            out.append(obj)
        return out


def face_normal(corners):
    a, b, c = (Vector(p) for p in corners[:3])
    return (b - a).cross(c - a).normalized()


def world_uv(p, n, tile):
    """Box projection in metres: a tile of `tile` metres on every surface."""
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    if az >= ax and az >= ay:
        return (p.x / tile, p.y / tile)
    if ax >= ay:
        return (p.y / tile, p.z / tile)
    return (p.x / tile, p.z / tile)


def build_bay(m):
    b = Builder()
    W, B, F, H = HALF_W, BACK, FRONT, HIGH
    # Floor, ceiling, the side walls and the wall behind the camera, all
    # facing into the room.
    b.quad(m['deck'], [(-W, F, 0), (W, F, 0), (W, B, 0), (-W, B, 0)], 8.0, face=(0, 0, 1))
    b.quad(m['wall'], [(-W, B, H), (W, B, H), (W, F, H), (-W, F, H)], 8.0, face=(0, 0, -1))
    b.quad(m['wall'], [(-W, B, 0), (-W, F, 0), (-W, F, H), (-W, B, H)], 8.0, face=(1, 0, 0))
    b.quad(m['wall'], [(W, F, 0), (W, B, 0), (W, B, H), (W, F, H)], 8.0, face=(-1, 0, 0))
    b.quad(m['wall'], [(W, F, 0), (-W, F, 0), (-W, F, H), (W, F, H)], 8.0, face=(0, 1, 0))
    # The far wall, round the launch door.
    b.quad(m['wall'], [(-W, B, 0), (-DOOR_W, B, 0), (-DOOR_W, B, H), (-W, B, H)], 8.0, face=(0, -1, 0))
    b.quad(m['wall'], [(DOOR_W, B, 0), (W, B, 0), (W, B, H), (DOOR_W, B, H)], 8.0, face=(0, -1, 0))
    b.quad(m['wall'], [(-DOOR_W, B, DOOR_H), (DOOR_W, B, DOOR_H), (DOOR_W, B, H), (-DOOR_W, B, H)], 8.0, face=(0, -1, 0))
    # The door's frame, striped.
    b.box(m['hazard'], (-DOOR_W - 1.6, B - 1.2, 0), (-DOOR_W, B + 0.4, DOOR_H + 1.6), 1.0)
    b.box(m['hazard'], (DOOR_W, B - 1.2, 0), (DOOR_W + 1.6, B + 0.4, DOOR_H + 1.6), 1.0)
    b.box(m['hazard'], (-DOOR_W - 1.6, B - 1.2, DOOR_H), (DOOR_W + 1.6, B + 0.4, DOOR_H + 1.6), 1.0)
    # The launch tube beyond, open at its end on the stars.
    T = B + TUBE
    b.quad(m['deck'], [(-DOOR_W, B, 0), (DOOR_W, B, 0), (DOOR_W, T, 0), (-DOOR_W, T, 0)], 8.0, face=(0, 0, 1))
    b.quad(m['wall'], [(-DOOR_W, T, 0), (-DOOR_W, B, 0), (-DOOR_W, B, DOOR_H), (-DOOR_W, T, DOOR_H)], 8.0, face=(1, 0, 0))
    b.quad(m['wall'], [(DOOR_W, B, 0), (DOOR_W, T, 0), (DOOR_W, T, DOOR_H), (DOOR_W, B, DOOR_H)], 8.0, face=(-1, 0, 0))
    b.quad(m['wall'], [(-DOOR_W, T, DOOR_H), (DOOR_W, T, DOOR_H), (DOOR_W, B, DOOR_H), (-DOOR_W, B, DOOR_H)], 8.0, face=(0, 0, -1))
    for k in range(int(TUBE // 4) + 1):
        y = B + 2 + 4 * k
        for x in (-DOOR_W + 1.2, DOOR_W - 1.2):
            b.box(m['amber'], (x - 0.25, y - 0.25, 0), (x + 0.25, y + 0.25, 0.06), 1.0)
        for x in (-DOOR_W + 0.05, DOOR_W - 0.1):
            b.box(m['strip'], (x, y - 1.2, DOOR_H - 0.6), (x + 0.05, y + 1.2, DOOR_H - 0.45), 1.0)
    # Pillars, a girder overhead at each, and the light panels between.
    ys = [F + BAY * k for k in range(int((B - F) / BAY) + 1)]
    for y in ys[1:-1]:
        for s in (-1, 1):
            x0 = s * W
            b.box(m['trim'], (min(x0, x0 - s * 1.4), y - 0.6, 0), (max(x0, x0 - s * 1.4), y + 0.6, H), 4.0)
        b.box(m['trim'], (-W, y - 0.6, H - 1.6), (W, y + 0.6, H), 4.0, skip=('+z',))
    for y0, y1 in zip(ys, ys[1:]):
        yc = (y0 + y1) / 2
        for x in (-20.0, 0.0, 20.0):
            b.box(m['panel'], (x - 4.5, yc - 0.8, H - 0.5), (x + 4.5, yc + 0.8, H - 0.35), 1.0)
    # Catwalks along both walls, light strips under their edges and up high.
    for s in (-1, 1):
        x0, x1 = s * W, s * (W - CATWALK_W)
        lo, hi = min(x0, x1), max(x0, x1)
        b.box(m['trim'], (lo, F, CATWALK_Z - 0.3), (hi, B, CATWALK_Z), 4.0)
        b.box(m['strip'], (x1 - 0.06 if s > 0 else x1, F, CATWALK_Z - 0.42), (x1 if s > 0 else x1 + 0.06, B, CATWALK_Z - 0.3), 1.0)
        rail = x1 + s * 0.12
        b.box(m['trim'], (min(rail, rail - s * 0.08), F, CATWALK_Z + 1.05), (max(rail, rail - s * 0.08), B, CATWALK_Z + 1.15), 4.0)
        for k in range(int((B - F) / 2.5) + 1):
            y = F + 2.5 * k
            b.box(m['trim'], (min(rail, rail - s * 0.08), y - 0.04, CATWALK_Z), (max(rail, rail - s * 0.08), y + 0.04, CATWALK_Z + 1.1), 4.0)
        xs = s * (W - 0.05)
        b.box(m['strip'], (min(xs, xs - s * 0.05), F, 19.4), (max(xs, xs - s * 0.05), B, 19.55), 1.0)
    # The gantry: two rails across the bay and a crane on them over the pad.
    for y in (-7.0, 7.0):
        b.box(m['trim'], (-W, y - 0.5, 18.6), (W, y + 0.5, 19.6), 4.0)
    b.box(m['trim'], (-3.0, -7.6, 17.6), (3.0, 7.6, 18.6), 4.0)
    b.box(m['hazard'], (-3.02, -7.62, 17.4), (3.02, 7.62, 17.6), 1.0)
    b.box(m['trim'], (-0.6, -0.6, 13.5), (0.6, 0.6, 17.6), 4.0)
    b.box(m['strip'], (-2.2, -0.15, 17.3), (2.2, 0.15, 17.4), 1.0)
    # Hazard stripes round the pad and along the taxi lane to the door,
    # with lamps down its middle.
    ring_uv = lambda p: (math.atan2(p.y, p.x) * (PAD_R + 1) / 1.0, math.hypot(p.x, p.y))
    for k in range(64):
        a0, a1 = 2 * math.pi * k / 64, 2 * math.pi * (k + 1) / 64
        r0, r1 = PAD_R + 0.4, PAD_R + 1.4
        corners = [(r0 * math.cos(a0), r0 * math.sin(a0), 0.012), (r1 * math.cos(a0), r1 * math.sin(a0), 0.012),
                   (r1 * math.cos(a1), r1 * math.sin(a1), 0.012), (r0 * math.cos(a1), r0 * math.sin(a1), 0.012)]
        b.quad(m['hazard'], corners, 1.0, face=(0, 0, 1), uv=lambda p, k=k: ((k + (math.atan2(p.y, p.x) % (2 * math.pi) - 2 * math.pi * k / 64) / (2 * math.pi / 64)) * 1.0, math.hypot(p.x, p.y) - PAD_R))
    for x in (-7.0, 7.0):
        b.quad(m['hazard'], [(x - 0.35, PAD_R + 3, 0.012), (x + 0.35, PAD_R + 3, 0.012), (x + 0.35, B, 0.012), (x - 0.35, B, 0.012)], 1.0, face=(0, 0, 1))
    for k in range(int((B - PAD_R - 4) // 3)):
        y = PAD_R + 4 + 3 * k
        b.box(m['amber'], (-0.18, y - 0.18, 0), (0.18, y + 0.18, 0.05), 1.0)
    # By the walls: crates, fuel on a cart, a rack of torpedoes, a console.
    for (x, y, stack) in ((-35.0, 30.0, 3), (-31.5, 31.0, 2), (-35.0, 34.0, 1), (34.0, -6.0, 2), (34.0, -2.5, 1), (30.5, -4.0, 1)):
        for k in range(stack):
            b.box(m['crate'], (x - 1.0, y - 1.0, 2.0 * k), (x + 1.0, y + 1.0, 2.0 * k + 2.0), 2.0)
    b.box(m['trim'], (29.0, 14.0, 0.0), (35.0, 18.0, 0.6), 4.0)
    for k, x in enumerate((30.3, 32.0, 33.7)):
        b.cylinder(m['paint'], (x, 16.0, 1.5), 0.8, 3.6, 'y', 2.0, segments=18)
    b.box(m['trim'], (-35.5, 6.0, 0.0), (-33.0, 20.0, 0.3), 4.0)
    for z in (1.0, 2.4):
        b.box(m['trim'], (-35.5, 6.0, z), (-33.0, 20.0, z + 0.15), 4.0)
    for k, y in enumerate((8.0, 12.5, 17.0)):
        for z in (0.65, 2.05):
            b.cylinder(m['paint'], (-34.25, y + (0.6 if z > 1 else 0), z), 0.32, 3.4, 'y', 2.0, segments=14)
    b.box(m['trim'], (36.0, 24.0, 0.0), (38.0, 26.5, 1.4), 4.0)
    b.box(m['screen'], (35.98, 24.3, 1.5), (36.02, 26.2, 2.6), 1.0)
    b.box(m['trim'], (36.0, 24.0, 1.4), (38.0, 26.5, 2.9), 4.0, skip=('-x',))
    return b.objects('bay')


def build_turntable(m):
    b = Builder()
    segments = 72
    top, side = [], []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        top.append((PAD_R * math.cos(a), PAD_R * math.sin(a), 0.28))
    span = 2 * (PAD_R + 0.2)
    b.quad(m['pad'], top, 1.0, face=(0, 0, 1), uv=lambda p: (p.x / span + 0.5, p.y / span + 0.5))
    for k in range(segments):
        a0, a1 = 2 * math.pi * k / segments, 2 * math.pi * (k + 1) / segments
        corners = [(PAD_R * math.cos(a0), PAD_R * math.sin(a0), 0.0), (PAD_R * math.cos(a1), PAD_R * math.sin(a1), 0.0),
                   (PAD_R * math.cos(a1), PAD_R * math.sin(a1), 0.28), (PAD_R * math.cos(a0), PAD_R * math.sin(a0), 0.28)]
        mid = Vector(((math.cos(a0) + math.cos(a1)) / 2, (math.sin(a0) + math.sin(a1)) / 2, 0))
        b.quad(m['trim'], corners, 1.0, face=mid, uv=lambda p, k=k: (k / 6.0 + (0 if math.atan2(p.y, p.x) % (2 * math.pi) <= a0 + 1e-6 else 1 / 6.0), p.z))
    return b.objects('turntable')


def main(only=None):
    if only and 'hangar' not in only:
        return
    C.reset(samples=16)
    m = {
        'deck': bake_swatch('deck', 1024, deck),
        'wall': bake_swatch('wall', 1024, wall),
        'hazard': bake_swatch('hazard', 512, hazard),
        'crate': bake_swatch('crate', 512, crate),
        'pad': bake_swatch('pad', 1024, pad, glow=True),
    }
    m['trim'] = m['wall']
    m['panel'] = C.flat_material('light_panel', (1.0, 0.97, 0.92), 0.4, 0.0, emission=(1.0, 0.96, 0.9), strength=6.0)
    m['strip'] = C.flat_material('light_strip', (0.7, 0.85, 1.0), 0.4, 0.0, emission=(0.62, 0.82, 1.0), strength=5.0)
    m['amber'] = C.flat_material('guide_lamp', (1.0, 0.6, 0.2), 0.4, 0.0, emission=(1.0, 0.55, 0.18), strength=6.0)
    m['screen'] = C.flat_material('console', (0.2, 0.5, 0.6), 0.3, 0.0, emission=(0.25, 0.7, 0.9), strength=2.5)
    m['paint'] = C.flat_material('paint', (0.62, 0.6, 0.56), 0.45, 0.3)
    # One-sided: the room is seen from inside, everything else from out.
    for mat in set(m.values()):
        mat.use_backface_culling = True
    bay = build_bay(m)
    turntable = build_turntable(m)
    bay_obj = C.join(bay, 'bay')
    tt_obj = C.join(turntable, 'turntable')
    for obj in (bay_obj, tt_obj):
        C.triangulate(obj)
    C.log('bay', C.tri_count(bay_obj), 'triangles; turntable', C.tri_count(tt_obj))
    C.export_glb(os.path.join(C.MODELS, 'hangar.glb'), [bay_obj, tt_obj])


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv or None)
