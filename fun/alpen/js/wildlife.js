/* Rabbits and bears.

   Two animals with opposite jobs. The rabbits exist to react: they sit in
   the snow twitching until a rider gets inside fifteen metres and then bolt,
   which costs nothing, endangers nothing, and is most of what makes the
   mountain feel inhabited rather than decorated. Threading one is worth a
   few points, so there is a reason to aim at them.

   The bears exist to be the only thing on the hill that is genuinely
   dangerous, and for a long time they were far too common for that to mean
   anything. A bear respawned the instant the last one went past the rider,
   so a long run was a queue of them and the player stopped reading a bear as
   a threat and started reading it as traffic. There is now one bear at most,
   it does not appear inside the first kilometre, and when a spawn window
   finally comes round it is refused about two times in three — with tens of
   seconds of quiet before the next one is even offered. Most runs have no
   bear in them at all. That is the point: a bear should be a story you tell
   about a run, not a feature of every run.

   The other thing that changed underneath this file is the shape of the run.
   The corridor is roughly three times wider than it was, its width breathes
   along the descent, and the piste periodically splits into two lines around
   an island of trees. Nothing here may assume a single centre or a constant
   half-width any more: animals are placed against `centersAt`/`nearestCenter`
   and `corridorHalfAt`, and the bear turns around at the edge the mountain
   actually has at its own z rather than at a number from the config.

   Both are single instanced meshes with their parts baked in by `compose`,
   so seventeen animals are two draw calls. Neither has a skeleton, and
   neither needs one: a bound is a squash plus a pitch about the hare's own
   lateral axis, and a rear is a rotation about the bear's hips. The models
   themselves are much heavier than they were — the game renders at native
   resolution now, and the budget that justified a bear with four identical
   cylinders for legs no longer exists. */

import { compose } from './geom.js';
import { WILDLIFE } from './config.js';
import { heightAt, centersAt, nearestCenter, corridorHalfAt } from './terrain.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const range = ([lo, hi]) => lo + Math.random() * (hi - lo);
/* Triangular on [-1, 1] rather than uniform: with a corridor this wide a
   uniform scatter puts most of the rabbits somewhere the rider is never
   going to be, and the mountain reads as emptier than its animal count. */
const spread = () => Math.random() + Math.random() - 1;

/* Which of the two branch centres to hang an animal off at this z.

   `centersAt` hands back both, equal when the run is not forked there. When
   it is forked, picking at random populates both sides of the island, which
   is right — an empty far branch looks like a bug. But doing only that
   throws half the animals ninety metres across a stand of trees where the
   rider will never learn they exist, so the branch the rider's own line is
   nearer wins the toss most of the time, and `away` is the share that goes
   to the other one anyway. */
function branchAt(z, riderX, away) {
  const [c0, c1] = centersAt(z);
  if (Math.abs(c0 - c1) < 1e-6) return c0;
  const near = Math.abs(riderX - c0) <= Math.abs(riderX - c1) ? c0 : c1;
  return Math.random() < away ? (near === c0 ? c1 : c0) : near;
}

/* A mountain hare, facing -Z, feet at y = 0.

   The old one was seven parts and read as a lump with ears: one body ball,
   one head ball, and nothing to say which end was which until it moved. A
   hare's silhouette is almost entirely about weight distribution — the rump
   is the tallest thing on it, the back falls away forwards to a much
   narrower chest, and the head is carried up and forward on a visible neck.
   Building it as a chain of five tapering masses down that line costs a few
   hundred triangles and is the whole difference between a rabbit and a
   potato. The long flat hind feet and the shaded haunches do the rest: they
   are what makes a crouched hare look coiled rather than seated. */
