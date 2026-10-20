// Articulated defenses share one fixed overhead camera. Only the weapon's ground-plane
// geometry turns; the foundation, side depth, lighting and cast shadow stay screen-aligned.
const TYPES = new Set(['turret', 'rocketTower', 'unityTurret', 'unityRocketTower']);
// A finite set of 64 headings × four defenses × two paints. Shadows are shared by
// the paints, keeping the COMPLETE cache below 40 MiB, so large static bases never
// evict and rebuild one another's images between the shadow and body passes.
const CACHE_LIMIT = 40 * 1024 * 1024;
const cache = new Map();
const shadows = new Map();
let bytes = 0;
const TAU = Math.PI * 2;
const PALETTE = [
  { roof: '#d4ddd6', edge: '#f0f1e5', side: '#778b92', paint: '#2878d4', trim: '#8dbad5' },
  { roof: '#c63c50', edge: '#f79898', side: '#722b3d', paint: '#9c263e', trim: '#f2a9a6' },
];
export const isDefense = entity => TYPES.has(entity.type);
const tower = entity => /RocketTower$/.test(entity.type) || entity.type === 'rocketTower';
const unity = entity => entity.type.startsWith('unity');
const angleOf = entity => Number.isFinite(entity.angle) ? entity.angle : Number.isFinite(entity.aimAngle) ? entity.aimAngle : 0;
const makeCanvas = pixels => { const c = document.createElement('canvas'); c.width = c.height = pixels; return c; };
function polygon(ctx, points, fill, stroke, width = .5) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function line(ctx, a, b, color, width = 1) {
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function round(x, y, w, h, r = 2) {
  return [[x + w - r, y + r], [x + w - r, y + h - r], [x + r, y + h - r], [x + r, y + r]]
    .flatMap(([cx, cy], corner) => Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + corner * Math.PI / 2 + i * Math.PI / 8;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }));
}
function circle(x, y, r, count = 24) {
  return Array.from({ length: count }, (_, i) => [x + Math.cos(i * TAU / count) * r, y + Math.sin(i * TAU / count) * r]);
}
function plate(ctx, points, top, side, depth = 2, edge = '#acb9b7') {
  // Drawing the lower silhouette first gives every heading the same visible side depth.
  polygon(ctx, points.map(([x, y]) => [x, y + depth]), side, '#18232b', .65);
  const roof = ctx.createLinearGradient(-22, -30, 25, 22);
  roof.addColorStop(0, edge); roof.addColorStop(.35, top); roof.addColorStop(1, side);
  polygon(ctx, points, roof, '#26343b', .55);
}
function foundation(ctx, e, p) {
  const big = tower(e), ai = unity(e), w = big ? 51 : 27, h = big ? 43 : 25;
  const footprint = ai
    ? [[-w / 2 + 5, -h / 2], [w / 2 - 5, -h / 2], [w / 2, -h / 2 + 5], [w / 2, h / 2 - 5],
      [w / 2 - 5, h / 2], [-w / 2 + 5, h / 2], [-w / 2, h / 2 - 5], [-w / 2, -h / 2 + 5]]
    : round(-w / 2, -h / 2, w, h, big ? 5 : 3);
  plate(ctx, footprint, '#667376', '#34454d', 3, '#89928d');
  const inset = footprint.map(([x, y]) => [x * .87, y * .86 - 1]);
  plate(ctx, inset, p.roof, p.side, 1.5, p.edge);
  for (const side of [-1, 1]) {
    const x = side * w * .35;
    plate(ctx, round(x - (big ? 4 : 2.3), h * .1, big ? 8 : 4.6, h * .27, 1), p.paint, '#263c52', 1, p.trim);
    line(ctx, [x - 1.2, h * .25], [x + 1.2, h * .25], '#786b54', 1.1);
    if (big) for (let i = 0; i < 3; i++) line(ctx, [x - 3, -h * .26 + i * 2], [x + 3, -h * .26 + i * 2], '#34464d', .9);
  }
  // A broad bearing and fixed pedestal separate the rotary weapon from its foundation.
  plate(ctx, circle(0, -2, big ? 14 : 9, ai ? 8 : 28).map(([x, y]) => [x, y * .8]), '#3a4c54', '#1b2932', big ? 5 : 3, '#a0afae');
  plate(ctx, circle(0, -2, big ? 10.5 : 6.5, ai ? 8 : 28).map(([x, y]) => [x, y * .8 - (big ? 4 : 2)]), p.paint, p.side, 2, p.trim);
}
function weapon(ctx, e, p, angle, recoil) {
  const big = tower(e), ai = unity(e), height = big ? 11 : 7, c = Math.cos(angle), s = Math.sin(angle);
  const at = (x, y) => [x * c - y * s, (x * s + y * c) * .8 - height];
  const points = shape => shape.map(([x, y]) => at(x, y));
  const block = (shape, top, side, depth, edge) => plate(ctx, points(shape), top, side, depth, edge);
  const stroke = (x, y, tx, ty, color, width) => line(ctx, at(x, y), at(tx, ty), color, width);
  if (big) {
    // Both missile cassettes rotate on one substantial yoke. Tubes have dark apertures
    // at the forward end, broad faction shells and distinct rear exhaust collars.
    block(round(-9, -18, 17, 36, ai ? 2 : 6), '#455b65', '#22333d', 2.5, '#94a3a5');
    block(ai ? [[-8, -7], [5, -7], [10, 0], [5, 7], [-8, 7], [-11, 0]] : round(-9, -7, 19, 14, 6),
      p.roof, p.side, 3, p.edge);
    for (const y of [-14, 14].sort((a, b) => at(0, a)[1] - at(0, b)[1])) {
      block(round(-14, y - 5.5, 32, 11, ai ? 1.8 : 4), p.roof, p.side, 3.1, p.edge);
      block(round(-13.2, y - 4, 5, 8, 1.5), '#354952', '#1b2932', 1.1, '#7f8c8b');
      block(round(-5, y - 5.2, 8, 10.4, 1.4), p.paint, p.side, .6, p.trim);
      for (const row of [-2.6, 2.6]) {
        block(round(11.8, y + row - 1.9, 7.1, 3.8, 1.6), '#77868a', '#263640', .6, '#bbc3b8');
        block(round(15.4, y + row - 1.35, 4.1, 2.7, 1.1), '#182830', '#16222b', .2, '#6b8087');
      }
      stroke(-6, y - 3.6, 10, y - 3.6, p.edge, .65);
    }
    block(round(-4, -3, 9, 6, 2), p.paint, p.side, 1, p.trim);
    stroke(-1, 0, 3, 0, '#8b9ea4', .8);
  } else {
    // The long single rail and large cast (Organics) or segmented (Unity) housing
    // remain identifiable even at the smallest battlefield zoom.
    block(round(3 - recoil, -2.3, 21, 4.6, .9), '#73848b', '#263a47', 1.8, '#d7dfd5');
    block(round(17 - recoil, -3, 7, 6, 1), '#536b79', '#20323f', 1.4, '#acb7b3');
    stroke(22.5 - recoil, -1.4, 22.5 - recoil, 1.4, '#172630', 1.1);
    block(ai ? [[-9, -5], [-4, -8], [6, -6], [10, 0], [6, 6], [-4, 8], [-9, 5]]
      : round(-10, -8, 22, 16, 7), p.roof, p.side, 3, p.edge);
    block(round(-7, -5, 9, 10, ai ? 1.5 : 3.5), p.paint, p.side, .7, p.trim);
    block(round(4, -4, 7, 8, 2), '#81908f', '#314953', 1, p.edge);
    for (let x = -6; x < 1; x += 2.2) stroke(x, 2.3, x, 4.5, '#233b4c', .8);
    block(circle(-3, -2, 2, ai ? 6 : 16), '#9eaba4', '#536970', .6, p.edge);
    stroke(4, -5, 7, -5, '#a1957e', .9);
  }
}
function mask(source, color, blur = 0) {
  const out = makeCanvas(source.width), ctx = out.getContext('2d');
  ctx.drawImage(source, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  if (!blur) return out;
  const soft = makeCanvas(source.width), dest = soft.getContext('2d');
  dest.filter = `blur(${blur}px)`; dest.drawImage(out, 0, 0); return soft;
}
export function defenseMuzzle(entity) {
  const angle = angleOf(entity), big = tower(entity), x = big ? 19.5 : 24, y = big ? -14 : 0;
  return { x: x * Math.cos(angle) - y * Math.sin(angle), y: (x * Math.sin(angle) + y * Math.cos(angle)) * .8 - (big ? 11 : 7) };
}
export function defenseSprite(entity, time = 0) {
  if (!isDefense(entity)) return null;
  const direction = (Math.round(angleOf(entity) / TAU * 64) % 64 + 64) % 64, team = entity.team === 1 ? 1 : 0;
  const key = `${entity.type}:${team}:${direction}`;
  if (cache.has(key)) return cache.get(key);
  const big = tower(entity), pixels = big ? 128 : 96, size = big ? 80 : 60, image = makeCanvas(pixels);
  const ctx = image.getContext('2d'); ctx.translate(pixels / 2, pixels / 2); ctx.scale(pixels / size, pixels / size);
  foundation(ctx, entity, PALETTE[team]); weapon(ctx, entity, PALETTE[team], direction * TAU / 64, 0);
  const shapeKey = `${entity.type}:${direction}`;
  if (!shadows.has(shapeKey)) { shadows.set(shapeKey, mask(image, '#0b1117', 1.3)); bytes += pixels * pixels * 4; }
  const shadow = shadows.get(shapeKey);
  const result = { image, size, key, shadow, contact: shadow, bytes: pixels * pixels * 4 };
  cache.set(key, result); bytes += result.bytes; return result;
}
export function defenseSpriteStats() { return { bytes, images: cache.size + shadows.size, limitBytes: CACHE_LIMIT }; }
