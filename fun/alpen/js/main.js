/* Alpen — assembly and the loop.

   Nothing here decides anything about how the game feels; it wires together
   the pieces that do and keeps them in step. The shape of it:

     input → rider (fixed 120 Hz) → collisions → scoring
                                  ↘ camera, particles, wildlife, sky
                                  ↘ HUD

   The physics runs on a fixed step and the rest runs per frame. That split
   matters more than it looks: a spring, a grip limit and a ballistic launch
   test all behave differently at 30 fps than at 144 unless the step they see
   is constant, and "the jump was smaller on my laptop" is not a thing anyone
   should have to debug.

   Before the first key is pressed the game is already running, with the
   rider steering itself down the hill. An attract mode costs one function
   and is the difference between a page that waits and a page that is
   already somewhere. */

import * as THREE from 'three';

import { RENDER, RIDER, SCORE, PROPS } from './config.js';
import { createTerrain, heightAt, pisteCenter } from './terrain.js';
import { createProps, HARD, SOFT, JUMPABLE } from './props.js';
import { createWildlife } from './wildlife.js';
import { createSky } from './sky.js';
import { createWeather } from './weather.js';
import { createSnowfall, createSpray, createStreaks } from './particles.js';
import { Rider, trickName, CLEAN, SKETCHY, BAIL } from './rider.js';
import { createRiderModel } from './riderModel.js';
import { createChaseCamera } from './camera.js';
import { createRetro } from './retro.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const STEP = 1 / 120;
const TAU = Math.PI * 2;
const BEST_KEY = 'alpen.best';

const canvas = document.getElementById('stage');
const hudRoot = document.querySelector('.hud');
const curtain = document.querySelector('.curtain');
const pad = document.querySelector('.pad');

/* ==========================================================================
   Renderer
   ========================================================================== */

/* If WebGL is off, unsupported, or simply out of contexts, the module stops
   here — so the curtain has to stop inviting input before it does. Left to
   rethrow on its own it sat there saying "press any key" to a page that
   could no longer do anything with one. */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  document.body.classList.add('no-webgl');
  const inner = curtain.querySelector('.curtain-inner');
  if (inner) {
    inner.querySelectorAll('.keys, .go, .pause-only').forEach((n) => n.remove());
    const note = inner.querySelector('.tagline');
    if (note) {
      note.textContent = 'This one needs WebGL, and your browser could not start it. '
        + 'It is usually a setting called hardware acceleration, or a very old graphics driver.';
    }
  }
  curtain.classList.add('on');
  curtain.style.cursor = 'default';
  throw err;
}
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(RENDER.fov, 16 / 9, RENDER.near, RENDER.far);
const retro = createRetro(THREE, renderer);
scene.fog = new THREE.Fog(0xe3ecf6, RENDER.fogNear, RENDER.fogFar);

/* ==========================================================================
   World
   ========================================================================== */

const weather = createWeather(THREE);
const terrain = createTerrain(THREE);
const props = createProps(THREE);
const wildlife = createWildlife(THREE);
const sky = createSky(THREE);
const snowfall = createSnowfall(THREE);
const spray = createSpray(THREE);
const streaks = createStreaks(THREE);

scene.add(sky.group, sky.lights, terrain.mesh, props.group, wildlife.group,
  snowfall.points, spray.points, streaks.lines);

/* The one thing the rider knows about the mountain: how high it is here,
   kickers included. Everything else — normals, launches, landings — is
   derived from this single function. */
const world = {
  height: (x, z) => heightAt(x, z) + props.liftAt(x, z),
  // Only the chase camera asks this, and only about trunks: is there
  // something solid standing here?
  blocked: (x, z, r) => {
    const solids = props.solids;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (s.kind !== HARD) continue;
      const dz = s.z - z;
      const reach = s.r + r;
      if (dz > reach || dz < -reach) continue;
      const dx = s.x - x;
      if (dx * dx + dz * dz < reach * reach) return true;
    }
    return false;
  },
};

const rider = new Rider(THREE, world);
const model = createRiderModel(THREE);
scene.add(model.root, model.shadow);

const chase = createChaseCamera(THREE, camera);
const audio = createAudio();
const hud = createHud(hudRoot);

/* ==========================================================================
   Game state
   ========================================================================== */

