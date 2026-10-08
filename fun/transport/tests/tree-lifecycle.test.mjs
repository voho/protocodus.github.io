import test from 'node:test';
import assert from 'node:assert/strict';
import { treeLifecycle, canRegrowTree, validTreeLifecycleTile, TREE_LIFETIME_DAYS, TREE_GROWTH_DAYS, TREE_OLD_AGE_DAYS, TREE_FALLEN_DAYS, TREE_REGROWTH_DELAY } from '../tree-lifecycle.js';
import { stepEcology } from '../environment.js';
import { applyForestLifecycle, rasterForestComposition, forestLifecycleKey } from '../raster-nature.js';
import { encodeGame, decodeGame } from '../save-codec.js';
import { surfaceChangesSince } from '../change-journal.js';
import { allocateTerrainObjects } from '../world-terrain-objects.js';

function fixture(width = 1, height = 1) {
  return { seed: 1947, biome: 'taiga', width, height, day: 0, treeLifecycleEpoch: 0, revision: 0, networkRevision: 7,
    cities: [], industries: [], stations: [], routes: [], zones: [],
    tiles: Array.from({ length: width * height }, (_, index) => ({ terrain: 'forest', detail: 'pine', variant: index % 64, elevation: .2, road: false, rail: false, bridge: false, tunnel: false, publicRoad: false, building: null, zone: null })) };
}

test('a recruited tree grows, ages, falls and leaves empty land on its ten-year calendar', () => {
  const game = fixture(), tile = game.tiles[0]; tile.treeBornDay = 0;
  const at = day => treeLifecycle(game, 0, 0, tile, day);
  assert.equal(at(0).stage, 'young'); assert.equal(at(0).scale, .38);
  assert.ok(at(TREE_GROWTH_DAYS / 2).scale > at(0).scale);
  assert.equal(at(TREE_GROWTH_DAYS - 1).stage, 'young');
  assert.equal(at(TREE_GROWTH_DAYS).stage, 'mature'); assert.equal(at(TREE_GROWTH_DAYS).scale, 1);
  assert.equal(at(TREE_OLD_AGE_DAYS - 1).stage, 'mature');
  assert.equal(at(TREE_OLD_AGE_DAYS).stage, 'old');
  assert.equal(at(TREE_LIFETIME_DAYS - TREE_FALLEN_DAYS - 1).stage, 'old');
  game.day = TREE_LIFETIME_DAYS - TREE_FALLEN_DAYS;
  assert.equal(at(game.day).stage, 'fallen'); assert.equal(stepEcology(game), 0);
  assert.equal(tile.detail, 'pine', 'the fallen tree keeps its species and ground placement seed'); assert.equal(tile.treeBornDay, 0);
  game.day = TREE_LIFETIME_DAYS;
  const revision = game.revision; assert.equal(stepEcology(game), 1);
  assert.equal(tile.terrain, 'grass'); assert.equal(tile.detail, ''); assert.equal(tile.treeBornDay, undefined);
  assert.equal(tile.treeClearedDay, game.day); assert.deepEqual([...surfaceChangesSince(game, revision)], [0]);
  assert.equal(at(game.day).stage, 'empty'); assert.equal(at(game.day).scale, 0);
  assert.equal(game.networkRevision, 7);
});

test('initial trees have repeatable mixed ages without adding metadata to world tiles', () => {
  const game = fixture(32, 32), before = structuredClone(game);
  const lives = game.tiles.map((tile, index) => treeLifecycle(game, index % game.width, Math.floor(index / game.width), tile));
  assert.deepEqual(game, before, 'rendering age is pure');
  const repeated = structuredClone(game);
  assert.deepEqual(repeated.tiles.map((tile, index) => treeLifecycle(repeated, index % game.width, Math.floor(index / game.width), tile)), lives);
  assert.deepEqual([...new Set(lives.map(life => life.stage))].sort(), ['mature', 'old', 'young']);
  assert.ok(new Set(lives.map(life => life.bornDay)).size > 500);
  const shifted = { ...game, seed: game.seed + 1 };
  assert.notEqual(treeLifecycle(shifted, 12, 9).bornDay, treeLifecycle(game, 12, 9).bornDay);
});

test('legacy adoption starts mixed ages at the saved day and inherited deadwood decays', () => {
  const fresh = fixture(), legacy = fixture(); legacy.day = legacy.treeLifecycleEpoch = 10000;
  assert.equal(treeLifecycle(legacy, 0, 0).stage, treeLifecycle(fresh, 0, 0).stage);
  assert.equal(treeLifecycle(legacy, 0, 0).ageDays, treeLifecycle(fresh, 0, 0).ageDays);
  const dead = legacy.tiles[0]; dead.detail = 'deadwood';
  const life = treeLifecycle(legacy, 0, 0);
  assert.equal(life.stage, 'fallen'); assert.ok(life.clearDay > legacy.day && life.clearDay <= legacy.day + TREE_FALLEN_DAYS);
  stepEcology(legacy); assert.equal(dead.treeBornDay, life.bornDay);
  legacy.day = life.clearDay; stepEcology(legacy);
  assert.equal(dead.terrain, 'grass'); assert.equal(dead.detail, '');
});

