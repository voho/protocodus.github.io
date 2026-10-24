/* Mission 2 — Ore Run. Convoy escort.

   Three Mule freighters, full of Roussanou ore, cross nine kilometres of
   belt to the Perpetua with Lantern Wing riding shotgun. Harrow raiders
   come for the freighters, and halfway home a rockslide closes the lane:
   the convoy stops dead while the escort clears the rock under fire. */

import { defineMission } from '../mission.js';
import { belt, lanesOf } from './belt.js';
import { add, convoy, dir, lerp3, tally, wave } from './kit.js';

const ROUTE = [[-3300, 0, -3000], [-2100, 120, -1700], [-700, 60, -350], [700, -40, 1000], [2000, 0, 2400]];
const SLIDE = lerp3(ROUTE[2], ROUTE[3], 0.55);
const PERPETUA = [2900, 60, 3500];
const START = add(ROUTE[0], [160, 60, 420]);

const FIELD = belt({
  spawn: START, density: 1.0, landmarks: 3,
  clear: [{ pos: PERPETUA, r: 950 }, { pos: ROUTE[0], r: 500 }],
  lanes: lanesOf(ROUTE, 190),
});

export default defineMission({
  id: 'm02', number: 2, title: 'Ore Run', location: 'Roussanou lane', dateline: 'Day 21',
  field: FIELD, fieldSeed: 2025, seed: 202, par: 420, env: 'roussanou',
  start: { pos: START, forward: dir(ROUTE[0], ROUTE[1]), speed: 50 },
  area: { centre: [0, 0, 0], radius: 7500 },
  models: ['fighter', 'interceptor', 'talon', 'freighter', 'perpetua', 'drone', 'swift'],
  music: 'calm',
  recommend: {
    hull: 'kestrel', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'hearth',
    why: 'A long escort against fighters: balance wins it. A Swift with Needles catches raiders faster but will not last as long.',
  },
  needs: { fighters: true },
  briefing: {
    stages: [
      { text: 'Roussanou\'s ore keeps Varlaam\'s smelters burning. Three Mule freighters are loaded and waiting, and after the Saint Amaro, no one will fly them without an escort.', focus: ROUTE[0] },
      { text: 'The lane to the Perpetua is nine kilometres of cleared rock. The Mules are slow and they cannot fight. Saint and Wren fly with you.', focus: ROUTE[2] },
      { text: 'Keep the raiders off them. At least two Mules must reach the Perpetua; the ore in the third is worth a month of air for Varlaam.', focus: PERPETUA },
    ],
  },
  map: {
    extent: 9000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'friend', pos: ROUTE[0], label: 'Mule convoy' },
      { kind: 'capital', pos: PERPETUA, label: 'Perpetua' }, { kind: 'nav', pos: ROUTE[2], label: 'Waypoint 2' },
    ],
    routes: [{ path: ROUTE, kind: 'convoy' }],
  },
  objectivesPreview: [
    { text: 'Bring at least two Mules home' },
    { text: 'All three Mules arrive', bonus: true },
    { text: 'No Mule drops below half hull', bonus: true },
  ],
  debrief: {
    won: 'The ore reached Varlaam two days later and the smelters lit again. Okonkwo spent the night inside the wrecks you brought back and came out with two findings. The raiders fold in from a single direction, the Kalavryta Deep, where the belt is too dense for anyone to live: something out there is building them. And their hull plate is rolled to an Earth gauge nobody in the belt has used for a century. She would not say what she thought that meant.',
    lost: 'Too much ore was lost in the lane. Varlaam rationed its smelters, and the Watch learned that the raiders want freighters more than fighters.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'] });
    m.spawn('perpetua', { team: 0, pos: PERPETUA, forward: [-0.5, 0, -1], fixed: true, invulnerable: true });
    const mules = convoy(m, [['mule', 'Mule 1'], ['mule', 'Mule 2'], ['mule', 'Mule 3']], ROUTE, { speed: 52, spacing: 280 });
    m.flag('mules', mules.map(e => e.id));
    m.nav('lane', 'Convoy lane', ROUTE[2], { r: 500 });
    m.nav('home', 'Perpetua', ROUTE[4], { r: 700 });
  },

  *script(m) {
    const w = m.world;
    const mules = m.flags.mules.map(id => w.byId.get(id));
    const T = tally(m, mules);
    const lead = () => mules.find(e => e.alive && !T.arrived.has(e.id)) ?? mules[0];
    m.objective('convoy', 'Bring at least two Mules home', { count: { n: 0, of: 3 } });
    m.objective('all', 'All three Mules arrive', { bonus: true });
    m.objective('half', 'No Mule drops below half hull', { bonus: true, passOnWin: true });
    m.on('shipHit', ev => {
      const e = w.byId.get(ev.id);
      if (e && mules.includes(e) && e.hull < e.maxHull * 0.5) m.fail('half');
    });
    m.on('shipKilled', ev => {
      if (!m.flags.mules.includes(ev.id)) return;
      m.fail('all');
      m.say('mule', `${ev.name} is gone! Keep them off the rest of us!`);
      if (T.lost.size >= 2) m.fail('convoy', 'Two Mules were lost: the convoy failed.');
    });

    yield m.say('doukas', 'Lantern, the Mules are yours. Roussanou to the Perpetua, nine kilometres, no detours.');
    yield m.say('mule', 'Mule One to escort. We\'re slow and we\'re full. Don\'t let them near us.');
    m.say('wren', 'Lantern Three on station. Let\'s get these rocks home.');
    m.hint('{wingAttack}: wing attacks your target. {wingCover}: wing covers you.', 9);

    // The rockslide waits for the convoy, however the fighting goes: it
    // falls across the lane as the lead Mule comes within 900 m of it.
    const slide = { boulders: [], rocks: [], done: false };
    m.thread((function* () {
      yield m.until(() => m.dist(lead(), SLIDE) < 900 || T.arrived.size + T.lost.size >= mules.length);
      if (T.arrived.size + T.lost.size >= mules.length) { slide.done = true; return; }
      const across = [dir(ROUTE[2], ROUTE[3])[2], 0, -dir(ROUTE[2], ROUTE[3])[0]];
      for (let k = 0; k < 6; k++) {
        const off = (k - 2.5) * 52;
        const pos = add(SLIDE, [across[0] * off + m.rng.range(-20, 20), m.rng.range(-50, 50), across[2] * off + m.rng.range(-30, 30)]);
        slide.boulders.push(m.spawn('boulder', { pos, name: `Boulder ${k + 1}`, objective: true, fold: false, tags: ['boulder'] }));
      }
      // The rock is Lantern One's to clear: the wing keeps the raiders off
      // unless it is sent at a boulder (1, on the boulder targeted).
      const wing = m.tagged('lantern');
      for (const e of mules) if (e.helm) e.helm.halt = true;
      m.music('combat');
      yield m.say('mule', 'Rockslide in the lane! We can\'t push through that!');
      m.objective('slide', 'Clear the rockslide', { count: { n: 0, of: slide.boulders.length } });
      m.say('doukas', 'Lantern, clear that lane. Breakers would be nice about now.');
      m.hint('The boulders are objectives: {cycleFriendly} selects them, {wingAttack} sends your wing at the one you have.', 9);
      if (w.player.loadout.primary !== 'breaker') m.say('saint', 'Pulse on rock. We\'ll be here a while.');
      slide.rocks = wave(m, 'thorn', m.n(4), add(SLIDE, [500, -300, 400]), { toward: lead(), prefer: 'convoy', fold: false });
      m.say('wren', 'Movement in the rocks — they were waiting for us to stop!');
      yield m.until(() => {
        const left = slide.boulders.filter(e => e.alive).length;
        m.progress('slide', slide.boulders.length - left, slide.boulders.length);
        return left === 0;
      });
      m.complete('slide');
      for (const e of wing) if (e.orders?.type === 'attack' && e.orders.target?.tags?.has('boulder')) e.orders = { type: 'cover' };
      for (const e of mules) if (e.helm) e.helm.halt = false;
      slide.done = true;
      yield m.say('mule', 'Lane\'s clear. Moving!');
    })(), 'slide');

    yield m.wait(20);
    m.music('combat');
    const front = add(lead().ship.pos, dir(ROUTE[1], ROUTE[2]).map(v => v * 1700));
    const raiders = m.n(4), frontCount = Math.ceil(raiders / 2);
    const w1 = wave(m, 'thorn', frontCount, add(front, [300, 200, 0]), { toward: lead(), prefer: 'convoy' });
    // A pincer forces the escort to choose a flank rather than shooting
    // through one queue of raiders. Total strength stays the same.
    const rear = mules.at(-1);
    w1.push(...wave(m, 'thorn', raiders - frontCount, add(rear.ship.pos, [-1100, -180, 500]), { toward: rear, orders: { type: 'attack', target: rear } }));
    yield m.say('saint', 'Split attack! I see the front group — check the last Mule, Lead!');
    yield m.until(() => w1.every(e => !e.alive) || m.time > 120);
    if (!slide.boulders.length) m.music('calm');
    if (w1.every(e => !e.alive)) {
      yield m.say('saint', 'Look at that wreck, Lantern. Under the red paint — that\'s rolled hull plate. Old gauge. Like the Perpetua\'s ribs.');
      m.say('okonkwo', 'Bring me a piece of it. Any piece.');
    }

    // The second wave meets the convoy at the halfway waypoint (or now, if
    // the convoy is already past it).
    const past = e => (e.helm?.index ?? 0) >= 3;
    yield m.until(() => m.dist(lead(), ROUTE[2]) < 500 || past(lead()) || T.arrived.size > 0);
    m.music('combat');
    const w2 = wave(m, 'thorn', m.n(5), m.offscreen(lead(), 1600), { toward: lead(), prefer: 'convoy' });
    m.say('wren', 'More of them, high and to the side!');
    m.hint('Quick kills build a streak.', 6);

    yield m.until(() => slide.done);
    yield m.until(() => [...w2, ...slide.rocks].every(e => !e.alive) || m.time > 400);
    if (m.n(3) >= 3 && T.arrived.size < mules.length) {
      wave(m, 'thorn', m.n(3), m.offscreen(lead(), 1500), { toward: lead(), prefer: 'convoy' });
      m.say('saint', 'More of them — three on the approach!');
    }
    // The home stretch: one more try as the Perpetua comes into view.
    yield m.until(() => m.dist(lead(), ROUTE[4]) < 1800 || T.arrived.size > 0);
    const home = T.arrived.size + T.lost.size < mules.length;
    const last = [];
    if (home) {
      const hard = m.diff.key === 'veteran' || m.diff.key === 'ace';
      last.push(...wave(m, hard ? 'talon' : 'thorn', m.n(hard ? 3 : 2), m.offscreen(lead(), 1500), { toward: lead(), prefer: 'convoy' }));
      m.music('combat');
      m.say('mule', hard ? 'Perpetua in sight — and Talons on our tail! Missiles!' : 'Perpetua in sight — and they\'re coming at us again!');
    }
    yield m.until(() => last.every(e => !e.alive) || T.arrived.size + T.lost.size >= mules.length);
    m.music('calm');
    yield m.until(() => {
      const left = mules.filter(e => e.alive && !T.arrived.has(e.id)).length;
      m.progress('convoy', T.arrived.size, 3);
      return left === 0;
    });
    if (T.arrived.size >= 2) {
      m.complete('convoy');
      if (T.arrived.size === 3) m.complete('all');
      yield m.say('doukas', 'Convoy\'s in. That\'s ore for Varlaam\'s smelters and a great many grateful miners.');
      m.win();
    } else m.fail('convoy', 'Too many Mules were lost.');
  },
});
