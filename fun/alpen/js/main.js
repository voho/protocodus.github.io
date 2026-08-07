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
  createTerrain, heightAt, nearestCenter, corridorHalfAt, beyondLipAt,
  getTerrainMaterialAt, guideAt,
} from './terrain.js';
import { createProps, HARD } from './props.js';
import { createWildlife } from './wildlife.js';
import { createSky } from './sky.js';
import { createWeather } from './weather.js';
import {
  createSnowfall, createSpray, createStreaks, setPointSizeCap,
} from './particles.js';
import { createTrail } from './trail.js';
import { createHelicopter } from './helicopter.js';
import { createHuts } from './huts.js';
import { createMountainLife } from './mountainLife.js';
import {
  Rider, trickName, butterName, butterHalfTurns, CLEAN, SKETCHY, BAIL,
} from './rider.js';
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

/* The loading bar's first stage closes on this line, and it is the earliest
   instant at which closing it would be true: imports are evaluated before any
   statement in a module body, so by the time this runs the engine, this file
   and everything it pulls in have all been fetched, parsed and executed.

   That is also why the read-out itself is an inline script in `index.html`
   rather than a module of its own. A module cannot report its own arrival —
   only its successor can, and on a cold cache the arrival is the longest
   stage of the four.

   Everything downstream is written to survive the object not being there at
   all. This is one page's worth of progress read-out; nothing in the game may
   depend on it, and a host that embeds `main.js` without the markup must
   still get a mountain. */
const boot = window.__alpenBoot || { step() {}, giveUp() {} };
boot.step('engine');

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
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
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
  // Nothing else is going to arrive, so the read-out must stop saying it is
  // waiting for it. The message above is the page now.
  boot.giveUp();
  throw err;
}
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* Shadows, softened.

   The sun is half a
   degree wide, so every shadow on a mountain has a penumbra that widens with
   distance from whatever cast it — a tree's shadow is sharp at the trunk and
   soft at its tip, and hard-edged shadows are the single most reliable tell
   of a real-time renderer. Soft PCF plus a radius on the light gets most of
   that for one extra tap pattern. */
renderer.shadowMap.enabled = true;
// r185 folds the former soft variant into the unified PCF implementation;
// using the current enum preserves the filtered result without a deprecation
// warning on every boot. The light's radius still sets the kernel in sky.js.
renderer.shadowMap.type = THREE.PCFShadowMap;
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
const terrain = createTerrain(THREE, shading, renderer.capabilities.getMaxAnisotropy());
const props = createProps(THREE, shading);
const wildlife = createWildlife(THREE, shading);
const sky = createSky(THREE);
// The particles share the shading block's sun uniforms by reference, so a
// low sun backlights the powder without a single per-frame copy.
const snowfall = createSnowfall(THREE, shading);
const spray = createSpray(THREE, shading);
const streaks = createStreaks(THREE);
// Long snow smears are sized in pixels and the hardware has an opinion.
setPointSizeCap(renderer.getContext()
  .getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE)[1]);
const trail = createTrail(THREE, shading);
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
   and everything standing *on* it casts. */
/* The mountain receives and no longer casts, and this time that is not the
   old mistake being made again.

   It was left out of the depth pass once before, on the reasoning that a
   heightfield lit from above barely shadows itself. That reasoning was wrong
   about *this* heightfield — the knolls' lee sides fall away sharply, the
   cliffs are near vertical and the containment walls stand sixty metres over
   the piste — so it went back in, first whole and then as a near-field proxy
   over the same live buffers. A hundred and thirteen thousand triangles a
   frame, rasterised into a 2048² map, to draw a shadow that had not changed
   since the frame before.

   Because it cannot change quickly. The mountain's shadow of itself is a
   function of the height field and the sun, and the height field is fixed
   while the sun takes three minutes to cross the sky. `terrain.js` now
   marches it — the horizon test at `TERRAIN.shade` — and ships one float per
   vertex, rebuilt on the same amortised pass that already produces the
   heights. Everything that genuinely moves through the light still casts:
   the trees, the huts, the animals, the rider.

   `setSun` below is the join. The sky owns both the direction and how much
   shadow the light is worth at this hour, so the precomputed shadow arrives
   and leaves on exactly the same dusk as the depth map's. */
terrain.mesh.castShadow = false;
terrain.mesh.receiveShadow = true;

