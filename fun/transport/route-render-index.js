// Route paths are immutable between replans. Index runs of segment numbers by
// spatial cell; a continent-long straight route needs only one run per cell.
// Queries return original path order, preserving disconnected strokes and dashes.
export function createRouteRenderIndex(path, cellSize=32) {
  const cells=new Map();let storedRuns=0;
  function add(x,y,index){
    const key=`${x},${y}`;let runs=cells.get(key);
    if(!runs){runs=[];cells.set(key,runs);}
    if(runs.length&&runs[runs.length-1]===index-1)runs[runs.length-1]=index;
    else if(!runs.length||runs[runs.length-1]!==index){runs.push(index,index);storedRuns++;}
  }
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],x0=Math.floor(Math.min(a.x,b.x)/cellSize),y0=Math.floor(Math.min(a.y,b.y)/cellSize),x1=Math.floor(Math.max(a.x,b.x)/cellSize),y1=Math.floor(Math.max(a.y,b.y)/cellSize);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)add(x,y,i);
  }
  for(const[key,runs]of cells)cells.set(key,Uint32Array.from(runs));
  return {
    bytes:storedRuns*8,
    cells:cells.size,
    query({x0,y0,x1,y1}){
      const found=[];
      for(let y=Math.floor(y0/cellSize);y<=Math.floor((y1-1)/cellSize);y++)for(let x=Math.floor(x0/cellSize);x<=Math.floor((x1-1)/cellSize);x++){
        const runs=cells.get(`${x},${y}`);if(runs)for(let i=0;i<runs.length;i+=2)found.push([runs[i],runs[i+1]]);
      }
      found.sort((a,b)=>a[0]-b[0]);const ranges=[];
      for(const run of found){const last=ranges[ranges.length-1];if(last&&run[0]<=last[1]+1)last[1]=Math.max(last[1],run[1]);else ranges.push(run);}
      return ranges;
    }
  };
}
