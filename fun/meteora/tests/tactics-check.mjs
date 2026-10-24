// Behavior checks for the squadron, preventable threats and mission branches.
import { test, run, assert } from './harness.mjs';
import { createBrain, pickTarget, thinkPilot } from '../js/ai.js';
import { createShip, stepShip } from '../js/flight.js';
import { createField } from '../js/field.js';
import { FIELD, ENEMY, PLAYER, STEP as DT } from '../js/config.js';
import { createWorld, startRun, stepWorld, drainEvents, wingOrder, IDLE } from '../js/world.js';
import { missionById } from '../js/campaign.js';
import { qLookRotation } from '../js/vec.js';
import { results } from '../js/mission.js';

const EMPTY = { ...FIELD, fill: 0, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };
const craft = (id, team, pos) => ({ id, team, radius: 5, alive: true, big: false, hull: 100, maxHull: 100,
  role: 'fighter', ship: createShip(team ? ENEMY : PLAYER, { pos }), brain: createBrain(id) });
const make = (id, difficulty = 'pilot') => {
  const mission = missionById(id), w = createWorld({ mission, loadout: mission.recommend, difficulty });
  startRun(w); return w;
};
// Advance only the script when checking a timed branch. The combat checks
// exercise the real weapons; these checks isolate the player's decisions.
const scriptTo = (w, until) => { while (w.mission.time < until && !w.mission.outcome) w.mission.step(0.05); };

test('pilots divide comparable threats, but prioritize a bomber attacking their ward', () => {
  const me = craft(1, 0, [0, 0, 0]), partner = craft(2, 0, [20, 0, 0]);
  const a = craft(3, 1, [-30, 0, -800]), b = craft(4, 1, [30, 0, -820]);
  partner.brain.target = a;
  assert.equal(pickTarget(me, [a, b], { allies: [me, partner], current: null }), b);
  a.role = 'bomber'; a.brain.target = partner;
  assert.equal(pickTarget(me, [a, b], { allies: [me, partner], protect: partner, current: null }), a);
});

test('a lined-up firing pass is held for a friendly fighter or intervening rock', () => {
  const me = craft(1, 0, [0, 0, 0]), target = craft(2, 1, [0, 0, -600]), friend = craft(3, 0, [0, 0, -300]);
  const brain = me.brain, field = createField(1, EMPTY);
  brain.state = 'attack'; brain.think = 99; brain.burstOn = true; brain.burstTimer = 99;
  const ctx = { target, field, larges: [], smalls: [me, target] };
  assert.equal(thinkPilot(brain, me, ctx, DT).fire, true);
  brain.sightTimer = 0; ctx.smalls.push(friend);
  assert.equal(thinkPilot(brain, me, ctx, DT).fire, false);
  brain.sightTimer = 0; ctx.smalls.pop(); field.sweepSphere = () => ({ t: 0.5 });
  assert.equal(thinkPilot(brain, me, ctx, DT).fire, false);
});

test('a badly hurt wingman disengages to recharge instead of making a suicide pass', () => {
  const me = craft(1, 0, [0, 0, 0]), target = craft(2, 1, [0, 0, -700]);
  Object.assign(me, { hull: 25, maxShield: 100, shield: 0 });
  me.brain.think = 0;
  const c = thinkPilot(me.brain, me, { target, field: createField(1, EMPTY), tactics: 0.5, threat: {} }, DT);
  assert.equal(me.brain.state, 'recover'); assert.ok(c.boost); assert.equal(c.fire, false);
});

test('a wingman ahead of or behind a moving leader settles into formation', () => {
  for (const z of [-600, 600]) {
    const leader = craft(1, 0, [0, 0, 0]), me = craft(2, 0, [-150, 40, z]);
    leader.ship.vel = [0, 0, -100]; me.ship.vel = [0, 0, -100]; me.slot = [36, 4, 32];
    const ctx = { field: createField(1, EMPTY), target: null, leader };
    for (let i = 0; i < 120 * 40; i++) {
      for (let k = 0; k < 3; k++) leader.ship.pos[k] += leader.ship.vel[k] * DT;
      stepShip(me.ship, thinkPilot(me.brain, me, ctx, DT), DT);
    }
    const gap = Math.hypot(...me.ship.pos.map((v, k) => v - leader.ship.pos[k] - me.slot[k]));
    assert.ok(gap < 10, `slot error ${gap.toFixed(1)} m, starting ${z} m away`);
  }
});

