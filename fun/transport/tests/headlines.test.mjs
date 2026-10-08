import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, addRoute, removeRoute, build, buildPath, validateGame, restoreGame } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { HEADLINE_LIMIT, HEADLINE_TOWN_TIERS, HEADLINE_PRIORITY, headlineKicker, headlineNoun, headlineWatch, arrivalRoute, detectHeadlines, headlineTier, townHeadline, recordHeadline, airDebutHeadline } from '../headlines.js';
import { emptyGame, line, tileAt, completeFixtureConstruction } from './helpers.mjs';
import { vehicleModel, modelHeadline } from '../vehicle-models.js';

const town = (id, name, x, y) => ({ id, name, x, y, population: 900, activity: 0, growth: 0, passengers: 200, delivered: 0, supplies: 0, lastServiceDay: null });
function withTowns(...list) { const game = emptyGame(); game.cities = list.map(args => town(...args)); game.revision++; return game; }
// Daily detection, as the HUD tick does it; every entry is recorded like announceHeadline would.
// Each entry notes the day its town was served at the moment it was found, since lastServiceDay moves on with every delivery.
function run(game, watch, days) {
  const out = [];
  for (let day = 0; day < days; day++) { tick(game, 1); for (const entry of detectHeadlines(game, watch)) { out.push({ ...entry, servedDay: game.cities.find(city => city.id === entry.target?.id)?.lastServiceDay }); recordHeadline(game, entry); } }
  return out.map(({ servedDay, ...entry }) => Object.defineProperty(entry, 'servedDay', { value: servedDay }));
}
const stopsOf = (game, mode) => game.stations.filter(stop => stop.mode === mode).map(stop => stop.id);
const byId = (list, id) => list.find(item => item.id === id);
const ok = result => { assert.equal(result.ok, true, result.message); return result; };

test('a fresh company celebrates nothing: the starter bus towns are already known', () => {
  const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), watch = headlineWatch(game);
  assert.ok(watch.towns.has(game.cities[0].id) && watch.towns.has(game.cities[1].id));
  assert.deepEqual([...watch.modes], ['road']);
  for (let day = 0; day < 60; day++) { tick(game, 1); assert.deepEqual(detectHeadlines(game, watch), [], `day ${day}`); }
  assert.ok(Number.isFinite(game.cities[0].lastServiceDay) && Number.isFinite(game.cities[1].lastServiceDay), 'both starting towns were served');
});

