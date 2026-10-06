// Allocation-sensitive production cache-hit paths; these are CPU timings only,
// not Canvas/GPU throughput. Run the same command before and after changes.
import { performance } from 'node:perf_hooks';
import { createSpriteCache } from '../sprite-cache.js';
const imageRequests=[];
globalThis.Image=class {
  set src(url){this.url=url;const cell=Number(url.match(/-(\d+)\.png$/)?.[1]||256);this.naturalWidth=this.naturalHeight=3*cell;imageRequests.push(this);}
  decode(){return Promise.resolve();}
};
globalThis.document={};
const houses=await import('../raster-houses.js');
const ready=houses.preloadHouses({biome:'taiga',cells:[32],waitMs:1000});
for(const image of imageRequests)image.onload();
await ready;
const count=500000,rounds=7,rows=[];
function measure(name,call){
  let checksum=0;
  for(let n=0;n<50000;n++)checksum+=Boolean(call(n));
  const samples=[];
  for(let round=0;round<rounds;round++){
    const start=performance.now();
    for(let n=0;n<count;n++)checksum+=Boolean(call(n));
    samples.push((performance.now()-start)*1e6/count);
  }
  samples.sort((a,b)=>a-b);rows.push({name,medianNanoseconds:samples[Math.floor(rounds/2)],samples,checksum});
}
const cache=createSpriteCache(),keys=Array.from({length:8},(_,n)=>`sprite:${n}`);
for(const key of keys)cache.set(key,{width:32,height:40});
measure('repeated-most-recent-canvas',()=>cache.get(keys.at(-1)));
measure('groups-of-64-same-canvas',n=>cache.get(keys[Math.floor(n/64)%keys.length]));
measure('alternating-eight-canvases',n=>cache.get(keys[n%keys.length]));
measure('requested-house-orientation',n=>houses.hasRasterHouse('house-cheap-1','taiga',n%2));
measure('fallback-house-climate',n=>houses.hasRasterHouse('house-cheap-1','desert',n%2));
console.log(JSON.stringify({count,rounds,rows},null,2));
