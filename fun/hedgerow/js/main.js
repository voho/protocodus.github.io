/* Hedgerow — boot, menus and the frame loop.

   URL switches for testing: ?debug (stats overlay), ?god (no damage),
   ?fly (free camera, no soldiers), ?at=x,z (start somewhere else),
   ?go (skip the menus straight to the briefing), ?mission=<id> (which mission, missions.js). */

import * as THREE from 'three';
import { DIFFICULTY, QUALITY, CAMERA } from './config.js';
import { normalizeSettings } from './settings.js';
import { currentDeviceSupport, MIN_GAME_VIEWPORT } from './device-support.js';
import { SHOT } from './world.js';
import { loadTextures, createMaterialLibrary, updateSmoulder } from './materials.js';
import { createTerrainTextureArrays } from './terrain-textures.js';
import { loadModels } from './assets.js';
import { createSky } from './sky.js';
import { createEnvironmentMaps } from './environment-maps.js';
import { lightingProfileFor } from './lighting-profiles.js';
import { createFlares } from './flares.js';
import { createFlames } from './flames.js';
import { createPlumes } from './plumes.js';
import { createCasings } from './casings.js';
import { createDrips } from './drips.js';
import { dressWalls } from './damage.js';
import { createSteam } from './steam.js';
import { paneRects } from './rooms.js';
import { createSheets } from './cloth.js';
import { createChutes } from './chutes.js';
import { buildCanopy, setCanopyLight } from './canopy.js';
import { createWaysigns } from './signs.js';
import { createConcertina } from './wire.js';
import { printBoots } from './prints.js';
import { createChunks } from './chunks.js';
import { cullPointLights } from './lightloop.js';
import { createFireballs } from './fireball.js';
import { collectPanes, createWindowLight } from './windowlight.js';
import { createWeather } from './weather.js';
import { createLighting } from './lights.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { acousticReflection } from './audio-space.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createEvents } from './events.js';
import { createCameraRig } from './camera.js';
import { createPlayer } from './player.js';
import { createEnemies } from './ai.js';
import { createExplosives, createDebris } from './combat.js';
import { createMission } from './mission.js';
import { buildLevel } from './levelBuild.js';
import { createNav } from './nav.js';
import { breathe, yieldNow, mark } from './pace.js';
import { createLoadingProgress, LOADING_STAGES } from './loading.js';
import { createBloom, canRenderHalfFloat } from './bloom.js';
import { createAdaptation } from './adapt.js';
import { createGrade } from './post.js';
import { createVolumetric } from './volumetric.js';
import { createSSAO } from './ssao.js';
import { createDOF } from './dof.js';
import { createSSR } from './ssr.js';
import { createShafts } from './shafts.js';
import { createTAA } from './taa.js';
import { createMotionBlur } from './motionblur.js';
import { createDistortion } from './distort.js';
import { createGrass } from './grass.js';
import { createGroundMap } from './groundmap.js';
import { createRuts } from './ruts.js';
import { createPonds } from './ponds.js';
import { setFill } from './fill.js';
import { createClutter } from './clutter.js';
import { createHayDetail } from './hay-detail.js';
import { createFieldCrops } from './field-crops.js';
import { createHalos, createMist, createDecals } from './atmosphere.js';
import { formatTime, clamp, lerp, rng, fovScale } from './util.js';
import { MISSIONS, pickMission, bestKey } from './missions.js';
import { proceduralModels } from './procedural.js';
import { CONTROLS } from './controls.js';

// the point lights shade only the pixels they reach (lightloop.js), patched before any material compiles
cullPointLights();

const params = new URLSearchParams(location.search);
// the mission: asked for in the URL, else the last one chosen (one battlefield is built per page)
const MISSION = pickMission(params.get('mission'), (() => { try { return localStorage.getItem('hedgerow.mission'); } catch { return null; } })());
try { localStorage.setItem('hedgerow.mission', MISSION.id); } catch { /* private mode */ }
// its picture until the battlefield can be seen, the title saying which it is
const loadingArt = document.querySelector('[data-loading-art]');
loadingArt.style.backgroundImage = `url("${MISSION.image}")`;
document.querySelector('[data-title-eyebrow]').textContent = MISSION.place;
document.querySelector('[data-title-subtitle]').textContent = MISSION.subtitle;
document.querySelector('[data-title-campaign]').textContent = MISSION.campaign || 'The Normandy campaign';
// One controls list, including the title and pause disclosures.
for (const dl of document.querySelectorAll('[data-controls]')) {
  for (const [k, v] of CONTROLS) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
}
const LEVEL = (await MISSION.load()).default;
const LIGHTING = lightingProfileFor(LEVEL);
const NIGHT_FOG = LEVEL.fog.nightColor || LEVEL.fog.color;
const missionUrl = (id, go = false) => `?mission=${encodeURIComponent(id)}${go ? '&go' : ''}`;
const DEBUG = params.has('debug');
const FLY = params.has('fly');
const GOD = params.has('god');
const AT = params.get('at')?.split(',').map(Number);
const NIGHT_EXPOSURE = 1.7, DAY_EXPOSURE = LIGHTING.exposure;

const canvas = document.getElementById('stage');
const $ = (s) => document.querySelector(s);
const screenEls = Object.fromEntries([...document.querySelectorAll('[data-screen]')].map(e => [e.dataset.screen, e]));
const fade = $('[data-fade]');

/* ---------- settings ---------- */

const menuMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const settings = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('hedgerow.settings') || '{}'); } catch { s = {}; }
  return normalizeSettings(s, { reducedMotion: menuMotion.matches });
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
let graphicsLost = false;
let quality = QUALITY[settings.quality] || QUALITY.high;
// dynamic resolution state (see adaptResolution)
let resScale = 1, resCeiling = 1, resCeilingAge = 0, slowFor = 0, fastFor = 0, frameAvg = 1 / 60, lastFrameAt = 0;
let built = null, player = null, enemies = null, mission = null, explosives = null;
let bloom = null, grade = null, adapt = null, volumetric = null, ssao = null, dof = null, ssr = null, shafts = null, taa = null, distort = null, blur = null;
let chain = [];        // the effects chain as applyGraphics last set it
let missionTime = 0;
let fieldMapData = null;
let analyticsAttemptActive = false, analyticsAttemptStart = 0;
function analyticsAttemptContext() {
  const checkpoint = Number.isInteger(mission?.checkpoint) && mission.checkpoint >= 0 && mission.checkpoint < LEVEL.checkpoints.length ? mission.checkpoint : 0;
  return {
    game_name: 'hedgerow', game_mode: 'mission', level: LEVEL.id,
    difficulty: Object.hasOwn(DIFFICULTY, settings.difficulty) ? settings.difficulty : 'regular', checkpoint,
  };
}
function trackAttemptStart(action = 'mission_start') {
  analyticsAttemptActive = true;
  analyticsAttemptStart = missionTime;
  window.protocodusAnalytics?.track('game_start', { ...analyticsAttemptContext(), action });
}
function trackAttemptEnd(result, score) {
  if (!analyticsAttemptActive) return;
  analyticsAttemptActive = false;
  window.protocodusAnalytics?.track('game_end', {
    ...analyticsAttemptContext(), result,
    duration_seconds: Math.max(0, Math.round(missionTime - analyticsAttemptStart)),
    ...(Number.isFinite(score) ? { score } : {}),
  });
}
const shared = {
  wet: { value: LEVEL.weather?.wetness ?? 1 }, time: { value: 0 }, rain: { value: LEVEL.weather?.rain ?? 1 }, waterLevel: { value: LEVEL.water?.level ?? -1e4 },
  relief: { value: 1 },       // the ground's relief near the eye (terrain.js), by quality
  // the meadow grass's density map and radius, for the ground under it (grass.js, terrain.js)
  grassMap: { value: null }, grassMin: { value: new THREE.Vector2() }, grassSize: { value: new THREE.Vector2(1, 1) }, grassR: { value: 0 },
  rutMap: { value: null }, rutMin: { value: new THREE.Vector2() }, rutSize: { value: new THREE.Vector2(1, 1) },
};

