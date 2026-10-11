"""Alpen deadwood — the cut stump, the two fallen trunks and the snapped
branches of the forest floor, built in Blender and baked to one atlas.

    blender --background --factory-startup \\
        --python fun/alpen/tools/blender/deadwood.py -- --out fun/alpen/assets/models/nature

Run from the repository root; writes `alpine-deadwood.glb` (add `--preview
DIR` to render each piece on the snow). Three or four minutes, most of it the
Cycles bake, on the CPU. See MODELS.md and `fieldkit.py` for the method.

A SPRUCE FOREST'S FLOOR, IN WINTER.

  * THE STUMP is forestry: a Norway spruce felled with a saw. The faller's
    notch on the side it fell towards leaves that half of the cut a few
    centimetres lower than the back cut, and between the two the hinge —
    the strip of wood left to steer the fall — is torn, a row of splinters
    standing up across the top. Years later the cut face has gone grey and
    opened in radial checks; the bark is loose and gone in places; and the
    buttress roots that held the tree run out under the snow on every side,
    which is what makes it two and a half times as wide as it is tall.
  * THE FALLEN TRUNKS came down by themselves. The light one snapped high up
    and lies with its top broken into long splinters and its butt rotted
    off. The heavy one is a windthrow, old: its root flare still carries the
    stubs of the roots that tore, one broken limb stands up out of it, and
    most of its bark has gone, leaving silver-grey wood checked along the
    grain — the bark lasts longest underneath, where the snow keeps it damp.
  * THE BRANCHES are what the snow brings down every winter: thin, crooked,
    their twigs snapped short, grey bark with the pale lichen that grows on
    every dead spruce branch in the Alps.

The logs lie along +x (the game's capsule follows that axis) on y = 0, at
the sizes `props.js#DEADWOOD` gives them; the stump stands on y = 0 and the
game scales it to forty centimetres; the branches lie along z at their own
size.
"""

import math
import os
import sys
import time

import numpy as np

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fieldkit as fk  # noqa: E402
from fieldkit import Field, fbm, ridged, fbm3, unit, segment, smin_k  # noqa: E402
from riders import collection, clear_collection, tris  # noqa: E402
from rocks import lin, vertices  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TEXTURES = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'textures'))
TAU = math.tau


def log(*a):
    print(*a, flush=True)


# ===========================================================================
# LOGS
# ===========================================================================

