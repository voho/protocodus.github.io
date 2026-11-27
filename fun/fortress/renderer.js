import { drawRoof, prepareRoofArt } from './roofs.js';
import { createEffects } from './effects.js';
import { createWeatherEffects } from './weather-effects.js';
import { sprite, sampleSprite, sampleGuard, drawGuardShadow, drawCrossbowPose, crossbowTip, spriteReady, prepareSprites, drawCatapultOutline, materialFace } from './sprites.js';
import { paintTerrain } from './terrain.js';
import { chamberStyle, facadeStyles, paintFacade, prepareFacadeArt } from './facades.js';

// All scene art uses world pixels, including the moving bodies and their fracture pieces.
const WIDTH = 1200;
const HEIGHT = 480;
const GROUND = 389;
const launcherSides = ['left', 'right'];
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
    [
      -6, -13, -2, -15, 5, -14, 12, -10, 15, -4, 16, 3, 13, 10, 6, 15, -6, 15, -12, 11, -15, 5, -15, -4, -11,
      -10,
    ],
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
  ['small-stone', 'big-stone', 'small-bomb', 'big-bomb', 'siege-bomb', 'magic-bomb'].map((id) => {
    const image = new Image();
    image.src = new URL('./assets/ammo-' + id + '.webp', import.meta.url).href;
    return [id, image];
  }),
);

// Separate tongues of flame curl around a solid incandescent projectile.
function paintFireball(frame) {
  const surface = document.createElement('canvas');
  surface.width = surface.height = 144;
  const ctx = surface.getContext('2d');
  ctx.translate(72, 72);
  ctx.scale(3, 3);
  const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 23);
  glow.addColorStop(0, 'rgba(255,171,29,.93)');
  glow.addColorStop(0.56, 'rgba(255,117,14,.34)');
  glow.addColorStop(1, 'rgba(255,91,11,0)');
  ellipse(ctx, glow, 0, 0, 23, 23);
  for (let i = 0; i < 6; i++) {
    const phase = (frame * TAU) / 6;
    const reach = 12.5 + 4.4 * Math.sin(phase + i * 2.3);
    ctx.save();
    ctx.rotate((i * TAU) / 6 + Math.sin(phase + i) * 0.11);
    ctx.beginPath();
    ctx.moveTo(-6, -3.5);
    ctx.bezierCurveTo(-12.8, -5.7, -6.2, -11, -2.3, -reach - 2);
    ctx.bezierCurveTo(-4, -9.4, 1.4, -11.4, 4.3, -8);
    ctx.bezierCurveTo(6.9, -3.2, 1.7, -1.7, -6, -3.5);
    ctx.fillStyle = i % 2 ? '#f95710' : '#ff8b12';
    ctx.fill();
    ctx.restore();
  }
  const core = ctx.createRadialGradient(-2.8, -3.1, 0.3, 0, 0.6, 10.3);
  core.addColorStop(0, '#ffffe2');
  core.addColorStop(0.38, '#fff99d');
  core.addColorStop(0.75, '#ffc323');
  core.addColorStop(1, '#ea4209');
  ellipse(ctx, core, 0, 0, 9.4, 9.2);
  ctx.beginPath();
  ctx.moveTo(-7.3, 1.1);
  ctx.bezierCurveTo(-6.9, 5.6, 0.3, 8.7, 5.5, 3.2);
  ctx.bezierCurveTo(2.5, 8.9, -6.2, 8.5, -7.3, 1.1);
  ctx.fillStyle = '#fff4a0';
  ctx.fill();
  return surface;
}

const fireballFrames = Array.from({ length: 6 }, (_, i) => paintFireball(i));