const loadingSteps = $('[data-loading-steps]');
for (const s of LOADING_STAGES) {
  const row = document.createElement('li');
  row.dataset.loadingStep = s.id;
  const name = document.createElement('span');
  name.textContent = s.label;
  const status = document.createElement('span');
  status.dataset.loadingStatus = '';
  status.textContent = 'Waiting';
  row.append(name, status);
  loadingSteps.append(row);
}
const loading = createLoadingProgress(renderLoading);
function renderLoading({ fraction: frac, completed, remaining, stages }) {
  // Reserve 100% for the final ready state, even after rounding.
  const percent = remaining ? Math.min(99, Math.floor(frac * 100)) : 100;
  const current = stages.find(s => s.state === 'loading');
  const label = current?.detail || (remaining ? 'Preparing to load' : 'Ready to move out');
  const f = $('[data-loading-fill]');
  f.style.width = `${percent}%`;
  $('[data-loading-bar]').setAttribute('aria-valuenow', percent);
  $('[data-loading-bar]').setAttribute('aria-valuetext', `${percent}%. ${label}`);
  $('[data-loading-label]').textContent = label;
  const summary = `${completed} of ${stages.length} steps done · ${remaining} left`;
  $('[data-loading-summary]').textContent = summary;
  for (const s of stages) {
    const row = loadingSteps.querySelector(`[data-loading-step="${s.id}"]`);
    row.dataset.state = s.state;
    row.querySelector('[data-loading-status]').textContent = { done: 'Done', loading: 'Loading', waiting: 'Waiting' }[s.state];
  }
  const briefingLoad = $('[data-loading-briefing]');
  briefingLoad.textContent = `${label}. ${summary}.`;
  briefingLoad.hidden = ready;
  // Move out waits for the world, saying how far loading has got
  const go = $('[data-action="start"]');
  go.disabled = !ready;
  go.textContent = ready ? 'Move out' : `Loading ${percent}%`;
}

/* Loading runs behind the menu: the title and the menu are up and answering from the start (the
   briefing can be read, the controls looked at, the settings changed, applied once the world is
   ready), and Move out waits, counting, until it is. Every step of the build leaves the browser its
   turns (breathe(), pace.js; inside the long steps too) and a performance mark ('hedgerow: <step>')
   for a profile to find it by. */
let ready = false, missionStarted = false, hdrChain = false;
// the shader materials made while loading (noted by a hook on Material.setValues until the shaders
// are warm), for warmShaders to compile those nothing draws yet: a pass that only runs under a flare,
// while aiming, on the move
const madeShaders = new Set();
const setValues = THREE.Material.prototype.setValues, copyShader = THREE.ShaderMaterial.prototype.copy;

