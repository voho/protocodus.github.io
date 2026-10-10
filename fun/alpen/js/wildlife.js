/* Rabbits, deer and wolves.

   THREE ANIMALS AND TWO JOBS. The first is about the rider. The other two
   are not about the rider at all, and that is the entire point of them —
   see the long note in `config.js` under `deer`. A herd out past the
   treeline that never collides, never scores and cannot be reached is doing
   the one thing nothing else on this hill does, which is being somewhere
   else.

   The rabbits exist to react: they sit in
   the snow twitching until a rider gets inside fifteen metres and then bolt,
   which costs nothing, endangers nothing, and is most of what makes the
   mountain feel inhabited rather than decorated. Threading one is worth a
   few points, so there is a reason to aim at them.

   THERE IS NO BEAR, and the file should say so, because it used to say the
   opposite at length. A bear — the one genuinely dangerous animal, rare
   enough to be a story rather than traffic — was designed, tuned in the
   config, and given hooks here (`beasts`, the `onHit` parameter, and the
   hind-leg rear constants), but its body, its spawn clock and its strike
   wiring were never built: `main.js` calls `update` without an `onHit`
   handler and nothing ever pushes into `beasts`. The hooks stay, honestly
   labelled as the empty sockets they are, for whoever builds it.

   The other thing that changed underneath this file is the shape of the run.
   The corridor is roughly three times wider than it was, its width breathes
   along the descent, and the piste periodically splits into two lines around
   an island of trees. Nothing here may assume a single centre or a constant
   half-width any more: animals are placed against `centersAt`/`nearestCenter`
   and `corridorHalfAt`.

   The hares and the herd animals are single instanced meshes with their
   parts baked in by `compose`, so seventeen animals are two draw calls.
   Neither has a skeleton, and neither needs one: a bound is a squash plus a
   pitch about the hare's own lateral axis. The models themselves are much
   heavier than they were — the game renders at native resolution now, and
   the budget that justified four identical cylinders for legs no longer
   exists. */

import { compose, sculpt } from './geom.js';
import { WILDLIFE } from './config.js';
import { heightAt, centersAt, nearestCenter, corridorHalfAt } from './terrain.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const range = ([lo, hi]) => lo + Math.random() * (hi - lo);
/* Triangular on [-1, 1] rather than uniform: with a corridor this wide a
   uniform scatter puts most of the rabbits somewhere the rider is never
   going to be, and the mountain reads as emptier than its animal count. */
const spread = () => Math.random() + Math.random() - 1;

/* THE GROUND UNDER FOUR FEET.

   Deer and wolves were composed level and stood level, on a mountain whose
   gentlest pitch is seven degrees: grazing across the fall line, the
   uphill legs were buried to the knee and the downhill ones hung in the
   air, and a pack traversing the hill walked along it like a row of
   cut-outs on a shelf. So each body is pitched to the ground between its
   own front and hind feet and rolled to the ground between its left and
   right ones, sampled along the heading it is actually facing — the same
   yaw convention as the hares, (sin yaw, cos yaw) forward, which puts the
   body's +X at (−cos yaw, sin yaw).

   The roll is three quarters of the ground's, not all of it. A quadruped
   standing across a slope lengthens its downhill legs and keeps its spine
   nearer level than the ground under it; rolled the whole way, a deer on a
   twenty-degree traverse reads as an animal about to fall over, and the
   quarter that is left is a few centimetres of hoof sunk in snow, which is
   where hooves are anyway. Pitch is taken whole — along the body the legs
   cannot hide the difference, and a deer facing uphill does stand nose-up.

   And both stop somewhere. The pack is spawned off the piste, which on
   this mountain can be the boundary's quarterpipe wall, and a wolf rolled
   three quarters of the way onto a sixty-degree wall is a wolf clinging to
   it like a gecko — measured in the first capture of this, and worse than
   the buried legs it replaced. No animal carries its spine steeper than
   this across a slope or along one; past it the snow takes the legs, as
   it would.

   `half` and `side` are half the spacing of the feet along and across the
   body, already multiplied by the animal's scale. Four height samples an
   animal, for a handful of animals, once a frame. */
const SLOPE_ROLL = 0.75;
const SLOPE_PITCH_MAX = 0.5;
const SLOPE_ROLL_MAX = 0.4;
const slopeUnder = (x, z, yaw, half, side, out) => {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  out.pitch = clamp(Math.atan2(
    heightAt(x + fx * half, z + fz * half) - heightAt(x - fx * half, z - fz * half), 2 * half,
  ), -SLOPE_PITCH_MAX, SLOPE_PITCH_MAX);
  out.roll = clamp(SLOPE_ROLL * Math.atan2(
    heightAt(x - fz * side, z + fx * side) - heightAt(x + fz * side, z - fx * side), 2 * side,
  ), -SLOPE_ROLL_MAX, SLOPE_ROLL_MAX);
  return out;
};
const slope = { pitch: 0, roll: 0 };
const centersScratch = [0, 0];
const farSpotSpot = { x: 0, side: 1 };

