import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';

// Run with: node tests/models-check.mjs
const base = new URL('../', import.meta.url);
// Geometry builders stay private in production; expose them only in this smoke check.
// The glTF loader imports the bare specifier 'three', which node cannot
// resolve; nothing here loads a file, so a module that imports it gets a stub.
const upgraderStub = 'data:text/javascript;base64,' + Buffer.from(
  'export function createModelUpgrader() { const none = () => {}; '
  + 'return { upgrade: none, upgradeTextured: none, upgradeTexturedSet: none }; }',
).toString('base64');
async function load(file, exports = []) {
  const url = new URL('js/' + file, base);
  let source = await readFile(url, 'utf8');
  source = source.replace(/^import \{ GLTFLoader \}.*$/m, '')
    .replace(/from\s+(['"])\.\/importedModels\.js\1/g, `from '${upgraderStub}'`)
    .replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
      (_, quote, path) => `from ${quote}${new URL(path, url).href}${quote}`)
    .replaceAll('import.meta.url', JSON.stringify(url.href));
  if (exports.length) source += '\nexport { ' + exports.join(', ') + ' };';
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

function valid(name, geo) {
  assert.ok(geo.attributes.position.count > 0, name);
  for (const [key, attribute] of Object.entries(geo.attributes)) {
    assert.equal(attribute.count, geo.attributes.position.count, name + ': aligned ' + key);
    assert.ok(attribute.array.every(Number.isFinite), name + ': finite ' + key);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  assert.ok(Number.isFinite(geo.boundingSphere.radius) && geo.boundingSphere.radius > 0, name);
  if (geo.index) assert.ok(geo.index.array.every(i => i < geo.attributes.position.count), name);
  return (geo.index?.count ?? geo.attributes.position.count) / 3;
}

const wildlifeNames = ['rabbitGeometry', 'deerBodyGeometry', 'deerHeadGeometry', 'wolfGeometry'];
const wildlife = await load('wildlife.js',
  [...wildlifeNames, 'slopeUnder', 'SLOPE_ROLL', 'SLOPE_PITCH_MAX', 'SLOPE_ROLL_MAX']);
const triangleBudgets = [4500, 2000, 1200, 3200];
for (const key of wildlifeNames) {
  const triangles = valid(key, wildlife[key](THREE, true));
  assert.ok(triangles <= triangleBudgets[wildlifeNames.indexOf(key)], key + ': triangle budget');
}

/* Deer and wolves stand on the slope under them. Composed the way the herd
   and the pack are drawn — pitch and roll about the animal's own axes after
   its yaw — the fore and hind feet land on the real terrain, and the left
   and right ones on the share of the cross slope the roll is allowed; on
   ground steeper than an animal carries its spine (the boundary wall) the
   tilt stops at its cap instead of pinning the animal to the wall. */
{
  const { heightAt } = await import(new URL('js/terrain.js', base).href);
  const out = { pitch: 0, roll: 0 };
  let tilted = 0;
  let capped = 0;
  const spots = [[0, -400], [38, -1250], [-52, -2600], [12, -5100], [140, -2600], [-160, -900]];
  for (const [x, z] of spots) {
    for (const yaw of [0.2, 1.4, -1.7, 3.0]) {
      wildlife.slopeUnder(x, z, yaw, 0.37, 0.20, out);
      assert.ok(Math.abs(out.pitch) <= wildlife.SLOPE_PITCH_MAX && Math.abs(out.roll) <= wildlife.SLOPE_ROLL_MAX,
        'the tilt is capped');
      if (Math.abs(out.pitch) + Math.abs(out.roll) > 0.05) tilted++;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rawPitch = Math.atan2(heightAt(x + fx * 0.37, z + fz * 0.37) - heightAt(x - fx * 0.37, z - fz * 0.37), 0.74);
      const rawRoll = Math.atan2(heightAt(x - fz * 0.2, z + fx * 0.2) - heightAt(x + fz * 0.2, z - fx * 0.2), 0.4);
      if (Math.abs(rawPitch) > wildlife.SLOPE_PITCH_MAX || Math.abs(rawRoll * wildlife.SLOPE_ROLL) > wildlife.SLOPE_ROLL_MAX) {
        capped++;
        continue;
      }
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(out.pitch, yaw + Math.PI, out.roll, 'YXZ'));
      const y0 = heightAt(x, z);
      const foot = (px, pz) => {
        const v = new THREE.Vector3(px, 0, pz).applyQuaternion(q);
        return y0 + v.y - heightAt(x + v.x, z + v.z);
      };
      assert.ok(Math.abs(foot(0, -0.37)) < 0.01 && Math.abs(foot(0, 0.37)) < 0.01, 'fore and hind feet on the snow');
      const cross = Math.abs(foot(0.2, 0)) + Math.abs(foot(-0.2, 0));
      const level = 2 * 0.2 * Math.abs(Math.tan(rawRoll));
      assert.ok(cross <= (1 - wildlife.SLOPE_ROLL) * level + 0.01, 'the cross slope is mostly taken up');
    }
  }
  assert.ok(tilted > 8, 'the mountain actually tilts them');
  assert.ok(capped < spots.length * 4, 'most spots are ordinary ground');
}

/* Animals dissolve in over a second instead of switching on where they are
   placed, and their shadow pass reads the same arrival value. */
{
  const StubTHREE = { ...THREE, TextureLoader: class {
    load() { return new THREE.Texture(); }
  } };
  const life = (await load('wildlife.js')).createWildlife(StubTHREE, { apply: (m) => m, uniforms: {} });
  const rabbits = life.group.children[0];
  const reveal = rabbits.geometry.attributes.aReveal;
  assert.ok(reveal && rabbits.customDepthMaterial, 'hares carry an arrival value into both passes');
  const rider = { pos: new THREE.Vector3(0, 0, -600), distance: 0, speed: 0, vel: new THREE.Vector3() };
  life.update(1 / 60, rider, () => {}, () => {});
  assert.ok(rabbits.count > 0 && reveal.array[0] < 0.1, 'a hare placed this frame has not yet arrived');
  for (let i = 0; i < 80; i++) life.update(1 / 60, rider, () => {}, () => {});
  assert.equal(reveal.array[0], 1, 'a hare is fully there after its arrival time');
}

/* One decode per photograph: the same URL hands every caller the same
   Texture, readiness callbacks fire once the image lands (and at once for a
   caller who arrives after), and a different loader class never shares. */
{
  const { sharedTexture } = await import(new URL('js/textures.js', base).href);
  const pending = [];
  const Loader = class { load(url, onLoad) { const t = new THREE.Texture(); pending.push(() => onLoad(t)); return t; } };
  const ns = { ...THREE, TextureLoader: Loader };
  const seen = [];
  const a = sharedTexture(ns, 'test://slate.jpg', (t) => seen.push(t));
  const b = sharedTexture(ns, 'test://slate.jpg', (t) => seen.push(t));
  assert.equal(a, b, 'one texture per file');
  assert.equal(pending.length, 1, 'one load per file');
  assert.equal(a.colorSpace, THREE.SRGBColorSpace);
  assert.equal(a.wrapS, THREE.RepeatWrapping);
  assert.equal(seen.length, 0, 'nothing is ready before the image is');
  pending[0]();
  assert.deepEqual(seen, [a, a], 'every waiting caller is told once');
  sharedTexture(ns, 'test://slate.jpg', (t) => seen.push(t));
  assert.equal(seen.length, 3, 'a late caller is told at once');
  const other = sharedTexture({ ...THREE, TextureLoader: class extends Loader {} }, 'test://slate.jpg');
  assert.notEqual(other, a, 'a stubbed namespace never shares with a real one');
}

const huts = await load('huts.js', ['hutGeometry', 'paneGeometry', 'siteAt']);
for (const key of ['hutGeometry', 'paneGeometry']) valid(key, huts[key](THREE));
/* The props keep off a hut's ground, so that ground has to cover the hut:
   every corner of the building's roof, the woodpile and the terrace, turned
   the way the hut was turned, and not the open snow beside it. */
{
  let found = 0;
  for (let b = 1; b < 40 && found < 6; b++) {
    const h = huts.siteAt(b);
    if (!h) continue;
    found++;
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    for (const [lx, lz] of [[-3.73, -4.4], [3.3, -4.4], [-3.73, 2.8], [3.3, 2.8]]) {
      assert.ok(huts.onHutGround(h.x + lx * c + lz * s, h.z - lx * s + lz * c),
        `hut ${b}: corner (${lx}, ${lz}) is on its ground`);
    }
    assert.ok(!huts.onHutGround(h.x + 12 * c, h.z - 12 * s), `hut ${b}: open snow beside it is not`);
  }
  assert.ok(found >= 3, 'the first blocks grow huts');
}
const rider = await load('riderModel.js',
  ['buildGeometries', 'POSE', 'DECK', 'DECK_TOP', 'ANKLE_Y', 'FOOT_X', 'FOOT_Z', 'HALF_WIDTH']);
const lampModule = await load('headlamp.js');
const riderGeo = rider.buildGeometries(THREE);
let riderTriangles = 0;
for (const [key, geo] of Object.entries(riderGeo)) {
  if (!geo?.isBufferGeometry) continue;
  riderTriangles += valid('rider.' + key, geo);
  // Every segment shares one material, so every one carries every attribute
  // that material reads — a missing one is whatever the driver left there.
  if (key !== 'board') {
    assert.ok(geo.attributes.aCloth && geo.attributes.aFlap, 'rider.' + key + ': cloth attributes');
  }
}
assert.ok(riderTriangles <= 10500, 'rider triangle budget: ' + riderTriangles);

/* The joint fills. The knee and the elbow are balls about the pivot, so the
   shin and forearm now reach a ball's radius above their own origin, and the
   tube beside each starts at the pivot rather than poking past it. */
const top = (geo) => { geo.computeBoundingBox(); return geo.boundingBox.max.y; };
assert.ok(top(riderGeo.shin) > 0.085 && top(riderGeo.shin) < 0.095, 'knee fill covers the bend');
assert.ok(top(riderGeo.foreArm) > 0.06 && top(riderGeo.foreArm) < 0.07, 'elbow fill covers the bend');
assert.ok(top(riderGeo.thigh) > 0.12, 'thigh top is domed, not capped flat');

/* The seat of the trousers is its own buffer on the hips: no trouser navy is
   left in the torso, and the pelvis is woven but never quilted. */
const navy = new THREE.Color('#162342');
const hasColour = (geo, c) => {
  const col = geo.attributes.color;
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(col.getX(i) - c.r) + Math.abs(col.getY(i) - c.g) + Math.abs(col.getZ(i) - c.b) < 1e-4) return true;
  }
  return false;
};
assert.ok(!hasColour(riderGeo.torso, navy), 'the seat no longer rides with the chest');
assert.ok(hasColour(riderGeo.pelvis, navy), 'the pelvis is trouser cloth');
assert.ok(riderGeo.pelvis.attributes.aCloth.array.every((v, i) => (i % 2 ? v === 0 : v === 1)),
  'the pelvis is woven, not baffled');

/* Flutter weights: only the jacket's hem and the upper sleeves are loose;
   the hem is fully free, the chest and the back under the pack are not. */
for (const [key, geo] of Object.entries(riderGeo)) {
  if (!geo?.attributes?.aFlap) continue;
  const f = geo.attributes.aFlap.array;
  assert.ok(f.every((v) => v >= 0 && v <= 1), key + ': flap weight in range');
  if (key !== 'torso' && key !== 'upperArm') assert.ok(f.every((v) => v === 0), key + ': rigid');
}
{
  const p = riderGeo.torso.attributes.position;
  const f = riderGeo.torso.attributes.aFlap;
  let hem = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0.17) assert.equal(f.getX(i), 0, 'the chest does not flap');
    if (p.getX(i) < -0.12 && Math.abs(p.getZ(i)) < 0.05) assert.equal(f.getX(i), 0, 'the pack pins the back');
    if (p.getY(i) < -0.08 && p.getX(i) > 0.1) hem = Math.max(hem, f.getX(i));
  }
  assert.ok(hem > 0.9, 'the front hem is free');
  const s = riderGeo.upperArm.attributes.aFlap.array;
  assert.ok(Math.max(...s) > 0.25 && Math.max(...s) < 0.4, 'the sleeves stir a little');
}

