/* Mission 9 — The Narrows. Evacuation convoy, with surprises.

   The last transports out of Stefanos — three Skiffs and two Mules, with
   the gunship Vigil — run the Narrows to the Long Mercy. Halfway, Skiff 4
   goes silent: it was boarded at the docks, and its hold is full of Harrow
   seeds. It turns on the convoy and makes for the ark. Then a Mother folds
   in across the route, and the convoy has to divert through denser rock. */

import { defineMission } from '../mission.js';
import { belt, lanesOf } from './belt.js';
import { add, convoy, dir, lerp3, onDeath, tally, wave } from './kit.js';

const ROUTE = [[-3600, 0, 2600], [-2000, 80, 1400], [-500, 0, 300], [800, -60, -900], [2100, 0, -2200], [3200, 40, -3300]];
const DIVERT = [[-500, 0, 300], [-1300, 650, -1200], [-500, 950, -2700], [1300, 800, -3500], [3200, 40, -3300]];
const MERCY = [3700, 60, -3900];
const BLOCK = lerp3(ROUTE[3], ROUTE[4], 0.4);
const START = add(ROUTE[0], [150, 120, -300]);

const FIELD = belt({
  spawn: START, density: 1.5, landmarks: 3,
  clear: [{ pos: MERCY, r: 700 }, { pos: BLOCK, r: 650 }],
  lanes: [...lanesOf(ROUTE, 200), ...lanesOf(DIVERT, 150)],
});

