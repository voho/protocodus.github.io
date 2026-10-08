// Cargo lens in a real browser: a freight cargo chosen in Routes, the Industries type filter or Chains Locate lights
// its producers and buyers on the map and atlas; Passengers, the chip's ×, closing the view and Escape clear it.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-cargo-lens-qa';
await mkdir(output, { recursive: true });
const errors = [];
const lens = page => page.evaluate(() => transport.renderer.getStats().lens);
const chip = page => page.locator('#cargo-lens-chip');
const cleared = async (page, why) => { await page.waitForFunction(() => !transport.renderer.getStats().lens && !document.querySelector('#cargo-lens-chip')); assert.equal(await lens(page), null, why); };
const showing = (page, cargo) => page.waitForFunction(cargo => transport.renderer.getStats().lens?.cargo === cargo, cargo);
let routeStops;
const routes = async (page, cargo = 'iron') => {
  if (!await page.locator('#route-form').count() || !await page.locator('.sidebar').evaluate(el=>el.classList.contains('drawer-open'))) {
    await page.evaluate(()=>transport.setView('routes')); await page.locator('#new-route-button').click();
  }
  const camera=await page.evaluate(()=>transport.renderer.getCamera());
  if (await page.locator('#change-route-stops').isVisible()) await page.locator('#change-route-stops').click();
  await page.locator('#route-form [name="from"]').selectOption(routeStops[cargo]);
  await page.locator('#route-form [name="to"]').selectOption(routeStops.town);
  // The fixture keeps the marker samples at one camera position while exercising the real stop-first UI.
  await page.evaluate(camera=>transport.renderer.focus(camera.x/32-.5,camera.y/32-.5),camera);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await createWorldFromMenu(page);
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
  // Region view over the iron mine nearest the home town; the drawer covers the left of the map, so the mine sits right of centre.
  const mine = await page.evaluate(() => {
    const home = transport.game.cities[0], site = transport.game.industries.filter(i => i.kind === 'iron-mine').sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
    transport.renderer.setZoom(.5); transport.renderer.focus(site.x - 6, site.y + 6); return { id: site.id, x: site.x, y: site.y, span: site.footprint || 1 };
  });
  routeStops = await page.evaluate(() => {
    const game = transport.game, stops = { town:game.stations.find(stop=>stop.mode==='road').id };
    for (const [cargo,kind] of [['iron','iron-mine'],['coal','coal-mine']]) {
      const site=game.industries.find(site=>site.kind===kind),stop={id:`lens-${cargo}`,name:`${cargo} source`,mode:'road',x:site.x-1,y:site.y-1};
      game.stations.push(stop);stops[cargo]=stop.id;
    }
    game.revision++;game.networkRevision++;
    return stops;
  });
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#new-route-button').click();
  await page.locator('#route-planner').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#route-cargo-step').isHidden(), true, 'a new lens draft starts with stops');
  await routes(page);
  assert.equal(await page.locator('[data-cargo-choice="iron"]').isVisible(), true, 'iron is offered because the start serves an iron mine');
  // Samples a marker's pale left edge while rendering in one task: plain, without industry icons (the ground beneath) and as the app draws it now.
  await page.evaluate(() => {
    window.lensQA = {
      // A paused game draws only when asked, so waiting draws frames: strips and the shadow layer finish, and a
      // pixel read before and after a lens compares the same finished scenery.
      pending: () => { transport.renderer.render(1000, {}); return transport.renderer.getStats().sceneryBatches?.pending || 0; },
      read(point) { const canvas = document.querySelector('#world'), density = devicePixelRatio || 1; transport.renderer.render(1000, {}); return Array.from(canvas.getContext('2d').getImageData(Math.round(point.x * density), Math.round(point.y * density), 1, 1).data).slice(0, 3); },
      ground(point) { const renderer = transport.renderer; renderer.setLayers({ industryIcons: false }); const pixel = lensQA.read(point); renderer.setLayers({ industryIcons: true }); return pixel; },
      onScreen(kind) { const canvas = document.querySelector('#world'); return transport.game.industries.filter(site => site.kind === kind).map(site => transport.renderer.industryMarker(site)).filter(m => m.x >= 0 && m.y >= 0 && m.x <= canvas.clientWidth && m.y <= canvas.clientHeight).length; },
    };
  });
  for (let attempt = 0; attempt < 200 && await page.evaluate(() => lensQA.pending()); attempt++) await page.waitForTimeout(50);
  // A marker without an iron role, clear of the drawer and the screen edges.
  const other = await page.evaluate(() => {
    const canvas = document.querySelector('#world'), drawer = document.querySelector('.sidebar').getBoundingClientRect().right - canvas.getBoundingClientRect().left;
    const site = transport.game.industries.filter(site => !['iron-mine', 'steel-mill'].includes(site.kind)).map(site => ({ id: site.id, kind: site.kind, marker: transport.renderer.industryMarker(site) })).find(({ marker }) => marker.x > drawer + 60 && marker.x < canvas.clientWidth - 200 && marker.y > 80 && marker.y < canvas.clientHeight - 120);
    return site && { ...site, point: { x: site.marker.x - (site.marker.size + 8) / 2 + 2, y: site.marker.y } };
  });
  assert.ok(other, 'a non-role industry marker is on screen');
  const plain = await page.evaluate(point => lensQA.read(point), other.point), ground = await page.evaluate(point => lensQA.ground(point), other.point);
  const channel = [0, 1, 2].sort((a, b) => Math.abs(plain[b] - ground[b]) - Math.abs(plain[a] - ground[a]))[0];
  assert.ok(Math.abs(plain[channel] - ground[channel]) > 30, `the marker stands out from the ground (${plain} vs ${ground})`);

  // Routes: an explicit Iron ore click lights iron mines and their buyers.
  await page.locator('[data-cargo-choice="iron"]').click();
  await showing(page, 'iron');
  await chip(page).waitFor({ state: 'visible' });
  assert.match(await chip(page).innerText(), /^Showing iron ore\s*·\s*×$/);
  assert.equal(await page.locator('#cargo-lens-chip button').getAttribute('aria-label'), 'Stop showing iron ore');
  const counted = await page.evaluate(() => { transport.renderer.render(1000, {}); return { stats: transport.renderer.getStats().lens, mines: lensQA.onScreen('iron-mine'), mills: lensQA.onScreen('steel-mill') }; });
  assert.ok(counted.mines > 0, 'an iron mine is on screen');
  assert.equal(counted.stats.sources, counted.mines, 'every visible iron mine is a lens source');
  assert.equal(counted.stats.buyers, counted.mills, 'every visible steel mill is a lens buyer');
  assert.equal(counted.stats.towns, 0, 'towns do not buy iron ore');
  const dimmed = await page.evaluate(point => lensQA.read(point), other.point), expected = (plain[channel] + ground[channel]) / 2;
  assert.ok(Math.abs(dimmed[channel] - expected) < Math.abs(plain[channel] - ground[channel]) * .2, `a marker outside the lens recedes to half strength (${dimmed} between ${plain} and ${ground})`);
  await page.screenshot({ path: `${output}/lens-routes-iron.png` });

  // Atlas: role-coloured squares at the mine and its nearest steel mill; the legend names them.
  await page.keyboard.press('Escape'); // Escape in Explore closes the drawer and clears the lens
  await cleared(page, 'Escape clears the lens');
  await routes(page);
  await page.locator('[data-cargo-choice="iron"]').click();
  await showing(page, 'iron');
  await page.evaluate(() => document.querySelector('#atlas-button').click());
  await page.locator('#atlas-map').waitFor({ state: 'visible' });
  const atlasAt = site => page.evaluate(site => { const atlas = document.querySelector('#atlas-map'), game = transport.game, ratio = Math.min(devicePixelRatio || 1, 2), w = atlas.width / ratio, h = atlas.height / ratio; return Array.from(atlas.getContext('2d').getImageData(Math.round((site.x + site.span / 2) * w / game.width) * ratio, Math.round((site.y + site.span / 2) * h / game.height) * ratio, 1, 1).data).slice(0, 3); }, site);
  const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)), near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
  assert.ok(near(await atlasAt(mine), hex('#4e7747')), `the atlas marks the iron mine as a producer (${await atlasAt(mine)})`);
  const mill = await page.evaluate(() => { const site = transport.game.industries.find(site => site.kind === 'steel-mill'); return { x: site.x, y: site.y, span: site.footprint || 1 }; });
  assert.ok(near(await atlasAt(mill), hex('#3f7f88')), 'the atlas marks a steel mill as a buyer');
  assert.match(await page.locator('.atlas-legend').innerText(), /Iron ore producers\s+Buyers/);
  await page.screenshot({ path: `${output}/lens-atlas-iron.png` });
  await page.keyboard.press('Escape');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await routes(page);

  // Passengers, the chip's ×, folding the planner, leaving Routes and closing the drawer each clear a Routes lens.
  await page.locator('[data-cargo-choice="passengers"]').click();
  await cleared(page, 'Passengers clears the lens');
  await page.locator('[data-cargo-choice="iron"]').click();
  await showing(page, 'iron');
  await page.locator('#cargo-lens-chip button').click();
  await cleared(page, 'the chip × clears the lens');
  assert.deepEqual(await page.evaluate(point => lensQA.read(point), other.point), plain, 'the marker returns to full strength');
  await page.evaluate(() => document.querySelector('#atlas-button').click());
  assert.ok(!near(await atlasAt(mine), hex('#4e7747')), 'the atlas drops the producer square');
  await page.keyboard.press('Escape');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await routes(page);
  await page.locator('[data-cargo-choice="iron"]').click();
  await showing(page, 'iron');
  await page.locator('#route-back').click();
  await cleared(page, 'returning to the route list clears the lens');
  await routes(page);
  await page.locator('[data-cargo-choice="iron"]').click();
  await showing(page, 'iron');
  await page.locator('.main-nav [data-build-area="network"]').click();
  await cleared(page, 'leaving Routes clears the lens');
  await routes(page, 'coal');
  await page.locator('[data-cargo-choice="coal"]').click();
  await showing(page, 'coal');
  await page.locator('#close-management').click();
  await cleared(page, 'closing the drawer clears the lens');
  // Picking a stop closes the drawer for the map and keeps the lens; Escape then only cancels the picker.
  await routes(page);
  await page.locator('[data-cargo-choice="iron"]').click();
  await showing(page, 'iron');
  await page.locator('#change-route-stops').click();
  await page.locator('[data-pick-route="from"]').click();
  await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
  assert.equal((await lens(page))?.cargo, 'iron', 'picking on the map keeps the lens');
  await page.keyboard.press('Escape');
  await page.locator('#route-pick-banner').waitFor({ state: 'detached' });
  assert.equal((await lens(page))?.cargo, 'iron', 'cancelling the picker keeps the lens');
  await page.locator('#cargo-lens-chip button').click();
  await cleared(page, 'the chip clears it after picking');

  // Industries: the type filter lights that type's output until All industries or another view.
  await page.locator('.main-nav [data-view="industry"]').click();
  await page.locator('#industry-kind').selectOption('iron-mine');
  await showing(page, 'iron');
  await page.locator('#industry-kind').selectOption('steel-mill');
  await showing(page, 'steel');
  await page.locator('#industry-kind').selectOption('all');
  await cleared(page, 'All industries clears the lens');
  await page.locator('#industry-kind').selectOption('steel-mill');
  await showing(page, 'steel');
  await page.locator('#entity-list [data-industry]').first().click();
  assert.equal((await lens(page))?.cargo, 'steel', 'locating a listed site keeps the lens');
  await page.locator('.main-nav [data-view="routes"]').click();
  await cleared(page, 'another view clears an Industries lens');
  // Shift+I closes the drawer as its tab does, and the lens goes with it.
  await page.locator('.main-nav [data-view="industry"]').click();
  await page.locator('#industry-kind').selectOption('iron-mine');
  await showing(page, 'iron');
  await page.locator('#world').focus();
  await page.keyboard.press('Shift+I');
  await cleared(page, 'Shift+I closes Industries and clears its lens');
  await page.locator('.main-nav [data-view="routes"]').click();

  // Chains: Locate lights the site's output and the lens outlives the dialog and later view changes.
  await page.locator('#world').focus();
  await page.keyboard.press('c');
  await page.locator('.chains-explorer').waitFor({ state: 'visible' });
  await page.locator('#chain-product').selectOption('all');
  await page.locator('[data-chain-industry="iron-mine"]').click();
  await page.locator('[data-chain-locate]').first().click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await showing(page, 'iron');
  await page.locator('.main-nav [data-build-area="network"]').click();
  assert.equal((await lens(page))?.cargo, 'iron', 'a Chains lens stays across views');
  await page.locator('#world').focus();
  await page.keyboard.press('c');
  await page.locator('#chain-product').selectOption('food');
  await page.locator('[data-chain-industry="towns"]').click();
  await page.locator('[data-chain-locate]').first().click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await showing(page, 'food');
  await page.waitForFunction(() => transport.renderer.getStats().lens?.towns > 0);
  await page.evaluate(() => document.querySelector('#inspector .tiny-button')?.click());
  await page.screenshot({ path: `${output}/lens-chains-food-towns.png` });
  await page.locator('#world').focus();
  await page.keyboard.press('Escape');
  await cleared(page, 'Escape clears a Chains lens');
  assert.equal(await page.evaluate(() => Object.keys(transport.game).some(key => /lens/i.test(key))), false, 'the lens never enters the game state');
  await page.close();

  assert.deepEqual(errors, []);
  console.log(`Cargo lens browser check passed · screenshots in ${output}`);
} finally {
  await browser.close();
}