test('the first bus into a new town, then the first train, merged with the town it reaches', () => {
  const game = withTowns(['home', 'Home', 10, 10], ['second', 'Second', 10, 40], ['cedar', 'Cedarbridge', 40, 10], ['dale', 'Dale', 70, 10]), watch = headlineWatch(game);
  ok(buildPath(game, 'road', line(10, 40, 12))); ok(build(game, 'bus-stop', 10, 12)); ok(build(game, 'bus-stop', 40, 12));
  const bus = ok(addRoute(game, { mode: 'road', stops: stopsOf(game, 'road'), cargo: 'passengers' })).route;
  assert.equal(arrivalRoute(game, byId(game.cities, 'dale')), null, 'no stop near Dale yet');
  const entries = run(game, watch, 60), cedar = byId(game.cities, 'cedar');
  assert.equal(entries.length, 1, JSON.stringify(entries));
  const [arrival] = entries;
  assert.equal(arrival.key, 'arrival:cedar'); assert.equal(arrival.kind, 'arrival'); assert.equal(arrival.art, 'bus');
  assert.equal(arrival.day, Math.floor(arrival.servedDay));
  assert.equal(arrival.title, 'Citizens celebrate as the first bus arrives in Cedarbridge');
  assert.ok(arrival.detail.startsWith('Its 900 residents are now linked by'), arrival.detail);
  assert.ok(arrival.detail.endsWith(`${bus.name}.`));
  assert.deepEqual(arrival.target, { kind: 'city', id: 'cedar' });
  assert.equal(arrival.routeId, bus.id);
  assert.deepEqual(detectHeadlines(game, watch), [], 'a second pass finds nothing new');
  const served = townHeadline(game, cedar, 2500);
  assert.equal(served.detail, 'One of your routes serves the town.');

  ok(buildPath(game, 'rail', line(40, 70, 14))); ok(build(game, 'train-stop', 40, 14)); ok(build(game, 'train-stop', 70, 14));
  const train = ok(addRoute(game, { mode: 'rail', stops: stopsOf(game, 'rail'), cargo: 'passengers' })).route;
  const rail = run(game, watch, 60);
  assert.equal(rail.length, 1, JSON.stringify(rail));
  assert.equal(rail[0].key, 'first:rail'); assert.equal(rail[0].kind, 'first'); assert.equal(rail[0].art, 'train');
  assert.deepEqual(rail[0].target, { kind: 'city', id: 'dale' });
  assert.equal(rail[0].day, Math.floor(rail[0].servedDay));
  assert.ok(rail[0].title.endsWith('first train arrives in Dale'), rail[0].title);
  assert.ok(rail[0].detail.startsWith('The company’s first train. Its 900 residents are now linked by'), rail[0].detail);
  assert.equal(rail[0].routeId, train.id);
  assert.ok(!game.headlines.some(entry => entry.key === 'arrival:dale'), 'the merged entry stands for Dale’s arrival');
  assert.deepEqual(game.headlines.map(entry => entry.key), ['first:rail', 'arrival:cedar']);
  assert.equal(townHeadline(game, cedar, 2500).detail, '2 of your routes serve the town.');
  assert.equal(validateGame(game), true);
});

test('freight arrivals say supplied by; a first train to an industry names its stop', () => {
  const game = withTowns(['home', 'Home', 5, 40], ['second', 'Second', 5, 60], ['cedar', 'Cedarbridge', 45, 10]), watch = headlineWatch(game);
  ok(build(game, 'food-plant', 10, 7)); completeFixtureConstruction(game, game.industries[0]); game.industries[0].inventory.food = 500;
  ok(buildPath(game, 'road', line(10, 45, 12))); ok(build(game, 'bus-stop', 10, 12)); ok(build(game, 'bus-stop', 45, 12));
  const food = ok(addRoute(game, { mode: 'road', stops: stopsOf(game, 'road'), cargo: 'food' })).route;
  const entries = run(game, watch, 40);
  assert.deepEqual(entries.map(entry => entry.key), ['arrival:cedar']);
  assert.equal(entries[0].art, 'truck');
  assert.equal(entries[0].title, 'Citizens celebrate as the first truck arrives in Cedarbridge');
  assert.ok(entries[0].detail.includes('supplied by'), entries[0].detail);
  assert.equal(entries[0].routeId, food.id);

  ok(build(game, 'logging-camp', 10, 18)); ok(build(game, 'sawmill', 30, 18));
  completeFixtureConstruction(game, ...game.industries.slice(-2));
  game.industries.find(industry => industry.kind === 'logging-camp').inventory.timber = 300;
  ok(buildPath(game, 'rail', line(10, 30, 23))); ok(build(game, 'train-stop', 10, 23)); ok(build(game, 'train-stop', 30, 23));
  const timber = ok(addRoute(game, { mode: 'rail', stops: stopsOf(game, 'rail'), cargo: 'timber' })).route;
  const rail = run(game, watch, 60), end = byId(game.stations, timber.stops[1]);
  assert.equal(rail.length, 1, JSON.stringify(rail));
  assert.equal(rail[0].key, 'first:rail');
  assert.equal(rail[0].title, `The company’s first train pulls into ${end.name}`);
  assert.equal(rail[0].detail, `First delivery on ${timber.name}.`);
  assert.deepEqual(rail[0].target, { kind: 'route', id: timber.id });
  assert.equal(validateGame(game), true);
});

