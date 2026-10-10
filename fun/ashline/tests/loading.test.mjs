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

test('the generation worker transfers typed grids instead of copying them', async t => {
  const posted = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: { postMessage: (message, transfer) => posted.push({ message, transfer }) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'self', previous); else delete globalThis.self; });
  const { transferables } = await import(`../world-worker.js?test=${moduleId++}`);
  for (const profile of ['highlands', 'ember']) {
    const settings = { ...options, width: 144, height: 112, profile };
    globalThis.self.onmessage({ data: { seed: 'TRANSFER', difficulty: 'hard', options: settings } });
    const { message, transfer } = posted.at(-1), expected = createGame('TRANSFER', 'hard', settings);
    assert.deepEqual(transfer, transferables(message.game));
    for (const grid of [message.game.terrain, message.game.minerals, message.game.blocked, message.game.regions, ...message.game.visible, ...message.game.explored]) assert.ok(transfer.includes(grid.buffer), 'every typed grid is transferred');
    assert.equal(new Set(transfer).size, transfer.length, 'each buffer is listed once');
    // A real postMessage structured-clones with this transfer list: the page receives the same game and the
    // worker's copies are detached.
    const received = structuredClone(message, { transfer });
    assert.deepEqual(received.game, expected);
    assert.equal(message.game.terrain.byteLength, 0, 'worker grids are moved, not copied');
  }
  globalThis.self.onmessage({ data: { seed: 'BAD', difficulty: 'hard', options: { ...options, width: 1 } } });
  assert.match(posted.at(-1).message.error, /Unsupported map dimensions/);
});
