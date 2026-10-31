// Run with: node tests/riding-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { Rider, trickName, speedCeiling, CLEAN, SKETCHY, BAIL } from '../js/rider.js';
import { RIDER } from '../js/config.js';
import { createInput } from '../js/input.js';
import { createChaseCamera } from '../js/camera.js';

const dt = 1 / 120;
const TAU = Math.PI * 2;
const neutral = { turn: 0, tuck: false, brake: false, jump: false, trickGrab: false, trickFlip: false };
const flat = { height: () => 0, canStall: () => false };
const rider = (world = flat) => new Rider(THREE, world);
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} / ${b}`);

// A charged jump receives its configured impulse exactly, not another fixed
// impulse from the visual suspension reset. Taps retain a gentler launch.
for (const ticks of [1, 60]) {
  const r = rider();
  for (let i = 0; i < ticks; i++) r.step(dt, { ...neutral, jump: true });
  const expected = RIDER.popMin + (RIDER.popMax - RIDER.popMin) * r.charge;
  r.step(dt, neutral);
  assert.equal(r.state, 'air');
  close(r.vel.y, expected, 'charge determines pop');
}

// A held charge survives an automatic lip and can be released slightly late.
const late = rider();
late.charging = true;
late.charge = 0.6;
late.takeOff(0, late.UP);
let perfectPops = 0;
late.on('perfectPop', () => perfectPops++);
late.step(dt, neutral);
close(late.vel.y, (RIDER.popMin + (RIDER.popMax - RIDER.popMin) * 0.6)
  * RIDER.lipBonus - RIDER.gravity * dt, 'late pop impulse');
late.step(dt, { ...neutral, jump: true });
const beforeRepeat = late.vel.y;
late.step(dt, neutral);
close(late.vel.y, beforeRepeat - RIDER.gravity * dt, 'no double jump');
assert.equal(perfectPops, 1);

// Tucking preserves more momentum but cannot accelerate a rider in midair;
// vertical position remains the exact constant-gravity trajectory.
for (const tuck of [false, true]) {
  const r = rider();
  r.pos.y = 100;
  r.vel.set(0, 10, -20);
  r.state = 'air'; r.grounded = false;
  for (let i = 0; i < 60; i++) r.step(dt, { ...neutral, tuck });
  close(r.pos.y, 100 + 10 * 0.5 - 0.5 * RIDER.gravity * 0.25, 'ballistic position');
  close(r.vel.y, 10 - RIDER.gravity * 0.5, 'constant gravity');
  assert.ok(Math.abs(r.vel.z) < 20, 'air input cannot add propulsion');
}

// Leaving the snow takes away its friction and nothing else: an upright body
// meets the same air in flight as it did on the ground a moment ago.
{
  const r = rider({ height: () => -1000, canStall: () => false });
  r.pos.y = 0; r.vel.set(0, 0, -37);
  r.state = 'air'; r.grounded = false;
  r.step(dt, neutral);
  const speed = Math.hypot(37, RIDER.gravity * dt);
  close(-r.vel.z, 37 / (1 + RIDER.drag * speed * dt), 'flight pays the ground aero drag');
}

// The tuck's floor is the hill's to give. Out of the wind everywhere, but
// nothing pushes on the flat or up a climb; down a pitch it still pulls ahead.
{
  const run = (grade, tuck) => {
    const r = rider({ height: (x, z) => z * grade, canStall: () => false });
    r.vel.set(0, 0, -20); r.flowDrive = 1;
    for (let i = 0; i < 120; i++) r.step(dt, { ...neutral, tuck });
    return r.speed;
  };
  assert.ok(run(-0.2, true) < 15, `W cannot drive a rider up a climb (${run(-0.2, true)})`);
  assert.ok(run(0, true) < 20, `W cannot drive a rider along the flat (${run(0, true)})`);
  assert.ok(run(0.3, true) > run(0.3, false) + 2, 'W still pays on a descent');
}

// An ollie pushes off the board; it cannot shove the run back up the hill.
{
  const grade = 0.36;
  const s = Math.atan(grade);
  const r = rider({ height: (x, z) => z * grade, canStall: () => false });
  r.vel.set(0, -25 * Math.sin(s), -25 * Math.cos(s));
  for (let i = 0; i < 54; i++) r.step(dt, { ...neutral, jump: true });
  const down = new THREE.Vector3(0, -Math.sin(s), -Math.cos(s));
  const before = r.vel.dot(down);
  r.step(dt, neutral);
  assert.equal(r.state, 'air');
  assert.ok(r.vel.dot(down) > before - 0.1,
    `a pop keeps the run along the slope (${before.toFixed(2)} → ${r.vel.dot(down).toFixed(2)})`);
}

// The board flies at its own attitude: it leaves parallel to the snow it was
// riding and comes down matched to the slope it lands on — not level, and not
// still at the takeoff's angle — so the touchdown has nothing to snap.
{
  const h = (x, z) => (z > -8 ? z * 0.27 : -8 * 0.27 + (z + 8) * 0.7);
  const r = rider({ height: h, canStall: () => false });
  r.vel.set(0, -25 * 0.26, -25 * 0.965);
  let leaving = null;
  let landing = null;
  let levelest = Infinity;
  const takeoffUp = new THREE.Vector3();
  r.on('launch', () => { leaving = r.airUp.angleTo(r.normal); takeoffUp.copy(r.airUp); });
  r.on('land', (summary) => { landing = summary; });
  for (let i = 0; i < 600 && !landing; i++) {
    r.step(dt, neutral);
    if (r.state === 'air') levelest = Math.min(levelest, r.airUp.angleTo(r.UP));
  }
  assert.ok(landing && landing.judged, 'the pitch break throws a real flight');
  assert.ok(leaving < 0.02, 'the board leaves parallel to the snow');
  assert.ok(takeoffUp.angleTo(r.normal) > 0.12, 'and lands on a steeper slope');
  assert.ok(levelest > 0.35, `the board never flies level over a pitch (${levelest})`);
  assert.ok(landing.tilt < 0.035, `the board meets the landing slope (${landing.tilt})`);
}

// Squaring a board that came down across its travel is a skid, and a skid
// scrubs: the further off it lands, the more of the run it costs.
{
  const land = (off) => {
    const r = rider();
    r.pos.y = 0.05; r.vel.set(0, -3, -20);
    r.state = 'air'; r.grounded = false; r.airTime = 0.8;
    r.yaw = off; r.spinAccum = off;
    for (let i = 0; i < 20 && r.state === 'air'; i++) r.step(dt, { ...neutral, turnIntent: 0.5 });
    return { speed: r.speed, verdict: r.landing?.verdict };
  };
  const square = land(0.09);
  const skewed = land(0.7);
  assert.equal(square.verdict, CLEAN);
  assert.equal(skewed.verdict, CLEAN);
  assert.ok(square.speed > 19.8, `a square landing keeps its run (${square.speed})`);
  assert.ok(skewed.speed < square.speed * 0.93, `a skewed one skids off speed (${skewed.speed})`);
}

// A trick is named and paid by the stance it LEFT the snow in. A regular 180
// necessarily lands switch; it used to be announced — and paid ×1.5 — as a
// "SWITCH + FRONTSIDE 180", while a genuine switch take-off landed regular
// and was paid nothing for it.
{
  const r = rider({ height: (x, z) => z * 0.36, canStall: () => false });
  r.grace = 0; r.vel.set(0, -8, -22);
  const landings = [];
  r.on('land', (s) => landings.push(s));
  const ollieSpin = (spinFor) => {
    const input = { ...neutral };
    for (let i = 0; i < 180; i++) r.step(dt, input);
    input.jump = true;
    for (let t = 0; t < RIDER.chargeTime; t += dt) r.step(dt, input);
    input.jump = false;
    for (let i = 0; i < 24 && r.grounded; i++) r.step(dt, input);
    for (let t = 0; t < 4 && !r.grounded; t += dt) {
      input.turn = t < spinFor ? 1 : 0;
      r.step(dt, input);
    }
    return landings.at(-1);
  };
  const regular = ollieSpin(0.55);
  assert.equal(regular.halfTurns, 1);
  assert.equal(regular.switchStance, false, 'a regular take-off is not a switch trick');
  assert.equal(regular.landedSwitch, true, 'even though a 180 comes down switch');
  assert.equal(trickName(regular, regular.verdict), 'FRONTSIDE 180');
  assert.equal(r.switchStance, true, 'the next carve rides the landed stance');
  const fromSwitch = ollieSpin(0.55);
  assert.equal(fromSwitch.switchStance, true, 'a switch take-off is paid as switch');
  assert.equal(fromSwitch.landedSwitch, false);
  assert.equal(trickName(fromSwitch, fromSwitch.verdict), 'SWITCH FRONTSIDE 180',
    'SWITCH prefixes the trick rather than being joined to it like a grab');
}

// The surface's speed ceiling is a plough on the snow, never a clamp in the
// air. It used to rescale an airborne rider to the ceiling of whatever they
// were flying over — a 40 m/s jump off the piste lost 10 m/s over powder —
// and on the snow it snapped the speed back in one step, silently.
{
  const powder = { rock: 0, groomed: 0, ice: 0, powder: 1 };
  const powderCap = speedCeiling(0, powder);
  const flier = rider({ height: () => -1000, surfaceAt: () => powder, canStall: () => false });
  flier.pos.y = 0; flier.vel.set(0, 6, -40);
  flier.state = 'air'; flier.grounded = false;
  let dragOnly = 40;
  for (let i = 0; i < 60; i++) {
    flier.step(dt, neutral);
    const v = Math.hypot(dragOnly, flier.vel.y);
    dragOnly /= 1 + RIDER.drag * RIDER.airDrag * v * dt;
  }
  const flying = Math.hypot(flier.vel.x, flier.vel.z);
  assert.ok(Math.abs(flying - dragOnly) < 0.05 && flying > powderCap + 5,
    `nothing but the air slows a flight over powder (${flying.toFixed(2)} vs ${dragOnly.toFixed(2)})`);

  const plough = rider({ height: (x, z) => z * 0.3, surfaceAt: () => powder, canStall: () => false });
  plough.grace = 0; plough.vel.set(0, -45 * 0.287, -45 * 0.958);
  plough.step(dt, neutral);
  assert.ok(plough.speed > 44, `the snow ploughs the excess off, it does not snap it (${plough.speed})`);
  assert.ok(plough.scrub > 3 && plough.slide >= plough.scrub,
    'the plough throws snow: it is booked into the slide the spray and sound read');
  for (let i = 0; i < 119; i++) plough.step(dt, neutral);
  assert.ok(plough.speed < powderCap + 2.5 && plough.speed > powderCap - 1,
    `…and a second later the board is down to the powder's pace (${plough.speed.toFixed(2)} / ${powderCap})`);
  const piste = rider({ height: (x, z) => z * 0.3, canStall: () => false });
  piste.grace = 0; piste.vel.set(0, -45 * 0.287, -45 * 0.958);
  piste.step(dt, neutral);
  assert.equal(piste.scrub, 0, 'under the ceiling nothing is shed');
}