async function boot() {
  const support = currentDeviceSupport();
  if (!support.supported) {
    $('[data-unsupported-detail]').textContent = support.reason === 'phone'
      ? 'Phones are not supported. Open Hedgerow on a tablet or PC with a keyboard and mouse.'
      : `Enlarge the window to at least ${MIN_GAME_VIEWPORT.width} × ${MIN_GAME_VIEWPORT.height} pixels, then choose Check again.`;
    show('unsupported');
    return;
  }
  loading.update('textures', 0, 'Preparing graphics and sound');
  await yieldNow();
  THREE.Material.prototype.setValues = function (values) { if (this.isShaderMaterial) madeShaders.add(this); return setValues.call(this, values); };
  THREE.ShaderMaterial.prototype.copy = function (source) { madeShaders.add(this); return copyShader.call(this, source); };   // clones
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) { error('Hedgerow needs WebGL 2, which this browser or device does not provide.'); return; }
  const hdr = canRenderHalfFloat(probe);
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
    outputBufferType: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });
  // shadows from the lamp or fire nearest the camera (lights.js); the
  // preset at load decides (switching it later would recompile everything)
  renderer.shadowMap.enabled = !!quality.shadows;
  // PCF (three r185 deprecates PCFSoftShadowMap and swaps it for this on the first shadow render, after
  // the shaders had been compiled for the other: every one that takes shadows was compiled twice)
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = NIGHT_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.info.autoReset = false;

  scene = new THREE.Scene();
  const fogColor = new THREE.Color(NIGHT_FOG);
  scene.fog = new THREE.FogExp2(fogColor, LEVEL.fog.density);
  scene.background = fogColor;
  camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, CAMERA.near ?? 0.1, 1700);

  input = createInput(canvas);
  input.on('unlock', () => pause());
  hud = createHud($('[data-hud]'));
  audio = createAudio();
  audio.setVolume(settings.volume);
  audio.setMix?.({ effects: settings.effectsVolume, ambience: settings.ambienceVolume });
  audio.setAmbience({ ...LEVEL.ambience, frogsHeight: (LEVEL.water?.level ?? 0) + 0.2 });
  const events = createEvents();

  // the sound, opened before the menu is there to be clicked (the browser's first audio context holds
  // the page a quarter of a second; silent until a click starts it)
  mark('sound');
  audio.prepare();

  // the menu at once; until the world is ready Move out shows how far loading has got
  $('[data-menu]').hidden = false;
  showBest();
  if (params.has('go')) openBriefing();

  mark('textures');
  loading.update('textures', 0, 'Loading surface textures');
  const textures = await loadTextures('assets/textures', (f, info) => loading.update('textures', f,
    info ? `Loading textures · ${info.completed} of ${info.total} ready` : 'Loading surface textures'));
  const terrainTextures = createTerrainTextureArrays(renderer, textures);
  textures.groundAlbedo = terrainTextures.albedo;
  textures.groundNormal = terrainTextures.normal;
  loading.update('textures', 1);
  mark('models');
  loading.update('models', 0, 'Loading village, military, nature, weapons and soldiers');
  const lib = await loadModels('assets/models', ['village', 'military', 'nature', 'weapons', 'soldier'], (f, info) => loading.update('models', f,
    `Loading models · ${info.completed} of ${info.total} sets ready`));
  // and the ones modelled in three.js (procedural.js): the glider, the canal bridge, the supply canisters
  for (const [name, m] of proceduralModels()) lib.models.set(name, m);
  loading.update('models', 1);
  // each step of the layout: the bar moves on, the browser gets its turn, the step is marked
  let laid = 0;
  const worldLabels = {
    materials: 'Preparing surfaces and lighting', level: 'Building the village and countryside',
    walls: 'Dressing village walls', boots: 'Adding tracks and ground detail', panes: 'Preparing windows and rooms',
    canopy: 'Building tree canopies', chutes: 'Adding forest details', signs: 'Placing signposts',
    wire: 'Placing barbed wire', casings: 'Preparing battlefield effects', ponds: 'Filling shell-crater pools',
    drips: 'Preparing roof drips', 'ground map': 'Mapping the battlefield ground', ruts: 'Laying wheel ruts',
    grass: 'Growing grass and ground cover', fires: 'Preparing fire and smoke',
    'window light': 'Lighting windows', flares: 'Preparing illumination flares',
  };
  const next = async (name) => { loading.update('world', laid++ / 21, worldLabels[name]); await breathe(); mark(name); };
  await next('materials');

  const matlib = createMaterialLibrary(textures, shared);
  const fogUniforms = { color: { value: fogColor }, density: { value: LEVEL.fog.density } };
  G = {
    scene, camera, renderer, input, hud, audio, events, settings, shared, textures, terrainTextures, matlib,
    models: lib.models, soldier: lib.soldier, level: LEVEL,
    diff: DIFFICULTY[settings.difficulty] || DIFFICULTY.regular,
    time: 0, lightning: 0, godMode: GOD, daylight: false,
    stats: freshStats(),
  };
  G.effects = createEffects({ fog: fogUniforms, camera, wet: shared.wet });
  scene.add(G.effects.group);
  G.lights = createLighting(scene, { pool: 8, shadows: !!quality.shadows, shadowSize: quality.shadows || 256, second: (quality.shadows || 0) >= 512, profile: LIGHTING });
  const sky = createSky({ fog: NIGHT_FOG, profile: LIGHTING });
  scene.add(sky.mesh);
  sky.setFires(G.effects.fires);
  G.sky = sky;
  G.halos = createHalos(LEVEL.fog.density);
  scene.add(G.halos.group);
  // room kept for the damage the walls already carry (damage.js)
  G.decals = await createDecals({ shared, pinned: { stone: 480, wood: 80, spall: 64, sign: 5, boot: 1100 } });
  scene.add(G.decals.group);

  await next('level');
  built = await buildLevel(G, LEVEL, quality);
  G.cover = built.cover;
  audio.setOcclusionProbe((lx, ly, lz, sx, sy, sz) => {
    const dx = sx - lx, dy = sy - ly, dz = sz - lz;
    const distance = Math.hypot(dx, dy, dz);
    return distance < 1 ? null : G.world.raycast(lx, ly, lz,
      dx / distance, dy / distance, dz / distance, Math.max(0, distance - 0.25), SHOT, { noWater: true });
  });
  audio.setFireSources(G.effects.fires);
  G.hayDetail = createHayDetail(built.props, G.matlib);
  if (G.hayDetail) {
    G.hayDetail.group.visible = !!quality.clutter;
    scene.add(G.hayDetail.group);
  }
  G.fieldCrops = createFieldCrops(LEVEL, (x, z) => G.terrain.height(x, z), G.matlib, { shared, wind: LEVEL.ambience?.wind });
  if (G.fieldCrops) {
    G.fieldCrops.group.visible = !!quality.clutter;
    scene.add(G.fieldCrops.group);
  }
  await next('walls');
  dressWalls(G, built.props, LEVEL.lines);
  await next('boots');
  // and the boots that went along the lane and the track before (prints.js)
  printBoots(G, LEVEL.lines);
  await next('panes');
  // the lit windows' glass, for the cracks a bullet leaves in it and the shards it breaks out
  const panes = paneRects(built.props);
  G.decals.setPanes(panes);
  G.effects.setPaneAt(G.decals.paneAt);
  // and white sheets hung from a few of them (cloth.js)
  G.sheets = createSheets(panes, G.world, G.terrain, shared);
  if (G.sheets) scene.add(G.sheets.mesh);
  await next('canopy');
  // and parachutes caught in the trees by the forest track (chutes.js)
  // the crowns over the forest floor, for a flare's light beyond its shadow map (canopy.js)
  await buildCanopy(built.veg, LEVEL.bounds);
  await next('chutes');
  G.chutes = createChutes(built.veg, LEVEL.lines, G.terrain, shared);
  if (G.chutes) scene.add(G.chutes.group);
  await next('signs');
  // the signposts, crowded with the occupiers' painted boards (signs.js)
  G.waysigns = createWaysigns(built.signposts, G.matlib);
  if (G.waysigns) scene.add(G.waysigns);
  await next('wire');
  // and coils of concertina along the barbed wire (wire.js)
  G.concertina = createConcertina(built.wires);
  if (G.concertina) scene.add(G.concertina);
  await next('casings');
  G.effects.setGround((x, z) => G.terrain.height(x, z));
  // the brass thrown out of the gun (casings.js), lying where it falls
  G.casings = createCasings(G);
  scene.add(G.casings.group);
  G.effects.setCasings(G.casings);
  // and the clods and stones a blast throws (chunks.js)
  G.chunks = createChunks(G);
  scene.add(G.chunks.mesh);
  // steam off the barrel of the gun in your hands after it has fired in the rain (steam.js)
  G.steam = createSteam(G, shared.rain);
  await next('ponds');
  // rainwater standing in the shell craters (ponds.js)
  G.ponds = createPonds(LEVEL.craters, G.terrain, textures, shared);
  if (G.ponds) scene.add(G.ponds.mesh);
  await next('drips');
  // the rain dripping off the eaves (drips.js)
  G.drips = createDrips(built.props, G.terrain);
  G.drips.drawLate(null, scene);
  await next('ground map');
  // what grows and lies where; the meadow grass blade by blade round the camera, stones and twigs at your feet
  G.groundMap = createGroundMap(G.terrain, G.world, LEVEL.water?.level ?? -1e4, G.ponds?.list);
  await next('ruts');
  // the lanes' wheel ruts (ruts.js, drawn by the terrain)
  const ruts = createRuts(LEVEL.lines);
  if (ruts) { shared.rutMap.value = ruts.tex; shared.rutMin.value.copy(ruts.min); shared.rutSize.value.copy(ruts.size); }
  await next('grass');
  G.grass = createGrass({ map: G.groundMap, shared, n: quality.blades ?? 0, shocks: G.effects.shocks });
  scene.add(G.grass.mesh);
  G.clutter = createClutter({ map: G.groundMap, shared, on: quality.clutter ?? 0 });
  scene.add(G.clutter.group);
  await next('fires');
  // the fires' flames, drawn as flame (flames.js)
  G.flames = createFlames(G.effects);
  G.flames.drawLate(null, scene);
  // and their smoke climbing into the sky (plumes.js)
  G.plumes = createPlumes(G.effects, { fog: fogUniforms });
  G.plumes.drawIn(null, scene);
  // and the blasts' fireballs (fireball.js)
  G.fireballs = createFireballs(G.effects);
  G.fireballs.drawLate(null, scene);
  await next('window light');
  // the light falling out of the lit windows (windowlight.js)
  G.windowLight = createWindowLight(collectPanes(scene));
  await next('flares');
  // illumination flares over the front, now and then (their shadows at four times the lamps' map size)
  G.flares = createFlares(G, { shadows: quality.shadows ? quality.shadows * 4 : 0 });
  loading.update('world', 18 / 21, 'Preparing rain and mist');
  await yieldNow();
  mark('weather');

  G.mist = createMist({ terrain: G.terrain, water: built.water, groundMap: G.groundMap, density: LEVEL.mist || (() => 0.6) });
  scene.add(G.mist.mesh);
  G.weather = createWeather({
    count: rainCount(), capacity: QUALITY.high.rain * (LEVEL.weather?.rain ?? 1), terrain: G.terrain, water: LEVEL.water, world: G.world,
    lightning: LEVEL.weather?.lightning ?? (LEVEL.weather?.rain ?? 1) > 0.1,
    wind: LEVEL.ambience?.wind || [1.6, 0.7],
    onThunder: (t) => audio.thunder(t),
  });
  scene.add(G.weather.group);
  await breathe();
  mark('environment');
  loading.update('world', 19 / 21, 'Preparing sky reflections');

  // Bake both skies once; changing time of day swaps the cached map. Its
  // retained CPU scene also rebuilds the targets after a graphics reset.
  const environmentMaps = createEnvironmentMaps(renderer, { fog: NIGHT_FOG, profile: LIGHTING });
  G.environmentMaps = environmentMaps;
  G.environments = environmentMaps.bake();
  scene.environment = G.environments.night.texture;
  scene.environmentIntensity = 0.8;

  G.rig = createCameraRig(camera, G.world);
  await breathe();
  mark('post');
  loading.update('world', 20 / 21, 'Preparing lighting and camera effects');

  // post
  hdrChain = hdr;
  if (hdr) {
    bloom = createBloom({ strength: 0.22, threshold: 1.2, knee: 0.8, dirt: 6 });
    grade = createGrade();
    // the eye adapting to a flare (adapt.js): the exposure closes down when the view brightens; the
    // grade applies its factor, found and kept on the GPU (nothing is read back)
    adapt = createAdaptation({ base: renderer.toneMappingExposure });
    grade.adaptation = adapt;
    // a blast close by throws mud over the view (combat.js)
    G.spatter = (amount) => grade.spatter(amount);
    volumetric = createVolumetric(camera);
    ssao = createSSAO(camera);
    ssr = createSSR(camera, shared);
    shafts = createShafts(camera);
    taa = createTAA(camera, () => volumetric.uniforms.tDepth.value);
    distort = createDistortion(camera, () => volumetric.uniforms.tDepth.value);
    blur = createMotionBlur(camera, () => volumetric.uniforms.tDepth.value);
    dof = createDOF(camera);
  }
  applyGraphics();

  // the soldiers and the mission, made now behind the menu so Move out starts at once
  loading.update('world', 1);
  loading.update('soldiers', 0, 'Placing soldiers and preparing the mission');
  await yieldNow();
  mark('soldiers');
  await prepareMission();
  loading.update('soldiers', 1);

  // the shaders, before anything is drawn with them
  loading.update('shaders', 0, 'Compiling lighting and effects');
  await yieldNow();
  mark('shaders');
  menuCamera(0);
  await warmShaders();
  // Keep temporary sky programs alive until warm-up has skipped their compiled shaders.
  environmentMaps.releaseTemporary();
  THREE.Material.prototype.setValues = setValues;
  THREE.ShaderMaterial.prototype.copy = copyShader;
  madeShaders.clear();

  mark('ready');
  ready = true;
  loading.update('shaders', 1);
  $('[data-loading]').hidden = true;
  $('[data-loading-controls]').hidden = true;
  state = 'menu';
  // the mission's own light (a morning, a night) from the first look at it
  if (LEVEL.daylight) setDaylight(true);
  installGraphicsRecovery(environmentMaps);
  fade.classList.remove('on');
  loadingArt.classList.remove('on');
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
  show('start');
  $('[data-loading]').hidden = true;
  $('[data-error]').hidden = false;
  $('[data-error-text]').textContent = text;
  const briefingLoad = $('[data-loading-briefing]');
  briefingLoad.dataset.failed = '';
  briefingLoad.textContent = text;
}