function shadowCasting(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    // A few luminous/translucent surfaces carry their own visual falloff and
    // must not become opaque cards in Three's depth-only shadow material.
    if (o.userData.noShadow) {
      o.castShadow = false;
      o.receiveShadow = false;
      return;
    }
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

for (const group of [props.group, wildlife.group, huts.group]) shadowCasting(group);

/* The one thing the rider knows about the mountain: how high it is here.
   Everything else — normals, launches, landings — is derived from this single
   function.

   It used to be `heightAt(x, z) + props.liftAt(x, z)`, and the second term was
   the built kickers. There are none now: everything that throws a rider into
   the air on this mountain is the mountain, so the ground the physics reads
   and the ground the mesh draws are not merely consistent, they are the same
   call. It is also the hottest function in the game — about twenty-five
   samples per physics step at 120 Hz — and it no longer walks a list first. */
const world = {
  height: heightAt,
  surfaceAt: getTerrainMaterialAt,
  /* Running out of momentum on the wall is a real failed commitment. Doing
     the same on a steep-looking patch inside the groomed piste is not: the
     board can wash out and recover downhill there without a hidden wipeout. */
  canStall: (x, z) => (
    Math.abs(x - nearestCenter(x, z)) > corridorHalfAt(z)
  ),
  /* And how far past the quarterpipe lip the ground is, which is where the
     groomed mountain ends and the boundary's own unpisted snow begins. The
     rider spends it as deep-snow drag and, past a point, as a flat refusal to
     climb — see `RIDER.wallSpan`. Everything inside the lip reads negative,
     so the transition stays exactly as rideable as it has always been. */
  beyond: beyondLipAt,
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
      // The caller's large radius describes a tree crown. A boulder's own
      // camera pad is much smaller, otherwise a two-metre rock yanks the boom
      // inward as though it carried four metres of foliage.
      const reach = s.r + (s.cameraPad === undefined ? r : Math.min(r, s.cameraPad));
      if (dz > reach || dz < -reach) continue;
      const dx = s.x - x;
      if (dx * dx + dz * dz < reach * reach) return true;
    }
    return false;
  },
};

// Hoisted out of the frame loop: an array literal there is a fresh
// allocation per frame, and this list never changes.
const foggedPoints = [snowfall.points, spray.points, wildlife.eyes];
const flashWhite = new THREE.Color(1, 1, 1);

const rider = new Rider(THREE, world);
const model = createRiderModel(THREE, shading);
scene.add(model.root, model.shadow, model.headlamp.beam, model.headlamp.pool);
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
const mountainLife = createMountainLife(THREE, scene, shading, spray, audio);
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
  /* The record as it stood when this run dropped in, held still.

     `best` cannot be the thing the read-out shows, because `award` overwrites
     it the instant the score passes it — so on any decent run the BEST line
     was a second copy of the SCORE line counting up beside it. This is the
     target, and it stops being one exactly once. */
  bestAtStart: 0,
  seed: runCode,
  rider,
  weather: weather.state,
  liveTrick: '',
  // consecutive gates threaded; each one is worth more than the last
  gateRun: 0,
};

try {
  game.best = Number(localStorage.getItem(BEST_KEY)) || 0;
} catch { /* private mode; the run just will not be remembered */ }
// Set here as well as in `restart`, because the HUD draws through attract mode
// and `restart` is only reached from `begin` or the R key — so the very first
// frame the page ever draws would otherwise format an undefined.
game.bestAtStart = game.best;

const input = createInput(window, { key: onKey });
if (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
  input.bindTouch(pad);
}

const demo = { t: 0, turn: 0, stall: 0 };
const prev = new THREE.Vector3();
const wind = new THREE.Vector3();
const riderScreen = new THREE.Vector3();
const pushSnow = new THREE.Vector3();
let pausedRendered = false;

/* Render-time interpolation of the fixed step.

   The physics runs at 120 Hz and the picture runs at whatever the panel
   runs at, and nothing used to bridge the two: the camera and the model
   sampled the rider as of the last completed step. On a 144 Hz display a
   frame is shorter than a step, so some frames ran zero steps and some ran
   one — a 0-1-1 cadence the eye reads as a continuous ~24 Hz stutter on
   everything that moves. The fix is the textbook one: keep the position and
   yaw from before the newest step, and draw the rider a fraction
   `lastStep / STEP` of the way between there and now. Physics is untouched;
   only what the lens sees moves between the steps.

   The swap is scoped to the drawing half of the frame: the interpolated
   state is written into the rider for the camera, model, trail and spray to
   read, and the true state is restored before the frame returns — so the
   next physics step, the collision sweeps and every event callback see only
   the integrator's own numbers. */
const stepFrom = new THREE.Vector3();
const truePos = new THREE.Vector3();
const viewPos = new THREE.Vector3();
let stepFromYaw = 0;
let hadStep = false;

function showMuted(value) {
  hud.setMuted(value);
  if (touchMute) touchMute.setAttribute('aria-pressed', String(!!value));
}

/* THE DROP-IN WAITS FOR THE MOUNTAIN, and it is queued rather than ignored.

   Hiding the invitation is not the same as refusing it. Every listener that
   can call this is live from the moment the module evaluates, which is now
   three frames and a whole mountain build before the game can actually show
   anything — so a key press or a tap during the horizon march used to take
   the curtain away and leave the player looking at a canvas that is still
   deliberately hidden, with the progress bar they were watching gone with it.

   Refusing the press outright would be worse than either: somebody who taps a
   title card and gets nothing taps it again, and the one that finally works
   is the one that arrived after the boot happened to finish. So the request is
   remembered and honoured the instant the first frame is on the screen, which
   is what the player asked for and when they can have it.

   `audio.start()` is the exception and stays on this side of the gate. An
   audio context can only be unlocked from inside the gesture that asked for
   it; deferred to a later animation frame the gesture is gone and the run
   comes up silent. Unlocking it early costs nothing — there is nothing
   playing yet. */
let bootReady = false;
let dropInWanted = false;

function begin() {
  if (game.mode === 'playing') return;
  audio.start();
  showMuted(audio.muted);
  if (!bootReady) {
    dropInWanted = true;
    return;
  }
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
  persistBest(true);
}

let lastPassedGate = null;