class Log:
    """A trunk lying along +x from `x0` (the butt) to `x1` (the top): its
    axis bowed a little, its section out of round, its bark in plates with
    furrows between them and gone in long strips, the bare wood checked
    along the grain. The two ends are each a surface x = end(θ, ρ): a long
    torn tongue and splinters for a snap, a softened stub for an old rotted
    break. Branch stubs and root stubs are tapered capsules welded on."""

    def __init__(self, spec):
        self.s = spec
        self.seed = spec['seed']
        self.x0, self.x1 = spec['x0'], spec['x1']
        # Stubs are given round the trunk — (x, angle from the top, length
        # beyond the bark, radius, lean towards the top) — and welded on
        # where the trunk actually is there.
        self.stubs = []
        for st in spec.get('stubs', []):
            x, a, ln, rr, lean = st[:5]
            _, cy, cz, r = self.axis(np.array([x]))
            ring = np.array([0.0, math.cos(a), math.sin(a)])
            base = np.array([x, cy[0], cz[0]]) + ring * r[0] * 0.6
            d = unit(np.array([lean, math.cos(a), math.sin(a)]))
            self.stubs.append(dict(a=tuple(base), b=tuple(base + d * (r[0] * 0.45 + ln)), r=rr,
                                   taper=st[5] if len(st) > 5 else 0.35, k=min(0.05, rr * 0.8),
                                   jag=rr * 0.2))

    def axis(self, x):
        """Along the trunk: the parameter t (0 at the butt), the axis (y, z)
        and the radius. The trunk lies on the ground along its length, so
        the axis rides at the radius — higher at a flared butt."""
        s = self.s
        x = np.asarray(x, dtype=np.float64)
        t = np.clip((x - self.x0) / (self.x1 - self.x0), 0, 1)
        r = s['r0'] + (s['r1'] - s['r0']) * t
        flare = s.get('flare', 0.0)
        if flare:
            r = r * (1 + flare * np.exp(-np.maximum(x - self.x0, 0) / s.get('flare_len', 0.3)))
        cy = r * 0.96 + s.get('bow_y', 0.0) * np.sin(math.pi * t)
        cz = s.get('bow_z', 0.0) * np.sin(math.pi * t + 0.4)
        return t, cy, cz, r

    def polar(self, P):
        x = P[:, 0]
        t, cy, cz, r = self.axis(x)
        dy = P[:, 1] - cy
        dz = P[:, 2] - cz
        rho = np.sqrt(dy * dy + dz * dz)
        theta = np.arctan2(dz, dy)          # 0 on top, ±π underneath
        return x, t, r, rho, theta

    def bare(self, x, theta, r):
        """Where the bark has gone: long strips along the grain, more of it
        on top than underneath."""
        s = self.s
        around = theta * r / 0.22
        m = fbm(around, x / 0.55, 3, self.seed + 3) + 0.35 * np.cos(theta) * s.get('top_bias', 0.5)
        return fk.smoothstep(s['bare'] - 0.04, s['bare'] + 0.04, m)

    def radius(self, P, fine):
        x, t, r, rho, theta = self.polar(P)
        s = self.s
        R = r * (1 + s.get('oval', 0.05) * np.cos(2 * theta + s.get('oval_phase', 0.5)))
        if fine:
            R = R * (1 + 0.04 * fbm(theta * 1.6, x / 0.45, 3, self.seed + 1))
            bark = s['bark']
            gone = self.bare(x, theta, r)
            # bark plates: ridged along the grain, the furrows between them
            plates = ridged(theta * r / 0.035, x / 0.22, 3, self.seed + 11, sharp=1.5)
            bark_r = bark * (0.35 + 0.65 * plates)
            # checks in the bare wood: narrow grooves along the grain
            chk = fbm(theta * r / 0.05, x / 1.2, 2, self.seed + 17)
            checks = s.get('checks', 0.012) * (1 - fk.smoothstep(0.0, 0.05, np.abs(chk))) * \
                fk.smoothstep(0.2, 0.6, fbm(theta * 2.0, x / 0.7, 2, self.seed + 19) + 0.5)
            R = R + bark_r * (1 - gone) - checks * gone
        return rho - R, x, rho, theta, R

    def ends(self, x, rho, theta, R, fine):
        s = self.s
        rr = np.clip(rho / np.maximum(R, 1e-3), 0, 1.2)
        # the butt
        b = s['butt']
        e0 = self.x0 + b.get('slant', 0.0) * np.cos(theta - b.get('phase', 0.0)) * R
        # the top
        tp = s['top']
        e1 = self.x1 - tp.get('slant', 0.0) * np.cos(theta - tp.get('phase', 0.0)) * R
        if fine:
            # a snapped end: a torn tongue on one side, then splinters
            # tapering out of the section, longest at the rim
            sp = tp.get('splinters', 0.0)
            if sp:
                tongue = tp.get('tongue', 0.0) * np.maximum(0, np.cos(theta - tp.get('tongue_at', 0.0))) ** 3
                spl = ridged(theta * R / tp.get('splinter_width', 0.022), rr * 2.4, 3, self.seed + 23,
                             sharp=tp.get('sharp', 2.6))
                spl = spl * (0.35 + 0.65 * rr)
                e1 = e1 + tongue + sp * spl ** 1.6 + 0.012 * fbm(theta * 4, rr * 6, 2, self.seed + 29)
            sp = b.get('splinters', 0.0)
            if sp:
                spl = ridged(theta * R / 0.03, rr * 2.0, 3, self.seed + 31, sharp=2.0)
                e0 = e0 - sp * spl ** 1.4 * (0.4 + 0.6 * rr) - 0.015 * fbm(theta * 4, rr * 5, 2, self.seed + 37)
            rot = b.get('rot', 0.0)
            if rot:
                # the heart gone soft and the sapwood with it: the stub rounds
                e0 = e0 + rot * rr ** 2
        return e0, e1

    def stub_field(self, P, f):
        for st in self.stubs:
            a = np.asarray(st['a'], dtype=np.float64)
            b = np.asarray(st['b'], dtype=np.float64)
            d, t = segment(P, a, b)
            r = st['r'] * (1 - st.get('taper', 0.3) * t)
            fs = d - r
            # a snapped tip, not a rounded one
            ab = unit(b - a)
            fs = np.maximum(fs, (P - b) @ ab - st.get('jag', 0.0) * np.abs(np.sin((P @ ab) * 80.0)))
            f = smin_k(f, fs, st.get('k', 0.02))
        return f

    def field_at(self, P, fine=True):
        f, x, rho, theta, R = self.radius(P, fine)
        e0, e1 = self.ends(x, rho, theta, R, fine)
        f = np.maximum(f, np.maximum(e0 - x, x - e1))
        return self.stub_field(P, f)

    def coarse(self, P):
        return self.field_at(P, False)

    def fine(self, P):
        f = self.field_at(P, True)
        return f + 0.0015 * fbm3(P / 0.02, 2, self.seed + 41)

    @property
    def slack(self):
        s = self.s
        return s['bark'] + 0.06 * s['r0'] + s.get('checks', 0.012) + 0.03 + \
            max(s['top'].get('splinters', 0) + s['top'].get('tongue', 0), s['butt'].get('splinters', 0))

    def field(self):
        s = self.s
        reach = max(s['r0'] * (1 + s.get('flare', 0)), s['r1']) * 1.25 + 0.05
        lo = [self.x0 - 0.35, -0.05, -reach - abs(s.get('bow_z', 0))]
        hi = [self.x1 + s['top'].get('splinters', 0) + s['top'].get('tongue', 0) + 0.1,
              2 * reach + abs(s.get('bow_y', 0)) + 0.6, reach + abs(s.get('bow_z', 0))]
        for st in self.stubs:
            for p in (st['a'], st['b']):
                lo = np.minimum(lo, np.asarray(p) - st['r'] - 0.05)
                hi = np.maximum(hi, np.asarray(p) + st['r'] + 0.05)
        return Field(self.fine, self.coarse, self.slack, lo, hi)

    def attributes(self, verts):
        f, x, rho, theta, R = self.radius(verts, True)
        _, _, r, _, _ = self.polar(verts)
        e0, e1 = self.ends(x, rho, theta, R, True)
        endness = np.maximum(e0 - x, x - e1)
        on_end = fk.smoothstep(-0.01, 0.004, endness - f)
        stub = np.zeros(len(verts))
        for st in self.stubs:
            d, t = segment(verts, st['a'], st['b'])
            stub = np.maximum(stub, 1 - fk.smoothstep(st['r'] * 1.05, st['r'] * 1.6, d))
        gone = self.bare(x, theta, r)
        u = theta * r
        return {
            'bare': np.maximum(gone, stub),
            'endgrain': on_end * (1 - stub),
            'fresh': on_end * (x > (self.x0 + self.x1) / 2) * self.s['top'].get('fresh', 0.0),
            'rho': np.clip(rho / np.maximum(R, 1e-3), 0, 1),
            'bark_u': u,
            'bark_v': x,
            'bark_seam': fk.smoothstep(0.82 * math.pi, math.pi, np.abs(theta)),
            'bark_wrap': np.sign(theta) * TAU * r,
            'up': np.zeros(len(verts)),
        }


