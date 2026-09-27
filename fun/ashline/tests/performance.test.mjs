import test from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';
import {performanceScene} from './performance-scenes.mjs';
const snapshot=s=>JSON.parse(encodeGame(s)).game;
const advance=(s,n)=>{for(let i=0;i<n;i++)sim.updateGame(s,.05);};
for(const name of ['march','obstructed','battle','harvesting'])test(`${name}: derived performance caches preserve complete save continuation`,()=>{
  const s=performanceScene(sim,name,160);advance(s,16);
  const restored=decodeGame(encodeGame(s)).game;
  for(let i=0;i<50;i++){sim.updateGame(s,.05);sim.updateGame(restored,.05);}
  assert.deepEqual(snapshot(restored),snapshot(s));
  assert(s.entities.filter(e=>e.kind==='unit').length>120,'The fixture keeps a substantial active population');
});

test('new static blockers invalidate clear-route proofs, including across save/load',()=>{
  const s=performanceScene(sim,'march',24);
  const unit=s.entities.find(e=>e.kind==='unit');
  s.entities=s.entities.filter(e=>e.kind==='building'||e===unit);
  unit.x=80.5;unit.y=65.5;unit.angle=0;unit.order={type:'move',x:127.5,y:65.5};
  advance(s,30);assert(unit.x>82,'The original open route is active');
  for(let y=52;y<77;y++)s.terrain[y*s.width+102]=1;
  s.navVersion++;
  const restored=decodeGame(encodeGame(s)).game;
  for(let i=0;i<400;i++){
    sim.updateGame(s,.05);sim.updateGame(restored,.05);
    for(const dx of [-.189,.189])for(const dy of [-.189,.189])assert.equal(s.blocked[Math.floor(unit.y+dy)*s.width+Math.floor(unit.x+dx)],0,'The body never enters the new wall');
  }
  assert.deepEqual(snapshot(restored),snapshot(s));
  assert(unit.x>102,'The cached route is replaced with a real detour');
});

test('cached target queries reflect deaths before the next unit fires',()=>{
  const s=performanceScene(sim,'battle',4),units=s.entities.filter(e=>e.kind==='unit');
  s.entities=s.entities.filter(e=>e.kind==='building');
  for(let i=0;i<4;i++){
    const u=units[i],team=i<2?0:1,type=sim.raceUnit(s,team,'tank'),d=sim.UNITS[type];
    Object.assign(u,{team,type,size:d.size,hp:i<2?d.hp:1,maxHp:d.hp,x:70+(i%2)*.9,y:i<2?60:63,angle:Math.PI/2,
      order:{type:'idle'},path:[],cooldown:i<2?0:10,targetId:null,kills:0,tech:[]});
    s.entities.push(u);
  }
  s.visible.forEach(v=>v.fill(1));sim.updateGame(s,.05);
  assert.equal(s.entities.filter(e=>e.kind==='unit'&&e.team===1).length,0);
  assert.equal(s.teams[0].kills,2,'The second guard selects the remaining living target');
});

test('shared Boids neighborhoods match a brute-force immutable snapshot at bucket and radius boundaries',async()=>{
  const {createFlockSnapshot}=await import('../flocking.js');
  const s=performanceScene(sim,'march',160),original=s.entities.filter(e=>e.kind==='unit').map(e=>({id:e.id,x:e.x,y:e.y}));
  const neighbors=createFlockSnapshot(s.entities);
  // Later entity movement cannot rewrite the neighborhood captured at tick start.
  for(const e of s.entities)if(e.kind==='unit'){e.x+=.37;e.y-=.13;}
  for(let i=0;i<240;i++){
    const source=original[i%original.length],u={id:source.id,x:source.x+(i%7-3)*.19,y:source.y+(i%5-2)*.21};
    const expected=original.filter(e=>e.id!==u.id&&Math.hypot(e.x-u.x,e.y-u.y)<4).sort((a,b)=>a.id-b.id);
    assert.deepEqual(neighbors(u).map(e=>({id:e.id,x:e.x,y:e.y})),expected);
  }
});

test('per-step ownership queries include a newly completed nexus and a newly produced unit',()=>{
  const s=performanceScene(sim,'march',400),template=structuredClone(s.entities.find(e=>e.type==='core'));
  // One existing nexus is at its 200-unit team capacity; the second finishes before production.
  const core={...structuredClone(template),id:s.nextId++,x:110,y:150,progress:.9999,hp:2999};
  const d=sim.BUILDINGS.factory,factory={...template,id:s.nextId++,type:'factory',x:118,y:150,size:d.size,hp:d.hp,maxHp:d.hp,
    queue:[{type:'tank',progress:.9999}],progress:1};
  s.entities.push(core,factory);s.navVersion++;
  assert.equal(sim.unitCapacity(s,0),200);sim.updateGame(s,.05);
  assert.equal(core.progress,1);assert.equal(sim.unitCapacity(s,0),400);
  assert.equal(factory.queue.length,0);
  assert.equal(s.entities.filter(e=>e.kind==='unit'&&e.team===0).length,201,'Production sees capacity granted earlier in this tick');
  const born=s.entities.at(-1);assert.equal(born.type,'tank');assert.equal(sim.getEntity(s,born.id),born);
});
