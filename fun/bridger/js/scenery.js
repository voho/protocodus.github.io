/* Low-poly scenery: faceted mountains, rock and water built once per river
   from its seed, and drawn in one of a few looks. Only the ground line has to
   match the physics; everything else is decoration. */
import { createRng } from '../../shared/rng.js';

export const THEMES = {
  meadow: {
    name: 'Meadow', ui: 'dark',
    sky: ['#4fa7e6', '#bfe7f6'], sun: '#fff3b8', cloud: ['#ffffff', '#e4f1f8'],
    far: ['#8fc9b4', '#74b29d'], near: ['#6fb37a', '#559a63'],
    grass: ['#6cc46a', '#58b05a'], rock: ['#a7825a', '#6f5038'], wet: '#7b6a52',
    water: ['rgba(64, 170, 214, 0.82)', 'rgba(22, 84, 140, 0.94)'], foam: '#e8f8ff',
    tree: ['#3f9d55', '#2f8446', '#6b4a2e'], road: '#4a4f58', grid: 'rgba(255, 255, 255, 0.45)', trees: 'round',
  },
  sunset: {
    name: 'Sunset', ui: 'dark',
    sky: ['#3b2d6b', '#ff9e6d'], sun: '#ffd27a', cloud: ['#ffb38a', '#e58a7a'],
    far: ['#8a5a9c', '#6c467f'], near: ['#5b3a6e', '#47295a'],
    grass: ['#8a6b3f', '#77592f'], rock: ['#9c5f4c', '#4e2c33'], wet: '#5c3a3c',
    water: ['rgba(255, 150, 110, 0.7)', 'rgba(70, 40, 100, 0.94)'], foam: '#ffd9c2',
    tree: ['#3b2448', '#2b1a36', '#2b1a36'], road: '#3a3140', grid: 'rgba(255, 230, 210, 0.45)', trees: 'pine',
  },
  alpine: {
    name: 'Alpine', ui: 'light',
    sky: ['#9fd0f2', '#eef8fd'], sun: '#ffffff', cloud: ['#ffffff', '#e9f2f8'],
    far: ['#c4d6e6', '#9fb6cb'], near: ['#8aa6b8', '#6f8ca0'], snow: '#ffffff',
    grass: ['#eef6fb', '#d9e8f1'], rock: ['#8f9aa6', '#4d5865'], wet: '#5f6b77',
    water: ['rgba(120, 200, 225, 0.8)', 'rgba(30, 90, 130, 0.94)'], foam: '#ffffff',
    tree: ['#2f6b57', '#24574a', '#5b4636'], road: '#4d535c', grid: 'rgba(40, 70, 100, 0.4)', trees: 'pine',
  },
  canyon: {
    name: 'Canyon', ui: 'light',
    sky: ['#79c3e8', '#f6e7c8'], sun: '#fff2c4', cloud: ['#ffffff', '#f3e6d6'],
    far: ['#e0a676', '#c98a5c'], near: ['#c46d45', '#a85634'], mesa: true,
    grass: ['#e7b77a', '#d9a565'], rock: ['#d0784a', '#7e3a24'], wet: '#8f5a3c',
    water: ['rgba(60, 190, 180, 0.82)', 'rgba(20, 100, 110, 0.94)'], foam: '#e9fffb',
    tree: ['#5f9a4c', '#4b833b', '#5f9a4c'], road: '#5a4d48', grid: 'rgba(90, 40, 20, 0.4)', trees: 'cactus',
  },
  blueprint: {
    name: 'Blueprint', ui: 'dark', outline: true,
    sky: ['#0f3a66', '#174d80'], sun: null, cloud: null,
    far: ['#1d5a91', '#1a5287'], near: ['#20619c', '#1c5891'],
    grass: ['#2b74b4', '#2b74b4'], rock: ['#1f5d97', '#173f6b'], wet: '#1a4a7a',
    water: ['rgba(120, 200, 255, 0.28)', 'rgba(60, 140, 220, 0.35)'], foam: '#bfe4ff',
    tree: ['#2b74b4', '#2b74b4', '#2b74b4'], road: '#dbe9f7', grid: 'rgba(200, 230, 255, 0.5)', trees: 'pine',
  },
};

