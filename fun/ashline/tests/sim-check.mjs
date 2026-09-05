import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,createGame,updateGame,canPlace,placeBuilding,trainUnit,issueOrder,stopUnits,powerStats,getEntity} from '../sim.js';

const advance=(s,seconds)=>{for(let i=0;i<Math.ceil(seconds/.1);i++)updateGame(s,.1);};
const quiet=seed=>{const s=createGame(seed);s.ai.nextThink=Infinity;return s;};
const entities=(s,team,type)=>s.entities.filter(e=>e.team===team&&e.type===type);
const available=(s,type)=>{const core=entities(s,0,'core')[0];for(let y=core.y-15;y<core.y+15;y++)for(let x=Math.max(1,core.x-12);x<core.x+22;x++)if(canPlace(s,0,type,x,y).ok)return{x,y};throw Error(`No placement for ${type}`);};

// New sectors have four times the area; both saved dimensions work when stepped together.
const expanded=createGame('map-dimensions'),legacy=createGame('map-dimensions','normal',{width:72,height:56});
assert.deepEqual([expanded.width,expanded.height],[144,112]);
assert.equal(expanded.terrain.length,legacy.terrain.length*4);
assert.deepEqual(expanded.teams,legacy.teams,'Larger maps preserve the starting economy');
assert.deepEqual(expanded.entities.map(({type,team,size,hp})=>({type,team,size,hp})),legacy.entities.map(({type,team,size,hp})=>({type,team,size,hp})),'Starting armies and physical scale stay unchanged');
const mineralCells=s=>s.minerals.reduce((n,v)=>n+(v>0),0);
assert(mineralCells(expanded)>mineralCells(legacy)*3.5,'The enlarged terrain also contains proportionately more resource fields');
const edgeCases=[legacy,expanded].map(s=>{
  const u=entities(s,0,'scout')[0];s.entities=[u];s.ai.nextThink=Infinity;s.terrain.fill(0);s.minerals.fill(0);s.navVersion++;
  u.x=s.width-14.5;u.y=s.height-14.5;const goal={x:s.width-3.5,y:s.height-3.5};
  issueOrder(s,[u.id],{type:'move',...goal});return{s,u,goal};
});
for(let i=0;i<100;i++)for(const {s} of edgeCases)updateGame(s,.1);
for(const {s,u,goal} of edgeCases){
  assert(Math.hypot(u.x-goal.x,u.y-goal.y)<1.1,'Units can navigate to either map size’s far corner');
  assert.equal(s.visible[0][Math.floor(goal.y)*s.width+Math.floor(goal.x)],1,'Far-edge fog uses the saved row width');
  issueOrder(s,[u.id],{type:'move',x:1000,y:1000});assert.deepEqual([u.order.x,u.order.y],[s.width-.5,s.height-.5]);
}

// Seeds reproduce terrain/resources and both factions begin with concealed enemies.
const first=quiet('deterministic'),second=quiet('deterministic');
assert.deepEqual(first.terrain,second.terrain);assert.deepEqual(first.minerals,second.minerals);
assert.notDeepEqual(first.terrain,quiet('different').terrain);
const enemyCore=entities(first,1,'core')[0];
assert.equal(first.visible[0][enemyCore.y*first.width+enemyCore.x],0);
assert.equal(Object.keys(first.ai.known).length,0);
assert(first.visible[0].some(Boolean));assert(first.visible[0].some(v=>!v));
advance(first,20);advance(second,20);
assert.deepEqual(first.entities,second.entities);assert.deepEqual(first.teams,second.teams);

// Real cargo cycles consume finite shards and deposit credits; loss of refinery has fallback.
const economy=quiet('economy'),mineralTotal=s=>s.minerals.reduce((a,b)=>a+b,0);
const mineralBefore=mineralTotal(economy);advance(economy,45);
assert(economy.teams[0].credits>2000,'Hauler must return its load');
assert(mineralTotal(economy)<mineralBefore,'Harvesting consumes mineral field');
entities(economy,0,'refinery')[0].hp=0;economy.navVersion++;
const beforeFallback=economy.teams[0].credits;advance(economy,35);
assert(economy.teams[0].credits>beforeFallback,'Nexus accepts emergency cargo');

