/* Hedgerow — a soldier on screen.

   One rig (soldier.glb) with two outfits. The clips are split by bone into
   a lower-body layer (root, hips, legs: walk/run/strafe/crouch) and an
   upper-body layer (spine up: idle/aim/reload/throw), each cross-faded on
   its own, so a soldier can run while aiming or crouch-walk while
   reloading. After the mixer, the spine and chest are bent by the aim
   pitch, the weapon rides on the `socket_weapon` empty in the right hand,
   and a soft contact shadow sits under the feet. Deaths play the whole
   clip on both layers. In first person the head is folded away from the
   eyes (its bone shrunk to nothing) and a stand-in of the head and helmet,
   drawing nothing in the view, keeps his shadow whole. */

import * as THREE from 'three';
import { clone as cloneSkinned } from '../assets/utils/SkeletonUtils.js';
import { instantiate } from './assets.js';
import { mergeGeometries } from '../assets/utils/BufferGeometryUtils.js';
import { createRagdoll } from './ragdoll.js';

const LOWER = new Set(['root', 'hips', 'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r']);
// first person: the head bone's scale while the head is folded away from the eyes
const SHRUNK = 0.001;

let shadowTex = null;
function contactShadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

/* Split every clip into lower/upper halves once per gltf. */
function splitClips(gltf) {
  if (gltf._split) return gltf._split;
  const lower = {}, upper = {}, full = {};
  for (const clip of gltf.animations) {
    const lo = [], up = [];
    for (const t of clip.tracks) {
      const bone = t.name.split('.')[0];
      (LOWER.has(bone) ? lo : up).push(t);
    }
    lower[clip.name] = new THREE.AnimationClip(clip.name + '_lo', clip.duration, lo);
    upper[clip.name] = new THREE.AnimationClip(clip.name + '_up', clip.duration, up);
    full[clip.name] = clip;
  }
  gltf._split = { lower, upper, full };
  return gltf._split;
}

/* A copy of the rig whose outfits are each one skinned mesh: the palette
   colours are baked into the vertex colours and drawn with a single
   material, so a soldier costs one draw call instead of one per material.
   Used for the enemies; the player keeps the full materials. */
export function mergedSoldier(gltf, matlib) {
  if (gltf._merged) return gltf._merged;
  const scene = cloneSkinned(gltf.scene);
  const material = matlib.get('cloth_feldgrau', { variant: 'merged', color: '#ffffff', roughness: 0.82, metalness: 0.02 });
  for (const outfit of ['allied', 'axis']) {
    const group = scene.getObjectByName(outfit);
    if (!group) continue;
    const parts = [];
    group.traverse((o) => { if (o.isSkinnedMesh) parts.push(o); });
    // baked outfits are one material already
    if (parts.length < 2 || parts.some(p => p.material?.map)) continue;
    const geos = parts.map((m) => {
      const g = m.geometry.clone();
      const key = (m.material?.name || 'cloth_od').replace(/\.\d+$/, '');
      const col = matlib.get(key).color;
      const n = g.attributes.position.count;
      const src = g.attributes.color;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const k = src ? src.getX(i) : 1, l = src ? src.getY(i) : 1, q = src ? src.getZ(i) : 1;
        c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * l; c[i * 3 + 2] = col.b * q;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
      }
      // the same attribute types everywhere so they merge
      for (const name of ['position', 'normal', 'uv', 'skinWeight']) {
        const a = g.attributes[name];
        if (a && !(a.array instanceof Float32Array)) {
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
          g.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
        }
      }
      const si = g.attributes.skinIndex;
      if (si && !(si.array instanceof Uint16Array)) g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(si.array), 4));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const first = parts[0];
    const mesh = new THREE.SkinnedMesh(merged, material);
    mesh.name = outfit + '_merged';
    mesh.bind(first.skeleton, first.bindMatrix);
    mesh.position.copy(first.position); mesh.quaternion.copy(first.quaternion); mesh.scale.copy(first.scale);
    const parent = first.parent;
    for (const p of parts) p.parent.remove(p);
    parent.add(mesh);
  }
  gltf._merged = { scene, animations: gltf.animations, _split: null, merged: true };
  return gltf._merged;
}

const ONE_SHOT = new Set(['reload', 'throw', 'hit', 'death_fwd', 'death_back', 'death_crumple']);

/* Beyond LOD_FAR metres a soldier is drawn with his outfit's low-detail mesh
   (`<outfit>_lod` in the rig, same skin and material, no face shapes), back
   to the full one inside LOD_NEAR (the gap keeps it from flickering). */
