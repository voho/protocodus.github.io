import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NEW_WORLD_SIZES, WORLD_SIZES, DEFAULT_WORLD_SIZE, MAX_WORLD_TILES, WORLD_GENERATION_VERSION, generateWorld } from '../world.js';
import { createGame, findPath, validateGame, INDUSTRIES } from '../model.js';
import { stepEcology } from '../environment.js';

const recipes = {
  taiga: 'b274899b12b844f752c479e06c73ab5e15743565d5c3fbac9eca279f78194d82',
  tundra: 'a65ce2a006ac578d54c9cbeaa97ee4045dd7ad3e96e7ddbf9d54c60409381397',
  desert: '1868a17505177dde18593d02bc1e47a4f00f0bc0c5a3f9f7ef4405018dc85e45',
};
const unevenRecipes = {
  taiga: 'f0c5445f7a64a4e8c28879ad1881900d079f0e4c1790575372505aa9719e8a80',
  tundra: 'ecb7a1cdaa3a5f0bd3861f846ce89da63277d05d9d40bf5c001a31c89f5fbdca',
  desert: '19ff7580669eb1e1b44f921beeb9d238a1423e1afef5ff1bba749de335b167cc',
};

test('new-world choices are exactly 512², 1024², and 2048²; legacy dimensions remain loadable', () => {
  assert.deepEqual(Object.entries(NEW_WORLD_SIZES).map(([key, size]) => [key, size.width, size.height]), [
    ['square512', 512, 512], ['square1024', 1024, 1024], ['square2048', 2048, 2048],
  ]);
  assert.equal(DEFAULT_WORLD_SIZE, 'square512'); assert.equal(MAX_WORLD_TILES, 2048 ** 2);
  for (const [key, width, height] of [['regional',128,96],['large',256,192],['huge',512,384],['vast',768,576]]) {
    assert.deepEqual([WORLD_SIZES[key].width,WORLD_SIZES[key].height], [width,height]);
  }
  assert.throws(() => generateWorld('taiga',1847,'square512',999), /generation version/);
});

for (const biome of ['taiga','tundra','desert']) test(`${biome}: generation recipe 1 is frozen and the square starter world is playable`, () => {
  // Sparse saves regenerate this exact geography. An intentional geography
  // change must add a new generator version, retaining version 1 for old saves.
  const generated = generateWorld(biome,1847,'square512',1);
  const digest = createHash('sha256').update(JSON.stringify(generated)).digest('hex');
  assert.equal(digest, recipes[biome], 'do not silently change the procedural-save recipe');
  const game = createGame({biome,seed:1847});
  assert.equal(game.width,512); assert.equal(game.height,512); assert.equal(game.generationVersion,WORLD_GENERATION_VERSION);
  assert.equal(game.cities.length,48); assert.equal(game.routes[0].path.length,25);
  assert.equal(validateGame(game),true);
  const [from,to] = game.cities.slice(0,2).map(city=>({x:city.x,y:city.y+5}));
  assert.ok(findPath(game,from,to,'water')?.length>2,'the starter towns still share navigable port berths');
  for(const [kind,definition] of Object.entries(INDUSTRIES))if(definition.biomes.includes(biome)) {
    assert.equal(game.industries.filter(site=>site.kind===kind).length,8,`${kind} is available in all eight districts`);
  }
  game.generationVersion=999;
  assert.equal(validateGame(game),false,'an unknown generation recipe cannot be saved as a current world');
});

for (const biome of ['taiga','tundra','desert']) test(`${biome}: uneven recipe 2 has a stable save-file geography`, () => {
  const generated = generateWorld(biome,1847,'square512',2);
  assert.equal(createHash('sha256').update(JSON.stringify(generated)).digest('hex'),unevenRecipes[biome],
    'new terrain or placement changes require a new recipe so existing sparse saves remain intact');
});

test('1024² worlds retain distinct town names and sparse ecology work', () => {
  const game=createGame({biome:'taiga',seed:19281,size:'square1024'});
  assert.equal(game.tiles.length,1048576); assert.equal(game.cities.length,128);
  assert.equal(new Set(game.cities.map(city=>city.name)).size,128,'larger populations of towns do not repeat names');
  assert.equal(game.routes[0].path.length,25);
  const tiles=game.tiles;let reads=0;
  game.tiles=new Proxy(tiles,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
  const network=game.networkRevision;game.day=42;
  const changes=stepEcology(game);
  assert.ok(changes>0&&changes<=4096);
  assert.ok(reads<4096*12,`the daily ecology budget stays bounded (${reads} tile reads)`);
  assert.equal(game.networkRevision,network);
  game.tiles=tiles;
  assert.equal(validateGame(game),true);
});
