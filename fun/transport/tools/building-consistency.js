import { BUILDINGS } from '../buildings.js';
import { INDUSTRIES, WORKSHOP } from '../data.js';
import { createRenderer } from '../renderer.js';
import { atlasAvailable, preloadWorldArt, worldArtStats } from '../atlas-runtime.js';
import { HOUSE_KINDS, HOUSE_DESIGNS, HOUSE_ROTATIONS, getHouseAssetStats, preloadHouses } from '../raster-houses.js';
import { SHOP_ART_KINDS, BUILDING_ART_DESIGNS } from '../raster-buildings.js';
import { RASTER_INDUSTRY_IDS, FARM_CORE_KINDS } from '../raster-industries.js';
import { farmCrop, farmCore } from '../farm-fields-art.js';
import { drawDirectionalVehicle } from '../vehicle-directions.js';
import { SPRITE_SCALE, featureWorldPixels } from '../sprite-art-direction.js';
import { cardinalDirection, isometricStationBounds } from '../isometric-infrastructure.js';
import { PART_BOXES } from '../airport-art.js';

// Layout is expressed in projected world pixels, never fitted to silhouettes.
// A renderer zoom changes every building, parcel and scale reference together.
const WIDTH = 2048, MARGIN = 64, TILE = 32, BIOME = 'taiga', SEED = 1847, DPR = Math.min(devicePixelRatio || 1, 2);
const canvas = document.querySelector('#world'), context = canvas.getContext('2d');
const must = (condition, message) => { if (!condition) throw new Error(message); };
const houseEntries = HOUSE_KINDS.flatMap(kind => HOUSE_DESIGNS.flatMap(design => HOUSE_ROTATIONS.map(rotation => ({
  kind, type: 'town', name: BUILDINGS[kind].name, width: BUILDINGS[kind].footprint, height: BUILDINGS[kind].footprint,
  design, rotation, variant: design * 6 + rotation,
}))));
const townEntries = Object.entries(BUILDINGS).filter(([kind]) => !HOUSE_KINDS.includes(kind)).flatMap(([kind, definition]) =>
  (SHOP_ART_KINDS.includes(kind) ? BUILDING_ART_DESIGNS : [0]).map(design => ({
    kind, type: 'town', name: definition.name, width: definition.footprint, height: definition.footprint, design, variant: design * 5,
  })),
);
townEntries.push({ kind: 'factory', type: 'town', name: 'Town workshop', width: WORKSHOP.footprint, height: WORKSHOP.footprint, design: 0, variant: 0 });
const industryEntries = Object.entries(INDUSTRIES).flatMap(([kind, definition]) => (kind === 'farm' ? [0, 1] : [0]).map(variant => {
  const candidates = [`industry:${kind}:${BIOME}`, ...RASTER_INDUSTRY_IDS.filter(id => id.startsWith(`industry:${kind}:`))];
  const artwork = candidates.find(id => RASTER_INDUSTRY_IDS.includes(id));
  return { kind, type: 'industry', name: `${definition.name}${kind === 'farm' ? variant ? ' — corn' : ' — wheat' : ''}`, width: definition.footprint, height: definition.footprint, variant, artwork, sourceBiome: artwork?.split(':')[2] };
}));
const stationEntries = [
  { kind: 'bus-stop', mode: 'road', name: 'Road stop', width: 3, height: 1 },
  { kind: 'train-stop', mode: 'rail', name: 'Rail station', width: 3, height: 1 },
  ...[[-1, 0], [0, -1], [1, 0], [0, 1]].map(([dx, dy], index) => ({ kind: 'port', mode: 'water', name: `Port — land ${['west', 'north', 'east', 'south'][index]}`, width: 3, height: 3, dx, dy })),
  ...['x', 'y'].map(axis => ({ kind: `airport-${axis}`, mode: 'air', axis, name: `Airport — ${axis} runway`, width: axis === 'x' ? 6 : 2, height: axis === 'x' ? 2 : 6 })),
].map(entry => ({ ...entry, type: 'station' }));
const sections = [
  { name: 'Houses — three designs, two rotations', entries: houseEntries },
  { name: 'Town buildings, shops, parks and malls', entries: townEntries },
  { name: 'Industries — 5 × 5 plots; farms have 2 × 2 building cores', entries: industryEntries },
  { name: 'Stops, ports and airports', entries: stationEntries },
];

