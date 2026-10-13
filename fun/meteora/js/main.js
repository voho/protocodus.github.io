/* Meteora — assembly and the loop.

   Nothing here decides how the game plays; it wires the simulation to the
   screen and the speakers, keeps them in step, and walks the player from
   the menu through briefing, hangar and flight to the debrief:

     menu ─ briefing ─ hangar ─ fold (loading) ─ flight ─ debrief ─ next
       │                                            │
       └─ survival · codex · settings               └─ pause

   One world runs throughout. Behind the menus it plays a quiet scene —
   your ship idling in the belt with your wing beside it, the Perpetua in
   the distance, a convoy crawling past — and the camera circles it; the
   hangar circles closer, around the hull you are choosing. Launching a
   mission rebuilds the world from that mission.

   `?mission=m04` jumps straight into a mission (with `&difficulty=`,
   `&hull=`); `?debug` adds a read-out; `?god` keeps the player alive;
   `?ldr` renders without the HDR buffer and bloom, as on a GPU that cannot;
   `?bench` and `?bench&legacy` measure the running game as before. */

import * as THREE from 'three';
import { RENDER, SHAKE, STEP, FIELD, bigDeathSpan } from './config.js';
import { NEUTRAL_CONTROLS } from './flight.js';
import { advance, createWorld, drainEvents, resetWorld, startRun, IDLE } from './world.js';
import { SURVIVAL } from './missions/survival.js';
import { defineMission, results } from './mission.js';
import {
  ALL_UNLOCKED, MISSIONS, TRAINING, freshProgress, loadProgress, loadoutFor, missionById, missionLabel, nextMission, recordResult, saveProgress, unlockedFor,
} from './campaign.js';
import { HULLS, CLASSES } from './catalog.js';
import { defaultLoadout, normalizeLoadout } from './loadout.js';
import { hardpoints } from './hardpoints.js';
import { createControlState, dropAll, keysOf, readInput, rebind } from './controls.js';
import { createModelLibrary } from './models.js';
import { createFieldRender } from './field-render.js';
import { createChaseCamera } from './camera.js';
import { createInput } from './input.js';
import { createScreens, loadSettings } from './screens.js';
import { createSky } from './sky.js';
import { createTargetView } from './target-view.js';
import { lookFor } from './environments.js';
import { createGlowBatch } from './glow.js';
import { createSmokeBatch } from './smoke.js';
import { createExplosions } from './explosions.js';
import { createPlumes } from './plumes.js';
import { createProjectiles } from './projectiles.js';
import { createAudio } from './audio.js';
import { createMusic } from './music.js';
import { createShake, kick, stepShake } from './shake.js';
import { createHud } from './hud.js';
import { createResolution } from './resolution.js';
import { createFrameStats } from './frame-stats.js';
import { createEntityRender } from './entity-render.js';
import { createFolds } from './fold-fx.js';
import { createShields, shieldExtent } from './shield-fx.js';
import { PROLOGUE, HINTS, RECAPS } from './story.js';
import { sweepCompound, toWorld } from './compound.js';
import { createChatter } from './chatter.js';
import { canRenderHalfFloat, createBloom } from './bloom.js';
import { createVoices } from './voices.js';
import { createDust } from './dust.js';
import { createWarmup } from './warmup.js';
import { createHangar } from './hangar.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const BENCH = params.has('bench');
const LEGACY = BENCH && params.has('legacy');
const BENCH_RATIO = Number(params.get('ratio')) || 1;
const GOD = params.has('god');
const LDR = params.has('ldr');
const AUTOPILOT = (DEBUG && params.has('autopilot')) || BENCH;
const BENCH_WARM = 3, BENCH_SPAN = 20;
const EXPOSURE = 1.05;
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('stage');
const hudCanvas = document.querySelector('canvas.hud');
const targetCanvas = document.querySelector('canvas.target-view');
const debugOut = document.querySelector('[data-debug]');
const callout = document.querySelector('[data-callout]');
const fadeEl = document.querySelector('[data-fade]');
const settings = loadSettings();
const controlState = createControlState(settings);
let storage = null;
try { storage = window.localStorage; } catch { /* nothing is kept */ }
let progress = loadProgress(storage);

let world, renderer, scene, camera, chase, fieldRender = null, library, sky, glow, smoke, fx, plumes, projectiles, hud, engineLight, input, resolution;
let folds, shields, entities, bloom = null, fill, dust, warmup, hangar = null, hangarStage = null;
// The place's look (environments.js) and the lights it sets.
let look = null, lookKey = null, sunLight, hemiLight, ambientLight, holeLight;
let targetView = null;
let mode = 'boot', paused = false, deadTimer = 0, wreck = null, lastKnock = -Infinity;
let currentMission = null, currentLoadout = null, outcomeAt = null, debriefShown = false, slowmo = 0, jumped = false;
let hangarMission = null, hangarLoadout = null, survivalRun = false, prologueStep = 0;
// Bumped by every launch and every return to the menus: a launch still
// loading when the player has gone elsewhere quietly gives up.
let launchGen = 0;
// ?debug only: a pilot function flying instead of the mouse and keys, and a
// simulation speed-up for watching whole missions.
let debugPilot = null, debugSpeed = 1;
const critical = new Set();
// Hits and blasts shake the camera; of the ship's own vibration only the
// afterburner's shudder is felt, building with the burn.
const shake = createShake(5), amps = { fine: 0, rumble: 0, buffet: 0 };
// Sound starts on the first click, as browsers require; the scripted flights stay silent.
const audio = AUTOPILOT ? null : createAudio(settings.volume);
const music = audio ? createMusic(audio, settings.music) : null;
const beltTime = { value: 0 };
const chatter = createChatter();
const voices = createVoices({ volume: () => (AUTOPILOT ? 0 : settings.volume * (settings.voices ?? 0.9)) });

/* The scene behind the menus: your ship idling, your wing beside it, the
   Perpetua in the distance and a convoy crawling past. */
const MENU_SCENE = defineMission({
  id: 'menu', title: 'Menu', field: FIELD, fieldSeed: 1234, seed: 5, hints: false,
  start: { pos: [0, 0, 0], forward: [0.3, 0.05, -1] },
  setup(m) {
    m.wing('kestrel', 2, { names: ['Saint', 'Wren'] });
    m.spawn('perpetua', { team: 0, pos: [-900, 260, -2600], forward: [1, 0, 0.25], name: 'Perpetua', helm: { path: [[3000, 260, -1600]], speed: 6 } });
  },
});

