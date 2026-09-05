import { drawSprite, drawSpriteShadow, drawProp, drawPropShadow, terrainImages, assetsReady } from './assets.js';
import { powerStats, UNITS, mapLayout, unitRank } from './sim.js';

const TILE = 32;
const TEAM = [
  { light: '#dcf1ff', paint: '#2d7cf2', dark: '#163b75', glow: '#79bcff' },
  { light: '#ffd8d5', paint: '#d8344c', dark: '#6d142b', glow: '#ff7582' },
];
const SIZES = { core: 3, reactor: 2, refinery: 3, barracks: 2, factory: 3, turret: 1, rocketTower: 2 };
const BUILDINGS = new Set(Object.keys(SIZES));
const isInfantry = e => UNITS[e.type]?.armor === 'infantry';

function polygon(ctx, points, fill, stroke) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}
function teamInsignia(ctx, team, x, y, size) {
  const t = TEAM[team] || TEAM[0], r = size / 2;
  const shape = team ? [[x, y - r], [x + r, y], [x, y + r], [x - r, y]]
    : [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  polygon(ctx, shape, t.paint, t.light);
}
function ellipse(ctx, x, y, rx, ry, fill, stroke) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function line(ctx, x, y, tx, ty, color, width = 1) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function noise(x, y, seed = 0) {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 73.13) * 43758.5453;
  return v - Math.floor(v);
}
function smoothNoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (noise(ix, iy, seed) * (1 - u) + noise(ix + 1, iy, seed) * u) * (1 - v)
    + (noise(ix, iy + 1, seed) * (1 - u) + noise(ix + 1, iy + 1, seed) * u) * v;
}
function glow(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color); gradient.addColorStop(1, color.slice(0, 7) + '00');
  ellipse(ctx, x, y, radius, radius, gradient);
}
function rock(ctx, x, y, size, variant) {
  if (drawProp(ctx, 'rock', x, y, size, variant)) return;
  ctx.save(); ctx.translate(x, y);
  const r = size * .5;
  ellipse(ctx, 6, 7, r, r * .6, '#10141675');
  polygon(ctx, [[-r, 3], [-r * .7, -r * .6], [-r * .15, -r], [r * .7, -r * .6], [r, 2], [r * .3, r * .45], [-r * .65, r * .4]], '#4a4945', '#292c2c');
  polygon(ctx, [[-r, 3], [-r * .7, -r * .6], [-r * .15, -r], [r * .25, -r * .4], [-r * .2, r * .2]], '#8b8271');
  polygon(ctx, [[-r * .15, -r], [r * .7, -r * .6], [r, 2], [-r * .2, r * .2], [r * .25, -r * .4]], '#67645b');
  line(ctx, -r * .7, -r * .6, -r * .15, -r, '#c2b39770');
  line(ctx, -r * .1, -r * .3, r * .1, r * .18, '#282d2e88');
  ctx.restore();
}
function construction(ctx, entity, time) {
  const s = (entity.size || SIZES[entity.type]) * TILE, p = entity.progress;
  ctx.save();
  ctx.beginPath(); ctx.rect(-s, s * .5 - s * 1.6 * p, s * 2, s * 1.6 * p); ctx.clip();
  drawSprite(ctx, entity, time);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = '#89dce08c'; ctx.lineWidth = .7;
  ctx.strokeRect(-s * .49, -s * .49, s * .98, s * .98);
  ctx.setLineDash([3, 4]); ctx.strokeRect(-s * .44, -s * .44, s * .88, s * .88); ctx.setLineDash([]);
  const scan = s * (.5 - p * 1.6);
  line(ctx, -s * .48, scan, s * .48, scan, '#b8f1f4a0', 1);
  glow(ctx, Math.sin(time * 3) * s * .4, scan, 6, '#a4eff2bb');
  rect(ctx, -s * .43, s * .55, s * .86, 3, '#0c151deb');
  rect(ctx, -s * .43, s * .55, s * .86 * p, 2, '#9de4e5');
  ctx.restore();
}
function box(ctx, x, y, w, d, h, roof = '#777c71', wall = '#454b46') {
  rect(ctx, x + 5, y + 5, w, d, '#151a17aa');
  polygon(ctx, [[x, y - h], [x + w, y - h], [x + w, y + d - h], [x, y + d - h]], roof, '#252d29');
  polygon(ctx, [[x, y + d - h], [x + w, y + d - h], [x + w, y + d], [x, y + d]], wall, '#252d29');
  line(ctx, x, y - h, x + w, y - h, '#c5c3a662');
  line(ctx, x, y - h, x, y + d - h, '#c5c3a642');
  line(ctx, x + w - 1, y - h + 1, x + w - 1, y + d - h, '#202d2960');
}
function vent(ctx, x, y, w, h) {
  rect(ctx, x, y, w, h, '#303e39');
  for (let yy = y + 2; yy < y + h - 1; yy += 3) line(ctx, x + 2, yy, x + w - 2, yy, '#8a948176');
}
function light(ctx, x, y, color, time = 0) {
  ctx.shadowColor = color; ctx.shadowBlur = 5;
  rect(ctx, x, y, 2, 2, color);
  ctx.shadowBlur = 0;
}
function crystal(ctx, x, y, scale, seed) {
  const h = (5 + noise(seed, 2) * 7) * scale;
  const w = (3 + noise(seed, 3) * 3) * scale;
  polygon(ctx, [[x - w, y], [x - w * .5, y - h * .8], [x + w * .25, y - h], [x + w, y - h * .22], [x + w * .4, y + 2 * scale]], '#51b8a5', '#1e685f');
  polygon(ctx, [[x - w * .5, y - h * .8], [x + w * .25, y - h], [x, y], [x - w, y]], '#9eecce');
  line(ctx, x + w * .25, y - h, x, y, '#d3ffe2', .8);
}

function buildingActivity(ctx, e, time, power) {
  const s = e.size * TILE, t = TEAM[e.team], working = !!e.queue?.length;
  const processing = e.processingAmount > 0;
  if (['barracks', 'factory', 'refinery'].includes(e.type) && !working && !processing) return;
  const rate = e.type === 'reactor' || e.type === 'core' ? 1 : Math.max(.2, power);
  const phase = time * rate + e.id * .37;
  ctx.save(); ctx.globalAlpha *= power < 1 && rate < 1 ? .55 : .85;
  const fan = (x, y, radius, speed = 2) => {
    ellipse(ctx, x, y, radius, radius * .7, '#15232acc', '#a7b7b75c');
    for (let i = 0; i < 4; i++) {
      const angle = phase * speed + i * Math.PI / 2;
      line(ctx, x, y, x + Math.cos(angle) * (radius - 1), y + Math.sin(angle) * (radius - 1) * .7, '#bac5c18f', 1.3);
    }
    ellipse(ctx, x, y, 1.3, 1, '#d5dacf');
  };
  if (e.type === 'core') {
    const x = s * .14, y = -s * .38, angle = phase * .75;
    ellipse(ctx, x, y, 8, 5.5, '#2031399c', '#a7b7b775');
    ctx.save(); ctx.translate(x, y); ctx.scale(1, .7);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 7, angle - .75, angle); ctx.closePath();
    ctx.fillStyle = t.paint + '60'; ctx.fill();
    line(ctx, 0, 0, Math.cos(angle) * 7, Math.sin(angle) * 7, t.light, .9); ctx.restore();
    light(ctx, -s * .24, -s * .45, Math.sin(phase * 2.5) > .4 ? '#f4c784' : '#806743');
    if (processing) for (let i = 0; i < 3; i++) {
      const p = (phase * .45 + i / 3) % 1, x = (i - 1) * 4, y = s * (.43 - p * .12);
      polygon(ctx, [[x - 1.5, y], [x, y - 2], [x + 1.5, y], [x, y + 1]], '#a4ddc8');
    }
  } else if (e.type === 'reactor') {
    for (const x of [-s * .16, s * .17]) fan(x, -s * .37, s * .072, 4);
    ctx.save(); ctx.globalAlpha *= .45 + Math.sin(phase * 2.2) * .15;
    glow(ctx, 0, s * .04, s * .1, t.glow + '80'); ctx.restore();
  } else if (e.type === 'refinery') {
    if (processing) {
      // The belt runs only while an actual delivery remains in the processing hopper.
      for (let i = 0; i < 5; i++) {
        const p = (phase * .19 + i / 5) % 1, x = s * (-.32 + p * .43), y = s * (.12 - p * .40);
        polygon(ctx, [[x - 1.8, y], [x, y - 2], [x + 2, y], [x, y + 1]], '#b1e8d2');
      }
      fan(-s * .17, s * .12, s * .035);
      light(ctx, -s * .06, s * .28, Math.sin(phase * 3) > 0 ? '#b6efd5' : '#466e5e');
    }
    if (working) light(ctx, s * .08, s * .33, Math.sin(phase * 4) > 0 ? '#f1c58b' : '#8c6840');
  } else if (e.type === 'barracks') {
    fan(s * .06, -s * .16, s * .048);
    light(ctx, s * .025, -s * .55, Math.sin(phase * 2.3) > .5 ? t.light : t.dark);
    if (working) {
      const stride = (phase * .6) % 1;
      for (let i = 0; i < 3; i++) rect(ctx, -7 + i * 6, s * .25, 3, 1.5, stride > i / 3 ? '#ebc68f' : '#64553c');
    }
  } else if (e.type === 'factory') {
    fan(s * .31, -s * .18, s * .032);
    if (working) {
      const x = Math.sin(phase * 1.6) * s * .09, y = s * .21;
      ctx.save(); ctx.globalAlpha *= .5 + Math.sin(phase * 23) * .25;
      glow(ctx, x, y, 9, '#c7eeff8f');
      for (let i = 0; i < 3; i++) {
        const age = (phase * 3 + i / 3) % 1;
        line(ctx, x + age * (i - 1) * 10, y + age * 5, x + age * (i - 1) * 12, y + age * 7, '#ffe0a9b0', .7);
      }
      ctx.restore();
      const door = Math.max(0, (e.queue[0].progress - .8) / .2);
      line(ctx, -s * .15, s * (.15 - door * .035), s * .15, s * (.15 - door * .035), '#dcb46b9c', 1.4);
    }
  } else if (e.type === 'rocketTower') {
    const ready = power >= 1, firing = Math.max(0, 1 - (time - (e.lastShot ?? -99)) / .35);
    for (const x of [-s * .28, s * .28]) {
      light(ctx, x, s * .26, !ready ? '#70533b' : e.cooldown > .1 ? '#bb8d51' : t.light);
    }
    if (ready && firing > 0) {
      ctx.globalAlpha *= firing;
      glow(ctx, -s * .231, -s * .405, 12, '#ffcf8aac');
    }
  } else if (e.type === 'turret') {
    const angle = e.targetId ? e.angle : phase * .3, recoil = Math.max(0, 1 - (time - (e.lastShot ?? -99)) / .22);
    const reach = 13 - recoil * 3;
    ctx.save(); ctx.translate(0, -7); ctx.scale(1, .8);
    ctx.beginPath(); ctx.arc(0, 0, reach, angle - .2, angle + .2);
    ctx.strokeStyle = e.targetId ? '#eec48e' : t.paint + '9c'; ctx.lineWidth = 1.5; ctx.stroke();
    if (recoil > 0 && power >= 1) {
      ctx.globalAlpha *= recoil;
      glow(ctx, Math.cos(angle) * 17, Math.sin(angle) * 17, 6, '#ffe0a9a0');
    }
    ctx.restore();
  }
  ctx.restore();
}

