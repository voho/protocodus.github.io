import { BUILDINGS } from './buildings.js';
import { SPRITE_SCALE, featureSpriteUnits } from './sprite-art-direction.js';

// Native fallbacks for generated town features: parks, play and sport, the town hall and newer shops. Each stands on
// the same plate as its authored atlas, a 2:1 diamond centred at (16, 24) of the
// 32-unit sprite box; the sprite scales the box by the footprint. Plate coordinates u (down-right) and v (down-left) run
// from -1 to 1 across the plate and z rises from it; anything nearer the camera (larger u + v) is drawn later.
const H = 7.25;
const profiles = new WeakMap();
const footprint = c => profiles.get(c)?.footprint || 1;
// Parcels grow horizontally; vertical architectural dimensions stay in metres.
const at = (c, u, v, z = 0) => [16 + (u - v) * H, 24 + (u + v) * H / 2 - z * H * .82 / footprint(c)];
const heightZ = metres => metres * SPRITE_SCALE.worldPixelsPerMetre / (1.5 * H * .82);
const humanSize = (c, metres) => featureSpriteUnits(metres, footprint(c));

const PALETTES = {
  taiga: { lawn: '#7e9d57', stripe: '#8aa862', edge: '#5f6c46', paving: '#cdc6ae', path: '#d8cfb2', canopy: ['#557a43', '#7c9b55', '#a3b56c'], wall: '#e3d7b7', roof: '#6b7480', court: '#5c8a64' },
  tundra: { lawn: '#a9b89f', stripe: '#b6c4ac', edge: '#7d8a80', paving: '#d3d4c9', path: '#e1e2d6', canopy: ['#5d7f72', '#7f9b8d', '#d9e1d2'], wall: '#dcd8c8', roof: '#5f6b74', court: '#6a8f86' },
  desert: { lawn: '#94a35f', stripe: '#a0ad6a', edge: '#9a7f57', paving: '#d9c59b', path: '#e5d3aa', canopy: ['#5f7f4b', '#86a05c', '#b5c27a'], wall: '#ead6b0', roof: '#a8654a', court: '#b8714f' },
};

