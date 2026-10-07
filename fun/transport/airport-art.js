import { drawAirportBuilding } from './airport-building-art.js';
import { worldArtRevision } from './atlas-runtime.js';
import { featureWorldPixels, SPRITE_SCALE } from './sprite-art-direction.js';

// Painted airport components retain separate anchors for depth sorting.
// Runways, aircraft and unavailable-art fallbacks remain native canvas geometry.
// Units: "projected px" are the renderer's zoom-1 world units (a tile diamond
// is 64 × 32; one height level is 24). Flat ground is painted in square world px (32 per tile) and receives the
// terrain mesh projection exactly once, like roads and rails. Upright drawing is synchronous; BIOME is set per call.
export const TILE = 32, HEIGHT_STEP = 24;
export const HEADING_BUCKETS = 48;
const TAU = Math.PI * 2;
// World tile delta → projected px (zoom 1).
export const iso = (dx, dy) => ({ x: (dx - dy) * TILE, y: (dx + dy) * TILE / 2 });
const PALETTES = {
  taiga: { field: '#8fa56a', mown: '#a4b87a', verge: '#7c945a', apron: '#a5a497', joint: '#8d8c80', asphalt: '#5f625c', asphaltLight: '#6d7069' },
  tundra: { field: '#b4bcaa', mown: '#c8cebd', verge: '#a2ab98', apron: '#aeb0aa', joint: '#94978f', asphalt: '#5d6262', asphaltLight: '#6b706f' },
  desert: { field: '#cdb383', mown: '#dcc596', verge: '#bba272', apron: '#bcb096', joint: '#a69a80', asphalt: '#66625a', asphaltLight: '#75706a' },
};
const LIVERY = { body: '#f3efe3', bodyShade: '#cfc9b8', belly: '#8f8a78', line: '#24473a', fin: '#d8743f', wing: '#e2ded1', wingShade: '#a9a494', engine: '#d3d4cb', engineDark: '#6d716b', intake: '#232a28', glass: '#1b2e36' };
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917); s ^= s >>> 16; return (s >>> 0) / 4294967296; }; }
// Airport layout: local u along the runway 0–6, v across 0–2; v 1–2 is the runway row (nearer the camera).
export const LAYOUT = {
  length: 6,
  runway: { u0: .15, u1: 5.85, v0: 1.24, v1: 1.76 },
  apron: { u0: 1.72, u1: 4.28, v0: .1, v1: .94 },
  stands: [{ u: 2.45, v: .52 }, { u: 3.55, v: .52 }],
  taxiways: [{ u: 2.1 }, { u: 3.9 }],
  tower: { u: .3, v: .46, size: .3 },
  terminal: { u0: .56, u1: 1.62, v0: .12, v1: .8 },
  hangar: { u0: 4.44, u1: 5.04, v0: .1, v1: .76 },
  depot: { u: 5.5, v: .42 },
  masts: [{ u: 1.8, v: .1 }, { u: 4.24, v: .1 }],
  windsock: { u: 5.74, v: 1.06 },
};
// Local (u, v) → world tile offset from the anchor for each runway axis.
export const localToWorld = (axis, u, v) => axis === 'y' ? { x: v, y: u } : { x: u, y: v };
export const localToProjected = (axis, u, v, h = 0) => { const w = localToWorld(axis, u, v), p = iso(w.x, w.y); return { x: p.x, y: p.y - h }; };

// Ground (flat world px; caller translates to the anchor tile's north-west corner).
export function paintAirportGround(c, { axis = 'x', biome = 'taiga', detail = 'town', seed = 1 } = {}) {
  const P = PALETTES[biome] || PALETTES.taiga, region = detail === 'region';
  c.save();
  if (axis === 'y') c.transform(0, 1, 1, 0, 0, 0); // swap u/v into world x/y
  c.scale(TILE, TILE);
  const rrect = (u0, v0, u1, v1, r, color) => { c.fillStyle = color; c.beginPath(); c.roundRect(u0, v0, u1 - u0, v1 - v0, r); c.fill(); };
  const R = rng(seed);
  // Bare airfield meadow is supplied by the world's textured terrain.
  // Only constructed surfaces belong to this ground layer.
  const { runway: r, apron: a } = LAYOUT;
  for (const t of LAYOUT.taxiways) { rrect(t.u - .13, a.v1 - .06, t.u + .13, r.v0 + .04, .04, P.asphaltLight); }
  rrect(a.u0, a.v0, a.u1, a.v1, .05, P.apron);
  c.globalAlpha = .6; c.strokeStyle = P.joint; c.lineWidth = region ? .02 : .012;
  if (!region) { c.beginPath(); for (let u = a.u0 + .38; u < a.u1 - .1; u += .38) { c.moveTo(u, a.v0 + .02); c.lineTo(u, a.v1 - .02); } for (let v = a.v0 + .27; v < a.v1 - .1; v += .27) { c.moveTo(a.u0 + .02, v); c.lineTo(a.u1 - .02, v); } c.stroke(); }
  c.globalAlpha = 1;
  for (let n = 0; n < (region ? 6 : 22); n++) { c.globalAlpha = .05 + R() * .07; c.fillStyle = R() < .5 ? '#6f6d62' : '#d9d5c4'; c.beginPath(); c.ellipse(a.u0 + .1 + R() * (a.u1 - a.u0 - .2), a.v0 + .08 + R() * (a.v1 - a.v0 - .16), .05 + R() * .12, .03 + R() * .06, 0, 0, TAU); c.fill(); }
  c.globalAlpha = 1;
  rrect(.5, .05, 1.72, .14, .03, P.apron); // terminal forecourt
  c.strokeStyle = '#d7b44c'; c.lineWidth = region ? .035 : .022; c.lineCap = 'round';
  for (const t of LAYOUT.taxiways) { c.beginPath(); c.moveTo(t.u, a.v1 - .1); c.lineTo(t.u, r.v0 + .12); c.stroke(); }
  c.beginPath(); c.moveTo(a.u0 + .12, .52); c.lineTo(a.u1 - .1, .52); c.stroke();
  if (!region) for (const s of LAYOUT.stands) { c.beginPath(); c.moveTo(s.u - .42, .38); c.lineTo(s.u - .42, .66); c.stroke(); c.globalAlpha = .7; c.beginPath(); c.arc(s.u, .52, .3, Math.PI * .75, Math.PI * 1.25); c.stroke(); c.globalAlpha = 1; }
  rrect(r.u0, r.v0, r.u1, r.v1, .03, P.asphalt);
  if (!region) for (let n = 0; n < 60; n++) { c.globalAlpha = .06 + R() * .08; c.fillStyle = R() < .6 ? '#4b4e49' : '#8a8b83'; c.fillRect(r.u0 + R() * (r.u1 - r.u0), r.v0 + R() * (r.v1 - r.v0), .03 + R() * .08, .008 + R() * .012); }
  c.globalAlpha = region ? .12 : .22; c.fillStyle = '#3d3f3b';
  for (const u0 of [.72, 4.28]) for (let n = 0; n < 5; n++) c.fillRect(u0 + n * .16, 1.39 + (n % 2) * .06, .5, .025), c.fillRect(u0 + n * .16 + .05, 1.55 - (n % 2) * .05, .44, .02);
  c.globalAlpha = 1;
  const white = '#f0ecdb';
  c.fillStyle = white;
  c.fillRect(r.u0 + .03, r.v0 + .025, r.u1 - r.u0 - .06, region ? .03 : .018); c.fillRect(r.u0 + .03, r.v1 - .025 - (region ? .03 : .018), r.u1 - r.u0 - .06, region ? .03 : .018);
  for (const u0 of [r.u0 + .07, r.u1 - .31]) for (let n = 0; n < 6; n++) c.fillRect(u0, r.v0 + .07 + n * .068, .24, .04);
  if (!region) for (const u0 of [1.1, 4.58]) { c.fillRect(u0, 1.33, .32, .07); c.fillRect(u0, 1.6, .32, .07); }
  const dash = region ? [.3, .2] : [.2, .13];
  for (let u = .68; u < 5.32; u += dash[0] + dash[1]) c.fillRect(u, 1.49, Math.min(dash[0], 5.32 - u), region ? .03 : .02);
  if (!region) { c.strokeStyle = white; c.lineWidth = .015; c.beginPath(); c.arc(LAYOUT.windsock.u, LAYOUT.windsock.v, .09, 0, TAU); c.stroke(); }
  c.restore();
}

