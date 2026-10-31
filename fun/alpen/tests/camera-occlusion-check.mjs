// Run with: node tests/camera-occlusion-check.mjs
// Production obstacle queries, camera matrices and flight physics; no WebGL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createChaseCamera } from '../js/camera.js';
import { createSolidIndex } from '../js/solid-index.js';
import { Rider } from '../js/rider.js';
import { HARD, JUMPABLE } from '../js/config.js';

const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('const blockedSpan = []');
const end = source.indexOf('\n// Hoisted out of the frame loop', start);
assert(start > 0 && end > start, 'locate the production camera obstacle queries');
const makeWorld = new Function('HARD', 'props', 'huts', 'heightAt', 'getTerrainMaterialAt',
  'nearestCenter', 'corridorHalfAt', 'beyondLipAt', source.slice(start, end) + ';return { world, blockedIn };');
const flat = { height: () => 0, canStall: () => false };
const neutral = { turn: 0, tuck: false, brake: false, jump: false, trickGrab: false, trickFlip: false };
const rock = { x: 0, z: 6.5, r: 1.4, kind: HARD, top: 2.2, cameraPad: .55, volume: true };
const tree = { x: 0, z: 6.5, r: .45, kind: HARD, top: 99, volume: true };
const hut = { x: 0, z: 6.5, r: Math.hypot(2, 1.6), hw: 2, hd: 1.6,
  cos: Math.cos(.4), sin: Math.sin(.4), kind: HARD, top: 5.6, cameraPad: .55, volume: true };

function fixture(solids = [], huts = [], height = flat.height) {
  const index = createSolidIndex(solids); index.rebuild();
  const stats = { heights: 0, spans: 0, probes: 0, filtered: 0 };
  const { world, blockedIn } = makeWorld(HARD, { solids, querySolids(lo, hi, out) {
    stats.spans++; return index.query(lo, hi, out);
  } }, { solids: huts }, (x, z) => { stats.heights++; return height(x, z); },
  () => 0, x => x, () => 10, () => -10);
  const blocked = world.blocked;
  world.blocked = (x, z, r, bottomY) => {
    stats.probes++;
    const result = blocked(x, z, r, bottomY);
    if (!result && blocked(x, z, r)) stats.filtered++;
    return result;
  };
  return { world, blockedIn, stats, rebuild: () => index.rebuild() };
}
function view(aspect = 390 / 844) {
  const camera = new THREE.PerspectiveCamera(65, aspect, .1, 2000);
  return { camera, chase: createChaseCamera(THREE, camera) };
}
function sameView(a, b, message) {
  assert(a.position.distanceTo(b.position) < 1e-9, message + ': camera position');
  assert(1 - Math.abs(a.quaternion.dot(b.quaternion)) < 1e-10, message + ': camera aim');
  assert(Math.abs(a.fov - b.fov) < 1e-9, message + ': field of view');
}
function visible(camera, position, message) {
  camera.updateMatrixWorld();
  const p = position.clone().project(camera);
  assert(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z > -1 && p.z < 1, message);
}

// Heights are absolute world coordinates. Equality still blocks, unknown
// bounds remain conservative, and the tree sentinel is never a canopy cap.
{
  const f = fixture();
  for (const solid of [rock, hut, { ...rock, top: -300 }, { ...rock, top: 99 }]) {
    for (const bottom of [undefined, NaN, -Infinity, Infinity, solid.top - 1e-6,
      solid.top, solid.top + 1e-6]) {
      assert.equal(f.blockedIn([solid], solid.x, solid.z, .7, bottom),
        !(Number.isFinite(bottom) && bottom > solid.top), 'bounded top uses a strict finite clearance');
    }
  }
  for (const top of [undefined, NaN, Infinity]) {
    assert(f.blockedIn([{ ...rock, top }], 0, 6.5, .7, 1000), 'unknown tops cannot disable occlusion');
  }
  assert(f.blockedIn([tree], 0, 6.5, .7, 1000), 'tree top 99 remains a conservative trunk/crown sentinel');
  assert.equal(f.blockedIn([{ ...rock, kind: JUMPABLE }], 0, 6.5, .7, 0), false,
    'non-hard objects retain their existing camera behavior');
  assert.equal(f.stats.heights, 0, 'vertical rejection reads cached bounds without terrain queries');
}

