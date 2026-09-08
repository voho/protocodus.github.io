import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,updateGame,BUILDINGS,UNITS,MAP_SIZES,MAP_PROFILES,buildingRole,unitRole,planWallLine,buildWallLine,canPlace,placeBuilding,issueOrder,getEntity,toggleRepair,sellBuilding,terrainCover} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

function fixture(race='organics'){
  const s=createGame('WALL-FIXTURE','hard',{...MAP_SIZES.standard,races:[race,'organics'],aiTeams:[]});
  s.terrain.fill(0);s.minerals.fill(0);s.mineralTypes.fill(0);s.entities=s.entities.filter(e=>e.kind==='building');s.navVersion++;
  s.visible.forEach(grid=>grid.fill(1));s.explored.forEach(grid=>grid.fill(1));s.teams[0].credits=5000;
  const core=s.entities.find(e=>e.team===0&&buildingRole(e)==='core');return{s,x:core.x-4,y:core.y+7};
}
const advance=(s,seconds)=>{for(let i=0;i<seconds*4;i++)updateGame(s,.25);};

for(const race of ['organics','aiUnity'])test(`${race} builds the common wall and extends a contiguous line`,()=>{
  const {s,x,y}=fixture(race),before={credits:s.teams[0].credits,entities:s.entities.length};
  const plan=planWallLine(s,0,x,y,x+18,y);
  assert.equal(plan.count,19);assert.equal(plan.cost,19*40);assert.equal(plan.ok,true);
  assert.equal(s.teams[0].credits,before.credits);assert.equal(s.entities.length,before.entities,'preview cannot place walls');
  const result=buildWallLine(s,0,x,y,x+18,y);
  assert.equal(result.ok,true);assert.equal(result.count,19);assert.equal(result.cost,760);
  assert.equal(s.teams[0].credits,before.credits-result.cost);
  assert.ok(result.ids.every(id=>getEntity(s,id).type==='wall'));
  advance(s,4.25);
  for(const id of result.ids){const wall=getEntity(s,id);assert.equal(wall.progress,1);assert.equal(s.blocked[wall.y*s.width+wall.x],1,'walls are solid navigation obstacles');}
  assert.equal(BUILDINGS.wall.power,0);
});

test('diagonal wall drags use the same solid4-connected cells in either direction',()=>{
  const {s,x,y}=fixture(),a=planWallLine(s,0,x,y,x+7,y+4),b=planWallLine(s,0,x+7,y+4,x,y);
  assert.equal(a.cells.length,12);
  assert.deepEqual(a.cells.map(({x,y})=>({x,y})),b.cells.map(({x,y})=>({x,y})).reverse());
  for(let i=1;i<a.cells.length;i++)assert.equal(Math.abs(a.cells[i].x-a.cells[i-1].x)+Math.abs(a.cells[i].y-a.cells[i-1].y),1);
});

test('a wall line stops exactly at the first obstruction or unaffordable segment',()=>{
  const {s,x,y}=fixture();s.teams[0].credits=140;
  let result=buildWallLine(s,0,x,y,x+10,y);
  assert.equal(result.count,3);assert.equal(result.cost,120);assert.equal(s.teams[0].credits,20);assert.match(result.reason,/credits/i);
  assert.equal(s.entities.filter(e=>e.type==='wall').length,3);
  const blocked=fixture();blocked.s.terrain[blocked.y*blocked.s.width+blocked.x+4]=1;blocked.s.navVersion++;
  result=buildWallLine(blocked.s,0,blocked.x,blocked.y,blocked.x+10,blocked.y);
  assert.equal(result.count,4);assert.equal(result.cost,160);assert.match(result.reason,/obstructed/i);
  assert.equal(blocked.s.entities.filter(e=>e.type==='wall'&&e.x>blocked.x+4).length,0,'construction never silently skips a hole');
});

test('wall construction respects vision, mineral deposits, craters, units and the drag limit',()=>{
  const {s,x,y}=fixture(),i=y*s.width+x;
  s.visible[0][i]=0;assert.equal(canPlace(s,0,'wall',x,y).reason,'Requires sensor coverage');s.visible[0][i]=1;
  s.minerals[i]=400;assert.match(canPlace(s,0,'wall',x,y).reason,/Shard/);s.minerals[i]=0;
  s.terrain[i]=5;s.navVersion++;assert.match(canPlace(s,0,'wall',x,y).reason,/Crater/);s.terrain[i]=0;s.navVersion++;
  const unit=createGame('UNIT').entities.find(e=>e.team===0&&unitRole(e)==='rifle');s.entities.push({...unit,id:s.nextId++,x:x+.5,y:y+.5});
  assert.equal(canPlace(s,0,'wall',x,y).reason,'Unit in construction area');s.entities.pop();
  const limited=planWallLine(s,0,x,y,x+60,y);assert.equal(limited.cells.length,48);assert.equal(limited.truncated,true);assert.match(limited.reason,/48/);
});

