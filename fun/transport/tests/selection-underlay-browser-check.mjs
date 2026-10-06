import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base=process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output=process.env.TRANSPORT_OUTPUT || '/tmp/transport-selection-underlay';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER || 'chrome',headless:true});
const results=[],errors=[];
try {
  for(const dpr of [1,2]){
    const page=await browser.newPage({viewport:{width:1100,height:800},deviceScaleFactor:dpr});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/selection-underlay-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{display:block;width:1100px;height:800px}</style><canvas></canvas>'}));
    await page.goto(new URL('selection-underlay-qa',base).href);
    await page.evaluate(async()=>{
      const [{createRenderer},geometry,{preloadWorldArt},{preloadHouses},{MAP,alpha}]=await Promise.all([import('./renderer.js'),import('./terrain-geometry.js'),import('./atlas-runtime.js'),import('./raster-houses.js'),import('./design-tokens.js')]);
      await Promise.all([preloadWorldArt({biome:'taiga',waitMs:12000}),preloadHouses({biome:'taiga',waitMs:12000})]);
      const game={biome:'taiga',seed:17,width:64,height:64,day:0,revision:1,networkRevision:1,cities:[],industries:[],stations:[],routes:[],vehicles:[],zones:[]};
      game.tiles=Array.from({length:4096},()=>({terrain:'grass',elevation:.25,detail:'',variant:0,building:null,road:false,rail:false,publicRoad:false}));
      const cases=[],add=(name,x,y,w,h=w,extra={})=>cases.push({name,x,y,w,h,...extra});
      for(let y=8;y<=26;y++)for(let x=8;x<=24;x++)game.tiles[y*64+x].building={kind:'house-cheap-1',footprint:1,level:1};
      for(const [name,x,y,w,kind]of[['house',18,18,1,'house-cheap-1'],['prestige garden',26,18,2,'house-expensive-3'],['stadium',34,18,3,'stadium'],['sloped house',54,48,2,'house-expensive-3']]){
        game.tiles[y*64+x].building={kind,footprint:w,level:1};add(name,x,y,w);
      }
      game.tiles[18*64+18].building.owner='player';game.tiles[18*64+18].zone='residential';
      game.tiles[49*64+55].elevation=4/7;
      for(const [name,x,y,w,kind]of[['factory',44,18,5,'food-plant'],['legacy factory 3',54,18,3,'food-plant'],['legacy factory 2',56,26,2,'food-plant'],['legacy factory 1',59,31,1,'food-plant'],['farm fields',18,34,5,'farm'],['legacy farm fields',30,34,7,'farm']]){
        game.industries.push({id:name,name,kind,x,y,footprint:w,stock:{},input:{},output:{}});add(name,x,y,w);
      }
      for(const [name,x,y,w,kind,detail]of[['grove',44,34,3,'forest','conifer'],['outcrop',54,34,2,'rock','outcrop'],['sloped grove',40,56,3,'forest','conifer']]){
        for(let dy=0;dy<w;dy++)for(let dx=0;dx<w;dx++)game.tiles[(y+dy)*64+x+dx].terrain=kind;
        game.tiles[y*64+x].terrainObject={kind,detail,footprint:w,variant:0};add(name,x,y,w);
      }
      game.tiles[57*64+41].elevation=4/7;
      for(const [name,x,y,axis,w,h]of[['airport x',18,49,'x',6,2],['airport y',30,48,'y',2,6]]){
        game.stations.push({id:name,name,mode:'air',axis,x,y});add(name,x,y,w,h);
      }
      game.stations.push({id:'stop',name:'Stop',mode:'road',x:44,y:50});game.tiles[50*64+44].road=true;add('stop',44,50,1);
      for(let x=44;x<=51;x++)game.tiles[50*64+x].road=true;
      const path=Array.from({length:8},(_,n)=>({x:44+n,y:50}));
      game.routes.push({id:'road',mode:'road',cargo:'grain',path,stops:[],active:true,color:'#cb6b36',number:1});
      game.vehicles.push({id:'truck',routeId:'road',x:48.2,y:50,angle:0,progress:4.2,level:1,capacity:20,load:0});
      add('truck',48,50,1,1,{vehicleId:'truck'});
      for(let y=7;y<=12;y++)for(let x=48;x<=61;x++)Object.assign(game.tiles[y*64+x],{terrain:'water',elevation:0});
      game.routes.push({id:'sea',mode:'water',cargo:'grain',path:[{x:50,y:9},{x:55,y:9}],stops:[],active:true,color:'#cb6b36',number:2});
      game.vehicles.push({id:'ship',routeId:'sea',x:52.3,y:9.2,angle:0,progress:.5,level:1,capacity:100,load:0});add('ship',52,9,1,1,{vehicleId:'ship'});
      game.routes.push({id:'air',mode:'air',cargo:'passengers',path:Array.from({length:15},(_,n)=>({x:18+n,y:49})),stops:['airport x','airport y'],active:true,color:'#cb6b36',number:3});
      game.vehicles.push({id:'parked plane',routeId:'air',x:18,y:49,progress:0,direction:1,dwellRemaining:.8,level:1,capacity:50,load:0},{id:'flying plane',routeId:'air',x:25,y:49,progress:7,direction:1,dwellRemaining:0,level:1,capacity:50,load:0});
      const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),mask=document.createElement('canvas'),maskContext=mask.getContext('2d');
      const renderer=createRenderer(canvas,game,{layers:{weather:false,names:false,industryIcons:false,vehicleLoads:false,grid:false,routes:false},sceneryPanSettleMs:0});
      for(const vehicle of game.vehicles.filter(vehicle=>vehicle.routeId==='air')){const point=renderer.vehicleWorldPoint(vehicle);add(vehicle.id,Math.floor(point.x+.5),Math.floor(point.y+.5),1,1,{vehicleId:vehicle.id});}
      const calls={fills:[],strokes:[],images:[],draws:[],path:[],underlay:false,order:0},imageIds=new WeakMap();let nextImageId=0,recording=false;
      const original={};for(const name of ['beginPath','moveTo','lineTo','closePath','fill','stroke','drawImage'])original[name]=ctx[name].bind(ctx);
      ctx.beginPath=(...args)=>{if(recording)calls.path=[];return original.beginPath(...args);};
      for(const name of ['moveTo','lineTo'])ctx[name]=(x,y,...args)=>{if(recording)calls.path.push({kind:name,x,y});return original[name](x,y,...args);};
      ctx.closePath=(...args)=>{if(recording)calls.path.push({kind:'closePath'});return original.closePath(...args);};
      ctx.fill=(...args)=>{if(recording){calls.order++;if(typeof ctx.fillStyle==='string'&&ctx.fillStyle.replace(/\s/g,'')===alpha(MAP.selection.color,.18)){calls.underlay=true;calls.fills.push({path:calls.path.slice(),transform:[...ctx.getTransform().toFloat64Array()],order:calls.order});}}return original.fill(...args);};
      ctx.stroke=(...args)=>{if(recording){calls.order++;if(ctx.strokeStyle===MAP.selection.color.toLowerCase())calls.strokes.push({path:calls.path.slice(),order:calls.order});}return original.stroke(...args);};
      ctx.drawImage=(image,...args)=>{
        if(recording){calls.order++;if(!imageIds.has(image))imageIds.set(image,++nextImageId);calls.draws.push({id:imageIds.get(image),args,alpha:ctx.globalAlpha,transform:[...ctx.getTransform().toFloat64Array()]});if(calls.underlay){calls.images.push({order:calls.order,alpha:ctx.globalAlpha});maskContext.setTransform(ctx.getTransform());maskContext.globalAlpha=ctx.globalAlpha;maskContext.imageSmoothingEnabled=ctx.imageSmoothingEnabled;maskContext.imageSmoothingQuality=ctx.imageSmoothingQuality;maskContext.drawImage(image,...args);}}
        return original.drawImage(image,...args);
      };
      const reset=()=>{calls.fills=[];calls.strokes=[];calls.images=[];calls.draws=[];calls.path=[];calls.underlay=false;calls.order=0;mask.width=canvas.width;mask.height=canvas.height;recording=true;};
      const pixels=()=>ctx.getImageData(0,0,canvas.width,canvas.height).data;
      window.selectionQA={game,cases,canvas,renderer,geometry,calls,mask,maskContext,reset,pixels,stop:()=>{recording=false;}};
    });
    for(const zoom of [.5,1,2])for(const index of await page.evaluate(()=>selectionQA.cases.map((_,index)=>index))){
      const row=await page.evaluate(async({zoom,dpr,index})=>{
        const {cases,canvas,renderer:r,geometry,calls,maskContext,game,reset,pixels,stop}=selectionQA,site=cases[index],step=24,view={settle:true,showRoutes:false};
        r.setLayers({vehicles:Boolean(site.vehicleId)});r.setZoom(zoom);r.setTerrainHeight(step);r.focus(site.x+(site.w-1)/2,site.y+(site.h-1)/2);
        for(let n=0;n<45;n++)r.render(0,view);
        await new Promise(resolve=>setTimeout(resolve,120));for(let n=0;n<10;n++)r.render(0,view);
        reset();r.render(0,view);stop();const before=pixels(),baselineDraws=JSON.stringify(calls.draws),stats=r.getStats(),selected={x:site.x+site.w-1,y:site.y+site.h-1},selectionView=site.vehicleId?{...view,selectedVehicleId:site.vehicleId}:{...view,selected,propertyOutlines:site.name==='house'};
        reset();r.render(0,selectionView);stop();const after=pixels(),mask=maskContext.getImageData(0,0,canvas.width,canvas.height).data,drawsUnchanged=baselineDraws===JSON.stringify(calls.draws);
        let changed=0,opaque=0,opaqueChanged=0,maxOpaqueDifference=0,maxMaskAlpha=0;
        // A prepared transparent scene can round a fully painted pixel to
        // alpha 254. Include that one-byte compositing fringe in the same
        // established four-channel-value cache parity tolerance.
        for(let i=0;i<before.length;i+=4){const delta=Math.max(Math.abs(before[i]-after[i]),Math.abs(before[i+1]-after[i+1]),Math.abs(before[i+2]-after[i+2]),Math.abs(before[i+3]-after[i+3]));if(delta)changed++;maxMaskAlpha=Math.max(maxMaskAlpha,mask[i+3]);if(mask[i+3]>=254){opaque++;if(delta>4)opaqueChanged++;maxOpaqueDifference=Math.max(maxOpaqueDifference,delta);}}
        const fill=calls.fills[0],expected=[];
        for(let dy=0;dy<site.h;dy++)for(let dx=0;dx<site.w;dx++)for(const [u,v]of [[site.x+dx,site.y+dy],[site.x+dx+1,site.y+dy],[site.x+dx+1,site.y+dy+1],[site.x+dx,site.y+dy+1]])expected.push(geometry.projectGround(game,u,v,step));
        const actual=fill?.path.filter(p=>p.kind!=='closePath')||[],maxProjectionDifference=actual.length===expected.length?Math.max(...actual.map((p,i)=>Math.hypot(p.x-expected[i].x,p.y-expected[i].y))):Infinity;
        const fillCount=calls.fills.length,strokes=calls.strokes.map(s=>s.order),images=calls.images.map(image=>image.order),alphas=calls.images.map(image=>image.alpha);
        r.render(0,selectionView);const warm=r.getStats();r.render(0,view);const restored=pixels();let maxRestoredDifference=0;for(let i=0;i<before.length;i++)maxRestoredDifference=Math.max(maxRestoredDifference,Math.abs(before[i]-restored[i]));
        // Keeping the pointer over a clicked parcel must not redraw a late
        // hover outline over the sprite or its garden fence.
        let maxHoverDifference=0;
        if(!site.vehicleId){r.render(0,{...selectionView,hover:selected});const hovered=pixels();for(let i=0;i<after.length;i++)maxHoverDifference=Math.max(maxHoverDifference,Math.abs(after[i]-hovered[i]));}
        return {name:site.name,dpr,zoom,step,tiles:site.w*site.h,fillCount,actualPoints:actual.length,maxProjectionDifference,changed,drawsUnchanged,opaque,opaqueChanged,maxOpaqueDifference,maxMaskAlpha,maxRestoredDifference,maxHoverDifference,fillOrder:fill?.order,strokes,images,alphas,selectedPropertyOutlines:warm.propertyOutlines,sceneBuilds:stats.sceneBuilds,warmBuilds:warm.sceneBuilds,chunkBuilds:stats.composedChunks,warmChunks:warm.composedChunks,viewBuilds:stats.sceneryBatches.viewBuilds,warmViewBuilds:warm.sceneryBatches.viewBuilds,batchBuilds:stats.sceneryBatches.builds,warmBatchBuilds:warm.sceneryBatches.builds};
      },{zoom,dpr,index});
      results.push(row);
      await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
      assert.equal(row.fillCount,1,`${row.name}: one ground-area underlay`);
      assert.equal(row.actualPoints,row.tiles*4,`${row.name}: full logical footprint, including fields and rotated airports`);
      assert.ok(row.maxProjectionDifference<1e-8,`${row.name}: every tile follows the current projected terrain`);
      assert.ok(row.changed>0,`${row.name}: selection is visible`);
      assert.ok(row.drawsUnchanged,`${row.name}: sprite sources, position, transforms and opacity remain exactly unchanged`);
      if(row.name!=='sloped grove')assert.ok(row.opaque>0,`${row.name}: visible opaque sprite pixels are covered by the comparison`);
      assert.equal(row.opaqueChanged,0,`${row.name}: the tint and border never paint over opaque sprite pixels`);
      assert.ok(row.strokes.every(order=>row.images.every(image=>order<image)),`${row.name}: sprite bodies draw after all selection borders`);
      assert.equal(row.sceneBuilds,row.warmBuilds);assert.equal(row.chunkBuilds,row.warmChunks);assert.equal(row.batchBuilds,row.warmBatchBuilds);assert.equal(row.viewBuilds,row.warmViewBuilds);
      assert.equal(row.maxRestoredDifference,0,`${row.name}: deselect exactly restores cached normal pixels`);
      assert.equal(row.maxHoverDifference,0,`${row.name}: redundant hover cannot stroke above the selected sprite`);
      if(row.name==='house')assert.equal(row.selectedPropertyOutlines,0,'ownership marks cannot restroke the selected garden above its artwork');
      console.log(`${dpr} DPR / ${zoom} zoom: ${row.name} passed`);
    }
    for(const step of [0,12,28]){
      const row=await page.evaluate(step=>{
        const {renderer:r,cases,reset,calls,geometry,game,stop}=selectionQA,site=cases.find(site=>site.name==='sloped house');
        r.setTerrainHeight(step);r.setZoom(1);r.focus(site.x+.5,site.y+.5);r.render(0,{settle:true});reset();r.render(0,{selected:{x:site.x+1,y:site.y+1},settle:true});stop();
        const actual=calls.fills[0].path.filter(p=>p.kind!=='closePath'),expected=[];for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)for(const [u,v]of[[site.x+dx,site.y+dy],[site.x+dx+1,site.y+dy],[site.x+dx+1,site.y+dy+1],[site.x+dx,site.y+dy+1]])expected.push(geometry.projectGround(game,u,v,step));
        return{step,maxDifference:Math.max(...actual.map((p,i)=>Math.hypot(p.x-expected[i].x,p.y-expected[i].y)))};
      },step);assert.ok(row.maxDifference<1e-8);results.push({dpr,...row});
    }
    await page.evaluate(()=>{const r=selectionQA.renderer;r.setTerrainHeight(24);r.setZoom(1);r.focus(19,35);r.render(0,{selected:{x:22,y:38},settle:true});});
    await page.screenshot({path:`${output}/selected-farm-dpr${dpr}.png`});
    await page.evaluate(()=>{const r=selectionQA.renderer;r.focus(54.5,48.5);r.render(0,{selected:{x:55,y:49},hover:{x:55,y:49},settle:true});});
    await page.screenshot({path:`${output}/selected-sloped-house-dpr${dpr}.png`});
    await page.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
  console.log(`Selection underlay: ${results.length} footprint/height/zoom/density profiles passed, no errors.`);
} finally {await browser.close();}
