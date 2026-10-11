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
  [...wildlifeNames, 'slopeUnder', 'SLOPE_ROLL', 'SLOPE_PITCH_MAX', 'SLOPE_ROLL_MAX',
    'modelledAnimal', 'HARE_LOOK', 'DEER_LOOK', 'WOLF_LOOK', 'DEER_GAIT', 'WOLF_GAIT',
    'RABBIT_EYES', 'DEER_WITHERS', 'DEER_BROWSE', 'STAG_BROWSE']);
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
  // The sculpted animals, quietly: node cannot fetch a file: URL, and the
  // modelled ones are checked below
  const realFetch = globalThis.fetch;
  const warn = console.warn;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  console.warn = () => {};
  const life = (await load('wildlife.js')).createWildlife(StubTHREE, { apply: (m) => m, uniforms: {} });
  globalThis.fetch = realFetch;
  await life.modelled;
  console.warn = warn;
  const rabbits = life.group.children[0];
  const reveal = rabbits.geometry.attributes.aReveal;
  assert.ok(reveal && rabbits.customDepthMaterial, 'hares carry an arrival value into both passes');
  const rider = { pos: new THREE.Vector3(0, 0, -600), distance: 0, speed: 0, vel: new THREE.Vector3() };
  life.update(1 / 60, rider, () => {}, () => {});
  assert.ok(rabbits.count > 0 && reveal.array[0] < 0.1, 'a hare placed this frame has not yet arrived');
  for (let i = 0; i < 80; i++) life.update(1 / 60, rider, () => {}, () => {});
  assert.equal(reveal.array[0], 1, 'a hare is fully there after its arrival time');
}

/* The modelled animals (`tools/blender/wildlife.py` → alpine-wildlife.glb).
   Every pool has its node, inside its budget, standing on the snow and
   facing −Z, with a look for every role; the hare's eye-shine sits on its
   eyes. The deer's and the wolf's legs swing: every vertex goes with one leg
   or none, never with a leg on the other side of the animal, the lower legs
   are rigid and the back is still, and a full stride at any phase stretches
   no edge by more than a few centimetres — a leg torn from its flank, or
   two legs sharing a seam, would stretch by tens. A lowered head keeps its
   muzzle, and a stag's antlers, out of the snow and never heaves its neck
   up over the withers. And the game swaps them all in over the sculpted
   ones, keeping each pool's instance buffers — or keeps the sculpted ones,
   whole, when the file does not come. */
{
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const glbUrl = new URL('assets/models/wildlife/alpine-wildlife.glb', base);
  const bytes = await readFile(glbUrl);
  const glbBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const nodes = parseGlb(glbBuffer);
  const node = (name) => {
    assert.ok(nodes[name], 'a modelled ' + name);
    return nodes[name];
  };
  const W = wildlife;
  const built = {
    hare: [W.modelledAnimal(THREE, node('wild_hare'), W.HARE_LOOK), 4500],
    deerBody: [W.modelledAnimal(THREE, node('wild_deerBody'), W.DEER_LOOK, W.DEER_GAIT), 2000],
    hindHead: [W.modelledAnimal(THREE, node('wild_hindHead'), W.DEER_LOOK), 1200],
    // the one raised budget: a royal's twelve points are most of a stag
    stagHead: [W.modelledAnimal(THREE, node('wild_stagHead'), W.DEER_LOOK), 1400],
    wolf: [W.modelledAnimal(THREE, node('wild_wolf'), W.WOLF_LOOK, W.WOLF_GAIT), 3200],
  };
  for (const [name, [g, budget]] of Object.entries(built)) {
    const tris = valid('modelled ' + name, g);
    assert.ok(tris <= budget, name + ': triangle budget ' + tris);
    assert.ok(g.attributes.color.array.every((c) => c >= 0 && c <= 1), name + ': painted');
  }
  // On the snow, symmetric, nose to −Z and tail to +Z
  const roleCentre = (n, role, side = 0) => {
    const c = [0, 0, 0];
    let k = 0;
    for (const p of n.prims.filter((q) => q.role === role)) {
      const P = p.attributes.POSITION;
      for (let i = 0; i < P.length; i += 3) {
        if (side * P[i] < 0) continue;
        c[0] += P[i]; c[1] += P[i + 1]; c[2] += P[i + 2]; k++;
      }
    }
    return c.map((x) => x / k);
  };
  for (const [name, key] of [['hare', 'wild_hare'], ['deerBody', 'wild_deerBody'], ['wolf', 'wild_wolf']]) {
    const g = built[name][0];
    g.computeBoundingBox();
    const bb = g.boundingBox;
    assert.ok(Math.abs(bb.min.y) < 0.01, name + ': feet on the snow');
    assert.ok(Math.abs(bb.min.x + bb.max.x) < 0.01, name + ': left and right alike');
    assert.ok(-bb.min.z > 0.3 && bb.max.z > 0.25, name + ': a body along z');
    if (name !== 'deerBody') assert.ok(roleCentre(node(key), 'nose')[2] < bb.min.z + 0.03, name + ': nose first');
  }
  // The eye-shine is on the eyes: each offset is its eye's centre
  const eyes = node('wild_hare').extras.eyes;
  for (const [i, side] of [[0, -1], [1, 1]]) {
    const c = roleCentre(node('wild_hare'), 'eye', side);
    assert.ok(Math.hypot(c[0] - eyes[i][0], c[1] - eyes[i][1], c[2] - eyes[i][2]) < 0.006, 'the glint is in the eye');
  }
  // The legs
  for (const [name, gait, foot, still] of [['deerBody', W.DEER_GAIT, 0.30, 1.0], ['wolf', W.WOLF_GAIT, 0.15, 0.62]]) {
    const g = built[name][0];
    const pivots = node(name === 'wolf' ? 'wild_wolf' : 'wild_deerBody').extras.legs;
    const pos = g.attributes.position;
    const limb = g.attributes.aLimb;
    assert.ok(limb, name + ': the legs can swing');
    // which of the four legs (fore −X, fore +X, hind −X, hind +X) a vertex
    // swings with, by its pivot and phase; −1 for none
    const legOf = (i) => {
      if (limb.getZ(i) === 0) return -1;
      const L = pivots.findIndex((pv, j) => Math.abs(pv[0] - limb.getX(i)) < 1e-6
        && Math.abs(pv[1] - limb.getY(i)) < 1e-6 && Math.abs(gait[j] - limb.getW(i)) < 1e-6);
      assert.ok(L >= 0, name + ': a swinging vertex belongs to one of the four legs');
      return L;
    };
    const legs = new Set();
    for (let i = 0; i < pos.count; i++) {
      const w = limb.getZ(i);
      assert.ok(w >= 0 && w <= 1, name + ': a swing weight');
      const L = legOf(i);
      if (L >= 0) {
        legs.add(L);
        assert.ok(pos.getX(i) * (L % 2 ? 1 : -1) > -0.005, name + ': no vertex swings with the other side');
        assert.ok(pos.getZ(i) * pivots[L][1] > 0, name + ': fore legs in front, hind legs behind');
      }
      if (pos.getY(i) < foot) assert.equal(w, 1, name + ': the lower leg is rigid');
      if (pos.getY(i) > still) assert.equal(w, 0, name + ': the back stays still');
    }
    assert.equal(legs.size, 4, name + ': four legs');
    // a full stride, as the shader does it, at four phases
    const index = g.index.array;
    let worst = 0;
    for (const t of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
      const moved = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const a = 0.5 * limb.getZ(i) * Math.sin(t + limb.getW(i));
        const dy = pos.getY(i) - limb.getX(i);
        const dz = pos.getZ(i) - limb.getY(i);
        moved[i * 3] = pos.getX(i);
        moved[i * 3 + 1] = limb.getX(i) + Math.cos(a) * dy - Math.sin(a) * dz;
        moved[i * 3 + 2] = limb.getY(i) + Math.sin(a) * dy + Math.cos(a) * dz;
      }
      for (let f = 0; f < index.length; f += 3) {
        for (let e = 0; e < 3; e++) {
          const i = index[f + e];
          const j = index[f + (e + 1) % 3];
          const before = Math.hypot(pos.getX(i) - pos.getX(j), pos.getY(i) - pos.getY(j), pos.getZ(i) - pos.getZ(j));
          const after = Math.hypot(moved[i * 3] - moved[j * 3], moved[i * 3 + 1] - moved[j * 3 + 1],
            moved[i * 3 + 2] - moved[j * 3 + 2]);
          worst = Math.max(worst, Math.abs(after - before));
        }
      }
    }
    console.log('  ' + name + ': a full stride stretches no edge by more than ' + (worst * 100).toFixed(1) + ' cm');
    assert.ok(worst < 0.04, name + ': a stride tears nothing (' + worst.toFixed(3) + ' m)');
  }
  // The heads: alert and browsing, muzzle and antlers clear of the snow and
  // the neck under the withers
  const withers = node('wild_deerBody').extras.withers;
  assert.ok(node('wild_stagHead').prims.some((p) => p.role === 'antler')
    && !node('wild_hindHead').prims.some((p) => p.role === 'antler'), 'antlers on the stag only');
  for (const [name, key, browse] of [['hind', 'wild_hindHead', W.DEER_BROWSE], ['stag', 'wild_stagHead', W.STAG_BROWSE]]) {
    for (const angle of [0, browse]) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      let low = Infinity;
      let lowAntler = Infinity;
      let hump = -Infinity;
      for (const p of node(key).prims) {
        const P = p.attributes.POSITION;
        for (let i = 0; i < P.length; i += 3) {
          const y = P[i + 1] * c - P[i + 2] * s;
          const z = P[i + 1] * s + P[i + 2] * c;
          if (p.role === 'antler') lowAntler = Math.min(lowAntler, y);
          else low = Math.min(low, y);
          if (z > 0.05) hump = Math.max(hump, y);
        }
      }
      assert.ok(withers[1] + low > 0.15, name + ': the muzzle stays out of the snow');
      if (name === 'stag') assert.ok(withers[1] + lowAntler > 0.15, 'a browsing stag keeps its antlers out of the snow');
      assert.ok(hump < 0.15, name + ': no hump over the withers');
    }
  }
  const antlerBox = new THREE.Box3();
  for (const p of node('wild_stagHead').prims.filter((q) => q.role === 'antler')) {
    const P = p.attributes.POSITION;
    for (let i = 0; i < P.length; i += 3) antlerBox.expandByPoint(new THREE.Vector3(P[i], P[i + 1], P[i + 2]));
  }
  assert.ok(antlerBox.max.x - antlerBox.min.x > 0.6 && antlerBox.max.y - antlerBox.min.y > 0.6,
    'a royal spread, not a pair of spikes');

  // Swapped in, keeping every pool's instance buffers…
  const StubTHREE = { ...THREE, TextureLoader: class { load() { return new THREE.Texture(); } } };
  const shading = { apply: (m) => m, uniforms: {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => glbBuffer.slice(0) });
  const life = W.createWildlife(StubTHREE, shading);
  globalThis.fetch = realFetch;
  const [rabbits, deerBodies, deerHeads, stagHeads, wolves] = life.group.children;
  const kept = [rabbits, deerBodies, deerHeads, stagHeads, wolves].map((m) => m.geometry.attributes.aReveal);
  const strides = [deerBodies, wolves].map((m) => m.geometry.attributes.aGait);
  assert.equal(await life.modelled, true, 'the modelled animals arrive');
  const pools = [[rabbits, 'hare'], [deerBodies, 'deerBody'], [deerHeads, 'hindHead'], [stagHeads, 'stagHead'],
    [wolves, 'wolf']];
  pools.forEach(([mesh, name], i) => {
    assert.equal(mesh.geometry.index.count, built[name][0].index.count, name + ': drawn modelled');
    assert.equal(mesh.geometry.attributes.aReveal, kept[i], name + ': keeps its arrival buffer');
  });
  assert.equal(deerBodies.geometry.attributes.aGait, strides[0], 'the deer keep their stride buffer');
  assert.equal(wolves.geometry.attributes.aGait, strides[1], 'the wolves keep theirs');
  assert.deepEqual(W.RABBIT_EYES, eyes, 'the eye-shine follows the modelled hare');
  assert.deepEqual(W.DEER_WITHERS, withers, 'the heads hang from the modelled withers');
  const rider = { pos: new THREE.Vector3(0, 0, -600), distance: 2000, speed: 0, vel: new THREE.Vector3() };
  life.placeHerd(rider);
  life.placePack(rider);
  for (let i = 0; i < 30; i++) life.update(1 / 60, rider, () => {}, () => {});
  assert.ok(rabbits.count > 0 && deerBodies.count > 0 && wolves.count > 0, 'the modelled pools are drawn');
  for (const mesh of [rabbits, deerBodies, deerHeads, stagHeads, wolves]) {
    assert.ok(mesh.instanceMatrix.array.every(Number.isFinite), 'every modelled instance is placed');
  }
  // …or not at all: without the file every pool stays sculpted, whole.
  const warn = console.warn;
  console.warn = () => {};
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const bare = W.createWildlife(StubTHREE, shading);
  globalThis.fetch = realFetch;
  const sculpted = bare.group.children.map((m) => m.geometry.index?.count);
  assert.equal(await bare.modelled, false, 'a missing file is not fatal');
  console.warn = warn;
  assert.deepEqual(bare.group.children.map((m) => m.geometry.index?.count), sculpted, 'the sculpted animals stay');
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

