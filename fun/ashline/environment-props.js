// Small, deterministic botanical and geological sprites. Every light and shadow is
// fixed in screen space; only the arrangement of branches, leaves and stones varies.
// Ground decoration is baked by the terrain renderer, while obstacle crowns are
// drawn in depth order. Impassable boulders keep the original fractured rock art
// in every biome; only loose ground stones are procedural. This cache never uses
// the simulation's random stream.
const PIXELS = 128;
const palettes = {
  ash: { leaf: '#55534a', light: '#83806b', dark: '#30352f', bark: '#655c4b', stone: '#615f57', stoneLight: '#939080', stoneDark: '#353b3b', metal: '#655e50', rust: '#78604c' },
  jungle: { leaf: '#405b42', light: '#718461', dark: '#253b30', bark: '#5d5941', stone: '#535f56', stoneLight: '#859080', stoneDark: '#2b3934', metal: '#515b4d', rust: '#716044' },
  desert: { leaf: '#696c48', light: '#99916a', dark: '#444d36', bark: '#7d7056', stone: '#80705b', stoneLight: '#aa9577', stoneDark: '#4a473c', metal: '#746752', rust: '#80614b' },
  tundra: { leaf: '#475c55', light: '#81908b', dark: '#293b37', bark: '#626b65', stone: '#62717a', stoneLight: '#93a1a4', stoneDark: '#38464d', metal: '#5c6a70', rust: '#6a6159' },
};
const kinds = new Set(['tree', 'plant', 'debris', 'stones']);
const cache = new Map();
const randomAt = (a, b = 0) => {
  let h = Math.imul(a + 71, 1597334677) ^ Math.imul(b + 19, 3812015801);
  h = Math.imul(h ^ h >>> 16, 2246822519);
  return ((h ^ h >>> 13) >>> 0) / 4294967296;
};
const point = (angle, length, x = 0, y = 0) => [x + Math.cos(angle) * length, y + Math.sin(angle) * length * .8];
function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
}
function stroke(ctx, points, color, width = 1) {
  ctx.beginPath(); ctx.moveTo(...points[0]);
  for (const p of points.slice(1)) ctx.lineTo(...p);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
function gradient(ctx, x, y, r, light, dark) {
  const g = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .08, x + r * .18, y + r * .25, r);
  g.addColorStop(0, light); g.addColorStop(1, dark); return g;
}
function leaf(ctx, x, y, angle, length, width, p, tint = 0) {
  const [tx, ty] = point(angle, length, x, y), nx = -Math.sin(angle) * width, ny = Math.cos(angle) * width * .8;
  const cx = (x + tx) * .5, cy = (y + ty) * .5;
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.quadraticCurveTo(cx + nx, cy + ny, tx, ty);
  ctx.quadraticCurveTo(cx - nx, cy - ny, x, y);
  ctx.fillStyle = gradient(ctx, cx, cy, Math.max(length * .65, width), tint ? p.leaf : p.light, p.dark); ctx.fill();
  stroke(ctx, [[x, y], [cx, cy], [tx, ty]], `${p.light}70`, .6);
}
function frond(ctx, x, y, angle, length, p, wide = false) {
  const [tx, ty] = point(angle, length, x, y);
  stroke(ctx, [[x, y], [tx, ty]], p.bark, 1.6);
  for (let j = 1; j < 7; j++) {
    const f = j / 7, xx = x + (tx - x) * f, yy = y + (ty - y) * f;
    const l = length * (wide ? .4 : .25) * Math.sin(f * Math.PI) + 2;
    for (const sign of [-1, 1]) leaf(ctx, xx, yy, angle + sign * .92, l, l * (wide ? .37 : .24), p, j % 3);
  }
  leaf(ctx, tx - Math.cos(angle) * 5, ty - Math.sin(angle) * 4, angle, 8, 2.8, p);
}
function roots(ctx, p, seed, radius = 24) {
  for (let j = 0; j < 6; j++) {
    const a = j * Math.PI / 3 + randomAt(seed, j) * .4, end = point(a, radius * (.7 + randomAt(j, seed) * .3), 0, 7);
    stroke(ctx, [[0, 4], [end[0] * .55, end[1] * .55 + 3], end], p.dark, 5);
    stroke(ctx, [[-1, 3], [end[0] * .55 - 1, end[1] * .55 + 2], [end[0] - 1, end[1] - 1]], p.bark, 2.2);
  }
}
function stone(ctx, x, y, size, p, seed, frost = false) {
  const points = Array.from({ length: 11 }, (_, j) => {
    const a = j / 11 * Math.PI * 2, r = size * (.78 + randomAt(seed, j) * .22);
    return [x + Math.cos(a) * r, y + Math.sin(a) * r * .77];
  });
  const outline = dy => {
    ctx.beginPath();
    const last = points.at(-1); ctx.moveTo((last[0] + points[0][0]) / 2, (last[1] + points[0][1]) / 2 + dy);
    points.forEach((p, i) => { const next = points[(i + 1) % points.length]; ctx.quadraticCurveTo(p[0], p[1] + dy, (p[0] + next[0]) / 2, (p[1] + next[1]) / 2 + dy); });
    ctx.closePath();
  };
  outline(Math.max(1.4, size * .17)); ctx.fillStyle = p.stoneDark; ctx.fill();
  outline(0); ctx.fillStyle = gradient(ctx, x, y, size, p.stoneLight, p.stone); ctx.fill();
  ctx.save(); ctx.clip();
  for (let j = 0; j < 5; j++) {
    const a = randomAt(seed + 31, j) * Math.PI * 2, r = randomAt(seed + 41, j) * size;
    const xx = x + Math.cos(a) * r, yy = y + Math.sin(a) * r * .7;
    ellipse(ctx, xx, yy, size * (.07 + randomAt(j, seed + 5) * .13), size * .06, `${p.stoneDark}28`);
  }
  const crackX = x + size * (randomAt(seed, 91) - .5);
  stroke(ctx, [[crackX - size * .28, y - size], [crackX, y - size * .2], [crackX - size * .16, y + size * .13]], `${p.stoneDark}75`, Math.max(.6, size * .035));
  stroke(ctx, [[crackX - size * .25, y - size], [crackX + 1, y - size * .2]], `${p.stoneLight}80`, .7);
  if (frost) {
    ctx.globalAlpha = .45;
    ellipse(ctx, x - size * .22, y - size * .29, size * .58, size * .2, '#a6b4b3');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function broadleaf(ctx, p, seed, bush = false) {
  if (!bush) roots(ctx, p, seed);
  const count = bush ? 5 : 9;
  for (let j = 0; j < count; j++) {
    const a = j * 2.399 + randomAt(seed, j) * .4, r = (bush ? 11 : 19) * Math.sqrt(j / count);
    const [x, y] = point(a, r, 0, -5);
    stroke(ctx, [[0, 7], [x, y]], p.bark, bush ? 2 : 3);
    ellipse(ctx, x + 1, y + 4, bush ? 15 : 18, bush ? 11 : 14, p.dark);
    for (let k = 0; k < 8; k++) {
      const angle = k * .79 + randomAt(j + seed, k) * .2;
      leaf(ctx, x, y, angle, 13 + randomAt(k, seed + j) * 9, 6 + randomAt(seed + k, j) * 3, p, (k + j) % 3 === 0);
    }
    ellipse(ctx, x - 1, y - 2, 4.5, 3.2, p.leaf);
  }
}
function palm(ctx, p, seed, fern = false) {
  roots(ctx, p, seed, fern ? 14 : 20);
  ellipse(ctx, 0, 2, 6, 5, p.bark);
  for (let j = 0; j < (fern ? 8 : 10); j++) {
    const a = j * Math.PI * 2 / (fern ? 8 : 10) + randomAt(seed, j) * .18;
    frond(ctx, -1, -5, a, (fern ? 30 : 40) + randomAt(j, seed) * 8, p, fern);
  }
  ellipse(ctx, -1, -5, 4, 3.4, p.light);
}
function log(ctx, p, seed, covered = false) {
  const a = randomAt(seed, 51) * 2.2 - 1.1, from = point(a, -32, 0, 1), to = point(a, 32, 0, 1);
  stroke(ctx, [[from[0] + 2, from[1] + 4], [to[0] + 2, to[1] + 4]], p.dark, 15);
  stroke(ctx, [from, to], p.bark, 13);
  stroke(ctx, [[from[0] - 1, from[1] - 3], [to[0] - 1, to[1] - 3]], `${p.stoneLight}90`, 2);
  for (let j = 0; j < 5; j++) {
    const f = .15 + j * .17, x = from[0] + (to[0] - from[0]) * f, y = from[1] + (to[1] - from[1]) * f;
    stroke(ctx, [[x, y - 3], [x - 2, y + 4]], `${p.dark}99`, 1.2);
    if (j === 1 || j === 3) stroke(ctx, [[x, y], [x + 3, y - 14]], p.bark, 3);
  }
  ellipse(ctx, to[0], to[1], 5.6, 4.1, p.stoneLight);
  ellipse(ctx, to[0], to[1], 3.7, 2.5, p.bark);
  if (covered) for (let j = 0; j < 3; j++) frond(ctx, -17 + j * 17, -5, -1.8 + j * .4, 21, p, true);
}
function agave(ctx, p, seed, dry = false) {
  const count = dry ? 13 : 17;
  for (let j = 0; j < count; j++) {
    const a = j * 2.399 + seed, l = 21 + randomAt(seed, j) * 23;
    leaf(ctx, 0, 1, a, l, dry ? 2 : 4 + randomAt(j, seed) * 4, p, j % 3);
  }
  ellipse(ctx, -1, -1, 4.5, 3, p.dark);
  for (let j = 0; j < 5; j++) leaf(ctx, -1, -1, j * 1.256, 13, 4, p);
}
function cactus(ctx, p, seed, cluster = false) {
  const stems = cluster ? [[-18, 5, 12], [16, 10, 11], [0, -10, 16], [29, -7, 9]] : [[0, -4, 19], [-23, -10, 10], [23, 8, 10]];
  if (!cluster) {
    stroke(ctx, [[-23, -5], [-21, 8], [0, 12], [22, 12], [24, 7]], p.dark, 14);
    stroke(ctx, [[-23, -8], [-21, 4], [0, 8], [22, 8], [24, 3]], p.leaf, 10);
  }
  for (const [x, y, r] of stems) {
    ellipse(ctx, x + 1, y + 5, r, r * .8, p.dark);
    ellipse(ctx, x, y, r, r * .78, gradient(ctx, x, y, r, p.light, p.dark));
    for (let j = 0; j < 7; j++) {
      const a = j * Math.PI * 2 / 7;
      stroke(ctx, [[x, y], point(a, r * .85, x, y)], `${p.light}75`, 1);
      const [xx, yy] = point(a, r * .6, x, y);
      stroke(ctx, [[xx - 1, yy], [xx + 1.3, yy - 1.2]], '#c1b99a80', .7);
    }
    ellipse(ctx, x - 1, y - 1, 2.2, 1.8, p.bark);
  }
}
function scrub(ctx, p, seed, leafy = false) {
  roots(ctx, p, seed, 13);
  for (let j = 0; j < 11; j++) {
    const a = j * 2.399 + randomAt(seed, j), l = 17 + randomAt(j, seed) * 24;
    const end = point(a, l, 0, -2), mid = point(a + .2, l * .55, 0, -2);
    stroke(ctx, [[0, 3], mid, end], p.dark, 3);
    stroke(ctx, [[-1, 2], [mid[0] - 1, mid[1] - 1], [end[0] - 1, end[1] - 1]], p.bark, 1.5);
    for (const s of [-1, 1]) {
      const fork = point(a + s * .7, l * .35, ...mid);
      stroke(ctx, [mid, fork], p.bark, 1.2);
      if (leafy) leaf(ctx, ...mid, a + s * .7, l * .38, 3.5, p, j % 2);
    }
  }
}
function conifer(ctx, p, seed, bush = false) {
  roots(ctx, p, seed, 17);
  const layers = bush ? 2 : 3;
  for (let layer = 0; layer < layers; layer++) {
    const r = 43 - layer * 11;
    for (let j = 0; j < 10; j++) {
      const a = j * .628 + layer * .31 + randomAt(seed, j) * .12;
      const len = r * (.8 + randomAt(j + layer, seed) * .2);
      frond(ctx, 0, -layer * 4, a, len, p);
    }
  }
  ellipse(ctx, -1, -9, 3, 3, p.light);
}
function groundPlant(ctx, p, env, seed) {
  if (env === 'jungle') {
    for (let j = 0; j < 3; j++) {
      const x = -19 + j * 19, y = (randomAt(seed, j) - .5) * 16;
      for (let k = 0; k < 6; k++) frond(ctx, x, y, k * 1.047 + j, 15 + randomAt(seed + j, k) * 7, p, true);
    }
  } else if (env === 'desert' && seed % 2) agave(ctx, p, seed, true);
  else {
    for (let j = 0; j < 4; j++) {
      const x = (randomAt(seed, j) - .5) * 47, y = (randomAt(j, seed + 11) - .5) * 24;
      ellipse(ctx, x + 2, y + 3, 9, 4, `${p.dark}90`);
      for (let k = 0; k < 9; k++) {
        const angle = -.3 - k * .33 + randomAt(seed + j, k) * .2, length = 9 + randomAt(seed + k, j) * 13;
        const end = point(angle, length, x, y), mid = [(x + end[0]) * .5 - 2, (y + end[1]) * .5 - 2];
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(...mid, ...end);
        ctx.strokeStyle = k % 3 ? p.leaf : p.light; ctx.lineWidth = k % 2 ? 1.3 : .8; ctx.lineCap = 'round'; ctx.stroke();
      }
    }
  }
}
function debris(ctx, p, env, seed) {
  // Abandoned plates, pipe and a broken cable. Never use faction paint or lamps:
  // this wreckage must not be mistaken for a live unit or a resource deposit.
  const x = (randomAt(seed, 0) - .5) * 14, y = (randomAt(seed, 1) - .5) * 8;
  ctx.beginPath(); ctx.moveTo(x - 25, y - 16); ctx.lineTo(x + 12, y - 21); ctx.lineTo(x + 23, y + 8); ctx.lineTo(x + 9, y + 18); ctx.lineTo(x - 20, y + 9); ctx.closePath();
  ctx.fillStyle = gradient(ctx, x, y, 38, p.metal, p.stoneDark); ctx.fill();
  stroke(ctx, [[x - 25, y - 16], [x + 12, y - 21], [x + 18, y - 6]], `${p.stoneLight}70`, 1.3);
  for (let j = 0; j < 3; j++) stroke(ctx, [[x - 16 + j * 8, y - 12], [x - 9 + j * 8, y + 5]], `${p.stoneDark}bb`, 2.4);
  ellipse(ctx, x - 12, y + 2, 7, 4, `${p.rust}88`);
  stroke(ctx, [[-33, 14], [-17, 22], [-5, 19], [9, 31]], p.dark, 3);
  stroke(ctx, [[12, -24], [29, -15], [34, 4]], p.stoneDark, 8);
  stroke(ctx, [[11, -26], [28, -17], [33, 2]], p.metal, 5);
  ellipse(ctx, 33, 2, 3, 2, p.dark);
  if (env === 'jungle') for (let j = 0; j < 4; j++) leaf(ctx, -19 + j * 8, 14, -1.5 + j * .6, 14, 4, p, j % 2);
  if (env === 'tundra') { ctx.globalAlpha = .4; ellipse(ctx, -9, -12, 13, 2.3, '#a1aeac'); ctx.globalAlpha = 1; }
}
function paint(ctx, env, kind, variant) {
  const p = palettes[env], seed = variant * 131 + ['ash', 'jungle', 'desert', 'tundra'].indexOf(env) * 997;
  ctx.translate(PIXELS / 2, PIXELS / 2);
  if (kind === 'plant') return groundPlant(ctx, p, env, seed);
  if (kind === 'debris') return debris(ctx, p, env, seed);
  if (kind === 'stones') {
    for (let j = 0; j < 5; j++) {
      const x = (randomAt(seed, j) - .5) * 70, y = (randomAt(j, seed + 1) - .5) * 43;
      stone(ctx, x, y, 5 + randomAt(seed + 2, j) * 9, p, seed + j, env === 'tundra' && j % 2 === 0);
    }
    return;
  }
  if (env === 'jungle') {
    if (variant === 0) broadleaf(ctx, p, seed);
    else if (variant === 1) palm(ctx, p, seed);
    else if (variant === 2) palm(ctx, p, seed, true);
    else if (variant === 3) broadleaf(ctx, p, seed, true);
    else if (variant === 4) { roots(ctx, p, seed, 29); stone(ctx, 0, 0, 17, { ...p, stone: p.bark, stoneLight: '#8a8064', stoneDark: p.dark }, seed); ellipse(ctx, -1, -3, 9, 6, p.dark); }
    else log(ctx, p, seed, true);
  } else if (env === 'desert') {
    if (variant === 0 || variant === 3) cactus(ctx, p, seed, variant === 3);
    else if (variant === 1 || variant === 4) agave(ctx, p, seed, variant === 4);
    else if (variant === 2) scrub(ctx, p, seed, true);
    else log(ctx, p, seed);
  } else {
    if (variant === 1) {
      ctx.save(); ctx.translate(-15, -5); ctx.scale(.72, .72); conifer(ctx, p, seed); ctx.restore();
      ctx.save(); ctx.translate(18, 12); ctx.scale(.5, .5); conifer(ctx, p, seed + 17); ctx.restore();
    } else if (variant < 3) conifer(ctx, p, seed, variant === 2);
    else if (variant === 3) scrub(ctx, p, seed, true);
    else if (variant === 4) scrub(ctx, p, seed);
    else log(ctx, p, seed);
  }
}
function sprite(environmentId, kind, variant) {
  if (!Object.hasOwn(palettes, environmentId) || !kinds.has(kind) || environmentId === 'ash' && kind === 'tree') return null;
  const count = 6;
  variant = ((Math.floor(Number.isFinite(variant) ? variant : 0) % count) + count) % count;
  const key = `${environmentId}:${kind}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  const image = document.createElement('canvas'); image.width = image.height = PIXELS;
  const context = image.getContext('2d');
  paint(context, environmentId, kind, variant);
  // A restrained material grain ties the drawn shapes to the authored scenery.
  // Alpha stays untouched, avoiding fringes and preserving clean small silhouettes.
  const pixels = context.getImageData(0, 0, PIXELS, PIXELS), data = pixels.data;
  for (let y = 0; y < PIXELS; y++) for (let x = 0; x < PIXELS; x++) {
    const at = (y * PIXELS + x) * 4;
    if (data[at + 3] < 32) continue;
    const grain = (randomAt(x + variant * 31, y) - .5) * 5;
    data[at] += grain; data[at + 1] += grain; data[at + 2] += grain;
  }
  context.putImageData(pixels, 0, 0);
  const shadow = document.createElement('canvas'); shadow.width = shadow.height = PIXELS;
  const s = shadow.getContext('2d');
  s.filter = `blur(${kind === 'tree' ? 2.3 : 1.5}px)`;
  s.drawImage(image, kind === 'tree' ? 5 : 2, kind === 'tree' ? 8 : 3); s.filter = 'none';
  s.globalCompositeOperation = 'source-in'; s.fillStyle = kind === 'tree' ? '#0b151c75' : '#0b151c65'; s.fillRect(0, 0, PIXELS, PIXELS);
  const value = { image, shadow }; cache.set(key, value); return value;
}
export function drawEnvironmentProp(ctx, environmentId, kind, x, y, size, variant = 0) {
  const frame = sprite(environmentId, kind, variant);
  if (!frame) return false;
  ctx.drawImage(frame.image, x - size / 2, y - size / 2, size, size); return true;
}
export function drawEnvironmentPropShadow(ctx, environmentId, kind, x, y, size, variant = 0) {
  const frame = sprite(environmentId, kind, variant);
  if (!frame) return false;
  ctx.drawImage(frame.shadow, x - size / 2, y - size / 2, size, size); return true;
}
export function releaseEnvironmentProps() {
  for (const { image, shadow } of cache.values()) { image.width = image.height = shadow.width = shadow.height = 0; }
  cache.clear();
}
