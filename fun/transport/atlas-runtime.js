// Shared generated artwork registry. Loading never mutates simulation state.
const atlases=new Map(),entries=new Map(),listeners=new Set(),draws=new Map(),LEVELS=[16,32,64,128,256];
let revision=0,loading=0,unpublished=false,quiet=0,latest=0;
export function registerAtlas({id,path,columns=3,rows=3,entries:ids,maxCell=128,biome=null}){
  if(atlases.has(id))return;
  const atlas={id,path,columns,rows,ids,maxCell,biome,levels:new Map(),orderedLevels:[],failures:new Map(),status:'idle',error:null,pending:new Map(),awaited:new Set()};
  atlases.set(id,atlas);
  ids.forEach((key,index)=>{if(key)entries.set(key,{atlas,index});});
}
export const worldArtRevision=()=>revision;
export const onWorldArtChange=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export const atlasAvailable=id=>Boolean(entries.get(id)?.atlas.levels.size);
export function worldArtStats(){return{revision,registered:entries.size,ready:[...atlases.values()].filter(a=>a.status==='ready').length,usable:[...atlases.values()].filter(a=>a.levels.size).length,atlases:atlases.size,errors:[...atlases.values()].filter(a=>a.error).map(a=>({id:a.id,error:a.error})),loading,rasterizedEntries:Object.fromEntries(draws),decodedBytes:[...atlases.values()].reduce((n,a)=>n+[...a.levels.values()].reduce((s,i)=>s+i.naturalWidth*i.naturalHeight*4,0),0)};}
// The densities a view at this display scale draws at once. Sharper cells, and every 256 cell, load when a draw asks for them.
export const startupArtCells=(scale=globalThis.devicePixelRatio||1)=>LEVELS.filter(n=>n<=(scale>=1.5?128:64));
// Changes publish together: 150 ms after the last one, at most 500 ms after the first, and at once when nothing is loading.
// Each publication rebuilds the map caches, so it happens once per batch rather than once per image.
function publish(){clearTimeout(quiet);clearTimeout(latest);quiet=latest=0;if(!unpublished)return;unpublished=false;revision++;for(const fn of listeners)queueMicrotask(fn);}
function changed(){unpublished=true;clearTimeout(quiet);quiet=setTimeout(publish,150);latest||=setTimeout(publish,500);}
function settle(atlas){
  atlas.error=atlas.failures.size?[...atlas.failures].map(([cell,message])=>`${cell}px: ${message}`).join('; '):null;
  atlas.status=atlas.pending.size?'loading':atlas.failures.size?atlas.levels.size?'partial':'failed':'ready';
}
function loadAtlasCell(atlas,cell,retry=false){
  if(atlas.pending.has(cell))return atlas.pending.get(cell);
  if(atlas.levels.has(cell)||atlas.failures.has(cell)&&!retry||typeof Image==='undefined')return Promise.resolve();
  loading++;atlas.status='loading';
  const task=(async()=>{
    try{
    const image=new Image();image.decoding='async';
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Artwork unavailable'));image.src=new URL(`${atlas.path}-${cell}.png`,import.meta.url).href;});
    if(image.decode)await image.decode();
    if(image.naturalWidth!==atlas.columns*cell||image.naturalHeight!==atlas.rows*cell)throw new Error('Unexpected atlas dimensions');
    // One missing density must not force old procedural artwork when other authored densities decoded successfully.
    // Only an atlas's first art, or a density some draw stood in for, changes drawn pixels and joins the next publication.
    atlas.levels.set(cell,image);atlas.orderedLevels=[...atlas.levels.keys()].sort((a,b)=>a-b);atlas.failures.delete(cell);if(atlas.awaited.delete(cell)||atlas.levels.size===1)changed();
    }catch(error){atlas.failures.set(cell,error.message);if(atlas.awaited.delete(cell))changed();}
  })().finally(()=>{atlas.pending.delete(cell);settle(atlas);if(!--loading)publish();});
  atlas.pending.set(cell,task);return task;
}
// Requests go out density by density, so a slow network gives every atlas usable art before any gets sharper levels.
// A retry also fetches every density that failed before.
function loadAtlases(list,{cells=LEVELS,retry=false}={}){
  return Promise.all(LEVELS.flatMap(cell=>list.filter(atlas=>cell<=atlas.maxCell&&(cells.includes(cell)||retry&&atlas.failures.has(cell))).map(atlas=>loadAtlasCell(atlas,cell,retry))));
}
export async function preloadWorldArt({waitMs=4000,retry=false,biome=null,cells=LEVELS}={}){
  if(typeof Image==='undefined')return false;
  const pending=loadAtlases([...atlases.values()].filter(atlas=>!biome||!atlas.biome||atlas.biome===biome),{cells,retry});
  if(waitMs<=0)return false;
  // The first frame after a bounded wait gets every density decoded so far.
  let timer;await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);clearTimeout(timer);publish();
  return [...atlases.values()].some(a=>a.levels.size);
}
export function drawAtlas(c,id,x,y,w,h,{pixelScale=1,flipX=false}={}){
  const entry=entries.get(id);if(!entry)return false;
  const {atlas,index}=entry,needed=Math.max(w,h)*pixelScale,ideal=LEVELS.find(n=>n>=needed&&n<=atlas.maxCell)??atlas.maxCell;
  // Fetch the level an eager load would draw, or its nearest healthy neighbour when that failed.
  // The best loaded level stands in, and the draw awaits a republish when either arrives.
  if(!atlas.levels.has(ideal)){
    const wanted=atlas.failures.has(ideal)?LEVELS.find(n=>n>ideal&&n<=atlas.maxCell&&!atlas.failures.has(n))??LEVELS.findLast(n=>n<ideal&&!atlas.failures.has(n)):ideal;
    atlas.awaited.add(ideal);if(wanted&&!atlas.levels.has(wanted)){atlas.awaited.add(wanted);void loadAtlasCell(atlas,wanted);}
  }
  if(!atlas.levels.size)return false;
  const levels=atlas.orderedLevels,cell=levels.find(n=>n>=needed)||levels.at(-1),image=atlas.levels.get(cell);
  c.save();c.imageSmoothingEnabled=needed!==cell;c.imageSmoothingQuality='high';
  if(flipX){c.translate(x+w,y);c.scale(-1,1);x=y=0;}
  c.drawImage(image,index%atlas.columns*cell,Math.floor(index/atlas.columns)*cell,cell,cell,x,y,w,h);c.restore();draws.set(id,(draws.get(id)||0)+1);return true;
}
