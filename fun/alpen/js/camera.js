/* The chase camera, which is most of what the player actually feels.

   Three ideas hold it together.

   It follows where the rider is *going*, not where the board is pointing.
   When the edge lets go and the board swings sideways, the camera stays
   behind the direction of travel — so you watch your own board slide out in
   front of you, which is the single most legible way to show a drift.

   It rides the rider's suspension. The camera's height is tied to the leg
   spring, so a landing drops it and lets it back up, and a hard carve squats
   it. The screen moves because the rider's body moved, not because a shake
   was scheduled.

   And it lags with a spring rather than a lerp, so it overshoots slightly on
   a direction change and settles — which reads as weight. A lerp reads as a
   camera on a stick.

   Three things have been added since, all of them because the mountain and
   the rider changed underneath it.

   A landing punches the frame open. The legs were already taking the hit and
   the shake was already firing, but the lens said nothing, and a landing is
   the loudest moment the game has. The punch is deliberately applied *after*
   the field of view has been smoothed rather than to the value being smoothed
   towards: a target that takes three tenths of a second to reach is a zoom,
   not a punch.

   The air frame grows with the flight. A jump used to be over inside a
   second and a camera that sat a little further back covered it. Hang time is
   roughly double what it was, and over two seconds the old framing put the
   rider dead centre with the landing somewhere below the bottom edge — which
   is precisely the information they need and precisely what they could not
   see. So the boom keeps extending, the camera keeps lifting, and the look
   point keeps sinking towards the ground for as long as the rider is off it.

   And the floor is no longer one sample and one clamp. That was fine while
   the ground beside the piste was flat; it is now walled with quarterpipes
   that riders are meant to ride up, and coming back down one the chase
   position sits *up the wall behind the rider*, where a clamp lifted the
   camera over the lip to look down at a rider who had become a dot in the
   bottom of a bowl. The wall is now treated the way a tree already was:
   shorten the boom rather than climb, because pulling in keeps the rider the
   same size on screen and climbing does not. */

import { CAMERA, RENDER, RIDER } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* How far the ground at (x, z) stands above the tangent plane the rider is
   standing on — the plane through `rider.pos` with `rider.normal` as its
   normal. Zero on an open pitch however steep it is, a metre or so over a
   mogul field, and metres up the side of anything built. It is a free
   function rather than a closure over the frame so the camera can ask it
   half a dozen times a frame without allocating anything. */
const aboveSlope = (world, rider, ny, x, z) => world.height(x, z) - rider.pos.y
  + (rider.normal.x * (x - rider.pos.x) + rider.normal.z * (z - rider.pos.z)) / ny;

/* The air frame, written here rather than in config because none of it is a
   new idea — it is the shape of `airHeight` and `lookAhead` over a long
   flight, and it only means anything next to the values it modifies. */
const AIR_OPEN = 1.5;     // seconds of hang over which the air frame opens fully
const AIR_PULL = 3.6;     // extra metres of boom at full opening
const AIR_LIFT = 1.8;     // and of height
const AIR_REACH = 4.5;    // metres further ahead the look point is thrown
const AIR_SINK = 2.9;     // and how far it drops towards the landing
const AIR_FOV = 5;        // degrees the frame opens back up over a long flight

/* How much of the ground's own bank the frame takes on.

   The share is small and the cap is smaller, because a rolled frame stops
   reading as a bank and starts reading as a broken horizon somewhere around
   twelve degrees. The dead zone is what keeps the piste steady: a mogul face
   is a few degrees of tilt and it is not a bank, and without the dead zone
   every roller in the run wobbled the horizon.

   Note where the sign comes from. The carve roll below is expressed in the
   rider's own lean, and this is not: it is the ground's normal measured
   against the camera's own right-hand axis, so the frame tips towards the
   hill it is actually looking at rather than towards whichever way a
   convention happens to point. */
const BANK_SHARE = 0.34;
const BANK_DEAD = 0.13;   // sine of the tilt below which the ground is just lumpy
const BANK_MAX = 0.20;    // radians ≈ 11°
const BANK_RATE = 4.0;    // per second — a wall arrives, it does not snap

const FLOOR = 1.5;        // metres of clearance the camera keeps over the snow
// How far the ground behind the rider may stand above the slope the rider is
// on before the camera stops trying to sit on top of it. Two and a half
// metres covers every roller, mogul and cliff lip the generator makes; a
// quarterpipe is more than twice it, and a tree is not the camera's problem
// here because trees are handled by the sightline walk.
const CLIMB = 2.6;

/* When collision pulls the live boom right in, its independently smoothed
   look point cannot stay several metres down-course: on a portrait frame that
   aims past the rider altogether. Normal framing is untouched above START;
   below FULL the only honest composition is to look at the rider until the
   boom has room to open again. */
