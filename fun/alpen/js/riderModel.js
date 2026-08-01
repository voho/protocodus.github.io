/* The rider, as something to look at.

   This used to be one baked geometry — board, body, arms and head welded
   into a single buffer by `compose` — because the game rendered into a
   240-pixel framebuffer and a rider that small cannot show you an elbow. The
   framebuffer is gone: the run renders at the window's own resolution now,
   there is exactly one rider on the mountain, and everything he is made of
   casts a real shadow onto the snow. So he is a rig — a tree of Groups, one
   composed geometry per rigid segment, the articulation living entirely in
   the transforms — and the forms themselves are lofted rather than stacked.

   Four decisions shape the rest.

   **The feet are constrained by targets, not authored joint angles.** During
   normal riding those targets are the two bindings, which is the whole
   difference between snowboarding and standing on a hill: the hips move and
   two-bone IK finds the knees. At walking pace the physical rear boot is the
   one exception. It leaves its empty binding, plants beside the board and
   drives tailward before returning; the same target carries both the boot
   mesh and the leg solver, so there can be no phantom foot left behind or
   ankle detached from the boot. The ceiling on the hips is solved per leg
   from the actual target, including that moving push foot.

   **A pose is a point, not a set of angles.** Every arm pose is a place the
   hand wants to be, so blending the riding pose into a grab is a lerp between
   two points with the IK picking up the pieces. Blending quaternion poses
   pops the instant two of them disagree about which way the elbow goes;
   blending destinations cannot, and it also means the grab can be aimed at
   the board's edge and *arrive* there rather than nearly.

   **A stance is a constant, not a reaction.** This is the thing the rig got
   wrong for longest, and it was wrong precisely because everything else here
   is so carefully driven by the physics. Riding a straight line at speed the
   mountain has nothing to say: the leg spring is carrying exactly one g, the
   edge is flat, there is no steer and no wash — so every signal in this file
   was zero, and what zero drew was a man standing bolt upright with fifty
   degrees of knee in him and his arms held out along the board. Seen from
   behind, which is where the camera lives, arms spread along a board are arms
   spread sideways, and the whole figure read as somebody being electrocuted.

   None of how a person stands on a snowboard is a reaction to anything. The
   knees are bent to about eighty degrees before the hill does a thing, the
   hips are low and behind the chest, the upper body hinges forward over the
   leading foot, and the arms hang. All four are now paid for as constants —
   `crouch`, `hipsBack`, `chestFwd` and a pair of hand targets a hand's width
   from straight down — and every reaction in the file moves *away* from that
   pose instead of away from a mannequin. A tuck is the same rider standing
   lower; a landing is the same rider folding; only a grab and a fall take the
   stance away entirely, because both of them are somewhere it has no opinion.

   The same argument fixed the three moments the spring could not draw. A
   landing, a pop and a flight are events, and the spring's own travel is a
   terrible witness to all three: measured, a twelve-metre-a-second touchdown
   bought eight centimetres of hip and gave it straight back, and airborne the
   spring *stretches*, which straightened the legs of a rider who was in the
   air with his feet strapped to a board. They are drawn from the rate the
   spring moved at rather than from where it ended up — `thump`, `pop` and
   `air`, each on its own decay — and the knees now fold on a landing, extend
   on an ollie, and come up under him for the whole of a flight.

   **The stance is fixed, and a turn is not a swivel.** He rides regular —
   one foot permanently over the nose, hips and shoulders lined up along the
   board — and the only thing that ever changes that is landing switch, which
   the physics reports and which mirrors the stance rather than substituting a
   different rider. A turn is steered from the back foot: the rear knee drives
   in and forward, the rear hip rotates under him, the shoulders counter
   against it, and the lead leg stays comparatively still. That contrast is
   the whole read. It is driven from `rider.edge`, weighted by `carveLoad`,
   because the board only lies over as far as the snow is holding it up — the
   raw edge angle at walking pace is sixty-six degrees, which is a man
   standing a board on its side in a car park, not a carve.

   **Left and right are meaningless on a board**, so nothing here is called
   left or right: a limb is `lead` if it is over the nose and `rear` if it is
   over the tail. Riding switch does not rename them — the boots have not
   moved — it flips which of them is at the *back of the travel*, and that is
   the one that steers. Every pose that has a front and a back is therefore
   written in the travel frame and multiplied into board space by `sw`, which
   is +1 riding forward, −1 riding switch, and passes smoothly through zero
   in the fifth of a second after a switch landing.

   THE HEADING WAS MIRRORED, and this is the one thing in the file that was
   not a matter of taste. The physics yaw is a compass angle: heading is
   (sin y, 0, −cos y), which is `R_y(−yaw)` applied to the nose. This file
   applied `R_y(+yaw)`, so the board pointed at the *reflection* of the
   direction of travel across the course axis. Straight down the fall line
   the error is nothing, which is why it survived; measured in a real carve
   the board was ninety degrees off its own velocity, and at the end of a hard
   turn it was pointing backwards while the rider kept moving. Everything
   downstream of that — the shoulders' counter-rotation, the hip shift, the
   head tilt, the lean itself — was authored against the mirror and so is
   sign-flipped here too. The rider now leans into the turn he is actually
   making, and the spray comes off the edge he is actually on.

   The orientation is composed rather than eulered: the board is stood up on
   the surface normal first, then turned, then flipped, then rolled. In that
   order a flip is always about the board's own lateral axis and a carve
   always about its length, whatever the hill underneath is doing. The roll
   applied there is the *body's* inclination; the board's own edge angle is
   applied to the board on top of it, about the edge that is buried rather
   than about the centreline, so that laying it over lifts the deck off the
   snow instead of burying half of it. The difference between those two
   angles is angulation, and it is now measured rather than guessed at.

   Everything is smoothed with an exponential approach against dt. There is
   not one fixed per-frame lerp constant in the file, because a pose that
   settles in a different number of seconds on a 144 Hz screen than on a
   60 Hz one is a bug that only some people can see. */

import { compose } from './geom.js';
import { RIDER } from './config.js';
import { createHeadlamp } from './headlamp.js';

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
const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
const smooth01 = (v) => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};

/* --------------------------------------------------------------------------
   The skeleton, in metres, in board space: +X is the toe edge and the way the
   chest faces, -Z is the nose, y = 0 is the snow under the buried edge.

   These are not free numbers. The boots put the ankles at a third of a metre
   off the snow before the legs even start, so a rider standing "tall" on a
   board still has fifty degrees of knee in him — which is why he reads as a
   snowboarder standing still rather than a man standing on a plank.
   -------------------------------------------------------------------------- */
const ANKLE_Y = 0.33;    // where the boot's cuff ends and the shin begins
const FOOT_Z = 0.245;    // the bindings, and therefore the feet, live here
const FOOT_X = 0.015;

/* Half the effective edge, which is where the board is standing on the snow:
   the mean of the two widest stations in `DECK`, at z = −0.470 and +0.450.
   The flex is written as a bow that is exactly zero here, so it can never move
   the contact patch the physics has already put the rider on top of. */
const FLEX_SPAN = 0.46;

/* How far the board bows, in metres, and what bends it.

   The scale to hold in mind is the camber the deck is built with, which is
   eight millimetres. A real board under a committed rider does not merely
   flatten that, it reverses it — so the numbers below are allowed to reach
   about three times the camber and no further, because past that a snowboard
   stops looking like a spring and starts looking like a banana.

   `press` is the new one and it is the whole reason this is worth doing now:
   `rider.bend` is how hard the ground's own curvature is driving the board
   into the snow, so the board visibly bows through every compression and
   visibly relaxes over every crest. It is the same number the legs, the grip
   and the camera are already reading, which means the board flexing and the
   rider squatting and the frame dipping are three views of one event rather
   than three animations that happen to coincide. */
const FLEX = {
  edge: 0.013,     // metres of reverse camber at full load on a buried edge
  press: 0.009,    // …and per g of terrain load
  pop: 0.020,      // the snap out of an ollie, which goes the other way
  thump: 0.017,    // and the bow a landing drives through it
  min: -0.030,
  max: 0.022,
};
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