/* The board: a deck about a centimetre thick, whose top is where the
   bindings and feet were moved to, whose base is where it always was, and
   whose steel edges sit flush in the base corners instead of hanging below. */
{
  const { DECK, DECK_TOP, HALF_WIDTH } = rider;
  const at = (z) => DECK.reduce((a, b) => (Math.abs(b.z - z) < Math.abs(a.z - z) ? b : a));
  const waist = at(0);
  assert.ok(waist.t >= 0.011 && waist.t <= 0.015, 'deck thickness at the waist');
  assert.ok(at(-0.8).t < waist.t * 0.5, 'deck tapers towards the tips');
  const binding = at(rider.FOOT_Z);
  assert.ok(Math.abs(binding.b + binding.t - (DECK_TOP - 0.001)) < 0.002, 'bindings bolt onto the deck top');
  for (let i = 1; i < DECK.length; i++) assert.ok(DECK[i].z > DECK[i - 1].z, 'stations run nose to tail');
  const b = riderGeo.board;
  b.computeBoundingBox();
  const lowest = Math.min(...DECK.map((s) => s.b));
  assert.ok(b.boundingBox.min.y > lowest - 0.001, 'nothing hangs below the base');
  const steel = new THREE.Color('#aeb6c0');
  const pos = b.attributes.position;
  const col = b.attributes.color;
  let edges = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(col.getX(i) - steel.r) + Math.abs(col.getY(i) - steel.g) < 1e-4) {
      edges++;
      assert.ok(Math.abs(pos.getX(i)) <= HALF_WIDTH + 0.002, 'the steel edges are flush with the rails');
    }
  }
  assert.ok(edges > 100, 'the board has steel edges');
}

