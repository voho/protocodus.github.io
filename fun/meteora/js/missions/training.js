/* Flight training — the Perpetua's range, before any of it began.

   Saint takes a new pilot through the basics, one at a time, each step
   waiting until it has been done: steer with the mouse through the nav
   points, speed up, slow down, burn, roll, slide; let the scope pick a
   target and switch it; guns on one drone, a locked missile on another;
   then five drones weaving about the range, all of them, to pass. Nothing
   here shoots back, and nothing flown here counts in the campaign. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, at, dir } from './kit.js';
import { qRotate, qRotateInv } from '../vec.js';

const START = [0, 0, 0];
const PERPETUA = [700, 180, 2600];
const RANGE = [0, 60, -2600];   // where the briefing's map points
// Open space off the Perpetua's bow: nothing to hit but the targets.
const FIELD = belt({ spawn: START, density: 0, landmarks: 0 });

export default defineMission({
  id: 'training', number: 0, training: true, title: 'Flight Training', location: 'The Perpetua\'s range', dateline: 'Before the silence',
  field: FIELD, fieldSeed: 3131, seed: 31, par: 600, env: 'sector7', hints: true,
  start: { pos: START, forward: [0, 0, -1], speed: 40 },
  area: { centre: [0, 0, -1500], radius: 6000 },
  models: ['fighter', 'drone', 'perpetua'],
  music: 'calm',
  recommend: {
    hull: 'kestrel', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'hearth',
    why: 'The Kestrel: the Watch\'s all-rounder, and the ship you will fly most.',
  },
  briefing: {
    stages: [
      { text: 'Before you fly for the Watch, you fly for Saint. Out on the Perpetua\'s range, one thing at a time: steering, speed, the afterburner, rolling and sliding.', focus: START },
      { text: 'Then targets: let the scope pick one, switch it, put your guns on a drone and a missile on another. Nothing out there shoots back.', focus: RANGE },
      { text: 'Pass the last test — five drones weaving about the range — and you are a Lantern. Take your time.', focus: RANGE },
    ],
  },
  map: {
    extent: 7000,
    icons: [{ kind: 'player', pos: START, label: 'You' }, { kind: 'capital', pos: PERPETUA, label: 'Perpetua' }, { kind: 'nav', pos: RANGE, label: 'Range' }],
    routes: [{ path: [START, RANGE], kind: 'nav' }],
  },
  objectivesPreview: [
    { text: 'Steer, speed up, slow down, burn, roll and slide' },
    { text: 'Target, shoot and lock' },
    { text: 'Destroy five target drones' },
  ],
  debrief: {
    won: 'Saint signed the range log with a flourish nobody could read and wrote one word under it: ready. Somewhere out in Sector Seven, an ore tug called the Saint Amaro is about to stop answering.',
    lost: 'The range will be there tomorrow. So will Saint.',
  },

  setup(m) {
    m.spawn('perpetua', { team: 0, pos: PERPETUA, forward: [1, 0, 0.2], name: 'Perpetua', unkillable: true });
  },

  *script(m) {
    const w = m.world, p = m.player, ship = p.ship;
    const speed = () => Math.hypot(ship.vel[0], ship.vel[1], ship.vel[2]);
    const local = [0, 0, 0];
    const drone = (pos, name, helm = null) => m.spawn('target', { team: 1, pos, forward: dir(pos, ship.pos), name, helm, tags: ['drone'] });
    // A point ahead of the pilot: `ahead` metres along the nose, then
    // `right` and `up` across it.
    const ahead = (d, right = 0, up = 0) => {
      const f = qRotate([0, 0, 0], ship.q, [0, 0, -1]), r = qRotate([0, 0, 0], ship.q, [1, 0, 0]), u = qRotate([0, 0, 0], ship.q, [0, 1, 0]);
      return [0, 1, 2].map(i => ship.pos[i] + f[i] * d + r[i] * right + u[i] * up);
    };
    const step = (id, text, o) => m.objective(id, text, o);

    yield m.say('doukas', 'Range is yours, Saint. Bring me back a pilot.');
    yield m.say('saint', 'Right, rookie. Everything I know, and none of it twice. Let\'s start with flying in a straight line.');

    // 1. Steering: through three nav points, each off to a side.
    const gates = [at(START, 25, 700, 120), at(START, -30, 1500, -80), at(START, 10, 2300, 160)];
    gates.forEach((g, k) => m.nav(`g${k}`, `Nav ${k + 1}`, g, { r: 120, hidden: true }));
    step('steer', 'Steer through the three nav points');
    m.hint('The mouse steers: the ship turns toward the crosshair. Fly through the cyan marker.', 12);
    for (let k = 0; k < gates.length; k++) {
      m.showNav(`g${k}`);
      yield m.until(() => m.dist(p, gates[k]) < 120);
      m.hideNav(`g${k}`);
      if (k < gates.length - 1) m.say('saint', ['Good. Next one.', 'Smooth. One more.'][k]);
    }
    m.complete('steer');

    // 2. Speed.
    yield m.say('saint', 'Now speed. You\'ll want more of it.');
    step('fast', `Speed up past ${Math.round(ship.stats.fa.forwardSpeed * 0.85)} m/s`);
    m.hint('{faster} speeds up. Hold it.', 9);
    yield m.until(() => speed() > ship.stats.fa.forwardSpeed * 0.85);
    m.complete('fast');
    yield m.say('saint', 'And stopping is a skill too. Bring her down.');
    step('slow', 'Slow below 30 m/s');
    m.hint('{slower} slows you down. Mind: no air out here — the ship only slows because it fires its thrusters against the way you\'re going.', 11);
    yield m.until(() => speed() < 30);
    m.complete('slow');

    // 3. The afterburner: held, it builds.
    yield m.say('saint', 'The afterburner. Hold it down and keep holding: the longer you burn, the harder she pushes.');
    step('burn', 'Burn the afterburner for three seconds');
    m.hint('Hold {boost} for the afterburner. The bar under your speed is its fuel; it refills when you let go.', 11);
    yield m.until(() => ship.afterburner && ship.burnTime >= 3);
    m.complete('burn');
    yield m.say('saint', 'That\'s the feeling. Now let her coast.');

    // 4. Roll and slide.
    yield m.wait(2);
    step('roll', 'Roll all the way round');
    m.hint('{rollLeft} and {rollRight} roll the ship. Go all the way over.', 10);
    let rolled = 0, slid = 0;
    m.thread((function* () {
      for (;;) {
        yield m.wait(0.05);
        rolled += Math.abs(ship.w[2]) * 0.05;
        qRotateInv(local, ship.q, ship.vel);
        if (Math.abs(local[0]) > 25 || Math.abs(local[1]) > 25) slid += 0.05;
      }
    })(), 'stick');
    yield m.until(() => rolled >= Math.PI * 2);
    m.complete('roll');
    yield m.say('saint', 'Upside down is just another way up out here.');
    step('slide', 'Slide sideways');
    m.hint('{strafeLeft} and {strafeRight} slide the ship sideways without turning it. It dodges fire.', 10);
    yield m.until(() => slid >= 0.8);
    m.complete('slide');

    // 5. Targets: the scope picks the nearest; T switches.
    yield m.say('saint', 'Enough sightseeing. Two drones coming up, dead ahead.');
    const near = drone(ahead(800, -180, 40), 'Target drone 1');
    const far = drone(ahead(1200, 220, -60), 'Target drone 2');

    yield m.until(() => w.target?.tags?.has('drone'), 5);
    const first = w.target;
    step('switch', 'Switch to the other drone');
    m.say('saint', 'Your scope takes the nearest hostile by itself — the box at the bottom shows it. Switch to the other one.');
    m.hint('{cycleTarget} switches to the next hostile.', 10);
    yield m.until(() => (w.target && w.target !== first && w.target.tags.has('drone')) || !near.alive || !far.alive);
    m.complete('switch');

    // 6. Guns.
    yield m.say('saint', 'Guns. Put the crosshair on the circle ahead of it and hold the trigger.');
    step('guns', 'Shoot down a drone with your guns');
    m.hint('Left click fires. Aim at the small circle in front of the target: that is where it will be when your bolts get there.', 12);
    yield m.until(() => !near.alive || !far.alive);
    m.complete('guns');
    const other = near.alive ? near : far;

    // 7. A locked missile.
    yield m.say('saint', 'Nice. Missiles now. Keep your nose on the other one until you hear the tone.');
    step('missile', 'Lock a missile and fire it');
    m.hint('Hold the target in front of you until it says LOCKED, then right click.', 12);
    let fired = false;
    m.on('missileLaunch', ev => { if (ev.team === 0 && ev.locked) fired = true; });
    yield m.until(() => fired || !other.alive);
    yield m.until(() => !other.alive, 12);
    if (other.alive) w.damage(other, 1e6, [...other.ship.pos], null);
    m.complete('missile');
    yield m.say('saint', 'Fire and forget. Mostly forget.');

    // 8. The test: five drones weaving about the range, laid out ahead.
    yield m.say('saint', 'Last test. Five drones, and these ones move. Take them all.');
    const range = ahead(1500, 0, 60);
    m.nav('range', 'Range', range, { r: 300 });
    m.showNav('range');
    const five = [0, 1, 2, 3, 4].map(k => {
      const c = add(range, [(k - 2) * 220, (k % 2 ? 1 : -1) * 80, (k % 3 - 1) * 180]);
      const r = 200 + 45 * k, loop = [0, 1, 2, 3].map(i => at(c, i * 90 + k * 37, r, (i % 2 ? 1 : -1) * 60));
      return drone(loop[0], `Drone ${k + 1}`, { path: loop, speed: 34 + 6 * k, loop: true });
    });
    step('five', 'Destroy five target drones', { count: { n: 0, of: 5 } });
    m.hint('Speed matters: slow down to turn tighter, or {toggleSpeedLock} to match your target\'s speed.', 12);
    for (;;) {
      yield m.wait(0.25);
      const down = five.filter(e => !e.alive).length;
      m.progress('five', down, 5);
      if (down === 5) break;
    }
    m.complete('five');
    m.hideNav('range');
    yield m.say('saint', 'Five for five. Welcome to Lantern Wing, rookie.');
    yield m.say('doukas', 'Good work, Saint. Lantern — get some sleep.');
    m.win();
  },
});