const DECK_TOP = 0.076;  // where the bindings bolt on, over the waist
const HALF_WIDTH = 0.155;   // the widest the board gets, at the contact points

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
  stance: 0.34,       // radians the chest is opened towards the travelling nose
  look: 1.04,         // and how much further the head turns, to the fall line
  counter: 0.62,      // radians the shoulders wind back against a full steer
  spinTrail: 0.55,    // radians the shoulders trail a full-rate spin
  armTrail: 0.6,      // and radians the hands trail it, further still
  angulate: 0.34,     // share of the body's lean the torso stands back up
  // Metres of hip travel per metre of leg-spring travel. It came down from
  // 1.15 when the stance below arrived: the two of them stack, and a full-grip
  // carve at the old ratio folded the knee a hundred and thirty degrees, which
  // is not a carve, it is a man sitting down on a moving board.
  hipPerSquat: 0.95,
  hipPerStretch: 0.42,
  hipFold: 0.24,      // closest the hips are ever allowed to get to the boots
  hipShift: 0.11,     // and how far they move across the board into a carve

  /* The stance, which is the pose everything else is a deviation from and
     the one that was wrong.

     Riding a straight line, the leg spring is carrying exactly one g and so
     it has nothing to say; the hips therefore sat at their nominal height,
     which put fifty degrees of bend in the knee, and fifty degrees of knee on
     a figure this size is a man standing up. Photograph any snowboarder
     holding a line and the knee is nearer ninety: the hips are low, they are
     *behind* the chest, and the shoulders are a little ahead of the board.
     None of that is a reaction to anything the mountain is doing, which is
     why none of it was here — it is simply how somebody stands on a board,
     and it has to be paid for as a constant.

     `crouch` is the whole of the height difference. `chestFwd` hinges the
     upper body over the leading foot and `hipsBack` moves the pelvis the
     other way to pay for it, so the centre of mass stays over the board
     rather than the rider being tipped forward off it — a hinge, not a lean.
     `chestSide` is the smaller half of the same idea across the board, and
     it is what turns a square chest into a rider looking where he is going.

     The arms follow from the same photograph. They were held out along the
     board with barely a third of a metre of drop on a 0.58 m arm, which is
     a man holding his arms out; now they hang, with the leading one reaching
     a little towards the nose and the trailing one nearly straight down. */
  crouch: 0.115,      // metres the hips ride below standing, always, on snow
  chestFwd: 0.15,     // radians the upper body hinges over the leading foot
  chestSide: 0.08,    // and towards the toe edge, which is where he is looking
  hipsBack: 0.045,    // metres the pelvis sits back to pay for the hinge

  /* Low-speed skating. The rear boot clears the toe edge, plants just ahead
     of the rear binding, drives tailward and lifts home. Body offsets keep
     the centre of mass over the strapped front foot throughout the stroke. */
  pushSide: 0.32,
  pushReach: 0.14,
  pushDrive: 0.43,
  pushLift: 0.11,
  pushHipSide: 0.045,
  pushHipFront: 0.085,
  pushDrop: 0.045,
  pushHinge: 0.13,

  /* Steering, which is the whole point of the rig.

     `hipSteer` is the pelvis: the back foot pushes the tail out and the hip
     over it goes with it. `counter` above then winds the shoulders the other
     way, and because the torso hangs off the pelvis the two are subtracted
     rather than added — the shoulders end up on the far side of a pelvis that
     has already turned, which is what counter-rotation actually is.

     `kneeIn` and `kneeFwd` steer the knee, through the IK pole rather than
     through an angle: the rear knee drives across towards the toe edge and
     forwards over the nose on a toeside turn, and pulls back and away on a
     heelside one. `quiet` is how much of all of this the *lead* leg is
     allowed — not zero, because a frozen leg reads as a broken rig, but
     little enough that the eye reads one leg working and one leg riding. */
  hipSteer: 0.34,
  kneeIn: 0.55,
  kneeFwd: 1.05,
  hipDrive: 0.075,    // metres the driving hip socket retreats from the knee
  hipSink: 0.05,      // and rises onto the toes, or sits back onto the heels
  weightBack: 0.09,   // metres the steering hip loads back over its own foot
  quiet: 0.2,
  edgeShow: 0.9,      // the most the board is ever laid over, in radians

  // A board tuck is knees, not spine — so the hips drop further than they did
  // and the chest folds a lot less. The two together are the same silhouette
  // height and a completely different rider.
  tuckDrop: 0.22,
  fallDrop: 0.30,
  chatter: 0.007,     // metres of buzz through the legs at speed

  /* The three events, which the leg spring on its own cannot draw.

     A landing is the loudest thing that happens to this rider and the spring
     barely moves for it: at 0.75 of critical damping and a rest length the
     compression is being pulled back to, a twelve-metre-a-second touchdown
     bought eight centimetres of hip and gave it back inside a fifth of a
     second. Eight centimetres is not a landing; measured off the screen the
     legs went from forty-nine degrees of bend to fifty-six, which is nothing
     anyone can see. So the collapse is drawn from `thump` — the *rate* the
     spring came down at, which is an event with its own decay — rather than
     from where the spring ended up, and the same argument in reverse gives
     the pop its extension.

     `airTuck` is the third, and it is the one that had the sign wrong.
     Airborne, the physics stretches the spring to −0.12, which through
     `hipPerStretch` *raised* the hips and left him hanging off the board with
     twenty degrees of knee in him — legs straight, in the air, which is the
     one place no snowboarder ever has them. The feet are strapped on, so
     pulling the knees up and dropping the hips towards the deck are the same
     movement seen from two ends, and the hips are the end this rig can move
     without lying to the shadow about where the board is. */
  thumpDrop: 0.26,    // metres a landing folds him, on the thump's own clock
  popRise: 0.09,      // and how far the pop stands him up out of the stance
  airTuck: 0.29,      // metres the knees come up once he is off the snow
  chargeBack: 0.05,   // metres the weight sits back over the tail to coil

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
   The shape kit

   Everything below is lofted from tables. That is a change of method, and it
   is the shadows that forced it: a flat-shaded box is a perfectly good torso
   until the sun puts its silhouette on the snow beside it, and then it is
   obviously a box. A loft costs nothing at runtime — it is baked once into a
   composed buffer like everything else — and it buys the two things the
   shadow gives away, which are a rounded shoulder and an outline that is not
   a rectangle.

   The ring count is deliberately generous now. Rounded clothing, limbs and
   helmet pieces use smooth shared normals, while caps keep duplicate vertices
   so seams such as the edge of the snowboard stay crisp.
   ========================================================================== */

/* A ring, as a superellipse: `round` = 1 is an ellipse, and below that it
   creeps towards a rectangle with bevelled corners. One knob covers a
   snowboard's cross-section (0.4, nearly a rectangle), a jacket (0.6), a
   sleeve (0.85) and a helmet (1). */
const oval = (n, rx, ry, round = 1) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([
      rx * Math.sign(c) * Math.abs(c) ** round,
      ry * Math.sign(s) * Math.abs(s) ** round,
    ]);
  }
  return pts;
};

const ringXZ = (pts, y, cx = 0, cz = 0) => pts.map(([x, z]) => [cx + x, y, cz + z]);
const ringXY = (pts, z, cx = 0, cy = 0) => pts.map(([x, y]) => [cx + x, cy + y, z]);

/* Join a stack of rings into a solid.

   The one interesting line is the winding test. Getting a triangle's winding
   wrong on a single-sided material does not produce a wrong-looking face, it
   produces *no* face — and a hole in a lofted limb is a bug you find by
   flying the camera through the rider. So rather than reasoning about which
   way round each ring runs, every triangle is emitted with its normal checked
   against a point known to be inside the solid, and flipped if it is facing
   the wrong way. It costs three dot products at build time and it makes the
   ring tables free to be written in whatever order reads best. */
