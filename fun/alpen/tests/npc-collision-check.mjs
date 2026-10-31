import assert from 'node:assert/strict';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createMountainLife } from '../js/mountainLife.js';
import { heightAt } from '../js/terrain.js';
import { setWorldSeed } from '../js/noise.js';
import { sweptRiderContact } from '../js/rider-contact.js';

// Real mountain-life updates, without a renderer or asset network requests.
// Observe the figures the game draws; the private NPC pool stays private.
const originalFetch = globalThis.fetch, originalWarn = console.warn;
const pendingLoads = [];
console.warn = (...args) => {
  if (args[0] === 'Alpen: keeping the procedural lift —' && String(args[1]).endsWith('/lift.glb 404')) return;
  originalWarn(...args);
};
globalThis.fetch = async () => ({ ok: false, status: 404 });
const namespace = { ...THREE, TextureLoader: class { load() { return new THREE.Texture(); } } };
const weather = { night: 0, snow: 0, fogFar: 560 };
const radius = Math.sqrt(2.5);
function fixture() {
  let random = 12345;
  const seeded = action => {
    const previous = Math.random;
    Math.random = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 2 ** 32; };
    try { return action(); } finally { Math.random = previous; }
  };
  setWorldSeed('alpen01');
  const scene = seeded(() => new THREE.Scene()), bursts = [];
  const life = seeded(() => createMountainLife(namespace, scene, { apply: material => material }, {
    burst(pos, vx, vz, count) { if (count === 24) bursts.push({ ...pos }); },
  }));
  pendingLoads.push(life.liftReady);
  seeded(() => life.reset(-600));
  const figures = [];
  scene.traverse(node => {
    if (node.isGroup && node.rotation.order === 'YXZ' && node.children.filter(child => child.isMesh).length === 2) figures.push(node);
  });
  assert.equal(figures.length, 8, 'fixture observes the eight production riders');
  const target = figures[0];
  return {
    target, bursts,
    update(dt, rider, spare = false) { seeded(() => life.update(dt, rider, weather, spare)); },
    reset(z, seed = 2025) { random = seed; seeded(() => life.reset(z)); },
    close() {
      const geometries = new Set(), materials = new Set();
      scene.traverse(node => {
        if (node.geometry) geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      scene.clear();
    },
  };
}
function riderAt(pos, options = {}) {
  return {
    pos: pos.clone(), state: 'ride', grace: 0, impacts: [],
    fall(reason, force) { this.impacts.push({ reason, force }); this.state = 'fall'; },
    ...options,
  };
}
function withFixture(check) {
  const f = fixture();
  try { return check(f); } finally { f.close(); }
}
function assertHit(f, rider, label) {
  assert.deepEqual(rider.impacts, [{ reason: 'npc', force: 15 }], label + ': one production player fall');
  assert.equal(f.bursts.length, 1, label + ': one NPC collision burst');
  assert(f.bursts.every(pos => [pos.x, pos.y, pos.z].every(Number.isFinite)), label + ': finite impact position');
}
function assertMiss(f, rider, label) {
  assert.equal(rider.impacts.length, 0, label + ': player stays up');
  assert.equal(f.bursts.length, 0, label + ': NPC stays up');
}
function crossing(fps, duration, offset) {
  return withFixture(f => {
    const x = f.target.position.x + offset, z = f.target.position.z;
    const start = z + 90 * duration / 2;
    const rider = riderAt(new THREE.Vector3(x, heightAt(x, start), start));
    f.update(0, rider);
    assertMiss(f, rider, 'crossing starts outside the contact volume');
    let max3dSpeed = 0;
    for (let i = 0; i < Math.round(fps * duration); i++) {
      const previous = rider.pos.clone();
      rider.pos.z = start - 90 * (i + 1) / fps;
      rider.pos.y = heightAt(x, rider.pos.z);
      max3dSpeed = Math.max(max3dSpeed, rider.pos.distanceTo(previous) * fps);
      f.update(1 / fps, rider);
    }
    assert(max3dSpeed < 96, 'the crossing stays below the actual 3D riding speed limit');
    assertHit(f, rider, fps + ' Hz / lateral offset ' + offset);
    return { fps, offset, max3dSpeed, impacts: rider.impacts.length };
  });
}
// A separate, collision-free production run supplies the NPC's real movement.
// Tests then choose player paths relative to those observed positions, without
// replacing the AI, terrain, integration, or collision code under test.
function npcMotion(dt = .05) {
  return withFixture(f => {
    const start = f.target.position.clone();
    const rider = riderAt(start.clone().add(new THREE.Vector3(20, 0, 0)));
    f.update(0, rider); f.update(dt, rider);
    assertMiss(f, rider, 'NPC motion witness');
    return { start, end: f.target.position.clone(), dt };
  });
}
function relativePath(name, before, after, hit, motion) {
  return withFixture(f => {
    assert(f.target.position.distanceTo(motion.start) < 1e-9, name + ': matched seeded NPC');
    const rider = riderAt(motion.start.clone().add(new THREE.Vector3(...before)));
    f.update(0, rider);
    assertMiss(f, rider, name + ': clear initial sample');
    rider.pos.copy(motion.end).add(new THREE.Vector3(...after));
    f.update(motion.dt, rider);
    (hit ? assertHit : assertMiss)(f, rider, name);
    return f.bursts[0];
  });
}
try {
  // Texture/geometry caches warm once, before comparing identically seeded runs.
  withFixture(f => f.update(0, riderAt(new THREE.Vector3(0, 0, -600))));
  const crossings = [20, 60, 120, 240].map(fps => crossing(fps, 1 / 20, 0));
  crossings.push(...[30, 60, 120, 240].map(fps => crossing(fps, 1 / 30, 1.1)));
  const motion = npcMotion();
  relativePath('lateral near miss', [-1.9, 0, 1.7], [1.9, 0, 1.7], false, motion);
  relativePath('airborne clearance', [-1.9, 2.5, 0], [1.9, 2.5, 0], false, motion);
  // The closest horizontal point is still too high in both cases. Only the
  // first path enters the height band before leaving the horizontal volume.
  const lateImpact = relativePath('late vertical overlap', [-1.9, 3, 0], [1.9, 2, 0], true, motion);
  // Height first enters at t=.8 (3 down to 2.2); relative x is then 1.14.
  // The puff belongs at that contact midpoint, not the sampled frame end.
  const expectedImpact = motion.start.clone().lerp(motion.end, .8)
    .add(new THREE.Vector3(1.14 / 2, 2.2 / 2 + .3, 0));
  assert(expectedImpact.distanceTo(new THREE.Vector3(lateImpact.x, lateImpact.y, lateImpact.z)) < 1e-9,
    'collision spray begins at the first contact midpoint');
  relativePath('separate horizontal and vertical intervals', [-1.9, 3, 0], [1.9, 2.15, 0], false, motion);
  relativePath('crosses the complete vertical band', [0, 2.3, 0], [0, -2.3, 0], true, motion);

  const travel = motion.end.clone().sub(motion.start);
  const horizontal = Math.hypot(travel.x, travel.z);
  assert(horizontal > .2 && horizontal < 3, 'witness observes ordinary moving NPC travel');
  const direction = new THREE.Vector3(travel.x / horizontal, 0, travel.z / horizontal);
  const gap = radius + .1;
  const parallel = direction.clone().multiplyScalar(-gap).toArray();
  assert(gap - horizontal < radius, 'a stationary-NPC approximation would falsely hit the parallel rider');
  relativePath('parallel rider keeps a safe relative gap', parallel, parallel, false, motion);
  withFixture(f => {
    const sideways = new THREE.Vector3(-direction.z, 0, direction.x);
    const inset = Math.sqrt(2.5 - (horizontal * .3) ** 2);
    const point = motion.start.clone().lerp(motion.end, .5).addScaledVector(sideways, inset);
    assert(Math.hypot(point.x - motion.start.x, point.z - motion.start.z) > radius
      && Math.hypot(point.x - motion.end.x, point.z - motion.end.z) > radius,
    'stationary rider clears both sampled NPC endpoints');
    const rider = riderAt(point);
    f.update(0, rider); assertMiss(f, rider, 'moving NPC starts clear');
    f.update(motion.dt, rider); assertHit(f, rider, 'moving NPC passes through a stationary rider');
  });

  for (const [name, options, spare] of [
    ['attract demo', {}, true], ['already falling', { state: 'fall' }, false], ['recovery grace', { grace: 1 }, false],
  ]) withFixture(f => {
    const rider = riderAt(f.target.position, options);
    f.update(.01, rider, spare);
    assert.equal(rider.impacts.length, 0, name + ': player fall is suppressed');
    assert.equal(f.bursts.length, 1, name + ': the NPC still tumbles once');
  });
  withFixture(f => {
    const rider = riderAt(f.target.position, { fall(reason, force) { this.impacts.push({ reason, force }); } });
    f.update(0, rider); assertHit(f, rider, 'zero-delta endpoint contact');
    for (let i = 0; i < 10; i++) { rider.pos.copy(f.target.position); f.update(.05, rider); }
    assertHit(f, rider, 'remaining beside the same fallen NPC does not hit repeatedly');
  });

  for (const discontinuity of ['zero dt', 'reset', 'null rider', 'new rider', 'large teleport', 'renewed grace']) withFixture(f => {
    if (discontinuity === 'reset') f.reset(-600);
    const center = f.target.position.clone(), distance = discontinuity === 'large teleport' ? 12 : 7;
    let rider = riderAt(center.clone().add(new THREE.Vector3(distance, 0, 0)));
    f.update(0, rider); assertMiss(f, rider, discontinuity + ': initial separation');
    if (discontinuity === 'reset') f.reset(-600);
    if (discontinuity === 'null rider') f.update(.05, null);
    if (discontinuity === 'new rider') rider = riderAt(rider.pos);
    rider.pos.copy(center).add(new THREE.Vector3(-distance, 0, 0));
    if (discontinuity === 'renewed grace') rider.grace = .5;
    f.update(discontinuity === 'zero dt' ? 0 : .05, rider);
    assertMiss(f, rider, discontinuity + ': no collision along the discarded old path');
    f.update(.05, rider);
    assertMiss(f, rider, discontinuity + ': following frame starts from the new position');
  });

  withFixture(f => {
    const rider = riderAt(f.target.position.clone().add(new THREE.Vector3(5, 0, 0)));
    rider.pos.y = NaN;
    f.update(.01, rider);
    assertMiss(f, rider, 'invalid previous player height');
    rider.pos.copy(f.target.position);
    f.update(.01, rider);
    assertHit(f, rider, 'valid endpoint after invalid history');
  });

  // Recycle an NPC by moving the player just two metres across the existing
  // 60 m boundary. Its jump to the far fog must not become a physical sweep.
  let recycle;
  withFixture(f => {
    const start = f.target.position.clone();
    const rider = riderAt(start.clone().add(new THREE.Vector3(0, 0, -59)));
    f.update(0, rider); rider.pos.z -= 2; f.update(.05, rider);
    recycle = { start, end: f.target.position.clone() };
  });
  withFixture(f => {
    const fraction = 59 / (recycle.start.z - recycle.end.z - 2);
    const crossingPoint = recycle.start.clone().lerp(recycle.end, fraction);
    const rider = riderAt(new THREE.Vector3(crossingPoint.x, crossingPoint.y, recycle.start.z - 59));
    f.update(0, rider); rider.pos.z -= 2; f.update(.05, rider);
    assert(f.target.position.distanceTo(recycle.end) < 1e-9, 'recycle witness is independent of player height and lane');
    assert(recycle.start.z - recycle.end.z > 180, 'NPC really recycled beyond the fog');
    assertMiss(f, rider, 'NPC recycle is a discontinuity, not a pass through the rider');
  });

  // Mathematical boundary cases complement, rather than replace, the real
  // update fixtures above. Tangency preserves the authored strict bounds.
  assert.equal(sweptRiderContact(-3, 0, radius, 3, 0, radius), -1, 'horizontal tangency is not penetration');
  assert.equal(sweptRiderContact(-3, 2.2, 0, 3, 2.2, 0), -1, 'height-boundary tangency is not penetration');
  assert.equal(sweptRiderContact(0, 0, 0, 0, 0, 0), 0, 'stationary overlap contacts immediately');
  assert.equal(sweptRiderContact(2, 0, 0, 2, 0, 0), -1, 'stationary separation stays clear');
  const late = sweptRiderContact(-3, 6, 0, 3, 0, 0);
  assert(late > .63 && late < .64, 'vertical entry inside the horizontal interval counts');
  assert.equal(sweptRiderContact(-3, 6, 0, 3, 2, 0), -1, 'nonoverlapping time intervals stay clear');
  assert.equal(sweptRiderContact(1.5, 3.7, -1, 1.5, 1.7, 1), -1,
    'height entry exactly at horizontal exit only touches the boundary');
  console.log('NPC swept-contact checks passed: real 20/30/60/120/240 Hz crossings, relative motion, vertical timing, eligibility and discontinuities.');
  console.log(JSON.stringify(crossings));
} finally {
  await Promise.all(pendingLoads);
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
}
