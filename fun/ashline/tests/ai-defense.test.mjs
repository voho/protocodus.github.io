import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, updateGame, issueOrder, UNITS, BUILDINGS, raceUnit, raceBuilding, buildingRole} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';

function scene(race='organics') {
  const s=createGame('local-defense','hard',{width:72,height:56,races:[race,race],aiTeams:[1]});
  const template=structuredClone(s.entities.find(e=>e.kind==='unit'));
  const core=s.entities.find(e=>e.team===1&&buildingRole(e)==='core');
  s.entities=s.entities.filter(e=>e.kind==='building'&&buildingRole(e)==='core');
  Object.assign(core,{x:52,y:10});
  s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.navVersion++;
  s.visible.forEach(v=>v.fill(1));s.explored.forEach(v=>v.fill(1));
  s.teams.forEach(t=>t.credits=0);s.ai.nextThink=0;s.ai.nextRaid=10000;s.ai.nextExpand=10000;
  const unit=(role,x,y,team=1)=>{
    const type=raceUnit(s,team,role),d=UNITS[type];
    const e={...structuredClone(template),id:s.nextId++,team,type,x,y,size:d.size,hp:d.hp,maxHp:d.hp,
      angle:0,cooldown:1000,order:{type:'idle'},path:[],repath:0};
    if(role==='harvester')Object.assign(e,{cargo:0,unload:0,unloadDepotId:null,harvestPhase:'gather'});
    s.entities.push(e);return e;
  };
  const building=(role,x,y)=>{
    const type=raceBuilding(s,1,role),d=BUILDINGS[type];
    const e={...structuredClone(core),id:s.nextId++,type,x,y,size:d.size,hp:d.hp,maxHp:d.hp,queue:[],cooldown:1000};
    s.entities.push(e);s.navVersion++;return e;
  };
  return {s,core,unit,building};
}

function think(s,hidden=[]) {
  s.ai.nextThink=s.time;s.fogClock=.2;s.visible.forEach(v=>v.fill(1));
  for(const e of hidden)s.visible[1][Math.floor(e.y)*s.width+Math.floor(e.x)]=0;
  updateGame(s,.05);
}
const defense=u=>u.order.type==='attack';

