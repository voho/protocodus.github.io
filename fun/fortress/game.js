import { AMMO, DIFFICULTIES, WORLD, FortressSimulation } from './simulation.js';
import { createRenderer } from './renderer.js';
import { createView } from './view.js';
import { createAudio } from './audio.js';
import { createMusic } from './music.js';
import { prepareAssets } from './assets.js';
import { whenSpritesReady } from './sprites.js';

const $ = (id) => document.getElementById(id);
const descriptions = [
  'A light, inexpensive stone for taking out a support.',
  'A heavy stone for shoving piers and toppling towers.',
  'A compact blast for breaking clustered supports.',
  'A wide blast that can excavate the ground beneath a tower.',
  'A magical burst that sets timber and exposed powder stores alight.',
  'A slow, heavy charge. Click the field to detonate it. An orc can set it off in flight.',
  'Stays armed after landing. Activate it to pull nearby pieces and supports inward.',
];
const remoteAmmo = new Set(AMMO.filter((ammo) => ammo.remote).map((ammo) => ammo.id));
const rollSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
const validSize = (value) => DIFFICULTIES.some(({ id }) => id === value);
function readFortress() {
  const [id, ...parts] = location.hash.slice(1).split('/');
  const size = validSize(id) ? id : null;
  const parseSeed = (word) => {
    const n = /^[0-9a-z]{1,7}$/.test(word ?? '') ? parseInt(word, 36) : 0;
    return n > 0 && n <= 0xffffffff ? n : 0;
  };
  if (size && parts.length === 1 && parseSeed(parts[0])) return { size, seed: parseSeed(parts[0]) };
  // Earlier prototype links carried five seeds. Use the seed of the selected fort.
  if (/^[1-5]$/.test(id) && parts.length === 5 && parseSeed(parts[+id - 1])) {
    return { size: ['small', 'medium', 'medium', 'large', 'large'][+id - 1], seed: parseSeed(parts[+id - 1]) };
  }
  const preferred = stored('size', 'small');
  return { size: validSize(preferred) ? preferred : 'small', seed: rollSeed() };
}
const initial = readFortress();
let sim = new FortressSimulation(initial.size, initial.seed);
const camera = createView($('battlefield'), $('panorama'), $('scenery'), $('game-dock'));
const renderer = createRenderer($('battlefield'));
const audio = createAudio();
const music = createMusic($('soundtrack'));
let landscapes;
let ready = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const overlay = $('overlay');
const angles = $('angle');
const powers = $('power');
const settings = { ammo: AMMO[0].id, angle: +angles.value, power: +powers.value };
const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="#icon-' + name + '"/></svg>';

function stored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem('fortress.v1.' + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem('fortress.v1.' + key, JSON.stringify(value));
  } catch {
    /* Private browsing can block storage. */
  }
}

const scoreKey = () => sim.difficulty + '.' + sim.seed.toString(36);
// A seed from the earlier tower-chain generator represented a different battlefield.
const scoreTable = 'keep-siege-bests';
const savedBests = stored(scoreTable, {});
const bests = Object.fromEntries(
  Object.entries(savedBests && typeof savedBests === 'object' ? savedBests : {})
    .filter(
      ([key, value]) => /^(small|medium|large)\.[0-9a-z]{1,7}$/.test(key) && Number.isInteger(value) && value > 0,
    )
    .slice(-200),
);
let soundOn = stored('sound', true) === true;
let clock = 0;
let previousFrame = null;
let victoryRecorded = false;
let lastStats = '';
let windBand = 0;
let lastAnnouncedOrcs = sim.stats.orcsRemaining;
let inputMode = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
const ammoButtons = [];
const czechAmmoKeys = ['+', 'ě', 'š', 'č', 'ř', 'ž', 'ý'];

function selectAmmo(index) {
  settings.ammo = AMMO[index].id;
  ammoButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(index === i)));
  if (ready) syncHud();
}
for (const [i, ammo] of AMMO.entries()) {
  const button = document.createElement('button');
  button.className = 'ammo';
  button.title = descriptions[i] + ' Reloads in ' + ammo.reload + ' seconds.';
  button.setAttribute('aria-label', ammo.name + ', ' + ammo.cost + ' gold');
  button.innerHTML =
    '<span class="shortcut" aria-hidden="true">' +
    (i + 1) +
    '</span>' +
    '<img class="ammo-art" src="./assets/ammo-' +
    ammo.id +
    '.webp" alt="">' +
    '<span class="ammo-name">' +
    ammo.name +
    '</span><span class="cost"><i class="coin" aria-hidden="true"></i>' +
    ammo.cost +
    '</span>';
  button.addEventListener('click', (event) => {
    selectAmmo(i);
    if (event.detail) $('battlefield').focus({ preventScroll: true });
  });
  $('ammunition').appendChild(button);
  ammoButtons.push(button);
}
selectAmmo(0);

