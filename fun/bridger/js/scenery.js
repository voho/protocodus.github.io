/* Painted scenery, a river in motion and banks traced from the same
   ground profile the bridge and vehicles stand on. */
import { createRng } from '../../shared/rng.js';

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
  // Skyline rows are fractions of the painting height, for the panorama
  // and for its narrow landmark crop. skyAlign selects that landmark.
  valley: {
    ambient: ['clouds', 'raptors'],
    name: 'Valley', ui: 'light', sky: 'sky-valley', skyline: [0.54, 0.54], skyAlign: 0.1, skyTop: '#6ba9e7', rock: 'rock-valley',
    rockColor: '#929185', tint: '#9f9a7457', surface: ['#b7ba91', '#858a72'], depth: '#364a4d',
    water: { surface: '#79a8b2', deep: '#285261', glint: '#f2f5dc' },
    road: '#42464a', grid: 'rgba(37, 55, 68, 0.55)',
  },
  mesa: {
    ambient: ['stars', 'dust'],
    name: 'Mesa', ui: 'dark', sky: 'sky-mesa', skyline: [0.79, 0.76], skyAlign: 0.98, skyTop: '#2d2d64', rock: 'rock-mesa',
    rockColor: '#916775', tint: '#725e795c', surface: ['#daaa96', '#997b86'], depth: '#3c3047',
    water: { surface: '#a98f9c', deep: '#443a57', glint: '#ffe0c9' },
    road: '#443b47', grid: 'rgba(249, 238, 227, 0.57)',
  },
  snow: {
    ambient: ['clouds', 'snow'],
    name: 'Snow', ui: 'light', sky: 'sky-snow', skyline: [0.59, 0.57], skyAlign: 0.05, skyTop: '#6491d9', rock: 'rock-snow',
    rockColor: '#90aab2', tint: '#b8d7df49', surface: ['#fff9e9', '#cadce0'], depth: '#314758',
    water: { surface: '#8fbfc8', deep: '#2e5068', glint: '#fff9e9' },
    road: '#454e56', grid: 'rgba(32, 55, 77, 0.55)',
  },
  night: {
    ambient: ['stars', 'shooting', 'fireflies'],
    name: 'Night', ui: 'dark', sky: 'sky-night', skyline: [0.65, 0.61], skyAlign: 0.91, skyTop: '#083349', rock: 'rock-night',
    rockColor: '#495569', tint: '#42616d5c', surface: ['#91a6b0', '#596e7a'], depth: '#142333',
    water: { surface: '#557b8c', deep: '#172b41', glint: '#e4eedf' },
    road: '#293540', grid: 'rgba(221, 239, 240, 0.54)',
  },
  forest: {
    ambient: ['birds', 'leaves'],
    name: 'Forest', ui: 'light', sky: 'sky-forest', skyline: [0.6, 0.54], skyAlign: 0.11, skyTop: '#8aa6ae', rock: 'rock-forest',
    rockColor: '#6f7a62', tint: '#82936460', surface: ['#b1b480', '#788864'], depth: '#273d3b',
    water: { surface: '#76a598', deep: '#274a4a', glint: '#eef5d4' },
    road: '#3c4542', grid: 'rgba(30, 52, 56, 0.55)',
  },
  sandstone: {
    ambient: ['clouds', 'raptors'],
    name: 'Sandstone', ui: 'light', sky: 'sky-sandstone', skyline: [0.62, 0.52], skyAlign: 0.035, skyTop: '#82a8e4', rock: 'rock-sandstone',
    rockColor: '#b17967', tint: '#cbab915e', surface: ['#eec6a5', '#b78873'], depth: '#563f44',
    water: { surface: '#80b0ad', deep: '#365c64', glint: '#fff0d5' },
    road: '#4c4242', grid: 'rgba(66, 45, 55, 0.55)',
  },
  dunes: {
    ambient: ['stars', 'shooting', 'dust'],
    name: 'Night desert', ui: 'dark', sky: 'sky-dunes', skyline: [0.775, 0.76], skyAlign: 0.23, skyTop: '#0f3355', rock: 'rock-dunes',
    rockColor: '#706077', tint: '#38476b92', surface: ['#b1a5b8', '#796c87'], depth: '#302d49',
    water: { surface: '#777c9f', deep: '#30334f', glint: '#f5e6d8' },
    road: '#363343', grid: 'rgba(235, 232, 250, 0.55)',
  },
  city: {
    ambient: ['stars', 'plane'],
    name: 'Night city', ui: 'dark', sky: 'sky-city', skyline: [0.71, 0.66], skyAlign: 0.93, skyTop: '#0e254c', rock: 'rock-city',
    rockColor: '#50596a', tint: '#273c5c91', surface: ['#9baab4', '#64778b'], depth: '#172335',
    water: { surface: '#697b95', deep: '#213047', glint: '#ffd6a8' },
    road: '#333e4b', grid: 'rgba(232, 237, 247, 0.55)',
  },
  desert: {
    ambient: ['birds', 'dust'],
    name: 'Desert', ui: 'light', sky: 'sky-desert', skyline: [0.65, 0.59], skyAlign: 0.97, skyTop: '#77d4d6', rock: 'rock-dunes',
    rockColor: '#ad8a70', tint: '#edb17e52', surface: ['#eed0a4', '#b89879'], depth: '#55454e',
    water: { surface: '#72a6a9', deep: '#23495a', glint: '#fff1da' },
    road: '#4b4244', grid: 'rgba(58, 44, 49, 0.55)',
  },
  meadow: {
    ambient: ['clouds', 'butterflies'],
    name: 'Meadow', ui: 'light', sky: 'sky-meadow', skyline: [0.63, 0.61], skyAlign: 0.03, skyTop: '#6db0f5', rock: 'rock-forest',
    rockColor: '#647759', tint: '#8a9b6b4d', surface: ['#a9be7b', '#71855c'], depth: '#263d40',
    water: { surface: '#77aba5', deep: '#244a56', glint: '#fffbe0' },
    road: '#454844', grid: 'rgba(34, 61, 68, 0.55)',
  },
  'tropical-island': {
    ambient: ['clouds', 'birds'],
    name: 'Tropical Island', ui: 'light', sky: 'sky-island', skyline: [0.675, 0.68], skyAlign: 0.95, skyTop: '#87c7fc', rock: 'rock-snow',
    rockColor: '#b8a58b', tint: '#edd7ad7a', surface: ['#f4dfaf', '#b4a389'], depth: '#2c4c58',
    water: { surface: '#52c7bb', deep: '#195b70', glint: '#f2fff6' },
    road: '#454b51', grid: 'rgba(32, 57, 65, 0.55)',
  },
  jungle: {
    ambient: ['fireflies'],
    name: 'Jungle', ui: 'light', sky: 'sky-jungle', skyline: [0.6, 0.52], skyAlign: 0.055, skyTop: '#d6f0df', rock: 'rock-forest',
    rockColor: '#556350', tint: '#637f415e', surface: ['#899d64', '#627454'], depth: '#1c3533',
    water: { surface: '#688e77', deep: '#1f4544', glint: '#e5efd0' },
    road: '#363f39', grid: 'rgba(25, 55, 54, 0.57)',
  },
  'canadian-forest': {
    ambient: ['birds', 'leaves'],
    name: 'Canadian Forest with a Lake', ui: 'light', sky: 'sky-lake', skyline: [0.6, 0.54], skyAlign: 0.88, skyTop: '#8ebdfc', rock: 'rock-valley',
    rockColor: '#838b8a', tint: '#89958b42', surface: ['#b2b9a2', '#889483'], depth: '#243a46',
    water: { surface: '#7aa2b3', deep: '#224555', glint: '#f0f8f7' },
    road: '#41464b', grid: 'rgba(31, 50, 63, 0.55)',
  },
};
export const THEME_IDS = Object.keys(THEMES);

