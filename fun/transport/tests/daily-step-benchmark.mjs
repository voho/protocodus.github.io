// Day-boundary cost on a real generated world, deliberately separate from the
// unit suite. With --model, an immutable baseline copy ticks the same world in
// the same process, alternating which side goes first, and must reach an
// identical state (SHA-1 of every field and tile).
// node --max-old-space-size=6144 tests/daily-step-benchmark.mjs --model=/absolute/baseline/model.js
// Optional: --size=512 --days=150 --seed=1847 --biome=taiga --warm=10
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const arg=(key,fallback)=>process.argv.find(value=>value.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const size=Number(arg('size',512)),days=Number(arg('days',150)),seed=Number(arg('seed',1847)),biome=arg('biome','taiga'),warm=Number(arg('warm',10));
const sides=[...(arg('model',null)?[{label:'baseline',m:await import(pathToFileURL(arg('model')))}]:[]),{label:'current',m:await import(new URL('../model.js',import.meta.url))}];
for(const side of sides){side.game=side.m.createGame({size:`square${size}`,seed,biome});side.times=[];}
for(let day=0;day<days;day++)for(const side of day%2?sides.slice().reverse():sides){const at=performance.now();side.m.tick(side.game,1);if(day>=warm)side.times.push(performance.now()-at);}
const digest=game=>{const sha=createHash('sha1'),{tiles,...rest}=game;sha.update(JSON.stringify(rest));for(let i=0;i<tiles.length;i+=4096)sha.update(JSON.stringify(tiles.slice(i,i+4096)));return sha.digest('hex');};
const report=Object.fromEntries(sides.map(({label,game,times})=>{const sorted=times.slice().sort((a,b)=>a-b),at=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];return [label,{digest:digest(game),day:game.day,medianMs:at(.5),p95Ms:at(.95),maxMs:sorted.at(-1)}];}));
if(report.baseline)assert.equal(report.current.digest,report.baseline.digest,'the daily step reaches an identical state');
console.log(JSON.stringify({size,biome,seed,days,...report,...(report.baseline&&{medianSpeedup:report.baseline.medianMs/report.current.medianMs})}));
