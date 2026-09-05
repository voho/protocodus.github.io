// Generated art is decoded once; the battlefield only draws small, prepared frames.
import { UNITS } from './sim.js';
export const assetStatus = { loaded: 0, total: 7, ready: false, errors: [] };
export const terrainImages = { ground: null, detail: null };

const BUILDINGS = { core: 3, reactor: 2, refinery: 3, barracks: 2, factory: 3, turret: 1, rocketTower: 2 };
const UNIT_SIZES = { tank: 44, scout: 36, artillery: 56, harvester: 45, rifle: 26, rocket: 32 };
const UNIT_PIXELS = { rifle: 32, rocket: 40, scout: 48, tank: 56, artillery: 64, harvester: 56 };
const UNIT_DEPTH = { tank: 3, scout: 2, artillery: 3, harvester: 4, rifle: 1.5, rocket: 1.5 };
const sprites = {}, props = {};
// Every unit faces east in the atlas; rotation never changes its overhead projection.
const UNIT_CELLS = { rifle: [0, 1], scout: [2], tank: [3], artillery: [4], harvester: [5] };

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
  const result = canvas(source.width, source.height), ctx = result.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, result.width, result.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!data[i + 3]) continue;
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    const blue = b > r * 1.15 && g > r * 1.08 && b - g > (b - r) * .24 && b - r > 14;
    const neutral = Math.max(r, g, b) - Math.min(r, g, b) < luminance * .6;
    const mineral = g - r > 18 && g >= b * .98;
    // Broad crimson armor separates enemies at gameplay scale. Leave dark mechanisms,
    // amber lamps and mint cargo intact; friendly ivory keeps a lighter value in grayscale.
    const amount = blue ? Math.min(1, (b - r - 8) / 25)
      : team && neutral && !mineral ? Math.max(0, Math.min(1, (luminance - 75) / 65)) : 0;
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
  let fill = Math.max(0, Number(entity.type === 'refinery' ? entity.processingAmount : entity.cargo) || 0) / UNITS.harvester.capacity;
  if (entity.type === 'harvester' && entity.unloadDepotId != null) fill *= Math.max(0, 1 - (entity.unload || 0) / 1.2);
  // Only an actually full load gets the full image; the first shards are already visible.
  return fill <= 0 ? 0 : fill >= .999 ? 4 : Math.max(1, Math.min(3, Math.round(fill * 4)));
}

function splitSheet(image, columns, rows, size, keyed, anchored = false, recolor = true, indices = null) {
  const cellWidth = image.width / columns, cellHeight = image.height / rows;
  const cells = [];
  for (const index of indices || Array.from({ length: columns * rows }, (_, i) => i)) {
    const row = Math.floor(index / columns), column = index % columns;
    const source = canvas(Math.ceil(cellWidth), Math.ceil(cellHeight));
    const ctx = source.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, column * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, source.width, source.height);
    const pixels = ctx.getImageData(0, 0, source.width, source.height);
    if (keyed) { removeMatte(pixels); ctx.putImageData(pixels, 0, 0); }
    const box = bounds(pixels, !anchored);
    if (!anchored) { box.cx = box.left + box.width / 2; box.cy = box.top + box.height / 2; }
    cells.push({ source, box });
  }
  // Recenter each source pose on the same output body anchor; animation shares one scale.
  const maxDimension = Math.max(...cells.map(({ box }) => Math.max(box.width, box.height)));
  const maxRadius = Math.max(...cells.map(({ box: b }) => Math.max(b.cx - b.left, b.left + b.width - b.cx, b.cy - b.top, b.top + b.height - b.cy)));
  return cells.map(({ source, box }) => {
    const dimension = anchored ? maxDimension : Math.max(box.width, box.height);
    const scale = (size - 8) / (anchored ? maxRadius * 2 : dimension);
    const prepared = canvas(size), ctx = prepared.getContext('2d');
    // Military art is designed for these small frames; keep its color clusters crisp.
    ctx.imageSmoothingEnabled = !recolor;
    ctx.drawImage(source, box.left, box.top, box.width, box.height,
      size / 2 + (box.left - box.cx) * scale, size / 2 + (box.top - box.cy) * scale,
      box.width * scale, box.height * scale);
    const friendly = recolor ? factionFrame(prepared, 0) : prepared;
    return { teams: recolor ? [friendly, factionFrame(friendly, 1)] : [prepared],
      side: anchored ? silhouette(prepared, '#344147') : null,
      shadow: recolor ? silhouette(prepared, '#0b1117', size * .015) : null,
      drawScale: size / (dimension * scale), coverage: box.width * box.height / (source.width * source.height) };
  });
}

async function load(name, prepare) {
  try {
    const image = new Image();
    image.src = new URL(`./assets/generated/${name}.webp`, import.meta.url).href;
    await image.decode();
    prepare(image);
    assetStatus.loaded++;
  } catch (error) {
    assetStatus.errors.push(`${name}: ${error.message}`);
  }
}