const parse = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const pa = parse(a), pb = parse(b);
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const rgba = (c, a) => `rgba(${parse(c).join(',')},${a})`;

export function buildScenery(mission) {
  const rng = createRng(`${mission.seed}:far-bank`);
  const phase = rng.next() * Math.PI * 2, bend = rng.range(38, 62) / 100;
  // The distant shore runs near road level, even when the river is deep.
  const shoreDepth = Math.min(0.85, -mission.water * 0.18);
  const farBank = (x) => {
    const across = Math.max(0, Math.min(1, (x - mission.left) / (mission.right - mission.left)));
    const down = across < bend ? across / bend : (1 - across) / (1 - bend);
    const bowl = down * down * (3 - 2 * down);
    return 0.5 - shoreDepth * bowl + 0.33 * Math.sin(x * 0.6 + phase) + 0.12 * Math.sin(x * 1.7 + phase);
  };
  return { farBank, backdropFloor: -shoreDepth, phase };
}

/* The rock texture as a pattern pinned to the world, so it doesn't slide
   when the screen is resized. */
function rockFill(ctx, view, theme) {
  const rock = image(theme.rock);
  if (!ready(rock)) return theme.rockColor;
  if (!theme.pattern) {
    let tile = rock;
    if (theme.tint) {
      tile = document.createElement('canvas');
      tile.width = rock.naturalWidth; tile.height = rock.naturalHeight;
      const c = tile.getContext('2d');
      c.drawImage(rock, 0, 0);
      c.fillStyle = theme.tint;
      c.fillRect(0, 0, tile.width, tile.height);
    }
    theme.pattern = ctx.createPattern(tile, 'repeat');
  }
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
  // Frame the distant ridgeline against the road. Stretching a panorama to
  // the riverbed would bury its lower landscape behind the playable banks.
  const floor = view.sy(scenery.backdropFloor) + 2;
  const deck = view.sy(0);
  const narrow = Math.max(0, Math.min(1, 2 - width / deck));
  const [panorama, portrait] = theme.skyline;
  const ridge = panorama + (portrait - panorama) * narrow;
  const horizon = deck * 0.54;
  const aspect = sky.naturalWidth / sky.naturalHeight;
  const h = Math.max(floor, width / aspect, (floor - horizon) / (1 - ridge));
  const w = h * aspect;
  // Cover the entire visible sky with a single undistorted painting. City
  // towers, desert cacti and other off-centre landmarks guide the phone crop.
  ctx.drawImage(sky, (width - w) * theme.skyAlign, floor - h, w, h);
}

