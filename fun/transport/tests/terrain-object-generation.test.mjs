import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../world.js';
import { allocateTerrainObjects } from '../world-terrain-objects.js';
import { terrainObjectTiles, terrainObjectSiteProblem, terrainObjectGroundIsFlat } from '../terrain-objects.js';
import { terrainElevation, terrainLevel } from '../terrain-elevation.js';
import { stepEcology } from '../environment.js';

const previousRecipes = {
  taiga: 'b60f1746549742b3439ad76af0d8b34e03b8445f4a37006ce719fe8faf1c23ff',
  tundra: 'f8d5a256aeec9345d908dbbaf6b10d4252c91dca3cc1ed6d7df2bded4e2c092c',
  desert: '031e481b4752cc3075630786ec5f5a4b3ae7e1617fd82e57961d5ab3c4d6c64b',
};
function sites(game) {
  return game.tiles.flatMap((tile, index) => tile.terrainObject ? [{x:index % game.width,y:Math.floor(index/game.width),object:tile.terrainObject}] : []);
}
for (const biome of ['taiga', 'tundra', 'desert']) test(`${biome}: recipe 6 places varied level terrain parcels without altering recipe 5 geography`, () => {
  const old = generateWorld(biome, 1847, 'square512', 5);
  assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'), previousRecipes[biome]);
  const game = generateWorld(biome, 1847, 'square512', 6), objects = sites(game), occupied = new Set(), counts = {}, largeArea = {};
  assert.ok(objects.length > 100);
  for (const site of objects) {
    const { x, y, object } = site, points = terrainObjectTiles(site), size = object.footprint;
    assert.equal(terrainObjectSiteProblem(game, object.kind, x, y, size, {exclude:site}), null);
    const heights = points.map(p => terrainElevation(game.tiles[p.y*game.width+p.x]));
    assert.equal(new Set(points.map(p => terrainLevel(game.tiles[p.y*game.width+p.x]))).size, 1);
    assert.ok(Math.max(...heights) - Math.min(...heights) <= .3 + 1e-9);
    const collar = [];
    for (let dy = -1; dy <= size; dy++) for (let dx = -1; dx <= size; dx++) collar.push(terrainElevation(game.tiles[(y+dy)*game.width+x+dx]));
    assert.ok(Math.max(...collar) - Math.min(...collar) <= .6 + 1e-9);
    counts[`${object.kind}:${size}`] = (counts[`${object.kind}:${size}`] || 0) + 1;
    largeArea[object.kind] = (largeArea[object.kind] || 0) + points.length;
    for (const p of points) {
      const index = p.y*game.width+p.x;
      assert.ok(!occupied.has(index), 'large terrain parcels never overlap'); occupied.add(index);
    }
  }
  for (const kind of ['forest','rock','mountain']) {
    assert.ok(counts[`${kind}:2`] > 0 && counts[`${kind}:3`] > 0, `${kind} includes both sizes`);
    assert.ok(largeArea[kind] < old.tiles.filter(t => t.terrain === kind).length * .35, 'most nature remains small');
  }
  assert.equal(new Set(objects.map(site => `${site.x%3},${site.y%3}`)).size, 9, 'anchors do not follow a repeating grid');
  const repeat = generateWorld(biome, 1847, 'square512', 6);
  assert.deepEqual(sites(repeat), objects, 'placements reproduce from the seed');
  allocateTerrainObjects({...repeat,biome,seed:1847});
  assert.deepEqual(sites(repeat), objects, 'reapplying allocation does not add or overlap parcels');
  for (const tile of game.tiles) delete tile.terrainObject;
  assert.deepEqual(game.tiles, old.tiles, 'placement changes no elevations, vegetation, roads or buildings');
});

function flatForest(seed = 1847) {
  return {seed,biome:'taiga',width:64,height:48,day:0,revision:0,cities:[],industries:[],stations:[],zones:[],routes:[],
    tiles:Array.from({length:64*48},(_,n)=>({terrain:'forest',detail:'pine',elevation:.25,variant:n%7,building:null,road:false,rail:false,zone:null}))};
}

test('terrain-object eligibility respects continuous slopes, rounded levels and the surrounding collar', () => {
  const game = flatForest(), at = (x,y)=>game.tiles[y*game.width+x];
  assert.equal(terrainObjectGroundIsFlat(game,20,20,3),true);
  at(22,22).elevation = 4.31/16;
  assert.equal(terrainObjectGroundIsFlat(game,20,20,3),false,'continuous footprint span cannot exceed .3 levels');
  at(22,22).elevation = .25; at(19,19).elevation = 4.61/16;
  assert.equal(terrainObjectGroundIsFlat(game,20,20,3),false,'the complete collar must stay within .6 levels');
  at(19,19).elevation = .25; at(22,22).elevation = 4.51/16;
  assert.equal(terrainObjectGroundIsFlat(game,20,20,3),false,'different rounded levels cannot share a sprite');
  at(22,22).elevation = .25; at(19,19).terrain = 'water';
  assert.equal(terrainObjectGroundIsFlat(game,20,20,3),false,'a shoreline rim is not a level ground platform');
});

test('allocation stays reproducible but seed-sensitive and excludes every structure footprint', () => {
  const game = flatForest();
  game.tiles[20*game.width+20].building = {kind:'stadium',footprint:3};
  game.industries.push({x:30,y:20,footprint:3,kind:'steel-mill'});
  game.cities.push({x:40,y:20});game.stations.push({x:42,y:20});
  game.zones.push({x:44,y:20,kind:'residential'});game.tiles[20*game.width+44].zone='residential';
  for (let x = 8; x < 55; x++) game.tiles[23*game.width+x].road = true;
  const before = structuredClone(game);
  allocateTerrainObjects(game);
  for (const site of sites(game)) assert.equal(terrainObjectSiteProblem(game,site.object.kind,site.x,site.y,site.object.footprint,{exclude:site}),null);
  const different = structuredClone(before);different.seed++;
  allocateTerrainObjects(different);
  assert.notDeepEqual(sites(game),sites(different));
});

test('ecology dissolves changing groves and keeps exactly the same succession as small tiles', () => {
  const game = flatForest();allocateTerrainObjects(game);
  const initial = sites(game).length, small = structuredClone(game);
  for(const tile of small.tiles)delete tile.terrainObject;
  let changes=0;
  for(let day=1;day<=120;day++) {
    game.day=small.day=day; changes+=stepEcology(game);stepEcology(small);
    for(const site of sites(game))for(const p of terrainObjectTiles(site))assert.equal(game.tiles[p.y*game.width+p.x].terrain,site.object.kind);
  }
  assert.ok(changes>0);assert.ok(sites(game).length<initial,'succession releases shared grove sprites');
  for(const tile of game.tiles)delete tile.terrainObject;
  assert.deepEqual(game.tiles,small.tiles,'object grouping does not alter seeded natural processes');
});