const huts = await load('huts.js', ['hutGeometry', 'paneGeometry', 'siteAt', 'hutModelGeometry',
  'CHIMNEY', 'TERRACE_DECK', 'PLINTH_DEPTH', 'HUT_BOXES']);
for (const key of ['hutGeometry', 'paneGeometry']) valid(key, huts[key](THREE));
/* The modelled hut (`assets/models/huts/mountain-hut.glb`, built by
   `tools/blender/hut.py`), read with the game's own reader and built into
   the shell's geometry the way `createHuts` builds it. */
const hutNode = await (async () => {
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const b = await readFile(new URL('assets/models/huts/mountain-hut.glb', base));
  return parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).hut;
})();
assert.ok(hutNode, 'mountain-hut.glb has its hut');
const hutModel = huts.hutModelGeometry(THREE, hutNode);
hutModel.computeBoundingBox();
const hutBox = hutModel.boundingBox;
{
  const tris = valid('hutModel', hutModel);
  assert.ok(tris >= 4000 && tris <= 6000, 'modelled hut triangle budget: ' + tris);
  for (const p of hutNode.prims) {
    assert.ok(huts.HUT_LOOKS[p.role], 'every role of the hut has a look: ' + p.role);
    assert.ok(p.attributes.TEXCOORD_0 && p.attributes._SHADE, p.role + ': UVs and shade');
    assert.ok(p.attributes._SHADE.every((s) => s > 0.2 && s <= 1.2), p.role + ': shade in range');
  }
  // the two huts are drawn by one material: both carry what it reads
  const proc = huts.hutGeometry(THREE);
  assert.ok(proc.attributes.aHutKind.array.every((k) => k === 0), 'the procedural hut is classified by colour');
  assert.ok(hutModel.attributes.aHutKind.array.every((k) => Number.isInteger(k) && k >= 1 && k <= 8),
    'every modelled surface says what it is');

  /* The contracts the rest of huts.js and config.js lean on, which the file
     carries as extras: the smoke leaves from the chimney's top, the deck is
     where the site search lifts it to, the stone goes as deep as the site
     search assumed it does, and the glass is exactly HUT_LIGHT's. */
  const { HUT_LIGHT } = await import(new URL('js/config.js', base).href);
  const ex = hutNode.extras;
  const C = huts.CHIMNEY;
  assert.ok(Math.hypot(ex.chimney[0] - C.x, ex.chimney[1] - C.y, ex.chimney[2] - C.z) < 1e-3,
    'the smoke leaves from the modelled chimney');
  assert.ok(hutBox.max.y < C.y && hutBox.max.y > C.y - 0.2, 'nothing stands over the smoke, and the cap is under it');
  assert.equal(ex.deck, huts.TERRACE_DECK);
  assert.equal(ex.plinthDepth, huts.PLINTH_DEPTH);
  assert.ok(Math.abs(hutBox.min.y + huts.PLINTH_DEPTH) < 0.01, 'the stone goes as deep as the site search assumes');
  assert.equal(ex.glass.front, HUT_LIGHT.front);
  assert.equal(ex.glass.side, HUT_LIGHT.side);
  const panes = (list) => list.map((p) => [p.at[0], p.at[1], p.size[0], p.size[1]]);
  assert.deepEqual(ex.glass.panesFront, panes(HUT_LIGHT.glass.front), 'front glass is HUT_LIGHT\'s');
  assert.deepEqual(ex.glass.panesSide, panes(HUT_LIGHT.glass.side), 'side glass is HUT_LIGHT\'s');

  /* …and the windows really are there: a ray from the room out through
     each pane (clear of its glazing bars) meets nothing of the hut, so the
     light the shader sends through that glass leaves through a hole in the
     model; and a ray a little beside each pane meets the wall, so the hole
     is in a wall rather than in the air. */
  const pos = hutModel.attributes.position.array;
  const idx = hutModel.index.array;
  const hits = (o, d, far) => {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
      const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const s = [o[0] - pos[a], o[1] - pos[a + 1], o[2] - pos[a + 2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (dist > 0 && dist < far) return true;
    }
    return false;
  };
  const glassRays = [
    ...HUT_LIGHT.glass.front.map((p) => ({ p, at: (u, v) => [u, v, HUT_LIGHT.front + 0.15], out: [0, 0, -1] })),
    ...HUT_LIGHT.glass.side.map((p) => ({ p, at: (u, v) => [HUT_LIGHT.side - 0.15, v, u], out: [1, 0, 0] })),
  ];
  for (const { p, at, out } of glassRays) {
    for (const [fu, fv] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      const o = at(p.at[0] + fu * p.size[0], p.at[1] + fv * p.size[1]);
      assert.ok(!hits(o, out, 0.9), `light leaves through the pane at ${p.at} (${fu}, ${fv})`);
    }
    const beside = at(p.at[0] + p.size[0] / 2 + 0.3, p.at[1]);
    assert.ok(hits(beside, out, 0.9), `the pane at ${p.at} is in a wall`);
  }

  /* The terrace boards' top is the deck the site search plants the hut by,
     and everything a rider could run into below head height is inside the
     collision boxes, seen from above — the snow excepted. */
  let deckTop = -Infinity;
  for (const p of hutNode.prims) {
    const P = p.attributes.POSITION;
    for (let i = 0; i < P.length; i += 3) {
      const [x, y, z] = [P[i], P[i + 1], P[i + 2]];
      if (p.role === 'board' && z < -2.5 && z > -4.3 && Math.abs(x) < 2.6 && y < 0.7) deckTop = Math.max(deckTop, y);
      if (y > 2.5 || huts.HUT_LOOKS[p.role][1] === 1) continue;
      assert.ok(huts.HUT_BOXES.some((b) => Math.abs(x - b.x) <= b.hw + 0.02 && Math.abs(z - b.z) <= b.hd + 0.02),
        `${p.role} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) is inside a collision box`);
    }
  }
  assert.ok(Math.abs(deckTop - huts.TERRACE_DECK) < 0.002, 'the deck is at TERRACE_DECK: ' + deckTop);
}
/* The props keep off a hut's ground, so that ground has to cover the hut:
   every corner of the modelled hut — its eaves' cornices, the woodpile, the
   lantern on the terrace rail, the purlin heads behind — turned the way the
   hut was turned, and not the open snow beside it. */
{
  let found = 0;
  const { min, max } = hutBox;
  for (let b = 1; b < 40 && found < 6; b++) {
    const h = huts.siteAt(b);
    if (!h) continue;
    found++;
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    for (const [lx, lz] of [[min.x, min.z], [max.x, min.z], [min.x, max.z], [max.x, max.z]]) {
      assert.ok(huts.onHutGround(h.x + lx * c + lz * s, h.z - lx * s + lz * c),
        `hut ${b}: corner (${lx}, ${lz}) is on its ground`);
    }
    assert.ok(!huts.onHutGround(h.x + 12 * c, h.z - 12 * s), `hut ${b}: open snow beside it is not`);
  }
  assert.ok(found >= 3, 'the first blocks grow huts');
}
const rider = await load('riderModel.js',
  ['buildGeometries', 'POSE', 'DECK', 'DECK_TOP', 'ANKLE_Y', 'FOOT_X', 'FOOT_Z', 'HALF_WIDTH',
    'ARMS', 'TRUNK', 'WRIST']);
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
  // The forearms and the hands on their wrists are named; the lead ones are
  // on the nose-side shoulder whatever the stance.
  const fores = ['lead', 'rear'].map((n) => model.root.getObjectByName('rider-forearm-' + n)?.parent);
  const gloves = ['lead', 'rear'].map((n) => model.root.getObjectByName('rider-hand-' + n));
  const shins = [];
  model.root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    if (Math.abs(o.geometry.boundingBox.min.y + 0.372) < 1e-3) shins.push(o.parent);
  });
  assert.ok(fores.every(Boolean), 'two forearms');
  assert.ok(gloves.every((g) => g && g.parent.parent === fores[gloves.indexOf(g)]), 'a hand on each wrist');
  assert.ok(gloves.every((g) => g.morphTargetInfluences?.length === 2), 'each hand opens and closes');
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
  // The glove itself, on its wrist — the hand centre is FORE down the forearm.
  const handCentre = (i) => gloves[i].localToWorld(new V(0, -(0.29 - rider.WRIST), 0));
  const reach = Math.min(handCentre(0).distanceTo(edge), handCentre(1).distanceTo(edge));
  assert.ok(reach < 0.01, 'the indy hand reaches the toe edge: ' + reach);
  assert.ok(gloves.some((g) => g.morphTargetInfluences[1] > 0.9), 'and closes on it');
  for (const kind of [1, 2]) { r.grabKind = kind; run(30); }
  r.grab = 0; r.state = 'ride'; r.grounded = true; r.vel.set(0, 0, -6);
  run(60);

  /* The arms (`ARMS` in riderModel.js), driven through the states they
     answer. Through every frame of all of it the glove stays out of the
     jacket — the trunk's column less the glove's own radius — and each elbow
     bends the way an elbow does: some bend always, never folded flat, and its
     point never turned forwards into the chest. Then the reads themselves:
     a hand down to the snow on a laid-over carve, on the side the carve is
     on; the arms thrown up by a pop; a tuck's hands in a box in front of the
     chest; a spin led by the arms and coiled against before it; a flip's
     arms pulled in; a grab's free arm boned out the longer it is held; an
     unclean landing waving where a clean one does not; a stop's arms out
     along the board; and a fall's arms out in front of him. */
  {
    const torsoG = torsoMesh.parent;
    const T = rider.TRUNK;
    const shoulder = (i) => fores[i].parent.getWorldPosition(new V());
    const elbowAt = (i) => fores[i].getWorldPosition(new V());
    const inTorso = (p) => torsoG.worldToLocal(p.clone());
    const segDist = (p, a, b) => {
      const ab = b.clone().sub(a);
      const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
      return a.clone().addScaledVector(ab, t).distanceTo(p);
    };
    const limbsOk = (label) => {
      for (let i = 0; i < 2; i++) {
        const side = i ? 'rear' : 'lead';
        const p = inTorso(handCentre(i));
        if (p.y > T.bottom + T.soft && p.y < T.top - T.soft) {
          const e = Math.hypot((p.x - T.x) / (T.rx - 0.05), p.z / (T.rz - 0.05));
          assert.ok(e > 0.97, `${label}: the ${side} hand stays out of the jacket (${e.toFixed(3)})`);
        }
        const el = elbowAt(i);
        const upper = el.clone().sub(shoulder(i)).normalize();
        const fore = fores[i].localToWorld(new V(0, -0.29, 0)).sub(el).normalize();
        const bend = Math.acos(Math.min(1, Math.max(-1, upper.dot(fore))));
        assert.ok(bend > 0.1 && bend < 2.7, `${label}: the ${side} elbow bends ${bend.toFixed(3)} rad`);
        // (a grab folds him past the horizontal and reaches down past his
        // knees, where an elbow turned out to the side is what reaching is)
        const grabbing = model.debug().arms.grab > 0.02;
        const point = new V(1, 0, 0).transformDirection(fores[i].matrixWorld)
          .transformDirection(torsoG.matrixWorld.clone().invert());
        assert.ok(grabbing || point.x < 0.35,
          `${label}: the ${side} elbow points forwards (${point.x.toFixed(3)})`);
        // …and out of the legs: the hand the arm is solved to, twelve
        // centimetres from every leg bone (trouser and glove), unless it is a
        // grab between the boots
        if (!grabbing) {
          const h = fores[i].localToWorld(new V(0, -0.29, 0));
          for (const shin of shins) {
            const hip = shin.parent.getWorldPosition(new V());
            const knee = shin.getWorldPosition(new V());
            const ankle = shin.localToWorld(new V(0, -0.40, 0));
            const gap = Math.min(segDist(h, hip, knee), segDist(h, knee, ankle));
            assert.ok(gap > 0.12, `${label}: the ${side} hand is in a leg (${gap.toFixed(3)})`);
          }
        }
      }
    };
    const ride = (n, label, f) => {
      for (let i = 0; i < n; i++) {
        run(1, () => { if (f) f(i); });
        limbsOk(label);
      }
    };
    const calm = () => {
      Object.assign(r, {
        state: 'ride', grounded: true, grab: 0, grabKind: 0, grabTime: 0, tucking: false,
        charging: false, charge: 0, edge: 0, carveLoad: 0, roll: 0, spinVel: 0, flip: 0,
        flipVel: 0, brake: 0, chatter: 0, compression: 0.33, tumble: 0, fallTimer: 0,
        fallElapsed: 0, slide: 0, lateral: 0, touchdownIn: Infinity,
      });
      r.vel.set(0, 0, -15);
      r.yaw = 0;
      ride(60, 'settle');
    };
    const height = (i) => handCentre(i).y - r.pos.y;
    const rise = (i) => handCentre(i).y - shoulder(i).y;
    const yawOf = (v) => { const l = model.root.worldToLocal(v); return Math.atan2(-l.z, l.x); };
    const handsYaw = () => yawOf(handCentre(0).add(handCentre(1)).multiplyScalar(0.5));

    // Carving: toeside the leading hand goes down to the snow, heelside the
    // trailing one does, and the other hand stays up as the counterweight.
    calm();
    const straight = [height(0), height(1)];
    ride(90, 'toeside carve', () => {
      r.edge = 0.95; r.carveLoad = 1; r.roll = -0.55; r.vel.set(0, 0, -18);
    });
    assert.ok(board.localToWorld(new V(0.155, 0, 0)).y < board.localToWorld(new V(-0.155, 0, 0)).y,
      'a positive edge buries the toe edge');
    const toe = [height(0), height(1)];
    assert.ok(toe[0] < toe[1] - 0.1, `toeside, the leading hand is the low one: ${toe.map((v) => v.toFixed(2))}`);
    assert.ok(toe[0] < straight[0] - 0.15, `…reaching down for the snow: ${toe[0].toFixed(2)} from ${straight[0].toFixed(2)}`);
    ride(40, 'carve release', () => { r.edge = 0; r.carveLoad = 0; r.roll = 0; });
    ride(90, 'heelside carve', () => {
      r.edge = -0.95; r.carveLoad = 1; r.roll = 0.55; r.vel.set(0, 0, -18);
    });
    const heel = [height(0), height(1)];
    assert.ok(heel[1] < heel[0] - 0.1, `heelside, the trailing hand is the low one: ${heel.map((v) => v.toFixed(2))}`);
    assert.ok(heel[1] < straight[1] - 0.1, `…dragging towards the snow: ${heel[1].toFixed(2)} from ${straight[1].toFixed(2)}`);
    assert.ok(Math.min(...toe, ...heel) > 0.05, 'and no hand goes into the snow');
    // …and riding switch, through the swap of the hands' jobs, with nothing
    // crossing through the body on the way
    ride(60, 'switch carve', (i) => {
      r.switchStance = true; r.edge = i < 30 ? 0.9 : -0.9; r.carveLoad = 1; r.roll = i < 30 ? -0.5 : 0.5;
    });
    ride(30, 'back to regular', () => { r.switchStance = false; r.edge = 0; r.carveLoad = 0; r.roll = 0; });

    // The pop throws both arms up.
    calm();
    const before = [rise(0), rise(1)];
    const peak = [-Infinity, -Infinity];
    ride(4, 'pop', (i) => { r.compression = 0.33 - 0.1 * (i + 1); });
    ride(14, 'off the lip', () => {
      r.state = 'air'; r.grounded = false; r.compression = -0.07;
      peak[0] = Math.max(peak[0], rise(0)); peak[1] = Math.max(peak[1], rise(1));
    });
    assert.ok(peak[0] > before[0] + 0.12 && peak[1] > before[1] + 0.12,
      `the arms swing up on the pop: ${before.map((v) => v.toFixed(2))} → ${peak.map((v) => v.toFixed(2))}`);

    // The tuck's hands: close in front of the chest, at the knees.
    calm();
    ride(90, 'tuck', () => { r.tucking = true; r.vel.set(0, 0, -28); });
    for (let i = 0; i < 2; i++) {
      const p = inTorso(handCentre(i));
      assert.ok(p.x > 0.15 && p.x < 0.6 && p.y > -0.4 && p.y < 0.42 && Math.abs(p.z) < 0.3,
        `a tucked hand is in front of the chest: ${p.toArray().map((v) => v.toFixed(2))}`);
    }

    // A spin: the arms lead it in the air and coil against it on the snow.
    // The rig turns by −yaw, so a positive spin leads towards negative yaw.
    const spun = (rate, air) => {
      calm();
      ride(30, air ? 'spin' : 'coil', () => {
        if (air) { r.state = 'air'; r.grounded = false; r.yaw += rate * dt; } else {
          r.charging = true; r.charge = 1;
        }
        r.spinVel = rate;
      });
      // measured in the root's own frame, which has already turned with the board
      return handsYaw();
    };
    const leadsPos = spun(7.5, true);
    const leadsNeg = spun(-7.5, true);
    assert.ok(leadsPos < leadsNeg - 0.5, `the arms lead a spin: ${leadsPos.toFixed(2)} / ${leadsNeg.toFixed(2)}`);
    const coilPos = spun(1.4, false);
    const coilNeg = spun(-1.4, false);
    assert.ok(coilPos > coilNeg + 0.3, `and wind against it before the pop: ${coilPos.toFixed(2)} / ${coilNeg.toFixed(2)}`);

    // A flip pulls the hands in together.
    const apart = () => handCentre(0).distanceTo(handCentre(1));
    calm();
    ride(30, 'flight', () => { r.state = 'air'; r.grounded = false; });
    const flying = apart();
    ride(30, 'flip', () => { r.flipVel = 6.2; r.flip += 6.2 * dt; });
    assert.ok(apart() < flying - 0.2, `a flip tucks the arms: ${flying.toFixed(2)} → ${apart().toFixed(2)}`);

    // An indy held: the free (leading) arm bones out.
    calm();
    const reachOf = (i) => handCentre(i).distanceTo(shoulder(i));
    ride(12, 'indy', () => { r.state = 'air'; r.grounded = false; r.grab = 1; r.grabTime += dt; });
    const early = reachOf(0);
    ride(48, 'indy styled', () => { r.grabTime += dt; });
    // (lifts in his own frame: folded over the board, the chest's up is sideways)
    assert.ok(reachOf(0) > early + 0.03 && inTorso(handCentre(0)).y > 0.5,
      `a held grab's free arm straightens and lifts: ${early.toFixed(2)} → ${reachOf(0).toFixed(2)}`);

    // Landings: an unclean one waves the arms up, a clean one of the same
    // impact only absorbs it.
    const landed = (verdict) => {
      calm();
      ride(20, 'flight', () => { r.state = 'air'; r.grounded = false; });
      let top = -Infinity;
      ride(40, 'landing', (i) => {
        r.state = 'ride'; r.grounded = true; r.compression = i === 0 ? 0.6 : 0.33;
        if (i === 0) r.lastLanding = { verdict, impact: 12 };
        top = Math.max(top, rise(0), rise(1));
      });
      return top;
    };
    const clean = landed(0);
    const sketchy = landed(1);
    assert.ok(sketchy > clean + 0.08, `an unclean landing waves: ${sketchy.toFixed(2)} / ${clean.toFixed(2)}`);

    // A stop: the arms go out along the board.
    const spread = () => Math.abs(inTorso(handCentre(0)).z - inTorso(handCentre(1)).z);
    calm();
    const riding = spread();
    ride(40, 'brake', () => { r.brake = 1; r.edge = -0.5; r.carveLoad = 0.8; r.roll = 0.3; });
    assert.ok(spread() > riding + 0.12, `a stop spreads the arms: ${riding.toFixed(2)} → ${spread().toFixed(2)}`);

    // Going down, the arms go out in front of him first.
    calm();
    ride(12, 'fall', (i) => { r.state = 'fall'; r.grounded = false; r.fallElapsed = i * dt; r.tumble += 4 * dt; });
    for (let i = 0; i < 2; i++) {
      assert.ok(inTorso(handCentre(i)).x > 0.2, 'a falling rider\'s hands go out in front of him');
    }
    ride(90, 'tumble', (i) => { r.fallElapsed += dt; r.tumble += 6 * dt; });
    calm();
  }

  /* The headlamp is not fitted (HEADLAMP.fitted): dark by day and dark at
     night, so nothing that reads its level — the snowfall, the eye shine,
     the rig's spill — lights up either. */
  {
    const lamp = model.headlamp;
    assert.equal(lampModule.HEADLAMP.fitted, false, 'no headlamp');
    const grade = 0.3;
    const height = (x, z) => grade * z;
    r.world = { height };
    r.normal = new V(0, 1, -grade).normalize();
    r.heading = new V(0, 0, -1);
    r.right = new V(1, 0, 0);
    r.pos.set(0, 0, 0);
    r.vel.set(0, -grade * 15, -15);
    const camera = { position: new V(0, 3, 6) };
    for (const value of [0, 1]) {
      for (let i = 0; i < 120; i++) {
        r.pos.addScaledVector(r.vel, dt);
        r.pos.y = height(r.pos.x, r.pos.z);
        camera.position.set(r.pos.x, r.pos.y + 3, r.pos.z + 6);
        model.update(r, dt, { night: value, snow: 0.5 }, camera);
      }
      assert.ok(lamp.level < 0.002 && !lamp.beam.visible && !lamp.pool.visible
        && lamp.uniforms.uLamp.value.w === 0, 'no lamp at night ' + value);
    }
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

/* The modelled rocks and deadwood (tools/blender/rocks.py and deadwood.py →
   alpine-boulders.glb, alpine-crags.glb, alpine-deadwood.glb), read with the
   game's own GLB reader. Every node a pool asks for is in its file, inside
   its triangle budget, standing on y = 0 centred at the origin, with UVs
   inside the atlas; every rock and trunk is a closed solid (welded by
   position, each edge between exactly two triangles), because a hazard is
   seen from every side. The boulders and crags stand at exactly the height
   over half-width their colliders assume (SCAN_ASPECT and CRAG_ASPECT, local
   to the pools in props.js, so read from its source); the trunks lie along
   x at DEADWOOD's length and height; the stump is wider across its roots than
   it is tall. Each file carries one WebP atlas, and the three together
   weigh less than the photoscans they replaced (2.86 MB). */
{
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const { DEADWOOD } = await load('props.js', ['DEADWOOD']);
  const src = await readFile(new URL('js/props.js', base), 'utf8');
  const table = (name) => JSON.parse(src.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1]
    .replace(/'/g, '"'));
  const files = {};
  let bytes = 0;
  for (const file of ['alpine-boulders.glb', 'alpine-crags.glb', 'alpine-deadwood.glb']) {
    const b = await readFile(new URL('assets/models/nature/' + file, base));
    bytes += b.byteLength;
    const json = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
    assert.equal(json.images?.length, 1, file + ': one atlas');
    assert.equal(json.images[0].mimeType, 'image/webp', file + ': the atlas is WebP');
    files[file] = parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  assert.ok(bytes < 2.86e6, `the modelled props weigh ${(bytes / 1e6).toFixed(2)} MB`);
  const solid = (name, node, budget, closed = true) => {
    assert.ok(node, 'a modelled ' + name);
    const prim = node.prims[0];
    const p = prim.attributes.POSITION;
    const uv = prim.attributes.TEXCOORD_0;
    const n = prim.attributes.NORMAL;
    assert.ok(uv && n, name + ': uvs and normals');
    const tris = prim.index.length / 3;
    assert.ok(tris <= budget, `${name}: ${tris} triangles, budget ${budget}`);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p[i + a]);
        hi[a] = Math.max(hi[a], p[i + a]);
      }
      assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-3, name + ': unit normals');
    }
    assert.ok(uv.every((v) => v >= 0 && v <= 1), name + ': uvs inside the atlas');
    assert.ok(Math.abs(lo[1]) < 1e-3, name + ': stands on y = 0');
    assert.ok(Math.abs(lo[0] + hi[0]) < 2e-3 && Math.abs(lo[2] + hi[2]) < 2e-3, name + ': centred');
    if (closed) {
      const key = (i) => `${p[i * 3].toFixed(5)},${p[i * 3 + 1].toFixed(5)},${p[i * 3 + 2].toFixed(5)}`;
      const ids = new Map();
      const id = (i) => {
        const k = key(i);
        if (!ids.has(k)) ids.set(k, ids.size);
        return ids.get(k);
      };
      const edges = new Map();
      for (let t = 0; t < prim.index.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = id(prim.index[t + e]);
          const c = id(prim.index[t + (e + 1) % 3]);
          const k = a < c ? `${a}:${c}` : `${c}:${a}`;
          edges.set(k, (edges.get(k) || 0) + 1);
        }
      }
      assert.ok([...edges.values()].every((c) => c === 2), name + ': a closed solid');
    }
    return { size: hi.map((h, a) => h - lo[a]) };
  };
  const aspect = (size) => size[1] / (Math.max(size[0], size[2]) / 2);
  const boulders = files['alpine-boulders.glb'];
  table('SCAN_ASPECT').forEach((want, i) => {
    const name = table('BOULDER_NODES')[i];
    const { size } = solid(name, boulders[name], 2500);
    assert.ok(Math.abs(aspect(size) - want) < 0.01 * want, `${name}: height over half-width ${aspect(size).toFixed(3)}`);
    assert.equal(boulders[name].extras.aspect, want, name + ': built to its aspect');
  });
  const crags = files['alpine-crags.glb'];
  table('CRAG_ASPECT').forEach((want, i) => {
    const name = table('CRAG_NODES')[i];
    const { size } = solid(name, crags[name], 5000);
    assert.ok(Math.abs(aspect(size) - want) < 0.01 * want, `${name}: height over half-width ${aspect(size).toFixed(3)}`);
    assert.equal(crags[name].extras.faces, '+z', name + ': faces the run the way the pool turns it');
  });
  const wood = files['alpine-deadwood.glb'];
  for (const spec of DEADWOOD.logs) {
    const { size } = solid(spec.node, wood[spec.node], 2500);
    assert.ok(size[0] > 3 * size[2], spec.node + ': lies along x, the capsule axis');
    assert.ok(Math.abs(size[0] - spec.length) < 0.03 * spec.length, `${spec.node}: ${size[0].toFixed(2)} m long`);
    assert.ok(Math.abs(size[1] - spec.height) < 0.03 * spec.height, `${spec.node}: ${size[1].toFixed(2)} m high`);
  }
  const stump = solid('stump', wood.stump, 1800).size;
  assert.ok(Math.min(stump[0], stump[2]) > 1.8 * stump[1], 'the stump spreads its roots wider than it is tall');
  for (const name of DEADWOOD.branches) {
    const { size } = solid(name, wood[name], 1200, false);
    assert.ok(Math.max(...size) < 1.6 && size[1] < 0.4, name + ': a branch lying on the snow');
  }
  // Nothing in the game still asks for the photoscans these replaced.
  assert.ok(!/rock_0[79]\.glb|stone_granite_set|rock_face_01|mountainside\.glb|boulder_01|tree_stump_01|fallen_(log|trunk)_0|deadfall_branches/
    .test(src), 'no photoscan is still requested');
}

