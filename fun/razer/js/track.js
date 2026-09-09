// World generation runs once, before either rendering or racing begins. All randomness
// is local to this seed, so a shared circuit code describes the complete world.
const TAU = Math.PI * 2;
const WIDTH = 12;
const SAMPLE_COUNT = 512;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const ENVIRONMENTS = Object.freeze({
  desert: { label: 'Desert', colors: { ground: 0xc59d66, road: 0x504b46, sky: 0xe7ceb0, fog: 0xdcc09a }, relief: 14, trees: 0 },
  jungle: { label: 'Jungle', colors: { ground: 0x52744d, road: 0x4b5250, sky: 0xacc9bc, fog: 0x8da798 }, relief: 17, trees: 1 },
  beach: { label: 'Beach', colors: { ground: 0xdac794, road: 0x575b60, sky: 0xb8dfeb, fog: 0xc4dfe1 }, relief: 12, trees: 0.4 },
  mountains: { label: 'Mountains', colors: { ground: 0x7c8c72, road: 0x4c5155, sky: 0xb8cbd8, fog: 0xa6bac8 }, relief: 22, trees: 0.7 },
});

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function createRandom(seed) {
  let state = hashString(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const distance3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function pathLength(points, closed = false) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distance3(points[i - 1], points[i]);
  if (closed) length += distance3(points.at(-1), points[0]);
  return length;
}

function resampleClosed(raw, count) {
  const cumulative = [0];
  for (let i = 1; i <= raw.length; i++) cumulative.push(cumulative.at(-1) + distance3(raw[i - 1], raw[i % raw.length]));
  const total = cumulative.at(-1);
  const points = [];
  let edge = 0;
  for (let i = 0; i < count; i++) {
    const along = total * i / count;
    while (cumulative[edge + 1] < along) edge++;
    const a = raw[edge], b = raw[(edge + 1) % raw.length];
    const t = (along - cumulative[edge]) / (cumulative[edge + 1] - cumulative[edge]);
    points.push({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t), progress: i / count });
  }
  // Progress is measured on the final polyline, not on the discarded source curve.
  const length = pathLength(points, true);
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    points[i].progress = along / length;
    along += distance3(points[i], points[(i + 1) % points.length]);
  }
  return { points, length };
}

function samplePath(points, progress, closed) {
  const p = closed ? ((progress % 1) + 1) % 1 : clamp(progress, points[0].progress, points.at(-1).progress);
  let low = 0, high = points.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (points[mid].progress <= p) low = mid;
    else high = mid - 1;
  }
  let index = low;
  if (!closed && index === points.length - 1) index--;
  const a = points[index], b = points[(index + 1) % points.length];
  const endProgress = closed && index === points.length - 1 ? 1 : b.progress;
  const t = clamp((p - a.progress) / (endProgress - a.progress), 0, 1);
  const horizontal = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t), progress: p,
    tangent: { x: (b.x - a.x) / horizontal, z: (b.z - a.z) / horizontal } };
}

function crosses(a, b, c, d) {
  const side = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < -1e-7 && side(c, d, a) * side(c, d, b) < -1e-7;
}

function minimumTurnRadius(points) {
  let minimum = Infinity;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const ab = Math.hypot(a.x - b.x, a.z - b.z), bc = Math.hypot(b.x - c.x, b.z - c.z), ac = Math.hypot(a.x - c.x, a.z - c.z);
    const twiceArea = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (twiceArea > 1e-9) minimum = Math.min(minimum, ab * bc * ac / (2 * twiceArea));
  }
  return minimum;
}

function maximumGrade(points, closed = false) {
  let grade = 0;
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    grade = Math.max(grade, Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z));
  }
  return grade;
}

function routeIsClear(points, main, previousRoutes, start, end) {
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < main.length; j++) {
      if (crosses(points[i], points[i + 1], main[j], main[(j + 1) % main.length])) return false;
    }
    for (let j = i + 2; j < points.length - 1; j++) {
      if (crosses(points[i], points[i + 1], points[j], points[j + 1])) return false;
    }
    for (const route of previousRoutes) {
      for (let j = 0; j < route.points.length - 1; j++) {
        if (crosses(points[i], points[i + 1], route.points[j], route.points[j + 1])) return false;
      }
    }
    // Branches share their entrance and exit, but cannot graze unrelated roads.
    if (i > 8 && i < points.length - 9) {
      for (const p of main) {
        if (p.progress > start - 0.025 && p.progress < end + 0.025) continue;
        if (Math.hypot(points[i].x - p.x, points[i].z - p.z) < WIDTH + 4) return false;
      }
      for (const route of previousRoutes) {
        for (const p of route.points) if (Math.hypot(points[i].x - p.x, points[i].z - p.z) < WIDTH + 4) return false;
      }
    }
  }
  return true;
}

