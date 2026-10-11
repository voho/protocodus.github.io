/* Meteora — assembly and the loop.

   Nothing here decides how the game plays; it wires the simulation to the
   screen and keeps them in step:

     keys → world (fixed 120 Hz) → events → flashes, callouts
                                  ↘ interpolated ships, belt, sky, glow, HUD

   Before Launch the world already exists: the fighter idles in the belt and
   the camera circles it behind the title, so the first thing anyone sees is
   the place they are about to fly through.

   `?debug` adds a read-out (frame time, draw calls, triangles, entities);
   `?debug&autopilot` flies a scripted pattern, which is how the game is
   screenshotted in automation.

   `?bench` measures the running game: it flies the autopilot pattern with the
   pixel ratio locked (`&ratio=1.5` to choose it), the player invulnerable, and
   after three seconds of warm-up records twenty seconds of frame interval,
   JavaScript time, GPU time (where the browser offers timer queries), draw
   calls and triangles, then shows the summary and logs it as JSON.
   `?bench&legacy` runs the same flight with the measured optimisations
   switched back off — one 2 km detail switch for every rock and no glow
   culling at the camera — so the two can be compared in the same browser. */

import * as THREE from 'three';
import { RENDER, STEP } from './config.js';
import { ANCHORS } from './anchors.js';
import { NEUTRAL_CONTROLS } from './flight.js';
import { advance, createWorld, drainEvents, resetWorld, startRun } from './world.js';
import { createControlState, dropAll, readInput } from './controls.js';
import { instantiateShip, loadModels } from './models.js';
import { createFieldRender } from './field-render.js';
import { createChaseCamera } from './camera.js';
import { createInput } from './input.js';
import { createScreens, loadSettings } from './screens.js';
import { createSky } from './sky.js';
import { createGlowBatch } from './glow.js';
import { createPlumes } from './plumes.js';
import { createProjectiles } from './projectiles.js';
import { createHud } from './hud.js';
import { createResolution } from './resolution.js';
import { createFrameStats } from './frame-stats.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const BENCH = params.has('bench');
const LEGACY = BENCH && params.has('legacy');
const BENCH_RATIO = Number(params.get('ratio')) || 1;
const AUTOPILOT = (DEBUG && params.has('autopilot')) || BENCH;
const BENCH_WARM = 3, BENCH_SPAN = 20;
const SUN_DIR = new THREE.Vector3(-0.62, 0.32, -0.72).normalize();

const canvas = document.getElementById('stage');
const hudCanvas = document.querySelector('canvas.hud');
const debugOut = document.querySelector('[data-debug]');
const callout = document.querySelector('[data-callout]');
const settings = loadSettings();
const controlState = createControlState(settings);
let storage = null;
try { storage = window.localStorage; } catch { /* no best score kept */ }

let world, renderer, scene, camera, chase, fieldRender, models, sky, glow, plumes, projectiles, hud, engineLight, input, resolution;
let paused = false, deadTimer = 0, playerMesh;
const enemyMeshes = new Map();
const beltTime = { value: 0 };

const screens = createScreens(document, settings, {
  launch, resume: launch, restart, again: restart,
  retry: () => location.reload(),
  settings: () => {},
});

function supportsWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

async function boot() {
  if (!supportsWebGL2()) {
    screens.error('Meteora needs WebGL 2, which this browser or device does not provide.');
    return;
  }
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true,
  });
  resolution = createResolution({ devicePixelRatio: window.devicePixelRatio || 1 });
  renderer.setPixelRatio(BENCH ? BENCH_RATIO : resolution.ratio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);
  const sun = new THREE.DirectionalLight(0xfff1e0, 5);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0x8090b0, 0.05));

  screens.progress(0.04, 'Charting the belt');
  world = createWorld({ seed: 1234, storage });
  screens.progress(0.08, 'Painting the sky');
  await new Promise(requestAnimationFrame);
  sky = createSky(renderer, scene, { seed: 7, sunDir: SUN_DIR });
  scene.environment = sky.environment;
  scene.environmentIntensity = 0.35;
  try {
    models = await loadModels((f, file) => screens.progress(0.15 + 0.8 * f, `Loaded ${file}`), { placeholders: DEBUG });
  } catch (error) {
    screens.error(`${error.message}. Check your connection and try again.`);
    return;
  }
  // Legacy bench: every rock switches to its far mesh at 2 km, as before.
  fieldRender = createFieldRender(scene, world.field, models.rocks, beltTime,
    LEGACY ? { lodScale: Infinity, lodCap: 2000 } : {});
  playerMesh = instantiateShip(models.fighter);
  scene.add(playerMesh);
  engineLight = new THREE.PointLight(0x9fb8ff, 0, 60, 2);
  scene.add(engineLight);
  chase = createChaseCamera(camera, ANCHORS.fighter.cockpit);
  glow = createGlowBatch(scene);
  plumes = createPlumes(glow);
  projectiles = createProjectiles(glow);
  hud = createHud(hudCanvas);

  input = createInput(canvas, controlState, {
    isFlying: () => world.state === 'flying' && !paused,
    onPause: () => pause(),
    onResume: () => { if (paused) launch(); },
  });

  resize();
  window.addEventListener('resize', resize);
  screens.progress(1, 'Ready');
  screens.ready();
  if (AUTOPILOT) launch();
  requestAnimationFrame(frame);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hud?.resize();
}