/* ---------- life in the background ---------- */

const still = matchMedia('(prefers-reduced-motion: reduce)');
// A fixed random table, so the ambience is the same on every frame and screen.
const R = Array.from({ length: 512 }, (_, i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
});

/* Long, feathered wisps sit lightly over the painted clouds. They double
   as mist when compressed against the opposite bank. */
function cloudSprite(theme, index) {
  theme.clouds ||= [];
  if (theme.clouds[index]) return theme.clouds[index];
  const canvas = document.createElement('canvas');
  canvas.width = 420; canvas.height = 100;
  const c = canvas.getContext('2d');
  const color = theme.ui === 'dark' ? '#afb9d0' : '#fffdf2';
  for (let i = 0; i < 10; i++) {
    const x = 60 + i * 30, y = 56 - Math.sin(i * 0.5 + index) * 9 - R[index * 20 + i] * 11;
    c.save();
    c.translate(x, y);
    c.scale(45 + 40 * R[index * 20 + i + 10], 8 + 13 * R[index * 20 + i]);
    const puff = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    puff.addColorStop(0, rgba(color, 0.75));
    puff.addColorStop(0.5, rgba(color, 0.35));
    puff.addColorStop(1, rgba(color, 0));
    c.fillStyle = puff;
    c.fillRect(-1, -1, 2, 2);
    c.restore();
  }
  theme.clouds[index] = canvas;
  return canvas;
}

/* Behind the bridge: clouds and birds by day, stars, shooting stars and
   planes by night. Everything moves slowly so it never pulls the eye from
   the bridge, and nothing moves when the system asks for reduced motion. */
