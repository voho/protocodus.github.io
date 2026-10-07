// Paired rendering proves that scenery batches preserve sprite placement,
// vehicle occlusion, picking and invalidation; no app or save state is touched.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {installBusyScenes} from './busy-scenes-fixture.mjs';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/',out=process.env.TRANSPORT_OUTPUT||'/tmp/transport-scenery-batches';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true}),rows=[],errors=[];
try {
  for(const dpr of (process.env.TRANSPORT_DPRS||'1,1.25,2').split(',').map(Number)){
    const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:dpr});page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/busy-scenes-qa',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{width:1280px;height:900px;position:absolute;inset:0}</style><canvas id="batched"></canvas><canvas id="direct"></canvas>'}));
    await page.goto(new URL('busy-scenes-qa',base).href);await page.evaluate(installBusyScenes);
    await page.evaluate(async()=>{const{createRenderer}=await import('./renderer.js');busyQA.select('forest',1,'day');window.directRenderer=createRenderer(document.querySelector('#direct'),busyQA.game,{sceneryBatching:false});});
    for(const scene of (process.env.TRANSPORT_SCENES||'forest,city,mixed').split(','))for(const zoom of (process.env.TRANSPORT_ZOOMS||'.5,1,2').split(',').map(Number)){
      const result=await page.evaluate(async({scene,zoom})=>{
        const q=busyQA,direct=directRenderer,condition='day';q.renderer.setLayers({trees:true,buildings:true});q.select(scene,zoom,condition);
        // Large calibrated city parcels can leave fewer than four objects in
        // every strip at Detail/DPR2, correctly using direct drawing. Add a
        // compact diagonal stand so this fixture always exercises strip reuse
        // alongside that direct fallback, even at the highest tested density.
        if(['city','mixed'].includes(scene)&&!q.game.sceneryQAStand){
          for(const depth of [244,248,252,256,260,264])for(let x=108;x<149;x++){
            const y=depth-x;q.game.tiles[y*q.game.width+x]={terrain:'forest',elevation:4/7,detail:'mixed',variant:(x+depth)%64};
          }
          q.game.sceneryQAStand=true;q.game.revision++;
        }
        direct.setGame(q.game);direct.setZoom(zoom);direct.focus(q.point.x,q.point.y);direct.setLayers(q.renderer.getLayers());
        const pair=()=>{q.renderer.render(1000);direct.render(1000);};pair();await new Promise(r=>setTimeout(r,70));pair();
        const compare=stage=>{
          const a=document.querySelector('#batched'),b=document.querySelector('#direct'),aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
          let max=0,total=0,large=0,largest=[];for(let i=0;i<aa.length;i++){const difference=Math.abs(aa[i]-bb[i]);max=Math.max(max,difference);total+=difference;if(difference>24){large++;if(largest.length<8)largest.push({x:Math.floor(i/4)%a.width,y:Math.floor(i/(4*a.width)),channel:i%4,a:aa[i],b:bb[i]});}}
          const picks=[];for(let y=60;y<900;y+=155)for(let x=60;x<1280;x+=165){const a=q.renderer.screenToInspectTile(x,y),b=direct.screenToInspectTile(x,y);if(a.x!==b.x||a.y!==b.y)picks.push({x,y,batched:a,direct:b});}
          for(const [x,y] of [[2,2],[640,2],[1277,2],[2,450],[1277,450],[2,897],[640,897],[1277,897]])for(const method of ['screenToTile','screenToInspectTile']){const a=q.renderer[method](x,y),b=direct[method](x,y);if(a.x!==b.x||a.y!==b.y)picks.push({x,y,method,batched:a,direct:b});}
          return{stage,max,mean:total/aa.length,pixels:aa.length/4,large,largest,picks,stats:q.renderer.getStats().sceneryBatches};
        };
        const stages=[compare('initial')],builds=q.renderer.getStats().sceneBuilds;let warmFrames=0;
        while(q.renderer.getStats().sceneryBatches.pending&&warmFrames<120){await new Promise(requestAnimationFrame);pair();if(warmFrames===0||warmFrames===3)stages.push(compare(`preparing-${warmFrames}`));warmFrames++;}
        pair();stages.push(compare('prepared'));
        const remaining=q.renderer.getStats().sceneryBatches.pending;
        q.advance(15);pair();stages.push(compare('moving'));
        q.renderer.pan(-4,2);direct.pan(-4,2);pair();stages.push(compare('pan'));
        const warmBuilds=q.renderer.getStats().sceneBuilds-builds;
        q.renderer.pan(-160,70);direct.pan(-160,70);pair();stages.push(compare('pan-rebuild'));
        const panPreparation=[];
        for(let n=0;n<8;n++){q.renderer.pan(-8,4);direct.pan(-8,4);pair();panPreparation.push(q.renderer.getStats().sceneryBatches.preparationMs);await new Promise(requestAnimationFrame);}
        stages.push(compare('continuous-pan'));
        // Move through several world-space cache boundaries, then reverse with
        // fractional pointer deltas. Native pixel registration and edge culling
        // must hold both while preparing new strips and replaying old ones.
        const reusedBefore=q.renderer.getStats().sceneryBatches.reuses;
        for(const direction of [-1,1])for(let n=0;n<20;n++){
          const dx=direction*18.25*zoom,dy=-direction*9.125*zoom;
          q.renderer.pan(dx,dy);direct.pan(dx,dy);pair();panPreparation.push(q.renderer.getStats().sceneryBatches.preparationMs);
          if(n%5===0||n===19)stages.push(compare(`boundary-pan-${direction}-${n}`));
          await new Promise(requestAnimationFrame);
        }
        const reusedDuringPan=q.renderer.getStats().sceneryBatches.reuses-reusedBefore;
        await new Promise(r=>setTimeout(r,100));let settleFrames=0;
        while(q.renderer.getStats().sceneryBatches.pending&&settleFrames<120){pair();settleFrames++;await new Promise(requestAnimationFrame);}
        pair();stages.push(compare('pan-settled'));
        const settledPending=q.renderer.getStats().sceneryBatches.pending;
        const x=Math.floor(q.point.x),y=Math.floor(q.point.y),t=q.game.tiles[y*q.game.width+x];q.game.tiles[y*q.game.width+x]={...t,terrain:'grass',detail:'',building:null,cleared:true};q.game.revision++;pair();stages.push(compare('edited'));
        q.renderer.setLayers({trees:false,buildings:false});direct.setLayers({trees:false,buildings:false});pair();stages.push(compare('hidden'));
        return {scene,zoom,condition,warmBuilds,warmFrames,remaining,panPreparation,reusedDuringPan,settledPending,stages};
      },{scene,zoom});
      assert.equal(result.remaining,0,'bounded preparation must eventually finish');
      assert.equal(result.settledPending,0,'bounded preparation finishes after the camera settles');
      assert.ok(result.panPreparation.every(ms=>Number.isFinite(ms)&&ms>=0),'dragging uses finite bounded preparation work');
      assert.ok(result.reusedDuringPan>0,'recentered scenes preserve unchanged prepared strips');
      assert.equal(result.warmBuilds,0,'small pans and vehicle motion must reuse prepared scenery');
      for(const stage of result.stages){assert.ok(stage.large<=Math.ceil(stage.pixels*.00001)&&stage.max<64,`${scene}/${zoom}/DPR${dpr}/${stage.stage}: geometry/occlusion differs ${JSON.stringify(stage.largest)}`);assert.ok(stage.mean<.5,'transparent compositing must remain visually equivalent');assert.deepEqual(stage.picks,[],`${scene}/${zoom}/${stage.stage}: picking differs`);assert.ok(stage.stats.bytes<=stage.stats.limit);assert.ok(stage.stats.viewBytes<=stage.stats.viewLimit);assert.equal(stage.stats.preparationBudgetMs,3,'scenery preparation keeps its time budget');}
      rows.push({dpr,...result});console.log(JSON.stringify({dpr,scene,zoom,max:Math.max(...result.stages.map(s=>s.max)),checks:result.stages.length}));
      if(dpr===2&&zoom===1){await page.evaluate(({scene,zoom})=>{busyQA.renderer.setLayers({trees:true,buildings:true});busyQA.select(scene,zoom,'day');busyQA.renderer.render(1000);},{scene,zoom});const data=await page.locator('#batched').evaluate(canvas=>canvas.toDataURL().split(',')[1]);await writeFile(`${out}/${scene}.png`,Buffer.from(data,'base64'));}
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({rows,errors},null,2));
} finally {await browser.close();}
