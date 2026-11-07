// Actual footfalls require resolved horizontal travel and preserve open-ground cadence.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const THREE = await import('three');
const { createPlayer } = await import('../js/player.js');
const { createWorld } = await import('../js/world.js');
const { createCameraRig } = await import('../js/camera.js');
const { createInput } = await import('../js/input.js');
const { DEFAULT_SETTINGS, PLAYER } = await import('../js/config.js');
const noop = () => {}, services = new Proxy({}, { get: () => noop });

function fixture(createPlayer, scenario) {
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const terrain = {
    height: (x, z) => scenario === 'slope-up' ? z * .15 : scenario === 'slope-down' ? -z * .15 : scenario === 'deep-water' && z >= 2 ? -2 : 0,
    surfaceAt: () => 'mud', raycast: () => Infinity,
  };
  const water = ['wading', 'deep-water'].includes(scenario)
    ? { level: scenario === 'wading' ? .7 : 0, contains: (x, z) => scenario === 'wading' || z >= 2 }
    : null;
  const world = createWorld({ ...bounds, terrain, water });
  if (['wall', 'diagonal-wall'].includes(scenario)) world.add({ type: 'box', x: 0, y: 1, z: 2, hx: 100, hy: 1, hz: .3, surface: 'stone' });
  if (scenario === 'vault') world.add({ type: 'box', x: 0, y: .4, z: 1, hx: 1, hy: .4, hz: .15, surface: 'wood' });
  if (scenario === 'push-out') world.add({ type: 'box', x: 0, y: 1, z: 0, hx: .3, hy: 1, hz: .3, surface: 'stone' });
  const queryCounts = {};
  for (const name of ['groundAt', 'pushOut', 'tooDeep', 'limitUpwardMove', 'surfaceUnder', 'obstacleAhead', 'raycast']) {
    const original = world[name];
    world[name] = (...args) => { queryCounts[name] = (queryCounts[name] || 0) + 1; return original(...args); };
  }
  const audio = [], effects = [], events = [], frames = [];
  const G = {
    time: 0, level: { playBounds: scenario === 'bounds' ? { ...bounds, maxZ: 1.4 } : bounds, loadout: ['mp40', 'kar98k'] },
    terrain, world, camera: new THREE.PerspectiveCamera(68, 1.6, .05, 300), scene: new THREE.Scene(),
    soldier: null, models: new Map(), matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    audio: new Proxy({}, { get: (_, name) => (...args) => audio.push({ name, args, time: G.time }) }),
    effects: new Proxy({}, { get: (_, name) => (...args) => effects.push({ name, args, time: G.time }) }),
    hud: services, lights: services, debris: services, casings: services, explosives: services,
    events: { emit: (name, data) => events.push({ name, data, time: G.time }) }, shared: { wet: { value: .65 } },
    enemies: [], stats: { shots: 0, hits: 0, damageTaken: 0, grenades: 0 },
  };
  G.rig = createCameraRig(G.camera, world);
  const P = createPlayer(G); G.player = P; P.reset([0, scenario === 'vault' ? .3 : 0, 0]);
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const win = new EventTarget(), doc = new EventTarget(), canvas = new EventTarget();
  canvas.requestPointerLock = () => Promise.resolve(); doc.pointerLockElement = canvas;
  globalThis.window = win; globalThis.document = doc;
  const input = createInput(canvas); input.enable(true); doc.dispatchEvent(new Event('pointerlockchange'));
  function event(type, code, button = 0) {
    const e = new Event(type, { cancelable: true });
    if (code) Object.defineProperty(e, 'code', { value: code });
    else Object.defineProperty(e, 'button', { value: button });
    return e;
  }
  function tick(dt) {
    const before = P.pos.clone(), wasVault = !!P.vault, oldSteps = P.steps;
    G.time += dt; P.update(dt, input, DEFAULT_SETTINGS); input.endFrame();
    frames.push({ time: G.time, dt, pos: P.pos.toArray(), vel: P.vel.toArray(), yaw: P.yaw,
      movingSpeed: P.movingSpeed, grounded: P.grounded, wading: P.wading, crouch: P.crouch, sprint: P.sprint,
      vault: P.vault ? { t: P.vault.t, to: P.vault.to.toArray() } : null, wasVault,
      distance: Math.hypot(P.pos.x - before.x, P.pos.z - before.z), steps: P.steps,
      stepAcc: P.stepAcc, emitted: P.steps - oldSteps, shots: G.stats.shots,
      reloading: P.reloading, cooldown: P.cooldown, weapon: P.weapon, ammo: JSON.stringify(P.ammo) });
  }
  return { G, P, audio, effects, events, frames, queryCounts, input, tick,
    key(code, down = true) { win.dispatchEvent(event(down ? 'keydown' : 'keyup', code)); },
    mouse(down, button = 0) { (down ? canvas : win).dispatchEvent(event(down ? 'mousedown' : 'mouseup', null, button)); },
    close() { input.enable(false); P.char.dispose(); globalThis.window = oldWindow; globalThis.document = oldDocument; } };
}