function rabbitGeometry(THREE) {
  // These meshes are instanced, so the rounded silhouette is paid for once
  // in memory and shared by every animal.  The old 6--10 sided primitives
  // were visible as facets whenever a hare crossed the foreground.
  const ball = new THREE.SphereGeometry(0.5, 24, 16);
  const bead = new THREE.SphereGeometry(0.5, 16, 12);
  const box = new THREE.BoxGeometry(1, 1, 1);

  const fur = '#eef3fb';
  const shade = '#c9d6e6';
  const dark = '#1b1f27';
  const snow = '#ffffff';

  // Both ears share an axis; the tip rides further along the same one so the
  // black tips stay glued to the ear whatever the sweep is set to
  const ear = (side) => ([
    { geo: box, color: shade, pos: [side * 0.082, 0.514, -0.268], rot: [0.26, 0, -side * 0.16], scale: [0.055, 0.25, 0.024] },
    { geo: box, color: dark, pos: [side * 0.098, 0.612, -0.243], rot: [0.26, 0, -side * 0.16], scale: [0.058, 0.055, 0.026] },
  ]);

  const side = (s) => ([
    // haunch, shaded so the rear leg reads as a separate mass against the flank
    { geo: ball, color: shade, pos: [s * 0.135, 0.165, 0.115], scale: [0.145, 0.25, 0.30] },
    // the long hind foot, laid flat under the body — the giveaway that this is a hare
    { geo: box, color: fur, pos: [s * 0.115, 0.042, 0.055], rot: [0.05, s * 0.10, 0], scale: [0.08, 0.075, 0.30] },
    { geo: box, color: fur, pos: [s * 0.085, 0.085, -0.245], rot: [0.16, 0, 0], scale: [0.055, 0.175, 0.07] },
    { geo: box, color: shade, pos: [s * 0.085, 0.022, -0.268], scale: [0.06, 0.045, 0.105] },
    { geo: bead, color: dark, pos: [s * 0.076, 0.352, -0.388], scale: [0.046, 0.05, 0.038] },
    ...ear(s),
  ]);

  return compose(THREE, [
    // the line of the back: rump highest, falling away forwards to the chest
    { geo: ball, color: fur, pos: [0, 0.200, 0.150], scale: [0.33, 0.31, 0.36] },
    { geo: ball, color: fur, pos: [0, 0.175, -0.055], scale: [0.285, 0.265, 0.33] },
    { geo: ball, color: fur, pos: [0, 0.175, -0.215], scale: [0.245, 0.235, 0.245] },
    { geo: ball, color: fur, pos: [0, 0.245, -0.285], scale: [0.175, 0.185, 0.185] },
    { geo: ball, color: fur, pos: [0, 0.325, -0.350], scale: [0.185, 0.19, 0.235] },
    { geo: ball, color: fur, pos: [0, 0.290, -0.440], scale: [0.115, 0.105, 0.135] },
    { geo: bead, color: dark, pos: [0, 0.283, -0.500], scale: [0.038, 0.03, 0.032] },
    { geo: ball, color: snow, pos: [0, 0.235, 0.300], scale: [0.125, 0.12, 0.095] },
    ...side(-1),
    ...side(1),
  ]);
}

/* A brown bear, facing -Z, feet at y = 0.

   Two things were wrong with the old one. Its legs were four identical
   cylinders, which is what makes a quadruped read as a table; and it was
   built facing -Z while the animation code below turned and pitched it as
   though it faced +Z, so the bear walked backwards and ducked its head
   instead of rearing. The second is fixed at the call site — see the compose
   step in `update` — and the geometry now commits properly to -Z.

   For the legs: the front pair are straight columns hung off a shoulder cap,
   the rear pair are a big haunch mass over a shorter shank, and both taper
   into a paw with claws on the front edge. That asymmetry is most of what
   separates a bear from a large dog at any distance. The shoulder hump is
   the other half — it is the highest point on a grizzly, it sits forward of
   the middle, and putting it in a lighter coat than the flanks means the
   animal has a readable back line even against a white hill. */
