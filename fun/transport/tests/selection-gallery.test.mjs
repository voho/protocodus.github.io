import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionGallery, selectionBuildingKind, selectionVehicleKind } from '../selection-gallery.js';
import { residentialKind, commercialKind } from '../buildings.js';
import { natureVariant, natureDensity } from '../nature-placement.js';
import { rasterCactusIdentity, rasterForestComposition, rasterTreeIdentity } from '../raster-nature.js';
import { landscapeScenery } from '../landscape-scenery.js';
import { groundIsFlat } from '../terrain-geometry.js';

const world = (biome = 'taiga') => ({ biome, seed: 1847, width: 30, height: 30, tiles: Array.from({ length: 900 }, () => ({ terrain: biome === 'desert' ? 'sand' : 'grass', elevation: .2, detail: '', variant: 7 })), stations: [], cities: [], industries: [], routes: [], vehicles: [] });
const tile = (game, x, y) => game.tiles[y * game.width + x];

test('interior building clicks keep the shared anchor, saved size and actual house design', () => {
  const game = world();
  tile(game, 4, 5).building = { kind: 'house-expensive-2', footprint: 2, level: 3 };
  const before = JSON.stringify(game), selected = selectionGallery(game, { x: 5, y: 6 });
  assert.equal(selected.entryId, 'building:house-expensive-2');
  assert.deepEqual(selected.position, { x: 4, y: 5 });
  assert.deepEqual(selected.preview, { variant: 7, level: 3, footprint: 2 });
  assert.equal(JSON.stringify(game), before);
  // A compact old manor remains a one-tile portrait even though the catalog creates two-tile sites.
  delete tile(game, 4, 5).building.footprint;
  assert.equal(selectionGallery(game, { x: 4, y: 5 }).preview.footprint, 1);
});

test('old house and shop names resolve to the exact modern identity used on the map', () => {
  const game = world();
  for (const kind of ['house', 'apartment', 'shop', 'office']) {
    const building = { kind, level: 2 };
    const expected = ['house', 'apartment'].includes(kind) ? residentialKind(7, 2) : commercialKind(7, 2);
    tile(game, 2, 3).building = building;
    assert.equal(selectionBuildingKind(building, 7), expected);
    assert.equal(selectionGallery(game, { x: 2, y: 3 }).entryId, `building:${expected}`);
  }
  tile(game, 2, 3).building = { kind: 'factory', footprint: 2 };
  assert.equal(selectionGallery(game, { x: 3, y: 4 }).entryId, 'building:factory');
});

test('industry fields and airports resolve their complete saved site with its orientation', () => {
  const game = world();
  game.industries.push({ kind: 'dairy-farm', x: 3, y: 4, footprint: 5 });
  assert.deepEqual(selectionGallery(game, { x: 7, y: 8 }).position, { x: 3, y: 4 });
  assert.equal(selectionGallery(game, { x: 7, y: 8 }).preview.footprint, 5);
  game.stations.push({ id: 1, mode: 'air', axis: 'y', x: 15, y: 12 });
  const airport = selectionGallery(game, { x: 16, y: 17 });
  assert.equal(airport.entryId, 'transport:airport-x');
  assert.deepEqual(airport.position, { x: 15, y: 12 });
  assert.equal(airport.preview.axis, 'y');
});

test('stop, city, bridge and tunnel priorities match inspection intent', () => {
  const game = world(), t = tile(game, 7, 8);
  t.road = true; t.bridge = true;
  assert.equal(selectionGallery(game, { x: 7, y: 8 }).entryId, 'transport:bridge');
  t.road = false; t.rail = true;
  assert.equal(selectionGallery(game, { x: 7, y: 8 }).entryId, 'transport:railbridge');
  t.bridge = false; t.tunnel = true;
  assert.equal(selectionGallery(game, { x: 7, y: 8 }).entryId, 'transport:railtunnel');
  game.stations.push({ mode: 'rail', x: 7, y: 8 });
  assert.equal(selectionGallery(game, { x: 7, y: 8 }).entryId, 'transport:train-stop');
  assert.equal(selectionGallery(game, { x: 7, y: 8, kind: 'city' }).entryId, 'transport:city');
});

