import assert from 'node:assert/strict';
import { hashLevel, MAP_TILE_SIZE, tileAt } from '../tile-map.js';

const worlds = ['jungle', 'snow', 'desert', 'paradise', 'asteroid', 'mars', 'volcanic', 'neon', 'alien', 'void'];
assert.equal(MAP_TILE_SIZE, 100);
assert.equal(hashLevel('jungle'), hashLevel('jungle', 'tyran-v2'));
assert.equal(new Set(worlds.map(id => hashLevel(id))).size, worlds.length);
assert.notEqual(hashLevel('jungle', 'a'), hashLevel('jungle', 'b'));
assert.notEqual(hashLevel('bc', 'a'), hashLevel('c', 'ab'));

for (const [biome, id] of worlds.entries()) {
  const seed = hashLevel(id), changedSeed = hashLevel(id, 'another-flight');
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  const cells = [];
  for (let row = -90; row < 90; row++) {
    for (let col = -2; col < 14; col++) cells.push(tileAt(seed, biome, col, row));
  }
  let changed = 0, connected = 0;
  const counts = [0, 0, 0, 0];
  for (let i = cells.length - 1; i >= 0; i--) {
    const tile = cells[i], { col, row } = tile;
    // Reverse-order generation is identical and never relies on prior chunks.
    assert.deepEqual(tileAt(seed, biome, col, row), tile);
    if (tileAt(changedSeed, biome, col, row).material !== tile.material) changed++;
    counts[tile.material]++;
    assert.ok(tile.variant >= 0 && tile.variant < 6);
    assert.ok(tile.detail >= 0 && tile.detail < 1);
    assert.equal(tile.elevation, tile.material);
    assert.equal(tile.cornerMasks[0], 15);
    const east = tileAt(seed, biome, col + 1, row), south = tileAt(seed, biome, col, row + 1);
    assert.equal(Boolean(tile.edgeMask & 2), east.material === tile.material);
    assert.equal(Boolean(east.edgeMask & 8), east.material === tile.material);
    assert.equal(Boolean(tile.edgeMask & 4), south.material === tile.material);
    assert.equal(Boolean(south.edgeMask & 1), south.material === tile.material);
    if (east.material === tile.material) connected++;
    if (south.material === tile.material) connected++;
    for (let layer = 1; layer <= 3; layer++) {
      const mask = tile.cornerMasks[layer];
      assert.equal(mask & tile.cornerMasks[layer - 1], mask, 'higher terrain must sit within lower terrain');
      assert.equal(Boolean(mask & 2), Boolean(east.cornerMasks[layer] & 1), 'shared northeast corner');
      assert.equal(Boolean(mask & 4), Boolean(east.cornerMasks[layer] & 8), 'shared southeast corner');
      assert.equal(Boolean(mask & 8), Boolean(south.cornerMasks[layer] & 1), 'shared southwest corner');
      assert.equal(Boolean(mask & 4), Boolean(south.cornerMasks[layer] & 2), 'shared southeast corner');
    }
  }
  assert.ok(counts.every(count => count > cells.length * .01), `${id} has all four terrain materials: ${counts}`);
  assert.ok(changed > cells.length * .12, `${id} changes materially with its seed`);
  assert.ok(connected > cells.length, `${id} forms coherent patches, not random checkerboards`);
  // A long move cannot simply repeat the former tall painting at a fixed period.
  assert.ok(cells.slice(0, 200).some(tile =>
    tileAt(seed, biome, tile.col, tile.row + 256).material !== tile.material));
  console.log(`PASS ${id}: stable infinite terrain, shared corners, material mix [${counts.join(', ')}]`);
}
