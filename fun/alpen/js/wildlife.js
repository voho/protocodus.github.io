/* Rabbits, bears, deer and wolves.

   FOUR ANIMALS AND THREE JOBS, and the third one is the newest and the least
   obvious. The first two are about the rider. The last two are not about the
   rider at all, and that is the entire point of them — see the long note in
   `config.js` under `deer`. A herd out past the treeline that never collides,
   never scores and cannot be reached is doing the one thing nothing else on
   this hill does, which is being somewhere else.

   The rabbits exist to react: they sit in
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
const lerp = (a, b, t) => a + (b - a) * t;
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

/* A red deer, facing -Z, feet at y = 0 — and only from the withers down.

   The head is a separate mesh and that is the whole reason the deer are worth
   having. A deer does one readable thing: it has its nose in the snow, and
   then it does not. Baking the neck into the body would have left a herd of
   identical alert statues, and the alternative — pitching the whole animal
   nose-down about its front feet — swings the hindquarters half a metre into
   the air, which is a deer being lifted by its collar. Two instanced meshes
   and one pivot at the base of the neck costs one draw call and buys the
   only behaviour the animal has.

   The body itself is a deer rather than a small horse because of the taper:
   the chest is deep and narrow, the loin behind it is shallower, and the rump
   comes back up. Legs are two segments with a joint that bends the right way
   for each pair — a deer's hock points backwards and its knee forwards, and
   getting that wrong is what makes a quadruped read as furniture. */
const DEER_COAT = '#6f6357';    // a winter coat: grey-brown, not the bear's warm one
const DEER_LIGHT = '#867868';
const DEER_DARK = '#4a423a';
const DEER_RUMP = '#bfb6a4';    // the pale patch, which is most of the silhouette at range
const DEER_HOOF = '#221c17';

function deerBodyGeometry(THREE) {
  const ball = new THREE.SphereGeometry(0.5, 20, 14);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const limb = new THREE.CylinderGeometry(0.5, 0.36, 1, 10, 1);

  /* A leg, hung from the shoulder or the haunch. `bend` is the sign of the
     joint: the front pair fold forwards and the rear pair backwards, which is
     the difference between a deer and a trestle.

     The proportion is the thing to get right and the first attempt did not.
     A deer is leggy, so the temptation is to make the legs long — but what
     actually makes an animal read as leggy is a DEEP BODY sitting high, and
     lengthening the legs against a shallow barrel just produces a small
     animal on stilts. The barrel below is half again as deep as it was and
     the legs are shorter, and the silhouette got taller. */
  const leg = (s, z, bend) => ([
    { geo: limb, color: DEER_COAT, pos: [s * 0.20, 0.59, z], rot: [bend * 0.09, 0, 0], scale: [0.100, 0.46, 0.100] },
    { geo: limb, color: DEER_DARK, pos: [s * 0.20, 0.21, z + bend * 0.05], rot: [-bend * 0.15, 0, 0], scale: [0.072, 0.42, 0.072] },
    { geo: box, color: DEER_HOOF, pos: [s * 0.20, 0.035, z + bend * 0.08], scale: [0.085, 0.07, 0.115] },
  ]);

  return compose(THREE, [
    // chest deepest, barrel behind it, rump back up again
    { geo: ball, color: DEER_COAT, pos: [0, 0.96, -0.30], scale: [0.36, 0.50, 0.50] },
    { geo: ball, color: DEER_COAT, pos: [0, 0.95, 0.06], scale: [0.33, 0.44, 0.46] },
    { geo: ball, color: DEER_COAT, pos: [0, 0.99, 0.40], scale: [0.35, 0.46, 0.44] },
    // the withers, which is the highest point on a standing deer
    { geo: ball, color: DEER_LIGHT, pos: [0, 1.15, -0.34], scale: [0.27, 0.22, 0.38] },
    // and the underline, which is what fills the gap the legs used to hang in
    { geo: ball, color: DEER_DARK, pos: [0, 0.78, 0.02], scale: [0.30, 0.22, 0.74] },
    // rump patch and the short tail sitting on it
    { geo: ball, color: DEER_RUMP, pos: [0, 1.02, 0.58], scale: [0.24, 0.28, 0.16] },
    { geo: box, color: DEER_LIGHT, pos: [0, 0.96, 0.62], rot: [0.6, 0, 0], scale: [0.06, 0.22, 0.055] },
    ...leg(-1, -0.34, 1), ...leg(1, -0.34, 1),
    ...leg(-1, 0.40, -1), ...leg(1, 0.40, -1),
  ]);
}

