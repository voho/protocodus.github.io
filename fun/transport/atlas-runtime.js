// Shared generated artwork registry. Loading never mutates simulation state.
const atlases=new Map(),entries=new Map(),listeners=new Set(),draws=new Map();
let revision=0;
export function registerAtlas({id,path,columns=3,rows=3,entries:ids,maxCell=128}){
  if(atlases.has(id))return;
  const atlas={id,path,columns,rows,ids,maxCell,levels:new Map(),failures:new Map(),status:'idle',error:null,pending:null};
  atlases.set(id,atlas);
  ids.forEach((key,index)=>{if(key)entries.set(key,{atlas,index});});
}
export const worldArtRevision=()=>revision;
export const onWorldArtChange=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export const atlasAvailable=id=>Boolean(entries.get(id)?.atlas.levels.size);
export function worldArtStats(){return{revision,registered:entries.size,ready:[...atlases.values()].filter(a=>a.status==='ready').length,usable:[...atlases.values()].filter(a=>a.levels.size).length,atlases:atlases.size,errors:[...atlases.values()].filter(a=>a.error).map(a=>({id:a.id,error:a.error})),rasterizedEntries:Object.fromEntries(draws),decodedBytes:[...atlases.values()].reduce((n,a)=>n+[...a.levels.values()].reduce((s,i)=>s+i.naturalWidth*i.naturalHeight*4,0),0)};}
async function loadAtlas(atlas,{retry=false}={}){
  if(atlas.pending)return atlas.pending;
  if(atlas.status==='ready'||(!retry&&['failed','partial'].includes(atlas.status))||typeof Image==='undefined')return;
  atlas.status='loading';
  atlas.pending=Promise.allSettled([16,32,64,128,256].filter(n=>n<=atlas.maxCell&&!atlas.levels.has(n)).map(async cell=>{
    try{
    const image=new Image();image.decoding='async';
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Artwork unavailable'));image.src=new URL(`${atlas.path}-${cell}.png`,import.meta.url).href;});
    if(image.decode)await image.decode();
    if(image.naturalWidth!==atlas.columns*cell||image.naturalHeight!==atlas.rows*cell)throw new Error('Unexpected atlas dimensions');
    // Publish usable art immediately. One missing density must not force old
    // procedural artwork when other authored densities decoded successfully.
    atlas.levels.set(cell,image);atlas.failures.delete(cell);revision++;
    for(const fn of listeners)queueMicrotask(fn);
    }catch(error){atlas.failures.set(cell,error.message);}
  })).then(()=>{
    atlas.error=atlas.failures.size?[...atlas.failures].map(([cell,message])=>`${cell}px: ${message}`).join('; '):null;
    atlas.status=atlas.failures.size?atlas.levels.size?'partial':'failed':'ready';
  }).finally(()=>{atlas.pending=null;});
  return atlas.pending;
}
export async function preloadWorldArt({waitMs=4000,retry=false}={}){
  if(typeof Image==='undefined')return false;
  const pending=Promise.all([...atlases.values()].map(atlas=>loadAtlas(atlas,{retry})));
  if(waitMs<=0)return false;
  let timer;await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,waitMs);})]);clearTimeout(timer);
  return [...atlases.values()].some(a=>a.levels.size);
}
export function drawAtlas(c,id,x,y,w,h,{pixelScale=1,flipX=false}={}){
  const entry=entries.get(id);if(!entry)return false;
  const {atlas,index}=entry;if(!atlas.levels.size){void loadAtlas(atlas);return false;}
  const needed=Math.max(w,h)*pixelScale,levels=[...atlas.levels.keys()].sort((a,b)=>a-b),cell=levels.find(n=>n>=needed)||levels.at(-1),image=atlas.levels.get(cell);
  c.save();c.imageSmoothingEnabled=needed!==cell;c.imageSmoothingQuality='high';
  if(flipX){c.translate(x+w,y);c.scale(-1,1);x=y=0;}
  c.drawImage(image,index%atlas.columns*cell,Math.floor(index/atlas.columns)*cell,cell,cell,x,y,w,h);c.restore();draws.set(id,(draws.get(id)||0)+1);return true;
}