function launch() {
  if (!world) return;
  if (world.state !== 'flying') startRun(world);
  paused = false;
  dropAll(controlState);
  screens.show(null);
  // The Launch button keeps focus otherwise, and Space would press it again.
  document.activeElement?.blur?.();
  // Ask for the mouse; whether it comes, comes late or is refused, the
  // game is already flying (see input.js).
  if (!AUTOPILOT) input.engage();
}

function restart() {
  resetWorld(world);
  for (const [id, mesh] of enemyMeshes) { scene.remove(mesh); plumes.forget(id); }
  enemyMeshes.clear();
  chase.reset();
  deadTimer = 0;
  launch();
}

function pause() {
  if (AUTOPILOT || !world || world.state !== 'flying' || paused) return;
  paused = true;
  dropAll(controlState);
  // A held lock hides the cursor and sends every click to the canvas, so
  // the pause screen's buttons could never be pressed.
  input.release();
  screens.stats({ score: world.score, wave: world.wave });
  screens.show('pause');
}

function autopilot(t) {
  return {
    ...NEUTRAL_CONTROLS, throttleSet: 0.6,
    yaw: 0.25 * Math.sin(t * 0.21), pitch: 0.18 * Math.sin(t * 0.37),
    fire: t % 4 < 1.5, missile: false, cycleTarget: t % 10 < 0.02,
  };
}

const IDLE = { ...NEUTRAL_CONTROLS, fire: false, missile: false, cycleTarget: false };
const aimRay = new THREE.Vector3();

/* The world point under the aim crosshair: along the camera ray through the
   cursor, as far out as the target (or 1.2 km with none), which is where
   both guns converge. */
function aimPointFor(cursor) {
  aimRay.set(cursor[0], -cursor[1], 0.5).unproject(camera).sub(camera.position).normalize();
  let distance = 1200;
  const t = world.target && world.target.alive ? world.target : null;
  if (t) distance = Math.min(2200, Math.max(150, Math.hypot(...t.ship.pos.map((c, i) => c - world.player.ship.pos[i]))));
  return [camera.position.x + aimRay.x * distance, camera.position.y + aimRay.y * distance, camera.position.z + aimRay.z * distance];
}
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3();

function place(object, ship, alpha) {
  object.position.set(
    ship.prevPos[0] + (ship.pos[0] - ship.prevPos[0]) * alpha,
    ship.prevPos[1] + (ship.pos[1] - ship.prevPos[1]) * alpha,
    ship.prevPos[2] + (ship.pos[2] - ship.prevPos[2]) * alpha);
  tmpQ.set(ship.prevQ[0], ship.prevQ[1], ship.prevQ[2], ship.prevQ[3]);
  tmpQ2.set(ship.q[0], ship.q[1], ship.q[2], ship.q[3]);
  object.quaternion.slerpQuaternions(tmpQ, tmpQ2, alpha);
}

function say(message) {
  hud.callout(message);
  callout.textContent = message;
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'fire': projectiles.flash(e.pos, e.team); break;
      case 'wave': say(`Wave ${e.n} incoming · ${e.count} interceptors`); break;
      case 'shipKilled': if (e.team === 1) say('Interceptor destroyed'); break;
      case 'missileLaunch': say(e.locked ? 'Missile away · locked' : 'Missile away · unguided'); break;
    }
  }
}