/* The rig itself, driven headlessly through a carve, a hard stop, three
   grabs, a skidded landing and a left and right turn. Every matrix stays
   finite; the ankles stay in the bindings on the thinner deck; the indy's
   hand still arrives on the toe edge; the head leads the turn it is in; a
   hard stop pitches the chest over the nose and lets it back; and a breath
   never shears the head. */
{
  const prevDocument = globalThis.document;
  globalThis.document = { createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }),
  }) };
  const headless = { ...THREE, TextureLoader: class { load() { return new THREE.Texture(); } } };
  const model = rider.createRiderModel(headless, {
    apply: (m) => m,
    // The headlamp draws into the same fog as everything else.
    uniforms: { uSkyHaze: { value: new THREE.Color() }, uFogNear: { value: 0 }, uFogFar: { value: 1 } },
  });
  globalThis.document = prevDocument;
  const V = THREE.Vector3;
  const r = {
    pos: new V(), vel: new V(0, 0, -15), yaw: 0, state: 'ride', grounded: true, fallTimer: 0,
    touchdownIn: Infinity, grab: 0, grabKind: 0, tucking: false, pushing: false, charging: false,
    charge: 0, lateral: 0, switchStance: false, press: 0, pressEnd: -1, compression: 0.33,
    carveLoad: 0, edge: 0, bend: 0, slide: 0, spinVel: 0, tumble: 0, flip: 0, flipGlide: 0,
    normal: new V(0, 1, 0), airUp: null, airTime: 0, roll: 0, gLoad: 1, pushPhase: 0,
    world: { height: () => 0 },
    get speed() { return this.vel.length(); },
  };
  const find = (pred) => {
    let hit = null;
    model.root.traverse((o) => {
      if (hit || !o.isMesh) return;
      o.geometry.computeBoundingBox();
      if (pred(o.geometry.boundingBox)) hit = o;
    });
    return hit;
  };
  const board = model.root.children.find((c) => c.name === 'rider-board');
  const headMesh = find((bb) => Math.abs(bb.max.y - 0.298) < 1e-3);
  const torsoMesh = model.root.getObjectByName('rider-torso');
  const fores = [];
  const shins = [];
  model.root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    if (Math.abs(o.geometry.boundingBox.min.y + 0.352) < 1e-3) fores.push(o.parent);
    if (Math.abs(o.geometry.boundingBox.min.y + 0.372) < 1e-3) shins.push(o.parent);
  });
  assert.equal(fores.length, 2, 'two forearms');
  assert.equal(shins.length, 2, 'two shins');
  assert.ok(model.root.getObjectByName('rider-pelvis')?.parent === torsoMesh.parent.parent,
    'the pelvis hangs off the hips, not the torso');
  const dt = 1 / 60;
  const run = (n, f) => {
    for (let i = 0; i < n; i++) {
      if (f) f(i);
      r.pos.addScaledVector(r.vel, dt);
      model.update(r, dt);
      model.root.updateMatrixWorld(true);
      model.root.traverse((o) => assert.ok(o.matrixWorld.elements.every(Number.isFinite), 'finite rig'));
    }
  };
  const turn = (rate) => (i) => {
    r.yaw += rate * dt;
    r.vel.set(Math.sin(r.yaw) * 15, 0, -Math.cos(r.yaw) * 15);
  };
  run(60);
  // ankles on the bindings
  for (const shin of shins) {
    const ankle = shin.localToWorld(new V(0, -0.40, 0));
    const want = [-1, 1].map((s) => board.localToWorld(new V(rider.FOOT_X, rider.ANKLE_Y, s * rider.FOOT_Z)));
    assert.ok(Math.min(...want.map((w) => w.distanceTo(ankle))) < 0.005, 'ankle in its binding');
  }
  // a breath scales the jacket only: the head's frame stays orthonormal
  const e = headMesh.matrixWorld.elements;
  const col = (k) => new V(e[k], e[k + 1], e[k + 2]);
  for (const k of [0, 4, 8]) assert.ok(Math.abs(col(k).length() - 1) < 1e-6, 'head unscaled');
  assert.ok(Math.abs(col(0).dot(col(4))) < 1e-6 && Math.abs(col(4).dot(col(8))) < 1e-6, 'head unsheared');
  assert.ok(torsoMesh.scale.x !== 1 || torsoMesh.scale.z !== 1, 'the chest still breathes');
  // The head leads a turn, and by no more than the cap. The rig is turned
  // by −yaw, so a rising physics yaw turns the rig clockwise from above and
  // a head leading it sits further clockwise still: its own Y rotation goes
  // negative. Both turns are compared so the stance's own offset cancels.
  const head = headMesh.parent;
  run(40, turn(0.8));
  const rising = head.rotation.y;
  run(80, turn(-0.8));
  const falling = head.rotation.y;
  assert.ok(falling - rising > 0.3 && falling - rising < 0.75,
    'the head turns into the turn: ' + (falling - rising));
  run(60, turn(0));
  // a hard stop throws the chest over the leading foot, then lets it back
  const torso = torsoMesh.parent;
  const cruise = torso.rotation.x;
  let deepest = 0;
  run(12, () => { r.vel.multiplyScalar(0.9); deepest = Math.min(deepest, torso.rotation.x - cruise); });
  assert.ok(deepest < -0.02, 'braking pitches him forwards: ' + deepest);
  r.vel.set(0, 0, -2);
  run(120);
  const settled = torso.rotation.x;
  run(30);
  assert.ok(Math.abs(torso.rotation.x - settled) < 0.01, 'the follow-through settles');
  // the indy still lands on the toe edge on the thinner board
  r.state = 'air'; r.grounded = false; r.grab = 1; r.grabKind = 0;
  run(60);
  const P = rider.POSE.grabs[0].point;
  const edge = board.localToWorld(new V(P[0], P[1], P[2]));
  const reach = Math.min(...fores.map((f) => f.localToWorld(new V(0, -0.29, 0)).distanceTo(edge)));
  assert.ok(reach < 0.01, 'the indy hand reaches the toe edge: ' + reach);
  for (const kind of [1, 2]) { r.grabKind = kind; run(30); }
  r.grab = 0; r.state = 'ride'; r.grounded = true; r.vel.set(0, 0, -6);
  run(60);

  /* The headlamp, on a plane falling away down -z. Dark by day; at night the
     beam lands where a ray dropped `drop` below the line of travel lands,
     the lit fan lies its lift above the snow with the snow's own normal, and
     the snowfall's shared uniforms carry the same level. */
  {
    const lamp = model.headlamp;
    const grade = 0.3;
    const height = (x, z) => grade * z;
    r.world = { height };
    r.normal = new V(0, 1, -grade).normalize();
    r.heading = new V(0, 0, -1);
    r.right = new V(1, 0, 0);
    r.pos.set(0, 0, 0);
    r.vel.set(0, -grade * 15, -15);
    const camera = { position: new V(0, 3, 6) };
    const night = (value, frames) => {
      for (let i = 0; i < frames; i++) {
        r.pos.addScaledVector(r.vel, dt);
        r.pos.y = height(r.pos.x, r.pos.z);
        camera.position.set(r.pos.x, r.pos.y + 3, r.pos.z + 6);
        model.update(r, dt, { night: value, snow: 0.5 }, camera);
      }
    };
    night(0, 30);
    assert.ok(lamp.level < 0.002 && !lamp.beam.visible && !lamp.pool.visible
      && lamp.uniforms.uLamp.value.w === 0, 'no lamp by day');
    night(1, 120);
    assert.ok(lamp.level > 0.99, 'the lamp is up at night: ' + lamp.level);
    const d = lamp.debug();
    assert.ok(d.hit, 'the beam reaches the snow');
    const o = lamp.origin;
    const hit = o.clone().addScaledVector(lamp.direction, d.distance);
    assert.ok(Math.abs(hit.y - height(hit.x, hit.z)) < 0.05, 'the march ends on the snow');
    const above = (o.y - height(o.x, o.z)) * r.normal.y;
    const expect = above / Math.sin(lampModule.HEADLAMP.drop);
    assert.ok(Math.abs(d.distance - expect) < expect * 0.1,
      `the beam lands at ${d.distance}, a dropped ray at ${expect}`);
    const fan = lamp.pool.children[0].geometry.attributes;
    for (let i = 0; i < fan.position.count; i++) {
      const lift = fan.position.getY(i) - height(fan.position.getX(i), fan.position.getZ(i));
      assert.ok(Math.abs(lift - 0.1) < 1e-4, 'the lit fan lies on the snow');
      const n = new V().fromBufferAttribute(fan.normal, i);
      assert.ok(n.dot(r.normal) > 0.999, 'with the snow\'s normal');
    }
    assert.ok(lamp.uniforms.uLamp.value.clone().sub(new THREE.Vector4(o.x, o.y, o.z, lamp.level))
      .length() < 1e-9, 'the snowfall sees the same lamp');
  }
}

