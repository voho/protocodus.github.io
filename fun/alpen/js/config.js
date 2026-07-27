/* Alpen — every number the game leans on, in one place.

   Two rules kept this file honest. Distances are metres, times are seconds
   and forces are m/s², so a value can be sanity-checked against the real
   sport before it is tuned against the feel of the game. And gravity is
   the only place the arcade is admitted openly: at 22 m/s² a rider falls
   a little over twice as fast as physics allows, which is what lets a jump
   be tall enough to spin under and short enough to keep the run moving.
   Everything downstream — ramp heights, spin rates, the camera's rise — is
   tuned against that number, so it is the one to move last.

   The rider is simulated as a velocity vector on the slope, not as a speed
   along a heading, so momentum is real: gravity is resolved on the surface
   tangent, the edge holds sideways up to a grip limit and slides past it,
   and a turn taken too fast at the top of the hill costs the speed it was
   carrying. Nothing here clamps the rider's speed — drag does. */

export const RENDER = {
  // The N64 held 240 lines. This holds 288, which is the compromise the
  // whole look rests on: chunky enough that the facets and the dither are
  // the point, fine enough that a tree at ninety metres is a tree. Height
  // is fixed and width follows the viewport, so an ultrawide monitor gets
  // more mountain rather than more pixels.
  height: 288,
  maxWidth: 640,
  // Levels per channel in the final quantise. 32 is five bits — the depth
  // an RGBA5551 framebuffer carried, and the reason those games dithered.
  levels: 32,
  fov: 62,
  fovAtSpeed: 86,     // FOV opens with speed; the run feels faster than it is
  near: 0.5,
  far: 3200,
  // The draw distance is a curtain of haze, and everything is arranged
  // around where it falls: the hill is generated well past it, the peaks
  // are painted to melt into it at their base, and the plane that fills in
  // behind the hill is exactly its colour, so the seam cannot be seen.
  fogNear: 85,
  fogFar: 300,
};

/* The grade, applied in the same pass as the dither. Snow is the hardest
   thing to light well: it is one colour, it fills the screen, and left alone
   it reads as a blank page. So the shadows are pushed towards the sky's blue
   and the highlights towards the sun's amber, which is what the eye expects
   of snow at a low sun and what makes the hill legible at all. */
export const GRADE = {
  shadowTint: '#6f97d8',
  highlightTint: '#fff0d2',
  // Both tints are normalised to luminance 1 before use, so strength moves
  // hue and never brightness. A grade that dims the picture is a bug.
  tintStrength: 0.42,
  contrast: 1.06,
  saturation: 1.10,
  // Enough to close the corners, not enough to notice. Anything past about
  // 0.2 turns a wide screen into a porthole.
  vignette: 0.16,
};

/* The only sky colour anything outside `weather.js` needs: the haze the
   world dissolves into, used as the starting value for the fog and for the
   particle shaders before the first weather tick lands. */
export const SKY = {
  haze: '#dfe7f2',
};

export const TERRAIN = {
  grade: 0.30,        // 16.7° — the low end of a real red run
  // The piste is not a chute. Its centre line wanders on two long sines, so
  // the run arrives somewhere rather than pointing at the same spot forever,
  // and a bend gives the rider a reason to carve that the terrain alone
  // never would. Both amplitudes are small against their wavelengths: the
  // route drifts about seven metres sideways every hundred it descends.
  wander: [
    { freq: 0.0040, amp: 12 },
    { freq: 0.0013, amp: 21 },
  ],
  // The corridor is the groomed part, measured from the wandering centre,
  // and outside it the ground rises into a ridge and then falls away again
  // on the far side. A rider who drifts wide is turned back by the shape of
  // the hill rather than by an invisible wall, and one who commits enough
  // speed to crest the ridge is allowed to — there is real mountain over
  // there, it is just full of trees.
  //
  // The profile is w²·e^(1−w²), which is quadratic near the piste, peaks
  // exactly at `bankWidth`, and decays. A plain quadratic — which is what
  // this was — keeps climbing, and at the far edge of a grid six hundred
  // metres wide that is a wall fifty kilometres high standing where the sky
  // ought to be.
  corridorHalf: 20,
  bankWidth: 95,
  bankHeight: 38,
  // Four octaves of value noise. Each amplitude is held under the grade
  // divided by that octave's own gradient, so no roller is ever steep
  // enough to point the hill back uphill for long.
  ridges: { freq: 0.0032, amp: 7.0, seed: 5 },
  rolls: { freq: 0.009, amp: 3.0, seed: 1 },
  moguls: { freq: 0.050, amp: 0.62, seed: 2 },
  chatter: { freq: 0.160, amp: 0.11, seed: 3 },
  /* The mesh that carries all of it.

     A uniform grid cannot win here. Fine enough to carve moguls out of, it
     needs a quarter of a million vertices to reach the horizon; coarse
     enough to reach the horizon, and the ground under the board is a pair
     of triangles. So the grid is graded: two-metre cells under the rider,
     each ring a few per cent wider than the last, until the far edge is
     most of a kilometre out at fifty metres a cell. Four and a half
     thousand vertices cover the lot, and every cell past three hundred
     metres is solid haze anyway.

     The anchor still snaps to the finest spacing, so the cells nearest the
     rider land on the same lattice every time and the facets stay welded to
     the hill. The far ones shift by two metres a step and crawl very
     slightly — in fog thick enough that it cannot be seen. */
  spacing: 2.0,
  back: 26,           // metres of hill kept behind the rider
  ahead: 760,         // and ahead, well past the curtain
  aheadGrowth: 1.075, // per row
  side: 620,          // half-width at the far edge
  sideGrowth: 1.09,   // per column
};

