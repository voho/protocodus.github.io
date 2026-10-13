/* Mission 6 — The Long Night. Guard the mothership.

   The Perpetua, three thousand refugees aboard and her old engines failing,
   crawls toward the rally point where the Watch's two gunships will meet
   her. Six minutes. The Harrow throw everything they have at her: Thorns,
   Talons and, above all, Mauls. Halfway through, a bomber flight breaks
   out of the rock close aboard. And Okonkwo starts to read the Harrow's
   transponders. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, at, dir, strike, wave } from './kit.js';

const PERPETUA = [0, 0, 1200];
const RALLY = [0, 0, -1600];
const START = [600, 260, -600];
const FIELD = belt({
  spawn: START, density: 0.85, landmarks: 3,
  clear: [{ pos: PERPETUA, r: 1000 }, { pos: RALLY, r: 1000 }],
  lanes: [{ a: PERPETUA, b: RALLY, r: 950 }],
});
const DURATION = 360;

export default defineMission({
  id: 'm06', number: 6, title: 'The Long Night', location: 'Perpetua anchorage', dateline: 'Day 31',
  field: FIELD, fieldSeed: 6066, seed: 606, par: 420,
  start: { pos: START, forward: dir(START, [0, 0, 0]), speed: 80 },
  area: { centre: [0, 0, 0], radius: 6500 },
  models: ['fighter', 'interceptor', 'maul', 'talon', 'perpetua', 'halberd', 'torpedo', 'drone'],
  music: 'tension',
  recommend: {
    hull: 'kestrel', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'aegis',
    why: 'A long fight against everything. Aegis keeps your shields up for six minutes; two banks of Hornets kill Mauls before they line up.',
  },
  needs: { endurance: true, intercept: true, fighters: true },
  briefing: {
    stages: [
      { text: 'The Perpetua\'s engines are three hundred years old and failing. She is carrying Varlaam\'s people to the rally point, where the Halberds Ardent and Vigil will meet her.', focus: PERPETUA },
      { text: 'It will take six minutes. The Harrow know where she is. Expect bombers in numbers: kill the Mauls first, shoot down what they launch.', focus: RALLY },
      { text: 'Half her turrets are dead and Halo wing is one ship. She needs two of her three engines to make the rally point: lose two and she drifts into the rock. Her life is in your hands.', focus: PERPETUA },
    ],
  },
  map: {
    extent: 7000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'capital', pos: PERPETUA, label: 'Perpetua' },
      { kind: 'nav', pos: RALLY, label: 'Rally point' },
      { kind: 'enemy', pos: at(PERPETUA, 270, 3200), label: 'Harrow' }, { kind: 'enemy', pos: at(PERPETUA, 90, 3200), label: 'Harrow' },
    ],
    routes: [{ path: [PERPETUA, RALLY], kind: 'convoy' }],
  },
  objectivesPreview: [
    { text: 'Protect the Perpetua until the fleet arrives (6:00)' },
    { text: 'Keep two of her three engines running' },
    { text: 'Perpetua hull above 75 %', bonus: true },
    { text: 'Destroy every Maul before it fires', bonus: true },
  ],
  debrief: {
    won: 'The Halberds arrived on the minute and the Harrow broke off as if someone had called them home. The Perpetua is scarred but sailing. In the quiet afterwards Okonkwo brought her transcript to the Commander\'s cabin, and they did not come out for three hours.',
    lost: 'The Perpetua went into the rock with three thousand people aboard. There is no worse sentence in the Watch\'s log.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'] });
    // On Ace her crews have patched the engines once more (the Harrow hit
    // harder there, and come in greater numbers).
    const p = m.spawn('perpetua', { team: 0, pos: PERPETUA, forward: [0, 0, -1], name: 'Perpetua', objective: true,
      hullScale: m.diff.key === 'ace' ? 1.8 : 1, helm: { path: [RALLY], speed: 9, then: 'hold' } });
    m.flag('perpetua', p.id);
    // The Mauls go for her engines, and only Lantern really stops them:
    // tuned so that the night is lost when nobody does.
    const engineScale = { pilot: 0.9, veteran: 1.1, ace: 1.17 }[m.diff.key] ?? 1;
    for (const s of p.subsystems) if (s.kind === 'engine') { s.hull *= engineScale; s.maxHull *= engineScale; }
    // Three hundred years old: only some of her guns still work.
    const guns = { recruit: 8, pilot: 5, veteran: 5, ace: 7 }[m.diff.key] ?? 5;
    p.turrets.forEach((t, i) => { if (i >= guns) { t.alive = false; t.hull = 0; } });
    const haloCount = m.diff.key === 'recruit' ? 2 : 1;
    const halo = m.wing('kestrel', haloCount, { names: ['Halo 1', 'Halo 2'], leader: p, pos: add(PERPETUA, [0, 200, -600]), tags: ['halo'] });
    for (const h of halo) { h.orders = null; h.protectId = p.id; h.leaderId = null; }
    m.nav('p', 'Perpetua', PERPETUA, { r: 1200 });
  },

  *script(m) {
    const w = m.world;
    const perpetua = w.byId.get(m.flags.perpetua);
    const engines = perpetua.subsystems.filter(s => s.kind === 'engine');
    const mauls = [];
    let fired = false;
    m.objective('hold', `Protect the Perpetua until the fleet arrives`);
    m.objective('engines', 'Keep two of her three engines running');
    m.objective('hull', 'Perpetua hull above 75 %', { bonus: true, passOnWin: true });
    m.objective('clean', 'Destroy every Maul before it fires', { bonus: true, passOnWin: true });
    m.timer('fleet', 'Fleet arrives', DURATION);
    m.on('shipKilled', ev => { if (ev.id === perpetua.id) m.fail('hold', 'The Perpetua was destroyed.'); });
    m.on('subsystemDestroyed', ev => {
      if (ev.id !== perpetua.id || ev.kind !== 'engine') return;
      const left = engines.filter(s => s.alive).length;
      m.say('perpetua', left >= 2 ? 'Engine down! We can make it on two — not on one!' : 'Second engine gone — we\'re losing way, we\'re drifting!');
      if (left < 2) m.fail('engines', 'The Perpetua lost two engines and drifted into the rock.');
    });
    m.on('shipHit', ev => { if (ev.id === perpetua.id && perpetua.hull < perpetua.maxHull * 0.75) m.fail('hull'); });
    m.on('missileLaunch', ev => {
      if (!ev.torpedo || ev.team !== 1 || fired) return;
      fired = true; m.fail('clean');
    });
    // One more bomber per wave on Pilot: without Lantern in the fight, her
    // engines do not last the night.
    const extra = { pilot: 1 }[m.diff.key] ?? 0;
    const bombers = (n, where, sub, o = {}) => {
      const b = strike(m, 'maul', n + extra, where, perpetua, { sub, ...o });
      mauls.push(...b);
      return b;
    };

    yield m.say('doukas', 'All wings, Perpetua. Six minutes to the rally point. She can\'t run and she can\'t hide. Everything that flies, keep it off her.');
    m.say('halo', 'Halo Lead, on the Perpetua. Glad to have you, Lantern.');
    m.hint('Kill the Mauls first. Torpedoes in flight: B targets them; your guns can shoot them down.', 8);
    yield m.wait(18);
    m.music('combat');
    const port = at(PERPETUA, 280, 3000, 200);
    wave(m, 'thorn', m.n(5), port, { toward: perpetua });
    bombers(m.n(3), add(port, [0, -300, -300]), 'sub_engine_0');
    yield m.say('saint', 'First wave to port: fighters and two bombers!');

    yield m.wait(70);
    const starboard = at(PERPETUA, 95, 3000, -150);
    bombers(m.n(4), starboard, 'sub_engine_1');
    wave(m, 'talon', m.n(2), add(starboard, [0, 200, 0]), { toward: perpetua, orders: { type: 'protect' } }).forEach(t => { t.protectId = mauls.at(-1)?.id; });
    yield m.say('wren', 'Starboard — Mauls with heavy escort. Talons!');
    m.say('okonkwo', 'Talons carry missiles. Watch for the lock warning.');

    yield m.wait(55);
    wave(m, 'thorn', m.n(4), m.offscreen(perpetua, 2600), { toward: perpetua });
    wave(m, 'talon', m.n(2), m.offscreen(m.player, 1800), { toward: m.player });
    m.say('halo', 'More of them. They don\'t stop.');
    yield m.wait(10);
    m.say('okonkwo', 'Commander — their transponders. They\'re broadcasting a registry. It\'s old. It\'s… it\'s formatted like ours.');
    m.say('doukas', 'Later, Doctor.');

    // 3:30 — the ambush from the rocks.
    yield m.until(() => m.time >= 210);
    m.music('climax');
    const close = add(perpetua.ship.pos, [-650, -280, -300]);
    bombers(m.n(3), close, 'sub_engine_2', { fold: false });
    yield m.say('perpetua', 'Proximity alarm — Mauls inside eight hundred metres! They were in the rocks!');
    m.say('doukas', 'Lantern, they\'re on top of us!');

    yield m.wait(60);
    const last = at(PERPETUA, 200, 3100, 300);
    bombers(m.n(4), last, 'sub_engine_0');
    wave(m, 'thorn', m.n(4), add(last, [200, 0, 200]), { toward: perpetua });
    wave(m, 'talon', m.n(2), add(last, [-200, 100, 0]), { toward: perpetua });
    m.say('saint', 'Last push — everything they\'ve got!');

    yield m.until(() => m.timeLeft('fleet') <= 0);
    m.removeTimer('fleet');
    // The fleet arrives; the Harrow break off.
    const ardent = m.spawn('halberd', { team: 0, pos: add(RALLY, [-500, 150, -400]), forward: dir(RALLY, perpetua.ship.pos), name: 'Halberd Ardent', fold: true });
    const vigil = m.spawn('halberd', { team: 0, pos: add(RALLY, [500, -100, -300]), forward: dir(RALLY, perpetua.ship.pos), name: 'Halberd Vigil', fold: true });
    w.events.push({ type: 'arrival', ids: [ardent.id, vigil.id], to: perpetua.id });
    m.music('calm');
    yield m.say('halo', 'Fold flashes at the rally point — it\'s the Halberds! Ardent and Vigil!');
    for (const e of w.entities) if (e.team === 1 && e.alive) m.foldOut(e);
    m.complete('hold');
    if (engines.filter(s => s.alive).length >= 2) m.complete('engines');
    yield m.say('okonkwo', 'They\'re leaving. All of them, at once. Like someone called them home.');
    yield m.say('doukas', 'Well flown, all of you. Lantern — my cabin, when you\'re down. Bring Okonkwo.');
    m.win();
  },
});