// Upright art (projected px; origin = anchor tile's north corner at site height). Painterly treatment: faces carry a
// sky-to-ground gradient and seeded grain, walls darken where they meet the ground, silhouettes get a thin warm-dark
// outline, and a soft cast shadow falls down-right like the trees' north-west light.
const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function polygon(c, points, fill) { c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } }
const SHADOW = { x: .43, y: .21 }; // ground displacement per px of height (screen), matching tree shadows' (1, .48)
function hull(points) {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y), cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), lower = [], upper = [];
  for (const q of p) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// World-aligned block from local extents; returns its faces and wall parametrisations.
function block(axis, u0, v0, u1, v1, base, h) {
  const a = localToWorld(axis, u0, v0), b = localToWorld(axis, u1, v1);
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const W = (x, y, z) => { const p = iso(x, y); return { x: p.x, y: p.y - z }; };
  return { x0, x1, y0, y1, base, h, W,
    left: [W(x0, y1, base), W(x1, y1, base), W(x1, y1, base + h), W(x0, y1, base + h)],   // faces +y: lit
    right: [W(x1, y0, base), W(x1, y1, base), W(x1, y1, base + h), W(x1, y0, base + h)],  // faces +x: shade
    top: [W(x0, y0, base + h), W(x1, y0, base + h), W(x1, y1, base + h), W(x0, y1, base + h)],
    air: (f, z) => axis === 'y' ? W(x1, y0 + (y1 - y0) * f, base + z) : W(x0 + (x1 - x0) * f, y1, base + z), // runway-facing wall
    end: (f, z) => axis === 'y' ? W(x0 + (x1 - x0) * f, y1, base + z) : W(x1, y0 + (y1 - y0) * f, base + z),
    airLit: axis !== 'y' };
}
function castShadow(c, blk, strength = .2) {
  const { x0, x1, y0, y1, h, base, W } = blk, top = base + h, pts = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const g = W(x, y, 0); pts.push(g, { x: g.x + top * SHADOW.x, y: g.y + top * SHADOW.y }); }
  c.save(); c.globalAlpha = Math.min(.34, strength * 1.6); polygon(c, hull(pts), '#1f2c22'); c.restore();
}
function grain(c, pts, seed, amount, detail) {
  if (detail === 'region' || !amount) return;
  const R = rng(seed); let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of pts) { left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); }
  c.save(); polygon(c, pts); c.clip();
  const n = Math.min(240, Math.round((right - left) * (bottom - top) * amount * (detail === 'detail' ? .24 : .13)));
  for (let k = 0; k < n; k++) { c.globalAlpha = .05 + R() * .08; c.fillStyle = R() < .6 ? '#3d392c' : '#fffaf0'; c.fillRect(left + R() * (right - left), top + R() * (bottom - top), .5 + R() * 1.1, .4 + R() * .6); }
  c.restore();
}
function paintFace(c, pts, color, { seed = 1, detail = 'town', grain: amount = 1, vertical = true, ao = true } = {}) {
  const topY = Math.min(...pts.map(p => p.y)), bottomY = Math.max(...pts.map(p => p.y));
  const g = c.createLinearGradient(0, topY, 0, bottomY);
  g.addColorStop(0, mix(color, '#fffdf2', vertical ? .08 : .03)); g.addColorStop(.62, color); g.addColorStop(1, mix(color, '#3f3d31', vertical && ao ? .36 : .1));
  polygon(c, pts, g); grain(c, pts, seed, amount, detail);
}
function outline(c, pts, detail, alpha = .8) { c.save(); c.globalAlpha = detail === 'region' ? alpha * .6 : alpha; c.strokeStyle = '#2e2a20'; c.lineWidth = detail === 'detail' ? .55 : detail === 'region' ? 1 : .75; polygon(c, pts); c.stroke(); c.restore(); }
// Tundra roofs carry snow like its houses; desert walls warm toward sandstone.
let BIOME = 'taiga';
const roofTone = color => BIOME === 'tundra' ? mix(color, '#f3f5f1', .72) : color;
const wallTone = color => BIOME === 'desert' ? mix(color, '#f0d9b0', .35) : color;
function paintBlock(c, blk, { wall, shade, roof, seed = 1, detail = 'town', edge = true }) {
  wall = wallTone(wall); shade = shade && mix(wallTone(shade), '#4f4a3b', .22); roof = mix(roofTone(roof), '#5e5a4a', .12);
  paintFace(c, blk.right, shade || mix(wall, '#4f4a3b', .34), { seed: seed + 1, detail });
  paintFace(c, blk.left, wall, { seed: seed + 2, detail });
  paintFace(c, blk.top, roof, { seed: seed + 3, detail, vertical: false, grain: 1.6 });
  if (edge && detail !== 'region') { c.save(); c.strokeStyle = '#fffbee'; c.globalAlpha = .7; c.lineWidth = detail === 'detail' ? .5 : .7; const [a, b, d] = [blk.top[3], blk.top[2], blk.top[1]]; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.stroke(); c.restore(); }
  outline(c, hull([...blk.left, ...blk.right, ...blk.top]), detail);
}
function strip(c, blk, which, f0, f1, z0, z1, fill) { const w = blk[which]; polygon(c, [w(f0, z0), w(f1, z0), w(f1, z1), w(f0, z1)], fill); }
// Warm brick base courses: a painted band with mortar lines and a few darker bricks, like the houses' masonry.
function brick(c, blk, which, f0, f1, z0, z1, { lit = true, detail = 'town', seed = 1 } = {}) {
  const w = blk[which], base = lit ? '#a2604a' : '#7f4a3a';
  strip(c, blk, which, f0, f1, z0, z1, base);
  if (detail === 'region') return;
  c.save(); polygon(c, [w(f0, z0), w(f1, z0), w(f1, z1), w(f0, z1)]); c.clip();
  const R = rng(seed), rows = Math.max(2, Math.round((z1 - z0) / 1.4)), len = Math.hypot(w(f1, z0).x - w(f0, z0).x, w(f1, z0).y - w(f0, z0).y), cols = Math.max(4, Math.round(len / 2.6));
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { if (R() > .22) continue; const a = f0 + (f1 - f0) * (k + (r % 2) * .5) / cols, b = a + (f1 - f0) / cols, za = z0 + (z1 - z0) * r / rows, zb = za + (z1 - z0) / rows; polygon(c, [w(a, za), w(b, za), w(b, zb), w(a, zb)], R() < .5 ? '#8a4e3b' : '#b8745a'); }
  c.strokeStyle = '#e3d3b8'; c.globalAlpha = .45; c.lineWidth = detail === 'detail' ? .3 : .4; c.beginPath();
  for (let r = 1; r < rows; r++) { const z = z0 + (z1 - z0) * r / rows, a = w(f0, z), b = w(f1, z); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
  c.stroke(); c.restore();
}
function glazing(c, blk, which, f0, f1, z0, z1, { lit, detail, panes = 8, seed = 1 }) {
  const w = blk[which], top = w((f0 + f1) / 2, z1), bottom = w((f0 + f1) / 2, z0);
  const g = c.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
  g.addColorStop(0, lit ? '#7fa7a4' : '#5d8381'); g.addColorStop(.45, lit ? '#3c666c' : '#2f5056'); g.addColorStop(1, lit ? '#1f363b' : '#1a2f34');
  strip(c, blk, which, f0, f1, z0, z1, g);
  if (detail === 'region') return;
  c.save(); polygon(c, [w(f0, z0), w(f1, z0), w(f1, z1), w(f0, z1)]); c.clip();
  const R = rng(seed); c.globalAlpha = .28;
  for (let k = 0; k < 3; k++) { const f = f0 + (f1 - f0) * (.15 + R() * .7), d = (f1 - f0) * .04; polygon(c, [w(f, z0), w(f + d, z0), w(f + d * 3, z1), w(f + d * 2, z1)], '#e9f6f0'); }
  c.restore();
  polygon(c, [w(f0, z0 - .7), w(f1, z0 - .7), w(f1, z0), w(f0, z0)], '#2e2a20'); c.save(); c.strokeStyle = '#e9e1c8'; c.globalAlpha = .75; c.lineWidth = detail === 'detail' ? .45 : .6; c.beginPath();
  for (let k = 0; k <= panes; k++) { const f = f0 + (f1 - f0) * k / panes, a = w(f, z0), b = w(f, z1); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
  const m0 = w(f0, (z0 + z1) * .55), m1 = w(f1, (z0 + z1) * .55); c.moveTo(m0.x, m0.y); c.lineTo(m1.x, m1.y);
  c.stroke(); c.restore();
}
function shrub(c, axis, u, v, r = 3.2, detail = 'town', seed = 1) {
  const p = localToProjected(axis, u, v, 0), R = rng(seed), s = detail === 'region' ? 1.1 : 1;
  c.save(); c.globalAlpha = .22; c.fillStyle = '#243322'; c.beginPath(); c.ellipse(p.x + r * .6, p.y + r * .25, r * 1.2, r * .5, 0, 0, TAU); c.fill(); c.restore();
  const dab = (dx, dy, rr, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(p.x + dx, p.y - r * .7 + dy, rr * s, rr * .86 * s, 0, 0, TAU); c.fill(); };
  dab(0, 0, r, '#2c4428'); dab(-r * .3, -r * .25, r * .72, '#46663a'); if (detail !== 'region') { for (let k = 0; k < 4; k++) dab(-r * .5 + R() * r * .6, -r * .6 + R() * r * .5, r * .28, R() < .5 ? '#7a9a52' : '#8aa860'); }
}
function railing(c, from, to, detail, color = '#3b463f') {
  if (detail === 'region') return;
  c.save(); c.strokeStyle = color; c.lineWidth = detail === 'detail' ? .35 : .5; c.beginPath(); c.moveTo(from.x, from.y - 2.2); c.lineTo(to.x, to.y - 2.2);
  const n = Math.max(2, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 2.2));
  for (let k = 0; k <= n; k++) { const x = from.x + (to.x - from.x) * k / n, y = from.y + (to.y - from.y) * k / n; c.moveTo(x, y); c.lineTo(x, y - 2.2); }
  c.stroke(); c.restore();
}
export function drawTower(c, { axis = 'x', detail = 'town', biome = 'taiga' } = {}) {
  const transform = c.getTransform();
  if (drawAirportBuilding(c, 'tower', { axis, pixelScale: Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d)) })) return;
  BIOME = biome;
  const t = LAYOUT.tower, region = detail === 'region';
  const plinth = block(axis, t.u - .17, t.v - .17, t.u + .17, t.v + .17, 0, 6);
  const shaft = block(axis, t.u - .095, t.v - .095, t.u + .095, t.v + .095, 6, 41);
  const balcony = block(axis, t.u - .19, t.v - .19, t.u + .19, t.v + .19, 47, 2);
  const cab = block(axis, t.u - .155, t.v - .155, t.u + .155, t.v + .155, 49, 9);
  const roof = block(axis, t.u - .2, t.v - .2, t.u + .2, t.v + .2, 58, 2.6);
  castShadow(c, roof, .12); castShadow(c, plinth, .2);
  paintBlock(c, plinth, { wall: '#a2604a', shade: '#7f4a3a', roof: '#cbc1a7', seed: 11, detail });
  paintBlock(c, shaft, { wall: '#f0e7cf', shade: '#c9bea4', roof: '#e0d7bf', seed: 12, detail, edge: false });
  if (!region) {
    c.save(); c.globalAlpha = .18; c.strokeStyle = '#6f6852'; c.lineWidth = .5; c.beginPath();
    for (let z = 14; z < 46; z += 8) for (const f of [shaft.left, shaft.right]) { c.moveTo(f[0].x, f[0].y - (z - 6)); c.lineTo(f[1].x, f[1].y - (z - 6)); }
    c.stroke(); c.restore();
    for (let z = 16; z < 44; z += 8) { const p = shaft.air(.5, z - 6); c.fillStyle = shaft.airLit ? '#5d8388' : '#48696d'; c.fillRect(p.x - .7, p.y - 2.2, 1.4, 2.2); }
  }
  paintBlock(c, balcony, { wall: '#d9d0b8', shade: '#aaa18a', roof: '#c7bea6', seed: 13, detail });
  glazing(c, cab, 'air', 0, 1, 0, 9, { lit: cab.airLit, detail, panes: 3, seed: 14 });
  glazing(c, cab, 'end', 0, 1, 0, 9, { lit: !cab.airLit, detail, panes: 3, seed: 15 });
  outline(c, hull([...cab.left, ...cab.right, ...cab.top]), detail, .5);
  railing(c, balcony.left[3], balcony.left[2], detail); railing(c, balcony.right[2], balcony.right[3], detail);
  paintBlock(c, roof, { wall: '#4d5a52', shade: '#3a453f', roof: '#5f6d64', seed: 16, detail });
  const top = localToProjected(axis, t.u, t.v, 60.6);
  c.strokeStyle = '#3f4a44'; c.lineWidth = region ? 1.2 : .7; c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(top.x, top.y - 9);
  if (!region) { c.moveTo(top.x - 2.5, top.y - 5); c.lineTo(top.x + 2.5, top.y - 5); }
  c.stroke();
  c.fillStyle = '#c85b44'; c.beginPath(); c.arc(top.x, top.y - 9.5, region ? 1.4 : 1.1, 0, TAU); c.fill();
}
export function drawTerminal(c, { axis = 'x', detail = 'town', biome = 'taiga' } = {}) {
  const t = c.getTransform();
  if (drawAirportBuilding(c, 'terminal', { axis, pixelScale: Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) })) return;
  BIOME = biome;
  const T = LAYOUT.terminal, region = detail === 'region', fine = detail === 'detail';
  const wing = block(axis, T.u0, T.v0, T.u1, T.v1, 0, 14);
  const hall = block(axis, T.u0 + .3, T.v0 + .06, T.u0 + .82, T.v1 - .04, 0, 22);
  castShadow(c, hall, .16); castShadow(c, wing, .18);
  shrub(c, axis, T.u0 - .06, T.v1 - .05, 3.4, detail, 3); shrub(c, axis, T.u0 - .03, T.v0 + .22, 3, detail, 4);
  for (let k = 0; k < 6; k++) shrub(c, axis, T.u0 + .08 + k * .19, T.v1 + .14, 2.3 + (k % 2) * .5, detail, 30 + k);
  paintBlock(c, wing, { wall: '#efe5cc', shade: '#c9bea3', roof: '#bdb6a2', seed: 21, detail });
  glazing(c, wing, 'air', .04, .96, 3.2, 10.4, { lit: wing.airLit, detail, panes: 12, seed: 22 });
  brick(c, wing, 'air', 0, 1, 0, 2.6, { lit: wing.airLit, detail, seed: 26 }); brick(c, wing, 'end', 0, 1, 0, 2.6, { lit: !wing.airLit, detail, seed: 27 });
  strip(c, wing, 'air', 0, 1, 12.2, 13.6, '#2f5b44');
  if (!region) { c.save(); c.globalAlpha = .9; strip(c, wing, 'air', 0, 1, 13.6, 14, '#fdf7e4'); c.restore(); }
  railing(c, wing.air(.02, 14), wing.air(.98, 14), detail, '#46524b'); // spectator terrace
  if (fine) { const R = rng(9); for (let k = 0; k < 6; k++) { const p = wing.air(.08 + R() * .84, 14); const q = { x: p.x + (axis === 'y' ? -1.6 : 1.6) * .6, y: p.y - 1.2 }; c.fillStyle = ['#c8573f', '#3e5f86', '#e0c16a', '#6b4a3a'][k % 4]; c.fillRect(q.x - .5, q.y - 2.4, 1, 2.1); c.fillStyle = '#e8c9a8'; c.fillRect(q.x - .35, q.y - 3.1, .7, .7); } }
  if (!region) { for (const f of [.12, .82]) { const p = wing.W(wing.x0 + (wing.x1 - wing.x0) * (axis === 'y' ? .4 : f), wing.y0 + (wing.y1 - wing.y0) * (axis === 'y' ? f : .4), 14); c.fillStyle = '#a39d89'; c.fillRect(p.x - 2, p.y - 2.4, 4, 2.4); c.fillStyle = '#cbc4ad'; c.fillRect(p.x - 2, p.y - 3, 4, .8); } }
  paintBlock(c, hall, { wall: '#f4ecd6', shade: '#d2c7ac', roof: '#c9c2ad', seed: 23, detail });
  glazing(c, hall, 'air', .06, .94, 2.2, 19.5, { lit: hall.airLit, detail, panes: 6, seed: 24 });
  glazing(c, hall, 'end', .12, .88, 15.5, 19.5, { lit: !hall.airLit, detail, panes: 4, seed: 25 });
  const k0 = hall.air(.18, 7.6), k1 = hall.air(.82, 7.6), out = axis === 'y' ? iso(.1, 0) : iso(0, .1); // orange canopy
  polygon(c, [k0, k1, { x: k1.x + out.x, y: k1.y + out.y }, { x: k0.x + out.x, y: k0.y + out.y }], '#d8743f');
  polygon(c, [{ x: k0.x + out.x, y: k0.y + out.y }, { x: k1.x + out.x, y: k1.y + out.y }, { x: k1.x + out.x, y: k1.y + out.y + 1 }, { x: k0.x + out.x, y: k0.y + out.y + 1 }], '#9c4f2b');
  strip(c, hall, 'air', .4, .6, 0, featureWorldPixels(SPRITE_SCALE.doorHeightMetres), '#2c4348');
  if (!region) { const q = localToProjected(axis, T.u0 - .1, T.v1 + .1, 0); c.strokeStyle = '#d9d8cc'; c.lineWidth = .5; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x, q.y - 21); c.stroke(); polygon(c, [{ x: q.x, y: q.y - 21 }, { x: q.x + 4.5, y: q.y - 20 }, { x: q.x + 4, y: q.y - 17.6 }, { x: q.x, y: q.y - 18.3 }], '#2f5b44'); }
}
export function drawHangar(c, { axis = 'x', detail = 'town', biome = 'taiga' } = {}) {
  const t = c.getTransform();
  if (drawAirportBuilding(c, 'hangar', { axis, pixelScale: Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) })) return;
  BIOME = biome;
  const H = LAYOUT.hangar, region = detail === 'region';
  const walls = block(axis, H.u0, H.v0, H.u1, H.v1, 0, 12);
  castShadow(c, { ...walls, h: 19 }, .18);
  paintBlock(c, walls, { wall: '#b9bdb1', shade: '#959a8f', roof: '#9aa196', seed: 31, detail, edge: false });
  const steps = 12, prof = []; for (let k = 0; k <= steps; k++) { const f = k / steps; prof.push({ v: H.v0 + (H.v1 - H.v0) * f, z: 12 + Math.sin(f * Math.PI) * 8 }); }
  const ridge = (u, k) => localToProjected(axis, u, prof[k].v, prof[k].z);
  for (let k = 0; k < steps; k++) {
    const f = (k + .5) / steps, facing = axis === 'y' ? Math.cos(f * Math.PI) : -Math.cos(f * Math.PI);
    polygon(c, [ridge(H.u0, k), ridge(H.u1, k), ridge(H.u1, k + 1), ridge(H.u0, k + 1)], roofTone(mix('#8f988e', facing > 0 ? '#d7dccf' : '#5f675f', Math.abs(facing) * .55)));
  }
  if (!region) {
    c.save(); c.globalAlpha = .4; c.strokeStyle = '#262d27'; c.lineWidth = .4; c.beginPath();
    for (let u = H.u0 + .05; u < H.u1 - .01; u += .05) for (let k = 0; k <= steps; k++) { const p = ridge(u, k); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
    c.stroke(); c.restore();
    c.save(); c.globalAlpha = .25; c.strokeStyle = '#4a5049'; c.lineWidth = .35; c.beginPath();
    for (let f = .06; f < 1; f += .06) { const a = walls.end(f, 0), b = walls.end(f, 12); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    c.stroke(); c.restore();
  }
  strip(c, walls, 'air', .12, .88, 0, 10.5, '#1a211f');
  strip(c, walls, 'air', .12, .5, 0, 10.5, walls.airLit ? '#7d8a82' : '#66726b');
  if (!region) { c.save(); c.globalAlpha = .35; c.strokeStyle = '#2d3531'; c.lineWidth = .35; c.beginPath(); for (let f = .16; f < .5; f += .06) { const a = walls.air(f, 0), b = walls.air(f, 10.5); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); } c.stroke(); c.restore(); }
  outline(c, hull([...walls.left, ...walls.right, ...Array.from({ length: steps + 1 }, (_, k) => ridge(H.u0, k)), ...Array.from({ length: steps + 1 }, (_, k) => ridge(H.u1, k))]), detail);
}
export function drawDepot(c, { axis = 'x', detail = 'town', biome = 'taiga' } = {}) {
  const t = c.getTransform();
  if (drawAirportBuilding(c, 'depot', { axis, pixelScale: Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) })) return;
  BIOME = biome;
  const d = LAYOUT.depot, region = detail === 'region';
  const bund = block(axis, d.u - .3, d.v - .26, d.u + .3, d.v + .26, 0, 1.6);
  castShadow(c, { ...bund, h: 9 }, .15);
  paintBlock(c, bund, { wall: '#b7b09a', shade: '#958f7b', roof: '#a9a28c', seed: 41, detail, edge: false });
  for (const [du, dv] of [[-.14, -.08], [.14, .1]]) {
    const p = localToProjected(axis, d.u + du, d.v + dv, 1.6), rx = 5.2, ry = 2.6, h = 7;
    const g = c.createLinearGradient(p.x - rx, 0, p.x + rx, 0); g.addColorStop(0, '#f4f0e2'); g.addColorStop(.55, '#d9d4c3'); g.addColorStop(1, '#a9a494');
    c.fillStyle = g; c.beginPath(); c.moveTo(p.x - rx, p.y); c.lineTo(p.x - rx, p.y - h); c.ellipse(p.x, p.y - h, rx, ry, 0, Math.PI, 0); c.lineTo(p.x + rx, p.y); c.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI); c.fill();
    c.fillStyle = '#e9e4d4'; c.beginPath(); c.ellipse(p.x, p.y - h, rx, ry, 0, 0, TAU); c.fill();
    if (!region) { c.strokeStyle = '#d8743f'; c.lineWidth = .9; c.beginPath(); c.ellipse(p.x, p.y - h * .45, rx, ry, 0, .05, Math.PI - .05); c.stroke(); c.strokeStyle = '#3b3a2e66'; c.lineWidth = .5; c.beginPath(); c.ellipse(p.x, p.y - h, rx, ry, 0, 0, TAU); c.stroke(); }
  }
}
export function drawMast(c, { axis = 'x', detail = 'town', index = 0 } = {}) {
  const m = LAYOUT.masts[index], base = localToProjected(axis, m.u, m.v, 0), region = detail === 'region';
  c.strokeStyle = '#8c9189'; c.lineWidth = region ? 1.1 : .75; c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(base.x, base.y - 18); c.stroke();
  c.fillStyle = '#4c5650'; c.fillRect(base.x - 2.2, base.y - 19.6, 4.4, 1.8); c.fillStyle = '#e8e2c6'; c.fillRect(base.x - 1.8, base.y - 18, 3.6, .6);
}
export function drawWindsock(c, { axis = 'x', detail = 'town', wind = Math.PI * .15 } = {}) {
  const w = LAYOUT.windsock, base = localToProjected(axis, w.u, w.v, 0), region = detail === 'region';
  c.strokeStyle = '#d8d8cc'; c.lineWidth = region ? 1.2 : .8; c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(base.x, base.y - 15); c.stroke();
  const d = iso(Math.cos(wind), Math.sin(wind)), len = Math.hypot(d.x, d.y), ux = d.x / len, uy = d.y / len, L = 10, top = { x: base.x, y: base.y - 14.5 };
  for (let k = 0; k < 4; k++) {
    const a = k / 4, b = (k + 1) / 4, r0 = 1.6 - a * .9, r1 = 1.6 - b * .9, droop = a * 1.6, droop2 = b * 1.6;
    polygon(c, [{ x: top.x + ux * L * a, y: top.y + uy * L * a - r0 + droop }, { x: top.x + ux * L * b, y: top.y + uy * L * b - r1 + droop2 }, { x: top.x + ux * L * b, y: top.y + uy * L * b + r1 + droop2 }, { x: top.x + ux * L * a, y: top.y + uy * L * a + r0 + droop }], k % 2 ? '#f1ece0' : '#e0703a');
  }
}

