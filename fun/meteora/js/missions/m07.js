/* Mission 7 — Cut the Line. Reverse convoy.

   The Mothers feed on the belt's metal. Their haulers — rock cores cut
   from Roussanou's dead mines, each towed by two Maul tugs — are dragging
   it to a fold point and the Deep Anchorage beyond. Stop them: kill both
   tugs and a hauler drifts; crack the core and it is gone. Wardens escort
   the line, and a bone-white Thorn the pilots call the Ninth Hand hunts
   anyone who tries. When the line is cut, a dying tug's transponder is
   finally read in full. */

import { defineMission } from '../mission.js';
import { belt, lanesOf } from './belt.js';
import { add, dir, lerp3, onDeath, wave } from './kit.js';

const ROUTE = [[-3400, 0, -2800], [-1800, 150, -1200], [-200, -80, 200], [1500, 60, 1500], [3100, 120, 2900]];
const START = [-300, 500, 2000];
const FIELD = belt({
  spawn: START, density: 1.1, landmarks: 3,
  clear: [{ pos: ROUTE[4], r: 400 }, { pos: ROUTE[0], r: 400 }],
  lanes: lanesOf(ROUTE, 230),
});

export default defineMission({
  id: 'm07', number: 7, title: 'Cut the Line', location: 'The Roussanou drag', dateline: 'Day 33',
  field: FIELD, fieldSeed: 7077, seed: 707, par: 540,
  start: { pos: START, forward: dir(START, ROUTE[1]), speed: 80 },
  area: { centre: [0, 0, 0], radius: 7500 },
  models: ['fighter', 'interceptor', 'maul', 'warden', 'talon', 'drone'],
  music: 'tension',
  recommend: {
    hull: 'kestrel', primary: 'ion', secondaries: ['hornet', 'hornet'], reactor: 'hearth',
    why: 'The tugs hide behind heavy shields that come straight back. Ion strips them and scrambles them so they stay down; Hornets finish a bare tug in one hit.',
  },
  needs: { shields: true, fighters: true },
  briefing: {
    stages: [
      { text: 'The Mothers are eating the belt. Haulers — rock cores stripped from Roussanou\'s mines, each towed by two Maul tugs — are dragging our metal toward a fold point and the Deep Anchorage beyond.', focus: ROUTE[0] },
      { text: 'Cut the line. Destroy both tugs and a hauler drifts dead; crack the core itself and it is gone. Stop at least four of the six.', focus: ROUTE[2] },
      { text: 'Wardens escort them: corvettes with turrets, best avoided. And pilots have reported a white Thorn that flies like a person. They call it the Ninth Hand.', focus: ROUTE[3] },
    ],
  },
  map: {
    extent: 9000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'enemy', pos: ROUTE[0], label: 'Haulers' },
      { kind: 'danger', pos: ROUTE[4], label: 'Fold point' }, { kind: 'enemy', pos: ROUTE[2], label: 'Warden' },
    ],
    routes: [{ path: ROUTE, kind: 'hostile' }],
  },
  objectivesPreview: [
    { text: 'Stop at least three of the six haulers (four on Veteran and Ace)' },
    { text: 'Stop all six', bonus: true },
    { text: 'Destroy the Ninth Hand', bonus: true },
  ],
  debrief: {
    won: 'VANGUARD SEVEN. PERPETUA PROGRAM. TASK: PREPARE HABITAT. STATUS: IN PROGRESS. The Harrow are the Vanguard — the fabricators the Perpetua\'s builders sent a century ahead to make a home ready. They found no world, so they began to build one, from the outer belt, and they have been building for two hundred years. To them, we are debris in the construction zone. Okonkwo has found one more thing in the tug\'s memory: where the foreman is. A Mother, at the Deep Anchorage.',
    lost: 'Too many haulers reached the fold point. Somewhere in the dark, a Mother grew heavier.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'], primary: 'wingPulse', prefer: 'tug' });
    m.nav('line', 'The drag', ROUTE[1], { r: 600 });
    m.nav('fold', 'Fold point', ROUTE[4], { r: 400 });
  },

  *script(m) {
    const w = m.world;
    const haulers = [];
    let reached = 0;
    // How fast the haulers are dragged: faster on the harder settings.
    const tow = { recruit: 28, pilot: 32, veteran: 35, ace: 37 }[m.diff.key] ?? 32;
    const launch = (k, offset) => {
      const path = [ROUTE[0], ...ROUTE.slice(1)];
      const pos = add(ROUTE[0], dir(ROUTE[1], ROUTE[0]).map(v => v * offset));
      const h = m.spawn('hauler', {
        team: 1, pos, forward: dir(ROUTE[0], ROUTE[1]), name: `Hauler ${k + 1}`, tags: ['hauler'], objective: true,
        helm: { path: [pos, ...path.slice(1)], speed: tow, then: 'fold' },
      });
      const tugs = [-1, 1].map(side => {
        const t = m.spawn('maul', { team: 1, pos: add(pos, [side * 65, 25, 10]), forward: dir(ROUTE[0], ROUTE[1]), name: `Tug ${k + 1}${side < 0 ? 'a' : 'b'}`,
          tags: ['tug'], leader: h, slot: [side * 65, 25, 10], orders: { type: 'form' }, torpedoes: 0, shieldScale: 8, hullScale: 0.35 });
        t.ignoreId = h.id;
        // Tow emitters: heavy shields over a thin hull that keep charging
        // even under fire, unless Ion scrambles them. Other guns grind them
        // down slowly; a Hornet finishes a bare tug.
        t.shieldRegen = 70; t.shieldDelay = 0;
        return t;
      });
      h.tugs = tugs;
      haulers.push(h);
      onDeath(m, h, () => m.say('saint', `${h.name}'s core is cracked — scratch one!`));
      return h;
    };
    const stopped = h => !h.departed && (!h.alive || h.tugs.every(t => !t.alive));
    const done = () => haulers.filter(stopped).length;
    const need = { recruit: 3, pilot: 3, veteran: 4, ace: 4 }[m.diff.key] ?? 4;
    m.objective('stop', `Stop at least ${need === 3 ? 'three' : 'four'} of the six haulers`, { count: { n: 0, of: 6 } });
    m.objective('all', 'Stop all six', { bonus: true });
    m.objective('ninth', 'Destroy the Ninth Hand', { bonus: true });
    m.on('departed', ev => {
      if (!ev.tags?.includes('hauler')) return;
      reached++;
      m.fail('all');
      m.say('doukas', `A hauler made the fold. ${reached === 1 ? 'Don\'t let it happen again.' : 'We can\'t afford another.'}`);
      if (reached > 6 - need) m.fail('stop', `${reached} haulers reached the fold point.`);
    });

    // Haulers without tugs stop dead; one tug, half speed.
    m.thread((function* () {
      for (;;) {
        yield m.wait(0.25);
        for (const h of haulers) {
          if (!h.alive || !h.helm) continue;
          const live = h.tugs.filter(t => t.alive).length;
          h.helm.speed = live === 2 ? tow : live === 1 ? tow * 0.53 : 0;
          if (live === 0 && !h.disabled) {
            h.disabled = true; h.ship.fa = false;
            h.ship.vel = h.ship.vel.map(v => v * 0.25);
            m.say('wren', `${h.name} is dead in space!`);
          }
        }
        m.progress('stop', done(), 6);
      }
    })(), 'tow');

    yield m.say('doukas', 'Lantern, there\'s the line. Six haulers. Cut it.');
    m.say('okonkwo', 'The tugs are shielded like nothing we\'ve seen on a drone. Strip the shields, then the tug.');
    m.hint('T cycles targets: tugs are Mauls flying beside each rock core. Two dead tugs and the hauler stops.', 9);
    for (let k = 0; k < 3; k++) launch(k, k * 420);
    const warden = m.spawn('warden', { team: 1, pos: add(ROUTE[1], [200, 200, 300]), forward: dir(ROUTE[1], ROUTE[2]), name: 'Warden', tags: ['escort'],
      helm: { path: ROUTE.slice(2), speed: 34, then: 'hold' } });
    m.flag('warden', warden.id);
    wave(m, 'thorn', m.n(3), add(ROUTE[1], [-300, 300, 300]), { toward: m.player });
    m.music('combat');
    yield m.say('saint', 'Corvette on the line, and fighters. Mind those turrets.');

    // The Ninth Hand.
    yield m.wait(70);
    const ninth = m.spawn('ninth', { team: 1, pos: m.offscreen(m.player, 1400), forward: dir(m.offscreen(m.player, 1400), m.player.ship.pos), name: 'Ninth Hand', fold: true, tags: ['ace'] });
    ninth.orders = { type: 'attack', target: w.player };
    ninth.missiles = 4; ninth.missileWeapon = 'barb';
    onDeath(m, ninth, () => { m.complete('ninth'); m.say('saint', 'The white one\'s down! Lantern got the Ninth Hand!'); });
    yield m.say('wren', 'Lantern, the white one — it\'s on you. It\'s fast!');
    m.say('okonkwo', 'It flies like a person. Like it learned from us.');

    // The second half of the line.
    yield m.wait(45);
    for (let k = 3; k < 6; k++) launch(k, (k - 3) * 420);
    wave(m, 'thorn', m.n(3), add(ROUTE[0], [400, 200, 300]), { toward: haulers[3] });
    wave(m, 'talon', m.n(2), add(ROUTE[0], [-300, 0, 500]), { toward: m.player });
    yield m.say('doukas', 'Second group leaving Roussanou. Three more haulers.');

    yield m.until(() => haulers.length === 6 && haulers.every(h => stopped(h) || h.departed));
    if (done() >= need) {
      m.complete('stop');
      if (done() === 6) m.complete('all');
      m.music('calm');
      yield m.say('okonkwo', 'Lantern — that last tug. Its transponder dumped everything as it died. Give me a minute.');
      yield m.wait(4);
      yield m.say('okonkwo', '"Vanguard Seven. Perpetua Program. Task: prepare habitat. Status: in progress."');
      yield m.say('doukas', '…Say again, Doctor?');
      yield m.say('okonkwo', 'They\'re ours. The Harrow are the Vanguard. They never stopped working.');
      m.win();
    } else m.fail('stop', 'Too many haulers got through.');
  },
});
