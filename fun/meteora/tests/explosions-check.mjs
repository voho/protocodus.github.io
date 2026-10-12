// Run with: node tests/explosions-check.mjs
// Explosions are bookkeeping as much as pictures: every layer must appear,
// move with what blew up, die out on time and stay within its pools, and
// the batches they feed must stay sorted for blending.
import { registerHooks } from 'node:module';
import { test, run, assert, near } from './harness.mjs';

const three = new URL('../../../assets/vendor/three/three.module.min.js', import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (s === 'three' ? { url: three, shortCircuit: true } : next(s, c)) });
const THREE = await import('three');
const { createGlowBatch } = await import('../js/glow.js');
const { createSmokeBatch } = await import('../js/smoke.js');
const { createExplosions } = await import('../js/explosions.js');

const chip = () => {
  const lod1 = new THREE.IcosahedronGeometry(1.5, 0);
  lod1.computeBoundingSphere();
  return { lod1, material: new THREE.MeshStandardMaterial() };
};
function setup() {
  const scene = new THREE.Scene();
  const glow = createGlowBatch(scene), smoke = createSmokeBatch(scene, new THREE.Vector3(0, 1, 0));
  const fx = createExplosions(scene, glow, smoke, chip());
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 1e5);
  camera.position.set(0, 0, 300);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const frame = (dt = 1 / 60) => {
    const f = camera.getWorldDirection(new THREE.Vector3());
    glow.begin(); smoke.begin();
    glow.setCamera(camera.position.x, camera.position.y, camera.position.z, f.x, f.y, f.z);
    smoke.setCamera(camera.position.x, camera.position.y, camera.position.z, f.x, f.y, f.z);
    const out = fx.update(dt, camera);
    glow.end(); smoke.end();
    return out;
  };
  const seconds = (s, dt = 1 / 60) => { let out; for (let t = 0; t < s; t += dt) out = frame(dt); return out; };
  return { scene, glow, smoke, fx, camera, frame, seconds };
}
const total = counts => Object.values(counts).reduce((a, b) => a + b, 0);

test('a kill brings every layer: flash, fireball, ring, sparks, debris, smoke and light', () => {
  const { fx, glow, smoke, frame, seconds } = setup();
  fx.shipDeath([0, 0, 0], [0, 0, 0], 'interceptor');
  const out = frame();
  const c = fx.counts;
  assert.ok(c.sparks > 100 && c.lobes >= 6 && c.rings >= 1 && c.debris >= 10 && c.puffs >= 20, JSON.stringify(c));
  assert.ok(glow.count > 100, 'sparks are drawn');
  assert.ok(fx.lights.some(l => l.intensity > 0), 'the blast lights its surroundings');
  assert.ok(out.flash > 0, 'a kill in view dazzles');
  seconds(0.5);
  assert.ok(smoke.count > 0 && fx.fireballs.count > 0, 'smoke and fire are drawn');
});

test('everything burns out: no particle, piece or light outlives its time', () => {
  const { fx, seconds } = setup();
  fx.shipDeath([0, 0, 0], [0, 0, 0], 'fighter');
  fx.blast([30, 0, 0], [0, 0, 0]);
  fx.rockBreak([0, 30, 0], [0, 0, 0], 10, false);
  fx.impact('shield', [0, 0, 10], [0, 0, 1], [0, 0, 0]);
  seconds(9);
  assert.equal(total(fx.counts), 0, JSON.stringify(fx.counts));
  assert.ok(fx.lights.every(l => l.intensity === 0));
});

test('the wreck keeps the ship\'s momentum', () => {
  const { fx, seconds } = setup();
  const vel = [200, 0, -50];
  fx.shipDeath([0, 0, 0], vel, 'interceptor');
  seconds(1);
  // Debris flies straight on from the ship's velocity: its centre of mass is
  // where the ship would be.
  const pieces = fx.debris.shardMesh, m = new THREE.Matrix4(), p = new THREE.Vector3(), mean = new THREE.Vector3();
  for (let i = 0; i < pieces.count; i++) { pieces.getMatrixAt(i, m); mean.add(p.setFromMatrixPosition(m)); }
  mean.divideScalar(pieces.count);
  near(mean.x, 200, 25, 'x'); near(mean.z, -50, 25, 'z');
});