export const LOD_FAR = 30, LOD_NEAR = 26;

/* A face for one soldier: the head's shape keys (morph targets in the rig)
   blended, from gaunt to broad, and some years older. The build is pushed
   away from the middle (square root) so most men are clearly one or the
   other; age is spread evenly up to 0.9. */
export function randomFace(R = Math.random) {
  const b = R() * 2 - 1;
  const build = Math.sign(b) * Math.sqrt(Math.abs(b));
  return { face_broad: Math.max(0, build), face_gaunt: Math.max(0, -build), face_older: R() * 0.9 };
}

/* A stand-in soldier (capsule body, head, rifle) with the same interface,
   used when the rig is not available. */
function createStandIn(matlib, { outfit, scene }) {
  const root = new THREE.Group();
  root.name = 'standin_' + outfit;
  const plain = (key) => { const m = matlib.get(key).clone(); m.vertexColors = false; return m; };
  const cloth = plain(outfit === 'allied' ? 'cloth_od' : 'cloth_feldgrau');
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.9, 4, 10), cloth);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), plain('skin'));
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), plain(outfit === 'allied' ? 'helmet_od' : 'helmet_gray'));
  helmet.position.y = 1.65;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 1.0), plain('gun_wood'));
  gun.position.set(-0.18, 1.35, 0.35);
  root.add(body, head, helmet, gun);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, fog: false }));
  if (scene) scene.add(shadow);
  let dead = false, crouch = 0;
  const bonesAt = { head: 1.62, neck: 1.45, hips: 0.95, shin_l: 0.35, shin_r: 0.35, hand_r: 1.3, chest: 1.3, spine: 1.1 };
  return {
    root, bones: {}, mixer: { time: 0 }, socket: null, meshes: [body, head, helmet, gun], shadow,
    get weapon() { return gun; }, get dead() { return dead; }, get upper() { return 'idle'; },
    aimPitch: 0, setWeapon() {}, holdLeft() {}, releaseLeft() {}, setDistance() {}, far: false, clipLength: () => null, hasClip: () => false, socketL: null,
    animate(move) { crouch = move.startsWith('crouch') ? 1 : 0; },
    oneShot() { return 0.5; },
    die() { dead = true; },
    update(dt, ground) {
      const s = dead ? 0.25 : 1 - crouch * 0.35;
      root.scale.y += (s - root.scale.y) * Math.min(1, dt * 10);
      root.updateMatrixWorld(true);
      if (ground != null) shadow.position.set(root.position.x, ground + 0.03, root.position.z);
    },
    muzzleWorld(out = new THREE.Vector3()) { return gun.localToWorld(out.set(0, 0, 0.5)); },
    headWorld(out = new THREE.Vector3()) { return head.getWorldPosition(out); },
    boneWorld(name, out = new THREE.Vector3()) {
      out.copy(root.position);
      out.y += (bonesAt[name] ?? 1) * root.scale.y;
      return out;
    },
    dispose() { shadow.parent?.remove(shadow); root.parent?.remove(root); },
  };
}

