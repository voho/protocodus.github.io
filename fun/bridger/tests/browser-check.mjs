// Run with: node fun/bridger/tests/browser-check.mjs
// Plays Bridger in Chromium the way a child would: the road is already laid,
// a beam from a bolt, a failed test, Show solution and a crossing,
// on a desktop and a phone. Screenshots land in test-results/bridger/.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(root, 'test-results/bridger');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + sep)) throw new Error('path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path);
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 760 } }, { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext({ viewport: device.viewport, hasTouch: device.hasTouch, isMobile: device.isMobile });
    await context.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/fun/bridger/#easy-browsercheck`);
    await page.waitForFunction(() => document.body.classList.contains('ready') && !document.body.classList.contains('busy'));
    // The first visit opens How to play.
    assert.ok(await page.locator('[data-dialog="help"]').evaluate((d) => d.open), `${device.name}: help opens on the first visit`);
    await page.screenshot({ path: `${output}/${device.name}-help.png` });
    await page.click('[data-dialog="help"] button');

    const at = (gx, gy) => page.evaluate(([x, y]) => [bridger.view.sx(x * 2), bridger.view.sy(y * 2)], [gx, gy]);
    const drag = async (from, to) => {
      const [x1, y1] = await at(...from), [x2, y2] = await at(...to);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 8 });
      await page.mouse.up();
    };
    const count = () => page.evaluate(() => bridger.members.length);
    const span = await page.evaluate(() => bridger.mission.span);

    assert.equal(await count(), span, `${device.name}: the road is laid across in 2 m pieces`);
    await page.click('[data-tool="wood"]');
    await drag([0, 0], [1, 1]);
    assert.equal(await count(), span + 1, `${device.name}: a drag from a bolt adds one beam`);
    await page.click('[data-tool="erase"]');
    await page.mouse.click(...(await at(0.5, 0)));
    assert.equal(await count(), span + 1, `${device.name}: the road can't be erased`);
    await page.screenshot({ path: `${output}/${device.name}-build.png` });

    // A bare road fails; the peak stress stays on the drawing afterwards.
    await page.click('[data-action="test"]');
    await page.waitForFunction(() => bridger.sim?.result, null, { timeout: 30000 });
    const failed = await page.evaluate(() => bridger.sim.result);
    await page.screenshot({ path: `${output}/${device.name}-test.png` });
    await page.click('[data-action="test"]');
    assert.notEqual(failed, 'win', `${device.name}: road alone does not carry the vehicle`);

    await page.click('[data-action="solution"]');
    await page.waitForFunction(() => !document.body.classList.contains('busy'));
    const cost = await page.evaluate(() => Number(document.querySelector('[data-cost]').textContent.replace(/\D/g, '')));
    const budget = await page.evaluate(() => bridger.mission.budget);
    assert.ok(cost > 0 && cost <= budget, `${device.name}: Show solution builds within budget`);
    await page.click('[data-action="test"]');
    await page.waitForFunction(() => bridger.sim?.result, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => bridger.sim.result), 'win', `${device.name}: the solution carries the vehicle across`);
    await page.waitForFunction(() => document.querySelector('[data-dialog="win"]').open, null, { timeout: 5000 });
    await page.screenshot({ path: `${output}/${device.name}-win.png` });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `${device.name}: no sideways scrolling`);
    assert.deepEqual(errors, [], `${device.name}: no page errors`);
    await context.close();
  }
  console.log(`Bridger browser checks passed: laid road, drawing, failed and passing tests, Show solution, desktop and phone. Screenshots in ${output}.`);
} finally {
  await browser.close();
  server.close();
}
