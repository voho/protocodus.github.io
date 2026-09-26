// Serve the repository root first. Browser storage is isolated from the user's save.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-features-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const fits = (page, selector) => page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1);
async function openChains(page) {
  if (await page.locator('#help-button').isVisible()) {
    await page.locator('#help-button').click();
    await page.locator('[data-help-tab="chains"]').click();
  } else {
    if (!(await page.locator('.sidebar').evaluate(element => element.classList.contains('mobile-open')))) await page.locator('.mobile-panel-toggle').click();
    await page.locator('.mobile-management [data-open-chains]').click();
  }
  await page.locator('.chains-explorer').waitFor({ state: 'visible' });
}
async function mapPoint(page, point) {
  return page.evaluate(point => {
    transport.renderer.focus(point.x, point.y);
    const rect = document.querySelector('#world').getBoundingClientRect(), camera = transport.renderer.getCamera();
    return { x: rect.left + rect.width / 2 + ((point.x + .5) * 32 - camera.x) * camera.zoom,
      y: rect.top + rect.height / 2 + ((point.y + .5) * 32 - camera.y) * camera.zoom };
  }, point);
}
async function clickMap(page, point) {
  const screen = await mapPoint(page, point);
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', screen);
  await page.mouse.click(screen.x, screen.y);
}
async function clickStationBadge(page, station) {
  const screen = await mapPoint(page, station), zoom = await page.evaluate(() => transport.renderer.getCamera().zoom);
  const badge = { x: screen.x + 8 * zoom + 7, y: screen.y - 18 * zoom + 7 };
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', badge);
  await page.mouse.click(badge.x, badge.y);
}
async function chooseView(page, view) {
  if (await page.locator('.main-nav').isVisible()) await page.locator(`.main-nav [data-view="${view}"]`).click();
  else {
    if (!(await page.locator('.sidebar').evaluate(element => element.classList.contains('mobile-open')))) await page.locator('.mobile-panel-toggle').click();
    await page.locator(`[data-mobile-view="${view}"]`).click();
  }
}
async function verifyConnection(page, state, valid) {
  await page.waitForFunction(({ state, valid }) => {
    const status = document.querySelector('#route-connection');
    return status?.dataset.state === state && status.dataset.valid === String(valid);
  }, { state, valid });
  assert.equal(await page.locator('#route-form button[type="submit"]').isDisabled(), !valid);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(page);
  await page.goto(url);
  await page.waitForFunction(() => window.transport?.game && window.transport?.renderer);
  await page.locator('[data-speed="0"]').click();
  assert.ok((await page.locator('.topbar').boundingBox()).height <= 68, 'desktop header uses one compact lane');
  assert.equal(await page.locator('.statsbar, .region-header').count(), 0, 'the map no longer loses space to duplicate header rows');
  await page.locator('#company-stats').click();
  assert.equal(await page.locator('#company-stats').getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('#company-tooltip').innerText(), /Delivered[\s\S]*Connected towns/, 'company details remain available on demand');
  await page.locator('#company-stats').click();

  const definitions = await page.evaluate(async () => {
    const { INDUSTRIES, TOWN_CARGO } = await import('./data.js');
    return { industries: INDUSTRIES, townCargo: TOWN_CARGO, biome: transport.game.biome };
  });
  await openChains(page);
  await page.locator('#chain-product').selectOption('all');
  const available = Object.entries(definitions.industries).filter(([, definition]) => definition.biomes.includes(definitions.biome)).map(([kind]) => kind).sort();
  assert.deepEqual(await page.locator('[data-chain-industry]').evaluateAll(nodes => nodes.map(node => node.dataset.chainIndustry).filter(kind => kind !== 'towns').sort()), available, 'the graph contains the entire local industry catalog');
  await page.waitForFunction(() => document.querySelectorAll('[data-chain-edge]').length >= 10);
  assert.ok(await page.locator('[data-chain-edge]').count() >= 10, 'the graph draws recipe dependencies');
  await page.locator('#chain-product').selectOption('machinery');
  const machinery = await page.locator('[data-chain-industry]').evaluateAll(nodes => nodes.map(node => node.dataset.chainIndustry));
  for (const kind of ['coal-mine', 'iron-mine', 'steel-mill', 'oil-well', 'refinery', 'machine-works']) assert.ok(machinery.includes(kind), `machinery includes its ${kind} dependency`);
  assert.equal(machinery.includes('logging-camp'), false, 'an unrelated timber chain is excluded from machinery');
  await page.screenshot({ path: `${output}/desktop-machinery-chain.png` });
  await page.locator('#chain-product').selectOption('all');
  await page.locator('[data-chain-industry="towns"]').click();
  const chainTown = await page.evaluate(() => transport.game.cities.at(-1));
  assert.equal(await page.locator('[data-chain-site]').count(), await page.evaluate(() => transport.game.cities.length), 'the customer node lists every town');
  await page.locator(`[data-chain-locate="${chainTown.id}"]`).click();
  assert.equal(await page.locator('#inspector h3').textContent(), chainTown.name, 'the graph locates towns as well as industries');
  await page.locator('#inspector .tiny-button').click();
  await openChains(page);
  await page.locator('#chain-product').selectOption('all');
  await page.locator('[data-chain-industry="steel-mill"]').click();
  const steelSites = await page.evaluate(() => transport.game.industries.filter(industry => industry.kind === 'steel-mill'));
  assert.deepEqual(await page.locator('[data-chain-site]').evaluateAll(nodes => nodes.map(node => node.dataset.chainSite).sort()), steelSites.map(site => site.id).sort(), 'every steel mill in a huge world is listed');
  assert.equal(await page.locator('[data-chain-locate]').count(), steelSites.length, 'every site can be located');
  await page.screenshot({ path: `${output}/desktop-steel-sites.png` });
  const steel = steelSites.at(-1);
  await page.locator(`[data-chain-locate="${steel.id}"]`).click();
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), false, 'Locate returns to the live map');
  assert.equal(await page.locator('#inspector h3').textContent(), steel.name, 'Locate inspects the selected site');
  const camera = await page.evaluate(() => transport.renderer.getCamera());
  assert.ok(Math.abs(camera.x - (steel.x + .5) * 32) < 1 && Math.abs(camera.y - (steel.y + .5) * 32) < 1, 'Locate centers the actual instance');

  const expectedSteelTargets = await page.evaluate(steel => {
    return transport.game.industries.filter(industry => ['machine-works', 'furniture-factory'].includes(industry.kind))
      .sort((a, b) => Math.hypot(a.x - steel.x, a.y - steel.y) - Math.hypot(b.x - steel.x, b.y - steel.y)).slice(0, 5).map(industry => industry.id);
  }, steel);
  assert.deepEqual(await page.locator('#inspector [data-target-id]').evaluateAll(nodes => nodes.map(node => node.dataset.targetId)), expectedSteelTargets, 'steel customers are the five closest compatible industries');
  assert.match(await page.locator('#inspector .industry-use').innerText(), /Furniture works/);
  assert.match(await page.locator('#inspector .industry-use').innerText(), /Machine works/);
  await page.screenshot({ path: `${output}/desktop-industry-destinations.png` });
  await page.locator(`#inspector [data-target-id="${expectedSteelTargets[0]}"]`).click();
  assert.equal(await page.locator('#inspector h3').textContent(), await page.evaluate(id => transport.game.industries.find(industry => industry.id === id).name, expectedSteelTargets[0]), 'a destination opens its actual industry');
  await page.locator('#industry-chain').click();
  await page.locator('.chains-explorer').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await chooseView(page, 'industry');
  const foodSite = await page.evaluate(() => transport.game.industries.find(industry => industry.kind === 'food-plant'));
  await page.locator(`[data-industry="${foodSite.id}"]`).click();
  assert.match(await page.locator('#inspector .industry-use').innerText(), /Towns/, 'town demand appears as an output consumer');
  const townTargets = await page.evaluate(foodSite => transport.game.cities.slice().sort((a,b) => Math.hypot(a.x-foodSite.x,a.y-foodSite.y)-Math.hypot(b.x-foodSite.x,b.y-foodSite.y)).slice(0,5).map(city=>city.id), foodSite);
  assert.deepEqual(await page.locator('#inspector [data-target-id]').evaluateAll(nodes => nodes.map(node => node.dataset.targetId)), townTargets, 'food destinations are the five nearest towns');
  assert.equal(await page.locator('#inspector [data-target-kind="city"]').count(), 5);
  await page.locator(`#inspector [data-target-id="${townTargets[0]}"]`).click();
  assert.equal(await page.locator('#inspector h3').textContent(), await page.evaluate(id => transport.game.cities.find(city => city.id === id).name, townTargets[0]), 'town destination opens town details rather than its colocated station');
  await page.locator('#inspector .tiny-button').click();

  // Controlled nearby freight and a parallel railway exercise the real route form.
  // Only this fresh browser context is modified; production game saves are untouched.
  const fixture = await page.evaluate(async () => {
    const { build } = await import('./model.js');
    const game = transport.game, [from, to] = game.stations;
    const food = game.industries.find(industry => industry.kind === 'food-plant');
    food.x = from.x + 1; food.y = from.y + 1; food.inventory.food = 150;
    const railY = from.y + 2;
    for (let x = from.x; x <= to.x; x++) {
      Object.assign(game.tiles[railY * game.width + x], { terrain: 'grass', detail: '', publicRoad: false, road: false, rail: true, bridge: false, tunnel: false, building: null, zone: null });
    }
    game.networkRevision++; game.revision++;
    const a = build(game, 'train-stop', from.x, railY), b = build(game, 'train-stop', to.x, railY);
    if (!a.ok || !b.ok) throw new Error(`Could not prepare rail fixture: ${a.message}; ${b.message}`);
    const railFrom = game.stations.find(station => station.mode === 'rail' && station.x === from.x && station.y === railY);
    const railTo = game.stations.find(station => station.mode === 'rail' && station.x === to.x && station.y === railY);
    return { from, to, railFrom, railTo, gap: { x: from.x + 12, y: from.y }, railGap: { x: from.x + 12, y: railY } };
  });
  await chooseView(page, 'routes');
  await page.locator('#route-form [name="name"]').fill('Orchard food delivery');
  await page.locator('[data-cargo-choice="food"]').click();
  await page.locator('[data-pick-route="from"]').click();
  await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
  await clickMap(page, fixture.railFrom);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), '', 'road picking rejects a rail station');
  await clickMap(page, fixture.from);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), fixture.from.id, 'map selection fills the departure');
  await clickMap(page, fixture.from);
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), '', 'the departure cannot also be the arrival');
  await clickMap(page, fixture.to);
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), fixture.to.id, 'map selection fills the arrival');
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  await verifyConnection(page, 'connected', true);

  await page.evaluate(async point => {
    const { build } = await import('./model.js');
    const result = build(transport.game, 'bulldoze', point.x, point.y);
    if (!result.ok) throw new Error(result.message);
  }, fixture.gap);
  await verifyConnection(page, 'disconnected', false);
  await page.screenshot({ path: `${output}/desktop-disconnected-route.png` });
  await page.evaluate(() => transport.setTool('road'));
  await clickMap(page, fixture.gap);
  await page.keyboard.press('Escape');
  await verifyConnection(page, 'connected', true);
  const beforeFreight = await page.evaluate(() => transport.game.money);
  await page.locator('#route-form button[type="submit"]').click();
  assert.equal(await page.evaluate(() => transport.game.money), beforeFreight - 18000, 'a verified road connection buys one truck');
  const freight = await page.evaluate(() => transport.game.routes.find(route => route.name === 'Orchard food delivery'));
  assert.equal(freight.cargo, 'food');
  assert.equal(await page.evaluate(id => transport.game.vehicles.find(vehicle => vehicle.routeId === id).load, freight.id), 24, 'new freight loads the selected resource');

  await page.locator('#route-form [name="mode"]').selectOption('rail');
  await page.locator('#route-form [name="name"]').fill('Valley passenger express');
  await page.locator('[data-cargo-choice="passengers"]').click();
  await page.locator('#route-form [name="from"]').selectOption(fixture.railFrom.id);
  await page.locator('#route-form [name="to"]').selectOption(fixture.railTo.id);
  await verifyConnection(page, 'connected', true);
  const beforeRail = await page.evaluate(() => transport.game.money);
  await page.locator('#route-form button[type="submit"]').click();
  assert.equal(await page.evaluate(() => transport.game.money), beforeRail - 78000, 'the rail planner buys a train');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 3);

  await page.locator('#route-search').fill('ORCHARD');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1, 'route search ignores letter case');
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Orchard food delivery/);
  await page.locator('#route-search').fill('no such connection');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 0, 'no-match search does not retain unrelated routes');
  await page.locator('#route-search').fill('');
  await page.locator('#route-filter-mode').selectOption('rail');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1);
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Valley passenger express/);
  await page.locator('#route-filter-mode').selectOption('all');
  await page.locator('#route-filter-cargo').selectOption('food');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1);
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Orchard food delivery/);
  await page.locator('#route-filter-cargo').selectOption('all');
  await page.evaluate(async point => {
    const { build, tick } = await import('./model.js');
    const result = build(transport.game, 'bulldoze', point.x, point.y);
    if (!result.ok) throw new Error(result.message);
    tick(transport.game, .01);
  }, fixture.railGap);
  await page.locator('#route-filter-status').selectOption('disconnected');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 1, 'status filter follows actual broken infrastructure');
  assert.match(await page.locator('.route-card[data-route-id]').innerText(), /Valley passenger express/);
  await page.locator('#route-filter-status').selectOption('running');
  assert.equal(await page.locator('.route-card[data-route-id]').count(), 2);
  await page.locator('#route-filter-status').selectOption('all');
  await page.screenshot({ path: `${output}/desktop-routes.png` });

  await page.locator('#route-form [name="mode"]').selectOption('road');
  await page.locator('[data-pick-route="from"]').click();
  await page.locator('#cancel-route-pick').click();
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  await page.locator('[data-pick-route="from"]').click();
  await page.keyboard.press('Escape');
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  await page.evaluate(() => transport.renderer.setZoom(.5));
  await page.locator('[data-pick-route="from"]').click();
  await clickStationBadge(page, fixture.from);
  await clickStationBadge(page, fixture.to);
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), fixture.from.id, 'Region view accepts the departure stop badge beyond its tile');
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), fixture.to.id, 'Region view accepts the arrival stop badge beyond its tile');
  await page.evaluate(() => transport.renderer.setZoom(1));

  // Real renderer output distinguishes empty, partial and full carriers in each
  // view. The fixture has its own canvas/state and never replaces the live save.
  await page.evaluate(async () => {
    const { createRenderer } = await import('./renderer.js');
    const canvas = document.createElement('canvas'); canvas.id = 'vehicle-load-qa';
    canvas.style.cssText = 'position:fixed;left:20px;top:100px;width:900px;height:360px;z-index:1000';
    document.body.append(canvas);
    const game = { width:128, height:96, seed:1847, biome:'taiga', revision:1, industries:[], stations:[], cities:[], routes:[], vehicles:[], tiles:Array.from({length:128*96},(_,index)=>({terrain:'grass',elevation:.2,detail:'',variant:0,road:Math.floor(index/128)===32,rail:false,bridge:false,tunnel:false,building:null,zone:null})) };
    for(const [index,cargo] of ['passengers','food','timber'].entries()){
      game.routes.push({id:`indicator-${index}`,mode:'road',cargo,color:'#bd8b52'});
      game.vehicles.push({id:`vehicle-${index}`,routeId:`indicator-${index}`,x:44+index*4,y:32,angle:0,load:[24,7,0][index],capacity:24});
    }
    const renderer = createRenderer(canvas,game); renderer.focus(48,32);
    window.vehicleLoadQA={canvas,game,renderer};
  });
  for(const zoom of [.5,1,2]){
    await page.evaluate(zoom=>{vehicleLoadQA.renderer.setZoom(zoom);vehicleLoadQA.renderer.render(0,{showRoutes:false});},zoom);
    await page.waitForTimeout(80);
    const state = await page.evaluate(()=>{vehicleLoadQA.renderer.render(0,{showRoutes:false});return vehicleLoadQA.renderer.getStats().vehicleIndicators;});
    assert.deepEqual(state,{empty:1,partial:1,full:1},`${zoom}x shows all three load states`);
    await page.locator('#vehicle-load-qa').screenshot({path:`${output}/vehicle-loads-${zoom}x.png`});
  }
  const distinctLoads=await page.evaluate(()=>{
    const {renderer,game,canvas}=vehicleLoadQA;renderer.setZoom(1);
    const samples=[];for(const load of [0,7,24]){game.vehicles[1].load=load;renderer.render(0,{showRoutes:false});samples.push(canvas.toDataURL());}
    return new Set(samples).size;
  });
  assert.equal(distinctLoads,3,'empty, partial and full meters produce different rendered pixels');
  await page.evaluate(()=>{vehicleLoadQA.canvas.remove();delete window.vehicleLoadQA;});

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    assert.ok((await page.locator('.topbar').boundingBox()).height <= 60, `${width}px header stays in one lane`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px page fits the screen`);
    const finances = await page.evaluate(() => {
      const game=transport.game, original={money:game.money,monthlyIncome:game.monthlyIncome,monthlyExpenses:game.monthlyExpenses};
      game.money=12345678;game.monthlyIncome=12345678;game.monthlyExpenses=0;return original;
    });
    await page.waitForFunction(() => document.querySelector('#balance').textContent.includes('M'));
    assert.equal(await fits(page,'.topbar'),true,`${width}px header fits a wealthy company`);
    await page.locator('#company-stats').click();
    assert.equal(await page.locator('#balance-exact').textContent(),'$12,345,678','compact money retains its exact value in company details');
    await page.locator('#company-stats').click();
    await page.evaluate(finances=>Object.assign(transport.game,finances),finances);
    await openChains(page);
    await page.locator('#chain-product').selectOption('machinery');
    assert.equal(await fits(page, '#modal'), true, `${width}px chains dialog fits`);
    assert.equal(await fits(page, '.chains-explorer'), true, `${width}px explorer contains its scrolling graph`);
    await page.locator('[data-chain-industry="steel-mill"]').click();
    assert.equal(await page.locator('[data-chain-site]').count(), steelSites.length);
    await page.screenshot({ path: `${output}/mobile-${width}-chains.png` });
    await page.keyboard.press('Escape');
    await chooseView(page, 'routes');
    assert.equal(await fits(page, '#panel-content'), true, `${width}px route panel fits`);
    await page.locator('#route-form [name="mode"]').selectOption('road');
    await page.locator('[data-cargo-choice="passengers"]').click();
    await page.locator('[data-pick-route="from"]').click();
    await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
    await clickMap(page, fixture.from);
    await clickMap(page, fixture.to);
    await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#route-form').isVisible(), true, `${width}px picking returns to the route form`);
    assert.equal(await page.locator('#route-form [name="from"]').inputValue(), fixture.from.id);
    assert.equal(await page.locator('#route-form [name="to"]').inputValue(), fixture.to.id);
    await verifyConnection(page, 'connected', true);
    await page.locator('#route-connection').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => scrollY), 0, `${width}px route selection only scrolls the management panel`);
    assert.equal((await page.locator('.topbar').boundingBox()).y, 0, `${width}px header remains visible after station selection`);
    await page.screenshot({ path: `${output}/mobile-${width}-route-picker.png` });
    await page.locator('.mobile-panel-toggle').click();
  }
  assert.deepEqual(errors, [], 'no browser console or runtime errors');
  console.log(`Transport chain and network-planning checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
