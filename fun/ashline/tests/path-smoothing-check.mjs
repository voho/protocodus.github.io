import assert from 'node:assert/strict';
import {UNITS,createGame,issueOrder,updateGame} from '../sim.js';
import {encodeGame,decodeGame} from '../save.js';

const dt=.05,distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const turn=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
function scene(type='tank',start={x:20.31,y:20.67}){
  const s=createGame('path-smoothing');s.ai.nextThink=1e12;s.terrain.fill(0);s.minerals.fill(0);
  const refinery=structuredClone(s.entities.find(e=>e.type==='refinery'&&e.team===0));refinery.haulerPending=false;
  const u=structuredClone(s.entities.find(e=>e.type===(type==='harvester'?type:'rifle'))),d=UNITS[type];
  Object.assign(u,{type,size:d.size,hp:d.hp,maxHp:d.hp,...start,order:{type:'idle'},path:[]});
  s.entities=[u];s.navVersion++;return{s,u,refinery};
}
function move(s,u,goal){issueOrder(s,[u.id],{type:'move',...goal});return{x:u.order.x,y:u.order.y};}
function advance(s,u){
  const before={x:u.x,y:u.y,angle:u.angle};updateGame(s,dt);
  // Check the complete swept footprint, including diagonal corners, using the existing static radius.
  const segments=Math.max(1,Math.ceil(distance(before,u)/.08));
  for(let i=1;i<=segments;i++)for(const dx of [-.189,.189])for(const dy of [-.189,.189]){
    const x=before.x+(u.x-before.x)*i/segments+dx,y=before.y+(u.y-before.y)*i/segments+dy;
    assert(x>=0&&y>=0&&x<s.width&&y<s.height,'A smoothed segment remains in the map');
    assert.equal(s.blocked[Math.floor(y)*s.width+Math.floor(x)],0,'A smoothed segment cannot cut rock, lava or building corners');
  }
  const headingChange=turn(u.angle,before.angle);
  assert(headingChange<=Math.PI/6+1e-8,`Heading snaps by ${(headingChange*180/Math.PI).toFixed(1)} degrees in 50 ms`);
  return{length:distance(before,u),headingChange};
}
function finish(s,u,goal){
  for(let i=0;i<1600&&u.order.type==='move';i++)advance(s,u);
  assert(distance(u,goal)<=.081,`${u.type} must finish at its exact assigned destination`);
  assert.equal(u.order.type,u.type==='harvester'?'harvest':'idle');
}

// Non-compass headings stay straight instead of alternating diagonal and horizontal grid legs.
const metrics=[];
for(const type of Object.keys(UNITS))for(const goal of [{x:49.17,y:32.83},{x:8.23,y:29.91}]){
  const{s,u}=scene(type),start={x:u.x,y:u.y},straight=distance(start,goal);u.angle=Math.atan2(goal.y-u.y,goal.x-u.x);
  const assigned=move(s,u,goal);assert.deepEqual(assigned,goal,'A free fractional destination stays exact');
  let length=0,drift=0;
  for(let i=0;i<1000&&u.order.type==='move';i++){
    length+=advance(s,u).length;
    drift=Math.max(drift,Math.abs((goal.x-start.x)*(u.y-start.y)-(goal.y-start.y)*(u.x-start.x))/straight);
  }
  assert(length<=straight*1.01,`${type} takes a near-direct open route`);
  assert(drift<.08,`${type} drifts ${drift.toFixed(3)} tiles from a clear straight route`);
  finish(s,u,assigned);metrics.push({type,ratio:+(length/straight).toFixed(4),drift:+drift.toFixed(4)});
}

// Abruptly changing an order, including across the -π/π seam, turns without a one-tick snap.
for(const angle of [0,Math.PI-.02]){
  const{s,u}=scene();u.angle=angle;
  move(s,u,{x:u.x+Math.cos(angle)*12,y:u.y+Math.sin(angle)*12});
  for(let i=0;i<20;i++)advance(s,u);
  const goal=move(s,u,{x:u.x-10,y:u.y-7});finish(s,u,goal);
}

// A rounded detour must still respect three different solid obstacles and resume exactly from a save.
{
  const{s,u,refinery}=scene();refinery.x=41;refinery.y=30;s.entities.push(refinery);
  for(let y=23;y<=30;y++)s.terrain[y*s.width+29]=1;
  for(let y=26;y<=32;y++)for(let x=34;x<=37;x++)s.terrain[y*s.width+x]=3;
  const goal=move(s,u,{x:48.27,y:35.73});
  for(let i=0;i<40;i++)advance(s,u);
  const loaded=decodeGame(encodeGame(s)).game,restored=loaded.entities.find(e=>e.id===u.id);
  for(let i=0;i<1600&&u.order.type==='move';i++){
    advance(s,u);advance(loaded,restored);
    assert.deepEqual(loaded.entities,s.entities,'A saved mid-route turn resumes deterministically');
    assert.equal(loaded.rng,s.rng);
  }
  finish(s,u,goal);finish(loaded,restored,goal);
  assert.deepEqual(JSON.parse(encodeGame(loaded)).game,JSON.parse(encodeGame(s)).game);
}
console.log('Path smoothing checks passed: direct non-grid routes for every class, bounded heading changes, swept obstacle clearance, exact arrivals, and saved route continuation.',JSON.stringify(metrics));