function simulate(createPlayer, scenario, fps) {
  const originalRandom = Math.random; let seed = 417;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const f = fixture(createPlayer, scenario), dt = 1 / fps;
  try {
    if (!['idle', 'vertical-land'].includes(scenario)) f.key('KeyW');
    if (['sprint', 'wall', 'bounds', 'deep-water', 'diagonal-wall'].includes(scenario)) f.key('ShiftLeft');
    if (scenario === 'diagonal-wall') f.key('KeyD');
    if (scenario === 'crouch') { f.key('KeyC'); f.tick(dt); f.key('KeyC', false); }
    if (scenario === 'reload') { f.P.ammo.mp40.mag = 0; f.P.ammo.mp40.reserve = 32; f.key('KeyR'); f.tick(dt); f.key('KeyR', false); }
    if (scenario === 'aim') f.mouse(true, 2);
    if (['jump', 'vault'].includes(scenario)) { f.P.stepAcc = .95; f.key('Space'); }
    if (scenario === 'vertical-land') { f.P.pos.y = 2; f.P.grounded = false; f.P.vel.y = -7; f.P.stepAcc = .95; }
    if (scenario === 'push-out') { f.P.pos.y = 0; f.P.pos.z = .1; f.P.vel.z = PLAYER.run; f.P.stepAcc = .1; }
    if (scenario === 'fire-moving') { f.P.ammo.mp40.reserve = 0; f.mouse(true); }
    const seconds = scenario === 'push-out' ? dt : 4;
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      f.tick(dt);
      if (i === 0 && ['jump', 'vault'].includes(scenario)) f.key('Space', false);
      if (['zero-time', 'pause'].includes(scenario) && i === Math.round(fps / 2)) {
        if (scenario === 'pause') f.input.enable(false);
        const state = { pos: f.P.pos.toArray(), steps: f.P.steps, phase: f.P.stepAcc };
        const calls = f.audio.length, events = f.events.length;
        for (let j = 0; j < 30; j++) f.tick(0);
        assert.deepEqual({ pos: f.P.pos.toArray(), steps: f.P.steps, phase: f.P.stepAcc }, state);
        assert.equal(f.audio.length, calls); assert.equal(f.events.length, events);
        if (scenario === 'pause') { f.input.enable(true); f.key('KeyW'); }
      }
    }
    if (scenario === 'reset') {
      f.P.stepAcc = .95; f.P.reset([5, 5, 0]);
      const phaseAtReset = f.P.stepAcc, audioAtReset = f.audio.length, eventsAtReset = f.events.length;
      for (let i = 0; i < Math.round(.2 * fps); i++) f.tick(dt);
      f.resetResult = { phaseAtReset, footsteps: f.audio.slice(audioAtReset).filter(c => c.name === 'footstep').length,
        noises: f.events.slice(eventsAtReset).filter(c => c.name === 'noise' && c.data.kind === 'step').length };
    }
    const footsteps = f.audio.filter(c => c.name === 'footstep'), stepNoises = f.events.filter(c => c.name === 'noise' && c.data.kind === 'step');
    return { frames: f.frames, footsteps, stepNoises, effects: f.effects, audio: f.audio, queryCounts: f.queryCounts,
      resetResult: f.resetResult, distance: f.frames.reduce((sum, frame) => sum + frame.distance, 0) };
  } finally { f.close(); Math.random = originalRandom; }
}

const report = [];
const openCounts = { walk: 8, sprint: 12, crouch: 4, aim: 5, reload: 7,
  'slope-up': 8, 'slope-down': 8, wading: 4, 'zero-time': 8, pause: 8, 'fire-moving': 8 };
