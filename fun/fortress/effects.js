// Effects run in world coordinates. They consume physics events without changing trajectories or collisions.
const TAU = Math.PI * 2;
const MAX_PARTICLES = 300;
const FLAME_STEPS = 51;
const FLAME_COLUMNS = 17;
const FLAME_SWAY = 0.56;
const FLAME_W = 180;
const FLAME_H = 144;
const FLAME_HEIGHT = 128;
const clamp = (n, a, b) => Math.max(a, Math.min(n, b));
function fade(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}
const phases = { day: 0.23, dawn: 0.58, dusk: 0.74, night: 1 };
const fragmentColors = {
  stone: ['#a99c80', '#807967', '#d6c9ac'],
  glass: ['#e0fff3', '#7fdcd7', '#b8f8fe'],
  wood: ['#ddac66', '#945c32', '#f8dca6'],
  steel: ['#fff2b4', '#ffc75f', '#ec7d41'],
};

// Momentum along the wave and the width of its spray vary with what broke.
const blastDebris = {
  stone: { kind: 'stone', speed: 77, spread: 0.56, size: 1.8, life: 0.7 },
  wood: { kind: 'wood', speed: 100, spread: 0.36, size: 1.5, life: 0.64 },
  glass: { kind: 'glass', speed: 129, spread: 0.76, size: 1.15, life: 0.53 },
  steel: { kind: 'spark', speed: 119, spread: 0.43, size: 1.38, life: 0.25 },
};

function lightSprite(colors, smoke = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const blobs = smoke ? 7 : 1;
  for (let i = 0; i < blobs; i++) {
    const angle = i * 2.4;
    const offset = smoke ? Math.sqrt(i) * 8 : 0;
    const x = 64 + Math.cos(angle) * offset,
      y = 64 + Math.sin(angle) * offset;
    const radius = smoke ? 35 + 5 * Math.sin(i * 3.5) : 64;
    const ramp = ctx.createRadialGradient(x, y, 0, x, y, radius);
    colors.forEach(([stop, color]) => ramp.addColorStop(stop, color));
    ctx.fillStyle = ramp;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return canvas;
}

function glow(ctx, sprite, x, y, radius, height = radius) {
  ctx.drawImage(sprite, x - radius, y - height, radius * 2, height * 2);
}

function paintFlame(ctx, x, y, height, sway) {
  const width = height * 0.3;
  ctx.save();
  ctx.translate(x, y);
  const gradient = ctx.createLinearGradient(0, -height, 0, 1);
  gradient.addColorStop(0, '#ed6c31');
  gradient.addColorStop(0.48, '#f58228');
  gradient.addColorStop(1, '#ffd56f');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(-width * 0.77, 0);
  ctx.bezierCurveTo(-width * 1.25, -height * 0.35, sway - width * 0.1, -height * 0.61, sway, -height);
  ctx.bezierCurveTo(
    sway + width * 0.95,
    -height * 0.77,
    width * 0.24,
    -height * 0.44,
    width * 0.85,
    -height * 0.28,
  );
  ctx.quadraticCurveTo(width * 1.1, height * 0.06, 0, 1);
  ctx.fill();
  ctx.fillStyle = '#ffed9c';
  ctx.beginPath();
  ctx.moveTo(-width * 0.4, -0.5);
  ctx.quadraticCurveTo(-width * 0.4, -height * 0.29, sway * 0.38 + width * 0.12, -height * 0.59);
  ctx.quadraticCurveTo(width * 0.2, -height * 0.35, width * 0.47, -height * 0.17);
  ctx.quadraticCurveTo(width * 0.65, 0.5, -width * 0.4, -0.5);
  ctx.fill();
  ctx.restore();
}

// All flame silhouettes share the same height-normalized path. Bake its sway
// range before play, so a burning room needs no live gradients or path fills.
function flameAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = FLAME_W * FLAME_COLUMNS;
  canvas.height = FLAME_H * Math.ceil(FLAME_STEPS / FLAME_COLUMNS);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < FLAME_STEPS; i++) {
    const sway = ((2 * i) / (FLAME_STEPS - 1) - 1) * FLAME_HEIGHT * FLAME_SWAY;
    const col = i % FLAME_COLUMNS,
      row = Math.floor(i / FLAME_COLUMNS);
    paintFlame(ctx, (col + 0.5) * FLAME_W, row * FLAME_H + FLAME_HEIGHT + 4, FLAME_HEIGHT, sway);
  }
  return canvas;
}

