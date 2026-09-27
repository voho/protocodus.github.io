// Units ship at their prepared resolution; high-resolution masters stay out of game loading.
import { UNITS, BUILDINGS as BUILDING_DEFS, buildingRole, unitRole } from './sim.js';
import { UNIT_SHEETS } from './assets/prepared/units/manifest.js';
export const assetStatus = { loaded: 0, total: 5 + Object.keys(UNITS).length, ready: false, started: false, errors: [] };
import { nextPaint } from './loading.js';
let startLoading;
const loadingRequested = new Promise(resolve => { startLoading = resolve; });
export function startAssets() { assetStatus.started = true; startLoading(); return assetsReady; }
let preparation = Promise.resolve();
export const terrainImages = { ground: null, detail: null };

const BUILDINGS = Object.assign(Object.create(null), Object.fromEntries(Object.entries(BUILDING_DEFS).map(([type, d]) => [type, d.size])));
const UNIT_SIZES = { tank: 44, scout: 36, artillery: 56, harvester: 45, rifle: 26, rocket: 32, engineer: 46, striker: 48, constructor: 56 };
const UNIT_PIXELS = { rifle: 64, rocket: 80, scout: 96, tank: 112, artillery: 128, harvester: 112, engineer: 112, striker: 128, constructor: 128 };
const UNIT_SHADOW_HEIGHT = { tank: 3, scout: 2, artillery: 3, harvester: 4, rifle: 1.5, rocket: 1.5, engineer: 3, striker: 2, constructor: 4 };
export const UNIT_DIRECTIONS = 8;
const UNIT_ANGLE_STEP = Math.PI * 2 / UNIT_DIRECTIONS;
const CARGO_DIRECTION_LIMIT = 16 * 1024 * 1024;
const cargoDirections = new Map();
let directionBytes = 0, directionImages = 0, cargoDirectionBytes = 0;
const sprites = Object.create(null), props = {};
// Each source sheet contains independently drawn E, SE, S, SW, W, NW, N, NE views.
// Infantry repeats those eight directions for its walking pose.
const WALKING_ROLES = new Set(['rifle', 'rocket']);

function unitDirection(angle) {
  const direction = Math.round((Number.isFinite(angle) ? angle % (Math.PI * 2) : 0) / UNIT_ANGLE_STEP);
  return (direction % UNIT_DIRECTIONS + UNIT_DIRECTIONS) % UNIT_DIRECTIONS;
}

// Visual headings only: steering, aiming and saved simulation angles stay continuous.
export function unitSpriteAngle(angle = 0) { return unitDirection(angle) * UNIT_ANGLE_STEP; }

function canvas(width, height = width) {
  const result = document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}

export function removeMatte(pixels) {
  const data = pixels.data;
  const key = [data[0], data[1], data[2]];
  const keyExcess = Math.min(key[0], key[2]) - key[1];
  if (keyExcess < 28 || Math.min(key[0], key[2]) < 60) return;
  for (let i = 0; i < data.length; i += 4) {
    const excess = Math.min(data[i], data[i + 2]) - data[i + 1];
    if (excess < 28 || Math.min(data[i], data[i + 2]) < 60) continue;
    // The generated matte varies slightly across cells. Remove strong magenta directly;
    // preserving it as faint alpha would inflate bounds and shrink tanks and haulers.
    if (excess > 180 || excess > Math.min(data[i], data[i + 2]) * .8) { data[i + 3] = 0; continue; }
    // Recover foreground colour as well as alpha, so downscaling leaves no pink edge.
    const alpha = Math.max(0, 1 - excess / keyExcess);
    if (alpha < .07) { data[i + 3] = 0; continue; }
    data[i] = (data[i] - key[0] * (1 - alpha)) / alpha;
    data[i + 1] = (data[i + 1] - key[1] * (1 - alpha)) / alpha;
    data[i + 2] = (data[i + 2] - key[2] * (1 - alpha)) / alpha;
    data[i + 3] *= alpha;
  }
}

function bounds(pixels, isolate) {
  const { data, width, height } = pixels;
  // A few generated atlas cells include a sliver of their neighbour. Keep the main silhouette.
  let component;
  if (isolate) {
    const visited = new Uint8Array(width * height), queue = new Int32Array(width * height);
    let largest = 0;
    for (let start = 0; start < visited.length; start++) {
      if (visited[start] || data[start * 4 + 3] <= 32) continue;
      let head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0;
      queue[0] = start; visited[start] = 1;
      while (head < tail) {
        const at = queue[head++], x = at % width, y = Math.floor(at / width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, next = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[next] || data[next * 4 + 3] <= 32) continue;
          visited[next] = 1; queue[tail++] = next;
        }
      }
      if (tail > largest) { largest = tail; component = { left, right, top, bottom }; }
    }
  }
  let left = width, right = 0, top = height, bottom = 0, mass = 0, mx = 0, my = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3];
    if (alpha <= 32) continue;
    if (component && (x < component.left || x > component.right || y < component.top || y > component.bottom)) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
    // Opaque body mass anchors the vehicle; thin barrels and smoke contribute little.
    if (alpha > 192) { mx += x; my += y; mass++; }
  }
  if (left > right || top > bottom) throw new Error('Empty sprite frame');
  return { left, top, width: right - left + 1, height: bottom - top + 1,
    cx: mass ? mx / mass : (left + right) / 2,
    cy: mass ? my / mass : (top + bottom) / 2 };
}

