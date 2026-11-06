// Run the actual main.js completion lifecycle without a graphics context.
// A final objective previously started a wall timer that could replace paused
// settings, score a later death, or outlive an actual checkpoint retry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const functions = ['cancelCompletionPresentation', 'onComplete', 'updateCompletionPresentation',
  'onDeath', 'updateDeathPresentation', 'retryCheckpoint', 'startMission', 'resume', 'pause', 'freshStats'];
function fixture({ savedBest = '0', storageThrows = false } = {}) {
  const nodes = new Map(), shown = [], outcomes = [], timers = [], stored = [], resets = [];
  const classList = { add() {}, remove() {} };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      children: [], textContent: '', hidden: false, disabled: false, dataset: {}, classList,
      set innerHTML(value) { this.children.length = 0; }, get innerHTML() { return ''; },
      append(...children) { this.children.push(...children); }, setAttribute() {},
    });
    return nodes.get(selector);
  };
  const identity = { id: 'prague' }, noop = () => {};
  const mission = { done: true, checkpoint: 0, restoreCalls: 0,
    restoreCheckpoint() { this.restoreCalls++; this.done = false; return { spawn: [0, 0, 0], inventory: {} }; },
    start() { this.done = false; }, isComplete: () => false, isActive: () => true };
  const context = createContext({
    completionPresentation: null, completionRecorded: false, deathPresentation: null, deathSequence: 0,
    state: 'playing', missionTime: 100, graphicsLost: false, ready: true, missionStarted: false, AT: null,
    screenStack: [], screenEls: { pause: { scrollTop: 0, querySelector: () => ({ scrollTop: 0 }) } },
    G: { stats: { kills: 5, headshots: 1, shots: 10, hits: 5, grenades: 1, deaths: 0, objectives: 6 },
      enemies: Array.from({ length: 22 }, () => ({ char: {} })), debris: { clear: noop },
      casings: { clear: noop }, chunks: { clear: noop }, steam: { clear: noop } },
    mission, player: { alive: true, killer: null, pos: { x: 0, z: 0 }, char: { root: { visible: false } },
      reset(...args) { resets.push(args); this.alive = true; } },
    audio: { init: noop, resume: noop, suspend: noop, cancelActions: noop, cancelContacts: noop },
    hud: { notice: noop, hideCrosshair: noop, calm: noop, show: noop },
    input: { enable: noop, exitLock: noop, requestLock: noop }, mark: noop,
    fade: { classList }, explosives: { clear: noop }, enemies: { resetLiving: noop },
    LEVEL: { title: 'Prague', completeTitle: 'The relay holds', start: [0, 0, 0],
      objectives: [{ id: 'rally', text: 'Withdraw' }] }, MISSION: identity, MISSIONS: [identity],
    KILLER_NAME: {}, document: { body: { classList }, querySelectorAll: () => [],
      createElement: tag => ({ tag, textContent: '', className: '', dataset: {}, setAttribute() {} }) },
    $: node, paintFieldMap: noop,
    localStorage: { getItem() { if (storageThrows) throw new Error('Storage blocked'); return savedBest; },
      setItem(key, value) { if (storageThrows) throw new Error('Storage blocked'); stored.push({ key, value }); } },
    bestKey: id => `best-${id}`, formatTime: value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`,
    show: screen => shown.push(screen), trackAttemptEnd: (outcome, score) => outcomes.push({ outcome, score }),
    trackAttemptStart: noop, resetAcoustics: noop,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
  });
  for (const name of functions) {
    const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, `${name} exists in the actual entrypoint`);
    runInContext(source.slice(start, end + 2), context);
  }
  function advance(seconds) {
    while (seconds > 1e-9) { const dt = Math.min(.05, seconds); context.updateCompletionPresentation(dt); seconds -= dt; }
  }
  const rows = () => Object.fromEntries(node('[data-stats]').children.reduce((pairs, item, index, all) => {
    if (index % 2 === 0) pairs.push([item.textContent, all[index + 1].textContent]); return pairs;
  }, []));
  return { context, advance, rows, shown, outcomes, timers, stored, resets, node };
}

{
  const f = fixture(), c = f.context;
  c.onComplete();
  assert.equal(f.timers.length, 0, 'Winning uses no wall timer');
  assert.equal(f.outcomes.length, 1, 'The final objective records the win immediately');
  assert.equal(f.outcomes[0].outcome, 'win');
  const earned = c.completionPresentation.report;
  assert.ok(Object.isFrozen(earned) && Object.isFrozen(earned.stats), 'Result and copied stats are immutable');
  assert.notEqual(earned.stats, c.G.stats, 'Live combat cannot mutate the result object');
  f.advance(.8); c.pause(); c.show('settings');
  const elapsed = c.completionPresentation.elapsed;
  f.advance(60);
  assert.equal(c.completionPresentation.elapsed, elapsed, 'Pause/settings freezes the result delay');
  assert.equal(f.shown.at(-1), 'settings', 'Pending completion cannot replace Settings');
  c.resume(); c.graphicsLost = true; f.advance(60);
  assert.equal(c.completionPresentation.elapsed, elapsed, 'Graphics loss freezes the result delay');
  c.graphicsLost = false;
  for (const invalid of [0, -.1, NaN, Infinity]) c.updateCompletionPresentation(invalid);
  assert.equal(c.completionPresentation.elapsed, elapsed, 'Invalid time does not advance completion');
  f.advance(1.69); assert.equal(c.state, 'playing', 'The remaining simulation delay is preserved');
  f.advance(.01); assert.equal(c.state, 'complete');
  assert.equal(f.rows().Time, '1:40');
  assert.equal(f.rows().Score, earned.score);
  f.advance(60); c.onComplete();
  assert.equal(f.outcomes.length, 1); assert.equal(f.shown.filter(screen => screen === 'complete').length, 1);
}
{
  const f = fixture(), c = f.context;
  c.onComplete(); const earned = c.completionPresentation.report;
  c.G.stats.kills++; c.G.stats.shots += 2; c.G.stats.hits++; c.missionTime = 102.5;
  c.player.alive = false; c.onDeath();
  assert.equal(c.G.stats.deaths, 1, 'The actual death function still records the later live death');
  f.advance(2.5);
  assert.equal(f.rows().Time, '1:40'); assert.equal(f.rows()['Times down'], 0);
  assert.equal(f.rows()['Enemies killed'], '5 / 22'); assert.equal(f.rows().Accuracy, '50 %');
  assert.equal(f.rows().Score, earned.score, 'Post-objective shots/death/time do not change the earned score');
  assert.equal(c.deathPresentation, null, 'Completion clears a pending death camera');
  c.updateDeathPresentation(60); assert.equal(c.state, 'complete');
  assert.deepEqual(f.outcomes.map(event => event.outcome), ['win']);
}
{
  const f = fixture(), c = f.context;
  c.onComplete(); c.pause();
  assert.equal(f.node('[data-screen="pause"] [data-action="checkpoint"]').disabled, true,
    'An already won final order cannot be reverted through the pause checkpoint action');
  c.retryCheckpoint();
  assert.equal(c.mission.restoreCalls, 0); assert.equal(f.timers.length, 0);
  assert.ok(c.completionPresentation, 'Blocked retry preserves the pending result');
}
{
  const f = fixture(), c = f.context;
  c.onComplete(); c.mission.done = false; c.retryCheckpoint();
  assert.equal(c.completionPresentation, null); assert.equal(c.completionRecorded, false);
  assert.equal(c.mission.restoreCalls, 1);
  assert.equal(f.timers.length, 0, 'A valid checkpoint retry leaves no delayed world callback');
  assert.equal(f.resets.length, 1, 'Checkpoint reset completes once in the actual retry task');
  assert.equal(c.player.alive, true, 'Retry has a ready soldier before returning to play');
  f.advance(60);
  assert.equal(c.state, 'playing'); assert.equal(f.shown.includes('complete'), false, 'A valid retry cancels stale completion');
}
{
  const f = fixture(), c = f.context;
  c.onComplete(); c.startMission();
  assert.equal(c.completionPresentation, null); assert.equal(c.completionRecorded, false);
  assert.equal(c.mission.done, false); assert.equal(c.missionTime, 0); assert.equal(c.G.stats.objectives, 0);
  c.onComplete(); f.advance(60);
  assert.equal(c.state, 'playing'); assert.equal(f.outcomes.length, 1, 'A stale completion signal cannot win a fresh mission');
  c.mission.done = true; c.onComplete(); c.onComplete(); f.advance(2.5);
  assert.equal(f.outcomes.length, 2, 'A genuinely new mission may win once');
}
for (const savedBest of ['NaN', 'Infinity', '-1', 'invalid', null]) {
  const f = fixture({ savedBest }); f.context.onComplete(); f.advance(2.5);
  assert.ok(Number.isFinite(f.rows().Best), `Corrupt stored best ${savedBest} cannot poison the results`);
  assert.equal(f.rows().Best, f.rows().Score);
}
{
  const f = fixture({ storageThrows: true }); f.context.onComplete(); f.advance(2.5);
  assert.equal(f.context.state, 'complete', 'Blocked storage cannot prevent mission completion');
  assert.equal(f.rows().Best, f.rows().Score);
}
console.log('completion-presentation-check: actual completion/death/pause/retry/start functions preserve earned results, freeze menus/loss, and finish once on simulation time');
