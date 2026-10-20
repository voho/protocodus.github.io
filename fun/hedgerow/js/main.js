/* Hedgerow — boot, menus and the frame loop.

   URL switches for testing: ?debug (stats overlay), ?god (no damage),
   ?fly (free camera, no soldiers), ?at=x,z (start somewhere else),
   ?go (skip the menus straight to the briefing). */

import * as THREE from 'three';
import { DEFAULT_SETTINGS, DIFFICULTY, QUALITY } from './config.js';
import { loadTextures, createMaterialLibrary } from './materials.js';
import { loadModels } from './assets.js';
import { createSky } from './sky.js';
import { createWeather } from './weather.js';
import { createLighting } from './lights.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createEvents } from './events.js';
import { createCameraRig } from './camera.js';
import { createPlayer } from './player.js';
import { createEnemies } from './ai.js';
import { createExplosives, createDebris } from './combat.js';
import { createMission } from './mission.js';
import { buildLevel } from './levelBuild.js';
import { createBloom, canRenderHalfFloat } from './bloom.js';
import { createGrade } from './post.js';
import { createHalos, createMist, createDecals } from './atmosphere.js';
import { formatTime, clamp, rng } from './util.js';
import LEVEL from './levels/saint-clair.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const FLY = params.has('fly');
const GOD = params.has('god');
const AT = params.get('at')?.split(',').map(Number);

const canvas = document.getElementById('stage');
const $ = (s) => document.querySelector(s);
const screenEls = Object.fromEntries([...document.querySelectorAll('[data-screen]')].map(e => [e.dataset.screen, e]));
const fade = $('[data-fade]');

/* ---------- settings ---------- */

const settings = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('hedgerow.settings') || '{}'); } catch { s = {}; }
  return { ...DEFAULT_SETTINGS, ...s };
})();
const saveSettings = () => { try { localStorage.setItem('hedgerow.settings', JSON.stringify(settings)); } catch { /* private mode */ } };

/* ---------- screens ---------- */

let screenStack = [];
function show(name) {
  for (const [k, el] of Object.entries(screenEls)) el.classList.toggle('on', k === name);
  if (name) screenStack.push(name);
}
function back() {
  screenStack.pop();
  const prev = screenStack.pop();
  show(prev || (state === 'paused' ? 'pause' : 'start'));
}

/* ---------- state ---------- */

let renderer, scene, camera, G = null, input, hud, audio;
let state = 'loading';
let quality = QUALITY[settings.quality] || QUALITY.high;
let built = null, player = null, enemies = null, mission = null, explosives = null;
let bloom = null, grade = null;
let missionTime = 0;
const shared = { wet: { value: 1 }, time: { value: 0 }, rain: { value: 1 } };

function setLoading(frac, label) {
  const f = $('[data-loading-fill]');
  f.style.width = `${(frac * 100).toFixed(0)}%`;
  $('[data-loading-bar]').setAttribute('aria-valuenow', Math.round(frac * 100));
  if (label) $('[data-loading-label]').textContent = label;
}
const nextPaint = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 120); });

