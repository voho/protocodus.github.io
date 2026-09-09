import assert from 'node:assert/strict';
import { generateTrack, createRandom, ENVIRONMENTS } from '../js/track.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pathLength = points => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
const side = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
const crosses = (a, b, c, d) => side(a, b, c) * side(a, b, d) < -1e-7 && side(c, d, a) * side(c, d, b) < -1e-7;
const segments = track => [
  ...track.points.map((point, i) => [point, track.points[(i + 1) % track.points.length]]),
  ...track.routes.flatMap(route => route.points.slice(1).map((point, i) => [route.points[i], point])),
];
const bruteDistance = (edges, x, z) => {
  let nearest = Infinity;
  for (const [a, b] of edges) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return nearest;
};
const snapshot = track => JSON.stringify({ hash: track.hash, environment: track.environment, points: track.points,
  routes: track.routes, boosts: track.boosts, decorations: track.decorations, name: track.name, river: track.river,
  surfaceSections: track.surfaceSections, elevationGain: track.elevationGain,
  terrain: Array.from({ length: 32 }, (_, i) => ({ height: track.heightAt(i * 13 - 210, i * 7 - 140), ...track.terrainAt(i * 13 - 210, i * 7 - 140) })) });

const deterministic = generateTrack('RAZER-DET-104');
assert.equal(snapshot(deterministic), snapshot(generateTrack('RAZER-DET-104')), 'the seed must reproduce roads, boosts, props, and theme');
assert.notEqual(snapshot(deterministic), snapshot(generateTrack('RAZER-DET-105')), 'different seeds must produce different worlds');
const firstRandom = createRandom('same'), secondRandom = createRandom('same');
for (let i = 0; i < 20; i++) assert.equal(firstRandom(), secondRandom());
assert.deepEqual(Object.keys(ENVIRONMENTS).sort(), ['beach', 'desert', 'jungle', 'mountains']);

