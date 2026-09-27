// Synthetic worst-case network/fleet load, deliberately separate from the unit
// suite. The flattened all-road grid isolates scaling; it is not a playable map.
// node --expose-gc --max-old-space-size=2048 tests/dense-world-benchmark.mjs
// Optional: --model=/absolute/baseline/model.js --size=512 --fleet=1000 --frames=120 --mode=water
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const arg=(key,fallback)=>process.argv.find(value=>value.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const m=await import(arg('model',null)?pathToFileURL(arg('model')):new URL('../model.js',import.meta.url));
const size=Number(arg('size',2048)),fleet=Number(arg('fleet',10000)),frames=Number(arg('frames',120));
const mode=arg('mode','road');assert.ok(['road','rail','water'].includes(mode));
const game=m.createGame({size:`square${size}`,seed:1847});
for(const tile of game.tiles){tile.terrain=mode==='water'?'water':'grass';tile.elevation=mode==='water'?0:3/7;tile.road=mode==='road';tile.rail=mode==='rail';tile.bridge=false;tile.tunnel=false;delete tile.structureAxis;delete tile.structureLevel;}
game.networkRevision++;game.revision++;
const pathAt=performance.now(),path=m.findPath(game,{x:5,y:5},{x:size-6,y:size-6},mode),pathMs=performance.now()-pathAt;
assert.equal(path.length,(size-11)*2+1);
const points=[...game.cities,...game.industries];game.stations=[];game.routes=[];game.vehicles=[];
for(let n=0;n<Math.max(points.length,Math.min(fleet,1000));n++){
  const a=points[n%points.length],b={x:Math.min(size-2,a.x+6),y:a.y};
  const routePath=Array.from({length:b.x-a.x+1},(_,i)=>({x:a.x+i,y:a.y}));
  game.stations.push({id:`s${n}a`,name:`Origin ${n}`,x:a.x,y:a.y,mode},{id:`s${n}b`,name:`Destination ${n}`,...b,mode});
  game.routes.push({id:`r${n}`,name:`Dense ${n}`,mode,cargo:'passengers',stops:[`s${n}a`,`s${n}b`],path:routePath,pathRevision:game.networkRevision,active:true,revenue:0,expenses:0,delivered:0,status:'Running'});
}
for(let n=0;n<fleet;n++){
  const route=game.routes[n%game.routes.length],progress=(route.path.length-1)*(n%17)/17;
  game.vehicles.push({id:`v${n}`,routeId:route.id,x:route.path[0].x+progress,y:route.path[0].y,angle:0,capacity:32,level:0,load:0,progress,direction:1,totalDistance:0,dwellRemaining:0,tripSerial:0});
}
// Terrain upkeep has a separate dense-save/geometry benchmark; isolate traffic.
game.maintenanceRevision=game.networkRevision;game.infrastructureUpkeep=0;
const measurements=[];
for(let i=0;i<frames;i++){const at=performance.now();m.tick(game,1/60);measurements.push(performance.now()-at);}
assert.ok(game.vehicles.every(vehicle=>Number.isFinite(vehicle.progress)&&vehicle.load>=0&&vehicle.load<=vehicle.capacity));
measurements.sort((a,b)=>a-b);globalThis.gc?.();
console.log(JSON.stringify({size,mode,fleet,routes:game.routes.length,frames,pathMs,pathLength:path.length,day:game.day,totalMs:measurements.reduce((a,b)=>a+b,0),medianMs:measurements[Math.floor(frames/2)],p95Ms:measurements[Math.floor(frames*.95)],maxMs:measurements.at(-1),heapMiB:process.memoryUsage().heapUsed/1048576}));
