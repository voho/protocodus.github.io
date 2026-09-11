import assert from 'node:assert/strict';
import {createGame,updateGame,canPlace,placeBuilding,getEntity,buildingRole,unitRole,raceBuilding,unitCapacity} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const own=(s,role)=>s.entities.filter(e=>e.hp>0&&e.team===1&&(e.kind==='building'?buildingRole(e):unitRole(e))===role);
const snapshot=s=>JSON.parse(encodeGame(s)).game;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function build(s,role){
  const type=raceBuilding(s,1,role),core=own(s,'core')[0];
  for(let y=core.y-8;y<core.y+10;y++)for(let x=core.x-8;x<core.x+12;x++)if(canPlace(s,1,type,x,y).ok){const b=getEntity(s,placeBuilding(s,1,type,x,y).id);b.progress=1;b.hp=b.maxHp;return b;}
  throw Error(`No AI fixture site for ${type}`);
}

for(const race of ['organics','aiUnity']){
  const s=createGame(`autonomous-outpost-${race}`,'hard',{width:144,height:112,races:['organics',race],aiTeams:[1]});
  s.entities=s.entities.filter(e=>e.kind==='building');s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
  s.visible.forEach(g=>g.fill(1));s.explored.forEach(g=>g.fill(1));s.teams[1].credits=12000;
  build(s,'barracks');build(s,'factory');build(s,'reactor');
  const initial=own(s,'core')[0],ore={x:79.5,y:65.5};
  for(let y=64;y<=67;y++)for(let x=78;x<=81;x++){const cell=y*s.width+x;s.minerals[cell]=5000;s.mineralTypes[cell]=3;}
  s.time=120;s.ai.nextThink=120;s.ai.nextRaid=1e9;s.ai.nextExpand=120;s.fogClock=.2;
  updateGame(s,.05);
  assert(s.ai.miningSites?.some(site=>distance(site,ore)<5),'The commander remembers the observed remote mineral field');
  assert(s.ai.expansion,'A developed commander plans a remote nexus from its existing base');
  assert(s.entities.some(e=>e.team===1&&e.queue?.some(q=>unitRole(q)==='constructor')),'AI pays for an expansion vehicle at its own foundry');
  const restored=decodeGame(encodeGame(s)).game;
  let nexus=null,refinery=null,delivered=false;
  for(let tick=0;tick<7200&&!delivered;tick++){
    updateGame(s,.05);updateGame(restored,.05);
    nexus=own(s,'core').find(e=>e!==initial&&e.progress===1&&distance(e,initial)>20);
    if(nexus)refinery=own(s,'refinery').find(e=>e.progress===1&&distance(e,nexus)<15);
    if(refinery&&refinery.processingTotal>0)delivered=true;
    if(tick%200===0)assert.deepEqual(snapshot(restored),snapshot(s),'Expansion planning, vehicle travel, new structures and mining resume identically');
  }
  assert(nexus,'AI completes a nexus beyond the original construction area');
  assert(refinery,'AI follows the nexus with an operating remote refinery');
  assert(own(s,'harvester').some(e=>distance(e,refinery)<15),'AI operates haulers at its new mining base');
  assert(delivered,'The remote refinery receives real minerals, rather than only existing as a new structure');
  assert(unitCapacity(s,1)>=400,'AI expansion increases the same nexus-based army capacity');
  assert.deepEqual(snapshot(restored),snapshot(s),'The completed outpost and its first delivery preserve deterministic continuation');
}

console.log('AI nexus checks passed: both races remember observed ore, pay for constructors, establish distant nexuses/refineries, deliver mined shards and resume expansion exactly after saving.');
