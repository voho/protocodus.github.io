/* Low-poly scenery: faceted hills and rock built once per river from its
   seed, drawn quietly behind the bridge. Everything far away fades into the
   sky's haze so the bridge, the vehicle and the stress colours stay in front.
   Only the ground line has to match the physics; the rest is decoration. */
import { createRng } from '../../shared/rng.js';

/* Each river gets one of these worlds from its seed. The scenery stays in
   quiet, low-chroma greys so none of it competes with what matters: the
   stress colours (green, yellow, red), the materials (wood brown, steel blue,
   red bolts) and the brightly painted vehicles. */
export const THEMES = {
  meadow: {
    name: 'Meadow', ui: 'dark',
    sky: ['#aebfca', '#e4eaed'], sun: '#fbf8ee', cloud: '#ffffff',
    far: '#bcc8ce', near: '#a5b3b6',
    grass: '#a3ada4', rock: ['#9a9a95', '#5d6062'],
    water: { surface: '#7f98a3', deep: '#2b3b45', glint: '#f2f6f8' },
    tree: ['#8b978f', '#7a867f', '#6a6560'], trees: 'round',
    road: '#4a4e55', grid: 'rgba(255, 255, 255, 0.6)',
  },
  sunset: {
    name: 'Sunset', ui: 'dark',
    sky: ['#8f8c9c', '#ddd5cf'], sun: '#fbf1e2', cloud: '#f4ece8',
    far: '#b6afb3', near: '#9c969d',
    grass: '#9d968e', rock: ['#958c85', '#4d494c'],
    water: { surface: '#8a8c9a', deep: '#2b2c3a', glint: '#f6efe8' },
    tree: ['#7f7a80', '#6e6a71', '#5d5759'], trees: 'pine',
    road: '#45434a', grid: 'rgba(255, 250, 245, 0.6)',
  },
  alpine: {
    name: 'Alpine', ui: 'light',
    sky: ['#c3cfd8', '#f0f3f5'], sun: '#ffffff', cloud: '#ffffff',
    far: '#d1d8de', near: '#b8c1c8', snow: '#fbfcfd',
    grass: '#e3e8eb', rock: ['#a2a8ad', '#5d6369'],
    water: { surface: '#8aa1ac', deep: '#2a3a45', glint: '#ffffff' },
    tree: ['#8c9893', '#7b8782', '#6b6662'], trees: 'pine',
    road: '#4d5258', grid: 'rgba(40, 55, 70, 0.42)',
  },
  canyon: {
    name: 'Canyon', ui: 'light',
    sky: ['#c9ced1', '#eee9e2'], sun: '#fdf9f0', cloud: '#ffffff',
    far: '#d6cdc4', near: '#c1b5aa', mesa: true,
    grass: '#c9bdae', rock: ['#b2a698', '#685f58'],
    water: { surface: '#8ea2a1', deep: '#2c4140', glint: '#f4faf9' },
    tree: ['#949a8f', '#858b80', '#949a8f'], trees: 'cactus',
    road: '#55504c', grid: 'rgba(70, 55, 45, 0.42)',
  },
};
export const THEME_IDS = Object.keys(THEMES);

const parse = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const pa = parse(a), pb = parse(b);
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const shade = (c, k) => `#${parse(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('')}`;
const rgba = (c, a) => `rgba(${parse(c).join(',')},${a})`;

