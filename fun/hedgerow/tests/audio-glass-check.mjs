// Verified CC0 pane-hit recording and real positional Web Audio PCM.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8'));
const sampleTotal = manifest.assets.length;
const receipt = manifest.assets.find(asset => asset.file === 'impactGlass_light_000.ogg');
assert.ok(receipt, 'the runtime glass sound has an active source receipt');
assert.equal(receipt.license, 'CC0-1.0');
assert.equal(receipt.sourcePack, 'Kenney Impact Sounds 1.0');
assert.equal(receipt.bytes, 6526);
assert.equal(receipt.sha256, 'd750cf88097d0c3e69920e6e14496e1444e1a9da01aa4cca8f5ec8cb44c57b4f');
assert.match(receipt.download, /\/9662dc1bed3b06ae753045915f9accfac044c7ce\/assets\/kenney\/impact-sounds\/Audio\/impactGlass_light_000\.ogg$/);
const payload = await readFile(new URL('../assets/audio/impactGlass_light_000.ogg', import.meta.url));
assert.equal(payload.length, receipt.bytes); assert.equal(payload.subarray(0, 4).toString(), 'OggS');
assert.equal(createHash('sha256').update(payload).digest('hex'), receipt.sha256);
const license = await readFile(new URL(`../assets/audio/${receipt.licenseFile}`, import.meta.url));
assert.equal(createHash('sha256').update(license).digest('hex'), 'b49aa9c56b04528b95913de13e506a0f7c5e807b9925db9bfef86af1f91120db');
assert.match(license.toString(), /Creative Commons Zero/);
assert.ok(manifest.assets.reduce((bytes, asset) => bytes + asset.bytes, 0) < 250_000);
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Glass impact PCM</title>'); return; }
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
  const decoded = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 16000, 16000);
    const response = await fetch('/fun/hedgerow/assets/audio/impactGlass_light_000.ogg');
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const data = buffer.getChannelData(0), total = data.reduce((sum, value) => sum + value * value, 0);
    let energy = 0, first = null, last = null;
    for (let i = 0; i < data.length; i++) {
      energy += data[i] ** 2;
      if (first === null && energy >= total * .01) first = i / buffer.sampleRate;
      if (last === null && energy >= total * .99) last = i / buffer.sampleRate;
    }
    return { duration: buffer.duration, first, last };
  });
  assert.ok(decoded.duration > .18 && decoded.duration < .3);
  assert.ok(decoded.first < .002 && decoded.last < .08, 'the original light strike starts promptly and has a short brittle body');
  const results = {};
  for (const mode of ['glass', 'stone', 'wood', 'fallback', 'far', 'beyond', 'left', 'right', 'blocked', 'muted', 'stress']) {
    results[mode] = await page.evaluate(async mode => {
      const { createAudio } = await import('/fun/hedgerow/js/audio.js');
      const { createWorld, SHOT } = await import('/fun/hedgerow/js/world.js');
      const sampleRate = 16000, ctx = new OfflineAudioContext(2, sampleRate * 3, sampleRate);
      let clock = 0;
      Object.defineProperty(ctx, 'currentTime', { get: () => clock });
      Object.defineProperty(ctx, 'state', { get: () => 'running' });
      const realContext = window.AudioContext, realFetch = window.fetch;
      window.AudioContext = function () { return ctx; };
      window.fetch = (url, options) => mode === 'fallback' && String(url).endsWith('impactGlass_light_000.ogg')
        ? Promise.resolve(new Response('', { status: 404 })) : realFetch(url, options);
      const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
      window.AudioContext = realContext; window.fetch = realFetch;
      audio.setMix({ ambience: 0, effects: mode === 'muted' ? 0 : 1 });
      audio.setListener(0, 1.6, 0, 0); audio.setOutdoors(true);
      const world = createWorld({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
      if (mode === 'blocked') world.add({ type: 'box', x: 0, y: 1.6, z: 1.5, hx: 3, hy: 1.6, hz: .15, surface: 'stone' });
      const paths = [];
      audio.setOcclusionProbe((lx, ly, lz, x, y, z) => {
        const dx = x - lx, dy = y - ly, dz = z - lz, d = Math.hypot(dx, dy, dz);
        const hit = world.raycast(lx, ly, lz, dx / d, dy / d, dz / d, Math.max(0, d - .25), SHOT, { noWater: true });
        paths.push({ blocked: !!hit, surface: hit?.surface }); return hit;
      });
      clock = 1;
      const x = mode === 'left' ? 3 : mode === 'right' ? -3 : 0;
      const z = mode === 'far' ? 25 : mode === 'beyond' ? 81 : 3;
      for (let i = 0; i < (mode === 'stress' ? 100 : 1); i++) audio.impact(x, 1.6, z, mode === 'stone' || mode === 'wood' ? mode : 'glass');
      await Promise.resolve();
      const before = { samples: audio.sampleStatus, nodes: audio.nodeStatus, voices: audio.voiceStatus };
      const rendered = await ctx.startRendering(), left = rendered.getChannelData(0), right = rendered.getChannelData(1);
      let peak = 0, energy = 0, l = 0, r = 0, onset = null, late = 0;
      for (let i = 0; i < left.length; i++) {
        assertFinite(left[i]); assertFinite(right[i]);
        const p = Math.max(Math.abs(left[i]), Math.abs(right[i])); peak = Math.max(peak, p);
        if (onset === null && p > .00001) onset = i / sampleRate;
        energy += left[i] ** 2 + right[i] ** 2; l += left[i] ** 2; r += right[i] ** 2;
        if (i >= sampleRate * 1.3) late += left[i] ** 2 + right[i] ** 2;
      }
      function assertFinite(n) { if (!Number.isFinite(n)) throw Error('non-finite PCM'); }
      return { peak, energy, left: l, right: r, onset, late, paths, before, final: { samples: audio.sampleStatus, nodes: audio.nodeStatus, acoustics: audio.acousticStatus } };
    }, mode);
  }
  for (const result of Object.values(results)) {
    assert.equal(result.final.samples.active, 0); assert.equal(result.final.nodes.oneShotBuses, 0);
    assert.ok(result.before.samples.active <= 36); assert.ok(result.final.acoustics.peakQueries <= 4);
  }
  assert.equal(results.glass.final.samples.ready, sampleTotal); assert.equal(results.glass.final.samples.failed, 0);
  assert.equal(results.fallback.final.samples.ready, sampleTotal - 1); assert.equal(results.fallback.final.samples.failed, 1);
  assert.ok(results.glass.peak > .01 && results.glass.peak < .2);
  assert.ok(results.glass.onset >= 1 && results.glass.onset < 1.01);
  assert.equal(results.glass.onset, results.stone.onset, 'new recording adds no onset delay to the existing mixer latency');
  assert.ok(results.glass.late < results.glass.energy * .0001);
  assert.ok(results.fallback.energy > .001, 'missing clip retains the brittle procedural cue');
  assert.ok(results.far.energy < results.glass.energy * .03);
  assert.equal(results.beyond.peak, 0); assert.equal(results.muted.peak, 0);
  assert.ok(results.left.left > results.left.right * 4 && results.right.right > results.right.left * 4);
  assert.ok(results.blocked.energy < results.glass.energy * .5 && results.blocked.paths[0].blocked);
  assert.equal(results.stress.before.samples.active, 36); assert.equal(results.stress.before.nodes.oneShotBuses, 36);
  assert.equal(results.stress.before.voices.culled, 64);
  assert.ok(results.stress.peak <= .940001, 'the existing peak guard bounds coincident impacts');
  const outputDirectory = resolve(root, process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
  const reportPath = resolve(outputDirectory, 'audio-glass-report.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ decoded, results }, null, 2));
  console.log('audio-glass-check: pinned CC0 hash/license, decoded onset, restrained pane hit, real wall/distance/bearing, missing-file fallback, exact mute and bounded voice/path cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
