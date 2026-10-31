// Run with: node tests/pause-charge-check.mjs
// Execute the production interruption handlers with real input and physics;
// only their unrelated audio, rendering and menu dependencies are stand-ins.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createInput } from '../js/input.js';
import { Rider } from '../js/rider.js';
import { RIDER } from '../js/config.js';

const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start >= 0 && end > start, 'locate production handlers: ' + from);
  return source.slice(start, end);
}
const handlers = new vm.Script([
  section('function cancelJump() {', '\nconst input = createInput'),
  section('function begin() {', '\nlet lastPassedGate'),
  section("canvas.addEventListener('webglcontextlost'", '\n/* =========================================================================='),
].join('\n'));
const dt = 1 / 120;
const previousWindow = globalThis.window;
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });

function fixture(cause) {
  const rider = new Rider(THREE, { height: () => 0, canStall: () => false });
  const target = new EventTarget(), canvas = new EventTarget(), game = { mode: 'playing' };
  const counts = { launches: 0, lands: 0 };
  rider.on('launch', () => counts.launches++).on('land', () => counts.lands++);
  const context = vm.createContext({
    rider, canvas, game, bootReady: true, runStarted: true, contextLost: false,
    curtain: { dataset: {}, classList: { add() {}, remove() {} }, querySelector: () => null },
    curtainPointers: new Map(), curtainClickReady: false, curtainClickDevice: null,
    controllerNotice: { hidden: true }, pausedRendered: false, pausedWorldReady: false,
    audio: { start() {}, quiet() {}, muted: false }, retro: { fade() {} },
    sky: { refreshProbe() {} }, chase: { reset() {} }, scheduleResize() {},
    persistBest() {}, showMuted() {},
  });
  handlers.runInContext(context);
  const input = createInput(target, { cancelJump: () => context.cancelJump() });
  context.input = input;
  return {
    rider, game, counts, input,
    key(type) {
      const event = new Event(type, { cancelable: true });
      event.code = 'Space'; target.dispatchEvent(event);
    },
    step(ticks = 1) {
      for (let i = 0; i < ticks; i++) {
        input.update(dt, game.mode !== 'playing');
        if (game.mode === 'playing') { rider.step(dt, input.state); input.stepped(); }
      }
    },
    interrupt() {
      if (cause === 'pause') context.pause();
      else {
        const event = new Event('webglcontextlost', { cancelable: true });
        canvas.dispatchEvent(event);
        assert(event.defaultPrevented, 'context loss remains recoverable');
        context.begin();
        assert.equal(game.mode, 'paused', 'a lost graphics context cannot resume');
      }
      assert.equal(game.mode, 'paused');
    },
    resume() {
      if (cause === 'context loss') canvas.dispatchEvent(new Event('webglcontextrestored'));
      context.begin();
      assert.equal(game.mode, 'playing');
    },
    dispose: () => input.dispose(),
  };
}
function cancelled(rider, message) {
  assert.deepEqual([rider.charging, rider.charge, rider._jumpBuffer, rider._bufferCharge,
    rider.lipReady, rider.lipAhead], [false, 0, 0, 0, false, false], message);
}
function releaseJump(f) {
  const expected = RIDER.popMin + (RIDER.popMax - RIDER.popMin) * f.rider.charge;
  const before = f.counts.launches;
  f.key('keyup'); f.step();
  assert.equal(f.counts.launches, before + 1, 'a deliberate release still jumps');
  assert(Math.abs(f.rider.vel.y - expected) < 1e-8, 'the new charge alone determines its impulse');
}

try {
  for (const cause of ['pause', 'context loss']) {
    for (const held of [false, true]) {
      const f = fixture(cause);
      try {
        f.key('keydown'); f.step(60);
        assert.equal(f.rider.charge, 1, 'start with a fully charged grounded jump');
        f.interrupt();
        cancelled(f.rider, cause + ' cancels the charge immediately');
        if (!held) f.key('keyup');
        const position = f.rider.pos.clone();
        f.step(60);
        assert(f.rider.pos.equals(position), 'paused input polling does not step physics');
        f.resume(); f.step();
        assert.equal(f.rider.state, 'ride');
        assert.equal(f.counts.launches, 0, 'resume cannot spend the interrupted charge');
        if (held) {
          assert.equal(f.input.state.jump, true, 'the physically held key survives pause');
          assert(Math.abs(f.rider.charge - dt / RIDER.chargeTime) < 1e-8,
            'a key held through resume charges from zero');
        } else {
          cancelled(f.rider, 'a release during pause leaves no delayed jump');
          f.step(30);
          assert.equal(f.counts.launches, 0, 'later grounded steps cannot resurrect that release');
          f.key('keydown');
        }
        f.step(12); releaseJump(f);
      } finally { f.dispose(); }
    }
    for (const buffered of [false, true]) {
      const f = fixture(cause);
      try {
        f.key('keydown'); f.step(60); releaseJump(f);
        f.key('keydown');
        for (let i = 0; i < 240 && !(f.rider.vel.y < 0 && f.rider.pos.y < .25); i++) f.step();
        assert.equal(f.rider.state, 'air', 'the real jump is approaching touchdown');
        assert(f.rider.charging && f.rider.charge > .5, 'another hold builds an airborne charge');
        if (buffered) {
          f.key('keyup'); f.step();
          assert(f.rider._jumpBuffer > 0 && f.rider._bufferCharge > .5,
            'a real airborne release has queued the next grounded jump');
        }
        f.interrupt();
        if (!buffered) f.key('keyup');
        f.step(60);
        cancelled(f.rider, cause + ' clears airborne charge and any queued landing jump');
        f.resume(); f.step(60);
        assert.equal(f.counts.lands, 1, 'the original flight lands normally after resume');
        assert.equal(f.rider.state, 'ride');
        assert.equal(f.counts.launches, 1, 'touchdown cannot pop from the interrupted airborne charge');
      } finally { f.dispose(); }
    }
  }
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
  else delete globalThis.navigator;
}
console.log('Pause charge checks passed: pause/context recovery, released/held keys and airborne buffers.');
