// Local Reynolds Boids rules, layered over the static navigation route.
// https://www.red3d.com/cwr/boids/
const RADIUS=4, COMFORT=.2, COHESION_DISTANCE=2.4;
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const bucketKey=(x,y)=>(y+64)*65536+x+64;
// Squared lengths settle every comparison that is not within rounding of the limit, so Math.hypot
// (about ten times the cost) only runs for the rare borderline pair and the answer is unchanged.
const NEAR=RADIUS*RADIUS*(1-1e-5),FAR=RADIUS*RADIUS*(1+1e-5),FAR_GOAL=6*6*(1+1e-5),NEAR_GOAL=6*6*(1-1e-5);

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
      formation:commanded&&goal&&e.order.formation?{...e.order.formation}:null,
      // Distance from the body to its own goal, read by every neighbour that weighs this body's heading.
      goalDistance:goal?Math.hypot(goal.x-e.x,goal.y-e.y):0};
    const key=bucketKey(Math.floor(e.x/RADIUS),Math.floor(e.y/RADIUS));
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(u);
  }
  const neighborhoods=new Map();
  return u=>{
    const cx=Math.floor(u.x/RADIUS),cy=Math.floor(u.y/RADIUS),key=bucketKey(cx,cy);
    let candidates=neighborhoods.get(key);
    if(!candidates){
      candidates=[];
      for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++){const bucket=buckets.get(bucketKey(x,y));if(bucket)for(const other of bucket)candidates.push(other);}
      candidates.sort((a,b)=>a.id-b.id);neighborhoods.set(key,candidates);
    }
    // The snapshot cannot move during a tick. Share its sorted bucket candidates,
    // but still test each caller's exact current position against the Boids radius.
    const near=[];
    for(let i=0;i<candidates.length;i++){
      const other=candidates[i];
      if(other.id===u.id)continue;
      const dx=other.x-u.x,dy=other.y-u.y,q=dx*dx+dy*dy;
      if(q<NEAR||q<FAR&&Math.hypot(dx,dy)<RADIUS)near.push(other);
    }
    return near;
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
    let goalGap;
    const personal=sameFormation?Math.max(spacing,Math.min(spacing+COMFORT,goalGap=Math.hypot(other.goal.x-goal.x,other.goal.y-goal.y))):spacing+COMFORT;
    // Correct only the missing clearance, rather than holding a large normalized
    // repulsion for an entire leg and overshooting into a new cohesion correction.
    if(range<personal){
      const deficit=personal-range;
      separation+=range>.001?-side/range*deficit:(u.id<other.id?1:-1)*personal;
      if(forward>0&&Math.abs(side)<spacing*.5)separation+=deficit;
      pressure=Math.max(pressure,deficit);
    }
    if(other.team!==u.team||!other.goal)continue;
    if(goalGap!==undefined){if(goalGap>6)continue;}
    else{const hx=other.goal.x-goal.x,hy=other.goal.y-goal.y,q=hx*hx+hy*hy;if(q>FAR_GOAL||q>NEAR_GOAL&&Math.hypot(hx,hy)>6)continue;}
    const gx=other.goal.x-other.x,gy=other.goal.y-other.y,gd=other.goalDistance??Math.hypot(gx,gy);
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