function updateSliders() {
  for (const input of [angles, powers]) {
    const suffix = input === angles ? '°' : '%';
    settings[input.id] = +input.value;
    $(input.id + '-value').value = input.value + suffix;
    input.setAttribute('aria-valuetext', input.value + (input === angles ? ' degrees' : ' percent'));
    input.style.setProperty('--value', (100 * (input.value - input.min)) / (input.max - input.min) + '%');
  }
}
angles.addEventListener('input', updateSliders);
powers.addEventListener('input', updateSliders);
updateSliders();

function updateSound() {
  audio.setEnabled(soundOn);
  music.enable(soundOn);
  const button = $('sound-button');
  button.innerHTML = icon(soundOn ? 'sound' : 'mute');
  button.title = soundOn ? 'Mute sound' : 'Enable sound';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(soundOn));
}
updateSound();
$('sound-button').addEventListener('click', () => {
  soundOn = !soundOn;
  updateSound();
  if (soundOn) {
    audio.unlock();
    music.activate();
  }
  store('sound', soundOn);
});

function track(event, extra) {
  window.protocodusAnalytics?.track(event, {
    game_name: 'fortress',
    game_mode: 'skirmish',
    difficulty: sim.difficulty,
    ...extra,
  });
}
function syncHud() {
  const s = sim.stats;
  const selectedRemote = remoteAmmo.has(settings.ammo);
  const remote = sim.armedBomb(selectedRemote ? settings.ammo : undefined);
  const trigger = remote && selectedRemote;
  const key = [s.orcsRemaining, s.destruction, s.spent, s.ready, s.cleared, remote?.material, !!trigger, sim.side, inputMode].join('/');
  if (key === lastStats) return;
  lastStats = key;
  $('orcs').textContent = s.orcsRemaining + ' / ' + s.orcsTotal;
  $('destruction').textContent = s.destruction + '%';
  $('spent').textContent = String(s.spent);
  const state = $('state');
  const touch = inputMode === 'touch', keyboard = inputMode === 'keyboard';
  $('aim-hint').dataset.mode = inputMode;
  const action = !s.ready ? 'Reloading' : keyboard ? 'Space to fire' : touch ? 'Double-tap to fire' : 'Double-click to fire';
  const verb = remote?.implosionRadius ? 'implode' : 'detonate';
  const detonate = (touch ? 'Tap to ' : 'Click to ') + verb;
  $('aim-hint').textContent = keyboard
    ? (sim.side === 'left' ? 'Left crew' : 'Right crew') + ' · ← → Power · ↑ ↓ Angle · ' + (trigger ? 'Space to ' + verb : action)
    : remote ? detonate : action;
  state.toggleAttribute('data-busy', !s.ready);
  state.toggleAttribute('data-won', s.orcsRemaining === 0);
  state.querySelector('span').textContent =
    remote ? (keyboard && trigger ? 'Space to ' : touch ? 'Tap field to ' : 'Click field to ') + verb
      : s.ready ? 'Ready to fire' : 'Reloading';
  const fireButton = $('fire-button');
  fireButton.disabled = !s.ready && !trigger;
  fireButton.querySelector('span').textContent = trigger ? (remote.implosionRadius ? 'Activate implosion' : 'Detonate bomb')
    : s.ready ? 'Fire catapult' : 'Reloading';
  if (s.orcsRemaining !== lastAnnouncedOrcs) {
    $('announcement').textContent = s.orcsRemaining + ' orcs left. ' + s.destruction + '% of the fort destroyed.';
    lastAnnouncedOrcs = s.orcsRemaining;
  }
}

