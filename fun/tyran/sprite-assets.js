/** Decoded, reusable raster atlas cells. Pixel work happens once during warm-up. */
const LAYOUTS = Object.freeze({
  fleet: [4, 3], nature: [4, 4], structures: [4, 4],
  materials: [8, 5], effects: [4, 4], projectiles: [4, 3], pickups: [2, 1],
  structureLight: [4, 4], structureHeavy: [4, 4], structureCrater: [4, 4],
  fleetJungle: [4, 3], fleetSnow: [4, 3], fleetDesert: [4, 3], fleetParadise: [4, 3], fleetAsteroid: [4, 3],
  fleetMars: [4, 3], fleetVolcanic: [4, 3], fleetNeon: [4, 3], fleetAlien: [4, 3], fleetVoid: [4, 3],
});
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
  try {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Unable to load ${name} sprite atlas`));
    });
    const file = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    image.src = new URL(`./assets/sprites/${file}.webp`, import.meta.url).href;
    await loaded;
    if (image.decode) await image.decode();
    atlases.set(name, image);
    status.set(name, { state: 'ready', width: image.naturalWidth, height: image.naturalHeight });
    spriteRevision++;
    return true;
  } catch (error) {
    status.set(name, { state: 'error', message: error.message });
    return false;
  }
}

export const spritesReady = Promise.all(Object.keys(LAYOUTS).map(async name => ({ name, ok: await loadAtlas(name) })))
  .then(results => ({ loaded: results.filter(result => result.ok).map(result => result.name), failed: results.filter(result => !result.ok).map(result => result.name) }));

export function spriteStatus() { return Object.fromEntries(status); }

// A few generated hulls and antennas cross their nominal cell boundary. Assign
// connected pieces by their center before cropping, preserving those tips while
// keeping them out of a neighboring sprite. This analysis runs once per atlas.
function connectedCells(name, image, [columns, rows]) {
  const width = image.naturalWidth, height = image.naturalHeight, count = width * height;
  const source = surface(width, height), c = source.getContext('2d', { willReadFrequently: true });
  c.drawImage(image, 0, 0);
  const pixels = c.getImageData(0, 0, width, height).data;
  const labels = new Int32Array(count), queue = new Uint32Array(count), owners = [0];
  const bounds = Array.from({ length: columns * rows }, () => ({ left: width, top: height, right: -1, bottom: -1 }));
  let label = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    if (labels[pixel] || pixels[pixel * 4 + 3] < 8) continue;
    label++;
    let head = 0, tail = 1, sumX = 0, sumY = 0;
    let left = width, top = height, right = -1, bottom = -1;
    queue[0] = pixel; labels[pixel] = label;
    while (head < tail) {
      const current = queue[head++], x = current % width, y = Math.floor(current / width);
      sumX += x; sumY += y;
      left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (labels[next] || pixels[next * 4 + 3] < 8) continue;
        labels[next] = label; queue[tail++] = next;
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
    if (right < left) { cells.set(key,null); continue; }
    const out = surface(right-left+5,bottom-top+5), context = out.getContext('2d');
    const crop = context.createImageData(out.width,out.height);
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const sourcePixel = y * width + x;
      if (owners[labels[sourcePixel]] !== index + 1) continue;
      const from = sourcePixel * 4, to = ((y-top+2)*out.width+x-left+2)*4;
      crop.data[to] = pixels[from]; crop.data[to+1] = pixels[from+1];
      crop.data[to+2] = pixels[from+2]; crop.data[to+3] = pixels[from+3];
    }
    context.putImageData(crop,0,0); cells.set(key,out);
  }
  connectedAtlases.add(name);
}

/** Return an alpha-trimmed cell with two pixels of safe transparent padding. */
export function spriteCell(name, index) {
  const image = atlases.get(name), layout = LAYOUTS[name];
  if (!image || !layout || !Number.isInteger(index) || index < 0 || index >= layout[0] * layout[1]) return null;
  const key = `${name}:${index}`;
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
  if (right < left) { cells.set(key, null); return null; }
  left = Math.max(0, left - 2); top = Math.max(0, top - 2);
  right = Math.min(width - 1, right + 2); bottom = Math.min(height - 1, bottom + 2);
  const out = surface(right - left + 1, bottom - top + 1);
  out.getContext('2d').drawImage(cell, left, top, out.width, out.height, 0, 0, out.width, out.height);
  cells.set(key, out);
  return out;
}

export function atlasSprite(name, col, row) {
  const layout = LAYOUTS[name];
  if (!layout || !Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= layout[0] || row >= layout[1]) return null;
  return spriteCell(name, row * layout[0] + col);
}
