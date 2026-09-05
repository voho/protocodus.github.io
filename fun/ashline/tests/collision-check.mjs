import assert from 'node:assert/strict';
import {UNITS,createGame,issueOrder,updateGame} from '../sim.js';

function scene(seed='collision-check'){
  const s=createGame(seed);s.ai.nextThink=Infinity;s.fogClock=Infinity;
  s.terrain.fill(0);s.minerals.fill(0);s.explored.forEach(v=>v.fill(1));s.visible.forEach(v=>v.fill(0));
  const template=structuredClone(s.entities.find(e=>e.type==='rifle'));
  const hauler=structuredClone(s.entities.find(e=>e.type==='harvester'));
  const depot=structuredClone(s.entities.find(e=>e.type==='refinery'&&e.team===0));
  s.entities=[];s.navVersion++;
  const add=(type,x,y)=>{
    const d=UNITS[type],u={...structuredClone(type==='harvester'?hauler:template),id:s.nextId++,type,x,y,size:d.size,hp:d.hp,maxHp:d.hp,path:[]};
    s.entities.push(u);return u;
  };
  return{s,add,depot};
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const move=(s,u,x,y)=>{const goal={x,y};issueOrder(s,[u.id],{type:'move',...goal});return goal;};
function clearAt(s,x,y){
  assert(Number.isFinite(x+y),'Collision resolution must stay finite');
  // The simulation uses a .19-tile static radius. Check the full footprint and swept path.
  for(const dx of [-.189,.189])for(const dy of [-.189,.189]){
    assert(x+dx>=0&&x+dx<s.width&&y+dy>=0&&y+dy<s.height,'Units remain inside the map');
    assert.equal(s.blocked[Math.floor(y+dy)*s.width+Math.floor(x+dx)],0,'Units never enter terrain or building footprints');
  }
}
function run(s,seconds,onStep=()=>{}){
  for(let i=0;i<Math.ceil(seconds*20);i++){
    const previous=new Map(s.entities.filter(e=>e.kind==='unit').map(u=>[u.id,{x:u.x,y:u.y}]));
    updateGame(s,.05);
    for(const u of s.entities.filter(e=>e.kind==='unit')){
      const p=previous.get(u.id)||u,segments=Math.max(1,Math.ceil(distance(p,u)/.08));
      for(let j=1;j<=segments;j++)clearAt(s,p.x+(u.x-p.x)*j/segments,p.y+(u.y-p.y)*j/segments);
    }
    onStep(i);
  }
}
const arrived=(u,goal,label)=>assert(distance(u,goal)<1.1,`${label} must arrive; ${distance(u,goal).toFixed(2)} tiles remain`);
function corridor(s){
  for(let x=0;x<s.width;x++)for(const y of [24,26])s.terrain[y*s.width+x]=1;
  s.navVersion++;
}

// Open-ground traffic should visibly avoid an ally instead of driving through its center.
{
  const {s,add}=scene(),a=add('tank',20.5,25.5),b=add('tank',40.5,25.5);
  const goals=[move(s,a,40.5,25.5),move(s,b,20.5,25.5)];let lateral=0;
  run(s,25,()=>{lateral=Math.max(lateral,Math.abs(a.y-25.5),Math.abs(b.y-25.5));});
  arrived(a,goals[0],'First oncoming tank');arrived(b,goals[1],'Second oncoming tank');
  assert(lateral>=.2,`Open-ground units should sidestep; observed ${lateral.toFixed(3)} tiles`);
}

// Tight lanes need eventual friendly passage, including off-center traffic and repeated orders.
for(const offset of [0,.22]){
  const {s,add}=scene(`lane-${offset}`);corridor(s);
  const a=add('tank',20.5,25.5-offset),b=add('artillery',40.5,25.5+offset);
  const goals=[move(s,a,40.5,25.5),move(s,b,20.5,25.5)];
  let waitingAt,passingAt,firstExpiry,expiredMoving=false,closest=Infinity;
  run(s,35,i=>{
    if(waitingAt===undefined&&(a.trafficWait>0||b.trafficWait>0))waitingAt=s.time;
    if(passingAt===undefined&&(a.passUntil>s.time||b.passUntil>s.time)){
      passingAt=s.time;firstExpiry=Math.max(a.passUntil||0,b.passUntil||0);
    }
    if(firstExpiry<s.time&&!(a.passUntil>s.time||b.passUntil>s.time)&&(a.order.type==='move'||b.order.type==='move'))expiredMoving=true;
    closest=Math.min(closest,distance(a,b));
    // The AI refreshes an unchanged order: that must not postpone jam recovery forever.
    if(i%24===0){issueOrder(s,[a.id],{type:'move',...goals[0]});issueOrder(s,[b.id],{type:'move',...goals[1]});}
  });
  arrived(a,goals[0],'Narrow-lane tank');arrived(b,goals[1],'Narrow-lane siege crawler');
  assert(passingAt-waitingAt>=.7,'A natural jam must persist before friendly spacing softens');
  assert(closest<(a.size+b.size)*.43-.05,'The jam window permits otherwise impossible friendly passage');
  assert(expiredMoving,'Temporary friendly passage expires while units continue their journey');
  assert(!(a.passUntil>s.time||b.passUntil>s.time),'Jam recovery never leaves permanent soft collisions');
}

// An active friendly passing window must never soften separation from an enemy.
{
  const {s,add}=scene('enemy-spacing');corridor(s);
  const a=add('tank',20.5,25.5),b=add('artillery',40.5,25.5);
  move(s,a,40.5,25.5);move(s,b,20.5,25.5);
  for(let i=0;i<300&&!(a.passUntil>s.time||b.passUntil>s.time);i++)run(s,.05);
  assert(a.passUntil>s.time||b.passUntil>s.time,'Fixture reaches an actual friendly jam window');
  // Change just the neighbor's faction to isolate the team check during that real window.
  b.team=1;const side=Math.sign(a.x-b.x),minimum=(a.size+b.size)*.43;
  run(s,1,()=>{
    assert(distance(a,b)>=minimum-.003,'Enemy spacing remains solid during a friendly passing window');
    assert.equal(Math.sign(a.x-b.x),side,'Enemies cannot pass through each other in a one-tile lane');
  });
}

// A stationary ally yields locally while retaining its guard order.
{
  const {s,add}=scene(),moving=add('tank',20.5,25.5),parked=add('tank',30.5,25.5);
  const start={x:parked.x,y:parked.y},goal=move(s,moving,40.5,25.5);
  run(s,25);arrived(moving,goal,'Tank passing a parked ally');
  assert.equal(parked.order.type,'idle');assert(distance(parked,start)<1.5,'Yielding should not shove an idle ally along the route');
}

// Coincident spawns disperse and a mixed crowd converges on distinct formation destinations.
function convergence(){
  const {s,add}=scene('converging-crowd'),units=[],goals=[];
  for(let i=0;i<12;i++){
    const u=add(['rifle','rocket','scout','tank','artillery','harvester'][i%6],20.5,25.5);
    units.push(u);goals.push(move(s,u,40.5+i%4*1.3,23.5+Math.floor(i/4)*1.3));
  }
  run(s,40);
  units.forEach((u,i)=>arrived(u,goals[i],`Overlapping spawn ${i}`));
  for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++)assert(distance(units[i],units[j])>.15,'Finished units must not remain stacked');
  return s;
}
const first=convergence(),second=convergence();
assert.deepEqual(first.entities,second.entities,'Collision decisions must be deterministic');
assert.equal(first.rng,second.rng);