// An active mission pauses across a device reset. Never resume the world
// until its GPU-only reflections and eye-adaptation state are valid again.
function installGraphicsRecovery(environmentMaps) {
  const status = $('[data-graphics-status]');
  const disabled = new Map();
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (graphicsLost) return;
    graphicsLost = true;
    if (state === 'playing') pause();
    input.enable(false); input.exitLock(); audio.suspend();
    status.hidden = false;
    status.textContent = 'Graphics interrupted. Recovering… Reload the page if this continues.';
    for (const button of document.querySelectorAll('[data-action="start"], [data-action="resume"], [data-action="checkpoint"]')) {
      disabled.set(button, button.disabled); button.disabled = true;
    }
    // Retire renderer-owned targets from the lost context before rebuilding.
    environmentMaps.clear(); G.environments = null; scene.environment = null;
    taa?.dispose();
    renderer.setRenderTarget(null);
    // Resizing retires the renderer's HDR/effects buffers while their old
    // context is still lost. applyGraphics restores the real viewport.
    renderer.setSize(1, 1, false);
    scene.traverse(object => {
      if (!object.isLight || !object.shadow) return;
      object.shadow.map?.dispose(); object.shadow.map = null;
      object.shadow.mapPass?.dispose(); object.shadow.mapPass = null;
      object.shadow.needsUpdate = true;
    });
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!graphicsLost) return;
    try {
      G.environments = environmentMaps.bake();
      environmentMaps.releaseTemporary();
      scene.environment = G.environments[G.daylight ? 'day' : 'night'].texture;
      adapt?.reset(); taa?.reset(); renderer.shadowMap.needsUpdate = true;
      graphicsLost = false;
      applyGraphics();
      // Prepare one valid frame while controls are still disabled. The
      // status stays visible while the restored shaders/targets warm up.
      taa?.jitter(); blur?.update();
      try { renderer.render(scene, camera); }
      finally { taa?.restore(); }
      blur?.store();
      for (const [button, wasDisabled] of disabled) button.disabled = wasDisabled;
      disabled.clear(); status.hidden = true;
    } catch (err) {
      graphicsLost = true;
      status.textContent = 'Graphics could not be restored. Reload the page to continue.';
      console.error('Graphics recovery:', err);
    }
  });
}

function freshStats() {
  return { kills: 0, headshots: 0, shots: 0, hits: 0, headHits: 0, grenades: 0, damageTaken: 0, deaths: 0, objectives: 0 };
}

// around the effects chain: no depth clears inside it (see applyGraphics), back on for the next frame's scene
const KEEP_DEPTH = { enabled: true, needsSwap: false, render(r) { r.autoClearDepth = false; } };
const CLEAR_DEPTH = { enabled: true, needsSwap: false, render(r) { r.autoClearDepth = true; } };

function applyGraphics() {
  if (graphicsLost) return;
  quality = QUALITY[settings.quality] || QUALITY.high;
  applyResolution();
  // light in the rain first: it reads the scene's depth, which only the first pass gets
  if (bloom) {
    // the occlusion and the reflections are laid on by the light-in-the-rain pass, so they go with it
    const ao = quality.volumetric && quality.ao;
    const refl = quality.volumetric && quality.ssr;
    volumetric.setAO(ao ? ssao : null);
    volumetric.setSSR(refl ? ssr : null);
    // the particles go into the scene's buffer first (with the light in the rain, which lays
    // its glow over them; without it they are drawn with the scene); the depth of field
    // borrows the scene depth the light-in-the-rain pass reads, so it needs that pass
    G.effects.usePass(!!quality.volumetric, scene);
    // the flare's shafts need its shadows: with them, and with the light in the rain that lays them on
    const shaft = quality.volumetric && quality.shadows;
    if (!shaft) { volumetric.setShafts(null); volumetric.setPointShafts(null); }
    // temporal anti-aliasing after the light in the rain (it borrows the scene depth the same
    // way); what would smear through it (rain, sparks, flashes) is drawn after it
    const aa = !!quality.volumetric;
    taa.enabled = aa;
    blur.setOn(aa && !!quality.blur && settings.motionBlur);
    G.effects.useLate(aa, () => volumetric.uniforms.tDepth.value);
    G.weather.drawLate(aa ? G.effects.late.scene : null, G.effects.depthUniforms);
    G.flames.drawLate(aa ? G.effects.late.scene : null, scene, G.effects.depthUniforms);
    G.drips.drawLate(aa ? G.effects.late.scene : null, scene, G.effects.depthUniforms);
    // the smoke over the fires goes in with the particles, before the glow of the lights in the
    // air is laid on (it hangs in front of the smoke)
    G.plumes.drawIn(quality.volumetric ? G.effects.pass.scene : null, scene, G.effects.depthUniforms);
    G.fireballs.drawLate(aa ? G.effects.late.scene : null, scene, G.effects.depthUniforms);
    G.windowLight?.drawLate(aa ? G.effects.late.scene : null, G.effects.depthUniforms);
    // the passes after the first one that swaps render into the scene's own buffer, whose depth
    // the later ones still read (taa, the blur, the late particles, the haze, the focus): nothing
    // in the chain may clear it, so depth clears are off from its start to its end
    chain = [KEEP_DEPTH, ...(quality.volumetric ? [G.effects.pass] : []), ...(ao ? [ssao] : []), ...(refl ? [ssr] : []), ...(shaft ? [shafts] : []), ...(quality.volumetric ? [volumetric, taa, blur, G.effects.late, distort, dof] : []), ...(quality.bloom ? [bloom] : []), adapt, grade, CLEAR_DEPTH];
    renderer.setEffects(chain);
  }
  G?.weather?.setCount(rainCount());
  G?.grass?.setCount(quality.blades ?? 0);
  G?.clutter?.setOn(quality.clutter ?? 0);
  if (G?.hayDetail) G.hayDetail.group.visible = !!quality.clutter;
  if (G?.fieldCrops) G.fieldCrops.group.visible = !!quality.clutter;
  shared.relief.value = quality.relief ?? 1;
  if (G?.rig) { G.rig.baseFov = settings.fov; G.rig.cameraMotion = settings.cameraShake ? 1 : 0; }
  if (G) G.diff = DIFFICULTY[settings.difficulty] || DIFFICULTY.regular;
}

/* the rain as the quality draws it, as hard as the mission's weather */
function rainCount() { return Math.round(quality.rain * (LEVEL.weather?.rain ?? 1)); }

/* ---------- mission flow ---------- */

function setDaylight(on) {
  G.daylight = on;
  G.lights.setDaylight(on);
  G.sky.setDaylight(on);
  const fog = on ? LIGHTING.fog : NIGHT_FOG;
  scene.fog.color.set(fog);
  // The background color also backs the particles' shared fog uniform.
  scene.background.set(fog);
  scene.environment = G.environments[on ? 'day' : 'night'].texture;
  const exposure = on ? DAY_EXPOSURE : NIGHT_EXPOSURE;
  adapt?.reset({ base: exposure, ref: on ? -1.5 : -5 });
  renderer.toneMappingExposure = exposure;
  taa?.reset();
}