let last = performance.now(), debugTimer = 0, frames = 0, frameMs = 0, lastControls = IDLE;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = now - last;
  const dt = Math.min(0.1, raw / 1000);
  last = now;
  // Adaptive resolution, fed only with frames that say something about the
  // GPU: not while paused, hidden, or right after a stall.
  const frameStart = performance.now();
  if (!BENCH && !paused && document.visibilityState === 'visible' && raw > 0 && raw < 250) {
    const ratio = resolution.frame(raw);
    if (ratio !== renderer.getPixelRatio()) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }

  const flying = world.state === 'flying' && !paused;
  document.body.classList.toggle('flying', flying);
  let controls = IDLE;
  if (flying) {
    controls = AUTOPILOT ? autopilot(world.time) : readInput(controlState, dt);
    if (controls.cursor) controls.aimPoint = aimPointFor(controls.cursor);
    if (controls.toggleCamera) chase.toggle();
    lastControls = controls;
  }
  if (!paused) advance(world, controls, dt);
  handleEvents(drainEvents(world));

  const alpha = Math.min(1, world.accumulator / STEP);
  const p = world.player;
  place(playerMesh, p.ship, alpha);
  playerMesh.visible = p.alive && !(chase.mode === 'nose' && world.state === 'flying');
  // The camera moves first, so everything drawn this frame — the glow
  // batch's near-camera fade included — sees where it really is.
  chase.update(playerMesh.position, playerMesh.quaternion, p.ship.accelLocal, p.ship.afterburner, dt,
    null, world.state === 'attract');

  glow.begin();
  camera.getWorldDirection(tmpV);
  if (!LEGACY) glow.setCamera(camera.position.x, camera.position.y, camera.position.z, tmpV.x, tmpV.y, tmpV.z);
  if (p.alive) {
    const { power, boost } = plumes.add(p, playerMesh, world.time, dt);
    // The plume lights the tail of the hull it comes out of.
    tmpV.set(0, 0, 9).applyQuaternion(playerMesh.quaternion).add(playerMesh.position);
    engineLight.position.copy(tmpV);
    engineLight.color.setRGB(0.62 + 0.38 * boost, 0.72 + 0.2 * boost, 1);
    engineLight.intensity = (power * 60 + boost * 120) * (0.9 + 0.2 * Math.random());
  } else {
    engineLight.intensity = 0;
  }

  for (const e of world.enemies) {
    let mesh = enemyMeshes.get(e.id);
    if (!e.alive) {
      if (mesh) { scene.remove(mesh); enemyMeshes.delete(e.id); plumes.forget(e.id); }
      continue;
    }
    if (!mesh) { mesh = instantiateShip(models.interceptor); enemyMeshes.set(e.id, mesh); scene.add(mesh); }
    place(mesh, e.ship, alpha);
    plumes.add(e, mesh, world.time, dt);
  }
  fieldRender.syncDynamic(world.field.dynamic);
  projectiles.add(world.weapons, alpha, dt);

  if (world.state === 'dead') {
    deadTimer += dt;
    if (deadTimer > 2.5 && screens.current !== 'dead') {
      screens.stats({ score: world.score, wave: world.wave, best: world.best });
      screens.show('dead');
    }
  }

  if (!paused) beltTime.value += dt;
  sky.update(camera, paused ? 0 : dt, glow);
  glow.end();
  fieldRender.update(camera);
  const query = BENCH ? gpuBegin() : null;
  renderer.render(scene, camera);
  gpuEnd(query);

  if (world.state === 'flying') {
    hud.draw(world, camera, {
      position: playerMesh.position, quaternion: playerMesh.quaternion,
      cursor: lastControls.cursor, aimPoint: lastControls.aimPoint,
    }, dt);
  } else {
    hud.clear();
  }

  if (BENCH) benchFrame(raw, performance.now() - frameStart);

  if (DEBUG) {
    frames++; frameMs += dt * 1000; debugTimer += dt;
    if (debugTimer > 0.5) {
      const info = renderer.info.render;
      debugOut.hidden = false;
      debugOut.textContent = [
        `fps ${(frames / debugTimer).toFixed(0)}  ${(frameMs / frames).toFixed(1)} ms`,
        `draws ${info.calls}  tris ${(info.triangles / 1e6).toFixed(2)}M  glow ${glow.count}`,
        `rocks drawn ${fieldRender.stats.drawn}  pixel ratio ${renderer.getPixelRatio()}`,
        `state ${world.state}  wave ${world.wave}  enemies ${world.enemies.filter(e => e.alive).length}`,
        `speed ${Math.hypot(...p.ship.vel).toFixed(0)} m/s  throttle ${p.ship.throttle.toFixed(2)}  FA ${p.ship.fa ? 'on' : 'off'}`,
      ].join('\n');
      frames = 0; frameMs = 0; debugTimer = 0;
    }
  }
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
  if (benchDone || world.state !== 'flying') return;
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
  // Let late GPU timer results land before summarising.
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
