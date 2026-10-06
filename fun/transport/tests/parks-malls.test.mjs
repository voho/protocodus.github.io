import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, PARK_KINDS, MALL_KINDS, SHOP_KINDS, COMMUNITY_KINDS, PROCEDURAL_BUILDING_KINDS, commercialKind } from '../buildings.js';
import { build, buildPath, addRoute, constructionCost, restoreGame, validateGame, tick, priceFor, sellProperty, drainDeliveryEvents } from '../model.js';
import { buildingAt, buildingTiles } from '../building-sites.js';
import { localEnvironment } from '../environment.js';
import { encodeGame } from '../save-codec.js';
import { townLedger, reviewMarket, monthlyMarkets, recordTownSupply, propertyOccupancy, propertyBase, propertyAt, BUILT_YIELD } from '../town-market.js';
import { emptyGame, tileAt, line } from './helpers.mjs';

const ledgerOf = (game, city) => townLedger(game, city, new Map());
function cityAt(game, x = 30, y = 30, population = 1800) {
  const city = { id: 'town', name: 'Town', x, y, population, activity: 0, growth: 0, passengers: 0, delivered: 0, supplies: 0, lastServiceDay: null };
  game.cities.push(city); game.revision++;
  return city;
}

test('parks and malls are player projects without changing procedural town catalogs', () => {
  assert.deepEqual(PARK_KINDS, ['park-village', 'park-formal', 'park-woodland']);
  assert.deepEqual(MALL_KINDS, ['mall-neighborhood', 'mall-shopping', 'mall-modern']);
  assert.equal(PROCEDURAL_BUILDING_KINDS.length, 37);
  assert.equal(SHOP_KINDS.length, 8); assert.equal(COMMUNITY_KINDS.length, 15);
  assert.deepEqual(Array.from({ length: 10 }, (_, n) => commercialKind(n, 1)), [...SHOP_KINDS.slice(0,5), ...SHOP_KINDS.slice(0,5)]);
  for (const kind of [...PARK_KINDS, ...MALL_KINDS]) assert.equal(BUILDINGS[kind].buildOnly, true);
});

test('all park and mall footprints reserve every tile and survive lossless saves', () => {
  for (const kind of [...PARK_KINDS, ...MALL_KINDS]) {
    const game = emptyGame(), cost = constructionCost(game, kind, 20, 20), before = game.money;
    const placed = build(game, kind, 20, 20);
    assert.equal(placed.ok, true, `${kind}: ${placed.message}`);
    assert.equal(game.money, before - cost);
    const site = buildingAt(game, 20, 20), size = BUILDINGS[kind].footprint;
    assert.equal(site.building.footprint, size);
    assert.equal(buildingTiles(site).length, size ** 2);
    assert.equal(site.building.owner, MALL_KINDS.includes(kind) ? 'player' : undefined);
    for (const point of buildingTiles(site)) {
      assert.equal(buildingAt(game, point.x, point.y).building, site.building);
      assert.equal(build(game, 'road', point.x, point.y).ok, false);
    }
    const loaded = restoreGame(encodeGame(game));
    assert.ok(loaded); assert.equal(validateGame(loaded), true);
    assert.deepEqual(loaded.tiles, game.tiles); assert.equal(loaded.money, game.money);
    assert.equal(build(game, 'bulldoze', 20 + size - 1, 20 + size - 1).ok, true);
    for (const point of buildingTiles(site)) assert.equal(buildingAt(game, point.x, point.y), null);
  }
});

test('a far-corner obstruction prevents the entire park or mall without charging', () => {
  for (const kind of [...PARK_KINDS, ...MALL_KINDS]) {
    const game = emptyGame(), size = BUILDINGS[kind].footprint;
    tileAt(game, 20 + size - 1, 20 + size - 1).road = true;
    const snapshot = JSON.stringify(game);
    assert.equal(build(game, kind, 20, 20).ok, false, kind);
    assert.equal(JSON.stringify(game), snapshot, kind);
  }
});

test('parks improve local greenery and amenities, reduce pollution and earn no private rent', () => {
  for (const kind of PARK_KINDS) {
    const game = emptyGame(), city = cityAt(game, 17, 20);
    for (let x = 17; x <= 25; x++) tileAt(game, x, 19).road = true;
    game.revision++;
    const before = localEnvironment(game, 21, 21);
    assert.equal(build(game, kind, 20, 20).ok, true);
    const after = localEnvironment(game, 21, 21);
    assert.equal(after.civic, before.civic + 1); assert.equal(after.leisure, before.leisure + 1);
    assert.ok(after.amenity > before.amenity, kind);
    assert.ok(after.nature > before.nature, kind);
    assert.ok(after.pollution < before.pollution, `${kind}: ${after.pollution} < ${before.pollution}`);
    assert.equal(propertyAt(game, 20, 20), null);
    monthlyMarkets(game); assert.equal(city.market.rent, undefined);
    assert.deepEqual(ledgerOf(game, city).owned, []);
  }
});

