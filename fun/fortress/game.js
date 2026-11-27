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
  'A heavy stone with enough momentum to punch through masonry.',
  'A compact blast for breaking clustered supports.',
  'A wide blast that can bring down several rooms at once.',
];
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
const sim = new FortressSimulation(initial.size, initial.seed);
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
const savedBests = stored('siege-bests', {});
const bests = Object.fromEntries(
  Object.entries(savedBests && typeof savedBests === 'object' ? savedBests : {})
    .filter(
      ([key, value]) => /^(small|medium|large)\.[0-9a-z]{1,7}$/.test(key) && Number.isInteger(value) && value > 0,
    )
    .slice(-200),
);
let soundOn = stored('sound', false) === true;
let clock = 0;
let previousFrame = null;
let reportAt = Infinity;
let recordSet = false;
let lastStats = '';
let lastAnnouncedOrcs = sim.stats.orcsRemaining;
const ammoButtons = [];

function selectAmmo(index) {
  settings.ammo = AMMO[index].id;
  ammoButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(index === i)));
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
  const key = [s.orcsRemaining, s.destruction, s.spent, s.ready, s.cleared].join('/');
  if (key === lastStats) return;
  lastStats = key;
  $('orcs').textContent = s.orcsRemaining + ' / ' + s.orcsTotal;
  $('destruction').textContent = s.destruction + '%';
  $('spent').textContent = String(s.spent);
  const state = $('state');
  state.toggleAttribute('data-busy', !s.ready && !s.cleared);
  state.toggleAttribute('data-won', s.orcsRemaining === 0);
  state.querySelector('span').textContent =
    s.orcsRemaining === 0 ? 'Fortress cleared' : s.ready ? 'Ready to fire' : 'Reloading';
  const fireButton = $('fire-button');
  fireButton.disabled = !s.ready && !s.cleared;
  fireButton.querySelector('span').textContent = s.cleared
    ? 'Siege report'
    : s.ready
      ? 'Fire catapult'
      : 'Reloading';
  if (s.orcsRemaining !== lastAnnouncedOrcs) {
    $('announcement').textContent = s.orcsRemaining + ' orcs left. ' + s.destruction + '% of the fort destroyed.';
    lastAnnouncedOrcs = s.orcsRemaining;
  }
}

function fire() {
  if (!ready || overlay.open) return;
  if (sim.stats.cleared) {
    showReport();
    return;
  }
  if (!sim.fire(settings.ammo, settings.angle, settings.power)) return;
  audio.unlock();
  if (soundOn) music.activate();
  if (sim.shots === 1) track('game_start', { action: 'fire' });
  syncHud();
}
$('fire-button').addEventListener('click', fire);

function aimAt(event) {
  if (!ready || !sim.stats.orcsRemaining || camera.dragged() || event.button !== 0) return;
  const { x, y } = camera.target(event.clientX, event.clientY);
  camera.focusAt(x);
  if (x < WORLD.release.x + 30 || y > WORLD.ground + 10) return;
  let best = Infinity,
    angle = settings.angle,
    power = settings.power;
  for (let candidate = +angles.min; candidate <= +angles.max; candidate++) {
    // At a fixed angle, higher power passes higher over the same point.
    let low = +powers.min;
    let high = +powers.max;
    while (low <= high) {
      const strength = Math.floor((low + high) / 2);
      const height = sim.heightAt(settings.ammo, candidate, strength, x);
      const miss = Math.abs(height - y) + Math.abs(candidate - settings.angle) * 0.22;
      if (miss < best) {
        best = miss;
        angle = candidate;
        power = strength;
      }
      if (height > y) low = strength + 1;
      else high = strength - 1;
    }
  }
  angles.value = angle;
  powers.value = power;
  updateSliders();
}
const field = $('battlefield');
field.addEventListener('click', aimAt);
field.addEventListener('dblclick', (event) => {
  if (event.button !== 0 || camera.dragged()) return;
  event.preventDefault();
  if (sim.stats.orcsRemaining) fire();
});
let previousTap = null;
field.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'touch' || camera.dragged()) {
    previousTap = null;
    return;
  }
  const point = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  if (
    previousTap &&
    point.t - previousTap.t < 340 &&
    Math.hypot(point.x - previousTap.x, point.y - previousTap.y) < 24
  ) {
    aimAt(event);
    if (sim.stats.orcsRemaining) fire();
    previousTap = null;
  } else previousTap = point;
});

