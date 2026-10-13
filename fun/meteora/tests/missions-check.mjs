// Run with: node tests/missions-check.mjs
// Every campaign mission, played headless: a cheating pilot (tests/autopilot.mjs)
// must be able to win it at every difficulty; random button-mashing must not
// break it; and the campaign's save, unlocks, ranks and medals hold up.
import { test, run, assert } from './harness.mjs';
import { STEP as DT } from '../js/config.js';
import { MISSIONS, TRAINING, freshProgress, loadProgress, missionById, rankOf, recordResult, saveProgress, unlockedAfter, unlockedFor, loadoutFor } from '../js/campaign.js';
import { DIFFICULTY_ORDER } from '../js/difficulty.js';
import { results } from '../js/mission.js';
import { createWorld, startRun, stepWorld, drainEvents, IDLE } from '../js/world.js';
import { makeRng } from '../js/rng.js';
import { HULLS } from '../js/catalog.js';
import { play } from './autopilot.mjs';
import '../js/missions/survival.js';
import { CASE_FILE, RECAPS } from '../js/story.js';

const quick = process.argv.includes('--quick');

for (const mission of MISSIONS) {
  test(`${mission.id} ${mission.title}: the cheat pilot wins at every difficulty`, () => {
    for (const difficulty of quick ? ['pilot'] : DIFFICULTY_ORDER) {
      const r = play(mission, { difficulty, loadout: mission.recommend, seconds: 1500 });
      assert.equal(r.outcome, 'won', `${difficulty}: ${r.outcome} (${r.reason}) at ${r.time.toFixed(0)} s`);
      const res = results(r.world);
      assert.ok(res.won && res.medal, 'a medal');
      assert.ok(res.objectives.every(o => o.kind !== 'primary' || o.state === 'done'), 'every primary done');
    }
  });
  test(`${mission.id}: briefing, map and recommendation are complete`, () => {
    assert.ok(mission.title && mission.location && mission.briefing.stages.length >= 2);
    for (const s of mission.briefing.stages) assert.ok(s.text.length > 20 && Array.isArray(s.focus));
    assert.ok(mission.map.icons.length >= 2);
    assert.ok(mission.recommend.hull && mission.recommend.why && mission.debrief.won && mission.debrief.lost);
    assert.ok(mission.models.length > 0 && mission.objectivesPreview.length > 0);
  });
  test(`${mission.id}: ninety seconds of random input in every hull break nothing`, () => {
    for (const hull of HULLS) {
      const w = createWorld({ seed: 1, mission, loadout: { hull, primary: 'pulse', secondaries: ['hornet', 'lance'], reactor: 'hearth' }, difficulty: 'veteran' });
      startRun(w);
      const rng = makeRng(hull.length * 97 + mission.number);
      let input = { ...IDLE };
      for (let i = 0; i < 120 * 90; i++) {
        if (i % 24 === 0) {
          const k = () => rng.next() < 0.08;
          input = {
            ...IDLE, throttleDelta: rng.pick([-1, 0, 1]), strafe: rng.pick([-1, 0, 1]), roll: rng.range(-1, 1), boost: k(),
            fire: rng.next() < 0.5, missile: k(), cycleTarget: k(), cycleFriendly: k(), targetTorpedo: k(), cycleNav: k(), cycleSub: k(),
            toggleSpeedLock: k(), cycleBank: k(), equalize: k(), repair: k(), wingAttack: k(), wingCover: k(), wingForm: k(),
            aimPoint: w.player.alive ? w.player.ship.pos.map(c => c + rng.range(-3000, 3000)) : null,
          };
        }
        stepWorld(w, input, DT);
        if (i % 120 === 0) {
          drainEvents(w);
          for (const e of w.entities) for (const v of [...e.ship.pos, ...e.ship.vel, ...e.ship.q]) assert.ok(Number.isFinite(v), `${e.name} not finite`);
        }
        if (w.mission.outcome) break;
      }
    }
  });
}

