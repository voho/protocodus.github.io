import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick } from '../model.js';
import { routeHealth, nextProject } from '../gameplay-insights.js';

// Every mechanic must stay safe to ignore: a company left alone for decades keeps
// earning, its starter service keeps running and nothing warns or nags the player.
test('an unattended company keeps earning for thirty years without a warning', () => {
  const game = createGame({ biome: 'taiga', seed: 1847, size: 'regional' }), starter = game.routes[0], notices = new Set(game.notifications.map(notice => notice.id));
  let money = game.money;
  for (let year = 1; year <= 30; year++) {
    for (let day = 0; day < 365; day++) tick(game, 1);
    assert.ok(game.money >= money, `year ${year}: ${Math.round(game.money)} after ${Math.round(money)}`);
    money = game.money;
    // A busy service only offers room for another vehicle; it never stops working.
    const health = routeHealth(game, starter);
    assert.ok(health.state === 'running' && health.label === 'Running' || health.state === 'busy', `year ${year}: ${health.label}`);
    for (const notice of game.notifications) if (!notices.has(notice.id)) { notices.add(notice.id); assert.ok(!['warning', 'error'].includes(notice.type), `year ${year}: ${notice.message}`); }
    const goal = nextProject(game);
    assert.doesNotMatch(`${goal.title} ${goal.detail}`, /must|deadline|expires|last chance/i);
  }
});
