/* Scenery: a painted backdrop per world, rock that follows the river's
   ground line, and a living river. Every colour sits in cool, muted blues
   and violets, so the bridge's green-to-red stress colours, the materials
   and the bright vehicles always stand out. The art was generated for this
   game (see ../assets/CREDITS.md). Only the ground line has to match the
   physics. */

// Images load on first use, so a river only fetches its own world.
const images = new Map();
const image = (name) => {
  if (!images.has(name)) {
    const img = new Image();
    img.src = new URL(`../assets/${name}.webp`, import.meta.url).href;
    images.set(name, img);
  }
  return images.get(name);
};
const ready = (img) => img.complete && img.naturalWidth > 0;
const ROCK_TILE = 7; // metres of bank one rock texture tile covers

/* Each river gets one of these worlds from its seed. */
export const THEMES = {
  // skyTop is the colour of each backdrop's top row, to fill the sky above it.
  valley: {
    ambient: ['clouds', 'birds'],
    name: 'Valley', ui: 'light', sky: 'sky-valley', skyTop: '#9abbf1', rock: 'rock-valley',
    rockColor: '#6c7596', surface: ['#c9d1e6', '#8a93b3'], depth: '#1c2236',
    water: { surface: '#7d93c4', deep: '#1f2a4d', glint: '#eef2ff' },
    road: '#3d4152', grid: 'rgba(30, 36, 64, 0.5)',
  },
  mesa: {
    ambient: ['stars', 'shooting'],
    name: 'Mesa', ui: 'dark', sky: 'sky-mesa', skyTop: '#273879', rock: 'rock-mesa',
    rockColor: '#5d4f86', surface: ['#a294c9', '#6b5d97'], depth: '#16122e',
    water: { surface: '#6c62a8', deep: '#191438', glint: '#e8e2ff' },
    road: '#2e2a40', grid: 'rgba(240, 236, 255, 0.55)',
  },
  snow: {
    ambient: ['clouds', 'snow'],
    name: 'Snow', ui: 'light', sky: 'sky-snow', skyTop: '#90c9fc', rock: 'rock-snow',
    rockColor: '#7f93ad', surface: ['#f4f8ff', '#b9c8dc'], depth: '#1f2d45',
    water: { surface: '#7fb0d8', deep: '#1a3352', glint: '#ffffff' },
    road: '#3e4554', grid: 'rgba(25, 45, 75, 0.5)',
  },
  night: {
    ambient: ['stars', 'shooting'],
    name: 'Night', ui: 'dark', sky: 'sky-night', skyTop: '#081b41', rock: 'rock-night',
    rockColor: '#3b4466', surface: ['#7c88b4', '#46507a'], depth: '#090c1c',
    water: { surface: '#3d4f8c', deep: '#0a1028', glint: '#d8e2ff' },
    road: '#2a2e3d', grid: 'rgba(220, 230, 255, 0.5)',
  },
  forest: {
    ambient: ['clouds', 'birds'],
    name: 'Forest', ui: 'light', sky: 'sky-forest', skyTop: '#9cbdf6', rock: 'rock-forest',
    rockColor: '#5f6f7c', surface: ['#b7c7cf', '#6f8592'], depth: '#16222b',
    water: { surface: '#6f98b0', deep: '#183244', glint: '#eef8ff' },
    road: '#3a4049', grid: 'rgba(20, 40, 55, 0.5)',
  },
  sandstone: {
    ambient: ['clouds', 'birds'],
    name: 'Sandstone', ui: 'light', sky: 'sky-sandstone', skyTop: '#9ab9f0', rock: 'rock-sandstone',
    rockColor: '#9d8790', surface: ['#d9cdd2', '#a6929a'], depth: '#2a2030',
    water: { surface: '#7d9bb8', deep: '#1f2d48', glint: '#f4f6ff' },
    road: '#433b44', grid: 'rgba(50, 30, 45, 0.5)',
  },
  dunes: {
    ambient: ['stars', 'shooting'],
    name: 'Night desert', ui: 'dark', sky: 'sky-dunes', skyTop: '#071b43', rock: 'rock-dunes',
    rockColor: '#4a4170', surface: ['#8c84b4', '#544c80'], depth: '#0c0a1e',
    water: { surface: '#3f4f8a', deep: '#0b1029', glint: '#dfe4ff' },
    road: '#26243a', grid: 'rgba(230, 225, 255, 0.5)',
  },
  city: {
    ambient: ['stars', 'plane'],
    name: 'Night city', ui: 'dark', sky: 'sky-city', skyTop: '#091e46', rock: 'rock-city',
    rockColor: '#3c4458', surface: ['#8a94ad', '#4c556c'], depth: '#080b16',
    water: { surface: '#36477a', deep: '#080d22', glint: '#e0e8ff' },
    road: '#262a36', grid: 'rgba(220, 230, 255, 0.5)',
  },
};
export const THEME_IDS = Object.keys(THEMES);

