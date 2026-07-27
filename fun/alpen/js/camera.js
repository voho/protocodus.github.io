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

export function createChaseCamera(THREE, camera) {
  const at = new THREE.Vector3();
  const look = new THREE.Vector3();
  const want = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const flat = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  let started = false;
  let shake = 0;
  let fov = RENDER.fov;
  let punch = 0;
  let roll = 0;
  let bank = 0;
  let seed = 0;

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
    flat.set(rider.vel.x, 0, rider.vel.z);
    if (flat.lengthSq() < 9) flat.set(Math.sin(rider.yaw), 0, -Math.cos(rider.yaw));
    flat.normalize();
    tmp.set(Math.sin(rider.yaw), 0, -Math.cos(rider.yaw));
    dir.copy(flat).multiplyScalar(CAMERA.velocityBias)
      .addScaledVector(tmp, 1 - CAMERA.velocityBias).normalize();

    const back = CAMERA.distance + ratio * 1.6 + tuck * CAMERA.tuckPull + airT * AIR_PULL;
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
    const floor = world.height(want.x, want.z) + FLOOR;
    if (want.y < floor) want.y = floor;

    // …and never let a tree. Ride into the forest and the chase position
    // lands inside a trunk, which fills the screen with the inside of a cone
    // at exactly the moment the player most needs to see what happened.
    //
    // The whole segment is walked, not just its far end: a camera sitting in
    // clear air with a trunk halfway between it and the rider is the case
    // that actually hides the rider, and testing only the endpoint misses it
    // entirely. Six samples, and each one early-rejects almost every solid
    // on its z, so the sightline costs about as much as the endpoint did.
    if (world.blocked) {
      let clear = 1;
      for (let t = 0.34; t <= 1.001; t += 0.14) {
        const cx = rider.pos.x + (want.x - rider.pos.x) * t;
        const cz = rider.pos.z + (want.z - rider.pos.z) * t;
        /* Three metres, not one.

           The collision radius of a tree is its *trunk* — that is the only
           part the rider can hit — but the part that fills the screen is the
           foliage, and on these grown conifers the branches reach three or
           four metres out from a trunk barely a metre wide. Testing the
           sightline at the trunk's radius therefore let the camera settle
           neatly between two trunks and entirely inside a canopy, which is
           the failure this whole test exists to prevent: the frame fills with
           the inside of a spruce at exactly the moment the player most needs
           to see what is happening to them. */
        if (world.blocked(cx, cz, 3.0)) {
          clear = Math.max(0.3, t - 0.14);
          break;
        }
      }
      if (clear < 1) {
        want.x = rider.pos.x + (want.x - rider.pos.x) * clear;
        want.z = rider.pos.z + (want.z - rider.pos.z) * clear;
        want.y = Math.max(want.y, world.height(want.x, want.z) + FLOOR);
      }
    }

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

    const lag = air ? CAMERA.airLag : CAMERA.lag;
    const k = 1 - Math.exp(-lag * dt);
    at.lerp(want, k);
    look.lerp(wantLook, 1 - Math.exp(-(lag + 2) * dt));

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

    // Speed opens the frame; the tuck closes it again. The air term starts
    // tight — a pop is a compression — and opens back out over a long flight,
    // which is the other half of being able to see the landing.
    const wantFov = RENDER.fov
      + (RENDER.fovAtSpeed - RENDER.fov) * ratio * ratio
      + tuck * CAMERA.tuckFov
      + (air ? -3 + airT * AIR_FOV : 0);
    fov += (wantFov - fov) * (1 - Math.exp(-3.5 * dt));
    punch *= Math.exp(-CAMERA.landFovDecay * dt);
    if (punch < 0.02) punch = 0;
    const shown = fov + punch;
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
  }

  return { update, kick, land, reset, get shake() { return shake; } };
}
