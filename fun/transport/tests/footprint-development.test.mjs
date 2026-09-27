import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../world.js';
import { buildingAt, buildingFootprint, buildingTiles, placeBuildingSite } from '../building-sites.js';
import { industryFootprint, industryTiles } from '../industry-sites.js';
import { localEnvironment, randomAt, stepEcology } from '../environment.js';
import { housingCapacity, settlementSuitability, stepSettlements } from '../settlements.js';
import { planStructureSpan, terraformProblem } from '../terrain-engineering.js';
import { emptyGame, tileAt } from './helpers.mjs';

const naturalRecipes = {
  taiga: 'acc0b400e127172d79d89645461b66633bbcb9164669dd8da9e4889d37c0e3dc',
  tundra: 'ea7faddee612a581f912fe9d2d54d7b8fdfe915d512f4967cca59a95b3df7927',
  desert: '9c5e3e64b37acfab5dd7524af71610644b9a98df2475af216119ec7e2347b59a',
};
for (const biome of ['taiga', 'tundra', 'desert']) {
  test(`${biome}: recipe 4 is unchanged while recipe 5 allocates every full site`, () => {
    const old = generateWorld(biome, 1847, 'square512', 4);
    assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'), naturalRecipes[biome]);
    const current = generateWorld(biome, 1847, 'square512', 5), reserved = new Set();
    const identities = world => world.tiles.filter(t => t.building).map(t => t.building.kind).sort();
    assert.deepEqual(identities(current), identities(old), 'every town identity survives plot allocation');
    assert.deepEqual(current.industries.map(i => i.kind), old.industries.map(i => i.kind));
    const reserve = (points, kind) => {
      for (const p of points) {
        assert.ok(p.x >= 0 && p.y >= 0 && p.x < current.width && p.y < current.height, kind);
        const index = p.y * current.width + p.x, t = current.tiles[index];
        assert.ok(!reserved.has(index), `overlapping ${kind} at ${p.x},${p.y}`);
        assert.ok(!t.road && !t.rail && !t.bridge && !t.tunnel && !t.zone, kind);
        assert.notEqual(t.terrain, 'water');
        assert.ok(!current.cities.some(c => c.x === p.x && c.y === p.y));
        reserved.add(index);
      }
    };
    let larger = 0;
    for (let index = 0; index < current.tiles.length; index++) {
      const t = current.tiles[index];
      assert.equal(t.elevation, old.tiles[index].elevation, 'lot allocation never flattens terrain');
      assert.equal(t.road, old.tiles[index].road, 'existing street layout is retained');
      if (!t.building) continue;
      assert.equal(t.building.footprint, buildingFootprint(t.building.kind));
      if (t.building.footprint > 1) larger++;
      reserve(buildingTiles({ x: index % current.width, y: Math.floor(index / current.width), building: t.building }), t.building.kind);
    }
    for (const site of current.industries) {
      assert.equal(site.footprint, industryFootprint(site.kind));
      reserve(industryTiles(site), site.kind);
    }
    assert.ok(larger > 100);
  });
}

test('neighborhood effects count a large site once and reach its distant edge', () => {
  const game = emptyGame();
  assert.ok(placeBuildingSite(game, 'school', 20, 20));
  assert.equal(localEnvironment(game, 20, 20).school, 1);
  assert.equal(localEnvironment(game, 22, 21, 1).school, 1, 'anchor outside sample but occupied edge inside it');
  game.industries.push({ id: 'mill', kind: 'steel-mill', x: 30, y: 20, footprint: 3 }); game.revision++;
  assert.equal(localEnvironment(game, 31, 21).industries, 1);
  assert.equal(localEnvironment(game, 33, 21, 1).industries, 1);
});

test('ecology and earthworks preserve every child cell of a 3×3 landmark', () => {
  const game = emptyGame();
  assert.ok(placeBuildingSite(game, 'stadium', 20, 20));
  const points = buildingTiles(buildingAt(game, 20, 20));
  for (const p of points) Object.assign(tileAt(game, p.x, p.y), { terrain: 'forest', detail: 'pine' });
  const before = points.map(p => structuredClone(tileAt(game, p.x, p.y)));
  for (let day = 1; day <= 240; day++) { game.day = day; stepEcology(game); }
  assert.deepEqual(points.map(p => tileAt(game, p.x, p.y)), before);
  for (const p of points) assert.match(terraformProblem(game, 'raise', p.x, p.y), /Clear buildings/);
  for (const tool of ['bridge', 'tunnel']) {
    const span = Array.from({ length: 5 }, (_, n) => ({ x: 22, y: 19 + n }));
    for (const [n, p] of span.entries()) tileAt(game, p.x, p.y).elevation = (n === 0 || n === 4 ? 4 : tool === 'bridge' ? 2 : 7) / 16;
    const plan = planStructureSpan(game, tool, span);
    assert.equal(plan.ok, false); assert.match(plan.message, /Clear|occupied|building/i);
  }
});

