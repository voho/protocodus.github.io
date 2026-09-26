// Active-sector artwork is prepared before flight; only bounded strips stream in idle time.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TYRAN_BROWSER||'chrome',headless:true});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('');
  const reports=await page.evaluate(async()=>{
    const {WorldRenderer}=await import('./worlds.js');
    const NativeCanvas=OffscreenCanvas,prototype=OffscreenCanvasRenderingContext2D.prototype,read=prototype.getImageData;
    let active=false,allocations=0,readbacks=0;
    window.OffscreenCanvas=new Proxy(NativeCanvas,{construct(target,args){if(active)allocations++;return new target(...args);}});
    prototype.getImageData=function(...args){if(active)readbacks++;return read.apply(this,args);};
    const width=1600,height=900,output=new NativeCanvas(width,height),context=output.getContext('2d'),reports=[];
    const buildings=new Set(['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite']);
    try {
      for(let index=0;index<10;index++){
        const world=new WorldRenderer();world.setWorld(index);world.setDetailScale(2400,'high');
        const started=performance.now();await world.prepareReady(width,height);
        const preparationMs=performance.now()-started;
        allocations=0;readbacks=0;let maxStrips=0,maxBytes=0;
        for(let step=0;step<18;step++){
          const scroll=step*400;
          active=true;
          world.draw(context,width,height,scroll,step*.5,'high',width*.5);
          // First damage and crater appearances must already be resident.
          for(const prop of world.visibleProps)if(buildings.has(prop.type))world.hit(prop.screenX*world.scale,prop.screenY*world.scale,0,prop.maxHp*(step%3===2?1:.4),scroll);
          world.draw(context,width,height,scroll,step*.5,'high',width*.5);
          active=false;
          // Deterministically allow queued idle preparation to finish between
          // simulated half-strip advances; normal flight has several seconds.
          await world.prepareReady(width,height,scroll);
          const memory=world.memoryStats();
          maxStrips=Math.max(maxStrips,world.tiles.size+world.sceneryLayers[0].size);
          maxBytes=Math.max(maxBytes,memory.stripBytes);
        }
        reports.push({index,preparationMs,allocations,readbacks,maxStrips,maxBytes,memory:world.memoryStats(),materials:world.terrain.materials.size,edges:world.terrain.edges.size});
        world.warmEpoch++;world.warmJobs=[];
      }
    } finally {window.OffscreenCanvas=NativeCanvas;prototype.getImageData=read;}
    return reports;
  });
  for(const report of reports){
    assert.equal(report.allocations,0,`sector ${report.index}: playing frames allocate no raster surfaces, including first hits`);
    assert.equal(report.readbacks,0,`sector ${report.index}: no artwork grading/readback during combat`);
    assert.equal(report.materials,24);assert.equal(report.edges,252);
    assert.ok(report.maxStrips<=10,`sector ${report.index}: only the viewport and next strips stay resident`);
    const columnBytes=(report.memory.mapWidth+200)*report.memory.detailScale**2*4;
    assert.ok(report.maxBytes<=columnBytes*(5*800+5*800),`sector ${report.index}: buffers stay within five nearby rows per plane at the current viewport width`);
    assert.ok(report.memory.damageSpriteCount<=report.memory.damageSpriteLimit);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(reports.map(({index,preparationMs,allocations,readbacks,maxStrips,maxBytes})=>({index,preparationMs,allocations,readbacks,maxStrips,maxMiB:(maxBytes/1024**2).toFixed(1)}))));
  console.log('PASS all ten sectors: prepared 2× art, zero raster allocations/readbacks in flight or on first building hits, bounded streaming caches.');
} finally {await browser.close();}
