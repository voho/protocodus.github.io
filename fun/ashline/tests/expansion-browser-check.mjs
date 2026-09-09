import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser=await chromium.launch({channel:process.env.ASHLINE_BROWSER||'chrome',headless:true});
const url=process.env.ASHLINE_URL||'http://127.0.0.1:4173/fun/ashline/';
const output=process.env.ASHLINE_SCREENSHOTS||'/tmp/ashline-expansion-qa';
await mkdir(output,{recursive:true});
const errors=[];
const advance=(page,seconds)=>page.evaluate(async seconds=>{const {updateGame}=await import('./sim.js');for(let i=0;i<seconds*4;i++)updateGame(ashline.state,.25);},seconds);
const ui=page=>page.waitForTimeout(200);
async function launch(viewport,deviceScaleFactor=1){
  const page=await browser.newPage({viewport,deviceScaleFactor});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.ashline?.booted);
  assert.equal(await page.locator('#map-size').inputValue(),'frontier');
  await page.locator('#map-profile').selectOption('highlands');await page.locator('#map-size').selectOption('vast');
  assert.equal(await page.evaluate(()=>ashline.state),null,'Changing setup does not generate a preview world');
  await page.locator('#map-profile').selectOption('rift');await page.locator('#map-size').selectOption('frontier');
  await page.screenshot({path:`${output}/briefing-${viewport.width}.png`});
  await page.locator('#deploy').click(); await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, {timeout: 120000});await page.evaluate(()=>{ashline.state.ai.nextThink=1e9;ashline.state.teams[0].credits=30000;});
  return page;
}
async function fixtures(page){return page.evaluate(async()=>{
  const {placeBuilding,canPlace,updateGame}=await import('./sim.js'),s=ashline.state,core=s.entities.find(e=>e.type==='core'&&e.team===0),result={};
  s.visible[0].fill(1);s.explored[0].fill(1);s.fogClock=1e8;
  for(const type of ['barracks','factory','lab','capacitor','reactor','reactor']){
    let location;
    for(let y=core.y-12;y<=core.y+15&&!location;y++)for(let x=core.x-12;x<=core.x+15&&!location;x++)if(canPlace(s,0,type,x,y).ok)location={x,y};
    if(!location)throw Error(`No valid ${type} location`);
    const placed=placeBuilding(s,0,type,location.x,location.y);if(!placed.ok)throw Error(placed.reason);
    const e=s.entities.find(e=>e.id===placed.id);e.progress=1;e.hp=e.maxHp;result[type]=e.id;updateGame(s,.05);
  }
  return result;
});}
try{
  const page=await launch({width:1440,height:900});
  await page.mouse.move(720,450);await page.evaluate(()=>{ashline.view.x=96;ashline.view.y=72;});
  for(const [key,axis,sign] of [['d','x',1],['a','x',-1],['s','y',1],['w','y',-1]]){
    const before=await page.evaluate(axis=>ashline.view[axis],axis);await page.keyboard.down(key);await page.waitForTimeout(240);await page.keyboard.up(key);
    const after=await page.evaluate(axis=>ashline.view[axis],axis);assert((after-before)*sign>.2,`${key} scrolls map`);
  }
  for(const [x,y,sx,sy] of [[1,1,-1,-1],[1439,899,1,1]]){
    const before=await page.evaluate(()=>({x:ashline.view.x,y:ashline.view.y}));await page.mouse.move(x,y);await page.waitForTimeout(260);await page.mouse.move(720,450);
    const after=await page.evaluate(()=>({x:ashline.view.x,y:ashline.view.y}));assert((after.x-before.x)*sx>.2);assert((after.y-before.y)*sy>.2);
  }
  for(let i=0;i<6;i++)await page.keyboard.press('-');
  const zooms=[];for(let i=0;i<5;i++){zooms.push(await page.evaluate(()=>ashline.view.zoom));await page.keyboard.press('+');}
  assert.equal(new Set(zooms).size,5);assert.equal(await page.evaluate(()=>ashline.view.zoom),zooms.at(-1));
  assert.equal(await page.evaluate(async()=>ashline.view.zoom===(await import('./assets.js')).spriteNativeZoom(ashline.renderer.dpr)),true);
  await page.keyboard.press('Space');await page.keyboard.press('e');await page.keyboard.press('q');assert.match(await page.locator('#order-hint').textContent(),/ATTACK MOVE/);await page.keyboard.press('Escape');
  const ids=await fixtures(page);
  await page.evaluate(id=>{ashline.view.selected=new Set([id]);},ids.factory);await ui(page);await page.locator('#upgrade-building').click();
  assert.equal(await page.locator('#research-tab').getAttribute('aria-selected'),'true');assert.equal(await page.locator('.research-card').count(),6);
  await page.locator('[data-upgrade=speed]').click();assert.equal(await page.evaluate(id=>ashline.state.entities.find(e=>e.id===id).upgrade.id,ids.factory),'speed');
  await advance(page,26);await ui(page);assert.match(await page.locator('[data-upgrade=speed]').innerText(),/INSTALLED/);
  await page.locator('[data-research=gridEfficiency]').click();await advance(page,31);await ui(page);
  assert.equal(await page.evaluate(()=>ashline.state.teams[0].research.gridEfficiency),true);
  await page.locator('[data-research=advancedBallistics]').click();await advance(page,46);await ui(page);
  await page.locator('[data-upgrade=advancedProduction]').click();await advance(page,36);await ui(page);
  await page.locator('#train-tab').click();await page.locator('[data-type=striker]').click();await advance(page,13);await ui(page);
  assert(await page.evaluate(()=>ashline.state.entities.some(e=>e.type==='striker'&&e.team===0)));
  await page.locator('[data-type=engineer]').click();await advance(page,12);await ui(page);
  assert(await page.evaluate(()=>ashline.state.entities.some(e=>e.type==='engineer'&&e.team===0)));
  await page.evaluate(id=>{const e=ashline.state.entities.find(e=>e.id===id);e.hp=e.maxHp/2;ashline.view.selected=new Set([id]);},ids.factory);await ui(page);
  await page.locator('#repair-building').click();assert.equal(await page.locator('#repair-building').getAttribute('aria-pressed'),'true');
  await page.locator('#upgrade-building').click();await page.screenshot({path:`${output}/research-desktop.png`});
  await page.evaluate(()=>{for(const e of ashline.state.entities)if(e.team===0&&e.type==='capacitor')e.reserve=100;for(const e of ashline.state.entities)if(e.team===0&&e.type==='reactor')e.hp=0;});await ui(page);
  assert.equal(await page.locator('#grid-state').getAttribute('data-state'),'reserve');await advance(page,5);await ui(page);
  assert.equal(await page.locator('#grid-state').getAttribute('data-state'),'brownout');await page.screenshot({path:`${output}/brownout-desktop.png`});
  await page.locator('#pause').click();await page.evaluate(()=>{ashline.state.fogClock=0;});await page.locator('#save-game').click();assert.match(await page.locator('#save-status').innerText(),/^Operation saved/);
  await page.locator('#load-game').click(); await page.waitForFunction(() => !ashline.loading, null, {timeout: 120000});assert.match(await page.locator('#save-status').innerText(),/loaded/i);await page.locator('#resume').click();
  await page.evaluate(id=>{ashline.view.selected=new Set([id]);},ids.factory);await ui(page);
  const refundLabel=await page.locator('#sell-building').innerText();assert.match(refundLabel,/Sell \+/);await page.locator('#sell-building').click();
  assert.equal(await page.evaluate(id=>ashline.state.entities.some(e=>e.id===id&&e.hp>0),ids.factory),false);
  await page.close();
  for(const viewport of [{width:390,height:844},{width:844,height:390}]){
    const mobile=await launch(viewport,2),mobileIds=await fixtures(mobile);
    await mobile.evaluate(id=>{ashline.view.selected=new Set([id]);},mobileIds.factory);await ui(mobile);await mobile.locator('#upgrade-building').click();
    const bounds=await mobile.evaluate(()=>{const ids=['command-console','selection-panel','topbar'];return [...document.querySelectorAll('#command-console,#selection-panel,.topbar')].map(e=>{const r=e.getBoundingClientRect();return {name:e.id||e.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom};});});
    for(const r of bounds){assert(r.x>=0&&r.right<=viewport.width+1,`${r.name} fits ${viewport.width}`);assert(r.y>=0&&r.bottom<=viewport.height+1,`${r.name} vertical fit`);}
    const consoleBounds=bounds.find(r=>r.name==='command-console'),selectionBounds=bounds.find(r=>r.name==='selection-panel');
    assert(consoleBounds.bottom<=selectionBounds.y||consoleBounds.x>=selectionBounds.right||consoleBounds.right<=selectionBounds.x,'Production and selection controls do not overlap');
    for(const id of ['command-close','research-tab'])assert(await mobile.locator(`#${id}`).evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${id} remains accessible in a short viewport`);
    const targets=await mobile.locator('#repair-building,#sell-building,#upgrade-building').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return{width:r.width,height:r.height};}));
    assert(targets.every(r=>r.width>=40&&r.height>=36));
    await mobile.screenshot({path:`${output}/upgrades-${viewport.width}.png`});
    await mobile.locator('#command-close').click();await mobile.screenshot({path:`${output}/battlefield-${viewport.width}.png`});
    await mobile.close();
  }
  assert.deepEqual(errors,[]);console.log('Expansion browser QA passed: map choices, WASD/corners, five native zooms, research, facility upgrades, new units, brownout, repair/sell/save, desktop and mobile.');
} finally{await browser.close();}
