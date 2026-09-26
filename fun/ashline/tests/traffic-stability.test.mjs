import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, UNITS, issueOrder, updateGame} from '../sim.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const turn=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

function scene(seed) {
  const s=createGame(seed,'normal',{width:72,height:56,aiTeams:[]});
  s.terrain.fill(0);s.minerals.fill(0);s.visible.forEach(v=>v.fill(1));
  const template=structuredClone(s.entities.find(e=>e.type==='rifle'));
  s.entities=[];s.navVersion++;
  const add=(type,x,y,angle=0)=>{
    const d=UNITS[type],u={...structuredClone(template),id:s.nextId++,type,x,y,angle,size:d.size,hp:d.hp,maxHp:d.hp};
    s.entities.push(u);return u;
  };
  return {s,add};
}

function command(s,u,x,y) {
  issueOrder(s,[u.id],{type:'move',x,y});
}

// Observe the whole trip: eventual arrival alone does not catch bodies passing
// through one another, or a straight convoy repeatedly stopping to turn.
function completeOpenTrip(s,units,seconds=80) {
  const goals=new Map(units.filter(u=>u.order.type==='move').map(u=>[u.id,{x:u.order.x,y:u.order.y}]));
  const starts=units.map(u=>({x:u.x,y:u.y}));
  const turnPhases=units.map(()=>0),turning=units.map(()=>false),lateral=units.map(()=>0);
  for(let tick=0;tick<seconds/.05;tick++) {
    const before=units.map(u=>({x:u.x,y:u.y,angle:u.angle}));
    updateGame(s,.05);
    units.forEach((u,i)=>{
      const rotation=turn(before[i].angle,u.angle),rotated=rotation>1e-8;
      const d=UNITS[u.type],rate=d.armor==='infantry'?7:['scout','striker'].includes(d.role)?2.6:1.8;
      assert(rotation<=rate*.05+1e-8,'Traffic steering stays within the body turn rate');
      const dx=u.x-before[i].x,dy=u.y-before[i].y,fx=Math.cos(u.angle),fy=Math.sin(u.angle);
      assert(Math.abs(dx*fy-dy*fx)<=1e-8&&dx*fx+dy*fy>=-1e-8,'Traffic travels along its current body heading while curving');
      if(rotated&&!turning[i])turnPhases[i]++;
      turning[i]=rotated;
      lateral[i]=Math.max(lateral[i],Math.abs(u.y-starts[i].y));
      assert(!(u.passUntil>s.time),'Open ground traffic must use room to pass instead of disabling body spacing');
      for(let j=0;j<i;j++) {
        const spacing=(u.size+units[j].size)*.43;
        assert(distance(u,units[j])>=spacing-.01,`Units ${j} and ${i} overlap at ${s.time.toFixed(2)} seconds`);
      }
    });
    if(units.every(u=>u.order.type==='idle'))break;
  }
  units.forEach(u=>{
    assert.equal(u.order.type,'idle',`Unit ${u.id} must arrive within ${seconds} seconds`);
    if(goals.has(u.id))assert(distance(u,goals.get(u.id))<=.081,'Each unit reaches its own reserved destination');
  });
  return {turnPhases,lateral};
}

test('safe parallel tanks hold their lanes without repeated flock turns',()=>{
  const {s,add}=scene('steady-parallel'),a=add('tank',20,25),b=add('tank',20,25.9);
  command(s,a,50,25);command(s,b,50,25.9);
  const {turnPhases,lateral}=completeOpenTrip(s,[a,b]);
  turnPhases.forEach(count=>assert(count<=6,`A straight open route needs few turns, received ${count}`));
  lateral.forEach(deviation=>assert(deviation<.4,`A safe parallel lane should stay stable, drifted ${deviation.toFixed(2)} tiles`));
});

test('perpendicular friendly traffic yields or routes around without intersecting',()=>{
  const {s,add}=scene('crossing-traffic'),a=add('tank',20,25),b=add('tank',29,16,Math.PI/2);
  command(s,a,38,25);command(s,b,29,34);
  completeOpenTrip(s,[a,b]);
});

test('a moving tank drives around a parked ally on open ground',()=>{
  const {s,add}=scene('parked-traffic'),a=add('tank',20,25),parked=add('tank',28,25);
  command(s,a,38,25);
  completeOpenTrip(s,[a,parked]);
  assert.deepEqual({x:parked.x,y:parked.y},{x:28,y:25},'An idle ally holds its position while traffic passes');
});

for(const side of [3,5])test(`${side*side} tanks cross open ground and settle without overlapping`,()=>{
  const {s,add}=scene(`open-formation-${side}`),units=[];
  for(let y=0;y<side;y++)for(let x=0;x<side;x++)units.push(add('tank',20+x*1.3,22+y*1.3));
  issueOrder(s,units.map(u=>u.id),{type:'move',x:50,y:25});
  completeOpenTrip(s,units);
});

test('a faster rear vehicle follows or passes a slower convoy without intersecting',()=>{
  const {s,add}=scene('mixed-speed-convoy'),rear=add('scout',20,25),front=add('tank',23,25);
  command(s,rear,50,25);command(s,front,53,25);
  completeOpenTrip(s,[rear,front]);
});

for(const side of [3,5])test(`${side*side}-unit destination assignment preserves formation ranks and repeated slots`,()=>{
  const {s,add}=scene(`formation-assignment-${side}`),rows=[];
  for(let y=0;y<side;y++){
    const row=[];
    for(let x=0;x<side;x++)row.push(add('tank',20+x*1.3,22+y*1.3));
    rows.push(row);
  }
  const units=rows.flat();
  issueOrder(s,units.map(u=>u.id),{type:'move',x:50,y:25});
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    if(x)assert(rows[y][x].order.x>=rows[y][x-1].order.x,'A rear tank must not be sent past the tank directly ahead');
    if(y)assert(rows[y][x].order.y>=rows[y-1][x].order.y,'Parallel rows must not be assigned across one another');
  }
  const goals=units.map(u=>({...u.order}));
  // Units can change relative positions while traveling. Repeating the command
  // must preserve their reserved slots instead of optimizing the assignment again.
  units.forEach((u,i)=>{u.x=30+(units.length-i)*.1;u.y=25+(i%side)*.8;});
  issueOrder(s,units.map(u=>u.id).reverse(),{type:'move',x:50,y:25});
  assert.deepEqual(units.map(u=>u.order),goals,'Reissued destinations remain stable even if unit ranks change en route');
});