/* Which of the two branch centres to hang an animal off at this z.

   `centersAt` hands back both, equal when the run is not forked there. When
   it is forked, picking at random populates both sides of the island, which
   is right — an empty far branch looks like a bug. But doing only that
   throws half the animals ninety metres across a stand of trees where the
   rider will never learn they exist, so the branch the rider's own line is
   nearer wins the toss most of the time, and `away` is the share that goes
   to the other one anyway. */
function branchAt(z, riderX, away) {
  centersAt(z, centersScratch);
  const c0 = centersScratch[0];
  const c1 = centersScratch[1];
  if (Math.abs(c0 - c1) < 1e-6) return c0;
  const near = Math.abs(riderX - c0) <= Math.abs(riderX - c1) ? c0 : c1;
  return Math.random() < away ? (near === c0 ? c1 : c0) : near;
}

/* A tapered cylinder hung from `top` to `foot` (radius `r` at the top), as
   a `compose` part: the lower legs, which are thinner than any grid a whole
   animal can afford. `geo` is a unit cylinder whose bottom is the foot. */
function limb(THREE, geo, top, foot, r, color) {
  const a = new THREE.Vector3(...top);
  const b = new THREE.Vector3(...foot);
  const along = b.clone().sub(a);
  const length = along.length();
  const e = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), along.normalize()),
  );
  return {
    geo, color, pos: a.add(b).multiplyScalar(0.5).toArray(),
    rot: [e.x, e.y, e.z], scale: [r * 2, length, r * 2],
  };
}

/* A mountain hare, facing -Z, feet at y = 0.

   A hare's silhouette is almost entirely about weight distribution — the
   rump is the tallest thing on it, the back falls away forwards to a much
   narrower chest, and the head is carried up and forward on a visible neck.
   That line used to be a chain of separate balls, and close up it read as a
   balloon animal: a crease at every join, a neck of stacked beads, a flat
   shaded disc stuck on each flank for a haunch. It is one skin now (see
   `sculpt`): the folded hind legs swell out of the rump the way muscle
   does, the long flat hind feet run forward under them, which is what makes
   a crouched hare look coiled rather than seated, and the fur goes a shade
   bluer where it turns under. Ears and eyes are thinner than the grid and
   are laid on top. Proportioned from the animal rather than for distance:
   the winter mountain hare's ears are short, about the length of its head. */
