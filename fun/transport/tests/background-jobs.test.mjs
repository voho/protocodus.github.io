import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, restoreGame, validateGame, tick, build } from '../model.js';
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

// The per-key encoder that predates the plain-tile fast path, kept as an exact oracle.
function legacyCapture(game){
  const TERRAINS=['grass','water','forest','mountain','rock','sand','snow'],own=(object,key)=>Object.hasOwn(object,key);
  const putExtra=(extra,key,value)=>{Object.defineProperty(extra??={},key,{value:structuredClone(value),writable:true,enumerable:true,configurable:true});return extra;};
  const codes=new Uint32Array(game.tiles.length),elevations=[],elevationIds=new Map(),details=[null,undefined],detailIds=new Map(),extras=[];
  const {tiles,routes,...rest}=game,state=structuredClone(rest);
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
    let terrain=TERRAINS.indexOf(tile.terrain);if(terrain<0){terrain=0;extra=putExtra(extra,'terrain',tile.terrain);}
    const flags=Number(tile.road)|(Number(tile.rail)<<1)|(Number(tile.bridge)<<2)|(Number(tile.tunnel)<<3);
    let publicRoad=own(tile,'publicRoad')?(tile.publicRoad===undefined?3:tile.publicRoad?2:1):0;
    if(publicRoad&&tile.publicRoad!==undefined&&typeof tile.publicRoad!=='boolean'){extra=putExtra(extra,'publicRoad',tile.publicRoad);publicRoad=0;}
    codes[i]=(terrain|variant<<3|detail<<7|flags<<13|publicRoad<<17|elevation<<19)>>>0;
    for(const key in tile){
      switch(key){
        case 'terrain':case 'variant':case 'detail':case 'elevation':case 'publicRoad':continue;
        case 'road':case 'rail':case 'bridge':case 'tunnel':if(typeof tile[key]==='boolean')continue;break;
        case 'building':case 'zone':if(tile[key]===null)continue;
      }
      if(own(tile,key))extra=putExtra(extra,key,tile[key]);
    }
    if(extra)extras.push([i,extra]);
  }
  state.routes=routes.map(route=>{
    const path=route.path,coordinates=new Int32Array(path.length*2),pointExtras=[];
    for(let i=0;i<path.length;i++){
      const point=path[i];coordinates[i*2]=point.x;coordinates[i*2+1]=point.y;
      let extended=!Number.isInteger(point.x)||!Number.isInteger(point.y);
      for(const key in point)if(key!=='x'&&key!=='y'&&own(point,key))extended=true;
      if(extended)pointExtras.push([i,structuredClone(point)]);
    }
    const {path:ignored,...routeState}=route;
    return {...structuredClone(routeState),path:{coordinates,extras:pointExtras}};
  });
  return {state,codes,elevations,details,extras};
}
const capturedFields=({version,baseline,...fields})=>fields;

test('plain-tile fast path encodes generated, played and dictionary-mode tiles exactly like the per-key encoder',async()=>{
  const game=createGame({size:'square512',seed:1847});
  assert.deepEqual(capturedFields(await captureWorld(game,{cooperative:false})),legacyCapture(game));
  for(let day=0;day<20;day++)tick(game,1);
  const grove=game.tiles.find(tile=>tile.terrainObject);delete grove.terrainObject;
  assert.deepEqual(capturedFields(await captureWorld(game,{cooperative:false})),legacyCapture(game));
});

