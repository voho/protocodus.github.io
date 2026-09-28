import test from 'node:test';
import assert from 'node:assert/strict';
import { build, buildPath, addRoute, tick, createGame, restoreGame, validateGame, stationCoverage, fareFor, drainDeliveryEvents } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { INDUSTRIES, TOWN_CARGO } from '../data.js';
import { stepContracts, contractMultiplier, contractState, contractSites, CONTRACT_DAYS, MAX_CONTRACTS } from '../contracts.js';
import { nearbyIndustries } from '../simulation-spatial.js';
import { emptyGame, line } from './helpers.mjs';

const ok = result => { assert.equal(result.ok, true, result.message); return result; };
const town = (id, x, y) => ({ id, name: id, x, y, population: 300, passengers: 0, activity: 0, growth: 0, delivered: 0, supplies: 0, lastServiceDay: null });
const coverage = game => stop => stationCoverage(game, stop);
const days = (game, count, until = () => false) => { for (let n = 0; n < count && !until(); n++) tick(game, 1); };
const saved = game => restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));

// A generated stone quarry on a straight road: Near buys 12 tiles away, Far 41 tiles away.
// A player-built quarry at x 30 shares the road but never counts as the contract's producer.
function roadFixture({ owner = 'world' } = {}) {
  const game = emptyGame(); game.cities = [town('Near', 22, 9), town('Far', 50, 9)];
  ok(build(game, 'quarry', 9, 9)); ok(build(game, 'quarry', 30, 14));
  const [quarry, own] = game.industries; quarry.owner = owner; quarry.inventory.stone = 4000; own.inventory.stone = 4000;
  ok(buildPath(game, 'road', line(10, 50, 12)));
  for (const x of [10, 22, 30, 50]) ok(build(game, 'bus-stop', x, 12));
  const [atQuarry, atNear, atOwn, atFar] = game.stations, route = (name, from, to) => ok(addRoute(game, { name, mode: 'road', cargo: 'stone', stops: [from.id, to.id] })).route;
  return { game, quarry, own, route, stops: { atQuarry, atNear, atOwn, atFar } };
}
// The first freight delivery, then the next calendar month's offers.
function firstOffers(fixture) {
  const { game, route, stops } = fixture, local = route('Local stone', stops.atQuarry, stops.atNear);
  days(game, 120, () => local.delivered > 0); assert.ok(local.delivered > 0, 'the local route delivers');
  const month = game.lastMonth; days(game, 40, () => game.lastMonth > month);
  return local;
}

test('the bonus beats a local route per vehicle-day and scales with distance', () => {
  assert.equal(contractMultiplier(10), 1, 'a short haul earns the smallest bonus');
  assert.ok(Math.abs(contractMultiplier(40) - 2.91) < .01, contractMultiplier(40));
  assert.ok(Math.abs(contractMultiplier(20) - 1.53) < .01, contractMultiplier(20));
  assert.equal(contractMultiplier(70), 4);assert.equal(contractMultiplier(200), 4);
  for (let d = 20; d < 70; d++) assert.ok(contractMultiplier(d + 1) >= contractMultiplier(d));
  // Income per vehicle-day falls as f(L) = (1 + .55√L) / L; with the bonus a served pair clearly beats a 10-tile route.
  const f = L => (1 + .55 * Math.sqrt(L)) / L;
  for (let d = 20; d <= 70; d++) assert.ok((1 + contractMultiplier(d)) * f(d) >= 1.45 * f(10), `${d} tiles`);
});

test('no offers before the first freight delivery, and player-built producers are never sources', () => {
  const fixture = roadFixture(), { game } = fixture;
  stepContracts(game, coverage(game));
  assert.equal(game.contracts, undefined, 'a company without freight deliveries sees no offers');
  const mine = roadFixture({ owner: 'player' });
  firstOffers(mine);
  assert.deepEqual(mine.game.contracts || [], [], 'only generated producers can be sources');
  const local = firstOffers(fixture);
  assert.equal(game.contracts.length, 1, 'the one distant town is the only fitting buyer');
  const [offer] = game.contracts;
  assert.deepEqual({ cargo: offer.cargo, sourceId: offer.sourceId, target: offer.target }, { cargo: 'stone', sourceId: fixture.quarry.id, target: { kind: 'city', id: 'Far' } });
  assert.equal(offer.distance, 41);assert.equal(offer.multiplier, Math.round(contractMultiplier(41) * 100) / 100);
  assert.equal(offer.offeredDay, Math.floor(game.day));assert.equal(offer.expiresDay, offer.offeredDay + CONTRACT_DAYS);
  assert.equal(contractState(game, offer), 'offer');assert.ok(local.revenue > 0);
  assert.ok(!game.notifications.some(notice => /contract/i.test(notice.message)), 'offers arrive silently');
});

