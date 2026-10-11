"""Solids grown from distance fields, cut down to a game budget and dressed
in a texture baked from the full-detail surface — the kit `rocks.py` and
`deadwood.py` build with. Nothing here knows what a rock or a log is.

A thing is written as a signed distance field in the game's own space (+Y
up, metres, negative inside), because that is the one description in which
a joint plane, a chipped edge, a slate's cleavage steps or a splintered end
are each a line of arithmetic, and in which any number of them compose. The
field is then:

  1. sampled on a grid and meshed with surface nets (one vertex per cell the
     surface passes through, one quad per grid edge it crosses), which gives
     a closed, watertight surface by construction — the rocks replaced here
     include a scan that was a half-shell, and a hazard boulder must be a
     solid from every side the camera can reach;
  2. pulled onto the true surface with a couple of Newton steps along the
     field's gradient, which puts back the edges the grid rounded off;
  3. kept as the *high* surface — a few hundred thousand triangles — and
     copied and collapsed by Blender's quadric decimator to the *low* one
     the game draws, which spends its triangles on the silhouette and the
     fracture edges and almost none on a flat face;
  4. unwrapped (every object in a file into one atlas, so a set of pools
     shares one texture, one request and one material), and the high
     surface's colour baked onto the low one by Cycles on the CPU: an
     emission shader carrying the albedo, so nothing about the bake's own
     lighting leaks into the map, with the ambient occlusion of the high
     surface multiplied in the way a photoscan's diffuse carries its own;
  5. exported as plain glTF — positions, normals, one UV set, a baseColor
     map embedded as WebP — every node at its own origin with no transform
     and its metadata in the node's extras. That is the contract
     `js/importedModels.js#upgradeTextured(Set)` already reads.

The grid is only evaluated in full near the surface: every field comes with
a cheap bound (the same solid without its noise) and the most the noise can
move it by, and wherever the bound alone is further from zero than that the
answer is already known. That is what lets a boulder be meshed at a
centimetre and a crag at four without waiting on numpy for minutes.
"""

import math
import os
import sys

import numpy as np

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backdrop import fbm, ridged, smin, smax, smoothstep  # noqa: E402,F401
from riders import collection, clear_collection, tris  # noqa: E402,F401

TAU = math.tau


# --------------------------------------------------------------------------
# Noise in three dimensions, vectorised the way backdrop.py's is in two:
# gradient noise with a quintic fade, the gradients the twelve edges of a
# cube (Perlin's improved set), each octave turned against the last.

# Sixteen gradients so a hash picks one with a mask: the twelve edges of a
# cube, four of them twice.
GRAD3 = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
                  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
                  [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1]], dtype=np.float32)
_GX, _GY, _GZ = (np.ascontiguousarray(GRAD3[:, k]) for k in range(3))
_U = np.uint32


def _hash3(ix, iy, iz, seed):
    """A 32-bit hash of integer lattice points. In uint32 the products wrap
    modulo 2³², which is the hash's own modulus, so there is nothing to
    mask."""
    ix = np.asarray(ix).astype(np.int64).astype(_U)
    iy = np.asarray(iy).astype(np.int64).astype(_U)
    iz = np.asarray(iz).astype(np.int64).astype(_U)
    h = ix * _U(374761393) + iy * _U(668265263) + iz * _U(1274126177) + _U((seed * 1442695041) & 0xffffffff)
    h = (h ^ (h >> _U(13))) * _U(1103515245)
    return h ^ (h >> _U(16))


def noise3(p, seed=0):
    """Gradient noise at the rows of p (N×3), roughly in -1..1."""
    p = np.asarray(p, dtype=np.float64)
    pi = np.floor(p)
    f = (p - pi).astype(np.float32)
    i = pi.astype(np.int64).astype(_U)
    hx0 = i[:, 0] * _U(374761393)
    hy0 = i[:, 1] * _U(668265263)
    hz0 = i[:, 2] * _U(1274126177) + _U((seed * 1442695041) & 0xffffffff)
    hx1 = hx0 + _U(374761393)
    hy1 = hy0 + _U(668265263)
    hz1 = hz0 + _U(1274126177)
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    gx, gy, gz = fx - 1, fy - 1, fz - 1

    def corner(a, b, c, x, y, z):
        h = a + b + c
        h = (h ^ (h >> _U(13))) * _U(1103515245)
        h = (h ^ (h >> _U(16))) & _U(15)
        return _GX[h] * x + _GY[h] * y + _GZ[h] * z

    u = f * f * f * (f * (f * 6 - 15) + 10)
    ux, uy, uz = u[:, 0], u[:, 1], u[:, 2]
    c000 = corner(hx0, hy0, hz0, fx, fy, fz)
    c100 = corner(hx1, hy0, hz0, gx, fy, fz)
    c010 = corner(hx0, hy1, hz0, fx, gy, fz)
    c110 = corner(hx1, hy1, hz0, gx, gy, fz)
    c001 = corner(hx0, hy0, hz1, fx, fy, gz)
    c101 = corner(hx1, hy0, hz1, gx, fy, gz)
    c011 = corner(hx0, hy1, hz1, fx, gy, gz)
    c111 = corner(hx1, hy1, hz1, gx, gy, gz)
    x00 = c000 + ux * (c100 - c000)
    x10 = c010 + ux * (c110 - c010)
    x01 = c001 + ux * (c101 - c001)
    x11 = c011 + ux * (c111 - c011)
    y0 = x00 + uy * (x10 - x00)
    y1 = x01 + uy * (x11 - x01)
    return ((y0 + uz * (y1 - y0)) * 0.95).astype(np.float64)