function enterFortress(size, seed, alreadyLoaded = false) {
  if (!alreadyLoaded) sim.loadLevel(size, seed);
  renderer.reset();
  const level = sim.level;
  $('fort-size').value = size;
  const sizeName = DIFFICULTIES.find((item) => item.id === size).name;
  $('size-label').textContent = sizeName + ' fortress';
  $('level-name').textContent = level.name;
  $('phase-label').textContent = level.phase;
  const wind = level.wind || 0;
  const strength = Math.abs(wind) < 14 ? 'Light' : Math.abs(wind) < 20 ? 'Moderate' : 'Strong';
  const windText = strength + (wind < 0 ? ' headwind' : ' tailwind');
  $('wind-label').textContent = (wind < 0 ? '← ' : '→ ') + windText;
  $('wind-label').title = windText + (wind < 0 ? ' blows toward the catapult' : ' blows toward the fortress');
  const best = bests[scoreKey()];
  $('objective').textContent = best ? 'Best siege · ' + best + ' gold' : 'Defeat every orc for the least gold.';
  document.body.dataset.phase = level.phase;
  camera.frame(level.phase, seed, landscapes[sim.themeIndex]);
  renderer.prepare(sim, landscapes[sim.themeIndex]);
  $('announcement').textContent = level.name + ', ' + level.phase + '. ' + sim.stats.orcsTotal + ' orcs.';
  lastAnnouncedOrcs = sim.stats.orcsRemaining;
  lastStats = '';
  clock = 0;
  reportAt = Infinity;
  recordSet = false;
  previousTap = null;
  angles.value = level.aim?.angle ?? 38;
  powers.value = level.aim?.power ?? 75;
  updateSliders();
  selectAmmo(0);
  syncHud();
  if (overlay.open) overlay.close();
  const hash = '#' + size + '/' + seed.toString(36);
  if (hash !== location.hash) history.replaceState(null, '', hash);
}
function newFortress(size) {
  store('size', size);
  enterFortress(size, rollSeed());
}
$('fort-size').addEventListener('change', (event) => newFortress(event.target.value));
$('restart-button').addEventListener('click', () => enterFortress(sim.difficulty, sim.seed));
$('new-button').addEventListener('click', () => newFortress(sim.difficulty));
$('fold-controls').addEventListener('click', () => {
  const folded = document.body.classList.toggle('controls-folded');
  const button = $('fold-controls');
  button.setAttribute('aria-expanded', String(!folded));
  button.title = folded ? 'Show controls' : 'Hide controls';
  button.setAttribute('aria-label', button.title);
  camera.invalidate();
});