test('only the exact pair is awarded; the bonus is the fare × multiplier until the contract ends', () => {
  const fixture = roadFixture(), { game, stops } = fixture, local = firstOffers(fixture), [offer] = game.contracts;
  drainDeliveryEvents(game);
  const paid = new Map(), record = () => { for (const event of drainDeliveryEvents(game)) { if (!paid.has(event.routeId)) paid.set(event.routeId, []); paid.get(event.routeId).push(event); } };
  const run = (count, until = () => false) => { for (let n = 0; n < count && !until(); n++) { tick(game, 1); record(); } };
  const pathOf = new Map();
  // Stone from the player's own quarry to the same town is not the named pair.
  const own = fixture.route('Own stone', stops.atOwn, stops.atFar);pathOf.set(own.id, own.path.length);pathOf.set(local.id, local.path.length);
  run(90, () => own.delivered > 0);assert.ok(own.delivered > 0);
  assert.equal(offer.routeId, undefined, 'another producer serving the same town does not win');
  const far = fixture.route('Far stone', stops.atQuarry, stops.atFar);pathOf.set(far.id, far.path.length);
  run(90, () => far.delivered > 0);assert.ok(far.delivered > 0);
  assert.equal(offer.routeId, far.id);assert.equal(contractState(game, offer), 'active');
  assert.equal(offer.until, offer.awardedDay + CONTRACT_DAYS);assert.ok(offer.awardedDay >= offer.offeredDay);
  run(CONTRACT_DAYS + 90, () => paid.get(far.id).some(event => event.day >= offer.until));
  assert.equal(contractState(game, offer), 'complete');
  let bonus = 0, afterwards = 0;
  for (const [routeId, events] of paid) for (const event of events) {
    const fare = fareFor(game, 'stone', pathOf.get(routeId), event.amount, event.day), active = routeId === far.id && event.day < offer.until;
    const expected = active ? fare + Math.round(fare * offer.multiplier) : fare;
    assert.equal(event.revenue, expected, `${routeId} on day ${event.day.toFixed(2)}`);
    if (active) bonus += expected - fare;else if (routeId === far.id) afterwards++;
  }
  assert.ok(bonus > 0 && afterwards > 0, 'deliveries were paid both during and after the contract');
  assert.equal(offer.earned, bonus, 'the contract records its extra income');
  assert.equal(validateGame(game), true);
  const copy = saved(game);assert.deepEqual(copy.contracts, game.contracts, 'an awarded contract survives a save');
  // A month after it ends the finished contract leaves the list; the served pair is not offered again.
  run(80, () => !game.contracts.some(contract => contract.id === offer.id));
  assert.deepEqual(game.contracts, []);
});

test('unclaimed offers lapse quietly', () => {
  const fixture = roadFixture(), { game } = fixture;
  firstOffers(fixture);
  const [offer] = game.contracts;
  days(game, CONTRACT_DAYS + 45, () => !game.contracts.some(contract => contract.id === offer.id));
  assert.ok(game.day >= offer.expiresDay, 'kept until it expires');
  assert.ok(!game.contracts.some(contract => contract.id === offer.id));
  assert.ok(game.contracts.every(contract => contract.offeredDay > offer.offeredDay), 'a later offer may name the pair again');
  assert.ok(!game.notifications.some(notice => /contract/i.test(notice.message)), 'no notice for a lapsed offer');
});