// The production indexed span must forward height exactly as its full scan
// does, including rotated hut boxes and solids straddling bin boundaries.
{
  const props = Array.from({ length: 257 }, (_, i) => ({
    ...(i % 3 ? rock : tree), x: (i * 13 % 41) - 20, z: (i * 37 % 101) - 50,
    r: .3 + i % 4, top: i % 3 ? i % 12 - 6 : 99,
  }));
  const f = fixture(props, [hut, { ...hut, x: -3, z: -40, top: -4 }]);
  for (let span = 0; span < 30; span++) {
    const x0 = span % 11 - 5, z0 = span * 3 - 45, x1 = x0 + 6, z1 = z0 + 10;
    const probes = Array.from({ length: 11 }, (_, i) => [
      x0 + (x1 - x0) * i / 10, z0 + (z1 - z0) * i / 10, .7 + i * .37,
    ]);
    for (const bottom of [undefined, -10, 0, 3, 1000]) {
      const full = probes.map(p => f.world.blocked(...p, bottom));
      f.world.beginBlockedSpan(x0, z0, x1, z1, 4.4);
      assert.deepEqual(probes.map(p => f.world.blocked(...p, bottom)), full, 'indexed/full height parity');
      f.world.endBlockedSpan();
      assert.deepEqual(probes.map(p => f.world.blocked(...p, bottom)), full, 'span cleanup restores full scans');
    }
  }
  assert.equal(f.stats.heights, 0);
  assert(f.stats.filtered > 0, 'the parity sweep actually exercises vertical rejection');
}

// A low object below the entire view cannot create a first-frame camera
// contraction or a later portrait lens pulse. Compare the real projections.
for (const aspect of [16 / 9, 390 / 844]) {
  const r = new Rider(THREE, flat);
  r.pos.y = 6; r.vel.set(0, 0, -20); r.state = 'air'; r.grounded = false; r.airTime = 1.5;
  const clear = fixture(), bounded = fixture([rock]);
  const a = view(aspect), b = view(aspect);
  for (let frame = 0; frame < 180; frame++) {
    a.chase.update(r, 1 / 60, clear.world); b.chase.update(r, 1 / 60, bounded.world);
    sameView(a.camera, b.camera, 'below-view boulder, frame ' + frame);
  }
  visible(b.camera, r.pos, 'the airborne board remains in frame');
  visible(b.camera, r.pos.clone().add(new THREE.Vector3(0, 0, -10)), 'the forward flight line remains in frame');
  assert.equal(bounded.stats.heights, 180 * 3, 'clear framing retains three terrain samples per update');
  assert.equal(bounded.stats.heights, clear.stats.heights);
  assert.equal(bounded.stats.spans, 180, 'one reused shortlist per camera update');
  assert(bounded.stats.probes <= 180 * 11, 'the clear sightline retains its bounded coarse walk');
  assert(bounded.stats.filtered > 0, 'the boulder overlaps the horizontal probes');
}

