/* Mission 8 — Heart of the Mother. Destroy a mothership's reactor.

   The Deep Anchorage, where the Vanguard's foreman waits: a Mother, eight
   hundred metres of fabricator, shielded by two generators, ringed with
   flak and plasma turrets, launching Thorns and Talons from its bays. Take
   the generators down, then the reactor — only torpedoes and Breakers bite
   its armour. Ember wing's Anvils carry Lances too. Halfway through it
   starts to spool its fold drive; when the reactor dies it goes critical. */

import { defineMission } from '../mission.js';
import { belt } from './belt.js';
import { add, dir, onDeath, wave } from './kit.js';
import { qLookRotation, qRotate } from '../vec.js';

const MOTHER = [0, 0, -2400];
const START = [0, 300, 1600];
const FIELD = belt({
  spawn: START, density: 0.9, landmarks: 3,
  clear: [{ pos: MOTHER, r: 750 }],
  lanes: [{ a: START, b: MOTHER, r: 400 }],
});
const SPOOL = { recruit: 420, pilot: 360, veteran: 300, ace: 240 };

export default defineMission({
  id: 'm08', number: 8, title: 'Heart of the Mother', location: 'The Deep Anchorage', dateline: 'Day 36',
  field: FIELD, fieldSeed: 8088, seed: 808, par: 600,
  start: { pos: START, forward: dir(START, MOTHER), speed: 100 },
  area: { centre: [0, 0, -1000], radius: 7000 },
  models: ['fighter', 'anvil', 'interceptor', 'talon', 'mother', 'torpedo', 'drone'],
  music: 'climax',
  recommend: {
    hull: 'anvil', primary: 'breaker', secondaries: ['hornet', 'lance'], reactor: 'aegis',
    why: 'Only torpedoes and Breakers bite the reactor\'s armour. An Anvil carries four Lances, takes flak for breakfast, and its tail gun keeps Thorns honest. Aegis for the turrets.',
  },
  needs: { armor: true, torpedoes: 'No Lances: Ember wing carries only two, and the reactor takes three. It will come down to Breakers.' },
  briefing: {
    stages: [
      { text: 'This is the Mother you found asleep in the Deep. Okonkwo is sure: it is the Vanguard\'s foreman. Kill it and the Harrow in this part of the belt lose their direction.', focus: MOTHER },
      { text: 'Two shield generators sit on its upper flanks; with both down its shield falls for good. Then the reactor — the heart, behind its cage. Only torpedoes and Breakers bite that armour.', focus: MOTHER },
      { text: 'Ember wing — two Anvils with Lances — flies with you. Keep them alive and they will help with the reactor. The bays launch fighters every half-minute: knocking them out is worth it.', focus: START },
    ],
  },
  map: {
    extent: 7000,
    icons: [
      { kind: 'player', pos: START, label: 'Lantern + Ember' }, { kind: 'capital-enemy', pos: MOTHER, label: 'Mother' },
    ],
    routes: [{ path: [START, MOTHER], kind: 'nav' }],
  },
  objectivesPreview: [
    { text: 'Destroy both shield generators' },
    { text: 'Destroy the Mother\'s reactor' },
    { text: 'Ember wing survives', bonus: true },
    { text: 'Destroy both launch bays', bonus: true },
  ],
  debrief: {
    won: 'The foreman is dead, and for nineteen hours the Harrow in the belt simply stopped: drones drifting where they were, Eyes staring at nothing. Then the fold flares began at the belt\'s edge, and kept on beginning. Fourteen Mothers. The Commander called a council in the Perpetua\'s chapel, and when it ended she gave the order no one in the Meteora had ever imagined: we are leaving.',
    lost: 'The Mother lived. In the Deep Anchorage, the Vanguard went back to work.',
  },

  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'], tags: ['lantern'], primary: 'wingBreaker' });
    // One Lance each: two hits break the heart open, the third is yours.
    const ember = m.wing('anvil', 2, { names: ['Ember 1', 'Ember 2'], pos: add(START, [0, -80, 200]), tags: ['ember'], torpedoes: 1, torpedoWeapon: 'lance', primary: 'wingPulse', role: 'bomber', missiles: 0 });
    // Ember waits out of the flak until the shields are down.
    for (const e of ember) { e.orders = { type: 'hold' }; e.leaderId = null; e.home = add(START, [e.name.endsWith('1') ? 150 : -150, -60, -400]); }
    m.flag('ember', ember.map(e => e.id));
    const mother = m.spawn('mother', { team: 1, pos: MOTHER, forward: [0, 0, 1], name: 'Mother', objective: true, beamAuto: false });
    mother.launcher = { cls: ['thorn', 'thorn', 'talon'], interval: 30, max: m.n(6), timer: 15, spawned: [], wave: 2 };
    // She is still building her defences: not every gun is finished.
    const guns = { recruit: 4, pilot: 5, veteran: 5, ace: 5 }[m.diff.key] ?? 5;
    mother.turrets.forEach((t, i) => { if (i >= guns) { t.alive = false; t.hull = 0; } });
    m.flag('mother', mother.id);
    m.nav('m', 'Mother', MOTHER, { r: 1500 });
  },

  *script(m) {
    const w = m.world;
    const mother = w.byId.get(m.flags.mother);
    const ember = m.flags.ember.map(id => w.byId.get(id));
    const gens = mother.subsystems.filter(s => s.kind === 'shield');
    const bays = mother.subsystems.filter(s => s.kind === 'bay');
    const reactor = mother.subsystems.find(s => s.kind === 'reactor');
    m.objective('gens', 'Destroy both shield generators', { count: { n: 0, of: gens.length } });
    m.objective('reactor', 'Destroy the Mother\'s reactor', { hidden: true });
    m.objective('ember', 'Ember wing survives', { bonus: true, passOnWin: true });
    m.objective('bays', 'Destroy both launch bays', { bonus: true });
    for (const e of ember) onDeath(m, e, () => { m.fail('ember'); m.say('ember', `${e.name} is down!`); });
    let spooling = false;
    m.on('subsystemDestroyed', ev => {
      if (ev.id !== mother.id) return;
      if (ev.kind === 'shield') {
        const left = gens.filter(s => s.alive).length;
        m.progress('gens', gens.length - left, gens.length);
        m.say('saint', left ? 'One generator down! One to go!' : 'Both generators down — her shield\'s gone!');
      }
      if (ev.kind === 'bay') {
        m.say('wren', 'Launch bay destroyed!');
        if (bays.every(s => !s.alive)) m.complete('bays');
      }
      if (ev.kind === 'beam') m.say('saint', 'That beam emitter is scrap. Nice.');
    });

    yield m.say('doukas', 'All wings, this is it. The foreman. Generators first, then the heart.');
    yield m.say('ember', 'Ember Lead, Lances armed. Clear us a path and we\'ll do the rest.');
    m.hint('V cycles the target\'s subsystems. Torpedoes lock on a subsystem when it is selected.', 9);
    m.hint('Flak bursts where you will be: change speed and direction when it starts popping around you.', 9);

    yield m.until(() => m.dist(m.player, mother) < 2600 || m.time > 50);
    m.say('okonkwo', 'Its eye is on you. Beam charging — break, break!');
    if (mother.beam) m.beam(mother, m.player);
    wave(m, 'thorn', m.n(4), add(MOTHER, [0, 300, 900]), { toward: m.player });

    // The fold drive starts to spool when the first generator falls, or at 2:30.
    m.thread((function* () {
      yield m.until(() => gens.some(s => !s.alive) || m.time > 200);
      spooling = true;
      m.music('climax');
      yield m.say('okonkwo', 'She\'s spooling a fold drive — she\'s going to run! Four minutes, maybe less!');
      m.timer('fold', 'Mother folds out', SPOOL[m.diff.key] ?? 260);
      m.on('timerDone', ev => { if (ev.id === 'fold' && reactor.alive) m.fail('reactor', 'The Mother folded out.'); });
      mother.helm = { path: [add(MOTHER, [0, 0, -3000])], index: 0, speed: 6, arrive: 100, then: 'hold', loop: false, done: false, halt: false };
    })(), 'spool');
    // Beam shots at Ember, now and then.
    m.thread((function* () {
      for (;;) {
        yield m.wait(30);
        const prey = ember.find(e => e.alive) ?? m.player;
        if (mother.alive && mother.beam?.sub.alive) m.beam(mother, prey);
      }
    })(), 'beam');

    // However she dies — generators then reactor, or hammered to death
    // through her hull — the script follows.
    const dead = () => !mother.alive;
    yield m.until(() => gens.every(s => !s.alive) || dead());
    m.complete('gens');
    m.show('reactor');
    for (const e of ember) if (e.alive) { e.orders = { type: 'strike', target: mother, sub: reactor.name }; e.brain.retarget = 0; }
    yield m.say('ember', 'Shields are down! Ember, on the reactor — Lances away when you have tone!');
    m.hint('Select the Mother, press V until the reactor is bracketed, and hold it until the Lance locks.', 9);

    yield m.until(() => !reactor.alive || dead());
    m.removeTimer('fold');
    m.complete('reactor');
    mother.launcher = null;
    if (!dead()) {
      mother.frozen = true;
      mother.unkillable = true;
      w.events.push({ type: 'critical', id: mother.id, pos: [...mother.ship.pos] });
      yield m.say('okonkwo', 'Reactor breach! She\'s going critical — get clear, everyone, a kilometre and a half, now!');
      m.objective('clear', 'Get 1.5 km clear of the Mother');
      m.timer('boom', 'Critical', 20);
      yield m.until(() => m.timeLeft('boom') <= 0);
      m.removeTimer('boom');
      for (const e of w.entities) {
        if (!e.alive || e === mother) continue;
        const d = m.dist(e, mother);
        if (d < 1500) w.damage(e, 2500 * (1 - d / 1500), [...mother.ship.pos], null, { weapon: { pierce: 1, shieldMul: 1, hullMul: 1 } });
      }
      mother.unkillable = false;
      mother.hull = 0; mother.alive = false; mother.lastHitBy = w.player.id;
      if (m.player.alive) m.complete('clear');
    }
    for (const e of w.entities) if (e.team === 1 && e.alive && !e.big) e.frozen = true;
    m.music('calm');
    yield m.wait(4);
    yield m.say('ember', 'She\'s gone. The foreman is gone!');
    yield m.wait(2);
    // At the belt's edge, fold after fold opens: the rest of them.
    // Where the pilot is looking, across the sky ahead: nobody misses them.
    const look = qRotate([0, 0, 0], m.player.ship.q, [0, 0, -1]);
    const flat = Math.hypot(look[0], look[2]) > 0.2 ? [look[0], 0, look[2]] : [0, 0, -1];
    const n0 = Math.hypot(...flat);
    const away = flat.map(v => v / n0);
    const flares = Array.from({ length: 14 }, (_, k) => {
      const a = (k / 13 - 0.5) * 1.3;
      const side = [Math.cos(a) * away[0] - Math.sin(a) * away[2], 0, Math.sin(a) * away[0] + Math.cos(a) * away[2]];
      const d = 5200 + 700 * Math.sin(k * 2.3);
      return add(m.player.ship.pos, [side[0] * d, look[1] * d + (k % 3 - 1) * 500 + 250 * Math.cos(k), side[2] * d]);
    });
    // Each faces the pilot, so it reads as a ring, not a line.
    const facing = flares.map(f => qLookRotation([0, 0, 0, 1], dir(f, m.player.ship.pos), [0, 1, 0]));
    w.events.push({ type: 'flares', positions: flares, facing, team: 1 });
    yield m.say('perpetua', 'All wings, Perpetua. Fold flares at the belt\'s edge. Many of them.');
    yield m.say('okonkwo', 'Mother-class signatures. Eleven… no. Fourteen.');
    yield m.say('doukas', 'Lantern Wing, come home. All of you. Now.');
    m.win();
  },
});
