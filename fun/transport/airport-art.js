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
export function paintAirportGround(c, { axis = 'x', biome = 'taiga', detail = 'town' } = {}) {
  const P=PALETTES[biome]||PALETTES.taiga,region=detail==='region',r=LAYOUT.runway,a=LAYOUT.apron;
  c.save();if(axis==='y')c.transform(0,1,1,0,0,0);c.scale(TILE,TILE);
  const slab=(x0,y0,x1,y1,color)=>{c.fillStyle=color;c.fillRect(x0,y0,x1-x0,y1-y0);};
  const stripe=(points,color,width)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();};
  // Broad constructed slabs and perimeter strips; no painted meadow or noise.
  slab(a.u0-.03,a.v0-.03,a.u1+.03,a.v1+.03,P.joint);slab(a.u0,a.v0,a.u1,a.v1,P.apron);
  for(const t of LAYOUT.taxiways){slab(t.u-.15,a.v1,t.u+.15,r.v0+.08,P.asphaltLight);stripe([[t.u,a.v1-.15],[t.u,r.v0+.14]],'#c2a269',.022);}
  slab(r.u0-.025,r.v0-.035,r.u1+.025,r.v1+.035,P.joint);slab(r.u0,r.v0,r.u1,r.v1,P.asphalt);
  stripe([[r.u0+.05,r.v0+.04],[r.u1-.05,r.v0+.04]],'#e3d7b7',.022);
  stripe([[r.u0+.05,r.v1-.04],[r.u1-.05,r.v1-.04]],'#e3d7b7',.022);
  for(const end of [r.u0+.12,r.u1-.35])for(let i=0;i<4;i++)slab(end,r.v0+.1+i*.085,end+.23,r.v0+.14+i*.085,'#f0e9d6');
  for(let u=r.u0+.65;u<r.u1-.5;u+=.48)slab(u,1.485,u+.22,1.515,'#f0e9d6');
  stripe([[a.u0+.12,.52],[a.u1-.12,.52]],'#c2a269',region?.03:.018);
  if(!region){
    for(let u=a.u0+.65;u<a.u1;u+=.65)stripe([[u,a.v0],[u,a.v1]],P.joint,.014);
    stripe([[a.u0,.4],[a.u1,.4]],P.joint,.014);
    for(const s of LAYOUT.stands)stripe([[s.u-.28,.34],[s.u-.28,.71],[s.u+.2,.71]],'#e3d7b7',.025);
    for(const end of [r.u0+.52,r.u1-.68]){slab(end,1.32,end+.17,1.38,'#e3d7b7');slab(end,1.62,end+.17,1.68,'#e3d7b7');}
  }
  slab(.5,.05,1.72,.14,P.apron);c.restore();
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

