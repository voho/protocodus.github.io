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
const MARGIN = 1.15;
// Each size gives up its near mesh, then its far mesh, at its own number of
// radii; the near mesh is capped for ordinary rocks; landmarks never coarsen.
const lodDistance = i => (b.landmark[i] ? Infinity : Math.min(b.radius[i] * FIELD.types[b.type[i]].lod[0], FIELD.lodCap));
const speckDistance = i => (b.landmark[i] ? Infinity : b.radius[i] * FIELD.types[b.type[i]].lod[1]);

function brute(eye, planes, alive) {
  const near = new Set(), far = new Set(), speck = new Set();
  for (let i = 0; i < b.count; i++) {
    if (!alive[i]) continue;
    const p = [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]], r = b.radius[i] * MARGIN;
    const d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    if (d - r > FIELD.types[b.type[i]].draw) continue;
    let inside = true;
    for (let k = 0; k < 6 && inside; k++) {
      if (planes[4 * k] * p[0] + planes[4 * k + 1] * p[1] + planes[4 * k + 2] * p[2] + planes[4 * k + 3] < -r) inside = false;
    }
    if (inside) (d > speckDistance(i) ? speck : d > lodDistance(i) ? far : near).add(i);
  }
  return { near, far, speck };
}
function collect(culler, eye, alive, detail) {
  const out = culler.cull(frustum(eye), eye, alive, detail);
  const sets = { near: new Set(), far: new Set(), speck: new Set() };
  out.forEach((lists, type) => {
    for (const [name, set] of Object.entries(sets)) {
      for (let k = 0; k < lists[name].count; k++) { assert.equal(b.type[lists[name].index[k]], type); set.add(lists[name].index[k]); }
    }
  });
  return sets;
}

const culler = createCuller(b, FIELD, { margin: MARGIN });
for (const eye of [[0, 0, 0], [2500, 300, 1800], [-3800, -600, 3900], [0, 0, 9000]]) {
  test(`the visible lists match brute force from ${eye.join(', ')}`, () => {
    const got = collect(culler, eye, field.alive), want = brute(eye, frustum(eye), field.alive);
    assert.deepEqual([...got.near].sort((x, y) => x - y), [...want.near].sort((x, y) => x - y));
    assert.deepEqual([...got.far].sort((x, y) => x - y), [...want.far].sort((x, y) => x - y));
    assert.deepEqual([...got.speck].sort((x, y) => x - y), [...want.speck].sort((x, y) => x - y));
  });
}
test('destroyed rocks are not drawn', () => {
  const alive = field.alive.slice();
  const eye = [0, 0, 0];
  const seen = collect(culler, eye, alive);
  const victim = [...seen.near][0];
  alive[victim] = 0;
  const after = collect(culler, eye, alive);
  assert.ok(!after.near.has(victim) && !after.far.has(victim) && !after.speck.has(victim));
  assert.equal(after.near.size, seen.near.size - 1);
});
test('rocks switch to the far mesh by size, capped, and landmarks never do', () => {
  const eye = [0, 0, 0];
  const { near, far, speck } = collect(culler, eye, field.alive);
  const d = i => Math.hypot(b.pos[3 * i] - eye[0], b.pos[3 * i + 1] - eye[1], b.pos[3 * i + 2] - eye[2]);
  for (const i of near) assert.ok(d(i) <= lodDistance(i) + 1e-6);
  for (const i of far) assert.ok(d(i) > lodDistance(i) && d(i) <= speckDistance(i) + 1e-6);
  for (const i of speck) assert.ok(d(i) > speckDistance(i) && !b.landmark[i]);
  assert.ok(speck.size > far.size, 'most of what is in view is a few pixels across');
  assert.ok([...far].some(i => b.type[i] === 0 && d(i) < 1000), 'pebbles go coarse close in');
  for (const i of far) assert.ok(!b.landmark[i], 'a landmark never coarsens');
  for (const i of near) assert.ok(b.landmark[i] || d(i) <= FIELD.lodCap + 1e-6, 'no ordinary rock keeps full detail past the cap');
});
test('a sharper picture keeps its detail further out', () => {
  const eye = [0, 0, 0];
  const plain = collect(culler, eye, field.alive), sharp = collect(culler, eye, field.alive, 2);
  assert.ok(sharp.near.size > plain.near.size && sharp.speck.size < plain.speck.size);
  assert.equal(sharp.near.size + sharp.far.size + sharp.speck.size, plain.near.size + plain.far.size + plain.speck.size);
});
test('each draw list runs near to far by cell, so the depth test rejects hidden rocks early', () => {
  const eye = [300, 100, 200];
  const out = culler.cull(frustum(eye), eye, field.alive);
  for (const lists of out) {
    for (const list of [lists.near, lists.far, lists.speck]) {
      let previous = -Infinity;
      for (let k = 0; k < list.count; k++) {
        const c = culler.cellCenter(culler.cellOf[list.index[k]]);
        const dc = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
        assert.ok(dc >= previous - 1e-6, 'cells out of order');
        previous = dc;
      }
    }
  }
});
test('culling the whole belt is quick', () => {
  const t0 = performance.now();
  for (let k = 0; k < 60; k++) collect(culler, [k * 10, 0, 0], field.alive);
  const ms = (performance.now() - t0) / 60;
  assert.ok(ms < 4, `${ms.toFixed(2)} ms per cull`);
});
await run();