// Domain-warped noise folds the bright flame front back through the cooler gas.
// Baking a handful of independent plumes keeps these curls stable as the camera zooms.
function plumeAtlas() {
  const w = 112,
    h = 144,
    variants = 6;
  const canvas = document.createElement('canvas');
  canvas.width = w * variants;
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d');
  const raster = ctx.createImageData(canvas.width, canvas.height);
  const values = new Float32Array(64 * 64);
  let seed = 964701;
  for (let i = 0; i < values.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    values[i] = seed / 4294967296;
  }
  function noise(x, y) {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    let sx = x - ix,
      sy = y - iy;
    sx *= sx * (3 - 2 * sx);
    sy *= sy * (3 - 2 * sy);
    const l = ix & 63,
      r = (ix + 1) & 63,
      t = (iy & 63) * 64,
      b = ((iy + 1) & 63) * 64;
    const top = values[t + l] + sx * (values[t + r] - values[t + l]);
    const bottom = values[b + l] + sx * (values[b + r] - values[b + l]);
    return top + (bottom - top) * sy;
  }
  for (let k = 0; k < variants; k++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const rise = 1 - y / (h - 1),
          side = (2 * x) / (w - 1) - 1;
        const bend = (noise(rise * 2.9 + k * 4.1, k + 1) - 0.5) * (0.19 + 0.66 * rise);
        const nx = side * 3.1 + k * 9.3,
          ny = rise * 3.9 + k * 7.1;
        const wx = nx + (noise(nx + 13, ny + 7) - 0.5) * 2.35;
        const wy = ny + (noise(nx - 4, ny + 18) - 0.5) * 2.4;
        const fold =
          0.68 * noise(wx, wy) + 0.24 * noise(wx * 2.4, wy * 2.4) + 0.08 * noise(wx * 5.5, wy * 5.5);
        const width = 0.53 + 0.16 * Math.sin(rise * Math.PI);
        const shape = 1 - Math.hypot((side - bend) / width, (rise - 0.39) / 0.59);
        const edge = shape + (fold - 0.5) * 1.05;
        const alpha = clamp(edge * 4, 0, 1) * clamp(rise * 13, 0, 1) * clamp((1 - rise) * 12, 0, 1);
        if (alpha <= 0) continue;
        const ridge = 1 - Math.abs(fold - 0.52) * 4.8;
        const heat = clamp(shape * 0.55 + (fold - 0.33) * 1.7 + ridge ** 3 * 0.23 - rise * 0.18, 0, 1);
        const index = 4 * (y * canvas.width + k * w + x);
        raster.data[index] = 243 + heat * 12;
        raster.data[index + 1] = 79 + heat * 173;
        raster.data[index + 2] = 20 + heat * heat * 169;
        raster.data[index + 3] = 240 * alpha;
        const powder = index + h * canvas.width * 4;
        raster.data[powder] = 152 + Math.min(103, heat * 169);
        raster.data[powder + 1] = 70 + heat * 184;
        raster.data[powder + 2] = 41 + heat * heat * 192;
        raster.data[powder + 3] = 240 * alpha;
      }
  ctx.putImageData(raster, 0, 0);
  return { canvas, w, h, variants };
}