async function boot() {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) { error('Hedgerow needs WebGL 2, which this browser or device does not provide.'); return; }
  const hdr = canRenderHalfFloat(probe);
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
    outputBufferType: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.7;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.info.autoReset = false;

  scene = new THREE.Scene();
  const fogColor = new THREE.Color(LEVEL.fog.color);
  scene.fog = new THREE.FogExp2(fogColor, LEVEL.fog.density);
  scene.background = fogColor;
  camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 1700);

  input = createInput(canvas);
  hud = createHud($('[data-hud]'));
  audio = createAudio();
  audio.setVolume(settings.volume);
  const events = createEvents();

  setLoading(0.02, 'Loading textures');
  const textures = await loadTextures('assets/textures', (f) => setLoading(0.02 + f * 0.13));
  setLoading(0.15, 'Loading models');
  const lib = await loadModels('assets/models', ['village', 'military', 'nature', 'weapons', 'soldier'], (f) => setLoading(0.15 + f * 0.45));
  setLoading(0.62, 'Laying out Saint-Clair');
  await nextPaint();

  const matlib = createMaterialLibrary(textures, shared);
  const fogUniforms = { color: { value: fogColor }, density: { value: LEVEL.fog.density } };
  G = {
    scene, camera, renderer, input, hud, audio, events, settings, shared, textures, matlib,
    models: lib.models, soldier: lib.soldier, level: LEVEL,
    diff: DIFFICULTY[settings.difficulty] || DIFFICULTY.regular,
    time: 0, lightning: 0, godMode: GOD,
    stats: freshStats(),
  };
  G.effects = createEffects({ fog: fogUniforms });
  scene.add(G.effects.group);
  G.lights = createLighting(scene, { pool: 8 });
  const sky = createSky({ fog: LEVEL.fog.color });
  scene.add(sky.mesh);
  G.sky = sky;
  G.halos = createHalos(LEVEL.fog.density);
  scene.add(G.halos.group);
  G.decals = createDecals();
  scene.add(G.decals.group);

  built = buildLevel(G, LEVEL, quality);
  G.cover = built.cover;
  G.effects.setGround((x, z) => G.terrain.height(x, z));
  setLoading(0.85, 'Rain over Normandy');
  await nextPaint();

  G.mist = createMist({ terrain: G.terrain, density: LEVEL.mist || (() => 0.6) });
  scene.add(G.mist.mesh);
  G.weather = createWeather({
    count: quality.rain, terrain: G.terrain,
    onThunder: (t) => audio.thunder(t),
  });
  scene.add(G.weather.group);

  // reflections: the dusk sky as an environment map
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = createSky({ fog: LEVEL.fog.color });
  envSky.mesh.material.depthTest = false;
  envScene.add(envSky.mesh);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
  scene.environmentIntensity = 0.8;

  G.rig = createCameraRig(camera, G.world);

  // post
  if (hdr) {
    bloom = createBloom({ strength: 0.22, threshold: 1.2, knee: 0.8 });
    grade = createGrade();
    applyGraphics();
  }

  // warm up: compile shaders with everything visible
  setLoading(0.95, 'Checking weapons');
  await nextPaint();
  camera.position.set(0, 4, -10);
  camera.lookAt(0, 2, 20);
  renderer.compile(scene, camera);

  setLoading(1, 'Ready');
  $('[data-loading]').hidden = true;
  $('[data-menu]').hidden = false;
  showBest();
  state = 'menu';
  fade.classList.remove('on');
  if (params.has('go')) openBriefing();
  if (FLY) startFly();
  // ?test=<glb path>&at=x,z: drop a model in front of the free camera (pipeline checks)
  if (params.get('test')) {
    const { GLTFLoader } = await import('../assets/vendor/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(params.get('test'));
    const x = AT ? AT[0] : 0, z = AT ? AT[1] + 14 : 10;
    gltf.scene.traverse((o) => { if (o.isMesh) o.material = G.matlib.resolve(o.material); });
    gltf.scene.position.set(x, G.terrain.height(x, z), z);
    gltf.scene.rotation.y = Math.PI;
    scene.add(gltf.scene);
  }
  requestAnimationFrame(frame);
}

function error(text) {
  $('[data-loading]').hidden = true;
  $('[data-error]').hidden = false;
  $('[data-error-text]').textContent = text;
}

function freshStats() {
  return { kills: 0, headshots: 0, shots: 0, hits: 0, headHits: 0, grenades: 0, damageTaken: 0, deaths: 0, objectives: 0 };
}

function applyGraphics() {
  quality = QUALITY[settings.quality] || QUALITY.high;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (bloom) renderer.setEffects(quality.bloom ? [bloom, grade] : [grade]);
  G?.weather?.setCount(quality.rain);
  if (G?.rig) { G.rig.baseFov = settings.fov; }
  if (G) G.diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.regular;
}

/* ---------- mission flow ---------- */

function openBriefing() {
  $('[data-briefing-title]').textContent = LEVEL.title;
  $('[data-briefing-when]').textContent = LEVEL.when;
  const t = $('[data-briefing-text]');
  t.innerHTML = '';
  for (const para of LEVEL.briefing) { const p = document.createElement('p'); p.textContent = para; t.append(p); }
  const ul = $('[data-briefing-goals]');
  ul.innerHTML = '';
  for (const o of LEVEL.objectives) { const li = document.createElement('li'); li.textContent = o.text; ul.append(li); }
  show('briefing');
}

function startMission() {
  audio.init();
  if (!player) {
    player = createPlayer(G);
    G.player = player;
    explosives = createExplosives(G);
    G.explosives = explosives;
    G.debris = createDebris(G);
    enemies = createEnemies(G, built.enemyDefs);
    G.enemies = enemies.list;
    mission = createMission(G, LEVEL, built);
    G.mission = mission;
    G.events.on('playerDied', onDeath);
    G.events.on('missionComplete', onComplete);
    mission.start();
  }
  const spawn = AT ? [AT[0], AT[1], 0] : LEVEL.start;
  player.reset(spawn);
  hud.weapon('M1 Garand', player.ammo.garand, player.grenades);
  missionTime = 0;
  G.stats = freshStats();
  resume();
  hud.notice(LEVEL.title, LEVEL.when, 4);
}

