import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LINE_COLORS } from '../design-tokens.js';
import { lineFor, lineColor, nextLineColor, nextRouteNumber, ensureRouteNumbers, routeLabel, defaultRouteName } from '../route-lines.js';
import { addRoute, build, buildPath, createGame, removeRoute } from '../model.js';
import { emptyGame, line } from './helpers.mjs';

const fill = name => LINE_COLORS.find(line => line.name === name).fill;
const at = (color, ...stops) => ({ stops, color });

test('the six legacy colours map to their successors, fills to themselves and any other hex to the nearest fill', () => {
  const legacy = { '#69c6bc': 'Cobalt', '#efc16f': 'Marigold', '#e5966d': 'Crimson', '#88aee4': 'Cornflower', '#b3cf83': 'Plum', '#d893b1': 'Heather' };
  for (const [hex, name] of Object.entries(legacy)) {
    assert.equal(lineFor({ color: hex }).name, name, `${hex} is ${name}`);
    assert.equal(lineFor({ color: hex.toUpperCase() }).fill, fill(name), `${hex} in capitals is ${name}`);
  }
  LINE_COLORS.forEach((line, i) => {
    const mapped = lineFor({ color: line.fill.toLowerCase() });
    assert.deepEqual([mapped.index, mapped.name, mapped.fill, mapped.on, mapped.light], [i + 1, line.name, line.fill, line.on, line.on !== '#FFFFFF']);
  });
  assert.equal(lineFor({ color: '#2e5ea9' }).name, 'Cobalt', 'a near hex takes the nearest fill');
  assert.equal(lineFor({ color: '#bd7862' }).name, 'Crimson');
  assert.equal(lineFor({ color: '#c0c0c0' }).light, true);
  assert.equal(lineFor({}).name, 'Cobalt', 'a route without a colour draws in the first line');
  assert.equal(lineFor({ color: 'teal' }).name, 'Cobalt');
  assert.equal(lineColor('#69C6BC'), lineFor({ color: '#69c6bc' }), 'one line object per hex');
  assert.equal(Object.isFrozen(lineFor({ color: '#69c6bc' })), true);
});

test('a new line avoids the colours at its stops, spreads over the palette and falls back to the least-used one', () => {
  const game = { routes: [at(fill('Cobalt'), 'a', 'b'), at(fill('Crimson'), 'c', 'a'), at(fill('Cobalt'), 'x', 'y'), at(fill('Marigold'), 'x', 'z')] };
  assert.equal(nextLineColor(game, ['e', 'f']).name, 'Cornflower', 'a line that shares no stop takes the least worn colour, lowest first');
  assert.equal(nextLineColor({ routes: game.routes.slice(0, 3) }, ['e', 'f']).name, 'Marigold');
  assert.equal(nextLineColor(game, ['b', 'z']).name, 'Cornflower', 'Cobalt and Marigold call at its stops');
  game.routes.push(at(fill('Cornflower'), 'q', 'r'), at(fill('Plum'), 'q', 'r'), at(fill('Heather'), 'q', 'r'), at(fill('Umber'), 'q', 'r'), at(fill('Iris'), 'q', 'r'), at(fill('Graphite'), 'q', 'r'));
  assert.equal(nextLineColor(game, ['a', 'd']).name, 'Marigold', 'every colour is worn once or more: Marigold is the least worn not at its stops');
  assert.equal(nextLineColor(game, ['z', 'd']).name, 'Crimson', 'Marigold calls at z, so the next least worn');
  assert.equal(nextLineColor({ routes: [at('#69c6bc', 'a', 'b'), at(fill('Marigold'), 'x', 'y')] }, ['a', 'z']).name, 'Crimson', 'a legacy teal counts as Cobalt');
  const busy = { routes: [...LINE_COLORS.map(line => at(line.fill, 'hub', 'far')), at(fill('Cobalt'), 'hub', 'b'), at(fill('Marigold'), 'hub', 'c'), at(fill('Cornflower'), 'd', 'hub')] };
  assert.equal(nextLineColor(busy, ['hub', 'e']).name, 'Crimson', 'every colour calls at the hub, so the least used, lowest first');
  busy.routes.push(at(fill('Crimson'), 'hub', 'g'), at(fill('Plum'), 'hub', 'h'));
  assert.equal(nextLineColor(busy, ['hub', 'e']).name, 'Heather');
  assert.equal(nextLineColor({ routes: [] }, []).fill, fill('Cobalt'));
});

// Three stone routes from one quarry stop: the second and third share the quarry with the first.
function quarry() {
  const game = emptyGame();
  assert.equal(build(game, 'quarry', 10, 7).ok, true);
  game.cities = [{ id: 'town-a', name: 'Alderbrook', x: 30, y: 10 }, { id: 'town-b', name: 'Pinehaven', x: 50, y: 10 }];
  assert.equal(buildPath(game, 'road', line(10, 50, 12)).ok, true);
  for (const x of [10, 30, 50]) assert.equal(build(game, 'bus-stop', x, 12).ok, true);
  return { game, stops: game.stations.map(stop => stop.id) };
}