let checked = 0;
const started = performance.now();
for (const environment of Object.keys(ENVIRONMENTS)) {
  for (let seed = 0; seed < 12; seed++) {
    const track = generateTrack(`QA-${seed}`, environment);
    const context = `${environment}/QA-${seed}`;
    assert.equal(track.environment, environment);
    assert.equal(track.points.length, 512);
    assert.equal(track.routes.length, 2, `${context}: both alternate roads must exist`);
    assert.ok(track.length > 700 && track.length < 1100, `${context}: playable circuit scale`);
    assert.equal(track.width, 12);
    const measured = pathLength([...track.points, track.points[0]]);
    assert.ok(Math.abs(measured - track.length) < 1e-8);
    const heights = track.points.map(p => p.y);
    assert.ok(Math.max(...heights) - Math.min(...heights) > 10, `${context}: the road has substantial climbs and descents`);
    const elevationGain = track.points.reduce((sum, p, i) => sum + Math.max(0, track.points[(i + 1) % track.points.length].y - p.y), 0);
    assert.ok(Math.abs(elevationGain - track.elevationGain) < 1e-9, `${context}: UI elevation gain reflects the road`);
    const mainSurfaces = new Set(track.points.map(p => track.surfaceAt(p.progress)));
    for (const surface of ['asphalt', 'gravel', 'dirt']) assert.ok(mainSurfaces.has(surface), `${context}: a lap includes ${surface}`);
    if (environment === 'beach' || environment === 'desert') assert.ok(mainSurfaces.has('sand'), `${context}: sandy tracks include a sand section`);
    for (const section of track.surfaceSections) assert.ok((section.end - section.start) * track.length > 60, `${context}: surface sections last long enough to drive`);
    assert.equal(track.surfaceAt(-0.1), track.surfaceAt(0.9));
    assert.equal(track.surfaceAt(2.1), track.surfaceAt(0.1));
    const edges = segments(track);
    // The visible shoulder continues 2.35m past the asphalt edge. Physics must
    // keep that entire ribbon on the road plane, including beside carved rivers.
    for (const path of [track.points, ...track.routes.map(route => route.points)]) {
      for (let i = 0; i < path.length - 1; i += 16) {
        const p = path[i], next = path[i + 1];
        const dx = next.x - p.x, dz = next.z - p.z, horizontal = Math.hypot(dx, dz);
        for (const side of [-1, 1]) for (const offset of [track.width / 2 + 0.2, track.width / 2 + 1.4, track.width / 2 + 2.35]) {
          const x = p.x + side * dz / horizontal * offset, z = p.z - side * dx / horizontal * offset;
          const nearest = track.nearest(x, z);
          assert.ok(Math.abs(track.heightAt(x, z) - nearest.y) < 1e-7,
            `${context}: the full visible shoulder stays level with its nearest road`);
        }
      }
    }
    for (let i = 0; i < track.points.length; i++) {
      const p = track.points[i];
      assert.ok(Number.isFinite(p.x + p.y + p.z));
      assert.ok(Math.abs(track.heightAt(p.x, p.z) - p.y) < 1e-7, `${context}: terrain conforms to road`);
      if (i > 0) assert.ok(p.progress > track.points[i - 1].progress);
      const q = track.points[(i + 1) % track.points.length];
      assert.ok(Math.abs(q.y - p.y) / Math.hypot(q.x - p.x, q.z - p.z) <= 0.171, `${context}: no undrivable road grades`);
      for (let j = i + 2; j < track.points.length; j++) {
        if (i === 0 && j === track.points.length - 1) continue;
        assert.ok(!crosses(p, q, track.points[j], track.points[(j + 1) % track.points.length]), `${context}: main road cannot cross itself`);
      }
    }
    assert.ok(distance(track.sample(-0.1), track.sample(0.9)) < 1e-8, 'main sample wraps backwards');
    assert.ok(distance(track.sample(3.1), track.sample(0.1)) < 1e-8, 'main sample wraps forwards');
    for (const route of track.routes) {
      assert.ok(route.start > 0 && route.end < 1 && route.start < route.end);
      assert.ok(Math.abs(pathLength(route.points) - route.mainLength) / route.mainLength < 0.005, `${context}: alternate route length is fair`);
      assert.ok(Math.abs(route.mainLength - (route.end - route.start) * track.length) < 1e-8);
      assert.ok(distance(route.points[0], track.sample(route.start)) < 1e-8, `${context}: route entry joins the circuit`);
      assert.ok(distance(route.points.at(-1), track.sample(route.end)) < 1e-8, `${context}: route exit joins the circuit`);
      assert.ok(distance(track.sample(-1, route.id), route.points[0]) < 1e-8, 'alternate sample clamps to entry');
      assert.ok(distance(track.sample(2, route.id), route.points.at(-1)) < 1e-8, 'alternate sample clamps to exit');
      const surfaceDifference = route.points.filter(p => track.surfaceAt(p.progress, route.id) !== track.surfaceAt(p.progress)).length / route.points.length;
      assert.ok(surfaceDifference * route.length > 40, `${context}: alternate surface changes the driving experience`);
      const middle = route.points[Math.floor(route.points.length / 2)];
      const mainEdges = track.points.map((p, i) => [p, track.points[(i + 1) % track.points.length]]);
      assert.ok(bruteDistance(mainEdges, middle.x, middle.z) > track.width * 1.5, `${context}: alternate middle must be a distinct road`);
      for (let i = 0; i < route.points.length; i++) {
        const p = route.points[i];
        assert.ok(Math.abs(track.heightAt(p.x, p.z) - p.y) < 1e-7, `${context}: terrain also conforms to alternate roads`);
        if (i > 0) assert.ok(p.progress > route.points[i - 1].progress);
        if (i === route.points.length - 1) continue;
        const next = route.points[i + 1];
        assert.ok(Math.abs(next.y - p.y) / Math.hypot(next.x - p.x, next.z - p.z) <= 0.221, `${context}: alternate grades stay driveable`);
        if (i > 0) {
          const previous = route.points[i - 1];
          const ax = p.x - previous.x, az = p.z - previous.z, bx = next.x - p.x, bz = next.z - p.z;
          const aLength = Math.hypot(ax, az), bLength = Math.hypot(bx, bz);
          const headingChange = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (aLength * bLength))));
          assert.ok((aLength + bLength) / (2 * headingChange) > 17.9, `${context}: alternate turns leave room for a rally car`);
        }
        for (const [a, b] of mainEdges) assert.ok(!crosses(p, route.points[i + 1], a, b), `${context}: alternate road cannot cross main road`);
        for (let j = i + 2; j < route.points.length - 1; j++) assert.ok(!crosses(p, route.points[i + 1], route.points[j], route.points[j + 1]));
      }
    }
    assert.ok(track.river.points.length > 80, `${context}: a winding river is precomputed`);
    const riverEdges = track.river.points.slice(1).map((p, i) => [track.river.points[i], p]);
    for (const [a, b] of riverEdges) {
      for (let step = 0; step < 4; step++) {
        const t = step / 4, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const width = a.width + (b.width - a.width) * t;
        assert.ok(bruteDistance(edges, x, z) > track.width / 2 + width / 2 + 8, `${context}: river and visible banks clear every road`);
        assert.ok(track.heightAt(x, z) < track.river.waterLevel - 0.8, `${context}: river water covers its carved bed`);
        assert.equal(a.y, track.river.waterLevel, `${context}: water lies on one level`);
      }
      for (const [c, d] of edges) assert.ok(!crosses(a, b, c, d), `${context}: river has no unbridged road crossing`);
    }
    const riverfront = track.points.filter(p => bruteDistance(riverEdges, p.x, p.z) < 52).length / track.points.length;
    assert.ok(riverfront > 0.15, `${context}: a meaningful section of the lap follows the river`);
    const landscape = [];
    for (let x = track.bounds.minX + 6; x < track.bounds.maxX; x += 19) {
      for (let z = track.bounds.minZ + 6; z < track.bounds.maxZ; z += 19) {
        const terrain = track.terrainAt(x, z);
        assert.ok(['grass', 'dirt', 'sand', 'rock'].includes(terrain.surface));
        assert.ok(terrain.forest >= 0 && terrain.forest <= 1);
        assert.ok(terrain.moisture >= 0 && terrain.moisture <= 1);
        landscape.push({ ...terrain, height: track.heightAt(x, z) });
      }
    }
    const terrainHeights = landscape.map(p => p.height);
    assert.ok(Math.max(...terrainHeights) - Math.min(...terrainHeights) > (environment === 'mountains' ? 60 : 25), `${context}: hills shape the surrounding landscape`);
    assert.ok(landscape.filter(p => p.forest < 0.08).length > landscape.length * 0.3, `${context}: connected clearings remain between forests`);
    if (environment !== 'desert') {
      const trees = track.decorations.filter(p => p.type === 'tree' || p.type === 'palm');
      assert.ok(trees.length > 35, `${context}: forest patches contain trees`);
      const treeForest = trees.reduce((sum, p) => sum + track.terrainAt(p.x, p.z).forest, 0) / trees.length;
      const worldForest = landscape.reduce((sum, p) => sum + p.forest, 0) / landscape.length;
      assert.ok(treeForest > worldForest + 0.15, `${context}: trees cluster in forests rather than scatter uniformly`);
    }
    const probes = createRandom(`nearest-${seed}`);
    for (let i = 0; i < 35; i++) {
      const x = (probes() - 0.5) * 900, z = (probes() - 0.5) * 900;
      const nearest = track.nearest(x, z);
      assert.ok(Math.abs(nearest.distance - bruteDistance(edges, x, z)) < 1e-7, `${context}: spatial search agrees with exhaustive segment projection`);
      assert.ok(Math.abs(Math.hypot(nearest.tangent.x, nearest.tangent.z) - 1) < 1e-10);
      assert.ok(nearest.progress >= 0 && nearest.progress < 1);
    }
    assert.ok(track.boosts.length >= 7);
    for (const boost of track.boosts) {
      assert.ok(track.nearest(boost.x, boost.z).distance < 1e-8, 'boosts must be on a drivable road');
      assert.ok(distance(boost, track.sample(boost.progress, boost.routeId)) < 1e-8);
    }
    assert.ok(track.decorations.length > 500, `${context}: scenery is populated`);
    for (const prop of track.decorations) {
      const margin = track.width / 2 + Math.max(prop.radius, prop.type === 'shrub' ? prop.scale * 1.8 : 0) + 3;
      assert.ok(bruteDistance(edges, prop.x, prop.z) >= margin - 1e-8, `${context}: ${prop.type} obstructs the road`);
      assert.ok(prop.x > track.bounds.minX && prop.x < track.bounds.maxX && prop.z > track.bounds.minZ && prop.z < track.bounds.maxZ);
      assert.ok(Math.abs(track.heightAt(prop.x, prop.z) - prop.y) < 1e-8);
      const riverSample = track.riverAt(prop.x, prop.z);
      if (riverSample) {
        assert.ok(riverSample.distance >= riverSample.width / 2 + prop.radius + 1, `${context}: props clear the water edge`);
        assert.ok(prop.y >= riverSample.y + 0.4, `${context}: props never sit under river water`);
      }
      if (environment === 'beach') assert.ok(prop.y >= -0.1, `${context}: beach props remain above the ocean`);
    }
    checked++;
  }
}

// Fuzz the alternate-route solver across a wider seed range without repeating the
// expensive independent geometry oracle used above.
for (let seed = 0; seed < 300; seed++) {
  const track = generateTrack(`fuzz-${seed}`);
  assert.equal(track.routes.length, 2);
  for (const route of track.routes) assert.ok(Math.abs(route.length / route.mainLength - 1) < 0.005);
}
const terrainStart = performance.now();
for (let x = 0; x < 150; x++) for (let z = 0; z < 150; z++) {
  assert.ok(Number.isFinite(deterministic.heightAt(-230 + x * 3.1, -230 + z * 3.1)));
}
console.log(`Track checks passed: ${checked} full worlds, 300 fuzz seeds, four environments. Terrain 150×150: ${(performance.now() - terrainStart).toFixed(0)} ms. Total ${(performance.now() - started).toFixed(0)} ms.`);
