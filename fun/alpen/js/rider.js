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
     ninety milliseconds forward and asks where the ground will be there. If
     the hill has dropped away, the current speed is handed to the local
     surface tangent and released. A kicker's lip, the crest of a roller, the
     top of a quarterpipe and the edge of a cliff all launch by the same rule:
     twice the speed means twice every component of launch velocity.

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

   Air used to weaken gravity through the apex to manufacture hang time. That
   made a jump's acceleration depend on where it was in the arc and stopped
   speed, tangent and gravity from predicting the result. The rider now keeps
   the ramp's tangent velocity and receives the same downward acceleration on
   every airborne step. The game gravity is deliberately brisk; its direction
   and consistency are not negotiable.

   And a fall was a timer. Whatever put you down, you slid for 1.35 seconds
   and stood up. Now it is a body: the speed that went into the tree comes
   back out as height and tumble, and the rider is ballistic until the snow
   has finished with them — so a spill at walking pace is over in a second
   and catching a trunk at 150 km/h throws you a long way down the hill. */

import { RIDER } from './config.js';
import { normalFrom } from './terrain.js';


const TAU = Math.PI * 2;

const wrapPi = (a) => {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
const momentumStability = (speed) => {
  const u = clamp(
    (speed - RIDER.stabilityFrom)
    / Math.max(1e-5, RIDER.stabilityFull - RIDER.stabilityFrom),
    0, 1,
  );
  // Ease out: composure arrives as soon as the board has real momentum, then
  // settles gently into its maximum instead of switching on near top speed.
  return u * (2 - u);
};

/* A centred height-field normal is correct until the surface deliberately
   ends. At a kicker lip its forward sample is already on the snow below, so
   the finite difference invents a near-vertical wall just before the edge and
   projects the rider's momentum into nothing.

   When the next 35 cm drops much further than the trailing surface rose, use
   a one-sided derivative along travel instead. The cross-slope derivative
   remains centred, so carving across a lip still reads the ramp's real camber.
   The launch look-ahead then sees the missing ground and does its own job. */
const CONTACT_EPS = 0.35;
function trailingNormalFrom(fn, x, z, vel, out) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 0.25) return normalFrom(fn, x, z, out);

  const fx = vel.x / speed;
  const fz = vel.z / speed;
  const rx = -fz;
  const rz = fx;
  const h0 = fn(x, z);
  const behind = fn(x - fx * CONTACT_EPS, z - fz * CONTACT_EPS);
  const right = fn(x + rx * CONTACT_EPS, z + rz * CONTACT_EPS);
  const left = fn(x - rx * CONTACT_EPS, z - rz * CONTACT_EPS);
  const dForward = (h0 - behind) / CONTACT_EPS;
  const dRight = (right - left) / (2 * CONTACT_EPS);
  const dx = fx * dForward + rx * dRight;
  const dz = fz * dForward + rz * dRight;
  return out.set(-dx, 1, -dz).normalize();
}

function ridingNormalFrom(fn, x, z, vel, out, contact = null) {
  if (contact) contact.edgeAhead = false;
  normalFrom(fn, x, z, out);
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 0.25) return out;

  const fx = vel.x / speed;
  const fz = vel.z / speed;
  const h0 = fn(x, z);
  const ahead = fn(x + fx * CONTACT_EPS, z + fz * CONTACT_EPS);
  const behind = fn(x - fx * CONTACT_EPS, z - fz * CONTACT_EPS);
  const trailingRise = h0 - behind;
  if (contact) {
    const scan = RIDER.lipCommitDistance;
    const scanAhead = fn(x + fx * scan, z + fz * scan);
    const tangentAhead = h0 + trailingRise * (scan / CONTACT_EPS);
    contact.edgeAhead = tangentAhead - scanAhead > 0.45;
  }
  // Compare against continuation of the trailing tangent. This separates a
  // real lip from an ordinary downhill pitch, however steep that pitch is.
  if (h0 + trailingRise - ahead <= 0.45) return out;
  if (contact) contact.edgeAhead = true;

  return trailingNormalFrom(fn, x, z, vel, out);
}

/* The snow still owns contact through the exact normal above, but steering a
   1.8-metre board from a single 70-centimetre terrain chord makes speed feel
   progressively more nervous: at 48 m/s almost the entire sample is replaced
   every 120 Hz tick. This second normal is only for handling and presentation.
   Its fore/aft chord grows towards the board's physical length with momentum;
   the lateral chord stays narrow so camber and the player's edge remain live.
   A detected lip never uses it — ramp support and takeoff stay on the raw
   trailing tangent. */
function handlingNormalFrom(fn, x, z, vel, support, out, contact = null) {
  const speed = Math.hypot(vel.x, vel.z);
  const stable = momentumStability(speed);
  if (contact) contact.footprint = CONTACT_EPS * 2;
  if (stable <= 1e-5 || contact?.edgeAhead || speed < 0.25) {
    return out.copy(support);
  }

  const fx = vel.x / speed;
  const fz = vel.z / speed;
  const rx = -fz;
  const rz = fx;
  const along = CONTACT_EPS
    + (RIDER.contactHalfLength - CONTACT_EPS) * stable;
  const across = CONTACT_EPS;
  const ahead = fn(x + fx * along, z + fz * along);
  const behind = fn(x - fx * along, z - fz * along);
  const right = fn(x + rx * across, z + rz * across);
  const left = fn(x - rx * across, z - rz * across);
  const dForward = (ahead - behind) / (2 * along);
  const dRight = (right - left) / (2 * across);
  const dx = fx * dForward + rx * dRight;
  const dz = fz * dForward + rz * dRight;
  if (contact) contact.footprint = along * 2;
  return out.set(-dx, 1, -dz).normalize();
}

/* Landing outcomes, in order of how much they cost */
export const CLEAN = 0;
export const SKETCHY = 1;
export const BAIL = 2;

/* The three reaches, indexing `RIDER.grabs`. Named rather than numbered
   because the pose book in `riderModel.js` indexes the same table and a bare
   2 in two files is how a nose grab quietly becomes a method. */
export const GRAB_INDY = 0;
export const GRAB_NOSE = 1;
export const GRAB_METHOD = 2;

// What the board stands on when the world cannot say: plain groomed piste.
// Hoisted so the hot path never carries an object literal.
const GROOMED_FALLBACK = { rock: 0, groomed: 1, ice: 0, powder: 0 };

export class Rider {
  /* `world.height(x, z)` is the hill plus whatever kickers sit on it.
     `world.canStall(x, z)`, when supplied, distinguishes a committed wall
     climb from ordinary rideable piste. */
  constructor(THREE, world) {
    this.THREE = THREE;
    this.world = world;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.heading = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);

    this._n = new THREE.Vector3();
    this._supportN = new THREE.Vector3();
    this._launchN = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._g = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._flow = new THREE.Vector3(0, 0, -1);
    this._flowRight = new THREE.Vector3(1, 0, 0);
    this._contact = { edgeAhead: false, footprint: CONTACT_EPS * 2 };
    this.UP = new THREE.Vector3(0, 1, 0);

    this.events = {
      launch: [], land: [], fall: [], rise: [], impact: [],
      pump: [], push: [], butter: [], perfectPop: [],
    };

