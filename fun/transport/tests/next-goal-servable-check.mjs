// Slow sweep: every first cargo suggestion on 75 fresh worlds names sites a stop can serve.
import assert from 'node:assert/strict';
import { createGame } from '../model.js';
import { nextProject, stopSiteKind } from '../gameplay-insights.js';

const failures = [], ports = [];
for (const biome of ['taiga', 'tundra', 'desert']) for (let seed = 100; seed < 125; seed++) {
  const game = createGame({ biome, seed, size: 'square512' }), project = nextProject(game);
  assert.equal(project.title, 'Your first cargo route');
  for (const choice of project.choices) {
    const kind = stopSiteKind(game, choice.source);
    if (!kind) failures.push(`${biome} ${seed}: ${choice.source.name} at ${choice.source.x}, ${choice.source.y}`);
    if (kind === 'port') ports.push(`${biome} ${seed}: ${choice.source.name}`);
    if (choice.buyer.kind === 'industry') assert.ok(stopSiteKind(game, game.industries.find(site => site.id === choice.buyer.id)), `${biome} ${seed}: ${choice.buyer.name} is unreachable`);
  }
  assert.ok(project.choices.length >= 1 && project.choices.length <= 3, `${biome} ${seed}: ${project.choices.length} choices`);
  assert.equal(new Set(project.choices.map(choice => choice.source.id)).size, project.choices.length, `${biome} ${seed}: alternatives name distinct producers`);
}
assert.deepEqual(failures, [], 'no suggestion names a producer that no stop can serve');
console.log(`75 worlds: every suggested producer and buyer is servable (${ports.length} port-only alternatives).`);
