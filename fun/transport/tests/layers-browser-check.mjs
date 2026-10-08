// Serve the repository root first; all preferences and worlds use isolated storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-layers-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => page.on('pageerror', error => errors.push(error.message));
const currentLayers = page => page.evaluate(() => transport.renderer.getLayers());
const fits = (page, selector) => page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1);
async function clickMapOption(page, selector) {
  if (!(await page.locator(selector).isVisible())) await openGameAction(page, 'map-options-button');
  await page.locator(selector).click();
}
async function openLayers(page) {
  if (!(await page.locator('#layers-panel').isVisible())) await openGameAction(page, 'layers-button');
  await page.locator('#layers-panel').waitFor({ state: 'visible' });
}
async function setLayer(page, key, value) {
  const input=page.locator(`[data-layer="${key}"]`);
  if (!await input.isVisible()) {
    const screen=await input.evaluate(element=>element.closest('[data-layer-screen]')?.dataset.layerScreen);
    await page.locator(`[data-layer-page="${screen}"]`).click();
  }
  await input.setChecked(value);
  await page.waitForFunction(({ key, value }) => transport.renderer.getLayers()[key] === value, { key, value });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page);
  await page.locator('[data-speed="0"]').click();
  const miniSamples = () => page.evaluate(() => transport.renderer.getStats().minimapTerrainSamples);
  assert.equal(await miniSamples(), 0, 'loading a world does not sample the hidden mini map');
  const defaults = await page.evaluate(async () => (await import('./visibility.js')).DEFAULT_LAYERS);
  const keys = Object.keys(defaults);
  assert.equal(keys.length, 15);
  assert.deepEqual(await currentLayers(page), defaults);
  assert.equal(defaults.grid, false, 'a fresh browser leaves exploration free of the tile grid');
  const beforeConstruction = await page.evaluate(() => localStorage.getItem('transport-visibility-v1'));
  await page.keyboard.press('r');
  await page.locator('#active-tool-bar').waitFor({ state: 'visible' });
  assert.equal((await currentLayers(page)).grid, false, 'a construction guide does not enable the persistent Grid layer');
  assert.equal(await page.evaluate(() => localStorage.getItem('transport-visibility-v1')), beforeConstruction, 'temporary construction guides do not save a layer preference');
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  assert.equal((await currentLayers(page)).grid, true, 'G can keep the grid visible during exploration');
  await page.reload();await loadAutosaveFromMenu(page);await page.locator('[data-speed="0"]').click();
  assert.equal((await currentLayers(page)).grid, true, 'the explicit Grid on preference survives reload');
  await page.keyboard.press('g');
  await openLayers(page);await setLayer(page, 'grid', false);
  await page.reload();await loadAutosaveFromMenu(page);await page.locator('[data-speed="0"]').click();
  assert.equal((await currentLayers(page)).grid, false, 'the Layers off preference survives reload');
  assert.equal(await page.locator('#grid-button').getAttribute('aria-pressed'), 'false');
  await openLayers(page);
  assert.equal(await page.locator('#layers-button').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), false, 'Layers is a nonmodal map control');
  assert.equal(await page.locator('#layers-panel input[type="checkbox"][role="switch"][data-layer]').count(), 15);
  const stateBefore = await page.evaluate(() => JSON.stringify(transport.game));
  for (const key of keys) {
    assert.equal(await page.locator(`[data-layer="${key}"]`).isChecked(), defaults[key]);
    assert.ok(await page.locator(`[data-layer="${key}"]`).evaluate(input => [...input.labels].some(label => label.textContent.trim().length)), `${key} has a visible native label`);
    await setLayer(page, key, !defaults[key]);
    await setLayer(page, key, defaults[key]);
  }
  assert.equal(await page.evaluate(() => JSON.stringify(transport.game)), stateBefore, 'visibility controls never mutate the company or terrain');
  assert.equal(await miniSamples(), 0, 'layer switches do not resample the hidden mini map');
  await page.screenshot({ path: `${output}/desktop-layers-panel.png` });

  await page.locator('[data-layer-preset="terrain"]').click();
  assert.ok(Object.values(await currentLayers(page)).every(value => value === false), 'Terrain hides every optional layer');
  await page.locator('[data-layer-preset="all"]').click();
  assert.ok(Object.values(await currentLayers(page)).every(value => value === true), 'Show all also enables the grid');
  await setLayer(page, 'grid', false);
  await page.locator('[data-layers-close]').click();
  await page.locator('#layers-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'layers-button', 'Close returns focus to the direct Layers action');
  await page.keyboard.press('Enter');
  await page.locator('#layers-panel').waitFor({ state: 'visible' });
  await page.locator('[data-layer="trees"]').focus();
  await page.keyboard.press('Space');
  assert.equal((await currentLayers(page)).trees, false, 'Space activates the focused native switch');
  assert.equal(await page.evaluate(() => transport.speed), 0, 'a switch key does not trigger the global pause shortcut');
  await page.keyboard.press('Escape');
  await page.locator('#layers-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'layers-button', 'Escape restores focus to the direct Layers action');
  await openLayers(page);
  await setLayer(page, 'trees', true);
  await page.locator('#company-stats').click();
  await page.locator('#layers-panel').waitFor({ state: 'hidden' });
  await page.locator('#company-stats').click();
  await page.locator('[data-speed="1"]').click();
  const day = await page.evaluate(() => transport.game.day);
  await openLayers(page);
  await page.waitForFunction(day => transport.game.day > day + .2, day);
  assert.equal(await page.evaluate(() => transport.speed), 1, 'opening Layers keeps the simulation running');
  await page.locator('[data-speed="0"]').click();

  // Existing map shortcuts share the same state as the corresponding switches.
  for(const [key,button] of [['grid','#grid-button'],['routes','#routes-toggle']]){
    const before=(await currentLayers(page))[key];
    await clickMapOption(page, button);
    await openLayers(page);
    assert.equal(await page.locator(`[data-layer="${key}"]`).isChecked(),!before,`${key} map button updates its Layers switch`);
    await setLayer(page,key,before);
    assert.equal(await page.locator(button).getAttribute('aria-pressed'),String(before),`${key} switch updates its map button`);
    await page.locator('[data-layers-close]').click();
  }

  // At Region zoom the fourteen-pixel stop badge extends beyond its map tile.
  // Only a visible badge may intercept that neighboring tile in the route picker.
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#new-route-button').click();
  // A second Routes click while the drawer slides open would close it again.
  await page.locator('#route-form').waitFor({ state: 'visible' });
  const station=await page.evaluate(()=>transport.game.stations.find(stop=>stop.mode==='road'));
  assert.ok(station,'the starting world has a road stop for route picking');
  const stationPoints=await page.evaluate(station=>{
    transport.renderer.setZoom(.5);transport.renderer.focus(station.x,station.y);
    const rect=document.querySelector('#world').getBoundingClientRect(),p=transport.renderer.worldToScreen(station.x,station.y),marker=transport.renderer.stationMarker(station);
    const tile={x:rect.left+p.x,y:rect.top+p.y},badge={x:rect.left+marker.x+12,y:rect.top+marker.y+2};
    return{tile,badge,rawBadge:transport.renderer.screenToTile(badge.x,badge.y)};
  },station);
  assert.notDeepEqual(stationPoints.rawBadge,{x:station.x,y:station.y},'stop badge target is outside its own map tile');
  // Picking on the map closes the Routes drawer; Escape leaves it closed.
  const resetStops=async()=>{if(!(await page.locator('#route-form').isVisible())){await page.evaluate(()=>transport.setView('routes'));await page.locator('#new-route-button').click();}await page.locator('#route-form [name="from"]').selectOption('');};
  await resetStops();await page.locator('[data-pick-route="from"]').click();
  await page.mouse.click(stationPoints.badge.x,stationPoints.badge.y);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(),station.id,'a visible stop badge can select its stop beyond its tile');
  // Picking closed the Routes drawer; reopen it rather than racing its closing animation.
  await page.keyboard.press('Escape');await page.evaluate(()=>transport.setView('routes'));await resetStops();
  await openLayers(page);await setLayer(page,'stations',false);await page.locator('[data-layers-close]').click();
  // Opening Layers closes the Routes drawer.
  if(!(await page.locator('[data-pick-route="from"]').isVisible())){await page.evaluate(()=>transport.setView('routes'));await page.locator('#new-route-button').click();}
  await page.locator('[data-pick-route="from"]').click();
  await page.mouse.click(stationPoints.badge.x,stationPoints.badge.y);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(),station.id,'picking reveals matching stops even when the ordinary station layer is hidden');
  assert.equal(await page.locator('[data-pick-route="to"]').getAttribute('aria-pressed'),'true','the selected departure proceeds to picking the arrival');
  await page.keyboard.press('Escape');await openLayers(page);await setLayer(page,'stations',true);await page.locator('[data-layers-close]').click();
  await page.evaluate(()=>transport.renderer.setZoom(1));await page.locator('.main-nav [data-build-area="network"]').click();

  // A compact, controlled map places all fifteen visual categories in view at
  // every zoom. Comparison happens against actual raster output, not only flags.
  await page.evaluate(async () => {
    const { createRenderer } = await import('./renderer.js');
    const { DEFAULT_LAYERS } = await import('./visibility.js');
    const canvas = document.createElement('canvas'); canvas.id = 'layers-renderer-qa';
    canvas.style.cssText = 'position:fixed;left:20px;top:100px;width:900px;height:600px;z-index:1000';
    document.body.append(canvas);
    const minimap = document.createElement('canvas');
    minimap.style.cssText = 'position:fixed;left:-10000px;top:0;width:384px;height:288px';document.body.append(minimap);
    const game={day:30,width:128,height:96,seed:1847,biome:'taiga',revision:1,industries:[],stations:[],cities:[],routes:[],vehicles:[],zones:[],tiles:Array.from({length:128*96},()=>({terrain:'grass',elevation:.2,detail:'',variant:0,road:false,rail:false,bridge:false,tunnel:false,building:null,zone:null}))};
    const tile=(x,y)=>game.tiles[y*game.width+x];
    Object.assign(tile(44,29),{terrain:'forest',detail:'pine'});
    tile(45,29).detail='shrubs';tile(44,30).detail='reeds';tile(45,30).detail='cactus';
    Object.assign(tile(46,29),{terrain:'rock',detail:'glacial'});
    Object.assign(tile(47,29),{terrain:'mountain',detail:'glacial'});
    tile(44,32).building={kind:'house-normal-2',level:1};tile(45,32).building={kind:'school',level:1};
    tile(46,32).zone='residential';tile(47,32).zone='commercial';
    game.industries.push({id:'qa-mill',kind:'sawmill',name:'QA sawmill',x:48,y:30,production:3});
    game.cities.push({id:'qa-city',name:'Layer town',x:52,y:29,population:720});
    for(let x=43;x<=53;x++){tile(x,34).road=true;tile(x,35).rail=true;}
    Object.assign(tile(43,34),{terrain:'water',bridge:true});Object.assign(tile(53,35),{terrain:'rock',tunnel:true});
    game.stations.push({id:'qa-stop',name:'Road stop',x:49,y:34,mode:'road'},{id:'qa-station',name:'Train station',x:52,y:35,mode:'rail'});
    game.routes.push({id:'qa-route',name:'QA route',mode:'road',cargo:'food',color:'#bd7862',active:true,path:Array.from({length:11},(_,index)=>({x:43+index,y:34}))});
    game.vehicles.push({id:'qa-vehicle',routeId:'qa-route',x:50,y:34,angle:0,progress:7,direction:1,load:24,capacity:24});
    // An airport with a plane boarding at its stand, flying to a far twin.
    const {airPath}=await import('./station-sites.js');
    game.stations.push({id:'qa-air-a',name:'QA Airport',x:43,y:38,mode:'air',axis:'x'},{id:'qa-air-b',name:'QA Far Airport',x:43,y:80,mode:'air',axis:'x'});
    game.routes.push({id:'qa-flight',name:'QA flight',mode:'air',cargo:'passengers',color:'#6a8fc2',active:true,stops:['qa-air-a','qa-air-b'],path:airPath(game,{x:43,y:38},{x:43,y:80})});
    game.vehicles.push({id:'qa-plane',routeId:'qa-flight',x:43,y:38,angle:0,progress:0,direction:1,load:30,capacity:56,dwellRemaining:1});
    const renderer=createRenderer(canvas,game);renderer.focus(48,32);renderer.setLayers(DEFAULT_LAYERS);
    // Income floats are passed by the app for a moment after each paid delivery.
    const floaters=[{x:49,y:34,revenue:1669,cargo:'food',born:0}];
    window.layersQA={canvas,minimap,game,renderer,floaters,defaults:DEFAULT_LAYERS,original:JSON.stringify(game)};
  });
  const constructionGrid = await page.evaluate(() => {
    const q=layersQA,render=view=>{q.renderer.render(0,{...view,settle:true});return q.canvas.toDataURL();};
    q.renderer.setLayers({...q.defaults,grid:false});
    const exploration=render({tool:'inspect'}),checks=[];
    for(const tool of ['road','raise','house-normal-2','sawmill']){
      const automatic=render({tool}),enabled=render({tool,showGrid:true}),hidden=render({tool,showGrid:false});
      checks.push({tool,visible:automatic!==hidden,exact:automatic===enabled,preference:q.renderer.getLayers().grid});
    }
    const restored=render({tool:'inspect'})===exploration;
    q.renderer.setLayers({grid:true});
    const always=render({tool:'inspect'})===render({tool:'inspect',showGrid:true});
    q.renderer.setLayers(q.defaults);
    return {checks,restored,always,unchanged:JSON.stringify(q.game)===q.original};
  });
  for(const check of constructionGrid.checks){
    assert.equal(check.visible,true,`${check.tool} reveals the tile grid in the rendered map`);
    assert.equal(check.exact,true,`${check.tool} uses the same grid as the explicit layer`);
    assert.equal(check.preference,false,`${check.tool} leaves the stored layer choice alone`);
  }
  assert.equal(constructionGrid.restored,true,'returning to exploration restores its exact grid-free pixels');
  assert.equal(constructionGrid.always,true,'an explicit Grid on preference remains visible during exploration');
  assert.equal(constructionGrid.unchanged,true,'temporary grid guides never change the company');
  const rasterResults=[];
  for(const zoom of [.5,1,2]){
    await page.evaluate(zoom=>{const q=layersQA;q.renderer.setZoom(zoom);q.renderer.setLayers(q.defaults);q.renderer.render(0,{floaters:q.floaters});},zoom);
    await page.waitForTimeout(100);
    const result=await page.evaluate(()=>{
      const q=layersQA,render=()=>{q.renderer.render(0,{floaters:q.floaters});return q.canvas.toDataURL();};
      const baseline=render(),comparisons=[];
      const crop=(x,y)=>{const camera=q.renderer.getCamera(),density=devicePixelRatio||1,scale=camera.zoom*density,p=q.renderer.worldToScreen(x,y),px=p.x*density,py=p.y*density;return Array.from(q.canvas.getContext('2d').getImageData(Math.round(px-6*scale),Math.round(py-6*scale),Math.max(1,Math.round(12*scale)),Math.max(1,Math.round(12*scale))).data);};
      // Filtered relief under translucent stones can round a channel by one
      // between Canvas raster paths. Geometry and the underlying terrain remain.
      const samePixels=(a,b)=>a.length===b.length&&a.every((value,i)=>Math.abs(value-b[i])<=1);
      const rock=crop(46,29),mountain=crop(47,29);
      // The Next goal switch shows or hides a card over the map, not canvas art.
      for(const [key,value] of Object.entries(q.defaults).filter(([key])=>key!=='goal')){
        q.renderer.setLayers({[key]:!value});const changed=render();
        const stats=q.renderer.getStats(),rockPreserved=key!=='trees'||(samePixels(crop(46,29),rock)&&samePixels(crop(47,29),mountain));
        q.renderer.setLayers({[key]:value});const restored=render();
        comparisons.push({key,changed:changed!==baseline,restored:restored===baseline,rockPreserved,stats});
      }
      // The airport's own part: Stops draws its field, buildings and sign; Vehicles its plane and shadow.
      const airCrop=()=>{const s=q.renderer.getCamera().zoom,p=q.renderer.worldToScreen(45.5,38.5);return Array.from(q.canvas.getContext('2d').getImageData(Math.round((p.x-60*s)*density),Math.round((p.y-70*s)*density),Math.round(120*s*density),Math.round(90*s*density)).data).join();},density=devicePixelRatio||1;
      q.renderer.focus(45,40);render();const airBase=airCrop();
      const airParts=Object.fromEntries(['stations','vehicles'].map(key=>{q.renderer.setLayers({[key]:false});render();const changed=airCrop()!==airBase;q.renderer.setLayers({[key]:q.defaults[key]});render();return[key,changed];}));
      q.renderer.focus(48,32);render();
      q.renderer.drawMinimap(q.minimap);const miniBefore=q.minimap.toDataURL();
      q.renderer.setLayers(Object.fromEntries(Object.keys(q.defaults).map(key=>[key,false])));q.renderer.drawMinimap(q.minimap);const miniTerrain=q.minimap.toDataURL();
      q.renderer.setLayers(q.defaults);q.renderer.drawMinimap(q.minimap);const miniRestored=q.minimap.toDataURL();
      return{zoom:q.renderer.getCamera().zoom,comparisons,airParts,minimapChanged:miniBefore!==miniTerrain,minimapRestored:miniBefore===miniRestored,unchanged:JSON.stringify(q.game)===q.original};
    });
    rasterResults.push(result);
    for(const item of result.comparisons){
      assert.equal(item.changed,true,`${zoom}x ${item.key} changes actual map pixels`);
      assert.equal(item.restored,true,`${zoom}x ${item.key} restores its exact pixels`);
      assert.equal(item.rockPreserved,true,`${zoom}x hiding vegetation preserves rocks and mountains`);
      assert.equal(item.stats.layers[item.key],!defaults[item.key]);
      assert.ok(item.stats.cacheBytes<=item.stats.cacheLimit,'visibility changes respect the cache budget');
      if(item.key==='vehicles'||item.key==='vehicleLoads')assert.deepEqual(item.stats.vehicleIndicators,{empty:0,partial:0,full:0});
    }
    for(const [key,changed] of Object.entries(result.airParts))assert.equal(changed,true,`${zoom}x ${key} toggles the airport's part`);
    assert.equal(result.minimapChanged,true,`${zoom}x Terrain also updates the overview`);
    assert.equal(result.minimapRestored,true,`${zoom}x overview restores exactly`);
    assert.equal(result.unchanged,true,'rendering leaves all map and simulation objects unchanged');
    await page.evaluate(()=>{layersQA.renderer.setLayers(layersQA.defaults);layersQA.renderer.render(0,{floaters:layersQA.floaters});});
    await page.locator('#layers-renderer-qa').screenshot({path:`${output}/all-layers-${zoom}x.png`});
    await page.evaluate(()=>{layersQA.renderer.setLayers(Object.fromEntries(Object.keys(layersQA.defaults).map(key=>[key,false])));layersQA.renderer.render(0,{floaters:layersQA.floaters});});
    await page.locator('#layers-renderer-qa').screenshot({path:`${output}/terrain-only-${zoom}x.png`});
  }
  const interaction=await page.evaluate(()=>{
    const q=layersQA;q.renderer.setZoom(1);q.renderer.setLayers(q.defaults);q.renderer.focus(48,30);q.renderer.render(0);
    const rect=q.canvas.getBoundingClientRect(),p=q.renderer.industryMarker(q.game.industries[0]),marker={x:rect.left+p.x,y:rect.top+p.y};
    const actual=q.renderer.screenToTile(marker.x,marker.y),shown=q.renderer.screenToInspectTile(marker.x,marker.y);
    q.renderer.setLayers({industryIcons:false});q.renderer.render(0);const hidden=q.renderer.screenToInspectTile(marker.x,marker.y);
    const ownTile=q.renderer.screenToInspectTile(rect.left+rect.width/2,rect.top+rect.height/2);
    // Stop signs and carriers are only pickable while their layer draws them.
    q.renderer.setLayers(q.defaults);q.renderer.render(0);
    const stop=q.renderer.stationMarker(q.game.stations[0]),sign={x:rect.left+stop.x+stop.size/2,y:rect.top+stop.y+stop.size/2},car=q.renderer.worldToScreen(50,34),point={x:rect.left+car.x,y:rect.top+car.y},badge={x:point.x,y:point.y-10-31/2-5};
    const pick=()=>({sign:q.renderer.screenToInspectTile(sign.x,sign.y),point:q.renderer.vehicleAt(point.x,point.y)?.id||null,badge:q.renderer.vehicleAt(badge.x,badge.y)?.id||null});
    const picks={shown:pick()};q.renderer.setLayers({stations:false,vehicleLoads:false});q.renderer.render(0);picks.hidden=pick();
    q.renderer.setLayers({vehicles:false});q.renderer.render(0);picks.noVehicles=pick();
    q.renderer.setLayers(q.defaults);q.renderer.render(0);const loaded=q.renderer.getStats().vehicleIndicators.full;
    q.renderer.setLayers({vehicles:false});q.renderer.render(0);const vehiclesHidden=q.renderer.getStats().vehicleIndicators;
    q.renderer.setLayers({vehicles:true,vehicleLoads:false});q.renderer.render(0);const loadsHidden=q.renderer.getStats().vehicleIndicators;
    const returned=q.renderer.getLayers();returned.roads=false;const copySafe=q.renderer.getLayers().roads;
    return{actual,shown,hidden,ownTile,loaded,vehiclesHidden,loadsHidden,copySafe,picks};
  });
  assert.deepEqual(interaction.picks.shown,{sign:{x:49,y:34},point:'qa-vehicle',badge:'qa-vehicle'},'a visible stop sign and vehicle open themselves');
  assert.notDeepEqual(interaction.picks.hidden.sign,{x:49,y:34},'a hidden stop sign loses its hitbox');
  assert.deepEqual([interaction.picks.hidden.point,interaction.picks.hidden.badge],['qa-vehicle',null],'hidden load badges lose their hitboxes, the vehicle keeps its own');
  assert.deepEqual([interaction.picks.noVehicles.point,interaction.picks.noVehicles.badge],[null,null],'hidden vehicles cannot be picked');
  assert.deepEqual(interaction.shown,{x:48,y:30});
  assert.notDeepEqual(interaction.actual,interaction.shown,'the test hits a marker outside its industry tile');
  assert.deepEqual(interaction.hidden,interaction.actual,'hidden markers no longer intercept inspection of the underlying tile');
  assert.deepEqual(interaction.ownTile,{x:48,y:30},'hiding a marker leaves its industry tile inspectable');
  assert.equal(interaction.loaded,1);
  assert.deepEqual(interaction.vehiclesHidden,{empty:0,partial:0,full:0});
  assert.deepEqual(interaction.loadsHidden,{empty:0,partial:0,full:0});
  assert.equal(interaction.copySafe,true,'callers cannot mutate renderer state through getLayers');
  await page.evaluate(()=>{layersQA.canvas.remove();layersQA.minimap.remove();delete window.layersQA;});

  // An ecology day recolours only the overview samples of the cells it journals; a build or
  // terraform resamples everything. Either way the result matches a forced full resample word
  // for word, one sample per tile at 512² and sampled at 2048², with networks and buildings on and off.
  const overview=await page.evaluate(async()=>{
    const {createGame,build}=await import('./model.js'),{stepEcology}=await import('./environment.js'),{createRenderer}=await import('./renderer.js'),{DEFAULT_LAYERS}=await import('./visibility.js');
    const {noteSurfaceChanges}=await import('./change-journal.js'),{networkIndex}=await import('./network-index.js'),{industryTiles}=await import('./industry-sites.js');
    const runs=[];
    for(const size of ['square512','square2048']){
      const game=createGame({size,seed:4242}),canvas=document.createElement('canvas'),mini=document.createElement('canvas');
      canvas.style.cssText='position:fixed;left:-10000px;top:0;width:320px;height:200px';mini.style.cssText='position:fixed;left:-10000px;top:0;width:512px;height:512px';document.body.append(canvas,mini);
      const renderer=createRenderer(canvas,game),full=512*512,samples=()=>renderer.getStats().minimapTerrainSamples;
      const pixels=()=>{renderer.drawMinimap(mini);return new Uint32Array(mini.getContext('2d').getImageData(0,0,mini.width,mini.height).data.buffer);};
      const resampled=()=>{const trees=renderer.getLayers().trees;renderer.setLayers({trees:!trees});renderer.setLayers({trees});return pixels();};
      const compare=()=>{const patched=pixels(),reference=resampled();let differ=0;for(let i=0;i<patched.length;i++)if(patched[i]!==reference[i])differ++;return differ;};
      // A journaled day may also rewrite cells sampled under a road, rail or industry pixel; that overlay must win.
      const covered=()=>{const step=game.width/512,cells=new Set(),add=(x,y)=>{const sx=Math.floor((Math.floor((x+.5)/step)+.5)*step),sy=Math.floor((Math.floor((y+.5)/step)+.5)*step),i=sy*game.width+sx,t=game.tiles[i];if(['grass','forest'].includes(t.terrain)&&!t.road&&!t.rail&&!t.building)cells.add(i);};for(const id of networkIndex(game))add(id%game.width,Math.floor(id/game.width));for(const site of game.industries)for(const p of industryTiles(site))add(p.x,p.y);return[...cells].slice(0,600);};
      let cursor=0;const edit=tool=>{while(cursor<game.tiles.length){const i=(cursor++*7919+104729)%game.tiles.length;if(build(game,tool,i%game.width,Math.floor(i/game.width)).ok){pixels();return samples();}}return -1;};
      for(const hidden of [[],['roads'],['rails'],['buildings'],['roads','rails','buildings']]){
        const run={size,hidden:hidden.join('+')||'none',changed:0,patched:[],differ:[]};
        const days=count=>{for(let d=0;d<count;d++){game.day+=1;run.changed+=stepEcology(game);pixels();run.patched.push(samples());}run.differ.push(compare());};
        renderer.setLayers({...DEFAULT_LAYERS,...Object.fromEntries(hidden.map(key=>[key,false]))});pixels();run.width=mini.width;
        const overlaid=()=>{const cells=covered(),from=game.revision||0;for(const i of cells)game.tiles[i].terrain=game.tiles[i].terrain==='forest'?'grass':'forest';game.revision=from+1;noteSurfaceChanges(game,from,game.revision,cells);pixels();run.overlaid=cells.length;run.masked=cells.length-samples();run.differ.push(compare());};
        days(6);overlaid();run.built=edit('road');days(3);run.shaped=edit('raise');days(3);
        runs.push({...run,full});
      }
      canvas.remove();mini.remove();
    }
    return runs;
  });
  for(const run of overview){
    const label=`${run.size} with ${run.hidden} hidden`;
    assert.equal(run.width,512,`${label}: the comparison reads one canvas pixel per sample`);
    assert.deepEqual(run.differ,[0,0,0,0],`${label}: patched overview matches a full resample word for word`);
    assert.ok(run.overlaid>0&&(run.hidden.includes('buildings')||run.masked>0),`${label}: cells under an overlay keep it (${run.masked} of ${run.overlaid})`);
    assert.ok(run.changed>0&&run.patched.some(count=>count>0),`${label}: ecology changed sampled cells`);
    assert.ok(run.patched.every(count=>count<run.full/16),`${label}: ecology recolours only journaled samples (${Math.max(...run.patched)} at most)`);
    assert.equal(run.built,run.full,`${label}: a build resamples the whole overview`);
    assert.equal(run.shaped,run.full,`${label}: a terraform resamples the whole overview`);
  }

  // Preferences have a separate storage key; rejected writes cannot disable UI.
  const preferenceRecovery=await page.evaluate(async()=>{
    const {loadVisibility,VISIBILITY_KEY}=await import('./visibility.js');
    const previous=localStorage.getItem(VISIBILITY_KEY);
    localStorage.setItem(VISIBILITY_KEY,'{broken');const malformed=loadVisibility();
    localStorage.setItem(VISIBILITY_KEY,JSON.stringify({trees:false,grid:false,roads:'false',unknown:false}));const partial=loadVisibility();
    if(previous===null)localStorage.removeItem(VISIBILITY_KEY);else localStorage.setItem(VISIBILITY_KEY,previous);
    return{malformed,partial};
  });
  assert.deepEqual(preferenceRecovery.malformed,defaults,'malformed preferences recover to defaults');
  assert.deepEqual(preferenceRecovery.partial,{...defaults,trees:false,grid:false},'explicit saved grid preferences override the new default');
  await openLayers(page);
  const beforeFailedWrite=await page.evaluate(()=>localStorage.getItem('transport-visibility-v1'));
  await page.evaluate(()=>{window.visibilityStorageWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='transport-visibility-v1')throw new DOMException('Preferences unavailable','QuotaExceededError');return visibilityStorageWrite.call(this,key,value);};});
  await setLayer(page,'roads',false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('transport-visibility-v1')),beforeFailedWrite,'failed preference writes preserve the previous settings');
  assert.equal((await currentLayers(page)).roads,false,'the current view changes even if browser storage is blocked');
  await page.evaluate(()=>{Storage.prototype.setItem=visibilityStorageWrite;delete window.visibilityStorageWrite;});
  await setLayer(page,'roads',true);
  for(const key of ['trees','buildings','names','industryIcons','vehicleLoads','routes'])await setLayer(page,key,false);
  await setLayer(page,'grid',true);
  const preferences=await currentLayers(page);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('transport-visibility-v1'))),preferences);
  await page.locator('[data-layers-close]').click();
  const saved=await page.evaluate(async()=>{
    const {writeSaveSlot,readSaveSlot}=await import('./save-slots.js');
    const result=await writeSaveSlot(transport.game,{name:'Layer preference fixture'});if(!result.ok)throw new Error(result.message);
    const restored=await readSaveSlot(result.id);return{id:result.id,biome:transport.game.biome,width:transport.game.width,hasLayers:Object.hasOwn(restored.game,'layers')||Object.hasOwn(restored.game,'visibility')};
  });
  assert.equal(saved.hasLayers,false,'display preferences are not embedded in a saved world');
  await createWorldFromMenu(page, { biome: 'desert', seed: 7719 });
  assert.deepEqual(await currentLayers(page),preferences,'new worlds retain browser display preferences');
  await openGameAction(page, 'save-button');
  await page.locator('[data-saves-view="load"]').click();
  await page.locator(`[data-save-slot="${saved.id}"] [data-save-action="load"]`).click();
  await page.locator(`[data-save-slot="${saved.id}"] [data-save-confirm="load"]`).click();
  await page.locator('.saves-explorer').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>transport.game.biome),saved.biome);
  assert.deepEqual(await currentLayers(page),preferences,'loading a different named company retains the same preferences');
  await page.reload();await loadAutosaveFromMenu(page);await page.locator('[data-speed="0"]').click();
  assert.deepEqual(await currentLayers(page),preferences,'preferences survive page reload');
  await openLayers(page);
  for(const key of keys)assert.equal(await page.locator(`[data-layer="${key}"]`).isChecked(),preferences[key]);
  await page.locator('[data-layers-close]').click();
  assert.equal(await miniSamples(),0,'a reloaded company leaves the hidden mini map unsampled');
  await openGameAction(page,'overview-button');await page.waitForFunction(()=>transport.renderer.getStats().minimapTerrainSamples>0);
  assert.equal(await miniSamples(),512*512,'opening the mini map samples the whole overview once');
  await page.locator('#close-minimap').click();

  assert.deepEqual(errors,[],'no uncaught browser errors');
  console.log(`Transport Layers browser checks passed (${rasterResults.length} zooms × ${keys.length} pixel checks). Screenshots: ${output}`);
} finally { await browser.close(); }
