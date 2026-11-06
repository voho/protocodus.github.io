// Run: node fun/hedgerow/tests/audio-fires-check.mjs
// Real Web Audio PCM for local fire levels, occlusion, fade and voice limits.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Fire acoustics</title>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = mode => page.evaluate(async mode => {
    const [{ createFireAmbience }, { createAcousticOcclusion }, { rng }] = await Promise.all([
      import('/fun/hedgerow/js/audio-fires.js'), import('/fun/hedgerow/js/audio-space.js'), import('/fun/hedgerow/js/util.js'),
    ]);
    const ctx = new OfflineAudioContext(2, 44100 * 3, 44100), R = rng(77);
    const buffer = ctx.createBuffer(1, 44100 * 2, 44100), data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) { last = (last + .02 * (R() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
    const makeNoise = () => { const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true; return source; };
    const listener = { x: 0, y: 1.6, z: 0, yaw: 0 }, occlusion = createAcousticOcclusion();
    occlusion.setListener(0, 1.6, 0);
    if (mode === 'blocked') occlusion.setProbe(() => ({ surface: 'stone' }));
    const fire = { x: 0, y: 1.6, z: mode === 'far' ? -45 : -5, size: 1, on: true };
    const fires = createFireAmbience({ ctx, output: ctx.destination, makeNoise, occlusion, listener, random: R });
    fires.warm();
    const warmed = fires.status;
    const sources = mode === 'limit' ? Array.from({ length: 100 }, (_, i) => ({ ...fire, x: (i % 10) - 5, z: -5 - Math.floor(i / 10) })) : [fire];
    fires.setSources(sources); fires.update(0);
    const initial = fires.status;
    fires.update(.01); const throttled = fires.status;
    if (mode === 'off') ctx.suspend(.7).then(() => { fire.on = false; fires.update(ctx.currentTime); ctx.resume(); });
    ctx.suspend(1.4).then(() => { fires.stop(); ctx.resume(); });
    const pcm = await ctx.startRendering(), left = pcm.getChannelData(0), right = pcm.getChannelData(1);
    const energy = (from, to) => {
      let sum = 0, peak = 0, detail = 0;
      for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) {
        sum += left[i] ** 2 + right[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        if (i) detail += (left[i] - left[i - 1]) ** 2 + (right[i] - right[i - 1]) ** 2;
      }
      return { rms: Math.sqrt(sum / ((to - from) * 88200)), peak, detail: Math.sqrt(detail / Math.max(sum, 1e-20)) };
    };
    return { warmed, initial, throttled, final: fires.status, before: energy(.2, .6), afterOff: energy(1, 1.3), stopped: energy(1.8, 2.8) };
  }, mode);
  const close = await render('close'), far = await render('far'), blocked = await render('blocked'), off = await render('off'), limit = await render('limit');
  assert.ok(close.before.rms > .0001 && close.before.peak < .1, 'a nearby fire is a restrained, audible local texture');
  assert.equal(close.warmed.active, 0, 'loading preparation allocates the texture without starting voices');
  assert.equal(close.warmed.prepared, true);
  assert.ok(close.warmed.textureBytes < 2_000_000, 'all fire voices share a bounded prewarmed texture');
  assert.ok(far.before.rms < close.before.rms * .05, 'a distant fire does not become a loud global bed');
  assert.ok(blocked.before.rms < close.before.rms * .6 && blocked.before.detail < close.before.detail * .75, 'masonry reduces fire energy and sharp crackle');
  assert.ok(off.afterOff.peak < 1e-8, 'a visually extinguished fire fades and stops');
  assert.equal(limit.initial.active, 4, 'a hundred visible fires allocate only four nearby voices');
  assert.equal(limit.throttled.pathUpdates, limit.initial.pathUpdates, 'per-frame ticks do not refresh fire paths before 250 ms');
  for (const report of [close, far, blocked, off, limit]) {
    assert.equal(report.final.active + report.final.retiring, 0, 'stopped fire loops release their nodes');
    assert.equal(report.stopped.peak, 0, 'stopped loops leave no residual output');
  }
  console.log(`audio-fires-check: real PCM distance/occlusion, quiet level (near peak ${close.before.peak.toFixed(4)}), extinguishing, 4-voice/4-Hz budgets and cleanup pass`);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
