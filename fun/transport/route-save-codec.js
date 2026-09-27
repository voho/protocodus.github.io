// Long cardinal journeys contain many repeated directions. Save their exact
// geometry as runs instead of thousands of {x,y} objects; no routing decisions
// change when the company is opened again. Nonstandard point data stays JSON.
const FORMAT = 'cardinal-runs-v1';
const DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1]];
export const MAX_SAVED_ROUTE_POINTS = 16 * 1024 * 1024;

function packPath(path) {
  if (!Array.isArray(path) || path.length < 64) return path;
  const runs=[]; let direction=-1,length=0;
  for(let i=0;i<path.length;i++) {
    const point=path[i];
    if (!point || Object.keys(point).length!==2 || !Number.isInteger(point.x) || !Number.isInteger(point.y)) return path;
    if (!i) continue;
    const dx=point.x-path[i-1].x,dy=point.y-path[i-1].y;
    const next=dx===1&&dy===0?0:dx===-1&&dy===0?1:dx===0&&dy===1?2:dx===0&&dy===-1?3:-1;
    if(next===-1)return path;
    if(next===direction)length++;
    else {if(length)runs.push((length-1)*4+direction);direction=next;length=1;}
  }
  runs.push((length-1)*4+direction);
  return {format:FORMAT,start:[path[0].x,path[0].y],length:path.length,runs};
}

export function packRoutePaths(state) {
  if(!Array.isArray(state.routes))return state;
  if(state.routes.reduce((sum,route)=>sum+(Array.isArray(route.path)?route.path.length:0),0)>MAX_SAVED_ROUTE_POINTS)throw new Error('The company has too many route points to save.');
  let changed=false;
  const routes=state.routes.map(route=>{
    const path=packPath(route.path);
    if(path===route.path)return route;
    changed=true;return {...route,path};
  });
  return changed?{...state,routes}:state;
}

function readPath(path,width,height,expand) {
  if(Array.isArray(path))return path;
  if(!path || path.format!==FORMAT || !Array.isArray(path.start) || path.start.length!==2 || !Array.isArray(path.runs) || !Number.isInteger(path.length) || path.length<2 || path.length>width*height || path.runs.length>path.length-1)throw new Error('Invalid saved route path.');
  let [x,y]=path.start,count=1;
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=width||y<0||y>=height)throw new Error('Invalid saved route start.');
  // Validate all run endpoints before allocating an expanded path. A straight
  // segment inside the rectangle stays inside it, so metadata checks stay tiny.
  for(const run of path.runs) {
    if(!Number.isSafeInteger(run)||run<0)throw new Error('Invalid saved route run.');
    const length=Math.floor(run/4)+1,[dx,dy]=DIRECTIONS[run%4];
    count+=length;x+=dx*length;y+=dy*length;
    if(count>path.length||x<0||x>=width||y<0||y>=height)throw new Error('Invalid saved route bounds.');
  }
  if(count!==path.length)throw new Error('Invalid saved route length.');
  if(!expand)return path;
  [x,y]=path.start;
  const points=new Array(path.length);points[0]={x,y};let cursor=1;
  for(const run of path.runs) {
    const length=Math.floor(run/4)+1,[dx,dy]=DIRECTIONS[run%4];
    for(let n=0;n<length;n++){x+=dx;y+=dy;points[cursor++]={x,y};}
  }
  return points;
}

export function readRoutePaths(state,{expand=false}={}) {
  if(!Array.isArray(state.routes))return state;
  if(state.routes.length>10000)throw new Error('Too many saved routes.');
  // Validate the whole fleet and its total allocation before expanding even
  // the first path. Tiny repeated runs must not become a decompression bomb.
  let total=0;
  for(const route of state.routes) {
    readPath(route.path,state.width,state.height,false);
    total+=route.path.length;
    if(total>MAX_SAVED_ROUTE_POINTS)throw new Error('Too many saved route points.');
  }
  if(!expand)return state;
  let changed=false;
  const routes=state.routes.map(route=>{
    const path=readPath(route.path,state.width,state.height,expand);
    if(path===route.path)return route;
    changed=true;return {...route,path};
  });
  return changed?{...state,routes}:state;
}