export const RIDER = {
  gravity: 22,
  // Snow under a waxed base. The number is real; the grade does the rest.
  friction: 0.045,
  brakeFriction: 0.62,
  // Drag is what sets top speed, not a clamp: 6.3 m/s² of slope pull
  // balances at about 40 m/s, or 143 km/h.
  drag: 0.0034,
  // Where drag stiffens beyond v², which is the only ceiling in the game.
  // A big kicker landing converts a lot of height into speed and can
  // overshoot this for a second or two; past it the run is pulled back
  // rather than allowed to keep everything it just found.
  maxSpeed: 50,       // 180 km/h
  // And a floor, so a rider who has stopped in a hollow gets going again
  // instead of sitting there waiting for the grade to do it.
  minSpeed: 6,
  // The tuck. Fold down over the board and the drag nearly halves, but the
  // edge goes soft and the board stops answering quickly — the trade is
  // speed for the ability to change your mind about where you are going.
  // 0.55 gave 200 km/h, which is past the point where a low-poly hill at
  // 288 lines can be read at all. Terminal speed goes as 1/√drag, so this
  // is the number that says "a tuck is worth about twenty-five per cent".
  tuckDrag: 0.68,
  pump: 3.4,          // forward push while tucking, so a flat runs out slower
  tuckTurn: 0.45,     // share of the turn rate left while folded down
  tuckGrip: 0.72,     // and of the grip
  tuckCompress: 0.34, // metres of squat, which the camera rides down with
  // Edge grip, in m/s² of sideways hold. Past it the board washes out and
  // the rider slides — which is where the spray, and the lost speed, are.
  // This one number is most of how the game feels: raise it and the board
  // is on rails, lower it and every turn is a drift.
  grip: 27,
  // A railed carve is nearly free — that is the entire reason the sport
  // prefers it to a skid — so this is small on purpose. At 0.11 it cost
  // 3 m/s², which is half the pull of the whole hill, and a run of linked
  // turns bled to a standstill.
  carveDrag: 0.04,
  slideScrub: 0.9,    // per m/s of slide, per second, which is far more
  turn: 2.4,          // rad/s at a standstill, and the cap at any speed
  // How far past the grip limit the steering is allowed to ask. At 1.0 the
  // board is on rails and never slips; much past 1.3 and every turn is a
  // skid. This narrow band is where the whole handling model lives.
  overCarve: 1.18,
  brakePivot: 2.4,    // and how much of that the brake lifts, to skid on purpose
  // With no steering input the board drifts back in line with where the
  // rider is actually going. Without it a nudge leaves you very slightly
  // sideways forever, which reads as the controls being loose.
  selfCentre: 3.2,
  lean: 0.55,         // radians of visual roll at full carve
  leanRate: 7,        // how fast the body gets there — the weight has mass

  /* Suspension. The rider's legs are a spring, and this is the part that
     makes the hill something you feel rather than something you watch: it
     compresses under the normal force, so a landing, a roller and a hard
     carve each push the camera down and let it back up on their own
     schedule. Critically damped-ish, and deliberately a little slow. */
  springFreq: 3.1,    // Hz
  springDamp: 0.75,
  compressPerG: 0.16, // metres of travel per g of normal load
  compressMax: 0.62,
  // How hard the rider can land before the legs stop absorbing it. Beyond
  // it the landing is judged harshly; well beyond it, it is a fall.
  softImpact: 9,      // m/s into the slope
  hardImpact: 26,
  // Ollie: held to charge, released to pop. Capped so mashing it is not a
  // strategy — the ramps are where the height is.
  chargeTime: 0.45,
  popMin: 4.5,
  popMax: 9.5,
  // Air control. A 540 wants to fit inside a big ramp's hang time, so the
  // spin rate is set from it: 7.5 rad/s over 1.3 s is 558°.
  spinRate: 7.5,
  spinRamp: 3.2,      // rad/s² — the spin winds up rather than snapping on
  flipRate: 6.2,
  airSteer: 2.6,      // m/s² of drift, for picking a landing line
  // Landing. Anything inside the window snaps straight; anything outside
  // is a bail. Switch is the same window rotated half a turn.
  landWindow: 0.92,   // radians ≈ 53°
  landPitchWindow: 0.85,
  // How far off the ground the rider's ballistic path has to be, ninety
  // milliseconds out, before the hill counts as having dropped away.
  // Roughly a boot's depth: enough to ignore the chatter octave, little
  // enough that the crest of a roller still floats.
  launchGap: 0.12,
  // A hop small enough not to count: below this the landing is never
  // judged, so chattering over moguls can never end a combo.
  minJudgedAir: 0.34,
  radius: 0.55,
  height: 1.75,
  // Falling over is the only failure state, and it is temporary — the run
  // never ends, the rider just gets up.
  fallTime: 1.35,
  riseTime: 0.55,
  fallSpeed: 0.28,    // share of speed kept through a fall
};

