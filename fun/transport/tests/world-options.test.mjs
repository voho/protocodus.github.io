import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, validateGame, WORLD_SIZES, INDUSTRIES } from '../model.js';
import { worldGenerationOptions, generateWorld } from '../world.js';
import { encodeGame, decodeGame, inspectSavedGame } from '../save-codec.js';

test('world choices retain existing defaults and provide independent bounded counts', () => {
  for (const size of ['square512', 'square1024', 'square2048']) for (const biome of ['taiga','tundra','desert']) {
    const choices = worldGenerationOptions(size, biome);
    assert.equal(choices.townCount, WORLD_SIZES[size].towns);
    assert.equal(choices.industryDistricts, WORLD_SIZES[size].clusters);
    assert.equal(choices.minTowns, 2);
    assert.equal(choices.maxTowns, WORLD_SIZES[size].towns * 2);
    assert.equal(choices.industriesPerDistrict, Object.values(INDUSTRIES).filter(i => i.biomes.includes(biome)).length);
  }
  const base = createGame({size:'square512'});
  const explicit = createGame({size:'square512',townCount:48,industryDistricts:8});
  assert.equal(explicit.generationOptions, undefined);
  assert.deepEqual(explicit, base, 'selecting defaults preserves the original terrain and seeded simulation exactly');
});

for (const biome of ['taiga','tundra','desert']) test(`${biome}: custom density preserves complete chains and survives a procedural save`, () => {
  const game = createGame({biome,size:'square512',seed:92137,townCount:12,industryDistricts:3});
  assert.equal(game.cities.length,12);
  for (const [kind,definition] of Object.entries(INDUSTRIES)) if (definition.biomes.includes(biome)) assert.equal(game.industries.filter(i=>i.kind===kind).length,3);
  assert.ok(validateGame(game));
  // Include a change away from the opening towns to exercise the saved recipe
  // instead of merely comparing independently generated entity metadata.
  game.tiles[200*game.width+200].road=true;
  const saved=JSON.parse(JSON.stringify(encodeGame(game)));
  assert.equal(saved.format,'transport-procedural-v1');
  assert.deepEqual(saved.generation.options,{townCount:12,industryDistricts:3});
  assert.deepEqual(inspectSavedGame(saved).generationOptions,saved.generation.options);
  const restored=decodeGame(saved);
  assert.ok(validateGame(restored));
  assert.deepEqual(restored,game);
});

test('sparse towns and dense industry districts can be chosen independently',()=>{
  for (const [townCount,industryDistricts] of [[2,16],[96,1]]) {
    const game=createGame({size:'square512',townCount,industryDistricts});
    assert.equal(game.cities.length,townCount);
    assert.equal(game.industries.length,industryDistricts*worldGenerationOptions('square512','taiga').industriesPerDistrict);
    assert.ok(validateGame(game));
  }
});

test('invalid or mismatched generation options fail before regenerating terrain',()=>{
  for (const values of [{townCount:1},{townCount:97},{townCount:4.5},{industryDistricts:0},{industryDistricts:17},{industryDistricts:'2'}]) assert.throws(()=>createGame({size:'square512',...values}),/generation options/);
  assert.throws(()=>generateWorld('taiga',1,'square512',6,{townCount:4,industryDistricts:1}),/generation options/);
  const game=createGame({size:'square512',townCount:4,industryDistricts:1}),saved=encodeGame(game);
  for (const mutate of [
    s=>delete s.generation.options,
    s=>s.generation.options.townCount++,
    s=>s.state.generationOptions.industryDistricts++,
    s=>s.generation.options={townCount:1e8,industryDistricts:1},
    s=>s.state.generationOptions=null,
  ]) {
    const corrupt=structuredClone(saved);mutate(corrupt);
    assert.throws(()=>inspectSavedGame(corrupt),/generation options/);
    assert.throws(()=>decodeGame(corrupt),/generation options/);
  }
});