const siegeFuseLight = document.createElement('canvas');
siegeFuseLight.width = siegeFuseLight.height = 128;
{
  const ctx = siegeFuseLight.getContext('2d');
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,174,66,.52)');
  glow.addColorStop(0.49, 'rgba(255,176,65,.45)');
  glow.addColorStop(0.68, 'rgba(255,156,45,.29)');
  glow.addColorStop(0.91, 'rgba(255,166,65,.06)');
  glow.addColorStop(1, 'rgba(235,97,23,0)');
  rect(ctx, glow, 0, 0, 128, 128);
}
function drawAmmo(ctx, id, radius, time, live = false) {
  if (id === 'magic-bomb') {
    const orb = ammunition.get(id);
    if (orb.complete && orb.naturalWidth) {
      const width = radius * 2.22;
      const height = width * orb.naturalHeight / orb.naturalWidth;
      ctx.drawImage(orb, -width / 2, -height / 2, width, height);
    } else ellipse(ctx, '#ae83e5', 0, 0, radius, radius);
    if (live) {
      ctx.save();
      ctx.rotate(time * 1.8);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.28, radius * 0.69, 0, Math.PI * 0.08, Math.PI * 0.92);
      ctx.lineWidth = radius * 0.083;
      ctx.strokeStyle = '#e4c8fcbd';
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  if (live && id === 'siege-bomb') {
    const halo = radius * (1.52 + 0.15 * Math.sin(time * 3.2));
    ctx.drawImage(siegeFuseLight, -halo, -halo, 2 * halo, 2 * halo);
  }
  if (id === 'fireball') {
    const side = radius * 4.8;
    ctx.drawImage(
      fireballFrames[Math.floor(time * 12) % fireballFrames.length],
      -side / 2,
      -side / 2,
      side,
      side,
    );
    return;
  }
  const image = ammunition.get(id);
  if (image?.complete && image.naturalWidth) {
    const width = radius * 2.15;
    const height = (width * image.naturalHeight) / image.naturalWidth;
    ctx.drawImage(image, -width / 2, id.endsWith('bomb') ? radius - height : -height / 2, width, height);
  } else if (id?.endsWith('bomb')) bomb(ctx, radius, id.startsWith('big') || id === 'siege-bomb', time);
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
    (2.3 * breeze * u +
      Math.sin(time * (2 + Math.abs(breeze)) + x - u * 3) * (0.3 + 0.65 * Math.abs(breeze))) *
    u;
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
    (b) => b.kind === 'block' && b.width < 35 && ['masonry', 'column', 'beam', 'pane', 'girder'].includes(b.detail),
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
        const roof = roofs.find((b) => {
          if (Math.abs(home(b).y - top - b.height / 2) >= 4) return false;
          if (b.detail === 'tie-beam') return Math.abs(home(b).x - cx) + width / 2 <= b.width / 2 + 1;
          return Math.abs(home(b).x - cx) < 13;
        });
        if (!roof) continue;
        const supportStack = (px) =>
          posts
            .filter(
              (b) =>
                Math.abs(home(b).x - px) < 3 &&
                home(b).y > top + roof.height &&
                home(b).y < top + section.storey,
            )
            .sort((a, b) => home(a).y - home(b).y);
        const leftStack = supportStack(x),
          rightStack = supportStack(x + width);
        const left = leftStack[0],
          right = rightStack[0];
        if (!left || !right) continue;
        const occupied = section.orcs.some(([c, r]) => c === bay && r === row) ||
          section.barrels.some(([c, r]) => c === bay && r === row);
        const style = roof.stairs ? 'open' : chamberStyle(section, bay, row, occupied);
        const royal = style === 'royal';
        rooms.push({
          roof,
          left,
          right,
          leftFoot: leftStack.at(-1),
          rightFoot: rightStack.at(-1),
          width,
          height: section.storey - roof.height + 1,
          style,
          offset: cx - home(roof).x,
          leftOffset: home(left).x - home(roof).x,
          rightOffset: home(right).x - home(roof).x,
          arch: royal || style === 'gothic' || style === 'timbered',
          tapestry: royal || (style === 'gothic' && (section.pattern + bay) % 3 === 0),
          royal,
          grounding: row === 0 ? section.storey * section.heights[bay] : 0,
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
  floor.addColorStop(0, 'rgba(20,24,26,.81)');
  floor.addColorStop(0.34, 'rgba(25,29,29,.56)');
  floor.addColorStop(0.69, 'rgba(29,32,31,.18)');
  floor.addColorStop(0.88, 'rgba(29,32,31,.045)');
  floor.addColorStop(1, 'rgba(31,33,31,0)');
  c.fillStyle = floor;
  c.fillRect(0, 0, 32, 32);

  const overhang = document.createElement('canvas');
  overhang.width = 92;
  overhang.height = 40;
  const e = overhang.getContext('2d');
  const penumbra = e.createLinearGradient(0, 0, 0, 40);
  penumbra.addColorStop(0, 'rgba(24,23,23,.67)');
  penumbra.addColorStop(0.24, 'rgba(28,26,25,.38)');
  penumbra.addColorStop(0.68, 'rgba(30,28,26,.105)');
  penumbra.addColorStop(1, 'rgba(30,28,26,0)');
  rect(e, penumbra, 0, 0, 92, 40);
  return { contact, overhang, rooms: {} };
}

const chamberLight = {
  day: [67, 67, 59],
  dawn: [69, 61, 55],
  dusk: [62, 56, 62],
  night: [41, 46, 57],
};

// The back wall, slit window and diagonal beam of skylight sit behind the
// painted front arch. Reuse these surfaces for every matching bay in a level.
function paintChamber(style, phase) {
  const canvas = document.createElement('canvas');
  canvas.width = 224;
  canvas.height = 152;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const [r, g, b] = chamberLight[phase] || chamberLight.day;
  const color = (n) => `rgb(${r + n},${g + n},${b + n})`;
  const rand = randomSequence(style === 'royal' ? 11 : style === 'gothic' ? 42 : 37);
  rect(ctx, color(-20), 0, 0, 112, 76);
  for (let row = 0; row < 7; row++) {
    let x = row % 2 ? -7 : -20;
    while (x < 112) {
      const y = row * 10.8;
      const width = 13 + rand() * 13;
      const value = Math.floor(rand() * 12);
      polygon(ctx, color(value), [
        x + 1,
        y + 0.5,
        x + width - 1,
        y + 0.25,
        x + width,
        y + 1.6,
        x + width - 0.5,
        y + 9.6,
        x + 2,
        y + 10,
        x + 0.3,
        y + 8.5,
      ]);
      line(ctx, color(value + 5), 0.55, x + 2, y + 1.3, x + width - 2, y + 1);
      for (let i = 0; i < 5; i++) {
        const dx = x + 2 + rand() * (width - 5),
          dy = y + 2 + rand() * 5;
        line(ctx, color(value + (i % 2 ? 2 : -3)), 0.42, dx, dy, dx + 1.6 + rand() * 3, dy - 0.45);
      }
      x += width;
    }
  }
  const windows = style === 'royal' ? [54, 68] : style === 'timbered' ? [47] : [61];
  const windowWidth = style === 'royal' ? 5.6 : 7.5;
  const windowShape = (x, y, w, h) => {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + h);
    ctx.lineTo(x - w / 2, y + w * 0.62);
    ctx.quadraticCurveTo(x - w * 0.46, y + w * 0.18, x, y);
    ctx.quadraticCurveTo(x + w * 0.45, y + w * 0.18, x + w / 2, y + w * 0.62);
    ctx.lineTo(x + w / 2, y + h);
    ctx.closePath();
  };
  for (const x of windows) {
    windowShape(x, 22, windowWidth + 5, 26);
    ctx.fillStyle = color(-32);
    ctx.fill();
    windowShape(x + 0.8, 23, windowWidth, 22);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    line(
      ctx,
      color(24),
      1.1,
      x + windowWidth / 2 + 1.5,
      30,
      x + windowWidth / 2 + 1.5,
      45.7,
      x - windowWidth / 2 + 0.8,
      45.7,
    );
    const beam = ctx.createLinearGradient(0, 33, 0, 70);
    beam.addColorStop(0, phase === 'night' ? 'rgba(136,170,205,.15)' : 'rgba(243,206,140,.22)');
    beam.addColorStop(1, 'rgba(202,192,155,0)');
    polygon(ctx, beam, [
      x - windowWidth / 2 + 1,
      45.8,
      x + windowWidth / 2 + 1,
      45.8,
      x + 25,
      67,
      x + 11,
      67,
    ]);
  }
  // Side returns and the cast shadow beneath the lintel give the front piers depth.
  polygon(ctx, 'rgba(14,19,22,.39)', [0, 0, 22, 12, 22, 63, 0, 76]);
  polygon(ctx, 'rgba(17,21,23,.24)', [112, 0, 99, 12, 99, 63, 112, 76]);
  polygon(ctx, 'rgba(23,24,24,.32)', [0, 76, 22, 63, 99, 63, 112, 76]);
  const ceiling = ctx.createLinearGradient(0, 0, 0, 48);
  ceiling.addColorStop(0, 'rgba(9,13,17,.84)');
  ceiling.addColorStop(0.42, 'rgba(14,17,20,.44)');
  ceiling.addColorStop(1, 'rgba(18,21,23,0)');
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 0, 112, 48);
  return canvas;
}

function paintGallery(balcony) {
  const canvas = document.createElement('canvas');
  canvas.width = 336;
  canvas.height = 228;
  const ctx = canvas.getContext('2d');
  ctx.scale(3, 3);
  for (const side of [0, 1]) {
    ctx.save();
    if (side) { ctx.translate(112, 0); ctx.scale(-1, 1); }
    polygon(ctx, '#544333', [3, 1, 35, 1, 30, 5, 10, 23, 5, 23, 5, 16, 22, 3, 3, 4]);
    line(ctx, '#b39568', 1.2, 6, 19, 26, 2);
    ellipse(ctx, '#292d2c', 9, 17.5, 1.1, 1.1);
    ctx.restore();
  }
  if (balcony) {
    for (let x = 10; x < 112; x += 15) {
      rect(ctx, '#4b4034', x, 59, 3.5, 17);
      rect(ctx, '#9f8769', x, 59, 0.9, 17);
    }
    rect(ctx, '#4b3b32', 0, 57, 112, 4.2);
    rect(ctx, '#ba9c72', 0, 57, 112, 1.1);
  }
  return canvas;
}

function drawGroundShadows(ctx, sim, bodies, shadows, rooms, view, minGround) {
  const { contact } = shadows;
  // A tall standing bay shades an area of turf that extends past its base.
  // Slice the soft penumbra along the collision profile so it follows ledges
  // and crater rims. A displaced or broken foundation releases its shadow.
  const sunHeight = sim.level.phase === 'dawn' || sim.level.phase === 'dusk' ? 0.34 : 0.22;
  ctx.globalAlpha = sim.level.phase === 'night' ? 0.64 : 0.9;
  for (const room of rooms || []) {
    if (!room.grounding || room.broken || room.left.destroyed || room.right.destroyed || room.roof.destroyed)
      continue;
    const { leftFoot, rightFoot } = room;
    if (
      leftFoot.destroyed ||
      rightFoot.destroyed ||
      Math.abs(leftFoot.body.bounds.max.y - sim.terrainHeight(leftFoot.x)) > 6 ||
      Math.abs(rightFoot.body.bounds.max.y - sim.terrainHeight(rightFoot.x)) > 6
    )
      continue;
    const left = leftFoot.x - 6;
    const width = room.width + 14 + Math.min(36, room.grounding * sunHeight);
    const right = left + width;
    if (right < view.x || left > view.x + view.width) continue;
    for (let i = 1; i < sim.terrain.length; i++) {
      const a = sim.terrain[i - 1],
        b = sim.terrain[i];
      if (a.x > right) break;
      if (b.x <= left) continue;
      const start = Math.max(a.x, left),
        end = Math.min(b.x, right),
        span = end - start;
      if (span < 0.05) continue;
      const slope = (b.y - a.y) / (b.x - a.x);
      ctx.save();
      ctx.transform(1, slope, 0, 1, start, a.y + slope * (start - a.x) - 2.2);
      ctx.drawImage(
        contact,
        ((start - left) / width) * contact.width,
        0,
        (span / width) * contact.width,
        contact.height,
        0,
        0,
        span + 0.02,
        10 + room.grounding * 0.034,
      );
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
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
    const width = Math.min(78, b.width * 1.65 + 8);
    ctx.globalAlpha = (1 - Math.max(0, gap) / 11) * (1 - (b.dustProgress || 0));
    ctx.drawImage(contact, b.x - width * 0.43, floor - 3.1, width, 8.4);
  }
  ctx.globalAlpha = 1;
}

function drawRooms(ctx, state, sim, bodies, time, wind) {
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
    ctx.drawImage(
      state.shadows.rooms[sim.level.phase][room.style],
      leftEdge + 0.5,
      top,
      width - 1,
      height - 1,
    );
    if (room.arch) sprite(ctx, room.style, leftEdge - 1, top - 2, width + 2, height + 2);
    ctx.drawImage(state.shadows.overhang, leftEdge, top, width, Math.min(16, height * 0.42));
    if (room.tapestry) tapestry(ctx, leftEdge + width * 0.23, top, time, room.royal, wind);
    ctx.restore();
  }
}

const stones = ['limestone', 'stone', 'graystone', 'limestone', 'repaired', 'limestone', 'graystone'];

// Paint once at high resolution. Each flight is fastened to its own floor slab.
function paintStairs() {
  const image = document.createElement('canvas');
  image.width = 320;
  image.height = 216;
  const c = image.getContext('2d');
  c.scale(4, 4);
  const gradient = c.createLinearGradient(0, 3, 0, 53);
  gradient.addColorStop(0, '#987e59');
  gradient.addColorStop(1, '#574a3a');
  c.fillStyle = gradient;
  c.beginPath();
  c.moveTo(0, 51);
  for (let i = 0; i < 10; i++) {
    const top = 48 - i * 4.8;
    c.lineTo(i * 8, top);
    c.lineTo((i + 1) * 8, top);
  }
  c.lineTo(80, 10);
  c.lineTo(7, 54);
  c.lineTo(0, 54);
  c.fill();
  for (let i = 0; i < 10; i++) {
    const top = 48 - i * 4.8;
    c.fillStyle = '#c9b995';
    c.fillRect(i * 8, top, 8.6, 1.3);
    c.fillStyle = '#4a423b';
    c.fillRect(i * 8, top + 1.3, 1.2, 3.3);
  }
  c.strokeStyle = '#453a32';
  c.lineWidth = 1.7;
  c.beginPath();
  for (let i = 0; i <= 3; i++) {
    const x = 5 + i * 20, y = 47 - i * 12;
    c.moveTo(x, y);
    c.lineTo(x, y - 8);
  }
  c.moveTo(2, 40.8);
  c.lineTo(68, 1.2);
  c.stroke();
  c.strokeStyle = '#b19b72';
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(2, 39.8);
  c.lineTo(68, 0.2);
  c.stroke();
  return image;
}

function drawMasonry(ctx, b) {
  const w = b.width,
    h = b.height,
    x = -w / 2,
    y = -h / 2;
  const pick = (n) => stones[(b.id * 11 + n * 3) % stones.length];
  if (b.detail === 'column') {
    const collar = h * 0.13, inset = w * 0.075;
    materialFace(ctx, 'limestone', x + inset, y + collar, w - inset * 2, h - collar * 2);
    ctx.fillStyle = '#3a39364a';
    ctx.fillRect(x + w * 0.68, y + collar, w * 0.06, h - collar * 2);
    ctx.fillStyle = '#fff1c943';
    ctx.fillRect(x + w * 0.21, y + collar, w * 0.045, h - collar * 2);
    materialFace(ctx, pick(1), x, y, w, collar + 0.25);
    materialFace(ctx, pick(2), x, y + h - collar, w, collar);
    return;
  }
  if (b.detail === 'curtain' || b.detail === 'battlement' || b.detail === 'banner' || b.detail === 'watch') {
    materialFace(ctx, pick(0), x, y, w, h);
    return;
  }
  const courses = h > 25 ? 2 : 1;
  const rowHeight = h / courses;
  for (let row = 0; row < courses; row++) {
    const count = Math.max(1, Math.round(w / 34));
    const blockWidth = w / count;
    for (let i = 0; i < count; i++) {
      const pos = x + i * blockWidth;
      const py = y + row * rowHeight;
      materialFace(ctx, pick(row + i), pos, py, blockWidth + 0.1, rowHeight + 0.12);
    }
  }
}

const scarPaths = new WeakMap();
const fractureInk = { glass: '#dffffa', stone: '#514a40', wood: '#503123', steel: '#42505a' };
const fractureRim = { glass: '#438780', stone: '#cabba7', wood: '#d6a46a', steel: '#c3ced1' };

function makeScar(b, growth) {
  const path = new Path2D();
  const random = randomSequence(b.id + 43);
  const origin = (random() - 0.5) * 0.3;
  // Work along the length of each member so splits follow upright posts as well as beams.
  const upright = b.height > b.width;
  function trace(...coords) {
    for (let i = 0; i < coords.length; i += 2) {
      const x = (upright ? coords[i + 1] : coords[i]) * b.width;
      const y = (upright ? coords[i] : coords[i + 1]) * b.height;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
  }
  if (b.material === 'glass') {
    const turn = random();
    for (let i = 0; i < 6; i++) {
      const angle = turn + (i + random() * 0.35) * TAU / 6;
      const dx = Math.cos(angle) * growth * 0.32, dy = Math.sin(angle) * growth * 0.48;
      trace(origin, 0, origin + dx * 0.56, dy * 0.36, origin + dx, dy);
    }
  } else if (b.material === 'wood') {
    trace(-0.49, origin, -0.49 + growth * 0.35, origin + 0.08, -0.49 + growth * 0.91, origin + 0.03);
    if (growth > 0.58) trace(-0.49 + growth * 0.35, origin + 0.08, -0.49 + growth * 0.65, origin + 0.21);
  } else if (b.material === 'steel') {
    // Short creases on the compressed flange follow the metal as the girder buckles.
    const edge = b.bend < 0 ? -0.47 : 0.47;
    for (let i = 0; i < 3; i++) {
      const x = origin + i * 0.042;
      trace(x, edge, x + 0.027, edge * (1 - growth * 0.58), x + 0.032, edge * (1 - growth));
    }
  } else {
    trace(origin, -0.49, origin - 0.04, -0.49 + 0.25 * growth, origin + 0.04, -0.49 + 0.47 * growth,
      origin - 0.06, -0.49 + 0.72 * growth, origin - 0.03, -0.49 + 0.96 * growth);
    if (growth > 0.58) trace(origin + 0.04, -0.49 + 0.47 * growth, origin + 0.17, -0.49 + growth * 0.62);
  }
  return path;
}

function scar(ctx, b) {
  const stage = Math.round(b.damage * 16);
  let cached = scarPaths.get(b);
  if (!cached || cached.stage !== stage) {
    cached = { stage, path: makeScar(b, 0.25 + 0.75 * stage / 16) };
    scarPaths.set(b, cached);
  }
  ctx.lineJoin = 'bevel';
  ctx.lineWidth = b.material === 'glass' ? 1.1 : 1.8;
  ctx.strokeStyle = fractureRim[b.material];
  ctx.stroke(cached.path);
  ctx.lineWidth = b.material === 'glass' ? 0.65 : 0.95;
  ctx.strokeStyle = fractureInk[b.material];
  ctx.stroke(cached.path);
}

// Every coal plate follows the timber grain. Bake the advancing scorch and
// widening fissures once so an entire burning room shares its texture samples.
const COAL_W = 224,
  COAL_H = 64,
  COAL_STEPS = 24,
  COAL_VARIANTS = 3;
function paintCharcoal() {
  const canvas = document.createElement('canvas');
  canvas.width = COAL_W * 6;
  canvas.height = COAL_H * 4 * COAL_VARIANTS;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(COAL_W, COAL_H);
  const count = COAL_W * COAL_H;
  const arrival = new Float32Array(count);
  const grain = new Float32Array(count);
  const seams = new Float32Array(count);
  for (let variant = 0; variant < COAL_VARIANTS; variant++) {
    const random = randomSequence(193 + variant * 61);
    for (let y = 0, i = 0; y < COAL_H; y++) {
      for (let x = 0; x < COAL_W; x++, i++) {
        const u = x / COAL_W,
          v = y / COAL_H,
          seed = variant * 1.8;
        const curl = Math.sin(u * 9 + v * 5 + seed) * 0.31 + Math.sin(u * 30 + v * 4 - seed) * 0.11;
        const row = v * 5.4 + curl + Math.sin(u * 62 + v * 7) * 0.06;
        const rowId = Math.floor(row);
        const vertical =
          u * (3.8 + 0.5 * Math.sin(rowId + seed)) +
          Math.sin(rowId * 4.78 + seed) * 2.4 +
          Math.sin(v * 36 + rowId * 4 + seed) * 0.08;
        const side = Math.abs(vertical - Math.round(vertical)) * 1.7;
        const edge = Math.abs(row - Math.round(row));
        const nick = random() * 0.032;
        seams[i] = Math.min(side, edge) + nick;
        grain[i] =
          Math.sin(v * 185 + curl * 6) * 4.4 +
          Math.sin(v * 94 + u * 8 + curl) * 4 +
          random() * 12 +
          Math.sin(u * 35 + rowId * 1.1) * 2.3;
        arrival[i] =
          0.03 +
          0.43 * (0.5 + 0.5 * Math.sin(u * 5.4 - v * 1.9 + seed)) +
          0.2 * (0.5 + 0.5 * Math.sin(v * 8.6 + u * 15 + seed)) +
          0.08 * random();
      }
    }
    for (let frame = 0; frame < COAL_STEPS; frame++) {
      const progress = frame / (COAL_STEPS - 1);
      const shrink = 0.01 + Math.max(0, progress - 0.2) * 0.17;
      for (let i = 0, j = 0; i < count; i++, j += 4) {
        const soot = clamp((progress * 1.37 - arrival[i]) * 3.0, 0, 1);
        const cracks = clamp((shrink - seams[i]) / 0.034, 0, 1);
        const recess = cracks * (13 + progress * 7);
        const rim = Math.max(0, 1 - Math.abs(seams[i] - shrink - 0.028) / 0.039);
        const heat = Math.max(0, 1 - Math.abs(progress - 0.63) / 0.3);
        const ember = heat * cracks * Math.max(0, (grain[i] - 11) * 0.12);
        const tone = 39 - progress * 13 + grain[i] * 0.77 + rim * progress * 20 - recess;
        image.data[j] = tone + (1 - progress) * 28 + ember * 140;
        image.data[j + 1] = tone + (1 - progress) * 3 + ember * 38;
        image.data[j + 2] = tone - (1 - progress) * 13 + progress * 2;
        image.data[j + 3] = Math.round(soot * (212 + 43 * progress));
      }
      ctx.putImageData(image, (frame % 6) * COAL_W, (variant * 4 + Math.floor(frame / 6)) * COAL_H);
    }
  }
  return canvas;
}

let charcoal;
function drawCharcoal(ctx, b, x, y, w, h) {
  if (b.material !== 'wood' || !(b.burn >= 0.01) || !charcoal) return;
  const frame = Math.min(COAL_STEPS - 1, Math.round(b.burn * (COAL_STEPS - 1)));
  const sx = (frame % 6) * COAL_W,
    sy = ((b.id % COAL_VARIANTS) * 4 + Math.floor(frame / 6)) * COAL_H;
  if (h > w) {
    ctx.save();
    ctx.translate(x + w, y);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(charcoal, sx, sy, COAL_W, COAL_H, 0, 0, h, w);
    ctx.restore();
  } else ctx.drawImage(charcoal, sx, sy, COAL_W, COAL_H, x, y, w, h);
}

function drawBlock(ctx, b, time, wind) {
  const w = b.width,
    h = b.height;
  if (b.roofType) {
    drawRoof(ctx, b);
    if (b.damage > 0.18 || b.burn > 0.01) {
      ctx.save();
      ctx.beginPath();
      for (const [index, point] of b.vertices.entries()) {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.closePath(); ctx.clip();
      if (b.damage > 0.18) scar(ctx, b);
      drawCharcoal(ctx, b, -w / 2, -2 * h / 3, w, h);
      ctx.restore();
    }
    return;
  }
  if (b.detail === 'banner') drawPennant(ctx, 0, -h / 2 + 1, time, b.id, wind);
  drawBlockDepth(ctx, b);
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
        materialFace(
          ctx,
          'steel',
          -length / 2 + (i * length) / n,
          -thickness / 2 + offset,
          length / n + 0.15,
          thickness,
          i / n, 0, 1 / n, 1,
        );
      }
    } else {
      if (b.material === 'glass') ctx.globalAlpha = 0.89;
      materialFace(ctx, b.material, -length / 2, -thickness / 2, length, thickness);
    }
    ctx.restore();
  }
  if (b.damage > 0.18) scar(ctx, b);
  drawCharcoal(ctx, b, -w / 2, -h / 2, w, h);
}