function fire() {
  if (!ready || overlay.open) return;
  if (!sim.fire(settings.ammo, settings.angle, settings.power)) return;
  audio.unlock();
  if (soundOn) music.activate();
  if (sim.shots === 1) track('game_start', { action: 'fire' });
  syncHud();
}
function triggerBomb() {
  if (!ready || overlay.open || !sim.detonateRemote(remoteAmmo.has(settings.ammo) ? settings.ammo : undefined)) return false;
  syncHud();
  return true;
}
function primaryFire() {
  if (remoteAmmo.has(settings.ammo) && triggerBomb()) return;
  fire();
}
$('fire-button').addEventListener('click', primaryFire);

// Measure from the sling in world coordinates so zooming or panning preserves the shot.
const fullPowerDistance = 320;
function chooseSide(side) {
  if (sim.side === side) return;
  sim.selectSide(side);
  field.dataset.side = side;
  windBand = 0;
  updateWind(sim.wind);
  syncHud();
}
function aimAt(event) {
  if (!ready || overlay.open) return false;
  const fieldBounds = field.getBoundingClientRect();
  chooseSide(event.clientX < fieldBounds.left + fieldBounds.width / 2 ? 'left' : 'right');
  const { x, y } = camera.target(event.clientX, event.clientY);
  const dx = Math.max(0, (x - sim.release.x) * (sim.side === 'left' ? 1 : -1));
  const up = sim.release.y - y;
  camera.focusAt(x);
  const bearing = Math.round((Math.atan2(up, dx) * 180) / Math.PI);
  const strength = Math.round((100 * Math.hypot(dx, up)) / fullPowerDistance);
  const angle = Math.min(+angles.max, Math.max(+angles.min, bearing));
  const power = Math.min(+powers.max, Math.max(+powers.min, strength));
  if (angle !== settings.angle || power !== settings.power) {
    angles.value = angle;
    powers.value = power;
    updateSliders();
  }
  return true;
}
const field = $('battlefield');
let previousTap = null;
let lastTouch = -Infinity;
let consumedClick = false;
let mouseX, mouseY;
function useInput(mode) {
  if (inputMode === mode) return;
  inputMode = mode;
  if (ready) syncHud();
}
document.addEventListener('pointerdown', (event) => useInput(event.pointerType === 'touch' ? 'touch' : 'mouse'));
document.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  if (event.clientX === mouseX && event.clientY === mouseY) return;
  mouseX = event.clientX;
  mouseY = event.clientY;
  useInput('mouse');
  if (event.target === field && !event.buttons) aimAt(event);
});
field.addEventListener('click', (event) => {
  if (event.button !== 0 || camera.dragged() || event.timeStamp - lastTouch < 500) return;
  if (event.detail <= 1) consumedClick = triggerBomb();
  if (!consumedClick) aimAt(event);
});
field.addEventListener('dblclick', (event) => {
  if (event.button !== 0 || camera.dragged() || consumedClick || event.timeStamp - lastTouch < 500) return;
  event.preventDefault();
  if (aimAt(event)) fire();
});
field.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'touch') return;
  lastTouch = event.timeStamp;
  if (camera.dragged() || triggerBomb() || !aimAt(event)) {
    previousTap = null;
    return;
  }
  const point = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  if (previousTap && point.t - previousTap.t < 340 && Math.hypot(point.x - previousTap.x, point.y - previousTap.y) < 24) {
    fire();
    previousTap = null;
  } else previousTap = point;
});

let nextFort = null;
let idleTicket = 0;
const main = document.querySelector('main');
const idle = window.requestIdleCallback?.bind(window) ||
  ((work) => setTimeout(() => work({ timeRemaining: () => 3, didTimeout: false }), 0));
const cancelIdle = window.cancelIdleCallback?.bind(window) || clearTimeout;

function reserve(size, seed) {
  if (idleTicket) cancelIdle(idleTicket);
  idleTicket = 0;
  nextFort = { size, seed, steps: FortressSimulation.prepareLevel(size, seed), world: null, requested: false };
}

function updateWind(wind) {
  const speed = Math.abs(wind);
  const band = (wind < 0 ? -1 : 1) * (speed < 14 ? 1 : speed < 20 ? 2 : speed < 39 ? 3 : 4);
  if (band === windBand) return;
  windBand = band;
  const strength = ['Light', 'Moderate', 'Strong', 'Gale'][Math.abs(band) - 1];
  const headwind = sim.side === 'left' ? band < 0 : band > 0;
  const windText = strength + (headwind ? ' headwind' : ' tailwind');
  $('wind-label').textContent = (band < 0 ? '← ' : '→ ') + windText;
  $('wind-label').title = windText + (band < 0 ? ' blowing left' : ' blowing right');
}

