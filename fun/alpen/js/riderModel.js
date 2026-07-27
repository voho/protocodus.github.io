/* The rider, as something to look at.

   This used to be one baked geometry — board, body, arms and head welded
   into a single buffer by `compose` — because the game rendered into a
   240-pixel framebuffer and a rider that small cannot show you an elbow. At
   that size a grab was a scaled torso and a crouch was a squashed body, and
   that was an honest trade. The framebuffer is gone: the run renders at the
   window's own resolution now, and there is exactly one rider on the
   mountain, so eleven draw calls for him cost nothing measurable. What the
   welded body cost was everything the sport actually looks like, so he is a
   rig now — a tree of Groups, one composed geometry per rigid segment, and
   the articulation living entirely in the transforms.

   One decision shapes the rest: **the feet are bolted to the board**. That
   is the whole difference between snowboarding and standing on a hill, and
   it means the legs have to be solved backwards. The board and its boots are
   the fixed thing; the hips are what moves; the knees are simply whatever
   angle joins the two. So nothing here animates a knee. The leg spring drops
   the hips, the ankles stay in the bindings, and two-bone IK works out the
   fold — which is why a landing visibly collapses him and a grab pulls his
   knees out sideways without a single frame of that being authored.

   The second decision is that **a pose is a point, not a set of angles**.
   Every arm pose in this file is expressed as a place the hand wants to be,
   and blending the riding pose into a grab is therefore a lerp between two
   points with the IK picking up the pieces. Blending quaternion poses pops
   the instant two of them disagree about which way the elbow goes; blending
   destinations cannot pop, and it also means the grab can be aimed at the
   board's edge and *arrive* there rather than nearly.

   Left and right are meaningless on a board, so nothing here is called left
   or right: a limb is `lead` if it is over the nose and `rear` if it is over
   the tail. He rides regular, which puts the chest towards +X, the toe edge
   at +X, the nose at -Z, and the head turned back over the leading shoulder
   to look down the fall line — which is where the mint visor points, and
   still the only way to read which way he is facing.

   The orientation of the whole thing is composed rather than eulered: the
   board is stood up on the surface normal first, then turned, then flipped,
   then rolled. In that order a flip is always about the board's own lateral
   axis and a carve always about its length, whatever the hill underneath is
   doing.

   Everything is smoothed with an exponential approach against dt. There is
   not one fixed per-frame lerp constant in the file, because a pose that
   settles in a different number of seconds on a 144 Hz screen than on a
   60 Hz one is a bug that only some people can see. */

import { compose } from './geom.js';
import { RIDER } from './config.js';
import { SNAP } from './shading.js';

/* The rider is the only saturated thing in the frame, and that is the job.

   He used to be ink and denim — a dark blue figure on a white mountain,
   which is a silhouette rather than a person, and at any distance he read as
   a smudge. Every photograph of this sport ever taken solves it the same
   way: the mountain is white and blue, and the one human being in it is
   wearing the loudest jacket money can buy. So he is orange, over a deep
   navy that keeps the legs reading against the snow, and the mint and yellow
   the rest of the site is built from stay exactly where they were — on the
   visor, the collar and the board — because they are what tie him to it. */
const INK = '#232830';
const SHELL = '#ff5a1f';    // the jacket, and the brightest thing on the hill
const SHELL_DARK = '#d8410f';
const MINT = '#00ffc3';
const YELLOW = '#ffc400';
const SKIN = '#c98f6a';
const DENIM = '#1f2a4d';

const RISE_TIME = RIDER.riseTime;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

/* --------------------------------------------------------------------------
   The skeleton, in metres, in board space: +X is the toe edge and the way the
   chest faces, -Z is the nose, y = 0 is the snow under the base.

   These are not free numbers. The boots put the ankles at a third of a metre
   off the snow before the legs even start, so a rider standing "tall" on a
   board still has fifty degrees of knee in him — which is why he reads as a
   snowboarder standing still rather than a man standing on a plank.
   -------------------------------------------------------------------------- */
const ANKLE_Y = 0.33;    // where the boot's cuff ends and the shin begins
const FOOT_Z = 0.245;    // the bindings, and therefore the feet, live here
const FOOT_X = 0.015;
const HIP_Y = 1.06;      // hips at rest, unloaded
const HIP_Z = 0.115;     // hip sockets, narrower than the stance — legs splay
const THIGH = 0.42;
const SHIN = 0.40;
const WAIST = 0.07;      // the torso pivots this far above the hip sockets
const SHOULDER_Y = 0.40;
const SHOULDER_Z = 0.20;
const NECK_Y = 0.44;
const UPPER = 0.29;
const FORE = 0.29;       // shoulder to hand centre is therefore 0.58