test('offers are deterministic for a seed and month and survive a save', () => {
  const offers = () => { const game = createGame({ biome: 'taiga', size: 'regional', seed: 1847 });game.contracts = [];stepContracts(game, coverage(game));return game; };
  const game = offers(), twin = offers();
  assert.equal(game.contracts.length, 3);assert.deepEqual(twin.contracts, game.contracts);
  for (const contract of game.contracts) {
    const sites = contractSites(game, contract);
    assert.ok(sites, contract.id);assert.notEqual(sites.source.owner, 'player');
    assert.ok(INDUSTRIES[sites.source.kind].outputs[contract.cargo]);
    assert.ok(contract.target.kind === 'city' ? TOWN_CARGO.includes(contract.cargo) : INDUSTRIES[sites.target.kind].inputs[contract.cargo]);
    assert.ok(contract.distance >= 20 && contract.distance <= 70, `${contract.distance} tiles`);
    assert.equal(contract.multiplier, Math.round(contractMultiplier(contract.distance) * 100) / 100);
  }
  assert.equal(new Set(game.contracts.map(contract => contract.id)).size, 3);
  const copy = saved(game);
  assert.ok(copy);assert.deepEqual(copy.contracts, game.contracts);
  // A later month draws from its own stream, identically in the original and the restored company.
  for (const company of [game, copy]) { company.day += 40;company.contracts = company.contracts.slice(1);stepContracts(company, coverage(company)); }
  assert.deepEqual(copy.contracts, game.contracts);assert.equal(game.contracts.length, 3);
  assert.notEqual(game.contracts[2].id, twin.contracts[0].id);
});

test('contracts are optional, bounded state; missing sites read as expired', () => {
  const { game, quarry } = roadFixture();game.day = 400;
  const offer = { id: 'contract-9-1', cargo: 'stone', sourceId: quarry.id, target: { kind: 'city', id: 'Far' }, distance: 41, multiplier: 2.83, offeredDay: 300, expiresDay: 665 };
  const valid = contracts => validateGame({ ...game, contracts });
  assert.equal(valid(undefined), true);assert.equal(valid([]), true);assert.equal(valid([offer]), true);
  const awarded = { ...offer, routeId: 'route-7', awardedDay: 320, until: 685, earned: 1200 };
  assert.equal(valid([awarded]), true, 'a route id that no longer exists is allowed');
  for (const [label, contracts] of [
    ['a list', {}], ['eight at most', Array.from({ length: MAX_CONTRACTS + 1 }, (_, n) => ({ ...offer, id: `c-${n}` }))], ['unique ids', [offer, { ...offer }]],
    ['freight only', [{ ...offer, cargo: 'passengers' }]], ['known cargo', [{ ...offer, cargo: 'gold' }]], ['a target', [{ ...offer, target: { kind: 'station', id: 'x' } }]],
    ['the multiplier range', [{ ...offer, multiplier: 4.5 }]], ['a past offer', [{ ...offer, offeredDay: 401, expiresDay: 766 }]], ['a year to claim', [{ ...offer, expiresDay: 700 }]],
    ['award fields together', [{ ...offer, earned: 0 }]], ['a year of bonus', [{ ...awarded, until: 700 }]], ['whole award days', [{ ...awarded, awardedDay: 320.5, until: 685.5 }]], ['earned money', [{ ...awarded, earned: -1 }]],
  ]) assert.equal(valid(contracts), false, label);
  game.contracts = [{ ...offer, sourceId: 'industry-gone' }, awarded, offer];
  assert.equal(contractState(game, game.contracts[0]), 'expired');assert.equal(contractState(game, awarded), 'expired', 'its route was retired');
  assert.equal(contractState(game, offer), 'offer');
  stepContracts(game, coverage(game));
  assert.deepEqual(game.contracts.map(contract => contract.id), [offer.id], 'dangling contracts are dropped at the next month');
});

test('monthly generation takes under 2 ms on a 2048² world', () => {
  const game = createGame({ biome: 'taiga', seed: 1847, size: 'square2048' }), times = [];
  nearbyIndustries(game, 0, 0, 1);
  for (let run = 0; run < 7; run++) { game.contracts = [];const start = performance.now();stepContracts(game, coverage(game));times.push(performance.now() - start); }
  assert.equal(game.contracts.length, 3);
  times.sort((a, b) => a - b);assert.ok(times[3] < 2, `${times[3].toFixed(2)} ms`);
});
