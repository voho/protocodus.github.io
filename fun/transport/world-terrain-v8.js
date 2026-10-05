import { BIOME_NATURE } from './terrain-sprites.js';
import { seedNumber, hashNoise, noise } from './world-noise.js';
import { createTerrainTile, generatedElevation } from './world-tiles.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => { const t = clamp((value - low) / (high - low), 0, 1); return t * t * (3 - 2 * t); };
// Fields live on a four-tile lattice; drainage is solved there and drawn at tile scale.
const STEP = 4;
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
// Land heights map to vertex levels by round(elevation * 7); these are the level centres.
export const levelElevation = level => level / 7;

// Rain sets how many rivers a climate keeps; a river starts once this many
// lattice cells of rain drain through a cell. Deserts keep only exotic rivers.
const CLIMATES = {
  taiga: { rain: 1, river: 120, lakeDepth: .018, lakeCells: 3, ponds: 0, inflow: 0 },
  tundra: { rain: .85, river: 130, lakeDepth: .014, lakeCells: 2, ponds: .74, inflow: 0 },
  desert: { rain: .1, river: 300, lakeDepth: 1, lakeCells: Infinity, ponds: 0, inflow: 1 },
};

function fbm(x, y, seed, scale, octaves) {
  let total = 0, weight = 0, amplitude = 1;
  for (let octave = 0; octave < octaves; octave++) {
    total += noise(x, y, seed + octave * 101, scale) * amplitude; weight += amplitude;
    amplitude *= .5; scale *= .5;
  }
  return total / weight;
}

// A small binary heap keyed by height keeps the priority flood exact and fast.
function heap(capacity) {
  const keys = new Float64Array(capacity), values = new Int32Array(capacity);
  let size = 0;
  return {
    get size() { return size; },
    push(key, value) {
      let i = size++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (keys[parent] < key || (keys[parent] === key && values[parent] < value)) break;
        keys[i] = keys[parent]; values[i] = values[parent]; i = parent;
      }
      keys[i] = key; values[i] = value;
    },
    pop() {
      const top = values[0], key = keys[--size], value = values[size];
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= size) break;
        if (child + 1 < size && (keys[child + 1] < keys[child] || (keys[child + 1] === keys[child] && values[child + 1] < values[child]))) child++;
        if (keys[child] > key || (keys[child] === key && values[child] > value)) break;
        keys[i] = keys[child]; values[i] = values[child]; i = child;
      }
      keys[i] = key; values[i] = value;
      return top;
    },
  };
}

// Coastline, relief and rainfall on the lattice. One sea edge (as recipe 2)
// keeps a broad continent; relief rises inland, with ranges in a few regions.
function latticeFields(biome, width, height, seed) {
  const columns = Math.ceil(width / STEP) + 1, rows = Math.ceil(height / STEP) + 1, count = columns * rows, unit = Math.min(width, height);
  const land = new Float32Array(count), relief = new Float32Array(count), wet = new Float32Array(count);
  const edge = Math.floor(hashNoise(1, 2, seed + 4001) * 4), angle = edge * Math.PI / 2 + (hashNoise(3, 4, seed + 4003) - .5) * .5;
  const nx = Math.cos(angle), ny = Math.sin(angle), margin = .30 + hashNoise(5, 6, seed + 4007) * .08;
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < columns; gx++) {
    const x = gx * STEP, y = gy * STEP, index = gy * columns + gx;
    const wx = x + (noise(x, y, seed + 4011, unit * .21) - .5) * unit * .2, wy = y + (noise(x, y, seed + 4013, unit * .19) - .5) * unit * .2;
    const edgeDistance = edge === 0 ? 1 - x / width : edge === 1 ? 1 - y / height : edge === 2 ? x / width : y / height;
    const coast = margin - ((x / width - .5) * nx + (y / height - .5) * ny) + (fbm(wx, wy, seed + 4017, unit * .3, 3) - .5) * .7;
    land[index] = Math.min(coast, edgeDistance * 4 - .035);
    // Coastlines scale with the map; hills and ranges keep a real size in
    // tiles, so a larger map gains more of them instead of stretched ones.
    const inland = smooth(0, .42, land[index]);
    const hills = fbm(wx, wy, seed + 4031, Math.min(unit * .14, 84), 4);
    // Ridged noise along warped bands makes connected ranges, confined to a
    // few mountain regions instead of single peaks scattered over the plains.
    const ridge = 1 - Math.abs(fbm(wx * .8 + wy * .2, wy, seed + 4049, Math.min(unit * .16, 104), 3) * 2 - 1);
    const range = smooth(.55, .78, fbm(wx, wy, seed + 4061, Math.min(unit * .38, 240), 2)) * ridge ** 2.4;
    // Inland map edges rise slightly, so rivers cross them rather than run along them.
    const rim = smooth(.92, 1, Math.max(Math.abs(x / width - .5), Math.abs(y / height - .5)) * 2) * (1 - smooth(.6, 1, 1 - edgeDistance));
    relief[index] = .18 + inland * (unit > 600 ? .12 : .2) + (hills - .5) * .4 + range * .62 + rim * .08;
    wet[index] = fbm(wx, wy, seed + 4079, Math.min(unit * .22, 140), 3);
  }
  return { columns, rows, land, relief, wet, edge, seed };
}