// Aircraft. Local frame: +x nose, +y right wing, lengths in tiles; heights in projected px (zoom 1).
const FUSELAGE = { r: .064, lift: 1.8, belly: 3.4 };
const WING = [[.14, 0], [.05, .43], [-.05, .43], [-.13, 0]];
const TAILPLANE = [[-.4, 0], [-.46, .19], [-.52, .19], [-.52, 0]];
const NACELLES = [-.2, .2];
function project(heading, lx, ly) { const c = Math.cos(heading), s = Math.sin(heading); return iso(lx * c - ly * s, lx * s + ly * c); }
function shapePath(c, heading, points, mirror = true, lift = 0) {
  const all = mirror ? [...points, ...points.slice().reverse().map(([x, y]) => [x, -y])] : points;
  c.beginPath(); all.forEach(([x, y], i) => { const p = project(heading, x, y); i ? c.lineTo(p.x, p.y - lift) : c.moveTo(p.x, p.y - lift); }); c.closePath();
}
function fuselagePoints(n = 16) {
  const pts = [];
  for (let k = 0; k <= n; k++) { const a = k / n * Math.PI / 2; pts.push([.38 + .15 * Math.cos(a), FUSELAGE.r * Math.sin(a)]); }
  pts.push([-.26, FUSELAGE.r], [-.46, FUSELAGE.r * .42], [-.54, FUSELAGE.r * .12], [-.55, 0]);
  return pts;
}
const FUSE = fuselagePoints();
/** Projected bounds of one aircraft drawing at zoom 1 and scale 1, including the fin (canvas sizing). */
export const AIRCRAFT_BOX = { left: -27, top: -27, width: 54, height: 43 };
export function drawAircraft(c, { heading = 0, detail = 'town', color = '#69c6bc', scale = 1 } = {}) {
  const region = detail === 'region', fine = detail === 'detail', L = FUSELAGE.lift;
  c.save(); c.scale(scale, scale); c.lineJoin = 'round';
  const n = project(heading, 0, 1), side = n.y >= 0 ? 1 : -1; // camera-facing flank
  for (const sy of NACELLES) { shapePath(c, heading, [[.21, sy - .036], [.21, sy + .036], [-.07, sy + .036], [-.07, sy - .036]], false, -1.4); c.fillStyle = LIVERY.engineDark; c.fill(); }
  shapePath(c, heading, FUSE, true, L - FUSELAGE.belly); c.fillStyle = LIVERY.belly; c.fill();
  shapePath(c, heading, WING, true, .2); c.fillStyle = LIVERY.wingShade; c.fill();
  shapePath(c, heading, WING, true, 1); c.fillStyle = LIVERY.wing; c.fill(); if (!region) { c.save(); c.globalAlpha = .55; c.strokeStyle = '#2e2a20'; c.lineWidth = fine ? .45 : .6; c.stroke(); c.restore(); }
  if (!region) {
    c.strokeStyle = '#fbf8f0'; c.lineWidth = fine ? .6 : .8; c.beginPath();
    for (const sgn of [1, -1]) { const a = project(heading, .14, 0), b = project(heading, .05, .43 * sgn); c.moveTo(a.x, a.y - 1); c.lineTo(b.x, b.y - 1); }
    c.stroke();
    c.strokeStyle = '#a9a495'; c.lineWidth = .5; c.beginPath();
    for (const sgn of [1, -1]) { const a = project(heading, -.13, 0), b = project(heading, -.05, .43 * sgn); c.moveTo(a.x, a.y - 1); c.lineTo(b.x, b.y - 1); }
    c.stroke();
  }
  for (const sy of NACELLES) {
    shapePath(c, heading, [[.22, sy - .032], [.22, sy + .032], [-.06, sy + .032], [-.06, sy - .032]], false, 1.6); c.fillStyle = LIVERY.engine; c.fill();
    if (!region) { shapePath(c, heading, [[.22, sy - .03], [.22, sy + .03], [.19, sy + .03], [.19, sy - .03]], false, 1.6); c.fillStyle = LIVERY.intake; c.fill(); }
    if (fine) { const p = project(heading, .235, sy), q = project(heading, 0, .07); c.globalAlpha = .16; c.strokeStyle = '#eef0e8'; c.lineWidth = .5; c.beginPath(); c.ellipse(p.x, p.y - 1.2, Math.max(.8, Math.abs(q.x)), Math.max(.8, Math.abs(q.y) + 2), 0, 0, TAU); c.stroke(); c.globalAlpha = 1; }
  }
  shapePath(c, heading, TAILPLANE, true, L + .6); c.fillStyle = LIVERY.wing; c.fill(); if (!region) { c.save(); c.globalAlpha = .55; c.strokeStyle = '#2e2a20'; c.lineWidth = fine ? .45 : .6; c.stroke(); c.restore(); }
  const alen = Math.hypot(n.x, n.y) || 1, nx = n.x / alen, ny = n.y / alen, rr = FUSELAGE.r * alen;
  const g = c.createLinearGradient(-nx * rr, -ny * rr - L, nx * rr, ny * rr - L), litLeft = (-nx - ny * 1.6) > 0;
  const hi = '#fffef8', lo = LIVERY.bodyShade;
  g.addColorStop(0, litLeft ? hi : lo); g.addColorStop(.5, LIVERY.body); g.addColorStop(1, litLeft ? lo : hi);
  shapePath(c, heading, FUSE, true, L); c.fillStyle = g; c.fill();
  c.save(); c.globalAlpha = region ? .45 : .7; c.strokeStyle = '#2e2a20'; c.lineWidth = fine ? .5 : region ? .9 : .65; c.stroke(); c.restore();
  const line = (x0, y0, x1, y1, lift, color, width) => { const a = project(heading, x0, y0), b = project(heading, x1, y1); c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(a.x, a.y - lift); c.lineTo(b.x, b.y - lift); c.stroke(); };
  line(.4, 0, -.4, 0, L + .9, '#ffffffb0', region ? 1.2 : .8);
  line(.42, side * FUSELAGE.r * .72, -.36, side * FUSELAGE.r * .62, L - .2, LIVERY.line, region ? 1.6 : fine ? .9 : 1.2);
  if (!region) { c.fillStyle = '#1d3036'; const count = fine ? 11 : 7; for (let k = 0; k < count; k++) { const p = project(heading, .3 - k * (.6 / count), side * FUSELAGE.r * .58); c.fillRect(p.x - .45, p.y - L - 1.1, .9, .9); } }
  shapePath(c, heading, [[.5, 0], [.47, .038], [.41, .046], [.41, 0]], true, L + .6); c.fillStyle = LIVERY.glass; c.fill();
  // Fin: a vertical swept plate in the company orange with the route-colour band.
  const base0 = project(heading, -.3, 0), base1 = project(heading, -.53, 0), top1 = project(heading, -.56, 0), top0 = project(heading, -.45, 0), H = 10.5;
  const P = (p, z) => ({ x: p.x, y: p.y - L - z });
  const quad = (a, b, d, e, fill) => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y); c.closePath(); c.fillStyle = fill; c.fill(); };
  const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  const f0 = P(base0, 0), f1 = P(base1, 0), f2 = P(top1, H), f3 = P(top0, H * .96);
  const across2 = project(heading, 0, .012); f0.x -= across2.x; f1.x -= across2.x; f2.x += across2.x; f3.x += across2.x;
  if (Math.abs(f0.x - f1.x) < 1.4) { f0.x -= .7; f3.x -= .7; f1.x += .7; f2.x += .7; } // edge-on: keep a sliver
  quad(f0, f1, f2, f3, LIVERY.fin);
  if (!litLeft) { c.globalAlpha = .22; quad(f0, f1, f2, f3, '#5b2d18'); c.globalAlpha = 1; }
  quad(lerp(f0, f3, .52), lerp(f1, f2, .52), lerp(f1, f2, .74), lerp(f0, f3, .74), color);
  c.strokeStyle = '#fff5e2aa'; c.lineWidth = .5; c.beginPath(); c.moveTo(f0.x, f0.y); c.lineTo(f3.x, f3.y); c.stroke();
  c.restore();
}
/** Ground shadow: the plan-view silhouette, softened with altitude (blur in device px). */
export function drawAircraftShadow(c, { heading = 0, scale = 1, blur = 0 } = {}) {
  c.save(); c.scale(scale, scale); c.fillStyle = '#1d2b22';
  if (blur > .2 && 'filter' in c) c.filter = `blur(${blur.toFixed(1)}px)`;
  shapePath(c, heading, FUSE); c.fill(); shapePath(c, heading, WING); c.fill(); shapePath(c, heading, TAILPLANE); c.fill();
  for (const sy of NACELLES) { shapePath(c, heading, [[.22, sy - .034], [.22, sy + .034], [-.06, sy + .034], [-.06, sy - .034]], false); c.fill(); }
  c.restore();
}

