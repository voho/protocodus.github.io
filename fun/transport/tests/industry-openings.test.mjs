import test from 'node:test';
import assert from 'node:assert/strict';
import { addRoute, build, buildPath, tick, validateGame, createGame, restoreGame, openIndustry, STATION_RADIUS } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { planIndustryOpening, openingCeiling, openedCount, hasCarriedFreight, OPENINGS } from '../industry-openings.js';
import { industrySiteProblem, industryDistance, industrySize } from '../industry-sites.js';
import { buildingAt } from '../building-sites.js';
import { groupNotices } from '../ui-notices.js';
import { calendarMonth } from '../economy-pricing.js';
import { surfaceHeight } from '../terrain-geometry.js';
import { emptyGame, line } from './helpers.mjs';

const monthStart = month => (Date.UTC(1950, month, 1) - Date.UTC(1950, 0, 1)) / 86400000;
// One daily step across the boundary into `month`: fast, and the real tick path.
function enterMonth(game, month) { game.day = monthStart(month) - .5; game.lastMonth = month - 1; tick(game, 1); assert.equal(calendarMonth(game), month); }
const roundTrip = game => restoreGame(JSON.parse(JSON.stringify(encodeGame(game))));

function farmTown({ delivered = true } = {}) {
  const game = emptyGame();
  assert.equal(build(game, 'farm', 10, 6).ok, true);
  assert.equal(build(game, 'food-plant', 30, 10).ok, true);
  assert.equal(build(game, 'city', 50, 10).ok, true);
  assert.equal(buildPath(game, 'road', line(10, 50, 13)).ok, true);
  for (const x of [10, 30, 50]) assert.equal(build(game, 'bus-stop', x, 13).ok, true);
  assert.equal(addRoute(game, { mode: 'road', cargo: 'grain', stops: game.stations.slice(0, 2).map(stop => stop.id) }).ok, true);
  if (delivered) game.routes[0].delivered = 1;
  return game;
}
function freightRegion(size = 'regional') {
  const game = createGame({ biome: 'taiga', size, seed: 1847 });
  game.routes.push({ ...game.routes[0], id: 'route-freight', cargo: 'coal', delivered: 1 });
  return game;
}
const gapTo = (site, x0, y0, x1 = x0, y1 = y0) => { const size = industrySize(site); return Math.max(x0 - (site.x + size - 1), site.x - x1, y0 - (site.y + size - 1), site.y - y1); };
function assertRules(game, site) {
  const size = industrySize(site), center = { x: site.x + (size - 1) / 2, y: site.y + (size - 1) / 2 };
  assert.equal(industrySiteProblem(game, site.kind, site.x, site.y, size, site), null);
  for (const stop of game.stations) assert.ok(industryDistance(site, stop) > STATION_RADIUS, 'outside every existing catchment');
  for (const city of game.cities) assert.ok(gapTo(site, city.x, city.y) >= OPENINGS.nearTown, `clear of ${city.name}`);
  for (let y = site.y - OPENINGS.homeMargin; y < site.y + size + OPENINGS.homeMargin; y++) for (let x = site.x - OPENINGS.homeMargin; x < site.x + size + OPENINGS.homeMargin; x++) {
    if (x < 0 || y < 0 || x >= game.width || y >= game.height) continue;
    assert.ok(!game.tiles[y * game.width + x].zone && !buildingAt(game, x, y), 'homes and zones stay out of reach');
  }
  for (const other of game.industries) if (other !== site) {
    const gap = gapTo(site, other.x, other.y, other.x + industrySize(other) - 1, other.y + industrySize(other) - 1);
    assert.ok(gap > OPENINGS.siteGap, `gap ${gap} to ${other.kind}`);
  }
  let low = Infinity, high = -Infinity; for (let v = site.y; v <= site.y + size; v++) for (let u = site.x; u <= site.x + size; u++) { const h = surfaceHeight(game, u, v); low = Math.min(low, h); high = Math.max(high, h); }
  assert.ok(high - low <= 1, 'gentle ground');
  assert.ok(!game.industries.some(other => other !== site && other.kind === site.kind && industryDistance(other, center) <= OPENINGS.sameKind), 'no twin nearby');
}

test('no opening before January 1952 or before any freight delivery', () => {
  const early = farmTown();
  for (let month = 1; month < 24; month++) enterMonth(early, month);
  assert.equal(openedCount(early), 0);
  assert.equal(validateGame(early), true);
  const idle = farmTown({ delivered: false });
  for (let month = 24; month < 144; month++) assert.equal(planIndustryOpening(idle, month), null);
  idle.routes.push({ ...idle.routes[0], id: 'route-passengers', cargo: 'passengers', delivered: 40 });
  assert.equal(hasCarriedFreight(idle), false, 'passengers alone are not freight');
  idle.routes[0].delivered = 1;
  assert.equal(hasCarriedFreight(idle), true);
});

