import { BUILDINGS } from '../buildings.js';
import { INDUSTRIES, WORKSHOP } from '../data.js';
import { createSprites, PALETTES } from '../sprites.js';
import { preloadWorldArt, worldArtStats } from '../atlas-runtime.js';
import { HOUSE_KINDS, HOUSE_DESIGNS, HOUSE_ROTATIONS, preloadHouses, hasRasterHouse } from '../raster-houses.js';
import { SHOP_ART_KINDS, RASTER_BUILDING_FAMILIES, hasRasterBuilding } from '../raster-buildings.js';
import { FARM_CORE_KINDS, drawRasterFarmCore, hasRasterFarmCore, hasRasterIndustry } from '../raster-industries.js';
import { drawDirectionalVehicle } from '../vehicle-directions.js';
import { featureWorldPixels, SPRITE_SCALE } from '../sprite-art-direction.js';

const biomes = ['taiga', 'tundra', 'desert'];
const details = new Map([[.5, 'region'], [1, 'town'], [2, 'detail']]);
const form = document.querySelector('#controls'), gallery = document.querySelector('#gallery');
const hash = canvas => {
  let value = 2166136261;
  for (const byte of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) value = Math.imul(value ^ byte, 16777619);
  return value >>> 0;
};
const coverage = canvas => {
  const { width, height } = canvas, data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let ink = 0, edge = 0, edgeAlphaMax = 0, left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3], boundary = !x || !y || x === width - 1 || y === height - 1;
    if (boundary) edgeAlphaMax = Math.max(edgeAlphaMax, alpha);
    if (alpha > 16) { ink++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    // Region-size downsampling can extend a faint fractional fringe beyond an
    // intact master gutter. Count visible body pixels separately from that fringe.
    if (boundary && alpha > 32) edge++;
  }
  return { ink, edge, edgeAlphaMax, bounds: ink ? [left, top, right + 1, bottom + 1] : null };
};

function entries(family) {
  if (family === 'houses') return HOUSE_KINDS.flatMap(kind => HOUSE_DESIGNS.flatMap(design => HOUSE_ROTATIONS.map(rotation => ({ kind, span: BUILDINGS[kind].footprint, variant: design * 6 + rotation, design, rotation, label: BUILDINGS[kind].name }))));
  if (family === 'industries') return Object.entries(INDUSTRIES).map(([kind, definition]) => ({ kind, span: definition.footprint, variant: 0, label: definition.name }));
  if (family === 'legacy') return Object.entries(INDUSTRIES).flatMap(([kind, definition]) => [1, 2, 3].map(span => ({ kind, span, variant: 0, legacy: true, label: definition.name })));
  if (family === 'cores') return FARM_CORE_KINDS.map(kind => ({ kind, span: 2, variant: 0, core: true, label: INDUSTRIES[kind].name }));
  if (family === 'features') return RASTER_BUILDING_FAMILIES['buildings-town-features'].filter(Boolean).map(kind => ({ kind, span: BUILDINGS[kind].footprint, variant: 0, design: 0, label: BUILDINGS[kind].name }));
  const catalog = Object.entries(BUILDINGS).flatMap(([kind, definition]) => {
    const designs = SHOP_ART_KINDS.includes(kind) ? [0, 1, 2] : [0];
    return designs.map(design => ({ kind, span: definition.footprint, variant: design * 5, design, rotation: 0, label: definition.name }));
  });
  return [...catalog, { kind: 'factory', span: WORKSHOP.footprint, variant: 0, auxiliary: true, label: 'Town workshop' }];
}

function coreSprite(kind, biome, density) {
  const image = document.createElement('canvas'); image.width = Math.round(64 * density); image.height = Math.round(72 * density);
  const c = image.getContext('2d'); c.scale(density, density); c.translate(0, 8);
  if (!drawRasterFarmCore(c, kind, biome, density)) throw new Error(`Missing farm core: ${kind}/${biome}`);
  return image;
}

