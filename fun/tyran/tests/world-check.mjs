// Seeded tile rendering, a unified ground plane, durable scenery and bounded caches.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TYRAN_PLAYWRIGHT||'playwright');
const output=process.env.TYRAN_WORLD_OUTPUT||'/tmp/tyran-world-qa';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],landscapes=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/world-[^/]+\.webp|terrain-tiles/.test(r.url()))landscapes.push(r.url());});
  await page.goto(new URL('worlds.js',process.env.TYRAN_URL||'http://127.0.0.1:8773/fun/tyran/').href);
  await page.setContent('<body style="margin:0;background:#09131c"><canvas id="world"></canvas></body>');
  const results=await page.evaluate(async()=>{
    const {WorldRenderer,WORLDS,PARALLAX_LAYERS,structureDurability,structureStage}=await import('./worlds.js');
    const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');
    const buildings=new Set(['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite']);
    canvas.width=1200;canvas.height=960;
    const result=[];
    for(let worldIndex=0;worldIndex<10;worldIndex++) {
      const w=new WorldRenderer();w.setWorld(worldIndex);await w.ready;
      // Cancel idle jobs so every measurement belongs to the operation under test.
      w.warmEpoch++;w.warmJobs=[];w.queueWarm=()=>{};
      const cold=[],warm=[],hits=[],protectedHits=[];
      for(const width of [430,1200,1900])for(const focus of [0,width*.5,width]) {
        canvas.width=width;canvas.height=960;
        const start=performance.now();w.draw(c,width,960,6400,2,'high',focus);cold.push(performance.now()-start);
        for(let i=0;i<12;i++){const start=performance.now();w.draw(c,width,960,6400+i*.6,2+i/60,'high',focus);warm.push(performance.now()-start);}
        for(const type of new Set(w.visibleProps.map(prop=>prop.type))) {
          const p=w.visibleProps.find(p=>p.type===type&&p.screenY>50&&p.screenY<960/w.scale-50&&p.screenX>30&&p.screenX<width-30);
          if(!p)continue;
          const before=p.hp;
          w.hit(p.screenX*w.scale,p.screenY*w.scale,0,.5,w.scroll);
          if(buildings.has(p.type))hits.push(p.hp<before);
          else protectedHits.push(p.hp===before&&!w.damage.has(p.id)&&!w.destroyed.has(p.id));
        }
        // Full coverage at both edges, even during maximum lateral drift.
        const pixels=c.getImageData(0,0,width,960).data;
        for(let y=0;y<960;y+=40)for(const x of [0,width-1])hits.push(pixels[(y*width+x)*4+3]===255);
      }
      canvas.width=1200;
      // Center a seeded building so sparse orbital/natural districts are also covered.
      const target=Array.from({length:7},(_,i)=>w.getBand(i-3)).flat().find(p=>buildings.has(p.type)&&p.x>50&&p.x<1150);
      const trackedScroll=400-target.y;w.draw(c,1200,960,trackedScroll,2,'high',600);
      const p=w.visibleProps.find(p=>p.id===target.id);
      w.hit(p.screenX,p.screenY,0,1,trackedScroll);const hp=p.hp,id=p.id,row=p.row;
      w.draw(c,1200,960,150000,2,'low');w.draw(c,1200,960,trackedScroll,2,'high',600);
      const retained=w.getBand(row).find(p=>p.id===id);
      const damagePersistent=retained.hp===hp&&retained.x===p.x&&retained.y===p.y;
      const destroyed=w.hit(retained.screenX,retained.screenY,0,100000,trackedScroll);
      w.draw(c,1200,960,150000,2,'low');w.draw(c,1200,960,trackedScroll,2,'high');
      const paidTwice=w.hit(retained.screenX,retained.screenY,0,100000,trackedScroll).some(e=>e.id===id);
      // Destroyed IDs can be restored independently of the remaining-HP ledger.
      // Retrying the same seed must invalidate those cached craters as well.
      w.restoreDamage([],[id]);w.draw(c,1200,960,trackedScroll,2,'high');
      w.setWorld(worldIndex);
      const resetClean=w.sceneryLayers[0].size===0&&w.destroyed.size===0;
      // Warm rendering cannot rasterize new sprites or build gradients.
      w.draw(c,1200,960,trackedScroll,2,'high');let gradients=0;
      const proto=CanvasRenderingContext2D.prototype,radial=proto.createRadialGradient,linear=proto.createLinearGradient;
      proto.createRadialGradient=function(...args){gradients++;return radial.apply(this,args);};
      proto.createLinearGradient=function(...args){gradients++;return linear.apply(this,args);};
      w.draw(c,1200,960,trackedScroll,2,'high');proto.createRadialGradient=radial;proto.createLinearGradient=linear;
      // Equivalent hashes render identical pixels; another seed changes terrain.
      const render=seed=>{w.setWorld(worldIndex,seed);w.warmEpoch++;w.warmJobs=[];w.draw(c,1200,960,440,2,'high');return canvas.toDataURL();};
      const first=render('qa-seed'),same=render('qa-seed'),other=render('other-seed');
      let maxTiles=0,maxScenery=0,maxBands=0,driftBounded=true;
      for(let i=0;i<120;i++){
        w.draw(c,1200,960,i*80000,2,'low');
        maxTiles=Math.max(maxTiles,w.tiles.size);maxScenery=Math.max(maxScenery,...w.sceneryLayers.map(cache=>cache.size));maxBands=Math.max(maxBands,w.bands.size);
        for(const p of w.visibleProps)if(p.screenY>=0&&p.screenY<=960){
          driftBounded&&=p.screenY===p.y+w.scroll&&p.screenX===p.x+w.parallaxX;
        }
      }
      warm.sort((a,b)=>a-b);
      result.push({world:WORLDS[worldIndex].id,hash:w.levelHash,hitsAligned:hits.every(Boolean),protectedHits:protectedHits.length,protectedUnchanged:protectedHits.every(Boolean),damagePersistent,destroyed:destroyed.some(e=>e.id===id),paidTwice,resetClean,gradients,deterministic:first===same,seedChanges:first!==other,driftBounded,groundPlanes:w.sceneryLayers.length,maxTiles,maxScenery,maxBands,coldMaxMs:Math.max(...cold),medianMs:warm[Math.floor(warm.length*.5)],p95Ms:warm[Math.floor(warm.length*.95)]});
      w.warmEpoch++;w.warmJobs=[];
    }
    const structureTypes=['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite','crawler','hauler'];
    return {worlds:result,layers:PARALLAX_LAYERS.map(l=>l.id),durability:structureTypes.map(type=>({type,small:structureDurability(type,40),large:structureDurability(type,80)})),stages:[1,.71,.7,.36,.35,.01,0].map(health=>structureStage({hp:health*100,maxHp:100}))};
  });
  for(const r of results.worlds){
    assert(r.hitsAligned,`${r.world}: visual positions and building hitboxes agree across widths/focus`);
    assert(r.protectedHits>0&&r.protectedUnchanged,`${r.world}: nature and vehicles ignore hits without entering destruction ledgers`);
    assert(r.damagePersistent&&r.destroyed&&!r.paidTwice,`${r.world}: damage survives eviction without duplicate rewards`);
    assert(r.resetClean,`${r.world}: retry resets cached craters even without a remaining-HP entry`);
    assert(r.deterministic&&r.seedChanges,`${r.world}: level hash drives rendered terrain`);
    assert.equal(r.gradients,0,`${r.world}: no gradients during warm rendering`);
    assert(r.driftBounded&&r.groundPlanes===1,`${r.world}: every ground object uses exactly the terrain translation`);
    assert(r.maxTiles<=5&&r.maxScenery<=6&&r.maxBands<=6,`${r.world}: terrain caches stay bounded: ${JSON.stringify(r)}`);
  }
  assert.deepEqual(results.layers,['ground','atmosphere','foreground']);
  assert.deepEqual(results.stages,[0,0,1,1,2,2,3]);
  for(const {type,small,large} of results.durability){
    assert(Math.abs(large-small*4)<=2,`${type}: durability grows with footprint area`);
    assert(small>(12+40*.22)*4,`${type}: even small ground assets withstand substantially more damage`);
  }
  assert.deepEqual(landscapes,[],'No sliced landscape image requests');assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  console.log('World QA passed: seeded tiles, one ground plane, atmospheric/foreground parallax, protected nature and vehicles, area-based durability, persistent damage and bounded caches.');
} finally {await browser.close();}
