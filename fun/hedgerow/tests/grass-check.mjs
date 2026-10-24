// Run with: node fun/hedgerow/tests/grass-check.mjs
// Compare compacted cells against the original shader's visibility tests,
// including root jitter, terrain heights, camera pitch and quality changes.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const THREE = await import('three');
const { createGrassCells } = await import('../js/grass-cells.js');
const { createGrass } = await import('../js/grass.js');

const spacing = 0.22, minHeight = -8, maxHeight = 14;
const cells = createGrassCells(192, spacing, minHeight, maxHeight);
const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, 1700);
const view = new THREE.Vector3();
let checked = 0;
let seed = 17;
const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
const cases = [
  [192, 0, 1.62, 0, 0, 0, 68, 16 / 9],
  [128, -0.001, -2, -0.22, Math.PI, 0, 52, 9 / 16],
  [192, 0.21999, 25, 600.22001, Math.PI / 2, -1.5, 85, 2.4],
  [192, -400, -12, 650, -Math.PI / 2, 1.5, 55, 1],
  [0, 0, 1.62, 0, 0, 0, 68, 16 / 9],
];
for (let i = 0; i < 35; i++) cases.push([
  i % 2 ? 128 : 192, random() * 800 - 400, random() * 45 - 15, random() * 900 - 200,
  random() * Math.PI * 2, random() * 3 - 1.5, 52 + random() * 33, 0.6 + random() * 2,
]);
for (const [n, x, y, z, yaw, pitch, fov, aspect] of cases) {
  camera.position.set(x, y, z);
  camera.lookAt(x + Math.sin(yaw) * Math.cos(pitch), y + Math.sin(pitch), z + Math.cos(yaw) * Math.cos(pitch));
  camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const ox = Math.floor(x / spacing) - n / 2, oz = Math.floor(z / spacing) - n / 2;
  const count = cells.update(camera, n, ox, oz);
  const included = new Set(cells.cells.subarray(0, count));
  assert.equal(included.size, count, 'each grid cell submitted once');
  assert.ok([...included].every(id => id >= 0 && id < n * n), 'IDs remain in this quality preset\'s grid');
  const p = camera.projectionMatrix.elements;
  for (let id = 0; id < n * n; id++) {
    if (included.has(id)) continue;
    const cx = (ox + id % n + 0.5) * spacing, cz = (oz + Math.floor(id / n) + 0.5) * spacing;
    // Root offsets cover all corners of the hash's allowed cell jitter;
    // heights cover the texture extrema and a filtered value between them.
    for (const [jx, jz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7], [0, 0]]) {
      const rx = cx + jx * spacing, rz = cz + jz * spacing;
      for (const h of [minHeight, maxHeight, (minHeight + maxHeight) / 2]) {
        view.set(rx, h + 0.4, rz).applyMatrix4(camera.matrixWorldInverse);
        const front = Math.max(-view.z, 0);
        const seen = -view.z > -1.2
          && Math.abs(p[0] * view.x) - p[0] * 1.2 <= front
          && Math.abs(p[5] * view.y) - p[5] * 1.2 <= front;
        assert.ok(!seen, `visible cell ${id} omitted at n=${n}, yaw=${yaw}, pitch=${pitch}, height=${h}`);
        checked++;
      }
    }
  }
  cells.update(camera, n, ox, oz);
  assert.equal(cells.changed, false, 'stationary accepted cells need no upload');
}

// Exercise the actual grass integration, including half-float texture
// heights, stale camera matrices and switching high/medium/off/back on.
const data = new Uint16Array(4 * 4);
for (let i = 0; i < 4; i++) {
  data[i * 4] = THREE.DataUtils.toHalfFloat(1);
  data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(i % 2 ? maxHeight : minHeight);
}
const map = { tex: new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat, THREE.HalfFloatType), min: new THREE.Vector2(), size: new THREE.Vector2(100, 100) };
const grass = createGrass({ map, shared: { time: { value: 0 }, wet: { value: 1 } } });
const geometry = grass.mesh.geometry, attr = geometry.attributes.aCell;
camera.position.set(0, 1.62, 0); camera.lookAt(0, 1.62, 1); camera.fov = 68; camera.aspect = 16 / 9; camera.updateProjectionMatrix();
for (const n of [192, 128, 0, 192]) {
  grass.setCount(n);
  assert.equal(geometry.instanceCount, n * n, 'quality change is ready to render before a camera update');
  assert.ok(attr.array.subarray(0, geometry.instanceCount).every((id, i) => id === i), 'new quality starts with its complete grid');
  camera.position.x += 0.3;  // integration must refresh the view matrix
  grass.update(camera);
  assert.equal(grass.mesh.visible, n > 0);
  assert.equal(geometry.instanceCount, cells.update(camera, n, Math.floor(camera.position.x / spacing) - n / 2, -n / 2));
  assert.deepEqual(attr.array.subarray(0, geometry.instanceCount), cells.cells.subarray(0, geometry.instanceCount));
  const version = attr.version;
  grass.update(camera);
  assert.equal(attr.version, version, 'stationary grass does not upload its instance IDs');
}

// A forward view still submits one draw, with fewer vertices at the same
// density. Time changing views so this measures compaction, not a cache.
const n = 192, samples = [];
for (let run = 0; run < 7; run++) {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    camera.position.x = i * 0.01;
    camera.updateMatrixWorld();
    cells.update(camera, n, Math.floor(camera.position.x / spacing) - n / 2, -n / 2);
  }
  samples.push((performance.now() - start) / 1000);
}
samples.sort((a, b) => a - b);
const submitted = cells.update(camera, n, Math.floor(camera.position.x / spacing) - n / 2, -n / 2);
assert.ok(submitted < n * n * 0.5, 'forward view removes at least half of the submitted tufts');
console.log(`grass-check: ${checked} rejected-cell samples preserve shader visibility; ${submitted}/${n * n} tufts submitted (${(100 * (1 - submitted / (n * n))).toFixed(1)}% fewer), median ${samples[3].toFixed(3)} ms per changing view`);
