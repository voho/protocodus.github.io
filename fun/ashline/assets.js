// Generated art is decoded once; the battlefield only draws small, prepared frames.
export const assetStatus = { loaded: 0, total: 4, ready: false, errors: [] };
export const terrainImages = { ground: null, detail: null };

const BUILDINGS = { core: 3, reactor: 2, refinery: 3, barracks: 2, factory: 3, turret: 1 };
const UNIT_SIZES = { tank: 44, scout: 36, artillery: 56, harvester: 45, rifle: 26 };
const UNIT_DEPTH = { tank: 3, scout: 2, artillery: 3, harvester: 4, rifle: 1.5 };
const sprites = {}, props = {};
// Every unit faces east in the atlas; rotation never changes its overhead projection.
const UNIT_CELLS = { rifle: [0, 1], scout: [2], tank: [3], artillery: [4], harvester: [5] };

function canvas(width, height = width) {
  const result = document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}

function removeMatte(pixels) {
  const data = pixels.data;
  const key = [data[0], data[1], data[2]];
  const keyExcess = Math.min(key[0], key[2]) - key[1];
  if (keyExcess < 28 || Math.min(key[0], key[2]) < 60) return;
  for (let i = 0; i < data.length; i += 4) {
    const excess = Math.min(data[i], data[i + 2]) - data[i + 1];
    if (excess < 28 || Math.min(data[i], data[i + 2]) < 60) continue;
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

function enemyFrame(source) {
  const result = canvas(source.width, source.height), ctx = result.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, result.width, result.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!data[i + 3] || b < r * 1.15 || g < r * 1.08 || b - g < (b - r) * .24 || b - r < 14) continue;
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    const amount = Math.min(1, (b - r - 8) / 25);
    data[i] = r + (Math.min(255, luminance * 1.65) - r) * amount;
    data[i + 1] = g + (luminance * .79 - g) * amount;
    data[i + 2] = b + (luminance * .56 - b) * amount;
  }
  ctx.putImageData(pixels, 0, 0);
  return result;
}

function silhouette(source, color) {
  const result = canvas(source.width, source.height), ctx = result.getContext('2d');
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color; ctx.fillRect(0, 0, result.width, result.height);
  return result;
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
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, box.left, box.top, box.width, box.height,
      size / 2 + (box.left - box.cx) * scale, size / 2 + (box.top - box.cy) * scale,
      box.width * scale, box.height * scale);
    return { teams: recolor ? [prepared, enemyFrame(prepared)] : [prepared],
      side: anchored ? silhouette(prepared, '#344147') : null,
      shadow: anchored ? silhouette(prepared, '#101719') : null,
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
  load('buildings', image => {
    const frames = splitSheet(image, 3, 2, 256, false);
    Object.keys(BUILDINGS).forEach((type, i) => { sprites[type] = [frames[i]]; });
  }),
  load('units-topdown', image => {
    for (const [type, indices] of Object.entries(UNIT_CELLS)) {
      // Normalize each class independently; the long siege gun must not shrink infantry.
      sprites[type] = splitSheet(image, 3, 2, type === 'rifle' ? 64 : 160, true, true, true, indices);
    }
  }),
  load('props', image => {
    const frames = splitSheet(image, 3, 2, 160, false, false, false);
    props.rock = frames.slice(0, 3); props.ore = frames.slice(3);
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

export function drawSprite(ctx, entity, time = 0) {
  const frames = sprites[entity.type];
  if (!frames) return false;
  const building = BUILDINGS[entity.type];
  const index = entity.type === 'rifle' && (entity.moving || entity.path?.length)
    ? Math.floor(time * 6 + (entity.id || 0)) % 2 : 0;
  const frame = frames[index] || frames[0];
  const size = (building ? (entity.size || building) * 32 * 1.1 : UNIT_SIZES[entity.type]) * frame.drawScale;
  const source = frame.teams[entity.team === 1 ? 1 : 0];
  if (building) {
    ctx.save(); ctx.translate(0, -8);
    ctx.drawImage(source, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    const angle = entity.angle || 0, depth = UNIT_DEPTH[entity.type];
    ctx.save(); ctx.globalAlpha *= .4;
    drawUnitPlane(ctx, frame.shadow, size, angle, 1.5, depth + 1.5);
    ctx.restore();
    // Side walls and contact shadows always fall down-screen, independent of heading.
    for (let y = depth; y > 0; y--) drawUnitPlane(ctx, frame.side, size, angle, 0, y);
    drawUnitPlane(ctx, source, size, angle);
  }
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

export function spriteStats() {
  return { ...assetStatus, errors: [...assetStatus.errors],
    frames: Object.fromEntries(Object.entries(sprites).map(([type, frames]) => [type, frames.length])),
    props: Object.fromEntries(Object.entries(props).map(([type, frames]) => [type, frames.length])) };
}
