import assert from 'node:assert/strict';
import {createGame,MAP_SIZES,MAP_PROFILES,mapLayout} from '../sim.js';

// Generated relief must stay one connected sector with pinned coverage and mirrored base surroundings.
// The default rift is sampled densely; every other profile, including the curved-lane sectors, on fewer seeds.
// The broad basin plains and the open impact steppe keep less raised ground than the walled profiles.
const blockedRange={basin:[.11,.33],steppe:[.09,.3]};
const cases=[];
for(const size of [{width:72,height:56},...Object.values(MAP_SIZES)])for(let seed=0;seed<24;seed++)cases.push({size,seed,profile:'rift'});
for(const profile of Object.keys(MAP_PROFILES).filter(profile=>profile!=='rift'))for(const size of Object.values(MAP_SIZES))for(let seed=0;seed<5;seed++)cases.push({size,seed,profile});
for(const {size,seed,profile} of cases){
  const s=createGame(`relief-${seed}`,'normal',{...size,profile}),{width:W,height:H}=s,N=W*H,{start,end}=mapLayout(s),[low,high]=blockedRange[profile]??[W===72?.09:.13,.33];
  const scout=s.entities.find(e=>e.type==='scout'),main=s.regions[Math.floor(scout.y)*W+Math.floor(scout.x)],sizes=new Map();
  let open=0,blocked=0,basalt=0,coherent=0;
  for(let i=0;i<N;i++){
    if(s.blocked[i])blocked++;else{open++;sizes.set(s.regions[i],(sizes.get(s.regions[i])||0)+1);}
    if(s.terrain[i]===2){basalt++;const x=i%W,y=Math.floor(i/W);if([[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>s.terrain[(y+dy)*W+x+dx]===2).length>=2)coherent++;}
  }
  const label=`${profile} ${W}x${H} relief-${seed}`;
  assert(sizes.get(main)/open>.97,`${label}: the main region holds nearly all open ground`);
  assert([...sizes.entries()].every(([r,n])=>r===main||n<30),`${label}: no sealed pocket of 30+ tiles survives the breach pass`);
  assert(blocked/N>low&&blocked/N<high,`${label}: relief stays substantial while leaving room for routes and expansions (${(blocked/N).toFixed(3)})`);
  if(W>72){
    assert(coherent/basalt>.8,`${label}: basalt forms basins, not confetti`);
    const near=p=>{let b=0,n=0;for(let i=0;i<N;i++){const d=Math.hypot(i%W-p.x,Math.floor(i/W)-p.y);if(d>11&&d<25){n++;if(s.blocked[i])b++;}}return b/n;};
    assert(Math.abs(near(start)-near(end))<.12,`${label}: both bases face similar relief`);
  }
}
// Units never deploy into a sealed pocket beside their producer.
{
  const s=createGame('spawn-pocket');s.ai.nextThink=Infinity;s.teams[0].credits=1e6;
  const {placeBuilding,trainUnit,updateGame}=await import('../sim.js');
  const core=s.entities.find(e=>e.team===0&&e.type==='core'),W=s.width;
  s.terrain.fill(0);s.minerals.fill(0);
  // A two-tile hole east of the barracks door, walled in by rock, sits nearest to the bay.
  const bx=core.x+4,by=core.y;
  for(const [x,y] of [[bx+3,by-1],[bx+3,by],[bx+3,by+1],[bx+3,by+2],[bx+2,by-1],[bx+2,by+2]])s.terrain[y*W+x]=1;
  s.navVersion++;
  assert(placeBuilding(s,0,'barracks',bx,by).ok,'barracks placement');
  for(let i=0;i<200;i++)updateGame(s,.1);
  // Two full queues of six; every recruit must find open ground west of the wall.
  for(let batch=0;batch<2;batch++){for(let i=0;i<6;i++)assert(trainUnit(s,0,'rifle').ok);for(let i=0;i<450;i++)updateGame(s,.1);}
  assert.equal(s.regionSize[s.regions[by*W+bx+2]],2,'The fixture really contains a sealed two-tile pocket');
  for(const u of s.entities)if(u.team===0&&u.kind==='unit')assert(s.regionSize[s.regions[Math.floor(u.y)*W+Math.floor(u.x)]]>=40,'Every deployed unit stands in open ground');
  assert.equal(s.entities.filter(e=>e.team===0&&e.type==='rifle').length,15,'All twelve recruits deploy');
}
console.log(`Relief checks passed on ${cases.length} maps across ${Object.keys(MAP_PROFILES).length} profiles: connected sectors, no sealed pockets, pinned coverage, coherent basalt, mirrored base surroundings, pocket-safe deployment.`);
