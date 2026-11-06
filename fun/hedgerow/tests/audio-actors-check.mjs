// Real shipped rig event timings and Web Audio PCM for moving NPC reloads.
// No full WebGL world is required; AI lifecycle integration has its own check.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { parseUntexturedGLB } from './rig-fixture.mjs';

const { reloadEvents } = await import('../js/reload.js');
const { actorReloadTiming } = await import('../js/audio-reload-timing.js');
const rigEvents = reloadEvents(await parseUntexturedGLB('soldier'));
const smg = actorReloadTiming('mp40', { duration: 2.6, events: rigEvents.reload_smg });
const rifle = actorReloadTiming('kar98k', { duration: 3.2, events: rigEvents.reload });
assert.equal(smg.seated, rigEvents.reload_smg.find(event => event.name === 'mag_seated').t * 2.6);
assert.equal(smg.rack, rigEvents.reload_smg.find(event => event.name === 'bolt_back').t * 2.6);
assert.equal(rifle.clipIn, rigEvents.reload.find(event => event.name === 'clip_in_hand').t * 3.2);
assert.equal(rifle.lock, rigEvents.reload.find(event => event.name === 'oprod_slap').t * 3.2);
assert.equal(actorReloadTiming('mp40', { duration: 2.6, events: [] }), null);
assert.equal(actorReloadTiming('mg42', { duration: 5.5 }), null);

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Moving reload</title>'); return; }
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
  const render = mode => page.evaluate(async ({ mode, rigEvents }) => {
    const { createAudio } = await import('/fun/hedgerow/js/audio.js');
    const ctx = new OfflineAudioContext(2, 44100 * 12, 44100);
    let clock = 0, state = 'running', age = 0, available = true;
    const actor = { x: -3, y: 0, z: 2 }, emissions = [], paths = [];
    Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => state });
    const panner = ctx.createStereoPanner.bind(ctx);
    ctx.createStereoPanner = () => { emissions.push({ when: clock, age, ...actor }); return panner(); };
    const realContext = window.AudioContext, realFetch = window.fetch;
    window.AudioContext = function () { return ctx; }; window.fetch = async () => new Response('', { status: 404 });
    const audio = createAudio(); audio.prepare(); await audio.loadSamples();
    window.AudioContext = realContext; window.fetch = realFetch;
    audio.setListener(0, 1.6, 0, 0);
    audio.setOcclusionProbe((lx, ly, lz, x, y, z) => {
      paths.push({ when: clock, x, y, z }); return mode === 'cover' && x > 0 ? { surface: 'stone', t: 1 } : null;
    });
    clock = .1;
    const kind = mode === 'rifle' ? 'kar98k' : mode === 'mg' ? 'mg42' : 'mp40';
    const duration = kind === 'kar98k' ? 3.2 : kind === 'mg42' ? 5.5 : 2.6;
    const handle = audio.reloadActor(kind, () => available ? actor : null, { duration, events: kind === 'kar98k' ? rigEvents.reload : kind === 'mp40' ? rigEvents.reload_smg : null });
    const born = { ...audio.actorActionStatus, buses: audio.nodeStatus.oneShotBuses, paths: paths.length, emissions: emissions.length };
    const peer = mode === 'peer' ? audio.reloadActor('mp40', () => ({ x: 3, y: 0, z: 2 }), { duration: 2.6, events: rigEvents.reload_smg }) : null;
    let paused = null, budget = null;
    if (mode === 'budget') {
      for (let i = 0; i < 99; i++) audio.reloadActor('mp40', () => actor, { duration: 2.6, events: rigEvents.reload_smg });
      budget = { ...audio.actorActionStatus, buses: audio.nodeStatus.oneShotBuses, paths: paths.length };
      audio.setOutdoors(false);
    } else if (mode === 'finish' || mode === 'cancel-final') {
      clock = .4; age = 2.6; actor.x = 1;
      handle.advance(2.6);
      if (mode === 'finish') handle.finish(); else handle.cancel();
    } else {
      const factor = mode === 'slow' ? 4 : 1;
      for (let frame = 1; frame <= 116; frame++) {
        age = frame * .05; clock = .1 + age * factor;
        if (clock > 11.5) break;
        actor.x = -3 + Math.min(age, 2.6) * 2;
        if (mode === 'pause' && frame === 4) {
          const before = { ...audio.actorActionStatus }; state = 'suspended'; handle.advance(2);
          paused = { before, after: { ...audio.actorActionStatus } }; state = 'running';
        }
        if ((mode === 'cancel' || mode === 'peer') && frame === 20) handle.cancel();
        if (mode === 'invalid' && frame === 20) available = false;
        if (mode === 'menu' && frame === 20) audio.setOutdoors(false);
        if (mode === 'player-switch' && frame === 20) { audio.cancelActions(); audio.switchWeapon(); }
        handle.advance(.05);
        peer?.advance(.05);
      }
    }
    const dispatched = audio.actorActionStatus;
    const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const energy = (from, to) => {
      let l = 0, r = 0, peak = 0;
      for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++) { l += left[i] ** 2; r += right[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); }
      return { left: l, right: r, sum: l + r, peak };
    };
    let first = null;
    for (let i = 0; i < left.length; i++) if (Math.max(Math.abs(left[i]), Math.abs(right[i])) > .00001) { first = i / 44100; break; }
    return { born, paused, budget, dispatched, final: audio.actorActionStatus, nodes: audio.nodeStatus,
      emissions, paths, first, early: energy(.1, .4), beforeMove: energy(.4, 1.1), afterMove: energy(1.7, 2.7), late: energy(1.5, 5.9), finishTail: energy(.43, .47) };
  }, { mode, rigEvents });
  const results = {};
  for (const mode of ['normal', 'slow', 'pause', 'cover', 'cancel', 'invalid', 'menu', 'player-switch', 'peer', 'finish', 'cancel-final', 'rifle', 'mg', 'budget']) results[mode] = await render(mode);
  for (const result of Object.values(results)) {
    assert.equal(result.born.sources, 0); assert.equal(result.born.buses, 0); assert.equal(result.born.paths, 0); assert.equal(result.born.emissions, 0, 'reload birth allocates descriptors without a future sound path');
    assert.equal(result.final.active + result.final.sources + result.final.pending, 0); assert.equal(result.nodes.oneShotBuses, 0);
  }
  assert.equal(results.normal.dispatched.dispatched, 9); assert.equal(results.normal.emissions.length, 9);
  assert.ok(results.normal.first > .4 && results.normal.first < .47); assert.equal(results.normal.early.peak, 0);
  assert.ok(results.normal.beforeMove.right > results.normal.beforeMove.left * 2, 'early cues come from the moving actor to the listener’s right');
  assert.ok(results.normal.afterMove.left > results.normal.afterMove.right * 2, 'late cues move with the soldier across the listener');
  const seat = results.normal.emissions.find(emission => Math.abs(emission.age - Math.ceil(smg.seated / .05) * .05) < 1e-6);
  assert.ok(seat && Math.abs(seat.age - smg.seated) <= .05, 'magazine seating follows the real rig event rather than the player’s shorter sequence');
  assert.ok(results.slow.first > 1.5 && results.slow.first < 1.57);
  assert.deepEqual(results.slow.emissions.map(({ age, x, y, z }) => ({ age, x, y, z })), results.normal.emissions.map(({ age, x, y, z }) => ({ age, x, y, z })), '4x slower wall cadence retains identical simulation poses for every beat');
  assert.deepEqual(results.pause.paused.before, results.pause.paused.after);
  assert.ok(results.cover.afterMove.sum < results.normal.afterMove.sum * .65, 'new cues use the current cover material path');
  for (const mode of ['cancel', 'invalid', 'menu']) { assert.equal(results[mode].late.peak, 0); assert.equal(results[mode].dispatched.dispatched, 3); }
  assert.equal(results['player-switch'].dispatched.dispatched, 9, 'a player weapon switch cannot cancel an NPC reload');
  assert.equal(results.peer.dispatched.dispatched, 12); assert.ok(results.peer.late.peak > .001, 'canceling one NPC preserves the other soldier’s reload');
  assert.ok(results.finish.finishTail.peak > .001, 'normal completion preserves an already-emitted final beat even on a long step');
  assert.ok(results['cancel-final'].finishTail.peak < .000001, 'death/reset cancellation stops the beat below -120 dBFS, allowing only numerical filter residue');
  assert.equal(results.rifle.dispatched.dispatched, 12); assert.equal(results.mg.dispatched.dispatched, 14);
  assert.equal(results.budget.budget.active, 12); assert.equal(results.budget.budget.pending, 108); assert.equal(results.budget.budget.evicted, 88); assert.equal(results.budget.budget.paths + results.budget.budget.buses, 0);
  console.log('audio-actors-check: shipped rig event timing, moving real PCM/cover, 4x slow simulation, pause, death/null/menu cancellation, independent player switch, 12-actor descriptor budget and complete cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