test('silencing the relay cancels the heavy escort; ignoring it brings the escort', () => {
  for (const silence of [true, false]) {
    const w = make('m07'); scriptTo(w, 1);
    const relay = w.entities.find(e => e.tags.has('relay'));
    if (silence) {
      relay.alive = false;
      w.events.push({ type: 'shipKilled', id: relay.id });
    }
    scriptTo(w, 160);
    assert.equal(w.mission.m.done('relay'), silence);
    assert.equal(w.entities.some(e => e.cls === 'talon'), !silence);
  }
});

test('the repair-crew window repairs living engines, and loses its bonus if the crew dies', () => {
  for (const survives of [true, false]) {
    const w = make('m06'); scriptTo(w, 126);
    const carrier = w.byId.get(w.mission.flags.perpetua);
    const engines = carrier.subsystems.filter(s => s.kind === 'engine');
    engines.forEach(e => { e.hull = e.maxHull * 0.3; });
    const crew = w.entities.find(e => e.name === 'Engine repair crew');
    assert.ok(crew, 'crew launch at the intended point in the defense');
    if (!survives) crew.alive = false;
    scriptTo(w, 175);
    assert.equal(w.mission.m.done('crew'), survives);
    for (const e of engines) assert.ok(Math.abs(e.hull / e.maxHull - (survives ? 0.7 : 0.3)) < 1e-6);
  }
});

test('an actual cargo scan exposes Skiff 4 early and seals its launch doors', () => {
  const w = make('m09'), suspect = w.entities.find(e => e.name === 'Skiff 4');
  w.player.invulnerable = true;
  for (let i = 0; i < 120 * 95 && suspect.team === 0; i++) {
    // Hold a scanner position alongside the moving transport.
    const p = w.player.ship;
    p.pos = suspect.ship.pos.map((v, k) => v + (k === 0 ? 220 : 0)); p.vel = [...suspect.ship.vel];
    qLookRotation(p.q, [-1, 0, 0], [0, 1, 0]);
    w.target = suspect; w.targetSub = null;
    stepWorld(w, IDLE, DT);
    if (i % 120 === 0) drainEvents(w);
  }
  assert.ok(w.mission.flags.identified, 'the scan, not a fabricated event, identified the boarding');
  assert.equal(suspect.team, 1);
  assert.equal(suspect.launcher, null);
  assert.equal(suspect.noAutoTarget, false, 'confirmed hostiles can be engaged by the fleet');
  assert.ok(w.mission.time < 150, 'the convoy does not need to reach the scripted checkpoint');
});

test('the squadron report remembers a wingman after the world removes the wreck', () => {
  const w = make('m01'), saint = w.entities.find(e => e.name === 'Saint');
  saint.alive = false;
  w.entities.splice(w.entities.indexOf(saint), 1); w.byId.delete(saint.id);
  assert.deepEqual(results(w).wing, [{ name: 'Saint', alive: false, kills: 0 }]);
});

test('a designated kill by the wing earns command credit without inflating personal kills', () => {
  const w = make('m01'), saint = w.entities.find(e => e.name === 'Saint');
  const enemy = w.mission.m.spawn('thorn', { pos: [0, 700, -1800] });
  w.target = enemy;
  assert.ok(wingOrder(w, 'attack'));
  enemy.alive = false; enemy.lastHitBy = saint.id;
  stepWorld(w, IDLE, DT);
  assert.equal(w.stats.commandKills, 1);
  assert.equal(w.stats.killCount, 0);
  assert.equal(w.score, Math.round(enemy.def.score * 0.4 * w.diff.score));
  const points = w.score;
  stepWorld(w, IDLE, DT);
  assert.equal(w.score, points, 'a reported death is never credited twice');
});

await run();
