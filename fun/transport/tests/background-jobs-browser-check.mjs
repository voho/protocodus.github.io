import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true,args:['--js-flags=--expose-gc']});
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const errors=[];
try{
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/background-jobs-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Background job responsiveness</title><button id="heartbeat">Loading world</button>'}));
  await page.goto(`${base}background-jobs-qa`);
  const result=await page.evaluate(async({base,size})=>{
    const jobs=await import(`${base}background-jobs.js`),model=await import(`${base}model.js`),codec=await import(`${base}save-codec.js`);
    const rows=[];
    async function measure(label,operation){
      await new Promise(r=>setTimeout(r,50));const intervals=[],frameIntervals=[];let frames=0,last=performance.now(),lastFrame=last,active=true;
      const frame=()=>{if(!active)return;const now=performance.now();frameIntervals.push(now-lastFrame);lastFrame=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
      const timer=setInterval(()=>{const now=performance.now();intervals.push(now-last);last=now;document.querySelector('#heartbeat').textContent=`Working ${++frames}`;},16);
      const start=performance.now();const value=await operation();await new Promise(r=>setTimeout(r,25));active=false;clearInterval(timer);
      rows.push({label,ms:Math.round(performance.now()-start),heartbeats:frames,maxHeartbeatGap:Math.round(Math.max(0,...intervals)),p95HeartbeatGap:Math.round(intervals.sort((a,b)=>a-b)[Math.floor(intervals.length*.95)]||0),maxFrameGap:Math.round(Math.max(0,...frameIntervals))});
      return value;
    }
    const config={biome:'taiga',size,seed:1847};
    let sync=await measure('synchronous generation',()=>model.createGame(config));
    const expected=JSON.stringify(codec.encodeGame(sync));sync=null;globalThis.gc?.();
    let game=await measure('worker generation + hydration',()=>jobs.createGameAsync(config));
    const prepared=jobs.preparedSave(game);
    if(prepared!==expected)throw new Error('Generated save differs from synchronous model.');
    if(!model.validateGame(game))throw new Error('Invalid worker-generated world.');
    const home=game.tiles.find(tile=>tile.building);home.building.workerTest='preserved';game.money-=111;game.day=2;game.revision++;
    const expectedEdited=await measure('synchronous validation + encoding',()=>{if(!model.validateGame(game))throw new Error('Invalid fixture');return JSON.stringify(codec.encodeGame(game));});
    const snapshot=await measure('cooperative capture',()=>jobs.captureGame(game));
    const encoded=await measure('worker encoding',()=>jobs.encodeCapturedGame(snapshot));
    if(encoded!==expectedEdited)throw new Error('Worker encoding differs from synchronous codec.');
    game=null;globalThis.gc?.();
    let syncRestored=await measure('synchronous restore',()=>model.restoreGame(JSON.parse(encoded)));
    const expectedRestored=JSON.stringify(codec.encodeGame(syncRestored));syncRestored=null;globalThis.gc?.();
    const restored=await measure('worker restore + hydration',()=>jobs.restoreGameAsync(encoded));
    if(!model.validateGame(restored)||!restored.tiles.find(tile=>tile.building?.workerTest))throw new Error('Worker restore lost an edit.');
    if(jobs.preparedSave(restored)!==expectedRestored)throw new Error('Restored save differs from synchronous restore.');
    const failed=new AbortController();const aborted=jobs.createGameAsync(config,{signal:failed.signal});setTimeout(()=>failed.abort(),10);
    try{await aborted;throw new Error('Abort unexpectedly completed.');}catch(error){if(error.name!=='AbortError')throw error;}
    return {rows,stats:jobs.backgroundJobStats(),size,saveBytes:encoded.length*2,storageEntries:localStorage.length};
  },{base,size:process.env.TRANSPORT_WORLD_SIZE||'square512'});
  assert.equal(result.storageEntries,0);assert.deepEqual(errors,[]);
  assert.ok(result.rows.find(row=>row.label==='worker generation + hydration').heartbeats>1);
  assert.ok(result.stats.completed>=3);assert.equal(result.stats.fallbacks,0);assert.equal(result.stats.cancelled,1);
  console.log(JSON.stringify({...result,errors},null,2));
}finally{await browser.close();}