function factionFrame(source, team) {
  // Pixel-edited variants must share one raster path so downsampling preserves identical alpha.
  const result = canvas(source.width, source.height), ctx = result.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, result.width, result.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!data[i + 3]) continue;
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    const blue = b > r * 1.15 && g > r * 1.08 && b - g > (b - r) * .24 && b - r > 14;
    const neutral = Math.max(r, g, b) - Math.min(r, g, b) < luminance * .6;
    const mineral = g - r > 18 && g >= b * .98;
    const biological = b > g * 1.07 && r > g * 1.015 && b > r * 1.01 && b - r < 45;
    // Broad crimson armor separates enemies at gameplay scale. Leave dark mechanisms,
    // amber lamps and mint cargo intact; friendly ivory keeps a lighter value in grayscale.
    const amount = blue ? Math.min(1, (b - r - 8) / 25)
      : team && neutral && !mineral && !biological ? Math.max(0, Math.min(1, (luminance - 75) / 65)) : 0;
    if (!amount) continue;
    const paint = team ? [Math.min(255, luminance * 1.05 + 38), luminance * .44 + 18, luminance * .43 + 20]
      : [luminance * .3, luminance * .72 + 20, Math.min(255, luminance * 1.18 + 40)];
    for (let channel = 0; channel < 3; channel++) data[i + channel] += (paint[channel] - data[i + channel]) * amount;
  }
  ctx.putImageData(pixels, 0, 0);
  return result;
}

function silhouette(source, color, blur = 0) {
  const result = canvas(source.width, source.height), ctx = result.getContext('2d');
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color; ctx.fillRect(0, 0, result.width, result.height);
  return result;
}

function idleFrame(source) {
  const result = canvas(source.width, source.height), ctx = result.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, result.width, result.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const grey = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    for (let channel = 0; channel < 3; channel++) data[i + channel] = (.72 * data[i + channel] + .28 * grey) * .9;
  }
  ctx.putImageData(pixels, 0, 0); return result;
}

function mineralFrame(source, type) {
  const result = canvas(source.width, source.height), ctx = result.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, result.width, result.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!data[i + 3] || g - r < 13 || g < b * .94) continue;
    const light = .2126 * r + .7152 * g + .0722 * b;
    const paint = type === 3 ? [Math.min(255, light * 1.22 + 28), light * .46 + 19, light * .55 + 27]
      : [light * .46 + 20, light * .80 + 20, Math.min(255, light * 1.12 + 35)];
    data[i] = paint[0]; data[i + 1] = paint[1]; data[i + 2] = paint[2];
  }
  ctx.putImageData(pixels, 0, 0); return result;
}

function powerDownFrame(source) {
  const result = canvas(source.width, source.height), ctx = result.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, result.width, result.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    // Remove baked amber work-light emission while broad faction armor stays readable.
    if (data[i] > data[i + 1] * 1.13 && data[i + 1] > data[i + 2] * 1.28) {
      data[i] *= .48; data[i + 1] *= .45; data[i + 2] *= .5;
    }
  }
  ctx.putImageData(pixels, 0, 0); return result;
}