function restart() {
  /* A restart resumes from the last gate taken — the run is a course now,
     and a course has checkpoints — and always on the guide line, which is
     groomed by construction: no spawn ever lands on a mogul. */
  const start = lastPassedGate ? lastPassedGate.z : rider.pos.z;
  const startX = lastPassedGate ? lastPassedGate.x : guideAt(start);
  rider.reset(start);
  hadStep = false;
  rider.pos.x = startX;
  rider.pos.y = world.height(startX, start);
  game.score = 0;
  game.combo = 1;
  game.gateRun = 0;
  game.liveTrick = '';
  game.bestAtStart = game.best;
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

/* Any key starts via onKey's fallthrough; the curtain overlays the whole
   screen whenever the game is not playing, so a click anywhere lands here.
   Chrome grants touch user activation on the synthesized click, not always on
   pointerdown, which is why the tap path starts from this click handler. */
curtain.addEventListener('click', begin);
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

/* The record's write to disk is debounced. `localStorage.setItem` is
   synchronous main-thread I/O, and a run that is continuously beating the
   record fired it on every gate and landing — landing the stall on the exact
   frame the banner pops. The in-memory record is always current; the disk
   copy follows within a few seconds, and immediately when the run pauses or
   the tab goes to the background. */
let bestDirty = false;
let bestWrittenAt = 0;

function persistBest(force = false) {
  if (!bestDirty) return;
  const now = performance.now();
  if (!force && now - bestWrittenAt < 4000) return;
  bestWrittenAt = now;
  bestDirty = false;
  try { localStorage.setItem(BEST_KEY, String(Math.round(game.best))); } catch { /* ignore */ }
}

window.addEventListener('pagehide', () => persistBest(true));

function award(points, name, tone) {
  game.score += points;
  if (game.score > game.best) {
    game.best = game.score;
    bestDirty = true;
    persistBest();
  }
  if (name) hud.banner(name, points, tone);
}

function scoreLanding(s) {
  if (!s.judged || s.verdict === BAIL) return;
  // The same numbers the banner shows, so a landed 540 is always paid as a
  // 540 — the label and the score used to round in different directions
  const deg = s.halfTurns * 180;
  const flips = s.flipTurns;
  // A grab pays for how far out of shape you had to get to hold it, which is
  // the `reach` beside its name in the config and nothing else.
  const reach = (RIDER.grabs[s.grabKind] || RIDER.grabs[0]).reach;
  let pts = deg * SCORE.perDegree
    + flips * SCORE.perFlip
    + s.grabTime * SCORE.grabPerSecond * reach
    + s.airTime * SCORE.airPerSecond;
  /* And taking the whole thing off its axis is worth more than the two
     rotations were worth separately, because it is one trick and a harder
     one: the horizon leaves the frame and the landing has to be found
     without it. Multiplied, so it scales with whatever was attempted —
     the same reason `switchBonus` is. */
  if (flips >= 1 && deg >= 360) pts *= 1 + SCORE.corkBonus;
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
  // Leaving the ground retires the last jump's verdict, so the air clock for
  // this one has the band to itself — see the note beside it in hud.js.
  hud.clearBanner();
});

rider.on('fall', (cause, into = 0) => {
  game.combo = 1;
  if (game.mode !== 'playing') return;

  const physical = Math.max(0, Math.min(1, into / RIDER.hardImpact));
  const severity = Math.max(cause === 'stall' ? 0.12 : 0.3, physical);
  const horizontal = Math.hypot(rider.vel.x, rider.vel.z);
  const backX = horizontal > 0.1 ? -rider.vel.x / horizontal : -rider.heading.x;
  const backZ = horizontal > 0.1 ? -rider.vel.z / horizontal : -rider.heading.z;

  audio.crash(into, cause);
  chase.kick(1.0 + severity * 1.35);
  retro.crash(severity);

  // The first contact throws a broad powder curtain back into the chase
  // camera. Both its mass and its reach come from the impact that launched
  // the tumble, instead of every fall receiving the old fixed forty dots.
  const plume = 0.72 + severity * 1.08;
  const push = 1.0 + severity * 2.3;
  spray.burst(rider.pos, backX * push, backZ * push,
    Math.round(34 + severity * 58), plume);
  hud.banner('WIPEOUT', 0, 'bad');
});

rider.on('impact', (v) => {
  if (rider.state === 'fall') {
    const severity = Math.max(0, Math.min(1, v / (RIDER.hardImpact * 0.7)));
    audio.bodyImpact(v);
    if (v > 1.5) {
      const horizontal = Math.hypot(rider.vel.x, rider.vel.z);
      const backX = horizontal > 0.1 ? -rider.vel.x / horizontal : -rider.heading.x;
      const backZ = horizontal > 0.1 ? -rider.vel.z / horizontal : -rider.heading.z;
      const puff = 0.48 + severity * 0.88;
      spray.burst(rider.pos, backX * (0.5 + severity), backZ * (0.5 + severity),
        Math.round(8 + severity * 26), puff);
    }
    // A genuinely heavy body contact can put a second dusting on the lens;
    // small chatter is left entirely to sound and particles.
    if (v > RIDER.softImpact) retro.crash(0.12 + severity * 0.28);
  }
  if (v > 6) chase.kick(Math.min(1.2, v * 0.05));
});