/* The head, built from the base of the neck so a rotation about its own X is
   a deer raising or lowering it. At rest the neck stands up and forward, which
   is the alert pose; the graze is the same mesh rolled forward until the
   muzzle is in the snow. `antlers` is the only difference between the two
   variants, so the stag is the same call with one flag. */
function deerHeadGeometry(THREE, antlers) {
  const ball = new THREE.SphereGeometry(0.5, 16, 12);
  const bead = new THREE.SphereGeometry(0.5, 10, 8);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const taper = new THREE.CylinderGeometry(0.34, 0.5, 1, 12, 1);

  const parts = [
    // the neck: up and forward out of the withers, and thick — a stag's neck
    // is the width of its skull twice over and a thin one reads as a llama
    { geo: taper, color: DEER_COAT, pos: [0, 0.24, -0.15], rot: [-0.56, 0, 0], scale: [0.22, 0.62, 0.24] },
    { geo: ball, color: DEER_LIGHT, pos: [0, 0.52, -0.31], scale: [0.17, 0.19, 0.18] },
    // skull, then the muzzle carried on from it
    { geo: ball, color: DEER_COAT, pos: [0, 0.60, -0.41], scale: [0.16, 0.17, 0.22] },
    { geo: taper, color: DEER_LIGHT, pos: [0, 0.555, -0.585], rot: [-1.28, 0, 0], scale: [0.115, 0.28, 0.125] },
    { geo: bead, color: DEER_HOOF, pos: [0, 0.535, -0.715], scale: [0.085, 0.07, 0.065] },
    { geo: bead, color: DEER_HOOF, pos: [-0.095, 0.645, -0.44], scale: [0.05, 0.05, 0.045] },
    { geo: bead, color: DEER_HOOF, pos: [0.095, 0.645, -0.44], scale: [0.05, 0.05, 0.045] },
    // ears, set wide and swept back, which is what says deer at any distance
    { geo: box, color: DEER_LIGHT, pos: [-0.15, 0.695, -0.31], rot: [0.34, -0.50, -0.34], scale: [0.045, 0.16, 0.095] },
    { geo: box, color: DEER_LIGHT, pos: [0.15, 0.695, -0.31], rot: [0.34, 0.50, 0.34], scale: [0.045, 0.16, 0.095] },
  ];

  if (antlers) {
    /* Four thin members a side and no attempt at a real beam-and-tine
       structure: at the range these are seen from, an antler is a fan of
       lines above the skull and anything more is triangles nobody resolves.
       They are pale because a dark antler against dark trees disappears, and
       the whole point of a stag is that you can tell it is one. */
    const beam = (s) => ([
      { geo: box, color: DEER_RUMP, pos: [s * 0.10, 0.82, -0.37], rot: [-0.20, 0, -s * 0.42], scale: [0.030, 0.28, 0.030] },
      { geo: box, color: DEER_RUMP, pos: [s * 0.21, 0.99, -0.42], rot: [-0.42, 0, -s * 0.70], scale: [0.026, 0.24, 0.026] },
      { geo: box, color: DEER_RUMP, pos: [s * 0.18, 0.98, -0.53], rot: [-0.95, 0, -s * 0.30], scale: [0.021, 0.19, 0.021] },
      { geo: box, color: DEER_RUMP, pos: [s * 0.28, 1.10, -0.34], rot: [0.25, 0, -s * 0.95], scale: [0.021, 0.17, 0.021] },
    ]);
    parts.push(...beam(-1), ...beam(1));
  }
  return compose(THREE, parts);
}

