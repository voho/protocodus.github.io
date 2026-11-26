import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright';

const base = 'https://protocodus.cz';
const form = process.argv[2];
const mobile = form === 'mobile';
const engine = mobile ? webkit : chromium;
const browser = await engine.launch();
try {
  const context = await browser.newContext(mobile ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 } });
  // Keep all local production traffic real. Don't emit test analytics or fetch embedded media.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === base || url.protocol === 'blob:' || url.protocol === 'data:' ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const failures = [];
  page.on('pageerror', e => failures.push(String(e)));
  async function navigate(path) {
    const response = await page.goto(base + path, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200, response.url());
  }
  async function follow(selector, destination) {
    const link = page.locator(selector);
    assert.equal(await link.count(), 1, selector);
    assert.equal(await link.getAttribute('href'), destination, selector);
    await link.scrollIntoViewIfNeeded();
    await link.waitFor({ state: 'visible' });
    if (mobile) await link.tap();
    else await link.click();
    await page.waitForURL(base + destination, { waitUntil: 'domcontentloaded' });
    console.log('CLICK', form, selector, '->', page.url());
  }
  async function ready(slug) {
    const name = slug === 'keyra' ? 'Keyra' : 'Oregana';
    await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor({ state: 'visible' });
    await page.locator('#keyboard [data-note]').first().waitFor({ state: 'attached' });
    await page.locator('#audio-start').waitFor({ state: 'visible' });
    const keys = await page.locator('#keyboard [data-note]').count();
    const presets = await page.locator(slug === 'keyra' ? '#presets button' : '#preset-bank button').count();
    assert(keys > 20, 'keybed missing ' + keys);
    assert.equal(presets, slug === 'keyra' ? 13 : 77);
  }
  for (const slug of ['keyra', 'oregana']) {
    const player = '/fun/' + slug + '/';
    const product = '/product/' + slug + '/';
    const card = '#products .p-' + slug;
    for (const target of [' .product-shot', ' h3 a', ' [data-analytics-cta="product_' + slug + '_play"]']) {
      await navigate('/#products');
      await follow(card + target, player);
      await ready(slug);
    }
    await navigate('/#products');
    await follow(card + ' [data-analytics-cta="product_' + slug + '_details"]', product);
    await follow('[data-analytics-cta="hero_play"]', player);
    await ready(slug);
    await navigate(product);
    await follow('[data-analytics-cta="availability_play"]', player);
    await ready(slug);
    for (const path of ['/#fun', '/fun/']) {
      await navigate(path);
      await follow('[data-analytics-cta="instrument_' + slug + '"]', player);
      await ready(slug);
    }
    console.log('VERIFIED', form, slug, 'through product thumbnails, titles, play buttons, details and hero buttons, availability rows, homepage and directory Fun cards');
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
