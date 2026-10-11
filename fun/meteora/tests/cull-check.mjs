// Run with: node tests/cull-check.mjs
// The belt is drawn from per-frame visible lists; this pins that the lists
// hold exactly the rocks a camera can see, at the right level of detail.
import { test, run, assert } from './harness.mjs';
import { createCuller } from '../js/cull.js';
import { createField } from '../js/field.js';
import { FIELD } from '../js/config.js';

const field = createField(1234);
const b = field.belt;
const SQ = Math.SQRT1_2;
// A 90° frustum at `eye` looking down −Z: inside when n·p + d ≥ −r for all planes.
const frustum = eye => [
  [0, 0, -1, eye[2] - 0.5], [0, 0, 1, 60000 - eye[2]],
  [SQ, 0, -SQ, -(SQ * eye[0] - SQ * eye[2])], [-SQ, 0, -SQ, -(-SQ * eye[0] - SQ * eye[2])],
  [0, -SQ, -SQ, -(-SQ * eye[1] - SQ * eye[2])], [0, SQ, -SQ, -(SQ * eye[1] - SQ * eye[2])],
].flat();
const MARGIN = 1.15, LOD = 2000;

function brute(eye, planes, alive) {
  const near = new Set(), far = new Set();
  for (let i = 0; i < b.count; i++) {
    if (!alive[i]) continue;
    const p = [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]], r = b.radius[i] * MARGIN;
    const d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    if (d - r > FIELD.types[b.type[i]].draw) continue;
    let inside = true;
    for (let k = 0; k < 6 && inside; k++) {
      if (planes[4 * k] * p[0] + planes[4 * k + 1] * p[1] + planes[4 * k + 2] * p[2] + planes[4 * k + 3] < -r) inside = false;
    }
    if (inside) (d > LOD ? far : near).add(i);
  }
  return { near, far };
}
function collect(culler, eye, alive) {
  const out = culler.cull(frustum(eye), eye, alive);
  const near = new Set(), far = new Set();
  out.forEach((lists, type) => {
    for (let k = 0; k < lists.near.count; k++) { assert.equal(b.type[lists.near.index[k]], type); near.add(lists.near.index[k]); }
    for (let k = 0; k < lists.far.count; k++) { assert.equal(b.type[lists.far.index[k]], type); far.add(lists.far.index[k]); }
  });
  return { near, far };
}

const culler = createCuller(b, FIELD, { lodDistance: LOD, margin: MARGIN });
for (const eye of [[0, 0, 0], [2500, 300, 1800], [-3800, -600, 3900], [0, 0, 9000]]) {
  test(`the visible lists match brute force from ${eye.join(', ')}`, () => {
    const got = collect(culler, eye, field.alive), want = brute(eye, frustum(eye), field.alive);
    assert.deepEqual([...got.near].sort((x, y) => x - y), [...want.near].sort((x, y) => x - y));
    assert.deepEqual([...got.far].sort((x, y) => x - y), [...want.far].sort((x, y) => x - y));
  });
}
test('destroyed rocks are not drawn', () => {
  const alive = field.alive.slice();
  const eye = [0, 0, 0];
  const seen = collect(culler, eye, alive);
  const victim = [...seen.near][0];
  alive[victim] = 0;
  const after = collect(culler, eye, alive);
  assert.ok(!after.near.has(victim) && !after.far.has(victim));
  assert.equal(after.near.size, seen.near.size - 1);
});
test('small rocks are not drawn past their draw distance', () => {
  const { far } = collect(culler, [0, 0, 0], field.alive);
  for (const i of far) assert.ok(b.type[i] >= 1 || false, 'no 1.5 m rock beyond 2 km');
});
test('culling the whole belt is quick', () => {
  const t0 = performance.now();
  for (let k = 0; k < 60; k++) collect(culler, [k * 10, 0, 0], field.alive);
  const ms = (performance.now() - t0) / 60;
  assert.ok(ms < 4, `${ms.toFixed(2)} ms per cull`);
});
await run();
