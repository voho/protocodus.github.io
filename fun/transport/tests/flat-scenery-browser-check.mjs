// Isolated rendering fixtures: scenery returns when its actual mesh is leveled.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-flat-scenery';
await mkdir(output, { recursive: true });
const results = [], errors = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/flat-scenery-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:800px;height:600px}</style><canvas></canvas>' }));
    await page.goto(new URL('flat-scenery-qa', base).href);
    await page.evaluate(async () => {
      const { createRenderer } = await import('./renderer.js'), geometry = await import('./terrain-geometry.js'), { preloadWorldArt } = await import('./atlas-runtime.js');
      await preloadWorldArt({ waitMs: 12000 });
      const canvas = document.querySelector('canvas'), layers = { trees: true, buildings: false, zones: false, names: false, industryIcons: false, stations: false, vehicles: false, vehicleLoads: false, lighting: false, routes: false, grid: false, roads: false, rails: false };
      window.sceneryQA = { canvas, geometry, createRenderer, layers };
    });
    for (const zoom of [.5, 1, 2]) for (const name of ['forest', 'rock', 'plants', 'stone-detail', 'large-forest', 'large-rock']) {
      const result = await page.evaluate(({ name, zoom, dpr }) => {
        const q=sceneryQA,k=q.geometry,large=name.startsWith('large-'),rock=name.endsWith('rock')||name==='stone-detail',forest=name.endsWith('forest'),span=large?3:1;
        // This rock coordinate has a low placement hash; its positive flat
        // baseline is asserted, so sparse distribution cannot mask failures.
        const x=name==='stone-detail'?46:rock?106:name==='plants'?40:48,y=name==='stone-detail'?36:rock?19:name==='plants'?40:48;
        const g={width:128,height:128,biome:'taiga',seed:1847,day:0,revision:1,money:1e7,industries:[],cities:[],stations:[],routes:[],vehicles:[],zones:[],tiles:Array.from({length:128*128},()=>({terrain:'grass',elevation:3/7,variant:0,detail:'',road:false,rail:false,building:null,zone:null}))};
        for(let dy=0;dy<span;dy++)for(let dx=0;dx<span;dx++)Object.assign(g.tiles[(y+dy)*g.width+x+dx],{terrain:forest?'forest':rock&&name!=='stone-detail'?'rock':'grass',detail:forest?'pine':rock?'glacial':'wildflowers',variant:name==='stone-detail'?3:0});
        const anchor=g.tiles[y*g.width+x];if(large)anchor.terrainObject={kind:forest?'forest':'rock',detail:anchor.detail,variant:0,footprint:span};
        const r=q.renderer||(q.renderer=q.createRenderer(q.canvas,g,{layers:q.layers}));r.setGame(g);r.setLayers(q.layers);r.setZoom(zoom);r.focus(x+(span-1)/2,y+(span-1)/2);
        const context=q.canvas.getContext('2d'),originalDraw=CanvasRenderingContext2D.prototype.drawImage;
        const frames=[];
        const hash=()=>{const pixels=context.getImageData(0,0,q.canvas.width,q.canvas.height).data;frames.push(pixels);let h=2166136261;for(let i=0;i<pixels.length;i+=16)h=Math.imul(h^pixels[i]^pixels[i+1]<<8^pixels[i+2]<<16,16777619);return h>>>0;};
        const capture=()=>{
          const calls={large:0,small:[]},state=JSON.stringify(g),before=r.getStats().composedChunks;
          CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
            if(args.length===4){
              const [px,py,w,h]=args;
              if(this===context&&w===64*span&&h===64*span&&large)calls.large++;
              if(this===context&&((forest&&w===48&&h===48)||(!forest&&w===32&&h===40))){
                const p=k.pickGround(g,px+(forest?24:16),py+(forest?40:name==='plants'||name==='stone-detail'?28:30));
                const tx=Math.floor(p.x+1e-8),ty=Math.floor(p.y+1e-8);if(tx>=x&&ty>=y&&tx<x+span&&ty<y+span)calls.small.push({x:tx,y:ty});
              }
            }
            return originalDraw.call(this,image,...args);
          };
          try{r.render(0);}finally{CanvasRenderingContext2D.prototype.drawImage=originalDraw;}
          const flatCells=[];for(let dy=0;dy<span;dy++)for(let dx=0;dx<span;dx++)if(k.groundIsFlat(g,x+dx,y+dy))flatCells.push({x:x+dx,y:y+dy});
          return{...calls,flatCells,flat:k.groundIsFlat(g,x,y,span),rebuilt:r.getStats().composedChunks-before,hash:hash(),unchanged:state===JSON.stringify(g)};
        };
        const flat=capture(),edit={x:x+(large?2:1),y:y+(large?2:1)};
        g.tiles[edit.y*g.width+edit.x].elevation=4/7;g.revision++;const sloped=capture();
        g.tiles[edit.y*g.width+edit.x].elevation=3/7;g.revision++;const leveled=capture();
        let changedPixels=0,maxChannelDelta=0,left=Infinity,top=Infinity,right=-1,bottom=-1;
        for(let i=0;i<frames[0].length;i+=4){
          let delta=0;for(let channel=0;channel<4;channel++)delta=Math.max(delta,Math.abs(frames[0][i+channel]-frames[2][i+channel]));
          if(delta){changedPixels++;maxChannelDelta=Math.max(maxChannelDelta,delta);const px=(i/4)%q.canvas.width,py=Math.floor(i/4/q.canvas.width);left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
        }
        const restoration={changedPixels,maxChannelDelta,bounds:changedPixels?{left,top,right,bottom}:null};
        return{name,zoom,dpr,x,y,span,flat,sloped,leveled,restoration,object:anchor.terrainObject};
      }, { name, zoom, dpr });
      results.push(result);
      if (dpr===1&&zoom===1) await page.locator('canvas').screenshot({path:`${output}/${name}-leveled.png`});
    }
    await page.close();
  }
  await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
  for(const row of results){
    const label=`${row.name} ${row.zoom}× DPR${row.dpr}`;
    assert.equal(row.flat.flat,true,label);assert.equal(row.sloped.flat,false,label);assert.equal(row.leveled.flat,true,label);
    assert.ok(row.sloped.rebuilt>0&&row.leveled.rebuilt>0,`${label}: terrain edits invalidate cached ground`);
    assert.ok([row.flat,row.sloped,row.leveled].every(stage=>stage.unchanged),`${label}: render preserves saved data`);
    assert.notEqual(row.flat.hash,row.sloped.hash,label);
    // Canvas may switch GPU/CPU raster paths after getImageData; one-bit
    // antialias rounding is allowed, while every decoration draw stays exact.
    assert.ok(row.restoration.maxChannelDelta<=2,`${label}: leveling restores artwork within raster rounding: ${JSON.stringify(row.restoration)}`);
    if(row.span===1){
      const count=stage=>stage.small.length;
      assert.ok(count(row.flat)>0,`${label}: fixture visibly draws on level ground`);assert.equal(count(row.sloped),0,`${label}: no scenery on a corner slope`);assert.equal(count(row.leveled),count(row.flat),`${label}: scenery returns after leveling`);
    }else{
      assert.equal(row.flat.large,1,label);assert.equal(row.flat.small.length,0,label);assert.equal(row.sloped.large,0,`${label}: large art cannot cover a sloped parcel`);
      assert.equal(row.sloped.flatCells.length,5,`${label}: raised interior vertex slopes exactly four of nine cells`);
      assert.ok(row.sloped.small.length>0,`${label}: level constituent cells retain their small scenery`);
      for(const p of row.sloped.small)assert.ok(row.sloped.flatCells.some(q=>q.x===p.x&&q.y===p.y),`${label}: fallback at ${p.x},${p.y} must be flat`);
      if(row.name==='large-forest')assert.equal(row.sloped.small.length,row.sloped.flatCells.length,`${label}: every flat woodland cell survives`);
      assert.equal(row.leveled.large,1,label);assert.equal(row.leveled.small.length,0,label);assert.equal(row.object.footprint,3,label);
    }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({profiles:results.length,zooms:3,dprs:2,paths:6,output},null,2));
}finally{await browser.close();}
