// A clear capsule can still stand with both boots above a narrow trench lip.
// Test the shipped skin's real soles, keeping runtime analytic fixed anchors.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { parseUntexturedGLB } = await import('./rig-fixture.mjs');
const { createCharacter, mergedSoldier } = await import('../js/character.js');
const { polylineDistance } = await import('../js/util.js');
const { createNav } = await import('../js/nav.js');
// This is the Saint-Clair communication trench regression, independently
// selectable from the all-mission support gate.
process.env.HEDGEROW_LEVEL = 'saint-clair';
const { L, terrain, world } = await import('./level-world.mjs');
const analytic = terrain.height, { minX, minZ } = L.bounds, samples = new Map();
const sample = (i, j) => {
  const key = i + ',' + j;
  if (!samples.has(key)) samples.set(key, Math.fround(analytic(minX + i * .5, minZ + j * .5)));
  return samples.get(key);
};
const master = (x, z) => {
  const gx = (x - minX) * 2, gz = (z - minZ) * 2, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const a = sample(i, j), b = sample(i + 1, j), c = sample(i, j + 1), d = sample(i + 1, j + 1);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
};
const joint = L.lines.TRENCH_C[0];
const role = L.enemies.filter(d => d.inTrench && d.hold && d.type === 'rifle').sort((a, b) =>
  Math.hypot(a.at[0] - joint[0], a.at[1] - joint[1]) - Math.hypot(b.at[0] - joint[0], b.at[1] - joint[1]))[0];
assert.ok(role && role.group === 'trench', 'a held rifleman still defends the communication-trench junction');
function anchor(at) {
  let best;
  for (const key of Object.keys(L.lines).filter(k => k.startsWith('TRENCH'))) {
    const p = polylineDistance(L.lines[key], ...at, {});
    if (!best || p.d < best.d) best = p;
  }
  return [best.px, analytic(best.px, best.pz), best.pz];
}
const material = new THREE.MeshBasicMaterial(), matlib = { get: () => material, resolve: m => m || material };
const soldier = mergedSoldier(await parseUntexturedGLB('soldier'), matlib);
function bootGaps(at) {
  const [x, y, z] = anchor(at), ch = createCharacter(soldier, matlib, { outfit: 'axis', scene: new THREE.Scene() });
  ch.root.position.set(x, y, z); ch.root.rotation.y = role.yaw * Math.PI / 180;
  const results = [], vertex = new THREE.Vector3();
  for (const lower of ['idle', 'crouch_idle']) {
    ch.animate(lower, lower === 'idle' ? 'aim' : 'crouch_aim', 1);
    for (let i = 0; i < 60; i++) ch.update(1 / 60, y);
    ch.root.updateMatrixWorld(true);
    const skin = ch.meshes.find(m => m.isSkinnedMesh && !/_lod$/.test(m.name)); skin.skeleton.update();
    const { position, skinIndex: si, skinWeight: sw } = skin.geometry.attributes;
    for (const name of ['foot_l', 'foot_r']) {
      const bone = skin.skeleton.bones.findIndex(b => b.name === name), points = [];
      for (let i = 0; i < position.count; i++) {
        let weight = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) weight += sw.getComponent(i, k);
        if (weight <= .5) continue;
        skin.getVertexPosition(i, vertex).applyMatrix4(skin.matrixWorld); points.push(vertex.clone());
      }
      const minY = Math.min(...points.map(p => p.y));
      const gaps = points.filter(p => p.y <= minY + .025).map(p => p.y - world.groundAt(p.x, p.z, p.y + .025, 0, 0)).sort((a, b) => a - b);
      assert.ok(gaps.length > 20, 'the shipped boot has a measured sole surface');
      results.push({ lower, name, min: gaps[0], max: gaps.at(-1), median: gaps[Math.floor(gaps.length / 2)] });
    }
  }
  ch.dispose(); return results;
}
try {
  terrain.height = master;
  const [x, feet, z] = anchor(role.at);
  for (const radius of [.34, .42]) for (const height of [1.2, 1.7]) {
    const p = { x, z }; world.pushOut(p, radius, feet, height, .45);
    assert.ok(Math.hypot(p.x - x, p.z - z) < .001, 'grounding both boots also keeps the real body clear');
  }
  for (const b of bootGaps(role.at)) assert.ok(b.min > -.03 && b.max < .06 && b.median < .03,
    `${b.lower} ${b.name} rests on the trench floor without hovering or deep burial`);
  const former = bootGaps([-21, 386]);
  assert.ok(former.some(b => b.min > .4), 'negative control detects the former clear-body post with an unsupported boot');
  const exit = L.lines.TRENCH_C.at(-1), nav = createNav(world, L.playBounds);
  assert.ok(nav.findPath(x, z, ...exit), 'the junction defender remains connected to the communication-trench exit');
} finally { terrain.height = analytic; material.dispose(); }
console.log('trench-footing-check: real standing/crouched boot soles rest on the communication trench, with body clearance, exit route and historical negative');
