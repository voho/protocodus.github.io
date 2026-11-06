// Production menu/lifecycle hook, with renderer resources replaced by
// counters. The actual GL pixels/context generations have a separate probe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function installGraphicsRecovery('), end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start);
function fixture(daylight = true) {
  const listeners = new Map(), status = { hidden: true, textContent: '' };
  const buttons = [{ disabled: false }, { disabled: true }], calls = [];
  const shadow = { map: { dispose: () => calls.push('shadow') }, mapPass: { dispose: () => calls.push('shadow-pass') } };
  const targets = { day: { texture: 'new-day' }, night: { texture: 'new-night' } };
  const resources = { clear: () => calls.push('clear'), bake: () => { calls.push('bake'); return targets; }, releaseTemporary: () => calls.push('release') };
  const context = createContext({ graphicsLost: false, state: 'playing',
    canvas: { addEventListener: (name, callback) => listeners.set(name, callback) },
    $: () => status, document: { querySelectorAll: () => buttons },
    G: { daylight, environments: {} }, scene: { environment: 'old', traverse: callback => callback({ isLight: true, shadow }) }, camera: {},
    player: { releaseGraphicsResources: () => calls.push('owned-player-resources') },
    input: { enable: on => calls.push(`input-${on}`), exitLock: () => calls.push('unlock') }, audio: { suspend: () => calls.push('suspend') },
    renderer: { shadowMap: {}, setRenderTarget: value => { assert.equal(value, null); calls.push('target-default'); }, setSize: (width, height, css) => { assert.equal(width, 1); assert.equal(height, 1); assert.equal(css, false); calls.push('retire-buffers'); }, render: () => { assert.ok(buttons[0].disabled, 'first valid frame precedes enabled controls'); calls.push('render'); } },
    adapt: { reset: () => calls.push('adapt') }, taa: { dispose: () => calls.push('retire-history'), reset: () => calls.push('taa'), jitter() {}, restore: () => calls.push('projection-restored') }, blur: null,
    applyGraphics: () => calls.push('graphics'), console: { error: (...args) => calls.push(args[0]) },
  });
  context.pause = () => { context.state = 'paused'; calls.push('pause'); };
  runInContext(source.slice(start, end + 2), context);
  context.installGraphicsRecovery(resources);
  return { context, listeners, status, buttons, calls, resources, targets, shadow };
}
for (const daylight of [false, true]) {
  const f = fixture(daylight);
  f.listeners.get('webglcontextrestored')(); assert.deepEqual(f.calls, [], 'an unrelated restore cannot rebake a live world');
  let prevented = false;
  f.listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.ok(prevented); assert.equal(f.context.graphicsLost, true); assert.equal(f.context.state, 'paused');
  assert.equal(f.status.hidden, false); assert.ok(f.buttons.every(b => b.disabled));
  assert.equal(f.context.G.environments, null); assert.equal(f.context.scene.environment, null);
  assert.equal(f.shadow.map, null); assert.equal(f.shadow.mapPass, null); assert.equal(f.shadow.needsUpdate, true);
  f.listeners.get('webglcontextrestored')();
  assert.equal(f.context.graphicsLost, false); assert.equal(f.context.state, 'paused', 'restoration never resumes combat automatically');
  assert.equal(f.context.scene.environment, daylight ? 'new-day' : 'new-night');
  assert.deepEqual(f.buttons.map(b => b.disabled), [false, true], 'previous disabled states are retained');
  assert.equal(f.status.hidden, true);
  assert.ok(f.calls.indexOf('clear') < f.calls.indexOf('bake'));
  assert.ok(f.calls.indexOf('owned-player-resources') < f.calls.indexOf('bake'));
  assert.ok(f.calls.indexOf('retire-history') < f.calls.indexOf('bake'));
  assert.ok(f.calls.indexOf('retire-buffers') < f.calls.indexOf('bake'));
  assert.ok(f.calls.indexOf('adapt') < f.calls.indexOf('render'));
  assert.ok(f.calls.indexOf('taa') < f.calls.indexOf('render'));
}
{
  const f = fixture(); f.listeners.get('webglcontextlost')({ preventDefault() {} });
  f.resources.bake = () => { throw new Error('device unavailable'); };
  f.listeners.get('webglcontextrestored')();
  assert.equal(f.context.graphicsLost, true); assert.equal(f.context.state, 'paused');
  assert.ok(f.buttons.every(b => b.disabled)); assert.match(f.status.textContent, /Reload the page/);
  assert.ok(!f.calls.includes('render'));
}
{
  const f = fixture(); f.listeners.get('webglcontextlost')({ preventDefault() {} });
  f.context.renderer.render = () => { throw new Error('restored shader unavailable'); };
  f.listeners.get('webglcontextrestored')();
  assert.equal(f.context.graphicsLost, true); assert.ok(f.buttons.every(b => b.disabled));
  assert.ok(f.calls.includes('projection-restored'), 'a failed warm frame still restores the camera projection');
  assert.match(f.status.textContent, /Reload the page/);
}
console.log('graphics-recovery-check: real lifecycle hook pauses, preserves controls, rebuilds day/night resources before drawing and fails safely');