export default defineMission({
  id: 'm09', number: 9, title: 'The Narrows', location: 'Stefanos Narrows', dateline: 'Day 38',
  field: FIELD, fieldSeed: 9099, seed: 909, par: 540, env: 'narrows',
  start: { pos: START, forward: dir(ROUTE[0], ROUTE[1]), speed: 60 },
  area: { centre: [0, 0, 0], radius: 7500 },
  models: ['fighter', 'interceptor', 'talon', 'shuttle', 'freighter', 'halberd', 'mother', 'colony', 'drone'],
  music: 'tension',
  recommend: {
    hull: 'kestrel', primary: 'needle', secondaries: ['swarm', 'hornet'], reactor: 'aegis',
    why: 'Fighters, fighters, fighters, coming at the transports from every side — and at you. Needles land easily, Swarm pods clear packs, and an Aegis reactor keeps your shields up in the crossfire.',
  },
  needs: { fighters: true, intercept: true, endurance: true },
  briefing: {
    stages: [
      { text: 'Stefanos is the last settlement. Its people are aboard three Skiffs and two Mules, and the only way to the Long Mercy is the Narrows: eight kilometres of rock.', focus: ROUTE[1] },
      { text: 'The gunship Vigil escorts them; Lantern Wing rides with the transports. The Harrow know we are leaving. Expect them everywhere.', focus: ROUTE[3] },
      { text: 'At least three transports must reach the Long Mercy. There is no more room anywhere else.', focus: MERCY },
    ],
  },
  map: {
    extent: 9500,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'friend', pos: ROUTE[0], label: 'Convoy' },
      { kind: 'capital', pos: MERCY, label: 'Long Mercy' },
    ],
    routes: [{ path: ROUTE, kind: 'convoy' }],
  },
  objectivesPreview: [
    { text: 'Three transports reach the Long Mercy' },
    { text: 'All loyal transports arrive', bonus: true },
    { text: 'Stop the infiltrator within 30 s of identification', bonus: true },
  ],
  debrief: {
    won: 'The Narrows are behind us and the Long Mercy is as full as she will ever be: forty-one thousand people, three hundred years after the Perpetua brought their ancestors here. Skiff 4 had been boarded at the docks while it loaded; no one aboard survived the boarding. Okonkwo says the seeds in its hold were hours from opening. The drive is ready, or as ready as Okonkwo can make it. One jump left.',
    lost: 'The Narrows took too many. The Long Mercy will fold with empty decks.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'] });
    const ships = convoy(m, [['skiff', 'Skiff 2'], ['mule', 'Mule 5'], ['skiff', 'Skiff 3'], ['skiff', 'Skiff 4'], ['mule', 'Mule 6']], ROUTE, { speed: 48, spacing: 240, then: 'hold', tags: ['convoy'] });
    m.flag('convoy', ships.map(e => e.id));
    const suspect = ships.find(e => e.name === 'Skiff 4');
    suspect.scan = { time: 4, range: 420, progress: 0, done: false, label: 'Skiff 4 cargo manifest' };
    const vigil = m.spawn('halberd', { team: 0, pos: add(ROUTE[0], [250, 140, 250]), forward: dir(ROUTE[0], ROUTE[1]), name: 'Halberd Vigil',
      helm: { path: [add(ROUTE[1], [250, 140, 0]), ...ROUTE.slice(2).map(p => add(p, [220, 140, 0]))], speed: 48, then: 'hold' } });
    m.flag('vigil', vigil.id);
    m.spawn('mercy', { team: 0, pos: MERCY, forward: dir(MERCY, ROUTE[4]), name: 'Long Mercy', fixed: true, invulnerable: true });
    m.nav('mercy', 'Long Mercy', ROUTE[5], { r: 700 });
  },

  *script(m) {
    const w = m.world;
    const ships = m.flags.convoy.map(id => w.byId.get(id));
    const traitor = ships.find(e => e.name === 'Skiff 4');
    const loyal = ships.filter(e => e !== traitor);
    const T = tally(m, loyal);
    const vigil = w.byId.get(m.flags.vigil);
    const lead = () => loyal.find(e => e.alive && !T.arrived.has(e.id)) ?? loyal[0];
    m.on('scanned', ev => {
      if (ev.id !== traitor.id && ev.label !== 'Skiff 4 cargo manifest') return;
      m.flag('identified', true);
      m.say('okonkwo', 'That hold is drawing power through a dead crew compartment. Seeds. I can lock its launch doors — Vigil, you have confirmation.');
    });
    m.objective('arrive', 'Three transports reach the Long Mercy', { count: { n: 0, of: 4 } });
    m.objective('all', 'All loyal transports arrive', { bonus: true });
    for (const s of loyal) onDeath(m, s, () => {
      m.fail('all');
      m.say('doukas', `${s.name} is lost. God rest them.`);
      if (T.lost.size > 1) m.fail('arrive', 'Too many transports were lost in the Narrows.');
    });
    m.thread((function* () { for (;;) { yield m.wait(0.5); m.progress('arrive', T.arrived.size, 4); } })(), 'tally');

    yield m.say('doukas', 'Lantern, Vigil. This is the last convoy. Get them through.');
    m.say('wren', 'Skiff 4 is repeating its docking clearance word for word. Could be a damaged transmitter. Can you get close and check the manifest?');
    m.hint('{cycleFriendly} selects transports. Keep Skiff 4 ahead within 420 m to inspect its hold.', 12);
    m.say('halo', 'Vigil here. Lantern, we\'ll take the big ones. You keep the small ones off the transports.');
    yield m.wait(18);
    m.music('combat');
    wave(m, 'thorn', m.n(4), add(ROUTE[1], [700, 300, -200]), { toward: lead(), prefer: 'convoy' });
    wave(m, 'talon', m.n(1), add(ROUTE[1], [-600, -200, 0]), { toward: m.player });
    yield m.say('saint', 'Contacts, both sides of the lane!');

    // Skiff 4 turns.
    yield m.until(() => m.flags.identified || m.dist(lead(), ROUTE[2]) < 600 || m.time > 150);
    if (traitor.alive) {
      const identified = !!m.flags.identified;
      traitor.scan.done = true;
      traitor.team = 1;
      traitor.tags.delete('convoy');
      traitor.tags.add('traitor');
      // It was spawned as one of ours, toughened (or weakened) by the
      // difficulty's friendly-hull factor; as a Harrow ship it is plain.
      const k = 1 / (w.diff.friendlyHull || 1);
      traitor.maxHull *= k; traitor.hull *= k;
      if (traitor.quad) for (let q = 0; q < traitor.quad.length; q++) traitor.quad[q] *= k;
      traitor.maxShield *= k; traitor.shield *= k;
      // Nobody fires on a Skiff full of our own people on their own say-so:
      // the call is Lantern One's (1 still sends the wing at it).
      traitor.noAutoTarget = !identified;
      // Its stolen engines are pushed harder on the harder settings.
      const run = { recruit: 60, pilot: 72, veteran: 85, ace: 95 }[m.diff.key] ?? 85;
      traitor.helm = { path: [add(MERCY, [0, 0, 500])], index: 0, speed: run * (identified ? 0.65 : 1), arrive: 400, then: 'hold', loop: false, done: false, halt: false };
      traitor.launcher = identified ? null : { cls: 'thorn', interval: 12, max: m.n(3), timer: 4, spawned: [], wave: 1, prefer: 'convoy' };
      // No bays on a Skiff: its hold launches from the hull.
      traitor.launchFromHull = true;
      w.events.push({ type: 'turncoat', id: traitor.id });
      m.objective('traitor', 'Stop Skiff 4 before it docks');
      m.objective('fast', 'Stop the infiltrator within 30 s of identification', { bonus: true });
      const turned = m.time;
      onDeath(m, traitor, () => {
        m.complete('traitor');
        if (m.time - turned <= 30) m.complete('fast'); else m.fail('fast');
        m.say('wren', 'Skiff 4 is down. I… God forgive us.');
        m.say('okonkwo', 'There was no one left aboard. There wasn\'t, Wren.');
      });
      m.on('arrived', ev => { if (ev.id === traitor.id && traitor.alive) m.fail('traitor', 'Skiff 4 reached the Long Mercy with a hold full of seeds.'); });
      m.target(traitor);
      yield m.say('mule', 'Skiff 4 is off the lane — Skiff 4, respond!');
      yield m.say('okonkwo', 'Its transponder changed. It\'s Harrow — boarded at the docks. That hold is full of seeds!');
      yield m.say('halo', identified
        ? 'Manifest confirms a hostile boarding. Vigil engaging; the launch doors are sealed. Good catch, Lantern.'
        : 'Vigil will not fire on a transport without confirmation. Your call, Lantern — your shot.');
      m.hint('Stop Skiff 4: {cycleTarget} selects it, {wingAttack} sends your wing.', 8);
    }

    // The Mother across the route.
    yield m.until(() => m.dist(lead(), ROUTE[3]) < 1500 || m.time > 260);
    m.music('climax');
    const mother = m.spawn('mother', { team: 1, pos: BLOCK, forward: dir(BLOCK, ROUTE[2]), name: 'Mother', fold: true, beamAuto: false });
    mother.launcher = { cls: ['thorn', 'talon'], interval: 25, max: m.n(4), timer: 8, spawned: [], wave: 2, prefer: 'convoy' };
    yield m.say('perpetua', 'Fold flash in the Narrows — Mother-class, right across your route!');
    for (const s of [...loyal, vigil]) {
      if (!s.alive || !s.helm) continue;
      s.helm.path = DIVERT.slice(1).map(p => (s === vigil ? add(p, [200, 120, 0]) : [...p]));
      s.helm.index = 0; s.helm.done = false;
    }
    yield m.say('doukas', 'Convoy, divert — high lane, through the rock. Vigil, cover them. Lantern, keep them alive!');
    m.thread((function* () {
      yield m.wait(6);
      if (mother.alive && vigil.alive) m.beam(mother, vigil);
      yield m.wait(4);
      m.say('halo', 'Vigil taking fire from that beam — we\'re holding!');
      // The beam is for the gunship: a transport would not survive it.
      for (;;) {
        yield m.wait(20);
        if (mother.alive && vigil.alive && m.dist(vigil, mother) < 3400) m.beam(mother, vigil);
      }
    })(), 'beam');

    yield m.until(() => loyal.every(e => !e.alive || T.arrived.has(e.id)));
    if (traitor.alive && traitor.team === 1) yield m.until(() => !traitor.alive || m.failed('traitor'));
    if (T.arrived.size >= 3) {
      m.complete('arrive');
      if (T.arrived.size === loyal.length) m.complete('all');
      m.music('calm');
      yield m.say('ferrante', 'Long Mercy to convoy: we have you. Welcome aboard. Mind the hatches, they\'re still new.');
      m.win();
    } else m.fail('arrive', 'Too many transports were lost in the Narrows.');
  },
});
