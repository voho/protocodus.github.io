// Generated marine art is cached at each view's display density. The native
// drawings below are recovery artwork while PNGs load or cannot be fetched.
// Eight authored headings keep hull edges stable on the water grid.
import { drawRasterVehicle, drawRasterInfrastructure } from './raster-transport.js';
import { worldArtRevision } from './atlas-runtime.js';
export const MARINE_SIZE = 64;
const TAU = Math.PI * 2;
const bulk = new Set(['coal', 'iron', 'copper', 'stone', 'sand', 'grain', 'cement']);
const timber = new Set(['timber', 'lumber']);
const cargoColors = { coal: '#4d5858', iron: '#b88870', copper: '#c29565', stone: '#b0b2a4', sand: '#dbc389', grain: '#d9bd67', cement: '#c8c1a7', food: '#91ad6d', fish: '#85b8b5', glass: '#9dc6c0', steel: '#9baeb0', machinery: '#829b99', furniture: '#bd966d', goods: '#ac96af', wire: '#c99368' };
const rect = (c, x, y, width, height, color) => { c.fillStyle = color; c.fillRect(x, y, width, height); };
function polygon(c, points, color) { c.fillStyle = color; c.beginPath(); points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); }
function line(c, points, color, width = .8) { c.strokeStyle = color; c.lineWidth = width; c.beginPath(); points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); }
function oval(c, x, y, rx, ry, color) { c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill(); }

function shipArtwork(c, cargo, band, color, profile) {
  const regional = profile === 'region', ferry = cargo === 'passengers';
  const hull = [[-16, -4], [-13, -7], [8, -7], [15, -4], [19, 0], [15, 4], [8, 7], [-13, 7], [-16, 4]];
  c.save(); c.translate(1.5, 2); polygon(c, hull, '#183e474e'); c.restore();
  polygon(c, hull, '#294d50');
  polygon(c, [[-15, -4], [-12, -6], [8, -6], [15, -3], [18, 0], [14, 3], [8, 6], [-12, 6], [-15, 3]], color);
  polygon(c, [[-14, -3], [-11, -5], [8, -5], [15, -2], [16, 0], [13, 3], [7, 5], [-12, 5], [-14, 3]], '#e2d6b4');
  line(c, [[-12, -5], [8, -5], [15, -2]], '#fff0cf', regional ? 1.7 : .8);
  line(c, [[-13, 5], [7, 5], [14, 2]], '#8b8e76', regional ? 1.4 : .7);
  // Wheelhouse sits aft, leaving a broad cargo hold and an unmistakable bow.
  rect(c, -12, -4.5, 6, 9, '#728c87'); rect(c, -12, -4.5, 5, 7.5, '#f3e6c6');
  rect(c, -7.7, -3.5, 1.7, 7, '#426b74'); rect(c, -11, -4, 3, 1, '#849f9b');
  rect(c, -13, -2, 1.5, 4, '#b79863'); rect(c, -10, -1.4, 2, 2.8, '#495d5d');
  if (ferry) {
    rect(c, -4, -4.1, 13, 8.2, '#8c9d95'); rect(c, -4, -4.1, 12, 7, '#f4ecd0');
    rect(c, -1, -2.2, 7, 4.4, '#d0d4bd');
    for (let x = -3; x < 9; x += 3) { rect(c, x, -4.2, 1.7, 1.4, '#44717b'); rect(c, x, 2.4, 1.7, 1.3, '#44717b'); }
    if (band) for (let index = 0; index < band * 2; index++) { rect(c, -2 + (index % 3) * 3, -.8 + Math.floor(index / 3) * 2, 1, 1, index % 2 ? '#a7704f' : '#597762'); }
    oval(c, 10, -3, 1.3, 1.3, '#c88a51'); oval(c, 10, -3, .55, .55, '#f1e7c4');
  } else {
    rect(c, -4.5, -4.5, 14, 9, '#7e8877'); rect(c, -3.5, -3.5, 12, 7, '#b6ad8a');
    if (!band) { rect(c, -3, -2.6, 11, 5.2, '#857f68'); line(c, [[-2, 0], [7, 0]], '#b3aa89', .7); }
    else if (bulk.has(cargo)) {
      const tint = cargoColors[cargo] || '#aab39a';
      for (let n = 0; n < band; n++) { const x = -1.5 + n * 3.4; oval(c, x, 0, 3.2, 2.7, '#525e5066'); polygon(c, [[x-3, 1], [x-2, -2], [x+.7, -2.5], [x+3, 1], [x+1, 3]], tint); if (!regional) line(c, [[x-2, -1.6], [x+.5, -2], [x+2, .5]], '#ebdfb369', .55); }
    } else if (timber.has(cargo)) {
      for (let n = 0; n < band; n++) { const y = -2.7 + n * 2.1; rect(c, -3, y, 11, 1.8, '#896d49'); rect(c, -3, y, 10, .8, '#d1b079'); oval(c, 7.5, y+.8, .9, .8, '#e5c694'); }
      if (!regional) { line(c, [[-.5, -3], [-.5, 3.6]], '#615e4c', .7); line(c, [[5, -3], [5, 3.6]], '#615e4c', .7); }
    } else if (cargo === 'oil' || cargo === 'fuel') {
      for (let n = 0; n < band; n++) { const x = -1.3 + n * 3.5; rect(c, x-1.2, -2.5, 2.6, 5, '#9ca89a'); oval(c, x, -2.5, 1.3, .9, cargo === 'fuel' ? '#d2b770' : '#ced0b8'); line(c, [[x+.7, -1.5], [x+.7, 2]], '#75877c', .65); }
    } else {
      for (let n = 0; n < band; n++) { const x = -3 + n * 3.8, tint = cargoColors[cargo] || '#b39477'; rect(c, x+.8, -2.2, 3.4, 5.8, '#4d615858'); rect(c, x, -3, 3.4, 5.5, tint); rect(c, x, -3, 3.4, .8, '#f2e4bb83'); if (!regional) { line(c, [[x+.7, -2], [x+.7, 1.6]], '#41554a55', .5); line(c, [[x+2.2, -2], [x+2.2, 1.6]], '#41554a55', .5); } }
    }
  }
  // Foredeck cleat, stern exhaust and contrasting navigation lamps.
  rect(c, 12, -.6, 2.5, 1.2, '#63766b');
  if (!regional) { rect(c, -11, -2, 1.2, 4, '#536463'); rect(c, 8, -5.8, 1.2, 1, '#b66c50'); rect(c, 8, 4.8, 1.2, 1, '#75a28b'); }
}