function openBriefing() {
  $('[data-briefing-eyebrow]').textContent = `Mission ${MISSIONS.indexOf(MISSION) + 1} · ${MISSION.place}`;
  $('[data-briefing-inspired]').textContent = MISSION.inspired;
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

/* the missions: the one loaded goes straight to its briefing, another reloads the page for it */
function openMissions() {
  const list = $('[data-mission-list]');
  list.innerHTML = '';
  MISSIONS.forEach((m, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mission-card';
    b.dataset.mission = m.id;
    b.dataset.analyticsCta = `mission_${m.id.replace(/-/g, '_')}`;
    b.dataset.analyticsAction = 'choose_mission';
    if (m === MISSION) b.setAttribute('aria-current', 'true');
    const img = document.createElement('img');
    img.src = m.image; img.alt = '';
    const body = document.createElement('span');
    body.className = 'mc-body';
    const best = (() => { try { return Number(localStorage.getItem(bestKey(m.id)) || 0); } catch { return 0; } })();
    for (const [cls, text] of [['mc-n', `Mission ${i + 1}${m === MISSION ? ' · selected' : ''}`], ['mc-title', m.title], ['mc-when', `${m.place} · ${m.time}`], ['mc-sum', m.summary], ['mc-best', best > 0 ? `Best score ${best}` : '']]) {
      if (!text) continue;
      const span = document.createElement('span');
      span.className = cls; span.textContent = text;
      body.append(span);
    }
    b.append(img, body);
    li.append(b);
    list.append(li);
  });
  show('missions');
}
function chooseMission(id) {
  if (id === MISSION.id && state !== 'complete') { openBriefing(); return; }
  try { localStorage.setItem('hedgerow.mission', id); } catch { /* private mode */ }
  loadingArt.style.backgroundImage = `url("${MISSIONS.find((m) => m.id === id)?.image}")`;
  loadingArt.classList.add('on');
  location.search = missionUrl(id, true);
}

/* The soldiers (his own body and the enemy) and the mission, made while loading, behind the menu:
   hidden until the mission starts (the enemy then show themselves as they come into view, ai.js). */
async function prepareMission() {
  player = createPlayer(G);
  G.player = player;
  player.char.root.visible = false;
  player.char.shadow.visible = false;
  await breathe();
  explosives = createExplosives(G);
  G.explosives = explosives;
  G.debris = createDebris(G);
  await breathe();
  mark('nav');
  // the walk grid the enemy find their way by (ai.js would make it with them)
  G.nav = createNav(G.world, LEVEL.playBounds || G.world.bounds);
  await breathe();
  mark('enemies');
  enemies = createEnemies(G, built.enemyDefs);
  G.enemies = enemies.list;
  G.enemyCtl = enemies;
  for (const e of enemies.list) { e.char.root.visible = false; e.char.shadow.visible = false; }
  await breathe();
  mark('mission');
  mission = createMission(G, LEVEL, built);
  G.mission = mission;
  G.events.on('playerDied', onDeath);
  G.events.on('missionComplete', onComplete);
}

/* The shaders, compiled before anything is drawn with them, and in the background: asked for all
   at once (KHR_parallel_shader_compile compiles them off the main thread while the page carries on),
   then waited for (whenCompiled).
   Left to the first frames, the ninety-odd programs of the scene, the effects chain and the
   soldiers compiled one after another on it, and the menu froze for four seconds as it appeared.
   The scene is compiled as the chain draws it (into its half-float buffer, not tone-mapped), the
   soldiers shown for it; the chain's own passes are found by running it once with the drawing taken
   out, each draw it asks for noted, and compiled the same way. What is left - the shadow maps'
   variants, the chain's output - compiles in one frame drawn unseen after (the flare's warm-up:
   its shadow map drawn with everything that could cast in it). */
async function warmShaders() {
  const soldiers = [player.char.root, ...enemies.list.map((e) => e.char.root)];
  const buffer = () => {
    const t = new THREE.WebGLRenderTarget(4, 4, { type: hdrChain ? THREE.HalfFloatType : THREE.UnsignedByteType });
    t.depthTexture = new THREE.DepthTexture(4, 4);
    return t;
  };
  const a = buffer(), b = buffer();
  const draws = [], compiled = new Set();
  const compile = (object, cam, target) => { for (const m of renderer.compile(object, cam, target)) compiled.add(m); };
  if (hdrChain && chain.length) {
    // each draw compiled as it is asked for (a pass may change its material's defines between two)
    const render = renderer.render;
    renderer.render = (object, cam) => {
      draws.push([object, cam]);
      if (object !== scene) compile(object, cam);
    };
    try {
      let read = a, write = b;
      for (const pass of chain) {
        if (pass.enabled === false) continue;
        pass.render(renderer, write, read, 0);
        if (pass.needsSwap !== false) [read, write] = [write, read];
      }
    } finally { renderer.render = render; }
  }
  const tone = renderer.toneMapping;
  renderer.setRenderTarget(hdrChain ? a : null);
  if (hdrChain) renderer.toneMapping = THREE.NoToneMapping;
  for (const o of soldiers) o.visible = true;
  compile(scene, camera);
  for (const o of soldiers) o.visible = false;
  // the passes' shaders nothing drew in that run (they run only now and then), on a stand-in for
  // their full-screen triangle (position and uv only: what a geometry carries is in a shader's variant)
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const quad = new THREE.Mesh(tri), flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  for (const m of madeShaders) {
    if (renderer.properties.get(m).currentProgram) continue;
    quad.material = m;
    compile(quad, flat);
    await breathe();
  }
  THREE.Material.prototype.setValues = setValues;
  THREE.ShaderMaterial.prototype.copy = copyShader;
  madeShaders.clear();
  // the shadow maps' own shaders: three's depth material (a flare, a lightning stroke) and distance
  // material (a lamp, a fire), as WebGLShadowMap sets them up for each kind of thing that casts
  // (skinned, instanced or plain; cut out by its alpha or not; which of its sides), or the thing's own
  const kinds = new Map();
  const flip = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of [].concat(o.material)) {
      const cut = !!((m.map || m.alphaMap) && m.alphaTest > 0) || m.alphaToCoverage;
      const at = o.geometry.attributes;
      const key = [o.isSkinnedMesh, o.isInstancedMesh, !!o.morphTargetInfluences, cut, m.shadowSide ?? flip[m.side], o.customDepthMaterial?.uuid, o.customDistanceMaterial?.uuid,
        !!at.normal, !!at.uv, !!at.color, !!at.tangent].join();
      if (!kinds.has(key)) kinds.set(key, [o, m]);
    }
  });
  // (the shadow pass draws with no scene: no fog)
  const fog = scene.fog;
  scene.fog = null;
  for (const [o, m] of kinds.values()) {
    const was = o.material;
    for (const [own, Kind] of [[o.customDepthMaterial, THREE.MeshDepthMaterial], [o.customDistanceMaterial, THREE.MeshDistanceMaterial]]) {
      let d = own;
      if (!d) {
        d = new Kind();
        d.side = m.shadowSide ?? flip[m.side];
        d.map = m.map; d.alphaMap = m.alphaMap; d.alphaTest = m.alphaToCoverage ? 0.5 : m.alphaTest;
      }
      o.material = d;
      compile(o, camera, scene);
      o.material = was;
    }
  }
  scene.fog = fog;
  renderer.toneMapping = tone;
  renderer.setRenderTarget(null);
  // and meanwhile the textures go up to the GPU one at a time (the first frame drawn would otherwise
  // have uploaded them all at once)
  mark('textures up');
  const uploads = textures([scene, ...draws.map(([object]) => object)]);
  let uploaded = 0;
  for (const t of uploads) {
    renderer.initTexture(t);
    loading.update('shaders', 0.25 + 0.25 * ++uploaded / uploads.size, `Uploading textures · ${uploaded} of ${uploads.size} ready`);
    await breathe();
  }
  await whenCompiled(compiled);
  await yieldNow();
  mark('warm frame');
  loading.update('shaders', 0.96, 'Drawing the first frame');
  // the frame drawn unseen (behind the fade, which still covers the canvas; to the screen, so the
  // chain's output compiles too), the soldiers shown and casting for it
  for (const o of soldiers) o.visible = true;
  G.flares.warm(renderer, scene, camera, [
    ...G.flares.castersOf(built.veg.group),
    ...player.char.meshes, ...enemies.list.flatMap((e) => e.char.meshes),
  ]);
  for (const o of soldiers) o.visible = false;
  a.dispose(); b.dispose();
  await yieldNow();
}

/* until the programs these materials need are compiled: a status query a turn, one program at a
   time (they come out much in the order they went in). Each query is a round trip to the GPU
   process, and three's own wait (compileAsync) asked after every program still pending every ten
   milliseconds - with ninety pending, a twentieth of a second of the page each time. */
async function whenCompiled(materials) {
  const programs = new Set();
  for (const m of materials) { const p = renderer.properties.get(m).currentProgram; if (p) programs.add(p); }
  let completed = 0;
  loading.update('shaders', 0.5, `Compiling graphics · 0 of ${programs.size} programs ready`);
  for (const p of programs) {
    while (!p.isReady()) await new Promise((resolve) => setTimeout(resolve, 16));
    loading.update('shaders', 0.5 + 0.45 * ++completed / programs.size, `Compiling graphics · ${completed} of ${programs.size} programs ready`);
    await breathe();
  }
}