const screens = createScreens(document, settings, {
  click: () => { audio?.start(); music?.start(); audio?.ui('click'); },
  hover: () => audio?.ui('hover'),
  retry: () => location.reload(),
  settingsChanged: s => { audio?.setVolume(s.volume); music?.setVolume(s.music); rebind(controlState); hud?.setKeys(keysOf(s)); applyGraphics(); },
  screenBack: name => { if (name === 'start') toMenu(); },
  continue: () => openBriefing(nextMission(progress)),
  newCampaign: () => {
    screens.difficulties(progress.difficulty, key => {
      const keep = { commendations: progress.commendations, survival: progress.survival };
      progress = { ...freshProgress(), ...keep, difficulty: key };
      saveProgress(storage, progress);
      prologueStep = 0;
      screens.prologue(0);
      screens.show('prologue');
      voices.narrate('narrator', PROLOGUE[0].text);
      music?.setMood('menu');
    }, progress);
    screens.show('difficulty');
  },
  prologueNext: () => {
    if (prologueStep + 1 < PROLOGUE.length) {
      prologueStep = screens.prologue(prologueStep + 1);
      voices.narrate('narrator', PROLOGUE[prologueStep].text);
    } else finishPrologue();
  },
  prologueSkip: () => finishPrologue(),
  missions: () => { screens.missions(progress, m => openBriefing(m)); screens.show('campaign'); },
  survival: () => openHangar(null),
  training: () => openBriefing(TRAINING),
  codex: () => { screens.codex(progress); screens.show('codex'); },
  settings: () => { screens.renderSettings(); screens.show('settings'); },
  stagePrev: () => readStage(screens.briefingStage(-1)),
  stageNext: () => readStage(screens.briefingStage(1)),
  hangar: () => openHangar(currentMission),
  launchMission: () => launch(hangarMission ?? currentMission, hangarLoadout ?? loadoutFor(progress, currentMission)),
  useRecommended: () => { if (hangarMission) refreshHangar({ ...hangarMission.recommend }); },
  resume: () => resume(),
  restart: () => launch(survivalRun ? null : currentMission, currentLoadout),
  abort: () => { paused = false; audio?.setPaused(false); toMenu(); },
  debriefNext: () => {
    const last = world.mission ? results(world) : null;
    if (survivalRun) { launch(null, currentLoadout); return; }
    if (last?.won && currentMission?.special) {
      // From a special operation back to the campaign, where it was.
      if (progress.won.length < MISSIONS.length) openBriefing(nextMission(progress));
      else toMenu();
      return;
    }
    if (last?.won && currentMission?.training) {
      // From the range to the war: Mission 1, unless it has been flown.
      if (!progress.won.includes(MISSIONS[0].id)) openBriefing(MISSIONS[0]);
      else toMenu();
      return;
    }
    if (last?.won) {
      const i = MISSIONS.indexOf(currentMission);
      if (i >= 0 && i + 1 < MISSIONS.length) openBriefing(MISSIONS[i + 1]);
      else { toMenu(); screens.codex(progress, 'record'); screens.show('codex'); }
    } else launch(currentMission, currentLoadout);
  },
  replay: () => launch(survivalRun ? null : currentMission, currentLoadout),
  debriefHangar: () => openHangar(survivalRun ? null : currentMission),
  menu: () => toMenu(),
});

/* Let the loading text paint before heavy work. A hidden tab gets no
   animation frames at all, so a timeout keeps loading going there too. */
const nextPaint = () => new Promise(resolve => { requestAnimationFrame(() => resolve()); setTimeout(resolve, 100); });

/* WebGL 2, and whether it can render into half-float targets (the HDR
   buffer the bloom needs); null without WebGL 2. */
function probeGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const hdr = canRenderHalfFloat(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { hdr };
  } catch { return null; }
}

const QUALITY_CAP = { sharp: 1.5, balanced: 1, fast: 0.75 };
function applyGraphics() {
  if (bloom) renderer.setEffects(settings.bloom ? [bloom] : []);
  chase?.setFov(settings.fov ?? RENDER.fov);
  if (resolution && !BENCH) {
    resolution.setCap(QUALITY_CAP[settings.quality] ?? 1.5);
    if (renderer.getPixelRatio() !== resolution.ratio) {
      renderer.setPixelRatio(resolution.ratio);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }
}

/* ---------- boot ---------- */

async function boot() {
  const gl = probeGL();
  if (!gl) {
    screens.error('Meteora needs WebGL 2, which this browser or device does not provide.');
    return;
  }
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true,
    // In HDR the flames, bolts and fire keep their real brightness until the
    // tone mapping, and the bloom can let the brightest of it bleed.
    outputBufferType: gl.hdr && !LDR ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });
  if (gl.hdr && !LDR) bloom = createBloom();
  warmup = createWarmup(renderer, { hdr: gl.hdr && !LDR, pause: nextPaint });
  renderer.info.autoReset = false;
  resolution = createResolution({ devicePixelRatio: window.devicePixelRatio || 1 });
  renderer.setPixelRatio(BENCH ? BENCH_RATIO : resolution.ratio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);
  // The sun; its direction, colour and strength belong to the place.
  sunLight = new THREE.DirectionalLight(0xfff1e0, 5);
  scene.add(sunLight, sunLight.target);
  ambientLight = new THREE.AmbientLight(0x8090b0, 0.05);
  scene.add(ambientLight);
  // A faint fill from the sky above and the gas giant's glow below, so a
  // hull's night side reads as dark plating rather than a hole.
  hemiLight = new THREE.HemisphereLight(0x8ea6d8, 0x6e5a48, 0.45);
  scene.add(hemiLight);
  // A black hole's disk lights everything round it, from where it is.
  holeLight = new THREE.PointLight(0xffb070, 0, 0, 0);
  scene.add(holeLight);
  // And a cool light from over the viewer's shoulder, as a film lights its
  // actors: flying into the sun, the fighter you are chasing still shows
  // its shape instead of a black cut-out. A quarter of the sun, so the lit
  // side is hardly changed.
  fill = new THREE.DirectionalLight(0xbfd2ff, 1.3);
  scene.add(fill, fill.target);

  screens.progress(0.04, 'Charting the belt');
  library = createModelLibrary();
  await nextPaint();
  screens.progress(0.08, 'Painting the sky');
  applyLook('sector7');
  applyGraphics();
  let first;
  try {
    await library.loadRocks(f => screens.progress(0.15 + 0.4 * f, 'Charting the belt'));
    first = ['fighter', 'interceptor', 'perpetua', progress.loadouts?.last?.hull === 'swift' ? 'swift' : null, progress.loadouts?.last?.hull === 'anvil' ? 'anvil' : null].filter(Boolean);
    await library.preload(first, f => screens.progress(0.55 + 0.35 * f, 'Fuelling the wing'));
  } catch (error) {
    screens.error(`${error.message}. Check your connection and try again.`);
    return;
  }
  world = createWorld({ seed: 1234, storage, mission: MENU_SCENE, loadout: menuLoadout(), difficulty: progress.difficulty });
  buildFieldRender();
  glow = createGlowBatch(scene);
  smoke = createSmokeBatch(scene, sky.sunDir);
  fx = createExplosions(scene, glow, smoke, library.rocks[0], { reducedMotion: REDUCED_MOTION });
  // Effects back to front: smoke, fireballs, glow, shock rings. three.js
  // reverses its sorted draw lists under a reversed depth buffer —
  // renderOrder included — so the order's sign follows the buffer in use.
  const layer = renderer.capabilities.reversedDepthBuffer ? -1 : 1;
  [smoke.mesh, fx.fireballs.lobes, glow.mesh, fx.fireballs.rings].forEach((mesh, k) => { mesh.renderOrder = (9 + k) * layer; });
  plumes = createPlumes(glow);
  dust = createDust(glow);
  lookEffects();
  projectiles = createProjectiles(glow);
  folds = createFolds(glow);
  shields = createShields(scene);
  entities = createEntityRender(scene, library, glow, fx);
  engineLight = new THREE.PointLight(0x9fb8ff, 0, 60, 2);
  scene.add(engineLight);
  chase = createChaseCamera(camera, hardpoints('fighter').cockpit);
  chase.setObstruction(cameraClearance);
  chase.setFov(settings.fov ?? RENDER.fov);
  hud = createHud(hudCanvas);
  targetView = createTargetView(targetCanvas, library, { exposure: EXPOSURE, pause: nextPaint });
  hud.setKeys(keysOf(settings));
  // The hangar bay, behind the hangar screen. Its key light is the only one
  // anywhere that casts a shadow, so the flight's shaders do not change.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  hangar = createHangar(renderer, library);
  hangarStage = document.querySelector('[data-hangar-stage]');
  hangarStage?.addEventListener('pointerdown', e => { hangarStage.setPointerCapture(e.pointerId); hangar.grab(true); });
  hangarStage?.addEventListener('pointermove', e => { if (hangarStage.hasPointerCapture(e.pointerId)) hangar.turn(e.movementX); });
  for (const type of ['pointerup', 'pointercancel']) hangarStage?.addEventListener(type, () => hangar.grab(false));

  input = createInput(canvas, controlState, {
    isFlying: () => mode === 'flight' && world.state === 'flying' && !paused,
    onPause: () => pause(),
    onResume: () => { if (paused) resume(); },
  });
  window.addEventListener('keydown', e => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (mode === 'menu' && screens.current !== 'start' && screens.current !== 'loading') screens.back();
  });

  resize();
  window.addEventListener('resize', resize);
  screens.progress(0.92, 'Warming the engines');
  await nextPaint();
  await getReady(first);
  // For poking at the running game from the console (and for testing).
  if (DEBUG) {
    window.meteora = {
      get world() { return world; }, launch, toMenu, showDebrief, progress: () => progress, screens,
      // Drive the game by hand when the page is hidden and frames are throttled:
      // tick renders one frame; skip fast-forwards the simulation (no input).
      tick: (dt = 1 / 60) => tick(dt),
      // Hand the stick to a pilot function (world, dt) → input, e.g. the
      // balance bot from tests/bot.mjs; null gives it back.
      set pilot(fn) { debugPilot = fn; },
      set speed(k) { debugSpeed = k; },
      get bloom() { return bloom; },
      get camera() { return camera; },
      get scene() { return scene; },
      get chase() { return chase; },
      get targetView() { return targetView; },
      get renderer() { return renderer; },
      get library() { return library; },
      get music() { return music; },
      // Rebuild a place's look and report how long it took, GPU included.
      look(key) {
        const t = performance.now();
        lookKey = null;
        applyLook(key);
        const gl = renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return performance.now() - t;
      },
      skip(seconds) { for (let k = 0; k < seconds * 15; k++) { advance(world, IDLE, 1 / 15); handleEvents(drainEvents(world)); } tick(1 / 60); },
    };
  }
  screens.progress(1, 'Ready');
  screens.ready();
  screens.menu(progress);
  mode = 'menu';
  // The rest of the fleet loads behind the menu; the bay gets ready for
  // the three hulls you can fly as soon as it and they are in.
  const fleet = library.preload(['swift', 'anvil', 'perpetua', 'drone', 'freighter', 'maul', 'talon', 'mite']);
  Promise.all([fleet, hangar.loaded]).then(() => {
    if (hangar.ready) return warmup.warm(hangar.scene, hangar.camera, hangar.samples(['fighter', 'swift', 'anvil']));
  }).catch(error => console.warn('meteora: the hangar was not made ready', error));
  requestAnimationFrame(frame);

  const direct = params.get('mission');
  if (BENCH || AUTOPILOT) launch(null, defaultLoadout('kestrel'));
  else if (direct) {
    const m = missionById(direct);
    if (m || direct === 'survival') {
      const diff = params.get('difficulty');
      if (diff) progress.difficulty = diff;
      const hull = params.get('hull');
      launch(m, hull ? normalizeLoadout({ ...(m?.recommend ?? defaultLoadout(hull)), hull }) : (m?.recommend ?? defaultLoadout('kestrel')));
    }
  }
}

