/* Alpen — assembly and the loop.

   Nothing here decides anything about how the game feels; it wires together
   the pieces that do and keeps them in step. The shape of it:

     input → rider (fixed 120 Hz) → collisions → scoring
                                  ↘ camera, particles, trail, wildlife, sky
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

import { RENDER, RIDER, SCORE, PROPS, GRADE } from './config.js';
import {
  createTerrain, heightAt, nearestCenter, corridorHalfAt,
} from './terrain.js';
import { createProps, HARD, SOFT } from './props.js';
import { createWildlife } from './wildlife.js';
import { createSky } from './sky.js';
import { createWeather } from './weather.js';
import { createSnowfall, createSpray, createStreaks } from './particles.js';
import { createTrail } from './trail.js';
import { createHelicopter } from './helicopter.js';
import { createHuts } from './huts.js';
import { Rider, trickName, CLEAN, SKETCHY, BAIL } from './rider.js';
import { createRiderModel } from './riderModel.js';
import { createChaseCamera } from './camera.js';
import { createRetro } from './retro.js';
import { createShading } from './shading.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import {
  randomWorldSeed, setWorldSeed, worldSeedCode,
} from './noise.js';

const STEP = 1 / 120;
const TAU = Math.PI * 2;
const BEST_KEY = 'alpen.best';

const seedParams = new URLSearchParams(window.location.search);
const suppliedSeed = seedParams.get('seed');
const runSeed = setWorldSeed(suppliedSeed || randomWorldSeed());
const runCode = worldSeedCode(runSeed);

// Put generated seeds in the address bar. A run can now be shared, replayed
// and regression-tested without turning the endless world into stored data.
if (!suppliedSeed) {
  try {
    const seededUrl = new URL(window.location.href);
    seededUrl.searchParams.set('seed', runCode);
    window.history.replaceState(null, '', seededUrl);
  } catch { /* an embedded host may forbid history changes; the run still works */ }
}

const canvas = document.getElementById('stage');
const hudRoot = document.querySelector('.hud');
const curtain = document.querySelector('.curtain');
const pad = document.querySelector('.pad');
const seedLabel = document.querySelector('[data-seed]');
if (seedLabel) seedLabel.textContent = runCode;

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

/* Shadows, softened.

   These started on plain PCF, on the reasoning that a feathered edge does not
   belong in a picture quantised to five diffuse bands and five bits of
   colour — a soft gradient inside a shadow edge becomes a dither pattern two
   pixels wide. That reasoning was sound for the framebuffer this game had at
   the time and stopped being true when it went to native resolution: there
   are now enough pixels across an edge for a gradient to read as a gradient.

   And the physical argument was always on the other side. The sun is half a
   degree wide, so every shadow on a mountain has a penumbra that widens with
   distance from whatever cast it — a tree's shadow is sharp at the trunk and
   soft at its tip, and hard-edged shadows are the single most reliable tell
   of a real-time renderer. Soft PCF plus a radius on the light gets most of
   that for one extra tap pattern. */
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(RENDER.fov, 16 / 9, RENDER.near, RENDER.far);
const retro = createRetro(THREE, renderer);
scene.fog = new THREE.Fog(0xe3ecf6, RENDER.fogNear, RENDER.fogFar);

/* ==========================================================================
   World
   ========================================================================== */

/* The shared shading first, because everything with a surface takes it.

   It owns one block of uniforms — the sky's three stops, the sun, the fog —
   and hands the *same objects* to every material it patches, so the single
   `shading.update(w, camera)` below moves the light on the terrain, the
   trees, the animals, the huts, the helicopter and the rider at once. Six
   modules that know nothing about each other end up agreeing about what time
   of day it is, which is the only reason a day/night cycle across this many
   materials costs nothing per frame. */
const shading = createShading(THREE);

const weather = createWeather(THREE);
const terrain = createTerrain(THREE, shading);
const props = createProps(THREE, shading);
const wildlife = createWildlife(THREE, shading);
const sky = createSky(THREE);
const snowfall = createSnowfall(THREE);
const spray = createSpray(THREE);
const streaks = createStreaks(THREE);
const trail = createTrail(THREE);
const heli = createHelicopter(THREE, shading);
const huts = createHuts(THREE, shading);