// The cut ends and the shaded soffit behind each painted face move with the
// physical piece. Adjacent blocks therefore make one continuous tower profile.
const edgePigment = {
  stone: ['#59574f', '#373b39'],
  wood: ['#71462c', '#493522'],
  steel: ['#495a62', '#2e3c44'],
  glass: ['rgba(54,103,107,.65)', 'rgba(49,82,87,.68)'],
};
const charredEdges = Array.from({ length: COAL_STEPS }, (_, i) => {
  const burn = i / (COAL_STEPS - 1);
  const side = [113 - 79 * burn, 70 - 39 * burn, 44 - 13 * burn];
  const bottom = [73 - 53 * burn, 53 - 33 * burn, 34 - 13 * burn];
  return [`rgb(${side.join(',')})`, `rgb(${bottom.join(',')})`];
});
// Each body keeps its local-space paths across all camera positions and lighting phases.
const piecePaths = new WeakMap();
function drawBlockDepth(ctx, b) {
  const colors =
    b.material === 'wood' && b.burn > 0
      ? charredEdges[Math.min(COAL_STEPS - 1, Math.round(b.burn * (COAL_STEPS - 1)))]
      : edgePigment[b.material];
  if (!colors) return;
  let paths = piecePaths.get(b);
  if (!paths) {
    const x = b.width / 2,
      y = b.height / 2;
    const depth = Math.min(3.1, Math.min(x, y) * 0.37);
    const drop = depth * 0.72;
    const side = new Path2D();
    side.moveTo(x - 0.3, -y + 0.35);
    side.lineTo(x + depth, -y + drop + 0.2);
    side.lineTo(x + depth, y + drop - 0.3);
    side.lineTo(x - 0.3, y - 0.1);
    const bottom = new Path2D();
    bottom.moveTo(-x + 0.3, y - 0.35);
    bottom.lineTo(x - 0.2, y - 0.35);
    bottom.lineTo(x + depth, y + drop - 0.24);
    bottom.lineTo(-x + depth, y + drop);
    paths = { side, bottom };
    piecePaths.set(b, paths);
  }
  ctx.fillStyle = colors[0];
  ctx.fill(paths.side);
  ctx.fillStyle = colors[1];
  ctx.fill(paths.bottom);
}

