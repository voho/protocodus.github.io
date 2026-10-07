// Exercise the actual sprite factory with every raster request unavailable.
// Transparent cutouts must remain complete at catalog and compact saved sizes.
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const { chromium }=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const base=process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_OUTPUT||'/tmp/transport-native-fallbacks';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true}),results=[],errors=[];
try{
  for(const dpr of [1,2]){
    const page=await browser.newPage({viewport:{width:1440,height:1600},deviceScaleFactor:dpr});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/assets/**',route=>route.abort());
    await page.route('**/native-fallback-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#dbe0d1}canvas{display:block}</style><canvas id="catalogue"></canvas><canvas id="world" style="width:1440px;height:800px"></canvas>'}));
    await page.goto(new URL('native-fallback-qa',base).href);
    await page.evaluate(async()=>{
      const [{createSprites},{BUILDINGS},{INDUSTRIES},fields,{SPRITE_SCALE},{createRenderer},{DEFAULT_LAYERS}]=await Promise.all([import('./sprites.js'),import('./buildings.js'),import('./data.js'),import('./farm-fields-art.js'),import('./sprite-art-direction.js'),import('./renderer.js'),import('./visibility.js')]);
      const catalogue=biome=>{
        const canvas=document.getElementById('catalogue'),ctx=canvas.getContext('2d'),kinds=[...Object.keys(BUILDINGS),...Object.keys(INDUSTRIES)],columns=8,cellW=180,cellH=172;
        canvas.width=1440*devicePixelRatio;canvas.height=Math.ceil((kinds.length+5)/columns)*cellH*devicePixelRatio;canvas.style.width='1440px';canvas.style.height=`${canvas.height/devicePixelRatio}px`;ctx.scale(devicePixelRatio,devicePixelRatio);
        const sprite=createSprites(biome,{pixelScale:devicePixelRatio,detailLevel:'detail',gardenGround:'terrain'}),bounds=[];
        for(let index=0;index<kinds.length;index++){
          const kind=kinds[index],span=(BUILDINGS[kind]||INDUSTRIES[kind]).footprint,x=index%columns*cellW,y=Math.floor(index/columns)*cellH;
          ctx.fillStyle=(index+Math.floor(index/columns))%2?'#d5dccd':'#e2e6dc';ctx.fillRect(x,y,cellW,cellH);
          const image=sprite(kind,0,span,'',span),pixels=image.getContext('2d').getImageData(0,0,image.width,image.height).data;
          let minX=image.width,minY=image.height,maxX=-1,maxY=-1,count=0;
          for(let py=0;py<image.height;py++)for(let px=0;px<image.width;px++)if(pixels[(py*image.width+px)*4+3]>10){minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);count++;}
          bounds.push({kind,span,width:image.width,height:image.height,minX,minY,maxX,maxY,count});
          const scale=Math.min(150/(image.width/devicePixelRatio),142/(image.height/devicePixelRatio));
          ctx.drawImage(image,x+(cellW-image.width/devicePixelRatio*scale)/2,y+5,image.width/devicePixelRatio*scale,image.height/devicePixelRatio*scale);
          ctx.fillStyle='#273d36';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText(`${kind} · ${span}×${span}`,x+cellW/2,y+cellH-9);
          for(const savedSpan of [1,2,3]){
            const compact=sprite(kind,0,savedSpan,'',savedSpan),data=compact.getContext('2d').getImageData(0,0,compact.width,compact.height).data;
            if(!data.some((v,i)=>i%4===3&&v>100))throw new Error(`empty compact ${kind}/${savedSpan}`);
          }
        }
        for(const [n,kind]of ['farm','dairy-farm','vegetable-farm','orchard','livestock-farm'].entries()){
          const index=kinds.length+n,x=index%columns*cellW,y=Math.floor(index/columns)*cellH;
          ctx.fillStyle='#e2e6dc';ctx.fillRect(x,y,cellW,cellH);fields.drawFarmPortrait(ctx,kind,biome,{x:x+5,y:y+3,width:170,height:145,pixelScale:devicePixelRatio});
          ctx.fillStyle='#273d36';ctx.font='11px sans-serif';ctx.fillText(`${kind} complete plot`,x+90,y+cellH-9);
        }
        return bounds;
      };
      let renderer;
      const scene=async(biome,zoom)=>{
        const width=40,height=40,sites=['farm','orchard','dairy-farm'].map((kind,index)=>({id:kind,kind,x:10+index*6,y:12,footprint:5,stock:{},variant:0}));
        const game={width,height,seed:1847,biome,revision:1,day:1,industries:sites,cities:[],stations:[],routes:[],vehicles:[],zones:[],tiles:Array.from({length:width*height},(_,i)=>({terrain:biome==='desert'?'sand':biome==='tundra'?'snow':'grass',elevation:Math.max(0,Math.min(2,Math.floor((i%width)/8)-1)),detail:'',variant:0,road:false,rail:false,building:null,zone:null}))};
        if(renderer)renderer.setGame(game);else renderer=createRenderer(document.getElementById('world'),game,{layers:{...DEFAULT_LAYERS,names:false,grid:false,industryIcons:false},sceneryBatching:false});
        renderer.resize();renderer.setZoom(zoom);renderer.focus(18,15);const before=JSON.stringify(game);renderer.render(1000,{settle:true});
        await new Promise(requestAnimationFrame);renderer.render(1000,{settle:true});
        const rect=document.getElementById('world').getBoundingClientRect();let picks=0;
        for(const site of sites)for(let dy=0;dy<5;dy++)for(let dx=0;dx<5;dx++){
          const p=renderer.worldToScreen(site.x+dx,site.y+dy);if(p.x<0||p.x>=1440||p.y<0||p.y>=800)continue;
          const hit=renderer.screenToInspectTile(p.x+rect.left,p.y+rect.top);if(hit.x===site.x&&hit.y===site.y)picks++;else throw new Error(`farm pick ${site.kind}/${dx},${dy}`);
        }
        return{biome,zoom,picks,immutable:before===JSON.stringify(game),frame:SPRITE_SCALE.billboardPixelsPerTile};
      };
      window.nativeQA={catalogue,scene};
    });
    for(const biome of ['taiga','tundra','desert']){
      const bounds=await page.evaluate(b=>window.nativeQA.catalogue(b),biome);
      for(const row of bounds){assert.ok(row.count>10,`${row.kind} is visible`);assert.ok(row.minX>0&&row.maxX<row.width-1&&row.minY>0&&row.maxY<row.height-1,`${row.kind} has transparent gutters: ${JSON.stringify(row)}`);}
      if(dpr===1)await page.locator('#catalogue').screenshot({path:`${output}/${biome}-catalogue.png`});
      for(const zoom of [.5,1,2]){
        const row=await page.evaluate(args=>window.nativeQA.scene(...args),[biome,zoom]);assert.ok(row.immutable);assert.ok(row.picks>0);results.push({...row,dpr});
        if(dpr===1&&zoom===1)await page.locator('#world').screenshot({path:`${output}/${biome}-farms.png`});
      }
    }
    await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({profiles:results.length,results,errors},null,2));
  console.log(`PASS ${results.length} unavailable-art farm profiles, all town/industry fallback cutouts and compact saved extents at DPR1/2.`);
}finally{await browser.close();}