// Priority flood from the sea gives every land cell one downstream neighbour,
// so all rain reaches the sea. Random step costs across flats grow a branching
// tree rather than straight lattice diagonals; filled minus height marks basins.
function drainage(fields, climate) {
  const { columns, rows, land, relief, wet, seed } = fields, count = columns * rows;
  const filled = new Float32Array(count), down = new Int32Array(count).fill(-1), order = new Int32Array(count), flow = new Float32Array(count);
  const queue = heap(count), seen = new Uint8Array(count);
  let ordered = 0;
  // Only the open sea drains the land. A detached pocket below sea level
  // fills like any basin and spills on, so every river ends in the sea.
  const ocean = new Uint8Array(count), border = [];
  for (let k = 0; k < (fields.edge % 2 ? columns : rows); k++) border.push(fields.edge === 0 ? k * columns + columns - 1 : fields.edge === 1 ? (rows - 1) * columns + k : fields.edge === 2 ? k * columns : k);
  for (const cell of border) if (land[cell] < 0 && !ocean[cell]) {
    const stack = [cell]; ocean[cell] = 1;
    while (stack.length) {
      const c = stack.pop(), x = c % columns, y = (c - x) / columns;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy, next = ny * columns + nx;
        if (nx >= 0 && ny >= 0 && nx < columns && ny < rows && !ocean[next] && land[next] < 0) { ocean[next] = 1; stack.push(next); }
      }
    }
  }
  fields.ocean = ocean;
  for (let i = 0; i < count; i++) if (ocean[i]) { seen[i] = 1; queue.push(-1, i); }
  while (queue.size) {
    const cell = queue.pop(), x = cell % columns, y = (cell - x) / columns;
    if (!ocean[cell]) order[ordered++] = cell;
    for (let k = 0; k < 8; k++) {
      const nx = x + NEIGHBORS[k][0], ny = y + NEIGHBORS[k][1];
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      const next = ny * columns + nx;
      if (seen[next]) continue;
      seen[next] = 1; down[next] = cell;
      const step = (k < 4 ? 1 : 1.414) * (.25 + hashNoise(nx, ny, seed + 4111) * 1.5) * 4e-4;
      filled[next] = Math.max(relief[next], (ocean[cell] ? relief[next] : filled[cell]) + step);
      queue.push(filled[next], next);
    }
  }
  for (let i = 0; i < count; i++) flow[i] = ocean[i] ? 0 : climate.rain * (.55 + wet[i] * .9) * (1 + Math.max(0, relief[i] - .5) * 2);
  // An exotic river rises beyond the map: it enters on the edge facing away
  // from the sea (edges: 0 east, 1 south, 2 west, 3 north) and crosses to the coast.
  if (climate.inflow) {
    const far = (fields.edge + 2) % 4, cells = [];
    for (let k = 2; k < (far % 2 ? columns : rows) - 2; k++) cells.push(far === 0 ? k * columns + columns - 1 : far === 1 ? (rows - 1) * columns + k : far === 2 ? k * columns : k);
    let source = cells[0];
    for (const cell of cells) if (land[cell] >= 0 && filled[cell] + hashNoise(cell, 7, seed + 4117) * .05 < filled[source] + hashNoise(source, 7, seed + 4117) * .05) source = cell;
    flow[source] += climate.river * 40;
  }
  for (let i = ordered - 1; i >= 0; i--) { const cell = order[i]; if (down[cell] >= 0) flow[down[cell]] += flow[cell]; }
  return { filled, down, flow, order, ordered };
}

