import test from 'node:test';
import assert from 'node:assert/strict';
import { forestComposition } from '../tree-sprites.js';
import { BIOME_NATURE } from '../terrain-sprites.js';

for (const [biome, nature] of Object.entries(BIOME_NATURE)) {
  test(`${biome} forests vary tree count, geometry, species and leaf coverage deterministically`, () => {
    let mixed = 0, bare = 0, leafy = 0;
    const sizes = new Set(), placements = new Set(), species = new Set();
    for (const detail of nature.trees) {
      const variants = Array.from({ length: 64 }, (_, variant) => forestComposition(biome, detail, variant));
      assert.equal(new Set(variants.map(trees => JSON.stringify(trees))).size, 64, `${detail} has 64 genuinely different tree arrangements`);
      assert.deepEqual([...new Set(variants.map(trees => trees.length))].sort(), [1, 2, 3, 4, 5]);
      for (const [variant, trees] of variants.entries()) {
        assert.deepEqual(forestComposition(biome, detail, variant), trees, 'regenerating at another zoom keeps the same composition');
        assert.deepEqual(forestComposition(biome, detail, variant + 64), trees, 'the atlas bounds its variant count');
        assert.deepEqual(forestComposition(biome, detail, variant - 64), trees, 'legacy negative seeds wrap consistently');
        assert.deepEqual(trees.map(tree => tree.y), trees.map(tree => tree.y).sort((a, b) => a - b), 'trunks draw from back to front');
        if (new Set(trees.map(tree => tree.species)).size > 1) mixed++;
        for (const tree of trees) {
          assert.ok(tree.x > 0 && tree.x < 32 && tree.y > -8 && tree.y < 32, 'tree roots fit the logical tile');
          assert.ok(Number.isFinite(tree.size) && tree.size > 0 && tree.size < 30);
          assert.ok(Number.isInteger(tree.seed) && tree.seed >= 0 && tree.seed < 4294967296);
          assert.equal(typeof tree.bare, 'boolean');
          if (detail === 'deadwood') assert.equal(tree.bare, true, 'deadwood preserves visible branch skeletons');
          sizes.add(tree.size.toFixed(2)); placements.add(`${tree.x.toFixed(2)}:${tree.y.toFixed(2)}`); species.add(tree.species);
          if (detail !== 'deadwood') tree.bare ? bare++ : leafy++;
        }
      }
    }
    assert.ok(mixed > 10, 'woodland includes stands mixing multiple species');
    assert.ok(species.size >= 4, 'each biome has recognizably different species');
    assert.ok(bare > 0 && leafy > bare, 'bare trunks coexist with a mostly leafy canopy');
    assert.ok(sizes.size > 100 && placements.size > 100, 'tree sizes and positions vary rather than repeating an atlas stamp');
    assert.deepEqual([...new Set(Array.from({ length: 64 }, (_, v) => forestComposition(biome, 'sparse', v).length))].sort(), [1, 2]);
    assert.deepEqual([...new Set(Array.from({ length: 64 }, (_, v) => forestComposition(biome, 'dense', v).length))].sort(), [3, 4, 5]);
  });
}
