// Fixed mounted receivers stay at the real gun while their operators crouch.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiFixture, soldier, advance, forceCombat } from './ai-fixture.mjs';
import { parseUntexturedGLB } from './rig-fixture.mjs';
import { chromium } from 'playwright';
const THREE = await import('three');
const { readSet, worldAnchor, worldColliders } = await import('../js/assets.js');
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const models = new Map();
readSet(await parseUntexturedGLB('weapons'), 'weapons', models);
readSet(await parseUntexturedGLB('military'), 'military', models);
const rig = await parseUntexturedGLB('soldier');
const sampleTotal = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8')).assets.length;
const scenarios = [];
for (const name of ['bunker', 'mg_nest']) {
  const model = models.get(name), anchor = worldAnchor(model, 'gunner', 0, 0, 0, 0);
  let gun;
  if (name === 'bunker') {
    const slit = worldAnchor(model, 'slit', 0, 0, 0, 0), dx = anchor[0] - slit[0], dz = anchor[2] - slit[2], distance = Math.hypot(dx, dz);
    gun = [slit[0] + dx / distance * .7, slit[1] - .22, slit[2] + dz / distance * .7, 0];
  } else gun = worldAnchor(model, 'gun', 0, 0, 0, 0);
  const colliders = worldColliders(model, 0, 0, 0, 0, 1, name === 'bunker' ? 'stone' : 'sandbag');
  const { G, enemies } = aiFixture({ player: [0, 16], models, soldierModel: rig, boxes: colliders,
    definitions: [soldier(anchor[0], anchor[2], { type: 'mg', gun, anchor, arc: .8 })] });
  const enemy = enemies.list[0], frames = [], hand = new THREE.Vector3(), expected = new THREE.Vector3();
  let options = null, age = 0;
  G.audio.reloadActor = (kind, getter, profile) => {
    assert.equal(kind, 'mg42'); options = profile;
    return {
      advance(dt) {
        age += dt;
        const point = getter(); assert.ok(point, 'a live mounted reload provides its world point');
        expected.set(0, .300, -.552); enemy.mg.mesh.updateMatrixWorld(true); expected.applyMatrix4(enemy.mg.mesh.matrixWorld);
        assert.ok(expected.distanceTo(point) < 1e-6, 'the runtime getter follows the mounted receiver, not the crouching hand');
        enemy.char.boneWorld('hand_r', hand);
        frames.push({ time: G.time, age, feet: { ...enemy.pos }, receiver: { ...point }, hand: { ...hand }, stance: enemy.stance });
      }, cancel() {}, finish() {},
    };
  };
  advance(G, enemies, .3); forceCombat(enemy, G);
  Object.assign(enemy, { sees: true, exposure: 1, perceiveTimer: 1e6, mag: 1, aimTimer: 0, fireTimer: 0 });
  advance(G, enemies, .1); enemy.fireTimer = 1e6;
  assert.ok(options); assert.equal(options.heightOffset, 0); assert.equal(options.duration, 5.5);
  advance(G, enemies, enemy.reloadTotal + .1);
  assert.ok(frames.length > 150 && frames.some(frame => frame.stance === 'crouch' && frame.hand.y < .7 && frame.receiver.y > 1.2));
  scenarios.push({ name, options, colliders, frames, listener: name === 'bunker' ? { x: -5, y: .8, z: 13 } : { x: -6, y: .8, z: 4 } });
  for (const actor of enemies.list) actor.char.dispose();
}
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.end('<!doctype html><title>Mounted receiver source PCM</title>'); return; }
  try {
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    assert.ok(file.startsWith(root + sep)); response.setHeader('Content-Type', file.endsWith('.ogg') ? 'audio/ogg' : 'text/javascript');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const results = {};
  for (const scenario of scenarios) {
    results[scenario.name] = {};
    for (const mode of ['default', 'explicit', 'receiver', 'hand', 'clear', 'cancel', 'muted']) {
      results[scenario.name][mode] = await page.evaluate(async ({ scenario, mode }) => {
        const { createAudio } = await import('/fun/hedgerow/js/audio.js');
        const { createWorld, SHOT } = await import('/fun/hedgerow/js/world.js');
        const world = createWorld({ minX: -120, maxX: 120, minZ: -120, maxZ: 180 });
        if (mode !== 'clear') for (const collider of scenario.colliders) world.add(collider);
        const sampleRate = 16000, ctx = new OfflineAudioContext(2, sampleRate * 8, sampleRate); let clock = 0;
        Object.defineProperty(ctx, 'currentTime', { get: () => clock }); Object.defineProperty(ctx, 'state', { get: () => 'running' });
        const originalContext = window.AudioContext; window.AudioContext = function () { return ctx; };
        const audio = createAudio(); audio.setAmbience({ rain: 0, wind: [0, 0] }); audio.prepare(); await audio.loadSamples();
        window.AudioContext = originalContext; audio.setMix({ ambience: 0, effects: mode === 'muted' ? 0 : 1 }); audio.setOutdoors(true);
        const listener = scenario.listener;
        audio.setListener(listener.x, listener.y, listener.z, 0);
        const paths = [];
        audio.setOcclusionProbe((lx, ly, lz, x, y, z) => {
          const dx = x - lx, dy = y - ly, dz = z - lz, d = Math.hypot(dx, dy, dz);
          const hit = world.raycast(lx, ly, lz, dx / d, dy / d, dz / d, Math.max(0, d - .25), SHOT, { noWater: true });
          paths.push({ x, y, z, blocked: !!hit, surface: hit?.surface, clock }); return hit;
        });
        let row = scenario.frames[0];
        const exact = !['default', 'explicit'].includes(mode);
        const getter = () => exact ? mode === 'hand' ? row.hand : row.receiver : row.feet;
        clock = row.time - row.age;
        const handle = audio.reloadActor('mg42', getter, { ...scenario.options, heightOffset: exact ? 0 : mode === 'explicit' ? 1.2 : undefined });
        let previous = 0;
        for (row of scenario.frames) {
          clock = row.time;
          if (mode === 'cancel' && row.age > 1) handle.cancel();
          handle.advance(row.age - previous); previous = row.age;
        }
        handle.finish(); const dispatched = audio.actorActionStatus;
        const rendered = await ctx.startRendering(), left = rendered.getChannelData(0), right = rendered.getChannelData(1);
        let energy = 0, peak = 0, late = 0;
        for (let i = 0; i < left.length; i++) {
          if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw Error('non-finite PCM');
          energy += left[i] ** 2 + right[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
          if (i >= 2 * sampleRate) late += left[i] ** 2 + right[i] ** 2;
        }
        return { listener, energy, peak, late, paths, dispatched, final: audio.actorActionStatus, samples: audio.sampleStatus, nodes: audio.nodeStatus, acoustics: audio.acousticStatus };
      }, { scenario, mode });
    }
  }
  for (const modes of Object.values(results)) {
    for (const result of Object.values(modes)) {
      assert.equal(result.final.active + result.final.sources + result.final.pending, 0); assert.equal(result.samples.active + result.nodes.oneShotBuses, 0);
      assert.equal(result.samples.ready, sampleTotal); assert.equal(result.samples.failed, 0);
      assert.ok(result.acoustics.peakQueries <= 4);
    }
    assert.ok(Math.abs(modes.explicit.energy - modes.default.energy) < modes.default.energy * 1e-6);
    assert.equal(modes.receiver.paths.length, modes.default.paths.length, 'receiver placement adds no acoustic queries in these actual mount trajectories');
    assert.equal(modes.receiver.dispatched.dispatched, 14); assert.equal(modes.default.dispatched.dispatched, 14);
    assert.ok(modes.default.paths.some(p => p.blocked)); assert.ok(!modes.receiver.paths.some(p => p.blocked));
    assert.ok(modes.receiver.energy > modes.default.energy * 2, 'current receiver transmits through its existing slit/nest opening');
    assert.ok(modes.receiver.energy > modes.hand.energy * 2, 'the operator ducks but the fixed weapon receiver stays raised');
    assert.ok(Math.abs(modes.receiver.energy - modes.clear.energy) < modes.clear.energy * 1e-6, 'this actual opening is clear at the receiver');
    assert.equal(modes.cancel.late, 0); assert.equal(modes.muted.peak, 0);
  }
  const outputDirectory = resolve(root, process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
  const reportPath = resolve(outputDirectory, 'audio-mounted-source-report.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(results, null, 2));
  console.log('audio-mounted-source-check: actual mounted rigs/crouch, shipped bunker/nest openings, canonical 14-beat PCM, old/default controls, mute/cancel and complete cleanup pass');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