const parse = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const pa = parse(a), pb = parse(b);
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const rgba = (c, a) => `rgba(${parse(c).join(',')},${a})`;

/* Nothing to precompute any more beyond the world itself; kept so a river
   builds its scenery in one place. */
export function buildScenery(mission, theme) {
  return { theme, skyTopY: 0 };
}

/* The rock texture as a pattern pinned to the world, so it doesn't slide
   when the screen is resized. */
function rockFill(ctx, view, theme) {
  const rock = image(theme.rock);
  if (!ready(rock)) return theme.rockColor;
  theme.pattern ||= ctx.createPattern(rock, 'repeat');
  const k = ROCK_TILE * view.scale / rock.naturalWidth;
  theme.pattern.setTransform(new DOMMatrix().translate(view.sx(0), view.sy(0)).scale(k));
  return theme.pattern;
}

export function drawBackdrop(ctx, view, scenery, theme) {
  const { width, height } = view;
  ctx.fillStyle = theme.skyTop;
  ctx.fillRect(0, 0, width, height);
  const sky = image(theme.sky);
  if (!ready(sky)) return;
  // Fill the width (a screen wider than the art just stretches it), with
  // the painted horizon on the banks.
  const k = Math.max(width / sky.naturalWidth, (view.sy(0) * 0.8) / sky.naturalHeight);
  const w = sky.naturalWidth * k, h = sky.naturalHeight * k;
  ctx.drawImage(sky, (width - w) / 2, view.sy(0) + 2 - h, w, h);
  scenery.skyTopY = view.sy(0) + 2 - h;
}

/* ---------- life in the background ---------- */

const still = matchMedia('(prefers-reduced-motion: reduce)');
// A fixed random table, so the ambience is the same on every frame and screen.
const R = Array.from({ length: 512 }, (_, i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
});

/* A soft cloud, painted once per world from overlapping puffs. */
function cloudSprite(theme, index) {
  theme.clouds ||= [];
  if (theme.clouds[index]) return theme.clouds[index];
  const canvas = document.createElement('canvas');
  canvas.width = 420; canvas.height = 140;
  const c = canvas.getContext('2d');
  c.filter = 'blur(6px)';
  for (let i = 0; i < 9; i++) {
    const x = 70 + R[index * 31 + i] * 280, y = 70 + (R[index * 31 + i + 9] - 0.5) * 30;
    const r = 26 + R[index * 31 + i + 18] * 34;
    const puff = c.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
    puff.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    puff.addColorStop(1, 'rgba(236, 230, 255, 0)');
    c.fillStyle = puff;
    c.beginPath();
    c.ellipse(x, y, r * 1.5, r, 0, 0, Math.PI * 2);
    c.fill();
  }
  theme.clouds[index] = canvas;
  return canvas;
}