function productionBay(ctx, e) {
  if (!['barracks', 'factory', 'refinery'].includes(e.type)) return;
  const small = e.type === 'barracks', s = e.size * TILE;
  const w = s * (small ? .52 : .58), top = s * .09, bottom = s * .44;
  const job = e.queue?.[0], progress = Math.max(0, Math.min(1, job?.progress || 0));
  ctx.save();
  // An open, recessed work bay replaces the permanently occupied entrance in the art.
  polygon(ctx, [[-w / 2, top], [w / 2, top], [w / 2 + 2, bottom], [-w / 2 - 2, bottom]], '#141a1c', '#4c5654');
  const floor = ctx.createLinearGradient(0, top, 0, bottom);
  floor.addColorStop(0, '#1b2224'); floor.addColorStop(1, '#303633');
  rect(ctx, -w / 2 + 2, top + 3, w - 4, bottom - top - 4, floor);
  for (let y = top + 6; y < bottom; y += 5) line(ctx, -w / 2 + 3, y, w / 2 - 3, y, '#75807935', .5);
  polygon(ctx, [[-w / 2 - 2, bottom], [w / 2 + 2, bottom], [w / 2 + 2, bottom + 3], [-w / 2 - 2, bottom + 3]], '#141a1c');
  for (const x of [-w / 2 - 1, w / 2 + 1]) {
    line(ctx, x, top, x, bottom, '#909c91', 1.1);
    for (let y = top + 3; y < bottom; y += 7) line(ctx, x, y, x, y + 3, '#87754d', 1.2);
  }
  if (job && UNITS[job.type]) {
    const center = (top + bottom) / 2;
    const infantry = UNITS[job.type].armor === 'infantry';
    const unit = { type: job.type, team: e.team, angle: infantry ? Math.PI / 2 : 0, cargo: 0, moving: infantry, id: e.id };
    const scale = infantry ? .72 : small ? .70 : .85;
    const poseTime = progress * UNITS[job.type].trainTime;
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2 + 2, top + 2, w - 4, bottom - top - 3); ctx.clip();
    ctx.translate(0, center); ctx.scale(scale, scale);
    if (!infantry) {
      ctx.save(); ctx.globalAlpha *= .27; ctx.filter = 'grayscale(1)'; drawSprite(ctx, unit, poseTime); ctx.restore();
      ctx.beginPath(); ctx.rect(-40, -32, 80, 8 + progress * 58); ctx.clip();
    }
    drawSprite(ctx, unit, poseTime); ctx.restore();
    // A crossbeam advances over the emerging chassis; an empty bay has no machinery light.
    if (!infantry) {
      const gantry = top + 5 + progress * (bottom - top - 10);
      line(ctx, -w / 2, gantry, -w * .20, gantry, '#97a5a4', 2);
      line(ctx, w / 2, gantry, w * .20, gantry, '#97a5a4', 2);
    }
    line(ctx, -w / 2 + 3, top + 1, w / 2 - 3, top + 1, '#e8bd78', 1.5);
  } else line(ctx, -w / 2 + 3, top + 1, w / 2 - 3, top + 1, '#485757', 1.5);
  ctx.restore();
}

