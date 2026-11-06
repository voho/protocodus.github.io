// Existing CC0 cloth/latch recordings in real Web Audio PCM. The actual
// decoded clips must retain the simulation action/contact lifecycle, defer
// to gunfire at saturation, and add no guessed delay or unbounded sources.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root, 'fun/hedgerow/assets/audio/manifest.json'), 'utf8'));
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.end('<!doctype html><title>Foley PCM</title>');
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    assert.ok(path.startsWith(root + '/'));
    res.setHeader('Content-Type', path.endsWith('.ogg') ? 'audio/ogg' : 'text/javascript');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const results = {};
  for (const version of ['fallback', 'recorded']) {
    results[version] = {};
    for (const mode of ['reload', 'rifle', 'mg', 'gear', 'body', 'cancel', 'cancel-body', 'pause', 'actor', 'mix-muted', 'budget', 'priority']) {
      results[version][mode] = await page.evaluate(async ({ version, mode }) => {
        const { createAudio } = await import('/fun/hedgerow/js/audio.js');
        const sampleRate = 16000, length = 7;
        const ctx = new OfflineAudioContext(2, sampleRate * length, sampleRate);
        let clock = 0, state = 'running';
        Object.defineProperty(ctx, 'currentTime', { get: () => clock });
        Object.defineProperty(ctx, 'state', { get: () => state });
        const oldContext = window.AudioContext, oldFetch = window.fetch;
        window.AudioContext = function () { return ctx; };
        if (version !== 'recorded') window.fetch = async () => new Response('', { status: 404 });
        const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] });
        audio.prepare(); await audio.loadSamples();
        window.AudioContext = oldContext; window.fetch = oldFetch;
        audio.setMix({ ambience: 0, effects: mode === 'mix-muted' ? 0 : 1 });
        audio.setListener(0, 1.6, 0, 0); audio.setOutdoors(true);
        const sources = [], originalBuffer = ctx.createBufferSource.bind(ctx);
        ctx.createBufferSource = () => {
          const node = originalBuffer(), start = node.start.bind(node), stop = node.stop.bind(node);
          const row = {};
          node.start = (at, offset = 0) => { Object.assign(row, { at, offset, duration: node.buffer.duration, rate: node.playbackRate.value, stops: [] }); sources.push(row); return start(at, offset); };
          node.stop = time => { row.stops?.push(time); return stop(time); };
          return node;
        };
        clock = .1;
        let actor = null;
        if (mode === 'gear' || mode === 'mix-muted') audio.gear('crouch');
        else if (mode === 'body' || mode === 'cancel-body') audio.bodyImpact(-1, 0, 1, 'stone', 4);
        else if (mode === 'actor') actor = audio.reloadActor('mp40', () => ({ x: clock > 1.2 ? 2 : -2, y: 0, z: 2 }), { duration: 2.6 });
        else if (mode === 'priority') {
          for (let i = 0; i < 40; i++) audio.gunshot('mp40', 0, 1.6, 3);
          audio.bodyImpact(-1, 0, 1, 'stone', 4);
          audio.gunshot('mp40', 0, 1.6, 0, { player: true });
          audio.reload('kar98k');
        } else if (mode === 'budget') {
          for (let i = 0; i < 100; i++) audio.gear('crouch');
        } else audio.reload(mode === 'rifle' ? 'kar98k' : mode === 'mg' ? 'mg42' : 'mp40');
        let paused = null;
        for (let frame = 1; frame <= 110; frame++) {
          clock = .1 + frame * .05;
          if (mode === 'pause' && frame === 4) {
            state = 'suspended'; const before = audio.actionStatus;
            audio.advanceActions(9); paused = { before, after: audio.actionStatus }; state = 'running';
          }
          if (mode === 'cancel' && frame === 9) audio.cancelActions();
          if (mode === 'cancel-body' && frame === 1) audio.cancelContacts();
          audio.advanceActions(.05); actor?.advance(.05);
        }
        actor?.finish();
        const before = { sample: audio.sampleStatus, actions: audio.actionStatus, actors: audio.actorActionStatus, bodies: audio.bodyContactStatus, voices: audio.voiceStatus };
        const pcm = await ctx.startRendering(), left = pcm.getChannelData(0), right = pcm.getChannelData(1);
        const energy = (from, to) => {
          let l = 0, r = 0, peak = 0, first = null;
          for (let i = Math.floor(from * sampleRate); i < Math.floor(to * sampleRate); i++) {
            l += left[i] ** 2; r += right[i] ** 2;
            const a = Math.max(Math.abs(left[i]), Math.abs(right[i])); peak = Math.max(peak, a);
            if (first === null && a > .00001) first = i / sampleRate;
          }
          return { left: l, right: r, energy: l + r, peak, first };
        };
        const windows = Array.from({ length: 60 }, (_, i) => energy(i * .1, (i + 1) * .1));
        return { before, final: { sample: audio.sampleStatus, actions: audio.actionStatus, actors: audio.actorActionStatus, bodies: audio.bodyContactStatus, nodes: audio.nodeStatus }, paused, sources, full: energy(0, length), tail: energy(mode === 'cancel-body' ? .3 : .8, length), early: energy(0, .25), windows };
      }, { version, mode });
    }
  }
  for (const [version, modes] of Object.entries(results)) {
    for (const [mode, result] of Object.entries(modes)) {
      assert.equal(result.final.sample.active, 0, `${version}/${mode} samples cleaned`);
      assert.equal(result.final.actions.active + result.final.actions.pending + result.final.actions.sources, 0);
      assert.equal(result.final.actors.active + result.final.actors.pending + result.final.actors.sources, 0);
      assert.equal(result.final.bodies.active + result.final.bodies.sources, 0);
      assert.equal(result.final.nodes.oneShotBuses, 0);
      assert.ok(result.before.sample.active <= 36);
      assert.ok(Number.isFinite(result.full.peak) && result.full.peak < 1);
      if (mode === 'cancel' || mode === 'cancel-body' || mode === 'mix-muted') assert.equal(result.tail.peak, 0);
      if (version === 'recorded' && mode === 'priority') { assert.ok(result.before.voices.culled > 0); assert.equal(result.before.voices.player, 1); assert.equal(result.before.bodies.sources, 3); }
      if (version === 'recorded') assert.equal(result.before.sample.ready, manifest.assets.length);
      if (mode === 'pause') assert.deepEqual(result.paused.before, result.paused.after);
    }
  }
  // The excerpt begins inside the useful recording, not at its padded leading silence.
  const clicks = results.recorded.reload.sources.filter(row => row.offset === .04 && Math.abs(row.duration - .2613125) < .002);
  assert.equal(clicks.length, 5); assert.ok(clicks.every(row => row.stops[0] - row.at <= .085));
  assert.ok(results.recorded.reload.full.peak < results.fallback.reload.full.peak * 1.5);
  assert.ok(results.recorded.reload.full.first >= clicks[0].at && results.recorded.reload.full.first < clicks[0].at + .012, 'latch trim starts within12ms of simulation dispatch');
  for (const mode of ['reload', 'rifle', 'mg', 'body']) assert.ok(results.recorded[mode].full.peak < results.fallback[mode].full.peak, `${mode} avoids extra peak gain`);
  const reportFlag = process.argv.indexOf('--report');
  const outputDirectory = resolve(root, process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
  const reportPath = reportFlag >= 0 ? resolve(process.argv[reportFlag + 1]) : resolve(outputDirectory, 'audio-foley-report.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(results, null, 2));
  console.log('audio-foley-check: CC0 excerpt onset/quiet mix, synthesis fallback, simulation pause/cancellation, moving reloads, exact mute, gun priority and complete source cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