test('woodland links name the actual seeded species without inventing missing artwork', () => {
  const game = world('tundra');
  tile(game, 8, 9).terrain = 'forest';
  tile(game, 8, 9).terrainObject = { kind: 'forest', footprint: 3, variant: 17, detail: 'deadwood' };
  const selected = selectionGallery(game, { x: 10, y: 11 }, { available: () => true });
  const expected = [...new Set(rasterForestComposition('tundra', 'deadwood', 17, { footprint: 3 }).map(tree => `nature:trees:${rasterTreeIdentity(tree, 'tundra').split(':')[1]}`))];
  assert.equal(selected.entryId, 'nature:forest');
  assert.deepEqual(selected.position, { x: 8, y: 9 });
  assert.deepEqual(selected.preview, { variant: 17, detail: 'deadwood', footprint: 3, level: 1 });
  assert.deepEqual(selected.related, expected);
  assert.deepEqual(selectionGallery(game, { x: 10, y: 11 }, { available: () => false }).related, []);
  assert.deepEqual(selectionGallery(game, { x: 10, y: 11 }, { available: () => true, layers: { trees: false } }).related, []);
  delete tile(game, 8, 9).terrainObject;
  const lone = selectionGallery(game, { x: 8, y: 9 }, { available: () => true });
  assert.equal(lone.preview.variant, natureVariant(game, 8, 9, tile(game, 8, 9)));
  assert.equal(lone.preview.level, natureDensity(game, 8, 9, tile(game, 8, 9)));
});

test('desert plants follow visible patch and seeded cactus identity, rather than saved habitat label', () => {
  const game = world('desert');
  let checked = 0, bare = 0;
  for (let y = 1; y < 29; y++) for (let x = 1; x < 29; x++) {
    const t = tile(game, x, y); t.detail = 'cactus';
    const scenery = landscapeScenery(game.biome, game.seed, x, y, t), selected = selectionGallery(game, { x, y }, { available: () => true });
    if (!scenery) { assert.equal(selected.entryId, 'nature:sand'); bare++; }
    else if (['cactus', 'prickly-pear'].includes(scenery.detail)) {
      const identity = rasterCactusIdentity(scenery.detail, natureVariant(game, x, y, t));
      assert.equal(selected.entryId, `nature:plants:${identity.split(':')[1]}`);
      assert.equal(selectionGallery(game, { x, y }, { available: () => false }).entryId, `nature:plants:${scenery.detail}`);
      assert.equal(selectionGallery(game, { x, y }, { available: () => true, layers: { trees: false } }).entryId, 'nature:sand'); checked++;
    }
  }
  assert.ok(checked > 10); assert.ok(bare > 100);
});

test('vehicle entries preserve actual transport, traffic class and model level', () => {
  const cases = [['road', 'mail', 'mail-truck'], ['road', 'passengers', 'bus'], ['road', 'food', 'truck'], ['rail', 'mail', 'passenger-train'], ['rail', 'food', 'freight-train'], ['water', 'oil', 'tanker'], ['water', 'passengers', 'ferry'], ['water', 'food', 'freighter'], ['air', 'mail', 'airliner']];
  for (const [mode, cargo, kind] of cases) {
    const game = world(), route = { id: 3, mode, cargo };
    game.routes.push(route); game.vehicles.push({ id: 4, routeId: 3, level: 2 });
    assert.equal(selectionVehicleKind(route), kind);
    const selected = selectionGallery(game, { vehicle: 4 });
    assert.equal(selected.entryId, `vehicle:${kind}`);
    assert.deepEqual(selected.preview, { mode, cargo, level: 2 });
    assert.equal(selected.position, null);
  }
});

test('sloped bare ground and uneven woodland do not claim visible plants or grove species', () => {
  const game = world('desert');
  for (const t of game.tiles) { t.elevation = .8; t.detail = 'cactus'; }
  tile(game, 8, 8).terrain = 'water';
  assert.equal(groundIsFlat(game, 9, 9), false);
  assert.equal(selectionGallery(game, { x: 9, y: 9 }).entryId, 'nature:sand');
  tile(game, 9, 9).terrain = 'forest';
  tile(game, 9, 9).terrainObject = { kind: 'forest', footprint: 3, variant: 17 };
  const selected = selectionGallery(game, { x: 11, y: 11 }, { available: () => true });
  assert.equal(selected.entryId, 'nature:forest');
  assert.deepEqual(selected.related, []);
});

test('outside tiles and removed vehicles have no spurious catalog selection', () => {
  const game = world();
  for (const selected of [null, { x: -1, y: 1 }, { x: 1.2, y: 1 }, { x: 30, y: 0 }, { vehicle: 99 }]) assert.equal(selectionGallery(game, selected), null);
});