test('the first ferry between the starting towns is a company first, not an arrival', () => {
  const game = withTowns(['home', 'Alderbrook', 10, 10], ['second', 'Pinehaven', 40, 10]);
  for (const point of line(10, 40, 13)) Object.assign(tileAt(game, point.x, point.y), { terrain: 'water', detail: 'river', elevation: 0 });
  game.revision++; game.networkRevision++;
  ok(build(game, 'port', 10, 13)); ok(build(game, 'port', 40, 13));
  const watch = headlineWatch(game);
  ok(addRoute(game, { mode: 'water', stops: stopsOf(game, 'water'), cargo: 'passengers' }));
  const entries = run(game, watch, 60);
  assert.deepEqual(entries.map(entry => [entry.key, entry.title]), [['first:water', 'The company’s first ferry arrives in Pinehaven']]);
  assert.equal(entries[0].art, 'ship');
});

test('arrivalRoute picks the town passengerEndpoints serves, and a retired route leaves a plain arrival', () => {
  const game = withTowns(['home', 'Home', 10, 10], ['second', 'Second', 10, 40], ['cedar', 'Cedarbridge', 40, 10], ['fern', 'Fernlea', 44, 13]), watch = headlineWatch(game);
  ok(buildPath(game, 'road', line(10, 40, 12))); ok(build(game, 'bus-stop', 10, 12)); ok(build(game, 'bus-stop', 40, 12));
  const bus = ok(addRoute(game, { mode: 'road', stops: stopsOf(game, 'road'), cargo: 'passengers' })).route;
  for (let day = 0; day < 60; day++) tick(game, 1);
  assert.ok(Number.isFinite(byId(game.cities, 'cedar').lastServiceDay));
  assert.equal(arrivalRoute(game, byId(game.cities, 'cedar'))?.id, bus.id);
  assert.equal(arrivalRoute(game, byId(game.cities, 'fern')), null, 'the shared stop serves Cedarbridge, not Fernlea');
  ok(removeRoute(game, bus.id));
  const entries = detectHeadlines(game, watch);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Cedarbridge joins your network');
  assert.equal(entries[0].detail, `Its ${Math.floor(byId(game.cities, 'cedar').population).toLocaleString('en-US')} residents are now served by your company.`);
  assert.equal(entries[0].art, 'town');
  assert.equal(entries[0].routeId, undefined);
});

test('nouns, kickers, tiers and town titles', () => {
  assert.deepEqual([['road', 'passengers'], ['road', 'coal'], ['rail', 'passengers'], ['water', 'passengers'], ['water', 'timber'], ['air', 'passengers'], ['air', 'mail']].map(([mode, cargo]) => headlineNoun(mode, cargo)), ['bus', 'truck', 'train', 'ferry', 'ship', 'plane', 'mail plane']);
  assert.deepEqual(['arrival', 'first', 'town', 'models', 'rating', 'achievement', 'contract', 'debut', 'other'].map(headlineKicker), ['Local news', 'Company first', 'Town news', 'New models', 'Company news', 'Achievement', 'Contracts', 'News', 'Headline']);
  assert.deepEqual(HEADLINE_PRIORITY, { first: 1, rating: 1, achievement: 1, models: 2, town: 2, contract: 2, debut: 2, arrival: 3 });
  assert.deepEqual(HEADLINE_TOWN_TIERS, [2500, 5000, 10000]);
  assert.equal(headlineTier(980, 1004), 0);
  assert.equal(headlineTier(900, 2600), 2500);
  assert.equal(headlineTier(2400, 5001), 5000);
  assert.equal(headlineTier(9990, 12000), 10000);
  assert.equal(headlineTier(2600, 4900), 0);
  const game = withTowns(['home', 'Home', 10, 10], ['second', 'Second', 10, 40]), city = game.cities[0];
  assert.deepEqual([2500, 5000, 10000].map(tier => townHeadline(game, city, tier).title), ['Home welcomes its 2,500th resident', 'Home grows to 5,000 residents', 'Home passes 10,000 residents']);
  const entry = townHeadline(game, city, 5000);
  assert.deepEqual({ ...entry, title: undefined, detail: undefined }, { key: 'town:5000:home', kind: 'town', day: 0, art: 'town', title: undefined, detail: undefined, target: { kind: 'city', id: 'home' } });
  assert.equal(entry.detail, '0 of your routes serve the town.');
});

