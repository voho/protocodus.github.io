import test from 'node:test';
import assert from 'node:assert/strict';
import { shownProgress } from '../model.js';
import { twoTownFixture, advance } from './helpers.mjs';
import { tick } from '../model.js';

const route = (mode, length) => ({ mode, path: Array.from({ length: length + 1 }, (_, x) => ({ x, y: 0 })) });

test('vehicles leave a stop from rest, brake into the next and keep the steady pace between', () => {
  for (const [mode, ease] of [['road', .8], ['rail', 1.6], ['water', 1.2]]) {
    const r = route(mode, 20), forward = { direction: 1 }, back = { direction: -1 };
    assert.equal(shownProgress(r, forward, 0), 0); assert.equal(shownProgress(r, forward, 20), 20);
    assert.equal(shownProgress(r, back, 20), 20); assert.equal(shownProgress(r, back, 0), 0);
    assert.equal(shownProgress(r, forward, 10), 10, `${mode} cruises at its steady place`);
    assert.equal(shownProgress(r, forward, ease), ease, `${mode} has rejoined its place at the end of the ease`);
    assert.ok(shownProgress(r, forward, .1) < .1 * .3, `${mode} starts from rest`);
    assert.ok(shownProgress(r, forward, 19.9) > 19.9, `${mode} brakes: it is ahead, slowing, just before the stop`);
    let previous = -1;
    for (let p = 0; p <= 20; p += .05) { const shown = shownProgress(r, forward, p); assert.ok(shown >= previous - 1e-12, `${mode} never runs backwards`); previous = shown; }
    for (let p = 0; p <= 20; p += .5) assert.ok(Math.abs(shownProgress(r, back, p) - (20 - shownProgress(r, forward, 20 - p))) < 1e-12, `${mode} eases the same way back`);
  }
  assert.equal(shownProgress(route('air', 30), { direction: 1 }, 3), 3, 'planes keep their own flight model');
  const short = route('rail', 3);
  assert.ok(shownProgress(short, { direction: 1 }, 1) <= 1 && shownProgress(short, { direction: 1 }, 1.5) === 1.5, 'a short route eases over a third of it at most');
});

test('easing moves only where vehicles are drawn: progress and deliveries keep their pace', () => {
  const { game, route } = twoTownFixture({ buses: 2 });
  advance(game, 45, tick);
  for (const vehicle of game.vehicles) {
    const shown = shownProgress(route, vehicle), index = Math.min(Math.floor(shown), route.path.length - 2), f = shown - index, a = route.path[index], b = route.path[index + 1];
    assert.ok(Math.abs(vehicle.x - (a.x + (b.x - a.x) * f)) < 1e-9 && Math.abs(vehicle.y - (a.y + (b.y - a.y) * f)) < 1e-9, 'x and y follow the eased place');
  }
  assert.ok(route.delivered > 0, 'the buses still deliver');
});