test('forced openings obey every placement rule and announce themselves', () => {
  const game = farmTown(), sites = [];
  for (let month = 24; month < 120 && sites.length < 3; month++) { const site = openIndustry(game, month, { force: true }); if (site) sites.push(site); }
  assert.ok(sites.length >= 2, `opened ${sites.length}`);
  for (const site of sites) {
    assertRules(game, site);
    assert.ok(['farm', 'food-plant'].includes(site.kind), site.kind);
    assert.equal(site.owner, 'world');
    assert.ok(Number.isInteger(site.openedDay));
  }
  const notices = game.notifications.filter(n => n.topic === 'industry-opening');
  assert.equal(notices.length, sites.length);
  assert.deepEqual(notices.map(n => n.target), sites.map(site => ({ kind: 'industry', id: site.id })).reverse());
  for (const notice of notices) assert.match(notice.message, /^New (grain farm|food plant) opens near \w+\.$/);
  assert.equal(notices[0].template, `New {industry:${sites.at(-1).id}} opens near {town:${game.cities[0].id}}.`);
  const grouped = groupNotices(notices.slice(0, 2).reverse());
  assert.equal(grouped.length, 1);
  assert.match(grouped[0].message, /^2 new industries opened: (grain farm|food plant) and (grain farm|food plant)\.$/);
  assert.equal(grouped[0].type, 'success');
  assert.equal(validateGame(game), true);
});

test('the monthly tick opens industries deterministically, however time is partitioned', () => {
  const a = farmTown(), b = farmTown();
  const opened = game => game.industries.filter(site => site.openedDay !== undefined).map(site => `${site.id}:${site.kind}@${site.x},${site.y}:${site.openedDay}`);
  for (let month = 24; month < 24 + 12 * 30 && !opened(a).length; month++) {
    enterMonth(a, month);
    b.day = monthStart(month) - .5; b.lastMonth = month - 1; for (let n = 0; n < 4; n++) tick(b, .25);
  }
  assert.ok(opened(a).length >= 1, 'an opening within 30 years');
  assert.deepEqual(opened(b), opened(a));
  assert.equal(a.notifications[0].topic, 'industry-opening');
  assert.equal(validateGame(a), true);
});

test('openings survive a save round trip and validation rejects bad days', () => {
  const game = farmTown();
  let site = null; for (let month = 24; !site && month < 200; month++) site = openIndustry(game, month, { force: true });
  assert.ok(site);
  const restored = roundTrip(game);
  assert.ok(restored);
  assert.equal(restored.industries.find(i => i.id === site.id).openedDay, site.openedDay);
  for (const bad of [-1, 1.5, Math.floor(game.day) + 1, '3']) { site.openedDay = bad; assert.equal(validateGame(game), false, String(bad)); }
  delete site.openedDay; assert.equal(validateGame(game), true);
});

test('openings stop at half the original industry count', () => {
  const game = freightRegion(), ceiling = openingCeiling(game);
  assert.equal(ceiling, Math.max(4, Math.ceil(game.industries.length / 2)));
  for (let month = 24; month < 24 + 600; month++) { openIndustry(game, month, { force: true }); assert.ok(openedCount(game) <= ceiling); }
  assert.ok(openedCount(game) > 0);
  assert.equal(openingCeiling(game), ceiling, 'opened sites never raise the ceiling');
  assert.equal(validateGame(game), true);
});

test('player-built industries keep their shape and numbering', () => {
  const game = farmTown(), id = `industry-${game.nextId}`;
  assert.equal(build(game, 'quarry', 20, 30).ok, true);
  const quarry = game.industries.at(-1);
  assert.equal(quarry.id, id);
  assert.equal(quarry.owner, 'player');
  assert.equal('openedDay' in quarry, false);
  assert.deepEqual(quarry.inventory, { stone: 0 });
});

test('new industries and towns never reuse a generated id', () => {
  const game = freightRegion(), fits = tool => { for (let y = 4; y < game.height - 4; y += 3) for (let x = 4; x < game.width - 4; x += 3) { const result = build(game, tool, x, y); if (result.ok) return result; } return null; };
  game.money = 1e8; game.nextId = 1;
  assert.ok(game.industries.some(site => site.id === 'industry-1') && game.cities.some(city => city.id === 'city-1'));
  const unique = (list, id) => list.filter(item => item.id === id).length === 1;
  let site = null; for (let month = 24; !site && month < 200; month++) site = openIndustry(game, month, { force: true });
  assert.ok(site && unique(game.industries, site.id), site?.id);
  assert.equal(validateGame(game), true); assert.ok(roundTrip(game));
  const quarry = fits('quarry');
  assert.ok(quarry && unique(game.industries, quarry.industry.id), quarry?.industry.id);
  assert.equal(validateGame(game), true); assert.ok(roundTrip(game));
  game.nextId = 1;
  const town = fits('city');
  assert.ok(town && unique(game.cities, town.city.id), town?.city.id);
  assert.equal(validateGame(game), true); assert.ok(roundTrip(game));
});

test('an opening on a fresh 1024 world, whose generated sites pass nextId, keeps the save loadable', () => {
  const game = freightRegion('square1024');
  assert.ok(game.industries.some(site => site.id === `industry-${game.nextId}`), 'makeId alone would collide');
  let site = null; for (let month = 24; !site && month < 200; month++) site = openIndustry(game, month, { force: true });
  assert.ok(site && game.industries.filter(other => other.id === site.id).length === 1, site?.id);
  assert.equal(validateGame(game), true);
});

test('the opening catchment matches the stop catchment', () => { assert.equal(OPENINGS.catchment, STATION_RADIUS); });

test('planning a month stays cheap on a 512 world', () => {
  const game = freightRegion('square512'), times = [];
  for (let month = 24; month < 84; month++) { const t = performance.now(); planIndustryOpening(game, month, { force: true }); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  assert.ok(times[30] < 3, `median ${times[30].toFixed(2)} ms`);
  const start = performance.now();
  for (let month = 24; month < 24 + 1200; month++) planIndustryOpening(game, month);
  const mean = (performance.now() - start) / 1200;
  assert.ok(mean < .5, `mean ${mean.toFixed(3)} ms`);
});
