// Real PCM for the first contact of dropped equipment. No WebGL boot.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Equipment contact PCM</title>'); return; }
  try {
    const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(root + sep)) throw Error('path');
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = mode => page.evaluate(async mode => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const ctx = new OfflineAudioContext(2, 44100 * 2, 44100); let clock = 0, state = 'running';
    Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => state });
    const realContext = window.AudioContext, realFetch = window.fetch;
    window.AudioContext = function () { return ctx; }; window.fetch = async () => new Response('', { status: 404 });
    const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] });
    if (mode === 'muted') audio.setMix({ effects: 0 });
    audio.prepare(); await audio.loadSamples(); window.AudioContext = realContext; window.fetch = realFetch;
    audio.setListener(mode === 'far' ? 40 : 0, 1.6, 0, mode === 'turn' ? Math.PI : 0);
    audio.setOcclusionProbe(() => mode === 'blocked' ? { surface: 'stone' } : null);
    if (mode !== 'off') audio.setOutdoors(true);
    if (mode === 'suspended') state = 'suspended';
    clock = .6;
    const surface = ['mud', 'wood', 'water', 'clip-mud'].includes(mode) ? (mode === 'clip-mud' ? 'mud' : mode) : 'stone';
    const radius = mode.startsWith('clip') ? .03 : mode === 'mag' ? .04 : .08;
    let emitted;
    if (mode === 'legacy') { audio.grenadeBounce(2, 0, 1); emitted = true; }
    else emitted = audio.debrisImpact(2, 0, 1, surface, mode === 'gentle' ? 1 : mode === 'invalid' ? NaN : 4, radius);
    if (mode === 'budget') {
      for (let i = 0; i < 100; i++) audio.debrisImpact(2, 0, 1, 'stone', 4, .08);
      audio.bodyImpact(2, 0, 1, 'stone', 4, true);
    }
    if (mode === 'cancel' || mode === 'menu') {
      clock = .62;
      if (mode === 'menu') audio.setOutdoors(false); else audio.cancelContacts();
      audio.cancelContacts();
    }
    const active = audio.debrisContactStatus, body = audio.bodyContactStatus;
    const buffer = await ctx.startRendering(); let peak = 0, left = 0, right = 0, early = 0, tail = 0, first = null, last = null;
    for (let i = 0; i < buffer.length; i++) {
      const a = buffer.getChannelData(0)[i], b = buffer.getChannelData(1)[i], value = Math.max(Math.abs(a), Math.abs(b));
      peak = Math.max(peak, value); left += a * a; right += b * b;
      if (i / 44100 < .6) early = Math.max(early, value);
      if (i / 44100 > .72) tail = Math.max(tail, value);
      if (value > 1e-5) { first ??= i / 44100; last = i / 44100; }
    }
    return { emitted, active, body, final: audio.debrisContactStatus, finalBody: audio.bodyContactStatus, nodes: audio.nodeStatus, peak, energy: left + right, left, right, early, tail, first, last };
  }, mode);
  const results = {};
  for (const mode of ['normal', 'turn', 'blocked', 'clip', 'mag', 'mud', 'wood', 'water', 'clip-mud', 'gentle', 'muted', 'far', 'off', 'suspended', 'invalid', 'cancel', 'menu', 'budget', 'legacy']) results[mode] = await render(mode);
  for (const [mode, result] of Object.entries(results)) {
    assert.equal(result.final.active, 0); assert.equal(result.final.sources, 0); assert.equal(result.finalBody.active, 0); assert.equal(result.nodes.oneShotBuses, 0); assert.equal(result.early, 0);
    if (mode !== 'legacy' && mode !== 'budget') assert.ok(result.peak < .1, `${mode}: equipment stays a restrained close detail`);
  }
  for (const mode of ['normal', 'clip', 'mag', 'wood', 'mud', 'water']) {
    assert.equal(results[mode].emitted, true);
    assert.ok(results[mode].first >= .6 && results[mode].first < .612);
    assert.ok(results[mode].last < .79, 'one contact contains no later artificial bounces');
  }
  assert.ok(results.normal.peak < results.legacy.peak * .5, 'a dropped rifle avoids the old grenade clank');
  assert.ok(results.clip.energy < results.mag.energy && results.mag.energy < results.normal.energy);
  assert.ok(results.mud.energy < results.normal.energy * .4); assert.ok(results.blocked.energy < results.normal.energy * .3);
  assert.ok(results.normal.left > results.normal.right * 2); assert.ok(results.turn.right > results.turn.left * 2);
  assert.ok(results.gentle.energy < results.normal.energy * .3);
  for (const mode of ['clip-mud', 'muted', 'far', 'off', 'suspended', 'invalid']) assert.equal(results[mode].peak, 0, `${mode}: no audible contact`);
  assert.equal(results.budget.active.active, 8); assert.equal(results.budget.active.culled, 93); assert.ok(results.budget.active.sources <= 24);
  assert.equal(results.budget.body.active, 1, 'a full debris pool cannot block a meaningful player body impact');
  for (const mode of ['cancel', 'menu']) assert.ok(results[mode].tail < 1e-7);

  const pause = await page.evaluate(async () => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const realContext = window.AudioContext, realFetch = window.fetch; let ctx;
    window.AudioContext = function () { return ctx = new realContext(); }; window.fetch = async () => new Response('', { status: 404 });
    const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.init(); await audio.loadSamples(); await ctx.resume();
    window.AudioContext = realContext; window.fetch = realFetch; audio.setOutdoors(true);
    audio.debrisImpact(2, 0, 1, 'stone', 4, .08); await ctx.suspend();
    const before = { time: ctx.currentTime, status: audio.debrisContactStatus };
    await new Promise(done => setTimeout(done, 120));
    const after = { time: ctx.currentTime, status: audio.debrisContactStatus };
    await ctx.resume(); await new Promise(done => setTimeout(done, 250));
    const resumed = audio.debrisContactStatus;
    audio.debrisImpact(2, 0, 1, 'stone', 4, .08); audio.bodyImpact(2, 0, 1, 'stone', 4, true); audio.cancelContacts();
    await new Promise(done => setTimeout(done, 100));
    const reset = { debris: audio.debrisContactStatus, body: audio.bodyContactStatus, nodes: audio.nodeStatus };
    await ctx.close(); return { before, after, resumed, reset };
  });
  assert.deepEqual(pause.after, pause.before); assert.equal(pause.resumed.active, 0);
  assert.equal(pause.reset.debris.active, 0); assert.equal(pause.reset.body.active, 0); assert.equal(pause.reset.nodes.oneShotBuses, 0);
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) await writeFile(process.argv[reportIndex + 1], JSON.stringify({ results, pause }, null, 2));
  console.log('audio-debris-check: real PCM material/radius/speed, quiet rifle/clip/magazine, world bearing/occlusion, exact silence gates, eight voices independent of body cues, live pause/menu/retry and cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
