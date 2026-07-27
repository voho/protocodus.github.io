/* The rider.

   This is a velocity vector on a surface, not a speed along a track, and
   almost everything that makes the game feel like snowboarding falls out of
   that one decision:

   • Gravity is resolved on the slope tangent, so the hill accelerates you
     by being steep and slows you by being banked. Riding up the side of the
     corridor costs speed and gives it back on the way down, for free,
     because that is just what the vector does.

   • The edge holds sideways up to a fixed grip and slides past it. A carve
     inside the limit keeps its momentum and only pays edge friction; a turn
     asked for beyond the limit washes out, throws powder and scrubs speed.
     Turning is therefore something you spend speed on, which is what makes
     going fast a decision rather than a default.

   • Jumps are not triggered. Every step projects the rider's ballistic path
     ninety milliseconds forward and asks where the ground will be there: if
     the hill has dropped out from under it, the rider is in the air, with
     whatever vertical speed the ground was handing them at that instant. A
     kicker's lip, the crest of a roller, the top of a quarterpipe and the
     edge of a cliff all launch by the same rule, and all of them launch
     harder the faster you were going.

   • The legs are a spring. It compresses under load and extends when the
     load comes off, which drives the crouch, the camera height, and — if it
     happens to be extending as you leave the ground — a little extra pop.
     Pumping a roller works, and nobody had to write pumping.

   Three things about that were more claim than fact, and this file is mostly
   the correction of them.

   Momentum was being propped up. A rider under 6 m/s got a flat forward
   shove regardless of which way the ground went, a tuck pumped whether the
   hill was falling away or standing up in front of it, and the edge bled so
   little that nothing you did ever really cost anything. So the mountain
   read as flat however it was shaped, and riding up a bank was free. Every
   one of those pushes now has to agree with the ground before it is allowed
   to happen, and climbing takes an honest scrub on top of the g·sin θ that
   gravity was already charging.

   Air was honest and therefore wrong. Under real ballistics a jump is a
   mortar shell: up fast, over quickly, down fast, with no time at the top to
   do anything. Gravity is now scaled down through the apex and full weight
   either side of it, which roughly doubles the hang time without changing
   the height or the landing — the oldest trick in platform games, and the
   reason theirs feel like jumps.

   And a fall was a timer. Whatever put you down, you slid for 1.35 seconds
   and stood up. Now it is a body: the speed that went into the tree comes
   back out as height and tumble, and the rider is ballistic until the snow
   has finished with them — so a spill at walking pace is over in a second
   and catching a trunk at 150 km/h throws you a long way down the hill. */

import { RIDER, PROPS } from './config.js';
import { normalFrom } from './terrain.js';

const RAIL = PROPS.rail;

const TAU = Math.PI * 2;

