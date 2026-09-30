// Footprints are real selectable parcels, not oversized one-tile decorations.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const baseURL = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-large-sites';
await mkdir(output,{recursive:true});
const errors=[],results=[];
try {
  for (const dpr of [1,2]) {
    const context=await browser.newContext({viewport:{width:1200,height:860},deviceScaleFactor:dpr});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/large-sites-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{display:block;width:1200px;height:820px}</style><canvas></canvas>'}));
    await page.goto(new URL('large-sites-qa',baseURL).href);
    await page.evaluate(async()=>{
      const {createRenderer}=await import('./renderer.js'),{createGame}=await import('./model.js'),{createSprites}=await import('./sprites.js');
      const world=await import('./atlas-runtime.js'),houses=await import('./raster-houses.js'),civic=await import('./raster-buildings.js'),industry=await import('./raster-industries.js');
      await Promise.all([world.preloadWorldArt({waitMs:12000}),houses.preloadHouses({waitMs:12000})]);
      const game=createGame({size:'regional',biome:'taiga',seed:418});
      for(const key of ['cities','industries','stations','routes','vehicles','zones'])game[key]=[];
      for(const t of game.tiles)Object.assign(t,{terrain:'grass',elevation:.25,detail:'',road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null});
      game.day=0;game.money=10000000;game.revision++;
      const canvas=document.querySelector('canvas'),renderer=createRenderer(canvas,game,{layers:{names:false,industryIcons:false,routes:false,stations:false}});
      const fixtures=[{kind:'house-cheap-1',span:1,x:25,y:25},{kind:'house-expensive-1',span:2,x:20,y:20},{kind:'stadium',span:3,x:27,y:20},{kind:'steel-mill',span:3,x:20,y:29,industry:true}];
      for(const f of fixtures){
        if(f.industry)game.industries.push({id:'industry',kind:f.kind,x:f.x,y:f.y,footprint:f.span});
        else game.tiles[f.y*game.width+f.x].building={kind:f.kind,level:1,footprint:f.span};
        for(let dy=0;dy<f.span;dy++)for(let dx=0;dx<f.span;dx++)game.tiles[(f.y+dy)*game.width+f.x+dx].detail='wildflowers';
      }
      game.revision++;
      const hash=()=>{let h=2166136261;for(const v of canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)h=Math.imul(h^v,16777619);return h>>>0;};
      window.largeSites={game,canvas,renderer,fixtures,hash,createSprites,houses,civic,industry,world};
    });
    for (const zoom of [.5,1,2]) {
      const rows=await page.evaluate(zoom=>{
        const q=largeSites,{game:g,renderer:r,canvas,fixtures}=q,c=canvas.getContext('2d'),dpr=devicePixelRatio;
        r.setZoom(zoom); const rows=[];
        for(const f of fixtures){
          r.focus(f.x+(f.span-1)/2,f.y+(f.span-1)/2);g.day=0;r.setLayers({trees:true});r.render(0);
          const snapshot=JSON.stringify(g),rect=canvas.getBoundingClientRect();
          const clicks=[];
          for(let dy=0;dy<f.span;dy++)for(let dx=0;dx<f.span;dx++){const p=r.worldToScreen(f.x+dx,f.y+dy);clicks.push(r.screenToInspectTile(rect.left+p.x,rect.top+p.y));}
          const center=r.worldToScreen(f.x+(f.span-1)/2,f.y+(f.span-1)/2),drawImage=CanvasRenderingContext2D.prototype.drawImage,sourceCells=[];
          CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image.src)sourceCells.push(args[2]);return drawImage.call(this,image,...args);};
          let sprite;try{sprite=q.createSprites(g.biome,{pixelScale:zoom*dpr*1.5})(f.kind,0,f.industry?f.span:1,'',f.span);}finally{CanvasRenderingContext2D.prototype.drawImage=drawImage;}
          const w=48*f.span*zoom,h=(48*f.span+12)*zoom,left=center.x-24*f.span*zoom,top=center.y-(36*f.span+12)*zoom;
          const pixels=sprite.getContext('2d').getImageData(0,0,sprite.width,sprite.height).data;let roof=null;
          for(let sy=0;sy<sprite.height&&!roof;sy+=2)for(let sx=0;sx<sprite.width&&!roof;sx+=2){
            if(pixels[(sy*sprite.width+sx)*4+3]<220)continue;
            const px=rect.left+left+(sx+.5)/sprite.width*w,py=rect.top+top+(sy+.5)/sprite.height*h,ground=r.screenToTile(px,py);
            if(ground.x>=f.x&&ground.x<f.x+f.span&&ground.y>=f.y&&ground.y<f.y+f.span)continue;
            const picked=r.screenToInspectTile(px,py);if(picked.x===f.x&&picked.y===f.y)roof={picked,ground};
          }
          const beforeClutter=c.getImageData(0,0,canvas.width,canvas.height).data;r.setLayers({trees:false});r.render(0);const afterClutter=c.getImageData(0,0,canvas.width,canvas.height).data;let clutterDelta=0;
          for(let dy=.125;dy<f.span;dy+=.125)for(let dx=.125;dx<f.span;dx+=.125){const p=r.worldToScreen(f.x+dx-.5,f.y+dy-.5),i=(Math.floor(p.y*dpr)*canvas.width+Math.floor(p.x*dpr))*4;for(let n=0;n<3;n++)clutterDelta=Math.max(clutterDelta,Math.abs(beforeClutter[i+n]-afterClutter[i+n]));}
          r.setLayers({trees:true});r.render(0);
          // Outlines follow the isometric ground; compare each stroked path's device-pixel bounds with the footprint's corners.
          const outlines=draw=>{
            const paths=[],proto=CanvasRenderingContext2D.prototype;let points=[];const track=(x,y)=>{const m=c.getTransform();points.push([m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f]);};
            c.beginPath=function(){points=[];return proto.beginPath.call(this);};c.moveTo=function(x,y){track(x,y);return proto.moveTo.call(this,x,y);};c.lineTo=function(x,y){track(x,y);return proto.lineTo.call(this,x,y);};
            c.stroke=function(...args){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);paths.push({color:this.strokeStyle,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(Math.round)});return proto.stroke.apply(this,args);};
            try{draw();}finally{for(const key of ['beginPath','moveTo','lineTo','stroke'])delete c[key];}return paths;
          };
          const footprint=(x,y)=>{const corners=[[x,y],[x+f.span,y],[x+f.span,y+f.span],[x,y+f.span]].map(([u,v])=>r.gridPointToScreen(u,v)),xs=corners.map(p=>p.x*dpr),ys=corners.map(p=>p.y*dpr);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(Math.round);};
          const selection=outlines(()=>r.render(0,{selected:{x:f.x+f.span-1,y:f.y+f.span-1}})).find(s=>s.color==='#e17b4a')?.bounds,selectionExpected=footprint(f.x,f.y);
          const preview=outlines(()=>r.render(0,{tool:f.kind,hover:{x:35,y:35}})).find(s=>['#f4d090','#d7725f'].includes(s.color))?.bounds,previewExpected=footprint(35,35);
          r.render(0);const composed=r.getStats().composedChunks;r.render(0);
          rows.push({kind:f.kind,span:f.span,anchor:{x:f.x,y:f.y},zoom,dpr,clicks,roof,selection,selectionExpected,preview,previewExpected,clutterDelta,stable:r.getStats().composedChunks===composed,unchanged:snapshot===JSON.stringify(g),sourceCells});
        }
        r.focus(25,25);r.render(0);return rows;
      },zoom);
      for(const row of rows){
        const fixture=row.anchor;
        assert.equal(row.clicks.length,row.span**2);for(const clicked of row.clicks)assert.deepEqual(clicked,fixture,`${row.kind} every occupied parcel resolves its anchor`);
        assert.ok(row.roof,`${row.kind} roof outside ground parcel is clickable`);
        // Outlines sit a small inset inside the footprint; a tenth of a tile separates them from any neighbouring span.
        const near=(bounds,expected)=>bounds?.every((value,index)=>Math.abs(value-expected[index])<=6.4*row.zoom*row.dpr);
        assert.ok(near(row.selection,row.selectionExpected),`${row.kind} selection outlines the whole footprint: ${row.selection} vs ${row.selectionExpected}`);
        assert.ok(near(row.preview,row.previewExpected),`${row.kind} placement preview outlines the whole footprint: ${row.preview} vs ${row.previewExpected}`);
        // Ground resampling can mix one channel value from a neighboring fleck
        // at the parcel edge; actual flower/plant art would exceed this bound.
        assert.ok(row.clutterDelta<=2,`${row.kind} full occupied parcel suppresses vegetation, delta${row.clutterDelta}`);
        assert.ok(row.stable);assert.ok(row.unchanged,'rendering must not mutate game data');
        if(48*row.span*zoom*dpr>128)assert.ok(row.sourceCells.includes(256),`${row.kind} enlarged art uses256px masters`);
      }
      results.push(...rows);await page.locator('canvas').screenshot({path:`${output}/large-sites-zoom${zoom}-dpr${dpr}.png`});
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({profiles:results.length,parcelPicks:results.reduce((n,r)=>n+r.clicks.length,0),roofPicks:results.filter(r=>r.roof).length,output},null,2));
}finally{await browser.close();}