const { growCardSpruce, SPRUCE_LAYOUT, rootRing } = await load('spruce.js');
const spec = { whorls: [7, 10], perWhorl: [4, 6], bareTo: 0.12,
  reach: 0.21, liftLow: -0.1, liftHigh: 0.5, droop: 0.3, snow: 0.65, spire: 1.5, flag: 0.25 };
let treeTriangles = 0;
for (let i = 0; i < 20; i++) {
  const tree = growCardSpruce(THREE, i * 7121, spec, 8 + i);
  const count = valid('tree.' + i, tree);
  treeTriangles += count;
  assert.ok(count < 1000, 'bounded tree complexity');
  assert.ok(tree.boundingBox.max.x - tree.boundingBox.min.x < (8 + i) * 0.8,
    'conifer crowns leave a readable downhill corridor');
  const again = growCardSpruce(THREE, i * 7121, spec, 8 + i);
  assert.deepEqual(tree.attributes.position.array, again.attributes.position.array, 'seeded model stability');
}
assert.ok(treeTriangles <= 7354, 'crossing needle curtains stay within the original tree budget');

// The forest beds every tree against the snow its buried root ring reaches
// (props.js), from what `rootRing` says; the ring has to be exactly there.
for (const h of [4, 12, 26]) {
  const tree = growCardSpruce(THREE, 4242 + h, spec, h);
  const own = tree.attributes.surfaceOwn.array;
  const at = tree.attributes.position.array;
  let reach = 0;
  let depth = 0;
  for (let i = 0; i < own.length; i++) {
    assert.ok(own[i] >= 0, 'no solid-snow mound at the foot');
    if (Math.abs(own[i] - 0.35) > 1e-6) continue;
    reach = Math.max(reach, Math.hypot(at[i * 3], at[i * 3 + 2]));
    depth = Math.max(depth, -at[i * 3 + 1]);
  }
  const ring = rootRing(h);
  assert.ok(reach <= ring.reach * 1.01 && reach > ring.reach * 0.6, `root reach ${reach} within rootRing ${ring.reach}`);
  assert.ok(Math.abs(depth - ring.depth) < 1e-6, `root depth ${depth} is rootRing's ${ring.depth}`);
}

