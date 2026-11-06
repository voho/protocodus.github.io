// Real Web Audio for the mission-gated relay, without a game/GPU boot.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Relay acoustics</title>'); return; }
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
    const [{ createRadioAmbience }, { createAcousticOcclusion }, { rng }] = await Promise.all([
      import('/fun/hedgerow/js/audio-radios.js'), import('/fun/hedgerow/js/audio-space.js'), import('/fun/hedgerow/js/util.js'),
    ]);
    const ctx = new OfflineAudioContext(2, 44100 * 4, 44100), R = rng(1945);
    const noise = ctx.createBuffer(1, 88200, 44100), samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = R() * 2 - 1;
    const makeNoise = () => { const source = ctx.createBufferSource(); source.buffer = noise; source.loop = true; return source; };
    const listener = { x: 0, y: 1.6, z: 0, yaw: 0 }, occlusion = createAcousticOcclusion();
    occlusion.setListener(0, 1.6, 0);
    if (mode === 'blocked') occlusion.setProbe(() => ({ surface: 'stone' }));
    let phase = false, broken = false;
    const source = { x: ['left', 'turn'].includes(mode) ? 4 : mode === 'right' ? -4 : 0, y: 1.6,
      z: ['left', 'right', 'turn'].includes(mode) ? 0 : mode === 'far' ? -32 : -4,
      active: () => { if (broken) throw Error('mission disposed'); return phase; } };
    const radio = createRadioAmbience({ ctx, output: ctx.destination, makeNoise, occlusion, listener, random: R });
    radio.setSources(mode === 'limit' ? Array.from({ length: 100 }, (_, i) => ({ ...source, x: i })) : [source]);
    radio.update(0); const prepared = radio.status;
    let started, throttled;
    ctx.suspend(.5).then(() => {
      phase = true; radio.update(ctx.currentTime); started = radio.status;
      radio.update(ctx.currentTime + .01); throttled = radio.status; ctx.resume();
    });
    if (mode === 'turn') ctx.suspend(1.5).then(() => { listener.yaw = Math.PI; radio.update(ctx.currentTime); ctx.resume(); });
    if (mode === 'gate-failure') ctx.suspend(2.2).then(() => { broken = true; radio.update(ctx.currentTime); ctx.resume(); });
    ctx.suspend(3).then(() => { phase = false; radio.update(ctx.currentTime); ctx.resume(); });
    const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const energy = (from, to) => {
      let sumL = 0, sumR = 0, peak = 0, detail = 0;
      for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) {
        sumL += left[i] ** 2; sumR += right[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        if (i) detail += (left[i] - left[i - 1]) ** 2 + (right[i] - right[i - 1]) ** 2;
      }
      const length = (to - from) * 44100;
      return { left: Math.sqrt(sumL / length), right: Math.sqrt(sumR / length), rms: Math.sqrt((sumL + sumR) / (length * 2)), peak, detail: Math.sqrt(detail / Math.max(sumL + sumR, 1e-20)) };
    };
    return { prepared, started, throttled, final: radio.status, before: energy(.1, .4), carrier: energy(.8, 1.3), afterTurn: energy(1.8, 2.1), afterFailure: energy(2.5, 2.8), stopped: energy(3.3, 3.8) };
  }, mode);
  const close = await render('close'), far = await render('far'), blocked = await render('blocked');
  const left = await render('left'), right = await render('right'), turn = await render('turn'), limit = await render('limit'), failed = await render('gate-failure');
  assert.equal(close.prepared.active, 0, 'inactive report equipment allocates no playing voice');
  assert.equal(close.prepared.prepared, true, 'signal texture prepares while loading, before its mission phase');
  assert.ok(close.prepared.textureBytes < 1_500_000);
  assert.ok(close.carrier.rms > .001 && close.carrier.peak < .06, 'a nearby relay has a quiet audible signal');
  assert.ok(far.carrier.rms < close.carrier.rms * .03, 'the relay stays local to its courtyard');
  assert.ok(blocked.carrier.rms < close.carrier.rms * .6 && blocked.carrier.rms > close.carrier.rms * .1, 'a masonry wall muffles but does not erase the receiver');
  assert.ok(left.carrier.left > left.carrier.right * 20 && right.carrier.right > right.carrier.left * 20, 'receiver bearing matches its world position');
  assert.ok(turn.afterTurn.right > turn.afterTurn.left * 20, 'a receiver follows a listener turn');
  assert.equal(limit.started.active, 2, 'a hundred eligible sources allocate only two receiver voices');
  assert.equal(limit.started.pathUpdates, limit.throttled.pathUpdates, 'path work waits for the 125 ms update interval');
  assert.ok(failed.final.gateErrors > 0 && failed.afterFailure.peak === 0, 'a failed mission gate silences the equipment');
  for (const result of [close, far, blocked, left, right, turn, limit, failed]) {
    assert.equal(result.before.peak, 0, 'the receiver is silent before the report phase');
    assert.equal(result.stopped.peak, 0, 'the receiver is silent after the report phase');
    assert.equal(result.final.active + result.final.retiring, 0, 'phase completion releases both looping sources and their graph');
  }
  console.log(`audio-radios-check: real PCM phase gates, quiet receiver (near peak ${close.carrier.peak.toFixed(4)}), distance/wall/bearing/turn, 2-voice budget and cleanup pass`);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
