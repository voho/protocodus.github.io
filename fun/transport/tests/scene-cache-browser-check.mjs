// A reused scene must match a fully prepared fresh renderer. Transparent
// strip regrouping may round a few channel values; geometry and picks must match.
// This catches stale culling, depth order, foundations and invalidation on pans.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {installBusyScenes} from './busy-scenes-fixture.mjs';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/',out=process.env.TRANSPORT_OUTPUT||'/tmp/transport-scene-cache';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});const rows=[],errors=[];
try{
  const page=await browser.newPage({viewport:{width:800,height:560},deviceScaleFactor:2});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/busy-scenes-qa',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{width:800px;height:560px}</style><canvas id="cached"></canvas>'}));await page.goto(new URL('busy-scenes-qa',base).href);await page.evaluate(installBusyScenes);
  await page.evaluate(async()=>{
    const{createRenderer}=await import('./renderer.js');const source=document.querySelector('canvas');let operations=[],initialZoom=1,layers={},initialPoint;
    const settle=async renderer=>{renderer.render(1000);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);renderer.render(1000);for(let n=0;renderer.getStats().sceneryBatches?.pending&&n<120;n++){await new Promise(requestAnimationFrame);renderer.render(1000);}if(renderer.getStats().sceneryBatches?.pending)throw new Error('Scenery preparation did not settle.');renderer.render(1000);};
    window.sceneQA={
      async start(scene,zoom){busyQA.select(scene,zoom,'night');initialZoom=zoom;initialPoint={...busyQA.point};operations=[];layers=busyQA.renderer.getLayers();await settle(busyQA.renderer);},
      async change(action){const q=busyQA,r=q.renderer,g=q.game,before=r.getStats();
        if(action==='small-pan'){r.pan(-6,3);operations.push(['pan',-6,3]);}
        if(action==='long-pan'){r.pan(-240,130);operations.push(['pan',-240,130]);}
        if(action==='reverse-pan'){r.pan(240,-130);operations.push(['pan',240,-130]);}
        if(action==='trees-off'){layers={...layers,trees:false};r.setLayers(layers);}
        if(action==='trees-on'){layers={...layers,trees:true};r.setLayers(layers);}
        if(action==='buildings-off'){layers={...layers,buildings:false};r.setLayers(layers);}
        if(action==='buildings-on'){layers={...layers,buildings:true};r.setLayers(layers);}
        if(action==='world-revision'){const x=Math.round(initialPoint.x+6),y=Math.round(initialPoint.y+6),t=g.tiles[y*g.width+x];t.building={kind:'house-cheap-3',footprint:1,level:1};t.terrain='grass';t.detail='';delete t.terrainObject;t.elevation=5/7;g.revision++;}
        if(action==='zoom-return'){const alt=initialZoom===2?1:2;r.setZoom(alt);r.render(1000);r.setZoom(initialZoom);operations.push(['setZoom',alt],['setZoom',initialZoom]);}
        if(action==='art-revision'){const a=await import('./atlas-runtime.js');a.registerAtlas({id:'qa-late-pine',path:'./assets/world/nature-trees-taiga/atlas',maxCell:256,entries:[null,'nature-trees-taiga:pine',null,null,null,null,null,null,null]});await a.preloadWorldArt({waitMs:10000,biome:'taiga'});}
        await settle(r);
        const freshCanvas=document.createElement('canvas');freshCanvas.id='fresh';freshCanvas.style.cssText='position:absolute;left:1000px;top:0;width:800px;height:560px';document.body.append(freshCanvas);
        const fresh=createRenderer(freshCanvas,g,{layers});fresh.resize();fresh.setZoom(initialZoom);fresh.focus(initialPoint.x,initialPoint.y);for(const[name,...args]of operations)fresh[name](...args);await settle(fresh);r.render(1000);
        const a=source.getContext('2d').getImageData(0,0,source.width,source.height).data,b=freshCanvas.getContext('2d').getImageData(0,0,freshCanvas.width,freshCanvas.height).data;let count=0,max=0,sum=0,first=null;
        for(let i=0;i<a.length;i+=4){let diff=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);diff=Math.max(diff,d);sum+=d;max=Math.max(max,d);}if(diff){count++;first??={x:i/4%source.width,y:Math.floor(i/4/source.width),cached:[...a.slice(i,i+4)],fresh:[...b.slice(i,i+4)]};}}
        const picks=[];if(['long-pan','world-revision','trees-on','buildings-on'].includes(action)){for(let py=80;py<560;py+=100)for(let px=80;px<800;px+=160){const a=r.screenToInspectTile(px,py),b=fresh.screenToInspectTile(px+1000,py);if(JSON.stringify(a)!==JSON.stringify(b))picks.push({px,py,cached:a,fresh:b});}}
        const stats=r.getStats(),result={pickDifferences:picks,action,differentPixels:count,maxChannelDifference:max,totalChannelDifference:sum,meanChannelDifference:sum/a.length,first,camera:r.getCamera(),freshCamera:fresh.getCamera(),sceneBuilds:stats.sceneBuilds,beforeBuilds:before.sceneBuilds};freshCanvas.remove();return result;
      }
    };
  });
  for(const scene of(process.env.TRANSPORT_SCENES||'forest,mixed,generated-forest').split(','))for(const zoom of[.5,1,2]){
    await page.evaluate(({scene,zoom})=>sceneQA.start(scene,zoom),{scene,zoom});
    for(const action of['warm','small-pan','small-pan','long-pan','reverse-pan','trees-off','trees-on','buildings-off','buildings-on','world-revision','zoom-return',...(scene==='mixed'&&zoom===2?['art-revision']:[])]){
      const row={scene,zoom,...await page.evaluate(action=>sceneQA.change(action),action)};rows.push(row);console.log(JSON.stringify(row));
      if(row.maxChannelDifference>4||row.meanChannelDifference>.02){await page.locator('#cached').screenshot({path:`${out}/${scene}-${zoom}-${action}-cached.png`});await writeFile(`${out}/results.json`,JSON.stringify({rows,errors},null,2));}
      assert.deepEqual(row.pickDifferences,[],'cached scenery retains identical picking');assert.ok(row.maxChannelDifference<=4&&row.meanChannelDifference<=.02,`${scene}/${zoom}/${action}: only tiny transparent-compositing roundoff is allowed`);
      if(action==='small-pan'&&row.sceneBuilds!==undefined)assert.equal(row.sceneBuilds,row.beforeBuilds,'small pan reuses prepared scenery');
      if(['world-revision','art-revision','trees-off','trees-on','buildings-off','buildings-on','zoom-return'].includes(action)&&row.sceneBuilds!==undefined)assert.ok(row.sceneBuilds>row.beforeBuilds,'changed scenery is rebuilt before drawing');
    }
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({rows,errors},null,2));
}finally{await browser.close();}