scene.add(sky.group, sky.lights, terrain.mesh, props.group, wildlife.group,
  heli.group, huts.group, trail.mesh, snowfall.points, spray.points, streaks.lines);

/* Who casts and who receives, decided here and by name.

   Not by traversing the scene and switching everything on, which is the
   tempting one-liner and is wrong twice over. The sky is a dome, a haze cone
   and four mountain ranges drawn at a radius of nearly three kilometres —
   put those in the shadow pass and the depth map is a picture of the inside
   of a sphere, and the entire mountain is in shadow. And the snowfall, the
   spray and the trail are transparent point clouds and ribbons, which cast
   quadrilateral blocks of darkness rather than anything resembling snow.

   So it is the solid world only, and the split matters: the terrain receives
   but does not cast, because a heightfield lit from above shadows itself
   almost nowhere and the depth pass is where the cost is. Everything
   standing *on* it casts. */
/* The mountain both casts and receives.

   Casting was left off at first on the reasoning that a heightfield lit from
   above barely shadows itself and the depth pass is where the cost is. That
   is true of a *smooth* heightfield and false of this one: the whole point of
   the knolls is that their lee sides fall away sharply, the cliffs are near
   vertical, and the containment walls stand sixty metres over the piste. With
   the terrain out of the pass none of that threw anything, so the features
   that shape the run were the only things in the picture with no shadow —
   and a knoll you cannot see the shadow of is a knoll you cannot see. It is
   eight thousand vertices in a depth-only pass; it costs nothing measurable. */
terrain.mesh.castShadow = true;
terrain.mesh.receiveShadow = true;