function enterFortress(world) {
  sim = world;
  field.dataset.side = sim.side;
  windBand = 0;
  const { difficulty: size, seed } = sim;
  renderer.reset();
  const level = sim.level;
  $('fort-size').value = size;
  const sizeName = DIFFICULTIES.find((item) => item.id === size).name;
  $('size-label').textContent = sizeName + ' fortress';
  $('level-name').textContent = level.name;
  $('phase-label').textContent = level.phase;
  const weather = level.weather || 'clear';
  $('weather-label').textContent = weather;
  document.body.dataset.weather = weather;
  updateWind(sim.wind ?? level.wind ?? 0);
  const best = bests[scoreKey()];
  $('objective').textContent = best ? 'Best siege · ' + best + ' gold' : 'Defeat every orc for the least gold.';
  document.body.dataset.phase = level.phase;
  camera.frame(level.phase, seed, landscapes[sim.themeIndex], level.sections);
  renderer.prepare(sim, landscapes[sim.themeIndex]);
  $('announcement').textContent = level.name + ', ' + weather + ' at ' + level.phase + '. ' + sim.stats.orcsTotal + ' orcs.';
  lastAnnouncedOrcs = sim.stats.orcsRemaining;
  lastStats = '';
  clock = 0;
  victoryRecorded = false;
  $('victory-report').hidden = true;
  $('mission').hidden = false;
  previousTap = null;
  consumedClick = false;
  lastTouch = -Infinity;
  angles.value = level.aim?.angle ?? 38;
  powers.value = level.aim?.power ?? 75;
  updateSliders();
  selectAmmo(0);
  syncHud();
  if (overlay.open) overlay.close();
  const hash = '#' + size + '/' + seed.toString(36);
  if (hash !== location.hash) history.replaceState(null, '', hash);
  main.removeAttribute('aria-busy');
  reserve(size, rollSeed());
}

function prepareNextFort() {
  const job = nextFort;
  if (!job || job.world || idleTicket || document.hidden) return;
  if (!job.requested && battleInProgress()) return;
  idleTicket = idle((deadline) => {
    idleTicket = 0;
    if (nextFort !== job || document.hidden || (!job.requested && battleInProgress())) return;
    const budget = deadline.didTimeout && job.requested ? 4 : deadline.timeRemaining() - 1;
    if (budget < 1) return;
    const end = performance.now() + Math.min(budget, job.requested ? 5 : 2.5);
    do {
      const step = job.steps.next();
      if (step.done) {
        job.steps = null;
        job.world = step.value;
        if (job.requested && job.fromHash === location.hash) enterFortress(job.world);
        return;
      }
    } while (performance.now() < end);
  }, { timeout: job.requested ? 8 : 100 });
}

function battleInProgress() {
  // A speculative fort uses spare time before firing or once the rubble sleeps.
  return sim.shots > 0 && !sim.resting && !overlay.open;
}

function requestFortress(size, seed) {
  if (!nextFort || nextFort.size !== size || nextFort.seed !== seed) reserve(size, seed);
  if (nextFort.world) {
    enterFortress(nextFort.world);
    return;
  }
  nextFort.requested = true;
  nextFort.fromHash = location.hash;
  main.setAttribute('aria-busy', 'true');
  prepareNextFort();
}
function newFortress(size) {
  store('size', size);
  const seed = nextFort?.size === size && !nextFort.requested ? nextFort.seed : rollSeed();
  requestFortress(size, seed);
}
$('fort-size').addEventListener('change', (event) => newFortress(event.target.value));
$('restart-button').addEventListener('click', () => requestFortress(sim.difficulty, sim.seed));
$('new-button').addEventListener('click', () => newFortress($('fort-size').value));
$('fold-controls').addEventListener('click', () => {
  const folded = document.body.classList.toggle('controls-folded');
  const button = $('fold-controls');
  button.setAttribute('aria-expanded', String(!folded));
  button.title = folded ? 'Show controls' : 'Hide controls';
  button.setAttribute('aria-label', button.title);
  camera.invalidate();
});

