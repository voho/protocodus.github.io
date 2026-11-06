// Real PCM plus a live suspended AudioContext; no game renderer/GPU boot.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><button>Start horizon test</button>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'audio/ogg');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = mode => page.evaluate(async mode => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const ctx = new OfflineAudioContext(2, 44100 * 4, 44100);
    let clock = 0;
    Object.defineProperty(ctx, 'currentTime', { get: () => clock });
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    const Native = window.AudioContext; window.AudioContext = function () { return ctx; };
    const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); window.AudioContext = Native;
    await audio.loadSamples(); audio.setOutdoors(true); audio.setListener(0, 1.6, 0, 0);
    for (let i = 0; i < (mode === 'budget' ? 100 : 1); i++) audio.distant('artillery', { azimuth: Math.PI / 2, delay: 1 });
    const scheduled = audio.horizonStatus;
    if (mode === 'turn') { clock = .4; audio.setListener(0, 1.6, 0, Math.PI); }
    if (mode === 'cancel') {
      clock = .4; audio.setOutdoors(false);
      clock = .42; audio.setOutdoors(false); // menu frames must not postpone a stop
      clock = .7; audio.setOutdoors(true); // no old report in a resumed mission
    }
    const buffer = await ctx.startRendering();
    const energy = (from, to) => {
      const channels = [0, 1].map(channel => {
        const samples = buffer.getChannelData(channel); let sum = 0, peak = 0;
        for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) {
          sum += samples[i] ** 2; peak = Math.max(peak, Math.abs(samples[i]));
        }
        return { rms: Math.sqrt(sum / ((to - from) * 44100)), peak };
      });
      return { left: channels[0].rms, right: channels[1].rms, peak: Math.max(...channels.map(channel => channel.peak)) };
    };
    return { scheduled, final: audio.horizonStatus, nodes: audio.nodeStatus, acoustics: audio.acousticStatus,
      before: energy(.1, .85), arrived: energy(1.05, 1.7), whole: energy(0, 4) };
  }, mode);
  const delayed = await render('delay'), turned = await render('turn'), cancelled = await render('cancel'), budget = await render('budget');
  assert.equal(delayed.before.peak, 0, 'a horizon report waits for its audio-clock travel delay');
  assert.equal(delayed.scheduled.pending, 1);
  assert.ok(delayed.arrived.left > delayed.arrived.right * 2 && delayed.arrived.peak > .01);
  assert.ok(turned.arrived.right > turned.arrived.left * 2, 'turning before arrival updates the fixed horizon bearing');
  assert.equal(turned.acoustics.probes, 0, 'horizon updates require no geometry rays');
  assert.equal(cancelled.whole.peak, 0, 'leaving and re-entering the mission cancels a pending report');
  assert.equal(budget.scheduled.active, 4);
  assert.equal(budget.scheduled.sources, 8, 'a hundred artillery requests allocate only eight signal sources');
  assert.equal(budget.scheduled.culled, 96);
  for (const result of [delayed, turned, cancelled, budget]) {
    assert.equal(result.final.active + result.final.sources, 0);
    assert.equal(result.nodes.oneShotBuses, 0, 'finished or cancelled horizon graphs disconnect');
  }

  await page.evaluate(async () => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const Native = window.AudioContext;
    window.AudioContext = new Proxy(Native, { construct(Target, args) { const ctx = Reflect.construct(Target, args); window.__ctx = ctx; return ctx; } });
    document.querySelector('button').onclick = () => {
      const audio = window.__audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.init();
      audio.setOutdoors(true); audio.distant('artillery', { azimuth: Math.PI / 2, delay: 1 });
    };
  });
  await page.getByRole('button').click(); await page.waitForTimeout(100);
  await page.evaluate(() => __audio.suspend()); await page.waitForFunction(() => __ctx.state === 'suspended');
  const paused = await page.evaluate(() => ({ time: __ctx.currentTime, horizon: __audio.horizonStatus }));
  await page.waitForTimeout(500);
  const held = await page.evaluate(() => ({ time: __ctx.currentTime, horizon: __audio.horizonStatus }));
  assert.equal(held.time, paused.time, 'the real audio clock freezes during a wall-clock pause');
  assert.equal(held.horizon.pending, 1, 'the report remains pending through the pause');
  await page.evaluate(() => __audio.resume()); await page.waitForFunction(() => __ctx.state === 'running');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => __audio.horizonStatus.pending), 1, 'resume keeps the unelapsed travel time');
  await page.evaluate(() => __audio.setOutdoors(false)); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __audio.horizonStatus.sources + __audio.nodeStatus.oneShotBuses), 0);
  await page.evaluate(() => __ctx.close());
  console.log(`audio-horizon-check: real PCM delay/turn/menu cancellation, 4-report budget/cleanup and live pause freeze at ${held.time.toFixed(3)} s pass`);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