function prepareHopper(frame, sector) {
  const original = frame.teams[0], width = original.width, height = original.height;
  const data = original.getContext('2d').getImageData(0, 0, width, height).data;
  let points = [];
  for (let y = Math.floor(sector[1] * height); y < sector[3] * height; y++) for (let x = Math.floor(sector[0] * width); x < sector[2] * width; x++) {
    const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] > 160 && g > 65 && g - r > 18 && g >= b * .98) points.push([x, y]);
  }
  if (points.length < 8) throw new Error('Missing mineral hopper in prepared sprite');
  // Isolate the connected load: tiny mint reflections elsewhere must not widen its footprint.
  const mask = new Uint8Array(width * height);
  for (const [x, y] of points) mask[y * width + x] = 1;
  let largest = [];
  for (const [x, y] of points) {
    if (!mask[y * width + x]) continue;
    const cluster = [[x, y]]; mask[y * width + x] = 0;
    for (let at = 0; at < cluster.length; at++) {
      const [cx, cy] = cluster[at];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, i = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[i]) continue;
        mask[i] = 0; cluster.push([nx, ny]);
      }
    }
    if (cluster.length > largest.length) largest = cluster;
  }
  const minX = Math.min(...largest.map(p => p[0])), maxX = Math.max(...largest.map(p => p[0]));
  const minY = Math.min(...largest.map(p => p[1])), maxY = Math.max(...largest.map(p => p[1]));
  points = points.filter(([x, y]) => x >= minX - 2 && x <= maxX + 2 && y >= minY - 2 && y <= maxY + 2);
  // The convex mineral footprint avoids painting over the surrounding angled rims.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const hull = direction => {
    const edge = [];
    for (const point of direction) { while (edge.length > 1 && cross(edge.at(-2), edge.at(-1), point) <= 0) edge.pop(); edge.push(point); }
    return edge.slice(0, -1);
  };
  const outline = [...hull(points), ...hull([...points].reverse())];
  const left = Math.min(...outline.map(p => p[0])), right = Math.max(...outline.map(p => p[0]));
  const top = Math.min(...outline.map(p => p[1])), bottom = Math.max(...outline.map(p => p[1]));
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const boundary = new Path2D();
  outline.forEach(([x, y], i) => {
    const distance = Math.max(1, Math.hypot(x - cx, y - cy));
    const xx = x + (x - cx) / distance * 1.2, yy = y + (y - cy) / distance * 1.2;
    if (i) boundary.lineTo(xx, yy); else boundary.moveTo(xx, yy);
  });
  boundary.closePath();
  frame.hopperTeams = Array.from({ length: 5 }, (_, level) => {
    if (level === 4) return frame.teams;
    const prepared = canvas(width, height), ctx = prepared.getContext('2d');
    ctx.drawImage(original, 0, 0); ctx.save(); ctx.clip(boundary);
    const floor = ctx.createLinearGradient(left, top, right, bottom);
    floor.addColorStop(0, '#111a1c'); floor.addColorStop(1, '#3a4443');
    ctx.fillStyle = floor; ctx.fillRect(left - 2, top - 2, right - left + 4, bottom - top + 4);
    ctx.strokeStyle = '#75807965'; ctx.lineWidth = 1;
    for (let x = left + 4; x < right; x += Math.max(4, (right - left) / 5)) {
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom + 2); ctx.stroke();
    }
    ctx.strokeStyle = '#090f12'; ctx.lineWidth = 2; ctx.stroke(boundary);
    if (level) {
      const edge = left + (right - left) * level / 4;
      ctx.beginPath(); ctx.moveTo(left - 2, top - 2); ctx.lineTo(edge, top - 2);
      for (let y = top; y <= bottom + 2; y += 3) ctx.lineTo(edge + Math.sin(y * 1.7) * 1.2, y);
      ctx.lineTo(left - 2, bottom + 2); ctx.closePath(); ctx.clip(); ctx.drawImage(original, 0, 0);
    }
    ctx.restore();
    const pixels = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) pixels.data[i] = data[i];
    ctx.putImageData(pixels, 0, 0);
    return [prepared, factionFrame(prepared, 1)];
  });
}

function hopperLevel(entity) {
  let fill = Math.max(0, Number(buildingRole(entity) === 'refinery' ? entity.processingAmount : entity.cargo) || 0) / (UNITS[entity.type]?.capacity || UNITS.harvester.capacity);
  if (unitRole(entity) === 'harvester' && entity.unloadDepotId != null) fill *= Math.max(0, 1 - (entity.unload || 0) / 1.2);
  // Only an actually full load gets the full image; the first shards are already visible.
  return fill <= 0 ? 0 : fill >= .999 ? 4 : Math.max(1, Math.min(3, Math.round(fill * 4)));
}

function isolateUnit(pixels) {
  const { data, width, height } = pixels, labels = new Int32Array(width * height);
  const queue = new Int32Array(labels.length);
  let label = 0, largestLabel = 0, largest = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4 + 3] <= 32) continue;
    label++; let head = 0, tail = 1; queue[0] = start; labels[start] = label;
    while (head < tail) {
      const at = queue[head++], x = at % width, y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || labels[next] || data[next * 4 + 3] <= 32) continue;
        labels[next] = label; queue[tail++] = next;
      }
    }
    if (tail > largest) { largest = tail; largestLabel = label; }
  }
  for (let at = 0; at < labels.length; at++) {
    if (!data[at * 4 + 3] || labels[at] === largestLabel) continue;
    const x = at % width, y = Math.floor(at / width);
    let edge = false;
    // Keep only the chosen body's antialiased edge, never a neighboring cell's fragment.
    if (data[at * 4 + 3] <= 32) for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && labels[ny * width + nx] === largestLabel) { edge = true; break; }
    }
    if (!edge) data[at * 4 + 3] = 0;
  }
  return largest;
}