test('completed walls retain repair and sale behavior through saving',()=>{
  const {s,x,y}=fixture(),result=buildWallLine(s,0,x,y,x,y);advance(s,4.25);
  const wall=getEntity(s,result.ids[0]);wall.hp=300;
  assert.equal(toggleRepair(s,wall.id).ok,true);
  const restored=decodeGame(encodeGame(s)).game,before=restored.teams[0].credits;
  advance(restored,2);const repairing=getEntity(restored,wall.id);
  assert.ok(repairing.hp>300&&restored.teams[0].credits<before);
  const sale=sellBuilding(restored,wall.id);assert.equal(sale.ok,true);assert.ok(sale.refund>0&&sale.refund<=20);
  assert.equal(getEntity(restored,wall.id),undefined);
});

test('generated craters are mirrored, reachable cover outside resource and base footprints',()=>{
  for(const profile of Object.keys(MAP_PROFILES)){
    const s=createGame('CRATER-SAMPLE','normal',{...MAP_SIZES.standard,profile}),craters=[];
    for(let i=0;i<s.terrain.length;i++)if(s.terrain[i]===5){
      craters.push(i);assert.equal(s.terrain[s.terrain.length-1-i],5);assert.equal(s.blocked[i],0);assert.equal(s.minerals[i],0);assert.ok(s.regions[i]);
    }
    assert.ok(craters.length>=16,'each sampled terrain profile contains substantial crater cover');
    for(const e of s.entities.filter(e=>e.kind==='building'))for(let y=e.y;y<e.y+e.size;y++)for(let x=e.x;x<e.x+e.size;x++)assert.notEqual(s.terrain[y*s.width+x],5);
    const unit=s.entities.find(e=>e.kind==='unit'),i=craters[0];unit.x=i%s.width+.5;unit.y=Math.floor(i/s.width)+.5;
    assert.equal(terrainCover(s,unit),.15);assert.equal(terrainCover(s,{...unit,kind:'building'}),0);assert.equal(terrainCover(s,{...unit,hp:0}),0);
    const restored=decodeGame(encodeGame(s)).game;assert.deepEqual(restored.terrain,s.terrain);assert.equal(terrainCover(restored,restored.entities.find(e=>e.id===unit.id)),.15);
  }
});


test('attack orders breach an intervening wall while siege weapons can reach the nexus behind it',()=>{
  for(const type of ['rifle','artillery']){
    const s=createGame('WALL-COMBAT','hard',{...MAP_SIZES.standard,aiTeams:[]});
    const home=s.entities.find(e=>e.team===0&&buildingRole(e)==='core'),core=s.entities.find(e=>e.team===1&&buildingRole(e)==='core'),u=s.entities.find(e=>e.team===0&&unitRole(e)==='rifle');
    Object.assign(core,{x:24,y:24});Object.assign(u,{type,x:15.5,y:25.5,size:UNITS[type].size,hp:UNITS[type].hp,maxHp:UNITS[type].hp,cooldown:0});
    s.entities=[home,core,u];s.terrain.fill(0);s.minerals.fill(0);s.navVersion++;s.visible.forEach(grid=>grid.fill(1));s.fogClock=.9;
    const placed=placeBuilding(s,1,'wall',19,25);assert.equal(placed.ok,true);
    const wall=getEntity(s,placed.id);wall.progress=1;wall.hp=wall.maxHp;
    issueOrder(s,[u.id],{type:'attack',targetId:core.id,x:25.5,y:25.5});updateGame(s,.25);
    if(type==='rifle'){assert.ok(wall.hp<wall.maxHp,'an out-of-range attack target causes its blocking wall to be fired upon');assert.equal(core.hp,core.maxHp);assert.equal(u.order.targetId,core.id,'original target remains the long-term order');}
    else{assert.ok(core.hp<core.maxHp,'siege range reaches the original target');assert.equal(wall.hp,wall.maxHp);}
  }
});

test('crater cover reduces direct fire15% for both races and leaves explosive damage unchanged',()=>{
  const damage=(type,terrain)=>{
    const s=createGame('CRATER-DAMAGE','hard',{...MAP_SIZES.standard,races:[type.startsWith('unity')?'aiUnity':'organics','organics'],aiTeams:[]});
    const attacker=s.entities.find(e=>e.team===0&&unitRole(e)==='rifle'),target=s.entities.find(e=>e.team===1&&unitRole(e)==='harvester');
    Object.assign(attacker,{type,x:18.5,y:20.5,size:UNITS[type].size,hp:UNITS[type].hp,maxHp:UNITS[type].hp,cooldown:0,order:{type:'idle'}});
    Object.assign(target,{x:20.5,y:20.5});s.entities=s.entities.filter(e=>buildingRole(e)==='core'||e===attacker||e===target);
    s.terrain.fill(0);s.terrain[20*s.width+20]=terrain;s.minerals.fill(0);s.navVersion++;
    const before=target.hp;updateGame(s,.4);return before-target.hp;
  };
  for(const type of ['rifle','unityRifle','rocket','unityRocket','artillery','unityArtillery']){
    const plain=damage(type,0),covered=damage(type,5);assert.ok(plain>0);
    const ratio=unitRole(type)==='rifle'?.85:1;
    assert.ok(Math.abs(covered-plain*ratio)<1e-8,`${type} respects the correct direct/explosive cover rule`);
  }
});