// UI portraits (tool cards 72×56, inspector, route cards 80×64).
export function drawAirportPortrait(c, w, h, { biome = 'taiga', axis = 'x' } = {}) {
  // Fit the complete 6x2 airport, including the hangar and fuel depot. The
  // previous fixed crop cut the runway in half and omitted half the buildings.
  const boxes = Object.values(PART_BOXES[axis]);
  const ground = [[0,0],[6,0],[6,2],[0,2]].map(([u,v]) => localToProjected(axis,u,v));
  const left = Math.min(...ground.map(p=>p.x), ...boxes.map(b=>b.left-2));
  const top = Math.min(...ground.map(p=>p.y), ...boxes.map(b=>b.top-2));
  const right = Math.max(...ground.map(p=>p.x), ...boxes.map(b=>b.left+b.width+2));
  const bottom = Math.max(...ground.map(p=>p.y), ...boxes.map(b=>b.top+b.height+2));
  const inset = Math.min(6, Math.min(w,h)*.06), s = Math.min((w-inset*2)/(right-left),(h-inset*2)/(bottom-top));
  c.save(); c.translate((w-(right-left)*s)/2-left*s,(h-(bottom-top)*s)/2-top*s); c.scale(s,s);
  c.save(); c.transform(1,.5,-1,.5,0,0); paintAirportGround(c,{axis,biome,detail:'detail',seed:5}); c.restore();
  // The same part placement and back-to-front order as the world renderer.
  for (const kind of Object.keys(PART_FRONTS).sort((a,b)=>PART_FRONTS[a][0]+PART_FRONTS[a][1]-PART_FRONTS[b][0]-PART_FRONTS[b][1])) PARTS[kind](c,{axis,detail:'detail',biome});
  const p=localToProjected(axis,LAYOUT.stands[0].u,LAYOUT.stands[0].v);
  c.save(); c.translate(p.x,p.y); drawAircraft(c,{heading:axis==='y'?Math.PI/2:0,detail:'detail',color:'#69c6bc'}); c.restore();
  c.restore();
}