const fragmentBase = { wood: '#b17949', steel: '#617a8c', glass: '#64bbc149', stone: '#a69f90' };
function drawFragment(ctx, b) {
  const points = b.vertices;
  if (!points?.length) return;
  let paths = piecePaths.get(b);
  if (!paths) {
    const shape = new Path2D();
    shape.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, points[i].y);
    shape.closePath();
    const edge = new Path2D();
    edge.moveTo(points[0].x, points[0].y);
    edge.lineTo(points[1].x, points[1].y);
    paths = { shape, edge };
    piecePaths.set(b, paths);
  }
  ctx.save();
  if (b.dustProgress > 0) {
    const dust = clamp(b.dustProgress, 0, 1);
    ctx.globalAlpha *= 1 - dust * dust * (3 - 2 * dust);
    ctx.scale(1 - dust * 0.18, 1 - dust * 0.18);
  }
  ctx.fillStyle = fragmentBase[b.material] || '#908777';
  ctx.fill(paths.shape);
  ctx.clip(paths.shape);
  const w = b.width,
    h = b.height;
  materialFace(ctx, b.material, -w * 0.6, -h * 0.6, w * 1.2, h * 1.2,
    0.2 + (b.id % 9) / 45, 0.14, 0.45, 0.69);
  ctx.strokeStyle = fractureRim[b.material];
  ctx.lineWidth = 0.8;
  ctx.lineCap = 'butt';
  ctx.stroke(paths.edge);
  // The center of mass of a splinter can sit off-center in its bounding box.
  drawCharcoal(ctx, b, -w * 0.72, -h * 0.72, w * 1.44, h * 1.44);
  ctx.restore();
}