# A rotation that no lattice axis survives, applied between octaves.
_R3 = np.array([[0.00, 0.80, 0.60], [-0.80, 0.36, -0.48], [-0.60, -0.48, 0.64]])


def fbm3(p, octaves, seed, gain=0.5, lacunarity=2.03):
    total = np.zeros(len(p))
    amp = 1.0
    norm = 0.0
    q = p
    for k in range(octaves):
        total += amp * noise3(q, seed + k)
        norm += amp
        amp *= gain
        q = (q @ _R3) * lacunarity
    return total / norm


def ridged3(p, octaves, seed, sharp=2.0, gain=0.5, lacunarity=2.03):
    """backdrop.ridged in three dimensions: knife edges on the crests of the
    coarser ones. Roughly 0..1."""
    total = np.zeros(len(p))
    weight = np.ones(len(p))
    amp = 1.0
    norm = 0.0
    q = p
    for k in range(octaves):
        s = np.clip(1.0 - np.abs(noise3(q, seed + k)), 0.0, 1.0) ** sharp
        s *= weight
        weight = np.clip(s * 1.6, 0.0, 1.0)
        total += s * amp
        norm += amp
        amp *= gain
        q = (q @ _R3) * lacunarity
    return total / norm


def hash01(i, seed):
    """A stable 0..1 value per integer (array or scalar)."""
    h = _hash3(i, seed, 7, 11)
    return (h & _U(0xffffff)).astype(np.float64) / float(0x1000000)


# --------------------------------------------------------------------------
# Distance-field arithmetic.

