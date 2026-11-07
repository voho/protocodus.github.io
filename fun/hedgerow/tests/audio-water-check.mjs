// Water blast/entry use the real mixer; no renderer or WebGL boot.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa'));
const sampleTotal = JSON.parse(await readFile(resolve(root, 'fun/hedgerow/assets/audio/manifest.json'), 'utf8')).assets.length;
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><button>Run water audio pause</button>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    assert.ok(file.startsWith(root + sep)); response.setHeader('Content-Type', file.endsWith('.ogg') ? 'audio/ogg' : 'text/javascript'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const results = {};
  for (const mode of ['dry', 'false', 'water', 'far', 'charge', 'blocked', 'muted', 'entry']) {
    results[mode] = await page.evaluate(async mode => {
      const { createAudio } = await import('/fun/hedgerow/js/audio.js');
      const { createWorld, SHOT } = await import('/fun/hedgerow/js/world.js');
      const sampleRate = 16000, ctx = new OfflineAudioContext(2, sampleRate * 8, sampleRate); let clock = 0, capture = false;
      Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => 'running' });
      const sources = new Set(), created = [];
      for (const method of ['createBufferSource', 'createOscillator']) {
        const make = ctx[method].bind(ctx); ctx[method] = (...args) => {
          const source = make(...args);
          if (capture) { created.push(method); sources.add(source); source.addEventListener('ended', () => sources.delete(source), { once: true }); }
          return source;
        };
      }
      const originalContext = window.AudioContext; window.AudioContext = function () { return ctx; };
      const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
      window.AudioContext = originalContext; audio.setMix({ ambience: 0, effects: mode === 'muted' ? 0 : 1 });
      audio.setOutdoors(true); audio.setListener(0, 1.6, 0, 0); audio.setSpace(.25, 12, .4);
      const world = createWorld({ minX: -100, maxX: 100, minZ: -100, maxZ: 400 });
      if (mode === 'blocked') world.add({ type: 'box', x: 0, y: .6, z: 1.5, hx: 3, hy: 3, hz: .2, surface: 'stone' });
      const paths = [];
      audio.setOcclusionProbe((lx, ly, lz, x, y, z) => {
        const dx = x - lx, dy = y - ly, dz = z - lz, d = Math.hypot(dx, dy, dz);
        const hit = world.raycast(lx, ly, lz, dx / d, dy / d, dz / d, Math.max(0, d - .25), SHOT, { noWater: true }); paths.push({ blocked: !!hit }); return hit;
      });
      capture = true; clock = 1;
      const z = mode === 'far' ? 343 : 3, scale = mode === 'charge' ? 1.8 : 1;
      const args = [0, -1.1, z, scale];
      if (mode !== 'dry') args.push(mode !== 'false');
      if (mode === 'entry') audio.impact(0, 0, 3, 'water');
      else audio.explosion(...args);
      const born = { sources: sources.size, nodes: audio.nodeStatus, acoustics: audio.acousticStatus };
      const rendered = await ctx.startRendering(), left = rendered.getChannelData(0), right = rendered.getChannelData(1);
      let peak = 0, energy = 0, high = 0, onset = null;
      for (let i = 0; i < left.length; i++) {
        if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw Error('non-finite PCM');
        const p = Math.max(Math.abs(left[i]), Math.abs(right[i])); peak = Math.max(peak, p); energy += left[i] ** 2 + right[i] ** 2;
        if (i) high += (left[i] - left[i - 1]) ** 2 + (right[i] - right[i - 1]) ** 2;
        if (onset === null && p > .00001) onset = i / sampleRate;
      }
      return { peak, energy, roughness: energy ? high / energy : 0, onset, born, created, paths, final: { sources: sources.size, nodes: audio.nodeStatus, acoustics: audio.acousticStatus, samples: audio.sampleStatus } };
    }, mode);
  }

  for (const result of Object.values(results)) {
    assert.equal(result.final.sources + result.final.nodes.oneShotBuses, 0); assert.equal(result.final.samples.ready, sampleTotal); assert.equal(result.final.samples.failed, 0);
    assert.equal(result.final.acoustics.probes, 1); assert.ok(result.peak <= .940001);
  }
  assert.ok(Math.abs(results.false.energy - results.dry.energy) < results.dry.energy * 1e-6, 'omitted/false water flags preserve the same dry blast');
  // Measured before this optional water branch was introduced, using the same
  // 16 kHz scene on audio9aea88d8. Tight spectral/energy bands protect the dry
  // sound without a hardware-dependent bitwise PCM golden file.
  assert.ok(Math.abs(results.dry.energy / 508.93710204411207 - 1) < .02, 'existing dry blast energy is retained');
  assert.ok(Math.abs(results.dry.roughness / .03785869415929763 - 1) < .02, 'existing dry blast spectral balance is retained');
  assert.ok(results.dry.peak > .89 && results.dry.peak < .94);
  assert.equal(results.entry.born.sources, 1, 'the existing entry splash adds one liquid source');
  assert.ok(results.entry.peak > .05 && results.entry.peak < .25);
  assert.equal(results.water.onset, results.dry.onset, 'water timbre does not move the pressure-wave arrival');
  assert.equal(results.dry.born.sources, 9); assert.equal(results.water.born.sources, 7);
  assert.ok(results.water.energy < results.dry.energy * .6 && results.water.roughness < results.dry.roughness * .5);
  assert.ok(results.far.onset > 1.99 && results.far.onset < 2.03);
  assert.ok(results.far.energy < results.water.energy * .01);
  assert.ok(results.blocked.energy < results.water.energy * .5); assert.equal(results.muted.peak, 0);
  assert.ok(results.charge.energy > results.water.energy);
  await page.evaluate(async () => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    document.querySelector('button').onclick = () => {
      window.__waterResult = (async () => {
        const Native = window.AudioContext, ctx = new Native({ sampleRate: 16000 }); await ctx.resume();
        const connect = AudioNode.prototype.connect, silent = ctx.createGain(); silent.gain.value = 0; connect.call(silent, ctx.destination);
        AudioNode.prototype.connect = function (destination, ...args) { return connect.call(this, destination === ctx.destination ? silent : destination, ...args); };
        const sources = new Set(); let capture = false;
        for (const method of ['createBufferSource', 'createOscillator']) {
          const make = ctx[method].bind(ctx); ctx[method] = (...args) => {
            const source = make(...args);
            if (capture) { sources.add(source); source.addEventListener('ended', () => sources.delete(source), { once: true }); }
            return source;
          };
        }
        window.AudioContext = function () { return ctx; };
        const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
        window.AudioContext = Native; AudioNode.prototype.connect = connect;
        audio.setMix({ ambience: 0 }); audio.setOutdoors(true); audio.setListener(0, 1.6, 0, 0);
        capture = true; const bornTime = ctx.currentTime;
        audio.explosion(0, -1.1, 343, 1, true); audio.impact(0, 0, 3, 'water');
        const snapshot = () => ({ time: ctx.currentTime, sources: sources.size, paths: audio.nodeStatus.oneShotBuses, samples: audio.sampleStatus.ready });
        const born = snapshot();
        await new Promise(done => setTimeout(done, 75)); audio.suspend();
        while (ctx.state !== 'suspended') await new Promise(done => setTimeout(done, 5));
        const before = snapshot(); await new Promise(done => setTimeout(done, 250)); const after = snapshot();
        audio.resume(); while (ctx.state !== 'running') await new Promise(done => setTimeout(done, 5));
        await new Promise(done => setTimeout(done, 100)); const resumed = snapshot();
        while (ctx.currentTime < bornTime + 4) await new Promise(done => setTimeout(done, 20));
        const final = snapshot(); await ctx.close(); return { born, before, after, resumed, final };
      })();
    };
  });
  await page.getByRole('button').click();
  const pause = await page.evaluate(() => window.__waterResult);
  assert.equal(pause.born.sources, 8); assert.equal(pause.born.paths, 2);
  assert.deepEqual(pause.before, pause.after, 'actual AudioContext freezes both delayed pressure wave and active splash');
  assert.ok(pause.resumed.time > pause.after.time && pause.resumed.time < pause.born.time + .5);
  assert.ok(pause.resumed.sources >= 7, 'delayed wet report retains its unelapsed audio-clock delay');
  assert.equal(pause.final.sources + pause.final.paths, 0); assert.equal(pause.final.samples, sampleTotal);

  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'audio-water-report.json'), JSON.stringify({ samples: sampleTotal, modes: results, livePause: pause }, null, 2));
  console.log(`audio-water-check: eight real PCM controls preserve dry/false sound, wet arrival/material/mute/source cleanup and live pause/resume; ${sampleTotal} samples decoded.`);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