test('recordHeadline keeps a clean, deduplicated, bounded log without touching revision or ids', () => {
  const game = emptyGame(); game.day = 500.4;
  const { revision, nextId } = game;
  assert.equal(recordHeadline(game, { key: 'arrival:a', kind: 'arrival', day: 12, title: 'A', detail: 'Detail', art: 'bus', target: { kind: 'city', id: 'a' }, routeId: 'route-1', priority: 2, run() {} }), true);
  assert.deepEqual(Object.keys(game.headlines[0]).filter(key => !['key', 'kind', 'day', 'title', 'detail', 'art', 'target'].includes(key)), []);
  assert.deepEqual(game.headlines[0], { key: 'arrival:a', kind: 'arrival', day: 12, title: 'A', detail: 'Detail', art: 'bus', target: { kind: 'city', id: 'a' } });
  const before = structuredClone(game.headlines);
  assert.equal(recordHeadline(game, { key: 'arrival:a', kind: 'arrival', title: 'Again' }), false);
  assert.deepEqual(game.headlines, before);
  assert.equal(game.revision, revision); assert.equal(game.nextId, nextId);

  const days = { 999: 500, [-4]: 0, NaN: 500 };
  for (const [day, stored] of Object.entries(days)) { recordHeadline(game, { key: `day:${day}`, kind: 'town', day: Number(day), title: 'Day' }); assert.equal(game.headlines[0].day, stored, day); }
  recordHeadline(game, { key: 'day:none', kind: 'town', title: 'No day' }); assert.equal(game.headlines[0].day, 500);

  recordHeadline(game, { key: 'long', kind: 'rating', title: 'T'.repeat(300), detail: 'D'.repeat(400), art: 'A'.repeat(20), target: { kind: 'station', id: 'station-1' } });
  const long = game.headlines[0];
  assert.equal(long.title.length, 140); assert.ok(long.title.endsWith('…'));
  assert.equal(long.detail.length, 240); assert.ok(long.detail.endsWith('…'));
  assert.equal(long.art, undefined); assert.equal(long.target, undefined);
  assert.equal(validateGame(game), true);
  recordHeadline(game, { key: 'numeric-target', kind: 'town', title: '  Trimmed  ', detail: '', target: { kind: 'route', id: 42 } });
  assert.deepEqual(game.headlines[0], { key: 'numeric-target', kind: 'town', day: 500, title: 'Trimmed', target: { kind: 'route', id: '42' } });
  for (const bad of [{ kind: 'town', title: 'No key' }, { key: 'k'.repeat(65), kind: 'town', title: 'Long key' }, { key: 'kind', kind: 'k'.repeat(30), title: 'Long kind' }, { key: 'blank', kind: 'town', title: '   ' }, { key: 'none', kind: 'town' }]) {
    const count = game.headlines.length;
    assert.equal(recordHeadline(game, bad), false, JSON.stringify(bad));
    assert.equal(game.headlines.length, count);
    assert.equal(validateGame(game), true);
  }

  const log = emptyGame();
  for (let n = 0; n < 40; n++) recordHeadline(log, n === 3 ? { key: 'first:rail', kind: 'first', title: 'Train' } : n === 5 ? { key: 'first:water', kind: 'first', title: 'Ship' } : n === 7 ? { key: 'first:air', kind: 'first', title: 'Plane' } : { key: `arrival:${n}`, kind: 'arrival', title: `Town ${n}` });
  assert.equal(log.headlines.length, HEADLINE_LIMIT);
  assert.ok(['first:rail', 'first:water', 'first:air'].every(key => log.headlines.some(entry => entry.key === key)), 'company firsts are never pruned');
  assert.equal(log.headlines[0].key, 'arrival:39');
  assert.equal(validateGame(log), true);
});

