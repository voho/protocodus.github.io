// Isolated storage: verify idle invalidation, scoped artwork, and a large route
// manager. Timings are reported, not asserted against machine-dependent limits.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createWorldFromMenu} from './browser-start.mjs';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const result={},errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2});
 page.on('pageerror',error=>errors.push(error.message));
 const start=performance.now();
 await page.goto(process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/');
 await page.locator('#start-create').click();
 await page.waitForFunction(()=>window.transport&&document.querySelector('#loading-screen').hidden);
 result.startupMs=performance.now()-start;
 await page.evaluate(()=>transport.setSpeed(0));
 await page.waitForTimeout(1000);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 await page.evaluate(()=>{
  const r=transport.renderer;window.perfCounts={renders:0,renderMs:0,minimaps:0,minimapMs:0};
  for(const [method,count,time]of[['render','renders','renderMs'],['drawMinimap','minimaps','minimapMs']]){
   const original=r[method];r[method]=function(...args){const start=performance.now(),result=original.apply(this,args);perfCounts[count]++;perfCounts[time]+=performance.now()-start;return result;};
  }
 });
 const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 await page.waitForTimeout(3000);
 const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 result.idle=await page.evaluate(()=>({...perfCounts,day:transport.game.day}));
 result.idle.taskMs=(after.TaskDuration-before.TaskDuration)*1000;
 result.idle.scriptMs=(after.ScriptDuration-before.ScriptDuration)*1000;
 result.heapMiB=after.JSHeapUsedSize/2**20;
 result.artwork=await page.evaluate(()=>{const s=transport.renderer.getStats();return{biomes:s.houseArtwork.availableBiomes,worldMiB:s.worldArtwork.decodedBytes/2**20,houseMiB:s.houseArtwork.decodedBytes/2**20,terrainMiB:s.cacheBytes/2**20};});
 assert.equal(result.idle.renders,0,'a paused, unchanged scene does not redraw');
 assert.equal(result.idle.minimaps,0,'a paused, unchanged minimap does not redraw');
 assert.deepEqual(result.artwork.biomes,['taiga'],'startup decodes only the active climate');
 await page.evaluate(()=>transport.renderer.pan(40,0));
 await page.waitForFunction(()=>perfCounts.renders>0);
 await page.locator('#game-menu-button').click();await page.locator('#overview-button').click();
 await page.waitForFunction(()=>perfCounts.minimaps>0);
 const previous=await page.evaluate(()=>perfCounts.renders);
 await page.evaluate(()=>transport.setSpeed(1));
 await page.waitForFunction(previous=>perfCounts.renders>previous,previous);
 await page.evaluate(()=>transport.setSpeed(0));
 // Delivery income floats for 1.6 s; a paused scene is idle again once it fades.
 const revenue=await page.evaluate(()=>transport.game.routes[0].revenue);
 await page.evaluate(()=>transport.setSpeed(3));
 await page.waitForFunction(revenue=>transport.game.routes[0].revenue>revenue,revenue,{timeout:90000});
 await page.evaluate(()=>transport.setSpeed(0));
 await page.waitForTimeout(2000);
 const faded=await page.evaluate(()=>perfCounts.renders);await page.waitForTimeout(1000);
 result.pausedAfterDelivery=await page.evaluate(faded=>perfCounts.renders-faded,faded);
 assert.equal(result.pausedAfterDelivery,0,'a paused scene stops redrawing once delivery income fades');
 result.cache=await page.evaluate(async()=>{
  const {createSprites}=await import('./sprites.js'),{HOUSE_KINDS}=await import('./raster-houses.js');
  const sprite=createSprites('taiga',{pixelScale:2,detailLevel:'detail'}),distinct=new Set();
  for(const kind of HOUSE_KINDS)for(let variant=0;variant<12;variant++)distinct.add(sprite(kind,variant,1));
  const before=sprite.getStats();
  const large=sprite(HOUSE_KINDS[0],0,1,'',2);
  return{...before,distinct:distinct.size,largeWidth:large.width};
 });
 assert.equal(result.cache.distinct,9,'authored house variants reuse the identical bitmap');
 assert.equal(result.cache.largeWidth,128,'different footprints retain separate sprite sizes');
 // Use real independently mutable route/vehicle records, without waiting for
 // 10,000 interactive purchases; the model has separate dense-world coverage.
 result.routes=await page.evaluate(()=>{
  const g=transport.game;g.stations=[{id:'a',name:'West',mode:'road',x:g.cities[0].x,y:g.cities[0].y},{id:'b',name:'East',mode:'road',x:g.cities[1].x,y:g.cities[1].y}];
  g.routes=Array.from({length:10000},(_,i)=>({id:`perf-${i}`,name:`Service ${i}`,stops:['a','b'],mode:'road',cargo:'passengers',active:false,path:[],revenue:0,delivered:0}));
  g.vehicles=g.routes.map((r,i)=>({id:`v${i}`,routeId:r.id,load:0,capacity:24,level:0,x:g.cities[0].x,y:g.cities[0].y}));g.revision++;
  const start=performance.now();transport.setView('routes');return{openMs:performance.now()-start};
 });
 assert.equal(await page.locator('#route-list [data-route-id]').count(),50);
 assert.match(await page.locator('#route-results-count').innerText(),/10000 of 10000/);
 await page.locator('#route-list [data-route-page="next"]').first().click();
 assert.equal(await page.locator('#route-list [data-route-id]').first().getAttribute('data-route-id'),'perf-50');
 await page.locator('#route-search').fill('Service 9999');
 assert.equal(await page.locator('#route-list [data-route-id]').count(),1);
 assert.equal(await page.locator('#route-list [data-route-id]').first().getAttribute('data-route-id'),'perf-9999');
 await page.locator('#clear-route-filters').click();
 assert.equal(await page.locator('#route-list [data-route-id]').count(),50);
 assert.equal(await page.locator('#route-list [data-route-id]').first().getAttribute('data-route-id'),'perf-0');
 // Tool changes rebuild the Build drawer, whose next goal must come from the memo on a vast world.
 await createWorldFromMenu(page,{size:'square2048'});
 result.vastTools=await page.evaluate(()=>{
  transport.setView('build');const times=[];
  for(let n=0;n<9;n++)for(const tool of ['road','stop','inspect']){const start=performance.now();transport.setTool(tool);times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);return{medianMs:times[Math.floor(times.length/2)],maxMs:times.at(-1)};
 });
 assert.ok(result.vastTools.medianMs<5,`setTool on a 2048 world takes ${result.vastTools.medianMs.toFixed(1)} ms`);
 assert.deepEqual(errors,[]);result.errors=errors;
 if(process.env.TRANSPORT_PERFORMANCE_OUTPUT)await writeFile(process.env.TRANSPORT_PERFORMANCE_OUTPUT,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
