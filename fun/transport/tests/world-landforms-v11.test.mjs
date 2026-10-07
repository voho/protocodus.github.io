import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateWorld, WORLD_GENERATION_VERSION} from '../world.js';
import {createGame, restoreGame, validateGame} from '../model.js';
import {encodeGame} from '../save-codec.js';
import {allocateTerrainObjects} from '../world-terrain-objects.js';
import {terrainObjectTiles, terrainObjectSiteProblem} from '../terrain-objects.js';
import {groundIsFlat} from '../terrain-geometry.js';
const sites=game=>game.tiles.flatMap((tile,index)=>tile.terrainObject?[{x:index%game.width,y:Math.floor(index/game.width),object:tile.terrainObject}]:[]);
const oldDigests={taiga:'4b3fbed3e59256b94455a5eaeb8dbf03a9893790e849f6fec7872fa3e14dad2d',tundra:'87c341d710ff32e03b291c8818bd612b05f536f30e063565986209e2da0b6426',desert:'078dcc193607c6d6a1e25e7dd86e07f84ee00dc92bf5c04afd2e661c1d589123'};
for(const biome of ['taiga','tundra','desert'])test(`${biome}: recipe 11 adds rare large landforms and preserves recipe 10 geography`,()=>{
  const previous=generateWorld(biome,1847,'square512',10);
  assert.equal(createHash('sha256').update(JSON.stringify(previous)).digest('hex'),oldDigests[biome]);
  const game=generateWorld(biome,1847,'square512',11),objects=sites(game),geology=objects.filter(s=>s.object.kind!=='forest'),counts={};
  assert.equal(WORLD_GENERATION_VERSION,11);assert.equal(game.generationVersion,11);
  assert.ok(geology.length>20);assert.ok(geology.length<sites(previous).filter(s=>s.object.kind!=='forest').length,'larger formations are less cluttered overall');
  for(const site of geology){
    const span=site.object.footprint;counts[span]=(counts[span]||0)+1;
    assert.ok(span>=3&&span<=6);assert.equal(groundIsFlat(game,site.x,site.y,span),true);
    assert.equal(terrainObjectSiteProblem(game,site.object.kind,site.x,site.y,span,{exclude:site}),null);
  }
  for(const span of [3,4,5,6])assert.ok(counts[span]>0,`${span}tile landforms present`);
  assert.ok(counts[3]>counts[4]&&counts[4]>counts[5]&&counts[5]>=counts[6],JSON.stringify(counts));
  assert.deepEqual(objects.filter(s=>s.object.kind==='forest'),sites(previous).filter(s=>s.object.kind==='forest'),'groves retain their old size and allocation');
  const before=sites(game);allocateTerrainObjects({...game,biome,seed:1847});assert.deepEqual(sites(game),before,'allocation is idempotent');
  assert.deepEqual(sites(generateWorld(biome,1847,'square512',11)),before,'placements are deterministic');
  for(const tile of game.tiles)delete tile.terrainObject;
  for(const tile of previous.tiles)delete tile.terrainObject;
  assert.deepEqual(game.tiles,previous.tiles,'landform allocation never edits heights, terrain, roads or occupied buildings');
});
test('continental landform density stays sparse, disjoint and size weighted',()=>{
  const game=generateWorld('tundra',1847,'square1024',11),geology=sites(game).filter(s=>s.object.kind!=='forest'),claimed=new Set(),counts={};
  for(const site of geology){counts[site.object.footprint]=(counts[site.object.footprint]||0)+1;for(const p of terrainObjectTiles(site)){const key=p.y*game.width+p.x;assert.equal(claimed.has(key),false);claimed.add(key);}}
  assert.ok(counts[3]>counts[4]&&counts[4]>counts[5]&&counts[5]>counts[6],JSON.stringify(counts));
  assert.ok(geology.some(s=>s.object.kind==='mountain'&&s.object.detail==='glacier'&&s.object.footprint>=4));
  assert.ok(claimed.size<game.tiles.length*.01,'large masses remain landmarks rather than a covering carpet');
});
test('recipe 11 procedural saves retain six tile anchors and exact original terrain',()=>{
  const game=createGame({biome:'tundra',seed:1847,size:'square512',townCount:2,industryDistricts:1});
  assert.equal(game.generationVersion,11);assert.equal(validateGame(game),true);
  assert.ok(sites(game).some(s=>s.object.footprint===6));
  const saved=encodeGame(game),loaded=restoreGame(JSON.parse(JSON.stringify(saved)));
  assert.ok(loaded);assert.equal(loaded.generationVersion,11);assert.equal(validateGame(loaded),true);assert.deepEqual(loaded.tiles,game.tiles);
});
