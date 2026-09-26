import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, WORLD_SIZES } from '../world.js';
import { BIOME_NATURE, isPlantDetail, normalizedDetail } from '../terrain-sprites.js';
import { stepEcology, localEnvironment } from '../environment.js';
import { encodeGame, decodeGame } from '../save-codec.js';

for(const [biome,nature] of Object.entries(BIOME_NATURE)){
  test(`${biome} has a complete, deterministic nature repertoire in legacy and starter square worlds`,()=>{
    for(const size of Object.keys(WORLD_SIZES).filter(size => WORLD_SIZES[size].width <= 768)){
      const game=generateWorld(biome,1847,size),repeat=generateWorld(biome,1847,size);
      assert.deepEqual(game.tiles,repeat.tiles);
      const treeDetails=new Set(game.tiles.filter(tile=>tile.terrain==='forest').map(tile=>tile.detail));
      const mountains=new Set(game.tiles.filter(tile=>tile.terrain==='mountain').map(tile=>tile.detail));
      const groundDetails=new Set(game.tiles.filter(tile=>!['forest','mountain','water'].includes(tile.terrain)).map(tile=>tile.detail));
      for(const kind of nature.trees)assert.ok(treeDetails.has(kind),`${size} contains ${kind} trees`);
      for(const kind of nature.mountains)assert.ok(mountains.has(kind),`${size} contains ${kind} mountains`);
      for(const kind of nature.plants)assert.ok(groundDetails.has(kind),`${size} contains ${kind} plants`);
      for(const kind of mountains)assert.ok(nature.mountains.includes(kind),`${kind} belongs to ${biome}`);
      assert.ok(game.tiles.some(tile=>tile.detail==='river'),'variety preserves navigable rivers');
      assert.ok(game.tiles.some(tile=>['grass','sand','snow'].includes(tile.terrain)&&!tile.detail),'some countryside remains undecorated');
      assert.deepEqual(decodeGame(encodeGame(game)).tiles,game.tiles,'every added detail survives the existing compact palette');
    }
  });

  test(`${biome} ecology introduces suitable plants while preserving occupied terrain and waterways`,()=>{
    const width=48,height=40,land=biome==='desert'?'sand':biome==='tundra'?'snow':'grass';
    const game={width,height,seed:7193,biome,day:0,revision:0,networkRevision:7,cities:[],stations:[],routes:[],industries:[],zones:[],tiles:[]};
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const terrain=x>=10&&x<=13?'water':x>=15&&x<21&&y>7&&y<31?'forest':x===35?'rock':x===36?'mountain':land;
      game.tiles.push({terrain,detail:terrain==='water'?'river':terrain==='forest'?(biome==='desert'?'broadleaf':'pine'):terrain==='mountain'?nature.mountains[0]:'',elevation:terrain==='water'?0:.2,variant:0,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null});
    }
    const protectedTiles=new Map();
    for(const [index,tile] of game.tiles.entries())if(['water','rock','mountain'].includes(tile.terrain))protectedTiles.set(index,structuredClone(tile));
    for(const [x,flags]of [[4,{road:true}],[5,{rail:true}],[6,{building:{kind:'school',level:1}}],[7,{zone:'residential'}],[8,{publicRoad:true}]]){
      const index=20*width+x;Object.assign(game.tiles[index],flags,{detail:nature.plants[0]});protectedTiles.set(index,structuredClone(game.tiles[index]));
    }
    const repeat=structuredClone(game),newPlants=new Set(),newTrees=new Set();
    for(let day=1;day<=360;day++){
      game.day=repeat.day=day;
      const previous=game.tiles.map(tile=>({terrain:tile.terrain,detail:tile.detail}));
      const changes=stepEcology(game);assert.equal(stepEcology(repeat),changes);
      assert.ok(changes<=Math.ceil(game.tiles.length/128),'nature remains a bounded, slow cellular process');
      for(const [index,tile]of game.tiles.entries()){
        if(tile.detail!==previous[index].detail&&nature.plants.includes(tile.detail))newPlants.add(tile.detail);
        if(previous[index].terrain!=='forest'&&tile.terrain==='forest'){newTrees.add(tile.detail);assert.ok(nature.trees.includes(tile.detail),'new forest inherits a species suited to its biome');}
      }
    }
    assert.ok(newPlants.size>=3,`ecology introduced ${[...newPlants].join(', ')}`);
    assert.ok(newTrees.size>0,'healthy forest spreads into suitable neighboring land');
    assert.deepEqual(game,repeat,'new plant succession remains deterministic');
    assert.equal(game.networkRevision,7,'visual succession does not invalidate transport networks');
    for(const [index,tile]of protectedTiles)assert.deepEqual(game.tiles[index],tile,'nature never modifies infrastructure, water, rocks or mountains');
  });
}

test('all ground vegetation shares Layers classification and contributes to local nature',()=>{
  for(const [biome,nature]of Object.entries(BIOME_NATURE))for(const detail of nature.plants){
    assert.equal(isPlantDetail(detail),true,`${detail} is hidden by Trees & plants`);
    const game={width:5,height:5,seed:1847,biome,day:0,revision:0,industries:[],cities:[],zones:[],stations:[],routes:[],tiles:Array.from({length:25},()=>({terrain:'grass',detail,elevation:.2,road:false,rail:false,building:null}))};
    assert.ok(localEnvironment(game,2,2,2).nature>.65,`${detail} contributes to environmental quality`);
  }
  for(const detail of ['river','glacier','mesa','granite-ridge','saltflat','ice'])assert.equal(isPlantDetail(detail),false,`${detail} is not vegetation`);
  for(const alias of ['meadow','flowers','heath','wetland','shore'])assert.equal(isPlantDetail(alias),true,`${alias} remains a supported plant alias`);
  assert.equal(normalizedDetail('lichen'),'lichen','lichen now has its own ground-cover artwork');
});