// Scales a '#rrggbb' or 'rgb(…)' colour, so shaded colours can be shaded again.
function shade(color, k) {
  const channels = color[0] === '#' ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : color.match(/\d+/g).map(Number);
  return `rgb(${channels.map(n => Math.max(0, Math.min(255, Math.round(n * k)))).join(',')})`;
}
function poly(c, points, color) { c.fillStyle = color; c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); }
function stroke(c, points, color, width = .5) { c.strokeStyle = color; c.lineWidth = width / footprint(c); c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); }
const flat = (c, u0, v0, u1, v1, color, z = 0) => poly(c, [at(c, u0, v0, z), at(c, u1, v0, z), at(c, u1, v1, z), at(c, u0, v1, z)], color);
function outline(c, u0, v0, u1, v1, color, width = .45, z = 0) { stroke(c, [at(c, u0, v0, z), at(c, u1, v0, z), at(c, u1, v1, z), at(c, u0, v1, z), at(c, u0, v0, z)], color, width); }
// A ground circle of radius r (plate units) is an ellipse twice as wide as it is tall.
function disc(c, u, v, r, color, z = 0) { const [x, y] = at(c, u, v, z); c.fillStyle = color; c.beginPath(); c.ellipse(x, y, r * H * 1.41, r * H * .705, 0, 0, Math.PI * 2); c.fill(); }
function ring(c, u, v, r, color, width, z = 0) { const [x, y] = at(c, u, v, z); c.strokeStyle = color; c.lineWidth = width / footprint(c); c.beginPath(); c.ellipse(x, y, r * H * 1.41, r * H * .705, 0, 0, Math.PI * 2); c.stroke(); }
const post = (c, u, v, z0, z1, color, width = .45) => stroke(c, [at(c, u, v, z0), at(c, u, v, z1)], color, width);
// The two faces towards the camera, the left one in light, then the top.
function box(c, u0, v0, u1, v1, z0, z1, color, top = shade(color, 1.08)) {
  poly(c, [at(c, u0, v1, z0), at(c, u1, v1, z0), at(c, u1, v1, z1), at(c, u0, v1, z1)], color);
  poly(c, [at(c, u1, v0, z0), at(c, u1, v1, z0), at(c, u1, v1, z1), at(c, u1, v0, z1)], shade(color, .78));
  flat(c, u0, v0, u1, v1, top, z1);
}
// A pitched roof with its ridge along u: the far slope, the lit near slope and the gable end on the right.
function roof(c, u0, v0, u1, v1, z, rise, color, eave = .06) {
  const vm = (v0 + v1) / 2;
  poly(c, [at(c, u0 - eave, v0 - eave, z), at(c, u1 + eave, v0 - eave, z), at(c, u1 + eave, vm, z + rise), at(c, u0 - eave, vm, z + rise)], shade(color, .86));
  poly(c, [at(c, u1, v0, z), at(c, u1, v1, z), at(c, u1, vm, z + rise)], shade(color, .7));
  poly(c, [at(c, u0 - eave, v1 + eave, z), at(c, u1 + eave, v1 + eave, z), at(c, u1 + eave, vm, z + rise), at(c, u0 - eave, vm, z + rise)], color);
  stroke(c, [at(c, u0 - eave, vm, z + rise), at(c, u1 + eave, vm, z + rise)], shade(color, 1.25), .4);
}
function snowcap(c, u0, v0, u1, v1, z, rise) { const vm = (v0 + v1) / 2; poly(c, [at(c, u0, vm - .12, z + rise * .8), at(c, u1, vm - .12, z + rise * .8), at(c, u1, vm, z + rise), at(c, u0, vm, z + rise)], '#eef1e8'); }
// Windows on the light face (v = v1) between u0 and u1, or on the shaded face (u = u1) between v0 and v1.
function windowsLeft(c, v, u0, u1, z0, z1, count, color = '#58747c') {
  z1 = z0 + heightZ(SPRITE_SCALE.windowHeightMetres);
  const step = (u1 - u0) / count;
  for (let i = 0; i < count; i++) { const a = u0 + step * (i + .22), b = u0 + step * (i + .78); poly(c, [at(c, a, v, z0), at(c, b, v, z0), at(c, b, v, z1), at(c, a, v, z1)], color); }
}
function windowsRight(c, u, v0, v1, z0, z1, count, color = '#4c6268') {
  z1 = z0 + heightZ(SPRITE_SCALE.windowHeightMetres);
  const step = (v1 - v0) / count;
  for (let i = 0; i < count; i++) { const a = v0 + step * (i + .22), b = v0 + step * (i + .78); poly(c, [at(c, u, a, z0), at(c, u, b, z0), at(c, u, b, z1), at(c, u, a, z1)], color); }
}
function personnelDoor(c, u, v, z = 0, color = '#6d5a44', leaves = 1) {
  const half = humanSize(c, SPRITE_SCALE.doorWidthMetres) * leaves / (2 * H);
  const top = z + heightZ(SPRITE_SCALE.doorHeightMetres);
  poly(c, [at(c, u - half, v, z), at(c, u + half, v, z), at(c, u + half, v, top), at(c, u - half, v, top)], color);
}
// Draw trees and street furniture at a fixed world size, wherever their parcel anchor lies.
function accessory(c, u, v, draw) {
  const [x, y] = at(c, u, v);
  c.save(); c.translate(x, y); c.scale(1 / footprint(c), 1 / footprint(c));
  draw(); c.restore();
}
function plate(c, p, color = p.lawn) {
  poly(c, [at(c, -1, 1), at(c, 1, 1), at(c, 1, 1, -.18), at(c, -1, 1, -.18)], shade(p.edge, 1.05));
  poly(c, [at(c, 1, -1), at(c, 1, 1), at(c, 1, 1, -.18), at(c, 1, -1, -.18)], shade(p.edge, .85));
  flat(c, -1, -1, 1, 1, color);
}
function tree(c, biome, p, u, v, size = 1) {
  accessory(c, u, v, () => {
    const s = size * 2.8;
    c.fillStyle = '#3d4a3540'; c.beginPath(); c.ellipse(.8, .3, s * 1.05, s * .45, 0, 0, Math.PI * 2); c.fill();
    if (biome === 'tundra') {
      stroke(c, [[0, 0], [0, -1.4]], '#6c5c47', .7);
      poly(c, [[0, -s * 2.6], [-s * .9, -.6], [s * .9, -.6]], '#5f7f70');
      poly(c, [[0, -s * 2.6], [-s * .5, -s * 1.2], [.3, -s * 1.3]], '#dfe6da');
    } else if (biome === 'desert') {
      stroke(c, [[0, 0], [.5, -s * 1.9]], '#8a6f4b', .8);
      c.fillStyle = p.canopy[0]; c.beginPath(); c.ellipse(.5, -s * 1.9, s * 1.1, s * .38, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = p.canopy[1]; c.beginPath(); c.ellipse(-s * .22, -s * 2, s * .68, s * .23, -.2, 0, Math.PI * 2); c.fill();
    } else {
      stroke(c, [[0, 0], [0, -1.2]], '#6f5d45', .8);
      c.fillStyle = p.canopy[0]; c.beginPath(); c.ellipse(0, -s * 1.05, s * .95, s * .85, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = p.canopy[1]; c.beginPath(); c.ellipse(-s * .22, -s * 1.25, s * .7, s * .62, 0, 0, Math.PI * 2); c.fill();
    }
  });
}
function bush(c, p, u, v, size = 1) {
  accessory(c, u, v, () => { const s = size * 1.1; c.fillStyle = p.canopy[0]; c.beginPath(); c.ellipse(0, -s * .5, s, s * .7, 0, 0, Math.PI * 2); c.fill(); });
}
function bench(c, u, v, alongU) {
  const du = alongU ? humanSize(c, 1.8) / (2 * H) : humanSize(c, .4) / (2 * H);
  const dv = alongU ? humanSize(c, .4) / (2 * H) : humanSize(c, 1.8) / (2 * H);
  box(c, u - du, v - dv, u + du, v + dv, heightZ(.3), heightZ(.55), '#8a6a48');
}
function flowers(c, u, v, colors, fine) {
  disc(c, u, v, .1, '#5e7a45');
  // One warm planted mass reads at small zoom; individual flower dots do not.
  if (fine) disc(c, u, v, .065, colors[0], heightZ(.1));
}
function car(c, u, v, color) {
  const du = humanSize(c, 4.2) / (2 * H), dv = humanSize(c, 1.8) / (2 * H);
  box(c, u - du, v - dv, u + du, v + dv, 0, heightZ(.85), color);
  box(c, u - du * .5, v - dv * .85, u + du * .45, v + dv * .85, heightZ(.85), heightZ(1.5), '#9fb4b8');
}

function park(c, p, biome, fine) {
  plate(c, p);
  if (fine) for (let i = -1; i < 1; i += .5) flat(c, i, -1, i + .25, 1, p.stripe);
  flat(c, -1, -.09, 1, .09, p.path); flat(c, -.09, -1, .09, 1, p.path); ring(c, 0, 0, .52, p.path, 1.1);
  tree(c, biome, p, -.72, -.74, 1.15); tree(c, biome, p, .2, -.8, .9); tree(c, biome, p, -.8, .18, .95);
  flowers(c, -.42, -.36, ['#d98a7a', '#e6cf72', '#c58bb7'], fine); flowers(c, .42, -.42, ['#e6cf72', '#d98a7a', '#f2efe0'], fine);
  disc(c, 0, 0, .26, '#bdb7a2'); disc(c, 0, 0, .2, '#69a9bd', .03);
  if (fine) { disc(c, -.04, -.03, .07, '#a8d6e0', .04); post(c, 0, 0, .03, .32, '#c9c4b0', .55); disc(c, 0, 0, .05, '#d9eef2', .34); }
  bench(c, .3, .16, true); bench(c, -.16, .32, false);
  flowers(c, .45, .5, ['#c58bb7', '#e6cf72', '#d98a7a'], fine); bush(c, p, .78, -.15); bush(c, p, -.2, .82);
  tree(c, biome, p, .72, .62, 1.05); tree(c, biome, p, -.62, .7, .85);
}

function playground(c, p, biome, fine) {
  plate(c, p);
  flat(c, -.82, -.82, .82, .3, '#c57d5c'); flat(c, -.82, .3, .2, .82, '#d9c38f');
  tree(c, biome, p, -.82, -.86, .8);
  // Swings: an A-frame at each end of a bar, two seats hanging under it.
  for (const v of [-.62, .08]) { post(c, -.62, v - .08, 0, 1.05, '#7e5c40', .6); post(c, -.62, v + .08, 0, 1.05, '#7e5c40', .6); }
  stroke(c, [at(c, -.62, -.62, 1.05), at(c, -.62, .08, 1.05)], '#7e5c40', .7);
  for (const v of [-.42, -.14]) { stroke(c, [at(c, -.62, v, 1.05), at(c, -.62, v, .22)], '#5d5d55', .3); box(c, -.68, v - .05, -.56, v + .05, .2, .25, '#d0533f'); }
  // Slide: a ladder up to a platform and the chute down towards the camera.
  box(c, .12, -.62, .32, -.42, 0, .85, '#4f8fa8'); flat(c, .1, -.64, .34, -.4, '#e2b24a', .86);
  poly(c, [at(c, .34, -.6, .85), at(c, .34, -.44, .85), at(c, .82, -.44, .02), at(c, .82, -.6, .02)], '#e2b24a');
  stroke(c, [at(c, .34, -.6, .9), at(c, .82, -.6, .07)], '#c9902f', .3);
  // Sandpit with a timber edge, and a roundabout.
  box(c, -.5, .38, .05, .78, 0, .06, '#9c7752', '#e6d4a1');
  if (fine) disc(c, -.25, .58, .06, '#c45a46', .07);
  disc(c, .5, .1, .2, '#3f7f9a', .03); disc(c, .5, .1, .16, '#e0533f', .05); post(c, .5, .1, .05, .18, '#d8d4c4', .4);
  for (let u = -.9; u <= .91; u += .3) post(c, u, .92, 0, heightZ(SPRITE_SCALE.fenceHeightMetres), '#efe7cf', .35);
  stroke(c, [at(c, -.9, .92, heightZ(SPRITE_SCALE.fenceHeightMetres * .8)), at(c, .9, .92, heightZ(SPRITE_SCALE.fenceHeightMetres * .8))], '#efe7cf', .3);
}

function swimmingPool(c, p, biome, fine) {
  plate(c, p, p.paving);
  // The pavilion at the back: changing rooms and a kiosk under a flat roof.
  box(c, -.95, -.95, .5, -.66, 0, .8, p.wall); flat(c, -.98, -.98, .53, -.63, shade(p.roof, 1.2), .82);
  windowsLeft(c, -.66, -.85, .4, .3, .62, 5);
  if (biome === 'tundra') flat(c, -.98, -.98, .53, -.8, '#eef1e8', .83);
  flat(c, -.72, -.44, .6, .62, '#ebe7da');
  flat(c, -.64, -.36, .52, .54, '#3f9dbb');
  flat(c, -.64, -.36, .52, -.24, '#2f86a6');
  if (fine) for (const v of [-.14, .08, .3]) stroke(c, [at(c, -.62, v), at(c, .5, v)], '#d7eef2', .35);
  if (fine) for (const [u, v] of [[-.3, .2], [.1, -.05], [.32, .38]]) disc(c, u, v, .05, '#a6dbe7');
  for (const v of [-.3, .05, .4]) box(c, .72, v - .07, .9, v + .07, .02, .06, '#f1efe6');
  for (const [u, v, color] of [[.8, -.42, '#d9533f'], [.8, .22, '#e8c34a']]) { post(c, u, v, 0, .62, '#8c8578', .35); disc(c, u, v, .17, color, .62); disc(c, u - .03, v - .03, .08, shade(color, 1.18), .64); }
  tree(c, biome, p, -.86, .78, .85); bush(c, p, .86, .86, .9);
}

function sportsField(c, p, biome, fine) {
  plate(c, p);
  for (let i = -.9; i < .9; i += .36) flat(c, i, -.9, i + .18, .62, p.stripe);
  const line = '#f2f0e2';
  outline(c, -.86, -.62, .86, .58, line, .5); stroke(c, [at(c, 0, -.62), at(c, 0, .58)], line, .45); ring(c, 0, -.02, .16, line, .45);
  outline(c, -.86, -.26, -.62, .22, line, .4); outline(c, .62, -.26, .86, .22, line, .4);
  for (const u of [-.88, .88]) { post(c, u, -.1, 0, .2, line, .45); post(c, u, .06, 0, .2, line, .45); stroke(c, [at(c, u, -.1, .2), at(c, u, .06, .2)], line, .45); }
  // A small covered stand on the far side, with floodlights at the corners.
  box(c, -.55, -.98, .55, -.76, 0, .22, '#a9a593'); box(c, -.55, -.98, .55, -.86, .22, .42, '#8f8b7b');
  flat(c, -.6, -1, .6, -.8, shade(p.roof, 1.1), .8); for (const u of [-.55, .55]) post(c, u, -.8, .22, .8, '#6a6a62', .4);
  for (const [u, v] of [[-.97, -.97], [.97, -.97], [-.97, .7], [.97, .7]]) { post(c, u, v, 0, 2.1, '#6e7068', .45); box(c, u - .07, v - .03, u + .07, v + .03, 2.04, 2.2, '#e9ead9'); }
  if (biome !== 'desert') bush(c, p, -.9, .9, .9);
}

function tennisCourts(c, p, biome, fine) {
  plate(c, p, p.paving);
  flat(c, -.86, -.8, .86, .8, p.court);
  const line = '#f3f1e4';
  outline(c, -.74, -.62, .74, .62, line, .45); outline(c, -.74, -.46, .74, .46, line, .35);
  stroke(c, [at(c, -.42, -.46), at(c, -.42, .46)], line, .35); stroke(c, [at(c, .42, -.46), at(c, .42, .46)], line, .35); stroke(c, [at(c, -.42, 0), at(c, .42, 0)], line, .35);
  post(c, 0, -.7, 0, .16, '#4f554f', .45); post(c, 0, .7, 0, .16, '#4f554f', .45);
  poly(c, [at(c, 0, -.7, .15), at(c, 0, .7, .15), at(c, 0, .7, .05), at(c, 0, -.7, .05)], '#2f3a3488'); stroke(c, [at(c, 0, -.7, .16), at(c, 0, .7, .16)], '#f3f1e4', .35);
  // Wire fence along the far sides.
  for (let k = -.9; k <= .91; k += .3) { post(c, -.95, k, 0, .75, '#5d665f', .3); post(c, k, -.95, 0, .75, '#5d665f', .3); }
  stroke(c, [at(c, -.95, .9, .75), at(c, -.95, -.95, .75), at(c, .9, -.95, .75)], '#5d665f', .35);
  bench(c, .88, .5, false);
  if (biome === 'desert') tree(c, biome, p, .88, .88, .75);
}

function ballpark(c, p, biome, fine) {
  plate(c, p);
  for (let i = -.4; i < 1; i += .3) flat(c, i, -.4, i + .15, .95, p.stripe);
  // Home plate sits at the back corner; the stands curl round behind it and the field opens towards the camera.
  flat(c, -.62, -.62, .12, .12, '#b98d62'); flat(c, -.5, -.5, .0, .0, p.lawn);
  disc(c, -.25, -.25, .07, '#c79a6c', .01);
  for (const [u, v] of [[-.6, -.6], [.1, -.6], [.1, .1], [-.6, .1]]) flat(c, u - .03, v - .03, u + .03, v + .03, '#f4f2e8', .01);
  stroke(c, [at(c, -.6, -.6), at(c, .95, -.6)], '#f4f2e8', .3); stroke(c, [at(c, -.6, -.6), at(c, -.6, .95)], '#f4f2e8', .3);
  for (let row = 0; row < 3; row++) {
    const out = -1 + row * .1, z = .7 - row * .2, color = row % 2 ? '#a8a49a' : '#bcb7ab';
    box(c, out, out, out + .12, .55 - row * .05, 0, z, color); box(c, out + .12, out, .55 - row * .05, out + .12, 0, z, color);
  }
  flat(c, -1.02, -1.02, .6, -.86, shade(p.roof, 1.15), 1.05); flat(c, -1.02, -.86, -.86, .6, shade(p.roof, 1.05), 1.05);
  for (const [u, v] of [[-.95, .62], [.62, -.95]]) { post(c, u, v, 0, 2.6, '#6e7068', .5); box(c, u - .08, v - .04, u + .08, v + .04, 2.5, 2.68, '#ecedde'); }
  box(c, .8, -.98, .98, -.7, 0, 1.1, '#3d4c46'); flat(c, .82, -.96, .96, -.72, '#58705f', 1.1);
  if (biome !== 'desert') tree(c, biome, p, .9, .9, .8);
}

function sportsHall(c, p, biome, fine) {
  plate(c, p, p.paving);
  box(c, -.82, -.78, .66, .48, 0, 1.05, p.wall);
  // A shallow barrel roof: bands rising to the crown along u.
  const bands = [[.48, 1.05], [.12, 1.42], [-.22, 1.52], [-.56, 1.42], [-.78, 1.05]];
  for (let i = bands.length - 1; i > 0; i--) { const [va, za] = bands[i], [vb, zb] = bands[i - 1]; poly(c, [at(c, -.86, va, za), at(c, .7, va, za), at(c, .7, vb, zb), at(c, -.86, vb, zb)], shade(p.roof, .85 + i * .06)); }
  poly(c, [at(c, .66, -.78, 1.05), at(c, .66, .48, 1.05), ...bands.map(([v, z]) => at(c, .66, v, z)).reverse()], shade(p.wall, .74));
  if (biome === 'tundra') poly(c, [at(c, -.86, -.22, 1.52), at(c, .7, -.22, 1.52), at(c, .7, .12, 1.42), at(c, -.86, .12, 1.42)], '#eef1e8');
  stroke(c, [at(c, -.82, .48, .88), at(c, .66, .48, .88)], '#3f7f9a', 1.3);
  personnelDoor(c, .025, .48, 0, '#7fa9b5', 2);
  windowsRight(c, .66, -.7, .4, .3, .7, 4);
  windowsLeft(c, .48, -.78, -.28, .25, .65, 2, '#7fa9b5'); windowsLeft(c, .48, .32, .62, .25, .65, 1, '#7fa9b5');
  car(c, -.55, .78, '#b6553f'); car(c, -.2, .8, '#5f7f9a'); if (fine) car(c, .5, .82, '#d8d1b8');
  bush(c, p, .85, .7, .9);
}

function townHall(c, p, biome, fine) {
  plate(c, p, p.paving);
  flat(c, -.95, .55, -.35, .95, p.lawn); flat(c, .35, .55, .95, .95, p.lawn);
  box(c, -.78, -.62, .78, .36, 0, 1.4, p.wall);
  for (const [z0, z1] of [[.22, .55], [.85, 1.18]]) { windowsLeft(c, .36, -.72, -.24, z0, z1, 3); windowsLeft(c, .36, .24, .72, z0, z1, 3); windowsRight(c, .78, -.55, .3, z0, z1, 3); }
  stroke(c, [at(c, -.78, .36, .7), at(c, .78, .36, .7)], shade(p.wall, .85), .4);
  roof(c, -.78, -.62, .78, .36, 1.4, .6, p.roof);
  if (biome === 'tundra') snowcap(c, -.78, -.62, .78, .36, 1.4, .6);
  // The portico: steps, four columns and a pediment in front of the entrance.
  box(c, -.34, .36, .34, .62, 0, .06, '#d8d2bf'); box(c, -.3, .36, .3, .56, .06, .12, '#e2ddca');
  for (const u of [-.24, -.08, .08, .24]) box(c, u - .03, .5, u + .03, .56, .12, 1.12, '#f2eee0');
  box(c, -.3, .36, .3, .58, 1.12, 1.24, '#eae5d4');
  poly(c, [at(c, -.32, .58, 1.24), at(c, .32, .58, 1.24), at(c, 0, .58, 1.6)], '#e2dccb');
  personnelDoor(c, 0, .36, .12, '#6b5a44');
  // A clock tower over the middle of the roof, with its flag.
  box(c, -.15, -.27, .15, .03, 1.6, 2.5, shade(p.wall, .96));
  const [cx, cy] = at(c, 0, .03, 2.2); c.fillStyle = '#f4f1e4'; c.beginPath(); c.ellipse(cx - .1, cy, 1.2, 1.3, 0, 0, Math.PI * 2); c.fill();
  if (fine) stroke(c, [[cx - .1, cy], [cx - .1, cy - .85], [cx + .45, cy - .1]], '#3b3a36', .28);
  poly(c, [at(c, -.18, -.3, 2.5), at(c, .18, -.3, 2.5), at(c, .18, .06, 2.5), at(c, -.18, .06, 2.5)], shade(p.roof, 1.1));
  poly(c, [at(c, -.18, .06, 2.5), at(c, .18, .06, 2.5), at(c, .18, -.3, 2.5), at(c, 0, -.12, 3.05)], p.roof);
  post(c, 0, -.12, 3.05, 3.45, '#5f5a50', .3); poly(c, [at(c, 0, -.12, 3.45), at(c, .2, -.12, 3.38), at(c, 0, -.12, 3.3)], '#c0503f');
  bush(c, p, -.7, .8, .8); bush(c, p, .7, .8, .8); if (fine) { flowers(c, -.5, .72, ['#d98a7a', '#e6cf72', '#c58bb7'], fine); flowers(c, .5, .72, ['#e6cf72', '#c58bb7', '#d98a7a'], fine); }
  for (const u of [-.42, .42]) { post(c, u, .9, 0, .6, '#4d524c', .3); disc(c, u, .9, .045, '#f2e7b6', .62); }
}

// A shopfront: walls, the roof, a door and a window on the street (light) face. `sign` decorates the face.
function shopfront(c, p, biome, roofColor, wallColor, sign) {
  plate(c, p, p.paving);
  box(c, -.66, -.62, .54, .34, 0, 1.3, wallColor);
  windowsRight(c, .54, -.52, .24, .2, .5, 2); windowsRight(c, .54, -.52, .24, .82, 1.12, 2);
  windowsLeft(c, .34, -.56, .44, .82, 1.12, 3);
  personnelDoor(c, .28, .34);
  roof(c, -.66, -.62, .54, .34, 1.3, .62, roofColor);
  if (biome === 'tundra') snowcap(c, -.66, -.62, .54, .34, 1.3, .62);
  sign();
}
function awning(c, u0, u1, v, z, colors) {
  const n = 4, step = (u1 - u0) / n;
  for (let i = 0; i < n; i++) poly(c, [at(c, u0 + step * i, v, z), at(c, u0 + step * (i + 1), v, z), at(c, u0 + step * (i + 1), v + .16, z - .14), at(c, u0 + step * i, v + .16, z - .14)], colors[i % 2]);
}
function cafe(c, p, biome, fine) {
  shopfront(c, p, biome, '#a95a43', '#e6d8b8', () => {
    poly(c, [at(c, -.54, .34, .1), at(c, .08, .34, .1), at(c, .08, .34, .55), at(c, -.54, .34, .55)], '#7fa2a6');
    awning(c, -.58, .12, .34, .68, ['#3f6f5a', '#efe8d3']);
    for (const [u, color] of [[-.42, '#c0503f'], [.08, '#e6cf72']]) { disc(c, u, .68, .1, '#8a6a48', .14); post(c, u, .68, 0, .14, '#5d4a38', .3); post(c, u, .68, .14, .62, '#6a645a', .25); disc(c, u, .68, .22, color, .62); }
    });
}
function pharmacy(c, p, biome, fine) {
  shopfront(c, p, biome, '#5d6b75', '#eceae0', () => {
    poly(c, [at(c, -.54, .34, .1), at(c, .06, .34, .1), at(c, .06, .34, .55), at(c, -.54, .34, .55)], '#8fb3b5');
    stroke(c, [at(c, -.62, .34, .64), at(c, .5, .34, .64)], '#3f8a5a', 1.2);
    const [x, y] = at(c, .5, .34, .95); c.fillStyle = '#3f9a5a'; c.fillRect(x - .5, y - 1.5, 1, 3); c.fillRect(x - 1.5, y - .5, 3, 1);
    bush(c, p, .72, .66, .7);
  });
}
function bookshop(c, p, biome, fine) {
  shopfront(c, p, biome, '#4f5f6b', '#d9c8a6', () => {
    poly(c, [at(c, -.54, .34, .08), at(c, .06, .34, .08), at(c, .06, .34, .58), at(c, -.54, .34, .58)], '#5d4b3c');
    if (fine) for (const [u0, u1, color] of [[-.5, -.24, '#b5553f'], [-.2, .02, '#d9b44a']]) poly(c, [at(c, u0, .34, .14), at(c, u1, .34, .14), at(c, u1, .34, .44), at(c, u0, .34, .44)], color);
    post(c, .46, .38, .66, .9, '#4d4a44', .3); box(c, .44, .38, .52, .54, .5, .68, '#6b4f3a');
    box(c, -.62, .5, -.32, .62, .02, .1, '#8a6a48'); flowers(c, .7, .7, ['#c58bb7', '#e6cf72', '#d98a7a'], fine);
  });
}

const FEATURES = { park, playground, 'swimming-pool': swimmingPool, 'sports-field': sportsField, 'tennis-courts': tennisCourts, ballpark, 'sports-hall': sportsHall, 'town-hall': townHall, 'shop-cafe': cafe, 'shop-pharmacy': pharmacy, 'shop-bookshop': bookshop };
export const TOWN_FEATURE_KINDS = Object.freeze(Object.keys(FEATURES));

/** Draws a town feature into the sprite box; false for any other kind. */
export function drawTownFeature(c, kind, biome, detail = 'town') {
  const draw = FEATURES[kind];
  if (!draw) return false;
  profiles.set(c, { footprint: BUILDINGS[kind]?.footprint || 1, detail });
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  try { draw(c, PALETTES[biome] || PALETTES.taiga, biome, detail !== 'region'); }
  finally { c.restore(); profiles.delete(c); }
  return true;
}
