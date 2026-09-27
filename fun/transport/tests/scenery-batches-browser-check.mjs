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
        const q=busyQA,direct=directRenderer,condition=scene==='mixed'?'night':'day';q.renderer.setLayers({trees:true,buildings:true});q.select(scene,zoom,condition);direct.setGame(q.game);direct.setZoom(zoom);direct.focus(q.point.x,q.point.y);direct.setLayers(q.renderer.getLayers());
        const pair=()=>{q.renderer.render(1000);direct.render(1000);};pair();await new Promise(r=>setTimeout(r,70));pair();
        const compare=stage=>{
          const a=document.querySelector('#batched'),b=document.querySelector('#direct'),aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
          let max=0,total=0,large=0,largest=[];for(let i=0;i<aa.length;i++){const difference=Math.abs(aa[i]-bb[i]);max=Math.max(max,difference);total+=difference;if(difference>24){large++;if(largest.length<8)largest.push({x:Math.floor(i/4)%a.width,y:Math.floor(i/(4*a.width)),channel:i%4,a:aa[i],b:bb[i]});}}
          const picks=[];for(let y=60;y<900;y+=155)for(let x=60;x<1280;x+=165){const a=q.renderer.screenToInspectTile(x,y),b=direct.screenToInspectTile(x,y);if(a.x!==b.x||a.y!==b.y)picks.push({x,y,batched:a,direct:b});}
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
        await new Promise(r=>setTimeout(r,100));let settleFrames=0;
        while(q.renderer.getStats().sceneryBatches.pending&&settleFrames<120){pair();settleFrames++;await new Promise(requestAnimationFrame);}
        pair();stages.push(compare('pan-settled'));
        const settledPending=q.renderer.getStats().sceneryBatches.pending;
        const x=Math.floor(q.point.x),y=Math.floor(q.point.y),t=q.game.tiles[y*q.game.width+x];q.game.tiles[y*q.game.width+x]={...t,terrain:'grass',detail:'',building:null,cleared:true};q.game.revision++;pair();stages.push(compare('edited'));
        q.renderer.setLayers({trees:false,buildings:false});direct.setLayers({trees:false,buildings:false});pair();stages.push(compare('hidden'));
        return {scene,zoom,condition,warmBuilds,warmFrames,remaining,panPreparation,settledPending,stages};
      },{scene,zoom});
      assert.equal(result.remaining,0,'bounded preparation must eventually finish');
      assert.equal(result.settledPending,0,'preparation resumes when the camera settles');
      assert.ok(result.panPreparation.every(ms=>ms===0),'dragging must never spend time preparing scenery');
      assert.equal(result.warmBuilds,0,'small pans and vehicle motion must reuse prepared scenery');
      for(const stage of result.stages){assert.ok(stage.large<=Math.ceil(stage.pixels*.00001)&&stage.max<64,`${scene}/${zoom}/DPR${dpr}/${stage.stage}: geometry/occlusion differs ${JSON.stringify(stage.largest)}`);assert.ok(stage.mean<.5,'transparent compositing must remain visually equivalent');assert.deepEqual(stage.picks,[],`${scene}/${zoom}/${stage.stage}: picking differs`);assert.ok(stage.stats.bytes<=stage.stats.limit);}
      rows.push({dpr,...result});console.log(JSON.stringify({dpr,scene,zoom,max:Math.max(...result.stages.map(s=>s.max)),checks:result.stages.length}));
      if(dpr===2&&zoom===1){await page.evaluate(({scene,zoom})=>{busyQA.renderer.setLayers({trees:true,buildings:true});busyQA.select(scene,zoom,scene==='mixed'?'night':'day');busyQA.renderer.render(1000);},{scene,zoom});const data=await page.locator('#batched').evaluate(canvas=>canvas.toDataURL().split(',')[1]);await writeFile(`${out}/${scene}.png`,Buffer.from(data,'base64'));}
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({rows,errors},null,2));
} finally {await browser.close();}
