// Isolated desktop contexts verify the view preference and every projected layer.
import assert from 'node:assert/strict';
import { chooseBuildTool } from './browser-build.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-terrain-height';
await mkdir(output, { recursive: true });
const errors=[],profiles=[],layouts=[];
const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1.1,`${label}: ${actual} != ${expected}`);
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await createWorldFromMenu(page,{size:'square512',generationVersion:10});
  const openMapOptions=async()=>{
    if(await page.locator('#map-options').isVisible())return;
    await openGameAction(page, 'map-options-button');
    await page.locator('#terrain-height').waitFor({state:'visible'});
  };
  assert.equal(await page.locator('.topbar #terrain-height').count(),0,'terrain height leaves the persistent instruments');
  assert.equal(await page.locator('#terrain-height').isVisible(),false,'terrain height appears only on request');
  await openMapOptions();
  assert.equal(await page.locator('#terrain-height').inputValue(),'12');
  assert.deepEqual(await page.locator('#terrain-height option').allTextContents(),['Flat','Gentle','Normal','Steep']);
  const before=await page.evaluate(()=>JSON.stringify(transport.game));
  for(const step of[0,6,12,14]){
    await page.getByLabel('Terrain height',{exact:true}).selectOption(String(step));
    assert.equal(await page.evaluate(()=>transport.renderer.getStats().heightStep),step);
    assert.equal(await page.evaluate(()=>JSON.stringify(transport.game)),before,'relief controls never mutate the world');
    assert.equal(await page.locator('#map-options').isVisible(),true,'adjusting the terrain keeps its settings open');
  }
  await page.locator('#terrain-height').focus();await page.keyboard.press('Space');await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>transport.speed),0,'a native select key does not change simulation speed');
  await openMapOptions();
  await page.locator('#terrain-height').focus();await page.keyboard.press('r');await page.keyboard.press('g');
  assert.equal(await page.locator('#active-tool-bar').isVisible(),false,'select keys never activate a map tool');
  assert.equal(await page.evaluate(()=>JSON.stringify(transport.game)),before);
  await page.keyboard.press('Escape');await page.locator('#map-options').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.id==='game-menu-button');
  for(const width of[1440,1280,1024,900,720,640,520]){
    await page.setViewportSize({width,height:900});
    await openMapOptions();
    const layout=await page.evaluate(()=>{
      const select=document.querySelector('#terrain-height').getBoundingClientRect(),menu=document.querySelector('#map-options').getBoundingClientRect(),label=document.querySelector('.terrain-height-control>span:not([data-icon])').getBoundingClientRect();
      return{width:innerWidth,select:select.toJSON(),menu:menu.toJSON(),label:label.toJSON(),overflow:document.documentElement.scrollWidth-innerWidth};
    });layouts.push(layout);
    assert.ok(layout.select.left>=layout.menu.left&&layout.select.right<=layout.menu.right,`${width}px desktop keeps terrain height inside Map options`);
    assert.ok(layout.select.top>=layout.menu.top&&layout.select.bottom<=layout.menu.bottom);
    assert.ok(layout.label.width>0&&layout.label.right<layout.select.left,'Terrain height has a readable visible label');
    assert.ok(layout.select.width>=75&&layout.select.height>=32,'the native field remains readable and easy to target');
    assert.ok(layout.menu.left>=0&&layout.menu.right<=width+1&&layout.overflow<=1,`${width}px desktop has no horizontal overflow`);
    if([1440,1024].includes(width))await page.screenshot({path:`${output}/map-options-${width}.png`});
    await page.keyboard.press('Escape');await page.locator('#map-options').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.id==='game-menu-button');
    if([1440,1024].includes(width))await page.screenshot({path:`${output}/instruments-${width}.png`});
  }
  for(const height of [280,320]){
    await page.setViewportSize({width:640,height});await openMapOptions();
    await page.locator('#terrain-height').focus();
    const field=await page.locator('#terrain-height').boundingBox(),menu=await page.locator('#map-options').boundingBox();
    assert.ok(menu.y+menu.height<=height,'short computer windows contain the settings sheet');
    assert.ok(field.y>=menu.y&&field.y+field.height<=menu.y+menu.height,'focusing the terrain field scrolls it into the sheet');
    assert.equal(await page.locator('#map-options').evaluate(node=>getComputedStyle(node).overflowY),'auto');
    await page.locator('#terrain-height').selectOption('14');
    assert.equal(await page.evaluate(()=>transport.renderer.getTerrainHeight()),14,'terrain height remains usable in a short window');
    await page.keyboard.press('Escape');await page.locator('#map-options').waitFor({state:'hidden'});
  }
  await page.setViewportSize({width:1280,height:900});
  await chooseBuildTool(page,'road');
  await openMapOptions();
  const beforeDismiss=await page.evaluate(()=>JSON.stringify(transport.game)),camera=await page.evaluate(()=>transport.renderer.getCamera());
  await page.locator('#world').click({position:{x:750,y:350}});
  await page.locator('#map-options').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>JSON.stringify(transport.game)),beforeDismiss,'dismissing options does not place the active road tool');
  assert.deepEqual(await page.evaluate(()=>transport.renderer.getCamera()),camera,'dismissing options does not move the map');
  await page.keyboard.press('Escape');
  await openMapOptions();await page.locator('#terrain-height').selectOption('14');await page.keyboard.press('Escape');
  await page.evaluate(()=>transport.persist());
  await page.reload();await loadAutosaveFromMenu(page);
  assert.equal(await page.locator('#terrain-height').inputValue(),'14','the chosen view survives a reload');
  assert.equal(await page.evaluate(()=>transport.renderer.getTerrainHeight()),14);
  await page.close();

  for(const dpr of[1,2]){
    const fixture=await browser.newPage({viewport:{width:1100,height:800},deviceScaleFactor:dpr});
    fixture.on('pageerror',error=>errors.push(error.message));
    await fixture.route('**/terrain-height-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{display:block;width:1100px;height:800px}#other{display:none}</style><canvas></canvas><canvas id="other"></canvas>'}));
    await fixture.goto(new URL('terrain-height-qa',base).href);
    await fixture.evaluate(async()=>{
      const {SPRITE_SCALE}=await import('./sprite-art-direction.js'),{createGame}=await import('./model.js'),{createRenderer}=await import('./renderer.js'),geometry=await import('./terrain-geometry.js'),{preloadWorldArt}=await import('./atlas-runtime.js'),{preloadHouses}=await import('./raster-houses.js');
      await Promise.all([preloadWorldArt({waitMs:12000}),preloadHouses({biome:'taiga',waitMs:12000})]);
      const original=createGame({size:'regional',seed:1847,generationVersion:10}),game={...original,width:64,height:64,day:0,revision:1,networkRevision:1};
      for(const key of['cities','industries','stations','routes','vehicles','zones'])game[key]=[];
      game.tiles=Array.from({length:4096},(_,id)=>{const x=id%64,y=Math.floor(id/64);return{terrain:x>=24&&x<=27?'water':'grass',elevation:x>=24&&x<=27?0:3/7,detail:'',variant:0,building:null,zone:null,road:false,rail:false,bridge:false,tunnel:false,publicRoad:false};});
      for(let x=20;x<=35;x++){const tile=game.tiles[20*64+x];tile.road=true;if(x>=24&&x<=27)Object.assign(tile,{bridge:true,structureAxis:'x',structureLevel:3});}
      game.tiles[32*64+40].building={kind:'house-expensive-3',level:1,footprint:2};game.tiles[33*64+41].elevation=4/7;
      const path=Array.from({length:16},(_,n)=>({x:20+n,y:20}));
      game.routes=[{id:'qa-road',mode:'road',cargo:'grain',active:true,stops:[],path,color:'#cb6b36',number:1}];
      game.vehicles=[{id:'qa-truck',routeId:'qa-road',x:25,y:20,angle:0,progress:5,load:0,capacity:20,level:1}];
      const layers={trees:false,zones:false,names:false,industryIcons:false,stations:false,vehicleLoads:false,weather:false,grid:true,roads:true,rails:true,buildings:true,vehicles:true,routes:true};
      const canvas=document.querySelector('canvas'),renderer=createRenderer(canvas,game,{layers,sceneryBatching:false}),other=createRenderer(document.querySelector('#other'),game,{layers,heightStep:6,sceneryBatching:false});
      window.heightQA={game,canvas,renderer,other,geometry,frame:SPRITE_SCALE.billboardPixelsPerTile,before:JSON.stringify(game)};
    });
    for(const zoom of[.5,1,2])for(const step of[12,0,6,14]){
      const result=await fixture.evaluate(({zoom,step,dpr})=>{
        const {game:g,canvas,renderer:r,other,geometry:k,frame,before}=heightQA,rect=canvas.getBoundingClientRect(),c=canvas.getContext('2d');
        r.setZoom(zoom);r.focus(40.5,32.5);r.pan(31,-17);
        const centerBefore=r.screenToTile(rect.left+550,rect.top+400),oldComposed=r.getStats().composedChunks;
        r.setTerrainHeight(step);
        const centerAfter=r.screenToTile(rect.left+550,rect.top+400),checks=[];
        for(const [x,y]of[[40.1,32.2],[41,33],[28,21],[31,31],[32,32],[0,0],[63,63]]){
          r.focus(x,y);const p=r.worldToScreen(x,y);checks.push({expected:{x:Math.floor(x+.5),y:Math.floor(y+.5)},picked:r.screenToTile(rect.left+p.x,rect.top+p.y)});
        }
        r.focus(25,20);let capturedTruck=null,buildings=[];const original=c.drawImage;
        c.drawImage=function(image,...args){
          const m=this.getTransform();
          if(image.vehicleFrame?.kind==='truck')capturedTruck={x:m.e/dpr,y:m.f/dpr};
          if(args.length===4&&args[2]===frame*2&&args[3]===frame*2.25)buildings.push({x:(m.a*args[0]+m.c*args[1]+m.e)/dpr,y:(m.b*args[0]+m.d*args[1]+m.f)/dpr});
          return original.call(this,image,...args);
        };
        try{r.render(0,{settle:true,showRoutes:false});}finally{c.drawImage=original;}
        const deck=k.bridgeDeckHeight(g,25,20),vehicle=r.worldToScreen(25,20);vehicle.y+=(k.surfaceHeight(g,25.5,20.5)-deck)*step*zoom;
        const bridgePick=r.screenToTile(rect.left+vehicle.x,rect.top+vehicle.y),vehiclePick=r.vehicleAt(rect.left+vehicle.x,rect.top+vehicle.y)?.id;
        const withRoad=c.getImageData(0,0,canvas.width,canvas.height).data;
        r.setLayers({roads:false});r.render(0,{settle:true,showRoutes:false});const withoutRoad=c.getImageData(0,0,canvas.width,canvas.height).data;
        let roadInk=0;const road=r.worldToScreen(30,20);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const i=((Math.round(road.y*dpr)+dy)*canvas.width+Math.round(road.x*dpr)+dx)*4;roadInk=Math.max(roadInk,Math.abs(withRoad[i]-withoutRoad[i])+Math.abs(withRoad[i+1]-withoutRoad[i+1])+Math.abs(withRoad[i+2]-withoutRoad[i+2]));}
        r.setLayers({roads:true});r.focus(40.5,32.5);buildings=[];c.drawImage=function(image,...args){const m=this.getTransform();if(args.length===4&&args[2]===frame*2&&args[3]===frame*2.25)buildings.push({x:(m.a*args[0]+m.c*args[1]+m.e)/dpr,y:(m.b*args[0]+m.d*args[1]+m.f)/dpr});return original.call(this,image,...args);};
        try{r.render(0,{settle:true});}finally{c.drawImage=original;}
        const anchor=r.worldToScreen(40.5,32.5),foundationLevel=Math.max(...[40,41,42].flatMap(x=>[32,33,34].map(y=>k.surfaceHeight(g,x,y))));
        const expectedBuilding={x:anchor.x-frame*zoom,y:anchor.y+(k.surfaceHeight(g,41,33)-foundationLevel)*step*zoom-frame*1.75*zoom};
        const routeBuilds=r.getStats().routePathBuilds,warm=r.getStats().composedChunks;r.render(0,{settle:true});
        return{dpr,zoom,step,centerBefore,centerAfter,checks,bridgePick,vehiclePick,capturedTruck,vehicle,roadInk,buildings,expectedBuilding,routeBuilds,routeWarm:r.getStats().routePathBuilds-routeBuilds,warmRebuilds:r.getStats().composedChunks-warm,composed:r.getStats().composedChunks-oldComposed,otherHeight:other.getTerrainHeight(),unchanged:JSON.stringify(g)===before};
      },{zoom,step,dpr});profiles.push(result);
      await writeFile(`${output}/results.json`,JSON.stringify({layouts,profiles,errors},null,2));
      assert.deepEqual(result.centerAfter,result.centerBefore,'relief changes preserve the ground under the view centre');
      for(const check of result.checks)assert.deepEqual(check.picked,check.expected);
      assert.deepEqual(result.bridgePick,{x:25,y:20});assert.equal(result.vehiclePick,'qa-truck');
      assert.ok(result.capturedTruck,'the rendered truck is present');close(result.capturedTruck.x,result.vehicle.x,'vehicle x');close(result.capturedTruck.y,result.vehicle.y,'vehicle y follows its deck');
      assert.ok(result.roadInk>4,`the road follows its projected ground centre (${dpr} DPR, ${zoom} zoom, ${step}px relief)`);
      assert.ok(result.buildings.some(p=>Math.abs(p.x-result.expectedBuilding.x)<1.1&&Math.abs(p.y-result.expectedBuilding.y)<1.1),'building anchor follows the top of its stone foundation');
      assert.equal(result.otherHeight,6,'another renderer keeps its independent relief');assert.equal(result.unchanged,true);
      assert.equal(result.warmRebuilds,0);assert.equal(result.routeWarm,0);
      if(zoom===1)await fixture.locator('canvas').first().screenshot({path:`${output}/relief-${step}-dpr${dpr}.png`});
    }
    await fixture.close();
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/results.json`,JSON.stringify({layouts,profiles,errors},null,2));
  console.log(`Terrain height: ${profiles.length} relief/zoom/density profiles, ${layouts.length} desktop widths, preference reload, projected roads, bridge, truck and foundation passed.`);
}finally{await browser.close();}