/* Behind the bridge: clouds and birds by day, stars, shooting stars and
   planes by night. Everything moves slowly so it never pulls the eye from
   the bridge, and nothing moves when the system asks for reduced motion. */
export function drawAmbient(ctx, view, scenery, theme, time) {
  const t = still.matches ? 0 : time;
  const { width } = view;
  const skyTop = scenery.skyTopY ?? 0;
  // The upper sky, clear of the painted horizon.
  const band = Math.max(40, view.sy(0) - skyTop) * 0.42 + skyTop;
  const top = Math.min(0, skyTop);
  const kinds = theme.ambient || [];

  if (kinds.includes('stars')) {
    for (let i = 0; i < 70; i++) {
      const x = R[i] * width, y = top + R[i + 100] * (band - top);
      const twinkle = 0.5 + 0.5 * Math.sin(t * (0.8 + R[i + 200] * 2.2) + i);
      ctx.globalAlpha = 0.25 + 0.6 * twinkle * twinkle;
      ctx.fillStyle = '#eef2ff';
      const r = 0.6 + R[i + 300] * 1.1;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }
  if (kinds.includes('shooting')) {
    // One every 9 seconds or so, each in its own place.
    const n = Math.floor(t / 9), p = (t % 9) / 0.9;
    if (p < 1) {
      const x0 = R[n % 400] * width * 0.8 + width * 0.1, y0 = top + R[(n + 7) % 400] * (band - top) * 0.6;
      const len = 90 + R[(n + 3) % 400] * 80;
      const x = x0 + p * len * 2, y = y0 + p * len * 0.7;
      const tail = ctx.createLinearGradient(x, y, x - len, y - len * 0.35);
      tail.addColorStop(0, `rgba(240, 244, 255, ${0.9 * (1 - p)})`);
      tail.addColorStop(1, 'rgba(240, 244, 255, 0)');
      ctx.strokeStyle = tail;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - len, y - len * 0.35);
      ctx.stroke();
    }
  }
  if (kinds.includes('plane')) {
    // A night flight crossing the sky, its lights blinking.
    const period = 40, p = (t % period) / period;
    const x = -40 + p * (width + 80), y = top + (band - top) * 0.35 + Math.sin(p * 3) * 6;
    ctx.fillStyle = 'rgba(230, 236, 255, 0.85)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    if ((t * 1.3) % 1 < 0.12) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + 6, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (kinds.includes('clouds')) {
    const scale = Math.max(0.6, width / 1400);
    for (let i = 0; i < 5; i++) {
      const sprite = cloudSprite(theme, i);
      const w = sprite.width * scale * (0.7 + R[i + 40] * 0.6), h = sprite.height * w / sprite.width;
      const speed = 3 + R[i + 50] * 5;
      const x = ((R[i + 60] * (width + w) + t * speed) % (width + w)) - w;
      const y = top + R[i + 70] * (band - top) - h / 2;
      ctx.globalAlpha = 0.28 + R[i + 80] * 0.2;
      ctx.drawImage(sprite, x, y, w, h);
    }
    ctx.globalAlpha = 1;
  }
  if (kinds.includes('birds')) {
    // A small flock crossing now and then, wings beating out of step.
    const period = 28, n = Math.floor(t / period), p = (t % period) / 14;
    if (p < 1) {
      const dir = R[n % 400] < 0.5 ? 1 : -1;
      const y0 = top + (band - top) * (0.3 + R[(n + 5) % 400] * 0.6);
      ctx.strokeStyle = 'rgba(40, 44, 70, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      for (let b = 0; b < 5; b++) {
        const along = dir > 0 ? -60 + p * (width + 120) : width + 60 - p * (width + 120);
        const x = along - dir * b * 16 + Math.sin(t * 0.7 + b) * 4, y = y0 + b * 7 * (b % 2 ? 1 : -0.6) + Math.sin(t * 0.9 + b * 2) * 3;
        const s = 5 + R[b + 90] * 2;
        const flap = Math.sin(t * 9 + b * 1.7) * s * 0.7;
        ctx.beginPath();
        ctx.moveTo(x - s, y - flap);
        ctx.quadraticCurveTo(x - s * 0.4, y - flap * 0.2 - 1, x, y);
        ctx.quadraticCurveTo(x + s * 0.4, y - flap * 0.2 - 1, x + s, y - flap);
        ctx.stroke();
      }
    }
  }
}