/* The leg spring is never at zero. Standing still on a slope it is already
   carrying a g, which is a third of a metre of squat, so `compression` is
   measured from here rather than from nought — read raw, HIP_Y would be the
   height of a rider who has just been dropped down a lift shaft, and he
   would spend the entire run in a crouch waiting for a load that had already
   arrived. */
const REST_SQUAT = RIDER.compressPerG * RIDER.gravity / 9.81;

/* The pose book. Amplitudes rather than animations: every one of these is a
   number some rider state is multiplied by. */
const POSE = {
  stance: 0.34,       // radians the chest is opened towards the nose
  look: 1.04,         // and how much further the head turns, to the fall line
  counter: 0.85,      // share of a carve's roll that comes back as waist twist
  spinTrail: 0.55,    // radians the shoulders trail a full-rate spin
  armTrail: 0.6,      // and radians the hands trail it, further still
  angulate: 0.3,      // how much more upright than the board the hips stay
  hipPerSquat: 1.15,  // metres of hip travel per metre of leg-spring travel
  hipPerStretch: 0.42,
  hipFold: 0.24,      // closest the hips are ever allowed to get to the boots
  hipShift: 0.11,     // and how far they move across the board into a carve
  // A board tuck is knees, not spine — so the hips drop further than they did
  // and the chest folds a lot less. The two together are the same silhouette
  // height and a completely different rider.
  tuckDrop: 0.24,
  fallDrop: 0.30,
  chatter: 0.007,     // metres of buzz through the legs at speed

  /* The grab, which is the one pose that has to hit a mark rather than look
     roughly right, and so is the one pose whose numbers were solved instead
     of chosen.

     The hand has 0.58 m of arm. The shoulder sits about a metre above the
     board's edge when he is riding, so no amount of arm gets there: the
     rider has to fold at the waist past ninety degrees *and* the board has
     to come up to meet him. That second half is not a cheat, it is what a
     grab is — the feet are strapped on, so pulling the knees up is pulling
     the board up, and the board is the thing that moves. Folded 100°, board
     up 0.32 and the hips parked 0.26 above the boots, the hand finishes
     0.55 m from the shoulder with three centimetres of arm to spare. */
  grabFold: 1.75,
  grabHip: 0.26,
  grabLift: 0.32,
  grabTweak: 0.15,    // and the toe edge rolls up towards the waiting hand
  grabPoint: [0.155, 0.09, -0.16],   // the toe edge, between the bindings
};

/* ==========================================================================
   Geometry — one composed buffer per rigid segment
   ========================================================================== */

/* Boots are part of the board, not part of the leg. They never move relative
   to the bindings, so welding them into the board's buffer is free, and it
   is also the truth: on a snowboard the foot is not a joint. */
const binding = (box, z, yaw) => [
  { geo: box, color: INK, pos: [0, 0.105, z], rot: [0, yaw, 0], scale: [0.30, 0.045, 0.22] },
  { geo: box, color: INK, pos: [0.01, 0.23, z], rot: [0, yaw, 0], scale: [0.28, 0.22, 0.18] },
  { geo: box, color: INK, pos: [-0.11, 0.30, z], rot: [0, yaw, 0], scale: [0.06, 0.22, 0.17] },
  { geo: box, color: YELLOW, pos: [0.02, 0.26, z], rot: [0, yaw, 0], scale: [0.30, 0.045, 0.19] },
  { geo: box, color: INK, pos: [0.10, 0.145, z], rot: [0, yaw, 0], scale: [0.14, 0.09, 0.17] },
];