export function drawAmbient(ctx, view, scenery, theme, time) {
  const t = (still.matches ? 0 : time) + scenery.phase;
  const { width } = view;
  const band = Math.max(40, view.sy(0) * 0.7);
  const kinds = theme.ambient || [];

  if (kinds.includes('stars')) {
    for (let i = 0; i < 70; i++) {
      const x = R[i] * width, y = R[i + 100] * band;
      const twinkle = 0.5 + 0.5 * Math.sin(t * (0.8 + R[i + 200] * 2.2) + i);
      ctx.globalAlpha = 0.25 + 0.6 * twinkle * twinkle;
      ctx.fillStyle = '#eef2ff';
      const r = 0.35 + R[i + 300] * 0.65;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (kinds.includes('shooting')) {
    // One every 9 seconds or so, each in its own place.
    const n = Math.floor(t / 9), p = (t % 9) / 0.9;
    if (p < 1) {
      const x0 = R[n % 400] * width * 0.8 + width * 0.1, y0 = R[(n + 7) % 400] * band * 0.6;
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
    const period = 40, p = (t % period) / period;
    const x = -40 + p * (width + 80), y = band * 0.35 + Math.sin(p * 3) * 6;
    ctx.strokeStyle = '#b4bdc8';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - 4, y - 1); ctx.lineTo(x + 4, y); ctx.stroke();
    ctx.fillStyle = '#ed9c81';
    ctx.fillRect(x - 1, y + 1, 1.5, 1.5);
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
      const y = R[i + 70] * band - h / 2;
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
      const y0 = band * (0.3 + R[(n + 5) % 400] * 0.6);
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
  if (kinds.includes('raptors')) {
    // Two hawks circle at different heights, banking as they turn.
    ctx.strokeStyle = 'rgba(55, 51, 60, 0.72)';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const turn = t * (0.28 + 0.06 * i) + 2.8 * i;
      const x = width * (0.35 + 0.29 * i + Math.sin(turn) * 0.12);
      const y = band * (0.72 - 0.2 * i) + Math.cos(turn) * 9;
      const wing = 3.5 + 4.5 * Math.abs(Math.cos(turn));
      const tip = 1.5 * Math.sin(turn);
      ctx.beginPath(); ctx.moveTo(x - wing, y - tip);
      ctx.quadraticCurveTo(x - wing * 0.5, y - 2, x, y);
      ctx.quadraticCurveTo(x + wing * 0.5, y - 2, x + wing, y + tip);
      ctx.stroke();
    }
  }
  if (kinds.includes('leaves')) {
    for (let i = 0; i < 14; i++) {
      const drift = (R[i + 28] + t * (0.022 + 0.009 * R[i])) % 1;
      const x = ((R[i + 45] + 0.12 * drift) % 1) * width + Math.sin(t * 1.1 + i) * 10;
      const y = view.sy(0) * (0.56 + 0.44 * drift);
      ctx.globalAlpha = 0.74 * Math.sin(drift * Math.PI);
      ctx.fillStyle = i % 3 ? '#ac9a55' : '#cb834c';
      ctx.beginPath();
      ctx.ellipse(x, y, 2.9, 0.5 + Math.abs(Math.sin(t * 2 + i)), Math.cos(t + i), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (kinds.includes('dust')) {
    // Grains trace spirals around small travelling dust devils.
    ctx.fillStyle = theme.ui === 'dark' ? '#c3afb3' : '#f9deac';
    for (let i = 0; i < 3; i++) {
      const travel = (R[i + 90] + t * 0.018) % 1;
      const cx = width * travel, base = view.sy(0) - R[i + 100] * 4;
      const height = Math.min(32, view.scale * 1.1);
      ctx.globalAlpha = (theme.ui === 'dark' ? 0.32 : 0.65) * Math.sin(travel * Math.PI);
      for (let j = 0; j < 25; j++) {
        const rise = (R[j + i * 25] + t * 0.35) % 1;
        const spin = rise * 12 + t * 1.8 + i;
        const x = cx + rise * 12 + (2 + rise * 11) * Math.cos(spin);
        ctx.fillRect(x, base - rise * height + Math.sin(spin) * 2, 2.3, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
  if (kinds.includes('butterflies')) {
    for (let i = 0; i < 9; i++) {
      const x = (width + 24) * ((R[i + 60] + t * 0.008) % 1) - 12 + Math.sin(t * 1.6 + i) * 7;
      const y = view.sy(0) - 12 - R[i + 70] * 34 + Math.sin(t * 2.2 + i * 2.3) * 5;
      const wing = 0.7 + 2.6 * Math.abs(Math.cos(t * 9 + i));
      ctx.fillStyle = ['#fff3ad', '#ca9bd8', '#fffbe4'][i % 3];
      ctx.beginPath();
      ctx.ellipse(x - wing * 0.6, y - 1, wing, 2.4, -0.55, 0, Math.PI * 2);
      ctx.ellipse(x + wing * 0.6, y - 1, wing, 2.4, 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#665844';
      ctx.fillRect(x, y - 1, 1, 3);
    }
  }
  if (kinds.includes('fireflies')) {
    for (let i = 0; i < 24; i++) {
      const x = width * R[i + 100] + Math.sin(t * 0.8 + i) * 14;
      const y = view.sy(0) * (0.52 + 0.44 * R[i + 160]) + Math.sin(t * 1.1 + i * 2.7) * 6;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.5 + i * 1.7);
      ctx.fillStyle = 'rgba(240, 245, 152, 0.23)';
      ctx.globalAlpha = pulse * pulse;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff4b5';
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
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

/* Cache both shorelines in screen space until the camera changes. The water
   clip shares the exact points used for the near bank, including its bolts. */
function bankPaths(view, mission, scenery) {
  if (scenery.paths?.view === view) return scenery.paths;
  const ground = new Path2D(), rim = new Path2D(), ledges = new Path2D();
  const far = new Path2D(), farRim = new Path2D(), roads = new Path2D(), gorge = new Path2D();
  const x0 = Math.min(mission.left, Math.floor(view.wx(-8) * 10) / 10);
  const x1 = Math.max(mission.right, Math.ceil(view.wx(view.width + 8) * 10) / 10);
  const edge = view.height + 4;
  ground.moveTo(view.sx(x0), edge);
  far.moveTo(view.sx(x0), edge);
  gorge.moveTo(view.sx(mission.left), -5);
  let prevX, prevY;
  for (let i = Math.round(x0 * 10); i <= Math.round(x1 * 10); i++) {
    const x = i / 10, sx = view.sx(x), sy = view.sy(mission.ground(x));
    const farY = view.sy(scenery.farBank(x));
    ground.lineTo(sx, sy);
    far.lineTo(sx, farY);
    if (prevX == null) {
      rim.moveTo(sx, sy);
      farRim.moveTo(sx, farY);
    } else {
      rim.lineTo(sx, sy);
      farRim.lineTo(sx, farY);
      if (Math.abs(sy - prevY) < sx - prevX) {
        ledges.moveTo(prevX, prevY);
        ledges.lineTo(sx, sy);
      }
    }
    if (x >= mission.left && x <= mission.right) gorge.lineTo(sx, sy);
    if (prevX == null || x === mission.right) roads.moveTo(sx, sy);
    else if (x <= mission.left || x > mission.right) roads.lineTo(sx, sy);
    prevX = sx; prevY = sy;
  }
  ground.lineTo(view.sx(x1), edge); ground.closePath();
  far.lineTo(view.sx(x1), edge); far.closePath();
  gorge.lineTo(view.sx(mission.right), -5); gorge.closePath();
  scenery.paths = { view, ground, rim, ledges, far, farRim, roads, gorge };
  return scenery.paths;
}

export function drawGround(ctx, view, mission, scenery, theme, time) {
  const { ground, rim, ledges, far, farRim, roads } = bankPaths(view, mission, scenery);
  const top = view.sy(0);
  ctx.fillStyle = rockFill(ctx, view, theme);
  ctx.fill(far);
  ctx.fillStyle = rgba(theme.depth, 0.62);
  ctx.fill(far);
  ctx.strokeStyle = rgba(theme.surface[1], 0.8);
  ctx.lineWidth = 2;
  ctx.stroke(farRim);

  // Thin wisps of river mist move behind the piers and in front of the
  // opposite bank. Offset their cycles so the whole river never pulses.
  const t = still.matches ? 0 : time;
  const left = view.sx(mission.left), span = view.sx(mission.right) - left;
  const mist = cloudSprite(theme, 0);
  for (let i = 0; i < 4; i++) {
    const phase = (i * 0.29 + scenery.phase + t * (0.022 + i * 0.003)) % 1;
    const x = left + span * phase, y = view.sy(mission.water + 0.45 + i * 0.16);
    const w = span * (0.28 + i * 0.04), h = Math.max(8, w * 0.12);
    ctx.globalAlpha = 0.28 * Math.sin(phase * Math.PI);
    ctx.drawImage(mist, x - w / 2, y - h / 2, w, h);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = rockFill(ctx, view, theme);
  ctx.fill(ground);
  const shade = ctx.createLinearGradient(0, top, 0, Math.max(top + 1, view.height));
  shade.addColorStop(0, rgba(theme.depth, 0));
  shade.addColorStop(1, rgba(theme.depth, 0.6));
  ctx.fillStyle = shade;
  ctx.fill(ground);
  ctx.strokeStyle = theme.depth;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke(rim);
  ctx.save();
  ctx.translate(0, 3.75);
  ctx.strokeStyle = theme.surface[1];
  ctx.stroke(ledges);
  ctx.translate(0, -2.25);
  ctx.strokeStyle = theme.surface[0];
  ctx.stroke(ledges);
  ctx.restore();

  const h = Math.max(4, view.scale * 0.32);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#141620';
  ctx.lineWidth = h + 3;
  ctx.stroke(roads);
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = h;
  ctx.stroke(roads);
  ctx.save();
  ctx.translate(0, -h / 2 + 0.75);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke(roads);
  ctx.restore();
}

export function drawWater(ctx, view, mission, scenery, theme, time, reflect) {
  ctx.save();
  ctx.clip(bankPaths(view, mission, scenery).gorge);
  surfaceWater(ctx, view, mission, theme, still.matches ? 0 : time, reflect);
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
