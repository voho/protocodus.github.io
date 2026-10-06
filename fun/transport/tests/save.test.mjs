import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, saveGame, loadGame, deleteSave, validateGame, SAVE_KEY } from '../model.js';
import { advance } from './helpers.mjs';
import { borrow, loanTerms } from '../model.js';
import { build, buildPath, addRoute } from '../model.js';
import { emptyGame, line } from './helpers.mjs';

function withStorage(run, customStorage) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  const storage = customStorage || {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run(storage); } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  }
}

function content(game) {
  const state = structuredClone(game);
  delete state.maintenanceRevision;
  for (const route of state.routes) delete route.pathRevision;
  return state;
}

for (const biome of ['taiga', 'tundra', 'desert']) {
  test(`${biome} save resumes the exact company and continues its simulation`, () => withStorage(storage => {
    const game = createGame({ biome, size: 'regional', seed: 90210 });
    advance(game, 45, tick);
    assert.equal(validateGame(game), true);
    assert.equal(saveGame(game).ok, true);
    assert.ok(storage.getItem(SAVE_KEY).length < 2_000_000, 'one company fits comfortably in browser storage');
    const restored = loadGame();
    assert.ok(restored);
    assert.deepEqual(content(restored), content(game));
    advance(game, 15, tick);
    advance(restored, 15, tick);
    assert.deepEqual(content(restored), content(game), 'save restoration preserves future deliveries, growth and money');
    assert.equal(deleteSave().ok, true);
    assert.equal(loadGame(), null);
  }));
}

test('incompatible, corrupted and inconsistent saves are rejected without crashing', () => withStorage(storage => {
  const base = createGame({ size: 'regional', seed: 44 });
  const corruptions = [
    game => { game.version = 999; },
    game => { game.biome = 'unknown'; },
    game => { game.biome = 'toString'; },
    game => { game.money = null; },
    game => { game.day = -1; },
    game => { game.tiles.pop(); },
    game => { game.tiles[0].terrain = 'lava'; },
    game => { game.cities[0].id = game.cities[1].id; },
    game => { game.industries[0].inventory.timber = -5; },
    game => { game.industries[0].kind = 'toString'; },
    game => { game.industries[0].inventory.toString = 5; },
    game => { game.routes[0].cargo = 'unknown'; },
    game => { game.routes[0].cargo = 'toString'; },
    game => { game.routes[0].stops[0] = 'missing-station'; },
    game => { game.vehicles[0].routeId = 'missing-route'; },
    game => { game.vehicles[0].load = game.vehicles[0].capacity + 1; },
    game => { game.networkRevision = -1; },
    game => { game.networkRevision = .5; },
    game => { game.industries[0].lastProductionDay = -1; },
    game => { game.industries[0].nextProductionDay = null; },
    game => { game.industries[0].nextReviewDay = 'tomorrow'; },
    game => { game.vehicles[0].dwellRemaining = -1; },
    game => { game.vehicles[0].dwellRemaining = 99; },
    game => { game.vehicles[0].tripSerial = .5; },
    game => { game.loan = -1; },
    game => { game.loan = NaN; },
    game => { game.startingFunds = 300000; },
    game => { game.annual = [{ year: 1950, revenue: 1, operatingProfit: 1, delivered: 1, population: 1, routes: 1, bestRouteId: 42 }]; },
    game => { game.annual = {}; },
    game => { game.routes[0].fullLoad = 'yes'; },
    game => { game.routes[0].fullLoad = 1; },
    game => { game.vehicles[0].fullLoadSince = -1; },
    game => { game.vehicles[0].fullLoadSince = game.day + 1; },
    game => { game.vehicles[0].fullLoadSince = 'soon'; },
  ];
  for (const mutate of corruptions) {
    const invalid = structuredClone(base);
    mutate(invalid);
    storage.setItem(SAVE_KEY, JSON.stringify(invalid));
    assert.equal(loadGame(), null, `reject corruption: ${mutate}`);
  }
  for (const raw of ['{broken json', 'null', '{}', '[]', 'x'.repeat(12_000_001)]) {
    storage.setItem(SAVE_KEY, raw);
    assert.equal(loadGame(), null);
  }
}));