function building(ctx, entity, time = 0) {
  ctx.save();
  if (entity.progress < 1) ctx.globalAlpha *= .24;
  const spriteDrawn = drawSprite(ctx, entity, time);
  ctx.restore();
  if (spriteDrawn) {
    if (entity.progress < 1) construction(ctx, entity, time);
    else productionBay(ctx, entity);
    return;
  }
  const { type, team = 0 } = entity;
  const t = TEAM[team] || TEAM[0];
  const s = (entity.size || SIZES[type] || 2) * TILE;
  const w = s - 8, a = -w / 2;
  ctx.save();
  ellipse(ctx, 5, 8, s * .53, s * .39, '#151d1c55');
  rect(ctx, a - 2, a, w + 4, w, '#363e38');
  rect(ctx, a, a + 2, w, w - 4, '#666c59');
  ctx.strokeStyle = '#252f29'; ctx.lineWidth = 1;
  ctx.strokeRect(a + 3, a + 5, w - 6, w - 10);
  for (let x = a + 6; x < w / 2 - 3; x += 10) {
    rect(ctx, x, w / 2 - 5, 5, 2, '#b4a969');
    rect(ctx, x, a + 3, 5, 2, '#b4a969');
  }

  if (type === 'core') {
    box(ctx, -35, -24, 70, 57, 11, '#707d77', '#3c4c4a');
    box(ctx, -27, -29, 54, 39, 8, '#8f9d8d', '#546c66');
    polygon(ctx, [[-28, -27], [0, -40], [28, -27], [27, -9], [0, -15], [-27, -9]], '#8e9b8a', '#435851');
    rect(ctx, -4, -33, 8, 42, t.paint);
    rect(ctx, -30, 15, 60, 7, '#243a39');
    for (let x = -26; x <= 24; x += 10) {
      rect(ctx, x, 16, 6, 3, t.light); rect(ctx, x, 19, 6, 1, t.paint);
    }
    box(ctx, -14, 25, 28, 10, 6, '#6d8179', '#344c46');
    vent(ctx, -24, -12, 13, 15); vent(ctx, 11, -12, 13, 15);
    line(ctx, 22, -22, 22, -56, '#192c2b', 3);
    line(ctx, 22, -22, 22, -57, '#a7b7a0');
    ellipse(ctx, 22, -47, 10, 3, '#4a6059', '#a1b7a4');
    line(ctx, 12, -47, 32, -47, t.paint, 2);
    light(ctx, 21, -58, Math.sin(time * 3) > 0 ? t.glow : t.dark);
    light(ctx, -34, 25, t.glow); light(ctx, 32, 25, t.glow);
    ctx.fillStyle = t.light; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText('01', 0, -19);
  } else if (type === 'reactor') {
    box(ctx, -22, -13, 44, 36, 5, '#738073', '#43534c');
    for (const x of [-11, 11]) {
      rect(ctx, x - 8, -21, 16, 34, '#3d5550');
      ellipse(ctx, x, 11, 8, 5, '#344a44');
      rect(ctx, x - 8, -25, 16, 31, '#7b9788');
      ellipse(ctx, x, -25, 8, 5, '#b5bba2', '#40574e');
      ellipse(ctx, x, -25, 5, 3, '#263d39');
      ellipse(ctx, x, -25, 3, 2, t.glow);
      rect(ctx, x - 7, -9, 14, 5, t.paint);
      line(ctx, x - 5, -20, x - 5, 5, '#c1c6a677');
    }
    box(ctx, -13, 13, 26, 10, 6, '#9ba68d', '#4c6256');
    for (let x = -8; x < 9; x += 5) light(ctx, x, 15, t.glow);
    if (entity.progress >= 1 && Math.sin(time * 4) > -.5) {
      ctx.globalAlpha = .09 + Math.sin(time * 2) * .035;
      ellipse(ctx, 0, -14, 27, 24, t.glow); ctx.globalAlpha = 1;
    }
  } else if (type === 'refinery') {
    box(ctx, -35, -28, 42, 55, 9, '#7c8274', '#454f44');
    vent(ctx, -29, -31, 17, 19);
    rect(ctx, -31, -4, 29, 6, t.paint);
    box(ctx, 10, -17, 24, 42, 8, '#a09576', '#5b6552');
    rect(ctx, 13, -21, 18, 27, '#273f36');
    for (let i = 0; i < 7; i++) crystal(ctx, 17 + (i % 3) * 5, -3 - Math.floor(i / 3) * 5, .6, i);
    rect(ctx, -6, -8, 23, 8, '#434f42');
    for (let x = -5; x < 15; x += 4) line(ctx, x, -7, x + 3, -1, '#9e9e77');
    box(ctx, -29, 17, 28, 20, 2, '#545d4c', '#35453a');
    for (let y = 18; y < 35; y += 5) line(ctx, -26, y, -4, y, '#acac8055');
    rect(ctx, -21, -35, 10, 5, t.paint);
    box(ctx, -32, -30, 8, 9, 22, '#94988b', '#4b594b');
    ellipse(ctx, -28, -52, 4, 2, '#243b34');
    light(ctx, 29, 15, t.glow);
  } else if (type === 'barracks') {
    box(ctx, -23, -18, 46, 40, 8, '#7d8674', '#46594c');
    polygon(ctx, [[-24, -21], [0, -33], [24, -21], [24, 5], [0, -2], [-24, 5]], '#98a38c', '#4d6052');
    for (let x = -18; x < 22; x += 6) line(ctx, x, -21 - (1 - Math.abs(x) / 24) * 10, x, 5 - (1 - Math.abs(x) / 24) * 7, '#4d665560');
    rect(ctx, -4, -30, 8, 32, t.paint);
    rect(ctx, -8, 9, 16, 14, '#22382f');
    rect(ctx, -6, 9, 12, 3, t.light);
    for (const x of [-19, 12]) { rect(ctx, x, 10, 7, 5, '#2c473c'); rect(ctx, x + 1, 11, 5, 2, t.paint); }
    rect(ctx, -10, 23, 20, 4, '#899278');
    line(ctx, 22, 5, 22, -30, '#babba0', 1.5);
    polygon(ctx, [[23, -30], [35, -27], [30, -20], [23, -22]], t.paint);
    light(ctx, -23, 17, t.glow);
  } else if (type === 'factory') {
    box(ctx, -36, -25, 72, 60, 11, '#6f7f70', '#425246');
    polygon(ctx, [[-36, -31], [0, -44], [36, -31], [36, 5], [0, -2], [-36, 5]], '#899881', '#435c4d');
    for (let x = -30; x < 36; x += 8) line(ctx, x, -31 - (1 - Math.abs(x) / 36) * 13, x, 5 - (1 - Math.abs(x) / 36) * 7, '#435d496f');
    rect(ctx, -36, -29, 8, 33, t.paint); rect(ctx, 28, -29, 8, 33, t.paint);
    rect(ctx, -21, 9, 42, 25, '#1c3029');
    rect(ctx, -19, 10, 38, 10, '#596b54');
    for (let y = 12; y < 20; y += 3) line(ctx, -18, y, 18, y, '#a0ad8466');
    rect(ctx, -21, 8, 42, 3, t.paint);
    for (const x of [-25, 22]) {
      rect(ctx, x, 9, 3, 25, '#b6a767');
      for (let y = 11; y < 34; y += 7) rect(ctx, x, y, 3, 3, '#384739');
    }
    line(ctx, -15, 26, -15, 42, '#bac198', 2); line(ctx, 15, 26, 15, 42, '#bac198', 2);
    box(ctx, -12, -25, 24, 14, 9, '#a2ad96', '#5b6e5a'); vent(ctx, -8, -32, 16, 7);
    for (const x of [-32, 30]) light(ctx, x, 20, t.glow);
  } else if (type === 'rocketTower') {
    box(ctx, -24, -20, 48, 44, 5, '#929b92', '#434e51');
    box(ctx, -12, -13, 24, 26, 12, t.paint, t.dark);
    for (const x of [-20, 5]) {
      box(ctx, x, -16, 15, 27, 16, '#d3d5c8', '#5b6463');
      for (let y = -29; y < -8; y += 8) ellipse(ctx, x + 7.5, y, 4.5, 3, '#1a2228', '#919c96');
    }
  } else if (type === 'turret') {
    polygon(ctx, [[-11, -8], [-5, -13], [8, -12], [13, -5], [11, 10], [-10, 11]], '#748473', '#334c3c');
    ellipse(ctx, 0, 0, 9, 7, '#243e34');
    ellipse(ctx, 0, -4, 8, 7, '#99ab92', '#425c49');
    ctx.save(); ctx.translate(0, -4); ctx.rotate(entity.angle || 0);
    rect(ctx, 0, -3, 18, 5, '#465e4d'); rect(ctx, 5, -2, 14, 2, '#b0bd9b');
    rect(ctx, -6, -5, 11, 10, t.paint); rect(ctx, -4, -4, 6, 3, t.light);
    ctx.restore(); light(ctx, -10, 7, t.glow);
  }
  const progress = entity.progress ?? 1;
  if (progress < 1) {
    ctx.fillStyle = '#172a20'; ctx.globalAlpha = (1 - progress) * .66;
    ctx.fillRect(a, a - 22, w, w + 22); ctx.globalAlpha = 1;
    for (let x = a + 2; x <= -a; x += 15) {
      line(ctx, x, a - 9, x, -a, '#c6ae79', 1);
      line(ctx, x, a - 9, Math.min(x + 15, -a), -a, '#8a9363aa');
    }
    for (let y = a; y < -a; y += 16) line(ctx, a, y, -a, y, '#8a9363');
    rect(ctx, a, -a + 5, w, 3, '#1a2923'); rect(ctx, a, -a + 5, w * progress, 3, t.glow);
  }
  ctx.restore();
}

function unit(ctx, entity, time = 0) {
  const t = TEAM[entity.team || 0] || TEAM[0];
  const angle = entity.angle || 0;
  const infantry = isInfantry(entity);
  const moving = entity.moving || entity.path?.length > 0;
  if (drawSprite(ctx, entity, time)) return;
  ellipse(ctx, 3, 4, infantry ? 5 : 15, infantry ? 3 : 10, '#111d195d');
  ctx.save(); ctx.rotate(angle);
  if (moving) {
    for (let i = 0; i < 4; i++) {
      const age = (time * .8 + i / 4 + (entity.id || 0) * .19) % 1;
      ctx.globalAlpha = (1 - age) * .16;
      ellipse(ctx, -(infantry ? 5 : 14) - age * 21, Math.sin(i * 7) * 5, (infantry ? 2 : 5) + age * 7, 3 + age * 5, '#d1bb86');
    }
    ctx.globalAlpha = 1;
  }
  if (infantry) {
    const stride = moving ? Math.sin(time * 17 + entity.id) * 2 : 0;
    rect(ctx, -3 + stride, -3, 5, 2, '#242f2b'); rect(ctx, -3 - stride, 2, 5, 2, '#242f2b');
    ellipse(ctx, -1, 0, 3.8, 4, t.paint, '#243d37');
    rect(ctx, -3, -3, 2, 6, '#b8baa0');
    if (entity.type === 'rocket') {
      rect(ctx, -6, -6, 5, 10, '#555f60');
      rect(ctx, -5, 2, 16, 4, '#dddccd'); rect(ctx, 9, 2, 3, 4, '#283236');
    } else { line(ctx, 1, 2, 8, 2, '#152e29', 2); line(ctx, 3, 1, 8, 1, '#aebfaa'); }
    ellipse(ctx, 0, -.5, 2.4, 2.4, '#c0c4a5');
    ellipse(ctx, 1, -.5, 1.8, 2.2, t.paint);
  } else if (entity.type === 'scout') {
    for (const x of [-9, 7]) for (const y of [-9, 6]) {
      rect(ctx, x, y, 6, 4, '#1e2e27'); line(ctx, x + 1, y + 1, x + 5, y + 1, '#67725b');
    }
    polygon(ctx, [[-12, -6], [8, -6], [14, -3], [14, 4], [7, 7], [-12, 6]], '#7e8f78', '#263f33');
    rect(ctx, -8, -5, 7, 10, t.paint);
    rect(ctx, 0, -4, 5, 8, '#24483c'); rect(ctx, 1, -3, 3, 6, '#83bdb0');
    ellipse(ctx, -2, 0, 4, 4, '#91a187'); rect(ctx, -1, -1, 10, 2, '#293e32');
    light(ctx, 11, -4, '#edebbb'); light(ctx, 11, 3, '#edebbb');
  } else {
    const isHarvester = entity.type === 'harvester';
    const isArtillery = entity.type === 'artillery';
    const length = isHarvester ? 28 : 27;
    for (const y of [-12, 7]) {
      rect(ctx, -length / 2, y, length, 6, '#223027');
      for (let x = -length / 2 + 2; x < length / 2; x += 4) rect(ctx, x, y + 1, 2, 4, '#606c55');
      line(ctx, -length / 2 + 1, y, length / 2 - 1, y, '#acaa7a77');
    }
    polygon(ctx, [[-14, -7], [9, -8], [15, -4], [15, 5], [9, 8], [-14, 7]], '#88927a', '#263d2e');
    rect(ctx, -11, -6, 4, 12, t.paint);
    line(ctx, -12, -7, 9, -7, '#bbc5a0');
    if (isHarvester) {
      rect(ctx, -9, -6, 13, 12, '#273f31'); rect(ctx, -8, -5, 11, 10, '#57734d');
      const load = Math.min(1, (entity.cargo || 0) / 200);
      for (let i = 0; i < 7; i++) if (i / 7 < load || !('cargo' in entity)) {
        crystal(ctx, -6 + (i % 3) * 3, 3 - Math.floor(i / 3) * 3, .34, i + 8);
      }
      box(ctx, 4, -6, 8, 12, 2, t.paint, t.dark);
      rect(ctx, 9, -5, 2, 9, '#b2dad0');
      rect(ctx, 15, -9, 3, 18, '#8e9c76');
      for (let y = -8; y < 9; y += 4) rect(ctx, 17, y, 4, 2, '#d1c194');
      light(ctx, 12, -6, '#fff2b8');
    } else {
      vent(ctx, -11, -5, 5, 10);
      ellipse(ctx, 0, 1, 8, 6, '#344b36');
      polygon(ctx, [[-6, -5], [4, -6], [9, -2], [8, 4], [2, 6], [-6, 4]], t.paint, '#304c3b');
      line(ctx, -5, -5, 4, -5, t.light);
      rect(ctx, 4, -2, isArtillery ? 26 : 17, 4, '#293d2e');
      rect(ctx, 5, -2, isArtillery ? 23 : 15, 2, '#bdc6a0');
      if (isArtillery) { rect(ctx, 25, -3, 6, 6, '#6a795a'); rect(ctx, -4, -3, 7, 6, '#a7b99a'); }
      else ellipse(ctx, -2, 0, 3, 3, '#a3b79a', '#567557');
      light(ctx, 11, -6, '#efedb4');
    }
  }
  ctx.restore();
}

