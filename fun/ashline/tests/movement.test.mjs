import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, UNITS, issueOrder, updateGame, raceUnit } from '../sim.js';
import { encodeGame, decodeGame } from '../save.js';
const turn = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
function scene() {
  const s=createGame('steering-regression'); s.ai.nextThink=1e9; s.terrain.fill(0); s.minerals.fill(0);
  const template=structuredClone(s.entities.find(e=>e.type==='rifle')); s.entities=[]; s.navVersion++;
  const add=(type,x,y,angle=0)=>{const d=UNITS[type],u={...structuredClone(template),id:s.nextId++,type,x,y,angle,size:d.size,hp:d.hp,maxHp:d.hp};if(d.role==='harvester')Object.assign(u,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});s.entities.push(u);return u;};
  return {s,add};
}
test('head-on armor passes without rapid heading changes and settles motionless', () => {
  const {s,add}=scene(),a=add('tank',20,25),b=add('tank',38,25,Math.PI);
  issueOrder(s,[a.id],{type:'move',x:38,y:25});issueOrder(s,[b.id],{type:'move',x:20,y:25});
  const goals=[{...a.order},{...b.order}];
  for(let i=0;i<800;i++) {const before=[a.angle,b.angle];updateGame(s,.05);assert(turn(a.angle,before[0])<=1.8*.05+1e-8);assert(turn(b.angle,before[1])<=1.8*.05+1e-8);}
  assert(Math.hypot(a.x-goals[0].x,a.y-goals[0].y)<.081);assert(Math.hypot(b.x-goals[1].x,b.y-goals[1].y)<.081);
  const settled=[a.angle,b.angle]; for(let i=0;i<60;i++)updateGame(s,.05);
  assert.deepEqual([a.angle,b.angle],settled);assert.equal(a.moving,false);assert.equal(b.moving,false);
});
test('acceleration, steering and passing-side memory continue exactly after save', () => {
  const {s,add}=scene(),a=add('striker',20,25),b=add('engineer',26,25,Math.PI);
  issueOrder(s,[a.id],{type:'move',x:36,y:29});issueOrder(s,[b.id],{type:'move',x:16,y:25});
  for(let i=0;i<28;i++)updateGame(s,.05);
  const restored=decodeGame(encodeGame(s)).game;
  for(let i=0;i<180;i++){updateGame(s,.05);updateGame(restored,.05);}
  assert.deepEqual(restored.entities,s.entities);assert.equal(restored.rng,s.rng);
});
test('combat remains responsive while armor rotates through a bounded shortest turn', () => {
  const {s,add}=scene(),a=add('tank',20,25),b=add('tank',16,25);b.team=1;b.hp=b.maxHp=520;
  s.visible.forEach(v=>v.fill(1));s.fogClock=.2;a.cooldown=0;
  const before=a.angle;updateGame(s,.05);assert(b.hp<520,'Armed guards react immediately');assert(turn(a.angle,before)<=3.2*.05+1e-8);
});

for(const race of ['organics','aiUnity'])for(const role of ['rifle','rocket','scout','tank','artillery','harvester','engineer','striker','constructor']){
  test(`${race} ${role} rotates in place before moving and separates turning from travel`,()=>{
    const {s,add}=scene();s.teams[0].race=race;
    const unit=add(raceUnit(s,0,role),30.5,40.5,Math.PI),goal={x:44.5,y:45.5};
    issueOrder(s,[unit.id],{type:'move',...goal});
    let turning=0,traveling=0;
    for(let tick=0;tick<800;tick++){
      const before={x:unit.x,y:unit.y,angle:unit.angle};updateGame(s,.05);
      const angle=turn(unit.angle,before.angle),distance=Math.hypot(unit.x-before.x,unit.y-before.y);
      assert(!(angle>1e-8&&distance>1e-8),`Frame ${tick}: body turn ${angle} and movement ${distance} may not occur together`);
      if(angle>1e-8){turning++;assert.equal(unit.moving,false,'Turning in place does not animate translation');}
      if(distance>1e-8)traveling++;
    }
    assert(turning>0&&traveling>0,'The test exercises both phases instead of accepting a stationary unit');
    assert(Math.hypot(unit.x-goal.x,unit.y-goal.y)<.081,'Turning restrictions must still allow exact destination arrival');
  });
}
