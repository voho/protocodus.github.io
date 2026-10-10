/* Meteora — assembly and the loop.

   Nothing here decides how the game plays; it wires the simulation to the
   screen and keeps them in step:

     input → world (fixed 120 Hz) → events → effects, sound, HUD
                                   ↘ interpolated ships, belt, camera

   Before Launch the world already exists: the fighter idles in the belt and
   the camera circles it behind the title, so the first thing anyone sees is
   the place they are about to fly through.

   `?debug` adds a read-out (frame time, draw calls, triangles, entities);
   `?debug&autopilot` flies a scripted pattern with no pointer lock, which
   is how the game is screenshotted in automation. */

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

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const AUTOPILOT = DEBUG && params.has('autopilot');
const SUN_DIR = new THREE.Vector3(-0.62, 0.32, -0.72).normalize();

const canvas = document.getElementById('stage');
const debugOut = document.querySelector('[data-debug]');
const settings = loadSettings();
const controlState = createControlState(settings);
let storage = null;
try { storage = window.localStorage; } catch { /* no best score kept */ }

let world, renderer, scene, camera, chase, fieldRender, models, input;
let paused = false, deadTimer = 0, playerMesh;
const enemyMeshes = new Map();
const beltTime = { value: 0 };

const screens = createScreens(document, settings, {
  launch, resume, restart, again: restart,
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.dprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010204);
  camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);
  const sun = new THREE.DirectionalLight(0xfff1e0, 5);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0x8090b0, 0.06));

  screens.progress(0.05, 'Charting the belt');
  world = createWorld({ seed: 1234, storage });
  try {
    models = await loadModels((f, file) => screens.progress(0.1 + 0.8 * f, `Loaded ${file}`), { placeholders: DEBUG });
  } catch (error) {
    screens.error(`${error.message}. Check your connection and try again.`);
    return;
  }
  fieldRender = createFieldRender(scene, world.field, models.rocks, beltTime);
  playerMesh = instantiateShip(models.fighter);
  scene.add(playerMesh);
  chase = createChaseCamera(camera, ANCHORS.fighter.cockpit);

  input = createInput(canvas, controlState, {
    isFlying: () => world.state === 'flying' && !paused,
    onPause: reason => pause(reason),
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
}

// Flying starts now; pointer lock is asked for but never waited on. Whether
// it arrives, arrives late (Safari) or is refused, input.js steers either
// way and only a real interruption pauses.
function launch() {
  if (!world) return;
  if (world.state !== 'flying') startRun(world);
  paused = false;
  dropAll(controlState);
  screens.show(null);
  if (!AUTOPILOT) input.engage();
}

function resume() { launch(); }

function restart() {
  resetWorld(world);
  fieldRender.restoreAll();
  for (const mesh of enemyMeshes.values()) scene.remove(mesh);
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
    fire: t % 4 < 1.5, missile: false, cycleTarget: false,
  };
}

const IDLE = { ...NEUTRAL_CONTROLS, fire: false, missile: false, cycleTarget: false };
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();

function place(object, ship, alpha) {
  object.position.set(
    ship.prevPos[0] + (ship.pos[0] - ship.prevPos[0]) * alpha,
    ship.prevPos[1] + (ship.pos[1] - ship.prevPos[1]) * alpha,
    ship.prevPos[2] + (ship.pos[2] - ship.prevPos[2]) * alpha);
  tmpQ.set(ship.prevQ[0], ship.prevQ[1], ship.prevQ[2], ship.prevQ[3]);
  tmpQ2.set(ship.q[0], ship.q[1], ship.q[2], ship.q[3]);
  object.quaternion.slerpQuaternions(tmpQ, tmpQ2, alpha);
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'staticRockRemoved') fieldRender.removeStatic(e.index);
  }
}

let last = performance.now(), debugTimer = 0, frames = 0, frameMs = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const flying = world.state === 'flying' && !paused;
  canvas.style.cursor = flying && input.mode === 'cursor' ? 'crosshair' : '';
  let controls = IDLE;
  if (flying) {
    controls = AUTOPILOT ? autopilot(world.time) : readInput(controlState);
    if (controls.toggleCamera) chase.toggle();
  }
  if (!paused) advance(world, controls, dt);
  handleEvents(drainEvents(world));

  const alpha = Math.min(1, world.accumulator / STEP);
  const p = world.player;
  place(playerMesh, p.ship, alpha);
  playerMesh.visible = p.alive && !(chase.mode === 'nose' && world.state === 'flying');

  for (const e of world.enemies) {
    let mesh = enemyMeshes.get(e.id);
    if (!e.alive) {
      if (mesh) { scene.remove(mesh); enemyMeshes.delete(e.id); }
      continue;
    }
    if (!mesh) { mesh = instantiateShip(models.interceptor); enemyMeshes.set(e.id, mesh); scene.add(mesh); }
    place(mesh, e.ship, alpha);
  }
  fieldRender.syncDynamic(world.field.dynamic);

  if (world.state === 'dead') {
    deadTimer += dt;
    if (deadTimer > 2.5 && screens.current !== 'dead') {
      input.release();
      screens.stats({ score: world.score, wave: world.wave, best: world.best });
      screens.show('dead');
    }
  }

  chase.update(playerMesh.position, playerMesh.quaternion, p.ship.accelLocal, p.ship.afterburner, dt,
    null, world.state === 'attract');
  if (!paused) beltTime.value += dt;
  fieldRender.update(camera);
  renderer.render(scene, camera);

  if (DEBUG) {
    frames++; frameMs += dt * 1000; debugTimer += dt;
    if (debugTimer > 0.5) {
      const info = renderer.info.render;
      debugOut.hidden = false;
      debugOut.textContent = [
        `fps ${(frames / debugTimer).toFixed(0)}  ${(frameMs / frames).toFixed(1)} ms`,
        `draws ${info.calls}  tris ${(info.triangles / 1e6).toFixed(2)}M`,
        `cells ${fieldRender.stats.visible}/${fieldRender.stats.cells}`,
        `state ${world.state}  wave ${world.wave}  enemies ${world.enemies.filter(e => e.alive).length}`,
        `speed ${Math.hypot(...p.ship.vel).toFixed(0)} m/s  throttle ${p.ship.throttle.toFixed(2)}  FA ${p.ship.fa ? 'on' : 'off'}`,
      ].join('\n');
      frames = 0; frameMs = 0; debugTimer = 0;
    }
  }
}

boot();
