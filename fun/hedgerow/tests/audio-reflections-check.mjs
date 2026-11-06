// Actual collider materials control the existing listener echo network.
// A known impulse isolates its response; a normal shot checks the dry attack.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { acousticReflection } from '../js/audio-space.js';
import { createWorld, SHOT } from '../js/world.js';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
function room(materials) {
  const world = createWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 50 });
  if (!materials.length) return world;
  const sides = [[8, 0, .2, 8], [0, 8, 8, .2], [-8, 0, .2, 8], [0, -8, 8, .2]];
  for (const [index, [x, z, hx, hz]] of sides.entries()) {
    world.add({ type: 'box', x, y: 1.6, z, hx, hy: 1.6, hz, surface: materials[index % materials.length] });
  }
  return world;
}
function snapshot(world) {
  let closed = 0, distance = 0, reflected = 0, queries = 0;
  for (let ray = 0; ray < 8; ray++) {
    const angle = ray / 8 * Math.PI * 2;
    const hit = world.raycast(0, 1.6, 0, Math.sin(angle), 0, Math.cos(angle), 30, SHOT, { noWater: true });
    queries++;
    const t = hit ? hit.t : 30, weight = t < 30 ? 1 - t / 45 : 0;
    closed += weight; distance += t; reflected += weight * acousticReflection(hit);
  }
  return { closed: closed / 8, distance: distance / 8, reflectivity: closed ? reflected / closed : 1, queries };
}
const spaces = Object.fromEntries(['stone', 'wood', 'metal', 'mud', 'foliage'].map(surface => [surface, snapshot(room([surface]))]));
spaces.open = snapshot(room([]));
spaces.mixed = snapshot(room(['stone', 'wood', 'mud', 'foliage']));
assert.equal(acousticReflection(null), 0);
assert.equal(acousticReflection({ surface: 'unlisted' }), 1);
assert.equal(acousticReflection({ collider: 'terrain', surface: 'grass' }), .25, 'a grass-covered bank contains earth');
assert.equal(acousticReflection({ surface: 'grass' }), .12, 'a thin screen of leaves has a different response');
assert.deepEqual(spaces.open, { closed: 0, distance: 30, reflectivity: 1, queries: 8 });
for (const space of Object.values(spaces)) assert.equal(space.queries, 8);
for (const surface of ['wood', 'metal', 'mud', 'foliage', 'mixed']) {
  assert.equal(spaces[surface].closed, spaces.stone.closed, 'material does not change geometric enclosure');
  assert.equal(spaces[surface].distance, spaces.stone.distance);
}
assert.ok(spaces.mixed.reflectivity > spaces.foliage.reflectivity && spaces.mixed.reflectivity < spaces.stone.reflectivity);