export function createCharacter(gltf, matlib, { outfit = 'allied', weaponModel = null, grenadeModel = null, scene, face = null }) {
  if (!gltf) return createStandIn(matlib, { outfit, scene });
  const root = cloneSkinned(gltf.scene);
  root.name = 'soldier_' + outfit;
  const other = outfit === 'allied' ? 'axis' : 'allied';
  const meshes = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh || o.isMesh) {
      let owner = o;
      while (owner && owner.name !== outfit && owner.name !== other) owner = owner.parent;
      const name = owner ? owner.name : '';
      if (name === other || (o.name.startsWith(other))) { o.visible = false; return; }
      if (!o.name.endsWith('_merged')) o.material = matlib.resolve(o.material);
      o.frustumCulled = false;
      // its bounds, for the renderer's sorting only (it is never culled): the bind pose's, with room
      // for the limbs; left to three, the first frame he is drawn skinned every vertex on the CPU
      // to find them (some ten milliseconds a soldier)
      if (o.isSkinnedMesh) {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        o.boundingSphere = o.geometry.boundingSphere.clone();
        o.boundingSphere.radius += 0.6;
      }
      o.receiveShadow = true;
      meshes.push(o);
    }
  });
  // drop the other outfit entirely (saves skinning work)
  const drop = [];
  root.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && !o.visible) drop.push(o); });
  for (const o of drop) o.parent.remove(o);
  // the low-detail stand-in for distance, hidden until setDistance() asks for it
  const lodMeshes = meshes.filter((m) => /_lod$/.test(m.name));
  const fullMeshes = meshes.filter((m) => !/_lod$/.test(m.name));
  for (const m of lodMeshes) m.visible = false;
  let far = false;
  function setDistance(d) {
    if (!lodMeshes.length) return;
    const f = far ? d > LOD_NEAR : d > LOD_FAR;
    if (f === far) return;
    far = f;
    for (const m of fullMeshes) m.visible = !far;
    for (const m of lodMeshes) m.visible = far;
  }
  // this soldier's face (each clone has its own morph weights; a rig without the keys ignores it)
  if (face) for (const m of meshes) {
    const dict = m.morphTargetDictionary;
    if (!dict || !m.morphTargetInfluences) continue;
    for (const [k, w] of Object.entries(face)) if (dict[k] !== undefined) m.morphTargetInfluences[dict[k]] = w;
  }

  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const socket = root.getObjectByName('socket_weapon');
  const socketL = root.getObjectByName('socket_weapon_l');

  /* The head and helmet as one rigid piece in the head bone's own space, hung on the head
     bone and scaled back up from its shrinking: it sits where the full-size head would be,
     draws nothing in the view (no colour, no depth) and casts its shadow with the body (it
     joins `meshes`, whose shadows main.js switches on near a shadow-casting light). */
  function headShadow() {
    const skin = fullMeshes.find((m) => m.isSkinnedMesh);
    const hi = skin && bones.head ? skin.skeleton.bones.indexOf(bones.head) : -1;
    if (hi < 0 || skin.bindMode !== THREE.AttachedBindMode) return null;
    const g = skin.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const onHead = (i) => {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k);
      return w > 0.5;
    };
    const toHead = new THREE.Matrix4().multiplyMatrices(skin.skeleton.boneInverses[hi], skin.bindMatrix);
    const n = g.index ? g.index.count : pos.count, at = (t) => (g.index ? g.index.getX(t) : t);
    const kept = new Int32Array(pos.count).fill(-1), xyz = [], tris = [], v = new THREE.Vector3();
    for (let t = 0; t + 2 < n; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      if (!onHead(a) || !onHead(b) || !onHead(c)) continue;
      for (const i of [a, b, c]) {
        if (kept[i] < 0) { kept[i] = xyz.length / 3; v.fromBufferAttribute(pos, i).applyMatrix4(toHead); xyz.push(v.x, v.y, v.z); }
        tris.push(kept[i]);
      }
    }
    if (!tris.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3));
    geo.setIndex(tris);
    // both faces into the shadow maps, so a single-sided brim still shows in the silhouette
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: THREE.DoubleSide }));
    mesh.name = 'head_shadow';
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeScale(1 / SHRUNK, 1 / SHRUNK, 1 / SHRUNK);
    bones.head.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  let weapon = null, muzzleLocal = new THREE.Vector3(0, 0, 0.6);
  const offhandLocal = new THREE.Vector3();
  function setWeapon(model) {
    if (weapon) { weapon.parent?.remove(weapon); weapon = null; }
    if (!model || !socket) return;
    weapon = instantiate(model, matlib);
    socket.add(weapon);
    const m = model.anchors.muzzle;
    if (m) muzzleLocal.set(m[0], m[1], m[2]);
    const o = model.anchors.offhand;
    offhandLocal.set(o ? o[0] : 0, o ? o[1] : 0, o ? o[2] : 0.3);
  }
  setWeapon(weaponModel);
  // a grenade appears in the right hand while throwing; the rifle goes to the left
  const grenade = grenadeModel && socket ? instantiate(grenadeModel, matlib) : null;
  if (grenade) { grenade.visible = false; socket.add(grenade); }
  // a magazine or clip in the left hand while reloading
  let leftProp = null;
  function holdLeft(model) {
    if (leftProp) { leftProp.parent?.remove(leftProp); leftProp = null; }
    if (!model || !socketL) return;
    leftProp = model.isObject3D ? model : instantiate(model, matlib);
    socketL.add(leftProp);
  }
  /* forget the left-hand prop without taking it out of the scene (dropped) */
  function releaseLeft() { leftProp = null; }
  function holdForThrow(on) {
    if (!weapon || !socketL) return;
    if (on) { socketL.add(weapon); weapon.position.copy(offhandLocal).negate(); }
    else { socket.add(weapon); weapon.position.set(0, 0, 0); }
    if (grenade) grenade.visible = on;
  }

  const mixer = new THREE.AnimationMixer(root);
  const clips = splitClips(gltf);
  const actions = { lower: {}, upper: {}, full: {} };
  const act = (layer, name) => {
    if (!clips[layer][name]) return null;
    let a = actions[layer][name];
    if (!a) {
      a = actions[layer][name] = mixer.clipAction(clips[layer][name]);
      if (ONE_SHOT.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    return a;
  };
  let lowerName = null, upperName = null, lowerAct = null, upperAct = null;
  let oneShot = null, oneShotEnd = 0, dead = false;
  let spineBase = null;       // the spine as the clips left it, before the aim pitch
  let spinePosBase = null;
  let clavBase = null;        // the collarbones as the clips left them, before the arms' lift
  let ragdoll = null;
  let headHidden = false, headStandIn = null;
  // first person: the pelvis (root and hips bones together) the upper body
  // rides on, held at each gait's average instead of bobbing and twisting
  // with every stride
  let steadyQ = null, steadyP = null;
  const tq = new THREE.Quaternion(), tqi = new THREE.Quaternion(), cq = new THREE.Quaternion(), cp = new THREE.Vector3();
  const meanPelvis = new Map();
  function pelvisMean(name) {
    if (meanPelvis.has(name)) return meanPelvis.get(name);
    const clip = clips.lower[name];
    let out = null;
    if (clip && bones.root && bones.hips) {
      const at = (bone, key) => clip.tracks.find((t) => t.name === `${bone}.${key}`)?.createInterpolant() || null;
      const rp = at('root', 'position'), rq = at('root', 'quaternion'), hp = at('hips', 'position'), hq = at('hips', 'quaternion');
      const N = 48, p = new THREE.Vector3(), sum = new THREE.Vector4(), q = new THREE.Quaternion(), q1 = new THREE.Quaternion();
      const v = new THREE.Vector3(), first = new THREE.Quaternion();
      for (let i = 0; i < N; i++) {
        const t = (clip.duration * i) / N;
        q.copy(bones.root.quaternion); if (rq) q.fromArray(rq.evaluate(t));
        q1.copy(bones.hips.quaternion); if (hq) q1.fromArray(hq.evaluate(t));
        v.copy(bones.hips.position); if (hp) v.fromArray(hp.evaluate(t));
        v.applyQuaternion(q);
        if (rp) v.add(new THREE.Vector3().fromArray(rp.evaluate(t))); else v.add(bones.root.position);
        p.add(v);
        q.multiply(q1);
        if (i === 0) first.copy(q);
        const s = first.dot(q) < 0 ? -1 : 1;
        sum.x += q.x * s; sum.y += q.y * s; sum.z += q.z * s; sum.w += q.w * s;
      }
      out = { p: p.divideScalar(N), q: new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize() };
    }
    meanPelvis.set(name, out);
    return out;
  }
  /* First person: both arms (and so the rifle) swung together about the
     chest, the head left where it is: `pitch` lifts (+) or dips, `yaw` turns
     to his left (+), `roll` cants the rifle's top towards his left (+). */
  const liftQ = new THREE.Quaternion(), pivot = new THREE.Vector3(), axis = new THREE.Vector3();
  const wq = new THREE.Quaternion(), pq = new THREE.Quaternion(), wp = new THREE.Vector3(), aq = new THREE.Quaternion();
  function liftArms(pitch, yaw, roll) {
    const chest = bones.chest || bones.spine;
    chest.getWorldPosition(pivot);
    root.getWorldQuaternion(aq);
    // cant about his forward, lift about his right, turn about the vertical
    liftQ.setFromAxisAngle(axis.set(0, 0, 1).applyQuaternion(aq), -roll)
      .premultiply(wq.setFromAxisAngle(axis.set(-1, 0, 0).applyQuaternion(aq), pitch))
      .premultiply(wq.setFromAxisAngle(axis.set(0, 1, 0), yaw));
    for (const b of [bones.clavicle_l, bones.clavicle_r]) {
      if (!b) continue;
      b.getWorldPosition(wp);
      b.getWorldQuaternion(wq);
      wp.sub(pivot).applyQuaternion(liftQ).add(pivot);
      wq.premultiply(liftQ);
      b.parent.worldToLocal(b.position.copy(wp));
      b.quaternion.copy(b.parent.getWorldQuaternion(pq).invert().multiply(wq));
      b.updateMatrixWorld(true);
    }
  }

  /* The spine re-seated as if the pelvis stood at the gait's average pose,
     so the chest, arms and rifle (and the eyes) ride smoothly on the
     walking legs; a change of gait (crouching, say) comes through quickly. */
  function steadyUpper(dt) {
    const r = bones.root, h = bones.hips, sp = bones.spine;
    if (!r) return;
    cq.multiplyQuaternions(r.quaternion, h.quaternion);
    cp.copy(h.position).applyQuaternion(r.quaternion).add(r.position);
    if (!steadyQ) { steadyQ = cq.clone(); steadyP = cp.clone(); }
    const m = lowerName ? pelvisMean(lowerName) : null;
    const k = 1 - Math.exp(-8 * dt);
    steadyQ.slerp(m ? m.q : cq, k);
    steadyP.lerp(m ? m.p : cp, k);
    tqi.copy(cq).invert();
    sp.position.applyQuaternion(steadyQ).add(steadyP).sub(cp).applyQuaternion(tqi);
    sp.quaternion.premultiply(tq.copy(tqi).multiply(steadyQ));
  }

  function play(layer, name, fade = 0.2, timeScale = 1) {
    const a = act(layer, name);
    if (!a) return null;
    if (layer === 'lower') {
      if (lowerName === name) { a.timeScale = timeScale; return a; }
      a.reset().setEffectiveWeight(1).fadeIn(fade).play();
      a.timeScale = timeScale;
      if (lowerAct && lowerAct !== a) lowerAct.fadeOut(fade);
      // keep the stride phase when switching between gaits
      if (lowerAct && lowerAct.isRunning() && !ONE_SHOT.has(name)) a.time = (lowerAct.time / lowerAct.getClip().duration) * a.getClip().duration;
      lowerAct = a; lowerName = name;
    } else {
      if (upperName === name && !ONE_SHOT.has(name)) { a.timeScale = timeScale; return a; }
      a.reset().setEffectiveWeight(1).fadeIn(fade).play();
      a.timeScale = timeScale;
      if (upperAct && upperAct !== a) upperAct.fadeOut(fade);
      upperAct = a; upperName = name;
    }
    return a;
  }

  // contact shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.8, fog: false }),
  );
  shadow.renderOrder = 1;
  shadow.name = 'contact_shadow';
  if (scene) scene.add(shadow);

  const state = {
    root, bones, mixer, socket, meshes, shadow,
    get weapon() { return weapon; },
    get dead() { return dead; },
    get ragdoll() { return ragdoll; },
    get upper() { return upperName; },
    setWeapon,
    holdLeft,
    releaseLeft,
    /* distance from the camera: picks the full or the low-detail mesh */
    setDistance,
    get far() { return far; },
    /* the clip's length in seconds (null when the rig lacks it) */
    clipLength(name) { return clips.full[name] ? clips.full[name].duration : null; },
    hasClip(name) { return !!clips.full[name]; },
    get socketL() { return socketL; },
    aimPitch: 0,
    lean: 0,
    steady: false,      // first person: the upper body steadied on the gait
    armsPitch: 0,       // first person: the arms and rifle swung up (+) or down about the chest,
    armsYaw: 0,         // turned to his left (+),
    armsRoll: 0,        // canted, top to his left (+)

    /* first person: the head (and the helmet on it) folded away from the eyes */
    hideHead(on) {
      headHidden = on;
      if (on && !headStandIn) headStandIn = headShadow();
      if (headStandIn) headStandIn.visible = on;
      if (!on && bones.head) bones.head.scale.setScalar(1);
    },

    /* Locomotion + upper body. `move` is a lower clip name, `upper` an
       upper clip name, `speed` scales the gait. */
    animate(move, upper, speed = 1) {
      if (dead) return;
      play('lower', move, 0.22, speed);
      if (!oneShot) play('upper', upper, 0.18);
      else state._pendingUpper = upper;
    },

    /* reload / throw / hit on the upper body; returns its duration. */
    oneShot(name, timeScale = 1) {
      if (dead) return 0;
      const a = play('upper', name, 0.12, timeScale);
      if (!a) return 0;
      if (oneShot === 'throw' && name !== 'throw') holdForThrow(false);
      if (name === 'throw') holdForThrow(true);
      oneShot = name;
      const dur = a.getClip().duration / timeScale;
      oneShotEnd = mixer.time + dur;
      return dur;
    },

    /* Death. With `world` the body becomes a ragdoll (velocity: how it was
       moving; impulses: [{part, vel}] from the shot or blast); without, or
       on a rig the ragdoll cannot drive, the death clip plays. */
    die(kind = 'death_fwd', { world = null, velocity, impulses } = {}) {
      if (dead) return;
      if (oneShot === 'throw') holdForThrow(false);
      holdLeft(null);
      dead = true;
      oneShot = null;
      if (world) {
        if (spineBase) bones.spine.quaternion.copy(spineBase);   // no aim pitch frozen in
        if (spinePosBase) bones.spine.position.copy(spinePosBase);
        if (clavBase) clavBase.forEach(([b, q, p]) => { b.quaternion.copy(q); b.position.copy(p); });
        ragdoll = createRagdoll(bones, world, { velocity, impulses, root });
        if (ragdoll) { mixer.stopAllAction(); return; }
      }
      const a = act('full', kind) || act('full', 'death_fwd');
      if (!a) return;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.reset().setEffectiveWeight(1).fadeIn(0.12).play();
      if (lowerAct) lowerAct.fadeOut(0.12);
      if (upperAct) upperAct.fadeOut(0.12);
    },

    update(dt, ground = null) {
      if (ragdoll) {
        ragdoll.step(dt);
        ragdoll.pose();
        if (ground != null) {
          const p = ragdoll.pelvis;
          shadow.position.set(p.x, ground + 0.03, p.z);
          shadow.visible = root.visible;
          shadow.scale.set(1.7, 1, 1.7);
        }
        return;
      }
      // The mixer only writes a bone when its animated value changed since
      // the last frame, so a held pose would keep last frame's aim pitch and
      // the next pitch would stack on it: put the clip's pose back first.
      if (spineBase) bones.spine.quaternion.copy(spineBase);
      if (spinePosBase) bones.spine.position.copy(spinePosBase);
      if (clavBase) clavBase.forEach(([b, q, p]) => { b.quaternion.copy(q); b.position.copy(p); });
      mixer.update(dt);
      if (oneShot && mixer.time >= oneShotEnd) {
        if (oneShot === 'throw') holdForThrow(false);
        if (oneShot.startsWith('reload')) holdLeft(null);
        oneShot = null;
        play('upper', state._pendingUpper || 'idle', 0.2);
      }
      root.updateMatrixWorld(true);
      if (bones.spine) {
        (spineBase ||= new THREE.Quaternion()).copy(bones.spine.quaternion);
        (spinePosBase ||= new THREE.Vector3()).copy(bones.spine.position);
      }
      if (bones.clavicle_l && bones.clavicle_r) {
        clavBase ||= [bones.clavicle_l, bones.clavicle_r].map((b) => [b, new THREE.Quaternion(), new THREE.Vector3()]);
        clavBase.forEach(([b, q, p]) => { q.copy(b.quaternion); p.copy(b.position); });
      }
      if (state.steady && !dead && bones.hips && bones.spine) {
        steadyUpper(dt);
        bones.spine.updateMatrixWorld(true);
      }
      if (!dead && state.aimPitch && bones.spine) {
        // the rig's spine pitches about its local X; negative is up
        bones.spine.rotateX(-state.aimPitch);
        bones.spine.updateMatrixWorld(true);
      }
      if (headHidden && bones.head) {
        bones.head.scale.setScalar(SHRUNK);
        bones.head.updateMatrixWorld(true);
      }
      if (!dead && (Math.abs(state.armsPitch) + Math.abs(state.armsYaw) + Math.abs(state.armsRoll)) > 1e-4) liftArms(state.armsPitch, state.armsYaw, state.armsRoll);
      if (ground != null) {
        shadow.position.set(root.position.x, ground + 0.03, root.position.z);
        shadow.visible = root.visible;
        const s = dead ? 1.7 : 1;
        shadow.scale.set(s, 1, s);
      }
    },

    muzzleWorld(out = new THREE.Vector3()) {
      if (!socket) return out.copy(root.position).setY(root.position.y + 1.4);
      out.copy(muzzleLocal);
      if (weapon) return weapon.localToWorld(out);
      return socket.localToWorld(out);
    },

    headWorld(out = new THREE.Vector3()) {
      return bones.head ? bones.head.getWorldPosition(out) : out.copy(root.position).setY(root.position.y + 1.6);
    },

    boneWorld(name, out = new THREE.Vector3()) {
      return bones[name] ? bones[name].getWorldPosition(out) : out.copy(root.position);
    },

    dispose() {
      shadow.parent?.remove(shadow);
      root.parent?.remove(root);
      mixer.stopAllAction();
    },
  };
  return state;
}
