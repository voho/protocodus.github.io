import { generatedElevation } from './world-tiles.js';
import { exportSaveBaseline, importSaveBaseline } from './save-codec.js';

// This is an in-memory worker protocol, not a new save format. Four bytes per
// tile cross the thread boundary; sparse extensions retain future tile fields.
const TERRAINS=['grass','water','forest','mountain','rock','sand','snow'];
const TERRAIN_IDS=Object.assign(Object.create(null),Object.fromEntries(TERRAINS.map((terrain,id)=>[terrain,id])));
const own=(object,key)=>Object.hasOwn(object,key);
function putExtra(extra,key,value){Object.defineProperty(extra??={},key,{value:structuredClone(value),writable:true,enumerable:true,configurable:true});return extra;}
const abortError=()=>Object.assign(new Error('Operation cancelled.'),{name:'AbortError'});
const changedError=()=>Object.assign(new Error('The world changed while preparing its save.'),{name:'SnapshotChangedError'});
export function checkAborted(signal){if(signal?.aborted)throw abortError();}
// A timer yields to ordinary input, animation and loading indicators as well as
// higher-priority tasks. Boosted scheduler continuations can starve timers for
// an entire large-world capture even when each continuation is short.
export function nextTask(){return new Promise(resolve=>setTimeout(resolve,0));}
function ticker({signal,onProgress,cooperative=true,isCurrent}={}){
  let deadline=performance.now()+8;
  return async function checkpoint(progress,force=false){
    checkAborted(signal);
    if(isCurrent&&!isCurrent())throw changedError();
    if(force||performance.now()>=deadline){onProgress?.(progress);if(cooperative)await nextTask();deadline=performance.now()+8;checkAborted(signal);if(isCurrent&&!isCurrent())throw changedError();}
  };
}

// Route state is cloned synchronously with the rest of the game; only the
// paths, which change solely with the network revision, are packed in slices.
async function packRoutes(paths,states,checkpoint){
  const output=[];let total=0;
  for(let r=0;r<paths.length;r++){
    const path=paths[r],coordinates=new Int32Array(path.length*2),extras=[];
    total+=path.length;if(total>16*1024*1024)throw new Error('The company has too many route points to save.');
    for(let i=0;i<path.length;i++){
      const point=path[i];coordinates[i*2]=point.x;coordinates[i*2+1]=point.y;
      let extended=!Number.isInteger(point.x)||!Number.isInteger(point.y);
      for(const key in point)if(key!=='x'&&key!=='y'&&own(point,key))extended=true;
      if(extended)extras.push([i,structuredClone(point)]);
      if(!(i%4096))await checkpoint({phase:'routes',completed:output.length,total:paths.length});
    }
    output.push({...states[r],path:{coordinates,extras}});
  }
  return output;
}

