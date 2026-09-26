import { spriteCell, spriteRevision, spritesReady } from './sprite-assets.js';
import { BONUS_PALETTE } from './bonus-sprites.js';

const random = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
// Effects retain shared artwork and current playback state only. Repeated bursts
// reuse particle records instead of leaving hundreds of short-lived objects for GC.
export const EFFECT_LIMITS = Object.freeze({ particles: 700, rings: 96, lights: 48, wrecks: 60, delayed: 72, flares: 6, textures: 24, sparkTextures: 24 });
const CAPPED_STATES = ['rings', 'lights', 'wrecks', 'delayed', 'flares'];
const EFFECT_STATES = ['particles', ...CAPPED_STATES];
// Capital ships get a short camera response; routine kills and collateral
// bursts keep their impact local so a crowded wave remains readable.
export function explosionIntensity(event) {
  if (event.secondary || event.ground || event.type !== 'explosion') return 0;
  if (event.boss) return 1;
  if (event.midboss) return .8;
  if (event.player) return .65;
  return Math.max(0, Math.min(.72, ((event.size || 20) - 36) / 36));
}
const textures = new Map();
// Sparks have their own tiny, preflight-only cache: their palette must never
// displace an explosion texture or allocate artwork during a busy fight.
const sparkTextures = new Map();
const SPARK_SIZES = [8, 16, 32, 64, 128];
const SPARK_PIXELS = SPARK_SIZES.reduce((sum, size) => sum + size * size, 0);
const SPARK_COLORS = ['#fffbea', '#ffbb6b', '#ffc985', '#ddffed', '#ffe88d', '#ffe38a', '#8affd7', '#ff7a8a'];
function warmSparkTexture(color) {
  if (sparkTextures.has(color) || sparkTextures.size >= EFFECT_LIMITS.sparkTextures) return;
  const levels = SPARK_SIZES.map(size => {
    const canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, size);
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.beginPath(); context.arc(size / 2, size / 2, size / 2 - 1, 0, TAU); context.fill();
    return canvas;
  });
  sparkTextures.set(color, levels);
}
function releaseTexture(canvas) { canvas.width = canvas.height = 1; }
export function effectTextureStats() {
  let bytes = 0;
  for (const canvas of textures.values()) bytes += canvas.width * canvas.height * 4;
  return { count: textures.size, bytes, sparks: { count: sparkTextures.size, bytes: sparkTextures.size * SPARK_PIXELS * 4 } };
}
let textureRevision = -1;
function texture(key, paint, size = 128) {
  if (textureRevision !== spriteRevision) {
    for (const canvas of textures.values()) releaseTexture(canvas);
    textures.clear(); textureRevision = spriteRevision;
  }
  if (textures.has(key)) {
    const canvas = textures.get(key); textures.delete(key); textures.set(key, canvas);
    return canvas;
  }
  const c = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, size);
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  if (textures.size >= EFFECT_LIMITS.textures) {
    const oldest = textures.keys().next().value;
    releaseTexture(textures.get(oldest)); textures.delete(oldest);
  }
  textures.set(key, c);
  return c;
}
function lightTexture(color) {
  return texture(`light:${color}`, (c, size) => {
    const r = size / 2, g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, color); g.addColorStop(.12, '#ff944766'); g.addColorStop(.55, '#e56f2818'); g.addColorStop(1, '#cc682000');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
  });
}
function fireBloomTexture() {
  return texture('fire-bloom', (c, size) => {
    const r = size / 2, g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, '#fff7c9d9'); g.addColorStop(.09, '#ffe18fab');
    g.addColorStop(.28, '#ffb54e5e'); g.addColorStop(.62, '#ff68211c'); g.addColorStop(1, '#ed450000');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
  });
}
function lensStreakTexture() {
  return texture('lens-streak', (c, size) => {
    const r = size / 2;
    c.translate(r, r); c.scale(1, .035);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, '#fff8d9'); g.addColorStop(.08, '#ffefbce6');
    g.addColorStop(.28, '#ffbd7985'); g.addColorStop(.65, '#ffe7b82e'); g.addColorStop(1, '#ffc57900');
    c.fillStyle = g; c.fillRect(-r, -r, size, size);
  }, 256);
}
function lensGhostTexture() {
  return texture('lens-ghost', (c, size) => {
    const r = size / 2, g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, '#93cfca00'); g.addColorStop(.4, '#8ac4c20a');
    g.addColorStop(.72, '#b5e4dc66'); g.addColorStop(.86, '#72bcc32e'); g.addColorStop(1, '#639ba700');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
  });
}
function wreckTexture(elongated = false) {
  return texture(`wreck:${elongated}`, (c, size) => {
    const scorch = spriteCell('effects', elongated ? 13 : 12), metal = spriteCell('effects', 10);
    if (scorch) {
      c.globalAlpha = .83; fitSprite(c, scorch, size / 2, size / 2, size); c.globalAlpha = 1;
      if (metal) { const width = size * .48, height = width * metal.height / metal.width; c.drawImage(metal, (size - width) / 2, (size - height) / 2, width, height); }
      return;
    }
    c.translate(size / 2, size / 2);
    const unit = size / 3.6, g = c.createRadialGradient(0, 0, 0, 0, 0, unit * 1.7);
    g.addColorStop(0, '#0b0d0dda'); g.addColorStop(.45, '#13130f8a'); g.addColorStop(1, '#12161300');
    c.fillStyle = g; c.fillRect(-size / 2, -size / 2, size, size);
    c.fillStyle = '#202b2a'; c.strokeStyle = '#746151'; c.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      c.rotate(2.4); const r = unit * (.17 + i % 3 * .19);
      c.beginPath(); c.moveTo(r, -r * .4); c.lineTo(r + unit * .27, -r * .16); c.lineTo(r + unit * .19, r * .2); c.lineTo(r - unit * .12, r * .1); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#bf603e'; c.fillRect(r, 0, unit * .06, 1.5); c.fillStyle = '#202b2a';
    }
  }, 256);
}
function smokeTexture(light = false) {
  const source = spriteCell('effects', light ? 8 : 9);
  if (source) return source;
  return texture(`smoke:${light}`, (c, size) => {
    const mid = size / 2;
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4, x = mid + Math.cos(angle) * size * .13, y = mid + Math.sin(angle) * size * .13;
      const gradient = c.createRadialGradient(x, y, 0, x, y, size * .31);
      gradient.addColorStop(0, light ? '#adaca373' : '#22282cad'); gradient.addColorStop(.45, light ? '#8c92916b' : '#29333869'); gradient.addColorStop(1, '#1a202600');
      c.fillStyle = gradient; c.fillRect(0, 0, size, size);
    }
  });
}
// Leave room for the camera shake and antialiasing at the viewport edge.
function intersectsView(x, y, rx, ry, W, H) {
  return x + rx >= -32 && x - rx <= W + 32 && y + ry >= -32 && y - ry <= H + 32;
}
function fitSprite(ctx, sprite, x, y, diameter) {
  const scale = diameter / Math.max(sprite.width, sprite.height), width = sprite.width * scale, height = sprite.height * scale;
  ctx.drawImage(sprite, x - width / 2, y - height / 2, width, height);
}
export function warmEffectsTextures(colors = []) {
  for (let i = 0; i < 14; i++) spriteCell('effects', i);
  wreckTexture(); wreckTexture(true); smokeTexture(); smokeTexture(true);
  fireBloomTexture(); lensStreakTexture(); lensGhostTexture();
  for (const color of new Set(['#ffbb6b', '#ffc985', '#ff9e7d', '#ffe36d', '#ffe8b0', '#ff9ab8', ...colors])) if (color) lightTexture(color);
  for (const color of new Set([...SPARK_COLORS, ...colors])) if (color) warmSparkTexture(color);
}
spritesReady.then(() => warmEffectsTextures());
function ageAndCompact(list, dt) {
  let length = 0;
  for (const p of list) { p.age += dt; if (p.age < p.life) list[length++] = p; }
  list.length = length;
}
function keepNewest(list, limit) {
  if (list.length > limit) { list.copyWithin(0, list.length - limit); list.length = limit; }
}
export class Effects {
  constructor() { this.particles = []; this.particlePool = []; this.rings = []; this.lights = []; this.wrecks = []; this.delayed = []; this.flares = []; this.shake = 0; this.flash = 0; this.damagePulse = 0; this.impact = 0; this.impactPeak = 0; this.impactStart = 0; this.impactAge = 0; this.impactDuration = 0; this.glitch = 0; this.signalY = 0; this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; this.quality = 'high'; this.softLightPass = { width: 0, height: 0 }; this.softLightDraw = ctx => { const pass = this.softLightPass; this.drawLights(ctx, pass.width, pass.height); }; }
  reset() {
    for (const key of EFFECT_STATES) this[key].length = 0;
    this.particlePool.length = 0;
    this.shake = 0; this.flash = 0; this.damagePulse = 0;
    this.impact = this.impactPeak = this.impactStart = this.impactAge = this.impactDuration = this.glitch = 0;
  }
  get memory() {
    return { particleRecords: this.particles.length + this.particlePool.length,
      active: Object.fromEntries(EFFECT_STATES.map(key => [key, this[key].length])),
      textures: effectTextureStats() };
  }
  reserveParticles(count) {
    const remove = Math.max(0, this.particles.length + Math.ceil(count) - EFFECT_LIMITS.particles);
    for (let i = 0; i < remove; i++) this.particlePool.push(this.particles[i]);
    if (remove) { this.particles.copyWithin(0, remove); this.particles.length -= remove; }
  }
  particle(x, y, vx, vy, life, radius, color, smoke = false, debris = false, ground = false, angle = 0) {
    const p = this.particlePool.pop() || {};
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.age = 0; p.life = life; p.radius = radius; p.color = color;
    p.smoke = smoke; p.debris = debris; p.ground = ground; p.angle = angle;
    this.particles.push(p);
  }
  emit(event, scroll = 0, groundOffset = 0) {
    const { x = 0, y = 0, size = 20 } = event;
    if (event.type === 'explosion' || event.type === 'phase') {
      const boss = event.boss, noDebris = boss || event.noDebris, weight = explosionIntensity(event), count = Math.min(boss ? 130 : 55, Math.round(size * 1.1)) * (this.quality === 'high' ? 1 : .55);
      const charges = boss ? 18 : !event.player && weight >= .35 ? (event.midboss ? 6 : 3) : 0;
      // Secondary boss detonations retain their fire and sparks without metal fragments.
      for (let i = 0; i < charges; i++) this.delayed.push({ delay: .1 + i * (boss ? .085 : .09), scroll, groundOffset, event: { type: 'explosion', x: x + random(-size, size) * .8, y: y + random(-size * .7, size * .7), size: random(19, boss ? 56 : Math.max(24, size * .68)), secondary: true, noDebris } });
      const color = event.ground ? (event.color || '#ffc985') : '#ffbb6b';
      this.reserveParticles(count);
      for (let i = 0; i < count; i++) {
        const angle = random(0, TAU), speed = random(25, boss ? 470 : (size * 5 + 50) * (1 + weight * .3));
        this.particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, random(.3, boss ? 2.3 : 1.2), random(1.2, size * .12 + 2), color, i % 4 === 0, !noDebris && i % 5 === 0, !!event.ground, angle);
      }
      this.rings.push({ x, y, age: 0, life: boss ? 1.35 : .5 + weight * .25, radius: size * (boss ? 7 : 3 + weight * 2), color, explosion: true, diameter: size * (4 + weight), ground: !!event.ground });
      if (weight >= .35) this.rings.push({ x, y, age: 0, life: boss ? 1.05 : .75, radius: size * (boss ? 8.5 : 5), color: '#ffd7a0' });
      this.lights.push({ x, y, age: 0, life: boss ? 1.05 : .3 + weight * .35, radius: size * (5 + weight), color, fire: true, ground: !!event.ground });
      if (!this.reduced && !event.secondary && (boss || size >= 45)) {
        this.flares.push({ x, y, age: 0, life: boss ? .7 : .48, radius: size * (boss ? 5 : 4), strength: boss ? 1 : .75, ground: !!event.ground });
      }
      if (event.type !== 'phase' && !event.ground && !event.secondary && !noDebris) this.wrecks.push({ x: x - groundOffset, y: y - scroll, size, angle: random(0, TAU), age: 0 });
      this.shake = Math.min(23, this.shake + size * (event.ground ? .028 : .09) + weight * 12);
      this.flash = Math.max(this.flash, boss ? .32 : event.player ? .2 : .03 + weight * .06);
      if (!this.reduced && weight > 0) {
        this.impactStart = this.impact; this.impactPeak = Math.max(this.impact, weight);
        this.impactAge = 0; this.impactDuration = .28 + this.impactPeak * .42;
        if (weight >= .5) { this.glitch = .12; this.signalY = y; }
      }
    } else if (event.type === 'spark') {
      this.reserveParticles(4);
      for (let i = 0; i < 4; i++) this.particle(x, y, random(-100, 100), random(10, 150), random(.1, .22), random(1, 3), '#ddffed');
    } else if (event.type === 'hit') {
      this.shake = Math.max(this.shake, 5);
      this.damagePulse = Math.max(this.damagePulse, event.shield ? .65 : 1);
      this.rings.push({ x, y, age: 0, life: .27, radius: 52, color: event.shield ? '#91ffee' : '#ff6c5e' });
    } else if (event.type === 'pickup') {
      const timed = event.bonus === 'rapid' || event.bonus === 'invulnerable';
      const color = BONUS_PALETTE.rim;
      if (timed) this.rings.push({ x, y, age: 0, life: .45, radius: 65, color });
    } else if (event.type === 'combo') {
      const color = event.combo >= 5 ? '#ffe36d' : '#b8ffe2';
      this.rings.push({ x, y, age: 0, life: .55, radius: 42 + event.combo * 5, color });
      this.shake = Math.min(18, this.shake + 2 + event.combo * .35);
    } else if (event.type === 'blast') {
      this.rings.push({ x, y, age: 0, life: .45, radius: size * 1.9, color: event.color || '#ff9e7d', explosion: true, diameter: size * 2.3 });
      this.lights.push({ x, y, age: 0, life: .24, radius: size * 2.8, color: event.color || '#ff9e7d', fire: true });
      this.shake = Math.min(18, this.shake + size * .035);
    } else if (event.type === 'arc') {
      const segments = 5;
      this.reserveParticles(segments);
      for (let i = 0; i < segments; i++) {
        const t = (i + .5) / segments;
        this.particle(x + (event.toX - x) * t, y + (event.toY - y) * t, random(-32, 32), random(-32, 32), .16, random(1.5, 3.5), event.color || '#ffe88d');
      }
    } else if (event.type === 'weak-hit' || event.type === 'blocked') {
      this.rings.push({ x, y, age: 0, life: .2, radius: event.type === 'blocked' ? 15 : 25, color: event.type === 'blocked' ? '#ff8b78' : '#fff1a6' });
    } else if (event.type === 'weak-break') {
      this.emit({ type: 'explosion', x, y, size: size * 1.35, color: '#ffe36d', noDebris: true }, scroll, groundOffset);
    } else if (event.type === 'nova') {
      // A shockwave from the ship; every cancelled round becomes a gold spark.
      this.rings.push({ x, y, age: 0, life: .75, radius: 1400, color: '#fff1c2' }, { x, y, age: 0, life: .55, radius: 820, color: '#8affd7' });
      this.lights.push({ x, y, age: 0, life: .5, radius: 520, color: '#ffe8b0', fire: true });
      const cancels = event.cancels || [];
      this.reserveParticles(cancels.length * 2);
      for (const [cx, cy] of cancels) for (let i = 0; i < 2; i++) this.particle(cx, cy, random(-60, 60), random(-120, 20), random(.35, .7), random(1.6, 2.8), '#ffe38a');
      this.shake = Math.min(23, this.shake + 14); this.flash = Math.max(this.flash, .42);
    } else if (event.type === 'squadron') {
      const color = event.challenge ? '#9bf6ff' : '#ffe36d';
      this.rings.push({ x, y, age: 0, life: .6, radius: 110, color });
    } else if (event.type === 'captured' || event.type === 'rescue') {
      const rescue = event.type === 'rescue', color = rescue ? '#8affd7' : '#ff7a8a';
      const toX = event.toX ?? x, toY = event.toY ?? y, steps = 14;
      this.reserveParticles(steps);
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        this.particle(x + (toX - x) * t, y + (toY - y) * t, random(-20, 20), random(-20, 20), .25 + t * .35, random(2, 3.4), color);
      }
      this.rings.push({ x: rescue ? x : toX, y: rescue ? y : toY, age: 0, life: .5, radius: 70, color });
    } else if (event.type === 'respawn') {
      this.rings.push({ x, y, age: 0, life: .6, radius: 180, color: '#a4ffee' }, { x, y, age: 0, life: .9, radius: 320, color: '#e7fff8' });
    } else if (event.type === 'power-lost') {
      this.rings.push({ x, y, age: 0, life: .35, radius: 60, color: '#ffb36b' });
    } else if (event.type === 'beam') {
      this.lights.push({ x, y, age: 0, life: .35, radius: 120, color: '#ff9ab8', fire: false });
      this.shake = Math.min(18, this.shake + 3);
    }
    for (const key of CAPPED_STATES) keepNewest(this[key], EFFECT_LIMITS[key]);
  }
  update(dt) {
    let length = 0;
    for (const charge of this.delayed) { charge.delay -= dt; if (charge.delay <= 0) this.emit(charge.event, charge.scroll, charge.groundOffset); else this.delayed[length++] = charge; }
    this.delayed.length = length;
    this.shake *= Math.exp(-dt * 8); this.flash *= Math.exp(-dt * 7); this.damagePulse *= Math.exp(-dt * 12);
    this.glitch = Math.max(0, this.glitch - dt);
    if (this.impactAge < this.impactDuration) {
      this.impactAge = Math.min(this.impactDuration, this.impactAge + dt);
      const rise = Math.min(1, this.impactAge / .035), remaining = 1 - this.impactAge / this.impactDuration;
      this.impact = (this.impactStart + (this.impactPeak - this.impactStart) * rise) * remaining * remaining;
    } else this.impact = 0;
    const drag = Math.exp(-dt * 2.5);
    length = 0;
    for (const p of this.particles) { p.age += dt; if (p.age >= p.life) { this.particlePool.push(p); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= drag; p.vy *= drag; this.particles[length++] = p; }
    this.particles.length = length;
    ageAndCompact(this.rings, dt); ageAndCompact(this.lights, dt); ageAndCompact(this.flares, dt);
  }
  drawGround(ctx, scroll, H, offset = 0) {
    if (!this.wrecks.length) return;
    const { a, b, c, d, e, f } = ctx.getTransform();
    ctx.save();
    let length = 0;
    for (const w of this.wrecks) {
      const y = w.y + scroll;
      if (y > H + w.size * 3) continue;
      this.wrecks[length++] = w;
      if (y < -w.size * 2) continue;
      const x = w.x + offset, cos = Math.cos(w.angle), sin = Math.sin(w.angle);
      ctx.setTransform(a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin,
        a * x + c * y + e, b * x + d * y + f);
      ctx.drawImage(wreckTexture(w.size < 38), -w.size * 1.8, -w.size * 1.8, w.size * 3.6, w.size * 3.6);
    }
    ctx.restore();
    this.wrecks.length = length;
  }
  shouldUseSoftLights(W, H) {
    // At half resolution, the light quads cost roughly one quarter as many
    // fragments, but clearing/compositing the layer adds a full-surface cost.
    // Require two visible screens of additive image coverage before paying it.
    // Gameplay caps this scan at 48 lights; crowded bursts exit early.
    if (!(W > 0 && H > 0)) return false;
    const threshold = 2 * W * H;
    let area = 0;
    for (const l of this.lights) {
      const a = 1 - l.age / l.life, r = l.radius * (.5 + l.age / l.life);
      if (a <= 0 || !intersectsView(l.x, l.y, r, r, W, H)) continue;
      const width = Math.max(0, Math.min(W, l.x + r) - Math.max(0, l.x - r));
      const height = Math.max(0, Math.min(H, l.y + r) - Math.max(0, l.y - r));
      area += width * height;
      if (area >= threshold) return true;
      if (l.fire) {
        const core = r * .62;
        const coreWidth = Math.max(0, Math.min(W, l.x + core) - Math.max(0, l.x - core));
        const coreHeight = Math.max(0, Math.min(H, l.y + core) - Math.max(0, l.y - core));
        area += coreWidth * coreHeight;
        if (area >= threshold) return true;
      }
    }
    return false;
  }
  drawLights(ctx, W, H) {
    for (const l of this.lights) {
      const a = 1 - l.age / l.life, r = l.radius * (.5 + l.age / l.life);
      if (a <= 0 || !intersectsView(l.x, l.y, r, r, W, H)) continue;
      ctx.globalAlpha = a; ctx.drawImage(lightTexture(l.color), l.x - r, l.y - r, r * 2, r * 2);
      if (l.fire) {
        const core = r * .62;
        ctx.globalAlpha = a * a * (this.reduced ? .28 : this.quality === 'high' ? .6 : .38);
        ctx.drawImage(fireBloomTexture(), l.x - core, l.y - core, core * 2, core * 2);
      }
    }
  }
  draw(ctx, W, H) {
    let airSmoke, groundSmoke, airFragment, groundFragment;
    ctx.save();
    for (const p of this.particles) if (p.smoke) {
      const a = 1 - p.age / p.life, diameter = p.radius * 3.5 * (1 + p.age * 3);
      if (a <= 0 || !intersectsView(p.x, p.y, diameter / 2, diameter / 2, W, H)) continue;
      const sprite = p.ground ? groundSmoke ||= smokeTexture(true) : airSmoke ||= smokeTexture();
      ctx.globalAlpha = a * (p.ground ? .6 : .48);
      fitSprite(ctx, sprite, p.x, p.y, diameter);
    }
    const { a: ca, b: cb, c: cc, d: cd, e: ce, f: cf } = ctx.getTransform();
    let transformed = false;
    for (const p of this.particles) if (p.debris && !p.smoke) {
      if (p.age >= p.life || !intersectsView(p.x, p.y, p.radius * 3, p.radius * 3, W, H)) continue;
      ctx.globalAlpha = 1 - p.age / p.life;
      const angle = p.angle + p.age * 8, cos = Math.cos(angle), sin = Math.sin(angle);
      ctx.setTransform(ca * cos + cc * sin, cb * cos + cd * sin, cc * cos - ca * sin, cd * cos - cb * sin,
        ca * p.x + cc * p.y + ce, cb * p.x + cd * p.y + cf);
      transformed = true;
      const fragment = p.ground ? groundFragment ||= spriteCell('effects', 11) : airFragment ||= spriteCell('effects', 10);
      if (fragment) fitSprite(ctx, fragment, 0, 0, p.radius * 4.2);
      else { ctx.fillStyle = '#75695c'; ctx.fillRect(-p.radius, -p.radius / 3, p.radius * 2, p.radius * .7); }
    }
    if (transformed) ctx.setTransform(ca, cb, cc, cd, ce, cf);
    for (const burst of this.rings) if (burst.explosion) {
      const t = burst.age / burst.life, diameter = burst.diameter * (.4 + t * .9);
      if (t >= 1 || !intersectsView(burst.x, burst.y, diameter / 2, diameter / 2, W, H)) continue;
      const sprite = spriteCell('effects', Math.min(7, Math.floor(t * 8)));
      if (!sprite) continue;
      ctx.globalAlpha = Math.min(1, (1 - t) * 3);
      fitSprite(ctx, sprite, burst.x, burst.y, diameter);
    }
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (this.lights.length && typeof ctx.drawSoftLayer === 'function' && this.shouldUseSoftLights(W, H)) {
      // Only the broad, preblurred light/bloom sprites use the prepared soft
      // surface. The callback and parameter record are reused across frames.
      const pass = this.softLightPass; pass.width = W; pass.height = H;
      ctx.drawSoftLayer(this.softLightDraw);
    } else this.drawLights(ctx, W, H);
    const sparkScale = Math.max(Math.hypot(ca, cb), Math.hypot(cc, cd));
    for (const p of this.particles) if (!p.smoke && !p.debris) {
      const radius = Math.max(.3, p.radius * (1 - p.age / p.life));
      if (p.age >= p.life || !intersectsView(p.x, p.y, radius, radius, W, H)) continue;
      ctx.globalAlpha = 1 - p.age / p.life;
      const color = p.age < .08 ? '#fffbea' : p.color, levels = sparkTextures.get(color), pixels = radius * sparkScale;
      if (levels && pixels >= 2) {
        // Nearest prefiltered scale keeps circle edges crisp as they shrink.
        // Subpixel sparks retain exact vector coverage rather than aliasing.
        const sprite = levels[pixels < 5 ? 0 : pixels < 10 ? 1 : pixels < 22 ? 2 : pixels < 45 ? 3 : 4];
        const extent = radius * sprite.width / (sprite.width - 2);
        ctx.drawImage(sprite, p.x - extent, p.y - extent, extent * 2, extent * 2);
      } else {
        // A saved or future palette remains accurate without an unbounded
        // runtime cache. Every color emitted by current gameplay is prewarmed.
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU); ctx.fill();
      }
    }
    for (const ring of this.rings) {
      const t = ring.age / ring.life;
      if (t >= 1 || !intersectsView(ring.x, ring.y, ring.radius * t + 8, ring.radius * t * .77 + 8, W, H)) continue;
      ctx.globalAlpha = (1 - t) ** 2; ctx.strokeStyle = ring.color; ctx.lineWidth = (1 - t) * 5 + 1;
      ctx.beginPath(); ctx.ellipse(ring.x, ring.y, Math.max(1, ring.radius * t), Math.max(1, ring.radius * t * .77), 0, 0, TAU); ctx.stroke();
      if (this.quality === 'high' && !this.reduced) { ctx.lineWidth = 16 * (1 - t); ctx.globalAlpha *= .14; ctx.stroke(); }
    }
    if (!this.reduced) for (const flare of this.flares) {
      const t = flare.age / flare.life, intensity = (1 - t) ** 2 * flare.strength;
      if (t >= 1 || intensity <= 0) continue;
      const r = Math.min(W * .45, flare.radius * (1 - t * .25));
      if (intersectsView(flare.x, flare.y, r, r / 16, W, H)) {
        ctx.globalAlpha = intensity * (this.quality === 'high' ? .7 : .4);
        // The streak occupies ten source rows. Keep three transparent rows on
        // either side for filtering, without blending an almost-empty square.
        ctx.drawImage(lensStreakTexture(), 0, 120, 256, 16, flare.x - r, flare.y - r / 16, r * 2, r / 8);
      }
      if (this.quality !== 'high') continue;
      const dx = W * .5 - flare.x, dy = H * .5 - flare.y;
      if (dx * dx + dy * dy < 1600) continue;
      for (let i = 0; i < 2; i++) {
        const distance = 1.25 + i * .48, radius = Math.min(30, flare.radius * (i ? .035 : .065));
        const x = flare.x + dx * distance, y = flare.y + dy * distance;
        if (!intersectsView(x, y, radius, radius, W, H)) continue;
        ctx.globalAlpha = intensity * (i ? .2 : .34);
        ctx.drawImage(lensGhostTexture(), x - radius, y - radius, radius * 2, radius * 2);
      }
    }
    ctx.restore();
    if (this.flash > .01 && !this.reduced) { ctx.fillStyle = `rgba(255,236,210,${this.flash * .5})`; ctx.fillRect(0, 0, W, H); }
  }
}

export function warmGpuEffectTextures(gpu) {
  gpu.prewarm([...textures.values()]);
  for (const levels of sparkTextures.values()) gpu.prewarm(levels);
  for (let i = 0; i < 16; i++) { const sprite = spriteCell('effects', i); if (sprite) gpu.prewarm(sprite); }
}