function splitSheet(image, columns, rows, size, keyed, anchored = false, recolor = true, indices = null, bleed = 0) {
  const cellWidth = image.width / columns, cellHeight = image.height / rows;
  const cells = [];
  for (const index of indices || Array.from({ length: columns * rows }, (_, i) => i)) {
    const row = Math.floor(index / columns), column = index % columns;
    const padX = cellWidth * bleed, padY = cellHeight * bleed;
    const sourceX = column * cellWidth - padX, sourceY = row * cellHeight - padY;
    const source = canvas(Math.ceil(cellWidth + padX * 2), Math.ceil(cellHeight + padY * 2));
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (bleed) ctx.drawImage(image, -sourceX, -sourceY);
    else ctx.drawImage(image, column * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, source.width, source.height);
    const pixels = ctx.getImageData(0, 0, source.width, source.height);
    if (keyed) removeMatte(pixels);
    const mainPixels = bleed ? isolateUnit(pixels) : null;
    if (keyed || bleed) ctx.putImageData(pixels, 0, 0);
    const box = bounds(pixels, !anchored);
    if (!anchored) { box.cx = box.left + box.width / 2; box.cy = box.top + box.height / 2; }
    cells.push({ source, box, padX, padY, sourceBounds: { x: sourceX + box.left, y: sourceY + box.top,
      width: box.width, height: box.height, mainPixels } });
  }
  // Recenter each source pose on the same output body anchor; animation shares one scale.
  const maxDimension = Math.max(...cells.map(({ box }) => Math.max(box.width, box.height)));
  const maxRadius = Math.max(...cells.map(({ box: b }) => Math.max(b.cx - b.left, b.left + b.width - b.cx, b.cy - b.top, b.top + b.height - b.cy)));
  return cells.map(({ source, box, padX, padY, sourceBounds }) => {
    const dimension = anchored ? maxDimension : Math.max(box.width, box.height);
    const scale = (size - 8) / (anchored ? maxRadius * 2 : dimension);
    const prepared = canvas(size), ctx = prepared.getContext('2d');
    // Prepare enough detail for high-density displays without drawing full atlases per frame.
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, box.left, box.top, box.width, box.height,
      size / 2 + (box.left - box.cx) * scale, size / 2 + (box.top - box.cy) * scale,
      box.width * scale, box.height * scale);
    const friendly = recolor ? factionFrame(prepared, 0) : prepared;
    return { teams: recolor ? [friendly, factionFrame(friendly, 1)] : [prepared],
      shadow: silhouette(prepared, '#0b1117', size * .021),
      contact: silhouette(prepared, '#080f14', size * .008),
      sourceBounds,
      sourceSpace: { width: bleed ? cellWidth : source.width, height: bleed ? cellHeight : source.height, scale,
        x: size / 2 - (box.cx - padX) * scale, y: size / 2 - (box.cy - padY) * scale },
      drawScale: size / (dimension * scale), coverage: box.width * box.height / (source.width * source.height) };
  });
}

// Build-time entry point for tools/prepare-unit-atlases.mjs. Reuse the original
// browser normalization so baking preserves prepared detail and physical unit sizes.
export function prepareUnitAtlas(image, type) {
  const role = unitRole(type), pixels = UNIT_PIXELS[role], rows = WALKING_ROLES.has(role) ? 4 : 2;
  const views = splitSheet(image, 4, rows, pixels, false, true, true, null, .12);
  const atlas = canvas(pixels * 4, pixels * rows), ctx = atlas.getContext('2d');
  views.forEach((view, index) => ctx.drawImage(view.teams[0], index % 4 * pixels, Math.floor(index / 4) * pixels));
  const metadata = { pixels, rows, drawScale: views[0].drawScale };
  if (role === 'harvester') metadata.hoppers = views.map((view, index) => {
    const space = view.sourceSpace;
    return UNIT_HOPPER_REGIONS[type][index].map(([x, y]) =>
      [space.x + x * space.width * space.scale, space.y + y * space.height * space.scale]);
  });
  return { atlas, metadata, sourceBounds: views.map(view => view.sourceBounds) };
}

function preparedUnitViews(image, type) {
  const { pixels, rows, drawScale, hoppers } = UNIT_SHEETS[type];
  if (image.width !== pixels * 4 || image.height !== pixels * rows) throw new Error('Prepared unit atlas dimensions do not match its manifest');
  return Array.from({ length: 4 * rows }, (_, index) => {
    const friendly = canvas(pixels);
    friendly.getContext('2d').drawImage(image, index % 4 * pixels, Math.floor(index / 4) * pixels, pixels, pixels, 0, 0, pixels, pixels);
    // Friendly paint is already baked. Applying it again would change its colors.
    return { teams: [friendly, factionFrame(friendly, 1)], drawScale, hopper: hoppers?.[index],
      shadow: silhouette(friendly, '#0b1117', pixels * .021),
      contact: silhouette(friendly, '#080f14', pixels * .008) };
  });
}

async function load(name, prepare, directory = 'generated') {
  try {
    const image = new Image();
    image.src = new URL(`./assets/${directory}/${name}.webp`, import.meta.url).href;
    await image.decode();
    // Image decoding can finish together. Serialize CPU work with a paint between atlases.
    const prepared = preparation.then(async () => { await nextPaint(); await prepare(image); assetStatus.loaded++; });
    preparation = prepared.catch(() => {});
    await prepared;
  } catch (error) {
    assetStatus.errors.push(`${name}: ${error.message}`);
  }
}

