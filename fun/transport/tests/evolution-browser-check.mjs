// Annual upgrades, displayed inflation and decoration cleanup in isolated storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium }=await import(process.env.TRANSPORT_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({channel:process.env.TRANSPORT_BROWSER||'chrome',headless:true});
const output=process.env.TRANSPORT_SCREENSHOTS||'/tmp/transport-evolution-qa';
await mkdir(output,{recursive:true});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.TRANSPORT_URL||'http://localhost:8765/fun/transport/');
  await page.waitForFunction(()=>window.transport?.game);
  await page.locator('[data-speed="0"]').click();
  await page.locator('#world-button').click();
  await page.locator('[data-world-size="square512"]').click();
  await page.locator('#generate-world').click();
  await page.locator('[data-speed="0"]').click();
  const setup=await page.evaluate(async()=>{
    const {build,addRoute}=await import('./model.js'),g=transport.game;
    const road=addRoute(g,{mode:'road',stops:g.stations.slice(0,2).map(s=>s.id),cargo:'passengers',name:'Town shuttle'});
    if(!road.ok)throw new Error(road.message);
    const ports=g.cities.slice(0,2).map(c=>build(g,'port',c.x,c.y+5));
    if(ports.some(p=>!p.ok))throw new Error('Opening river lacks ports');
    const ship=addRoute(g,{mode:'water',stops:ports.map(p=>p.station.id),cargo:'passengers',name:'River ferry'});
    if(!ship.ok)throw new Error(ship.message);
    return {first:g.routes[0].id,ship:ship.route.id};
  });
  await page.locator('.main-nav [data-view="routes"]').click();
  assert.equal(await page.locator('[data-upgrade-route]').count(),3);
  assert.equal(await page.locator('#upgrade-fleet').isDisabled(),true,'no future vehicles can be bought in the first year');
  await page.evaluate(async()=>{const {tick}=await import('./model.js');tick(transport.game,365-transport.game.day);});
  await page.waitForFunction(()=>document.querySelector('#date').textContent.includes('1951'));
  await page.waitForFunction(()=>!document.querySelector('#upgrade-fleet').disabled);
  const before=await page.evaluate(async id=>{
    const {getVehicleUpgrade,inflationInfo}=await import('./model.js');
    return {vehicle:structuredClone(transport.game.vehicles.find(v=>v.routeId===id)),quote:getVehicleUpgrade(transport.game,id),money:transport.game.money,pricing:inflationInfo(transport.game)};
  },setup.first);
  assert.ok(before.pricing.rate>=.01&&before.pricing.rate<=.05);
  await page.locator(`[data-upgrade-route="${setup.first}"]`).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(id=>transport.game.vehicles.find(v=>v.routeId===id).level===1,setup.first);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.focusRoute),setup.first,'keyboard upgrade returns focus to the upgraded route');
  const upgraded=await page.evaluate(id=>({vehicle:transport.game.vehicles.find(v=>v.routeId===id),money:transport.game.money}),setup.first);
  assert.equal(upgraded.money,before.money-before.quote.cost);
  assert.equal(upgraded.vehicle.capacity,before.quote.nextCapacity);
  for(const key of ['load','progress','direction','dwellRemaining'])assert.equal(upgraded.vehicle[key],before.vehicle[key],`upgrade preserves ${key}`);
  const fleet=await page.evaluate(async()=>{const {getFleetUpgrade}=await import('./model.js');return getFleetUpgrade(transport.game);});
  assert.equal(fleet.count,2);
  const budget=await page.evaluate(()=>transport.game.money);
  await page.evaluate(cost=>{transport.game.money=cost-1;},fleet.cost);
  await page.waitForFunction(()=>document.querySelector('#upgrade-fleet').disabled);
  assert.equal(await page.evaluate(()=>transport.game.vehicles.filter(v=>v.level===1).length),1,'unaffordable fleet quote leaves remaining vehicles unchanged');
  await page.evaluate(budget=>{transport.game.money=budget;},budget);
  await page.waitForFunction(()=>!document.querySelector('#upgrade-fleet').disabled);
  await page.locator('#upgrade-fleet').click();
  await page.waitForFunction(()=>transport.game.vehicles.every(v=>v.level===1));
  assert.equal(await page.evaluate(()=>transport.game.money),budget-fleet.cost,'bulk upgrade charges the complete quoted amount once');
  assert.equal(await page.locator('#upgrade-fleet').isDisabled(),true);
  await page.locator('#company-stats').click();
  assert.match(await page.locator('#inflation-rate').textContent(),/\+[1-5]\.\d\d%/);
  await page.locator('#company-stats').click();
  await page.screenshot({path:`${output}/upgraded-fleet-desktop.png`});
  await page.locator('.main-nav [data-view="build"]').click();
  const expected=await page.evaluate(async()=>{const {priceFor,BUILD_COSTS}=await import('./model.js');return priceFor(transport.game,BUILD_COSTS.road);});
  assert.match(await page.locator('[data-tool="road"] .tool-cost').textContent(),new RegExp(String(expected)),'construction palette quotes current inflated costs');
  const clearing=await page.evaluate(()=>{
    const g=transport.game,c=g.cities[0];
    for(let y=c.y-10;y<c.y+10;y++)for(let x=c.x-10;x<c.x+10;x++){
      const t=g.tiles[y*g.width+x];
      if(t&&!t.road&&!t.rail&&!t.building&&!t.zone&&!g.industries.some(i=>i.x===x&&i.y===y)&&['grass','sand','snow'].includes(t.terrain)){
        t.detail='wildflowers';g.revision++;return {x,y};
      }
    }
    throw new Error('No clearable plot');
  });
  await page.locator('[data-tool="bulldoze"]').click();
  assert.match(await page.locator('[data-tool="bulldoze"]').innerText(),/Bulldozer/);
  const point=await page.evaluate(p=>{
    transport.renderer.focus(p.x,p.y);const r=document.querySelector('#world').getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  },clearing);
  await page.mouse.click(point.x,point.y);
  assert.equal(await page.evaluate(p=>transport.game.tiles[p.y*transport.game.width+p.x].detail,clearing),'','Bulldozer clears decorative flowers');
  const construction=await page.evaluate(async p=>{
    const {constructionCost}=await import('./model.js'),g=transport.game,t=g.tiles[p.y*g.width+p.x];
    t.terrain='forest';t.detail='pine';g.revision++;
    return {cost:constructionCost(g,'road',p.x,p.y),money:g.money};
  },clearing);
  await page.locator('[data-tool="road"]').click();
  await page.mouse.move(point.x,point.y);
  assert.equal(await page.locator('#placement-tip').textContent(),`Road · $${construction.cost.toLocaleString('en-US')}`,'placement quote includes inflated forest clearance');
  await page.mouse.click(point.x,point.y);
  assert.equal(await page.evaluate(()=>transport.game.money),construction.money-construction.cost,'construction charges the shown quote');
  await page.mouse.move(point.x+1,point.y);
  assert.equal(await page.locator('#placement-tip').textContent(),'Road · $0','an existing road quotes no further charge');
  const saved=await page.evaluate(()=>{transport.persist();return transport.game.vehicles.map(v=>({id:v.id,level:v.level,capacity:v.capacity}));});
  await page.reload();await page.waitForFunction(()=>window.transport?.game);await page.locator('[data-speed="0"]').click();
  assert.deepEqual(await page.evaluate(()=>transport.game.vehicles.map(v=>({id:v.id,level:v.level,capacity:v.capacity}))),saved,'upgraded fleet survives autosave');
  await page.evaluate(async()=>{const {tick}=await import('./model.js');tick(transport.game,730-transport.game.day);});
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.waitForFunction(()=>!document.querySelector('#upgrade-fleet').disabled);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.evaluate(()=>transport.setView('routes'));
    assert.equal(await page.locator('#panel-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${width}px fleet controls fit`);
    await page.locator('#upgrade-fleet').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/fleet-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log(`Annual upgrades, bulk affordability, inflation prices, bulldozer and mobile checks passed. Screenshots: ${output}`);
}finally{await browser.close();}
