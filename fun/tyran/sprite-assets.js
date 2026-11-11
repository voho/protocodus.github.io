/** Shared, alpha-trimmed atlas cells. Full decoded sheets are released after preparation. */
import { SPRITE_CELLS } from './sprite-cells.js';

// Scenery, terrain, hull and ammunition artwork is recolored from its pixels.
// Keeping these cells in CPU memory avoids a synchronous GPU readback (10–100
// ms) whenever a new appearance is prepared; none is drawn directly per frame.
// Effects stay GPU-resident: they are only drawn, never read.
const CPU_ATLASES = new Set(['nature', 'structures', 'structureLight', 'structureHeavy', 'materials', 'projectiles',
  'fleet', 'fleetJungle', 'fleetSnow', 'fleetDesert', 'fleetParadise', 'fleetAsteroid', 'fleetMars', 'fleetVolcanic', 'fleetNeon', 'fleetAlien', 'fleetVoid']);
const cellContext = (canvas, name) => canvas.getContext('2d', CPU_ATLASES.has(name) ? { willReadFrequently: true } : undefined);
const atlases = new Map();
const cells = new Map();
const status = new Map();
export let spriteRevision = 0;

function surface(width, height) {
  const canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
  canvas.width = width; canvas.height = height;
  return canvas;
}

async function loadAtlas(name) {
  if (typeof Image === 'undefined') {
    status.set(name, { state: 'unavailable' });
    return false;
  }
  status.set(name, { state: 'loading' });
  let image;
  try {
    image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Unable to load ${name} sprite atlas`));
    });
    const file = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    image.src = new URL(`./assets/sprites/${file}.webp`, import.meta.url).href;
    await loaded;
    if (image.decode) await image.decode();
    atlases.set(name, image);
    // tools/pack-atlases.py already trimmed every cell and gave pieces that
    // cross a grid line to their hull, so startup only copies rectangles.
    // Each frame/state owns exactly one cropped source; the sheet is released.
    SPRITE_CELLS[name].forEach((rect, index) => {
      if (!rect) { cells.set(`${name}:${index}`, null); return; }
      const [x, y, width, height] = rect, cell = surface(width, height);
      cellContext(cell, name).drawImage(image, x, y, width, height, 0, 0, width, height);
      cells.set(`${name}:${index}`, cell);
    });
    status.set(name, { state: 'ready', width: image.naturalWidth, height: image.naturalHeight });
    spriteRevision++;
    return true;
  } catch (error) {
    for (const key of cells.keys()) if (key.startsWith(`${name}:`)) cells.delete(key);
    status.set(name, { state: 'error', message: error.message });
    return false;
  } finally {
    atlases.delete(name);
    if (image) { image.onload = image.onerror = null; image.src = ''; }
  }
}

export const spritesReady = Promise.all(Object.keys(SPRITE_CELLS).map(async name => ({ name, ok: await loadAtlas(name) })))
  .then(results => ({ loaded: results.filter(result => result.ok).map(result => result.name), failed: results.filter(result => !result.ok).map(result => result.name) }));

export function spriteStatus() { return Object.fromEntries(status); }

/** Retained RGBA surface estimates; excludes browser-managed compressed file caches. */
export function spriteMemory() {
  const atlasBytes = [...atlases.values()].reduce((bytes, image) => bytes + image.naturalWidth * image.naturalHeight * 4, 0);
  const cellBytes = [...cells.values()].reduce((bytes, cell) => bytes + (cell ? cell.width * cell.height * 4 : 0), 0);
  return { atlasCount: atlases.size, cellCount: cells.size, atlasBytes, cellBytes, estimatedBytes: atlasBytes + cellBytes };
}

/** Return an alpha-trimmed cell with two pixels of safe transparent padding. */
export function spriteCell(name, index) {
  return cells.get(`${name}:${index}`) ?? null;
}