const menuLoadout = () => normalizeLoadout(progress.loadouts?.last ?? defaultLoadout('kestrel'), ALL_UNLOCKED);

function buildFieldRender() {
  if (fieldRender && fieldRender.field === world.field) return;
  if (fieldRender) {
    scene.remove(fieldRender.group);
    fieldRender.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
  // Legacy bench: every rock switches to its far mesh at 2 km, as before.
  fieldRender = createFieldRender(scene, world.field, library.rocks, beltTime, LEGACY ? { lodScale: Infinity, lodCap: 2000 } : {});
  fieldRender.field = world.field;
}

/* Set the place's look: sky, lights and dust — and, for a mission with a
   black hole, the hole in the sky (`well`, as the mission defines it). The
   sky is rebuilt only when the place changes; a few hundred milliseconds,
   under a loading screen. */
const lookIdOf = (key, well) => (well ? `${key}@${well.pos.join(',')}` : key);
function applyLook(key, well = null) {
  const id = lookIdOf(key, well);
  if (id === lookKey && sky) return;
  const next = lookFor(key);
  if (well) next.sky = { ...next.sky, hole: { pos: well.pos, rs: well.rs, disk: well.disk } };
  sky?.dispose();
  sky = createSky(renderer, scene, next.sky);
  scene.environment = sky.environment;
  const L = next.light;
  scene.environmentIntensity = L.environment;
  sunLight.position.copy(sky.sunDir).multiplyScalar(1000);
  sunLight.color.set(L.sun.colour);
  sunLight.intensity = L.sun.intensity;
  hemiLight.color.set(L.hemi.sky);
  hemiLight.groundColor.set(L.hemi.ground);
  hemiLight.intensity = L.hemi.intensity;
  ambientLight.intensity = L.ambient;
  fill.intensity = L.fill;
  holeLight.intensity = well ? L.hole ?? 6 : 0;
  if (well) holeLight.position.set(well.pos[0], well.pos[1], well.pos[2]);
  look = next;
  lookKey = id;
  lookEffects();
}
// Smoke is lit by the same sun; dust takes the place's tint.
function lookEffects() {
  smoke?.setSun(sky.sunDir, 1.7 * look.light.sun.intensity / 5, 0.12 * look.light.hemi.intensity / 0.45);
  dust?.setLook(look.dust);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hud?.resize();
}

function clearEffects() {
  fx.clear(); folds.clear(); shields.clear(); entities.clear(); plumes.reset(); hud.reset(); audio?.reset(); chatter.reset();
  critical.clear();
  wreck = null; lastKnock = -Infinity; deadTimer = 0; outcomeAt = null; debriefShown = false; slowmo = 0; jumped = false;
}

function fade(on, white = false) {
  fadeEl.classList.toggle('white', white);
  fadeEl.classList.toggle('on', on);
}

/* ---------- menus ---------- */

function toMenu() {
  voices.stop();
  menuScene();
  survivalRun = false;
  screens.resetHistory();
  screens.menu(progress);
  screens.show('start', { remember: false });
  music?.setSoundtrack(null);
  music?.setMood('menu', { force: true });
  fade(false);
}

/* Behind every menu screen runs the menu scene; coming back from a flight
   (a debrief, an abort) swaps it back in. */
function menuScene() {
  launchGen++;
  if (mode === 'menu' && world.missionDef === MENU_SCENE) return;
  mode = 'menu';
  paused = false;
  input?.release();
  document.body.classList.remove('flying');
  resetWorld(world, { mission: MENU_SCENE, loadout: menuLoadout(), difficulty: progress.difficulty });
  buildFieldRender();
  applyLook('sector7');
  clearEffects();
  chase.setShip(1, hardpoints('fighter').cockpit);
  hud.clear();
}

function finishPrologue() {
  progress.seenPrologue = true;
  saveProgress(storage, progress);
  screens.resetHistory();
  openBriefing(MISSIONS[0]);
}

// The Commander reads the briefing out, stage by stage — after the
// narrator's "previously", when there is one.
function readStage(i) {
  const line = screens.briefingLine(i);
  if (line?.text) voices.narrate(line.who ?? 'doukas', line.text);
}

function openBriefing(mission) {
  if (!mission) return;
  menuScene();
  currentMission = mission;
  hangarMission = mission;
  hangarLoadout = loadoutFor(progress, mission);
  const has = id => (progress.caseFile ?? []).includes(id);
  const recap = RECAPS[mission.id] && progress.won.length ? RECAPS[mission.id](has) : null;
  screens.briefing(mission, progress, progress.difficulty, key => { progress.difficulty = key; saveProgress(storage, progress); }, recap);
  screens.show('briefing');
  readStage(0);
  // Start bringing in what the mission flies while the pilot reads.
  const models = flightModels(mission, hangarLoadout);
  library.preload(models).then(() => targetView.prefetch(looksOf(models)));
  music?.setSoundtrack(null);
  music?.setMood(mission.number >= 8 ? 'tension' : 'menu', { force: true });
}

function openHangar(mission) {
  menuScene();
  hangarMission = mission;
  survivalRun = !mission;
  const unlocked = mission ? unlockedFor(progress, mission) : unlockedFor(progress, null);
  hangarLoadout = mission ? loadoutFor(progress, mission) : normalizeLoadout(progress.loadouts?.survival ?? defaultLoadout('kestrel'), unlocked);
  refreshHangar(hangarLoadout);
  const models = flightModels(mission, hangarLoadout);
  library.preload(models).then(() => targetView.prefetch(looksOf(models)));
  screens.show('hangar');
}
function refreshHangar(loadout) {
  const unlocked = hangarMission ? unlockedFor(progress, hangarMission) : unlockedFor(progress, null);
  hangarLoadout = screens.hangar({
    loadout, unlocked, mission: hangarMission, eyebrow: hangarMission ? null : 'Hangar · Survival', difficulty: progress.difficulty,
    onChange: L => refreshHangar(L),
  });
  // The hull on the turntable.
  const model = CLASSES[hangarLoadout.hull].model;
  library.load(model);
  hangar?.show(model);
  if (world.player?.cls !== hangarLoadout.hull) {
    resetWorld(world, { mission: MENU_SCENE, loadout: hangarLoadout, difficulty: progress.difficulty });
    entities.clear();
  }
}

/* ---------- flight ---------- */

async function launch(mission, loadout) {
  if (mode === 'loading') return;
  const gen = ++launchGen;
  survivalRun = !mission;
  currentMission = mission;
  const unlocked = mission ? unlockedFor(progress, mission) : unlockedFor(progress, null);
  currentLoadout = normalizeLoadout(loadout ?? defaultLoadout('kestrel'), BENCH || AUTOPILOT ? ALL_UNLOCKED : unlocked);
  if (mission) progress.loadouts[mission.id] = currentLoadout;
  else progress.loadouts.survival = currentLoadout;
  progress.loadouts.last = currentLoadout;
  saveProgress(storage, progress);
  mode = 'loading';
  paused = false;
  voices.stop();
  audio?.setPaused(false);
  const def = mission ?? SURVIVAL;
  const title = mission ? mission.title : 'Survival';
  // The flight's music comes down the wire while the drive spools.
  music?.prepare(def.soundtrack ?? null);
  const tip = HINTS[Math.floor(Math.random() * HINTS.length)];
  const where = mission ? `${missionLabel(mission)} · folding to ${mission.location}` : 'Belt sector 7';
  screens.fold(title, where, 0, 'Spooling the drive', tip);
  screens.show('loading');
  const models = flightModels(mission, currentLoadout);
  await library.preload(models, f => { if (gen === launchGen) screens.fold(title, where, 0.1 + 0.8 * f, 'Spooling the drive'); });
  if (gen !== launchGen) return;
  if (lookKey !== lookIdOf(def.env ?? 'sector7', def.well)) {
    screens.fold(title, where, 0.92, 'Painting the sky');
    await nextPaint();
    if (gen !== launchGen) return;
    applyLook(def.env ?? 'sector7', def.well);
  }
  screens.fold(title, where, 0.93, 'Pre-flight checks');
  await nextPaint();
  if (gen !== launchGen) return;
  await getReady(models);
  if (gen !== launchGen) return;
  screens.fold(title, where, 0.97, 'Charting the belt');
  await nextPaint();
  if (gen !== launchGen) return;
  resetWorld(world, { mission: def, loadout: currentLoadout, difficulty: BENCH ? 'veteran' : progress.difficulty });
  buildFieldRender();
  clearEffects();
  const hp = hardpoints(CLASSES[currentLoadout.hull].model);
  chase.setShip(Math.max(0.7, (hp.length || 15) / 15), hp.cockpit ?? [0, 1, -3]);
  chase.reset();
  startRun(world);
  // Arrive through a fold, under the mission's title.
  const pp = world.player;
  world.events.push({ type: 'foldIn', id: pp.id, pos: [...pp.ship.pos], q: [...pp.ship.q], radius: pp.radius, big: false, team: 0, dur: 1.1 });
  hud.banner(mission ? (mission.training ? mission.title : `Mission ${mission.number} · ${mission.title}`) : 'Survival', mission ? `${mission.location} · ${mission.dateline ?? ''}` : 'How long can you last?', '#ffffff', 3.6);
  if (!BENCH && !AUTOPILOT && roomForIntro()) chase.intro(4.6);
  mode = 'flight';
  screens.show(null, { remember: false });
  document.activeElement?.blur?.();
  audio?.start();
  music?.start();
  music?.setSoundtrack(def.soundtrack ?? null);
  music?.setMood(def.music ?? 'calm', { force: true });
  dropAll(controlState);
  if (!AUTOPILOT) input.engage();
  fade(true);
  setTimeout(() => fade(false), 60);
}

/* What a flight may show: the models its mission lists (Survival's
   Harrow), the hull flown, the Tender and torpedoes. */
const flightModels = (mission, loadout) => [...((mission ?? SURVIVAL).models ?? ['interceptor', 'talon', 'mite']), CLASSES[loadout.hull].model, 'drone', 'torpedo'];
/* Those models in every paint their ships wear, and every kind of rock a
   ship may be made of: pairs of model and paint. */
function looksOf(models) {
  const looks = new Map();
  for (const model of models) {
    looks.set(model, [model, null]);
    for (const c of Object.values(CLASSES)) if (c.model === model && c.tint) looks.set(`${model}+${c.tint}`, [model, c.tint]);
  }
  library.rocks.forEach((_, k) => looks.set(`rock:${k}`, [`rock:${k}`, null]));
  return [...looks.values()];
}

/* Everything a flight may draw, made ready before it starts (warmup.js),
   for the scene's renderer and the target window's. Not being ready is
   only slower, never fatal. */
async function getReady(models) {
  const list = looksOf(models);
  try {
    await warmup.warm(scene, camera, list.map(([model, paint]) => entities.sample(model, paint)).filter(Boolean));
    await targetView.warm(list);
  } catch (error) {
    console.warn('meteora: getting ready', error);
  }
}

/* How far along the line from the fighter to where the camera wants to be
   it can go before a rock or a hull is in the way (1: all the way). Rocks
   are swept by their real shapes, with a little room for the lens. */
const camA = [0, 0, 0], camB = [0, 0, 0];
function cameraClearance(from, to, rocksOnly = false) {
  camA[0] = from.x; camA[1] = from.y; camA[2] = from.z;
  camB[0] = to.x; camB[1] = to.y; camB[2] = to.z;
  let t = 1;
  const rock = world.field.sweepSphere(camA, camB, 2.5);
  if (rock) t = rock.t;
  if (rocksOnly) return t;
  for (const e of world.larges) {
    if (!e.alive || e.hidden) continue;
    const hit = sweepCompound(e, camA, camB, 2.5);
    if (hit && hit.t < t) t = hit.t;
  }
  return t;
}
/* Room for the opening shot: no rock or hull within reach of its arc. */
function roomForIntro() {
  const p = world.player.ship.pos, reach = 70 * chase.scale + 40;
  if (world.field.queryRadius(p, reach).length) return false;
  return !world.entities.some(e => e.big && e.alive && Math.hypot(e.ship.pos[0] - p[0], e.ship.pos[1] - p[1], e.ship.pos[2] - p[2]) < e.radius + reach);
}

function pause() {
  if (AUTOPILOT || mode !== 'flight' || world.state !== 'flying' || paused) return;
  paused = true;
  audio?.setPaused(true);
  dropAll(controlState);
  // A held lock hides the cursor and sends every click to the canvas, so
  // the pause screen's buttons could never be pressed.
  input.release();
  screens.pause(world);
  screens.renderSettings();
  screens.show('pause', { remember: false });
}

function resume() {
  if (mode !== 'flight') return;
  paused = false;
  audio?.setPaused(false);
  dropAll(controlState);
  screens.show(null, { remember: false });
  document.activeElement?.blur?.();
  if (!AUTOPILOT) input.engage();
}

function showDebrief() {
  if (debriefShown) return;
  debriefShown = true;
  input.release();
  document.body.classList.remove('flying');
  const res = results(world);
  let change = null;
  if (!survivalRun && currentMission && !currentMission.training) change = recordResult(progress, res);
  let survival = null;
  if (survivalRun) {
    const hull = currentLoadout.hull;
    const best = Math.max(progress.survival[hull] ?? 0, world.score);
    change = { newBest: false, unlocks: [], commendations: [] };
    survival = { wave: world.wave, score: world.score, best, newBest: world.score > (progress.survival[hull] ?? 0), hull: CLASSES[hull].name };
    progress.survival[hull] = best;
  }
  saveProgress(storage, progress);
  const i = MISSIONS.indexOf(currentMission);
  const story = screens.debrief(res, survivalRun ? null : currentMission, change, progress, { hasNext: currentMission?.training || currentMission?.special || (i >= 0 && i + 1 < MISSIONS.length), survival, beyond: jumped });
  if (jumped) fade(false);
  if (!survivalRun) voices.narrate('narrator', story);
  screens.show('debrief', { remember: false });
  mode = 'debrief';
  music?.setMood(res.won ? 'victory' : 'defeat', { force: true });
}

/* ---------- staged moments ---------- */

/* A cut to something happening away from the fighter, under letterbox
   bars and slowed down so that nothing is lost meanwhile, then a cut back.
   `framing(k, eye, look, up)` places the camera, k going 0 → 1. */
function cutTo(seconds, framing) {
  if (AUTOPILOT || mode !== 'flight' || world.state !== 'flying' || settings.cutaways === false || chase.inOutro) return;
  chase.cutaway(framing, seconds);
}
const STAGED = new Set(['wake', 'arrival', 'shipKilled', 'command', 'ringOpen']);
const s1 = new THREE.Vector3(), s2 = new THREE.Vector3(), s3 = new THREE.Vector3(), sq = new THREE.Quaternion();
const up0 = new THREE.Vector3(0, 1, 0);
const ZERO_VEL = [0, 0, 0];
const posOf = (e, out) => out.set(e.ship.pos[0], e.ship.pos[1], e.ship.pos[2]);
const axisOf = (e, x, y, z, out) => out.set(x, y, z).applyQuaternion(sq.set(e.ship.q[0], e.ship.q[1], e.ship.q[2], e.ship.q[3])).normalize();
const ease = k => k * k * (3 - 2 * k);

function stage(e) {
  switch (e.type) {
    case 'wake': {
      // The eye opens: close in front of the Mother's face, then drawing
      // back and round to her side until all eight hundred metres show.
      const mother = world.byId.get(e.id);
      if (!mother) return;
      const node = entities.view(e.id)?.root?.getObjectByName('eye');
      cutTo(4.6, (k, eye, look, up) => {
        const t = ease(k), d = 160 + 640 * t;
        if (node) node.getWorldPosition(s3); else posOf(mother, s3);
        look.copy(s3).lerp(posOf(mother, s1), 0.5 * t);
        axisOf(mother, 0, 1, 0, up);
        eye.copy(s3).addScaledVector(axisOf(mother, 0, 0, -1, s1), d * (1 - 0.45 * t))
          .addScaledVector(axisOf(mother, 1, 0, 0, s2), d * (0.3 + 0.9 * t)).addScaledVector(up, d * (0.12 + 0.2 * t));
      });
      break;
    }
    case 'arrival': {
      // The Watch's gunships fold in: from beyond them, looking back past
      // them at the ship they have come for, drifting in.
      const ships = e.ids.map(id => world.byId.get(id)).filter(Boolean);
      const home = world.byId.get(e.to);
      if (!ships.length || !home) return;
      cutTo(4, (k, eye, look) => {
        s3.set(0, 0, 0);
        for (const ship of ships) s3.add(posOf(ship, s1));
        s3.divideScalar(ships.length);
        const away = s2.copy(s3).sub(posOf(home, s1)).normalize();
        const side = s1.crossVectors(away, up0).normalize();
        const d = 700 - 120 * ease(k);
        eye.copy(s3).addScaledVector(away, d).addScaledVector(side, d * 0.45).addScaledVector(up0, d * 0.18);
        look.copy(s3).lerp(posOf(home, s1), 0.2);
      });
      break;
    }
    case 'shipKilled': {
      // A Mother dies: broadside on, the blasts running along her hull
      // until the last one takes her.
      if (e.cls !== 'mother') return;
      const mother = world.byId.get(e.id);
      if (!mother) return;
      const centre = new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2]);
      const side = axisOf(mother, 1, 0, 0, new THREE.Vector3()), fwd = axisOf(mother, 0, 0, -1, new THREE.Vector3());
      const up = axisOf(mother, 0, 1, 0, new THREE.Vector3());
      cutTo(bigDeathSpan(e.radius) + 1.6, (k, eye, look, u) => {
        look.copy(centre);
        u.copy(up);
        const d = e.radius * (2.7 - 0.4 * ease(k));
        eye.copy(centre).addScaledVector(side, d).addScaledVector(up, d * 0.28).addScaledVector(fwd, d * 0.25);
      });
      break;
    }
    case 'command': {
      // The Perpetua turns on the Mothers: alongside her, looking past her bow.
      const ship = world.byId.get(e.id);
      if (!ship) return;
      cutTo(4.2, (k, eye, look, up) => {
        const fwd = axisOf(ship, 0, 0, -1, s1), side = axisOf(ship, 1, 0, 0, s2);
        axisOf(ship, 0, 1, 0, up);
        posOf(ship, look).addScaledVector(fwd, 900);
        posOf(ship, eye).addScaledVector(side, 1100).addScaledVector(up, 320).addScaledVector(fwd, -500 + 500 * ease(k));
      });
      break;
    }
    case 'ringOpen': {
      // The drive ring opens: off the ark's bow, looking into the hoop.
      const ark = world.byId.get(e.id);
      if (!ark) return;
      const centre = new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2]);
      cutTo(3.6, (k, eye, look, up) => {
        look.copy(centre);
        const fwd = axisOf(ark, 0, 0, -1, s1), side = axisOf(ark, 1, 0, 0, s2);
        axisOf(ark, 0, 1, 0, up);
        const d = e.r * (6 - 1.2 * ease(k));
        eye.copy(centre).addScaledVector(fwd, d).addScaledVector(side, d * 0.55).addScaledVector(up, d * 0.2);
      });
      break;
    }
  }
}
/* ---------- the frame ---------- */