function makeAlternates(main, length, random) {
  const routes = [];
  // Opposite quarters keep the two interior branches well apart. The offset is
  // solved against the original 3D arc length, including its hills.
  const quarterOffset = random() * 0.07;
  for (let routeIndex = 0; routeIndex < 2; routeIndex++) {
    const candidates = [];
    for (let attempt = 0; attempt < 13; attempt++) {
      const start = 0.055 + routeIndex * 0.48 + quarterOffset + attempt * 0.014;
      const end = start + 0.18;
      if (end > 0.975) continue;
      const a = samplePath(main, start, true), b = samplePath(main, end, true);
      const chord = Math.hypot(b.x - a.x, b.z - a.z);
      candidates.push({ start, end, a, b, chord, score: length * (end - start) - chord });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates) {
      const { start, end, a, b, chord } = candidate;
      const normal = { x: -(b.z - a.z) / chord, z: (b.x - a.x) / chord };
      const mainLength = length * (end - start);
      const count = 100;
      const original = Array.from({ length: count + 1 }, (_, i) => samplePath(main, mix(start, end, i / count), true));
      const offsetPath = amplitude => original.map((p, i) => {
        const displacement = amplitude * Math.sin(Math.PI * i / count) ** 2;
        // The branch crosses the valley on its own gentler contour, joining both
        // road elevations with a smooth blend at the fork and merge.
        const y = mix(p.y, mix(a.y, b.y, i / count), Math.sin(Math.PI * i / count) ** 2 * 0.65);
        return { x: p.x + normal.x * displacement, y, z: p.z + normal.z * displacement, progress: p.progress };
      });
      // Ignore the trivial zero-displacement solution. The shorter inner curve
      // lengthens again once its bend crosses the chord into the infield.
      let low = 8, high = 22;
      if (pathLength(offsetPath(low)) >= mainLength) continue;
      while (high < 120 && pathLength(offsetPath(high)) < mainLength) high *= 1.3;
      if (high >= 120) continue;
      for (let iteration = 0; iteration < 32; iteration++) {
        const mid = (low + high) / 2;
        if (pathLength(offsetPath(mid)) < mainLength) low = mid;
        else high = mid;
      }
      const amplitude = (low + high) / 2;
      if (amplitude < 25) continue;
      const points = offsetPath(amplitude);
      if (minimumTurnRadius(points) < 18 || maximumGrade(points) > 0.22) continue;
      if (!routeIsClear(points, main, routes, start, end)) continue;
      const routeLength = pathLength(points);
      let along = 0;
      for (let i = 0; i < points.length; i++) {
        points[i].progress = mix(start, end, along / routeLength);
        if (i < points.length - 1) along += distance3(points[i], points[i + 1]);
      }
      routes.push({ id: `alt-${routeIndex + 1}`, points, start, end, length: routeLength, mainLength });
      break;
    }
  }
  return routes;
}

