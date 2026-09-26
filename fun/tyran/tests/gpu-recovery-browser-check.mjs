// Serve the repository and run with the same TYRAN_URL/TYRAN_PLAYWRIGHT options as the other browser checks.
// This is deterministic correctness QA, not a performance measurement.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url=process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const output=process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-recovery-qa';
const gameUrl=new URL('game.js',url);
const errors=[],reports=[];await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER || 'chrome',headless:true});
const hook=`\nwindow.__recoveryQA={gpu,get dims(){return {W,H,width:canvas.width,height:canvas.height}},resize,render(){clock=7.25;previousScroll=state?.scroll||0;renderAlpha=1;draw();return {backend:ctx===gpu?'gpu':'native',pixels:(ctx===gpu?gpu.canvas:canvas).toDataURL('image/png').split(',')[1]};}};\n`;
async function open(){
 const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
 page.on('pageerror',error=>errors.push({kind:'pageerror',message:error.message}));
 page.on('console',msg=>{if(msg.type()==='error')errors.push({kind:'console',message:msg.text()});});
 // Fetch the app currently served at TYRAN_URL. Only append test hooks to its
 // actual game module; no renderer source is replaced by a fixture or snapshot.
 await page.route(candidate=>candidate.origin===gameUrl.origin&&candidate.pathname===gameUrl.pathname,async route=>{
  const response=await route.fetch();assert(response.ok(),'Served game.js must load');
  await route.fulfill({response,body:(await response.text())+hook});
 });
 await page.addInitScript(()=>{let id=0;const frames=new Map();window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};window.cancelAnimationFrame=id=>frames.delete(id);let time=1000;window.__frame=()=>{time+=1000/60;const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(time);};localStorage.clear();localStorage.setItem('tyran-muted','true');});
 await page.goto(url);await page.waitForFunction(()=>window.__recoveryQA&&window.tyran,null,{polling:20});
 await page.evaluate(async()=>{await tyran.world.ready;tyran.launch(6,null,false);await tyran.world.ready;const s=tyran.state;s.time=35;s.duration=1e6;s.enemies=[];s.bullets=[];s.events=[];s.director.clock=999;for(const p of s.players)p.hurt=1e8;tyran.fx.reset();await tyran.world.prepareReady(s.width,s.height,s.scroll);__recoveryQA.render();});
 await page.waitForTimeout(100);return page;
}
const digest=pixels=>createHash('sha256').update(Buffer.from(pixels,'base64')).digest('hex');
try{
 const page=await open();
 const initial=await page.evaluate(()=>{const g=__recoveryQA.gpu;const result=__recoveryQA.render();window.__lossExt=g.gl.getExtension('WEBGL_lose_context');if(!__lossExt)throw Error('WEBGL_lose_context required');return {backend:result.backend,stats:g.stats,scroll:tyran.state.scroll,terrainRows:[...tyran.world.sceneryLayers[0].keys()]};});
 assert.equal(initial.backend,'gpu');
 await page.evaluate(()=>__lossExt.loseContext());await page.waitForFunction(()=>__recoveryQA.gpu.contextLost,null,{polling:10});
 const streamed=await page.evaluate(async()=>{
  const g=__recoveryQA.gpu,w=tyran.world,s=tyran.state,before=g.stats.uploads,initial=new Set(w.sceneryLayers[0].values());let fresh=0;
  for(let i=0;i<8;i++){tyran.step(3);await w.prepareReady(s.width,s.height,s.scroll);const rendered=__recoveryQA.render();if(rendered.backend!=='native')throw Error('Native fallback required while lost');}
  for(const surface of w.sceneryLayers[0].values())if(!initial.has(surface))fresh++;
  const buildings=new Set(['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite']);
  const prop=w.visibleProps.find(p=>buildings.has(p.type)&&p.hp>0&&p.maxHp>0);let damaged=false;
  if(prop){const old=prop.hp;w.hit((prop.x+w.parallaxX)*w.scale,(prop.y+s.scroll)*w.scale,0,prop.maxHp*.6,s.scroll);await w.prepareReady(s.width,s.height,s.scroll);__recoveryQA.render();damaged=prop.hp<old;}
  const source=document.createElement('canvas');source.width=source.height=32;source.getContext('2d').fillRect(0,0,32,32);source._tyranTextureVersion=1;window.__lateSource=source;g.prewarm(source);source._tyranTextureVersion=2;g.markTextureDirty(source,{x:3,y:5,width:7,height:9});
  return {scroll:s.scroll,fresh,damaged,uploadsBefore:before,uploadsAfter:g.stats.uploads,stats:g.stats,pixels:__recoveryQA.render().pixels};
 });
 assert(streamed.scroll-initial.scroll>2400,'Normal simulation crosses several terrain strips during loss');assert(streamed.fresh>=2);assert.equal(streamed.uploadsAfter,streamed.uploadsBefore,'No GPU uploads while physically lost');assert(streamed.stats.recoverySources>0&&streamed.stats.recoverySources<=256);assert(streamed.stats.recoverySourceBytes<=streamed.stats.maxTextureBytes);
 await writeFile(`${output}/native-during-loss.png`,Buffer.from(streamed.pixels,'base64'));delete streamed.pixels;
 // Delay each restore upload only in this diagnostic so CDP viewport resize
 // reliably occurs while asynchronous restoration is yielding to Canvas2D.
 await page.evaluate(()=>{const g=__recoveryQA.gpu,original=g._texture;g._texture=function(source,restoring,...args){if(restoring){const until=performance.now()+5;while(performance.now()<until){}}return original.call(this,source,restoring,...args);};window.__restoreTexture=()=>{g._texture=original;};__lossExt.restoreContext();});
 await page.waitForFunction(()=>__recoveryQA.gpu._recoveryActive,null,{polling:5});
 const beforeResize=await page.evaluate(()=>({epoch:__recoveryQA.gpu._restoreEpoch,backend:__recoveryQA.render().backend}));assert.equal(beforeResize.backend,'native');
 await page.setViewportSize({width:1025,height:769});await page.evaluate(()=>__recoveryQA.resize());
 const resized=await page.evaluate(()=>({epoch:__recoveryQA.gpu._restoreEpoch,width:__recoveryQA.gpu.canvas.width,height:__recoveryQA.gpu.canvas.height,active:__recoveryQA.gpu._recoveryActive}));
 assert(resized.epoch>beforeResize.epoch,'Resize cancels stale recovery epoch');
 await page.waitForFunction(()=>__recoveryQA.gpu.usable||__recoveryQA.gpu.failure,null,{polling:10,timeout:30000});
 const recovered=await page.evaluate(()=>{__restoreTexture();const g=__recoveryQA.gpu,before=g.stats.uploads,result=__recoveryQA.render(),entry=g._cache.get(__lateSource),after=g.stats.uploads;return {backend:result.backend,firstFrameUploads:after-before,lateSource:entry?{version:entry.version,revision:entry.revision}:null,stats:g.stats,dims:__recoveryQA.dims,gpuWidth:g.canvas.width,gpuHeight:g.canvas.height,pixels:result.pixels};});
 assert.equal(recovered.backend,'gpu');assert.deepEqual(recovered.stats.errors,[]);assert.equal(recovered.stats.recoverySources,0);assert.equal(recovered.stats.recoveryPending,0);assert.equal(recovered.gpuWidth,recovered.dims.width);assert.equal(recovered.gpuHeight,recovered.dims.height);assert(recovered.stats.textureBytes<=recovered.stats.maxTextureBytes);assert.equal(recovered.firstFrameUploads,0,'First recovered frame uses only prewarmed textures');
 await writeFile(`${output}/gpu-after-recovery.png`,Buffer.from(recovered.pixels,'base64'));delete recovered.pixels;reports.push({case:'stream-loss-resize-restore',initial,streamed,resized,recovered});
 // A mid-draw exception must switch to native in this same draw() invocation.
 const failure=await page.evaluate(()=>{tyran.fx.reset();Math.random=()=>.5;const g=__recoveryQA.gpu,original=g.drawImage;let injected=false;g.drawImage=function(...args){if(!injected){injected=true;throw Error('Injected GPU draw failure');}return original.apply(this,args);};const first=__recoveryQA.render(),second=__recoveryQA.render();return {first,second,failure:g.failure,stats:g.stats,cursor:g._gpuVertexCursor,orphan:g._vertexBufferNeedsOrphan,gpuHidden:g.canvas.hidden,nativeVisible:!document.querySelector('#game-canvas').classList.contains('gpu-backing-hidden')};});
 await writeFile(`${output}/failed-frame.png`,Buffer.from(failure.first.pixels,'base64'));await writeFile(`${output}/repeat-frame.png`,Buffer.from(failure.second.pixels,'base64'));assert.equal(failure.first.backend,'native');assert.equal(failure.second.backend,'native');assert.equal(digest(failure.first.pixels),digest(failure.second.pixels),'Failure frame is complete native redraw, pixel-identical to subsequent native frame');assert.match(failure.failure,/Injected GPU draw failure/);assert.equal(failure.stats.textureBytes,0);assert.equal(failure.stats.textureCount,0);assert.equal(failure.cursor,0);assert(failure.orphan&&failure.gpuHidden&&failure.nativeVisible);
 await writeFile(`${output}/native-after-draw-failure.png`,Buffer.from(failure.first.pixels,'base64'));delete failure.first.pixels;delete failure.second.pixels;reports.push({case:'same-frame-exception-fallback',...failure});await page.close();
 const errorPage=await open();
 const uploadFailure=await errorPage.evaluate(()=>{tyran.fx.reset();Math.random=()=>.5;const g=__recoveryQA.gpu,original=g.drawImage;let injected=false;g.drawImage=function(...args){if(!injected){injected=true;const nativeError=g.gl.getError.bind(g.gl);g.gl.getError=()=>{g.gl.getError=nativeError;return g.gl.OUT_OF_MEMORY;};const source=document.createElement('canvas');source.width=source.height=8;g.prewarm(source);}return original.apply(this,args);};const first=__recoveryQA.render(),second=__recoveryQA.render();return {first,second,failure:g.failure,stats:g.stats,cursor:g._gpuVertexCursor};});
 assert.equal(uploadFailure.first.backend,'native');assert.equal(digest(uploadFailure.first.pixels),digest(uploadFailure.second.pixels));assert.match(uploadFailure.failure,/Texture upload failed/);assert.deepEqual(uploadFailure.stats.errors,[1285]);assert.equal(uploadFailure.stats.textureBytes,0);assert.equal(uploadFailure.cursor,0);delete uploadFailure.first.pixels;delete uploadFailure.second.pixels;reports.push({case:'same-frame-upload-error-fallback',...uploadFailure});await errorPage.close();
 assert.deepEqual(errors,[]);await writeFile(`${output}/report.json`,JSON.stringify({reports,errors},null,2)+'\n');
 console.log(JSON.stringify({passed:reports.map(r=>r.case),streamedWorldUnits:streamed.scroll-initial.scroll,newTerrainStrips:streamed.fresh,firstRecoveredUploads:recovered.firstFrameUploads,errors,output},null,2));
}catch(error){await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),stack:error.stack,reports,errors},null,2));throw error;}finally{await browser.close();console.log('BROWSER CLOSED');}
