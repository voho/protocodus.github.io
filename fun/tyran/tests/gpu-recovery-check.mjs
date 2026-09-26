import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let id=0;
function mockGL(){
  const log=[],live=new Set();let lost=false,nextError=0,uploadError=0,uploadThrow=false,maxTextureSize=16384;
  const control={log,live,set lost(value){lost=value;},set error(value){nextError=value;},set uploadError(value){uploadError=value;},set uploadThrow(value){uploadThrow=value;},set maxTextureSize(value){maxTextureSize=value;}};
  const gl=new Proxy({}, {get(_,name){
    if(name==='NO_ERROR')return 0;if(name==='TEXTURE0')return 1000;
    if(name==='isContextLost')return()=>lost;
    if(name==='getError')return()=>{const result=nextError;nextError=0;return result;};
    if(name==='getShaderParameter'||name==='getProgramParameter')return()=>true;
    if(name==='getParameter')return key=>key==='MAX_TEXTURE_SIZE'?maxTextureSize:8;
    if(name==='getUniformLocation')return(_program,uniform)=>uniform;
    if(name==='checkFramebufferStatus')return()=>'FRAMEBUFFER_COMPLETE';
    if(name.startsWith('create'))return()=>{const handle={kind:name,id:++id};live.add(handle);log.push([name,handle]);return handle;};
    if(name.startsWith('delete'))return handle=>{live.delete(handle);log.push([name,handle]);};
    if(name==='texImage2D'||name==='texSubImage2D')return(...values)=>{assert(!lost,'No uploads while context physically lost');log.push([name,...values]);if(uploadThrow)throw Error('upload exception');if(uploadError){nextError=uploadError;uploadError=0;}};
    if(/^[A-Z_0-9]+$/.test(name))return name;
    return(...values)=>{log.push([name,...values]);};
  }});return {gl,...control,get log(){return log;},get live(){return live;},lose(){lost=true;live.clear();},restore(){lost=false;},setError(value){nextError=value;},setUploadError(value){uploadError=value;},setUploadThrow(value){uploadThrow=value;},setMaxTextureSize(value){maxTextureSize=value;}};
}
globalThis.OffscreenCanvas=class {constructor(width,height){this.width=width;this.height=height;this.handlers=new Map();this.mock=mockGL();}getContext(){return this.mock.gl;}addEventListener(name,fn){this.handlers.set(name,fn);}};
const {GPUCanvas2D,createGpuCanvas}=await import('../gpu-canvas.js');
const source=(name,width=32,height=32)=>({name,width,height,_tyranTextureVersion:1});
const uploads=c=>c.canvas.mock.log.filter(row=>row[0]==='texImage2D'||row[0]==='texSubImage2D').length;
function lose(c){c.canvas.mock.lose();c.canvas.handlers.get('webglcontextlost')({preventDefault(){}});}
function restore(c){c.canvas.mock.restore();return c.canvas.handlers.get('webglcontextrestored')();}
const pendingTimers=[];let tick=0;
const oldTimeout=globalThis.setTimeout,oldPerformance=globalThis.performance;
globalThis.setTimeout=fn=>{pendingTimers.push(fn);};globalThis.performance={now:()=>tick++};
async function drain(){let rounds=0;while(pendingTimers.length){assert(++rounds<1000,'Recovery makes progress');pendingTimers.shift()();await Promise.resolve();}return rounds;}
function assertReady(c,sources){assert(c.usable);assert.equal(c._recoverySources.size,0);assert.equal(c._recoveryPending.size,0);assert.equal(c._recoveryBytes,0);for(const src of sources){const entry=c._cache.get(src);assert(entry,`${src.name} prewarmed`);assert.equal(entry.version,src._tyranTextureVersion);assert.equal(entry.width,src.width);assert.equal(entry.height,src.height);assert.equal(entry.revision,c._dirty.get(src)?.revision||0);}}
let cases=0;
try {
  {
    const c=new GPUCanvas2D(1920,1080),a=source('old'),b=source('during loss'),fresh=source('provider'),late=source('streaming during restore'),finalOnly=source('final active world');c.prepareSoftLayer();c.prewarm(a);lose(c);const before=uploads(c);c.prewarm(b);c.markTextureDirty(b,{x:0,y:0,width:4,height:4});assert.equal(uploads(c),before);assert(!c.usable);let refreshes=0;c.setRecoveryPrewarm(()=>{refreshes++;c.prewarm(fresh);if(refreshes===2)c.prewarm(finalOnly);});
    const restoring=restore(c);assert(!c.usable);assert(pendingTimers.length,'Restoration yields to native fallback');assert(c._cache.has(a),'First slice uploads prior source');
    a._tyranTextureVersion++;c.prewarm(a);c.prewarm(late);c.markTextureDirty(a,{x:1,y:2,width:2,height:3});assert(!c.usable);
    await drain();assert.equal(await restoring,true);assertReady(c,[a,b,fresh,late,finalOnly]);assert.equal(refreshes,2);assert(c._softLayer);assert(c.stats.textureBytes<=c.stats.maxTextureBytes);const after=uploads(c);for(const src of[a,b,fresh,late,finalOnly])c.drawImage(src,1,2);assert.equal(uploads(c),after,'First recovered frame does not build/upload textures');c.dispose();assert.equal(c.canvas.mock.live.size,0);cases++;
  }
  {
    const c=new GPUCanvas2D(800,600),initial=Array.from({length:7},(_,i)=>source(`initial${i}`)),after=source('resize source');c.prewarm(initial);lose(c);let refreshes=0;c.setRecoveryPrewarm(()=>{refreshes++;c.prewarm(after);});const stale=restore(c);assert(pendingTimers.length);after.width=65;c.prewarm(after);const previousEpoch=c._restoreEpoch;c.resize(1280,720);assert(c._restoreEpoch>previousEpoch);const current=c._recoveryPromise;assert.notEqual(current,stale);await drain();assert.equal(await stale,false);assert.equal(await current,true);assertReady(c,[...initial,after]);assert.equal(c.canvas.width,1280);assert(c.canvas.mock.log.some(row=>row[0]==='uniform2f'&&row[2]===1280&&row[3]===720));assert(refreshes>=3);c.dispose();assert.equal(c.canvas.mock.live.size,0);cases++;
  }
  {
    const c=new GPUCanvas2D(800,600);c.prewarm(Array.from({length:8},(_,i)=>source(`dispose${i}`)));lose(c);const restoring=restore(c);assert(pendingTimers.length);c.dispose();const count=uploads(c);await drain();assert.equal(await restoring,false);assert(!c.usable);assert.equal(c.failure,'disposed');assert.equal(c.canvas.mock.live.size,0);assert.equal(c._recoverySources.size,0);assert.equal(c._cache.size,0);await restore(c);c.prewarm(source('must ignore'));assert.equal(uploads(c),count);cases++;
  }
  {
    const c=new GPUCanvas2D(800,600),all=Array.from({length:300},(_,i)=>source(`bounded${i}`));lose(c);c.prewarm(all);assert.equal(c._recoverySources.size,256);assert(!c._recoverySources.has(all[0]));assert(c._recoverySources.has(all.at(-1)));assert(c.stats.recoverySourceBytes<=c.stats.maxTextureBytes);const restoring=restore(c);await drain();await restoring;assertReady(c,all.slice(-256));assert.equal(c._cache.size,256);c.dispose();assert.equal(c.canvas.mock.live.size,0);cases++;
  }
  {
    const c=new GPUCanvas2D(800,600),all=Array.from({length:5},(_,i)=>source(`bytes${i}`,4096,4096));lose(c);c.prewarm(all);assert.equal(c._recoverySources.size,4);assert.equal(c._recoveryBytes,256*1024*1024);const restoring=restore(c);await drain();await restoring;assertReady(c,all.slice(-4));assert.equal(c.stats.textureBytes,256*1024*1024);c.dispose();assert.equal(c.canvas.mock.live.size,0);cases++;
  }
  {
    const c=new GPUCanvas2D(800,600);c.prewarm(source('good'));c.prepareSoftLayer();c.drawImage(source('queued'),1,1);c.prewarm(source('too wide',16385,1));assert(!c.usable);assert.match(c.failure,/MAX_TEXTURE_SIZE/);assert.equal(c.canvas.mock.live.size,0);assert.equal(c.stats.textureBytes,0);assert.equal(c._count,0);assert.equal(c._softLayer,null);assert.equal(c._commands.length,0);const reason=c.failure;c.dispose();assert.equal(c.failure,reason);cases++;
  }
  for(const mode of['driver error','throw']){
    const c=new GPUCanvas2D(800,600);c.prewarm(source('good'));mode==='throw'?c.canvas.mock.setUploadThrow(true):c.canvas.mock.setUploadError(1285);c.prewarm(source(mode));assert(!c.usable);assert.equal(c.canvas.mock.live.size,0);assert.equal(c._cache.size,0);assert.match(c.failure,mode==='throw'?/upload exception/:/Texture upload failed/);cases++;
  }
  {
    const c=new GPUCanvas2D(800,600);c.prewarm(source('good'));c.drawImage(source('queued'),1,1);c.canvas.mock.lose();assert.equal(c.present({}),false,'Presentation detects loss before a partial frame is shown');assert(c.contextLost);const restoring=restore(c);await drain();assert(await restoring);c.dispose();cases++;
  }
  {
    const c=new GPUCanvas2D(800,600),old=source('old'),latest=source('newest context generation');c.prewarm([old,source('another'),source('third')]);lose(c);const first=restore(c);assert(!c.usable);lose(c);c.prewarm(latest);const second=restore(c);await drain();assert.equal(await first,false);assert.equal(await second,true);assertReady(c,[old,latest]);c.dispose();assert.equal(c.canvas.mock.live.size,0);cases++;
  }
  {
    const mock=mockGL(),gl=new Proxy(mock.gl,{get(target,name){if(name==='getParameter')return key=>key==='MAX_TEXTURE_IMAGE_UNITS'?4:16384;return target[name];}});
    assert.throws(()=>new GPUCanvas2D(800,600,{width:800,height:600,getContext:()=>gl}),/Eight fragment texture units/);
    assert.equal(mock.live.size,0,'Constructor failure releases already allocated GPU handles');cases++;
  }
  {
    const script=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8'),wrapper=script.slice(script.indexOf('function draw() {'),script.indexOf('function drawFrame() {'));
    for(const failure of['none','lost','throw','native throw']){
      const gpu={usable:failure!=='native throw',fail(error){this.usable=false;this.failure=String(error);}},calls=[];
      const box={gpu,drawFrame(){calls.push(gpu.usable?'gpu':'native');if(calls.length===1){if(failure==='lost')gpu.usable=false;if(failure==='throw'||failure==='native throw')throw Error(failure);}}};vm.createContext(box);vm.runInContext(wrapper,box);
      if(failure==='native throw')assert.throws(()=>box.draw(),/native throw/);else box.draw();
      assert.deepEqual(calls,failure==='none'?['gpu']:failure==='native throw'?['native']:['gpu','native']);
    }cases++;
  }
} finally {globalThis.setTimeout=oldTimeout;globalThis.performance=oldPerformance;}
console.log(JSON.stringify({cases,sourcesQueuedDuringLoss:true,streamingAndDirtyVersionsDuringRestore:true,currentProviderRefresh:true,noRecoveryFrameUpload:true,resizeEpochCancellation:true,disposeCancellation:true,boundedCountAndBytes:true,fatalResourceCleanup:true,failedFrameNativeRedraw:true}));
