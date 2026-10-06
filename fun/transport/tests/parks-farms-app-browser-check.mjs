// Real catalog and pointer gestures on untouched recipe-9 terrain. Model and
// artwork matrix tests cover other climates; this check exercises player flows.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-parks-farms-app';
await mkdir(output, { recursive: true });
const parks = ['park-village', 'park-formal', 'park-woodland'];
const malls = ['mall-neighborhood', 'mall-shopping', 'mall-modern'];
const farms = ['farm', 'dairy-farm', 'vegetable-farm', 'orchard', 'livestock-farm'];
const errors = [], results = [];

async function drawer(page) {
  if (!await page.locator('.sidebar').evaluate(el => el.classList.contains('mobile-open')))
    await page.locator(await page.locator('.mobile-panel-toggle').isVisible() ? '.mobile-panel-toggle' : '.main-nav [data-view="build"]').click();
  await page.locator('.sidebar').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
}
async function choose(page, kind, group) {
  await drawer(page);
  await page.locator(`[data-category="${group ? 'towns' : 'industry'}"]`).click();
  if (group) await page.locator('#building-group').selectOption(group);
  await page.locator(`#panel-content [data-tool="${kind}"]`).click();
  assert.equal(await page.locator(`#panel-content [data-tool="${kind}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.sidebar').evaluate(el => el.classList.contains('mobile-open')), false, 'selection returns to the map');
}
async function screen(page, point, { focus = true, zoom = 1 } = {}) {
  return page.evaluate(({ point, focus, zoom }) => {
    const r = transport.renderer;
    if (focus) { r.setZoom(zoom); r.focus(point.x, point.y); }
    const p = r.worldToScreen(point.x, point.y), rect = document.querySelector('#world').getBoundingClientRect();
    return { x: p.x + rect.left, y: p.y + rect.top };
  }, { point, focus, zoom });
}
async function clickWorld(page, point, mobile) {
  const p = await screen(page, point, { zoom: mobile ? .5 : 1 });
  await page.waitForFunction(p => document.elementFromPoint(p.x, p.y)?.id === 'world', p);
  if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
  return p;
}
async function findSite(page, kind, { nearTown = false, near } = {}) {
  return page.evaluate(async ({ kind, nearTown, near }) => {
    const { quoteBuildPlan } = await import('./construction-plan.js');
    const { BUILDINGS } = await import('./buildings.js');
    const { INDUSTRIES } = await import('./data.js');
    const { surfaceHeight } = await import('./terrain-geometry.js');
    const g = transport.game, definition = BUILDINGS[kind] || INDUSTRIES[kind], span = definition.footprint;
    const centers = near ? [near] : g.cities;
    for (const center of centers) for (let radius = 1; radius <= (nearTown ? 10 : 80); radius++)
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius || nearTown && Math.hypot(dx, dy) >= 10) continue;
        const x = center.x + dx, y = center.y + dy;
        if (x < 2 || y < 2 || x + span >= g.width - 2 || y + span >= g.height - 2) continue;
        const quote = quoteBuildPlan(g, kind, [{ x, y }]);
        if (!quote.ok) continue;
        // Choose a naturally gentle field for a readable perimeter preview.
        let low = Infinity, high = -Infinity;
        for (let sy = y; sy <= y + span; sy++) for (let sx = x; sx <= x + span; sx++) {
          const h = surfaceHeight(g, sx, sy); low = Math.min(low, h); high = Math.max(high, h);
        }
        if (span === 7 && high - low > 1) continue;
        return { x, y, kind, span, name: definition.name, cost: quote.cost, townId: center.id };
      }
    throw new Error(`No real clear ${span}×${span} plot for ${kind}`);
  }, { kind, nearTown, near });
}
async function state(page, point) {
  return page.evaluate(async point => {
    const { buildingAt } = await import('./building-sites.js'), { industryAt } = await import('./model.js');
    const g = transport.game, building = buildingAt(g, point.x, point.y), industry = industryAt(g, point.x, point.y);
    return { money: g.money, expenses: g.totalExpenses, building, industry, road: g.tiles[point.y * g.width + point.x].road };
  }, point);
}

// Capture the actual filled preview polygon from the live world canvas, in CSS
// pixels. This proves the outline includes all 49 cells rather than just the barn.
async function capturePreview(page) {
  await page.evaluate(() => {
    const ctx = document.querySelector('#world').getContext('2d'), probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = '#f4d09026'; const color = probe.fillStyle;
    const original = Object.fromEntries(['beginPath', 'moveTo', 'lineTo', 'fill'].map(key => [key, ctx[key]]));
    let points = [];
    const add = (x, y) => { const p = ctx.getTransform().transformPoint({ x, y }); points.push({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio }); };
    ctx.beginPath = function (...args) { points = []; return original.beginPath.apply(this, args); };
    ctx.moveTo = function (x, y) { add(x, y); return original.moveTo.call(this, x, y); };
    ctx.lineTo = function (x, y) { add(x, y); return original.lineTo.call(this, x, y); };
    ctx.fill = function (...args) { if (this.fillStyle === color && points.length >= 20) window.farmPreview = [...points]; return original.fill.apply(this, args); };
    window.restorePreviewCapture = () => { Object.assign(ctx, original); delete window.restorePreviewCapture; };
    window.farmPreview = null;
  });
}
async function assertPreview(page, site) {
  await page.waitForFunction(() => window.farmPreview?.length >= 20);
  const coverage = await page.evaluate(site => {
    const polygon = window.farmPreview, r = transport.renderer;
    const inside = p => {
      let result = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
      }
      return result;
    };
    let cells = 0;
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) cells += inside(r.worldToScreen(site.x + dx, site.y + dy));
    return { cells, outside: inside(r.worldToScreen(site.x + 7, site.y + 6)), vertices: polygon.length };
  }, site);
  assert.equal(coverage.cells, 49, 'the rendered field preview covers all 49 ground cells');
  assert.equal(coverage.outside, false, 'the rendered preview stops at the field boundary');
  return coverage;
}
async function place(page, site, mobile, preview = false) {
  const before = await state(page, site), p = await screen(page, site, { zoom: mobile ? .5 : 1 });
  if (preview) await capturePreview(page);
  let coverage;
  try {
    if (mobile) {
      await page.touchscreen.tap(p.x, p.y);
      if (site.cost >= 20000) {
        assert.equal((await state(page, site)).industry || (await state(page, site)).building, null, 'costly first tap only aims the site');
        assert.match(await page.locator('#placement-tip').innerText(), new RegExp(`${site.span} × ${site.span}`));
        if (preview) { coverage = await assertPreview(page, site); await page.screenshot({ path: `${output}/mobile-field-aim.png` }); }
        await page.locator('#placement-tip .tip-place').tap();
      }
    } else {
      await page.mouse.move(p.x, p.y);
      await page.waitForFunction(() => !document.querySelector('#placement-tip').hidden);
      assert.match(await page.locator('#placement-tip').innerText(), new RegExp(`${site.span} × ${site.span}`));
      if (preview) { coverage = await assertPreview(page, site); await page.screenshot({ path: `${output}/desktop-field-preview.png` }); }
      await page.mouse.click(p.x, p.y);
    }
  } finally { if (preview) await page.evaluate(() => window.restorePreviewCapture?.()); }
  const after = await state(page, site), built = after.industry || after.building?.building;
  assert.equal(built?.kind, site.kind, `${site.name} builds through the actual pointer gesture`);
  assert.equal(built.footprint, site.span);
  assert.equal(before.money - after.money, site.cost, 'one site charges its quoted cost exactly once');
  assert.equal(after.expenses - before.expenses, site.cost);
  if (after.industry) site.id = after.industry.id;
  return { before, after, coverage };
}
async function catalog(page, profile) {
  const counts = {};
  for (const group of ['homes', 'community', 'shops', 'services']) {
    await drawer(page); await page.locator('[data-category="towns"]').click(); await page.locator('#building-group').selectOption(group);
    assert.match(await page.locator('.panel-heading').filter({ has: page.locator('h2', { hasText: /^Buildings$/ }) }).innerText(), /32 types/);
    counts[group] = await page.locator('.building-card').count();
    const kinds = group === 'community' ? parks : group === 'shops' ? malls : [];
    for (const kind of kinds) {
      const card = page.locator(`.building-card[data-tool="${kind}"]`);
      await card.scrollIntoViewIfNeeded();
      assert.match(await card.locator('.building-tier').innerText(), group === 'community' ? /^Parks$/ : /^Shopping centres$/);
      assert.match(await card.locator('.building-price').innerText(), /[23] × [23]/);
      await card.click(); assert.equal(await card.getAttribute('aria-pressed'), 'true');
      await drawer(page);
    }
    if (kinds.length) await page.screenshot({ path: `${output}/${profile}-${group}-catalog.png` });
  }
  assert.deepEqual(counts, { homes: 9, community: 10, shops: 8, services: 5 });
  await drawer(page); await page.locator('[data-category="industry"]').click();
  for (const kind of farms) assert.match(await page.locator(`.industry-tool[data-tool="${kind}"] .tool-cost`).innerText(), /7 × 7/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'catalog stays within the viewport');
  return counts;
}
async function inspectSite(page, site, mobile) {
  await page.locator('#cancel-tool-button').click();
  await clickWorld(page, { x: site.x + site.span - 1, y: site.y + site.span - 1 }, mobile);
  await page.locator('#inspector h3').waitFor();
  assert.match(await page.locator('#inspector .eyebrow').innerText(), new RegExp(`${site.span} × ${site.span}`));
  if (parks.includes(site.kind)) {
    assert.match(await page.locator('#inspector .eyebrow').innerText(), /Parks$/);
    assert.equal(await page.locator('#inspector .property').count(), 0, 'public parks do not promise private rent');
  } else if (malls.includes(site.kind)) {
    assert.match(await page.locator('#inspector .eyebrow').innerText(), /Shopping centres$/);
    const property = page.locator('#inspector [data-property="owned"]');
    assert.match(await property.innerText(), /Rent[\s\S]*a month/);
    assert.match(await property.innerText(), /Deliver food to keep its shelves full/);
  }
  await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-${site.kind}-inspector.png` });
  await page.locator('#inspector [aria-label="Close inspector"]').click();
}
async function fieldLifecycle(page, site, mobile) {
  const corner = { x: site.x + 6, y: site.y + 6 }, before = await state(page, corner);
  await page.locator('#world').focus(); await page.keyboard.press('r');
  await clickWorld(page, corner, mobile);
  const blocked = await state(page, corner);
  assert.deepEqual(blocked, before, 'a road cannot invade a visually empty far field cell');
  await page.locator('#world').focus(); await page.keyboard.press('x');
  const cost = await page.evaluate(async p => (await import('./model.js')).constructionCost(transport.game, 'bulldoze', p.x, p.y), corner);
  if (mobile) await clickWorld(page, corner, true);
  else {
    await screen(page, { x: site.x + 3, y: site.y + 6 });
    const a = await screen(page, corner, { focus: false }), b = await screen(page, { x: site.x, y: site.y + 6 }, { focus: false });
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up();
  }
  const removed = await state(page, corner);
  assert.equal(removed.industry, null); assert.equal(before.money - removed.money, cost, 'one field demolition, including a drag across it, charges once');
  assert.equal(await page.evaluate(id => transport.game.industries.some(i => i.id === id), site.id), false);
  await page.locator('#world').focus(); await page.keyboard.press('Control+z');
  assert.deepEqual(await state(page, corner), before, 'normal construction Undo restores the whole field and account');
  assert.equal(await page.evaluate(async site => {
    const { industryAt } = await import('./model.js'); let count = 0;
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) count += industryAt(transport.game, site.x + dx, site.y + dy)?.id === site.id;
    return count;
  }, site), 49);
}
async function savedSites(page, sites) {
  return page.evaluate(async sites => {
    const { buildingAt } = await import('./building-sites.js'), { industryAt } = await import('./model.js');
    return sites.map(p => {
      const i = industryAt(transport.game, p.x, p.y), b = buildingAt(transport.game, p.x, p.y);
      return i ? { kind: i.kind, id: i.id, x: i.x, y: i.y, footprint: i.footprint, owner: i.owner } : { x: b.x, y: b.y, building: b.building };
    });
  }, sites);
}