const game = {
  mode: 'attract',       // attract | playing | paused
  score: 0,
  combo: 1,
  best: 0,
  rider,
  weather: weather.state,
  liveTrick: '',
};

try {
  game.best = Number(localStorage.getItem(BEST_KEY)) || 0;
} catch { /* private mode; the run just will not be remembered */ }

const input = createInput(window, { key: onKey });
if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
  input.bindTouch(pad);
}

const demo = { t: 0, turn: 0 };
const prev = new THREE.Vector3();
const wind = new THREE.Vector3();

function begin() {
  if (game.mode === 'playing') return;
  audio.start();
  hud.setMuted(audio.muted);
  if (game.mode === 'attract') restart();
  game.mode = 'playing';
  curtain.classList.remove('on');
  retro.fade(1);
}

function pause() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  curtain.classList.add('on');
  curtain.dataset.screen = 'paused';
  retro.fade(0.42);
  audio.quiet();
  input.clear();
}

function restart() {
  const start = rider.pos.z;
  rider.reset(start);
  rider.pos.x = pisteCenter(start);
  rider.pos.y = world.height(rider.pos.x, start);
  game.score = 0;
  game.combo = 1;
  game.liveTrick = '';
  chase.reset();
  spray.clear();
  wildlife.reset();
  hud.resetScore();
  props.update(rider.pos.z);
  terrain.update(rider.pos.x, rider.pos.z);
}

function onKey(e) {
  if (e.code === 'Escape') {
    if (game.mode === 'paused') begin();
    else pause();
    return;
  }
  if (e.code === 'KeyM') {
    hud.setMuted(audio.toggleMute());
    return;
  }
  if (e.code === 'KeyR' && game.mode !== 'attract') {
    restart();
    game.mode = 'playing';
    curtain.classList.remove('on');
    retro.fade(1);
    return;
  }
  if (game.mode !== 'playing') begin();
}

curtain.addEventListener('pointerdown', begin);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

/* ==========================================================================
   Scoring
   ========================================================================== */

function award(points, name, tone) {
  game.score += points;
  if (game.score > game.best) {
    game.best = game.score;
    try { localStorage.setItem(BEST_KEY, String(Math.round(game.best))); } catch { /* ignore */ }
  }
  if (name) hud.banner(name, points, tone);
}

function scoreLanding(s) {
  if (!s.judged || s.verdict === BAIL) return;
  // The same numbers the banner shows, so a landed 540 is always paid as a
  // 540 — the label and the score used to round in different directions
  const deg = s.halfTurns * 180;
  const flips = s.flipTurns;
  let pts = deg * SCORE.perDegree
    + flips * SCORE.perFlip
    + s.grabTime * SCORE.grabPerSecond
    + s.airTime * SCORE.airPerSecond;
  if (s.switchStance) pts *= SCORE.switchBonus;
  if (s.verdict === SKETCHY) pts *= 0.5;

  const name = trickName(s, s.verdict);
  if (!name || pts < SCORE.minTrickScore) return;

  pts *= game.combo;
  award(pts, name, s.verdict === SKETCHY ? 'warn' : '');
  if (s.verdict === CLEAN) {
    game.combo = Math.min(SCORE.comboMax, game.combo + SCORE.comboStep);
    audio.combo(game.combo);
  } else {
    audio.thud();
  }
}

rider.on('land', (s) => {
  if (game.mode !== 'playing') return;
  scoreLanding(s);
  audio.land(s.impact);
  chase.kick(Math.min(1.8, s.impact * 0.09));
  spray.burst(rider.pos, -rider.vel.x * 0.1, -rider.vel.z * 0.1,
    Math.round(8 + Math.min(34, s.impact * 2.2)), 0.5 + Math.min(1.4, s.impact * 0.07));
});

rider.on('launch', (vy) => {
  if (vy > 3.5) audio.jump(Math.min(1, vy / 12));
});

rider.on('fall', () => {
  game.combo = 1;
  if (game.mode !== 'playing') return;
  audio.crash();
  chase.kick(2.2);
  spray.burst(rider.pos, rider.vel.x * 0.08, rider.vel.z * 0.08, 40, 1.1);
  hud.banner('WIPEOUT', 0, 'bad');
});

rider.on('impact', (v) => {
  if (v > 6) chase.kick(Math.min(1.2, v * 0.05));
});