function resume() {
  state = 'playing';
  show(null);
  screenStack = [];
  hud.show(true);
  document.body.classList.add('playing');
  input.enable(true);
  input.requestLock();
  audio.resume();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  input.enable(false);
  document.body.classList.remove('playing');
  $('[data-pause-objective]').textContent = mission?.done ? '' : (LEVEL.objectives[mission?.index ?? 0]?.text || '');
  show('pause');
}

function onDeath() {
  G.stats.deaths++;
  setTimeout(() => {
    if (state !== 'playing') return;
    state = 'dead';
    input.enable(false);
    input.exitLock();
    document.body.classList.remove('playing');
    show('dead');
  }, 2600);
}

function retryCheckpoint() {
  const { spawn, inventory } = mission.restoreCheckpoint();
  fade.classList.add('on');
  setTimeout(() => {
    explosives.clear();
    G.debris.clear();
    enemies.resetLiving();
    player.reset(spawn, inventory);
    fade.classList.remove('on');
  }, 350);
  resume();
}

function onComplete() {
  setTimeout(() => {
    state = 'complete';
    input.enable(false);
    input.exitLock();
    document.body.classList.remove('playing');
    const s = G.stats;
    const acc = s.shots ? s.hits / s.shots : 0;
    const timeBonus = Math.max(0, Math.round((900 - missionTime) * 3));
    const score = s.kills * 100 + s.headshots * 60 + s.objectives * 400 + Math.round(acc * 1500) + timeBonus - s.deaths * 300;
    let best = 0;
    try { best = Number(localStorage.getItem('hedgerow.best') || 0); if (score > best) localStorage.setItem('hedgerow.best', String(score)); } catch { /* */ }
    const rows = [
      ['Time', formatTime(missionTime)], ['Enemies killed', `${s.kills} / ${G.enemies.length}`], ['Headshots', s.headshots],
      ['Accuracy', `${Math.round(acc * 100)} %`], ['Grenades thrown', s.grenades], ['Times down', s.deaths],
      ['Score', score], ['Best', Math.max(best, score)],
    ];
    const dl = $('[data-stats]');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      if (k === 'Score') dd.className = 'score';
      dl.append(dt, dd);
    }
    show('complete');
  }, 2500);
}

function showBest() {
  try {
    const b = Number(localStorage.getItem('hedgerow.best') || 0);
    if (b > 0) { const el = $('[data-best]'); el.hidden = false; el.textContent = `Best score: ${b}`; }
  } catch { /* */ }
}

/* ---------- free camera for testing ---------- */

let fly = null;
function startFly() {
  hud.show(true);
  fly = { yaw: 0, pitch: -0.1, pos: new THREE.Vector3(AT ? AT[0] : 0, 6, AT ? AT[1] : -10) };
  state = 'fly';
  show(null);
  input.enable(true);
  canvas.addEventListener('click', () => input.requestLock());
}
function updateFly(dt) {
  const [mx, my] = input.consumeMouse();
  fly.yaw -= mx * 0.0022; fly.pitch = clamp(fly.pitch - my * 0.0022, -1.5, 1.5);
  const f = new THREE.Vector3(Math.sin(fly.yaw) * Math.cos(fly.pitch), Math.sin(fly.pitch), Math.cos(fly.yaw) * Math.cos(fly.pitch));
  const r = new THREE.Vector3(-Math.cos(fly.yaw), 0, Math.sin(fly.yaw));
  const sp = (input.held('Shift') ? 40 : 10) * dt;
  if (input.held('KeyW')) fly.pos.addScaledVector(f, sp);
  if (input.held('KeyS')) fly.pos.addScaledVector(f, -sp);
  if (input.held('KeyD')) fly.pos.addScaledVector(r, sp);
  if (input.held('KeyA')) fly.pos.addScaledVector(r, -sp);
  if (input.held('KeyE')) fly.pos.y += sp;
  if (input.held('KeyQ')) fly.pos.y -= sp;
  camera.position.copy(fly.pos);
  camera.lookAt(fly.pos.clone().add(f));
}
window.hedgerow = {
  get G() { return G; },
  get input() { return input; },
  flyTo(x, y, z, yaw = 0, pitch = -0.1) { if (!fly) startFly(); fly.pos.set(x, y, z); fly.yaw = yaw; fly.pitch = pitch; },
};

/* ---------- frame ---------- */

const timer = new THREE.Timer();
let fpsAcc = 0, fpsFrames = 0, fps = 0, distantTimer = 12, artyFlash = 0;
const R = rng(5);

