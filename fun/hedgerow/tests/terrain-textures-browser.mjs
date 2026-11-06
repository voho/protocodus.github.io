// Optional bounded GPU gate. Run serially with other game/browser checks:
// node fun/hedgerow/tests/terrain-textures-browser.mjs
// CHROMIUM_PATH selects a system browser; HEDGEROW_TEXTURE_REPORT selects JSON.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_TEXTURE_REPORT || 'work/qa/terrain-textures-browser.json');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('path');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('file');
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': info.size });
    createReadStream(path).pipe(response);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { pageErrors: [], messages: [], httpErrors: [] };
let browser;
try {
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, serviceWorkers: 'block' });
  page.on('pageerror', error => report.pageErrors.push(error.stack));
  page.on('console', message => { if (['warning', 'error'].includes(message.type()) && !message.text().includes('status of 404')) report.messages.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) report.httpErrors.push(response.url()); });
  await page.goto(origin + '/fun/hedgerow/tests/fixtures/terrain-textures.html');
  await Promise.race([
    page.waitForFunction(() => window.arrayDone, null, { timeout: 120000 }),
    page.waitForEvent('pageerror', { timeout: 120000 }).then(error => { throw error; }),
  ]);
  Object.assign(report, await page.evaluate(() => window.arrayProbe));
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.httpErrors, []); assert.deepEqual(report.errors, []);
  assert.ok(!report.messages.some(message => /INVALID_|OUT_OF_MEMORY|Trying to use/.test(message)), 'WebGL operations must not report invalid operations or resource overflow');
  for (const key of ['fixtures', 'real']) {
    assert.ok(report[key].checks.length >= 8);
    assert.ok(report[key].checks.every(check => check.different === 0), `${key}: exact RGBA identity at every layer/mip`);
    assert.equal(report[key].memoryAfter, report[key].memoryBefore - 6, `${key}: eight source allocations replaced by two arrays`);
    assert.equal(report[key].retainedSourceGPUProperties, 0);
    assert.equal(report[key].glError, 0);
  }
  if (!report.restoration.unsupported) {
    assert.equal(report.restoration.different, 0, 'all terrain texels survive forced context recovery');
    assert.equal(report.restoration.glError, 0);
  }
  assert.equal(report.dispose.glError, 0, 'post-recovery disposal has no stale-context GL deletes');
  assert.equal(report.dispose.textures, 0);
  console.log(`Terrain GPU arrays: ${report.real.checks.length} real layer/mip checks exact; source cleanup, recovery and final disposal pass`);
} catch (error) { report.failure = error.stack; throw error; }
finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise(done => server.close(done));
}
