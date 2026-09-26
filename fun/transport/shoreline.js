import { noise } from './world-noise.js';

// Local contour filtering removes repeated quarter-circle corners. The support
// is less than two tiles, so neighboring cached chunks share identical curves.
export function shorelineContours(game, bounds, tileSize = 32) {
  const { x0, y0, x1, y1 } = bounds, stride = game.width + 1, edges = new Map();
  const water = (x,y) => x>=x0 && x<x1 && y>=y0 && y<y1 && game.tiles[y*game.width+x]?.terrain==='water';
  const edge = (ax,ay,bx,by) => {
    const key=ay*stride+ax;
    if(!edges.has(key))edges.set(key,[]);
    edges.get(key).push([bx,by]);
  };
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(water(x,y)){
    if(!water(x,y-1))edge(x,y,x+1,y);
    if(!water(x+1,y))edge(x+1,y,x+1,y+1);
    if(!water(x,y+1))edge(x+1,y+1,x,y+1);
    if(!water(x-1,y))edge(x,y+1,x,y);
  }
  const contours=[],seed=game.seed||0;
  while(edges.size){
    const first=edges.keys().next().value,raw=[[first%stride,Math.floor(first/stride)]];
    let key=first;
    do{
      const list=edges.get(key);if(!list?.length)break;
      let choice=list.length-1;
      if(list.length>1&&raw.length>1){
        const p=raw[raw.length-1],prev=raw[raw.length-2],dx=p[0]-prev[0],dy=p[1]-prev[1];
        // Diagonally touching cells retain separate banks: prefer the right
        // turn, independent of which chunk began tracing this contour.
        choice=list.reduce((best,n,i)=>dx*(n[1]-p[1])-dy*(n[0]-p[0])>dx*(list[best][1]-p[1])-dy*(list[best][0]-p[0])?i:best,0);
      }
      const [next]=list.splice(choice,1);if(!list.length)edges.delete(key);
      key=next[1]*stride+next[0];raw.push(next);
    }while(key!==first);
    if(raw.length<4)continue;
    raw.pop();
    // Tiny isolated ponds/islands retain most of their original footprint.
    const weight=raw.length<8?.1:.25;
    const points=raw.map((p,i)=>{
      const prev=raw[(i+raw.length-1)%raw.length],next=raw[(i+1)%raw.length];
      const tx=next[0]-prev[0],ty=next[1]-prev[1],length=Math.hypot(tx,ty)||1;
      const ripple=(noise(p[0],p[1],seed+2309,3.7)-.5)*3.2+(noise(p[0],p[1],seed+2333,.9)-.5)*.8;
      // At a corner the filter shifts at most a quarter tile in either axis;
      // the small normal ripple stays well clear of land/water tile centers.
      return [(p[0]+weight*(prev[0]-p[0]+next[0]-p[0]))*tileSize-ty/length*ripple,
        (p[1]+weight*(prev[1]-p[1]+next[1]-p[1]))*tileSize+tx/length*ripple];
    });
    contours.push(points);
  }
  return contours;
}

export function appendShoreline(path, contours) {
  for(const points of contours){
    const last=points[points.length-1],first=points[0];
    path.moveTo((last[0]+first[0])/2,(last[1]+first[1])/2);
    for(let i=0;i<points.length;i++){
      const p=points[i],next=points[(i+1)%points.length];
      path.quadraticCurveTo(p[0],p[1],(p[0]+next[0])/2,(p[1]+next[1])/2);
    }
    path.closePath();
  }
}