rider.on('push', (impulse) => {
  if (game.mode !== 'playing') return;
  audio.push(impulse / RIDER.pushImpulse);
  pushSnow.copy(rider.pos).addScaledVector(rider.right, 0.32);
  spray.burst(pushSnow,
    rider.right.x * 0.85 - rider.heading.x * 0.45,
    rider.right.z * 0.85 - rider.heading.z * 0.45,
    8, 0.48);
});

/* A butter, judged once when the board settles back onto both ends.

   The two floors are what stop this paying out for a shift of weight. Under
   a hundred and fifty degrees the press carried a wobble rather than a
   rotation; under a third of a second the board never really came up. Neither
   is a failure and neither says anything — a press that did not become a
   butter is simply a press, which is a perfectly good thing to be doing. */
rider.on('butter', (spin, time) => {
  if (game.mode !== 'playing') return;
  if (time < RIDER.pressMinTime || spin < RIDER.pressMinSpin) return;
  // The half turns that actually came round — see `butterHalfTurns`, which
  // the name below reads too, so the callout and the payout are one figure.
  const halves = butterHalfTurns(spin);
  const pts = halves * 0.5 * SCORE.butterPerTurn * game.combo;
  award(pts, butterName(spin), '');
  game.combo = Math.min(SCORE.comboMax, game.combo + SCORE.comboStep);
  audio.combo(game.combo);
});

/* A pump pays in speed, so it is deliberately not paid in points as well.

   What it gets instead is the only feedback it needs and the two the sport
   gives you: the board is driven into the snow, so it throws some, and the
   number in the corner goes up. A banner here would be the HUD announcing a
   thing the player can already feel — and there is a standing rule in this
   file about banners that fire constantly ceasing to mean anything. */
rider.on('pump', (drive) => {
  if (game.mode !== 'playing') return;
  spray.burst(rider.pos, -rider.heading.x * 0.5, -rider.heading.z * 0.5,
    Math.round(3 + drive * 2), 0.3 + drive * 0.12);
  chase.kick(Math.min(0.5, drive * 0.09));
});

/* A near miss is now only ever a bear.

   Threading a tree used to pay out as CLOSE ONE, and so did brushing past a
   rabbit. It fired constantly — the piste is lined with trees and the banner
   is centred, so most of what the read-out ever said was CLOSE ONE, which
   made the one banner that should mean something mean nothing. A bear is
   rare, deliberate and genuinely dangerous, and it is the only near miss
   worth telling the player about. */
function nearMiss(kind) {
  if (kind !== 'bear') return;
  award(SCORE.nearMiss * SCORE.bearDodge * game.combo, 'BEAR DODGED', 'near');
  audio.whoosh();
}

/* Threading a gate.

   The slalom poles have stood on this mountain as scenery since the start —
   drawn, and then forgotten by everything downstream, so the one thing on the
   run that describes a *line* was the one thing the game could not tell you
   had been ridden. This is that, and it is deliberately the cheapest kind of
   detection: a gate is a point and a half-width, the rider crossed it if the
   step straddled its z, and they took it if the interpolated x at that moment
   was inside the poles.

   Interpolating matters. At forty metres a second a physics step covers a
   third of a metre and a rendered frame covers most of a board length, so
   testing the rider's position at either end of the step against a gate they
   passed through the middle of is how a gate you clearly took pays nothing.

   Consecutive gates build a run: each one taken without missing one is worth
   more than the last, and missing one puts you back to the start of the
   ladder. That is what makes a line of them read as a course rather than as a
   row of scoring gates. */
function checkGates() {
  if (game.mode !== 'playing') return;
  const gates = props.gates;
  const zFrom = prev.z;
  const zTo = rider.pos.z;
  if (zTo >= zFrom) return;           // only ever going down the hill
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    if (g.taken || g.z > zFrom || g.z <= zTo) continue;
    g.taken = true;
    const t = (zFrom - g.z) / (zFrom - zTo || 1);
    const x = prev.x + (rider.pos.x - prev.x) * t;
    if (Math.abs(x - g.x) > g.half) {
      game.gateRun = 0;
      continue;
    }
    game.gateRun = Math.min(SCORE.gateRunMax, game.gateRun + 1);
    const pts = SCORE.gate * game.gateRun * game.combo;
    award(pts, game.gateRun > 1 ? `GATE ×${game.gateRun}` : 'GATE', 'near');
    audio.whoosh();
    lastPassedGate = { x: g.x, z: g.z - 3.0 };
    if (spray) {
      spray.burst({ x: g.x, y: world.height(g.x, g.z) + 0.4, z: g.z }, 0, -6, 14, 1.2);
    }
  }
}

/* ==========================================================================
   Collisions
   ========================================================================== */

const sweepHit = { t: 0, nx: 0, nz: 1, distance: 0, approach: 0 };

/* Sweep a moving point against the obstacle circle already expanded by the
   rider radius. Entry normal and travel direction together distinguish a
   tangent brush from a square hit without depending on how far one 120 Hz
   substep happened to penetrate. Reusing one record keeps this in the
   allocation-free physics path. */