/* The race gate and the sapling impostors. The gate's fabric must be the only
   thing that flutters, and pinned at both poles; each sapling is three cards
   of eight triangles whose texture rectangles sit inside the atlas and keep
   the aspect ratio of the frame the tree was drawn in (1024 × 2048). */
const props = await load('props.js',
  ['raceGatePanelGeometry', 'saplingCardGeometry', 'SAPLINGS', 'GATE_PANEL', 'SWAY', 'GUST_X', 'GUST_Z',
    'SPECIES']);
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

/* The modelled versions of the same (`tools/blender/piste.py` →
   piste-furniture.glb, `shrubs.py` → alpine-shrubs.glb, `saplings.py` →
   sapling-impostors.webp), read through the game's own reader. The gate
   keeps the stand-in's frame and its flutter rule (only fabric ripples,
   never within 3 cm of a pole) and lets the race colour onto its pole and
   cloth but not its hinges; the marker stands on its foot, 3 m tall, sign
   to +Z; the snow bridge's steel stays inside the box its collision is
   cut from, with snow loading its upper beams; each piece of scrub is
   footed at the origin, in budget and about the size of the stand-in hull
   the game still collides with; and the saplings are the four species in
   six non-overlapping rows of a 1024 × 2048 WebP. The stand-ins carry
   what the materials now read (`aGrain`, the gate's `surfaceOwn`). */
{
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const m = await load('props.js', ['gatePanelGeometry', 'roleGeometry', 'raceGatePanelGeometry',
    'avalancheFenceGeometry', 'waymarkGeometry', 'GATE_PANEL', 'GATE_LOOKS', 'WAYMARK_LOOKS',
    'FENCE_LOOKS', 'SHRUB_LOOKS', 'SHRUB_NODES', 'PLANT_NODES', 'SAPLINGS']);
  const glb = async (path) => {
    const b = await readFile(new URL(path, base));
    return parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const piste = await glb('assets/models/piste/piste-furniture.glb');
  const W = m.GATE_PANEL.width;

  const gate = m.gatePanelGeometry(THREE, piste.gate_panel);
  assert.ok(valid('modelled gate panel', gate) <= 400, 'modelled gate triangle budget');
  const gp = gate.attributes.position;
  const gf = gate.attributes.aFlutter;
  const gown = gate.attributes.surfaceOwn;
  let ripple = 0;
  let hinges = 0;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i);
    if (Math.abs(x) < 0.03 || Math.abs(x - W) < 0.03) assert.equal(gf.getX(i), 0, 'modelled poles never flutter');
    if (gf.getX(i) > 0) {
      ripple++;
      assert.ok(gp.getY(i) > m.GATE_PANEL.bottom - 0.01 && gp.getY(i) < m.GATE_PANEL.top + 0.01,
        'only the panel ripples');
      assert.ok(gown.getX(i) > 0.4, 'the panel takes the race colour');
    }
    if (gp.getY(i) > 0.02 && gp.getY(i) < 0.2 && gown.getX(i) === 0) hinges++;
  }
  assert.ok(ripple > 20, 'the modelled fabric ripples');
  assert.ok(hinges > 8, 'the hinges keep their own colour');
  gate.computeBoundingBox();
  assert.ok(Math.abs(gate.boundingBox.min.x) < 0.1 && Math.abs(gate.boundingBox.max.x - W) < 0.1,
    'inner pole on the origin, outer at the panel width');
  assert.ok(gate.boundingBox.max.y > 1.9 && gate.boundingBox.max.y < 2.0, 'poles stand their height');

  const mark = m.roleGeometry(THREE, piste.waymark, m.WAYMARK_LOOKS, 'piste-furniture.glb', 'aGrain');
  assert.ok(valid('modelled marker', mark) <= 300, 'modelled marker triangle budget');
  assert.ok(mark.boundingBox.max.y > 2.9 && mark.boundingBox.max.y < 3.2, 'the marker stands three metres');
  assert.ok(Math.max(-mark.boundingBox.min.x, mark.boundingBox.max.x, -mark.boundingBox.min.z,
    mark.boundingBox.max.z) < 0.35, 'the marker stands on its foot');
  const numeral = piste.waymark.prims.find((p) => p.role === 'numeral');
  assert.ok(numeral && numeral.attributes.NORMAL.filter((_, i) => i % 3 === 2).every((z) => z > 0.9),
    'the run sign faces up the hill (+Z)');

  const bridge = m.roleGeometry(THREE, piste.snow_bridge, m.FENCE_LOOKS, 'piste-furniture.glb', 'aGrain');
  assert.ok(valid('modelled snow bridge', bridge) <= 1200, 'modelled snow bridge triangle budget');
  const standIn = m.avalancheFenceGeometry(THREE);
  standIn.computeBoundingBox();
  const box = standIn.boundingBox.clone().expandByScalar(0.1);
  let loaded = 0;
  for (const p of piste.snow_bridge.prims) {
    const a = p.attributes.POSITION;
    for (let i = 0; i < a.length; i += 3) {
      if (p.role === 'snow') {
        if (a[i + 1] > 2.6) loaded++;
        continue;
      }
      if (a[i + 1] < 0) continue;   // anchors and footings run on under the snow
      assert.ok(box.containsPoint(new THREE.Vector3(a[i], a[i + 1], a[i + 2])),
        'the bridge steel stays inside the box its collision is cut from');
    }
  }
  assert.ok(loaded > 8, 'snow loads the upper beams');
  for (const g of [standIn, m.waymarkGeometry(THREE)]) {
    assert.ok(g.attributes.aGrain.array.every((v) => v === 1), 'the stand-ins keep the plank grain');
  }
  const oldGate = m.raceGatePanelGeometry(THREE);
  assert.ok(oldGate.attributes.surfaceOwn.array.some((v) => v === 0)
    && oldGate.attributes.surfaceOwn.array.some((v) => v === 1), 'the stand-in gate says what is tinted');

  // The stand-ins' collision hulls (bounding spheres of growShrub,
  // growDwarfPine, growPlantPatch and growTussockPatch at their seeds).
  const shrubs = await glb('assets/models/nature/alpine-shrubs.glb');
  const hulls = [0.88, 1.15, 0.78, 0.45];
  [...m.SHRUB_NODES, ...m.PLANT_NODES].forEach((name, i) => {
    assert.ok(shrubs[name], 'a modelled ' + name);
    const g = m.roleGeometry(THREE, shrubs[name], m.SHRUB_LOOKS, 'alpine-shrubs.glb', 'surfaceOwn');
    const tris = valid('shrubs.' + name, g);
    assert.ok(tris <= (i < 2 ? 1500 : 500), `${name}: budget ${tris}`);
    assert.ok(g.attributes.surfaceOwn.array.every((v) => v >= 0 && v <= 1), name + ': ownership in range');
    assert.ok(g.boundingBox.min.y > -0.25 && g.boundingBox.max.y < 1.2, name + ': stands on the snow line');
    const r = g.boundingSphere.radius;
    assert.ok(r > hulls[i] * 0.75 && r < hulls[i] * 1.3, `${name}: about its hull's size (${r.toFixed(2)})`);
  });

  assert.deepEqual([...new Set(m.SAPLINGS.map((s) => s.species))].sort(), ['fir', 'larch', 'pine', 'spruce'],
    'the young forest is the four species');
  const rows = m.SAPLINGS.map((s) => [Math.min(...s.views.map((v) => v[1])), Math.max(...s.views.map((v) => v[3]))])
    .sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i][0] >= rows[i - 1][1], 'sapling rows do not overlap');
  const atlas = await readFile(new URL('assets/textures/tree/sapling-impostors.webp', base));
  assert.equal(atlas.toString('ascii', 0, 4) + atlas.toString('ascii', 8, 12), 'RIFFWEBP', 'the atlas is a WebP');
  assert.equal(atlas.toString('ascii', 12, 16), 'VP8X', 'the atlas carries alpha');
  assert.deepEqual([1 + atlas.readUIntLE(24, 3), 1 + atlas.readUIntLE(27, 3)], [1024, 2048], 'atlas size');
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

