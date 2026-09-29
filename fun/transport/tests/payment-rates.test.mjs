import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, fareFor, transitPay, getRouteFleet } from '../model.js';
import { routeCargoList } from '../route-planner.js';
import { paymentRatesHTML, paymentRateSeries, routeTrip, planTrip, tripText, tripTitle, keepText, PAYMENT_DAYS } from '../payment-rates.js';
import { line } from './helpers.mjs';

const worlds = new Map();
const world = biome => { if (!worlds.has(biome)) worlds.set(biome, createGame({ biome, size: 'regional', seed: 1847 })); return worlds.get(biome); };
const count = (html, pattern) => (html.match(pattern) || []).length;

test('the chart draws one line and one table row for every cargo of the biome', () => {
  for (const [biome, expected] of [['taiga', 13], ['tundra', 11], ['desert', 12]]) {
    const game = world(biome), cargo = routeCargoList(game), html = paymentRatesHTML(game);
    assert.equal(cargo.length, expected, biome);
    assert.equal(count(html, /data-payment-line="/g), cargo.length, `${biome} lines`);
    assert.equal(count(html, /<th scope="row">/g), cargo.length, `${biome} table rows`);
    for (const key of cargo) assert.ok(html.includes(`data-payment-cargo="${key}"`), `${biome} legend names ${key}`);
    assert.ok(html.includes('Cargo payment rates') && html.includes('never under half'), biome);
    assert.doesNotMatch(html, /\s·\s|→/, 'no middle-dot glue or arrows');
  }
});

test('each series is flat, falls in a straight line, then rests at half the fare', () => {
  const game = world('taiga');
  for (const series of paymentRateSeries(game)) {
    assert.equal(series.full, fareFor(game, series.cargo, 21, 10, game.day, 0));
    assert.ok(series.fare(PAYMENT_DAYS) >= Math.round(series.full * .5) - 1, series.cargo);
    for (let d = 1; d <= PAYMENT_DAYS; d++) assert.ok(series.fare(d) <= series.fare(d - 1), `${series.cargo} on day ${d}`);
  }
  const express = paymentRateSeries(game).find(series => series.cargo === 'passengers');
  assert.deepEqual(express.knots.map(d => Math.round(d * 100) / 100), [0, 14, 47.33, 120]);
});

test('the starter route shows its length, days on the way and pay for one passenger', () => {
  const game = world('taiga'), route = game.routes[0];
  const trip = routeTrip(game, route, getRouteFleet(game, route.id).minLevel);
  assert.deepEqual({ tiles: trip.tiles, travel: trip.travel, days: trip.days, measured: trip.measured, share: trip.share, perUnit: trip.perUnit }, { tiles: 24, travel: 24, days: 10, measured: false, share: 1, perUnit: 72 });
  assert.deepEqual(tripText(trip), ['24 tiles, about 10 days', '$72 each']);
  assert.match(tripTitle(trip, 'passengers'), /^A trip takes about 10 days over 24 tiles\. Each passenger pays \$72 at today’s prices, the full fare\./);
});

test('a slow plan keeps less, and says so', () => {
  const game = world('taiga'), trip = planTrip(game, 'road', 'passengers', line(10, 90, 12), 0);
  assert.ok(trip.share < 1, `${trip.share}`);
  assert.equal(trip.perUnit, fareFor(game, 'passengers', 81, 1, game.day, trip.days));
  assert.match(tripText(trip)[1], /^\$[\d,]+ each, \d+% of full pay$/);
  assert.match(tripTitle(trip, 'stone'), /^A trip takes about \d+ days over 80 tiles\. Stone pays \$[\d,]+ each at today’s prices, \d+% of the full fare: faster or newer vehicles keep more\./);
  assert.equal(keepText(transitPay('passengers', 12), trip.share), ' and keep 100% of the fare');
  assert.equal(keepText(trip.share + .05, trip.share), '', 'a small gain is not worth a clause');
});

test('a detour is paid by twice the grid distance, and the title says why', () => {
  const game = world('taiga');
  const U = [...Array.from({ length: 71 }, (_, i) => ({ x: 20, y: 12 + i })), ...line(21, 32, 82), ...Array.from({ length: 70 }, (_, i) => ({ x: 32, y: 81 - i }))];
  const trip = planTrip(game, 'rail', 'coal', U, 0);
  assert.equal(trip.tiles, 24); assert.equal(trip.travel, 152); assert.equal(trip.capped, true);
  assert.match(tripTitle(trip, 'coal'), /^A trip takes about \d+ days over 152 tiles\. .* Fares count 24 of its 152 tiles, twice the grid distance between its stops\./);
});