function rabbitGeometry(THREE) {
  const fur = '#eef3fb';
  const under = '#d3dcea';
  const dark = '#1b1f27';
  const bead = new THREE.SphereGeometry(0.5, 10, 6);

  const skin = sculpt(THREE, [
    // rump, the highest point, then the back falling away to the chest
    { pos: [0, 0.18, 0.11], radii: [0.13, 0.15, 0.155], color: fur },
    { pos: [0, 0.15, -0.04], radii: [0.11, 0.115, 0.14], color: fur },
    { pos: [0, 0.13, -0.14], radii: [0.085, 0.1, 0.085], color: fur },
    { pos: [0, 0.075, 0], radii: [0.085, 0.055, 0.15], color: under },
    // the folded hind legs, swelling out of either flank low and behind
    { pos: [-0.095, 0.11, 0.1], radii: [0.065, 0.115, 0.145], rot: [0.4, 0, 0], color: fur, k: 0.05 },
    { pos: [0.095, 0.11, 0.1], radii: [0.065, 0.115, 0.145], rot: [0.4, 0, 0], color: fur, k: 0.05 },
    { pos: [-0.078, 0.022, 0.03], radii: [0.032, 0.022, 0.115], color: under, k: 0.03 },
    { pos: [0.078, 0.022, 0.03], radii: [0.032, 0.022, 0.115], color: under, k: 0.03 },
    // neck, head and muzzle
    { pos: [0, 0.16, -0.16], to: [0, 0.25, -0.225], r: [0.062, 0.053], color: fur },
    { pos: [0, 0.28, -0.26], radii: [0.06, 0.065, 0.085], rot: [0.25, 0, 0], color: fur },
    { pos: [0, 0.257, -0.325], radii: [0.035, 0.037, 0.045], rot: [0.3, 0, 0], color: fur, k: 0.03 },
    // short forelegs and the paws flat in front
    { pos: [-0.045, 0.11, -0.16], to: [-0.042, 0.025, -0.195], r: [0.026, 0.02], color: fur, k: 0.03 },
    { pos: [0.045, 0.11, -0.16], to: [0.042, 0.025, -0.195], r: [0.026, 0.02], color: fur, k: 0.03 },
    { pos: [-0.042, 0.016, -0.215], radii: [0.024, 0.016, 0.038], color: under, k: 0.02 },
    { pos: [0.042, 0.016, -0.215], radii: [0.024, 0.016, 0.038], color: under, k: 0.02 },
    // the scut, white all year
    { pos: [0, 0.2, 0.27], radii: [0.035, 0.035, 0.028], color: '#ffffff', k: 0.025 },
  ], { cell: 0.025, k: 0.045 });

  /* The ear is coloured along its own length, so the black is the end of
     the ear rather than a bead stuck on it, which read as an antenna. */
  const earGeo = new THREE.SphereGeometry(0.5, 10, 8);
  const tip = new THREE.Color(dark);
  const base = new THREE.Color(fur);
  const earPos = earGeo.attributes.position;
  const earColor = new Float32Array(earPos.count * 3);
  for (let i = 0; i < earPos.count; i++) {
    const t = Math.min(1, Math.max(0, (earPos.getY(i) - 0.22) / 0.08));
    earColor[i * 3] = base.r + (tip.r - base.r) * t;
    earColor[i * 3 + 1] = base.g + (tip.g - base.g) * t;
    earColor[i * 3 + 2] = base.b + (tip.b - base.b) * t;
  }
  earGeo.setAttribute('color', new THREE.BufferAttribute(earColor, 3));

  // Laid back along the neck and splayed a little
  return compose(THREE, [
    { geo: skin },
    { geo: earGeo, pos: [-0.03, 0.37, -0.23], rot: [0.55, 0, 0.22], scale: [0.042, 0.15, 0.022] },
    { geo: earGeo, pos: [0.03, 0.37, -0.23], rot: [0.55, 0, -0.22], scale: [0.042, 0.15, 0.022] },
    { geo: bead, color: dark, pos: [-0.048, 0.293, -0.29], scale: [0.022, 0.024, 0.02] },
    { geo: bead, color: dark, pos: [0.048, 0.293, -0.29], scale: [0.022, 0.024, 0.02] },
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
  const cannon = new THREE.CylinderGeometry(0.5, 0.4, 1, 8, 1, true);
  const hoof = new THREE.SphereGeometry(0.5, 8, 5);

  /* Each leg swings about the top of its forearm or gaskin, where it leaves
     the body (see `aGait` in createWildlife). A gallop's phases: the fronts
     a beat apart, the hinds a beat apart, the pairs half a stride apart. */
  const legs = {
    '-1': [[0.86, -0.36, 0], [0.76, 0.46, Math.PI]],
    1: [[0.86, -0.36, 0.5], [0.76, 0.46, Math.PI + 0.5]],
  };

  // One skin from the withers to the tail, the upper legs swelling out of it
  const skin = sculpt(THREE, [
    // chest deepest, the withers over it, the barrel, a loin tucked up
    // behind and the rump back up again
    { pos: [0, 0.98, -0.32], radii: [0.17, 0.25, 0.24], color: DEER_COAT },
    { pos: [0, 1.12, -0.36], radii: [0.12, 0.12, 0.2], color: DEER_LIGHT },
    { pos: [0, 0.97, 0.04], radii: [0.16, 0.23, 0.26], color: DEER_COAT },
    { pos: [0, 1.02, 0.26], radii: [0.145, 0.18, 0.17], color: DEER_COAT },
    { pos: [0, 1.0, 0.44], radii: [0.165, 0.21, 0.19], color: DEER_COAT },
    { pos: [0, 0.8, -0.02], radii: [0.13, 0.11, 0.34], color: DEER_DARK },
    // shoulders down to the knee, and the haunches down to the hock, which
    // points backwards — the joint a quadruped reads as furniture without
    ...[-1, 1].flatMap((x) => [
      { pos: [x * 0.11, 0.98, -0.38], radii: [0.065, 0.19, 0.11], rot: [0.25, 0, 0], color: DEER_COAT },
      { pos: [x * 0.125, 0.86, -0.36], to: [x * 0.13, 0.47, -0.37], r: [0.07, 0.042], color: DEER_COAT, limb: legs[x][0] },
      { pos: [x * 0.11, 0.9, 0.42], radii: [0.08, 0.21, 0.14], rot: [-0.15, 0, 0], color: DEER_COAT },
      { pos: [x * 0.13, 0.76, 0.46], to: [x * 0.14, 0.46, 0.53], r: [0.07, 0.04], color: DEER_DARK, limb: legs[x][1] },
    ]),
    // the short tail, on the pale patch that is most of a deer at range
    { pos: [0, 1.07, 0.6], to: [0, 0.93, 0.66], r: [0.04, 0.028], color: DEER_LIGHT, k: 0.03 },
    { paint: true, pos: [0, 1.0, 0.62], radii: [0.12, 0.16, 0.1], color: DEER_RUMP, k: 0.03 },
  ], { cell: 0.06, k: 0.08 });

  // The cannon bones are thinner than the grid: a deer's are near enough
  // cylinders anyway. The hind ones slant forward from the hock.
  return compose(THREE, [
    { geo: skin },
    ...[-1, 1].flatMap((x) => [
      { ...limb(THREE, cannon, [x * 0.13, 0.5, -0.37], [x * 0.13, 0.05, -0.34], 0.03, DEER_DARK), limb: legs[x][0] },
      { ...limb(THREE, cannon, [x * 0.14, 0.49, 0.53], [x * 0.13, 0.05, 0.46], 0.028, DEER_DARK), limb: legs[x][1] },
      { geo: hoof, color: DEER_HOOF, pos: [x * 0.13, 0.035, -0.35], scale: [0.065, 0.07, 0.09], limb: legs[x][0] },
      { geo: hoof, color: DEER_HOOF, pos: [x * 0.13, 0.035, 0.45], scale: [0.06, 0.07, 0.085], limb: legs[x][1] },
    ]),
  ], { limb: true });
}

/* The head, built from the base of the neck so a rotation about its own X is
   a deer raising or lowering it. At rest the neck stands up and forward, which
   is the alert pose; the graze is the same mesh rolled forward until the
   muzzle is in the snow. `antlers` is the only difference between the two
   variants, so the stag is the same call with one flag. */
function deerHeadGeometry(THREE, antlers) {
  const bead = new THREE.SphereGeometry(0.5, 8, 6);
  const tine = new THREE.CylinderGeometry(0.3, 0.5, 1, 6, 1, true);
  const eye = new THREE.SphereGeometry(0.5, 6, 4);

  // Neck, throat, skull and muzzle as one skin. The neck is thick — a
  // stag's is the width of its skull twice over, and a thin one reads as
  // a llama — and its base is centred on the pivot, the one place a
  // browse can turn it without swinging it up out of the back as a hump
  const skin = sculpt(THREE, [
    { pos: [0, 0, 0], to: [0, 0.45, -0.3], r: [0.15, 0.1], color: DEER_COAT },
    { pos: [0, 0.48, -0.33], radii: [0.085, 0.1, 0.1], color: DEER_LIGHT },
    { pos: [0, 0.6, -0.41], radii: [0.08, 0.085, 0.11], color: DEER_COAT },
    { pos: [0, 0.6, -0.46], to: [0, 0.53, -0.68], r: [0.062, 0.045], color: DEER_LIGHT },
    { paint: true, pos: [0, 0.535, -0.7], radii: [0.05, 0.045, 0.04], color: DEER_HOOF, k: 0.02 },
  ], { cell: 0.055, k: 0.05 });

  const parts = [
    { geo: skin },
    { geo: eye, color: DEER_HOOF, pos: [-0.077, 0.64, -0.45], scale: [0.034, 0.036, 0.032] },
    { geo: eye, color: DEER_HOOF, pos: [0.077, 0.64, -0.45], scale: [0.034, 0.036, 0.032] },
    // ears, set wide and swept back, which is what says deer at any distance
    { geo: bead, color: DEER_LIGHT, pos: [-0.14, 0.69, -0.32], rot: [0.34, -0.50, -0.34], scale: [0.035, 0.19, 0.11] },
    { geo: bead, color: DEER_LIGHT, pos: [0.14, 0.69, -0.32], rot: [0.34, 0.50, 0.34], scale: [0.035, 0.19, 0.11] },
  ];

  if (antlers) {
    /* Four members a side and no attempt at a real beam-and-tine
       structure: at the range these are seen from, an antler is a fan of
       lines above the skull and anything more is triangles nobody resolves.
       Round and tapering, though, rather than square. They are pale
       because a dark antler against dark trees disappears, and the whole
       point of a stag is that you can tell it is one. */
    const beam = (s) => ([
      { geo: tine, color: DEER_RUMP, pos: [s * 0.10, 0.82, -0.37], rot: [-0.20, 0, -s * 0.42], scale: [0.034, 0.28, 0.034] },
      { geo: tine, color: DEER_RUMP, pos: [s * 0.21, 0.99, -0.42], rot: [-0.42, 0, -s * 0.70], scale: [0.03, 0.24, 0.03] },
      { geo: tine, color: DEER_RUMP, pos: [s * 0.18, 0.98, -0.53], rot: [-0.95, 0, -s * 0.30], scale: [0.024, 0.19, 0.024] },
      { geo: tine, color: DEER_RUMP, pos: [s * 0.28, 1.10, -0.34], rot: [0.25, 0, -s * 0.95], scale: [0.024, 0.17, 0.024] },
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
  const cannon = new THREE.CylinderGeometry(0.5, 0.42, 1, 8, 1, true);
  const bead = new THREE.SphereGeometry(0.5, 10, 8);

  // A trot: the legs swing in diagonal pairs (see the deer for the pivots)
  const legs = {
    '-1': [[0.48, -0.3, 0], [0.45, 0.4, Math.PI]],
    1: [[0.48, -0.3, Math.PI], [0.45, 0.4, 0]],
  };

  const skin = sculpt(THREE, [
    // deep chest forward — it drops below the elbow, which is the one
    // proportion that separates a wolf from a large dog — then a tucked loin
    { pos: [0, 0.6, -0.24], radii: [0.15, 0.21, 0.22], color: WOLF_COAT },
    { pos: [0, 0.63, 0.06], radii: [0.12, 0.155, 0.2], color: WOLF_COAT },
    { pos: [0, 0.65, 0.33], radii: [0.135, 0.165, 0.17], color: WOLF_COAT },
    ...[-1, 1].flatMap((x) => [
      { pos: [x * 0.1, 0.56, -0.3], radii: [0.06, 0.16, 0.09], rot: [0.2, 0, 0], color: WOLF_COAT },
      { pos: [x * 0.11, 0.48, -0.3], to: [x * 0.115, 0.27, -0.31], r: [0.055, 0.035], color: WOLF_PALE, limb: legs[x][0] },
      { pos: [x * 0.1, 0.57, 0.36], radii: [0.065, 0.16, 0.11], rot: [-0.2, 0, 0], color: WOLF_COAT },
      { pos: [x * 0.11, 0.45, 0.4], to: [x * 0.12, 0.25, 0.46], r: [0.055, 0.032], color: WOLF_COAT, limb: legs[x][1] },
    ]),
    // neck low and level — a wolf carries its head at the height of its back
    { pos: [0, 0.66, -0.4], to: [0, 0.7, -0.62], r: [0.12, 0.09], color: WOLF_COAT },
    { pos: [0, 0.71, -0.68], radii: [0.085, 0.08, 0.09], color: WOLF_COAT },
    { pos: [0, 0.69, -0.72], to: [0, 0.66, -0.9], r: [0.05, 0.035], color: WOLF_PALE },
    // a straight brush carried low and back, thickest along its middle
    { pos: [0, 0.6, 0.44], to: [0, 0.45, 0.65], r: [0.04, 0.065], color: WOLF_SADDLE, k: 0.04 },
    { pos: [0, 0.45, 0.65], to: [0, 0.3, 0.86], r: [0.065, 0.03], color: WOLF_SADDLE, k: 0.04 },
    // the saddle, which gives the back line an edge, the paler throat and
    // underside, and the dark tip of the brush
    { paint: true, pos: [0, 0.8, -0.02], radii: [0.13, 0.09, 0.42], color: WOLF_SADDLE, k: 0.06 },
    { paint: true, pos: [0, 0.45, -0.25], radii: [0.12, 0.12, 0.3], color: WOLF_PALE, k: 0.06 },
    { paint: true, pos: [0, 0.3, 0.84], radii: [0.06, 0.07, 0.08], color: WOLF_DARK, k: 0.03 },
  ], { cell: 0.05, k: 0.06 });

  return compose(THREE, [
    { geo: skin },
    ...[-1, 1].flatMap((x) => [
      { ...limb(THREE, cannon, [x * 0.115, 0.29, -0.31], [x * 0.115, 0.04, -0.3], 0.03, WOLF_PALE), limb: legs[x][0] },
      { ...limb(THREE, cannon, [x * 0.12, 0.27, 0.46], [x * 0.12, 0.04, 0.42], 0.028, WOLF_PALE), limb: legs[x][1] },
      { geo: bead, color: WOLF_DARK, pos: [x * 0.115, 0.028, -0.32], scale: [0.075, 0.055, 0.1], limb: legs[x][0] },
      { geo: bead, color: WOLF_DARK, pos: [x * 0.12, 0.028, 0.4], scale: [0.07, 0.055, 0.095], limb: legs[x][1] },
    ]),
    { geo: bead, color: WOLF_DARK, pos: [0, 0.655, -0.935], scale: [0.06, 0.05, 0.045] },
    { geo: bead, color: WOLF_DARK, pos: [-0.06, 0.74, -0.74], scale: [0.032, 0.032, 0.028] },
    { geo: bead, color: WOLF_DARK, pos: [0.06, 0.74, -0.74], scale: [0.032, 0.032, 0.028] },
    // upright ears, kept small — a wolf's are short and round-tipped, and the
    // tall pointed pair the first attempt had belong on a shepherd dog
    { geo: bead, color: WOLF_SADDLE, pos: [-0.07, 0.8, -0.64], rot: [-0.10, -0.25, -0.16], scale: [0.06, 0.12, 0.035] },
    { geo: bead, color: WOLF_SADDLE, pos: [0.07, 0.8, -0.64], rot: [-0.10, 0.25, 0.16], scale: [0.06, 0.12, 0.035] },
  ], { limb: true });
}

/* FOR THE UNBUILT BEAR — see the header. Kept so its eventual builder does
   not have to re-derive them: hind paws sit this far behind the origin (a
   rear is a rotation about the origin, so without lifting by this much the
   animal stands up by burying its back feet in the snow), and it should
   spawn across this share of the corridor, near the middle of a branch,
   because something this rare wasted at the treeline is a wasted encounter.
   Nothing reads either constant today. */
const BEAR_HIND = 0.75;
const BEAR_OFFSET = 0.45;

export function createWildlife(THREE, shading) {
  const group = new THREE.Group();

  const furTex = new THREE.TextureLoader().load(
    new URL('../assets/textures/rider/rider-fabric.jpg', import.meta.url).href,
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; },
  );
  furTex.colorSpace = THREE.SRGBColorSpace;

  /* AN ANIMAL ARRIVES; IT DOES NOT APPEAR.

     Hares are placed forty to a hundred and ninety metres down the hill, deer
     and wolves out to three hundred — every one of them inside a clear day's
     view, and every one of them used to exist in full on the frame it was
     placed: a white hare switched on against the snow, a herd materialised on
     a bank. Each instance now carries how far it has arrived, 0..1, and the
     fragment shader dissolves it in through a screen-door dither over a
     second — no sorting, no blending, depth still written — while the shadow
     pass reads the same value so the silhouette on the snow arrives with the
     animal instead of ahead of it. */
  const REVEAL_SECONDS = 1.2;
  const REVEAL_VERT = [`#include <common>
        attribute float aReveal;
        varying float vReveal;`, `#include <begin_vertex>
        vReveal = aReveal;`];
  const REVEAL_FRAG = [`#include <common>
        varying float vReveal;`, `#include <clipping_planes_fragment>
        if (vReveal < 0.999) {
          float n64RevealDither = fract(52.9829189
            * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (n64RevealDither >= vReveal) discard;
        }`];
  const withReveal = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', REVEAL_VERT[0])
      .replace('#include <begin_vertex>', REVEAL_VERT[1]);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', REVEAL_FRAG[0])
      .replace('#include <clipping_planes_fragment>', REVEAL_FRAG[1]);
  };
  /* THE LEGS. A running deer and a trotting wolf used to glide over the
     snow on four rigid posts, the body bobbing over them. Each vertex now
     turns, in the body's own YZ plane, about its leg's pivot (`aLimb`,
     baked by `sculpt` and `compose`) by the instance's stride (`aGait`:
     phase and swing) times how much of the vertex is leg. The depth pass
     gets the same, so the shadow runs with the animal. Anything without
     legs, or not moving, reads zeros and stays exactly where it was. */
  const STRIDE = `
        attribute vec4 aLimb;
        attribute vec2 aGait;
        vec2 n64Stride(vec2 p, float pivot) {
          float a = aGait.y * aLimb.z * sin(aGait.x + aLimb.w);
          float c = cos(a);
          float s = sin(a);
          vec2 d = p - aLimb.xy * pivot;
          return aLimb.xy * pivot + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
        }`;
  const withStride = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${STRIDE}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal.yz = n64Stride(objectNormal.yz, 0.0);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.yz = n64Stride(transformed.yz, 1.0);`);
  };
  const revealDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  revealDepth.onBeforeCompile = (shader) => {
    withReveal(shader);
    withStride(shader);
  };

  const animalMaterial = () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      withReveal(shader);
      withStride(shader);
      shader.uniforms.uFurTex = { value: furTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
        varying vec3 vAnimalWorldPos;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
        /* The animal's own frame, not the world's: sampled at the world
           position the fur streamed across the body as it moved, and
           kilometres down an endless run the coordinate outgrows float
           precision and the weave turns to shimmer — the same bug the
           rider's jacket fixed. Local coordinates stay small forever. */
        vAnimalWorldPos = transformed;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        varying vec3 vAnimalWorldPos;
        uniform sampler2D uFurTex;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        // Only the grain of the weave: its colour tinted a white hare with
        // pink and blue speckles
        float furDetail = dot(texture2D(uFurTex,
          vAnimalWorldPos.xy * 4.5 + vAnimalWorldPos.yz * 4.5).rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * furDetail * 1.5, 0.45);`);
    };
    return shading.apply(m);
  };
  const furMaterial = animalMaterial();
  const rabbits = new THREE.InstancedMesh(
    rabbitGeometry(THREE), furMaterial, WILDLIFE.rabbits,
  );
  rabbits.frustumCulled = false;
  rabbits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(rabbits);

  /* The far animals. Three pools for the deer rather than one, because the
     head is a separate instance and the stag's is a different mesh — and the
     body pool is shared between the two, which is why a stag costs one extra
     draw call for the whole herd rather than a duplicate of everything. */
  const deerBodies = new THREE.InstancedMesh(
    deerBodyGeometry(THREE), furMaterial, WILDLIFE.deer,
  );
  const deerHeads = new THREE.InstancedMesh(
    deerHeadGeometry(THREE, false), furMaterial, WILDLIFE.deer,
  );
  const stagHeads = new THREE.InstancedMesh(
    deerHeadGeometry(THREE, true), furMaterial, WILDLIFE.deer,
  );
  const wolves = new THREE.InstancedMesh(
    wolfGeometry(THREE), furMaterial, WILDLIFE.wolves,
  );
  const coatTint = new THREE.Color();
  for (let i = 0; i < WILDLIFE.rabbits; i++) {
    const warmth = (i % 4) / 3;
    rabbits.setColorAt(i, coatTint.setRGB(1, 0.98 - warmth * 0.04, 0.96 - warmth * 0.10));
  }
  for (let i = 0; i < WILDLIFE.wolves; i++) {
    const shade = 0.78 + (i % 3) * 0.11;
    wolves.setColorAt(i, coatTint.setRGB(shade, shade * 0.97, shade * 0.90));
  }
  for (const mesh of [deerBodies, deerHeads, stagHeads, wolves]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }
  // One arrival value per instance, written beside its matrix every frame.
  const revealOf = new Map();
  for (const mesh of [rabbits, deerBodies, deerHeads, stagHeads, wolves]) {
    const reveal = new THREE.InstancedBufferAttribute(
      new Float32Array(mesh.instanceMatrix.count).fill(1), 1);
    reveal.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aReveal', reveal);
    mesh.customDepthMaterial = revealDepth;
    revealOf.set(mesh, reveal.array);
  }
  const markReveal = (mesh) => {
    mesh.geometry.attributes.aReveal.needsUpdate = true;
  };
  // And the stride of every animal that has legs to move, beside its matrix
  const strideOf = (mesh) => {
    const gait = new THREE.InstancedBufferAttribute(
      new Float32Array(mesh.instanceMatrix.count * 2), 2);
    gait.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aGait', gait);
    return gait.array;
  };
  const deerStride = strideOf(deerBodies);
  const wolfStride = strideOf(wolves);
  // Seconds of simulated time, for the arrival stamps.
  let clock = 0;
  const arrival = (born) => Math.min(1, Math.max(0, (clock - born) / REVEAL_SECONDS));
  const rabbitReveal = revealOf.get(rabbits);
  const deerReveal = revealOf.get(deerBodies);
  const deerHeadReveal = revealOf.get(deerHeads);
  const stagReveal = revealOf.get(stagHeads);
  const wolfReveal = revealOf.get(wolves);

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
  const EYE_MAX = WILDLIFE.rabbits * 2;
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
        /* Nudged toward the camera, because the quad is billboarded from
           the centre of the opaque eye bead: left at the bead's own depth
           every fragment of the gaussian core failed the depth test against
           the bead itself, and all that survived was a clipped ring past
           its silhouette. Six centimetres clears the ~2.5 cm bead without
           ever leaking through a head or a tree. */
        mv.z += 0.06;
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
    r.born = clock;
  }

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
  const deerMembers = Array.from({ length: WILDLIFE.deer }, () => ({
    ox: 0, oz: 0, stag: false, clock: 0, yaw: 0, scale: 1,
  }));
  const wolfMembers = Array.from({ length: WILDLIFE.wolves }, () => ({
    file: 0, drift: 0, gait: 0, scale: 1,
  }));
  let deerClock = range(WILDLIFE.deerRespawn);
  let wolfClock = range(WILDLIFE.wolfRespawn);

  /* Which side of the run, and how far past its edge. Beyond the corridor on
     purpose — see the note in config — and measured from the branch centre
     the group is actually nearest so a fork does not put a herd in the middle
     of the other line. */
  function farSpot(z, range_) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = corridorHalfAt(z) + range_[0] + Math.random() * (range_[1] - range_[0]);
    /* From the OUTER branch centre for the chosen side, not from
       `nearestCenter(0, z)` — that was the branch nearest world x = 0,
       unrelated to the side of the toss, and on a forked stretch an offset
       thrown across the run from it landed the herd inside the other
       line's corridor: deer standing in the middle of a piste. */
    centersAt(z, centersScratch);
    const c0 = centersScratch[0];
    const c1 = centersScratch[1];
    const outer = side > 0 ? Math.max(c0, c1) : Math.min(c0, c1);
    farSpotSpot.x = outer + side * off;
    farSpotSpot.side = side;
    return farSpotSpot;
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
    herd.born = clock;
    const n = 2 + Math.floor(Math.random()
      * (WILDLIFE.deerHerd[1] - WILDLIFE.deerHerd[0] + 1));
    herd.members.length = 0;
    const count = Math.min(n, WILDLIFE.deer);
    for (let i = 0; i < count; i++) {
      const m = deerMembers[i];
      m.ox = spread() * WILDLIFE.deerSpread;
      m.oz = spread() * WILDLIFE.deerSpread;
      // A herd is one stag at most, and only sometimes. Two stags standing
      // together is the one arrangement red deer never make.
      m.stag = i === 0 && Math.random() < 0.45;
      // Every deer keeps its own grazing clock, because a herd that lifts
      // its heads in unison is a herd that has noticed something — and
      // nothing has happened yet.
      m.clock = Math.random() * 9;
      m.yaw = Math.random() * Math.PI * 2;
      m.scale = 0.88 + Math.random() * 0.26;
      herd.members.push(m);
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
    pack.born = clock;
    const n = WILDLIFE.wolfPack[0] + Math.floor(Math.random()
      * (WILDLIFE.wolfPack[1] - WILDLIFE.wolfPack[0] + 1));
    pack.members.length = 0;
    const count = Math.min(n, WILDLIFE.wolves);
    for (let i = 0; i < count; i++) {
      const m = wolfMembers[i];
      // Position in the file, with the gaps uneven — a wolf pack in snow
      // walks in one another's tracks but not to a ruler
      m.file = i * WILDLIFE.wolfFile * (0.82 + Math.random() * 0.36);
      m.drift = spread() * 0.8;
      m.gait = Math.random() * 6;
      m.scale = i === 0 ? 1.06 : 0.88 + Math.random() * 0.18;
      pack.members.push(m);
    }
  }

  /* `onNear` is called when the rider threads an animal without hitting it;
     `onHit` when a bear is not so lucky. */
  function update(dt, rider, onNear, onHit) {
    clock += dt;
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
      rabbitReveal[n] = arrival(r.born);
      rabbits.setMatrixAt(n++, m);
      if (lampOn) shineEyes(RABBIT_EYES);
    }
    rabbits.count = n;
    // Nothing changed on the GPU's side of an empty pool, so an upload is
    // only queued when there are live instances to carry.
    if (n > 0) {
      rabbits.instanceMatrix.needsUpdate = true;
      markReveal(rabbits);
    }

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
        const gait = d.clock * 12;
        const bob = Math.sin(gait) * 0.055 * herd.alert;
        // A running herd all faces the way it is going; a grazing one does not
        const yaw = lerp(d.yaw, Math.atan2(herd.dir, -0.45), herd.alert);
        slopeUnder(x, z, yaw, 0.37 * d.scale, 0.20 * d.scale, slope);
        v.set(x, y + Math.abs(bob), z);
        e.set(Math.sin(gait * 2) * 0.05 * herd.alert + slope.pitch, yaw + Math.PI, slope.roll, 'YXZ');
        q.setFromEuler(e);
        s.set(d.scale, d.scale, d.scale);
        m.compose(v, q, s);
        const herdIn = arrival(herd.born);
        deerReveal[dn] = herdIn;
        deerStride[dn * 2] = gait;
        deerStride[dn * 2 + 1] = herd.run > 0 ? 0.5 * herd.alert : 0;
        deerBodies.setMatrixAt(dn++, m);

        /* The head, hung off the same transform. `m` is still the body's, so
           the withers offset only has to be pushed through it — which keeps
           the neck attached whatever the body's yaw, scale and gait pitch are
           doing, and costs one matrix apply instead of a second compose. */
        ev.set(DEER_WITHERS[0], DEER_WITHERS[1], DEER_WITHERS[2]).applyMatrix4(m);
        // The head carries the body's lie on the slope too, or the neck
        // would leave the withers at a kink on every hillside.
        e.set(DEER_BROWSE * feeding + slope.pitch, yaw + Math.PI, slope.roll, 'YXZ');
        q.setFromEuler(e);
        m.compose(ev, q, s);
        if (d.stag) {
          stagReveal[sn] = herdIn;
          stagHeads.setMatrixAt(sn++, m);
        } else {
          deerHeadReveal[dn - 1 - sn] = herdIn;
          deerHeads.setMatrixAt(dn - 1 - sn, m);
        }
      }
    }
    deerBodies.count = dn;
    deerHeads.count = dn - sn;
    stagHeads.count = sn;
    if (dn > 0) {
      deerBodies.instanceMatrix.needsUpdate = true;
      markReveal(deerBodies);
      deerBodies.geometry.attributes.aGait.needsUpdate = true;
      if (dn - sn > 0) {
        deerHeads.instanceMatrix.needsUpdate = true;
        markReveal(deerHeads);
      }
      if (sn > 0) {
        stagHeads.instanceMatrix.needsUpdate = true;
        markReveal(stagHeads);
      }
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
        // Two strides a second, which a trot at this speed is; the legs
        // swing on it (`aGait`), so it has to be the real rate or they skate
        w.gait += dt * 12;
        // Behind the leader along the line of travel, plus a little sideways
        const x = pack.x - hx * w.file - hz * w.drift;
        const z = pack.z - hz * w.file + hx * w.drift;
        const bob = Math.abs(Math.sin(w.gait)) * 0.03;
        slopeUnder(x, z, pack.yaw, 0.32 * w.scale, 0.17 * w.scale, slope);
        v.set(x, heightAt(x, z) + bob, z);
        e.set(slope.pitch, pack.yaw + Math.PI, Math.sin(w.gait) * 0.045 + slope.roll, 'YXZ');
        q.setFromEuler(e);
        s.set(w.scale, w.scale * (1 + Math.cos(w.gait * 2) * 0.03), w.scale);
        m.compose(v, q, s);
        wolfReveal[wn] = arrival(pack.born);
        wolfStride[wn * 2] = w.gait;
        wolfStride[wn * 2 + 1] = 0.42;
        wolves.setMatrixAt(wn++, m);
      }
    }
    wolves.count = wn;
    if (wn > 0) {
      wolves.instanceMatrix.needsUpdate = true;
      markReveal(wolves);
      wolves.geometry.attributes.aGait.needsUpdate = true;
    }

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
    rabbits.count = 0;
    deerBodies.count = 0;
    deerHeads.count = 0;
    stagHeads.count = 0;
    wolves.count = 0;
    eyes.count = 0;
    eyes.visible = false;
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