function sample(entry, biome, zoom, sprite, density) {
  const image = entry.core ? coreSprite(entry.kind, biome, density) : sprite(entry.kind, entry.variant, Object.hasOwn(INDUSTRIES, entry.kind) ? entry.span : 1, '', entry.span);
  const width = Math.max(144, Math.ceil(48 * entry.span * zoom + 20));
  const height = Math.max(110, Math.ceil((48 * entry.span + 12) * zoom + 64));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width * devicePixelRatio); canvas.height = Math.round(height * devicePixelRatio);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const c = canvas.getContext('2d'); c.scale(devicePixelRatio, devicePixelRatio);
  c.fillStyle = PALETTES[biome].ground; c.fillRect(0, 0, width, height);
  const billboardWidth = 48 * entry.span * zoom, billboardHeight = (48 * entry.span + 12) * zoom;
  c.drawImage(image, (width - billboardWidth) / 2, 8, billboardWidth, billboardHeight);
  const baseline = height - 32;
  c.fillStyle = '#253a31'; c.font = '10px system-ui'; c.fillText('Door / person / bus / truck', 6, height - 7);
  c.save(); c.translate(8, baseline); c.scale(zoom, zoom);
  c.fillStyle = '#2e4952'; c.fillRect(0, -featureWorldPixels(SPRITE_SCALE.doorHeightMetres), featureWorldPixels(SPRITE_SCALE.doorWidthMetres), featureWorldPixels(SPRITE_SCALE.doorHeightMetres));
  c.fillStyle = '#f3d676'; c.fillRect(7, -featureWorldPixels(SPRITE_SCALE.humanHeightMetres), 1.3, featureWorldPixels(SPRITE_SCALE.humanHeightMetres));
  c.translate(30, -7); drawDirectionalVehicle(c, 'bus', Math.PI / 4, 20, zoom * devicePixelRatio);
  c.translate(28, 0); drawDirectionalVehicle(c, 'truck', Math.PI / 4, 20, zoom * devicePixelRatio); c.restore();
  const figure = document.createElement('figure'), caption = document.createElement('figcaption'), meta = document.createElement('small');
  caption.append(document.createTextNode(entry.label)); meta.textContent = `${entry.kind} · ${entry.span}×${entry.span}${entry.design !== undefined ? ` · design ${entry.design + 1}` : ''}${entry.rotation !== undefined && entry.kind.startsWith('house-') ? ` · rotation ${entry.rotation}` : ''}`;
  caption.append(meta); figure.append(canvas, caption); gallery.append(figure);
  const ready = entry.core ? hasRasterFarmCore(entry.kind, biome) : entry.kind.startsWith('house-') ? hasRasterHouse(entry.kind, biome, entry.rotation || 0, entry.design || 0) : Object.hasOwn(INDUSTRIES, entry.kind) ? hasRasterIndustry(entry.kind, biome) : hasRasterBuilding(entry.kind, biome, entry.design || 0);
  return { kind: entry.kind, biome, zoom, dpr: devicePixelRatio, span: entry.span, design: entry.design, rotation: entry.rotation, core: Boolean(entry.core), legacy: Boolean(entry.legacy), auxiliary: Boolean(entry.auxiliary), ready, width: image.width, height: image.height, expectedWidth: Math.round(32 * entry.span * density), expectedHeight: Math.round((32 * entry.span + 8) * density), hash: hash(image), ...coverage(image) };
}

function show({ biome = form.elements.biome.value, zoom = Number(form.elements.zoom.value), family = form.elements.family.value } = {}) {
  if (!biomes.includes(biome) || !details.has(zoom)) throw new Error('Unknown gallery profile.');
  form.elements.biome.value = biome; form.elements.zoom.value = String(zoom); form.elements.family.value = family;
  const selected = entries(family), density = zoom * devicePixelRatio * 1.5;
  const sprite = createSprites(biome, { pixelScale: density, detailLevel: details.get(zoom), gardenGround: 'terrain' });
  gallery.replaceChildren(); gallery.style.setProperty('--card-width', `${Math.max(172, 48 * Math.max(...selected.map(entry => entry.span)) * zoom + 40)}px`);
  document.querySelector('#heading').textContent = `${family} · ${biome} · ${zoom}× · DPR ${devicePixelRatio}`;
  const rows = selected.map(entry => sample(entry, biome, zoom, sprite, density));
  document.querySelector('#status').textContent = `${rows.length} sprites at actual game scale · door ${(featureWorldPixels(SPRITE_SCALE.doorHeightMetres) * zoom).toFixed(1)} screen pixels high`;
  return rows;
}

window.spriteScaleGalleryReady = (async () => {
  await Promise.all([preloadWorldArt({ waitMs: 30000 }), preloadHouses({ waitMs: 30000 })]);
  window.spriteScaleGallery = { show, entries, stats: worldArtStats, scale: SPRITE_SCALE };
  form.addEventListener('change', () => show());
  show();
  return true;
})().catch(error => { document.querySelector('#status').textContent = error.message; throw error; });