test('numbers stay with their routes: a retired number is the next one given, and no line changes colour', () => {
  const { game, stops: [q, a, p] } = quarry(), launch = (stops, cargo = 'stone') => { const result = addRoute(game, { mode: 'road', stops, cargo }); assert.equal(result.ok, true, result.message); return result.route; };
  const one = launch([q, a]), two = launch([q, p]), three = launch([a, p], 'passengers');
  assert.deepEqual([one.number, two.number, three.number], [1, 2, 3]);
  assert.deepEqual([one, two, three].map(route => lineFor(route).name), ['Cobalt', 'Marigold', 'Crimson'], 'each line differs from the lines at its stops');
  assert.deepEqual([one, two, three].map(route => route.color), [fill('Cobalt'), fill('Marigold'), fill('Crimson')], 'new routes store the fill itself');
  assert.equal(removeRoute(game, two.id).ok, true);
  assert.deepEqual(game.routes.map(route => [route.number, route.color]), [[1, fill('Cobalt')], [3, fill('Crimson')]], 'retiring route 2 renumbers and recolours nothing');
  assert.equal(nextRouteNumber(game), 2);
  const four = launch([q, p]);
  assert.equal(four.number, 2, 'the next route takes the freed number');
  assert.equal(routeLabel(four), 'Route 2');
  assert.equal(launch([q, p]).number, 4);
  assert.equal(routeLabel({}), 'Route');
});

test('a legacy save is numbered in creation order, the same way every time, and numbering it again changes nothing', () => {
  const legacy = () => ({ routes: [{ id: 'route-140' }, { id: 'route-12', number: 0 }, { id: 'route-105' }, { id: 'route-9', number: 2 }, { id: 'route-230', number: 2 }, { id: 'route-77', number: 'x' }, { id: 'custom' }, { id: 'route-300', number: 10000 }] });
  const game = legacy(), numbered = ensureRouteNumbers(game);
  assert.equal(numbered, 7, 'only the route that already had a unique valid number keeps it');
  assert.deepEqual(Object.fromEntries(game.routes.map(route => [route.id, route.number])), { 'route-9': 2, 'route-12': 1, 'route-77': 3, 'route-105': 4, 'route-140': 5, 'route-230': 6, 'route-300': 7, custom: 8 });
  const again = legacy(); ensureRouteNumbers(again);
  assert.deepEqual(again, game, 'the same save gets the same numbers');
  const before = structuredClone(game);
  assert.equal(ensureRouteNumbers(game), 0);
  assert.deepEqual(game, before, 'numbering is idempotent');
  const kept = { routes: [{ id: 'route-5', number: 7 }, { id: 'route-2' }] };
  ensureRouteNumbers(kept);
  assert.deepEqual(kept.routes.map(route => route.number), [7, 1], 'a valid number is never renumbered');
  assert.equal(nextRouteNumber(kept), 2);
});

test('default names read as the freight flow or the two towns, with a count for a repeat', () => {
  const { game, stops: [q, a, p] } = quarry(), stop = id => game.stations.find(station => station.id === id);
  assert.equal(defaultRouteName(game, [stop(q), stop(a)], 'stone'), 'Stone quarry to Alderbrook', 'the supplier, then the town that buys');
  assert.equal(defaultRouteName(game, [stop(a), stop(p)], 'passengers'), 'Alderbrook – Pinehaven', 'two towns joined by an en dash');
  assert.equal(defaultRouteName(game, [stop(q), stop(a)], 'coal'), `${stop(q).name} to Alderbrook`, 'an end without its site is named after its town, then its stop');
  assert.equal(build(game, 'logging-camp', 26, 13).ok, true);
  assert.equal(build(game, 'sawmill', 48, 13).ok, true);
  assert.equal(defaultRouteName(game, [stop(a), stop(p)], 'timber'), 'Logging camp to Sawmill', 'industry ends use their display names');
  assert.equal(addRoute(game, { mode: 'road', stops: [q, a], cargo: 'stone' }).route.name, 'Stone quarry to Alderbrook', 'a route launched without a name takes the default');
  const second = addRoute(game, { mode: 'road', stops: [q, a], cargo: 'stone' }).route;
  assert.equal(second.name, 'Stone quarry to Alderbrook 2', 'a name already in use gets a count');
  assert.equal(addRoute(game, { mode: 'road', stops: [q, a], cargo: 'stone' }).route.name, 'Stone quarry to Alderbrook 3');
  assert.equal(defaultRouteName(game, [stop(q), stop(a)], 'stone', second), 'Stone quarry to Alderbrook 2', 'a route never collides with its own name');
  assert.equal(addRoute(game, { name: 'Morning stone', mode: 'road', stops: [q, a], cargo: 'stone' }).route.name, 'Morning stone', 'a chosen name is kept');
  game.cities[0].name = 'Alderbrook-upon-the-Northern-Pines';
  const long = defaultRouteName(game, [stop(q), stop(a)], 'stone');
  assert.equal(long, 'Stone quarry to Alderbrook-upon-the…');
  assert.ok(long.length <= 36);
  assert.equal(defaultRouteName(game, [stop(q)], 'stone'), '');
});

test('a new world opens with route 1, Cobalt, named after its two towns', () => {
  const game = createGame({ size: 'regional', seed: 1847 }), [route] = game.routes;
  assert.equal(route.number, 1);
  assert.equal(route.color, fill('Cobalt'));
  assert.equal(route.name, `${game.cities[0].name} – ${game.cities[1].name}`);
  assert.equal(game.notifications.length, 1, 'naming and numbering add no notices');
});

test('route-lines.js stays DOM-free', () => {
  const source = readFileSync(new URL('../route-lines.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(document|window|getComputedStyle|localStorage)\b/);
  assert.match(source, /from '\.\/design-tokens\.js'/);
});
