// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs TYRAN_URL=.../fun/tyran/ node this file.
// Measures what entering a sector costs the main thread, from a Chrome trace (every task the page ran) and the
// requestAnimationFrame intervals around each step, and prints one line per step plus a summary per kind of step:
//   menu    selectWorld(n) on the title screen, then Practice (launch) after the preview settled
//   hangar  the shop that follows a cleared sector (it prepares the next sector), then Next
//   cold    tyran.launch(n) straight from a flight, with nothing prepared (launch stays synchronous, so this one
//           still costs the whole preparation; it is reported, never judged)
// Environment: TYRAN_ENTRY_FLOWS (default menu,hangar,cold), TYRAN_ENTRY_SECTORS (comma list), TYRAN_DWELL (ms in the
// shop before Next, default 4000), TYRAN_CPU_RATE (CPU throttle, e.g. 4), TYRAN_ENTRY_ASSERT=1 to enforce the limits.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const flows = (process.env.TYRAN_ENTRY_FLOWS || 'menu,hangar,cold').split(',');
const picked = process.env.TYRAN_ENTRY_SECTORS?.split(',').map(Number), dwell = Number(process.env.TYRAN_DWELL || 4000), rate = Number(process.env.TYRAN_CPU_RATE || 1);
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
    window.__frames = { list: [], on: false };
    const loop = time => { if (__frames.on) __frames.list.push(time); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });

  // One step: trace it from a mark before to a mark after, keep the main thread's tasks that began after the optional
  // setup, and pair them with the frame intervals the page saw.
  async function step(name, action, settle, setup = '', switching = false) {
    const events = [];
    const collect = ({ value }) => { for (const e of value) if (e.name === 'ThreadControllerImpl::RunTask' || e.name?.startsWith('w:')) events.push(e); };
    cdp.on('Tracing.dataCollected', collect);
    const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: ['toplevel', 'blink.user_timing'] }, transferMode: 'ReportEvents' });
    const page_ = await page.evaluate(`(async () => {
      __frames.list.length = 0; __frames.on = true; performance.mark('w:${name}:start');
      let go = 0; ${setup ? `await (async () => { ${setup} })(); performance.mark('w:${name}:go'); go = performance.now();` : ''}
      const t0 = performance.now(), hash = tyran.world.levelHash; await (async () => { ${action} })(); const sync = performance.now() - t0;
      // Wait out the step, noting when the world's preparation queue ran dry (once the shop has switched to the next sector).
      const settled = () => (${switching} ? tyran.world.levelHash !== hash : true) && !tyran.world.warmJobs.length;
      let ready = settled() ? sync : -1; const until = t0 + ${settle};
      while (performance.now() < until) { await new Promise(resolve => setTimeout(resolve, 20)); if (ready < 0 && settled()) ready = performance.now() - t0; }
      performance.mark('w:${name}:end'); __frames.on = false;
      return { frames: __frames.list.slice(), go, sync, ready, scene: tyran.scene };
    })()`);
    await cdp.send('Tracing.end'); await done; cdp.off('Tracing.dataCollected', collect);
    const start = events.find(e => e.name === `w:${name}:start`), end = events.find(e => e.name === `w:${name}:end`), go = events.find(e => e.name === `w:${name}:go`);
    assert(start && end, `${name}: trace marks`);
    const tasks = events.filter(e => e.name === 'ThreadControllerImpl::RunTask' && e.ph === 'X' && e.pid === start.pid && e.tid === start.tid && (go ? e.ts >= go.ts : e.ts + e.dur > start.ts) && e.ts < end.ts)
      .map(e => ({ wall: e.dur / 1000, cpu: (e.tdur ?? e.dur) / 1000 }));
    assert(tasks.length, `${name}: the trace holds the page's main-thread tasks`);
    const gaps = page_.frames.filter(time => !go || time >= page_.go).map((time, i, list) => i ? time - list[i - 1] : 0).slice(1);
    const worst = tasks.reduce((a, b) => b.wall > a.wall ? b : a, { wall: 0, cpu: 0 });
    const row = { name, sync: +page_.sync.toFixed(1), ready: +page_.ready.toFixed(0), tasks: tasks.length, worstTask: +worst.wall.toFixed(1), worstCpu: +worst.cpu.toFixed(1), over16: tasks.filter(t => t.wall > 16).length, over50: tasks.filter(t => t.wall > 50).length,
      busy: +tasks.reduce((sum, t) => sum + t.wall, 0).toFixed(0), worstFrame: +Math.max(0, ...gaps).toFixed(1), late: gaps.filter(g => g > 25).length, veryLate: gaps.filter(g => g > 50).length };
    results.push(row); console.log(JSON.stringify(row)); return row;
  }
  await step('warm', 'await 0;', 700); results.pop(); // the first traced step pays for the tracing session itself

  if (flows.includes('menu')) for (const n of picked || [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
    await step(`menu-select-${n}`, `tyran.selectWorld(${n});`, 1800);
    await step(`menu-practice-${n}`, `tyran.launch(${n}, null, false);`, 1500);
    await page.evaluate(() => { tyran.pause(); document.querySelector('#menu-button').click(); }); await page.waitForTimeout(600);
  }
  if (flows.includes('hangar')) {
    await page.evaluate(() => { tyran.launch(0); for (const p of tyran.state.players) p.hurt = 1e8; }); await page.waitForTimeout(500);
    for (const n of picked || [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      // Not measured: defeat the guardian, finish any bonus stage, and wait until the shop is the scene.
      const setup = `const { spawnEnemy, killEnemy } = await import('./sim.js'); const s = tyran.state;
        killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4);
        if (tyran.state.challenge && !tyran.state.challenge.done) { for (const e of tyran.state.enemies) if (e.challenge) e.gone = true; tyran.step(5); }
        if (document.body.dataset.scene !== 'hangar') await new Promise((resolve, reject) => {
          const watch = new MutationObserver(() => { if (document.body.dataset.scene === 'hangar') { watch.disconnect(); resolve(); } });
          watch.observe(document.body, { attributes: true, attributeFilter: ['data-scene'] }); setTimeout(() => reject(new Error('the shop never opened')), 20000);
        });`;
      await step(`hangar-prepare-${n}`, 'await 0;', dwell, setup, true);
      await step(`hangar-next-${n + 1}`, `document.querySelector('#next-button').click();`, 1500);
      await page.evaluate(() => { for (const p of tyran.state.players) p.hurt = 1e8; });
    }
  }
  if (flows.includes('cold')) for (const n of picked || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) await step(`cold-launch-${n}`, `tyran.launch(${n}); for (const p of tyran.state.players) p.hurt = 1e8;`, 1500);
  assert.deepEqual(errors, []);

  const kinds = new Map();
  for (const row of results) { const kind = row.name.replace(/-\d+$/, ''); (kinds.get(kind) || kinds.set(kind, []).get(kind)).push(row); }
  console.log('\nstep               n  sync(max)  ready(max)  worst task wall/cpu  >16ms >50ms  worst frame  >25ms >50ms');
  for (const [kind, rows] of kinds) {
    const max = key => Math.max(...rows.map(row => row[key])), sum = key => rows.reduce((total, row) => total + row[key], 0);
    console.log(kind.padEnd(17), String(rows.length).padStart(2), max('sync').toFixed(1).padStart(10), max('ready').toFixed(0).padStart(11), `${max('worstTask').toFixed(1)}/${max('worstCpu').toFixed(1)}`.padStart(20), String(sum('over16')).padStart(6), String(sum('over50')).padStart(5), max('worstFrame').toFixed(1).padStart(12), String(sum('late')).padStart(6), String(sum('veryLate')).padStart(5));
  }
  if (process.env.TYRAN_ENTRY_ASSERT === '1') {
    // Choosing a sector, waiting in the shop and launching a prepared sector must never freeze the page.
    for (const row of results.filter(row => !row.name.startsWith('cold'))) {
      assert(row.worstTask < 50, `${row.name}: no main-thread task over 50 ms (worst ${row.worstTask} ms)`);
      assert.equal(row.veryLate, 0, `${row.name}: no frame over 50 ms`);
    }
    for (const row of results.filter(row => /^menu-select|^menu-practice|^hangar-next/.test(row.name))) assert(row.sync < 25, `${row.name}: the click handler returns within 25 ms (took ${row.sync} ms)`);
    console.log('Sector entry limits held.');
  }
} finally { await browser.close(); }
