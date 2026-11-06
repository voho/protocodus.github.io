// Exercise the real entrypoint's death presentation without a renderer.
// Pausing before its delay used to consume the wall timer permanently,
// leaving a dead soldier with no checkpoint menu after resuming.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
function fixture(killer = null) {
  const shown = [], notices = [], calmed = [], outcomes = [];
  const context = createContext({
    deathSequence: 0, deathPresentation: null, state: 'playing',
    player: { alive: false, killer, pos: { x: 0, z: 0 } },
    mission: { done: false }, G: { stats: { deaths: 0 } },
    KILLER_NAME: { rifle: 'a rifleman' }, audio: { cancelActions() {} },
    trackAttemptEnd: result => outcomes.push(result),
    hud: { notice: (...args) => notices.push(args), hideCrosshair() {}, calm: on => calmed.push(on) },
    input: { enable() {}, exitLock() {} },
    document: { body: { classList: { remove() {} } } }, show: screen => shown.push(screen),
  });
  for (const name of ['onDeath', 'updateDeathPresentation']) {
    const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, `${name} exists in the entrypoint`);
    runInContext(source.slice(start, end + 2), context);
  }
  function advance(seconds) {
    while (seconds > 1e-9) {
      const dt = Math.min(.05, seconds); context.updateDeathPresentation(dt); seconds -= dt;
    }
  }
  return { context, advance, shown, notices, calmed, outcomes };
}

{
  const { context, advance, shown, calmed, outcomes } = fixture();
  context.onDeath(); advance(.8);
  context.state = 'paused'; advance(60);
  assert.ok(Math.abs(context.deathPresentation.elapsed - .8) < 1e-9, 'pause freezes the death camera');
  assert.deepEqual(shown, []); assert.deepEqual(calmed, []);
  context.state = 'playing'; advance(.15);
  assert.deepEqual(calmed, [true], 'the damage fade resumes on simulation time');
  advance(1.6); assert.deepEqual(shown, [], 'resuming preserves the remaining camera delay');
  advance(.1); assert.deepEqual(shown, ['dead']); assert.equal(context.state, 'dead');
  advance(30); assert.deepEqual(shown, ['dead'], 'the checkpoint menu appears exactly once');
  assert.deepEqual(outcomes, ['loss']); assert.equal(context.G.stats.deaths, 1);
}
{
  const { context, advance, shown, notices } = fixture({ type: 'rifle', pos: { x: 0, z: 25 } });
  context.onDeath(); advance(3);
  assert.deepEqual(shown, [], 'the named killer has time to appear in the longer death camera');
  assert.equal(notices[0][0], 'Killed by a rifleman'); assert.equal(notices[0][1], '25 m');
  context.state = 'paused'; advance(10); context.state = 'playing'; advance(2.25);
  assert.deepEqual(shown, ['dead']);
}
for (const interruption of ['retry', 'revive']) {
  const { context, advance, shown } = fixture();
  context.onDeath(); advance(.5);
  if (interruption === 'retry') context.deathSequence++;
  else context.player.alive = true;
  advance(10);
  assert.equal(context.deathPresentation, null); assert.deepEqual(shown, [], `${interruption} cancels the old presentation`);
}
console.log('death-camera-check: real death/menu functions preserve pause delay, show once and cancel stale retry/revive transitions');
