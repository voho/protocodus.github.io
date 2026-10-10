import { nextPaint } from './loading.js';
import { drawSprite, drawSpriteShadow, drawSpriteOverlay, releaseSpriteOverlays, drawProp, drawPropShadow, terrainImages, assetsReady, unitSpriteAngle } from './assets.js';
import { powerStats, UNITS, BUILDINGS as BUILDING_DEFS, unitRank, unitRange, buildingRole, unitRole } from './sim.js';
import { mapRoutes, PROFILE_RELIEF } from './terrain.js';
import { ABILITIES } from './abilities.js';
import { missionDefinition } from './mission.js';

const TILE = 32;
const TEAM = [
  { light: '#dcf1ff', paint: '#2d7cf2', dark: '#163b75', glow: '#79bcff' },
  { light: '#ffd8d5', paint: '#d8344c', dark: '#6d142b', glow: '#ff7582' },
];
const SIZES = Object.assign(Object.create(null), Object.fromEntries(Object.entries(BUILDING_DEFS).map(([type, d]) => [type, d.size])));
const entityRole = e => buildingRole(unitRole(e));
const wallKey = e => `${e.team}:${e.x}:${e.y}`;
function wallConnections(e, walls) {
  let bits = 0;
  for (const [dx, dy, bit] of [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]) if (walls.has(`${e.team}:${e.x + dx}:${e.y + dy}`)) bits |= bit;
  return bits;
}
const BUILDINGS = new Set(Object.keys(SIZES));
const isInfantry = e => UNITS[e.type]?.armor === 'infantry';
// Basalt only forms a plate where at least two orthogonal neighbours share it; lone rubble stays ash.
function coherentBasalt(state, i, x, y) {
  if (state.terrain[i] !== 2) return false;
  let n = 0;
  if (x > 0 && state.terrain[i - 1] === 2) n++;
  if (x < state.width - 1 && state.terrain[i + 1] === 2) n++;
  if (y > 0 && state.terrain[i - state.width] === 2) n++;
  if (y < state.height - 1 && state.terrain[i + state.width] === 2) n++;
  return n >= 2;
}

function polygon(ctx, points, fill, stroke) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}
function teamInsignia(ctx, team, x, y, size) {
  const t = TEAM[team] || TEAM[0], r = size / 2;
  const shape = team ? [[x, y - r], [x + r, y], [x, y + r], [x - r, y]]
    : [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  polygon(ctx, shape, t.paint, t.light);
}
function ellipse(ctx, x, y, rx, ry, fill, stroke) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function line(ctx, x, y, tx, ty, color, width = 1) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function noise(x, y, seed = 0) {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 73.13) * 43758.5453;
  return v - Math.floor(v);
}
function smoothNoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (noise(ix, iy, seed) * (1 - u) + noise(ix + 1, iy, seed) * u) * (1 - v)
    + (noise(ix, iy + 1, seed) * (1 - u) + noise(ix + 1, iy + 1, seed) * u) * v;
}
// Code-drawn gradients, lamps, smoke and fire are baked once into small sprites and scaled with
// drawImage: a radial gradient or shadowBlur per call was the renderer's largest state churn.
const SPRITE_RADIUS = 48;
const spriteCache = new Map();
function cachedSprite(key, size, paint, build) {
  let sprite = spriteCache.get(key);
  if (!sprite) {
    if (build) sprite = build();
    else { sprite = document.createElement('canvas'); sprite.width = sprite.height = size; paint(sprite.getContext('2d'), size); }
    spriteCache.set(key, sprite);
  }
  return sprite;
}
// Stop lists are module constants, so each remembers its own cache key.
function radialSprite(stops, key = stops.key ??= stops.join()) {
  return cachedSprite(key, SPRITE_RADIUS * 2, (c, size) => {
    const gradient = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (let i = 0; i < stops.length; i += 2) gradient.addColorStop(stops[i], stops[i + 1]);
    c.fillStyle = gradient; c.fillRect(0, 0, size, size);
  });
}
function glowSprite(color) { return spriteCache.get(color) || radialSprite([0, color, 1, color.slice(0, 7) + '00'], color); }
function glow(ctx, x, y, radius, color) {
  if (radius > 0) ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
}
function stamp(ctx, sprite, x, y, rx, ry = rx) {
  ctx.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2);
}
// Explosion soot and fire keep their original colour stops.
const SOOT = [0, '#373532b0', .55, '#42403b84', 1, '#42403b00'];
const FIRE = [0, '#fff3c9', .22, '#ffd193', .55, '#f39840ca', 1, '#bd4c2400'];
const DARK_SMOKE = [0, '#28292bd0', 1, '#28292b00'];
const STEAM = [0, '#c6c4bcd0', 1, '#c6c4bc00'];
const FLAME = [0, '#fff1c2', .3, '#ffc061e6', .65, '#e8642acc', 1, '#a8301800'];
const COOLANT = [0, '#eefaff', .35, '#9fd6ece0', 1, '#5c9fc000'];
const SCORCH = [0, '#0e161de0', .45, '#19202790', 1, '#19202700'];
const BEACON = [0, '#ffe2b0', .35, '#e2b67e88', 1, '#e2b67e00'];
const TRAIL = [0, '#b8b3a5', .6, '#b8b3a5a0', 1, '#b8b3a500'];
const COLUMN = [0, '#6d6a62b0', .55, '#5f5c5578', 1, '#5f5c5500'];
// Text labels are rasterised once at twice their CSS size so they stay crisp on dense displays.
function labelSprite(text, color, font = '600 10px monospace') {
  return cachedSprite(`label:${font}:${color}:${text}`, 0, null, () => {
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    const c = document.createElement('canvas'), w = Math.ceil(probe.measureText(text).width) + 10;
    c.width = w * 2; c.height = 32;
    const g = c.getContext('2d'); g.scale(2, 2);
    g.fillStyle = '#0a151dc4'; g.fillRect(0, 2, w, 12);
    g.font = font; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 5, 8.5);
    return c;
  });
}
// A ring of filled sandbags (Organics) or braced armour plates (Unity) for Dig in / Brace protocol.
function digInSprite(unity) {
  return cachedSprite(`dig:${unity}`, 96, (c, size) => {
    c.translate(size / 2, size / 2);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + .2, x = Math.cos(a) * 34, y = Math.sin(a) * 22;
      c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2);
      if (unity) {
        c.fillStyle = '#20303a'; c.fillRect(-9, -3.5, 18, 7);
        c.fillStyle = '#5e7884'; c.fillRect(-8, -3, 16, 2.4);
        c.fillStyle = '#9fd3dc'; c.fillRect(-3, 2, 6, 1.2);
      } else {
        c.fillStyle = '#2b2a25'; c.beginPath(); c.ellipse(1, 1.5, 10, 5.5, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#8d8063'; c.beginPath(); c.ellipse(0, 0, 9.5, 5, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#b6a985'; c.beginPath(); c.ellipse(-1.5, -1.6, 6, 2, 0, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
  });
}
export function releaseRenderSprites() {
  for (const sprite of spriteCache.values()) sprite.width = sprite.height = 0;
  spriteCache.clear();
}
// Word-wise comparison of two equally sized byte grids (fog grids are multiples of four cells).
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  if (a.length % 4 || a.byteOffset % 4 || b.byteOffset % 4) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length / 4), y = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
// The visible pose and animation clock between two 50 ms ticks; age < 0 means "not yet".
const pulse = (age, length) => age < 0 ? 0 : Math.max(0, 1 - age / length);
const shortestArc = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const SHELL_FLIGHT = .35, GRAVITY = 260, PARTICLE_LIMIT = 900, HIT_FLASH = .11;
const SHAKE_LENGTH = .55, SHAKE_LIMIT = 4, VIGNETTE_STEP = 8;
const WRECK = '#0d0f10';
const ASH_LAYERS = [
  { share: .5, depth: .45, parallax: .92, fall: 7, size: .9, alpha: .16 },
  { share: .32, depth: .75, parallax: 1, fall: 12, size: 1.3, alpha: .22 },
  { share: .18, depth: 1, parallax: 1.1, fall: 19, size: 1.9, alpha: .28 },
];
// One blast in world pixels; age runs 0..1. A ground-light flash and a thin shockwave ring lead the
// fireball, soot and sparks; every soft shape is a cached sprite rather than a per-call gradient.
function explosion(ctx, x, y, size, age, alpha, seedX, seedY) {
  const s = Math.sqrt(size), r = (5 + age * 28) * s, flash = Math.max(0, 1 - age * 2.6);
  if (flash > 0) {
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash * .3;
    stamp(ctx, glowSprite('#ffb66eff'), x, y + 4, 46 * s, 30 * s);
    ctx.globalCompositeOperation = 'source-over';
  }
  const wave = Math.min(1, age * 1.9);
  if (wave < 1) {
    ctx.globalAlpha = (1 - wave) ** 1.6 * .55; ctx.strokeStyle = '#f2dcbc'; ctx.lineWidth = .5 + (1 - wave) * 1.8;
    ctx.beginPath(); ctx.ellipse(x, y + 5, (8 + wave * 44) * s, (5 + wave * 27) * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = Math.max(0, alpha - .12);
  const soot = radialSprite(SOOT), fire = radialSprite(FIRE);
  for (let j = 0; j < 7; j++) {
    const a = j * 2.4 + noise(seedX, j) * 2, drift = r * (.25 + noise(j, seedY) * .5);
    stamp(ctx, soot, x + Math.cos(a) * drift + age * 9, y + Math.sin(a) * drift * .6 - age * s * 19, r * .62);
  }
  ctx.globalAlpha = Math.min(1, alpha * 1.4);
  glow(ctx, x, y - r * .18, r * .84, '#ef8e347d');
  ctx.globalAlpha = alpha * alpha;
  for (let j = 0; j < 5; j++) {
    const a = j * 2.4, reach = r * age * .4;
    stamp(ctx, fire, x + Math.cos(a) * reach, y + Math.sin(a) * reach * .6 - age * s * 12, r * (.25 + flash * .22));
  }
  ctx.globalAlpha = flash;
  glow(ctx, x, y, 40 * s, '#ffd7a36b');
  ctx.globalAlpha = alpha; ctx.beginPath();
  for (let j = 0; j < 10; j++) {
    const a = j * 2.4 + seedX, reach = r * (1 + noise(j, seedY) * .8), lift = Math.sin(age * Math.PI) * (5 + j % 3 * 6) * s;
    const dx = x + Math.cos(a) * reach, dy = y + Math.sin(a) * reach * .6 - lift;
    ctx.moveTo(dx, dy); ctx.lineTo(dx - Math.cos(a) * (2 + alpha * 5), dy - Math.sin(a) * 3);
  }
  ctx.strokeStyle = '#f0cd92c8'; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;
}
function rock(ctx, x, y, size, variant) {
  if (drawProp(ctx, 'rock', x, y, size, variant)) return;
  ctx.save(); ctx.translate(x, y);
  const r = size * .5;
  ellipse(ctx, 6, 7, r, r * .6, '#10141675');
  polygon(ctx, [[-r, 3], [-r * .7, -r * .6], [-r * .15, -r], [r * .7, -r * .6], [r, 2], [r * .3, r * .45], [-r * .65, r * .4]], '#4a4945', '#292c2c');
  polygon(ctx, [[-r, 3], [-r * .7, -r * .6], [-r * .15, -r], [r * .25, -r * .4], [-r * .2, r * .2]], '#8b8271');
  polygon(ctx, [[-r * .15, -r], [r * .7, -r * .6], [r, 2], [-r * .2, r * .2], [r * .25, -r * .4]], '#67645b');
  line(ctx, -r * .7, -r * .6, -r * .15, -r, '#c2b39770');
  line(ctx, -r * .1, -r * .3, r * .1, r * .18, '#282d2e88');
  ctx.restore();
}
function construction(ctx, entity, time) {
  const s = (entity.size || SIZES[entity.type]) * TILE, p = entity.progress;
  ctx.save();
  ctx.beginPath(); ctx.rect(-s, s * .5 - s * 1.6 * p, s * 2, s * 1.6 * p); ctx.clip();
  drawSprite(ctx, entity, time);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = '#89dce08c'; ctx.lineWidth = .7;
  ctx.strokeRect(-s * .49, -s * .49, s * .98, s * .98);
  ctx.setLineDash([3, 4]); ctx.strokeRect(-s * .44, -s * .44, s * .88, s * .88); ctx.setLineDash([]);
  const scan = s * (.5 - p * 1.6);
  line(ctx, -s * .48, scan, s * .48, scan, '#b8f1f4a0', 1);
  glow(ctx, Math.sin(time * 3) * s * .4, scan, 6, '#a4eff2bb');
  rect(ctx, -s * .43, s * .55, s * .86, 3, '#0c151deb');
  rect(ctx, -s * .43, s * .55, s * .86 * p, 2, '#9de4e5');
  ctx.restore();
}
function box(ctx, x, y, w, d, h, roof = '#777c71', wall = '#454b46') {
  rect(ctx, x + 5, y + 5, w, d, '#151a17aa');
  polygon(ctx, [[x, y - h], [x + w, y - h], [x + w, y + d - h], [x, y + d - h]], roof, '#252d29');
  polygon(ctx, [[x, y + d - h], [x + w, y + d - h], [x + w, y + d], [x, y + d]], wall, '#252d29');
  line(ctx, x, y - h, x + w, y - h, '#c5c3a662');
  line(ctx, x, y - h, x, y + d - h, '#c5c3a642');
  line(ctx, x + w - 1, y - h + 1, x + w - 1, y + d - h, '#202d2960');
}
function vent(ctx, x, y, w, h) {
  rect(ctx, x, y, w, h, '#303e39');
  for (let yy = y + 2; yy < y + h - 1; yy += 3) line(ctx, x + 2, yy, x + w - 2, yy, '#8a948176');
}
// A 2 px lamp with its soft halo, baked at four times world resolution.
function light(ctx, x, y, color) {
  ctx.drawImage(cachedSprite(`light:${color}`, 64, (c, size) => {
    c.shadowColor = color; c.shadowBlur = 16; c.fillStyle = color; c.fillRect(size / 2 - 4, size / 2 - 4, 8, 8);
  }), x - 7, y - 7, 16, 16);
}
function crystal(ctx, x, y, scale, seed) {
  const h = (5 + noise(seed, 2) * 7) * scale;
  const w = (3 + noise(seed, 3) * 3) * scale;
  polygon(ctx, [[x - w, y], [x - w * .5, y - h * .8], [x + w * .25, y - h], [x + w, y - h * .22], [x + w * .4, y + 2 * scale]], '#51b8a5', '#1e685f');
  polygon(ctx, [[x - w * .5, y - h * .8], [x + w * .25, y - h], [x, y], [x - w, y]], '#9eecce');
  line(ctx, x + w * .25, y - h, x, y, '#d3ffe2', .8);
}

function buildingActivity(ctx, e, time, power) {
  if (BUILDING_DEFS[e.type]?.race === 'aiUnity') { unityActivity(ctx, e, time, power); return; }
  const s = e.size * TILE, t = TEAM[e.team], working = !!e.queue?.length;
  const processing = e.processingAmount > 0;
  if (['barracks', 'factory', 'refinery'].includes(entityRole(e)) && !working && !processing) return;
  const rate = entityRole(e) === 'reactor' || entityRole(e) === 'core' ? 1 : Math.max(.08, power);
  const phase = time * rate + e.id * .37;
  ctx.save(); ctx.globalAlpha *= power < 1 && rate < 1 ? .55 : .85;
  if (entityRole(e) === 'core') {
    const x = s * .29, y = -s * .46, angle = phase * .75;
    ellipse(ctx, x, y, 8, 5.5, '#2031399c', '#a7b7b775');
    ctx.save(); ctx.translate(x, y); ctx.scale(1, .7);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 7, angle - .75, angle); ctx.closePath();
    ctx.fillStyle = t.paint + '60'; ctx.fill();
    line(ctx, 0, 0, Math.cos(angle) * 7, Math.sin(angle) * 7, t.light, .9); ctx.restore();
    light(ctx, -s * .16, s * .23, Math.sin(phase * 2.5) > .4 ? '#f4c784' : '#806743');
    if (processing) for (let i = 0; i < 3; i++) {
      const p = (phase * .45 + i / 3) % 1, x = (i - 1) * 4, y = s * (.43 - p * .12);
      polygon(ctx, [[x - 1.5, y], [x, y - 2], [x + 1.5, y], [x, y + 1]], '#a4ddc8');
    }
  } else if (entityRole(e) === 'reactor') {
    // Slow pressure needles and work lamps suit the obsolete sealed boiler drums.
    for (const x of [-s * .24, s * .24]) {
      const y = -s * .40, angle = -.8 + Math.sin(phase * .7 + x) * .12;
      ellipse(ctx, x, y, 2.5, 1.7, '#263038', '#a1a8a080');
      line(ctx, x, y, x + Math.cos(angle) * 1.8, y + Math.sin(angle) * 1.3, '#dacba8', .6);
    }
    light(ctx, -s * .10, s * .25, Math.sin(phase * 1.3) > -.4 ? '#dabc86' : '#806641');
    light(ctx, s * .10, s * .25, Math.sin(phase * 1.3) < .4 ? '#dabc86' : '#806641');
  } else if (entityRole(e) === 'refinery') {
    if (processing) {
      // The belt runs only while an actual delivery remains in the processing hopper.
      for (let i = 0; i < 5; i++) {
        const p = (phase * .19 + i / 5) % 1, x = s * (-.32 + p * .43), y = s * (.12 - p * .40);
        polygon(ctx, [[x - 1.8, y], [x, y - 2], [x + 2, y], [x, y + 1]], e.processingType === 3 ? '#ef9eb1' : e.processingType === 2 ? '#8ec7f0' : '#b1e8d2');
      }
      light(ctx, -s * .06, s * .28, Math.sin(phase * 3) > 0 ? '#b6efd5' : '#466e5e');
    }
    if (working) light(ctx, s * .08, s * .33, Math.sin(phase * 4) > 0 ? '#f1c58b' : '#8c6840');
  } else if (entityRole(e) === 'barracks') {
    light(ctx, -s * .32, -s * .44, Math.sin(phase * 2.3) > .5 ? t.light : t.dark);
    if (working) {
      const stride = (phase * .6) % 1;
      for (let i = 0; i < 3; i++) rect(ctx, -7 + i * 6, s * .25, 3, 1.5, stride > i / 3 ? '#ebc68f' : '#64553c');
    }
  } else if (entityRole(e) === 'factory') {
    if (working) {
      const x = Math.sin(phase * 1.6) * s * .09, y = s * .21;
      ctx.save(); ctx.globalAlpha *= .5 + Math.sin(phase * 23) * .25;
      glow(ctx, x, y, 9, '#c7eeff8f');
      for (let i = 0; i < 3; i++) {
        const age = (phase * 3 + i / 3) % 1;
        line(ctx, x + age * (i - 1) * 10, y + age * 5, x + age * (i - 1) * 12, y + age * 7, '#ffe0a9b0', .7);
      }
      ctx.restore();
      const door = Math.max(0, (e.queue[0].progress - .8) / .2);
      line(ctx, -s * .15, s * (.15 - door * .035), s * .15, s * (.15 - door * .035), '#dcb46b9c', 1.4);
    }
  } else if (entityRole(e) === 'lab') {
    // The laboratory follows actual project progress, so no free-running research under fog or while idle.
    if (e.research) {
      const progress = Math.max(0, Math.min(1, e.research.progress || 0)), y = -s * .24;
      ctx.save(); ctx.translate(0, y); ctx.scale(1, .86);
      ctx.beginPath(); ctx.arc(0, 0, s * .14, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = power < 1 ? '#b99165' : '#a2d9e2'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.restore();
      for (let i = 0; i < 3; i++) light(ctx, -5 + i * 4, s * .25, (phase * 2) % 3 > i ? '#d6e5da' : '#394d51');
    }
  } else if (entityRole(e) === 'capacitor') {
    const fill = Math.max(0, Math.min(1, (e.reserve || 0) / 1200));
    rect(ctx, -6, s * .23, 12, 4, '#142027');
    for (let i = 0; i < 4; i++) rect(ctx, -5 + i * 2.8, s * .23 + 1, 1.8, 2, fill > i / 4 ? e.powerStatus === 'reserve' ? '#edb66f' : '#a7dcd1' : '#3d514f');
  } else if (entityRole(e) === 'rocketTower') {
    const ready = power >= 1, firing = pulse(time - (e.lastShot ?? -99), .35);
    for (const x of [-s * .28, s * .28]) {
      light(ctx, x, s * .26, !ready ? '#70533b' : e.cooldown > .1 ? '#bb8d51' : t.light);
    }
    if (ready && firing > 0) {
      ctx.globalAlpha *= firing;
      glow(ctx, -s * .231, -s * .405, 12, '#ffcf8aac');
    }
  } else if (entityRole(e) === 'turret') {
    const angle = e.targetId ? e.angle : phase * .3, recoil = pulse(time - (e.lastShot ?? -99), .22);
    const reach = 13 - recoil * 3;
    ctx.save(); ctx.translate(0, -7); ctx.scale(1, .8);
    ctx.beginPath(); ctx.arc(0, 0, reach, angle - .2, angle + .2);
    ctx.strokeStyle = e.targetId ? '#eec48e' : t.paint + '9c'; ctx.lineWidth = 1.5; ctx.stroke();
    if (recoil > 0 && power >= 1) {
      ctx.globalAlpha *= recoil;
      glow(ctx, Math.cos(angle) * 17, Math.sin(angle) * 17, 6, '#ffe0a9a0');
    }
    ctx.restore();
  }
  ctx.restore();
}

function unityActivity(ctx, e, time, power) {
  const role = buildingRole(e), s = e.size * TILE, t = TEAM[e.team], working = !!e.queue?.length;
  const processing = e.processingAmount > 0, phase = time * Math.max(.06, power) + e.id * .17;
  if (['refinery', 'barracks', 'factory'].includes(role) && !working && !processing) return;
  ctx.save(); ctx.globalAlpha *= power < 1 ? .48 : .78;
  if (role === 'core') {
    const r = s * .052, y = -s * .24;
    const points = Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * r, y + Math.sin(i * Math.PI / 3) * r * .82]);
    polygon(ctx, points, '#243a49', '#9abfc8');
    line(ctx, -r + (time * 1.2 % 1) * r * 2, y - r * .65, -r + (time * 1.2 % 1) * r * 2, y + r * .65, t.light, .7);
  } else if (role === 'reactor') {
    const y = -s * .20;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, on = (time * .65 + i / 6) % 1 < .3;
      line(ctx, Math.cos(a) * s * .14, y + Math.sin(a) * s * .12, Math.cos(a) * s * .21, y + Math.sin(a) * s * .18, on ? '#a8cbd3' : '#344d5d', 1.3);
    }
  } else if (role === 'refinery') {
    if (processing) for (let i = 0; i < 4; i++) {
      const p = (phase * .2 + i / 4) % 1, x = s * (-.28 + p * .38), y = s * (.08 - p * .34);
      polygon(ctx, [[x - 1.5, y], [x, y - 2], [x + 1.5, y], [x, y + 1]], e.processingType === 3 ? '#ef9eb1' : e.processingType === 2 ? '#8ec7f0' : '#addccc');
    }
    if (working) light(ctx, s * .10, s * .32, Math.sin(phase * 4) > 0 ? '#e5bf81' : '#4c5049');
  } else if (role === 'barracks') {
    for (let i = 0; i < 3; i++) light(ctx, (i - 1) * 4, s * .25, (phase * .8) % 1 > i / 3 ? '#b9d8dc' : '#45575e');
  } else if (role === 'factory') {
    const progress = e.queue[0].progress;
    // Tool tips follow the actual assembly front; inactive docks stay dark and empty.
    for (const side of [-1, 1]) {
      const x = side * s * .16, y = s * (.15 + progress * .19);
      line(ctx, side * s * .28, s * .12, x, y, '#a5b8b8', 1.2);
      light(ctx, x, y, Math.sin(phase * 17 + side) > .3 ? '#d3e5e5' : '#586b72');
    }
  } else if (role === 'lab') {
    if (e.research) {
      const p = e.research.progress, r = s * .13, cy = -s * .12;
      const vertices = [[0, cy - r], [r * .86, cy + r * .5], [-r * .86, cy + r * .5], [0, cy - r]];
      for (let i = 0; i < 3; i++) {
        const part = Math.max(0, Math.min(1, p * 3 - i)), a = vertices[i], b = vertices[i + 1];
        line(ctx, a[0], a[1], a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part, '#a2d9e2', 1.3);
      }
    }
  } else if (role === 'capacitor') {
    const fill = Math.max(0, Math.min(1, (e.reserve || 0) / (BUILDING_DEFS[e.type].reserveCapacity || 1200)));
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * s * .19;
      line(ctx, x, -s * .26, x, s * .11, '#253740', 1.7);
      line(ctx, x, s * .11, x, s * (.11 - fill * .37), e.powerStatus === 'reserve' ? '#dcb17a' : '#aad5d8', 1);
    }
  } else if (role === 'turret' || role === 'rocketTower') {
    const ready = power >= 1, firing = pulse(time - (e.lastShot ?? -99), .22);
    for (const x of role === 'turret' ? [0] : [-s * .25, s * .25]) light(ctx, x, s * .22, ready ? t.light : '#6b5845');
    if (firing && ready) { ctx.globalAlpha *= firing; glow(ctx, role === 'turret' ? s * .25 : -s * .22, -s * .20, 8, '#d2e4e683'); }
  }
  ctx.restore();
}

