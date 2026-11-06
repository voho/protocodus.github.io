// Preserve real foot contacts while releasing the grass recording noise floor.
// PCM energy/attack checks and a normally advancing context cover both quality
// and the voice/path resources that a pre-rendered offline stress loop cannot.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root, 'fun/hedgerow/assets/audio/manifest.json'), 'utf8'));
const grass = manifest.assets.map(asset => asset.file).filter(file => file.startsWith('footstep_grass_'));
assert.equal(grass.length, 3);
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Footstep PCM and resources</title>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
    response.setHeader('Content-Type', file.endsWith('.ogg') ? 'audio/ogg' : 'text/javascript'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const retained = await page.evaluate(async files => {
    const ctx = new OfflineAudioContext(1, 16000, 16000), report = [];
    for (const file of files) {
      const response = await fetch('/fun/hedgerow/assets/audio/' + file), buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      const samples = buffer.getChannelData(0), energy = samples.reduce((sum, value) => sum + value ** 2, 0);
      for (const rate of [.925, .955, 1, 1.045, 1.075]) {
        let kept = 0;
        for (let i = 0; i < samples.length; i++) {
          const time = i / (buffer.sampleRate * rate), fade = time < .225 ? 1 : time < .24 ? (.24 - time) / .015 : 0;
          kept += samples[i] ** 2 * fade ** 2;
        }
        report.push({ file, rate, retainedEnergy: kept / energy });
      }
    }
    return report;
  }, grass);
  assert.ok(retained.every(result => result.retainedEnergy > .997), 'the unchanged recordings retain over99.7% energy across walk/run pitch variation');
  const pcm = {};
  for (const missing of [false, true]) for (const surface of ['grass', 'stone', 'wood', 'mud', 'water']) {
    const key = `${missing ? 'fallback' : 'recorded'}-${surface}`;
    pcm[key] = await page.evaluate(async ({ missing, surface }) => {
      const { createAudio } = await import('/fun/hedgerow/js/audio.js');
      const ctx = new OfflineAudioContext(2, 16000 * 2, 16000); let clock = 0;
      Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => 'running' });
      const originalContext = window.AudioContext, originalFetch = window.fetch;
      window.AudioContext = function () { return ctx; };
      if (missing) window.fetch = async () => new Response('', { status: 404 });
      const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
      window.AudioContext = originalContext; window.fetch = originalFetch; audio.setMix({ ambience: 0 });
      const recordings = [], make = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const node = make(), start = node.start.bind(node), stop = node.stop.bind(node), row = {};
        node.start = (at, offset = 0) => {
          if (node.buffer.duration < 1) { Object.assign(row, { at, offset, duration: node.buffer.duration, stops: [] }); recordings.push(row); }
          return start(at, offset);
        };
        node.stop = when => { row.stops?.push(when); return stop(when); }; return node;
      };
      clock = .1; audio.footstep(0, 0, 0, surface, 1, true);
      const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      let energy = 0, attack = 0, peak = 0;
      for (let i = 0; i < left.length; i++) {
        const e = left[i] ** 2 + right[i] ** 2; energy += e;
        if (i >= 1600 && i < 4000) attack += e;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
      return { energy, attack, peak, recordings, sample: audio.sampleStatus, nodes: audio.nodeStatus };
    }, { missing, surface });
    const result = pcm[key];
    assert.ok(result.attack > .0001 && result.peak > .005 && result.peak < .94, `${key} retains a finite audible contact`);
    assert.equal(result.sample.active, 0); assert.equal(result.nodes.oneShotBuses, 0);
    assert.equal(result.sample.ready, missing ? 0 : manifest.assets.length);
    if (!missing && ['grass', 'stone', 'wood'].includes(surface)) {
      assert.equal(result.recordings.length, 1);
      const recording = result.recordings[0]; assert.equal(recording.offset, 0, 'no contact attack is skipped');
      if (surface === 'grass') { assert.equal(recording.stops.length, 1); assert.ok(Math.abs(recording.stops[0] - recording.at - .24) < 1e-9); }
      else assert.equal(recording.stops.length, 0, 'hard/wood recordings retain their natural duration');
    }
  }
  const live = await page.evaluate(async () => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const OriginalContext = window.AudioContext, ctx = new OriginalContext({ sampleRate: 16000 });
    await ctx.resume(); window.AudioContext = function () { return ctx; };
    const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
    window.AudioContext = OriginalContext; audio.setMix({ ambience: 0 }); audio.setListener(0, 1.6, 0, 0);
    const start = ctx.currentTime; let peak = 0, peakBuses = 0, pause = null;
    for (let frame = 0; frame < 90; frame++) {
      audio.footstep(-1, 0, 2, 'grass'); audio.footstep(1, 0, 2, 'grass');
      peak = Math.max(peak, audio.sampleStatus.active); peakBuses = Math.max(peakBuses, audio.nodeStatus.oneShotBuses);
      if (frame === 30) {
        await ctx.suspend(); await new Promise(done => setTimeout(done, 0));
        const before = { time: ctx.currentTime, sample: audio.sampleStatus, nodes: audio.nodeStatus };
        await new Promise(done => setTimeout(done, 120));
        pause = { before, after: { time: ctx.currentTime, sample: audio.sampleStatus, nodes: audio.nodeStatus } }; await ctx.resume();
      }
      await new Promise(done => setTimeout(done, 25));
    }
    const duration = ctx.currentTime - start, voices = audio.voiceStatus;
    await new Promise(done => setTimeout(done, 1100));
    const final = { sample: audio.sampleStatus, nodes: audio.nodeStatus }; await ctx.close();
    return { emitted: 180, duration, peak, peakBuses, voices, pause, final };
  });
  assert.ok(live.peak < 24 && live.peakBuses < 26, 'short grass voices leave room during the finite nearby-step stress input');
  assert.equal(live.voices.culled + live.voices.stolen, 0);
  assert.deepEqual(live.pause.before, live.pause.after, 'a real context suspension freezes the audio-clock tail lifetime');
  assert.equal(live.final.sample.active, 0); assert.equal(live.final.nodes.oneShotBuses, 0);
  const reportFlag = process.argv.indexOf('--report');
  const outputDirectory = resolve(root, process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
  const reportPath = reportFlag >= 0 ? resolve(process.argv[reportFlag + 1]) : resolve(outputDirectory, 'audio-steps-report.json');
  await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify({ retained, pcm, live }, null, 2));
  console.log('audio-steps-check: grass energy/contact preserved, other surfaces/fallback unchanged, bounded real-time voices/paths, actual pause and complete cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
