// Serve the repository root first; all preferences and worlds use isolated storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
  if (!(await page.locator(selector).isVisible())) await page.locator('#map-options-button').click();
  await page.locator(selector).click();
}
async function openLayers(page) {
  if (!(await page.locator('#layers-panel').isVisible())) await page.locator('#layers-button').click();
  await page.locator('#layers-panel').waitFor({ state: 'visible' });
}
async function setLayer(page, key, value) {
  await page.locator(`[data-layer="${key}"]`).setChecked(value);
  await page.waitForFunction(({ key, value }) => transport.renderer.getLayers()[key] === value, { key, value });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(page);
  await page.goto(url);
  await page.waitForFunction(() => window.transport?.renderer?.getLayers);
  await page.locator('[data-speed="0"]').click();
  const defaults = await page.evaluate(async () => (await import('./visibility.js')).DEFAULT_LAYERS);
  const keys = Object.keys(defaults);
  assert.equal(keys.length, 13);
  assert.deepEqual(await currentLayers(page), defaults);
  await openLayers(page);
  assert.equal(await page.locator('#layers-button').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), false, 'Layers is a nonmodal map control');
  assert.equal(await page.locator('#layers-panel input[type="checkbox"][role="switch"][data-layer]').count(), 13);
  const stateBefore = await page.evaluate(() => JSON.stringify(transport.game));
  for (const key of keys) {
    assert.equal(await page.locator(`[data-layer="${key}"]`).isChecked(), defaults[key]);
    assert.ok(await page.locator(`[data-layer="${key}"]`).evaluate(input => [...input.labels].some(label => label.textContent.trim().length)), `${key} has a visible native label`);
    await setLayer(page, key, !defaults[key]);
    await setLayer(page, key, defaults[key]);
  }
  assert.equal(await page.evaluate(() => JSON.stringify(transport.game)), stateBefore, 'visibility controls never mutate the company or terrain');
  await page.screenshot({ path: `${output}/desktop-layers-panel.png` });

  await page.locator('[data-layer-preset="terrain"]').click();
  assert.ok(Object.values(await currentLayers(page)).every(value => value === false), 'Terrain hides every optional layer');
  await page.locator('[data-layer-preset="all"]').click();
  assert.ok(Object.values(await currentLayers(page)).every(value => value === true), 'Show all also enables the grid');
  await setLayer(page, 'grid', false);
  await page.locator('[data-layers-close]').click();
  await page.locator('#layers-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'layers-button');
  await page.keyboard.press('Enter');
  await page.locator('#layers-panel').waitFor({ state: 'visible' });
  await page.locator('[data-layer="trees"]').focus();
  await page.keyboard.press('Space');
  assert.equal((await currentLayers(page)).trees, false, 'Space activates the focused native switch');
  assert.equal(await page.evaluate(() => transport.speed), 0, 'a switch key does not trigger the global pause shortcut');
  await page.keyboard.press('Escape');
  await page.locator('#layers-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'layers-button', 'Escape restores trigger focus');
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
    const before=defaults[key];
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
  const station=await page.evaluate(()=>transport.game.stations.find(stop=>stop.mode==='road'));
  assert.ok(station,'the starting world has a road stop for route picking');
  const stationPoints=await page.evaluate(station=>{
    transport.renderer.setZoom(.5);transport.renderer.focus(station.x,station.y);
    const rect=document.querySelector('#world').getBoundingClientRect(),camera=transport.renderer.getCamera();
    const tile={x:rect.left+rect.width/2+((station.x+.5)*32-camera.x)*camera.zoom,y:rect.top+rect.height/2+((station.y+.5)*32-camera.y)*camera.zoom};
    const badge={x:tile.x+8*camera.zoom+7,y:tile.y-18*camera.zoom+7};
    return{tile,badge,rawBadge:transport.renderer.screenToTile(badge.x,badge.y)};
  },station);
  assert.notDeepEqual(stationPoints.rawBadge,{x:station.x,y:station.y},'stop badge target is outside its own map tile');
  const resetStops=async()=>{await page.locator('#route-form [name="mode"]').selectOption('rail');await page.locator('#route-form [name="mode"]').selectOption('road');};
  await resetStops();await page.locator('[data-pick-route="from"]').click();
  await page.mouse.click(stationPoints.badge.x,stationPoints.badge.y);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(),station.id,'a visible stop badge can select its stop beyond its tile');
  await page.keyboard.press('Escape');await resetStops();
  await openLayers(page);await setLayer(page,'stations',false);await page.locator('[data-layers-close]').click();
  await page.locator('[data-pick-route="from"]').click();
  await page.mouse.click(stationPoints.badge.x,stationPoints.badge.y);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(),'','a hidden stop badge cannot intercept the neighboring tile');
  assert.equal(await page.locator('[data-pick-route="from"]').getAttribute('aria-pressed'),'true','a miss keeps the start-stop picker active');
  await page.mouse.click(stationPoints.tile.x,stationPoints.tile.y);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(),station.id,'the actual stop tile remains selectable while stop artwork is hidden');
  await page.keyboard.press('Escape');await openLayers(page);await setLayer(page,'stations',true);await page.locator('[data-layers-close]').click();
  await page.evaluate(()=>transport.renderer.setZoom(1));await page.locator('.main-nav [data-view="build"]').click();

  // A compact, controlled map places all thirteen visual categories in view at
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
    const renderer=createRenderer(canvas,game);renderer.focus(48,32);renderer.setLayers(DEFAULT_LAYERS);
    window.layersQA={canvas,minimap,game,renderer,defaults:DEFAULT_LAYERS,original:JSON.stringify(game)};
  });
  const rasterResults=[];
  for(const zoom of [.5,1,2]){
    await page.evaluate(zoom=>{const q=layersQA;q.renderer.setZoom(zoom);q.renderer.setLayers(q.defaults);q.renderer.render(0);},zoom);
    await page.waitForTimeout(100);
    const result=await page.evaluate(()=>{
      const q=layersQA,render=()=>{q.renderer.render(0);return q.canvas.toDataURL();};
      const baseline=render(),comparisons=[];
      const crop=(x,y)=>{const camera=q.renderer.getCamera(),scale=camera.zoom*(devicePixelRatio||1);const px=(q.canvas.width/2+((x+.5)*32-camera.x)*scale),py=(q.canvas.height/2+((y+.5)*32-camera.y)*scale);return Array.from(q.canvas.getContext('2d').getImageData(Math.round(px-6*scale),Math.round(py-6*scale),Math.max(1,Math.round(12*scale)),Math.max(1,Math.round(12*scale))).data);};
      // Filtered relief under translucent stones can round a channel by one
      // between Canvas raster paths. Geometry and the underlying terrain remain.
      const samePixels=(a,b)=>a.length===b.length&&a.every((value,i)=>Math.abs(value-b[i])<=1);
      const rock=crop(46,29),mountain=crop(47,29);
      for(const [key,value] of Object.entries(q.defaults)){
        q.renderer.setLayers({[key]:!value});const changed=render();
        const stats=q.renderer.getStats(),rockPreserved=key!=='trees'||(samePixels(crop(46,29),rock)&&samePixels(crop(47,29),mountain));
        q.renderer.setLayers({[key]:value});const restored=render();
        comparisons.push({key,changed:changed!==baseline,restored:restored===baseline,rockPreserved,stats});
      }
      q.renderer.drawMinimap(q.minimap);const miniBefore=q.minimap.toDataURL();
      q.renderer.setLayers(Object.fromEntries(Object.keys(q.defaults).map(key=>[key,false])));q.renderer.drawMinimap(q.minimap);const miniTerrain=q.minimap.toDataURL();
      q.renderer.setLayers(q.defaults);q.renderer.drawMinimap(q.minimap);const miniRestored=q.minimap.toDataURL();
      return{zoom:q.renderer.getCamera().zoom,comparisons,minimapChanged:miniBefore!==miniTerrain,minimapRestored:miniBefore===miniRestored,unchanged:JSON.stringify(q.game)===q.original};
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
    assert.equal(result.minimapChanged,true,`${zoom}x Terrain also updates the overview`);
    assert.equal(result.minimapRestored,true,`${zoom}x overview restores exactly`);
    assert.equal(result.unchanged,true,'rendering leaves all map and simulation objects unchanged');
    await page.evaluate(()=>{layersQA.renderer.setLayers(layersQA.defaults);layersQA.renderer.render(0);});
    await page.locator('#layers-renderer-qa').screenshot({path:`${output}/all-layers-${zoom}x.png`});
    await page.evaluate(()=>{layersQA.renderer.setLayers(Object.fromEntries(Object.keys(layersQA.defaults).map(key=>[key,false])));layersQA.renderer.render(0);});
    await page.locator('#layers-renderer-qa').screenshot({path:`${output}/terrain-only-${zoom}x.png`});
  }
  const interaction=await page.evaluate(()=>{
    const q=layersQA;q.renderer.setZoom(1);q.renderer.setLayers(q.defaults);q.renderer.focus(48,30);q.renderer.render(0);
    const rect=q.canvas.getBoundingClientRect(),marker={x:rect.left+rect.width/2,y:rect.top+rect.height/2+16+5+15};
    const actual=q.renderer.screenToTile(marker.x,marker.y),shown=q.renderer.screenToInspectTile(marker.x,marker.y);
    q.renderer.setLayers({industryIcons:false});q.renderer.render(0);const hidden=q.renderer.screenToInspectTile(marker.x,marker.y);
    const ownTile=q.renderer.screenToInspectTile(rect.left+rect.width/2,rect.top+rect.height/2);
    q.renderer.setLayers(q.defaults);q.renderer.render(0);const loaded=q.renderer.getStats().vehicleIndicators.full;
    q.renderer.setLayers({vehicles:false});q.renderer.render(0);const vehiclesHidden=q.renderer.getStats().vehicleIndicators;
    q.renderer.setLayers({vehicles:true,vehicleLoads:false});q.renderer.render(0);const loadsHidden=q.renderer.getStats().vehicleIndicators;
    const returned=q.renderer.getLayers();returned.roads=false;const copySafe=q.renderer.getLayers().roads;
    return{actual,shown,hidden,ownTile,loaded,vehiclesHidden,loadsHidden,copySafe};
  });
  assert.deepEqual(interaction.shown,{x:48,y:30});
  assert.notDeepEqual(interaction.actual,interaction.shown,'the test hits a marker outside its industry tile');
  assert.deepEqual(interaction.hidden,interaction.actual,'hidden markers no longer intercept inspection of the underlying tile');
  assert.deepEqual(interaction.ownTile,{x:48,y:30},'hiding a marker leaves its industry tile inspectable');
  assert.equal(interaction.loaded,1);
  assert.deepEqual(interaction.vehiclesHidden,{empty:0,partial:0,full:0});
  assert.deepEqual(interaction.loadsHidden,{empty:0,partial:0,full:0});
  assert.equal(interaction.copySafe,true,'callers cannot mutate renderer state through getLayers');
  await page.evaluate(()=>{layersQA.canvas.remove();layersQA.minimap.remove();delete window.layersQA;});

  // Preferences have a separate storage key; rejected writes cannot disable UI.
  const preferenceRecovery=await page.evaluate(async()=>{
    const {loadVisibility,VISIBILITY_KEY}=await import('./visibility.js');
    const previous=localStorage.getItem(VISIBILITY_KEY);
    localStorage.setItem(VISIBILITY_KEY,'{broken');const malformed=loadVisibility();
    localStorage.setItem(VISIBILITY_KEY,JSON.stringify({trees:false,grid:true,roads:'false',unknown:false}));const partial=loadVisibility();
    if(previous===null)localStorage.removeItem(VISIBILITY_KEY);else localStorage.setItem(VISIBILITY_KEY,previous);
    return{malformed,partial};
  });
  assert.deepEqual(preferenceRecovery.malformed,defaults,'malformed preferences recover to defaults');
  assert.deepEqual(preferenceRecovery.partial,{...defaults,trees:false,grid:true},'partial preferences preserve known booleans and ignore invalid or unknown fields');
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
  await page.locator('#world-button').click();
  await page.locator('[data-biome="desert"]').click();await page.locator('[data-world-size="square512"]').click();
  await page.locator('#world-seed').fill('7719');await page.locator('#generate-world').click();await page.locator('[data-speed="0"]').click();
  assert.deepEqual(await currentLayers(page),preferences,'new worlds retain browser display preferences');
  await page.locator('#save-button').click();
  await page.locator(`[data-save-slot="${saved.id}"] [data-save-action="load"]`).click();
  await page.locator(`[data-save-slot="${saved.id}"] [data-save-confirm="load"]`).click();
  await page.locator('.saves-explorer').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>transport.game.biome),saved.biome);
  assert.deepEqual(await currentLayers(page),preferences,'loading a different named company retains the same preferences');
  await page.reload();await page.waitForFunction(()=>window.transport?.renderer?.getLayers);await page.locator('[data-speed="0"]').click();
  assert.deepEqual(await currentLayers(page),preferences,'preferences survive page reload');
  await openLayers(page);
  for(const key of keys)assert.equal(await page.locator(`[data-layer="${key}"]`).isChecked(),preferences[key]);
  await page.locator('[data-layers-close]').click();

  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await openLayers(page);
    assert.equal(await fits(page,'#layers-panel'),true,`${width}px panel has no horizontal overflow`);
    const box=await page.locator('#layers-panel').boundingBox();
    assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=844,`${width}px panel stays within the screen`);
    const manage=await page.locator('.mobile-panel-toggle').boundingBox();
    assert.ok(box.y+box.height<=manage.y,`${width}px panel clears the bottom map controls`);
    await page.locator('[data-layer="grid"]').scrollIntoViewIfNeeded();
    const close=await page.locator('[data-layers-close]').boundingBox();
    assert.ok(close.y>=0&&close.y+close.height<=844,`${width}px Close remains accessible while scrolling`);
    await setLayer(page,'grid',false);await setLayer(page,'grid',true);
    await page.screenshot({path:`${output}/mobile-${width}-layers.png`});
    await page.keyboard.press('Escape');await page.locator('#layers-panel').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>scrollY),0);
    assert.equal((await page.locator('.topbar').boundingBox()).y,0);
  }
  assert.deepEqual(errors,[],'no uncaught browser errors');
  console.log(`Transport Layers browser checks passed (${rasterResults.length} zooms × ${keys.length} pixel checks). Screenshots: ${output}`);
} finally { await browser.close(); }