function productionBay(ctx, e) {
  if (!['barracks', 'factory', 'refinery'].includes(entityRole(e))) return;
  const small = entityRole(e) === 'barracks', s = e.size * TILE;
  const w = s * (small ? .52 : .58), top = s * .09, bottom = s * .44;
  const job = e.queue?.[0], progress = Math.max(0, Math.min(1, job?.progress || 0));
  ctx.save();
  // An open, recessed work bay replaces the permanently occupied entrance in the art.
  polygon(ctx, [[-w / 2, top], [w / 2, top], [w / 2 + 2, bottom], [-w / 2 - 2, bottom]], '#141a1c', '#4c5654');
  ctx.drawImage(cachedSprite('bayFloor', 32, (c, size) => {
    const floor = c.createLinearGradient(0, -3, 0, size + 1);
    floor.addColorStop(0, '#1b2224'); floor.addColorStop(1, '#303633');
    c.fillStyle = floor; c.fillRect(0, 0, size, size);
  }), -w / 2 + 2, top + 3, w - 4, bottom - top - 4);
  for (let y = top + 6; y < bottom; y += 5) line(ctx, -w / 2 + 3, y, w / 2 - 3, y, '#75807935', .5);
  polygon(ctx, [[-w / 2 - 2, bottom], [w / 2 + 2, bottom], [w / 2 + 2, bottom + 3], [-w / 2 - 2, bottom + 3]], '#141a1c');
  for (const x of [-w / 2 - 1, w / 2 + 1]) {
    line(ctx, x, top, x, bottom, '#909c91', 1.1);
    for (let y = top + 3; y < bottom; y += 7) line(ctx, x, y, x, y + 3, '#87754d', 1.2);
  }
  if (job && UNITS[job.type]) {
    const center = (top + bottom) / 2;
    const infantry = UNITS[job.type].armor === 'infantry';
    const unit = { type: job.type, team: e.team, angle: infantry ? Math.PI / 2 : 0, cargo: 0, moving: infantry, id: e.id };
    const scale = infantry ? .72 : small ? .70 : .85;
    const poseTime = progress * UNITS[job.type].trainTime;
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2 + 2, top + 2, w - 4, bottom - top - 3); ctx.clip();
    ctx.translate(0, center); ctx.scale(scale, scale);
    if (!infantry) {
      ctx.save(); ctx.globalAlpha *= .27; ctx.filter = 'grayscale(1)'; drawSprite(ctx, unit, poseTime); ctx.restore();
      ctx.beginPath(); ctx.rect(-40, -32, 80, 8 + progress * 58); ctx.clip();
    }
    drawSprite(ctx, unit, poseTime); ctx.restore();
    // A crossbeam advances over the emerging chassis; an empty bay has no machinery light.
    if (!infantry) {
      const gantry = top + 5 + progress * (bottom - top - 10);
      line(ctx, -w / 2, gantry, -w * .20, gantry, '#97a5a4', 2);
      line(ctx, w / 2, gantry, w * .20, gantry, '#97a5a4', 2);
    }
    line(ctx, -w / 2 + 3, top + 1, w / 2 - 3, top + 1, '#e8bd78', 1.5);
  } else line(ctx, -w / 2 + 3, top + 1, w / 2 - 3, top + 1, '#485757', 1.5);
  ctx.restore();
}

function building(ctx, entity, time = 0) {
  ctx.save();
  if (entity.progress < 1) ctx.globalAlpha *= .24;
  const spriteDrawn = drawSprite(ctx, entity, time);
  ctx.restore();
  if (spriteDrawn) {
    if (entity.progress < 1) construction(ctx, entity, time);
    else productionBay(ctx, entity);
    return;
  }
  const { team = 0 } = entity, type = buildingRole(entity);
  const t = TEAM[team] || TEAM[0];
  const s = (entity.size || SIZES[type] || 2) * TILE;
  const w = s - 8, a = -w / 2;
  ctx.save();
  ellipse(ctx, 5, 8, s * .53, s * .39, '#151d1c55');
  rect(ctx, a - 2, a, w + 4, w, '#363e38');
  rect(ctx, a, a + 2, w, w - 4, '#666c59');
  ctx.strokeStyle = '#252f29'; ctx.lineWidth = 1;
  ctx.strokeRect(a + 3, a + 5, w - 6, w - 10);
  for (let x = a + 6; x < w / 2 - 3; x += 10) {
    rect(ctx, x, w / 2 - 5, 5, 2, '#b4a969');
    rect(ctx, x, a + 3, 5, 2, '#b4a969');
  }

  if (type === 'core') {
    box(ctx, -35, -24, 70, 57, 11, '#707d77', '#3c4c4a');
    box(ctx, -27, -29, 54, 39, 8, '#8f9d8d', '#546c66');
    polygon(ctx, [[-28, -27], [0, -40], [28, -27], [27, -9], [0, -15], [-27, -9]], '#8e9b8a', '#435851');
    rect(ctx, -4, -33, 8, 42, t.paint);
    rect(ctx, -30, 15, 60, 7, '#243a39');
    for (let x = -26; x <= 24; x += 10) {
      rect(ctx, x, 16, 6, 3, t.light); rect(ctx, x, 19, 6, 1, t.paint);
    }
    box(ctx, -14, 25, 28, 10, 6, '#6d8179', '#344c46');
    vent(ctx, -24, -12, 13, 15); vent(ctx, 11, -12, 13, 15);
    line(ctx, 22, -22, 22, -56, '#192c2b', 3);
    line(ctx, 22, -22, 22, -57, '#a7b7a0');
    ellipse(ctx, 22, -47, 10, 3, '#4a6059', '#a1b7a4');
    line(ctx, 12, -47, 32, -47, t.paint, 2);
    light(ctx, 21, -58, Math.sin(time * 3) > 0 ? t.glow : t.dark);
    light(ctx, -34, 25, t.glow); light(ctx, 32, 25, t.glow);
    ctx.fillStyle = t.light; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText('01', 0, -19);
  } else if (type === 'reactor') {
    box(ctx, -22, -13, 44, 36, 5, '#738073', '#43534c');
    for (const x of [-11, 11]) {
      rect(ctx, x - 8, -21, 16, 34, '#3d5550');
      ellipse(ctx, x, 11, 8, 5, '#344a44');
      rect(ctx, x - 8, -25, 16, 31, '#7b9788');
      ellipse(ctx, x, -25, 8, 5, '#b5bba2', '#40574e');
      ellipse(ctx, x, -25, 5, 3, '#263d39');
      ellipse(ctx, x, -25, 3, 2, t.glow);
      rect(ctx, x - 7, -9, 14, 5, t.paint);
      line(ctx, x - 5, -20, x - 5, 5, '#c1c6a677');
    }
    box(ctx, -13, 13, 26, 10, 6, '#9ba68d', '#4c6256');
    for (let x = -8; x < 9; x += 5) light(ctx, x, 15, t.glow);
    if (entity.progress >= 1 && Math.sin(time * 4) > -.5) {
      ctx.globalAlpha = .09 + Math.sin(time * 2) * .035;
      ellipse(ctx, 0, -14, 27, 24, t.glow); ctx.globalAlpha = 1;
    }
  } else if (type === 'refinery') {
    box(ctx, -35, -28, 42, 55, 9, '#7c8274', '#454f44');
    vent(ctx, -29, -31, 17, 19);
    rect(ctx, -31, -4, 29, 6, t.paint);
    box(ctx, 10, -17, 24, 42, 8, '#a09576', '#5b6552');
    rect(ctx, 13, -21, 18, 27, '#273f36');
    for (let i = 0; i < 7; i++) crystal(ctx, 17 + (i % 3) * 5, -3 - Math.floor(i / 3) * 5, .6, i);
    rect(ctx, -6, -8, 23, 8, '#434f42');
    for (let x = -5; x < 15; x += 4) line(ctx, x, -7, x + 3, -1, '#9e9e77');
    box(ctx, -29, 17, 28, 20, 2, '#545d4c', '#35453a');
    for (let y = 18; y < 35; y += 5) line(ctx, -26, y, -4, y, '#acac8055');
    rect(ctx, -21, -35, 10, 5, t.paint);
    box(ctx, -32, -30, 8, 9, 22, '#94988b', '#4b594b');
    ellipse(ctx, -28, -52, 4, 2, '#243b34');
    light(ctx, 29, 15, t.glow);
  } else if (type === 'barracks') {
    box(ctx, -23, -18, 46, 40, 8, '#7d8674', '#46594c');
    polygon(ctx, [[-24, -21], [0, -33], [24, -21], [24, 5], [0, -2], [-24, 5]], '#98a38c', '#4d6052');
    for (let x = -18; x < 22; x += 6) line(ctx, x, -21 - (1 - Math.abs(x) / 24) * 10, x, 5 - (1 - Math.abs(x) / 24) * 7, '#4d665560');
    rect(ctx, -4, -30, 8, 32, t.paint);
    rect(ctx, -8, 9, 16, 14, '#22382f');
    rect(ctx, -6, 9, 12, 3, t.light);
    for (const x of [-19, 12]) { rect(ctx, x, 10, 7, 5, '#2c473c'); rect(ctx, x + 1, 11, 5, 2, t.paint); }
    rect(ctx, -10, 23, 20, 4, '#899278');
    line(ctx, 22, 5, 22, -30, '#babba0', 1.5);
    polygon(ctx, [[23, -30], [35, -27], [30, -20], [23, -22]], t.paint);
    light(ctx, -23, 17, t.glow);
  } else if (type === 'factory') {
    box(ctx, -36, -25, 72, 60, 11, '#6f7f70', '#425246');
    polygon(ctx, [[-36, -31], [0, -44], [36, -31], [36, 5], [0, -2], [-36, 5]], '#899881', '#435c4d');
    for (let x = -30; x < 36; x += 8) line(ctx, x, -31 - (1 - Math.abs(x) / 36) * 13, x, 5 - (1 - Math.abs(x) / 36) * 7, '#435d496f');
    rect(ctx, -36, -29, 8, 33, t.paint); rect(ctx, 28, -29, 8, 33, t.paint);
    rect(ctx, -21, 9, 42, 25, '#1c3029');
    rect(ctx, -19, 10, 38, 10, '#596b54');
    for (let y = 12; y < 20; y += 3) line(ctx, -18, y, 18, y, '#a0ad8466');
    rect(ctx, -21, 8, 42, 3, t.paint);
    for (const x of [-25, 22]) {
      rect(ctx, x, 9, 3, 25, '#b6a767');
      for (let y = 11; y < 34; y += 7) rect(ctx, x, y, 3, 3, '#384739');
    }
    line(ctx, -15, 26, -15, 42, '#bac198', 2); line(ctx, 15, 26, 15, 42, '#bac198', 2);
    box(ctx, -12, -25, 24, 14, 9, '#a2ad96', '#5b6e5a'); vent(ctx, -8, -32, 16, 7);
    for (const x of [-32, 30]) light(ctx, x, 20, t.glow);
  } else if (type === 'rocketTower') {
    box(ctx, -24, -20, 48, 44, 5, '#929b92', '#434e51');
    box(ctx, -12, -13, 24, 26, 12, t.paint, t.dark);
    for (const x of [-20, 5]) {
      box(ctx, x, -16, 15, 27, 16, '#d3d5c8', '#5b6463');
      for (let y = -29; y < -8; y += 8) ellipse(ctx, x + 7.5, y, 4.5, 3, '#1a2228', '#919c96');
    }
  } else if (type === 'turret') {
    polygon(ctx, [[-11, -8], [-5, -13], [8, -12], [13, -5], [11, 10], [-10, 11]], '#748473', '#334c3c');
    ellipse(ctx, 0, 0, 9, 7, '#243e34');
    ellipse(ctx, 0, -4, 8, 7, '#99ab92', '#425c49');
    ctx.save(); ctx.translate(0, -4); ctx.rotate(entity.angle || 0);
    rect(ctx, 0, -3, 18, 5, '#465e4d'); rect(ctx, 5, -2, 14, 2, '#b0bd9b');
    rect(ctx, -6, -5, 11, 10, t.paint); rect(ctx, -4, -4, 6, 3, t.light);
    ctx.restore(); light(ctx, -10, 7, t.glow);
  }
  const progress = entity.progress ?? 1;
  if (progress < 1) {
    ctx.fillStyle = '#172a20'; ctx.globalAlpha = (1 - progress) * .66;
    ctx.fillRect(a, a - 22, w, w + 22); ctx.globalAlpha = 1;
    for (let x = a + 2; x <= -a; x += 15) {
      line(ctx, x, a - 9, x, -a, '#c6ae79', 1);
      line(ctx, x, a - 9, Math.min(x + 15, -a), -a, '#8a9363aa');
    }
    for (let y = a; y < -a; y += 16) line(ctx, a, y, -a, y, '#8a9363');
    rect(ctx, a, -a + 5, w, 3, '#1a2923'); rect(ctx, a, -a + 5, w * progress, 3, t.glow);
  }
  ctx.restore();
}

function unit(ctx, entity, time = 0) {
  const t = TEAM[entity.team || 0] || TEAM[0];
  const angle = unitSpriteAngle(entity.angle);
  const infantry = isInfantry(entity);
  const moving = entity.moving ?? entity.path?.length > 0;
  if (drawSprite(ctx, entity, time)) return;
  ellipse(ctx, 3, 4, infantry ? 5 : 15, infantry ? 3 : 10, '#111d195d');
  ctx.save(); ctx.rotate(angle);
  if (moving) {
    for (let i = 0; i < 4; i++) {
      const age = (time * .8 + i / 4 + (entity.id || 0) * .19) % 1;
      ctx.globalAlpha = (1 - age) * .16;
      ellipse(ctx, -(infantry ? 5 : 14) - age * 21, Math.sin(i * 7) * 5, (infantry ? 2 : 5) + age * 7, 3 + age * 5, '#d1bb86');
    }
    ctx.globalAlpha = 1;
  }
  if (infantry) {
    const stride = moving ? Math.sin(time * 17 + entity.id) * 2 : 0;
    rect(ctx, -3 + stride, -3, 5, 2, '#242f2b'); rect(ctx, -3 - stride, 2, 5, 2, '#242f2b');
    ellipse(ctx, -1, 0, 3.8, 4, t.paint, '#243d37');
    rect(ctx, -3, -3, 2, 6, '#b8baa0');
    if (entityRole(entity) === 'rocket') {
      rect(ctx, -6, -6, 5, 10, '#555f60');
      rect(ctx, -5, 2, 16, 4, '#dddccd'); rect(ctx, 9, 2, 3, 4, '#283236');
    } else { line(ctx, 1, 2, 8, 2, '#152e29', 2); line(ctx, 3, 1, 8, 1, '#aebfaa'); }
    ellipse(ctx, 0, -.5, 2.4, 2.4, '#c0c4a5');
    ellipse(ctx, 1, -.5, 1.8, 2.2, t.paint);
  } else if (entityRole(entity) === 'scout') {
    for (const x of [-9, 7]) for (const y of [-9, 6]) {
      rect(ctx, x, y, 6, 4, '#1e2e27'); line(ctx, x + 1, y + 1, x + 5, y + 1, '#67725b');
    }
    polygon(ctx, [[-12, -6], [8, -6], [14, -3], [14, 4], [7, 7], [-12, 6]], '#7e8f78', '#263f33');
    rect(ctx, -8, -5, 7, 10, t.paint);
    rect(ctx, 0, -4, 5, 8, '#24483c'); rect(ctx, 1, -3, 3, 6, '#83bdb0');
    ellipse(ctx, -2, 0, 4, 4, '#91a187'); rect(ctx, -1, -1, 10, 2, '#293e32');
    light(ctx, 11, -4, '#edebbb'); light(ctx, 11, 3, '#edebbb');
  } else {
    const isHarvester = entityRole(entity) === 'harvester';
    const isArtillery = entityRole(entity) === 'artillery';
    const length = isHarvester ? 28 : 27;
    for (const y of [-12, 7]) {
      rect(ctx, -length / 2, y, length, 6, '#223027');
      for (let x = -length / 2 + 2; x < length / 2; x += 4) rect(ctx, x, y + 1, 2, 4, '#606c55');
      line(ctx, -length / 2 + 1, y, length / 2 - 1, y, '#acaa7a77');
    }
    polygon(ctx, [[-14, -7], [9, -8], [15, -4], [15, 5], [9, 8], [-14, 7]], '#88927a', '#263d2e');
    rect(ctx, -11, -6, 4, 12, t.paint);
    line(ctx, -12, -7, 9, -7, '#bbc5a0');
    if (isHarvester) {
      rect(ctx, -9, -6, 13, 12, '#273f31'); rect(ctx, -8, -5, 11, 10, '#57734d');
      const load = Math.min(1, (entity.cargo || 0) / 200);
      for (let i = 0; i < 7; i++) if (i / 7 < load || !('cargo' in entity)) {
        crystal(ctx, -6 + (i % 3) * 3, 3 - Math.floor(i / 3) * 3, .34, i + 8);
      }
      box(ctx, 4, -6, 8, 12, 2, t.paint, t.dark);
      rect(ctx, 9, -5, 2, 9, '#b2dad0');
      rect(ctx, 15, -9, 3, 18, '#8e9c76');
      for (let y = -8; y < 9; y += 4) rect(ctx, 17, y, 4, 2, '#d1c194');
      light(ctx, 12, -6, '#fff2b8');
    } else {
      vent(ctx, -11, -5, 5, 10);
      ellipse(ctx, 0, 1, 8, 6, '#344b36');
      polygon(ctx, [[-6, -5], [4, -6], [9, -2], [8, 4], [2, 6], [-6, 4]], t.paint, '#304c3b');
      line(ctx, -5, -5, 4, -5, t.light);
      rect(ctx, 4, -2, isArtillery ? 26 : 17, 4, '#293d2e');
      rect(ctx, 5, -2, isArtillery ? 23 : 15, 2, '#bdc6a0');
      if (isArtillery) { rect(ctx, 25, -3, 6, 6, '#6a795a'); rect(ctx, -4, -3, 7, 6, '#a7b99a'); }
      else ellipse(ctx, -2, 0, 3, 3, '#a3b79a', '#567557');
      light(ctx, 11, -6, '#efedb4');
    }
  }
  ctx.restore();
}