// The lip is readable while it matters. Holding a charge towards a pitch
// break lights `lipAhead` a few tenths early (never on the open pitch), then
// `lipReady` for the release window itself — which, off a real edge, is the
// launch step and the late sixth of a second after it. Releasing while lit
// is the lip pop, and `perfectPop` fires after `launch`, so the launch's
// banner clear cannot eat the callout it is meant to trigger.
{
  const h = (x, z) => (z > -8 ? z * 0.27 : -8 * 0.27 + (z + 8) * 0.7);
  const r = rider({ height: h, canStall: () => false });
  r.vel.set(0, -18 * 0.26, -18 * 0.965);
  const order = [];
  r.on('launch', () => order.push('launch'));
  r.on('perfectPop', () => order.push('perfectPop'));
  let aheadAt = null;
  let earlyCue = false;
  for (let i = 0; i < 240 && !r.lipReady; i++) {
    r.step(dt, { ...neutral, jump: true });
    if (r.pos.z > -2 && (r.lipAhead || r.lipReady)) earlyCue = true;
    if (r.lipAhead && aheadAt === null) aheadAt = r.pos.z;
  }
  assert.equal(earlyCue, false, 'an open pitch six metres short of the break is not a lip');
  assert.ok(aheadAt !== null && aheadAt > -7.5,
    `the lip is announced before it arrives (${aheadAt})`);
  assert.ok(r.lipReady, 'and lit when it does');
  r.step(dt, neutral);
  assert.equal(r.state, 'air');
  assert.equal(r.lipPop, true, 'releasing while lit is the lip pop');
  assert.deepEqual(order, ['launch', 'perfectPop'], 'the callout follows the launch that clears the band');
}

