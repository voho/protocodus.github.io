// Run: node tests/analytics-browser-check.mjs
// All third-party requests are stubbed: this test never sends QA events to Google.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + sep) && path !== root) throw new Error('path');
    let info = await stat(path);
    if (info.isDirectory()) { path = resolve(path, 'index.html'); info = await stat(path); }
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = +range[1], end = range[2] ? Math.min(+range[2], info.size - 1) : info.size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      createReadStream(path, { start, end }).pipe(res);
    } else { res.setHeader('Content-Length', info.size); createReadStream(path).pipe(res); }
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => { window.protocodusAnalyticsConfig = { debug: true }; });
  const requests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    requests.push(url.href);
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.js') || url.pathname === '/gtag/js' ? 'text/javascript' : 'text/html', body: '' });
  });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const events = () => page.evaluate(() => window.dataLayer.filter(row => row.event?.startsWith('protocodus.')));
  await page.goto(origin + '/?email=private%40example.com&utm_source=browser-check#private-seed');
  await page.waitForFunction(() => window.protocodusAnalytics?.isEnabled());
  let rows = await events();
  assert.equal(rows.filter(row => row.event === 'protocodus.page_view').length, 1);
  assert.equal(rows[0].analytics.page_location, origin + '/?utm_source=browser-check');
  assert.ok(requests.includes('https://www.googletagmanager.com/gtm.js?id=GTM-TZZVDH4B'));
  assert.ok(requests.includes('https://www.googletagmanager.com/gtag/js?id=G-0TEFG3XSN5'));
  assert.equal(await page.locator('script[src*="analytics-media.js"]').count(), 0, 'The homepage needs no demo module');
  await page.waitForFunction(() => window.dataLayer.some(row => row.event === 'protocodus.web_vital'));
  await page.evaluate(() => document.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); }));
  await page.locator('.p-maremba .store-link').click();
  rows = await events();
  assert.equal(rows.filter(row => row.event === 'protocodus.shop_click').length, 1);
  assert.equal(rows.find(row => row.event === 'protocodus.shop_click').analytics.product_id, 'maremba');
  await page.waitForFunction(() => window.dataLayer.some(row => row.event === 'protocodus.view_item_list'));

  await page.goto(origin + '/product/maremba/?token=secret');
  await page.waitForFunction(() => window.protocodusAnalytics?.isEnabled());
  rows = await events();
  assert.equal(rows.filter(row => row.event === 'protocodus.view_item').length, 1);
  assert.equal(rows.find(row => row.event === 'protocodus.view_item').analytics.items[0].item_id, 'maremba');
  assert.ok(!JSON.stringify(rows).includes('secret'));
  await page.locator('a[href="#listen"]').first().click();
  rows = await events();
  assert.equal(rows.filter(row => row.event === 'protocodus.select_item').length, 0);
  assert.ok(rows.some(row => row.event === 'protocodus.navigation_click'));

  await page.goto(origin + '/product/lamer/');
  await page.waitForFunction(() => window.protocodusAnalytics?.status().scripts.media === 'loaded');
  await page.locator('#lamer-video').evaluate(async video => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.3);
  await page.locator('#lamer-video').evaluate(video => video.pause());
  rows = await events();
  assert.equal(rows.filter(row => row.event === 'protocodus.video_start').length, 1);
  assert.equal(rows.filter(row => row.event === 'protocodus.video_pause').length, 1);
  assert.ok(rows.find(row => row.event === 'protocodus.video_pause').analytics.watched_seconds > 0, 'Pause reports actual watched duration');
  await page.locator('#lamer-video').evaluate(video => { video.currentTime = 72; });
  await page.waitForFunction(() => window.dataLayer.some(row => row.event === 'protocodus.video_seek'));
  assert.equal((await events()).filter(row => row.event === 'protocodus.video_progress').length, 0);

  await page.goto(origin + '/fun/zipper/#medium-analytics-private-seed');
  await page.waitForFunction(() => window.protocodusAnalytics?.isEnabled());
  rows = await events();
  assert.equal(rows.find(row => row.event === 'protocodus.page_view').analytics.game_name, 'zipper');
  assert.ok(!JSON.stringify(rows).includes('analytics-private-seed'));
  assert.equal(rows.filter(row => row.event === 'protocodus.game_start').length, 0, 'Opening the game is not an attempt');

  // Verify direct entry into every public HTML page, including future pages.
  // Their game engines have independent lifecycle tests; this loop isolates the
  // shared analytics boot sequence from expensive terrain/model loading.
  await page.route(url => url.pathname.startsWith('/fun/') && url.pathname.endsWith('.js'),
    route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const files = await readdir(root, { recursive: true });
  const pages = files.filter(file => file.endsWith('.html') && !file.split(sep).some(part =>
    part.startsWith('.') || ['assets', 'tests', 'docs', 'tools', 'node_modules'].includes(part)));
  assert.ok(pages.length >= 18);
  for (const file of pages) {
    await page.goto(origin + '/' + file.replaceAll(sep, '/'));
    await page.waitForFunction(() => {
      const status = window.protocodusAnalytics?.status();
      return status?.scripts.ga4 === 'loaded' && status.scripts.gtm === 'loaded' && status.scripts.performance === 'loaded';
    });
    const status = await page.evaluate(() => window.protocodusAnalytics.status());
    assert.equal(status.enabled, true, file);
    assert.equal(status.events.page_view, 1, `${file}: exactly one page view`);
    assert.equal(status.measurementId, 'G-0TEFG3XSN5', file);
    assert.equal(status.tagManagerId, 'GTM-TZZVDH4B', file);
    const demos = await page.locator('video, audio, iframe.soundcloud-player').count();
    if (demos) {
      await page.waitForFunction(() => window.protocodusAnalytics.status().scripts.media === 'loaded');
    } else assert.equal(status.scripts.media, undefined, `${file}: no unnecessary media module`);
    assert.equal(await page.locator('script[src*="/assets/js/analytics.js"]').count(), 1, file);
    assert.equal(await page.locator('script[src*="analytics-performance.js"]').count(), 1, file);
  }
  assert.deepEqual(failures, []);
  console.log(`Browser analytics passed: all ${pages.length} public pages, centralized/conditional loaders, diagnostics, Web Vitals, product/shop/navigation events, native playback/seek/coverage and game-page privacy.`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