// An exhausted field retries after exploration; inaccessible pockets never trap haulers.
const prospect=quiet('prospect'),hauler=entities(prospect,0,'harvester')[0];
prospect.terrain.fill(0);prospect.minerals.fill(0);prospect.navVersion++;
advance(prospect,2);assert.equal(hauler.mineralTile,-1);
const prospectCore=entities(prospect,0,'core')[0],px=prospectCore.x-10,py=prospectCore.y-35;
for(const [x,y] of [[16,43],[18,43],[17,42],[17,44]])prospect.terrain[(y+py)*prospect.width+x+px]=1;
const isolated=(43+py)*prospect.width+17+px,reachable=(42+py)*prospect.width+22+px;
prospect.minerals[isolated]=600;prospect.minerals[reachable]=600;
prospect.explored[0].fill(1);prospect.navVersion++;
advance(prospect,1.2);assert.equal(hauler.mineralTile,reachable,'Hauler must choose a reachable newly discovered field');
advance(prospect,18);assert.equal(prospect.minerals[isolated],600);assert(prospect.teams[0].credits>1800);

// Construction needs prerequisites, open covered ground and credits. Queues finish actual units.
const base=quiet('building');
assert.equal(trainUnit(base,0,'tank').ok,false);
assert.equal(canPlace(base,0,'factory',20,35).ok,false);
assert.equal(canPlace(base,0,'reactor',60,45).ok,false);
const spot=available(base,'barracks'),before=base.teams[0].credits;
const result=placeBuilding(base,0,'barracks',spot.x,spot.y);
assert(result.ok);assert.equal(base.teams[0].credits,before-BUILDINGS.barracks.cost);
assert.equal(trainUnit(base,0,'rifle').ok,false);
advance(base,16);assert.equal(getEntity(base,result.id).progress,1);
assert(trainUnit(base,0,'rifle').ok);assert.equal(getEntity(base,result.id).queue.length,1);
advance(base,6);assert.equal(entities(base,0,'rifle').length,4);
const reactor=entities(base,0,'reactor')[0];reactor.hp=0;base.navVersion++;
assert(powerStats(base,0).ratio<1,'Power loss affects production');
assert.equal(trainUnit({...base,status:'victory'},0,'rifle').ok,false);

// Orders route around a blocking wall and existing buildings, and expose explored terrain.
const travel=quiet('path'),scout=entities(travel,0,'scout')[0];
scout.x=15.5;scout.y=33;
travel.terrain.fill(0);travel.minerals.fill(0);
for(let y=0;y<47;y++)travel.terrain[y*travel.width+28]=1;
travel.navVersion++;issueOrder(travel,[scout.id],{type:'move',x:38.5,y:36.5});
advance(travel,40);
assert(Math.hypot(scout.x-38.5,scout.y-36.5)<1.2,'A* must route through distant wall opening');
assert.equal(travel.explored[0][48*travel.width+29],1,'Scouting reveals the traveled route');
assert.equal(travel.visible[0][48*travel.width+29],0,'Fog returns behind the scout');
stopUnits(travel,[scout.id]);assert.equal(scout.order.type,'idle');

// Enemy does not aim at concealed entities. Its knowledge grows only after scouting.
const fog=quiet('fog'),playerScout=entities(fog,0,'scout')[0],enemyRifle=entities(fog,1,'rifle')[0];
issueOrder(fog,[enemyRifle.id],{type:'attack',targetId:playerScout.id});
assert.equal(enemyRifle.order.targetId,undefined,'Hidden targets cannot be attached to commands');
assert.equal(Object.keys(fog.ai.known).length,0);

// Procedural maps retain a route between starting armies for a sample of seeds.
for(let seed=0;seed<12;seed++){
  const s=quiet(`route-${seed}`),a=entities(s,0,'scout')[0],b=entities(s,1,'scout')[0];
  const start=Math.floor(a.y)*s.width+Math.floor(a.x),goal=Math.floor(b.y)*s.width+Math.floor(b.x);
  const reached=new Uint8Array(s.width*s.height),queue=[start];reached[start]=1;
  for(let h=0;h<queue.length;h++)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const at=queue[h],x=at%s.width+dx,y=Math.floor(at/s.width)+dy,next=y*s.width+x;if(x<0||y<0||x>=s.width||y>=s.height||reached[next]||s.blocked[next])continue;reached[next]=1;queue.push(next);}
  assert(reached[goal],`Both bases must connect for seed ${seed}`);
}