// Basins deeper than the climate's threshold hold lakes. Each keeps at most
// maxCells of its deepest cells, so one wide basin cannot drown a region.
function lakeBasins(fields, water, climate, maxCells) {
  const { columns, rows, land, relief } = fields, count = columns * rows, lake = new Int32Array(count).fill(-1), lakes = [];
  const depth = i => water.filled[i] - relief[i];
  for (let i = 0; i < count; i++) {
    if (lake[i] !== -1 || land[i] < 0 || depth(i) <= climate.lakeDepth) continue;
    const cells = [i]; lake[i] = -2;
    for (let head = 0; head < cells.length; head++) {
      const cell = cells[head], x = cell % columns, y = (cell - x) / columns;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy, next = ny * columns + nx;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || lake[next] !== -1 || land[next] < 0 || depth(next) <= climate.lakeDepth) continue;
        lake[next] = -2; cells.push(next);
      }
    }
    for (const cell of cells) lake[cell] = -3;
    if (cells.length < climate.lakeCells) continue;
    cells.sort((a, b) => depth(b) - depth(a) || a - b);
    const kept = cells.slice(0, maxCells), id = lakes.length;
    for (const cell of kept) lake[cell] = id;
    lakes.push({ id, cells: kept, floor: depth(kept[kept.length - 1]) });
  }
  for (let i = 0; i < count; i++) if (lake[i] < -1) lake[i] = -1;
  return { lake, lakes };
}

// Lattice points are jittered once, so every path through a cell meets there.
function latticePoint(fields, water, cell) {
  const { columns, seed } = fields, gx = cell % columns, gy = (cell - gx) / columns;
  return { x: gx * STEP + (hashNoise(gx, gy, seed + 4127) - .5) * 2.6, y: gy * STEP + (hashNoise(gx, gy, seed + 4129) - .5) * 2.6, flow: water.flow[cell] };
}

// Rivers follow the drainage tree from each source to the sea, a lake or the
// river they join, ending on that junction's point. A channel leaving a lake
// starts on the lake's own cell, and one reaching the sea runs on offshore.
function riverPaths(fields, water, basins, threshold) {
  const { columns, rows, land, ocean } = fields, count = columns * rows, river = new Uint8Array(count), feeders = new Uint8Array(count), lakeInto = new Int32Array(count).fill(-1), paths = [];
  // Lakes and detached pockets below sea level are still water that channels enter and leave.
  const still = i => basins.lake[i] >= 0 || (land[i] < 0 && !ocean[i]);
  for (let i = 0; i < count; i++) if (land[i] >= 0 && basins.lake[i] < 0 && water.flow[i] >= threshold) river[i] = 1;
  for (let i = 0; i < count; i++) {
    const next = water.down[i];
    if (next < 0) continue;
    if (river[i]) feeders[next]++;
    else if (still(i) && lakeInto[next] < 0) lakeInto[next] = i;
  }
  const traced = new Uint8Array(count);
  const trace = start => {
    const points = lakeInto[start] >= 0 ? [latticePoint(fields, water, lakeInto[start])] : [];
    for (let cell = start; ;) {
      points.push(latticePoint(fields, water, cell)); traced[cell] = 1;
      const next = water.down[cell];
      if (next < 0) break;
      if (ocean[next] || still(next) || traced[next]) {
        const end = latticePoint(fields, water, next); end.flow = water.flow[cell]; points.push(end);
        if (ocean[next]) points.push({ x: end.x + (end.x - points[points.length - 2].x) * 1.5, y: end.y + (end.y - points[points.length - 2].y) * 1.5, flow: end.flow });
        break;
      }
      cell = next;
    }
    if (points.length > 1) paths.push(points);
  };
  // Sources first in index order, then channels whose sources were lakes.
  for (let i = 0; i < count; i++) if (river[i] && !feeders[i]) trace(i);
  for (let i = 0; i < count; i++) if (river[i] && !traced[i]) trace(i);
  return paths;
}