/* Triangles in world metres: { pts: [x0, y0, x1, y1, x2, y2], color }. */
export function buildScenery(mission, theme) {
  const rng = createRng(`${mission.seed}:scenery`);
  const { left, right, ground } = mission;
  const haze = theme.sky[1];

  // Rock: columns of quads down from the ground line, gently jittered and
  // darkening with depth, with only a few percent of shade between facets.
  const xs = new Set();
  for (let x = left - 90; x <= right + 90; x += 3.4) xs.add(Math.round(x * 100) / 100);
  for (let x = left; x <= right; x += 1.3) xs.add(Math.round(x * 100) / 100);
  for (const x of [left, left + 0.02, right - 0.02, right]) xs.add(x);
  if (mission.feature) {
    for (let x = mission.feature.x0 * 2 - 5; x <= mission.feature.x1 * 2 + 5; x += 0.5) xs.add(Math.round(x * 100) / 100);
  }
  const columns = [...xs].sort((a, b) => a - b);
  const depths = [0, 0.5, 2.6, 5.5, 9.5, 15, 200];
  const jitter = columns.map(() => depths.map((d, k) => (k >= 2 ? (rng.next() - 0.5) * 1.4 : 0)));
  const vertex = (c, k) => [columns[c], ground(columns[c]) - depths[k] + jitter[c][k]];
  const terrain = [];
  for (let c = 0; c < columns.length - 1; c++) {
    const midX = (columns[c] + columns[c + 1]) / 2;
    const top = Math.min(ground(columns[c]), ground(columns[c + 1]));
    const onTop = top > -0.05 || (mission.feature && Math.abs(top - mission.feature.top * 2) < 0.05 && midX > left && midX < right);
    for (let k = 0; k < depths.length - 1; k++) {
      const a = vertex(c, k), b = vertex(c + 1, k), d = vertex(c, k + 1), e = vertex(c + 1, k + 1);
      let base = mix(theme.rock[0], theme.rock[1], Math.min(1, depths[k] / 16));
      if (k === 0) base = onTop ? theme.grass : shade(theme.rock[0], 0.82);
      const facet = () => 0.96 + rng.next() * 0.08;
      terrain.push({ pts: [...a, ...b, ...d], color: shade(base, facet() * 1.02) });
      terrain.push({ pts: [...b, ...e, ...d], color: shade(base, facet() * 0.97) });
    }
  }

  // Two ridges of hills, washed towards the horizon colour.
  const ridges = [];
  for (const [layer, height, step, wash] of [[0, 8, 13, 0.55], [1, 4.2, 9, 0.3]]) {
    const color = mix(theme[layer ? 'near' : 'far'], haze, wash);
    let x = left - 120;
    let prev = [x, 0];
    while (x < right + 120) {
      x += step * (0.75 + rng.next() * 0.6);
      const peak = [x - step * 0.45, height * (0.5 + rng.next() * 0.6)];
      const valley = [x, height * 0.15 * rng.next()];
      // Lit face on the left of every peak, a touch darker on the right.
      ridges.push({ pts: [...prev, ...peak, peak[0], 0], color: shade(color, 1.03), layer, peak });
      ridges.push({ pts: [peak[0], 0, ...peak, ...valley], color: shade(color, 0.95), layer });
      ridges.push({ pts: [...prev, peak[0], 0, ...valley], color: shade(color, 0.95), layer });
      prev = valley;
    }
  }

  // The far wall of the gorge: one soft plane, so the space under the
  // bridge reads as depth rather than empty sky.
  const wall = [];
  for (let x = left - 1; x <= right + 1.01; x += 1.6) wall.push([x, -0.2 - rng.next() * 0.5]);

  const trees = [];
  const plant = (x, y, scale) => trees.push({ x, y, s: scale * (0.75 + rng.next() * 0.4), lean: (rng.next() - 0.5) * 0.1, far: rng.chance(0.5) });
  for (let i = 0; i < 6; i++) {
    plant(left - 11 - rng.next() * 40, 0, 1);
    plant(right + 11 + rng.next() * 40, 0, 1);
  }
  if (mission.feature?.kind === 'island' && mission.feature.x1 - mission.feature.x0 >= 2) {
    plant((mission.feature.x0 + mission.feature.x1) + 0.4, mission.feature.top * 2, 0.6);
  }

  const clouds = Array.from({ length: 4 }, (_, i) => ({ x: rng.next(), y: 0.06 + rng.next() * 0.2, s: 0.6 + rng.next() * 0.6, speed: 2 + i * 0.9 }));
  return { terrain, ridges, wall, trees, clouds, sunX: 0.64 + rng.next() * 0.22 };
}