// Snow replaces the photographed bough surface instead of adding a floating
// copy. A heavier snow load must not double stems, polygons, or card seams.
const greenTree = growCardSpruce(THREE, 98237, { ...spec, snow: 0, spire: 0 }, 14);
const snowyTree = growCardSpruce(THREE, 98237, { ...spec, snow: 1, spire: 0 }, 14);
assert.deepEqual(snowyTree.attributes.position.array, greenTree.attributes.position.array,
  'snow load preserves one branch surface and the geometry budget');
const branchStart = Array.from(greenTree.attributes.surfaceOwn.array).indexOf(1);
assert.ok(branchStart >= 0);
const snowOwn = snowyTree.attributes.surfaceOwn.array;
const branchPos = snowyTree.attributes.position;
const greenUV = greenTree.attributes.uv;
const snowUV = snowyTree.attributes.uv;
let loadedBranches = 0;
let curtains = 0;
for (let first = branchStart; first < branchPos.count;) {
  const snowy = snowOwn[first] === 0;
  if (snowy) loadedBranches++;
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(branchPos.array[first * 3 + axis], branchPos.array[(first + 6) * 3 + axis],
      'the two half-cells meet at one branch stem');
    assert.equal(branchPos.array[(first + 5) * 3 + axis], branchPos.array[(first + 10) * 3 + axis],
      'the folded bough shares one tip');
  }
  for (let i = first; i < first + 12; i++) {
    assert.equal(snowUV.getX(i), greenUV.getX(i), 'frost keeps its half-cell instead of repeating a whole sprig');
    const expectedV = greenUV.getY(i) - (snowy ? SPRUCE_LAYOUT.frostDrop : 0);
    assert.ok(Math.abs(snowUV.getY(i) - expectedV) < 1e-6, 'green and frost share stem-to-tip atlas mapping');
  }
  first += 12;
  // Full-width cells mark the optional underside sprig; the two folded
  // halves above each start at the atlas cell's middle instead.
  const curtain = first < branchPos.count && SPRUCE_LAYOUT.cells.some(cell =>
    Math.min(Math.abs(greenUV.getX(first) - cell.u0), Math.abs(greenUV.getX(first) - cell.u1)) < 1e-6);
  if (curtain) {
    curtains++;
    for (let i = first; i < first + 6; i++) {
      assert.equal(snowOwn[i], 1, 'underside needles remain sheltered beneath the snow load');
      assert.equal(snowUV.getY(i), greenUV.getY(i), 'curtain never duplicates the snow surface');
    }
    first += 6;
  }
}
assert.ok(loadedBranches > 3, 'exercise multiple snow-loaded boughs');
assert.ok(curtains > 3, 'selected boughs carry actual crossing volume');

const { bakeTexturedGeometry } = await load('importedModels.js');
const scene = new THREE.Group();
for (let i = 0; i < 2; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshBasicMaterial());
  mesh.position.set(i * 4, i, -i);
  mesh.scale.set(1 + i, 0.5, 1);
  mesh.name = `part_${i}`;
  scene.add(mesh);
}
const baked = bakeTexturedGeometry(THREE, scene);
assert.equal(valid('indexed scan', baked), 24);
assert.equal(baked.attributes.position.count, 48);
assert.equal(baked.index.count, 72);
assert.equal(baked.boundingBox.max.x, 5);
// A set file feeds one pool per named node.
const one = bakeTexturedGeometry(THREE, scene, 'part_1');
assert.equal(valid('one node of a set', one), 12);
assert.equal(one.boundingBox.min.x, 3, 'only the named node is baked');
/* A scan proxy shipped faceted — one normal per face, made for a normal
   map nobody loads — is baked smooth, while a box's edges, sharper than
   the crease, stay as hard as they were. A geodesic sphere of 320 unwelded
   faces given flat normals is such a proxy, a little coarser than the real
   ones. */
{
  const ico = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 2);
  geo.computeVertexNormals();   // unwelded, so these are its faces' own
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  ico.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
  const offRadial = (g) => {
    const p = g.attributes.position, n = g.attributes.normal;
    let worst = 0;
    for (let i = 0; i < p.count; i++) {
      const radial = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      worst = Math.max(worst, radial.angleTo(new THREE.Vector3().fromBufferAttribute(n, i)));
    }
    return THREE.MathUtils.radToDeg(worst);
  };
  const flat = offRadial(geo);
  const smooth = offRadial(bakeTexturedGeometry(THREE, ico));
  assert.ok(flat > 5 && smooth < flat / 4, `faceted proxy smoothed: ${flat.toFixed(1)}° off the sphere → ${smooth.toFixed(1)}°`);
  const box = baked.attributes.normal;
  const authored = new THREE.BoxGeometry(1, 2, 3).attributes.normal;
  for (let i = 0; i < authored.count; i++) {
    assert.ok(Math.abs(box.getX(i) - authored.getX(i)) + Math.abs(box.getY(i) - authored.getY(i))
      + Math.abs(box.getZ(i) - authored.getZ(i)) < 1e-6, 'a box keeps its hard edges');
  }
}