# The two trunk pools, in props.js order (DEADWOOD.logs). `length`,
# `radius` and `height` are what the game's capsule is built from, and the
# model is built to them.
LOGS = [
    dict(name='log_fallen', length=3.05, radius=0.15, height=0.29),
    dict(name='log_windthrow', length=4.05, radius=0.30, height=1.06),
]


def log_spec(i):
    L = LOGS[i]
    half = L['length'] / 2
    if i == 0:
        # A snapped spruce top: thin, its bark mostly on, the top torn into
        # a long tongue and splinters, the butt an old ragged break, three
        # whorls of branch stubs — sideways, since the ones that pointed up
        # snapped off flush and the ones underneath are in the snow.
        r0, r1 = 0.13, 0.095
        rnd = np.random.default_rng(81)
        stubs = []
        for x in (-0.75, -0.05, 0.62, 1.05):
            for k in range(4):
                a = k / 4 * TAU + rnd.uniform(-0.4, 0.4) + x * 2.1
                c = math.cos(a)
                if c < -0.35:
                    continue
                ln = rnd.uniform(0.004, 0.018) if c > 0.45 else rnd.uniform(0.05, 0.13)
                stubs.append((x + rnd.uniform(-0.04, 0.04), a, ln, rnd.uniform(0.02, 0.03), 0.45))
        return dict(seed=301, x0=-half + 0.03, x1=half - 0.27, r0=r0, r1=r1, bow_y=0.012, bow_z=0.16,
                    oval=0.07, bark=0.011, bare=0.5, top_bias=0.7, checks=0.009, stubs=stubs,
                    butt=dict(slant=0.35, phase=1.2, splinters=0.07, rot=0.03),
                    top=dict(slant=0.55, phase=2.0, splinters=0.2, tongue=0.12, tongue_at=0.9, fresh=0.5,
                             splinter_width=0.016, sharp=3.0))
    # A windthrown trunk: thick, most of its bark gone, the root flare with
    # its torn root stubs, one limb standing, the top a long snap.
    r0, r1 = 0.28, 0.21
    x0 = -half + 0.2
    stubs = [
        # the torn roots round the butt: none of them down into the ground
        (x0 + 0.1, 0.3, 0.16, 0.075, -0.3, 0.45),
        (x0 + 0.12, 1.4, 0.30, 0.07, -0.25, 0.45),
        (x0 + 0.08, -1.25, 0.26, 0.068, -0.25, 0.45),
        (x0 + 0.16, 2.0, 0.18, 0.06, -0.2, 0.45),
        (x0 + 0.14, -1.9, 0.2, 0.06, -0.2, 0.45),
        # the limb, standing up off the trunk a little past halfway
        (0.55, 0.12, 0.52, 0.06, 0.5, 0.5),
        # and the stubs of the branches it lost when it fell
        (-0.35, 1.7, 0.14, 0.034, 0.4), (0.15, -1.55, 0.12, 0.03, 0.4), (1.2, 1.2, 0.16, 0.03, 0.45),
        (1.4, -0.8, 0.05, 0.028, 0.4),
    ]
    return dict(seed=401, x0=x0, x1=half - 0.32, r0=r0, r1=r1, bow_y=0.03, bow_z=-0.14, oval=0.08,
                flare=0.42, flare_len=0.3, bark=0.016, bare=0.05, top_bias=1.2, checks=0.02, stubs=stubs,
                butt=dict(slant=0.15, phase=0.0, splinters=0.07, rot=0.02),
                top=dict(slant=0.9, phase=-2.2, splinters=0.2, tongue=0.36, tongue_at=-1.0, fresh=0.25))


# ===========================================================================
# THE STUMP
# ===========================================================================