function wallFrames() {
  // Code-native interlocks join exactly at tile boundaries; the armor palette matches the atlases.
  return Array.from({ length: 16 }, (_, links) => {
    const source = canvas(80), ctx = source.getContext('2d');
    ctx.scale(2, 2); ctx.translate(20, 20);
    const sections = [[-7, -8, 14, 16]];
    if (links & 1) sections.push([-5, -16, 10, 16]);
    if (links & 2) sections.push([0, -5, 16, 10]);
    if (links & 4) sections.push([-5, 0, 10, 16]);
    if (links & 8) sections.push([-16, -5, 16, 10]);
    for (const [x, y, w, h] of sections) {
      ctx.fillStyle = '#334047'; ctx.fillRect(x, y + 3, w, h);
      const roof = ctx.createLinearGradient(x, y - 3, x + w, y + h - 3);
      roof.addColorStop(0, '#e0e1d7'); roof.addColorStop(.5, '#b8bfb9'); roof.addColorStop(1, '#929f9d');
      ctx.fillStyle = roof; ctx.fillRect(x, y - 2, w, h);
      ctx.strokeStyle = '#e4ede8'; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(x, y + h - 2); ctx.lineTo(x, y - 2); ctx.lineTo(x + w, y - 2); ctx.stroke();
      ctx.fillStyle = '#263943'; ctx.fillRect(x + w - 1, y - 1, 1, h);
    }
    ctx.fillStyle = '#5c8ba9'; ctx.fillRect(-6, -6, 12, 5);
    ctx.fillStyle = '#263940'; ctx.fillRect(-4.5, 2, 9, 2);
    ctx.fillStyle = '#a7b9b8'; ctx.fillRect(-3.5, 2.5, 7, .6);
    const friendly = factionFrame(source, 0);
    return { teams: [friendly, factionFrame(friendly, 1)], shadow: silhouette(source, '#0b1117', 1.8),
      contact: silhouette(source, '#080f14', .6), drawScale: 1.25, coverage: .65 };
  });
}

export const assetsReady = loadingRequested.then(() => Promise.all([
  load('organics-buildings', image => {
    ['core', 'reactor', 'refinery', 'barracks', 'factory', 'lab', 'capacitor', 'turret', 'rocketTower'].forEach((type, i) => {
      const [frame] = splitSheet(image, 3, 3, BUILDINGS[type] * 64 + 16, true, false, true, [i]);
      if (type === 'refinery') prepareHopper(frame, [.08, .04, .53, .51]);
      if (['barracks', 'factory', 'refinery'].includes(type)) frame.idleTeams = (frame.hopperTeams?.[0] || frame.teams).map(idleFrame);
      sprites[type] = [frame];
    });
  }),
  ...Object.keys(UNITS).map(type => load(type, async image => {
    const views = preparedUnitViews(image, type), poses = views.length / UNIT_DIRECTIONS;
    const frames = [];
    for (let pose = 0; pose < poses; pose++) {
      await nextPaint();
      const directions = views.slice(pose * UNIT_DIRECTIONS, (pose + 1) * UNIT_DIRECTIONS);
      for (const view of directions) {
        view.body = view.teams.map(source => ({ image: source, x: -source.width / 2, y: -source.height / 2,
          bytes: source.width * source.height * 4 }));
        view.castShadow = prepareUnitShadow(view, type);
        for (const cached of [...view.body, view.castShadow]) { directionBytes += cached.bytes; directionImages++; }
      }
      frames.push({ ...directions[0], directions });
    }
    sprites[type] = frames;
  }, 'prepared/units')),
  load('unity-buildings', image => {
    for (const [index, type] of ['unityCore', 'unityReactor', 'unityRefinery', 'unityBarracks', 'unityFactory', 'unityLab', 'unityCapacitor', 'unityTurret', 'unityRocketTower'].entries()) {
      const [frame] = splitSheet(image, 3, 3, BUILDINGS[type] * 64 + 16, true, false, true, [index]);
      if (buildingRole(type) === 'refinery') prepareHopper(frame, [.10, .10, .50, .48]);
      if (['barracks', 'factory', 'refinery'].includes(buildingRole(type))) frame.idleTeams = (frame.hopperTeams?.[0] || frame.teams).map(idleFrame);
      sprites[type] = [frame];
    }
  }),
  load('props', image => {
    const frames = splitSheet(image, 3, 2, 160, false, false, false);
    props.rock = frames.slice(0, 3); props.ore = frames.slice(3);
    for (const frame of props.ore) frame.mineralTypes = [null, frame.teams[0], mineralFrame(frame.teams[0], 2), mineralFrame(frame.teams[0], 3)];
  }),
  load('desolate-trees', image => {
    props.tree = splitSheet(image, 3, 2, 160, false, false, false);
    props.tree.forEach((frame, variant) => {
      const source = frame.teams[0], prepared = canvas(160), ctx = prepared.getContext('2d');
      const side = silhouette(source, '#39332d');
      ctx.translate(80, 80);
      // Existing overhead branches retain their own shallow projection.
      for (let depth = variant < 4 ? 6 : 2; depth > 0; depth -= 2) drawTreePlane(ctx, side, 160, depth);
      drawTreePlane(ctx, source, 160);
      frame.teams[0] = prepared; frame.shadow = silhouette(prepared, '#0b1117', 2);
    });
  }),
  load('ground', image => { terrainImages.ground = image; }),
])).then(async () => {
  await nextPaint();
  sprites.wall = wallFrames();
  for (const type of Object.keys(BUILDINGS)) for (const frame of sprites[type] || []) {
    await nextPaint();
    frame.powerDownTeams = frame.teams.map(powerDownFrame);
    if (frame.hopperTeams) frame.powerDownHoppers = frame.hopperTeams.map(teams => teams.map(powerDownFrame));
  }
  for (const type of ['refinery', 'unityRefinery']) for (const frame of sprites[type] || []) {
    await nextPaint();
    frame.mineralHoppers = { 2: frame.hopperTeams.map(teams => teams.map(source => mineralFrame(source, 2))),
      3: frame.hopperTeams.map(teams => teams.map(source => mineralFrame(source, 3))) };
    if (buildingRole(type) === 'refinery') frame.powerDownMineralHoppers = Object.fromEntries(Object.entries(frame.mineralHoppers)
      .map(([type, levels]) => [type, levels.map(teams => teams.map(powerDownFrame))]));
  }
  assetStatus.ready = assetStatus.errors.length === 0; return assetStatus;
});