function nearMiss(kind) {
  const pts = SCORE.nearMiss * game.combo * (kind === 'bear' ? 3 : 1);
  award(pts, kind === 'bear' ? 'BEAR DODGED' : 'CLOSE ONE', 'near');
  audio.whoosh();
}

/* ==========================================================================
   Collisions
   ========================================================================== */

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = dx * dx + dz * dz;
  let t = len > 1e-6 ? ((px - ax) * dx + (pz - az) * dz) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function collide() {
  if (rider.state === 'fall') return;
  const solids = props.solids;
  const zLo = Math.min(prev.z, rider.pos.z) - 4;
  const zHi = Math.max(prev.z, rider.pos.z) + 4;

  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.z < zLo || s.z > zHi) continue;
    if (Math.abs(s.x - rider.pos.x) > s.r + 6) continue;

    const d = distToSegment(s.x, s.z, prev.x, prev.z, rider.pos.x, rider.pos.z);
    const reach = s.r + RIDER.radius;

    if (d > reach) {
      // Threading the needle is worth something, once per obstacle
      if (!s.grazed && d < reach + SCORE.nearMissRange && s.kind === HARD) {
        s.grazed = true;
        if (game.mode === 'playing') nearMiss('tree');
      }
      continue;
    }
    if (s.kind === JUMPABLE && rider.pos.y > s.top + 0.15) continue;
    if (s.kind === SOFT) {
      if (s.brushed) continue;
      s.brushed = true;
      rider.brush(PROPS.shrubDrag);
      spray.burst(rider.pos, (rider.pos.x - s.x) * 0.6, (rider.pos.z - s.z) * 0.6, 18, 0.7);
      audio.thud();
      chase.kick(0.5);
      continue;
    }
    if (rider.grace > 0 || game.mode === 'attract') continue;

    // Square on the trunk puts the rider down; anything glancing spins
    // them, costs speed, and lets them ride it out. `central` is 0 at the
    // trunk's edge and 0.45 at the point it becomes a wipeout, so severity
    // has to rise with it — inverted, a brush that barely clipped the bark
    // hit harder than a glance that nearly took the rider off the board.
    const central = 1 - d / reach;
    if (central > 0.45) rider.fall('hit');
    else rider.graze(rider.pos.x - s.x, rider.pos.z - s.z, central / 0.45);
    s.grazed = true;
  }
}

/* ==========================================================================
   Attract mode
   ========================================================================== */

function demoInput(dt) {
  demo.t += dt;
  // Steer for the middle of the piste with a lazy wander laid over it, so
  // the hill is being ridden rather than tracked
  const target = pisteCenter(rider.pos.z - 26) + Math.sin(demo.t * 0.31) * 11;
  const err = target - rider.pos.x;
  const heading = Math.atan2(rider.vel.x, -rider.vel.z);
  const want = Math.atan2(err, 34) - heading;
  demo.turn += (Math.max(-1, Math.min(1, want * 1.8)) - demo.turn) * Math.min(1, dt * 4);
  return {
    turn: demo.turn,
    tuck: Math.sin(demo.t * 0.17) > 0.55,
    brake: false,
    jump: false,
    trickGrab: !rider.grounded && rider.airTime > 0.2,
    trickFlip: false,
  };
}

/* ==========================================================================
   Loop
   ========================================================================== */

function liveTrickName() {
  if (rider.grounded) return '';
  return trickName({
    spin: rider.spinAccum,
    flips: rider.flipAccum,
    // Floored rather than rounded: in the air you have only completed the
    // rotation you have actually been through. Rounding is what the landing
    // does, once it has decided the rotation counts.
    halfTurns: Math.floor(Math.abs(rider.spinAccum) / Math.PI),
    flipTurns: Math.floor(Math.abs(rider.flipAccum) / TAU),
    grabTime: rider.grabTime,
    airTime: rider.airTime,
    switchStance: false,
  }, CLEAN) || '';
}

