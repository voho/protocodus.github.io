import { spriteCell, spriteRevision, spritesReady } from './sprite-assets.js';

const random = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const textures = new Map();
let textureRevision = -1;
function texture(key, paint, size = 128) {
  if (textureRevision !== spriteRevision) { textures.clear(); textureRevision = spriteRevision; }
  if (textures.has(key)) return textures.get(key);
  const c = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, size);
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
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
function fitSprite(ctx, sprite, x, y, diameter) {
  const scale = diameter / Math.max(sprite.width, sprite.height), width = sprite.width * scale, height = sprite.height * scale;
  ctx.drawImage(sprite, x - width / 2, y - height / 2, width, height);
}
function warmEffectsTextures() {
  for (let i = 0; i < 14; i++) spriteCell('effects', i);
  wreckTexture(); wreckTexture(true); smokeTexture(); smokeTexture(true);
  for (const color of ['#ffbb6b', '#ffc985', '#ff9e7d', '#ffe36d']) lightTexture(color);
}
spritesReady.then(warmEffectsTextures);
function ageAndCompact(list, dt) {
  let length = 0;
  for (const p of list) { p.age += dt; if (p.age < p.life) list[length++] = p; }
  list.length = length;
}
export class Effects {
  constructor() { this.particles = []; this.rings = []; this.lights = []; this.texts = []; this.wrecks = []; this.delayed = []; this.shake = 0; this.flash = 0; this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; this.quality = 'high'; }
  reset() { this.particles = []; this.rings = []; this.lights = []; this.texts = []; this.wrecks = []; this.delayed = []; this.shake = 0; this.flash = 0; }
  emit(event, scroll = 0, groundOffset = 0) {
    const { x = 0, y = 0, size = 20 } = event;
    if (event.type === 'explosion' || event.type === 'phase') {
      const boss = event.boss, count = Math.min(boss ? 130 : 55, Math.round(size * 1.1)) * (this.quality === 'high' ? 1 : .55);
      if (boss) for (let i = 0; i < 18; i++) this.delayed.push({ delay: .1 + i * .085, scroll, groundOffset, event: { type: 'explosion', x: x + random(-size, size), y: y + random(-size * .7, size * .7), size: random(19, 48), secondary: true } });
      const color = event.ground ? (event.color || '#ffc985') : '#ffbb6b';
      for (let i = 0; i < count; i++) {
        const angle = random(0, TAU), speed = random(25, boss ? 420 : size * 5 + 50);
        this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: random(.3, boss ? 2.3 : 1.2), radius: random(1.2, size * .12 + 2), color, smoke: i % 4 === 0, debris: i % 5 === 0, ground: !!event.ground, angle });
      }
      this.rings.push({ x, y, age: 0, life: boss ? 1.2 : .5, radius: size * (boss ? 6 : 3), color, explosion: true, diameter: size * 4 });
      this.lights.push({ x, y, age: 0, life: boss ? .9 : .3, radius: size * 5, color });
      if (event.type !== 'phase' && !event.ground && !event.secondary) this.wrecks.push({ x: x - groundOffset, y: y - scroll, size, angle: random(0, TAU), age: 0 });
      this.shake = Math.min(23, this.shake + size * (event.ground ? .028 : .09));
      this.flash = Math.max(this.flash, boss ? .5 : event.player ? .24 : .03);
      if (event.value) this.texts.push({ x, y, text: `+${event.value}`, life: 1.15, age: 0, color: '#f3debe' });
    } else if (event.type === 'spark') {
      for (let i = 0; i < 4; i++) this.particles.push({ x, y, vx: random(-100, 100), vy: random(10, 150), age: 0, life: random(.1, .22), radius: random(1, 3), color: '#ddffed' });
    } else if (event.type === 'hit') {
      this.shake = Math.max(this.shake, 5);
      this.rings.push({ x, y, age: 0, life: .27, radius: 52, color: event.shield ? '#91ffee' : '#ff6c5e' });
    } else if (event.type === 'pickup') {
      this.texts.push({ x, y, text: `${event.value}`, life: 1.3, age: 0, color: '#8affd7' });
    } else if (event.type === 'combo') {
      const color = event.combo >= 5 ? '#ffe36d' : '#b8ffe2';
      this.texts.push({ x, y: y - 16, text: `${event.combo}  ${event.label}`, life: 1.65, age: 0, color, size: event.combo >= 5 ? 18 : 15 });
      this.rings.push({ x, y, age: 0, life: .55, radius: 42 + event.combo * 5, color });
      this.shake = Math.min(18, this.shake + 2 + event.combo * .35);
    } else if (event.type === 'blast') {
      this.rings.push({ x, y, age: 0, life: .45, radius: size * 1.9, color: event.color || '#ff9e7d', explosion: true, diameter: size * 2.3 });
      this.lights.push({ x, y, age: 0, life: .24, radius: size * 2.8, color: event.color || '#ff9e7d' });
      this.shake = Math.min(18, this.shake + size * .035);
    } else if (event.type === 'arc') {
      const segments = 5;
      for (let i = 0; i < segments; i++) {
        const t = (i + .5) / segments;
        this.particles.push({ x: x + (event.toX - x) * t, y: y + (event.toY - y) * t, vx: random(-32, 32), vy: random(-32, 32), age: 0, life: .16, radius: random(1.5, 3.5), color: event.color || '#ffe88d' });
      }
    } else if (event.type === 'weak-hit' || event.type === 'blocked') {
      this.rings.push({ x, y, age: 0, life: .2, radius: event.type === 'blocked' ? 15 : 25, color: event.type === 'blocked' ? '#ff8b78' : '#fff1a6' });
    } else if (event.type === 'weak-break') {
      this.emit({ type: 'explosion', x, y, size: size * 1.35, color: '#ffe36d' }, scroll, groundOffset);
    }
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
    if (this.wrecks.length > 60) this.wrecks.shift();
  }
  update(dt) {
    let length = 0;
    for (const charge of this.delayed) { charge.delay -= dt; if (charge.delay <= 0) this.emit(charge.event, charge.scroll, charge.groundOffset); else this.delayed[length++] = charge; }
    this.delayed.length = length;
    this.shake *= Math.exp(-dt * 8); this.flash *= Math.exp(-dt * 7);
    const drag = Math.exp(-dt * 2.5);
    length = 0;
    for (const p of this.particles) { p.age += dt; if (p.age >= p.life) continue; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= drag; p.vy *= drag; this.particles[length++] = p; }
    this.particles.length = length;
    ageAndCompact(this.rings, dt); ageAndCompact(this.lights, dt); ageAndCompact(this.texts, dt);
  }
  drawGround(ctx, scroll, H, offset = 0) {
    let length = 0;
    for (const w of this.wrecks) {
      const y = w.y + scroll;
      if (y > H + w.size * 3) continue;
      this.wrecks[length++] = w;
      if (y < -w.size * 2) continue;
      ctx.save(); ctx.translate(w.x + offset, y); ctx.rotate(w.angle);
      ctx.drawImage(wreckTexture(w.size < 38), -w.size * 1.8, -w.size * 1.8, w.size * 3.6, w.size * 3.6);
      ctx.restore();
    }
    this.wrecks.length = length;
  }
  draw(ctx, W, H) {
    ctx.save();
    for (const p of this.particles) if (p.smoke) {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a * (p.ground ? .6 : .48);
      fitSprite(ctx, smokeTexture(p.ground), p.x, p.y, p.radius * 3.5 * (1 + p.age * 3));
    }
    for (const p of this.particles) if (p.debris && !p.smoke) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle + p.age * 8);
      const fragment = spriteCell('effects', p.ground ? 11 : 10);
      if (fragment) fitSprite(ctx, fragment, 0, 0, p.radius * 4.2);
      else { ctx.fillStyle = '#75695c'; ctx.fillRect(-p.radius, -p.radius / 3, p.radius * 2, p.radius * .7); }
      ctx.restore();
    }
    for (const burst of this.rings) if (burst.explosion) {
      const t = burst.age / burst.life, stage = Math.min(7, Math.floor(t * 8)), sprite = spriteCell('effects', stage);
      if (!sprite) continue;
      ctx.globalAlpha = Math.min(1, (1 - t) * 3);
      fitSprite(ctx, sprite, burst.x, burst.y, burst.diameter * (.4 + t * .9));
    }
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const a = 1 - l.age / l.life, r = l.radius * (.5 + l.age / l.life);
      ctx.globalAlpha = a; ctx.drawImage(lightTexture(l.color), l.x - r, l.y - r, r * 2, r * 2);
    }
    for (const p of this.particles) if (!p.smoke && !p.debris) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.age < .08 ? '#fffbea' : p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.3, p.radius * (1 - p.age / p.life)), 0, TAU); ctx.fill();
    }
    for (const ring of this.rings) {
      const t = ring.age / ring.life;
      ctx.globalAlpha = (1 - t) ** 2; ctx.strokeStyle = ring.color; ctx.lineWidth = (1 - t) * 5 + 1;
      ctx.beginPath(); ctx.ellipse(ring.x, ring.y, Math.max(1, ring.radius * t), Math.max(1, ring.radius * t * .77), 0, 0, TAU); ctx.stroke();
      if (this.quality === 'high' && !this.reduced) { ctx.lineWidth = 16 * (1 - t); ctx.globalAlpha *= .14; ctx.stroke(); }
    }
    ctx.restore();
    ctx.save(); ctx.textAlign = 'center';
    for (const t of this.texts) { ctx.globalAlpha = Math.min(1, (t.life - t.age) * 3); ctx.fillStyle = t.color; ctx.font = `bold ${t.size || 13}px "Space Grotesk", sans-serif`; ctx.fillText(t.text, t.x, t.y - t.age * 38); }
    ctx.restore();
    if (this.flash > .01 && !this.reduced) { ctx.fillStyle = `rgba(255,236,210,${this.flash * .5})`; ctx.fillRect(0, 0, W, H); }
  }
}