function drawTreePlane(ctx, source, size, y = 0) {
  ctx.save(); ctx.translate(0, y);
  // Existing tree crowns are overhead layers; unit atlases are already projected.
  ctx.scale(1, .88);
  ctx.drawImage(source, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function prepareUnitShadow(frame, type) {
  const pixels = frame.teams[0].width, role = unitRole(type);
  const density = pixels / (UNIT_SIZES[role] * frame.drawScale), offset = 3 + UNIT_SHADOW_HEIGHT[role];
  const padding = Math.ceil(offset * 1.5 * density) + 4;
  const work = canvas(pixels + padding * 2), ctx = work.getContext('2d');
  // The generated views already contain their side walls and camera projection.
  // Shadow offset is screen-fixed; no heading rotation or extra extrusion is applied.
  ctx.globalAlpha = .22;
  ctx.drawImage(frame.contact, padding + density, padding + density * 2);
  ctx.globalAlpha = .32;
  ctx.drawImage(frame.shadow, padding + offset * density, padding + offset * density * 1.5);
  return { image: work, x: -work.width / 2, y: -work.height / 2, bytes: work.width * work.height * 4 };
}

// Interior corners in source-cell coordinates, ordered rear-left/front-left/front-right/rear-right.
// Cargo is drawn into each generated bed; the truck body itself is never transformed.
const UNIT_HOPPER_REGIONS = {
  harvester: [
    [[.17, .315], [.444, .315], [.444, .55], [.17, .55]],
    [[.383, .174], [.552, .298], [.395, .440], [.232, .316]],
    [[.640, .135], [.640, .388], [.352, .388], [.352, .135]],
    [[.779, .300], [.599, .451], [.420, .309], [.603, .142]],
    [[.895, .518], [.620, .518], [.620, .256], [.895, .256]],
    [[.700, .585], [.527, .441], [.691, .283], [.878, .430]],
    [[.352, .635], [.352, .396], [.636, .396], [.636, .635]],
    [[.121, .439], [.308, .281], [.461, .423], [.306, .583]],
  ],
  unityHarvester: [
    [[.251, .369], [.469, .369], [.469, .546], [.251, .546]],
    [[.392, .231], [.567, .320], [.417, .408], [.266, .327]],
    [[.604, .192], [.604, .370], [.388, .370], [.388, .192]],
    [[.736, .322], [.601, .404], [.450, .320], [.596, .232]],
    [[.822, .533], [.611, .533], [.611, .369], [.822, .369]],
    [[.659, .563], [.513, .466], [.659, .348], [.797, .443]],
    [[.386, .567], [.386, .432], [.604, .432], [.604, .567]],
    [[.200, .459], [.337, .353], [.488, .466], [.337, .567]],
  ],
};

function loadedUnitHopper(view, team, level, mineral) {
  const source = view.teams[team], image = canvas(source.width, source.height), ctx = image.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const corners = view.hopper;
  const boundary = new Path2D();
  corners.forEach(([x, y], i) => i ? boundary.lineTo(x, y) : boundary.moveTo(x, y)); boundary.closePath();
  ctx.save(); ctx.clip(boundary); ctx.globalCompositeOperation = 'source-atop';
  const palette = mineral === 3 ? ['#a54760', '#df748a', '#ffbcc6']
    : mineral === 2 ? ['#397899', '#71bfe1', '#c1e9fa'] : ['#487d70', '#82c6a6', '#c9f4d5'];
  const [a, b, c, d] = corners;
  const point = (u, v) => [a[0] * (1 - u) * (1 - v) + b[0] * u * (1 - v) + c[0] * u * v + d[0] * (1 - u) * v,
    a[1] * (1 - u) * (1 - v) + b[1] * u * (1 - v) + c[1] * u * v + d[1] * (1 - u) * v];
  const breadth = Math.min(Math.hypot(a[0] - d[0], a[1] - d[1]), Math.hypot(b[0] - a[0], b[1] - a[1]));
  const fill = .12 + level * .21;
  ctx.fillStyle = palette[0]; ctx.beginPath();
  [point(.08, .09), point(.92, .09), point(.92, fill), point(.08, fill)]
    .forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath(); ctx.fill();
  const chunks = [];
  for (let n = 0; n < Math.ceil(level * 9 / 4); n++) {
    const [x, y] = point(.18 + (n % 3) * .31, .20 + Math.floor(n / 3) * .30);
    chunks.push({ x, y, r: breadth * (.20 + (n % 3) * .012) });
  }
  // Crystal height stays vertical in screen space at every vehicle heading.
  for (const { x, y, r } of chunks.sort((a, b) => a.y - b.y)) {
    ctx.fillStyle = palette[0]; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x, y - r * 1.5);
    ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * .65); ctx.closePath(); ctx.fill();
    ctx.fillStyle = palette[1]; ctx.beginPath(); ctx.moveTo(x, y - r * 1.5); ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * .65); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = palette[2]; ctx.lineWidth = Math.max(.7, source.width / 128);
    ctx.beginPath(); ctx.moveTo(x - r * .7, y - r * .1); ctx.lineTo(x, y - r * 1.5); ctx.lineTo(x + r * .55, y - r * .45); ctx.stroke();
  }
  ctx.restore(); return image;
}