for (const fps of [20, 30, 60, 120]) {
  for (const scenario of ['idle', 'walk', 'sprint', 'crouch', 'aim', 'reload', 'wall', 'bounds', 'deep-water', 'diagonal-wall',
    'slope-up', 'slope-down', 'wading', 'vault', 'jump', 'vertical-land', 'zero-time', 'pause', 'reset', 'push-out', 'fire-moving']) {
    const result = simulate(createPlayer, scenario, fps), final = result.frames.at(-1);
    for (const call of result.footsteps) {
      const frame = result.frames.find(frame => Math.abs(frame.time - call.time) < 1e-9 && frame.dt > 0);
      assert.ok(frame && frame.distance > 0 && frame.grounded && !frame.vault && !frame.wasVault,
        'a footfall needs actual supported non-vault horizontal travel');
      assert.deepEqual(call.args.slice(0, 3), frame.pos, 'the cue uses the actual resolved foot position');
      assert.equal(call.args[3], scenario === 'wading' ? 'water' : 'mud');
      assert.equal(call.args[4], frame.crouch ? .5 : frame.sprint ? 1.2 : .8);
      assert.equal(call.args[5], true); assert.deepEqual(call.args[6], { run: frame.sprint, wet: .65 });
    }
    for (const noise of result.stepNoises) {
      const call = result.footsteps.find(call => call.time === noise.time);
      assert.ok(call && call.args[6].run, 'only a real sprint footfall emits the step hearing event');
      assert.deepEqual(noise.data, { x: call.args[0], y: call.args[1] + .05, z: call.args[2], radius: 12, kind: 'step' });
    }
    if (Object.hasOwn(openCounts, scenario)) assert.equal(result.footsteps.length, openCounts[scenario],
      `${scenario}/${fps}: preserve measured open-ground cadence`);
    if (['wall', 'bounds', 'deep-water'].includes(scenario)) {
      assert.ok(result.frames.filter(frame => frame.time > 1).every(frame => frame.distance < 1e-12));
      assert.equal(result.footsteps.filter(call => call.time > 1).length, 0, 'stationary obstruction cannot produce footfalls');
      assert.equal(result.stepNoises.filter(call => call.time > 1).length, 0, 'stationary obstruction cannot reveal a sprint location');
      assert.ok(final.movingSpeed > 5, 'the fixture preserves the existing intended velocity and movement presentation');
      assert.equal(result.footsteps.length, scenario === 'deep-water' ? 1 : 0);
    }
    if (scenario === 'wall') assert.ok(Math.abs(final.pos[2] - 1.36) < 1e-8);
    if (scenario === 'bounds') assert.equal(final.pos[2], 1.4);
    if (scenario === 'deep-water') assert.ok(final.pos[2] < 2 && final.pos[2] > 1.8);
    if (['idle', 'vertical-land'].includes(scenario)) {
      assert.equal(result.footsteps.length, 0); assert.equal(result.stepNoises.length, 0);
      assert.equal(result.distance, 0);
    }
    if (scenario === 'vertical-land') {
      assert.equal(final.grounded, true); assert.equal(final.pos[1], 0);
      assert.equal(result.audio.filter(call => call.name === 'gear' && call.args[0] === 'land').length, 1,
        'a vertical landing keeps its separate real landing cue');
    }
    if (scenario === 'diagonal-wall') {
      assert.equal(result.footsteps.length, fps === 20 ? 8 : 9);
      assert.ok(Math.abs(final.pos[0]) > 10 && Math.abs(final.pos[2] - 1.36) < 1e-8,
        'real sideways travel along a blocking wall remains audible');
    }
    if (scenario === 'reset') {
      assert.equal(result.resetResult.phaseAtReset, 0); assert.equal(result.resetResult.footsteps, 0);
      assert.equal(result.resetResult.noises, 0, 'a checkpoint starts a fresh fractional stride');
    }
    if (scenario === 'push-out') {
      const intended = Math.hypot(final.vel[0], final.vel[2]) * final.dt;
      assert.ok(final.distance > intended * 2, 'the actual world performs a large initial depenetration');
      assert.ok(final.stepAcc - .1 <= intended / 1.2 + 1e-12, 'depenetration cannot add extra stride');
    }
    if (scenario.startsWith('slope-')) assert.ok(Math.abs(final.pos[1] - final.pos[2] * (scenario === 'slope-up' ? .15 : -.15)) < 1e-8);
    if (scenario === 'wading') {
      assert.equal(final.wading, .7); assert.ok(result.distance > 5 && result.distance < 6);
      assert.equal(result.effects.filter(call => call.name === 'splash').length, result.footsteps.length);
    }
    if (scenario === 'vault') assert.ok(result.frames.some(frame => frame.vault) && result.frames.some(frame => frame.wasVault && !frame.vault));
    if (scenario === 'jump') assert.ok(result.frames.some(frame => !frame.grounded) && final.grounded);
    if (scenario === 'reload') assert.ok(final.reloading <= 0 && JSON.parse(final.ammo).mp40.mag === 32);
    if (scenario === 'fire-moving') {
      assert.ok(final.shots > 20, 'ordinary held fire remains active while walking');
      assert.equal(final.shots + JSON.parse(final.ammo).mp40.mag, 32, 'each actual shot consumes exactly one round');
    }
    if (scenario === 'sprint') assert.equal(result.stepNoises.length, 12);
    if (['walk', 'crouch', 'aim', 'reload', 'wading'].includes(scenario)) assert.equal(result.stepNoises.length, 0);
    report.push({ fps, scenario, distance: result.distance, footsteps: result.footsteps.length,
      stepNoises: result.stepNoises.length, finalPosition: final.pos, reset: result.resetResult });
  }
}
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || 'work/qa');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'player-footsteps-report.json'), JSON.stringify(report, null, 2));
console.log(`player-footsteps-check: ${report.length} actual input/player/world controls preserve grounded cadence and reject stationary/vault/vertical phantom footfalls`);
