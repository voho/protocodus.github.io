// Local Reynolds Boids rules, layered over the static navigation route.
// https://www.red3d.com/cwr/boids/
const RADIUS=4, SEPARATION=1.7, ALIGNMENT=.45, COHESION=.28;
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));

// Read one immutable neighborhood per simulation tick, independent of update order.
// The grid is derived state; path legs and movement speed already survive save/load.
export function createFlockSnapshot(entities){
  const buckets=new Map();
  for(const e of entities){
    if(e.kind!=='unit'||e.hp<=0)continue;
    const commanded=['move','attackMove'].includes(e.order.type);
    const active=e.order.type!=='idle'&&!e.repairActive&&(!e.targetId||e.moving)&&(commanded||e.moving||e.path.length>0);
    const goal=active?(commanded?e.order:e.pathGoal):null;
    const speed=e.moving?(e.moveSpeed||0):0;
    const u={id:e.id,team:e.team,x:e.x,y:e.y,size:e.size,passUntil:e.passUntil,
      vx:Math.cos(e.angle)*speed,vy:Math.sin(e.angle)*speed,goal:goal?{x:goal.x,y:goal.y}:null};
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
  let sx=0,sy=0,ax=0,ay=0,cx=0,cy=0,flockmates=0,headings=0;
  for(const other of neighbors){
    const ox=other.x-u.x,oy=other.y-u.y,range=Math.hypot(ox,oy);
    if(other.id===u.id||range>=RADIUS)continue;
    // Separation includes stationary allies and hostile bodies; passing only softens allies.
    const spacing=(u.size+other.size)*.43,personal=spacing+.8;
    if(range<personal&&!(other.team===u.team&&Math.max(u.passUntil||0,other.passUntil||0)>time)){
      const weight=(personal-range)/personal;
      if(range>.001){sx-=ox/range*weight;sy-=oy/range*weight;}
      else {const side=u.id<other.id?1:-1;sx-=fy*side;sy+=fx*side;}
      // A directly opposing repulsion would only brake. Choose the same right-hand
      // passing convention in each unit's local frame to break head-on symmetry.
      if(ox*fx+oy*fy>0&&Math.abs(ox*fy-oy*fx)<spacing*.5){sx-=fy*weight;sy+=fx*weight;}
    }
    // Only allies traveling toward nearby goals form a herd. Guards, cross traffic,
    // and enemies still cause separation without pulling a unit off its own orders.
    if(other.team!==u.team||!other.goal||Math.hypot(other.goal.x-goal.x,other.goal.y-goal.y)>6)continue;
    const gx=other.goal.x-other.x,gy=other.goal.y-other.y,gd=Math.hypot(gx,gy);
    if(gd<1||gx*fx+gy*fy<gd*.5)continue;
    cx+=ox;cy+=oy;flockmates++;
    const speed=Math.hypot(other.vx,other.vy);
    if(speed>.05){ax+=other.vx/speed;ay+=other.vy/speed;headings++;}
  }
  const separationLength=Math.hypot(sx,sy);
  if(separationLength>1){sx/=separationLength;sy/=separationLength;}
  if(headings){ax=ax/headings-fx;ay=ay/headings-fy;}
  if(flockmates){cx/=flockmates*RADIUS;cy/=flockmates*RADIUS;}
  // Fade the herd near a destination so reserved formation slots remain exact.
  const arrival=clamp((Math.hypot(goal.x-u.x,goal.y-u.y)-1.2)/2.8,0,1);
  const x=fx+arrival*(sx*SEPARATION+ax*ALIGNMENT+cx*COHESION);
  const y=fy+arrival*(sy*SEPARATION+ay*ALIGNMENT+cy*COHESION);
  // Forward progress wins over the flock; limit steering to a short local detour.
  const forward=Math.max(.5,x*fx+y*fy),side=clamp(y*fx-x*fy,-.8,.8);
  if(Math.abs(side)<.035)return null;
  const length=Math.hypot(forward,side);
  return{x:(fx*forward-fy*side)/length,y:(fy*forward+fx*side)/length};
}
