import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../world.js';
import { BUILDINGS, createGame, INDUSTRIES, validateGame } from '../model.js';
import { buildingFootprint } from '../building-sites.js';
import { INDUSTRY_SPACING, relatedIndustries } from '../industry-sites.js';
import { groundIsFlat } from '../terrain-geometry.js';

// Sparse saves regenerate their geography from the seed, so a recipe never changes once players have it:
// recipe 7 is frozen now that recipe 8 replaced it, and recipe 8 is pinned against accidental changes.
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const frozen = {
  7: {
    taiga: 'bf32ef9d930d404650e71ec61230ef5366b44e0d953a20438b10a9a5d2a49e5a',
    tundra: 'b0d80566e19de0d4aea7b4d34a68c025c4b73ca739649a887a95d06dc5e3d17f',
    desert: 'afe77cf7259375f0c778f83afd756347a10e230cd97baf47b68ce45bc666c546',
  },
  8: {
    taiga: 'fcf270bbb33f9fb5b61823dfc1ba3c1c9435d490f00b5f7f5fe0d2e38db6a015',
    tundra: '10903e8b91aab521c9318b76852a3580498b44875428d8251a9b3557a7569407',
    desert: '377ae29a4e959d708d64105f7a03a14ffab840e9544d5e5f9aaf3e8c6b7ea35d',
  },
};

for (const biome of ['taiga', 'tundra', 'desert']) {
  test(`${biome}: recipes 7 and 8 regenerate byte-exact worlds`, () => {
    for (const version of [7, 8]) assert.equal(digest(generateWorld(biome, 1847, 'square512', version)), frozen[version][biome], `recipe ${version} must not change; add a new recipe instead`);
  });

  test(`${biome}: recipe 8 towns stand on level ground in a settlement hierarchy`, () => {
    const game = createGame({ biome, seed: 1847, size: 'square512', generationVersion: 8 }), { width, tiles, cities } = game;
    assert.equal(validateGame(game), true);
    for (const city of cities) assert.equal(tiles[city.y * width + city.x].road, true, `${city.name} has a street at its centre for its first stop`);
    const nearest = (x, y) => cities.reduce((best, city) => { const d = Math.max(Math.abs(city.x - x), Math.abs(city.y - y)); return d < best.d ? { city, d } : best; }, { city: null, d: Infinity });
    let buildings = 0, plinths = 0;
    const hospitals = [], kinds = new Set();
    for (let i = 0; i < tiles.length; i++) {
      const building = tiles[i].building, x = i % width, y = Math.floor(i / width);
      if (!building) continue;
      buildings++;
      if (!groundIsFlat(game, x, y, building.footprint || 1)) plinths++;
      const home = nearest(x, y), far = buildingFootprint(building.kind) - 1;
      assert.ok(Math.max(Math.abs(home.city.x - x), Math.abs(home.city.y - y), x + far - home.city.x, y + far - home.city.y) <= 10, `a ${building.kind} at ${x},${y} lies within its town's ten-tile reach`);
      if (building.kind === 'hospital') hospitals.push(home.city);
      kinds.add(building.kind);
    }
    // Recipe 7 stood about one building in eleven on a stone plinth.
    assert.ok(plinths / buildings < .015, `${plinths} of ${buildings} buildings need a plinth`);
    // About a tenth of the towns are cities and a third hamlets; only a city has a hospital.
    const large = cities.filter(city => city.population >= 1500);
    assert.equal(large.length, 5);
    assert.equal(cities.filter(city => city.population < 450).length, 14);
    assert.deepEqual(hospitals.map(city => city.id).sort(), large.map(city => city.id).sort());
    // Parks, play and sport, the town hall and the newer shops join every older design.
    assert.deepEqual([...kinds].sort(), Object.keys(BUILDINGS).filter(kind=>!BUILDINGS[kind].buildOnly).sort(), 'every building design stands somewhere');
  });

  test(`${biome}: recipe 8 rivers all reach the sea`, () => {
    const { width, height, tiles } = generateWorld(biome, 1847, 'square512', 8), size = width * height;
    const linked = new Uint8Array(size), queue = [];
    for (let i = 0; i < size; i++) {
      const x = i % width, y = Math.floor(i / width);
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && tiles[i].terrain === 'water') { linked[i] = 1; queue.push(i); }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) if (j >= 0 && j < size && !linked[j] && tiles[j].terrain === 'water') { linked[j] = 1; queue.push(j); }
    }
    const rivers = tiles.flatMap((tile, i) => tile.detail === 'river' ? [i] : []);
    assert.ok(rivers.length > 1000);
    assert.equal(rivers.filter(i => !linked[i]).length, 0, 'every river tile is on the waterway ships follow to open water');
  });
}

test('recipe 8 desert greenery grows by water', () => {
  const { width, tiles } = generateWorld('desert', 1847, 'square512', 8);
  const watered = (x, y) => { for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) if (tiles[(y + dy) * width + x + dx]?.terrain === 'water') return true; return false; };
  const green = tiles.flatMap((tile, i) => tile.terrain === 'grass' || tile.terrain === 'forest' ? [i] : []);
  assert.ok(green.length > 1000);
  assert.ok(green.filter(i => watered(i % width, Math.floor(i / width))).length / green.length > .9, 'nine in ten green tiles lie within ten tiles of water');
});

test('recipe 8 industries take 3 × 3 sites, and related ones keep the spacing', () => {
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const { industries } = generateWorld(biome, 1847, 'square512', 8);
    assert.ok(industries.every(site => site.footprint === 3), biome);
    for (const [i, a] of industries.entries()) for (const b of industries.slice(i + 1)) {
      if (relatedIndustries(a.kind, b.kind)) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= INDUSTRY_SPACING, `${biome}: ${a.kind} at ${a.x},${a.y} and ${b.kind} at ${b.x},${b.y}`);
    }
  }
});

test('recipe 8 honours the town and district counts', () => {
  const game = createGame({ biome: 'taiga', seed: 1847, size: 'square512', generationVersion: 8, townCount: 20, industryDistricts: 3 });
  assert.equal(validateGame(game), true);
  assert.equal(game.cities.length, 20);
  for (const [kind, definition] of Object.entries(INDUSTRIES)) if (!definition.buildOnly && definition.biomes.includes('taiga')) assert.equal(game.industries.filter(site => site.kind === kind).length, 3, kind);
});