const SHORT_LOOK_START = 0.72;
const SHORT_LOOK_FULL = 0.55;
const SHORT_PORTRAIT_FOV = 16;
const SHORT_PORTRAIT_FOV_MAX = 82;
const SHORT_PORTRAIT_WIDE = 1.1;
const SHORT_PORTRAIT_RANGE = 0.6;
const TREE_MIN_BOOM = 0.30;
const TREE_SUBJECT_START = 0.34;
const TREE_SUBJECT_RESCAN = 0.58;
const TREE_SAMPLE_STEP = 0.075;
const TREE_GUARD = 0.035;
const TREE_NEAR_RADIUS = 0.7;
const TREE_LENS_RADIUS = 4.4;
const TREE_PULL_RATE = 18;
const TREE_RELEASE_RATE = 3.2;

/* How much of the boom is clear along one bearing.

   `world.blocked` reports trunk circles, but the lens has to stay out of the
   much wider crown. The clearance therefore grows from a small subject-side
   margin to a foliage-sized lens margin. A coarse walk finds the first hit,
   then a short binary search places its boundary continuously; using the
   coarse sample itself is what made the old camera change distance in visible
   steps as a tree crossed the sightline. */
const treeClearFraction = (world, rider, point) => {
  if (!world.blocked) return 1;

  const dx = point.x - rider.pos.x;
  const dz = point.z - rider.pos.z;
  if (dx * dx + dz * dz < 0.01) return 1;

  const blocked = (t) => {
    const cx = rider.pos.x + dx * t;
    const cz = rider.pos.z + dz * t;
    const near = clamp((t - TREE_SUBJECT_START) / (1 - TREE_SUBJECT_START), 0, 1);
    const shaped = near * near * (3 - 2 * near);
    const foliage = TREE_NEAR_RADIUS
      + shaped * (TREE_LENS_RADIUS - TREE_NEAR_RADIUS);
    return world.blocked(cx, cz, foliage);
  };

  let previous = TREE_SUBJECT_START;
  let wasBlocked = blocked(previous);

  /* A crown already touching the rider cannot be fixed by moving the camera.
     Ignore that innermost overlap, but start again soon enough to catch a
     second tree or the same crown surrounding the lens. */
  if (wasBlocked) {
    previous = TREE_SUBJECT_RESCAN;
    wasBlocked = blocked(previous);
    if (wasBlocked) return Math.max(TREE_MIN_BOOM, previous - 0.10);
  }

  const count = Math.ceil((1 - previous) / TREE_SAMPLE_STEP);
  let lastClear = previous;
  for (let i = 1; i <= count; i++) {
    const t = Math.min(1, previous + i * TREE_SAMPLE_STEP);
    if (!blocked(t)) {
      lastClear = t;
      continue;
    }

    let lo = Math.max(TREE_MIN_BOOM, lastClear);
    let hi = t;
    for (let j = 0; j < 5; j++) {
      const mid = (lo + hi) * 0.5;
      if (blocked(mid)) hi = mid;
      else lo = mid;
    }
    return Math.max(TREE_MIN_BOOM, lo - TREE_GUARD);
  }
  return 1;
};

const shortenBoom = (world, rider, point, fraction) => {
  if (fraction >= 0.999) return;
  point.x = rider.pos.x + (point.x - rider.pos.x) * fraction;
  point.z = rider.pos.z + (point.z - rider.pos.z) * fraction;
  point.y = Math.max(point.y, world.height(point.x, point.z) + FLOOR);
};