export function createEffects() {
  const flames = flameAtlas();
  const plumes = plumeAtlas();
  function flame(ctx, x, y, height, clock, seed) {
    const sway = windLean + Math.sin(clock * 7.6 + seed) * 0.17;
    const frame = Math.round(((sway / FLAME_SWAY + 1) * (FLAME_STEPS - 1)) / 2);
    const col = frame % FLAME_COLUMNS,
      row = Math.floor(frame / FLAME_COLUMNS);
    const scale = height / FLAME_HEIGHT;
    ctx.drawImage(
      flames,
      col * FLAME_W,
      row * FLAME_H,
      FLAME_W,
      FLAME_H,
      x - (FLAME_W * scale) / 2,
      y - (FLAME_HEIGHT + 4) * scale,
      FLAME_W * scale,
      FLAME_H * scale,
    );
  }
  const firelight = lightSprite([
    [0, '#fff3adcf'],
    [0.13, '#ffce658a'],
    [0.38, '#ff98494e'],
    [1, '#fc772900'],
  ]);
  const hot = lightSprite([
    [0, '#fffad6'],
    [0.21, '#ffe87def'],
    [0.55, '#f58a3aaa'],
    [1, '#ef551b00'],
  ]);
  const dust = lightSprite(
    [
      [0, '#b8a48488'],
      [0.63, '#aa96784d'],
      [1, '#c8bc9f00'],
    ],
    true,
  );
  const smoke = lightSprite(
    [
      [0, '#58555d88'],
      [0.64, '#72737955'],
      [1, '#68696b00'],
    ],
    true,
  );
  const soot = lightSprite(
    [
      [0, '#494040a6'],
      [0.48, '#68544ea6'],
      [0.79, '#826f6166'],
      [1, '#8e796800'],
    ],
    true,
  );
  const char = lightSprite(
    [
      [0, '#261d1ada'],
      [0.6, '#49312882'],
      [1, '#513b2b00'],
    ],
    true,
  );
  const magic = lightSprite([
    [0, '#efffcddb'],
    [0.26, '#c1ecc782'],
    [0.68, '#89bfc136'],
    [1, '#9adbd000'],
  ]);
  const violet = lightSprite([[0, '#f2dcff'], [0.14, '#c897ffdf'], [0.43, '#9453dd6b'], [1, '#623eaa00']]);
  const vortices = Array.from({ length: 4 }, () => ({ end: -1 }));
  let nextVortex = 0;
  const particles = Array.from({ length: MAX_PARTICLES }, () => ({}));
  const trails = new Map(),
    torches = [],
    fires = [];
  // Keep cast light and pressure fronts visible when crumbling masonry fills the debris pool.
  const flashes = Array.from({ length: 8 }, () => ({ end: -1 }));
  const scorchMarks = Array.from({ length: 24 }, () => ({ active: false }));
  let particleStart = 0,
    particleCount = 0,
    nextFlash = 0,
    nextMark = 0;
  const shake = { x: 0, y: 0 };
  let shakePower = 0,
    shakeStart = 0,
    shakeDirection = 1,
    time = 0,
    physicsTime = 0,
    previous = null,
    reduced = false,
    phase = 'day',
    level = 0,
    wind = 0,
    windLean = 0,
    floor = [];
  let randomState = 918274;
  function random() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }
  function particle(kind, x, y, vx, vy, size, life, color) {
    const index = (particleStart + particleCount) % MAX_PARTICLES;
    if (particleCount === MAX_PARTICLES) particleStart = (particleStart + 1) % MAX_PARTICLES;
    else particleCount++;
    const p = particles[index];
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.life = life;
    p.color = color;
    p.age = 0;
    p.roll = random() * TAU;
    p.spin = (random() - 0.5) * 8;
    if (kind === 'billow') {
      p.plume = Math.floor(random() * plumes.variants);
      p.powder = false;
      p.roll = Math.atan2(vx, Math.max(13, -vy)) * 0.74 + (random() - 0.5) * 0.44;
      p.spin *= 0.18;
    }
    return p;
  }
  function puff(x, y, scale, soot = false) {
    particle(
      soot ? 'smoke' : 'dust',
      x,
      y,
      (random() - 0.5) * 21,
      -10 - random() * 21,
      scale,
      0.65 + random() * 0.75,
    );
  }

  function kick(power, x) {
    if (reduced || power < shakePower * Math.exp((shakeStart - time) * 9)) return;
    shakePower = Math.min(6.2, power);
    shakeDirection = x >= 600 ? -1 : 1;
    shakeStart = time;
  }

  function eruption(e, magical) {
    const radius = clamp(e.radius ?? 95, 38, 215);
    const flash = flashes[nextFlash];
    nextFlash = (nextFlash + 1) % flashes.length;
    flash.x = e.x;
    flash.y = e.y;
    flash.radius = radius;
    flash.magical = magical;
    flash.start = time;
    flash.end = time + (magical ? 0.68 : 0.55);
    kick(magical ? 1.6 : 2.2 + radius / 39, e.x);
    const surface = surfaceY(e.x);
    const nearGround = Math.abs(surface - e.y) < radius * 0.3;
    const lobes = reduced ? 3 : magical ? 13 : 11;
    for (let i = 0; i < lobes; i++) {
      const a = random() * TAU;
      const radial = radius * (0.05 + random() ** 1.4 * 0.43);
      const dx = Math.cos(a),
        dy = nearGround ? -Math.abs(Math.sin(a)) : Math.sin(a);
      const x = e.x + dx * radial * 0.32,
        y = e.y + dy * radial * 0.2;
      const speed = radial * (magical ? 3.2 : 2.4);
      particle(
        'soot',
        x,
        y,
        dx * speed * 0.46,
        dy * speed * 0.35 - 22,
        13 + radial * 0.4,
        0.72 + random() * 0.78,
      );
      const lobe = particle(
        'billow',
        x,
        y,
        dx * speed,
        dy * speed * 0.67 - 11,
        (10 + random() * 17 + radial * 0.08) * (magical ? 1 : 1.12),
        0.26 + random() * (magical ? 0.36 : 0.21),
      );
      lobe.powder = !magical;
    }
    const core = particle('billow', e.x, e.y + 4, wind * 0.22, -17, radius * 0.23, magical ? 0.57 : 0.37);
    core.powder = !magical;
    if (magical && Math.abs(surface - e.y) <= 32) {
      const mark = scorchMarks[nextMark];
      nextMark = (nextMark + 1) % scorchMarks.length;
      mark.active = true;
      mark.x = e.x;
      mark.y = surface;
      mark.size = radius * 0.38;
      for (let i = 0; i < (reduced ? 3 : 9); i++) {
        const x = e.x + (random() - 0.5) * radius * 0.98;
        particle('lick', x, surfaceY(x), 0, 0, 7 + random() * 12, 0.6 + random());
      }
    }
    const sparks = reduced ? 3 : magical ? 22 : 31;
    for (let i = 0; i < sparks; i++) {
      const a = random() * TAU;
      const speed = radius * (0.57 + random() * 1.2);
      const splinter = !magical && e.material === 'barrel' && i % 5 === 1;
      particle(
        splinter ? 'wood' : 'spark',
        e.x,
        e.y,
        Math.cos(a) * speed,
        Math.sin(a) * speed - 16,
        0.9 + random() * 2.2,
        0.33 + random() * 0.72,
        splinter ? fragmentColors.wood[i % 3] : fragmentColors.steel[i % 3],
      );
    }
  }

  function earthBurst(e) {
    const count = reduced ? 3 : 14;
    for (let i = 0; i < count; i++) {
      const lateral = ((i + random()) / count) * 2 - 1;
      const x = e.x + lateral * e.radius * 0.79;
      const y = Math.min(e.y + 3, surfaceY(x));
      const vx = lateral * (26 + e.depth * 1.3),
        vy = -(21 + random() * 46 + e.depth * 0.55) * (1 - Math.abs(lateral) * 0.5);
      particle(
        'stone',
        x,
        y,
        vx,
        vy,
        1.2 + random() * 2.1,
        0.68 + random() * 0.7,
        fragmentColors.stone[i % 3],
      );
      if (i % 2 === 0) particle('dust', x, y, vx, vy * 0.32, 12 + random() * 14, 0.73 + random() * 0.51);
    }
  }

  let blastChipBudget = 0;
  let blastFractureBudget = 0;
  function blastBreak(e, material, energy) {
    const fractured = e.type === 'fracture';
    const count = Math.min(fractured ? blastFractureBudget : blastChipBudget,
      reduced ? 2 : fractured ? 5 + Math.round(energy * 3) : 2);
    if (fractured) blastFractureBudget -= count;
    else blastChipBudget -= count;
    const debris = blastDebris[material], colors = fragmentColors[material];
    for (let i = 0; i < count; i++) {
      const speed = debris.speed * (0.36 + 0.64 * energy) * (0.5 + random() * 0.8);
      const fan = (random() * 2 - 1) * debris.spread;
      const vx = (e.outX - e.outY * fan) * speed;
      const vy = (e.outY + e.outX * fan) * speed;
      if (material === 'stone' && i % 3 === 0) {
        particle('dust', e.x, e.y, vx * 0.48, vy * 0.48 - 8,
          (fractured ? 7 : 3) + energy * 8 + random() * 3, 0.64 + random() * 0.43);
      } else {
        const size = debris.size * (0.65 + random() * 0.83) * (fractured ? 1 : 0.74);
        particle(debris.kind, e.x, e.y, vx, vy - 9, size, debris.life * (0.75 + random() * 0.53),
          colors[Math.floor(random() * colors.length)]);
      }
    }
  }

  function burst(e) {
    const energy = clamp(e.strength ?? 0.6, 0.1, 1);
    const material = e.material in fragmentColors ? e.material : 'stone';
    if (e.type === 'implosion') {
      const vortex = vortices[nextVortex];
      nextVortex = (nextVortex + 1) % vortices.length;
      Object.assign(vortex, { x: e.x, y: e.y, radius: e.radius, turn: random() * TAU, start: time, end: time + 0.52 });
      return;
    }
    if (e.type === 'explosion' || e.type === 'fireburst') {
      eruption(e, e.type === 'fireburst');
      return;
    }
    if (e.type === 'guard-shot') {
      const streak = particle('tracer', e.x, e.y, 0, 0, 1.1, reduced ? 0.075 : 0.12);
      streak.endX = e.endX;
      streak.endY = e.endY;
      if (!reduced) puff(e.x, e.y, 4.5, true);
      return;
    }
    if (e.blast && (e.type === 'damage' || e.type === 'fracture')) {
      blastBreak(e, material, energy);
      return;
    }
    if (e.secondary && e.material === 'stone') {
      const size = clamp(e.size * 0.55, 5, 15);
      const count = reduced ? 1 : 3;
      for (let i = 0; i < count; i++) {
        const side = i - (count - 1) / 2;
        particle('dust', e.x, e.y, side * (12 + 10 * energy), -6 - random() * 11,
          size + random() * 3, 0.68 + random() * 0.45);
      }
      return;
    }
    if (e.type === 'crater') {
      earthBurst(e);
      return;
    }
    if (e.type === 'stone-dust') {
      // The smallest chips leave a short pale wisp as the last grit disperses.
      particle('dust', e.x, e.y, wind * 0.3, -3, clamp(e.width * 0.55, 3, 8), 0.85);
      return;
    }
    if (e.type === 'burnout') {
      const c = Math.cos(e.angle), s = Math.sin(e.angle);
      const count = reduced ? 3 : clamp(Math.ceil(Math.max(e.width, e.height) / 7), 5, 16);
      for (let i = 0; i < count; i++) {
        // Release ash along the timber's last silhouette, including tilted and upright timbers.
        const along = (i + random()) / count - 0.5, across = (random() - 0.5) * 0.75;
        const dx = (e.width >= e.height ? along : across) * e.width;
        const dy = (e.height > e.width ? along : across) * e.height;
        const x = e.x + dx * c - dy * s, y = e.y + dx * s + dy * c;
        const vx = wind * 0.5 + (random() - 0.5) * 16;
        particle('ash', x, y, vx, -3 - random() * 9, 0.65 + random() * 0.9,
          0.65 + random() * 0.8, i % 3 === 0 ? '#b8b2a5' : '#565450');
        if (i % 3 === 0) particle('smoke', x, y, vx, -7, 5 + random() * 5, 0.8 + random() * 0.4);
      }
      return;
    }
    if (e.type === 'ignite') {
      particle('billow', e.x, e.y, wind * 0.35, -18, 8 + energy * 6, 0.32);
      if (!reduced) {
        puff(e.x, e.y - 4, 7, true);
        particle('ember', e.x, e.y - 3, wind * 0.62 + 7, -27, 1.5, 0.73, '#ffdca3');
      }
      return;
    }
    if (e.type === 'faint') {
      particle('poof', e.x, e.y - 4, 0, -8, 16, 0.48);
      for (let i = 0; i < (reduced ? 2 : 8); i++) {
        const a = random() * TAU;
        particle(
          'twinkle',
          e.x,
          e.y - 5,
          Math.cos(a) * 24,
          Math.sin(a) * 22 - 9,
          1.8 + random(),
          0.5 + random() * 0.4,
          '#f0ffd5',
        );
      }
      return;
    }
    if (e.type === 'extinguish') {
      particle('wick', e.x, e.y + 2, wind * 0.05, -2, 6.7, 0.32);
      for (let i = 0; i < (reduced ? 1 : 4); i++) puff(e.x + random() * 3, e.y - i, 5 + i, true);
      return;
    }
    if (e.type === 'launch') {
      if (!reduced)
        for (let i = 0; i < 5; i++) puff(e.x - 30 + random() * 40, 385 - random() * 3, 6 + random() * 6);
      return;
    }
    if (e.type !== 'fracture' && e.type !== 'impact') return;
    const weight = material === 'glass' ? 0.45 : material === 'wood' ? 0.72 : 1;
    kick(energy * weight * (e.type === 'impact' ? 2.05 : 1.25), e.x);
    const count = reduced ? 2 : e.type === 'fracture' ? 11 : 6;
    for (let i = 0; i < count; i++) {
      const a = random() * TAU,
        speed = (18 + random() * 56) * (0.4 + energy * 0.6);
      const kind = material === 'steel' ? 'spark' : material;
      const colors = fragmentColors[material];
      particle(
        kind,
        e.x + (random() - 0.5) * 4,
        e.y + (random() - 0.5) * 4,
        Math.cos(a) * speed,
        Math.sin(a) * speed - 19,
        0.9 + random() * 2.1,
        0.35 + random() * 0.62,
        colors[i % colors.length],
      );
      if ((material === 'stone' || material === 'wood') && i % 4 === 0) puff(e.x, e.y, 6 + energy * 9);
    }
  }

  function surfaceY(x) {
    if (!floor.length) return 389;
    let l = 0,
      r = floor.length - 1;
    while (r - l > 1) {
      const m = (l + r) >> 1;
      if (floor[m].x < x) l = m;
      else r = m;
    }
    const a = floor[l],
      b = floor[r];
    return a.y + (b.y - a.y) * clamp((x - a.x) / (b.x - a.x || 1), 0, 1);
  }
  function update(
    events,
    bodies,
    dt,
    now,
    reducedMotion,
    levelIndex,
    missionPhase = 'day',
    terrain = [],
    windForce = 0,
    simulationTime = now,
  ) {
    const newFrame = previous !== now;
    previous = now;
    time = now;
    physicsTime = simulationTime;
    reduced = reducedMotion;
    phase = missionPhase;
    level = levelIndex;
    floor = terrain;
    wind = windForce;
    windLean = clamp(wind / 24, -1, 1) * 0.39;
    torches.length = 0;
    fires.length = 0;
    for (const body of bodies) {
      if (body.kind === 'torch' && body.lit) torches.push(body);
      if (body.burning) fires.push(body);
      if (newFrame && !reduced && body.dustProgress > 0 && random() < dt * 3) {
        particle('dust', body.x, body.y, wind * 0.32, -4, 2.6, 0.7);
      }
      if (body.kind !== 'projectile' || reduced) continue;
      const trail = trails.get(body.id) || {
        points: [],
        bomb: body.material.endsWith('bomb'),
        fire: body.material === 'fireball',
        lastEmber: now,
      };
      const last = trail.points.at(-1);
      if (!last || time - last.t >= 0.015) {
        if (
          trail.fire &&
          last &&
          now - trail.lastEmber >= 0.045 &&
          Math.hypot(body.x - last.x, body.y - last.y) > 1.5
        ) {
          puff(last.x, last.y, 6 + random() * 4, true);
          particle(
            'ember',
            last.x,
            last.y,
            wind * 0.42 + (random() - 0.5) * 19,
            -11 - random() * 14,
            1.25,
            0.45 + random() * 0.25,
            '#ffc277',
          );
          trail.lastEmber = now;
        }
        const point = trail.points.length === 18 ? trail.points.shift() : {};
        point.x = body.x;
        point.y = body.y;
        point.t = time;
        if (trail.fire) {
          const dx = last ? point.x - last.x : 1,
            dy = last ? point.y - last.y : 0;
          const length = Math.hypot(dx, dy) || 1;
          point.nx = -dy / length;
          point.ny = dx / length;
        }
        trail.points.push(point);
      }
      trail.lastSeen = now;
      trails.set(body.id, trail);
    }
    for (const [id, trail] of trails) if (now - trail.lastSeen > (trail.fire ? 0.17 : 0.25)) trails.delete(id);
    collectLights();
    // Keep the explosion plume visible even when an entire wall breaks in one frame.
    blastChipBudget = reduced ? 4 : 14;
    blastFractureBudget = reduced ? 12 : 64;
    for (const event of events) burst(event);
    if (!newFrame) return;
    const airDrag = Math.exp(-dt * 1.4);
    let kept = 0;
    for (let i = 0; i < particleCount; i++) {
      const index = (particleStart + i) % MAX_PARTICLES;
      const p = particles[index];
      p.age += dt;
      if (p.age >= p.life) continue;
      const destination = (particleStart + kept++) % MAX_PARTICLES;
      particles[index] = particles[destination];
      particles[destination] = p;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.roll += p.spin * dt;
      if (p.kind === 'stone' || p.kind === 'wood' || p.kind === 'glass' || p.kind === 'spark') {
        p.vy += dt * 165;
        if (p.kind === 'spark') p.vx += wind * dt * 0.7;
        const surface = surfaceY(p.x);
        if (p.vy > 0 && p.y > surface) {
          p.y = surface;
          p.vy *= -0.24;
          p.vx *= 0.7;
        }
      }
      if (p.kind === 'dust' || p.kind === 'smoke' || p.kind === 'soot') {
        p.vx = p.vx * airDrag + wind * 1.8 * (1 - airDrag);
        p.vy -= dt * (p.kind === 'soot' ? 12 : 4);
      } else if (p.kind === 'ash') {
        p.vx = wind + (p.vx - wind) * airDrag;
        p.vy = Math.min(14, p.vy + dt * 20);
        p.y = Math.min(surfaceY(p.x), p.y);
      } else if (p.kind === 'billow' || p.kind === 'ember') {
        p.vx += wind * dt;
        if (p.kind === 'billow') {
          p.vx *= airDrag;
          p.vy = p.vy * airDrag - dt * 20;
        }
      }
    }
    particleCount = kept;
    if (!reduced)
      for (const body of fires) {
        if (random() < dt * 6)
          puff(body.x + (random() - 0.5) * Math.min(body.width, 30), body.y - 5, 5 + random() * 6, true);
        if (wind && random() < dt * 0.72) {
          particle(
            'ember',
            body.x,
            body.y - 5,
            wind * 0.53,
            -16 - random() * 12,
            1.1,
            0.7 + random() * 0.45,
            '#ffbf76',
          );
        }
      }
  }

  // The soft halo and hot flame center use the same screen blend. Bake
  // them together once per exposure so each light needs one draw per layer.
  const groundLights = {};
  for (const [phaseName, exposure] of Object.entries(phases)) {
    groundLights[phaseName] = [false, true].map((isTorch) => {
      const radius = (isTorch ? 36 : 43) * (0.48 + exposure * 0.6);
      const image = document.createElement('canvas');
      image.width = image.height = 128;
      const c = image.getContext('2d');
      c.globalCompositeOperation = 'screen';
      c.globalAlpha = 0.48 + 0.45 * exposure;
      glow(c, firelight, 64, 64, 64);
      c.globalAlpha = 0.35 + exposure * 0.35;
      glow(c, hot, 64, 64, (64 * (isTorch ? 6 : 9)) / radius);
      return image;
    });
  }
  const lightPoints = [];
  let lightCount = 0;
  let visibleLeft = -Infinity,
    visibleRight = Infinity,
    visibleTop = -Infinity,
    visibleBottom = Infinity;
  function visible(x, y, margin) {
    return (
      x >= visibleLeft - margin &&
      x <= visibleRight + margin &&
      y >= visibleTop - margin &&
      y <= visibleBottom + margin
    );
  }

  function fireIntensity(body) {
    const lit = body.ignitedAt === undefined ? 1 : fade((physicsTime - body.ignitedAt) / 0.46);
    return body.kind === 'barrel' ? lit : lit * fade((1 - body.burn) / 0.34);
  }
  function collectLights() {
    lightCount = 0;
    const exposure = phases[phase] ?? phases.day;
    const images = groundLights[phase] || groundLights.day;
    for (let i = 0; i < torches.length + fires.length; i++) {
      const isTorch = i < torches.length;
      const body = isTorch ? torches[i] : fires[i - torches.length];
      const x = isTorch ? body.flameX : body.x;
      const y = isTorch ? body.flameY - 2 : body.y - 4;
      if (!Number.isFinite(x + y)) continue;
      const flicker = reduced
        ? 1
        : 1 + Math.sin(time * 6 + body.id * 0.72) * 0.05 + Math.cos(time * 11 + body.id) * 0.023;
      const entry = lightPoints[lightCount] || (lightPoints[lightCount] = {});
      entry.x = x;
      entry.y = y;
      entry.radius = (isTorch ? 36 : 43) * (0.48 + exposure * 0.6) * flicker;
      entry.image = images[isTorch ? 1 : 0];
      entry.intensity = isTorch ? fade(time / 0.35) : fireIntensity(body);
      lightCount++;
    }
  }

  function lights(ctx, front) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const exposure = phases[phase] ?? phases.day;
    const intensity = front ? 0.27 * exposure : 1;
    for (let i = 0; i < lightCount; i++) {
      const entry = lightPoints[i];
      if (visible(entry.x, entry.y, entry.radius)) {
        ctx.globalAlpha = intensity * entry.intensity;
        glow(ctx, front ? firelight : entry.image, entry.x, entry.y, entry.radius);
      }
    }
    for (const light of flashes) {
      if (light.end < time || !visible(light.x, light.y, light.radius * 1.5)) continue;
      const age = (time - light.start) / (light.end - light.start);
      const flashOpacity = fade(age / 0.055) * (1 - age) ** (light.magical ? 1.5 : 2.8);
      const reach = light.radius * (0.94 + Math.sqrt(age) * 0.58);
      ctx.globalAlpha = flashOpacity * (0.48 + exposure * 0.35) * (front ? 0.77 : 1) * (reduced ? 0.44 : 1);
      glow(ctx, firelight, light.x, light.y - age * 7, reach);
      if (!front) {
        const ground = surfaceY(light.x);
        const land = clamp(1 - Math.abs(ground - light.y) / reach, 0, 1);
        if (land > 0.12) {
          ctx.globalAlpha *= land;
          glow(ctx, hot, light.x, ground + 1, reach * 0.78, reach * 0.095);
        }
      }
    }
    ctx.restore();
  }

  function drawFronts(ctx) {
    for (const light of flashes) {
      if (light.end < time || !visible(light.x, light.y, light.radius * 1.2)) continue;
      const age = (time - light.start) / (light.end - light.start);
      if (!light.magical && !reduced) {
        const r = Math.max(0.1, light.radius * (0.07 + (1 - (1 - age) ** 3) * 0.92));
        ctx.globalAlpha = (1 - age) ** 2.4 * 0.7;
        ctx.strokeStyle = '#ffedae';
        ctx.lineWidth = 0.6 + (1 - age) * 1.75;
        ctx.beginPath();
        ctx.arc(light.x, light.y, r, 0, TAU);
        ctx.stroke();
        if (age > 0.1 && age < 0.66) {
          ctx.globalAlpha *= 0.44;
          ctx.lineWidth *= 0.64;
          ctx.beginPath();
          ctx.arc(light.x, light.y, r * 0.84, 3.4, 5.96);
          ctx.stroke();
        }
      }
      if (age < 0.4) {
        ctx.globalAlpha = fade(age / 0.05) * (1 - age / 0.4) * (reduced ? 0.38 : 0.92);
        glow(ctx, hot, light.x, light.y, light.radius * (light.magical ? 0.31 : 0.38));
      }
    }
  }

  function ribbon(ctx, points, duration, width, color) {
    let first = points.length - 1;
    while (first > 0 && points[first - 1].t > time - duration) first--;
    if (first === points.length - 1) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = first; i < points.length; i++) {
      const p = points[i];
      const size = i === first ? 0 : width * Math.max(0, 1 - (time - p.t) / duration);
      if (i === first) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x + p.nx * size, p.y + p.ny * size);
    }
    for (let i = points.length - 1; i > first; i--) {
      const p = points[i];
      const size = width * Math.max(0, 1 - (time - p.t) / duration);
      ctx.lineTo(p.x - p.nx * size, p.y - p.ny * size);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawBehind(ctx) {
    const t = ctx.getTransform();
    visibleLeft = -t.e / t.a;
    visibleRight = (ctx.canvas.width - t.e) / t.a;
    visibleTop = -t.f / t.d;
    visibleBottom = (ctx.canvas.height - t.f) / t.d;
    ctx.save();
    // A following blast takes away the scorched surface along with its soil.
    for (const mark of scorchMarks) {
      if (!mark.active || !visible(mark.x, mark.y, mark.size)) continue;
      if (Math.abs(surfaceY(mark.x) - mark.y) > 4) {
        mark.active = false;
        continue;
      }
      ctx.globalAlpha = 0.86;
      for (let i = -2; i <= 2; i++) {
        const x = mark.x + i * mark.size * 0.32;
        glow(
          ctx,
          char,
          x,
          surfaceY(x) + 1.2,
          mark.size * (0.69 - Math.abs(i) * 0.14),
          4 - Math.abs(i) * 0.56,
        );
      }
    }
    ctx.restore();
    lights(ctx, false);
    ctx.save();
    // Spindrift over the snowy pass, embers in the volcanic basin, and evening fireflies.
    if (!reduced && (level === 2 || level === 3 || phase === 'night' || phase === 'dusk')) {
      const airborne = level === 3 || level === 2;
      const n = level === 3 ? 34 : 18;
      const drift = wind && airborne ? wind * (level === 3 ? 0.62 : 0.92) : level === 3 ? 11 : 2.7;
      for (let i = 0; i < n; i++) {
        const x = (((i * 199.3 + time * drift) % 1190) + 1190) % 1190;
        const y =
          level === 3
            ? 38 + ((i * 67 + time * (11 + (i % 4))) % 304)
            : level === 2
              ? 355 - ((i * 33 + time * 9) % 183)
              : 321 + 25 * Math.sin(time * 0.35 + i * 3.3);
        ctx.fillStyle = level === 3 ? '#eff9ff' : level === 2 ? '#f7aa60' : '#dfeea0';
        ctx.globalAlpha = (0.14 + 0.32 * (0.5 + 0.5 * Math.sin(time * 1.1 + i))) * (airborne ? 1 : 0.9);
        ctx.beginPath();
        ctx.arc(x + Math.sin(time * 0.6 + i) * 4, y, level === 3 ? 1.05 : 0.85, 0, TAU);
        ctx.fill();
      }
    }
    for (const { points, bomb, fire } of trails.values()) {
      if (fire) {
        if (points.length && visible(points.at(-1).x, points.at(-1).y, 115)) {
          ctx.globalAlpha = 1;
          ribbon(ctx, points, 0.17, 5.0, '#f56b2f9e');
          ribbon(ctx, points, 0.115, 3.1, '#ffae45da');
          ribbon(ctx, points, 0.065, 1.45, '#fff6b3eb');
        }
        continue;
      }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const f = (b.t + 0.25 - time) / 0.25;
        if (f <= 0 || !visible(b.x, b.y, 35) || Math.hypot(b.x - a.x, b.y - a.y) < 1.5) continue;
        ctx.globalAlpha = f * (bomb ? 0.37 : 0.31);
        ctx.strokeStyle = bomb ? '#e9c69a' : '#ffeacc';
        ctx.lineWidth = 1 + f * (bomb ? 2 : 1.1);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function roomBreak(x, y, width) {
    if (reduced) return;
    for (let i = 0; i < 3; i++) puff(x + (random() - 0.5) * width, y + random() * 10, 5 + random() * 4);
  }
  function drawFront(ctx) {
    lights(ctx, true);
    const clock = reduced ? 0.3 : time;
    ctx.save();
    ctx.globalAlpha = fade(time / 0.35);
    for (const torch of torches) {
      if (!visible(torch.flameX, torch.flameY, 10)) continue;
      flame(
        ctx,
        torch.flameX,
        torch.flameY + 2,
        6.7 + Math.sin(clock * 8 + torch.id) * 1.15,
        clock,
        torch.id,
      );
    }
    for (const body of fires) {
      if (!visible(body.x, body.y, 48)) continue;
      const fuel = fireIntensity(body);
      ctx.globalAlpha = fuel;
      const half = Math.min(28, body.width * 0.44);
      const count = Math.min(5, Math.max(2, Math.ceil(body.width / 17)));
      const y = -Math.min(body.height * 0.35, 6);
      const c = Math.cos(body.angle),
        s = Math.sin(body.angle);
      for (let j = 0; j < count; j++) {
        const x = -half + (j * 2 * half) / (count - 1);
        flame(
          ctx,
          body.x + x * c - y * s,
          body.y + x * s + y * c,
          (7 + 5 * (body.burn || 0.2) + 3 * Math.sin(clock * 7 + j + body.id)) * (0.25 + 0.75 * fuel),
          clock,
          body.id + j,
        );
      }
    }
    ctx.restore();
    ctx.save();
    drawFronts(ctx);
    for (const v of vortices) {
      if (time > v.end || !visible(v.x, v.y, v.radius)) continue;
      const age = time - v.start;
      const pull = clamp(age / 0.36, 0, 1);
      const radius = v.radius * (1 - pull * pull);
      const fadeIn = fade(age / 0.065);
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.globalCompositeOperation = 'screen';
      if (pull < 1) {
        ctx.globalAlpha = fadeIn * (0.62 - 0.3 * pull) * (reduced ? 0.55 : 1);
        ctx.strokeStyle = '#cfafff';
        ctx.lineWidth = 0.7 + 1.5 * pull;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, TAU);
        ctx.stroke();
        const count = reduced ? 5 : 16;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const angle = v.turn + i * 2.4 + 1.6 * pull;
          const reach = radius * (0.55 + 0.45 * ((i * 13) % 17) / 16);
          const x = Math.cos(angle) * reach, y = Math.sin(angle) * reach;
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x * 0.89 - y * 0.045, y * 0.89 + x * 0.045,
            x * 0.75 - y * 0.07, y * 0.75 + x * 0.07);
        }
        ctx.stroke();
      }
      const after = clamp((age - 0.36) / 0.16, 0, 1);
      ctx.globalAlpha = fadeIn * (0.15 + 0.82 * pull) * (1 - fade(after)) * (reduced ? 0.58 : 1);
      glow(ctx, violet, 0, 0, v.radius * (0.07 + 0.18 * pull + 0.04 * after));
      ctx.restore();
    }
    for (let i = 0; i < particleCount; i++) {
      const p = particles[(particleStart + i) % MAX_PARTICLES];
      if (p.kind !== 'tracer' && !visible(p.x, p.y, p.size * 1.8 + 8)) continue;
      const age = p.age / p.life,
        opacity = clamp((1 - age) * 2, 0, 1);
      ctx.globalAlpha = opacity;
      if (p.kind === 'tracer') {
        ctx.globalAlpha = 1 - age;
        ctx.strokeStyle = '#ffdc82';
        ctx.lineWidth = 0.95;
        ctx.beginPath();
        ctx.moveTo(p.x + (p.endX - p.x) * age, p.y + (p.endY - p.y) * age);
        ctx.lineTo(p.endX, p.endY);
        ctx.stroke();
        glow(ctx, hot, p.x, p.y, 5 * (1 - age));
      } else if (p.kind === 'wick') {
        const residual = fade(1 - age);
        ctx.globalAlpha = residual * 0.55;
        glow(ctx, firelight, p.x, p.y - 2, 24 * residual);
        ctx.globalAlpha = residual;
        flame(ctx, p.x, p.y, p.size * residual, clock, p.roll);
      } else if (p.kind === 'lick') {
        ctx.globalAlpha = fade(age / 0.1) * fade((1 - age) / 0.32);
        if (Math.abs(surfaceY(p.x) - p.y) <= 4) {
          flame(ctx, p.x, p.y, p.size * (0.4 + Math.sin(Math.PI * age) * 0.85), clock, p.roll);
        }
      } else if (p.kind === 'billow') {
        const size = p.size * (0.62 + Math.sqrt(age) * 1.03);
        const width = size * (p.powder ? 2.4 : 1.9);
        const height = size * (p.powder ? 1.83 : 2.42);
        ctx.globalAlpha = fade(age / 0.14) * fade((1 - age) / 0.59);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.roll);
        ctx.drawImage(
          plumes.canvas,
          p.plume * plumes.w,
          p.powder ? plumes.h : 0,
          plumes.w,
          plumes.h,
          -width * 0.5,
          -height * 0.74,
          width,
          height,
        );
        ctx.restore();
      } else if (p.kind === 'soot') {
        const size = p.size * (0.5 + Math.sqrt(age) * 1.15);
        ctx.globalAlpha = Math.min(age * 4, 1) * (1 - age) * 0.81;
        glow(ctx, soot, p.x, p.y, size, size * 1.05);
      } else if (p.kind === 'dust' || p.kind === 'smoke' || p.kind === 'poof') {
        const sprite = p.kind === 'dust' ? dust : p.kind === 'smoke' ? smoke : magic;
        ctx.globalAlpha = fade(age / 0.16) * (1 - age) * (p.kind === 'poof' ? 1 : 0.64);
        const size = p.size * (0.48 + Math.sqrt(age) * 1.05);
        glow(ctx, sprite, p.x, p.y, size, size * (p.kind === 'poof' ? 1 : 0.86));
      } else if (p.kind === 'spark' || p.kind === 'ember') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.min(1.3, p.size * 0.55);
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.roll);
        ctx.fillStyle = p.color;
        const s = p.size;
        ctx.beginPath();
        if (p.kind === 'twinkle') {
          ctx.moveTo(0, -s * 1.7);
          ctx.lineTo(s * 0.3, -s * 0.24);
          ctx.lineTo(s, 0);
          ctx.lineTo(s * 0.22, s * 0.24);
          ctx.lineTo(0, s * 1.7);
          ctx.lineTo(-s * 0.24, s * 0.2);
          ctx.lineTo(-s, 0);
          ctx.lineTo(-s * 0.25, -s * 0.23);
        } else if (p.kind === 'wood') {
          ctx.moveTo(-s * 2.2, 0);
          ctx.lineTo(s * 1.8, -s * 0.45);
          ctx.lineTo(s * 0.8, s * 0.4);
        } else {
          ctx.moveTo(-s, -s * 0.75);
          ctx.lineTo(s * 0.8, -s * 0.42);
          ctx.lineTo(p.kind === 'glass' ? -s * 0.36 : s * 0.55, s * 1.3);
          ctx.lineTo(-s * 0.75, s * 0.5);
        }
        ctx.closePath();
        ctx.fill();
        if (p.kind === 'glass') {
          ctx.strokeStyle = '#effffc';
          ctx.lineWidth = 0.4;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
  return {
    update,
    drawBehind,
    drawFront,
    roomBreak,
    getShake() {
      const age = time - shakeStart;
      const envelope = reduced ? 0 : shakePower * Math.exp(-age * 9);
      shake.x = envelope * shakeDirection * (Math.cos(age * 47) * 0.72 + Math.cos(age * 81) * 0.28);
      shake.y = envelope * (Math.sin(age * 55 - 0.8) * 0.49 + Math.sin(age * 32) * 0.22);
      return shake;
    },
    reset() {
      particleStart = particleCount = 0;
      trails.clear();
      fires.length = torches.length = lightCount = 0;
      for (const light of flashes) light.end = -1;
      for (const vortex of vortices) vortex.end = -1;
      for (const mark of scorchMarks) mark.active = false;
      nextFlash = nextMark = shakePower = shakeStart = 0;
      time = 0;
      previous = null;
    },
  };
}
