// Render real Web Audio PCM at an actual shipped-rig contact timestamp.
// No WebGL scene, remote recording, or full mission boot is required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { ragdollFixture } from './ragdoll-fixture.mjs';
const hits = [], fall = ragdollFixture('standing', { onImpact: hit => hits.push(hit) });
for (let i = 0; i < 720; i++) fall.char.update(1 / 120, 0);
assert.equal(hits.length, 1); const hit = hits[0];
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Body contact PCM</title>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
    response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = mode => page.evaluate(async ({ mode, hit }) => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const ctx = new OfflineAudioContext(2, 44100 * 2, 44100);
    let clock = 0, state = 'running';
    Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => state });
    const realContext = window.AudioContext, realFetch = window.fetch;
    window.AudioContext = function () { return ctx; }; window.fetch = async () => new Response('', { status: 404 });
    const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] });
    if (mode === 'muted') audio.setMix({ effects: 0 });
    audio.prepare(); await audio.loadSamples(); window.AudioContext = realContext; window.fetch = realFetch;
    audio.setListener(mode === 'far' ? 60 : 0, 1.6, 0, mode === 'turn' ? Math.PI : 0);
    audio.setOcclusionProbe(() => mode === 'blocked' ? { surface: 'stone' } : null);
    if (mode !== 'off') audio.setOutdoors(true);
    if (mode === 'suspended') state = 'suspended';
    const at = hit.time + .1; clock = at;
    let emitted;
    if (mode === 'legacy' || mode === 'legacy-cancel') emitted = audio.bodyFall(2, hit.y, hit.z, 'stone', mode === 'legacy-cancel' ? .4 : 0, true);
    else emitted = audio.bodyImpact(2, hit.y, hit.z, ['mud', 'grass', 'forest', 'fabric', 'water', 'wood'].includes(mode) ? mode : 'stone', mode === 'gentle' ? 1 : mode === 'fast' ? 6 : hit.speed, mode === 'player');
    if (mode === 'budget') {
      for (let i = 0; i < 100; i++) audio.bodyImpact(2, hit.y, hit.z, 'stone', 4);
      audio.bodyImpact(2, hit.y, hit.z, 'stone', 4, true);
      audio.bodyImpact(2, hit.y, hit.z, 'stone', 4);
      audio.bodyImpact(2, hit.y, hit.z, 'stone', 4, true);
    }
    if (mode === 'cancel' || mode === 'menu') {
      clock = at + .025;
      if (mode === 'cancel') audio.cancelContacts(); else audio.setOutdoors(false);
      audio.cancelContacts();
    }
    if (mode === 'legacy-cancel') { clock = at + .1; audio.cancelContacts(); }
    const active = audio.bodyContactStatus, nodes = audio.nodeStatus;
    const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    let first = null, last = null, peak = 0, early = 0, afterCancel = 0, l = 0, r = 0;
    for (let i = 0; i < left.length; i++) {
      const value = Math.max(Math.abs(left[i]), Math.abs(right[i])); peak = Math.max(peak, value); l += left[i] ** 2; r += right[i] ** 2;
      if (i / 44100 < at) early = Math.max(early, value);
      if (i / 44100 > at + .1) afterCancel = Math.max(afterCancel, value);
      if (value > .00001) { first ??= i / 44100; last = i / 44100; }
    }
    return { emitted, at, first, last, peak, early, afterCancel, left: l, right: r, energy: l + r, active, nodes, final: audio.bodyContactStatus, finalNodes: audio.nodeStatus, acoustics: audio.occlusionStatus };
  }, { mode, hit });
  const results = {};
  for (const mode of ['normal', 'turn', 'blocked', 'mud', 'grass', 'forest', 'fabric', 'water', 'wood', 'gentle', 'fast', 'player', 'legacy', 'budget', 'far', 'off', 'suspended', 'muted', 'cancel', 'menu', 'legacy-cancel']) results[mode] = await render(mode);
  for (const mode of ['normal', 'turn', 'blocked', 'mud', 'grass', 'forest', 'fabric', 'water', 'wood', 'gentle', 'fast', 'player']) {
    const result = results[mode]; assert.equal(result.emitted, true); assert.equal(result.early, 0);
    assert.ok(result.first >= result.at && result.first < result.at + .012, `${mode}: real PCM starts at contact`);
    assert.ok(result.peak > .0001 && result.peak < .2, `${mode}: bounded close impact level (${result.peak})`);
    assert.ok(result.last < result.at + .25, `${mode}: no invented delayed rifle clatter`);
  }
  assert.ok(results.normal.left > results.normal.right * 2); assert.ok(results.turn.right > results.turn.left * 2);
  assert.ok(results.blocked.energy < results.normal.energy * .3, 'the actual contact respects masonry occlusion');
  for (const mode of ['mud', 'grass', 'forest', 'fabric']) assert.ok(results[mode].energy < results.normal.energy * .8, `${mode} absorbs the hard attack`);
  assert.ok(results.gentle.energy < results.normal.energy * .25); assert.ok(results.fast.energy > results.normal.energy);
  assert.ok(results.player.peak < results.legacy.peak && results.player.energy < results.legacy.energy, 'the close player impact is restrained against its previous body cue');
  for (const mode of ['far', 'off', 'suspended']) { assert.equal(results[mode].emitted, false); assert.equal(results[mode].peak, 0); }
  assert.equal(results.muted.peak, 0, 'effects mute is exact');
  assert.equal(results['legacy-cancel'].peak, 0, 'retry also stops an unavailable-rig fallback before its scheduled attack');
  assert.equal(results.budget.active.active, 8); assert.equal(results.budget.active.culled, 96); assert.ok(results.budget.active.sources <= 40);
  for (const mode of ['cancel', 'menu']) { assert.equal(results[mode].active.retiring, 1); assert.ok(results[mode].afterCancel < 1e-7); }
  for (const result of Object.values(results)) { assert.equal(result.final.active, 0); assert.equal(result.final.sources, 0); assert.equal(result.finalNodes.oneShotBuses, 0); }

  const pause = await page.evaluate(async () => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const realContext = window.AudioContext, realFetch = window.fetch;
    let ctx; window.AudioContext = function () { return ctx = new realContext(); }; window.fetch = async () => new Response('', { status: 404 });
    const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.init(); await audio.loadSamples(); await ctx.resume();
    window.AudioContext = realContext; window.fetch = realFetch; audio.setOutdoors(true);
    audio.bodyImpact(2, 0, 1, 'stone', 4); await ctx.suspend();
    const before = { time: ctx.currentTime, status: audio.bodyContactStatus };
    await new Promise(done => setTimeout(done, 120));
    const after = { time: ctx.currentTime, status: audio.bodyContactStatus };
    await ctx.resume(); await new Promise(done => setTimeout(done, 350));
    const resumed = audio.bodyContactStatus;
    audio.bodyImpact(2, 0, 1, 'stone', 4); audio.cancelContacts(); audio.cancelContacts();
    await new Promise(done => setTimeout(done, 100));
    const reset = { status: audio.bodyContactStatus, nodes: audio.nodeStatus };
    await ctx.close(); return { before, after, resumed, reset };
  });
  assert.deepEqual(pause.after, pause.before, 'AudioContext pause freezes the live contact tail and source lifetime');
  assert.equal(pause.resumed.active, 0); assert.equal(pause.reset.status.active, 0); assert.equal(pause.reset.nodes.oneShotBuses, 0);
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) await writeFile(process.argv[reportIndex + 1], JSON.stringify({ contact: hit, results, pause }, null, 2));
  console.log('audio-bodies-check: real torso-timed PCM, restrained close mix, material/speed, world bearing/occlusion, exact mute, eight-slot player reserve, menu/retry cancellation, live pause and zero resource tails pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
