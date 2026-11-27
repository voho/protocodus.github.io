// Keep the lightning and its delayed thunder on the same siege clock.
export function stormStrikeTime(seed, clock) {
  const cycle = Math.floor(clock / 19);
  let hash = Math.imul(seed ^ Math.imul(cycle + 1, 0x45d9f3b), 0x27d4eb2d);
  hash ^= hash >>> 16;
  return cycle * 19 + 3 + (hash >>> 0) / 4294967296 * 10;
}

const wrap = (v, width) => v - width * Math.floor(v / width);
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const smooth = (v) => v * v * (3 - 2 * v);

// All cloud octaves tile horizontally. One small texture paints the cloud deck
// at any camera scale without a filter or a full-resolution intermediate canvas.
function cloudTexture(copies) {
  const canvas = document.createElement('canvas');
  const w = 512, h = canvas.height = 112;
  canvas.width = w * copies;
  const ctx = canvas.getContext('2d');
  const raster = ctx.createImageData(w, h);
  const lattice = new Float32Array(64 * 64);
  let seed = 0x51e8329a;
  for (let i = 0; i < lattice.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    lattice[i] = seed / 4294967296;
  }
  function noise(u, v, cells) {
    const x = u * cells, y = v * cells * 0.61;
    const col = Math.floor(x), row = Math.floor(y);
    const sx = smooth(x - col), sy = smooth(y - row);
    const a = col & (cells - 1), b = (col + 1) & (cells - 1);
    const top = (row & 63) * 64, bottom = ((row + 1) & 63) * 64;
    const near = lattice[top + a] * (1 - sx) + lattice[top + b] * sx;
    const far = lattice[bottom + a] * (1 - sx) + lattice[bottom + b] * sx;
    return near * (1 - sy) + far * sy;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, curl = noise(u, v + 2.2, 4) * 0.12;
    const n = noise(u + curl, v + 1.1, 8) * 0.47 + noise(u, v + curl, 16) * 0.3 +
      noise(u + curl, v, 32) * 0.16 + noise(u, v, 64) * 0.07;
    const alpha = smooth(clamp((1.05 - v + (n - 0.5) * 0.62) * 1.32, 0, 1)) * (0.4 + n * 0.6);
    const tone = 27 + n * 54 + v * 29;
    const p = (y * w + x) * 4;
    raster.data[p] = tone; raster.data[p + 1] = tone + 12; raster.data[p + 2] = tone + 25;
    raster.data[p + 3] = 247 * alpha * Math.min(1, (1 - v) * 8);
  }
  for (let i = 0; i < copies; i++) ctx.putImageData(raster, w * i, 0);
  return canvas;
}

