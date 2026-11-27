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
const phases = { day: 0.23, dawn: 0.58, dusk: 0.74, night: 1 };
const fragmentColors = {
  stone: ['#a99c80', '#807967', '#d6c9ac'],
  glass: ['#e0fff3', '#7fdcd7', '#b8f8fe'],
  wood: ['#ddac66', '#945c32', '#f8dca6'],
  steel: ['#fff2b4', '#ffc75f', '#ec7d41'],
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

export function createEffects() {
  const flames = flameAtlas();
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
  const magic = lightSprite([
    [0, '#efffcddb'],
    [0.26, '#c1ecc782'],
    [0.68, '#89bfc136'],
    [1, '#9adbd000'],
  ]);
  const particles = Array.from({ length: MAX_PARTICLES }, () => ({}));
  const trails = new Map(),
    torches = [],
    fires = [];
  let particleStart = 0,
    particleCount = 0;
  let strength = 0,
    time = 0,
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
  function burst(e) {
    const energy = clamp(e.strength ?? 0.6, 0.1, 1);
    const blast = e.type === 'explosion';
    const material = e.material in fragmentColors ? e.material : 'stone';
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
      for (let i = 0; i < (reduced ? 1 : 4); i++) puff(e.x + random() * 3, e.y - i, 5 + i, true);
      return;
    }
    if (e.type === 'launch') {
      if (!reduced)
        for (let i = 0; i < 5; i++) puff(e.x - 30 + random() * 40, 385 - random() * 3, 6 + random() * 6);
      return;
    }
    if (e.type !== 'fracture' && e.type !== 'impact' && !blast) return;
    if (!reduced)
      strength = Math.max(strength, blast ? 3.5 + energy : e.type === 'impact' ? energy * 1.8 : energy * 0.8);
    if (blast) {
      particle('blast', e.x, e.y, 0, 0, 37 + energy * 69, reduced ? 0.25 : 0.55);
      for (let i = 0; i < (reduced ? 2 : 9); i++) {
        const a = (TAU * i) / 9,
          v = 25 + random() * 37;
        particle(
          'fireball',
          e.x,
          e.y,
          Math.cos(a) * v,
          Math.sin(a) * v - 18,
          10 + random() * 14,
          0.22 + random() * 0.2,
        );
        puff(e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 7, 11 + random() * 12, true);
      }
    }
    const count = reduced ? 2 : blast ? 29 : e.type === 'fracture' ? 11 : 6;
    for (let i = 0; i < count; i++) {
      const a = random() * TAU,
        speed = (blast ? 62 + random() * 130 : 18 + random() * 56) * (0.4 + energy * 0.6);
      const kind = blast ? 'spark' : material === 'steel' ? 'spark' : material;
      const colors = fragmentColors[blast ? 'steel' : material];
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
      if (!blast && (material === 'stone' || material === 'wood') && i % 4 === 0) puff(e.x, e.y, 6 + energy * 9);
    }
  }

  function surfaceY(x) {
    for (let i = 1; i < floor.length; i++) {
      const a = floor[i - 1],
        b = floor[i];
      if (x >= a.x && x <= b.x && b.x > a.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
    return 389;
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
  ) {
    const newFrame = previous !== now;
    previous = now;
    time = now;
    reduced = reducedMotion;
    phase = missionPhase;
    level = levelIndex;
    floor = terrain;
    wind = windForce;
    windLean = clamp(wind / 24, -1, 1) * 0.39;
    strength *= Math.exp(-dt * 10.5);
    torches.length = 0;
    fires.length = 0;
    for (const body of bodies) {
      if (body.kind === 'torch' && body.lit) torches.push(body);
      if (body.burning) fires.push(body);
      if (body.kind !== 'projectile' || reduced) continue;
      const trail = trails.get(body.id) || { points: [], bomb: body.material.endsWith('bomb') };
      if (!trail.points.length || time - trail.points.at(-1).t >= 0.015) {
        const point = trail.points.length === 18 ? trail.points.shift() : {};
        point.x = body.x;
        point.y = body.y;
        point.t = time;
        trail.points.push(point);
      }
      trail.lastSeen = now;
      trails.set(body.id, trail);
    }
    for (const [id, trail] of trails) if (trail.lastSeen !== now) trails.delete(id);
    collectLights();
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
      if (p.kind === 'dust' || p.kind === 'smoke') {
        p.vx = p.vx * airDrag + wind * 1.8 * (1 - airDrag);
        p.vy -= dt * 4;
      } else if (p.kind === 'fireball' || p.kind === 'ember') {
        p.vx += wind * dt;
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
      lightCount++;
    }
  }

  function lights(ctx, front) {
    if (!lightCount) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = front ? 0.27 * (phases[phase] ?? phases.day) : 1;
    for (let i = 0; i < lightCount; i++) {
      const entry = lightPoints[i];
      if (visible(entry.x, entry.y, entry.radius)) {
        glow(ctx, front ? firelight : entry.image, entry.x, entry.y, entry.radius);
      }
    }
    ctx.restore();
  }

  function drawBehind(ctx) {
    const t = ctx.getTransform();
    visibleLeft = -t.e / t.a;
    visibleRight = (ctx.canvas.width - t.e) / t.a;
    visibleTop = -t.f / t.d;
    visibleBottom = (ctx.canvas.height - t.f) / t.d;
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
    for (const { points, bomb } of trails.values()) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const f = (b.t + 0.25 - time) / 0.25;
        if (f <= 0 || Math.hypot(b.x - a.x, b.y - a.y) < 1.5) continue;
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
    for (const torch of torches) {
      if (!visible(torch.flameX, torch.flameY, 10)) continue;
      flame(ctx, torch.flameX, torch.flameY + 2, 6.7 + Math.sin(clock * 8 + torch.id) * 1.15, clock, torch.id);
    }
    for (const body of fires) {
      if (!visible(body.x, body.y, 48)) continue;
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
          7 + 5 * (body.burn || 0.2) + 3 * Math.sin(clock * 7 + j + body.id),
          clock,
          body.id + j,
        );
      }
    }
    ctx.save();
    for (let i = 0; i < particleCount; i++) {
      const p = particles[(particleStart + i) % MAX_PARTICLES];
      if (!visible(p.x, p.y, p.size * 1.8 + 8)) continue;
      const age = p.age / p.life,
        fade = clamp((1 - age) * 2, 0, 1);
      ctx.globalAlpha = fade;
      if (p.kind === 'blast') {
        const radius = p.size * (1 - (1 - age) ** 3);
        ctx.globalAlpha = (1 - age) ** 1.8 * 0.8;
        ctx.strokeStyle = '#f9deac';
        ctx.lineWidth = 1 + (1 - age) * 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, radius), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = Math.max(0, 1 - age * 2.4) * 0.9;
        glow(ctx, firelight, p.x, p.y, Math.max(7, p.size * 1.3));
      } else if (p.kind === 'dust' || p.kind === 'smoke' || p.kind === 'poof' || p.kind === 'fireball') {
        const sprite = p.kind === 'dust' ? dust : p.kind === 'smoke' ? smoke : p.kind === 'poof' ? magic : hot;
        ctx.globalAlpha = (1 - age) * (p.kind === 'dust' || p.kind === 'smoke' ? 0.64 : 1);
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
      return reduced
        ? { x: 0, y: 0 }
        : { x: Math.sin(time * 88) * strength, y: Math.cos(time * 104) * strength * 0.56 };
    },
    reset() {
      particleStart = particleCount = 0;
      trails.clear();
      fires.length = torches.length = lightCount = 0;
      strength = 0;
      time = 0;
      previous = null;
    },
  };
}