/* In front of everything: falling snow. */
export function drawWeather(ctx, view, theme, time) {
  if (!(theme.ambient || []).includes('snow')) return;
  const t = still.matches ? 0 : time;
  const { width, height } = view;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (let i = 0; i < 90; i++) {
    const speed = 14 + R[i + 120] * 22, r = 0.8 + R[i + 220] * 1.6;
    const y = ((R[i + 320] * (height + 20) + t * speed) % (height + 20)) - 10;
    const x = (R[i + 420] * width + Math.sin(t * 0.6 + i) * 14 + width) % width;
    ctx.globalAlpha = 0.35 + R[i + 20] * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawGround(ctx, view, mission, scenery, theme) {
  const px = 1.5;
  const top = view.sy(0), bottom = view.sy(mission.water);
  // The far wall of the gorge: the same rock, in shadow.
  ctx.fillStyle = rockFill(ctx, view, theme);
  ctx.fillRect(view.sx(mission.left), top, view.sx(mission.right) - view.sx(mission.left), view.height - top);
  ctx.fillStyle = rgba(theme.depth, 0.7);
  ctx.fillRect(view.sx(mission.left), top, view.sx(mission.right) - view.sx(mission.left), view.height - top);

  // The ground itself, traced from the physics' ground line.
  const x0 = view.wx(-px * 4), x1 = view.wx(view.width + px * 4);
  const line = [];
  for (let x = x0; x <= x1 + 0.25; x += 0.25) line.push([view.sx(x), view.sy(mission.ground(x))]);
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(line[0][0], view.height + px);
    for (const [sx, sy] of line) ctx.lineTo(sx, sy);
    ctx.lineTo(line[line.length - 1][0], view.height + px);
    ctx.closePath();
  };
  trace();
  ctx.fillStyle = rockFill(ctx, view, theme);
  ctx.fill();
  // Deeper rock is darker.
  const shade = ctx.createLinearGradient(0, top, 0, Math.max(top + 1, view.height));
  shade.addColorStop(0, rgba(theme.depth, 0));
  shade.addColorStop(1, rgba(theme.depth, 0.6));
  trace();
  ctx.fillStyle = shade;
  ctx.fill();

  // A lit top edge on ground you could stand on (not on cliff faces).
  const ledge = (offset, color) => {
    ctx.beginPath();
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1], [bx, by] = line[i];
      if (Math.abs(by - ay) > Math.abs(bx - ax)) continue;
      ctx.moveTo(ax, ay + offset);
      ctx.lineTo(bx, by + offset);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = px * 2;
    ctx.stroke();
  };
  // A dark outline separates near rock from the shadowed far wall.
  ctx.beginPath();
  line.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
  ctx.strokeStyle = theme.depth;
  ctx.lineWidth = px * 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineCap = 'square';
  ledge(px * 2.5, theme.surface[1]);
  ledge(px, theme.surface[0]);

  // The road on both banks.
  const h = Math.max(px * 3, view.scale * 0.32);
  for (const [a, b] of [[-10, view.sx(mission.left)], [view.sx(mission.right), view.width + 10]]) {
    ctx.fillStyle = '#141620';
    ctx.fillRect(a, top - h - px, b - a, h + px * 2);
    ctx.fillStyle = theme.road;
    ctx.fillRect(a, top - h, b - a, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(a, top - h, b - a, px);
  }
}

/* The river: a clear body that darkens with depth, a reflection of the
   bridge (drawn by the caller, mirrored), and light glinting on the ripples. */
export function drawWater(ctx, view, mission, theme, time, reflect) {
  ctx.save();
  // Water only fills the gorge above the rock, so it follows the banks.
  ctx.beginPath();
  ctx.moveTo(view.sx(mission.left), -10);
  for (let x = mission.left; x <= mission.right; x += 0.25) ctx.lineTo(view.sx(x), view.sy(mission.ground(x)));
  ctx.lineTo(view.sx(mission.right), view.sy(mission.ground(mission.right - 1e-3)));
  ctx.lineTo(view.sx(mission.right), -10);
  ctx.closePath();
  ctx.clip();
  surfaceWater(ctx, view, mission, theme, time, reflect);
  ctx.restore();
}

function surfaceWater(ctx, view, mission, theme, time, reflect) {
  const { surface, deep, glint } = theme.water;
  const x0 = view.sx(mission.left), x1 = view.sx(mission.right);
  const level = view.sy(mission.water);
  const bottom = view.height + 10;
  const amp = Math.max(0.8, view.scale * 0.05);
  const wave = (px) => level + Math.sin(px * 0.045 + time * 1.6) * amp + Math.sin(px * 0.11 - time * 2.3) * amp * 0.45;

  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let px = x0; px < x1; px += 4) ctx.lineTo(px, wave(px));
    ctx.lineTo(x1, wave(x1));
    ctx.lineTo(x1, bottom);
    ctx.closePath();
  };
  const body = ctx.createLinearGradient(0, level, 0, Math.min(bottom, level + view.scale * 9));
  body.addColorStop(0, rgba(surface, 0.72));
  body.addColorStop(0.35, rgba(mix(surface, deep, 0.5), 0.86));
  body.addColorStop(1, rgba(deep, 0.97));
  outline();
  ctx.fillStyle = body;
  ctx.fill();

  if (reflect) {
    ctx.save();
    outline();
    ctx.clip();
    // Mirror about the water line, squashed a little the way ripples do.
    ctx.translate(0, level);
    ctx.scale(1, -0.9);
    ctx.translate(0, -level);
    ctx.globalAlpha = 0.16;
    reflect();
    ctx.restore();
    // Reflections fade with depth.
    const fade = ctx.createLinearGradient(0, level, 0, level + view.scale * 6);
    fade.addColorStop(0, rgba(deep, 0));
    fade.addColorStop(1, rgba(deep, 0.6));
    outline();
    ctx.fillStyle = fade;
    ctx.fill();
  }

  // Long, slow glints just below the surface.
  ctx.strokeStyle = rgba(glint, 0.28);
  ctx.lineWidth = Math.max(1, view.scale * 0.06);
  ctx.lineCap = 'round';
  const span = x1 - x0;
  for (let i = 0; i < 9; i++) {
    const depth = ((i * 0.37) % 1) * view.scale * 2.4 + view.scale * 0.35;
    const length = view.scale * (0.6 + (i % 3) * 0.5);
    const px = x0 + (((i * 0.61 + time * (0.012 + (i % 4) * 0.004)) % 1) * (span + length)) - length;
    const shimmer = 0.5 + 0.5 * Math.sin(time * 1.3 + i * 2.1);
    ctx.globalAlpha = shimmer;
    ctx.beginPath();
    ctx.moveTo(Math.max(x0, px), level + depth);
    ctx.lineTo(Math.min(x1, px + length), level + depth);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The surface line, brightest where a ripple faces the light.
  ctx.lineWidth = Math.max(1.2, view.scale * 0.07);
  ctx.strokeStyle = rgba(glint, 0.75);
  ctx.beginPath();
  for (let px = x0; px <= x1; px += 4) px === x0 ? ctx.moveTo(px, wave(px)) : ctx.lineTo(px, wave(px));
  ctx.stroke();
}