function growthFixture() {
  const game = emptyGame();
  game.cities = [{ id: 'city', x: 18, y: 20, population: 200, activity: 7, supplies: 1000, lastServiceDay: 0 }];
  game.stations = [{ id: 'stop', x: 18, y: 20 }];
  game.routes = [{ active: true, stops: ['stop'] }];
  game.zones = [{ x: 20, y: 20, kind: 'residential', progress: 3 }];
  Object.assign(tileAt(game, 20, 20), { zone: 'residential', variant: 0, building: { kind: 'house-cheap-1', footprint: 1, level: 1, populationCityId: 'city' } });
  tileAt(game, 20, 19).road = true;
  return game;
}
function grow(game, days = 80) {
  for (let n = 0; n < days; n++) { game.day++; game.cities[0].lastServiceDay = game.day; stepSettlements(game); }
}

test('ready neighborhood upgrades wait for a whole plot, then claim it once while keeping zone ownership', () => {
  const game = growthFixture(), zone = game.zones[0], original = { ...tileAt(game, 20, 20).building };
  tileAt(game, 21, 20).road = true;
  assert.ok(settlementSuitability(game, zone).negative.includes('Needs 2 × 2 clear tiles'));
  grow(game);
  assert.deepEqual(tileAt(game, 20, 20).building, original);
  assert.equal(game.cities[0].population, 200);
  tileAt(game, 21, 20).road = false;
  for (const p of [{x:21,y:20},{x:20,y:21},{x:21,y:21}]) {
    tileAt(game, p.x, p.y).zone = 'residential';
    game.zones.push({ ...p, kind: 'residential', progress: 0 });
  }
  grow(game);
  const upgraded = tileAt(game, 20, 20).building;
  assert.equal(upgraded.kind, 'house-expensive-1'); assert.equal(upgraded.footprint, 2);
  assert.equal(game.cities[0].population, 200 + housingCapacity(upgraded) - housingCapacity(original));
  assert.equal(tileAt(game, 20, 20).zone, 'residential');
  assert.deepEqual(game.zones, [zone]); assert.equal(zone.progress, 3);
  assert.equal(upgraded.populationCityId, 'city');
  for (const p of buildingTiles(buildingAt(game, 20, 20))) assert.equal(buildingAt(game, p.x, p.y).building, upgraded);
  assert.ok(!settlementSuitability(game, zone).negative.some(message => message.includes('clear tiles')));
});

test('larger zoned buildings never swallow a different zone or an existing paid building', () => {
  for (const blocker of ['commercial', 'building']) {
    const game = growthFixture(), child = tileAt(game, 21, 21);
    if (blocker === 'commercial') { child.zone = 'commercial'; game.zones.push({x:21,y:21,kind:'commercial',progress:0}); }
    else child.building = {kind:'pub',level:1,footprint:1,playerBuilt:true};
    const before = structuredClone(child);
    grow(game);
    assert.equal(tileAt(game, 20, 20).building.kind, 'house-cheap-1');
    assert.deepEqual(child, before);
    assert.ok(settlementSuitability(game, { x:20, y:20 }).negative.includes('Needs 2 × 2 clear tiles'));
  }
});

test('same-day neighboring proposals reserve all cells before a second plot can grow', () => {
  const game = growthFixture();
  tileAt(game, 20, 20).building = null;
  Object.assign(tileAt(game, 21, 20), { zone: 'residential', variant: 1 });
  game.zones.push({ x:21, y:20, kind:'residential', progress:3 });
  tileAt(game, 21, 19).road = true;
  game.day = Array.from({length:100},(_,n)=>n+1).find(day => [20,21].every(x => randomAt(game, day, `zone:${x},20`, 203) < .25));
  assert.ok(game.day, 'both ready plots receive an update on this day');
  game.cities[0].lastServiceDay = game.day;
  stepSettlements(game);
  const building = tileAt(game, 20, 20).building;
  assert.equal(building.footprint, 2);
  assert.equal(tileAt(game, 21, 20).building, null, 'the covered proposal cannot create a second anchor');
  assert.equal(game.zones.length, 1);
  assert.equal(game.cities[0].population, 200 + housingCapacity(building));
});