function bearGeometry(THREE) {
  const ball = new THREE.SphereGeometry(0.5, 24, 16);
  const bead = new THREE.SphereGeometry(0.5, 16, 12);
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Tapered so a limb has a wrist; the snout is the same cone used nose-first
  const limb = new THREE.CylinderGeometry(0.5, 0.38, 1, 16, 2);
  const snout = new THREE.CylinderGeometry(0.32, 0.5, 1, 20, 2);

  const coat = '#4a3628';
  const light = '#5b452f';
  const dark = '#33241a';
  const belly = '#2a1d15';
  const muzzle = '#7c5f45';
  const claw = '#cbbda2';
  const eye = '#12100e';

  const side = (s) => ([
    // front: shoulder cap, straight column, broad paw, claws on the toe
    { geo: ball, color: coat, pos: [s * 0.52, 1.00, -0.70], scale: [0.56, 0.66, 0.62] },
    { geo: limb, color: dark, pos: [s * 0.50, 0.52, -0.72], scale: [0.40, 1.04, 0.40] },
    { geo: box, color: dark, pos: [s * 0.50, 0.09, -0.80], scale: [0.40, 0.20, 0.52] },
    { geo: box, color: claw, pos: [s * 0.50, 0.055, -1.02], scale: [0.36, 0.10, 0.10] },
    // rear: the haunch carries the mass and the shank below it is shorter
    { geo: ball, color: coat, pos: [s * 0.50, 0.80, 0.86], scale: [0.62, 0.94, 0.92] },
    { geo: limb, color: dark, pos: [s * 0.47, 0.40, 0.74], scale: [0.38, 0.80, 0.38] },
    { geo: box, color: dark, pos: [s * 0.47, 0.09, 0.66], scale: [0.38, 0.20, 0.56] },
    { geo: box, color: claw, pos: [s * 0.47, 0.055, 0.36], scale: [0.34, 0.09, 0.09] },
    // small round ears, set wide and well back, with the inside facing forward
    { geo: ball, color: coat, pos: [s * 0.44, 1.62, -1.22], scale: [0.34, 0.34, 0.18] },
    { geo: ball, color: dark, pos: [s * 0.45, 1.62, -1.29], scale: [0.20, 0.20, 0.14] },
    { geo: bead, color: eye, pos: [s * 0.30, 1.40, -1.58], scale: [0.13, 0.13, 0.11] },
  ]);

  return compose(THREE, [
    { geo: ball, color: belly, pos: [0, 0.72, 0.05], scale: [1.30, 0.80, 2.30] },
    { geo: ball, color: coat, pos: [0, 1.04, 0.10], scale: [1.44, 1.30, 2.35] },
    // the hump, and a lighter band along the spine so the back line survives
    // being seen against snow at distance
    { geo: ball, color: light, pos: [0, 1.44, -0.58], scale: [1.16, 0.92, 1.20] },
    { geo: ball, color: light, pos: [0, 1.34, 0.30], scale: [1.12, 0.76, 1.90] },
    { geo: ball, color: coat, pos: [0, 0.92, -0.78], scale: [1.20, 1.06, 1.10] },
    { geo: ball, color: coat, pos: [0, 1.22, -1.10], scale: [0.86, 0.80, 0.70] },
    { geo: ball, color: coat, pos: [0, 1.26, -1.42], scale: [0.74, 0.70, 0.80] },
    // brow ridge, so the eyes sit in shadow rather than on a bald curve
    { geo: box, color: dark, pos: [0, 1.46, -1.56], rot: [0.12, 0, 0], scale: [0.56, 0.12, 0.30] },
    // the cone stood on its side, narrow end forward: +Y becomes -Z under a
    // quarter turn about X, which is why the taper is written backwards
    { geo: snout, color: muzzle, pos: [0, 1.16, -1.72], rot: [-Math.PI / 2, 0, 0], scale: [0.66, 0.58, 0.56] },
    { geo: box, color: dark, pos: [0, 1.00, -1.72], scale: [0.34, 0.14, 0.46] },
    { geo: ball, color: eye, pos: [0, 1.155, -2.00], scale: [0.30, 0.22, 0.14] },
    { geo: ball, color: dark, pos: [0, 1.10, 1.32], scale: [0.24, 0.22, 0.20] },
    ...side(-1),
    ...side(1),
  ]);
}

/* How far the bear's hind paws sit behind its origin. A rear is a rotation
   about that origin, so without lifting by this much the animal stands up by
   burying its back feet in the snow. */
const BEAR_HIND = 0.75;
/* And how much of the corridor a bear is allowed to spawn across. The
   corridor is wide enough now that a uniform placement puts the bear well
   outside the line anyone is riding, which for something this rare is a
   wasted encounter — so it starts near the middle of a branch and walks out
   from there. */
const BEAR_OFFSET = 0.45;