test('legacy companies acquire local simulation clocks and preserve exact future after their next save', () => withStorage(storage => {
  const legacy = createGame({ size: 'regional', seed: 7429 });
  tick(legacy, 47.375);
  delete legacy.networkRevision;
  for (const industry of legacy.industries) {
    delete industry.lastProductionDay;
    delete industry.nextProductionDay;
    delete industry.nextReviewDay;
  }
  for (const vehicle of legacy.vehicles) {
    delete vehicle.dwellRemaining;
    delete vehicle.tripSerial;
  }
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const migrated = loadGame();
  assert.ok(migrated, 'old saves remain playable');
  assert.equal(validateGame(migrated), true);
  assert.ok(Number.isInteger(migrated.networkRevision));
  tick(migrated, 13.625);
  assert.equal(saveGame(migrated).ok, true);
  const restored = loadGame();
  assert.ok(restored);
  tick(migrated, 19.125); tick(restored, 19.125);
  assert.deepEqual(content(restored), content(migrated));
}));

test('saving during a loading wait resumes the same remaining wait and production schedule', () => withStorage(() => {
  const game = createGame({ size: 'regional', seed: 1337 });
  for (let sample = 0; sample < 720 && !game.vehicles.some(vehicle => vehicle.dwellRemaining > 0); sample++) tick(game, .125);
  const waiting = game.vehicles.find(vehicle => vehicle.dwellRemaining > 0);
  assert.ok(waiting, 'vehicles spend time loading rather than reversing instantly');
  assert.ok(game.industries.every(industry => Number.isFinite(industry.nextProductionDay) && Number.isFinite(industry.nextReviewDay)));
  assert.equal(saveGame(game).ok, true);
  const restored = loadGame();
  assert.ok(restored);
  assert.equal(restored.vehicles.find(vehicle => vehicle.id === waiting.id).dwellRemaining, waiting.dwellRemaining);
  assert.deepEqual(content(restored), content(game));
  for (const step of [.0625, .1875, 1.5, .25, 17]) { tick(game, step); tick(restored, step); }
  assert.deepEqual(content(restored), content(game));
}));

test('a full-load wait is kept only on a freight route that asks for full loads', () => withStorage(storage => {
  const game = emptyGame();
  build(game, 'logging-camp', 10, 9); build(game, 'sawmill', 30, 9); buildPath(game, 'road', line(10, 30, 12));
  for (const x of [10, 30]) build(game, 'bus-stop', x, 12);
  const route = addRoute(game, { mode: 'road', cargo: 'timber', stops: game.stations.map(stop => stop.id) }).route;
  tick(game, 5);
  game.vehicles[0].fullLoadSince = 3;
  storage.setItem(SAVE_KEY, JSON.stringify(game));
  const plain = loadGame();
  assert.ok(plain);
  assert.equal(plain.vehicles[0].fullLoadSince, null, 'a route without full load lets the wait go');
  route.fullLoad = true;
  storage.setItem(SAVE_KEY, JSON.stringify(game));
  assert.equal(loadGame().vehicles[0].fullLoadSince, 3, 'a freight route with full load keeps it');
  const town = createGame({ size: 'regional', seed: 44 });
  tick(town, 5);
  Object.assign(town.routes[0], { fullLoad: true }); town.vehicles[0].fullLoadSince = 2;
  assert.equal(town.routes[0].cargo, 'passengers');
  storage.setItem(SAVE_KEY, JSON.stringify(town));
  const passengers = loadGame();
  assert.ok(passengers);
  assert.deepEqual([passengers.vehicles[0].fullLoadSince, passengers.routes[0].fullLoad], [null, false], 'passenger routes never wait');
}));

