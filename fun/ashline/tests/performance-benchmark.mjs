// node tests/performance-benchmark.mjs; optional ASHLINE_PROFILE=/tmp/sim.cpuprofile.
// ASHLINE_SIM_URL=file:///…/sim.js benchmarks another simulation. sim.js imports its sibling modules
// (ai.js, terrain.js, flocking.js, traffic.js, mission.js, campaign.js, abilities.js), so point it into a
// complete candidate checkout.
// Report timing, never assert machine-specific wall-clock thresholds.
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {Session} from 'node:inspector';
import {performanceScene,simulationDigest} from './performance-scenes.mjs';
const sim=await import(process.env.ASHLINE_SIM_URL||new URL('../sim.js',import.meta.url));
const count=Number(process.env.ASHLINE_UNITS||600),ticks=Number(process.env.ASHLINE_TICKS||80);
const names=(process.env.ASHLINE_SCENES||'march,obstructed,battle,harvesting').split(',');
const scenes=names.map(name=>({name,s:performanceScene(sim,name,count)}));
for(const {s} of scenes)for(let i=0;i<8;i++)sim.updateGame(s,.05);
let profiler;
const post=(method,args={})=>new Promise((resolve,reject)=>profiler.post(method,args,(err,result)=>err?reject(err):resolve(result)));
if(process.env.ASHLINE_PROFILE){profiler=new Session();profiler.connect();await post('Profiler.enable');await post('Profiler.start');}
const result=[];
for(const {name,s} of scenes){const times=[];
  for(let i=0;i<ticks;i++){const before=performance.now();sim.updateGame(s,.05);times.push(performance.now()-before);}
  times.sort((a,b)=>a-b);
  result.push({name,units:count,ticks,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),totalMs:times.reduce((a,b)=>a+b,0),
    digest:createHash('sha256').update(simulationDigest(s)).digest('hex'),remaining:s.entities.filter(e=>e.kind==='unit').length});
}
if(profiler){const {profile}=await post('Profiler.stop');await writeFile(process.env.ASHLINE_PROFILE,JSON.stringify(profile));profiler.disconnect();}
console.log(JSON.stringify(result,null,2));