/* The world point under the aim crosshair: along the camera ray through the
   cursor, as far out as the target (or 1.2 km with none), which is where
   both guns converge. */
const aimRay = new THREE.Vector3();
function aimPointFor(cursor) {
  aimRay.set(cursor[0], -cursor[1], 0.5).unproject(camera).sub(camera.position).normalize();
  let distance = 1200;
  const t = world.target && world.target.alive ? world.target : null;
  if (t) distance = Math.min(2400, Math.max(150, Math.hypot(...t.ship.pos.map((c, i) => c - world.player.ship.pos[i])) - (t.big ? t.radius * 0.5 : 0)));
  return [camera.position.x + aimRay.x * distance, camera.position.y + aimRay.y * distance, camera.position.z + aimRay.z * distance];
}
const tmpV = new THREE.Vector3();

function say(message) {
  hud.callout(message);
  callout.textContent = message;
}

// An impact shake that falls off with the blast's distance from the camera.
function jolt(pos, strength, reach) {
  if (!pos) return;
  const d = camera.position.distanceTo(tmpV.set(pos[0], pos[1], pos[2]));
  kick(shake, strength * (REDUCED_MOTION ? 0.5 : 1) / (1 + (d / reach) ** 2));
}

function handleEvents(events) {
  const p = world.player;
  for (const e of events) {
    if (e.type === 'shipKilled' && e.big) {
      // The big ones go up across their whole hull.
      const ent = world.byId.get(e.id);
      const pts = ent?.colliders?.map(c => { const q = ent.ship.q; tmpV.set(c.pos[0], c.pos[1], c.pos[2]).applyQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3])); return [tmpV.x, tmpV.y, tmpV.z]; }) ?? null;
      fx.handle(e, pts);
      critical.delete(e.id);
    } else fx.handle(e);
    audio?.handle(e, world);
    if (mode === 'flight') { hud.handle(e, world); chatter.handle(e, world); }
    if (STAGED.has(e.type)) stage(e);
    switch (e.type) {
      case 'fire': if (!e.turret) projectiles.flash(e.pos, e.team, null, 1); else projectiles.flash(e.pos, e.team, null, Math.min(3, 1 + (e.size ?? 0) / 300)); break;
      case 'wave': say(`Wave ${e.n} incoming · ${e.count} contacts`); break;
      case 'shipKilled':
        if (e.id === p?.id) wreck = { pos: e.pos, vel: e.vel, t: 0 };
        jolt(e.pos, e.big ? 3 : e.id === p?.id ? 2 : 1.1, e.big ? 900 : 90);
        break;
      case 'bigKill': if (!REDUCED_MOTION) slowmo = 1.4; break;
      case 'missileExplode': case 'missileExpire': jolt(e.pos, e.torpedo ? 1.6 : 0.9, e.torpedo ? 120 : 60); break;
      case 'flak': jolt(e.pos, 0.5, 40); break;
      case 'rockBreak': if (!e.crumble) jolt(e.pos, 0.05 * e.radius, 30); break;
      case 'boltHit': if (e.targetId === p?.id) jolt(e.pos, e.shielded ? 0.15 : 0.35, 30); break;
      case 'shipHit': {
        const ent = world.byId.get(e.id);
        if (ent && e.shield && e.pos) shields.hit(ent, e.pos, shieldExtent(ent));
        break;
      }
      case 'shieldsCollapse': { const ent = world.byId.get(e.id); if (ent) shields.collapse(ent, shieldExtent(ent)); say(`${ent?.name ?? 'Target'}: shields down`); break; }
      case 'foldIn': case 'foldOut': folds.open(e); if (e.big) jolt(e.pos, 0.6, 600); break;
      case 'critical': critical.add(e.id); break;
      case 'wake':
        // The thing in the Deep opens its eye.
        hud.banner('IT WAKES', 'Signal C is a Mother', '#ff6a50', 2.8);
        jolt(e.pos, 1, 9000);
        if (!REDUCED_MOTION) slowmo = 1;
        break;
      case 'flares':
        // Fold after fold at the belt's edge, a beat apart.
        e.positions.forEach((pos, k) => setTimeout(() => {
          if (mode === 'flight') folds.open({ type: 'hold', pos, q: e.facing?.[k] ?? [0, 0, 0, 1], radius: 480, team: e.team ?? 1, dur: 7 });
        }, 350 * k));
        break;
      case 'ringOpen': {
        // The Long Mercy's drive ring opens: a fold held open in the hoop.
        const ark = world.byId.get(e.id);
        if (ark) folds.open({ type: 'hold', pos: e.pos, q: ark.ship.q, radius: e.r * 1.05, team: 0, dur: e.dur ?? 20 });
        jolt(e.pos, 0.5, 900);
        break;
      }
      case 'beamFire': jolt(e.pos, 0.8, 1500); break;
      // The fold takes everyone through: the screen stays white until the
      // debrief, rather than coming back to the belt they have left.
      case 'jump': fx.jumpFlash(e.pos, [0, 0, 0], 600); fade(true, true); jumped = true; if (!REDUCED_MOTION) slowmo = 1.2; break;
      case 'command': say('PERPETUA COMMAND AUTHORITY — HOLD'); break;
      // Into the Well: no fire, no wreck; a last red smear at the horizon.
      case 'lost':
        if (e.id !== p?.id) hud.callout(`${e.name} is lost to the Well`, 'rgba(255, 120, 90, A)');
        fx.jumpFlash(e.pos, [0, 0, 0], 40, [1, 0.35, 0.2]);
        break;
      case 'turncoat': say('Skiff 4 has turned hostile'); break;
      case 'music': music?.setMood(e.mood); break;
      case 'missionWon': hud.banner('MISSION COMPLETE', world.missionDef?.title ?? '', '#ffffff'); break;
      case 'missionLost': hud.banner('MISSION FAILED', e.reason ?? '', '#ff8a80'); break;
      case 'collision':
        // A scrape reports every step it lasts; it is felt as one knock.
        if (e.id === p?.id && e.speed > 8 && world.time - lastKnock > 0.25) {
          lastKnock = world.time;
          jolt(e.pos, Math.min(1.2, e.speed / 30), 30);
        }
        break;
    }
  }
}

