// Warped bowls, water rings and cover masks must share one contour. The
// legacy hashes were sealed from the pre-contour implementation; they
// protect circular defaults without reproducing the new implementation.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import L from '../js/levels/saint-clair.js';
const THREE = await import('three');
const { createPonds } = await import('../js/ponds.js');
const { createGroundMap } = await import('../js/groundmap.js');
const digest = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

const circle = { x: 1.3, z: -7.1, r: 2.2, h: 1 };
const legacy = createPonds([circle], { height: (x, z) => ((x - circle.x) ** 2 + (z - circle.z) ** 2) * 0.2 }, {}, {});
const golden = {
  position: '5e65d6cae6438a645695f95a97d161175694563cb0b71d1cc363e32784655fcf',
  normal: '55cdae30bb9fd101466e85d81a025f0b0521cc777e524dd7a99b790d1d08bb87',
  uv: 'e3c2af35d1dfc500e16f826a071cc311bf55003a3de77de7ea3376c6b6fa2857',
};
for (const [key, hash] of Object.entries(golden)) assert.equal(digest(legacy.mesh.geometry.attributes[key].array), hash, `legacy circle ${key} bytes change`);
assert.equal(digest(legacy.mesh.geometry.index.array), 'd9685d6a6ddb66b00873221af08d3050fd89e4ad4fd50f0119f50fbfe3152e1c');
assert.deepEqual(legacy.list, [{ x: circle.x, z: circle.z, r: circle.r * 0.9, y: 0.42 }]);

// Same 0.5 m Float32 vertices/diagonal interpolation as terrain.js. These
// forest bowls are distant from building pads, so no collider world is
// needed to verify their actual water-edge geometry.
const cache = new Map(), res = 0.5, { minX, minZ } = L.bounds;
const grid = (i, j) => {
  const key = i + ',' + j;
  if (!cache.has(key)) cache.set(key, Math.fround(L.baseHeight(minX + i * res, minZ + j * res)));
  return cache.get(key);
};
const terrain = { height(x, z) {
  const gx = (x - minX) / res, gz = (z - minZ) / res, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const a = grid(i, j), b = grid(i + 1, j), c = grid(i, j + 1), d = grid(i + 1, j + 1);
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
} };
const ponds = createPonds(L.craters, terrain, {}, {});
let shaped = 0, negativeControl = false;
for (let n = 0; n < ponds.list.length; n++) {
  const p = ponds.list[n], crater = L.craters.find((c) => c.x === p.x && c.z === p.z);
  if (!crater.waterShape) continue;
  shaped++;
  const bounds = crater.waterShape.bounds();
  assert.ok(L.fine.some(([x0, z0, x1, z1]) => x0 <= bounds[0] && z0 <= bounds[1] && x1 >= bounds[2] && z1 >= bounds[3]), 'fine mesh covers the complete curved bowl');
  let wrong = Infinity, correct = Infinity;
  for (let i = 0; i < 360; i++) {
    const angle = i * Math.PI / 180, q = crater.waterShape.point(angle, 0.9);
    correct = Math.min(correct, terrain.height(...q) - p.y);
    wrong = Math.min(wrong, terrain.height(p.x + Math.cos(angle) * p.r, p.z + Math.sin(angle) * p.r) - p.y);
    assert.ok(q[0] >= p.bounds[0] - 1e-10 && q[0] <= p.bounds[2] + 1e-10 && q[1] >= p.bounds[1] - 1e-10 && q[1] <= p.bounds[3] + 1e-10);
  }
  assert.ok(correct >= 0, 'the conformed disc must reach the bank before its mesh ends');
  if (wrong < -0.025 && correct > 0.05) negativeControl = true;
  for (let i = 0; i < 20; i++) {
    const angle = i * Math.PI / 10, q = crater.waterShape.point(angle, 0.9), v = n * 21 + 1 + i, pos = ponds.mesh.geometry.attributes.position;
    assert.ok(Math.hypot(pos.getX(v) - q[0], pos.getZ(v) - q[1]) < 3e-5, 'the rendered ring follows the bowl, not a circle at the moved centre');
  }
}
assert.ok(shaped > 0 && negativeControl, 'the fixture must expose the original circular-disc clipping defect');

const N = 25, spacing = 0.25, origin = -3, H = new Float32Array(N * N), positions = new Float32Array(N * N * 3), splats = new Float32Array(N * N * 4);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i; positions[k * 3] = origin + i * spacing; positions[k * 3 + 2] = origin + j * spacing; splats[k * 4 + 1] = 1;
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('splat', new THREE.BufferAttribute(splats, 4));
const floor = { grid: { H, nx: N, nz: N, minX: origin, minZ: origin, res: spacing }, group: { children: [{ geometry, userData: {} }] } };
const simple = { x: 0, z: 0, r: 1, y: 0.2 }, emptyWorld = { colliders: [] };
const oldMask = createGroundMap(floor, emptyWorld, -100, [simple]);
assert.equal(digest(oldMask.tex.image.data), '30b00a9619cb89bb5659b73cbb0cb9ed62227298655e572f312bf224138dbc0a', 'legacy circle cover-mask bytes change');
const curvedMask = createGroundMap(floor, emptyWorld, -100, [{ ...simple, bounds: [-1.75, -1, 1.75, 1], contains: (x, z) => Math.hypot(x - 0.75 * z, z) <= 1 }]);
const grass = (map, x, z) => THREE.DataUtils.fromHalfFloat(map.tex.image.data[(Math.round((z - origin) / spacing) * N + Math.round((x - origin) / spacing)) * 4]);
assert.equal(grass(curvedMask, 1, 0.5), 0, 'wet contour outside the old circle must lose its grass'); assert.equal(grass(oldMask, 1, 0.5), 1);
assert.equal(grass(curvedMask, -0.75, 0.5), 1, 'dry ground outside the contour must retain its cover'); assert.equal(grass(oldMask, -0.75, 0.5), 0);
console.log(`pond-contours-check: ${shaped} conformed crater rings/bounds, real master-grid clipping negative control, circular geometry/mask byte identity and wet/dry cover controls pass`);
