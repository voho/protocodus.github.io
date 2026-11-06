// Broad natural corridors must stay smooth and genuinely curved while
// keeping authored lane-side offsets and district connections coherent.
import assert from 'node:assert/strict';
import { corridorFrame, corridorRemap, sunkenLane } from '../js/levels/natural.js';
import L from '../js/levels/saint-clair.js';

const line = L.lines.LANE, frame = corridorFrame(line);
const playable = line.filter(([, z]) => z >= -24 && z <= 84);
const sweep = Math.max(...playable.map((p) => p[0])) - Math.min(...playable.map((p) => p[0]));
assert.ok(sweep > 18, `the first lane has become a straight corridor again (${sweep} m sweep)`);
let curvature = 0;
for (let i = 1; i < line.length - 1; i++) {
  if (line[i][1] < -24 || line[i][1] > 84) continue;
  const a = [line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]];
  const b = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]];
  const al = Math.hypot(...a), bl = Math.hypot(...b);
  const angle = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (al * bl))));
  curvature = Math.max(curvature, angle / ((al + bl) / 2));
}
assert.ok(1 / curvature > 12, `the lane contains a tight hook (${1 / curvature} m turn radius)`);
const atStart = frame.atZ(L.start[1]);
assert.ok(Math.abs(atStart.x - L.start[0]) < 0.2);
assert.ok(Math.abs(atStart.yaw - L.start[2]) < 0.02, 'the initial view follows the first bend');
assert.deepEqual(L.introRemap.point(0, 95), [0, 95], 'the village gate district stays fixed');
assert.equal(L.props.find((p) => p.id === 'nest_gate').x, -6.5);
assert.equal(L.props.find((p) => p.m === 'barrier').z, 86.5);

for (let z = -24; z <= 110; z += 1.3) for (let x = -40; x <= 40; x += 5.7) {
  const p = L.introRemap.point(x, z), q = L.introRemap.inverse(...p);
  assert.ok(Math.abs(q[0] - x) < 1e-10 && q[1] === z, 'lane-side coordinate remap cannot fold or lose a field point');
}
const trivial = corridorRemap([[0, 0], [0, 100]], [[0, 0], [10, 25], [-10, 75], [0, 100]], { minZ: 0, maxZ: 100 });
assert.deepEqual(trivial.point(3, 25), [13, 25]);
assert.deepEqual(trivial.point(3, 100), [3, 100]);
const outsideGoals = trivial.line([[0, 75], [0, 100], [20, 120]], 2);
assert.equal(outsideGoals.filter(([, z]) => z > 100 && z < 120).length, 0, 'identity districts retain their old walking goals');

const lane = sunkenLane([[0, -30], [0, 130]]);
const left = lane.profile(35, 1), right = lane.profile(35, -1), later = lane.profile(90, 1);
assert.ok(Math.abs(left.shoulder - right.shoulder) > 0.3 && Math.abs(left.rise - right.rise) > 0.1, 'banks are not identical parallel walls');
assert.ok(Math.abs(left.crest - later.crest) > 0.25, 'bank crowns vary gradually along the lane');
for (let z = -20; z < 78; z += 1) {
  const a = frame.atZ(z), b = frame.atZ(z + 1), ah = L.baseHeight(a.x, z), bh = L.baseHeight(b.x, z + 1);
  assert.ok(Number.isFinite(ah) && Number.isFinite(bh));
  assert.ok(Math.abs(ah - bh) < 0.2, `the walking floor has a new ridge/step at z=${z}`);
}
for (const side of [-1, 1]) {
  let previous = lane.cut(2, 0, 35, () => 0.85);
  for (let d = 0.25; d <= 11; d += 0.25) {
    const h = lane.cut(2, d * side, 35, () => 0.85);
    assert.ok(Number.isFinite(h) && h > 0.8 && h < 2.8);
    assert.ok(Math.abs(h - previous) < 0.3, 'rounded shoulders do not create a hard cross-section edge');
    previous = h;
  }
}
console.log(`natural-terrain-check: ${sweep.toFixed(1)} m intro sweep, ${(1 / curvature).toFixed(1)} m minimum bend radius, reversible authored offsets and rounded asymmetric shoulders pass`);
