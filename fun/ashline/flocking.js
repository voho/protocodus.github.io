// Local Reynolds Boids rules, layered over the static navigation route.
// https://www.red3d.com/cwr/boids/
const RADIUS=4, COMFORT=.2, COHESION_DISTANCE=2.4;
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));

// Read one immutable neighborhood per simulation tick, independent of update order.
// The grid is derived state; path legs and movement speed already survive save/load.
export function createFlockSnapshot(entities){
  const buckets=new Map();
  for(const e of entities){
    if(e.kind!=='unit'||e.hp<=0)continue;
    const commanded=['move','attackMove'].includes(e.order.type);
    const active=e.order.type!=='idle'&&!e.yieldReturn&&!e.repairActive&&(!e.targetId||e.moving)&&(commanded||e.moving||e.path.length>0);
    const goal=active?(commanded?e.order:e.pathGoal):null;
    const speed=e.moving?(e.moveSpeed||0):0;
    const u={id:e.id,team:e.team,x:e.x,y:e.y,size:e.size,
      vx:Math.cos(e.angle)*speed,vy:Math.sin(e.angle)*speed,goal:goal?{x:goal.x,y:goal.y}:null,
      formation:commanded&&goal&&e.order.formation?{...e.order.formation}:null};
    const key=`${Math.floor(e.x/RADIUS)},${Math.floor(e.y/RADIUS)}`;
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(u);
  }
  return u=>{
    const neighbors=[],cx=Math.floor(u.x/RADIUS),cy=Math.floor(u.y/RADIUS);
    for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++)for(const other of buckets.get(`${x},${y}`)||[]){
      if(other.id!==u.id&&Math.hypot(other.x-u.x,other.y-u.y)<RADIUS)neighbors.push(other);
    }
    return neighbors.sort((a,b)=>a.id-b.id);
  };
}

export function flockSteering(u,goal,neighbors,time,route=goal){
  const dx=route.x-u.x,dy=route.y-u.y,d=Math.hypot(dx,dy);
  if(d<1e-6)return null;
  const fx=dx/d,fy=dy/d;
  let separation=0,alignment=0,cx=0,cy=0,pressure=0,flockmates=0,headings=0;
  for(const other of neighbors){
    const ox=other.x-u.x,oy=other.y-u.y,range=Math.hypot(ox,oy);
    if(other.id===u.id||range>=RADIUS)continue;
    const side=oy*fx-ox*fy,forward=ox*fx+oy*fy;
    const formation=['move','attackMove'].includes(u.order?.type)?u.order.formation:null;
    const sameFormation=formation&&other.formation&&formation.x===other.formation.x&&formation.y===other.formation.y;
    const spacing=(u.size+other.size)*.43;
    // Respect the selected formation's spacing rather than expanding safe,
    // tightly packed ranks solely to satisfy the free-roaming comfort margin.
    const personal=sameFormation?Math.max(spacing,Math.min(spacing+COMFORT,Math.hypot(other.goal.x-goal.x,other.goal.y-goal.y))):spacing+COMFORT;
    // Correct only the missing clearance, rather than holding a large normalized
    // repulsion for an entire leg and overshooting into a new cohesion correction.
    if(range<personal){
      const deficit=personal-range;
      separation+=range>.001?-side/range*deficit:(u.id<other.id?1:-1)*personal;
      if(forward>0&&Math.abs(side)<spacing*.5)separation+=deficit;
      pressure=Math.max(pressure,deficit);
    }
    if(other.team!==u.team||!other.goal||Math.hypot(other.goal.x-goal.x,other.goal.y-goal.y)>6)continue;
    const gx=other.goal.x-other.x,gy=other.goal.y-other.y,gd=Math.hypot(gx,gy);
    if(gd<1||gx*fx+gy*fy<gd*.5)continue;
    // Cohesion within a commanded formation compares progress toward each slot.
    // Translating an intact formation needs no pull toward its physical center.
    cx+=sameFormation?ox-(other.goal.x-goal.x):ox;
    cy+=sameFormation?oy-(other.goal.y-goal.y):oy;flockmates++;
    const speed=Math.hypot(other.vx,other.vy);
    if(speed>.05){alignment+=(other.vy*fx-other.vx*fy)/speed;headings++;}
  }
  const arrival=clamp((Math.hypot(goal.x-u.x,goal.y-u.y)-1.2)/2.8,0,1);
  // Separation keeps priority and remains active at arrival. The smaller herd
  // terms have a deadband so vehicles don't chase tiny fluctuations.
  const centerDistance=flockmates?Math.hypot(cx,cy)/flockmates:0;
  const cohesion=centerDistance>COHESION_DISTANCE?(cy*fx-cx*fy)/flockmates*(1-COHESION_DISTANCE/centerDistance)*.35:0;
  const herd=arrival*((headings?alignment/headings*.3:0)+cohesion);
  const offset=clamp(pressure>.02?separation:herd,-.45,.45);
  if(Math.abs(offset)<.08)return null;
  const ahead=Math.min(2.4,d),length=Math.hypot(ahead,offset);
  return{x:(fx*ahead-fy*offset)/length,y:(fy*ahead+fx*offset)/length,length};
}