function poly(ctx, view, pts, color) {
  ctx.beginPath();
  ctx.moveTo(view.sx(pts[0]), view.sy(pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(view.sx(pts[i]), view.sy(pts[i + 1]));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  // Hairline seams between facets show through without this.
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.75;
  ctx.stroke();
}

export function drawBackdrop(ctx, view, scenery, theme, time) {
  const { width, height } = view;
  const horizon = view.sy(0);
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, theme.sky[0]);
  g.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // A soft sun: a glow, then a small disc.
  const r = Math.min(width, height) * 0.035;
  const sx = width * scenery.sunX, sy = theme.name === 'Sunset' ? horizon - r * 3 : height * 0.17;
  const glow = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, r * 7);
  glow.addColorStop(0, rgba(theme.sun, 0.4));
  glow.addColorStop(1, rgba(theme.sun, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(sx - r * 7, sy - r * 7, r * 14, r * 14);
  ctx.fillStyle = theme.sun;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = rgba(theme.cloud, 0.4);
  for (const c of scenery.clouds) {
    const s = r * 1.4 * c.s;
    const cx = ((c.x * (width + 300)) + time * c.speed) % (width + 300) - 150;
    const cy = height * c.y;
    ctx.beginPath();
    ctx.moveTo(cx - s * 2.2, cy + s * 0.4);
    ctx.lineTo(cx - s * 1.3, cy - s * 0.3);
    ctx.lineTo(cx - s * 0.3, cy - s * 0.85);
    ctx.lineTo(cx + s * 0.8, cy - s * 0.55);
    ctx.lineTo(cx + s * 1.5, cy - s * 0.1);
    ctx.lineTo(cx + s * 2.3, cy + s * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  for (const t of scenery.ridges) {
    let pts = t.pts;
    if (theme.mesa && t.peak) {
      // Canyon country: flat-topped mesas instead of peaks.
      pts = [pts[0], pts[1], pts[2] - 2, pts[3] * 0.82, pts[2] + 1.5, pts[3] * 0.82, pts[4], pts[5]];
    }
    poly(ctx, view, pts, t.color);
    if (theme.snow && t.peak && t.layer === 0 && t.peak[1] > 6) {
      const [px, py] = t.peak;
      poly(ctx, view, [px, py, px - 1.6, py - 1.7, px + 1.3, py - 1.9], mix(theme.snow, theme.sky[1], 0.25));
    }
  }
  // Haze where the hills meet the land.
  const mist = ctx.createLinearGradient(0, horizon - view.scale * 3, 0, horizon);
  mist.addColorStop(0, rgba(theme.sky[1], 0));
  mist.addColorStop(1, rgba(theme.sky[1], 0.55));
  ctx.fillStyle = mist;
  ctx.fillRect(0, horizon - view.scale * 3, width, view.scale * 3);
}

export function drawGround(ctx, view, mission, scenery, theme) {
  // Far wall of the gorge, fading down into shadow.
  const top = view.sy(0), bottom = view.sy(mission.water);
  const wall = ctx.createLinearGradient(0, top, 0, bottom);
  wall.addColorStop(0, mix(theme.rock[0], theme.sky[1], 0.45));
  wall.addColorStop(1, mix(theme.rock[1], theme.sky[1], 0.25));
  ctx.fillStyle = wall;
  ctx.beginPath();
  ctx.moveTo(view.sx(scenery.wall[0][0]), bottom + 4);
  for (const [x, y] of scenery.wall) ctx.lineTo(view.sx(x), view.sy(y));
  ctx.lineTo(view.sx(scenery.wall[scenery.wall.length - 1][0]), bottom + 4);
  ctx.fill();

  for (const tree of scenery.trees) if (tree.far) drawTree(ctx, view, tree, theme, true);
  for (const t of scenery.terrain) poly(ctx, view, t.pts, t.color);
  // The road on both banks, with a lit top edge.
  const h = Math.max(3, view.scale * 0.32);
  for (const [x0, x1] of [[-10, view.sx(mission.left)], [view.sx(mission.right), view.width + 10]]) {
    ctx.fillStyle = theme.road;
    ctx.fillRect(x0, top - h, x1 - x0, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(x0, top - h, x1 - x0, Math.max(1, h * 0.18));
  }
  for (const tree of scenery.trees) if (!tree.far) drawTree(ctx, view, tree, theme, false);
}

function drawTree(ctx, view, { x, y, s, lean }, theme, far) {
  let [a, b, trunk] = theme.tree;
  if (far) { a = mix(a, theme.sky[1], 0.45); b = mix(b, theme.sky[1], 0.45); trunk = mix(trunk, theme.sky[1], 0.45); s *= 0.8; }
  const P = (dx, dy) => [x + dx * s + dy * lean, y + dy * s];
  const tri = (p, q, r, color) => poly(ctx, view, [...p, ...q, ...r], color);
  if (theme.trees === 'cactus') {
    poly(ctx, view, [...P(-0.28, 0), ...P(0.28, 0), ...P(0.28, 3), ...P(-0.28, 3)], a);
    poly(ctx, view, [...P(0.28, 1.3), ...P(0.95, 1.3), ...P(0.95, 2.3), ...P(0.7, 2.3), ...P(0.7, 1.7), ...P(0.28, 1.7)], b);
    poly(ctx, view, [...P(-0.28, 1.7), ...P(-0.85, 1.7), ...P(-0.85, 2.6), ...P(-0.6, 2.6), ...P(-0.6, 2.1), ...P(-0.28, 2.1)], b);
    return;
  }
  poly(ctx, view, [...P(-0.13, 0), ...P(0.13, 0), ...P(0.13, 1), ...P(-0.13, 1)], trunk);
  if (theme.trees === 'pine') {
    for (const [base, top, w] of [[0.8, 3, 1.2], [1.8, 3.8, 0.95], [2.8, 4.6, 0.7]]) {
      tri(P(-w, base), P(0, top), P(0, base), a);
      tri(P(0, base), P(0, top), P(w, base), b);
    }
  } else {
    const c = P(0, 2.1);
    const pts = Array.from({ length: 7 }, (_, i) => P(Math.cos(i * Math.PI * 2 / 7 + 0.3) * 1.15, 2.1 + Math.sin(i * Math.PI * 2 / 7 + 0.3) * 1.15));
    for (let i = 0; i < 7; i++) tri(c, pts[i], pts[(i + 1) % 7], i < 3 || i === 6 ? a : b);
  }
}

/* The river: a clear body that darkens with depth, a reflection of the
   bridge (drawn by the caller, mirrored), and light glinting on the ripples. */
export function drawWater(ctx, view, mission, theme, time, reflect) {
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
