import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-building-actions-qa';
await mkdir(output, {recursive: true});
const errors = [];
const freeze = async page => {
  await page.evaluate(() => { window.actionFixture = {raf: requestAnimationFrame}; requestAnimationFrame = frame => { actionFixture.frame = frame; return 0; }; });
  await page.waitForFunction(() => Boolean(actionFixture.frame));
};
const advance = (page, seconds) => page.evaluate(async seconds => {
  const {updateGame} = await import('./sim.js'); for (let i = 0; i < seconds * 20; i++) updateGame(ashline.state, .05);
}, seconds);
async function select(page, id, mobile) {
  const p = await page.evaluate(id => {
    const e = ashline.state.entities.find(e => e.id === id), v = ashline.view, r = ashline.renderer;
    v.x = e.x + (e.kind === 'building' ? e.size / 2 : 0); v.y = e.y + (e.kind === 'building' ? e.size / 2 : 0); v.selected.clear();
    r.draw(ashline.state, v); return r.worldToScreen(v.x, v.y, v);
  }, id);
  if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
  assert.deepEqual(await page.evaluate(() => [...ashline.view.selected]), [id]);
}
const layout = async page => {
  const result = await page.evaluate(() => {
    const panel = document.querySelector('#selection-panel').getBoundingClientRect();
    const rects = ['repair-building', 'sell-building', 'building-actions-note'].map(id => document.getElementById(id).getBoundingClientRect());
    return {inside: rects.every(r => r.x >= panel.x && r.right <= panel.right + 1 && r.y >= panel.y && r.bottom <= panel.bottom + 1), fits: panel.x >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight, height: panel.height, screen: innerHeight};
  });
  assert(result.inside && result.fits, 'Building controls and visible prices stay inside the selection panel and viewport');
  assert(result.height / result.screen < .3, 'Contextual controls leave the battlefield dominant');
};
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'mobile' : 'desktop';
    const page = await browser.newPage({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 900}, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1});
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url); await page.waitForFunction(() => ashline.assets.ready);
    await page.locator('#seed').fill('BUILDING-ACTIONS'); await page.locator('#deploy').click();
    await page.waitForFunction(() => !ashline.paused && ashline.state.time > 0);
    if (await page.locator('#command-console').isVisible()) await page.locator('#command-toggle').click();
    await freeze(page);
    const ids = await page.evaluate(() => {
      const s = ashline.state; s.ai.nextThink = 1e12; s.minerals.fill(0); s.teams[0].credits = 2000;
      const own = type => s.entities.find(e => e.team === 0 && e.type === type);
      own('refinery').hp *= .5; own('core').hp *= .8;
      return Object.fromEntries(['refinery', 'core', 'rifle'].map(type => [type, own(type).id]));
    });
    await select(page, ids.rifle, mobile); assert(await page.locator('#repair-building').isHidden()); assert(await page.locator('#sell-building').isHidden());
    await select(page, ids.core, mobile); assert(await page.locator('#repair-building').isEnabled()); assert(await page.locator('#sell-building').isDisabled());
    assert.match(await page.locator('#building-actions-note').textContent(), /Nexus cannot be sold/);
    await layout(page); await page.screenshot({path: `${output}/${name}-nexus.png`});
    await select(page, ids.refinery, mobile);
    assert.match(await page.locator('#sell-label').textContent(), /SELL \+50/);
    assert.match(await page.locator('#building-actions-note').textContent(), /Hauler value excluded/);
    const before = await page.evaluate(id => ({hp: ashline.state.entities.find(e => e.id === id).hp, credits: ashline.state.teams[0].credits}), ids.refinery);
    await page.locator('#repair-building').click(); assert.equal(await page.locator('#repair-building').getAttribute('aria-pressed'), 'true');
    await advance(page, 2); await select(page, ids.refinery, mobile);
    const repaired = await page.evaluate(id => ({hp: ashline.state.entities.find(e => e.id === id).hp, credits: ashline.state.teams[0].credits}), ids.refinery);
    assert(Math.abs(repaired.hp - before.hp - 56) < 1e-7); assert(Math.abs(before.credits - repaired.credits - 10) < 1e-7);
    assert.match(await page.locator('#selection-detail').textContent(), /Repairing/);
    await layout(page); await page.evaluate(() => ashline.renderer.draw(ashline.state, ashline.view));
    await page.screenshot({path: `${output}/${name}-repairing.png`});
    await page.evaluate(() => { actionFixture.credits = ashline.state.teams[0].credits; ashline.state.teams[0].credits = 0; });
    await advance(page, .2); await select(page, ids.refinery, mobile);
    assert.match(await page.locator('#building-actions-note').textContent(), /Waiting for credits; repair resumes automatically/);
    assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).hp, ids.refinery), repaired.hp);
    await layout(page); await page.screenshot({path: `${output}/${name}-repair-waiting.png`});
    await page.evaluate(() => { ashline.state.teams[0].credits = actionFixture.credits; });
    await page.evaluate(() => { requestAnimationFrame = actionFixture.raf; requestAnimationFrame(actionFixture.frame); });
    await page.locator('#pause').click();
    const paused = await page.evaluate(id => ({hp: ashline.state.entities.find(e => e.id === id).hp, credits: ashline.state.teams[0].credits, time: ashline.state.time}), ids.refinery);
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(id => ({hp: ashline.state.entities.find(e => e.id === id).hp, credits: ashline.state.teams[0].credits, time: ashline.state.time}), ids.refinery), paused, 'Actual pause freezes repair HP, spending and simulation time');
    assert(await page.locator('#repair-building').isDisabled()); assert(await page.locator('#sell-building').isDisabled());
    await page.locator('#save-game').click(); assert.match(await page.locator('#save-status').textContent(), /saved/i);
    await page.reload(); await page.waitForFunction(() => ashline.assets.ready);
    await page.locator('#load-saved').click(); assert(await page.locator('#menu').evaluate(e => e.open));
    assert(await page.evaluate(id => ashline.paused && ashline.state.entities.find(e => e.id === id).repairing, ids.refinery));
    assert.deepEqual(await page.evaluate(id => ({hp: ashline.state.entities.find(e => e.id === id).hp, credits: ashline.state.teams[0].credits, time: ashline.state.time}), ids.refinery), paused, 'Briefing load restores the active repair exactly and remains paused');
    await page.locator('#resume').click(); await freeze(page);
    await select(page, ids.refinery, mobile); await page.locator('#repair-building').click();
    assert.equal(await page.locator('#repair-building').getAttribute('aria-pressed'), 'false');
    // Paid recruitment through the actual catalog must be included in the sale preview/refund.
    if (await page.locator('#command-console').isHidden()) await page.locator('#command-toggle').click();
    await page.locator('#train-tab').click(); await page.locator('.build-card[data-type="harvester"]').click(); await page.locator('.build-card[data-type="harvester"]').click();
    if (await page.locator('#command-console').isVisible()) await page.locator('#command-toggle').click();
    await advance(page, 1); await select(page, ids.refinery, mobile);
    assert.match(await page.locator('#building-actions-note').textContent(), /Sale includes 600 queued credits/);
    await layout(page); await page.screenshot({path: `${output}/${name}-sale-preview.png`});
    const sale = await page.evaluate(async id => {
      const {salvageValue} = await import('./sim.js'), s = ashline.state;
      return {refund: salvageValue(s.entities.find(e => e.id === id)), credits: s.teams[0].credits, haulers: s.entities.filter(e => e.team === 0 && e.type === 'harvester').map(e => ({id: e.id, cargo: e.cargo}))};
    }, ids.refinery);
    assert.equal(await page.locator('#sell-label').textContent(), `SELL +${sale.refund}`);
    await page.locator('#sell-building').click();
    assert(await page.evaluate(id => !ashline.state.entities.some(e => e.id === id), ids.refinery));
    assert.equal(await page.evaluate(() => ashline.state.teams[0].credits), sale.credits + sale.refund);
    assert.deepEqual(await page.evaluate(() => ashline.state.entities.filter(e => e.team === 0 && e.type === 'harvester').map(e => ({id: e.id, cargo: e.cargo}))), sale.haulers, 'Selling retains the actual included hauler and its cargo');
    assert(await page.locator('#selection-panel').isHidden(), 'Sold selection and its controls are removed immediately');
    await page.evaluate(() => ashline.renderer.draw(ashline.state, ashline.view)); await page.screenshot({path: `${output}/${name}-sold.png`});
    await page.close();
  }
  assert.deepEqual(errors, [], 'No browser or asset errors');
  console.log(`Building action browser checks passed: desktop/mobile selection, repair rate/cost/toggle, core protection, pause, save/reload, real paid queues, sale preview/refund, retained haulers, and responsive controls. Screenshots: ${output}`);
} finally { await browser.close(); }