test('plain-tile fast path keeps every unusual tile field, flag and prototype key',async()=>{
  const plain=(patch={})=>({terrain:'grass',elevation:.25,detail:'',variant:2,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null,...patch});
  const inherited=Object.assign(Object.create({inheritedKey:'from prototype',zone:null}),{terrain:'forest',elevation:.5,variant:1,road:true,rail:false,bridge:false,tunnel:false,building:null});
  const hiddenCore=plain({futureField:3});Object.defineProperty(hiddenCore,'zone',{value:null,enumerable:false});
  const dictionary=plain({publicRoad:true,structureLevel:2});delete dictionary.structureLevel;
  const odd=[
    plain(),plain({publicRoad:true}),plain({publicRoad:false}),plain({publicRoad:undefined}),plain({publicRoad:'yes'}),
    plain({terrainObject:{kind:'forest',footprint:2}}),plain({structureLevel:3,structureAxis:'x',bridge:true,road:true}),
    plain({futureField:{levels:[0,1,'flower']}}),plain({road:1}),plain({rail:'yes'}),plain({bridge:null}),plain({tunnel:undefined}),
    plain({building:{kind:'house',variant:1}}),plain({zone:'residential'}),plain({elevation:-0}),plain({variant:-0}),plain({variant:16}),plain({variant:2.5}),
    plain({terrain:'lava'}),plain({terrain:['grass']}),plain({detail:undefined}),plain({detail:7}),
    {zone:null,building:null,tunnel:false,bridge:false,rail:false,road:false,variant:0,detail:'plant-1',elevation:.5,terrain:'snow'},
    inherited,hiddenCore,dictionary,
  ];
  const withoutDetail=plain();delete withoutDetail.detail;odd.push(withoutDetail);
  const missingZone=plain({extra:1});delete missingZone.zone;odd.push(missingZone);
  const protoKey=plain();Object.defineProperty(protoKey,'__proto__',{value:{safe:true},enumerable:true});odd.push(protoKey);
  const tiles=Array.from({length:100*90},(_,i)=>i<odd.length?odd[i]:plain({variant:i%16,detail:`plant-${i%9}`}));
  const game={width:100,height:90,tiles,routes:[{id:'r1',name:'Odd',path:[{x:1,y:2},{x:1.5,y:2},{x:2,y:2,note:'stop'}],delivered:3}],vehicles:[]};
  const snapshot=await captureWorld(game,{cooperative:false});
  assert.deepEqual(capturedFields(snapshot),legacyCapture(game));
  assert.ok(snapshot.extras.length>=15,String(snapshot.extras.length));
});

test('vehicles keep moving inside the day while a cooperative capture stays byte-identical',async()=>{
  const game=createGame({size:'square512',seed:1847});tick(game,2.05);
  // Materialized worlds list routes last, so the byte reference takes the same path at t0.
  const encoded=async snapshot=>JSON.stringify(encodeGame(await materializeWorld(snapshot,{cooperative:false})));
  const saved=JSON.stringify(encodeGame(game)),expected=await encoded(await captureWorld(game,{cooperative:false}));
  const route=game.routes[0],before=structuredClone(game.vehicles);let steps=0;
  const snapshot=await captureGame(game,{onProgress:({phase})=>{
    if(phase==='capturing'||game.day-Math.floor(game.day)>.9)return;
    tick(game,.01);route.delivered+=2;route.revenue+=40;steps++;
  }});
  assert.ok(steps>0);assert.ok(game.day>2.05&&game.day<3);assert.notDeepEqual(game.vehicles,before);
  const actual=await encoded(snapshot);
  assert.equal(actual,expected);assert.deepEqual(JSON.parse(actual),JSON.parse(saved));
});

test('crossing a day, building or replacing a route path during capture rejects the snapshot',async()=>{
  const game=createGame({size:'square512',seed:1847});tick(game,1.1);
  const during=change=>captureGame(game,{onProgress:({phase})=>{if(phase!=='capturing')change();}});
  await assert.rejects(during(()=>tick(game,1)),{name:'SnapshotChangedError'});
  let built=false;
  await assert.rejects(during(()=>{for(let i=game.width*8;!built&&i<game.tiles.length;i++)built=build(game,'road',i%game.width,Math.floor(i/game.width)).ok;}),{name:'SnapshotChangedError'});
  assert.equal(built,true);
  await assert.rejects(during(()=>{game.routes[0].path=[...game.routes[0].path];}),{name:'SnapshotChangedError'});
  await assert.rejects(during(()=>{if(game.routes.length===1)game.routes.push({...game.routes[0],id:'copy'});}),{name:'SnapshotChangedError'});
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