function syncMusicPause() {
  const paused = document.hidden || overlay.open;
  music.pause(paused);
  if (paused) audio.pauseWeather();
}
overlay.addEventListener('close', syncMusicPause);
$('close-dialog').addEventListener('click', () => overlay.close());
overlay.addEventListener('click', (event) => {
  if (event.target !== overlay) return;
  const b = overlay.getBoundingClientRect();
  if (event.clientX < b.left || event.clientY < b.top || event.clientX > b.right || event.clientY > b.bottom)
    overlay.close();
});
function showHelp() {
  $('dialog-body').innerHTML =
    '<div class="modal-kicker">' + icon('help') + 'Field guide</div><h2 id="dialog-title">How to play</h2>' +
    '<p>Defeat every orc for the least gold. Your score locks when the last orc falls. Keep firing, restart to beat your score, or generate another fortress.</p>' +
    '<ol><li><b>Choose a shot.</b> Small stones reload quickly enough for a volley. Heavy stones and bombs take longer. ' +
    'Bombs dig craters. Fireballs ignite timber and powder. Siege and Magic bombs stay armed after landing. ' +
    'Click the field or press Space with the charge selected. A Siege bomb blasts outward. A Magic bomb pulls nearby pieces inward. ' +
    'Guard countershots can split stones and set off explosive charges early.</li>' +
    '<li><b>Point to aim. Double-click to fire.</b> The left half of the field aims the left catapult. The right half aims the right. ' +
    'Aim up and inward from the sling. Distance sets power. The two crews reload independently. On touchscreens, tap to aim and double-tap to fire. ' +
    'Use A or D to choose a crew, ← and → for power, ↑ and ↓ for angle, and Space to fire. ' +
    'The first seven number-row keys select ammunition (1–7 or +ěščřžý on a Czech keyboard). Zoom and drag to inspect the keep.</li>' +
    '<li><b>Use the terrain and weather.</b> Lob a shot over the hill or break a support. Glass shatters, fallen stone can break again, ' +
    'and steel bends under load. Burning timber weakens and can ignite powder barrels. A fallen torch goes out. ' +
    'Rain puts out exposed fires. A roof can shelter burning timber. Check the wind before a high shot. ' +
    'Strong gusts can push a cracked support over.</li></ol>' +
    '<button class="primary-button" data-dismiss>Back to the siege</button>';
  overlay.showModal();
  syncMusicPause();
  overlay.querySelector('[data-dismiss]').addEventListener('click', () => overlay.close());
}
$('help-button').addEventListener('click', showHelp);
$('victory-new').addEventListener('click', () => newFortress(sim.difficulty));
$('victory-retry').addEventListener('click', () => requestFortress(sim.difficulty, sim.seed));
function showReport() {
  victoryRecorded = true;
  const cost = sim.winningCost;
  const key = scoreKey();
  const record = !bests[key] || cost < bests[key];
  if (record) {
    bests[key] = cost;
    store(scoreTable, Object.fromEntries(Object.entries(bests).slice(-200)));
  }
  track('game_end', { result: 'win', score: cost, duration_seconds: Math.round(sim.time) });
  const title = sim.level.name + ' has fallen';
  $('victory-title').textContent = title;
  $('victory-cost').textContent = cost + ' gold';
  $('victory-par').textContent = 'Par ' + sim.level.par;
  $('victory-best').textContent = record ? 'New best' : 'Best ' + bests[key];
  $('mission').hidden = true;
  $('victory-report').hidden = false;
  $('objective').textContent = 'Siege won for ' + cost + ' gold. Keep firing or start a new fortress.';
  $('announcement').textContent = title + '. Winning cost ' + cost + ' gold. You can keep firing.';
  camera.invalidate();
}
$('dismiss-victory').addEventListener('click', () => {
  $('victory-report').hidden = true;
  $('mission').hidden = false;
  camera.invalidate();
  $('battlefield').focus({ preventScroll: true });
});

const fullscreen = $('fullscreen-button');
if (!document.fullscreenEnabled) fullscreen.hidden = true;
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $('announcement').textContent = 'Fullscreen is unavailable in this browser.';
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreen.title = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
  fullscreen.setAttribute('aria-label', fullscreen.title);
});