export function drawIcon(canvas, type, team = 0, state = {}) {
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const w = bounds.width || 76, h = bounds.height || 64;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * .6);
  grad.addColorStop(0, team ? '#87524235' : '#73a3b525'); grad.addColorStop(1, '#10182000');
  rect(ctx, 0, 0, w, h, grad);
  ctx.translate(w / 2, h * .6);
  const size = SIZES[type] || 1;
  const scale = BUILDINGS.has(type) ? Math.min(w / (size * 40 + 8), h / (size * 38 + 15)) : Math.min(w / 50, h / 43);
  ctx.scale(scale, scale);
  const entity = { ...state, type, team, size, progress: state.progress ?? 1, angle: -.35, cargo: state.cargo ?? 0 };
  if (BUILDINGS.has(type)) building(ctx, entity);
  else unit(ctx, entity);
}

function lavaSurface(pool, time) {
  if (pool.flowTime !== time) {
    const ctx = pool.surface.getContext('2d');
    ctx.clearRect(0, 0, pool.width, pool.height);
    // Advect the cached folds under a stationary shore, rather than flashing their opacity.
    const x = Math.sin(time * .1 + pool.phase) * 20, y = Math.sin(time * .08 + pool.phase * 1.7) * 14;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pool.flow, x - 24, y - 24, pool.width + 48, pool.height + 48);
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(pool.mask, 0, 0);
    // The rim shades the lowered surface, so the relief stays still as lava flows.
    ctx.globalCompositeOperation = 'source-atop'; ctx.drawImage(pool.innerShade, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; pool.flowTime = time;
  }
  return pool.surface;
}

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.minimap = minimapCanvas; this.width = 0; this.height = 0;
    this.terrain = document.createElement('canvas');
    this.fog = document.createElement('canvas');
    this.fogLow = document.createElement('canvas');
    this.decals = document.createElement('canvas');
    this.rememberedBuildings = new Map();
    this.rankBadges = new Map();
    this.lastMinimap = -Infinity;
    this.resetFrameState();
    // Screen shake is render-only and follows the operating system's reduced-motion preference.
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    assetsReady.then(() => { if (this.groundImage !== terrainImages.ground) this.terrainSource = null; });
    this.resize();
  }
  // Per-world presentation state: tick poses, observed bodies, particles, shake and the event cursor.
  resetFrameState() {
    this.poses = new Map(); this.poseState = null; this.poseTime = NaN; this.afterTime = NaN;
    this.proxies = new WeakMap(); this.bodies = []; this.bodyTime = NaN; this.bodyState = null;
    this.particles = []; this.shakes = []; this.eventState = null; this.eventCount = 0; this.lastEvent = null;
    this.shakeX = this.shakeY = 0; this.pendingTime = 0; this.blendAlpha = 1; this.blending = false; this.drawLag = 0;
    this.fogState = null; this.fogTime = NaN; this.byIdSource = null; this.byIdLength = -1; this.byId = new Map();
    this.seenShells = new WeakSet(); this.drawVisible = null; this.pendingRuins = []; this.alphaFloor = 0;
    this.flights = []; this.flightLife = []; this.flightState = null; this.flightTime = NaN; this.landed = [];
    this.impacts = []; this.dying = []; this.held = new WeakSet(); this.impactAt = new WeakMap(); this.blastAt = new WeakMap();
    this.drawClock = 0;
  }
  // Props bucketed by tile row, so a frame visits only the rows on screen.
  propRowsFor(state) {
    if (this.propRowsSource !== this.rockProps || this.propRowsCount !== this.rockProps.length || this.propRows.length !== state.height) {
      this.propRows = Array.from({ length: state.height }, () => []);
      for (const prop of this.rockProps) this.propRows[Math.max(0, Math.min(state.height - 1, Math.floor(prop.y)))].push(prop);
      this.propRowsSource = this.rockProps; this.propRowsCount = this.rockProps.length;
    }
    return this.propRows;
  }
  // main.js calls this before every fixed tick; the frames until the next tick blend from these
  // poses to the new state using the scheduler's leftover time (renderer.pendingTime).
  snapshot(state) {
    const visible = state.visible?.[0], width = state.width, time = state.time;
    if (state !== this.poseState) { this.poses.clear(); this.poseState = state; }
    for (const e of state.entities) {
      if (e.kind !== 'unit' || !(e.hp > 0)) continue;
      let pose = this.poses.get(e.id);
      if (!pose) { pose = { x: 0, y: 0, angle: 0, seen: false, time: NaN, ax: NaN, ay: NaN, aa: NaN }; this.poses.set(e.id, pose); }
      pose.x = e.x; pose.y = e.y; pose.angle = e.angle || 0; pose.time = time;
      // An enemy blends only from a cell the player could see at that moment.
      pose.seen = e.team === 0 || !visible || !!visible[Math.floor(e.y) * width + Math.floor(e.x)];
    }
    if (this.poses.size > state.entities.length + 256) for (const [id, pose] of this.poses) if (pose.time !== time) this.poses.delete(id);
    this.poseTime = time; this.afterTime = NaN;
  }
  // The first frame after a tick records where the tick left every unit. A body moved by anything
  // other than that tick (a fixture, a load) then snaps to its true position instead of blending.
  settlePoses(state) {
    if (this.afterTime === state.time) return;
    this.afterTime = state.time; this.alphaFloor = 0;
    for (const e of state.entities) {
      if (e.kind !== 'unit') continue;
      const pose = this.poses.get(e.id);
      if (pose && pose.time === this.poseTime) { pose.ax = e.x; pose.ay = e.y; pose.aa = e.angle || 0; }
    }
  }
  // The pose the last frame drew, so selection and hit tests match what the player sees.
  poseOf(e) {
    return e.kind === 'unit' && this.blending ? this.unitPose(e, this.drawVisible) : e;
  }
  unitPose(e, visible) {
    const pose = this.poses.get(e.id), angle = e.angle || 0;
    if (!pose || pose.time !== this.poseTime || pose.ax !== e.x || pose.ay !== e.y || pose.aa !== angle) return e;
    if (e.team !== 0 && (!pose.seen || visible && !visible[Math.floor(e.y) * this.drawWidth + Math.floor(e.x)])) return e;
    const dx = e.x - pose.x, dy = e.y - pose.y;
    // Teleports and long corrections snap rather than sweep across the map.
    if (dx * dx + dy * dy > 4 || !dx && !dy && pose.angle === angle) return e;
    const t = this.blendAlpha;
    let proxy = this.proxies.get(e);
    if (!proxy) { proxy = Object.create(e); this.proxies.set(e, proxy); }
    proxy.x = pose.x + dx * t; proxy.y = pose.y + dy * t;
    proxy.angle = pose.angle + shortestArc(angle - pose.angle) * t;
    return proxy;
  }
  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width); this.height = Math.max(1, bounds.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.dpr !== dpr) {
      for (const badge of this.rankBadges.values()) badge.width = badge.height = 0;
      this.rankBadges.clear();
    }
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.lastMinimap = -Infinity;
  }
  // Overlays follow the shaken battlefield; screenToWorld stays steady so pointer input never jitters.
  worldToScreen(x, y, view) {
    return { x: (x - view.x) * view.zoom + this.width / 2 + this.shakeX, y: (y - view.y) * view.zoom + this.height / 2 + this.shakeY };
  }
  screenToWorld(x, y, view) {
    return { x: (x - this.width / 2) / view.zoom + view.x, y: (y - this.height / 2) / view.zoom + view.y };
  }
  drawIcon(canvas, type, team = 0) { drawIcon(canvas, type, team); }

  releaseTerrain() {
    // Clearing a canvas releases its backing store immediately, including GPU
    // surfaces; dropping JS references alone can retain them until a later GC.
    const surfaces = [this.terrain, this.decals, this.fog, this.fogLow, this.fogTint, this.minimapBase, this.miniTiles, this.heat];
    for (const pool of this.lavaPools || []) surfaces.push(pool.surface, pool.flow, pool.mask, pool.innerShade);
    surfaces.push(...this.rankBadges.values()); this.rankBadges.clear();
    for (const surface of surfaces) if (surface) surface.width = surface.height = 0;
    this.terrainSource = this.groundImage = null;
    this.fogTint = this.minimapBase = this.miniTiles = this.heat = null;
    this.knownOre = this.knownMineralTypes = this.fogNoise = null;
    this.fogVisible = this.fogExplored = null;
    this.rockProps = []; this.propRows = []; this.lavaPools = [];
    this.rememberedBuildings.clear(); this.unitPositions?.clear();
    this.seenEffects = new WeakSet(); this.lastMinimap = -Infinity;
    if (this.vignette) this.vignette.width = this.vignette.height = 0;
    this.vignette = null; this.resetFrameState();
    releaseRenderSprites(); releaseSpriteOverlays();
  }

  createTerrain(state) {
    for (const _ of this.terrainSteps(state)) { /* Synchronous rebuild for renderer fixtures. */ }
  }

  async prepareTerrain(state, onProgress = () => {}) {
    const steps = this.terrainSteps(state);
    let deadline = performance.now() + 12;
    for (const progress of steps) {
      if (progress) onProgress(progress);
      if (performance.now() >= deadline) { await nextPaint(); deadline = performance.now() + 12; }
    }
  }

  *terrainSteps(state) {
    yield { value: 0, label: 'Laying the ashlands' };
    this.releaseTerrain();
    const width = state.width * TILE, height = state.height * TILE;
    // Bound both full-map surfaces together to 64 MiB, even on the largest battlefield.
    // Fine object art stays in native sprite caches; broad terrain tolerates this filtered bake.
    this.terrainScale = Math.min(1, 4096 / width, 4096 / height, Math.sqrt(8388608 / (width * height)));
    this.terrain.width = Math.ceil(width * this.terrainScale); this.terrain.height = Math.ceil(height * this.terrainScale);
    this.decals.width = this.terrain.width; this.decals.height = this.terrain.height;
    this.fog.width = state.width * 4; this.fog.height = state.height * 4;
    this.fogLow.width = state.width; this.fogLow.height = state.height;
    this.knownOre = new Float32Array(state.width * state.height);
    this.knownMineralTypes = new Uint8Array(state.width * state.height);
    this.rememberedBuildings.clear();
    this.unitPositions = new Map(); this.seenEffects = new WeakSet();
    this.lastDecalFade = 0; this.fogVisible = null; this.fogExplored = null; this.rockProps = [];
    this.terrainSource = state.terrain;
    this.groundImage = terrainImages.ground;
    const ctx = this.terrain.getContext('2d');
    ctx.setTransform(this.terrainScale, 0, 0, this.terrainScale, 0, 0);
    this.decals.getContext('2d').setTransform(this.terrainScale, 0, 0, this.terrainScale, 0, 0);
    const seed = [...String(state.seed)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 10000, 17);
    this.seed = seed;
    // One baked material surface: broad ash/rust deposits over a seamless scanned-style texture.
    rect(ctx, 0, 0, width, height, '#514e48');
    if (terrainImages.ground) {
      const pattern = ctx.createPattern(terrainImages.ground, 'repeat');
      const factor = 480 / terrainImages.ground.width;
      pattern.setTransform(new DOMMatrix().scale(factor));
      rect(ctx, 0, 0, width, height, pattern);
      rect(ctx, 0, 0, width, height, '#222c322c');
    }
    const base = document.createElement('canvas'); base.width = state.width * 4; base.height = state.height * 4;
    this.fogNoise = new Uint8Array(base.width * base.height);
    const baseCtx = base.getContext('2d'), colors = baseCtx.createImageData(base.width, base.height);
    for (let y = 0; y < base.height; y++) {
      if (y % 8 === 0) yield { value: .15 * y / base.height, label: 'Laying the ashlands' };
      for (let x = 0; x < base.width; x++) {
      const broad = smoothNoise(x / 43, y / 43, seed);
      const detail = smoothNoise(x / 13, y / 13, seed + 9);
      const rusty = Math.max(0, smoothNoise(x / 31 + 4, y / 31, seed + 4) - .47) * 1.7;
      const c = broad * 30 + detail * 14, i = (y * base.width + x) * 4;
      const warm = PROFILE_RELIEF[state.mapProfile]?.tint ?? 0;
      colors.data[i] = 41 + c + rusty * 38 + warm;
      colors.data[i + 1] = 44 + c + rusty * 8 + warm * .4;
      colors.data[i + 2] = 45 + c - rusty * 13 - warm * .6;
      colors.data[i + 3] = terrainImages.ground ? 97 : 255;
      this.fogNoise[y * base.width + x] = broad * 6 + detail * 5;
    }
    }
    baseCtx.putImageData(colors, 0, 0); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, 0, 0, width, height);
    // The fog tint is baked once; updateFog only re-shapes its alpha.
    this.fogTint = document.createElement('canvas'); this.fogTint.width = base.width; this.fogTint.height = base.height;
    const tint = this.fogTint.getContext('2d').createImageData(base.width, base.height);
    for (let i = 0; i < this.fogNoise.length; i++) { const n = this.fogNoise[i]; tint.data.set([10 + n * .65, 17 + n * .8, 24 + n, 255], i * 4); }
    this.fogTint.getContext('2d').putImageData(tint, 0, 0);
    // Haul roads follow the generator's guaranteed routes for current maps and older saves; ruts only wear into open ground.
    const openTile = (x, y) => [0, 2, 5].includes(state.terrain[Math.floor(y) * state.width + Math.floor(x)]);
    // Ruts sit beside the centreline along each route's local normal, so curved lanes keep parallel tracks.
    const road = (points, offset = 0) => {
      ctx.beginPath();
      points.forEach((p, j) => {
        const a = points[Math.max(0, j - 1)], b = points[Math.min(points.length - 1, j + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const x = p.x * TILE - (b.y - a.y) / l * offset, y = p.y * TILE + (b.x - a.x) / l * offset;
        if (j === 0 || !openTile(p.x, p.y)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
    };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const { points } of mapRoutes(state)) {
      for (const [w, color] of [[42, '#1b20250a'], [33, '#141b210d'], [24, '#1b202511']]) {
        road(points); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
      }
      for (const offset of [-8, 8]) {
        road(points, offset); ctx.strokeStyle = '#151b2126'; ctx.lineWidth = 3; ctx.stroke();
        road(points, offset - 2); ctx.strokeStyle = '#c4b3960d'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();
    yield { value: .16, label: 'Shaping basalt and ridgelines' };
    yield* this.materialSteps(state, ctx, seed);
    yield { value: .5, label: 'Scattering mineral fields and deadwood' };
    const scatteredTrees = state.terrain.includes(4);
    for (let y = 0; y < state.height; y++) {
      yield { value: .5 + .18 * y / state.height, label: 'Scattering mineral fields and deadwood' };
      for (let x = 0; x < state.width; x++) {
      const i = y * state.width + x, px = x * TILE, py = y * TILE;
      const n = noise(x, y, seed), type = state.terrain[i];
      if (type === 3 || type === 5) continue;
      // Irregular mineral stains remain when a field is exhausted.
      if (state.minerals[i] > 0) {
        const stain = ctx.createRadialGradient(px + 16, py + 18, 2, px + 16, py + 18, 33);
        stain.addColorStop(0, '#93684b39'); stain.addColorStop(1, '#93684b00');
        ellipse(ctx, px + 16, py + 18, 33, 26, stain);
      }
      // Rock plates carry their own grit; basalt takes only dark flecks.
      if (type !== 1) for (let j = 0; j < 17; j++) {
        const nx = noise(x * 19 + j, y, seed), ny = noise(x, y * 19 + j, seed);
        rect(ctx, px + nx * TILE, py + ny * TILE, j % 5 === 0 ? 2 : .8, .7, j % 2 && type !== 2 ? '#c8baa32b' : '#111a2433');
      }
      if (type === 1 || type === 4) {
        const cx = px + 16 + (n - .5) * 9, cy = py + 20 + (noise(x, y, seed + 2) - .5) * 9;
        const count = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => state.terrain[(y + dy) * state.width + x + dx] === 1).length;
        const grove = smoothNoise(x / 6, y / 6, seed + 23);
        // New maps place individual trees in the simulation; old saves keep their rocky groves.
        const isTree = type === 4 || !scatteredTrees && grove > .48 && noise(x, y, seed + 41) < (count < 4 ? .44 : .25);
        // Interior rock reads through the plate; boulders concentrate on formation edges.
        if (!isTree && count === 4 && noise(x, y, seed + 44) >= .35) continue;
        const variant = Math.floor(noise(x, y, seed + 5) * (isTree ? 6 : 8));
        const size = isTree ? [54, 56, 48, 46, 31, 42][variant] * (.9 + noise(x, y, seed + 11) * .22) : 35 + n * 14 + count * 2;
        if (isTree) {
          const halo = ctx.createRadialGradient(cx, cy, 6, cx, cy, size * .8);
          halo.addColorStop(0, '#151b224e'); halo.addColorStop(1, '#151b2200');
          ellipse(ctx, cx, cy + 5, size * .8, size * .65, halo);
        }
        this.rockProps.push({ kind: isTree ? 'tree' : 'rock', x: cx / TILE, y: cy / TILE, size, variant });
      } else if (type === 2) {
        if (!coherentBasalt(state, i, x, y)) continue;
        // Two joint seams per basalt tile: sub-pixel at minimum zoom, fine cracks up close.
        const a = noise(x, y, seed + 13) * Math.PI, jx = px + 8 + noise(x, y, seed + 14) * 16, jy = py + 8 + noise(x, y, seed + 15) * 16;
        line(ctx, jx - Math.cos(a) * 11, jy - Math.sin(a) * 11, jx + Math.cos(a) * 11, jy + Math.sin(a) * 11, '#0d121555', 1.2);
        line(ctx, jx, jy, jx + Math.sin(a) * 9, jy - Math.cos(a) * 9, '#0d121544', 1);
        line(ctx, jx - Math.cos(a) * 11 - 1, jy - Math.sin(a) * 11 - 1, jx + Math.cos(a) * 11 - 1, jy + Math.sin(a) * 11 - 1, '#9a918222', .6);
      } else if (n > .974) {
        const r = 7 + noise(x, y, seed + 8) * 19;
        ellipse(ctx, px + 15, py + 18, r + 2, r * .62, '#bea98824');
        ellipse(ctx, px + 16, py + 16, r, r * .59, '#1c252c58');
        const crater = ctx.createRadialGradient(px + 17, py + 17, 1, px + 17, py + 17, r);
        crater.addColorStop(0, '#1c252c77'); crater.addColorStop(1, '#4a4c4900');
        ellipse(ctx, px + 17, py + 17, r, r * .58, crater);
        ctx.beginPath(); ctx.ellipse(px + 15, py + 16, r, r * .62, 0, .05, Math.PI * .85);
        ctx.strokeStyle = '#d5bea435'; ctx.lineWidth = 1; ctx.stroke();
      } else if (n < .038) {
        ctx.save(); ctx.translate(px + 15, py + 15); ctx.rotate(n * 127);
        line(ctx, -12, -7, 0, 3, '#1c27344f'); line(ctx, 0, 3, 12, 6, '#1c27343b');
        line(ctx, 0, 3, -1, 10, '#1c273440');
        line(ctx, -12, -6, 0, 4, '#c3b29524'); ctx.restore();
      } else if (n < .15) {
        for (let j = 0; j < 3; j++) {
          const xx = px + 5 + noise(x + j, y, seed) * 23, yy = py + 4 + noise(x, y + j, seed) * 24;
          ellipse(ctx, xx + 1.5, yy + 1.5, 2.4, 1.4, '#19232d7d');
          ellipse(ctx, xx, yy, 1.9, 1.3, '#9d928074');
          line(ctx, xx - 1, yy - .8, xx + .7, yy - 1, '#d4c3a75c', .7);
        }
      }
    }
    }
    // The noise bake is only needed for the colours above; release its store now.
    base.width = base.height = 0;
    yield { value: .68, label: 'Filling the lava basins' };
    yield* this.lavaSteps(state);
    yield { value: 1, label: 'Battlefield ready' };
  }

  // Terrain materials bake once at 8 px/tile: basalt sinks below the ash, rock rises above it with a lit rim and a shaded foot.
  *materialSteps(state, ctx, seed) {
    const width = state.width * TILE, height = state.height * TILE, mw = state.width * 8, mh = state.height * 8;
    // Each 8 px/tile scratch surface is up to 9 MiB on a vast map. A small pool reuses them during the
    // bake and the finally block clears every backing store instead of leaving them to garbage collection.
    const free = [], owned = [];
    const scratch = () => {
      const c = free.pop() || document.createElement('canvas');
      if (!owned.includes(c)) owned.push(c);
      c.width = mw; c.height = mh; return c;
    };
    const release = (...surfaces) => { for (const c of surfaces) if (c && !free.includes(c)) free.push(c); };
    try {
    // Tile test -> soft, organic alpha mask (blur, then threshold).
    const tileMask = (test, blur = 4) => {
      const raw = scratch(), r = raw.getContext('2d');
      for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) if (test(y * state.width + x, x, y)) r.fillRect(x * 8, y * 8, 8, 8);
      const soft = scratch(), s = soft.getContext('2d');
      s.filter = `blur(${blur}px)`; s.drawImage(raw, 0, 0); s.filter = 'none'; release(raw);
      const px = s.getImageData(0, 0, mw, mh);
      for (let i = 3; i < px.data.length; i += 4) px.data[i] = px.data[i] >= 128 ? 255 : 0;
      s.putImageData(px, 0, 0); return soft;
    };
    // Flat colour through a mask; offsets and blur are in world pixels.
    const stamp = (mask, color, dx = 0, dy = 0, alpha = 1, blur = 0) => {
      const c = scratch(), t = c.getContext('2d');
      if (blur) t.filter = `blur(${blur / 4}px)`;
      t.drawImage(mask, 0, 0); t.filter = 'none';
      t.globalCompositeOperation = 'source-in'; t.fillStyle = color; t.fillRect(0, 0, mw, mh);
      ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.drawImage(c, dx, dy, width, height); ctx.restore();
      release(c);
    };
    // Per-pixel material at 4 px/tile, upsampled and clipped by the mask.
    const plate = function* (mask, paint) {
      const lw = state.width * 4, lh = state.height * 4, low = document.createElement('canvas'); low.width = lw; low.height = lh;
      const l = low.getContext('2d'), img = l.createImageData(lw, lh);
      for (let y = 0; y < lh; y++) {
        if (y % 8 === 0) yield;
        for (let x = 0; x < lw; x++) paint(x, y, img.data, (y * lw + x) * 4);
      }
      l.putImageData(img, 0, 0);
      const c = scratch(), t = c.getContext('2d');
      t.imageSmoothingEnabled = true; t.drawImage(low, 0, 0, mw, mh); low.width = low.height = 0;
      t.globalCompositeOperation = 'destination-in'; t.drawImage(mask, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(c, 0, 0, width, height);
      release(c);
    };
    // A tighter blur keeps single rock tiles on the plate while corners still round.
    const rockMask = tileMask(i => state.terrain[i] === 1, 3);
    const basaltMask = tileMask((i, x, y) => coherentBasalt(state, i, x, y));
    // One blurred scorch stain around every lava pool; the basalt banks later cover its inner part.
    if (state.terrain.includes(3)) { const lavaMask = tileMask(i => state.terrain[i] === 3, 2); stamp(lavaMask, '#1d100b', 0, 0, .35, 10); release(lavaMask); }
    stamp(basaltMask, '#7a7d76', 0, -1, .18);
    yield* plate(basaltMask, (x, y, data, at) => {
      const fleck = smoothNoise(x / 36, y / 36, seed + 61), seam = smoothNoise(x / 92, y / 92, seed + 67);
      let r = 47, g = 53, b = 55;
      if (fleck > .62) { r += (106 - r) * .16; g += (111 - g) * .16; b += (106 - b) * .16; }
      if (Math.abs(seam - .5) < .008) { r += (29 - r) * .35; g += (34 - g) * .35; b += (36 - b) * .35; }
      data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = 158;
    });
    release(basaltMask);
    yield { value: .28, label: 'Carving crater floors' };
    if (state.terrain.includes(5)) {
      const craterMask = tileMask(i => state.terrain[i] === 5, 5);
      stamp(craterMask, '#928574', 0, 0, .24, 10);
      yield* plate(craterMask, (x, y, data, at) => {
        const n = smoothNoise(x / 21, y / 21, seed + 95), fold = smoothNoise(x / 8, y / 8, seed + 97);
        // Keep the original granular ash visible through the bowl floor so it reads as
        // shallow traversable ground instead of a dark liquid pool or bottomless hole.
        data[at] = 53 + n * 12 + fold * 7; data[at + 1] = 53 + n * 9 + fold * 4; data[at + 2] = 47 + n * 8; data[at + 3] = 118;
      });
      const innerEdge = (dx, dy) => {
        const edge = scratch(), e = edge.getContext('2d'); e.drawImage(craterMask, 0, 0);
        e.globalCompositeOperation = 'destination-out'; e.drawImage(craterMask, dx / 4, dy / 4); return edge;
      };
      // The sunken near wall faces the upper-left light; the opposite inner wall stays in shadow.
      for (const [dx, dy, color, alpha, blur] of [[7, 9, '#182228', .43, 3], [-6, -8, '#a3957d', .38, 2], [-2, -3, '#b6aa91', .26, 0]]) {
        const edge = innerEdge(dx, dy); stamp(edge, color, 0, 0, alpha, blur); release(edge);
      }
      release(craterMask);
    }
    yield { value: .39, label: 'Raising the rock plateaus' };
    // Two soft shadow lobes and short exposed strata make cliffs read above the ash at minimum zoom.
    stamp(rockMask, '#111920', 6, 10, .32, 16);
    stamp(rockMask, '#13191d', 3, 6, .30, 5);
    stamp(rockMask, '#2b2c2b', 0, 6); stamp(rockMask, '#403d37', 0, 3);
    stamp(rockMask, '#a29a87', -2, -2.5, .48);
    yield* plate(rockMask, (x, y, data, at) => {
      const n = smoothNoise(x / 28, y / 28, seed + 71), grit = (noise(x, y, seed + 72) - .5) * 8;
      const light = Math.max(0, Math.min(1, (n - .58) * 6)) * .55, dark = Math.max(0, Math.min(1, (.40 - n) * 6)) * .55;
      let r = 92, g = 89, b = 82;
      r += (107 - r) * light + (69 - r) * dark; g += (102 - g) * light + (67 - g) * dark; b += (92 - b) * light + (63 - b) * dark;
      data[at] = r + grit; data[at + 1] = g + grit; data[at + 2] = b + grit; data[at + 3] = 255;
    });
    } finally { for (const c of owned) c.width = c.height = 0; }
  }

  *lavaSteps(state) {
    this.lavaPools = [];
    const visited = new Uint8Array(state.terrain.length), ctx = this.terrain.getContext('2d');
    const palette = [[96, 28, 15], [191, 38, 8], [244, 85, 9], [255, 159, 20], [255, 220, 80]];
    for (let start = 0; start < visited.length; start++) {
      if (visited[start] || state.terrain[start] !== 3) continue;
      yield { value: .68 + .3 * start / visited.length, label: 'Filling the lava basins' };
      const cells = [start]; visited[start] = 1;
      for (let at = 0; at < cells.length; at++) {
        const i = cells[at], x = i % state.width, y = Math.floor(i / state.width);
        for (const next of [x > 0 ? i - 1 : -1, x < state.width - 1 ? i + 1 : -1, y > 0 ? i - state.width : -1, y < state.height - 1 ? i + state.width : -1]) {
          if (next >= 0 && !visited[next] && state.terrain[next] === 3) { visited[next] = 1; cells.push(next); }
        }
      }
      const x0 = Math.min(...cells.map(i => i % state.width)), x1 = Math.max(...cells.map(i => i % state.width));
      const y0 = Math.min(...cells.map(i => Math.floor(i / state.width))), y1 = Math.max(...cells.map(i => Math.floor(i / state.width)));
      // The bank, alpha mask and padded molten texture are built once; live flow uses canvas blits.
      const w = (x1 - x0 + 1) * TILE + 32, h = (y1 - y0 + 1) * TILE + 32;
      const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
      const m = mask.getContext('2d');
      for (const i of cells) rect(m, (i % state.width - x0) * TILE + 16, (Math.floor(i / state.width) - y0) * TILE + 16, TILE, TILE, '#1d100b');
      const layers = Array.from({ length: 4 }, () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
      const bank = layers[0].getContext('2d'); bank.filter = 'blur(9px)'; bank.drawImage(mask, 0, 0); bank.filter = 'none';
      const pixels = bank.getImageData(0, 0, w, h), shore = m.createImageData(w, h), shade = m.createImageData(w, h);
      const edges = new Float32Array(w * h), coverage = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        if (y % 8 === 0) yield;
        for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, raw = pixels.data[i + 3];
        coverage[y * w + x] = raw;
        if (!raw) continue;
        const wx = x0 * TILE + x - 16, wy = y0 * TILE + y - 16;
        // A broad wander plus fine grit turns the tile outline into an irregular shoreline.
        const grain = smoothNoise(wx / 24, wy / 24, this.seed + 71) * .65 + smoothNoise(wx / 6, wy / 6, this.seed + 73) * .35;
        edges[y * w + x] = raw - (grain - .5) * 100;
      }
      }
      const edgeAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h ? edges[y * w + x] : 0;
      const coverageAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h ? coverage[y * w + x] : 0;
      const clamp01 = value => Math.max(0, Math.min(1, value));
      for (let y = 0; y < h; y++) {
        if (y % 8 === 0) yield;
        for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, edge = edges[y * w + x];
        const wx = x0 * TILE + x - 16, wy = y0 * TILE + y - 16;
        const grain = (pixels.data[i + 3] - edge) / 100 + .5, grit = noise(wx, wy, this.seed + 79);
        // The floor is inset and six world pixels below the ground lip. Intersect
        // with the opening so the near bank occludes it instead of casting outside.
        const floorEdge = Math.min(edge, edgeAt(x, y - 6));
        const alpha = Math.max(0, Math.min(255, (floorEdge - 150) * 5));
        const gx = edgeAt(x + 2, y) - edgeAt(x - 2, y), gy = edgeAt(x, y + 2) - edgeAt(x, y - 2);
        // Concave lighting: upper-left inner walls are shaded; the opposite
        // slope catches a narrow ground-colored bevel, never a glowing outline.
        const light = Math.max(0, -(gx + gy) / (Math.hypot(gx, gy) || 1) * Math.SQRT1_2);
        const depth = clamp01((edge - 110) / 75), rim = Math.max(0, 1 - Math.abs(edge - 110) / 14);
        const rock = 44 + grain * 10 + grit * 5 - depth * 20 + light * (depth * 15 + rim * 12);
        const heatTint = clamp01((floorEdge - 142) / 60);
        pixels.data.set([rock + heatTint * 12, rock * .94 + heatTint * 3, rock * .86, Math.max(0, Math.min(255, (edge - 84) * 5))], i);
        shore.data.set([29, 16, 11, alpha], i);
        // Shade from the basin outline, not its grit: fully open interiors stay hot.
        const floorCoverage = Math.min(coverageAt(x, y), coverageAt(x, y - 6));
        const contact = clamp01((235 - floorCoverage) / 70) * .4;
        const cast = clamp01((coverageAt(x, y) - coverageAt(x - 4, y - 12)) / 100) * .6;
        shade.data.set([13, 10, 8, Math.min(.75, contact + cast) * 255], i);
      }
      }
      bank.putImageData(pixels, 0, 0);
      m.putImageData(shore, 0, 0);
      layers[3].getContext('2d').putImageData(shade, 0, 0);
      // Keep the molten texture at its generated half resolution. Enlarging this
      // cache adds no detail; the compositor scales it only for visible pools.
      const flow = layers[2]; flow.width = (w + 48) / 2; flow.height = (h + 48) / 2;
      const f = flow.getContext('2d'), heat = f.createImageData(flow.width, flow.height);
      for (let y = 0; y < flow.height; y++) {
        if (y % 8 === 0) yield;
        for (let x = 0; x < flow.width; x++) {
        const i = (y * flow.width + x) * 4, wx = x0 * TILE + x * 2 - 40, wy = y0 * TILE + y * 2 - 40;
        // Swirled fractal folds: broad red/orange body, amber folds, yellow only on the hottest crests, sparse dark crust.
        const warp = smoothNoise(wx / 64, wy / 56, this.seed + 37);
        const swirl = smoothNoise(wx / 26 + Math.sin(wy / 31 + warp * 5) * 2.2, wy / 24 + Math.cos(wx / 37 + warp * 4) * 2.2, this.seed + 41);
        const fold = swirl * .58 + smoothNoise(wx / 9, wy / 8, this.seed + 45) * .24 + warp * .12 + (smoothNoise(wx / 4.5, wy / 4.5, this.seed + 47) - .5) * .12;
        const crust = smoothNoise(wx / 16, wy / 14, this.seed + 51);
        const value = Math.max(0, Math.min(4, .15 + Math.max(0, fold) ** 1.05 * 5.15 - Math.max(0, crust - .62) * 7));
        const index = Math.min(3, Math.floor(value)), blend = value - index;
        for (let c = 0; c < 3; c++) heat.data[i + c] = palette[index][c] * (1 - blend) + palette[index + 1][c] * blend;
        heat.data[i + 3] = 255;
      }
      }
      f.putImageData(heat, 0, 0);
      const pool = { cells, x: x0 * TILE - 16, y: y0 * TILE - 16, width: w, height: h, surface: layers[1], flow, mask, innerShade: layers[3], phase: noise(start, 7, this.seed) * Math.PI * 2,
        // Tile bounds and cell coordinates let each frame reject off-screen pools without scanning their cells.
        tx0: x0, ty0: y0, tx1: x1 + 1, ty1: y1 + 1, cx: Int16Array.from(cells, i => i % state.width), cy: Int16Array.from(cells, i => Math.floor(i / state.width)) };
      ctx.save();
      ctx.drawImage(layers[0], pool.x, pool.y, pool.width, pool.height);
      ctx.drawImage(lavaSurface(pool, 0), pool.x, pool.y, pool.width, pool.height); ctx.restore();
      // The bank is baked into the terrain; its scratch surface is not needed afterwards.
      layers[0].width = layers[0].height = 0;
      this.lavaPools.push(pool);
    }
    // Restrained heat light: 2 px per tile, filled only for explored molten cells and blurred into
    // a short warm falloff on the banks. It is rebuilt when exploration changes, never per frame.
    this.heat = null; this.heatExplored = -1;
    if (this.lavaPools.length) { this.heat = document.createElement('canvas'); this.heat.width = state.width * 2; this.heat.height = state.height * 2; }
  }

  updateHeat(state, explored) {
    if (!this.heat) return;
    let count = 0;
    for (const pool of this.lavaPools) for (const i of pool.cells) if (!explored || explored[i]) count++;
    if (count === this.heatExplored) return;
    this.heatExplored = count;
    const c = this.heat.getContext('2d');
    c.clearRect(0, 0, this.heat.width, this.heat.height);
    c.beginPath();
    for (const pool of this.lavaPools) for (let j = 0; j < pool.cells.length; j++) if (!explored || explored[pool.cells[j]]) c.rect(pool.cx[j] * 2, pool.cy[j] * 2, 2, 2);
    c.filter = 'blur(1.1px)'; c.fillStyle = '#ff7a26'; c.fill(); c.filter = 'none';
    // The molten surface is already bright: keep most of the light on the surrounding banks.
    c.globalCompositeOperation = 'destination-out'; c.globalAlpha = .85; c.fill();
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }

  // Molten surfaces animate with simulation time only inside current vision. Pools outside the
  // viewport are rejected by their tile bounds before any cell is visited.
  drawLava(state, visible, time, x0, y0, x1, y1) {
    const ctx = this.ctx, cells = this.lavaCells ??= [];
    for (const pool of this.lavaPools) {
      if (pool.tx1 <= x0 || pool.tx0 >= x1 || pool.ty1 <= y0 || pool.ty0 >= y1) continue;
      cells.length = 0;
      for (let j = 0; j < pool.cells.length; j++) {
        const x = pool.cx[j], y = pool.cy[j];
        if (x >= x0 && x < x1 && y >= y0 && y < y1 && (!visible || visible[pool.cells[j]])) cells.push(j);
      }
      if (!cells.length) continue;
      ctx.save(); ctx.beginPath();
      // The wandering shoreline overshoots its tiles; pad the clip so the live surface covers the whole fringe.
      for (const j of cells) ctx.rect(pool.cx[j] * TILE - 8, pool.cy[j] * TILE - 8, TILE + 16, TILE + 16);
      ctx.clip();
      ctx.drawImage(lavaSurface(pool, time), pool.x, pool.y, pool.width, pool.height);
      const bubble = glowSprite('#ffa44e75');
      ctx.strokeStyle = '#f7b663'; ctx.lineWidth = 1;
      for (const j of cells) {
        const i = pool.cells[j], n = noise(i, 4, this.seed), age = (time * .18 + n) % 1;
        if (age < .8) continue;
        const p = (age - .8) * 5, x = (pool.cx[j] + .5) * TILE + (n - .5) * 10 + Math.sin(time * .1 + pool.phase) * 3;
        const y = (pool.cy[j] + .5) * TILE + (noise(i, 8, this.seed) - .5) * 10 + Math.sin(time * .08 + pool.phase * 1.7) * 2;
        ctx.globalAlpha = Math.sin(p * Math.PI) * .45;
        stamp(ctx, bubble, x, y, 6); ctx.beginPath(); ctx.ellipse(x, y, 1 + p * 3, .8 + p * 2, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Sparse embers lift off currently visible molten cells; each cell's spark replays from simulation time.
  drawEmbers(state, visible, time, x0, y0, x1, y1) {
    const ctx = this.ctx;
    ctx.beginPath();
    let any = false;
    for (const pool of this.lavaPools) {
      if (pool.tx1 <= x0 || pool.tx0 >= x1 || pool.ty1 <= y0 || pool.ty0 >= y1) continue;
      for (let j = 0; j < pool.cells.length; j++) {
        const x = pool.cx[j], y = pool.cy[j], i = pool.cells[j];
        if (x < x0 || x >= x1 || y < y0 || y >= y1 || visible && !visible[i]) continue;
        const n = noise(i, 23, this.seed);
        if (n > .3) continue;
        const age = (time * (.32 + n * .5) + n * 17) % 1;
        if (age > .7) continue;
        const rise = age / .7, size = .9 + n * 1.6;
        const px = (x + .2 + noise(i, 29, this.seed) * .6) * TILE + Math.sin(rise * 5 + n * 30) * 3 + rise * 6;
        const py = (y + .3 + noise(i, 31, this.seed) * .5) * TILE - rise * 22;
        ctx.rect(px, py, size * (1 - rise * .5), size * (1 - rise * .5)); any = true;
      }
    }
    if (!any) return;
    ctx.globalAlpha = .62; ctx.fillStyle = '#ffbe6a'; ctx.fill(); ctx.globalAlpha = 1;
  }

  drawDecals(state, visible, time, clock = time) {
    const ctx = this.decals.getContext('2d');
    if (time - this.lastDecalFade > 8) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      rect(ctx, 0, 0, state.width * TILE, state.height * TILE, '#00000008'); ctx.restore();
      this.lastDecalFade = time;
    }
    const currentlySeen = new Set();
    for (const e of state.entities) {
      if (e.kind !== 'unit' || isInfantry(e)) continue;
      const i = Math.floor(e.y) * state.width + Math.floor(e.x);
      if (visible && !visible[i]) continue;
      currentlySeen.add(e.id);
      const previous = this.unitPositions.get(e.id);
      const x = e.x * TILE, y = e.y * TILE;
      if (previous && Math.hypot(x - previous.x, y - previous.y) > 3) {
        const length = Math.hypot(x - previous.x, y - previous.y);
        if (length < TILE * 1.5) {
          const angle = Math.atan2(y - previous.y, x - previous.x);
          ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
          if (UNITS[e.type]?.race === 'aiUnity') {
            // Articulated machines leave separated foot contacts; the skimmer leaves no tread trail.
            if (unitRole(e) !== 'scout') for (const offset of [-9, 9]) {
              rect(ctx, -length, offset + ((e.id || 0) % 2 ? 1 : -1), 2.3, 3, '#13202a21');
            }
          } else for (const offset of [-7, 7]) {
              rect(ctx, -length, offset, length, 2.5, '#16202720');
              for (let step = 0; step < length; step += 3.5) line(ctx, -step, offset, -step, offset + 2.5, '#0a172420', .7);
          }
          ctx.restore();
        }
        this.unitPositions.set(e.id, { x, y });
      } else if (!previous) this.unitPositions.set(e.id, { x, y });
    }
    for (const id of this.unitPositions.keys()) if (!currentlySeen.has(id)) this.unitPositions.delete(id);
    for (const fx of state.effects || []) {
      if (fx.type === 'shell') {
        if (this.seenShells.has(fx)) continue;
        this.seenShells.add(fx);
        if (!Number.isFinite(fx.tx) || !Number.isFinite(fx.ty)) continue;
        // The simulation applies a shell's damage at launch; the hits and deaths it caused wait for it to land.
        const land = state.time + Math.max(0, fx.life || 0);
        this.impacts.push({ x: fx.tx, y: fx.ty, born: land - (fx.maxLife || SHELL_FLIGHT), land });
        // A visible landing raises a small dust burst; barrage shells land as blasts.
        const target = Math.floor(fx.ty) * state.width + Math.floor(fx.tx);
        if (visible && !visible[target]) continue;
        if (state.effects.some(o => o.type === 'explosion' && o.weapon === 'artillery' && o.x === fx.tx && o.y === fx.ty)) continue;
        this.addParticle({ kind: 'impact', born: land, life: .55, x: fx.tx * TILE, y: fx.ty * TILE, gate: target, seed: noise(fx.tx, fx.ty, this.seed) });
        this.addShake(land, fx.tx, fx.ty, .45);
        continue;
      }
      if (fx.type !== 'explosion' || this.seenEffects.has(fx)) continue;
      const i = Math.floor(fx.y) * state.width + Math.floor(fx.x);
      if (visible && !visible[i]) continue;
      // Once seen, a blast keeps playing even if the dying unit's own sight collapses.
      this.seenEffects.add(fx);
      const born = state.time - Math.max(0, (fx.maxLife || .6) - (fx.life || 0));
      if (fx.weapon === 'artillery') {
        // A barrage blast and its scorch wait for the shell to land.
        const land = born + SHELL_FLIGHT;
        this.blastAt.set(fx, land);
        this.pendingRuins.push({ born: land, fx, body: null, gated: true });
        this.addParticle({ kind: 'blast', born: land, life: .5, x: fx.x * TILE, y: fx.y * TILE - 3, size: fx.size || .8, gate: i, sx: fx.x, sy: fx.y });
        this.blast(state, fx, land);
        continue;
      }
      // A rocket's blast waits for the drawn rocket to arrive, and a death a shell caused waits for the shell.
      const land = fx.weapon ? this.impactAt.get(fx) ?? born : this.shellLanding(fx, born);
      this.blastAt.set(fx, land);
      const body = this.blast(state, fx, land);
      if (land > born) {
        this.held.add(fx);
        this.addParticle({ kind: 'blast', born: land, life: fx.maxLife || .6, x: fx.x * TILE, y: fx.y * TILE - 3, size: fx.size || 1, sx: fx.x, sy: fx.y });
        if (body) this.dying.push({ body, until: land });
        this.pendingRuins.push({ born: land, fx, body, gated: false });
      } else this.ruin(ctx, fx, body);
    }
    if (this.pendingRuins.length) {
      let keep = 0;
      for (const pending of this.pendingRuins) {
        if (pending.born > clock) this.pendingRuins[keep++] = pending;
        else if (!pending.gated || !visible || visible[Math.floor(pending.fx.y) * state.width + Math.floor(pending.fx.x)]) this.ruin(ctx, pending.fx, pending.body);
      }
      this.pendingRuins.length = keep;
    }
    if (this.impacts.length) {
      let keep = 0;
      for (const impact of this.impacts) if (clock < impact.land + .5 && impact.land < clock + 2) this.impacts[keep++] = impact;
      this.impacts.length = keep;
    }
  }

  // When a seen explosion plays on the drawn clock (renderer.drawClock): a shell's kills and a rocket's blast wait
  // for the projectile to arrive. Null until a frame has drawn it, so sound can stay in step with the picture.
  blastTime(fx) {
    return this.blastAt.get(fx) ?? null;
  }

  // Shells splash 1.6 tiles (the barrage uses the same reach). A death born on a shell's launch tick within
  // that reach (plus the body's half-size) was caused by it and shows when the shell lands.
  shellLanding(fx, born) {
    const reach = Math.max(1.6, ABILITIES.artillery.splash || 0) + (fx.size || 1) * .75;
    for (const impact of this.impacts) {
      if (Math.abs(impact.born - born) < 1e-3 && Math.hypot(fx.x - impact.x, fx.y - impact.y) <= reach) return impact.land;
    }
    return born;
  }
  // The same for a hit flash: the simulation stamps lastHit at the end of the launch tick.
  hitLanding(e, hit) {
    const n = e.kind === 'building' ? e.size / 2 : 0, reach = Math.max(1.6, ABILITIES.artillery.splash || 0) + (n || .5) * 1.42;
    for (const impact of this.impacts) {
      const since = hit - impact.born;
      if (since > -1e-3 && since < .1 && Math.hypot(e.x + n - impact.x, e.y + n - impact.y) <= reach) return impact.land;
    }
    return hit;
  }

  // The ground a seen death leaves behind: a scorch, plus a husk for vehicles and structures.
  ruin(ctx, fx, body) {
    this.scorch(ctx, fx);
    if (body && (body.kind === 'building' || !isInfantry(body))) this.stampWreck(ctx, body);
  }

  // The simulation drops a projectile on the tick it lands while the drawn clock still trails that tick, so a
  // copy finishes the flight on the drawn clock, and a rocket's blast waits for the rocket to arrive.
  trackFlights(state, time, clock) {
    if (!this.blending) {
      this.flights.length = this.flightLife.length = this.landed.length = 0; this.flightState = null;
      return;
    }
    const effects = state.effects || [];
    if (state !== this.flightState || time !== this.flightTime) {
      if (state === this.flightState && time > this.flightTime && this.flights.length) {
        const current = new Set(effects);
        let blasts = null;
        for (let i = 0; i < this.flights.length; i++) {
          const fx = this.flights[i], end = this.flightTime + this.flightLife[i];
          if (current.has(fx) || end <= clock) continue;
          this.landed.push({ ...fx, end });
          if (fx.type !== 'rocket') continue;
          blasts ??= new Map(effects.filter(o => o.type === 'explosion' && o.weapon && !this.seenEffects.has(o)).map(o => [`${o.x},${o.y}`, o]));
          const blast = blasts.get(`${fx.tx},${fx.ty}`);
          if (blast) this.impactAt.set(blast, end);
        }
      } else if (state !== this.flightState) this.landed.length = 0;
      this.flights.length = this.flightLife.length = 0;
      for (const fx of effects) if (fx.type === 'rocket' || fx.type === 'shell' || fx.type === 'shot') { this.flights.push(fx); this.flightLife.push(fx.life); }
      this.flightState = state; this.flightTime = time;
    }
    let keep = 0;
    for (const fx of this.landed) if (fx.end > clock) { fx.life = fx.end - time; this.landed[keep++] = fx; }
    this.landed.length = keep;
  }

  scorch(ctx, fx) {
    const x = fx.x * TILE, y = fx.y * TILE, radius = 19 * Math.sqrt(fx.size || 1);
    stamp(ctx, radialSprite(SCORCH), x, y, radius, radius * .75);
    for (let j = 0; j < 12; j++) {
      const a = noise(x, j, this.seed) * Math.PI * 2, r = radius * (.4 + noise(j, y) * .9);
      const dx = x + Math.cos(a) * r, dy = y + Math.sin(a) * r * .7;
      line(ctx, dx, dy, dx + Math.cos(a) * 6, dy + Math.sin(a) * 3, '#19202766', 1 + j % 3);
      if ((fx.size || 1) > 1) rect(ctx, dx, dy, 2 + j % 4, 1 + j % 3, '#292c2bcc');
    }
  }

  // A newly seen explosion: debris, staggered secondary bursts with a short smoke column for a destroyed
  // structure, and a shake, all starting at born. Returns the body seen on the previous tick that just left
  // play here, for its wreck. Everything derives from what the player saw; deaths in fog leave nothing.
  blast(state, fx, born) {
    const size = fx.size || 1, seed = noise(fx.x * 13.1, fx.y * 7.7, this.seed);
    let body = null;
    if (!fx.weapon) {
      // A death explosion sits exactly on the centre of a body observed on the previous tick.
      for (const e of this.bodies) {
        if (e.hp > 0) continue;
        const n = e.kind === 'building' ? e.size / 2 : 0;
        if (Math.abs(e.x + n - fx.x) < 1e-6 && Math.abs(e.y + n - fx.y) < 1e-6) { body = e; break; }
      }
    }
    const role = body && entityRole(body), structure = body?.kind === 'building' && role !== 'wall';
    const vehicle = body?.kind === 'unit' && !isInfantry(body), x = fx.x * TILE, y = fx.y * TILE;
    // A structure lost during construction collapses in proportion to what was built.
    const built = structure ? Math.max(0, Math.min(1, body.progress ?? 1)) : 1;
    this.addShake(born, fx.x, fx.y, fx.weapon ? fx.weapon === 'artillery' ? .9 : fx.weapon === 'rocketTower' ? .5 : .25
      : structure ? (1.8 + body.size * .8) * (.4 + built * .6) : vehicle ? 1.2 : body ? .6 : .8 * Math.sqrt(size));
    const debris = Math.min(18, Math.round((body ? structure ? (9 + size * 3) * (.3 + built * .7) : vehicle ? 8 : 4 : 3) * (fx.weapon ? .8 : 1)));
    for (let j = 0; j < debris; j++) {
      const a = noise(seed * 91 + j, 3.1, this.seed) * Math.PI * 2, speed = (24 + noise(j, seed * 57, this.seed) * 46) * Math.sqrt(size);
      const vz = 55 + noise(j * 3, seed, this.seed) * 75;
      this.addParticle({ kind: 'debris', born, life: 2 * vz / GRAVITY + .45, x, y: y + 2, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * .62, vz,
        size: (structure || vehicle ? 1.6 : 1.1) + noise(j, 9, this.seed) * 1.6,
        color: body ? j % 3 ? '#2b2c2c' : body.team === 1 ? '#8f3b40' : '#9aa3a2' : j % 2 ? '#4c463d' : '#2d2b28' });
    }
    if (!structure) return body;
    const half = body.size * TILE / 2, bursts = Math.round((2 + body.size) * built);
    for (let j = 0; j < bursts; j++) {
      const at = born + .16 + j * (.62 / bursts) + noise(j, seed, this.seed) * .08;
      const bx = x + (noise(j, 5, seed) - .5) * half * 1.3, by = y + (noise(j, 6, seed) - .5) * half * 1.1;
      this.addParticle({ kind: 'blast', born: at, life: .42, x: bx, y: by, size: .55 + noise(j, 7, seed) * .35, sx: bx + j, sy: by - j });
      this.addShake(at, bx / TILE, by / TILE, .7);
    }
    for (let j = 0; j < Math.round(10 * built); j++) {
      this.addParticle({ kind: 'smoke', born: born + .3 + j * .26, life: 2.6, x: x + (noise(j, 8, seed) - .5) * half * .7, y: y - half * .2,
        size: (10 + noise(j, 9, seed) * 6) * Math.sqrt(body.size), seed: noise(j, 10, seed) });
    }
    return body;
  }

  addParticle(particle) {
    // A bounded pool: during a mass battle the oldest debris yields to new blasts.
    if (this.particles.length >= PARTICLE_LIMIT) this.particles.splice(0, this.particles.length - PARTICLE_LIMIT + 1);
    this.particles.push(particle);
  }

  addShake(born, x, y, amplitude) {
    this.shakes.push({ born, x, y, amplitude, seed: noise(x, y, born) * 40 });
    if (this.shakes.length > 48) this.shakes.shift();
  }

  // Screen shake is a render-only offset: it is off under prefers-reduced-motion or view.screenShake === false,
  // follows the drawn clock (so a paused frame stays still) and fades with distance from the camera.
  updateShake(view, clock) {
    this.shakeX = this.shakeY = 0;
    if (view.screenShake === false || this.reducedMotion?.matches) { this.shakes.length = 0; return; }
    const reach = Math.max(this.width, this.height) * .6, zoom = Math.min(1.25, Math.max(.45, view.zoom / TILE));
    let x = 0, y = 0, keep = 0;
    for (const shake of this.shakes) {
      const age = clock - shake.born;
      if (age > SHAKE_LENGTH) continue;
      this.shakes[keep++] = shake;
      if (age < 0) continue;
      const dx = (shake.x - view.x) * view.zoom / reach, dy = (shake.y - view.y) * view.zoom / reach;
      const amplitude = shake.amplitude * zoom * (1 - age / SHAKE_LENGTH) ** 2 / (1 + (dx * dx + dy * dy) ** 2);
      x += Math.sin(age * 71 + shake.seed) * amplitude; y += Math.cos(age * 59 + shake.seed * 1.3) * amplitude * .8;
    }
    this.shakes.length = keep;
    this.shakeX = Math.max(-SHAKE_LIMIT, Math.min(SHAKE_LIMIT, x)); this.shakeY = Math.max(-SHAKE_LIMIT, Math.min(SHAKE_LIMIT, y));
  }

  // A wreck fades with the other ground decals: an offset dark silhouette of the last seen frame under the
  // same frame burnt to graphite. Both are one-off decal stamps; the cached sprite pixels are untouched.
  stampWreck(ctx, body) {
    const building = body.kind === 'building', n = building ? body.size / 2 : 0, x = (body.x + n) * TILE, y = (body.y + n) * TILE;
    // An unfinished structure leaves only what was built, clipped as the construction view rises.
    const built = building ? Math.max(0, Math.min(1, body.progress ?? 1)) : 1;
    if (built < .12) return;
    if (built < 1) {
      const s = body.size * TILE;
      ctx.save(); ctx.beginPath(); ctx.rect(x - s, y + s * .5 - s * 1.6 * built, s * 2, s * 1.6 * built); ctx.clip();
    }
    const ghost = { type: body.type, team: body.team, kind: body.kind, angle: body.angle, size: body.size, progress: 1, moving: false, id: body.id,
      wallConnections: body.wallConnections };
    const matrix = ctx.getTransform();
    ctx.translate(x + (building ? 3 : 2.5), y + (building ? 4 : 3.5)); ctx.globalAlpha = .3;
    drawSpriteOverlay(ctx, ghost, 0, WRECK);
    ctx.setTransform(matrix); ctx.translate(x, y); ctx.globalAlpha = building ? .5 : .8;
    ctx.filter = 'grayscale(1) brightness(.48) contrast(1.15)'; drawSprite(ctx, ghost, 0); ctx.filter = 'none';
    ctx.setTransform(matrix); ctx.globalAlpha = 1;
    if (built < 1) ctx.restore();
  }

  // Event-driven flourishes for things the player can see: field patches and promotions.
  readEvents(state, visible) {
    const events = state.events || [];
    if (state !== this.eventState) { this.eventState = state; this.eventCount = events.length; this.lastEvent = events.at(-1) ?? null; return; }
    let start = this.eventCount;
    if (start > events.length || start > 0 && events[start - 1] !== this.lastEvent) {
      const found = this.lastEvent ? events.lastIndexOf(this.lastEvent) : -1;
      start = found >= 0 ? found + 1 : events.length;
    }
    for (let i = start; i < events.length; i++) {
      const event = events[i];
      if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) continue;
      const seen = event.team === 0 || !visible || visible[Math.floor(event.y) * state.width + Math.floor(event.x)];
      if (!seen) continue;
      if (event.kind === 'ability' && event.ability === 'fieldPatch') {
        this.addParticle({ kind: 'patch', born: event.time, life: 1, x: event.x * TILE, y: event.y * TILE, r: (ABILITIES.engineer.reach || 4) * TILE });
      } else if (event.kind === 'promotion') {
        this.addParticle({ kind: 'promote', born: event.time, life: 1.3, x: event.x * TILE, y: event.y * TILE, rank: event.rank || 1 });
      }
    }
    this.eventCount = events.length; this.lastEvent = events.at(-1) ?? null;
  }

  drawParticles(ctx, clock, visible) {
    let keep = 0;
    for (const p of this.particles) {
      const age = clock - p.born;
      if (age >= p.life) continue;
      this.particles[keep++] = p;
      if (age < 0 || p.gate !== undefined && visible && !visible[p.gate]) continue;
      const k = age / p.life;
      if (p.kind === 'debris') {
        const land = 2 * p.vz / GRAVITY, t = Math.min(age, land), z = Math.max(0, p.vz * t - GRAVITY * t * t / 2);
        const gx = p.x + p.vx * t, gy = p.y + p.vy * t, fade = age < land ? 1 : 1 - (age - land) / (p.life - land);
        ctx.globalAlpha = fade * .5 * (1 - Math.min(.7, z / 90));
        rect(ctx, gx - .6, gy, p.size + 1.2, p.size * .55, '#0b0e10');
        ctx.globalAlpha = fade;
        rect(ctx, gx, gy - z - p.size * .8, p.size, p.size * .8, p.color);
      } else if (p.kind === 'blast') {
        explosion(ctx, p.x, p.y, p.size, k, 1 - k, p.sx, p.sy);
      } else if (p.kind === 'smoke') {
        const drift = Math.sin(clock * .4 + p.seed * 6) * 4 + age * 7, r = p.size * (.6 + k * .9);
        ctx.globalAlpha = Math.sin(k * Math.PI) * .8;
        stamp(ctx, radialSprite(COLUMN), p.x + drift, p.y - age * 26, r, r);
      } else if (p.kind === 'impact') {
        const r = 4 + k * 14;
        ctx.globalAlpha = (1 - k) * .55;
        stamp(ctx, radialSprite(SOOT), p.x + k * 3, p.y - k * 8, r * .8, r * .7);
        if (k < .35) { ctx.globalAlpha = (1 - k / .35) * .8; glow(ctx, p.x, p.y - 2, 9, '#ffc2788f'); }
        ctx.globalAlpha = (1 - k) * .45; ctx.strokeStyle = '#e6caaa'; ctx.lineWidth = .8;
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, r * 1.2, r * .7, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === 'patch') {
        // An expanding service ring at the engineer's reach and rising repair glints.
        ctx.globalAlpha = (1 - k) * .55; ctx.strokeStyle = '#a7e3dc'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * (.25 + k * .75), p.r * (.25 + k * .75) * .7, 0, 0, Math.PI * 2); ctx.stroke();
        for (let j = 0; j < 8; j++) {
          const a = j / 8 * Math.PI * 2 + noise(j, p.x) * .6, d = p.r * (.18 + noise(j, p.y) * .45), s = 2.5 * (1 - k) + 1;
          const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d * .7 - k * 16;
          ctx.globalAlpha = Math.sin(Math.min(1, k * 1.4) * Math.PI) * .9;
          rect(ctx, x - s, y - .5, s * 2, 1, '#ffe3a8'); rect(ctx, x - .5, y - s, 1, s * 2, '#ffe3a8');
        }
      } else if (p.kind === 'promote') {
        // Gold chevrons rise once over a promoted unit the player can see.
        const y = p.y - 18 - k * 14;
        ctx.globalAlpha = Math.sin(Math.min(1, k * 1.3) * Math.PI) * .95;
        glow(ctx, p.x, y, 9, '#ffd27a70');
        for (let j = 0; j < p.rank; j++) polygon(ctx, [[p.x - 5, y + j * 3.4], [p.x, y - 3 + j * 3.4], [p.x + 5, y + j * 3.4], [p.x + 5, y + 1.6 + j * 3.4], [p.x, y - 1.4 + j * 3.4], [p.x - 5, y + 1.6 + j * 3.4]], '#e4b975');
      }
    }
    this.particles.length = keep;
    ctx.globalAlpha = 1;
  }

  // Screen-space ash-fall in three sparse layers. Gusts integrate analytically, so every mote is a pure
  // function of the drawn clock and camera and paused frames hold still. Like the lava, ash only moves
  // over ground in current vision: remembered and unexplored areas show no live motion.
  drawAsh(ctx, view, clock, state, visible, left, top) {
    const w = this.width + 40, h = this.height + 40, count = Math.round(Math.min(110, this.width * this.height / 13000));
    if (count <= 0) return;
    const calm = this.reducedMotion?.matches ? .35 : 1;
    const gust = (12 * clock - 9 * Math.cos(clock * .21) / .21 - 5 * Math.cos(clock * .53 + 1.7) / .53) * calm;
    const panX = view.x * view.zoom, panY = view.y * view.zoom;
    let first = 0;
    for (const layer of ASH_LAYERS) {
      const n = Math.round(count * layer.share);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const seed = first + i, phase = noise(seed, 7, 23) * 6.283;
        const x = ((noise(seed, 3, 17) * w + gust * layer.depth - panX * layer.parallax + Math.sin(clock * .9 + phase) * 6 * calm) % w + w) % w - 20;
        const y = ((noise(seed, 5, 19) * h + clock * layer.fall * calm - panY * layer.parallax) % h + h) % h - 20;
        if (visible) {
          const cx = Math.floor((x - left) / view.zoom), cy = Math.floor((y - top) / view.zoom);
          if (cx < 0 || cy < 0 || cx >= state.width || cy >= state.height || !visible[cy * state.width + cx]) continue;
        }
        ctx.rect(x, y, layer.size, layer.size * .6);
      }
      first += n;
      ctx.globalAlpha = layer.alpha; ctx.fillStyle = '#dccfb8'; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Objectives: zone rings with pulsing beacons for active goals. A zone is a deliberate static reveal only
  // once a revealed objective uses it or its definition marks it lit (public); otherwise it appears when its
  // centre is explored. Zones also anchor hidden garrisons and spawns, so nothing else draws through fog.
  // Returns [[zone, goalState], ...] for the zones the player may see.
  missionZones(state) {
    const mission = state.mission;
    if (!mission?.zones?.length) return null;
    if (this.goalSource !== mission.id) {
      let definition = null;
      try { definition = missionDefinition(mission.id); } catch { definition = null; }
      const objectives = definition?.objectives || [];
      this.goalZones = new Map(objectives.filter(d => typeof d.zone === 'string').map(d => [d.id, d.zone]));
      this.publicZones = new Set((definition?.zones || []).filter(z => z.lit === true || z.public === true).map(z => z.id));
      this.goalSource = mission.id;
    }
    const goals = new Map();
    for (const objective of mission.objectives || []) {
      const zone = this.goalZones.get(objective.id);
      if (!zone || objective.revealed === false) continue;
      if (objective.state === 'active' || !goals.has(zone)) goals.set(zone, objective.state);
    }
    const explored = state.explored?.[0], shown = [];
    for (const zone of mission.zones) {
      if (!Number.isFinite(zone.x) || !Number.isFinite(zone.y)) continue;
      const cell = Math.floor(zone.y) * state.width + Math.floor(zone.x);
      if (goals.has(zone.id) || this.publicZones.has(zone.id) || !explored || explored[cell]) shown.push([zone, goals.get(zone.id)]);
    }
    return shown;
  }

  drawMissionMarkers(state, view, clock) {
    const zones = this.missionZones(state);
    if (!zones) return;
    const ctx = this.ctx;
    for (const [zone, goal] of zones) {
      const p = this.worldToScreen(zone.x, zone.y, view), r = Math.max(6, zone.r * view.zoom);
      if (p.x + r < -40 || p.y + r < -40 || p.x - r > this.width + 40 || p.y - r > this.height + 40) continue;
      const active = goal === 'active', color = active ? '#e2b67e' : goal === 'done' ? '#8dccca' : '#97acb1';
      ctx.globalAlpha = active ? .07 : .035; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = active ? .85 : .5; ctx.strokeStyle = color; ctx.lineWidth = active ? 1.4 : 1;
      ctx.setLineDash([7, 6]); ctx.lineDashOffset = active ? -clock * 5 : 0; ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      if (active) {
        // A slow pulse ring and a short light mast mark the objective without flooding the ground.
        const k = clock * .45 % 1;
        ctx.globalAlpha = (1 - k) * .55; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * k, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = .9;
        stamp(ctx, radialSprite(BEACON), p.x, p.y - 19, 4.5, 22);
        ellipse(ctx, p.x, p.y, 5, 3, '#14202799', '#e2b67e');
        polygon(ctx, [[p.x, p.y - 44], [p.x + 5.5, p.y - 37.5], [p.x, p.y - 31], [p.x - 5.5, p.y - 37.5]], '#e2b67e', '#142027');
      }
      const label = labelSprite(String(zone.label || zone.id), color);
      ctx.globalAlpha = active ? .95 : .7;
      ctx.drawImage(label, Math.round(p.x - label.width / 4), Math.round(p.y - r - 18), label.width / 2, label.height / 2);
    }
    ctx.globalAlpha = 1;
  }

  // Named sites appear only on explored ground.
  drawSiteLabels(state, view, explored) {
    const ctx = this.ctx;
    for (const site of state.sites || []) {
      if (!Number.isFinite(site.x) || !Number.isFinite(site.y)) continue;
      if (explored && !explored[Math.floor(site.y) * state.width + Math.floor(site.x)]) continue;
      const p = this.worldToScreen(site.x, site.y, view);
      if (p.x < -80 || p.y < -20 || p.x > this.width + 80 || p.y > this.height + 20) continue;
      const label = labelSprite(String(site.name || site.id), '#c4d2cf', '500 9px monospace');
      ctx.globalAlpha = .78;
      polygon(ctx, [[p.x, p.y - 3.5], [p.x + 3.5, p.y], [p.x, p.y + 3.5], [p.x - 3.5, p.y]], '#142027d0', '#97acb1');
      ctx.drawImage(label, Math.round(p.x - label.width / 4), Math.round(p.y + 6), label.width / 2, label.height / 2);
    }
    ctx.globalAlpha = 1;
  }

  // Own abilities: flare reveal rings, barrage target reticles, and the ground-targeting preview.
  drawAbilityMarkers(state, view, clock, ownUnits) {
    const ctx = this.ctx, flare = ABILITIES.scout.duration || 12;
    for (const reveal of state.reveals || []) {
      if (reveal.team !== 0) continue;
      const remaining = reveal.until - clock, age = flare - remaining;
      if (remaining <= 0 || age < 0) continue;
      const p = this.worldToScreen(reveal.x, reveal.y, view), grow = 1 - (1 - Math.min(1, age / .6)) ** 3, r = reveal.r * view.zoom * grow;
      ctx.globalAlpha = Math.min(1, remaining / 1.5) * .6; ctx.strokeStyle = '#f3dfae'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]); ctx.lineDashOffset = clock * 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    for (const e of ownUnits) {
      const b = e.barrage;
      if (e.team !== 0 || !b) continue;
      const p = this.worldToScreen(b.x, b.y, view), r = Math.max(7, (ABILITIES.artillery.scatter || 1.2) * view.zoom);
      const beat = .5 + Math.sin(clock * 9) * .5;
      ctx.globalAlpha = .55 + beat * .3; ctx.strokeStyle = '#e8a46f'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) line(ctx, p.x + Math.cos(a) * (r - 4), p.y + Math.sin(a) * (r - 4), p.x + Math.cos(a) * (r + 5), p.y + Math.sin(a) * (r + 5), '#e8a46f', 1.3);
      for (let i = 0; i < b.shots; i++) rect(ctx, p.x - b.shots * 3 + i * 6 + 1, p.y + r + 6, 4, 2.5, '#f3c48d');
    }
    const preview = view.abilityPreview;
    if (preview && Number.isFinite(preview.x) && Number.isFinite(preview.y)) {
      const p = this.worldToScreen(preview.x, preview.y, view), r = Math.max(6, (preview.radius || 1) * view.zoom), color = preview.valid === false ? '#e39881' : '#a8dcd9';
      ctx.globalAlpha = .8; ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      line(ctx, p.x - 6, p.y, p.x + 6, p.y, color, 1.2); line(ctx, p.x, p.y - 6, p.x, p.y + 6, color, 1.2);
    }
    ctx.globalAlpha = 1;
  }

  vignetteImage() {
    // One small radial-gradient bake per viewport size, stretched every frame.
    const key = `${this.width}x${this.height}`;
    if (this.vignette && this.vignetteKey === key) return this.vignette;
    if (this.vignette) this.vignette.width = this.vignette.height = 0;
    const k = VIGNETTE_STEP, c = document.createElement('canvas'), w = this.width / k, h = this.height / k;
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    const g = c.getContext('2d'), gradient = g.createRadialGradient(w / 2, h / 2, w * .2, w / 2, h / 2, w * .72);
    gradient.addColorStop(0, '#07111c00'); gradient.addColorStop(1, '#07111c38');
    g.fillStyle = gradient; g.fillRect(0, 0, c.width, c.height);
    this.vignette = c; this.vignetteKey = key;
    return c;
  }

  // In the live loop visibility changes only inside a simulation tick, so frames between ticks skip the
  // comparison; fixtures that edit fog in place (live = false) are compared word by word every frame.
  // Returns whether the fog grids changed.
  updateFog(state, live = false) {
    const visible = state.visible[0], explored = state.explored[0];
    if (live && state === this.fogState && state.time === this.fogTime && this.fogVisible) return false;
    this.fogState = state; this.fogTime = state.time;
    let changed = !this.fogVisible || this.fogVisible.length !== visible.length;
    if (!changed) changed = !sameBytes(visible, this.fogVisible) || !sameBytes(explored, this.fogExplored);
    if (!changed) return false;
    this.fogVisible = visible.slice(); this.fogExplored = explored.slice();
    const low = this.fogLow.getContext('2d'), data = low.createImageData(state.width, state.height);
    for (let i = 0; i < visible.length; i++) {
      const p = i * 4;
      data.data[p] = 12; data.data[p + 1] = 19; data.data[p + 2] = 27;
      data.data[p + 3] = visible[i] ? 0 : explored[i] ? 162 : 255;
    }
    low.putImageData(data, 0, 0);
    // The baked tint keeps its colour; the blurred low-res coverage only shapes its alpha.
    const ctx = this.fog.getContext('2d');
    ctx.clearRect(0, 0, this.fog.width, this.fog.height);
    ctx.drawImage(this.fogTint, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true; ctx.filter = 'blur(1.5px)';
    ctx.drawImage(this.fogLow, -2, -2, this.fog.width + 4, this.fog.height + 4);
    ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    return true;
  }

  draw(state, view) {
    if (this.terrainSource !== state.terrain) this.createTerrain(state);
    const ctx = this.ctx, zoom = view.zoom, scale = zoom / TILE, time = state.time || 0;
    const visible = state.visible?.[0], explored = state.explored?.[0], W = state.width;
    // Units blend between the last two ticks; effects and animation follow the same lagged clock.
    this.blending = state === this.poseState && time > this.poseTime && time - this.poseTime < .25;
    if (this.blending) {
      this.settlePoses(state);
      // Within one tick the drawn moment never steps back, even when the scheduler remainder restarts on resume.
      this.blendAlpha = this.alphaFloor = Math.max(this.alphaFloor, Math.min(1, this.pendingTime / (time - this.poseTime)));
      this.drawLag = (1 - this.blendAlpha) * (time - this.poseTime);
    } else { this.blendAlpha = 1; this.drawLag = 0; }
    const clock = time - this.drawLag, lag = this.drawLag;
    this.drawClock = clock;
    this.drawVisible = visible; this.drawWidth = W;
    const commandAge = view.commandMarker ? performance.now() / 1000 - view.commandMarker.time : -1;
    const attackPulse = view.commandMarker?.type === 'attack' && commandAge >= 0 && commandAge < .85
      ? Math.max(0, Math.cos(commandAge / .85 * Math.PI * 6)) * (1 - commandAge / .85) : 0;
    const entityVisible = (e) => {
      if (!visible) return true;
      if (e.kind === 'building') {
        for (let y = Math.floor(e.y); y < e.y + e.size; y++) for (let x = Math.floor(e.x); x < e.x + e.size; x++) {
          if (x >= 0 && y >= 0 && x < W && y < state.height && visible[y * W + x]) return true;
        }
        return false;
      }
      return !!visible[Math.floor(e.y) * W + Math.floor(e.x)];
    };
    if (this.byIdSource !== state.entities || this.byIdLength !== state.entities.length) {
      this.byId.clear(); for (const e of state.entities) this.byId.set(e.id, e);
      this.byIdSource = state.entities; this.byIdLength = state.entities.length;
    }
    const fogChanged = visible && explored ? this.updateFog(state, this.blending) : false;
    if (this.heat && (fogChanged || this.heatExplored < 0)) this.updateHeat(state, explored);
    this.readEvents(state, visible);
    this.updateShake(view, clock);
    const left = this.width / 2 - view.x * zoom + this.shakeX, top = this.height / 2 - view.y * zoom + this.shakeY;
    const knownWalls = new Map();
    for (const e of this.rememberedBuildings.values()) if (entityRole(e) === 'wall' && !entityVisible(e)) knownWalls.set(wallKey(e), e);
    for (const e of state.entities) if (e.hp > 0 && entityRole(e) === 'wall' && (e.team === 0 || entityVisible(e))) knownWalls.set(wallKey(e), e);
    const wallVisual = e => entityRole(e) === 'wall' ? { ...e, wallConnections: wallConnections(e, knownWalls) } : e;
    const x0 = Math.max(0, Math.floor(view.x - this.width / zoom / 2) - 2);
    const y0 = Math.max(0, Math.floor(view.y - this.height / zoom / 2) - 3);
    const x1 = Math.min(W, Math.ceil(view.x + this.width / zoom / 2) + 2);
    const y1 = Math.min(state.height, Math.ceil(view.y + this.height / zoom / 2) + 3);
    // Sprites leave high-quality smoothing behind; the terrain blit keeps the context default.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    rect(ctx, 0, 0, this.width, this.height, '#0e1720');
    ctx.drawImage(this.terrain, left, top, W * zoom, state.height * zoom);
    this.trackFlights(state, time, clock);
    this.drawDecals(state, visible, time, clock);
    ctx.drawImage(this.decals, left, top, W * zoom, state.height * zoom);
    // World layers use one computed transform per body instead of a save/restore pair.
    const a = this.dpr * scale, ox = this.dpr * left, oy = this.dpr * top;
    const world = () => ctx.setTransform(a, 0, 0, a, ox, oy);
    const at = (x, y) => ctx.setTransform(a, 0, 0, a, ox + a * x, oy + a * y);
    world();
    this.drawLava(state, visible, time, x0, y0, x1, y1);
    if (this.heat && this.heatExplored > 0) {
      // Low-resolution warm light on explored banks, blended only around pools on screen. It never
      // animates, so fog keeps nothing live.
      let any = false;
      ctx.beginPath();
      for (const pool of this.lavaPools) {
        const l = Math.max(x0, pool.tx0 - 2), t = Math.max(y0, pool.ty0 - 2), r = Math.min(x1, pool.tx1 + 2), b = Math.min(y1, pool.ty1 + 2);
        if (r > l && b > t) { ctx.rect(l * TILE, t * TILE, (r - l) * TILE, (b - t) * TILE); any = true; }
      }
      if (any) {
        ctx.save(); ctx.clip();
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .16; ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.heat, x0 * 2, y0 * 2, (x1 - x0) * 2, (y1 - y0) * 2, x0 * TILE, y0 * TILE, (x1 - x0) * TILE, (y1 - y0) * TILE);
        ctx.restore();
      }
    }
    // Drawable bodies: friendly or currently visible, posed once per frame for every layer.
    const inView = e => e.x >= x0 - 4 && e.x <= x1 + 2 && e.y >= y0 - 4 && e.y <= y1 + 3;
    const live = [], visibleUnits = [];
    for (const e of state.entities) if (e.hp > 0 && (e.team === 0 || entityVisible(e))) {
      const p = e.kind === 'unit' && this.blending ? this.unitPose(e, visible) : e;
      // Off-screen orders still draw their visible route, but distant bodies do
      // not need depth sorting with the small portion of the map on screen.
      if (e.kind === 'unit') visibleUnits.push(p);
      if (inView(p)) live.push(p);
    }
    // A body a landing shell destroys stays where it was last seen until the shell arrives.
    if (this.dying.length) {
      let keep = 0;
      for (const d of this.dying) if (clock < d.until && d.until - clock < 1) { this.dying[keep++] = d; if (inView(d.body)) live.push(d.body); }
      this.dying.length = keep;
    }
    if (state.time !== this.bodyTime || state !== this.bodyState) {
      // Bodies the player could see on this tick; a death explosion next tick finds its wreck here.
      this.bodies = state.entities.filter(e => e.hp > 0 && (e.team === 0 || entityVisible(e)) && e.kind !== 'rock');
      this.bodyTime = state.time; this.bodyState = state;
    }
    const rangeUnits = visibleUnits.filter(e => e.team === 0 && view.selected?.has(e.id) && UNITS[e.type].damage > 0);
    if (rangeUnits.length) {
      const fade = 1 / Math.sqrt(rangeUnits.length);
      ctx.lineWidth = 1 / scale;
      for (const e of rangeUnits) {
        const radius = unitRange(state, e) * TILE, bonus = e.abilityUntil > time ? ABILITIES[unitRole(e)]?.range || 0 : 0;
        // Simulation distances are circles on the ground plane. Fade overlapping
        // selections and draw beneath units and fog, using friendly state only.
        ctx.beginPath(); ctx.arc(e.x * TILE, e.y * TILE, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(141,204,202,${.016 / rangeUnits.length})`; ctx.fill();
        ctx.strokeStyle = `rgba(141,204,202,${.25 * fade})`; ctx.stroke();
        if (bonus) {
          // Long shot: the extended reach crawls in amber over the unboosted circle.
          ctx.setLineDash([6 / scale, 5 / scale]); ctx.lineDashOffset = -clock * 12 / scale;
          ctx.strokeStyle = `rgba(226,182,126,${.55 * fade})`; ctx.stroke();
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.beginPath(); ctx.arc(e.x * TILE, e.y * TILE, radius - bonus * TILE, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(141,204,202,${.12 * fade})`; ctx.stroke();
        }
      }
    }
    const rows = this.propRowsFor(state);
    for (let y = Math.max(0, y0 - 2); y <= Math.min(rows.length - 1, y1 + 2); y++) for (const prop of rows[y]) {
      if (prop.x < x0 - 2 || prop.x > x1 + 2 || prop.y < y0 - 2 || prop.y > y1 + 2) continue;
      if (explored && !explored[Math.floor(prop.y) * W + Math.floor(prop.x)]) continue;
      drawPropShadow(ctx, prop.kind, prop.x * TILE, prop.y * TILE, prop.size, prop.variant);
    }
    // Ground shadows cannot cover neighbouring roofs or disclose enemies hidden by fog.
    for (const e of live) {
      const n = e.kind === 'building' ? e.size / 2 : 0;
      at((e.x + n) * TILE, (e.y + n) * TILE);
      drawSpriteShadow(ctx, wallVisual(e), clock);
    }
    world();
    // Mineral knowledge refreshes wherever there is sensor coverage, not only inside the viewport.
    for (let i = 0; i < this.knownOre.length; i++) if (!visible || visible[i]) {
      this.knownOre[i] = state.minerals[i]; this.knownMineralTypes[i] = state.mineralTypes?.[i] || 1;
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (explored && !explored[i]) continue;
      const amount = this.knownOre[i];
      if (amount <= 0) continue;
      const mineralType = this.knownMineralTypes[i] || 1, richness = Math.min(1, amount / (mineralType === 3 ? 1000 : 500));
      const n = noise(x, y), cx = x * TILE + 16 + (n - .5) * 8, cy = y * TILE + 18 + (noise(x, y, 11) - .5) * 8;
      const clusterSize = (25 + richness * 14) * (.82 + noise(x, y, 31) * .32) * (mineralType === 3 ? 1.10 : 1);
      const variant = mineralType === 3 ? n < .7 ? 2 : 0 : mineralType === 2 ? n < .5 ? 0 : 1 : Math.floor(n * 3);
      drawPropShadow(ctx, 'ore', cx, cy - 2, clusterSize, variant);
      if (!drawProp(ctx, 'ore', cx, cy - 2, clusterSize, variant, mineralType)) {
        for (let j = 0; j < 3 + richness * 3; j++) {
          crystal(ctx, cx - 9 + noise(x + j * 8, y) * 19, cy - 6 + noise(x, y + j * 7) * 16, .5 + richness * .42, j + n * 100);
        }
      }
      if (visible?.[i] && Math.sin(time * 1.5 + n * 10) > .88) {
        light(ctx, cx + n * 8, cy - 9, mineralType === 3 ? '#ffd3e0' : mineralType === 2 ? '#d6edff' : '#c4fff0');
      }
    }
    // Flares light their own team's ground with a drifting parachute light; nothing here is hidden by it.
    for (const reveal of state.reveals || []) {
      if (reveal.team !== 0) continue;
      const remaining = reveal.until - clock, total = ABILITIES.scout.duration || 12, age = total - remaining;
      if (remaining <= 0 || age < 0) continue;
      const x = reveal.x * TILE, y = reveal.y * TILE, flicker = .82 + Math.sin(clock * 19) * .1 + Math.sin(clock * 31) * .08;
      const strength = Math.min(1, age / .4) * Math.min(1, remaining / 2) * flicker, height = 34 * (1 - age / total) + 6;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .2 * strength;
      glow(ctx, x, y, reveal.r * TILE * .45, '#fff1c8ff');
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = strength;
      glow(ctx, x + Math.sin(clock * .7) * 4, y - height, 7, '#fff3d0d0');
      rect(ctx, x + Math.sin(clock * .7) * 4 - 1, y - height - 1, 2, 2, '#fffaf0');
      ctx.globalAlpha = 1;
    }
    const powers = [powerStats(state, 0), powerStats(state, 1)];
    for (const e of state.entities) if (e.hp > 0 && e.team === 1 && e.kind === 'building' && entityVisible(e)) {
      this.rememberedBuildings.set(e.id, { ...wallVisual(e), queue: (e.queue || []).map(item => ({ ...item })), research: e.research ? { ...e.research } : null,
        upgrade: e.upgrade ? { ...e.upgrade } : null, upgrades: e.upgrades ? { ...e.upgrades } : undefined,
        powerRatio: powers[e.team].ratio, powerStatus: powers[e.team].status, rememberedAt: time });
    }
    for (const [id, e] of this.rememberedBuildings) if (!(this.byId.get(id)?.hp > 0) && entityVisible(e)) this.rememberedBuildings.delete(id);
    const entities = live.slice();
    for (const e of this.rememberedBuildings.values()) if (inView(e) && !entityVisible(e)) entities.push(e);
    let trees = false;
    for (let y = Math.max(0, y0 - 2); y <= Math.min(rows.length - 1, y1 + 2); y++) for (const prop of rows[y]) {
      if (prop.x < x0 - 2 || prop.x >= x1 + 2 || prop.y < y0 - 2 || prop.y >= y1 + 2) continue;
      if (prop.kind === 'tree') { if (explored && !explored[Math.floor(prop.y) * W + Math.floor(prop.x)]) continue; trees = true; }
      entities.push(prop);
    }
    entities.sort((a, b) => (a.y + (a.kind === 'building' ? a.size : 0)) - (b.y + (b.kind === 'building' ? b.size : 0)));
    // Canopies fade over visible units behind them; only drawable bodies are bucketed, by row.
    const unitRows = new Map();
    if (trees) for (const u of live) if (u.kind === 'unit') {
      const row = Math.floor(u.y);
      if (!unitRows.has(row)) unitRows.set(row, []);
      unitRows.get(row).push(u);
    }
    for (const e of entities) {
      if (e.kind === 'rock') { world(); rock(ctx, e.x * TILE, e.y * TILE, e.size, e.variant); continue; }
      if (e.kind === 'tree') {
        const radius = e.size / TILE * .48;
        let obscuresUnit = false;
        for (let row = Math.floor(e.y - radius); row <= Math.floor(e.y) && !obscuresUnit; row++) {
          for (const u of unitRows.get(row) || []) if (u.y < e.y && u.y > e.y - radius && Math.abs(u.x - e.x) < radius) { obscuresUnit = true; break; }
        }
        world(); if (obscuresUnit) ctx.globalAlpha = .42;
        if (!drawProp(ctx, 'tree', e.x * TILE, e.y * TILE, e.size, e.variant)) rock(ctx, e.x * TILE, e.y * TILE, e.size, e.variant);
        ctx.globalAlpha = 1; continue;
      }
      const isBuilding = e.kind === 'building', n = isBuilding ? e.size / 2 : 0;
      at((e.x + n) * TILE, (e.y + n) * TILE);
      if (e.hp > 0 && view.selected?.has(e.id)) {
        // Ground ring sized to the body so the sprite never hides it; width stays ~1 screen pixel at any zoom.
        const r = isBuilding ? e.size * TILE / 2 + 2 : { rifle: 9, rocket: 11, scout: 18, artillery: 26 }[entityRole(e)] ?? 22;
        ctx.strokeStyle = '#b4e2e6'; ctx.lineWidth = 1.2 / scale;
        if (isBuilding) {
          const d = r * .27;
          for (const [xx, yy, dx, dy] of [[-r, -r, d, d], [r, -r, -d, d], [-r, r, d, -d], [r, r, -d, -d]]) {
            ctx.beginPath(); ctx.moveTo(xx, yy + dy); ctx.lineTo(xx, yy); ctx.lineTo(xx + dx, yy); ctx.stroke();
          }
        } else {
          ctx.beginPath(); ctx.ellipse(0, 3, r, r * .62, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#8edbe316'; ctx.fill(); ctx.stroke();
        }
      }
      const remembered = isBuilding && e.team === 1 && e.hp > 0 && !entityVisible(e);
      if (!isBuilding && e.abilityUntil > time && ABILITIES[unitRole(e)]?.holdsPosition) {
        // Dig in: a low ring of sandbags (or braced plates) on the ground around the squad.
        const grow = Math.min(1, (clock - (e.abilityUntil - (ABILITIES.rifle.duration || 10))) / .5);
        ctx.globalAlpha = Math.max(0, grow) * .95; stamp(ctx, digInSprite(UNITS[e.type]?.race === 'aiUnity'), 0, 4, 23, 23); ctx.globalAlpha = 1;
      }
      const visual = isBuilding && !remembered ? { ...wallVisual(e), powerRatio: powers[e.team].ratio, powerStatus: powers[e.team].status } : e;
      // Blink the actual target silhouette, following its live pose without
      // revealing a concealed unit or flashing a remembered structure.
      const targeted = attackPulse > 0 && view.commandMarker.targetId === e.id && !remembered;
      if (targeted) { ctx.save(); ctx.filter = `brightness(${1 + attackPulse * 2})`; }
      if (isBuilding) building(ctx, visual, remembered ? e.rememberedAt : clock); else unit(ctx, e, clock);
      if (targeted) ctx.restore();
      // Hit flash: a separate light silhouette over the frame; baked friendly pixels are never retinted.
      let hitAt = e.lastHit ?? -99;
      if (this.impacts.length && hitAt > clock - 1) hitAt = this.hitLanding(e, hitAt);
      const hit = remembered || (e.progress ?? 1) < 1 ? 0 : pulse(clock - hitAt, HIT_FLASH);
      if (hit > 0) { ctx.globalAlpha = hit * (isBuilding ? .16 : .32); drawSpriteOverlay(ctx, visual, clock, '#fff2dc'); ctx.globalAlpha = 1; }
      if (!remembered && (e.progress ?? 1) >= 1) this.drawEntityActivity(ctx, visual, clock, powers[e.team].ratio);
      else if (remembered && e.progress >= 1 && ['lab', 'capacitor'].includes(entityRole(e))) buildingActivity(ctx, e, e.rememberedAt, e.powerRatio ?? 1);
      if (isBuilding) {
        // Fixed-screen badges: one compact warning per affected facility, never a global flicker, and the team plate.
        const k = this.dpr, ex = ox + a * (e.x + n) * TILE, ey = oy + a * (e.y + n) * TILE;
        if (!remembered && e.progress >= 1 && powers[e.team].ratio < 1 && BUILDING_DEFS[e.type].power < 0) {
          ctx.setTransform(k, 0, 0, k, ex + a * e.size * TILE * .30, ey + a * e.size * TILE * .43);
          ellipse(ctx, 0, 0, 5, 5, '#171b20e8');
          polygon(ctx, [[0, -4], [-3, 1], [0, 1], [-1, 4], [3, -1], [0, -1]], '#e5ab6c');
        }
        const wall = buildingRole(e) === 'wall';
        ctx.setTransform(k, 0, 0, k, ex - a * e.size * TILE * .32, ey + a * e.size * TILE * .43);
        ellipse(ctx, 0, 0, wall ? 3.3 : 5.5, wall ? 3.3 : 5.5, '#0a151ddd');
        teamInsignia(ctx, e.team, 0, 0, wall ? 4.5 : 7);
        at((e.x + n) * TILE, (e.y + n) * TILE);
      }
      if (e.hp > 0 && (view.selected?.has(e.id) || e.hp < e.maxHp * .98) && (e.team === 0 || !remembered)) {
        const w = isBuilding ? Math.min(44, e.size * TILE - 4) : isInfantry(e) ? (entityRole(e) === 'rocket' ? 16 : 13) : 25;
        const yy = isBuilding ? -e.size * TILE / 2 - 16 : -19;
        rect(ctx, -w / 2 - 1, yy - 1, w + 2, 5, '#0a1620ec');
        rect(ctx, -w / 2, yy, w * Math.max(0, e.hp / e.maxHp), 3, e.hp / e.maxHp < .3 ? '#e3855e' : TEAM[e.team].glow);
        if (e.queue?.length || e.research || e.upgrade) {
          rect(ctx, -w / 2 - 1, yy + 5, w + 2, 3, '#0a1620ec');
          rect(ctx, -w / 2, yy + 6, w * (e.upgrade?.progress ?? e.research?.progress ?? e.queue[0].progress), 1, '#dec48a');
        }
      }
    }
    world(); ctx.globalAlpha = 1;
    for (const hauler of visibleUnits) {
      if (!hauler.unloadDepotId || entityRole(hauler) !== 'harvester' || !entityVisible(hauler)) continue;
      const depot = this.byId.get(hauler.unloadDepotId);
      if (!depot || depot.hp <= 0 || !entityVisible(depot)) continue;
      const dx = (depot.x + depot.size / 2) * TILE, dy = (depot.y + depot.size / 2) * TILE;
      const targetX = dx - (entityRole(depot) === 'refinery' ? depot.size * TILE * .20 : 0);
      const targetY = dy + depot.size * TILE * (entityRole(depot) === 'refinery' ? -.30 : .32);
      const angle = unitSpriteAngle(hauler.angle);
      const x = hauler.x * TILE - Math.cos(angle) * 10, y = hauler.y * TILE - Math.sin(angle) * 9;
      for (let i = 0; i < 5; i++) {
        const p = (clock * 1.7 + i / 5) % 1;
        const px = x + (targetX - x) * p, py = y + (targetY - y) * p - Math.sin(p * Math.PI) * 9;
        polygon(ctx, [[px - 2, py], [px, py - 3], [px + 2.5, py], [px, py + 1.5]], '#9fdec5', '#3c756d');
      }
    }
    // Every effect piece is gated by the cell it occupies, so fire from fog shows where it lands but never where it came from.
    const seenAt = (cx, cy) => !visible || !!visible[Math.floor(cy) * W + Math.floor(cx)];
    for (const engineer of visibleUnits) {
      if (!engineer.repairActive || entityRole(engineer) !== 'engineer') continue;
      const target = this.byId.get(engineer.repairTargetId);
      if (!target || target.hp <= 0 || !entityVisible(target)) continue;
      const n = target.kind === 'building' ? target.size / 2 : 0;
      const tx = target.x + n, ty = target.y + n, dx = tx - engineer.x, dy = ty - engineer.y;
      const length = Math.hypot(dx, dy), segments = Math.max(1, Math.ceil(length * 8));
      // Broken amber service pulses keep the repair readable without covering vehicle silhouettes.
      for (let i = 0; i < segments; i++) {
        if ((i + Math.floor(clock * 6)) % 4 > 1) continue;
        const a = i / segments, b = Math.min(1, (i + .65) / segments);
        const x = engineer.x + dx * a, y = engineer.y + dy * a, xx = engineer.x + dx * b, yy = engineer.y + dy * b;
        if (!seenAt(x, y) || !seenAt(xx, yy)) continue;
        line(ctx, x * TILE, y * TILE - 3, xx * TILE, yy * TILE - 3, '#edc58b78', 1);
      }
      const spark = .5 + Math.sin(clock * 29 + engineer.id) * .5;
      glow(ctx, tx * TILE, ty * TILE - 3, 5 + spark * 3, '#ffd5a270');
      for (let i = 0; i < 3; i++) {
        const angle = i * 2.4 + clock * 3, r = 3 + spark * 5;
        line(ctx, tx * TILE + Math.cos(angle) * 2, ty * TILE - 3 + Math.sin(angle) * 2,
          tx * TILE + Math.cos(angle) * r, ty * TILE - 3 + Math.sin(angle) * r, '#ffdda888', .7);
      }
    }
    this.drawParticles(ctx, clock, visible);
    const effects = this.landed.length ? (state.effects || []).concat(this.landed) : state.effects || [];
    for (const fx of effects) {
      // Effects advance on the drawn clock: between ticks each one is shown slightly younger.
      const maxLife = fx.maxLife || .3, alpha = Math.max(0, Math.min(1, (fx.life + lag) / maxLife)), age = 1 - alpha;
      const rocket = fx.type === 'rocket', flying = rocket || fx.type === 'shell';
      const launchX = fx.x - (rocket && fx.weapon === 'rocketTower' ? 14.8 / TILE : 0);
      const px = flying ? launchX + (fx.tx - launchX) * age : fx.x;
      const py = flying ? fx.y + (fx.ty - fx.y) * age : fx.y;
      // Barrage blasts and blasts held for an arriving projectile play as particles instead.
      if (fx.type === 'explosion' && (fx.weapon === 'artillery' || this.held.has(fx))) continue;
      if (fx.type !== 'shot' && !seenAt(px, py) && !(fx.type === 'explosion' && this.seenEffects.has(fx)) && !(fx.type === 'shell' && seenAt(fx.tx, fx.ty))) continue;
      const x = fx.x * TILE, y = fx.y * TILE - 3;
      const unity = state.teams[fx.team]?.race === 'aiUnity';
      if (fx.type === 'shot') {
        const dx = (fx.tx - fx.x) * TILE, dy = (fx.ty - fx.y) * TILE;
        const head = Math.min(1, age * 2.2), tail = Math.max(0, head - .18);
        ctx.globalAlpha = alpha;
        if (seenAt(fx.x + (fx.tx - fx.x) * tail, fx.y + (fx.ty - fx.y) * tail) && seenAt(fx.x + (fx.tx - fx.x) * head, fx.y + (fx.ty - fx.y) * head)) {
          line(ctx, x + dx * tail, y + dy * tail, x + dx * head, y + dy * head, unity ? '#afcbd38c' : '#f3d8a98c', 2.6);
          line(ctx, x + dx * tail, y + dy * tail, x + dx * head, y + dy * head, unity ? '#e3f2f4' : '#fff5d8', .8);
        }
        if (age < .55) {
          if (seenAt(fx.x, fx.y)) {
            glow(ctx, x, y, 12 * alpha, unity ? '#bad9e08f' : '#ffc0708f');
            ellipse(ctx, x, y, 3.5 * alpha, 2.5 * alpha, '#fff5dd');
          }
        } else if (seenAt(fx.tx, fx.ty)) {
          const impact = (age - .55) / .45;
          glow(ctx, fx.tx * TILE, fx.ty * TILE - 3, 7, '#ffab4a64');
          ctx.beginPath();
          for (let j = 0; j < 4; j++) {
            const a = j * 2.4 + fx.tx;
            ctx.moveTo(fx.tx * TILE + Math.cos(a) * impact * 4, fx.ty * TILE - 3 + Math.sin(a) * impact * 4);
            ctx.lineTo(fx.tx * TILE + Math.cos(a) * impact * 10, fx.ty * TILE - 3 + Math.sin(a) * impact * 10);
          }
          ctx.strokeStyle = '#ffe4b6'; ctx.lineWidth = .7; ctx.stroke();
        }
      } else if (rocket) {
        const dx = (fx.tx - launchX) * TILE, dy = (fx.ty - fx.y) * TILE;
        const lift = 14, launchHeight = fx.weapon === 'rocketTower' ? 25.9 : 3;
        const sx = px * TILE, sy = py * TILE - launchHeight * (1 - age) - 3 * age - Math.sin(age * Math.PI) * lift;
        // Each trail puff must be currently visible, including shots entering sensor coverage.
        const puff = radialSprite(TRAIL);
        for (let j = 1; j <= 7; j++) {
          const p = age - j * .026;
          if (p < 0) continue;
          const tx = launchX + (fx.tx - launchX) * p, ty = fx.y + (fx.ty - fx.y) * p;
          if (visible && !visible[Math.floor(ty) * W + Math.floor(tx)]) continue;
          ctx.globalAlpha = (1 - j / 8) * .3;
          stamp(ctx, puff, tx * TILE, ty * TILE - launchHeight * (1 - p) - 3 * p - Math.sin(p * Math.PI) * lift, 2.2 + j * .45, 1.5 + j * .4);
        }
        ctx.globalAlpha = 1;
        const angle = Math.atan2(dy + launchHeight - 3 - Math.cos(age * Math.PI) * Math.PI * lift, dx), cos = Math.cos(angle) * a, sin = Math.sin(angle) * a;
        ctx.setTransform(cos, sin, -sin, cos, ox + a * sx, oy + a * sy);
        polygon(ctx, [[-3, -1.6], [4, -1.6], [7, 0], [4, 1.6], [-3, 1.6]], '#ece5ce', '#667271');
        polygon(ctx, [[-2, -1], [-8 - Math.sin(age * 80) * 2, 0], [-2, 1]], '#f7b76a');
        line(ctx, -3, 0, -6, 0, '#fff4da', 1.3);
        glow(ctx, -4, 0, 5, '#ffa64e70');
        world();
      } else if (fx.type === 'shell') {
        const sx = (fx.x + (fx.tx - fx.x) * age) * TILE;
        const sy = (fx.y + (fx.ty - fx.y) * age) * TILE;
        const lift = Math.sin(age * Math.PI) * 48;
        if (seenAt(fx.tx, fx.ty)) {
          // Incoming: a tightening ring and growing shadow where the shell will land.
          ctx.globalAlpha = .2 + age * .45; ctx.strokeStyle = '#e8a46f'; ctx.lineWidth = .9;
          ctx.beginPath(); ctx.ellipse(fx.tx * TILE, fx.ty * TILE, 10 - age * 6, (10 - age * 6) * .62, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = age * .35; ellipse(ctx, fx.tx * TILE + 1, fx.ty * TILE + 1, 1 + age * 3, .6 + age * 1.8, '#0b0e10');
          ctx.globalAlpha = 1;
        }
        if (seenAt(px, py)) {
          ellipse(ctx, sx + 3, sy + 4, 4, 2, '#10192355');
          line(ctx, sx - (fx.tx - fx.x) * 2, sy - lift - (fx.ty - fx.y) * 2, sx, sy - lift, '#f9c07c66', 3);
          line(ctx, sx - (fx.tx - fx.x), sy - lift - (fx.ty - fx.y), sx, sy - lift, '#fff0c9', 1.2);
          glow(ctx, sx, sy - lift, 8, '#ffb66275');
          ellipse(ctx, sx, sy - lift, 2.5, 2.5, '#fff5d7');
        }
      } else if (fx.type === 'explosion') {
        explosion(ctx, x, y, fx.size || 1, age, alpha, fx.x, fx.y);
      }
      ctx.globalAlpha = 1;
    }
    this.drawEmbers(state, visible, clock, x0, y0, x1, y1);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = 1;
    if (visible && explored) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fog, left, top, W * zoom, state.height * zoom);
    }
    this.drawAsh(ctx, view, clock, state, visible, left, top);
    // Screen-space overlays stay crisp at every camera zoom.
    this.drawMissionMarkers(state, view, clock);
    this.drawSiteLabels(state, view, explored);
    for (const e of visibleUnits) this.drawUnitRank(e, view);
    this.drawAbilityMarkers(state, view, clock, visibleUnits);
    for (const e of visibleUnits) {
      if (e.team !== 0 || !view.selected?.has(e.id) || !['move', 'attackMove'].includes(e.order?.type)) continue;
      const goal = e.order, gx = goal.x, gy = goal.y;
      if (!Number.isFinite(gx) || !Number.isFinite(gy) || Math.hypot(e.x - gx, e.y - gy) < .12) continue;
      const point = this.worldToScreen(gx, gy, view), color = goal.type === 'attackMove' ? '#e2b67e' : '#a8dcd9';
      ctx.lineWidth = 1;
      // The player knows their own assigned order in fog. Paths show only observed cells,
      // so a destination never reveals hidden obstacle routing or an enemy position.
      const route = [{ x: e.x, y: e.y }, ...(e.path || []), { x: gx, y: gy }];
      ctx.setLineDash([3, 7]);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i];
        if (!seenAt(a.x, a.y) || !seenAt(b.x, b.y)) continue;
        const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) * 2));
        let clear = true;
        for (let j = 1; j < steps; j++) if (!seenAt(a.x + (b.x - a.x) * j / steps, a.y + (b.y - a.y) * j / steps)) { clear = false; break; }
        if (!clear) continue;
        const p = this.worldToScreen(a.x, a.y, view), q = this.worldToScreen(b.x, b.y, view);
        line(ctx, p.x, p.y, q.x, q.y, color + '45', .8);
      }
      ctx.setLineDash([]);
      ellipse(ctx, point.x, point.y, 4.5, 3, '#12202bd0');
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        line(ctx, point.x + dx * 3, point.y + dy * 4, point.x + dx * 5, point.y + dy * 4, color);
        line(ctx, point.x + dx * 5, point.y + dy * 4, point.x + dx * 5, point.y + dy * 2, color);
      }
      rect(ctx, point.x - .7, point.y - .7, 1.4, 1.4, color);
    }
    if (view.formationPreview) {
      const preview = view.formationPreview, anchor = this.worldToScreen(preview.x, preview.y, view), color = '#b4e2e6';
      let obstructed = false;
      for (const unit of preview.positions) {
        const p = this.worldToScreen(unit.x, unit.y, view), radius = Math.max(5, unit.size * zoom * .55);
        // Match destination reservation clearance, while checking only observed
        // obstruction cells so the preview cannot disclose hidden structures.
        const margin = unit.size * .43 + .08;
        const blocked = unit.x < margin || unit.y < margin || unit.x >= state.width - margin || unit.y >= state.height - margin || [-margin, margin].some(dx => [-margin, margin].some(dy => {
          const x = Math.floor(unit.x + dx), y = Math.floor(unit.y + dy), index = y * state.width + x;
          return visible?.[index] && state.blocked?.[index];
        }));
        obstructed ||= blocked;
        const slotColor = blocked ? '#e39881' : color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(scale, scale); ctx.globalAlpha = .48;
        drawSprite(ctx, { ...unit, moving: false, cargo: 0 }, 0); ctx.restore();
        ellipse(ctx, p.x, p.y + 2, radius, radius * .62, blocked ? '#e3988120' : '#8edbe318', slotColor + 'bb', 1);
        const dx = Math.cos(preview.heading), dy = Math.sin(preview.heading);
        line(ctx, p.x + dx * (radius + 2), p.y + dy * (radius + 2), p.x + dx * (radius + 7), p.y + dy * (radius + 7), slotColor, 1.5);
      }
      const dx = Math.cos(preview.heading), dy = Math.sin(preview.heading), length = Math.max(34, zoom * 1.8);
      const tip = { x: anchor.x + dx * length, y: anchor.y + dy * length };
      ctx.save(); ctx.setLineDash([4, 4]);
      ellipse(ctx, anchor.x, anchor.y, 20, 20, '#142027b0', color + '80', 1);
      ctx.setLineDash([]);
      line(ctx, anchor.x, anchor.y, tip.x, tip.y, color, 2);
      polygon(ctx, [[tip.x, tip.y], [tip.x - dx * 10 - dy * 5, tip.y - dy * 10 + dx * 5], [tip.x - dx * 10 + dy * 5, tip.y - dy * 10 - dx * 5]], color);
      rect(ctx, anchor.x - 44, anchor.y + 26, 88, 20, '#142027ed');
      ctx.font = '10px monospace'; ctx.fillStyle = color; ctx.textAlign = 'center';
      ctx.fillText(`ROTATE ${Math.round((preview.angle * 180 / Math.PI + 360) % 360)}°`, anchor.x, anchor.y + 40);
      if (obstructed) {
        rect(ctx, anchor.x - 69, anchor.y + 46, 138, 20, '#142027ed'); ctx.fillStyle = '#e39881';
        ctx.fillText('Blocked slots adjust', anchor.x, anchor.y + 60);
      }
      ctx.restore();
    }
    for (const e of state.entities) if (e.hp > 0 && e.team === 0 && view.selected?.has(e.id) && e.rally && ['barracks', 'factory', 'refinery'].includes(entityRole(e))) {
      const origin = this.worldToScreen(e.x + e.size / 2, e.y + e.size / 2, view);
      const point = this.worldToScreen(e.rally.x, e.rally.y, view);
      ctx.save(); ctx.setLineDash([4, 5]);
      line(ctx, origin.x, origin.y, point.x, point.y, '#b4e2e66e'); ctx.setLineDash([]);
      ellipse(ctx, point.x, point.y + 2, 7, 3.5, '#15242bbb', '#b4e2e6');
      line(ctx, point.x, point.y + 1, point.x, point.y - 15, '#d9e9e6', 1.5);
      polygon(ctx, [[point.x + 1, point.y - 15], [point.x + 10, point.y - 12], [point.x + 1, point.y - 8]], '#8dccca');
      ctx.restore();
    }
    if (view.deployUnitId) {
      const vehicle = state.entities.find(e => e.id === view.deployUnitId && e.hp > 0);
      if (vehicle) {
        const p = this.worldToScreen(vehicle.x, vehicle.y, view);
        ctx.save(); ctx.setLineDash([5, 5]);
        ellipse(ctx, p.x, p.y, 4 * zoom, 4 * zoom, '#8dccca08', '#8dccca80', 1);
        ctx.restore();
      }
    }
    if (view.showGrid || view.placement) {
      ctx.save(); ctx.strokeStyle = '#aac7dc14'; ctx.lineWidth = 1;
      for (let x = x0; x <= x1; x++) line(ctx, left + x * zoom, top + y0 * zoom, left + x * zoom, top + y1 * zoom, '#aac7dc14');
      for (let y = y0; y <= y1; y++) line(ctx, left + x0 * zoom, top + y * zoom, left + x1 * zoom, top + y * zoom, '#aac7dc14');
      ctx.restore();
    }
    if (view.placement === 'wall' && view.wallPlan?.cells?.length) {
      const previewWalls = new Map(knownWalls);
      for (const cell of view.wallPlan.cells) previewWalls.set(`0:${cell.x}:${cell.y}`, cell);
      for (const cell of view.wallPlan.cells) {
        const p = this.worldToScreen(cell.x + .5, cell.y + .5, view), color = cell.ok ? '#a6dddb' : '#e39881';
        const wall = { type: 'wall', team: 0, size: 1, progress: 1, x: cell.x, y: cell.y };
        wall.wallConnections = wallConnections(wall, previewWalls);
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(scale, scale); ctx.globalAlpha = .7;
        drawSprite(ctx, wall, time);
        rect(ctx, -TILE / 2, -TILE / 2, TILE, TILE, cell.ok ? '#8de1e824' : '#ed796847');
        ctx.strokeStyle = color; ctx.lineWidth = 1 / scale; ctx.strokeRect(-TILE / 2, -TILE / 2, TILE, TILE); ctx.restore();
      }
    } else if (view.placement && view.hover) {
      const size = SIZES[view.placement] || 2, x = Math.floor(view.hover.x), y = Math.floor(view.hover.y);
      const p = this.worldToScreen(x, y, view), color = view.placementValid ? '#b0e6e8' : '#ef967b';
      ctx.save(); ctx.translate(p.x + size * zoom / 2, p.y + size * zoom / 2); ctx.scale(scale, scale);
      ctx.globalAlpha = .6; building(ctx, { type: view.placement, team: 0, size, progress: 1 }, time); ctx.globalAlpha = 1;
      rect(ctx, -size * TILE / 2, -size * TILE / 2, size * TILE, size * TILE, view.placementValid ? '#8de1e827' : '#ff66583a');
      ctx.strokeStyle = color; ctx.lineWidth = 1 / scale; ctx.strokeRect(-size * TILE / 2, -size * TILE / 2, size * TILE, size * TILE);
      ctx.restore();
    }
    if (view.commandMarker && view.commandMarker.type !== 'attack') {
      const marker = view.commandMarker, age = commandAge;
      if (age >= 0 && age < 1) {
        const p = this.worldToScreen(marker.x, marker.y, view), color = '#c5edef';
        ctx.save(); ctx.globalAlpha = 1 - age; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        const r = 5 + age * 17;
        ellipse(ctx, p.x, p.y, r, r * .65, null, color);
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) line(ctx, p.x + Math.cos(a) * (r + 3), p.y + Math.sin(a) * (r + 3) * .65, p.x + Math.cos(a) * (r + 7), p.y + Math.sin(a) * (r + 7) * .65, color);
        ctx.restore();
      }
    }
    if (view.drag) {
      const { x1, y1, x2, y2 } = view.drag;
      rect(ctx, Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), '#9adce213');
      ctx.strokeStyle = '#b8e4e990'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(x1, x2) + .5, Math.min(y1, y2) + .5, Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    const vignette = this.vignetteImage();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(vignette, 0, 0, vignette.width * VIGNETTE_STEP, vignette.height * VIGNETTE_STEP);
    if (performance.now() - this.lastMinimap > 130) {
      this.drawMinimap(state, view, entityVisible); this.lastMinimap = performance.now();
    } else this.drawMinimapOverlay(state, view);
  }

  drawEntityActivity(ctx, e, time, power = 1) {
    if (e.hp <= 0 || e.progress < 1) return;
    if (e.kind === 'building') buildingActivity(ctx, e, time, power);
    if (e.kind === 'building' && e.upgrade) {
      const s = e.size * TILE, p = Math.max(0, Math.min(1, e.upgrade.progress || 0));
      ctx.save(); ctx.globalAlpha *= .7;
      line(ctx, -s * .3, -s * .4, -s * .3 + s * .6 * p, -s * .4, '#e4bd80', 1.2);
      glow(ctx, -s * .3 + s * .6 * p, -s * .4, 4, '#e8c08870'); ctx.restore();
    }
    if (e.kind === 'unit') {
      const moving = e.moving ?? e.path?.length > 0;
      const angle = unitSpriteAngle(e.angle);
      // Attached effects rotate with the chosen view; points are rotated here instead of the context.
      const cos = Math.cos(angle), sin = Math.sin(angle), alpha = ctx.globalAlpha;
      if (moving && !isInfantry(e)) {
        const walker = UNITS[e.type]?.race === 'aiUnity' && unitRole(e) !== 'scout';
        ctx.fillStyle = '#bbaa92';
        for (let j = 0; j < 4; j++) {
          const age = (time * .9 + j * .25 + e.id * .17) % 1;
          const x = walker ? (j % 2 ? 8 : -8) - age * 2 : -13 - age * 19, y = walker ? (j < 2 ? -10 : 10) : Math.sin(j * 7) * 6;
          ctx.globalAlpha = alpha * (1 - age) * (walker ? .075 : .11);
          ctx.beginPath(); ctx.ellipse(x * cos - y * sin, x * sin + y * cos, walker ? 1.5 + age * 3 : 4 + age * 8, walker ? 1 + age * 2 : 3 + age * 4, angle, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = alpha;
      } else if (entityRole(e) === 'harvester' && e.order?.type === 'harvest' && e.harvestPhase === 'gather' && e.cargo > 0) {
        ctx.save(); ctx.rotate(angle);
        for (let j = 0; j < 3; j++) {
          const age = (time * 1.5 + j / 3) % 1;
          ctx.globalAlpha = (1 - age) * .34;
          ellipse(ctx, 18 + age * 9, (j - 1) * 5 - age * 5, 1 + age * 2, 1 + age, '#e5b577');
        }
        ctx.restore();
      }
      if (e.abilityUntil > time && ABILITIES[unitRole(e)]?.speed) {
        // Overdrive / Afterburner: a hot exhaust core and short heat puffs behind the chosen view.
        const back = unitRole(e) === 'striker' ? -21 : -18, unity = UNITS[e.type]?.race === 'aiUnity';
        ctx.save(); ctx.rotate(angle);
        const flicker = .8 + Math.sin(time * 41 + e.id) * .2;
        ctx.globalAlpha = .85 * flicker;
        stamp(ctx, radialSprite(unity ? COOLANT : FLAME), back, 0, 6 + flicker * 2, 2.6);
        for (let j = 0; j < 5; j++) {
          const age = (time * (moving ? 3.2 : 1.4) + j / 5 + e.id * .13) % 1;
          ctx.globalAlpha = (1 - age) * (moving ? .32 : .16);
          stamp(ctx, radialSprite(STEAM), back - 3 - age * (moving ? 22 : 7), (j % 2 ? 2.5 : -2.5) * (1 + age), 2 + age * 6, 1.6 + age * 4);
        }
        if (moving) { ctx.globalAlpha = .45; line(ctx, back - 2, -4, back - 15, -4, '#ffe2b04d', .8); line(ctx, back - 2, 4, back - 15, 4, '#ffe2b04d', .8); }
        ctx.restore();
      }
      const shot = pulse(time - (e.lastShot ?? -99), .14);
      if (shot > 0 && !['engineer', 'harvester'].includes(entityRole(e))) {
        const reach = { rifle: 11, rocket: 15, scout: 16, tank: 24, artillery: 31, striker: 25 }[entityRole(e)] || 18;
        const unity = UNITS[e.type]?.race === 'aiUnity';
        // The muzzle sits on the ground-plane heading, foreshortened vertically like the sprite views.
        const at = (x, y) => [x * cos - y * sin, (x * sin + y * cos) * .88];
        ctx.globalAlpha = alpha * shot;
        for (const y of entityRole(e) === 'striker' ? [-2, 2] : [0]) {
          polygon(ctx, [at(reach, y - 1.2), at(reach + 7 * shot, y), at(reach, y + 1.2)], unity ? '#e0eef0' : '#ffe2ac');
          const [gx, gy] = at(reach + 1, y), r = 4 + shot * 3;
          ctx.drawImage(glowSprite(unity ? '#b4d4db65' : '#ffc27e65'), gx - r, gy - r * .88, r * 2, r * 2 * .88);
        }
        ctx.globalAlpha = alpha;
      }
      if (!isInfantry(e) && e.hp < e.maxHp * .25) {
        // A badly damaged vehicle burns: small flickering tongues over the rear deck, never over the turret.
        const back = angle + Math.PI, bx = Math.cos(back) * 8, by = Math.sin(back) * 5 - 4;
        const flicker = .75 + Math.sin(time * 23 + e.id * 1.7) * .15 + Math.sin(time * 37 + e.id) * .1;
        ctx.globalAlpha = alpha * .35 * flicker; glow(ctx, bx, by + 1, 10, '#ff9a4a90');
        for (let j = 0; j < 4; j++) {
          const age = (time * 1.7 + j / 4 + e.id * .31) % 1;
          ctx.globalAlpha = alpha * (1 - age) * .95 * flicker;
          stamp(ctx, radialSprite(FLAME), bx + (j - 1.5) * 2.4 + Math.sin(time * 9 + j) * .8, by - age * 11, 3.4 * (1 - age * .45), 5 * (1 - age * .35));
        }
        ctx.globalAlpha = alpha;
      }
    }
    const damaged = e.hp < e.maxHp * .4;
    if (e.kind === 'building' && BUILDING_DEFS[e.type]?.race !== 'aiUnity' && (entityRole(e) === 'reactor' || entityRole(e) === 'refinery' && e.processingAmount > 0) || damaged) {
      const s = e.kind === 'building' ? e.size * TILE : 28, puff = radialSprite(damaged ? DARK_SMOKE : STEAM), alpha = ctx.globalAlpha;
      for (let j = 0; j < (damaged ? 5 : 3); j++) {
        const age = (time * (damaged ? .42 : .28) + j / (damaged ? 5 : 3) + e.id * .13) % 1;
        const refineryStack = entityRole(e) === 'refinery' && !damaged;
        const x = (refineryStack ? s * .345 : -s * .2) + age * 14 + Math.sin(time + j) * 2;
        const y = (refineryStack ? -s * .427 : -s * .38) - age * 30;
        ctx.globalAlpha = alpha * Math.sin(age * Math.PI) * (damaged ? .25 : .085);
        stamp(ctx, puff, x, y, 3 + age * (damaged ? 12 : 9));
      }
      ctx.globalAlpha = alpha;
    }
    if (e.kind === 'building' && e.queue?.length) {
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * (.4 + Math.sin(time * Math.max(.2, power) * 7 + e.id) * .1) * (power < 1 ? .5 : 1);
      glow(ctx, 0, e.size * TILE * .23, e.size * 4, '#ffcf7f50'); ctx.globalAlpha = alpha;
    }
  }

  drawUnitRank(entity, view) {
    const ctx = this.ctx, px = (entity.x - view.x) * view.zoom + this.width / 2 + this.shakeX, py = (entity.y - view.y) * view.zoom + this.height / 2 + this.shakeY;
    if (px < 0 || px > this.width || py < 0 || py > this.height) return;
    const radius = entityRole(entity) === 'artillery' ? 30 : isInfantry(entity) ? 16 : 25;
    const y = Math.round(py + Math.max(11, radius * view.zoom / TILE) + 3), x = Math.round(px);
    const rank = unitRank(entity), team = entity.team === 1 ? 1 : 0;
    const group = team === 0 && entity.controlGroup >= 1 && entity.controlGroup <= 5 ? entity.controlGroup : 0;
    const key = `${team}:${rank}:${group}`;
    let badge = this.rankBadges.get(key);
    if (!badge) { badge = this.createRankBadge(team, rank, group); this.rankBadges.set(key, badge); }
    ctx.drawImage(badge, x - 14, y - (group ? 4 : 2), badge.width / this.dpr, badge.height / this.dpr);
  }

  createRankBadge(team, rank, group) {
    const badge = document.createElement('canvas');
    badge.width = Math.ceil((group ? 45 : 28) * this.dpr); badge.height = Math.ceil((group ? 15 : 9) * this.dpr);
    const ctx = badge.getContext('2d'), x = 0, y = 0;
    ctx.scale(this.dpr, this.dpr); ctx.translate(14, group ? 4 : 2);
    rect(ctx, -14, -2, 28, 9, '#0a151ddd');
    teamInsignia(ctx, team, -9, 2, 7);
    for (let slot = 0; slot < 3; slot++) {
      const left = x - 3 + slot * 5;
      polygon(ctx, [[left, y + 2], [left + 2, y], [left + 4, y + 2], [left + 4, y + 4], [left + 2, y + 2], [left, y + 4]], slot < rank ? '#e4b975' : '#506167');
    }
    if (group) {
      rect(ctx, x + 16, y - 4, 15, 15, '#0a151df2');
      ctx.strokeStyle = '#8dccca'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 16.5, y - 3.5, 14, 14);
      ctx.fillStyle = '#dbe4de'; ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(group), x + 23.5, y + 3.5);
    }
    return badge;
  }

  minimapLayout(state) {
    const c = this.minimap, bounds = c.getBoundingClientRect();
    const w = bounds.width || 200, h = bounds.height || 150, s = Math.min(w / state.width, h / state.height);
    return { w, h, s, ox: (w - state.width * s) / 2, oy: (h - state.height * s) / 2 };
  }

  // The tactical map bakes terrain, fog and markers a few times per second; the viewport and hit pings redraw every frame.
  drawMinimap(state, view, entityVisible) {
    if (!this.minimap) return;
    const c = this.minimap, { w, h, s, ox, oy } = this.minimapLayout(state);
    const pw = Math.round(w * this.dpr), ph = Math.round(h * this.dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    this.minimapBase ??= document.createElement('canvas');
    if (this.minimapBase.width !== pw || this.minimapBase.height !== ph) { this.minimapBase.width = pw; this.minimapBase.height = ph; }
    const ctx = this.minimapBase.getContext('2d'); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    rect(ctx, 0, 0, w, h, '#0d1720');
    const visible = state.visible?.[0], explored = state.explored?.[0];
    if (!this.miniTiles || this.miniTiles.width !== state.width) { this.miniTiles = document.createElement('canvas'); this.miniTiles.width = state.width; this.miniTiles.height = state.height; }
    const tiles = this.miniTiles.getContext('2d'), img = tiles.createImageData(state.width, state.height), data = img.data;
    // Ash, raised rock, basalt, lava, deadwood roots (warm grey-brown, so groves never read as rock walls), crater floors.
    const palette = [[87, 94, 96], [139, 139, 130], [52, 59, 62], [237, 123, 34], [104, 92, 74], [69, 67, 58]];
    const ore = [[131, 213, 201], [131, 213, 201], [118, 183, 249], [247, 121, 153]];
    for (let i = 0; i < state.terrain.length; i++) {
      if (explored && !explored[i]) continue;
      const color = this.knownOre[i] > 0 ? ore[this.knownMineralTypes[i] || 1] : palette[state.terrain[i]] || palette[0], p = i * 4, dim = visible && !visible[i] ? .5 : 0;
      data[p] = color[0] + (10 - color[0]) * dim; data[p + 1] = color[1] + (21 - color[1]) * dim; data[p + 2] = color[2] + (32 - color[2]) * dim; data[p + 3] = 255;
    }
    tiles.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(this.miniTiles, ox, oy, state.width * s, state.height * s);
    const drawDot = (e) => {
      const building = e.kind === 'building', size = building ? Math.max(4, e.size * s) : Math.max(3, s * .65);
      const center = building ? e.size / 2 : 0;
      teamInsignia(ctx, e.team, ox + (e.x + center) * s, oy + (e.y + center) * s, size);
    };
    for (const e of state.entities) if (e.hp > 0 && (e.team === 0 || entityVisible(e))) drawDot(e);
    for (const e of this.rememberedBuildings.values()) if (!entityVisible(e)) { ctx.globalAlpha = .4; drawDot(e); ctx.globalAlpha = 1; }
    // Named sites once explored, and the mission zones the player may see.
    const sites = (state.sites || []).filter(site => Number.isFinite(site.x) && Number.isFinite(site.y)
      && (!explored || explored[Math.floor(site.y) * state.width + Math.floor(site.x)]));
    ctx.font = '600 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const site of sites) {
      const x = ox + site.x * s, y = oy + site.y * s;
      polygon(ctx, [[x, y - 2.5], [x + 2.5, y], [x, y + 2.5], [x - 2.5, y]], '#142027', '#c4d2cf');
      if (w >= 150 && sites.length <= 16) {
        const name = String(site.name || site.id), width = ctx.measureText(name).width;
        ctx.globalAlpha = .8; rect(ctx, x - width / 2 - 2, y + 3, width + 4, 8, '#0a151dc0'); ctx.globalAlpha = 1;
        ctx.fillStyle = '#c4d2cf'; ctx.fillText(name, x, y + 4);
      }
    }
    for (const [zone, goal] of this.missionZones(state) || []) {
      ctx.strokeStyle = goal === 'active' ? '#e2b67e' : goal === 'done' ? '#8dccca99' : '#97acb177'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ox + zone.x * s, oy + zone.y * s, Math.max(2.5, zone.r * s), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#9bbbc522'; ctx.strokeRect(.5, .5, w - 1, h - 1);
    this.drawMinimapOverlay(state, view);
  }

  drawMinimapOverlay(state, view) {
    if (!this.minimap || !this.minimapBase) return;
    const c = this.minimap, { w, h, s, ox, oy } = this.minimapLayout(state), ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.minimapBase, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, state.width * s, state.height * s); ctx.clip();
    // Recent hits on friendly forces ping in warning orange so an off-screen raid is never silent.
    const time = state.time || 0;
    for (const e of state.entities) if (e.team === 0 && e.hp > 0 && time - (e.lastHit ?? -99) < 3) {
      const n = e.kind === 'building' ? e.size / 2 : 0, pulse = 4 + ((time * 2) % 1) * 4;
      ctx.strokeStyle = '#e29677'; ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + (e.x + n) * s - pulse, oy + (e.y + n) * s - pulse, pulse * 2, pulse * 2);
    }
    // Active objective beacons pulse on the tactical map as well.
    for (const [zone, goal] of this.missionZones(state) || []) if (goal === 'active') {
      const k = time * .45 % 1, x = ox + zone.x * s, y = oy + zone.y * s;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#e2b67e'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, 2 + k * 7, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      polygon(ctx, [[x, y - 3], [x + 3, y], [x, y + 3], [x - 3, y]], '#e2b67e', '#142027');
    }
    ctx.strokeStyle = '#c5e7eebb'; ctx.lineWidth = 1;
    ctx.strokeRect(ox + (view.x - this.width / view.zoom / 2) * s, oy + (view.y - this.height / view.zoom / 2) * s, this.width / view.zoom * s, this.height / view.zoom * s);
    ctx.restore();
  }
}
