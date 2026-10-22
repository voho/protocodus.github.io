// Run with: node fun/hedgerow/tests/lod-check.mjs
// Detail by distance. A soldier switches to his outfit's low-detail mesh
// beyond LOD_FAR and back inside LOD_NEAR (not in between, so he does not
// flicker at the line). Vegetation sorts each tree into full, mid (its
// thinned _mid model) and far (its _lod impostor) by distance, drops what is
// behind the camera, and without a _mid model keeps the old two tiers. And
// detail follows how big things look: down the sights (a narrower view) a
// soldier and the trees keep their full detail further out.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createCharacter, LOD_FAR, LOD_NEAR } = await import('../js/character.js');
const { createVegetation } = await import('../js/vegetation.js');
const { fovScale } = await import('../js/util.js');

// down the iron sights (52°) from the 68° view: things look as at 0.72 of their distance
const ads = fovScale(52, 68);
assert.ok(Math.abs(ads - 0.723) < 0.005, `fovScale(52, 68) is ${ads}`);
assert.equal(fovScale(68, 68), 1);

const matlib = { get: () => new THREE.MeshBasicMaterial(), resolve: (m) => m || new THREE.MeshBasicMaterial() };

/* ---------- soldier ---------- */
{
  const skinned = (name) => {
    const g = new THREE.BoxGeometry(0.3, 1.7, 0.3);
    const n = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
    const m = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    m.name = name;
    return m;
  };
  const rig = new THREE.Group();
  rig.name = 'rig';
  const hips = new THREE.Bone();
  hips.name = 'hips';
  rig.add(hips);
  const parts = ['allied', 'allied_lod', 'axis', 'axis_lod'].map(skinned);
  const skel = new THREE.Skeleton([hips]);
  for (const p of parts) { rig.add(p); p.bind(skel); }
  const gltf = { scene: rig, animations: [new THREE.AnimationClip('idle', 1, [])] };
  const ch = createCharacter(gltf, matlib, { outfit: 'axis', scene: new THREE.Scene() });
  const names = ch.meshes.map((m) => m.name).sort();
  assert.deepEqual(names, ['axis', 'axis_lod'], 'only this outfit, both details');
  const shown = () => ch.meshes.filter((m) => m.visible).map((m) => m.name).join();
  assert.equal(shown(), 'axis', 'full detail to begin with');
  ch.setDistance(LOD_FAR + 5);
  assert.equal(shown(), 'axis_lod', 'low detail far away');
  ch.setDistance((LOD_FAR + LOD_NEAR) / 2);
  assert.equal(shown(), 'axis_lod', 'between the two lines nothing changes');
  ch.setDistance(LOD_NEAR - 1);
  assert.equal(shown(), 'axis', 'full detail when close again');
  ch.setDistance((LOD_FAR + LOD_NEAR) / 2);
  assert.equal(shown(), 'axis', 'still full between the lines on the way out');
  assert.ok(ch.far === false);
  // aiming at him 35 m off: ai.js gives the distance times the view's scale
  ch.setDistance(LOD_FAR + 5);
  assert.equal(shown(), 'axis_lod');
  ch.setDistance(35 * ads);
  assert.equal(shown(), 'axis', 'down the sights a soldier 35 m off has his full detail');

  // a rig without the low-detail meshes ignores distance
  const old = new THREE.Group();
  const bone = new THREE.Bone();
  old.add(bone);
  const only = skinned('allied');
  old.add(only);
  only.bind(new THREE.Skeleton([bone]));
  const plain = createCharacter({ scene: old, animations: [] }, matlib, { outfit: 'allied', scene: new THREE.Scene() });
  plain.setDistance(500);
  assert.ok(plain.meshes.every((m) => m.visible), 'no low-detail mesh: the full one stays');
}

/* ---------- vegetation ---------- */
{
  const model = (name, h) => ({
    name, box: new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, h, 2)),
    prims: [{ key: 'm', geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial() }],
  });
  const lib = new Map([['oak', model('oak', 10)], ['oak_mid', model('oak_mid', 10)], ['oak_lod', model('oak_lod', 10)],
    ['pine', model('pine', 10)], ['pine_lod', model('pine_lod', 10)]]);
  const veg = createVegetation(lib, matlib, { near: 52, far: 330, midNear: 22 });
  // a row of each in front of the camera (looking +z), and one behind it
  for (const z of [10, 30, 45, 80, -40]) { veg.add('oak', 0, 0, z); veg.add('pine', 3, 0, z); }
  veg.finalize?.();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, 10);
  camera.updateMatrixWorld();
  veg.update(1, camera, { treeNear: 52, grass: 1 });
  const count = (name) => veg.group.children.filter((m) => m.name.startsWith(name + ':')).reduce((n, m) => n + m.count, 0);
  assert.equal(count('oak'), 1, 'full oak inside 22 m');
  assert.equal(count('oak_mid'), 2, 'mid oaks from 22 to 52 m');
  assert.equal(count('oak_lod'), 1, 'impostor beyond 52 m');
  assert.equal(count('pine'), 3, 'no _mid model: full detail all the way to 52 m');
  assert.equal(count('pine_lod'), 1);
  // down the sights: the oak at 30 m looks as at 22 m, full detail; the 45 m one stays mid
  veg.update(1, camera, { treeNear: 52, grass: 1 }, ads);
  assert.equal(count('oak'), 2, 'aiming in, the oak 30 m off has full detail');
  assert.equal(count('oak_mid'), 1);
  assert.equal(count('oak_lod'), 1, 'the one at 80 m still an impostor (52 m looks as 72 m)');
}

console.log(`lod-check: soldiers switch detail at ${LOD_FAR} m (back at ${LOD_NEAR} m); trees sort into full, mid and far, and the one behind the camera is dropped; down the sights detail reaches ${(1 / ads).toFixed(2)}x further`);