// A verdict carries its reason, for the banner: what went wrong, and which
// way — a rotation stopped short is not a rotation carried past.
{
  const touchdown = ({ vy = -3, spin = 0, flip = 0, grab = false, pop = 0 }) => {
    const r = rider();
    r.pos.y = 0.05; r.vel.set(0, vy, -20);
    r.state = 'air'; r.grounded = false; r.airTime = 0.8;
    r.airPop = pop;
    r.yaw = r.spinAccum = spin;
    r.flip = r.flipAccum = flip;
    let reason = null;
    r.on('fall', (cause, into, why) => { reason = why; });
    for (let i = 0; i < 20 && r.state === 'air'; i++) {
      r.step(dt, { ...neutral, turnIntent: 0.5, trickGrab: grab });
    }
    return r.landing ? { verdict: r.landing.verdict, reason: r.landing.reason }
      : { verdict: BAIL, reason };
  };
  assert.deepEqual(touchdown({ vy: -40 }), { verdict: BAIL, reason: 'HARD LANDING' });
  assert.deepEqual(touchdown({ flip: -Math.PI }), { verdict: BAIL, reason: 'UPSIDE DOWN' });
  assert.deepEqual(touchdown({ flip: -(TAU - 1.5) }), { verdict: BAIL, reason: 'UNDER-ROTATED' });
  assert.deepEqual(touchdown({ spin: 2.0 }), { verdict: SKETCHY, reason: 'UNDER-ROTATED' });
  assert.deepEqual(touchdown({ spin: 4.3 }), { verdict: SKETCHY, reason: 'OVER-ROTATED' });
  assert.deepEqual(touchdown({ grab: true }), { verdict: SKETCHY, reason: 'GRAB HELD' });
  assert.deepEqual(touchdown({}), { verdict: CLEAN, reason: '' });
  /* Braced for the air they popped: the same 20 m/s into the snow is heavy
     off a roll-over and clean after a full pop, the raised line stops short
     of the bail so a too-fast popped air is still heavy, and past the bail
     line no pop saves it. */
  assert.deepEqual(touchdown({ vy: -20 }), { verdict: SKETCHY, reason: 'HEAVY LANDING' });
  assert.deepEqual(touchdown({ vy: -20, pop: RIDER.popMax }), { verdict: CLEAN, reason: '' });
  const topPop = RIDER.popMax * RIDER.lipBonus;
  assert.deepEqual(touchdown({ vy: -(RIDER.hardImpact - RIDER.bracedMargin + 1.5), pop: topPop }),
    { verdict: SKETCHY, reason: 'HEAVY LANDING' });
  assert.deepEqual(touchdown({ vy: -(RIDER.hardImpact + 2), pop: topPop }),
    { verdict: BAIL, reason: 'HARD LANDING' });
}