function buildGeometries(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
  const ball = new THREE.SphereGeometry(0.5, 7, 5);

  // Longer than it is wide by four to one, nose and tail lifted: at any
  // resolution the rocker is most of what says "snowboard". The feet are
  // angled forward off the perpendicular, more at the front than the back,
  // because a duck-square stance is the one thing no snowboarder rides.
  const board = compose(THREE, [
    { geo: box, color: YELLOW, pos: [0, 0.06, 0], scale: [0.31, 0.045, 1.15] },
    // A broader, mint-capped nose and clipped dark tail make direction legible
    // through spray, at night, and in the middle of a spin.
    { geo: box, color: YELLOW, pos: [0, 0.10, -0.68], rot: [0.30, 0, 0], scale: [0.30, 0.045, 0.38] },
    { geo: box, color: YELLOW, pos: [0, 0.10, 0.67], rot: [-0.30, 0, 0], scale: [0.255, 0.045, 0.31] },
    { geo: box, color: MINT, pos: [0, 0.145, -0.79], rot: [0.30, 0, 0], scale: [0.225, 0.025, 0.16] },
    { geo: box, color: INK, pos: [0, 0.135, 0.78], rot: [-0.30, 0, 0], scale: [0.24, 0.026, 0.09] },
    // steel edges, which also stop the deck reading as a slab of butter
    { geo: box, color: INK, pos: [-0.152, 0.058, 0], scale: [0.016, 0.05, 1.12] },
    { geo: box, color: INK, pos: [0.152, 0.058, 0], scale: [0.016, 0.05, 1.12] },
    // and the stripe down the base, so a spin still reads from behind
    { geo: box, color: MINT, pos: [0, 0.032, 0], scale: [0.09, 0.04, 1.0] },
    ...binding(box, -FOOT_Z, 0.28),
    ...binding(box, FOOT_Z, 0.10),
  ]);

  // Wide across Z and shallow across X: the shoulder line runs nose to tail,
  // which is the single most snowboard-shaped thing about him
  const torso = compose(THREE, [
    { geo: box, color: DENIM, pos: [0, -0.045, 0], scale: [0.28, 0.17, 0.34] },
    { geo: box, color: SHELL, pos: [0, 0.20, 0], scale: [0.29, 0.42, 0.40] },
    { geo: box, color: MINT, pos: [0, 0.07, 0], scale: [0.30, 0.075, 0.41] },
    { geo: box, color: YELLOW, pos: [0.135, 0.22, 0], scale: [0.05, 0.30, 0.11] },
    { geo: box, color: SHELL_DARK, pos: [0, 0.39, 0], scale: [0.30, 0.13, 0.46] },
    { geo: ball, color: SHELL_DARK, pos: [0, 0.40, -SHOULDER_Z], scale: [0.17, 0.17, 0.17] },
    { geo: ball, color: SHELL_DARK, pos: [0, 0.40, SHOULDER_Z], scale: [0.17, 0.17, 0.17] },
  ]);

  // The visor is on the head's +X face and the head is turned to the fall
  // line, so the mint always points where he is looking
  const head = compose(THREE, [
    { geo: cyl, color: DENIM, pos: [0, 0.02, 0], scale: [0.12, 0.10, 0.12] },
    { geo: ball, color: SKIN, pos: [0, 0.13, 0], scale: [0.19, 0.21, 0.19] },
    { geo: ball, color: INK, pos: [0, 0.16, 0], scale: [0.225, 0.215, 0.225] },
    { geo: box, color: MINT, pos: [0.115, 0.13, 0], scale: [0.10, 0.085, 0.20] },
    { geo: box, color: INK, pos: [0.05, 0.02, 0], scale: [0.12, 0.07, 0.16] },
  ]);

  // Every limb segment hangs down its own -Y from its joint, which is the
  // only convention the IK needs to know about
  const upperArm = compose(THREE, [
    { geo: ball, color: SHELL_DARK, pos: [0, 0, 0], scale: [0.16, 0.16, 0.16] },
    { geo: cyl, color: SHELL, pos: [0, -0.15, 0], scale: [0.145, 0.30, 0.145] },
  ]);
  const foreArm = compose(THREE, [
    { geo: ball, color: SHELL, pos: [0, 0, 0], scale: [0.14, 0.14, 0.14] },
    { geo: cyl, color: SHELL, pos: [0, -0.13, 0], scale: [0.125, 0.27, 0.125] },
    { geo: box, color: YELLOW, pos: [0, -0.225, 0], scale: [0.14, 0.06, 0.14] },
    { geo: ball, color: SKIN, pos: [0, -FORE, 0], scale: [0.14, 0.13, 0.12] },
  ]);
  const thigh = compose(THREE, [
    { geo: ball, color: DENIM, pos: [0, 0, 0], scale: [0.23, 0.23, 0.23] },
    { geo: cyl, color: DENIM, pos: [0, -0.21, 0], scale: [0.25, 0.44, 0.25] },
  ]);
  const shin = compose(THREE, [
    { geo: ball, color: DENIM, pos: [0, 0, 0], scale: [0.21, 0.21, 0.21] },
    { geo: cyl, color: DENIM, pos: [0, -0.19, 0], scale: [0.21, 0.40, 0.21] },
    { geo: box, color: INK, pos: [0, -0.36, 0], scale: [0.20, 0.11, 0.20] },
  ]);

  box.dispose();
  cyl.dispose();
  ball.dispose();
  return { board, torso, head, upperArm, foreArm, thigh, shin };
}

/* ==========================================================================
   The rig
   ========================================================================== */