// Existing ground, trunk and building protection still shortens the boom,
// keeps the rider visible, and leaves the actual lens outside solid geometry.
for (const solid of [rock, tree, hut]) {
  const f = fixture(solid === hut ? [] : [solid], solid === hut ? [solid] : []);
  const r = new Rider(THREE, flat); r.vel.set(0, 0, -20);
  const a = view(), clear = view(), empty = fixture();
  for (let i = 0; i < 180; i++) {
    a.chase.update(r, 1 / 60, f.world); clear.chase.update(r, 1 / 60, empty.world);
  }
  assert(a.camera.position.z < clear.camera.position.z - 1, 'ground-level hard objects still pull the camera in');
  assert.equal(f.world.blocked(a.camera.position.x, a.camera.position.z, .7,
    a.camera.position.y - .7), false, 'the lens clears the hard object');
  assert(a.camera.position.y >= 1.5, 'the ground-clearance floor is preserved');
  visible(a.camera, r.pos.clone().add(new THREE.Vector3(0, 1, 0)), 'the obstructed portrait view keeps the rider visible');
}

// Terrain protection remains independent of solid-object height filtering.
{
  const height = (x, z) => Math.max(0, z - 3) * 3;
  const f = fixture([], [], height), empty = fixture();
  const r = new Rider(THREE, flat); r.vel.set(0, 0, -20);
  const a = view(), b = view();
  for (let i = 0; i < 180; i++) {
    a.chase.update(r, 1 / 60, f.world); b.chase.update(r, 1 / 60, empty.world);
  }
  assert(a.camera.position.z < b.camera.position.z - 1, 'a terrain wall still shortens the boom');
  assert(a.camera.position.y >= height(a.camera.position.x, a.camera.position.z) + 1.5,
    'the actual lens remains above the terrain wall');
  visible(a.camera, r.pos.clone().add(new THREE.Vector3(0, 1, 0)), 'terrain shortening keeps the rider visible');
}

// A rising rider can already be over a boulder while the trailing lens is
// still low. The obstacle must protect that live lens until it catches up.
{
  const solids = [], blocked = fixture(solids), empty = fixture();
  const r = new Rider(THREE, flat); r.vel.set(0, 0, -20);
  const a = view(), b = view();
  for (let i = 0; i < 180; i++) {
    a.chase.update(r, 1 / 60, blocked.world); b.chase.update(r, 1 / 60, empty.world);
  }
  const oldLensY = a.camera.position.y;
  solids.push({ ...rock, top: 4 }); blocked.rebuild();
  r.pos.y = 6; r.state = 'air'; r.grounded = false; r.airTime = .3;
  a.chase.update(r, 1 / 60, blocked.world); b.chase.update(r, 1 / 60, empty.world);
  assert(oldLensY < 4 && a.camera.position.y < 4, 'the live lens is still below the boulder top');
  assert(a.camera.position.z < b.camera.position.z - .03, 'the lower live lens still receives obstruction protection');
}

// A real tangent launch and ballistic arc cross above a fixed boulder. The
// obstacle can overlap the boom in plan view without changing the flight's
// camera, lens, or rider projection while the entire view is above it.
{
  const obstacle = { ...rock, z: -7 };
  const r = new Rider(THREE, flat);
  r.normal.set(0, .8, .6); r.vel.set(0, 18, -24); r.takeOff(0, r.normal);
  while (r.pos.y < obstacle.top + 1) r.step(1 / 120, neutral);
  const clear = fixture(), bounded = fixture([obstacle]);
  const a = view(), b = view();
  let frames = 0;
  while (r.state === 'air' && r.pos.y > obstacle.top + 1 && frames < 180) {
    a.chase.update(r, 1 / 60, clear.world); b.chase.update(r, 1 / 60, bounded.world);
    sameView(a.camera, b.camera, 'real flight over a low boulder');
    visible(b.camera, r.pos, 'the moving airborne board stays in frame');
    r.step(1 / 120, neutral); r.step(1 / 120, neutral); frames++;
  }
  assert(frames > 30, 'the regression spans a substantial real ascent and descent');
  assert(bounded.stats.filtered > 10, 'the fixed obstacle actually crosses the moving sightline');
  assert.equal(bounded.stats.heights, clear.stats.heights, 'airborne rejection adds no terrain sampling');
}
console.log('Camera occlusion checks passed: bounded heights, indexed parity, first/live lens, solid clearance and real flight.');
