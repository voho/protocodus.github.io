import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-compact-play';
await mkdir(output, { recursive: true });
const errors = [];
async function menu(page) { await page.locator('#game-menu-button').click(); await page.locator('#game-menu').waitFor({ state: 'visible' }); }
try {
  for (const profile of [{ name:'desktop', width:1440, height:1000 }, { name:'laptop', width:1024, height:768 }]) {
    const page = await browser.newPage({ viewport:profile, deviceScaleFactor:1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.locator('#start-create').waitFor();
    assert.equal(await page.evaluate(() => !!window.transport), false, 'Menu precedes game construction');
    await page.locator('#start-create').click();
    await page.waitForFunction(() => window.transport && !document.querySelector('#loading-screen').open);
    await page.evaluate(() => transport.setSpeed(0));
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('.sidebar').evaluate(el => el.inert), true);
    assert.equal(await page.locator('.minimap-wrap').isVisible(), false);
    assert.equal(await page.locator('.statusbar').isVisible(), false);
    const layout = await page.evaluate(() => ({
      header:document.querySelector('.topbar').getBoundingClientRect().height,
      map:document.querySelector('#world').getBoundingClientRect().width,
      width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(layout.header, profile.width <= 720 ? 84 : 52); assert.equal(layout.map, layout.width); assert.equal(layout.overflow, false);
    await page.screenshot({ path:`${output}/${profile.name}-play.png`, animations:'disabled' });

    await page.locator('.main-nav [data-build-area="network"]').click();
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false');
    await page.locator('.main-nav [data-build-area="network"]').click();
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true');
    await page.locator('.main-nav [data-build-area="network"]').click();
    await page.screenshot({ path:`${output}/${profile.name}-build.png`, animations:'disabled' });
    await page.locator('#panel-content [data-tool="road"]').click();
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true', 'Choosing construction frees the map');
    assert.equal(await page.locator('#active-tool-bar').isVisible(), true);
    assert.equal(await page.locator('#active-tool-hint').innerText(), 'Drag to build. Necessary leveling included in the price.');
    await page.keyboard.press('s');
    assert.match(await page.locator('#active-tool-hint').innerText(), /4 tiles/, 'the stop hint names the catchment');
    await page.locator('#cancel-tool-button').click();
    assert.equal(await page.locator('#active-tool-bar').isVisible(), false);

    await openGameAction(page, 'overview-button');
    assert.equal(await page.locator('.minimap-wrap').isVisible(), true);
    assert.equal(await page.locator('#game-menu').isVisible(), false);
    assert.ok(await page.locator('#minimap').evaluate(el => el.width > 10 && el.height > 10));
    await page.locator('#close-minimap').click();
    assert.equal(await page.locator('.minimap-wrap').isVisible(), false);

    await openGameAction(page, 'layers-button');
    assert.equal(await page.locator('#layers-panel').isVisible(), true);
    assert.equal(await page.locator('#game-menu').isVisible(), false);
    assert.equal(await page.locator('#layers-button').getAttribute('aria-expanded'), 'true', 'the direct map control reflects its panel');
    assert.equal(await page.locator('#layers-panel [data-layer]').count(), 15, 'all layer preferences remain available');
    assert.equal(await page.locator('#layers-panel [data-layer]:visible').count(), 6, 'Essentials shows the common six switches');
    const layerCompany = await page.evaluate(() => JSON.stringify(transport.game));
    await page.screenshot({ path:`${output}/${profile.name}-layers-essentials.png`, animations:'disabled' });
    await page.locator('[data-layer-page="more"]').click();
    assert.equal(await page.locator('#layers-panel [data-layer]:visible').count(), 9, 'More layers contains the remaining switches');
    const weather = page.locator('[data-layer="weather"]'), weatherBefore = await weather.isChecked();
    await weather.setChecked(!weatherBefore);
    assert.equal(await page.evaluate(() => transport.renderer.getLayers().weather), !weatherBefore, 'the less common switches still update the map');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('transport-visibility-v1')).weather), !weatherBefore, 'preferences persist across layer pages');
    assert.equal(await page.evaluate(() => JSON.stringify(transport.game)), layerCompany, 'changing layer pages and switches preserves the company');
    await page.screenshot({ path:`${output}/${profile.name}-layers-more.png`, animations:'disabled' });
    await page.locator('[data-layers-close]').click();
    await page.waitForFunction(() => document.activeElement.id === 'layers-button');
    await openGameAction(page, 'menu-layers-button');
    assert.equal(await page.locator('#layers-panel').isVisible(), true, 'Menu → Map retains the Layers alternative');
    assert.equal(await page.locator('#game-menu').isVisible(), false);
    assert.equal(await page.locator('[data-layer-page="more"]').getAttribute('aria-pressed'), 'true', 'reopening Layers remembers the selected page');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-layer-screen]')?.dataset.layerScreen), 'more', 'reopening focuses a visible switch');
    await weather.setChecked(weatherBefore);
    await page.locator('[data-layer-page="essentials"]').click();
    assert.equal(await page.locator('#layers-panel [data-layer]:visible').count(), 6);
    await page.locator('[data-layers-close]').click();
    await page.waitForFunction(() => document.activeElement.id === 'layers-button');
    await page.locator('#world').focus(); await page.keyboard.press('l');
    assert.equal(await page.locator('#layers-panel').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement.id === 'layers-button');

    await openGameAction(page, 'map-options-button');
    assert.equal(await page.locator('#map-options').isVisible(), true);
    await page.locator('#grid-button').click();
    assert.equal(await page.locator('#map-options').isVisible(), false);
    await page.waitForFunction(() => document.activeElement.id === 'game-menu-button');
    await menu(page); await page.screenshot({ path:`${output}/${profile.name}-menu.png`, animations:'disabled' });
    await openGameAction(page, 'help-button');
    assert.equal(await page.locator('#modal').isVisible(), true);
    await page.locator('#modal .close-modal').click();
    await openGameAction(page, 'main-menu-button');
    await page.locator('#start-resume').waitFor();
    await page.locator('#start-resume').click();
    await page.waitForFunction(() => !document.querySelector('#start-menu')?.open);
    console.log(`${profile.name}: collapsed playfield, tool drawer, map layers, mini map, focus restoration, menus and resume passed`);
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log(`Compact gameplay checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