export function createRiderModel(THREE, shading) {
  const geo = buildGeometries(THREE);
  /* One material for the lot: the colours are already in the vertices, so
     eleven meshes are eleven draw calls and not one state change.

     It takes the same five bands of light as everything else — the rider has
     to be lit by the same sun as the hill or they are a sticker on it — but
     under a third of the vertex snap.

     That exemption is the one deliberate cheat in the whole look, and it is
     not a matter of taste. The snap is an amplitude in *pixels*, so it costs
     the same on a ridge four hundred metres away as on a body eight metres
     away and two hundred pixels tall; at full strength the arms visibly
     changed length, the board's edge stepped as it rolled, and the whole
     figure sheared a little differently every frame because each vertex
     crossed its own cell boundary at its own moment. At a third the
     displacement is under a pixel, which is enough to keep the rider inside
     the same discipline as the scenery and not enough to see them wobble. */
  const cloth = shading.apply(
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    { snap: SNAP.rider },
  );

  const root = new THREE.Group();
  const board = new THREE.Mesh(geo.board, cloth);
  root.add(board);

  const hips = new THREE.Group();
  hips.position.set(0, HIP_Y, 0);
  root.add(hips);

  /* Euler order matters exactly twice, and both times it is the difference
     between a pose and a mistake. The torso yaws open first and then folds
     about its *own* long axis, so a grab folds over the toe edge however far
     round the shoulders have already turned — 'YZX'. The head yaws to the
     fall line first and then pitches about its *own* axis, so looking down
     at a landing is a look down and not a head tilted onto its shoulder. */
  const torso = new THREE.Group();
  torso.position.set(0, WAIST, 0);
  torso.rotation.order = 'YZX';
  torso.add(new THREE.Mesh(geo.torso, cloth));
  hips.add(torso);

  const head = new THREE.Group();
  head.position.set(0, NECK_Y, 0);
  head.rotation.order = 'YXZ';
  head.add(new THREE.Mesh(geo.head, cloth));
  torso.add(head);

  const limb = (parent, y, z, upperGeo, foreGeo, upperLen) => {
    const upper = new THREE.Group();
    upper.position.set(0, y, z);
    upper.add(new THREE.Mesh(upperGeo, cloth));
    const fore = new THREE.Group();
    fore.position.set(0, -upperLen, 0);
    fore.add(new THREE.Mesh(foreGeo, cloth));
    upper.add(fore);
    parent.add(upper);
    return { upper, fore };
  };

  const armLead = limb(torso, SHOULDER_Y, -SHOULDER_Z, geo.upperArm, geo.foreArm, UPPER);
  const armRear = limb(torso, SHOULDER_Y, SHOULDER_Z, geo.upperArm, geo.foreArm, UPPER);
  const legLead = limb(hips, 0, -HIP_Z, geo.thigh, geo.shin, THIGH);
  const legRear = limb(hips, 0, HIP_Z, geo.thigh, geo.shin, THIGH);

  // --- shadow --------------------------------------------------------------
  // The blob every game of this vintage used, and still the cheapest way to
  // say exactly where in the air something is. It gets the rider's snap and
  // nothing else: no light to band because it is unlit, and no fog because a
  // shadow already inside the fog's near distance never sees any. Matching
  // the rider's snap rather than the ground's is what stops the blob sliding
  // out from under the board on a long traverse.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 14),
    shading.apply(new THREE.MeshBasicMaterial({
      color: 0x0d1c33, transparent: true, opacity: 0.34,
      depthWrite: false, fog: false,
    }), { snap: SNAP.rider, bands: 0, fog: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;

  /* ------------------------------------------------------------------------
     Two-bone IK.

     Solved in the socket's own space, where the shoulder or hip is the
     origin and every bone hangs down -Y. The elbow lands on the circle where
     the two bone spheres intersect; `pole` picks which point on that circle,
     which is the only artistic decision in the whole solver — knees forward
     and splayed along the board, elbows back and down.

     The reach is clamped rather than allowed to fail, so a target the arm
     cannot get to produces a straight arm pointing at it instead of a NaN.
     ------------------------------------------------------------------------ */
  const BONE = new THREE.Vector3(0, -1, 0);
  const _f = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const _e = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  function solve(joint, a, b, target, pole) {
    let d = target.length();
    if (d < 1e-4) {
      _f.set(0, -1, 0);
      d = 1e-4;
    } else {
      _f.copy(target).multiplyScalar(1 / d);
    }
    const reach = clamp(d, Math.abs(a - b) + 0.05, (a + b) * 0.999);

    // The bend plane: the pole, with anything along the target line removed.
    // Both fallbacks are perpendicular to the target by construction, which
    // matters for the one case that would otherwise hand `normalize` a zero
    // vector and put a NaN through every matrix downstream of the shoulder.
    _u.copy(pole).addScaledVector(_f, -pole.dot(_f));
    if (_u.lengthSq() < 1e-7) _u.set(-_f.y, _f.x, 0);
    if (_u.lengthSq() < 1e-7) _u.set(1, 0, 0);
    _u.normalize();

    const cos = clamp((a * a + reach * reach - b * b) / (2 * a * reach), -1, 1);
    _e.copy(_f).multiplyScalar(a * cos).addScaledVector(_u, a * Math.sqrt(1 - cos * cos));

    joint.upper.quaternion.setFromUnitVectors(BONE, _d.copy(_e).normalize());
    _d.copy(_f).multiplyScalar(reach).sub(_e).normalize()
      .applyQuaternion(_q.copy(joint.upper.quaternion).invert());
    joint.fore.quaternion.setFromUnitVectors(BONE, _d);
  }

  /* --- posing ------------------------------------------------------------- */

  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const qx = new THREE.Quaternion();
  const qz = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const AX = new THREE.Vector3(1, 0, 0);
  const AZ = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3();

  const hand = new THREE.Vector3();
  const other = new THREE.Vector3();
  const foot = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const poleRear = new THREE.Vector3();
  const mInv = new THREE.Matrix4();
  const last = new THREE.Vector3();

  // Everything the model remembers between frames. All of it is smoothed
  // against dt, none of it is read back by anyone else.
  const s = {
    clock: 0, down: 0, air: 0, grab: 0, tuck: 0, charge: 0,
    twist: 0, lean: 0, comp: 0, pop: 0, thump: 0, tumbleLag: 0, wash: 0,
  };
  let seen = false;

  function update(rider, dt) {
    // A frame that took a quarter of a second — a tab waking up — must not be
    // allowed to fling the pose about, and a rider who has just been reset
    // three hundred metres up the hill should arrive already posed rather
    // than easing across the mountain to get there.
    const step = clamp(dt, 0, 0.05);
    const snap = !seen || last.distanceToSquared(rider.pos) > 400;
    seen = true;
    last.copy(rider.pos);
    const sdt = snap ? 4 : step;
    s.clock += step;

    /* --- what the rider is doing, smoothed into pose signals ------------- */

    // How far down he is: all the way through the fall, then back up across
    // the recovery window. A step function here reads as a rider teleporting
    // upright the instant the timer runs out.
    const fallen = rider.state === 'fall' ? 1
      : rider.state === 'rise' ? clamp(rider.fallTimer / RISE_TIME, 0, 1)
        : 0;
    s.down = approach(s.down, fallen, 9, sdt);
    s.air = approach(s.air, rider.grounded ? 0 : 1, 13, sdt);
    s.grab = approach(s.grab, rider.grab, 14, sdt);
    s.tuck = approach(s.tuck, rider.tucking ? 1 : 0, 8, sdt);
    s.charge = approach(s.charge, rider.charging ? 0.35 + 0.65 * rider.charge : 0, 13, sdt);
    s.wash = approach(s.wash, clamp((rider.lateral || 0) / 6, -1, 1), 6, sdt);

    // The grab pose is gated on being airborne as well as on the grab, so
    // the board is back on the snow within a tenth of a second of touchdown
    // whatever the hands are still doing
    const grab = s.grab * s.air * (1 - s.down);

    /* The snap, and the thump.

       The leg spring's own velocity is the honest source for both, but this
       module is only promised the compression itself, so it is differenced
       here: the half of it that is extending is a pop, the half that is
       collapsing is an impact. Each decays on its own clock rather than
       being smoothed, because both are events and not states. */
    const rate = (rider.compression - s.comp) / Math.max(step, 1e-4);
    s.comp = rider.compression;
    s.pop = Math.max(s.pop * Math.exp(-7 * step), clamp(-rate * 0.10, 0, 1));
    s.thump = Math.max(s.thump * Math.exp(-5 * step), clamp(rate * 0.09, 0, 1));
    if (snap) {
      s.pop = 0;
      s.thump = 0;
      s.tumbleLag = rider.tumble;
    }

    /* Counter-rotation.

       The hips are bolted to the board by the bindings, so every degree of
       this happens at the waist. On the snow the shoulders lead the carve —
       they are what starts it, and the board follows them round. In the air
       they do the opposite and trail the spin, which is what makes a 540
       read as a body being wound rather than a model being rotated. */
    const carve = -rider.roll * (0.5 + 0.5 * rider.carveLoad) * POSE.counter;
    // …except while grabbing, when the whole body is locked around the board
    // and the shoulders stop arguing with it. That is also what buys the last
    // few centimetres of the reach below.
    const trail = -clamp(rider.spinVel / RIDER.spinRate, -1, 1)
      * POSE.spinTrail * (1 - grab * 0.65);
    const idle = 1 - Math.max(grab, s.down, s.tuck * 0.7);
    s.twist = approach(s.twist,
      POSE.stance + carve * (1 - s.air) + trail * s.air
      + Math.sin(s.clock * 0.53) * 0.06 * idle, 7, sdt);
    s.lean = approach(s.lean, rider.roll, 8, sdt);
    if (fallen <= 0) s.tumbleLag = rider.tumble;

    /* --- the whole rider, on the hill ------------------------------------ */

    // Stand him on the surface, then turn, flip and roll him in his own
    // frame. In the air the reference drifts back to true vertical.
    up.copy(rider.normal);
    if (!rider.grounded) up.lerp(UP, Math.min(1, rider.airTime * 2.5)).normalize();
    q.setFromUnitVectors(UP, up);
    qy.setFromAxisAngle(UP, rider.yaw);
    qx.setFromAxisAngle(AX, rider.flip + rider.tumble * s.down);
    qz.setFromAxisAngle(AZ, -rider.roll * (1 + 1.2 * s.down));
    q.multiply(qy).multiply(qx).multiply(qz);

    root.quaternion.copy(q);
    // The root is the board's contact patch and nothing else. It used to be
    // lifted by the leg extension, which meant that in the air — where the
    // extension is the height above the ground — a big drop floated the
    // rider metres above his own shadow. Now the board sits where the physics
    // says it does and the *hips* ride the spring, which is where the
    // suspension actually is.
    root.position.copy(rider.pos);

    /* --- board ------------------------------------------------------------ */

    // A grab pulls the board up to the hand, not the hand down to the board:
    // the feet are strapped on, so this is the only direction it can happen.
    const lift = POSE.grabLift * grab;
    const tweak = POSE.grabTweak * grab;
    const noseUp = s.pop * 0.12;
    board.position.y = lift;
    board.rotation.z = tweak;    // toe edge rolled up to meet the hand
    board.rotation.x = noseUp;   // and the nose lifts as he pops

    /* --- hips -------------------------------------------------------------- */

    // Weight across the board: into the turn, away from a wash, and never
    // quite still — the slow sway is the difference between a rider waiting
    // and a rider parked.
    hips.position.x = s.lean * POSE.hipShift - s.wash * 0.05
      + (Math.sin(s.clock * 0.9) + Math.sin(s.clock * 0.37 + 1.7)) * 0.014 * idle;
    // Fore and aft: forward over the nose in a tuck, back over the tail when
    // the edge is scrubbing
    hips.position.z = -s.tuck * 0.06 + Math.abs(s.wash) * 0.05
      + Math.sin(s.clock * 0.61 + 0.8) * 0.012 * idle;

    const load = rider.compression - REST_SQUAT;
    const squat = Math.max(0, load);
    const stretch = Math.max(0, -load);
    let hipY = HIP_Y - squat * POSE.hipPerSquat + stretch * POSE.hipPerStretch
      - s.tuck * POSE.tuckDrop - s.down * POSE.fallDrop;

    /* The grab is the one pose where the hips are placed rather than sprung.
       How far the hips sit above the board decides two things at once — how
       far the legs have folded, and whether the hand can reach the edge —
       and they pull in opposite directions: any higher and the arm comes up
       short, any lower and the knee bends further than a knee goes. There is
       about eight centimetres of window between those two failures and this
       sits in the middle of it, which is why it is a position and not an
       offset from wherever the spring happened to leave him. */
    hipY += (ANKLE_Y + lift + POSE.grabHip - hipY) * grab;

    /* He can fold a long way, but not through his own boots, and he can
       stand a long way up, but not out of his own bindings. Both ends are
       clamped, and the top one is worked out from the skeleton and the
       stance he is actually in rather than chosen: a chosen number stops
       being true the moment a bone length or a weight shift changes, and
       what it leaves behind is a shin hanging four centimetres above a boot,
       which is the one artefact a rig like this can never get away with. */
    const dx = hips.position.x - FOOT_X;
    const dz = FOOT_Z - HIP_Z + Math.abs(hips.position.z);
    const span = (THIGH + SHIN) * 0.985;
    const reach = Math.sqrt(Math.max(0.04, span * span - dx * dx - dz * dz));
    hipY = clamp(hipY, ANKLE_Y + lift + POSE.hipFold, ANKLE_Y + lift + reach);

    // Buzz at speed: the board is chattering, and it arrives through the legs
    hipY += Math.sin(s.clock * 47) * POSE.chatter
      * Math.min(1, rider.speed / 40) * (1 - s.air) * (1 - s.down);
    hips.position.y = hipY;
    // Angulation: the board goes on edge further than the body does, which is
    // the posture that makes a carve look like a carve and not like a bus
    hips.rotation.z = s.lean * POSE.angulate;
    hips.rotation.y = -s.twist * 0.12;
    hips.updateMatrix();

    /* --- torso ------------------------------------------------------------- */

    const lag = clamp(rider.tumble - s.tumbleLag, -1.4, 1.4);
    // Chest towards the nose in a tuck; curled over the coiled legs on a
    // charge; thrown open by the pop; folded over the toe edge in a grab
    /* The tuck does not bend him forward at all. It is entirely legs.

       It started at forty-nine degrees over the nose, which is a downhill
       skier's egg — the wrong sport — and even a third of that still read as
       the rider pitching over the board every time the key went down. A
       board tuck is a rider who sinks, keeps his chest up and puts his arms
       out; the speed comes from the legs folding and the frontal area going
       with them. So the chest angle is now flat, `POSE.tuckDrop` does the
       whole of the work, and the arms go wide. */
    const pitch = -s.charge * 0.35 + s.pop * 0.20
      - s.thump * 0.18 - grab * 0.25;
    const fold = -POSE.grabFold * grab - s.down * 0.5 * (1 - grab);
    // Going over, he curls up and the chest trails the tumble by however far
    // the roll has outrun the smoothed copy of it
    torso.rotation.set(pitch - s.down * (0.55 + lag * 0.4), s.twist, fold);

    /* Breathing.

       A centimetre and a half of chest, on a sine, and it is the difference
       between a rider and a model of a rider. Nothing else in this file runs
       when the physics is quiet — every other motion here is driven by
       something the mountain is doing — so a rider holding a straight line
       down an easy pitch was perfectly, unnaturally still. The eye does not
       consciously see this; it notices its absence.

       The rate is effort, not time: it climbs with speed and with whatever
       the legs are carrying, so he is breathing harder at the bottom of a
       fast pitch than at the top. The depth goes the other way, because
       someone working hard breathes quickly and shallowly. And it fades out
       under a grab or a tuck, where the chest is doing something else and a
       breath on top of it reads as a wobble. */
    const effort = clamp(rider.speed / 30 + (rider.gLoad - 1) * 0.5, 0, 1.6);
    const breath = Math.sin(s.clock * (1.05 + effort * 1.5)) * 0.5 + 0.5;
    const depth = (0.016 - effort * 0.005) * idle;
    torso.scale.set(1 + breath * depth * 0.8, 1 + breath * depth * 0.5, 1 + breath * depth);
    torso.updateMatrix();

    /* --- head -------------------------------------------------------------- */

    // He looks down the fall line, so the yaw the shoulders have taken is
    // subtracted back out of the neck; in the air he looks at the landing,
    // and in a fall the neck goes as loose as the rest of him.
    head.rotation.set(
      // no tuck term: the chest no longer folds, so there is nothing for the
      // neck to compensate for and lifting it just made him stargaze
      -0.05 + s.air * 0.22 + s.thump * 0.25 - lag * 0.5 * s.down,
      POSE.look - s.twist * 0.5 + Math.sin(s.clock * 0.41) * 0.05 * idle,
      -s.lean * 0.18 + s.down * 0.4,
    );

    /* --- legs -------------------------------------------------------------- */

    // The ankles are wherever the bindings are, in root space, and the hips
    // are wherever the spring left them. Everything between is arithmetic:
    // the board's own tilt is applied to the boot first, then the point is
    // carried back into the hips' frame, and the knee is whatever is left.
    //
    // The pole leans further along the board the deeper the fold gets, which
    // is both what a tucked grab looks like from the side and the only thing
    // keeping a full crouch's knees out of the rider's own chest.
    mInv.copy(hips.matrix).invert();

    foot.set(FOOT_X, ANKLE_Y, -FOOT_Z).applyAxisAngle(AZ, tweak).applyAxisAngle(AX, noseUp);
    foot.y += lift;
    foot.applyMatrix4(mInv);
    foot.z += HIP_Z;
    let deep = 1 - clamp(foot.length() / (THIGH + SHIN), 0, 1);
    pole.set(1 - deep * 0.55, 0.1, -(0.3 + deep * 1.1));
    solve(legLead, THIGH, SHIN, foot, pole);

    foot.set(FOOT_X, ANKLE_Y, FOOT_Z).applyAxisAngle(AZ, tweak).applyAxisAngle(AX, noseUp);
    foot.y += lift;
    foot.applyMatrix4(mInv);
    foot.z -= HIP_Z;
    deep = 1 - clamp(foot.length() / (THIGH + SHIN), 0, 1);
    poleRear.set(1 - deep * 0.55, 0.1, 0.3 + deep * 1.1);
    solve(legRear, THIGH, SHIN, foot, poleRear);

    /* --- arms -------------------------------------------------------------- */

    /* Riding: out and low, lead hand over the nose, rear hand over the tail.
       This is the pose that was wrong before — arms held out sideways from a
       torso facing down the hill, which is a T-pose with the corners knocked
       off and reads as a mannequin bolted to a plank however good the rest of
       it is. */
    hand.set(0.13, -0.38, -0.35);
    other.set(0.10, -0.44, 0.26);

    /* And they never hold quite still.

       A centimetre of drift on each hand, from four sines whose periods share
       no common multiple — so the pattern does not repeat inside any run
       anybody will ever ride, and it never has the tell of a loop. Arms are
       the heaviest thing hanging off a body that is being shaken by a
       mountain; they are the last part of a rider that would ever be
       motionless, and holding them rigid is what makes a good rig read as a
       puppet at rest.

       It goes on before every other pose blends over it, so a grab still
       arrives exactly on the board's edge and a tuck still puts the hands
       exactly where a tuck puts them. `idle` takes it away whenever the arms
       have somewhere specific to be. */
    const sway = 0.011 * idle;
    hand.x += Math.sin(s.clock * 0.83) * sway;
    hand.y += Math.sin(s.clock * 1.27 + 1.1) * sway * 0.8;
    hand.z += Math.sin(s.clock * 0.61 + 2.4) * sway;
    other.x += Math.sin(s.clock * 0.71 + 2.2) * sway;
    other.y += Math.sin(s.clock * 1.09 + 0.4) * sway * 0.8;
    other.z += Math.sin(s.clock * 0.53 + 4.1) * sway;

    // Tucked: arms spread wide and low across the board, which is how a
    // snowboarder actually holds a tuck — the hands go out for the balance
    // the narrowed stance has just given up, not in against the chest the
    // way a skier's do. Pulling them in was most of why the pose read wrong.
    hand.lerp(_f.set(0.40, -0.34, -0.40), s.tuck);
    other.lerp(_f.set(0.38, -0.38, 0.32), s.tuck);
    // Coiling an ollie drags them back and down; the pop throws them up and
    // forward, which is where the height comes from on a real one
    hand.lerp(_f.set(-0.14, -0.44, -0.24), s.charge);
    other.lerp(_f.set(-0.16, -0.44, 0.22), s.charge);
    hand.y += (s.pop * 0.34 + s.thump * 0.26);
    other.y += (s.pop * 0.30 + s.thump * 0.30);
    hand.x += s.pop * 0.12;

    // In the air the hands trail the spin, further round than the shoulders
    // do, and pull in as the rotation winds up
    if (s.air > 0.002) {
      const wind = -clamp(rider.spinVel / RIDER.spinRate, -1, 1) * POSE.armTrail * s.air;
      const tight = 1 - Math.abs(wind) * 0.22;
      hand.applyAxisAngle(UP, wind).multiplyScalar(tight);
      other.applyAxisAngle(UP, wind).multiplyScalar(tight);
    }

    // Elbows back and down while riding; up and back in a grab, so the arm
    // hangs off the shoulder rather than hinging through the ribs
    pole.set(-0.75, -0.55, -0.15);
    poleRear.set(-0.75, -0.55, 0.15);

    /* The grab. The one pose expressed somewhere other than the shoulder:
       the target is a fixed point on the board's toe edge, and the board is
       three transforms away, so it is carried back through the hips and the
       torso into the lead shoulder's own space — and only when there is a
       grab to pay for it. */
    if (grab > 0.002) {
      mInv.copy(hips.matrix).multiply(torso.matrix).invert();
      _f.set(POSE.grabPoint[0], POSE.grabPoint[1], POSE.grabPoint[2])
        .applyAxisAngle(AZ, tweak).applyAxisAngle(AX, noseUp);
      _f.y += lift;
      _f.applyMatrix4(mInv);
      _f.y -= SHOULDER_Y;
      _f.z += SHOULDER_Z;
      hand.lerp(_f, grab);
      pole.lerp(_u.set(-0.45, 0.75, -0.2), grab);
      // the trailing hand goes up and out for balance, which is what makes a
      // grab read as a rider tweaking rather than a rider bending over
      other.lerp(_u.set(0.10, 0.10, 0.46), grab);
      poleRear.lerp(_u.set(-0.5, -0.2, 0.3), grab);
    }

    /* Falling: the arms stop being posed at all. They chase a point that is
       swung round by however far the body's rotation has outrun the smoothed
       copy of it — so they genuinely trail the tumble, at an angle that grows
       with how fast he is going over, and flail on top of that. */
    if (s.down > 0.002) {
      _f.set(0.05, -0.26, -0.44)
        .applyAxisAngle(AX, -lag * 0.9 + Math.sin(s.clock * 7.1) * 0.22);
      hand.lerp(_f, s.down);
      _f.set(0.05, -0.24, 0.42)
        .applyAxisAngle(AX, -lag * 1.1 + Math.sin(s.clock * 6.3 + 2.1) * 0.22);
      other.lerp(_f, s.down);
      pole.lerp(_u.set(-0.4, 0.2, -0.5), s.down);
      poleRear.lerp(_u.set(-0.4, 0.2, 0.5), s.down);
    }
    s.tumbleLag = approach(s.tumbleLag, rider.tumble, 7, sdt);

    solve(armLead, UPPER, FORE, hand, pole);
    solve(armRear, UPPER, FORE, other, poleRear);

    /* --- shadow ------------------------------------------------------------ */

    // Pinned to the ground under the rider, fading and shrinking as the gap
    // opens, which is what makes a jump's height readable
    const gy = rider.world.height(rider.pos.x, rider.pos.z);
    const gap = Math.max(0, rider.pos.y - gy);
    shadow.position.set(rider.pos.x, gy + 0.05, rider.pos.z);
    const k = Math.max(0, 1 - gap / 14);
    shadow.scale.setScalar(0.55 + 0.45 * k);
    shadow.material.opacity = 0.34 * k * k;
    shadow.visible = k > 0.02;
  }

  return { root, shadow, update };
}