// A tree can interrupt a flip before normal landing bookkeeping clears it.
// Recovery must preserve that visible attitude at rise entry, then finish
// upright instead of carrying live flip pitch into ordinary riding forever.
{
  const samePitch = (a, b, label) => {
    close(Math.sin(a), Math.sin(b), label + ' (sine)');
    close(Math.cos(a), Math.cos(b), label + ' (cosine)');
  };
  const crashed = (angle, height = 3) => {
    const r = rider();
    r.pos.set(0, height, 0); r.vel.set(0, -2, -20);
    r.state = 'air'; r.grounded = false; r.airTime = .8;
    r.flip = angle; r.flipVel = 4; r.flipAccum = angle;
    assert.equal(r.strike(0, 1, 1), 'fall', 'the fixture is a real airborne obstacle wipeout');
    samePitch(r.flip + r.flipGlide, angle, 'the impact keeps the interrupted visible flip');
    return r;
  };
  const recover = (r, timeout) => {
    let rises = 0;
    r.on('rise', () => rises++);
    for (let i = 0; r.state === 'fall' && i < Math.ceil((RIDER.fallMax + 1) / dt); i++) {
      const before = r.flip + r.flipGlide;
      r.step(dt, neutral);
      if (r.state === 'rise') samePitch(r.flip + r.flipGlide, before, 'rise preserves orientation modulo full turns');
    }
    assert.equal(r.state, 'rise', 'the physical tumble reaches recovery');
    assert.equal(rises, 1, 'recovery emits its transition once');
    assert.equal(r.fallElapsed > RIDER.fallMax, timeout, 'the intended natural or timeout path recovered');
    assert.equal(r.flip, 0, 'recovery retires the interrupted live flip');
    assert.equal(r.flipVel, 0, 'recovery retires the interrupted flip velocity');
    assert(Math.abs(r.flipGlide) <= Math.PI, 'only the nearest visual rotation remains');
    for (let i = 0; r.state === 'rise' && i < Math.ceil((RIDER.riseTime + 1) / dt); i++) r.step(dt, neutral);
    assert.equal(r.state, 'ride', 'getting up finishes normally');
    assert.equal(r.grounded, true);
    for (let i = 0; i < 120; i++) r.step(dt, neutral);
    assert.equal(r.flip + r.flipGlide, 0, 'ordinary riding settles fully upright');
    assert.equal(r.flipVel, 0, 'ordinary riding has no leftover flip velocity');
    return r;
  };
  let nextJump;
  for (const angle of [Math.PI, 0, Math.PI / 2, -Math.PI / 2, -Math.PI,
    3 * TAU + Math.PI / 2, -3 * TAU - Math.PI / 2, 4 * TAU + .3, -4 * TAU - .3]) {
    const r = recover(crashed(angle), false);
    if (angle === Math.PI) nextJump = r;
  }
  // The body stays airborne beyond the maximum tumble duration, so this
  // reaches the real timeout branch without changing its timer or velocity.
  recover(crashed(-3 * TAU - Math.PI, 1000), true);

  // Keep a nonzero visual residual at the handoff itself. fallStep is the
  // production recovery integrator; calling it directly isolates the transfer
  // from step's ordinary visual drain, which the runs above already exercise.
  for (const [angle, glide] of [[Math.PI / 2, .4], [-Math.PI / 2, -.4], [4 * TAU + 2.9, .6]]) {
    const r = crashed(angle);
    r.fallElapsed = RIDER.fallMax;
    r.flipGlide = glide;
    const before = r.flip + r.flipGlide;
    r.fallStep(dt);
    assert.equal(r.state, 'rise');
    samePitch(r.flip + r.flipGlide, before, 'rise keeps an existing visual glide in the same orientation');
    assert.equal(r.flip, 0);
    assert.equal(r.flipVel, 0);
    assert(Math.abs(r.flipGlide) <= Math.PI, 'existing glide also takes the short path upright');
  }

  // A later ordinary jump must start with a clean trick ledger and respond
  // only to new flip input, rather than resurrecting the interrupted one.
  for (let i = 0; i < 60; i++) nextJump.step(dt, { ...neutral, jump: true });
  nextJump.step(dt, neutral);
  assert.equal(nextJump.state, 'air', 'the recovered rider can jump again');
  for (let i = 0; i < 12; i++) nextJump.step(dt, neutral);
  assert.equal(nextJump.flip, 0, 'a neutral later flight does not rotate');
  assert.equal(nextJump.flipVel, 0);
  assert.equal(nextJump.flipAccum, 0, 'the new trick ledger contains no old rotation');
  for (let i = 0; i < 6; i++) nextJump.step(dt, { ...neutral, trickFlip: true });
  assert(nextJump.flip < 0 && nextJump.flipVel < 0, 'fresh backflip input still controls the later jump');
}

// The snow types. The corduroy is the grippiest carving snow on the hill —
// powder used to out-turn it by a third — deep snow bogs a slow board down
// rather than holding it, and a loaded edge on ice chatters.
{
  const snow = {
    groomed: { rock: 0, groomed: 1, ice: 0, powder: 0 },
    powder: { rock: 0, groomed: 0, ice: 0, powder: 1 },
    ice: { rock: 0, groomed: 0, ice: 1, powder: 0 },
  };
  const carve = (mat, v) => {
    const r = rider({ height: () => 0, surfaceAt: () => mat, canStall: () => false });
    r.grace = 0; r.vel.set(0, 0, -v);
    const input = { ...neutral, turn: 1 };
    let chatter = 0;
    for (let i = 0; i < 48; i++) r.step(dt, input);
    const from = Math.atan2(r.vel.x, -r.vel.z);
    for (let i = 0; i < 36; i++) { r.step(dt, input); chatter = Math.max(chatter, r.chatter); }
    return { rate: (Math.atan2(r.vel.x, -r.vel.z) - from) / (36 * dt), chatter };
  };
  for (const v of [20, 28]) {
    const groomed = carve(snow.groomed, v).rate;
    const powder = carve(snow.powder, v).rate;
    assert.ok(groomed > powder * 1.08,
      `the corduroy out-carves powder at ${v} m/s (${groomed.toFixed(2)} vs ${powder.toFixed(2)} rad/s)`);
  }
  assert.ok(carve(snow.ice, 25).chatter > 0.5, 'a loaded edge on ice chatters');
  assert.equal(carve(snow.groomed, 25).chatter, 0, 'the corduroy does not');
  const glide = (mat) => {
    const r = rider({ height: (x, z) => z * 0.2, surfaceAt: () => mat, canStall: () => false });
    r.grace = 0; r.vel.set(0, -1, -5);
    for (let i = 0; i < 240; i++) r.step(dt, neutral);
    return r.speed;
  };
  assert.ok(glide(snow.powder) < glide(snow.groomed) - 3,
    `deep snow bogs a slow board down (${glide(snow.powder).toFixed(1)} vs ${glide(snow.groomed).toFixed(1)} m/s)`);
}

