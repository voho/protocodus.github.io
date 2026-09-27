import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame } from '../sim.js';

const options = { width: 72, height: 56, profile: 'highlands', races: ['aiUnity', 'organics'], aiTeams: [] };
let moduleId = 0;
async function setup(t, protocol, Worker) {
  for (const [key, value] of Object.entries({ location: { protocol }, Worker,
    requestAnimationFrame: callback => setTimeout(callback, 0) })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  return import(`../loading.js?test=${moduleId++}`);
}

test('file previews generate the same map after yielding, without constructing a worker', async t => {
  const { generateOperation } = await setup(t, 'file:', class { constructor() { assert.fail('File previews must not construct workers'); } });
  let finished = false;
  const pending = generateOperation('LOCAL-PREVIEW', 'hard', options).then(game => { finished = true; return game; });
  await Promise.resolve();
  assert.equal(finished, false, 'Loading UI gets a paint opportunity before generation');
  assert.deepEqual(await pending, createGame('LOCAL-PREVIEW', 'hard', options));
  await assert.rejects(generateOperation('INVALID', 'hard', { ...options, width: 1 }), /Unsupported map dimensions/);
});

test('worker infrastructure failures preserve deterministic generation', async t => {
  let stopped = false;
  const { generateOperation } = await setup(t, 'https:', class {
    postMessage() { queueMicrotask(() => this.onerror({ preventDefault() {} })); }
    terminate() { stopped = true; }
  });
  assert.deepEqual(await generateOperation('WORKER-FALLBACK', 'easy', options), createGame('WORKER-FALLBACK', 'easy', options));
  assert.equal(stopped, true, 'Failed worker is terminated before local generation');
});

test('worker generation errors are surfaced without retrying on the main thread', async t => {
  let stopped = false;
  const { generateOperation } = await setup(t, 'https:', class {
    postMessage() { queueMicrotask(() => this.onmessage({ data: { error: 'Invalid generated sector' } })); }
    terminate() { stopped = true; }
  });
  await assert.rejects(generateOperation('ERROR', 'normal', options), /Invalid generated sector/);
  assert.equal(stopped, true);
});
