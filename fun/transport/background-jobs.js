import { createGame, restoreGame, validateGame } from './model.js';
import { encodeGame } from './save-codec.js';
import { captureWorld, materializeWorld, worldTransferables, checkAborted, nextTask } from './world-transfer.js';

const prepared=new WeakMap();
let serial=0;
const workerFailure=message=>Object.assign(new Error(message),{name:'WorkerUnavailableError'});
const stats={started:0,completed:0,cancelled:0,fallbacks:0};
export function backgroundJobStats(){return {...stats};}

function runWorker(operation,payload,{signal,onProgress,workerFactory}={},transfer=[]){
  checkAborted(signal);
  return new Promise((resolve,reject)=>{
    let worker,settled=false,posted=false;const id=++serial;
    const finish=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);worker?.terminate();if(error)reject(error);else{stats.completed++;resolve(result);}};
    const cancel=()=>{stats.cancelled++;finish(Object.assign(new Error('Operation cancelled.'),{name:'AbortError'}));};
    try{worker=workerFactory?workerFactory():new Worker(new URL('./world-worker.js',import.meta.url),{type:'module',name:'transport-world'});}
    catch(error){reject(workerFailure(error.message));return;}
    stats.started++;signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted){cancel();return;}
    worker.onmessage=({data})=>{
      if(data?.ready&&!settled&&!posted){posted=true;try{worker.postMessage({id,operation,payload},transfer);}catch(error){finish(workerFailure(error.message));}return;}
      if(settled||data?.id!==id)return;
      if(data.progress){onProgress?.(data.progress);return;}
      if(data.error){finish(Object.assign(new Error(data.error.message),{name:data.error.name}));return;}
      finish(null,data.result);
    };
    worker.onerror=event=>{event.preventDefault?.();finish(workerFailure(event.message||'Background processing is unavailable.'));};
    worker.onmessageerror=()=>finish(workerFailure('Could not receive the background world.'));
  });
}

function markPrepared(game,serialized){prepared.set(game,{serialized,day:game.day,revision:game.revision,networkRevision:game.networkRevision});return game;}
// Use only immediately after create/restore, before the live simulator starts.
export function preparedSave(game){
  const value=prepared.get(game);
  if(!value||value.day!==game.day||value.revision!==game.revision||value.networkRevision!==game.networkRevision)return null;
  prepared.delete(game);return value.serialized;
}

async function openWorld(operation,payload,options={}){
  checkAborted(options.signal);
  let result;
  try{result=await runWorker(operation,payload,options);}
  catch(error){
    if(error.name!=='WorkerUnavailableError')throw error;
    stats.fallbacks++;options.onProgress?.({phase:'fallback'});await nextTask();checkAborted(options.signal);
    const game=operation==='create'?createGame(payload):restoreGame(typeof payload==='string'?JSON.parse(payload):payload);
    if(!game||!validateGame(game))throw new Error('This world could not be opened.');
    return markPrepared(game,JSON.stringify(encodeGame(game)));
  }
  const game=await materializeWorld(result.snapshot,options);checkAborted(options.signal);
  return markPrepared(game,result.serialized);
}
export function createGameAsync(config,options){return openWorld('create',config,options);}
export function restoreGameAsync(saved,options){return openWorld('restore',saved,options);}

// Pause edits and daily steps only while this phase captures a consistent world.
// Vehicles may keep moving inside the current day: tiles and route paths do not
// change until the next daily step, and all other state is cloned up front.
// The returned detached snapshot is independent, so play can resume immediately.
export async function captureGame(game,options={}){
  const day=Math.floor(game.day+1e-8),revision=game.revision,networkRevision=game.networkRevision;
  const isCurrent=()=>Math.floor(game.day+1e-8)===day&&game.revision===revision&&game.networkRevision===networkRevision&&(!options.isCurrent||options.isCurrent());
  options.onProgress?.({phase:'capturing'});
  return captureWorld(game,{...options,isCurrent});
}
export async function encodeCapturedGame(snapshot,options={}){
  checkAborted(options.signal);options.onProgress?.({phase:'encoding'});
  // Keep fallback inputs intact if module workers are unsupported. Once buffers
  // transfer successfully, a worker crash cannot reuse their detached storage.
  const fallback=async()=>{
    stats.fallbacks++;const game=await materializeWorld(snapshot,options);if(!validateGame(game))throw new Error('The game state could not be validated.');return JSON.stringify(encodeGame(game));
  };
  if(typeof Worker!=='function'&&!options.workerFactory)return fallback();
  try{return(await runWorker('encode',snapshot,options,worldTransferables(snapshot))).serialized;}
  catch(error){if(error.name==='WorkerUnavailableError'&&snapshot.codes.byteLength)return fallback();throw error;}
}
export async function encodeGameAsync(game,options={}){
  const snapshot=await captureGame(game,options);options.onCaptured?.();
  return encodeCapturedGame(snapshot,options);
}