const buffered = rider();
buffered.pos.y = 0.05; buffered.vel.set(0, -5, -10);
buffered.state = 'air'; buffered.grounded = false; buffered.airTime = 0.6;
buffered.charging = true; buffered.charge = 0.8;
let launches = 0;
buffered.on('launch', () => launches++);
for (let i = 0; i < 5; i++) buffered.step(dt, neutral);
assert.equal(launches, 1, 'release immediately before landing buffers one pop');
assert.equal(buffered.state, 'air');

const stale = rider();
stale.pos.y = 10; stale.vel.set(0, -2, -10);
stale.state = 'air'; stale.grounded = false; stale.airTime = 0.6;
stale.charging = true; stale.charge = 0.8;
let staleLaunches = 0;
stale.on('launch', () => staleLaunches++);
for (let i = 0; i < 180; i++) stale.step(dt, neutral);
assert.equal(staleLaunches, 0, 'old airborne release expires before touchdown');

for (const [flip, expected] of [[5.2, CLEAN], [Math.PI, BAIL]]) {
  const r = rider();
  r.pos.y = 0.7; r.vel.set(0, -3, -10);
  r.state = 'air'; r.grounded = false; r.airTime = 0.7;
  r.flip = flip; r.flipAccum = flip;
  for (let i = 0; i < 120 && r.state === 'air'; i++) r.step(dt, neutral);
  assert.equal(expected === BAIL ? r.state : r.landing?.verdict,
    expected === BAIL ? 'fall' : CLEAN, 'assist finishes only an almost-complete flip');
}
const slope = rider({ height: (x, z) => z * 0.8 });
slope.pos.y += 1; slope.vel.set(0, -6, -20);
slope.state = 'air'; slope.grounded = false; slope.airTime = 0.8; slope.yaw = 0.4;
slope.step(dt, neutral);
close(slope.yaw, 0.4, 'no early landing assist while the downhill surface recedes');

// Exercise browser input with native EventTarget; no DOM or test framework.
class Target extends EventTarget {
  dataset = { key: 'jump' };
  classList = { toggle() {}, remove() {} };
  setPointerCapture() {}
  querySelectorAll() { return [this]; }
}
const windowTarget = new Target();
globalThis.window = windowTarget;
let pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
function send(target, type, values = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, values);
  target.dispatchEvent(event);
}
for (const touch of [false, true]) {
  const target = new Target();
  const input = createInput(target);
  if (touch) input.bindTouch(target);
  send(target, touch ? 'pointerdown' : 'keydown', { code: 'Space', pointerId: 1 });
  input.update(1 / 240); // A rendered frame that did not step physics.
  send(target, touch ? 'pointerup' : 'keyup', { code: 'Space', pointerId: 1 });
  input.update(1 / 240);
  assert.equal(input.state.jump, true, 'quick tap survives zero-step render frames');
  input.stepped();
  assert.equal(input.state.jump, false, 'next physics tick sees release, even in the same frame');
  input.stepped(); input.update(1 / 240);
  assert.equal(input.state.jump, false, 'tap does not replay');
  send(target, touch ? 'pointerdown' : 'keydown', { code: 'Space', pointerId: 1 });
  input.calm();
  assert.equal(input.state.anyPressed, false, 'pause consumes a pending input edge rather than immediately resuming');
  send(target, touch ? 'pointerup' : 'keyup', { code: 'Space', pointerId: 1 });
  input.update(dt);
  assert.equal(input.state.jump, false, 'a release during pause does not become a fresh buffered tap');
  input.dispose();
}
pads = [{ axes: [0.8], buttons: [] }];
const gamepad = createInput(new Target());
gamepad.update(0.2);
assert.ok(gamepad.state.turn > 0.3, 'a previously connected pad works without another connection event');
gamepad.clear(); gamepad.update(0.2);
assert.equal(gamepad.state.turn, 0, 'blur suppresses held controller input until neutral');
gamepad.dispose();