test('crumbling dust neither flashes nor lights; a breaking rock does both', () => {
  const quiet = setup();
  quiet.fx.rockBreak([0, 0, 0], [0, 0, 0], 4, true);
  const a = quiet.frame();
  assert.equal(a.flash, 0); assert.ok(quiet.fx.lights.every(l => l.intensity === 0));
  assert.ok(quiet.fx.counts.puffs > 0, 'but it does raise dust');
  const loud = setup();
  loud.fx.rockBreak([0, 0, 0], [0, 0, 0], 8, false);
  loud.frame();
  assert.ok(loud.fx.lights.some(l => l.intensity > 0) && loud.fx.counts.sparks > 0);
});

test('a blast behind the camera does not dazzle', () => {
  const { fx, frame } = setup();
  fx.blast([0, 0, 600], [0, 0, 0]);
  assert.equal(frame().flash, 0);
});

test('a massacre stays within the pools and draws nothing broken', () => {
  const { fx, glow, smoke, seconds } = setup();
  for (let k = 0; k < 40; k++) fx.shipDeath([k * 10, 0, 0], [0, 0, 0], k % 2 ? 'fighter' : 'interceptor');
  for (let k = 0; k < 60; k++) fx.impact(['rock', 'hull', 'shield'][k % 3], [0, k, 0], [0, 0, 1], [0, 0, 0]);
  seconds(0.6);
  const c = fx.counts;
  assert.ok(c.sparks <= 3072 && c.puffs <= 1536 && c.lobes <= 64 && c.rings <= 24 && c.debris <= 96 + 128, JSON.stringify(c));
  for (const mesh of [glow.mesh, smoke.mesh, fx.fireballs.lobes, fx.fireballs.rings]) {
    for (const a of Object.values(mesh.geometry.attributes)) {
      if (!a.isInstancedBufferAttribute) continue;
      assert.ok(a.array.subarray(0, mesh.geometry.instanceCount * a.itemSize).every(Number.isFinite), `${a.name ?? 'attribute'} is finite`);
    }
  }
});

test('smoke puffs and fireball lobes are handed over back to front', () => {
  const { fx, smoke, camera, seconds } = setup();
  fx.shipDeath([0, 0, -100], [0, 0, 0], 'interceptor');
  fx.shipDeath([0, 0, 100], [0, 0, 0], 'interceptor');
  seconds(0.4);
  const depthOrder = mesh => {
    const c = mesh.geometry.getAttribute('iCenter').array, n = mesh.geometry.instanceCount;
    const d = [];
    for (let i = 0; i < n; i++) d.push(camera.position.z - c[i * 4 + 2]);  // the camera looks down −z
    return d;
  };
  for (const mesh of [smoke.mesh, fx.fireballs.lobes]) {
    const d = depthOrder(mesh);
    assert.ok(d.length > 2);
    for (let i = 1; i < d.length; i++) assert.ok(d[i] <= d[i - 1] + 1e-3, `${i}: ${d[i - 1]} then ${d[i]}`);
  }
});

test('events map onto the right effects, and clear empties everything', () => {
  const { fx, frame } = setup();
  fx.handle({ type: 'boltHit', kind: 'ship', shielded: true, pos: [0, 0, 0], normal: [0, 0, 1], vel: [0, 0, 0] });
  frame();
  assert.equal(fx.counts.rings, 1, 'a shield hit ripples');
  fx.handle({ type: 'boltHit', kind: 'rock', pos: [0, 0, 0], normal: [0, 1, 0] });   // no vel: a static rock
  fx.handle({ type: 'missileExpire', pos: [5, 0, 0] });
  fx.handle({ type: 'shipKilled', team: 1, kind: 'interceptor', pos: [0, 0, 0], vel: [10, 0, 0] });
  fx.handle({ type: 'rockBreak', rockType: 1, pos: [0, 0, 0], radius: 4, vel: [0, 0, 0], crumble: true });
  fx.handle({ type: 'wave', n: 2, count: 4 });
  frame();
  assert.ok(fx.counts.lobes > 0 && fx.counts.debris > 0);
  fx.clear();
  frame();
  assert.equal(total(fx.counts), 0);
  assert.ok(fx.lights.every(l => l.intensity === 0));
});

await run();
