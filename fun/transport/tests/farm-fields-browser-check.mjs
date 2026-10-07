// Large farms reserve a whole fenced plot while their buildings remain at the
// same scale as other two-tile sites. Crop ground follows terrain and caches.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { FARM_CORE_PLOT_ATLASES } from '../plot-building-catalog.js';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-farm-fields';
const farmCorePrefixes = FARM_CORE_PLOT_ATLASES.map(atlas => new URL(`${atlas.path}-`,base).href);
await mkdir(output, { recursive:true });
const browser = await chromium.launch({ channel:process.env.TRANSPORT_BROWSER || 'chrome', headless:true });
const results=[],errors=[];
try {
  for(const dpr of [1,2]) {
    const page=await browser.newPage({ viewport:{width:960,height:640}, deviceScaleFactor:dpr });
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/farm-fields-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{width:960px;height:640px}</style><canvas id="world"></canvas>'}));
    await page.goto(new URL('farm-fields-qa',base).href);
    await page.evaluate(async()=>{
      const [{createRenderer},fields,{preloadWorldArt},{DEFAULT_LAYERS},{noteSurfaceChanges}]=await Promise.all([import('./renderer.js'),import('./farm-fields-art.js'),import('./atlas-runtime.js'),import('./visibility.js'),import('./change-journal.js')]);
      await preloadWorldArt({waitMs:12000,cells:[16,32,64,128,256]});
      const canvas=document.getElementById('world'),layers={...DEFAULT_LAYERS,names:false,grid:false,industryIcons:false,vehicleLoads:false,deliveries:false};
      const make=(kind,biome,variant=0,sloped=false,footprint=5)=>{
        const width=40,height=40,site={id:'farm',kind,x:13,y:13,footprint,variant,stock:{},name:kind};
        const game={width,height,day:1,seed:1847,biome,revision:1,industries:[site],stations:[],cities:[],routes:[],vehicles:[],zones:[],tiles:Array.from({length:width*height},(_,i)=>({terrain:biome==='desert'?'sand':'grass',detail:'',elevation:sloped?Math.max(0,Math.min(2,((i%width)-10)/12)):0,variant:0,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null}))};
        const route={id:'road',mode:'road',cargo:'grain',active:true,color:'#b56d52',path:Array.from({length:12},(_,i)=>({x:11+i,y:20}))};
        for(const p of route.path)game.tiles[p.y*width+p.x].road=true;
        game.routes=[route];game.vehicles=[{id:'truck',routeId:route.id,x:15,y:20,angle:0,progress:4,direction:1,level:1,capacity:30,load:12}];
        return {game,site};
      };
      const settle=async renderer=>{
        renderer.render(1000,{settle:true});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        for(let n=0;n<160;n++){renderer.render(1000,{settle:true});if(!renderer.getStats().sceneryBatches.pending)break;await new Promise(requestAnimationFrame);}
        if(renderer.getStats().sceneryBatches.pending)throw new Error('Farm scene cache did not settle');renderer.render(1000,{settle:true});
      };
      let renderer=null;
      const run=async(kind,biome,variant,zoom)=>{
        const {game,site}=make(kind,biome,variant,(kind==='farm'&&variant===1)||kind==='orchard');
        if(renderer)renderer.setGame(game);else renderer=createRenderer(canvas,game,{layers});
        renderer.resize();renderer.setZoom(zoom);renderer.focus(16,16);await settle(renderer);
        const before=renderer.getStats(),saved=JSON.stringify(game);let picked=0,onScreen=0;
        const rect=canvas.getBoundingClientRect();
        for(let dy=0;dy<site.footprint;dy++)for(let dx=0;dx<site.footprint;dx++){
          const p=renderer.worldToScreen(site.x+dx,site.y+dy);if(p.x<0||p.y<0||p.x>=960||p.y>=640)continue;onScreen++;
          const hit=renderer.screenToInspectTile(p.x+rect.left,p.y+rect.top);if(hit.x===site.x&&hit.y===site.y)picked++;
        }
        const truck=game.vehicles[0],point=renderer.worldToScreen(truck.x,truck.y),vehiclePick=renderer.vehicleAt(point.x+rect.left,point.y+rect.top)===truck;
        for(let n=0;n<5;n++)renderer.render(1100+n*34,{settle:true});
        const after=renderer.getStats();
        return {kind,biome,variant,zoom,picked,onScreen,vehiclePick,immutable:JSON.stringify(game)===saved,coldChunks:before.composedChunks,warmChunks:after.composedChunks-before.composedChunks,warmScenes:after.sceneBuilds-before.sceneBuilds,textures:fields.farmFieldsArtStats()};
      };
      const seamCheck=(span=5)=>{
        const site={kind:'farm',x:0,y:0,footprint:span,variant:1},whole=document.createElement('canvas'),split=document.createElement('canvas');whole.width=split.width=32*span;whole.height=split.height=32*span;
        fields.paintFarmFields(whole.getContext('2d'),{x0:0,y0:0,x1:span,y1:span},()=>site,'taiga');
        const c=split.getContext('2d');for(const [x0,y0,x1,y1]of [[0,0,3,3],[3,0,span,3],[0,3,3,span],[3,3,span,span]]){c.save();c.beginPath();c.rect(x0*32,y0*32,(x1-x0)*32,(y1-y0)*32);c.clip();fields.paintFarmFields(c,{x0,y0,x1,y1},()=>site,'taiga');c.restore();}
        const a=whole.getContext('2d').getImageData(0,0,32*span,32*span).data,b=split.getContext('2d').getImageData(0,0,32*span,32*span).data;let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return max;
      };
      const localEdit=async()=>{
        const {game}=make('farm','taiga');renderer.setGame(game);renderer.setZoom(1);renderer.focus(16,16);await settle(renderer);
        const read=()=>{const scratch=document.createElement('canvas');scratch.width=canvas.width;scratch.height=canvas.height;const c=scratch.getContext('2d');c.drawImage(canvas,0,0);return c.getImageData(0,0,scratch.width,scratch.height).data;};
        const before=read(),index=17*game.width+17,t=game.tiles[index],from=game.revision;t.terrain='sand';game.revision++;noteSurfaceChanges(game,from,game.revision,[index]);await settle(renderer);const edited=read();
        const next=game.revision;t.terrain='grass';game.revision++;noteSurfaceChanges(game,next,game.revision,[index]);await settle(renderer);const restored=read();let changed=0,max=0;
        for(let i=0;i<before.length;i++){if(before[i]!==edited[i])changed++;max=Math.max(max,Math.abs(before[i]-restored[i]));}
        return {changed,restoredMax:max};
      };
      const legacy=async()=>{const {game,site}=make('farm','taiga',0,false,3);const before=renderer.getStats().worldArtwork.rasterizedEntries['farm-core:farm:taiga']||0;renderer.setGame(game);renderer.setZoom(1);renderer.focus(14,14);await settle(renderer);return {large:fields.isLargeFarm(site),coreRaster:(renderer.getStats().worldArtwork.rasterizedEntries['farm-core:farm:taiga']||0)-before};};
      window.farmQA={run,seamCheck,localEdit,legacy};
    });
    const kinds=[['farm',0],['farm',1],['dairy-farm',0],['vegetable-farm',0],['orchard',0],['livestock-farm',0]];
    for(const biome of ['taiga','desert'])for(const [kind,variant]of kinds)for(const zoom of [.5,1,2]) {
      const row=await page.evaluate(args=>window.farmQA.run(...args),[kind,biome,variant,zoom]);row.dpr=dpr;results.push(row);
      assert.equal(row.picked,row.onScreen,`whole farm plot picking ${JSON.stringify(row)}`);assert.equal(row.onScreen,25);assert.ok(row.vehiclePick,'truck picking must return the authoritative vehicle');assert.ok(row.immutable);assert.equal(row.warmChunks,0);assert.equal(row.warmScenes,0);assert.ok(row.textures.textureBytes<=row.textures.textureLimit);
      if(dpr===1&&zoom===1)await page.locator('#world').screenshot({path:`${output}/${biome}-${kind}-${variant}.png`});
    }
    for(const span of [5,7])assert.equal(await page.evaluate(span=>window.farmQA.seamCheck(span),span),0,'current and legacy crop patterns must register across neighboring chunks');
    const local=await page.evaluate(()=>window.farmQA.localEdit());assert.ok(local.changed>100,'fields should retain the underlying terrain material');assert.equal(local.restoredMax,0,'journaled terrain restore must recover exactly');
    const legacy=await page.evaluate(()=>window.farmQA.legacy());assert.equal(legacy.large,false);assert.equal(legacy.coreRaster,0,'compact saved farms retain their parcel without a separate large-farm core');
    await page.close();
    // Generated barns can arrive after the first map frame. Their revision
    // must retire the cached native core without changing the saved farm.
    const late=await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:dpr});
    let release;const held=new Promise(resolve=>{release=resolve;});let blocked=0;
    await late.route(url=>farmCorePrefixes.some(prefix=>url.href.startsWith(prefix)),async route=>{blocked++;await held;await route.continue();});
    await late.route('**/farm-fields-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{width:960px;height:640px}</style><canvas></canvas>'}));
    await late.goto(new URL('farm-fields-qa',base).href);
    await late.evaluate(async()=>{
      const [{createRenderer},art,{DEFAULT_LAYERS}]=await Promise.all([import('./renderer.js'),import('./atlas-runtime.js'),import('./visibility.js')]);
      void art.preloadWorldArt({waitMs:0,cells:[64]});
      const game={day:1,width:32,height:32,biome:'taiga',seed:1847,revision:1,cities:[],industries:[{id:'farm',kind:'farm',x:12,y:12,footprint:5,stock:{}}],routes:[],stations:[],vehicles:[],tiles:Array.from({length:1024},()=>({terrain:'grass',elevation:0,detail:'',variant:0,road:false,rail:false,building:null,zone:null}))};
      const renderer=createRenderer(document.querySelector('canvas'),game,{layers:{...DEFAULT_LAYERS,names:false,industryIcons:false,grid:false},sceneryBatching:false});renderer.resize();renderer.setZoom(1);renderer.focus(15,15);
      const hash=()=>{const image=document.querySelector('canvas'),copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;const c=copy.getContext('2d');c.drawImage(image,0,0);const pixels=c.getImageData(0,0,copy.width,copy.height).data;let n=2166136261;for(const value of pixels)n=Math.imul(n^value,16777619);return n>>>0;};
      window.farmLate={game,renderer,art,hash};
    });
    await late.waitForFunction(count=>{const a=window.farmLate.art.worldArtStats();return a.usable===a.atlases-count;},FARM_CORE_PLOT_ATLASES.length);
    assert.ok(blocked>=FARM_CORE_PLOT_ATLASES.length,'every registered core family must be held unavailable');
    const initial=await late.evaluate(()=>{const q=window.farmLate;q.renderer.render(1000,{settle:true});return{hash:q.hash(),game:JSON.stringify(q.game),revision:q.art.worldArtRevision(),core:q.art.worldArtStats().rasterizedEntries['farm-core:farm:taiga']||0};});
    assert.equal(initial.core,0,'blocked generated cores should use native recovery');release();
    await late.waitForFunction(previous=>window.farmLate.art.worldArtRevision()>previous&&window.farmLate.art.worldArtStats().loading===0,initial.revision);
    const loaded=await late.evaluate(()=>{const q=window.farmLate;q.renderer.render(1000,{settle:true});return{hash:q.hash(),game:JSON.stringify(q.game),core:q.art.worldArtStats().rasterizedEntries['farm-core:farm:taiga']||0};});
    assert.notEqual(loaded.hash,initial.hash,'late generated core should replace native cached artwork');assert.equal(loaded.game,initial.game);assert.ok(loaded.core>0);await late.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({profiles:results.length,results,errors},null,2));console.log(`PASS ${results.length} large-farm profiles: full-plot picks, trucks, warm caches, slope fields, chunk registration, terrain edits, legacy art.`);
} finally { await browser.close(); }
