import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-compact-play';
await mkdir(output, { recursive: true });
const errors = [];
async function menu(page) { await page.locator('#game-menu-button').click(); await page.locator('#game-menu').waitFor({ state: 'visible' }); }
try {
  for (const profile of [{ name:'desktop', width:1440, height:1000 }, { name:'mobile', width:390, height:844 }]) {
    const page = await browser.newPage({ viewport:profile, deviceScaleFactor:1, isMobile:profile.name==='mobile', hasTouch:profile.name==='mobile' });
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
    assert.equal(layout.header, 52); assert.equal(layout.map, layout.width); assert.equal(layout.overflow, false);
    await page.screenshot({ path:`${output}/${profile.name}-play.png`, animations:'disabled' });

    if (profile.name === 'desktop') {
      await page.locator('.main-nav [data-view="build"]').click();
      assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false');
      await page.locator('.main-nav [data-view="build"]').click();
      assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true');
      await page.locator('.main-nav [data-view="build"]').click();
    } else {
      await page.locator('.mobile-panel-toggle').click();
      assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false');
    }
    await page.screenshot({ path:`${output}/${profile.name}-build.png`, animations:'disabled' });
    await page.locator('#panel-content [data-tool="road"]').click();
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true', 'Choosing construction frees the map');
    assert.equal(await page.locator('#active-tool-bar').isVisible(), true);
    await page.locator('#cancel-tool-button').click();
    assert.equal(await page.locator('#active-tool-bar').isVisible(), false);

    await menu(page); await page.locator('#overview-button').click();
    assert.equal(await page.locator('.minimap-wrap').isVisible(), true);
    assert.equal(await page.locator('#game-menu').isVisible(), false);
    assert.ok(await page.locator('#minimap').evaluate(el => el.width > 10 && el.height > 10));
    await page.locator('#close-minimap').click();
    assert.equal(await page.locator('.minimap-wrap').isVisible(), false);

    await menu(page); await page.locator('#layers-button').click();
    assert.equal(await page.locator('#layers-panel').isVisible(), true);
    assert.equal(await page.locator('#game-menu').isVisible(), false);
    await page.locator('[data-layers-close]').click();
    await page.waitForFunction(() => document.activeElement.id === 'game-menu-button');
    await page.locator('#world').focus(); await page.keyboard.press('l');
    assert.equal(await page.locator('#layers-panel').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement.id === 'game-menu-button');

    await menu(page); await page.locator('#map-options-button').click();
    assert.equal(await page.locator('#map-options').isVisible(), true);
    await page.locator('#grid-button').click();
    assert.equal(await page.locator('#map-options').isVisible(), false);
    await page.waitForFunction(() => document.activeElement.id === 'game-menu-button');
    await menu(page); await page.screenshot({ path:`${output}/${profile.name}-menu.png`, animations:'disabled' });
    await page.locator('#help-button').click();
    assert.equal(await page.locator('#modal').isVisible(), true);
    await page.locator('#modal .close-modal').click();
    await menu(page); await page.locator('#main-menu-button').click();
    await page.locator('#start-resume').waitFor();
    await page.locator('#start-resume').click();
    await page.waitForFunction(() => !document.querySelector('#start-menu')?.open);
    if (profile.name === 'mobile') {
      await page.setViewportSize({ width:320, height:640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const boxes = await page.locator('.mobile-panel-toggle,.hud-finance-wrap,.date-block,.compact-menu-wrap').evaluateAll(els => els.map(el => { const b=el.getBoundingClientRect(); return {left:b.left,right:b.right}; }));
      for (let i=1;i<boxes.length;i++) assert.ok(boxes[i].left >= boxes[i-1].right-1, 'Header controls do not overlap');
      await page.screenshot({ path:`${output}/small-mobile-play.png`, animations:'disabled' });
    }
    console.log(`${profile.name}: collapsed playfield, tool drawer, map layers, mini map, focus restoration, menus and resume passed`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Compact gameplay checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
