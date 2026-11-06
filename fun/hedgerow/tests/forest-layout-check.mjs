// A terrain remap must carry mission anchors and patrol routes with it while
// preserving the already accepted introduction, trench and radio core.
import assert from 'node:assert/strict';
import L from '../js/levels/saint-clair.js';
import { forestRemap as map, clearingEdge } from '../js/levels/forest-layout.js';

for (const [a, b] of map.bends) {
  for (const z of [a, b]) {
    assert.equal(map.offset(z), 0); assert.equal(map.slope(z), 0);
    assert.ok(Math.abs(map.offset(z - 1e-4) - map.offset(z + 1e-4)) < 1e-7, 'district seams have no positional step');
    assert.ok(Math.abs(map.slope(z - 1e-4) - map.slope(z + 1e-4)) < 1e-5, 'district seams have no tangent kink');
  }
}
for (let z = 280; z < 550; z += 0.7) for (const x of [-40, -10, 0, 25, 40]) {
  const p = map.point(x, z), q = map.inverse(...p);
  assert.ok(Math.abs(q[0] - x) < 1e-12 && q[1] === z, 'the broad bend remains invertible across the playable field');
}
for (const z of [-6, 38, 84, 270, 392, 398, 400, 404, 484, 496, 508, 509, 511, 527, 549]) {
  assert.equal(map.offset(z), 0, 'intro, river, trench, clearing core and rally anchors stay fixed');
  assert.equal(map.yaw(173, z), 173);
}
const fixed = { radio: [-10, 509], flak: [4, 511], nest_trench: [2, 392] };
for (const [id, at] of Object.entries(fixed)) {
  const p = L.props.find((p) => p.id === id); assert.deepEqual([p.x, p.z], at);
}
const bunker = L.props.find((p) => p.id === 'bunker');
assert.deepEqual([bunker.x, bunker.z], map.point(9, 446));
assert.equal(bunker.yaw, map.yaw(180, 446));
assert.equal(L.enemies.find((e) => e.bunker === 'bunker').yaw, bunker.yaw, 'anchored crew facing follows its moved emplacement rather than placeholderat[0,0]');
const grenades = L.pickups.find((p) => p.type === 'grenades' && p.z === 362);
assert.deepEqual([grenades.x, grenades.z], map.point(-9, 362), 'the forest grenade bundle uses its clear track-side placement');
assert.equal(L.objectives.length, 8);
assert.equal(L.objectives.find((o) => o.id === 'radio').duration, 3);
assert.deepEqual(L.lines.LANE, map.line(L.lines.LANE), 'the first-scene geometry is untouched');
const bridgeLeg = [[-12, 296], [11, 297]];
assert.deepEqual(map.line(bridgeLeg, 5), bridgeLeg.map((p) => map.point(...p)), 'the shallow bridge leg retains its two original clear goals');
assert.equal(L.enemies.find((e) => e.group === 'bridge' && e.patrol).patrol.length, 2);
for (const e of L.enemies.filter((e) => e.group === 'track' && e.patrol)) assert.equal(e.patrol.length, 4, 'forest patrols keep their authored navigation goals');
assert.equal(L.enemies.find((e) => e.group === 'bunker' && e.patrol).patrol.length, 4, 'the bunker patrol routes around cover instead of receiving extra goals inside it');
const broad = map.line([[0, 280], [0, 550]], 3);
assert.ok(broad.length > 20 && Math.min(...broad.map(([x]) => x)) < -9.9 && Math.max(...broad.map(([x]) => x)) > 11.9, 'bend extrema force sampling even when the original endpoints lie outside both districts');
const xs = L.lines.TRACK.map(([x]) => x);
assert.ok(Math.max(...xs) - Math.min(...xs) > 28, 'the forest road spans almost twice its original lateral range');
let minRadius = Infinity;
for (let i = 1; i < L.lines.TRACK.length - 1; i++) {
  const a = L.lines.TRACK[i - 1], b = L.lines.TRACK[i], c = L.lines.TRACK[i + 1];
  const ab = Math.hypot(a[0] - b[0], a[1] - b[1]), bc = Math.hypot(b[0] - c[0], b[1] - c[1]), ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (area2 > 1e-8) minRadius = Math.min(minRadius, ab * bc * ca / (2 * area2));
}
assert.ok(minRadius > 14, 'a winding route must not become a tight turning trap');
const edge = clearingEdge(); let min = Infinity, max = 0, minSlope = Infinity;
for (let angle = 0; angle < Math.PI * 2; angle += 0.02) {
  min = Math.min(min, edge.radius(angle)); max = Math.max(max, edge.radius(angle));
  for (let r = 0; r <= 24; r += 2) {
    const x = r * Math.cos(angle), z = 508 + r * Math.sin(angle);
    assert.equal(edge.distance(x, z), Math.hypot(x, z - 508), 'all original combat-core ground calculations remain unchanged');
  }
  for (let r = 24.1; r < 42; r += 0.4) {
    const h = 1e-4, p = edge.distance((r - h) * Math.cos(angle), 508 + (r - h) * Math.sin(angle));
    const q = edge.distance((r + h) * Math.cos(angle), 508 + (r + h) * Math.sin(angle));
    minSlope = Math.min(minSlope, (q - p) / (2 * h));
  }
}
assert.ok(min > 24 && max - min > 4, 'the tree edge opens into unequal lobes outside the fixed core');
assert.ok(minSlope > 0.45, 'the outer shoulder mapping cannot fold back into a ring or ridge');
console.log(`forest-layout-check: broad invertible bends, ${minRadius.toFixed(1)} m minimum turn radius, fixed8-phase/core anchors and ${min.toFixed(1)}–${max.toFixed(1)} m lobed edge pass`);
