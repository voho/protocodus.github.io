/** Shared, alpha-trimmed atlas cells. Full decoded sheets are released after preparation. */
const LAYOUTS = Object.freeze({
  fleet: [4, 3], nature: [4, 4], structures: [4, 4],
  materials: [8, 5], effects: [4, 4], projectiles: [4, 3],
  structureLight: [4, 4], structureHeavy: [4, 4],
  fleetJungle: [4, 3], fleetSnow: [4, 3], fleetDesert: [4, 3], fleetParadise: [4, 3], fleetAsteroid: [4, 3],
  fleetMars: [4, 3], fleetVolcanic: [4, 3], fleetNeon: [4, 3], fleetAlien: [4, 3], fleetVoid: [4, 3],
});
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
const connectedAtlases = new Set();
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
    // Each frame/state owns exactly one cropped source. Keeping the full sheet
    // as well would retain another ~6 MiB per atlas, including empty padding.
    const [columns, rows] = LAYOUTS[name];
    for (let index = 0; index < columns * rows; index++) spriteCell(name, index);
    status.set(name, { state: 'ready', width: image.naturalWidth, height: image.naturalHeight });
    spriteRevision++;
    return true;
  } catch (error) {
    for (const key of cells.keys()) if (key.startsWith(`${name}:`)) cells.delete(key);
    status.set(name, { state: 'error', message: error.message });
    return false;
  } finally {
    atlases.delete(name);
    connectedAtlases.delete(name);
    if (image) { image.onload = image.onerror = null; image.src = ''; }
  }
}

export const spritesReady = Promise.all(Object.keys(LAYOUTS).map(async name => ({ name, ok: await loadAtlas(name) })))
  .then(results => ({ loaded: results.filter(result => result.ok).map(result => result.name), failed: results.filter(result => !result.ok).map(result => result.name) }));

export function spriteStatus() { return Object.fromEntries(status); }

/** Retained RGBA surface estimates; excludes browser-managed compressed file caches. */
export function spriteMemory() {
  const atlasBytes = [...atlases.values()].reduce((bytes, image) => bytes + image.naturalWidth * image.naturalHeight * 4, 0);
  const cellBytes = [...cells.values()].reduce((bytes, cell) => bytes + (cell ? cell.width * cell.height * 4 : 0), 0);
  return { atlasCount: atlases.size, cellCount: cells.size, atlasBytes, cellBytes, estimatedBytes: atlasBytes + cellBytes };
}