export const SCORE = {
  perDegree: 1.0,
  perFlip: 500,
  grabPerSecond: 260,
  airPerSecond: 70,
  switchBonus: 1.5,
  comboStep: 1,       // multiplier gained per clean landing
  comboMax: 12,
  // Below this a landing is just a landing: no banner, no combo, no points.
  minTrickScore: 60,
  nearMiss: 40,       // for threading a tree, a bear, or a bolting rabbit
  nearMissRange: 2.4,
};

export const PROPS = {
  band: 40,           // metres of hill filled at a time
  ahead: 9,           // bands kept in front of the rider
  behind: 2,
  // Density climbs with distance, which is most of the difficulty curve.
  // Speed takes care of the rest.
  treesPerBand: 17,
  shrubsPerBand: 9,
  innerTreesAt: 400,  // metres before trees start appearing on the piste
  innerTreesMax: 3,
  rocksPerBand: 2,
  gateChance: 0.35,
  rampChance: 0.62,
  ramp: { length: 11, halfWidth: 2.8, height: 2.0 },
  maxRamps: 5,
  clearLane: 8,       // no hard obstacle closer than this to the centre line
  // Shrubs do not put a rider down. They cost speed and throw powder, which
  // is punishment enough for a bush.
  shrubDrag: 0.42,
};

export const WILDLIFE = {
  // Rabbits are scenery that reacts. They sit, they twitch, and when the
  // rider gets close they bolt — which is the only reason to notice them,
  // and worth a few points for threading one.
  rabbits: 14,
  rabbitSpawnRange: [30, 150],
  rabbitFlee: 15,
  rabbitSpeed: 9.5,
  rabbitHop: 6.2,     // hops per second, and the height comes from it
  // Bears do not move out of the way. They are rare, they are slow, and
  // they are the one thing on the hill that will put a rider down at speed.
  bears: 3,
  bearFrom: 500,      // metres before the first one appears
  bearSpawnRange: [110, 220],
  bearSpeed: 2.4,
  bearRadius: 1.5,
};

export const CAMERA = {
  // A lagging camera sits further back than its nominal distance by roughly
  // speed/lag — at 25 m/s and a lag of 6.5 that is another four metres, and
  // the rider ends up too small to read a landing off. These three numbers
  // are chosen together: close, and followed tightly enough to stay close.
  distance: 6.2,
  height: 2.9,
  airHeight: 4.0,
  lookAhead: 9.0,
  lag: 9.0,           // higher follows tighter
  airLag: 4.2,
  roll: 0.18,         // share of the rider's carve the camera takes on
  shake: 0.55,
  // Speed opens the frame; the tuck closes it again. Doing both at once is
  // the point — a tucked rider is going faster than they have ever gone and
  // seeing less of the mountain while they do it.
  tuckFov: -13,
  tuckDrop: 0.75,     // and the camera drops in behind the rider's shoulder
  tuckPull: -1.1,
  // How far the camera sits behind where the rider is *going* rather than
  // where the board is pointing. A sliding rider should see their own edge.
  velocityBias: 0.72,
};

export const SNOW = {
  count: 800,
  box: 48,            // the cube of falling snow that travels with the camera
  fall: 3.4,
  size: 0.17,
  // Spray off the edge. This is the single biggest speed cue the game has —
  // more than the FOV, more than the camera shake — because it is the only
  // thing on screen whose amount is a direct read of how hard the board is
  // working.
  sprayCount: 520,
  spraySize: 0.26,
  sprayLife: 0.95,
};

/* Streaks: short white lines that whip past the camera once the run is
   genuinely quick. They cost almost nothing, they only ever appear above a
   speed the rider had to earn, and they are what turns fast into *fast*. */
export const STREAKS = {
  count: 150,
  from: 26,           // m/s before any appear
  full: 44,           // and where the field is at its thickest
  length: 0.11,       // share of a streak's own velocity, per unit speed
  radius: 13,
  ahead: 22,
};