/* The race gate and the sapling impostors. The gate's fabric must be the only
   thing that flutters, and pinned at both poles; each sapling is three cards
   of eight triangles whose texture rectangles sit inside the atlas and keep
   the aspect ratio of the frame the tree was drawn in (1024 × 2048). */
const props = await load('props.js',
  ['raceGatePanelGeometry', 'saplingCardGeometry', 'SAPLINGS', 'GATE_PANEL', 'SWAY', 'GUST_X', 'GUST_Z']);
// The forest's gust field is sampled at the same wavelengths `setAir` wraps
// its drift at — otherwise the wrap is a visible jump across every tree.
assert.ok(props.SWAY.includes(`mod(n64At.x, ${props.GUST_X.toFixed(1)})`)
  && props.SWAY.includes(`mod(n64At.y, ${props.GUST_Z.toFixed(1)})`), 'gust wavelengths agree');
assert.ok(props.SWAY.includes('uAirDrift') && props.SWAY.includes('inversesqrt'), 'travelling, height-tuned sway');
const panel = props.raceGatePanelGeometry(THREE);
assert.ok(valid('race gate panel', panel) <= 400, 'race gate triangle budget');
const flutter = panel.attributes.aFlutter;
const panelPos = panel.attributes.position;
let moving = 0;
for (let i = 0; i < flutter.count; i++) {
  const x = panelPos.getX(i);
  if (flutter.getX(i) > 0) moving++;
  if (Math.abs(x) < 0.03 || Math.abs(x - props.GATE_PANEL.width) < 0.03) {
    assert.equal(flutter.getX(i), 0, 'poles and collars never flutter');
  }
}
assert.ok(moving > 20, 'the fabric ripples');
for (const spec of props.SAPLINGS) {
  const cards = props.saplingCardGeometry(THREE, spec);
  assert.equal(valid('sapling ' + spec.name, cards), 24, 'three cards, eight triangles each');
  assert.ok(Math.abs(cards.boundingBox.max.y - spec.H) < 1e-6, spec.name + ': drawn to its height');
  for (const [u0, v0, u1, v1] of spec.views) {
    assert.ok(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1 && u1 > u0 && v1 > v0, spec.name + ': rect in atlas');
    const texelAspect = ((u1 - u0) * 1024) / ((v1 - v0) * 2048);
    assert.ok(Math.abs(texelAspect / ((2 * spec.R) / spec.H) - 1) < 0.02, spec.name + ': view keeps its aspect');
  }
}

const namespace = { ...THREE, TextureLoader: class {
  load() { return new THREE.Texture(); }
} };
const mountainLife = await load('mountainLife.js');
const resort = new THREE.Scene();
const life = mountainLife.createMountainLife(namespace, resort, { apply: m => m });
const player = { pos: new THREE.Vector3(0, 0, -300), distance: 300, state: 'ride', grace: 10 };
life.update(1 / 60, player, { night: 0, snow: 0 });
let meshes = 0;
resort.traverse(node => {
  if (!node.isMesh) return;
  meshes++;
  valid('resort.' + meshes, node.geometry);
  assert.ok(node.matrix.elements.every(Number.isFinite));
  if (node.isInstancedMesh) assert.ok(node.instanceMatrix.array.every(Number.isFinite));
});
assert.ok(meshes <= 24, 'resort draw-call budget');

/* The other riders. Everyone started uphill of the player, so the first
   update sent them all back down the hill — and past the fog, which on the
   clear day this falls back to is 560 m, so none of them popped into view.
   Then one is run into: it tumbles, and gets up again without a cut — the
   figure's attitude never jumps by more than its own tumble does in a frame. */
{
  const figures = [];
  resort.traverse((node) => {
    if (node.isGroup && node.rotation.order === 'YXZ' && node.children.filter((c) => c.isMesh).length === 2) figures.push(node);
  });
  assert.equal(figures.length, 8, 'eight riders on the piste');
  for (const f of figures) assert.ok(f.position.z <= player.pos.z - 589, 'respawned beyond the fog: ' + f.position.z);
  const victim = figures[0];
  player.pos.copy(victim.position);
  life.update(1 / 60, player, { night: 0, snow: 0 });
  player.pos.x += 60;
  const last = victim.quaternion.clone();
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    life.update(1 / 60, player, { night: 0, snow: 0 });
    worst = Math.max(worst, last.angleTo(victim.quaternion));
    last.copy(victim.quaternion);
  }
  assert.ok(worst > 0.05, 'the tumble happened');
  assert.ok(worst < 0.35, 'getting up is a movement, not a cut: ' + worst);
}
/* Welding draws the same triangles from shared vertices: every corner keeps
   every attribute bit for bit, and a pool still waiting on its scan (no
   position yet) is left alone. */
{
  const { compose, weld } = await import(new URL('js/geom.js', base).href);
  const raw = compose(THREE, [
    { geo: new THREE.IcosahedronGeometry(1, 1), color: '#4a5a50' },
    { geo: new THREE.CylinderGeometry(0.05, 0.08, 1, 8), pos: [0, 0.6, 0], color: '#3a2d25' },
  ]);
  raw.setAttribute('surfaceOwn',
    new THREE.BufferAttribute(new Float32Array(raw.attributes.position.count).fill(1), 1));
  const corners = Object.fromEntries(Object.entries(raw.attributes)
    .map(([name, a]) => [name, { size: a.itemSize, values: Array.from(a.array) }]));
  const drawn = raw.attributes.position.count;
  const welded = weld(THREE, raw);
  assert.ok(welded.index, 'welded geometry draws through an index');
  assert.equal(welded.index.count, drawn, 'every triangle kept');
  assert.ok(welded.attributes.position.count * 3 < drawn, 'shared corners merged');
  for (const [name, { size, values }] of Object.entries(corners)) {
    const a = welded.attributes[name];
    for (let k = 0; k < drawn; k++) {
      for (let c = 0; c < size; c++) {
        assert.equal(a.array[welded.index.getX(k) * size + c], values[k * size + c], 'weld ' + name);
      }
    }
  }
  const waiting = new THREE.BufferGeometry();
  assert.equal(weld(THREE, waiting), waiting, 'an empty geometry is left alone');
  assert.equal(waiting.index, null);
}