function loft(THREE, rings, capStart = true, capEnd = true) {
  const positions = [];
  const indices = [];
  const mid = (r) => {
    const c = [0, 0, 0];
    for (const p of r) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    return [c[0] / r.length, c[1] / r.length, c[2] / r.length];
  };
  const cs = rings.map(mid);

  for (const ring of rings) {
    for (const p of ring) positions.push(...p);
  }

  const face = (ia, ib, ic, a, b, c, inside) => {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const ox = (a[0] + b[0] + c[0]) / 3 - inside[0];
    const oy = (a[1] + b[1] + c[1]) / 3 - inside[1];
    const oz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    if (nx * ox + ny * oy + nz * oz < 0) indices.push(ia, ic, ib);
    else indices.push(ia, ib, ic);
  };

  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    const inside = [
      (cs[i][0] + cs[i + 1][0]) / 2,
      (cs[i][1] + cs[i + 1][1]) / 2,
      (cs[i][2] + cs[i + 1][2]) / 2,
    ];
    for (let j = 0; j < A.length; j++) {
      const k = (j + 1) % A.length;
      const a = i * A.length + j;
      const ak = i * A.length + k;
      const b = (i + 1) * A.length + j;
      const bk = (i + 1) * A.length + k;
      face(a, ak, bk, A[j], A[k], B[k], inside);
      face(a, bk, b, A[j], B[k], B[j], inside);
    }
  }
  // Caps use their own rim vertices. Sharing those with the side would round
  // a board edge or sleeve cuff when the vertex normals are averaged.
  const cap = (r, inside, c) => {
    const center = positions.length / 3;
    positions.push(...c);
    const rim = [];
    for (const p of r) {
      rim.push(positions.length / 3);
      positions.push(...p);
    }
    for (let j = 0; j < r.length; j++) {
      const k = (j + 1) % r.length;
      face(center, rim[j], rim[k], c, r[j], r[k], inside);
    }
  };
  const n = rings.length;
  if (capStart && n > 1) cap(rings[0], cs[1], cs[0]);
  if (capEnd && n > 1) cap(rings[n - 1], cs[n - 2], cs[n - 1]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// A stack of rings up the Y axis: limbs, torso, boots, helmet.
const tube = (THREE, list) => loft(THREE, list.map((s) => ringXZ(
  oval(s.n || 16, s.rx, s.rz === undefined ? s.rx : s.rz, s.round),
  s.y, s.x || 0, s.z || 0,
)));

/* A band bent round the Y axis — the goggle lens and its strap, which are the
   two things on the rider that have to follow a curve rather than sit on a
   flat face. A flat box visor was readable and looked like a stamp. */
const arc = (THREE, o) => {
  const rings = [];
  for (let i = 0; i <= o.steps; i++) {
    const a = o.a0 + (o.a1 - o.a0) * (i / o.steps);
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const pts = oval(o.n || 12, o.depth, o.height, o.round === undefined ? 0.6 : o.round);
    rings.push(pts.map(([u, v]) => [
      cx * (o.r + u), o.y + v, cz * (o.r + u),
    ]));
  }
  return loft(THREE, rings);
};

/* ==========================================================================
   Geometry — one composed buffer per rigid segment
   ========================================================================== */

/* The board, as eleven stations from nose to tail.

   Four numbers each: where along the board, how wide, how high the deck sits
   and how thick it is there. Everything a board looks like is in this table —
   the taper into the tips, the sidecut pulling the waist in between the feet,
   eight millimetres of camber under the middle, and the rocker lifting both
   ends clear of the snow. The old board was three tilted boxes and read as a
   plank with the corners cut off; the shadow of it read as three tilted
   boxes, which is what forced the issue. */
const DECK = [
  { z: -0.800, rx: 0.048, y: 0.150, ry: 0.010 },
  { z: -0.715, rx: 0.100, y: 0.119, ry: 0.014 },
  { z: -0.605, rx: 0.140, y: 0.087, ry: 0.018 },
  { z: -0.470, rx: 0.155, y: 0.062, ry: 0.021 },
  { z: -0.250, rx: 0.142, y: 0.052, ry: 0.023 },
  { z: 0.000, rx: 0.131, y: 0.059, ry: 0.024 },
  { z: 0.250, rx: 0.142, y: 0.052, ry: 0.023 },
  { z: 0.450, rx: 0.154, y: 0.062, ry: 0.021 },
  { z: 0.600, rx: 0.138, y: 0.088, ry: 0.018 },
  { z: 0.705, rx: 0.098, y: 0.120, ry: 0.014 },
  { z: 0.780, rx: 0.046, y: 0.148, ry: 0.010 },
];

/* The boot, in its own frame: +X is the toes, the origin is under the ankle
   and level with the deck. Six stations, because a boot is a cone with a
   heel: it is wide and long at the sole, narrows through the instep, and
   finishes as a round cuff leaning back over the highback. */
const BOOT = [
  { y: 0.005, x: 0.042, rx: 0.150, rz: 0.098, round: 0.45 },
  { y: 0.050, x: 0.044, rx: 0.152, rz: 0.100, round: 0.5 },
  { y: 0.110, x: 0.030, rx: 0.140, rz: 0.098, round: 0.55 },
  { y: 0.175, x: 0.008, rx: 0.115, rz: 0.094, round: 0.7 },
  { y: 0.240, x: 0.000, rx: 0.100, rz: 0.090, round: 0.85 },
  { y: 0.272, x: 0.000, rx: 0.094, rz: 0.086, round: 0.9 },
];

function buildGeometries(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const scrap = [];
  const use = (g) => { scrap.push(g); return g; };

  const deckRings = (i0, i1, ws, ts, dy) => DECK.slice(i0, i1).map((s) => ringXY(
    oval(20, s.rx * ws, s.ry * ts, 0.4), s.z, 0, s.y + dy,
  ));
  // A sticker: a thin slab following the deck's own curve, on the top or the
  // bottom face. It is how the board gets more than one colour without the
  // deck becoming four separate solids that have to agree along a seam.
  const sticker = (i0, i1, half, side, thick) => DECK.slice(i0, i1).map((s) => ringXY(
    oval(12, half, thick, 0.35), s.z, 0, s.y + side * (s.ry + thick * 0.6),
  ));
  const rail = (i0, i1, sign) => DECK.slice(i0, i1).map((s) => ringXY(
    oval(12, 0.011, 0.013, 0.35), s.z, sign * (s.rx - 0.006), s.y - s.ry + 0.008,
  ));

  /* One binding: baseplate, highback and straps remain bolted to the board.
     The front boot stays baked into its binding; the physical rear boot is a
     separate rigid mesh because it has to leave this hardware while skating. */
  const bootShell = use(tube(THREE, BOOT));
  const bootSole = use(tube(THREE, [
    { y: 0.000, x: 0.040, rx: 0.156, rz: 0.104, round: 0.35 },
    { y: 0.022, x: 0.042, rx: 0.152, rz: 0.101, round: 0.4 },
  ]));
  const highback = use(tube(THREE, [
    { y: 0.020, x: -0.108, rx: 0.026, rz: 0.088, round: 0.8, n: 12 },
    { y: 0.120, x: -0.104, rx: 0.024, rz: 0.086, round: 0.8, n: 12 },
    { y: 0.230, x: -0.092, rx: 0.022, rz: 0.080, round: 0.85, n: 12 },
    { y: 0.320, x: -0.074, rx: 0.020, rz: 0.068, round: 0.9, n: 12 },
  ]));
  const plate = use(tube(THREE, [
    { y: -0.004, rx: 0.150, rz: 0.112, round: 0.45 },
    { y: 0.028, x: 0.010, rx: 0.146, rz: 0.108, round: 0.5 },
  ]));

  const binding = (z, yaw) => [
    { geo: plate, color: INK, pos: [0, DECK_TOP - 0.01, z], rot: [0, yaw, 0] },
    { geo: highback, color: INK, pos: [FOOT_X, DECK_TOP + 0.02, z], rot: [0, yaw, 0] },
    // the two straps, which are the only part of a binding anybody ever
    // notices, and the only reason a boot reads as strapped down at all
    {
      geo: box, color: YELLOW, pos: [FOOT_X + 0.008, DECK_TOP + 0.20, z],
      rot: [0, yaw, 0.12], scale: [0.10, 0.052, 0.205],
    },
    {
      geo: box, color: YELLOW, pos: [FOOT_X + 0.105, DECK_TOP + 0.075, z],
      rot: [0, yaw, -0.35], scale: [0.075, 0.042, 0.195],
    },
    {
      geo: box, color: MINT, pos: [FOOT_X - 0.062, DECK_TOP + 0.30, z],
      rot: [0, yaw, 0], scale: [0.028, 0.05, 0.115],
    },
  ];

  const boot = (z, yaw) => [
    { geo: bootSole, color: INK, pos: [FOOT_X, DECK_TOP + 0.012, z], rot: [0, yaw, 0] },
    { geo: bootShell, color: INK, pos: [FOOT_X, DECK_TOP + 0.02, z], rot: [0, yaw, 0] },
  ];

  const board = compose(THREE, [
    { geo: use(loft(THREE, deckRings(0, 11, 1, 1, 0))), color: YELLOW },
    // a broader mint nose cap and a clipped dark tail: direction has to be
    // legible through spray, at night, and in the middle of a spin
    { geo: use(loft(THREE, deckRings(0, 3, 1.05, 1.18, 0))), color: MINT },
    { geo: use(loft(THREE, deckRings(8, 11, 1.05, 1.18, 0))), color: INK },
    // the topsheet graphic, and the stripe down the base so a spin still
    // reads from underneath
    { geo: use(loft(THREE, sticker(1, 10, 0.058, 1, 0.005))), color: INK },
    { geo: use(loft(THREE, sticker(2, 9, 0.044, -1, 0.004))), color: MINT },
    // steel edges, which also stop the deck reading as a slab of butter, and
    // which now follow the sidecut rather than being two straight sticks
    { geo: use(loft(THREE, rail(1, 10, -1))), color: INK },
    { geo: use(loft(THREE, rail(1, 10, 1))), color: INK },
    // The feet are angled forward off the perpendicular, more at the front
    // than the back, because a duck-square stance is the one thing no
    // snowboarder rides.
    ...binding(-FOOT_Z, 0.28),
    ...boot(-FOOT_Z, 0.28),
    ...binding(FOOT_Z, 0.10),
  ]);
  const rearBoot = compose(THREE, boot(0, 0.10));

  /* The torso: wide across Z and shallow across X, because the shoulder line
     runs nose to tail and that is the single most snowboard-shaped thing
     about him. The jacket has a waist and a hem now — it pulls in above the
     seat and flares back out at the chest — which is most of the difference
     between a jacket and a crate. */
  const torso = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: -0.155, rx: 0.112, rz: 0.146, round: 0.55 },
      { y: -0.090, rx: 0.130, rz: 0.168, round: 0.55 },
      { y: -0.020, rx: 0.132, rz: 0.172, round: 0.6 },
    ])), color: DENIM },
    { geo: use(tube(THREE, [
      { y: -0.075, rx: 0.142, rz: 0.181, round: 0.6 },
      { y: 0.020, rx: 0.134, rz: 0.175, round: 0.6 },
      { y: 0.130, rx: 0.142, rz: 0.192, round: 0.62 },
      { y: 0.250, rx: 0.150, rz: 0.209, round: 0.65 },
      { y: 0.355, rx: 0.146, rz: 0.212, round: 0.7 },
      { y: 0.425, rx: 0.126, rz: 0.186, round: 0.8 },
    ])), color: SHELL },
    // the powder skirt at the hem and the yoke across the shoulders, both a
    // shade down, so the jacket has a top and a bottom in one glance
    { geo: use(tube(THREE, [
      { y: -0.095, rx: 0.146, rz: 0.186, round: 0.6 },
      { y: -0.040, rx: 0.144, rz: 0.184, round: 0.6 },
    ])), color: SHELL_DARK },
    { geo: use(tube(THREE, [
      { y: 0.330, rx: 0.150, rz: 0.216, round: 0.68 },
      { y: 0.412, rx: 0.132, rz: 0.192, round: 0.78 },
    ])), color: SHELL_DARK },
    { geo: use(tube(THREE, [
      { y: 0.055, rx: 0.140, rz: 0.181, round: 0.6 },
      { y: 0.098, rx: 0.141, rz: 0.182, round: 0.6 },
    ])), color: MINT },
    // the collar, which is where the mint belongs and where it reads from
    // behind at any distance
    { geo: use(tube(THREE, [
      { y: 0.420, rx: 0.112, rz: 0.150, round: 0.8 },
      { y: 0.487, rx: 0.098, rz: 0.118, round: 0.9 },
    ])), color: MINT },
    // rounded shoulders, which is the whole reason any of this is lofted
    { geo: use(tube(THREE, [
      { y: 0.300, rx: 0.086, rz: 0.070, round: 1 },
      { y: 0.370, rx: 0.098, rz: 0.086, round: 1 },
      { y: 0.428, rx: 0.084, rz: 0.078, round: 1 },
    ])), color: SHELL_DARK, pos: [0, 0, -SHOULDER_Z] },
    { geo: use(tube(THREE, [
      { y: 0.300, rx: 0.086, rz: 0.070, round: 1 },
      { y: 0.370, rx: 0.098, rz: 0.086, round: 1 },
      { y: 0.428, rx: 0.084, rz: 0.078, round: 1 },
    ])), color: SHELL_DARK, pos: [0, 0, SHOULDER_Z] },
    { geo: box, color: YELLOW, pos: [0.138, 0.20, 0], scale: [0.035, 0.30, 0.10] },
    { geo: box, color: SHELL_DARK, pos: [0.132, 0.24, -0.075], scale: [0.03, 0.26, 0.045] },
  ]);

  /* The head. The visor is a band bent round the front of the helmet and the
     head is turned to the fall line, so the mint always points where he is
     looking — still the only way to read which way he is facing. */
  const head = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: -0.045, rx: 0.086, rz: 0.086, round: 0.9 },
      { y: 0.040, rx: 0.080, rz: 0.080, round: 0.9 },
    ])), color: INK },
    { geo: use(tube(THREE, [
      { y: 0.020, x: 0.010, rx: 0.082, rz: 0.080, round: 0.95 },
      { y: 0.090, x: 0.014, rx: 0.092, rz: 0.088, round: 0.95 },
      { y: 0.140, x: 0.008, rx: 0.090, rz: 0.088, round: 1 },
    ])), color: SKIN },
    { geo: use(tube(THREE, [
      { y: 0.055, rx: 0.104, rz: 0.100, round: 0.95, n: 24 },
      { y: 0.120, rx: 0.118, rz: 0.114, round: 1, n: 24 },
      { y: 0.180, rx: 0.121, rz: 0.117, round: 1, n: 24 },
      { y: 0.235, rx: 0.110, rz: 0.106, round: 1, n: 24 },
      { y: 0.275, rx: 0.082, rz: 0.079, round: 1, n: 24 },
      { y: 0.298, rx: 0.042, rz: 0.040, round: 1, n: 24 },
    ])), color: INK },
    { geo: use(arc(THREE, {
      a0: -1.15, a1: 1.15, steps: 18, r: 0.106, y: 0.136,
      depth: 0.028, height: 0.044, n: 12, round: 0.5,
    })), color: MINT },
    { geo: use(arc(THREE, {
      a0: 1.05, a1: 5.25, steps: 28, r: 0.120, y: 0.140,
      depth: 0.014, height: 0.026, n: 12, round: 0.5,
    })), color: SHELL_DARK },
  ]);

  /* Every limb segment hangs down its own -Y from its joint, which is the
     only convention the IK needs to know about. The sleeves and legs taper,
     which is what stops a limb reading as a length of pipe once it throws a
     shadow of its own. */
  const upperArm = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: 0.055, rx: 0.078, rz: 0.074, round: 0.95, n: 16 },
      { y: -0.060, rx: 0.082, rz: 0.078, round: 0.9, n: 16 },
      { y: -0.180, rx: 0.070, rz: 0.068, round: 0.9, n: 16 },
      { y: -0.290, rx: 0.062, rz: 0.060, round: 0.9, n: 16 },
    ])), color: SHELL },
    { geo: use(tube(THREE, [
      { y: 0.070, rx: 0.080, rz: 0.076, round: 1, n: 16 },
      { y: -0.020, rx: 0.086, rz: 0.082, round: 0.95, n: 16 },
    ])), color: SHELL_DARK },
  ]);
  const foreArm = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: 0.030, rx: 0.066, rz: 0.064, round: 0.95, n: 16 },
      { y: -0.090, rx: 0.060, rz: 0.058, round: 0.9, n: 16 },
      { y: -0.185, rx: 0.054, rz: 0.052, round: 0.9, n: 16 },
    ])), color: SHELL },
    { geo: use(tube(THREE, [
      { y: -0.175, rx: 0.062, rz: 0.060, round: 0.9, n: 16 },
      { y: -0.215, rx: 0.060, rz: 0.058, round: 0.9, n: 16 },
    ])), color: YELLOW },
    // the glove: a mitt with a thumb, which at this size is one extra bump
    // and the entire difference between a hand and a peg
    { geo: use(tube(THREE, [
      { y: -0.210, rx: 0.056, rz: 0.054, round: 0.9, n: 16 },
      { y: -0.265, x: 0.008, rx: 0.062, rz: 0.058, round: 0.85, n: 16 },
      { y: -0.320, x: 0.010, rx: 0.058, rz: 0.052, round: 0.85, n: 16 },
      { y: -0.352, x: 0.006, rx: 0.040, rz: 0.038, round: 0.95, n: 16 },
    ])), color: INK },
    { geo: use(tube(THREE, [
      { y: -0.250, rx: 0.026, rz: 0.024, round: 0.9, n: 12 },
      { y: -0.290, rx: 0.022, rz: 0.020, round: 0.9, n: 12 },
    ])), color: INK, pos: [0.05, 0, -0.02], rot: [0, 0, -0.5] },
  ]);
  const thigh = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: 0.070, rx: 0.108, rz: 0.104, round: 0.9 },
      { y: -0.080, rx: 0.116, rz: 0.112, round: 0.75 },
      { y: -0.260, rx: 0.100, rz: 0.098, round: 0.75 },
      { y: -0.420, rx: 0.086, rz: 0.086, round: 0.85 },
    ])), color: DENIM },
  ]);
  const shin = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: 0.045, rx: 0.090, rz: 0.090, round: 0.85 },
      { y: -0.120, rx: 0.084, rz: 0.082, round: 0.8 },
      { y: -0.270, rx: 0.090, rz: 0.088, round: 0.75 },
      { y: -0.340, rx: 0.101, rz: 0.099, round: 0.7 },
    ])), color: DENIM },
    // the trouser cuff falls over the boot, which is both what happens and
    // the tidiest way to hide the one joint in the rig that cannot bend
    { geo: use(tube(THREE, [
      { y: -0.300, rx: 0.104, rz: 0.102, round: 0.7 },
      { y: -0.372, rx: 0.106, rz: 0.104, round: 0.7 },
    ])), color: INK },
  ]);

  box.dispose();
  for (const g of scrap) g.dispose();
  return { board, rearBoot, torso, head, upperArm, foreArm, thigh, shin };
}

