// Explicit large storage stress test; not part of *.test.mjs.
// node --expose-gc --max-old-space-size=2048 tests/dense-save-benchmark.mjs --roundtrip
// Synthetic dense network flags cover the landscape. This checks save volume
// and exact data preservation, not whether a natural slope can carry a road.
// One thousand long routes plus ten thousand moving vehicles share the budget.
import {createGame} from '../model.js';
import {encodeGame,decodeGame} from '../save-codec.js';
import assert from 'node:assert/strict';
const g=createGame({size:'square2048'});
for(const t of g.tiles)if(!t.building&&!t.zone){t.road=true;t.rail=true;if(t.terrain==='water')t.bridge=true;if(t.terrain==='mountain')t.tunnel=true;if(t.terrain==='forest'){t.terrain='grass';t.detail='';}delete t.terrainObject;}
const path=[];for(let x=5;x<2043;x++)path.push({x,y:5});for(let y=6;y<2043;y++)path.push({x:2042,y});
const template={...g.routes[0]},vehicle={...g.vehicles[0]};g.routes=Array.from({length:1000},(_,i)=>({...template,id:`route-${i}`,name:`Main line ${i}`,path}));g.vehicles=Array.from({length:10000},(_,i)=>({...vehicle,id:`vehicle-${i}`,routeId:g.routes[i%1000].id,progress:i*.385751531,totalDistance:3521.825824855+i,x:51.352442634+i%1800,y:531.456182474+i%512,angle:.4512948276,dwellRemaining:i%3?0:.352787222}));
const at=performance.now(),saved=encodeGame(g),json=JSON.stringify(saved),saveMs=performance.now()-at;globalThis.gc();
const result={size:g.width,routePoints:path.length*g.routes.length,routeCount:g.routes.length,vehicles:g.vehicles.length,saveMs,saveMiB:json.length*2/1048576,stateMiB:JSON.stringify(saved.state).length*2/1048576,vehiclesMiB:JSON.stringify(saved.state.vehicles).length*2/1048576,numericMiB:(saved.state.vehicleNumbers?.data.length||0)*2/1048576,routeMiB:JSON.stringify(saved.state.routes).length*2/1048576,heapMiB:process.memoryUsage().heapUsed/1048576};
assert.ok(result.saveMiB<5,'dense geometry + long routes + moving fleet fit the conservative localStorage budget');
if(process.argv.includes('--roundtrip')){const decodeAt=performance.now(),loaded=decodeGame(JSON.parse(json));assert.deepEqual(loaded.vehicles,g.vehicles);assert.deepEqual(loaded.routes,g.routes);for(let n=0;n<g.tiles.length;n++)assert.deepEqual(loaded.tiles[n],g.tiles[n]);result.decodeMs=performance.now()-decodeAt;}
console.log(JSON.stringify(result));
