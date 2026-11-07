// Real decoded gunshot attack timing, other sample families and fallback.
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
  if (request.url === '/') { response.end('<!doctype html><title>Weapon attack timing</title>'); return; }
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
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = ({ kind = 'kar98k', mode = 'player' } = {}) => page.evaluate(async ({ kind, mode }) => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const ctx = new OfflineAudioContext(2, 16000 * 7, 16000);
    let clock = 0;
    Object.defineProperty(ctx, 'currentTime', { get: () => clock });
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    const OriginalContext = window.AudioContext, originalFetch = window.fetch;
    const fileByData = new WeakMap(), fileByBuffer = new WeakMap(), decoded = new Map();
    const decode = ctx.decodeAudioData.bind(ctx);
    ctx.decodeAudioData = async data => {
      const buffer = await decode(data), file = fileByData.get(data);
      fileByBuffer.set(buffer, file); decoded.set(file, buffer); return buffer;
    };
    window.fetch = async (...args) => {
      if (mode === 'fallback') return new Response('', { status: 404 });
      const response = await originalFetch(...args), getData = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => {
        const data = await getData(); fileByData.set(data, String(args[0]).split('/').pop()); return data;
      };
      return response;
    };
    const gainEvents = new WeakMap(), makeGain = ctx.createGain.bind(ctx);
    ctx.createGain = () => {
      const gain = makeGain(), events = [];
      gainEvents.set(gain, events);
      for (const method of ['setValueAtTime', 'linearRampToValueAtTime']) {
        const original = gain.gain[method].bind(gain.gain);
        gain.gain[method] = (value, time) => { events.push({ method, value, time }); return original(value, time); };
      }
      return gain;
    };
    window.AudioContext = function () { return ctx; };
    const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
    window.AudioContext = OriginalContext; window.fetch = originalFetch;
    audio.setMix({ ambience: 0, effects: mode === 'muted' ? 0 : 1 });
    audio.setListener(0, 1.6, 0, 0);
    const sources = [], makeSource = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const source = makeSource(), start = source.start.bind(source), connect = source.connect.bind(source);
      let envelope = null;
      source.connect = (destination, ...args) => { envelope ||= gainEvents.get(destination); return connect(destination, ...args); };
      source.start = (at, offset = 0, ...args) => {
        if (source.buffer && source.buffer.duration !== 2) {
          const values = source.buffer.getChannelData(0), begin = Math.floor(offset * source.buffer.sampleRate);
          let energy = 0;
          for (let i = begin; i < values.length; i++) energy += values[i] ** 2;
          let cumulative = 0, first = begin;
          while (first < values.length && cumulative < energy * .01) cumulative += values[first++] ** 2;
          sources.push({ file: fileByBuffer.get(source.buffer) || null, at, offset, rate: source.playbackRate.value,
            attackLag: (first / source.buffer.sampleRate - offset) / source.playbackRate.value, envelope: envelope || [] });
        }
        return start(at, offset, ...args);
      };
      return source;
    };
    const raw = [];
    for (const [file, buffer] of decoded) {
      if (!/^(rifle|bolt|smg)-0[12]\.ogg$/.test(file)) continue;
      const values = buffer.getChannelData(0), begin = Math.floor(.025 * buffer.sampleRate), fade = .002 * 1.025 * buffer.sampleRate;
      let energy = 0, retained = 0;
      for (let i = 0; i < values.length; i++) {
        energy += values[i] ** 2;
        if (i >= begin) retained += values[i] ** 2 * Math.min(1, (i - begin) / fade) ** 2;
      }
      raw.push({ file, retained: retained / energy });
    }
    const advance = (from, duration) => {
      for (let i = 1; i <= Math.ceil(duration * 60); i++) { clock = from + i / 60; audio.advanceActions(1 / 60); }
    };
    if (mode === 'other') {
      clock = .1; audio.footstep(0, 0, 0, 'grass', 1, true, { run: true });
      clock = .5; audio.impact(0, 0, 3, 'glass');
      clock = 1; audio.reload('kar98k'); advance(1, 3.5);
    } else {
      for (const time of [.1, 2]) {
        clock = time;
        audio.gunshot(kind, 0, 1.6, mode === 'far' ? 343 : 0, { player: mode !== 'far' });
        advance(time, 1.2);
      }
    }
    const actions = audio.actionStatus;
    const buffer = await ctx.startRendering();
    let peak = 0, energy = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      for (const value of buffer.getChannelData(channel)) {
        if (!Number.isFinite(value)) throw Error('non-finite PCM');
        peak = Math.max(peak, Math.abs(value)); energy += value * value;
      }
    }
    return { sources, raw, peak, energy, actions, final: { samples: audio.sampleStatus, actions: audio.actionStatus, nodes: audio.nodeStatus } };
  }, { kind, mode });

  const report = { weapons: {}, controls: {} };
  const allFiles = new Set();
  for (const kind of ['garand', 'kar98k', 'mp40', 'thompson', 'mg42']) {
    report.weapons[kind] = {};
    for (const mode of ['player', 'far']) {
      const result = report.weapons[kind][mode] = await render({ kind, mode });
      const shots = result.sources.filter(source => /^(rifle|bolt|smg)-0[12]\.ogg$/.test(source.file));
      assert.equal(shots.length, 2); assert.notEqual(shots[0].file, shots[1].file, 'both excerpts play without immediate repetition');
      shots.forEach((shot, i) => {
        allFiles.add(shot.file);
        assert.equal(shot.offset, .025);
        assert.ok(shot.attackLag >= 0 && shot.attackLag < .018, `${kind}/${shot.file} crack follows promptly`);
        assert.ok(Math.abs(shot.at - ([.1, 2][i] + .001 + (mode === 'far' ? 1 : 0))) < 1e-10, 'source time retains exact 343 m propagation');
        const zero = shot.envelope.find(event => event.method === 'setValueAtTime' && event.value === 0 && event.time === shot.at);
        const fade = shot.envelope.find(event => event.method === 'linearRampToValueAtTime' && Math.abs(event.time - shot.at - .002) < 1e-10);
        assert.ok(zero && fade && fade.value > 0, 'the offset starts with a 2 ms anti-click fade');
      });
      assert.equal(result.raw.length, 6); assert.ok(result.raw.every(file => file.retained > .9999), 'all six original recordings retain over 99.99% energy');
      assert.equal(result.final.samples.ready, sampleTotal); assert.equal(result.final.samples.failed, 0);
      assert.ok(result.peak > 0 && result.peak < .94);
      assert.equal(result.final.samples.active + result.final.actions.active + result.final.actions.sources + result.final.actions.pending + result.final.nodes.oneShotBuses, 0);
    }
  }
  assert.equal(allFiles.size, 6);
  report.controls.other = await render({ mode: 'other' });
  const offsets = report.controls.other.sources.map(source => source.offset);
  assert.ok(offsets.includes(0) && offsets.includes(.085) && offsets.includes(.04), 'grass/glass, cloth and latch retain their established offsets');
  assert.ok(!offsets.includes(.025), 'other sample families do not inherit the gunshot trim');
  report.controls.fallback = await render({ mode: 'fallback' });
  assert.equal(report.controls.fallback.final.samples.ready, 0); assert.equal(report.controls.fallback.final.samples.failed, sampleTotal);
  assert.ok(report.controls.fallback.peak > .01 && report.controls.fallback.peak < .94, 'procedural fire remains audible without the bank');
  report.controls.muted = await render({ mode: 'muted' });
  assert.equal(report.controls.muted.peak, 0);
  for (const control of Object.values(report.controls)) {
    assert.equal(control.final.samples.active + control.final.actions.active + control.final.actions.sources + control.final.actions.pending + control.final.nodes.oneShotBuses, 0);
  }
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'audio-onset-report.json'), JSON.stringify(report, null, 2));
  console.log('audio-onset-check: all six excerpts, five weapons, prompt/faded attack, exact propagation, other-family defaults, fallback/mute and resource cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