class Stump:
    """A sawn spruce stump: a trunk swelling into buttress roots at the
    foot, the roots themselves running out under the snow, the cut on top
    stepped at the faller's notch with the hinge torn between, and checked."""

    def __init__(self, seed=505):
        self.seed = seed
        rnd = np.random.default_rng(seed)
        self.r0 = 0.215
        self.cut = 0.47
        self.fall = rnd.uniform(0, TAU)           # the way the tree went
        self.roots = []
        n = 6
        for k in range(n):
            a = k / n * TAU + rnd.uniform(-0.35, 0.35)
            reach = rnd.uniform(0.62, 0.82)
            self.roots.append((a, reach, rnd.uniform(0.10, 0.135)))
        self.checks = [rnd.uniform(0, TAU) for _ in range(7)]

    def polar(self, P):
        rho = np.sqrt(P[:, 0] ** 2 + P[:, 2] ** 2)
        theta = np.arctan2(P[:, 2], P[:, 0])
        return rho, theta

    def body(self, P, fine):
        y = P[:, 1]
        rho, theta = self.polar(P)
        lobes = sum(np.exp(-((np.angle(np.exp(1j * (theta - a)))) / 0.42) ** 2) * (0.30 + 0.25 * (reach - 0.62))
                    for a, reach, _ in self.roots)
        base = np.exp(-np.maximum(y, 0) / 0.11)
        R = self.r0 * (1 + 0.10 * np.exp(-np.maximum(y, 0) / 0.3) + lobes * base)
        if fine:
            R = R * (1 + 0.03 * fbm(theta * 1.4, y / 0.3, 2, self.seed + 1))
            plates = ridged(theta * self.r0 / 0.03, y / 0.16, 3, self.seed + 11, sharp=1.5)
            gone = self.bare(theta, y)
            R = R + 0.014 * (0.3 + 0.7 * plates) * (1 - gone)
        f = rho - R
        for a, reach, rr in self.roots:
            d = np.array([math.cos(a), 0.0, math.sin(a)])
            # thick where it leaves the trunk, diving under the snow
            A = d * self.r0 * 0.6 + np.array([0, 0.2, 0])
            B = d * reach + np.array([0, -0.26, 0])
            dist, t = segment(P, A, B)
            r = rr * (1 - 0.45 * t)
            if fine:
                r = r * (1 + 0.08 * fbm(t * 6, a * 3.0 + dist * 0, 2, self.seed + 21))
            f = smin_k(f, dist - r, 0.07)
        return f, rho, theta

    def bare(self, theta, y):
        m = fbm(theta * 1.5, y / 0.25, 3, self.seed + 3)
        return fk.smoothstep(0.24, 0.30, m) * fk.smoothstep(0.08, 0.2, y)

    def top(self, P, rho, theta, fine):
        """The cut: the back cut level, the notch side lower, the hinge torn
        between them; then weathered — the rim softened and the face checked."""
        d = P[:, 0] * math.cos(self.fall) + P[:, 2] * math.sin(self.fall)
        h = np.full(len(P), self.cut) + 0.012 * np.sin(d * 3.0)
        notch = fk.smoothstep(0.035, 0.05, d)
        h = h - 0.045 * notch
        if fine:
            hinge = 1 - fk.smoothstep(0.012, 0.045, np.abs(d - 0.02))
            across = -P[:, 0] * math.sin(self.fall) + P[:, 2] * math.cos(self.fall)
            spl = ridged(across / 0.018, d / 0.05, 3, self.seed + 41, sharp=2.4)
            h = h + hinge * (0.012 + 0.05 * spl ** 1.4)
            h = h + 0.004 * fbm(P[:, 0] / 0.04, P[:, 2] / 0.04, 2, self.seed + 43)
            for c in self.checks:
                g = np.abs(np.sin((theta - c) * 0.5)) * rho
                h = h - 0.035 * (1 - fk.smoothstep(0.002, 0.007, g)) * fk.smoothstep(0.05, 0.16, rho)
            # the rim weathers back
            h = h - 0.03 * fk.smoothstep(self.r0 * 0.82, self.r0 * 1.05, rho)
        return P[:, 1] - h

    def field_at(self, P, fine):
        f, rho, theta = self.body(P, fine)
        f = np.maximum(f, self.top(P, rho, theta, fine))
        return np.maximum(f, -0.03 - P[:, 1])

    def coarse(self, P):
        return self.field_at(P, False)

    def fine(self, P):
        return self.field_at(P, True) + 0.0015 * fbm3(P / 0.02, 2, self.seed + 51)

    def field(self):
        reach = max(r for _, r, _ in self.roots) + 0.12
        return Field(self.fine, self.coarse, 0.09, (-reach, -0.04, -reach), (reach, self.cut + 0.1, reach))

    def attributes(self, verts):
        f, rho, theta = self.body(verts, True)
        t = self.top(verts, rho, theta, True)
        on_top = fk.smoothstep(-0.006, 0.004, t - f)
        gone = self.bare(theta, verts[:, 1])
        root = 1 - fk.smoothstep(0.08, 0.16, verts[:, 1])
        return {
            'bare': np.maximum(gone, 0.0),
            'endgrain': on_top,
            'fresh': on_top * 0.0,
            'rho': np.clip(rho / self.r0, 0, 1),
            'bark_u': theta * self.r0,
            'bark_v': verts[:, 1] + 0.3 * root * (rho - self.r0),
            'bark_seam': fk.smoothstep(0.82 * math.pi, math.pi, np.abs(theta)),
            'bark_wrap': np.sign(theta) * TAU * self.r0,
            'up': np.ones(len(verts)),
        }