/* The modelled riders (`tools/blender/riders.py` → assets/models/riders).
   Both files parse with the game's own reader, every role in them has a
   look, every segment sits in the frame of the procedural one it replaces,
   the jacket flutters where the procedural one did, the budgets hold, the
   eight figures bake and ride — and under the rig, the knees and elbows
   face the way they bend, which is what the bend-plane roll is for. */
{
  const { parseRiderGlb } = await import(new URL('js/riderAssets.js', base).href);
  const glb = async (name) => {
    const b = await readFile(new URL('assets/models/riders/' + name, base));
    return parseRiderGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const riderNodes = await glb('rider.glb');
  const npcNodes = await glb('npcs.glb');
  assert.throws(() => parseRiderGlb(new ArrayBuffer(32)), /not a GLB/, 'a stray file is refused');

  const kit = rider.buildGeometries(THREE).kit;
  const g = rider.adoptRiderModels(THREE, riderNodes, kit.deck);
  const drawnTwice = new Set(['upperArm', 'shin']);
  let drawn = 0;
  for (const [key, geo] of Object.entries(g)) {
    const t = valid('modelled.' + key, geo);
    drawn += drawnTwice.has(key) ? 2 * t : t;
    if (key !== 'board') {
      assert.ok(geo.attributes.aCloth && geo.attributes.aFlap, 'modelled.' + key + ': cloth attributes');
    }
  }
  assert.ok(drawn <= 17000, 'modelled rider triangle budget: ' + drawn);

  const box = (geo) => { geo.computeBoundingBox(); return geo.boundingBox; };
  assert.ok(box(g.shin).max.y > 0.09 && box(g.shin).max.y < 0.11, 'the knee ball covers the bend');
  assert.ok(box(g.foreArmRear).max.y > 0.065, 'the elbow ball covers the bend');
  assert.ok(box(g.shin).min.y < -rider.ANKLE_Y + rider.DECK_TOP - 0.12, 'the gaiter falls over the boot');
  assert.ok(box(g.thighLead).max.y > 0.12, 'the thigh is domed into the seat');
  assert.ok(box(g.foreArmRear).min.y < -0.33 && box(g.foreArmRear).min.y > -0.37, 'the glove ends past the hand centre');
  assert.ok(box(g.rearBoot).max.y > rider.ANKLE_Y, 'the boot cuff rises past the ankle');
  // left and right hands, and the cargo pocket on the outside of each leg
  for (const [a, b] of [[g.foreArmLead, g.foreArmRear], [g.thighLead, g.thighRear]]) {
    assert.ok(Math.abs(box(a).min.z + box(b).max.z) < 1e-4 && Math.abs(box(a).max.z + box(b).min.z) < 1e-4,
      'lead and rear are mirror images');
  }
  assert.ok(box(g.thighRear).max.z > box(g.thighRear).max.x, 'the rear pocket is on the outside (+Z)');
  // The lamp housing sits where headlamp.js aims its beam from.
  {
    const p = g.head.attributes.position;
    let front = -Infinity;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 0.205) < 0.015 && Math.abs(p.getZ(i)) < 0.015) front = Math.max(front, p.getX(i));
    }
    assert.ok(front > 0.14 && front < 0.17, 'the lamp is on the helmet front: ' + front);
  }
  // The flutter: the hem is free, the chest and the back under the pack are not.
  {
    const p = g.torso.attributes.position;
    const f = g.torso.attributes.aFlap;
    let hem = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.10) assert.equal(f.getX(i), 0, 'the chest does not flap');
      if (p.getX(i) < -0.12 && Math.abs(p.getZ(i)) < 0.05) assert.equal(f.getX(i), 0, 'the pack pins the back');
      if (p.getY(i) < -0.15 && p.getX(i) > 0.1) hem = Math.max(hem, f.getX(i));
    }
    assert.ok(hem > 0.9, 'the front hem is free');
    const s = g.upperArm.attributes.aFlap.array;
    assert.ok(Math.max(...s) > 0.25 && Math.max(...s) < 0.4, 'the sleeves stir a little');
    for (const key of ['pelvis', 'head', 'foreArmLead', 'thighLead', 'shin', 'rearBoot']) {
      assert.ok(g[key].attributes.aFlap.array.every((v) => v === 0), key + ': rigid');
    }
  }
  // The glove is woven, the gold cuff a little, the helmet and goggles not at all.
  {
    const ink = new THREE.Color('#181c24');
    const fore = g.foreArmRear;
    let glove = 0;
    for (let i = 0; i < fore.attributes.position.count; i++) {
      const c = fore.attributes.color;
      if (Math.abs(c.getX(i) - ink.r) + Math.abs(c.getY(i) - ink.g) < 1e-5) {
        glove++;
        assert.equal(fore.attributes.aCloth.getX(i), 1, 'the glove is cloth');
      }
    }
    assert.ok(glove > 50, 'the forearm ends in a glove');
    assert.ok(g.head.attributes.aCloth.array.some((v, i) => i % 2 === 0 && v === 0), 'the helmet is hard');
  }

  // Under the rig: ankles still in the bindings, and every limb rolled into
  // its bend — the knee's +X runs towards the toe edge, the elbow's behind.
  {
    const prevDocument = globalThis.document;
    globalThis.document = { createElement: () => ({
      getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }),
    }) };
    const headless = { ...THREE, TextureLoader: class { load() { return new THREE.Texture(); } } };
    const model = rider.createRiderModel(headless, {
      apply: (m) => m,
      uniforms: { uSkyHaze: { value: new THREE.Color() }, uFogNear: { value: 0 }, uFogFar: { value: 1 } },
    });
    globalThis.document = prevDocument;
    model.adopt(riderNodes);
    assert.ok(model.modelled, 'the rig reports the modelled rider');
    const V = THREE.Vector3;
    const r = {
      pos: new V(), vel: new V(0, 0, -15), yaw: 0, state: 'ride', grounded: true, fallTimer: 0,
      touchdownIn: Infinity, grab: 0, grabKind: 0, tucking: false, pushing: false, charging: false,
      charge: 0, lateral: 0, switchStance: false, press: 0, pressEnd: -1, compression: 0.33,
      carveLoad: 0, edge: 0, bend: 0, slide: 0, spinVel: 0, tumble: 0, flip: 0, flipGlide: 0,
      normal: new V(0, 1, 0), airUp: null, airTime: 0, roll: 0, gLoad: 1, pushPhase: 0,
      world: { height: () => 0 },
      get speed() { return this.vel.length(); },
    };
    for (let i = 0; i < 90; i++) {
      r.pos.addScaledVector(r.vel, 1 / 60);
      model.update(r, 1 / 60);
    }
    model.root.updateMatrixWorld(true);
    // The rig built its own copies when it adopted the file; a segment is
    // found by the shape of its buffers.
    const same = (a, b) => a.attributes.position.count === b.attributes.position.count
      && a.index?.count === b.index?.count
      && a.attributes.position.array[0] === b.attributes.position.array[0];
    const meshes = (geo) => {
      const out = [];
      model.root.traverse((o) => { if (o.isMesh && same(o.geometry, geo)) out.push(o); });
      return out;
    };
    const board = model.root.children.find((c) => c.name === 'rider-board');
    const toe = new V(1, 0, 0).transformDirection(board.matrixWorld);
    const shins = meshes(g.shin);
    assert.equal(shins.length, 2, 'both shins wear the modelled leg');
    for (const shin of shins) {
      const ankle = shin.localToWorld(new V(0, -0.40, 0));
      const want = [-1, 1].map((s) => board.localToWorld(new V(rider.FOOT_X, rider.ANKLE_Y, s * rider.FOOT_Z)));
      assert.ok(Math.min(...want.map((w) => w.distanceTo(ankle))) < 0.005, 'modelled ankle in its binding');
      const knee = new V(1, 0, 0).transformDirection(shin.matrixWorld);
      assert.ok(knee.dot(toe) > 0.3, 'the kneecap faces the toe edge: ' + knee.dot(toe));
    }
    for (const fore of [...meshes(g.foreArmLead), ...meshes(g.foreArmRear)]) {
      const elbow = new V(1, 0, 0).transformDirection(fore.matrixWorld);
      assert.ok(elbow.dot(toe) < 0, 'the point of the elbow is behind him: ' + elbow.dot(toe));
    }
    model.root.traverse((o) => assert.ok(o.matrixWorld.elements.every(Number.isFinite), 'finite modelled rig'));
  }

  // The eight figures: baked from the file in their own colours, two
  // meshes each, hung from the hip the file carries, and riding.
  {
    const { createMountainLife } = await load('mountainLife.js');
    const headless = { ...THREE, TextureLoader: class { load() { return new THREE.Texture(); } } };
    const scene = new THREE.Scene();
    const life = createMountainLife(headless, scene, { apply: (m) => m, uniforms: {} }, null, null);
    const before = [];
    scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aSheen) before.push(o); });
    life.adopt(npcNodes);
    const figures = [];
    scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aSheen) figures.push(o); });
    assert.equal(figures.length, 16, 'eight figures, two meshes each');
    assert.deepEqual(figures, before, 'the same meshes, redrawn');
    const jackets = new Set();
    for (const m of figures) {
      valid('npc', m.geometry);
      for (const a of ['color', 'aSheen', 'uv']) assert.ok(m.geometry.attributes[a], 'npc ' + a);
      jackets.add(Array.from(m.geometry.attributes.color.array.slice(0, 3)).join());
    }
    assert.ok(jackets.size > 4, 'the figures are dressed differently');
    for (let i = 0; i < figures.length; i += 2) {
      const tris = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      assert.ok(tris(figures[i]) + tris(figures[i + 1]) <= 4200, 'figure triangle budget');
    }
    for (const kind of ['skier', 'boarder']) {
      const hip = npcNodes[`npc_${kind}_body`].extras.hip;
      assert.ok(hip > 0.7 && hip < 0.95, kind + ' hip from the file');
      const body = figures.find((m) => m.parent && m.position.y === hip);
      assert.ok(body, kind + ': a body hangs at its hip');
    }
    const r = { pos: new THREE.Vector3(0, 0, -400), state: 'ride', grace: 1, fall() {} };
    life.reset(-400);
    for (let i = 0; i < 120; i++) life.update(1 / 60, r);
    for (const m of figures) {
      m.updateMatrixWorld(true);
      assert.ok(m.matrixWorld.elements.every(Number.isFinite), 'figures ride');
    }
  }
}
console.log('All model geometry checks passed.');