export const assetsReady = Promise.all([
  load('buildings-lowres', image => {
    ['core', 'reactor', 'refinery', 'barracks', 'factory', 'turret'].forEach((type, i) => {
      const [frame] = splitSheet(image, 3, 2, BUILDINGS[type] * 32 + 8, true, false, true, [i]);
      if (type === 'refinery') prepareHopper(frame, [.12, .12, .49, .46]);
      if (['barracks', 'factory', 'refinery'].includes(type)) frame.idleTeams = (frame.hopperTeams?.[0] || frame.teams).map(idleFrame);
      sprites[type] = [frame];
    });
  }),
  load('units-lowres', image => {
    for (const [type, indices] of Object.entries(UNIT_CELLS)) {
      // Normalize each class independently; the long siege gun must not shrink infantry.
      sprites[type] = splitSheet(image, 3, 2, UNIT_PIXELS[type], true, true, true, indices);
      if (type === 'harvester') for (const frame of sprites[type]) prepareHopper(frame, [0, .2, .55, .8]);
    }
  }),
  load('rocket-infantry-lowres', image => { sprites.rocket = splitSheet(image, 2, 1, UNIT_PIXELS.rocket, true, true); }),
  load('rocket-tower-lowres', image => { sprites.rocketTower = splitSheet(image, 1, 1, BUILDINGS.rocketTower * 32 + 8, true); }),
  load('props', image => {
    const frames = splitSheet(image, 3, 2, 160, false, false, false);
    props.rock = frames.slice(0, 3); props.ore = frames.slice(3);
  }),
  load('desolate-trees', image => {
    props.tree = splitSheet(image, 3, 2, 160, false, false, false);
    props.tree.forEach((frame, variant) => {
      const source = frame.teams[0], prepared = canvas(160), ctx = prepared.getContext('2d');
      const side = silhouette(source, '#39332d');
      ctx.translate(80, 80);
      // Overhead branch layers use the same fixed projection as unit roofs.
      for (let depth = variant < 4 ? 6 : 2; depth > 0; depth -= 2) drawUnitPlane(ctx, side, 160, 0, 0, depth);
      drawUnitPlane(ctx, source, 160, 0);
      frame.teams[0] = prepared; frame.shadow = silhouette(prepared, '#0b1117', 2);
    });
  }),
  load('ground', image => { terrainImages.ground = image; }),
]).then(() => { assetStatus.ready = assetStatus.errors.length === 0; return assetStatus; });

function drawUnitPlane(ctx, source, size, angle, x = 0, y = 0) {
  ctx.save(); ctx.translate(x, y);
  // Fixed camera elevation: turn on the ground plane, then project toward the screen.
  ctx.scale(1, .88); ctx.rotate(angle);
  ctx.drawImage(source, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function spriteFrame(entity, time) {
  const frames = sprites[entity.type];
  if (!frames) return null;
  const building = BUILDINGS[entity.type];
  const index = frames.length > 1 && (entity.moving || entity.path?.length)
    ? Math.floor(time * 6 + (entity.id || 0)) % frames.length : 0;
  const frame = frames[index] || frames[0];
  const size = (building ? (entity.size || building) * 32 * 1.1 : UNIT_SIZES[entity.type]) * frame.drawScale;
  return { frame, size, building };
}

// Cast on the ground before drawing any entities; light comes from screen upper-left.
export function drawSpriteShadow(ctx, entity, time = 0) {
  const sprite = spriteFrame(entity, time);
  if (!sprite || entity.hp <= 0) return false;
  const { frame, size, building } = sprite;
  const progress = building ? Math.max(0, Math.min(1, entity.progress ?? 1)) : 1;
  ctx.save(); ctx.globalAlpha *= .48 * progress;
  if (building) {
    const height = (entity.size || building) * progress;
    ctx.drawImage(frame.shadow, -size / 2 + height * 4, -size / 2 - 8 + height * 6, size, size);
  } else {
    const offset = 3 + UNIT_DEPTH[entity.type];
    drawUnitPlane(ctx, frame.shadow, size, entity.angle || 0, offset, offset * 1.5);
  }
  ctx.restore();
  return true;
}

export function drawSprite(ctx, entity, time = 0) {
  const sprite = spriteFrame(entity, time);
  if (!sprite) return false;
  const { frame, size, building } = sprite;
  const teams = frame.idleTeams && !entity.queue?.length && !(entity.processingAmount > 0)
    ? frame.idleTeams : frame.hopperTeams?.[hopperLevel(entity)] || frame.teams;
  const source = teams[entity.team === 1 ? 1 : 0];
  // Applies equally to the battlefield, portraits and units inside production bays.
  ctx.save(); ctx.imageSmoothingEnabled = false;
  if (building) {
    ctx.translate(0, -8);
    ctx.drawImage(source, -size / 2, -size / 2, size, size);
  } else {
    const angle = entity.angle || 0, depth = UNIT_DEPTH[entity.type];
    // Side walls stay down-screen, independent of heading; shadows use the ground pass.
    for (let y = depth; y > 0; y--) drawUnitPlane(ctx, frame.side, size, angle, 0, y);
    drawUnitPlane(ctx, source, size, angle);
  }
  ctx.restore();
  return true;
}

export function drawProp(ctx, type, x, y, size, variant = 0) {
  const frames = props[type];
  if (!frames) return false;
  const frame = frames[((Math.floor(variant) % frames.length) + frames.length) % frames.length];
  const extent = size * frame.drawScale;
  ctx.drawImage(frame.teams[0], x - extent / 2, y - extent / 2, extent, extent);
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
    props: Object.fromEntries(Object.entries(props).map(([type, frames]) => [type, frames.length])) };
}
