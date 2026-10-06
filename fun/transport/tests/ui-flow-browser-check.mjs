import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium }=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-ui-flows';await mkdir(output,{recursive:true});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 await page.emulateMedia({reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.TRANSPORT_URL||'http://127.0.0.1:8765/fun/transport/');
 await createWorldFromMenu(page,{generationVersion:10,size:'square512'});
 await page.evaluate(()=>document.querySelector('#dismiss-objective')?.click());
 await page.locator('.main-nav [data-view="routes"]').click();
 assert.equal(await page.locator('#route-form').count(),0,'the service list never includes a creation form');
 assert.ok(await page.locator('#route-list .route-card').count());
 assert.equal(await page.locator('.route-card-details').first().evaluate(el=>el.open),false,'fleet and earnings are disclosed on request');
 await page.locator('#new-route-button').click();
 assert.equal(await page.locator('#route-list').count(),0,'a new draft has its own screen');
 assert.equal(await page.locator('.panel-heading h2').innerText(),'New route');
 assert.equal(await page.locator('#route-cargo-step').isHidden(),true,'a new draft asks for stops first');
 assert.equal(await page.locator('#route-vehicles-step').isHidden(),true,'vehicles follow a cargo choice');
 assert.equal(await page.locator('#route-forecast').isVisible(),true,'purchase and revenue guidance stay visible from the start');
 assert.equal(await page.locator('[data-estimate-revenue]').textContent(),'Choose stops');
 await page.locator('[data-pick-route="from"]').click();await page.keyboard.press('Escape');
 await page.locator('#route-pick-banner').waitFor({state:'hidden'});
 assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'),'false','Escape returns to the new route draft');
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.pickRoute),'from','Escape restores focus to the invoking start picker');
 await page.waitForTimeout(900);assert.deepEqual(errors,[],'the live HUD also works while the list is absent');
 await page.locator('#route-back').click();
 const routeId=await page.locator('[data-edit-route]').first().getAttribute('data-edit-route');
 await page.locator(`[data-edit-route="${routeId}"]`).click();
 assert.equal(await page.locator('#route-list').count(),0);assert.equal(await page.locator('.panel-heading h2').innerText(),'Edit route');
 await page.locator('[data-pick-route="to"]').click();await page.keyboard.press('Escape');
 await page.locator('#route-pick-banner').waitFor({state:'hidden'});
 assert.equal(await page.locator('.panel-heading h2').innerText(),'Edit route','Escape preserves the route edit');
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.pickRoute),'to','Escape restores focus to the invoking end picker');
 await page.locator('#cancel-route-edit').click();assert.equal(await page.locator('#route-form').count(),0);
 await page.setViewportSize({width:1280,height:520});
 await page.evaluate(()=>transport.setView('industry'));
 const listScroll=await page.locator('#panel-content').evaluate(panel=>{panel.scrollTop=240;return panel.scrollTop;});
 assert.ok(listScroll>0,'the short computer window has a scrollable industry list');
 await page.evaluate(()=>transport.setView('towns'));
 assert.equal(await page.locator('#panel-content').evaluate(panel=>panel.scrollTop),0,'opening a different panel starts at its top');
 await page.evaluate(()=>transport.setView('routes',{routeScreen:'new'}));
 const townStops=await page.evaluate(()=>transport.game.stations.filter(stop=>stop.mode==='road').slice(0,2).map(stop=>stop.id));
 await page.locator('#route-form [name="from"]').selectOption(townStops[0]);
 await page.locator('#route-form [name="to"]').selectOption(townStops[1]);
 await page.locator('[data-cargo-choice="passengers"]').click();
 await page.locator('#change-route-stops').click();
 const draftScroll=await page.evaluate(()=>{const panel=document.querySelector('#panel-content');panel.scrollTop=160;const before=panel.scrollTop,start=document.querySelector('#route-form [name="from"]');start.dispatchEvent(new Event('change',{bubbles:true}));return{before,after:panel.scrollTop};});
 assert.ok(draftScroll.before>0,'the short computer window has a scrollable route draft');
 assert.equal(draftScroll.after,draftScroll.before,'redrawing the same draft preserves its scroll');
 await page.setViewportSize({width:1280,height:900});

 const site=await page.evaluate(async()=>{
  const {quoteBuildPlan}=await import('./construction-plan.js'),game=transport.game;
  for(let y=30;y<game.height-30;y++)for(let x=30;x<game.width-35;x++){
   const points=[{x,y},{x:x+1,y},{x:x+2,y}];
   if(points.some(p=>game.tiles[p.y*game.width+p.x].road))continue;
   if(quoteBuildPlan(game,'road',points).ok&&quoteBuildPlan(game,'stop',[points[1]]).ok){
    transport.setTool('stop');transport.renderer.setZoom(2);transport.renderer.focus(x+1,y);
    return {x:x+1,y,money:game.money,quote:quoteBuildPlan(game,'stop',[points[1]]).cost};
   }
  }
  throw Error('No clear construction site');
 });
 async function tilePoint(x,y){return page.evaluate(({x,y})=>{const p=transport.renderer.worldToScreen(x,y),r=document.querySelector('#world').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};},{x,y});}
 const point=await tilePoint(site.x,site.y);await page.mouse.click(point.x,point.y);
 await page.locator('.construction-next').waitFor({state:'visible'});
 const built=await page.evaluate(({x,y})=>({road:transport.game.tiles[y*transport.game.width+x].road,station:transport.game.stations.find(s=>s.x===x&&s.y===y),money:transport.game.money}),site);
 assert.equal(built.road,true);assert.equal(built.station.mode,'road');assert.equal(built.money,site.money-site.quote);
 assert.equal(await page.locator('.main-nav [data-view="build"]').getAttribute('aria-expanded'),'true');
 await page.locator('[data-construction-next="route"]').click();
 assert.equal(await page.locator('#route-form [name="from"]').inputValue(),String(built.station.id),'the next route starts at the newly built stop');
 await page.locator('[data-pick-route="to"]').click();await page.locator('#route-pick-banner').waitFor({state:'visible'});
 assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'),'true');
 assert.match(await page.locator('#route-pick-banner').innerText(),/matching stops highlighted/);
 const stops=await page.evaluate(()=>transport.game.stations.filter(s=>s.mode==='road'&&s.id!==transport.game.stations.at(-1).id));
 await page.evaluate(stop=>transport.renderer.focus(stop.x,stop.y),stops[0]);
 const mark=await page.evaluate(stop=>{const p=transport.renderer.stationMarker(stop),r=document.querySelector('#world').getBoundingClientRect();return{x:r.left+p.x,y:r.top+p.y};},stops[0]);
 await page.mouse.click(mark.x,mark.y);await page.locator('#route-pick-banner').waitFor({state:'hidden'});
 assert.equal(await page.locator('#route-form [name="to"]').inputValue(),String(stops[0].id));
 assert.equal(await page.locator('#route-cargo-step').isVisible(),true,'the destination opens the cargo step');
 assert.equal(await page.locator('[data-cargo-choice][aria-pressed="true"]').count(),0,'the player still chooses cargo');
 await page.locator('#route-back').click();
 await page.screenshot({path:output+'/route-list.png'});

 await page.locator('[data-remove-route]').first().click();await page.locator('#modal [data-close]').click();
 await page.waitForFunction(()=>document.querySelector('.sidebar').classList.contains('drawer-open'));
 assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'),'false','keeping a service returns to the previous route list');
 await page.evaluate(({x,y})=>{transport.setTool('road');transport.renderer.focus(x,y);},site);
 const roadStart=await tilePoint(site.x-1,site.y),roadEnd=await tilePoint(site.x+1,site.y);
 await page.mouse.move(roadStart.x,roadStart.y);await page.mouse.down();await page.mouse.move(roadEnd.x,roadEnd.y,{steps:6});await page.mouse.up();
 await page.locator('[data-construction-next="stop"]').waitFor({state:'visible'});
 assert.equal(await page.locator('.construction-next').innerText().then(text=>text.startsWith('Road built.')),true,'a completed road returns to Build and suggests stops');
 assert.ok(await page.evaluate(({x,y})=>[x-1,x,x+1].every(column=>transport.game.tiles[y*transport.game.width+column].road),site));
 await page.locator('[data-construction-next="stop"]').click();await page.locator('#cancel-tool-button').click();
 assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'),'false','Done reopens the build picker');
 await page.evaluate(()=>transport.setView('routes'));

 const map=await page.locator('#world').boundingBox();
 async function topLeft(selector,fixed=false){const rect=await page.locator(selector).boundingBox();assert.ok(rect,selector+' is visible');assert.ok(Math.abs(rect.x-8)<1.5,selector+' aligns left');assert.ok(Math.abs(rect.y-(fixed?map.y:map.y)-8)<1.5,selector+' aligns top');}
 await topLeft('.sidebar');
 await page.evaluate(stop=>transport.inspect(stop.x,stop.y),stops[0]);await topLeft('#inspector');
 assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'),'true','inspection replaces the management drawer');
 await openGameAction(page,'layers-button');await topLeft('#layers-panel');
 assert.equal(await page.locator('#inspector').isHidden(),true,'layers replace inspection');
 await page.locator('[data-layers-close]').click();
 await page.locator('#zoom-level').click();await topLeft('#zoom-menu',true);await page.keyboard.press('Escape');
 await openGameAction(page,'help-button');await topLeft('#modal',true);await page.keyboard.press('Escape');
 await page.waitForTimeout(100); // settle the earlier dialog before choosing a new speed
 await page.evaluate(()=>{
  transport.setSpeed(3);
  document.querySelector('#help-button').click();
  document.querySelector('#modal .close-modal').click();
  document.querySelector('[data-open-gallery]').click();
 });
 await page.locator('#gallery-search').fill('town hall');
 await page.locator('[data-gallery-entry="building:town-hall"]').waitFor({state:'visible'});
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>transport.speed),0,'a queued close event leaves the reopened gallery paused and usable');
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>transport.speed===3);
 await page.evaluate(()=>transport.setSpeed(0));
 await page.locator('#game-menu-button').click();await topLeft('#game-menu',true);await page.keyboard.press('Escape');
 for(const width of [520,768,1280]){
  await page.setViewportSize({width,height:760});await page.evaluate(()=>transport.setView('routes'));
  assert.ok(await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'drawer fits '+width+' computer window');
  await page.locator('#new-route-button').click();
  assert.ok(await page.locator('#route-form').evaluate(el=>el.scrollWidth<=el.clientWidth+2),'form fits '+width+' computer window');
  await page.screenshot({path:output+`/new-route-${width}.png`});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({routeScreens:'list/new/edit',automaticRoad:'quoted and atomic',constructionNext:'prefilled route',stopPicking:'matching signs',panelAnchor:'top left',computerWidths:[520,768,1280],errors}));
} finally {await browser.close();}