function sweepCircle(ax, az, bx, bz, cx, cz, radius, out) {
  const dx = bx - ax;
  const dz = bz - az;
  const mx = ax - cx;
  const mz = az - cz;
  const a = dx * dx + dz * dz;
  const c = mx * mx + mz * mz - radius * radius;
  let t = 0;

  if (c > 0) {
    if (a < 1e-10) return false;
    const b = mx * dx + mz * dz;
    const disc = b * b - a * c;
    if (disc < 0) return false;
    t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > 1) return false;
  }

  const closestT = a > 1e-10
    ? Math.max(0, Math.min(1, -(mx * dx + mz * dz) / a))
    : 0;
  const closeX = mx + dx * closestT;
  const closeZ = mz + dz * closestT;
  out.distance = Math.hypot(closeX, closeZ);
  out.t = t;

  let nx = mx + dx * t;
  let nz = mz + dz * t;
  let n = Math.hypot(nx, nz);
  if (n < 1e-6) {
    nx = -dx;
    nz = -dz;
    n = Math.hypot(nx, nz);
  }
  if (n < 1e-6) {
    out.nx = 0;
    out.nz = 1;
  } else {
    out.nx = nx / n;
    out.nz = nz / n;
  }
  out.approach = a > 1e-10
    ? Math.max(0, Math.min(1, -(dx * out.nx + dz * out.nz) / Math.sqrt(a)))
    : Math.max(0, Math.min(1, 1 - out.distance / radius));
  return true;
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

    const reach = s.r + RIDER.radius;

    // Threading a tree no longer pays out, so a miss is simply a miss
    if (!sweepCircle(
      prev.x, prev.z, rider.pos.x, rider.pos.z,
      s.x, s.z, reach, sweepHit,
    )) continue;
    // Anything with a real top can be cleared in the air. Trees carry top: 99
    // because you do not jump a tree. Height is judged at horizontal impact,
    // not at the end of the step, so a landing cannot clear or strike solely
    // because the two axes were sampled at different times.
    const impactY = prev.y + (rider.pos.y - prev.y) * sweepHit.t;
    if (impactY > s.top + 0.15) continue;
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
    const closeness = sweepHit.approach;
    const outcome = rider.strike(sweepHit.nx, sweepHit.nz, closeness);
    if (s.type === 'boulder') {
      /* A boulder is a volume, not a trigger. Resolve to the swept entry point
         and remove only velocity still aimed into the stone; the tangential
         component remains, so a graze slides past while a direct fall stops. */
      rider.pos.x = s.x + sweepHit.nx * (reach + 0.03);
      rider.pos.z = s.z + sweepHit.nz * (reach + 0.03);
      const inward = rider.vel.x * sweepHit.nx + rider.vel.z * sweepHit.nz;
      if (inward < 0) {
        const restitution = outcome === 'fall' ? 1.12 : 1.02;
        rider.vel.x -= inward * restitution * sweepHit.nx;
        rider.vel.z -= inward * restitution * sweepHit.nz;
      }
    }
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
  // The demo rider knows the course: it carves about the guide line, which
  // keeps the attract loop on the corduroy the camera is there to sell.
  const target = guideAt(rider.pos.z - 26) + Math.sin(demo.t * 0.31) * 4;
  const err = target - rider.pos.x;
  const heading = Math.atan2(rider.vel.x, -rider.vel.z);
  const want = Math.atan2(err, 30) - heading;
  demo.turn += (Math.max(-1, Math.min(1, want * 2.4)) - demo.turn) * Math.min(1, dt * 5);
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
  /* On the snow the live line is the press, once it has carried enough to
     have a name — which is the only feedback a butter gets while it is
     happening, and it is what tells a rider they have made the half turn
     before they let go of it. */
  if (rider.grounded) {
    if (rider.press > 0.35 && Math.abs(rider.pressSpin) >= RIDER.pressMinSpin) {
      return butterName(Math.abs(rider.pressSpin));
    }
    return '';
  }
  return trickName({
    spin: rider.spinAccum,
    flips: rider.flipAccum,
    // Floored rather than rounded: in the air you have only completed the
    // rotation you have actually been through. Rounding is what the landing
    // does, once it has decided the rotation counts.
    halfTurns: Math.floor(Math.abs(rider.spinAccum) / Math.PI),
    flipTurns: Math.floor(Math.abs(rider.flipAccum) / TAU),
    grabTime: rider.grabTime,
    grabKind: rider.grabKind,
    airTime: rider.airTime,
    switchStance: false,
  }, CLEAN) || '';
}

/* The per-frame callbacks, built once. Arrow literals in the loop body are
   a fresh closure allocation every frame — individually nothing, together
   the steady GC churn behind the occasional minor-collection hitch. */
