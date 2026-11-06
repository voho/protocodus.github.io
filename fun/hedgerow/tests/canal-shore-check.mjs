// The canal stays engineered and the bridge mouth stays unchanged. The
// marsh approaches gain rounded, unequal shoulders; stone faces cover the
// retained banks instead of allowing soil to project through them.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { smoothstep, lerp, polylineDistance } from '../js/util.js';
import { canalBankCut, causewayShoulders } from '../js/levels/canal-ground.js';
const THREE = await import('three');
const { canalQuay } = await import('../js/canal-models.js');
const { default: L } = await import('../js/levels/pont-tournant.js');

for (const x of [-80, -55, -5.5, -3, 0, 3, 5.5, 55, 80]) for (let d = 0; d < 15; d += 0.1) {
  const z = 120 + d, expected = d < 13 ? lerp(2.2, -2.6, smoothstep(12.6, 11.2, Math.abs(z - 120))) : 2.2;
  assert.equal(canalBankCut(2.2, x, z), expected, 'the bridge mouth/outer reed banks must retain their original profile');
}
const line = [[0, -20], [0, 120]], shoulders = causewayShoulders(line), point = {};
let minWidth = Infinity, maxWidth = 0;
for (let z = 20; z < 80; z += 3) {
  for (const side of [-1, 1]) {
    polylineDistance(line, side * 6, z, point); const p = shoulders.profile(side * 6, z, point, 0);
    minWidth = Math.min(minWidth, p.shoulder); maxWidth = Math.max(maxWidth, p.shoulder);
    let previous = 0.6;
    for (let d = 0; d < 9.1; d += 0.05) {
      polylineDistance(line, side * d, z, point); const h = shoulders.cut(0, 0.6, side * d, z, point, 0);
      assert.ok(Number.isFinite(h) && Math.abs(h - previous) < 0.045, 'no angular shoulder step'); previous = h;
      if (d < 3) assert.equal(h, 0.6, 'the existing road floor remains intact');
    }
  }
}
assert.ok(maxWidth - minWidth > 1, 'shoulder width and side vary over broad distances');
polylineDistance(line, 5, 100, point); assert.ok(Math.abs(shoulders.cut(0.3, 1.2, 5, 100, point, 0) + 0.2) < 1e-12, 'the defensive bridge approach keeps its old ditch');
const corner = [[0, 0], [0, 20], [20, 20]], bent = causewayShoulders(corner), values = [];
for (const x of [-1e-5, 0, 1e-5]) { polylineDistance(corner, x, 26, point); values.push(bent.cut(0, 0.6, x, 26, point, 0)); }
assert.ok(Math.max(...values) - Math.min(...values) < 1e-4, 'exact vertex side selection cannot spike');

const model = canalQuay(); let triangles = 0;
for (const p of model.prims) {
  triangles += p.geometry.attributes.position.count / 3;
  for (const key of ['position', 'normal', 'uv', 'color']) for (const v of p.geometry.attributes[key].array) assert.ok(Number.isFinite(v));
}
assert.equal(model.prims.length, 2); assert.ok(triangles < 700); assert.equal(model.colliders.length, 3);
assert.deepEqual(model.prims.map((p) => p.key).sort(), ['stone_cut', 'stone_cut_dark'], 'quay courses use dressed-stone detail instead of an unrelated cobble pattern');
assert.ok(Math.abs(model.box.min.y + 4.6) < 1e-6 && Math.abs(model.box.max.y - 0.08) < 1e-6);
const meshes = model.prims.map((p) => new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial()));
for (const m of meshes) m.updateMatrixWorld(true);
const shot = new THREE.Raycaster(new THREE.Vector3(0.2, -1, 2), new THREE.Vector3(0, 0, -1), 0, 3).intersectObjects(meshes);
assert.ok(shot.length && Math.abs(shot[0].point.z - 0.2425) < 1e-4, 'the visible upper stone courses face the water');
assert.equal(new THREE.Raycaster(new THREE.Vector3(0.2, 0.5, 2), new THREE.Vector3(0, 0, -1), 0, 3).intersectObjects(meshes).length, 0, 'there is no hidden wall above the coping');

const quays = L.props.filter((p) => p.m === 'canal_quay'); assert.equal(quays.length, 44);
for (const p of quays) {
  assert.equal(p.y, 2); assert.equal(p.contact, false); assert.equal(p.y + model.anchors.waterline[1], L.water.level);
  const front = p.z + (p.yaw === 0 ? 0.2425 : -0.2425);
  for (const dx of [-1.99, -1, 0, 1, 1.99]) assert.ok(L.baseHeight(p.x + dx, front) < 0, 'retained soil must be behind the whole visible masonry face, including abutment/end tiles');
}
assert.ok(L.fine.some(([x0, z0, x1, z1]) => x0 <= -48 && x1 >= 48 && z0 <= 132 && z1 >= 134), 'the north shore must use the fine master cadence');
// Use the actual north-bank chunk origin/cadence to reproduce the former
// rendered-vs-collision mismatch. No full world or GPU is required.
const { createTerrain } = await import('../js/terrain.js');
const previousScheduler = globalThis.scheduler; globalThis.scheduler = { yield: async () => {} };
let oldError = 0, newError = 0;
try {
  const made = [];
  for (const fine of [[[-40, 84, 40, 104]], L.fine]) made.push(await createTerrain({ bounds: { minX: -14, maxX: 18, minZ: 110, maxZ: 142 }, height: L.baseHeight, splat: L.splat, fine }, {}, { wet: { value: 0 }, rain: { value: 0 }, time: { value: 0 } }));
  function drawn(t, x, z) {
    const p = t.group.children[0].userData.fine.attributes.position; let cols = 0;
    while (p.getZ(cols) === p.getZ(0)) cols++;
    const spacing = p.getX(1) - p.getX(0), gx = (x + 14) / spacing, gz = (z - 110) / spacing;
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const a = p.getY(j * cols + i), b = p.getY(j * cols + i + 1), c = p.getY((j + 1) * cols + i), d = p.getY((j + 1) * cols + i + 1);
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
  for (let z = 130; z < 134; z += 1 / 12) for (let x = -5; x <= 5; x += 0.25) {
    oldError = Math.max(oldError, Math.abs(drawn(made[0], x, z) - made[0].height(x, z)));
    newError = Math.max(newError, Math.abs(drawn(made[1], x, z) - made[1].height(x, z)));
  }
  assert.ok(oldError > 1, 'negative control reproduces the former north-bank approximation error');
  assert.ok(newError < 1e-6, 'the refined near shore follows the physical master triangles');
  for (const t of made) { for (const m of t.group.children) { m.userData.fine.dispose(); m.userData.coarse?.dispose(); } t.material.dispose(); }
} finally { if (previousScheduler === undefined) delete globalThis.scheduler; else globalThis.scheduler = previousScheduler; }
for (const m of meshes) m.material.dispose();
console.log(`canal-shore-check: ${triangles} triangle quay, protected bridge, rounded ${minWidth.toFixed(2)}–${maxWidth.toFixed(2)} m shoulders; north-bank mesh error ${oldError.toFixed(3)} m → ${newError.toFixed(6)} m`);