function drawTorch(ctx, b) {
  // The wick is eight world pixels above the body's center. Its last lit
  // world position can be far away after the fixture detaches and rolls.
  line(ctx, '#4a3327', 2.7, 0, b.height * 0.47, 0, -7);
  line(ctx, '#997347', 1.1, -0.4, b.height * 0.45, -0.5, -7);
  polygon(ctx, '#576065', [-2.4, -7, 2.4, -7, 1.3, -4, -1.2, -4], '#382e2a', 0.6);
  line(ctx, '#b9a684', 0.8, -2.3, -7, 2.1, -7);
}

function drawCatapult(ctx, ammo, time, recovery, ready, theme, reduced, contact, active, distant) {
  const recoil =
    !reduced && recovery < 0.54 ? Math.sin((Math.PI * recovery) / 0.54) * (1 - recovery / 0.54) * 2.7 : 0;
  ctx.save();
  ctx.translate(-recoil, 0);
  ctx.drawImage(contact, 24, GROUND - 3, 168, 8);
  const baseX = 29,
    baseY = 293,
    baseW = 158,
    baseH = GROUND - baseY;
  const pivotX = baseX + baseW * 0.487,
    pivotY = baseY + baseH * 0.084;
  const armW = Math.hypot(160 - pivotX, 326 - pivotY) / 0.6205,
    armH = armW * 0.201;
  const cupX = armW * 0.619,
    cupY = -armH * 0.222;
  const rest = Math.atan2(326 - pivotY, 160 - pivotX) - Math.atan2(cupY, cupX);
  const flick =
    recovery < 0.16
      ? -Math.sin(((recovery / 0.16) * Math.PI) / 2) * 1.15
      : -Math.pow((1 - recovery) / 0.84, 2) * 1.15;
  const theta = rest + flick;
  const armX = -armW * 0.307, armY = -armH * 0.378;
  if (active) {
    // Both rims sit behind both sprites, so the arm crossing the chassis
    // doesn't put a bright seam through the middle of the machine.
    ctx.save();
    ctx.globalAlpha *= reduced ? 0.88 : 0.77 + Math.sin(time * 2.5) * 0.19;
    drawCatapultOutline(ctx, 'chassis', baseX, baseY, baseW, baseH, distant);
    ctx.translate(pivotX, pivotY);
    ctx.rotate(theta);
    drawCatapultOutline(ctx, 'arm', armX, armY, armW, armH, distant);
    ctx.restore();
  }
  sprite(ctx, 'chassis', baseX, baseY, baseW, baseH);
  const slingX = pivotX + cupX * Math.cos(theta) - cupY * Math.sin(theta);
  const slingY = pivotY + cupX * Math.sin(theta) + cupY * Math.cos(theta);
  line(ctx, '#594a34', 1.4, 165, 344, (165 + slingX) * 0.5 + 1, (344 + slingY) * 0.5 + 2, slingX, slingY + 2);
  line(
    ctx,
    '#d3b17a',
    0.55,
    165,
    344,
    (165 + slingX) * 0.5 + 1,
    (344 + slingY) * 0.5 + 2,
    slingX,
    slingY + 2,
  );
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(theta);
  sprite(ctx, 'arm', armX, armY, armW, armH);
  ellipse(ctx, '#93723e', 0, 0, 2.0, 2);
  ellipse(ctx, '#ecce8c', -0.55, -0.6, 0.85, 0.8);
  ctx.restore();
  if (ready) {
    ctx.save();
    ctx.translate(slingX, slingY - 0.7);
    drawAmmo(ctx, ammo, ammo === 'siege-bomb' ? 12 : ammo.startsWith('big') ? 9.2 : 7, time);
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
  const role = theme === 1 ? 'gnome' : theme === 4 ? 'elf' : 'dwarf';
  const gesture = !reduced && (time + 0.7) % 5.2 < 0.95 ? '-idle' : '';
  const pose = !reduced && recovery < 0.82 ? '-action' : gesture;
  const height = role === 'elf' ? 33 : role === 'gnome' ? 29 : 30;
  const width = role === 'dwarf' ? 24 : 20.5;
  ctx.drawImage(contact, 198 - width * 0.65, GROUND - 1.7, width * 1.3, 4.7);
  if (!sprite(ctx, role + pose, 198 - width * 0.5, GROUND - height, width, height))
    sprite(ctx, role, 198 - width * 0.5, GROUND - height, width, height);
}

function prepareTrajectory(ctx, points, targetX) {
  if (points.length < 2) return null;
  const start = points[0], path = new Path2D();
  path.moveTo(start.x, start.y);
  const direction = Math.sign(points[1].x - start.x);
  const targeted = (targetX - start.x) * direction > 0;
  let remaining = targeted ? Infinity : 800, endX = start.x;
  for (let i = 1; i < points.length && remaining > 0; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const reached = targeted && dx * direction > 0 && (b.x - targetX) * direction >= 0;
    const part = reached ? clamp((targetX - a.x) / dx, 0, 1) : Math.min(1, remaining / length);
    endX = a.x + dx * part;
    path.lineTo(endX, a.y + dy * part);
    if (reached) break;
    remaining -= length;
  }
  const outline = ctx.createLinearGradient(start.x, 0, endX, 0);
  outline.addColorStop(0, '#352b20ee');
  outline.addColorStop(0.65, '#352b20d9');
  outline.addColorStop(1, targeted ? '#352b20bb' : '#352b2000');
  const gold = ctx.createLinearGradient(start.x, 0, endX, 0);
  gold.addColorStop(0, '#fff2cb');
  gold.addColorStop(0.65, '#ffdc91');
  gold.addColorStop(1, targeted ? '#ffdc91dd' : '#ffdc9100');
  return { path, outline, gold };
}

function drawTrajectory(ctx, guide, pixel, recovery) {
  if (!guide) return;
  ctx.save();
  const opacity = 0.44 + 0.56 * recovery;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([2.8 * pixel, 9 * pixel]);
  ctx.strokeStyle = guide.outline;
  // Feather the offset shadow in screen pixels, reusing the cached dashed path
  // and its end fade. This avoids a full-arc blur surface on each 4K frame.
  ctx.save();
  ctx.translate(0.6 * pixel, 1.8 * pixel);
  ctx.globalAlpha = opacity * 0.09;
  ctx.lineWidth = 10.5 * pixel;
  ctx.stroke(guide.path);
  ctx.globalAlpha = opacity * 0.16;
  ctx.lineWidth = 7.8 * pixel;
  ctx.stroke(guide.path);
  ctx.globalAlpha = opacity * 0.29;
  ctx.lineWidth = 5.7 * pixel;
  ctx.stroke(guide.path);
  ctx.restore();
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 4 * pixel;
  ctx.stroke(guide.path);
  ctx.lineWidth = 1.9 * pixel;
  ctx.strokeStyle = guide.gold;
  ctx.stroke(guide.path);
  ctx.restore();
}

function drawGuard(ctx, b, t, launchAge, reduced, screenScale, shotTime) {
  const reaction = 0.2 + Math.max(0, b.x - 500) * 0.00045 + (b.id % 3) * 0.03;
  const alerted = !reduced && launchAge > reaction && launchAge < reaction + 1.35;
  const gesture = !reduced && (t + b.id * 0.74) % 5.7 < 0.67;
  const pose = alerted ? 'guard-action' : gesture ? 'guard-idle' : 'guard';
  const overview = clamp((61 - b.height * screenScale) / 23, 0, 1);
  const tiny = clamp((38 - b.height * screenScale) / 28, 0, 1);
  const w = b.width * (1.21 + 0.43 * tiny);
  const h = b.height * (1.16 + 0.32 * tiny) * (alerted ? 0.91 : 1);
  const foot = b.rig ? 19.5 : b.height / 2;
  const age = shotTime - (b.firedAt ?? -Infinity);
  const drawing = b.drawingBolt;
  const recovery = age >= 0 && age < 0.44;
  if ((drawing || recovery) && Math.abs(b.angle) < 0.65) {
    const aim = b.gunAngle - b.angle;
    const facing = Math.cos(aim) < 0 ? -1 : 1;
    const frame = drawing ? (shotTime - b.drawStartedAt < 0.065 ? 0 : 1)
      : age < 0.15 ? 2 : age < 0.28 ? 1 : 0;
    ctx.save();
    ctx.translate(0, foot);
    ctx.scale(facing, 1);
    const pitch = Math.atan2(Math.sin(aim), Math.abs(Math.cos(aim)));
    drawCrossbowPose(ctx, reduced ? 1 : frame, pitch, b.height * (1.18 + 0.31 * tiny));
    ctx.restore();
    return;
  }
  drawGuardShadow(ctx, pose, -w / 2, foot - h, w, h);
  if (b.rig && !b.rig.resting) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    for (let i = 0; i < 2; i++) {
      const leg = b.rig.legs[i].body;
      const dx = leg.position.x - b.x, dy = leg.position.y - b.y;
      ctx.save();
      ctx.translate(c * dx + s * dy, c * dy - s * dx);
      ctx.rotate(leg.angle - b.angle);
      const side = i ? 1 : -1;
      sampleGuard(ctx, pose, overview, i * 0.5, 0.67, 0.5, 0.33,
        side * (w * 0.25 - 6.2) - w * 0.25, -5.85, w * 0.5, 11.35);
      ctx.restore();
    }
    sampleGuard(ctx, pose, overview, 0, 0, 1, 0.71, -w / 2, foot - h, w, h * 0.71);
  } else sampleGuard(ctx, pose, overview, 0, 0, 1, 1, -w / 2, foot - h, w, h);


}

