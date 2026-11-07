// Quiet generic grenade handling uses the existing simulation cue pool.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const sampleTotal = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8')).assets.length;
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Grenade handling PCM</title>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    assert.ok(file.startsWith(root + sep));
    response.setHeader('Content-Type', file.endsWith('.ogg') ? 'audio/ogg' : 'text/javascript');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const results = {};
  for (const mode of ['default', 'us', 'de', 'invalid', 'us-fallback', 'de-fallback', 'de-slow', 'de-pause', 'de-cancel', 'de-reset', 'suspended', 'de-budget', 'de-muted']) {
    results[mode] = await page.evaluate(async mode => {
      const { createAudio } = await import('/fun/hedgerow/js/audio.js');
      const sampleRate = 16000, ctx = new OfflineAudioContext(2, sampleRate * 5, sampleRate);
      let clock = 0, state = 'running', age = 0, capture = false;
      const events = [];
      Object.defineProperty(ctx, 'currentTime', { get: () => clock });
      Object.defineProperty(ctx, 'state', { get: () => state });
      for (const method of ['createBufferSource', 'createOscillator']) {
        const make = ctx[method].bind(ctx);
        ctx[method] = (...args) => {
          const node = make(...args), start = node.start.bind(node);
          node.start = (...values) => {
            if (capture) events.push({ type: method, when: values[0], age, offset: values[1] || 0, duration: node.buffer?.duration || null });
            return start(...values);
          };
          return node;
        };
      }
      const originalContext = window.AudioContext, originalFetch = window.fetch;
      window.AudioContext = function () { return ctx; };
      if (mode.endsWith('fallback')) window.fetch = async () => new Response('', { status: 404 });
      const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
      window.AudioContext = originalContext; window.fetch = originalFetch;
      audio.setMix({ ambience: 0, effects: mode === 'de-muted' ? 0 : 1 });
      audio.setOutdoors(true); capture = true; clock = 1;
      if (mode === 'suspended') state = 'suspended';
      const kind = /^de(?:-|$)/.test(mode) ? 'grenade_de' : mode === 'invalid' ? 'unknown' : mode === 'default' ? undefined : 'grenade_us';
      const count = mode === 'de-budget' ? 32 : 1;
      for (let i = 0; i < count; i++) audio.pin(kind);
      const born = audio.actionStatus;
      let paused = null, afterCancel = null;
      if (mode === 'de-reset') { audio.cancelActions(); afterCancel = audio.actionStatus; }
      for (let frame = 1; frame <= 40; frame++) {
        age = frame / 60; clock = 1 + age * (mode === 'de-slow' ? 4 : 1);
        if (mode === 'de-pause' && frame === 2) {
          const before = { ...audio.actionStatus }; state = 'suspended'; audio.advanceActions(2);
          paused = { before, after: audio.actionStatus }; state = 'running';
        }
        if (mode === 'de-cancel' && frame === 2) { audio.cancelActions(); afterCancel = audio.actionStatus; }
        audio.advanceActions(1 / 60);
      }
      const dispatched = audio.actionStatus;
      const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      let peak = 0, energy = 0, high = 0, onset = null, late = 0;
      const energies = Array.from({ length: 50 }, () => 0);
      for (let i = 0; i < left.length; i++) {
        if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw Error('non-finite PCM');
        const p = Math.max(Math.abs(left[i]), Math.abs(right[i])); peak = Math.max(peak, p);
        if (onset === null && p > .00001) onset = i / sampleRate;
        energy += left[i] ** 2 + right[i] ** 2;
        if (i) high += (left[i] - left[i - 1]) ** 2 + (right[i] - right[i - 1]) ** 2;
        energies[Math.min(49, Math.floor(i / sampleRate * 10))] += left[i] ** 2 + right[i] ** 2;
        if (i >= 1.1 * sampleRate) late += left[i] ** 2 + right[i] ** 2;
      }
      return { born, paused, afterCancel, dispatched, events, peak, energy, roughness: energy ? high / energy : 0, onset, late, energies,
        final: audio.actionStatus, sample: audio.sampleStatus, paths: audio.nodeStatus, acoustic: audio.acousticStatus };
    }, mode);
  }
  for (const [mode, result] of Object.entries(results)) {
    assert.equal(result.final.active + result.final.pending + result.final.sources, 0, `${mode}: complete descriptor/source cleanup`);
    assert.equal(result.sample.active + result.paths.oneShotBuses, 0); assert.equal(result.acoustic.probes, 0);
    assert.equal(result.sample.ready, mode.endsWith('fallback') ? 0 : sampleTotal);
    if (mode !== 'suspended') { assert.equal(result.born.sources, 0); assert.equal(result.born.pending, mode === 'de-budget' ? 8 : 2); }
  }
  for (const mode of ['default', 'us', 'de', 'invalid', 'us-fallback', 'de-fallback']) {
    assert.ok(results[mode].peak > .005 && results[mode].peak < .1);
    assert.equal(results[mode].events.length, 2); assert.equal(results[mode].dispatched.dispatched, 2);
    assert.ok(results[mode].onset < 1.05, 'the first normal 60 Hz simulation threshold gives prompt handling feedback');
  }
  for (const mode of ['default', 'invalid']) assert.ok(Math.abs(results[mode].energy - results.us.energy) < results.us.energy * 1e-6);
  assert.ok(results.de.roughness < results.us.roughness * .8, 'the cap/cord handling is less metallic than the US ring cue');
  assert.deepEqual(results['de-slow'].events.map(({ type, age }) => ({ type, age })), results.de.events.map(({ type, age }) => ({ type, age })), 'slow wall cadence preserves exact simulation beats');
  assert.deepEqual(results['de-pause'].paused.before, results['de-pause'].paused.after);
  assert.equal(results['de-cancel'].dispatched.dispatched, 1); assert.equal(results['de-cancel'].late, 0);
  assert.equal(results['de-reset'].events.length, 0, 'reset before the first simulation threshold discards both preparation cues');
  assert.equal(results.suspended.events.length, 0, 'suspended preparation cannot create a cue');
  assert.equal(results['de-budget'].born.evicted, 28); assert.equal(results['de-budget'].dispatched.dispatched, 8);
  assert.equal(results['de-muted'].peak, 0);
  const outputDirectory = resolve(root, process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
  const reportPath = resolve(outputDirectory, 'audio-grenade-prep-report.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(results, null, 2));
  console.log('audio-grenade-prep-check: quiet US/default and German CC0 handling, complete fallback, simulation/slow cadence, pause, cancel/reset, exact mute and four-group cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