const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Material reflections PCM</title>'); return; }
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
  for (const mode of ['default', 'stone', 'wood', 'metal', 'mud', 'foliage', 'mixed', 'open', 'muted', 'invalid', 'high', 'low', 'zero']) {
    results[mode] = await page.evaluate(async ({ mode, spaces }) => {
      const { createAudio } = await import('/fun/hedgerow/js/audio.js');
      const sampleRate = 16000, ctx = new OfflineAudioContext(2, sampleRate * 8, sampleRate);
      let clock = 0, lastGain = null, echoInput = null;
      Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => 'running' });
      const nodes = {};
      for (const method of ['createBufferSource', 'createGain', 'createDelay', 'createBiquadFilter', 'createStereoPanner']) {
        const make = ctx[method].bind(ctx);
        ctx[method] = (...args) => {
          nodes[method] = (nodes[method] || 0) + 1;
          const node = make(...args);
          // The input gain immediately precedes the existing two-delay stage.
          // Injecting a unit impulse here isolates returns from dry weapon audio.
          if (method === 'createDelay' && !echoInput) echoInput = lastGain;
          if (method === 'createGain') lastGain = node;
          return node;
        };
      }
      const originalContext = window.AudioContext, originalFetch = window.fetch;
      window.AudioContext = function () { return ctx; }; window.fetch = async () => new Response('', { status: 404 });
      const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
      window.AudioContext = originalContext; window.fetch = originalFetch;
      audio.setMix({ ambience: 0, effects: mode === 'muted' ? 0 : 1 });
      audio.setListener(0, 1.6, 0, 0); audio.setOutdoors(true);
      const space = spaces[mode] || spaces.stone;
      const reflectivity = mode === 'default' ? undefined : mode === 'invalid' ? NaN : mode === 'high' ? 5 : mode === 'low' ? -5 : mode === 'zero' ? 0 : space.reflectivity;
      audio.setSpace(space.closed, space.distance, reflectivity);
      if (!echoInput) throw Error('missing echo stage');
      const impulse = ctx.createBufferSource(), buffer = ctx.createBuffer(1, 1, sampleRate);
      buffer.getChannelData(0)[0] = 1; impulse.buffer = buffer; impulse.connect(echoInput);
      impulse.onended = () => impulse.disconnect(); impulse.start(4);
      clock = 6; audio.gunshot('mp40', 0, 1.6, 3);
      const pcm = await ctx.startRendering(), left = pcm.getChannelData(0), right = pcm.getChannelData(1);
      const energy = (from, to) => {
        let total = 0, peak = 0;
        for (let i = Math.floor(from * sampleRate); i < Math.floor(to * sampleRate); i++) {
          total += left[i] ** 2 + right[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        }
        return { total, peak };
      };
      return { nodes, dry: energy(6.01, 6.04), reflected: energy(4.02, 5), later: energy(4.15, 5),
        environment: audio.environmentStatus, final: audio.nodeStatus, acoustics: audio.acousticStatus };
    }, { mode, spaces });
  }
  const near = (a, b) => Math.abs(a - b) < Math.max(1e-8, Math.max(a, b) * 1e-6);
  for (const result of Object.values(results)) {
    assert.deepEqual(result.nodes, results.default.nodes, 'materials allocate no additional audio nodes');
    assert.equal(result.acoustics.probes, 0, 'listener snapshots add no event-driven path trace');
    assert.equal(result.final.oneShotBuses, 0);
  }
  for (const mode of ['stone', 'invalid', 'high']) assert.ok(near(results[mode].reflected.total, results.default.reflected.total), 'default/invalid material retains the previous masonry response');
  for (const mode of ['wood', 'metal', 'mud', 'foliage', 'mixed', 'open', 'low', 'zero']) assert.ok(near(results[mode].dry.total, results.default.dry.total), 'material changes only reflected audio');
  assert.ok(results.foliage.reflected.total < results.mud.reflected.total && results.mud.reflected.total < results.wood.reflected.total);
  assert.ok(results.wood.reflected.total < results.metal.reflected.total && results.metal.reflected.total < results.stone.reflected.total);
  assert.ok(results.foliage.reflected.total < results.stone.reflected.total * .2);
  assert.ok(near(results.low.reflected.total, results.zero.reflected.total));
  assert.equal(results.low.environment.reflectivity, 0); assert.equal(results.high.environment.reflectivity, 1);
  assert.equal(results.muted.reflected.peak, 0); assert.equal(results.muted.dry.peak, 0);
  assert.equal(results.wood.environment.enclosure, results.stone.environment.enclosure);
  const reportFlag = process.argv.indexOf('--report');
  const outputDirectory = resolve(root, process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
  const reportPath = reportFlag >= 0 ? resolve(process.argv[reportFlag + 1]) : resolve(outputDirectory, 'audio-reflections-report.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ spaces, results }, null, 2));
  console.log('audio-reflections-check: real eight-ray materials, unchanged enclosure/dry attack, softer hedge/bank returns, default/clamp controls, exact mute and zero added nodes/traces pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
