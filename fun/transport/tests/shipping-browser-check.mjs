// End-to-end shipping on generated rivers, in a fresh browser storage context.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-shipping-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function clickMap(page, point, badge = false) {
  const screen = await page.evaluate(({ point, badge }) => {
    transport.renderer.focus(point.x, point.y);
    const rect = document.querySelector('#world').getBoundingClientRect(), camera = transport.renderer.getCamera();
    return {
      x: rect.left + rect.width / 2 + ((point.x + .5) * 32 - camera.x) * camera.zoom + (badge ? 8 * camera.zoom + 7 : 0),
      y: rect.top + rect.height / 2 + ((point.y + .5) * 32 - camera.y) * camera.zoom + (badge ? -18 * camera.zoom + 7 : 0),
    };
  }, { point, badge });
  await page.waitForFunction(p => document.elementFromPoint(p.x, p.y)?.id === 'world', screen);
  await page.mouse.click(screen.x, screen.y);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.transport?.game);
  await page.locator('#world-button').click();
  await page.locator('[data-biome="taiga"]').click();
  await page.locator('[data-world-size="regional"]').click();
  await page.locator('#world-seed').fill('1847');
  await page.locator('#generate-world').click();
  await page.locator('[data-speed="0"]').click();

  const sites = await page.evaluate(async () => {
    const { findPath } = await import('./model.js');
    const g = transport.game, at = (x,y) => x >= 0 && y >= 0 && x < g.width && y < g.height ? g.tiles[y*g.width+x] : null;
    const candidates = city => {
      const points = [];
      for (let y=city.y-5;y<=city.y+5;y++) for(let x=city.x-5;x<=city.x+5;x++) {
        const t=at(x,y);
        if (Math.hypot(x-city.x,y-city.y)>5 || t?.terrain!=='water' || t.road || t.rail || t.bridge || t.building) continue;
        if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>at(x+dx,y+dy)&&at(x+dx,y+dy).terrain!=='water')) points.push({x,y});
      }
      return points;
    };
    for (const a of candidates(g.cities[0])) for (const b of candidates(g.cities[1])) {
      const path = findPath(g,a,b,'water');
      if(path?.length>2) return {a,b,pathLength:path.length};
    }
    return null;
  });
  assert.ok(sites, 'both starter towns have usable ports on a connected generated river');
  await page.locator('[data-tool="port"]').click();
  await clickMap(page, sites.a);
  await page.waitForFunction(() => transport.game.stations.filter(s=>s.mode==='water').length===1);
  await page.locator('#world').focus();
  await page.keyboard.press('p');
  await clickMap(page, sites.b);
  await page.waitForFunction(() => transport.game.stations.filter(s=>s.mode==='water').length===2);
  await page.keyboard.press('Escape');
  await clickMap(page, sites.a);
  assert.match(await page.locator('#inspector').innerText(), /PORT[\s\S]*Water/);
  await page.locator('#station-route').click();
  assert.equal(await page.locator('#route-form [name="mode"]').inputValue(), 'water', 'port inspector starts a water route');
  await page.locator('#inspector .tiny-button').click();
  await page.locator('#route-form [name="name"]').fill('River ferry');
  await page.evaluate(() => transport.renderer.setZoom(.5));
  await page.locator('[data-pick-route="from"]').click();
  await clickMap(page, sites.a, true);
  await clickMap(page, sites.b, true);
  await page.waitForFunction(() => document.querySelector('#route-connection')?.dataset.valid==='true');
  await page.locator('#route-form [type="submit"]').click();
  await page.waitForFunction(() => transport.game.routes.some(r=>r.mode==='water'));
  const routeId = await page.evaluate(() => transport.game.routes.find(r=>r.mode==='water').id);
  assert.equal(await page.evaluate(id=>transport.game.vehicles.find(v=>v.routeId===id).capacity, routeId), 140);
  await page.locator('#route-filter-mode').selectOption('water');
  await page.locator('#route-search').fill('ship');
  assert.equal(await page.locator('#route-list [data-route-id]').count(), 1, 'ship search and water filter find the ferry');
  await page.evaluate(async()=>{const { tick }=await import('./model.js');tick(transport.game,40);});
  assert.ok(await page.evaluate(id=>transport.game.routes.find(r=>r.id===id).delivered>0,routeId), 'ferry actually delivers passengers');
  assert.ok(await page.evaluate(id=>transport.game.routes.find(r=>r.id===id).revenue>0,routeId), 'shipping earns delivery revenue');
  await page.evaluate(id=>{const v=transport.game.vehicles.find(v=>v.routeId===id);transport.renderer.setZoom(2);transport.renderer.focus(v.x,v.y);},routeId);
  await page.waitForFunction(()=>!document.querySelector('#toast-region .toast'));
  await page.waitForTimeout(150); // Let local SVG load markers finish at the new display scale.
  await page.screenshot({path:`${output}/river-ferry-desktop.png`});

  const slot = await page.evaluate(async()=>{
    const { writeSaveSlot, readSaveSlot }=await import('./save-slots.js');
    const written=await writeSaveSlot(transport.game,{name:'Shipping company'});
    if(!written.ok)throw new Error(written.message);
    const loaded=await readSaveSlot(written.id);
    return {ok:loaded.ok,ports:loaded.game?.stations.filter(s=>s.mode==='water').length,route:loaded.game?.routes.find(r=>r.mode==='water')};
  });
  assert.equal(slot.ok,true);assert.equal(slot.ports,2);assert.equal(slot.route.id,routeId);
  await page.evaluate(()=>transport.persist());
  await page.reload();await page.waitForFunction(()=>window.transport?.game);await page.locator('[data-speed="0"]').click();
  assert.equal(await page.evaluate(()=>transport.game.stations.filter(s=>s.mode==='water').length),2);
  assert.equal(await page.evaluate(id=>transport.game.routes.find(r=>r.id===id)?.mode,routeId),'water','autosave restores shipping');

  // A port on an isolated lake must fail the same connection check in the form.
  const isolated=await page.evaluate(async point=>{
    const {findPath,build}=await import('./model.js');const g=transport.game;
    for(let y=1;y<g.height-1;y++)for(let x=1;x<g.width-1;x++){
      const t=g.tiles[y*g.width+x];if(t.terrain!=='water'||t.road||t.rail||t.bridge)continue;
      if(![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>g.tiles[(y+dy)*g.width+x+dx].terrain!=='water'))continue;
      if(findPath(g,point,{x,y},'water'))continue;
      const result=build(g,'port',x,y);if(result.ok)return result.station;
    }
    return null;
  },sites.a);
  assert.ok(isolated,'fixture includes an isolated lake');
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#route-form [name="mode"]').selectOption('water');
  const fromId=await page.evaluate(p=>transport.game.stations.find(s=>s.x===p.x&&s.y===p.y).id,sites.a);
  await page.locator('#route-form [name="from"]').selectOption(fromId);
  await page.locator('#route-form [name="to"]').selectOption(isolated.id);
  await page.waitForFunction(()=>document.querySelector('#route-connection')?.dataset.state==='disconnected');
  assert.equal(await page.locator('#route-form [type="submit"]').isDisabled(),true);
  assert.match(await page.locator('#route-connection').innerText(),/water|river|lake|sea/i);

  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>transport.setView('routes'));
    assert.equal(await page.locator('#panel-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,`${width}px shipping form fits`);
    await page.locator('#route-form [name="mode"]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#route-form [name="mode"]').inputValue(),'water');
    await page.screenshot({path:`${output}/shipping-form-${width}.png`});
    await page.evaluate(()=>transport.setView('build'));
    assert.equal(await page.locator('[data-tool="port"]').count(),1,'port remains accessible on mobile');
  }
  assert.deepEqual(errors,[]);
  console.log(`Shipping UI checks passed: generated river, ports, ferry delivery, water filters, disconnected lake, saves, mobile. Screenshots: ${output}`);
} finally { await browser.close(); }
