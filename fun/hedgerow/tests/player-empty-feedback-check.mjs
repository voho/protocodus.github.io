// Real player empty-feedback lifecycle, including actual between-frame input events.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const THREE = await import('three');
const { createPlayer } = await import('../js/player.js');
const { createWorld } = await import('../js/world.js');
const { createCameraRig } = await import('../js/camera.js');
const { DEFAULT_SETTINGS, WEAPONS } = await import('../js/config.js');
const { createInput } = await import('../js/input.js');
const noop = () => {};
const services = new Proxy({}, { get: () => noop });
function game(loadout) {
  const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  const terrain = { height: () => 0, surfaceAt: () => 'cobble', raycast: () => Infinity };
  const world = createWorld({ ...bounds, terrain });
  const camera = new THREE.PerspectiveCamera(68, 1.6, .05, 300);
  const labels = [], audioCalls = [], effectCalls = [];
  const audio = new Proxy({}, { get: (_, name) => (...args) => audioCalls.push({ name, args, time: G.time }) });
  const effects = new Proxy({}, { get: (_, name) => (...args) => effectCalls.push({ name, args, time: G.time }) });
  const G = { level: { playBounds: bounds, loadout }, time: 0, world, terrain, camera,
    scene: new THREE.Scene(), soldier: null, models: new Map(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: m => m },
    rig: createCameraRig(camera, world), audio, effects, lights: services, debris: services,
    hud: new Proxy({ weapon: (name, ammo) => labels.push({ name, ...ammo }) }, { get: (o, k) => o[k] || noop }),
    events: { emit: noop }, shared: { wet: { value: 1 } }, enemies: [],
    stats: { shots: 0, hits: 0, damageTaken: 0, grenades: 0 }, explosives: services };
  const P = createPlayer(G); G.player = P; P.reset([0, 0, 0]);
  const keys = new Set(), held = new Set(); let trigger = false, wheel = 0;
  const input = { held: key => held.has(key), pressed: k => keys.has(k), fired: () => trigger,
    mouseR: false, mouseL: false, consumeMouse: () => [0, 0], consumeWheel: () => { const w = wheel; wheel = 0; return w; } };
  function tick(key = null, seconds = 1 / 60) {
    if (key) keys.add(key);
    G.time += seconds; P.update(seconds, input, DEFAULT_SETTINGS); keys.clear(); trigger = false;
  }
  function run(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) tick(); }
  return { G, P, labels, audioCalls, effectCalls, input, tick, run,
    hold(key, on = true) { if (on) held.add(key); else held.delete(key); },
    fire() { trigger = true; tick(); }, wheel(value) { wheel = value; tick(); } };
}


const report = [];
const clicks = f => f.audioCalls.filter(call => call.name === 'dryFire');
function empty(f, id = f.P.weapon) { f.P.ammo[id].mag = 0; f.P.ammo[id].reserve = 0; }
for (const id of ['mp40', 'thompson']) {
  const loadout = [id, 'kar98k'];
  {
    const f = game(loadout); empty(f); f.input.mouseL = true; f.fire();
    assert.equal(f.P.cooldown, .25, 'first empty attempt preserves the retry cooldown');
    f.run(2); assert.equal(clicks(f).length, 1, 'a held empty automatic trigger cannot produce the old 4 Hz sound loop');
    assert.equal(f.G.stats.shots, 0); assert.equal(f.P.reloading, 0);
    f.input.mouseL = false; f.run(.3); f.input.mouseL = true; f.fire();
    assert.equal(clicks(f).length, 2, 'a deliberate new press retains its warning');
    report.push({ weapon: id, control: 'hold/release', clicks: clicks(f).length });
  }
  {
    const f = game(loadout); f.P.ammo[id].mag = 2; f.P.ammo[id].reserve = 0;
    f.input.mouseL = true; f.fire(); f.run(1.5);
    assert.equal(f.G.stats.shots, 2); assert.equal(f.P.ammo[id].mag, 0); assert.equal(clicks(f).length, 1);
    assert.equal(f.audioCalls.filter(call => call.name === 'gunshot').length, 2);
    report.push({ weapon: id, control: 'loaded depletion', shots: f.G.stats.shots });
  }
  {
    const f = game(loadout); empty(f); f.input.mouseL = true; f.fire(); f.run(.6);
    f.P.addAmmo(1); f.run(WEAPONS[id].reload + .8);
    assert.equal(clicks(f).length, 1, 'held-empty retries still check newly acquired reserve without repeating the click');
    assert.ok(f.audioCalls.some(call => call.name === 'reload'));
    assert.ok(f.G.stats.shots > 0, 'pickup reload completion still fires normally while held');
    report.push({ weapon: id, control: 'reserve pickup/reload', shots: f.G.stats.shots });
  }
  {
    const f = game(loadout); empty(f); f.input.mouseL = true; f.fire(); f.run(.5);
    f.P.ammo[id].mag = 1; f.run(.6);
    assert.equal(f.G.stats.shots, 1); assert.equal(clicks(f).length, 2, 'a loaded shot rearms feedback for the next empty state');
    report.push({ weapon: id, control: 'loaded refill rearms', clicks: clicks(f).length });
  }
  {
    const f = game(loadout); empty(f); f.input.mouseL = true; f.fire(); f.run(1);
    const saved = f.P.inventory(); f.P.reset([0, 0, 0], saved); f.run(.1);
    assert.equal(clicks(f).length, 2, 'checkpoint reset cannot retain the previous empty feedback latch');
    report.push({ weapon: id, control: 'reset', clicks: clicks(f).length });
  }
  {
    const f = game(loadout); empty(f); f.input.mouseL = true; f.fire(); f.run(.2);
    f.P.damage(1000); f.run(.4); assert.equal(clicks(f).length, 1, 'death cannot create further empty clicks');
    const saved = f.P.inventory(); f.P.reset([0, 0, 0], saved); f.run(.1);
    assert.equal(clicks(f).length, 2);
    report.push({ weapon: id, control: 'death/retry', clicks: clicks(f).length });
  }
}
{
  const f = game(['mp40', 'thompson']); empty(f, 'mp40'); empty(f, 'thompson');
  f.input.mouseL = true; f.fire(); f.run(.2); f.tick('Digit2'); f.run(.6); f.tick('Digit1'); f.run(.6);
  assert.equal(f.P.weapon, 'mp40'); assert.equal(clicks(f).length, 3, 'each newly equipped empty weapon can warn once');
  report.push({ control: 'held weapon switches', clicks: clicks(f).length });
}
for (const id of ['garand', 'kar98k']) {
  const f = game([id, 'mp40']); empty(f);
  for (let i = 0; i < 3; i++) { f.fire(); f.run(.3); }
  assert.equal(clicks(f).length, 3, 'semi-auto deliberate press behavior stays unchanged');
  report.push({ weapon: id, control: 'semi-auto presses', clicks: clicks(f).length });
}