export function createChaseCamera(THREE, camera) {
  const at = new THREE.Vector3();
  const look = new THREE.Vector3();
  const want = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const flat = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const riderLook = new THREE.Vector3();

  let started = false;
  let shake = 0;
  let fov = RENDER.fov;
  let punch = 0;
  let roll = 0;
  let bank = 0;
  let seed = 0;
  let treeBoom = 1;

  function kick(amount) {
    shake = Math.min(2.4, shake + amount);
  }

  /* The visual half of the thump the legs are already taking. Weighed
     against `softImpact`, which is the physics' own idea of a landing that
     has stopped being free — so the frame and the body agree about what a
     heavy landing is instead of each having a private opinion. */
  function land(impact) {
    const w = Math.min(1, impact / (RIDER.softImpact * 1.4));
    punch = Math.min(CAMERA.landFov * 1.3, punch + CAMERA.landFov * w);
    kick(Math.min(1.8, impact * 0.09));
  }

  function update(rider, dt, world) {
    const speed = rider.speed;
    const ratio = clamp(speed / 42, 0, 1);
    const air = !rider.grounded;
    const tuck = rider.tucking ? 1 : 0;
    // Eased rather than linear, so the frame opens promptly off a small
    // roller and still has somewhere left to go through a long flight
    const hang = clamp(rider.airTime / AIR_OPEN, 0, 1);
    const airT = air ? hang * (2 - hang) : 0;

    // Which way the run is actually heading: mostly the velocity, a little
    // the board. Pure velocity swims about at low speed; pure heading hides
    // every slide the rider makes.
    const stanceYaw = rider.yaw - (rider.switchStance ? Math.PI : 0);
    flat.set(rider.vel.x, 0, rider.vel.z);
    if (flat.lengthSq() < 9) flat.set(Math.sin(stanceYaw), 0, -Math.cos(stanceYaw));
    flat.normalize();
    tmp.set(Math.sin(stanceYaw), 0, -Math.cos(stanceYaw));
    dir.copy(flat).multiplyScalar(CAMERA.velocityBias)
      .addScaledVector(tmp, 1 - CAMERA.velocityBias).normalize();

    /* The punch also pulls the boom in a fraction. Widening the lens alone
       reads as a lens event; a lens that widens *while the camera lunges
       half a metre closer* reads as an impact, because that pairing is what
       a real operator caught by surprise does. It rides the punch's own
       decay, so the ease-out needs no clock of its own. */
    const back = CAMERA.distance + ratio * 1.6 + tuck * CAMERA.tuckPull + airT * AIR_PULL
      - punch * 0.075;
    const up = (air ? CAMERA.airHeight + airT * AIR_LIFT : CAMERA.height)
      - rider.compression * 0.85
      - tuck * CAMERA.tuckDrop;

    want.copy(rider.pos).addScaledVector(dir, -back);
    want.y = rider.pos.y + up;

    /* Never let the hill come between the camera and the rider — and never
       let it shove the camera up a wall to manage it either.

       The measurement that makes this work is `aboveSlope`: how far the
       ground stands over the tangent plane the rider is on, which is
       exactly what `rider.normal` describes. Measuring against the *rider*
       instead would be useless, because the camera sits behind the rider and
       behind is uphill: on a 25° pitch the ground under the chase position is
       nearly four metres higher than the rider, and it should be, and the
       camera should ride up with it. Measured against the plane that same
       pitch is zero, a mogul is under a metre, and a quarterpipe is six —
       which is the only distinction that was ever wanted here.

       Past the allowance the boom comes in rather than climbing, walked back
       in a few steps exactly like the sightline test below. Pulling in keeps
       the rider the same size on screen; climbing turns them into a dot in
       the bottom of a bowl. */
    const ny = Math.max(0.25, rider.normal.y);
    if (aboveSlope(world, rider, ny, want.x, want.z) > CLIMB) {
      let clear = 0.3;
      for (let t = 0.86; t >= 0.29; t -= 0.19) {
        const cx = rider.pos.x + (want.x - rider.pos.x) * t;
        const cz = rider.pos.z + (want.z - rider.pos.z) * t;
        if (aboveSlope(world, rider, ny, cx, cz) <= CLIMB) { clear = t; break; }
      }
      want.x = rider.pos.x + (want.x - rider.pos.x) * clear;
      want.z = rider.pos.z + (want.z - rider.pos.z) * clear;
    }

    /* A tree changes boom length, never bearing. The former can be damped;
       the latter was previously chosen from several discrete orbit angles,
       and a single clearance threshold could therefore throw the camera
       seventy degrees sideways in one frame. Pull in promptly, release more
       slowly, and let the ordinary chase spring carry both transitions. */
    const treeLimit = treeClearFraction(world, rider, want);
    if (!started) {
      treeBoom = treeLimit;
    } else {
      const rate = treeLimit < treeBoom ? TREE_PULL_RATE : TREE_RELEASE_RATE;
      treeBoom += (treeLimit - treeBoom) * (1 - Math.exp(-rate * dt));
    }
    shortenBoom(world, rider, want, treeBoom);

    const floor = world.height(want.x, want.z) + FLOOR;
    if (want.y < floor) want.y = floor;

    wantLook.copy(rider.pos)
      .addScaledVector(dir, CAMERA.lookAhead * (0.6 + 0.4 * ratio) + airT * AIR_REACH);
    // In the air the look point sinks towards the snow the rider is falling
    // at — partly with the flight, and partly with how fast they are coming
    // down, so a long float looks ahead and a plummet looks under itself
    const drop = air ? 1.2 + airT * AIR_SINK + Math.min(2.0, Math.max(0, -rider.vel.y) * 0.11) : 0;
    wantLook.y = rider.pos.y + 1.1 - drop;

    if (!started) {
      started = true;
      at.copy(want);
      look.copy(wantLook);
    }

    const baseLag = air ? CAMERA.airLag : CAMERA.lag;
    const followError = air ? CAMERA.maxAirFollowError : CAMERA.maxFollowError;
    // A first-order chase trails steady motion by roughly speed / lag. W has
    // no terminal speed now, so a fixed response would eventually put the
    // camera kilometres behind the rider. The ordinary range keeps its tuned
    // spring; only extreme speed raises the response enough to bound that
    // additional separation.
    const lag = Math.max(baseLag, speed / followError);
    const k = 1 - Math.exp(-lag * dt);
    at.lerp(want, k);
    look.lerp(wantLook, 1 - Math.exp(-(lag + 2) * dt));

    /* Keep a collision-shortened camera aimed at the subject rather than at
       the downhill point chosen for a full-length boom. The smoothstep makes
       both ends of the correction continuous, and the existing look lag
       eases back to normal framing once the obstruction clears. */
    const liveBack = Math.hypot(at.x - rider.pos.x, at.z - rider.pos.z);
    let shortLook = 1 - clamp(
      (liveBack / Math.max(0.001, back) - SHORT_LOOK_FULL)
        / (SHORT_LOOK_START - SHORT_LOOK_FULL),
      0, 1,
    );
    if (shortLook > 0) {
      shortLook = shortLook * shortLook * (3 - 2 * shortLook);
      riderLook.copy(rider.pos);
      riderLook.y += 1.1;
      look.lerp(riderLook, shortLook);
    }

    // --- shake ------------------------------------------------------------
    // Two sources, both earned: the ground chattering under the board at
    // speed, and whatever just hit the rider. Neither happens in the air.
    const chatter = air || rider.state === 'fall'
      ? 0
      : ratio * ratio * CAMERA.shake * (0.5 + 0.5 * rider.carveLoad);
    shake = Math.max(0, shake - dt * 4.5);
    const amp = (chatter + shake) * 0.06;
    seed += dt * 47;
    const sx = Math.sin(seed * 1.7) * Math.sin(seed * 0.53);
    const sy = Math.sin(seed * 2.3 + 1.3) * Math.sin(seed * 0.71);

    camera.position.copy(at);
    camera.position.x += sx * amp;
    camera.position.y += sy * amp;
    camera.lookAt(look);

    /* How much the ground under the board tilts across the frame: the
       surface normal against the camera's own right-hand axis, which for a
       horizontal forward vector f is (-f.z, 0, f.x). One on a vertical wall,
       zero straight down a fall line, and a tenth or so over a mogul — which
       is why the dead zone is there. It is held at zero in the air, where
       `rider.normal` is a memory of the lip rather than a report on the
       ground, and eased at all times so a quarterpipe arrives rather than
       snaps. */
    const tilt = air ? 0 : rider.normal.z * dir.x - rider.normal.x * dir.z;
    const graded = Math.sign(tilt) * Math.max(0, Math.abs(tilt) - BANK_DEAD) / (1 - BANK_DEAD);
    bank += (graded - bank) * (1 - Math.exp(-BANK_RATE * dt));

    // Roll the frame a little into the carve, and a little onto the wall.
    // Small — past about ten degrees it stops reading as lean and starts
    // reading as a broken horizon.
    const wantRoll = -rider.roll * CAMERA.roll
      - clamp(bank * BANK_SHARE, -BANK_MAX, BANK_MAX)
      + sx * amp * 0.06;
    roll += (wantRoll - roll) * (1 - Math.exp(-5 * dt));
    camera.rotateZ(roll);

    // Speed narrows the frame into tunnel vision; the tuck closes it one more
    // step. A long flight opens back out just enough to keep the landing in
    // view, and a hard touchdown still gets its brief lens punch.
    const wantFov = RENDER.fov
      + (RENDER.fovAtSpeed - RENDER.fov) * ratio * ratio
      + tuck * CAMERA.tuckFov
      + (air ? -3 + airT * AIR_FOV : 0);
    fov += (wantFov - fov) * (1 - Math.exp(-3.5 * dt));
    punch *= Math.exp(-CAMERA.landFovDecay * dt);
    if (punch < 0.02) punch = 0;
    /* Terrain or foliage can shorten the horizontal boom. On a portrait
       frame that close view needs a little more vertical room; keep the
       compensation modest and bounded, exactly zero by a near-square aspect,
       so collision response never turns into a second zoom event. */
    const portrait = clamp(
      (SHORT_PORTRAIT_WIDE - camera.aspect) / SHORT_PORTRAIT_RANGE,
      0, 1,
    );
    const shown = Math.min(
      SHORT_PORTRAIT_FOV_MAX,
      fov + punch + shortLook * portrait * SHORT_PORTRAIT_FOV,
    );
    if (Math.abs(camera.fov - shown) > 0.01) {
      camera.fov = shown;
      camera.updateProjectionMatrix();
    }
  }

  function reset() {
    started = false;
    shake = 0;
    fov = RENDER.fov;
    punch = 0;
    roll = 0;
    bank = 0;
    treeBoom = 1;
  }

  return { update, kick, land, reset, get shake() { return shake; } };
}