const onWildlifeNear = (x, z, kind) => {
  if (game.mode === 'playing') nearMiss(kind);
};
const onBearContact = () => {
  if (game.mode === 'playing' && rider.grace <= 0) rider.fall('bear', rider.speed);
};
const onCocoa = () => {
  if (game.mode !== 'playing') return;
  award(SCORE.cocoa * game.combo, 'COCOA STOP', 'near');
  game.combo = Math.min(SCORE.comboMax, game.combo + SCORE.comboStep);
  audio.combo(game.combo);
};

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
    /* The demo rider is a salesman, not a survivor: if it stalls on the
       shoulder or loses the course entirely, it is quietly stood back on
       the line a couple of metres further down and the loop goes on. A
       player never sees a spawn; they see a rider who always knows the way. */
    if (game.mode === 'attract') {
      demo.stall = rider.speed < 2.5 ? demo.stall + dt : 0;
      const offLine = Math.abs(rider.pos.x - guideAt(rider.pos.z));
      if (demo.stall > 2.5 || offLine > 34) {
        const z = rider.pos.z - 4;
        rider.reset(z);
        rider.pos.x = guideAt(z);
        rider.pos.y = world.height(rider.pos.x, z);
        hadStep = false;
        demo.stall = 0;
      }
    }
    const control = game.mode === 'attract' ? demoInput(dt) : input.state;

    // Fixed-step physics, so a jump is the same size on every machine
    let steps = 0;
    lastStep += dt;
    while (lastStep >= STEP && steps < 8) {
      prev.copy(rider.pos);
      // Where the newest step began, kept for the render interpolation below.
      stepFrom.copy(rider.pos);
      stepFromYaw = rider.yaw;
      hadStep = true;
      rider.step(STEP, control);
      // Obstacle sweeps belong to the same clock as motion. Running this once
      // per rendered frame made a fast tree impact subtly display-rate
      // dependent even though the rider itself was fixed-step.
      collide();
      checkGates();
      lastStep -= STEP;
      steps += 1;
    }
    if (steps >= 8) lastStep = 0;

    /* The environment is rendered, so its positional half uses the same
       fixed-step interpolation as the lens and rider model. Keep this as a
       separate immutable sample: simulation, collisions and streaming below
       still consume the integrator's true position. */
    const stepAlpha = Math.min(1, lastStep / STEP);
    if (hadStep && game.mode !== 'paused') {
      viewPos.copy(stepFrom).lerp(rider.pos, stepAlpha);
    } else {
      viewPos.copy(rider.pos);
    }

    /* Resolve the whole environment before any system consumes it. Terrain
       used to start its amortised work from the previous frame's sun and the
       forest received the previous wind; that one-frame lag was normally
       small, but it became an obvious discontinuity whenever a build happened
       to begin near dawn, dusk or a storm front. */
    const w = weather.update(dt);
    retro.setGrade(w, dt);
    // Falling snow is fresh snow: progressively softer, slower and easier to
    // wash out on. The endpoints stay arcade-readable rather than punitive.
    world.grip = 1 - w.storm * (1 - RIDER.stormGrip);
    world.surfaceDrag = 1 + w.storm * (RIDER.stormFriction - 1);
    scene.fog.color.copy(w.haze);
    // Lightning whitens the dome, so everything dissolving into the dome
    // whitens with it — a strike that leaves the fog its old colour reads
    // as a bug, not weather.
    if (w.flash > 0.003) scene.fog.color.lerp(flashWhite, w.flash * 0.8);
    scene.fog.near = w.fogNear;
    scene.fog.far = w.fogFar;
    // Everything with a hand-written fog term needs telling where the
    // curtain is this frame; three only does it for its own materials
    for (let i = 0; i < foggedPoints.length; i++) {
      const u = foggedPoints[i].material.uniforms;
      u.uFog.value.copy(scene.fog.color);
      u.uNear.value = w.fogNear;
      u.uFar.value = w.fogFar;
    }
    sky.update(viewPos, w, dt);
    mountainLife.update(dt, rider);
    // The terrain's horizon atlas evaluates this direction immediately; a
    // re-anchor only precalculates geometry and the direction-independent
    // horizon facts for the next patch of mountain.
    terrain.setSun(sky.sunDir.x, sky.sunDir.y, sky.sunDir.z, sky.shadowLevel);
    terrain.update(rider.pos.x, rider.pos.z, dt);
    props.update(rider.pos.z);
    // The forest answers this exact frame's weather: crowns lash in a storm
    // wind, flags ripple, and a calm day barely stirs.
    props.setAir(dt, w.windX, w.windZ);

    // A blip per half-rotation, so a 720 sounds like a 720
    if (rider.grounded) {
      tickStep = 0;
    } else {
      const step = Math.floor(Math.abs(rider.spinAccum) / Math.PI)
        + Math.floor(Math.abs(rider.flipAccum) / Math.PI);
      if (step > tickStep) audio.trick(step);
      tickStep = step;
    }

    wildlife.update(dt, rider, onWildlifeNear, onBearContact);

    heli.update(dt, rider, wildlife, w);
    if (game.mode === 'playing' && heli.claimLight(rider)) {
      award(SCORE.searchlight * game.combo, 'IN THE SPOTLIGHT', 'near');
    }

    huts.update(dt, rider, w, onCocoa);

    /* The gates light the snow they stand on, and the ground's own shader is
       what draws it — so this hands the terrain the nearest few and nothing
       else. It runs here, with the rest of the world's per-frame state,
       because the prop field's gate list is only rebuilt at band boundaries
       and the *choice* of which four are lit has to follow the rider. */
    terrain.setGates(props.gates, rider.pos.z);

    /* Everything below this line is drawing, so it reads the interpolated
       rider. Everything above — collisions, wildlife, scoring, the huts —
       already read the integrator's own state, and the true position is
       restored before the frame returns. See the note beside `stepFrom`. */
    let viewSwapped = false;
    let trueYaw = 0;
    if (hadStep && game.mode !== 'paused') {
      truePos.copy(rider.pos);
      trueYaw = rider.yaw;
      rider.pos.copy(viewPos);
      rider.yaw = stepFromYaw + (trueYaw - stepFromYaw) * stepAlpha;
      viewSwapped = true;
    }

    chase.update(rider, dt, world);
    // One write, and every material in the world agrees about the sky it is
    // dissolving into. It follows both the sky and the chase camera so the
    // view-space sun cannot lag a carve by one rendered frame.
    shading.update(w, camera, dt, world.height(rider.pos.x, rider.pos.z));
    model.update(rider, dt, w, camera);
    // The animals' eyes answer the lamp: retroreflection needs to know where
    // the beam is, and only the model knows that after its pose is written.
    wildlife.setLamp(model.headlamp.level, model.headlamp.origin, model.headlamp.direction);
    /* The track owns continuous board spray because it already commits the
       contact path at fixed spatial intervals. One interpolated sample now
       drives both the cut in the snow and the sheet thrown from that cut, so
       density is independent of refresh rate and the two effects cannot
       disagree about the buried edge. Fall scraping remains an impact plume,
       as do landing, pushing and collision bursts above. */
    trail.update(rider, dt,
      rider.state === 'ride' ? spray.edgeSample : null);

    if (rider.state === 'fall' && !rider.airborne && rider.speed > 1) {
      // Snow only comes off a fallen body while it is actually touching the
      // hill. Airborne tumbles are wind and silence; the scrape resumes with
      // a low, speed-weighted wake when the body lands again.
      const horizontal = Math.hypot(rider.vel.x, rider.vel.z);
      const backX = horizontal > 0.1 ? -rider.vel.x / horizontal : -rider.heading.x;
      const backZ = horizontal > 0.1 ? -rider.vel.z / horizontal : -rider.heading.z;
      const drag = Math.min(1, rider.speed / 24);
      spray.burst(rider.pos, backX * (0.5 + drag), backZ * (0.5 + drag),
        Math.max(1, Math.round(1 + drag * 4)), 0.38 + drag * 0.62);
    }

    wind.set(w.windX, 0, w.windZ);
    snowfall.setIntensity(w.snow);
    snowfall.update(dt, camera, wind);
    spray.update(dt, camera, wind);
    streaks.update(dt, camera, rider.vel, rider.speed, wind);

    const tumbleSlide = rider.state === 'fall' && !rider.airborne ? rider.speed : 0;
    const surfMat = getTerrainMaterialAt(rider.pos.x, rider.pos.z);
    audio.ambience(rider.speed, rider.slide, rider.grounded, w.storm,
      rider.carveLoad, tumbleSlide, surfMat);
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
      // The glow stop rides along so the ray march inherits the sun's own
      // colour — white at noon, amber through the golden hour.
      retro.setSun(s.x, s.y, s.visible, shading.uniforms.uSkyGlow.value);
    }

    game.liveTrick = liveTrickName();
    hud.update(game, dt);

    // The integrator's numbers come back before anything else can run — the
    // next physics step must never see the lens's in-between state.
    if (viewSwapped) {
      rider.pos.copy(truePos);
      rider.yaw = trueYaw;
    }
  }

  retro.updateEffects(dt, running);
  retro.updatePerformance(dt, running);
  if (running || !pausedRendered || retro.animating) {
    retro.render(scene, camera);
    pausedRendered = !running && !retro.animating;
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

/* Where the phone's own hardware is standing in front of the picture.

   `index.html` opts into `viewport-fit=cover`, which is what lets the mountain
   run under the notch and into the rounded corners — and which also put the
   score behind the camera housing, because the read-out measures its margins
   from the raw edge of the buffer. CSS knows the answer and JavaScript cannot
   ask for it directly, so this is the standard trick: an element whose padding
   is the four `env()` values, measured rather than read.

   It is a zero-size, `aria-hidden` div that never paints. `.hud` is already
   the fixed, full-window layer, so it inherits the right containing block. */
const probe = document.createElement('div');
probe.setAttribute('aria-hidden', 'true');
probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;'
  + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) '
  + 'env(safe-area-inset-bottom) env(safe-area-inset-left)';