// Keyboard and controller may take over one continuous charge in either direction.
{
  const pad = { axes: [0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  pads = [pad];
  const target = new Target();
  let cancelled = 0;
  const input = createInput(target, { cancelJump: () => cancelled++ });
  pad.buttons[0].pressed = true; input.update(dt); input.stepped();
  send(target, 'keydown', { code: 'Space' });
  pad.buttons[0].pressed = false; input.update(dt); input.stepped();
  assert.equal(input.state.jump, true, 'keyboard preserves a sampled pad charge');
  send(target, 'keyup', { code: 'Space' }); input.update(dt);
  assert.equal(input.state.jump, false);
  send(target, 'keydown', { code: 'Space' }); input.update(dt); input.stepped();
  pad.buttons[0].pressed = true; input.update(dt);
  send(target, 'keyup', { code: 'Space' }); input.update(dt); input.stepped();
  assert.equal(input.state.jump, true, 'pad preserves a sampled keyboard charge');
  pad.buttons[0].pressed = false; input.update(dt);
  assert.equal(input.state.jump, false);
  pad.buttons[0].pressed = true; input.update(dt); input.stepped();
  const before = cancelled; input.clear();
  assert.equal(cancelled, before + 1, 'pad-only focus loss cancels once');
  input.update(dt); assert.equal(input.state.jump, false);
  input.dispose(); pads = [];
}

// A release is player intent even while the ground steering ramp is still
// unwinding. Feed the actual input state into a nearly completed 360: the
// old double smoothing kept spinning through the remaining landing window.
pads = [];
const releaseTarget = new Target();
const released = createInput(releaseTarget);
send(releaseTarget, 'keydown', { code: 'KeyD' });
released.update(dt);
assert.ok(released.state.turn > 0 && released.state.turn < 0.1, 'ground steering still eases in');
assert.equal(released.state.turnIntent, 1);
for (let i = 0; i < 120; i++) released.update(dt);
send(releaseTarget, 'keyup', { code: 'KeyD' });
released.update(dt);
assert.ok(released.state.turn > 0.8, 'ground steering still eases out');
assert.equal(released.state.turnIntent, 0, 'air rotation sees release immediately');
const finishing = rider();
const remaining = 0.28;
finishing.pos.y = 3 * remaining + 0.5 * RIDER.gravity * remaining ** 2;
finishing.vel.set(0, -3, -15);
finishing.state = 'air'; finishing.grounded = false; finishing.airTime = 1.5;
finishing.yaw = finishing.spinAccum = 6.5;
finishing.spinVel = 5;
for (let i = 0; i < 80 && finishing.state === 'air'; i++) {
  released.update(dt);
  finishing.step(dt, released.state);
  released.stepped();
}
assert.equal(finishing.landing?.verdict, CLEAN, 'releasing before touchdown completes a clean landing');
assert.equal(finishing.landing?.halfTurns, 2, 'the intended 360 remains a 360');
released.dispose();
const committed = rider();
committed.pos.y = 0.4; committed.vel.set(0, -5, -15);
committed.state = 'air'; committed.grounded = false; committed.airTime = 1;
committed.yaw = 0.8;
committed.step(dt, { ...neutral, turnIntent: 0.5 });
close(committed.yaw, 0.8 + committed.spinVel * dt, 'landing help never fights a held stick');

// Menu edges and focus-loss suppression must work without any physics steps.
// The main-loop pause/resume integration is also exercised in the browser.
let menuEdges = 0;
const menuPad = { axes: [0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
pads = [menuPad];
const menuInput = createInput(new Target(), { key: e => {
  assert.equal(e.code, 'Escape');
  menuEdges++;
  if (menuEdges % 2 === 1) menuInput.calm(); // The production pause callback.
} });
menuPad.buttons[0].pressed = menuPad.buttons[9].pressed = true;
for (let i = 0; i < 60; i++) menuInput.update(dt);
assert.equal(menuEdges, 1, 'holding Start pauses only once');
assert.equal(menuInput.state.anyPressed, false, 'Start wins over simultaneous A without resuming immediately');
menuPad.buttons[0].pressed = menuPad.buttons[9].pressed = false;
menuInput.update(dt);
assert.equal(menuInput.state.jump, false, 'releasing A after a menu pause cannot queue a surprise jump');
menuPad.buttons[9].pressed = true;
for (let i = 0; i < 60; i++) menuInput.update(dt);
assert.equal(menuEdges, 2, 'a fresh Start press resumes only once');
menuPad.buttons[0].pressed = true;
menuInput.clear();
for (let i = 0; i < 60; i++) menuInput.update(dt);
assert.equal(menuEdges, 2, 'focus loss suppresses a held Start until neutral');
assert.equal(menuInput.state.jump, false, 'focus loss still suppresses a held jump');
assert.equal(menuInput.state.anyPressed, false);
menuPad.buttons[0].pressed = menuPad.buttons[9].pressed = false;
menuInput.update(dt);
menuPad.buttons[0].pressed = true;
menuInput.update(dt);
assert.equal(menuInput.state.anyPressed, true, 'a fresh A press can resume after neutral');
menuInput.state.anyPressed = false;
for (let i = 0; i < 20; i++) menuInput.update(dt);
assert.equal(menuInput.state.anyPressed, false, 'held A does not repeat the resume edge');
menuPad.buttons[0].pressed = false;
menuPad.axes[0] = 0.1;
menuInput.update(dt);
assert.equal(menuInput.state.turnIntent, 0, 'stick intent keeps the existing dead zone');
menuPad.axes[0] = 0.8;
menuInput.update(dt);
assert.ok(menuInput.state.turnIntent > 0 && menuInput.state.turnIntent < 0.8,
  'stick intent remains analog after dead-zone rescaling');
menuInput.dispose();

// Triggers are analogue and the rider's brake is a pressure: a half squeeze
// asks for about half of it, keys and d-pad buttons for all of it. Back is
// the pad's R — one restart per press — and a phone without a pad buzzes.
{
  const pad = { axes: [0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  pads = [pad];
  const keys = [];
  const analog = createInput(new Target(), { key: (e) => keys.push(e.code) });
  pad.buttons[6].value = 0.5;
  pad.buttons[7].value = 1; pad.buttons[7].pressed = true;
  analog.update(dt);
  assert.equal(analog.state.brake, true);
  assert.ok(Math.abs(analog.state.brakeAmount - 0.44 / 0.94) < 1e-9, `LT passes its travel (${analog.state.brakeAmount})`);
  assert.equal(analog.state.tuckAmount, 1);
  const r = rider({ height: (x, z) => z * 0.3, canStall: () => false });
  r.vel.set(0, -6, -20);
  for (let i = 0; i < 90; i++) r.step(dt, { ...neutral, brake: true, brakeAmount: analog.state.brakeAmount });
  assert.ok(Math.abs(r.brake - analog.state.brakeAmount) < 0.02, `a half squeeze is half a speed check (${r.brake})`);
  pad.buttons[6].value = 0; pad.buttons[7].value = 0; pad.buttons[7].pressed = false;
  pad.buttons[8].pressed = true;
  for (let i = 0; i < 30; i++) analog.update(dt);
  assert.deepEqual(keys, ['KeyR'], 'holding Back restarts once');
  pad.buttons[8].pressed = false;
  analog.update(dt);
  analog.dispose();

  pads = [];
  const buzzes = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    getGamepads: () => pads, vibrate: (ms) => { buzzes.push(ms); return true; },
    userActivation: { hasBeenActive: true },
  } });
  const phone = createInput(new Target());
  phone.rumble(0.5, 0.2, 240);
  assert.equal(buzzes.length, 0, 'no touch pad bound: a laptop never buzzes');
  phone.bindTouch(new Target());
  phone.rumble(0.5, 0.2, 240);
  phone.rumble(0.1, 0.05, 90);
  assert.deepEqual(buzzes, [110], 'a touch device buzzes for strength, and skips the faint ones');
  phone.dispose();
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
}

// Spinning the board must not orbit the chase view away from its landing.
const flying = rider();
flying.pos.y = 20; flying.vel.set(0, 0, -20);
flying.state = 'air'; flying.grounded = false; flying.airTime = 2;
const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 2000);
const chase = createChaseCamera(THREE, camera);
for (let i = 0; i < 240; i++) chase.update(flying, 1 / 60, flat);
const original = camera.position.clone();
flying.yaw = Math.PI / 2;
for (let i = 0; i < 60; i++) chase.update(flying, 1 / 60, flat);
assert.ok(camera.position.distanceTo(original) < 0.02, 'camera tracks flight instead of board rotation');
assert.ok(camera.position.y >= flat.height(camera.position.x, camera.position.z) + 1.5);

// The frame keeps opening past the old 42 m/s stop — the whole top half of
// the flow range used to look exactly like 151 km/h — while the range
// everybody rides in is framed exactly as before.
{
  const settle = (v) => {
    const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 2000);
    const view = createChaseCamera(THREE, cam);
    const r = rider();
    r.vel.set(0, 0, -v);
    for (let i = 0; i < 600; i++) view.update(r, 1 / 60, flat);
    return { fov: cam.fov, back: cam.position.distanceTo(r.pos) };
  };
  const slow = settle(20);
  assert.ok(Math.abs(slow.fov - (65 + 7 * (20 / 42) ** 2)) < 0.05, `20 m/s is framed as before (${slow.fov})`);
  const at = [42, 60, 96].map(settle);
  assert.ok(at[0].fov < at[1].fov && at[1].fov < at[2].fov, `the lens keeps opening (${at.map((s) => s.fov.toFixed(1))})`);
  assert.ok(at[0].back < at[1].back && at[1].back < at[2].back, 'and the boom keeps pulling back');
  assert.ok(at[2].fov < 76, 'without running away');
}
// A live OS comfort preference removes incidental movement while preserving
// the camera's actual job: keeping the rider, landing and terrain in view.
{
  const preference = { matches: false };
  let queries = 0;
  window.matchMedia = () => { queries++; return preference; };
  const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 2000);
  const view = createChaseCamera(THREE, cam);
  const r = rider();
  r.vel.set(0, 0, -96);
  r.roll = 0.5; r.carveLoad = 1; r.chatter = 1;
  r.compression = 0.5; r.tucking = true;
  r.normal.set(0.35, 0.93, 0.1).normalize();
  const settle = () => { for (let i = 0; i < 600; i++) view.update(r, 1 / 60, flat); };
  settle();
  assert.ok(cam.fov > 70, 'normal riding retains speed-responsive framing');
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  assert.ok(Math.abs(right.y) > 0.01, 'normal riding retains its bank');

  // The camera was created before the preference changed.
  preference.matches = true;
  settle();
  assert.ok(Math.abs(cam.fov - 65) < 0.011, 'comfort settles to a stable lens at speed');
  right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  assert.ok(Math.abs(right.y) < 1e-8, 'comfort levels the horizon');
  const position = cam.position.clone(), orientation = cam.quaternion.clone();
  const fov = cam.fov;
  view.kick(2); view.land(RIDER.hardImpact);
  for (let i = 0; i < 60; i++) {
    view.update(r, 1 / 60, flat);
    assert.ok(cam.position.distanceTo(position) < 1e-8, 'chatter and impacts do not shake a comfort camera');
    assert.ok(1 - Math.abs(cam.quaternion.dot(orientation)) < 1e-8, 'impacts do not roll the view');
    close(cam.fov, fov, 'a comfort landing has no lens punch');
  }
  assert.equal(view.shake, 0, 'ignored impacts are not stored for later');
  r.tucking = false; r.compression = 0;
  view.update(r, 1 / 60, flat);
  assert.ok(cam.position.distanceTo(position) < 1e-8, 'tuck and leg bob do not pump the comfort view');

  r.state = 'air'; r.grounded = false; r.airTime = 2; r.pos.y = 20;
  settle();
  assert.ok(cam.fov > 69.9, 'long-flight opening still reveals the landing');
  const flight = cam.position.clone();
  r.yaw = Math.PI / 2; settle();
  assert.ok(cam.position.distanceTo(flight) < 0.02, 'comfort tracks the flight rather than a spinning board');
  assert.ok(cam.position.y >= flat.height(cam.position.x, cam.position.z) + 1.5, 'comfort preserves ground clearance');
  assert.equal(queries, 1, 'the live preference is queried once, not allocated each frame');

  r.state = 'ride'; r.grounded = true; r.airTime = 0; r.pos.y = 0; r.yaw = 0;
  preference.matches = false; settle();
  assert.ok(cam.fov > 70, 'normal framing returns when the OS preference changes back');

  preference.matches = true;
  const portrait = new THREE.PerspectiveCamera(65, 390 / 844, 0.1, 2000);
  const portraitView = createChaseCamera(THREE, portrait);
  const quiet = rider(); quiet.vel.set(0, 0, -10);
  const trees = { ...flat, blocked: (x, z, radius) => z + radius >= 5 };
  for (let i = 0; i < 600; i++) portraitView.update(quiet, 1 / 60, trees);
  assert.ok(portrait.fov > 65 && portrait.fov <= 82, 'portrait collision framing can still widen the lens');
  portrait.updateMatrixWorld();
  const subject = quiet.pos.clone().add(new THREE.Vector3(0, 1, 0)).project(portrait);
  assert.ok(Math.abs(subject.x) < 1 && Math.abs(subject.y) < 1, 'the obstructed portrait view keeps the rider visible');
  assert.ok(portrait.position.y >= 1.5, 'portrait obstruction response preserves ground clearance');
  delete window.matchMedia;
}