function portArtwork(c, profile) {
  const regional = profile === 'region';
  // Land lies to the left. The center remains a clear berth for arriving ships.
  rect(c, -19, -12, 7, 28, '#23485142'); rect(c, -16, 10, 32, 6, '#23485142');
  rect(c, -20, -14, 6, 28, '#7d7152'); rect(c, -19, -13, 5, 26, '#b5a578');
  rect(c, -19, 8, 34, 5, '#866f4e'); rect(c, -19, 8, 33, 3.5, '#c7b285');
  rect(c, -19, -14, 17, 4, '#887556'); rect(c, -19, -14, 16, 2.5, '#cbb78a');
  if (!regional) {
    for (let x = -18; x < 15; x += 3) line(c, [[x, 8], [x, 12]], '#897a5880', .6);
    for (let y = -12; y < 13; y += 3) line(c, [[-19, y], [-14, y]], '#e3cda183', .55);
  }
  for (const x of [-15, 0, 12]) { oval(c, x+.8, 10.2, 1.4, 1, '#675f4c'); oval(c, x, 9.3, 1.2, .8, '#e1c496'); }
  for (const y of [-9, 4]) { oval(c, -13.4, y, 1.2, 2, '#384e49'); oval(c, -13.2, y, .5, 1, '#71847a'); }
  // A small warehouse roof and sheltered loading apron share the town palette.
  rect(c, -24, 6, 11, 9, '#2b493944'); rect(c, -25, 4, 11, 9, '#c4c3a7');
  polygon(c, [[-26, 5], [-23, 1], [-16, 1], [-13, 5], [-13, 8], [-26, 8]], '#627f81');
  polygon(c, [[-26, 5], [-13, 5], [-13, 7], [-26, 7]], '#84a09a');
  rect(c, -21, 9, 4, 4, '#526d66'); rect(c, -24, 9, 2, 2, '#efdfb4');
  // Crane on the upper pier, with its suspended hook outside the clear berth.
  rect(c, -15, -16, 6, 4, '#82745a'); line(c, [[-12, -13], [-12, -23], [4, -20]], '#bfa460', regional ? 2 : 1.7);
  line(c, [[-12, -22], [-4, -13], [-12, -13]], '#837950', .8);
  line(c, [[4, -20], [4, -11], [6, -11]], '#475f58', regional ? 1.4 : .75);
  rect(c, -15, -17, 4, 4, '#d6c18b'); rect(c, -14, -16, 2, 2, '#597471');
}