hudRoot.appendChild(probe);

function safeInsets(ratio) {
  const s = getComputedStyle(probe);
  const px = (v) => Math.max(0, Math.round(parseFloat(v) * ratio)) || 0;
  return {
    top: px(s.paddingTop),
    right: px(s.paddingRight),
    bottom: px(s.paddingBottom),
    left: px(s.paddingLeft),
  };
}

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
  // steps down under GPU pressure. The insets are in CSS pixels and the
  // read-out's buffer is in device ones, so they are scaled on the way in.
  hud.setSize(size.displayWidth, size.displayHeight, 1, 0, 0,
    safeInsets(size.displayHeight / h));
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
  game, rider, camera, chase, world, weather, scene, sky, terrain, props, retro, renderer,
  // `model` is on here for one reason: the rider's drawn orientation is
  // derived from the physics yaw and has been wrong before — mirrored about
  // the fall line, which is invisible going straight and 180° out in a carve.
  // Without a handle on it that can only be checked by eye, and it is exactly
  // the class of bug an eye slides over.
  wildlife, audio, trail, heli, huts, model,
  /* And the handles needed to *drive* the game from here rather than only
     read it. `input` is the live control state, so a carve can be held from
     the console; the three particle systems are the parts of the picture
     whose output cannot be judged from a still frame taken at whatever moment
     the loop happened to be in. Between them the plume a committed turn
     throws can be produced deliberately and then looked at. */
  input, spray, snowfall, streaks,
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
    bend: +rider.bend.toFixed(2),
    carveLoad: +rider.carveLoad.toFixed(2),
    balance: +rider.balance.toFixed(2),
    contactFootprint: +rider.contactFootprint.toFixed(2),
    compression: +rider.compression.toFixed(3),
    slide: +rider.slide.toFixed(2),
    brake: +rider.brake.toFixed(2),
    pushing: rider.pushing,
    pushPhase: +rider.pushPhase.toFixed(3),
    pushStroke: rider.pushStroke,
    camDistance: +camera.position.distanceTo(rider.pos).toFixed(2),
    fov: +camera.fov.toFixed(1),
    seed: game.seed,
    buffer: [retro.width, retro.height, `${Math.round(retro.scale * 100)}%`],
    msaa: retro.samples,
    display: [retro.displayWidth, retro.displayHeight, `${retro.dpr.toFixed(2)} dpr`],
    speedFx: {
      blur: +retro.blur.toFixed(5),
      aberration: +retro.aberration.toFixed(5),
      vignette: +retro.speedVignette.toFixed(3),
      rays: +retro.rayStrength.toFixed(3),
      fall: +retro.fallEffect.toFixed(3),
    },
    solids: props.solids.length,
    biomes: props.debugBiomes(),
    terrainVerts: terrain.vertexCount,
    helicopter: heli.debug(),
    weather: {
      tod: +weather.state.tod.toFixed(3),
      phase: weather.state.phase,
      night: +weather.state.night.toFixed(3),
      headlamp: +model.headlamp.level.toFixed(3),
      conditions: weather.state.conditions,
      storm: +weather.state.storm.toFixed(2),
      fog: [Math.round(weather.state.fogNear), Math.round(weather.state.fogFar)],
      keyI: +weather.state.keyI.toFixed(2),
      snowGrip: +world.grip.toFixed(2),
      snowDrag: +world.surfaceDrag.toFixed(2),
    },
  }),
};