document.addEventListener('keydown', (event) => {
  if (
    !ready ||
    overlay.open ||
    event.target.tagName === 'SELECT' ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (event.key === '?') {
    showHelp();
    return;
  }
  if (event.code === 'KeyA' || event.code === 'KeyD') {
    event.preventDefault();
    useInput('keyboard');
    chooseSide(event.code === 'KeyA' ? 'left' : 'right');
    field.focus({ preventScroll: true });
    return;
  }
  const physicalAmmo = /^(?:Digit|Numpad)([1-7])$/.exec(event.code);
  let ammo = physicalAmmo ? +physicalAmmo[1] : 0;
  if (!ammo && /^[1-7]$/.test(event.key)) ammo = +event.key;
  // Some virtual keyboards omit a physical code. Czech top-row keys are unshifted.
  if (!ammo && (!event.code || event.code === 'Unidentified')) ammo = czechAmmoKeys.indexOf(event.key) + 1;
  if (ammo && ammo <= AMMO.length) {
    event.preventDefault();
    useInput('keyboard');
    selectAmmo(ammo - 1);
    $('battlefield').focus({ preventScroll: true });
    return;
  }
  if (event.code === 'Space') {
    if (event.target.closest('button,a') && event.target !== $('fire-button')) return;
    event.preventDefault();
    useInput('keyboard');
    if (!event.repeat) primaryFire();
    return;
  }
  const arrows = {
    ArrowLeft: [powers, -1],
    ArrowRight: [powers, 1],
    ArrowDown: [angles, -1],
    ArrowUp: [angles, 1],
  };
  const instruction = arrows[event.key];
  if (!instruction) return;
  event.preventDefault();
  useInput('keyboard');
  field.focus({ preventScroll: true });
  const [control, delta] = instruction;
  control.value = +control.value + delta;
  updateSliders();
});

function tick(now) {
  const dt = previousFrame === null ? 0 : Math.min(0.1, (now - previousFrame) / 1000);
  previousFrame = now;
  if (!document.hidden && !overlay.open) {
    clock += dt;
    sim.update(dt);
    if (sim.level.gust) updateWind(sim.wind);
    const events = sim.drainEvents();
    const view = camera.update(sim, events, dt, reduced.matches);
    audio.play(events, sim, view, clock);
    renderer.draw(sim, {
      ...settings,
      time: clock,
      events,
      reducedMotion: reduced.matches,
      view,
      scenery: landscapes[sim.themeIndex],
    });
    syncHud();
    if (!victoryRecorded && sim.winningCost !== null) showReport();
  }
  prepareNextFort();
  requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => {
  previousFrame = null;
  syncMusicPause();
});
window.addEventListener('hashchange', () => {
  if (!ready) return;
  const next = readFortress();
  requestFortress(next.size, next.seed);
});

function activateSound(event) {
  if (!ready || !soundOn || overlay.open || event.target.closest?.('#sound-button')) return;
  audio.unlock();
  music.activate();
  window.removeEventListener('pointerup', activateSound);
  window.removeEventListener('keydown', activateSound);
}
window.addEventListener('pointerup', activateSound);
window.addEventListener('keydown', activateSound);

async function boot() {
  const message = $('prep-message');
  const progress = $('prep-progress');
  const retry = $('prep-retry');
  retry.hidden = true;
  message.textContent = 'Preparing the battlefield…';
  try {
    landscapes = await prepareAssets(
      audio,
      music,
      async () => {
        // Pre-bake each lighting grade at the scales available through this camera.
        const longest = Math.max(innerWidth, innerHeight, screen.width, screen.height);
        const maxScale = (Math.min(3840, longest * (devicePixelRatio || 1)) * 2.5) / WORLD.width;
        const scales = [1, 1.65, 3].filter((threshold, index) => index === 0 || threshold <= maxScale);
        for (const phase of ['day', 'dawn', 'dusk', 'night']) {
          for (const scale of scales) await whenSpritesReady(phase, scale);
        }
      },
      (count, total) => {
        progress.value = count / total;
      },
    );
    await camera.prepareSkies(landscapes);
    const entry = location.hash && location.hash !== initialHash ? readFortress() : initial;
    if (entry !== initial) sim.loadLevel(entry.size, entry.seed);
    enterFortress(sim);
    ready = true;
    document.querySelector('main').inert = false;
    document.querySelector('header').inert = false;
    $('preflight').hidden = true;
    requestAnimationFrame(tick);
  } catch {
    message.textContent = 'The battlefield could not be prepared.';
    retry.hidden = false;
  }
}
const initialHash = location.hash;
$('prep-retry').addEventListener('click', () => location.reload());
boot();
