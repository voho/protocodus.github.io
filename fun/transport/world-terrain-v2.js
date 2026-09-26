import { BIOME_NATURE } from './terrain-sprites.js';
import { seedNumber, randomSource, hashNoise, noise } from './world-noise.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const TAU = Math.PI * 2;

// This is a saved-world recipe. Keep version 2 stable when adding future maps.
// The expensive regional fields live on a four-tile lattice. Interpolation
// retains continuous coastlines without millions of repeated noise octaves.
function regionalFields(width, height, seed, random) {
  const step = 4, columns = Math.ceil(width / step) + 1, rows = Math.ceil(height / step) + 1;
  const values = Array.from({ length: 5 }, () => new Float32Array(columns * rows));
  const unit = Math.min(width, height), edge = Math.floor(random() * 4);
  const angle = edge * Math.PI / 2 + (random() - .5) * .56;
  const nx = Math.cos(angle), ny = Math.sin(angle), margin = .28 + random() * .075;
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < columns; gx++) {
    const x = gx * step, y = gy * step, index = gy * columns + gx;
    const wx = x + (noise(x, y, seed + 211, unit * .19) - .5) * unit * .17;
    const wy = y + (noise(x, y, seed + 227, unit * .17) - .5) * unit * .17;
    const continental = noise(wx, wy, seed + 239, unit * .28);
    const rolling = noise(wx, wy, seed + 251, unit * .068);
    const edgeDistance = edge === 0 ? 1 - x / width : edge === 1 ? 1 - y / height : edge === 2 ? x / width : y / height;
    values[0][index] = Math.min(margin - ((x / width - .5) * nx + (y / height - .5) * ny) + (continental - .5) * .65 + (rolling - .5) * .16, edgeDistance * 4 - .035);
    values[1][index] = .64 * noise(wx, wy, seed + 263, unit * .20) + .25 * noise(wx, wy, seed + 277, unit * .066) + .11 * noise(wx, wy, seed + 281, 15 + Math.sqrt(unit));
    values[2][index] = .66 * noise(wx, wy, seed + 293, unit * .18) + .25 * noise(wx, wy, seed + 307, unit * .055) + .09 * noise(wx, wy, seed + 311, 17);
    values[3][index] = .62 * noise(wx, wy, seed + 331, unit * .12) + .38 * noise(wx, wy, seed + 347, 20);
    values[4][index] = noise(wx, wy, seed + 359, 7);
  }
  return { values, columns, edge };
}

function lakeDistricts(config, seed, random) {
  const { width, height } = config, unit = Math.min(width, height);
  const districtCount = Math.max(3, Math.round(Math.sqrt(config.lakes || 18) * .85));
  const districts = Array.from({ length: districtCount }, () => ({
    x: (.09 + random() * .82) * width, y: (.07 + random() * .85) * height,
    spread: (18 + unit * (.025 + random() * .07)),
  }));
  const columns = Math.ceil(width / 32), buckets = new Array(columns * Math.ceil(height / 32));
  function add(lake) {
    const extent = Math.max(lake.rx, lake.ry) * 1.32;
    const x0 = clamp(Math.floor((lake.x - extent) / 32), 0, columns - 1), x1 = clamp(Math.floor((lake.x + extent) / 32), 0, columns - 1);
    const y0 = clamp(Math.floor((lake.y - extent) / 32), 0, Math.ceil(height / 32) - 1), y1 = clamp(Math.floor((lake.y + extent) / 32), 0, Math.ceil(height / 32) - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) (buckets[y * columns + x] ??= []).push(lake);
  }
  for (let i = 0; i < (config.lakes || 18); i++) {
    const district = districts[Math.floor(random() ** 1.35 * districtCount)];
    const angle = random() * TAU, distance = Math.sqrt(random()) * district.spread;
    const x = clamp(district.x + Math.cos(angle) * distance, 5, width - 6), y = clamp(district.y + Math.sin(angle) * distance, 5, height - 6);
    const radius = 2.5 + random() ** 2.2 * (7 + Math.sqrt(unit) * 1.6), elongation = .35 + random() * .65;
    const rotation = random() * TAU, ca = Math.cos(rotation), sa = Math.sin(rotation);
    add({ x, y, rx: radius, ry: radius * elongation, ca, sa, shape: random() * 2 - 1 });
    // Larger lakes have offset arms, bays and narrows instead of repeated ovals.
    if (radius > 10) for (let arm = 0; arm < 1 + Math.floor(random() * 3); arm++) {
      const direction = rotation + (random() - .5) * 1.8, reach = radius * (.4 + random() * .5);
      const turn = direction + (random() - .5);
      add({ x: x + Math.cos(direction) * reach, y: y + Math.sin(direction) * reach, rx: radius * (.4 + random() * .35), ry: radius * (.2 + random() * .35), ca: Math.cos(turn), sa: Math.sin(turn), shape: random() * 2 - 1 });
    }
  }
  return { buckets, columns };
}

