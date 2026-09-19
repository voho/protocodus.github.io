// Real browser checks for seeded tile rendering, depth-correct hits and bounded caches.
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
    const {WorldRenderer,WORLDS,PARALLAX_LAYERS}=await import('./worlds.js');
    const canvas=document.querySelector('canvas'),c=canvas.getContext('2d');
    canvas.width=1200;canvas.height=960;
    const result=[];
    for(let worldIndex=0;worldIndex<10;worldIndex++) {
      const w=new WorldRenderer();w.setWorld(worldIndex);await w.ready;
      // Cancel idle jobs so every measurement belongs to the operation under test.
      w.warmEpoch++;w.warmJobs=[];w.queueWarm=()=>{};
      const cold=[],warm=[],hits=[];
      for(const width of [430,1200,1900])for(const focus of [0,width*.5,width]) {
        canvas.width=width;canvas.height=960;
        const start=performance.now();w.draw(c,width,960,6400,2,'high',focus);cold.push(performance.now()-start);
        for(let i=0;i<12;i++){const start=performance.now();w.draw(c,width,960,6400+i*.6,2+i/60,'high',focus);warm.push(performance.now()-start);}
        for(let depth=0;depth<3;depth++) {
          const p=w.visibleProps.find(p=>p.depth===depth&&p.screenY>50&&p.screenY<960/w.scale-50&&p.screenX>30&&p.screenX<1170);
          if(!p)continue;
          const before=p.hp;
          w.hit(p.screenX*w.scale,p.screenY*w.scale,0,.5,w.scroll);
          hits.push(p.hp<before);
        }
        // Full coverage at both edges, even during maximum lateral drift.
        const pixels=c.getImageData(0,0,width,960).data;
        for(let y=0;y<960;y+=40)for(const x of [0,width-1])hits.push(pixels[(y*width+x)*4+3]===255);
      }
      canvas.width=1200;w.draw(c,1200,960,440,2,'high',600);
      const p=w.visibleProps.find(p=>p.screenY>40&&p.screenY<850&&p.screenX>50&&p.screenX<1150);
      w.hit(p.screenX,p.screenY,0,1,440);const hp=p.hp,id=p.id,row=p.row;
      w.draw(c,1200,960,150000,2,'low');w.draw(c,1200,960,440,2,'high',600);
      const retained=w.getBand(row).find(p=>p.id===id);
      const damagePersistent=retained.hp===hp&&retained.x===p.x&&retained.y===p.y;
      const destroyed=w.hit(retained.screenX,retained.screenY,0,100000,440);
      w.draw(c,1200,960,150000,2,'low');w.draw(c,1200,960,440,2,'high');
      const paidTwice=w.hit(retained.screenX,retained.screenY,0,100000,440).some(e=>e.id===id);
      // Warm rendering cannot rasterize new sprites or build gradients.
      w.draw(c,1200,960,440,2,'high');let gradients=0;
      const proto=CanvasRenderingContext2D.prototype,radial=proto.createRadialGradient,linear=proto.createLinearGradient;
      proto.createRadialGradient=function(...args){gradients++;return radial.apply(this,args);};
      proto.createLinearGradient=function(...args){gradients++;return linear.apply(this,args);};
      w.draw(c,1200,960,440,2,'high');proto.createRadialGradient=radial;proto.createLinearGradient=linear;
      // Equivalent hashes render identical pixels; another seed changes terrain.
      const render=seed=>{w.setWorld(worldIndex,seed);w.warmEpoch++;w.warmJobs=[];w.draw(c,1200,960,440,2,'high');return canvas.toDataURL();};
      const first=render('qa-seed'),same=render('qa-seed'),other=render('other-seed');
      let maxTiles=0,maxScenery=0,maxBands=0,driftBounded=true;
      for(let i=0;i<120;i++){
        w.draw(c,1200,960,i*80000,2,'low');
        maxTiles=Math.max(maxTiles,w.tiles.size);maxScenery=Math.max(maxScenery,...w.sceneryLayers.map(cache=>cache.size));maxBands=Math.max(maxBands,w.bands.size);
        for(const p of w.visibleProps)if(p.screenY>=0&&p.screenY<=960){
          driftBounded&&=Math.abs(p.screenY-(p.y+w.scroll))<=960*.11/2;
        }
      }
      warm.sort((a,b)=>a-b);
      result.push({world:WORLDS[worldIndex].id,hash:w.levelHash,hitsAligned:hits.every(Boolean),damagePersistent,destroyed:destroyed.some(e=>e.id===id),paidTwice,gradients,deterministic:first===same,seedChanges:first!==other,driftBounded,maxTiles,maxScenery,maxBands,coldMaxMs:Math.max(...cold),medianMs:warm[Math.floor(warm.length*.5)],p95Ms:warm[Math.floor(warm.length*.95)]});
      w.warmEpoch++;w.warmJobs=[];
    }
    return {worlds:result,layers:PARALLAX_LAYERS.map(l=>l.id)};
  });
  for(const r of results.worlds){
    assert(r.hitsAligned,`${r.world}: visual positions and hitboxes agree across depths/widths/focus`);
    assert(r.damagePersistent&&r.destroyed&&!r.paidTwice,`${r.world}: damage survives eviction without duplicate rewards`);
    assert(r.deterministic&&r.seedChanges,`${r.world}: level hash drives rendered terrain`);
    assert.equal(r.gradients,0,`${r.world}: no gradients during warm rendering`);
    assert(r.driftBounded,`${r.world}: scenery stays above its original terrain over long flights`);
    assert(r.maxTiles<=5&&r.maxScenery<=6&&r.maxBands<=6,`${r.world}: terrain caches stay bounded: ${JSON.stringify(r)}`);
  }
  assert.deepEqual(results.layers,['substrate','ground','ridge','canopy','foreground']);
  assert.deepEqual(landscapes,[],'No sliced landscape image requests');assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  console.log('World QA passed: seeded tiles, all ten biomes, depth-correct hits, coverage, persistent damage and bounded caches.');
} finally {await browser.close();}