test('validateGame accepts the log only while every entry is well formed', () => {
  const game = emptyGame(); game.day = 300;
  assert.equal(HEADLINE_LIMIT, 24);
  assert.equal(validateGame(game), true);
  for (let n = 0; n < 24; n++) recordHeadline(game, { key: `arrival:${n}`, kind: 'arrival', day: n, title: `Town ${n}`, detail: 'Detail', art: 'bus', target: { kind: 'city', id: `city-${n}` } });
  assert.equal(validateGame(game), true);
  const valid = structuredClone(game.headlines);
  const broken = {
    'more than 24': log => log.push({ key: 'extra', kind: 'town', day: 1, title: 'Extra' }),
    'a duplicate key': log => { log[1].key = log[0].key; },
    'a day after today': log => { log[0].day = 301; },
    'a fractional day': log => { log[0].day = 1.5; },
    'an empty title': log => { log[0].title = ''; },
    'a long title': log => { log[0].title = 'T'.repeat(141); },
    'a long detail': log => { log[0].detail = 'D'.repeat(241); },
    'a long art name': log => { log[0].art = 'a'.repeat(17); },
    'a station target': log => { log[0].target = { kind: 'station', id: 'station-1' }; },
    'a null entry': log => { log[0] = null; },
    'a log that is not a list': (log, g) => { g.headlines = { 0: log[0] }; },
  };
  for (const [name, breakIt] of Object.entries(broken)) {
    game.headlines = structuredClone(valid); breakIt(game.headlines, game);
    assert.equal(validateGame(game), false, name);
  }
  game.headlines = valid; assert.equal(validateGame(game), true);
});

test('the log survives a save and restore; older saves load without it and replay nothing', () => {
  const game = withTowns(['home', 'Home', 10, 10], ['second', 'Second', 10, 40], ['cedar', 'Cedarbridge', 40, 10]), watch = headlineWatch(game);
  ok(buildPath(game, 'road', line(10, 40, 12))); ok(build(game, 'bus-stop', 10, 12)); ok(build(game, 'bus-stop', 40, 12));
  ok(addRoute(game, { mode: 'road', stops: stopsOf(game, 'road'), cargo: 'passengers' }));
  run(game, watch, 40);
  recordHeadline(game, modelHeadline(vehicleModel('road', 'passengers', 11)));
  assert.equal(game.headlines.length, 2);
  const restored = restoreGame(encodeGame(game));
  assert.ok(restored);
  assert.deepEqual(restored.headlines, game.headlines);
  const again = headlineWatch(restored), before = headlineWatch(game);
  assert.deepEqual([...again.towns].sort(), [...before.towns].sort());
  assert.deepEqual([...again.modes].sort(), [...before.modes].sort());
  assert.deepEqual(detectHeadlines(restored, again), [], 'loading replays nothing');
  const legacy = structuredClone(game); delete legacy.headlines;
  const old = restoreGame(encodeGame(legacy));
  assert.ok(old); assert.equal(old.headlines, undefined);
});

