import { spriteCell, spriteRevision, spritesReady } from './sprite-assets.js';

const SIZE = 128, HALF = SIZE / 2, TAU = Math.PI * 2;
const textures = new Map(), layouts = new Map(), requested = new Map();
let revision = -1;
// The opaque body occupies a known part of the canvas, independent of how much
// transparent glow surrounds the generated atlas art. Gameplay radii still
// determine each projectile's apparent size.
const FRIENDLY = Object.freeze({
  pulse: { cell: 0, body: [28, 88], frame: [8, 11.6] },
  scatter: { cell: 1, body: [32, 32], frame: [8, 8] },
  lance: { cell: 2, body: [14, 96], frame: [8, 14] },
  seeker: { cell: 3, body: [34, 70], frame: [8, 10] },
  plasma: { cell: 4, body: [32, 32], frame: [8, 8] },
  arc: { cell: 5, body: [28, 72], frame: [8, 10] },
});
const HOSTILE = Object.freeze([
  { cell: 6, body: [32, 32], frame: [8, 8] },
  { cell: 7, body: [32, 40], frame: [8, 8] },
  { cell: 8, body: [32, 32], frame: [8, 8] },
  { cell: 9, body: [28, 52], frame: [8, 8] },
  { cell: 10, body: [14, 68], frame: [8, 8] },
  { cell: 11, body: [56, 56], frame: [8, 8] },
]);

