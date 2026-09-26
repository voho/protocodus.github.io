// Deliberately separate from *.test.mjs: each 4m-cell biome runs in its own
// sequential process, releasing its object grid before the next benchmark.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGame, tick, validateGame, findPath, INDUSTRIES, saveGame, SAVE_KEY } from '../model.js';

if (!process.argv.includes('--child')) {
  for(const biome of ['taiga','tundra','desert']) {
    const result=execFileSync(process.execPath,['--expose-gc','--max-old-space-size=2048',fileURLToPath(import.meta.url),'--child',biome],{encoding:'utf8',maxBuffer:1024*1024});
    process.stdout.write(result);
  }
} else {
  const biome=process.argv.at(-1),started=performance.now();
  const game=createGame({biome,seed:1847,size:'square2048'}),generated=performance.now();
  assert.equal(game.tiles.length,4194304); assert.equal(game.width,game.height);
  assert.equal(game.cities.length,320); assert.equal(new Set(game.cities.map(city=>city.name)).size,320);
  assert.equal(game.routes[0].path.length,25);
  for(const [kind,definition] of Object.entries(INDUSTRIES))if(definition.biomes.includes(biome))assert.equal(game.industries.filter(site=>site.kind===kind).length,48);
  for(const site of game.industries)if(INDUSTRIES[site.kind].coastal)assert.ok([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>game.tiles[(site.y+dy)*game.width+site.x+dx]?.terrain==='water'),'every fishery has a real water source');
  const [from,to]=game.cities.slice(0,2).map(city=>({x:city.x,y:city.y+5}));
  assert.ok(findPath(game,from,to,'water')?.length>2);
  assert.equal(validateGame(game),true);
  globalThis.gc?.();
  const memory=process.memoryUsage(),money=game.money,simulationAt=performance.now();
  tick(game,30);
  const simulationMs=performance.now()-simulationAt;
  assert.ok(game.totalDelivered>0);assert.ok(game.money>money);
  assert.equal(validateGame(game),true);
  const values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem(key,value){if((key.length+value.length)*2>5*1024**2)throw Error('Quota exceeded');values.set(key,value);}};
  const saveAt=performance.now(),saved=saveGame(game),saveMs=performance.now()-saveAt;
  assert.equal(saved.ok,true,saved.message);
  console.log(JSON.stringify({biome,size:game.size,tiles:game.tiles.length,towns:game.cities.length,industries:game.industries.length,generationMs:Math.round(generated-started),heapMiB:Math.round(memory.heapUsed/1024**2),rssMiB:Math.round(memory.rss/1024**2),simulation30DaysMs:Math.round(simulationMs),saveMs:Math.round(saveMs),saveKiB:Math.round(localStorage.getItem(SAVE_KEY).length*2/1024),delivered:game.totalDelivered}));
}
