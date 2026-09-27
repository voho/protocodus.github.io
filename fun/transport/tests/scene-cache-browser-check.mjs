// A reused scene must match a fully prepared fresh renderer. Transparent
// strip regrouping may round a few channel values; geometry and picks must match.
// This catches stale culling, depth order, foundations and invalidation on pans.
// Journaled ecology days keep chunks, indexes and route paths: those frames must
// match a fresh renderer exactly, by day and night, at DPR 1 and 2.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {installBusyScenes} from './busy-scenes-fixture.mjs';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/',out=process.env.TRANSPORT_OUTPUT||'/tmp/transport-scene-cache';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});const rows=[],errors=[];
async function open(deviceScaleFactor){
  const page=await browser.newPage({viewport:{width:800,height:560},deviceScaleFactor});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/busy-scenes-qa',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{width:800px;height:560px}</style><canvas id="cached"></canvas>'}));await page.goto(new URL('busy-scenes-qa',base).href);await page.evaluate(installBusyScenes);
  await page.evaluate(async()=>{
    const{createRenderer}=await import('./renderer.js');const source=document.querySelector('canvas');let operations=[],initialZoom=1,layers={},initialPoint;
    const settle=async renderer=>{renderer.render(1000);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);renderer.render(1000);for(let n=0;renderer.getStats().sceneryBatches?.pending&&n<120;n++){await new Promise(requestAnimationFrame);renderer.render(1000);}if(renderer.getStats().sceneryBatches?.pending)throw new Error('Scenery preparation did not settle.');renderer.render(1000);};
    // Ecology-shaped edits only: terrain, detail and dissolved groves, journaled
    // like stepEcology, in view, on a chunk seam, out of view and a whole 3×3 grove.
    async function ecology(g,r){
      const [{stepEcology},{noteSurfaceChanges,surfaceChangesSince},{terrainObjectAt,terrainObjectSiteProblem,releaseTerrainObjectsCells},{buildingAt}]=await Promise.all([import('./environment.js'),import('./change-journal.js'),import('./terrain-objects.js'),import('./building-sites.js')]);
      const at=(x,y)=>g.tiles[y*g.width+x],inView=([x,y])=>{const p=r.worldToScreen(x,y);return p.x>=0&&p.y>=0&&p.x<800&&p.y<560;};let px=Math.round(initialPoint.x),py=Math.round(initialPoint.y);
      const taken=new Set([...g.industries,...g.stations,...g.cities].map(p=>`${p.x},${p.y}`));
      const eligible=(x,y)=>{const t=x>=0&&y>=0&&x<g.width&&y<g.height&&at(x,y);return t&&!t.road&&!t.rail&&!t.bridge&&!t.tunnel&&!t.publicRoad&&!t.building&&!t.zone&&!buildingAt(g,x,y)&&!taken.has(`${x},${y}`)&&['grass','sand','snow','forest'].includes(t.terrain);};
      // The nearest natural 3×3 grove or level forest parcel; a distant one is
      // brought into view with a camera move that the fresh renderer replays.
      const spiral=(radius,visit)=>{for(let d=0;d<=radius;d++)for(let dy=-d;dy<=d;dy++)for(let dx=-d;dx<=d;dx++)if(Math.max(Math.abs(dx),Math.abs(dy))===d&&visit(px+dx,py+dy))return;};
      let grove=null;
      spiral(40,(x,y)=>{const site=terrainObjectAt(g,x,y);if(site?.object.footprint===3&&site.object.kind==='forest')grove={...site,placed:false};return grove;});
      if(!grove)spiral(40,(x,y)=>{if(terrainObjectSiteProblem(g,'forest',x,y,3))return false;at(x,y).terrainObject={kind:'forest',detail:at(x,y).detail||'pine',variant:5,footprint:3};grove={x,y,placed:true};return true;});
      const moved=grove&&!inView([grove.x+1,grove.y+1]);if(moved){px=grove.x+1;py=grove.y+1;r.focus(px,py);operations.push(['focus',px,py]);}
      if(grove?.placed)g.revision++;if(grove?.placed||moved)await settle(r);
      const from=g.revision,before=r.getStats(),cells=[],flipped=new Set();
      const flip=([x,y])=>{const t=at(x,y),id=y*g.width+x;if(flipped.has(id))return;flipped.add(id);cells.push(id);if(t.terrain==='forest'){t.terrain='grass';t.detail='marsh';}else{t.terrain='forest';t.detail='pine';}};
      const near=(x0,y0,radius,limit,test=()=>true)=>{const found=[];for(let d=0;d<=radius&&found.length<limit;d++)for(let dy=-d;dy<=d&&found.length<limit;dy++)for(let dx=-d;dx<=d&&found.length<limit;dx++){const x=x0+dx,y=y0+dy;if(Math.max(Math.abs(dx),Math.abs(dy))===d&&!flipped.has(y*g.width+x)&&eligible(x,y)&&test(x,y))found.push([x,y]);}return found;};
      if(grove){cells.push(...releaseTerrainObjectsCells(g,[{x:grove.x+1,y:grove.y+1}]));flip([grove.x+1,grove.y+1]);}
      const seams=[...near(px,py,14,4,x=>x%6===5||x%6===0),...near(px,py,14,2,(x,y)=>y%6===5||y%6===0)],inside=near(px+2,py-2,8,2),outside=[...near(px+70,py+70,14,1),...near(px-70,py+40,14,1)];
      [...seams,...inside,...outside].forEach(flip);
      g.revision++;noteSurfaceChanges(g,from,g.revision,cells);
      const day=g.day;let grown=0;for(let n=1;n<=3;n++){g.day=day+n;grown+=stepEcology(g);}g.day=day;
      return{from,before,journaled:surfaceChangesSince(g,from)?.length??null,edited:cells.length,grown,grove:grove?(grove.placed?'placed':'existing'):null,groveInView:Boolean(grove&&inView([grove.x+1,grove.y+1])),seamsInView:seams.filter(inView).length,insideInView:inside.filter(inView).length,outsideOfView:outside.filter(p=>!inView(p)).length};
    }
    window.sceneQA={
      async start(scene,zoom,condition='night'){busyQA.select(scene,zoom,condition);initialZoom=zoom;initialPoint={...busyQA.point};operations=[];layers=busyQA.renderer.getLayers();await settle(busyQA.renderer);},
      async change(action){const q=busyQA,r=q.renderer,g=q.game;let before=r.getStats(),surface=null;
        if(action==='small-pan'){r.pan(-6,3);operations.push(['pan',-6,3]);}
        if(action==='long-pan'){r.pan(-240,130);operations.push(['pan',-240,130]);}
        if(action==='reverse-pan'){r.pan(240,-130);operations.push(['pan',240,-130]);}
        if(action==='trees-off'){layers={...layers,trees:false};r.setLayers(layers);}
        if(action==='trees-on'){layers={...layers,trees:true};r.setLayers(layers);}
        if(action==='buildings-off'){layers={...layers,buildings:false};r.setLayers(layers);}
        if(action==='buildings-on'){layers={...layers,buildings:true};r.setLayers(layers);}
        if(action==='world-revision'){const x=Math.round(initialPoint.x+6),y=Math.round(initialPoint.y+6),t=g.tiles[y*g.width+x];t.building={kind:'house-cheap-3',footprint:1,level:1};t.terrain='grass';t.detail='';delete t.terrainObject;t.elevation=5/7;g.revision++;}
        if(action==='ecology'){surface=await ecology(g,r);before=surface.before;}
        if(action==='zoom-return'){const alt=initialZoom===2?1:2;r.setZoom(alt);r.render(1000);r.setZoom(initialZoom);operations.push(['setZoom',alt],['setZoom',initialZoom]);}
        if(action==='art-revision'){const a=await import('./atlas-runtime.js');a.registerAtlas({id:'qa-late-pine',path:'./assets/world/nature-trees-taiga/atlas',maxCell:256,entries:[null,'nature-trees-taiga:pine',null,null,null,null,null,null,null]});await a.preloadWorldArt({waitMs:10000,biome:'taiga'});}
        await settle(r);
        const freshCanvas=document.createElement('canvas');freshCanvas.id='fresh';freshCanvas.style.cssText='position:absolute;left:1000px;top:0;width:800px;height:560px';document.body.append(freshCanvas);
        const fresh=createRenderer(freshCanvas,g,{layers});fresh.resize();fresh.setZoom(initialZoom);fresh.focus(initialPoint.x,initialPoint.y);for(const[name,...args]of operations)fresh[name](...args);await settle(fresh);r.render(1000);
        const a=source.getContext('2d').getImageData(0,0,source.width,source.height).data,b=freshCanvas.getContext('2d').getImageData(0,0,freshCanvas.width,freshCanvas.height).data;let count=0,max=0,sum=0,first=null;
        for(let i=0;i<a.length;i+=4){let diff=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);diff=Math.max(diff,d);sum+=d;max=Math.max(max,d);}if(diff){count++;first??={x:i/4%source.width,y:Math.floor(i/4/source.width),cached:[...a.slice(i,i+4)],fresh:[...b.slice(i,i+4)]};}}
        const picks=[];if(['long-pan','world-revision','ecology','trees-on','buildings-on'].includes(action)){for(let py=80;py<560;py+=100)for(let px=80;px<800;px+=160){const a=r.screenToInspectTile(px,py),b=fresh.screenToInspectTile(px+1000,py);if(JSON.stringify(a)!==JSON.stringify(b))picks.push({px,py,cached:a,fresh:b});}}
        const stats=r.getStats(),result={pickDifferences:picks,action,differentPixels:count,maxChannelDifference:max,totalChannelDifference:sum,meanChannelDifference:sum/a.length,first,camera:r.getCamera(),freshCamera:fresh.getCamera(),sceneBuilds:stats.sceneBuilds,beforeBuilds:before.sceneBuilds,routePathBuilds:stats.routePathBuilds-before.routePathBuilds};
        if(surface)Object.assign(result,{journaled:surface.journaled,edited:surface.edited,grown:surface.grown,grove:surface.grove,groveInView:surface.groveInView,seamsInView:surface.seamsInView,insideInView:surface.insideInView,outsideOfView:surface.outsideOfView,emitterBuilds:stats.lighting.emitterBuilds-before.lighting.emitterBuilds,staticEmitters:stats.lighting.staticEmitters,foundationBuilds:stats.foundationBuilds-before.foundationBuilds,chunkCount:stats.chunkCount,chunksBefore:before.chunkCount});
        freshCanvas.remove();return result;
      }
    };
  });
  return page;
}
function check(row){
  assert.deepEqual(row.pickDifferences,[],'cached scenery retains identical picking');assert.ok(row.maxChannelDifference<=4&&row.meanChannelDifference<=.02,`${row.scene}/${row.zoom}/${row.action}: only tiny transparent-compositing roundoff is allowed`);
  if(row.action==='small-pan'&&row.sceneBuilds!==undefined)assert.equal(row.sceneBuilds,row.beforeBuilds,'small pan reuses prepared scenery');
  if(['world-revision','ecology','art-revision','trees-off','trees-on','buildings-off','buildings-on','zoom-return'].includes(row.action)&&row.sceneBuilds!==undefined)assert.ok(row.sceneBuilds>row.beforeBuilds,'changed scenery is rebuilt before drawing');
  if(row.scene==='mixed'&&row.action==='world-revision')assert.ok(row.routePathBuilds>0,'visible route paths rebuild after a structural revision');
  if(row.action!=='ecology')return;
  const label=`${row.scene}/${row.zoom}/${row.condition}/dpr ${row.dpr}`;
  assert.equal(row.differentPixels,0,`${label}: a patched ecology day matches a fresh renderer in every pixel`);
  assert.ok(row.journaled>=row.edited&&row.seamsInView>0&&row.insideInView>0&&row.outsideOfView>0,`${label}: in-view, seam and out-of-view edits are journaled`);assert.ok(row.grown>0,`${label}: real ecology days changed the world`);
  if(row.scene!=='mixed')assert.ok(row.groveInView,`${label}: a 3×3 grove dissolves in view`);
  assert.equal(row.chunkCount,row.chunksBefore,`${label}: no chunk is discarded`);
  if(row.scene==='mixed'){assert.equal(row.routePathBuilds,0,`${label}: route paths survive an ecology day`);assert.equal(row.foundationBuilds,0,`${label}: foundations survive an ecology day`);if(row.condition==='night'){assert.ok(row.staticEmitters>0);assert.equal(row.emitterBuilds,0,`${label}: static light emitters survive an ecology day`);}}
}
try{
  const page=await open(2);
  for(const scene of(process.env.TRANSPORT_SCENES||'forest,mixed,generated-forest').split(','))for(const zoom of[.5,1,2]){
    await page.evaluate(({scene,zoom})=>sceneQA.start(scene,zoom),{scene,zoom});
    for(const action of['warm','small-pan','small-pan','long-pan','reverse-pan','trees-off','trees-on','buildings-off','buildings-on','world-revision','ecology','zoom-return',...(scene==='mixed'&&zoom===2?['art-revision']:[])]){
      const row={scene,zoom,condition:'night',dpr:2,...await page.evaluate(action=>sceneQA.change(action),action)};rows.push(row);console.log(JSON.stringify(row));
      if(row.maxChannelDifference>4||row.meanChannelDifference>.02||(action==='ecology'&&row.differentPixels)){await page.locator('#cached').screenshot({path:`${out}/${scene}-${zoom}-${action}-cached.png`});await writeFile(`${out}/results.json`,JSON.stringify({rows,errors},null,2));}
      check(row);
    }
  }
  // The remaining day/night and density combinations for journaled ecology days.
  for(const dpr of[1,2]){
    const view=dpr===2?page:await open(dpr);
    for(const condition of['day','night'])if(dpr!==2||condition!=='night')for(const scene of(process.env.TRANSPORT_SCENES||'forest,mixed,generated-forest').split(','))for(const zoom of[.5,1,2]){
      await view.evaluate(({scene,zoom,condition})=>sceneQA.start(scene,zoom,condition),{scene,zoom,condition});
      for(const action of['warm','ecology']){
        const row={scene,zoom,condition,dpr,...await view.evaluate(action=>sceneQA.change(action),action)};rows.push(row);console.log(JSON.stringify(row));
        if(row.maxChannelDifference>4||row.meanChannelDifference>.02||(action==='ecology'&&row.differentPixels)){await view.locator('#cached').screenshot({path:`${out}/${scene}-${zoom}-${condition}-dpr${dpr}-${action}-cached.png`});await writeFile(`${out}/results.json`,JSON.stringify({rows,errors},null,2));}
        check(row);
      }
    }
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({rows,errors},null,2));
}finally{await browser.close();}