/* ==========================================================================
   The rig
   ========================================================================== */

export function createRiderModel(THREE, shading) {
  const geo = buildGeometries(THREE);

  /* The bow, in one object that the vertex shader and `boardPoint` both hold a
     reference to. One number, two readers, no way for the drawn board and the
     feet standing on it to disagree. */
  const flexUniform = { value: 0 };
  /* One smooth material for the lot: colours are already in the vertices, so
     eleven meshes are eleven draw calls and not one state change. The rider
     is lit by exactly the same moving sun and atmosphere as the hill, which
     keeps the figure grounded in the scene rather than pasted over it. */
  const cloth = shading.apply(
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false }),
  );

  /* THE BOARD FLEXES, and it is the only thing on this rig that is not a rigid
     transform of a composed buffer.

     A snowboard is a spring. It is built with eight millimetres of camber —
     `DECK` bakes that in, the middle standing proud of the two contact
     stations — and the entire reason it is built that way is so that a loaded
     rider flattens it and then reverses it, which is what presses the whole
     effective edge into the snow instead of just the two ends. A rider on a
     hard edge is standing on a bow. The rig had that camber and never moved
     it: the board went past at a hundred and forty km/h through a compression
     and stayed exactly as straight as it was parked.

     It is a vertex shader rather than a hinge, and the file's own architecture
     is what decides that. The deck is one buffer on purpose — the note at the
     `DECK` table says splitting it is how a board ends up as four solids that
     have to agree along a seam — and the front boot and both bindings remain
     in that same buffer. So the flex is a displacement applied to the whole
     board at once; the separately rigid rear boot follows its binding target.

     The one real trap is agreement. The front boot is in the flexing buffer,
     while the rear boot is a rigid mesh and both legs are solved to
     `boardPoint`; if those readers disagree, an ankle hovers above a binding.
     The shader and target therefore share the same `uBend` value, and the rear
     boot is placed from the exact ankle target used by its leg.

     `(1 − u²)` is zero at u = ±1, and `FLEX_SPAN` is the z of the two widest
     deck stations — the contact points. So the bend cannot move the part of
     the board the physics has anchored the rider to, however hard it is
     driven. It is a bow between the contacts and nothing else, which is what a
     snowboard does. */
  const boardMat = (() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uBend = flexUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uBend;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float u = clamp(transformed.z / ${FLEX_SPAN.toFixed(3)}, -1.0, 1.0);
            transformed.y += uBend * (1.0 - u * u);
          }`);
    };
    return shading.apply(m);
  })();

  const root = new THREE.Group();
  const board = new THREE.Mesh(geo.board, boardMat);
  board.name = 'rider-board';
  const rearBoot = new THREE.Mesh(geo.rearBoot, cloth);
  rearBoot.name = 'rider-rear-boot';
  root.add(board, rearBoot);

  const hips = new THREE.Group();
  hips.position.set(0, HIP_Y, 0);
  hips.rotation.order = 'YZX';
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
  const headlamp = createHeadlamp(THREE, shading, head);

  const limb = (parent, y, z, upperGeo, foreGeo, upperLen) => {
    const upper = new THREE.Group();
    upper.position.set(0, y, z);
    upper.add(new THREE.Mesh(upperGeo, cloth));
    const fore = new THREE.Group();
    fore.position.set(0, -upperLen, 0);
    fore.add(new THREE.Mesh(foreGeo, cloth));
    upper.add(fore);
    parent.add(upper);
    return { upper, fore, home: z };
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
  /* A soft contact print, still one quad-sized draw.

     The old disc ended at the edge of a fourteen-sided circle, so at the
     exact place a shadow ought to disappear gently it drew a dark polygon.
     This tiny generated mask has a long board lobe and a wider body lobe;
     scaling and turning the same mesh with the stance below makes it read as
     something cast by this rider rather than as a marker placed under them. */
  const shadowMap = (() => {
    const cv = document.createElement('canvas');
    cv.width = 96;
    cv.height = 128;
    const g = cv.getContext('2d');
    g.filter = 'blur(7px)';
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.beginPath();
    g.ellipse(48, 64, 13, 48, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.58)';
    g.beginPath();
    g.ellipse(48, 67, 31, 24, 0, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  })();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    shading.apply(new THREE.MeshBasicMaterial({
      color: 0x0d1c33, map: shadowMap, transparent: true, opacity: 0.30,
      depthWrite: false, fog: false,
    }), { fog: false }),
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

  // Two hand targets and two poles, written in the travel frame, plus the
  // pair each of them is resolved into once `sw` has said which shoulder is
  // leading. Nothing here allocates during a run.
  const hand = new THREE.Vector3();
  const other = new THREE.Vector3();
  const tLead = new THREE.Vector3();
  const tRear = new THREE.Vector3();
  const pLead = new THREE.Vector3();
  const pRear = new THREE.Vector3();
  const foot = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const poleRear = new THREE.Vector3();
  const socket = new THREE.Vector3();
  const sockA = new THREE.Vector3();
  const sockB = new THREE.Vector3();
  const bootA = new THREE.Vector3();
  const bootB = new THREE.Vector3();
  const rearAnkle = new THREE.Vector3(FOOT_X, ANKLE_Y, 0);
  const rearOffset = new THREE.Vector3();
  const mInv = new THREE.Matrix4();
  const hipQ = new THREE.Quaternion();
  const hipE = new THREE.Euler(0, 0, 0, 'YZX');
  const last = new THREE.Vector3();

  /* The board's own frame, rebuilt every frame and then asked for points.

     Three things happen to the board relative to the rider: it rolls further
     onto its edge than his body does, it pitches nose-up as he pops, and it
     comes up to meet his hand in a grab. Every one of those moves the boots,
     and the boots are where the legs are solved to, so all three live in one
     place and every consumer — both ankles and the grab target — goes through
     the same function. Getting that transform written out three times and
     wrong once is precisely how a foot ends up hovering four centimetres
     above a binding. */
  const bt = { roll: 0, pitch: 0, x: 0, y: 0 };
  const _b = new THREE.Vector3();
  /* …and the flex is the fourth thing that happens to it, for exactly the same
     reason the other three are here. The boots are welded into the board's
     buffer, so a bow that moves the drawn boots and not this target is a foot
     hovering above a binding — the failure the paragraph above is about. It is
     applied before the roll and the pitch because that is the order the vertex
     shader does it in: the displacement is in the board's own local space, and
     the rotations are the model matrix on top. */
  const boardPoint = (v) => {
    const u = clamp(v.z / FLEX_SPAN, -1, 1);
    v.y += flexUniform.value * (1 - u * u);
    return v
      .applyAxisAngle(AZ, bt.roll)
      .applyAxisAngle(AX, bt.pitch)
      .add(_b.set(bt.x, bt.y, 0));
  };

  // Everything the model remembers between frames. All of it is smoothed
  // against dt, none of it is read back by anyone else.
  const s = {
    clock: 0, down: 0, air: 0, grab: 0, tuck: 0, push: 0, charge: 0,
    twist: 0, lean: 0, comp: 0, pop: 0, thump: 0, tumbleLag: 0, wash: 0, press: 0,
    edge: 0, load: 0, steer: 0, switched: 0,
  };
  let seen = false;

  function update(rider, dt, weather = null, camera = null) {
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
    // At walking pace W keeps its physics, but visually a real rider skates
    // rather than folding into a tuck before the board is moving.
    s.tuck = approach(s.tuck, rider.tucking && !rider.pushing ? 1 : 0, 8, sdt);
    s.push = approach(s.push, rider.pushing ? 1 : 0, rider.pushing ? 14 : 10, sdt);
    s.charge = approach(s.charge, rider.charging ? 0.35 + 0.65 * rider.charge : 0, 13, sdt);
    s.wash = approach(s.wash, clamp((rider.lateral || 0) / 6, -1, 1), 6, sdt);

    /* Which way round he is standing.

       The physics flips `switchStance` in one frame, and so does the yaw it
       hands us — the board is already going the other way. What cannot flip
       in one frame is the rider: the boots have not moved, so this is not a
       different stance, it is the same stance with the *other* end of the
       board leading. `sw` carries that through everything with a front and a
       back in it, and it eases rather than snapping, which reads as the head
       and shoulders coming round to face the new direction of travel. */
    s.switched = approach(s.switched, rider.switchStance ? 1 : 0, 7, sdt);
    const sw = 1 - 2 * s.switched;
    const front = 0.5 + 0.5 * sw;     // 1 with the nose leading, 0 riding switch

    // The grab pose is gated on being airborne as well as on the grab, so
    // the board is back on the snow within a tenth of a second of touchdown
    // whatever the hands are still doing
    const grab = s.grab * s.air * (1 - s.down);
    const skate = s.push * (1 - s.air) * (1 - s.down) * (1 - grab);

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

    /* --- the steering ---------------------------------------------------- */

    /* How far the board is actually laid over, which is not `rider.edge`.

       The physics lets the edge angle run to sixty-six degrees, and it is
       right to: at walking pace nothing stops you standing a board on its
       side. Drawn literally that is a rider lying on the snow while the HUD
       says four km/h. What makes an edge angle *mean* something is the snow
       pushing back on it, which is exactly what `carveLoad` is — so the shown
       edge is the real one weighted by the load, and the board only lies over
       when it has something to lie over against. */
    s.load = approach(s.load, rider.carveLoad || 0, 9, sdt);
    const edgeWant = clamp(
      (rider.edge || 0) * (0.35 + 0.65 * s.load), -POSE.edgeShow, POSE.edgeShow,
    ) * (1 - s.air * 0.7) * (1 - s.down);
    s.edge = approach(s.edge, edgeWant, 12, sdt);

    /* --- the bow ---------------------------------------------------------- */

    /* Four things bend the board, and they are the four things that put load
       through it. A buried edge presses the middle down; so does the ground's
       own curvature through a compression, and lets it go over a crest; a pop
       is the spring throwing the middle *up* as it unloads; and a landing
       drives the deepest bow of all. All four are already smoothed states with
       their own attack and decay, so this is the sum of them and a clamp.

       It goes to zero in the air except for the pop, which is correct and is
       the reason the pop term is not gated: a board unweighted off a lip is
       the one moment the camber is doing something visible on its own. */
    s.press = approach(s.press, clamp(rider.bend || 0, -1, 1.6), 9, sdt);
    const grounded = 1 - s.air;
    flexUniform.value = clamp(
      -(FLEX.edge * s.load * Math.abs(Math.sin(s.edge)) + FLEX.press * s.press) * grounded
      + FLEX.pop * s.pop
      - FLEX.thump * s.thump,
      FLEX.min, FLEX.max,
    );

    /* …and how hard the back foot is having to work for it.

       A wash-out counts as steering, and counts double: when the edge lets go
       the rider is no longer being carried round by the sidecut, he is
       kicking the tail out with the back leg, which is the most visible
       version of this whole action there is. */
    const kick = clamp((rider.slide || 0) / 7, 0, 1) * Math.sign(s.edge || rider.edge || 0);
    s.steer = approach(s.steer, clamp(
      Math.sin(s.edge) * (0.35 + 0.65 * s.load) + kick * 0.4, -1.1, 1.1,
    ), 9, sdt);
    const steer = s.steer * (1 - s.down);

    /* Counter-rotation.

       The hips are bolted to the board by the bindings, so every degree of
       this happens at the waist. On the snow the shoulders wind *against* the
       pelvis the back foot has just turned — that differential is the whole
       reason a snowboarder's shoulders and hips are never in the same plane.
       In the air they trail the spin instead, which is what makes a 540 read
       as a body being wound rather than a model being rotated. */
    const counter = POSE.counter * steer * sw * (0.45 + 0.55 * s.load);
    // Positive, because the model's yaw runs against the physics' compass
    // one: a spin the physics calls positive turns the *model* negative, so
    // shoulders that lag it are shoulders wound the other way.
    const trail = clamp(rider.spinVel / RIDER.spinRate, -1, 1)
      * POSE.spinTrail * (1 - grab * 0.65);
    const idle = 1 - Math.max(
      grab, s.down, s.tuck * 0.7, skate, Math.abs(steer) * 0.6,
    );
    /* How much of the riding stance is still in force.

       Two poses put the body somewhere the stance has no opinion about — a
       grab, which is a fold past the horizontal, and a fall, which is not a
       stance at all — and the constants that describe how a man stands on a
       board have to be taken away for both of them or they fight the pose
       that has replaced them. Everything else in the file scales the stance
       rather than cancelling it, which is the point: a tuck is a rider
       standing lower, not a different rider. */
    const upright = (1 - grab) * (1 - s.down);
    s.twist = approach(s.twist,
      POSE.stance * sw + counter * (1 - s.air) + trail * s.air
      + Math.sin(s.clock * 0.53) * 0.06 * idle, 7, sdt);
    // The body's own inclination, positive towards the toe edge. The physics
    // signs it the other way round because it is describing a turn direction
    // rather than a body, and this is the one place that is reconciled.
    s.lean = approach(s.lean, -rider.roll, 8, sdt);
    if (fallen <= 0) s.tumbleLag = rider.tumble;

    /* --- the whole rider, on the hill ------------------------------------ */

    // Stand him on the surface, then turn, flip and roll him in his own
    // frame. In the air the reference drifts back to true vertical.
    up.copy(rider.normal);
    if (!rider.grounded) up.lerp(UP, Math.min(1, rider.airTime * 2.5)).normalize();
    q.setFromUnitVectors(UP, up);
    // Negative, and this is the fix rather than a convention: the physics
    // heading is (sin yaw, 0, −cos yaw), which is this rotation and not its
    // mirror. See the note at the top of the file.
    qy.setFromAxisAngle(UP, -rider.yaw);
    qx.setFromAxisAngle(AX, rider.flip + rider.tumble * s.down);
    qz.setFromAxisAngle(AZ, -s.lean * (1 + 1.2 * s.down));
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
    bt.pitch = s.pop * 0.12 * sw;   // the nose lifts as he pops, whichever end it is
    // The board is rolled further than the body: that difference *is*
    // angulation, and it is now the two signals subtracted rather than a
    // share of one of them guessed at.
    bt.roll = s.lean - s.edge + tweak;

    /* Roll it about the edge that is buried, not about its own centreline.

       Pivoting on the centreline puts half the base under the snow at any
       real edge angle — thirteen centimetres of it at sixty degrees — and
       what that looks like is a board sinking into the hill rather than
       carving across it. The buried edge is the contact patch, the physics
       already puts the rider's position there, so the deck is offset by
       whatever keeps that one line still. The offset is worked out in the
       hill's frame and brought back into the root's, because the root is
       already rolled by the body's own lean. */
    const px = clamp(s.edge / 0.12, -1, 1) * HALF_WIDTH;
    const py = 0.03;
    const cw = Math.cos(-s.edge);
    const sn = Math.sin(-s.edge);
    const tx = px - (px * cw - py * sn);
    const ty = py - (px * sn + py * cw);
    const cl = Math.cos(s.lean);
    const sl = Math.sin(s.lean);
    bt.x = tx * cl - ty * sl;
    bt.y = ty * cl + tx * sl + lift;

    board.position.set(bt.x, bt.y, 0);
    board.rotation.set(bt.pitch, 0, bt.roll);

    // Where the boots have ended up, which is the only thing the legs are
    // ever solved against. The front target remains in its binding; the rear
    // one is displaced by the same skating phase that fires the physics
    // impulse, so the boot plant and the acceleration cannot drift apart.
    boardPoint(bootA.set(FOOT_X, ANKLE_Y, -FOOT_Z));
    boardPoint(bootB.set(FOOT_X, ANKLE_Y, FOOT_Z));

    const phase = clamp(rider.pushPhase || 0, 0, 1);
    let pushSide = 0;
    let pushAlong = 0;
    let pushLift = 0;
    let pushTilt = 0;
    if (phase < 0.22) {
      const t = smooth01(phase / 0.22);
      pushSide = POSE.pushSide * t;
      pushAlong = -POSE.pushReach * t;
      pushLift = Math.sin(t * Math.PI) * POSE.pushLift - DECK_TOP * t;
      pushTilt = Math.sin(t * Math.PI) * 0.12;
    } else if (phase < 0.62) {
      const t = smooth01((phase - 0.22) / 0.40);
      pushSide = POSE.pushSide;
      pushAlong = -POSE.pushReach + (POSE.pushReach + POSE.pushDrive) * t;
      pushLift = -DECK_TOP + Math.sin(t * Math.PI) * 0.012;
      pushTilt = -0.04 + t * 0.08;
    } else {
      const t = smooth01((phase - 0.62) / 0.38);
      pushSide = POSE.pushSide * (1 - t);
      pushAlong = POSE.pushDrive * (1 - t);
      pushLift = -DECK_TOP * (1 - t) + Math.sin(t * Math.PI) * POSE.pushLift;
      pushTilt = Math.sin(t * Math.PI) * 0.14;
    }

    bootB.x += pushSide * skate;
    bootB.y += pushLift * skate;
    bootB.z += pushAlong * sw * skate;

    /* The rear boot is rigid even though the board underneath it flexes. Its
       origin is recovered from the desired ankle target, then its roll is
       released towards the snow while the foot is out of the binding. */
    rearBoot.rotation.set(
      bt.pitch + pushTilt * skate,
      0,
      bt.roll * (1 - skate),
    );
    rearOffset.copy(rearAnkle).applyQuaternion(rearBoot.quaternion);
    rearBoot.position.copy(bootB).sub(rearOffset);

    /* --- hips -------------------------------------------------------------- */

    /* The pelvis turns with the back foot, and it turns *about the front one*.

       This is the load-bearing half of "steer with the back foot", and the
       pivot is the whole of it. Turned about its own centre — which is what
       this did first — a pelvis moves both hips by the same amount in
       opposite directions, and what comes out is a rider swivelling: both
       knees travel the same distance and the eye reads a body rotating rather
       than a foot steering. Measured, it was 79 mm of lead knee against 81 mm
       of rear, which is nothing.

       Pivoted on the leading hip socket instead, that hip stays exactly where
       it was pointed — down the board, which is where a lead hip lives — and
       the trailing one swings through twice the arc. With the socket loading
       below it that comes out at 26 mm of lead knee against 66 mm of rear
       through a loaded toeside carve, measured across the deck rather than
       up it, because the vertical is the whole rider rising over a buried
       edge and says nothing about which leg is working. The pivot swaps ends
       with the stance, because the leading hip riding switch is the other
       one. */
    const pelvis = -POSE.hipSteer * steer * sw;
    hips.rotation.set(0, pelvis - s.twist * 0.10, -s.wash * 0.06);
    const pivotZ = -HIP_Z * sw;
    const pivotX = -pivotZ * Math.sin(hips.rotation.y);
    const pivotDz = pivotZ * (1 - Math.cos(hips.rotation.y));
    hipE.set(hips.rotation.x, hips.rotation.y, hips.rotation.z, 'YZX');
    hipQ.setFromEuler(hipE);

    /* And the hip joint itself has play in it, which is where the rest of the
       difference between the two legs comes from.

       The weight going back over the steering foot used to be a shift of the
       whole pelvis, and that was the bug behind the first version of this: a
       pelvis that slides towards the tail bends *both* knees, so the lead leg
       moved exactly as far as the rear one and the two of them scissored.
       Loading the back foot is not a translation of the body, it is one femur
       head rotating in its socket while the other does not — so it is applied
       per socket, weighted by which leg is doing the steering, and the lead
       one keeps a fifth of it so it still reads as attached to a person. */
    const driveA = (1 - front) + front * POSE.quiet;   // the lead leg, over the nose
    const driveB = front + (1 - front) * POSE.quiet;   // and the one over the tail
    const socketZ = POSE.weightBack * Math.abs(steer) * sw;
    sockA.set(
      -POSE.hipDrive * steer * driveA,
      POSE.hipSink * steer * driveA,
      -HIP_Z + socketZ * driveA,
    );
    sockB.set(
      -POSE.hipDrive * steer * driveB,
      POSE.hipSink * steer * driveB,
      HIP_Z + socketZ * driveB,
    );
    legLead.upper.position.copy(sockA);
    legRear.upper.position.copy(sockB);

    // Weight across the board: into the turn, away from a wash, and never
    // quite still — the slow sway is the difference between a rider waiting
    // and a rider parked.
    hips.position.x = s.lean * POSE.hipShift - s.wash * 0.05 + pivotX
      - skate * POSE.pushHipSide
      + (Math.sin(s.clock * 0.9) + Math.sin(s.clock * 0.37 + 1.7)) * 0.014 * idle;
    /* Fore and aft. All of it is travel-relative, so it mirrors when he lands
       switch instead of putting his weight on the wrong end of the board.

       `hipsBack` is the constant one and the reason the rest of it reads: the
       pelvis sits behind the chest by default, which is what makes the torso
       hinge below a hinge rather than a topple. A tuck brings the weight
       forward over the leading foot, a scrub throws it back over the tail,
       and coiling an ollie sits it back over the foot that is about to do the
       work. */
    hips.position.z = (POSE.hipsBack * upright + POSE.chargeBack * s.charge
      - s.tuck * 0.06 + Math.abs(s.wash) * 0.05) * sw + pivotDz
      - skate * POSE.pushHipFront
      + Math.sin(s.clock * 0.61 + 0.8) * 0.012 * idle;

    const load = rider.compression - REST_SQUAT;
    const squat = Math.max(0, load);
    const stretch = Math.max(0, -load);
    let hipY = HIP_Y
      // the stance itself, which is not a reaction to anything
      - POSE.crouch * (1 - s.air * 0.4)
      - squat * POSE.hipPerSquat + stretch * POSE.hipPerStretch
      - s.tuck * POSE.tuckDrop - skate * POSE.pushDrop - s.down * POSE.fallDrop
      // the knees come up off the snow and the landing folds them; both are
      // events with their own decay, and neither is anything the leg spring's
      // own travel would ever have drawn
      - POSE.airTuck * s.air + POSE.popRise * s.pop - POSE.thumpDrop * s.thump
      // and up with the deck when it is laid over, because the boots went up
      // with it and the leg between them has not changed length
      + bt.y;

    /* The grab is the one pose where the hips are placed rather than sprung.
       How far the hips sit above the board decides two things at once — how
       far the legs have folded, and whether the hand can reach the edge —
       and they pull in opposite directions: any higher and the arm comes up
       short, any lower and the knee bends further than a knee goes. There is
       about eight centimetres of window between those two failures and this
       sits in the middle of it, which is why it is a position and not an
       offset from wherever the spring happened to leave him. */
    hipY += (bootA.y + POSE.grabHip - hipY) * grab;

    /* He can fold a long way, but not through his own boots, and he can
       stand a long way up, but not out of his own bindings.

       The top of that range used to be worked out from a nominal socket at
       the centre of the pelvis, which was true right up until the pelvis
       started turning: a hip that has rotated four centimetres away from its
       own boot has four centimetres less leg to reach with, and what that
       leaves behind is a shin hanging above a binding. So it is solved per
       leg now, from where that socket has actually ended up — the largest
       height at which the ankle is still inside the leg's reach, which is
       one square root and exact. */
    // Buzz at speed: the board is chattering, and it arrives through the legs.
    // It goes on before the clamp rather than after it, which is where it used
    // to be — seven millimetres of sine on top of a hip already parked at the
    // top of its reach is seven millimetres of boot the ankle cannot follow.
    hipY += Math.sin(s.clock * 47) * POSE.chatter
      * Math.min(1, rider.speed / 40) * (1 - s.air) * (1 - s.down);

    const span = (THIGH + SHIN) * 0.985;
    let ceiling = Infinity;
    let floor = -Infinity;
    for (let i = 0; i < 2; i++) {
      const sk = i === 0 ? sockA : sockB;
      const bo = i === 0 ? bootA : bootB;
      socket.copy(sk).applyQuaternion(hipQ);
      const dx = hips.position.x + socket.x - bo.x;
      const dz = hips.position.z + socket.z - bo.z;
      const room = Math.sqrt(Math.max(0.0016, span * span - dx * dx - dz * dz));
      ceiling = Math.min(ceiling, bo.y - socket.y + room);
      floor = Math.max(floor, bo.y - socket.y + POSE.hipFold);
    }
    hipY = clamp(hipY, Math.min(floor, ceiling), ceiling);

    hips.position.y = hipY;
    hips.updateMatrix();

    /* --- torso ------------------------------------------------------------- */

    const lag = clamp(rider.tumble - s.tumbleLag, -1.4, 1.4);
    /* The chest is ahead of the hips, and that is the constant the pose was
       missing rather than another reaction to be triggered.

       Everything the torso did used to be signed off an event — a charge, a
       pop, a landing, a grab — so a rider holding a straight line stood
       perfectly square and perfectly vertical, and a vertical spine over a
       board is the single loudest tell that a figure is a mannequin. He now
       hinges over the leading foot by default, with the pelvis moved back to
       pay for it, and the chest carries a little of the same across the board
       towards the toe edge, which is where his eyes already are.

       The tuck is the one thing that takes it away rather than adding to it.
       A tuck started life here at forty-nine degrees over the nose, which is
       a downhill skier's egg and the wrong sport; the note that replaced it
       said the chest stays level and the legs do all the work, and it is
       still right, so the hinge is scaled out as the tuck comes on. What is
       left is a rider who sinks and keeps his chest up. */
    const hinge = POSE.chestFwd * upright * (1 - s.tuck * 0.85) * (1 - s.air * 0.35);
    const pitch = (-hinge - s.charge * 0.35 + s.pop * 0.20
      - s.thump * 0.34 - grab * 0.25) * sw - skate * POSE.pushHinge;
    // Angulation at the waist as well as at the knees: the shoulders stand
    // back up out of the body's own inclination, which is what keeps a carve
    // from reading as a man falling over sideways at a constant rate.
    const fold = -POSE.grabFold * grab - s.down * 0.5 * (1 - grab)
      + s.lean * POSE.angulate * (1 - grab)
      - POSE.chestSide * upright * (1 - s.tuck * 0.7);
    /* Going over, he curls up and the chest trails the tumble by however far
       the roll has outrun the smoothed copy of it — and it flops sideways as
       well, which is the half that was missing. A body trailing a rotation in
       exactly one plane still reads as a rigid thing being turned; it is the
       second axis, arriving on a different clock from the first, that makes
       it read as a person who has stopped holding himself up. */
    torso.rotation.set(
      pitch - s.down * (0.55 + lag * 0.5) * sw,
      s.twist - hips.rotation.y + s.down * Math.sin(s.clock * 3.4) * 0.30,
      fold + s.down * (lag * 0.45 + Math.sin(s.clock * 4.6 + 1.2) * 0.22),
    );

    /* Breathing.

       A centimetre and a half of chest, on a sine, and it is the difference
       between a rider and a model of a rider. Nothing else in this file runs
       when the physics is quiet — every other motion here is driven by
       something the mountain is doing — so a rider holding a straight line
       down an easy pitch was perfectly, unnaturally still. The eye does not
       consciously see this; it notices its absence.

       It survived the rider getting a body: on a lofted jacket the same
       amplitude reads better than it did on a box, because what swells is a
       chest with a waist under it rather than a rectangle. The rate is
       effort, not time — it climbs with speed and with whatever the legs are
       carrying — the depth goes the other way, because someone working hard
       breathes quickly and shallowly, and it fades out under a grab or a
       tuck where the chest is doing something else and a breath on top of it
       reads as a wobble. */
    const effort = clamp(rider.speed / 30 + (rider.gLoad - 1) * 0.5, 0, 1.6);
    const breath = Math.sin(s.clock * (1.05 + effort * 1.5)) * 0.5 + 0.5;
    const depth = (0.016 - effort * 0.005) * idle;
    torso.scale.set(1 + breath * depth * 0.8, 1 + breath * depth * 0.5, 1 + breath * depth);
    torso.updateMatrix();

    /* --- head -------------------------------------------------------------- */

    // He looks down the fall line — whichever end of the board is leading —
    // so the yaw the shoulders have taken is subtracted back out of the neck;
    // in the air he looks at the landing, on a landing he looks down at it,
    // and in a fall the neck goes as loose as the rest of him and lolls on
    // its own clock. The tilt is *against* the lean while he is riding: a
    // head that rolls with the body reads as unconscious, which is exactly
    // what it is once he is down.
    head.rotation.set(
      -0.05 + s.air * 0.22 + s.thump * 0.30
        - s.down * (lag * 0.6 + Math.sin(s.clock * 5.2) * 0.25),
      POSE.look * sw - s.twist * 0.55 + Math.sin(s.clock * 0.41) * 0.05 * idle
        + s.down * Math.sin(s.clock * 3.9 + 2.1) * 0.35,
      s.lean * 0.18 + s.down * (0.4 + Math.sin(s.clock * 4.4 + 0.7) * 0.25),
    );

    /* --- legs -------------------------------------------------------------- */

    /* The ankles are wherever the bindings are, in root space, and the hips
       are wherever the spring left them. Everything between is arithmetic:
       the boot is carried back into the hips' frame, the socket it belongs to
       is subtracted, and the knee is whatever is left.

       The pole is where the steering shows. It leans further along the board
       the deeper the fold gets — which is both what a tucked grab looks like
       from the side and the only thing keeping a full crouch's knees out of
       the rider's own chest — and on top of that the *steering* leg's knee is
       driven across towards the toe edge and forward over the leading foot,
       while the other one is allowed a fifth of the same. Two legs, one of
       them working: that contrast is the read, and it is the whole of what
       "he steers with his back foot" looks like from the outside. */
    mInv.copy(hips.matrix).invert();

    /* …and going over, the two legs stop agreeing with each other.

       A tumble was the one state where both knees held exactly the same angle
       through the whole roll, and two legs locked in a matching crouch while
       the body rotates at a constant rate is the definition of a mannequin
       being spun. The knees are not animated here and cannot be, so the flail
       is put through the pole: the plane each leg bends in wanders on its own
       sine, at rates that share no common multiple, and what comes out is two
       legs finding different angles at every moment of the fall. It costs a
       sine each and it is the whole difference between a body and a prop. */
    const solveLeg = (leg, boot, sk, drive, seed) => {
      foot.copy(boot).applyMatrix4(mInv).sub(sk);
      const deep = 1 - clamp(foot.length() / (THIGH + SHIN), 0, 1);
      const loose = s.down * 0.9;
      pole.set(
        1 - deep * 0.55 + POSE.kneeIn * steer * drive
          + Math.sin(s.clock * 4.7 + seed) * loose,
        0.1 + Math.sin(s.clock * 3.1 + seed * 2.2) * loose * 0.8,
        Math.sign(leg.home) * (0.3 + deep * 1.1) - POSE.kneeFwd * steer * drive * sw
          + Math.sin(s.clock * 5.9 + seed * 1.7) * loose,
      );
      solve(leg, THIGH, SHIN, foot, pole);
    };
    solveLeg(legLead, bootA, sockA, driveA, 0);
    solveLeg(legRear, bootB, sockB, driveB, 2.6);

    /* --- arms -------------------------------------------------------------- */

    /* Everything from here down is written in the *travel* frame, where -Z is
       whichever end of the board is currently leading, and is mirrored into
       board space at the very bottom. That is the only way a switch landing
       stays one rider: the poses do not know which stance he is in, they know
       front from back, and `sw` decides what that means this frame.

       Riding: down. Not out.

       This pose has now been wrong twice for opposite reasons. Before the rig
       it was arms held out sideways from a torso facing down the hill, a
       T-pose with the corners knocked off. The rig replaced that with hands
       spread along the board — 0.35 m towards the nose and 0.26 towards the
       tail against 0.38 of drop, on an arm 0.58 m long — which is a different
       shape and the same mistake: seen from behind, which is where the camera
       lives, spread along the board *is* spread sideways, and what it read as
       was a man being electrocuted.

       An arm at rest hangs. Both of these are now within a hand's width of
       straight down, the leading one reaching a little towards the nose and
       the trailing one hanging past the hip, and both are held about 0.53 m
       from the shoulder rather than 0.55 — three centimetres of slack that
       the solver spends on keeping a bend in the elbow, because a straight
       arm is a stick and a bent one is a person. */
    hand.set(0.15, -0.47, -0.19);
    other.set(0.07, -0.51, 0.14);

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
       have somewhere specific to be — which now includes steering, because a
       rider mid-carve is not idling. */
    const sway = 0.011 * idle;
    hand.x += Math.sin(s.clock * 0.83) * sway;
    hand.y += Math.sin(s.clock * 1.27 + 1.1) * sway * 0.8;
    hand.z += Math.sin(s.clock * 0.61 + 2.4) * sway;
    other.x += Math.sin(s.clock * 0.71 + 2.2) * sway;
    other.y += Math.sin(s.clock * 1.09 + 0.4) * sway * 0.8;
    other.z += Math.sin(s.clock * 0.53 + 4.1) * sway;

    /* Carving, which is where the hands stop hanging and start working.

       The leading hand comes up and reaches out over the nose and across the
       edge he is going onto — which a rider's hands do a fraction of a second
       before the board follows them round — and the trailing hand drops back
       over the tail. That opposition is the arms' half of counter-rotation
       and it is why a carve does not need the arms spread the rest of the
       time: the contrast has to be spent somewhere, and this is where.

       Every one of these lands the hand about 0.56 m from the shoulder at
       full lock, three centimetres inside the 0.58 the arm has. Overshoot it
       and the solver clamps to a straight arm pointing at the target, and a
       carve with two straight arms in it is the pose this file started
       with. */
    const carve = Math.abs(steer);
    hand.x += steer * 0.14;
    hand.y += carve * 0.12;
    hand.z -= carve * 0.14;
    other.x += steer * 0.06;
    other.z += carve * 0.08;

    // Skating puts the shoulders into opposition: the front arm reaches with
    // the board while the rear arm swings back over the driving leg.
    hand.lerp(_f.set(0.28, -0.34, -0.34), skate * 0.86);
    other.lerp(_f.set(-0.16, -0.38, 0.29), skate * 0.86);

    // Tucked: arms spread low and wide across the board, which is how a
    // snowboarder actually holds a tuck — the hands go out for the balance
    // the narrowed stance has just given up, not in against the chest the
    // way a skier's do. Pulling them in was most of why the pose read wrong;
    // reaching for a point further away than the arm is long was the rest,
    // because a target out of reach is a straight arm by definition.
    hand.lerp(_f.set(0.30, -0.40, -0.28), s.tuck);
    other.lerp(_f.set(0.28, -0.42, 0.26), s.tuck);
    // Coiling an ollie drags them back and down, behind the heel edge, where
    // they have the whole length of a throw ahead of them
    hand.lerp(_f.set(-0.20, -0.42, -0.20), s.charge);
    other.lerp(_f.set(-0.22, -0.42, 0.18), s.charge);

    /* Airborne, the hands come in off the hips and up in front of him.

       This is the one state the riding pose is simply wrong for. On the snow
       the arms hang because there is a board under them holding the rider up;
       in the air there is nothing to be still against, and every photograph
       of anybody off a lip has the hands up, in, and bent at the elbow —
       balancing the rotation rather than hanging off it. It goes on before
       the throw and before the spin trail, so a pop still fires through it
       and a spin still drags it round. */
    const flight = s.air * (1 - grab) * (1 - s.down);
    hand.lerp(_f.set(0.27, -0.24, -0.30), flight);
    other.lerp(_f.set(0.23, -0.29, 0.27), flight);

    // …and the pop throws them up and forward over the leading tip, which is
    // where the height comes from on a real one. It is added on top of
    // whatever pose is underneath rather than blended into it, because a
    // throw is a movement and not a shape.
    hand.y += s.pop * 0.42 + s.thump * 0.26;
    hand.z -= s.pop * 0.18;
    hand.x += s.pop * 0.16;
    other.y += s.pop * 0.38 + s.thump * 0.30;
    other.z -= s.pop * 0.10;
    other.x += s.pop * 0.10;

    // In the air the hands trail the spin, further round than the shoulders
    // do, and pull in as the rotation winds up. The angle is signed into the
    // travel frame so that it still trails the *world* spin when he is riding
    // switch, rather than politely leading it.
    if (s.air > 0.002) {
      const wind = clamp(rider.spinVel / RIDER.spinRate, -1, 1) * POSE.armTrail * s.air * sw;
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
       torso into the leading shoulder's own space — and only when there is a
       grab to pay for it. */
    if (grab > 0.002) {
      mInv.copy(hips.matrix).multiply(torso.matrix).invert();
      boardPoint(_f.set(POSE.grabPoint[0], POSE.grabPoint[1], POSE.grabPoint[2] * sw));
      _f.applyMatrix4(mInv);
      _f.y -= SHOULDER_Y;
      _f.z += SHOULDER_Z * sw;
      _f.z *= sw;                 // …and back into the travel frame with the rest
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
        .applyAxisAngle(AX, (-lag * 0.9 + Math.sin(s.clock * 7.1) * 0.22) * sw);
      hand.lerp(_f, s.down);
      _f.set(0.05, -0.24, 0.42)
        .applyAxisAngle(AX, (-lag * 1.1 + Math.sin(s.clock * 6.3 + 2.1) * 0.22) * sw);
      other.lerp(_f, s.down);
      pole.lerp(_u.set(-0.4, 0.2, -0.5), s.down);
      poleRear.lerp(_u.set(-0.4, 0.2, 0.5), s.down);
    }
    s.tumbleLag = approach(s.tumbleLag, rider.tumble, 7, sdt);

    /* Out of the travel frame and onto two actual shoulders.

       Mirroring the z is what turns "over the leading tip" into "over the
       nose" or "over the tail"; blending between the two targets is what
       decides which shoulder gets which job. Riding forward the nose-side
       arm has the leading pose; riding switch it has the trailing one, on
       its own side of the body, and in the fifth of a second between them it
       has half of each — which is a rider swapping his hands over, and not a
       rider whose arms have crossed. */
    hand.z *= sw;
    other.z *= sw;
    pole.z *= sw;
    poleRear.z *= sw;
    tLead.copy(other).lerp(hand, front);
    tRear.copy(hand).lerp(other, front);
    pLead.copy(poleRear).lerp(pole, front);
    pRear.copy(pole).lerp(poleRear, front);

    solve(armLead, UPPER, FORE, tLead, pLead);
    solve(armRear, UPPER, FORE, tRear, pRear);

    /* --- shadow ------------------------------------------------------------ */

    // Pinned to the ground under the rider, fading and shrinking as the gap
    // opens, which is what makes a jump's height readable
    const gy = rider.world.height(rider.pos.x, rider.pos.z);
    const gap = Math.max(0, rider.pos.y - gy);
    shadow.position.set(rider.pos.x, gy + 0.05, rider.pos.z);
    const k = Math.max(0, 1 - gap / 14);
    const shadowScale = 0.55 + 0.45 * k;
    shadow.rotation.set(-Math.PI / 2, 0, rider.yaw);
    shadow.scale.set(shadowScale * 0.78, shadowScale * 1.28, 1);
    shadow.material.opacity = 0.30 * k * k;
    shadow.visible = k > 0.02;

    // The lamp asks for world-space head transforms, so it comes after every
    // part of the pose has been written. Weather remains the single owner of
    // whether it is night; this rig only adapts that state into light.
    if (weather && camera) headlamp.update(weather, dt, rider, camera);
  }

  return {
    root,
    shadow,
    update,
    rearBoot,
    headlamp,
    debug: () => ({
      push: s.push,
      rearBoot: rearBoot.position.toArray(),
      headlamp: headlamp.debug(),
    }),
  };
}
