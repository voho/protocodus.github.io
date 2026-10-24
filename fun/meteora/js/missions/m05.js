/* Mission 5 — Hold Varlaam. Guard a base.

   Varlaam is being evacuated: six Skiffs, every soul on the rock, launching
   one at a time and running for the Perpetua's fold point. The Harrow go
   for the shuttles and then, for the first time, they bring bombers —
   Mauls with Spike torpedoes, lining up on the station's reactor. Near the
   end Wren is crippled and has to be covered until a Tender reaches her. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, at, dir, onDeath, strike, wave } from './kit.js';

const VARLAAM = [0, 0, 0];
const FOLD = [2600, 300, 1800];
const START = [-300, 200, -1300];

const FIELD = belt({
  spawn: START, density: 0, landmarks: 0,
  clear: [{ pos: VARLAAM, r: 650 }, { pos: FOLD, r: 300 }],
  lanes: [{ a: VARLAAM, b: FOLD, r: 200 }],
});

export default defineMission({
  id: 'm05', number: 5, title: 'Hold Varlaam', location: 'Varlaam Deep', dateline: 'Day 30',
  field: FIELD, fieldSeed: 4041, seed: 505, par: 420, env: 'varlaamLate',
  start: { pos: START, forward: dir(START, VARLAAM), speed: 40 },
  area: { centre: VARLAAM, radius: 6000 },
  models: ['fighter', 'interceptor', 'maul', 'talon', 'station', 'shuttle', 'torpedo', 'swift', 'drone'],
  music: 'tension',
  recommend: {
    hull: 'swift', primary: 'needle', secondaries: ['swarm'], reactor: 'forge',
    why: 'Bombers are slow and tough and must die before they launch. A Swift gets there first, Needles shred their escorts and two Swarm salvos take a Maul apart; a Forge keeps you burning.',
  },
  needs: { intercept: true, fighters: true },
  briefing: {
    stages: [
      { text: 'Varlaam is coming home with us. Six Skiffs will carry everyone on the rock to the Perpetua\'s fold point, one at a time, thirty-five seconds apart.', focus: VARLAAM },
      { text: 'The Harrow will come for the shuttles. Okonkwo expects something new: the Mother in the Deep was building heavier frames. Bombers.', focus: FOLD },
      { text: 'The approach has been swept clear for evacuation: open sight lines, no rock cover. Hold the door until the last Skiff is away. Torpedoes in flight can be shot down — B targets the nearest one.', focus: VARLAAM },
    ],
  },
  map: {
    extent: 6500,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'station', pos: VARLAAM, label: 'Varlaam' },
      { kind: 'nav', pos: FOLD, label: 'Fold point' }, { kind: 'unknown', pos: at(VARLAAM, 300, 3000), label: '?' },
    ],
    routes: [{ path: [VARLAAM, FOLD], kind: 'convoy' }],
  },
  objectivesPreview: [
    { text: 'Hold Varlaam until it is evacuated' },
    { text: 'At least four of six Skiffs escape' },
    { text: 'All six Skiffs escape', bonus: true },
    { text: 'No torpedo strikes Varlaam', bonus: true },
  ],
  debrief: {
    won: 'Varlaam is empty. The survivors sleep in the Perpetua\'s holds and corridors, and behind them is a rock with its lights still burning. The Harrow have bombers now. Every pilot in the Watch has seen the gun-camera footage of the Mauls lining up, and nobody is joking about red eyes any more. Okonkwo watches a different half-second of it, over and over: the Perpetua\'s beacon sweeping the formation, and every bomber checking its run.',
    lost: 'Varlaam fell with people still aboard. The Watch will remember the names.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'] });
    // The harder settings send a third strike; Varlaam's crews have had
    // longer to brace the reactor (it still takes only a handful of hits).
    const hullScale = { pilot: 1.07, veteran: 1.3, ace: 1.55 }[m.diff.key] ?? 1;
    const v = m.spawn('varlaam', { team: 0, pos: VARLAAM, forward: [0, 0, -1], name: 'Varlaam', objective: true, hullScale });
    m.flag('varlaam', v.id);
    m.nav('fold', 'Fold point', FOLD, { r: 350 });
    m.nav('v', 'Varlaam', VARLAAM, { r: 800 });
  },

  *script(m) {
    const w = m.world;
    const varlaam = w.byId.get(m.flags.varlaam);
    const skiffs = [];
    const escaped = () => skiffs.filter(s => s.departed).length;
    const lost = () => skiffs.filter(s => !s.alive && !s.departed).length;
    m.objective('station', 'Hold Varlaam until it is evacuated');
    m.objective('skiffs', 'At least four of six Skiffs escape', { count: { n: 0, of: 6 } });
    m.objective('allskiffs', 'All six Skiffs escape', { bonus: true });
    m.objective('notorp', 'No torpedo strikes Varlaam', { bonus: true, passOnWin: true });
    m.on('shipKilled', ev => { if (ev.id === varlaam.id) m.fail('station', 'Varlaam was destroyed with people still aboard.'); });
    // Hits on the station: the bonus goes at the first; the radio speaks at
    // most every twenty seconds, never twice the same way, and not once the
    // evacuation is over.
    const IMPACT = ['Torpedo impact! Reactor shielding is buckling!', 'Another hit — the reactor housing is cracking!', 'We can\'t take many more of those!', 'Reactor temperature climbing — keep them off us!'];
    let impacts = 0, impactSaid = -99, evacuated = false;
    m.on('missileExplode', ev => {
      if (!ev.torpedo || ev.targetId !== varlaam.id) return;
      m.fail('notorp');
      if (evacuated || m.world.mission.outcome || m.time - impactSaid < 20) return;
      impactSaid = m.time;
      m.say('varlaam', IMPACT[Math.min(impacts++, IMPACT.length - 1)]);
    });
    const reactor = varlaam.subsystems.find(s => s.kind === 'reactor');
    m.on('subsystemDestroyed', ev => {
      if (ev.id === varlaam.id && ev.kind === 'reactor') {
        varlaam.hull = 0; varlaam.alive = false;
        m.fail('station', 'Varlaam\'s reactor went up.');
      }
    });

    yield m.say('doukas', 'Varlaam is coming home with us. Six Skiffs, every soul on that rock. You hold the door, Lantern.');
    m.say('varlaam', 'First Skiff is boarding. God keep you, Lantern.');

    // The evacuation: a Skiff every thirty-five seconds.
    m.thread((function* () {
      for (let k = 0; k < 6; k++) {
        yield m.wait(k === 0 ? 12 : 35);
        const bay = add(VARLAAM, at([0, 0, 0], 52, 300, 20));
        const s = m.spawn('skiff', {
          team: 0, pos: bay, forward: dir(bay, FOLD), name: `Skiff ${k + 1}`, tags: ['skiff', 'convoy'], objective: true,
          helm: { path: [add(bay, dir(bay, FOLD).map(v => v * 400)), FOLD], speed: 85, then: 'fold' },
        });
        s.ship.vel = dir(bay, FOLD).map(v => v * 40);
        skiffs.push(s);
        onDeath(m, s, () => {
          m.fail('allskiffs');
          m.say('varlaam', `${s.name} is gone. Oh God — ${s.name} is gone.`);
          if (lost() > 2) m.fail('skiffs', 'Too many Skiffs were lost.');
        });
        m.say('varlaam', `${s.name} away.`);
      }
    })(), 'evac');
    m.thread((function* () {
      for (;;) { yield m.wait(0.5); m.progress('skiffs', escaped(), 6); }
    })(), 'tally');

    // Raiders for the shuttles.
    yield m.wait(22);
    m.music('combat');
    wave(m, 'thorn', m.n(4), add(FOLD, [600, 200, -800]), { toward: FOLD, prefer: 'skiff' });
    yield m.say('saint', 'Raiders on the fold lane — they want the Skiffs!');

    // The bombers.
    yield m.wait(30);
    // Far enough out that a fast pilot can catch them before they launch.
    const from = at(VARLAAM, 290, 4200, 300);
    const mauls = strike(m, 'maul', m.n(3), from, varlaam, { sub: 'sub_reactor', spread: 220 });
    const talons = wave(m, 'talon', m.n(2), add(from, [200, 100, 200]), { toward: varlaam, orders: { type: 'protect' } });
    for (const t of talons) t.protectId = mauls[0].id;
    m.music('climax');
    yield m.say('saint', 'Big ones — bombers! They\'re lining up on the station!');
    m.say('okonkwo', 'Their torpedoes can be shot down. B targets the nearest one. And kill the bombers before they fire!');
    // The first clue that the Harrow still know their makers.
    m.thread((function* () {
      yield m.wait(9);
      if (!mauls.some(e => e.alive)) return;
      yield m.say('perpetua', 'Perpetua sweeping the lane with the nav beacon. Painting them for you.');
      yield m.say('saint', 'Did you see that? They flinched. Every bomber, when the beacon touched it.');
      m.say('okonkwo', 'Machines don\'t flinch. Keep shooting — I\'ll think about it later.');
    })(), 'flinch');
    m.hint('{targetTorpedo} targets the nearest torpedo. Shoot it down.', 8);
    m.objective('mauls', 'Destroy the bombers', { count: { n: 0, of: mauls.length } });
    m.thread((function* () {
      for (;;) {
        yield m.wait(0.5);
        const dead = mauls.filter(e => !e.alive).length;
        m.progress('mauls', dead, mauls.length);
        if (dead === mauls.length) { m.complete('mauls'); return; }
      }
    })(), 'mauls');

    // A second strike and more raiders while the last Skiffs go.
    yield m.wait(70);
    wave(m, 'thorn', m.n(4), m.offscreen(varlaam, 2200), { toward: FOLD, prefer: 'skiff' });
    strike(m, 'maul', m.n(2), at(VARLAAM, 120, 4000, -200), varlaam, { sub: 'sub_reactor' });
    m.say('wren', 'Second bomber group, low on the far side!');
    if (m.diff.key === 'veteran' || m.diff.key === 'ace') {
      m.thread((function* () {
        yield m.wait(40);
        strike(m, 'maul', m.n(2), at(VARLAAM, 20, 4000, 400), varlaam, { sub: 'sub_reactor' });
        wave(m, 'talon', m.n(2), at(VARLAAM, 30, 3000, 500), { toward: varlaam });
        m.say('saint', 'Third strike, high! Talons with them!');
      })(), 'third');
    }

    // Wren is crippled.
    yield m.until(() => skiffs.length >= 5);
    const wren = m.get('Wren');
    if (wren?.alive) {
      wren.disabled = true;
      wren.unkillable = true;
      wren.hull = Math.min(wren.hull, wren.maxHull * 0.3);
      // Engines dead: she coasts, tumbling, on what is left of her momentum.
      wren.ship.fa = false; wren.ship.throttle = 0;
      const v = Math.hypot(...wren.ship.vel) || 1;
      wren.ship.vel = wren.ship.vel.map(c => c / v * 18);
      wren.ship.w = [0.25, 0.1, 0.7];
      w.events.push({ type: 'disabled', id: wren.id });
      yield m.say('wren', 'I\'m hit — I can\'t steer — Lantern!');
      m.objective('wren', 'Cover Wren until the Tender reaches her', { bonus: true });
      const hunters = wave(m, 'thorn', m.n(3), m.offscreen(wren, 1400), { toward: wren, prefer: 'wren' });
      wren.tags.add('wren');
      m.order(hunters, { type: 'attack', target: wren });
      const tender = m.spawn('tender', { team: 0, pos: add(VARLAAM, [0, 280, 0]), forward: dir(VARLAAM, wren.ship.pos), name: 'Tender' });
      tender.tender = { patientId: wren.id, state: 'approach', t: 0, restock: 0, goal: null };
      tender.ignoreId = wren.id;
      m.say('varlaam', 'Tender launching for Lantern Three. Thirty seconds.');
      let ejected = false;
      m.on('shipHit', ev => { if (ev.id === wren.id && wren.hull <= 1.01 && !ejected) { ejected = true; m.fail('wren'); m.say('wren', 'Ejecting — I\'m out, I\'m out!'); } });
      yield m.until(() => tender.tender.state === 'docked' || tender.tender.state === 'leave' || !tender.alive || m.time > 600);
      if (!ejected && tender.alive) {
        m.complete('wren');
        m.say('wren', 'Tender\'s got me. Thanks for coming back for me.');
      } else if (!tender.alive) {
        m.fail('wren');
      }
      yield m.wait(4);
      wren.disabled = false; wren.ship.fa = true; wren.ship.w = [0, 0, 0];
    }

    yield m.until(() => skiffs.length === 6 && skiffs.every(s => !s.alive || s.departed));
    evacuated = true;
    if (escaped() >= 4) {
      m.complete('skiffs');
      if (escaped() === 6) m.complete('allskiffs');
      m.complete('station');
      m.flag('evacuated', escaped());
      m.flag('wrenRescued', m.done('wren'));
      m.music('calm');
      yield m.say('varlaam', 'Last Skiff clear. Varlaam is… empty. Thank you, Lantern Wing.');
      m.win();
    } else m.fail('skiffs', 'Too many Skiffs were lost.');
  },
});