function drawGuardBolts(ctx, sim, reduced, screenScale) {
  for (const bolt of sim.guardBolts || []) {
    ctx.save();
    ctx.translate(bolt.x, bolt.y);
    const angle = Math.atan2(bolt.dirY, bolt.dirX);
    const travel = Math.max(0, sim.time - bolt.born) * bolt.speed;
    if (travel < 36) {
      const guard = sim.entities.get(bolt.guardId);
      if (guard) {
        const aim = angle - guard.angle, facing = Math.cos(aim) < 0 ? -1 : 1;
        const pitch = Math.atan2(Math.sin(aim), Math.abs(Math.cos(aim)));
        const [tipX, tipY] = crossbowTip(pitch, reduced);
        const tiny = clamp((38 - guard.height * screenScale) / 28, 0, 1);
        const unit = guard.height * (1.18 + 0.31 * tiny) / 268;
        const x = facing * tipX * unit, y = (guard.rig ? 19.5 : guard.height / 2) + tipY * unit;
        const c = Math.cos(guard.angle), s = Math.sin(guard.angle);
        const originX = bolt.x - travel * bolt.dirX, originY = bolt.y - travel * bolt.dirY;
        const fade = (1 - travel / 36) ** 2;
        ctx.translate(fade * clamp(guard.x + c * x - s * y - originX, -28, 28),
          fade * clamp(guard.y + s * x + c * y - originY, -28, 28));
      }
    }
    ctx.rotate(angle);
    // The short draw offset has faded completely once the bolt clears its shooter.
    const scale = Math.min(1.65, Math.max(1, 0.9 / screenScale));
    ctx.scale(scale, scale);
    if (!reduced) line(ctx, '#e6cb8b85', 1.6, -22, 0, -5, 0);
    line(ctx, '#29271e', 2.8, -12, 0, -1, 0);
    line(ctx, '#dcb679', 1.1, -12, -0.3, -1, -0.3);
    polygon(ctx, '#b65e46', [-13, -2.1, -8, -1.5, -6.7, 0, -11.5, 0]);
    polygon(ctx, '#ece4ca', [-4.5, -1.6, 0, 0, -4.8, 1.5]);
    ctx.restore();
  }
}