export function drawIcon(canvas, type, team = 0, state = {}) {
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const w = bounds.width || 76, h = bounds.height || 64;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * .6);
  grad.addColorStop(0, team ? '#87524235' : '#73a3b525'); grad.addColorStop(1, '#10182000');
  rect(ctx, 0, 0, w, h, grad);
  ctx.translate(w / 2, h * .6);
  const size = SIZES[type] || 1;
  const scale = BUILDINGS.has(type) ? Math.min(w / (size * 40 + 8), h / (size * 38 + 15)) : Math.min(w / 50, h / 43);
  ctx.scale(scale, scale);
  const entity = { ...state, type, team, size, progress: state.progress ?? 1, angle: -.35, cargo: state.cargo ?? 0 };
  if (BUILDINGS.has(type)) building(ctx, entity);
  else unit(ctx, entity);
}

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.minimap = minimapCanvas; this.width = 0; this.height = 0;
    this.terrain = document.createElement('canvas');
    this.fog = document.createElement('canvas');
    this.fogLow = document.createElement('canvas');
    this.decals = document.createElement('canvas');
    this.rememberedBuildings = new Map();
    this.lastMinimap = -Infinity;
    assetsReady.then(() => { if (this.groundImage !== terrainImages.ground) this.terrainSource = null; });
    this.resize();
  }
  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width); this.height = Math.max(1, bounds.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.lastMinimap = -Infinity;
  }
  worldToScreen(x, y, view) {
    return { x: (x - view.x) * view.zoom + this.width / 2, y: (y - view.y) * view.zoom + this.height / 2 };
  }
  screenToWorld(x, y, view) {
    return { x: (x - this.width / 2) / view.zoom + view.x, y: (y - this.height / 2) / view.zoom + view.y };
  }
  drawIcon(canvas, type, team = 0) { drawIcon(canvas, type, team); }

  createTerrain(state) {
    const width = state.width * TILE, height = state.height * TILE;
    this.terrain.width = width; this.terrain.height = height;
    this.decals.width = width; this.decals.height = height;
    this.fog.width = state.width * 4; this.fog.height = state.height * 4;
    this.fogLow.width = state.width; this.fogLow.height = state.height;
    this.knownOre = new Float32Array(state.width * state.height);
    this.rememberedBuildings.clear();
    this.unitPositions = new Map(); this.seenEffects = new WeakSet();
    this.lastDecalFade = 0; this.fogVisible = null; this.fogExplored = null; this.rockProps = [];
    this.terrainSource = state.terrain;
    this.groundImage = terrainImages.ground;
    const ctx = this.terrain.getContext('2d');
    const seed = [...String(state.seed)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 10000, 17);
    this.seed = seed;
    // One baked material surface: broad ash/rust deposits over a seamless scanned-style texture.
    rect(ctx, 0, 0, width, height, '#514e48');
    if (terrainImages.ground) {
      const pattern = ctx.createPattern(terrainImages.ground, 'repeat');
      const factor = 480 / terrainImages.ground.width;
      pattern.setTransform(new DOMMatrix().scale(factor));
      rect(ctx, 0, 0, width, height, pattern);
      rect(ctx, 0, 0, width, height, '#222c322c');
    }
    const base = document.createElement('canvas'); base.width = state.width * 4; base.height = state.height * 4;
    this.fogNoise = new Uint8Array(base.width * base.height);
    const baseCtx = base.getContext('2d'), colors = baseCtx.createImageData(base.width, base.height);
    for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
      const broad = smoothNoise(x / 43, y / 43, seed);
      const detail = smoothNoise(x / 13, y / 13, seed + 9);
      const rusty = Math.max(0, smoothNoise(x / 31 + 4, y / 31, seed + 4) - .47) * 1.7;
      const c = broad * 38 + detail * 17, i = (y * base.width + x) * 4;
      colors.data[i] = 41 + c + rusty * 38;
      colors.data[i + 1] = 44 + c + rusty * 8;
      colors.data[i + 2] = 45 + c - rusty * 13;
      colors.data[i + 3] = terrainImages.ground ? 97 : 255;
      this.fogNoise[y * base.width + x] = broad * 6 + detail * 5;
    }
    baseCtx.putImageData(colors, 0, 0); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, 0, 0, width, height);
    // Haul roads share the generator’s layout for both current maps and older saves.
    const { start, end, bend: routeBend } = mapLayout(state);
    const road = (bend, offset = 0) => {
      ctx.beginPath();
      for (let j = 0; j <= 120; j++) {
        const t = j / 120, x = (start.x + (end.x - start.x) * t) * TILE;
        const y = (start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * bend) * TILE + offset;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const bend of [-routeBend, 0, routeBend]) {
      for (const [w, color] of [[42, '#1b20250a'], [33, '#141b210d'], [24, '#1b202511']]) {
        road(bend); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
      }
      for (const offset of [-8, 8]) {
        road(bend, offset); ctx.strokeStyle = '#151b2126'; ctx.lineWidth = 3; ctx.stroke();
        road(bend, offset - 2); ctx.strokeStyle = '#c4b3960d'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();
    for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
      const i = y * state.width + x, px = x * TILE, py = y * TILE;
      const n = noise(x, y, seed), type = state.terrain[i];
      if (type === 3) continue;
      // Irregular mineral stains remain when a field is exhausted.
      if (state.minerals[i] > 0) {
        const stain = ctx.createRadialGradient(px + 16, py + 18, 2, px + 16, py + 18, 33);
        stain.addColorStop(0, '#93684b39'); stain.addColorStop(1, '#93684b00');
        ellipse(ctx, px + 16, py + 18, 33, 26, stain);
      }
      for (let j = 0; j < 17; j++) {
        const nx = noise(x * 19 + j, y, seed), ny = noise(x, y * 19 + j, seed);
        rect(ctx, px + nx * TILE, py + ny * TILE, j % 5 === 0 ? 2 : .8, .7, j % 2 ? '#c8baa32b' : '#111a2433');
      }
      if (type === 1) {
        const cx = px + 16 + (n - .5) * 9, cy = py + 20 + (noise(x, y, seed + 2) - .5) * 9;
        const count = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => state.terrain[(y + dy) * state.width + x + dx] === 1).length;
        const grove = smoothNoise(x / 6, y / 6, seed + 23);
        const isTree = grove > .48 && noise(x, y, seed + 41) < (count < 4 ? .44 : .25);
        const variant = Math.floor(noise(x, y, seed + 5) * (isTree ? 6 : 8));
        const size = isTree ? [54, 56, 48, 46, 31, 42][variant] * (.9 + noise(x, y, seed + 11) * .22) : 35 + n * 14 + count * 2;
        const halo = ctx.createRadialGradient(cx, cy, 6, cx, cy, size * .8);
        halo.addColorStop(0, '#151b224e'); halo.addColorStop(1, '#151b2200');
        ellipse(ctx, cx, cy + 5, size * .8, size * .65, halo);
        this.rockProps.push({ kind: isTree ? 'tree' : 'rock', x: cx / TILE, y: cy / TILE, size, variant });
      } else if (n > .974) {
        const r = 7 + noise(x, y, seed + 8) * 19;
        ellipse(ctx, px + 15, py + 18, r + 2, r * .62, '#bea98824');
        ellipse(ctx, px + 16, py + 16, r, r * .59, '#1c252c58');
        const crater = ctx.createRadialGradient(px + 17, py + 17, 1, px + 17, py + 17, r);
        crater.addColorStop(0, '#1c252c77'); crater.addColorStop(1, '#4a4c4900');
        ellipse(ctx, px + 17, py + 17, r, r * .58, crater);
        ctx.beginPath(); ctx.ellipse(px + 15, py + 16, r, r * .62, 0, .05, Math.PI * .85);
        ctx.strokeStyle = '#d5bea435'; ctx.lineWidth = 1; ctx.stroke();
      } else if (n < .038) {
        ctx.save(); ctx.translate(px + 15, py + 15); ctx.rotate(n * 127);
        line(ctx, -12, -7, 0, 3, '#1c27344f'); line(ctx, 0, 3, 12, 6, '#1c27343b');
        line(ctx, 0, 3, -1, 10, '#1c273440');
        line(ctx, -12, -6, 0, 4, '#c3b29524'); ctx.restore();
      } else if (n < .15) {
        for (let j = 0; j < 3; j++) {
          const xx = px + 5 + noise(x + j, y, seed) * 23, yy = py + 4 + noise(x, y + j, seed) * 24;
          ellipse(ctx, xx + 1.5, yy + 1.5, 2.4, 1.4, '#19232d7d');
          ellipse(ctx, xx, yy, 1.9, 1.3, '#9d928074');
          line(ctx, xx - 1, yy - .8, xx + .7, yy - 1, '#d4c3a75c', .7);
        }
      }
    }
    this.createLava(state);
  }

  createLava(state) {
    this.lavaPools = [];
    const visited = new Uint8Array(state.terrain.length), ctx = this.terrain.getContext('2d');
    const palette = [[47, 41, 36], [89, 34, 22], [194, 49, 9], [248, 104, 16], [255, 206, 91]];
    for (let start = 0; start < visited.length; start++) {
      if (visited[start] || state.terrain[start] !== 3) continue;
      const cells = [start]; visited[start] = 1;
      for (let at = 0; at < cells.length; at++) {
        const i = cells[at], x = i % state.width, y = Math.floor(i / state.width);
        for (const next of [x > 0 ? i - 1 : -1, x < state.width - 1 ? i + 1 : -1, y > 0 ? i - state.width : -1, y < state.height - 1 ? i + state.width : -1]) {
          if (next >= 0 && !visited[next] && state.terrain[next] === 3) { visited[next] = 1; cells.push(next); }
        }
      }
      const x0 = Math.min(...cells.map(i => i % state.width)), x1 = Math.max(...cells.map(i => i % state.width));
      const y0 = Math.min(...cells.map(i => Math.floor(i / state.width))), y1 = Math.max(...cells.map(i => Math.floor(i / state.width)));
      // Detailed surfaces and rounded shores are cached once; only the flow blend changes during play.
      const w = (x1 - x0 + 1) * TILE + 32, h = (y1 - y0 + 1) * TILE + 32;
      const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
      const m = mask.getContext('2d');
      for (const i of cells) rect(m, (i % state.width - x0) * TILE + 16, (Math.floor(i / state.width) - y0) * TILE + 16, TILE, TILE, '#fff');
      const layers = Array.from({ length: 3 }, () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
      const bank = layers[0].getContext('2d'); bank.filter = 'blur(9px)'; bank.drawImage(mask, 0, 0); bank.filter = 'none';
      const pixels = bank.getImageData(0, 0, w, h), heat = [bank.createImageData(w, h), bank.createImageData(w, h)];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, raw = pixels.data[i + 3];
        if (!raw) continue;
        const wx = x0 * TILE + x - 16, wy = y0 * TILE + y - 16;
        const grain = smoothNoise(wx / 5, wy / 5, this.seed + 71), grit = noise(wx, wy, this.seed + 79);
        const edge = raw - (grain - .5) * 55;
        const alpha = Math.max(0, Math.min(255, (edge - 145) * 6));
        const rock = 37 + grain * 22 + grit * 14 + Math.max(0, 150 - raw) * .1;
        pixels.data.set([rock, rock * .94, rock * .86, Math.max(0, Math.min(255, (edge - 93) * 6))], i);
        for (let phase = 0; phase < 2; phase++) {
          const flow = smoothNoise((wx + Math.sin(wy / 27) * 9 + phase * 2) / 22, (wy + phase * 1.5) / 20, this.seed + 37);
          const hot = Math.max(0, Math.min(1, Math.max(0, 1 - Math.abs(flow - .5) * 3.5) ** 1.3 + (grain - .5) * .22));
          const value = Math.max(0, hot * Math.min(1, Math.max(0, (edge - 145) / 65)) * 4 - grit * .16);
          const index = Math.min(3, Math.floor(value)), blend = value - index;
          const crust = ((grain - .5) * 22 + (grit - .5) * 18) * (1 - hot);
          for (let c = 0; c < 3; c++) heat[phase].data[i + c] = palette[index][c] * (1 - blend) + palette[index + 1][c] * blend + crust;
          heat[phase].data[i + 3] = alpha;
        }
      }
      bank.putImageData(pixels, 0, 0);
      layers[1].getContext('2d').putImageData(heat[0], 0, 0); layers[2].getContext('2d').putImageData(heat[1], 0, 0);
      const pool = { cells, x: x0 * TILE - 16, y: y0 * TILE - 16, width: w, height: h, surface: layers[1], flow: layers[2] };
      ctx.save(); ctx.shadowColor = '#130f1299'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
      ctx.drawImage(layers[0], pool.x, pool.y, pool.width, pool.height);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.drawImage(pool.surface, pool.x, pool.y, pool.width, pool.height); ctx.restore();
      this.lavaPools.push(pool);
    }
  }

  drawLava(state, visible, time, x0, y0, x1, y1) {
    const ctx = this.ctx;
    for (const pool of this.lavaPools) {
      const cells = pool.cells.filter(i => (!visible || visible[i]) && i % state.width >= x0 && i % state.width < x1 && Math.floor(i / state.width) >= y0 && Math.floor(i / state.width) < y1);
      if (!cells.length) continue;
      ctx.save(); ctx.beginPath();
      for (const i of cells) ctx.rect(i % state.width * TILE, Math.floor(i / state.width) * TILE, TILE, TILE);
      ctx.clip();
      ctx.globalAlpha = .32 + Math.sin(time * .7 + pool.x * .03) * .26;
      ctx.drawImage(pool.flow, pool.x, pool.y, pool.width, pool.height);
      ctx.globalAlpha = 1;
      for (const i of cells) {
        const n = noise(i, 4, this.seed), age = (time * .18 + n) % 1;
        if (age < .8) continue;
        const p = (age - .8) * 5, x = (i % state.width + .5) * TILE + (n - .5) * 10;
        const y = (Math.floor(i / state.width) + .5) * TILE + (noise(i, 8, this.seed) - .5) * 10;
        ctx.globalAlpha = Math.sin(p * Math.PI) * .45;
        glow(ctx, x, y, 6, '#ffa44e75'); ellipse(ctx, x, y, 1 + p * 3, .8 + p * 2, null, '#f7b663');
      }
      ctx.restore();
    }
  }

  drawDecals(state, visible, time) {
    const ctx = this.decals.getContext('2d');
    if (time - this.lastDecalFade > 8) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      rect(ctx, 0, 0, this.decals.width, this.decals.height, '#00000008'); ctx.restore();
      this.lastDecalFade = time;
    }
    const currentlySeen = new Set();
    for (const e of state.entities) {
      if (e.kind !== 'unit' || isInfantry(e)) continue;
      const i = Math.floor(e.y) * state.width + Math.floor(e.x);
      if (visible && !visible[i]) continue;
      currentlySeen.add(e.id);
      const previous = this.unitPositions.get(e.id);
      const x = e.x * TILE, y = e.y * TILE;
      if (previous && Math.hypot(x - previous.x, y - previous.y) > 3) {
        const length = Math.hypot(x - previous.x, y - previous.y);
        if (length < TILE * 1.5) {
          const angle = Math.atan2(y - previous.y, x - previous.x);
          ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
          for (const offset of [-7, 7]) {
            rect(ctx, -length, offset, length, 2.5, '#16202720');
            for (let step = 0; step < length; step += 3.5) line(ctx, -step, offset, -step, offset + 2.5, '#0a172420', .7);
          }
          ctx.restore();
        }
        this.unitPositions.set(e.id, { x, y });
      } else if (!previous) this.unitPositions.set(e.id, { x, y });
    }
    for (const id of this.unitPositions.keys()) if (!currentlySeen.has(id)) this.unitPositions.delete(id);
    for (const fx of state.effects || []) {
      if (fx.type !== 'explosion' || this.seenEffects.has(fx)) continue;
      this.seenEffects.add(fx);
      const i = Math.floor(fx.y) * state.width + Math.floor(fx.x);
      if (visible && !visible[i]) continue;
      const x = fx.x * TILE, y = fx.y * TILE, radius = 19 * Math.sqrt(fx.size || 1);
      const scorch = ctx.createRadialGradient(x, y, 2, x, y, radius);
      scorch.addColorStop(0, '#0e161de0'); scorch.addColorStop(.45, '#19202790'); scorch.addColorStop(1, '#19202700');
      ellipse(ctx, x, y, radius, radius * .75, scorch);
      for (let j = 0; j < 12; j++) {
        const a = noise(x, j, this.seed) * Math.PI * 2, r = radius * (.4 + noise(j, y) * .9);
        const dx = x + Math.cos(a) * r, dy = y + Math.sin(a) * r * .7;
        line(ctx, dx, dy, dx + Math.cos(a) * 6, dy + Math.sin(a) * 3, '#19202766', 1 + j % 3);
        if ((fx.size || 1) > 1) rect(ctx, dx, dy, 2 + j % 4, 1 + j % 3, '#292c2bcc');
      }
    }
  }

  updateFog(state) {
    const visible = state.visible[0], explored = state.explored[0];
    let changed = !this.fogVisible;
    if (!changed) for (let i = 0; i < visible.length; i++) {
      if (visible[i] !== this.fogVisible[i] || explored[i] !== this.fogExplored[i]) { changed = true; break; }
    }
    if (!changed) return;
    this.fogVisible = visible.slice(); this.fogExplored = explored.slice();
    const low = this.fogLow.getContext('2d'), data = low.createImageData(state.width, state.height);
    for (let i = 0; i < visible.length; i++) {
      const p = i * 4;
      data.data[p] = 12; data.data[p + 1] = 19; data.data[p + 2] = 27;
      data.data[p + 3] = visible[i] ? 0 : explored[i] ? 162 : 255;
    }
    low.putImageData(data, 0, 0);
    const ctx = this.fog.getContext('2d');
    ctx.clearRect(0, 0, this.fog.width, this.fog.height);
    ctx.imageSmoothingEnabled = true; ctx.filter = 'blur(1.5px)';
    ctx.drawImage(this.fogLow, -2, -2, this.fog.width + 4, this.fog.height + 4); ctx.filter = 'none';
    const pixels = ctx.getImageData(0, 0, this.fog.width, this.fog.height);
    for (let y = 0; y < this.fog.height; y++) for (let x = 0; x < this.fog.width; x++) {
      const p = (y * this.fog.width + x) * 4, alpha = pixels.data[p + 3];
      if (alpha < 15) continue;
      const n = this.fogNoise[y * this.fog.width + x];
      pixels.data[p] = 10 + n * .65; pixels.data[p + 1] = 17 + n * .8; pixels.data[p + 2] = 24 + n;
    }
    ctx.putImageData(pixels, 0, 0);
  }

  draw(state, view) {
    if (this.terrainSource !== state.terrain) this.createTerrain(state);
    const ctx = this.ctx, zoom = view.zoom, scale = zoom / TILE, time = state.time || 0;
    const left = this.width / 2 - view.x * zoom, top = this.height / 2 - view.y * zoom;
    const visible = state.visible?.[0], explored = state.explored?.[0];
    const entityVisible = (e) => {
      if (!visible) return true;
      if (e.kind === 'building') {
        for (let y = Math.floor(e.y); y < e.y + e.size; y++) for (let x = Math.floor(e.x); x < e.x + e.size; x++) {
          if (x >= 0 && y >= 0 && x < state.width && y < state.height && visible[y * state.width + x]) return true;
        }
        return false;
      }
      return !!visible[Math.floor(e.y) * state.width + Math.floor(e.x)];
    };
    const x0 = Math.max(0, Math.floor(view.x - this.width / zoom / 2) - 2);
    const y0 = Math.max(0, Math.floor(view.y - this.height / zoom / 2) - 3);
    const x1 = Math.min(state.width, Math.ceil(view.x + this.width / zoom / 2) + 2);
    const y1 = Math.min(state.height, Math.ceil(view.y + this.height / zoom / 2) + 3);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    rect(ctx, 0, 0, this.width, this.height, '#0e1720');
    ctx.drawImage(this.terrain, left, top, state.width * zoom, state.height * zoom);
    this.drawDecals(state, visible, time);
    ctx.drawImage(this.decals, left, top, state.width * zoom, state.height * zoom);
    ctx.save(); ctx.translate(left, top); ctx.scale(scale, scale);
    this.drawLava(state, visible, time, x0, y0, x1, y1);
    for (const prop of this.rockProps) {
      if (prop.kind !== 'tree' || prop.x < x0 - 2 || prop.x > x1 + 2 || prop.y < y0 - 2 || prop.y > y1 + 2) continue;
      if (explored && !explored[Math.floor(prop.y) * state.width + Math.floor(prop.x)]) continue;
      drawPropShadow(ctx, 'tree', prop.x * TILE, prop.y * TILE, prop.size, prop.variant);
    }
    // Ground shadows cannot cover neighbouring roofs or disclose enemies hidden by fog.
    for (const e of state.entities) {
      if (e.hp <= 0 || e.team !== 0 && !entityVisible(e)) continue;
      if (e.x < x0 - 4 || e.x > x1 + 2 || e.y < y0 - 4 || e.y > y1 + 3) continue;
      const n = e.kind === 'building' ? e.size / 2 : 0;
      ctx.save(); ctx.translate((e.x + n) * TILE, (e.y + n) * TILE);
      drawSpriteShadow(ctx, e, time);
      ctx.restore();
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * state.width + x;
      if (!visible || visible[i]) this.knownOre[i] = state.minerals[i];
      if (explored && !explored[i]) continue;
      const amount = this.knownOre[i];
      if (amount <= 0) continue;
      const richness = Math.min(1, amount / 500);
      const n = noise(x, y), cx = x * TILE + 16 + (n - .5) * 8, cy = y * TILE + 18 + (noise(x, y, 11) - .5) * 8;
      const clusterSize = (25 + richness * 14) * (.82 + noise(x, y, 31) * .32);
      if (!drawProp(ctx, 'ore', cx, cy - 2, clusterSize, Math.floor(n * 3))) {
        for (let j = 0; j < 3 + richness * 3; j++) {
          crystal(ctx, cx - 9 + noise(x + j * 8, y) * 19, cy - 6 + noise(x, y + j * 7) * 16, .5 + richness * .42, j + n * 100);
        }
      }
      if (visible?.[i] && Math.sin(time * 1.5 + n * 10) > .88) {
        light(ctx, cx + n * 8, cy - 9, '#c4fff0');
      }
    }
    const powers = [powerStats(state, 0).ratio, powerStats(state, 1).ratio];
    const liveIds = new Set(state.entities.filter(e => e.hp > 0).map(e => e.id));
    for (const e of state.entities) if (e.hp > 0 && e.team === 1 && e.kind === 'building' && entityVisible(e)) {
      this.rememberedBuildings.set(e.id, { ...e, queue: (e.queue || []).map(item => ({ ...item })), rememberedAt: time });
    }
    for (const [id, e] of this.rememberedBuildings) if (!liveIds.has(id) && entityVisible(e)) this.rememberedBuildings.delete(id);
    const entities = state.entities.filter(e => e.hp > 0 && (e.team === 0 || entityVisible(e)));
    const visibleUnits = entities.filter(e => e.kind === 'unit');
    for (const e of this.rememberedBuildings.values()) if (!entityVisible(e)) entities.push(e);
    for (const prop of this.rockProps) if (prop.x >= x0 - 2 && prop.x < x1 + 2 && prop.y >= y0 - 2 && prop.y < y1 + 2) {
      if (prop.kind === 'tree' && explored && !explored[Math.floor(prop.y) * state.width + Math.floor(prop.x)]) continue;
      entities.push(prop);
    }
    entities.sort((a, b) => (a.y + (a.kind === 'building' ? a.size : 0)) - (b.y + (b.kind === 'building' ? b.size : 0)));
    for (const e of entities) {
      if (e.x < x0 - 4 || e.x > x1 + 2 || e.y < y0 - 4 || e.y > y1 + 3) continue;
      if (e.kind === 'rock') { rock(ctx, e.x * TILE, e.y * TILE, e.size, e.variant); continue; }
      if (e.kind === 'tree') {
        const radius = e.size / TILE * .48;
        const obscuresUnit = visibleUnits.some(u => u.y < e.y && u.y > e.y - radius && Math.abs(u.x - e.x) < radius);
        ctx.save(); if (obscuresUnit) ctx.globalAlpha *= .42;
        if (!drawProp(ctx, 'tree', e.x * TILE, e.y * TILE, e.size, e.variant)) rock(ctx, e.x * TILE, e.y * TILE, e.size, e.variant);
        ctx.restore(); continue;
      }
      const isBuilding = e.kind === 'building', n = isBuilding ? e.size / 2 : 0;
      const x = (e.x + n) * TILE, y = (e.y + n) * TILE;
      ctx.save(); ctx.translate(x, y);
      if (view.selected?.has(e.id)) {
        const r = isBuilding ? e.size * TILE / 2 + 2 : isInfantry(e) ? (e.type === 'rocket' ? 10 : 7) : 17;
        ctx.strokeStyle = '#b4e2e6'; ctx.lineWidth = .8 / scale;
        if (isBuilding) {
          const d = r * .27;
          for (const [xx, yy, dx, dy] of [[-r, -r, d, d], [r, -r, -d, d], [-r, r, d, -d], [r, r, -d, -d]]) {
            ctx.beginPath(); ctx.moveTo(xx, yy + dy); ctx.lineTo(xx, yy); ctx.lineTo(xx + dx, yy); ctx.stroke();
          }
        } else ellipse(ctx, 0, 2, r, r * .68, '#8edbe313', '#b4e2e6');
      }
      if (isBuilding) building(ctx, e, e.team === 1 && !entityVisible(e) ? e.rememberedAt : time); else unit(ctx, e, time);
      if ((e.team === 0 || entityVisible(e)) && e.progress >= 1) this.drawEntityActivity(ctx, e, time, powers[e.team]);
      if (isBuilding) {
        ctx.save(); ctx.translate(-e.size * TILE * .32, e.size * TILE * .43); ctx.scale(1 / scale, 1 / scale);
        ellipse(ctx, 0, 0, 5.5, 5.5, '#0a151ddd');
        teamInsignia(ctx, e.team, 0, 0, 7); ctx.restore();
      }
      if ((view.selected?.has(e.id) || e.hp < e.maxHp * .98) && (e.team === 0 || entityVisible(e))) {
        const w = isBuilding ? Math.min(44, e.size * TILE - 4) : isInfantry(e) ? (e.type === 'rocket' ? 16 : 13) : 25;
        const yy = isBuilding ? -e.size * TILE / 2 - 16 : -19;
        rect(ctx, -w / 2 - 1, yy - 1, w + 2, 5, '#0a1620ec');
        rect(ctx, -w / 2, yy, w * Math.max(0, e.hp / e.maxHp), 3, e.hp / e.maxHp < .3 ? '#e3855e' : TEAM[e.team].glow);
        if (e.queue?.length) {
          rect(ctx, -w / 2 - 1, yy + 5, w + 2, 3, '#0a1620ec');
          rect(ctx, -w / 2, yy + 6, w * e.queue[0].progress, 1, '#dec48a');
        }
      }
      ctx.restore();
    }
    for (const hauler of state.entities) {
      if (hauler.type !== 'harvester' || !hauler.unloadDepotId || hauler.hp <= 0 || !entityVisible(hauler)) continue;
      const depot = state.entities.find(e => e.id === hauler.unloadDepotId && e.hp > 0);
      if (!depot || !entityVisible(depot)) continue;
      const dx = (depot.x + depot.size / 2) * TILE, dy = (depot.y + depot.size / 2) * TILE;
      const targetX = dx - (depot.type === 'refinery' ? depot.size * TILE * .20 : 0);
      const targetY = dy + depot.size * TILE * (depot.type === 'refinery' ? -.30 : .32);
      const x = hauler.x * TILE - Math.cos(hauler.angle || 0) * 10, y = hauler.y * TILE - Math.sin(hauler.angle || 0) * 9;
      for (let i = 0; i < 5; i++) {
        const p = (time * 1.7 + i / 5) % 1;
        const px = x + (targetX - x) * p, py = y + (targetY - y) * p - Math.sin(p * Math.PI) * 9;
        polygon(ctx, [[px - 2, py], [px, py - 3], [px + 2.5, py], [px, py + 1.5]], '#9fdec5', '#3c756d');
      }
    }
    for (const fx of state.effects || []) {
      const alpha = Math.max(0, Math.min(1, fx.life / (fx.maxLife || .3))), age = 1 - alpha;
      const rocket = fx.type === 'rocket';
      const launchX = fx.x - (rocket && fx.weapon === 'rocketTower' ? 14.8 / TILE : 0);
      const px = rocket ? launchX + (fx.tx - launchX) * age : fx.x;
      const py = rocket ? fx.y + (fx.ty - fx.y) * age : fx.y;
      const i = Math.floor(py) * state.width + Math.floor(px);
      if (visible && !visible[i]) continue;
      const x = fx.x * TILE, y = fx.y * TILE - 3;
      ctx.save();
      if (fx.type === 'shot') {
        const dx = (fx.tx - fx.x) * TILE, dy = (fx.ty - fx.y) * TILE;
        const head = Math.min(1, age * 2.2), tail = Math.max(0, head - .18);
        ctx.globalAlpha = alpha;
        line(ctx, x + dx * tail, y + dy * tail, x + dx * head, y + dy * head, '#f3d8a98c', 2.6);
        line(ctx, x + dx * tail, y + dy * tail, x + dx * head, y + dy * head, '#fff5d8', .8);
        if (age < .55) {
          glow(ctx, x, y, 12 * alpha, '#ffc0708f');
          ellipse(ctx, x, y, 3.5 * alpha, 2.5 * alpha, '#fff5dd');
        } else {
          const impact = (age - .55) / .45;
          glow(ctx, fx.tx * TILE, fx.ty * TILE - 3, 7, '#ffab4a64');
          for (let j = 0; j < 4; j++) {
            const a = j * 2.4 + fx.tx;
            line(ctx, fx.tx * TILE + Math.cos(a) * impact * 4, fx.ty * TILE - 3 + Math.sin(a) * impact * 4,
              fx.tx * TILE + Math.cos(a) * impact * 10, fx.ty * TILE - 3 + Math.sin(a) * impact * 10, '#ffe4b6', .7);
          }
        }
      } else if (rocket) {
        const dx = (fx.tx - launchX) * TILE, dy = (fx.ty - fx.y) * TILE;
        const lift = 14, launchHeight = fx.weapon === 'rocketTower' ? 25.9 : 3;
        const sx = px * TILE, sy = py * TILE - launchHeight * (1 - age) - 3 * age - Math.sin(age * Math.PI) * lift;
        // Each trail puff must be currently visible, including shots entering sensor coverage.
        for (let j = 1; j <= 7; j++) {
          const p = age - j * .026;
          if (p < 0) continue;
          const tx = launchX + (fx.tx - launchX) * p, ty = fx.y + (fx.ty - fx.y) * p;
          if (visible && !visible[Math.floor(ty) * state.width + Math.floor(tx)]) continue;
          ellipse(ctx, tx * TILE, ty * TILE - launchHeight * (1 - p) - 3 * p - Math.sin(p * Math.PI) * lift, 1.5 + j * .35, 1 + j * .3, '#b8b3a5' + Math.round((1 - j / 8) * 65).toString(16).padStart(2, '0'));
        }
        const angle = Math.atan2(dy + launchHeight - 3 - Math.cos(age * Math.PI) * Math.PI * lift, dx);
        ctx.translate(sx, sy); ctx.rotate(angle);
        polygon(ctx, [[-3, -1.6], [4, -1.6], [7, 0], [4, 1.6], [-3, 1.6]], '#ece5ce', '#667271');
        polygon(ctx, [[-2, -1], [-8 - Math.sin(age * 80) * 2, 0], [-2, 1]], '#f7b76a');
        line(ctx, -3, 0, -6, 0, '#fff4da', 1.3);
        glow(ctx, -4, 0, 5, '#ffa64e70');
      } else if (fx.type === 'shell') {
        const sx = (fx.x + (fx.tx - fx.x) * age) * TILE;
        const sy = (fx.y + (fx.ty - fx.y) * age) * TILE;
        const lift = Math.sin(age * Math.PI) * 48;
        ellipse(ctx, sx + 3, sy + 4, 4, 2, '#10192355');
        line(ctx, sx - (fx.tx - fx.x) * 2, sy - lift - (fx.ty - fx.y) * 2, sx, sy - lift, '#f9c07c66', 3);
        line(ctx, sx - (fx.tx - fx.x), sy - lift - (fx.ty - fx.y), sx, sy - lift, '#fff0c9', 1.2);
        glow(ctx, sx, sy - lift, 8, '#ffb66275');
        ellipse(ctx, sx, sy - lift, 2.5, 2.5, '#fff5d7');
      } else if (fx.type === 'explosion') {
        const size = Math.sqrt(fx.size || 1), r = (5 + age * 28) * size;
        const flash = Math.max(0, 1 - age * 2.6);
        ctx.globalAlpha = alpha * .38;
        ellipse(ctx, x, y + 5, r * 1.45, r * .88, null, '#e6caaa');
        ctx.globalAlpha = Math.max(0, alpha - .12);
        for (let j = 0; j < 7; j++) {
          const a = j * 2.4 + noise(fx.x, j) * 2, drift = r * (.25 + noise(j, fx.y) * .5);
          const dx = x + Math.cos(a) * drift + age * 9, dy = y + Math.sin(a) * drift * .6 - age * size * 19;
          const soot = ctx.createRadialGradient(dx, dy, 1, dx, dy, r * .62);
          soot.addColorStop(0, '#373532b0'); soot.addColorStop(.55, '#42403b84'); soot.addColorStop(1, '#42403b00');
          ellipse(ctx, dx, dy, r * .62, r * .62, soot);
        }
        ctx.globalAlpha = Math.min(1, alpha * 1.4);
        glow(ctx, x, y - r * .18, r * .84, '#ef8e347d');
        for (let j = 0; j < 5; j++) {
          const a = j * 2.4, reach = r * age * .4;
          const dx = x + Math.cos(a) * reach, dy = y + Math.sin(a) * reach * .6 - age * size * 12;
          const fire = ctx.createRadialGradient(dx, dy, 0, dx, dy, r * (.25 + flash * .22));
          fire.addColorStop(0, '#fff3c9'); fire.addColorStop(.22, '#ffd193'); fire.addColorStop(.55, '#f39840ca'); fire.addColorStop(1, '#bd4c2400');
          ctx.globalAlpha = alpha * alpha;
          ellipse(ctx, dx, dy, r * (.25 + flash * .22), r * (.25 + flash * .22), fire);
        }
        ctx.globalAlpha = flash;
        glow(ctx, x, y, 40 * size, '#ffd7a36b');
        ctx.globalAlpha = alpha;
        for (let j = 0; j < 10; j++) {
          const a = j * 2.4 + fx.x, reach = r * (1 + noise(j, fx.y) * .8);
          const lift = Math.sin(age * Math.PI) * (5 + j % 3 * 6) * size;
          const dx = x + Math.cos(a) * reach, dy = y + Math.sin(a) * reach * .6 - lift;
          line(ctx, dx, dy, dx - Math.cos(a) * (2 + alpha * 5), dy - Math.sin(a) * 3, j % 3 ? '#e6b97bb5' : '#fbe0a9', .8 + j % 2 * .4);
        }
      }
      ctx.restore();
    }
    // Sparse low-contrast airborne ash adds motion without masking tactical silhouettes.
    for (let j = 0; j < 17; j++) {
      const x = ((noise(j, 7, this.seed) * state.width + time * .16) % state.width) * TILE;
      const y = ((noise(j, 18, this.seed) * state.height - time * .045 + state.height * 2) % state.height) * TILE;
      const i = Math.floor(y / TILE) * state.width + Math.floor(x / TILE);
      if (visible && !visible[i]) continue;
      ellipse(ctx, x, y, 1.1, .5, '#e6d5b944');
    }
    ctx.restore();
    if (visible && explored) {
      this.updateFog(state);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fog, left, top, state.width * zoom, state.height * zoom);
    }
    // Screen-space overlays stay crisp at every camera zoom.
    for (const e of visibleUnits) this.drawUnitRank(e, view);
    for (const e of state.entities) if (e.hp > 0 && e.team === 0 && view.selected?.has(e.id) && e.rally && ['barracks', 'factory', 'refinery'].includes(e.type)) {
      const origin = this.worldToScreen(e.x + e.size / 2, e.y + e.size / 2, view);
      const point = this.worldToScreen(e.rally.x, e.rally.y, view);
      ctx.save(); ctx.setLineDash([4, 5]);
      line(ctx, origin.x, origin.y, point.x, point.y, '#b4e2e66e'); ctx.setLineDash([]);
      ellipse(ctx, point.x, point.y + 2, 7, 3.5, '#15242bbb', '#b4e2e6');
      line(ctx, point.x, point.y + 1, point.x, point.y - 15, '#d9e9e6', 1.5);
      polygon(ctx, [[point.x + 1, point.y - 15], [point.x + 10, point.y - 12], [point.x + 1, point.y - 8]], '#8dccca');
      ctx.restore();
    }
    if (view.showGrid || view.placement) {
      ctx.save(); ctx.strokeStyle = '#aac7dc14'; ctx.lineWidth = 1;
      for (let x = x0; x <= x1; x++) line(ctx, left + x * zoom, top + y0 * zoom, left + x * zoom, top + y1 * zoom, '#aac7dc14');
      for (let y = y0; y <= y1; y++) line(ctx, left + x0 * zoom, top + y * zoom, left + x1 * zoom, top + y * zoom, '#aac7dc14');
      ctx.restore();
    }
    if (view.placement && view.hover) {
      const size = SIZES[view.placement] || 2, x = Math.floor(view.hover.x), y = Math.floor(view.hover.y);
      const p = this.worldToScreen(x, y, view), color = view.placementValid ? '#b0e6e8' : '#ef967b';
      ctx.save(); ctx.translate(p.x + size * zoom / 2, p.y + size * zoom / 2); ctx.scale(scale, scale);
      ctx.globalAlpha = .6; building(ctx, { type: view.placement, team: 0, size, progress: 1 }, time); ctx.globalAlpha = 1;
      rect(ctx, -size * TILE / 2, -size * TILE / 2, size * TILE, size * TILE, view.placementValid ? '#8de1e827' : '#ff66583a');
      ctx.strokeStyle = color; ctx.lineWidth = 1 / scale; ctx.strokeRect(-size * TILE / 2, -size * TILE / 2, size * TILE, size * TILE);
      ctx.restore();
    }
    if (view.commandMarker) {
      const marker = view.commandMarker, age = performance.now() / 1000 - marker.time;
      if (age >= 0 && age < 1) {
        const p = this.worldToScreen(marker.x, marker.y, view), color = marker.type === 'attack' ? '#ed9972' : '#c5edef';
        ctx.save(); ctx.globalAlpha = 1 - age; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        const r = 5 + age * 17;
        ellipse(ctx, p.x, p.y, r, r * .65, null, color);
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) line(ctx, p.x + Math.cos(a) * (r + 3), p.y + Math.sin(a) * (r + 3) * .65, p.x + Math.cos(a) * (r + 7), p.y + Math.sin(a) * (r + 7) * .65, color);
        ctx.restore();
      }
    }
    if (view.drag) {
      const { x1, y1, x2, y2 } = view.drag;
      rect(ctx, Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), '#9adce213');
      ctx.strokeStyle = '#b8e4e990'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(x1, x2) + .5, Math.min(y1, y2) + .5, Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    const vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, this.width * .2, this.width / 2, this.height / 2, this.width * .72);
    vignette.addColorStop(0, '#07111c00'); vignette.addColorStop(1, '#07111c38');
    rect(ctx, 0, 0, this.width, this.height, vignette);
    if (performance.now() - this.lastMinimap > 130) {
      this.drawMinimap(state, view, entityVisible); this.lastMinimap = performance.now();
    }
  }

  drawEntityActivity(ctx, e, time, power = 1) {
    if (e.hp <= 0 || e.progress < 1) return;
    if (e.kind === 'building') buildingActivity(ctx, e, time, power);
    if (e.kind === 'unit') {
      const moving = e.moving || e.path?.length > 0;
      if (moving && !isInfantry(e)) {
        ctx.save(); ctx.rotate(e.angle || 0);
        for (let j = 0; j < 4; j++) {
          const age = (time * .9 + j * .25 + e.id * .17) % 1;
          ctx.globalAlpha = (1 - age) * .11;
          ellipse(ctx, -13 - age * 19, Math.sin(j * 7) * 6, 4 + age * 8, 3 + age * 4, '#bbaa92');
        }
        ctx.restore();
      } else if (e.type === 'harvester' && e.order?.type === 'harvest' && e.harvestPhase === 'gather' && e.cargo > 0) {
        ctx.save(); ctx.rotate(e.angle || 0);
        for (let j = 0; j < 3; j++) {
          const age = (time * 1.5 + j / 3) % 1;
          ctx.globalAlpha = (1 - age) * .34;
          ellipse(ctx, 18 + age * 9, (j - 1) * 5 - age * 5, 1 + age * 2, 1 + age, '#e5b577');
        }
        ctx.restore();
      }
    }
    const damaged = e.hp < e.maxHp * .4;
    if (e.kind === 'building' && (e.type === 'reactor' || e.type === 'refinery' && e.processingAmount > 0) || damaged) {
      const s = e.kind === 'building' ? e.size * TILE : 28;
      for (let j = 0; j < (damaged ? 5 : 3); j++) {
        const age = (time * (damaged ? .42 : .28) + j / (damaged ? 5 : 3) + e.id * .13) % 1;
        const refineryStack = e.type === 'refinery' && !damaged;
        const x = (refineryStack ? s * .345 : -s * .2) + age * 14 + Math.sin(time + j) * 2;
        const y = (refineryStack ? -s * .427 : -s * .38) - age * 30;
        ctx.save(); ctx.globalAlpha = Math.sin(age * Math.PI) * (damaged ? .25 : .085);
        const radius = 3 + age * (damaged ? 12 : 9);
        const smoke = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const color = damaged ? '#28292b' : '#c6c4bc';
        smoke.addColorStop(0, color + 'd0'); smoke.addColorStop(1, color + '00');
        ellipse(ctx, x, y, radius, radius, smoke); ctx.restore();
      }
    }
    if (e.kind === 'building' && e.queue?.length) {
      ctx.save(); ctx.globalAlpha = (.4 + Math.sin(time * Math.max(.2, power) * 7 + e.id) * .1) * (power < 1 ? .5 : 1);
      glow(ctx, 0, e.size * TILE * .23, e.size * 4, '#ffcf7f50'); ctx.restore();
    }
  }

  drawUnitRank(entity, view) {
    const ctx = this.ctx, p = this.worldToScreen(entity.x, entity.y, view);
    if (p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) return;
    const radius = entity.type === 'artillery' ? 30 : isInfantry(entity) ? 16 : 25;
    const y = Math.round(p.y + Math.max(11, radius * view.zoom / TILE) + 3), x = Math.round(p.x);
    const rank = unitRank(entity);
    ctx.save();
    rect(ctx, x - 14, y - 2, 28, 9, '#0a151ddd');
    teamInsignia(ctx, entity.team, x - 9, y + 2, 7);
    for (let slot = 0; slot < 3; slot++) {
      const left = x - 3 + slot * 5;
      polygon(ctx, [[left, y + 2], [left + 2, y], [left + 4, y + 2], [left + 4, y + 4], [left + 2, y + 2], [left, y + 4]], slot < rank ? '#e4b975' : '#506167');
    }
    ctx.restore();
  }

  drawMinimap(state, view, entityVisible) {
    if (!this.minimap) return;
    const c = this.minimap, bounds = c.getBoundingClientRect();
    const w = bounds.width || 200, h = bounds.height || 150;
    const pw = Math.round(w * this.dpr), ph = Math.round(h * this.dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const ctx = c.getContext('2d'); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    rect(ctx, 0, 0, w, h, '#0d1720');
    const s = Math.min(w / state.width, h / state.height);
    const ox = (w - state.width * s) / 2, oy = (h - state.height * s) / 2;
    const visible = state.visible?.[0], explored = state.explored?.[0];
    for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
      const i = y * state.width + x;
      if (explored && !explored[i]) continue;
      const color = state.terrain[i] === 3 ? '#bf602e' : state.terrain[i] === 1 ? '#8b8b82' : state.terrain[i] === 2 ? '#434b4e' : '#575e60';
      rect(ctx, ox + x * s, oy + y * s, s + .5, s + .5, color);
      if (this.knownOre[i] > 0) rect(ctx, ox + x * s, oy + y * s, s + .5, s + .5, '#83d5c9');
      if (visible && !visible[i]) rect(ctx, ox + x * s, oy + y * s, s + .5, s + .5, '#0a152080');
    }
    const drawDot = (e) => {
      const building = e.kind === 'building', size = building ? Math.max(4, e.size * s) : Math.max(3, s * .65);
      const center = building ? e.size / 2 : 0;
      teamInsignia(ctx, e.team, ox + (e.x + center) * s, oy + (e.y + center) * s, size);
    };
    for (const e of state.entities) if (e.hp > 0 && (e.team === 0 || entityVisible(e))) drawDot(e);
    for (const e of this.rememberedBuildings.values()) if (!entityVisible(e)) { ctx.globalAlpha = .4; drawDot(e); ctx.globalAlpha = 1; }
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, state.width * s, state.height * s); ctx.clip();
    ctx.strokeStyle = '#c5e7eebb'; ctx.lineWidth = 1;
    ctx.strokeRect(ox + (view.x - this.width / view.zoom / 2) * s, oy + (view.y - this.height / view.zoom / 2) * s, this.width / view.zoom * s, this.height / view.zoom * s);
    ctx.restore();
    ctx.strokeStyle = '#9bbbc522'; ctx.strokeRect(.5, .5, w - 1, h - 1);
  }
}