/* every texture the materials under these draw with (their maps and their shaders' uniforms), not
   the render targets' */
function textures(roots) {
  const out = new Set();
  const take = (v) => { if (v?.isTexture && !v.isRenderTargetTexture && (v.image || v.source?.data)) out.add(v); };
  for (const root of roots) {
    root.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        for (const v of Object.values(m)) take(v);
        for (const u of Object.values(m.uniforms || {})) take(u?.value);
        // and those its compiled shader added (onBeforeCompile: the ground's maps, the canopy's)
        for (const u of Object.values(renderer.properties.get(m).uniforms || {})) take(u?.value);
      }
    });
  }
  return out;
}

function startMission() {
  if (!ready || graphicsLost) return; // Move out waits for prepared graphics.
  mark('move out');
  audio.init();
  if (!missionStarted) {
    missionStarted = true;
    player.char.root.visible = true;
    mission.start();
  }
  const spawn = AT ? [AT[0], AT[1], 0] : LEVEL.start;
  cancelCompletionPresentation();
  player.reset(spawn);
  resetAcoustics();
  missionTime = 0;
  G.stats = freshStats();
  trackAttemptStart();
  resume();
  hud.notice(LEVEL.title, LEVEL.when, 4);
}

function resume() {
  if (graphicsLost) return;
  hud.hideCrosshair(false);
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
  input.exitLock();
  audio.suspend();
  document.body.classList.remove('playing');
  $('[data-pause-mission]').textContent = `${LEVEL.title} · ${formatTime(missionTime)}`;
  $('[data-screen="pause"] [data-action="checkpoint"]').disabled = !!mission?.done;
  const ol = $('[data-pause-objectives]');
  ol.innerHTML = '';
  LEVEL.objectives.forEach((o) => {
    const li = document.createElement('li');
    li.textContent = o.text;
    li.dataset.state = mission?.done || mission?.isComplete(o.id) ? 'done' : mission?.isActive(o.id) ? 'current' : 'todo';
    if (li.dataset.state === 'current') li.setAttribute('aria-current', 'step');
    li.setAttribute('aria-label', `${o.text} — ${li.dataset.state === 'done' ? 'completed' : li.dataset.state === 'current' ? 'current order' : 'upcoming order'}`);
    ol.append(li);
  });
  show('pause');
  screenEls.pause.scrollTop = 0;
  screenEls.pause.querySelector('.panel').scrollTop = 0;
  for (const detail of document.querySelectorAll('[data-screen="pause"] [data-field-map][open]')) paintFieldMap(detail);
}

async function paintFieldMap(detail) {
  const body = detail.querySelector('[data-field-map-body]');
  body.setAttribute('aria-busy', 'true');
  if (!body.children.length) body.textContent = 'Drawing the field sketch…';
  try {
    const maps = await import('./field-map.js');
    fieldMapData ||= maps.buildFieldMapData(LEVEL);
    const data = await fieldMapData;
    maps.renderFieldMap(body, data, { title: LEVEL.title, mission,
      player: detail.closest('[data-screen="pause"]') ? player?.pos : null, yaw: G?.rig?.yaw || 0 });
  } catch (err) {
    fieldMapData = null;
    body.textContent = 'The field sketch could not be drawn. Close and open it to retry.';
    console.warn('Field map:', err);
  } finally { body.removeAttribute('aria-busy'); }
}

const KILLER_NAME = { rifle: 'a rifleman', smg: 'a submachine gunner', mg: 'the MG 42', officer: 'an officer' };
let deathSequence = 0;
let deathPresentation = null;
let completionPresentation = null, completionRecorded = false;

function onDeath() {
  const sequence = ++deathSequence;
  audio.cancelActions();
  G.stats.deaths++;
  if (!mission.done) trackAttemptEnd('loss');
  // who did it: the camera turns to him (camera.js) while the line says so
  const k = player.killer;
  if (k) {
    const d = Math.round(Math.hypot(k.pos.x - player.pos.x, k.pos.z - player.pos.z));
    hud.notice(`Killed by ${KILLER_NAME[k.type] || 'the enemy'}`, `${d} m`, 4.5);
  }
  hud.hideCrosshair(true);
  deathPresentation = { sequence, elapsed: 0, calm: false, delay: k ? 5.2 : 2.6 };
}

// A paused death camera resumes where it stopped. A wall-clock callback
// guarded by state==='playing' could expire in pause and leave the player
// dead forever without the checkpoint menu.
function updateDeathPresentation(dt) {
  if (!deathPresentation) return;
  if (deathPresentation.sequence !== deathSequence || player.alive) { deathPresentation = null; return; }
  if (state !== 'playing') return;
  deathPresentation.elapsed += dt;
  if (!deathPresentation.calm && deathPresentation.elapsed >= 0.9) {
    deathPresentation.calm = true;
    hud.calm(true);
  }
  if (deathPresentation.elapsed < deathPresentation.delay) return;
  deathPresentation = null;
  state = 'dead';
  input.enable(false);
  input.exitLock();
  document.body.classList.remove('playing');
  show('dead');
}

function retryCheckpoint() {
  if (graphicsLost || mission?.done) return;
  audio.cancelAttempt?.();
  cancelCompletionPresentation();
  // Old contact cues belong to the attempt that just ended.
  player.char.ragdoll?.cancelImpact?.();
  for (const enemy of G.enemies) enemy.char.ragdoll?.cancelImpact?.();
  audio.cancelContacts?.();
  deathSequence++;
  audio.cancelActions();
  const { spawn, inventory } = mission.restoreCheckpoint();
  // Reset the entire attempt in this click, before play resumes. A delayed
  // callback could otherwise move the player during pause or graphics loss.
  explosives.clear();
  G.debris.clear();
  G.casings.clear();
  G.chunks.clear();
  G.steam.clear();
  enemies.resetLiving();
  player.reset(spawn, inventory);
  resetAcoustics();
  trackAttemptStart('checkpoint_retry');
  fade.classList.remove('on');
  resume();
}

function cancelCompletionPresentation() {
  completionPresentation = null; completionRecorded = false;
}

function onComplete() {
  if (!mission.done || completionRecorded) return;
  // The final order decides the result. Hits or a death during the short
  // presentation must not change the score that was already earned.
  const s = Object.freeze({ ...G.stats }), time = missionTime;
  const accuracy = s.shots ? s.hits / s.shots : 0;
  const timeBonus = Math.max(0, Math.round((900 - time) * 3));
  const score = s.kills * 100 + s.headshots * 60 + s.objectives * 400 + Math.round(accuracy * 1500) + timeBonus - s.deaths * 300;
  let best = 0;
  try {
    const saved = Number(localStorage.getItem(bestKey(MISSION.id)));
    if (Number.isFinite(saved) && saved > 0) best = saved;
    if (score > best) localStorage.setItem(bestKey(MISSION.id), String(score));
  } catch { /* private storage */ }
  completionPresentation = { elapsed: 0, report: Object.freeze({ stats: s, time, accuracy, score, best: Math.max(best, score), enemies: G.enemies.length }) };
  completionRecorded = true;
  trackAttemptEnd('win', score);
}

function updateCompletionPresentation(dt) {
  if (!completionPresentation) return;
  if (!mission.done) { cancelCompletionPresentation(); return; }
  if (state !== 'playing' || graphicsLost || !(dt > 0) || !Number.isFinite(dt)) return;
  completionPresentation.elapsed += dt;
  if (completionPresentation.elapsed < 2.5 - 1e-9) return;
  const { stats: s, time, accuracy, score, best, enemies: total } = completionPresentation.report;
  completionPresentation = null;
  deathPresentation = null; deathSequence++;
  state = 'complete'; input.enable(false); input.exitLock();
  document.body.classList.remove('playing');
  const rows = [
    ['Time', formatTime(time)], ['Enemies killed', `${s.kills} / ${total}`], ['Headshots', s.headshots],
    ['Accuracy', `${Math.round(accuracy * 100)} %`], ['Grenades thrown', s.grenades], ['Times down', s.deaths],
    ['Score', score], ['Best', best],
  ];
  const dl = $('[data-stats]'); dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    if (k === 'Score') dd.className = 'score';
    dl.append(dt, dd);
  }
  $('[data-complete-title]').textContent = LEVEL.completeTitle || `${LEVEL.title}: mission complete`;
  $('[data-action="next"]').hidden = !MISSIONS[MISSIONS.indexOf(MISSION) + 1];
  show('complete');
}

