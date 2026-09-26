// Deterministic real-world landscapes in isolated browser storage, suitable for
// comparing terrain palette/art changes without replacing a player's company.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-landscape-realism';
const url=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
await mkdir(output,{recursive:true});
const errors=[],results=[],forestChecks=[];
const biomes=(process.env.TRANSPORT_BIOMES||'taiga,tundra,desert').split(',');
const seeds=(process.env.TRANSPORT_SEEDS||'1847,418').split(',').map(Number);
const generationVersion=process.env.TRANSPORT_GENERATION_VERSION?Number(process.env.TRANSPORT_GENERATION_VERSION):undefined;
try{
  for(const dpr of (process.env.TRANSPORT_RETINA==='1'?[1,2]:[1])){
    const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:dpr});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/landscape-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0;background:#111"></body>'}));
    await page.goto(new URL('landscape-review',url).href);
    await page.evaluate(async()=>{
      const {createGame}=await import('./model.js'),{createRenderer}=await import('./renderer.js');
      const art=await import('./atlas-runtime.js');await art.preloadWorldArt({waitMs:10000});
      const canvas=document.createElement('canvas');canvas.id='landscape';canvas.style='width:1280px;height:900px;display:block';document.body.append(canvas);
      window.landscapeQA={createGame,createRenderer,canvas,art};
    });
    const canopy=await page.evaluate(async()=>{
      const {drawRasterNature}=await import('./raster-nature.js');
      const c=document.createElement('canvas');c.width=c.height=96;const ctx=c.getContext('2d');
      const rows=[];
      for(const biome of ['taiga','tundra','desert'])for(const density of [1,2,3]){
        let clipped=0,ink=0;
        for(let variant=0;variant<64;variant++){
          ctx.clearRect(0,0,96,96);ctx.save();ctx.translate(32,32);
          drawRasterNature(ctx,'forest',biome,'',variant,devicePixelRatio,{density});ctx.restore();
          const pixels=ctx.getImageData(0,0,96,96).data;
          for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(pixels[(y*96+x)*4+3]>3){
            ink++;if(x<24||x>=72||y<16||y>=64)clipped++;
          }
        }
        rows.push({biome,density,clipped,meanInk:ink/64});
      }
      return rows;
    });
    for(const row of canopy)assert.equal(row.clipped,0,`${row.biome} canopy fits expanded sprite bounds at density ${row.density}`);
    for(const biome of ['taiga','tundra','desert']){
      const levels=canopy.filter(row=>row.biome===biome);assert.ok(levels[2].meanInk>levels[0].meanInk*1.5,`${biome} dense woodland differs visibly from open woodland`);
    }
    forestChecks.push({dpr,canopy});
    for(const biome of biomes)for(const seed of seeds){
      const scenes=await page.evaluate(({biome,seed,generationVersion})=>{
        const q=landscapeQA;const g=q.createGame({biome,size:'square512',seed,generationVersion});g.day=0;q.game=g;
        if(q.renderer)q.renderer.setGame(g);else q.renderer=q.createRenderer(q.canvas,g,{layers:{lighting:false,names:false,industryIcons:false,routes:false}});
        const best={forest:{score:-Infinity},highlands:{score:-Infinity},coast:{score:-Infinity}};
        for(let y=24;y<g.height-24;y+=12)for(let x=24;x<g.width-24;x+=12){
          let forest=0,rock=0,mountain=0,water=0,variation=0,last=null;
          for(let dy=-12;dy<=12;dy+=2)for(let dx=-18;dx<=18;dx+=2){
            const t=g.tiles[(y+dy)*g.width+x+dx];forest+=t.terrain==='forest';rock+=t.terrain==='rock';mountain+=t.terrain==='mountain';water+=t.terrain==='water';
            if(last!==null)variation+=Math.abs(t.elevation-last);last=t.elevation;
          }
          const scores={forest:forest*.7-Math.abs(forest-125)*.5+variation*.3-water*.3,highlands:mountain*.5+rock*.15+variation-Math.abs(mountain-115)*.3-water*.2,coast:120-Math.abs(water-95)+variation*.2+forest*.05};
          for(const key of Object.keys(best))if(scores[key]>best[key].score)best[key]={x,y,score:scores[key]};
        }
        return[{name:'town',x:g.cities[0].x+4,y:g.cities[0].y,zooms:[.5,1]},...Object.entries(best).map(([name,p])=>({name,x:p.x,y:p.y,zooms:name==='highlands'?[1,2]:[1]}))];
      },{biome,seed,generationVersion});
      for(const scene of scenes)for(const zoom of scene.zooms){
        const stats=await page.evaluate(({scene,zoom})=>{
          const q=landscapeQA;q.renderer.setZoom(zoom);q.renderer.focus(scene.x,scene.y);const start=performance.now();q.renderer.render(0);const coldMs=performance.now()-start;
          const before=q.renderer.getStats().composedChunks;q.renderer.render(0);return{...q.renderer.getStats(),coldMs,repeatedChunks:q.renderer.getStats().composedChunks-before,art:q.art.worldArtStats()};
        },{scene,zoom});
        assert.equal(stats.repeatedChunks,0);assert.ok(stats.cacheBytes<=stats.cacheLimit);assert.deepEqual(stats.art.errors,[]);assert.equal(stats.art.ready,stats.art.atlases);
        const file=`${output}/${biome}-${seed}-${scene.name}-zoom${zoom}-dpr${dpr}.png`;
        await page.locator('#landscape').screenshot({path:file});
        results.push({biome,seed,scene:scene.name,x:scene.x,y:scene.y,zoom,dpr,file,coldMs:stats.coldMs,cacheMiB:stats.cacheBytes/1048576});
      }
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({passed:true,errors,forestChecks,results},null,2));
  console.log(JSON.stringify({passed:true,profiles:results.length,output,maxColdMs:Math.max(...results.map(r=>r.coldMs)),maxCacheMiB:Math.max(...results.map(r=>r.cacheMiB))},null,2));
}finally{await browser.close();}
