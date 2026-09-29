// Real multi-tile natural parcels retain fixed tree heights and clear cleanly.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel:process.env.TRANSPORT_BROWSER || 'chrome',headless:true});
const base=process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-terrain-objects';
await mkdir(output,{recursive:true});
const results=[],errors=[];
try {
  for(const dpr of [1,2]){
    const context=await browser.newContext({viewport:{width:1200,height:820},deviceScaleFactor:dpr}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/terrain-objects-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{display:block;width:1200px;height:820px}</style><canvas></canvas>'}));
    await page.goto(new URL('terrain-objects-qa',base).href);
    await page.evaluate(async()=>{
      const {createRenderer}=await import('./renderer.js'),{createSprites}=await import('./sprites.js'),{natureObjectLayout}=await import('./raster-nature.js'),world=await import('./atlas-runtime.js');
      await world.preloadWorldArt({waitMs:12000});
      window.qa={createRenderer,createSprites,natureObjectLayout,canvas:document.querySelector('canvas')};
    });
    for(const biome of ['taiga','tundra','desert']){
      await page.evaluate(biome=>{
        const q=qa,g={width:64,height:64,biome,seed:913,day:0,revision:1,money:1e7,industries:[],cities:[],stations:[],routes:[],vehicles:[],zones:[],tiles:Array.from({length:4096},()=>({terrain:'grass',elevation:.25,variant:0,detail:'',road:false,rail:false,building:null,zone:null}))};
        const detail={taiga:{forest:'pine',rock:'glacial',mountain:'granite-peak'},tundra:{forest:'larch',rock:'snow',mountain:'ice-peak'},desert:{forest:'acacia',rock:'dunes',mountain:'mesa'}}[biome];
        const fixtures=[];
        for(const [row,kind]of ['forest','rock','mountain'].entries())for(const span of [1,2,3]){
          const f={kind,span,x:19+(span-1)*5,y:20+row*6,detail:detail[kind],variant:17};fixtures.push(f);
          for(let dy=0;dy<span;dy++)for(let dx=0;dx<span;dx++)Object.assign(g.tiles[(f.y+dy)*g.width+f.x+dx],{terrain:kind,detail:f.detail,variant:f.variant});
          if(span>1)g.tiles[f.y*g.width+f.x].terrainObject={kind,detail:f.detail,variant:f.variant,footprint:span};
        }
        q.game=g;q.fixtures=fixtures;q.renderer=q.createRenderer(q.canvas,g,{layers:{lighting:false,names:false,industryIcons:false}});
        q.hash=()=>{let h=2166136261;for(const n of q.canvas.getContext('2d').getImageData(0,0,q.canvas.width,q.canvas.height).data)h=Math.imul(h^n,16777619);return h>>>0;};
      },biome);
      for(const zoom of [.5,1,2]){
        const rows=await page.evaluate(zoom=>{
          const q=qa,{renderer:r,game:g,canvas}=q,c=canvas.getContext('2d'),rect=canvas.getBoundingClientRect(),rows=[];
          r.setZoom(zoom);
          for(const f of q.fixtures.filter(f=>f.span>1)){
            const centerTile={x:f.x+(f.span-1)/2,y:f.y+(f.span-1)/2};r.focus(centerTile.x,centerTile.y);r.setLayers({trees:true});r.render(0);
            const original=JSON.stringify(g),baseHash=q.hash(),clicks=[];
            for(let dy=0;dy<f.span;dy++)for(let dx=0;dx<f.span;dx++){const p=r.worldToScreen(f.x+dx,f.y+dy);clicks.push(r.screenToInspectTile(rect.left+p.x,rect.top+p.y));}
            const calls=[],draw=CanvasRenderingContext2D.prototype.drawImage;
            CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image.src)calls.push({src:image.src,cell:args[2],w:args[6],h:args[7]});return draw.call(this,image,...args);};
            let image;try{image=q.createSprites(g.biome,{pixelScale:zoom*devicePixelRatio})(f.kind,f.variant,1,f.detail,f.span);}finally{CanvasRenderingContext2D.prototype.drawImage=draw;}
            const layout=q.natureObjectLayout(f.span),center=r.worldToScreen(centerTile.x,centerTile.y),alpha=image.getContext('2d').getImageData(0,0,image.width,image.height).data;let crown=null,candidates=0;
            for(let sy=0;sy<image.height&&!crown;sy+=2)for(let sx=0;sx<image.width&&!crown;sx+=2){
              if(alpha[(sy*image.width+sx)*4+3]<220)continue;
              const x=rect.left+center.x+(sx/image.width*layout.width-layout.anchorX)*zoom,y=rect.top+center.y+(sy/image.height*layout.height-layout.anchorY)*zoom,ground=r.screenToTile(x,y);
              if(ground.x>=f.x&&ground.y>=f.y&&ground.x<f.x+f.span&&ground.y<f.y+f.span)continue;
              candidates++;const picked=r.screenToInspectTile(x,y);if(picked.x===f.x&&picked.y===f.y)crown=picked;
            }
            // Outlines follow the isometric ground; compare each stroked path's device-pixel bounds with the parcel's corners.
            const outlines=draw=>{
              const paths=[],proto=CanvasRenderingContext2D.prototype;let points=[];const track=(x,y)=>{const m=c.getTransform();points.push([m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f]);};
              c.beginPath=function(){points=[];return proto.beginPath.call(this);};c.moveTo=function(x,y){track(x,y);return proto.moveTo.call(this,x,y);};c.lineTo=function(x,y){track(x,y);return proto.lineTo.call(this,x,y);};
              c.stroke=function(...args){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);paths.push({color:this.strokeStyle,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(Math.round)});return proto.stroke.apply(this,args);};
              try{draw();}finally{for(const key of ['beginPath','moveTo','lineTo','stroke'])delete c[key];}return paths;
            };
            const parcel=(x,y,span)=>{const corners=[[x,y],[x+span,y],[x+span,y+span],[x,y+span]].map(([u,v])=>r.gridPointToScreen(u,v)),xs=corners.map(p=>p.x*devicePixelRatio),ys=corners.map(p=>p.y*devicePixelRatio);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(Math.round);};
            // Mountain anchors stay in saves but draw and select as terrain, one tile at a time.
            const own=f.kind==='mountain'?parcel(f.x+f.span-1,f.y+f.span-1,1):parcel(f.x,f.y,f.span);
            const selected=outlines(()=>r.render(0,{selected:{x:f.x+f.span-1,y:f.y+f.span-1}})).find(s=>s.color==='#e17b4a')?.bounds,selectedExpected=own;
            const bulldoze=outlines(()=>r.render(0,{tool:'bulldoze',hover:{x:f.x+f.span-1,y:f.y+f.span-1}})).filter(s=>['#f4d090','#d7725f','#e3aa6d'].includes(s.color)).at(-1),bulldozeExpected=own;
            r.render(0);const composed=r.getStats().composedChunks;r.render(0);const warm=composed===r.getStats().composedChunks;
            const anchor=g.tiles[f.y*g.width+f.x],saved=anchor.terrainObject;delete anchor.terrainObject;g.revision++;r.render(0);const released=q.hash();
            const fresh=q.createRenderer(canvas,g,{zoom,layers:{lighting:false,names:false,industryIcons:false}});fresh.focus(centerTile.x,centerTile.y);fresh.render(0);const clean=q.hash();
            anchor.terrainObject=saved;g.revision++;r.render(0);const restored=q.hash();
            // Ignore the explicit revision increments made by this test itself.
            const before=JSON.parse(original);before.revision=g.revision;
            rows.push({biome:g.biome,dpr:devicePixelRatio,zoom,...f,clicks,crown,candidates,selected,selectedExpected,bulldoze,bulldozeExpected,warm,stale:released!==clean,changed:released!==baseHash,restored:restored===baseHash,unchanged:JSON.stringify(before)===JSON.stringify(g),calls});
          }
          r.focus(25.5,28);r.render(0);return rows;
        },zoom);
        for(const row of rows){
          // Mountain formations are terrain: each tile inspects itself and no parcel artwork is drawn.
          const mountain=row.kind==='mountain',anchor={x:row.x,y:row.y};
          row.clicks.forEach((p,n)=>assert.deepEqual(p,mountain?{x:row.x+n%row.span,y:row.y+Math.floor(n/row.span)}:anchor,`${biome} ${row.kind} every occupied tile opens ${mountain?'itself':'its anchor'}`));
          if(!mountain&&(row.kind==='forest'||row.candidates))assert.deepEqual(row.crown,anchor,`${biome} ${row.kind} opaque overhang is clickable`);
          // Outlines sit a small inset inside the parcel; a tenth of a tile separates them from any other span.
          const near=(bounds,expected)=>bounds?.every((value,index)=>Math.abs(value-expected[index])<=6.4*row.zoom*row.dpr);
          assert.ok(near(row.selected,row.selectedExpected),`${biome} ${row.kind} selection outlines the whole parcel: ${row.selected} vs ${row.selectedExpected}`);
          assert.ok(near(row.bulldoze?.bounds,row.bulldozeExpected),'mountains retain single-tile engineering rules');
          if(row.kind==='mountain')assert.equal(row.bulldoze.color,'#d7725f');
          assert.equal(row.stale,false,'releasing a terrain parcel equals a fresh render');assert.ok((mountain?!row.changed:row.changed)&&row.restored&&row.warm&&row.unchanged);
          if(row.kind!=='forest'&&!mountain&&56*row.span*zoom*dpr>128)assert.ok(row.calls.some(c=>c.cell===256),'large geology uses256px master');
          if(row.kind==='forest'){assert.ok(row.calls.length>=6);assert.ok(row.calls.every(c=>c.w<50&&c.h<50),'mature trees stay under50worldpixels tall at every footprint');}
        }
        results.push(...rows);
        if(zoom===1&&dpr===2)await page.locator('canvas').screenshot({path:`${output}/${biome}-single-two-three.png`});
      }
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({profiles:results.length,parcelPicks:results.reduce((n,r)=>n+r.clicks.length,0),crownPicks:results.filter(r=>r.crown).length,climates:3,zooms:3,dprs:2,output},null,2));
}finally{await browser.close();}
