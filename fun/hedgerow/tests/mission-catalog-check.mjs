// Catalog and legacy-selection behavior, without building a world or renderer.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { MISSIONS, pickMission, bestKey } from '../js/missions.js';

const ids = ['saint-clair', 'la-varenne', 'pont-tournant'];
assert.deepEqual(MISSIONS.map(mission => mission.id), ids, 'Only the three Normandy missions are selectable');
assert.equal(new Set(MISSIONS.map(mission => mission.id)).size, ids.length);
for (const mission of MISSIONS) {
  assert.equal(typeof mission.load, 'function');
  assert.ok(mission.title && mission.summary && mission.inspired);
  assert.equal(mission.image, `assets/missions/${mission.id}.webp`);
  const image = await readFile(new URL(`../${mission.image}`, import.meta.url));
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP', 'Every card points to a local WebP image');
}
assert.deepEqual((await readdir(new URL('../assets/missions/', import.meta.url))).filter(name => name.endsWith('.webp')).sort(), ids.map(id => `${id}.webp`).sort(), 'The local mission-art catalog contains exactly the three retained images');

for (const [asked, stored, expected] of [
  [null, null, 'saint-clair'],
  ['prague', null, 'saint-clair'],
  [null, 'prague', 'saint-clair'],
  ['prague', 'prague', 'saint-clair'],
  ['prague', 'la-varenne', 'la-varenne'],
  ['pont-tournant', 'prague', 'pont-tournant'],
  ['unknown', 'pont-tournant', 'pont-tournant'],
  ['saint-clair', 'la-varenne', 'saint-clair'],
]) assert.equal(pickMission(asked, stored).id, expected, `Mission resolution for URL ${asked} / stored ${stored}`);

assert.equal(bestKey('saint-clair'), 'hedgerow.best', 'The original Saint-Clair best score remains compatible');
for (const id of ids.slice(1)) assert.equal(bestKey(id), `hedgerow.best.${id}`);
console.log('mission-catalog-check: three local Normandy cards/images, legacy removed-mission fallback, valid selection precedence and best-score keys pass');