// The inverse isometric projection puts rows horizontally on the screen while
// keeping integer tile anchors and enough clear ground between complete plots.
let bottom = 176;
for (const section of sections) {
  section.top = bottom; bottom += 48;
  let row = [], used = 0;
  const finishRow = () => {
    if (!row.length) return;
    const above = Math.max(...row.map(entry => entry.type === 'station' ? 100 : 36 * entry.width + 12));
    const below = Math.max(...row.map(entry => TILE * (entry.width + entry.height) / 4));
    const baseline = bottom + above + 8;
    let left = MARGIN;
    for (const entry of row) {
      const cx = left + entry.slot / 2, spanX = entry.width, spanY = entry.height;
      const projectedX = cx - WIDTH / 2, projectedY = baseline;
      const u = projectedY / TILE + projectedX / (2 * TILE), v = projectedY / TILE - projectedX / (2 * TILE);
      entry.x = Math.round(u - spanX / 2) + 48;
      entry.y = Math.round(v - spanY / 2) + 48;
      entry.labelY = baseline + below + 16;
      left += entry.slot;
    }
    bottom = baseline + below + 58; row = []; used = 0;
  };
  for (const entry of section.entries) {
    entry.slot = Math.max(192, TILE * (entry.width + entry.height) + 48);
    if (used + entry.slot > WIDTH - MARGIN * 2) finishRow();
    row.push(entry); used += entry.slot;
  }
  finishRow(); section.bottom = bottom; bottom += 28;
}
const HEIGHT = Math.ceil(bottom / 32) * 32;
const entries = sections.flatMap(section => section.entries);
const size = Math.ceil(HEIGHT / TILE) + 128;
const game = {
  biome: BIOME, seed: SEED, width: size, height: size,
  tiles: Array.from({ length: size * size }, (_, variant) => ({ terrain: 'grass', elevation: 0, detail: '', variant, cleared: true })),
  revision: 1, networkRevision: 1, day: 0, cities: [], industries: [], stations: [], routes: [], vehicles: [], zones: [], terrainObjects: [],
};
const tile = (x, y) => game.tiles[y * size + x];
const occupied = new Set();
for (const [index, entry] of entries.entries()) {
  for (let y = entry.y; y < entry.y + entry.height; y++) for (let x = entry.x; x < entry.x + entry.width; x++) {
    must(x >= 2 && y >= 2 && x < size - 2 && y < size - 2, `${entry.kind}: inside fixture`);
    const id = y * size + x; must(!occupied.has(id), `${entry.kind}: plots must not overlap`); occupied.add(id);
  }
  if (entry.type === 'town') {
    tile(entry.x, entry.y).variant = entry.variant;
    tile(entry.x, entry.y).building = { kind: entry.kind, level: 1, footprint: entry.width };
  } else if (entry.type === 'industry') {
    const site = { id: `industry-${index}`, kind: entry.kind, x: entry.x, y: entry.y, footprint: entry.width, variant: entry.variant, stock: {}, inputStock: {} };
    must(site.footprint === 5, `${entry.kind}: current industries use 5 × 5 tiles`);
    if (FARM_CORE_KINDS.includes(site.kind)) must(farmCore(site).span === 2, `${site.kind}: farm core uses 2 × 2 tiles`);
    if (site.kind === 'farm') must(farmCrop(site, SEED) === (entry.variant ? 'corn' : 'wheat'), 'Both grain crops are represented');
    entry.site = site; game.industries.push(site);
  } else {
    const station = { id: `station-${index}`, mode: entry.mode, name: entry.name, x: entry.x, y: entry.y, ...(entry.axis ? { axis: entry.axis } : {}) };
    if (entry.mode === 'road' || entry.mode === 'rail') {
      station.x++; for (let x = entry.x; x < entry.x + 3; x++) tile(x, entry.y)[entry.mode] = true;
    } else if (entry.mode === 'water') {
      station.x++; station.y++;
      for (let y = entry.y; y < entry.y + 3; y++) for (let x = entry.x; x < entry.x + 3; x++) tile(x, y).terrain = 'water';
      tile(station.x + entry.dx, station.y + entry.dy).terrain = 'grass';
      const land = [[-1, 0], [0, -1], [1, 0], [0, 1]].find(([dx, dy]) => tile(station.x + dx, station.y + dy).terrain !== 'water');
      must(land[0] === entry.dx && land[1] === entry.dy, `${entry.name}: intended shoreline orientation`);
    }
    game.stations.push(station); entry.station = station;
  }
}
must(new Set(entries.filter(entry => entry.type === 'town').map(entry => entry.kind)).size === Object.keys(BUILDINGS).length + 1, 'Every town kind and workshop is present');
must(new Set(industryEntries.map(entry => entry.kind)).size === Object.keys(INDUSTRIES).length, 'Every industry kind is present');
must(game.tiles.every(tile => tile.elevation === 0), 'All ground and water are flat at height zero');
const fixtureBefore = JSON.stringify(game);
let renderer, zoom = 1, submissions = [];
const drawImage = context.drawImage.bind(context);
context.drawImage = (image, ...args) => {
  if (args.length === 4) {
    const m = context.getTransform(), [x, y, w, h] = args;
    if (m.b === 0 && m.c === 0) submissions.push({ x: (m.a * x + m.e) / DPR, y: (m.d * y + m.f) / DPR, width: m.a * w / DPR, height: m.d * h / DPR, id: image.infrastructureFrame?.id });
  }
  return drawImage(image, ...args);
};
const label = (text, x, y, size = 14, bold = false) => {
  context.font = `${bold ? '600 ' : ''}${size * zoom}px system-ui, sans-serif`;
  context.lineJoin = 'round'; context.lineWidth = 4 * zoom; context.strokeStyle = '#e4edce'; context.fillStyle = '#26382b';
  context.strokeText(text, x * zoom, y * zoom); context.fillText(text, x * zoom, y * zoom);
};
function annotate() {
  const dpr = renderer.getStats().devicePixelRatio;
  context.save(); context.setTransform(dpr, 0, 0, dpr, 0, 0);
  label('Transport — every building on flat grass', MARGIN, 42, 26, true);
  label(`${entries.length} samples · ${zoom === 1 ? 'Town' : 'Detail'} view (${zoom}×) · shared 16 m tile · no individual sprite resizing`, MARGIN, 70);
  label('Taiga town styles; industry source climate labelled. Farm fields and station grounds use the actual world renderer.', MARGIN, 94);
  label('Scale references:', MARGIN, 142, 14, true);
  context.save(); context.scale(zoom, zoom); context.translate(MARGIN + 156, 139);
  context.fillStyle = '#2e4952'; context.fillRect(0, -featureWorldPixels(SPRITE_SCALE.doorHeightMetres), featureWorldPixels(SPRITE_SCALE.doorWidthMetres), featureWorldPixels(SPRITE_SCALE.doorHeightMetres));
  context.fillStyle = '#edcf6e'; context.fillRect(32, -featureWorldPixels(SPRITE_SCALE.humanHeightMetres), 1.3, featureWorldPixels(SPRITE_SCALE.humanHeightMetres));
  context.translate(64, 0); drawDirectionalVehicle(context, 'bus', Math.PI / 4, 20, zoom * dpr); context.translate(72, 0);
  drawDirectionalVehicle(context, 'truck', Math.PI / 4, 20, zoom * dpr); context.restore();
  label('2.1 m door · 1.75 m person · bus · truck', MARGIN + 360, 142);
  for (const section of sections) label(section.name, MARGIN, section.top + 24, 20, true);
  for (const entry of entries) {
    const centre = renderer.gridPointToScreen(entry.x + entry.width / 2, entry.y + entry.height / 2);
    const x = centre.x / zoom - entry.slot / 2 + 8;
    label(entry.name, x, entry.labelY, 12, true);
    const variant = entry.rotation !== undefined ? ` · design ${entry.design + 1}, rotation ${entry.rotation + 1}` : SHOP_ART_KINDS.includes(entry.kind) ? ` · design ${entry.design + 1}` : '';
    const source = entry.type === 'industry' ? ` · ${entry.sourceBiome} art` : '';
    const footprint = entry.type === 'station' && entry.mode !== 'air' ? `1 × 1 · ${entry.mode === 'water' ? '3 × 3 shore pad' : '3-tile track'}` : `${entry.width} × ${entry.height}`;
    label(`${footprint}${variant}${source}`, x, entry.labelY + 18, 10);
  }
  context.restore();
}