let lastStep = 0;
function frame() {
  requestAnimationFrame(frame);
  step();
}
// ?debug: keep stepping when the page gets no animation frames (a hidden
// preview pane), so scripted tests still run
if (DEBUG) setInterval(() => { if (performance.now() - lastStep > 150) step(); }, 40);

function step() {
  lastStep = performance.now();
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  if (!G || !G.weather || !G.rig) return;
  const playing = state === 'playing';
  const live = playing || state === 'dead' || state === 'complete' || state === 'fly';
  if (state === 'paused' || state === 'menu' || state === 'loading') {
    // keep the world alive behind the menus, slowly
    if (state === 'menu' && !player) menuCamera(dt);
  }
  if (live || state === 'menu') G.time += dt;
  shared.time.value = G.time;

  if (playing) {
    missionTime += dt;
    player.update(dt, input, settings);
    enemies.update(dt);
    explosives.update(dt);
    G.debris.update(dt);
    mission.update(dt, input);
    if (input.pressed('Escape')) pause();
    distantTimer -= dt;
    if (distantTimer < 0) {
      if (R() < 0.65) {
        // the flash first, the rumble after it has crossed the distance
        const az = 0.5 + R() * 2.2, km = 3 + R() * 6;
        G.sky.uniforms.uArtyDir.value.set(Math.sin(az), 0, Math.cos(az));
        artyFlash = 1;
        setTimeout(() => audio.distant('artillery'), km * 2900 / 3);
      } else audio.distant('mg');
      distantTimer = 12 + R() * 22;
    }
  } else if (state === 'fly') {
    updateFly(dt);
  } else if (state === 'dead' || state === 'complete') {
    player.update(dt, input, settings);
    enemies.update(dt);
    explosives.update(dt);
    G.debris.update(dt);
  }

  if (state !== 'paused') {
    const flash = G.weather.update(dt, G.time, camera, 1);
    G.lightning = flash;
    G.sky.update(dt, G.time, camera, flash, G.weather.flashDir);
    artyFlash = Math.max(0, artyFlash - dt * 2.2);
    G.sky.uniforms.uArty.value = artyFlash * (0.6 + 0.4 * Math.sin(G.time * 40));
    G.lights.update(dt, G.time, camera.position, flash);
    G.weather.setLights(G.lights.active);
    G.halos?.update(dt, G.time, camera.position);
    G.mist?.update(dt, camera.position, G.time, flash);
    G.effects.update(dt, { x: 1.4, z: 0.6 }, camera.position);
    if (grade) {
      grade.uniforms.uTime.value = G.time;
      const hp = player ? player.health / 100 : 1;
      grade.uniforms.uHurt.value = player && player.alive ? clamp((0.6 - hp) * 1.8, 0, 1) : player ? 0.8 : 0;
    }
  }
  built.veg.update(dt, camera, quality);
  hud.update(dt);
  hud.compass(G.rig.yaw);
  audio.setListener(camera.position.x, camera.position.y, camera.position.z, G.rig.yaw);
  input.endFrame();

  renderer.info.reset();
  renderer.render(scene, camera);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  if (DEBUG) {
    const i = renderer.info;
    const p = player ? player.pos : camera.position;
    const vs = built.veg.stats();
    hud.debug(`${fps.toFixed(0)} fps  ${i.render.calls} calls  ${(i.render.triangles / 1000).toFixed(0)}k tris\n` +
      `veg ${vs.inst} inst ${(vs.tris / 1000).toFixed(0)}k  fx ${G.effects.count}\n` +
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  ${state}`);
  }
}

let menuT = 0;
function menuCamera(dt) {
  menuT += dt * 0.03;
  const x = Math.sin(menuT) * 6, z = 108 + Math.cos(menuT) * 5;
  camera.position.set(x, 3.4, z - 18);
  camera.lookAt(0, 3.5, z + 10);
}

/* ---------- wiring ---------- */

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing') pause();
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  audio?.init();
  if (act === 'briefing') openBriefing();
  else if (act === 'start') startMission();
  else if (act === 'back') back();
  else if (act === 'controls') show('controls');
  else if (act === 'settings') { syncSettingsForm(); show('settings'); }
  else if (act === 'resume') resume();
  else if (act === 'checkpoint') retryCheckpoint();
  else if (act === 'restart') { location.search = '?go'; }
  else if (act === 'quit') { location.search = ''; }
  else if (act === 'retry') location.reload();
});

function syncSettingsForm() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const k = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = settings[k];
  }
}
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-setting]');
  if (!el) return;
  const k = el.dataset.setting;
  settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
  saveSettings();
  if (k === 'volume') audio.setVolume(settings.volume);
  if (G) applyGraphics();
});

window.addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

boot().catch((err) => {
  console.error(err);
  error(`Could not start: ${err.message}`);
});