export function generateTerrainV2(biome, seed, config, { naturalRelief = false } = {}) {
  const { width, height } = config, unit = Math.min(width, height), numericSeed = seedNumber(seed);
  const random = randomSource(numericSeed ^ 0x71c3d521), nature = BIOME_NATURE[biome];
  const land = biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass';
  const starterX = Math.round(width * .43), starterY = Math.round(height * .47);
  const fields = regionalFields(width, height, numericSeed, random), lakes = lakeDistricts(config, numericSeed, random);
  const tiles = new Array(width * height), sample = new Float64Array(5);
  const mountains = nature.mountains, treeKinds = nature.trees;
  for (let y = 0; y < height; y++) {
    const gy = y >> 2, fy = (y & 3) / 4, bucketRow = (y >> 5) * lakes.columns;
    for (let x = 0; x < width; x++) {
      const gx = x >> 2, fx = (x & 3) / 4, index = gy * fields.columns + gx;
      const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
      for (let k = 0; k < 5; k++) {
        const f = fields.values[k];
        sample[k] = f[index] * a + f[index + 1] * b + f[index + fields.columns] * c + f[index + fields.columns + 1] * d;
      }
      const fine = hashNoise(x, y, numericSeed + 379), habitat = hashNoise(Math.floor(x / 3), Math.floor(y / 3), numericSeed + 383);
      const local = sample[4], moisture = sample[2], climate = sample[3];
      let elevation = Math.round(clamp(.09 + sample[1] * .91 + (local - .5) * .075, .035, .97) * 1024) / 1024;
      let terrain = land, detail = '', water = sample[0] < 0;
      if (!water) for (const lake of lakes.buckets[bucketRow + (x >> 5)] || []) {
        const dx = x - lake.x, dy = y - lake.y, u = (dx * lake.ca + dy * lake.sa) / lake.rx, v = (-dx * lake.sa + dy * lake.ca) / lake.ry;
        if (u * u + v * v < .83 + (local - .5) * .65 + lake.shape * u * v * .28) { water = true; break; }
      }
      if (water) { terrain = 'water'; elevation = 0; }
      else if (elevation > .67) {
        terrain = 'mountain';
        const geological = clamp(Math.floor((climate * .68 + local * .32) * mountains.length), 0, mountains.length - 1);
        detail = mountains[geological];
      } else if (elevation > .615 || (elevation > .55 && local > .77)) { terrain = 'rock'; detail = biome === 'desert' ? 'canyon' : 'glacial'; }
      else if (biome === 'taiga') {
        const forest = moisture + (local - .5) * .21 + (fine - .5) * .045;
        if (forest > .51) {
          terrain = 'forest';
          detail = habitat > .982 ? 'deadwood' : climate > .60 ? (habitat > .5 ? 'birch' : 'aspen') : climate < .39 ? 'oak' : treeKinds[Math.floor(habitat * 3)];
        } else if (moisture > .49 && local > .64) detail = habitat > .5 ? 'marsh' : 'ferns';
        else if (local > .50) detail = ['wildflowers', 'bluebells', 'berry-bushes', '', ''][Math.floor(habitat * 5)];
        else detail = ['grass-tufts', 'heather', 'shrubs', '', '', ''][Math.floor(habitat * 6)];
      } else if (biome === 'tundra') {
        if (moisture + (local - .5) * .17 > .59 && climate > .30) { terrain = 'forest'; detail = habitat > .97 ? 'deadwood' : treeKinds[Math.floor(habitat * 4)]; }
        else if (climate + (local - .5) * .13 > .51) {
          terrain = 'grass'; detail = ['arctic-poppies', 'cotton-grass', 'heather', 'willow-scrub', 'tundra-grass', 'lichen', 'shrubs', 'marsh', ''][Math.floor(habitat * 9)];
        } else detail = local > .64 ? (habitat > .5 ? 'lichen' : 'glacial') : habitat > .82 ? 'heather' : 'snow';
      } else {
        if (moisture > .66 && local > .43) { terrain = 'forest'; detail = habitat > .975 ? 'deadwood' : treeKinds[Math.floor(habitat * 4)]; }
        else if (moisture > .61 && local > .45) { terrain = 'grass'; detail = habitat > .7 ? 'desert-flowers' : 'dry-grass'; }
        else if (local < .25 && moisture < .45) detail = 'saltflat';
        else if (local > .50 && habitat > .35) detail = ['cactus', 'agave', 'prickly-pear', 'aloe', 'scrub'][Math.min(4, Math.floor((habitat - .35) / .65 * 5))];
        else detail = climate > .45 ? 'dunes' : habitat > .7 ? 'dry-grass' : '';
      }
      tiles[y * width + x] = { terrain, elevation, detail, variant: Math.min(15, Math.floor(hashNoise(x, y, numericSeed + 397) * 16)), road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null };
    }
  }
  const tile = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : null;
  // Recipe 4 keeps the underlying hills under settlements. If a starting town
  // falls offshore, its guaranteed land has an irregular, gently sloping shore
  // instead of the old nine-by-nine square. Work stays local to the two towns.
  if (naturalRelief) for (const cx of [starterX, starterX + 24]) {
    let nearbyHeight = 0, nearbyLand = 0;
    for (let dy = -14; dy <= 14; dy += 2) for (let dx = -14; dx <= 14; dx += 2) {
      const t = tile(cx + dx, starterY + dy);
      if (t && t.terrain !== 'water') { nearbyHeight += t.elevation; nearbyLand++; }
    }
    const centerHeight = clamp(nearbyLand ? nearbyHeight / nearbyLand : .18, .14, .30);
    for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
      const x = cx + dx, y = starterY + dy, t = tile(x, y); if (!t) continue;
      const distance = Math.hypot(dx / 1.08, dy / .96);
      const outer = 11 + (noise(x, y, numericSeed + 2231, 6) - .5) * 3;
      const core = Math.abs(dx) <= 4 && Math.abs(dy) <= 4;
      if (t.terrain === 'water' && (core || distance < outer)) {
        const edge = clamp((outer - distance) / (outer - 6.4), 0, 1);
        const blend = edge * edge * (3 - 2 * edge);
        t.terrain = land;
        t.elevation = Math.max(1 / 1024, Math.round((centerHeight + (noise(x, y, numericSeed + 2237, 9) - .5) * .035) * blend * 1024) / 1024);
        t.detail = '';
      } else if (core) { t.terrain = land; t.detail = ''; }
    }
  } else {
    // Frozen recipe 2/3: existing sparse saves depend on these exact tiles.
    for (const cx of [starterX, starterX + 24]) for (let y = starterY - 4; y <= starterY + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
      Object.assign(tile(x, y), { terrain: land, elevation: .25, detail: '' });
    }
  }
  const riverTiles = new Set();
  function paintRiver(points, radius) {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i], steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let step = 0; step <= steps; step++) {
        const cx = ax + (bx - ax) * step / steps, cy = ay + (by - ay) * step / steps;
        for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
          const t = tile(x, y); if (!t) continue;
          t.terrain = 'water'; t.elevation = 0; t.detail = 'river'; riverTiles.add(y * width + x);
        }
      }
    }
  }
  function curve(start, controlA, controlB, end, bend = 1) {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const steps = Math.max(32, Math.ceil(length / 3)), phase = random() * TAU;
    const dx = end[0] - start[0], dy = end[1] - start[1], normalX = -dy / Math.max(1, length), normalY = dx / Math.max(1, length);
    const amplitude = Math.min(length * .085, 9 + Math.sqrt(unit) * 1.5) * bend, points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t, wiggle = Math.sin(t * Math.PI) ** 2 * (Math.sin(t * Math.PI * (3 + bend) + phase) * .7 + Math.sin(t * Math.PI * 9 + phase) * .3) * amplitude;
      points.push([clamp(u ** 3 * start[0] + 3 * u * u * t * controlA[0] + 3 * u * t * t * controlB[0] + t ** 3 * end[0] + normalX * wiggle, 0, width - 1), clamp(u ** 3 * start[1] + 3 * u * u * t * controlA[1] + 3 * u * t * t * controlB[1] + t ** 3 * end[1] + normalY * wiggle, 0, height - 1)]);
    }
    return points;
  }
  const openingY = starterY + 6;
  const opening = Array.from({ length: 45 }, (_, i) => {
    const x = starterX - 10 + i;
    return [x, openingY + (x > starterX && x < starterX + 24 ? Math.sin((x - starterX) / 24 * Math.PI) ** 2 * 1.4 : 0)];
  });
  paintRiver(opening, 1.65);
  const edge = fields.edge, coastFraction = .18 + random() * .65;
  const mouth = edge === 0 ? [width + 3, height * coastFraction] : edge === 1 ? [width * coastFraction, height + 3] : edge === 2 ? [-3, height * coastFraction] : [width * coastFraction, -3];
  const rightOutlet = mouth[0] > starterX + 12, direction = rightOutlet ? 1 : -1;
  const outlet = rightOutlet ? opening[opening.length - 1] : opening[0], inlet = rightOutlet ? opening[0] : opening[opening.length - 1];
  const inward = edge === 0 ? [-1, 0] : edge === 1 ? [0, -1] : edge === 2 ? [1, 0] : [0, 1];
  const mainRadius = 1.85 + Math.sqrt(unit / 512) * .5;
  const main = curve(outlet, [outlet[0] + direction * unit * .16, outlet[1]], [mouth[0] + inward[0] * unit * .19, mouth[1] + inward[1] * unit * .19], mouth, .9);
  paintRiver(main, mainRadius);
  const source = [clamp(inlet[0] - direction * unit * (.20 + random() * .12), 8, width - 9), height * (.08 + random() * .77)];
  const upper = curve(source, [source[0] - direction * unit * .07, source[1] + (random() - .5) * unit * .25], [inlet[0] - direction * unit * .14, inlet[1]], inlet, 1.2);
  paintRiver(upper, mainRadius * .9);
  const watershed = [...upper, ...main];
  // Include the river brush radius, so a tributary grazing the town boundary
  // cannot flood a reserved building plot. The opening channel is already cut.
  const protectedOpening = point => point[0] > starterX - 8 && point[0] < starterX + 32 && point[1] > starterY - 8 && point[1] < starterY + 8;
  const tributaries = 3 + Math.round(Math.sqrt(unit / 64));
  for (let branch = 0; branch < tributaries; branch++) {
    for (let attempt = 0; attempt < 15; attempt++) {
      const junction = watershed[Math.floor((.10 + random() * .80) * watershed.length)];
      const angle = random() * TAU, reach = unit * (.09 + random() * .24);
      const spring = [clamp(junction[0] + Math.cos(angle) * reach, 6, width - 7), clamp(junction[1] + Math.sin(angle) * reach, 6, height - 7)];
      const springTile = tile(Math.round(spring[0]), Math.round(spring[1]));
      if (!springTile || springTile.terrain === 'water' || Math.hypot(spring[0] - junction[0], spring[1] - junction[1]) < 20) continue;
      const dx = junction[0] - spring[0], dy = junction[1] - spring[1], side = (random() - .5) * .8;
      const points = curve(spring, [spring[0] + dx * .3 - dy * side, spring[1] + dy * .3 + dx * side], [spring[0] + dx * .7 + dy * side, spring[1] + dy * .7 - dx * side], junction, .7 + random() * .7);
      if (points.some(protectedOpening)) continue;
      paintRiver(points, 1.55 + random() * .55);
      watershed.push(...points);
      break;
    }
  }
  // Regional forests and clearings are supplemented by a narrow river habitat.
  // The same tiles remain buildable and every waterway belongs to this watershed.
  for (const index of riverTiles) {
    const x = index % width, y = Math.floor(index / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = tile(x + dx, y + dy);
      if (!t || ['water', 'mountain', 'rock', 'forest'].includes(t.terrain)) continue;
      if (biome === 'desert') { t.terrain = 'grass'; t.detail = t.variant % 5 === 0 ? 'desert-flowers' : 'reeds'; }
      else t.detail = biome === 'tundra' ? (t.variant % 5 === 0 ? 'reeds' : t.variant % 3 ? 'cotton-grass' : 'willow-scrub') : (t.variant % 3 ? 'reeds' : 'ferns');
    }
  }
  for (const cx of [starterX, starterX + 24]) {
    const bank = tile(cx, starterY + 4);
    Object.assign(bank, { terrain: land, elevation: naturalRelief ? bank.elevation || tile(cx, starterY + 3).elevation : .25, detail: '' });
  }
  return { tiles, starterX, starterY, land, naturalRelief };
}
