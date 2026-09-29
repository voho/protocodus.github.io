import test from 'node:test';
import assert from 'node:assert/strict';
import { BIOMES, BUILD_COSTS, INDUSTRIES, TOWN_CARGO, WORKSHOP, WORKSHOP_RECIPES } from '../data.js';

test('workshop recipes take what the environment makes and sell to towns, and never feed each other', () => {
  assert.deepEqual(Object.keys(WORKSHOP_RECIPES).sort(), Object.keys(BIOMES).sort());
  assert.equal(BUILD_COSTS.workshop, WORKSHOP.cost);
  for (const [biome, recipes] of Object.entries(WORKSHOP_RECIPES)) {
    assert.ok(recipes.length > 0, biome);
    const made = new Set(Object.values(INDUSTRIES).filter(site => site.biomes.includes(biome)).flatMap(site => Object.keys(site.outputs)));
    for (const { input, output } of recipes) {
      assert.ok(made.has(input), `${biome}: ${input} is made by an industry here`);
      assert.ok(TOWN_CARGO.includes(output), `${biome}: towns buy ${output}`);
    }
    const inputs = new Set(recipes.map(recipe => recipe.input));
    assert.ok(recipes.every(recipe => !inputs.has(recipe.output)), `${biome}: no product is a material`);
  }
  const all = Object.values(WORKSHOP_RECIPES).flat();
  assert.ok(all.every(recipe => !all.some(other => other.input === recipe.output)), 'no product is any recipe’s material');
});
