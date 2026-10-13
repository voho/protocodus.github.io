/* Mission 3 — Deep Signal. Recon.

   Alone in the Kalavryta Deep, where the belt is too thick for anyone to
   live. Three signals to scan without the Harrow's Eyes noticing — they
   see heat, speed and gunfire, and a rock between you and an Eye hides you
   completely. The third signal is a Mother, asleep. It wakes. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, at, dir, fmtTime, wave } from './kit.js';

const START = [0, 0, 1800];
const SIG_A = [-1300, 120, -600];
const SIG_B = [1100, -180, -1900];
const SIG_C = [-200, 260, -4300];
const EXTRACT = [2600, 0, 2600];

const FIELD = belt({
  spawn: START, density: 1.45, landmarks: 5,
  clear: [{ pos: SIG_C, r: 680 }, { pos: SIG_A, r: 220 }, { pos: EXTRACT, r: 300 }],
});

// Patrol loops (centre, radius) for the harder settings: between A and B,
// between B and C, and on the way in to A.
// (Each loop is clear of the belt's rocks: a sentry's helm does not steer
// round them.)
const PATROLS = [[[-580, 30, -1190], 420], [[450, 40, -3100], 500], [[-900, 100, 300], 400]];
const EYES = [
  [SIG_A, 30, 520], [SIG_A, 200, 600], [SIG_B, 90, 380], [SIG_B, 260, 560], [SIG_B, 10, 820],
  [SIG_C, 120, 900], [SIG_C, 240, 900], [SIG_C, 0, 1000], [[0, 0, -1200], 0, 300], [[-600, 0, -2600], 40, 200],
];

export default defineMission({
  id: 'm03', number: 3, title: 'Deep Signal', location: 'Kalavryta Deep', dateline: 'Day 24',
  field: FIELD, fieldSeed: 777, seed: 303, par: 480,
  start: { pos: START, forward: dir(START, SIG_A), speed: 40 },
  area: { centre: [0, 0, -1000], radius: 7000 },
  models: ['interceptor', 'sentry', 'mother', 'freighter', 'fighter', 'swift', 'drone'],
  music: 'stealth',
  recommend: {
    hull: 'swift', primary: 'needle', secondaries: ['hornet'], reactor: 'hush',
    why: 'Signature is everything. A Swift is the smallest return the Eyes can get, and a Hush reactor halves it again — quieter still with the guns cold.',
  },
  needs: { stealth: true },
  briefing: {
    stages: [
      { text: 'Okonkwo has traced the raiders\' fold flashes to the Kalavryta Deep — rock so thick nobody has ever settled it. Three signals stand out. Find out what they are.', focus: SIG_B },
      { text: 'The Harrow watch the Deep with Eyes: drifting sentries that see heat, speed and gunfire. Stay inside an Eye\'s range for a second and it will call for help. A rock between you and it hides you completely.', focus: SIG_A },
      { text: 'Scan each signal and get out through the fold point. You fly alone; Wren waits at the edge of the Deep.', focus: SIG_C },
    ],
  },
  map: {
    extent: 8000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'unknown', pos: SIG_A, label: 'Signal A' },
      { kind: 'unknown', pos: SIG_B, label: 'Signal B' }, { kind: 'unknown', pos: SIG_C, label: 'Signal C' },
      { kind: 'nav', pos: EXTRACT, label: 'Fold point' },
      ...EYES.slice(0, 6).map(([c, b, d]) => ({ kind: 'danger', pos: at(c, b, d), label: 'Eye' })),
    ],
    routes: [],
  },
  objectivesPreview: [
    { text: 'Scan signals A, B and C' },
    { text: 'Reach the fold point' },
    { text: 'Stay undetected until the third scan', bonus: true },
    { text: 'Scan the Mother\'s reactor', bonus: true },
  ],
  debrief: {
    won: 'Okonkwo watched your sensor log three times without speaking. Then: "It\'s a factory. It builds them — out of rock, out of tugs, out of whatever it finds." The thing in the Deep was eight hundred metres long, and it had been asleep. Commander Doukas ordered every settlement in the belt to fortify. Varlaam, closest to the Deep, went first.',
    lost: 'The Deep kept its secret a while longer, and Lantern One with it.',
  },

  setup(m) {
    m.spawn('wreck', { team: -1, pos: SIG_A, forward: [0.3, 0.1, -1], name: 'Tug Aristea', objective: true, scan: { time: 3, range: 520, label: 'Signal A: tug wreck' } });
    // The tug's cutters: Thorns at work, hostile only once the alarm sounds.
    const cutters = [];
    for (let k = 0; k < 3; k++) cutters.push(m.spawn('thorn', { team: 1, pos: add(SIG_A, at([0, 0, 0], k * 120, 90, 30)), forward: dir(at([0, 0, 0], k * 120, 90), [0, 0, 0]), tags: ['cutter'] }));
    for (const c of cutters) c.frozen = true;
    m.flag('cutters', cutters.map(e => e.id));
    m.spawn('eye', { team: 1, pos: SIG_B, forward: [0, 0, 1], name: 'Eye relay', objective: true, scan: { time: 3, range: 480, label: 'Signal B: Eye relay' } });
    for (const [c, bearing, d] of EYES) m.spawn('eye', { team: 1, pos: at(c, bearing, d, m.rng.range(-120, 120)), forward: m.rng.unit([0, 0, 0]), tags: ['watch'] });
    // On the harder settings some Eyes patrol: slow loops across the ways
    // between the signals, so a quiet route is also a matter of timing.
    const patrols = { veteran: 2, ace: 3 }[m.diff.key] ?? 0;
    PATROLS.slice(0, patrols).forEach(([centre, r], k) => {
      const loop = [0, 1, 2, 3].map(i => at(centre, i * 90 + k * 30, r, (i % 2 ? 1 : -1) * 60));
      m.spawn('eye', { team: 1, pos: loop[0], forward: dir(loop[0], loop[1]), tags: ['watch', 'patrol'], helm: { path: loop, speed: 12, loop: true } });
    });
    const mother = m.spawn('mother', { team: 1, pos: SIG_C, forward: [0.3, 0, 1], name: 'Signal C', untargetable: false, objective: true,
      scan: { time: 4, range: 1600, label: 'Signal C: a Mother' } });
    mother.frozen = true;
    mother.invulnerable = true;
    const reactor = mother.subsystems.find(s => s.kind === 'reactor');
    if (reactor) reactor.scan = { time: 3, range: 700, progress: 0, done: false, label: 'Mother reactor' };
    m.flag('mother', mother.id);
    m.nav('a', 'Signal A', SIG_A, { r: 450 });
    m.nav('b', 'Signal B', SIG_B, { r: 450 });
    m.nav('c', 'Signal C', SIG_C, { r: 1400 });
    m.nav('out', 'Fold point', EXTRACT, { r: 300, hidden: true });
  },

  *script(m) {
    const w = m.world;
    const mother = w.byId.get(m.flags.mother);
    const reactor = mother.subsystems.find(s => s.kind === 'reactor');
    let detected = false, alarms = 0;
    m.objective('a', 'Scan signal A');
    m.objective('b', 'Scan signal B');
    m.objective('c', 'Scan signal C');
    m.objective('quiet', 'Stay undetected until the third scan', { bonus: true });
    m.objective('reactor', 'Scan the Mother\'s reactor', { bonus: true });
    m.on('scanned', ev => {
      if (ev.label?.startsWith('Signal A')) m.complete('a');
      if (ev.label?.startsWith('Signal B')) m.complete('b');
      if (ev.label === 'Mother reactor') { m.complete('reactor'); m.say('okonkwo', 'Reactor signature logged. Oh, that\'s beautiful. And terrible.'); }
    });
    m.on('detected', () => {
      alarms++;
      if (!mother.scan.done) m.fail('quiet');
      if (!detected) {
        detected = true;
        m.say('system', 'DETECTED — Harrow sensor lock.');
        m.say('okonkwo', 'It saw you. They\'ll come — move!');
        m.music('combat');
        for (const id of m.flags.cutters) { const c = w.byId.get(id); if (c) c.frozen = false; }
      }
      if (alarms <= 3) wave(m, 'thorn', m.n(alarms === 1 ? 3 : 2), m.offscreen(m.player, 1300), { toward: m.player });
    });

    yield m.say('doukas', 'This one\'s quiet, Lantern. Three signals. Look, scan, leave. If anything with a red eye looks at you — you were never there.');
    yield m.say('okonkwo', 'The Eyes see heat and noise. Keep your speed down and your guns cold. Rocks are your friends today.');
    m.hint('Near an Eye its range is drawn around it: stay outside, or keep a rock between you. Slower is quieter.', 10);
    yield m.until(() => m.done('a') || m.done('b'));
    if (m.done('a')) yield m.say('saint', 'They\'re… taking it apart. Plate by plate.');
    yield m.until(() => m.done('a') && m.done('b'));
    yield m.say('okonkwo', 'That relay is talking to something deeper in. Signal C. Go carefully.');
    yield m.until(() => mother.scan.done);
    m.complete('c');
    if (!detected) m.complete('quiet');
    yield m.say('you', 'That\'s not a rock. Perpetua — that thing is eight hundred metres long.');

    // It wakes.
    m.music('climax');
    mother.frozen = false;
    mother.invulnerable = false;
    mother.wokeUp = true;
    w.events.push({ type: 'wake', id: mother.id, pos: [...mother.ship.pos] });
    mother.launcher = { cls: 'thorn', interval: 14, max: m.n(6), timer: 2, spawned: [], wave: 2, prefer: null };
    if (mother.beam) {
      mother.beam.auto = false;
      // The first charge once the eye is open (and the camera is back with
      // the fighter after the cut to it).
      m.thread((function* () { yield m.wait(2.5); if (mother.alive) m.beam(mother, m.player); })(), 'eye');
    }
    yield m.say('okonkwo', 'Its eye — it\'s opening! Lantern, get out of there!');
    if (!reactor.scan.done) m.say('okonkwo', 'If you can — the reactor, the glowing heart. Three seconds of scan. Then run.');
    m.showNav('out');
    m.hideNav('a'); m.hideNav('b'); m.hideNav('c');
    const run = Math.round(150 * (w.diff.key === 'recruit' ? 1.4 : w.diff.key === 'ace' ? 0.85 : 1));
    m.objective('run', `Reach the fold point within ${fmtTime(run)}`);
    m.timer('run', 'Fold point', run);
    m.on('timerDone', ev => { if (ev.id === 'run' && !m.done('run')) m.fail('run', 'The Harrow cut off your escape.'); });
    m.thread((function* () {
      yield m.until(() => m.dist(m.player, SIG_C) > 2600);
      const help = m.wing('kestrel', 1, { names: ['Wren'], fold: true, pos: add(m.player.ship.pos, [80, 40, 300]) });
      m.order(help, { type: 'cover' });
      yield m.say('wren', 'Lantern One, Wren! Coming in hot — keep running, I\'ve got your tail!');
    })(), 'wren');
    yield m.until(() => m.dist(m.player, EXTRACT) < 320);
    m.complete('run');
    m.removeTimer('run');
    yield m.say('doukas', 'Fold point reached. Bring her home, Lantern.');
    m.win();
  },
});