// Opposing groups round a one-tile corner; every movement segment must stay out of the walls.
{
  const {s,add}=scene('corner-traffic');s.terrain.fill(1);
  for(let x=15;x<=40;x++)s.terrain[25*s.width+x]=0;
  for(let y=25;y<=45;y++)s.terrain[y*s.width+35]=0;
  s.navVersion++;const jobs=[];
  for(let i=0;i<4;i++){
    const a=add('tank',18.5+i,25.5),b=add('artillery',35.5,43.5-i);
    jobs.push([a,move(s,a,35.5,39.5+i)],[b,move(s,b,18.5+i,25.5)]);
  }
  run(s,50);for(const [u,goal] of jobs)arrived(u,goal,'Corner traffic');
}

// Crowded automatic haulers must each complete a real paid delivery beside a solid refinery.
{
  const {s,add,depot}=scene('hauler-traffic');depot.x=15;depot.y=38;s.entities.push(depot);
  for(let x=18;x<=27;x++)for(const y of [38,40])s.terrain[y*s.width+x]=1;
  s.navVersion++;s.minerals[39*s.width+25]=6000;
  const haulers=Array.from({length:6},(_,i)=>add('harvester',18.5+i,39.5)),delivered=new Set();
  const before=s.teams[0].credits,lastCargo=new Map(haulers.map(u=>[u.id,0]));
  run(s,100,()=>{for(const u of haulers){if(lastCargo.get(u.id)>0&&u.cargo===0)delivered.add(u.id);lastCargo.set(u.id,u.cargo);}});
  assert.equal(delivered.size,haulers.length,'Every hauler gets through the shared dock');
  assert(s.teams[0].credits>=before+haulers.length*UNITS.harvester.capacity,'Crowded haulers keep the economy running');
  assert(s.minerals[39*s.width+25]<6000);
}

console.log('Ashline collision checks passed: sidestepping, narrow/repeated orders, natural jam expiry, enemy spacing, parked allies, overlap recovery, deterministic crowds, corner sweeps, and real hauler deliveries.');
