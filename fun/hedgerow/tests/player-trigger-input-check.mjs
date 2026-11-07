// Automatic weapons honor preserved short input edges; no buffered shots across gameplay gates.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
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
function game(loadout, createPlayer) {
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
function actualInput(f) {
  const hadWindow = Object.hasOwn(globalThis, 'window'), hadDocument = Object.hasOwn(globalThis, 'document');
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const canvas = new EventTarget(), win = new EventTarget(), doc = new EventTarget();
  canvas.requestPointerLock = () => Promise.resolve(); doc.pointerLockElement = canvas;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); };
  globalThis.window = win; globalThis.document = doc;
  const input = createInput(canvas); input.enable(true); doc.dispatchEvent(new Event('pointerlockchange'));
  const event = (type, code = null) => {
    const e = new Event(type, { cancelable:true });
    Object.defineProperty(e, 'button', { value:0 });
    if(code)Object.defineProperty(e, 'code', { value:code });
    return e;
  };
  const down = () => canvas.dispatchEvent(event('mousedown'));
  const up = () => win.dispatchEvent(event('mouseup'));
  const step = (dt=1/60) => { f.G.time+=dt; f.P.update(dt,input,DEFAULT_SETTINGS); input.endFrame(); };
  const run = (seconds,dt=1/60) => { for(let i=0;i<Math.ceil(seconds/dt);i++)step(dt); };
  return {input,step,run,down,up,tap(){down();up();assert.equal(input.mouseL,false);return input.fired();},
    key(code){win.dispatchEvent(event('keydown',code));step();win.dispatchEvent(event('keyup',code));},
    unlock(){doc.pointerLockElement=null;doc.dispatchEvent(new Event('pointerlockchange'));},
    lock(){doc.pointerLockElement=canvas;doc.dispatchEvent(new Event('pointerlockchange'));},
    close(){if(hadWindow)globalThis.window=oldWindow;else delete globalThis.window;if(hadDocument)globalThis.document=oldDocument;else delete globalThis.document;}};
}
const clicks = f => f.audioCalls.filter(x=>x.name==='dryFire').length;
const shotTimes = f => f.audioCalls.filter(x=>x.name==='gunshot').map(x=>x.time);
function snapshot(f){return {shots:f.G.stats.shots,clicks:clicks(f),ammo:JSON.parse(JSON.stringify(f.P.ammo)),weapon:f.P.weapon,cooldown:f.P.cooldown,reloading:f.P.reloading,switching:f.P.switching,shotTimes:shotTimes(f)};}
function runCase(id,scenario,createPlayer){
  const f=game([id,id==='mp40'?'thompson':'mp40'],createPlayer),r=actualInput(f);
  f.P.ammo[id].mag=WEAPONS[id].mag;f.P.ammo[id].reserve=0;
  try{
    switch(scenario){
      case 'quick-loaded':assert.equal(r.tap(),true);r.step();r.run(.5);break;
      case 'quick-empty':f.P.ammo[id].mag=0;assert.equal(r.tap(),true);r.step();r.run(.8);break;
      case 'sampled-clicks':for(let i=0;i<3;i++){r.down();r.step();r.up();r.run(.3);}break;
      case 'held-empty':f.P.ammo[id].mag=0;r.down();r.step();r.run(2);break;
      case 'cooldown':{
        r.down();r.step();r.up();r.tap();r.step();r.run(.6);
        assert.equal(f.G.stats.shots,1,'a tap during cooldown cannot become a buffered later shot');break;
      }
      case 'reload':{
        f.P.ammo[id].mag=0;f.P.ammo[id].reserve=WEAPONS[id].mag;r.key('KeyR');assert.ok(f.P.reloading>0);
        r.tap();r.step();r.run(WEAPONS[id].reload+.3);
        assert.equal(f.G.stats.shots,0,'reload-gated tap cannot fire later without another press');break;
      }
      case 'switch':{
        r.key('Digit2');assert.ok(f.P.switching>0);r.tap();r.step();r.run(.7);
        assert.equal(f.G.stats.shots,0,'switch-gated tap cannot fire after equip');break;
      }
      case 'pause':{
        r.input.enable(false);r.tap();assert.equal(r.input.fired(),false);r.run(.3);r.input.enable(true);r.run(.3);
        assert.equal(f.G.stats.shots,0,'disabled input cannot leak a buffered shot across resume');break;
      }
      case 'resume-tap':{
        r.input.enable(false);r.input.enable(true);assert.equal(r.tap(),true);r.step();r.run(.4);break;
      }
      case 'lock-loss':{
        r.down();r.unlock();assert.equal(r.input.fired(),false);r.step();r.run(.3);r.lock();r.run(.3);
        assert.equal(f.G.stats.shots,0,'lost pointer lock clears a pending press');break;
      }
      default:{
        assert.ok(scenario.startsWith('held-'));const hz=Number(scenario.slice(5));r.down();r.step(1/hz);r.run(1,1/hz);r.up();r.run(.3,1/hz);
      }
    }
    return snapshot(f);
  }finally{r.close();}
}