export function createWildlife(THREE, shading) {
  const group = new THREE.Group();

  // Smooth normals keep the denser rounded forms from breaking into visible
  // facets, while the boxes used for paws, ears and claws retain their hard
  // edges because BoxGeometry supplies split face normals.
  const animalMaterial = () => shading.apply(
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false }),
  );
  const rabbits = new THREE.InstancedMesh(
    rabbitGeometry(THREE), animalMaterial(), WILDLIFE.rabbits,
  );
  const bears = new THREE.InstancedMesh(
    bearGeometry(THREE), animalMaterial(), WILDLIFE.bears,
  );
  rabbits.frustumCulled = false;
  bears.frustumCulled = false;
  rabbits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bears.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(rabbits, bears);

  /* EYE-SHINE. An animal caught in a head torch answers it: the tapetum
     throws the beam straight back, and two green points in the dark are how
     every real night walker meets its wildlife long before it resolves a
     shape. One additive instanced quad per eye, billboarded in the vertex
     shader from the instance's own position, so no CPU ever has to know
     where the camera is. The glow value rides an instanced attribute and is
     the whole story per eye: lamp level times beam alignment times distance.

     The lamp itself lives three modules away on the rider's head, so this
     mesh defaults to invisible and stays that way until someone calls
     `setLamp` each frame with the headlamp's level, origin and direction —
     see the wiring note on the returned object. */
  const RABBIT_EYES = [[-0.076, 0.352, -0.388], [0.076, 0.352, -0.388]];
  const BEAR_EYES = [[-0.30, 1.40, -1.58], [0.30, 1.40, -1.58]];
  const EYE_MAX = (WILDLIFE.rabbits + WILDLIFE.bears) * 2;
  const EYE_REACH = 45;
  const eyeGeo = new THREE.PlaneGeometry(1, 1);
  const eyeGlow = new THREE.InstancedBufferAttribute(new Float32Array(EYE_MAX), 1);
  eyeGlow.setUsage(THREE.DynamicDrawUsage);
  eyeGeo.setAttribute('aGlow', eyeGlow);
  /* Fogged by hand like every other custom night shader: a ShaderMaterial
     never hears about scene.fog, and an eye that outshines a whiteout is a
     targeting reticle, not an animal. `uFog` is unused by an additive glint
     — fading the alpha is the whole of it — but the uniform trio stays so
     main.js can feed this material from the same per-frame loop as the
     snowfall and the spray. */
  const eyeMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#cfeec2') },
      uFog: { value: new THREE.Color('#1a2a48') },
      uNear: { value: 85 },
      uFar: { value: 300 },
    },
    vertexShader: `
      attribute float aGlow;
      varying float vGlow;
      varying vec2 vQuad;
      varying float vDepth;
      void main() {
        vQuad = position.xy;
        vGlow = aGlow;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vDepth = -mv.z;
        // The quad grows a little with depth so a far eye never collapses
        // under a pixel — a sub-pixel additive point is exactly the kind of
        // detail the retro resample turns into shimmer.
        float size = 0.055 + max(-mv.z, 0.0) * 0.0042;
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      uniform vec3 uColor;
      uniform vec3 uFog;
      uniform float uNear;
      uniform float uFar;
      varying float vGlow;
      varying vec2 vQuad;
      varying float vDepth;
      void main() {
        // A soft gaussian point with no edge to alias; corners fall to zero
        // before the quad does.
        float r2 = dot(vQuad, vQuad) * 4.0;
        float a = vGlow * exp(-5.0 * r2) * max(1.0 - r2, 0.0);
        float f = clamp((vDepth - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(uColor, a * (1.0 - f));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const eyes = new THREE.InstancedMesh(eyeGeo, eyeMat, EYE_MAX);
  eyes.frustumCulled = false;
  eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  eyes.userData.noShadow = true;
  eyes.visible = false;
  group.add(eyes);

  const lampOrigin = new THREE.Vector3();
  const lampDir = new THREE.Vector3(0, 0, -1);
  let lampLevel = 0;
  /* Called once a frame by whoever owns the headlamp. All three arguments
     are copied, so callers may hand over their live working vectors. */
  function setLamp(level, origin, direction) {
    lampLevel = level || 0;
    if (origin) lampOrigin.copy(origin);
    if (direction) lampDir.copy(direction);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  const ev = new THREE.Vector3();
  const toEye = new THREE.Vector3();
  const em = new THREE.Matrix4();
  let eyeCount = 0;

  /* Both eyes of the animal whose matrix is currently in `m`. The glow is
     retroreflection, so it is aimed from the lamp rather than from the
     camera: full inside the beam's bright core, gone a few degrees outside
     it, and fading over the lamp's reach — which means a hare picked out at
     the edge of the pool glints, and the same hare beside the beam does
     not. Instances are compacted, so a dark eye costs nothing at all. */
  function shineEyes(offsets) {
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i];
      ev.set(o[0], o[1], o[2]).applyMatrix4(m);
      toEye.copy(ev).sub(lampOrigin);
      const d = toEye.length();
      if (d < 2 || d > EYE_REACH) continue;
      const aim = (toEye.x * lampDir.x + toEye.y * lampDir.y + toEye.z * lampDir.z) / d;
      const g = lampLevel * clamp((aim - 0.90) * 12.5, 0, 1) * (1 - d / EYE_REACH);
      if (g < 0.01) continue;
      eyeGlow.array[eyeCount] = g;
      em.setPosition(ev);
      eyes.setMatrixAt(eyeCount++, em);
    }
  }

  const hares = [];
  for (let i = 0; i < WILDLIFE.rabbits; i++) {
    hares.push({ x: 0, z: 1, yaw: 0, vx: 0, vz: 0, flee: 0, hop: Math.random() * 10, alive: false, seen: false });
  }
  const beasts = [];
  for (let i = 0; i < WILDLIFE.bears; i++) {
    beasts.push({ x: 0, z: 1, yaw: 0, dir: 1, rear: 0, alive: false, hit: false, near: false, walk: Math.random() * 6 });
  }

  function placeRabbit(r, rider) {
    const z = rider.pos.z - range(WILDLIFE.rabbitSpawnRange);
    r.z = z;
    // Out past the groomed edge as well as inside it — a hare that only ever
    // sits on the piste is furniture, and the twelve metres of trees either
    // side are where it looks like it lives
    r.x = branchAt(z, rider.pos.x, 0.3) + spread() * (corridorHalfAt(z) + 12);
    r.yaw = Math.random() * Math.PI * 2;
    r.vx = 0;
    r.vz = 0;
    r.flee = 0;
    r.alive = true;
    r.seen = false;
  }

  function placeBear(b, rider) {
    const z = rider.pos.z - range(WILDLIFE.bearSpawnRange);
    b.z = z;
    // Almost always the branch the rider's line is already nearer. At a fork
    // that is a guess about which side of the island they will take, and
    // sometimes it is wrong — but a bear seen across the trees is a fine
    // outcome too, and it is the only way the far branch is ever inhabited.
    b.x = branchAt(z, rider.pos.x, 0.12)
      + (Math.random() * 2 - 1) * corridorHalfAt(z) * BEAR_OFFSET;
    b.dir = Math.random() < 0.5 ? -1 : 1;
    b.yaw = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    b.rear = 0;
    b.alive = true;
    b.hit = false;
    b.near = false;
  }

  /* Seconds until the next chance of a bear. Drawn fresh after every
     attempt, taken or refused, so the gap between two bears is a respawn
     wait times however many refusals it took — which is what actually makes
     the mountain empty rather than merely thinned out. */
  let bearClock = range(WILDLIFE.bearRespawn);

  /* `onNear` is called when the rider threads an animal without hitting it;
     `onHit` when a bear is not so lucky. */
  function update(dt, rider, onNear, onHit) {
    const rx = rider.pos.x;
    const rz = rider.pos.z;
    const lampOn = lampLevel > 0.01;
    eyeCount = 0;

    // --- rabbits -----------------------------------------------------------
    let n = 0;
    for (const r of hares) {
      if (!r.alive || r.z > rz + 26) placeRabbit(r, rider);

      const dx = r.x - rx;
      const dz = r.z - rz;
      const dist = Math.hypot(dx, dz);

      if (dist < WILDLIFE.rabbitFlee && r.flee <= 0) {
        // Away from the rider and across the hill, because straight down the
        // fall line from a snowboarder is not an escape
        r.flee = 2.6;
        const away = Math.atan2(dx, dz);
        r.yaw = away + (Math.random() - 0.5) * 1.2;
        // Start the bound at phase zero, which is the hare on the snow.
        // Inheriting whatever phase the idle twitch had left behind meant a
        // hare could bolt by first snapping half a metre into the air.
        r.hop = 0;
      }
      if (r.flee > 0) {
        r.flee -= dt;
        const sp = WILDLIFE.rabbitSpeed * clamp(r.flee / 2.0, 0.25, 1);
        r.vx = Math.sin(r.yaw) * sp;
        r.vz = Math.cos(r.yaw) * sp;
        r.hop += dt * WILDLIFE.rabbitHop;
      } else {
        r.vx *= 0.9;
        r.vz *= 0.9;
        r.hop += dt * 0.9;
      }
      r.x += r.vx * dt;
      r.z += r.vz * dt;

      if (!r.seen && dist < 2.6 && Math.abs(dz) < 2.0) {
        r.seen = true;
        onNear(r.x, r.z, 'rabbit');
      }

      /* A bound is a bounce, a squash and — now — a pitch, all on the one
         phase. The period is the trap here. `|sin|` makes a single bound a
         *half* cycle of `hop`, so anything driving the pitch has to have that
         same period or every other bound comes out inverted, which is exactly
         what `cos(hop)` did when it was tried: the hare rose nose-up and
         landed nose-down, then did the whole thing backwards on the next hop.
         `sin(hop·2)` shares the period and is continuous across the join —
         nose up through the climb, down through the drop, level on the snow
         and level over the top, which is a bound.

         `land` eases the bound out over the last third of a second instead of
         switching it off. The flee speed only decays to a quarter, so a hare
         that was still travelling at 2.4 m/s when the timer expired used to
         drop half a metre onto the snow in a single frame. */
      const land = r.flee > 0 ? clamp(r.flee / 0.35, 0, 1) : 0;
      const idle = Math.sin(r.hop * 2.4) * 0.03;
      const bounce = Math.abs(Math.sin(r.hop)) * land;
      const squash = 1 + Math.cos(r.hop * 2) * 0.12 * land + idle * (1 - land);
      const pitch = Math.sin(r.hop * 2) * 0.30 * land + Math.sin(r.hop * 0.9) * 0.05 * (1 - land);
      v.set(r.x, heightAt(r.x, r.z) + bounce * 0.55, r.z);
      // YXZ, not the default XYZ: the pitch has to happen about the hare's
      // own lateral axis, and under XYZ it would be about the world's — so a
      // hare running along +X would rock sideways instead of bounding.
      e.set(pitch, r.yaw + Math.PI, 0, 'YXZ');
      q.setFromEuler(e);
      s.set(1 / squash, squash, 1 / squash);
      m.compose(v, q, s);
      rabbits.setMatrixAt(n++, m);
      if (lampOn) shineEyes(RABBIT_EYES);
    }
    rabbits.count = n;
    // Nothing changed on the GPU's side of an empty pool, so an upload is
    // only queued when there are live instances to carry.
    if (n > 0) rabbits.instanceMatrix.needsUpdate = true;

    // --- bears -------------------------------------------------------------
    /* The spawn window, which is deliberately most of the reason there is
       usually no bear. The clock only runs when the hill is empty of them
       and the run has gone far enough to have earned one — if it ran during
       the first kilometre a bear would be waiting at the exact metre the
       rule expires, every single time — and reaching zero only offers a
       spawn, which `bearChance` then usually turns down. */
    if (rider.distance > WILDLIFE.bearFrom) {
      const idle = beasts.find((b) => !b.alive);
      if (idle) {
        bearClock -= dt;
        if (bearClock <= 0) {
          bearClock = range(WILDLIFE.bearRespawn);
          if (Math.random() < WILDLIFE.bearChance) placeBear(idle, rider);
        }
      }
    }

    let bn = 0;
    for (const b of beasts) {
      // Nothing here kills a live bear for being below `bearFrom`: the debug
      // hatch places one by hand at any distance, and it used to be wiped
      // the next frame.
      if (!b.alive) continue;
      if (b.z > rz + 30) { b.alive = false; continue; }

      const dx = b.x - rx;
      const dz = b.z - rz;
      const dist = Math.hypot(dx, dz);

      // A bear notices you long before you reach it, and stands up about it
      const near = clamp(1 - (dist - 8) / 22, 0, 1);
      b.rear += (near - b.rear) * (1 - Math.exp(-3 * dt));
      const walk = 1 - b.rear;
      b.walk += dt * 2.4 * walk;
      b.x += b.dir * WILDLIFE.bearSpeed * walk * dt;

      /* Turn around at the treeline rather than wandering into the forest —
         but the treeline is not a constant any more, and there may be two of
         them. The corridor is measured from whichever branch centre is
         nearer, which also makes a fork behave correctly on its own: while
         the split is narrower than the corridor the two overlap, and a bear
         crossing the middle simply hands off to the other centre and keeps
         going, so it walks the full width of a briefly doubled piste.

         The direction test matters. Without it, a bear that starts outside
         its corridor for any reason flips every frame and vibrates on the
         spot instead of walking back in. */
      const out = b.x - nearestCenter(b.x, b.z);
      if (Math.abs(out) > corridorHalfAt(b.z) && Math.sign(out) === b.dir) b.dir *= -1;
      b.yaw = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;

      // A hit and a near miss are tracked separately, and the near miss is
      // only awarded once the bear is behind. Sharing one flag meant every
      // head-on approach crossed the 2.4–3.4 m band first, claimed BEAR
      // DODGED, and then suppressed the collision — so the one genuinely
      // dangerous thing on the mountain was harmless in the common case.
      const level = Math.abs(rider.pos.y - heightAt(b.x, b.z)) < 2.4;
      if (!b.hit && level && dist < WILDLIFE.bearRadius + 0.9) {
        b.hit = true;
        onHit(b.x, b.z);
      } else if (!b.hit && !b.near && dz > 0.5 && dist < 3.4) {
        b.near = true;
        onNear(b.x, b.z, 'bear');
      }

      /* The rear, and the two sign fixes that come with the model now
         honestly facing -Z. The yaw gains a half turn — exactly the one the
         rabbits always had and the bear never did, which is why it used to
         walk backwards — and the pitch loses its minus, because on a model
         whose head is at -Z a positive rotation about the local X axis is
         what lifts the head rather than what buries it. The old bear
         approached the rider tail first and ducked. */
      const pitch = b.rear * 0.55;
      // Rolling about the model's own long axis is the shoulder sway of a
      // walking bear, and reads as weight in a way the vertical squash never
      // did on its own. Both fade out as the animal stands up.
      const roll = Math.sin(b.walk) * 0.05 * walk;
      // Rearing about the origin swings the hind paws below the snow, so the
      // whole animal rises by just enough to leave them planted
      v.set(b.x, heightAt(b.x, b.z) + Math.sin(pitch) * BEAR_HIND, b.z);
      e.set(pitch, b.yaw + Math.PI, roll, 'YXZ');
      q.setFromEuler(e);
      const lumber = 1 + Math.sin(b.walk * 2) * 0.045 * walk;
      s.set(1, lumber, 1);
      m.compose(v, q, s);
      bears.setMatrixAt(bn++, m);
      if (lampOn) shineEyes(BEAR_EYES);
    }
    bears.count = bn;
    /* The guard matters most here: most runs have no bear at all, and this
       was flagging a zero-instance buffer dirty on every frame of them. A
       0 -> 0 frame now uploads nothing for either pool. */
    if (bn > 0) bears.instanceMatrix.needsUpdate = true;

    eyes.count = eyeCount;
    eyes.visible = eyeCount > 0;
    if (eyeCount > 0) {
      eyes.instanceMatrix.needsUpdate = true;
      eyeGlow.needsUpdate = true;
    }
  }

  function reset() {
    for (const r of hares) r.alive = false;
    for (const b of beasts) b.alive = false;
    bearClock = range(WILDLIFE.bearRespawn);
  }

  // The animals themselves are on the returned object so the debug hatch
  // can place one exactly where a test needs it. `setLamp` is the eye-shine
  // hookup: the owner of the run loop should call, once per frame after the
  // rider model has updated,
  //   wildlife.setLamp(model.headlamp.level,
  //     model.headlamp.origin, model.headlamp.direction)
  // — until it does, the lamp level stays zero and the eyes stay dark.
  // `eyes` is exposed for one reason: main.js feeds every hand-fogged
  // material from a single per-frame loop, and this is one of them.
  return { group, update, reset, setLamp, hares, beasts, eyes };
}