    this.reset(0);
  }

  on(name, fn) {
    this.events[name].push(fn);
    return this;
  }

  emit(name, a, b) {
    const list = this.events[name];
    // An event nobody registered must be a no-op, not a TypeError: this runs
    // inside the physics step, where one bad name used to crash the frame —
    // `perfectPop` fired on exactly the pop it was named after and its list
    // was missing from the registry above.
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](a, b);
  }

  reset(z = 0, x = null) {
    const posX = x !== null ? x : 0;
    this.pos.set(posX, this.world.height(posX, z), z);
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
    this.pushing = false;       // rear foot is out of the binding and skating
    this.pushPhase = 0;         // 0..1 authored cycle, shared by physics and rig
    this.pushStroke = 0;        // completed plants in this run, for diagnostics
    this.brake = 0;           // 0..1 pressure in the skidded braking edge
    this.brakeSide = 1;       // side chosen when S begins, held through the stop
    this.spinVel = 0;
    this.flipVel = 0;

    this.airTime = 0;
    this.spinAccum = 0;
    this.flipAccum = 0;
    this.grabTime = 0;
    this.grab = 0;           // 0..1, how far into the grab pose
    this.grabbing = false;
    this.grabKind = 0;       // which of RIDER.grabs the hand went for
    this.press = 0;          // 0..1 pressure into a nose or tail press
    this.pressNose = false;  // …whether the rider called it a nose press…
    this.pressEnd = 1;       // …and which end of the *board* that froze onto
    this.pressTime = 0;
    this.pressSpin = 0;      // radians the board has come round on that end
    this.switchStance = false;
    this.stallTimer = 0;     // how long the board has been too slow for the pitch
    this.edge = 0;           // radians the board is rolled up onto its edge
    this.bend = 0;           // g of load the ground's own curvature is adding
    this._lastGrad = 0;      // last step's gradient along travel, for its rate
    this._bendReady = false;
    this.balance = 1;        // 1 when the body is where the turn needs it
    this.leanErr = 0;        // signed: + is under-leaned, − is over-leaned
    this.slide = 0;          // m/s of sideways wash, for spray and sound
    this.lateral = 0;        // signed, so the spray knows which way to fly
    this.carveLoad = 0;      // 0..1, how hard the edge is working
    this.climbRate = 0;      // m/s of height being gained, for the HUD and the scrub
    this.offPiste = 0;       // 0..1, how deep into the unpisted boundary snow
    this.lipPop = false;     // was the last launch popped on the lip
    this.takeoffSpeed = 0;   // speed committed to the current trick
    this.fallTimer = 0;
    this.fallElapsed = 0;
    this.airborne = false;   // during a tumble: flying, rather than sliding
    this.grace = 1.2;
    this.tumble = 0;
    this.startZ = z;
    this.startY = this.pos.y;
    this.landing = null;     // set for one frame after a landing
    this.flowDrive = 0;      // how much meter the powered tuck may spend
    this.yawGlide = 0;       // presentation-only remainder of a landing snap
    this.contactFootprint = CONTACT_EPS * 2;
    this._handlingReady = false;
  }

  get speed() {
    return this.vel.length();
  }

  get distance() {
    return Math.max(0, this.startZ - this.pos.z);
  }

  /* Metres of descent, which on a mountain is the more interesting of the two
     and was the one the read-out did not have. A kilometre of this run is a
     little under three hundred metres of drop, and that is the number a rider
     actually quotes about a day. */
  get drop() {
    return Math.max(0, this.startY - this.pos.y);
  }

  get boardForward() {
    const hx = Math.sin(this.yaw);
    const hz = -Math.cos(this.yaw);
    const into = hx * this.normal.x + hz * this.normal.z;
    const tx = hx - this.normal.x * into;
    const ty = -this.normal.y * into;
    const tz = hz - this.normal.z * into;
    const len = Math.hypot(tx, ty, tz) || 1;
    const signed = (this.vel.x * tx + this.vel.y * ty + this.vel.z * tz) / len;
    return signed * (this.switchStance ? -1 : 1);
  }

  /* The course is endless rather than circular: -Z is always towards the next
     piece of mountain. Projecting that direction onto the local surface gives
     us a frame that follows banks and walls without ever mistaking a U-turn
     for another valid downhill line. */
  courseFrame(n) {
    this._flow.set(0, 0, -1);
    this._flow.addScaledVector(n, -this._flow.dot(n));
    if (this._flow.lengthSq() < 1e-6) this._flow.set(0, 0, -1);
    else this._flow.normalize();
    this._flowRight.copy(this._flow).cross(n);
    if (this._flowRight.lengthSq() < 1e-6) this._flowRight.set(1, 0, 0);
    else this._flowRight.normalize();
    return this._flow;
  }

  /* Preserve tangential speed but keep its direction inside the forward half
     of the course. This is a guard rail for exceptional impulses, steep
     landing projections and near-zero gravity assists; ordinary carving stays
     comfortably inside it and is untouched. */
  limitCourseVelocity(v, n, limit) {
    const flow = this.courseFrame(n);
    const along = v.dot(flow);
    const across = v.dot(this._flowRight);
    const speed = Math.hypot(along, across);
    if (speed < 1e-5) return false;
    const angle = Math.atan2(across, along);
    const fixed = clamp(angle, -limit, limit);
    if (Math.abs(fixed - angle) < 1e-5) return false;
    v.copy(flow).multiplyScalar(Math.cos(fixed) * speed)
      .addScaledVector(this._flowRight, Math.sin(fixed) * speed);
    return true;
  }

  /* `yaw` is the nose of the board; in switch the direction of travel is its
     tail. Clamp that stance-adjusted heading, not the raw nose, so regular and
     switch controls obey exactly the same course rule. */
  limitCourseYaw(n, limit, dt = Infinity) {
    const flow = this.courseFrame(n);
    const courseYaw = Math.atan2(flow.x, -flow.z);
    const stanceOffset = this.switchStance ? Math.PI : 0;
    const travelYaw = this.yaw - stanceOffset;
    const off = wrapPi(travelYaw - courseYaw);
    const fixed = clamp(off, -limit, limit);
    if (Math.abs(fixed - off) < 1e-5) return false;
    // Same bounded pull-back as the skid clamp, and for the same reason: a
    // press release shrinks `limit` in one frame, and the board should come
    // back to course over a few steps rather than in one write.
    const corr = wrapPi(courseYaw + fixed + stanceOffset - this.yaw);
    const maxCorr = RIDER.skidRecover * dt;
    this.yaw += clamp(corr, -maxCorr, maxCorr);
    return true;
  }

  /* ------------------------------------------------------------------ */

  step(dt, input) {
    this.landing = null;
    this.grace = Math.max(0, this.grace - dt);
    /* The rendered pose's share of the last landing snap, draining. Purely
       visual — see where it is written in `land` and read in main's view
       swap — so nothing in this step may consult it. */
    this.yawGlide *= Math.exp(-RIDER.glideRate * dt);
    if (Math.abs(this.yawGlide) < 0.002) this.yawGlide = 0;

    // Getting up is part of going down, so both states run the recovery
    // step. Dispatching only on 'fall' stopped the timer the moment
    // `fallStep` promoted itself to 'rise' — the rider went back to normal
    // physics while the model still had them face-down.
    if (this.state === 'fall' || this.state === 'rise') return this.fallStep(dt);
    if (this.grounded) this.groundStep(dt, input);
    else this.airStep(dt, input);
    this.springStep(dt);
  }

  /* --- on the snow --------------------------------------------------- */

  groundStep(dt, input) {
    const { pos, vel } = this;
    /* A snowboard stops across its travel, not by acquiring generic drag.

       Choose one side at the start of the press and keep it. Changing sides
       halfway through a speed check would ask the board to cross 154° through
       its direction of travel; a rider instead releases and sets the other
       edge. A/D can choose the side, an existing carve continues naturally,
       and a straight-line press defaults to the stance's heel side. */
    if (input.brake && this.brake < 0.02) {
      this.brakeSide = Math.abs(input.turn) > 0.08
        ? Math.sign(input.turn)
        : Math.abs(this.edge) > 0.02
          ? Math.sign(this.edge)
          : (this.switchStance ? -1 : 1);
    }
    this.brake = approach(
      this.brake, input.brake ? 1 : 0,
      input.brake ? RIDER.brakeEngage : RIDER.brakeRelease, dt,
    );
    const braking = this.brake;
    const brakeActive = braking > 0.02;

    /* THE PRESS. Q on the snow does what Q in the air does — it puts the
       board where the hands are — and on the snow that means standing on one
       end of it and letting the other one come out of the running surface.

       W chooses the nose because W means forward everywhere else in this
       game; without it the weight goes back onto the tail, which is the press
       anybody does without thinking about it. A speed check cancels it
       outright: there is no version of a butter that is also a rider setting
       an edge across the hill to stop.

       The pressure ramps rather than switching, and everything the press
       affects is scaled by it, so a tap is a shift of weight and a hold is a
       trick. `pressSpin` is the only bookkeeping — how much the board has
       actually come round since the nose or the tail went light — and it is
       what the run is paid for when the press ends. */
    const wantPress = !!input.trickGrab && !input.brake && !input.jump
      && !this.pushing && this.speed > 1.2;
    if (wantPress && this.press < 0.02) {
      this.pressNose = !!input.tuck;
      /* …and which *physical* end of the board that is, frozen here.

         "Nose" is a fact about the rider — it is whichever end is leading —
         and a butter is the one manoeuvre that changes which end that is
         halfway through itself. Left to be re-derived from the live stance,
         the drawn press eased through flat and stood the rider up on the
         opposite end at the moment the rotation passed ninety degrees, which
         is precisely the thing the mechanic is defined as not doing: the
         board rotates on one buried contact point. So the stance at capture
         is folded in once, and −1 is the board's own −Z end for ever after. */
      this.pressEnd = (input.tuck ? -1 : 1) * (this.switchStance ? -1 : 1);
      this.pressSpin = 0;
      this.pressTime = 0;
    }
    this.press = approach(this.press, wantPress ? 1 : 0,
      wantPress ? RIDER.pressRate : RIDER.pressRelease, dt);
    const pressing = this.press > 0.02;
    if (pressing) this.pressTime += dt;
    else if (this.pressTime > 0) {
      // The press has settled back onto both contact points. Whatever it
      // carried round is the trick, and it is judged once, here.
      this.emit('butter', Math.abs(this.pressSpin), this.pressTime);
      this.pressTime = 0;
      this.pressSpin = 0;
    }

    /* …and the tuck comes off while one is on, which is why the press is
       resolved first.

       W means two things at once here — it is the powered tuck and it is the
       nose selector — and holding it with Q used to give both. The powered
       floor is applied after friction and after the press's own plough, so a
       nose press accelerated at seven and a half metres per second squared
       while a tail press slowed down, which made the modifier that picks the
       nose strictly better than not pressing the key. That is a mechanic
       paying for itself.

       Refusing the combination is also the more honest statement: a tuck is a
       body folded over the board and a press is a body standing on one end of
       it, and nobody has ever been in both. So W still chooses the nose, and
       for as long as the press is on it chooses nothing else. */
    this.tucking = !!input.tuck && !input.brake && braking < 0.05
      && !pressing;
    // Capture the W baseline before the new contact plane removes any velocity
    // pointing into it. Otherwise a sharp terrain-normal change can make the
    // displayed speed dip before the powered floor for this step is formed.
    const poweredEntrySpeed = this.tucking ? vel.length() : 0;
    const support = ridingNormalFrom(
      this.world.height, pos.x, pos.z, vel, this._supportN, this._contact,
    );
    const handling = handlingNormalFrom(
      this.world.height, pos.x, pos.z, vel, support, this._n, this._contact,
    );
    const stable = momentumStability(Math.hypot(vel.x, vel.z));
    if (!this._handlingReady || this._contact.edgeAhead) {
      this.normal.copy(handling);
      this._handlingReady = true;
    } else {
      const response = RIDER.handlingResponseMin
        + (RIDER.handlingResponseMax - RIDER.handlingResponseMin) * stable;
      this.normal.lerp(handling, 1 - Math.exp(-dt / response)).normalize();
    }
    this.contactFootprint = this._contact.footprint;
    const n = this.normal;

    // Anything pointing into the slope is absorbed by the snow. What it was
    // worth is remembered — it is the load the legs have to take.
    const into = vel.dot(support);
    if (into < 0) {
      vel.addScaledVector(support, -into);
      if (into < -2) this.emit('impact', -into);
      this.compressionVel += Math.min(-into, 26) * 0.5;
    } else {
      vel.addScaledVector(support, -into);
    }
    const enteringSpeed = vel.length();

    /* Turn the old invisible crawl assist into an action the rider performs.

       Hysteresis keeps the foot from flickering in and out around one exact
       speed. Once a cycle has begun it is allowed to finish even if gravity
       or W carries the board past `pushStop`; braking, a jump request, strong
       steering or the lip itself aborts it immediately because none of those
       is a moment in which a rear foot belongs loose beside the board. */
    const canPush = !brakeActive && !input.jump
      && Math.abs(input.turn || 0) < 0.72 && !this._contact.edgeAhead;
    if (!canPush) {
      this.pushing = false;
    } else if (!this.pushing && enteringSpeed < RIDER.pushStart) {
      this.pushing = true;
      this.pushPhase = 0;
    }
    const finishPush = this.pushing && enteringSpeed >= RIDER.pushStop;

    // W is a powered tuck. This is a speed floor rather than a
    // one-off force: snow friction, a traverse, or an extreme drag value can
    // never quietly create another terminal velocity. Gravity and clean
    // terrain can still add more than the floor, so the mountain remains part
    // of the acceleration instead of being overwritten by it.
    /* …and how hard, which is what the flow meter is spent on. `flowDrive`
       is written once a step by `stepFlow` in main.js: a full meter is the
       whole powered tuck this has always been, an empty one is a third of
       it. The floor still cannot create a second terminal velocity — it is
       still a floor, and gravity and a clean line still beat it — but the
       speed it guarantees is now something the run has to have earned. */
    const drive = 0.34 + 0.66 * Math.min(1, Math.max(0, this.flowDrive));
    const poweredSpeed = this.tucking
      ? poweredEntrySpeed + RIDER.tuckAcceleration * drive * dt
      : 0;

    // Gravity, resolved on the tangent. This is the whole engine: steep is
    // fast, banked is slow, and neither needed a special case.
    const g = this._g.set(0, -RIDER.gravity, 0);
    const gn = g.dot(support);
    vel.x += (g.x - support.x * gn) * dt;
    vel.y += (g.y - support.y * gn) * dt;
    vel.z += (g.z - support.z * gn) * dt;

    /* How hard the rider is climbing, in metres of height per second.

       The surface gradient falls straight out of the normal — for a height
       field, n ∝ (−∂h/∂x, 1, −∂h/∂z) — so this is the rate the ground under
       the rider is rising along the direction they are actually travelling.
       Positive is uphill. Everything below that has an opinion about the
       hill's direction reads this rather than guessing from the heading. */
    const ny = Math.max(0.2, support.y);
    this.climbRate = (-support.x * vel.x - support.z * vel.z) / ny;

    /* THE BEND — how hard the shape of the ground is pressing the board into
       the snow, over and above the one g gravity was already charging.

       A path that follows a curved surface at v metres a second is being
       accelerated towards the centre of that curve at v²·κ, and the only thing
       available to do the accelerating is the snow. So a hollow presses, a
       crest lifts, and the whole of it is one number.

       κ comes from the gradient along the direction of travel, differentiated
       *per metre of ground covered* rather than per second. That distinction is
       the entire correctness of this: per second, a rider accelerating down a
       straight pitch shows a gradient-along-travel that appears to be changing,
       and the term would invent a crest out of nothing but the speeding up.
       Per metre it is a property of the hill and the heading alone, and the
       speed re-enters where the physics actually puts it — squared.

       It is measured on `this.normal`, the board-length handling normal, and
       not on the raw contact one. That is not a shortcut either: a snowboard is
       a metre and a half of stiff composite and it genuinely does bridge the
       six-metre chatter octave rather than tracing it. The normal has already
       been filtered over the board's own footprint, so what comes out is the
       curvature the board can actually feel. */
    const flatSpeed = Math.hypot(vel.x, vel.z);
    let bendG = 0;
    if (flatSpeed > 0.6) {
      const gradAlong = -(n.x * vel.x + n.z * vel.z)
        / (flatSpeed * Math.max(0.2, n.y));
      const ds = flatSpeed * dt;
      if (this._bendReady && ds > 1e-4) {
        const shape = 1 + gradAlong * gradAlong;
        const kappa = ((gradAlong - this._lastGrad) / ds) / (shape * Math.sqrt(shape));
        bendG = (flatSpeed * flatSpeed * kappa) / RIDER.gravity;
      }
      this._lastGrad = gradAlong;
      this._bendReady = true;
    } else {
      this._bendReady = false;
    }
    this.bend = approach(this.bend,
      clamp(bendG, RIDER.bendMin, RIDER.bendMax), RIDER.bendSmooth, dt);

    /* And how far out of bounds they are, which is a property of the ground
       rather than of the rider: zero anywhere on the run and on the
       quarterpipe transition, one once the board is well into the unpisted
       snow banked against the containment wall. See `RIDER.wallSpan`. */
    const beyond = this.world.beyond ? this.world.beyond(pos.x, pos.z) : -1;
    this.offPiste = beyond > 0 ? clamp(beyond / RIDER.wallSpan, 0, 1) : 0;

    /* Stalling.

       A snowboard is not a climbing tool. Run out of speed pointing up
       something steep and you do not coast gently to a halt — the board
       stops tracking, the edge that was holding you across the hill has
       nothing left to hold it with, and you go over. Below `stallSlope` the
       rider is allowed to grind down to nothing and skate away again. A
       steep failure is only a fall where
       the world marks it as one — the quarterpipe and outer wall in this
       game. Procedural banks inside the groomed piste can still steal all the
       speed, but they let the board wash downhill instead of firing a hidden
       wipeout timer. */
    const carrying = vel.length();
    const climbSin = carrying > 0.4 ? clamp(this.climbRate / carrying, 0, 1) : 0;
    const needed = Math.min(RIDER.stallCap,
      RIDER.stallSpeed * (climbSin / RIDER.stallSlope));
    /* …and it can only happen to a rider who still had something to lose.

       Without a floor on the speed this rule locks the game up, and it does
       it silently. A rider who stalls on a wall goes down, gets up crawling
       at half a metre a second, is still pointed at the same wall, and stalls
       again inside a third of a second — and again, and again. Observed: four
       kilometres an hour for twenty-four seconds, the board slowly sliding
       backwards, no way out of it and nothing on screen to say why.

       A stall is the failure of a rider who was *carrying* speed up something
       too steep for it. Below `stallMinSpeed` there is no momentum left to
       fail: the recovery skate is already walking them back down the fall
       line, and knocking them over on the way is not a
       physical event, it is a trap. */
    const canStall = this.world.canStall?.(pos.x, pos.z) ?? true;
    if (canStall && !this._contact.edgeAhead
      && carrying > RIDER.stallMinSpeed
      && climbSin > RIDER.stallSlope && carrying < needed) {
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
    /* How far over the board can physically go, which is not a preference.

       The sidecut says a turn of radius sidecut/sin(edge) needs v²·sin(edge)
       /sidecut of lateral grip. Turn that around and the most edge the snow
       can actually support at this speed is

           sin(edge) ≤ grip · sidecut / v²

       — and past it the rider is not turning harder, they are falling over
       sideways. A real rider's body enforces this without them thinking about
       it: you simply cannot lay a board down at 150 km/h the way you can at
       20, because there is nothing holding you up at that angle.

       Leaving it out was a real bug and a bad one. At 30 m/s the rider could
       roll to sixty-six degrees and demand 101 m/s² of grip against the 27
       that exists, and the 74 m/s² of spill went straight into the wash-out —
       so *any* committed turn scrubbed a hundred and eight km/h down to nine
       in under two seconds and then stalled the rider for having no speed
       left. Every carve was a handbrake.

       `edgeReach` lets it be overdriven by a few per cent, which is where the
       edge starts to slip and throw powder without letting go — the narrow
       band the whole handling model lives in. */
    // Fresh storm snow supports a wider, calmer line instead of letting the
    // same clear-weather target over-drive a suddenly weaker edge.
    /* …and off the piste entirely there is very little edge to have. Deep
       wind-loaded snow does not hold a carved traverse: the board sinks,
       washes out and goes down the fall line, which on the containment wall
       points back at the run. See `RIDER.wallWash`. */
    const surf = this.world.surfaceAt?.(pos.x, pos.z) || GROOMED_FALLBACK;
    const matGrip = surf.groomed * 1.0 + surf.powder * 1.25 + surf.ice * 0.65 + surf.rock * 0.70;
    const surfaceGrip = RIDER.grip * (this.world.grip ?? 1) * matGrip
      * (1 - RIDER.wallWash * this.offPiste);

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
    /* Balance is part of the grip, and it is last frame's balance because it
       cannot be this frame's: the mismatch is measured against a lean that is
       computed from the carve, and the carve is computed from the grip. One
       step of 1/120 s is not a lag anyone can feel, and it is the difference
       between a solvable loop and a circular one. */
    // The edge only bites because the board is moving — see `gripSpeed`. This
    // is what stops a crawling rider from standing sideways on a wall.
    const engaged = RIDER.gripLow
      + (1 - RIDER.gripLow) * clamp(speed / RIDER.gripSpeed, 0, 1);
    /* …and how hard the ground is pressing the board into the snow.

       Friction is proportional to normal force, which is the least negotiable
       statement in this file, and until `bend` existed the normal force was a
       constant plus the corner. Now a compression genuinely holds an edge that
       the same edge on a rollover cannot, and the player finds out the way a
       rider does: the turn you set up at the bottom of the roller comes round,
       and the identical input over the crest washes out. It is the first thing
       in the model that makes *where* on the terrain you turn matter at all. */
    const loadGrip = clamp(1 + this.bend * RIDER.loadGrip,
      RIDER.loadGripMin, RIDER.loadGripMax);
    const gripNow = surfaceGrip * engaged * loadGrip
      * (1 - braking * 0.55)
      * (this.tucking ? RIDER.tuckGrip : 1)
      // Half the effective edge is in the air during a press, and it is the
      // reason a butter and a carve are two different things you cannot do at
      // once — not a rule saying so, just an edge that is not in the snow.
      * (1 - RIDER.pressGrip * this.press)
      * (1 - RIDER.balanceGrip + RIDER.balanceGrip * this.balance);

    /* The edge the rider is *allowed* to set, measured against the grip they
       will actually have — not against the nominal grip of dry snow.

       This was the loop that made a fast turn feel unpredictable, and it fed
       itself. The ceiling was computed from `RIDER.grip` while the edge was
       held against `gripNow`, which is reduced by the tuck, by the brake, by
       soft snow and — the one that closes the circle — by balance. So the
       moment balance dipped, the rider was still permitted to ask for the
       full-grip edge angle while only a fraction of that grip existed. The
       excess spilled into the wash-out, the wash-out cost more balance, the
       gap widened, and the whole thing ran away: measured with the key held
       steady, the edge oscillated between one degree and twenty-one and the
       run dumped a hundred and two km/h down to twenty-three in half a
       second, having done nothing at all for the second and a half before it.

       Asking against the grip that exists is the fix, and it is also the more
       honest statement of the model: a rider does not lay the board over as
       far on soft snow, on a tuck, or when they are already fighting for
       balance. `edgeReach` is then the only overdrive there is, and it is a
       tenth — which is the narrow band a wash-out is supposed to live in. */
    const holdable = Math.asin(clamp(
      (gripNow * RIDER.sidecut) / Math.max(1, speed * speed), 0, 1,
    ));
    const edgeCeiling = Math.min(RIDER.edgeMax, holdable * RIDER.edgeReach);

    const edgeControl = clamp(input.turn, -1, 1) * (1 - braking)
      + this.brakeSide * RIDER.brakeEdge * braking;
    const wantEdge = edgeControl * edgeCeiling
      * (this.tucking ? RIDER.tuckTurn : 1);
    this.edge = approach(this.edge, wantEdge, RIDER.edgeRate, dt);

    const sinEdge = Math.abs(Math.sin(this.edge));
    // What the sidecut is asking the hill for, in m/s² of lateral pull
    const demand = (speed * speed * sinEdge) / RIDER.sidecut;
    const carve = Math.min(demand, gripNow);
    const spill = demand - carve;
    const side = Math.sign(this.edge) || 0;

    // The board turns at whatever the edge actually managed to hold. Keep
    // that real yaw rate for the lip: leaving a carve should carry a small
    // amount of angular momentum into the air instead of starting every jump
    // from an artificial zero.
    let lipYawRate = side * (carve / Math.max(3, speed));

    /* …plus the skid-steer that a sidecut cannot provide.

       The carve's turn rate is proportional to speed, so on its own it decays
       to nothing exactly when the rider most needs to bring the nose round —
       and that was a dead end rather than a difficulty: hold a turn, carve
       onto a traverse, and there is no term left that can rotate the board
       back down the fall line. Gravity has no component along a board pointed
       across the hill, so the rider simply stopped, sideways, permanently.

       Below `pivotSpeed` the board can be skidded round instead, which is
       what anybody does at walking pace, and it fades out completely once
       there is enough speed for the edge to do the job properly. */
    const pivot = RIDER.pivotRate * (1 - clamp(speed / RIDER.pivotSpeed, 0, 1));
    if (pivot > 0) lipYawRate += input.turn * pivot;

    // Where the board was pointing before any of the rules below moved it.
    // The press is paid against this, once, after all of them have had their
    // say — see the note beside `pressSpin` further down.
    const stepYaw = this.yaw;

    /* …and the press hands back a second one that has nothing to do with
       speed at all. That is the whole point of standing on one end of the
       board: with the other end unweighted there is no buried edge left to
       resist a rotation, so the board spins under a rider who is otherwise
       going in a perfectly straight line. It is the only steering authority
       in the model that does not come from the sidecut or from a skid, and it
       is what makes a butter possible at ninety km/h as well as at ten. */
    if (this.press > 0.02) lipYawRate += input.turn * RIDER.pressPivot * this.press;

    this.yaw += lipYawRate * dt;
    // A speed check kicks the tail around towards a transverse target. The
    // rate closes smoothly near it, and pressure scales both the target and
    // the authority so tapping S produces a check rather than a full stop.
    // Gated on speed *over the ground*, not tangent speed. High on a wall
    // the tangent speed is mostly vertical, and `atan2` over a near-zero
    // horizontal velocity is a compass with no needle — the pivot used to
    // yank the yaw towards whatever it happened to read.
    if (brakeActive && Math.hypot(vel.x, vel.z) > 0.35) {
      const travelYaw = Math.atan2(vel.x, -vel.z);
      const stanceYaw = travelYaw + (this.switchStance ? Math.PI : 0);
      const brakeYaw = stanceYaw + this.brakeSide * RIDER.brakeAngle * braking;
      const yawError = wrapPi(brakeYaw - this.yaw);
      const pivotRate = clamp(yawError / 0.32, -1, 1)
        * RIDER.brakePivot * braking;
      this.yaw += pivotRate * dt;
      lipYawRate += pivotRate;
    }
    this.spinVel = lipYawRate;

    /* With no input the board settles back in line with where the rider is
       actually travelling, so a nudge does not leave you sideways forever.

       The speed gate used to be 1 m/s, which meant it was still running while
       the rider was almost stationary — and since each skate stroke sends a
       stopped rider downhill along the tangent, the two together quietly
       rotated the board to face down the fall line whenever you came to a
       stop. From the outside that reads as the rider refusing to stand still
       and pointing himself downhill on his own. Above 3.5 m/s the board is
       genuinely tracking and lining it up with the direction of travel is
       what keeps the handling honest; below it, a rider who has stopped is
       allowed to stay pointed wherever they stopped pointing.

       AND IT IS MEASURED ON THE SNOW, which is the whole correctness of it.

       The error used to be `atan2(vel.x, -vel.z)` against `this.yaw` — a
       bearing taken in the world horizontal plane against a bearing taken in
       the world horizontal plane, which sounds like it must be right and is
       not. The velocity this rule reads is rebuilt further down as `h·vFwd`,
       and `h` is the board's heading *projected onto the slope*: on any
       cross-slope that projection comes out at a different compass bearing
       from the raw yaw it was built from. So the rule saw a steering error
       that was nothing but the projection, rotated the board to remove it,
       and thereby tilted the heading further — which made the projection
       difference bigger on the next step. Positive feedback, on a rider
       touching nothing: measured on the opening pitch, the board came round
       at up to eleven degrees a second and a hands-off run left the twenty-
       metre corridor inside five seconds and was a hundred and thirty metres
       out at half a minute, on every seed tried.

       `atan2(vLat, vFwd)` is the same question asked in the board's own
       tangent frame — the slip angle, the thing a rider actually feels — and
       a pure projection difference is invisible to it. A real wash-out still
       has real lateral velocity, so the board still comes back into line
       after a nudge, which is what the rule is for. */
    if (!brakeActive && Math.abs(input.turn) < 0.05 && speed > 3.5) {
      // In switch the direction of travel is the board's tail, so both
      // components flip and the slip angle is the same small number.
      const stance = this.switchStance ? -1 : 1;
      const slip = Math.atan2(vLat * stance, vFwd * stance);
      this.yaw += slip * (1 - Math.exp(-RIDER.selfCentre * dt));
    } else if (!brakeActive && Math.abs(input.turn) < 0.05 && speed < RIDER.fallLineSpeed) {
      /* …and below that, towards the fall line rather than towards the
         direction of travel, because a rider who has almost stopped has no
         meaningful direction of travel to line up with.

         This is the other half of not getting stuck. The board comes to rest
         pointing across the hill — that is where a carve leaves it — and the
         velocity it would otherwise take its heading from is a few
         centimetres a second of nothing. Easing towards downhill is what a
         rider does with their back foot when they have stopped on a slope and
         want to be moving again, and without it the run can end in a place
         the player cannot get out of, which nothing in this game is allowed
         to do.

         AND IT HAS TO ASK FOR A DIRECTION THE COURSE RULE WILL GRANT, or the
         two of them cancel and it is the trap it was written to prevent.

         The fall line is a fact about the ground and it does not care about
         the course. On a bank steep enough across the run, it points further
         round than `courseLimit` allows the board to be — so this rule swung
         the board towards it, `limitCourseYaw` swung it straight back the
         same amount on the same step, and the net rotation was zero. The
         rider stayed pointed up the hill with gravity taking away what little
         speed the skate strokes returned. Measured on one seed: twenty-six
         seconds motionless at a dead stop, rear foot still working, and no
         way out of it — the exact failure described above, reached by a
         different road.

         So the target is the nearest legal downhill: the true fall line if
         the course rule would allow it, and the edge of the cone it permits
         if not. Both rules then want the same thing and the board turns. */
      const dl = Math.hypot(n.x, n.z);
      if (dl > 1e-4) {
        const flow = this.courseFrame(n);
        const courseYaw = Math.atan2(flow.x, -flow.z);
        const rawFall = Math.atan2(n.x / dl, -(n.z / dl));
        const legalFall = courseYaw + clamp(
          wrapPi(rawFall - courseYaw), -RIDER.courseLimit, RIDER.courseLimit,
        );
        const fallYaw = legalFall + (this.switchStance ? Math.PI : 0);
        const swing = wrapPi(fallYaw - this.yaw) * (1 - Math.exp(-1.8 * dt));
        this.yaw += swing;
        /* …and whatever speed is left comes round with the board.

           Rotating the board without the velocity is what "he sometimes
           drives backwards" actually was. At the old threshold this began at
           twelve km/h — still genuinely moving — so the board swung towards
           the fall line while the momentum carried on the way it was already
           going, and the rider ended up travelling one way at a hundred and
           fifty degrees to the way he was pointing. Turning the velocity by
           the same angle keeps the two together: he pivots, rather than
           sliding backwards while facing downhill. It is safe to do at this
           speed and only at this speed, because there is almost no momentum
           left to falsify. */
        const cs = Math.cos(swing);
        const sn = Math.sin(swing);
        const vx = vel.x;
        const vz = vel.z;
        vel.x = vx * cs + vz * sn;
        vel.z = -vx * sn + vz * cs;
      }
    }

    /* AND THE BOARD DOES NOT HOLD A LINE IN DEEP SNOW.

       This is the term that finally contains the boundary mountains, and it
       took three attempts to find because the first two were answers to the
       wrong question. Refusing the climb and taking the edge away both stop a
       rider *gaining* height, and neither stops the thing that was actually
       happening: a board held on a straight line along the bank keeps its
       altitude while the run underneath it descends nearly a third of a metre
       for every metre of z. Six seconds of that is sixty metres up the wall,
       and not one centimetre of it was climbed.

       What is missing from that picture is that the board is a metre and a
       half of stiff plank sitting *in* the snow rather than on it. Pointed
       across the fall line it has a metre of buried edge on the uphill side
       and nothing under the downhill one; it does not hold, it pivots — which
       is the first thing anybody learns the hard way about traversing deep
       snow. So the yaw is eased towards the local fall line at a rate set by
       how deep the board is, before the skid clamp below arbitrates between
       that and the direction of travel, and the ordinary carve then brings
       the velocity round behind it. On the containment wall the fall line
       points home, so this is a rider being turned downhill by the snow
       rather than a rider being pushed anywhere by the game.

       Nothing here touches the quarterpipe: `offPiste` is zero everywhere
       inside the lip, so a wall ride is still steered by the player alone. */
    if (this.offPiste > 0 && speed > 1) {
      // A perfectly level patch has no fall line to be turned towards.
      if (Math.hypot(n.x, n.z) > 1e-4) {
        const fallYaw = Math.atan2(n.x, -n.z)
          + (this.switchStance ? Math.PI : 0);
        this.yaw += wrapPi(fallYaw - this.yaw)
          * (1 - Math.exp(-RIDER.wallPivot * this.offPiste * dt));
      }
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

       Sixty degrees is about as far across their travel as anyone can hold a
       board and still be riding it; past that the excess is taken back
       immediately rather than smoothly, because there is no physical process
       that would let it persist. A brake gets almost eighty-two degrees —
       enough to throw a wall of snow and stop — but not enough to cross over
       and silently change which end of the board is leading. */
    /* …and a press is exactly the thing that rule is describing the absence
       of. Sixty degrees is how far a board with both contact points buried can
       be held off its own travel; a board standing on its nose has no tail in
       the snow to hold anything, which is why a butter works at all. So the
       clamp opens with the pressure rather than being suspended by it, and a
       half-hearted press still cannot spin.

       Passing ninety degrees is not a wider skid, it is a change of stance:
       the end of the board that was leading is now trailing, and from there
       the rider is riding switch. Flipping the reference at that crossing is
       also what makes the clamp hysteretic — the error jumps from just over a
       right angle to just under one and cannot flap. */
    // The same ground-speed gate as the brake pivot above, and for the same
    // reason: the skid clamp must not measure stance against a bearing that
    // does not exist.
    if (Math.hypot(vel.x, vel.z) > 0.6) {
      const travelYaw = Math.atan2(vel.x, -vel.z);
      let stanceYaw = travelYaw + (this.switchStance ? Math.PI : 0);
      let off = wrapPi(this.yaw - stanceYaw);
      if (this.press > 0.02 && Math.abs(off) > Math.PI / 2) {
        this.switchStance = !this.switchStance;
        stanceYaw = travelYaw + (this.switchStance ? Math.PI : 0);
        off = wrapPi(this.yaw - stanceYaw);
      }
      const limit = this.press > 0.02
        ? RIDER.maxSkid + (RIDER.pressSkid - RIDER.maxSkid) * this.press
        : brakeActive ? RIDER.brakeSkid : RIDER.maxSkid;
      /* Bounded correction rather than a hard subtract. Steering grows the
         excess by less than `skidRecover·dt` a step, so in continuous play
         this binds identically — but when the LIMIT itself drops in one
         input frame (a butter released, a brake let go) the board now swings
         back over a few frames instead of teleporting to legal. */
      const maxCorr = RIDER.skidRecover * dt;
      if (off > limit) this.yaw -= Math.min(off - limit, maxCorr);
      else if (off < -limit) this.yaw -= Math.max(off + limit, -maxCorr);
    }

    // A carve can cross almost the entire hill, but it cannot become a U-turn.
    // Killing the stored lip rate when the limit catches also prevents the
    // invisible excess rotation reappearing on the next jump.
    /* A press opens this one too, and it is safe to open because of what it
       limits. This rule is about the *board*: it stops ordinary steering from
       pointing the rider back up the mountain. What keeps the run going
       downhill is `limitCourseVelocity` below, and that is untouched — so
       during a butter the board may swing past the course while the momentum
       carries straight on, which is exactly the trick and nothing else. */
    const courseLimit = this.press > 0.02
      ? RIDER.courseLimit + (RIDER.pressSkid - RIDER.courseLimit) * this.press
      : brakeActive ? RIDER.brakeCourseLimit : RIDER.courseLimit;
    if (this.limitCourseYaw(n, courseLimit, dt)) this.spinVel = 0;

    /* What the press actually carried round, booked once and here.
       `stepYaw` is from before any of the rotation rules ran and this is
       after all of them, so what is counted is the rotation that survived —
       a butter cannot be paid for a spin the skid clamp took straight back
       off it, and it cannot be paid twice for the same radians either. */
    if (this.press > 0.02) this.pressSpin += wrapPi(this.yaw - stepYaw);

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

    // Redirecting momentum costs a little; failing to costs a lot. These are
    // losses from the magnitude of forward speed, not pushes towards the
    // board's tail: switch riding has negative vFwd, so subtracting them
    // directly would accelerate it.
    /* THE ONE THING A PRESS HAS TO BE PROTECTED FROM, which is this model's
       own idea of what a sideways board means.

       `vFwd` and `vLat` are the velocity written in the board's frame, so the
       moment the board pivots away from its travel the whole of the momentum
       is booked as lateral — and lateral is what the scrub and the damping
       below exist to destroy, because everywhere else in this game a board
       across its own travel is a wash-out or a speed check and destroying it
       is the entire point. Measured: a butter held for a second and a bit
       took ninety-four km/h down to nine, which is not a trick, it is a wall.

       A press is the one case where that reading is wrong. The board has
       pivoted but it has not dug in — one end is out of the snow, the base
       is still flat on it, and the rider is still going the way they were
       going. So both terms are scaled out with the pressure. What is left is
       the plough below, which is the honest cost and is a fifth of the size. */
    const pressGlide = 1 - 0.86 * this.press;
    let forwardLoss = Math.abs(held) * RIDER.carveDrag
      + this.slide * RIDER.slideScrub * pressGlide * dt;
    /* And cutting the trench is not free either. A carved edge is slicing
       through snow rather than gliding over it, and the further it is rolled
       over the more of it is buried — which is why a run held on a hard edge
       the whole way down a pitch arrives slower than one that let the board
       run flat between turns. That trade is most of what makes a line a
       decision rather than a shape. */
    forwardLoss += RIDER.edgeDrag * sinEdge * this.carveLoad * dt;

    // …and a board standing on one end of itself is ploughing with that end.
    // A butter is a slow trick everywhere it has ever been done, and this is
    // the whole of why: there is nothing gliding.
    forwardLoss += RIDER.pressDrag * this.press * dt;

    /* And climbing costs more than gravity alone charges for.

       g·sin θ is the whole of the real physics and, on a hill this shallow,
       it is not very much — five or six m/s² on the average pitch. What it
       misses is that a board driven up a slope is also being driven *into*
       it, and an edge loaded like that in soft snow scrubs. This is that
       term, and it is the difference between a quarterpipe wall you have to
       commit speed to and a free way to change lanes. */
    if (this.climbRate > 0 && speed > 1) {
      forwardLoss += RIDER.climbScrub * clamp(this.climbRate / speed, 0, 1) * dt;
    }
    /* …and out past the lip there is no piste under the board at all. Deep
       unconsolidated snow does not scrub a board driven up it, it swallows
       it: the base ploughs instead of gliding. Charged against the climb for
       the reason given beside `RIDER.wallDrag` — a flat term big enough to
       stop a fast rider also strands a slow one. */
    if (this.offPiste > 0 && this.climbRate > 0 && speed > 1) {
      forwardLoss += RIDER.wallDrag * this.offPiste * this.offPiste
        * clamp(this.climbRate / speed, 0, 1) * dt;
    }
    const forwardSign = Math.sign(vFwd) || (this.switchStance ? -1 : 1);
    vFwd = forwardSign * Math.max(0, Math.abs(vFwd) - forwardLoss);

    // A deliberate braking sideslip remains broad and controllable; an
    // accidental wash catches its edge and aligns much faster. Kinetic base
    // friction below supplies the rest of the stop.
    const slideDamping = (2.6
      + (RIDER.brakeSlideDamping - 2.6) * braking) * pressGlide;
    vLat *= Math.exp(-slideDamping * dt);

    // Pressure progressively moves from a waxed base to an edged speed check.
    const mu = RIDER.friction
      + (RIDER.brakeFriction - RIDER.friction) * braking;
    const matDrag = surf.groomed * 1.0 + surf.powder * 1.15 + surf.ice * 0.72 + surf.rock * 1.45;
    const dec = mu * (this.world.surfaceDrag ?? 1) * matDrag
      * RIDER.gravity * Math.max(0.2, n.y);
    // The initial tail kick is already cutting snow before the board has
    // reached full transverse velocity; afterwards real vLat dominates this.
    this.slide += speed * 0.16 * braking;

    vel.copy(h).multiplyScalar(vFwd).addScaledVector(r, vLat);

    // Kinetic friction, then aerodynamic drag. A powered tuck bypasses the
    // latter entirely; its speed floor is applied after the board has been
    // brought back into a physically valid direction below.
    const sp = vel.length();
    if (sp > 1e-4) vel.multiplyScalar(Math.max(0, sp - dec * dt) / sp);
    if (!this.tucking) {
      const over = Math.max(0, sp - RIDER.dragKnee);
      const drag = RIDER.drag * (1 + over * 0.35);
      // Stable integration of dv/dt = -drag·v². Unlike the former Euler
      // factor, this cannot turn negative and erase all momentum in one frame
      // when W is released after an extreme-speed run.
      vel.multiplyScalar(1 / (1 + drag * sp * dt));
    }

    /* One impulse per planted rear-foot stroke.

       The phase is simulation state rather than an animation clock: the
       powder puff, the boot plant and the speed gain therefore happen on the
       same fixed 120 Hz step. The direction blends the board's legal leading
       end with the generated course, so skating can free a stopped traverse
       without ever pushing the rider uphill or tail-first. */
    if (this.pushing) {
      const before = this.pushPhase;
      const advanced = before + RIDER.pushCadence * dt;
      const wrapped = advanced >= 1;
      this.pushPhase = advanced - Math.floor(advanced);

      if (before < RIDER.pushPlant && advanced >= RIDER.pushPlant) {
        const flow = this.courseFrame(n);
        const stroke = this._g.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        stroke.addScaledVector(n, -stroke.dot(n)).normalize();
        if (this.switchStance) stroke.multiplyScalar(-1);
        stroke.multiplyScalar(0.65).add(flow).normalize();
        vel.addScaledVector(stroke, RIDER.pushImpulse);
        this.pushStroke += 1;
        this.emit('push', RIDER.pushImpulse, this.pushStroke);
      }

      if (wrapped && finishPush) {
        this.pushing = false;
        this.pushPhase = 0;
      }
    }

    // Gravity, a collision or a severe wash-out may have arrived from outside
    // the board frame. Keep those exceptional vectors in the forward half of
    // the generated course as well.
    this.limitCourseVelocity(vel, n, courseLimit);

    // The two forward constraints above still allow opposite traverses: both
    // can be down-course while one is tail-first relative to the board. Remove
    // only that impossible component. A mismatched near-stop becomes a clean
    // sideways skid or a stop, never a brief backwards ride.
    const boardTravel = this._p.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    boardTravel.addScaledVector(n, -boardTravel.dot(n)).normalize();
    if (this.switchStance) boardTravel.multiplyScalar(-1);
    const tailFirst = vel.dot(boardTravel);
    if (tailFirst < 0) vel.addScaledVector(boardTravel, -tailFirst);

    /* Guarantee continuous acceleration for every grounded step W is held.

       Applying this after course and stance correction matters at very high
       speed: it preserves the direction produced by the snow instead of
       letting a forward impulse slowly steer the rider. Scaling also keeps
       the rule exact through arbitrarily large finite speeds; there is no
       target, curve, or clamp for it to asymptotically approach. */
    if (poweredSpeed > 0) {
      const drivenSpeed = vel.length();
      if (drivenSpeed > 1e-5) {
        if (drivenSpeed < poweredSpeed) vel.multiplyScalar(poweredSpeed / drivenSpeed);
      } else {
        vel.copy(boardTravel).multiplyScalar(poweredSpeed);
      }
    }

    /* THE ONE THING THE BOUNDARY MOUNTAINS ARE NOT ALLOWED TO PERMIT.

       Everything above is a cost, and full flow carries enough speed to pay
       any finite amount tuned for ordinary riding. This is the invariant, and it
       has to live *after* the powered floor for exactly that reason — the
       floor is the last thing that writes a speed, so anything hoping to
       bound the climb has to come after it.

       What it removes is only the component of travel pointing up the
       fall line, and only in proportion to how deep into the unpisted snow
       the board is. Downhill motion, the traverse, a slide along the bank —
       all untouched. `t` is the steepest-ascent direction in the surface's
       own tangent plane, which is world up with the surface normal projected
       out of it, so the scrub stays on the snow rather than fighting the
       ground contact. On the run itself `offPiste` is zero and none of this
       executes. */
    if (this.offPiste > 0) {
      const ny = n.y;
      let tx = -n.x * ny;
      let ty = 1 - ny * ny;
      let tz = -n.z * ny;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-4) {
        tx /= tl; ty /= tl; tz /= tl;
        /* The sluff first: the snow the board is ploughing collapses and
           runs down the fall line, and the board goes with it. Depth-squared,
           so the transition at the lip is untouched and the deepest snow is
           where the whole of it arrives. */
        const depth = this.offPiste * this.offPiste;
        const sluff = RIDER.wallSluff * depth * dt;
        vel.x -= tx * sluff;
        vel.y -= ty * sluff;
        vel.z -= tz * sluff;

        const up = vel.x * tx + vel.y * ty + vel.z * tz;
        if (up > 0) {
          /* The share of the climb that survives a step. At the lip it is
             nearly all of it, so the transition still rides exactly as it
             did; at full depth it is none, which is the invariant — deep
             snow does not merely slow a climb, it refuses to support one.
             A carve pointed at the wall therefore re-creates the uphill
             component every step and has it taken away again every step,
             which is what ploughing looks like from inside. */
          const hold = Math.exp(-RIDER.wallGrab * dt)
            * (1 - this.offPiste * this.offPiste);
          const k = 1 - hold;
          vel.x -= tx * up * k;
          vel.y -= ty * up * k;
          vel.z -= tz * up * k;
        }
      }
    }

    // Charging an ollie loads the legs; releasing it unloads them
    if (input.jump) {
      this.charging = true;
      this.charge = Math.min(1, this.charge + dt / RIDER.chargeTime);
      this.compressionVel += 5.5 * dt * 60 * 0.016;
    }

    /* A low-speed rider who has already committed to the final approach of a
       lip must not be parked there by the uphill gravity and snow scrub.
       Preserve only the speed they carried into this step — never add speed —
       until the support ends. The resulting weak hop is still weak; it just
       happens instead of becoming a permanent edge trap. */
    const lipSpeed = vel.length();
    if (this._contact.edgeAhead && enteringSpeed < RIDER.lipCommitSpeed
      && lipSpeed > 1e-5 && lipSpeed < enteringSpeed) {
      vel.multiplyScalar(enteringSpeed / lipSpeed);
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
    // Ground velocity was rebuilt from the local contact tangent above, so
    // its vertical component is the velocity that will actually be released.
    // The predictor is deliberately more conservative: a trailing directional
    // chord cannot peek over the discontinuous lip or let a centred normal's
    // forward half make a convex ramp look steeper than it has yet become.
    const surfaceVy = vel.y;
    const horizontalSpeed = Math.hypot(vel.x, vel.z);
    let predictorVy = surfaceVy;
    if (horizontalSpeed > 0.25) {
      const fx = vel.x / horizontalSpeed;
      const fz = vel.z / horizontalSpeed;
      const here = this.world.height(pos.x, pos.z);
      const behind = this.world.height(
        pos.x - fx * CONTACT_EPS, pos.z - fz * CONTACT_EPS,
      );
      predictorVy = ((here - behind) / CONTACT_EPS) * horizontalSpeed;
    }

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

       Sampling the integration step as well as the longer horizon fixes it.
       The rest of the sweep is spaced in metres, not in four increasingly
       long time slices, so a fast rider cannot step over a patch of support
       between samples. While any point on the near path still stands above
       the ballistic arc, the hill blocks release. An unmarked natural roller
       must then remain clear for part of a board length; a detected kicker or
       cliff edge already has that proof and releases directly. */
    const HZ = 0.09;
    let clearance = -Infinity;
    let blocked = false;
    let clearRun = 0;
    let longestClearRun = 0;
    const startT = Math.min(dt, HZ);
    const sweepLength = horizontalSpeed * Math.max(0, HZ - startT);
    const segments = Math.min(
      RIDER.launchSampleMax,
      Math.max(3, Math.ceil(sweepLength / RIDER.launchSampleSpacing)),
    );
    let previousDistance = horizontalSpeed * startT;
    for (let k = 0; k <= segments; k++) {
      const t = startT + (HZ - startT) * (k / segments);
      const distance = horizontalSpeed * t;
      const ground = this.world.height(pos.x + vel.x * t, pos.z + vel.z * t);
      const ballistic = pos.y + predictorVy * t - 0.5 * RIDER.gravity * t * t;
      const gap = ballistic - ground;
      if (gap > clearance) clearance = gap;
      if (gap < -RIDER.launchObstruction) blocked = true;
      if (gap > RIDER.launchGap) {
        if (k > 0) clearRun += distance - previousDistance;
        if (clearRun > longestClearRun) longestClearRun = clearRun;
      } else {
        clearRun = 0;
      }
      previousDistance = distance;
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
      const held = this.charge;
      pop = RIDER.popMin + (RIDER.popMax - RIDER.popMin) * held;
      if (!blocked && clearance > -0.25) {
        pop *= RIDER.lipBonus;
        this.lipPop = true;
      } else if (this.bend > RIDER.pumpFrom) {
        /* …or it is a pump, and this is the same extension doing the other
           thing legs can do with it.

           The condition is the whole idea. The branch above is a lip: the
           ground is on the point of letting go, there is nothing left to push
           against, and everything the legs have goes into height. Here the
           ground is bending the other way — pressing the board into the snow —
           and an extension against that load is work done along the direction
           of travel, which is speed. A rider crossing a compression is not
           jumping out of it; they are standing up through it and coming out
           the far side faster, and that is most of what riding terrain is.

           The pop is spent rather than added to, so a player cannot have both.
           Timing the release to the ground is the skill, and the read-out for
           whether they got it right is the speed itself. */
        const load = clamp(
          (this.bend - RIDER.pumpFrom) / Math.max(1e-3, RIDER.bendMax - RIDER.pumpFrom),
          0, 1,
        );
        const drive = RIDER.pumpSpeed * held * load;
        const flat = Math.hypot(vel.x, vel.z);
        if (flat > 1e-3 && drive > 0.05) {
          vel.x += (vel.x / flat) * drive;
          vel.z += (vel.z / flat) * drive;
          this.emit('pump', drive);
        }
        pop = 0;
      }
      this.charging = false;
      this.charge = 0;
      this.compressionVel = -14;
    }

    const requiredSupportLoss = this._contact.edgeAhead
      ? 0
      : Math.min(
        RIDER.launchSupportLength,
        sweepLength * RIDER.launchSupportShare,
      );
    const launching = !blocked && clearance > RIDER.launchGap
      && longestClearRun >= requiredSupportLoss && this.grounded;

    /* A confirmed release uses the chord entirely behind the board. This is
       the last piece of speed scaling: a centred normal straddling a smooth
       lip changes with the exact fixed-step crossing point and can make a
       slightly faster entry leave at a slightly lower angle. The trailing
       tangent cannot look over the edge, so speed alone scales every launch
       component. An ollie that is not also a natural release uses the exact
       support normal for the same reason. */
    const launchNormal = launching
      ? trailingNormalFrom(
        this.world.height, pos.x, pos.z, vel, this._launchN,
      )
      : support;
    let moveX = vel.x;
    let moveY = surfaceVy;
    let moveZ = vel.z;
    if (launching) {
      const launchSpeed = vel.length();
      const intoLaunch = vel.dot(launchNormal);
      const tx = vel.x - launchNormal.x * intoLaunch;
      const ty = vel.y - launchNormal.y * intoLaunch;
      const tz = vel.z - launchNormal.z * intoLaunch;
      const tangentSpeed = Math.hypot(tx, ty, tz);
      if (launchSpeed > 1e-5 && tangentSpeed > 1e-5) {
        const scale = launchSpeed / tangentSpeed;
        moveX = tx * scale;
        moveY = ty * scale;
        moveZ = tz * scale;
      }
    }
    pos.x += moveX * dt;
    pos.z += moveZ * dt;

    if (launching || pop > 0) {
      // This step carried the board along the ramp tangent. Continue that
      // tangent through the lip instead of moving x/z while leaving y behind;
      // the first airborne state is then already separated from the ramp.
      pos.y += moveY * dt;
      // Natural suspension movement must not invent speed in an automatic
      // ramp launch. It can reinforce an ollie the player actually released.
      const unweight = pop > 0
        ? Math.max(0, -this.compressionVel) * 0.55
        : 0;
      this.takeOff(pop + unweight, launchNormal);
    } else {
      const gy = this.world.height(pos.x, pos.z);
      this.extension = 0;
      pos.y = gy;
      // This is the tangent's real vertical component, not a launch impulse.
      // Capping it would become an indirect total-speed cap on steep terrain
      // once the powered tuck reaches extreme velocity.
      vel.y = surfaceVy;
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
    /* The true balance angle, and how much of it is actually shown.

       atan(lateral / g) is what the body has to do to stay up, and at the
       limit of grip against this game's 22 m/s² gravity that is fifty
       degrees. It is correct and it reads as broken: a rider laid flat over
       the snow while the heading comes round at fifteen degrees a second
       looks like a man falling sideways down a hill that happens to also be
       turning, which is exactly the complaint — "he leans onto his side and
       carries on in the same direction".

       The reason is that a real carve at fifty degrees of inclination is a
       fast, tight arc, and this one cannot be, because the turn rate is
       capped by grip and the speeds here are arcade. So the lean is shown at
       a fraction of the truth: enough to say which way the weight has gone,
       not so much that the body is writing a cheque the path does not cash.

       Balance is measured against the *shown* angle rather than the true one,
       which is not a fudge — it is the only self-consistent choice. Measured
       against the true angle the body could never arrive, the mismatch would
       be permanent, and the rider would fall over halfway through every
       properly-executed carve. */
    const need = Math.atan2(carve, RIDER.gravity);
    const shown = Math.min(need, RIDER.lean);
    const target = -side * shown;

    /* …and how far the body is from where it needs to be, which is balance.

       Measured before the roll is advanced, so it is the gap the rider is
       actually standing in rather than the one they are about to close. The
       sign is kept because the two ways of losing it are different events —
       positive is the load arriving before the body and trying to throw them
       over the outside edge, negative is a body further in than the snow can
       hold up — even though for now they cost the same thing. */
    /* Smooth the error so a single terrain sample cannot flash the grip.

       Balance is feedback and traction, not a second invisible crash test.
       A normal edge change holds this filtered error open after the rendered
       body has already caught up; the old timer therefore put the rider down
       on a mathematically planar slope with zero sideways slide. Low balance
       still reduces `gripNow` on the next step, visibly washing the board out
       and scrubbing speed. Only readable events — impact, a bad landing or a
       true uphill stall — own the fall state. */
    // Direction matters here. Comparing magnitudes made a rider leaning hard
    // into the old turn look perfectly balanced during an edge change. The
    // signed target-to-body gap reaches twice the shown lean in that case, so
    // the balance readout and the available grip both reflect the transition.
    this.leanErr = approach(this.leanErr, target - this.roll, 5.5, dt);
    // At low speed about eight degrees of mismatch is enough to soften the
    // edge. Momentum widens only this transient tolerance: it stops a routine
    // fast edge change from deleting forty per cent of the grip, while the
    // sidecut and surface grip above still own the steady-state turn radius.
    const baseBalanceWindow = Math.min(RIDER.balanceWindow, RIDER.lean * 0.25);
    const balanceWindow = baseBalanceWindow
      * (1 + (RIDER.speedBalanceWindow - 1) * stable);
    /* Faded in over 3–5 m/s rather than switched at 4. The old ternary was a
       cliff: crossing 4 m/s with an open lean error snapped `balance` from 1
       to its true value in one step, and `balanceGrip` turned that into a
       forty-per-cent grip step mid-scrub — felt as a twitch in exactly the
       slow, deliberate manoeuvre least able to absorb one. */
    const balanceIn = clamp((speed - 3) / 2, 0, 1);
    this.balance = 1 - balanceIn
      * (1 - clamp(1 - Math.abs(this.leanErr) / balanceWindow, 0, 1));

    this.roll = approach(this.roll, target, RIDER.leanRate, dt);
  }

  /* Takeoff is a release, not an impulse invented by the ramp.

     Ground contact may have accumulated tiny normal components while gravity,
     carving and the height field were integrated. Remove those at the lip,
     then restore the exact speed on the surface tangent. The ramp therefore
     decides direction and momentum decides magnitude: doubling entry speed
     doubles both horizontal and vertical launch velocity.

     A deliberate ollie (or the legs unloading naturally) is the only extra
     impulse. It points between the board's outward normal and world-up so it
     clears both ordinary kickers and steep walls without rewriting the base
     tangent launch. */
  takeOff(pop, n) {
    const launchSpeed = this.vel.length();
    const tangent = this._p.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    const tangentSpeed = tangent.length();
    if (launchSpeed > 1e-5 && tangentSpeed > 1e-5) {
      this.vel.copy(tangent).multiplyScalar(launchSpeed / tangentSpeed);
    }

    const p = this._p.copy(n).add(this.UP).normalize();
    this.grounded = false;
    this.state = 'air';
    // The gradient the bend is differentiating is only meaningful across two
    // consecutive steps on the same surface. Every departure from the snow
    // breaks that chain, and a stale one comes back as a curvature spike the
    // width of a lip.
    this._bendReady = false;
    if (pop > 0) this.vel.addScaledVector(p, pop);
    // Scoring and telemetry read the momentum the ramp received, not the
    // optional leg impulse added afterwards.
    this.takeoffSpeed = launchSpeed;
    this.airTime = 0;
    this.spinAccum = 0;
    this.flipAccum = 0;
    this.flip = 0;
    this.grabTime = 0;
    this.grabbing = false;
    // Preserve the real yaw rate the edge had at the lip. Air control can add
    // to it or bleed it away, but takeoff itself should not erase momentum.
    this.flipVel = 0;
    this.charging = false;
    this.charge = 0;
    this.emit('launch', this.vel.y);
    if (this.lipPop && pop > 0) {
      this.emit('perfectPop');
    }
    /* A press that was still on the snow the moment the snow left is a press
       that finished, so it is judged here rather than being carried into the
       air where it would be rolled into the jump's own rotation.

       AFTER THE LAUNCH, and the order is load-bearing rather than incidental.
       Leaving the ground retires the last jump's verdict — the launch handler
       clears the banner so the new air has the read-out to itself — so a
       butter judged before that put its callout up and had it wiped in the
       same physics step. The points were paid and the player was never told
       what for, which on the one trick that ends by accident is exactly the
       moment they most need telling. */
    this.releasePress();
  }

  /* The press, closed out. Called wherever the board can stop being on the
     snow under a rider's feet — a lip, a tree — so that a butter is always
     judged exactly once and nothing can carry its accumulated rotation into
     whatever happens next. */
  releasePress() {
    if (this.pressTime > 0) this.emit('butter', Math.abs(this.pressSpin), this.pressTime);
    this.press = 0;
    this.pressTime = 0;
    this.pressSpin = 0;
  }

  /* --- in the air ---------------------------------------------------- */

  airStep(dt, input) {
    const { pos, vel } = this;
    this.airTime += dt;
    this.pushing = false;
    this.brake = approach(this.brake, 0, RIDER.brakeRelease, dt);
    this.tucking = !!input.tuck && !input.brake && this.brake < 0.05;
    this.slide = 0;
    this.carveLoad = 0;
    this.climbRate = 0;
    // Air is air, wherever it is over. Deep snow only exists under a board.
    this.offPiste = 0;
    // Nothing is pressing on the board in the air, so the legs are allowed to
    // find their own length rather than holding the last compression they saw
    this.bend = approach(this.bend, 0, 9, dt);

    // Gravity is constant through the complete arc. Aerodynamic drag only
    // trims horizontal travel here, so it cannot create an apex float or
    // weaken the downward acceleration the player is judging.
    const startVy = vel.y;
    const poweredAirSpeed = this.tucking
      ? vel.length() + RIDER.tuckAcceleration * dt
      : 0;
    vel.y -= RIDER.gravity * dt;
    if (!this.tucking) {
      const airDrag = 1 / (1 + RIDER.drag * 0.45 * vel.length() * dt);
      vel.x *= airDrag;
      vel.z *= airDrag;
    }

    // Spin. It winds up rather than snapping on, so a 180 and a 900 are
    // different amounts of commitment rather than different key presses.
    const wantSpin = input.turn * RIDER.spinRate;
    this.spinVel = approach(this.spinVel, wantSpin, RIDER.spinRamp, dt);
    this.yaw += this.spinVel * dt;
    this.spinAccum += this.spinVel * dt;

    /* Flip, on its own key, so it can be corked into a spin — and it goes
       whichever way the weight is going.

       E on its own throws the shoulders back and the board over the head,
       which is a backflip and is what E has always done. Held with S it goes
       the other way: S is the key that sits the weight back everywhere else
       in this game, and letting go of that while the body is already folded
       is precisely how a front flip starts. One key, two rotations, and the
       modifier means the same thing it means on the snow. */
    const wantFlip = input.trickFlip
      ? (input.brake ? RIDER.flipRate : -RIDER.flipRate)
      : 0;
    this.flipVel = approach(this.flipVel, wantFlip, RIDER.spinRamp * 1.4, dt);
    this.flip += this.flipVel * dt;
    this.flipAccum += this.flipVel * dt;

    /* Grab: the only trick that is worth more the longer you hold it, the
       only one that asks you to let go before the snow arrives, and now the
       only one with more than one shape.

       Which shape is decided once, at the moment the hand leaves the knee,
       and then held — a grab is one reach and not a menu to scroll through in
       the air. W is already forward and S is already back, so the body
       position the rider is holding for every other reason is the body
       position that picks it: folded over the nose, sat back into a method,
       or neither, which is a hand dropped straight onto the toe edge. */
    this.grabbing = !!input.trickGrab;
    if (this.grabbing) {
      if (this.grabTime <= 0) {
        this.grabKind = input.tuck ? GRAB_NOSE : input.brake ? GRAB_METHOD : GRAB_INDY;
      }
      this.grabTime += dt;
    }
    this.grab = approach(this.grab, this.grabbing ? 1 : 0, 11, dt);

    // A little drift, for picking a landing line. It is relative to the line
    // of travel, not to the spinning board, so D keeps moving screen-right
    // during a 360 and behaves identically in regular and switch stance.
    const steer = input.turn * RIDER.airSteer;
    const horizontal = Math.hypot(vel.x, vel.z);
    if (horizontal > 0.5) {
      const rightX = -vel.z / horizontal;
      const rightZ = vel.x / horizontal;
      vel.x += rightX * steer * dt;
      vel.z += rightZ * steer * dt;
    } else {
      const travelYaw = this.yaw - (this.switchStance ? Math.PI : 0);
      vel.x += Math.cos(travelYaw) * steer * dt;
      vel.z += Math.sin(travelYaw) * steer * dt;
    }

    /* And the weather's own hand. With no edge in the snow an airborne board
       is a sail: the storm's surface wind leans on the flight, calm days
       imperceptibly, a blizzard by enough to move a long air's landing by a
       board length or two. The ground never takes this — grip owns it. */
    const windX = this.world.windX || 0;
    const windZ = this.world.windZ || 0;
    if (windX !== 0 || windZ !== 0) {
      vel.x += windX * RIDER.windAir * dt;
      vel.z += windZ * RIDER.windAir * dt;
    }

    // Keep the same powered W drive through jumps. Raise only the horizontal
    // component by enough to reach the total-speed floor; vertical velocity
    // remains the ballistic value gravity produced, so the jump arc and
    // landing timing are not falsified even while total speed keeps climbing.
    if (poweredAirSpeed > 0) {
      const horizontal = Math.hypot(vel.x, vel.z);
      const poweredHorizontal = Math.sqrt(Math.max(0,
        poweredAirSpeed * poweredAirSpeed - vel.y * vel.y));
      if (horizontal > 1e-5) {
        if (horizontal < poweredHorizontal) {
          const scale = poweredHorizontal / horizontal;
          vel.x *= scale;
          vel.z *= scale;
        }
      } else {
        const travelYaw = this.yaw - (this.switchStance ? Math.PI : 0);
        vel.x = Math.sin(travelYaw) * poweredHorizontal;
        vel.z = -Math.cos(travelYaw) * poweredHorizontal;
      }
    }

    pos.x += vel.x * dt;
    // Trapezoidal integration is exact for constant acceleration, so the
    // simulated centre of mass stays on y = y0 + vy0·t - ½g·t² instead of
    // accumulating the semi-implicit Euler error over a long jump.
    pos.y += (startVy + vel.y) * 0.5 * dt;
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

    if (pos.y <= gy) {
      // The launch look-ahead deliberately commits just before a lip. Without
      // a tiny contact window the following air tick sees the last centimetres
      // of that same ramp above the board and calls it a landing. Only accept
      // snow that the rider is actually moving into; a separating contact is
      // positional overlap, not an impact.
      const contact = ridingNormalFrom(
        this.world.height, pos.x, pos.z, vel, this._n,
      );
      const approaching = vel.dot(contact) < -0.02;
      // …or buried, whichever comes first. A rising contact is normally
      // refused so a pop off an uphill transition is not taken back — but
      // ground that climbs faster than the rider does turns that refusal
      // into a rider inside the mountain, one step at a time. See
      // `RIDER.buryDepth`.
      const descending = vel.y <= 0 || gy - pos.y > RIDER.buryDepth;
      if (this.airTime >= RIDER.launchContactGrace && descending && approaching) {
        pos.y = gy;
        this.land();
      } else {
        // Separating or rising contact is not a landing. Keep the ballistic
        // position untouched; snapping it above the snow injected height into
        // every high-speed takeoff.
        this.extension = Math.max(0, pos.y - gy);
      }
    } else {
      this.extension = pos.y - gy;
    }
  }

  /* --- the moment it matters ----------------------------------------- */

  land() {
    const { vel } = this;
    // A touchdown at the centimetre before a lip must use the ramp face, not
    // a centred sample that includes the vertical drop behind it.
    const n = this._n;
    ridingNormalFrom(this.world.height, this.pos.x, this.pos.z, vel, n);
    this.normal.copy(n);
    this._handlingReady = true;
    this._bendReady = false;
    const impact = Math.max(0, -vel.dot(n));

    // Judge the direction that will actually leave the landing. Classifying
    // the airborne vector and projecting it afterwards could turn a perfectly
    // ordinary touchdown around on a steep face while leaving the stance flag
    // unchanged.
    const landedVel = this._p.copy(vel).addScaledVector(n, -vel.dot(n));
    this.limitCourseVelocity(landedVel, n, RIDER.courseLimit);
    const travelYaw = landedVel.lengthSq() > 1e-5
      ? Math.atan2(landedVel.x, -landedVel.z)
      : Math.atan2(this._flow.x, -this._flow.z);
    const off = wrapPi(this.yaw - travelYaw);
    const forward = Math.abs(off);
    const backward = Math.abs(Math.abs(off) - Math.PI);
    const spinErr = Math.min(forward, backward);
    const isSwitch = backward < forward;
    const flipErr = Math.abs(wrapPi(this.flip));

    // A short hop is not a trick, but it is still a physical landing. Trick
    // eligibility gates only the rotation tests; impact severity always
    // applies, so a hard, short drop cannot be rewritten as CLEAN.
    const judged = this.airTime >= RIDER.minJudgedAir
      || Math.abs(this.spinAccum) > 0.8 || Math.abs(this.flipAccum) > 0.8;
    const w = RIDER.landWindow;
    const p = RIDER.landPitchWindow;
    let verdict = CLEAN;
    /* A sideways board costs the landing, not the whole run.

       Because the nearest regular/switch stance is used above, `spinErr` can
       only ever reach ninety degrees. The old bail threshold began at eighty-
       two, leaving an arbitrary eight-degree sliver where steering through an
       unnoticed natural hop caused a wipeout while a nearly identical landing
       was merely sketchy. Keep yaw mismatch in the sketchy branch below; hard
       impact and a rider arriving upside-down remain genuine bails. */
    if (impact > RIDER.hardImpact
      || (judged && flipErr > p * 1.6)) {
      verdict = BAIL;
    } else if (impact > RIDER.softImpact * 1.9
      || (judged && (spinErr > w || flipErr > p))) {
      verdict = SKETCHY;
    }

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
      grabKind: this.grabKind,
      switchStance: isSwitch,
      impact,
      judged,
      lipPop: this.lipPop,
      takeoffSpeed: this.takeoffSpeed,
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
        /* The physics squares the board in one write — judging and the next
           carve both need the aligned stance now — but the few degrees the
           landing assist did not close are handed to `yawGlide`, which the
           renderer subtracts and drains over a tenth of a second. The same
           landing, minus the one-frame twitch. */
        const snapped = isSwitch ? travelYaw + Math.PI : travelYaw;
        this.yawGlide = clamp(wrapPi(this.yaw - snapped), -1.1, 1.1);
        this.yaw = snapped;
        this.switchStance = isSwitch;
      }
      // A sketchy landing wobbles and costs speed; a clean one costs nothing
      // The snow takes the normal component; the rider keeps the tangential
      // run whose direction was used to classify the landing above.
      vel.copy(landedVel);
      if (verdict === SKETCHY) vel.multiplyScalar(0.86);
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
    this.pushing = false;
    this.grab = 0;
    this.grabbing = false;
    this.grabTime = 0;
    // A butter interrupted by a tree is not a butter. Clearing rather than
    // releasing is the difference between the trick ending and it having
    // happened, and going down is the one way it can end without having.
    this.press = 0;
    this.pressTime = 0;
    this.pressSpin = 0;
    this.extension = 0;
    this.bend = 0;
    this._bendReady = false;
    /* The flight that just ended is over, and its ledger goes with it. These
       three survived a fall untouched, and everything that reads "airborne"
       state read them as live: the HUD kept the last jump's trick name up
       for the whole tumble, the audio played rotation blips for spins from
       a minute ago, and the chase camera framed the wipeout as a soaring
       air because `airTime` still held the old flight's value. */
    this.airTime = 0;
    this.spinAccum = 0;
    this.flipAccum = 0;

    // What the body keeps, and what the collision turns into height. A rider
    // doing 40 m/s into a trunk leaves it doing 25 and climbing, which is
    // most of a second in the air before the hill even gets a say.
    this.vel.multiplyScalar(RIDER.fallLaunch);
    const lift = Math.max(into, this.vel.length() * 0.35) * RIDER.fallLift;
    this.vel.y += Math.min(15, lift);
    this.pos.y = Math.max(this.pos.y, this.world.height(this.pos.x, this.pos.z) + 0.05);
    this.compressionVel += 8;
    // Keep the impact that caused the fall attached to the event. The crash
    // mix, powder plume and camera response all need the same physical number
    // that launched the body; throwing it away here made every wipeout read
    // identically, from a walking-speed washout to a full-speed tree hit.
    this.emit('fall', cause, into);
  }

  /* A tumble is a body, not a timer. While it is off the ground it is
     ballistic; when it arrives it bounces, lower each time, and slides. The
     rider is allowed up once they have actually stopped — or once `fallMax`
     has run out, because a body that finds a hollow to oscillate in should
     not be able to hold the run hostage. */
  fallStep(dt) {
    const { pos, vel } = this;
    this.brake = approach(this.brake, 0, RIDER.brakeRelease, dt);

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
        /* Always reconcile the board and its travel before the model stands
           up. `fallMax` can expire while a fast body is still sliding, so a
           low-speed-only repair left exactly the hardest crashes resuming
           tail-first. Keep the nearest legal traverse and a bounded share of
           the remaining momentum, then rebuild it on the local surface. */
        const n = normalFrom(this.world.height, pos.x, pos.z, this._n);
        const restart = clamp(vel.length(), 6, 12);
        this.switchStance = false;
        this.limitCourseYaw(n, RIDER.recoveryCourseLimit, dt);
        const h = this._h.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        h.addScaledVector(n, -h.dot(n)).normalize();
        vel.copy(h).multiplyScalar(restart);
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
      this.limitCourseVelocity(vel, n, RIDER.courseLimit);
      if (Math.hypot(vel.x, vel.z) > 0.5) {
        const travelYaw = Math.atan2(vel.x, -vel.z);
        this.yaw += wrapPi(travelYaw - this.yaw) * (1 - Math.exp(-5 * dt));
        this.limitCourseYaw(n, RIDER.recoveryCourseLimit, dt);
      }
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      pos.y = this.world.height(pos.x, pos.z);
      this.slide = s * 0.5;

      if (this.fallTimer <= 0) {
        this.state = 'ride';
        this.tumble = 0;
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
    // One g of gravity, plus whatever the ground's curvature is adding or
    // taking away, plus the corner — and the vertical two combine before the
    // lateral one because that is the order they act in. A compression squats
    // the rider and lifts the camera's floor; a rollover stands them up and
    // goes light, which is the frame going quiet a moment before it lets go.
    const verticalG = Math.max(0, 1 + this.bend);
    const load = this.grounded && this.state !== 'fall'
      ? Math.hypot(verticalG, lateralG)
      : 0;
    this.gLoad = approach(this.gLoad, load, 9, dt);

    let target = load * RIDER.compressPerG * RIDER.gravity / 9.81;
    if (this.tucking) target = Math.max(target, RIDER.tuckCompress);
    if (this.brake > 0) target = Math.max(target, RIDER.brakeCompress * this.brake);
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
      this.vel.addScaledVector(push, Math.min(into, 1.5 + 2 * severity));
      this.compressionVel += 3;
      return 'brush';
    }
    // Glancing: spun off the line, and it costs a share of the speed that
    // went into the trunk rather than a flat percentage of everything
    this.vel.addScaledVector(push, Math.min(into, 3 + 9 * severity));
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
   number the score is paying for.

   THE OFF-AXIS NAMES are the part worth explaining, because they are the
   reason this function is no longer a list of clauses joined by plus signs.
   A spin is a rotation about the rider's vertical and a flip is a rotation
   about their horizontal, and a rider who does both at once has not done two
   tricks — they have done one trick about a tilted axis, which is much harder
   to see out of than either half and which the sport has always had its own
   names for. Written as "BACKSIDE 720 + BACKFLIP" the game was describing the
   inputs; written as "CORK 720" it is describing the trick.

   The mapping is the common one. A backward flip laid into a backside spin is
   a cork and into a frontside spin is a rodeo; a forward flip either way is a
   misty. Two flips make it a double. It is a simplification of a vocabulary
   that genuinely does distinguish more cases than this — but every case it
   does name, it names correctly, and a rider who knows the difference will
   recognise what they just did. */
export function trickName(s, verdict) {
  const parts = [];
  const steps = s.halfTurns * 180;
  const flips = s.flipTurns;
  const frontside = s.spin > 0;

  if (flips >= 1 && steps >= 360) {
    // Both axes: one trick about a tilted one.
    const base = s.flips > 0 ? 'MISTY' : frontside ? 'RODEO' : 'CORK';
    /* The sport has words for two and three and then stops having them, and
       this hill has no practical ceiling on airtime, so a long enough hang
       time genuinely reaches four. Past three it counts,
       because announcing a quadruple cork as a triple while paying for four
       is the label and the score disagreeing, which is the one thing this
       function exists to prevent. */
    const many = flips > 3 ? `${flips}× ` : flips > 2 ? 'TRIPLE ' : flips > 1 ? 'DOUBLE ' : '';
    parts.push(`${many}${base} ${steps}`);
  } else {
    if (steps >= 180) parts.push(`${frontside ? 'FRONTSIDE' : 'BACKSIDE'} ${steps}`);
    if (flips >= 1) {
      // `flips` counts whole revolutions; `s.flips` is the signed total, and
      // its sign is the one thing that says which way the world went round.
      const way = s.flips > 0 ? 'FRONTFLIP' : 'BACKFLIP';
      parts.push(flips > 1 ? `${flips}× ${way}` : way);
    }
  }

  // The grab is named rather than counted, and the tweak stop is where a
  // reach stops being a touch and becomes something being held.
  if (s.grabTime > RIDER.grabHold[0]) {
    const grab = RIDER.grabs[s.grabKind] || RIDER.grabs[0];
    parts.push(s.grabTime > RIDER.grabHold[1]
      ? `TWEAKED ${grab.name}` : grab.name);
  }

  if (!parts.length) {
    if (s.airTime > 1.25) parts.push('BIG AIR');
    else return null;
  }
  if (s.switchStance) parts.unshift('SWITCH');
  let name = parts.join(' + ');
  if (verdict === SKETCHY) name += ' (SKETCHY)';
  return name;
}

/* HOW MUCH OF A BUTTER ACTUALLY CAME ROUND, and it is a floor with a window
   rather than a rounding.

   An aerial rotation is rounded to the nearest half turn and that is honest,
   because the landing has already refused anything more than `landWindow` off
   a clean stance — the rounding is a statement about a rotation that has been
   checked. A press has no such check. It ends when the player lets go, at
   whatever angle they let go at, so rounding to the nearest paid a
   three-quarter turn as a full one: two hundred and seventy degrees came out
   as BUTTER 360, with the points and the combo to match, while the board was
   still visibly sideways.

   So it counts the half turns that arrived, and the same window a landing
   allows is added before the floor so that a rotation which has essentially
   got there still counts as having got there. Reading `landWindow` rather
   than choosing a second number is the point: the two paths now agree about
   what "completed" means by construction, and cannot drift apart. */
export function butterHalfTurns(spin) {
  return Math.floor((Math.abs(spin) + RIDER.landWindow) / Math.PI);
}

/* And what it is called, which is a name rather than a sentence for the same
   reason a cork is: the rotation and the press are one trick. It reads the
   same quantisation the score does, so the label and the payout can never
   disagree — the standing rule for every other trick in this file. */
export function butterName(spin) {
  return `BUTTER ${Math.max(1, butterHalfTurns(spin)) * 180}`;
}