function shadowCasting(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

for (const group of [props.group, wildlife.group, huts.group]) shadowCasting(group);

/* The one thing the rider knows about the mountain: how high it is here,
   kickers included. Everything else — normals, launches, landings — is
   derived from this single function. */
const world = {
  height: (x, z) => heightAt(x, z) + props.liftAt(x, z),
  /* Running out of momentum on the wall is a real failed commitment. Doing
     the same on a steep-looking patch inside the groomed piste is not: the
     board can wash out and recover downhill there without a hidden wipeout. */
  canStall: (x, z) => (
    Math.abs(x - nearestCenter(x, z)) > corridorHalfAt(z)
  ),
  // Weather changes the surface continuously. The rider reads both inside
  // the fixed physics step; visuals and handling therefore describe the
  // same snow rather than two unrelated systems.
  grip: 1,
  surfaceDrag: 1,
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
  // Rails are not part of the height field — they are a metre-wide line in
  // the air, and the rider only ever asks about one while falling onto it
  rail: (x, z, y) => props.railAt(x, z, y),
  railPoint: (r, z, out) => props.railPoint(r, z, out),
};

const rider = new Rider(THREE, world);
const model = createRiderModel(THREE, shading);
scene.add(model.root, model.shadow);
shadowCasting(model.root);
/* The blob is a fake shadow and stays out of the real one. Left in the pass
   it would cast a hard disc of its own onto the snow underneath it, and
   receive the rider's shadow on top of that — a shadow inside a shadow.
   It still earns its place: it is the only cue for height above ground when
   the rider is over a hollow the real shadow has fallen into. */
model.shadow.castShadow = false;
model.shadow.receiveShadow = false;

const chase = createChaseCamera(THREE, camera);
const audio = createAudio();
const hud = createHud(hudRoot);
const touchPause = pad.querySelector('[data-action="pause"]');
const touchMute = pad.querySelector('[data-action="mute"]');

/* ==========================================================================
   Game state
   ========================================================================== */

const game = {
  mode: 'attract',       // attract | playing | paused
  score: 0,
  combo: 1,
  best: 0,
  seed: runCode,
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
const riderScreen = new THREE.Vector3();
let pausedRendered = false;

function showMuted(value) {
  hud.setMuted(value);
  if (touchMute) touchMute.setAttribute('aria-pressed', String(!!value));
}

function begin() {
  if (game.mode === 'playing') return;
  audio.start();
  showMuted(audio.muted);
  if (game.mode === 'attract') restart();
  game.mode = 'playing';
  pausedRendered = false;
  curtain.classList.remove('on');
  retro.fade(1);
}

function pause() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  pausedRendered = false;
  curtain.classList.add('on');
  curtain.dataset.screen = 'paused';
  retro.fade(0.42);
  audio.quiet();
  input.clear();
}

function restart() {
  const start = rider.pos.z;
  rider.reset(start);
  // The run forks, so the middle of the piste is sometimes the island in
  // between. Whichever branch is nearer is always rideable ground.
  rider.pos.x = nearestCenter(rider.pos.x, start);
  rider.pos.y = world.height(rider.pos.x, start);
  game.score = 0;
  game.combo = 1;
  game.liveTrick = '';
  chase.reset();
  spray.clear();
  trail.clear();
  wildlife.reset();
  heli.reset();
  huts.reset();
  hud.resetScore();
  props.update(rider.pos.z);
  terrain.update(rider.pos.x, rider.pos.z);
}

function newMountain() {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', worldSeedCode(randomWorldSeed()));
  window.location.assign(url);
}

function toggleFullscreen() {
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  const action = active
    ? (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
    : (document.documentElement.requestFullscreen
      || document.documentElement.webkitRequestFullscreen)?.call(document.documentElement);
  action?.catch?.(() => { /* fullscreen can be blocked by an embedding page */ });
}

function onKey(e) {
  if (e.code === 'Escape') {
    if (game.mode === 'paused') begin();
    else pause();
    return;
  }
  if (e.code === 'KeyM') {
    showMuted(audio.toggleMute());
    return;
  }
  if (e.code === 'KeyN') {
    newMountain();
    return;
  }
  if (e.code === 'KeyF') {
    toggleFullscreen();
    if (game.mode !== 'playing') begin();
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
touchPause?.addEventListener('click', (e) => {
  e.preventDefault();
  pause();
});
touchMute?.addEventListener('click', (e) => {
  e.preventDefault();
  showMuted(audio.toggleMute());
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  game.mode = 'paused';
  pausedRendered = true;
  curtain.dataset.screen = 'paused';
  curtain.classList.add('on');
  const note = curtain.querySelector('.pause-only.tagline');
  if (note) note.textContent = 'Graphics paused while the browser restores WebGL.';
  audio.quiet();
  input.clear();
});

canvas.addEventListener('webglcontextrestored', () => {
  const note = curtain.querySelector('.pause-only.tagline');
  if (note) note.textContent = 'Paused.';
  chase.reset();
  scheduleResize();
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
  const fast = Math.max(0, Math.min(1,
    (s.takeoffSpeed - SCORE.speedBonusFrom) / (SCORE.speedBonusFull - SCORE.speedBonusFrom)));
  pts *= 1 + fast * SCORE.speedBonus;
  if (s.lipPop) pts *= SCORE.lipBonus;
  if (s.verdict === SKETCHY) pts *= 0.5;

  const name = trickName(s, s.verdict);
  if (!name || pts < SCORE.minTrickScore) return;

  pts *= game.combo;
  const callout = s.lipPop && s.verdict === CLEAN ? `PERFECT POP · ${name}` : name;
  award(pts, callout, s.verdict === SKETCHY ? 'warn' : '');
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
  chase.land(s.impact);
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

rider.on('grind', () => {
  if (game.mode !== 'playing') return;
  audio.whoosh();
});

/* A rail pays by the second and pays again for leaving it on purpose, which
   is the whole shape of the trick: getting on is luck, staying on is the
   skill, and popping off the end rather than falling off the side is what
   the points are actually for. */
rider.on('grindOut', (t) => {
  if (game.mode !== 'playing' || t < 0.35) return;
  const pts = (t * SCORE.grindPerSecond + SCORE.grindOut) * game.combo;
  award(pts, t > 1.4 ? 'LONG GRIND' : 'RAIL SLIDE', '');
  game.combo = Math.min(SCORE.comboMax, game.combo + SCORE.comboStep);
  audio.combo(game.combo);
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
  if (rider.state === 'fall' || rider.state === 'grind') return;
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
    // Anything with a real top can be cleared in the air, bush or boulder.
    // Trees carry top: 99 because you do not jump a tree.
    if (rider.pos.y > s.top + 0.15) continue;
    if (s.kind === SOFT) {
      if (s.hit) continue;
      s.hit = true;
      rider.brush(PROPS.shrubDrag);
      spray.burst(rider.pos, (rider.pos.x - s.x) * 0.6, (rider.pos.z - s.z) * 0.6, 18, 0.7);
      audio.thud();
      chase.kick(0.5);
      continue;
    }
    if (rider.grace > 0 || game.mode === 'attract') continue;
    // One response per contact. `collide()` runs per physics substep, so a
    // rider still inside the trunk's radius on the next step would take a fresh
    // impulse and a fresh multiplicative speed cut each time — which made
    // the same graze measurably harsher on a 144 Hz display than a 60 Hz one.
    if (s.hit) continue;
    s.hit = true;
    s.grazed = true;

    /* What happens next is the rider's decision, not this loop's. It used to
       be judged here, on how centrally the trunk was caught and nothing
       else, so a tree clipped at walking pace and the same tree at 150 km/h
       were the same event. All this hands over now is the direction of the
       push and how square the contact was; the speed going into it is what
       decides whether that is a wobble or a very long tumble. */
    const closeness = 1 - d / reach;
    const outcome = rider.strike(rider.pos.x - s.x, rider.pos.z - s.z, closeness);
    if (outcome === 'brush') {
      audio.thud();
      chase.kick(0.4);
    } else if (outcome === 'graze') {
      audio.thud();
      chase.kick(1.0);
      spray.burst(rider.pos, (rider.pos.x - s.x) * 0.5, (rider.pos.z - s.z) * 0.5, 22, 0.9);
    }
  }
}

/* ==========================================================================
   Attract mode
   ========================================================================== */

function demoInput(dt) {
  demo.t += dt;
  // Steer for the middle of whichever branch of the piste is nearer, with a
  // lazy wander laid over it, so the hill is being ridden rather than tracked
  const target = nearestCenter(rider.pos.x, rider.pos.z - 26) + Math.sin(demo.t * 0.31) * 11;
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
    pausedRendered = false;
    input.update(dt);
    const control = game.mode === 'attract' ? demoInput(dt) : input.state;

    // Fixed-step physics, so a jump is the same size on every machine
    let steps = 0;
    lastStep += dt;
    while (lastStep >= STEP && steps < 8) {
      prev.copy(rider.pos);
      rider.step(STEP, control);
      // Obstacle sweeps belong to the same clock as motion. Running this once
      // per rendered frame made a fast tree impact subtly display-rate
      // dependent even though the rider itself was fixed-step.
      collide();
      lastStep -= STEP;
      steps += 1;
    }
    if (steps >= 8) lastStep = 0;

    terrain.update(rider.pos.x, rider.pos.z, dt);
    props.update(rider.pos.z);

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
    // Falling snow is fresh snow: progressively softer, slower and easier to
    // wash out on. The endpoints stay arcade-readable rather than punitive.
    world.grip = 1 - w.storm * (1 - RIDER.stormGrip);
    world.surfaceDrag = 1 + w.storm * (RIDER.stormFriction - 1);
    scene.fog.color.copy(w.haze);
    scene.fog.near = w.fogNear;
    scene.fog.far = w.fogFar;
    // Everything with a hand-written fog term needs telling where the
    // curtain is this frame; three only does it for its own materials
    for (const p of [snowfall.points, spray.points, trail.points]) {
      p.material.uniforms.uFog.value.copy(w.haze);
      p.material.uniforms.uNear.value = w.fogNear;
      p.material.uniforms.uFar.value = w.fogFar;
    }
    sky.update(rider.pos, w, dt);
    wildlife.update(dt, rider,
      (x, z, kind) => { if (game.mode === 'playing') nearMiss(kind); },
      () => { if (game.mode === 'playing' && rider.grace <= 0) rider.fall('bear', rider.speed); });

    heli.update(dt, rider, wildlife, w);

    huts.update(dt, rider, w, () => {
      if (game.mode !== 'playing') return;
      award(SCORE.cocoa * game.combo, 'COCOA STOP', 'near');
      game.combo = Math.min(SCORE.comboMax, game.combo + SCORE.comboStep);
      audio.combo(game.combo);
    });

    chase.update(rider, dt, world);
    // One write, and every material in the world agrees about the sky it is
    // dissolving into. It follows both the sky and the chase camera so the
    // view-space sun cannot lag a carve by one rendered frame.
    shading.update(w, camera);
    model.update(rider, dt);
    trail.update(rider, dt);

    /* Spray, straight off the edge — and now off a clean carve as well as a
       slide.

       This is the single biggest read the screen gives back, because it is
       the only thing whose quantity is a direct measure of how hard the board
       is working. It used to be almost entirely the slide, which meant a
       railed carve — the thing the game is actually about — threw nothing at
       all and only a mistake made powder. A carved edge is cutting a trench
       through snow at forty metres a second; it throws plenty. So the two are
       separated: the wash-out still throws the wall of it, and the carve
       throws a continuous sheet off the buried edge whose size is the edge
       angle and the load, which is exactly what `carveLoad` already knows. */
    if (rider.grounded && rider.state !== 'fall') {
      const side = Math.sign(rider.lateral || 1);
      const carving = rider.carveLoad * Math.abs(Math.sin(rider.edge || 0));
      if (carving > 0.05 && rider.speed > 6) {
        // Thrown up and out from under the buried edge, against the turn
        spray.burst(rider.pos,
          -rider.right.x * side * (0.7 + carving * 1.5),
          -rider.right.z * side * (0.7 + carving * 1.5),
          Math.max(1, Math.round(carving * 5 * Math.min(1, rider.speed / 22))),
          0.22 + carving * 0.7);
      }
      const amount = rider.slide * 0.9;
      if (amount > 0.5) {
        spray.burst(rider.pos,
          rider.right.x * side * 1.6, rider.right.z * side * 1.6,
          Math.min(7, Math.round(amount * 0.9)),
          Math.min(1.3, 0.3 + amount * 0.1));
      }
    } else if (rider.state === 'fall') {
      spray.burst(rider.pos, 0, 0, 3, 0.8);
    }

    wind.set(w.windX, 0, w.windZ);
    snowfall.setIntensity(w.snow);
    snowfall.update(dt, camera, wind);
    spray.update(dt, camera, wind);
    streaks.update(dt, camera, rider.vel, rider.speed);

    audio.ambience(rider.speed, rider.slide, rider.grounded, w.storm, rider.carveLoad);
    retro.setSpeed(rider.speed);
    riderScreen.copy(rider.pos).addScaledVector(rider.normal, 0.9).project(camera);
    retro.setFocus(riderScreen.x * 0.5 + 0.5, riderScreen.y * 0.5 + 0.5);

    /* Where the sun is on the screen, for the rays to march towards. The sky
       owns the answer because it owns the sun — including whether it is
       behind the camera, under the horizon, or smothered by a storm, all of
       which come back as a strength of zero so the whole pass is skipped
       rather than fading. It has to be asked *after* the camera has been
       moved this frame or the rays trail the picture by one. */
    if (sky.project) {
      const s = sky.project(camera);
      retro.setSun(s.x, s.y, s.visible);
    }

    game.liveTrick = liveTrickName();
    hud.update(game, dt);
  }

  retro.updatePerformance(dt, running);
  if (running || !pausedRendered) {
    retro.render(scene, camera);
    pausedRendered = !running;
  }
}

/* ==========================================================================
   Fitting the window
   ========================================================================== */

/* Three separate things can change the size of the picture and only one of
   them fires `resize`: the window itself, the visual viewport (a phone's
   URL bar sliding away, or a pinch-zoom), and the device pixel ratio (a
   laptop moved to an external display, or the browser zoomed). The last one
   has no event at all — the standard trick is a media query that matches
   only the current ratio, which stops matching the moment it changes. */
let resizeFrame = 0;

function resize() {
  resizeFrame = 0;
  pausedRendered = false;
  const viewport = window.visualViewport;
  const w = Math.max(1, Math.round(viewport?.width || window.innerWidth));
  const h = Math.max(1, Math.round(viewport?.height || window.innerHeight));
  const size = retro.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // The HUD stays at display resolution even if the 3D world temporarily
  // steps down under GPU pressure.
  hud.setSize(size.displayWidth, size.displayHeight, 1);
}

function scheduleResize() {
  if (!resizeFrame) resizeFrame = requestAnimationFrame(resize);
}

let ratioQuery = null;

function watchPixelRatio() {
  if (ratioQuery) ratioQuery.removeEventListener('change', onRatioChange);
  ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  ratioQuery.addEventListener('change', onRatioChange);
}

function onRatioChange() {
  scheduleResize();
  watchPixelRatio();
}

window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
document.addEventListener('fullscreenchange', scheduleResize);
document.addEventListener('webkitfullscreenchange', scheduleResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResize);
watchPixelRatio();
resize();

/* A hatch for tuning. Everything in the game is a plain object, so this is
   the whole debugger: read the numbers, or write one and watch what it does
   to the run. */
window.__alpen = {
  game, rider, camera, world, weather, scene, sky, terrain, props, retro,
  // `model` is on here for one reason: the rider's drawn orientation is
  // derived from the physics yaw and has been wrong before — mirrored about
  // the fall line, which is invisible going straight and 180° out in a carve.
  // Without a handle on it that can only be checked by eye, and it is exactly
  // the class of bug an eye slides over.
  wildlife, audio, trail, heli, huts, model,
  config: { RENDER, RIDER, SCORE, PROPS, GRADE },
  debug: () => ({
    mode: game.mode,
    speed: +(rider.speed * 3.6).toFixed(1),
    pos: [rider.pos.x, rider.pos.y, rider.pos.z].map((v) => +v.toFixed(1)),
    state: rider.state,
    grounded: rider.grounded,
    switchStance: rider.switchStance,
    boardForward: +rider.boardForward.toFixed(2),
    upCourse: rider.vel.z > 0.05,
    airTime: +rider.airTime.toFixed(2),
    climbRate: +rider.climbRate.toFixed(2),
    edge: +(rider.edge || 0).toFixed(2),
    carveLoad: +rider.carveLoad.toFixed(2),
    balance: +rider.balance.toFixed(2),
    contactFootprint: +rider.contactFootprint.toFixed(2),
    compression: +rider.compression.toFixed(3),
    slide: +rider.slide.toFixed(2),
    camDistance: +camera.position.distanceTo(rider.pos).toFixed(2),
    fov: +camera.fov.toFixed(1),
    seed: game.seed,
    buffer: [retro.width, retro.height, `${Math.round(retro.scale * 100)}%`],
    display: [retro.displayWidth, retro.displayHeight, `${retro.dpr.toFixed(2)} dpr`],
    speedFx: {
      blur: +retro.blur.toFixed(5),
      aberration: +retro.aberration.toFixed(5),
      vignette: +retro.speedVignette.toFixed(3),
      rays: +retro.rayStrength.toFixed(3),
    },
    solids: props.solids.length,
    ramps: props.ramps.length,
    rails: props.rails.length,
    terrainVerts: terrain.vertexCount,
    weather: {
      phase: weather.state.phase,
      conditions: weather.state.conditions,
      storm: +weather.state.storm.toFixed(2),
      fog: [Math.round(weather.state.fogNear), Math.round(weather.state.fogFar)],
      keyI: +weather.state.keyI.toFixed(2),
      snowGrip: +world.grip.toFixed(2),
      snowDrag: +world.surfaceDrag.toFixed(2),
    },
  }),
};

restart();
game.mode = 'attract';
showMuted(audio.muted);
document.body.classList.add('ready');
requestAnimationFrame(frame);
