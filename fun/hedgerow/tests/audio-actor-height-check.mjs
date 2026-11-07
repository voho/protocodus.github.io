// Real crouched reload poses, collision paths and decoded Web Audio PCM.
// This is a module-only browser; no WebGL scene or GPU lease is needed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';

const THREE = await import('three');
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8'));
const sampleTotal = manifest.assets.length;
const wall = { x: 0, y: .5, z: 5, hx: 3, hy: .5, hz: .3, surface: 'stone' };
const fixture = aiFixture({ boxes: [wall], definitions: [soldier(0, 0)], soldierModel: await parseUntexturedGLB('soldier') });
const { G, enemies } = fixture, enemy = enemies.list[0], frames = [], hand = new THREE.Vector3();
G.camera.position.y = 1.6;
let born = null, options = null, age = 0;
G.audio.reloadActor = (_kind, _getPosition, profile) => {
  born = G.time; options = profile;
  return {
    advance(dt) {
      age += dt;
      enemy.char.boneWorld('hand_r', hand);
      frames.push({ time: G.time, age, actor: { ...enemy.pos }, hand: { ...hand }, stance: enemy.stance });
    },
    cancel() {}, finish() {},
  };
};
advance(G, enemies, .25);
forceCombat(enemy, G);
Object.assign(enemy, { sees: true, exposure: 1, perceiveTimer: 1e6, mag: 1, aimTimer: 0, fireTimer: 0, target: { x: 0, z: 0 } });
advance(G, enemies, .1); enemy.fireTimer = 1e6;
advance(G, enemies, 3.3);
assert.ok(frames.length > 60 && frames.some(frame => frame.stance === 'crouch' && frame.hand.y < 1), 'the actual shipped rig completes a moving crouched reload');
for (const actor of enemies.list) actor.char.dispose();
const poses = { born, options, frames, listener: G.camera.position.toArray() };

const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Reload source height PCM</title>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) throw Error('path');
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
  const results = {};
  for (const mode of ['default', 'invalid', 'explicit', 'exact', 'clear', 'cancel', 'budget', 'muted']) {
    results[mode] = await page.evaluate(async ({ mode, poses, wall }) => {
      const { createAudio } = await import('/fun/hedgerow/js/audio.js');
      const { createWorld, SHOT } = await import('/fun/hedgerow/js/world.js');
      const world = createWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 180 });
      if (mode !== 'clear') world.add({ type: 'box', ...wall });
      const sampleRate = 16000, ctx = new OfflineAudioContext(2, sampleRate * 5, sampleRate);
      let clock = 0, calls = 0;
      Object.defineProperty(ctx, 'currentTime', { get: () => clock });
      Object.defineProperty(ctx, 'state', { get: () => 'running' });
      const realContext = window.AudioContext;
      window.AudioContext = function () { return ctx; };
      const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] });
      audio.prepare(); await audio.loadSamples();
      window.AudioContext = realContext;
      audio.setMix({ ambience: 0, effects: mode === 'muted' ? 0 : 1 });
      audio.setOutdoors(true); audio.setListener(...poses.listener, 0);
      const paths = [];
      audio.setOcclusionProbe((lx, ly, lz, x, y, z) => {
        const dx = x - lx, dy = y - ly, dz = z - lz, distance = Math.hypot(dx, dy, dz);
        const hit = world.raycast(lx, ly, lz, dx / distance, dy / distance, dz / distance, Math.max(0, distance - .25), SHOT, { noWater: true });
        paths.push({ time: clock, x, y, z, blocked: !!hit, surface: hit?.surface });
        return hit;
      });
      let row = poses.frames[0], budget = null;
      const exact = ['exact', 'clear', 'cancel', 'muted'].includes(mode);
      const getter = () => { calls++; return exact ? row.hand : row.actor; };
      const heightOffset = exact ? 0 : mode === 'invalid' ? NaN : mode === 'explicit' ? 1.2 : undefined;
      const profile = { ...poses.options, heightOffset };
      clock = poses.born;
      const handle = audio.reloadActor('kar98k', getter, profile);
      const atBirth = { calls, ...audio.actorActionStatus, paths: paths.length };
      if (mode === 'budget') {
        const handles = [handle];
        for (let i = 1; i < 100; i++) handles.push(audio.reloadActor('kar98k', getter, profile));
        for (const current of handles) current.advance(.05);
        const afterAdvance = calls;
        audio.setOutdoors(false);
        for (const current of handles) current.advance(.05);
        budget = { afterAdvance, afterMenu: calls, actions: audio.actorActionStatus };
      } else {
        let previousAge = 0;
        for (row of poses.frames) {
          clock = row.time;
          if (mode === 'cancel' && row.age > 1.1) handle.cancel();
          handle.advance(row.age - previousAge); previousAge = row.age;
        }
        handle.finish();
      }
      const dispatched = audio.actorActionStatus;
      const buffer = await ctx.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      const energy = (from, to) => {
        let total = 0, peak = 0;
        for (let i = Math.floor(from * sampleRate); i < Math.floor(to * sampleRate); i++) {
          if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw Error('non-finite PCM');
          total += left[i] ** 2 + right[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        }
        return { total, peak };
      };
      return { atBirth, dispatched, paths, calls, budget, full: energy(0, 5), late: energy(1.6, 4),
        final: audio.actorActionStatus, samples: audio.sampleStatus, nodes: audio.nodeStatus, acoustics: audio.acousticStatus };
    }, { mode, poses, wall });
  }
  for (const result of Object.values(results)) {
    assert.equal(result.atBirth.calls + result.atBirth.paths + result.atBirth.sources, 0, 'reload birth allocates no source, probe or hand query');
    assert.equal(result.final.active + result.final.pending + result.final.sources, 0);
    assert.equal(result.samples.ready, sampleTotal); assert.equal(result.samples.failed, 0); assert.equal(result.samples.active, 0);
    assert.equal(result.nodes.oneShotBuses, 0); assert.ok(result.acoustics.peakQueries <= 4);
  }
  for (const mode of ['invalid', 'explicit']) {
    assert.ok(Math.abs(results[mode].full.total - results.default.full.total) < results.default.full.total * 1e-6, 'invalid and explicit default height preserve feet-source PCM');
  }
  assert.ok(!results.default.paths.some(path => path.blocked), 'the old fixed feet height clears this low wall');
  assert.ok(results.exact.paths.some(path => path.time > 1.5 && path.blocked && path.y < 1 && path.surface === 'stone'), 'the actual crouched hand source is behind stone cover');
  assert.ok(results.exact.late.total < results.clear.late.total * .5, 'decoded late reload foley loses energy through real low cover');
  assert.equal(results.exact.dispatched.dispatched, 12); assert.equal(results.default.dispatched.dispatched, 12, 'source height preserves simulation beat timing');
  assert.equal(results.cancel.late.peak, 0); assert.equal(results.muted.full.peak, 0);
  assert.equal(results.budget.budget.afterAdvance, 12, 'evicted handles do not retain expensive source getters');
  assert.equal(results.budget.budget.afterMenu, 12, 'global cancellation releases every source getter');
  assert.equal(results.budget.budget.actions.evicted, 88);
  const reportDirectory = resolve(root, process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
  const reportPath = resolve(reportDirectory, 'audio-actor-height-report.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ frames: frames.length, coveredEnergyRatio: results.exact.late.total / results.clear.late.total, results }, null, 2));
  console.log('audio-actor-height-check: actual moving/crouched rig, decoded foley below stone cover, unchanged default height contract, zero-height world points, exact mute, cancellation and bounded getter cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