test('a loan, yearly summaries and starting funds survive a save; older saves load without them', () => withStorage(() => {
  const game = createGame({ size: 'regional', seed: 7429, startingFunds: 200000 });
  assert.equal(borrow(game).ok, true);
  assert.equal(borrow(game).ok, true);
  tick(game, 366);
  assert.equal(game.annual.length, 1);
  assert.equal(saveGame(game).ok, true);
  const restored = loadGame();
  assert.ok(restored);
  assert.deepEqual(content(restored), content(game));
  assert.equal(restored.loan, 100000);
  assert.equal(restored.startingFunds, 200000);
  assert.deepEqual(restored.annual, game.annual);
  tick(game, 40); tick(restored, 40);
  assert.deepEqual(content(restored), content(game), 'interest continues identically after loading');
  const legacy = createGame({ size: 'regional', seed: 7429 });
  tick(legacy, 20);
  assert.equal(saveGame(legacy).ok, true);
  const migrated = loadGame();
  assert.ok(migrated, 'a save from before loans still loads');
  for (const key of ['loan', 'annual', 'startingFunds']) assert.equal(Object.hasOwn(migrated, key), false, `${key} stays absent`);
  assert.equal(loanTerms(migrated).loan, 0);
  assert.equal(migrated.money, legacy.money);
}));

test('saving an invalid company preserves the previous valid save', () => withStorage(storage => {
  const game = createGame({ size: 'regional' });
  assert.equal(saveGame(game).ok, true);
  const saved = storage.getItem(SAVE_KEY);
  game.money = NaN;
  assert.equal(saveGame(game).ok, false);
  assert.equal(storage.getItem(SAVE_KEY), saved);
  assert.ok(loadGame());
}));

test('storage failures are recoverable and reported to the interface', () => {
  const unavailable = () => { throw new Error('Storage disabled'); };
  withStorage(() => {
    assert.equal(saveGame(createGame({ size: 'regional' })).ok, false);
    assert.equal(loadGame(), null);
    assert.equal(deleteSave().ok, false);
  }, { getItem: unavailable, setItem: unavailable, removeItem: unavailable });
});

test('route numbers survive a save, and a save from before numbers is numbered in creation order', () => withStorage(storage => {
  const game = createGame({ size: 'regional', seed: 44 }), [starter] = game.routes;
  game.routes.push({ ...structuredClone(starter), id: 'route-900', number: 7 }, { ...structuredClone(starter), id: 'route-400', number: 3 });
  assert.equal(validateGame(game), true);
  assert.equal(saveGame(game).ok, true);
  assert.deepEqual(loadGame().routes.map(route => [route.id, route.number]), [[starter.id, 1], ['route-900', 7], ['route-400', 3]], 'numbers load unchanged');
  const legacy = JSON.parse(storage.getItem(SAVE_KEY));
  for (const route of legacy.state.routes) delete route.number;
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const numbered = loadGame();
  assert.ok(numbered, 'a save without route numbers loads');
  assert.deepEqual(numbered.routes.map(route => [route.id, route.number]), [[starter.id, 1], ['route-900', 3], ['route-400', 2]], 'the oldest route is route 1');
  assert.deepEqual(numbered.routes.map(route => [route.name, route.color]), game.routes.map(route => [route.name, route.color]), 'names and colours stay as saved');
  assert.deepEqual(loadGame().routes.map(route => route.number), [1, 3, 2], 'a legacy save numbers the same way every time');
  for (const bad of [0, 10000, 2.5, '4', null]) {
    game.routes[1].number = bad;
    assert.equal(validateGame(game), true, `${JSON.stringify(bad)} is dropped, not fatal`);
    assert.equal(Object.hasOwn(game.routes[1], 'number'), false);
  }
  game.routes[1].number = 3;
  assert.equal(saveGame(game).ok, true);
  assert.deepEqual(loadGame().routes.map(route => route.number), [1, 2, 3], 'a duplicated number goes to the later route');
}));