export function createMarineSprites({ pixelScale = 1, detailLevel = 'town' } = {}) {
  const scale = Math.max(.25, Number(pixelScale) || 1), cache = new Map();
  let revision=worldArtRevision();
  function raster(key, angle, draw) {
    if(revision!==worldArtRevision()){cache.clear();revision=worldArtRevision();}
    if (cache.has(key)) { const image = cache.get(key); cache.delete(key); cache.set(key, image); return image; }
    const image = document.createElement('canvas'); image.width = image.height = Math.ceil(MARINE_SIZE * scale);
    const c = image.getContext('2d'); c.scale(scale, scale); c.translate(MARINE_SIZE / 2, MARINE_SIZE / 2); c.rotate(angle); draw(c);
    if (cache.size >= 64) { const oldest = cache.keys().next().value, old = cache.get(oldest); old.width = old.height = 0; cache.delete(oldest); }
    cache.set(key, image); return image;
  }
  return {
    ship(vehicle, route) {
      const heading = ((Math.round((Number.isFinite(vehicle.angle) ? vehicle.angle : 0) / (Math.PI / 4)) % 8) + 8) % 8;
      const ratio = Math.max(0, Math.min(1, (vehicle.load || 0) / Math.max(1, vehicle.capacity || 1))), band = ratio ? Math.max(1, Math.ceil(ratio * 3)) : 0;
      const cargo = route?.cargo || 'goods', color = route?.color || '#a66d4b';
      return raster(`ship:${heading}:${cargo}:${band}:${color}`, heading * Math.PI / 4, c => {if(!drawRasterVehicle(c,vehicle,{...route,mode:'water'},{pixelScale:scale,heading:heading*Math.PI/4}))shipArtwork(c,cargo,band,color,detailLevel);});
    },
    port(landAngle) {
      const heading = ((Math.round((landAngle - Math.PI) / (Math.PI / 2)) % 4) + 4) % 4;
      return raster(`port:${heading}`, heading * Math.PI / 2, c => {if(!drawRasterInfrastructure(c,'port',-29,-27,52,52,scale))portArtwork(c,detailLevel);});
    },
    getStats: () => ({ count: cache.size, pixelScale: scale, size: Math.ceil(MARINE_SIZE * scale) }),
  };
}

export function drawShipWake(c, vehicle, now, profile = 'town') {
  if (vehicle.dwellRemaining > 0 || vehicle.waiting) return;
  c.save(); c.translate((vehicle.x + .5) * 32, (vehicle.y + .5) * 32); c.rotate(Number.isFinite(vehicle.angle) ? vehicle.angle : 0);
  const phase = Math.sin(now * .004 + vehicle.x * 2 + vehicle.y) * .65, regional = profile === 'region';
  line(c, [[-15, -3], [-22, -4.4], [-29, -6 + phase]], '#d0e3d679', regional ? 1.8 : 1.1);
  line(c, [[-15, 3], [-22, 4.4], [-29, 6 - phase]], '#d0e3d679', regional ? 1.8 : 1.1);
  if (!regional) { line(c, [[-18, -.7], [-24, phase], [-31, .5]], '#d9eadd65', 1.1); line(c, [[12, -4], [17, -2], [19, 0], [17, 2], [12, 4]], '#e0ecda6d', .75); }
  c.restore();
}