test('M03: Veteran and Ace add patrolling Eyes, on loops clear of the rocks (their helm does not steer round them)', () => {
  const m03 = MISSIONS.find(m => m.id === 'm03');
  for (const [difficulty, n] of [['pilot', 0], ['veteran', 2], ['ace', 3]]) {
    const world = createWorld({ seed: 1, mission: { ...m03, create: w => m03.create(w) }, loadout: m03.recommend, difficulty });
    startRun(world);
    const patrols = world.entities.filter(e => e.tags.has('patrol'));
    assert.equal(patrols.length, n, difficulty);
    for (const e of patrols) {
      const loop = e.helm.path;
      loop.forEach((a, i) => assert.equal(world.field.sweepSphere(a, loop[(i + 1) % loop.length], 15), null, `${difficulty} patrol ${e.id} leg ${i}`));
    }
  }
});
test('flight training teaches one thing at a time, in order, and passes on five drones', () => {
  const world = createWorld({ seed: 1, mission: TRAINING, loadout: TRAINING.recommend, difficulty: 'pilot' });
  startRun(world);
  const rt = world.mission, ship = world.player.ship;
  const order = [];
  // A pilot that does only what the current step asks — and nothing
  // before it is asked: the steps wait for it. Like a player, it leaves
  // the throttle where it last set it.
  let throttle = 0.4;
  for (let i = 0; i < 120 * 900 && !rt.outcome; i++) {
    const id = rt.objectives.find(o => o.state === 'active' && o.kind === 'primary')?.id;
    if (id && order.at(-1) !== id) order.push(id);
    const speed = Math.hypot(...ship.vel);
    const nav = world.nav && !world.nav.hidden ? world.nav.pos : null;
    if (id === 'steer') throttle = 0.6;
    if (id === 'fast') throttle = 1;
    if (id === 'slow') throttle = 0;
    if (id === 'roll' || id === 'slide' || id === 'missile') throttle = 0.25;
    const c = { ...IDLE, throttleSet: throttle };
    if (id === 'steer' && nav) c.aimPoint = nav;
    if (id === 'burn') c.boost = true;
    if (id === 'roll') c.roll = 1;
    if (id === 'slide') c.strafe = 1;
    if (id === 'switch') c.cycleTarget = i % 60 === 0;
    // Aim where the target will be when the bolts arrive, as the pipper shows.
    const lead = t => { const d = Math.hypot(...t.ship.pos.map((v, k) => v - ship.pos[k])); return t.ship.pos.map((v, k) => v + t.ship.vel[k] * d / 900); };
    if ((id === 'guns' || id === 'five') && world.target) { c.aimPoint = lead(world.target); c.fire = true; c.throttleSet = throttle = speed > 60 ? 0.3 : 0.6; }
    if (id === 'missile' && world.target) { c.aimPoint = lead(world.target); c.missile = world.lock.locked && i % 30 === 0; }
    if (id === 'five' && nav && !world.target) c.aimPoint = nav;
    stepWorld(world, c, DT);
    if (i % 120 === 0) drainEvents(world);
  }
  assert.equal(rt.outcome, 'won', rt.reason ?? 'timed out');
  assert.deepEqual(order, ['steer', 'fast', 'slow', 'burn', 'roll', 'slide', 'switch', 'guns', 'missile', 'five']);
  // It is the range: nothing there shoots back.
  assert.ok(world.player.hull === world.player.maxHull);
  assert.equal(missionById('training'), TRAINING);
});
test('training counts for nothing in the campaign', () => {
  assert.ok(!MISSIONS.includes(TRAINING));
});
test('Survival still runs on the new world', () => {
  const w = createWorld({ seed: 1234 });
  startRun(w);
  for (let i = 0; i < 120 * 30; i++) stepWorld(w, { ...IDLE, fire: true }, DT);
  assert.ok(w.wave >= 1);
});