let last = performance.now(), debugTimer = 0, frames = 0, frameMs = 0, lastControls = IDLE, criticalTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = now - last;
  const dt = Math.min(0.1, raw / 1000);
  last = now;
  const frameStart = performance.now();
  // The loading screen's long frames are the warm-up's, not the flight's:
  // judged as the flight's, they would start every mission at a lower
  // resolution, barred for half a minute from climbing back.
  if (!BENCH && !paused && mode !== 'loading' && document.visibilityState === 'visible' && raw > 0 && raw < 250) {
    const ratio = resolution.frame(raw);
    if (ratio !== renderer.getPixelRatio()) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }
  try {
    tick(dt);
  } catch (error) {
    // A broken frame must never end the game: log it, keep drawing.
    console.error('meteora frame', error);
  }
  if (BENCH) benchFrame(raw, performance.now() - frameStart);
  if (DEBUG) debugFrame(dt);
}

function tick(dt) {
  if (!AUTOPILOT) input.pollPad();
  const flight = mode === 'flight';
  const flying = flight && world.state === 'flying' && !paused;
  document.body.classList.toggle('flying', flying);
  // Slow motion after a capital kill, easing back.
  if (slowmo > 0) { slowmo = Math.max(0, slowmo - dt); world.timeScale = 0.35 + 0.65 * (1 - Math.min(1, slowmo / 0.6) ** 2); }
  else world.timeScale = 1;
  // A cutaway slows the fight down while the fighter is out of view.
  if (chase.inCutaway) world.timeScale = Math.min(world.timeScale, 0.45);
  if (DEBUG) world.timeScale *= debugSpeed;
  chase.steady();
  let controls = IDLE;
  if (flying) {
    controls = AUTOPILOT ? autopilot(world.time) : DEBUG && debugPilot ? debugPilot(world, dt * world.timeScale) : readInput(controlState, dt);
    if (controls.cursor) controls.aimPoint = aimPointFor(controls.cursor);
    if (controls.toggleCamera) chase.toggle();
    // A fresh press half a second into a cutaway cuts back to the fighter.
    if (chase.inCutaway && chase.cutawayAge > 0.5 && controlState.anyPress) chase.skipCutaway();
    controlState.anyPress = false;
    // Reaching for the controls ends the opening shot.
    if (chase.inIntro && (controls.fire || controls.missile || controls.boost || controlState.held.size
      || Math.hypot(controls.cursor?.[0] ?? 0, controls.cursor?.[1] ?? 0) > 0.08)) chase.skipIntro();
    lastControls = controls;
    if (GOD) { world.player.hull = Math.max(world.player.hull, world.player.maxHull * 0.3); }
  }
  if (!paused && mode !== 'loading') advance(world, controls, dt);
  handleEvents(drainEvents(world));
  // Radio lines are heard as they appear: the squelch, then the voice.
  if (flight && voices.update(world, paused)) audio?.handle({ type: 'radioLine' }, world);

  // The end of a mission: hold on the moment, then the debrief.
  if (flight && world.mission?.outcome && !debriefShown) {
    if (outcomeAt == null) {
      outcomeAt = performance.now();
      // The closing shot, unless the wreck camera already has the view or
      // the fold has taken the fighter away.
      if (world.player.alive && world.state !== 'dead' && !jumped) chase.outro();
    }
    const linger = jumped ? 2500 : world.mission.outcome === 'won' ? 5500 : world.state === 'dead' ? 4200 : 3500;
    if (performance.now() - outcomeAt > linger) showDebrief();
  }

  const alpha = Math.min(1, world.accumulator / STEP);
  const p = world.player;
  const step = paused ? 0 : dt;
  // Place everything first, then move the camera onto the player's pose.
  entities.sync(world, alpha, step, camera, { hidePlayer: chase.mode === 'nose' && flying && !chase.inOutro && !chase.inCutaway });
  const playerObject = entities.view(p.id)?.root ?? null;
  const burning = flight && settings.vibration !== false && p.alive && p.ship.afterburner;
  amps.rumble += ((burning ? SHAKE.rumble * (1.2 + 1.6 * p.ship.burnRamp) : 0) - amps.rumble) * Math.min(1, step * 6);
  const jolted = shake.impact > 1e-3 || amps.rumble > 1e-3 ? stepShake(shake, amps, step) : null;
  if (wreck && world.state === 'dead') {
    wreck.t += step;
    chase.watch(wreck.pos, wreck.vel, wreck.t, step, jolted);
  } else if (playerObject) {
    const showcase = mode !== 'flight';
    const orbit = screens.current === 'hangar' ? Math.max(26, (hardpoints(p.model).length || 15) * 2.4) : 48;
    chase.update(playerObject.position, playerObject.quaternion, p.ship.accelLocal, p.ship.afterburner ? 0.5 + 0.5 * p.ship.burnRamp : 0, dt, jolted, showcase || world.state === 'attract', orbit);
  }

  glow.begin();
  smoke.begin();
  camera.getWorldDirection(tmpV);
  fill.position.copy(camera.position);
  fill.target.position.copy(camera.position).addScaledVector(tmpV, 100);
  fill.target.updateMatrixWorld();
  if (!LEGACY) glow.setCamera(camera.position.x, camera.position.y, camera.position.z, tmpV.x, tmpV.y, tmpV.z);
  smoke.setCamera(camera.position.x, camera.position.y, camera.position.z, tmpV.x, tmpV.y, tmpV.z);
  entities.effects(world, step);
  dust.add(camera, p?.alive ? p.ship.vel : ZERO_VEL);
  if (p.alive && playerObject && playerObject.visible !== false) {
    const { power, boost } = plumes.add(p, playerObject, world.time, dt, camera);
    // The flame lights the tail and the rocks it passes; in HDR a brighter
    // light than this turns the hull behind the cockpit white on the burner.
    tmpV.set(0, 0, (hardpoints(p.model).length || 15) * 0.8).applyQuaternion(playerObject.quaternion).add(playerObject.position);
    engineLight.position.copy(tmpV);
    engineLight.color.setRGB(0.62 + 0.38 * boost, 0.72 + 0.2 * boost, 1);
    engineLight.intensity = (power * 26 + boost * 38) * (0.9 + 0.2 * Math.random());
  } else engineLight.intensity = 0;
  for (const e of world.entities) {
    if (e === p || !e.alive || e.folding?.dir === 'in') continue;
    const v = entities.view(e.id);
    if (v && v.root.visible) plumes.add(e, v.root, world.time, dt, camera);
  }
  // Ships going critical shed explosions until they go.
  criticalTimer -= step;
  if (critical.size && criticalTimer <= 0) {
    criticalTimer = 0.35;
    for (const id of critical) {
      const e = world.byId.get(id);
      if (!e?.alive) { critical.delete(id); continue; }
      const c = e.colliders[Math.floor(Math.random() * e.colliders.length)];
      const at = toWorld([0, 0, 0], e, c.pos);
      fx.blast(at, e.ship.vel);
      jolt(at, 0.4, 500);
    }
  }
  fieldRender.syncDynamic(world.field.dynamic);
  projectiles.add(world.weapons, alpha, dt, world, fx);
  folds.update(step);
  shields.update(step, id => entities.poseOf(id));
  const { flash } = fx.update(step, camera);
  renderer.toneMappingExposure = EXPOSURE * (1 + 0.6 * flash);

  // The rocks tumble on the belt's own clock, as the simulation turns them.
  beltTime.value = world.field.time;
  sky.update(camera, paused ? 0 : dt, glow);
  glow.end();
  smoke.end();
  fieldRender.update(camera);
  screens.animate(dt);
  const query = BENCH ? gpuBegin() : null;
  // The bloom's passes are renders of their own: count the frame as a whole.
  renderer.info.reset();
  if (mode === 'menu' && screens.current === 'hangar' && hangar?.ready) {
    // The hangar screen shows the bay instead, the stars through its door.
    hangar.setSky(sky.environment);
    hangar.update(dt, hangarStage?.getBoundingClientRect(), window.innerWidth, window.innerHeight);
    renderer.render(hangar.scene, hangar.camera);
  } else renderer.render(scene, camera);
  gpuEnd(query);

  if (flight && (world.state === 'flying' || world.state === 'dead') && playerObject) {
    hud.draw(world, camera, {
      position: playerObject.position, quaternion: playerObject.quaternion,
      cursor: lastControls.cursor, aimPoint: lastControls.aimPoint, cinematic: chase.cinematic, closing: chase.inOutro,
    }, paused ? 0 : dt);
  } else hud.clear();
  const rect = hud.targetViewRect;
  targetView.update(rect && world.target?.alive ? world.target : null, camera, rect);

  audio?.update(world, camera, step);
  music?.update(world, dt);
  music?.duck(voices.speaking);
}