function showBest() {
  try {
    const b = Number(localStorage.getItem(bestKey(MISSION.id)) || 0);
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
  get fx() { return { volumetric, bloom, grade, adapt, ssao, dof, ssr, shafts, taa, distort, blur }; },
  // scripted checks drive the frames themselves (a software GPU draws a frame in seconds)
  step: () => step(),
  get state() { return state; },
  flyTo(x, y, z, yaw = 0, pitch = -0.1) { if (!fly) startFly(); fly.pos.set(x, y, z); fly.yaw = yaw; fly.pitch = pitch; },
};

/* ---------- frame ---------- */

const timer = new THREE.Timer();
let fpsAcc = 0, fpsFrames = 0, fps = 0, distantTimer = 12, artyFlash = 0;
const R = rng(5);

let lastStep = 0;
function frame(now) {
  requestAnimationFrame(frame);
  adaptResolution(now);
  step();
}

/* Soldiers throw shadows only near the shadow light (each one costs six
   renders of his body into its cube map). */
let flareShadows = false, lampShadowOf = null, lampShadowOf2 = null;
function castShadows() {
  const sl = G.lights.shadowLight, sl2 = G.lights.shadowLight2;
  if (!sl || !sl.castShadow) return;
  // while a flare's shadows are drawn the trees cast too, and the lamps' shadows (cubes
  // of six maps) hold still, drawn again only if they move to another lamp
  const fl = !!G.flares?.shadowing;
  if (fl !== flareShadows) {
    flareShadows = fl;
    for (const m of G.flares.castersOf(built.veg.group)) m.castShadow = fl;
  }
  // (and a light with nothing to light, waiting below the level, draws nothing into its six maps:
  // unlit, its shadows are never looked up, and the frame it takes a lamp they are drawn again)
  G.lights.held = fl;
  sl.shadow.autoUpdate = !fl && !!G.lights.shadowOf;
  if (fl && G.lights.shadowOf !== lampShadowOf) sl.shadow.needsUpdate = true;
  lampShadowOf = G.lights.shadowOf;
  if (sl2) {
    sl2.shadow.autoUpdate = !fl && !!G.lights.shadowOf2;
    if (fl && G.lights.shadowOf2 !== lampShadowOf2) sl2.shadow.needsUpdate = true;
    lampShadowOf2 = G.lights.shadowOf2;
  }
  const within = (l, p) => l && l.intensity > 0 && (p.x - l.position.x) ** 2 + (p.z - l.position.z) ** 2 < (l.distance + 3) ** 2;
  const near = (p) => within(sl, p) || within(sl2, p);
  const inFlare = (p) => fl && (p.x - camera.position.x) ** 2 + (p.z - camera.position.z) ** 2 < 40 * 40;
  for (const e of G.enemies || []) {
    const on = e.char.root.visible && (near(e.pos) || inFlare(e.pos));
    for (const m of e.char.meshes) m.castShadow = on;
  }
  if (player) for (const m of player.char.meshes) m.castShadow = near(player.pos) || inFlare(player.pos);
}

/* ---------- dynamic resolution ----------
   Hold about 60 fps on slower GPUs and dense screens: when frames run long
   for a second the render resolution steps down by a tenth (to 60 % of the
   quality's pixel ratio at most), and after five smooth seconds it steps
   back up, though never to a scale that proved too slow in the last 30 s.
   Only while playing; the hidden-pane watchdog (?debug) never adapts. */
function applyResolution() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio) * resScale);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
function adaptResolution(now) {
  const raw = lastFrameAt ? Math.min(0.25, (now - lastFrameAt) / 1000) : 1 / 60;
  lastFrameAt = now;
  if (state !== 'playing' || document.hidden) { slowFor = fastFor = 0; return; }
  frameAvg += (raw - frameAvg) * 0.08;
  resCeilingAge += raw;
  if (resCeilingAge > 30) resCeiling = 1;
  if (frameAvg > 1 / 45) { slowFor += raw; fastFor = 0; }
  else if (frameAvg < 1 / 58) { fastFor += raw; slowFor = 0; }
  else slowFor = fastFor = 0;
  if (slowFor > 1 && resScale > 0.61) {
    resScale = Math.max(0.6, resScale - 0.1);
    resCeiling = resScale; resCeilingAge = 0; slowFor = 0;
    applyResolution();
  } else if (fastFor > 5 && resScale < Math.min(1, resCeiling) - 0.01) {
    resScale = Math.min(1, resScale + 0.1);
    fastFor = 0;
    applyResolution();
  }
}
// ?debug: keep stepping when the page gets no animation frames (a hidden
// preview pane), so scripted tests still run
if (DEBUG) setInterval(() => { if (ready && performance.now() - lastStep > 150) step(); }, 40);