/* Where the neck joins the body, in the body's own space. Everything about
   the head instance is this offset turned by the animal's yaw. */
const DEER_WITHERS = [0, 1.10, -0.40];
/* And how far forward the neck swings to put the muzzle in the snow. A deer
   in winter is browsing rather than grazing — it is reaching for what is
   sticking out of the drift, not cropping a lawn — so the nose comes down to
   about knee height and not to the ground. */
const DEER_BROWSE = -2.05;

/* A wolf, facing -Z, feet at y = 0.

   One mesh, because a wolf has nothing to do with its head that reads at two
   hundred metres. What does read is the outline, and a wolf's outline is a
   specific set of proportions that separate it from a large dog: the chest is
   deep and drops below the elbow, the loin is tucked, the legs are long
   enough that it stands tall for its length, and the tail is a straight brush
   carried low rather than curled over the back. The saddle is darker than the
   flanks and the throat and legs are paler, which is the marking that makes
   the shape legible against snow. */
const WOLF_COAT = '#7c808a';
const WOLF_SADDLE = '#4e525c';
const WOLF_PALE = '#b9c0cc';
const WOLF_DARK = '#23262c';

function wolfGeometry(THREE) {
  const ball = new THREE.SphereGeometry(0.5, 18, 12);
  const bead = new THREE.SphereGeometry(0.5, 10, 8);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const limb = new THREE.CylinderGeometry(0.44, 0.34, 1, 10, 1);
  const taper = new THREE.CylinderGeometry(0.30, 0.5, 1, 12, 1);

  const leg = (s, z, bend) => ([
    { geo: limb, color: WOLF_COAT, pos: [s * 0.17, 0.36, z], rot: [bend * 0.11, 0, 0], scale: [0.095, 0.30, 0.095] },
    { geo: limb, color: WOLF_PALE, pos: [s * 0.17, 0.14, z + bend * 0.04], rot: [-bend * 0.13, 0, 0], scale: [0.068, 0.26, 0.068] },
    { geo: box, color: WOLF_DARK, pos: [s * 0.17, 0.030, z + bend * 0.06], scale: [0.090, 0.060, 0.120] },
  ]);

  return compose(THREE, [
    // deep chest forward — it drops below the elbow, which is the one
    // proportion that separates a wolf from a large dog — then a tucked loin
    { geo: ball, color: WOLF_COAT, pos: [0, 0.60, -0.24], scale: [0.30, 0.40, 0.44] },
    { geo: ball, color: WOLF_COAT, pos: [0, 0.62, 0.08], scale: [0.25, 0.32, 0.40] },
    { geo: ball, color: WOLF_COAT, pos: [0, 0.64, 0.36], scale: [0.29, 0.35, 0.36] },
    { geo: ball, color: WOLF_PALE, pos: [0, 0.44, -0.16], scale: [0.24, 0.22, 0.44] },
    // the saddle, which is the marking that gives the back line an edge
    { geo: ball, color: WOLF_SADDLE, pos: [0, 0.78, -0.02], scale: [0.25, 0.16, 0.66] },
    // a straight brush carried low and back, not out — the horizontal tail
    // that came out of the first attempt reads as a weathervane
    { geo: taper, color: WOLF_SADDLE, pos: [0, 0.47, 0.66], rot: [2.05, 0, 0], scale: [0.105, 0.50, 0.105] },
    { geo: bead, color: WOLF_DARK, pos: [0, 0.26, 0.85], scale: [0.085, 0.085, 0.095] },
    // neck low and level — a wolf carries its head at the height of its back
    { geo: ball, color: WOLF_COAT, pos: [0, 0.68, -0.48], scale: [0.21, 0.23, 0.26] },
    { geo: ball, color: WOLF_COAT, pos: [0, 0.70, -0.68], scale: [0.16, 0.16, 0.18] },
    { geo: taper, color: WOLF_PALE, pos: [0, 0.665, -0.85], rot: [-1.44, 0, 0], scale: [0.100, 0.24, 0.105] },
    { geo: bead, color: WOLF_DARK, pos: [0, 0.655, -0.965], scale: [0.070, 0.058, 0.052] },
    { geo: bead, color: WOLF_DARK, pos: [-0.078, 0.755, -0.76], scale: [0.040, 0.040, 0.034] },
    { geo: bead, color: WOLF_DARK, pos: [0.078, 0.755, -0.76], scale: [0.040, 0.040, 0.034] },
    // upright ears, kept small — a wolf's are short and round-tipped, and the
    // tall pointed pair the first attempt had belong on a shepherd dog
    { geo: box, color: WOLF_SADDLE, pos: [-0.082, 0.815, -0.63], rot: [-0.10, -0.25, -0.16], scale: [0.048, 0.105, 0.042] },
    { geo: box, color: WOLF_SADDLE, pos: [0.082, 0.815, -0.63], rot: [-0.10, 0.25, 0.16], scale: [0.048, 0.105, 0.042] },
    ...leg(-1, -0.30, 1), ...leg(1, -0.30, 1),
    ...leg(-1, 0.34, -1), ...leg(1, 0.34, -1),
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

  /* The far animals. Three pools for the deer rather than one, because the
     head is a separate instance and the stag's is a different mesh — and the
     body pool is shared between the two, which is why a stag costs one extra
     draw call for the whole herd rather than a duplicate of everything. */
  const deerBodies = new THREE.InstancedMesh(
    deerBodyGeometry(THREE), animalMaterial(), WILDLIFE.deer,
  );
  const deerHeads = new THREE.InstancedMesh(
    deerHeadGeometry(THREE, false), animalMaterial(), WILDLIFE.deer,
  );
  const stagHeads = new THREE.InstancedMesh(
    deerHeadGeometry(THREE, true), animalMaterial(), WILDLIFE.deer,
  );
  const wolves = new THREE.InstancedMesh(
    wolfGeometry(THREE), animalMaterial(), WILDLIFE.wolves,
  );
  for (const mesh of [deerBodies, deerHeads, stagHeads, wolves]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }

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

  /* --- the far animals ---------------------------------------------------

     A herd and a pack are each ONE object with members hanging off it, and
     that is the whole difference between these and everything above. A
     rabbit is placed on its own and a bear is placed on its own, so the
     mountain gets a scatter. A scatter is right for those two and wrong for
     these: deer stand together and wolves travel in line, and six animals
     placed independently at the same offsets read as six animals that happen
     to be near each other, which is not the same picture at all.

     So the group owns the position and the members own an offset from it.
     One noticed rider turns the whole herd at once, which is the thing a
     herd does that a collection of deer does not. */
  const herd = { alive: false, x: 0, z: 0, dir: 1, alert: 0, run: 0, members: [] };
  const pack = { alive: false, x: 0, z: 0, dir: 1, yaw: 0, members: [] };
  let deerClock = range(WILDLIFE.deerRespawn);
  let wolfClock = range(WILDLIFE.wolfRespawn);

  /* Which side of the run, and how far past its edge. Beyond the corridor on
     purpose — see the note in config — and measured from the branch centre
     the group is actually nearest so a fork does not put a herd in the middle
     of the other line. */
  function farSpot(z, range_) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = corridorHalfAt(z) + range_[0] + Math.random() * (range_[1] - range_[0]);
    return { x: nearestCenter(0, z) + side * off, side };
  }

  function placeHerd(rider) {
    const z = rider.pos.z - range(WILDLIFE.deerSpawnRange);
    const spot = farSpot(z, WILDLIFE.deerOffset);
    herd.z = z;
    herd.x = spot.x;
    // Away from the run when they go, never across it
    herd.dir = spot.side;
    herd.alert = 0;
    herd.run = 0;
    herd.alive = true;
    const n = 2 + Math.floor(Math.random()
      * (WILDLIFE.deerHerd[1] - WILDLIFE.deerHerd[0] + 1));
    herd.members.length = 0;
    for (let i = 0; i < Math.min(n, WILDLIFE.deer); i++) {
      herd.members.push({
        ox: spread() * WILDLIFE.deerSpread,
        oz: spread() * WILDLIFE.deerSpread,
        // A herd is one stag at most, and only sometimes. Two stags standing
        // together is the one arrangement red deer never make.
        stag: i === 0 && Math.random() < 0.45,
        // Every deer keeps its own grazing clock, because a herd that lifts
        // its heads in unison is a herd that has noticed something — and
        // nothing has happened yet.
        clock: Math.random() * 9,
        yaw: Math.random() * Math.PI * 2,
        scale: 0.88 + Math.random() * 0.26,
      });
    }
  }

  function placePack(rider) {
    const z = rider.pos.z - range(WILDLIFE.wolfSpawnRange);
    const spot = farSpot(z, WILDLIFE.wolfOffset);
    pack.z = z;
    pack.x = spot.x;
    pack.dir = spot.side;
    // Wolves cross the hill rather than descend it, at a slight angle so the
    // line is never exactly the horizon
    pack.yaw = spot.side * (Math.PI / 2) + (Math.random() - 0.5) * 0.5;
    pack.alive = true;
    const n = WILDLIFE.wolfPack[0] + Math.floor(Math.random()
      * (WILDLIFE.wolfPack[1] - WILDLIFE.wolfPack[0] + 1));
    pack.members.length = 0;
    for (let i = 0; i < Math.min(n, WILDLIFE.wolves); i++) {
      pack.members.push({
        // Position in the file, with the gaps uneven — a wolf pack in snow
        // walks in one another's tracks but not to a ruler
        file: i * WILDLIFE.wolfFile * (0.82 + Math.random() * 0.36),
        drift: spread() * 0.8,
        gait: Math.random() * 6,
        scale: i === 0 ? 1.06 : 0.88 + Math.random() * 0.18,
      });
    }
  }

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

    // --- deer --------------------------------------------------------------
    /* The herd's own clock, run exactly like the bear's: it only ticks while
       the hill is empty of deer, and reaching zero offers a herd rather than
       placing one. Deer are far commoner than bears, so the odds are the
       other way round — but the mechanism is the same one and it is the
       reason a run has quiet stretches instead of a conveyor. */
    if (rider.distance > WILDLIFE.deerFrom && !herd.alive) {
      deerClock -= dt;
      if (deerClock <= 0) {
        deerClock = range(WILDLIFE.deerRespawn);
        if (Math.random() < WILDLIFE.deerChance) placeHerd(rider);
      }
    }
    if (herd.alive && herd.z > rz + 40) herd.alive = false;

    let dn = 0;
    let sn = 0;
    if (herd.alive) {
      const dist = Math.hypot(herd.x - rx, herd.z - rz);
      /* Noticing, which is the only thing the rider can cause out here and is
         deliberately not a collision, a score or a sound. The herd sees a
         rider well before the rider is anywhere near it — that is what a prey
         animal is for — and once it has, it goes. `run` latches, so a herd
         that has bolted does not settle back down the moment the rider's
         distance ticks past the threshold again. */
      const notice = clamp(1 - (dist - WILDLIFE.deerNotice) / 26, 0, 1);
      if (notice > 0.5) herd.run = 1;
      herd.alert += (Math.max(notice, herd.run) - herd.alert)
        * (1 - Math.exp(-2.6 * dt));
      if (herd.run > 0) {
        const sp = WILDLIFE.deerSpeed * herd.alert;
        herd.x += herd.dir * sp * dt;
        herd.z -= sp * 0.45 * dt;
      }

      for (const d of herd.members) {
        d.clock += dt;
        const x = herd.x + d.ox;
        const z = herd.z + d.oz;
        const y = heightAt(x, z);
        /* Head down or head up. A grazing deer lifts its head every few
           seconds to look around and puts it back — the slow square wave is
           that, and `alert` overrides all of it towards up. The trot's own
           bob rides on top so a running deer is not a sliding statue. */
        const feeding = clamp((Math.sin(d.clock * 0.62 + d.ox) - 0.15) * 3, 0, 1)
          * (1 - herd.alert);
        const gait = d.clock * 9;
        const bob = Math.sin(gait) * 0.055 * herd.alert;
        // A running herd all faces the way it is going; a grazing one does not
        const yaw = lerp(d.yaw, Math.atan2(herd.dir, -0.45), herd.alert);
        v.set(x, y + Math.abs(bob), z);
        e.set(Math.sin(gait * 2) * 0.05 * herd.alert, yaw + Math.PI, 0, 'YXZ');
        q.setFromEuler(e);
        s.set(d.scale, d.scale, d.scale);
        m.compose(v, q, s);
        deerBodies.setMatrixAt(dn++, m);

        /* The head, hung off the same transform. `m` is still the body's, so
           the withers offset only has to be pushed through it — which keeps
           the neck attached whatever the body's yaw, scale and gait pitch are
           doing, and costs one matrix apply instead of a second compose. */
        ev.set(DEER_WITHERS[0], DEER_WITHERS[1], DEER_WITHERS[2]).applyMatrix4(m);
        e.set(DEER_BROWSE * feeding, yaw + Math.PI, 0, 'YXZ');
        q.setFromEuler(e);
        m.compose(ev, q, s);
        if (d.stag) stagHeads.setMatrixAt(sn++, m);
        else deerHeads.setMatrixAt(dn - 1 - sn, m);
      }
    }
    deerBodies.count = dn;
    deerHeads.count = dn - sn;
    stagHeads.count = sn;
    if (dn > 0) {
      deerBodies.instanceMatrix.needsUpdate = true;
      if (dn - sn > 0) deerHeads.instanceMatrix.needsUpdate = true;
      if (sn > 0) stagHeads.instanceMatrix.needsUpdate = true;
    }

    // --- wolves ------------------------------------------------------------
    if (rider.distance > WILDLIFE.wolfFrom && !pack.alive) {
      wolfClock -= dt;
      if (wolfClock <= 0) {
        wolfClock = range(WILDLIFE.wolfRespawn);
        if (Math.random() < WILDLIFE.wolfChance) placePack(rider);
      }
    }
    if (pack.alive && pack.z > rz + 40) pack.alive = false;

    let wn = 0;
    if (pack.alive) {
      // The pack never reacts to anything. It is crossing the mountain and
      // the rider is not part of that, which is most of why it is worth
      // watching: everything else on this hill is about the player.
      // Same yaw convention as the hares: sin/cos, and the mesh faces -Z so
      // the render adds the half turn.
      const hx = Math.sin(pack.yaw);
      const hz = Math.cos(pack.yaw);
      pack.x += hx * WILDLIFE.wolfSpeed * dt;
      pack.z += hz * WILDLIFE.wolfSpeed * dt;
      for (const w of pack.members) {
        w.gait += dt * 5.4;
        // Behind the leader along the line of travel, plus a little sideways
        const x = pack.x - hx * w.file - hz * w.drift;
        const z = pack.z - hz * w.file + hx * w.drift;
        const bob = Math.abs(Math.sin(w.gait)) * 0.045;
        v.set(x, heightAt(x, z) + bob, z);
        e.set(0, pack.yaw + Math.PI, Math.sin(w.gait) * 0.045, 'YXZ');
        q.setFromEuler(e);
        s.set(w.scale, w.scale * (1 + Math.cos(w.gait * 2) * 0.03), w.scale);
        m.compose(v, q, s);
        wolves.setMatrixAt(wn++, m);
      }
    }
    wolves.count = wn;
    if (wn > 0) wolves.instanceMatrix.needsUpdate = true;

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
    herd.alive = false;
    pack.alive = false;
    bearClock = range(WILDLIFE.bearRespawn);
    deerClock = range(WILDLIFE.deerRespawn);
    wolfClock = range(WILDLIFE.wolfRespawn);
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
  // `herd` and `pack` join them for the same reason, and so a test can put a
  // herd on the hill without waiting out its spawn clock.
  return {
    group, update, reset, setLamp, hares, beasts, eyes, herd, pack, placeHerd, placePack,
  };
}
