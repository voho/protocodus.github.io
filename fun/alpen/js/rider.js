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
     kicker's lip, the crest of a roller and the top of a bank all launch by
     the same rule, and all of them launch harder the faster you were going.

   • The legs are a spring. It compresses under load and extends when the
     load comes off, which drives the crouch, the camera height, and — if it
     happens to be extending as you leave the ground — a little extra pop.
     Pumping a roller works, and nobody had to write pumping.

   Falling over is the only failure, and it is temporary: the rider gets up,
   a little slower, and the run carries on. */

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

    this.events = {
      launch: [], land: [], fall: [], rise: [], carve: [], impact: [],
    };

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
    this.slide = 0;          // m/s of sideways wash, for spray and sound
    this.carveLoad = 0;      // 0..1, how hard the edge is working
    this.fallTimer = 0;
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
    // physics while the model still had them face-down, and stayed prone
    // until the next landing happened to reset the state.
    if (this.state === 'fall' || this.state === 'rise') return this.fallStep(dt);
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

    /* Steering, capped by what the edge can actually hold.

       At v metres per second, `grip` m/s² of sideways force bends the path
       at grip/v radians per second and no faster. Turning the board past
       that does not turn harder — it breaks traction, throws the rider
       sideways and scrubs off the speed that made the turn worth taking.
       Uncapped, this was unplayable: any firm input at speed washed out
       instantly and a full-lock turn took the rider from 110 km/h to a
       standstill in about a second.

       So the command is capped a shade past the limit. What falls out is
       the thing that makes the sport read: a fast line is a wide line, a
       carve is something you hold rather than something you flick, and the
       brake is the deliberate way to break the edge loose. */
    const tuckTurn = input.tuck ? RIDER.tuckTurn : 1;
    const carveRate = RIDER.grip / Math.max(6, speed);
    const cap = Math.min(RIDER.turn, carveRate * RIDER.overCarve)
      * (input.brake ? RIDER.brakePivot : 1) * tuckTurn;
    this.yaw += input.turn * cap * dt;

    // With no input the board settles back in line with where the rider is
    // actually travelling, so a nudge does not leave you sideways forever
    if (Math.abs(input.turn) < 0.05 && speed > 1) {
      const travelYaw = Math.atan2(vel.x, -vel.z);
      this.yaw += wrapPi(travelYaw - this.yaw) * (1 - Math.exp(-RIDER.selfCentre * dt));
    }

    // The edge: it holds up to `grip` m/s² sideways, and slides past it
    const hold = RIDER.grip * dt * (input.brake ? 0.45 : 1) * (input.tuck ? RIDER.tuckGrip : 1);
    const held = clamp(vLat, -hold, hold);
    vLat -= held;
    this.slide = Math.abs(vLat);
    this.lateral = vLat;   // signed, so the spray knows which way to fly
    this.carveLoad = speed > 1 ? clamp(Math.abs(held) / (hold + 1e-6), 0, 1) : 0;

    // Redirecting momentum costs a little; failing to costs a lot
    vFwd -= Math.abs(held) * RIDER.carveDrag;
    vFwd -= this.slide * RIDER.slideScrub * dt;
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
    // Drag is v², and the ceiling it sets is the game's only speed limit —
    // there is no clamp anywhere. Past `maxSpeed` it stiffens sharply, so a
    // freak landing off a big kicker can overshoot for a second and is
    // pulled straight back instead of running away with the run.
    const over = Math.max(0, sp - RIDER.maxSpeed);
    const drag = RIDER.drag * (input.tuck ? RIDER.tuckDrag : 1) * (1 + over * 0.35);
    vel.multiplyScalar(Math.max(0, 1 - drag * sp * dt));
    if (input.tuck && sp < RIDER.maxSpeed) vel.addScaledVector(h, RIDER.pump * dt);
    if (sp < RIDER.minSpeed) vel.addScaledVector(h, 3.5 * dt);

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
       actually matters — will I still be off the ground when it counts —
       and the chatter, whose next crest arrives inside the horizon, answers
       no by itself. */
    const h0 = this.world.height(pos.x, pos.z);
    const h1 = this.world.height(pos.x + vel.x * dt, pos.z + vel.z * dt);
    const surfaceVy = (h1 - h0) / dt;
    const HZ = 0.09;
    const ahead = this.world.height(pos.x + vel.x * HZ, pos.z + vel.z * HZ);
    const ballistic = pos.y + surfaceVy * HZ - 0.5 * RIDER.gravity * HZ * HZ;
    const clearance = ballistic - ahead;

    let pop = 0;
    if (this.charging && !input.jump) {
      pop = RIDER.popMin + (RIDER.popMax - RIDER.popMin) * this.charge;
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
      this.takeOff(surfaceVy + pop + unweight);
    } else {
      const gy = this.world.height(pos.x, pos.z);
      this.extension = 0;
      pos.y = gy;
      vel.y = clamp(surfaceVy, -RIDER.maxSpeed, RIDER.maxSpeed);
    }

    // Weight the body into the turn. It has mass, so it gets there late.
    const target = clamp(-input.turn, -1, 1) * RIDER.lean * (0.35 + 0.65 * ratio);
    this.roll = approach(this.roll, target, RIDER.leanRate, dt);
    if (this.slide > 1.5 || this.carveLoad > 0.35) this.emit('carve', this.slide, this.carveLoad);
  }

  takeOff(vy) {
    this.grounded = false;
    this.state = 'air';
    this.vel.y = vy;
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
    this.emit('launch', vy);
  }

  /* --- in the air ---------------------------------------------------- */

  airStep(dt, input) {
    const { pos, vel } = this;
    this.airTime += dt;
    this.tucking = false;
    this.slide = 0;
    this.carveLoad = 0;

    vel.y -= RIDER.gravity * dt;
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
    if (pos.y <= gy) {
      pos.y = gy;
      this.land();
    } else {
      this.extension = pos.y - gy;
    }
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
    // screen says and what the code did not do — held through touchdown it
    // was free points and a strictly dominant strategy. It costs a sketchy
    // landing rather than a fall, because nothing here should end a run.
    if (judged && this.grabbing) verdict = Math.max(verdict, SKETCHY);

    // Rotations are quantised to the *nearest* half turn, not the floor.
    // The landing window has already accepted anything inside ±53°, so a
    // clean 170 is a 180 and a clean 350° flip is a backflip; flooring
    // called the first one a zero and the second one nothing at all. The
    // label and the score both read these, so they can never disagree.
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
      this.fall();
    } else {
      // Snap the board straight — forward or switch, whichever was closer
      this.yaw = isSwitch ? travelYaw + Math.PI : travelYaw;
      this.switchStance = isSwitch;
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

  fall(cause = 'land') {
    if (this.state === 'fall') return;
    this.state = 'fall';
    this.grounded = true;
    this.fallTimer = RIDER.fallTime + RIDER.riseTime;
    this.tumble = 0;
    this.vel.multiplyScalar(RIDER.fallSpeed);
    this.compressionVel += 8;
    this.charge = 0;
    this.charging = false;
    this.grab = 0;
    this.emit('fall', cause);
  }

  fallStep(dt) {
    const { pos, vel } = this;
    this.fallTimer -= dt;
    this.tumble += dt * 9 * clamp(vel.length() / 12, 0.2, 1);

    // Still a body sliding down a hill: gravity on the tangent, and a lot
    // more friction than a board on its edge
    const n = normalFrom(this.world.height, pos.x, pos.z, this._n);
    this.normal.copy(n);
    vel.addScaledVector(n, -vel.dot(n));
    const g = this._g.set(0, -RIDER.gravity, 0);
    const gn = g.dot(n);
    vel.x += (g.x - n.x * gn) * dt;
    vel.y += (g.y - n.y * gn) * dt;
    vel.z += (g.z - n.z * gn) * dt;
    const sp = vel.length();
    if (sp > 1e-4) vel.multiplyScalar(Math.max(0, sp - 9 * dt) / sp);

    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    pos.y = this.world.height(pos.x, pos.z);
    this.slide = sp * 0.8;

    if (this.fallTimer <= RIDER.riseTime) {
      // Up on the board again, pointed downhill, with a moment of grace so
      // the same tree cannot take you twice
      if (this.state !== 'rise') {
        this.state = 'rise';
        // Velocity first, then the board to match it. Read the other way
        // round, a rider who had stopped took their heading from whatever
        // direction they were last sliding — sideways, or back up the hill —
        // and then got a downhill push underneath it, so the first thing
        // they did on standing up was skid the restart speed away.
        if (sp < 3) this.vel.set(0, 0, -6);
        this.yaw = Math.atan2(this.vel.x, -this.vel.z);
        this.grace = 1.3;
        this.emit('rise');
      }
      if (this.fallTimer <= 0) {
        this.state = 'ride';
        this.tumble = 0;
        this.switchStance = false;
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
    if (!this.grounded) target = -0.12 * Math.min(1, this.airTime * 3);

    this.compressionVel += (target - this.compression) * w * w * dt;
    this.compressionVel *= Math.exp(-2 * RIDER.springDamp * w * dt);
    this.compression += this.compressionVel * dt;
    this.compression = clamp(this.compression, -0.3, RIDER.compressMax);
  }

  /* --- what the world does to the rider -------------------------------- */

  /* A glancing blow spins the rider and costs speed; a square one puts them
     down. Shrubs do neither — they cost a bite of speed and a lot of powder,
     which is the correct punishment for a bush. */
  graze(nx, nz, severity) {
    const { vel } = this;
    const push = this._h.set(nx, 0, nz).normalize();
    vel.addScaledVector(push, 5 + 7 * severity);
    vel.multiplyScalar(1 - 0.3 * severity);
    this.compressionVel += 9 * severity;
    this.slide += 6 * severity;
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

