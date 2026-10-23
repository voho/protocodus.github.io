// Run with: node fun/hedgerow/tests/loading-check.mjs
import assert from 'node:assert/strict';
import { createAssetProgress, createLoadingProgress, LOADING_STAGES } from '../js/loading.js';

const snapshots = [];
const loading = createLoadingProgress(s => snapshots.push(s));
loading.update('textures', 0, 'Preparing graphics');
assert.equal(snapshots.at(-1).stages[0].state, 'loading');
assert.equal(snapshots.at(-1).remaining, 5);
loading.update('textures', 1);

const downloads = [];
const progress = createAssetProgress(['village', 'nature', 'soldier'], (fraction, info) => {
  downloads.push({ fraction, ...info });
  loading.update('models', fraction, `${info.completed} sets ready`);
});
// Interleaved byte events used to replace each other's partial progress.
progress('village', 0.9);
progress('nature', 0.1);
assert.ok(Math.abs(downloads.at(-1).fraction - 1 / 3) < 1e-10);
progress('soldier', 0.6);
progress('village', 1);
progress('nature', 0.2);
progress('soldier', 0.1); // stale event cannot rewind the bar
progress('village', 0.3); // completed extraction stays done
assert.equal(downloads.at(-1).completed, 1);
assert.ok(downloads.every((s, i) => !i || s.fraction >= downloads[i - 1].fraction));
assert.notEqual(loading.snapshot().stages[1].state, 'done', 'downloaded/partial models are not marked ready');
progress('nature', 1);
progress('soldier', 1);
assert.equal(downloads.at(-1).completed, 3);
assert.equal(loading.snapshot().completed, 2);

for (const id of ['world', 'soldiers', 'shaders']) {
  loading.update(id, 0, `Preparing ${id}`);
  loading.update(id, 0.9);
  loading.update(id, 0.2);
  if (id === 'shaders') assert.ok(loading.snapshot().fraction < 1, '100% waits for graphics and first frame');
  loading.update(id, 1);
}
loading.update('models', 0.5, 'A late download callback');
const final = loading.snapshot();
assert.equal(final.fraction, 1);
assert.equal(final.completed, LOADING_STAGES.length);
assert.equal(final.remaining, 0);
assert.ok(final.stages.every(s => s.state === 'done'));
assert.ok(snapshots.every((s, i) => !i || s.fraction >= snapshots[i - 1].fraction));
assert.ok(snapshots.every((s, i) => !i || s.completed >= snapshots[i - 1].completed));
loading.update('world', NaN);
assert.equal(loading.snapshot().fraction, 1);
console.log('loading-check: parallel asset progress never regresses; stages stay done; readiness waits for all work');