function makeSpatialIndex(points, routes) {
  const cellSize = 32;
  const cells = new Map();
  const segments = [];
  let visit = 0;
  const key = (x, z) => `${x},${z}`;
  const addPath = (path, routeId, closed) => {
    const count = closed ? path.length : path.length - 1;
    for (let i = 0; i < count; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz;
      const segment = { a, b, dx, dz, lengthSquared, routeId, p1: closed && i === count - 1 ? 1 : b.progress, visit: 0 };
      segments.push(segment);
      for (let cx = Math.floor(Math.min(a.x, b.x) / cellSize); cx <= Math.floor(Math.max(a.x, b.x) / cellSize); cx++) {
        for (let cz = Math.floor(Math.min(a.z, b.z) / cellSize); cz <= Math.floor(Math.max(a.z, b.z) / cellSize); cz++) {
          const id = key(cx, cz);
          if (!cells.has(id)) cells.set(id, []);
          cells.get(id).push(segment);
        }
      }
    }
  };
  addPath(points, 'main', true);
  for (const route of routes) addPath(route.points, route.id, false);
  const find = (x, z, maxDistance = 64, allowFallback = true) => {
    visit++;
    let bestSquared = maxDistance * maxDistance, best, bestT = 0;
    const inspect = segment => {
      if (segment.visit === visit) return;
      segment.visit = visit;
      const t = clamp(((x - segment.a.x) * segment.dx + (z - segment.a.z) * segment.dz) / segment.lengthSquared, 0, 1);
      const ox = x - segment.a.x - segment.dx * t, oz = z - segment.a.z - segment.dz * t;
      const squared = ox * ox + oz * oz;
      if (squared < bestSquared) { bestSquared = squared; best = segment; bestT = t; }
    };
    for (let cx = Math.floor((x - maxDistance) / cellSize); cx <= Math.floor((x + maxDistance) / cellSize); cx++) {
      for (let cz = Math.floor((z - maxDistance) / cellSize); cz <= Math.floor((z + maxDistance) / cellSize); cz++) {
        const bucket = cells.get(key(cx, cz));
        if (bucket) for (const segment of bucket) inspect(segment);
      }
    }
    if (!best && allowFallback) {
      bestSquared = Infinity;
      // Clear the visit stamp because the finite-radius pass may have inspected
      // segments outside its radius without accepting them.
      visit++;
      for (const segment of segments) inspect(segment);
    }
    if (!best) return null;
    const horizontal = Math.sqrt(best.lengthSquared);
    return { x: best.a.x + best.dx * bestT, y: mix(best.a.y, best.b.y, bestT), z: best.a.z + best.dz * bestT,
      distance: Math.sqrt(bestSquared), progress: mix(best.a.progress, best.p1, bestT) % 1,
      tangent: { x: best.dx / horizontal, z: best.dz / horizontal }, routeId: best.routeId, width: WIDTH };
  };
  return find;
}