// Use the real input module with event targets so mouse-up/down can occur
// without any intervening player update. A state-only fake cannot catch this.
{
  const hadWindow = Object.hasOwn(globalThis, 'window'), hadDocument = Object.hasOwn(globalThis, 'document');
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const f = game(['mp40', 'kar98k']); empty(f);
  const canvas = new EventTarget(), win = new EventTarget(), doc = new EventTarget();
  canvas.requestPointerLock = () => Promise.resolve();
  doc.pointerLockElement = canvas;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); };
  globalThis.window = win; globalThis.document = doc;
  try {
    const input = createInput(canvas); input.enable(true); doc.dispatchEvent(new Event('pointerlockchange'));
    const event = type => { const e = new Event(type); Object.defineProperty(e, 'button', { value: 0 }); return e; };
    const step = () => { f.G.time += 1 / 60; f.P.update(1 / 60, input, DEFAULT_SETTINGS); input.endFrame(); };
    canvas.dispatchEvent(event('mousedown')); step();
    for (let i = 0; i < 20; i++) step();
    assert.equal(clicks(f).length, 1);
    win.dispatchEvent(event('mouseup')); canvas.dispatchEvent(event('mousedown'));
    assert.equal(input.mouseL, true); assert.equal(input.fired(), true);
    assert.equal(input.fired(), true, 'actual fired() preserves the press without consuming it');
    step();
    for (let i = 0; i < 16; i++) step();
    assert.equal(clicks(f).length, 2, 'between-frame repress rearms feedback after the unchanged retry cooldown');
    for (let i = 0; i < 20; i++) step();
    assert.equal(clicks(f).length, 2);
    input.enable(false); input.enable(true); canvas.dispatchEvent(event('mousedown'));
    step();
    for (let i = 0; i < 16; i++) step();
    assert.equal(clicks(f).length, 3, 'a fresh post-pause press rearms even without an intervening unheld update');
    const beforeWallPause = clicks(f).length;
    await new Promise(done => setTimeout(done, 120));
    assert.equal(clicks(f).length, beforeWallPause, 'wall time without simulation creates no repeat callback');
    report.push({ control: 'actual input between-frame and resume edges', clicks: clicks(f).length });
  } finally {
    if (hadWindow) globalThis.window = oldWindow; else delete globalThis.window;
    if (hadDocument) globalThis.document = oldDocument; else delete globalThis.document;
  }
}
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa'));
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'player-empty-feedback-report.json'), JSON.stringify(report, null, 2));
console.log(`player-empty-feedback-check: ${report.length} actual-player controls preserve first/repeated-press feedback, held silence, refill/reload/switch/death/reset and real between-frame input edges`);
