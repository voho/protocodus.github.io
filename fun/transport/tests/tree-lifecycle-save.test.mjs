import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../model.js';
import { encodeGame, decodeGame, inspectSavedGame, encodeBytes } from '../save-codec.js';

const flatGame = () => ({ width: 32, height: 32, day: 4000, seed: 12, treeLifecycleEpoch: 0,
  tiles: Array.from({ length: 1024 }, (_, i) => ({ terrain: 'forest', detail: 'pine', variant: i % 7, elevation: .2,
    building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false,
    ...(i % 3 === 0 ? { treeBornDay: i - 3000 } : i % 3 === 1 ? { treeClearedDay: 3800 + i % 10 } : {}),
    ...(i % 19 === 0 ? { futureEcology: { keep: true } } : {}) })) });

test('compact woodland dates remain lossless and share space with arbitrary older tile extras', () => {
  const game = flatGame(), packed = encodeGame(game);
  assert.deepEqual(decodeGame(packed), game);
  assert.equal(inspectSavedGame(packed).treeLifecycleEpoch, 0);
  const legacy = structuredClone(packed); delete legacy.tiles.treeDates;
  const extras = new Map(legacy.tiles.extras);
  game.tiles.forEach((tile, ordinal) => {
    if (tile.treeBornDay !== undefined) extras.set(ordinal, { ...extras.get(ordinal), treeBornDay: tile.treeBornDay });
    if (tile.treeClearedDay !== undefined) extras.set(ordinal, { ...extras.get(ordinal), treeClearedDay: tile.treeClearedDay });
  });
  legacy.tiles.extras = [...extras];
  assert.deepEqual(decodeGame(legacy), game, 'pre-column saves still restore their exact clocks');
  assert.ok(JSON.stringify(packed).length < JSON.stringify(legacy).length * .65, 'aging thousands of trees does not turn repeated JSON keys into save bloat');
});

test('procedural baseline deltas preserve tree clocks and unchanged shared terrain parcels', () => {
  const game = createGame({ size: 'square512', seed: 1958 });
  for (let i = 0; i < 6000; i++) {
    if (i % 2) game.tiles[i].treeBornDay = -(i % 3000);
    else game.tiles[i].treeClearedDay = 0;
  }
  const packed = encodeGame(game);
  assert.equal(packed.tiles.layout, 'baseline-xor-v1');
  assert.equal(packed.tiles.treeDates.count, 6000);
  const restored = decodeGame(packed);
  assert.deepEqual(restored.tiles, game.tiles);
  assert.deepEqual(encodeGame(restored), packed, 'saving a resumed company retains the same sparse columns');
});

test('save inspection rejects corrupt date columns before a world is regenerated', () => {
  const packed = encodeGame(flatGame());
  const broken = mutate => { const copy = structuredClone(packed); mutate(copy.tiles.treeDates); assert.throws(() => inspectSavedGame(copy)); assert.throws(() => decodeGame(copy)); };
  broken(dates => { dates.count = 3000; });
  broken(dates => { dates.days = ['wrong']; });
  broken(dates => { dates.data = dates.data.slice(0, -1); });
  broken(dates => { dates.count = 1; dates.days = [0]; dates.data = encodeBytes(new Uint8Array([128, 128, 128, 128, 1, 0]), 'utf16-15'); });
  broken(dates => { dates.count = 1; dates.days = [0]; dates.data = encodeBytes(new Uint8Array([0, 1]), 'utf16-15'); });
  broken(dates => { dates.count = 2; dates.days = [0]; dates.data = encodeBytes(new Uint8Array([0, 0, 0, 0]), 'utf16-15'); });
});