// A few generated hulls and antennas cross their nominal cell boundary. Assign
// connected pieces by their center before cropping, preserving those tips while
// keeping them out of a neighboring sprite. This analysis runs once per atlas.
function connectedCells(name, image, [columns, rows]) {
  const width = image.naturalWidth, height = image.naturalHeight, count = width * height;
  const source = surface(width, height), c = source.getContext('2d', { willReadFrequently: true });
  c.drawImage(image, 0, 0);
  const pixels = c.getImageData(0, 0, width, height).data, words = new Uint32Array(pixels.buffer, pixels.byteOffset, count);
  // One byte of coverage per pixel: the flood fill below never re-reads RGBA.
  const solid = new Uint8Array(count);
  for (let i = 0, p = 3; i < count; i++, p += 4) if (pixels[p] >= 8) solid[i] = 1;
  const labels = new Int32Array(count), queue = new Int32Array(count), owners = [0];
  const bounds = Array.from({ length: columns * rows }, () => ({ left: width, top: height, right: -1, bottom: -1 }));
  let label = 0;
  for (let start = 0; start < count; start++) {
    if (!solid[start] || labels[start]) continue;
    label++;
    let head = 0, tail = 1, sumX = 0, sumY = 0;
    let left = width, top = height, right = -1, bottom = -1;
    queue[0] = start; labels[start] = label;
    // Eight-connected fill with the neighbourhood unrolled; membership,
    // centroid and bounds are identical to a generic neighbour loop.
    while (head < tail) {
      const current = queue[head++], y = (current / width) | 0, x = current - y * width;
      sumX += x; sumY += y;
      if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
      const west = x > 0, east = x < width - 1;
      let n;
      if (west && solid[n = current - 1] && !labels[n]) { labels[n] = label; queue[tail++] = n; }
      if (east && solid[n = current + 1] && !labels[n]) { labels[n] = label; queue[tail++] = n; }
      if (y > 0) {
        const up = current - width;
        if (solid[up] && !labels[up]) { labels[up] = label; queue[tail++] = up; }
        if (west && solid[n = up - 1] && !labels[n]) { labels[n] = label; queue[tail++] = n; }
        if (east && solid[n = up + 1] && !labels[n]) { labels[n] = label; queue[tail++] = n; }
      }
      if (y < height - 1) {
        const down = current + width;
        if (solid[down] && !labels[down]) { labels[down] = label; queue[tail++] = down; }
        if (west && solid[n = down - 1] && !labels[n]) { labels[n] = label; queue[tail++] = n; }
        if (east && solid[n = down + 1] && !labels[n]) { labels[n] = label; queue[tail++] = n; }
      }
    }
    const col = Math.min(columns - 1, Math.floor(sumX / tail / width * columns));
    const row = Math.min(rows - 1, Math.floor(sumY / tail / height * rows)), index = row * columns + col;
    owners[label] = index + 1;
    const bound = bounds[index];
    bound.left = Math.min(bound.left,left); bound.right = Math.max(bound.right,right);
    bound.top = Math.min(bound.top,top); bound.bottom = Math.max(bound.bottom,bottom);
  }
  for (let index = 0; index < bounds.length; index++) {
    const { left, top, right, bottom } = bounds[index], key = `${name}:${index}`;
    // Sector player references are never used: pilots, drones and shop previews
    // share fleet:0. Keep component ownership above intact for neighboring hulls.
    const unusedPlayer = index === 0 && name.startsWith('fleet') && name !== 'fleet';
    if (unusedPlayer || right < left) { cells.set(key,null); continue; }
    const out = surface(right-left+5,bottom-top+5), context = cellContext(out, name);
    const crop = context.createImageData(out.width,out.height), cropWords = new Uint32Array(crop.data.buffer, crop.data.byteOffset, out.width * out.height);
    const owner = index + 1;
    // Owned pixels copy as whole RGBA words into the padded cell.
    for (let y = top; y <= bottom; y++) {
      const rowStart = y * width, outStart = (y - top + 2) * out.width + 2 - left;
      for (let x = left; x <= right; x++) {
        const sourcePixel = rowStart + x;
        if (owners[labels[sourcePixel]] === owner) cropWords[outStart + x] = words[sourcePixel];
      }
    }
    context.putImageData(crop,0,0); cells.set(key,out);
  }
  source.width = source.height = 1;
  connectedAtlases.add(name);
}

/** Return an alpha-trimmed cell with two pixels of safe transparent padding. */
export function spriteCell(name, index) {
  const layout = LAYOUTS[name];
  if (!layout || !Number.isInteger(index) || index < 0 || index >= layout[0] * layout[1]) return null;
  // Do not extract or retain the retired metal, masonry and scorch cells;
  // explosion, smoke and engine artwork stays in use.
  if (name === 'effects' && index >= 10 && index <= 13) return null;
  const key = `${name}:${index}`;
  if (cells.has(key)) return cells.get(key);
  const image = atlases.get(name);
  if (!image) return null;
  if ((name.startsWith('fleet') || name === 'structures') && !connectedAtlases.has(name)) connectedCells(name,image,layout);
  if (cells.has(key)) return cells.get(key);
  const [columns, rows] = layout, col = index % columns, row = Math.floor(index / columns);
  const x = Math.round(col * image.naturalWidth / columns), y = Math.round(row * image.naturalHeight / rows);
  const width = Math.round((col + 1) * image.naturalWidth / columns) - x;
  const height = Math.round((row + 1) * image.naturalHeight / rows) - y;
  const cell = surface(width, height), context = cell.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] < 8) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) { cells.set(key, null); cell.width = cell.height = 1; return null; }
  left = Math.max(0, left - 2); top = Math.max(0, top - 2);
  right = Math.min(width - 1, right + 2); bottom = Math.min(height - 1, bottom + 2);
  const out = surface(right - left + 1, bottom - top + 1);
  cellContext(out, name).drawImage(cell, left, top, out.width, out.height, 0, 0, out.width, out.height);
  cell.width = cell.height = 1;
  cells.set(key, out);
  return out;
}

export function atlasSprite(name, col, row) {
  const layout = LAYOUTS[name];
  if (!layout || !Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= layout[0] || row >= layout[1]) return null;
  return spriteCell(name, row * layout[0] + col);
}