/* The lift and the snow guns as modelled (`tools/blender/lift.py` →
   assets/models/resort/lift.glb). The file keeps its budgets, carries snow
   on top of what snow lies on, and sets every sheave under the rope on its
   own axle. Loaded through the game's own fetch it swaps into the meshes
   already drawing — not one more draw call — and then every sheave train
   lies along the rope between its neighbouring towers with its frame
   inboard, every cabin hangs from the rope by its grip with its door
   outboard, the hardware patch lands in three's Lambert shader and turns
   the sheaves, and the guns spray from their own nozzle rings along their
   barrels. The procedural resort above had no file (node's fetch cannot
   read one) and kept its own line. */
{
  assert.equal(await life.liftReady, false, 'without the file the procedural line stands');
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const bytes = await readFile(new URL('assets/models/resort/lift.glb', base));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const nodes = parseGlb(buffer);
  const tris = (name) => nodes[name].prims.reduce((n, p) => n + p.index.length / 3, 0);
  assert.ok(tris('lift_cabin') + tris('lift_cabinGlass') <= 1500, 'cabin budget');
  assert.ok(tris('lift_tower') <= 2500, 'tower budget');
  assert.ok(tris('lift_sheaves') <= 600, 'sheave train budget');
  assert.ok(tris('snowgun') <= 2500, 'snow gun budget');
  for (const name of ['lift_cabin', 'lift_tower', 'snowgun']) {
    const snow = nodes[name].prims.find((p) => p.role === 'snow');
    assert.ok(snow, name + ' carries snow');
    const at = snow.attributes.POSITION;
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let up = 0;
    let all = 0;
    for (let t = 0; t < snow.index.length; t += 3) {
      a.fromArray(at, snow.index[t] * 3);
      b.fromArray(at, snow.index[t + 1] * 3).sub(a);
      c.fromArray(at, snow.index[t + 2] * 3).sub(a);
      const n = b.cross(c);
      up += n.y;
      all += n.length();
    }
    assert.ok(up / all > 0.6, name + ': the snow lies on top ' + (up / all).toFixed(2));
  }
  const { radius, bend, sheaves } = nodes.lift_sheaves.extras;
  const axles = new Map();
  for (const p of nodes.lift_sheaves.prims) {
    const ax = p.attributes._AXLE;
    const at = p.attributes.POSITION;
    for (let i = 0; i < at.length / 3; i++) {
      if (ax[i * 3 + 2] < 0.5) continue;
      const y = ax[i * 3];
      const z = ax[i * 3 + 1];
      axles.set(z.toFixed(3), y);
      assert.ok(Math.abs(at[i * 3]) < 0.08 && Math.hypot(at[i * 3 + 1] - y, at[i * 3 + 2] - z) < radius + 0.035,
        'a sheave turns about its own axle');
    }
  }
  assert.equal(axles.size, sheaves, 'every sheave has its axle');
  for (const [z, y] of axles) {
    assert.ok(Math.abs(y + radius + 0.05 + Math.abs(Number(z)) * Math.tan(bend / 2)) < 1e-3,
      'the rope lies on every sheave');
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => buffer });
  const scene = new THREE.Scene();
  const shots = [];
  const spray = { burst: (at, vx, vz, count, power) => shots.push({ at: { ...at }, vx, vz, count, power }) };
  const modelled = mountainLife.createMountainLife(namespace, scene, { apply: (m) => m }, spray);
  globalThis.fetch = realFetch;
  const before = [];
  scene.traverse((o) => { if (o.isMesh) before.push(o); });
  assert.equal(await modelled.liftReady, true, 'the modelled lift loads');
  const rider = { pos: new THREE.Vector3(0, 0, -300), distance: 300, state: 'ride', grace: 10 };
  for (let i = 0; i < 20; i++) modelled.update(1 / 60, rider, { night: 0, snow: 0 });
  const after = [];
  scene.traverse((o) => { if (o.isMesh) after.push(o); });
  assert.deepEqual(after, before, 'the same meshes, redrawn');
  assert.ok(after.length <= 24, 'resort draw-call budget, modelled');

  const pool = (n) => after.filter((o) => o.isInstancedMesh && o.instanceMatrix.count === n);
  const [cabins] = pool(6).filter((o) => o.geometry.attributes.aSheen);
  const [glass] = pool(6).filter((o) => !o.geometry.attributes.aSheen);
  const [towers] = pool(11);
  const [trains] = pool(22);
  const [guns] = pool(12);
  const [ropes] = pool(160);
  for (const mesh of [cabins, towers, trains, guns]) {
    valid('lift', mesh.geometry);
    for (const a of ['normal', 'color', 'uv', 'aSheen', 'aGrain', 'aAxle']) assert.ok(mesh.geometry.attributes[a], 'lift ' + a);
    assert.equal(mesh.material, cabins.material, 'one material for the modelled hardware');
  }
  valid('lift glass', glass.geometry);

  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  };
  cabins.material.onBeforeCompile(shader);
  for (const patch of ['liftSpin( objectNormal.yz )', 'transformed.yz = aAxle.xy', 'vN64Sheen = aSheen']) {
    assert.ok(shader.vertexShader.includes(patch), 'the hardware patch lands: ' + patch);
  }
  assert.ok(shader.fragmentShader.includes('0.35 * vLiftGrain'), 'the grain is per role');
  const spun = shader.uniforms.uSheaveSpin.value;
  modelled.update(1 / 60, rider, { night: 0, snow: 0 });
  assert.notEqual(shader.uniforms.uSheaveSpin.value, spun, 'the sheaves turn');

  const M = new THREE.Matrix4();
  const P = new THREE.Vector3();
  const Q = new THREE.Quaternion();
  const S = new THREE.Vector3();
  const towerAt = (i) => { towers.getMatrixAt(i, M); return new THREE.Vector3().setFromMatrixPosition(M); };
  for (let i = 1; i < 10; i++) {
    const t = towerAt(i);
    const line = towerAt(i + 1).sub(towerAt(i - 1)).normalize();
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      trains.getMatrixAt(i * 2 + s, M);
      M.decompose(P, Q, S);
      assert.ok(P.distanceTo(new THREE.Vector3(t.x + side * 1.8, t.y + 10.5, t.z)) < 1e-3, 'a train sits on its rope');
      assert.ok(new THREE.Vector3(0, 0, -side).applyQuaternion(Q).angleTo(line) < 1e-4, 'a train lies along the rope');
      const outboard = new THREE.Vector3().crossVectors(line, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(side);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(Q);
      assert.ok(x.dot(outboard) > 0.999 && x.x * side > 0, 'a train turns its frame inboard');
    }
  }

  const chords = [];
  for (let k = 0; k < ropes.instanceMatrix.count; k++) {
    ropes.getMatrixAt(k, M);
    chords.push(new THREE.Line3(new THREE.Vector3(0, -0.5, 0).applyMatrix4(M), new THREE.Vector3(0, 0.5, 0).applyMatrix4(M)));
  }
  const on = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    cabins.getMatrixAt(i, M);
    const grip = new THREE.Vector3(0, nodes.lift_cabin.extras.ropeY, 0).applyMatrix4(M);
    let best = Infinity;
    let rope = -1;
    chords.forEach((c, k) => {
      const d = c.closestPointToPoint(grip, true, on).distanceTo(grip);
      if (d < best) { best = d; rope = k; }
    });
    assert.ok(best < 0.06, 'a cabin hangs from the rope by its grip: ' + best);
    const side = Math.floor(rope / 8) % 2 ? 1 : -1;
    assert.ok(new THREE.Vector3(1, 0, 0).transformDirection(M).x * side > 0.99, 'the cabin door faces outboard');
    assert.ok(new THREE.Vector3(0, -2, 0).applyMatrix4(M).y < grip.y - 3, 'the cabin hangs under its grip');
  }

  const nozzle = new THREE.Vector3().fromArray(nodes.snowgun.extras.nozzle);
  const aim = new THREE.Vector3().fromArray(nodes.snowgun.extras.aim);
  const muzzles = [];
  for (let k = 0; k < guns.instanceMatrix.count; k++) {
    guns.getMatrixAt(k, M);
    muzzles.push({ at: nozzle.clone().applyMatrix4(M), aim: aim.clone().transformDirection(M) });
  }
  const plumes = shots.filter((s) => s.count === 8 && s.power === 3.5);
  assert.ok(plumes.length > 5, 'the guns are making snow');
  for (const s of plumes) {
    const at = new THREE.Vector3(s.at.x, s.at.y, s.at.z);
    const gun = muzzles.reduce((a, b) => (a.at.distanceTo(at) < b.at.distanceTo(at) ? a : b));
    assert.ok(gun.at.distanceTo(at) < 0.01, 'the spray leaves the nozzle ring');
    const along = (s.vx * gun.aim.x + s.vz * gun.aim.z) / (Math.hypot(s.vx, s.vz) * Math.hypot(gun.aim.x, gun.aim.z));
    assert.ok(along > 0.95, 'the spray goes where the barrel points: ' + along);
  }
}

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
  // The glove is its own segment on the wrist now, its origin `WRIST` down
  // the forearm; measured back in the forearm's frame it still ends past the
  // hand centre, and the sleeve and cuff end before the wrist. (Its rest
  // shape: three's own bounding box takes in the morph targets too.)
  const rest = (geo) => new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
  assert.ok(rest(g.handRear).min.y - rider.WRIST < -0.33 && rest(g.handRear).min.y - rider.WRIST > -0.37,
    'the glove ends past the hand centre');
  assert.ok(rest(g.handRear).max.y < 0.03, 'the glove starts at the wrist');
  assert.ok(box(g.foreArmRear).min.y > -rider.WRIST - 0.01, 'the sleeve ends at the wrist');
  assert.ok(g.handRear.morphAttributes.position?.length === 2 && g.handRear.morphTargetsRelative,
    'the glove opens and closes');
  assert.ok(box(g.rearBoot).max.y > rider.ANKLE_Y, 'the boot cuff rises past the ankle');
  // left and right hands, and the cargo pocket on the outside of each leg
  for (const [a, b] of [[g.foreArmLead, g.foreArmRear], [g.handLead, g.handRear],
    [g.thighLead, g.thighRear]]) {
    assert.ok(Math.abs(box(a).min.z + box(b).max.z) < 1e-4 && Math.abs(box(a).max.z + box(b).min.z) < 1e-4,
      'lead and rear are mirror images');
  }
  assert.ok(box(g.thighRear).max.z > box(g.thighRear).max.x, 'the rear pocket is on the outside (+Z)');
  // No lamp housing on the helmet front any more (the headlamp is not fitted).
  {
    const p = g.head.attributes.position;
    let front = -Infinity;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 0.205) < 0.015 && Math.abs(p.getZ(i)) < 0.015) front = Math.max(front, p.getX(i));
    }
    assert.ok(front < 0.135, 'no lamp on the helmet front: ' + front);
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
    for (const key of ['pelvis', 'head', 'foreArmLead', 'handLead', 'thighLead', 'shin', 'rearBoot']) {
      assert.ok(g[key].attributes.aFlap.array.every((v) => v === 0), key + ': rigid');
    }
  }
  // The glove is woven, the gold cuff a little, the helmet and goggles not at all.
  {
    const ink = new THREE.Color('#181c24');
    const fore = g.handRear;
    let glove = 0;
    for (let i = 0; i < fore.attributes.position.count; i++) {
      const c = fore.attributes.color;
      if (Math.abs(c.getX(i) - ink.r) + Math.abs(c.getY(i) - ink.g) < 1e-5) {
        glove++;
        assert.equal(fore.attributes.aCloth.getX(i), 1, 'the glove is cloth');
      }
    }
    assert.ok(glove > 50, 'the hand is a glove');
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

    /* Their arms (`NPC_POLE` in mountainLife.js). Every upper half is skinned
       to five bones — body, two shoulders, two hands — with every vertex
       fully weighted, so the arms cost no mesh and no draw call more. A
       skier keeps his poles in time with his turns: before each edge change
       (the lean changing sides) the pole on the side he is about to lean to
       comes down to the snow beside and ahead of his boots, and no pole tip
       is ever in the snow. A boarder's leading arm goes into a toeside turn
       and the trailing one out over the heel edge on a heelside one. */
    const skinned = figures.filter((m) => m.isSkinnedMesh);
    assert.equal(skinned.length, 8, 'every upper half is skinned');
    for (const m of skinned) {
      assert.equal(m.skeleton.bones.length, 5, 'body, shoulders and hands');
      const w = m.geometry.attributes.skinWeight;
      for (let i = 0; i < w.count; i++) {
        assert.ok(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) < 1e-5, 'a vertex is all there');
      }
    }
    const skier = skinned[0];
    const boarder = skinned[1];
    const tipOf = (m, bone) => {
      const p = m.geometry.attributes.position;
      const idx = m.geometry.attributes.skinIndex;
      let lowest = -1;
      for (let i = 0; i < p.count; i++) {
        if (idx.getX(i) === bone && (lowest < 0 || p.getY(i) < p.getY(lowest))) lowest = i;
      }
      return lowest;
    };
    const tips = { [-1]: tipOf(skier, 2), [1]: tipOf(skier, 4) };
    assert.ok(tips[-1] >= 0 && tips[1] >= 0, 'both poles ride their hands');
    const { heightAt } = await import(new URL('js/terrain.js', base).href);
    const v = new THREE.Vector3();
    const trace = [];
    let deepest = 0;
    let lastBank = 0;
    let crossed = 0;
    let held = 0;
    const flips = [];
    const leanToe = [];
    const leanHeel = [];
    for (let f = 0; f < 960; f++) {
      const g = skier.parent;
      r.pos.set(g.position.x + 40, g.position.y, g.position.z + 20);
      life.update(1 / 60, r);
      scene.updateMatrixWorld(true);
      const row = {};
      for (const side of [-1, 1]) {
        skier.getVertexPosition(tips[side], v);
        skier.localToWorld(v);
        const h = v.y - heightAt(v.x, v.z);
        const local = g.worldToLocal(v.clone());
        const reach = skier.skeleton.bones[side < 0 ? 1 : 3].rotation.x;
        row[side] = { h, x: local.x, z: local.z, reach };
        if (f > 60) deepest = Math.min(deepest, h);
      }
      trace.push(row);
      const bank = g.rotation.z;
      // an edge change is the lean going over by a clear margin, not a wobble
      // through upright (a fork in the line can make one), and it is dated
      // to the moment the lean crossed upright
      if (Math.sign(bank) !== Math.sign(lastBank)) crossed = f;
      if (Math.abs(bank) > 0.08 && Math.sign(bank) !== held) {
        if (held && crossed > 150) flips.push({ f: crossed, side: bank < 0 ? 1 : -1 });
        held = Math.sign(bank);
      }
      lastBank = bank;
      const b = boarder.parent.rotation.z;
      const [, lead, , rear] = boarder.skeleton.bones;
      if (b < -0.2) leanToe.push(lead.rotation.z);
      if (b > 0.2) leanHeel.push(rear.rotation.z);
    }
    assert.ok(deepest > -0.05, 'no pole tip goes into the snow: ' + deepest.toFixed(3));
    assert.ok(flips.length >= 4, 'the skier turns: ' + flips.length);
    for (const { f, side } of flips) {
      // (a pole at rest trails on the snow behind him too: the plant is the
      // one at or ahead of the boots)
      const before = trace.slice(Math.max(0, f - 40), f).map((row) => row[side]);
      const planted = before.filter((p) => p.h < 0.12 && Math.sign(p.x) === side && p.z < 0.12 && p.reach > 0.1);
      assert.ok(planted.length > 0,
        `the ${side > 0 ? '+X' : '−X'} pole plants before the edge change at ${f}: `
        + JSON.stringify(before.reduce((a, b) => (b.z < a.z ? b : a))));
      assert.ok(trace.slice(Math.max(0, f - 40), f).every((row) => row[-side].reach < 0.1),
        `…and the other arm is at rest meanwhile (${f})`);
    }
    const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    assert.ok(leanToe.length > 30 && mean(leanToe) > 0.15,
      'a boarder\'s leading arm goes into a toeside turn: ' + mean(leanToe).toFixed(2));
    assert.ok(leanHeel.length > 30 && mean(leanHeel) < -0.15,
      'and the trailing one out on a heelside one: ' + mean(leanHeel).toFixed(2));
  }
}
/* The modelled Alpine forest (`tools/blender/trees.py` → alpine-trees.glb,
   dressed from alpine-sprigs.webp). Every SPECIES slot has its tree, each
   stands on its own trunk at the origin and inside its budget; every corner
   is needles (1), snow (0) or bark (0.35); bark samples only the strip left
   of the keyed foliage, foliage only the cells right of it, and a snow card
   only the frost half; and the pool geometry the game builds from it stands
   at the pool's grown height with its atlas read the right way up. */
{
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const b = await readFile(new URL('assets/models/nature/alpine-trees.glb', base));
  const nodes = parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const BARK_U = 0.116;   // where spruceMat starts keying black (SPRUCE_LAYOUT.bark.u1)
  let species = new Set();
  const impostorCols = new Set();
  // two trees a slot: the second dozen of pools read the `_2` of each
  const slots = props.SPECIES.flatMap((spec) => [spec, { ...spec, name: spec.name + '_2' }]);
  for (let i = 0; i < 24; i++) {
    const want = 'tree_' + props.SPECIES[i % 12].name + (i >= 12 ? '_2' : '');
    assert.equal(props.alpineNode(nodes, i), nodes[want], `pool ${i} reads ${want}`);
  }
  for (const spec of slots) {
    const node = nodes['tree_' + spec.name];
    assert.ok(node, 'a modelled tree for ' + spec.name);
    species.add(node.extras.species);
    const g = props.alpineTreeGeometry(THREE, node, 24);
    const tris = valid('alpine.' + spec.name, g);
    assert.ok(tris <= 1200, spec.name + ': tree budget ' + tris);
    g.computeBoundingBox();
    assert.ok(Math.abs(g.boundingBox.max.y - 24) < 0.05, spec.name + ': stands at the pool height');
    assert.ok(g.boundingBox.min.y < -0.5, spec.name + ': the trunk goes on under the snow line');
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    const own = g.attributes.surfaceOwn;
    let foot = Infinity;
    let bark = 0;
    let snow = 0;
    for (let i = 0; i < p.count; i++) {
      const o = own.getX(i);
      assert.ok(o === 0 || o === 1 || Math.abs(o - 0.35) < 1e-6, spec.name + ': ownership is needle, snow or bark');
      const u = uv.getX(i);
      const v = uv.getY(i);
      assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, spec.name + ': uv inside the atlas');
      if (Math.abs(o - 0.35) < 1e-6) {
        bark++;
        assert.ok(u <= BARK_U, spec.name + ': bark stays left of the keyed foliage');
        if (Math.abs(p.getY(i)) < 0.05) foot = Math.min(foot, Math.hypot(p.getX(i), p.getZ(i)));
      } else {
        assert.ok(u > 0.125, spec.name + ': foliage samples a sprig cell');
        if (o === 0) {
          snow++;
          assert.ok(v <= 0.5, spec.name + ': a snow card samples the frost half');
        } else {
          assert.ok(v >= 0.5, spec.name + ': a green card samples the green half');
        }
      }
    }
    assert.ok(bark > 50 && foot < 1.2, spec.name + ': a trunk on the axis at the foot (' + foot + ')');
    if (node.extras.species !== 'larch') assert.ok(snow > 10, spec.name + ': snow lies on the boughs');
    const c = g.attributes.color;
    assert.ok(c.array.every((x) => x > 0.3 && x <= 1.0), spec.name + ': occlusion is a gentle value');
    // Its far-forest impostor: three crossed cards in the tree's own column
    // of alpine-impostors.webp, framed round the whole tree from under the
    // snow line, in the shape of the cell it was photographed into
    // (4096 × 1024 over 24 columns and 3 views).
    const [col] = node.extras.impostor;
    impostorCols.add(col);
    const card = props.treeImpostorGeometry(THREE, node, 24);
    assert.equal(valid('impostor.' + spec.name, card), 6, spec.name + ': three cards');
    card.computeBoundingBox();
    const cb = card.boundingBox;
    assert.ok(cb.max.y >= 23.9, spec.name + ': the frame holds the crown');
    assert.ok(cb.min.y <= 0.05 && cb.min.y > -3, spec.name + ': impostor stands in the snow');
    const wide = Math.hypot(card.attributes.position.getX(1) - card.attributes.position.getX(0),
      card.attributes.position.getZ(1) - card.attributes.position.getZ(0));
    const cell = Math.floor(4096 / 24) / Math.floor(1024 / 3);
    assert.ok(Math.abs(wide / (cb.max.y - cb.min.y) - cell) < 0.02, spec.name + ': impostor keeps the cell aspect');
    const cu = card.attributes.uv;
    for (let i = 0; i < cu.count; i++) {
      const px = cu.getX(i) * 4096;
      assert.ok(px > col * 170 && px < (col + 1) * 170, spec.name + ': impostor reads its own column');
      assert.ok(cu.getY(i) > 0 && cu.getY(i) < 1, spec.name + ': impostor inside the atlas');
    }
  }
  assert.equal(impostorCols.size, slots.length, 'every tree has its own impostor column');
  assert.deepEqual([...species].sort(), ['fir', 'larch', 'pine', 'spruce'], 'four Alpine species');
  // The bare SPECIES stay bare: the larch slots get the larch.
  slots.forEach((spec) => {
    if (!spec.foliage) assert.equal(nodes['tree_' + spec.name].extras.species, 'larch', spec.name + ' is a larch');
  });
}
/* The trackside flora (`tools/blender/flora.py` → alpine-flora.glb): every
   plant the game places is in the file, each is small, footed at the origin
   and inside its budget, every role it is painted with has a look, and the
   decor loop that places them registers no solids — they are decoration,
   and a rider runs through them. */
{
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const b = await readFile(new URL('assets/models/nature/alpine-flora.glb', base));
  const nodes = parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  for (const name of props.FLORA_PLANTS) {
    const node = nodes['flora_' + name];
    assert.ok(node, 'a modelled ' + name);
    const g = props.floraGeometry(THREE, node);
    const tris = valid('flora.' + name, g);
    assert.ok(tris <= 500, name + ': budget ' + tris);
    for (const a of ['color', 'surfaceOwn']) assert.ok(g.attributes[a], name + ': ' + a);
    assert.ok(g.attributes.surfaceOwn.array.every((v) => v >= 0 && v <= 1), name + ': ownership in range');
    g.computeBoundingBox();
    const bb = g.boundingBox;
    assert.ok(bb.min.y > -0.25 && bb.max.y < 1.0, name + ': a small plant on the snow line');
    assert.ok(Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) < 0.8, name + ': footed at the origin');
  }
  const src = await readFile(new URL('js/props.js', base), 'utf8');
  const loop = src.slice(src.indexOf('THE TRACKSIDE FLORA. Small plants'),
    src.indexOf('Occasional natural glacial erratics'));
  assert.ok(loop.length > 500 && !loop.includes('solids.push'), 'the trackside flora is not a solid');
}
/* The modelled range (`tools/blender/backdrop.py` → alps.glb and its two
   maps): the frame the file was built in is the frame backdrop.js reads it
   in; every sector sits in the ring it is drawn in and keeps to its own
   fifteen degrees, so none spans the sky probe's join at -x; it fits its
   budget; and the skyline it gives the sun has the horn where it was put. */
{
  const { parseGlb } = await import(new URL('js/glb.js', base).href);
  const bd = await import(new URL('js/backdrop.js', base).href);
  const b = await readFile(new URL('assets/models/backdrop/alps.glb', base));
  const nodes = parseGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const names = Object.keys(nodes).filter((n) => n.startsWith('range_'));
  assert.equal(names.length, 24, 'twenty-four sectors');
  let verts = 0;
  let tris = 0;
  for (const name of names) {
    const node = nodes[name];
    const ex = node.extras;
    assert.deepEqual(ex.distance, bd.BACKDROP.distance, name + ': the distances agree');
    assert.deepEqual(ex.radius, bd.BACKDROP.radius, name + ': the radii agree');
    assert.equal(ex.horizons, bd.BACKDROP.horizons, name + ': the horizon count agrees');
    assert.equal(ex.horizonMax, bd.BACKDROP.horizonMax, name + ': the horizon scale agrees');
    const g = bd.backdropGeometry(THREE, node.prims[0]);
    tris += valid('backdrop.' + name, g);
    const p = g.attributes.position;
    verts += p.count;
    const [from, to] = ex.bearing;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      assert.ok(r > bd.BACKDROP.radius[0] - 10 && r < bd.BACKDROP.radius[1] + 10, name + ': inside the ring');
      let deg = Math.atan2(p.getX(i), -p.getZ(i)) * 180 / Math.PI;
      if (deg < from - 180) deg += 360;
      if (deg > to + 180) deg -= 360;
      assert.ok(deg > from - 4 && deg < to + 4, name + ': keeps to its own bearings');
    }
    for (const a of ['aHorizonA', 'aHorizonB']) {
      assert.ok(g.attributes[a].normalized && g.attributes[a].itemSize === 4, name + ': ' + a);
    }
    assert.ok(g.index.array instanceof Uint16Array, name + ': sixteen-bit indices');
  }
  assert.ok(verts < 120000 && tris < 220000, `backdrop budget: ${verts} vertices, ${tris} triangles`);
  const skyline = bd.backdropSkyline(nodes);
  const deg = (d) => bd.skylineAt(skyline, d * Math.PI / 180) * 180 / Math.PI;
  assert.ok(deg(-17) > 6 && deg(-17) < 12, `the horn stands over the run: ${deg(-17).toFixed(1)}°`);
  for (let d = 0; d < 360; d += 5) {
    assert.ok(deg(d) > -2 && deg(d) < 20, `a believable skyline at ${d}°: ${deg(d).toFixed(1)}°`);
  }
  // The maps: WebP, at the sizes the shader's frame assumes (u round the
  // ring, v out along it).
  const webpSize = (buf) => {
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
    }
    throw new Error('unknown WebP ' + kind);
  };
  assert.deepEqual(webpSize(await readFile(new URL('assets/textures/backdrop/alps-shape.webp', base))),
    [4096, 1024], 'the shape map');
  assert.deepEqual(webpSize(await readFile(new URL('assets/textures/backdrop/alps-cover.webp', base))),
    [4096, 1024], 'the cover map');
}
console.log('All model geometry checks passed.');
