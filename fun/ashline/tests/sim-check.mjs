import assert from 'node:assert/strict';
import {BUILDINGS,UNITS,createGame,updateGame,canPlace,placeBuilding,trainUnit,issueOrder,stopUnits,powerStats,getEntity} from '../sim.js';

const advance=(s,seconds)=>{for(let i=0;i<Math.ceil(seconds/.1);i++)updateGame(s,.1);};
const quiet=seed=>{const s=createGame(seed);s.ai.nextThink=Infinity;return s;};
const entities=(s,team,type)=>s.entities.filter(e=>e.team===team&&e.type===type);
const available=(s,type)=>{for(let y=20;y<50;y++)for(let x=1;x<32;x++)if(canPlace(s,0,type,x,y).ok)return{x,y};throw Error(`No placement for ${type}`);};

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
for(const [x,y] of [[16,43],[18,43],[17,42],[17,44]])prospect.terrain[y*prospect.width+x]=1;
const isolated=43*prospect.width+17,reachable=42*prospect.width+22;
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
const battle=createGame('smoke','normal');advance(battle,360);
assert(battle.ai.raid>=1,'AI must launch a raid');
assert(battle.entities.some(e=>e.team===1&&e.type==='factory'),'AI must reach armor production');
assert(battle.teams[1].kills>0,'AI must engage player forces');
assert.equal(battle.status,'defeat','Unopposed AI must finish the operation');
assert(Object.keys(battle.ai.known).length>0,'AI must scout before attacking');
assert(Object.values(UNITS).every(d=>d.cost>0&&d.trainTime>0));

// A capable player can win against the enabled AI using only public, paid commands.
const victory=createGame('player-victory','normal');
const player=type=>victory.entities.filter(e=>e.team===0&&(!type||e.type===type));
const waiting=type=>player().reduce((sum,e)=>sum+(e.queue?.filter(q=>q.type===type).length||0),0);
function expand(type){
  let best;
  for(let y=23;y<46;y++)for(let x=4;x<30;x++)if(canPlace(victory,0,type,x,y).ok){const score=Math.hypot(x-18,y-32);if(!best||score<best.score)best={x,y,score};}
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
    if(player('factory').some(e=>e.progress>=1)){
      const type=player('tank').length>=3&&player('artillery').length+waiting('artillery')<Math.floor(player('tank').length/3)?'artillery':'tank';
      if(waiting(type)<2)trainUnit(victory,0,type);
    }
    // Staging and advancing into a map quadrant requires no knowledge of concealed entities.
    const destination=victory.time<150?{x:25,y:30}:{x:58.5,y:11.5};
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