const DEFAULT_VIEW = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const effects = createEffects();
  const weather = createWeatherEffects(canvas.parentElement?.querySelector('#weather-sky'));
  charcoal ||= paintCharcoal();
  const backdrop = document.getElementById('scenery');
  const state = {
    effects,
    shadows: buildShadows(),
    rooms: null,
    stairArt: paintStairs(),
    stairFloors: null,
    terrain: null,
    terrainSource: null,
    terrainLayout: null,
    launchTime: -10,
    lastTime: null,
    aim: null,
    aimKey: '',
  };
  function reset() {
    weather.reset();
    state.rooms = null;
    state.stairFloors = null;
    state.terrain = null;
    state.terrainLayout = null;
    state.launchTime = -10;
    state.lastTime = null;
    state.aimKey = '';
    effects.reset();
  }
  function prepareChambers(phase) {
    state.shadows.rooms[phase] = {
      gothic: paintChamber('gothic', phase),
      timbered: paintChamber('timbered', phase),
      royal: paintChamber('royal', phase),
      open: paintGallery(false),
      balcony: paintGallery(true),
      ...Object.fromEntries(facadeStyles.map((style) => [style, paintFacade(style, phase)])),
    };
  }
  async function prepareArchitecture() {
    prepareRoofArt();
    await prepareFacadeArt();
    for (const phase of ['day', 'dawn', 'dusk', 'night']) prepareChambers(phase);
  }
  function prepare(sim, scenery, bodies) {
    const phase = sim.level?.phase || 'day';
    if (!state.shadows.rooms[phase]) prepareChambers(phase);
    if (state.terrainSource === scenery && state.terrainLayout === sim.terrain && state.terrain) return;
    if (!scenery?.complete || !scenery.naturalWidth) return;
    state.terrain = paintTerrain(
      sim.terrain,
      scenery,
      sim.level?.phase || 'day',
      state.terrain,
      sim.level.terrain,
    );
    if (state.terrainLayout !== sim.terrain) state.aimKey = '';
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
    if (!state.shadows.rooms[phase]) prepareChambers(phase);
    prepareSprites(phase, w / view.width);
    const events = options.events || [];
    for (const event of events) {
      if (event.type !== 'launch') continue;
      state.launchTime = t;
    }
    const bodies = sim.bodies;
    const wind = sim.wind ?? sim.level?.wind ?? 0;
    effects.update(
      events,
      bodies,
      dt,
      t,
      reducedMotion,
      sim.themeIndex ?? sim.levelIndex,
      phase,
      sim.terrain,
      wind,
      sim.time,
      sim.level?.weather,
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
    weather.drawSky(ctx, sim, view, t, reducedMotion, dt, wind);
    weather.drawAir(ctx, sim, bodies, view, t, reducedMotion, wind, cssW, false);
    if (state.terrain) {
      const g = state.terrain;
      ctx.drawImage(g.canvas, g.left, g.top, g.width, g.height);
    }
    drawGroundShadows(ctx, sim, bodies, state.shadows, state.rooms, view, state.terrain?.top ?? GROUND - 90);
    ambient(ctx, ambientTime, sim.themeIndex ?? sim.levelIndex);
    effects.drawBehind(ctx);
    const age = t - state.launchTime;
    for (const side of launcherSides) {
      const sling = sim.level?.catapults?.[side];
      if (!sling || sling.x + 155 < view.x || sling.x - 155 > view.x + view.width) continue;
      const recovery = sim.recovery(side);
      ctx.save();
      ctx.translate(sling.x, sling.y);
      if (side === 'right') ctx.scale(-1, 1);
      // The cached chassis, arm and crew artwork share this local cup position.
      ctx.translate(-160, -326);
      drawCatapult(ctx, ammo, ambientTime, recovery, recovery === 1,
        sim.themeIndex ?? sim.levelIndex, reducedMotion, state.shadows.contact, side === sim.side, cssW / view.width < 0.65);
      ctx.restore();
    }
    drawRooms(ctx, state, sim, bodies, ambientTime, wind);
    state.stairFloors ||= bodies.filter((b) => b.stairs);
    for (const floor of state.stairFloors) {
      if (!sim.entities.has(floor.id)) continue;
      const width = floor.width - 9;
      const rise = sim.level.sections[0].storey - floor.height + 1;
      ctx.save();
      ctx.translate(floor.x, floor.y);
      ctx.rotate(floor.angle);
      if (floor.stairs === 'left') ctx.scale(-1, 1);
      ctx.drawImage(state.stairArt, -width / 2, -floor.height / 2 - rise, width, rise + 1);
      ctx.restore();
    }
    // One transform per piece avoids pushing the entire canvas drawing state for each body.
    ctx.save();
    const cameraX = shake.x - view.x,
      cameraY = shake.y - view.y;
    for (const b of bodies) {
      if (b.x + b.width < view.x || b.x - b.width > view.x + view.width) continue;
      const angle = b.angle || 0,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      ctx.setTransform(
        scaleX * cos,
        scaleY * sin,
        -scaleX * sin,
        scaleY * cos,
        (b.x + cameraX) * scaleX,
        (b.y + cameraY) * scaleY,
      );

      if (b.kind === 'orc' && b.body.speed < 0.6 && Math.abs(b.angle) < 0.4) {
        ctx.drawImage(state.shadows.contact, -b.width * 0.76, b.rig ? 16.7 : b.height * 0.39, b.width * 1.7, b.height * 0.24);
      } else if (b.kind === 'barrel' && b.body.speed < 0.4 && Math.abs(b.angle) < 0.4) {
        ctx.drawImage(
          state.shadows.contact,
          -b.width * 0.62,
          b.rig ? 17.5 : b.height * 0.41,
          b.width * 1.38,
          b.height * 0.18,
        );
      }
      if (b.kind === 'orc') drawGuard(ctx, b, ambientTime, age, reducedMotion, cssW / view.width, sim.time);
      else if (b.kind === 'barrel')
        sprite(ctx, 'keg', -b.width * 0.53, -b.height * 0.69, b.width * 1.06, b.height * 1.19);
      else if (b.kind === 'torch') drawTorch(ctx, b);
      else if (b.kind === 'projectile' && !b.vertices) drawAmmo(ctx, b.material, b.radius || b.width / 2, ambientTime, true);
      else if (b.kind === 'fragment' || b.detail === 'split-shot') drawFragment(ctx, b);
      else drawBlock(ctx, b, ambientTime, wind);
    }
    ctx.restore();
    drawGuardBolts(ctx, sim, reducedMotion, cssW / view.width);
    if (options.aiming !== false) {
      // A gust changes the upcoming arc even while the pointer stays still.
      const windFrame = sim.level?.gust ? Math.floor(sim.weatherTick / 6) : 0;
      const key = [sim.side, ammo, angle, power, options.aimTargetX, windFrame, sim.terrainVersion].join('/');
      if (state.aimKey !== key) {
        state.aimKey = key;
        state.aim = prepareTrajectory(ctx, sim.trajectory(ammo, angle, power), options.aimTargetX);
      }
      const pixel = view.width / cssW * clamp(cssW / 1600, 1, 1.65);
      drawTrajectory(ctx, state.aim, pixel, sim.recovery(sim.side));
    }
    weather.drawAir(ctx, sim, bodies, view, t, reducedMotion, wind, cssW, true);
    effects.drawFront(ctx);
    ctx.restore();
  }
  return { draw, reset, prepare, prepareArchitecture };
}
