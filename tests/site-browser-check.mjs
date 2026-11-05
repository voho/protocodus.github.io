// Responsive presentation and real CTA checks. External services are always
// stubbed: this suite never sends analytics or loads a real media embed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(process.env.SITE_QA_OUTPUT || resolve(root, 'test-results/site-qa'));
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('path');
    let info = await stat(path);
    if (info.isDirectory()) { path = resolve(path, 'index.html'); info = await stat(path); }
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) { res.writeHead(416).end(); return; }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      createReadStream(path, { start, end }).on('error', () => res.destroy()).pipe(res);
    } else {
      res.setHeader('Content-Length', info.size);
      createReadStream(path).on('error', () => res.destroy()).pipe(res);
    }
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const directories = await readdir(resolve(root, 'product'), { withFileTypes: true });
const productRoutes = [];
for (const entry of directories) {
  if (!entry.isDirectory()) continue;
  if (await stat(resolve(root, 'product', entry.name, 'index.html')).catch(() => null)) productRoutes.push(`/product/${entry.name}/`);
}
assert.ok(productRoutes.includes('/product/rill/'), 'RILL must be a published product route');
const allRoutes = ['/', ...productRoutes.sort()];
const cases = [
  ...[390, 1440].flatMap(width => allRoutes.map(route => ({ width, route }))),
  ...[320, 768].flatMap(width => ['/', '/product/rill/', '/product/acustra/'].map(route => ({ width, route }))),
];
const issues = [], reports = [], externalRequests = new Set();
let browser, page, current = 'startup';
const check = (condition, message) => { if (!condition) issues.push(`${current}: ${message}`); };
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => { window.protocodusAnalyticsConfig = { debug: true }; });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    externalRequests.add(url.origin);
    const script = route.request().resourceType() === 'script';
    return route.fulfill({ status: 200, contentType: script ? 'text/javascript' : 'text/html', body: script ? '' : '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Offline media preview</title></head><body style="margin:0;background:#101416;color:#b8c8bf;font:13px system-ui;display:grid;place-content:center;min-height:100vh">Media player · offline check</body></html>' });
  });
  page = await context.newPage();
  page.on('pageerror', error => issues.push(`${current}: runtime error: ${error.message}`));
  page.on('download', () => issues.push(`${current}: a QA click unexpectedly started a download`));
  page.on('response', response => {
    if (response.url().startsWith(origin + '/') && response.status() >= 400) issues.push(`${current}: HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  for (const { width, route } of cases) {
    current = `${route} at ${width}px`;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + route, { waitUntil: 'load' });
    await page.waitForFunction(() => window.protocodusAnalytics?.status().events.page_view === 1);
    await page.evaluate(async () => {
      await document.fonts.ready;
      // Exercise every local image, including those below the fold.
      document.querySelectorAll('img').forEach(image => { image.loading = 'eager'; });
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
      // Preserve the real click listeners while keeping external CTA checks local.
      document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (link && new URL(link.href, location.href).origin !== location.origin) event.preventDefault();
      });
    });
    const report = await page.evaluate(() => {
      const imageProblems = [];
      for (const image of document.images) {
        if (!image.complete || !image.naturalWidth || !image.naturalHeight) imageProblems.push(`${image.getAttribute('src')}: failed to decode`);
        const width = Number(image.getAttribute('width')), height = Number(image.getAttribute('height'));
        if (width && height && image.naturalHeight && Math.abs(width / height / (image.naturalWidth / image.naturalHeight) - 1) > 0.01) imageProblems.push(`${image.getAttribute('src')}: declared ${width}×${height}, intrinsic ${image.naturalWidth}×${image.naturalHeight}`);
        const style = getComputedStyle(image);
        if (image.getClientRects().length && style.objectFit === 'fill' && image.naturalHeight) {
          const renderedWidth = parseFloat(style.width), renderedHeight = parseFloat(style.height);
          if (renderedWidth > 50 && renderedHeight > 50 && Math.abs(renderedWidth / renderedHeight / (image.naturalWidth / image.naturalHeight) - 1) > 0.025) imageProblems.push(`${image.getAttribute('src')}: rendered aspect ratio distorts the image`);
        }
      }
      const frames = [...document.querySelectorAll('iframe.youtube-player, iframe.soundcloud-player')].map(frame => {
        const box = frame.getBoundingClientRect();
        return { provider: frame.classList.contains('youtube-player') ? 'youtube' : 'soundcloud', title: frame.title, id: frame.dataset.mediaId, width: box.width, height: box.height, left: box.left, right: box.right };
      });
      const overflow = document.documentElement.scrollWidth - innerWidth;
      const overflowElements = overflow > 1 ? [...document.querySelectorAll('main *')].filter(element => {
        const box = element.getBoundingClientRect(); return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
      }).slice(0, 8).map(element => `${element.tagName.toLowerCase()}.${element.className}`) : [];
      return { imageCount: document.images.length, imageProblems, frames, overflow, overflowElements, title: document.title, firstProduct: document.querySelector('#products .product-card')?.className };
    });
    check(report.overflow <= 1, `horizontal overflow ${report.overflow}px: ${report.overflowElements.join(', ')}`);
    for (const problem of report.imageProblems) check(false, problem);
    for (const frame of report.frames) {
      check(!!frame.title && !!frame.id, 'media embeds need an accessible title and stable analytics ID');
      check(frame.width >= 200 && frame.height >= 200, `${frame.provider} player is only ${frame.width}×${frame.height}`);
      check(frame.left >= -1 && frame.right <= width + 1, `${frame.provider} player escapes the viewport`);
    }
    if (route === '/') check(report.firstProduct?.includes('p-rill'), 'RILL must be the first product in the catalog');
    const menu = page.locator('.menu-toggle');
    if (await menu.isVisible()) {
      await menu.click();
      check(await menu.getAttribute('aria-expanded') === 'true', 'mobile menu does not open');
      check(await page.locator('#mobile-menu').isVisible(), 'mobile navigation is not visible');
      await page.keyboard.press('Escape');
      check(await menu.getAttribute('aria-expanded') === 'false', 'Escape does not close the mobile menu');
      check(await menu.evaluate(element => element === document.activeElement), 'closing the menu must restore keyboard focus');
    }
    const shop = page.locator('main [data-analytics-action="open_shop"]').first();
    if (await shop.count()) {
      const cta = await shop.getAttribute('data-analytics-cta');
      const before = await page.evaluate(id => window.dataLayer.filter(row => row.event === 'protocodus.shop_click' && row.analytics?.cta_id === id).length, cta);
      await shop.click();
      const after = await page.evaluate(id => window.dataLayer.filter(row => row.event === 'protocodus.shop_click' && row.analytics?.cta_id === id).length, cta);
      check(after === before + 1, 'shop CTA must produce exactly one semantic event');
    }
    if (route === '/product/rill/') {
      await page.locator('[data-analytics-cta="hero_download"]').click();
      check(new URL(page.url()).hash === '#download', 'RILL hero CTA must reach the download choices');
      const downloads = page.locator('#download a[data-analytics-action="download_native"]');
      check(await downloads.count() === 5, 'RILL must expose all five platform/architecture downloads');
      for (const link of await downloads.all()) {
        const cta = await link.getAttribute('data-analytics-cta');
        await link.click();
        const events = await page.evaluate(id => window.dataLayer.filter(row => row.event === 'protocodus.file_download' && row.analytics?.cta_id === id), cta);
        check(events.length === 1 && events[0].analytics.product_id === 'rill', `${cta} must report one RILL download intent`);
      }
    }
    await page.evaluate(() => scrollTo(0, 0));
    if (['/', '/product/rill/'].includes(route) || (route === '/product/acustra/' && [390, 1440].includes(width))) {
      const slug = route === '/' ? 'home' : route.split('/').filter(Boolean).join('-');
      await page.screenshot({ path: resolve(output, `${slug}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    reports.push({ route, width, ...report });
  }
  current = 'Homepage → RILL navigation';
  await page.goto(origin + '/');
  await page.locator('[data-analytics-cta="product_rill_details"]').click();
  check(new URL(page.url()).pathname === '/product/rill/', 'the featured RILL card must open its product page');
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ cases: reports, externalOriginsStubbed: [...externalRequests], issues }, null, 2));
  assert.deepEqual(issues, [], 'Responsive website checks failed (see test-results/site-qa/report.json)');
  console.log(`Website browser checks passed: ${cases.length} page/viewport cases, decoded imagery, media dimensions, keyboard menus, RILL navigation and five download CTAs; all third-party requests stubbed.`);
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ cases: reports, externalOriginsStubbed: [...externalRequests], issues, error: String(error), current }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