export async function captureWorld(game,options={}){
  const checkpoint=ticker(options),codes=new Uint32Array(game.tiles.length),elevations=[],elevationIds=new Map(),details=[null,undefined],detailIds=new Map(),extras=[];
  const {tiles,routes,...rest}=game;
  const state=structuredClone(rest),paths=routes.map(route=>route.path),routeStates=structuredClone(routes.map(({path,...route})=>route));
  for(let i=0;i<tiles.length;i++){
    const tile=tiles[i];let extra,detail=0,variant=tile.variant,elevation;
    const elevationKey=Object.is(tile.elevation,-0)?'-0':tile.elevation;
    elevation=elevationIds.get(elevationKey);
    if(elevation===undefined){if(elevations.length<8192){elevation=elevations.length;elevationIds.set(elevationKey,elevation);elevations.push(tile.elevation);}else{elevation=0;extra=putExtra(extra,'elevation',tile.elevation);}}
    if(own(tile,'detail')){
      if(tile.detail===undefined)detail=1;
      else {detail=detailIds.get(tile.detail);if(detail===undefined){if(typeof tile.detail==='string'&&details.length<64){detail=details.length;details.push(tile.detail);detailIds.set(tile.detail,detail);}else{detail=0;extra=putExtra(extra,'detail',tile.detail);}}}
    }
    if(!Number.isInteger(variant)||variant<0||variant>15||Object.is(variant,-0)){extra=putExtra(extra,'variant',variant);variant=0;}
    let terrain=typeof tile.terrain==='string'?TERRAIN_IDS[tile.terrain]??-1:-1;if(terrain<0){terrain=0;extra=putExtra(extra,'terrain',tile.terrain);}
    const flags=Number(tile.road)|(Number(tile.rail)<<1)|(Number(tile.bridge)<<2)|(Number(tile.tunnel)<<3);
    let publicRoad=own(tile,'publicRoad')?(tile.publicRoad===undefined?3:tile.publicRoad?2:1):0;
    if(publicRoad&&tile.publicRoad!==undefined&&typeof tile.publicRoad!=='boolean'){extra=putExtra(extra,'publicRoad',tile.publicRoad);publicRoad=0;}
    codes[i]=(terrain|variant<<3|detail<<7|flags<<13|publicRoad<<17|elevation<<19)>>>0;
    // A delete (terrain object release, bulldozing) leaves a tile in dictionary
    // mode, which turns the per-key loads below generic for every later tile
    // (4x slower). Plain tiles only need their key names checked.
    let plain=typeof tile.road==='boolean'&&typeof tile.rail==='boolean'&&typeof tile.bridge==='boolean'&&typeof tile.tunnel==='boolean'&&tile.building===null&&tile.zone===null;
    if(plain)for(const key in tile){switch(key){case 'terrain':case 'variant':case 'detail':case 'elevation':case 'publicRoad':case 'road':case 'rail':case 'bridge':case 'tunnel':case 'building':case 'zone':continue;}plain=false;break;}
    if(!plain)for(const key in tile){
      switch(key){
        case 'terrain':case 'variant':case 'detail':case 'elevation':case 'publicRoad':continue;
        case 'road':case 'rail':case 'bridge':case 'tunnel':if(typeof tile[key]==='boolean')continue;break;
        case 'building':case 'zone':if(tile[key]===null)continue;
      }
      if(own(tile,key))extra=putExtra(extra,key,tile[key]);
    }
    if(extra)extras.push([i,extra]);
    if(!(i%2048))await checkpoint({phase:'terrain',completed:i,total:tiles.length});
  }
  state.routes=await packRoutes(paths,routeStates,checkpoint);
  const baseline=exportSaveBaseline(game,{copy:options.copyBaseline!==false});
  await checkpoint({phase:'terrain',completed:tiles.length,total:tiles.length},true);
  if(game.routes.length!==paths.length||game.routes.some((route,i)=>route.path!==paths[i]))throw changedError();
  return {version:1,state,codes,elevations,details,extras,baseline};
}

export function worldTransferables(snapshot){
  return [snapshot.codes.buffer,...snapshot.state.routes.map(route=>route.path.coordinates.buffer),...(snapshot.baseline?[snapshot.baseline.codes.buffer]:[])];
}

export async function materializeWorld(snapshot,options={}){
  if(snapshot?.version!==1||!(snapshot.codes instanceof Uint32Array)||snapshot.codes.length!==snapshot.state.width*snapshot.state.height)throw new Error('Invalid world transfer.');
  const checkpoint=ticker(options),{codes,details,extras}=snapshot,tiles=new Array(codes.length),elevations=[null,...snapshot.elevations.map(generatedElevation)];
  for(let i=0;i<tiles.length;i++){
    const code=codes[i],detail=code>>>7&63,publicRoad=code>>>17&3;
    const tile={terrain:TERRAINS[code&7],elevation:null,variant:code>>>3&15,road:Boolean(code&8192),rail:Boolean(code&16384),bridge:Boolean(code&32768),tunnel:Boolean(code&65536),building:null,zone:null};
    tile.elevation=elevations[(code>>>19)+1];
    if(detail)tile.detail=details[detail];
    if(publicRoad)tile.publicRoad=publicRoad===3?undefined:publicRoad===2;
    tiles[i]=tile;
    if(!(i%2048))await checkpoint({phase:'opening',completed:i,total:tiles.length});
  }
  for(let i=0;i<extras.length;i++){
    const [index,extra]=extras[i];Object.defineProperties(tiles[index],Object.fromEntries(Object.entries(extra).map(([key,value])=>[key,{value,writable:true,enumerable:true,configurable:true}])));
    if(!(i%2048))await checkpoint({phase:'opening',completed:tiles.length,total:tiles.length});
  }
  const routes=[];
  for(const route of snapshot.state.routes){
    const {coordinates,extras:pointExtras}=route.path,path=new Array(coordinates.length/2);
    for(let i=0;i<path.length;i++){path[i]={x:coordinates[i*2],y:coordinates[i*2+1]};if(!(i%4096))await checkpoint({phase:'routes',completed:routes.length,total:snapshot.state.routes.length});}
    for(const [index,point]of pointExtras)path[index]=point;
    routes.push({...route,path});
  }
  const game={...snapshot.state,routes,tiles};
  importSaveBaseline(game,snapshot.baseline);
  await checkpoint({phase:'opening',completed:tiles.length,total:tiles.length},true);
  return game;
}