# ===========================================================================
# BRANCHES — swept tubes, which carry their own UVs (around × along)
# ===========================================================================

def tube(path, radii, sides, seam=math.pi, cap=True, jitter=None):
    """A tube along a polyline with per-point radii; returns verts, tris,
    uvs (u around in metres, v along in metres) with the seam duplicated,
    and the per-vertex 'along' parameter."""
    pts = np.asarray(path, dtype=np.float64)
    n = len(pts)
    tang = np.gradient(pts, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    up = np.array([0.0, 1.0, 0.0])
    verts, uvs = [], []
    along = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    prev_side = None
    for i in range(n):
        t = tang[i]
        ref = up if abs(t @ up) < 0.95 else np.array([1.0, 0, 0])
        side = np.cross(t, ref)
        side /= np.linalg.norm(side)
        if prev_side is not None and side @ prev_side < 0:
            side = -side
        prev_side = side
        top = np.cross(side, t)
        circ = TAU * radii[i]
        for k in range(sides + 1):
            a = k / sides * TAU + seam
            r = radii[i] * (jitter[i, k % sides] if jitter is not None else 1.0)
            verts.append(pts[i] + (math.cos(a) * top + math.sin(a) * side) * r)
            uvs.append((k / sides * circ, along[i]))
    faces = []
    w = sides + 1
    for i in range(n - 1):
        for k in range(sides):
            a, b, c, d = i * w + k, i * w + k + 1, (i + 1) * w + k + 1, (i + 1) * w + k
            faces += [(a, b, c), (a, c, d)]
    verts = np.array(verts)
    uvs = np.array(uvs)
    if cap:
        # the snapped tip: a low cone on the last ring
        tip = len(verts)
        verts = np.vstack([verts, pts[-1] + tang[-1] * radii[-1] * 0.6])
        uvs = np.vstack([uvs, [(0.5 * TAU * radii[-1], along[-1] + radii[-1])]])
        base = (n - 1) * w
        for k in range(sides):
            faces.append((base + k, base + k + 1, tip))
    return verts, np.array(faces), uvs


def crooked(rnd, start, direction, length, step, wander, flat=0.3):
    """A path that wanders as wood grows: each step turned a little, more
    in the horizontal than up or down (a spruce spray is nearly flat)."""
    n = max(3, int(round(length / step)))
    d = unit(direction)
    p = np.asarray(start, dtype=np.float64)
    out = [p.copy()]
    for _ in range(n):
        d = unit(d + rnd.normal(0, wander, 3) * np.array([1.0, flat, 1.0]))
        p = p + d * (length / n)
        out.append(p.copy())
    return np.array(out)


def branch_paths(rnd, length, base_r, twigs, wander=0.5):
    """A crooked stem along z and its twigs, alternate and nearly level, each
    snapped short and forking once, as (path, radii, low-poly sides)."""
    path = crooked(rnd, (0.0, base_r, -length / 2), (rnd.normal(0, 0.15), 0.0, 1.0), length, 0.045,
                   0.09 * wander + 0.04, flat=0.25)
    path[:, 1] = np.maximum(path[:, 1], base_r * 0.9)
    t = np.linspace(0, 1, len(path))
    radii = base_r * (1 - 0.7 * t ** 1.2)
    out = [(path, radii, 7)]
    side = rnd.choice((-1, 1))
    for k in range(twigs):
        side = -side
        at = 0.12 + 0.76 * (k + rnd.uniform(0.2, 0.8)) / twigs
        i = int(at * (len(path) - 1))
        tang = unit(path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)])
        lateral = unit(np.cross(tang, [0, 1, 0])) * side
        ang = math.radians(rnd.uniform(40, 65))
        d = unit(tang * math.cos(ang) + lateral * math.sin(ang) + np.array([0, rnd.uniform(-0.05, 0.2), 0]))
        tl = rnd.uniform(0.12, 0.3) * (1.1 - 0.5 * at) * length
        tp = crooked(rnd, path[i], d, tl, 0.04, 0.18, flat=0.4)
        r0 = radii[i] * rnd.uniform(0.45, 0.6)
        tr = r0 * (1 - 0.6 * np.linspace(0, 1, len(tp)))
        out.append((tp, tr, 5))
        if len(tp) > 3 and rnd.random() < 0.75:
            j = rnd.integers(1, len(tp) - 2)
            tt = unit(tp[j + 1] - tp[j - 1])
            lat = unit(np.cross(tt, [0, 1, 0])) * rnd.choice((-1, 1))
            sd = unit(tt * 0.7 + lat * 0.7)
            sp = crooked(rnd, tp[j], sd, tl * rnd.uniform(0.3, 0.55), 0.035, 0.2, flat=0.4)
            out.append((sp, tr[j] * 0.75 * (1 - 0.5 * np.linspace(0, 1, len(sp))), 4))
    return out