const wrapPi = (a) => {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

/* Landing outcomes, in order of how much they cost */
export const CLEAN = 0;
export const SKETCHY = 1;
export const BAIL = 2;

export class Rider {
  /* `world.height(x, z)` is the hill plus whatever kickers sit on it. */
  constructor(THREE, world) {
    this.THREE = THREE;
    this.world = world;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.heading = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);

    this._n = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._g = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.UP = new THREE.Vector3(0, 1, 0);

    this.events = {
      launch: [], land: [], fall: [], rise: [], carve: [], impact: [],
      grind: [], grindOut: [],
    };
    this._rail = { x: 0, y: 0, z: 0, t: 0 };

    this.reset(0);
  }

  on(name, fn) {
    this.events[name].push(fn);
    return this;
  }

  emit(name, a, b) {
    const list = this.events[name];
    for (let i = 0; i < list.length; i++) list[i](a, b);
  }

  reset(z = 0) {
    const x = 0;
    this.pos.set(x, this.world.height(x, z), z);
    this.vel.set(0, 0, -10);
    this.yaw = 0;
    this.flip = 0;
    this.roll = 0;
    this.grounded = true;
    this.state = 'ride';

    this.compression = 0;
    this.compressionVel = 0;
    this.extension = 0;      // how far off the snow the board is floating
    this.gLoad = 1;

    this.charge = 0;
    this.charging = false;
    this.tucking = false;
    this.spinVel = 0;
    this.flipVel = 0;

    this.airTime = 0;
    this.spinAccum = 0;
    this.flipAccum = 0;
    this.grabTime = 0;
    this.grab = 0;           // 0..1, how far into the grab pose
    this.grabbing = false;
    this.switchStance = false;
    this.rail = null;        // the rail being ridden, if any
    this.grindTime = 0;
    this.stallTimer = 0;     // how long the board has been too slow for the pitch
    this.edge = 0;           // radians the board is rolled up onto its edge
    this.slide = 0;          // m/s of sideways wash, for spray and sound
    this.lateral = 0;        // signed, so the spray knows which way to fly
    this.carveLoad = 0;      // 0..1, how hard the edge is working
    this.climbRate = 0;      // m/s of height being gained, for the HUD and the scrub
    this.lipPop = false;     // was the last launch popped on the lip
    this.fallTimer = 0;
    this.fallElapsed = 0;
    this.airborne = false;   // during a tumble: flying, rather than sliding
    this.grace = 1.2;
    this.tumble = 0;
    this.startZ = z;
    this.landing = null;     // set for one frame after a landing
  }

  get speed() {
    return this.vel.length();
  }

  get distance() {
    return Math.max(0, this.startZ - this.pos.z);
  }

  /* ------------------------------------------------------------------ */

  step(dt, input) {
    this.landing = null;
    this.grace = Math.max(0, this.grace - dt);

    // Getting up is part of going down, so both states run the recovery
    // step. Dispatching only on 'fall' stopped the timer the moment
    // `fallStep` promoted itself to 'rise' — the rider went back to normal
    // physics while the model still had them face-down.
    if (this.state === 'fall' || this.state === 'rise') return this.fallStep(dt);
    if (this.state === 'grind') return this.grindStep(dt, input);
    if (this.grounded) this.groundStep(dt, input);
    else this.airStep(dt, input);
    this.springStep(dt);
  }

  /* --- on the snow --------------------------------------------------- */

  groundStep(dt, input) {
    const { pos, vel } = this;
    this.tucking = !!input.tuck && !input.brake;
    const n = normalFrom(this.world.height, pos.x, pos.z, this._n);
    this.normal.copy(n);

    // Anything pointing into the slope is absorbed by the snow. What it was
    // worth is remembered — it is the load the legs have to take.
    const into = vel.dot(n);
    if (into < 0) {
      vel.addScaledVector(n, -into);
      if (into < -2) this.emit('impact', -into);
      this.compressionVel += Math.min(-into, 26) * 0.5;
    } else {
      vel.addScaledVector(n, -into);
    }

    // Gravity, resolved on the tangent. This is the whole engine: steep is
    // fast, banked is slow, and neither needed a special case.
    const g = this._g.set(0, -RIDER.gravity, 0);
    const gn = g.dot(n);
    vel.x += (g.x - n.x * gn) * dt;
    vel.y += (g.y - n.y * gn) * dt;
    vel.z += (g.z - n.z * gn) * dt;

    /* How hard the rider is climbing, in metres of height per second.

       The surface gradient falls straight out of the normal — for a height
       field, n ∝ (−∂h/∂x, 1, −∂h/∂z) — so this is the rate the ground under
       the rider is rising along the direction they are actually travelling.
       Positive is uphill. Everything below that has an opinion about the
       hill's direction reads this rather than guessing from the heading. */
    const ny = Math.max(0.2, n.y);
    this.climbRate = (-n.x * vel.x - n.z * vel.z) / ny;

    /* Stalling.

       A snowboard is not a climbing tool. Run out of speed pointing up
       something steep and you do not coast gently to a halt — the board
       stops tracking, the edge that was holding you across the hill has
       nothing left to hold it with, and you go over. Below `stallSlope` the
       rider is allowed to grind down to nothing and start again, which is
       what the floor push exists for. Above it they need real speed, and
       proportionally more of it the steeper the ground is, which is what
       makes riding a wall a commitment rather than a manoeuvre. */
    const carrying = vel.length();
    const climbSin = carrying > 0.4 ? clamp(this.climbRate / carrying, 0, 1) : 0;
    const needed = Math.min(RIDER.stallCap,
      RIDER.stallSpeed * (climbSin / RIDER.stallSlope));
    if (climbSin > RIDER.stallSlope && carrying < needed) {
      this.stallTimer += dt;
    } else {
      this.stallTimer = 0;
    }
    if (this.stallTimer > RIDER.stallTime && this.grace <= 0) {
      this.stallTimer = 0;
      this.fall('stall', 0);
      return;
    }

    // Board frame on the slope
    const h = this._h.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    h.addScaledVector(n, -h.dot(n)).normalize();
    const r = this._r.copy(h).cross(n).normalize();
    this.heading.copy(h);
    this.right.copy(r);

    let vFwd = vel.dot(h);
    let vLat = vel.dot(r);
    const speed = Math.hypot(vFwd, vLat);
    const ratio = clamp(speed / 45, 0, 1);
    /* How far over the board is allowed to go, which closes down as the run
       speeds up.

       The sidecut already makes a fast turn expensive — the grip it asks for
       goes as v² — but "expensive" and "twitchy" are not the same thing, and
       letting the rider roll the board to sixty-six degrees at 150 km/h means
       every touch of the key is an instant demand for four times the grip
       that exists, which arrives as a wash-out rather than as a turn. Closing
       the available edge angle down with speed is what a real rider does with
       their own body without thinking about it, and it is the difference
       between a board that feels sturdy at speed and one that feels nervous. */
    const edgeCeiling = RIDER.edgeMax * (1 - RIDER.edgeSteady * ratio * ratio);

    /* THE CARVE.

       The board does not turn because it is being steered. It turns because
       it has a sidecut — the edges are arcs — and once it is tilted up onto
       one of them and pressed into the snow, that arc is the path it is
       obliged to follow:

           R = sidecut / sin(edge angle)

       Lay it flat and the arc is enormous and the board runs straight. Roll
       it over and the radius collapses towards the sidecut itself. The
       rider's only input is how far over they put it, which is exactly what
       it is in the sport.

       Everything that used to be asserted now falls out of that. Holding a
       radius R at v metres a second needs v²/R of lateral grip, so the same
       edge angle that draws a clean arc at 40 km/h asks four times as much of
       the snow at 80 and tears out — and the rider discovers on their own
       that a fast line has to be a wide line, instead of being told so by a
       cap on the turn rate. The old model reached the same conclusion by
       decree; this one reaches it by geometry, and the difference is legible
       in the hands because the board now resists in proportion to how much
       you are asking of it rather than simply refusing past a threshold. */
    const gripNow = RIDER.grip
      * (input.brake ? 0.45 : 1)
      * (input.tuck ? RIDER.tuckGrip : 1);
    const wantEdge = clamp(input.turn, -1, 1) * edgeCeiling
      * (input.tuck ? RIDER.tuckTurn : 1);
    this.edge = approach(this.edge, wantEdge, RIDER.edgeRate, dt);

    const sinEdge = Math.abs(Math.sin(this.edge));
    // What the sidecut is asking the hill for, in m/s² of lateral pull
    const demand = (speed * speed * sinEdge) / RIDER.sidecut;
    const carve = Math.min(demand, gripNow);
    const spill = demand - carve;
    const side = Math.sign(this.edge) || 0;

    // The board turns at whatever the edge actually managed to hold
    this.yaw += side * (carve / Math.max(3, speed)) * dt;
    // …and the brake is still the deliberate way to break it loose and pivot
    if (input.brake) this.yaw += input.turn * RIDER.brakePivot * dt;

    /* With no input the board settles back in line with where the rider is
       actually travelling, so a nudge does not leave you sideways forever.

       The speed gate used to be 1 m/s, which meant it was still running while
       the rider was almost stationary — and since the floor push sends a
       stopped rider downhill along the tangent, the two together quietly
       rotated the board to face down the fall line whenever you came to a
       stop. From the outside that reads as the rider refusing to stand still
       and pointing himself downhill on his own. Above 3.5 m/s the board is
       genuinely tracking and lining it up with the direction of travel is
       what keeps the handling honest; below it, a rider who has stopped is
       allowed to stay pointed wherever they stopped pointing. */
    if (Math.abs(input.turn) < 0.05 && speed > 3.5) {
      const travelYaw = Math.atan2(vel.x, -vel.z);
      this.yaw += wrapPi(travelYaw - this.yaw) * (1 - Math.exp(-RIDER.selfCentre * dt));
    }

    /* And a hard limit on how far the board is ever allowed to get from the
       direction it is actually travelling.

       This is the fix for the board ending up sideways. Nothing in the model
       forbids it on its own: the yaw is driven by the carve and the velocity
       is driven by the grip, and any moment those two disagree — a wash-out,
       a graze, a bad landing, a brake held through a compression — the gap
       between them opens and there is no term that closes it again except the
       self-centring, which is deliberately gentle and switches off the instant
       the rider touches the steering. So a player holding an edge through a
       slide could end up travelling one way and pointing ninety degrees off
       it, which is not a snowboard, it is a sledge.

       Sixty degrees is about as far across the fall line as anyone can hold a
       board and still be riding it; past that the excess is taken back
       immediately rather than smoothly, because there is no physical process
       that would let it persist. The brake is exempt — setting the board
       across the hill is precisely what that key is for. */
    if (speed > 2 && !input.brake) {
      const travelYaw = Math.atan2(vel.x, -vel.z);
      const off = wrapPi(this.yaw - travelYaw);
      const limit = RIDER.maxSkid;
      if (off > limit) this.yaw -= off - limit;
      else if (off < -limit) this.yaw -= off + limit;
    }

    /* What the edge could not hold becomes sideways speed — the wash-out —
       and what it did hold is scrubbed out of the lateral velocity, which is
       what "the edge is gripping" physically means. `carveLoad` is then the
       honest fraction of the available grip the turn is using, so everything
       downstream that reads it — the spray, the leg spring, the trail's
       width, the camera's shake — is reading how hard the board is actually
       working rather than how hard the key is pressed. */
    vLat -= side * spill * dt;
    const bite = gripNow * dt;
    const held = clamp(vLat, -bite, bite);
    vLat -= held;
    this.slide = Math.abs(vLat);
    this.lateral = vLat;
    this.carveLoad = clamp(carve / gripNow, 0, 1);

    // Redirecting momentum costs a little; failing to costs a lot
    vFwd -= Math.abs(held) * RIDER.carveDrag;
    vFwd -= this.slide * RIDER.slideScrub * dt;
    /* And cutting the trench is not free either. A carved edge is slicing
       through snow rather than gliding over it, and the further it is rolled
       over the more of it is buried — which is why a run held on a hard edge
       the whole way down a pitch arrives slower than one that let the board
       run flat between turns. That trade is most of what makes a line a
       decision rather than a shape. */
    vFwd -= RIDER.edgeDrag * sinEdge * this.carveLoad * dt;

    /* And climbing costs more than gravity alone charges for.

       g·sin θ is the whole of the real physics and, on a hill this shallow,
       it is not very much — five or six m/s² on the average pitch. What it
       misses is that a board driven up a slope is also being driven *into*
       it, and an edge loaded like that in soft snow scrubs. This is that
       term, and it is the difference between a quarterpipe wall you have to
       commit speed to and a free way to change lanes. */
    if (this.climbRate > 0 && speed > 1) {
      vFwd -= RIDER.climbScrub * clamp(this.climbRate / speed, 0, 1) * dt;
    }

    // A slide bleeds itself out as the base scrapes across the fall line
    vLat *= Math.exp(-2.6 * dt);

    // Braking is a hard sideways set-down: speed goes, powder flies
    const mu = input.brake ? RIDER.brakeFriction : RIDER.friction;
    const dec = mu * RIDER.gravity * Math.max(0.2, n.y);
    if (input.brake) this.slide += speed * 0.35;

    vel.copy(h).multiplyScalar(vFwd).addScaledVector(r, vLat);

    // Kinetic friction, then air drag, then the tuck's reward
    const sp = vel.length();
    if (sp > 1e-4) vel.multiplyScalar(Math.max(0, sp - dec * dt) / sp);
    const over = Math.max(0, sp - RIDER.maxSpeed);
    const drag = RIDER.drag * (input.tuck ? RIDER.tuckDrag : 1) * (1 + over * 0.35);
    vel.multiplyScalar(Math.max(0, 1 - drag * sp * dt));

    /* The two pushes, both of which now have to agree with the ground.

       A tuck pumps only when the hill is not standing up in front of it, and
       the floor push only fires when the rider has genuinely almost stopped
       — and then it pushes *downhill*, along the tangent, rather than along
       whatever direction the board happened to be pointing. Pushing along
       the heading is what used to shove a rider who had stalled against a
       bank further up it. */
    if (input.tuck && sp < RIDER.maxSpeed && this.climbRate <= 0) {
      vel.addScaledVector(h, RIDER.pump * dt);
    }
    if (sp < RIDER.minSpeed) {
      const dl = Math.hypot(n.x, n.z);
      if (dl > 1e-4) {
        vel.x += (n.x / dl) * RIDER.minPush * dt;
        vel.z += (n.z / dl) * RIDER.minPush * dt;
      }
    }

    // Charging an ollie loads the legs; releasing it unloads them
    if (input.jump) {
      this.charging = true;
      this.charge = Math.min(1, this.charge + dt / RIDER.chargeTime);
      this.compressionVel += 5.5 * dt * 60 * 0.016;
    }

    /* --- does the hill fall away faster than gravity can follow it? -----

       The whole jump system, and no jump system at all. The rider's
       ballistic path is projected ninety milliseconds forward and compared
       against where the ground will actually be at that point. If the hill
       has dropped out from under it by more than a boot's depth, the rider
       is airborne — with whatever vertical speed the ground was handing
       them at that instant.

       The horizon is what makes it work. Comparing the ground's local
       curvature against gravity, which is the obvious way to write this,
       cannot tell a kicker's lip from the six-metre chatter octave: at
       150 km/h both curve away far harder than gravity, and the rider
       spends the run flickering in and out of the air a dozen times a
       second. Sampling a fixed distance ahead answers the question that
       actually matters — will I still be off the ground when it counts. */
    const h0 = this.world.height(pos.x, pos.z);
    const h1 = this.world.height(pos.x + vel.x * dt, pos.z + vel.z * dt);
    const surfaceVy = (h1 - h0) / dt;

    /* …and it has to be asked about the whole horizon, not just its far end.

       Sampling one point ninety milliseconds ahead was the bug that made a
       fast run jump *worse* than a slow one, and it is worth spelling out
       because the symptom pointed the other way. Ninety milliseconds at 45
       m/s is four metres, which is further than a small kicker is long — so
       the moment the rider touched the ramp's foot, the single sample was
       already past the lip and looking at ground that had dropped away, and
       the rider was launched from the bottom of the ramp having climbed none
       of it. The faster they arrived, the further ahead the sample looked,
       the earlier they were thrown, and the less of the ramp they got to
       use: at 160 km/h the launch fired three metres before the lip with
       1 m/s of vertical and the jump was smaller than a walking pace one.

       Taking the minimum over several points along the path fixes it
       exactly. While any part of the ramp still stands above the rider's
       ballistic arc, the hill has not dropped away — it is in the way — and
       the rider stays on the snow climbing it. The launch happens at the lip
       and nowhere else, and the vertical it hands over is the whole of what
       the ramp built up, which is proportional to the speed that arrived. */
    const HZ = 0.09;
    let clearance = Infinity;
    for (let k = 1; k <= 3; k++) {
      const t = (HZ * k) / 3;
      const ground = this.world.height(pos.x + vel.x * t, pos.z + vel.z * t);
      const ballistic = pos.y + surfaceVy * t - 0.5 * RIDER.gravity * t * t;
      const gap = ballistic - ground;
      if (gap < clearance) clearance = gap;
    }

    /* Popping, and popping at the right moment.

       The clearance above is read *before* the pop is resolved, which is
       what makes the timing bonus possible: it says how close the ground
       already is to letting go. A pop released while the hill is on the edge
       of launching — the lip of a kicker, the crest of a roller, the top of
       a wall — is worth half again as much as the same pop released halfway
       up the ramp. It is the one piece of timing the sport actually asks of
       you, and the old jump had no opinion about it at all. */
    let pop = 0;
    this.lipPop = false;
    if (this.charging && !input.jump) {
      pop = RIDER.popMin + (RIDER.popMax - RIDER.popMin) * this.charge;
      if (clearance > -0.25) {
        pop *= RIDER.lipBonus;
        this.lipPop = true;
      }
      this.charging = false;
      this.charge = 0;
      this.compressionVel = -14;
    }

    const launching = clearance > RIDER.launchGap && this.grounded;
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    if (launching || pop > 0) {
      // Legs already on their way up add to it: pumping a roller works, and
      // nobody had to write pumping
      const unweight = Math.max(0, -this.compressionVel) * 0.55;
      this.takeOff(surfaceVy, pop + unweight, n);
    } else {
      const gy = this.world.height(pos.x, pos.z);
      this.extension = 0;
      pos.y = gy;
      vel.y = clamp(surfaceVy, -RIDER.maxSpeed, RIDER.maxSpeed);
    }

    /* The lean, which is no longer a look.

       A rider holding a turn has to incline until the resultant of gravity
       and the corner runs down the line of their legs, or they fall over —
       so the angle is atan(lateral / g) and there is nothing to choose. It
       used to be a constant times the key being pressed, which meant a gentle
       turn and a turn at the very edge of traction leaned the same amount and
       the body told you nothing. Now the inclination *is* the read-out: lean
       and grip are the same number seen from two ends, and a rider laid over
       at fifty degrees is a rider with nothing left. It still gets there
       late, because a body has mass. */
    const target = -side * Math.atan2(carve, RIDER.gravity);
    this.roll = approach(this.roll, target, RIDER.leanRate, dt);
    if (this.slide > 1.5 || this.carveLoad > 0.35) this.emit('carve', this.slide, this.carveLoad);
  }

  /* `surfaceVy` is what the ground was handing the rider; `pop` is what the
     legs added on top, and it leaves along the surface rather than straight
     up. On a kicker that is very nearly vertical anyway; on a quarterpipe
     wall it is the difference between being thrown back over the piste and
     being fired at the sky from a surface that was never pointing at it.
     Blended halfway to true vertical, because a wall steep enough to be worth
     hitting would otherwise throw a rider sideways with no height at all. */
  takeOff(surfaceVy, pop, n) {
    const p = this._p.copy(n).add(this.UP).normalize();
    this.grounded = false;
    this.state = 'air';
    this.vel.y = surfaceVy;
    if (pop > 0) this.vel.addScaledVector(p, pop);
    this.airTime = 0;
    this.spinAccum = 0;
    this.flipAccum = 0;
    this.flip = 0;
    this.grabTime = 0;
    this.grabbing = false;
    this.spinVel = 0;
    this.flipVel = 0;
    this.charging = false;
    this.charge = 0;
    this.emit('launch', this.vel.y);
  }

  /* --- in the air ---------------------------------------------------- */

  /* Gravity through the apex.

     Full weight while the rider is genuinely climbing or genuinely falling,
     and a little over half of it across the top of the arc, blended on the
     vertical speed so it works identically off a two-metre roller and a
     ten-metre cliff. The launch is untouched and so is the height; what
     changes is the second and a bit spent at the top, which is where every
     trick in the game actually happens. Honest ballistics gave a jump the
     profile of a mortar shell — up fast, nothing at the top, down fast —
     and there was no time in it to do anything worth scoring. */
  airGravity() {
    const t = Math.min(1, Math.abs(this.vel.y) / RIDER.apexSpeed);
    return RIDER.gravity * (RIDER.apexGravity + (1 - RIDER.apexGravity) * t);
  }

  airStep(dt, input) {
    const { pos, vel } = this;
    this.airTime += dt;
    this.tucking = false;
    this.slide = 0;
    this.carveLoad = 0;
    this.climbRate = 0;

    vel.y -= this.airGravity() * dt;
    vel.multiplyScalar(Math.max(0, 1 - RIDER.drag * 0.45 * vel.length() * dt));

    // Spin. It winds up rather than snapping on, so a 180 and a 900 are
    // different amounts of commitment rather than different key presses.
    const wantSpin = input.turn * RIDER.spinRate;
    this.spinVel = approach(this.spinVel, wantSpin, RIDER.spinRamp, dt);
    this.yaw += this.spinVel * dt;
    this.spinAccum += this.spinVel * dt;

    // Flip, on its own key, so it can be corked into a spin
    const wantFlip = input.trickFlip ? -RIDER.flipRate : 0;
    this.flipVel = approach(this.flipVel, wantFlip, RIDER.spinRamp * 1.4, dt);
    this.flip += this.flipVel * dt;
    this.flipAccum += this.flipVel * dt;

    // Grab: the only trick that is worth more the longer you hold it, and
    // the only one that asks you to let go before the snow arrives
    this.grabbing = !!input.trickGrab;
    if (this.grabbing) this.grabTime += dt;
    this.grab = approach(this.grab, this.grabbing ? 1 : 0, 11, dt);

    // A little drift, for picking a landing line
    const steer = input.turn * RIDER.airSteer;
    vel.x += Math.cos(this.yaw) * steer * dt;
    vel.z += Math.sin(this.yaw) * steer * dt;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    this.roll = approach(this.roll, input.turn * 0.22, 6, dt);

    const gy = this.world.height(pos.x, pos.z);

    /* Landing assist, which is the air control the game does not have a key
       for. Inside the last third of a second before touchdown, and only
       while the rider is not asking for more rotation, the board eases
       towards whichever clean stance is nearer. It is far too slow to
       rescue a spin that was never going to make it — perhaps twenty
       degrees over the whole window — but that is the exact width of the
       band between a 540 that lands and a 540 that lands at 519 and gets
       called sketchy for it. */
    // …and only on a real jump, for the same reason the landing snap is:
    // easing the yaw around during a hop over a roller is the game taking
    // the steering off the player without telling them.
    if (vel.y < -0.5 && Math.abs(input.turn) < 0.05 && this.airTime > RIDER.minJudgedAir) {
      const toGround = (pos.y - gy) / -vel.y;
      if (toGround < RIDER.assistTime) {
        const travelYaw = Math.atan2(vel.x, -vel.z);
        const off = wrapPi(this.yaw - travelYaw);
        const target = Math.abs(off) > Math.PI / 2 ? travelYaw + Math.PI : travelYaw;
        this.yaw += wrapPi(target - this.yaw) * (1 - Math.exp(-RIDER.assistRate * dt));
      }
    }

    /* A rail caught on the way down. Only ever on the way down: a rider
       rising through the height of a rail is jumping over it, and catching
       one from underneath is the single most infuriating thing a park can
       do to you. */
    if (vel.y < 0 && this.world.rail) {
      const r = this.world.rail(pos.x, pos.z, pos.y);
      if (r) {
        this.catchRail(r);
        return;
      }
    }

    if (pos.y <= gy) {
      pos.y = gy;
      this.land();
    } else {
      this.extension = pos.y - gy;
    }
  }

  /* --- on the rail ----------------------------------------------------- */

  catchRail(r) {
    this.rail = r;
    this.state = 'grind';
    this.grounded = true;
    this.grindTime = 0;
    this.spinVel = 0;
    this.flipVel = 0;
    this.flip = 0;
    this.grab = 0;
    this.grabbing = false;
    this.extension = 0;
    this.slide = 0;
    this.carveLoad = 0;
    this.compressionVel += 6;
    this.emit('grind', r);
  }

  /* Steel is not snow. A rail takes the rider's line away entirely — they go
     where it goes — and gives back almost no friction in exchange, so a long
     one is genuinely fast. What it costs is every option: no carving, no
     edge, and the only way off before the end is up. */
  grindStep(dt, input) {
    const { pos, vel } = this;
    const r = this.rail;
    this.grindTime += dt;
    this.tucking = false;

    const dx = r.x1 - r.x0;
    const dy = r.y1 - r.y0;
    const dz = r.z1 - r.z0;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / dl;
    const uy = dy / dl;
    const uz = dz / dl;

    // Everything the rider has, resolved onto the one axis they are allowed
    let v = vel.x * ux + vel.y * uy + vel.z * uz;
    v += -RIDER.gravity * uy * dt;
    const scrub = RAIL.friction * RIDER.gravity * dt;
    v = v > 0 ? Math.max(0, v - scrub) : Math.min(0, v + scrub);
    vel.set(ux * v, uy * v, uz * v);

    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    const p = this.world.railPoint(r, pos.z, this._rail);
    pos.x = p.x;
    pos.y = p.y;

    this.normal.set(0, 1, 0);
    const railYaw = Math.atan2(ux, -uz);
    this.yaw += wrapPi(railYaw - this.yaw) * (1 - Math.exp(-9 * dt));
    this.roll = approach(this.roll, input.turn * 0.2, 6, dt);

    /* Off the end, or off the side on purpose. Popping off a rail is the
       whole point of riding one, so a jump released here launches properly
       rather than just dropping the rider on the snow. */
    const past = p.t >= 1 || p.t <= 0 || Math.abs(v) < 1.2;
    if (input.jump || past) {
      const pop = input.jump ? RIDER.popMin * 0.9 : 1.4;
      this.rail = null;
      this.state = 'air';
      this.grounded = false;
      this.airTime = 0;
      this.spinAccum = 0;
      this.flipAccum = 0;
      this.charging = false;
      this.charge = 0;
      vel.y += pop;
      this.emit('grindOut', this.grindTime);
      this.emit('launch', vel.y);
      this.grindTime = 0;
      return;
    }

    this.springStep(dt);
  }

  /* --- the moment it matters ----------------------------------------- */

  land() {
    const { vel } = this;
    const n = normalFrom(this.world.height, this.pos.x, this.pos.z, this._n);
    const impact = Math.max(0, -vel.dot(n));

    const travelYaw = Math.atan2(vel.x, -vel.z);
    const off = wrapPi(this.yaw - travelYaw);
    const forward = Math.abs(off);
    const backward = Math.abs(Math.abs(off) - Math.PI);
    const spinErr = Math.min(forward, backward);
    const isSwitch = backward < forward;
    const flipErr = Math.abs(wrapPi(this.flip));

    const w = RIDER.landWindow;
    const p = RIDER.landPitchWindow;
    let verdict = CLEAN;
    if (spinErr > w * 1.55 || flipErr > p * 1.6 || impact > RIDER.hardImpact) verdict = BAIL;
    else if (spinErr > w || flipErr > p || impact > RIDER.softImpact * 1.9) verdict = SKETCHY;

    // Hops too small to have been a trick are never judged, so chattering
    // over a mogul field can't end a combo
    const judged = this.airTime >= RIDER.minJudgedAir
      || Math.abs(this.spinAccum) > 0.8 || Math.abs(this.flipAccum) > 0.8;
    if (!judged) verdict = CLEAN;

    // The grab has to be let go before the snow, which is what the start
    // screen says. Held through touchdown it was free points and a strictly
    // dominant strategy. It costs a sketchy landing rather than a fall,
    // because nothing here should end a run.
    if (judged && this.grabbing) verdict = Math.max(verdict, SKETCHY);

    // Rotations are quantised to the *nearest* half turn, not the floor.
    // The landing window has already accepted anything inside ±53°, so a
    // clean 170 is a 180 and a clean 350° flip is a backflip. The label and
    // the score both read these, so they can never disagree.
    const halfTurns = Math.round(Math.abs(this.spinAccum) / Math.PI);
    const flipTurns = Math.round(Math.abs(this.flipAccum) / TAU);

    const summary = {
      verdict,
      airTime: this.airTime,
      spin: this.spinAccum,
      flips: this.flipAccum,
      halfTurns,
      flipTurns,
      grabTime: this.grabTime,
      switchStance: isSwitch,
      impact,
      judged,
    };

    this.grounded = true;
    this.state = 'ride';
    this.extension = 0;
    this.flip = 0;
    this.flipVel = 0;
    this.spinVel = 0;
    this.grab = 0;
    this.grabTime = 0;
    this.grabbing = false;
    this.compressionVel += Math.min(impact, 30) * 0.85;

    if (verdict === BAIL) {
      this.fall('land', impact);
    } else {
      /* Snap the board straight — forward or switch, whichever was closer —
         but only if this was actually a jump.

         Doing it on every touchdown is what made the controls feel haunted.
         The mountain is covered in rollers and knolls, so a rider carving
         across it is leaving the ground and returning several times a
         second, and each of those hops was rewriting the yaw to point wherever
         the *velocity* happened to be going. From the player's hands that is
         indistinguishable from the game steering for them at random, and it
         fought hardest exactly when they were holding the tightest carve —
         which is when the board is furthest from the direction of travel and
         so had the most to be snapped away. `judged` is already the test for
         "this was a trick rather than chatter", and it is the right test
         here too. */
      if (judged) {
        this.yaw = isSwitch ? travelYaw + Math.PI : travelYaw;
        this.switchStance = isSwitch;
      }
      // A sketchy landing wobbles and costs speed; a clean one costs nothing
      if (verdict === SKETCHY) vel.multiplyScalar(0.86);
      // The snow takes the vertical; the rider keeps the run
      vel.addScaledVector(n, -Math.min(0, vel.dot(n)));
      // …but not all of it. A long drop converts a lot of height into speed
      // along the hill, and with nothing taken back a rider could ride one
      // kicker into 270 km/h and never slow down. Everything past the point
      // the legs can absorb comfortably is paid for on the way out, which is
      // also what makes a big air a decision rather than a free boost.
      const excess = Math.max(0, impact - RIDER.softImpact);
      if (excess > 0) vel.multiplyScalar(1 - Math.min(0.24, excess * 0.012));
      this.landing = summary;
      this.emit('land', summary);
    }
    return summary;
  }

  /* --- going down, and getting back up -------------------------------- */

  /* `into` is the speed that went into whatever caused this, in m/s. It is
     what decides how far the rider is thrown: a bail off a bad landing hands
     over the impact, a tree hands over the closing speed, and a spill at
     walking pace hands over almost nothing and is over in a second. */
  fall(cause = 'land', into = 0) {
    if (this.state === 'fall') return;
    this.state = 'fall';
    this.grounded = false;
    this.airborne = true;
    this.fallElapsed = 0;
    this.fallTimer = 0;
    this.tumble = 0;
    this.charge = 0;
    this.charging = false;
    this.grab = 0;
    this.grabbing = false;
    this.grabTime = 0;
    this.extension = 0;

    // What the body keeps, and what the collision turns into height. A rider
    // doing 40 m/s into a trunk leaves it doing 25 and climbing, which is
    // most of a second in the air before the hill even gets a say.
    this.vel.multiplyScalar(RIDER.fallLaunch);
    const lift = Math.max(into, this.vel.length() * 0.35) * RIDER.fallLift;
    this.vel.y += Math.min(15, lift);
    this.pos.y = Math.max(this.pos.y, this.world.height(this.pos.x, this.pos.z) + 0.05);
    this.compressionVel += 8;
    this.emit('fall', cause);
  }

  /* A tumble is a body, not a timer. While it is off the ground it is
     ballistic; when it arrives it bounces, lower each time, and slides. The
     rider is allowed up once they have actually stopped — or once `fallMax`
     has run out, because a body that finds a hollow to oscillate in should
     not be able to hold the run hostage. */
  fallStep(dt) {
    const { pos, vel } = this;

    if (this.state === 'fall') {
      this.fallElapsed += dt;
      const sp = vel.length();
      this.tumble += dt * 9 * clamp(sp / 12, 0.25, 2.2);
      const gy = this.world.height(pos.x, pos.z);

      if (this.airborne) {
        vel.y -= RIDER.gravity * dt;
        vel.multiplyScalar(Math.max(0, 1 - RIDER.fallDrag * dt));
        pos.x += vel.x * dt;
        pos.y += vel.y * dt;
        pos.z += vel.z * dt;

        const ny = this.world.height(pos.x, pos.z);
        if (pos.y <= ny) {
          pos.y = ny;
          const n = normalFrom(this.world.height, pos.x, pos.z, this._n);
          this.normal.copy(n);
          const into = vel.dot(n);
          if (into < 0) {
            // Bounce, and take the rest of it out on the snow
            vel.addScaledVector(n, -into * (1 + RIDER.fallBounce));
            this.emit('impact', -into);
            this.compressionVel += Math.min(-into, 24) * 0.6;
          }
          vel.multiplyScalar(0.72);
          // Below a certain hop it is no longer flying, it is sliding
          if (vel.dot(n) < 2.2) {
            this.airborne = false;
            vel.addScaledVector(n, -vel.dot(n));
          }
        }
      } else {
        // Still a body sliding down a hill: gravity on the tangent, and a
        // lot more friction than a board on its edge
        const n = normalFrom(this.world.height, pos.x, pos.z, this._n);
        this.normal.copy(n);
        vel.addScaledVector(n, -vel.dot(n));
        const g = this._g.set(0, -RIDER.gravity, 0);
        const gn = g.dot(n);
        vel.x += (g.x - n.x * gn) * dt;
        vel.y += (g.y - n.y * gn) * dt;
        vel.z += (g.z - n.z * gn) * dt;
        const s = vel.length();
        if (s > 1e-4) vel.multiplyScalar(Math.max(0, s - RIDER.fallFriction * dt) / s);

        pos.x += vel.x * dt;
        pos.z += vel.z * dt;
        pos.y = this.world.height(pos.x, pos.z);

        // And the hill can hand them back into the air — a tumble off a
        // cliff should not stick to the face on the way down
        const drop = this.world.height(pos.x + vel.x * 0.09, pos.z + vel.z * 0.09);
        if (pos.y - drop > 0.5) this.airborne = true;
      }

      this.slide = vel.length() * 0.8;
      this.extension = Math.max(0, pos.y - gy);

      const stopped = !this.airborne && vel.length() < RIDER.fallRest;
      if ((stopped && this.fallElapsed > RIDER.fallMin) || this.fallElapsed > RIDER.fallMax) {
        // Up on the board again, pointed downhill, with a moment of grace so
        // the same tree cannot take you twice
        this.state = 'rise';
        this.grounded = true;
        this.airborne = false;
        this.fallTimer = RIDER.riseTime;
        pos.y = this.world.height(pos.x, pos.z);
        // Velocity first, then the board to match it. Read the other way
        // round, a rider who had stopped took their heading from whatever
        // direction they were last sliding — sideways, or back up the hill —
        // and then got a downhill push underneath it, so the first thing
        // they did on standing up was skid the restart speed away.
        /* Getting up facing where you were facing.

           This used to set the velocity downhill and then rotate the board
           to match it, so every recovery ended with the rider squared up to
           the fall line whatever they had been doing — which is the same
           complaint as the one above and looks even stranger after a crash,
           because the rider visibly turns himself downhill while standing
           up. Now the board keeps its heading and the *velocity* is pointed
           along it instead. The one exception is a heading that is pointing
           back up the mountain, which is not somewhere a rider can start
           from: that gets turned to the nearest direction across the hill,
           which is what anyone actually does after falling on a slope. */
        if (vel.length() < 3) {
          const n = normalFrom(this.world.height, pos.x, pos.z, this._n);
          const dl = Math.hypot(n.x, n.z);
          const dx = dl > 1e-4 ? n.x / dl : 0;
          const dz = dl > 1e-4 ? n.z / dl : -1;
          const hx = Math.sin(this.yaw);
          const hz = -Math.cos(this.yaw);
          // Facing uphill? Take whichever traverse is nearer instead.
          if (hx * dx + hz * dz < -0.1) {
            const side = hx * dz - hz * dx < 0 ? 1 : -1;
            this.yaw = Math.atan2(-dz * side, -dx * side);
          }
          vel.set(Math.sin(this.yaw) * 6, 0, -Math.cos(this.yaw) * 6);
        }
        vel.y = 0;
        this.grace = 1.3;
        this.emit('rise');
      }
    } else {
      // Getting up. Ordinary sliding physics, and the model reads `fallTimer`
      // counting down across the window to blend the body back upright.
      this.fallTimer -= dt;
      const n = normalFrom(this.world.height, pos.x, pos.z, this._n);
      this.normal.copy(n);
      vel.addScaledVector(n, -vel.dot(n));
      const g = this._g.set(0, -RIDER.gravity, 0);
      const gn = g.dot(n);
      vel.x += (g.x - n.x * gn) * dt;
      vel.y += (g.y - n.y * gn) * dt;
      vel.z += (g.z - n.z * gn) * dt;
      const s = vel.length();
      if (s > 1e-4) vel.multiplyScalar(Math.max(0, s - 4 * dt) / s);
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      pos.y = this.world.height(pos.x, pos.z);
      this.slide = s * 0.5;

      if (this.fallTimer <= 0) {
        this.state = 'ride';
        this.tumble = 0;
        this.switchStance = false;
        this.slide = 0;
      }
    }

    this.springStep(dt);
  }

  /* --- the legs ------------------------------------------------------- */

  springStep(dt) {
    // A damped spring pulled towards the load the slope is putting through
    // it. The load is one g of gravity plus whatever the edge is asking
    // for, which is why a hard carve visibly squats the rider.
    const w = RIDER.springFreq * TAU;
    const lateralG = (this.carveLoad * RIDER.grip) / RIDER.gravity;
    const load = this.grounded && this.state !== 'fall'
      ? Math.hypot(1, lateralG)
      : 0;
    this.gLoad = approach(this.gLoad, load, 9, dt);

    let target = load * RIDER.compressPerG * RIDER.gravity / 9.81;
    if (this.tucking) target = Math.max(target, RIDER.tuckCompress);
    if (this.charging) target = RIDER.compressMax * (0.35 + 0.65 * this.charge);
    if (this.state === 'fall') target = RIDER.compressMax;
    if (!this.grounded && this.state !== 'fall') target = -0.12 * Math.min(1, this.airTime * 3);

    this.compressionVel += (target - this.compression) * w * w * dt;
    this.compressionVel *= Math.exp(-2 * RIDER.springDamp * w * dt);
    this.compression += this.compressionVel * dt;
    this.compression = clamp(this.compression, -0.3, RIDER.compressMax);
  }

  /* --- what the world does to the rider -------------------------------- */

  /* Hitting something solid.

     `nx, nz` is the direction from the obstacle to the rider — the way they
     are about to be pushed — and `closeness` is 0 at the edge of the contact
     and 1 dead centre of it.

     What decides the outcome is the speed actually being carried *into* the
     thing, which is the quantity that hurts and the one the old version
     never looked at: it judged on centrality alone, so a trunk clipped at
     walking pace and the same trunk at 150 km/h were the same event. Now
     direction only decides how much of the speed is aimed at the tree, and
     the speed decides what that costs. Returns what happened so the caller
     can pick a sound for it. */
  strike(nx, nz, closeness) {
    const push = this._h.set(nx, 0, nz);
    const len = push.length();
    if (len < 1e-5) push.set(0, 0, 1);
    else push.multiplyScalar(1 / len);

    // Speed into the obstacle: everything the rider has, minus whatever was
    // already carrying them away from it
    const into = Math.max(0, -(this.vel.x * push.x + this.vel.z * push.z));
    const severity = clamp(
      (into - RIDER.brushSpeed) / (RIDER.wipeoutSpeed - RIDER.brushSpeed), 0, 1.6,
    ) * (0.45 + 0.55 * clamp(closeness, 0, 1));

    if (severity >= 1) {
      this.fall('hit', into);
      return 'fall';
    }
    if (into < RIDER.brushSpeed * 0.5) {
      // Barely touched it. A nudge and a little powder, and the run goes on.
      this.vel.addScaledVector(push, 1.5 + 2 * severity);
      this.compressionVel += 3;
      return 'brush';
    }
    // Glancing: spun off the line, and it costs a share of the speed that
    // went into the trunk rather than a flat percentage of everything
    this.vel.addScaledVector(push, 3 + 9 * severity);
    this.vel.multiplyScalar(1 - 0.28 * severity);
    this.compressionVel += 9 * severity;
    this.slide += 6 * severity;
    // A shove on the yaw as well, but a small one. Half a radian was an
    // instant thirty-degree turn arriving unannounced, and between that and
    // the sideways impulse the player had no way to tell what had happened
    // to them. The impulse alone reads as being knocked off line; the
    // self-centring then brings the board round to match, which is a thing
    // the player can see happening rather than a thing that has happened.
    this.yaw += (Math.sign(nx * this.heading.z - nz * this.heading.x) || 1) * severity * 0.18;
    return 'graze';
  }

  brush(strength) {
    this.vel.multiplyScalar(Math.max(0.35, 1 - strength));
    this.slide += 4 * strength;
    this.compressionVel += 4 * strength;
  }
}

/* The name of what just happened, in the language of the sport. Reads the
   quantised counts rather than the raw radians, so it always says the same
   number the score is paying for. */
export function trickName(s, verdict) {
  const parts = [];
  const steps = s.halfTurns * 180;
  if (steps >= 180) parts.push(`${s.spin > 0 ? 'FRONTSIDE' : 'BACKSIDE'} ${steps}`);

  const flips = s.flipTurns;
  if (flips >= 1) parts.push(flips > 1 ? `${flips}× BACKFLIP` : 'BACKFLIP');

  if (s.grabTime > 0.55) parts.push('TWEAKED GRAB');
  else if (s.grabTime > 0.18) parts.push('GRAB');

  if (!parts.length) {
    if (s.airTime > 1.25) parts.push('BIG AIR');
    else return null;
  }
  if (s.switchStance) parts.unshift('SWITCH');
  let name = parts.join(' + ');
  if (verdict === SKETCHY) name += ' (SKETCHY)';
  return name;
}
