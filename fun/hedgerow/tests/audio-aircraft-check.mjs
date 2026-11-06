// Low-passed engine ambience in real PCM: a fixed world flight, listener
// turns, shelter/mix, menu cleanup and bounded work. No WebGL scene boots.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Aircraft PCM</title>'); return; }
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
  const results = {};
  for (const mode of ['normal', 'turn', 'roof', 'menu', 'muted', 'budget']) {
    results[mode] = await page.evaluate(async mode => {
      const { createAudio } = await import('/fun/hedgerow/js/audio.js');
      // This effect is low-passed at 320 Hz; 16 kHz preserves its waveform
      // while keeping the full minute-long render inexpensive in the suite.
      const sampleRate = 16000, ctx = new OfflineAudioContext(2, sampleRate * 68, sampleRate);
      let clock = 0;
      Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => 'running' });
      const originalContext = AudioContext, originalFetch = fetch;
      window.AudioContext = function () { return ctx; }; window.fetch = async () => new Response('', { status: 404 });
      const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0], aircraft: true });
      audio.setMix({ effects: 0, ambience: mode === 'muted' ? 0 : 1 });
      audio.prepare(); await audio.loadSamples(); window.AudioContext = originalContext; window.fetch = originalFetch;
      if (mode === 'roof') { audio.setSpace(1, 4); audio.setShelter(1); }
      audio.setOutdoors(true); let started;
      for (let frame = 0; frame < 680; frame++) {
        clock = frame / 10;
        audio.setListener(0, 1.6, 0, mode === 'turn' && clock >= 30 ? Math.PI : 0);
        if (mode === 'menu' && clock >= 36) audio.setOutdoors(false);
        audio.tick();
        if (clock === 26) started = audio.aircraftStatus;
      }
      // Even if a new call is due before the old source ends, only one
      // pass can own oscillators. No geometry path is allocated for a sky cue.
      if (mode === 'budget') { clock = 200; audio.tick(); }
      const beforeRender = { flight: audio.aircraftStatus, buses: audio.nodeStatus, spatial: audio.spatialStatus, acoustics: audio.acousticStatus };
      const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      const energy = (from, to) => {
        let l = 0, r = 0, peak = 0;
        for (let i = Math.floor(from * sampleRate); i < Math.floor(to * sampleRate); i++) { l += left[i] ** 2; r += right[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); }
        return { left: l, right: r, total: l + r, peak };
      };
      return { started, beforeRender, early: energy(0, 24), turn: energy(32, 35), full: energy(25, 67), afterMenu: energy(37, 67), final: { flight: audio.aircraftStatus, buses: audio.nodeStatus } };
    }, mode);
  }
  for (const result of Object.values(results)) {
    assert.equal(result.started.active, 1); assert.equal(result.early.peak, 0);
    assert.equal(result.final.flight.active + result.final.flight.retiring, 0); assert.equal(result.final.buses.oneShotBuses, 0);
    assert.ok(result.beforeRender.spatial.peak <= 32); assert.equal(result.beforeRender.acoustics.probes, 0);
  }
  assert.ok(results.normal.full.peak > .005 && results.normal.full.peak < .2);
  const relative = (a, b) => Math.abs(a - b) / Math.max(a, b);
  assert.ok(relative(results.normal.turn.left, results.turn.turn.right) < .01);
  assert.ok(relative(results.normal.turn.right, results.turn.turn.left) < .01, 'a half-turn swaps heard sides of a fixed world flight');
  assert.ok(Math.max(results.normal.turn.left, results.normal.turn.right) > 2 * Math.min(results.normal.turn.left, results.normal.turn.right));
  assert.ok(relative(results.normal.full.total, results.turn.full.total) < .001, 'turning changes bearing without changing the flight’s emitted level');
  assert.ok(results.roof.full.total < results.normal.full.total * .2);
  assert.equal(results.menu.afterMenu.peak, 0); assert.equal(results.muted.full.peak, 0);
  assert.equal(results.menu.beforeRender.flight.active, 0); assert.equal(results.menu.beforeRender.flight.retiring, 1);
  assert.equal(results.budget.beforeRender.flight.active, 1); assert.equal(results.budget.beforeRender.buses.oneShotBuses, 1);
  console.log('audio-aircraft-check: real PCM world-flight bearing/turn, conserved level, shelter, exact ambience/menu silence, one-pass/20Hz bounds, zero world traces and source cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
