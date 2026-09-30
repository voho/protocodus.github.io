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
import { GRAB_NOSE, GRAB_METHOD } from './rider.js';
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
const INK = '#181c24';
const SHELL = '#ff4d12';    // high-vis pro technical Gore-Tex jacket
const SHELL_DARK = '#cc3704';
const MINT = '#00d4ff';     // Alpine glacier ice goggles & collar accent
const YELLOW = '#ffab00';   // Alpine sun gold binding straps & wrist cuffs
const SKIN = '#c98f6a';
const DENIM = '#162342';    // deep navy technical snow pants
// Bare steel, pale enough that the board's green-channel trim test lights it
// as lacquer and mirrors the sky in it — the only metal on the rider.
const STEEL = '#aeb6c0';

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

   `DECK_DROP` is how far the deck's top came down when the board was made
   thin (see `DECK_COARSE`). Its base did not move, so everything standing
   on the top — the bindings, the ankles, the hips, the grab points — is
   lowered by exactly this and nothing else, and the rider above the deck is
   the same rider, 33 mm nearer the snow.
   -------------------------------------------------------------------------- */
const DECK_DROP = -0.033;
const ANKLE_Y = 0.33 + DECK_DROP;    // where the boot's cuff ends and the shin begins
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
const HIP_Y = 1.06 + DECK_DROP;      // hips at rest, unloaded
const HIP_Z = 0.115;     // hip sockets, narrower than the stance — legs splay
const THIGH = 0.42;
const SHIN = 0.40;
const WAIST = 0.07;      // the torso pivots this far above the hip sockets
const SHOULDER_Y = 0.40;
const SHOULDER_Z = 0.20;
const NECK_Y = 0.44;
const UPPER = 0.29;
const FORE = 0.29;       // shoulder to hand centre is therefore 0.58

const DECK_TOP = 0.076 + DECK_DROP;  // where the bindings bolt on, over the waist
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
  airReach: 0.30,     // seconds before touchdown the legs reach for it
  popNose: 0.45,      // radians of extra nose lift an ollie takes once airborne
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
  /* Three of them now, and the solved indy is the first row.

     The numbers for the other two are solved the same way and against the
     same 0.58 m of arm — what changes is where on the board the hand is going
     and therefore how the rest of the body has to arrange itself to get it
     there. Reaching past the front binding for the nose is a longer reach
     down the board and a shorter one across it, so the fold goes up and the
     board comes across less. A method is the opposite: the hand takes the
     *heel* edge, which is on the far side of the board from the toe edge the
     other two use, so the tweak reverses and the board has to come up much
     further to meet a hand that is now reaching behind the rider rather than
     in front of them.

     `point` is in the board's own frame — +X is the toe edge, −Z is the nose
     — and the row order is the one `RIDER.grabs` and `GRAB_INDY`/`GRAB_NOSE`/
     `GRAB_METHOD` in `rider.js` use. Three files agree about which grab is
     which, and the way they agree is that none of them writes the number.

     `lead` is which shoulder does the reaching, and it is data rather than a
     constant because the three of them genuinely differ: only the nose grab
     is a leading-hand grab. Routed through one arm for all of them, the method
     sent the leading arm across the body to the heel edge behind the rider,
     which is a shape nobody has ever made on a snowboard. */
  // Every `point` height carries `DECK_DROP`: the edge the hand closes on
  // came down with the thinner deck, and so did the boots the hips are
  // placed from, so the solved reach is unchanged.
  grabs: [
    // INDY — the trailing hand drops onto the toe edge between the feet
    { point: [0.155, 0.09 + DECK_DROP, -0.16], fold: 1.75, hip: 0.26, lift: 0.32, tweak: 0.15, hinge: 0, lead: false },
    // NOSE — the reach is along the board, so it is paid for at the waist's
    // pitch rather than at its fold: he hinges over the leading binding and
    // the hand carries on past it. Folding further instead only puts the
    // shoulder further across the board, which is the wrong axis entirely.
    { point: [0.095, 0.085 + DECK_DROP, -0.46], fold: 1.44, hip: 0.30, lift: 0.34, tweak: 0.05, hinge: 0.46, lead: true },
    // METHOD — the weight goes the other way and the board comes up much
    // further to meet a hand that is now reaching behind him, onto the edge
    // the other two never touch. The tweak reverses with it.
    { point: [-0.140, 0.090 + DECK_DROP, 0.06], fold: 1.66, hip: 0.23, lift: 0.42, tweak: -0.30, hinge: -0.26, lead: false },
  ],

  /* THE PRESS.

     Standing on one end of the board is a rotation of the deck about the
     contact point that is still buried, and everything else about the pose
     falls out of that one fact: the legs are solved against the bindings, the
     bindings are bolted to the deck, so tilting the deck folds one knee and
     straightens the other without a line of code saying which. What is left
     to author is the weight, and there is not much of it — the chest comes
     over the end being stood on, because that is where the rider has to put
     their mass to keep it down.

     `pitch` is deliberately shy of what a real press reaches. The board is
     drawn from the contact patch the physics owns, and every degree past this
     is a degree of daylight opening between the buried end and the snow. */
  pressPitch: 0.30,   // radians the deck comes up off the unweighted end
  pressLean: 0.115,   // metres the hips travel towards the end being stood on
  pressChest: 0.20,   // radians the chest comes over it
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
   jacket (0.6), a sleeve (0.85) and a helmet (1). It used to cover the
   snowboard too, at 0.4, and that is the one job it cannot do — see
   `slab`. */
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

/* A board's section: flat top, flat base, vertical sidewalls, and a corner
   of radius `c` between them — half-width `w`, half-thickness `t`.

   A superellipse cannot be this. Its twenty points are spaced by angle, so
   on a section twenty-three times wider than it is thick they bunch at the
   rails and the top is carried by two long chords, and what `round` 0.4
   produces at that aspect is a lens with soft shoulders — the surfboard.
   Here the flat faces are single spans and the corners get the points, so
   the normals do the right thing on their own: `computeVertexNormals` is
   area-weighted, the top face is a hundred times the area of the corner
   beside it, and so the top stays flat to the rail and turns in a
   millimetre and a half. The two middle points on the top and base cost
   nothing and keep the loft's quads from spanning the full width. */
const slab = (w, t, c) => {
  const k = c * (1 - Math.SQRT1_2);
  return [
    [w, 0], [w, t - c], [w - k, t - k], [w - c, t], [0, t],
    [-(w - c), t], [-(w - k), t - k], [-w, t - c], [-w, 0],
    [-w, -(t - c)], [-(w - k), -(t - k)], [-(w - c), -t], [0, -t],
    [w - c, -t], [w - k, -(t - k)], [w, -(t - c)],
  ];
};
/* …and the same idea for a thin strip laid on it, in six points: a flat
   face each side and a chamfer at each end. A decal or a steel edge runs the
   full length of the resampled deck, so every point on its section is paid
   for forty times over; six keep a wide stripe flat and give a strip three
   millimetres across a rounded bead of normals that catches a glint. */