// Catmull-Rom through the jittered lattice points, sampled every half tile.
// Wide lowland rivers add gentle meanders that fade out at both junctions
// and next to any fixed point, which the channel then passes exactly.
function riverCurve(points, threshold, phase) {
  const samples = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) * 2)), still = p1.fixed || p2.fixed;
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const x = .5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = .5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      samples.push({ x, y, flow: p1.flow + (p2.flow - p1.flow) * t, still });
    }
  }
  const last = points[points.length - 1];
  samples.push({ x: last.x, y: last.y, flow: last.flow, still: last.fixed });
  let distance = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    if (i) distance += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    const sample = samples[i], radius = clamp(1 + Math.log2(1 + sample.flow / threshold) * .34, 1, 2.9);
    const fade = sample.still ? 0 : Math.min(1, i / 12, (samples.length - 1 - i) / 12);
    const meander = Math.sin(distance / (5 + radius * 2.2) + phase) * Math.min(2.2, radius * .9) * fade;
    sample.x += -dy / length * meander; sample.y += dx / length * meander; sample.radius = radius;
  }
  return samples;
}

// Two chamfer sweeps give each tile its distance to the nearest water tile
// and carry that water's channel radius along (zero for seas and lakes).
function waterDistance(kind, channel, width, height) {
  const size = width * height, distance = new Float32Array(size), near = new Float32Array(size);
  for (let i = 0; i < size; i++) { distance[i] = kind[i] ? 0 : 1e9; near[i] = channel[i]; }
  const relax = (i, j, step) => { if (distance[j] + step < distance[i]) { distance[i] = distance[j] + step; near[i] = near[j]; } };
  const D = 1.4142;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) relax(i, i - 1, 1);
    if (y) { relax(i, i - width, 1); if (x) relax(i, i - width - 1, D); if (x + 1 < width) relax(i, i - width + 1, D); }
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) relax(i, i + 1, 1);
    if (y + 1 < height) { relax(i, i + width, 1); if (x + 1 < width) relax(i, i + width + 1, D); if (x) relax(i, i + width - 1, D); }
  }
  return { distance, near };
}

export const WATER_SEA = 1, WATER_LAKE = 2, WATER_RIVER = 3, WATER_POND = 4;
// Valley sides climb one level per this many tiles from the shore.
const VALLEY = { taiga: 2.6, tundra: 3.2, desert: 1.6 };

// Paint a sampled channel: water on unclaimed land (never inside `keepDry`)
// and the widest radius seen per tile, which desert oases follow.
function paintChannel(samples, kind, channel, width, height, keepDry) {
  for (const sample of samples) {
    const r = sample.radius, r2 = r * r;
    for (let y = Math.max(0, Math.floor(sample.y - r)); y <= Math.min(height - 1, Math.ceil(sample.y + r)); y++) for (let x = Math.max(0, Math.floor(sample.x - r)); x <= Math.min(width - 1, Math.ceil(sample.x + r)); x++) {
      if ((x - sample.x) ** 2 + (y - sample.y) ** 2 > r2 || keepDry?.(x, y)) continue;
      const i = y * width + x;
      if (!kind[i]) kind[i] = WATER_RIVER;
      if (kind[i] === WATER_RIVER) channel[i] = Math.max(channel[i], r);
    }
  }
}