const mix = (a, b, t) => {
  const pa = parse(a), pb = parse(b);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
};
const parse = (c) => (c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.match(/[\d.]+/g).slice(0, 3).map(Number));
const shade = (c, k) => {
  const p = parse(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${p.join(',')})`;
};

/* Triangles in world metres: { pts: [x0, y0, x1, y1, x2, y2], color }. */
export function buildScenery(mission, theme) {
  const rng = createRng(`${mission.seed}:scenery`);
  const { left, right, ground } = mission;
  const xs = new Set();
  for (let x = left - 90; x <= right + 90; x += 3.2) xs.add(Math.round(x * 100) / 100);
  for (let x = left; x <= right; x += 1.1) xs.add(Math.round(x * 100) / 100);
  for (const x of [left, left + 0.02, right - 0.02, right]) xs.add(x);
  if (mission.feature) {
    for (let x = mission.feature.x0 * 2 - 5; x <= mission.feature.x1 * 2 + 5; x += 0.45) xs.add(Math.round(x * 100) / 100);
  }
  const columns = [...xs].sort((a, b) => a - b);
  const depths = [0, 0.45, 2.4, 5, 8.5, 13, 200];
  const jitter = columns.map(() => depths.map((d, k) => (k >= 2 ? (rng.next() - 0.5) * 1.6 : 0)));
  const vertex = (c, k) => [columns[c], ground(columns[c]) - depths[k] + jitter[c][k]];
  const terrain = [];
  for (let c = 0; c < columns.length - 1; c++) {
    const midX = (columns[c] + columns[c + 1]) / 2;
    const top = Math.min(ground(columns[c]), ground(columns[c + 1]));
    const onTop = top > -0.05 || (mission.feature && Math.abs(top - mission.feature.top * 2) < 0.05 && midX > left && midX < right);
    for (let k = 0; k < depths.length - 1; k++) {
      const a = vertex(c, k), b = vertex(c + 1, k), d = vertex(c, k + 1), e = vertex(c + 1, k + 1);
      const fraction = Math.min(1, (depths[k] + 1) / 14);
      let base = mix(theme.rock[0], theme.rock[1], fraction);
      if (k === 0) base = onTop ? theme.grass[c % 2] : theme.wet;
      const wobble = () => 0.9 + rng.next() * 0.2;
      terrain.push({ pts: [...a, ...b, ...d], color: shade(base, wobble()) });
      terrain.push({ pts: [...b, ...e, ...d], color: shade(base, wobble() * 0.93) });
    }
  }

  // Two ridges of faceted mountains behind the valley.
  const ridges = [];
  for (const [layer, height, step] of [[0, 10, 12], [1, 5.5, 8]]) {
    let x = left - 110;
    let prev = [x, 0];
    while (x < right + 110) {
      x += step * (0.7 + rng.next() * 0.7);
      const peak = [x - step * 0.45, height * (0.45 + rng.next() * 0.7)];
      const valley = [x, height * 0.12 * rng.next()];
      const colors = theme[layer ? 'near' : 'far'];
      // Lit face on the left of every peak, shaded on the right.
      ridges.push({ pts: [...prev, ...peak, peak[0], 0], color: colors[0], layer, peak });
      ridges.push({ pts: [peak[0], 0, ...peak, ...valley], color: colors[1], layer });
      ridges.push({ pts: [...prev, peak[0], 0, ...valley], color: colors[1], layer, base: true });
      prev = valley;
    }
  }

  // The far side of the gorge, so the space under the bridge isn't empty sky.
  const backwall = [];
  for (let x = left - 1; x < right + 1; x += 2.2) {
    const y0 = -0.3 - rng.next() * 0.8, y1 = -0.3 - rng.next() * 0.8;
    const mid = mission.water - 0.5;
    backwall.push({ pts: [x, y0, x + 2.2, y1, x + 1.1, mid], color: shade(mix(theme.rock[0], theme.far[1], 0.55), 0.92 + rng.next() * 0.16) });
    backwall.push({ pts: [x, y0, x + 1.1, mid, x - 1.1, mid], color: shade(mix(theme.rock[1], theme.far[1], 0.5), 0.92 + rng.next() * 0.16) });
  }

  const trees = [];
  const plant = (x, y, scale) => trees.push({ x, y, s: scale * (0.8 + rng.next() * 0.5), lean: (rng.next() - 0.5) * 0.15 });
  for (let i = 0; i < 9; i++) {
    plant(left - 10 - rng.next() * 40, 0, 1);
    plant(right + 10 + rng.next() * 40, 0, 1);
  }
  if (mission.feature?.kind === 'island' && mission.feature.x1 - mission.feature.x0 >= 2) {
    plant((mission.feature.x0 + mission.feature.x1) + 0.4, mission.feature.top * 2, 0.7);
  }

  const clouds = Array.from({ length: 6 }, (_, i) => ({ x: rng.next(), y: 0.08 + rng.next() * 0.26, s: 0.7 + rng.next() * 0.7, speed: 3 + i * 1.3 }));
  return { terrain, ridges, backwall, trees, clouds, sunX: 0.62 + rng.next() * 0.25 };
}

function poly(ctx, view, pts, color, outline) {
  ctx.beginPath();
  ctx.moveTo(view.sx(pts[0]), view.sy(pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(view.sx(pts[i]), view.sy(pts[i + 1]));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) { ctx.strokeStyle = outline; ctx.stroke(); }
  // Hairline seams between facets show through without this.
  else { ctx.strokeStyle = color; ctx.lineWidth = 0.6; ctx.stroke(); }
}

export function drawBackdrop(ctx, view, scenery, theme, time) {
  const { width, height } = view;
  const g = ctx.createLinearGradient(0, 0, 0, view.sy(0));
  g.addColorStop(0, theme.sky[0]);
  g.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  if (theme.outline) {
    // Blueprint paper: a fine square grid over the whole sheet.
    ctx.strokeStyle = 'rgba(190, 225, 255, 0.08)';
    ctx.lineWidth = 1;
    const step = view.scale * 2;
    ctx.beginPath();
    for (let x = view.ox % step; x < width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = view.oy % step; y < height; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
  }
  const r = Math.min(width, height) * 0.06;
  if (theme.sun) {
    const cx = width * scenery.sunX, cy = theme.name === 'Sunset' ? view.sy(9) : height * 0.18;
    ctx.fillStyle = theme.sun;
    ctx.globalAlpha = 0.25;
    regular(ctx, cx, cy, r * 1.6, 8, time * 0.05);
    ctx.globalAlpha = 1;
    regular(ctx, cx, cy, r, 8, 0);
  }
  if (theme.cloud) {
    for (const c of scenery.clouds) {
      const s = r * c.s;
      const cx = ((c.x * (width + 300)) + time * c.speed) % (width + 300) - 150;
      const cy = height * c.y;
      ctx.fillStyle = theme.cloud[1];
      ctx.beginPath();
      ctx.moveTo(cx - s * 2, cy + s * 0.5);
      ctx.lineTo(cx + s * 2.1, cy + s * 0.5);
      ctx.lineTo(cx + s * 1.3, cy - s * 0.3);
      ctx.lineTo(cx - s * 1.4, cy - s * 0.2);
      ctx.fill();
      ctx.fillStyle = theme.cloud[0];
      ctx.beginPath();
      ctx.moveTo(cx - s * 1.4, cy - s * 0.2);
      ctx.lineTo(cx - s * 0.6, cy - s * 0.9);
      ctx.lineTo(cx + s * 0.4, cy - s * 1.1);
      ctx.lineTo(cx + s * 1.3, cy - s * 0.3);
      ctx.fill();
    }
  }
  const outline = theme.outline ? 'rgba(210, 235, 255, 0.55)' : null;
  ctx.lineWidth = 1;
  for (const t of scenery.ridges) {
    let pts = t.pts;
    if (theme.mesa && t.peak) {
      // Canyon country: flat-topped mesas instead of peaks.
      pts = [pts[0], pts[1], pts[2] - 2, pts[3] * 0.8, pts[2] + 1.5, pts[3] * 0.8, pts[4], pts[5]];
    }
    poly(ctx, view, pts.map((v, i) => (i % 2 ? v + 0.6 : v)), t.color, outline);
    if (theme.snow && t.peak && t.layer === 0 && t.peak[1] > 9) {
      const [px, py] = t.peak;
      poly(ctx, view, [px, py + 0.6, px - 2.2, py - 2.4, px + 1.8, py - 2.6], theme.snow, null);
    }
  }
}

function regular(ctx, cx, cy, r, sides, turn) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = turn + (i / sides) * Math.PI * 2;
    i ? ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawGround(ctx, view, mission, scenery, theme) {
  const outline = theme.outline ? 'rgba(210, 235, 255, 0.35)' : null;
  ctx.lineWidth = 1;
  for (const t of scenery.backwall) poly(ctx, view, t.pts, t.color, outline);
  for (const t of scenery.terrain) poly(ctx, view, t.pts, t.color, outline);
  // The road on both banks.
  const h = Math.max(3, view.scale * 0.35);
  ctx.fillStyle = theme.road;
  ctx.fillRect(-10, view.sy(0) - h, view.sx(mission.left) + 10, h);
  ctx.fillRect(view.sx(mission.right), view.sy(0) - h, view.width + 10, h);
  for (const tree of scenery.trees) drawTree(ctx, view, tree, theme);
}

function drawTree(ctx, view, { x, y, s, lean }, theme) {
  const [a, b, trunk] = theme.tree;
  const outline = theme.outline ? 'rgba(210, 235, 255, 0.6)' : null;
  const P = (dx, dy) => [x + dx * s + dy * lean, y + dy * s];
  const tri = (p, q, r, color) => poly(ctx, view, [...p, ...q, ...r], color, outline);
  if (theme.trees === 'cactus') {
    poly(ctx, view, [...P(-0.3, 0), ...P(0.3, 0), ...P(0.3, 3.2), ...P(-0.3, 3.2)], a, outline);
    poly(ctx, view, [...P(0.3, 1.4), ...P(1, 1.4), ...P(1, 2.4), ...P(0.75, 2.4), ...P(0.75, 1.8), ...P(0.3, 1.8)], b, outline);
    poly(ctx, view, [...P(-0.3, 1.8), ...P(-0.9, 1.8), ...P(-0.9, 2.7), ...P(-0.65, 2.7), ...P(-0.65, 2.2), ...P(-0.3, 2.2)], b, outline);
    return;
  }
  poly(ctx, view, [...P(-0.15, 0), ...P(0.15, 0), ...P(0.15, 1), ...P(-0.15, 1)], trunk, outline);
  if (theme.trees === 'pine') {
    for (const [base, top, w] of [[0.8, 3, 1.3], [1.8, 3.9, 1.05], [2.8, 4.7, 0.8]]) {
      tri(P(-w, base), P(0, top), P(0, base), a);
      tri(P(0, base), P(0, top), P(w, base), b);
    }
  } else {
    const c = P(0, 2.2);
    const pts = Array.from({ length: 6 }, (_, i) => P(Math.cos(i * Math.PI / 3 + 0.3) * 1.25, 2.2 + Math.sin(i * Math.PI / 3 + 0.3) * 1.25));
    for (let i = 0; i < 6; i++) tri(c, pts[i], pts[(i + 1) % 6], i < 3 ? a : b);
  }
}

export function drawWater(ctx, view, mission, theme, time) {
  const x0 = mission.left, x1 = mission.right;
  const step = 1.6;
  const wave = (x) => mission.water + Math.sin(x * 0.7 + time * 1.8) * 0.1 + Math.sin(x * 1.7 - time * 2.6) * 0.05;
  const band = mission.water - 1.1;
  const bottom = view.wy(view.height + 10);
  poly(ctx, view, [x0, band, x1, band, x1, bottom, x0, bottom], theme.water[1], null);
  // A strip of facets along the surface, light and dark in turn.
  const light = theme.water[0], dark = mix(parse(theme.water[0]).length ? theme.water[0] : light, theme.water[1], 0.45);
  for (let x = x0, i = 0; x < x1 - 1e-6; x += step, i++) {
    const xb = Math.min(x1, x + step), xm = (x + xb) / 2;
    const lo = band + Math.sin(xm * 1.9 + time * 0.8) * 0.25;
    poly(ctx, view, [x, wave(x), xb, wave(xb), xm, lo], i % 2 ? light : dark, null);
    poly(ctx, view, [x, wave(x), xm, lo, x, band], i % 2 ? dark : light, null);
    poly(ctx, view, [xb, wave(xb), xb, band, xm, lo], i % 2 ? dark : light, null);
  }
  ctx.strokeStyle = theme.foam;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = x0; x <= x1 + 1e-6; x += step / 2) {
    const px = view.sx(Math.min(x, x1)), py = view.sy(wave(Math.min(x, x1)));
    x === x0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
}