try {
  for (const profile of [{ name: 'desktop', width: 1440, height: 1000, dpr: 1 }, { name: 'mobile', width: 390, height: 844, dpr: 2 }]) {
    if (process.env.TRANSPORT_PROFILE && process.env.TRANSPORT_PROFILE !== profile.name) continue;
    const mobile = profile.name === 'mobile', page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, hasTouch: mobile, isMobile: mobile });
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(url); await createWorldFromMenu(page, { seed: 1847 });
      assert.equal(await page.evaluate(() => transport.game.generationVersion), 9);
      const counts = await catalog(page, profile.name), sites = [];
      for (const kind of mobile ? [parks[0], malls[0]] : [...parks, ...malls]) {
        const site = await findSite(page, kind, { nearTown: true });
        await choose(page, kind, parks.includes(kind) ? 'community' : 'shops');
        await place(page, site, mobile); await inspectSite(page, site, mobile); sites.push(site);
      }
      let preview;
      for (const kind of mobile ? [farms[0]] : farms) {
        const site = await findSite(page, kind, { near: sites[0] }); await choose(page, kind);
        const placed = await place(page, site, mobile, kind === 'farm'); preview ||= placed.coverage;
        await inspectSite(page, site, mobile); sites.push(site);
        if (kind === 'farm') await fieldLifecycle(page, site, mobile);
      }
      // The normal calendar close updates mall outlets and monthly food wants.
      if (!mobile) {
        const nextMonth = await page.evaluate(() => (Math.floor(transport.game.day / 30) + 1) * 30 + 1);
        await page.locator('[data-speed="8"]').click();
        await page.waitForFunction(day => transport.game.day >= day, nextMonth, { timeout: 45000 });
        await page.locator('[data-speed="0"]').click();
        const town = await page.evaluate(async site => {
          const { townOf, marketView } = await import('./town-market.js'), city = townOf(transport.game, site.x, site.y), market = marketView(transport.game, city);
          return { x: city.x, y: city.y, food: market.wants.food, shops: market.shops };
        }, sites.find(p => malls.includes(p.kind)));
        assert.ok(town.food > 0); assert.ok(town.shops >= 24, 'all three built malls contribute their shop units');
        await page.evaluate(p => transport.inspect(p.x, p.y, 'city'), town);
        await page.locator('.town-economy summary').click();
        const food = page.locator('.town-economy .want').filter({ has: page.locator('.want-name', { hasText: /^Food$/ }) });
        assert.match(await food.locator('.want-figure').innerText(), new RegExp(`of ${town.food.toLocaleString('en-US')}$`));
        await page.screenshot({ path: `${output}/desktop-mall-food-wants.png` });
        await page.locator('#inspector [aria-label="Close inspector"]').click();
      }
      const checkpoint = await savedSites(page, sites);
      assert.equal(await page.evaluate(() => transport.persist()), true);
      await page.reload(); await loadAutosaveFromMenu(page);
      assert.deepEqual(await savedSites(page, sites), checkpoint, 'actual autosave restores every new park, mall and 7×7 farm');
      assert.equal(await page.evaluate(() => transport.game.generationVersion), 9);
      await page.evaluate(p => { transport.setTool('inspect'); transport.renderer.setZoom(.5); transport.renderer.focus(p.x, p.y); }, sites[0]);
      await page.mouse.move(2, 2); await page.screenshot({ path: `${output}/${profile.name}-new-neighborhood.png` });
      if (!mobile) {
        await page.waitForFunction(() => !document.querySelector('#toast-region .toast'), undefined, { timeout: 15000 });
        await page.evaluate(site => {
          const city = transport.game.cities[0], r = transport.renderer;
          r.setZoom(1); r.focus((site.x + 3 + city.x) / 2, (site.y + 3 + city.y) / 2);
        }, sites.find(p => p.kind === 'farm'));
        await page.screenshot({ path: `${output}/desktop-neighborhood-detail.png` });
      }
      results.push({ profile: profile.name, counts, preview, savedKinds: sites.map(p => p.kind), sites });
      console.log(`${profile.name}: real catalog, construction, far-corner inspection, field preview/blocking/demolition/Undo and autosave passed`);
    } catch (error) { await page.screenshot({ path: `${output}/${profile.name}-failure.png` }); throw error; }
    finally { await page.close(); }
  }
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, results, errors }, null, 2));
} finally { await browser.close(); }