/* ---------- the campaign's bookkeeping ---------- */

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
test('the case file opens a mission at a time, its hidden clues only for those who found them', () => {
  const progress = freshProgress();
  const win = (id, done = []) => recordResult(progress, { id, won: true, medal: 'bronze', score: 1000, time: 300, difficulty: 'pilot', bonusDone: 0, bonusTotal: 2, stats: {},
    objectives: done.map(o => ({ id: o, text: o, kind: 'bonus', state: 'done' })).concat([{ id: 'recorder', text: 'Recover the flight recorder', kind: 'bonus', state: done.includes('recorder') ? 'done' : 'failed' }]) });
  const first = win('m01');
  assert.deepEqual(first.evidence.map(c => c.id), ['harvested']);
  assert.deepEqual(first.missed.map(c => c.id), ['lens']);
  assert.equal(first.missed[0].objective, 'Recover the flight recorder');
  // Flown again and the recorder found: the clue is added, once.
  assert.deepEqual(win('m01', ['recorder']).evidence.map(c => c.id), ['lens']);
  assert.deepEqual(win('m01', ['recorder']).evidence, []);
  assert.deepEqual(progress.caseFile, ['harvested', 'lens']);
  // A loss finds nothing.
  assert.deepEqual(recordResult(progress, { id: 'm02', won: false, score: 0, time: 9, difficulty: 'pilot', objectives: [], stats: {} }).evidence, []);
  // Every mission holds evidence; every hidden clue names a real bonus objective.
  for (const m of MISSIONS) assert.ok(CASE_FILE.some(c => c.mission === m.id), m.id);
  for (const c of CASE_FILE.filter(c => c.requires)) {
    const m = MISSIONS.find(x => x.id === c.mission);
    const world = createWorld({ seed: 1, mission: m, loadout: m.recommend, difficulty: 'pilot' });
    startRun(world);
    for (let i = 0; i < 120; i++) stepWorld(world, IDLE, DT);
    assert.ok(world.mission.objectives.some(o => o.id === c.requires && o.kind === 'bonus'), `${c.id}: ${c.mission} has no bonus '${c.requires}'`);
  }
  // A save from before the case file gets what its wins already found.
  const store = memory();
  store.setItem('meteora.campaign.v1', JSON.stringify({ ...freshProgress(), won: ['m01', 'm02'], caseFile: undefined }));
  const old = loadProgress(store);
  assert.deepEqual(old.caseFile.sort(), ['deep', 'harvested', 'plate']);
  // And every mission after the first has a "previously".
  for (const m of MISSIONS.slice(1)) assert.ok(RECAPS[m.id]?.(() => true)?.length > 40, m.id);
});
test('a corrupt or throwing save gives a fresh campaign', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(loadProgress(broken), freshProgress());
  assert.equal(saveProgress(broken, freshProgress()), false);
  const junk = memory(); junk.setItem('meteora.campaign.v1', '{not json');
  assert.deepEqual(loadProgress(junk), freshProgress());
  const odd = memory(); odd.setItem('meteora.campaign.v1', JSON.stringify({ version: 1, won: ['m01', 'nope'], total: 'x', difficulty: 'godlike' }));
  const p = loadProgress(odd);
  assert.deepEqual(p.won, ['m01']); assert.equal(p.total, 0); assert.equal(p.difficulty, 'pilot');
});
test('winning records the best, unlocks equipment, raises the rank and awards commendations', () => {
  const p = freshProgress();
  const r1 = { id: 'm01', won: true, score: 7000, medal: 'silver', time: 300, difficulty: 'pilot', objectives: [], stats: { hullTaken: 0, killCount: 5, bestStreak: 2, torpedoesDowned: 0, kills: {}, subsystems: 0, shots: 10, accuracy: 0.1 } };
  const out = recordResult(p, r1);
  assert.deepEqual(p.won, ['m01']);
  assert.equal(p.best.m01.medal, 'silver');
  assert.ok(out.unlocks.some(u => u.key === 'swift'));
  assert.equal(out.rankUp, 'Ensign');
  assert.ok(out.commendations.some(c => c.id === 'first') && out.commendations.some(c => c.id === 'untouchable') && out.commendations.some(c => c.id === 'ace'));
  // A worse replay keeps the best score but can still improve the medal.
  recordResult(p, { ...r1, score: 100, medal: 'gold' });
  assert.equal(p.best.m01.score, 7000); assert.equal(p.best.m01.medal, 'gold');
  const store = memory(); saveProgress(store, p);
  assert.deepEqual(loadProgress(store), p);
});
test('unlocks follow the story, and every mission can fly its recommendation', () => {
  assert.deepEqual(unlockedAfter(0).hulls, ['kestrel']);
  assert.ok(unlockedAfter(3).hulls.includes('anvil'));
  const p = freshProgress();
  for (const m of MISSIONS) {
    const u = unlockedFor(p, m);
    assert.ok(u.hulls.includes(m.recommend.hull) && u.primaries.includes(m.recommend.primary) && u.reactors.includes(m.recommend.reactor));
    const L = loadoutFor(p, m);
    assert.equal(L.hull, m.recommend.hull);
  }
});
test('ranks climb with total score', () => {
  assert.equal(rankOf(0).name, 'Cadet'); assert.equal(rankOf(20000).name, 'Lieutenant');
  assert.equal(rankOf(1e9).name, 'Wing Commander'); assert.equal(rankOf(1e9).progress, 1);
});

await run();
