import assert from 'node:assert/strict';
import {UNITS,createGame,mapLayout,canPlace,placeBuilding,issueOrder,updateGame} from '../sim.js';

function pools(s){
  const seen=new Uint8Array(s.terrain.length),groups=[];
  for(let start=0;start<s.terrain.length;start++){
    if(seen[start]||s.terrain[start]!==3)continue;
    const group=[start];seen[start]=1;
    for(let head=0;head<group.length;head++){
      const at=group[head],x=at%s.width,y=Math.floor(at/s.width);
      for(const next of [x>0?at-1:-1,x<s.width-1?at+1:-1,y>0?at-s.width:-1,y<s.height-1?at+s.width:-1])if(next>=0&&!seen[next]&&s.terrain[next]===3){seen[next]=1;group.push(next);}
    }
    groups.push(group);
  }
  return groups;
}

// Distribution intentionally changes topology/resources; its separate draws still preserve gameplay RNG.
const legacyRng={
  'ASH-001':3624334427,
  smoke:1570679058,
  'player-victory':721227172,
};
for(const [seed,expected] of Object.entries(legacyRng)){
  const s=createGame(seed,'normal',{width:72,height:56});
  assert.equal(s.rng,expected,`${seed}: terrain distribution keeps its draws separate from gameplay RNG`);
}

const layouts=new Set();
for(let seed=0;seed<48;seed++){
  const s=createGame(`lava-${seed}`),again=createGame(`lava-${seed}`),groups=pools(s),area=s.width*s.height/(72*56),{start,end}=mapLayout(s);
  assert.deepEqual(s.terrain,again.terrain,'The same seed reproduces each pool');
  assert.equal(s.rng,again.rng);assert(groups.length>=5*area&&groups.length<=7*area,'Pool count grows with map area');
  assert(groups.every(g=>g.length>=6&&g.length<=65),'Pools are substantial connected formations, without isolated lava specks');
  layouts.add(groups.map(g=>g.join(',')).join(';'));
  for(const at of groups.flat()){
    const x=at%s.width,y=Math.floor(at/s.width);
    assert(x>=3&&x<s.width-3&&y>=3&&y<s.height-3,'Pools stay inside the map');
    assert(Math.hypot(x-start.x,y-start.y)>11&&Math.hypot(x-end.x,y-end.y)>11,'Starting base clearings remain safe');
    assert.equal(s.minerals[at],0);assert.equal(s.blocked[at],1,'Lava is a static navigation obstacle');
  }
  for(const e of s.entities){
    const size=e.kind==='building'?e.size:1;
    for(let y=Math.floor(e.y);y<Math.floor(e.y)+size;y++)for(let x=Math.floor(e.x);x<Math.floor(e.x)+size;x++)assert.notEqual(s.terrain[y*s.width+x],3,'Starting entities never overlap lava');
  }
  const scouts=s.entities.filter(e=>e.type==='scout'),regions=scouts.map(u=>s.regions[Math.floor(u.y)*s.width+Math.floor(u.x)]);
  assert(regions[0]>0&&regions[0]===regions[1],'Both starting armies retain a traversable route');
}
assert.equal(layouts.size,48,'Different seeds vary pool locations and shapes');

// A previously legal, covered construction footprint becomes invalid without charging credits.
{
  const s=createGame('lava-placement'),core=s.entities.find(e=>e.team===0&&e.type==='core');let site;
  for(let y=core.y-11;y<core.y+12&&!site;y++)for(let x=core.x-8;x<core.x+20&&!site;x++)if(canPlace(s,0,'reactor',x,y).ok)site={x,y};
  assert(site);const at=site.y*s.width+site.x,before=s.teams[0].credits;
  s.terrain[at]=3;s.navVersion++;
  assert.deepEqual(canPlace(s,0,'reactor',site.x,site.y),{ok:false,reason:'Lava prevents construction'});
  assert.equal(placeBuilding(s,0,'reactor',site.x,site.y).ok,false);assert.equal(s.teams[0].credits,before);
  s.visible[0][at]=0;assert.equal(canPlace(s,0,'reactor',site.x,site.y).reason,'Requires sensor coverage','Hidden lava is not disclosed through placement errors');
}

// Every class routes around a pool, including while its friendly jam-passing window is active.
for(const type of Object.keys(UNITS))for(const passing of [false,true]){
  const s=createGame(`lava-route-${type}`);s.ai.nextThink=Infinity;s.fogClock=Infinity;
  const u=structuredClone(s.entities.find(e=>e.type===(type==='harvester'?'harvester':'rifle'))),d=UNITS[type];
  Object.assign(u,{type,team:passing?1:0,x:26.5,y:28.5,size:d.size,hp:d.hp,maxHp:d.hp,path:[]});
  s.entities=[u];s.terrain.fill(0);s.minerals.fill(0);s.visible.forEach(v=>v.fill(0));s.navVersion++;
  for(let y=25;y<=31;y++)for(let x=28;x<=31;x++)s.terrain[y*s.width+x]=3;
  issueOrder(s,[u.id],{type:'move',x:35.5,y:28.5});if(passing)u.passUntil=s.time+1.5;
  let detour=0;
  for(let tick=0;tick<500;tick++){
    const previous={x:u.x,y:u.y};updateGame(s,.05);detour=Math.max(detour,Math.abs(u.y-28.5));
    const steps=Math.max(1,Math.ceil(Math.hypot(u.x-previous.x,u.y-previous.y)/.08));
    for(let i=1;i<=steps;i++)for(const dx of [-.189,.189])for(const dy of [-.189,.189]){
      const x=previous.x+(u.x-previous.x)*i/steps+dx,y=previous.y+(u.y-previous.y)*i/steps+dy;
      assert.equal(s.blocked[Math.floor(y)*s.width+Math.floor(x)],0,`${type} cannot cross a lava shoreline, even while passing allies`);
    }
  }
  assert(Math.hypot(u.x-35.5,u.y-28.5)<1.1,`${type} arrives beyond the pool`);
  assert(detour>3,'Units take the safe route around the pool');assert.equal(u.hp,u.maxHp);
}

console.log('Ashline lava checks passed: deterministic connected pools, independent distribution RNG, safe bases/minerals, routes, construction/fog, and every unit class during friendly jam passage.');
