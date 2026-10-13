/* Mission 10 — Long Mercy. Guard the colony ship until it jumps.

   The belt's edge. The Long Mercy — forty-one thousand people, a fold
   drive built from Harrow wreckage — needs six minutes to spool. The
   Perpetua stays behind as rearguard. Two minutes in, a Mother folds in
   and plants three fold anchors: until they fall, the drive cannot open.
   With thirty seconds left the Perpetua does the one thing only she can:
   she speaks to the Vanguard in its makers' voice. Then the ring opens,
   and Lantern One has ten seconds to be inside it. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, at, dir, onDeath, strike, wave } from './kit.js';
import { toWorld } from '../compound.js';

const MERCY = [0, 0, 0];
const PERPETUA = [2200, 260, 1500];
const MOTHER = [-2800, 300, -2400];
const START = [400, 260, 1200];
const FIELD = belt({
  spawn: START, density: 0.5, landmarks: 2,
  clear: [{ pos: MERCY, r: 800 }, { pos: PERPETUA, r: 950 }, { pos: MOTHER, r: 700 }],
  lanes: [{ a: PERPETUA, b: MOTHER, r: 800 }],
});
const SPOOL = 360;

export default defineMission({
  id: 'm10', number: 10, title: 'Long Mercy', location: 'The belt\'s edge', dateline: 'Day 40',
  field: FIELD, fieldSeed: 10010, seed: 1010, par: 480,
  start: { pos: START, forward: dir(START, MERCY), speed: 60 },
  area: { centre: [0, 0, 0], radius: 7000 },
  models: ['fighter', 'interceptor', 'maul', 'talon', 'mite', 'mother', 'anchor', 'colony', 'perpetua', 'halberd', 'torpedo', 'drone'],
  music: 'climax',
  recommend: {
    hull: 'kestrel', primary: 'breaker', secondaries: ['hornet', 'lance'], reactor: 'aegis',
    why: 'Everything at once. The fold anchors are armoured — Breakers and Lances crack them — but the sky will be full of fighters and bombers. A Kestrel with Breakers, Hornets and two Lances, and an Aegis to last.',
  },
  needs: { armor: true, fighters: true, endurance: true },
  briefing: {
    stages: [
      { text: 'Fourteen Mothers are coming. We are leaving. The Long Mercy carries everyone who is left — forty-one thousand people — and a fold drive Okonkwo built from Harrow wreckage.', focus: MERCY },
      { text: 'The drive needs six minutes to spool. Keep the Harrow off her, and above all off the drive ring at her bow.', focus: MERCY },
      { text: 'The Perpetua stays behind. She is too old to fold and too big to hide. I stay with her.', focus: PERPETUA },
      { text: 'When the ring opens, you will have seconds to be inside it. Do not be late, Lantern.', focus: MERCY },
    ],
  },
  map: {
    extent: 8000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern' }, { kind: 'capital', pos: MERCY, label: 'Long Mercy' },
      { kind: 'capital', pos: PERPETUA, label: 'Perpetua' }, { kind: 'unknown', pos: MOTHER, label: '?' },
    ],
    routes: [],
  },
  objectivesPreview: [
    { text: 'Protect the Long Mercy until her drive is ready (6:00)' },
    { text: 'Keep the drive ring intact' },
    { text: 'Make the jump' },
    { text: 'The drive ring above 75 %', bonus: true },
    { text: 'Saint and Wren make the jump', bonus: true },
  ],
  debrief: {
    won: 'The Long Mercy unfolded four light-years from Pindus, above a world no one had charted: blue, clouded, real. The Vanguard was right about one thing — there was a home. It was just further than they could see. The Perpetua\'s signal was received for eleven minutes after the jump, the old command code repeating on every channel, HOLD, HOLD, HOLD, until it stopped. Somebody had to tell them we were not debris. — END —',
    lost: 'The ring closed. Behind it, the belt went dark.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'], primary: 'wingBreaker' });
    const mercy = m.spawn('mercy', { team: 0, pos: MERCY, forward: [0, 0, -1], name: 'Long Mercy', objective: true, fixed: true });
    m.flag('mercy', mercy.id);
    const perpetua = m.spawn('perpetua', { team: 0, pos: PERPETUA, forward: dir(PERPETUA, MOTHER), name: 'Perpetua', unkillable: true });
    m.flag('perpetua', perpetua.id);
    for (const [name, off] of [['Halberd Ardent', [-500, 200, -900]], ['Halberd Vigil', [600, -150, -700]]]) {
      m.spawn('halberd', { team: 0, pos: add(MERCY, off), forward: [0, 0, -1], name, helm: { path: [add(MERCY, off)], speed: 10, then: 'hold' } });
    }
    const halo = m.wing('kestrel', 2, { names: ['Halo 1', 'Halo 2'], leader: mercy, pos: add(MERCY, [0, 300, 300]) });
    for (const h of halo) { h.orders = null; h.protectId = mercy.id; h.leaderId = null; }
    m.nav('mercy', 'Long Mercy', add(MERCY, [0, 0, 600]), { r: 900 });
  },

  *script(m) {
    const w = m.world;
    const mercy = w.byId.get(m.flags.mercy);
    const perpetua = w.byId.get(m.flags.perpetua);
    const drive = mercy.subsystems.find(s => s.kind === 'drive');
    // A drive built from wreckage: frailer on Veteran. Ace's extra Harrow
    // are threat enough on their own.
    const frail = { veteran: 0.8 }[m.diff.key] ?? 1;
    if (drive) { drive.maxHull *= frail; drive.hull = drive.maxHull; }
    const ringCentre = () => toWorld([0, 0, 0], mercy, drive?.pos ?? [0, 0, -430]);
    const ringRadius = Math.max(60, (drive?.r ?? 120) * 0.85);
    const anchors = [];
    m.objective('protect', 'Protect the Long Mercy until her drive is ready');
    m.objective('drive', 'Keep the drive ring intact');
    m.objective('ring', 'The drive ring above 75 %', { bonus: true, passOnWin: true });
    m.objective('wing', 'Saint and Wren make the jump', { bonus: true });
    m.timer('spool', 'Fold drive', SPOOL);
    m.on('shipKilled', ev => { if (ev.id === mercy.id) m.fail('protect', 'The Long Mercy was destroyed.'); });
    m.on('subsystemDestroyed', ev => { if (ev.id === mercy.id && ev.kind === 'drive') m.fail('drive', 'The drive ring was destroyed.'); });
    m.on('shipHit', ev => { if (ev.id === mercy.id && drive && drive.hull < drive.maxHull * 0.75) m.fail('ring'); });
    for (const name of ['Saint', 'Wren']) { const e = m.get(name); if (e) onDeath(m, e, () => m.fail('wing')); }

    yield m.say('ferrante', 'Long Mercy to all wings. Drive is spooling. Six minutes. Forty-one thousand souls say thank you in advance.');
    yield m.say('doukas', 'Perpetua is in position. Lantern — it has been an honour.');
    yield m.wait(10);
    m.music('combat');
    const north = at(MERCY, 330, 3200, 300);
    wave(m, 'thorn', m.n(5), north, { toward: mercy });
    strike(m, 'maul', m.n(2), add(north, [300, -300, 0]), mercy, { sub: drive?.name });
    yield m.say('saint', 'Here they come. All of them.');

    yield m.wait(55);
    const south = at(MERCY, 150, 3200, -200);
    strike(m, 'maul', m.n(3), south, mercy, { sub: drive?.name });
    wave(m, 'talon', m.n(2), add(south, [200, 200, 0]), { toward: mercy });
    wave(m, 'mite', m.n(6), m.offscreen(m.player, 1500), { toward: m.player });
    m.say('wren', 'Bombers low, swarm high!');

    // 2:00 — the Mother and her anchors.
    yield m.until(() => m.time >= 120);
    const mother = m.spawn('mother', { team: 1, pos: MOTHER, forward: dir(MOTHER, MERCY), name: 'Mother', fold: true });
    mother.launcher = { cls: ['thorn', 'talon'], interval: 30, max: m.n(4), timer: 12, spawned: [], wave: 2 };
    yield m.say('perpetua', 'Fold flash — Mother-class, two thousand metres off the Mercy\'s bow!');
    if (m.diff.key === 'veteran' || m.diff.key === 'ace') {
      strike(m, 'maul', m.n(2), add(MOTHER, [400, -200, 600]), mercy, { sub: drive?.name });
      m.say('saint', 'Bombers out of her bays — they\'re going for the ring!');
    }
    for (const bearing of [40, 160, 280]) {
      const pos = at(MERCY, bearing, 1300, bearing === 160 ? -250 : 250);
      const a = m.spawn('anchor', { team: 1, pos, forward: dir(pos, MERCY), name: `Anchor ${anchors.length + 1}`, fold: true, objective: true, tags: ['anchor'] });
      // Pinned space confuses fire control: no turret or pilot locks an
      // anchor on its own. They are Lantern's to crack (1 sends the wing).
      a.noAutoTarget = true;
      anchors.push(a);
    }
    yield m.say('okonkwo', 'Those pylons — they\'re fold anchors. They pin space flat. While they stand, the drive cannot open!');
    m.objective('anchors', 'Destroy the fold anchors', { count: { n: 0, of: anchors.length } });
    m.hint('Anchors are armoured and no turret can lock them: Breakers and Lances crack them, V selects the emitter, 1 sends your wing.', 10);
    const anchorDown = a => !a.alive || a.subsystems.every(s => !s.alive);
    m.thread((function* () {
      for (;;) {
        yield m.wait(0.25);
        const down = anchors.filter(anchorDown).length;
        m.progress('anchors', down, anchors.length);
        for (const a of anchors) if (a.alive && anchorDown(a) && !a.tags.has('dead')) { a.tags.add('dead'); a.untargetable = true; m.say('saint', `${a.name} is down!`); }
        const blocked = down < anchors.length;
        const t = m.timeLeft('spool');
        if (blocked && t <= 60) m.pauseTimer('spool', true);
        if (!blocked) { m.pauseTimer('spool', false); m.complete('anchors'); return; }
      }
    })(), 'anchors');
    m.thread((function* () {
      yield m.until(() => m.timeLeft('spool') <= 60 && anchors.some(a => !anchorDown(a)));
      yield m.say('ferrante', 'Drive is stalled at sixty seconds. We are pinned! Those anchors have to go!');
      // Pinned too long, and the rest of the Mothers arrive.
      const limit = { recruit: 150, pilot: 120, veteran: 100, ace: 80 }[m.diff.key] ?? 120;
      m.timer('pinned', 'Mothers arrive', limit);
      m.on('timerDone', ev => { if (ev.id === 'pinned' && anchors.some(a => !anchorDown(a))) m.fail('protect', 'The anchors held the Long Mercy until the Mothers arrived.'); });
      yield m.until(() => anchors.every(anchorDown));
      m.removeTimer('pinned');
    })(), 'stall');

    yield m.wait(30);
    strike(m, 'maul', m.n(3), at(MERCY, 250, 3100, 300), mercy, { sub: drive?.name });
    wave(m, 'thorn', m.n(4), m.offscreen(mercy, 2600), { toward: mercy });
    m.thread((function* () {
      for (;;) {
        yield m.wait(26);
        if (mother.alive && perpetua.alive) m.beam(mother, perpetua);
      }
    })(), 'beam');

    // 0:30 left — the Perpetua's voice.
    yield m.until(() => m.timeLeft('spool') <= 30);
    m.music('climax');
    m.nav('ring', 'Drive ring', ringCentre(), { r: ringRadius });
    m.showNav('ring');
    m.hint('Get close to the Long Mercy\'s bow: when the drive ring opens you will have seconds to fly through it.', 10);
    yield m.say('doukas', 'Okonkwo, now. Send it.');
    w.events.push({ type: 'command', id: perpetua.id });
    yield m.say('perpetua', 'PERPETUA COMMAND AUTHORITY. ALL VANGUARD UNITS: HOLD. HOLD. HOLD.');
    m.freeze(1, true);
    yield m.say('okonkwo', 'They\'re… stopping. All of them. They recognise her!');
    perpetua.helm = { path: [add(MOTHER, [600, 0, 900])], index: 0, speed: 20, arrive: 300, then: 'hold', loop: false, done: false, halt: false };
    yield m.wait(15);
    m.freeze(1, false);
    yield m.say('doukas', 'Fifteen seconds. That\'s all she could buy. Go, Mercy. Go.');

    yield m.until(() => m.timeLeft('spool') <= 0);
    m.removeTimer('spool');
    m.complete('protect');
    if (drive?.alive !== false) m.complete('drive');
    const window = { recruit: 26, pilot: 22, veteran: 18, ace: 15 }[m.diff.key] ?? 20;
    w.events.push({ type: 'ringOpen', id: mercy.id, pos: ringCentre(), r: ringRadius, dur: window });
    mercy.ringOpen = true;
    // The window starts the moment the ring opens, not when the line ends.
    m.objective('jump', 'Fly into the drive ring');
    m.timer('ring', 'Fold closes', window);
    m.showNav('ring');
    m.say('ferrante', 'Ring is open! All wings, inside the ring — now, now, now!');
    m.hideNav('mercy');
    const saint = m.get('Saint'), wren = m.get('Wren');
    for (const e of [saint, wren]) if (e?.alive) { e.orders = { type: 'jump' }; e.leaderId = null; e.home = ringCentre(); e.brain.target = null; }
    yield m.until(() => m.dist(m.player, ringCentre()) < ringRadius || m.timeLeft('ring') <= 0);
    if (m.dist(m.player, ringCentre()) < ringRadius) {
      m.complete('jump');
      if (saint?.alive && wren?.alive) m.complete('wing');
      w.events.push({ type: 'jump', id: mercy.id, pos: ringCentre() });
      m.removeTimer('ring');
      m.music('calm');
      yield m.say('ferrante', 'Folding. Godspeed, Perpetua.');
      m.win();
    } else {
      m.fail('jump', 'The fold closed without you.');
    }
  },
});
