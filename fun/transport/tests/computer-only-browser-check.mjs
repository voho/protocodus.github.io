// Unsupported devices stop at the entry message without loading a world or
// touching saves. Narrow windows and hybrid laptops still use computer controls.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium, devices } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-computer-only';
await mkdir(output, { recursive: true });
const errors = [];
const saved = { 'transport-save-v1':'existing-autosave', 'transport-save-slots-v1':'existing-slots', 'transport-scroll-mode':'pan' };
try {
  for (const [name, options] of [
    ['phone-portrait', devices['iPhone 13']],
    ['phone-landscape', { ...devices['Pixel 7'], viewport:{ width:915, height:412 } }],
    ['tablet', devices['iPad Pro 11']],
    ['touch-only', { viewport:{ width:1280, height:800 }, hasTouch:true }],
    ['mobile-with-mouse', { viewport:{ width:1280, height:800 }, userAgent:devices['Pixel 7'].userAgent }],
  ]) {
    const page = await browser.newPage(options);
    const scripts = [];
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    page.on('request', request => { if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname); });
    await page.addInitScript(data => { for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value); }, saved);
    await page.goto(url);
    await page.locator('#computer-required').waitFor({ state:'visible' });
    assert.equal(await page.locator('body').innerText(), 'please use computer to play the game');
    assert.equal(await page.locator('#world, #start-menu, #loading-screen, #app').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.transport), 'undefined');
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), saved);
    assert.deepEqual(scripts.filter(path => !/\/(boot|computer-only)\.js$/.test(path)), [], 'game modules stay unloaded');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path:`${output}/${name}.png` });
    await page.reload();
    await page.locator('#computer-required').waitFor({ state:'visible' });
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))), saved);
    await page.close();
  }
  for (const [name, options] of [
    ['desktop', { viewport:{ width:1440, height:900 } }],
    ['narrow-computer', { viewport:{ width:650, height:800 } }],
    ['hybrid-laptop', { viewport:{ width:1280, height:800 }, hasTouch:true }],
  ]) {
    const page = await browser.newPage(options);
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    if (name === 'hybrid-laptop') await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const media = original(query);
        if (query === '(any-pointer: fine)') Object.defineProperty(media, 'matches', { value:true });
        return media;
      };
    });
    await page.goto(url);
    await page.locator('#start-create').waitFor({ state:'visible' });
    assert.equal(await page.locator('#computer-required').isVisible(), false);
    assert.equal(await page.locator('#start-menu').evaluate(el => el.open), true);
    assert.equal(await page.evaluate(() => typeof window.transport), 'undefined', 'computer menu still precedes gameplay');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Computer-only entry passed: phones, tablet, touch-only device, mobile mouse, narrow desktop and hybrid laptop; saves preserved and no game startup on unsupported devices.');
} finally { await browser.close(); }