test('malls provide proportionate food and household outlets for town deliveries', () => {
  for (const kind of MALL_KINDS) {
    const game = emptyGame(), city = cityAt(game), definition = BUILDINGS[kind];
    assert.equal(build(game, kind, 32, 30).ok, true);
    const ledger = ledgerOf(game, city);
    assert.equal(ledger.shopUnits, definition.shopUnits);
    assert.deepEqual(ledger.outlets, { ...definition.outlets, fuel: 0 });
    reviewMarket(game, city);
    assert.equal(city.market.shops, definition.shopUnits);
    assert.equal(city.market.wants.food, Math.round(1800 * .1 * Math.min(1, definition.outlets.food * 300 / 1800)));
    assert.equal(city.market.wants.household, Math.round(1800 * .04 * Math.min(1, definition.outlets.household * 500 / 1800)));
    const foodWanted = city.market.wants.food, goodsWanted = city.market.wants.household;
    assert.equal(recordTownSupply(game, city, 'food', foodWanted + 10), foodWanted);
    assert.equal(recordTownSupply(game, city, 'furniture', goodsWanted + 5), goodsWanted);
    assert.equal(city.market.supplied.food, foodWanted + 10);
    assert.equal(city.market.supplied.household, goodsWanted + 5);
    assert.equal(localEnvironment(game, 32, 30).shops, definition.shopUnits);
  }
});

test('mall rent responds to stocking both retail families and sale ends its private income', () => {
  for (const kind of MALL_KINDS) {
    const game = emptyGame(), city = cityAt(game, 30, 30, 10000), definition = BUILDINGS[kind];
    assert.equal(build(game, kind, 32, 30).ok, true);
    reviewMarket(game, city);
    const [property] = ledgerOf(game, city).owned;
    assert.equal(propertyBase(property), BUILT_YIELD * definition.cost);
    const market = city.market;
    market.met.food = 1; market.met.household = 0;
    assert.equal(propertyOccupancy(market, property, city.population), .7);
    market.met.household = 1;
    assert.equal(propertyOccupancy(market, property, city.population), 1);
    market.supplied = { ...market.wants };
    monthlyMarkets(game);
    assert.equal(market.rent, priceFor(game, BUILT_YIELD * definition.cost));
    assert.ok(game.totalProperty > 0);
    const expectedRefund = Math.round(.6 * priceFor(game, definition.cost)), before = game.money;
    const size = definition.footprint;
    assert.equal(sellProperty(game, 32 + size - 1, 30 + size - 1).ok, true);
    assert.equal(game.money, before + expectedRefund);
    assert.equal(buildingAt(game, 32, 30).building.kind, kind);
    assert.equal(buildingAt(game, 32, 30).building.owner, undefined);
    assert.equal(ledgerOf(game, city).owned.length, 0);
    assert.equal(validateGame(game), true);
  }
});

test('a saved mall resumes with identical demands and monthly property income', () => {
  const game = emptyGame(), city = cityAt(game);
  assert.equal(build(game, 'mall-modern', 32, 30).ok, true);
  reviewMarket(game, city);
  recordTownSupply(game, city, 'food', city.market.wants.food);
  recordTownSupply(game, city, 'furniture', city.market.wants.household);
  const loaded = restoreGame(encodeGame(game)); assert.ok(loaded);
  tick(game, 30); tick(loaded, 30);
  assert.deepEqual(loaded.cities, game.cities);
  assert.equal(loaded.totalProperty, game.totalProperty);
  assert.equal(loaded.money, game.money);
});

test('a cannery food truck supplies a mall town and earns the food demand bonus', () => {
  const game = emptyGame(), city = cityAt(game, 30, 9, 900);
  assert.equal(build(game, 'cannery', 10, 7).ok, true);
  assert.equal(build(game, 'mall-neighborhood', 32, 9).ok, true);
  assert.equal(buildPath(game, 'road', line(10, 30, 12)).ok, true);
  for (const x of [10, 30]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  const plant = game.industries[0]; plant.inventory.produce = 900;
  const service = addRoute(game, { mode: 'road', cargo: 'food', stops: game.stations.map(stop => stop.id) });
  assert.equal(service.ok, true); reviewMarket(game, city);
  tick(game, 100);
  const deliveries = drainDeliveryEvents(game).filter(event => event.cargo === 'food');
  assert.ok(plant.totalProduced > 0 && plant.inventory.produce < 900);
  assert.ok(deliveries.length > 0 && deliveries.every(event => event.amount > 0));
  assert.ok(service.route.delivered > 0 && service.route.marketBonus > 0);
  assert.ok(city.lastSupply.food > 0 && city.supplies > 0);
  assert.equal(city.market.shops, 4);
  assert.equal(validateGame(game), true);
});
