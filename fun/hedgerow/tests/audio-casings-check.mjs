// Actual brass physics and real Web Audio: contact timing, pause, materials,
// a bounded contact voice pool, and cleanup. No WebGL scene is booted.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const { createCasings } = await import('../js/casings.js');
const THREE = await import('three');
const originalRandom = Math.random;
Math.random = () => .5;
try {
  for (const weapon of ['garand', 'kar98k', 'thompson', 'mp40']) {
    let elapsed = 0, surfaceQueries = 0, visibleContact = null;
    const contacts = [], floor = 2.5;
    const G = { player: { weapon }, audio: { casingImpact: (...args) => contacts.push({ time: elapsed, args }) }, world: {
      pushOut: () => false, groundAt: () => floor,
      surfaceUnder(x, y, z) { surfaceQueries++; assert.equal(y, floor + .006); return 'wood'; },
    } };
    const cases = createCasings(G), short = weapon === 'thompson' || weapon === 'mp40';
    const mesh = cases.group.children[short ? 1 : 0], matrix = new THREE.Matrix4();
    cases.eject(0, floor + 1.5, 0, 1, 0);
    assert.equal(mesh.count, 1); assert.equal(cases.group.children[short ? 0 : 1].count, 0);
    for (let frame = 0; frame < 300; frame++) {
      elapsed += 1 / 120; cases.update(1 / 120); mesh.getMatrixAt(0, matrix);
      if (visibleContact === null && Math.abs(matrix.elements[13] - (floor + .006)) < 1e-6) visibleContact = elapsed;
    }
    assert.equal(contacts.length, 1, 'later bounces and rest never invent another contact sound');
    assert.equal(contacts[0].time, visibleContact, 'the cue shares the exact update that puts the visible brass on the floor');
    assert.ok(Math.abs(visibleContact - .8416666666666661) < 1e-6);
    assert.equal(surfaceQueries, 1); assert.equal(contacts[0].args[3], 'wood'); assert.ok(contacts[0].args[4] > 5);
    cases.clear(); assert.equal(mesh.count, 0); assert.equal(mesh.visible, false);
    cases.eject(0, floor + 1.5, 0, 1, 0); cases.clear();
    for (let i = 0; i < 60; i++) cases.update(.05);
    assert.equal(contacts.length, 1, 'reset removes airborne cases without a delayed cue');
  }

  let contacts = 0;
  const G = { player: { weapon: 'mp40' }, audio: { casingImpact: () => contacts++ }, world: { pushOut: () => false, groundAt: () => 0, surfaceUnder: () => 'stone' } };
  const cases = createCasings(G);
  for (let i = 0; i < 64; i++) cases.eject(0, 1.5, 0, 1, 0);
  for (let i = 0; i < 60; i++) cases.update(.05);
  assert.equal(contacts, 64);
  cases.eject(0, 1.5, 0, 1, 0);
  const beforePause = contacts;
  for (let i = 0; i < 30; i++) cases.update(0);
  assert.equal(contacts, beforePause, 'zero simulation time cannot produce a contact');
  for (let i = 0; i < 60; i++) cases.update(.05);
  assert.equal(contacts, 65, 'a recycled slot receives a fresh first-contact cue');
  assert.equal(cases.group.children[1].count, 64, 'sustained SMG fire keeps the short-case pool bounded');
} finally { Math.random = originalRandom; }

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Brass contact</title><script type="importmap">{"imports":{"three":"/assets/vendor/three/three.module.min.js"}}</script>'); return;
  }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'audio/ogg'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const render = mode => page.evaluate(async mode => {
    const [{ createAudio }, { createCasings }] = await Promise.all([import('/fun/hedgerow/js/audio.js'), import('/fun/hedgerow/js/casings.js')]);
    const ctx = new OfflineAudioContext(2, 44100 * 5, 44100);
    let clock = 0;
    Object.defineProperty(ctx, 'currentTime', { get: () => clock });
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    const realContext = window.AudioContext, realFetch = window.fetch;
    window.AudioContext = function () { return ctx; }; window.fetch = async () => new Response('', { status: 404 });
    const audio = createAudio();
    if (mode === 'muted') audio.setMix({ effects: 0 });
    audio.prepare(); await audio.loadSamples(); window.AudioContext = realContext; window.fetch = realFetch;
    audio.setListener(mode === 'far' ? 40 : 0, 1.6, 0, mode === 'turn' ? Math.PI : 0);
    const G = { player: { weapon: 'mp40' }, audio, world: { pushOut: () => false, groundAt: () => 0, surfaceUnder: () => mode === 'wood' ? 'wood' : mode === 'soft' ? 'mud' : 'stone' } };
    const cases = createCasings(G), calls = [], contact = audio.casingImpact;
    audio.casingImpact = (...args) => { calls.push({ at: clock, args }); return contact(...args); };
    const random = Math.random; Math.random = () => .5;
    const slow = mode === 'slow', dt = slow ? .05 : 1 / 120, wallStep = slow ? .2 : dt;
    clock = .1; cases.eject(0, 1.5, 0, 1, 0);
    for (let i = 0; i < (slow ? 21 : 240); i++) { clock += wallStep; cases.update(dt); }
    Math.random = random;
    if (mode === 'budget') for (let i = 0; i < 100; i++) contact(1, .006, 0, 'stone', 6);
    const active = audio.casingStatus;
    const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    let first = null, last = null, peak = 0, l = 0, r = 0, early = 0;
    const expected = calls[0].at;
    for (let i = 0; i < left.length; i++) {
      const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      peak = Math.max(peak, a); l += left[i] ** 2; r += right[i] ** 2;
      if (i / 44100 < expected) early = Math.max(early, a);
      if (a > .00001) { first ??= i / 44100; last = i / 44100; }
    }
    return { calls, active, final: audio.casingStatus, nodes: audio.nodeStatus, peak, first, last, early, left: l, right: r };
  }, mode);
  const results = {};
  for (const mode of ['normal', 'slow', 'turn', 'wood', 'soft', 'far', 'muted', 'budget']) results[mode] = await render(mode);
  for (const mode of ['normal', 'slow', 'turn', 'wood']) {
    const result = results[mode]; assert.equal(result.calls.length, 1); assert.equal(result.early, 0);
    assert.ok(result.first >= result.calls[0].at && result.first < result.calls[0].at + .015, 'real PCM starts at the actual contact update');
    assert.ok(result.peak > .0001 && result.peak < .045, 'brass remains a quiet close detail');
    assert.ok(result.last < result.calls[0].at + .18, 'one contact has no invented later bounce train');
  }
  assert.ok(results.slow.first > 3.4, 'a slow renderer retains the full visible flight rather than a post-shot wall timer');
  assert.ok(results.normal.left > results.normal.right * 2); assert.ok(results.turn.right > results.turn.left * 2, 'listener bearing still controls the grounded source');
  for (const mode of ['soft', 'far', 'muted']) assert.equal(results[mode].peak, 0, `${mode} stays silent`);
  assert.ok(results.wood.left + results.wood.right < (results.normal.left + results.normal.right) * .8);
  assert.equal(results.budget.active.active, 8); assert.equal(results.budget.active.culled, 93);
  for (const result of Object.values(results)) { assert.equal(result.final.active, 0); assert.equal(result.nodes.oneShotBuses, 0); }

  const pause = await page.evaluate(async () => {
    const [{ createAudio }, { createCasings }] = await Promise.all([import('/fun/hedgerow/js/audio.js'), import('/fun/hedgerow/js/casings.js')]);
    const realContext = window.AudioContext, realFetch = window.fetch;
    let ctx; window.AudioContext = function () { return ctx = new realContext(); }; window.fetch = async () => new Response('', { status: 404 });
    const audio = createAudio(); audio.init(); await audio.loadSamples(); await ctx.resume();
    window.AudioContext = realContext; window.fetch = realFetch;
    const calls = [], contact = audio.casingImpact;
    audio.casingImpact = (...args) => { calls.push(ctx.currentTime); return contact(...args); };
    const cases = createCasings({ player: { weapon: 'mp40' }, audio, world: { pushOut: () => false, groundAt: () => 0, surfaceUnder: () => 'stone' } });
    cases.eject(0, 1.5, 0, 1, 0); for (let i = 0; i < 10; i++) cases.update(.05);
    await ctx.suspend(); const held = ctx.currentTime, before = calls.length;
    await new Promise(done => setTimeout(done, 150)); cases.update(0);
    const paused = { before, after: calls.length, held, now: ctx.currentTime, active: audio.casingStatus.active };
    await ctx.resume(); for (let i = 0; i < 40; i++) cases.update(.05);
    await new Promise(done => setTimeout(done, 250));
    const final = { calls: calls.length, contacts: audio.casingStatus, nodes: audio.nodeStatus };
    cases.eject(0, 1.5, 0, 1, 0); cases.clear(); for (let i = 0; i < 40; i++) cases.update(.05);
    final.afterReset = calls.length; await ctx.close(); return { paused, final };
  });
  assert.equal(pause.paused.before, 0); assert.equal(pause.paused.after, 0); assert.equal(pause.paused.now, pause.paused.held); assert.equal(pause.paused.active, 0);
  assert.equal(pause.final.calls, 1); assert.equal(pause.final.afterReset, 1); assert.equal(pause.final.contacts.active, 0); assert.equal(pause.final.nodes.oneShotBuses, 0);
  console.log('audio-casings-check: actual first ground contact, MP40 short pool, recycled slots, normal/slow real PCM, material silence, bearing, effects mute, 8-contact limit, live pause/reset and cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