function unitBodyDirection(frame, entity, direction) {
  const view = frame.directions[direction], team = entity.team === 1 ? 1 : 0;
  if (unitRole(entity) !== 'harvester' || !hopperLevel(entity)) return view.body[team];
  const level = hopperLevel(entity), mineral = entity.cargoType === 2 || entity.cargoType === 3 ? entity.cargoType : 1;
  const key = `${entity.type}:${direction}:${team}:${level}:${mineral}`;
  let cached = cargoDirections.get(key);
  if (cached) { cargoDirections.delete(key); cargoDirections.set(key, cached); return cached; }
  const image = loadedUnitHopper(view, team, level, mineral);
  cached = { image, x: -image.width / 2, y: -image.height / 2, bytes: image.width * image.height * 4 };
  while (cargoDirectionBytes + cached.bytes > CARGO_DIRECTION_LIMIT && cargoDirections.size) {
    const oldest = cargoDirections.keys().next().value;
    cargoDirectionBytes -= cargoDirections.get(oldest).bytes; cargoDirections.delete(oldest);
  }
  cargoDirections.set(key, cached); cargoDirectionBytes += cached.bytes;
  return cached;
}

function drawUnitDirection(ctx, cached, size, pixels) {
  const scale = size / pixels;
  ctx.drawImage(cached.image, cached.x * scale, cached.y * scale,
    cached.image.width * scale, cached.image.height * scale);
}

function spriteFrame(entity, time) {
  const frames = sprites[entity.type];
  if (!frames) return null;
  const building = BUILDINGS[entity.type];
  const index = buildingRole(entity) === 'wall' ? (entity.wallConnections || 0) & 15 : frames.length > 1 && (entity.moving ?? !!entity.path?.length)
    ? Math.floor(time * 6 + (entity.id || 0)) % frames.length : 0;
  const frame = frames[index] || frames[0];
  const size = (building ? (entity.size || building) * 32 * (buildingRole(entity) === 'wall' ? 1 : 1.1) : UNIT_SIZES[unitRole(entity)]) * frame.drawScale;
  return { frame, size, building };
}

// Cast on the ground before drawing any entities; light comes from screen upper-left.
export function drawSpriteShadow(ctx, entity, time = 0) {
  const sprite = spriteFrame(entity, time);
  if (!sprite || entity.hp <= 0) return false;
  const { frame, size, building } = sprite;
  if (!building && !frame.directions) return false;
  const progress = building ? Math.max(0, Math.min(1, entity.progress ?? 1)) : 1;
  ctx.save(); ctx.globalAlpha *= progress;
  if (building) {
    const wall = buildingRole(entity) === 'wall', height = (entity.size || building) * progress * (wall ? .5 : 1);
    const roofY = -size / 2 + (wall ? 0 : -8);
    ctx.save(); ctx.globalAlpha *= .20;
    ctx.drawImage(frame.contact, -size / 2 + 1, roofY + 3, size, size); ctx.restore();
    ctx.globalAlpha *= .33;
    ctx.drawImage(frame.shadow, -size / 2 + height * 4, roofY + height * 6, size, size);
  } else {
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    drawUnitDirection(ctx, frame.directions[unitDirection(entity.angle)].castShadow, size, frame.teams[0].width);
  }
  ctx.restore();
  return true;
}

