import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-hills';
await mkdir(output,{recursive:true});
const errors=[],results=[];
try{
  for(const dpr of [1,2]){
    const context=await browser.newContext({viewport:{width:1280,height:920},deviceScaleFactor:dpr});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>window.transport?.renderer);
    await page.evaluate(async()=>{
      transport.setSpeed(0);
      const {createRenderer}=await import('./renderer.js'),{createGame}=await import('./model.js');
      const {preloadWorldArt}=await import('./atlas-runtime.js');await preloadWorldArt();
      const canvas=document.createElement('canvas');canvas.style='position:fixed;inset:0;width:1200px;height:800px;z-index:9999';canvas.id='hills-qa';document.body.append(canvas);
      const game=createGame({biome:'taiga',size:'regional',seed:418});
      game.cities=[];game.industries=[];game.stations=[];game.routes=[];game.vehicles=[];game.zones=[];game.day=0;
      for(const tile of game.tiles)Object.assign(tile,{terrain:'grass',elevation:.25,detail:'',road:false,rail:false,building:null,zone:null,bridge:false,tunnel:false});
      const renderer=createRenderer(canvas,game,{layers:{trees:false,buildings:false,names:false,industryIcons:false,lighting:false}});
      renderer.focus(48,36);renderer.setZoom(1);renderer.render(0);
      const hash=()=>{let h=2166136261;for(const byte of canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)h=Math.imul(h^byte,16777619);return h>>>0;};
      const sample=(x,y)=>{const camera=renderer.getCamera(),scale=camera.zoom*devicePixelRatio,px=canvas.width/2+((x+.5)*32-camera.x)*scale,py=canvas.height/2+((y+.5)*32-camera.y)*scale;return Array.from(canvas.getContext('2d').getImageData(Math.round(px),Math.round(py),1,1).data);};
      window.hillsQA={game,renderer,canvas,hash,sample,createGame};
    });
    const edit=await page.evaluate(()=>{
      const q=hillsQA,g=q.game,index=36*g.width+47,before=q.hash(),neighbor=q.sample(48,36),count=q.renderer.getStats().composedChunks;
      // The changed tile is immediately left of a cached 8-tile chunk boundary.
      g.tiles[index].elevation=5/16;g.revision++;q.renderer.render(0);
      const raised=q.hash(),sloped=q.sample(48,36),rebuilt=q.renderer.getStats().composedChunks-count;
      const stable=q.renderer.getStats().composedChunks;q.renderer.render(0);
      const extra=q.renderer.getStats().composedChunks-stable;
      g.tiles[index].elevation=.25;g.revision++;q.renderer.render(0);
      const restored=q.hash(),fractionCount=q.renderer.getStats().composedChunks;
      g.tiles[index].elevation=4.2/16;g.revision++;q.renderer.render(0);
      const fractional=q.hash(),fractionRebuilt=q.renderer.getStats().composedChunks-fractionCount;
      return{before,raised,restored,neighbor,sloped,rebuilt,extra,fractional,fractionRebuilt};
    });
    assert.notEqual(edit.before,edit.raised,'one higher tile visibly raises the surface');
    assert.notDeepEqual(edit.neighbor,edit.sloped,'the neighboring chunk receives the slope');
    assert.equal(edit.restored,edit.before,'restoring elevation restores the exact landscape');assert.equal(edit.extra,0);assert.ok(edit.rebuilt>=2);
    assert.notEqual(edit.fractional,edit.before,'natural elevation changes below one integer level affect relief');assert.ok(edit.fractionRebuilt>=2,'fractional elevation invalidates neighboring slopes');
    for(const biome of ['taiga','tundra','desert']){
      await page.evaluate(biome=>{
        const q=hillsQA,g=q.createGame({biome,size:'regional',seed:418});q.game=g;
        g.cities=[];g.industries=[];g.stations=[];g.routes=[];g.vehicles=[];g.zones=[];g.day=0;
        for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){
          const t=g.tiles[y*g.width+x],land=biome==='desert'?'sand':biome==='tundra'?'snow':'grass';
          Object.assign(t,{terrain:land,elevation:.25,detail:'',building:null,road:false});
          // A single raised tile, a low mesa, and a taller rounded massif.
          if(x===39&&y===35)t.elevation=5/16;
          if(x>=45&&x<=50&&y>=31&&y<=37)t.elevation=7/16;
          const r=Math.hypot((x-58)/7,(y-35)/5);
          if(r<1.15){t.elevation=(4+Math.round(Math.max(0,1-r)*9))/16;t.terrain='mountain';}
          if(y===41&&x>=32&&x<=67)t.road=true;
          if(x>=37&&x<=43&&y>=43&&y<=46){t.terrain='water';t.elevation=0;}
          if(x>=46&&x<=52&&y>=44&&y<=48)t.detail=biome==='desert'?'agave':biome==='tundra'?'heather':'wildflowers';
        }
        g.revision++;q.renderer.setGame(g);q.renderer.setLayers({trees:true,roads:true});q.renderer.focus(48,38);
      },biome);
      for(const zoom of [.5,1,2]){
        const stat=await page.evaluate(zoom=>{const q=hillsQA;q.renderer.setZoom(zoom);const before=JSON.stringify(q.game);const start=performance.now();q.renderer.render(0);const cold=performance.now()-start,count=q.renderer.getStats().composedChunks;q.renderer.render(0);return{...q.renderer.getStats(),cold,unchanged:before===JSON.stringify(q.game),extra:q.renderer.getStats().composedChunks-count};},zoom);
        assert.equal(stat.unchanged,true);assert.equal(stat.extra,0);assert.ok(stat.cacheBytes<=stat.cacheLimit);results.push({biome,dpr,zoom,cold:stat.cold,cacheMiB:stat.cacheBytes/1048576});
        await page.locator('#hills-qa').screenshot({path:`${output}/${biome}-levels-zoom${zoom}-dpr${dpr}.png`});
      }
      await page.evaluate(biome=>{const q=hillsQA;q.game=q.createGame({biome,size:'square512',seed:418});q.game.day=0;q.renderer.setGame(q.game);q.renderer.setLayers({trees:true,buildings:true});q.renderer.setZoom(1);q.renderer.focus(q.game.cities[0].x+6,q.game.cities[0].y);q.renderer.render(0);},biome);
      await page.locator('#hills-qa').screenshot({path:`${output}/${biome}-real-world-dpr${dpr}.png`});
    }
    const parcel=await page.evaluate(async()=>{
      hillsQA.canvas.remove();const {terrainLevel}=await import('./terrain-elevation.js'),g=transport.game;
      let found;
      for(let y=24;y<g.height-24&&!found;y++)for(let x=24;x<g.width-24;x++){
        const t=g.tiles[y*g.width+x];
        if(!t.building&&!t.zone&&!t.road&&!t.rail&&g.cities.every(c=>Math.hypot(c.x-x,c.y-y)>14)&&g.industries.every(i=>Math.hypot(i.x-x,i.y-y)>5)){found={x,y,level:terrainLevel(t)};break;}
      }
      transport.setTool('inspect');transport.renderer.setLayers({names:false,industryIcons:false});transport.renderer.focus(found.x,found.y);transport.renderer.render(0);return found;
    });
    const box=await page.locator('#world').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    assert.match(await page.locator('#inspector .eyebrow').textContent(),new RegExp(`LEVEL ${parcel.level} · ${parcel.x}, ${parcel.y}`));
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,output},null,2));
}finally{await browser.close();}