for(const race of ['organics','aiUnity']){
  test(`${race}: a small intrusion gets local defenders without canceling a distant raid`,()=>{
    const {s,unit}=scene(race),local=[unit('tank',54,16),unit('tank',56,16),unit('rifle',58,16)];
    const raid=Array.from({length:8},(_,i)=>unit('tank',21+i,34));
    issueOrder(s,raid.map(u=>u.id),{type:'attackMove',x:12,y:44});
    const before=raid.map(u=>structuredClone(u.order)),intruder=unit('rifle',54,22,0);
    think(s);
    assert(local.some(u=>defense(u)&&u.order.targetId===intruder.id),'Nearby reserves respond to the visible intruder');
    assert(local.filter(defense).length<local.length,'One rifle does not consume every local reserve');
    assert.deepEqual(raid.map(u=>u.order),before,'The distant offensive wave keeps its assigned destination and pace');
  });

  test(`${race}: separate bases receive separate defenders`,()=>{
    const {s,unit,building}=scene(race);
    building('core',24,34);
    const home=[unit('tank',54,16),unit('tank',56,16)],outpost=[unit('tank',27,31),unit('tank',29,31)];
    const a=unit('rifle',54,22,0),b=unit('rifle',25,25,0);
    think(s);
    assert(home.some(u=>u.order.targetId===a.id),'Home defenders intercept the home threat');
    assert(outpost.some(u=>u.order.targetId===b.id),'The remote outpost is not abandoned to the home threat');
  });

  test(`${race}: a committed defender does not switch targets whenever intruders change places`,()=>{
    const {s,unit}=scene(race),guard=unit('tank',53,14),other=unit('rifle',53,23,0),enemy=unit('rifle',54,22,0);
    think(s);assert.equal(guard.order.targetId,enemy.id);
    other.y=20;
    think(s);
    assert.equal(guard.order.targetId,enemy.id,'The valid ongoing interception survives another intruder moving nearer the nexus');
  });

  test(`${race}: hidden reinforcements do not change defensive commitments`,()=>{
    const a=scene(race),b=scene(race);
    for(const f of [a,b]){f.unit('tank',53,16);f.unit('tank',56,16);f.unit('rifle',53,23,0);}
    const hidden=Array.from({length:6},(_,i)=>b.unit('tank',50+i,25,0));
    think(a.s);think(b.s,hidden);
    const orders=s=>s.entities.filter(e=>e.kind==='unit'&&e.team===1).map(e=>e.order);
    assert.deepEqual(orders(a.s),orders(b.s),'Only currently visible hostiles affect defender allocation');
  });

  test(`${race}: a fleeing intruder cannot drag defenders away indefinitely`,()=>{
    const {s,unit}=scene(race),guard=unit('tank',53,16),enemy=unit('rifle',53,23,0);
    think(s);assert.equal(guard.order.targetId,enemy.id);
    enemy.x=15;enemy.y=10;
    think(s);
    assert.notEqual(guard.order.targetId,enemy.id,'A departed perimeter threat releases its defenders');
    assert.notEqual(guard.order.type,'attack','Defenders are no longer ordered to chase the raider across the map');
  });

  test(`${race}: a damaged defender retreats instead of being recalled into the same fight`,()=>{
    const {s,unit}=scene(race),guard=unit('tank',53,20),reserve=unit('tank',58,17);
    guard.hp=guard.maxHp*.28;unit('rifle',53,23,0);think(s);
    assert.equal(guard.order.type,'move','Critical damage takes priority over the defense assignment');
    assert(defense(reserve),'A healthy reserve covers the retreat');
  });

  test(`${race}: only powered defenses in firing range count as cover`,()=>{
    for(const state of ['covering','distant','brownout']){
      const {s,unit,building}=scene(race),guard=unit('tank',53,16);
      building('turret',state==='distant'?65:52,state==='distant'?5:19);
      if(state==='brownout')building('refinery',58,12);
      unit('rifle',53,23,0);think(s);
      assert.equal(defense(guard),state!=='covering',`${state}: mobile troops are reserved only when the sentry can actually handle the threat`);
    }
  });

  test(`${race}: overlapping sentries do not leave an uncovered intruder undefended`,()=>{
    const {s,unit,building}=scene(race),guard=unit('tank',60,17);
    building('reactor',60,10);building('turret',51,14);building('turret',56,14);
    building('refinery',53,26);
    const covered=unit('rifle',53,16,0),uncovered=unit('rifle',53,24,0);
    issueOrder(s,[guard.id],{type:'attack',targetId:covered.id});
    think(s);
    assert.equal(guard.order.type,'attack','The exposed refinery still receives mobile cover');
    assert.equal(guard.order.targetId,uncovered.id,'Sentries handle the covered rifle while the tank intercepts the uncovered rifle');
    const order=structuredClone(guard.order);
    think(s);
    assert.deepEqual(guard.order,order,'A valid interception remains stable on the next assessment');
  });

  test(`${race}: distant turret cover cannot make an outmatched flank look safe`,()=>{
    const {s,unit,building}=scene(race),guard=unit('rifle',60,17);
    building('reactor',60,10);building('turret',51,14);building('turret',56,14);
    building('refinery',53,26);
    unit('tank',53,16,0);unit('tank',53,24,0);
    think(s);
    assert.equal(guard.order.type,'move','The rifle retreats from the uncovered tank even though sentries can handle the other tank');
  });

  test(`${race}: scout fire triggers defense while a passing scout does not`,()=>{
    const {s,core,unit}=scene(race),guard=unit('tank',60,13),scout=unit('scout',53,18,0);
    think(s);assert(!defense(guard),'Passing scouts do not pull the reserves away');
    scout.cooldown=0;think(s);
    assert(core.hp<core.maxHp&&core.attackerId===scout.id,'The scout really shot the protected nexus');
    assert.equal(guard.order.targetId,scout.id,'Observed scout harassment receives a local response');
  });

  test(`${race}: outmatched local guards retreat while an unthreatened distant raid continues`,()=>{
    const {s,unit}=scene(race),guard=unit('rifle',53,17);
    const raid=Array.from({length:8},(_,i)=>unit('tank',16+i,35));
    issueOrder(s,raid.map(u=>u.id),{type:'attackMove',x:12,y:44});
    const before=raid.map(u=>structuredClone(u.order));
    for(let i=0;i<4;i++)unit('tank',52+i,23,0);
    think(s);
    assert.equal(guard.order.type,'move','The overmatched local guard withdraws toward shelter');
    assert.deepEqual(raid.map(u=>u.order),before,'A losing local defense does not overwrite an unrelated raid');
    assert.equal(s.ai.regroupUntil,undefined,'A local fallback does not pause the entire commander');
  });

  test(`${race}: threatened expansion haulers flee to their nearby base`,()=>{
    const {s,unit,building}=scene(race),outpost=building('core',24,34),hauler=unit('harvester',24,30);
    unit('tank',29,31);unit('rifle',25,26,0);think(s);
    assert.equal(hauler.order.type,'move');
    assert(Math.hypot(hauler.order.x-outpost.x,hauler.order.y-outpost.y)<10,'The escape uses the expansion instead of crossing the entire map to the starting nexus');
  });

  test(`${race}: wounded military units seek nexus repairs instead of parking at a refinery`,()=>{
    const {s,core,unit,building}=scene(race),guard=unit('tank',32,34);
    building('refinery',30,30);guard.hp=guard.maxHp*.3;think(s);
    assert.equal(guard.order.type,'move');
    assert(Math.hypot(guard.order.x-core.x-core.size/2,guard.order.y-core.y-core.size/2)<7,'A 30%-health unit heads into an actual nexus repair radius');
  });

  test(`${race}: local defense protects home while a committed raid finishes live combat`,()=>{
    const {s,core,unit}=scene(race),target=s.entities.find(e=>e.team===0&&buildingRole(e)==='core');
    Object.assign(target,{x:12,y:37});s.navVersion++;s.fogClock=0;
    const locals=[unit('tank',54,17),unit('tank',57,17),unit('rifle',59,17)];
    const wave=Array.from({length:8},(_,i)=>unit(i<6?'tank':'artillery',23+i%4*1.6,34+Math.floor(i/4)*1.6));
    const opposition=Array.from({length:3},(_,i)=>unit('rifle',18+i,39,0));
    for(const e of [...locals,...wave,...opposition]){e.cooldown=0;e.angle=e.team?Math.PI:0;}
    issueOrder(s,wave.map(e=>e.id),{type:'attackMove',x:13.5,y:38.5});
    let redirected=false;
    for(let tick=0;tick<800&&s.status==='playing';tick++){
      if(tick%160===0){
        const raider=unit('rifle',53,23,0);raider.cooldown=0;
        issueOrder(s,[raider.id],{type:'attack',targetId:core.id});
      }
      updateGame(s,.05);
      redirected||=wave.some(e=>e.order.type==='attack');
    }
    assert.equal(redirected,false,'Repeated diversions never redirect the offensive wave home');
    assert(target.hp<=0,'The original wave reaches and destroys the hostile nexus');
    assert.equal(core.hp,core.maxHp,'Local reserves keep the home nexus safe throughout combat');
    assert(wave.every(e=>e.hp>0),'The committed combined-arms wave survives the assault');
  });
}

test('defense assignments preserve deterministic save continuation',()=>{
  const {s,unit,building}=scene('aiUnity');building('core',24,34);
  unit('tank',53,16);unit('rifle',56,16);unit('tank',27,31);unit('rifle',53,23,0);unit('tank',25,25,0);
  think(s);const restored=decodeGame(encodeGame(s)).game;
  for(let i=0;i<80;i++){updateGame(s,.05);updateGame(restored,.05);}
  assert.deepEqual(JSON.parse(encodeGame(restored)).game,JSON.parse(encodeGame(s)).game);
});