export function drawSprite(ctx, entity, time = 0) {
  const sprite = spriteFrame(entity, time);
  if (!sprite) return false;
  const { frame, size, building } = sprite;
  if (!building && !frame.directions) return false;
  // Applies equally to the battlefield, portraits and units inside production bays.
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (building) {
    const unpowered = entity.powerRatio < 1 && BUILDING_DEFS[entity.type]?.power < 0;
    const mineralType = entity.processingType, coloredHoppers = frame.mineralHoppers?.[mineralType];
    const teams = unpowered ? (frame.powerDownMineralHoppers?.[mineralType] || frame.powerDownHoppers)?.[hopperLevel(entity)] || frame.powerDownTeams || frame.teams
      : frame.idleTeams && !entity.queue?.length && !(entity.processingAmount > 0)
      ? frame.idleTeams : (coloredHoppers || frame.hopperTeams)?.[hopperLevel(entity)] || frame.teams;
    const source = teams[entity.team === 1 ? 1 : 0];
    ctx.translate(0, buildingRole(entity) === 'wall' ? 0 : -8);
    ctx.drawImage(source, -size / 2, -size / 2, size, size);
  } else {
    // A tiny fixed-screen step pulse distinguishes grounded walkers from wheeled hulls.
    // Shadows remain at the ground anchor, and idle/queued robots never walk in place.
    if (UNITS[entity.type]?.race === 'aiUnity' && !['rifle', 'rocket', 'scout'].includes(unitRole(entity)) && (entity.moving ?? !!entity.path?.length)) {
      ctx.translate(0, -Math.abs(Math.sin(time * 8 + (entity.id || 0))) * .55);
    }
    drawUnitDirection(ctx, unitBodyDirection(frame, entity, unitDirection(entity.angle)), size, frame.teams[0].width);
  }
  ctx.restore();
  return true;
}

export function drawProp(ctx, type, x, y, size, variant = 0, mineralType = 1) {
  const frames = props[type];
  if (!frames) return false;
  const frame = frames[((Math.floor(variant) % frames.length) + frames.length) % frames.length];
  const extent = size * frame.drawScale;
  ctx.drawImage(frame.mineralTypes?.[mineralType] || frame.teams[0], x - extent / 2, y - extent / 2, extent, extent);
  return true;
}

export function drawPropShadow(ctx, type, x, y, size, variant = 0) {
  const frames = props[type];
  if (!frames) return false;
  const frame = frames[((Math.floor(variant) % frames.length) + frames.length) % frames.length];
  if (!frame.shadow) return false;
  const extent = size * frame.drawScale, offset = size * (variant >= 4 ? .045 : .1);
  ctx.save(); ctx.globalAlpha *= .38;
  ctx.drawImage(frame.shadow, x - extent / 2 + offset, y - extent / 2 + offset * 1.5, extent, extent);
  ctx.restore(); return true;
}

export function spriteStats() {
  return { ...assetStatus, errors: [...assetStatus.errors],
    frames: Object.fromEntries(Object.entries(sprites).map(([type, frames]) => [type, frames.length])),
    directionSources: Object.fromEntries(Object.keys(sprites).filter(type => UNITS[type]).map(type => [type, {
      path: `assets/prepared/units/${type}.webp`, sourcePath: `assets/generated/directions/${type}.webp`,
      columns: 4, rows: UNIT_SHEETS[type].rows, pixels: UNIT_SHEETS[type].pixels,
      cells: sprites[type].map((_, pose) => Array.from({ length: UNIT_DIRECTIONS }, (_, direction) => pose * UNIT_DIRECTIONS + direction)) }])),
    directions: Object.fromEntries(Object.entries(sprites).filter(([type]) => UNITS[type])
      .map(([type, frames]) => [type, Math.min(...frames.map(frame => frame.directions?.length || 0))])),
    directionCache: { bytes: directionBytes, images: directionImages, cargoBytes: cargoDirectionBytes,
      cargoImages: cargoDirections.size, cargoLimitBytes: CARGO_DIRECTION_LIMIT },
    props: Object.fromEntries(Object.entries(props).map(([type, frames]) => [type, frames.length])) };
}

// A physical-pixel ceiling: no prepared roof texture is enlarged at this zoom.
export function spriteNativeZoom(dpr = 1) {
  let zoom = Infinity;
  for (const type of Object.keys(sprites)) {
    const sprite = spriteFrame({ type }, 0);
    if (sprite) zoom = Math.min(zoom, 32 * sprite.frame.teams[0].width / sprite.size / Math.max(1, dpr));
  }
  return Number.isFinite(zoom) ? zoom : 32;
}
