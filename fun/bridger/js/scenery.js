/* Scenery in 16-bit pixel art: a painted backdrop per world, rock that
   follows the river's ground line, and a living river. Every colour sits in
   cool, muted blues and violets, so the bridge's green-to-red stress
   colours, the materials and the bright vehicles always stand out. The art
   was generated for this game (see ../assets/CREDITS.md) and snapped to a
   pixel grid. Only the ground line has to match the physics. */

const image = (name) => {
  const img = new Image();
  img.src = new URL(`../assets/${name}.png`, import.meta.url).href;
  return img;
};
const ready = (img) => img.complete && img.naturalWidth > 0;

/* Each river gets one of these worlds from its seed. */
export const THEMES = {
  // skyTop is the colour of each backdrop's top row, to fill the sky above it.
  valley: {
    name: 'Valley', ui: 'light', sky: image('sky-valley'), skyTop: '#a7bde1', rock: image('rock-valley'),
    rockColor: '#6c7596', surface: ['#c9d1e6', '#8a93b3'], depth: '#1c2236',
    water: { surface: '#7d93c4', deep: '#1f2a4d', glint: '#eef2ff' },
    road: '#3d4152', grid: 'rgba(30, 36, 64, 0.5)',
  },
  mesa: {
    name: 'Mesa', ui: 'dark', sky: image('sky-mesa'), skyTop: '#232877', rock: image('rock-mesa'),
    rockColor: '#5d4f86', surface: ['#a294c9', '#6b5d97'], depth: '#16122e',
    water: { surface: '#6c62a8', deep: '#191438', glint: '#e8e2ff' },
    road: '#2e2a40', grid: 'rgba(240, 236, 255, 0.55)',
  },
  snow: {
    name: 'Snow', ui: 'light', sky: image('sky-snow'), skyTop: '#abd6fd', rock: image('rock-snow'),
    rockColor: '#7f93ad', surface: ['#f4f8ff', '#b9c8dc'], depth: '#1f2d45',
    water: { surface: '#7fb0d8', deep: '#1a3352', glint: '#ffffff' },
    road: '#3e4554', grid: 'rgba(25, 45, 75, 0.5)',
  },
  night: {
    name: 'Night', ui: 'dark', sky: image('sky-night'), skyTop: '#0d214c', rock: image('rock-night'),
    rockColor: '#3b4466', surface: ['#7c88b4', '#46507a'], depth: '#090c1c',
    water: { surface: '#3d4f8c', deep: '#0a1028', glint: '#d8e2ff' },
    road: '#2a2e3d', grid: 'rgba(220, 230, 255, 0.5)',
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
  return { theme };
}

/* The rock texture as a pattern with one texel per game pixel. */
function rockFill(ctx, view, theme) {
  if (!ready(theme.rock)) return theme.rockColor;
  theme.pattern ||= ctx.createPattern(theme.rock, 'repeat');
  theme.pattern.setTransform(new DOMMatrix().scale(view.pixel || 1));
  return theme.pattern;
}

export function drawBackdrop(ctx, view, scenery, theme) {
  const { width, height } = view;
  ctx.fillStyle = theme.skyTop;
  ctx.fillRect(0, 0, width, height);
  if (!ready(theme.sky)) return;
  // Whole game pixels only: one backdrop pixel is one (or a few) screen pixels.
  const px = view.pixel || 1;
  const k = px * Math.max(1, Math.ceil(width / (theme.sky.naturalWidth * px)));
  const w = theme.sky.naturalWidth * k, h = theme.sky.naturalHeight * k;
  const bottom = view.sy(0) + px * 2;
  ctx.drawImage(theme.sky, Math.round((width - w) / 2), Math.round(bottom - h), w, h);
}

export function drawGround(ctx, view, mission, scenery, theme) {
  const px = view.pixel || 1;
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

  // A lit top edge on ground you could stand on (not on cliff faces): two
  // pixels of surface over one of shadow.
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
  ctx.lineWidth = Math.max(view.pixel || 1, view.scale * 0.06);
  ctx.lineCap = 'butt';
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
  ctx.lineWidth = Math.max(view.pixel || 1, view.scale * 0.07);
  ctx.strokeStyle = rgba(glint, 0.75);
  ctx.beginPath();
  for (let px = x0; px <= x1; px += 4) px === x0 ? ctx.moveTo(px, wave(px)) : ctx.lineTo(px, wave(px));
  ctx.stroke();
}