export function drawAircraftPortrait(c, w, h, { color = '#69c6bc' } = {}) {
  const s = Math.min(w / 58, h / 44);
  c.save(); c.translate(w / 2, h / 2 + 6 * s); c.scale(s, s);
  c.save(); c.translate(8, 10); c.globalAlpha = .22; drawAircraftShadow(c, { heading: Math.PI * .08, blur: 1.2 }); c.restore();
  drawAircraft(c, { heading: Math.PI * .08, detail: 'detail', color }); c.restore();
}

// Prepared images for the renderer bundle; they live in the shared 32 MiB transport LRU (preparedTransport).
/** Measured projected-px bounds of each upright part from the anchor corner, per runway axis (includes cast shadows). */
export const PART_BOXES = {
  x: { tower: { left: -18, top: -60, width: 52, height: 92 }, terminal: { left: -15, top: -6, width: 70, height: 49 }, hangar: { left: 117, top: 57, width: 50, height: 40 }, depot: { left: 144, top: 80, width: 41, height: 26 }, windsock: { left: 143, top: 88, width: 20, height: 27 }, mast0: { left: 52, top: 10, width: 5, height: 21 }, mast1: { left: 130, top: 49, width: 5, height: 21 } },
  y: { tower: { left: -8, top: -60, width: 52, height: 92 }, terminal: { left: -48, top: -6, width: 67, height: 49 }, hangar: { left: -159, top: 57, width: 50, height: 40 }, depot: { left: -181, top: 80, width: 41, height: 26 }, windsock: { left: -157, top: 88, width: 20, height: 27 }, mast0: { left: -57, top: 10, width: 5, height: 21 }, mast1: { left: -135, top: 49, width: 5, height: 21 } },
};
// Union the native fallback bounds with the measured painted cutouts.
// Four world pixels retain low-density filter fringes before the preparation gutter.
const paintedPartBounds = {
  x: { tower: [-17.441429, -49.770357, 6.844286, 17.729643], terminal: [-8.143571, -2.885179, 48.642143, 39.43625], hangar: [115.42, 58.731607, 160.777143, 94.445893], depot: [144.256429, 78.970357, 180.863571, 103.791786] },
  y: { tower: [-7.38, -50.918393, 17.441429, 18.18875], terminal: [-47.481429, -2.529107, 7.34, 39.078036], hangar: [-159.884286, 58.168214, -115.777143, 94.061071], depot: [-180.327857, 79.185357, -144.792143, 104.006786] },
};
for (const axis of ['x','y']) for (const [kind, measured] of Object.entries(paintedPartBounds[axis])) {
  const native=PART_BOXES[axis][kind], left=Math.min(native.left,Math.floor(measured[0]-4)), top=Math.min(native.top,Math.floor(measured[1]-4));
  const right=Math.max(native.left+native.width,Math.ceil(measured[2]+4)), bottom=Math.max(native.top+native.height,Math.ceil(measured[3]+4));
  PART_BOXES[axis][kind]={left,top,width:right-left,height:bottom-top};
}
/** Each part's front corner in local (u, v): its depth in the scene's back-to-front order. */
export const PART_FRONTS = { tower: [.5, .66], terminal: [1.62, .8], hangar: [5.04, .76], depot: [5.8, .68], mast0: [1.8, .1], mast1: [4.24, .1], windsock: [5.74, 1.06] };
const PARTS = { tower: drawTower, terminal: drawTerminal, hangar: drawHangar, depot: drawDepot, windsock: drawWindsock, mast0: (c, o) => drawMast(c, { ...o, index: 0 }), mast1: (c, o) => drawMast(c, { ...o, index: 1 }) };
const headingBucket = heading => ((Math.round(heading / (TAU / HEADING_BUCKETS)) % HEADING_BUCKETS) + HEADING_BUCKETS) % HEADING_BUCKETS;
export function createAirportSprites({ pixelScale = 1, detailLevel = 'town', biome = 'taiga', cache } = {}) {
  const scale = Math.max(.25, Number(pixelScale) || 1), prefix = `airport:${worldArtRevision()}:${scale}:${detailLevel}:${biome}:`, boost = detailLevel === 'region' ? 1.3 : 1;
  let created = 0, hits = 0;
  function prepare(key, box, draw) {
    let image = cache.get(prefix + key);
    if (image) { hits++; return image; }
    image = document.createElement('canvas'); image.width = Math.ceil((box.width + 4) * scale); image.height = Math.ceil((box.height + 4) * scale);
    const c = image.getContext('2d'); c.scale(scale, scale); c.translate(2 - box.left, 2 - box.top); draw(c);
    cache.set(prefix + key, image); created++; return image;
  }
  const plane = { left: AIRCRAFT_BOX.left * boost, top: AIRCRAFT_BOX.top * boost, width: AIRCRAFT_BOX.width * boost, height: AIRCRAFT_BOX.height * boost };
  return {
    /** One upright part; (x, y) is the anchor's north corner at site height, in projected px. */
    part(ctx, kind, axis, x, y) {
      const box = PART_BOXES[axis][kind], image = prepare(`${kind}:${axis}`, box, c => PARTS[kind](c, { axis, detail: detailLevel, biome }));
      // Static parts already contain their antialiasing at this density. Keep
      // their native pixels, including under a fractional context translation.
      const transform = ctx.getTransform(), native = Math.abs(transform.a - scale) < 1e-7 && Math.abs(transform.d - scale) < 1e-7 && Math.abs(transform.b) < 1e-7 && Math.abs(transform.c) < 1e-7;
      // Projection can place an intended integer camera translation just
      // below a half-pixel rounding tie. Normalize only that numerical drift;
      // genuinely fractional gallery transforms retain their original phase.
      const phaseX = Math.abs(transform.e - Math.round(transform.e)) < 1e-7 ? Math.round(transform.e) : transform.e, phaseY = Math.abs(transform.f - Math.round(transform.f)) < 1e-7 ? Math.round(transform.f) : transform.f;
      const left = native ? (Math.round((x + box.left - 2) * scale + phaseX) - transform.e) / scale : x + box.left - 2, top = native ? (Math.round((y + box.top - 2) * scale + phaseY) - transform.f) / scale : y + box.top - 2;
      ctx.save(); ctx.imageSmoothingEnabled = !native; if (!native) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, left, top, image.width / scale, image.height / scale); ctx.restore();
      return { x: left, y: top, w: image.width / scale, h: image.height / scale, image };
    },
    /** A plane centred at (x, y) projected px; heading quantised to 48 buckets; the route colour bands the fin. */
    aircraft(ctx, heading, color, x, y) {
      const bucket = headingBucket(heading), image = prepare(`plane:${bucket}:${color}`, plane, c => drawAircraft(c, { heading: bucket * TAU / HEADING_BUCKETS, detail: detailLevel, color, scale: boost }));
      ctx.drawImage(image, x + plane.left - 2, y + plane.top - 2, image.width / scale, image.height / scale);
      return { x: x + plane.left - 2, y: y + plane.top - 2, w: image.width / scale, h: image.height / scale, image };
    },
    /** Ground shadow; band 0 on the ground, 1 low, 2 high (progressively softer). The caller sets globalAlpha. */
    shadow(ctx, heading, band, x, y) {
      const bucket = headingBucket(heading), blur = [0, 1.2, 2.6][band] * scale;
      const image = prepare(`shadow:${bucket}:${band}`, plane, c => drawAircraftShadow(c, { heading: bucket * TAU / HEADING_BUCKETS, scale: boost, blur }));
      ctx.drawImage(image, x + plane.left - 2, y + plane.top - 2, image.width / scale, image.height / scale);
    },
    getStats: () => ({ created, hits, pixelScale: scale }),
  };
}