test('detection and recording leave the simulation unchanged', () => {
  const plain = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), watched = createGame({ biome: 'taiga', size: 'regional', seed: 1847 }), watch = headlineWatch(watched);
  for (let day = 0; day < 400; day++) {
    for (const game of [plain, watched]) { tick(game, .5); tick(game, .5); }
    for (const entry of detectHeadlines(watched, watch)) recordHeadline(watched, entry);
    if (day === 200) recordHeadline(watched, townHeadline(watched, watched.cities[0], 2500));
  }
  assert.ok(watched.headlines.length >= 1); assert.equal(plain.headlines, undefined);
  assert.equal(watched.nextId, plain.nextId);
  assert.equal(watched.revision, plain.revision);
  const text = game => { const saved = encodeGame(game); delete saved.state.headlines; return JSON.stringify(saved); };
  assert.equal(text(watched), text(plain));
});

test('warm detection and a town lookup stay cheap on a busy network', () => {
  const game = emptyGame();
  let seed = 7; const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  game.cities = Array.from({ length: 1200 }, (_, n) => ({ ...town(`city-${n}`, `Town ${n}`, Math.floor(random() * game.width), Math.floor(random() * game.height)), lastServiceDay: n % 2 ? 3 : null }));
  game.stations = Array.from({ length: 2000 }, (_, n) => ({ id: `station-${n}`, name: `Stop ${n}`, x: Math.floor(random() * game.width), y: Math.floor(random() * game.height), mode: 'road' }));
  game.routes = Array.from({ length: 10000 }, (_, n) => ({ id: `route-${n}`, name: `Route ${n}`, mode: 'road', cargo: n % 3 ? 'passengers' : 'food', stops: [`station-${(n * 7) % 2000}`, `station-${(n * 13 + 1) % 2000}`], active: true, delivered: 5, revenue: 10, path: [] }));
  game.revision++;
  const watch = headlineWatch(game);
  detectHeadlines(game, watch);
  const median = list => list.sort((a, b) => a - b)[list.length >> 1];
  const warm = [];
  for (let n = 0; n < 60; n++) { const at = performance.now(); detectHeadlines(game, watch); warm.push(performance.now() - at); }
  assert.ok(median(warm) < 1, `warm detection ${median(warm).toFixed(3)} ms`);
  const unserved = game.cities.find(city => city.lastServiceDay === null && game.stations.some(stop => Math.hypot(stop.x - city.x, stop.y - city.y) <= 5));
  assert.ok(unserved);
  arrivalRoute(game, unserved);
  const lookups = [];
  for (let n = 0; n < 20; n++) { const at = performance.now(); arrivalRoute(game, unserved); lookups.push(performance.now() - at); }
  assert.ok(median(lookups) < 2, `arrivalRoute ${median(lookups).toFixed(3)} ms`);
});

test('the first plane lands at its airport, and the air debut is one plain entry', () => {
  const game = emptyGame(); game.day = game.lastDailyDay = 730; game.lastMonth = 24;
  game.cities = [town('home', 'Home', 20, 20), town('far', 'Farley', 80, 60)]; game.revision++;
  const watch = headlineWatch(game);
  const a = ok(build(game, 'airport-x', 18, 23)).station, b = ok(build(game, 'airport-y', 82, 55)).station;
  ok(addRoute(game, { mode: 'air', stops: [a.id, b.id], cargo: 'passengers' }));
  const entries = run(game, watch, 20), first = entries.find(entry => entry.kind === 'first');
  assert.equal(first.key, 'first:air'); assert.equal(first.art, 'plane');
  assert.ok(/first plane (lands in Farley|lands at Farley Airport)$/.test(first.title), first.title);
  assert.deepEqual(entries.filter(entry => entry.kind === 'first').length, 1);
  assert.ok(watch.modes.has('air'));
  const debut = airDebutHeadline(game);
  assert.deepEqual([debut.key, debut.kind, debut.art, debut.title, headlineKicker(debut.kind)], ['debut:air', 'debut', 'plane', 'Air travel arrives', 'News']);
  assert.doesNotMatch(debut.detail, / · |→/);
  assert.equal(recordHeadline(game, debut), true); assert.equal(recordHeadline(game, debut), false, 'once only');
  assert.equal(validateGame(game), true);
});
