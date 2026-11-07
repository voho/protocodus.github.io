// Real WebAudio contact timbre, retained danger/defaults and bounded cleanup.
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
  if (request.url === '/') { response.end('<!doctype html><button>Run contact audio pause</button>'); return; }
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
  for (const mode of ['old', 'legacy', 'unknown', 'stone', 'cobble', 'wood', 'metal', 'mud', 'grass', 'forest', 'sandbag', 'slow', 'fast', 'blocked', 'muted', 'far', 'mud7', 'stone7']) {
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
      const surface = mode.endsWith('7') ? mode.slice(0, -1) : ['old', 'legacy'].includes(mode) ? undefined : mode === 'unknown' ? 'unknown' : ['slow', 'fast', 'blocked', 'muted', 'far', 'mud7', 'stone7'].includes(mode) ? 'stone' : mode;
      const speed = ['old', 'legacy', 'unknown'].includes(mode) ? undefined : mode === 'slow' ? 1.5 : mode === 'fast' ? 9 : 3.5;
      audio.grenadeBounce(0, .09, mode === 'far' ? 41 : mode.endsWith('7') ? 7 : 3, surface, speed);
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
  for (const [mode, result] of Object.entries(results)) {
    assert.equal(result.final.sources + result.final.nodes.oneShotBuses, 0);
    assert.equal(result.final.samples.ready, sampleTotal); assert.equal(result.final.samples.failed, 0);
    assert.equal(result.born.sources, mode === 'far' ? 0 : 1);
    assert.equal(result.final.acoustics.probes, mode === 'far' ? 0 : 1);
    assert.ok(result.peak < .3);
  }
  for (const mode of ['legacy', 'unknown', 'stone', 'cobble']) assert.ok(Math.abs(results[mode].energy / results.old.energy - 1) < 1e-6, 'legacy and reference hard impacts retain their existing sound');
  // Pre-change bc599772 generic cue, same 16 kHz scene; protect its sound
  // as well as equivalence between the optional default/explicit paths.
  assert.ok(Math.abs(results.legacy.energy / .20713056040949596 - 1) < .02);
  assert.ok(Math.abs(results.legacy.roughness / .31434437496167067 - 1) < .02);
  assert.ok(results.mud.energy < results.stone.energy * .6 && results.mud.energy > results.stone.energy * .1);
  assert.ok(results.grass.energy < results.stone.energy * .5 && results.grass.energy > results.stone.energy * .1);
  assert.ok(results.wood.roughness < results.stone.roughness * .85);
  assert.ok(results.metal.roughness > results.stone.roughness * 1.3);
  assert.ok(results.slow.energy < results.stone.energy * .3 && results.fast.energy > results.stone.energy * 1.25);
  assert.ok(results.blocked.energy < results.stone.energy * .5);
  assert.ok(results.mud7.peak > .01 && results.mud7.energy > results.stone7.energy * .3, 'soft floor retains a positive nearby danger cue');
  assert.equal(results.muted.peak, 0); assert.equal(results.far.peak, 0);
  await page.evaluate(async () => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    document.querySelector('button').onclick = () => {
      window.__contactResult = (async () => {
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
        audio.grenadeBounce(0, .09, 3, 'mud', 3.45);
        const snapshot = () => ({ time: ctx.currentTime, sources: sources.size, paths: audio.nodeStatus.oneShotBuses, samples: audio.sampleStatus.ready });
        const born = snapshot();
        audio.suspend();
        while (ctx.state !== 'suspended') await new Promise(done => setTimeout(done, 5));
        const before = snapshot(); await new Promise(done => setTimeout(done, 250)); const after = snapshot();
        audio.resume(); while (ctx.state !== 'running') await new Promise(done => setTimeout(done, 5));
        await new Promise(done => setTimeout(done, 100)); const resumed = snapshot();
        while (ctx.currentTime < bornTime + .5) await new Promise(done => setTimeout(done, 20));
        const final = snapshot(); await ctx.close(); return { born, before, after, resumed, final };
      })();
    };
  });
  await page.getByRole('button').click();
  const result = await page.evaluate(() => window.__contactResult);
  assert.equal(result.born.sources, 1); assert.equal(result.born.paths, 1);
  assert.deepEqual(result.before, result.after, 'actual AudioContext freezes the short material-contact cue');
  assert.ok(result.resumed.time > result.after.time && result.resumed.time < result.born.time + .5);
  assert.equal(result.final.sources + result.final.paths, 0); assert.equal(result.final.samples, sampleTotal);

  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'audio-grenade-contacts-report.json'), JSON.stringify({ samples: sampleTotal, modes: results, livePause: result }, null, 2));
  console.log('audio-grenade-contacts-check: eighteen PCM material/speed/default/danger/distance/mute controls, one-source/probe bounds and real pause/cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
