// Exercise the real entrypoint's retry/pause/resume functions. The old
// 350ms wall callback could revive and teleport a paused/lost world later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
function fixture({ state = 'dead', done = false, lost = false } = {}) {
  const calls = [], timers = [], screens = [], nodes = new Map();
  const spawn = [20, 0, 70], inventory = { weapon: 'garand', mag: 4 };
  const record = name => (...args) => calls.push({ name, args });
  const classList = { add: record('bodyClassAdd'), remove: record('bodyClassRemove') };
  const clear = name => ({ clear: record(name) });
  const context = createContext({
    graphicsLost: lost, completionPresentation: { stale: true }, completionRecorded: true,
    deathSequence: 4, state, screenStack: [], missionTime: 31,
    player: { alive: state === 'paused', health: state === 'paused' ? 37 : 0, pos: [10, 0, 40],
      char: { ragdoll: { cancelImpact: record('cancelPlayerImpact') } },
      reset(at, saved) {
        calls.push({ name: 'playerReset', args: [at, saved] });
        this.alive = true; this.health = 100; this.pos = [...at];
      } },
    mission: { done,
      restoreCheckpoint() { calls.push({ name: 'restoreCheckpoint' }); return { spawn, inventory }; } },
    G: { stats: { kills: 7, deaths: 1 },
      enemies: Array.from({ length: 2 }, () => ({ char: { ragdoll: { cancelImpact: record('cancelEnemyImpact') } } })),
      debris: clear('clearDebris'), casings: clear('clearCasings'), chunks: clear('clearChunks'), steam: clear('clearSteam') },
    enemies: { resetLiving: record('resetEnemies') }, explosives: clear('clearFuses'),
    fade: { classList: { add: record('fadeAdd'), remove: record('fadeRemove') } },
    audio: { cancelContacts: record('cancelContacts'), cancelActions: record('cancelActions'),
      suspend: record('audioSuspend'), resume: record('audioResume') },
    hud: { hideCrosshair() {}, show() {} },
    input: { enable(on) { calls.push({ name: 'enableInput', on, alive: context.player.alive, pos: [...context.player.pos] }); },
      exitLock() {}, requestLock: record('requestLock') },
    document: { body: { classList }, querySelectorAll: () => [] },
    LEVEL: { title: 'La Varenne', objectives: [] }, formatTime: () => '0:31',
    screenEls: { pause: { scrollTop: 0, querySelector: () => ({ scrollTop: 0 }) } },
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', append() {} }); return nodes.get(selector); },
    show: name => screens.push(name), trackAttemptStart: record('attemptStart'),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
  });
  for (const name of ['retryCheckpoint', 'cancelCompletionPresentation', 'resume', 'pause']) {
    const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, `${name} exists in the real entrypoint`);
    runInContext(source.slice(start, end + 2), context);
  }
  const snapshot = () => JSON.stringify({ state: context.state, lost: context.graphicsLost,
    screen: screens.at(-1), health: context.player.health, alive: context.player.alive,
    pos: context.player.pos, stats: context.G.stats, calls: calls.length });
  return { context, calls, timers, screens, spawn, inventory, snapshot };
}

for (const origin of ['dead', 'paused']) {
  const f = fixture({ state: origin }), c = f.context;
  const stats = c.G.stats;
  c.retryCheckpoint();
  assert.equal(f.timers.length, 0, 'Checkpoint retry schedules no delayed world mutation');
  assert.equal(c.state, 'playing'); assert.equal(c.player.alive, true); assert.equal(c.player.health, 100);
  assert.deepEqual(c.player.pos, f.spawn);
  assert.equal(c.G.stats, stats, 'A checkpoint preserves earned kill/death statistics');
  assert.equal(c.deathSequence, 5, 'The previous death presentation is invalidated once');
  assert.equal(c.completionPresentation, null); assert.equal(c.completionRecorded, false);
  for (const name of ['restoreCheckpoint', 'clearFuses', 'clearDebris', 'clearCasings', 'clearChunks', 'clearSteam',
    'resetEnemies', 'playerReset', 'attemptStart', 'cancelPlayerImpact', 'cancelContacts', 'cancelActions']) {
    assert.equal(f.calls.filter(call => call.name === name).length, 1, `${name} runs once in the click task`);
  }
  assert.equal(f.calls.filter(call => call.name === 'cancelEnemyImpact').length, 2);
  const reset = f.calls.find(call => call.name === 'playerReset');
  assert.equal(reset.args[0], f.spawn); assert.equal(reset.args[1], f.inventory, 'Saved checkpoint inventory reaches the reset');
  const enable = f.calls.find(call => call.name === 'enableInput' && call.on);
  assert.ok(enable?.alive && JSON.stringify(enable.pos) === JSON.stringify(f.spawn),
    'Input is enabled only after the checkpoint soldier is ready');
  const enableAt = f.calls.indexOf(enable);
  for (const name of ['clearFuses', 'clearDebris', 'clearCasings', 'clearChunks', 'clearSteam', 'resetEnemies', 'playerReset']) {
    assert.ok(f.calls.findIndex(call => call.name === name) < enableAt, `${name} finishes before Resume enables play`);
  }
  assert.equal(f.calls.some(call => call.name === 'fadeAdd' && call.args[0] === 'on'), false,
    'Retry has no black interval during already enabled movement');
  c.pause(); c.show('settings'); const paused = f.snapshot();
  for (const timer of f.timers) timer.callback();
  assert.equal(f.snapshot(), paused, 'No wall callback can revive/reset or start an attempt during paused Settings');
  c.graphicsLost = true; const lost = f.snapshot();
  for (const timer of f.timers) timer.callback();
  assert.equal(f.snapshot(), lost, 'No delayed retry mutation survives into graphics loss');
}
for (const blocked of [{ done: true }, { lost: true }]) {
  const f = fixture(blocked), before = f.snapshot();
  f.context.retryCheckpoint();
  assert.equal(f.snapshot(), before, 'Won or graphics-lost checkpoint requests leave the world unchanged');
  assert.equal(f.timers.length, 0);
}
console.log('checkpoint-transition-check: actual retry synchronously resets once before play, leaves no delayed pause/loss mutation, and blocks invalid requests');
