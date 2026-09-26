// Bounded local recovery when a stopped unit must back out of a crowded lane.
// Ordinary travel and flocking stay in the main navigator; this search is only
// for finding a few clear straight legs around nearby unit bodies.
const GRID=.5,RADIUS=5,SIDE=RADIUS*2/GRID+1,COUNT=SIDE*SIDE;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

export function findTrafficDetour(unit,goal,neighbors,clearStatic){
  const start={x:unit.x,y:unit.y},initial=distance(start,goal);
  if(initial<.08)return null;
  const bodies=neighbors.filter(other=>other.id!==unit.id&&other.hp!==0)
    .map(other=>({x:other.x,y:other.y,r:(unit.size+other.size)*.43+.02}));
  const clear=(a,b)=>{
    const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),top=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y);
    for(const body of bodies){
      // Most bodies in the local crowd are nowhere near this half-tile edge.
      // Reject their expanded bounds before doing the swept-circle calculation.
      if(body.x+body.r<left||body.x-body.r>right||body.y+body.r<top||body.y-body.r>bottom)continue;
      const ax=body.x-a.x,ay=body.y-a.y,from=Math.hypot(ax,ay);
      const t=length2?Math.max(0,Math.min(1,(ax*dx+ay*dy)/length2)):0;
      // Existing overlap may only improve: never cross another body's center
      // on the way out, even when the endpoint itself would be farther away.
      const minimum=Math.min(body.r,from);
      if(Math.hypot(ax-dx*t,ay-dy*t)<minimum-1e-8)return false;
    }
    return clearStatic(a,b);
  };
  const point=index=>({x:start.x+(index%SIDE-RADIUS/GRID)*GRID,y:start.y+(Math.floor(index/SIDE)-RADIUS/GRID)*GRID});
  const heuristic=p=>distance(p,goal),origin=(COUNT-1)/2;
  const costs=new Float64Array(COUNT).fill(Infinity),parents=new Int16Array(COUNT).fill(-1),closed=new Uint8Array(COUNT);
  const heap=[];
  const less=(a,b)=>a.f<b.f||a.f===b.f&&(a.h<b.h||a.h===b.h&&a.index<b.index);
  const push=(index,g,h)=>{
    const entry={index,g,h,f:g+h};let at=heap.length;heap.push(entry);
    while(at){const parent=(at-1)>>1;if(!less(entry,heap[parent]))break;heap[at]=heap[parent];at=parent;}
    heap[at]=entry;
  };
  const pop=()=>{
    const first=heap[0],last=heap.pop();
    if(heap.length){let at=0;while(at*2+1<heap.length){let next=at*2+1;if(next+1<heap.length&&less(heap[next+1],heap[next]))next++;if(!less(heap[next],last))break;heap[at]=heap[next];at=next;}heap[at]=last;}
    return first;
  };
  const route=(index,finish)=>{
    const points=[];
    for(let at=index;at!==origin&&at>=0;at=parents[at])points.push(point(at));
    points.reverse();
    if(finish&&(!points.length||distance(points.at(-1),finish)>1e-8))points.push({x:finish.x,y:finish.y});
    // Retain only needed bends. Every shortcut repeats both swept body and
    // terrain checks, preserving the same clearance as the searched edges.
    const result=[];let anchor=start;
    for(let i=0;i<points.length;){let end=points.length-1;while(end>i&&!clear(anchor,points[end]))end--;anchor=points[end];result.push(anchor);i=end+1;}
    return result.length?result:null;
  };
  const goalInside=Math.abs(goal.x-start.x)<=RADIUS&&Math.abs(goal.y-start.y)<=RADIUS;
  costs[origin]=0;push(origin,0,initial);
  let best=origin,bestScore=initial;
  while(heap.length){
    const entry=pop(),index=entry.index;
    if(closed[index]||entry.g!==costs[index])continue;
    closed[index]=1;
    const p=point(index),remaining=heuristic(p);
    if(goalInside&&clear(p,goal))return route(index,goal);
    // Outside the local window, finish only at a position that materially
    // advances the original route. A small travel penalty rejects long loops.
    const progress=initial-remaining,score=remaining+costs[index]*.05;
    if(!goalInside&&progress>=.75&&costs[index]<=progress*3+2&&score<bestScore){best=index;bestScore=score;}
    const x=index%SIDE,y=Math.floor(index/SIDE);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=SIDE||yy>=SIDE)continue;
      const next=yy*SIDE+xx;if(closed[next])continue;
      const cost=costs[index]+GRID*(dx&&dy?Math.SQRT2:1);
      if(cost>=costs[next]-1e-8)continue;
      const q=point(next);if(!clear(p,q))continue;
      costs[next]=cost;parents[next]=index;push(next,cost,heuristic(q));
    }
  }
  return best===origin?null:route(best);
}