test('clearings stay bare for six months and then can recruit young trees from living neighbors', () => {
  const game = fixture(8, 8), index = 4 * game.width + 4, tile = game.tiles[index];
  Object.assign(tile, { terrain: 'grass', detail: '', treeClearedDay: 0 });
  for (const neighbor of game.tiles) if (neighbor !== tile) neighbor.treeBornDay = 0;
  const before = structuredClone(tile);
  for (let day = 1; day < TREE_REGROWTH_DELAY; day++) { game.day = day; stepEcology(game); assert.deepEqual(tile, before); }
  assert.equal(canRegrowTree(tile, TREE_REGROWTH_DELAY - 1), false);
  assert.equal(canRegrowTree(tile, TREE_REGROWTH_DELAY), true);
  for (let day = TREE_REGROWTH_DELAY; day <= 1800 && tile.terrain !== 'forest'; day++) { game.day = day; stepEcology(game); }
  assert.equal(tile.terrain, 'forest'); assert.ok(tile.treeBornDay >= TREE_REGROWTH_DELAY);
  assert.equal(tile.treeClearedDay, undefined); assert.equal(treeLifecycle(game, 4, 4).stage, 'young');
});

test('tree succession preserves occupied sites, infrastructure, water and engineered terrain', () => {
  const game = fixture(24, 24), protectedIndexes = [];
  const protect = (x, changes) => { const index = 10 * game.width + x; Object.assign(game.tiles[index], changes, { treeBornDay: 0 }); protectedIndexes.push(index); };
  for (const [x, key] of ['road','rail','bridge','tunnel','publicRoad','zone'].entries()) protect(x + 1, { [key]: key === 'zone' ? 'residential' : true });
  protect(7, { building: { kind: 'house-expensive-1', footprint: 3, level: 1 } });
  protect(8, {}); protect(9, {});
  protect(11, {}); game.stations.push({ id: 's', x: 11, y: 10, mode: 'road' });
  protect(12, {}); game.industries.push({ id: 'i', kind: 'farm', x: 12, y: 10, footprint: 5 });
  for (const [x, terrain] of [[18,'water'],[19,'mountain'],[20,'rock']]) protect(x, { terrain });
  const before = protectedIndexes.map(index => structuredClone(game.tiles[index]));
  for (let day = TREE_LIFETIME_DAYS; day < TREE_LIFETIME_DAYS + 130; day++) { game.day = day; stepEcology(game); }
  assert.deepEqual(protectedIndexes.map(index => game.tiles[index]), before);
  assert.equal(game.networkRevision, 7);
});

test('a complete bounded sweep clears expired forests, including every cell of shared groves', () => {
  const game = fixture(32, 32); allocateTerrainObjects(game);
  assert.ok(game.tiles.some(tile => tile.terrainObject));
  for (const tile of game.tiles) tile.treeBornDay = 0;
  const budget = Math.ceil(game.tiles.length / 128), days = Math.ceil(game.tiles.length / budget);
  for (let day = TREE_LIFETIME_DAYS; day < TREE_LIFETIME_DAYS + days; day++) {
    game.day = day; const count = stepEcology(game); assert.ok(count <= budget);
  }
  assert.ok(game.tiles.every(tile => tile.terrain === 'grass' && tile.detail === '' && !tile.terrainObject));
  assert.ok(game.tiles.every(tile => Number.isInteger(tile.treeClearedDay)));
});

test('tree dates survive compact save encoding and resumed succession matches uninterrupted play', () => {
  const game = fixture(8, 8);
  game.day = TREE_LIFETIME_DAYS - TREE_FALLEN_DAYS;
  game.tiles[0].treeBornDay = 0;
  Object.assign(game.tiles[1], { terrain: 'grass', detail: '', treeClearedDay: game.day - 20 });
  const restored = decodeGame(encodeGame(game));
  assert.deepEqual(restored, game);
  for (let day = game.day + 1; day <= TREE_LIFETIME_DAYS + 240; day++) {
    game.day = restored.day = day; assert.equal(stepEcology(game), stepEcology(restored));
  }
  assert.deepEqual(restored, game);
});

test('saved lifecycle dates reject corruption while supporting absent and adopted original metadata', () => {
  assert.equal(validTreeLifecycleTile({}, 100), true);
  for (const treeBornDay of [-TREE_LIFETIME_DAYS, 0, 100]) assert.equal(validTreeLifecycleTile({ treeBornDay }, 100), true);
  for (const treeBornDay of [-TREE_LIFETIME_DAYS - 1, 101, .5, NaN, '0', null]) assert.equal(validTreeLifecycleTile({ treeBornDay }, 100), false);
  for (const treeClearedDay of [-1, 101, .5, Infinity, '0', null]) assert.equal(validTreeLifecycleTile({ treeClearedDay }, 100), false);
  assert.equal(validTreeLifecycleTile({ treeClearedDay: 100 }, 100), true);
});

test('all climate and grove sizes share lifecycle art while keeping every trunk ground anchor', () => {
  for (const biome of ['taiga','tundra','desert']) for (const footprint of [1,2,3]) {
    const original = rasterForestComposition(biome, 'pine', 21, { footprint });
    const young = rasterForestComposition(biome, 'pine', 21, { footprint, lifecycle: { stage: 'young', scale: .38 } });
    assert.deepEqual(young.map(({ x, y }) => [x, y]), original.map(({ x, y }) => [x, y]));
    young.forEach((tree, index) => assert.equal(tree.size, original[index].size * .38));
    const old = applyForestLifecycle(original, { stage: 'old', scale: 1 });
    assert.ok(old.filter(tree => tree.bare).length >= original.filter(tree => tree.bare).length);
    const fallen = applyForestLifecycle(original, { stage: 'fallen', scale: 1 });
    assert.ok(fallen.every(tree => tree.fallen));
    assert.deepEqual(applyForestLifecycle(original, { stage: 'empty', scale: 0 }), []);
    assert.equal(applyForestLifecycle(original, null), original);
  }
  assert.notEqual(forestLifecycleKey({ stage: 'young', scale: .38 }), forestLifecycleKey({ stage: 'young', scale: .535 }));
  assert.notEqual(forestLifecycleKey({ stage: 'old', scale: 1 }), forestLifecycleKey({ stage: 'mature', scale: 1 }));
});