BRANCHES = [
    dict(name='branch_a', length=1.28, r=0.026, twigs=6, seed=11, wander=0.8),
    dict(name='branch_b', length=1.02, r=0.019, twigs=4, seed=23, wander=0.7),
    dict(name='branch_c', length=0.76, r=0.022, twigs=3, seed=37, wander=0.9),
]


def build_branch(i, col, high_sides=12):
    b = BRANCHES[i]
    rnd = np.random.default_rng(b['seed'])
    parts = branch_paths(rnd, b['length'], b['r'], b['twigs'], b.get('wander', 0.6))
    hv, ht, hu, lv, lt, lu = [], [], [], [], [], []
    attrs = {'bare': [], 'endgrain': [], 'fresh': [], 'rho': [], 'bark_u': [], 'bark_v': [],
             'bark_seam': [], 'bark_wrap': [], 'up': []}
    for k, (path, radii, low_sides) in enumerate(parts):
        # high: dense, its bark knobbly
        jit = 1 + 0.12 * rnd.normal(0, 1, (len(path), high_sides)).clip(-2, 2) * 0.5
        v, t, uv = tube(path, radii, high_sides, jitter=jit)
        ht.append(t + sum(len(x) for x in hv))
        hv.append(v)
        hu.append(uv)
        attrs['bare'].append(np.zeros(len(v)))
        attrs['endgrain'].append(np.zeros(len(v)))
        attrs['fresh'].append(np.zeros(len(v)))
        attrs['rho'].append(np.ones(len(v)))
        attrs['bark_u'].append(uv[:, 0])
        attrs['bark_v'].append(uv[:, 1])
        attrs['bark_seam'].append(np.zeros(len(v)))
        attrs['bark_wrap'].append(np.zeros(len(v)))
        attrs['up'].append(np.zeros(len(v)))
        # low: few sides, every other ring on the twigs
        stride = 1 if k == 0 else 2
        keep = np.unique(np.concatenate([np.arange(0, len(path), stride), [len(path) - 1]]))
        v, t, uv = tube(path[keep], radii[keep], low_sides)
        lt.append(t + sum(len(x) for x in lv))
        lv.append(v)
        lu.append(uv)
    high = fk.mesh_object(b['name'] + '_high', np.vstack(hv), np.vstack(ht), col,
                          {k_: np.concatenate(v_) for k_, v_ in attrs.items()})
    low = fk.mesh_object(b['name'], np.vstack(lv), np.vstack(lt), col)
    set_uvs(low, np.vstack(lu))
    return high, low


def set_uvs(ob, per_vertex):
    me = ob.data
    layer = me.uv_layers.new(name='UVMap')
    idx = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', idx)
    layer.data.foreach_set('uv', per_vertex[idx].astype(np.float32).ravel())


# ===========================================================================
# THE SURFACE
# ===========================================================================

BARK_DARK = lin('#2e241d')
GREY_WOOD = lin('#736d64')     # spruce wood after a few winters in the open
TAN_WOOD = lin('#94744f')      # where the bark came away this year
END_OLD = lin('#5b534a')
END_FRESH = lin('#a07648')
HYPOGYMNIA = lin('#8d9384')    # the grey-green leafy lichen on every dead branch
LETHARIA = lin('#b8c23a')      # wolf lichen, sulphur-yellow on old conifer wood
MOSS = lin('#4d5a1e')