def frame(n):
    """Two unit vectors spanning the plane with normal n."""
    n = np.asarray(n, dtype=np.float64)
    n = n / np.linalg.norm(n)
    a = np.array([0.0, 1.0, 0.0]) if abs(n[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(a, n)
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    return n, u, v


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def ellipsoid(p, r):
    """A good-enough distance to an ellipsoid of semi-axes r (exact on the
    axes, never wrong in sign)."""
    r = np.asarray(r, dtype=np.float64)
    k0 = np.linalg.norm(p / r, axis=1)
    k1 = np.linalg.norm(p / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def segment(p, a, b):
    """Distance to segment ab, and where along it (0..1) the point projects."""
    a = np.asarray(a, dtype=np.float64)
    ab = np.asarray(b, dtype=np.float64) - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1), t


def smax_k(a, b, k):
    if k <= 0:
        return np.maximum(a, b)
    return smax(a, b, k)


def smin_k(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    return smin(a, b, k)


# --------------------------------------------------------------------------
# Meshing: surface nets on a narrow band.

class Field:
    """A solid: `fine(P)` its signed distance (negative inside) at the rows
    of P; `coarse(P)` the same solid without its small detail; `slack` the
    most the detail ever moves the surface by. `lo`/`hi` bound it."""

    def __init__(self, fine, coarse=None, slack=0.0, lo=None, hi=None):
        self.fine = fine
        self.coarse = coarse or fine
        self.slack = slack
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)


def _evaluate_grid(field, lo, step, shape, chunk=1_500_000):
    nx, ny, nz = shape
    xs = lo[0] + np.arange(nx) * step
    ys = lo[1] + np.arange(ny) * step
    zs = lo[2] + np.arange(nz) * step
    F = np.empty(shape, dtype=np.float32)
    plane = ny * nz
    per = max(1, chunk // plane)
    Y, Z = np.meshgrid(ys, zs, indexing='ij')
    band = field.slack + 2.0 * step
    fine_points = 0
    for i0 in range(0, nx, per):
        xs_c = xs[i0:i0 + per]
        P = np.empty((len(xs_c) * plane, 3))
        P[:, 0] = np.repeat(xs_c, plane)
        P[:, 1] = np.tile(Y.ravel(), len(xs_c))
        P[:, 2] = np.tile(Z.ravel(), len(xs_c))
        v = field.coarse(P)
        if field.coarse is not field.fine:
            near = np.abs(v) < band
            if near.any():
                v[near] = field.fine(P[near])
                fine_points += int(near.sum())
        F[i0:i0 + len(xs_c)] = v.reshape(len(xs_c), ny, nz)
    return F, fine_points


def surface_nets(F, lo, step):
    """Quads of the zero set of F (sampled at lo + index·step), one vertex
    per cell the surface crosses at the mean of its edge crossings. Faces
    are wound so their normals point out (towards positive F)."""
    s = F < 0
    nx, ny, nz = F.shape
    cnt = np.zeros((nx - 1, ny - 1, nz - 1), dtype=np.int8)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                cnt += s[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz]
    active = (cnt > 0) & (cnt < 8)
    del cnt
    ci = np.argwhere(active)
    M = len(ci)
    vid = np.full(active.shape, -1, dtype=np.int32)
    vid[ci[:, 0], ci[:, 1], ci[:, 2]] = np.arange(M)
    corners = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
    val = np.stack([F[ci[:, 0] + c[0], ci[:, 1] + c[1], ci[:, 2] + c[2]] for c in corners], 1)
    val = val.astype(np.float64)
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
    cpos = np.array(corners, dtype=np.float64)
    acc = np.zeros((M, 3))
    n = np.zeros(M)
    for a, b in edges:
        va, vb = val[:, a], val[:, b]
        m = (va < 0) != (vb < 0)
        t = va[m] / (va[m] - vb[m])
        acc[m] += cpos[a] + (cpos[b] - cpos[a]) * t[:, None]
        n[m] += 1
    verts = lo + (ci + acc / n[:, None]) * step

    quads = []
    # x-edges between (i,j,k) and (i+1,j,k)
    e = np.argwhere(s[:-1, 1:-1, 1:-1] != s[1:, 1:-1, 1:-1])
    i, j, k = e[:, 0], e[:, 1] + 1, e[:, 2] + 1
    q = np.stack([vid[i, j - 1, k - 1], vid[i, j, k - 1], vid[i, j, k], vid[i, j - 1, k]], 1)
    flip = ~s[i, j, k]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    # y-edges between (i,j,k) and (i,j+1,k)
    e = np.argwhere(s[1:-1, :-1, 1:-1] != s[1:-1, 1:, 1:-1])
    i, j, k = e[:, 0] + 1, e[:, 1], e[:, 2] + 1
    q = np.stack([vid[i - 1, j, k - 1], vid[i - 1, j, k], vid[i, j, k], vid[i, j, k - 1]], 1)
    flip = ~s[i, j, k]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    # z-edges between (i,j,k) and (i,j,k+1)
    e = np.argwhere(s[1:-1, 1:-1, :-1] != s[1:-1, 1:-1, 1:])
    i, j, k = e[:, 0] + 1, e[:, 1] + 1, e[:, 2]
    q = np.stack([vid[i - 1, j - 1, k], vid[i, j - 1, k], vid[i, j, k], vid[i - 1, j, k]], 1)
    flip = ~s[i, j, k]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    return verts, np.concatenate(quads)


def gradient(f, P, h):
    g = np.empty_like(P)
    for a in range(3):
        d = np.zeros(3)
        d[a] = h
        g[:, a] = (f(P + d) - f(P - d)) / (2 * h)
    return g


def project(f, P, h, iters=2, limit=None):
    """Newton steps onto the zero set along the gradient, each step held to
    `limit` so a vertex near a crease cannot jump across it."""
    limit = limit or h
    for _ in range(iters):
        v = f(P)
        g = gradient(f, P, h * 0.5)
        gg = np.maximum((g * g).sum(1), 1e-6)
        d = -(v / gg)[:, None] * g
        ln = np.linalg.norm(d, axis=1)
        d *= (np.minimum(ln, limit) / np.maximum(ln, 1e-12))[:, None]
        P = P + d
    return P


def triangulate(verts, quads):
    """Each quad split along its shorter diagonal — unless that diagonal is
    already an edge somewhere else, which would leave three faces on it."""
    a, b, c, d = quads.astype(np.int64).T
    d02 = ((verts[a] - verts[c]) ** 2).sum(1)
    d13 = ((verts[b] - verts[d]) ** 2).sum(1)
    use02 = d02 <= d13
    n = len(verts)
    key = lambda p, q: np.minimum(p, q) * n + np.maximum(p, q)  # noqa: E731
    sides = np.concatenate([key(a, b), key(b, c), key(c, d), key(d, a)])
    for _ in range(2):
        diag = np.where(use02, key(a, c), key(b, d))
        taken = np.isin(diag, sides) | (np.unique(diag, return_counts=True)[1][
            np.searchsorted(np.unique(diag), diag)] > 1)
        if not taken.any():
            break
        use02 = np.where(taken, ~use02, use02)
    t1 = np.where(use02[:, None], np.stack([a, b, c], 1), np.stack([a, b, d], 1))
    t2 = np.where(use02[:, None], np.stack([a, c, d], 1), np.stack([b, c, d], 1))
    return np.concatenate([t1, t2])


def tight_bounds(field, lo, hi, probe):
    """Shrink a generous box to the solid inside it, from the coarse field
    sampled every `probe` metres."""
    shape = tuple(int(math.ceil(v)) + 1 for v in (hi - lo) / probe)
    F, _ = _evaluate_grid(Field(field.coarse, lo=lo, hi=hi), lo, probe, shape)
    inside = np.argwhere(F < probe)
    a = lo + inside.min(0) * probe - probe
    b = lo + inside.max(0) * probe + probe
    return np.maximum(a, lo), np.minimum(b, hi)


def mesh_field(field, step, project_iters=2, log=None, probe=None):
    """The field's surface as (verts N×3, tris T×3) in game space. With
    `probe`, the field's box is first shrunk to the solid."""
    lo, hi = field.lo, field.hi
    if probe:
        lo, hi = tight_bounds(field, lo, hi, probe)
    lo = lo - 3 * step
    hi = hi + 3 * step
    shape = tuple(int(math.ceil(v)) + 1 for v in (hi - lo) / step)
    F, fine_points = _evaluate_grid(field, lo, step, shape)
    # The grid's border must be outside, or the surface is left open there.
    F[0] = F[-1] = abs(F[0]).max() + 1
    F[:, 0] = F[:, -1] = abs(F).max() + 1
    F[:, :, 0] = F[:, :, -1] = abs(F).max() + 1
    verts, quads = surface_nets(F, lo, step)
    if log:
        log(f'  grid {shape}, {fine_points} detailed samples, {len(verts)} vertices')
    if project_iters:
        verts = project(field.fine, verts, step, project_iters, limit=step * 0.6)
    return verts, triangulate(verts, quads)


# --------------------------------------------------------------------------
# Blender meshes from numpy, and back.

def to_blender(P):
    """three.js (Y up, −Z nose) → Blender (Z up), for rows of points."""
    P = np.asarray(P, dtype=np.float64)
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)


def from_blender(P):
    P = np.asarray(P, dtype=np.float64)
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)


def mesh_object(name, verts, faces, col, attrs=None):
    """A mesh object at the origin from game-space verts and triangles, with
    float point attributes `attrs` = {name: N values}."""
    me = bpy.data.meshes.new(name)
    nv = len(verts)
    nt = len(faces)
    me.vertices.add(nv)
    me.vertices.foreach_set('co', to_blender(verts).astype(np.float32).ravel())
    me.loops.add(nt * 3)
    me.loops.foreach_set('vertex_index', np.asarray(faces, dtype=np.int32).ravel())
    me.polygons.add(nt)
    me.polygons.foreach_set('loop_start', np.arange(0, nt * 3, 3, dtype=np.int32))
    me.update()
    me.validate(clean_customdata=False)
    for key, values in (attrs or {}).items():
        values = np.asarray(values, dtype=np.float32)
        if values.ndim == 2:
            # stored as given: these are parameters (a bark's around/along),
            # not directions in space
            a = me.attributes.new(key, 'FLOAT_VECTOR', 'POINT')
            a.data.foreach_set('vector', values.ravel())
        else:
            a = me.attributes.new(key, 'FLOAT', 'POINT')
            a.data.foreach_set('value', values)
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    ob = bpy.data.objects.new(name, me)
    ob['_attrs'] = list((attrs or {}).keys())
    col.objects.link(ob)
    return ob


def clean(ob, recalc=True):
    """Weld coincident vertices, drop degenerate faces and wind every face
    outwards."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def is_closed(ob):
    """Every edge between exactly two faces, and no face twice: a pair of
    coincident triangles passes the first test and is a hole once the
    exporter's `validate()` has thrown one of them away."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    ok = all(len(e.link_faces) == 2 for e in bm.edges)
    keys = [tuple(sorted(v.index for v in f.verts)) for f in bm.faces]
    ok = ok and len(set(keys)) == len(keys)
    bm.free()
    # and nothing the exporter's own validation would change
    probe = ob.data.copy()
    ok = ok and not probe.validate()
    bpy.data.meshes.remove(probe)
    return ok


def drop_twins(ob):
    """Delete every face that has a twin on the same vertices, both copies:
    the pair encloses nothing, and the surface is closed without it."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    seen = {}
    for f in bm.faces:
        seen.setdefault(tuple(sorted(v.index for v in f.verts)), []).append(f)
    twins = [f for group in seen.values() if len(group) > 1 for f in group]
    if twins:
        bmesh.ops.delete(bm, geom=twins, context='FACES_ONLY')
        loose = [e for e in bm.edges if not e.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='EDGES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(twins)


def _evaluate(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    return bpy.data.meshes.new_from_object(ob.evaluated_get(dg))


def decimated(high, name, budget, col, voxel):
    """A copy of `high` collapsed to at most `budget` triangles, closed and
    triangulated. Surface nets can pinch an edge where the field has a
    saddle smaller than a cell, so the copy is first rebuilt by Blender's
    voxel remesher (OpenVDB), whose output is a closed manifold by
    construction, at `voxel` — about the grid step, which loses nothing the
    decimator would have kept."""
    me = high.data.copy()
    for key in high.get('_attrs', []):
        if key in me.attributes:
            me.attributes.remove(me.attributes[key])
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    mod = ob.modifiers.new('weld', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    mod.adaptivity = 0.0
    mod.use_smooth_shade = True
    ev = _evaluate(ob)
    ob.modifiers.remove(mod)
    ob.data = ev
    bpy.data.meshes.remove(me)
    me = ev
    have = tris(ob)
    ratio = min(1.0, budget / have)
    for attempt in range(6):
        mod = ob.modifiers.new('budget', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        ev = _evaluate(ob)
        ob.modifiers.remove(mod)
        got = sum(len(p.vertices) - 2 for p in ev.polygons)
        if got <= budget or attempt == 5:
            old = ob.data
            ob.data = ev
            if old is not me:
                bpy.data.meshes.remove(old)
            break
        bpy.data.meshes.remove(ev)
        ratio *= (budget / got) * 0.995
    if me.users == 0:
        bpy.data.meshes.remove(me)
    clean(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(ob.data)
    bm.free()
    drop_twins(ob)
    drop_slivers(ob)
    drop_twins(ob)
    ob.name = name
    ob.data.name = name
    return ob


def drop_slivers(ob, area=1e-8):
    """The decimator leaves the odd triangle with three vertices in a line,
    and the glTF exporter drops a triangle of no area — which leaves a hole
    in a closed solid. Each one is mended here instead: a cap (one vertex
    lying on the far edge) by turning that long edge within the quad it
    shares with its neighbour, a needle (two vertices on top of each other)
    by collapsing the edge between them. Neither can open the surface."""
    for _ in range(8):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bad = [f for f in bm.faces if f.calc_area() < area]
        if not bad:
            bm.free()
            break
        flips, needles = set(), set()
        for f in bad:
            short = min(f.edges, key=lambda e: e.calc_length())
            if short.calc_length() < 1e-5:
                needles.add(short)
            else:
                long_ = max(f.edges, key=lambda e: e.calc_length())
                if len(long_.link_faces) == 2:
                    flips.add(long_)
        if flips:
            bmesh.ops.rotate_edges(bm, edges=list(flips), use_ccw=False)
        if needles:
            bmesh.ops.collapse(bm, edges=[e for e in needles if e.is_valid], uvs=False)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(ob.data)
        bm.free()
    ob.data.update()


def unwrap(objects, margin=0.004, angle=62.0, wrapped=()):
    """Every object's UVs in one shared atlas: Smart UV Project over all of
    them at once (objects in `wrapped` keep the UVs they were built with),
    every island brought to one texel density, then one tight pack."""
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    todo = [ob for ob in objects if ob not in wrapped]
    for ob in todo:
        ob.select_set(True)
        if not ob.data.uv_layers:
            ob.data.uv_layers.new(name='UVMap')
    if todo:
        bpy.context.view_layer.objects.active = todo[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin,
                                 area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    _pack(margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    for ob in objects:
        ob.select_set(False)


def _pack(margin):
    try:
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin=margin,
                                shape_method='CONCAVE')
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)


def scale_uv_islands(ob, weight):
    """Rescale each UV island about its centre by weight(face) — the largest
    of its faces' weights — before a re-pack, so faces nobody sees (a
    boulder's buried foot) give their texels to the faces everybody does."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    # islands: faces joined across edges whose UVs agree on both ends
    seen = set()
    islands = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        seen.add(f.index)
        isl = []
        while stack:
            g = stack.pop()
            isl.append(g)
            for loop in g.loops:
                e = loop.edge
                for other in e.link_faces:
                    if other.index in seen:
                        continue
                    # shared edge: the same UVs at both of its vertices?
                    ok = True
                    for v in e.verts:
                        a = next(l_[uv].uv for l_ in g.loops if l_.vert == v)
                        b = next(l_[uv].uv for l_ in other.loops if l_.vert == v)
                        if (a - b).length > 1e-6:
                            ok = False
                            break
                    if ok:
                        seen.add(other.index)
                        stack.append(other)
        islands.append(isl)
    for isl in islands:
        # an island is shrunk only if every face of it is — one that runs up
        # out of the snow keeps its density, or the line where it changes
        # shows on the rock
        w = max(weight(f) for f in isl)
        if abs(w - 1.0) < 1e-3:
            continue
        loops = [l_ for f in isl for l_ in f.loops]
        cx = sum(l_[uv].uv.x for l_ in loops) / len(loops)
        cy = sum(l_[uv].uv.y for l_ in loops) / len(loops)
        for l_ in loops:
            l_[uv].uv.x = cx + (l_[uv].uv.x - cx) * w
            l_[uv].uv.y = cy + (l_[uv].uv.y - cy) * w
    bm.to_mesh(ob.data)
    bm.free()


def repack(objects, margin=0.004):
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    _pack(margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    for ob in objects:
        ob.select_set(False)


# --------------------------------------------------------------------------
# Shader graphs, written as expressions rather than as node soup.

class Graph:
    """A material's node tree with arithmetic on sockets: `g.mul(a, b)`,
    `g.mix(t, a, b)`, constants promoted to nodes on the way in."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)

    def node(self, kind, inputs=None, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        for k, v in (inputs or {}).items():
            self.set(n.inputs[k], v)
        return n

    def set(self, sock, v):
        if hasattr(v, 'is_output') or isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        elif isinstance(v, (tuple, list)):
            if len(sock.default_value) == 4 and len(v) == 3:
                v = tuple(v) + (1.0,)
            sock.default_value = v
        else:
            if hasattr(sock, 'default_value') and hasattr(sock.default_value, '__len__'):
                n = len(sock.default_value)
                sock.default_value = (v,) * n if n != 4 else (v, v, v, 1.0)
            else:
                sock.default_value = v

    # scalars
    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        if len(n.inputs) > 2:
            self.set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b):
        return self.math('ADD', a, b)

    def sub(self, a, b):
        return self.math('SUBTRACT', a, b)

    def mul(self, a, b, clamp=False):
        return self.math('MULTIPLY', a, b, clamp=clamp)

    def smooth(self, lo, hi, x):
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.set(n.inputs['Value'], x)
        self.set(n.inputs['From Min'], lo)
        self.set(n.inputs['From Max'], hi)
        return n.outputs['Result']

    def remap(self, x, a, b, c=0.0, d=1.0, clamp=True):
        n = self.node('ShaderNodeMapRange', clamp=clamp)
        self.set(n.inputs['Value'], x)
        self.set(n.inputs['From Min'], a)
        self.set(n.inputs['From Max'], b)
        self.set(n.inputs['To Min'], c)
        self.set(n.inputs['To Max'], d)
        return n.outputs['Result']

    # colours
    def mix(self, t, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_factor=True)
        self.set(n.inputs[0], t)
        self.set(n.inputs[6], a)
        self.set(n.inputs[7], b)
        return n.outputs[2]

    def cmul(self, a, b):
        return self.mix(1.0, a, b, 'MULTIPLY')

    def vmath(self, op, a, b=(0, 0, 0), scale=None):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        if scale is not None:
            self.set(n.inputs['Scale'], scale)
        return n.outputs[1] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else n.outputs[0]

    def sep(self, v):
        n = self.node('ShaderNodeSeparateXYZ')
        self.set(n.inputs[0], v)
        return n.outputs

    def combine(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ')
        self.set(n.inputs[0], x)
        self.set(n.inputs[1], y)
        self.set(n.inputs[2], z)
        return n.outputs[0]

    def sepc(self, c):
        n = self.node('ShaderNodeSeparateColor')
        self.set(n.inputs[0], c)
        return n.outputs

    def lum(self, c):
        n = self.node('ShaderNodeRGBToBW')
        self.set(n.inputs[0], c)
        return n.outputs[0]

    # inputs
    def attr(self, name, vector=False):
        n = self.node('ShaderNodeAttribute', attribute_name=name, attribute_type='GEOMETRY')
        return n.outputs['Vector'] if vector else n.outputs['Fac']

    def coords(self):
        """Object coordinates, in the game's space (+Y up)."""
        n = self.node('ShaderNodeTexCoord')
        x, y, z = self.sep(n.outputs['Object'])
        return self.combine(x, z, self.mul(y, -1.0))

    def normal(self):
        """The shading normal in game space."""
        n = self.node('ShaderNodeNewGeometry')
        x, y, z = self.sep(n.outputs['Normal'])
        return self.combine(x, z, self.mul(y, -1.0))

    def noise(self, vec, scale, detail=4.0, rough=0.55, distortion=0.0, dims='3D', kind='FBM'):
        n = self.node('ShaderNodeTexNoise', noise_dimensions=dims)
        try:
            n.noise_type = kind
        except Exception:
            pass
        self.set(n.inputs['Vector'], vec)
        self.set(n.inputs['Scale'], scale)
        self.set(n.inputs['Detail'], detail)
        self.set(n.inputs['Roughness'], rough)
        self.set(n.inputs['Distortion'], distortion)
        return n.outputs['Fac']

    def voronoi(self, vec, scale, feature='F1', metric='EUCLIDEAN', random=1.0):
        n = self.node('ShaderNodeTexVoronoi', feature=feature, distance=metric)
        self.set(n.inputs['Vector'], vec)
        self.set(n.inputs['Scale'], scale)
        self.set(n.inputs['Randomness'], random)
        return n.outputs

    def image(self, path, vec, box=0.0, colorspace='sRGB'):
        img = bpy.data.images.load(path, check_existing=True)
        img.colorspace_settings.name = colorspace
        n = self.node('ShaderNodeTexImage', image=img, interpolation='Linear')
        if box:
            n.projection = 'BOX'
            n.projection_blend = box
        self.set(n.inputs['Vector'], vec)
        return n.outputs['Color']

    def ramp(self, x, stops, interpolation='LINEAR'):
        """A colour ramp from (position, rgb) stops."""
        n = self.node('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = interpolation
        (p0, c0), (p1, c1) = stops[0], stops[-1]
        cr.elements[0].position = p0
        cr.elements[0].color = tuple(c0) + (1.0,)
        cr.elements[1].position = p1
        cr.elements[1].color = tuple(c1) + (1.0,)
        for pos, col in stops[1:-1]:
            el = cr.elements.new(pos)
            el.color = tuple(col) + (1.0,)
        self.set(n.inputs['Fac'], x)
        return n.outputs['Color']

    def dot(self, a, b):
        return self.vmath('DOT_PRODUCT', a, b)

    def triplanar(self, path, P, N, axes, scale, sharp=4.0, colorspace='sRGB'):
        """An image projected along the three axes of `axes` (three unit
        vectors in game space — a slate's cleavage frame, say), each sample
        weighted by how squarely the surface faces that axis, so the photo's
        grain runs the way the rock's does."""
        u = [self.dot(P, tuple(a)) for a in axes]
        n = [self.math('POWER', self.math('ABSOLUTE', self.dot(N, tuple(a))), sharp) for a in axes]
        total = self.add(self.add(n[0], n[1]), n[2])
        out = None
        for k, (i, j) in enumerate(((1, 2), (0, 2), (0, 1))):
            vec = self.combine(self.mul(u[i], 1.0 / scale), self.mul(u[j], 1.0 / scale), 0.0)
            col = self.image(path, vec, colorspace=colorspace)
            w = self.math('DIVIDE', n[k], total)
            term = self.mix(w, (0, 0, 0), col, 'MIX')
            out = term if out is None else self.mix(1.0, out, term, 'ADD')
        return out

    def ao(self, distance, samples=16):
        n = self.node('ShaderNodeAmbientOcclusion', samples=samples, only_local=True, inside=False)
        self.set(n.inputs['Distance'], distance)
        return n.outputs['AO']

    def emit(self, colour):
        e = self.node('ShaderNodeEmission')
        self.set(e.inputs['Color'], colour)
        self.set(e.inputs['Strength'], 1.0)
        out = self.node('ShaderNodeOutputMaterial', target='CYCLES')
        self.nt.links.new(e.outputs[0], out.inputs['Surface'])
        return out


# --------------------------------------------------------------------------
# Baking.

def _push_pull(rgb, filled):
    """Fill every unbaked texel from the baked ones around it, coarse to
    fine, so the gutters between islands carry their islands' colours all
    the way down the mip chain instead of bleeding black into them."""
    if filled.all() or min(rgb.shape[:2]) <= 1:
        return rgb
    h, w = filled.shape
    w2 = filled[: h // 2 * 2, : w // 2 * 2].reshape(h // 2, 2, w // 2, 2).sum((1, 3)).astype(np.float64)
    c2 = (rgb[: h // 2 * 2, : w // 2 * 2] * filled[: h // 2 * 2, : w // 2 * 2, None]) \
        .reshape(h // 2, 2, w // 2, 2, 3).sum((1, 3))
    coarse = np.where(w2[..., None] > 0, c2 / np.maximum(w2[..., None], 1), 0)
    coarse = _push_pull(coarse, w2 > 0)
    up = np.repeat(np.repeat(coarse, 2, 0), 2, 1)
    up = np.pad(up, ((0, h - up.shape[0]), (0, w - up.shape[1]), (0, 0)), mode='edge')
    return np.where(filled[..., None], rgb, up)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def bake_atlas(pairs, size, samples, extrusion, distance, margin=12):
    """Bake each (high, low) pair's emission — the high surface's albedo —
    onto the low surface's UVs, all into one float atlas. The pairs are slid
    a kilometre apart for the bake, so no ray from one finds another's
    surface, and the lows are joined into one target so a single bake fills
    the atlas and no island's margin can paint over a neighbour's. Returns
    an H×W×3 linear array with the gutters filled."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    if hasattr(scene.cycles, 'use_adaptive_sampling'):
        scene.cycles.use_adaptive_sampling = False
    w, h = (size, size) if isinstance(size, int) else size
    img = bpy.data.images.new('_atlas', w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0, 0, 0, 0)
    target = bpy.data.materials.new('_bakeTarget')
    target.use_nodes = True
    tn = target.node_tree.nodes.new('ShaderNodeTexImage')
    tn.image = img
    target.node_tree.nodes.active = tn

    copies = []
    for k, (high, low) in enumerate(pairs):
        high.location = (k * 1000.0, 0, 0)
        c = low.copy()
        c.data = low.data.copy()
        c.data.materials.clear()
        c.data.materials.append(target)
        c.location = (k * 1000.0, 0, 0)
        c.data.shade_smooth()
        if hasattr(c.data, 'set_sharp_from_angle'):
            c.data.set_sharp_from_angle(angle=math.pi)
        low.users_collection[0].objects.link(c)
        copies.append(c)
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    if len(copies) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    for high, _ in pairs:
        high.hide_render = False
        high.select_set(True)
    joined.select_set(True)
    bpy.context.view_layer.objects.active = joined
    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = extrusion
    bake.max_ray_distance = distance
    bake.margin = margin
    if hasattr(bake, 'margin_type'):
        bake.margin_type = 'EXTEND'
    bake.use_clear = True
    bake.target = 'IMAGE_TEXTURES'
    bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=extrusion,
                        max_ray_distance=distance, margin=margin, use_clear=True)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    for high, _ in pairs:
        high.location = (0, 0, 0)
    me = joined.data
    bpy.data.objects.remove(joined)
    bpy.data.meshes.remove(me)
    bpy.data.images.remove(img)
    bpy.data.materials.remove(target)
    filled = px[..., 3] > 0.5
    rgb = _push_pull(px[..., :3].astype(np.float64), filled)
    return rgb, filled


def save_webp(path, rgb_linear, quality=82):
    """A linear H×W×3 array (row 0 at the bottom, as Blender stores it) → an
    sRGB WebP, written through Blender as backdrop.py writes its maps."""
    h, w, _ = rgb_linear.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = linear_to_srgb(rgb_linear)
    img.pixels.foreach_set(px.ravel())
    img.file_format = 'WEBP'
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)
    return os.path.getsize(path)


def dress(objects, texture_path, name):
    """Give every low object one material wearing the baked atlas: what the
    exporter writes as the baseColor map the game picks up."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    img = bpy.data.images.load(texture_path, check_existing=True)
    img.reload()
    img.colorspace_settings.name = 'sRGB'
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    for ob in objects:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    return mat


def finish_normals(ob, sharp_deg):
    """Smooth shading with the real fracture edges kept hard."""
    ob.data.shade_smooth()
    if hasattr(ob.data, 'set_sharp_from_angle'):
        ob.data.set_sharp_from_angle(angle=math.radians(sharp_deg))


def export_glb(objects, path):
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in objects:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True,
        export_materials='EXPORT', export_image_format='AUTO', export_extras=True,
        export_attributes=False, export_animations=False, export_skins=False,
        export_morph=False, export_cameras=False, export_lights=False,
        export_tangents=False,
    )
    return os.path.getsize(path)


# --------------------------------------------------------------------------
# Preview: a finished low object with its texture, Cycles on the CPU.

def portrait(objects, path, res=(1600, 900), sink=0.0, yaw=-0.55, elev=0.28, lens=55, samples=48,
             fill=0.62, ground=True, light=(58, -38)):
    """One subject — an object or a few side by side — framed from three
    quarters on a pale, snow-white ground, sunk `sink` metres as the game
    beds it, under a low winter sun and a bright overcast fill."""
    from mathutils import Vector
    if not isinstance(objects, (list, tuple)):
        objects = [objects]
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Base Contrast'
    except Exception:
        pass
    col = collection('_preview')
    for o in list(col.objects):
        bpy.data.objects.remove(o)
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.80, 0.82, 0.85, 1)
    bg.inputs[1].default_value = 0.55
    sun = bpy.data.objects.new('_sun', bpy.data.lights.get('_sun') or bpy.data.lights.new('_sun', 'SUN'))
    sun.data.energy = 4.2
    sun.data.angle = math.radians(1.5)
    sun.rotation_euler = (math.radians(light[0]), 0, math.radians(light[1]))
    col.objects.link(sun)
    hidden = []
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH' and ob not in objects and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)
    lo = np.full(3, 1e9)
    hi = np.full(3, -1e9)
    for ob in objects:
        ob.hide_render = False
        bb = np.array([list(ob.matrix_world @ Vector(v)) for v in ob.bound_box])
        lo = np.minimum(lo, bb.min(0))
        hi = np.maximum(hi, bb.max(0))
    for ob in objects:
        ob.location.z -= sink
    lo[2] -= sink
    hi[2] -= sink
    if ground:
        me = bpy.data.meshes.new('_ground')
        me.from_pydata([(-900, -900, 0), (900, -900, 0), (900, 900, 0), (-900, 900, 0)], [], [(0, 1, 2, 3)])
        m = bpy.data.materials.get('_groundMat') or bpy.data.materials.new('_groundMat')
        m.use_nodes = True
        b = m.node_tree.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = (0.86, 0.88, 0.92, 1)
        b.inputs['Roughness'].default_value = 0.6
        me.materials.append(m)
        col.objects.link(bpy.data.objects.new('_ground', me))
    vis_lo = lo.copy()
    vis_lo[2] = max(lo[2], 0.0)
    centre = (vis_lo + hi) / 2
    radius = np.linalg.norm(hi - vis_lo) / 2
    cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam'))
    cam.data.lens = lens
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 24.0
    col.objects.link(cam)
    scene.camera = cam
    half_fov = math.atan(12.0 / lens)
    dist = radius / math.sin(half_fov) * fill
    d = np.array([math.sin(yaw) * math.cos(elev), -math.cos(yaw) * math.cos(elev), math.sin(elev)])
    cam.location = Vector(centre + d * dist)
    cam.rotation_euler = (Vector(centre) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for ob in objects:
        ob.location.z += sink
    for ob in hidden:
        ob.hide_render = False
    for o in list(col.objects):
        bpy.data.objects.remove(o)
    return path