// New regional turboprop; physical dimensions remain 18m by 17m in the shared 16m tile.
const FUSELAGE = { r: .065, lift: 2.2, belly: 2.6 };
const WING = [[.16, 0], [-.01, .52], [-.13, .52], [-.2, 0]];
const TAILPLANE = [[-.36, 0], [-.48, .23], [-.56, .23], [-.51, 0]];
const NACELLES = [-.25, .25];
function project(heading, lx, ly) { const c = Math.cos(heading), s = Math.sin(heading); return iso(lx * c - ly * s, lx * s + ly * c); }
function shapePath(c, heading, points, mirror = true, lift = 0) {
  const all = mirror ? [...points, ...points.slice().reverse().map(([x, y]) => [x, -y])] : points;
  c.beginPath(); all.forEach(([x, y], i) => { const p = project(heading, x, y); i ? c.lineTo(p.x, p.y - lift) : c.moveTo(p.x, p.y - lift); }); c.closePath();
}
const FUSE = [[.57,0],[.55,.027],[.47,.06],[.32,.068],[-.28,.065],[-.49,.033],[-.56,0]];
export const AIRCRAFT_BOX = { left: -29, top: -29, width: 58, height: 48 };
export function drawAircraft(c, { heading = 0, detail = 'town', color = '#758f89', scale = 1 } = {}) {
  const region=detail==='region', L=FUSELAGE.lift;
  c.save();c.scale(scale,scale);c.lineJoin='round';
  const paint=(points,fill,lift=0,mirror=true)=>{shapePath(c,heading,points,mirror,lift);c.fillStyle=fill;c.fill();};
  paint(WING,'#929e99',-.1);paint(WING,'#d8ddcf',.9);
  // The leading edge catches the fixed northwest sky light in every heading.
  c.strokeStyle='#f0edda';c.lineWidth=.6;c.stroke();
  paint(TAILPLANE,'#d8ddcf',L+.4);
  for(const y of NACELLES){
    paint([[.25,y-.033],[.25,y+.033],[-.12,y+.036],[-.18,y]],'#9eafa7',1.6,false);
    const a=project(heading,.28,y-.12),b=project(heading,.28,y+.12);
    c.strokeStyle='#596e68';c.lineWidth=region?1.1:.75;c.beginPath();c.moveTo(a.x,a.y-2.1);c.lineTo(b.x,b.y-2.1);c.stroke();
  }
  paint(FUSE,'#8b9b92',L-FUSELAGE.belly);
  const normal=project(heading,0,1),n=Math.hypot(normal.x,normal.y),nx=normal.x/n,ny=normal.y/n;
  const gradient=c.createLinearGradient(-nx*3,-ny*3-L,nx*3,ny*3-L),light=(-nx-ny*1.5)>0;
  gradient.addColorStop(0,light?'#f1ead7':'#a0ada2');gradient.addColorStop(.48,'#e3d7b7');gradient.addColorStop(1,light?'#a0ada2':'#f1ead7');
  paint(FUSE,gradient,L);c.strokeStyle='#65766b';c.lineWidth=.45;c.stroke();
  const side=normal.y>=0?1:-1;
  paint([[.5,0],[.43,.048],[.35,.05],[.36,0]],'#587178',L+.6);
  if(!region){
    for(let i=0;i<6;i++){const p=project(heading,.23-i*.072,side*.059);c.fillStyle='#587178';c.fillRect(p.x-.65,p.y-L-.55,1.3,1.05);}
  }
  const tail=[[-.31,0,0],[-.55,0,0],[-.55,0,8],[-.46,0,8]].map(([x,y,z])=>{const p=project(heading,x,y);return {x:p.x,y:p.y-L-z};});
  polygon(c,tail,'#899b88');c.strokeStyle='#e3d7b7';c.lineWidth=.55;c.stroke();
  const mixPoint=(a,b,f)=>({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f});
  polygon(c,[mixPoint(tail[0],tail[3],.45),mixPoint(tail[1],tail[2],.45),mixPoint(tail[1],tail[2],.69),mixPoint(tail[0],tail[3],.69)],color);
  c.restore();
}
/** Ground shadow: the plan-view silhouette, softened with altitude (blur in device px). */
export function drawAircraftShadow(c, { heading = 0, scale = 1, blur = 0 } = {}) {
  c.save(); c.scale(scale, scale); c.fillStyle = '#1d2b22';
  if (blur > .2 && 'filter' in c) c.filter = `blur(${blur.toFixed(1)}px)`;
  shapePath(c, heading, FUSE); c.fill(); shapePath(c, heading, WING); c.fill(); shapePath(c, heading, TAILPLANE); c.fill();
  for (const sy of NACELLES) { shapePath(c, heading, [[.25, sy - .033], [.25, sy + .033], [-.12, sy + .036], [-.18, sy]], false); c.fill(); }
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
  x: { tower: [-18.59481172, -54.84987448, 7.99062762, 18.53322176], terminal: [-7.42694561, 1.49221757, 43.19464435, 38.63899582], hangar: [120.34811715, 61.50627615, 155.49188285, 91.73355649], depot: [145.71648536, 79.69740586, 179.58560669, 104.46192469] },
  y: { tower: [-8.62794979, -53.57523013, 18.32167364, 18.53322176], terminal: [-42.19313808, 1.5832636, 7.70008368, 39.45841004], hangar: [-155.12769874, 61.23313808, -120.53020921, 92.55297071], depot: [-179.76769874, 79.24217573, -145.35230126, 104.91715481] },
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