function surface() {
  const canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(SIZE, SIZE);
  canvas.width = canvas.height = SIZE;
  return canvas;
}
function profile(bullet) {
  return bullet.team >= 0 ? FRIENDLY[bullet.kind] || FRIENDLY.pulse : HOSTILE[bullet.variant] || HOSTILE[0];
}
function tintSource(source, color) {
  const canvas = surface(); canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
  const value = Number.parseInt(color.slice(1), 16), target = [value >> 16 & 255, value >> 8 & 255, value & 255];
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const luminance = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255;
    const bright = Math.max(data[i], data[i + 1], data[i + 2]) / 255;
    const highlight = Math.max(0, (luminance - .75) / .25) ** 2;
    const shade = .18 + bright * .82;
    for (let channel = 0; channel < 3; channel++) data[i + channel] = target[channel] * shade * (1 - highlight) + 255 * highlight;
    if (data[i + 3] >= 120 && bright > .23) {
      const pixel = i / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  context.putImageData(pixels, 0, 0);
  const bounds = right < left ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  return { canvas, bounds };
}
function fallback(context, info, color) {
  const [width, height] = info.body;
  context.save(); context.translate(HALF, HALF);
  context.fillStyle = color; context.strokeStyle = '#06131b'; context.lineWidth = 3;
  context.beginPath();
  if ([0, 2, 10].includes(info.cell)) context.roundRect(-width / 2, -height / 2, width, height, width / 2);
  else if ([3, 9].includes(info.cell)) {
    context.moveTo(0, -height / 2); context.lineTo(width / 2, height / 2); context.lineTo(0, height * .24); context.lineTo(-width / 2, height / 2); context.closePath();
  } else if ([5, 7].includes(info.cell)) {
    context.moveTo(0, -height / 2); context.lineTo(width / 2, 0); context.lineTo(0, height / 2); context.lineTo(-width / 2, 0); context.closePath();
  } else context.arc(0, 0, width / 2, 0, TAU);
  context.stroke(); context.fill();
  if ([8, 11].includes(info.cell)) {
    context.fillStyle = '#10232a'; context.beginPath(); context.arc(0, 0, width * .27, 0, TAU); context.fill();
    if (info.cell === 11) {
      context.strokeStyle = color; context.lineWidth = 5;
      context.beginPath(); context.moveTo(-width / 2, 0); context.lineTo(width / 2, 0);
      context.moveTo(0, -height / 2); context.lineTo(0, height / 2); context.stroke();
    }
  }
  context.fillStyle = '#fffcec';
  context.beginPath(); context.ellipse(-width * .08, -height * .15, Math.max(1.5, width * .1), Math.max(2, height * .22), 0, 0, TAU); context.fill();
  context.restore();
}

export function projectileTexture(bullet) {
  if (revision !== spriteRevision) { textures.clear(); revision = spriteRevision; }
  const info = profile(bullet), color = bullet.weaponColor || bullet.color || '#ffffff', key = `${info.cell}:${color}`;
  if (textures.has(key)) return textures.get(key);
  if (textures.size >= 128) { const oldest = textures.keys().next().value; textures.delete(oldest); requested.delete(oldest); }
  requested.set(key, { team: bullet.team, kind: bullet.kind, variant: bullet.variant, color });
  const canvas = surface(), context = canvas.getContext('2d'), source = spriteCell('projectiles', info.cell);
  const glow = context.createRadialGradient(HALF, HALF, 1, HALF, HALF, HALF * .92);
  glow.addColorStop(0, `${color}6b`); glow.addColorStop(.33, `${color}22`); glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow; context.fillRect(0, 0, SIZE, SIZE);
  if (source) {
    const { canvas: tinted, bounds } = tintSource(source, color);
    const scale = Math.min(info.body[0] / bounds.width, info.body[1] / bounds.height);
    const x = HALF - (bounds.x + bounds.width / 2) * scale, y = HALF - (bounds.y + bounds.height / 2) * scale;
    context.shadowColor = '#06101bd9'; context.shadowBlur = 2.5; context.shadowOffsetY = 1.5;
    context.drawImage(tinted, x, y, tinted.width * scale, tinted.height * scale);
  } else fallback(context, info, color);
  textures.set(key, canvas);
  return canvas;
}

/** Dimensions for a centered sprite, before rotation to the bullet velocity. */
export function projectileLayout(bullet) {
  const info = profile(bullet), radius = Math.max(.1, bullet.radius || 3), key = `${info.cell}:${radius}`;
  if (!layouts.has(key)) layouts.set(key, Object.freeze({ width: info.frame[0] * radius, height: info.frame[1] * radius, offsetY: 0 }));
  return layouts.get(key);
}

/** Submit a volley in painter order, retaining the camera transform only once. */
export function drawProjectiles(ctx, bullets, alpha = 1, width = Infinity, height = Infinity) {
  if (!bullets.length) return;
  const { a, b, c, d, e, f } = ctx.getTransform();
  ctx.save(); ctx.globalCompositeOperation = 'source-over';
  for (const bullet of bullets) {
    const layout = projectileLayout(bullet);
    const x = (bullet.px ?? bullet.x) + (bullet.x - (bullet.px ?? bullet.x)) * alpha;
    const y = (bullet.py ?? bullet.y) + (bullet.y - (bullet.py ?? bullet.y)) * alpha;
    // Account for the entire rotated glow and the flight camera's shake margin.
    const pad = (layout.width + layout.height) * .5 + Math.abs(layout.offsetY) + 32;
    if (!b && !c && (x < -pad || x > width + pad || y < -pad || y > height + pad)) continue;
    const angle = Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    ctx.setTransform(a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin,
      a * x + c * y + e, b * x + d * y + f);
    ctx.drawImage(projectileTexture(bullet), -layout.width / 2, -layout.height / 2 + layout.offsetY, layout.width, layout.height);
  }
  ctx.restore();
}

export function warmProjectileTextures(weapons = [], spectrum = []) {
  for (const weapon of weapons) projectileTexture({ team: 0, kind: weapon.kind || weapon.id, weaponColor: weapon.color });
  spectrum.forEach((color, type) => projectileTexture({ team: -1, color, variant: type === 9 ? 5 : type % 5 }));
}

spritesReady.then(() => {
  textures.clear(); revision = spriteRevision;
  for (const bullet of requested.values()) projectileTexture(bullet);
});
