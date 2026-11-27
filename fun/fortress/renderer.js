import { createEffects } from './effects.js';
import { sprite, sampleSprite, spriteReady, prepareSprites } from './sprites.js';
import { paintTerrain } from './terrain.js';

// All scene art uses world pixels, including the moving bodies and their fracture pieces.
const WIDTH = 1200;
const HEIGHT = 480;
const GROUND = 389;
const TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function polygon(ctx, fill, coords, stroke, lineWidth = 1) {
  ctx.beginPath();
  for (let i = 0; i < coords.length; i += 2) {
    if (!i) ctx.moveTo(coords[i], coords[i + 1]);
    else ctx.lineTo(coords[i], coords[i + 1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function line(ctx, color, width, ...coords) {
  ctx.beginPath();
  ctx.moveTo(coords[0], coords[1]);
  for (let i = 2; i < coords.length; i += 2) ctx.lineTo(coords[i], coords[i + 1]);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'bevel';
  ctx.stroke();
}

function ellipse(ctx, color, x, y, rx, ry) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function randomSequence(seed) {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rock(ctx, r, big = false) {
  ctx.save();
  ctx.scale(r / 16, r / 16);
  const silhouette = big
    ? [-16, 6, -15, -4, -9, -12, -4, -14, 5, -14, 13, -9, 16, -2, 15, 7, 9, 13, -4, 15, -12, 12]
    : [-15, 5, -13, -5, -6, -12, 4, -14, 12, -9, 16, 1, 13, 9, 5, 13, -7, 13, -13, 10];
  polygon(ctx, '#788783', silhouette, '#2c3634', 2.5);
  polygon(ctx, '#adb3a1', [-12, -5, -6, -11, 4, -12, 8, -9, 1, -7, -5, -3, -13, 1]);
  polygon(ctx, '#929e96', [-12, 1, -6, -3, 1, -6, 7, -3, 6, 3, -2, 6, -10, 6]);
  polygon(ctx, '#697875', [1, -6, 8, -9, 12, -7, 15, 0, 11, 4, 6, 3, 7, -3]);
  polygon(ctx, '#505f5e', [-11, 7, -2, 7, 6, 4, 12, 4, 15, 0, 13, 8, 5, 12, -6, 12]);
  line(ctx, '#bac0ab', 1.15, -10, -5, -5, -9, 1, -11);
  line(ctx, '#73837d', 1, 1, -5, -2, -1, -5, 1);
  rect(ctx, '#bdc1af', -7, -4, 3, 1.5);
  if (big) line(ctx, '#536560', 1.5, 10, -6, 8, -1, 4, 0, 2, 3);
  ctx.restore();
}

function bomb(ctx, r, big, t = 0) {
  ctx.save();
  ctx.scale(r / 16, r / 16);
  const metal = big ? '#474e50' : '#4c5a5b';
  polygon(
    ctx,
    metal,
    [-6, -13, -2, -15, 5, -14, 12, -10, 15, -4, 16, 3, 13, 10, 6, 15, -6, 15, -12, 11, -15, 5, -15, -4, -11, -10],
    '#262b2a',
    2,
  );
  polygon(
    ctx,
    big ? '#798180' : '#879491',
    [-12, -5, -9, -10, -4, -12, 2, -12, -2, -8, -5, -7, -7, -3, -10, -1, -13, -2],
  );
  polygon(ctx, '#343c3c', [-12, 8, -6, 11, 1, 11, 8, 7, 12, 1, 15, -2, 15, 4, 12, 10, 5, 14, -5, 14]);
  rect(ctx, '#bec4ae', -9, -8, 3, 2);
  if (big) {
    polygon(ctx, '#a7533c', [-13, -4, -8, -1, 2, 1, 11, 0, 15, -2, 15, 3, 11, 5, 1, 6, -8, 4, -14, 1]);
    line(ctx, '#ce7e52', 1.3, -12, -3, -7, 0, 2, 2, 10, 1);
  }
  polygon(ctx, '#8b7960', [-2, -14, -1, -18, 5, -17, 6, -13, 3, -12], '#333634', 1.3);
  line(ctx, '#493c2d', 3.8, 2, -16, 5, -21, 9, -21, 12, -25);
  line(ctx, '#bfa87a', 1.8, 2, -16, 5, -21, 9, -21, 12, -25);
  const spark = Math.sin(t * 15) * 1.2;
  polygon(ctx, '#c97b42', [
    12,
    -30 - spark,
    13,
    -27,
    16,
    -28,
    14,
    -25,
    17,
    -23,
    13,
    -24,
    11,
    -21,
    11,
    -24,
    8,
    -25,
    11,
    -26,
  ]);
  rect(ctx, '#ffe7a1', 11, -27, 2.4, 2.4);
  ctx.restore();
}

const ammunition = new Map(
  ['small-stone', 'big-stone', 'small-bomb', 'big-bomb'].map((id) => {
    const image = new Image();
    image.src = new URL('./assets/ammo-' + id + '.webp', import.meta.url).href;
    return [id, image];
  }),
);

function drawAmmo(ctx, id, radius, time) {
  const image = ammunition.get(id);
  if (image?.complete && image.naturalWidth) {
    const width = radius * 2.15;
    const height = (width * image.naturalHeight) / image.naturalWidth;
    ctx.drawImage(image, -width / 2, id.endsWith('bomb') ? radius - height : -height / 2, width, height);
  } else if (id?.endsWith('bomb')) bomb(ctx, radius, id.startsWith('big'), time);
  else rock(ctx, radius, id === 'big-stone');
}

export function drawAmmoIcon(canvas, id) {
  const pixelRatio = Math.max(3, Math.min(5, window.devicePixelRatio || 1));
  canvas.width = 72 * pixelRatio;
  canvas.height = 52 * pixelRatio;
  const ctx = canvas.getContext('2d');
  function paint() {
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, 72, 52);
    ctx.save();
    ctx.translate(36, id.endsWith('bomb') ? 32 : 28);
    drawAmmo(ctx, id, id.startsWith('big') ? 17 : 13, 0);
    ctx.restore();
  }
  const image = ammunition.get(id);
  if (image && !image.complete) image.addEventListener('load', paint, { once: true });
  paint();
}

function ambient(ctx, t, level = 0) {
  if (level === 0 || level === 4) {
    const look = t % 9 > 6.8 && t % 9 < 8.5;
    const x = 306 + Math.sin(t * 0.07) * 1.5,
      y = GROUND - 6;
    const height = look ? 16.4 : 13.9;
    ellipse(ctx, 'rgba(44,48,31,.2)', x, y, 8.2, 1.1);
    sprite(ctx, look ? 'unicorn-look' : 'unicorn', x - 13, y - height, 26, height);
  }
  const fairyX = 506 + Math.sin(t * 0.46) * 18 + Math.cos(t * 0.27) * 7;
  const fairyY = 316 + Math.sin(t * 0.8) * 6 + Math.cos(t * 0.43) * 8;
  const up = Math.sin(t * 9) > 0;
  ctx.save();
  ctx.translate(fairyX, fairyY);
  ellipse(ctx, 'rgba(255,241,169,.10)', 0, 0, 6.5, 6.5);
  sprite(ctx, up ? 'fairy-up' : 'fairy', up ? -3.0 : -4.6, up ? -7 : -5.2, up ? 6.8 : 9.6, up ? 11.8 : 10);
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.82 + i / 3) % 1;
    ctx.globalAlpha = 1 - phase;
    ellipse(ctx, '#ffe3ab', -3 - phase * 12, 1 + Math.sin(phase * 5) * 3, 0.62, 0.62);
  }
  ctx.restore();
  // Fireflies stay low in the valley. Distant swallows cross only the open sky.
  for (let i = 0; i < 7; i++) {
    const x = 248 + i * 86 + Math.sin(t * 0.41 + i * 2.7) * 12,
      y = 339 + (i % 4) * 10 + Math.sin(t * 0.78 + i * 3.2) * 4;
    const glow = Math.pow((1 + Math.sin(t * 1.4 + i * 5.3)) / 2, 4);
    if (glow < 0.38) continue;
    ctx.globalAlpha = glow * 0.78;
    rect(ctx, level === 1 ? '#cfebda' : '#fff1ad', x, y, 2, 2);
  }
  ctx.globalAlpha = 0.63;
  for (let i = 0; i < 3; i++) {
    const x = 423 + ((t * 3.8) % 145) + i * 12,
      y = 80 + Math.sin(t * 0.25) * 3 + (i === 1 ? -5 : i === 2 ? -2 : 0);
    const wing = Math.sin(t * 4.5 + i * 1.5) * 1.3;
    line(
      ctx,
      '#456b69',
      1.4,
      x - 3,
      y - 1 + wing,
      x - 1,
      y + wing * 0.4,
      x,
      y + 1,
      x + 2,
      y - 1 + wing,
      x + 4,
      y - 1 + wing,
    );
  }
  ctx.globalAlpha = 1;
}

function drawPennant(ctx, x, y, time, seed, wind) {
  ctx.save();
  ctx.translate(x, y);
  line(ctx, '#503d2a', 2.4, 0, 0.5, 0, -34);
  line(ctx, '#d8b77b', 0.75, -0.55, 0, -0.55, -34);
  polygon(ctx, '#d9b879', [-2, -34, 0, -38, 2, -34, 0, -32], '#715535', 0.65);
  const breeze = clamp(Math.abs(wind) / 24, 0, 1);
  ctx.scale(wind < 0 ? -1 : 1, 1);
  const width = 24 + 11 * breeze,
    height = 16,
    strips = 10;
  const lift = (u) =>
    u * (3.5 * (1 - breeze) + Math.sin(time * (2.2 + 2.4 * breeze) + seed - u * 5.5) * (1.1 + 1.8 * breeze));
  for (let i = 0; i < strips; i++) {
    const a = i / strips,
      b = (i + 1) / strips,
      dy = lift(a),
      span = width / strips;
    ctx.save();
    ctx.transform(1, (lift(b) - dy) / span, 0, 1, 0.8 + a * width, -32 + dy);
    sampleSprite(ctx, 'pennant', a, 0, 1 / strips, 1, 0, 0, span + 0.035, height);
    ctx.restore();
  }
  ctx.restore();
}

function tapestry(ctx, x, y, time, royal, wind) {
  const width = 13,
    height = 23,
    strips = 5;
  const breeze = clamp(wind / 24, -1, 1);
  const bend = (u) =>
    (2.3 * breeze * u + Math.sin(time * (2 + Math.abs(breeze)) + x - u * 3) * (0.3 + 0.65 * Math.abs(breeze))) * u;
  for (let i = 0; i < strips; i++) {
    const a = i / strips,
      b = (i + 1) / strips,
      dx = bend(a),
      span = height / strips;
    ctx.save();
    ctx.transform(1, 0, (bend(b) - dx) / span, 1, x - width * 0.5 + dx, y + height * a);
    sampleSprite(ctx, royal ? 'azure' : 'crimson', 0, a, 1, 1 / strips, 0, 0, width, span + 0.025);
    ctx.restore();
  }
}

function prepareRooms(sim, bodies) {
  const roofs = bodies.filter((b) => b.kind === 'block' && b.width > 42 && b.height < 21);
  const posts = bodies.filter(
    (b) => b.kind === 'block' && b.width < 35 && ['masonry', 'beam', 'pane', 'girder'].includes(b.detail),
  );
  const home = (b) => b.home || b;
  const rooms = [];
  for (const section of sim.level?.sections || []) {
    let x = section.left;
    for (let bay = 0; bay < section.spans.length; bay++) {
      const width = section.spans[bay],
        cx = x + width / 2;
      for (let row = 0; row < section.heights[bay]; row++) {
        const top = section.base - (row + 1) * section.storey;
        const roof = roofs.find(
          (b) => Math.abs(home(b).x - cx) < 13 && Math.abs(home(b).y - top - b.height / 2) < 4,
        );
        if (!roof) continue;
        const support = (px) =>
          posts
            .filter(
              (b) =>
                Math.abs(home(b).x - px) < 3 && home(b).y > top + roof.height && home(b).y < top + section.storey,
            )
            .sort((a, b) => home(a).y - home(b).y)[0];
        const left = support(x),
          right = support(x + width);
        if (!left || !right) continue;
        const royal = section.style === 'keep' && row === section.heights[bay] - 1;
        const style = royal ? 'royal' : roof.material === 'wood' && (bay + row) % 3 !== 1 ? 'timbered' : 'gothic';
        rooms.push({
          roof,
          left,
          right,
          width,
          height: section.storey - roof.height + 1,
          style,
          offset: cx - home(roof).x,
          leftOffset: home(left).x - home(roof).x,
          rightOffset: home(right).x - home(roof).x,
          tapestry: royal || (section.pattern + bay + row) % 4 === 0,
          royal,
          broken: false,
        });
      }
      x += width;
    }
  }
  return rooms;
}

// These soft shadows are stamped repeatedly, including under loose rubble.
function buildShadows() {
  const contact = document.createElement('canvas');
  contact.width = 96;
  contact.height = 32;
  const c = contact.getContext('2d');
  c.scale(3, 1);
  const floor = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  floor.addColorStop(0, 'rgba(26,30,29,.60)');
  floor.addColorStop(0.53, 'rgba(27,31,29,.32)');
  floor.addColorStop(1, 'rgba(31,33,31,0)');
  c.fillStyle = floor;
  c.fillRect(0, 0, 32, 32);

  const room = document.createElement('canvas');
  room.width = 64;
  room.height = 64;
  const r = room.getContext('2d');
  const interior = r.createLinearGradient(0, 0, 0, 64);
  interior.addColorStop(0, 'rgba(22,32,37,.72)');
  interior.addColorStop(0.35, 'rgba(29,39,42,.48)');
  interior.addColorStop(1, 'rgba(31,40,40,.28)');
  r.fillStyle = interior;
  r.fillRect(0, 0, 64, 64);
  const jambs = r.createLinearGradient(0, 0, 64, 0);
  jambs.addColorStop(0, 'rgba(26,30,32,.28)');
  jambs.addColorStop(0.28, 'transparent');
  jambs.addColorStop(0.75, 'transparent');
  jambs.addColorStop(1, 'rgba(26,30,32,.25)');
  r.fillStyle = jambs;
  r.fillRect(0, 0, 64, 64);
  return { contact, room };
}

function drawGroundShadows(ctx, sim, bodies, contact, view, minGround) {
  for (const b of bodies) {
    if (
      b.kind === 'torch' ||
      b.kind === 'projectile' ||
      b.x + b.width < view.x ||
      b.x - b.width > view.x + view.width
    )
      continue;
    const foot = b.body.bounds.max.y;
    if (foot < minGround - 9) continue;
    const floor = sim.terrainHeight(b.x),
      gap = floor - foot;
    if (gap > 9 || gap < -6) continue;
    const width = Math.min(78, b.width * 1.46 + 6);
    ctx.globalAlpha = 1 - Math.max(0, gap) / 11;
    ctx.drawImage(contact, b.x - width * 0.46, floor - 2.3, width, 5.3);
  }
  ctx.globalAlpha = 1;
}

function drawRooms(ctx, state, sim, bodies, time) {
  if (!state.rooms) state.rooms = prepareRooms(sim, bodies);
  for (const room of state.rooms) {
    if (room.broken) continue;
    const { roof, left, right, width, height } = room;
    const separated =
      roof.destroyed ||
      left.destroyed ||
      right.destroyed ||
      Math.abs(left.x - roof.x - room.leftOffset) > 9 ||
      Math.abs(right.x - roof.x - room.rightOffset) > 9 ||
      Math.abs(roof.angle - left.angle) > 0.25 ||
      Math.abs(roof.angle - right.angle) > 0.25 ||
      left.y < roof.y ||
      right.y < roof.y;
    if (separated) {
      room.broken = true;
      state.effects.roomBreak(roof.x, roof.y + roof.height * 0.5, width, roof.material);
      continue;
    }
    ctx.save();
    ctx.translate(roof.x, roof.y);
    ctx.rotate(roof.angle);
    const top = roof.height / 2 - 1,
      leftEdge = room.offset - width / 2;
    // Recessed bays receive less skylight than their front piers and occupants.
    ctx.drawImage(state.shadows.room, leftEdge + 0.5, top, width - 1, height - 1);
    sprite(ctx, room.style, leftEdge - 1, top - 2, width + 2, height + 2);
    if (room.tapestry) tapestry(ctx, leftEdge + width * 0.23, top, time, room.royal, sim.level?.wind ?? 0);
    ctx.restore();
  }
}

function drawMasonry(ctx, b) {
  const w = b.width,
    h = b.height,
    x = -w / 2,
    y = -h / 2;
  const stones = ['limestone', 'stone', 'graystone', 'limestone', 'repaired', 'limestone', 'graystone'];
  const pick = (n) => stones[(b.id * 11 + n * 3) % stones.length];
  if (b.detail === 'curtain' || b.detail === 'battlement' || b.detail === 'banner' || b.detail === 'watch') {
    sprite(ctx, pick(0), x, y, w, h);
    return;
  }
  const courses = h > 25 ? 2 : 1;
  const rowHeight = h / courses;
  for (let row = 0; row < courses; row++) {
    const count = Math.max(1, Math.round(w / 34));
    const blockWidth = w / count;
    for (let i = 0; i < count; i++) {
      const pos = x + i * blockWidth;
      ctx.save();
      if ((row + i + b.id) % 3 === 0) {
        ctx.translate(pos + blockWidth, y + row * rowHeight);
        ctx.scale(-1, 1);
      } else ctx.translate(pos, y + row * rowHeight);
      sprite(ctx, pick(row + i), 0, 0, blockWidth + 0.1, rowHeight + 0.12);
      ctx.restore();
    }
  }
}

function scar(ctx, b) {
  const w = b.width,
    h = b.height;
  const rand = randomSequence(b.id + 43);
  const x = (rand() - 0.5) * w * 0.45,
    extent = (0.25 + b.damage * 0.65) * h;
  const sign = rand() > 0.5 ? 1 : -1,
    top = -h / 2;
  const path = [
    x,
    top,
    x - 2 * sign,
    top + 0.24 * extent,
    x + 2.5 * sign,
    top + 0.42 * extent,
    x - 3.3 * sign,
    top + 0.67 * extent,
    x - 1 * sign,
    top + extent,
  ];
  line(ctx, 'rgba(215,201,178,.65)', 1.1, ...path.map((v, i) => (i % 2 ? v : v + 0.55)));
  line(ctx, b.material === 'glass' ? '#e4fbf7' : '#483e37', b.material === 'glass' ? 0.75 : 1.1, ...path);
  if (b.damage > 0.58)
    line(
      ctx,
      '#50483d',
      0.65,
      path[4],
      path[5],
      x + 7 * sign,
      top + extent * 0.41,
      x + 11 * sign,
      top + extent * 0.52,
    );
}

function drawBlock(ctx, b, time, wind) {
  const w = b.width,
    h = b.height;
  if (b.detail === 'banner') drawPennant(ctx, 0, -h / 2 + 1, time, b.id, wind);
  if (!spriteReady()) {
    rect(
      ctx,
      { stone: '#9a9686', wood: '#94704b', glass: '#96c7c3', steel: '#66777d' }[b.material] || '#8a8e81',
      -w / 2,
      -h / 2,
      w,
      h,
    );
  } else if (b.material === 'stone') drawMasonry(ctx, b);
  else {
    const upright = h > w;
    ctx.save();
    if (upright) ctx.rotate(Math.PI * 0.5);
    const length = upright ? h : w,
      thickness = upright ? w : h;
    if (b.material === 'steel' && b.bend) {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const offset = Math.sin(((i + 0.5) * Math.PI) / n) * b.bend * Math.min(length * 0.065, 4);
        sampleSprite(
          ctx,
          'steel',
          i / n,
          0,
          1 / n,
          1,
          -length / 2 + (i * length) / n,
          -thickness / 2 + offset,
          length / n + 0.15,
          thickness,
        );
      }
    } else {
      if (b.material === 'glass') ctx.globalAlpha = 0.89;
      sprite(ctx, b.material, -length / 2, -thickness / 2, length, thickness);
    }
    ctx.restore();
  }
  if (b.damage > 0.18) scar(ctx, b);
  if (b.material === 'wood' && (b.burn || 0) > 0.01) {
    const ratio = clamp(b.burn, 0, 1);
    const stain = ctx.createRadialGradient(-w * 0.2, -h * 0.1, 0, 0, 0, Math.max(w, h) * 0.58);
    stain.addColorStop(0, 'rgba(32,21,19,' + (0.18 + ratio * 0.75) + ')');
    stain.addColorStop(1, 'rgba(55,37,27,' + ratio * 0.4 + ')');
    ctx.fillStyle = stain;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    const rng = randomSequence(b.id + 51);
    for (let i = 0; i < Math.ceil(5 * ratio); i++) {
      const x = (rng() - 0.5) * w * 0.7,
        y = (rng() - 0.5) * h * 0.7;
      line(
        ctx,
        b.burning ? 'rgba(212,118,51,.6)' : 'rgba(48,32,26,.6)',
        0.45,
        x,
        y,
        x + w * 0.04,
        y + h * 0.08,
        x + w * 0.065,
        y + h * 0.1,
      );
    }
  }
}

function drawFragment(ctx, b) {
  const points = b.vertices;
  if (!points?.length) return;
  ctx.save();
  ctx.beginPath();
  points.forEach(({ x, y }, i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle =
    { wood: '#9d7952', steel: '#667985', glass: '#8ec8c7', stone: '#a79c8b' }[b.material] || '#908777';
  ctx.fill();
  ctx.clip();
  const w = b.width,
    h = b.height;
  sampleSprite(ctx, b.material, 0.2 + (b.id % 9) / 45, 0.14, 0.45, 0.69, -w * 0.6, -h * 0.6, w * 1.2, h * 1.2);
  line(ctx, 'rgba(249,226,185,.57)', 0.8, points[0].x, points[0].y, points[1].x, points[1].y);
  ctx.restore();
}

function drawTorch(ctx, b) {
  const s = Math.sin(b.angle || 0),
    c = Math.cos(b.angle || 0);
  const fx = b.flameX - b.x,
    fy = b.flameY - b.y;
  const x = Number.isFinite(fx) ? fx * c + fy * s : 0,
    y = Number.isFinite(fy) ? -fx * s + fy * c : -6;
  line(ctx, '#4a3327', 2.7, 0, b.height * 0.47, x, y + 1);
  line(ctx, '#997347', 1.1, -0.4, b.height * 0.45, x - 0.5, y + 1);
  polygon(ctx, '#576065', [x - 2.4, y + 1, x + 2.4, y + 1, x + 1.3, y + 4, x - 1.2, y + 4], '#382e2a', 0.6);
  line(ctx, '#b9a684', 0.8, x - 2.3, y + 1, x + 2.1, y + 1);
}

function drawCatapult(ctx, ammo, time, launchAge, sim, reduced) {
  const recoil =
    !reduced && launchAge < 0.54 ? Math.sin((Math.PI * launchAge) / 0.54) * (1 - launchAge / 0.54) * 2.7 : 0;
  ctx.save();
  ctx.translate(-recoil, 0);
  ellipse(ctx, 'rgba(46,38,28,.25)', 108, GROUND + 0.4, 78, 2.8);
  const baseX = 29,
    baseY = 293,
    baseW = 158,
    baseH = GROUND - baseY;
  sprite(ctx, 'chassis', baseX, baseY, baseW, baseH);
  const pivotX = baseX + baseW * 0.487,
    pivotY = baseY + baseH * 0.084;
  const armW = Math.hypot(160 - pivotX, 326 - pivotY) / 0.6205,
    armH = armW * 0.201;
  const cupX = armW * 0.619,
    cupY = -armH * 0.222;
  const rest = Math.atan2(326 - pivotY, 160 - pivotX) - Math.atan2(cupY, cupX);
  const flick =
    launchAge < 0.16
      ? -Math.sin(((launchAge / 0.16) * Math.PI) / 2) * 1.15
      : launchAge < 1
        ? -Math.pow(1 - (launchAge - 0.16) / 0.84, 2) * 1.15
        : 0;
  const theta = rest + flick;
  const slingX = pivotX + cupX * Math.cos(theta) - cupY * Math.sin(theta);
  const slingY = pivotY + cupX * Math.sin(theta) + cupY * Math.cos(theta);
  line(ctx, '#594a34', 1.4, 165, 344, (165 + slingX) * 0.5 + 1, (344 + slingY) * 0.5 + 2, slingX, slingY + 2);
  line(ctx, '#d3b17a', 0.55, 165, 344, (165 + slingX) * 0.5 + 1, (344 + slingY) * 0.5 + 2, slingX, slingY + 2);
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(theta);
  sprite(ctx, 'arm', -armW * 0.307, -armH * 0.378, armW, armH);
  ellipse(ctx, '#93723e', 0, 0, 2.0, 2);
  ellipse(ctx, '#ecce8c', -0.55, -0.6, 0.85, 0.8);
  ctx.restore();
  if (sim.stats.ready && launchAge > 0.46) {
    ctx.save();
    ctx.translate(slingX, slingY - 0.7);
    drawAmmo(ctx, ammo, ammo.startsWith('big') ? 9.2 : 7, time);
    ctx.restore();
  }
  for (const [x, y, r] of [
    [26, 385, 4],
    [36, 384, 5],
    [32, 379, 4],
  ]) {
    ctx.save();
    ctx.translate(x, y);
    drawAmmo(ctx, 'small-stone', r, time);
    ctx.restore();
  }
  ctx.restore();
  const role =
    (sim.themeIndex ?? sim.levelIndex) === 1
      ? 'gnome'
      : (sim.themeIndex ?? sim.levelIndex) === 4
        ? 'elf'
        : 'dwarf';
  const gesture = !reduced && (time + 0.7) % 5.2 < 0.95 ? '-idle' : '';
  const pose = !reduced && launchAge < 0.82 ? '-action' : gesture;
  const height = role === 'elf' ? 33 : role === 'gnome' ? 29 : 30;
  const width = role === 'dwarf' ? 24 : 20.5;
  ellipse(ctx, 'rgba(43,40,27,.25)', 198, GROUND + 0.2, width * 0.46, 1.3);
  if (!sprite(ctx, role + pose, 198 - width * 0.5, GROUND - height, width, height))
    sprite(ctx, role, 198 - width * 0.5, GROUND - height, width, height);
}

function drawTrajectory(ctx, points) {
  let travel = 0,
    next = 19,
    count = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      segment = Math.hypot(dx, dy);
    if (!segment) continue;
    while (travel + segment >= next) {
      const u = (next - travel) / segment,
        x = a.x + dx * u,
        y = a.y + dy * u,
        r = 1.75 - count * 0.038;
      ctx.globalAlpha = 0.84 - count * 0.024;
      ellipse(ctx, '#514a39', x, y + 0.6, r + 0.5, r + 0.45);
      ellipse(ctx, '#fcebc3', x, y, r, r);
      next += 13.5 + count * 0.18;
      if (++count >= 23) {
        ctx.globalAlpha = 1;
        return;
      }
    }
    travel += segment;
  }
  ctx.globalAlpha = 1;
}

function drawGuard(ctx, b, t, launchAge, reduced) {
  const reaction = 0.2 + Math.max(0, b.x - 500) * 0.00045 + (b.id % 3) * 0.03;
  const alerted = !reduced && launchAge > reaction && launchAge < reaction + 1.35;
  const gesture = !reduced && (t + b.id * 0.74) % 5.7 < 0.67;
  const pose = alerted ? 'guard-action' : gesture ? 'guard-idle' : 'guard';
  const size = alerted ? 0.87 : 1;
  const h = b.height * size * 1.16,
    w = b.width * 1.2;
  if (!sprite(ctx, pose, -w * 0.5, b.height * 0.5 - h, w, h))
    sprite(ctx, 'guard', -w * 0.5, b.height * 0.5 - h, w, h);
}

const DEFAULT_VIEW = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const effects = createEffects();
  const backdrop = document.getElementById('scenery');
  const state = {
    effects,
    shadows: buildShadows(),
    rooms: null,
    terrain: null,
    terrainSource: null,
    terrainLayout: null,
    launchTime: -10,
    lastTime: null,
    aim: [],
    aimKey: '',
  };
  function reset() {
    state.rooms = null;
    state.terrain = null;
    state.terrainLayout = null;
    state.launchTime = -10;
    state.lastTime = null;
    state.aimKey = '';
    effects.reset();
  }
  function prepare(sim, scenery, bodies) {
    if (state.terrainSource === scenery && state.terrainLayout === sim.terrain && state.terrain) return;
    if (!scenery?.complete || !scenery.naturalWidth) return;
    state.terrain = paintTerrain(sim.terrain, scenery, sim.level?.phase || 'day', state.terrain?.canvas);
    state.terrainSource = scenery;
    state.terrainLayout = sim.terrain;
    if (!state.rooms) state.rooms = prepareRooms(sim, bodies || sim.bodies);
  }
  function draw(sim, options = {}) {
    const { angle = 43, power = 70, ammo = 'small-stone', reducedMotion = false } = options;
    const view = options.view || DEFAULT_VIEW;
    const bounds = canvas.getBoundingClientRect();
    const cssW = bounds.width || WIDTH,
      cssH = bounds.height || HEIGHT;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3840 / cssW, 3840 / cssH);
    const w = Math.max(1, Math.round(cssW * pixelRatio)),
      h = Math.max(1, Math.round(cssH * pixelRatio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const t = options.time ?? performance.now() / 1000;
    const dt = state.lastTime == null ? 0 : clamp(t - state.lastTime, 0, 0.05);
    state.lastTime = t;
    const phase = sim.level?.phase || 'day';
    prepareSprites(phase, w / view.width);
    const events = options.events || [];
    if (events.some((e) => e.type === 'launch')) state.launchTime = t;
    const bodies = sim.bodies;
    effects.update(
      events,
      bodies,
      dt,
      t,
      reducedMotion,
      sim.themeIndex ?? sim.levelIndex,
      phase,
      sim.terrain,
      sim.level?.wind ?? 0,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    const scaleX = w / view.width,
      scaleY = h / view.height;
    ctx.setTransform(scaleX, 0, 0, scaleY, -view.x * scaleX, -view.y * scaleY);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const shake = effects.getShake();
    ctx.save();
    ctx.translate(shake.x, shake.y);
    const ambientTime = reducedMotion ? 0 : t;
    const scenery = options.scenery || backdrop;
    prepare(sim, scenery, bodies);
    if (state.terrain) {
      const g = state.terrain;
      ctx.drawImage(g.canvas, g.left, g.top, g.width, g.height);
    }
    drawGroundShadows(ctx, sim, bodies, state.shadows.contact, view, state.terrain?.top ?? GROUND - 90);
    ambient(ctx, ambientTime, sim.themeIndex ?? sim.levelIndex);
    effects.drawBehind(ctx);
    const age = t - state.launchTime;
    drawCatapult(ctx, ammo, ambientTime, age, sim, reducedMotion);
    if (sim.stats.ready && !sim.stats.cleared) {
      const key = [ammo, angle, power].join('/');
      if (state.aimKey !== key) {
        state.aimKey = key;
        state.aim = sim.trajectory(ammo, angle, power);
      }
      drawTrajectory(ctx, state.aim);
    }
    drawRooms(ctx, state, sim, bodies, ambientTime);
    for (const b of bodies) {
      if (b.x + b.width < view.x || b.x - b.width > view.x + view.width) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle || 0);
      if (b.kind === 'orc') drawGuard(ctx, b, ambientTime, age, reducedMotion);
      else if (b.kind === 'barrel')
        sprite(ctx, 'keg', -b.width * 0.53, -b.height * 0.69, b.width * 1.06, b.height * 1.19);
      else if (b.kind === 'torch') drawTorch(ctx, b);
      else if (b.kind === 'projectile') drawAmmo(ctx, b.material, b.radius || b.width / 2, ambientTime);
      else if (b.kind === 'fragment') drawFragment(ctx, b);
      else drawBlock(ctx, b, ambientTime, sim.level?.wind ?? 0);
      ctx.restore();
    }
    effects.drawFront(ctx);
    ctx.restore();
  }
  return { draw, reset, prepare };
}