let lastStep = 0;
let last = 0;
let tickStep = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const running = game.mode !== 'paused';
  if (running) {
    input.update(dt);
    const control = game.mode === 'attract' ? demoInput(dt) : input.state;
    prev.copy(rider.pos);

    // Fixed-step physics, so a jump is the same size on every machine
    let steps = 0;
    lastStep += dt;
    while (lastStep >= STEP && steps < 8) {
      rider.step(STEP, control);
      lastStep -= STEP;
      steps += 1;
    }
    if (steps >= 8) lastStep = 0;

    terrain.update(rider.pos.x, rider.pos.z);
    props.update(rider.pos.z);
    collide();

    // A blip per half-rotation, so a 720 sounds like a 720
    if (rider.grounded) {
      tickStep = 0;
    } else {
      const step = Math.floor(Math.abs(rider.spinAccum) / Math.PI)
        + Math.floor(Math.abs(rider.flipAccum) / Math.PI);
      if (step > tickStep) audio.trick(step);
      tickStep = step;
    }

    const w = weather.update(dt);
    scene.fog.color.copy(w.haze);
    scene.fog.near = w.fogNear;
    scene.fog.far = w.fogFar;
    for (const p of [snowfall.points, spray.points]) {
      p.material.uniforms.uFog.value.copy(w.haze);
      p.material.uniforms.uNear.value = w.fogNear;
      p.material.uniforms.uFar.value = w.fogFar;
    }
    sky.update(rider.pos, w, dt);

    wildlife.update(dt, rider,
      (x, z, kind) => { if (game.mode === 'playing') nearMiss(kind); },
      () => { if (game.mode === 'playing' && rider.grace <= 0) rider.fall('bear'); });

    chase.update(rider, dt, world);
    model.update(rider, dt);

    // Spray, straight off the edge. The amount is the slide, so the screen
    // is always showing exactly how much grip is left.
    if (rider.grounded && rider.state !== 'fall') {
      const amount = rider.slide * 0.9 + rider.carveLoad * 2.2;
      if (amount > 0.6) {
        const side = Math.sign(rider.lateral || 1);
        spray.burst(rider.pos,
          rider.right.x * side * 1.6, rider.right.z * side * 1.6,
          Math.min(7, Math.round(amount * 0.8)),
          Math.min(1.3, 0.25 + amount * 0.09));
      }
    } else if (rider.state === 'fall') {
      spray.burst(rider.pos, 0, 0, 3, 0.8);
    }

    wind.set(w.windX, 0, w.windZ);
    snowfall.setIntensity(w.snow);
    snowfall.update(dt, camera, wind);
    spray.update(dt, camera);
    streaks.update(dt, camera, rider.vel, rider.speed);

    audio.ambience(rider.speed, rider.slide, rider.grounded, w.storm);
    game.liveTrick = liveTrickName();
    hud.update(game, dt);
  }

  retro.render(scene, camera);
}

/* ==========================================================================
   Fitting the window
   ========================================================================== */

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const size = retro.setSize(w, h);
  camera.aspect = size.width / size.height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
resize();

/* A hatch for tuning. Everything in the game is a plain object, so this is
   the whole debugger: read the numbers, or write one and watch what it does
   to the run. */
window.__alpenTerrain = { heightAt, pisteCenter };
window.__alpen = {
  game, rider, camera, world, weather, scene, sky, terrain, props, retro, wildlife, audio,
  config: { RENDER, RIDER, SCORE, PROPS },
  debug: () => ({
    mode: game.mode,
    speed: +(rider.speed * 3.6).toFixed(1),
    pos: [rider.pos.x, rider.pos.y, rider.pos.z].map((v) => +v.toFixed(1)),
    grounded: rider.grounded,
    airTime: +rider.airTime.toFixed(2),
    compression: +rider.compression.toFixed(3),
    slide: +rider.slide.toFixed(2),
    camDistance: +camera.position.distanceTo(rider.pos).toFixed(2),
    fov: +camera.fov.toFixed(1),
    buffer: [retro.width, retro.height],
    solids: props.solids.length,
    ramps: props.ramps.length,
    terrainVerts: terrain.vertexCount,
    weather: {
      phase: weather.state.phase,
      conditions: weather.state.conditions,
      storm: +weather.state.storm.toFixed(2),
      fog: [Math.round(weather.state.fogNear), Math.round(weather.state.fogFar)],
      keyI: +weather.state.keyI.toFixed(2),
    },
  }),
};

restart();
game.mode = 'attract';
hud.setMuted(audio.muted);
document.body.classList.add('ready');
requestAnimationFrame(frame);
