// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// A sector's first flight frame must not depend on how its artwork was prepared. Entering it cold, after
// previewing it in the menu until its preparation settled, or from the shop that built it in the background
// must give the same pixels (digested the way the GPU recovery check digests a frame).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/', gameUrl = new URL('game.js', url);
const hook = `\nwindow.__frameQA={W:()=>W,H:()=>H,render(){clock=7.25;previousScroll=state?.scroll||0;renderAlpha=1;draw();return {backend:ctx===gpu?'gpu':'native',pixels:(ctx===gpu?gpu.canvas:canvas).toDataURL('image/png').split(',')[1]};}};\n`;
const digest = pixels => createHash('sha256').update(Buffer.from(pixels, 'base64')).digest('hex').slice(0, 16);
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const errors = [];
async function open() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.route(request => request.origin === gameUrl.origin && request.pathname === gameUrl.pathname, async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()) + hook });
  });
  await page.addInitScript(() => {
    let id = 0; const frames = new Map(); window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; }; window.cancelAnimationFrame = i => frames.delete(i);
    localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
  });
  await page.goto(url); await page.waitForFunction(() => window.__frameQA && window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  await page.evaluate(() => { Math.random = () => .25; });
  return page;
}
// The state is cleared of enemies so the frame holds only terrain, scenery, the pilot and the effects of the sector.
const frame = () => {
  const s = tyran.state; s.enemies = []; s.bullets = []; s.events = []; tyran.fx.reset();
  const first = __frameQA.render(), second = __frameQA.render();
  return { backend: first.backend, stable: first.pixels === second.pixels, pixels: first.pixels, scene: tyran.scene, world: tyran.world.index };
};
try {
  const cold = new Map(), previewed = new Map(), shop = new Map();
  let page = await open();
  assert.equal(await page.evaluate(() => tyran.renderer.backend), 'webgl2', 'the batched renderer is active');
  for (let n = 0; n < 12; n++) cold.set(n, await page.evaluate(`(() => { tyran.launch(${n}, null, false); return (${frame})(); })()`));
  await page.close();
  page = await open();
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
    previewed.set(n, await page.evaluate(`(async () => {
      tyran.selectWorld(${n}); await tyran.world.prepareReady(__frameQA.W(), __frameQA.H());
      const queued = tyran.world.warmJobs.length; tyran.launch(${n}, null, false);
      const result = (${frame})(); tyran.pause(); document.querySelector('#menu-button').click(); return { ...result, queued };
    })()`));
  }
  await page.close();
  page = await open();
  await page.evaluate(() => { tyran.launch(0); });
  for (let n = 0; n < 9; n++) {
    await page.evaluate(async () => {
      const { spawnEnemy, killEnemy } = await import('./sim.js'), s = tyran.state;
      killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4);
      if (tyran.state.challenge && !tyran.state.challenge.done) { for (const e of tyran.state.enemies) if (e.challenge) e.gone = true; tyran.step(5); }
      for (let i = 0; i < 400 && tyran.scene !== 'hangar'; i++) await new Promise(resolve => setTimeout(resolve, 10));
      for (let i = 0; i < 600 && tyran.world.warmJobs.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    });
    shop.set(n + 1, await page.evaluate(`(() => { const queued = tyran.world.warmJobs.length; document.querySelector('#next-button').click(); return { ...(${frame})(), queued }; })()`));
  }
  await page.close();
  for (const [n, entry] of cold) {
    assert.equal(entry.backend, 'gpu', `sector ${n + 1} renders on the GPU`);
    assert.equal(entry.scene, 'playing');
    assert(entry.stable, `sector ${n + 1}: two renders of one state match`);
  }
  for (const [n, entry] of previewed) {
    assert.equal(entry.queued, 0, `sector ${n + 1}: the preview finished all of its preparation`);
    assert.equal(digest(entry.pixels), digest(cold.get(n).pixels), `sector ${n + 1}: a previewed sector opens on the same frame as a cold one`);
  }
  for (const [n, entry] of shop) {
    assert.equal(entry.queued, 0, `sector ${n + 1}: the shop finished all of its preparation`);
    assert.equal(entry.world, n % 10);
    assert.equal(digest(entry.pixels), digest(cold.get(n).pixels), `sector ${n + 1}: a sector launched from the shop opens on the same frame as a cold one`);
  }
  assert.deepEqual(errors, []);
  assert.equal(new Set([...cold.values()].map(entry => digest(entry.pixels))).size, 12, 'every sector opens on a different frame, the second cycle included');
  console.log(`First-frame QA passed: ${cold.size} cold, ${previewed.size} previewed and ${shop.size} shop launches open on identical frames.`);
} finally { await browser.close(); }