function autopilot(t) {
  return {
    ...NEUTRAL_CONTROLS, ...IDLE, throttleSet: 0.6,
    yaw: 0.25 * Math.sin(t * 0.21), pitch: 0.18 * Math.sin(t * 0.37),
    fire: t % 4 < 1.5, missile: false, cycleTarget: t % 10 < 0.02,
  };
}

function debugFrame(dt) {
  frames++; frameMs += dt * 1000; debugTimer += dt;
  if (debugTimer <= 0.5) return;
  const info = renderer.info.render;
  const p = world.player;
  debugOut.hidden = false;
  debugOut.textContent = [
    `fps ${(frames / debugTimer).toFixed(0)}  ${(frameMs / frames).toFixed(1)} ms`,
    `draws ${info.calls}  tris ${(info.triangles / 1e6).toFixed(2)}M  glow ${glow.count}`,
    `rocks drawn ${fieldRender.stats.drawn}  pixel ratio ${renderer.getPixelRatio()}`,
    `effects ${Object.entries(fx.counts).map(([k, n]) => `${k} ${n}`).join('  ')}  smoke ${smoke.count}`,
    `mode ${mode}  state ${world.state}  mission ${world.missionDef?.id}  t ${world.mission?.time.toFixed(1)}  entities ${world.entities.length} (${world.active.length} active)`,
    `speed ${Math.hypot(...p.ship.vel).toFixed(0)} m/s  throttle ${p.ship.throttle.toFixed(2)}  hull ${p.hull.toFixed(0)}  shield ${p.shield.toFixed(0)}`,
  ].join('\n');
  frames = 0; frameMs = 0; debugTimer = 0;
}