function step() {
  lastStep = performance.now();
  timer.update();
  const elapsed = timer.getDelta();
  const dt = Math.min(elapsed, 0.05);
  if (graphicsLost) { input?.endFrame(); return; }
  if (!G || !G.weather || !G.rig) return;
  const playing = state === 'playing';
  const live = playing || state === 'dead' || state === 'complete' || state === 'fly';
  if (state === 'paused' || state === 'menu' || state === 'loading') {
    // keep the world alive behind the menus, slowly
    if (state === 'menu' && !missionStarted) menuCamera(dt);
  }
  if (live || state === 'menu') G.time += dt;
  shared.time.value = G.time;

  if (playing || state === 'fly') {
    if (input.pressed('KeyI')) {
      G.godMode = !G.godMode;
      hud.notice(`Invincibility ${G.godMode ? 'on' : 'off'}`, 'I · toggle invincibility', 2);
    }
    if (input.pressed('KeyO')) {
      setDaylight(!G.daylight);
      hud.notice(G.daylight ? 'Daytime' : 'Nighttime', 'O · switch day / night', 2);
    }
  }

  if (playing) {
    if (!mission.done) missionTime += dt;
    audio.advanceActions(dt);
    player.update(dt, input, settings);
    enemies.update(dt);
    explosives.update(dt);
    G.debris.update(dt);
    // Tick a previous completion before mission.update can create a new
    // one, so its first frame retains the full presentation duration.
    updateCompletionPresentation(dt);
    mission.update(dt, input);
    updateDeathPresentation(dt);
    if (input.pressed('Escape')) pause();
    distantTimer -= dt;
    if (distantTimer < 0) {
      if (R() < 0.65) {
        // the flash first, the rumble after it has crossed the distance
        const az = 0.5 + R() * 2.2, km = 3 + R() * 6;
        G.sky.uniforms.uArtyDir.value.set(Math.sin(az), 0, Math.cos(az));
        artyFlash = 1;
        audio.distant('artillery', { azimuth: az, delay: km * 2.9 });
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
    const flash = G.weather.update(dt, G.time, camera, LEVEL.weather?.rain ?? 1);
    G.lightning = flash;
    G.sky.update(dt, G.time, camera, flash, G.weather.flashDir);
    artyFlash = Math.max(0, artyFlash - dt * 2.2);
    G.sky.uniforms.uArty.value = artyFlash * (0.6 + 0.4 * Math.sin(G.time * 40));
    G.flares.update(dt, camera.position, { x: 1.4, z: 0.6 }, G.sky);
    G.flares.lightning(flash, G.weather.flashDir, camera.position);
    setCanopyLight(G.flares.light);
    G.lights.update(dt, G.time, camera.position, flash);
    setFill(G.lights.key, G.lights.rim);
    castShadows();
    volumetric?.setLights(G.lights.active, G.time, G.weather.intensity ?? 1);
    dof?.set(volumetric?.uniforms.tDepth.value, state === 'playing' ? G.rig.aimT : 0);
    G.effects.setLights(G.lights.active, 1 + flash * 0.9);
    distort?.set(G.effects, camera.position, G.time);
    if (shafts && quality.volumetric && quality.shadows) {
      shafts.set(G.flares);
      shafts.setPoint(G.lights);
      volumetric.setShafts(shafts, G.flares.light.color, G.flares.light.intensity * (0.6 + 0.4 * (G.weather.intensity ?? 1)));
      volumetric.setPointShafts(shafts);
    }
    G.weather.setLights(G.lights.active);
    G.drips.setLights(G.lights.active);
    G.drips.update(G.time, G.weather.intensity ?? 1, flash, G.flares.burning ? G.flares.light : null);
    G.weather.setSkyLight(G.flares.light.color, G.flares.burning ? G.flares.light.intensity : 0);
    G.halos?.update(dt, G.time, camera.position);
    G.mist?.update(dt, camera.position, G.time, flash);
    G.effects.update(dt, { x: 1.4, z: 0.6 }, camera.position);
    G.casings.update(dt);
    G.chunks.update(dt);
    G.steam.update(dt);
    G.flames.update(dt, camera.position);
    updateSmoulder(G.effects.fires, camera.position);
    G.plumes.update(dt, { x: 1.4, z: 0.6 }, flash, G.flares.burning ? G.flares.light : null);
    G.fireballs.update(flash, G.flares.burning ? G.flares.light : null);
    G.windowLight?.update(camera);
    if (grade) {
      grade.tick(dt);
      adapt.metering = state === 'playing' && missionTime > 1;
      adapt.update(dt, renderer, flash);
      const hp = player ? player.health / 100 : 1;
      // dead: the red flash of the moment, then a light tint so the camera on the killer reads
      const since = player && !player.alive ? G.time - (player.diedAt ?? G.time) : 0;
      grade.uniforms.uHurt.value = player && player.alive ? clamp((0.6 - hp) * 1.8, 0, 1) : player ? lerp(0.8, 0.25, clamp((since - 0.6) / 0.8, 0, 1)) : 0;
      // dazed by a blast close by (player.js): the view doubles, smears, drains and closes in
      grade.uniforms.uDaze.value = live && player ? player.daze : 0;
      grade.uniforms.uDazeT.value = player ? player.dazeT : 99;
      grade.uniforms.uAim.value = state === 'playing' && player?.alive ? G.rig.aimT : 0;
      grade.uniforms.uSuppress.value = live && player?.alive ? player.suppression : 0;
    }
  }
  // aiming in brings things nearer: detail follows how big they look, not how far they are
  G.lodScale = fovScale(camera.fov, G.rig?.baseFov ?? camera.fov);
  built.veg.update(dt, camera, quality, G.lodScale);
  G.terrain.updateLod(camera.position);
  G.grass.update(camera, player?.pos, renderer.domElement.height);
  G.clutter.update(camera, renderer.domElement.width, renderer.domElement.height);
  hud.update(dt);
  hud.compass(G.rig.yaw);
  camera.getWorldDirection(listenerForward);
  audio.setListener(camera.position.x, camera.position.y, camera.position.z, Math.atan2(listenerForward.x, listenerForward.z));
  if (playing) listenRound(dt);
  // the weather and wildlife out on the battlefield (and watching from it, dead), not over the menus
  // Pause suspends the audio clock; keep its delayed reports and local
  // equipment intact so they resume with the remaining simulation delay.
  audio.setOutdoors(playing || state === 'dead' || state === 'paused');
  audio.tick();
  // and what he hears goes dull behind a ringing in the ears (clear again in the menus)
  audio.daze(live && player ? player.daze : 0);
  input.endFrame();

  renderer.info.reset();
  taa?.jitter();
  blur?.update();
  renderer.render(scene, camera);
  taa?.restore();
  blur?.store();

  if (DEBUG) {
    // Measure real frame time, not the capped simulation step (which
    // otherwise reports at least 20 fps even when rendering is slower).
    fpsAcc += elapsed; fpsFrames++;
    if (fpsAcc < 0.5) return;
    fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    const i = renderer.info;
    const p = player ? player.pos : camera.position;
    const vs = built.veg.stats();
    hud.debug(`${fps.toFixed(0)} fps  ${i.render.calls} calls  ${(i.render.triangles / 1000).toFixed(0)}k tris  res ${Math.round(resScale * 100)}%\n` +
      `veg ${vs.inst} inst ${(vs.tris / 1000).toFixed(0)}k  fx ${G.effects.count}\n` +
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  ${state}`);
  }
}

/* What is round the listener, for the echoes (audio.setSpace): eight rays out at head height, one
   every frame in turn, 30 m each. */
const ECHO_RAYS = 8, ECHO_REACH = 30;
const listenerForward = new THREE.Vector3();
const echoHits = new Float32Array(ECHO_RAYS).fill(ECHO_REACH);
const echoReflections = new Float32Array(ECHO_RAYS);
let echoRay = 0, echoTimer = 0;
function resetAcoustics() {
  echoHits.fill(ECHO_REACH); echoReflections.fill(0);
  echoRay = 0; echoTimer = 0;
  audio.setSpace(0, ECHO_REACH, 1);
}
function listenRound(dt) {
  const p = camera.position, a = (echoRay / ECHO_RAYS) * Math.PI * 2;
  const h = G.world.raycast(p.x, p.y, p.z, Math.sin(a), 0, Math.cos(a), ECHO_REACH, SHOT, { noWater: true });
  echoHits[echoRay] = h ? h.t : ECHO_REACH;
  echoReflections[echoRay] = acousticReflection(h);
  echoRay = (echoRay + 1) % ECHO_RAYS;
  echoTimer -= dt;
  if (echoTimer > 0) return;
  echoTimer = 0.5;
  let closed = 0, sum = 0, reflected = 0;
  for (let i = 0; i < ECHO_RAYS; i++) {
    const t = echoHits[i], weight = t < ECHO_REACH ? 1 - t / (ECHO_REACH * 1.5) : 0;
    closed += weight; reflected += weight * echoReflections[i]; sum += t;
  }
  audio.setSpace(closed / ECHO_RAYS, sum / ECHO_RAYS, closed ? reflected / closed : 1);
  const roof = G.world.raycast(p.x, p.y + 0.05, p.z, 0, 1, 0, 18, SHOT, { noTerrain: true, noWater: true });
  const surface = roof?.surface || roof?.collider?.surface || '';
  audio.setShelter(roof ? /foliage|leaf/.test(surface) ? 0.35 : 1 : 0);
}

/* the title's slow drift over the battlefield: round the level's `menuView` ({from, to}: points
   [x, y, z]), by default down Saint-Clair's street */
let menuT = 0;
function menuCamera(dt) {
  if (!menuMotion.matches) menuT += dt * 0.03;
  const v = LEVEL.menuView || { from: [0, 3.4, 90], to: [0, 3.5, 118] };
  const sx = Math.sin(menuT) * 6, sz = Math.cos(menuT) * 5;
  camera.position.set(v.from[0] + sx, v.from[1], v.from[2] + sz);
  camera.lookAt(v.to[0], v.to[1], v.to[2] + sz);
}

/* ---------- wiring ---------- */

for (const detail of document.querySelectorAll('[data-field-map]')) {
  detail.addEventListener('toggle', () => { if (detail.open) paintFieldMap(detail); });
}

// Esc in a sub-screen (the controls, the settings, the missions, the briefing) goes back a step
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || state === 'playing') return;
  const top = screenStack.at(-1);
  if (top && top !== 'pause' && top !== 'start' && top !== 'dead' && top !== 'complete') back();
});

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing') pause();
});

// Changing tabs must never leave a soldier moving or firing in the background.
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  const card = e.target.closest('[data-mission]');
  if (card) { if (state !== 'paused') audio?.init(); chooseMission(card.dataset.mission); return; }
  if (!a) return;
  const act = a.dataset.action;
  if (state !== 'paused') audio?.init();
  if (act === 'briefing') openBriefing();
  else if (act === 'start') startMission();
  else if (act === 'back') back();
  else if (act === 'controls') show('controls');
  else if (act === 'settings') { syncSettingsForm(); show('settings'); }
  else if (act === 'resume') resume();
  else if (act === 'checkpoint') retryCheckpoint();
  else if (act === 'missions') openMissions();
  else if (act === 'next') chooseMission(MISSIONS[MISSIONS.indexOf(MISSION) + 1]?.id ?? MISSION.id);
  else if (act === 'restart') { location.search = missionUrl(MISSION.id, true); }
  else if (act === 'quit') { location.search = missionUrl(MISSION.id); }
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
  if (k === 'volume') audio?.setVolume(settings.volume);
  if (k === 'effectsVolume' || k === 'ambienceVolume') audio?.setMix?.({ effects: settings.effectsVolume, ambience: settings.ambienceVolume });
  if (ready) applyGraphics();
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