// Height is an outcome of the directional tangent and a modest leg impulse.
{
  const release = (speed, degrees, pop = 0, across = false) => {
    const angle = degrees * Math.PI / 180;
    const n = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
    const r = rider({ height: () => -1000, canStall: () => false });
    r.pos.set(0, 0, 0); r.normal.copy(n);
    if (across) r.vel.set(speed, 0, 0);
    else r.vel.set(0, speed * Math.sin(angle), -speed * Math.cos(angle));
    r.takeOff(pop, n);
    const vy = r.vel.y, initialSpeed = r.vel.length();
    let apex = 0;
    const steps = Math.ceil((Math.max(0, vy) / RIDER.gravity + .1) / dt);
    for (let i = 0; i < steps; i++) { r.step(dt, neutral); apex = Math.max(apex, r.pos.y); }
    return { apex, vy, initialSpeed };
  };
  const sweep = [];
  for (const speed of [12, 24, 36]) for (const angle of [0, 12, 24]) {
    const natural = release(speed, angle);
    close(natural.initialSpeed, speed, 'the ramp adds no kinetic energy');
    close(natural.vy, speed * Math.sin(angle * Math.PI / 180), 'actual takeoff angle determines vertical velocity');
    const expected = Math.max(0, natural.vy) ** 2 / (2 * RIDER.gravity);
    assert.ok(Math.abs(natural.apex - expected) < .001, 'measured apex follows the constant-gravity arc');
    const charged = release(speed, angle, RIDER.popMax);
    sweep.push({ speed, angle, natural: +natural.apex.toFixed(3), charged: +charged.apex.toFixed(3) });
  }
  close(release(24, 24, 0, true).vy, 0, 'crossing a slope is not riding up its lip');
  for (const speed of [12, 24, 36]) {
    const heights = sweep.filter(row => row.speed === speed);
    assert.ok(heights[0].charged < heights[1].charged && heights[1].charged < heights[2].charged,
      'steeper directional takeoff angles make higher jumps');
  }
  for (const angle of [12, 24]) {
    const heights = sweep.filter(row => row.angle === angle);
    assert.ok(heights[0].charged < heights[1].charged && heights[1].charged < heights[2].charged,
      'greater speed makes a higher jump at the same takeoff angle');
  }
  const ollie = ticks => {
    const r = rider(); r.vel.set(0, 0, -24);
    for (let i = 0; i < ticks; i++) r.step(dt, { ...neutral, jump: true });
    r.step(dt, neutral);
    let apex = r.pos.y;
    for (let i = 0; i < 240 && !r.grounded; i++) { r.step(dt, neutral); apex = Math.max(apex, r.pos.y); }
    return apex;
  };
  const tap = ollie(1), full = ollie(Math.ceil(RIDER.chargeTime / dt));
  assert.ok(full >= .5 && full <= 1.5, 'full flat ollie stays modest and readable (' + full + 'm)');
  assert.ok(tap >= .12 && tap < full * .5, 'a tap stays visibly smaller (' + tap + 'm)');
  assert.ok(release(24, 0, RIDER.popMax * RIDER.lipBonus).apex <= 1.5,
    'lip timing cannot turn the legs alone into a giant launch');
  console.log('Jump height sweep (metres): ' + JSON.stringify({ tap, full, sweep }));
}

console.log('Riding checks passed: charged/late/buffered pops, directional jump height, ballistic air, air drag, hill-paid tuck, pop direction, flight attitude, landing skid, trick stance, surface ceiling, lip cues, landing reasons, upright wipeout recovery, snow types, landing assist, input taps/pads, release intent, controller menus, analog triggers and vibration, camera framing at speed, and live motion comfort.');