function dialogContent(kicker, symbol, title, html) {
  $('dialog-body').innerHTML =
    '<div class="modal-kicker">' + icon(symbol) + kicker + '</div><h2 id="dialog-title">' + title + '</h2>' + html;
  if (!overlay.open) overlay.showModal();
  music.pause(true);
}
overlay.addEventListener('close', () => music.pause(document.hidden));
$('close-dialog').addEventListener('click', () => overlay.close());
overlay.addEventListener('click', (event) => {
  if (event.target !== overlay) return;
  const b = overlay.getBoundingClientRect();
  if (event.clientX < b.left || event.clientY < b.top || event.clientX > b.right || event.clientY > b.bottom)
    overlay.close();
});
function showHelp() {
  dialogContent(
    'Field guide',
    'help',
    'How to play',
    '<p>Defeat every orc for the least gold. Choose Small, Medium or Large to generate a fortress. Restart keeps its layout so you can beat your score.</p>' +
      '<ol><li><b>Choose a shot.</b> Small stones reload fast enough for a volley. Heavy stones and bombs take longer. Bombs can hit several rooms or trigger powder barrels.</li><li><b>Click to aim. Double-click to fire.</b> You can also set the angle and power yourself and launch with Space. The camera follows your volley into the impact. Between shots you can zoom and drag to inspect the towers.</li><li><b>Use the terrain.</b> Lob a shot over a hill, or bring down a tower onto the guards below. Timber touching a lit torch can catch fire. A falling torch goes out. Wind bends the shot path, especially on high arcs.</li></ol>' +
      '<button class="primary-button" data-dismiss>Back to the siege</button>',
  );
  overlay.querySelector('[data-dismiss]').addEventListener('click', () => overlay.close());
}
$('help-button').addEventListener('click', showHelp);
function showReport() {
  reportAt = Infinity;
  const s = sim.stats,
    level = sim.level;
  const more = 'New fortress';
  dialogContent(
    'Siege complete',
    'trophy',
    level.name + ' has fallen',
    '<p>All ' +
      s.orcsTotal +
      ' orcs fainted. You destroyed ' +
      s.destruction +
      '% of the fort in ' +
      s.shots +
      (s.shots === 1 ? ' shot.' : ' shots.') +
      '</p>' +
      '<div class="result-score"><i class="coin"></i><strong>' +
      s.spent +
      ' gold</strong></div>' +
      '<p style="margin-top:12px">' +
      (recordSet ? 'Personal best.' : 'Personal best is ' + bests[scoreKey()] + ' gold.') +
      ' The target for this fortress is ' +
      level.par +
      ' gold.</p>' +
      '<div class="dialog-actions"><button class="primary-button" data-next>' +
      more +
      '</button><button class="secondary-button" data-replay>Try for less gold</button></div>',
  );
  overlay.querySelector('[data-next]').addEventListener('click', () => newFortress(sim.difficulty));
  overlay.querySelector('[data-replay]').addEventListener('click', () => enterFortress(sim.difficulty, sim.seed));
}

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
  if (/^[1-4]$/.test(event.key)) {
    event.preventDefault();
    selectAmmo(+event.key - 1);
    $('battlefield').focus({ preventScroll: true });
    return;
  }
  if (event.target.tagName === 'INPUT' && event.code !== 'Space') return;
  if (event.code === 'Space') {
    if (event.target.closest('button,a') && event.target !== $('fire-button')) return;
    event.preventDefault();
    if (!event.repeat) fire();
    return;
  }
  const arrows = {
    ArrowLeft: [angles, -1],
    ArrowRight: [angles, 1],
    ArrowDown: [powers, -1],
    ArrowUp: [powers, 1],
  };
  const instruction = arrows[event.key];
  if (!instruction) return;
  event.preventDefault();
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
    const events = sim.drainEvents();
    audio.play(events);
    if (events.some((e) => e.type === 'clear')) {
      const key = scoreKey(),
        { spent } = sim.stats;
      recordSet = !bests[key] || spent < bests[key];
      if (recordSet) {
        bests[key] = spent;
        store('siege-bests', Object.fromEntries(Object.entries(bests).slice(-200)));
      }
      track('game_end', { result: 'win', score: spent, duration_seconds: Math.round(sim.time) });
      reportAt = clock + 0.4;
    }
    renderer.draw(sim, {
      ...settings,
      time: clock,
      events,
      reducedMotion: reduced.matches,
      view: camera.update(sim, events, dt, reduced.matches),
      scenery: landscapes[sim.themeIndex],
    });
    syncHud();
    if (clock >= reportAt) showReport();
  }
  requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => {
  previousFrame = null;
  music.pause(document.hidden || overlay.open);
});
window.addEventListener('hashchange', () => {
  if (!ready) return;
  const next = readFortress();
  enterFortress(next.size, next.seed);
});

function activateSound(event) {
  if (!ready || !soundOn || overlay.open || event.target.closest?.('#sound-button')) return;
  audio.unlock();
  music.activate();
  window.removeEventListener('pointerdown', activateSound);
  window.removeEventListener('keydown', activateSound);
}
window.addEventListener('pointerdown', activateSound);
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
    const entry = location.hash && location.hash !== initialHash ? readFortress() : initial;
    enterFortress(entry.size, entry.seed, entry === initial);
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