function show(nextZoom = 1) {
  must(nextZoom === 1 || nextZoom === 2, 'Use native Town or Detail zoom');
  zoom = nextZoom; canvas.style.width = `${WIDTH * zoom}px`; canvas.style.height = `${HEIGHT * zoom}px`;
  if (!renderer) renderer = createRenderer(canvas, game, { zoom, heightStep: 0, sceneryBatching: false, layers: { grid: false, weather: false, names: false, routes: false, industryIcons: false, trees: false, vehicleLoads: false } });
  else { renderer.resize(); renderer.setZoom(zoom); }
  renderer.focus(48 + HEIGHT / (2 * TILE) - .5, 48 + HEIGHT / (2 * TILE) - .5);
  // settle finishes lazy terrain work synchronously; fixed time freezes water.
  submissions = []; renderer.render(1000, { settle: true }); annotate();
  must(JSON.stringify(game) === fixtureBefore, 'Rendering must not mutate the fixture');
  document.querySelector('#status').textContent = `${entries.length} samples · ${WIDTH * zoom} × ${HEIGHT * zoom} pixels`;
  return report();
}
function report() {
  const stats = renderer.getStats(), dpr = stats.devicePixelRatio;
  const rows = entries.map(entry => {
    const p = renderer.gridPointToScreen(entry.x + entry.width / 2, entry.y + entry.height / 2);
    const isFarm = entry.type === 'industry' && FARM_CORE_KINDS.includes(entry.kind);
    const span = isFarm ? 2 : entry.width;
    const centre = isFarm ? renderer.gridPointToScreen(entry.x + 2, entry.y + 2) : p;
    let envelopes = [{ x: centre.x - 24 * span * zoom, y: centre.y - (36 * span + 12) * zoom, width: 48 * span * zoom, height: (48 * span + 12) * zoom }];
    if (entry.type === 'station') {
      if (entry.mode === 'air') {
        const origin = renderer.gridPointToScreen(entry.station.x, entry.station.y);
        envelopes = Object.values(PART_BOXES[entry.axis]).map(box => ({ x: Math.round(origin.x + (box.left - 2) * zoom), y: Math.round(origin.y + (box.top - 2) * zoom), width: Math.ceil((box.width + 4) * zoom * dpr) / dpr, height: Math.ceil((box.height + 4) * zoom * dpr) / dpr }));
      } else {
        const origin = renderer.worldToScreen(entry.station.x, entry.station.y), bounds = isometricStationBounds(entry.mode), stop = entry.mode !== 'water';
        envelopes = [{ x: origin.x + (bounds.left + (stop ? 11 : 0)) * zoom, y: origin.y + (bounds.top + (stop ? 2 : 0)) * zoom, width: bounds.size * zoom, height: bounds.size * zoom, id: stop ? `isometric:${entry.kind}` : `isometric:port-${cardinalDirection(entry.dx, entry.dy)}` }];
      }
    }
    const submitted = envelopes.every(envelope => submissions.some(call => (!envelope.id || envelope.id === call.id) && ['x', 'y', 'width', 'height'].every(key => Math.abs(call[key] - envelope[key]) < .1)));
    return { kind: entry.kind, type: entry.type, name: entry.name, x: entry.x, y: entry.y, width: entry.width, height: entry.height, design: entry.design, rotation: entry.rotation, variant: entry.variant, sourceBiome: entry.sourceBiome, centre: p, envelopes, submitted };
  });
  return { zoom, width: canvas.width / dpr, height: canvas.height / dpr, samples: entries.length, rows, sections: sections.map(({ name, top, bottom }) => ({ name, top: top * zoom, bottom: bottom * zoom })), flat: game.tiles.every(tile => tile.elevation === 0), immutable: JSON.stringify(game) === fixtureBefore, scale: SPRITE_SCALE, stats };
}
window.buildingConsistencyReady = (async () => {
  await Promise.all([preloadWorldArt({ waitMs: 30000 }), preloadHouses({ biome: BIOME, waitMs: 30000 })]);
  must(worldArtStats().loading === 0 && worldArtStats().errors.length === 0, 'All registered artwork must finish loading');
  for (const entry of entries.filter(entry => entry.type !== 'station')) {
    if (HOUSE_KINDS.includes(entry.kind)) {
      const sheet = getHouseAssetStats(BIOME, entry.rotation, entry.design);
      must(sheet.activeBiome === BIOME && sheet.activeRotation === entry.rotation && sheet.activeDesign === entry.design, `${entry.kind}: exact house variant loaded`);
    } else {
      const id = entry.type === 'industry' ? FARM_CORE_KINDS.includes(entry.kind) ? `farm-core:${entry.kind}:${BIOME}` : entry.artwork : `civic:${entry.kind}:${BIOME}${entry.design ? `:design-${entry.design}` : ''}`;
      must(atlasAvailable(id), `${entry.kind}: exact artwork ${id} loaded`);
    }
  }
  window.buildingConsistency = { show, report, game, canvas };
  document.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click', () => show(Number(button.dataset.zoom))));
  show(); return true;
})().catch(error => { document.querySelector('#status').textContent = error.message; throw error; });