const strip = (w, t) => [
  [w, 0], [w - t, t], [-(w - t), t], [-w, 0], [-(w - t), -t], [w - t, -t],
];

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
  const uvs = [];
  for (let i = 0; i < positions.length; i += 3) {
    uvs.push((positions[i] + 0.2) / 0.4, (positions[i + 2] + 0.8) / 1.6);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/* A stack of rings up the Y axis: limbs, torso, boots, helmet.

   `dome` is `[start, end]` in metres, and it is what a flat cap was hiding.
   Every tube here used to stop dead in a disc, and on a limb that is only
   ever seen end-on where it meets another one — the top of a thigh coming
   out of the seat, the top of a sleeve coming out of a shoulder — so the
   disc was the one thing the eye found at exactly the joints the rig bends.
   A dome continues the end ring along the tube's own axis in four shrinking
   rings on a quarter circle, so the solid finishes as a rounded end whose
   profile is the ring's own superellipse. It stops a fifth of the way short
   of the pole and keeps the ordinary flat cap on what is left, which is a
   disc a third the width of the tube, tucked inside whatever it meets: one
   degenerate ring at the pole would have handed `computeVertexNormals` a
   fan of zero-area triangles for nothing.

   Which way is "outward" is read off the neighbouring ring, so a table can
   run top-down or bottom-up and still dome away from itself. */
const DOME_STEPS = 4;
const domed = (list, dome) => {
  if (!dome || list.length < 2) return list;
  const grow = (end, next, h) => {
    if (!(h > 0)) return [];
    const dir = Math.sign(end.y - next.y) || 1;
    const rz = end.rz === undefined ? end.rx : end.rz;
    const out = [];
    for (let k = 1; k <= DOME_STEPS; k++) {
      const a = (k / (DOME_STEPS + 1)) * Math.PI / 2;
      out.push({
        ...end,
        y: end.y + dir * h * Math.sin(a),
        rx: end.rx * Math.cos(a),
        rz: rz * Math.cos(a),
      });
    }
    return out;
  };
  const n = list.length;
  return [
    ...grow(list[0], list[1], dome[0]).reverse(),
    ...list,
    ...grow(list[n - 1], list[n - 2], dome[1]),
  ];
};
const tube = (THREE, list, dome = null) => loft(THREE, domed(list, dome).map((s) => ringXZ(
  oval(s.n || 16, s.rx, s.rz === undefined ? s.rx : s.rz, s.round),
  s.y, s.x || 0, s.z || 0,
)));

/* THE KNEE AND THE ELBOW, which were a notch.

   Both joints are two tubes meeting at a pivot, each closed by a flat cap:
   the thigh stopped at the knee pivot and the shin began four and a half
   centimetres above it, the upper sleeve stopped at the elbow and the
   forearm began three above it. Straight, that is a seam nobody sees. Bent
   — and the knee is never less than fifty degrees bent, because that is how
   a snowboarder stands — the outside of the joint opened into a stepped
   "cut pipe" notch with a pale disc in it, which the sun found on every
   frame of every run.

   A solid centred on the pivot is the whole cure, and it is the whole cure
   for a reason worth stating: a ball about the hinge is unchanged by any
   rotation about the hinge, so it covers the outside of the bend at every
   angle the IK can produce, whichever of the two segments carries it. It is
   lofted rather than a stock sphere so it shares the limb's own ring — the
   same sixteen points and the same superellipse — and so its outline flows
   into the tubes either side instead of reading as a bead threaded on
   them. Both tubes now also end *at* the pivot, inside the ball, so no
   corner of either can poke out through it. */
const joint = (THREE, rx, rz, ry, round = 0.9, n = 16) => tube(THREE, [
  { y: -0.002, rx, rz, round, n },
  { y: 0.002, rx, rz, round, n },
], [ry, ry]);

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
/* THE DECK IS A CENTIMETRE AND A BIT, and it was five.

   The table used to give each station a centre and a half-thickness, and
   the half-thicknesses ran from ten to twenty-four millimetres — a board
   forty-eight millimetres through at the waist, with a superellipse of 0.4
   for a section, which is a surfboard. A snowboard's core is about twelve
   millimetres under the feet and tapers to a few at the tips, its top and
   base are flat, and its sidewall is a crisp vertical strip: from any
   distance that thinness *is* the object, and it is why a real board reads
   as a blade under the boots rather than a plank.

   So a station now says where its BASE is (`b`) and how thick it is (`t`).
   The bases are exactly the ones the old table implied — centre minus half
   the thickness — so the board meets the snow, the edge pivot and the
   contact patch precisely where they always were, and all of the thinning
   comes off the top. That moves the surface the bindings bolt to down by
   33 mm, and every number that stood on it moves with it: `DECK_TOP`,
   `ANKLE_Y`, `HIP_Y` and the three grab points, each by the same `DECK_DROP`,
   so the legs, the IK and the grab solutions see exactly the rider they
   were solved for, standing on a thinner board. `y` and `ry` are still
   derived below for everything that reads a centre line. */
const DECK_COARSE = [
  { z: -0.800, rx: 0.048, b: 0.140, t: 0.0050 },
  { z: -0.715, rx: 0.100, b: 0.105, t: 0.0070 },
  { z: -0.605, rx: 0.140, b: 0.069, t: 0.0090 },
  { z: -0.470, rx: 0.155, b: 0.041, t: 0.0110 },
  { z: -0.250, rx: 0.142, b: 0.029, t: 0.0130 },
  { z: 0.000, rx: 0.131, b: 0.035, t: 0.0135 },
  { z: 0.250, rx: 0.142, b: 0.029, t: 0.0130 },
  { z: 0.450, rx: 0.154, b: 0.041, t: 0.0110 },
  { z: 0.600, rx: 0.138, b: 0.070, t: 0.0090 },
  { z: 0.705, rx: 0.098, b: 0.106, t: 0.0070 },
  { z: 0.780, rx: 0.046, b: 0.138, t: 0.0050 },
];

/* …and eleven stations was a polygon. Lofted straight between them, the
   nose was five flat facets meeting in a nine-centimetre-wide flat end,
   which a sidewall a centimetre tall makes impossible to miss. So the table
   is resampled: a Catmull-Rom through every column, three spans to each
   interval, and then each tip is carried round a quarter-ellipse in plan
   — four more stations that close the outline to a rounded nose while the
   rocker carries on rising at the slope it arrived with. The coarse rows
   remain the authored truth; everything drawn is sampled from them. */
const DECK = (() => {
  const C = DECK_COARSE;
  const keys = ['z', 'rx', 'b', 't'];
  const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (p2 - p0) * u
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
  const fine = [];
  for (let i = 0; i + 1 < C.length; i++) {
    const p0 = C[Math.max(0, i - 1)];
    const p1 = C[i];
    const p2 = C[i + 1];
    const p3 = C[Math.min(C.length - 1, i + 2)];
    for (let k = 0; k < 3; k++) {
      const s = {};
      for (const key of keys) s[key] = cr(p0[key], p1[key], p2[key], p3[key], k / 3);
      fine.push(s);
    }
  }
  fine.push({ ...C[C.length - 1] });
  const tip = (end, inner, dir) => {
    const rise = (end.b - inner.b) / Math.abs(end.z - inner.z);
    const len = end.rx * 0.85;
    const out = [];
    for (let k = 1; k <= 4; k++) {
      const a = (k / 5) * Math.PI / 2;
      const dz = len * Math.sin(a);
      out.push({
        z: end.z + dir * dz,
        rx: end.rx * Math.cos(a),
        b: end.b + rise * dz,
        t: end.t * (1 - 0.25 * Math.sin(a)),
      });
    }
    return out;
  };
  const nose = tip(fine[0], fine[1], -1).reverse();
  const tail = tip(fine[fine.length - 1], fine[fine.length - 2], 1);
  return [...nose, ...fine, ...tail].map((s) => ({ ...s, y: s.b + s.t / 2, ry: s.t / 2 }));
})();
// The stations whose z lies in [z0, z1] — the overlays are placed by where
// they run along the board, not by an index into a table that is resampled.
const deckSpan = (z0, z1) => DECK.filter((s) => s.z >= z0 - 1e-6 && s.z <= z1 + 1e-6);

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

  /* The deck's section is a `slab` rather than an `oval`: see the note
     there. `grow` fattens it by the same distance on every face, which is
     how the nose and tail caps sit a hair proud of the deck all round
     rather than scaling a millimetre-thick tip into something that
     scaling only makes thicker. */
  const deckRings = (z0, z1, grow = 0) => deckSpan(z0, z1).map((s) => ringXY(
    slab(s.rx + grow, s.ry + grow, Math.min(0.0015, s.ry * 0.5)), s.z, 0, s.y,
  ));
  // A sticker: a thin slab following the deck's own curve, on the top or the
  // bottom face. It is how the board gets more than one colour without the
  // deck becoming four separate solids that have to agree along a seam. It
  // is a millimetre and a bit now, eight tenths of it proud of the face — a
  // decal, where the old eight-millimetre stripe was a keel.
  const sticker = (z0, z1, half, side) => deckSpan(z0, z1).map((s) => ringXY(
    strip(half, 0.0006), s.z, 0, s.y + side * (s.ry + 0.0002),
  ));
  /* THE STEEL EDGES, which were rubber bumpers.

     They were eleven-by-thirteen millimetre ink tubes hung under each rail,
     proud of the sidewall and the base both, and at any distance at which
     they could be seen they read as a fender round a dinghy. A snowboard's
     edge is a strip of steel two or three millimetres square let into the
     corner where the base meets the sidewall, flush with both, and the only
     thing it ever does visually is catch the light along that one line. So
     that is what this is: a 3.2 × 2.8 mm strip wrapped round the base's
     corner, four tenths of a millimetre proud of each face so it wins the
     depth test cleanly, in a grey pale enough that the board's own
     trim test gives it the lacquer lobe and the sky mirror — which is what
     bare steel looks like from a chairlift. */
  const edge = (z0, z1, sign) => deckSpan(z0, z1).map((s) => ringXY(
    strip(0.0016, 0.0014), s.z, sign * (s.rx - 0.0012), s.b + 0.0010,
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
  /* The baseplate sits six millimetres higher on its bolts than it did and
     is a little narrower, both for the thin deck. Sunk a centimetre, as it
     was into five centimetres of board, its underside now lands on the
     base plane itself; and at its old width its corners hung past the
     rails, which on a deck this thin reads as the plate wrapping the edge.
     Its top is still inside the boot's sole. */
  const plate = use(tube(THREE, [
    { y: -0.004, rx: 0.134, rz: 0.106, round: 0.45 },
    { y: 0.028, x: 0.010, rx: 0.130, rz: 0.102, round: 0.5 },
  ]));

  const binding = (z, yaw) => [
    { geo: plate, color: INK, pos: [0, DECK_TOP - 0.004, z], rot: [0, yaw, 0] },
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

  /* `uv: true`, because the deck wears a printed top-sheet now and a merged
     buffer without the attribute paints the whole board in one texel — the
     trap geom.js warns about, and the one this board was in. `loft` writes a
     planar top-sheet parameterisation for every ring solid; the material
     below confines the print to the deck by its colour, which is white for
     exactly that reason: the graphic is the deck's colour. (Top, base and
     sidewall all share that planar mapping, so the material also chooses
     *which face* of the white deck gets the print — see `boardMat`.) */
  const board = compose(THREE, [
    { geo: use(loft(THREE, deckRings(-Infinity, Infinity))), color: '#ffffff' },
    // a mint nose cap and a clipped dark tail: direction has to be legible
    // through spray, at night, and in the middle of a spin
    { geo: use(loft(THREE, deckRings(-Infinity, -0.605, 0.0008))), color: MINT },
    { geo: use(loft(THREE, deckRings(0.600, Infinity, 0.0008))), color: INK },
    // the stripe down the base, so a spin still reads from underneath
    { geo: use(loft(THREE, sticker(-0.605, 0.600, 0.044, -1))), color: MINT },
    // steel edges, following the sidecut from tip contact to tail contact
    { geo: use(loft(THREE, edge(-0.715, 0.705, -1))), color: STEEL },
    { geo: use(loft(THREE, edge(-0.715, 0.705, 1))), color: STEEL },
    // The feet are angled forward off the perpendicular, more at the front
    // than the back, because a duck-square stance is the one thing no
    // snowboarder rides.
    ...binding(-FOOT_Z, 0.28),
    ...boot(-FOOT_Z, 0.28),
    ...binding(FOOT_Z, 0.10),
  ], { uv: true });
  const rearBoot = compose(THREE, boot(0, 0.10));

  /* THE SEAT OF THE TROUSERS, which belongs to the hips and was welded to
     the chest.

     It used to be the first part of the torso buffer, and the torso turns
     about the waist: counter-rotation winds the shoulders a third of a turn
     against the pelvis, and a grab folds them past ninety degrees. Both of
     those swung the seat of the trousers round with the jacket while the
     thighs stayed on the hips, so the tops of the thighs came out of the
     side of it as two flat discs and the rider's backside faced wherever
     his chest did. The seat is its own buffer now, hung off the hips at the
     same waist pivot and in the same coordinates it always had, so it is
     drawn exactly where it was until the torso moves — and then it stays.

     The jacket's hem stays on the torso and still overlaps it, which is the
     order the clothes are actually worn in. The top is domed because a
     folded torso lifts the hem clear of it, and the crotch is domed because
     a deep crouch shows it from below. It is its own `clad`, woven and not
     quilted like the rest of the trousers — as a part of the torso it had
     been wearing the jacket's baffles. */
  const pelvis = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: -0.155, rx: 0.112, rz: 0.146, round: 0.55 },
      { y: -0.090, rx: 0.130, rz: 0.168, round: 0.55 },
      { y: -0.020, rx: 0.132, rz: 0.172, round: 0.6 },
    ], [0.045, 0.07])), color: DENIM },
  ]);

  /* The torso: wide across Z and shallow across X, because the shoulder line
     runs nose to tail and that is the single most snowboard-shaped thing
     about him. The jacket has a waist and a hem now — it pulls in above the
     seat and flares back out at the chest — which is most of the difference
     between a jacket and a crate. */
  const torso = compose(THREE, [
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
    { geo: box, color: INK, pos: [0.150, 0.20, 0], scale: [0.012, 0.30, 0.014] },
    { geo: box, color: YELLOW, pos: [0.158, 0.32, 0], scale: [0.015, 0.035, 0.022] },
    { geo: box, color: SHELL_DARK, pos: [0.132, 0.24, -0.075], scale: [0.03, 0.26, 0.045] },
    // A compact touring pack follows the torso through every grab and fall.
    { geo: use(tube(THREE, [
      { y: 0.015, x: -0.16, rx: 0.045, rz: 0.11, n: 12 },
      { y: 0.070, x: -0.19, rx: 0.070, rz: 0.14, n: 12 },
      { y: 0.285, x: -0.19, rx: 0.078, rz: 0.145, n: 12 },
      { y: 0.375, x: -0.17, rx: 0.056, rz: 0.12, n: 12 },
    ])), color: '#304b50' },
    { geo: box, color: INK, pos: [-0.264, 0.20, 0], scale: [0.012, 0.22, 0.018] },
    { geo: box, color: '#b8ccc5', pos: [-0.264, 0.12, 0], scale: [0.012, 0.024, 0.14] },
    ...[-1, 1].map((s) => ({ geo: box, color: INK,
      pos: [0.147, 0.29, s * 0.125], rot: [s * 0.12, 0, 0],
      scale: [0.016, 0.21, 0.030] })),
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
      a0: -1.18, a1: 1.18, steps: 14, r: 0.106, y: 0.136,
      depth: 0.032, height: 0.053, n: 8, round: 0.5,
    })), color: INK },
    { geo: use(arc(THREE, {
      a0: -1.15, a1: 1.15, steps: 14, r: 0.113, y: 0.136,
      depth: 0.028, height: 0.044, n: 8, round: 0.5,
    })), color: MINT },
    { geo: use(arc(THREE, {
      a0: 1.05, a1: 5.25, steps: 18, r: 0.120, y: 0.140,
      depth: 0.014, height: 0.026, n: 8, round: 0.5,
    })), color: SHELL_DARK },
    ...[-1, 1].map((s) => ({ geo: box, color: '#343c47',
      pos: [0.005, 0.278, s * 0.052], rot: [s * 0.30, 0, 0],
      scale: [0.09, 0.010, 0.017] })),
  ]);

  /* Every limb segment hangs down its own -Y from its joint, which is the
     only convention the IK needs to know about. The sleeves and legs taper,
     which is what stops a limb reading as a length of pipe once it throws a
     shadow of its own. */
  // The sleeve and its yoke band are domed at the shoulder: a raised arm
  // swings the top of the sleeve out of the shoulder's own dome, and what
  // came out was the flat end of a pipe.
  const upperArm = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: 0.055, rx: 0.078, rz: 0.074, round: 0.95, n: 16 },
      { y: -0.060, rx: 0.082, rz: 0.078, round: 0.9, n: 16 },
      { y: -0.180, rx: 0.070, rz: 0.068, round: 0.9, n: 16 },
      { y: -0.290, rx: 0.062, rz: 0.060, round: 0.9, n: 16 },
    ], [0.05, 0])), color: SHELL },
    { geo: use(tube(THREE, [
      { y: 0.070, rx: 0.080, rz: 0.076, round: 1, n: 16 },
      { y: -0.020, rx: 0.086, rz: 0.082, round: 0.95, n: 16 },
    ], [0.05, 0])), color: SHELL_DARK },
  ]);
  /* The one buffer whose parts do not agree about what they are made of, and
     therefore the only one that carries the mask per part rather than whole:
     a quilted sleeve, a hard cuff and a glove. A mitt is six centimetres
     across and the baffles are ten, so a band over one is not a baffle, it is
     a stripe — the glove is woven and it is not quilted. See `clad`. */
  const foreArmParts = [
    // The elbow: the sleeve bunched round the joint, a few millimetres
    // proud of both tubes because that is what a padded sleeve does when it
    // folds. It is a part of this list rather than of the upper arm so the
    // span walk in `clad` stays in step — it takes the sleeve's default
    // mask, quilted and woven, like the fabric either side of it.
    { geo: use(joint(THREE, 0.068, 0.066, 0.066, 0.92)), color: SHELL },
    { geo: use(tube(THREE, [
      { y: 0.000, rx: 0.065, rz: 0.063, round: 0.95, n: 16 },
      { y: -0.090, rx: 0.060, rz: 0.058, round: 0.9, n: 16 },
      { y: -0.185, rx: 0.054, rz: 0.052, round: 0.9, n: 16 },
    ])), color: SHELL },
    { geo: use(tube(THREE, [
      { y: -0.175, rx: 0.062, rz: 0.060, round: 0.9, n: 16 },
      { y: -0.215, rx: 0.060, rz: 0.058, round: 0.9, n: 16 },
    ])), color: YELLOW, cloth: [0.6, 0] },
    // the glove: a mitt with a thumb, which at this size is one extra bump
    // and the entire difference between a hand and a peg
    { geo: use(tube(THREE, [
      { y: -0.210, rx: 0.056, rz: 0.054, round: 0.9, n: 16 },
      { y: -0.265, x: 0.008, rx: 0.062, rz: 0.058, round: 0.85, n: 16 },
      { y: -0.320, x: 0.010, rx: 0.058, rz: 0.052, round: 0.85, n: 16 },
      { y: -0.352, x: 0.006, rx: 0.040, rz: 0.038, round: 0.95, n: 16 },
    ])), color: INK, cloth: [1, 0] },
    { geo: use(tube(THREE, [
      { y: -0.250, rx: 0.026, rz: 0.024, round: 0.9, n: 12 },
      { y: -0.290, rx: 0.022, rz: 0.020, round: 0.9, n: 12 },
    ])), color: INK, pos: [0.05, 0, -0.02], rot: [0, 0, -0.5], cloth: [1, 0] },
  ];
  const foreArm = compose(THREE, foreArmParts);
  // Domed at the hip, where the top of the thigh comes out of the seat on
  // the outside of every deep crouch and every grab.
  const thigh = compose(THREE, [
    { geo: use(tube(THREE, [
      { y: 0.070, rx: 0.108, rz: 0.104, round: 0.9 },
      { y: -0.080, rx: 0.116, rz: 0.112, round: 0.75 },
      { y: -0.260, rx: 0.100, rz: 0.098, round: 0.75 },
      { y: -0.420, rx: 0.086, rz: 0.086, round: 0.85 },
    ], [0.075, 0])), color: DENIM },
    { geo: box, color: '#24324c', pos: [0.106, -0.15, 0],
      scale: [0.025, 0.14, 0.11] },
    { geo: box, color: INK, pos: [0.122, -0.085, 0],
      scale: [0.008, 0.016, 0.105] },
  ]);
  const shin = compose(THREE, [
    // The knee, a touch deeper front to back than across so it reads as a
    // kneecap under the cloth rather than a ball bearing.
    { geo: use(joint(THREE, 0.093, 0.090, 0.090, 0.88)), color: DENIM },
    { geo: use(tube(THREE, [
      { y: 0.000, rx: 0.089, rz: 0.088, round: 0.85 },
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
  /* WHICH OF HIM IS CLOTH, AND WHICH OF HIM IS QUILTED, which are two
     questions and therefore two numbers.

     The rig is eleven meshes sharing one material, and the material has no
     way to tell a jacket from a helmet: both arrive as vertex colours, and
     ink is the helmet, the gloves, the boots and the trouser cuff at once, so
     colour cannot separate them either.

     They were one number once, on the reasoning that a depth would serve for
     both — trousers at four tenths meaning "woven, barely baffled". It does
     not serve, and the reason is that the two masks want opposite answers
     from the same surface rather than a weaker version of one answer.
     Snowboard trousers are fully woven and not quilted at all: the insulation
     is on the inside where nobody can see it. Four tenths gave them four
     tenths of the ripple the shader was written specifically to keep off
     them, which is the moire the comment beside it warns about, and no single
     scalar can say "all of the sheen, none of the bands".

     So `x` is how woven the surface is and `y` is how quilted, and the glossy
     trim inside a garment is still taken out downstream by the same
     green-channel test that gives it its highlight. */
  const clad = (geometry, sheen, baffle, parts, flap = null) => {
    const n = geometry.attributes.position.count;
    const a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      a[i * 2] = sheen;
      a[i * 2 + 1] = baffle;
    }
    /* …and then whatever any individual part asked to differ about.

       `compose` concatenates its parts in order and keeps every corner of
       every face, so a part's vertices are one contiguous run whose length is
       its stock geometry de-indexed. That is the same single assumption
       `props.js` makes for its snow-ownership mask, and it is here for the
       same reason: after the bake there is nothing left in the buffer to sort
       the parts by. Only the forearm uses it, because only the forearm has a
       glove baked into a sleeve. */
    if (parts) {
      let o = 0;
      for (const part of parts) {
        const span = part.geo.index
          ? part.geo.index.count : part.geo.attributes.position.count;
        if (part.cloth) {
          for (let i = o; i < o + span; i++) {
            a[i * 2] = part.cloth[0];
            a[i * 2 + 1] = part.cloth[1];
          }
        }
        o += span;
      }
    }
    geometry.setAttribute('aCloth', new THREE.BufferAttribute(a, 2));
    /* A third question, and a third attribute: how free the cloth is to
       move. Every segment gets one — the material is shared, and a program
       reading an attribute a geometry does not carry is reading whatever
       the driver left in that slot — and all but two of them are zero. See
       `flapTorso`, `flapSleeve` and the flutter in the material. */
    const f = new Float32Array(n);
    if (flap) {
      const p = geometry.attributes.position;
      for (let i = 0; i < n; i++) f[i] = flap(p.getX(i), p.getY(i), p.getZ(i));
    }
    geometry.setAttribute('aFlap', new THREE.BufferAttribute(f, 1));
    return geometry;
  };

  /* WHERE THE JACKET IS LOOSE, which is at the bottom.

     A shell is held at the shoulders and hangs, so the hem is the one edge
     of it with nothing holding it down: weight 1 at the hem, easing to
     nothing by the chest (0.16 m up the torso), where the jacket is lying
     on the rider rather than standing off him. The back is pinned — that is
     where the pack's hip belt crosses it — so the weight fades out as the
     surface turns from the side of the body to the back of it, which also
     keeps the flutter from pushing the jacket out through the pack.

     It is written over the whole torso buffer rather than per part because
     everything on the front of the jacket in that band — the mint stripe,
     the zip, the pocket — has to move with the shell it is sewn to, or the
     shell would bulge out through its own trim. The displacement is radial
     in the garment's own XZ (see the material), so a box on the front moves
     as one piece instead of splitting along its face normals. */
  const flapTorso = (x, y, z) => {
    const r = Math.hypot(x, z);
    const facing = r > 1e-5 ? x / r : 0;
    return (1 - smooth01((y + 0.095) / 0.255)) * smooth01((facing + 0.55) / 0.45);
  };
  /* …and a little down the outside of each upper sleeve: nothing at the
     shoulder seam, a third of the hem's freedom through the middle of the
     sleeve, and nothing again by the elbow so the sleeve cannot peel away
     from the ball it meets there. The two arms share this geometry and the
     IK rolls each one freely about its own bone, so there is no "outer"
     side to single out; the inner one is against the ribs, where nobody can
     see it move. */
  const flapSleeve = (x, y) => 0.32 * smooth01(-y / 0.08) * (1 - smooth01((-y - 0.20) / 0.06));

  return {
    board,
    rearBoot: clad(rearBoot, 0, 0),
    pelvis: clad(pelvis, 1, 0),
    torso: clad(torso, 1, 1, null, flapTorso),
    head: clad(head, 0, 0),
    upperArm: clad(upperArm, 1, 1, null, flapSleeve),
    foreArm: clad(foreArm, 1, 1, foreArmParts),
    thigh: clad(thigh, 1, 0),
    shin: clad(shin, 1, 0),
  };
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

  /* The headlamp's level, shared into both rig materials the same way the
     shading module shares the sky: one object, two readers, one write per
     frame. At night the lamp lights a pool forty metres down the hill and
     the man carrying it stayed as dark as the rocks, which is exactly
     backwards — a head torch spills off the snow, the goggles and the
     falling flakes straight back onto its wearer. The value is written at
     the bottom of `update`, after the lamp has decided how lit it is. */
  const lampUniform = { value: 0 };

  /* The rider next to the snow.

     The hill is a GGX dielectric with the sky in its Fresnel term, and the
     figure standing on it was pure Lambert — under the same sun the mountain
     glittered and the man read as a paper cut-out pasted over it. Three
     small terms close that gap, added after the light loop exactly the way
     the terrain's snow response is, and using the same shared uniforms.

     A tight Blinn lobe carries the sun. It is masked by the green channel of
     the vertex colour, and that mask is less arbitrary than it looks: the
     palette's hard, glossy surfaces — the board's topsheet and nose cap, the
     goggle visor, the binding straps, the collar trim — are exactly the mint
     and yellow parts, and mint and yellow are the only two colours in the
     palette with a bright green channel (the orange shell is at 0.10 in
     linear light, denim and ink lower still). So plastic gets a real
     highlight, cloth keeps a weak sheen, and nobody had to tag a vertex.

     A sky-coloured rim separates the silhouette from the snow — it is the
     same argument as the terrain's grazing Fresnel, at a fraction of the
     gain, and because it is `uSkyMid` it stays in palette through the whole
     day cycle: blue at noon, amber at dusk, near-black at night.

     And the lamp's spill, above, arrives as a cool fill on the fragments
     facing the camera, so the rider reads as the thing carrying the light
     rather than a shadow between two lit patches of snow. */
  const RIG_ANCHOR = '#include <lights_fragment_end>';
  /* `power` is the lobe: fifty for a shell and its trim, a hundred and
     forty for lacquer. `envBase`/`envTrim` are how much of the sky the
     surface mirrors — the shared shading's own analytic dome, `n64SkyReflect`,
     which is already compiled into every patched material for the snow's
     Fresnel and costs two powers here. Schlick's curve puts it at the
     grazing edge of a sleeve and across the whole of a goggle lens, and it
     stays in palette by construction: navy at noon, amber at dusk. */
  const rigLight = (base, gloss, fabric = false, power = 50, envBase = 0, envTrim = 0.9) => `${RIG_ANCHOR}
  {
    vec3 n64V = normalize(-vN64View);
    float n64NoV = max(dot(normal, n64V), 0.0);
    vec3 n64HalfSum = uSunView + n64V;
    vec3 n64H = n64HalfSum * inversesqrt(max(dot(n64HalfSum, n64HalfSum), 1e-6));
    float n64NoL = clamp(dot(normal, uSunView), 0.0, 1.0);
    float n64Trim = smoothstep(0.30, 0.50, diffuseColor.g);
    float n64Fabric = 1.0 + 0.06 * sin(dot(normal, vec3(17.0, 31.0, 13.0)));
    float n64Spec = pow(max(dot(normal, n64H), 0.0), ${power.toFixed(1)}) * n64NoL
      * (${base.toFixed(3)} + ${gloss.toFixed(3)} * n64Trim) * n64Fabric;
    float n64Rim = pow(1.0 - n64NoV, 2.5);
    /* WHETHER THE SUN IS ACTUALLY ON THIS PIXEL.

       Everything added here is added after the light loop, so none of it
       went through the shadow test: a rider carving through the shade of a
       spruce, or down the bar the containment wall lays across the piste at
       dusk, kept a full sun highlight on the topsheet and a sunlit sheen on
       both sleeves — lit from a sun the rest of the picture said was gone.
       The loop has already paid for the answer, though. With one
       directional light, direct diffuse is albedo · NoL · sun · shadow / π,
       and every factor but the shadow is in scope here, so dividing them
       out recovers the depth map, the mountain's own horizon and the cloud
       deck together — the same recovery the snow uses, and no second
       shadow-map lookup. Near the terminator the ratio is undefined, but
       every term it gates is multiplied by NoL and has already gone to
       nothing there. */
    float n64Open = clamp(
      dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722))
        / max(max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3)
          * n64NoL * uSunLevel * dot(uSunTint, vec3(0.2126, 0.7152, 0.0722))
          * RECIPROCAL_PI, 1e-5),
      0.0, 1.0);
    n64Spec *= n64Open;
    /* The snow's bounce comes up from below — from the world's below. This
       read the view-space y of the normal, which is "down the screen", so
       it lit whichever surfaces faced the bottom of the frame: the rider's
       back when the camera was high, nothing at all when it was low. World
       up in view space is the view matrix's second column, the same axis
       the terrain's strata test uses. And the snow under the rider is only
       sunlit if the ground there is, so it dims with the mountain's shadow
       and the cloud deck (not with the rider's own shadow, which falls on
       the snow beside him rather than all of it). */
    float n64GroundBounce = max(-dot(normal, viewMatrix[1].xyz), 0.0) * 0.18;
    #ifdef N64_SUN_VIS
      n64GroundBounce *= n64SunVis;
    #endif
    vec3 n64SnowBounceColor = vec3(0.85, 0.92, 1.0) * uSunLevel * n64GroundBounce;
    vec3 n64R = normalize(reflect(-n64V, normal) * mat3(viewMatrix));
    float n64Fres = 0.04 + 0.96 * pow(1.0 - n64NoV, 5.0);
    vec3 n64Mirror = n64SkyReflect(n64R)
      * (n64Fres * (${envBase.toFixed(3)} + ${envTrim.toFixed(3)} * n64Trim));
    reflectedLight.directDiffuse += uSunTint * (uSunLevel * n64Spec)
      + uSkyMid * (n64Rim * 0.22) + n64SnowBounceColor + n64Mirror
      + vec3(0.45, 0.62, 0.85) * (uLampGlow * (0.35 + 0.65 * n64NoV) * 0.12);${fabric ? `
    /* THE SHEEN CLOTH HAS AND PLASTIC DOES NOT.

       The tight lobe above is a lacquer highlight: it is small, it moves
       across the surface as the light does, and it is exactly wrong for a
       shell jacket. Woven fabric is a forest of fibres standing off the
       surface, so what it does with a light is scatter it into a wide,
       soft band at grazing incidence — the reason the shoulder and the
       outside of a sleeve go pale in a photograph while the middle of the
       chest stays saturated. That band is the difference between a garment
       and a moulding, and no amount of the other lobe produces it.

       It is a retroreflective asperity term rather than a mirror one, so it
       keys off the sun's own grazing angle and not off the half vector:
       fabric is bright where the light is skimming it, whatever the camera
       is doing. Multiplied by NoL, so it is a property of lit cloth and
       cannot glow in shadow, and carried in the sun's tint so it warms and
       cools with the day like everything else on this mountain. */
    float n64Graze = 1.0 - abs(dot(normal, uSunView));
    reflectedLight.directDiffuse += uSunTint
      * (uSunLevel * n64NoL * n64Open * n64Graze * n64Graze * n64Graze * 0.085
        * vCloth.x * (1.0 - n64Trim));` : ''}
  }`;

  /* THE BAFFLES, which are what a shell jacket has instead of a surface.

     The rig is lofted well enough that its silhouette is right and its
     shadow is right, and it still read as one continuous piece of moulded
     plastic — because it was one continuous piece of smooth geometry with
     one flat colour on it, and the only thing describing the material was a
     highlight the same shape as the one on the board. A jacket is not
     smooth. It is a stack of down-filled tubes stitched across the body
     every eight or nine centimetres, and the seams between them are the
     single most legible thing about outerwear at any distance.

     The ripple runs along each garment's *own* local Y, which is what makes
     this cost one attribute and no thought: the torso stands up its Y, and
     every limb segment hangs down its Y from its joint by the convention the
     IK already relies on, so one expression puts horizontal baffles on the
     chest and rings around the sleeves and legs at the same time — and they
     stay welded to the garment through every pose, because local space is
     where the garment lives.

     Turning a height ripple into a normal needs the surface direction the
     ripple runs along, which is that same axis with the part of it pointing
     out of the surface removed. On a lofted limb that lands exactly along
     the tube; on the shoulder's dome it lies over and fades out on its own,
     which is what a baffle does where it wraps.

     The seam also takes a little light out of the albedo, because a stitched
     valley is genuinely in shadow from its own two pillows, and half a cue
     is worth more than a normal on its own when the sun is behind the rider.

     Glossy trim is excluded by the same green-channel test that gives it its
     highlight: the collar, the pocket zips and the binding straps are not
     quilted, and nothing had to be tagged twice to say so.

     It reads `aCloth.y` and the sheen reads `aCloth.x`, and the trousers are
     why they are two numbers. Every garment on him gets the sheen, because
     every garment is woven; only the jacket is baffled, because snowboard
     trousers are a smooth shell with the insulation quilted on the inside
     where nobody can see it. As one number turned down the legs came out in
     chevrons — a strong ripple against a sixteen-sided tapered tube is a
     moire waiting to happen — and turning it down far enough to stop that
     took the sheen with it. Two masks, and each says exactly one thing. */
  const RIG_NORMAL_ANCHOR = '#include <normal_fragment_maps>';
  const CLOTH_BAFFLES = `${RIG_NORMAL_ANCHOR}
  {
    float n64Cloth = vCloth.y
      * (1.0 - smoothstep(0.30, 0.50, diffuseColor.g));
    if (n64Cloth > 0.002) {
      // 2π / 0.098 m: baffles a little under ten centimetres apart.
      float n64BafflePhase = vLocalY * 64.11;
      // …and they dissolve before a seam can approach the pixel grid, which
      // it does whenever he is thrown a long way down the hill.
      float n64Baffle = sin(n64BafflePhase) * n64Cloth
        * (1.0 - smoothstep(0.9, 2.4, fwidth(n64BafflePhase)));
      vec3 n64Along = vClothAxis - normal * dot(normal, vClothAxis);
      float n64AlongLen = length(n64Along);
      if (n64AlongLen > 0.001) {
        normal = normalize(normal + n64Along * (n64Baffle * 0.13 / n64AlongLen));
      }
      diffuseColor.rgb *= 1.0 - 0.055 * max(0.0, -n64Baffle);
    }
    /* …and the weave itself as relief. The same plate the colour reads,
       differenced across three texels, leans the normal along the plane's
       two axes — so a ripstop grid catches the sun as a grid and the sleeve
       stops reading as painted. Two fetches on a figure that is a few
       hundred pixels tall. */
    if (vCloth.x > 0.05) {
      vec2 n64WUv = n64WeaveUv();
      float n64W0 = dot(texture2D(uFabricTex, n64WUv).rgb, vec3(0.3333));
      float n64W1 = dot(texture2D(uFabricTex, n64WUv + vec2(0.003, 0.0)).rgb, vec3(0.3333));
      float n64W2 = dot(texture2D(uFabricTex, n64WUv + vec2(0.0, 0.003)).rgb, vec3(0.3333));
      normal = normalize(normal + (vClothAcross * (n64W0 - n64W1)
        + vClothAxis * (n64W0 - n64W2)) * (1.1 * vCloth.x));
    }
  }`;

  /* One smooth material for the lot: colours are already in the vertices, so
     eleven meshes are eleven draw calls and not one state change. The rider
     is lit by exactly the same moving sun and atmosphere as the hill, which
     keeps the figure grounded in the scene rather than pasted over it. Its
     own `onBeforeCompile` runs first and the shading patch is layered over
     it — `shading.apply` keeps a prior hook and folds its text into the
     program cache key, so this material cannot collide with the plain
     Lambert everything else on the mountain compiles to. */
  const fabricTex = new THREE.TextureLoader().load(
    new URL('../assets/textures/rider/rider-fabric.jpg', import.meta.url).href,
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; },
  );
  fabricTex.colorSpace = THREE.SRGBColorSpace;
  fabricTex.anisotropy = 8;

  /* THE WIND IN HIS JACKET. Nothing on the rider moved in the wind: at a
     hundred and twenty km/h he was a man in a coat carved out of wood. The
     cloth material now pushes every vertex out by `aFlap` (see `clad`) times
     this many metres, rippling on two sines whose phases are these two
     numbers.

     The amplitude is a speed and nothing else — two millimetres of stir
     standing still, half a millimetre more for every metre a second, capped
     at two centimetres — because the air a rider feels is almost entirely
     his own speed through it; the weather's wind is a few metres a second
     against thirty. The phases are advanced here, wrapped to a turn each in
     double precision, rather than handed to the shader as a clock: the two
     rates are deliberately incommensurate so the ripple never repeats, which
     means there is no time at which a shared clock could wrap invisibly, and
     a float clock left to grow turns a fine ripple into shimmer an hour into
     a session. A phase that is always inside one turn cannot do either. */
  const flapUniform = { value: 0 };
  const flapPhase = { value: new THREE.Vector2() };

  const cloth = (() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLampGlow = lampUniform;
      shader.uniforms.uFabricTex = { value: fabricTex };
      shader.uniforms.uFlap = flapUniform;
      shader.uniforms.uFlapPhase = flapPhase;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aCloth;
          attribute float aFlap;
          uniform float uFlap;
          uniform vec2 uFlapPhase;
          varying vec2 vCloth;
          varying float vLocalY;
          varying vec3 vClothAxis;
          varying vec3 vClothAcross;
          varying vec3 vClothLocalN;
          varying vec3 vClothWorld;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vCloth = aCloth;
          vLocalY = position.y;
          vClothAxis = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
          /* The weave is projected along whichever of the garment's own
             horizontal axes faces this vertex least — a limb is a tube, so
             one projection stretches on half of it — and the relief below
             needs that plane's across-axis in view space. */
          vClothLocalN = normal;
          vClothAcross = normalize(normalMatrix
            * (abs(normal.x) > abs(normal.z) ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
          /* Rig-local, not world. Sampled at the world position the weave
             streamed across the jacket as the rider moved — cloth crawling
             over its own wearer — and kilometres into a run the UV grew
             into the tens of thousands, where float precision turns a
             fine weave into shimmer. Local coordinates travel with the
             cloth and stay small forever. */
          vClothWorld = transformed;
          /* The flutter, after every varying above has been written from
             the rest shape — the baffles and the weave are sewn into the
             cloth, so they ride on it rather than sliding over it.

             Outwards only, radially from the garment's own axis. Radially
             because the zip and the pocket on the front are boxes, whose
             corners carry three different face normals each: pushed along
             those they would come apart at every edge, and pushed along the
             one radial direction they move as a piece with the shell they
             are sewn to. Outwards only — the ripple runs from none to full
             rather than either side of rest — for the shadow's sake. The
             depth pass is three's own depth material and never sees this,
             so the cast shadow is the jacket at rest; that is two
             centimetres of hem on the snow, which nobody can see, and it is
             deliberately left rigid rather than paying for a custom depth
             material on eleven meshes. What would show is the jacket
             shadowing *itself*: a fragment pushed inwards would sit behind
             its own rest depth and fall into its own shadow in moving
             blotches. Pushed outwards it is always nearer the light than the
             surface that cast the map, so it can only ever be lit. */
          if (aFlap > 0.0 && uFlap > 0.0) {
            vec3 n64Out = vec3(position.x, 0.0, position.z);
            float n64OutLen = length(n64Out);
            if (n64OutLen > 1e-4) {
              float n64Ripple = 0.6 * sin(uFlapPhase.x + position.y * 23.0 + position.z * 11.0)
                + 0.4 * sin(uFlapPhase.y - position.y * 9.0 + position.x * 19.0);
              transformed += n64Out * (aFlap * uFlap * (0.5 + 0.5 * n64Ripple) / n64OutLen);
            }
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uLampGlow;
          uniform sampler2D uFabricTex;
          varying vec2 vCloth;
          varying float vLocalY;
          varying vec3 vClothAxis;
          varying vec3 vClothAcross;
          varying vec3 vClothLocalN;
          varying vec3 vClothWorld;
          vec2 n64WeaveUv() {
            return (abs(vClothLocalN.x) > abs(vClothLocalN.z)
              ? vClothWorld.zy : vClothWorld.xy) * 6.0;
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vCloth.x > 0.05) {
            vec3 weave = texture2D(uFabricTex, n64WeaveUv()).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * weave * 1.55, 0.45 * vCloth.x);
          }`)
        .replace(RIG_NORMAL_ANCHOR, CLOTH_BAFFLES)
        .replace(RIG_ANCHOR, rigLight(0.12, 0.30, true));
    };
    return shading.apply(m);
  })();

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
  /* The top-sheet: the board photograph cropped to the deck and turned so
     its length runs up v — the parameterisation `loft` writes — with the
     deck's own u range inside the print's edges (see `GENERATED.md`). */
  const boardGraphicTex = new THREE.TextureLoader().load(
    new URL('../assets/textures/rider/snowboard-topsheet.webp', import.meta.url).href,
  );
  boardGraphicTex.colorSpace = THREE.SRGBColorSpace;
  boardGraphicTex.anisotropy = 8;

  const boardMat = (() => {
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: false,
      map: boardGraphicTex,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uBend = flexUniform;
      shader.uniforms.uLampGlow = lampUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uBend;
          varying float vDeckUp;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vDeckUp = normal.y;
          {
            float u = clamp(transformed.z / ${FLEX_SPAN.toFixed(3)}, -1.0, 1.0);
            transformed.y += uBend * (1.0 - u * u);
          }`);
      // The same light terms as the cloth, with a much harder lobe and the
      // sky in it: a topsheet is lacquer, not fabric, and it is the one
      // surface here that ought to flash as a carve rolls it through the
      // sun. The print goes on the deck alone — the deck is the one white
      // part, so the bindings and boots keep their own colours.
      /* …and on the deck's TOP alone, which it was not. `loft` gives every
         vertex of a ring solid the same planar (x, z) mapping, so the base
         and the sidewall carried the top-sheet too — the base showed the
         graphic mirrored through the board, which is exactly what a board
         seen from underneath in a spin must not do, and the sidewall was a
         smear of the print's edge pixels. The face is chosen by the
         board-space normal, which `compose` has already carried through
         every part's own transform and which the flex never touches: up is
         the print, down is a sintered base — near-black with a little blue
         in it, the colour every base is before it is waxed — and the rest
         is the black ABS sidewall. The blends run over the corner's own
         normals, so the turn from face to rail is a millimetre-wide ramp
         rather than a seam. */
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uLampGlow;
          varying float vDeckUp;`)
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
          {
            vec4 n64Sheet = texture2D( map, vMapUv );
            float n64Deck = step(2.9, vColor.r + vColor.g + vColor.b);
            vec3 n64Face = mix(vec3(0.009, 0.009, 0.011), n64Sheet.rgb,
              smoothstep(0.30, 0.70, vDeckUp));
            n64Face = mix(n64Face, vec3(0.017, 0.021, 0.029),
              smoothstep(0.30, 0.70, -vDeckUp));
            diffuseColor.rgb *= mix(vec3(1.0), n64Face, n64Deck);
          }
          #endif`)
        .replace(RIG_ANCHOR, rigLight(0.18, 0.45, false, 140, 0.35, 0.65));
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
  /* The jacket is its own mesh inside the torso group, rather than the
     group's only geometry, because breathing scales it — see the note at
     `breath` — and a scale on the group would be inherited by the head and
     both arms hanging off it. */
  const torsoMesh = new THREE.Mesh(geo.torso, cloth);
  torsoMesh.name = 'rider-torso';
  torso.add(torsoMesh);
  hips.add(torso);
  /* The seat of the trousers, at the waist pivot but on the hips' side of
     it — see `pelvis` in `buildGeometries`. It is a mesh on the shared
     material like every other segment, so the shadow pass and the lamp
     spill both pick it up without being told. */
  const pelvisMesh = new THREE.Mesh(geo.pelvis, cloth);
  pelvisMesh.name = 'rider-pelvis';
  pelvisMesh.position.set(0, WAIST, 0);
  hips.add(pelvisMesh);

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
  // The last attitude drawn in the air, and what is left of it once the board
  // is down; see the note where `up` is chosen.
  const airUpDrawn = new THREE.Vector3(0, 1, 0);
  const upGlide = new THREE.Quaternion();
  const NO_TURN = new THREE.Quaternion();
  let flewLast = false;
  let gliding = false;

  /* The blob shadow's frame, preassembled. `shadowFlat` is the constant
     -PI/2 about X that lays the disc into the ground plane; the spin and the
     tilt are rewritten every frame in `update`. Composed as tilt·spin·flat
     the disc is first laid flat, then aimed, then bent onto the slope — so
     on steep ground it lies *in* the ground instead of slicing through it,
     which is what used to clip it to a crescent against the depth buffer. */
  const shadowFlat = new THREE.Quaternion().setFromAxisAngle(AX, -Math.PI / 2);
  const shadowSpin = new THREE.Quaternion();
  const shadowTilt = new THREE.Quaternion();
  const shadowUp = new THREE.Vector3(0, 1, 0);

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
    twist: 0, lean: 0, comp: 0, pop: 0, thump: 0, tumbleLag: 0, wash: 0, press: 0, airTuck: 0,
    edge: 0, load: 0, steer: 0, switched: 0,
    // the head's lead into a turn, and the follow-through spring's state:
    // the slow copies of the two accelerations, then position and velocity
    // along the travel and across the board
    yawLast: 0, yawRate: 0, aF: 0, aL: 0, fx: 0, fv: 0, lx: 0, lv: 0,
  };
  const velPrev = new THREE.Vector3();
  const _acc = new THREE.Vector3();
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
    /* The knees come up off the lip and go back down to meet the snow. In
       the last `airReach` seconds before the predicted touchdown the legs
       reach for the landing, so the landing has a leg's length to fold them
       through — held tucked all the way down, the thump had nothing to
       absorb with and the rider arrived already folded. */
    const reach = rider.state === 'air' && Number.isFinite(rider.touchdownIn)
      ? clamp(1 - rider.touchdownIn / POSE.airReach, 0, 1) : 0;
    s.airTuck = approach(s.airTuck, rider.state === 'air' ? 1 - reach : 0, 13, sdt);
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
    /* Which of the three reaches the hand went for, and how far the board is
       tilted up on one end. Both are read once, here, so every consumer below
       is looking at the same grab and the same press. */
    const G = POSE.grabs[rider.grabKind] || POSE.grabs[0];
    const press = (rider.press || 0) * (1 - s.air) * (1 - s.down);
    /* Which end of the board is buried, in the board's own frame. Positive
       pitch raises the −Z end, so a press on that end is the negative one.

       It is read from the physics rather than rebuilt from `pressNose` and
       the live stance, and that is the whole of the fix: a butter that passes
       ninety degrees toggles the stance while the same press is still on, so
       a sign multiplied by `sw` eased the pitch through flat and stood the
       rider up on the opposite end halfway through his own spin. The end a
       press captured cannot change until the press ends. */
    const pressEnd = rider.pressEnd || -1;
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

    /* --- anticipation and follow-through --------------------------------- */

    /* Every signal above is a first-order approach, and a first-order
       approach can only ever arrive late and never go past: nothing on the
       rider looked into a turn before his body was in it, and nothing
       carried on after the board stopped. Those are the two oldest tricks
       in animation for a reason, and both are cheap here.

       THE HEAD LEADS. A rider looks where he is going, and where he is going
       is round the turn he is already in, so the head is turned into it by
       how fast the board is yawing — differenced from the yaw the model is
       drawn with, wrapped, because a landed 720 hands this file a heading
       whole turns away from the last one. Anything bigger than a third of a
       radian in a frame is a snap or a teleport, not a turn, and is thrown
       away. Only on the snow: in the air the rate is a spin, which the
       shoulders already trail, and the smoothed rate is let go to zero so
       that nothing of the spin is left in the neck at touchdown. The sign is
       the model's: the rig turns by −yaw, so a positive rate turns the head
       negative. It is capped at a fifth of a turn, and three tenths of it is
       carried in the chest, because nobody turns their head that far
       without their shoulders coming with it. */
    let dyaw = rider.yaw - s.yawLast;
    dyaw -= TAU * Math.round(dyaw / TAU);
    s.yawLast = rider.yaw;
    if (snap || Math.abs(dyaw) > 0.35) dyaw = 0;
    s.yawRate = approach(s.yawRate,
      rider.grounded && step > 1e-4 ? dyaw / step : 0, 6, sdt);
    const lead = clamp(-0.4 * s.yawRate, -0.35, 0.35)
      * upright * (1 - s.air) * (1 - skate);

    /* THE BODY FOLLOWS THROUGH. The root's acceleration, in the travel frame
       — along the direction he is going and across the board — drives a
       small, underdamped spring (ω = 14, ζ = 0.35: it rings about twice and
       is gone inside half a second), and the spring's displacement is the
       body's inertia: the hands and the chest lag an acceleration and
       overshoot when it stops. A braking scrub pitches him over the nose
       and lets him back; a carve reversal swings the hands across and back;
       a skidded landing throws everything forward and recovers.

       Six tenths of a slow copy of the acceleration is taken back out of
       the input, so a *sustained* pull — the centripetal load of a long
       carve, the downhill pull of the slope itself — leaves only a small
       standing offset and the authored poses stay where they were put. It
       is the changes that ring. The physics velocity is read rather than
       the drawn position twice differenced, which is noise, and the input
       is clamped, because a landing is a velocity change in one step and the
       spring would otherwise read it as fifty g. It is integrated in
       substeps so the spring means the same thing at 30 Hz as at 144. */
    if (snap) {
      velPrev.copy(rider.vel);
      s.aF = s.aL = s.fx = s.fv = s.lx = s.lv = 0;
    }
    _acc.copy(rider.vel).sub(velPrev).multiplyScalar(1 / Math.max(step, 1e-3));
    velPrev.copy(rider.vel);
    {
      const cyaw = Math.cos(rider.yaw);
      const syaw = Math.sin(rider.yaw);
      const aF = clamp((_acc.x * syaw - _acc.z * cyaw) * sw, -25, 25);
      const aL = clamp(_acc.x * cyaw + _acc.z * syaw, -25, 25);
      s.aF = approach(s.aF, aF, 1.5, sdt);
      s.aL = approach(s.aL, aL, 1.5, sdt);
      const inF = aF - 0.6 * s.aF;
      const inL = aL - 0.6 * s.aL;
      const W = 14;
      const D = 2 * 0.35 * W;
      const sub = Math.max(1, Math.ceil(step * 240));
      const h = step / sub;
      for (let i = 0; i < sub; i++) {
        s.fv += (-W * W * s.fx - D * s.fv - inF) * h;
        s.fx += s.fv * h;
        s.lv += (-W * W * s.lx - D * s.lv - inL) * h;
        s.lx += s.lv * h;
      }
    }
    // Metres of lag along the travel and across the board; positive along
    // is the body carried forwards, positive across is towards the toe edge.
    const lagF = clamp(s.fx, -0.05, 0.05) * (1 - s.down);
    const lagL = clamp(s.lx, -0.05, 0.05) * (1 - s.down);

    /* --- the whole rider, on the hill ------------------------------------ */

    // Stand him on the surface, then turn, flip and roll him in his own
    // frame. A tumble drifts back to true vertical.
    /* In flight the frame is the board's own attitude, which the physics
       carries off the lip and works round to the landing slope (see
       `stepAttitude` in rider.js). It used to drift to world vertical instead,
       which flew every jump down a pitch with the board level and then
       rotated the whole rider onto the slope in the frame he touched down.
       The board now arrives matched; whatever small difference an early
       touchdown leaves is handed to `upGlide` and drained over a few frames,
       the same cure `yawGlide` is for the stance snap. */
    const flying = rider.state === 'air' && !!rider.airUp;
    if (flying) {
      up.copy(rider.airUp);
      airUpDrawn.copy(up);
      gliding = false;
    } else {
      up.copy(rider.normal);
      if (!rider.grounded) up.lerp(UP, Math.min(1, rider.airTime * 2.5)).normalize();
      if (flewLast && rider.state === 'ride' && !snap) {
        upGlide.setFromUnitVectors(up, airUpDrawn);
        gliding = true;
      }
      if (gliding) {
        upGlide.slerp(NO_TURN, 1 - Math.exp(-RIDER.glideRate * step));
        if (Math.abs(upGlide.w) > 0.99995) gliding = false;
        else up.applyQuaternion(upGlide);
      }
    }
    flewLast = flying;
    q.setFromUnitVectors(UP, up);
    /* Body english for the two shaped grabs, continuous in `grab` — the old
       `grab > 0.05` gate added nothing but a one-frame snap at the crossing,
       since the terms already scale by `grab` and `grab` already carries the
       airborne fade. The magnitudes are deliberately modest: this rotates
       the *whole rig* about the contact patch, and the deck's own per-grab
       tilt (`G.tweak`, below) is still the star of the pose — at the old
       fifty-two degrees of rig roll a method buried the far edge, the tail
       and the rear boot in the snow whenever the grab was held to
       touchdown. */
    let tweakPitch = 0;
    let tweakRoll = 0;
    if (rider.grabKind === GRAB_METHOD) {
      tweakRoll = 0.3 * grab;
      tweakPitch = 0.15 * grab;
    } else if (rider.grabKind === GRAB_NOSE) {
      tweakPitch = -0.3 * grab;
    }

    // Negative, and this is the fix rather than a convention: the physics
    // heading is (sin yaw, 0, −cos yaw), which is this rotation and not its
    // mirror. See the note at the top of the file.
    qy.setFromAxisAngle(UP, -rider.yaw);
    // `flipGlide` is the un-drained remainder of the last landing's pitch
    // snap — presentation only, exactly like `yawGlide` on the axis above.
    qx.setFromAxisAngle(AX, rider.flip + rider.flipGlide
      + rider.tumble * s.down + tweakPitch);
    qz.setFromAxisAngle(AZ, -s.lean * (1 + 1.2 * s.down) + tweakRoll);
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
    const lift = G.lift * grab;
    const tweak = G.tweak * grab;
    // The nose lifts as he pops, whichever end it is — and a press stands the
    // whole deck up on one contact point.
    /* An ollie is the tail snapping the board off the snow nose-first, so the
       lift is mostly taken once he is off it: a few degrees while the legs
       are still extending, the rest as the board leaves, levelled again by
       the time the pop has decayed. */
    const pressPitch = POSE.pressPitch * press * pressEnd;
    bt.pitch = s.pop * (0.12 + POSE.popNose * s.air) * sw + pressPitch;
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
    /* …and the deck is turned about the contact point that is still buried,
       not about its own middle. `boardPoint` rotates about the origin and then
       translates, so restoring the pressed end to where it was is one term:
       a point at z = zp moves to y = −zp·sin θ, and adding zp·sin θ puts it
       back. The centre of the board therefore rises by half the height the
       free end gains, which is exactly where the middle of a pressed board
       is. Without it the buried end sinks into the hill by as much as the
       other one rises, and a press reads as the board falling through the
       snow. */
    const pressPivot = FLEX_SPAN * pressEnd;
    bt.y = ty * cl + tx * sl + lift + pressPivot * Math.sin(pressPitch);

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
      // The pelvis travels onto the end being pressed. It is the same
      // movement as the chest above and it is there for the same reason: a
      // board stands on one end only for as long as somebody's weight is over
      // that end. `pressEnd` already points at it, in this same frame.
      + POSE.pressLean * press * pressEnd
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
      - POSE.airTuck * s.airTuck + POSE.popRise * s.pop - POSE.thumpDrop * s.thump
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
    hipY += (bootA.y + G.hip - hipY) * grab;

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
      - s.thump * 0.34 - grab * (0.25 + G.hinge)) * sw - skate * POSE.pushHinge
      // …and over whichever end he is standing on, because that is where the
      // weight has to be for it to stay down.
      + POSE.pressChest * press * pressEnd;
    // Angulation at the waist as well as at the knees: the shoulders stand
    // back up out of the body's own inclination, which is what keeps a carve
    // from reading as a man falling over sideways at a constant rate.
    const fold = -G.fold * grab - s.down * 0.5 * (1 - grab)
      + s.lean * POSE.angulate * (1 - grab)
      - POSE.chestSide * upright * (1 - s.tuck * 0.7);
    /* Going over, he curls up and the chest trails the tumble by however far
       the roll has outrun the smoothed copy of it — and it flops sideways as
       well, which is the half that was missing. A body trailing a rotation in
       exactly one plane still reads as a rigid thing being turned; it is the
       second axis, arriving on a different clock from the first, that makes
       it read as a person who has stopped holding himself up. */
    /* …and the follow-through spring pitches and tips the chest the way the
       body's mass is being carried — over the leading foot as he brakes,
       towards the heel edge as the board is pulled towards the toes — while
       three tenths of the head's lead turns the shoulders into the turn.
       All of it is scaled by `upright`, so a grab's fold and a tumble's
       flop are left exactly as they were solved. */
    torso.rotation.set(
      pitch - s.down * (0.55 + lag * 0.5) * sw - lagF * 2.2 * sw * upright,
      s.twist - hips.rotation.y + s.down * Math.sin(s.clock * 3.4) * 0.30 + lead * 0.3,
      fold + s.down * (lag * 0.45 + Math.sin(s.clock * 4.6 + 1.2) * 0.22) - lagL * 1.8 * upright,
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
       reads as a wobble.

       It scales the jacket's mesh and not the torso group, which is what it
       used to do. The head and both arms hang off that group, so each breath
       handed them a non-uniform scale in a frame the arms had already
       rotated out of: the helmet swelled by a different amount along each
       of its axes, and a forearm at forty-five degrees to the chest was
       sheared rather than scaled. A breath is the chest; the shoulders'
       sockets stay where the skeleton put them, which also leaves the torso
       matrix the grab target is carried through a pure rotation. */
    const effort = clamp(rider.speed / 30 + (rider.gLoad - 1) * 0.5, 0, 1.6);
    const breath = Math.sin(s.clock * (1.05 + effort * 1.5)) * 0.5 + 0.5;
    const depth = (0.016 - effort * 0.005) * idle;
    torsoMesh.scale.set(1 + breath * depth * 0.8, 1 + breath * depth * 0.5, 1 + breath * depth);
    torso.updateMatrix();

    /* The jacket in the wind — see `flapUniform`. The ripple quickens with
       speed as well as growing, from about three cycles a second standing
       to six and a half at thirty metres a second, which is the difference
       between a hem stirring and a hem snapping; the two rates stay in the
       same irrational ratio at every speed, so it never falls into step
       with itself. A tumbling rider is mostly snow and flailing limbs, so
       the flutter all but stops while he is down. */
    const flapRate = 0.5 + rider.speed / 30;
    flapPhase.value.x = (flapPhase.value.x + step * 17.0 * flapRate) % TAU;
    flapPhase.value.y = (flapPhase.value.y + step * 27.3 * flapRate) % TAU;
    flapUniform.value = clamp(0.002 + 0.0005 * rider.speed, 0, 0.02) * (1 - s.down * 0.8);

    /* --- head -------------------------------------------------------------- */

    // He looks down the fall line — whichever end of the board is leading —
    // so the yaw the shoulders have taken is subtracted back out of the neck;
    // in the air he looks at the landing, on a landing he looks down at it,
    // and in a fall the neck goes as loose as the rest of him and lolls on
    // its own clock. The tilt is *against* the lean while he is riding: a
    // head that rolls with the body reads as unconscious, which is exactly
    // what it is once he is down.
    /* The head takes the rest of the lead into the turn — the chest has
       already carried three tenths of it — and nods with the follow-through:
       the face is the head's +X, so a nod is about its own Z, which under
       'YXZ' is the innermost rotation and therefore the head's own lateral
       axis whatever the yaw. Carried forwards by a braking board, it dips;
       left behind by an accelerating one, it comes up. */
    head.rotation.set(
      -0.05 + s.air * 0.22 + s.thump * 0.30
        - s.down * (lag * 0.6 + Math.sin(s.clock * 5.2) * 0.25),
      POSE.look * sw - s.twist * 0.55 + Math.sin(s.clock * 0.41) * 0.05 * idle
        + s.down * Math.sin(s.clock * 3.9 + 2.1) * 0.35 + lead * 0.7,
      s.lean * 0.18 + s.down * (0.4 + Math.sin(s.clock * 4.4 + 0.7) * 0.25)
        - lagF * 2.6 * upright,
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

    /* The hands are the heaviest thing on the end of the longest lever, so
       they carry the most follow-through: carried on forwards and across by
       exactly the lag the chest took, a little more than one for one. It is
       written in the travel frame like everything else here (−Z is the way
       he is going) and it goes on *before* the grab and the fall, which both
       lerp to where the hand has to be — so a grab still lands exactly on
       the board's edge, however hard the landing that preceded it. */
    hand.z -= lagF * 1.4;
    other.z -= lagF * 1.4;
    hand.x += lagL * 1.1;
    other.x += lagL * 1.1;

    // Elbows back and down while riding; up and back in a grab, so the arm
    // hangs off the shoulder rather than hinging through the ribs
    pole.set(-0.75, -0.55, -0.15);
    poleRear.set(-0.75, -0.55, 0.15);

    /* The grab. The one pose expressed somewhere other than the shoulder:
       the target is a fixed point on the board, and the board is three
       transforms away, so it is carried back through the hips and the torso
       into the reaching shoulder's own space — and only when there is a grab
       to pay for it.

       WHICH SHOULDER IS PART OF THE GRAB, and it has to be, because the three
       of them do not use the same hand. An indy and a method are trailing-hand
       grabs and a nose grab is a leading-hand one, and that is not a naming
       convention — it is where the hand can physically get to. Routed through
       one arm for all three, the method sent the leading arm across the body
       to the heel edge behind the rider, which is a shape nobody has ever
       made on a snowboard.

       `gs` is the whole of it. The two shoulders sit at ∓SHOULDER_Z, the
       free arm's balance pose is its own mirror image, and one sign carries
       all four. */
    if (grab > 0.002) {
      const gs = G.lead ? 1 : -1;
      const reach = G.lead ? hand : other;
      const free = G.lead ? other : hand;
      const reachPole = G.lead ? pole : poleRear;
      const freePole = G.lead ? poleRear : pole;
      mInv.copy(hips.matrix).multiply(torso.matrix).invert();
      boardPoint(_f.set(G.point[0], G.point[1], G.point[2] * sw));
      _f.applyMatrix4(mInv);
      _f.y -= SHOULDER_Y;
      _f.z += SHOULDER_Z * sw * gs;
      _f.z *= sw;                 // …and back into the travel frame with the rest
      reach.lerp(_f, grab);
      reachPole.lerp(_u.set(-0.45, 0.75, -0.2 * gs), grab);
      // the free hand goes up and out for balance, which is what makes a
      // grab read as a rider tweaking rather than a rider bending over
      free.lerp(_u.set(0.10, 0.10, 0.46 * gs), grab);
      freePole.lerp(_u.set(-0.5, -0.2, 0.3 * gs), grab);
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
    const k = Math.max(0, 1 - gap / 14);
    const shadowScale = 0.55 + 0.45 * k;

    /* The disc conforms to the ground it is printed on. On the snow the
       physics already owns a presentation normal; in the air the ground
       under the rider is somebody else's problem, so it is measured with two
       cheap central differences at the point the shadow actually sits on.

       The in-plane spin is -yaw, and the sign is the same fix as the rig
       root's. The heading is (sin yaw, 0, -cos yaw); the disc's long lobe is
       its local +Y, which the -PI/2 X pre-rotation sends to -Z, and spinning
       that by -yaw about the world's up lands it exactly on the heading.
       Spun by +yaw — which is what this did — the lobe pointed at the
       heading's reflection across the fall line, so through every carve the
       shadow swung the wrong way while the board swung the right one. */
    if (rider.grounded) {
      shadowUp.copy(rider.normal);
    } else {
      const eps = 1.5;
      const hx = (rider.world.height(rider.pos.x + eps, rider.pos.z)
        - rider.world.height(rider.pos.x - eps, rider.pos.z)) / (2 * eps);
      const hz = (rider.world.height(rider.pos.x, rider.pos.z + eps)
        - rider.world.height(rider.pos.x, rider.pos.z - eps)) / (2 * eps);
      shadowUp.set(-hx, 1, -hz).normalize();
    }
    shadowTilt.setFromUnitVectors(UP, shadowUp);
    shadowSpin.setFromAxisAngle(UP, -rider.yaw);
    shadow.quaternion.copy(shadowTilt).multiply(shadowSpin).multiply(shadowFlat);
    // Lifted off the snow along its own normal rather than straight up, so
    // the clearance that keeps it out of the depth buffer survives a slope
    shadow.position.set(
      rider.pos.x + shadowUp.x * 0.06,
      gy + shadowUp.y * 0.06,
      rider.pos.z + shadowUp.z * 0.06,
    );
    shadow.scale.set(shadowScale * 0.78, shadowScale * 1.28, 1);

    /* Two shadows under one rider is one too many. The real cast shadow
       scales with the key light, so the blob yields to it on the same
       signal: in full sun it fades to a faint contact tint under the crisp
       PCF shadow, and at night or deep in a storm — when the key is too weak
       to draw one — the blob carries the whole height cue alone. */
    const sunned = weather ? clamp(weather.keyI * 0.45, 0, 1) : 0;
    shadow.material.opacity = 0.30 * k * k * (1 - sunned * 0.7);
    shadow.visible = k > 0.02;

    // The lamp asks for world-space head transforms, so it comes after every
    // part of the pose has been written. Weather remains the single owner of
    // whether it is night; this rig only adapts that state into light.
    if (weather && camera) headlamp.update(weather, dt, rider, camera);
    // …and the rig's materials read the lamp back, so the spill above tracks
    // the same fade the beam does rather than a second opinion about night.
    lampUniform.value = headlamp.level;
  }

  function reset() {
    seen = false;
    s.down = 0;
    s.air = 0;
    s.grab = 0;
    s.tuck = 0;
    s.push = 0;
    s.charge = 0;
    s.wash = 0;
    s.switched = 0;
    s.yawRate = 0;
    s.aF = s.aL = s.fx = s.fv = s.lx = s.lv = 0;
    headlamp.reset();
  }

  return {
    root,
    shadow,
    update,
    reset,
    rearBoot,
    headlamp,
    debug: () => ({
      push: s.push,
      rearBoot: rearBoot.position.toArray(),
      headlamp: headlamp.debug(),
    }),
  };
}
