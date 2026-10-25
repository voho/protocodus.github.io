// Run with: node fun/hedgerow/tests/clutter-cells-check.mjs
// Procedural pieces stay inside conservative CPU bounds across views,
// terrain heights, root jitter and a pixel of temporal projection jitter.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const THREE = await import('three');
const { createClutterCells } = await import('../js/clutter-cells.js');
const { createClutter } = await import('../js/clutter.js');

const camera = new THREE.PerspectiveCamera(68, 16 / 9, .05, 1700);
const proj = new THREE.Matrix4(), pv = new THREE.Matrix4(), frustum = new THREE.Frustum();
const sphere = new THREE.Sphere(new THREE.Vector3(), .35);
let seed = 23, checked = 0;
const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
const cases = [
  [0, 1.62, 0, 0, 0, 68, 16 / 9],
  [-.001, .3, -.3, Math.PI, -.4, 52, 9 / 16],
  [31.9999, 20, -32.0001, Math.PI / 2, -1.5, 85, 2.4],
  [-400, -10, 650, -Math.PI / 2, 1.5, 55, 1],
];
for (let i = 0; i < 24; i++) cases.push([random() * 800 - 400, random() * 35 - 10, random() * 900 - 200,
  random() * Math.PI * 2, random() * 3 - 1.5, 52 + random() * 33, .6 + random() * 2]);
for (const [n, spacing] of [[60, .3], [45, .4]]) {
  const cells = createClutterCells(n, spacing, -2, 3);
  for (const [x, y, z, yaw, pitch, fov, aspect] of cases) {
    camera.position.set(x, y, z);
    camera.lookAt(x + Math.sin(yaw) * Math.cos(pitch), y + Math.sin(pitch), z + Math.cos(yaw) * Math.cos(pitch));
    camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const ox = Math.floor(x / spacing) - n / 2, oz = Math.floor(z / spacing) - n / 2;
    const count = cells.update(camera, ox, oz, 128, 96);
    const included = new Set(cells.cells.subarray(0, count));
    assert.equal(included.size, count, 'each grid cell occurs once');
    for (const [jx, jy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      proj.copy(camera.projectionMatrix);
      proj.elements[8] += jx * 2 / 128; proj.elements[9] += jy * 2 / 96;
      frustum.setFromProjectionMatrix(pv.multiplyMatrices(proj, camera.matrixWorldInverse));
      for (let id = 0; id < n * n; id++) {
        if (included.has(id)) continue;
        const cx = (ox + id % n + .5) * spacing, cz = (oz + Math.floor(id / n) + .5) * spacing;
        for (const [dx, dz] of [[-.45, -.45], [.45, -.45], [-.45, .45], [.45, .45], [0, 0]]) {
          for (const h of [-2, .5, 3]) {
            sphere.center.set(cx + dx * spacing, h, cz + dz * spacing);
            assert.ok(!frustum.intersectsSphere(sphere), `visible ${spacing} m cell ${id} omitted with view ${yaw}/${pitch}`);
            checked++;
          }
        }
      }
    }
    cells.update(camera, ox, oz, 128, 96);
    assert.equal(cells.changed, false, 'unchanged accepted IDs need no upload');
    assert.equal(cells.update(camera, ox, oz), n * n, 'missing viewport keeps the complete grid');
    assert.ok(cells.cells.every((id, i) => id === i));
  }
}

const heights = new Float32Array([-2, 3, -2, 3]);
const heightTex = new THREE.DataTexture(heights, 2, 2, THREE.RedFormat, THREE.FloatType);
const min = new THREE.Vector2(-32, -32);
const map = { tex: new THREE.DataTexture(new Uint16Array(16), 2, 2, THREE.RGBAFormat, THREE.HalfFloatType), min,
  size: new THREE.Vector2(64, 64), uniforms: { tHeight: { value: heightTex }, uMapMin: { value: min },
    uMapRes: { value: 64 }, uMapN: { value: new THREE.Vector2(2, 2) } } };
const clutter = createClutter({ map, shared: { wet: { value: 1 } } });
for (const mesh of clutter.group.children) {
  // Bound the maximum dimensions used by the vertex shader, including
  // its raised centre and the twig's kink, before any slope rotation.
  const p = mesh.geometry.attributes.position, bend = mesh.geometry.attributes.bend;
  for (let i = 0; i < p.count; i++) {
    const reach = bend
      ? Math.hypot(p.getX(i) * .6, Math.abs(p.getY(i)) * .015 + .0105, Math.abs(p.getZ(i)) * .0225 + bend.getX(i) * .6)
      : Math.hypot(p.getX(i) * .085, (Math.abs(p.getY(i)) + .2) * .085 * 1.15, p.getZ(i) * .085);
    assert.ok(reach < .35, `${mesh.name} fits the culler's conservative sphere`);
  }
}
camera.position.set(0, 1.62, 0); camera.lookAt(0, 1.62, 1); camera.fov = 68; camera.aspect = 16 / 9; camera.updateProjectionMatrix();
clutter.update(camera, 1280, 720); // also refreshes a stale camera matrix
const counts = clutter.group.children.map(m => m.geometry.instanceCount);
assert.ok(counts[0] < 1800 && counts[1] < 1013, 'forward view removes at least half the submitted pieces');
const versions = clutter.group.children.map(m => m.geometry.attributes.aCell.version);
clutter.update(camera, 1280, 720);
assert.deepEqual(clutter.group.children.map(m => m.geometry.attributes.aCell.version), versions);
clutter.setOn(false); clutter.update(camera, 1280, 720); assert.equal(clutter.group.visible, false);
clutter.setOn(true); camera.position.x = 20; clutter.update(camera, 1280, 720); assert.equal(clutter.group.visible, true);

const samples = [];
for (let run = 0; run < 7; run++) {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) { camera.position.x = i * .01; clutter.update(camera, 1280, 720); }
  samples.push((performance.now() - start) / 1000);
}
samples.sort((a, b) => a - b);
const submitted = clutter.group.children.reduce((sum, m) => sum + m.geometry.instanceCount, 0);
console.log(`clutter-cells-check: ${checked} rejected-cell sphere samples stay outside jittered views; ${submitted}/5625 pieces submitted (${(100 * (1 - submitted / 5625)).toFixed(1)}% fewer), median ${samples[3].toFixed(3)} ms per changing view`);