/* THE REST OF THE BOOT, broken across three paints instead of run as one.

   Everything below this line used to be a single synchronous block at the end
   of the module, and it is by some distance the longest thing the page does:
   the mountain's opening horizon cache is a quarter of a million probes
   marched on the main thread, and compiling the world's shaders is the sort
   of work a driver can take most of a second over. Measured on a slow machine
   it was two and a half seconds in one task — two and a half seconds in which
   the browser cannot paint, cannot respond, and cannot show a loading bar that
   would otherwise have been the whole point of having one.

   None of that work got faster. What changed is that it now happens in three
   pieces with a paint between them, so the read-out can say which piece is
   running and the title card stays alive while it does. Nothing is deferred
   past the first frame — the mountain is still complete and the shaders are
   still warm before a single pixel of it is shown — and the order is exactly
   the order it was in.

   Two frames rather than one, because one only guarantees the callback runs
   *before* the next paint. The second is what puts the work after it. */
function afterPaint(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/* The plates arrive on the network's own clock and nothing waits for them, so
   this stage closes whenever it closes — usually during the horizon march.

   And it closes on a timer as well, because "whenever it closes" is not the
   same as "eventually". A request that is stalled rather than failed fires
   neither load nor error, and an image element will sit on one for as long as
   the network lets it — which would leave the bar stuck at ninety per cent and
   the invitation hidden over a mountain that is complete, drawn and playable.
   Nothing in the game waits for these plates: the terrain keeps its procedural
   fallback and takes the real one whenever it lands. So after a few seconds
   the honest thing for the read-out to say is that the wait is over, and the
   plate is welcome to arrive afterwards. */
const SNOW_PATIENCE = 6000;
Promise.race([
  terrain.surfacesReady,
  new Promise((settle) => setTimeout(settle, SNOW_PATIENCE)),
]).then(() => boot.step('snow'));

afterPaint(() => {
  /* The sun, before the ground it has to light. The world-fixed horizon cache
     itself is direction-independent, but its very first shader evaluation
     still needs the correct bearing and fade. Zero-length ticks advance no
     clock. */
  const w0 = weather.update(0);
  retro.setGrade(w0, 0);
  sky.update(rider.pos, w0, 0);
  terrain.setSun(sky.sunDir.x, sky.sunDir.y, sky.sunDir.z, sky.shadowLevel);

  restart();
  game.mode = 'attract';
  showMuted(audio.muted);
  boot.step('mountain');

  afterPaint(() => {
    /* Compile every currently resident world material, allocate the shadow
       map, upload the complete opening horizon cache and warm the post stack
       while the canvas is still covered. First use during a landing is the
       wrong time for a driver to discover a shader or a 3.3 MiB texture. */
    renderer.compile(scene, camera);
    retro.render(scene, camera);
    requestAnimationFrame((now) => {
      frame(now);
      document.body.classList.add('ready');
      // Last, and after the first real frame rather than before it, because
      // that frame is where a driver finishes linking what `compile` only
      // asked for. "Ready" should mean the mountain is on the screen.
      boot.step('shaders');
      /* …and now anybody who asked to drop in while that was happening gets
         what they asked for. See `bootReady`: the press was kept rather than
         refused, so the title card answers the first tap and not the third. */
      bootReady = true;
      if (dropInWanted) {
        dropInWanted = false;
        begin();
      }
    });
  });
});