// Full unattended skirmish exercises AI construction, economics, scouting, raids and victory state.
const battle=createGame('smoke','normal'),battleCore=entities(battle,0,'core')[0];advance(battle,360);
assert(battle.ai.raid>=1,'AI must launch a raid');
assert(battle.entities.some(e=>e.team===1&&e.type==='factory'),'AI must reach armor production');
assert(battle.teams[1].kills>0,'AI must engage player forces');
assert.equal(battle.status,'defeat','Unopposed AI must finish the operation');
assert(Object.keys(battle.ai.known).length>0,'AI must scout before attacking');
assert.equal(battle.explored[1][(battleCore.y+1)*battle.width+battleCore.x+1],1,'AI scouting reaches the player base across the expanded map');
assert(Object.values(UNITS).every(d=>d.cost>0&&d.trainTime>0));

// A capable player can win against the enabled AI using only public, paid commands.
const victory=createGame('player-victory','normal');
const home=entities(victory,0,'core')[0],enemy=entities(victory,1,'core')[0],enemyDestination={x:enemy.x+enemy.size/2,y:enemy.y+enemy.size/2};
const player=type=>victory.entities.filter(e=>e.team===0&&(!type||e.type===type));
const waiting=type=>player().reduce((sum,e)=>sum+(e.queue?.filter(q=>q.type===type).length||0),0);
function expand(type){
  let best;
  for(let y=home.y-12;y<home.y+11;y++)for(let x=home.x-6;x<home.x+20;x++)if(canPlace(victory,0,type,x,y).ok){const score=Math.hypot(x-home.x-8,y-home.y+3);if(!best||score<best.score)best={x,y,score};}
  if(best)placeBuilding(victory,0,type,best.x,best.y);
}
let advanced=false;
for(let tick=0;tick<6000&&victory.status==='playing';tick++){
  if(tick%20===0){
    if(!player().some(e=>e.kind==='building'&&e.progress<1)){
      if(!player('barracks').length)expand('barracks');
      else if(!player('factory').length)expand('factory');
      else if(player('reactor').length<2)expand('reactor');
      else if(player('factory').length<2&&victory.teams[0].credits>1000)expand('factory');
      else if(player('turret').length<2&&victory.time>80)expand('turret');
      else if(player('reactor').length<3&&player('turret').length>=2)expand('reactor');
    }
    if(player('harvester').length+waiting('harvester')<3)trainUnit(victory,0,'harvester');
    // Rifle/rover escorts screen armor against enemy rocket infantry.
    if(victory.teams[0].credits>450&&player('barracks').some(e=>e.progress>=1)){
      const escort=player('rifle').length+waiting('rifle')<7?'rifle':'scout';
      if(escort==='rifle'||player('scout').length+waiting('scout')<3)trainUnit(victory,0,escort);
    }
    if(player('factory').some(e=>e.progress>=1)){
      const type=player('tank').length>=3&&player('artillery').length+waiting('artillery')<Math.floor(player('tank').length/3)?'artillery':'tank';
      if(waiting(type)<2)trainUnit(victory,0,type);
    }
    // Staging and advancing into a map quadrant requires no knowledge of concealed entities.
    const destination=victory.time<150?{x:home.x+15,y:home.y-5}:enemyDestination;
    for(const u of player().filter(e=>e.kind==='unit'&&e.type!=='harvester'))if(u.order.type==='idle'||victory.time>=150&&!advanced)issueOrder(victory,[u.id],{type:'attackMove',...destination});
    if(victory.time>=150)advanced=true;
  }
  updateGame(victory,.1);
  if(tick%10===0)for(const e of victory.entities){
    assert(Number.isFinite(e.x+e.y+e.hp),'Entity state must remain finite');
    if(e.kind==='unit')assert.equal(victory.blocked[Math.floor(e.y)*victory.width+Math.floor(e.x)],0,'Units must remain outside terrain/building blockers');
  }
  assert(victory.teams.every(t=>t.credits>=0),'Production must never overdraw credits');
}
assert.equal(victory.status,'victory','A paid, balanced player army must be able to defeat the active AI');
assert(victory.ai.raid>0&&victory.teams[1].kills>0,'The victory regression must include an active adversary');
console.log(`Ashline simulation checks passed: maps, fog, paths, production, power, harvesting/recovery, AI defeat, and public-command player victory (${victory.time.toFixed(1)}s).`);