// The two opening towns stand 24 tiles apart on one row, with a broad river
// five tiles south of both centres. Pick the site nearest the map's middle
// whose town cores are dry, low and even; a stream may cross the road between
// them on a bridge. The opening river is then bent through the site.
const townCores = (cx, cy) => (x, y) => y >= cy - 6 && y <= cy + 4 && ((x >= cx - 7 && x <= cx + 7) || (x >= cx + 17 && x <= cx + 31));
function openingSites(kind, elevation, width, height, reach) {
  const tx = Math.round(width * .43), ty = Math.round(height * .47), sites = [];
  for (let cy = Math.max(14, ty - reach); cy <= Math.min(height - 18, ty + reach); cy += 2) for (let cx = Math.max(16, tx - reach); cx <= Math.min(width - 42, tx + reach); cx += 2) {
    const core = townCores(cx, cy);
    let bad = 0, sum = 0, squares = 0, count = 0;
    for (let y = cy - 6; y <= cy + 4 && !bad; y++) for (let x = cx - 7; x <= cx + 31; x++) {
      const i = y * width + x, k = kind[i], e = elevation[i];
      if (k === WATER_SEA || k === WATER_LAKE || (k && core(x, y)) || e >= .62) { bad = 1; break; }
      if (k) continue;
      sum += e; squares += e * e; count++;
    }
    for (let y = cy + 5; y <= cy + 12 && !bad; y++) for (let x = cx - 3; x <= cx + 27; x++) if (kind[y * width + x] === WATER_SEA || kind[y * width + x] === WATER_LAKE) { bad = 1; break; }
    if (bad) continue;
    const mean = sum / count, spread = squares / count - mean * mean;
    sites.push({ cx, cy, score: Math.hypot(cx - tx, cy - ty) / reach + spread * 600 + Math.max(0, mean - .36) * 10 });
  }
  return sites.sort((a, b) => a.score - b.score || a.cy - b.cy || a.cx - b.cx);
}

// The opening river: a natural channel upstream, a gentle bend past both
// berths, then the drainage tree down to the sea. Returns null when either
// end of the bend would have to cross the towns.
function openingChannel(fields, water, site, threshold, seed) {
  const { columns, rows } = fields, { cx, cy } = site;
  const dry = (x, y) => x >= cx - 9 && x <= cx + 33 && y >= cy - 10 && y <= cy + 4;
  const cellAt = (x, y) => clamp(Math.round(y / STEP), 0, rows - 1) * columns + clamp(Math.round(x / STEP), 0, columns - 1);
  const downstream = (x, y) => {
    const points = [];
    for (let cell = cellAt(x, y), guard = 0; cell >= 0 && guard < columns * rows; cell = water.down[cell], guard++) {
      const point = latticePoint(fields, water, cell);
      if (dry(point.x, point.y)) return null;
      points.push(point);
      if (fields.ocean[cell]) {
        const previous = points[points.length - 2] || point;
        points.push({ x: point.x + (point.x - previous.x) * 1.5, y: point.y + (point.y - previous.y) * 1.5, flow: point.flow });
        return points;
      }
    }
    return points;
  };
  const upstream = (x, y) => {
    const points = [];
    for (let cell = cellAt(x, y), steps = 0; steps < 40; steps++) {
      const gx = cell % columns, gy = (cell - gx) / columns;
      let best = -1;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = gx + dx, ny = gy + dy, next = ny * columns + nx;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || water.down[next] !== cell || fields.land[next] < 0) continue;
        if (best < 0 || water.flow[next] > water.flow[best]) best = next;
      }
      if (best < 0 || water.flow[best] < threshold * .25) break;
      const point = latticePoint(fields, water, best);
      if (dry(point.x, point.y)) break;
      points.push(point); cell = best;
    }
    return points.reverse();
  };
  const dip = 1 + hashNoise(cx, cy, seed + 4163) * 3, flow = threshold * 7;
  const bend = [{ x: cx - 11, y: cy + 8 }, { x: cx, y: cy + 7 }, { x: cx + 12, y: cy + 7 + dip }, { x: cx + 24, y: cy + 7 }, { x: cx + 35, y: cy + 8 }].map(p => ({ ...p, flow, fixed: true }));
  let sea = downstream(cx + 35, cy + 8), source;
  if (sea) source = upstream(cx - 11, cy + 8);
  else {
    sea = downstream(cx - 11, cy + 8);
    if (!sea) return null;
    source = upstream(cx + 35, cy + 8); bend.reverse();
  }
  // Upstream narrows towards its spring; downstream never narrows below the bend.
  source.forEach((point, i) => { point.flow = Math.max(point.flow, flow * (i + 1) / (source.length + 1)); });
  for (const point of sea) point.flow = Math.max(point.flow, flow);
  return { points: [...source, ...bend, ...sea], dry };
}