const heldCounts = { mp40: {20:7,30:8,60:9,120:9}, thompson: {20:11,30:11,60:11,120:11} };
for (const id of ['mp40', 'thompson']) {
  for (const scenario of ['quick-loaded', 'quick-empty', 'resume-tap', 'sampled-clicks', 'held-empty', 'cooldown', 'reload', 'switch', 'pause', 'lock-loss', 'held-20', 'held-30', 'held-60', 'held-120']) {
    const result = runCase(id, scenario, createPlayer);
    if (['quick-loaded', 'resume-tap'].includes(scenario)) {
      assert.equal(result.shots, 1, 'a complete ready trigger pull between updates fires exactly once');
      assert.equal(result.clicks, 0);
      assert.equal(result.ammo[id].mag, WEAPONS[id].mag - 1);
    } else if (['quick-empty', 'held-empty'].includes(scenario)) {
      assert.equal(result.shots, 0); assert.equal(result.clicks, 1);
      assert.equal(result.ammo[id].mag, 0);
    } else if (scenario === 'sampled-clicks') {
      assert.equal(result.shots, 3); assert.equal(result.clicks, 0);
    } else if (scenario.startsWith('held-')) {
      const hz = Number(scenario.slice(5));
      assert.equal(result.shots, heldCounts[id][hz], 'preserve measured held cadence at each presentation rate');
      assert.equal(result.ammo[id].mag, WEAPONS[id].mag - result.shots);
      for (let i = 1; i < result.shotTimes.length; i++) {
        const gap = result.shotTimes[i] - result.shotTimes[i - 1];
        assert.ok(gap + 1e-9 >= WEAPONS[id].interval && gap <= WEAPONS[id].interval + 1 / hz + 1e-9);
      }
    } else {
      assert.equal(result.shots, scenario === 'cooldown' ? 1 : 0);
      assert.equal(result.clicks, 0);
      assert.ok(result.reloading <= 0 && result.switching <= 0, 'expired gameplay gates remain ready; timers may count below zero');
      if (scenario === 'reload') assert.equal(result.ammo[id].mag, WEAPONS[id].mag);
      if (scenario === 'switch') assert.equal(result.weapon, id === 'mp40' ? 'thompson' : 'mp40');
    }
    report.push({ weapon: id, scenario, result });
  }
}
for (const id of ['garand', 'kar98k']) {
  for (const scenario of ['quick-loaded', 'quick-empty', 'sampled-clicks']) {
    const result = runCase(id, scenario, createPlayer);
    assert.equal(result[scenario === 'quick-empty' ? 'clicks' : 'shots'], scenario === 'sampled-clicks' && id === 'garand' ? 3 : 1);
    assert.equal(result[scenario === 'quick-empty' ? 'shots' : 'clicks'], 0);
    report.push({ weapon: id, scenario, result });
  }
}
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(process.env.HEDGEROW_QA_OUTPUT || resolve(root, 'work/qa'));
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'player-trigger-input-report.json'), JSON.stringify(report, null, 2));
console.log(`player-trigger-input-check: ${report.length} actual input/player controls preserve quick pulls, held cadence, empty feedback, cooldown/reload/switch/pause and semi-auto behavior`);