/* ---------- ?bench ---------- */

const benchStats = createFrameStats();
let benchClock = 0, benchDone = false, gpuTimer = null;
const pendingQueries = [];

function gpuBegin() {
  const gl = renderer.getContext();
  if (gpuTimer === null) gpuTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2') || false;
  if (!gpuTimer || pendingQueries.length > 8) return null;
  const query = gl.createQuery();
  gl.beginQuery(gpuTimer.TIME_ELAPSED_EXT, query);
  return query;
}
function gpuEnd(query) {
  if (!query) return;
  renderer.getContext().endQuery(gpuTimer.TIME_ELAPSED_EXT);
  pendingQueries.push({ query, measuring: benchClock >= BENCH_WARM && !benchDone });
}
// Timer results arrive a few frames late; collect whatever has landed.
function gpuPoll() {
  const gl = renderer.getContext();
  while (pendingQueries.length) {
    const { query, measuring } = pendingQueries[0];
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
    const disjoint = gl.getParameter(gpuTimer.GPU_DISJOINT_EXT);
    const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
    pendingQueries.shift();
    gl.deleteQuery(query);
    if (measuring && !disjoint) benchStats.add('gpu', ns / 1e6);
  }
}

function benchFrame(interval, jsMs) {
  if (gpuTimer) gpuPoll();
  if (benchDone || mode !== 'flight' || world.state !== 'flying') return;
  // The same flight for both modes: the player cannot die mid-run.
  world.player.hull = world.player.maxHull;
  world.player.shield = world.player.maxShield;
  benchClock += interval / 1000;
  const info = renderer.info.render;
  if (benchClock >= BENCH_WARM) {
    benchStats.add('frame', interval);
    benchStats.add('js', jsMs);
    benchStats.add('draws', info.calls);
    benchStats.add('triangles', info.triangles);
  }
  debugOut.hidden = false;
  if (benchClock < BENCH_WARM + BENCH_SPAN) {
    debugOut.textContent = `benchmark ${LEGACY ? '(legacy) ' : ''}— ${benchClock < BENCH_WARM ? 'warming up' : 'measuring'} ` +
      `${Math.max(0, BENCH_WARM + BENCH_SPAN - benchClock).toFixed(0)} s`;
    return;
  }
  benchDone = true;
  setTimeout(() => {
    gpuPoll?.();
    const summary = benchStats.summary();
    const row = (label, m, unit = 'ms', digits = 2) => (m
      ? `${label.padEnd(10)} mean ${m.mean.toFixed(digits)}  p50 ${m.p50.toFixed(digits)}  p95 ${m.p95.toFixed(digits)} ${unit}`
      : `${label.padEnd(10)} n/a`);
    const fps = summary.frame ? 1000 / summary.frame.mean : 0;
    debugOut.textContent = [
      `METEORA BENCH ${LEGACY ? 'legacy' : 'current'} · pixel ratio ${renderer.getPixelRatio()} · ${innerWidth}×${innerHeight}`,
      `fps        ${fps.toFixed(1)}`,
      row('frame', summary.frame),
      row('js', summary.js),
      row('gpu', summary.gpu),
      row('draws', summary.draws, '', 0),
      `triangles  mean ${summary.triangles ? (summary.triangles.mean / 1e6).toFixed(2) : 'n/a'}M`,
      'Copy this, then compare with ?bench' + (LEGACY ? '' : '&legacy'),
    ].join('\n');
    console.log('METEORA_BENCH', JSON.stringify({
      mode: LEGACY ? 'legacy' : 'current', pixelRatio: renderer.getPixelRatio(),
      viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent, summary,
    }));
  }, 300);
}

boot();