export function createWeatherEffects(skyLayer) {
  const clouds = cloudTexture(skyLayer ? 3 : 1), splashes = new Float32Array(20);
  if (skyLayer) skyLayer.replaceChildren(clouds);
  const flash = document.createElement('canvas');
  flash.width = flash.height = 96;
  const light = flash.getContext('2d');
  const glow = light.createRadialGradient(48, 48, 0, 48, 48, 48);
  glow.addColorStop(0, '#e9f4ffb3');
  glow.addColorStop(0.47, '#c5dcf26e');
  glow.addColorStop(1, '#d1e4ed00');
  light.fillStyle = glow;
  light.fillRect(0, 0, 96, 96);
  let drift = 0, sampled = -Infinity, cloudTick = -1;
  let oldWidth = 0, oldHeight = 0, oldShift = Infinity;

  function drawSky(ctx, sim, view, clock, reduced, dt, wind) {
    const weather = sim.level?.weather;
    if (!reduced) drift += wind * dt;
    if (skyLayer && skyLayer.dataset.weather !== weather) skyLayer.dataset.weather = weather || 'clear';
    if (!weather || weather === 'clear') return;
    const height = Math.min(view.height * 0.89, Math.max(view.height * 0.25, 385 - view.y));
    const width = Math.max(view.width * 0.76, 680);
    const shift = wrap(view.x * 0.21 - drift * 0.08 + (sim.seed % 451), width);
    ctx.save();
    if (skyLayer) {
      // A very slow cloud bank can be composited independently of a 4K battlefield.
      // Three adjacent copies cover the widest view through a full tile of drift.
      if (cloudTick !== Math.floor(clock * 8)) {
        cloudTick = Math.floor(clock * 8);
        const w = Math.round(width / view.width * 30000) / 100;
        const h = Math.round(height / view.height * 10000) / 100;
        const offset = Math.round(-shift / width * 100000 / 3) / 1000;
        if (w !== oldWidth) { clouds.style.width = w + '%'; oldWidth = w; }
        if (h !== oldHeight) { clouds.style.height = h + '%'; oldHeight = h; }
        if (offset !== oldShift) { clouds.style.transform = 'translateX(' + offset + '%)'; oldShift = offset; }
      }
    } else {
      if (weather === 'storm') {
        ctx.fillStyle = '#25374940';
        ctx.fillRect(view.x, view.y, view.width, view.height);
      }
      ctx.globalAlpha = weather === 'storm' ? 1 : weather === 'snow' ? 0.43 : 0.65;
      for (let left = view.x - shift; left < view.x + view.width; left += width)
        ctx.drawImage(clouds, left, view.y, width + 0.5, height);
    }
    if (weather === 'storm' && !reduced) {
      const age = clock - stormStrikeTime(sim.seed, clock);
      if (age >= 0 && age < 0.95) {
        const strength = smooth(Math.min(1, age / 0.17)) * (1 - age / 0.95) ** 1.65;
        const slot = Math.floor(clock / 19);
        const cx = view.x + view.width * (0.23 + wrap(sim.seed * 0.31 + slot * 0.619, 0.54));
        const cy = view.y + height * 0.28;
        ctx.globalAlpha = strength * 0.77;
        ctx.drawImage(flash, cx - view.width * 0.42, cy - height * 0.54, view.width * 0.84, height * 1.08);
        if (age < 0.47) {
          const span = view.width * 0.077, fork = height * 0.058;
          ctx.globalAlpha = strength * 0.57;
          ctx.strokeStyle = '#deedff';
          ctx.lineWidth = view.width * 0.0007;
          ctx.beginPath();
          ctx.moveTo(cx - span, cy - fork * 0.8);
          ctx.lineTo(cx - span * 0.34, cy);
          ctx.lineTo(cx - span * 0.42, cy - fork * 0.25);
          ctx.lineTo(cx, cy + fork * 0.2);
          ctx.lineTo(cx + span * 0.52, cy + fork);
          ctx.moveTo(cx, cy + fork * 0.2);
          ctx.lineTo(cx + span * 0.24, cy - fork * 0.14);
          ctx.lineTo(cx + span * 0.6, cy + fork * 0.28);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Sample only the skyline at ten fixed columns a few times per second.
  // Actual moving roof polygons and cratered terrain catch the visible drops.
  function sampleRoofs(sim, bodies, view, clock) {
    if (clock - sampled < 0.34) return;
    sampled = clock;
    const step = Math.floor(clock / 0.34);
    for (let i = 0; i < splashes.length; i += 2) {
      const x = view.x + wrap(i * 0.08357 + step * 0.1311 + sim.seed * 0.00051, 1) * view.width;
      let y = sim.terrainHeight(x);
      for (const e of bodies) {
        if (e.kind !== 'block' && e.kind !== 'fragment') continue;
        const { bounds, vertices } = e.body;
        if (x < bounds.min.x || x > bounds.max.x || bounds.min.y >= y) continue;
        for (let j = 0, k = vertices.length - 1; j < vertices.length; k = j++) {
          const a = vertices[k], b = vertices[j];
          if ((a.x <= x && x < b.x) || (b.x <= x && x < a.x))
            y = Math.min(y, a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
        }
      }
      splashes[i] = x; splashes[i + 1] = y;
    }
  }

  function drawAir(ctx, sim, bodies, view, clock, reduced, wind, cssWidth, front) {
    const weather = sim.level?.weather;
    if (reduced || !weather) return;
    const gale = weather === 'clear', snow = weather === 'snow';
    if (gale && (front || Math.abs(wind) < 27)) return;
    const px = view.width / cssWidth;
    const width = Math.max(1150, view.width + 32), height = Math.max(670, view.height + 32);
    const count = gale ? 12 : Math.round(clamp(cssWidth / 12, 38, 110) * (front ? 0.22 : weather === 'storm' ? 1.2 : 0.83));
    const hue = snow ? '#f2f7ff' : '#c9e3f2';
    ctx.save();
    ctx.strokeStyle = hue; ctx.fillStyle = hue;
    ctx.lineCap = 'round';
    for (let layer = 0; layer < 2; layer++) {
      const weight = front ? 1.18 : 0.68 + 0.23 * layer;
      ctx.lineWidth = Math.max(0.8 * px, 0.64) * weight;
      ctx.globalAlpha = gale ? 0.21 : (snow ? 0.84 : 0.57) * weight;
      ctx.beginPath();
      for (let i = layer; i < count; i += 2) {
        const id = i + (front ? 159 : 0);
        const spread = 0.83 + wrap(id * 0.47213, 0.48);
        const t = clock * spread;
        const vx = wind * (gale ? 2.1 : 1.35);
        const vy = gale ? 3 : snow ? 17 + 5 * layer : 210 + 31 * layer;
        const x0 = (id * 0.618034 + sim.seed * 0.00051) * width;
        const y0 = (id * 0.414214 + sim.seed * 0.00018) * height;
        const x = view.x - 16 + wrap(x0 + drift * spread * (gale ? 2.1 : 1.35) - view.x + 16 +
          (snow ? Math.sin(t * 1.3 + id) * 7 : 0), width);
        const y = view.y - 16 + wrap(y0 + t * vy - view.y + 16, height);
        if (x > view.x + view.width + 10 || y > view.y + view.height + 10 || y > sim.terrainHeight(x)) continue;
        if (snow) {
          const radius = Math.max(0.85 * weight, px * 0.78) * spread * (front ? 1.56 : 1);
          ctx.moveTo(x + radius, y);
          ctx.arc(x, y, radius, 0, Math.PI * 2);
        } else {
          const duration = gale ? 0.24 : 0.042 + 0.016 * layer;
          ctx.moveTo(x - vx * duration, y - vy * duration);
          ctx.lineTo(x, y);
        }
      }
      if (snow) ctx.fill(); else ctx.stroke();
    }
    if (front && !snow && !gale) {
      sampleRoofs(sim, bodies, view, clock);
      const age = (clock - sampled) / 0.34;
      const radius = 1 + age * 3.4;
      ctx.globalAlpha = 0.48 * Math.sin(Math.PI * age);
      ctx.lineWidth = Math.max(px * 0.6, 0.55);
      ctx.beginPath();
      for (let i = 0; i < splashes.length; i += 2) {
        const x = splashes[i], y = splashes[i + 1];
        ctx.moveTo(x - radius, y - 1.8 + age); ctx.lineTo(x - radius * 0.45, y);
        ctx.moveTo(x + radius, y - 2.2 + age); ctx.lineTo(x + radius * 0.45, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  return { drawSky, drawAir, reset() { drift = 0; sampled = -Infinity; cloudTick = -1; } };
}
