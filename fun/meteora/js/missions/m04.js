/* Mission 4 — Seedfall. Destroy asteroids.

   The Harrow have seeded the rocks around Varlaam Deep: fabricator growths
   threaded through eight asteroids, each ripening toward the moment it
   splits open and lets out a swarm of Mites. Seeds are armoured stone —
   Breakers and Lances crack them; Pulse fire barely scars them. Ninety
   seconds in, three of them light rocket clusters and start falling toward
   the station. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, at, dir, fmtTime, wave } from './kit.js';

const VARLAAM = [0, 0, 0];
const START = [0, 120, 1500];
const SEEDS = [
  [VARLAAM, 20, 1500, 120], [VARLAAM, 70, 2000, -200], [VARLAAM, 115, 1300, 260], [VARLAAM, 160, 2300, 40],
  [VARLAAM, 205, 1700, -160], [VARLAAM, 250, 2400, 200], [VARLAAM, 300, 1450, -60], [VARLAAM, 340, 2150, 180],
].map(([c, b, d, y]) => at(c, b, d, y));

const FIELD = belt({
  spawn: START, density: 0, landmarks: 0,
  clear: [{ pos: VARLAAM, r: 650 }, ...SEEDS.map(p => ({ pos: p, r: 90 }))],
  lanes: SEEDS.map(p => ({ a: p, b: VARLAAM, r: 70 })),
});

export default defineMission({
  id: 'm04', number: 4, title: 'Seedfall', location: 'Varlaam Deep', dateline: 'Day 27',
  field: FIELD, fieldSeed: 4040, seed: 404, par: 480, env: 'varlaam',
  start: { pos: START, forward: dir(START, SEEDS[0]), speed: 60 },
  area: { centre: VARLAAM, radius: 6000 },
  models: ['fighter', 'interceptor', 'talon', 'mite', 'seed', 'station', 'anvil', 'drone'],
  music: 'tension',
  recommend: {
    hull: 'anvil', primary: 'breaker', secondaries: ['hornet', 'lance'], reactor: 'forge',
    why: 'Seeds are armoured stone. Breakers crack rock at two and a half times their weight and a Lance splits a seed outright; a Forge reactor keeps the Breakers cool. Hornets for the Mites.',
  },
  needs: { rocks: true, armor: true },
  briefing: {
    stages: [
      { text: 'Last night eight asteroids around Varlaam Deep began to glow. Okonkwo calls them seeds: Harrow fabricator growths threaded through the stone, ripening.', focus: VARLAAM },
      { text: 'When a seed is ripe it splits open and lets out a swarm of Mites — small, fast drones. Destroy the seeds before they hatch.', focus: SEEDS[1] },
      { text: 'They are armoured rock. Pulse fire will barely scar them. Bring Breakers, bring Lances. Saint and Wren fly with you; Wren was born on Varlaam.', focus: SEEDS[4] },
    ],
  },
  map: {
    extent: 6500,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'station', pos: VARLAAM, label: 'Varlaam' },
      ...SEEDS.map((p, i) => ({ kind: 'enemy', pos: p, label: `Seed ${i + 1}` })),
    ],
    routes: [],
  },
  objectivesPreview: [
    { text: 'Destroy the eight seeded asteroids' },
    { text: 'Varlaam must survive' },
    { text: 'No seed hatches', bonus: true },
    { text: 'Varlaam takes no impact', bonus: true },
  ],
  debrief: {
    won: 'Varlaam held. The seeds were fused stone and Harrow metal all the way through: Okonkwo found the same machine-script etched into every nodule, the same patient instructions — grow, ripen, open — in a grammar she had seen before, in the Perpetua\'s own fabricator archive, three hundred years old. Throwing three of them at the station was not in any instruction she could read. It was improvisation. That frightened her more than the swarms.',
    lost: 'Varlaam took one rock too many. The Watch pulled the survivors out through the wreckage, and the seeds kept ripening.',
  },

  setup(m) {
    // Saint and Wren fly Pulse Kestrels today: they keep the Thorns and
    // Mites off you, and the seeds are yours to crack.
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'], primary: 'wingPulse' });
    m.spawn('varlaam', { team: 0, pos: VARLAAM, forward: [0, 0, -1], name: 'Varlaam', objective: true });
    const diffTime = { recruit: 1.35, pilot: 1.1, veteran: 0.85, ace: 0.7 }[m.diff.key] ?? 1;
    // Older growths on the harder settings: thicker stone, quicker to ripen.
    const hullScale = { recruit: 0.85, pilot: 1, veteran: 1.15, ace: 1.3 }[m.diff.key] ?? 1;
    const seeds = SEEDS.map((pos, i) => m.spawn('seed', {
      team: 1, pos, forward: m.rng.unit([0, 0, 0]), name: `Seed ${i + 1}`, objective: true, tags: ['seed'], hullScale,
      hatch: { in: (150 + i * 15 + m.rng.range(0, 20)) * diffTime, cls: 'mite', count: m.n(5) },
    }));
    m.flag('seeds', seeds.map(e => e.id));
    m.nav('v', 'Varlaam', VARLAAM, { r: 800 });
  },

  *script(m) {
    const w = m.world;
    const seeds = m.flags.seeds.map(id => w.byId.get(id));
    const varlaam = m.get('Varlaam');
    let impacts = 0;
    m.objective('seeds', 'Destroy the seeded asteroids', { count: { n: 0, of: seeds.length } });
    m.objective('station', 'Varlaam must survive');
    m.objective('nohatch', 'No seed hatches', { bonus: true, passOnWin: true });
    m.objective('noimpact', 'Varlaam takes no impact', { bonus: true, passOnWin: true });
    m.on('shipKilled', ev => { if (ev.id === varlaam.id) m.fail('station', 'Varlaam was destroyed.'); });
    m.on('hatch', ev => {
      m.fail('nohatch');
      m.music('combat');
      m.say(m.rng.next() < 0.5 ? 'saint' : 'wren', `${ev.name} just split open — Mites, a whole swarm!`);
    });
    const destroyed = () => seeds.filter(e => !e.alive).length;

    yield m.say('varlaam', 'Lantern, Varlaam Control. The rocks around us started glowing last night. We count eight.');
    yield m.say('okonkwo', 'Seeds. Fabricator nodes grown into the stone. When they\'re ripe, they open.');
    yield m.say('doukas', 'Then don\'t let them ripen. Lantern Wing, weapons free.');
    m.say('saint', 'Our Pulse guns won\'t dent that stone, Lead. You crack the rocks — Wren and I keep the Thorns off you.');
    m.hint('Seeds are targets ({cycleTarget}). Breakers and Lances crack them.', 9);
    // A few Thorns guard the garden.
    m.thread((function* () {
      yield m.wait(25);
      wave(m, 'thorn', m.n(3), m.offscreen(m.player, 1500), { toward: m.player });
      if (m.diff.key === 'veteran' || m.diff.key === 'ace') {
        // The garden has keepers: Talons on the far seeds.
        yield m.wait(20);
        const far = [...SEEDS].sort((a, b) => m.dist(m.player, b) - m.dist(m.player, a))[0];
        wave(m, 'talon', m.n(2), add(far, [0, 250, 0]), { toward: m.player });
        m.say('wren', 'Talons on the far rocks — they\'re guarding them!');
        yield m.wait(40);
      } else yield m.wait(60);
      wave(m, 'thorn', m.n(3), m.offscreen(varlaam, 1800), { toward: varlaam });
      yield m.wait(55);
      wave(m, m.diff.key === 'ace' || m.diff.key === 'veteran' ? 'talon' : 'thorn', m.n(3), m.offscreen(m.player, 1600), { toward: m.player });
    })(), 'guards');
    m.thread((function* () {
      for (;;) {
        yield m.wait(0.5);
        m.progress('seeds', destroyed(), seeds.length);
      }
    })(), 'tally');

    // The surprise: three seeds fall on Varlaam.
    yield m.until(() => m.time >= 78 || destroyed() === seeds.length);
    if (seeds.some(e => e.alive && !e.hatched)) {
      m.say('okonkwo', 'Thermal spikes on the outer seeds. Those are thrusters, not growths. Twelve seconds to ignition!');
      m.timer('ignition', 'Seed ignition', 12);
    }
    yield m.until(() => m.time >= 90 || destroyed() === seeds.length);
    m.removeTimer('ignition');
    const movers = seeds.filter(e => e.alive && !e.hatched).sort((a, b) => m.dist(b, varlaam) - m.dist(a, varlaam)).slice(0, 3);
    if (movers.length) {
      m.music('climax');
      const speed = { recruit: 16, pilot: 18, veteran: 20, ace: 23 }[m.diff.key] ?? 20;
      for (const s of movers) {
        s.fixed = false;
        s.tags.add('falling');
        s.helm = { path: [[...VARLAAM]], index: 0, speed, arrive: 330, then: 'hold', loop: false, done: false, halt: false };
        s.burning = true;
      }
      yield m.say('varlaam', `${movers.length} seeds just lit engines — they are falling on us!`);
      m.say('okonkwo', 'They\'re throwing rocks at us. Simple. Effective.');
      m.say('wren', 'Not my home. Not today.');
      m.objective('fall', 'Stop the seeds falling on Varlaam', { count: { n: 0, of: movers.length } });
      m.on('arrived', ev => {
        const s = movers.find(x => x.id === ev.id);
        if (!s || !s.alive) return;
        impacts++;
        m.fail('noimpact');
        w.events.push({ type: 'impact', id: s.id, pos: [...s.ship.pos] });
        m.world.damage(varlaam, 5200, [...s.ship.pos], null, { weapon: { pierce: 1, shieldMul: 1, hullMul: 1 } });
        s.hull = 0; s.alive = false; s.lastHitBy = null;
        m.say('varlaam', impacts === 1 ? 'Impact! Decks four through nine are open to space —' : 'Second impact — we can\'t take another!');
        if (impacts >= 2) m.fail('station', 'Varlaam could not survive a second impact.');
      });
      m.thread((function* () {
        // A countdown to the next impact, from the nearest falling seed.
        let clock = null;
        for (;;) {
          const live = movers.filter(s => s.alive);
          if (live.length) {
            const eta = Math.min(...live.map(s => Math.max(0, (m.dist(s, varlaam) - 330) / Math.max(1, s.helm?.speed ?? 20))));
            clock ??= m.timer('impact', 'Next impact', eta);
            clock.left = eta;
          }
          yield m.wait(0.5);
          const stopped = movers.filter(s => !s.alive).length;
          m.progress('fall', stopped, movers.length);
          if (stopped === movers.length) { m.removeTimer('impact'); m.complete('fall'); return; }
        }
      })(), 'fall');
    }

    yield m.until(() => destroyed() === seeds.length);
    m.complete('seeds');
    yield m.until(() => w.entities.every(e => e.team !== 1 || !e.alive) || m.time > 900);
    m.complete('station');
    m.music('calm');
    yield m.say('varlaam', 'Lantern… thank you. Every candle in the chapel is lit for you tonight.');
    m.win();
  },
});