def wood_material(name, style):
    """The albedo of deadwood, as an emission shader for the bake: the bark
    photograph mapped round the trunk (around × along, its seam blended on
    the underside), silver-grey grained wood where the bark has gone, the
    end grain's rings and the lichen and moss."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    g = fk.Graph(mat)
    P = g.coords()
    N = g.normal()
    _, ny, _ = g.sep(N)
    bare = g.attr('bare')
    endg = g.attr('endgrain')
    fresh = g.attr('fresh')
    rho = g.attr('rho')
    bu = g.attr('bark_u')
    bv = g.attr('bark_v')
    seam = g.attr('bark_seam')
    wrap = g.attr('bark_wrap')
    tile = style.get('tile', 0.42)
    photo = os.path.join(TEXTURES, 'tree', 'tree-bark.jpg')
    v1 = g.combine(g.mul(bu, 1 / tile), g.mul(bv, 1 / tile), 0.0)
    v2 = g.combine(g.mul(g.sub(bu, wrap), 1 / tile), g.mul(bv, 1 / tile), 0.0)
    bark = g.mix(g.mul(seam, 0.5), g.image(photo, v1), g.image(photo, v2))
    # old bark on a dead tree goes grey and loses the red of its flakes
    grey = g.lum(bark)
    bark = g.mix(style.get('grey_bark', 0.35), bark, g.combine(grey, grey, grey))
    bark = g.cmul(bark, style.get('bark_tint', (0.95, 0.92, 0.9)))
    bark = g.mix(g.mul(g.smooth(0.4, 0.75, g.noise(P, 3.0, 3, 0.5)), 0.4), bark, g.cmul(bark, BARK_DARK))

    # The wood under it, silvered by the weather: long streaks along the
    # grain, the fine lines of the growth rings where the soft earlywood has
    # worn back between them, checks opening along the grain, and the brown
    # of rot where the water sits.
    # The grain is the hut planks' photograph (assets/textures/huts) laid
    # along the trunk: its knots, its worn grain and — the gaps between its
    # planks — dark checks running with the grain. It is drained to a
    # silver grey, keeping a little of its brown.
    wtile = style.get('wood_tile', 1.1)
    planks = os.path.join(TEXTURES, 'huts', 'alpine-wood-planks.jpg')
    wphoto = g.image(planks, g.combine(g.mul(bv, 1 / wtile), g.mul(bu, 1 / wtile), 0.0))
    wl = g.lum(wphoto)
    wood = g.mix(g.remap(wl, 0.015, 0.16), g.cmul(GREY_WOOD, (0.40, 0.37, 0.34)), g.cmul(GREY_WOOD, (1.12, 1.1, 1.06)))
    streak_p = g.combine(g.mul(bu, 14.0), g.mul(bv, 0.9), 0.0)
    streak = g.noise(streak_p, 1.0, 5, 0.62)
    wood = g.cmul(wood, g.mix(g.remap(streak, 0.28, 0.72), (0.86, 0.86, 0.86), (1.08, 1.07, 1.05)))
    check_p = g.combine(g.mul(bu, 22.0), g.mul(bv, 0.45), 0.0)
    chk = g.node('ShaderNodeTexNoise', noise_dimensions='3D')
    try:
        chk.noise_type = 'RIDGED_MULTIFRACTAL'
    except Exception:
        pass
    g.set(chk.inputs['Vector'], check_p)
    g.set(chk.inputs['Scale'], 1.0)
    g.set(chk.inputs['Detail'], 3.0)
    checks = g.smooth(0.82, 0.95, chk.outputs['Fac'])
    wood = g.mix(g.mul(checks, style.get('check_dark', 0.85)), wood, lin('#2a2520'))
    rot = g.mul(g.smooth(0.55, 0.72, g.noise(P, 1.6, 4, 0.6)), style.get('rot', 0.4))
    wood = g.mix(rot, wood, g.cmul(wood, lin('#9a7e5e')))
    wood = g.mix(g.mul(g.smooth(0.6, 0.8, g.noise(P, 2.0, 3, 0.5)), style.get('tan', 0.25)), wood, TAN_WOOD)
    wood = g.cmul(wood, g.mix(g.noise(P, 0.8, 3, 0.5), (0.82, 0.82, 0.82), (1.08, 1.08, 1.06)))
    # the bark's broken edge throws a dark line onto the wood
    col = g.mix(bare, bark, wood)

    # end grain: rings round the pith, checks radiating out
    rings = g.math('SINE', g.add(g.mul(rho, TAU * style.get('rings', 28)),
                                 g.mul(g.noise(P, 8.0, 2, 0.5), 3.0)))
    rings = g.remap(rings, -1.0, 1.0, 0.82, 1.08)
    endc = g.mix(fresh, END_OLD, END_FRESH)
    endc = g.cmul(endc, g.combine(rings, rings, rings))
    endc = g.mix(g.mul(g.smooth(0.8, 1.0, rho), 0.5), endc, g.cmul(endc, (0.7, 0.66, 0.62)))
    col = g.mix(endg, col, endc)

    # lichen on the bark and the old wood, moss where it stays damp
    li = g.smooth(0.56, 0.66, g.noise(g.vmath('SCALE', P, scale=1.0), style.get('lichen_scale', 7.0), 4, 0.6))
    li = g.mul(li, style.get('lichen', 0.5))
    li = g.mul(li, g.sub(1.0, endg))
    col = g.mix(li, col, g.mix(g.noise(P, 40.0, 2, 0.5), HYPOGYMNIA, g.cmul(HYPOGYMNIA, (0.8, 0.85, 0.75))))
    wolf = g.mul(g.smooth(0.70, 0.76, g.noise(P, 9.0, 3, 0.5)), style.get('wolf', 0.0))
    col = g.mix(g.mul(wolf, g.mul(bare, g.sub(1.0, endg))), col, LETHARIA)
    moss = g.mul(g.smooth(0.58, 0.68, g.noise(P, 4.0, 4, 0.6)), style.get('moss', 0.0))
    moss = g.mul(moss, g.smooth(-0.3, 0.5, ny))
    col = g.mix(moss, col, g.cmul(MOSS, g.mix(g.noise(P, 30.0, 2, 0.5), (0.7, 0.7, 0.7), (1.2, 1.2, 1.2))))

    ao = g.ao(style.get('ao', 0.12), 16)
    occl = g.add(0.2, g.mul(g.math('POWER', ao, 1.2), 0.8))
    col = g.cmul(col, g.combine(occl, occl, occl))
    g.emit(col)
    return mat


WOOD_STYLE = {
    'stump': dict(tile=0.40, rings=26, lichen=0.2, moss=0.45, tan=0.1, grey_bark=0.45),
    'log_fallen': dict(tile=0.34, rings=18, lichen=0.25, moss=0.2, tan=0.25, wolf=0.0, grey_bark=0.35),
    'log_windthrow': dict(tile=0.46, rings=34, lichen=0.22, moss=0.3, tan=0.1, wolf=0.6, grey_bark=0.45,
                          ao=0.2, rot=0.55),
    'branch': dict(tile=0.16, lichen=0.5, lichen_scale=14.0, grey_bark=0.55, bark_tint=(0.9, 0.88, 0.86),
                   ao=0.05),
}


# ===========================================================================
# From field to file.
# ===========================================================================

def ground(low, high, centre_x=True):
    """Stand the drawn surface on y = 0, centred in x and z (in Blender's
    space here, z up), and move the high surface with it."""
    v = vertices(low)
    lo, hi = v.min(0), v.max(0)
    c = (lo + hi) / 2
    for ob in (low, high):
        w = vertices(ob)
        if centre_x:
            w[:, 0] -= c[0]
        w[:, 1] -= c[1]
        w[:, 2] -= lo[2]
        ob.data.vertices.foreach_set('co', w.ravel())
        ob.data.update()
    v = vertices(low)
    return v.max(0) - v.min(0)


def build_deadwood(out_dir, preview_dir=None, tmp=None, atlas=2048, samples=32, quality=80):
    col = collection('deadwood')
    clear_collection(col)
    pairs = []
    wrapped = []
    sinks = {}

    t = time.time()
    stump = Stump()
    v, f = fk.mesh_field(stump.field(), 0.006, log=log)
    high = fk.mesh_object('stump_high', v, f, col, stump.attributes(v))
    high.data.shade_smooth()
    high.data.materials.append(wood_material('wood_stump', WOOD_STYLE['stump']))
    low = fk.decimated(high, 'stump', 1750, col, voxel=0.005)
    size = ground(low, high)
    assert fk.is_closed(low), 'stump is not a closed solid'
    log(f'stump: {tris(low)} triangles, {size.round(3)} m, {time.time() - t:.0f}s')
    sinks['stump'] = 0.06 * size[2]
    pairs.append((high, low))

    for i, L in enumerate(LOGS):
        t = time.time()
        lg = Log(log_spec(i))
        v, f = fk.mesh_field(lg.field(), 0.006 if i == 0 else 0.009, log=log)
        high = fk.mesh_object(L['name'] + '_high', v, f, col, lg.attributes(v))
        high.data.shade_smooth()
        high.data.materials.append(wood_material('wood_' + L['name'], WOOD_STYLE[L['name']]))
        low = fk.decimated(high, L['name'], 2450, col, voxel=0.006 if i == 0 else 0.008)
        size = ground(low, high)
        assert fk.is_closed(low), L['name'] + ' is not a closed solid'
        low['length'] = round(float(size[0]), 3)
        low['height'] = round(float(size[2]), 3)
        low['radius'] = L['radius']
        log(f"{L['name']}: {tris(low)} triangles, {size.round(3)} m, {time.time() - t:.0f}s")
        sinks[L['name']] = 0.3 * size[2]
        pairs.append((high, low))

    branch_mat = wood_material('wood_branch', WOOD_STYLE['branch'])
    for i, b in enumerate(BRANCHES):
        high, low = build_branch(i, col)
        high.data.shade_smooth()
        high.data.materials.append(branch_mat)
        ground(low, high)
        log(f"{b['name']}: {tris(low)} triangles")
        wrapped.append(low)
        pairs.append((high, low))

    lows = [lw for _, lw in pairs]
    fk.unwrap(lows, wrapped=wrapped)
    for low in lows:
        if low.name in sinks:
            cut = sinks[low.name]
            centres = {p.index: p.center.z for p in low.data.polygons}
            fk.scale_uv_islands(low, lambda fc: 0.4 if centres[fc.index] < cut else 1.0)
    fk.repack(lows)
    texture = os.path.join(tmp or bpy.app.tempdir, 'alpine-deadwood.webp')
    t = time.time()
    rgb, _ = fk.bake_atlas(pairs, atlas, samples, 0.012, 0.04)
    log(f'  baked {atlas} atlas in {time.time() - t:.0f}s')
    log(f'  {os.path.basename(texture)}: {fk.save_webp(texture, rgb, quality) / 1024:.0f} KB')
    fk.dress(lows, texture, 'alpineDeadwood')
    for low in lows:
        fk.finish_normals(low, 60)
    for high, _ in pairs:
        high.hide_render = True
        high.hide_set(True)
    path = os.path.join(out_dir, 'alpine-deadwood.glb')
    log(f'wrote {path}: {fk.export_glb(lows, path) / 1024:.0f} KB')
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        for low in lows[:3]:
            fk.portrait(low, os.path.join(preview_dir, low.name + '.png'), sink=sinks[low.name] * 0.6)
        for k, low in enumerate(lows[3:]):
            low.location.x = (k - 1) * 0.5
        fk.portrait(lows[3:], os.path.join(preview_dir, 'branches.png'), sink=0.01, elev=0.5)
        for low in lows[3:]:
            low.location.x = 0
    return lows


def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    import tempfile
    tmp = tempfile.mkdtemp(prefix='alpen-deadwood-')
    out = args[args.index('--out') + 1] if '--out' in args else tmp
    preview_dir = args[args.index('--preview') + 1] if '--preview' in args else None
    build_deadwood(out, preview_dir, tmp)


if __name__ == '__main__' and '--' in sys.argv:
    main()