export function generateTerrainV8(biome, seed, config) {
  const { width, height } = config, numericSeed = seedNumber(seed), climate = CLIMATES[biome] || CLIMATES.taiga;
  const nature = BIOME_NATURE[biome] || BIOME_NATURE.taiga, land = biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass';
  const fields = latticeFields(biome, width, height, numericSeed), water = drainage(fields, climate);
  const { columns, rows, relief, wet } = fields;
  const basins = lakeBasins(fields, water, climate, Math.round(18 * (width / 512) ** 1.2) + 10);
  const rivers = riverPaths(fields, water, basins, climate.river);
  const lattice = (values, x, y) => {
    const gx = Math.min(columns - 2, x >> 2), gy = Math.min(rows - 2, y >> 2), fx = (x - gx * STEP) / STEP, fy = (y - gy * STEP) / STEP, i = gy * columns + gx;
    return values[i] * (1 - fx) * (1 - fy) + values[i + 1] * fx * (1 - fy) + values[i + columns] * (1 - fx) * fy + values[i + columns + 1] * fx * fy;
  };
  // Lake shores follow the interpolated basin depth, so they trace contours;
  // in the desert the same basins dry out into salt pans.
  const basinDepth = new Float32Array(columns * rows), lakeDepth = new Float32Array(columns * rows);
  for (let i = 0; i < basinDepth.length; i++) { basinDepth[i] = water.filled[i] - relief[i]; lakeDepth[i] = basins.lake[i] >= 0 ? basinDepth[i] : -.02; }
  const size = width * height, kind = new Uint8Array(size), elevation = new Float32Array(size), moisture = new Float32Array(size), channel = new Float32Array(size);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (lattice(fields.land, x, y) + (noise(x, y, numericSeed + 4091, 5) - .5) * .02 < 0) { kind[i] = WATER_SEA; continue; }
    elevation[i] = lattice(relief, x, y) + (noise(x, y, numericSeed + 4093, 6) - .5) * .03;
    moisture[i] = lattice(wet, x, y) + (noise(x, y, numericSeed + 4101, 3.5) - .5) * .16;
    if (lattice(lakeDepth, x, y) + (noise(x, y, numericSeed + 4099, 3) - .5) * .008 > climate.lakeDepth * .6) kind[i] = WATER_LAKE;
  }
  // Every kept lake cell holds water around its own point, so the channels
  // that end or start there always touch the lake.
  for (const lake of basins.lakes) for (const cell of lake.cells) {
    const p = latticePoint(fields, water, cell);
    for (let y = Math.max(0, Math.floor(p.y - 2)); y <= Math.min(height - 1, Math.ceil(p.y + 2)); y++) for (let x = Math.max(0, Math.floor(p.x - 2)); x <= Math.min(width - 1, Math.ceil(p.x + 2)); x++) {
      if ((x - p.x) ** 2 + (y - p.y) ** 2 <= 2.25 && !kind[y * width + x]) kind[y * width + x] = WATER_LAKE;
    }
  }
  for (const [n, points] of rivers.entries()) paintChannel(riverCurve(points, climate.river, hashNoise(n, 1, numericSeed + 4133) * Math.PI * 2), kind, channel, width, height);
  const opening = { cx: Math.round(width * .43), cy: Math.round(height * .47) };
  let openingPath = null;
  for (const reach of [Math.max(40, Math.round(Math.min(width, height) * .2)), Math.max(width, height)]) {
    // Neighbouring candidates share their drainage, so each attempt tries a new spot.
    const tried = [];
    for (const site of openingSites(kind, elevation, width, height, reach)) {
      if (tried.length >= 48) break;
      if (tried.some(t => Math.abs(t.cx - site.cx) + Math.abs(t.cy - site.cy) < 10)) continue;
      tried.push(site);
      openingPath = openingChannel(fields, water, site, climate.river, numericSeed);
      if (openingPath) { opening.cx = site.cx; opening.cy = site.cy; break; }
    }
    if (openingPath) break;
  }
  const { cx, cy } = opening, cores = townCores(cx, cy);
  if (openingPath) paintChannel(riverCurve(openingPath.points, climate.river, 0), kind, channel, width, height, cores);
  // The berths and their banks are exact even on a world without a good site.
  for (let y = cy - 6; y <= cy + 4; y++) for (let x = cx - 7; x <= cx + 31; x++) if (cores(x, y) && kind[y * width + x]) { kind[y * width + x] = 0; elevation[y * width + x] = levelElevation(2); }
  for (const x of [cx, cx + 24]) for (let y = cy + 5; y <= cy + 9; y++) { kind[y * width + x] = WATER_RIVER; channel[y * width + x] = Math.max(channel[y * width + x], 2); }
  // A channel that lost its way to the sea becomes still water: every river
  // tile then belongs to the one network ships can follow to open water.
  const linked = new Uint8Array(size), queue = [], edge = fields.edge;
  for (let k = 0; k < (edge % 2 ? width : height); k++) {
    const i = edge === 0 ? k * width + width - 1 : edge === 1 ? (height - 1) * width + k : edge === 2 ? k * width : k;
    if (kind[i] === WATER_SEA) { linked[i] = 1; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % width;
    for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) if (j >= 0 && j < size && !linked[j] && kind[j]) { linked[j] = 1; queue.push(j); }
  }
  for (let i = 0; i < size; i++) if (kind[i] === WATER_RIVER && !linked[i]) kind[i] = WATER_POND;
  const { distance, near } = waterDistance(kind, channel, width, height), valley = VALLEY[biome] || 2.6;
  // Thermokarst ponds dot flat, low tundra between the valleys; they are too
  // shallow to carve banks of their own.
  if (climate.ponds) for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const i = y * width + x;
    if (kind[i] || distance[i] < 3 || (x >= cx - 12 && x <= cx + 36 && y >= cy - 10 && y <= cy + 14) || Math.min(elevation[i], levelElevation(1) + (distance[i] - 1) / valley / 7) > .36) continue;
    const pond = noise(x, y, numericSeed + 4139, 3.4) * .75 + noise(x, y, numericSeed + 4141, 13) * .25;
    if (pond > climate.ponds && moisture[i] > .45) kind[i] = WATER_POND;
  }
  const tiles = new Array(size), shore = levelElevation(1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, variant = Math.min(15, Math.floor(hashNoise(x, y, numericSeed + 4097) * 16));
    if (kind[i]) { tiles[i] = createTerrainTile('water', 0, kind[i] === WATER_RIVER ? 'river' : '', variant); continue; }
    // Valleys: a flat floodplain beside each river, wider along big rivers,
    // then sides that rise at most one level per few tiles.
    const d = distance[i], plain = near[i] > 0 ? 1 + near[i] * (biome === 'desert' ? 1.6 : 1.1) : 1.5;
    const e = clamp(Math.min(elevation[i], shore + Math.max(0, d - plain) / valley * (1 / 7) + .02), .075, .99);
    elevation[i] = e;
    const level = Math.round(e * 7), m = moisture[i] + (d < 4 ? (4 - d) * .05 : 0) - Math.max(0, e - .55) * .5;
    const habitat = hashNoise(x >> 1, y >> 1, numericSeed + 4143), fine = hashNoise(x, y, numericSeed + 4147), patch = noise(x, y, numericSeed + 4151, 15) * .65 + noise(x, y, numericSeed + 4157, 5) * .35;
    let terrain = land, detail = '';
    if (e >= .7 || (e >= .64 && patch > .62)) { terrain = 'mountain'; detail = nature.mountains[Math.min(nature.mountains.length - 1, Math.floor(noise(x, y, numericSeed + 4153, 14) * nature.mountains.length))]; }
    else if (e >= .6 || (e >= .54 && fine > .93)) { terrain = 'rock'; detail = biome === 'desert' ? 'canyon' : 'glacial'; }
    else if (biome === 'taiga') {
      const forest = m * .8 + patch * .45 + (d < 3 ? .06 : 0) - (level <= 1 && m > .62 ? .3 : 0);
      if (forest > .6) {
        terrain = 'forest';
        detail = habitat > .985 ? 'deadwood' : level <= 2 && m > .55 ? (habitat > .55 ? 'birch' : 'aspen') : e > .45 || m < .45 ? 'pine' : level <= 2 && patch < .35 ? 'oak' : habitat > .5 ? 'spruce' : 'fir';
      } else if (d < 2.5 || (level <= 1 && m > .6)) detail = fine > .45 ? 'reeds' : 'marsh';
      else if (m > .55) detail = ['wildflowers', 'bluebells', 'ferns', 'berry-bushes', '', ''][Math.floor(fine * 6)];
      else detail = ['grass-tufts', 'heather', 'shrubs', '', '', ''][Math.floor(fine * 6)];
    } else if (biome === 'tundra') {
      // Woodland survives only in sheltered low valleys; uplands stay snowbound.
      if (level <= 2 && d < 6 && m + patch * .3 > .8) { terrain = 'forest'; detail = habitat > .96 ? 'deadwood' : ['larch', 'dwarf-birch', 'dwarf-pine', 'larch', 'pine'][Math.floor(habitat * 5)]; }
      else if (level <= 3 && m + patch * .25 > .5 - (d < 6 ? .12 : 0)) {
        terrain = 'grass';
        detail = d < 2.5 ? (fine > .5 ? 'reeds' : 'willow-scrub') : m > .6 ? ['cotton-grass', 'marsh', 'willow-scrub', 'tundra-grass'][Math.floor(fine * 4)] : ['arctic-poppies', 'heather', 'lichen', 'tundra-grass', 'shrubs', ''][Math.floor(fine * 6)];
      } else detail = level >= 4 ? (fine > .7 ? 'glacial' : 'snow') : fine > .82 ? 'lichen' : fine > .6 ? 'heather' : 'snow';
    } else {
      // Desert life clings to water: a green belt along rivers, bare sand
      // beyond, with lone Joshua trees and acacias on the dry uplands.
      const belt = near[i] * 2.4 + 1;
      if (d < belt && (d < belt * .6 || patch + fine * .3 > .55)) { terrain = d < belt * .55 && fine > .35 ? 'forest' : 'grass'; detail = terrain === 'forest' ? (habitat > .97 ? 'deadwood' : ['palm', 'tamarisk', 'palm', 'acacia'][Math.floor(habitat * 4)]) : d < 2 ? 'reeds' : fine > .5 ? 'desert-flowers' : 'dry-grass'; }
      else if (lattice(basinDepth, x, y) > .012) detail = 'saltflat';
      else if (e > .42 && patch > .45) { if (fine > .985) { terrain = 'forest'; detail = habitat > .5 ? 'joshua' : 'acacia'; } else detail = ['cactus', 'agave', 'prickly-pear', 'aloe', 'scrub', 'scrub'][Math.floor(fine * 6)]; }
      else if (patch < .42) detail = fine > .25 ? 'dunes' : '';
      else detail = fine > .8 ? 'dry-grass' : fine > .6 ? 'scrub' : '';
    }
    tiles[i] = createTerrainTile(terrain, Math.round(e * 1024) / 1024, detail, variant);
  }
  return { tiles, kind, distance, near, width, height, land, opening, edge: fields.edge };
}
