/* Special operation — The Well. Pull survivors out of a falling convoy.

   Pindus has a dead companion: a black hole, ten astronomical units out,
   the reason the belt is rubble and not a world. The Roussanou convoy
   folded for the Long Mercy and came out on top of it — Harrow anchors
   caught the fold in flight and dropped it there. The ships are broken
   hulks now, falling, with people in them. Lantern Wing folds in after
   them: match each hulk's fall, hold the nose on it while a fold beacon
   latches (a few seconds), and a Tender pulls it through. The hulks fall
   on their own clocks — the ones that came out with a little sideways
   speed swing in on long arcs and last longer — so the order is a choice.

   Everything here falls (well.js): the hulks, the debris, the Harrow who
   came to watch, and Lantern One, whose flight computer holds the ship
   against the pull until the pull outgrows the engines. Below the point of
   no return, nothing climbs back out.

   It is a special operation, outside the campaign's ten missions: it opens
   once Mission 8 is won and falls, in the story, between the foreman's
   death and the Narrows. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { at, dir, onDeath, wave } from './kit.js';

const HOLE = [0, 0, 0];
const START = at(HOLE, 0, 24500, 1500);
const WELL = { pos: HOLE, rs: 1500, gm: 1.46e8, disk: { normal: [0.2, 1, 0.1], inner: 3, outer: 14, gain: 2.2 } };
// Nothing out here but the hole, what falls into it and what came to watch.
const FIELD = belt({ spawn: START, density: 0, landmarks: 0 });
// Where each hulk came out of the fold, and how much sideways speed it kept
// (a share of a circular orbit's): [class, name, souls, bearing, km, y, share].
// Fall times run from about a minute and a half to six and a half.
const HULKS = [
  ['skiff', 'Skiff 12', 18, -25, 11.5, 600, 0.23],
  ['mule', 'Mule 7', 31, 20, 13, -400, 0.46],
  ['skiff', 'Skiff 9', 22, -55, 15.5, 900, 0.36],
  ['mule', 'Mule 4', 40, 45, 16.5, -700, 0.5],
  ['skiff', 'Skiff 15', 17, -10, 18, 1200, 0.53],
  ['mule', 'Mule 11', 36, 70, 19, 300, 0.59],
  ['skiff', 'Skiff 6', 24, -75, 21, -900, 0.59],
  ['mule', 'Mule 2', 44, 30, 22.5, 500, 0.6],
];
const NEED = { recruit: 4, pilot: 5, veteran: 5, ace: 5 };
// How long a beacon takes to latch: the harder the setting, the longer
// you must match a hulk's fall.
const LATCH = { recruit: 2.5, pilot: 3, veteran: 3.5, ace: 4 };

const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export default defineMission({
  id: 'm11', number: 0, special: true, after: 'm08', title: 'The Well', location: 'The Well, Pindus\'s dead companion', dateline: 'Day 37',
  field: FIELD, fieldSeed: 1111, seed: 1111, par: 480, env: 'well', well: WELL,
  start: { pos: START, forward: dir(START, HOLE), speed: 60 },
  area: { centre: HOLE, radius: 30000 },
  models: ['fighter', 'freighter', 'shuttle', 'interceptor', 'talon', 'drone'],
  music: 'tension',
  soundtrack: 'gravity',
  recommend: {
    hull: 'swift', primary: 'needle', secondaries: ['hornet'], reactor: 'forge',
    why: 'Speed. The hulks fall faster the deeper they get, and you will have to match them: the Swift is the quickest thing we fly, and a Forge keeps its afterburner burning.',
  },
  needs: { speed: true },
  briefing: {
    stages: [
      { text: 'The Roussanou convoy folded for the Long Mercy an hour ago and never arrived. Okonkwo found its trace: Harrow anchors caught the fold in flight and dropped it on the Well.', focus: HOLE },
      { text: 'The Well is Pindus\'s dead companion — a black hole. The convoy is broken hulks now, and every one of them is falling. There are people aboard eight of them.', focus: HOLE },
      { text: 'Match a hulk\'s fall and hold your nose on it for a few seconds: a fold beacon latches and a Tender pulls them through. The deeper they are, the faster they fall. Choose.', focus: START },
      { text: 'Watch the pull. Below the red line nothing we fly climbs back out — not even you. I will not lose you to a hole in the sky, Lantern.', focus: HOLE },
    ],
  },
  map: {
    extent: 52000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'capital-enemy', pos: HOLE, label: 'The Well' },
      ...HULKS.map(([, name, , b, km, y]) => ({ kind: 'capital', pos: at(HOLE, b, km * 1000, y), label: name })),
    ],
    routes: [],
  },
  objectivesPreview: [
    { text: 'Rescue the survivors of at least five hulks' },
    { text: 'Do not fall into the Well' },
    { text: 'Rescue all eight', bonus: true },
    { text: 'Saint and Wren come home', bonus: true },
  ],
  debrief: {
    won: 'The Tenders brought the hulks they reached back out of the Well, full of people who had already said their goodbyes. From outside, the ones we could not reach are still falling, slower and redder, and will be for ever; from inside, it was over in a moment. Okonkwo has said one thing since. The Harrow did not wreck that convoy: they caught its fold in flight and threw it. The Long Mercy will get one jump, and it had better be fast.',
    lost: 'The Well kept them. Somewhere above the horizon the Roussanou convoy is still falling, and will be, as far as anyone outside can see, for ever.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'] });
    const well = m.world.well;
    const n = unit(WELL.disk.normal);
    const hulks = HULKS.map(([cls, name, souls, bearing, km, y, share]) => {
      const pos = at(HOLE, bearing, km * 1000, y);
      const side = unit(cross(n, pos));
      const e = m.spawn(cls, {
        team: 0, pos, forward: side, name, objective: true, disabled: true, invulnerable: true, tags: ['hulk'],
        scan: { time: LATCH[m.diff.key] ?? 3, range: 240, label: `Beacon: ${name}` },
      });
      e.ship.fa = false;
      e.ship.vel = side.map(v => v * share * well.circular(Math.hypot(...pos)));
      // A slow tumble: these are wrecks.
      e.ship.w = [0.03, -0.02, 0.05];
      e.souls = souls;
      return e;
    });
    m.flag('hulks', hulks.map(e => e.id));
    // Debris of the convoy, falling with it.
    for (let k = 0; k < 6; k++) {
      const pos = at(HOLE, -60 + k * 24, (12 + k * 1.8) * 1000, (k % 2 ? 1 : -1) * 500);
      const e = m.spawn('wreck', { team: -1, pos, forward: [0, 1, 0], name: 'Wreckage', untargetable: true, disabled: true });
      e.fixed = false;
      e.ship.fa = false;
      e.ship.vel = unit(cross(n, pos)).map(v => v * 0.4 * well.circular(Math.hypot(...pos)));
      e.ship.w = [0.05, 0.04, -0.03];
    }
    m.nav('out', 'Fold point', START, { r: 1600, hidden: true });
  },

  *script(m) {
    const w = m.world;
    const hulks = m.flags.hulks.map(id => w.byId.get(id));
    const need = NEED[m.diff.key] ?? 5;
    let saved = 0, lost = 0, souls = 0;
    m.objective('rescue', `Rescue the survivors of at least ${need} hulks`, { count: { n: 0, of: hulks.length } });
    m.objective('fall', 'Do not fall into the Well');
    m.objective('all', 'Rescue all eight', { bonus: true });
    m.objective('wing', 'Saint and Wren come home', { bonus: true, passOnWin: true });
    for (const name of ['Saint', 'Wren']) { const e = m.get(name); if (e) onDeath(m, e, () => m.fail('wing')); }
    m.on('lost', ev => {
      if (ev.id === w.player.id) m.fail('fall', 'Lantern One fell into the Well.');
      if (ev.name === 'Saint' || ev.name === 'Wren') m.fail('wing');
    });

    // A latched beacon: the Tender's fold takes the hulk through.
    m.on('scanned', ev => {
      const e = hulks.find(h => h.id === ev.id);
      if (!e || !e.alive) return;
      saved++; souls += e.souls;
      m.progress('rescue', saved, hulks.length);
      m.foldOut(e);
      m.say('convoy', `${e.name}, coming through! ${e.souls} aboard — God bless you, Lantern!`);
    });
    m.on('lost', ev => {
      const e = hulks.find(h => h.id === ev.id);
      if (!e) return;
      lost++;
      m.say('okonkwo', [`${e.name} is gone. Its beacon didn't stop — it just stretched, and stretched.`, `We've lost ${e.name}. From out here it'll be falling for ever.`, `${e.name}'s gone over the horizon.`][lost % 3]);
      if (lost > hulks.length - need) m.fail('rescue', `${lost} hulks were lost to the Well.`);
    });

    yield m.say('doukas', 'Lantern, Perpetua. Eight hulks are still sending. Get them out of there.');
    // The nearest hulk to start with: the scope has no hostiles to show yet.
    m.target(hulks.slice().sort((a, b) => m.dist(m.player, a) - m.dist(m.player, b))[0]);
    yield m.say('okonkwo', 'Every one of them is falling, faster the deeper it gets. Match its fall, keep your nose on it till the beacon latches. The Tenders do the rest.');
    m.hint('{cycleFriendly} picks a hulk. {toggleSpeedLock} matches its speed. Hold your nose on it while the beacon latches.', 12);
    yield m.wait(4);
    m.hint('The gauge over your speed is the Well\'s pull against your engines. Below the red line nothing climbs back out.', 11);

    // They came to watch it fall.
    yield m.until(() => m.time > 45);
    m.music('combat');
    wave(m, 'thorn', m.n(4), m.offscreen(m.player, 2200), { toward: m.player });
    yield m.say('saint', 'Contacts! Thorns — they came to watch!');
    m.say('okonkwo', 'They feel the pull too. Lead them down and let the Well have them.');
    yield m.until(() => m.time > 165);
    wave(m, 'thorn', m.n(3), m.offscreen(m.player, 2400), { toward: m.player });
    wave(m, 'talon', m.n(2), m.offscreen(m.player, 2600), { toward: m.player });
    yield m.say('wren', 'More of them, high and behind!');

    // Every hulk saved or gone: now get clear.
    yield m.until(() => hulks.every(h => !h.alive || h.departed));
    if (saved >= need) m.complete('rescue');
    if (saved === hulks.length) m.complete('all');
    m.music('calm');
    yield m.say('doukas', saved >= need ? `That's ${souls} people, Lantern. Now get yourself out of there.` : 'Lantern, come home.');
    m.objective('out', 'Climb to the fold point');
    m.showNav('out');
    yield m.until(() => m.near(m.player, m.navPoint('out').pos, 1600));
    m.complete('out');
    m.complete('fall');
    yield m.say('saint', 'Never again, Lantern. Never, ever again.');
    m.win();
  },
});
