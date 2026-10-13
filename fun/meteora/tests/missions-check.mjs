// Run with: node tests/missions-check.mjs
// Every campaign mission, played headless: a cheating pilot (tests/autopilot.mjs)
// must be able to win it at every difficulty; random button-mashing must not
// break it; and the campaign's save, unlocks, ranks and medals hold up.
import { test, run, assert } from './harness.mjs';
import { STEP as DT } from '../js/config.js';
import { MISSIONS, freshProgress, loadProgress, rankOf, recordResult, saveProgress, unlockedAfter, unlockedFor, loadoutFor } from '../js/campaign.js';
import { DIFFICULTY_ORDER } from '../js/difficulty.js';
import { results } from '../js/mission.js';
import { createWorld, startRun, stepWorld, drainEvents, IDLE } from '../js/world.js';
import { makeRng } from '../js/rng.js';
import { HULLS } from '../js/catalog.js';
import { play } from './autopilot.mjs';
import '../js/missions/survival.js';

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
test('Survival still runs on the new world', () => {
  const w = createWorld({ seed: 1234 });
  startRun(w);
  for (let i = 0; i < 120 * 30; i++) stepWorld(w, { ...IDLE, fire: true }, DT);
  assert.ok(w.wave >= 1);
});

/* ---------- the campaign's bookkeeping ---------- */

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
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