function makeRiverIndex(points) {
  const cellSize = 40, reach = 44;
  const cells = new Map();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const segment = { a, b, dx, dz, squared: dx * dx + dz * dz };
    for (let x = Math.floor((Math.min(a.x, b.x) - reach) / cellSize); x <= Math.floor((Math.max(a.x, b.x) + reach) / cellSize); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - reach) / cellSize); z <= Math.floor((Math.max(a.z, b.z) + reach) / cellSize); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(segment);
      }
    }
  }
  return (x, z) => {
    const bucket = cells.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`);
    if (!bucket) return null;
    let best = null, squared = reach * reach;
    for (const { a, b, dx, dz, squared: segmentSquared } of bucket) {
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / segmentSquared, 0, 1);
      const distanceSquared = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
      if (distanceSquared < squared) {
        squared = distanceSquared;
        best = { distance: Math.sqrt(squared), width: mix(a.width, b.width, t), y: mix(a.y, b.y, t) };
      }
    }
    return best;
  };
}

export function generateTrack(seed, environment = 'auto') {
  const normalizedSeed = String(seed ?? 'RAZER').trim().slice(0, 96) || 'RAZER';
  const random = createRandom(normalizedSeed);
  const environmentRoll = random();
  const environmentName = Object.hasOwn(ENVIRONMENTS, environment) ? environment : Object.keys(ENVIRONMENTS)[Math.floor(environmentRoll * 4)];
  const theme = ENVIRONMENTS[environmentName];
  const phase = random() * TAU;
  const radius = 130 + random() * 12;
  const stretchX = 1.02 + random() * 0.1;
  const stretchZ = 0.85 + random() * 0.1;
  const phase2 = random() * TAU, phase3 = random() * TAU, phase5 = random() * TAU;
  const amp2 = 9 + random() * 6, amp3 = 7 + random() * 5, amp5 = 2 + random() * 2;
  const hillPhase = random() * TAU;
  let circuit, routes;
  // Retry with a softer radial profile if a seed's sharper corners prevent two
  // safe, equal-length branches. The deterministic fallback still keeps hills.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shape = Math.pow(0.58, attempt);
    const raw = Array.from({ length: 1536 }, (_, i) => {
      const angle = i / 1536 * TAU;
      const radial = radius + shape * (amp2 * Math.sin(angle * 2 + phase2) + amp3 * Math.sin(angle * 3 + phase3) + amp5 * Math.sin(angle * 5 + phase5));
      const x = Math.cos(angle) * radial * stretchX, z = Math.sin(angle) * radial * stretchZ;
      return { x: x * Math.cos(phase) - z * Math.sin(phase), z: x * Math.sin(phase) + z * Math.cos(phase),
        y: 14 + theme.relief * (0.6 * Math.sin(angle + hillPhase) + 0.18 * Math.sin(angle * 2 - hillPhase)
          + 0.065 * Math.cos(angle * 3 + phase3) + 0.034 * Math.sin(angle * 5 + phase5)) };
    });
    // Keep long climbing sections and short crests without a seed creating a
    // wall. Scaling elevations preserves a seamless loop and all hill phases.
    const gradeScale = Math.min(1, 0.17 / maximumGrade(raw, true));
    for (const p of raw) p.y = 14 + (p.y - 14) * gradeScale;
    circuit = resampleClosed(raw, SAMPLE_COUNT);
    routes = makeAlternates(circuit.points, circuit.length, createRandom(`${normalizedSeed}:branches`));
    if (routes.length === 2) break;
  }
  if (routes.length !== 2) throw new Error('Unable to generate two safe alternate roads for this seed.');
  const { points, length } = circuit;
  const nearestRoad = makeSpatialIndex(points, routes);
  const terrainPhase = random() * TAU;
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of points) {
    bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z);
  }
  bounds.minX -= 85; bounds.maxX += 85; bounds.minZ -= 85; bounds.maxZ += 85;
  const sample = (progress, routeId = 'main') => {
    const route = routes.find(item => item.id === routeId);
    return samplePath(route?.points ?? points, progress, !route);
  };
  const worldRandom = createRandom(`${normalizedSeed}:${environmentName}:landscape`);
  const surfaceBoundaries = [0, 0.16 + worldRandom() * 0.025, 0.30 + worldRandom() * 0.025,
    0.50 + worldRandom() * 0.025, 0.64 + worldRandom() * 0.025, 0.83 + worldRandom() * 0.025, 1];
  const looseSurface = environmentName === 'desert' || environmentName === 'beach' ? 'sand' : 'gravel';
  const surfaces = ['asphalt', 'gravel', 'asphalt', 'dirt', 'asphalt', looseSurface];
  const surfaceSections = surfaces.map((surface, i) => ({ surface, start: surfaceBoundaries[i], end: surfaceBoundaries[i + 1] }));
  const mainSurfaceAt = progress => {
    const p = ((progress % 1) + 1) % 1;
    return surfaceSections.find(section => p < section.end).surface;
  };
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    // Keep the junction material continuous, then give the alternate its own
    // surface and driving character for almost its entire length.
    const surface = i === 0 ? 'dirt' : looseSurface;
    const inset = (route.end - route.start) * 0.055;
    route.surfaceSections = [
      { start: route.start, end: route.start + inset, surface: mainSurfaceAt(route.start) },
      { start: route.start + inset, end: route.end - inset, surface },
      { start: route.end - inset, end: route.end, surface: mainSurfaceAt(route.end) },
    ];
  }
  const surfaceAt = (progress, routeId = 'main') => {
    const route = routes.find(item => item.id === routeId);
    if (!route) return mainSurfaceAt(progress);
    const p = clamp(progress, route.start, route.end);
    return route.surfaceSections.find(section => p < section.end)?.surface ?? route.surfaceSections.at(-1).surface;
  };

  // Follow the outside of the circuit, so every river is an actual riverside
  // section without a hidden ford or an unbridged road crossing. The broad
  // valley is carved below a single water level; track elevation can rise above it.
  const riverStart = worldRandom();
  const riverSpan = 0.36 + worldRandom() * 0.07;
  const riverWidth = environmentName === 'desert' ? 8 : environmentName === 'jungle' ? 13 : 11;
  const riverPhase = worldRandom() * TAU;
  const riverPoints = [];
  const riversideRoad = [];
  for (let i = 0; i <= 96; i++) {
    const p = sample(riverStart + riverSpan * i / 96);
    const radial = Math.hypot(p.x, p.z), dx = p.x / radial, dz = p.z / radial;
    const width = riverWidth * (0.9 + 0.15 * Math.sin(i * 0.095 + riverPhase));
    let offset = 29 + width / 2 + 6 * Math.sin(i * 0.115 + riverPhase) + 2.5 * Math.sin(i * 0.28);
    let x = p.x + dx * offset, z = p.z + dz * offset;
    while (nearestRoad(x, z).distance < WIDTH / 2 + width / 2 + 13) {
      offset += 2; x = p.x + dx * offset; z = p.z + dz * offset;
    }
    riverPoints.push({ x, y: 0, z, width });
    riversideRoad.push(p);
  }
  const waterLevel = environmentName === 'beach' ? -0.46 : Math.min(...riversideRoad.map(p => p.y)) - 2.6;
  for (const p of riverPoints) p.y = waterLevel;
  // Extend the stream beyond the terrain mesh at both ends. It enters and leaves
  // the landscape rather than terminating in a conspicuous semicircular puddle.
  const extendRiver = (p, reverse) => Array.from({ length: 12 }, (_, i) => {
    const step = reverse ? 12 - i : i + 1;
    const radial = Math.hypot(p.x, p.z);
    return { x: p.x * (1 + step * 12 / radial), y: waterLevel, z: p.z * (1 + step * 12 / radial), width: p.width };
  });
  const river = { points: [...extendRiver(riverPoints[0], true), ...riverPoints, ...extendRiver(riverPoints.at(-1), false)],
    width: riverWidth, waterLevel, start: riverStart, span: riverSpan };
  const riverAt = makeRiverIndex(river.points);
  const forestCenters = Array.from({ length: 15 }, () => ({
    x: mix(bounds.minX + 30, bounds.maxX - 30, worldRandom()),
    z: mix(bounds.minZ + 30, bounds.maxZ - 30, worldRandom()),
    radius: 28 + worldRandom() * 41, aspect: 0.65 + worldRandom() * 0.8,
  }));
  const relief = { desert: 14, jungle: 23, beach: 16, mountains: 44 }[environmentName];
  const baseHeight = (x, z) => {
    const broad = Math.sin(x * 0.014 + terrainPhase) * Math.cos(z * 0.016 - terrainPhase);
    const detail = Math.sin(x * 0.037 + z * 0.026 + terrainPhase) * Math.cos(z * 0.029) * 0.27
      + Math.sin(x * 0.075 - z * 0.052 + terrainPhase) * 0.055;
    const ridge = Math.max(0, Math.hypot(x, z) - 105) * (environmentName === 'mountains' ? 0.28 : 0.065);
    if (environmentName === 'beach') {
      const centerX = (bounds.minX + bounds.maxX) / 2, centerZ = (bounds.minZ + bounds.maxZ) / 2;
      const cornerRadius = 64;
      const qx = Math.abs(x - centerX) - (bounds.maxX - bounds.minX) / 2 + cornerRadius;
      const qz = Math.abs(z - centerZ) - (bounds.maxZ - bounds.minZ) / 2 + cornerRadius;
      const inland = cornerRadius - Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) - Math.min(Math.max(qx, qz), 0);
      const coastWaves = 9 * Math.sin(z * 0.033 + terrainPhase) + 6 * Math.sin(x * 0.041 - terrainPhase * 0.7);
      const island = 8 + (broad + detail) * relief + ridge;
      return mix(-8 + broad * 0.3, island, smoothstep(8, 62, inland + coastWaves));
    }
    return 12 + (broad + detail) * relief + ridge;
  };
  const heightAt = (x, z) => {
    let terrain = baseHeight(x, z);
    const road = nearestRoad(x, z, 34, false);
    // Preserve the complete visible road shoulder before blending the hillside.
    if (road) terrain = mix(road.y, terrain, smoothstep(WIDTH / 2 + 2.4, 27, road.distance));
    const riverSample = riverAt(x, z);
    // Small erosion channels and hummocks add near-ground detail. Tire shoulders
    // and riverbanks stay smooth; the same relief is sampled by the suspension.
    const microRoad = road ? smoothstep(11, 25, road.distance) : 1;
    const microRiver = riverSample ? smoothstep(riverSample.width / 2 + 12, riverSample.width / 2 + 27, riverSample.distance) : 1;
    const microScale = { desert: 0.26, jungle: 0.33, beach: 0.20, mountains: 0.42 }[environmentName];
    terrain += (Math.sin(x * 0.63 + terrainPhase) * Math.cos(z * 0.53 - terrainPhase)
      + 0.35 * Math.sin(x * 1.08 + z * 0.79 + terrainPhase)) * microScale * microRoad * microRiver;
    if (riverSample) {
      const halfWidth = riverSample.width / 2;
      const bank = smoothstep(halfWidth, halfWidth + 13, riverSample.distance);
      const channel = mix(waterLevel - 1.9, waterLevel, smoothstep(halfWidth * 0.32, halfWidth, riverSample.distance));
      // Raised outer banks contain water even where uncarved ground was low.
      // Feather their influence out completely before the spatial query ends.
      const raisedBank = mix(terrain, Math.max(terrain, waterLevel + 1.15),
        1 - smoothstep(halfWidth + 13, halfWidth + 25, riverSample.distance));
      const carved = mix(channel, raisedBank, bank);
      const roadProtection = road ? smoothstep(WIDTH / 2 + 2.4, WIDTH / 2 + 6, road.distance) : 1;
      terrain = mix(terrain, carved, roadProtection);
    }
    return terrain;
  };
  const terrainAt = (x, z) => {
    const riverSample = riverAt(x, z);
    const moisture = riverSample ? 1 - smoothstep(riverSample.width / 2 + 1, riverSample.width / 2 + 29, riverSample.distance) : 0;
    const noise = 0.5 + 0.25 * Math.sin(x * 0.039 + terrainPhase) * Math.cos(z * 0.046 - terrainPhase)
      + 0.18 * Math.sin((x + z) * 0.015 + terrainPhase);
    let forest = 0;
    for (const center of forestCenters) {
      const distance = Math.hypot((x - center.x) * center.aspect, (z - center.z) / center.aspect) / center.radius;
      forest = Math.max(forest, 1 - smoothstep(0.12, 1.15, distance));
    }
    forest *= 0.65 + noise * 0.35;
    if (environmentName === 'desert') forest *= moisture * 0.85;
    if (environmentName === 'beach') forest *= 0.82;
    let surface = 'grass';
    if (environmentName === 'desert') surface = noise > 0.62 ? 'rock' : noise < 0.34 ? 'dirt' : 'sand';
    else if (environmentName === 'beach') surface = forest > 0.32 && baseHeight(x, z) > 5 ? 'grass' : 'sand';
    else if (environmentName === 'mountains') surface = baseHeight(x, z) > 27 || noise > 0.69 ? 'rock' : noise < 0.29 ? 'dirt' : 'grass';
    else if (noise < 0.33) surface = 'dirt';
    if (moisture > 0.42) surface = environmentName === 'beach' || environmentName === 'desert' ? 'sand' : 'dirt';
    if (surface === 'rock') forest *= 0.45;
    return { surface, forest: clamp(forest, 0, 1), moisture };
  };
  const boosts = [];
  for (let i = 0; i < 5; i++) {
    const progress = (0.12 + i * 0.185 + random() * 0.026) % 1;
    const p = sample(progress);
    boosts.push({ x: p.x, y: p.y, z: p.z, progress, routeId: 'main' });
  }
  for (const route of routes) {
    const progress = mix(route.start, route.end, 0.58);
    const p = sample(progress, route.id);
    boosts.push({ x: p.x, y: p.y, z: p.z, progress, routeId: route.id });
  }
  const decorations = [];
  const propRandom = createRandom(`${normalizedSeed}:${environmentName}:props`);
  const population = { desert: 680, jungle: 1600, beach: 1000, mountains: 1550 }[environmentName];
  const chooseType = (roll, terrain) => {
    if (roll < 0.025) return 'building';
    if (environmentName === 'desert') return terrain.moisture > 0.3 && terrain.forest > 0.15 && roll < 0.45 ? 'palm'
      : roll < 0.29 ? 'cactus' : roll < 0.75 ? 'rock' : 'shrub';
    if (environmentName === 'beach') return roll < 0.13 + terrain.forest * 0.68 ? 'palm' : roll < 0.70 ? 'rock' : 'shrub';
    const trees = Math.min(0.91, 0.025 + terrain.forest * 1.75);
    if (roll < trees) return environmentName === 'jungle' && roll > trees * 0.83 ? 'palm' : 'tree';
    return roll < trees + (terrain.surface === 'rock' ? 0.5 : 0.2) ? 'rock' : 'shrub';
  };
  for (let attempt = 0; attempt < population * 8 && decorations.length < population; attempt++) {
    const x = mix(bounds.minX + 8, bounds.maxX - 8, propRandom());
    const z = mix(bounds.minZ + 8, bounds.maxZ - 8, propRandom());
    const terrain = terrainAt(x, z);
    const type = chooseType(propRandom(), terrain);
    // Trees and understory grow together, leaving connected meadow clearings.
    if ((type === 'tree' || type === 'palm') && propRandom() > 0.25 + terrain.forest * 0.75) continue;
    if (type === 'shrub' && propRandom() > 0.3 + terrain.forest * 0.7) continue;
    const sizeRoll = propRandom();
    const scale = type === 'rock' ? sizeRoll < 0.58 ? 0.18 + propRandom() * 0.48
      : sizeRoll < 0.88 ? 0.7 + propRandom() * 0.65 : 1.45 + propRandom() * 1.2
      : type === 'shrub' ? 0.3 + sizeRoll * 0.9 : 0.65 + sizeRoll * 0.95;
    const radius = ({ rock: 2.2, tree: 1.05, palm: 0.85, cactus: 0.85, building: 6.9, shrub: 0 }[type]) * scale;
    const clearance = WIDTH / 2 + Math.max(radius, type === 'shrub' ? scale * 1.8 : 0) + 3;
    const road = nearestRoad(x, z, clearance + 1, false);
    if (road && road.distance < clearance) continue;
    const y = heightAt(x, z);
    if (environmentName === 'beach' && y < -0.1) continue;
    const riverSample = riverAt(x, z);
    if (riverSample && (riverSample.distance < riverSample.width / 2 + radius + 1 || y < riverSample.y + 0.4)) continue;
    if (type === 'building') {
      if (Math.abs(heightAt(x + 5, z) - heightAt(x - 5, z)) + Math.abs(heightAt(x, z + 5) - heightAt(x, z - 5)) > 3.5) continue;
      if (decorations.some(prop => prop.radius > 4 && Math.hypot(prop.x - x, prop.z - z) < prop.radius + radius + 7)) continue;
    }
    decorations.push({ type, x, y, z, scale, rotation: propRandom() * TAU, radius });
  }
  // Understory grows around established trees in irregular clumps, including
  // small plants under canopies rather than only isolated full-sized shrubs.
  const anchors = decorations.filter(prop => prop.type === 'tree' || prop.type === 'palm');
  const understory = { desert: 80, jungle: 360, beach: 220, mountains: 280 }[environmentName];
  let undergrowthAdded = 0;
  for (let attempt = 0; anchors.length && attempt < understory * 8 && undergrowthAdded < understory; attempt++) {
    const anchor = anchors[Math.floor(propRandom() * anchors.length)];
    const direction = propRandom() * TAU, radius = 2 + propRandom() * 8;
    const x = anchor.x + Math.cos(direction) * radius, z = anchor.z + Math.sin(direction) * radius;
    if (x <= bounds.minX + 2 || x >= bounds.maxX - 2 || z <= bounds.minZ + 2 || z >= bounds.maxZ - 2) continue;
    const scale = 0.24 + propRandom() * 0.8;
    const clearance = WIDTH / 2 + scale * 1.8 + 3;
    const road = nearestRoad(x, z, clearance + 1, false);
    if (road && road.distance < clearance) continue;
    const y = heightAt(x, z), riverSample = riverAt(x, z);
    if ((environmentName === 'beach' && y < -0.1) || (riverSample && (riverSample.distance < riverSample.width / 2 + 1 || y < riverSample.y + 0.4))) continue;
    decorations.push({ type: 'shrub', x, y, z, scale, rotation: propRandom() * TAU, radius: 0 });
    undergrowthAdded++;
  }
  const prefixes = { desert: ['Sunscar', 'Dust Devil', 'Copper Dune', 'Mirage'], jungle: ['Emerald', 'Wildroot', 'Rainforest', 'Canopy'], beach: ['Coral', 'Palm Coast', 'Azure', 'Tidal'], mountains: ['Cloudbreak', 'Granite', 'Highland', 'Pine Ridge'] };
  const suffixes = ['Run', 'Circuit', 'Rush', 'Loop'];
  const name = `${prefixes[environmentName][Math.floor(random() * 4)]} ${suffixes[Math.floor(random() * 4)]}`;
  return { seed: normalizedSeed, hash: hashString(normalizedSeed).toString(16).padStart(8, '0'), environment: environmentName,
    name, width: WIDTH, length, points, routes, boosts, decorations, bounds, river, surfaceSections,
    elevationGain: points.reduce((gain, p, i) => gain + Math.max(0, points[(i + 1) % points.length].y - p.y), 0),
    heightAt, terrainAt, surfaceAt, riverAt, nearest: (x, z) => nearestRoad(x, z), sample };
}
