import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, restoreGame, validateGame } from '../model.js';
import { encodeGame } from '../save-codec.js';
import { captureWorld, materializeWorld, worldTransferables } from '../world-transfer.js';
import { createGameAsync, restoreGameAsync, preparedSave, captureGame, encodeCapturedGame } from '../background-jobs.js';
import { writeSaveSlot, readSaveSlot, SAVE_SLOT_PREFIX } from '../save-slots.js';

for(const biome of ['taiga','tundra','desert'])test(`${biome}: transferred terrain and procedural baseline retain exact game/save data`,async()=>{
  const game=createGame({biome,size:'square512',seed:1847});
  game.tiles[13].futureField={levels:[0,1,'flower']};game.tiles[14].elevation=-0;game.tiles[15].variant=-0;
  const original=encodeGame(game),snapshot=await captureWorld(game,{cooperative:false});
  const clone=structuredClone(snapshot,{transfer:worldTransferables(snapshot)});
  assert.equal(snapshot.codes.byteLength,0);
  const loaded=await materializeWorld(clone,{cooperative:false});
  assert.deepEqual(loaded,game);
  assert.deepEqual(encodeGame(loaded),original);
  assert.equal(encodeGame(loaded).format,'transport-procedural-v1');
});

test('palette overflow, own undefined, public roads and safe extension properties are lossless',async()=>{
  const tiles=Array.from({length:9000},(_,i)=>({terrain:'grass',elevation:i/9999,variant:i%40,detail:`plant-${i%100}`,road:i%2===0,rail:false,bridge:false,tunnel:false,publicRoad:i%3?true:undefined,building:null,zone:null}));
  delete tiles[0].detail;tiles[1].detail=undefined;tiles[2].elevation=-0;
  Object.defineProperty(tiles[3],'__proto__',{value:{safe:true},enumerable:true});
  const game={width:100,height:90,tiles,routes:[],vehicles:[]};
  const snapshot=await captureWorld(game,{cooperative:false}),loaded=await materializeWorld(snapshot,{cooperative:false});
  assert.deepEqual(loaded,game);assert.equal(Object.getPrototypeOf(loaded.tiles[3]),Object.prototype);
});

test('main thread hydration yields; edits during capture reject a mixed snapshot',async()=>{
  const game=createGame({size:'regional',seed:22});let turns=0;
  const timer=setInterval(()=>turns++,0);
  try{const snapshot=await captureGame(game);await materializeWorld(snapshot);assert.ok(turns>0);}
  finally{clearInterval(timer);}
  await assert.rejects(captureGame(game,{onProgress:p=>{if(p.phase==='terrain')game.day++;}}),{name:'SnapshotChangedError'});
});

test('aborted work never returns a game or encodes a save',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(createGameAsync({size:'regional'},{signal:controller.signal}),{name:'AbortError'});
  const game=createGame({size:'regional'});
  await assert.rejects(captureGame(game,{signal:controller.signal}),{name:'AbortError'});
  let terminated=false;
  const pending=new AbortController();
  const job=createGameAsync({size:'regional'},{signal:pending.signal,workerFactory:()=>({terminate(){terminated=true;},postMessage(){}})});
  pending.abort();await assert.rejects(job,{name:'AbortError'});assert.equal(terminated,true);
});

test('missing or blocked workers fall back and preserve existing save formats',async()=>{
  const config={size:'regional',seed:79},options={workerFactory(){throw new Error('Worker blocked');}};
  const game=await createGameAsync(config,options),raw=preparedSave(game);
  assert.deepEqual(game,createGame(config));assert.equal(typeof raw,'string');assert.equal(preparedSave(game),null);
  const restored=await restoreGameAsync(raw,options);assert.deepEqual(restored,restoreGame(JSON.parse(raw)));
  const snapshot=await captureGame(game),serialized=await encodeCapturedGame(snapshot,options);
  assert.deepEqual(JSON.parse(serialized),encodeGame(game));assert.equal(validateGame(restored),true);
});

test('stale worker responses are ignored and loaded errors do not silently start a new game',async()=>{
  let terminated=false;
  const factory=()=>{
    const worker={terminate(){terminated=true;},postMessage({id}){queueMicrotask(()=>{worker.onmessage({data:{id:id+1,result:{bad:true}}});worker.onmessage({data:{id,error:{name:'Error',message:'Damaged save'}}});});}};
    queueMicrotask(()=>worker.onmessage({data:{ready:true}}));return worker;
  };
  await assert.rejects(restoreGameAsync('broken',{workerFactory:factory}),/Damaged save/);assert.equal(terminated,true);
});

test('cooperative named saves commit complete snapshots and cancellation keeps the previous slot',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),entries=new Map();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),get length(){return entries.size;},key:index=>[...entries.keys()][index],removeItem:key=>entries.delete(key)}});
  try{
    const game=createGame({size:'regional',seed:812}),saved=await writeSaveSlot(game,{name:'Worker snapshot',capturePaused:true});
    assert.equal(saved.ok,true);assert.equal((await readSaveSlot(saved.id)).ok,true);
    const raw=entries.get(SAVE_SLOT_PREFIX+saved.id),controller=new AbortController();
    const cancelled=await writeSaveSlot(game,{id:saved.id,name:'Cancelled',capturePaused:true,signal:controller.signal,onCaptured:()=>controller.abort()});
    assert.equal(cancelled.ok,false);assert.equal(entries.get(SAVE_SLOT_PREFIX+saved.id),raw);
    let active=true;
    const stale=await writeSaveSlot(game,{id:saved.id,name:'Closed',capturePaused:true,isCurrent:()=>active,onCaptured:()=>{active=false;}});
    assert.equal(stale.ok,false);assert.equal(entries.get(SAVE_SLOT_PREFIX+saved.id),raw);
  }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}
});
